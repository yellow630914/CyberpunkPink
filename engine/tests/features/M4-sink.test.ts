// 驗收測試：dev/work/M4-sink.md（cpp-feature）。規格：CORE_RULES 4.3 節（分段、沉溺 100 以上）；DOWNTIME 3.2、3.3 節；NPCS 8.3 節「隱藏沉溺」；dev/adr/0019 第六節與 P17～P21。
// 內容一律用測試自帶的最小假資料：規則表 sink_rule 只在需要時才蓋（預設照 CORE_RULES 4.3 節的表）、兩個假勢力（測試工具的 f_alpha、f_beta）、
// 一張街的地圖與四種設施（心理治療、斷線靜修、要好感的靜修、免費的心理治療）。量表 hostility 與 favor 由測試的量表功能定義。
//
// 時間：測試從第 3 天 10:00 開始；第 7、14、21、28、35 天的 06:00 是週一（第 1～5 週）；睡一覺記在「睡下去那一刻所在的週」的計數器 sleeps:<週>（第 3～6 天是第 0 週）。
// 每週一讀的是「剛過完那一週」的計數器：第 7 天的週一讀 sleeps:0。

import { describe, expect, it } from 'vitest'
import type { Condition, ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, SINK_RESIST, effectCtx, meterOf, sinkUpChanges, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import { restFeature, sleepDraft } from '../../src/features/rest'
import {
  bandOf, retreatLeaveDraft, retreatOf, retreatStayDraft, retreatView, sinkFeature, sinkRules, sinkView, therapyBlock, therapyDraft, therapyQuote,
} from '../../src/features/sink'
import { arrive, worldFeature } from '../../src/features/world'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
} as never

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_counsel', name: '蜜腺療養院', therapy: { kind: 'counsel' } },
      { id: 'fac_retreat', name: '傳教所', therapy: { kind: 'retreat' } },
      { id: 'fac_retreat_favor', name: '要好感的傳教所', therapy: { kind: 'retreat', favor: { faction: 'f_alpha', min: 20 } } },
      { id: 'fac_counsel_free', name: '義診所', therapy: { kind: 'counsel', free: true } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '療養街', kind: 'block', map: 'm_street', exits: {}, facilities: {
      F1: { type: 'fac_counsel', name: '療養院' }, F2: { type: 'fac_retreat', name: '傳教所' }, F3: { type: 'fac_retreat_favor', name: '深山傳教所' }, F4: { type: 'fac_counsel_free', name: '義診所' },
    } }],
    sink_rule: [{ id: 'default', watchers: ['f_alpha', 'f_beta'] }],
  }
  patch(c)
  return { id: 'sink_test', content: c as unknown as ContentPack['content'] }
}

/** 一個替身的被動效果來源：給 pc 一個 sink_resist 單位標籤（真的來源是 features/tuning 的調校）。 */
const RESIST: Feature = {
  id: 'test_resist',
  install(k) {
    k.passives.register('test_resist', 'tuning', () => [{ unit_tag: SINK_RESIST, label: '測試的調校' }], '調校')
  },
}
/** 替身的 sink 效果（沒有裝 character 的局用：餘韻才不會自己消退）：往上的那一邊少 1、最少 1，證明走過了效果。 */
const RESIST_FX: Feature = {
  id: 'test_resist_fx',
  install(k) {
    k.effects.register<{ kind: string; amount: number }>({
      kind: 'sink', owner: 'test_resist_fx', ai: false, validate: (raw) => (Number.isInteger(raw.amount) ? [] : ['amount 要是整數']),
      toChanges: (e) => [{ op: 'actor.track', id: 'pc', track: 'sink', delta: e.amount > 1 ? e.amount - 1 : e.amount }], describe: () => '沉溺',
    })
  },
}

