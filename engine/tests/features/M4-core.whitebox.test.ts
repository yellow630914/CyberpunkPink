// 白箱：M4 改動的核心（core/）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 範圍：passive（被動效果的 per 與格式檢查、regenTotal）、action.window（壞的回答）、turn.control（沒給原因、已倒下的人）、report.before 的回答格式、
// activity.allowEverywhere（重複登記、except）、量表條件的 key: 'any' 與說明句、條件 explain（all／any／not）。
// 規格：dev/adr/0019 第二節（被動效果）、M4-core-gaps 第 12、14、16 項；CRAFTING 5.5 節（節奏資源合計最多 +1）；CORE_RULES 4.2 節；GAME_DESIGN 第 3 節。
// 內容用測試自帶的最小假資料。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, Feature, Kernel, PassiveEffect, PassiveSource } from '../../src'
import { BattleRun, PASSIVE_SOURCES, TEMPO_CAP, TEMPO_SOURCES, actionWindow, advance, beginTurn, clone, createKernel, effectCtx, passiveAmount, passiveProblems, prepareAction, regenTotal, setupBattle } from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { METER_CONTENT, enemyUnit, makeGame, makeState, meterFeature, testMeter } from '../../src/testkit'

type Box = Partial<Record<PassiveSource, PassiveEffect[]>>
const sources = (box: Box): Feature => ({
  id: 'test_sources',
  install(k: Kernel) { for (const s of PASSIVE_SOURCES) k.passives.register('test', s, () => box[s] ?? []) },
})
const world = (box: Box = {}, pc?: Parameters<typeof makeState>[0]) => {
  const k = createKernel([characterFeature, sources(box)])
  return { k, state: makeState(pc), box }
}

describe('被動效果的 per（依軌道值縮放）邊界（M4-core-gaps 第 12 項）', () => {
  it('passiveAmount：unit_tag 是 0；amount 沒寫當 0；軌道的覆蓋值是 0 就用 0（不退回角色的值）；人不存在當 0', () => {
    const { state } = world({}, { pc: { load: 30 } as never })
    const per = { per: { track: 'load' as const, every: 10, amount: 2 } }
    expect(passiveAmount({ unit_tag: 'x' }, state, 'pc')).toBe(0)
    expect(passiveAmount({ stat: 's' } as PassiveEffect, state, 'pc')).toBe(0)
    expect(passiveAmount({ stat: 's', ...per }, state, 'pc')).toBe(6)
    expect(passiveAmount({ stat: 's', ...per }, state, 'pc', { load: 0 })).toBe(0)
    expect(passiveAmount({ stat: 's', ...per }, state, 'nobody')).toBe(0)
  })
  it('軌道值是負的當 0；每 every 點進位用 floor（9 點不算、10 點算一次、19 點還是一次）；amount 是負的往下減', () => {
    const { state } = world()
    const per = (every: number, amount: number) => ({ stat: 's', per: { track: 'load' as const, every, amount } }) as PassiveEffect
    expect(passiveAmount(per(10, 1), state, 'pc', { load: -50 })).toBe(0)
    expect(passiveAmount(per(10, 1), state, 'pc', { load: 9 })).toBe(0)
    expect(passiveAmount(per(10, 1), state, 'pc', { load: 10 })).toBe(1)
    expect(passiveAmount(per(10, 1), state, 'pc', { load: 19 })).toBe(1)
    expect(passiveAmount(per(10, -3), state, 'pc', { load: 25 })).toBe(-6)
  })
  it('算出來不是有限數字（amount 很大乘出 Infinity）當 0；k.passives.of 不列算出 0 的那一筆', () => {
    const big = { stat: 's', per: { track: 'load' as const, every: 1, amount: Number.MAX_VALUE } } as PassiveEffect
    const { k, state } = world({ cyber: [big, { stat: 't', per: { track: 'load', every: 10, amount: 1 } }] }, { pc: { load: 50 } as never })
    expect(passiveAmount(big, state, 'pc')).toBe(0)
    expect(k.passives.of(state, 'pc').map((e) => ('stat' in e ? e.stat : ''))).toEqual(['t'])
  })
  it('性質：任何有限的軌道值、every（1 以上）、amount：結果是有限的整數倍；軌道值越高（amount 為正）不會越小', () => {
    const { state } = world()
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 0, max: 500 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 9 }), (load, d, every, amount) => {
      const e = { stat: 's', per: { track: 'load' as const, every, amount } } as PassiveEffect
      const a = passiveAmount(e, state, 'pc', { load })
      const b = passiveAmount(e, state, 'pc', { load: load + d })
      expect(Number.isFinite(a)).toBe(true)
      expect(a % amount).toBe(0)
      expect(b).toBeGreaterThanOrEqual(a)
    }))
  })
})

