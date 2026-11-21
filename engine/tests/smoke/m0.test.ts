// 冒煙測試的主幹（dev/test-harness.md 第 6 節）。固定種子、AI 關閉。主幹隨批次長大：
//   M0：開新遊戲 → 建角 → 空房間的自由行動 → 存檔 → 讀檔 → 回退
//
// 這一份只用核心：「建角」這一步是核心的替身（直接提交一份放進主角的報告）。建角、角色、特質這幾個 L6 功能做完之後，
// 用真正的功能走同一條主幹的版本在 tests/pending/M0-smoke-features.test.ts（那幾張工單完成後搬進這個資料夾）。

import { describe, expect, it } from 'vitest'
import type { ReportDraft } from '../../src'
import { Game } from '../../src'
import { commitViolations, makeActor, stateHash } from '../../src/testkit'

const SEED = 20261121

describe('冒煙 M0：開新遊戲 → 建角 → 空房間的自由行動 → 存檔 → 讀檔 → 回退', () => {
  it('主幹跑得完，每一步的狀態都對', async () => {
    const game = new Game({ strict: true, ai: { ai: 0 } })
    game.k.probe.start()

    // 1. 開新遊戲
    const created = game.newGame({ seed: SEED, rules: { difficulty: 'normal' } })
    expect(created.id).toBe('r1')
    expect(game.state.pc).toBeNull()
    expect(game.state.time).toEqual({ day: 1, hour: 8, minute: 0 })
    expect(game.state.rules.dcOffset).toBe(0)
    await expect(game.act({ kind: 'free', text: '還沒有主角就想動' })).rejects.toThrow('還沒有主角。')

    // 2. 建角（核心的替身）：一份報告放進主角、起始的錢與開場的地點
    const pc = makeActor({ id: 'pc', name: '露', age: 22, attrs: { charm: 15, reflex: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }, skills: { negotiate: 2 } })
    const creation: ReportDraft = {
      kind: 'system', action: 'creation.commit', location: {}, party: [], timeline: [],
      changes: [{ op: 'actor.add', actor: pc }, { op: 'pc', id: 'pc' }, { op: 'cash', delta: game.state.rules.startMoney }, { op: 'location', to: { district: 'test', block: 'empty_room', scene: '一個空房間' } }],
      outcome: { result: 'created', summary: '建角完成。' },
    }
    game.commit(creation)
    expect(game.state.pc).toBe('pc')
    expect(game.state.party).toEqual(['pc'])
    expect(game.state.money.cash).toBe(1500)

    // 3. 空房間的自由行動（AI 關閉：照骰值與參考 DC 判定，沒有正文，只有摘要）
    const act = await game.act({ kind: 'free', text: '我檢查這個房間的門鎖', attr: 'tech' })
    expect(act.status).toBe('applied')
    const report = act.reports[0]!
    expect(report.kind).toBe('action')
    expect(report.input).toBe('我檢查這個房間的門鎖')
    const roll = report.timeline[0]!.roll!
    expect(roll.attr).toBe('tech')
    expect(roll.total).toBe(roll.natural - 1)
    expect(roll.dc).toBe(13)
    expect(report.outcome.result).toBe(roll.degree)
    expect(report.outcome.summary).toContain('自由行動')
    expect(report.narration?.text).toBeUndefined()
    expect(game.state.time).toEqual({ day: 1, hour: 8, minute: 30 })
    expect(game.state.rng.cursor).toBe(1)
    expect(act.run.steps.every((s) => ['done', 'fallback', 'skipped'].includes(s.status))).toBe(true)

    // 4. 存檔
    const saved = game.save('manual', 'smoke')
    const savedHash = stateHash(game.state)

    // 5. 讀檔：先多做一件事，讀檔之後回到存檔時的狀態
    await game.act({ kind: 'free', text: '我坐在地上發呆' })
    expect(stateHash(game.state)).not.toBe(savedHash)
    expect(game.load(saved)).toBeNull()
    expect(stateHash(game.state)).toBe(savedHash)

    // 6. 回退：讀檔之後做一件事再回退，狀態和回退前那一刻之前完全相同
    const again = await game.act({ kind: 'free', text: '我坐在地上發呆' })
    expect(again.status).toBe('applied')
    expect(game.state.reports).toHaveLength(4)
    expect(game.undoSteps(1)).toBe(true)
    expect(stateHash(game.state)).toBe(savedHash)
    expect(game.state.reports).toHaveLength(3)

    // 全程：每一份報告的 changes 套用之後都等於狀態的變化
    expect(commitViolations(game.k, game.k.probe.stop())).toEqual([])
  })

  it('同一個種子、同一串輸入，得到同一個結果；換一個種子骰子就不一樣', async () => {
    const play = async (seed: number) => {
      const game = new Game({ strict: true, ai: { ai: 0 } })
      game.newGame({ seed })
      game.commit({ kind: 'system', action: 'creation.commit', location: {}, party: [], timeline: [], changes: [{ op: 'actor.add', actor: makeActor() }, { op: 'pc', id: 'pc' }], outcome: { result: 'created', summary: '建角完成。' } })
      const naturals: number[] = []
      for (let i = 0; i < 12; i++) naturals.push((await game.act({ kind: 'free', text: `第 ${i} 次` })).reports[0]!.timeline[0]!.roll!.natural)
      return { hash: stateHash(game.state), naturals }
    }
    const a = await play(SEED), b = await play(SEED), c = await play(SEED + 1)
    expect(b).toEqual(a)
    expect(c.naturals).not.toEqual(a.naturals)
    expect(new Set(a.naturals).size).toBeGreaterThan(4)
  })
})
