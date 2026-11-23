// 驗收測試：dev/work/M2-core-activity.md（活動的登錄表 k.activity、掛點 activity.end、報告的 launch、Game.blockOf 問登錄表）。
// 規格：dev/adr/0016 第一、二節；dev/adr/0014「等著選的戰敗由核心擋」（戰鬥與戰敗被擋下的句子與時機原樣不動）。
// 內容一律用測試自帶的最小假資料；活動用 testkit 的玩具活動（TEST_ACTIVITY）與測試自己定義的幾個。

import { describe, expect, it } from 'vitest'
import type { ActivityDef, ActivityEndReturn, ContentPack, Feature, GameState, GridEffect, Kernel, ReportDraft, SpecialMapEntry } from '../../src'
import { ActionBlocked, MAX_LAUNCH_DEPTH, attachActivityEnd, clone, createKernel, endActivity, installFeature, readyFeatures, unpackSave } from '../../src'
import { actionsFeature } from '../../src/features/actions'
import { BATTLE_SETUPS, TEST_ACTIVITY, TEST_COMBAT, makeBattleGame, makeGame, observed, playOut, stateHash, toyEnd, toyOf, toyStep } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

type G = ReturnType<typeof makeGame>['game']

const BUSY = '玩具活動進行中，先把它做完。'
const FIGHTING = '正在戰鬥，先把這一場打完。'
const WAITING = '先在戰敗的三個選擇裡選一個：接受結果、重來這場戰鬥，或回到這個階段開始時。'

const note = (extra: Partial<ReportDraft> = {}, changes: ReportDraft['changes'] = [{ op: 'flag', key: 'noted', value: true }]): ReportDraft => ({
  kind: 'system', action: 'test.note', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '記一筆。' }, ...extra,
})
const toyLaunch = (setup: unknown = {}, by = 'test'): NonNullable<ReportDraft['launch']> => [{ kind: 'toy', setup, origin: { by, ref: 'q1' } }]

/** 一份狀態的整份複製：之後和 game.state 整份比對（toEqual），不是只比雜湊。 */
const snap = (g: G): GameState => clone(g.state)

/** 把正在打的戰鬥直接定案（測試用：不必真的打完；之後的每一步照常經過提交），再結算。 */
const decide = (g: G, outcome: string): void => {
  const b = clone(g.state.battle!)
  b.result = { outcome, text: '結束。' }
  g.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: outcome, summary: '結束。' } }, { attach: true, turn: false })
}

describe('登錄表：define、allow、active、blockOf（dev/adr/0016 第一節）', () => {
  it('核心內建兩筆：battle（order 0）、defeat（order 10）；每次登記發探針的 registry.register', () => {
    const k = createKernel()
    expect(k.activity.list().map((d) => [d.kind, d.owner, d.order])).toEqual([['battle', 'core', 0], ['defeat', 'core', 10]])
    k.probe.start()
    installFeature(k, TEST_ACTIVITY)
    k.activity.allow('toy', 'trade.', 'trade')
    k.activity.allow('late', 'x.', 'early')
    const events = k.probe.stop().filter((e) => e.type === 'registry.register' && e.source === 'core/action/activity')
    expect(events.map((e) => e.data)).toEqual([
      { registry: 'activity', id: 'toy', owner: 'toy' },
      { registry: 'activity.allow', id: 'toy', owner: 'trade', prefix: 'trade.' },
      { registry: 'activity.allow', id: 'late', owner: 'early', prefix: 'x.' },
    ])
  })

  it('同一個 kind 重複登記丟錯，訊息寫出是誰登記的；核心的 battle 也不能被蓋掉', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    const dup: ActivityDef = { kind: 'toy', owner: 'other', order: 1, active: () => null, allow: [], reason: () => '' }
    expect(() => game.k.activity.define(dup)).toThrow('活動重複登記：toy（已經由 toy 登記）')
    expect(() => game.k.activity.define({ ...dup, kind: 'battle' })).toThrow('活動重複登記：battle（已經由 core 登記）')
  })

  /** 兩個活動各由一面旗標決定進行中與否；甲 order 5、乙 order 3（乙先問）。 */
  const DUO: Feature = {
    id: 'duo',
    install(k) {
      k.activity.define({ kind: 'alpha', owner: 'duo', order: 5, active: (s) => (s.flags.alpha ? { id: 'a1', label: '甲' } : null), allow: ['a.', 'both.'], allows: (_s, _d, draft) => draft?.action === 'special', reason: () => '甲還沒結束。' })
      k.activity.define({ kind: 'beta', owner: 'duo', order: 3, active: (s) => (s.flags.beta ? { id: 'b1', label: '乙' } : null), allow: ['b.', 'both.'], reason: () => '乙還沒結束。' })
    },
  }
  const duo = (flags: { alpha?: boolean; beta?: boolean }): G => {
    const { game } = makeGame({ features: [DUO] })
    Object.assign(game.state.flags, flags)
    return game
  }

  it('active：進行中的活動照 order（小的先），帶 id 與一句話；一個都沒有是空的', () => {
    const none = duo({})
    expect(none.k.activity.active(none.state)).toEqual([])
    const g = duo({ alpha: true, beta: true })
    expect(g.k.activity.active(g.state)).toEqual([{ kind: 'beta', owner: 'duo', id: 'b1', label: '乙' }, { kind: 'alpha', owner: 'duo', id: 'a1', label: '甲' }])
    const only = duo({ alpha: true })
    expect(only.k.activity.active(only.state).map((a) => a.kind)).toEqual(['alpha'])
  })

  it('兩個活動同時進行：兩個都放行才過；先問 order 小的，原因是第一個不放行的那一句', () => {
    const g = duo({ alpha: true, beta: true })
    expect(g.blockOf('both.x')).toBeNull()
    expect(g.blockOf('a.x')).toBe('乙還沒結束。') // 甲放行、乙不放行
    expect(g.blockOf('b.x')).toBe('甲還沒結束。') // 乙放行、甲不放行
    expect(g.blockOf('z.x')).toBe('乙還沒結束。') // 兩個都不放行：order 小的乙先問
    // 只有一個進行中：只問它
    expect(duo({ alpha: true }).blockOf('b.x')).toBe('甲還沒結束。')
    expect(duo({ beta: true }).blockOf('a.x')).toBe('乙還沒結束。')
    expect(duo({}).blockOf('z.x')).toBeNull()
  })

  it('白名單：沒登記放行的 doing 一律被擋；前綴之外的特例（allows）看報告草稿', () => {
    const g = duo({ alpha: true })
    expect(g.blockOf('commit:anything.new')).toBe('甲還沒結束。')
    expect(g.blockOf('chain:free_action')).toBe('甲還沒結束。')
    expect(g.blockOf('commit:special', { action: 'special' } as unknown as ReportDraft)).toBeNull()
    expect(g.blockOf('commit:other', { action: 'other' } as unknown as ReportDraft)).toBe('甲還沒結束。')
    expect(() => g.commit(note())).toThrow(ActionBlocked)
    try { g.commit(note()) } catch (e) { expect((e as ActionBlocked).reason).toBe('甲還沒結束。') }
  })

  it('order 一樣的照登記的順序問', () => {
    const f: Feature = {
      id: 'tie',
      install(k) {
        const base = { owner: 'tie', order: 7, allow: [] as string[] }
        k.activity.define({ ...base, kind: 'first', active: () => ({ id: '1', label: '先' }), reason: () => '先登記的。' })
        k.activity.define({ ...base, kind: 'second', active: () => ({ id: '2', label: '後' }), reason: () => '後登記的。' })
      },
    }
    const { game } = makeGame({ features: [f] })
    expect(game.blockOf('x')).toBe('先登記的。')
  })

  it('allow 加的前綴生效：別的功能把自己的 doing 加進某個活動的放行清單', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    game.commit(note({ launch: toyLaunch() }))
    expect(game.blockOf('commit:trade.checkout')).toBe(BUSY)
    game.k.activity.allow('toy', 'commit:trade.', 'trade')
    expect(game.blockOf('commit:trade.checkout')).toBeNull()
    expect(game.blockOf('commit:trade')).toBe(BUSY) // 前綴是 startsWith：commit:trade 不以 commit:trade. 開頭
    expect(game.blockOf('commit:bill.pay')).toBe(BUSY)
  })

  it('對還沒登記的種類先 allow、後 define 也生效；始終沒有人登記的就當沒這回事', () => {
    const early: Feature = { id: 'early', install: (k) => { k.activity.allow('late', 'commit:early.', 'early'); k.activity.allow('never', 'commit:never.', 'early') } }
    const late: Feature = {
      id: 'late',
      install: (k) => k.activity.define({ kind: 'late', owner: 'late', order: 40, active: (s) => (s.flags.late ? { id: 'l', label: '晚' } : null), allow: ['late.'], reason: () => '晚登記的活動進行中。' }),
    }
    const { game } = makeGame({ features: [early, late] })
    expect(game.blockOf('commit:early.go')).toBeNull() // 還沒進行中
    game.state.flags.late = true
    expect(game.blockOf('commit:early.go')).toBeNull() // 先 allow 的前綴併進去了
    expect(game.blockOf('late.x')).toBeNull() // 自己的前綴還在
    expect(game.blockOf('commit:never.go')).toBe('晚登記的活動進行中。') // 對沒人登記的 never 的 allow 不影響別人
    expect(game.k.activity.get('never')).toBeUndefined()
    expect(game.k.activity.active(game.state).map((a) => a.kind)).toEqual(['late'])
  })

  it('同一個定義物件登記在好幾個核心上，彼此的 allow 不互相影響', () => {
    const a = makeGame({ features: [TEST_ACTIVITY] }).game
    const b = makeGame({ features: [TEST_ACTIVITY] }).game
    a.k.activity.allow('toy', 'commit:trade.', 'trade')
    a.commit(note({ launch: toyLaunch() }))
    b.commit(note({ launch: toyLaunch() }))
    expect(a.blockOf('commit:trade.checkout')).toBeNull()
    expect(b.blockOf('commit:trade.checkout')).toBe(BUSY)
  })

  it('start：沒有這種活動、或它沒有 start，丟 ActionBlocked，句子寫出是哪一種', () => {
    const noStart: Feature = { id: 'ns', install: (k) => k.activity.define({ kind: 'sealed', owner: 'ns', order: 50, active: () => null, allow: [], reason: () => '' }) }
    const { game } = makeGame({ features: [TEST_ACTIVITY, noStart] })
    const start = (kind: string) => game.k.activity.start(game.k, game.state, kind, {})
    expect(() => start('nope')).toThrow(ActionBlocked)
    expect(() => start('nope')).toThrow('沒有「nope」這種活動，開不起來。')
    expect(() => start('sealed')).toThrow('「sealed」這種活動不能從外面開始。')
    // 開得成的：純函式，回傳草稿、不改狀態；沒給 origin 就是核心開的
    const before = stateHash(game.state)
    const drafts = start('toy')
    expect(drafts.map((d) => d.action)).toEqual(['toy.start'])
    expect(stateHash(game.state)).toBe(before)
    expect((drafts[0]!.changes.find((c) => c.op === 'ext')!.value as { origin: unknown }).origin).toEqual({ by: 'core' })
  })
})