interface Opts {
  pc?: Rec
  money?: { cred: number; cash: number }
  pack?: ContentPack
  /** 不裝 character（餘韻不會自己消退） */
  bare?: boolean
  /** 不定義 favor 量表 */
  noFavor?: boolean
  extra?: Feature[]
}
const make = (o: Opts = {}) => {
  const meters = o.noFavor
    ? meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' }))
    : meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' }), testMeter({ kind: 'favor', owner: 'security', name: '好感', keyed: 'faction' }))
  const features: Feature[] = [meters, ...(o.bare ? [] : [characterFeature]), worldFeature, restFeature, sinkFeature, ...(o.extra ?? [])]
  const { game } = makeGame({
    features, content: [METER_CONTENT, o.pack ?? pack()], seed: 7, pc: { hp: 40, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
/** 走到某一天某個鐘點（只往前）。 */
const advanceTo = (g: G, day: number, hour: number, minute = 0) => advance(g, (day - 1) * 1440 + hour * 60 + minute - toMinutes(g.state.time))
const count = (g: G, week: number, n: number) => g.commit(draft([{ op: 'counter', key: `sleeps:${week}`, delta: n }], 'test.counter'))
const pc = (g: G) => g.state.actors.pc!
const weekReports = (g: G) => g.state.reports.filter((r) => r.action === 'sink.week')
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionBlocked) return e.message
    throw e
  }
  return ''
}
/** 用內建的來源套一串效果並提交。 */
const applyFx = (g: G, fx: Rec[], source: 'builtin' | 'ai' = 'builtin') => {
  const ctx = effectCtx(g.k, g.state, { source, actor: 'pc' })
  const errors = g.k.effects.validate(fx, ctx)
  expect(errors).toEqual([])
  const res = g.k.effects.resolve(fx, ctx)
  expect(res.errors).toEqual([])
  return g.commit(draft(res.changes, 'test.fx'))
}

// ---- 分段 ----

describe('分段的得失（來源 sink）', () => {
  const at = (sink: number) => {
    const g = make({ pc: { sink } })
    const { k, state } = g
    const sum = (parts: Array<{ value: number }>) => parts.reduce((n, p) => n + p.value, 0)
    return {
      composure: sum(k.passives.checkParts(state, 'pc', { skill: 'composure', tags: [] })),
      perception: sum(k.passives.checkParts(state, 'pc', { skill: 'investigate', tags: ['perception'] })),
      lure: sum(k.passives.checkParts(state, 'pc', { skill: 'negotiate', tags: ['resist_lure'] })),
      control: sum(k.passives.checkParts(state, 'pc', { skill: 'composure', tags: ['resist_control'] })) - sum(k.passives.checkParts(state, 'pc', { skill: 'composure', tags: [] })),
      cap: k.stats.stat(state, 'pc', 'afterglow_cap') - 3,
      dealt: sum(k.passives.modParts(state, 'pc', 'load_dealt_pct')),
    }
  }

  it('沉溺 0、25、45、65、85、105、130 的人：定力、承受層數、自己造成的感載各是對的數字（85 的定力是 −4；105 是基礎 +3；130 是 +4）', () => {
    expect(at(0)).toMatchObject({ composure: 0, cap: 0, dealt: 0 })
    expect(at(25)).toMatchObject({ composure: 0, cap: 0, dealt: 0 })
    expect(at(45)).toMatchObject({ composure: -1, cap: 1, dealt: 10 })
    expect(at(65)).toMatchObject({ composure: -2, cap: 1, dealt: 10 })
    expect(at(85)).toMatchObject({ composure: -4, cap: 1, dealt: 10 })
    expect(at(105)).toMatchObject({ composure: -2, cap: 3, dealt: 10 })
    expect(at(130)).toMatchObject({ composure: -2, cap: 4, dealt: 10 })
  })

  it('每一段都往上累加；帶標籤的檢定：感知 +1、抵抗誘惑 −1、抵抗控制 −2；80～99 檢定類的加減再算一次', () => {
    expect(at(10)).toMatchObject({ perception: 0, lure: 0, control: 0 })
    expect(at(25)).toMatchObject({ perception: 1, lure: -1, control: 0 })
    expect(at(45)).toMatchObject({ perception: 1, lure: -1, control: 0 })
    expect(at(65)).toMatchObject({ perception: 1, lure: -1, control: -2 })
    expect(at(85)).toMatchObject({ perception: 2, lure: -2, control: -4 })
    // 80～99 以外不加倍（P18：檢定的加減只在這一段加倍；承受層數與同步上限的加成不加倍）
    expect(at(105)).toMatchObject({ perception: 1, lure: -1, control: -2 })
  })

  it('被動效果的來源標著 sink；畫面列得失用 k.passives.of，名字是分段的名字', () => {
    const g = make({ pc: { sink: 45 } })
    const entries = g.k.passives.of(g.state, 'pc').filter((e) => e.source === 'sink')
    expect(entries.map((e) => e.label)).toEqual(['微醺', '微醺', '貪歡', '貪歡', '貪歡'])
  })

  it('別人的沉溺不影響主角；每個人各算各的', () => {
    const { game } = makeGame({
      features: [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), characterFeature, sinkFeature], content: [METER_CONTENT], seed: 7,
      pc: { sink: 0 }, actors: [makeActor({ id: 'npc_x', role: 'npc', name: '路人', sink: 65 })],
    })
    expect(game.k.passives.checkParts(game.state, 'pc', { skill: 'composure', tags: [] })).toEqual([])
    expect(game.k.passives.checkParts(game.state, 'npc_x', { skill: 'composure', tags: [] }).reduce((n, p) => n + p.value, 0)).toBe(-2)
  })

  it('規則表蓋掉分段：換一組段、不認得的欄位忽略', () => {
    const g = make({ pc: { sink: 30 }, pack: pack((c) => { c.sink_rule = [{ id: 'default', bands: [{ min: 0, id: 'a', name: '甲', effects: [] }, { min: 30, id: 'b', name: '乙', effects: [{ stat: 'afterglow_cap', amount: 5 }] }], over_step: 10 }] }) })
    expect(g.k.stats.stat(g.state, 'pc', 'afterglow_cap')).toBe(8)
    expect(bandOf(sinkRules(g.k), 30).id).toBe('b')
  })

  it('規則表格式不對在載入時擋下（第一段不是 0、段沒有由低到高、被動效果寫錯、watchers 查不到）', () => {
    const bad = (rule: Rec) => () => make({ pack: pack((c) => { c.sink_rule = [{ id: 'default', ...rule }] }) })
    expect(bad({ bands: [{ min: 5, id: 'a', name: 'a', effects: [] }] })).toThrow(ContentError)
    expect(bad({ bands: [{ min: 0, id: 'a', name: 'a', effects: [] }, { min: 0, id: 'b', name: 'b', effects: [] }] })).toThrow(ContentError)
    expect(bad({ bands: [{ min: 0, id: 'a', name: 'a', effects: [{ nothing: 1 }] }] })).toThrow(ContentError)
    expect(bad({ watchers: ['f_nobody'] })).toThrow(ContentError)
    expect(bad({ decay: { amount: -1 } })).toThrow(ContentError)
  })
})

// ---- 每週 ----

