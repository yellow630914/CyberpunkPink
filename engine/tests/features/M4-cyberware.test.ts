// 驗收測試：dev/work/M4-cyberware.md（cpp-feature）。規格：CYBERWARE 第 1～3 節（2.1 手術、併發症與休養；2.2 部位的代號）；CRAFTING 8.1、10.2 節；TRADE 3.4 節；DATA 7.1、3.4 節；dev/adr/0019 第三節與 P1～P6。
// 內容一律用測試自帶的最小假資料：義眼（一般、成本 3）、義臂（侵入、成本 6、板材 stats.armor 2、body +1）、全生體的獸耳、混裝的義臂、腦裡的小晶片、不用橋的板材、
// 橋，三種診所與一間雜貨店的設施，兩筆併發症。站上設施用真的 world；住處用測試的替身條件 at_home（旗標 home）；自己動刀的條件 ability 由測試的替身註冊（沒裝就沒有自己動刀）。
// 骰子：用 vi.spyOn(Rng.prototype, 'next') 固定每一次 next() 的值（只包住「建草稿」那一步，提交不受影響）。
//
// 時間：測試從第 3 天 10:00 開始。成品價 ＝ 零件目錄價合計 × 1.2：義臂 1200（正規診所 600、無照 360、黑 480）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, Rng, partsOf, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import {
  DEFAULT_CYBER_RULES, cyberOf, cyberView, cyberwareFeature, installBlock, installDraft, installProblems, installQuote, pieceSink, removeBlock, removeDraft, removeQuote, surgeons,
} from '../../src/features/cyberware'
import type { InstallOpts, RemoveOpts } from '../../src/features/cyberware'
import { arrive, worldFeature } from '../../src/features/world'
import { makeActor, makeGame, observed } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS = [
  part('pt_plate', 'plate', { price: 400, stats: { armor: 2 } }),
  part('pt_act', 'actuator', { price: 300 }),
  part('pt_neuron', 'neuron', { price: 300 }),
  part('pt_neuron_bio', 'neuron', { price: 300, material: 'bio' }),
  part('pt_neuron_hot', 'neuron', { price: 300, stats: { sink: 14 } }),
  part('pt_lens', 'sensor', { price: 500 }),
  part('pt_chip', 'chip', { price: 100 }),
  part('pt_ear', 'skin', { price: 500, material: 'bio' }),
  part('pt_plating', 'plate', { price: 250, stats: { armor: 3 } }),
  part('pt_bridge_chip', 'chip', { price: 1000 }),
]