describe('passiveProblems 的格式（M4-core-passive、M4-core-gaps 第 12 項）', () => {
  const { k } = world()
  const probs = (raw: unknown, source?: PassiveSource) => passiveProblems(k, raw, 'effects', source)
  const has = (p: string[], re: RegExp) => p.some((m) => re.test(m))
  it('per 不是物件、多一個欄位、track 不認得、every 不是正整數、amount 是 0 或不是數字：各一句', () => {
    expect(has(probs({ stat: 's', per: 'load' }), /per：要是 \{ track, every, amount \}/)).toBe(true)
    expect(has(probs({ stat: 's', per: { track: 'load', every: 10, amount: 1, extra: 1 } }), /per：沒有 extra 這個欄位/)).toBe(true)
    expect(has(probs({ stat: 's', per: { track: 'zzz', every: 10, amount: 1 } }), /per\.track/)).toBe(true)
    for (const every of [0, -1, 1.5, '10', Number.NaN]) expect(has(probs({ stat: 's', per: { track: 'load', every, amount: 1 } }), /per\.every/), String(every)).toBe(true)
    for (const amount of [0, '1', Number.NaN, Infinity]) expect(has(probs({ stat: 's', per: { track: 'load', every: 10, amount } }), /per\.amount/), String(amount)).toBe(true)
    expect(has(probs({ stat: 's', amount: 1, per: { track: 'load', every: 10, amount: 1 } }), /amount 與 per 只能寫一個/)).toBe(true)
    expect(probs({ stat: 's', per: { track: 'load', every: 10, amount: -2 } })).toEqual([])
  })
  it('mod 的 tags 不是字串陣列、label 是空字串、if 不是陣列：各一句', () => {
    expect(has(probs({ mod: 'hit', amount: 1, tags: [1] }), /tags：要是字串的陣列/)).toBe(true)
    expect(has(probs({ stat: 's', amount: 1, label: '' }), /label：要是一句話/)).toBe(true)
    expect(has(probs({ stat: 's', amount: 1, if: 'x' }), /if：要是條件的陣列/)).toBe(true)
  })
  it('節奏資源：義體、藥、裝備不准寫 { stat: ap_regen／ram_regen }；調校、怪癖等別的來源與沒給來源的檢查不管（M4-followups-2 第 1 項）', () => {
    for (const source of ['cyber', 'drug', 'gear'] as const) for (const stat of ['ap_regen', 'ram_regen']) expect(has(probs({ stat, amount: 1 }, source), /請用修正/), `${source}.${stat}`).toBe(true)
    for (const source of ['tuning', 'quirk', 'malware', 'sink', undefined] as const) expect(probs({ stat: 'ap_regen', amount: 1 }, source), String(source)).toEqual([])
    expect(probs({ mod: 'ap_regen', amount: 1 }, 'cyber')).toEqual([])
  })
})

describe('regenTotal：節奏資源全身合計最多 +1（CRAFTING 5.5 節；dev/adr/0019 P13）', () => {
  it(`節奏來源（${TEMPO_SOURCES.join('、')}）的正值合計最多 +${TEMPO_CAP}；負值照算；其他來源與沒有來源的照算`, () => {
    expect(regenTotal([])).toBe(0)
    expect(regenTotal([{ value: 1, source: 'cyber' }, { value: 1, source: 'drug' }, { value: 1, source: 'gear' }, { value: 1, source: 'construct' }, { value: 1, source: 'quirk' }])).toBe(1)
    expect(regenTotal([{ value: 1, source: 'cyber' }, { value: -1, source: 'drug' }])).toBe(0)
    expect(regenTotal([{ value: 2, source: 'cyber' }, { value: 1, source: 'ability' }])).toBe(2)
    expect(regenTotal([{ value: 1 }, { value: 1 }])).toBe(2)
    expect(regenTotal([{ value: 3, source: 'cyber' }])).toBe(1)
    expect(regenTotal([{ value: 0.5, source: 'cyber' }])).toBe(0.5)
  })
  it('性質：結果 = min(1, 節奏來源的正值合計) + 其餘的合計；加一筆節奏來源的正值不會讓結果變小，而且最多多 1', () => {
    const part = fc.record({ value: fc.integer({ min: -3, max: 3 }), source: fc.constantFrom('cyber', 'drug', 'gear', 'construct', 'quirk', 'ability', 'sync', 'broker', undefined) })
    fc.assert(fc.property(fc.array(part, { maxLength: 12 }), fc.integer({ min: 1, max: 3 }), (parts, plus) => {
      const tempo = parts.filter((p) => p.value > 0 && p.source && (TEMPO_SOURCES as readonly string[]).includes(p.source)).reduce((s, p) => s + p.value, 0)
      const rest = parts.filter((p) => !(p.value > 0 && p.source && (TEMPO_SOURCES as readonly string[]).includes(p.source))).reduce((s, p) => s + p.value, 0)
      expect(regenTotal(parts)).toBe(Math.min(TEMPO_CAP, tempo) + rest)
      const more = regenTotal([...parts, { value: plus, source: 'cyber' }])
      expect(more).toBeGreaterThanOrEqual(regenTotal(parts))
      expect(more - regenTotal(parts)).toBeLessThanOrEqual(TEMPO_CAP)
    }))
  })
})