describe('戰鬥與戰敗是核心內建的兩筆：Game.blockOf 只剩問登錄表，句子與時機一字不差（不變式第 48、59 條；dev/adr/0014）', () => {
  it('戰鬥中：只放行戰鬥的事；其餘原因是「正在戰鬥，先把這一場打完。」', () => {
    const { game } = makeBattleGame()
    expect(game.k.activity.active(game.state)).toEqual([{ kind: 'battle', owner: 'core', id: game.state.battle!.id, label: '戰鬥' }])
    for (const ok of ['battle.retry', 'battle.start', 'commit:battle.step', 'commit:battle.end', 'chain:battle_end']) expect(game.blockOf(ok), ok).toBeNull()
    for (const no of ['chain:free_action', 'commit:grid.move', 'commit:gear.equip', 'grid.move', 'grid.enter', 'toy.start', 'rewind:stage']) expect(game.blockOf(no), no).toBe(FIGHTING)
    expect(game.blockOf('chain:battle_end_x')).toBe(FIGHTING) // chain:battle_end 是整句比對，不是前綴
  })

  it('等著選的戰敗：只放行重來與一份丟掉開打前快照的報告；其餘原因是三個選擇那一句', async () => {
    const t = makeBattleGame({ battle: 'hopeless', seed: 2 })
    playOut(t.game)
    await t.game.finishBattle()
    const { game } = t
    expect(game.pendingDefeat).not.toBeNull()
    expect(game.k.activity.active(game.state)).toEqual([{ kind: 'defeat', owner: 'core', id: game.pendingDefeat!.snapshot, label: '戰敗的三個選擇' }])
    expect(game.blockOf('battle.retry')).toBeNull()
    expect(game.blockOf('commit:x', { changes: [{ op: 'snapshot.drop', kind: 'battle' }] } as unknown as ReportDraft)).toBeNull()
    for (const no of ['chain:free_action', 'commit:battle.step', 'battle.start', 'grid.move', 'toy.start']) expect(game.blockOf(no), no).toBe(WAITING)
    expect(game.blockOf('commit:x', { changes: [{ op: 'snapshot.drop', kind: 'stage' }] } as unknown as ReportDraft)).toBe(WAITING)
    expect(game.blockOf('commit:x', { changes: [] } as unknown as ReportDraft)).toBe(WAITING)
    expect(() => game.startBattle(BATTLE_SETUPS.encounter())).toThrow(WAITING)
    expect(() => game.launch('toy', {})).toThrow(WAITING)
  })

  it('沒有活動時什麼都放行', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    expect(game.k.activity.active(game.state)).toEqual([])
    for (const doing of ['commit:anything', 'chain:free_action', 'grid.move', 'x.start']) expect(game.blockOf(doing)).toBeNull()
  })
})

