// 邊界測試：回退最多 5 步（GAME_DESIGN 第 9 節）、重試與回退不換種子（AI_TASKS 2.4 節；不變式 4、5、23）。cpp-tester-boundary 寫的。
//
// 回退：0、1、5（上限）、6（上限+1）、負數、空的堆疊、讀檔與開新遊戲之後；性質：回退 m 步等於當時的狀態，回退之後重做同樣的行動得到同樣的結果。
// 重試：只有最新一樓；重試別的步驟不重擲；重擲 r 次留 r 筆；重試與重擲不吃回退的步數。
// 已知會失敗的（bug）用 it.fails 標著，修好之後會變紅，提醒把 it.fails 拿掉（見 dev/bugs/）。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ActionKindDef, Feature, JudgeOutput } from '../../src'
import { UNDO_STEPS } from '../../src'
import { makeGame, observed, stateHash } from '../../src/testkit'

const TEXTS = ['我看看四周', '我敲敲牆', '我坐下來', '我翻垃圾桶', '我對著鏡子練習微笑', '我數天花板的裂縫']

/** 測試用的行動：乞討（有骰、有回報） */
const BEG: ActionKindDef = {
  id: 'beg', owner: 'test', name: '乞討', attr: 'charm', skill: 'perform', dc: 'normal', minutes: 60, maxMinutes: 120, reportKind: 'action',
  hint: ({ degree, grade }) => (degree === 'critical' ? [{ kind: 'cash', amount: 40 * grade }] : degree === 'success' ? [{ kind: 'cash', amount: 20 * grade }] : []),
}
const testFeature: Feature = { id: 'test_actions', install: (k) => k.actions.register(BEG) }
const BAD_COMMIT = { kind: 'system' as const, location: {}, party: [], timeline: [], changes: [{ op: 'cash', delta: -1 }], outcome: { result: 'x', summary: '付不出來的錢' } }
/** 不合法的重試請求（AI_TASKS 2.4 節：套用不能單獨重試；只有擲骰能重擲；只有 AI 的步驟能用規則代替） */
const BAD_RETRIES: Array<{ name: string; error: RegExp; run: (g: ReturnType<typeof makeGame>['game']) => Promise<unknown> }> = [
  { name: '重試套用', error: /套用不能單獨重試/, run: (g) => g.retryStep('apply') },
  { name: '重試不存在的步驟', error: /沒有 no_such_step/, run: (g) => g.retryStep('no_such_step') },
  { name: '重擲判定', error: /不是擲骰/, run: (g) => g.reroll('judge') },
  { name: '對程式的步驟用規則代替', error: /只有 AI 的步驟/, run: (g) => g.useRules('hint') },
]

// ---------------------------------------------------------------------------------------------
// GAME_DESIGN 第 9 節：回退最多 5 步