describe('每週一：自然下降與每週的事', () => {
  it('上一週睡了四次的人週一沉溺 −2；睡三次的不降', () => {
    const g = make({ pc: { sink: 20 } })
    count(g, 0, 4)
    advanceTo(g, 7, 7)
    expect(pc(g).sink).toBe(18)
    const h = make({ pc: { sink: 20 } })
    count(h, 0, 3)
    advanceTo(h, 7, 7)
    expect(pc(h).sink).toBe(20)
    expect(weekReports(h)).toHaveLength(0)
  })

  it('下限 10、沉溺 11 的人只降到 10；沉溺 100 的不降', () => {
    const g = make({ pc: { sink: 11 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 10 }])
    expect(pc(g).sink).toBe(11)
    count(g, 0, 4)
    advanceTo(g, 7, 7)
    expect(pc(g).sink).toBe(10)
    const h = make({ pc: { sink: 100 } })
    count(h, 0, 4)
    advanceTo(h, 7, 7)
    expect(pc(h).sink).toBe(100)
  })

  it('65 的人週一那份報告替規則表列的兩個假勢力各 +1；45 的人那份報告帶觸發點 impulse', () => {
    const g = make({ pc: { sink: 65 } })
    advanceTo(g, 7, 7)
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(1)
    expect(meterOf(g.k, g.state, 'hostility', 'f_beta')).toBe(1)
    expect(weekReports(g)).toHaveLength(1)
    expect(weekReports(g)[0]!.triggers).toBeUndefined()
    // 句子不帶機制數字
    expect(weekReports(g)[0]!.outcome.summary).not.toMatch(/\d/)

    const h = make({ pc: { sink: 45 } })
    advanceTo(h, 7, 7)
    const r = weekReports(h)
    expect(r).toHaveLength(1)
    expect(r[0]!.triggers).toEqual([{ point: 'impulse', where: expect.objectContaining({ district: 'test' }) }])
    expect(meterOf(h.k, h.state, 'hostility', 'f_alpha')).toBe(0)
  })

  it('同一個人睡夠又在 65：降沉溺與加敵對值在同一份報告；分段照降之前的那一段算', () => {
    const g = make({ pc: { sink: 60 } })
    count(g, 0, 4)
    advanceTo(g, 7, 7)
    expect(pc(g).sink).toBe(58)
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(1)
    expect(weekReports(g)).toHaveLength(1)
  })

  it('沒有任何事發生就不出報告（沉溺低、沒睡夠；或沉溺 20～39 沒有每週的事）', () => {
    const g = make({ pc: { sink: 25 } })
    advanceTo(g, 7, 7)
    expect(weekReports(g)).toHaveLength(0)
    const h = make({ pc: { sink: 0 } })
    count(h, 0, 9)
    advanceTo(h, 7, 7)
    expect(weekReports(h)).toHaveLength(0)
    expect(pc(h).sink).toBe(0)
  })

  it('一次跨三週補三次：每週各自讀自己的上一週', () => {
    const g = make({ pc: { sink: 20 } })
    count(g, 0, 4); count(g, 1, 4); count(g, 2, 4)
    advanceTo(g, 21, 7)
    expect(pc(g).sink).toBe(14)
    expect(weekReports(g)).toHaveLength(3)
    // 中間那一週沒睡夠的：不降
    const h = make({ pc: { sink: 20 } })
    count(h, 0, 4); count(h, 1, 2); count(h, 2, 4)
    advanceTo(h, 21, 7)
    expect(pc(h).sink).toBe(16)
    expect(weekReports(h)).toHaveLength(2)
  })

  it('一次跨五週最多補最近的三次', () => {
    const g = make({ pc: { sink: 40 } })
    for (let w = 0; w < 5; w++) count(g, w, 4)
    advanceTo(g, 35, 7)
    expect(pc(g).sink).toBe(34)
    expect(weekReports(g)).toHaveLength(3)
  })

  it('沉溺降到 100 以下才又開始降：跨週的時候一週一週接著算', () => {
    const g = make({ pc: { sink: 101 } })
    count(g, 0, 4); count(g, 1, 4)
    advanceTo(g, 14, 7)
    expect(pc(g).sink).toBe(101)
  })

  it('一次停留在 40 ～ 59 的人，每跨一個週一就發一次衝動', () => {
    const g = make({ pc: { sink: 45 } })
    advanceTo(g, 21, 7)
    expect(weekReports(g)).toHaveLength(3)
    expect(weekReports(g).every((r) => r.triggers?.[0]?.point === 'impulse')).toBe(true)
  })

  it('沒有裝量表 hostility 的局：每週的敵對值略過，其餘照常', () => {
    const { game } = makeGame({
      features: [characterFeature, restFeature, sinkFeature], content: [METER_CONTENT], seed: 7, pc: { sink: 65 },
      patch: { time: { day: 3, hour: 10, minute: 0 } },
    })
    advanceTo(game as G, 7, 7)
    expect(weekReports(game as G)).toHaveLength(0)
    expect(pc(game as G).sink).toBe(65)
  })
})

// ---- 睡一覺的計數器 ----

describe('rest：睡一覺的那一份報告多一筆計數器', () => {
  it('睡一覺之後 sleeps:<週> 多 1；喘口氣不算', () => {
    const g = make()
    expect(g.state.counters['sleeps:0']).toBeUndefined()
    g.commit(sleepDraft(g.k, g.state))
    expect(g.state.counters['sleeps:0']).toBe(1)
  })

  it('睡下去那一刻在哪一週就記哪一週：第 7 天 06:00 之後睡的記在第 1 週', () => {
    const g = make()
    advanceTo(g, 7, 7)
    g.commit(sleepDraft(g.k, g.state))
    expect(g.state.counters['sleeps:1']).toBe(1)
    expect(g.state.counters['sleeps:0']).toBeUndefined()
  })

  it('真的睡四次（每天一次）到週一，沉溺 −2；睡三次不降', () => {
    const g = make({ pc: { sink: 20 } })
    for (let day = 3; day <= 6; day++) {
      advanceTo(g, day, 10)
      g.commit(sleepDraft(g.k, g.state))
    }
    expect(g.state.counters['sleeps:0']).toBe(4)
    advanceTo(g, 7, 7)
    expect(pc(g).sink).toBe(18)
    const h = make({ pc: { sink: 20 } })
    for (let day = 3; day <= 5; day++) {
      advanceTo(h, day, 10)
      h.commit(sleepDraft(h.k, h.state))
    }
    advanceTo(h, 7, 7)
    expect(pc(h).sink).toBe(20)
  })
})

// ---- 效果 sink_floor ----