describe('報告帶 launch：提交之後接著開（dev/adr/0016 第二節）', () => {
  it('提交之後玩具活動進行中，開始的報告在紀錄裡、緊接在那份報告後面；和那份報告是同一步回退', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    const before = snap(game)
    const steps = game.undo.size
    const reports = game.commit(note({ launch: toyLaunch({ goal: 3 }) }))
    expect(reports.map((r) => r.action)).toEqual(['test.note', 'toy.start'])
    expect(toyOf(game.state)).toMatchObject({ id: 'y1', steps: 0, goal: 3, origin: { by: 'test', ref: 'q1' } })
    expect(game.state.flags.noted).toBe(true)
    expect(game.state.reports.slice(-2).map((r) => r.action)).toEqual(['test.note', 'toy.start'])
    expect(game.state.reports.slice(-2)[0]!.launch).toEqual(toyLaunch({ goal: 3 })) // 紀錄裡留著那份報告當初要開什麼
    // 進行中：別的事被擋、自己的事放行
    expect(game.blockOf('commit:test.note')).toBe(BUSY)
    expect(() => game.commit(note())).toThrow(BUSY)
    expect(game.commit(toyStep(game.state))[0]!.action).toBe('toy.step')
    // 同一步回退：兩份報告與活動的狀態一起回去（最新的那一步 toy.step 先回退）
    expect(game.undo.size).toBe(steps + 2)
    expect(game.undoSteps(2)).toBe(true)
    expect(game.state).toEqual(before)
    expect(toyOf(game.state)).toBeNull()
  })

  it('不另算一個回合：turn.end 只跑一次（那份報告自己的），開始的報告不再觸發', () => {
    let turns = 0
    const counter: Feature = { id: 'counter', install: (k) => k.hooks.on('turn.end', 'counter', () => { turns += 1 }) }
    const { game } = makeGame({ features: [TEST_ACTIVITY, counter] })
    game.commit(note({ launch: toyLaunch() }))
    expect(turns).toBe(1)
    expect(game.undo.size).toBe(1)
  })

  it('一份報告好幾個 launch 照順序開；開出來的報告自己再帶的 launch 接著開', () => {
    const relay: Feature = {
      id: 'relay',
      install: (k) => k.activity.define({
        kind: 'relay', owner: 'relay', order: 60, active: () => null, allow: [],
        reason: () => '',
        start: (_k, _s, setup) => {
          const left = (setup as { left: number }).left
          return [{ kind: 'event', action: 'relay.start', location: {}, party: [], timeline: [], changes: [{ op: 'counter', key: 'relay', delta: 1 }], outcome: { result: 'ok', summary: `接力 ${left}。` }, ...(left > 0 ? { launch: [{ kind: 'relay', setup: { left: left - 1 } }] } : {}) }]
        },
      }),
    }
    const { game } = makeGame({ features: [relay] })
    const reports = game.commit(note({ launch: [{ kind: 'relay', setup: { left: 1 } }, { kind: 'relay', setup: { left: 0 } }] }))
    // 深度優先：第一個 launch 連它自己帶出來的一起開完，再開第二個
    expect(reports.map((r) => r.outcome.summary)).toEqual(['記一筆。', '接力 1。', '接力 0。', '接力 0。'])
    expect(game.state.counters.relay).toBe(3)
  })

  it(`連開超過 ${MAX_LAUNCH_DEPTH} 層丟錯，狀態不動；剛好 ${MAX_LAUNCH_DEPTH} 層可以`, () => {
    const relay: Feature = {
      id: 'relay',
      install: (k) => k.activity.define({
        kind: 'relay', owner: 'relay', order: 60, active: () => null, allow: [], reason: () => '',
        start: (_k, _s, setup) => {
          const left = (setup as { left: number }).left
          return [{ kind: 'event', action: 'relay.start', location: {}, party: [], timeline: [], changes: [{ op: 'counter', key: 'relay', delta: 1 }], outcome: { result: 'ok', summary: '接力。' }, ...(left > 0 ? { launch: [{ kind: 'relay', setup: { left: left - 1 } }] } : {}) }]
        },
      }),
    }
    const { game } = makeGame({ features: [relay] })
    const before = snap(game)
    const steps = game.undo.size
    // 要開的第 1 層是 left 3，一路到 left 0 是第 4 層：剛好
    expect(game.commit(note({ launch: [{ kind: 'relay', setup: { left: MAX_LAUNCH_DEPTH - 1 } }] })).length).toBe(1 + MAX_LAUNCH_DEPTH)
    expect(game.state.counters.relay).toBe(MAX_LAUNCH_DEPTH)
    const mid = snap(game)
    expect(() => game.commit(note({ launch: [{ kind: 'relay', setup: { left: MAX_LAUNCH_DEPTH } }] }))).toThrow(`活動連開超過 ${MAX_LAUNCH_DEPTH} 層`)
    expect(game.state).toEqual(mid)
    expect(game.undo.size).toBe(steps + 1)
    expect(game.state).not.toEqual(before)
  })

  it('報告的 triggers 與 adult 只是記在報告上（紀錄裡看得到），外殼不做事', () => {
    const { game } = makeGame()
    const triggers = [{ point: 'street.move', where: { district: 'rustbelt' } }, { point: 'daily' }]
    const [r] = game.commit(note({ triggers, adult: true }))
    expect(r).toMatchObject({ triggers, adult: true })
    expect(game.state.reports.at(-1)).toMatchObject({ triggers, adult: true })
    expect(game.state.flags.noted).toBe(true)
  })
})