describe('邊界 GAME_DESIGN 9：回退的步數', () => {
  it('上限：做 5 件事，回退 5 步回到最開始；第 6 步（上限+1）回 false、狀態不變', async () => {
    const { game } = makeGame()
    const h0 = stateHash(game.state)
    for (let i = 0; i < UNDO_STEPS; i++) await game.act({ kind: 'free', text: TEXTS[i]! })
    expect(UNDO_STEPS).toBe(5)
    expect(game.undoSteps(UNDO_STEPS + 1)).toBe(false)
    expect(game.undo.size).toBe(5)
    expect(game.undoSteps(UNDO_STEPS)).toBe(true)
    expect(stateHash(game.state)).toBe(h0)
    const h = stateHash(game.state)
    expect(game.undoSteps(1)).toBe(false)
    expect(stateHash(game.state)).toBe(h)
  })

  it('上限+1：做 6 件事，最多只回得到第 1 件做完的時候；一步一步回也一樣', async () => {
    const { game } = makeGame()
    const hashes = [stateHash(game.state)]
    for (let i = 0; i < 6; i++) {
      await game.act({ kind: 'free', text: TEXTS[i]! })
      hashes.push(stateHash(game.state))
    }
    for (let i = 0; i < 5; i++) expect(game.undoSteps(1)).toBe(true)
    expect(stateHash(game.state)).toBe(hashes[1])
    expect(game.undoSteps(1)).toBe(false)
  })

  it('零與負數：回 false、什麼都不動；空的堆疊回 false', async () => {
    const { game } = makeGame()
    expect(game.undoSteps(1)).toBe(false)
    await game.act({ kind: 'free', text: TEXTS[0]! })
    const h = stateHash(game.state)
    for (const n of [0, -1, -5, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(game.undoSteps(n), String(n)).toBe(false)
      expect(game.undo.size).toBe(1)
      expect(stateHash(game.state)).toBe(h)
    }
  })

  it('讀檔與開新遊戲之後不能回退到之前（快照不進存檔）', async () => {
    const { game } = makeGame()
    for (let i = 0; i < 3; i++) await game.act({ kind: 'free', text: TEXTS[i]! })
    const text = game.save()
    expect(text).not.toMatch(/undo/i)
    expect(game.load(text)).toBeNull()
    expect(game.undoSteps(1)).toBe(false)
    await game.act({ kind: 'free', text: TEXTS[3]! })
    expect(game.undo.size).toBe(1)
    game.newGame({ seed: 9 })
    expect(game.undoSteps(1)).toBe(false)
  })

  it('性質：隨機的種子、做 k 件事（1～9），回退 m 步（1～5）等於第 k−m 件做完時的狀態；回退超過能回的回 false、狀態不變', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.array(fc.constantFrom(...TEXTS), { minLength: 1, maxLength: 9 }), fc.integer({ min: 1, max: 6 }), async (seed, texts, m) => {
      const { game } = makeGame({ seed })
      const hashes = [stateHash(game.state)]
      for (const text of texts) {
        await game.act({ kind: 'free', text })
        hashes.push(stateHash(game.state))
      }
      const can = Math.min(texts.length, UNDO_STEPS)
      const before = stateHash(game.state)
      const ok = game.undoSteps(m)
      if (m > can) return ok === false && stateHash(game.state) === before && game.undo.size === can
      return ok && stateHash(game.state) === hashes[texts.length - m] && game.undo.size === can - m
    }), { numRuns: 40 })
  })

  it('性質（回退不換種子）：回退 m 步之後重做同樣的 m 件事，狀態和回退前一模一樣（亂數的位置也一樣）', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.array(fc.constantFrom(...TEXTS), { minLength: 1, maxLength: 7 }), fc.integer({ min: 1, max: 5 }), async (seed, texts, m0) => {
      const { game } = makeGame({ seed, features: [testFeature] })
      for (const text of texts) await game.act({ kind: text.length % 2 ? 'beg' : 'free', text })
      const target = stateHash(game.state)
      const m = Math.min(m0, texts.length)
      expect(game.undoSteps(m)).toBe(true)
      for (const text of texts.slice(texts.length - m)) await game.act({ kind: text.length % 2 ? 'beg' : 'free', text })
      return stateHash(game.state) === target
    }), { numRuns: 30 })
  })

  it('AI 開著、假的服務商對抗模式：回退 5 步照樣回到最開始，不變式成立', async () => {
    const { game } = makeGame({ ai: { ai: 1 }, fake: { adversarial: { mode: 'over_cap' } } })
    const h0 = stateHash(game.state)
    const { violations } = await observed(game, async () => {
      for (let i = 0; i < 5; i++) await game.act({ kind: 'free', text: TEXTS[i]! }, { autoRules: true })
    })
    expect(violations).toEqual([])
    expect(game.undoSteps(5)).toBe(true)
    expect(stateHash(game.state)).toBe(h0)
    expect(game.state.chains).toEqual([])
  })
})