describe('效果 sink_floor：暫時或永久的下限加減', () => {
  it('{ amount: 5, days: 7 } 讓下限 +5、沉溺不到的補上；七天後下限回來、沉溺留著', () => {
    const g = make({ pc: { sink: 2 } })
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(0)
    applyFx(g, [{ kind: 'sink_floor', amount: 5, days: 7 }])
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(5)
    expect(pc(g).sink).toBe(5)
    advance(g, 7 * 1440 - 1)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(5)
    advance(g, 1)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(0)
    expect(pc(g).sink).toBe(5)
  })

  it('沉溺本來就比新的下限高：不動；永久的那一種一直在', () => {
    const g = make({ pc: { sink: 30 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 5 }])
    expect(pc(g).sink).toBe(30)
    advance(g, 100 * 1440)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(5)
  })

  it('負的（抑制劑）把下限壓低；不補沉溺；和別的來源合計，最少 0', () => {
    const g = make({ pc: { sink: 10 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 8 }])
    applyFx(g, [{ kind: 'sink_floor', amount: -10, days: 7 }])
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(0)
    expect(pc(g).sink).toBe(10)
    advance(g, 7 * 1440)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(8)
  })

  it('下限擋住 sink 效果往下降；過期的在下一次寫的時候清掉', () => {
    const g = make({ pc: { sink: 0 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 5, days: 1 }])
    advance(g, 1440)
    applyFx(g, [{ kind: 'sink_floor', amount: 3 }])
    const mods = (g.state.actors.pc!.ext.sink as Rec).floor_mods as Rec[]
    expect(mods).toHaveLength(1)
    expect(mods[0]).toMatchObject({ amount: 3 })
    expect(mods[0]!.until).toBeUndefined()
  })

  it('只有內建的來源能用：AI 與玩家要的結果都被擋；格式不對也擋', () => {
    const g = make()
    for (const source of ['ai', 'player'] as const) {
      const ctx = effectCtx(g.k, g.state, { source, actor: 'pc' })
      expect(g.k.effects.validate([{ kind: 'sink_floor', amount: 5 }], ctx).length).toBeGreaterThan(0)
    }
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    for (const bad of [{ amount: 0 }, { amount: 1.5 }, { amount: 5, days: 0 }, { amount: 5, days: 400 }, { amount: 5, days: 2.5 }, { amount: 5000 }]) {
      expect(g.k.effects.validate([{ kind: 'sink_floor', ...bad }], ctx).length).toBeGreaterThan(0)
    }
  })

  it('同一批效果裡先加下限再降沉溺：降的那一筆看得到新的下限（只降到下限）', () => {
    const g = make({ pc: { sink: 20 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 15 }, { kind: 'sink', amount: -9 }])
    expect(pc(g).sink).toBe(15)
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(15)
  })
})

// ---- 治療 ----