describe('launch 開不成：整步不成立（不變式：活動開不成，狀態與回退的步數都不動）', () => {
  /** 一道牆：進行中時只放行 commit:test. 開頭的報告，所以那份報告提交得進去，但它要開的 toy.start 被牆擋下。 */
  const WALL: Feature = {
    id: 'wall',
    install: (k) => k.activity.define({ kind: 'wall', owner: 'wall', order: 5, active: (s) => (s.flags.wall ? { id: 'w', label: '牆' } : null), allow: ['commit:test.'], reason: () => '牆還立著，不能開始新的活動。' }),
  }
  const NOSTART: Feature = { id: 'ns', install: (k) => k.activity.define({ kind: 'sealed', owner: 'ns', order: 50, active: () => null, allow: [], reason: () => '' }) }
  const setup = () => makeGame({ features: [TEST_ACTIVITY, WALL, NOSTART, TEST_COMBAT] }).game

  /** 提交 draft 必須失敗：丟 ActionBlocked，reason 是 want；狀態整份一樣、能回退的步數不變、沒有留報告。 */
  const refuses = (g: G, draft: ReportDraft, want: string, opts: Parameters<G['commit']>[1] = {}): void => {
    const before = snap(g)
    const steps = g.undo.size
    let err: unknown
    try { g.commit(draft, opts) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ActionBlocked)
    expect((err as ActionBlocked).reason).toBe(want)
    expect(g.state).toEqual(before)
    expect(g.undo.size).toBe(steps)
    expect(g.state.flags.noted).toBeUndefined()
  }

  it('活動自己開不成：丟出來的原因是活動給的那幾句（一條一句接起來）', () => {
    const g = setup()
    refuses(g, note({ launch: toyLaunch({ refuse: ['玩具活動的錢不夠。', '玩具活動的人不夠。'] }) }), '玩具活動的錢不夠。玩具活動的人不夠。')
    refuses(g, note({ launch: toyLaunch({ refuse: ['不夠。'] }) }), '不夠。', { attach: true })
    refuses(g, note({ launch: toyLaunch({ refuse: ['不夠。'] }) }), '不夠。', { turn: false })
  })

  it('沒有這種活動、或它沒有 start：句子寫出是哪一種', () => {
    const g = setup()
    refuses(g, note({ launch: [{ kind: 'nope', setup: {} }] }), '沒有「nope」這種活動，開不起來。')
    refuses(g, note({ launch: [{ kind: 'sealed', setup: {} }] }), '「sealed」這種活動不能從外面開始。')
  })

  it('別的活動不放行 <種類>.start：被擋下，原因是那個活動的（launch 也走白名單）', () => {
    const g = setup()
    g.state.flags.wall = true
    refuses(g, note({ launch: toyLaunch() }), '牆還立著，不能開始新的活動。')
  })

  it('一份報告兩個 launch，第一個開成、第二個開不成：整步都不成立（第一個也不留）', () => {
    const g = setup()
    refuses(g, note({ launch: [...toyLaunch(), ...toyLaunch()] }), '已經有一個玩具活動在進行。')
    expect(toyOf(g.state)).toBeNull()
  })

  it('回合結束的流程帶出來的報告帶的 launch 也算這一步；開不成整步不成立（連回合結束的報告都不留）', () => {
    const follow: Feature = {
      id: 'follow',
      install: (k) => k.hooks.on('turn.end', 'follow', ({ report }) => (report.action === 'test.note' ? [note({ action: 'test.follow', launch: toyLaunch({ refuse: ['開不成。'] }) }, [{ op: 'flag', key: 'followed', value: true }])] : undefined)),
    }
    const g = makeGame({ features: [TEST_ACTIVITY, follow] }).game
    refuses(g, note(), '開不成。')
    expect(g.state.flags.followed).toBeUndefined()
  })

  it('開戰開不成（設定壞掉、已經有一場在打）：整步不成立，原因寫出來', () => {
    const g = setup()
    refuses(g, note({ launch: [{ kind: 'battle', setup: { allies: [], foes: [] } }] }), '這場戰鬥開不起來（雙方都要有人上場。）。')
    refuses(g, note({ launch: [{ kind: 'battle', setup: 'x' }] }), '這場戰鬥開不起來（開戰的設定要寫雙方上場的人）。')
    refuses(g, note({ launch: [{ kind: 'battle', setup: { ...BATTLE_SETUPS.encounter(), mode: 'nope' } }] }), '這場戰鬥開不起來（沒有 nope 這個戰場）。')
    expect(g.state.snapshots).toEqual([])
    expect(g.state.battle).toBeNull()
  })

  it('Game.launch：同樣的失敗，狀態與回退的步數都不動', () => {
    const g = setup()
    const before = snap(g)
    const steps = g.undo.size
    expect(() => g.launch('toy', { refuse: ['不夠。'] })).toThrow('不夠。')
    expect(() => g.launch('nope', {})).toThrow('沒有「nope」這種活動，開不起來。')
    g.state.flags.wall = true
    expect(() => g.launch('toy', {})).toThrow('牆還立著，不能開始新的活動。')
    delete g.state.flags.wall
    expect(g.state).toEqual(before)
    expect(g.undo.size).toBe(steps)
  })
})

describe('Game.launch：對外的入口（先問 <種類>.start）', () => {
  it('開一段活動：留一步回退、回傳開始的報告；origin 原樣記在活動裡', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    const before = snap(game)
    const reports = game.launch('toy', { goal: 1 }, { by: 'ui', ext: { from: 'menu' } })
    expect(reports.map((r) => r.action)).toEqual(['toy.start'])
    expect(toyOf(game.state)).toMatchObject({ goal: 1, origin: { by: 'ui', ext: { from: 'menu' } } })
    expect(game.undo.size).toBe(1)
    expect(game.undoSteps(1)).toBe(true)
    expect(game.state).toEqual(before)
  })

  it('先問放行：別的活動進行中就被擋下，原因是它的；已經有一個玩具活動時玩具自己開不成', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY, TEST_COMBAT] })
    game.launch('toy', {})
    expect(() => game.launch('toy', {})).toThrow('已經有一個玩具活動在進行。')
    const t = makeBattleGame()
    expect(() => t.game.launch('toy', {})).toThrow(FIGHTING)
  })

  it('開出來的報告自己帶的 launch 接著開；開一場戰鬥走原本的 startBattle（有開打前的快照）', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY, TEST_COMBAT] })
    // 玩具活動開成之後自己不放行 battle.start（白名單）：要開戰的活動得先登記
    game.k.activity.allow('toy', 'battle.start', 'test')
    const reports = game.launch('toy', { then: [{ kind: 'battle', setup: BATTLE_SETUPS.encounter(), origin: { by: 'toy' } }] })
    expect(reports.map((r) => r.action)).toEqual(['toy.start', 'battle.start'])
    expect(game.state.battle).not.toBeNull()
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['battle'])
    expect(game.state.battle!.origin.ext).toEqual({ by: 'toy' })
    expect(game.undo.size).toBe(1)
    // 對照：沒登記放行的話，玩具活動擋住它自己要開的戰鬥，整步不成立
    const g2 = makeGame({ features: [TEST_ACTIVITY, TEST_COMBAT] }).game
    expect(() => g2.launch('toy', { then: [{ kind: 'battle', setup: BATTLE_SETUPS.encounter() }] })).toThrow(BUSY)
    expect(toyOf(g2.state)).toBeNull()
  })
})

describe('launch 一場戰鬥：開打前的快照照舊；origin 的鍵併進 battle.origin.ext', () => {
  const ORIGIN = { by: 'test', ref: 'q1', ext: { commission: 'c1', stage: 2, face: 'meat' } }
  const open = (): G => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.commit(note({ launch: [{ kind: 'battle', setup: BATTLE_SETUPS.encounter(), origin: ORIGIN }] }))
    return game
  }

  it('提交之後戰鬥開著；origin 的 by、ref 與 ext 在 battle.origin.ext，設定自己寫的 origin 其餘欄位還在', () => {
    const game = open()
    expect(game.state.battle).not.toBeNull()
    expect(game.state.battle!.origin).toMatchObject({ escapable: true, place: '測試用的倉庫' })
    expect(game.state.battle!.origin.ext).toEqual({ by: 'test', ref: 'q1', commission: 'c1', stage: 2, face: 'meat' })
    expect(game.state.reports.slice(-2).map((r) => r.action)).toEqual(['test.note', 'battle.start'])
  })

  it('設定自己寫的 origin.ext 保留；launch 的 origin 蓋過同名的鍵，by 與 ref 以頂層的為準', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    const setup = { ...BATTLE_SETUPS.encounter(), origin: { escapable: false, ext: { keep: 1, stage: 1, by: '舊的' } } }
    game.commit(note({ launch: [{ kind: 'battle', setup, origin: { by: 'test', ext: { stage: 2, by: '想蓋掉的' } } }] }))
    expect(game.state.battle!.origin.escapable).toBe(false)
    expect(game.state.battle!.origin.ext).toEqual({ keep: 1, stage: 2, by: 'test' })
  })

  it('有開打前的快照：存的是開打之前、那份報告之後的狀態；快照裡記著重來要用的設定（含 origin）', () => {
    const game = open()
    const slot = game.state.snapshots.find((s) => s.kind === 'battle')!
    expect(slot).toBeDefined()
    expect((slot.data!.setup as { origin: { ext: unknown } }).origin.ext).toEqual({ by: 'test', ref: 'q1', commission: 'c1', stage: 2, face: 'meat' })
    const then = unpackSave(slot.raw)
    expect(then.ok).toBe(true)
    const s = (then as { ok: true; file: { state: GameState } }).file.state
    expect(s.battle).toBeNull()
    expect(s.flags.noted).toBe(true) // 發起的那份報告已經套用
    expect(s.reports.at(-1)!.action).toBe('test.note')
    expect(s.snapshots).toEqual([]) // 快照裡不再包快照
  })

  it('和那份報告是同一步回退：回退就回到提交之前；沒有 launch 的原本寫法（Game.startBattle）不變', () => {
    const game = open()
    expect(game.undo.size).toBe(1)
    expect(game.undoSteps(1)).toBe(true)
    expect(game.state.battle).toBeNull()
    expect(game.state.flags.noted).toBeUndefined()
    expect(game.state.snapshots).toEqual([])
    game.startBattle(BATTLE_SETUPS.encounter())
    expect(game.state.battle!.origin.ext).toBeUndefined()
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['battle'])
  })

  it('重來這場戰鬥之後 origin 還在（快照裡記的是併過 origin 的設定）', () => {
    const game = open()
    expect(game.retryBattle()).toBeNull()
    expect(game.state.battle!.origin.ext).toEqual({ by: 'test', ref: 'q1', commission: 'c1', stage: 2, face: 'meat' })
  })

  it('沒給 origin：by 是 core', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.commit(note({ launch: [{ kind: 'battle', setup: BATTLE_SETUPS.encounter() }] }))
    expect(game.state.battle!.origin.ext).toEqual({ by: 'core' })
  })

  it('已經有一場在打：launch 開戰開不成，原因寫出來，狀態不變', () => {
    const { game } = makeBattleGame()
    const before = snap(game)
    expect(() => game.launch('battle', BATTLE_SETUPS.encounter())).toThrow('這場戰鬥開不起來（已經有一場戰鬥在進行。）。')
    expect(game.state).toEqual(before)
  })
})