describe('核心的掛點：action.window 的壞回答與 report.before 的回答格式', () => {
  const FREE = { kind: 'free', text: '我想想怎麼辦' }
  const make = (handlers: Array<(p: unknown) => unknown>) => {
    const g = makeGame({ features: [characterFeature] }).game
    handlers.forEach((h, i) => g.k.hooks.on('action.window', `t${i}`, h as never))
    return g
  }
  it('回答不是物件（字串、數字、陣列、null）略過；option 缺 id、缺 label、input 沒有 kind 都不列', () => {
    const g = make([() => 'x', () => 7, () => [1], () => null, () => ({ option: { id: '', label: 'x', input: FREE } }), () => ({ option: { id: 'a', label: '', input: FREE } }), () => ({ option: { id: 'a', label: 'x', input: {} } }), () => ({ option: 'x' })])
    expect(actionWindow(g.k, g.state, FREE)).toEqual({ options: [] })
  })
  it('replace 的原因是空字串、input 沒有 kind 不收；兩個功能都要換：第一個合格的算數，後面的不覆蓋；選項都列（每個帶是誰插的）', () => {
    const g = make([
      () => ({ replace: { input: { kind: 'free', text: 'A' }, why: '' } }),
      () => ({ replace: { input: {}, why: '壞的。' } }),
      () => ({ replace: { input: { kind: 'free', text: 'B' }, why: '第一個。' }, option: { id: 'o1', label: '一', input: FREE } }),
      () => ({ replace: { input: { kind: 'free', text: 'C' }, why: '第二個。' }, option: { id: 'o2', label: '二', input: FREE } }),
    ])
    const w = actionWindow(g.k, g.state, FREE)
    expect(w.replace).toMatchObject({ input: { kind: 'free', text: 'B' }, why: '第一個。', owner: 't2' })
    expect(w.options.map((o) => [o.id, o.owner])).toEqual([['o1', 't2'], ['o2', 't3']])
  })
  it('處理函式收到的是複本：它改了輸入，原本的行動不受影響；回傳的 option.input 也是複本', () => {
    const shared = { kind: 'free', text: '共用' }
    const g = make([(p: unknown) => { (p as { input: { text: string } }).input.text = '被改了'; return { option: { id: 'o', label: 'x', input: shared } } }])
    const input = { ...FREE }
    const w = actionWindow(g.k, g.state, input)
    expect(input.text).toBe('我想想怎麼辦')
    w.options[0]!.input.text = '又改'
    expect(shared.text).toBe('共用')
    expect(prepareAction(g.k, g.state, input).input.text).toBe('我想想怎麼辦')
  })
  it('report.before：回傳 { lines } 沒有 changes 也行；lines 裡不是字串或空字串的濾掉；全空就不改結果；回傳陣列照舊；沒有回傳不動', () => {
    const g = makeGame({ features: [characterFeature] }).game
    g.k.hooks.on('report.before', 't_lines', (() => ({ lines: ['多一句。', '', 7, null] })) as never)
    const rs = g.commit({ kind: 'action', action: 'test.line', location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '原本。' } })
    expect(rs[0]!.outcome.summary).toBe('原本。多一句。')
    expect(rs[0]!.narration?.results).toEqual(['多一句。'])
    const h = makeGame({ features: [characterFeature] }).game
    h.k.hooks.on('report.before', 't_empty', (() => ({ changes: [], lines: ['', 5] })) as never)
    h.k.hooks.on('report.before', 't_void', (() => undefined) as never)
    const rs2 = h.commit({ kind: 'action', action: 'test.line', location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '原本。' } })
    expect(rs2[0]!.outcome.summary).toBe('原本。')
    expect(rs2[0]!.narration?.results ?? []).toEqual([])
  })
})