const bp = (id: string, over: Rec = {}): Rec => ({
  id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 1, legal: 'register', price: 900, require: [], optional: [], ...over,
})
const BLUEPRINTS = [
  bp('bp_arm', {
    name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 3, tags: ['limb'], effects: [{ attr: 'body', amount: 1 }],
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }],
  }),
  bp('bp_mixarm', {
    name: '混裝義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 3,
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }],
  }),
  bp('bp_eye', { name: '義眼', slot: 'eye', invasiveness: 'light', sink_cost: 3, grade: 1, require: [{ type: 'sensor' }] }),
  bp('bp_ears', {
    name: '獸耳', slot: 'ear_throat', invasiveness: 'light', sink_cost: 4, grade: 1, needs_bridge: false, tags: ['bio'],
    require: [{ type: 'skin', material: 'bio' }], effects: [{ attr: 'charm', amount: 1 }],
    scene_parts: { adds: ['ear'], sensitivity: { ear: 15, all: 2 } },
  }),
  bp('bp_chip', { name: '小晶片', slot: 'brain', invasiveness: 'light', sink_cost: 1, grade: 1, require: [{ type: 'chip' }] }),
  bp('bp_plating', { name: '皮下板材', slot: 'torso', invasiveness: 'light', sink_cost: 1, grade: 2, needs_bridge: false, require: [{ type: 'plate' }] }),
  bp('bp_bridge', { name: '邊緣橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, grade: 2, bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }] }),
]
const QUIRKS = [
  { id: 'cx_scar', name: '疤痕組織', desc: '縫合的地方留了疤。', kind: 'complication', pool: ['complication'], effects: [{ attr: 'reflex', amount: -1 }] },
  { id: 'cx_ache', name: '陰雨會痛', desc: '下雨天接口會痛。', kind: 'complication', pool: ['complication'], effects: [{ stat: 'max_hp', amount: -2 }] },
  { id: 'cx_echo', name: '殘響', desc: '前一個主人的感覺。', kind: 'echo', pool: ['used'] },
]

const ARM_PARTS = { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron' }

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_clinic', name: '診所', clinic: { grade: 'clinic' } },
      { id: 'fac_unlic', name: '無照診所', clinic: { grade: 'unlicensed' } },
      { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
      { id: 'fac_shop', name: '雜貨店' },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street', 'b_plain'] }],
    block: [
      { id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '正規診所' }, F2: { type: 'fac_unlic', name: '無照診所' }, F3: { type: 'fac_black', name: '黑診所' } } },
      { id: 'b_plain', district: 'd_hive', name: '雜貨街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '雜貨店' } } },
    ],
    part: structuredClone(PARTS),
    blueprint: structuredClone(BLUEPRINTS),
    quirk: structuredClone(QUIRKS),
  }
  patch(c)
  return { id: 'cyberware_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：衍生數值 armor（gear 的那個；義體上的板材加在它上面）、條件 at_home（旗標 home 在就是在家）。 */
const STUBS: Feature = {
  id: 'cyber_stubs',
  install(k) {
    k.stats.defineStat({ id: 'armor', owner: 'cyber_stubs', name: '護甲值', base: () => 0 })
    k.conditions.register<Condition>({ kind: 'at_home', owner: 'cyber_stubs', validate: () => [], test: (_c, { state }) => state.flags.home === true })
  },
}
/** 測試的替身：條件 ability 永遠成立（abilities 註冊的那個；沒裝它就沒有自己動刀）。 */
const ABILITY_OK: Feature = {
  id: 'ability_ok',
  install(k) {
    k.conditions.register<Condition>({ kind: 'ability', owner: 'ability_ok', validate: () => [], test: () => true })
  },
}

interface Opts {
  pc?: Rec
  ability?: boolean
  pack?: ContentPack
  money?: { cred: number; cash: number }
  extra?: Feature[]
}
const make = (o: Opts = {}) => {
  const features: Feature[] = [characterFeature, worldFeature, STUBS, cyberwareFeature, ...(o.ability ? [ABILITY_OK] : []), ...(o.extra ?? [])]
  const { game } = makeGame({
    features, content: [o.pack ?? pack()], seed: 7, pc: { hp: 40, skills: { cyberware: 2 }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const stand = (g: G, block: string, at: string) => { g.commit(arrive(g.k, g.state, block, at)) }
const pc = (g: G) => g.state.actors.pc!
const now = (g: G) => toMinutes(g.state.time)
const last = (g: G) => g.state.reports[g.state.reports.length - 1]!
const give = (g: G, id: string, parts: Rec, uid: string, extra: Rec = {}) => { g.state.inventory.push({ id, qty: 1, data: { uid, parts, ...extra } }) }
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const inst = (g: G, o: Partial<InstallOpts> & { uid: string }): ReportDraft => installDraft(g.k, g.state, { actor: 'pc', via: 'clinic', ...o })
const rem = (g: G, o: Partial<RemoveOpts> & { uid: string }): ReportDraft => removeDraft(g.k, g.state, { actor: 'pc', via: 'clinic', ...o })
const floor = (g: G, who = 'pc') => g.k.stats.stat(g.state, who, 'sink_floor')
const attr = (g: G, a: 'body' | 'reflex' | 'charm') => g.k.stats.effectiveAttr(g.state, 'pc', a)
const armor = (g: G) => g.k.stats.stat(g.state, 'pc', 'armor')
const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

/** 把每一次 next() 固定成 v，只包住 fn。 */
function withDice<T>(v: number, fn: () => T): T {
  const spy = vi.spyOn(Rng.prototype, 'next').mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
afterEach(() => { vi.restoreAllMocks() })

// 骰面：自然骰 = 1 + floor(next × 20)
const NAT20 = 0.99
const NAT14 = 0.65 // 義臂（III 級，DC 16）：骰 14 ＋ 技能 2 = 16，剛好成功
const NAT12 = 0.55 // 合計 14，差 2：失敗
const NAT1 = 0

// ---- 正規診所裝義臂 ----

describe('正規診所裝義臂', () => {
  it('費用成品價的五成、成本 5、sink_floor 5、沉溺補到 5、時間 +60 分鐘、recovering 掛到一天後', async () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    expect(pc(g).sink).toBe(0)
    const t0 = now(g)
    const q = installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic' })!
    expect(q).toMatchObject({ price: 1200, fee: 600, sink: 5, minutes: 60, recovery_minutes: 1440, complication: 0, registered: true, slot: 'arm_l', pay: 'cred' })
    expect(q.self).toBeUndefined()
    const { violations } = await observed(g, () => g.commit(inst(g, { uid: 'a1', side: 'l' })))
    expect(violations).toEqual([])
    expect(g.state.money.cred).toBe(20000 - 600)
    expect(now(g) - t0).toBe(60)
    expect(g.state.inventory.some((s) => s.data?.uid === 'a1')).toBe(false)
    const [piece] = cyberOf(g.state, 'pc')
    expect(piece).toMatchObject({ uid: 'a1', bp: 'bp_arm', slot: 'arm_l', sink: 5, registered: true, parts: ARM_PARTS })
    expect(piece!.at).toBe(now(g))
    expect(piece!.ready_at).toBe(now(g) + 1440)
    expect(floor(g)).toBe(5)
    expect(pc(g).sink).toBe(5)
    expect(pc(g).conditions.find((c) => c.id === 'recovering')).toEqual({ id: 'recovering', until: now(g) + 1440 })
    expect(last(g)).toMatchObject({ kind: 'action', action: 'cyber.install', actor: 'pc' })
    // 報告的結果句子不帶機制數字
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
  })

  it('休養中體格與護甲沒有變（成本照算）；過了一天體格 +1、護甲 +2，來源標 cyber', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    g.commit(inst(g, { uid: 'a1', side: 'r' }))
    expect(attr(g, 'body')).toBe(10)
    expect(armor(g)).toBe(0)
    expect(floor(g)).toBe(5)
    advance(g, 1439)
    expect(attr(g, 'body')).toBe(10)
    advance(g, 1)
    expect(attr(g, 'body')).toBe(11)
    expect(armor(g)).toBe(2)
    expect(g.k.stats.statParts(g.state, 'pc', 'armor').filter((p) => p.source === 'cyber')).toEqual([{ label: '義臂', value: 2, source: 'cyber' }])
    expect(g.k.stats.statParts(g.state, 'pc', 'sink_floor').filter((p) => p.source === 'cyber')).toEqual([{ label: '義臂', value: 5, source: 'cyber' }])
  })

  it('沉溺已經高過新的下限的人不動；低於的補到下限', () => {
    const g = make({ pc: { sink: 9 } })
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    g.commit(inst(g, { uid: 'a1', side: 'l' }))
    expect(pc(g).sink).toBe(9)
    expect(floor(g)).toBe(5)
  })

  it('錢不夠被擋；指定現金付；帳戶不夠先帳戶再現金', () => {
    const g = make({ money: { cred: 100, cash: 700 } })
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic', pay: 'cred' })).toContain('錢不夠')
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic' })!.pay).toBe('cash')
    g.commit(inst(g, { uid: 'a1', side: 'l', pay: 'cash' }))
    expect(g.state.money).toEqual({ cred: 100, cash: 100 })
    const poor = make({ money: { cred: 100, cash: 100 } })
    stand(poor, 'b_street', 'F1')
    give(poor, 'bp_arm', ARM_PARTS, 'a1')
    expect(reasonOf(() => inst(poor, { uid: 'a1', side: 'l' }))).toContain('錢不夠')
  })
})

// ---- 其他診所與併發症 ----

describe('黑診所、無照診所與併發症', () => {
  it('黑診所扣成品價的四成、不登記；骰子固定 0.1 留下併發症、0.9 不會', () => {
    const g = make()
    stand(g, 'b_street', 'F3')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    give(g, 'bp_arm', ARM_PARTS, 'a2')
    const bad = withDice(0.1, () => inst(g, { uid: 'a1', via: 'black', side: 'l' }))
    const good = withDice(0.9, () => inst(g, { uid: 'a2', via: 'black', side: 'r' }))
    g.commit(bad)
    expect(g.state.money.cred).toBe(20000 - 480)
    const a1 = cyberOf(g.state, 'pc').find((p) => p.uid === 'a1')!
    expect(a1.registered).toBe(false)
    expect(a1.quirks).toEqual(['cx_scar'])
    expect(a1.sink).toBe(6)
    expect(bad.outcome.result).toBe('complication')
    expect(last(g).narration?.results?.join('')).toContain('疤痕組織')
    g.commit(good)
    const a2 = cyberOf(g.state, 'pc').find((p) => p.uid === 'a2')!
    expect(a2.quirks).toBeUndefined()
    expect(good.outcome.result).toBe('installed')
  })

  it('無照診所三成、機率 10%（0.05 留下、0.1 與 0.9 不會）、不登記', () => {
    const g = make()
    stand(g, 'b_street', 'F2')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'unlicensed' })).toMatchObject({ fee: 360, complication: 0.1, registered: false, sink: 6 })
    expect(withDice(0.05, () => inst(g, { uid: 'a1', via: 'unlicensed', side: 'l' })).outcome.result).toBe('complication')
    expect(withDice(0.1, () => inst(g, { uid: 'a1', via: 'unlicensed', side: 'l' })).outcome.result).toBe('installed')
    const clean = withDice(0.9, () => inst(g, { uid: 'a1', via: 'unlicensed', side: 'l' }))
    g.commit(clean)
    expect(g.state.money.cred).toBe(20000 - 360)
    expect(cyberOf(g.state, 'pc')[0]!.quirks).toBeUndefined()
  })

  it('正規診所不留併發症；骰子在最壞的 0 也一樣', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    expect(withDice(0, () => inst(g, { uid: 'a1', side: 'l' })).outcome.result).toBe('installed')
  })

  it('沒有擲骰的手術不推亂數游標；擲了骰的（併發症的機率）推一格', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    expect(inst(g, { uid: 'a1', side: 'l' }).changes.some((c) => c.op === 'rng')).toBe(false)
    stand(g, 'b_street', 'F3')
    expect(inst(g, { uid: 'a1', side: 'l', via: 'black' }).changes).toContainEqual({ op: 'rng', advance: 1 })
  })

  it('同一個狀態、同一件的骰面不變（亂數從狀態導出）：重建草稿結果相同', () => {
    const g = make()
    stand(g, 'b_street', 'F3')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    const a = inst(g, { uid: 'a1', via: 'black', side: 'l' })
    const b = inst(g, { uid: 'a1', via: 'black', side: 'l' })
    expect(a.changes).toEqual(b.changes)
  })

  it('併發症帶的 effects 好了之後生效，來源標 quirk；休養中不生效', () => {
    const g = make()
    stand(g, 'b_street', 'F3')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    g.commit(withDice(0.1, () => inst(g, { uid: 'a1', via: 'black', side: 'l' })))
    expect(attr(g, 'reflex')).toBe(10)
    advance(g, 1440)
    expect(attr(g, 'reflex')).toBe(9)
    expect(g.k.stats.attrParts(g.state, 'pc', 'reflex')).toEqual([{ label: '疤痕組織', value: -1, source: 'quirk' }])
  })
})