describe('activity.end：戰鬥結算發它（kind battle），處理函式回傳的東西併進 battle.end 那一份（dev/adr/0016 第一節）', () => {
  type Seen = { kind: string; id: string; outcome: string; origin: unknown; result: unknown }
  const listener = (seen: Seen[], ret: (p: Seen) => ActivityEndReturn | void): Feature => ({
    id: 'listener',
    install: (k) => k.hooks.on('activity.end', 'listener', (p) => {
      seen.push({ kind: p.kind, id: p.id, outcome: p.outcome, origin: p.origin, result: p.result })
      return ret(seen.at(-1)!)
    }),
  })
  const run = async (features: Feature[], outcome = 'win') => {
    const t = makeGame({ features: [TEST_COMBAT, TEST_ACTIVITY, ...features] })
    t.game.commit(note({ launch: [{ kind: 'battle', setup: BATTLE_SETUPS.encounter(), origin: { by: 'test', ref: 'q1', ext: { commission: 'c1', stage: 2 } } }] }))
    decide(t.game, outcome)
    return { ...t, result: await t.game.finishBattle() }
  }

  it('處理函式拿到 { kind, id, origin, outcome, result }：origin 取自 battle.origin.ext，result 是戰鬥的 id、等級與每一方還站著的人數', async () => {
    const seen: Seen[] = []
    await run([listener(seen, () => undefined)])
    expect(seen).toEqual([{
      kind: 'battle', id: 'b1', outcome: 'win',
      origin: { by: 'test', ref: 'q1', ext: { commission: 'c1', stage: 2 } },
      result: { battle: 'b1', grade: 1, standing: { ally: 4, foe: 4 } },
    }])
  })

  it('沒有 by（不是活動開的）：origin.by 是 core；倒下的人不算站著', async () => {
    const seen: Seen[] = []
    const t = makeGame({ features: [TEST_COMBAT, listener(seen, () => undefined)] })
    t.game.startBattle(BATTLE_SETUPS.encounter())
    const b = clone(t.game.state.battle!)
    const waiting = (side: string) => Object.values(b.units).filter((u) => u.side === side && u.id !== b.order[b.turn])
    for (const u of waiting('foe').slice(0, 2)) u.out = 'down'
    for (const u of waiting('ally').slice(0, 1)) u.out = 'down'
    b.result = { outcome: 'win', text: '結束。' }
    t.game.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: 'win', summary: '結束。' } }, { attach: true, turn: false })
    await t.game.finishBattle()
    expect(seen[0]).toMatchObject({ origin: { by: 'core' }, result: { standing: { ally: 3, foe: 2 } } })
  })

  it('回傳的變更在 battle.end 那一份裡（接在功能的變更後面）；句子進結果與摘要', async () => {
    const seen: Seen[] = []
    const t = await run([listener(seen, () => ({ changes: [{ op: 'flag', key: 'ended', value: true }], lines: ['監聽的人留了一句'] }))])
    expect(t.result.status).toBe('applied')
    const end = t.result.reports.find((r) => r.action === 'battle.end')!
    expect(end.changes.some((c) => c.op === 'flag' && c.key === 'ended')).toBe(true)
    // 在 battle 的收尾（fold）之前：和功能自己的變更同一段
    const ops = end.changes.map((c) => c.op)
    expect(ops.indexOf('flag')).toBeLessThan(ops.indexOf('battle'))
    expect(end.narration?.results).toContain('監聽的人留了一句')
    expect(end.outcome.summary).toContain('監聽的人留了一句。')
    expect(t.game.state.flags.ended).toBe(true)
    expect(t.game.state.battle).toBeNull()
  })

  it('回傳的 launch 在結算提交之後開起來：battle.end 在前、開始的報告在後，狀態裡戰鬥已經結束', async () => {
    const seen: Seen[] = []
    const t = await run([listener(seen, () => ({ launch: [{ kind: 'toy', setup: { goal: 1 }, origin: { by: 'listener', ref: 'after' } }] }))])
    expect(t.result.status).toBe('applied')
    expect(t.result.reports.map((r) => r.action)).toEqual(['battle.end', 'toy.start'])
    expect(t.result.reports[0]!.launch).toEqual([{ kind: 'toy', setup: { goal: 1 }, origin: { by: 'listener', ref: 'after' } }])
    expect(t.game.state.battle).toBeNull()
    expect(toyOf(t.game.state)).toMatchObject({ goal: 1, origin: { by: 'listener', ref: 'after' } })
    expect(t.game.blockOf('commit:test.note')).toBe(BUSY)
  })

  it('回傳的 rewind 放到 battle.end 那一份報告上', async () => {
    const t = await run([listener([], () => ({ rewind: { kind: 'entry', summary: '你撤退了。' } }))])
    expect(t.result.reports.find((r) => r.action === 'battle.end')!.rewind).toEqual({ kind: 'entry', summary: '你撤退了。' })
  })

  it('結算時要開的活動開不成：整個結算不成立（戰鬥還在、狀態不變、能回退的步數不變），回傳 refused 與活動給的原因', async () => {
    const t = makeGame({ features: [TEST_COMBAT, TEST_ACTIVITY, listener([], () => ({ launch: [{ kind: 'toy', setup: { refuse: ['玩具活動現在開不了。'] } }] }))] })
    t.game.startBattle(BATTLE_SETUPS.encounter())
    decide(t.game, 'win')
    const before = snap(t.game)
    const steps = t.game.undo.size
    const r = await t.game.finishBattle()
    expect(r).toMatchObject({ status: 'refused', reason: '玩具活動現在開不了。', reports: [] })
    expect(t.game.state).toEqual(before)
    expect(t.game.undo.size).toBe(steps)
    expect(t.game.state.battle?.result?.outcome).toBe('win')
  })

  it('原本的 k.battle.onEnd 照舊：它的變更與句子還在，掛點回傳的接在它後面', async () => {
    const f: Feature = { id: 'old', install: (k) => k.battle.onEnd('old', () => ({ changes: [{ op: 'flag', key: 'old_end', value: 1 }], lines: ['舊的掛點'] })) }
    const t = await run([f, listener([], () => ({ changes: [{ op: 'flag', key: 'new_end', value: 2 }], lines: ['新的掛點'] }))])
    const end = t.result.reports.find((r) => r.action === 'battle.end')!
    expect(end.changes.filter((c) => c.op === 'flag').map((c) => c.key)).toEqual(['old_end', 'new_end'])
    expect(end.narration?.results?.slice(-2)).toEqual(['舊的掛點', '新的掛點'])
  })

  it('打輸的那一場照舊等玩家三選一；脫離、投降的 outcome 照傳', async () => {
    const seen: Seen[] = []
    const t = makeBattleGame({ battle: 'hopeless', seed: 2, features: [TEST_COMBAT, listener(seen, () => undefined)] })
    playOut(t.game)
    await t.game.finishBattle()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ kind: 'battle', outcome: 'lose', origin: { by: 'core' } })
    expect(t.game.pendingDefeat).not.toBeNull()
    for (const outcome of ['fled', 'surrender']) {
      const s2: Seen[] = []
      const g = makeBattleGame({ features: [TEST_COMBAT, listener(s2, () => undefined)] }).game
      decide(g, outcome)
      await g.finishBattle()
      expect(s2[0]!.outcome).toBe(outcome)
    }
  })
})

