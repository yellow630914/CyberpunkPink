// 白箱測試：shell/battle.ts（戰鬥結束的任務鏈）與 Game 的戰鬥門面（startBattle、重來、結束）。
// 補主套件沒有走到的分支：鏈定義裡的每一個函式（whens、aiEnabled、aiInput、apply）、AI 關閉與開著的差別、門面的錯誤路徑。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ReportDraft } from '../../src'
import { BATTLE_END_TEMPLATE, NARRATE_BEATS, battleEndChain, clone } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, makeBattleGame, makeGame, observed, playOut, stateHash } from '../../src/testkit'
import { duel, foe, one } from '../helpers/battle'

const chain = battleEndChain()
const ctxOf = (o: Record<string, unknown>) => o as never

describe('白箱 戰鬥結束的鏈（AI_TASKS 3.9 節；dev/adr/0011）', () => {
  it('範本：結算 → 算關係（有具名的人才跑）→ 寫正文 → 套用；寫正文不依賴判定', () => {
    expect(BATTLE_END_TEMPLATE.chain).toBe('battle_end')
    expect(BATTLE_END_TEMPLATE.steps.map((s) => s.id)).toEqual(['settle', 'relate', 'text', 'apply'])
    expect(chain.hasText).toBe(true)
    expect(chain.code).toBe('combat')
    expect(Object.keys(chain.codeSteps!)).toEqual(['battle_settle'])
  })

  it('cast_present：沒有 npcs 功能就是 false（M2 還沒搬進來）；有 npcs 而且場上有 role 是 npc 的角色才是 true', () => {
    const when = chain.whens!.cast_present!
    const state = { battle: { units: { a1: { actor: 'pc' }, f1: { actor: 'n1' }, f2: {} } }, actors: { pc: { role: 'pc' }, n1: { role: 'npc' } } }
    expect(when(ctxOf({ k: { features: [] }, state }))).toBe(false)
    expect(when(ctxOf({ k: { features: ['npcs'] }, state }))).toBe(true)
    const none = { battle: { units: { a1: { actor: 'pc' }, f1: { actor: 'ghost' } } }, actors: { pc: { role: 'pc' } } }
    expect(when(ctxOf({ k: { features: ['npcs'] }, state: none }))).toBe(false)
    expect(when(ctxOf({ k: { features: ['npcs'] }, state: { battle: null, actors: {} } }))).toBe(false)
  })

  it('aiEnabled：寫正文看設定 narrate；別的任務（算關係）一律開著', () => {
    expect(chain.aiEnabled!({ task: 'narrate' } as never, ctxOf({ settings: { narrate: true } }))).toBe(true)
    expect(chain.aiEnabled!({ task: 'narrate' } as never, ctxOf({ settings: { narrate: false } }))).toBe(false)
    expect(chain.aiEnabled!({ task: 'relate' } as never, ctxOf({ settings: { narrate: false } }))).toBe(true)
  })

  it('aiInput：不認得的任務丟錯；寫正文的輸入帶報告的種類、結果的名字（勝利、戰敗、脫離、投降）與引擎算好的 results', () => {
    const draft = { kind: 'combat', action: 'battle.end', party: [], timeline: [{ layer: 'meat', text: '一拍' }], changes: [], outcome: { result: 'weird', summary: '摘要' }, narration: { results: ['拿到：A'] } } as unknown as ReportDraft
    expect(() => chain.aiInput!({ task: 'relate' } as never, ctxOf({ draft: { settle: draft } }))).toThrow(/不認得 relate 這個任務/)
    const input = chain.aiInput!({ task: 'narrate' } as never, ctxOf({ draft: { settle: draft } })) as { mode: string; report: Record<string, unknown>; results: string[] }
    expect(input.mode).toBe('combat')
    expect(input.results).toEqual(['拿到：A'])
    expect(input.report).toMatchObject({ kind: 'combat', action: '戰鬥', outcome: 'weird', result: 'weird', summary: '摘要', timeline: ['一拍'] })
    for (const [id, name] of [['win', '勝利'], ['lose', '戰敗'], ['fled', '脫離'], ['surrender', '投降']] as const) {
      const d = { ...draft, outcome: { result: id, summary: '' } } as ReportDraft
      expect((chain.aiInput!({ task: 'narrate' } as never, ctxOf({ draft: { settle: d } })) as { report: { result: string } }).report.result).toBe(name)
    }
    // 沒有 narration 的草稿：results 是空的；step 指定了 mode 就用它
    const bare = { ...draft, narration: undefined } as ReportDraft
    const o2 = chain.aiInput!({ task: 'narrate', mode: 'polish' } as never, ctxOf({ draft: { settle: bare } })) as { mode: string; results: string[] }
    expect(o2).toMatchObject({ mode: 'polish', results: [] })
  })

  it('aiInput：時間軸太長時保留頭尾、中間寫略過幾拍（AI_TASKS 3.9 節）', () => {
    const { head, tail } = NARRATE_BEATS
    const beats = (n: number) => Array.from({ length: n }, (_, i) => ({ layer: 'meat', text: `b${i}` }))
    const make = (n: number) => ({ kind: 'combat', action: 'x', party: [], timeline: beats(n), changes: [], outcome: { result: 'win', summary: '' } }) as unknown as ReportDraft
    const tl = (n: number) => (chain.aiInput!({ task: 'narrate' } as never, ctxOf({ draft: { settle: make(n) } })) as { report: { timeline: string[] } }).report.timeline
    expect(tl(head + tail)).toHaveLength(head + tail)
    const long = tl(head + tail + 10)
    expect(long).toHaveLength(head + tail + 1)
    expect(long[head]).toBe('（中間略過 10 拍）')
    expect(long[0]).toBe('b0')
    expect(long.at(-1)).toBe(`b${head + tail + 9}`)
  })

  it('apply：潤色過的優先，沒有就用寫正文的；正文是空的就不帶；漏寫的行才帶 uncovered', () => {
    const draft = { kind: 'combat', action: 'battle.end', party: [], timeline: [], changes: [], outcome: { result: 'win', summary: 's' }, narration: { results: ['拿到：A'] } } as unknown as ReportDraft
    const apply = (d: Record<string, unknown>) => chain.apply!(ctxOf({ draft: { settle: draft, ...d } }))
    expect(apply({}).narration).toEqual({ results: ['拿到：A'] })
    expect(apply({ text: { text: '正文', uncovered: [] } }).narration).toEqual({ results: ['拿到：A'], text: '正文' })
    expect(apply({ text: { text: '正文', uncovered: [1] }, polish: { text: '潤色', uncovered: [] } }).narration).toEqual({ results: ['拿到：A'], text: '潤色' })
    expect(apply({ text: { text: '正文', uncovered: [1] } }).narration).toEqual({ results: ['拿到：A'], text: '正文', uncovered: [1] })
    expect(apply({ text: { text: '', uncovered: [] } }).narration).toEqual({ results: ['拿到：A'] })
    expect(apply({ text: { uncovered: [1] } }).narration).toEqual({ results: ['拿到：A'] })
    const noNarration = chain.apply!(ctxOf({ draft: { settle: { ...draft, narration: undefined }, text: { text: 't', uncovered: [] } } }))
    expect(noNarration.narration).toEqual({ text: 't' })
  })
})