// ---- 自己動刀 ----

describe('自己動刀', () => {
  it('沒有人註冊條件 ability 時不列、也不能選；註冊之後列出來', () => {
    const no = make()
    no.state.flags.home = true
    expect(surgeons(no.k, no.state, 'pc').map((s) => s.id)).toEqual([])
    give(no, 'bp_arm', ARM_PARTS, 'a1')
    expect(installBlock(no.k, no.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self' })).toBe('現在還不能自己動刀。')
    const yes = make({ ability: true })
    yes.state.flags.home = true
    expect(surgeons(yes.k, yes.state, 'pc')).toEqual([{ id: 'self', name: '自己動刀', fee: 0, sink_pct: 0, complication: 0, registered: false, block: null }])
  })

  it('要在住處或診所：不在就列出來但寫原因；在診所也可以', () => {
    const g = make({ ability: true })
    expect(surgeons(g.k, g.state, 'pc')[0]!.block).toBe('自己動刀要在住處或診所。')
    stand(g, 'b_street', 'F1')
    expect(surgeons(g.k, g.state, 'pc').map((s) => [s.id, s.block])).toEqual([['clinic', null], ['self', null]])
    stand(g, 'b_plain', 'F1')
    expect(surgeons(g.k, g.state, 'pc')[0]!.block).toBe('自己動刀要在住處或診所。')
    g.state.flags.home = true
    expect(surgeons(g.k, g.state, 'pc')[0]!.block).toBeNull()
  })

  it('動刀的人要通過 self_requires（條件不成立就擋，一條一句）；隊友動刀要在隊上', () => {
    const rule = pack((c) => { c.cyber_rule = [{ id: 'default', self_requires: [{ kind: 'ability' }, { kind: 'never' }] }] })
    const h = make({ ability: true, pack: rule, extra: [{ id: 'never', install: (k) => k.conditions.register<Condition>({ kind: 'never', owner: 'never', validate: () => [], test: () => false }) }] })
    h.state.flags.home = true
    give(h, 'bp_arm', ARM_PARTS, 'a1')
    expect(installProblems(h.k, h.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self' })).toEqual(['動刀的人不符合自己動刀的條件。'])
    const buddy = make({ ability: true })
    buddy.state.flags.home = true
    give(buddy, 'bp_arm', ARM_PARTS, 'a1')
    expect(installBlock(buddy.k, buddy.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self', by: 'stranger' })).toBe('找不到動刀的人。')
    buddy.state.actors.friend = makeActor({ id: 'friend', name: '朋友', role: 'npc', skills: { cyberware: 3 } })
    expect(installBlock(buddy.k, buddy.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self', by: 'friend' })).toBe('動刀的人不在隊上。')
    buddy.state.party.push('friend')
    expect(installBlock(buddy.k, buddy.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self', by: 'friend' })).toBeNull()
  })

  const selfGame = () => {
    const g = make({ ability: true })
    g.state.flags.home = true
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    return g
  }
  const selfInst = (g: G) => inst(g, { uid: 'a1', side: 'l', via: 'self' })

  it('報價：免費、DC 16（III 級）、加值 2（技術 0＋義體學 2）、沉溺成本 6', () => {
    const g = selfGame()
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self' })).toMatchObject({ fee: 0, sink: 6, complication: 0, registered: false, self: { by: 'pc', skill: 'cyberware', dc: 16, bonus: 2 } })
  })

  it('大成功：成本 −1（5）、裝上、沒有併發症', () => {
    const g = selfGame()
    const d = withDice(NAT20, () => selfInst(g))
    expect(d.outcome.result).toBe('great')
    g.commit(d)
    expect(g.state.money.cred).toBe(20000)
    const [p] = cyberOf(g.state, 'pc')
    expect(p).toMatchObject({ uid: 'a1', sink: 5, registered: false })
    expect(p!.quirks).toBeUndefined()
    expect(pc(g).sink).toBe(5)
  })

  it('成功：照常（6）', () => {
    const g = selfGame()
    const d = withDice(NAT14, () => selfInst(g))
    expect(d.timeline.find((b) => b.roll)!.roll).toMatchObject({ natural: 14, total: 16, dc: 16, degree: 'success' })
    g.commit(d)
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ sink: 6 })
    expect(pc(g).sink).toBe(6)
  })

  it('失敗：裝上，但多一筆併發症（從 quirk 的 complication 池抽）', () => {
    const g = selfGame()
    const d = withDice(NAT12, () => selfInst(g))
    expect(d.outcome.result).toBe('complication')
    g.commit(d)
    const p = cyberOf(g.state, 'pc')[0]!
    expect(p.sink).toBe(6)
    expect(p.quirks).toHaveLength(1)
    expect(['cx_scar', 'cx_ache']).toContain(p.quirks![0])
  })

  it('大失敗：沒裝上、東西還在背包、被裝的人沉溺 +1、時間照花、不收錢', () => {
    const g = selfGame()
    const t0 = now(g)
    const d = withDice(NAT1, () => selfInst(g))
    expect(d.outcome.result).toBe('botched')
    g.commit(d)
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(g.state.inventory.some((s) => s.id === 'bp_arm' && s.data?.uid === 'a1')).toBe(true)
    expect(pc(g).sink).toBe(1)
    expect(floor(g)).toBe(0)
    expect(now(g) - t0).toBe(60)
    expect(g.state.money.cred).toBe(20000)
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'recovering')).toBe(false)
  })

  it('手術刀（surgery_sink_pct）讓成本再減：自己動刀看動刀的人的加減，夾在 −25～0', () => {
    const g = selfGame()
    give(g, 'bp_arm', { ...ARM_PARTS, neuron: 'pt_neuron_hot' }, 'hot')
    const sink = (via: 'self' | 'clinic' | 'unlicensed') => pieceSink(g.k, g.state, 'bp_arm', g.state.inventory.find((s) => s.data?.uid === 'hot')!.data, { via, by: 'pc' })
    expect(sink('self')).toBe(20)
    g.k.stats.addStatProvider('surgery_sink_pct', 'test', () => [{ label: '手術刀', value: -15, source: 'skill' }])
    expect(g.k.stats.stat(g.state, 'pc', 'surgery_sink_pct')).toBe(-15)
    expect(sink('self')).toBe(17)
    // 正規診所 −10% 與手術刀不疊，取比較好的（−15）；無照診所照設計圖
    expect(sink('clinic')).toBe(17)
    expect(sink('unlicensed')).toBe(20)
    g.k.stats.addStatProvider('surgery_sink_pct', 'test2', () => [{ label: '更多', value: -40, source: 'skill' }])
    expect(g.k.stats.stat(g.state, 'pc', 'surgery_sink_pct')).toBe(-25)
    expect(sink('self')).toBe(15)
  })
})

// ---- 槽與條件 ----

describe('槽與必要條件', () => {
  it('腦三槽，裝第四件被擋；寫出原因', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    for (const i of [1, 2, 3, 4]) give(g, 'bp_chip', { chip: 'pt_chip' }, `c${i}`)
    for (const i of [1, 2, 3]) g.commit(inst(g, { uid: `c${i}` }))
    expect(cyberOf(g.state, 'pc').filter((p) => p.slot === 'brain')).toHaveLength(3)
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'c4', via: 'clinic' })).toBe('腦的槽已經滿了。')
    expect(reasonOf(() => inst(g, { uid: 'c4' }))).toBe('腦的槽已經滿了。')
  })

  it('左臂滿了右臂還能裝；arm 沒給 side 被擋；side 要是左右', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    for (const i of [1, 2, 3]) give(g, 'bp_arm', ARM_PARTS, `a${i}`)
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' })).toBe('手臂要說是左邊還是右邊。')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic', side: 'x' as never })).toBe('手臂要說是左邊還是右邊。')
    g.commit(inst(g, { uid: 'a1', side: 'l' }))
    give(g, 'bp_arm', ARM_PARTS, 'a4')
    g.commit(inst(g, { uid: 'a4', side: 'l' }))
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'a2', via: 'clinic', side: 'l' })).toBe('左臂的槽已經滿了。')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'a2', via: 'clinic', side: 'r' })).toBeNull()
    g.commit(inst(g, { uid: 'a2', side: 'r' }))
    expect(cyberOf(g.state, 'pc').map((p) => p.slot).sort()).toEqual(['arm_l', 'arm_l', 'arm_r'])
  })

  it('缺零件的成品被擋，寫出缺哪一種', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', { plate: 'pt_plate' }, 'a1')
    expect(installProblems(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic', side: 'l' })).toEqual(['缺零件：致動器、機械神經元。'])
  })

  it('沒有橋的人裝 needs_bridge 的被擋，裝寫了 false 的可以', () => {
    const g = make({ pc: { ext: { bridge: null } } })
    stand(g, 'b_street', 'F1')
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    give(g, 'bp_ears', { skin: 'pt_ear' }, 'r1')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'clinic' })).toBe('這件義體要接在橋上，你還沒有橋。')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'r1', via: 'clinic' })).toBeNull()
    g.commit(inst(g, { uid: 'r1' }))
    expect(cyberOf(g.state, 'pc')).toHaveLength(1)
    // 有橋（ext.bridge 沒寫就是有）的人兩種都行
    const h = make()
    stand(h, 'b_street', 'F1')
    give(h, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    expect(installBlock(h.k, h.state, { actor: 'pc', uid: 'e1', via: 'clinic' })).toBeNull()
  })

  it('橋那一槽這一張先擋；背包裡沒有那一件、不是義體、已經裝著的也各有原因', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_bridge', { chip: 'pt_bridge_chip' }, 'b1')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'b1', via: 'clinic' })).toBe('換橋是另一種手術。')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'nope', via: 'clinic' })).toBe('背包裡沒有這一件。')
    expect(installBlock(g.k, g.state, { actor: 'ghost', uid: 'b1', via: 'clinic' })).toBe('找不到這個角色。')
    g.state.inventory.push({ id: 'i_junk', qty: 1, data: { uid: 'j1' } })
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'j1', via: 'clinic' })).toBe('這不是能裝的義體。')
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    g.commit(inst(g, { uid: 'e1' }))
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'clinic' })).toBe('義眼已經裝在身上了。')
  })

  it('這裡沒有那一種診所：寫出來；沒有站在設施上也一樣', () => {
    const g = make()
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'clinic' })).toBe('這裡沒有正規診所。')
    stand(g, 'b_street', 'F3')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'clinic' })).toBe('這裡沒有正規診所。')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'black' })).toBeNull()
    stand(g, 'b_plain', 'F1')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'black' })).toBe('這裡沒有黑診所。')
    expect(surgeons(g.k, g.state, 'pc')).toEqual([])
  })

  it('同時有好幾個原因時一條一句都列出來', () => {
    const g = make({ pc: { ext: { bridge: null } } })
    give(g, 'bp_eye', {}, 'e1')
    const problems = installProblems(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'clinic' })
    expect(problems).toEqual(['缺零件：感測器。', '這件義體要接在橋上，你還沒有橋。', '這裡沒有正規診所。'])
  })

  it('沒有 parts 而設計圖有 stock 的成品用 stock（原廠組合）', () => {
    const c = pack((x) => { x.blueprint!.find((b) => b.id === 'bp_eye')!.stock = { sensor: 'pt_lens' } })
    const g = make({ pack: c })
    stand(g, 'b_street', 'F1')
    g.state.inventory.push({ id: 'bp_eye', qty: 1, data: { uid: 'e1' } })
    g.commit(inst(g, { uid: 'e1' }))
    expect(cyberOf(g.state, 'pc')[0]!.parts).toEqual({ sensor: 'pt_lens' })
  })
})