describe('核心的掛點：turn.control 沒給原因與倒下的人（M4-core-gaps 第 14 項）', () => {
  const setup = (control: (u: BattleUnit, out: { puppet?: boolean; why?: string }) => void) => {
    const k = createKernel([characterFeature, combatFeature])
    k.battle.on('turn.control', 'test', ({ unit, out }) => control(unit as BattleUnit, out))
    const state = makeState()
    const s: BattleSetup = { mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'unit', unit: enemyUnit('minion', 1, { weapon: 'pistol' }) as never }] }
    const battle = clone(setupBattle(k, state, s).battle)
    const run = new BattleRun(k, state, battle)
    return { run, battle, me: battle.units.a1! as BattleUnit }
  }
  it('沒給 why：紀錄用預設那一句，記著原本是誰（puppet 沒有 why 的鍵）；結束回合時還原，下次再問', () => {
    let n = 0
    const { run, battle, me } = setup((_u, out) => { n++; out.puppet = true })
    me.control = 'player'
    beginTurn(run, me)
    expect(me.control).toBe('ai')
    expect(me.puppet).toEqual({ control: 'player' })
    expect(run.beats.some((b) => b.text.includes('不聽使喚'))).toBe(true)
    battle.turn = battle.order.indexOf('a1')
    advance(run)
    expect(me.control).toBe('player')
    expect(me.puppet).toBeUndefined()
    expect(n).toBeGreaterThanOrEqual(1)
  })
  it('已經倒下（out）的單位不被操控：控制權不變、沒有 puppet 記號', () => {
    const { run, me } = setup((_u, out) => { out.puppet = true; out.why = '被操控了' })
    me.control = 'player'
    ;(me as { out: unknown }).out = 'down'
    beginTurn(run, me)
    expect(me.control).toBe('player')
    expect(me.puppet).toBeUndefined()
  })
})

describe('核心的掛點：activity.allowEverywhere（M4 收尾修正批；契約的回話）', () => {
  const mk = () => makeGame({ features: [characterFeature] }).game
  const def = (kind: string, allow: string[] = []) => ({ kind, owner: 'test', order: 80, active: () => ({ id: kind, label: kind }), allow, reason: () => `${kind} 擋住了`, })
  it('同一個前綴登記兩次、或活動自己已經放行：不重複加進清單；except 的活動不放行；之後才登記的也照規則放行', () => {
    const g = mk()
    g.k.activity.define(def('a_one'))
    g.k.activity.define(def('a_two', ['commit:x.']))
    g.k.activity.allowEverywhere('commit:x.', 'test', ['a_two_except'])
    g.k.activity.allowEverywhere('commit:x.', 'test2', [])
    expect(g.k.activity.get('a_one')!.allow.filter((p) => p === 'commit:x.')).toHaveLength(1)
    expect(g.k.activity.get('a_two')!.allow.filter((p) => p === 'commit:x.')).toHaveLength(1)
    g.k.activity.define(def('a_late'))
    expect(g.k.activity.get('a_late')!.allow.filter((p) => p === 'commit:x.').length).toBeGreaterThanOrEqual(1)
    g.k.activity.define(def('a_two_except'))
    // except 只擋第一次登記的；第二次（except 是空的）把它放行了：後登記的全域規則仍然生效
    expect(g.k.activity.get('a_two_except')!.allow).toContain('commit:x.')
  })
  it('except 列出的活動：先登記、後登記都不放行；blockOf 回那個活動自己的原因', () => {
    const g = mk()
    g.k.activity.define(def('a_early'))
    g.k.activity.allowEverywhere('commit:y.', 'test', ['a_early', 'a_later'])
    g.k.activity.define(def('a_later'))
    g.k.activity.define(def('a_free'))
    g.state.flags = {}
    expect(g.k.activity.get('a_early')!.allow).not.toContain('commit:y.')
    expect(g.k.activity.get('a_later')!.allow).not.toContain('commit:y.')
    expect(g.k.activity.get('a_free')!.allow).toContain('commit:y.')
    expect(g.k.activity.blockOf(g.state, 'commit:y.go')).toMatch(/a_early 擋住了|a_later 擋住了/)
  })
})