describe('endActivity 與 attachActivityEnd：共用的結束函式（給功能組結束的那一份報告）', () => {
  const two: Feature = {
    id: 'two',
    install(k) {
      k.hooks.on('activity.end', 'first', (p) => (p.kind === 'toy' ? { changes: [{ op: 'flag', key: 'a', value: 1 }], lines: ['一。'], launch: [{ kind: 'toy', setup: 1 }], rewind: { kind: 'entry', summary: '第一個。' } } : undefined))
      k.hooks.on('activity.end', 'second', (p) => (p.kind === 'toy' ? { changes: [{ op: 'flag', key: 'b', value: 2 }], lines: ['二。'], launch: [{ kind: 'toy', setup: 2 }], rewind: { kind: 'stage', summary: '第二個。' } } : undefined))
      k.hooks.on('activity.end', 'quiet', () => undefined)
    },
  }
  const payload = (g: G) => ({ state: g.state, kind: 'toy', id: 'y1', origin: { by: 'test' }, outcome: 'done', result: {} })

  it('changes、lines、launch 照處理函式的順序接起來；rewind 只取第一個；沒有人回傳的是空的', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY, two] })
    const merged = endActivity(game.k, payload(game))
    expect(merged.changes.map((c) => c.key)).toEqual(['a', 'b'])
    expect(merged.lines).toEqual(['一。', '二。'])
    expect(merged.launch.map((l) => l.setup)).toEqual([1, 2])
    expect(merged.rewind).toEqual({ kind: 'entry', summary: '第一個。' })
    const other = endActivity(game.k, { ...payload(game), kind: 'nobody' })
    expect(other).toEqual({ changes: [], lines: [], launch: [] })
  })

  it('處理函式的 order 小的先接；同一個 order 照登記的順序', () => {
    const f: Feature = {
      id: 'ord',
      install(k) {
        k.hooks.on('activity.end', 'late', () => ({ lines: ['後'] }), 5)
        k.hooks.on('activity.end', 'early', () => ({ lines: ['先'] }), -5)
        k.hooks.on('activity.end', 'mid', () => ({ lines: ['中'] }))
      },
    }
    const { game } = makeGame({ features: [f] })
    expect(endActivity(game.k, payload(game)).lines).toEqual(['先', '中', '後'])
  })

  it('處理函式拿到的是複製：改傳進去的 origin 與 result 不會動到發起的人手上那一份', () => {
    const f: Feature = {
      id: 'greedy',
      install: (k) => k.hooks.on('activity.end', 'greedy', (p) => { (p.origin as { by: string }).by = '被改過'; (p.result as Record<string, unknown>).x = 1 }),
    }
    const { game } = makeGame({ features: [f] })
    const origin = { by: 'test' }
    const result = {}
    endActivity(game.k, { ...payload(game), origin, result })
    expect(origin).toEqual({ by: 'test' })
    expect(result).toEqual({})
  })

  it('處理函式回傳的格式不對：丟錯，訊息寫出是誰的哪一欄', () => {
    const bad = (ret: unknown): G => {
      const f: Feature = { id: 'bad', install: (k) => k.hooks.on('activity.end', 'bad', () => ret as never) }
      return makeGame({ features: [f] }).game
    }
    for (const [ret, what] of [
      [{ changes: 'x' }, 'changes'], [{ changes: [{ nop: 1 }] }, 'changes'], [{ lines: [1] }, 'lines'],
      [{ launch: [{ setup: 1 }] }, 'launch'], [{ launch: {} }, 'launch'], [{ rewind: { kind: 'x' } }, 'rewind'], [[], '結果'],
    ] as const) {
      const g = bad(ret)
      expect(() => endActivity(g.k, payload(g)), JSON.stringify(ret)).toThrow(`activity.end（toy）：bad 回傳的 ${what} 格式不對`)
    }
  })

  it('玩具活動示範：toyEnd 組出結束的報告（變更接在後面、launch 與 rewind 放到報告上）；提交之後活動結束、掛點回傳的 launch 接著開', () => {
    const f: Feature = {
      id: 'next',
      install: (k) => k.hooks.on('activity.end', 'next', (p) => (p.kind === 'toy' && p.outcome === 'done' ? { changes: [{ op: 'flag', key: 'toy_done', value: p.result.steps as number }], launch: [{ kind: 'toy', setup: { goal: 9 }, origin: { by: 'next' } }] } : undefined)),
    }
    const { game } = makeGame({ features: [TEST_ACTIVITY, f] })
    game.launch('toy', {}, { by: 'test' })
    game.commit(toyStep(game.state))
    game.commit(toyStep(game.state))
    const draft = toyEnd(game.k, game.state)
    expect(draft.launch).toEqual([{ kind: 'toy', setup: { goal: 9 }, origin: { by: 'next' } }])
    // 結束那一份提交時，先結束（ext.toy 變 null），再開下一個
    const reports = game.commit(draft)
    expect(reports.map((r) => r.action)).toEqual(['toy.end', 'toy.start'])
    expect(game.state.flags.toy_done).toBe(2)
    expect(toyOf(game.state)).toMatchObject({ goal: 9, origin: { by: 'next' } })
    // attachActivityEnd 不改傳進去之外的欄位，已經有的 launch 接在前面
    const d2 = attachActivityEnd({ ...note(), launch: toyLaunch() }, { changes: [], lines: [], launch: [{ kind: 'toy', setup: 2 }], rewind: { kind: 'a', summary: 'b' } })
    expect(d2.launch).toHaveLength(2)
    expect(d2.rewind).toEqual({ kind: 'a', summary: 'b' })
  })
})