// ---- 全生體、混裝與拆下來 ----

describe('全生體與混裝的成本、休養', () => {
  it('全生體：成本 0、休養是三倍（240 × 3）；沒有沉溺要補', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_ears', { skin: 'pt_ear' }, 'r1')
    const q = installQuote(g.k, g.state, { actor: 'pc', uid: 'r1', via: 'clinic' })!
    expect(q).toMatchObject({ sink: 0, recovery_minutes: 720, fee: 300 })
    g.commit(inst(g, { uid: 'r1' }))
    expect(cyberOf(g.state, 'pc')[0]!.ready_at).toBe(now(g) + 720)
    expect(floor(g)).toBe(0)
    expect(pc(g).sink).toBe(0)
  })

  it('混裝（機械接生體）：成本 ×0.5 無條件捨去；一般的 ×1', () => {
    const g = make()
    const sink = (parts: Rec, via: 'unlicensed' | 'clinic') => pieceSink(g.k, g.state, 'bp_mixarm', { uid: 'm', parts }, { via, by: 'pc' })
    expect(sink(ARM_PARTS, 'unlicensed')).toBe(6)
    expect(sink({ ...ARM_PARTS, neuron: 'pt_neuron_bio' }, 'unlicensed')).toBe(3)
    expect(sink({ ...ARM_PARTS, neuron: 'pt_neuron_bio' }, 'clinic')).toBe(3)
    expect(pieceSink(g.k, g.state, 'bp_mixarm', { uid: 'm', parts: { ...ARM_PARTS, neuron: 'pt_neuron_hot' } }, { via: 'unlicensed' })).toBe(20)
    expect(pieceSink(g.k, g.state, 'bp_nope', {}, { via: 'clinic' })).toBe(0)
  })

  it('全生體拆下來：東西沒有了（結果的句子寫明）；錢是安裝費的一半', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_ears', { skin: 'pt_ear' }, 'r1')
    g.commit(inst(g, { uid: 'r1' }))
    const cred = g.state.money.cred
    expect(removeQuote(g.k, g.state, { actor: 'pc', uid: 'r1', via: 'clinic' })).toMatchObject({ fee: 150, vanishes: true })
    const d = rem(g, { uid: 'r1' })
    g.commit(d)
    expect(g.state.money.cred).toBe(cred - 150)
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(g.state.inventory.some((s) => s.id === 'bp_ears')).toBe(false)
    expect(d.outcome.result).toBe('gone')
    expect(d.outcome.summary).toContain('什麼也沒有剩下')
  })

  it('義臂拆下來：背包多一疊 used、零件一個不少、sink_floor 回 0、沉溺還是 5', async () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1', { quality: 'fine' })
    g.commit(inst(g, { uid: 'a1', side: 'l' }))
    expect(floor(g)).toBe(5)
    const cred = g.state.money.cred
    const t0 = now(g)
    // 精工 ×1.1：成品價 1320、安裝費 660、拆是一半
    expect(removeQuote(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' })).toMatchObject({ fee: 330, vanishes: false })
    const { violations } = await observed(g, () => g.commit(rem(g, { uid: 'a1' })))
    expect(violations).toEqual([])
    expect(g.state.money.cred).toBe(cred - 330)
    expect(now(g) - t0).toBe(60)
    const back = g.state.inventory.find((s) => s.id === 'bp_arm')!
    expect(back.data).toMatchObject({ uid: 'a1', state: 'used', quality: 'fine', parts: ARM_PARTS })
    expect(partsOf(g.k.content, back.data).map((p) => `${p.type}:${p.part.id}`).sort()).toEqual(['actuator:pt_act', 'neuron:pt_neuron', 'plate:pt_plate'])
    expect(back.data).not.toHaveProperty('bp')
    expect(back.data).not.toHaveProperty('ready_at')
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(floor(g)).toBe(0)
    expect(pc(g).sink).toBe(5)
    expect(attr(g, 'body')).toBe(10)
    expect(last(g)).toMatchObject({ action: 'cyber.remove' })
    // 二手的拆下來再裝回去：目錄價 ×0.5（1320 → 660），診所收的錢也少一半
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic', side: 'l' })).toMatchObject({ price: 660, fee: 330 })
  })

  it('混裝的拆下來只留機械的零件（生體的死了）', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_mixarm', { ...ARM_PARTS, neuron: 'pt_neuron_bio' }, 'm1')
    g.commit(inst(g, { uid: 'm1', side: 'l' }))
    expect(cyberOf(g.state, 'pc')[0]!.sink).toBe(3)
    const d = rem(g, { uid: 'm1' })
    g.commit(d)
    expect(g.state.inventory.find((s) => s.id === 'bp_mixarm')!.data).toMatchObject({ state: 'used', parts: { plate: 'pt_plate', actuator: 'pt_act' } })
    expect(g.state.inventory.find((s) => s.id === 'bp_mixarm')!.data!.parts).not.toHaveProperty('neuron')
    expect(d.outcome.summary).toContain('離開身體就死了')
  })

  it('有授權鎖的拆不了；橋不能拆；身上沒有的、這裡沒有診所的也各有原因', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    g.state.actors.pc!.ext.cyber = {
      pieces: [
        { uid: 'l1', bp: 'bp_arm', slot: 'arm_l', parts: ARM_PARTS, sink: 6, at: 0, off: { why: 'lock' } },
        { uid: 'br', bp: 'bp_bridge', slot: 'bridge', parts: { chip: 'pt_bridge_chip' }, sink: 4, at: 0 },
        { uid: 'x1', bp: 'bp_eye', slot: 'eye', parts: { sensor: 'pt_lens' }, sink: 3, at: 0, off: { why: 'broken' } },
      ],
    }
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'l1', via: 'clinic' })).toBe('有授權鎖，要先解鎖。')
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'br', via: 'clinic' })).toBe('橋不能這樣拆，換橋是另一種手術。')
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'zz', via: 'clinic' })).toBe('身上沒有這一件義體。')
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'x1', via: 'clinic' })).toBeNull()
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'x1', via: 'black' })).toBe('這裡沒有黑診所。')
    expect(reasonOf(() => rem(g, { uid: 'l1' }))).toBe('有授權鎖，要先解鎖。')
  })

  it('自己動刀拆：不收錢、照樣擲；失敗時一個隨機的零件報廢、成功一個不少', () => {
    const g = make({ ability: true })
    g.state.flags.home = true
    g.state.actors.pc!.ext.cyber = { pieces: [{ uid: 'a1', bp: 'bp_arm', slot: 'arm_l', parts: ARM_PARTS, sink: 6, at: 0 }, { uid: 'a2', bp: 'bp_arm', slot: 'arm_r', parts: ARM_PARTS, sink: 6, at: 0 }] }
    const ok = withDice(NAT14, () => rem(g, { uid: 'a1', via: 'self' }))
    expect(ok.outcome.result).toBe('removed')
    const bad = withDice(NAT12, () => rem(g, { uid: 'a2', via: 'self' }))
    expect(bad.outcome.result).toBe('damaged')
    expect(bad.changes).toContainEqual({ op: 'rng', advance: 1 })
    g.commit(ok)
    g.commit(bad)
    expect(g.state.money.cred).toBe(20000)
    const stacks = g.state.inventory.filter((s) => s.id === 'bp_arm')
    expect(stacks).toHaveLength(2)
    expect(partsOf(g.k.content, stacks.find((s) => s.data?.uid === 'a1')!.data)).toHaveLength(3)
    expect(partsOf(g.k.content, stacks.find((s) => s.data?.uid === 'a2')!.data)).toHaveLength(2)
    expect(bad.narration!.results!.join('')).toContain('報廢')
  })
})