describe('治療：心理治療與斷線靜修', () => {
  it('心理治療：扣 1,000、時間 +4 小時、沉溺 −5', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F1')
    const before = toMinutes(g.state.time)
    const quote = therapyQuote(g.k, g.state)
    expect(quote).toMatchObject({ kind: 'counsel', price: 1000, minutes: 240, amount: 5 })
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).sink).toBe(25)
    expect(g.state.money.cred).toBe(19000)
    expect(toMinutes(g.state.time) - before).toBe(240)
    const r = g.state.reports.at(-1)!
    expect(r.action).toBe('sink.therapy')
    expect(r.outcome.result).toBe('counsel')
    expect(r.outcome.summary).not.toMatch(/\d/)
  })

  it('同一週第二次被擋；下個週一可以再做', () => {
    const g = make({ pc: { sink: 40 } })
    stand(g, 'F1')
    g.commit(therapyDraft(g.k, g.state))
    expect(therapyBlock(g.k, g.state)).toBe('這一週已經做過心理治療了，下個週一再來。')
    expect(reasonOf(() => therapyDraft(g.k, g.state))).toBe('這一週已經做過心理治療了，下個週一再來。')
    advanceTo(g, 7, 7)
    stand(g, 'F1')
    expect(therapyBlock(g.k, g.state)).toBeNull()
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).sink).toBe(30)
  })

  it('沉溺 100 以上兩種都擋下', () => {
    const g = make({ pc: { sink: 100 } })
    stand(g, 'F1')
    expect(therapyBlock(g.k, g.state)).toBe('你已經不想回去了。')
    stand(g, 'F2')
    expect(therapyBlock(g.k, g.state, { kind: 'retreat' })).toBe('你已經不想回去了。')
    expect(reasonOf(() => therapyDraft(g.k, g.state))).toBe('你已經不想回去了。')
    expect(g.state.money.cred).toBe(20000)
  })

  it('斷線靜修只是開始：記下進行中的（哪一間、什麼時候結束、結束時降多少），時間沒動、沉溺沒降、不收錢；之後是活動 retreat', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F2')
    const before = toMinutes(g.state.time)
    const [r] = g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    expect(r!.action).toBe('sink.therapy')
    expect(r!.outcome.result).toBe('retreat_begin')
    expect(pc(g).sink).toBe(30)
    expect(toMinutes(g.state.time)).toBe(before)
    expect(g.state.money).toMatchObject({ cred: 20000, cash: 1000 })
    expect(retreatOf(g.state)).toEqual({ facility: '傳教所', since: before, until: before + 3 * 1440, amount: 6, from: 30 })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['retreat'])
    expect(retreatView(g.state)).toMatchObject({ facility: '傳教所', days_left: 3, minutes_left: 3 * 1440, amount: 6, from: 30, step: 1440 })
  })

  it('進行中：橋關著、不能潛入、不能做別的事（連再開一次治療也不行），放行的只有 sink.retreat 與事件、戰鬥', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F2')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    for (const a of ['dive.enter', 'rest.sleep', 'trade.checkout', 'commission.go', 'curtain.enter', 'sink.therapy', 'world.move']) expect(g.blockOf(`commit:${a}`), a).toMatch(/斷線靜修/)
    expect(g.blockOf('commit:sink.retreat')).toBeNull()
    for (const a of ['commit:event.choose', 'event.start', 'battle.start', 'commit:battle.end']) expect(g.blockOf(a), a).toBeNull()
    expect(therapyBlock(g.k, g.state)).toBeTruthy()
    expect(reasonOf(() => therapyDraft(g.k, g.state, { kind: 'retreat' }))).toBeTruthy()
    expect(g.blockOf('commit:dive.enter')).toContain('不能潛入')
  })

  it('待下去：一天一天過；最後一天結算（沉溺 −6、進行中的記號拿掉、活動結束）；結算之前沉溺都沒有動', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F2')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    const start = toMinutes(g.state.time)
    const [d1] = g.commit(retreatStayDraft(g.k, g.state))
    expect(d1!.action).toBe('sink.retreat')
    expect(d1!.outcome.result).toBe('stay')
    expect(toMinutes(g.state.time) - start).toBe(1440)
    expect(pc(g).sink).toBe(30)
    expect(retreatView(g.state)).toMatchObject({ days_left: 2 })
    g.commit(retreatStayDraft(g.k, g.state))
    expect(pc(g).sink).toBe(30)
    const done = g.commit(retreatStayDraft(g.k, g.state))
    expect(done.map((r) => r.outcome.result)).toEqual(['last_day', 'done'])
    expect(toMinutes(g.state.time) - start).toBe(3 * 1440)
    expect(pc(g).sink).toBe(24)
    expect(retreatOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(g.state.money).toMatchObject({ cred: 20000, cash: 1000 })
    expect(done[1]!.timeline[0]!.data).toMatchObject({ from: 30, dropped: 6 })
    // 靜修沒有每週一次的限制；結算之後什麼都能做
    expect(g.blockOf('commit:rest.sleep')).toBeNull()
    expect(therapyBlock(g.k, g.state)).toBeNull()
    g.commit(therapyDraft(g.k, g.state))
    expect(retreatOf(g.state)).toBeTruthy()
  })

  it('提早離開：不結算（沉溺不降），已經過去的時間不退，橋回來了、活動結束', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F2')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    const start = toMinutes(g.state.time)
    g.commit(retreatStayDraft(g.k, g.state))
    const [r] = g.commit(retreatLeaveDraft(g.k, g.state))
    expect(r!.outcome.result).toBe('left')
    expect(pc(g).sink).toBe(30)
    expect(toMinutes(g.state.time) - start).toBe(1440)
    expect(retreatOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    // 沒有在靜修時待不下去、離不開
    expect(reasonOf(() => retreatStayDraft(g.k, g.state))).toContain('不在斷線靜修')
    expect(reasonOf(() => retreatLeaveDraft(g.k, g.state))).toContain('不在斷線靜修')
  })

  it('時間被別的事推過了結束：下一份報告就結算（不用再待）；結算時被下限擋住的照實際降的算', () => {
    const g = make({ pc: { sink: 12 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 10 }])
    stand(g, 'F2')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    // 一件意外的事讓時間一下子過了四天（事件的結果之類）：放行的 commit:event.
    const rs = g.commit(draft([{ op: 'time', minutes: 4 * 1440 }], 'event.test'))
    expect(rs.map((r) => r.action)).toEqual(['event.test', 'sink.retreat'])
    expect(rs[1]!.outcome.result).toBe('done')
    expect(pc(g).sink).toBe(10)
    expect(retreatOf(g.state)).toBeNull()
  })

  it('斷線靜修只能自己去（別人代做被擋）；存檔再讀進行中的還在；回到快照（撤退）時跟著回去', () => {
    const g = make({ pc: { sink: 30 }, extra: [] })
    g.state.actors.mate = makeActor({ id: 'mate', name: '同伴', sink: 40 })
    stand(g, 'F2')
    expect(therapyBlock(g.k, g.state, { kind: 'retreat', actor: 'mate' })).toBe('斷線靜修只能自己去。')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    const again = make({ pc: { sink: 30 } })
    expect(again.load(g.save())).toBeNull()
    expect(retreatOf(again.state)).toEqual(retreatOf(g.state))
    expect(again.k.activity.active(again.state).map((a) => a.kind)).toEqual(['retreat'])
  })

  it('心理治療的價錢乘這一區的物價倍率（sink_rule.therapy.counsel.district_price，預設乘；M4 收尾修正批；DOWNTIME 3.3 節「1,000 × 區倍率」）；靜修免費不受影響', () => {
    const priced = (mult: number, counsel?: Rec) => make({ pc: { sink: 30 }, pack: pack((c) => { c.district![0]!.price_mult = mult; if (counsel) c.sink_rule = [{ id: 'default', watchers: ['f_alpha', 'f_beta'], therapy: { counsel } }] }) })
    const g = priced(2)
    stand(g, 'F1')
    expect(therapyQuote(g.k, g.state)).toMatchObject({ price: 2000 })
    g.commit(therapyDraft(g.k, g.state))
    expect(g.state.money.cred).toBe(18000)
    const off = priced(2, { district_price: false })
    stand(off, 'F1')
    expect(therapyQuote(off.k, off.state)).toMatchObject({ price: 1000 })
    const plain = priced(1)
    stand(plain, 'F1')
    expect(therapyQuote(plain.k, plain.state)).toMatchObject({ price: 1000 })
    // 免費的義診所不收；靜修本來就不收
    const free = priced(3)
    stand(free, 'F4')
    expect(therapyQuote(free.k, free.state)).toMatchObject({ price: 0 })
    stand(free, 'F2')
    expect(therapyQuote(free.k, free.state, { kind: 'retreat' })).toMatchObject({ price: 0 })
  })

  it('設施寫了 favor：那個勢力的好感要夠；查不到好感的量表當作不夠', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F3')
    expect(therapyBlock(g.k, g.state)).toBe('阿爾法公司對你的好感還不夠，要好感的傳教所不會讓你進去靜修。')
    g.commit(draft([{ op: 'meter', kind: 'favor', key: 'f_alpha', delta: 20 }]))
    expect(therapyBlock(g.k, g.state)).toBeNull()
    g.commit(therapyDraft(g.k, g.state))
    expect(retreatOf(g.state)).toBeTruthy()
    const h = make({ pc: { sink: 30 }, noFavor: true })
    stand(h, 'F3')
    expect(therapyBlock(h.k, h.state)).toContain('好感還不夠')
  })

  it('心理治療要在做心理治療的設施：沒有設施、設施種類不對、設施免費都各有原因', () => {
    const g = make({ pc: { sink: 30 } })
    expect(therapyBlock(g.k, g.state)).toBe('這裡沒有做沉溺治療的地方。')
    expect(therapyBlock(g.k, g.state, { kind: 'counsel' })).toBe('這裡沒有做心理治療的地方。')
    expect(therapyBlock(g.k, g.state, { kind: 'retreat' })).toBe('這裡沒有可以斷線靜修的地方。')
    stand(g, 'F2')
    expect(therapyBlock(g.k, g.state, { kind: 'counsel' })).toBe('這裡只做斷線靜修，不做心理治療。')
    stand(g, 'F1')
    expect(therapyBlock(g.k, g.state, { kind: 'retreat' })).toBe('這裡只做心理治療，不能斷線靜修。')
    stand(g, 'F4')
    g.commit(therapyDraft(g.k, g.state))
    expect(g.state.money.cred).toBe(20000)
    expect(pc(g).sink).toBe(25)
  })

  it('錢不夠：付不起就擋；現金可以付', () => {
    const g = make({ pc: { sink: 30 }, money: { cred: 100, cash: 100 } })
    stand(g, 'F1')
    expect(therapyBlock(g.k, g.state)).toContain('錢不夠')
    const h = make({ pc: { sink: 30 }, money: { cred: 100, cash: 1500 } })
    stand(h, 'F1')
    h.commit(therapyDraft(h.k, h.state))
    expect(h.state.money).toMatchObject({ cred: 100, cash: 500 })
  })

  it('下限擋住：已經浮在最低處就不收這筆錢；只擋一部分照實際降的算', () => {
    const g = make({ pc: { sink: 12 } })
    applyFx(g, [{ kind: 'sink_floor', amount: 10 }])
    stand(g, 'F1')
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).sink).toBe(10)
    advanceTo(g, 7, 7)
    stand(g, 'F1')
    expect(therapyBlock(g.k, g.state)).toBe('你已經浮在身上的義體撐著的最低處，治療幫不上忙。')
    const h = make({ pc: { sink: 0 } })
    stand(h, 'F1')
    expect(therapyBlock(h.k, h.state)).toBe('你現在很清明，用不著治療。')
  })

  it('規則表蓋掉治療的數字；設施的 therapy 格式不對在載入時擋下', () => {
    const g = make({ pc: { sink: 30 }, pack: pack((c) => { c.sink_rule = [{ id: 'default', therapy: { counsel: { amount: 3, price: 50, minutes: 60 }, retreat: { amount: 9, days: 1 } } }] }) })
    stand(g, 'F1')
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).sink).toBe(27)
    expect(g.state.money.cred).toBe(19950)
    for (const bad of [{ kind: 'spa' }, { kind: 'retreat', free: 'yes' }, { kind: 'retreat', favor: { faction: 'f_nobody', min: 5 } }, { kind: 'retreat', favor: { faction: 'f_alpha', min: 500 } }]) {
      expect(() => make({ pack: pack((c) => { c.facility_type = [...c.facility_type!, { id: 'fac_x', name: '壞的', therapy: bad }] }) })).toThrow(ContentError)
    }
  })

  it('沒有主角時擋下', () => {
    const g = make()
    const k = g.k
    expect(therapyBlock(k, { ...g.state, pc: null } as never)).toBe('還沒有主角。')
  })
})