describe('走地圖：GridEffect.launch 與 GridEffect.triggers 併進走那一步的報告', () => {
  const MAP: SpecialMapEntry = {
    id: 'map_t', kind: 'test', size: [7, 3],
    sheets: [{
      id: 's1', name: '測試的一層', size: [7, 3], layout: ['#######', 'E.1%.2#', '#######'],
      cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '入口' }], spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [5, 1], cover: 'dense' }],
    }],
  }
  const content: ContentPack[] = [{ id: 'maps', content: { special_map: [MAP] } }]
  const door = (effect: GridEffect): Feature => ({ id: 'door', install: (k) => k.grid.onEnter('door', (ctx) => (ctx.at.x === 1 ? effect : undefined)) })
  const walk = (effect: GridEffect, more: Feature[] = []) => {
    const { game } = makeGame({ content, features: [TEST_ACTIVITY, TEST_COMBAT, door(effect), ...more] })
    game.enterMap('map_t')
    return game
  }

  it('launch 與 triggers 在走路那份報告上；提交之後活動開起來，這一段路到那一格為止；走路併進最新一樓、不另留回退', () => {
    const game = walk({ launch: [{ kind: 'toy', setup: { goal: 1 }, origin: { by: 'grid', ref: 'door' } }], triggers: [{ point: 'street.move', where: { zone: 'hall' } }] })
    const steps = game.undo.size
    const r = game.gridMove('east')
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'toy.start'])
    expect(r.reports[0]).toMatchObject({ launch: [{ kind: 'toy' }], triggers: [{ point: 'street.move', where: { zone: 'hall' } }] })
    expect(game.state.maps.at).toMatchObject({ x: 1, y: 1 })
    expect(toyOf(game.state)).toMatchObject({ origin: { by: 'grid', ref: 'door' } })
    expect(game.undo.size).toBe(steps)
    // 活動進行中不能再走（grid.move 不在玩具活動的放行清單裡）
    expect(game.gridMove('east')).toEqual({ status: 'refused', reason: BUSY, reports: [] })
  })

  it('只有 triggers：不停下來，照樣走完；報告上有 triggers、沒有 launch', () => {
    const game = walk({ triggers: [{ point: 'street.move' }] })
    const r = game.gridMove([2, 1])
    expect(game.state.maps.at).toMatchObject({ x: 2, y: 1 })
    expect(r.reports[0]!.triggers).toEqual([{ point: 'street.move' }])
    expect(r.reports[0]!.launch).toBeUndefined()
  })

  it('launch 開不成：整步不成立，人沒有走過去，回傳 refused 與活動給的原因，狀態與回退的步數都不動', () => {
    const game = walk({ launch: [{ kind: 'toy', setup: { refuse: ['這裡不能開始。'] } }] })
    const before = snap(game)
    const steps = game.undo.size
    expect(game.gridMove('east')).toEqual({ status: 'refused', reason: '這裡不能開始。', reports: [] })
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(steps)
  })

  it('原本的 battle 欄位照舊：走到遭遇點開打、有開打前的快照、開戰另留一步回退（回到人已經站在那一格）', () => {
    const { game } = makeGame({ content, features: [TEST_COMBAT, TEST_ACTIVITY, door({ battle: BATTLE_SETUPS.encounter() })] })
    game.enterMap('map_t')
    const steps = game.undo.size
    const r = game.gridMove('east')
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.state.battle).not.toBeNull()
    expect(game.state.snapshots.map((s) => s.kind)).toEqual(['battle'])
    expect(game.state.battle!.origin.ext).toBeUndefined() // 原本的寫法不加 origin
    expect(game.undo.size).toBe(steps + 1)
    expect(game.undo.labels().at(-1)).toBe('開戰')
    game.undoSteps(1)
    expect(game.state.battle).toBeNull()
    expect(game.state.maps.at).toMatchObject({ x: 1, y: 1 }) // 人還站在那一格
  })

  it('走路帶 battle 又帶 launch，而 launch 開起來的活動擋住開戰：整步不成立（人沒有走過去）', () => {
    const { game } = makeGame({ content, features: [TEST_COMBAT, TEST_ACTIVITY, door({ launch: [{ kind: 'toy', setup: {} }], battle: BATTLE_SETUPS.encounter() })] })
    game.enterMap('map_t')
    const before = snap(game)
    // 玩具活動開成之後，它自己不放行 battle.start：開戰被擋下，整步（連同玩具活動的開始）不成立
    expect(game.gridMove('east')).toEqual({ status: 'refused', reason: BUSY, reports: [] })
    expect(game.state).toEqual(before)
  })
})

describe('開新局的報告帶 launch：照順序開；開不成整個開局不成立', () => {
  it('開得成：新的一局裡活動進行中；開不成：丟 ActionBlocked，原本那一局整份不動', () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    const opened = game.newGame({ seed: 3, setup: () => note({ launch: toyLaunch() }) })
    expect(opened.action).toBe('game.new')
    expect(game.state.reports.map((r) => r.action)).toEqual(['game.new', 'test.note', 'toy.start'])
    expect(toyOf(game.state)).not.toBeNull()
    game.commit(toyEnd(game.k, game.state))
    const before = snap(game)
    expect(() => game.newGame({ seed: 4, setup: () => note({ launch: toyLaunch({ refuse: ['不夠。'] }) }) })).toThrow('不夠。')
    expect(game.state).toEqual(before)
  })
})

describe('活動進行中存檔再讀回來，被擋下的事還是被擋下（活動的狀態就是存檔的一部分）', () => {
  it('玩具活動：讀回來之後 blockOf、commit、Game.launch 照樣擋，結束之後放行', () => {
    const a = makeGame({ features: [TEST_ACTIVITY] }).game
    a.launch('toy', {}, { by: 'test' })
    const raw = a.save('manual', '')
    const b = makeGame({ features: [TEST_ACTIVITY] }).game
    expect(b.blockOf('commit:test.note')).toBeNull()
    expect(b.load(raw)).toBeNull()
    expect(toyOf(b.state)).toMatchObject({ origin: { by: 'test' } })
    expect(b.blockOf('commit:test.note')).toBe(BUSY)
    expect(b.blockOf('commit:toy.step')).toBeNull()
    expect(() => b.commit(note())).toThrow(BUSY)
    expect(() => b.launch('toy', {})).toThrow('已經有一個玩具活動在進行。')
    b.commit(toyEnd(b.k, b.state))
    expect(b.blockOf('commit:test.note')).toBeNull()
    expect(b.commit(note())[0]!.action).toBe('test.note')
  })

  it('戰鬥中與等著選的戰敗：讀回來還是擋，句子不變', async () => {
    const fighting = makeBattleGame().game
    const b1 = makeGame({ features: [TEST_COMBAT] }).game
    expect(b1.load(fighting.save('manual', ''))).toBeNull()
    expect(b1.blockOf('commit:test.note')).toBe(FIGHTING)

    const lost = makeBattleGame({ battle: 'hopeless', seed: 2 })
    playOut(lost.game)
    await lost.game.finishBattle()
    const b2 = makeGame({ features: [TEST_COMBAT] }).game
    expect(b2.load(lost.game.save('manual', ''))).toBeNull()
    expect(b2.pendingDefeat).not.toBeNull()
    expect(b2.blockOf('commit:test.note')).toBe(WAITING)
  })
})