describe('量表條件：key: any 與說明句（M4-followups-2 第 11 項）', () => {
  const make = (keyed: 'none' | 'faction' | 'npc' | 'district') => {
    const g = makeGame({ features: [characterFeature, meterFeature(testMeter({ kind: 'mood', keyed, start: 10 }))], content: [METER_CONTENT] }).game
    return g
  }
  const test = (g: ReturnType<typeof make>, c: Record<string, unknown>) => g.k.conditions.test(c as never, { state: g.state, actor: 'pc', stats: g.k.stats, timeRules: g.k.timeRules } as never)
  it('不分對象的量表：any 就是那一個鍵（_）；區、勢力、人：內容裡每一個加上存檔裡寫過的鍵各試一次，有一個成立就算', () => {
    const none = make('none')
    expect(test(none, { kind: 'mood', key: 'any', min: 10 })).toBe(true)
    expect(test(none, { kind: 'mood', key: 'any', min: 11 })).toBe(false)
    const fac = make('faction')
    fac.state.meters.mood = { f_alpha: 5, f_zzz: 80 }
    expect(test(fac, { kind: 'mood', key: 'any', min: 70 })).toBe(true)
    expect(test(fac, { kind: 'mood', key: 'any', min: 90 })).toBe(false)
    const npc = make('npc')
    npc.state.meters.mood = { npc_ann: 60 }
    expect(test(npc, { kind: 'mood', key: 'any', min: 50, max: 70 })).toBe(true)
    expect(test(npc, { kind: 'mood', key: 'any', max: 0 })).toBe(false)
  })
  it('驗證：key: any 對不分對象的量表合法；key 寫別的對不分對象的量表不合法（只能是 _）；min 與 max 不是數字不合法', () => {
    const none = make('none')
    expect(none.k.conditions.validate({ kind: 'mood', key: 'any' } as never, 'c')).toEqual([])
    expect(none.k.conditions.validate({ kind: 'mood', key: 'zzz' } as never, 'c').join('')).toMatch(/key 只能是 _/)
    expect(none.k.conditions.validate({ kind: 'mood', key: '_', min: 'x' } as never, 'c').join('')).toMatch(/min、max 要是數字/)
  })
  it('說明句：只有 min「要在 N 以上」、只有 max「要在 N 以下」、兩個都有「要在 N 到 M 之間」、都沒有「要符合條件」；key 查得到名字寫名字', () => {
    const fac = make('faction')
    const explain = (c: Record<string, unknown>) => fac.k.conditions.explain(c as never, { state: fac.state, actor: 'pc', stats: fac.k.stats, timeRules: fac.k.timeRules } as never)
    expect(explain({ kind: 'mood', key: 'f_alpha', min: 50 })).toMatch(/心情要在 50 以上/)
    expect(explain({ kind: 'mood', key: 'f_alpha', max: 5 })).toMatch(/要在 5 以下/)
    expect(explain({ kind: 'mood', key: 'f_alpha', min: 20, max: 30 })).toMatch(/要在 20 到 30 之間/)
    expect(explain({ kind: 'mood', key: 'zzz_id', min: 50 })).toMatch(/zzz_id/)
    expect(explain({ kind: 'mood', key: 'any', min: 50 })).toMatch(/^心情要在 50 以上/)
    expect(explain({ kind: 'mood', key: 'f_alpha', min: 0 })).toBeNull()
  })
  it('條件 explain 的組合：all 取第一個不成立的、any 把每一條接起來（都不成立才擋）、not 不說明（回 null）', () => {
    const g = makeGame({ features: [characterFeature] }).game
    const ex = (c: Record<string, unknown>) => g.k.conditions.explain(c as never, { state: g.state, actor: 'pc', stats: g.k.stats, timeRules: g.k.timeRules } as never)
    const money = (n: number) => ({ kind: 'money', wallet: 'cash', min: n })
    expect(ex({ kind: 'all', of: [money(0), money(99999999)] })).toMatch(/現金要在 99999999 以上/)
    expect(ex({ kind: 'any', of: [money(99999998), money(99999999)] })).toMatch(/，或/)
    expect(ex({ kind: 'any', of: [money(0), money(99999999)] })).toBeNull()
    expect(ex({ kind: 'not', of: money(0) })).toBeNull()
    expect(ex({ kind: 'any', of: [] })).toBeNull()
    void effectCtx
  })
})