// ---- 別人看到的沉溺 ----

/** 測試的替身：讓人看起來低一段（−20）的 provider，像抑制劑與面具。 */
const HIDE: Feature = {
  id: 'hide_stub',
  install(k) {
    k.stats.addStatProvider('sink_shown', 'hide_stub', () => [{ label: '抑制劑', value: -20, source: 'situation' }])
  },
}

describe('sink_shown 與 sinkView', () => {
  it('沒人加 provider 時看到的就是真正的沉溺', () => {
    const g = make({ pc: { sink: 65 } })
    expect(g.k.stats.stat(g.state, 'pc', 'sink_shown')).toBe(65)
  })

  it('加一個 −20 的 provider：真正 65 的人看到的是 45，分段的效果還是照 65；最少 0', () => {
    const g = make({ pc: { sink: 65 }, extra: [HIDE] })
    expect(g.k.stats.stat(g.state, 'pc', 'sink_shown')).toBe(45)
    expect(g.k.passives.checkParts(g.state, 'pc', { skill: 'composure', tags: [] }).reduce((n, p) => n + p.value, 0)).toBe(-2)
    const h = make({ pc: { sink: 10 }, extra: [HIDE] })
    expect(h.k.stats.stat(h.state, 'pc', 'sink_shown')).toBe(0)
  })

  it('sinkView：現在的值、下限與組成、哪一段、得失、看到的沉溺、這一週睡了幾次', () => {
    const g = make({ pc: { sink: 65 }, extra: [HIDE] })
    applyFx(g, [{ kind: 'sink_floor', amount: 4, days: 3, why: '換橋' }])
    count(g, 0, 2)
    const v = sinkView(g.k, g.state, 'pc')!
    expect(v).toMatchObject({ value: 65, floor: 4, shown: 45, sunk: false, sleeps: 2, sleepsNeeded: 4, decaysNextMonday: false, counselUsed: 0, counselPerWeek: 1, week: 0 })
    expect(v.band).toEqual({ id: 'drunk', name: '迷醉', min: 60 })
    expect(v.next).toEqual({ id: 'edge', name: '溺感邊緣', min: 80 })
    expect(v.shownBand.id).toBe('indulgent')
    expect(v.floorMods).toEqual([expect.objectContaining({ amount: 4, why: '換橋' })])
    expect(v.floorParts.filter((p) => p.source !== 'base').map((p) => p.value)).toEqual([4])
    expect(v.effects.length).toBeGreaterThan(0)
    expect(v.effects.every((e) => e.source === 'sink')).toBe(true)
    count(g, 0, 2)
    expect(sinkView(g.k, g.state, 'pc')!.decaysNextMonday).toBe(true)
    expect(sinkView(g.k, g.state, 'nobody')).toBeNull()
  })

  it('sinkView：心理治療做過之後這一週用掉一次；溺感者不會自然下降', () => {
    const g = make({ pc: { sink: 40 } })
    stand(g, 'F1')
    g.commit(therapyDraft(g.k, g.state))
    expect(sinkView(g.k, g.state, 'pc')).toMatchObject({ counselUsed: 1, value: 35 })
    const h = make({ pc: { sink: 120 } })
    count(h, 0, 9)
    expect(sinkView(h.k, h.state, 'pc')).toMatchObject({ sunk: true, decaysNextMonday: false })
  })
})