describe('任務鏈的套用也走 launch（和 commit 同一條路）', () => {
  it('自由行動的鏈：套用的報告不帶 launch 時照舊；鏈在玩具活動進行中被擋下（chain:free_action 不放行）', async () => {
    const { game } = makeGame({ features: [TEST_ACTIVITY] })
    game.launch('toy', {})
    const r = await game.act({ kind: 'free', text: '看看四周' })
    expect(r).toMatchObject({ status: 'refused', reason: BUSY })
    game.k.activity.allow('toy', 'chain:free_action', 'test')
    const r2 = await game.act({ kind: 'free', text: '看看四周' }, { autoRules: true })
    expect(r2.status).toBe('applied')
  })

  it('套用的報告帶 launch 開不成：鏈不成立，回傳 refused；狀態與回退的步數不動', async () => {
    // 用掛鉤替自由行動套用時的報告加上 launch（report.before 可以回傳變更，不能改 launch；所以用 turn.end 回傳的報告）
    const f: Feature = {
      id: 'chainlaunch',
      install: (k) => k.hooks.on('turn.end', 'chainlaunch', ({ report }) => (report.chain ? [note({ action: 'test.after', launch: toyLaunch({ refuse: ['鏈的後續開不成。'] }) }, [{ op: 'flag', key: 'after', value: true }])] : undefined)),
    }
    const { game } = makeGame({ features: [TEST_ACTIVITY, f] })
    const before = snap(game)
    const steps = game.undo.size
    const r = await game.act({ kind: 'free', text: '看看四周' }, { autoRules: true })
    expect(r).toMatchObject({ status: 'refused', reason: '鏈的後續開不成。', reports: [] })
    expect(game.state).toEqual(before)
    expect(game.undo.size).toBe(steps)
    expect(game.lastRun).toBeNull()
  })

  it('套用的報告（帶回合結束帶出來的報告）的 launch 開成：玩具活動開起來，報告都在這條鏈的結果裡', async () => {
    const f: Feature = {
      id: 'chainlaunch',
      install: (k) => k.hooks.on('turn.end', 'chainlaunch', ({ report }) => (report.chain ? [note({ action: 'test.after', launch: toyLaunch() }, [{ op: 'flag', key: 'after', value: true }])] : undefined)),
    }
    const { game } = makeGame({ features: [TEST_ACTIVITY, f] })
    const r = await game.act({ kind: 'free', text: '看看四周' }, { autoRules: true })
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => x.action).slice(-2)).toEqual(['test.after', 'toy.start'])
    expect(toyOf(game.state)).not.toBeNull()
    expect(game.undo.size).toBe(1)
  })
})

describe('探針：開出來的每一份報告照常經過提交（不變式第 2 條：changes 套用之後等於狀態的實際變化）', () => {
  it('launch、結算、玩具活動的每一份報告都沒有違規', async () => {
    const next: Feature = { id: 'next', install: (k) => k.hooks.on('activity.end', 'next', (p) => (p.kind === 'battle' ? { launch: toyLaunch({}, 'next') } : undefined)) }
    const t = makeGame({ features: [TEST_COMBAT, TEST_ACTIVITY, next] })
    const { violations, events } = await observed(t.game, async () => {
      t.game.commit(note({ launch: [{ kind: 'battle', setup: BATTLE_SETUPS.encounter(), origin: { by: 'test' } }] }))
      decide(t.game, 'win')
      await t.game.finishBattle()
      t.game.commit(toyStep(t.game.state))
      t.game.commit(toyEnd(t.game.k, t.game.state))
    })
    expect(violations).toEqual([])
    const afters = events.filter((e) => e.source === 'core/state/commit' && e.type === 'report.after').map((e) => (e.data as { report: { action: string } }).report.action)
    expect(afters).toEqual(['test.note', 'battle.start', 'battle.step', 'battle.end', 'toy.start', 'toy.step', 'toy.end'])
  })
})

describe('行動種類的 owner：寫了 owner 的那一筆載得進來，但不註冊成行動，留給那個功能自己註冊', () => {
  const kernel = (entries: unknown[]): Kernel => {
    const k = createKernel([actionsFeature])
    k.strict = true
    k.content.loadPack(MINI_PACK)
    k.content.loadPack({ id: 'acts', content: { action_kind: entries as never } })
    readyFeatures(k)
    return k
  }
  const kind = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, attr: 'charm', dc: 'normal', minutes: 10, max_minutes: 30, ...extra })

  it('有 owner 的那一筆在內容裡、但 k.actions 裡沒有；沒寫的照舊註冊', () => {
    const k = kernel([kind('beg'), kind('gift', { owner: 'npcs' }), kind('chat', { owner: 'npcs', requires: { kind: 'has_item', id: 'x' }, blocked_text: '沒有。' })])
    expect(k.content.list('action_kind').map((e) => e.id).sort()).toEqual(['beg', 'chat', 'gift'])
    expect(k.content.get('action_kind', 'gift')).toMatchObject({ owner: 'npcs' })
    expect(k.actions.get('beg')).toBeDefined()
    expect(k.actions.get('gift')).toBeUndefined()
    expect(k.actions.get('chat')).toBeUndefined()
    expect(k.actions.list().map((d) => d.id).sort()).toEqual(['beg', 'free'])
  })

  it('那個功能自己註冊同一個 id 不會撞上（登錄表裡本來就沒有）', () => {
    const k = kernel([kind('gift', { owner: 'npcs' })])
    k.actions.register({ id: 'gift', owner: 'npcs', name: '送禮', attr: 'charm', dc: 'normal', minutes: 10, maxMinutes: 30, reportKind: 'social' })
    expect(k.actions.get('gift')!.owner).toBe('npcs')
  })

  it('owner 要是功能的 id；其餘的檢查照舊（owner 不是免檢查的通行證）', () => {
    const k = createKernel([actionsFeature])
    k.content.loadPack(MINI_PACK)
    expect(k.content.validate('action_kind', [kind('x', { owner: 'NPCs 1' })]).join('')).toMatch(/owner 要是功能的 id/)
    expect(k.content.validate('action_kind', [kind('x', { owner: 3 })]).join('')).toMatch(/owner 要是功能的 id/)
    expect(k.content.validate('action_kind', [kind('x', { owner: 'npcs', dc: 'nope' })]).join('')).toMatch(/dc 只能是/)
    expect(k.content.validate('action_kind', [kind('x', { owner: 'npcs' })])).toEqual([])
  })

  it('寫了 owner 的那一筆照樣檢查 requires 與參考範圍（資料壞了不因為它是別人的就放過）', () => {
    expect(() => kernel([kind('gift', { owner: 'npcs', skill: 'no_such_skill' })])).toThrow()
    expect(() => kernel([kind('gift', { owner: 'npcs', hint: { success: [{ kind: 'no_such_effect' }] } })])).toThrow(/gift/)
  })
})