describe('邊界 GAME_DESIGN 9：已知的問題（it.fails：修好之後會變紅，把 it.fails 拿掉）', () => {
  // B003：堆疊滿了（5 步）的時候，一個被擋下或出錯的動作會擠掉最舊的一步，回退只剩 4 步
  it.fails('B003：做滿 5 件事之後一次提交失敗，回退的步數仍是 5、仍回得到最開始', async () => {
    const { game } = makeGame()
    const h0 = stateHash(game.state)
    for (let i = 0; i < 5; i++) await game.act({ kind: 'free', text: TEXTS[i]! })
    const h5 = stateHash(game.state)
    expect(() => game.commit(BAD_COMMIT)).toThrow()
    expect(stateHash(game.state)).toBe(h5)
    expect(game.undo.size).toBe(5)
    expect(game.undoSteps(5)).toBe(true)
    expect(stateHash(game.state)).toBe(h0)
  })

  it.fails('B003：做滿 5 件事之後一個被擋下的行動（沒有這種行動），回退的步數仍是 5', async () => {
    const { game } = makeGame()
    for (let i = 0; i < 5; i++) await game.act({ kind: 'free', text: TEXTS[i]! })
    await expect(game.act({ kind: 'no_such_action' })).rejects.toThrow()
    expect(game.undo.size).toBe(5)
  })

  // B004：回退的步數不是整數時丟 RangeError，而不是回 false
  it.fails('B004：回退 1.5 步、NaN 步回 false（不丟錯）', async () => {
    const { game } = makeGame()
    await game.act({ kind: 'free', text: TEXTS[0]! })
    await game.act({ kind: 'free', text: TEXTS[1]! })
    expect(game.undoSteps(1.5)).toBe(false)
    expect(game.undoSteps(Number.NaN)).toBe(false)
    expect(game.undo.size).toBe(2)
  })

  it('B004 的現況：丟錯，但狀態與堆疊都沒變（所以只是小問題）', async () => {
    const { game } = makeGame()
    await game.act({ kind: 'free', text: TEXTS[0]! })
    await game.act({ kind: 'free', text: TEXTS[1]! })
    const h = stateHash(game.state)
    for (const n of [1.5, Number.NaN]) {
      expect(() => game.undoSteps(n)).toThrow(RangeError)
      expect(game.undo.size).toBe(2)
      expect(stateHash(game.state)).toBe(h)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// AI_TASKS 2.4：重試與重擲

describe('邊界 AI_TASKS 2.4：重試只有最新一樓、重試不重擲、重擲留紀錄', () => {
  const setup = (o: Parameters<typeof makeGame>[0] = {}) => makeGame({ features: [testFeature], ai: { ai: 1 }, fake: true, ...o })

  it('重擲 0 次：骰面沒有 rerolls 與 history；重擲 1 次：rerolls 1、history 一筆', async () => {
    const { game } = setup()
    const first = await game.act({ kind: 'beg', text: '我伸手' })
    const roll0 = first.reports[0]!.timeline[0]!.roll!
    expect(roll0.rerolls).toBeUndefined()
    expect(roll0.history).toBeUndefined()
    const second = await game.reroll()
    expect(second.reports[0]!.timeline[0]!.roll!).toMatchObject({ rerolls: 1, history: [roll0.natural] })
  })

  it('性質：隨機的種子，重擲 r 次（0～6）、中間夾隨機的重試：最後的骰面只由 r 決定；紀錄 r 筆；回退的步數不變；同一局只有一份報告', async () => {
    const OPS = ['judge', 'reward', 'text', 'roll'] as const
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.array(fc.oneof(fc.constant('reroll' as const), fc.constantFrom(...OPS)), { maxLength: 8 }), async (seed, ops) => {
      const a = setup({ seed })
      await a.game.act({ kind: 'beg', text: '我伸手' })
      const naturals: number[] = [(a.game.lastRun!.draft.roll as { roll: { natural: number } }).roll.natural]
      let r = 0
      for (const op of ops) {
        const res = op === 'reroll' ? await a.game.reroll() : await a.game.retryStep(op)
        if (op === 'reroll') r++
        const roll = (res.run.draft.judge as JudgeOutput).judgment.roll
        if (op === 'reroll') naturals.push(roll.natural)
        // 重試別的步驟（包括重試擲骰那一步本身）不換骰
        if (roll.natural !== naturals[r]) return false
        if ((roll.rerolls ?? 0) !== r || (roll.history ?? []).length !== r) return false
      }
      // 另一局只重擲 r 次（沒有夾重試），骰面一樣
      const b = setup({ seed })
      await b.game.act({ kind: 'beg', text: '我伸手' })
      for (let i = 0; i < r; i++) await b.game.reroll()
      const nb = (b.game.lastRun!.draft.judge as JudgeOutput).judgment.roll.natural
      return nb === naturals[r] && a.game.undo.size === 1 && a.game.state.reports.filter((x) => x.action === 'beg').length === 1 && JSON.stringify(a.game.state.reports.at(-1)!.timeline[0]!.roll) === JSON.stringify(b.game.state.reports.at(-1)!.timeline[0]!.roll)
    }), { numRuns: 25 })
  })

  it('重擲過之後回退 1 步：回到行動之前；再做同樣的行動擲出第一次的骰（回退不換種子，重擲不跟著留下）', async () => {
    const { game } = setup()
    const h0 = stateHash(game.state)
    const first = await game.act({ kind: 'beg', text: '我伸手' })
    const n0 = first.reports[0]!.timeline[0]!.roll!.natural
    await game.reroll()
    await game.reroll()
    expect(game.undo.size).toBe(1)
    expect(game.undoSteps(1)).toBe(true)
    expect(stateHash(game.state)).toBe(h0)
    const again = await game.act({ kind: 'beg', text: '我伸手' })
    expect(again.reports[0]!.timeline[0]!.roll!.natural).toBe(n0)
    expect(again.reports[0]!.timeline[0]!.roll!.rerolls).toBeUndefined()
  })

  it('只有最新一樓：回退之後、讀檔之後、開新遊戲之後都不能重試或重擲', async () => {
    const { game } = setup()
    await game.act({ kind: 'beg', text: '我伸手' })
    game.undoSteps(1)
    await expect(game.retryStep('judge')).rejects.toThrow(/回退/)
    await expect(game.reroll()).rejects.toThrow(/回退/)
    await game.act({ kind: 'beg', text: '我伸手' })
    expect(game.load(game.save())).toBeNull()
    await expect(game.retryStep('judge')).rejects.toThrow(/回退/)
    await expect(game.reroll()).rejects.toThrow()
    game.newGame({ seed: 3 })
    await expect(game.useRules('judge')).rejects.toThrow()
  })

  it('不合法的重試請求（套用、不存在的步驟、重擲擲骰以外的步驟、對程式步驟用規則代替）都丟錯', async () => {
    for (const call of BAD_RETRIES) {
      const { game } = setup()
      await game.act({ kind: 'beg', text: '我伸手' })
      await expect(call.run(game), call.name).rejects.toThrow(call.error)
    }
  })

  // B005：不合法的重試請求先把最新一樓的套用回退掉，才發現不能重試；丟錯之後那一次行動已經不見了
  for (const call of BAD_RETRIES) {
    it.fails(`B005：${call.name}被拒絕之後，狀態和請求之前一模一樣（最新一樓的報告還在）`, async () => {
      const { game } = setup()
      await game.act({ kind: 'beg', text: '我伸手' })
      const h = stateHash(game.state)
      await expect(call.run(game)).rejects.toThrow()
      expect(stateHash(game.state)).toBe(h)
      expect(game.lastRun!.status).toBe('applied')
    })
  }

  it('B005 的現況：被拒絕的重試把行動回退掉了；接著做下一件事，那一次行動就永遠消失（沒有人按回退）', async () => {
    const { game } = setup()
    const h0 = stateHash(game.state)
    await game.act({ kind: 'beg', text: '我伸手' })
    await expect(game.retryStep('apply')).rejects.toThrow(/套用不能單獨重試/)
    expect(stateHash(game.state)).toBe(h0)
    expect(game.lastRun!.status).toBe('blocked')
    await game.act({ kind: 'free', text: '我敲敲牆' })
    expect(game.state.reports.map((r) => r.action)).toEqual(['game.new', 'free'])
  })
})