// ---- 條件 sunk ----

describe('條件 sunk', () => {
  const test = (g: G, actor?: string) => g.k.conditions.test({ kind: 'sunk' } as Condition, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules, ...(actor ? { actor } : {}) })
  it('沉溺 100 以上成立；99 不成立；預設看主角，ctx.actor 看別人', () => {
    expect(test(make({ pc: { sink: 99 } }))).toBe(false)
    expect(test(make({ pc: { sink: 100 } }))).toBe(true)
    expect(test(make({ pc: { sink: 300 } }))).toBe(true)
    const { game } = makeGame({
      features: [characterFeature, sinkFeature], seed: 7, pc: { sink: 0 },
      actors: [makeActor({ id: 'npc_x', role: 'npc', name: '路人', sink: 120 })],
    })
    expect(game.k.conditions.test({ kind: 'sunk' } as Condition, { state: game.state, stats: game.k.stats, timeRules: game.k.timeRules })).toBe(false)
    expect(game.k.conditions.test({ kind: 'sunk' } as Condition, { state: game.state, actor: 'npc_x', stats: game.k.stats, timeRules: game.k.timeRules })).toBe(true)
  })
})

// ---- 長時間帶著餘韻 ----

describe('長時間帶著餘韻（DOWNTIME 3.2 節）', () => {
  const glow = (g: G, delta: number) => g.commit(draft([{ op: 'actor.track', id: 'pc', track: 'afterglow', delta }, { op: 'time', minutes: 1 }], 'test.glow'))
  const carry = (g: G) => (g.state.actors.pc!.ext.sink as Rec | undefined)?.carry_from

  it('帶著一層餘韻過 13 小時：沉溺 +2（沒有自然消退的局；算到「這一次時間經過的起點」，所以隔一次時間經過補上）', () => {
    const g = make({ bare: true, pc: { sink: 5 } })
    glow(g, 1)
    expect(carry(g)).toBe(toMinutes(g.state.time))
    advance(g, 13 * 60)
    expect(pc(g).sink).toBe(5)
    advance(g, 1)
    expect(pc(g).sink).toBe(7)
    expect(g.state.reports.some((r) => r.action === 'sink.carry' && r.outcome.result === 'carried')).toBe(true)
    // 已經算過的不重複；再滿 6 小時再加一次
    advance(g, 1)
    expect(pc(g).sink).toBe(7)
    advance(g, 5 * 60)
    advance(g, 1)
    expect(pc(g).sink).toBe(8)
  })

  it('帶著 sink_resist 的人，餘韻帶久了的沉溺每一次少 1、最少 1（M4 收尾修正批 應修 5）：每次 +2 的規則表，+2 變 +1；沒帶的照舊 +2；每次 +1 的不變', () => {
    const carryPack = (amount: number) => pack((c) => { c.sink_rule = [{ id: 'default', watchers: ['f_alpha', 'f_beta'], afterglow_carry: { hours: 6, amount } }] })
    const after13h = (o: Opts): number => {
      const g = make({ bare: true, pc: { sink: 5 }, ...o })
      glow(g, 1)
      advance(g, 13 * 60)
      advance(g, 1)
      return pc(g).sink
    }
    // 13 小時是兩次
    expect(after13h({ pack: carryPack(2), extra: [RESIST_FX] })).toBe(7)
    expect(after13h({ pack: carryPack(2) })).toBe(9)
    expect(after13h({ pack: carryPack(3), extra: [RESIST_FX] })).toBe(9)
    expect(after13h({ pack: carryPack(3) })).toBe(11)
    // 預設每次 +1：最少 1，帶著與沒帶一樣
    expect(after13h({ extra: [RESIST_FX] })).toBe(7)
    expect(after13h({})).toBe(7)
  })

  it('中間餘韻消過的重新算（消完清掉記號；消了一部分重新起算）', () => {
    const g = make({ bare: true, pc: { sink: 5 } })
    glow(g, 1)
    advance(g, 5 * 60)
    glow(g, -1)
    expect(carry(g)).toBeUndefined()
    glow(g, 1)
    advance(g, 5 * 60 + 58)
    advance(g, 1)
    expect(pc(g).sink).toBe(5)

    const h = make({ bare: true, pc: { sink: 5, afterglow: 0 } })
    glow(h, 2)
    advance(h, 5 * 60)
    glow(h, -1)
    expect(carry(h)).toBe(toMinutes(h.state.time))
    advance(h, 5 * 60 + 58)
    advance(h, 1)
    expect(pc(h).sink).toBe(5)
  })

  it('平常餘韻會自己消退（character），所以一次長時間的行動不會誤加沉溺', () => {
    const g = make({ pc: { sink: 5 } })
    glow(g, 1)
    advance(g, 13 * 60)
    advance(g, 1)
    advance(g, 60)
    expect(pc(g).afterglow).toBe(0)
    expect(pc(g).sink).toBe(5)
    expect(carry(g)).toBeUndefined()
  })

  it('睡一覺把餘韻清掉：記號也清掉', () => {
    const g = make({ bare: true, pc: { sink: 5 } })
    glow(g, 1)
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).afterglow).toBe(0)
    expect(carry(g)).toBeUndefined()
  })

  it('開局就帶著餘韻（沒有起點）：從第一次時間經過的起點算；規則表可以改小時數與加幾點', () => {
    const g = make({ bare: true, pc: { sink: 5, afterglow: 1 }, pack: pack((c) => { c.sink_rule = [{ id: 'default', afterglow_carry: { hours: 1, amount: 2 } }] }) })
    advance(g, 10)
    expect(carry(g)).toBe(toMinutes(g.state.time) - 10)
    advance(g, 130)
    expect(pc(g).sink).toBe(5)
    advance(g, 1)
    expect(pc(g).sink).toBe(9)
  })
})