describe('白箱 Game 的戰鬥門面（不變式第 3、4、48、57 條）', () => {
  it('startBattle 的 snapshot: false：不留快照、舊的也丟掉；打輸之後沒有可以三選一的東西', async () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.startBattle(BATTLE_SETUPS.hopeless(), { snapshot: false })
    expect(game.state.snapshots).toEqual([])
    playOut(game)
    await game.finishBattle()
    expect(game.pendingDefeat).toBeNull()
    expect(game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
  })

  it('開打時沒有快照又想在打到一半重來：回傳原因、狀態不變', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.startBattle(BATTLE_SETUPS.encounter(), { snapshot: false })
    const before = stateHash(game.state)
    expect(game.retryBattle()).toBe('這一場開打前沒有留快照，不能重來。')
    expect(stateHash(game.state)).toBe(before)
  })

  it('開打時先把上一場留下的快照丟掉（同一時間只留這一場的）；label 用來當回退與快照的名字', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.startBattle(BATTLE_SETUPS.encounter(), { label: '第一場' })
    expect(game.state.snapshots.map((s) => s.label)).toEqual(['第一場'])
    game.state.battle = null
    game.startBattle(BATTLE_SETUPS.encounter(), { label: '第二場' })
    expect(game.state.snapshots.map((s) => s.label)).toEqual(['第二場'])
  })

  it('等著選的戰敗時開另一場被擋下（ActionBlocked），原因寫出來；blockOf 先問得到', async () => {
    const { game } = makeBattleGame({ battle: 'hopeless', seed: 2, features: [TEST_COMBAT] })
    playOut(game)
    await game.finishBattle()
    const why = game.blockOf('battle.start')
    expect(why).toMatch(/先在戰敗的三個選擇裡選一個/)
    expect(() => game.startBattle(BATTLE_SETUPS.encounter())).toThrow(why!)
    expect(game.blockOf('battle.retry')).toBeNull()
    expect(game.blockOf('commit:battle.step')).toMatch(/先在戰敗的三個選擇/)
    expect(game.blockOf('commit:x', { changes: [{ op: 'snapshot.drop', kind: 'battle' }] } as never)).toBeNull()
    expect(game.blockOf('commit:x', { changes: [{ op: 'snapshot.drop', kind: 'other' }] } as never)).not.toBeNull()
  })

  it('戰鬥中 blockOf：只放行戰鬥的事（battle. 開頭、commit:battle.、battle_end 這條鏈）', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    for (const ok of ['battle.retry', 'commit:battle.step', 'chain:battle_end']) expect(game.blockOf(ok), ok).toBeNull()
    for (const no of ['chain:free_action', 'commit:grid.move', 'grid.move', 'grid.enter']) expect(game.blockOf(no), no).toBe('正在戰鬥，先把這一場打完。')
  })

  it('打贏之後不能再「重來」：開打前的快照已經丟掉（不變式第 57 條：不然是沒有步數限制的回退）', async () => {
    const { game } = makeBattleGame({ battle: { ...BATTLE_SETUPS.encounter(), foes: [{ from: 'unit', unit: foe('minion', { hp: { now: 1, max: 1 } }) as never }] }, features: [TEST_COMBAT] })
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(game.state.reports.some((r) => r.action === 'battle.end' && r.outcome.result === 'win')).toBe(true)
    expect(game.state.snapshots).toEqual([])
    expect(game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
  })

  it('打到一半重來：這一場每一步收成一份、標成被收回；紀錄不長出幾十筆（審查 S7）', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT], seed: 5 })
    for (let i = 0; i < 6; i++) game.battleNext({ anyone: true })
    const steps = game.state.battle!.steps.length
    expect(steps).toBeGreaterThan(3)
    const before = game.state.reports.length
    expect(game.retryBattle()).toBeNull()
    const aborted = game.state.reports.filter((r) => r.action === 'battle.abort')
    expect(aborted).toHaveLength(1)
    expect(aborted[0]!.retracted).toBe(true)
    expect(game.state.reports.length).toBeLessThan(before + steps)
    expect(game.battle!.round).toBe(1)
  })

  it('回到這個階段開始時：沒有在等三選一就回傳原因；副本以外（沒有 stage 快照）等於重來（COMBAT_SYSTEM 8.4 節）', async () => {
    const { game } = makeBattleGame({ battle: 'hopeless', seed: 2, features: [TEST_COMBAT] })
    const mid = stateHash(game.state)
    expect(game.rewindToStage()).toBe('現在沒有在等戰敗的選擇。')
    expect(stateHash(game.state)).toBe(mid)
    playOut(game)
    await game.finishBattle()
    expect(game.pendingDefeat).not.toBeNull()
    expect(game.rewindToStage()).toBeNull()
    expect(game.battle).toMatchObject({ round: 1 })
    expect(game.pendingDefeat).toBeNull()
  })

  it('回到這個階段開始時：開打前有 stage 快照就回到最近的那一份（不是 entry），比它晚的快照一起丟掉；快照壞了回傳原因、還在等', async () => {
    const mk = async () => {
      const { game } = makeGame({ seed: 4, features: [TEST_COMBAT] })
      const snap = (id: string, kind: string) => game.commit({ kind: 'system', action: 'wb.snapshot', location: {}, party: [], timeline: [], changes: [{ op: 'snapshot.add', slot: { id, kind, label: id, raw: game.save() } }], outcome: { result: 'ok', summary: id } })
      snap('entry1', 'entry')
      snap('stage1', 'stage')
      game.startBattle(BATTLE_SETUPS.hopeless())
      playOut(game)
      await game.finishBattle()
      return game
    }
    const game = await mk()
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage', 'battle'])
    expect(game.rewindToStage()).toBeNull()
    expect(game.state.snapshots.map((s) => s.id)).toEqual(['entry1'])
    expect(game.pendingDefeat).toBeNull()
    expect(game.battle).toBeNull()
    expect(game.state.reports.at(-1)).toMatchObject({ action: 'rewind', outcome: { summary: '你回到這個階段開始的時候。' } })

    const broken = await mk()
    broken.state.snapshots.find((s) => s.id === 'stage1')!.raw = 'this is not a save'
    const before = stateHash(broken.state)
    expect(broken.rewindToStage()).toBeTypeOf('string')
    expect(stateHash(broken.state)).toBe(before)
    expect(broken.pendingDefeat).not.toBeNull()
  })

  it('重來時快照壞掉（raw 被破壞）：整件事不成立，連「收成一份」也收回去；狀態完全不變（不變式第 3 條）', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT], seed: 5 })
    for (let i = 0; i < 4; i++) game.battleNext({ anyone: true })
    game.state.snapshots[0]!.raw = 'this is not a save'
    const before = stateHash(game.state)
    const err = game.retryBattle()
    expect(err).toBeTypeOf('string')
    expect(stateHash(game.state)).toBe(before)
    expect(game.battle).not.toBeNull()
  })

  it('重來時鏈還在跑：回傳原因、不動', async () => {
    const { game } = makeBattleGame({ battle: 'hopeless', seed: 2, fake: { latencyMs: 50 } as never, features: [TEST_COMBAT] })
    playOut(game)
    const p = game.finishBattle()
    expect(game.retryBattle()).toBe('上一條任務鏈還在跑。')
    await p
  })

  it('戰鬥的每一步在鏈還在跑時不能做（丟錯，不是被擋下）', async () => {
    const { game } = makeBattleGame({ battle: 'hopeless', seed: 2, fake: { latencyMs: 50 } as never, features: [TEST_COMBAT] })
    playOut(game)
    const p = game.finishBattle()
    expect(() => game.battleNext({ anyone: true })).toThrow(/上一條任務鏈還在跑/)
    await p
  })

  it('讀檔：進行中的戰鬥照提交的檢查驗；戰場在這一局的內容裡查不到的整筆不讀（不變式第 61 條）', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    const raw = game.save()
    expect(game.load(raw)).toBeNull()
    const other = makeGame({ features: [TEST_COMBAT] }).game
    const broken = clone(game.state)
    broken.battle!.mode = 'void'
    const saved = (() => {
      const g = makeGame({ features: [TEST_COMBAT] }).game
      Object.assign(g.state, { battle: broken.battle })
      return g.save()
    })()
    const err = other.load(saved)
    expect(err).toBeTypeOf('string')
    expect(other.battle).toBeNull()
    expect(other.load('{not json')).toBeTypeOf('string')
  })

  it('一整場照種子重播得到同樣的結果（不變式第 5、47 條）：兩局同種子逐步一樣', () => {
    const run = (seed: number) => {
      const { game } = makeBattleGame({ battle: { ...duel([one({ weapon: 'smg' })], [foe(), foe()]), cover: 'medium' }, features: [TEST_COMBAT], seed })
      return { r: playOut(game), hash: stateHash(game.state) }
    }
    expect(run(11)).toEqual(run(11))
  })

  it('observed：開打、玩家的一步、AI 的一步、結束都沒有違反不變式', async () => {
    const { game } = makeBattleGame({ battle: 'hopeless', seed: 2, features: [TEST_COMBAT] })
    const { violations } = await observed(game, async () => {
      playOut(game)
      return game.finishBattle()
    })
    expect(violations).toEqual([])
  })
})