// ---- 條件、場景、視圖 ----

describe('條件 cyber 與場景的身體', () => {
  const gear = (g: G) => {
    stand(g, 'b_street', 'F1')
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    give(g, 'bp_ears', { skin: 'pt_ear' }, 'r1')
  }

  it('slot、bp、tag、min 的真假（arm 左右都算）', () => {
    const g = make()
    gear(g)
    expect(test(g, { kind: 'cyber' })).toBe(false)
    g.commit(inst(g, { uid: 'e1' }))
    expect(test(g, { kind: 'cyber' })).toBe(true)
    expect(test(g, { kind: 'cyber', slot: 'eye' })).toBe(true)
    expect(test(g, { kind: 'cyber', slot: 'brain' })).toBe(false)
    expect(test(g, { kind: 'cyber', min: 2 })).toBe(false)
    g.commit(inst(g, { uid: 'a1', side: 'r' }))
    expect(test(g, { kind: 'cyber', min: 2 })).toBe(true)
    expect(test(g, { kind: 'cyber', min: 3 })).toBe(false)
    expect(test(g, { kind: 'cyber', slot: 'arm' })).toBe(true)
    expect(test(g, { kind: 'cyber', slot: 'arm_r' })).toBe(true)
    expect(test(g, { kind: 'cyber', slot: 'arm_l' })).toBe(false)
    expect(test(g, { kind: 'cyber', bp: 'bp_arm' })).toBe(true)
    expect(test(g, { kind: 'cyber', bp: 'bp_eye', slot: 'arm' })).toBe(false)
    expect(test(g, { kind: 'cyber', tag: 'limb' })).toBe(true)
    expect(test(g, { kind: 'cyber', tag: 'bio' })).toBe(false)
    expect(g.k.conditions.test({ kind: 'cyber', slot: 'eye' }, { state: g.state, actor: 'nobody', stats: g.k.stats, timeRules: g.k.timeRules })).toBe(false)
  })

  it('格式：slot 要是部位、min 要是 1 以上的整數', () => {
    const g = make()
    expect(g.k.conditions.validate({ kind: 'cyber', slot: 'head' })).toEqual([expect.stringContaining('slot 要是部位的 id')])
    expect(g.k.conditions.validate({ kind: 'cyber', min: 0 })).toEqual([expect.stringContaining('min')])
    expect(g.k.conditions.validate({ kind: 'cyber', slot: 'arm', bp: 'bp_arm', tag: 'limb', min: 2 })).toEqual([])
  })

  const body = (g: G, layer: 'meat' | 'net' = 'meat') =>
    (g.k.hooks as any).run('scene.body', { state: g.state, actor: 'pc', layer }).map((h: { result: unknown }) => h.result)

  it('scene.body 的回答含獸耳多出來的部位；all 展開到每個部位；休養中、內海都不回答', () => {
    const g = make()
    gear(g)
    g.commit(inst(g, { uid: 'r1' }))
    expect(body(g)).toEqual([])
    advance(g, 719)
    expect(body(g)).toEqual([])
    advance(g, 1)
    expect(body(g, 'net')).toEqual([])
    const [ans] = body(g)
    expect(ans.parts).toEqual(['ear'])
    expect(ans.sensitivity).toEqual({ ear: 17, mouth: 2, hand_l: 2, hand_r: 2, chest: 2, front: 2, back: 2, legs: 2 })
    // 另一個人沒有義體：沒有回答
    expect((g.k.hooks as any).run('scene.body', { state: g.state, actor: 'ghost', layer: 'meat' })).toEqual([])
  })

  it('cyberView：每個部位的每一槽、每一件的名字、等級、成本、狀態、效果', () => {
    const g = make()
    gear(g)
    g.commit(inst(g, { uid: 'a1', side: 'l' }))
    g.commit(inst(g, { uid: 'e1' }))
    const v = cyberView(g.k, g.state, 'pc')
    expect(v.parts.map((p) => [p.id, p.slots])).toEqual([['bridge', 1], ['brain', 3], ['eye', 2], ['ear_throat', 2], ['torso', 3], ['skin', 2], ['arm_l', 2], ['arm_r', 2], ['leg_l', 2], ['leg_r', 2], ['intimate', 2]])
    const armL = v.parts.find((p) => p.id === 'arm_l')!
    expect(armL).toMatchObject({ used: 1, free: 1 })
    expect(armL.pieces[1]).toBeNull()
    expect(armL.pieces[0]).toMatchObject({ uid: 'a1', name: '義臂', grade: 3, sink: 5, status: 'recovering', registered: true, bio: false })
    expect(armL.pieces[0]!.effects).toEqual([{ attr: 'body', amount: 1 }, { stat: 'armor', amount: 2 }])
    expect(v).toMatchObject({ sink_floor: 8, sink: 8, bridge: true })
    expect(v.recovering_until).toBe(armL.pieces[0]!.ready_at)
    advance(g, 1440)
    expect(cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'arm_l')!.pieces[0]).toMatchObject({ status: 'ready' })
    expect(cyberView(g.k, g.state, 'pc').recovering_until).toBeUndefined()
  })

  it('cyberView：不生效的標 off（授權鎖）；併發症的名字列出來', () => {
    const g = make()
    g.state.actors.pc!.ext.cyber = { pieces: [{ uid: 'l1', bp: 'bp_arm', slot: 'arm_l', parts: ARM_PARTS, sink: 6, at: 0, off: { why: 'lock' }, quirks: ['cx_scar'] }] }
    const piece = cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'arm_l')!.pieces[0]!
    expect(piece).toMatchObject({ status: 'off', off: { why: 'lock' }, quirks: [{ id: 'cx_scar', name: '疤痕組織' }] })
    // 不生效：身上的 body 不加，下限照算
    expect(attr(g, 'body')).toBe(10)
    expect(floor(g)).toBe(6)
  })
})