// ---- 其餘 ----

describe('其餘', () => {
  it('沒有 sink_rule 資料時用內建的分段；規則表的預設就是 CORE_RULES 4.3 節那張', () => {
    const g = make({ pack: pack((c) => { delete c.sink_rule }) })
    const rules = sinkRules(g.k)
    expect(rules.bands.map((b) => b.min)).toEqual([0, 20, 40, 60, 80, 100])
    expect(rules.decay).toEqual({ amount: 2, sleeps: 4 })
    expect(rules.hide_step).toBe(20)
    expect(rules.over_step).toBe(25)
    expect(rules.therapy.counsel).toEqual({ amount: 5, minutes: 240, price: 1000, per_week: 1 })
    expect(rules.therapy.retreat).toEqual({ amount: 6, days: 3 })
    expect(rules.afterglow_carry).toEqual({ hours: 6, amount: 1 })
    expect(rules.watchers).toEqual([])
  })

  it('沒有 watchers（預設空的）時 65 的人週一不加任何敵對值、也不出報告', () => {
    const g = make({ pc: { sink: 65 }, pack: pack((c) => { delete c.sink_rule }) })
    advanceTo(g, 7, 7)
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(0)
    expect(weekReports(g)).toHaveLength(0)
  })

  it('存檔：actor.ext.sink 的壞欄位略過、不丟錯', () => {
    const g = make({ pc: { sink: 20, ext: { sink: { floor_mods: [{ amount: 'x' }, { amount: 3 }, 7, null], therapy_week: 'a', carry_from: 1.5 } } } })
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(3)
    expect(sinkView(g.k, g.state, 'pc')!.carryFrom).toBeNull()
  })
})

describe('M4-core-gaps 第 8 項：80～99 給核心的標籤 afterglow_double（餘韻的正面效果加倍）', () => {
  const tagged = (sink: number): boolean => {
    const g = make({ pc: { sink } })
    return g.k.passives.unitTags(g.state, 'pc').includes('afterglow_double')
  }

  it('沉溺 80、99 有；79、100、130 沒有（80～99 才加倍，溺感者不是）', () => {
    expect([79, 80, 99, 100, 130].map(tagged)).toEqual([false, true, true, false, false])
  })

  it('標籤來自 sink 這個來源（畫面看得到「溺感邊緣：餘韻的正面效果加倍」）', () => {
    const g = make({ pc: { sink: 85 } })
    const e = g.k.passives.of(g.state, 'pc').find((x) => 'unit_tag' in x && x.unit_tag === 'afterglow_double')!
    expect(e.source).toBe('sink')
    expect(e.label).toContain('餘韻的正面效果加倍')
  })
})

describe('往上加沉溺的共用路（sinkUpChanges；M4 收尾修正批 應修 5、裁決 6）', () => {
  const up = (g: G, amount: number, times = 1) => {
    const changes = sinkUpChanges(g.k, g.state, 'pc', amount, times)
    const before = g.state.actors.pc!.sink
    g.commit(draft(changes, 'test.up'))
    return g.state.actors.pc!.sink - before
  }

  it('沒帶 sink_resist：照原本的量；amount、times 不是正整數沒有變更', () => {
    const g = make({ bare: true, pc: { sink: 5 } })
    expect(up(g, 1)).toBe(1)
    expect(up(g, 4)).toBe(4)
    expect(up(g, 2, 3)).toBe(6)
    expect(sinkUpChanges(g.k, g.state, 'pc', 0)).toEqual([])
    expect(sinkUpChanges(g.k, g.state, 'pc', -2)).toEqual([])
    expect(sinkUpChanges(g.k, g.state, 'pc', 1.5)).toEqual([])
    expect(sinkUpChanges(g.k, g.state, 'pc', 2, 0)).toEqual([])
  })

  it('帶 sink_resist：每一次少 1、最少 1（+1 還是 +1、+2 變 +1、+5 變 +4）；三次各算一次', () => {
    const g = make({ pc: { sink: 5 }, extra: [RESIST] })
    expect(g.k.effects.has('sink')).toBe(true)
    expect(up(g, 1)).toBe(1)
    expect(up(g, 2)).toBe(1)
    expect(up(g, 5)).toBe(4)
    expect(up(g, 2, 3)).toBe(3)
  })

  it('沒有人註冊 sink 效果（沒裝 character）：直接寫 actor.track，不看 sink_resist', () => {
    const g = make({ bare: true, pc: { sink: 5 }, extra: [RESIST] })
    expect(g.k.effects.has('sink')).toBe(false)
    expect(up(g, 2)).toBe(2)
  })
})