// ---- 壞掉的資料、規則表、設施 ----

describe('資料壞掉、規則表與設施格式', () => {
  it('ext.cyber 被改壞（pieces 是字串、某一件沒有 bp）時讀成沒有那一件，不丟錯；存檔再讀一樣', () => {
    const g = make()
    g.state.actors.pc!.ext.cyber = { pieces: 'oops' }
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(floor(g)).toBe(0)
    expect(attr(g, 'body')).toBe(10)
    g.state.actors.pc!.ext.cyber = {
      pieces: [
        { uid: 'x', slot: 'arm_l', sink: 9 }, { uid: 'y', bp: 'bp_eye', slot: 'head', sink: 9 }, 7, null, { bp: 'bp_eye', slot: 'eye' },
        { uid: 'ok', bp: 'bp_eye', slot: 'eye', sink: 3, at: 5, ready_at: 'later', off: { why: 7 }, parts: 'junk', quirks: [1, 'cx_scar'], registered: 'yes' },
        { uid: 'ok', bp: 'bp_arm', slot: 'arm_l', sink: 6, at: 0 },
      ],
    }
    expect(cyberOf(g.state, 'pc')).toEqual([{ uid: 'ok', parts: {}, quirks: ['cx_scar'], bp: 'bp_eye', kind_of: 'blueprint', slot: 'eye', sink: 3, at: 5 }])
    expect(floor(g)).toBe(3)
    expect(g.load(g.save())).toBeNull()
    expect(cyberOf(g.state, 'pc')).toEqual([{ uid: 'ok', parts: {}, quirks: ['cx_scar'], bp: 'bp_eye', kind_of: 'blueprint', slot: 'eye', sink: 3, at: 5 }])
    expect(cyberView(g.k, g.state, 'ghost').parts.every((p) => p.used === 0)).toBe(true)
    expect(cyberOf(g.state, 'ghost')).toEqual([])
    // 壞掉之後照樣可以裝新的：寫回去的是整理過的
    stand(g, 'b_street', 'F1')
    give(g, 'bp_plating', { plate: 'pt_plating' }, 'p1')
    g.commit(inst(g, { uid: 'p1' }))
    expect(cyberOf(g.state, 'pc').map((p) => p.uid)).toEqual(['ok', 'p1'])
    expect(floor(g)).toBe(3 + 1)
  })

  it('存檔再讀：身上的義體、休養的時間、狀況原樣回來', () => {
    const g = make()
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    g.commit(inst(g, { uid: 'a1', side: 'r' }))
    const before = JSON.stringify([cyberOf(g.state, 'pc'), pc(g).conditions, floor(g)])
    expect(g.load(g.save())).toBeNull()
    expect(JSON.stringify([cyberOf(g.state, 'pc'), pc(g).conditions, floor(g)])).toBe(before)
  })

  it('規則的數字都從 cyber_rule 讀：資料蓋掉預設（費用、槽數、休養、手術時間、自己動刀的 DC）', () => {
    const rule = { id: 'default', slots: { eye: 1 }, surgeons: { clinic: { fee: 0.25, sink_pct: 0 } }, recovery_minutes: { invasive: 60 }, surgery_minutes: 30, remove_fee_mult: 1, self_dc: [8, 9, 10, 11, 12] }
    const g = make({ ability: true, pack: pack((c) => { c.cyber_rule = [rule] }) })
    stand(g, 'b_street', 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1')
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic' })).toMatchObject({ fee: 300, sink: 6, minutes: 30, recovery_minutes: 60 })
    expect(installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self' })!.self!.dc).toBe(10)
    // 自己動刀的報價帶成功率（M4-fix-2）：自然 20 一定過、自然 1 一定不過，其餘看加值有沒有到 DC；其他人動刀沒有 self
    const self = installQuote(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'self' })!.self!
    expect(self.chance).toBe([...Array(20).keys()].map((i) => i + 1).filter((n) => n === 20 || (n !== 1 && n + self.bonus >= self.dc)).length / 20)
    g.commit(inst(g, { uid: 'a1', side: 'l' }))
    expect(removeQuote(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' })!.fee).toBe(300)
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e1')
    give(g, 'bp_eye', { sensor: 'pt_lens' }, 'e2')
    g.commit(inst(g, { uid: 'e1' }))
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'e2', via: 'clinic' })).toBe('眼的槽已經滿了。')
    expect(cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'eye')!.slots).toBe(1)
  })

  it('規則表的格式錯誤被擋下；沒有規則表時用內建的預設', () => {
    const k = make().k
    const p = (e: Rec) => k.content.validate('cyber_rule', [{ id: 'default', ...e }]).join('\n')
    expect(p({})).toBe('')
    expect(p({ slots: { head: 2 } })).toContain('slots.head')
    expect(p({ slots: { eye: -1 } })).toContain('slots.eye')
    expect(p({ surgeons: { dentist: {} } })).toContain('surgeons.dentist')
    expect(p({ surgeons: { black: { complication: 2 } } })).toContain('complication')
    expect(p({ recovery_minutes: { huge: 3 } })).toContain('recovery_minutes.huge')
    expect(p({ self_dc: [1, 2] })).toContain('self_dc')
    expect(p({ mixed_sink_mult: 2 })).toContain('mixed_sink_mult')
    expect(DEFAULT_CYBER_RULES.slots).toEqual({ bridge: 1, brain: 3, eye: 2, ear_throat: 2, torso: 3, skin: 2, arm_l: 2, arm_r: 2, leg_l: 2, leg_r: 2, intimate: 2 })
    // 格式不對的整份規則載不進來（寫出是哪一筆哪一欄）
    expect(() => make({ pack: pack((c) => { c.cyber_rule = [{ id: 'default', slots: { head: 9 }, surgery_minutes: -5 }] as Rec[] }) })).toThrow(/cyber_rule\/default：slots\.head/)
  })

  it('設施種類的 clinic 格式錯誤在載入後被擋下', () => {
    const bad = pack((c) => { c.facility_type!.push({ id: 'fac_bad', name: '怪診所', clinic: { grade: 'fancy' } }) })
    expect(() => make({ pack: bad })).toThrow(ContentError)
    expect(() => make({ pack: bad })).toThrow(/facility_type\/fac_bad：clinic/)
  })

  it('義體設計圖與零件的 effects 格式照被動效果檢查（核心的整體檢查在 ready 之後）', () => {
    const bad = pack((c) => { c.blueprint!.find((b) => b.id === 'bp_arm')!.effects = [{ attr: 'body', amount: 0 }] })
    expect(() => make({ pack: bad })).toThrow(/blueprint\/bp_arm/)
  })
})

describe('既有功能照舊', () => {
  it('cyberware 排在 FEATURES 的 deck 前面；沒有義體的人什麼都不變', async () => {
    const { FEATURES } = await import('../../src/features')
    const ids = Object.keys(FEATURES)
    expect(ids.indexOf('cyberware')).toBeGreaterThan(-1)
    expect(ids.indexOf('cyberware')).toBeLessThan(ids.indexOf('deck'))
    const g = make()
    expect(floor(g)).toBe(0)
    expect(attr(g, 'body')).toBe(10)
    expect(g.k.passives.of(g.state, 'pc')).toEqual([])
  })
})
