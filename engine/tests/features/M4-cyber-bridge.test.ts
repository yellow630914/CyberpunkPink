// 驗收測試：dev/work/M4-cyber-bridge.md（cpp-feature）。規格：CYBERWARE 第 7 節（7.1～7.4）；CRAFTING 第 7 節、8.7 節；CORE_RULES 6.4 節；ITEMS 3.1 節（只當對照）；TRADE 3.4 節換橋那一列；dev/adr/0019 第三節與 P7、P8、P15。
// 內容一律用測試自帶的最小假資料：三顆晶片（40、52、54）、四套軟體（均衡 1：1：1：1、偏現實 20：15：10：10、偏內海 8：28：8：8、把現實分到 5 的）、兩顆神經元（一般的、現實 +1 的）。
// 站上設施用真的 world（正規診所、無照診所）；效果 sink_floor 由測試的替身註冊（M4-sink 還沒做；沒裝它就沒有暫時的沉溺）。
//
// 時間：測試從第 3 天 10:00 開始。成品價 ＝ 零件目錄價合計 × 1.2：標準橋（晶片 1000＋神經元 300＋軟體 200）1800（正規診所 900、換橋 1800）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Change, ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, Rng, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { abilitiesFeature, abilitiesOf, capacityOf, equipAbilities } from '../../src/features/abilities'
import { characterFeature } from '../../src/features/character'
import {
  DEFAULT_CYBER_RULES, bridgeCapacityOf, bridgeQuote, cyberOf, cyberwareFeature, installBlock, isBridge, removeBlock, removeDraft, swapBridgeBlock, swapBridgeDraft, swapBridgeProblems,
} from '../../src/features/cyberware'
import type { BridgeOpts } from '../../src/features/cyberware'
import { lewdFeature } from '../../src/features/lewd'
import { arrive, worldFeature } from '../../src/features/world'
import { makeGame, observed } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

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
  part('pt_chip40', 'chip', { price: 1000, bridge: { capacity: 40 } }),
  part('pt_chip52', 'chip', { price: 1000, bridge: { capacity: 52 } }),
  part('pt_chip54', 'chip', { price: 1000, bridge: { capacity: 54 } }),
  part('pt_chip30', 'chip', { price: 1000, bridge: { capacity: 30 } }),
  part('pt_neuron', 'neuron', { price: 300 }),
  part('pt_neuron_meat', 'neuron', { price: 300, affinity: { meat: 1 } }),
  part('pt_neuron_bio', 'neuron', { price: 300, material: 'bio' }),
  part('pt_sw_even', 'software', { price: 200, bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
  part('pt_sw_real', 'software', { price: 200, bridge: { split: { meat: 20, net: 15, social: 10, media: 10 } } }),
  part('pt_sw_net', 'software', { price: 200, bridge: { split: { meat: 8, net: 28, social: 8, media: 8 } } }),
  part('pt_sw_five', 'software', { price: 200, bridge: { split: { meat: 5, net: 15, social: 10, media: 10 } } }),
  part('pt_sw_tie', 'software', { price: 200, bridge: { split: { meat: 1, net: 1, social: 1, media: 0 } } }),
  part('pt_eye', 'sensor', { price: 500 }),
]
const bp = (id: string, over: Rec = {}): Rec => ({
  id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 2, legal: 'register', price: 900, require: [], optional: [], ...over,
})
const BRIDGE_REQ = [{ type: 'chip' }, { type: 'neuron' }, { type: 'software' }]
const BLUEPRINTS = [
  bp('bp_bridge', { name: '標準橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, require: BRIDGE_REQ }),
  bp('bp_bridge_hot', { name: '燙橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 9, bridge: { tuning_slots: 2 }, require: BRIDGE_REQ }),
  bp('bp_bridge_fx', {
    name: '機能橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, require: BRIDGE_REQ,
    effects: [
      { stat: 'bridge_tolerance', amount: 15 }, { stat: 'ram_max', amount: 2 }, { stat: 'loadout_minutes', amount: -30 },
      { stat: 'sync_cap_bonus', amount: 1 }, { stat: 'bridge_sensitivity', amount: -15 },
    ],
  }),
  bp('bp_eye', { name: '義眼', slot: 'eye', invasiveness: 'light', sink_cost: 3, grade: 1, require: [{ type: 'sensor' }] }),
  bp('bp_junk_bridge', { name: '沒有晶片的橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 1, bridge: {}, require: [{ type: 'neuron' }] }),
]
const QUIRKS = [{ id: 'cx_scar', name: '疤痕組織', desc: '縫合的地方留了疤。', kind: 'complication', pool: ['complication'], effects: [{ attr: 'reflex', amount: -1 }] }]

const sk = (id: string, name: string, kind: string, cap: number, more: Rec) => ({
  id, name, path: 'gunner', category: 'meat', tier: 1, layer: 'front', kind, cap, xp: 20, cells: 1, text: `${name}。`, net: null, opinion: null, ...more,
})
const ABILITY_CONTENT = {
  path: [{ id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_instinct', domains: { meat: 'strong', net: 'weak', opinion: 'none' }, resonance: [] }],
  ability: [
    sk('sk_instinct', '戰鬥直覺', 'passive', 3, { layer: 'signature', meat: { instinct: true } }),
    sk('sk_aimed', '要害射擊', 'active', 5, { after: 'sk_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { aimed: true } } }),
    sk('sk_burst', '連射控制', 'active', 5, { after: 'sk_instinct', use: { ap: 3 }, meat: { target: 'enemy', attack: { hit: 1 } } }),
  ],
}

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_clinic', name: '診所', clinic: { grade: 'clinic' } },
      { id: 'fac_unlic', name: '無照診所', clinic: { grade: 'unlicensed' } },
      { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '正規診所' }, F2: { type: 'fac_unlic', name: '無照診所' }, F3: { type: 'fac_black', name: '黑診所' } } }],
    part: structuredClone(PARTS),
    blueprint: structuredClone(BLUEPRINTS),
    quirk: structuredClone(QUIRKS),
    path: structuredClone(ABILITY_CONTENT.path) as Rec[],
    ability: structuredClone(ABILITY_CONTENT.ability) as Rec[],
  }
  patch(c)
  return { id: 'cyber_bridge_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：效果 sink_floor（M4-sink 註冊；暫時的下限加減，amount 與 days）。換橋時套下去只留下兩個旗標。 */
const SINK_STUB: Feature = {
  id: 'sink_stub',
  install(k) {
    k.effects.register({
      kind: 'sink_floor', owner: 'sink_stub', ai: false,
      validate: (raw) => [...(Number.isInteger(raw.amount) ? [] : ['amount 要是整數']), ...(Number.isInteger(raw.days) ? [] : ['days 要是整數'])],
      toChanges: (e): Change[] => [{ op: 'flag', key: 'tmp_floor', value: e.amount as number }, { op: 'flag', key: 'tmp_days', value: e.days as number }],
      describe: () => '暫時的沉溺',
    })
  },
}

const PARAMS = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
interface Opts {
  pc?: Rec
  money?: { cred: number; cash: number }
  sink?: boolean
  pack?: ContentPack
  extraPack?: ContentPack[]
}
const make = (o: Opts = {}) => {
  const features: Feature[] = [characterFeature, worldFeature, lewdFeature, abilitiesFeature, cyberwareFeature, ...(o.sink === false ? [] : [SINK_STUB])]
  const { game } = makeGame({
    features, content: [o.pack ?? pack(), ...(o.extraPack ?? [])], seed: 7, pc: { hp: 40, skills: { cyberware: 2 }, ext: { bridge: PARAMS }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const pc = (g: G) => g.state.actors.pc!
const now = (g: G) => toMinutes(g.state.time)
const last = (g: G) => g.state.reports[g.state.reports.length - 1]!
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

/** 把一座橋直接放進主角身上（不經手術）：測容量用。 */
const wear = (g: G, bpId: string, parts: Rec, uid = 'old', over: Rec = {}) => {
  const ext = pc(g).ext as Rec
  ext.cyber = { pieces: [...((ext.cyber?.pieces as Rec[]) ?? []), { uid, bp: bpId, slot: 'bridge', parts, sink: 4, at: 0, registered: true, ...over }] }
}
const give = (g: G, bpId: string, parts: Rec, uid: string, extra: Rec = {}) => { g.state.inventory.push({ id: bpId, qty: 1, data: { uid, parts, ...extra } }) }
const parts = (chip: string, sw: string, neuron = 'pt_neuron') => ({ chip, neuron, software: sw })
const caps = (g: G) => bridgeCapacityOf(g.k, g.state, 'pc').split
const swapOpts = (o: Partial<BridgeOpts> & { uid: string }): BridgeOpts => ({ actor: 'pc', via: 'clinic', ...o })
const swap = (g: G, o: Partial<BridgeOpts> & { uid: string }): ReportDraft => swapBridgeDraft(g.k, g.state, swapOpts(o))
const stat = (g: G, id: string) => g.k.stats.stat(g.state, 'pc', id)
const fromCyber = (g: G, id: string) => g.k.stats.statParts(g.state, 'pc', id).filter((p) => p.source === 'cyber')
afterEach(() => { vi.restoreAllMocks() })

// ---- 容量的算法（P8） ----

describe('橋的容量：晶片的總量照軟體的配分分、補到下限、加親和', () => {
  it('52 配均衡：13、13、13、13', () => {
    const g = make()
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'))
    expect(caps(g)).toEqual({ meat: 13, net: 13, social: 13, media: 13 })
    expect(bridgeCapacityOf(g.k, g.state, 'pc')).toMatchObject({ total: 52, chip: 52 })
  })

  it('54 配偏現實加現實 +1 的神經元：20、15、10、10 合計 55（ITEMS 3.1 節緋櫻 奉公）；組成看得到份數、補點與親和', () => {
    const g = make()
    wear(g, 'bp_bridge', parts('pt_chip54', 'pt_sw_real', 'pt_neuron_meat'))
    expect(caps(g)).toEqual({ meat: 20, net: 15, social: 10, media: 10 })
    const c = bridgeCapacityOf(g.k, g.state, 'pc')
    expect(c.total).toBe(55)
    // 54 × 20／55 ＝ 19.64、15 → 14.73、10 → 9.82、9.82：先捨去 19、14、9、9，剩 3 點給小數最大的三類（社交、媒體一樣大，社交先；再來內海）
    expect(c.from).toEqual({
      meat: { share: 19, floor: 0, affinity: 1 }, net: { share: 15, floor: 0, affinity: 0 },
      social: { share: 10, floor: 0, affinity: 0 }, media: { share: 10, floor: 0, affinity: 0 },
    })
  })

  it('52 配偏內海：8、28、8、8', () => {
    const g = make()
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_net'))
    expect(caps(g)).toEqual({ meat: 8, net: 28, social: 8, media: 8 })
  })

  it('40 配一套把某一類分到 5 的軟體：那一類補到 8、差額從最多的那一類扣，合計還是 40', () => {
    const g = make()
    wear(g, 'bp_bridge', parts('pt_chip40', 'pt_sw_five'))
    expect(caps(g)).toEqual({ meat: 8, net: 12, social: 10, media: 10 })
    const c = bridgeCapacityOf(g.k, g.state, 'pc')
    expect(c.total).toBe(40)
    expect(c.from.meat).toEqual({ share: 5, floor: 3, affinity: 0 })
    expect(c.from.net).toEqual({ share: 15, floor: -3, affinity: 0 })
  })

  it('沒有軟體當四類等分；餘數一樣大照現實、內海、社交、媒體的順序補', () => {
    const g = make()
    wear(g, 'bp_bridge', { chip: 'pt_chip54', neuron: 'pt_neuron' })
    expect(caps(g)).toEqual({ meat: 14, net: 14, social: 13, media: 13 })
    const h = make()
    wear(h, 'bp_bridge', parts('pt_chip52', 'pt_sw_tie'))
    // 52 照 1：1：1：0 分，三類各 17.33 → 17，剩 1 點給餘數最大的現實（一樣大先現實）；媒體 0 補到 8，從現實扣
    expect(caps(h)).toEqual({ meat: 10, net: 17, social: 17, media: 8 })
    expect(bridgeCapacityOf(h.k, h.state, 'pc').total).toBe(52)
  })

  it('晶片總量太小補不齊時不再扣（每一類最少 8，合計超過晶片）；沒有晶片的橋是 0 加下限', () => {
    const g = make()
    wear(g, 'bp_bridge', parts('pt_chip30', 'pt_sw_even'))
    expect(caps(g)).toEqual({ meat: 8, net: 8, social: 8, media: 8 })
    const h = make()
    wear(h, 'bp_junk_bridge', { neuron: 'pt_neuron' })
    expect(caps(h)).toEqual({ meat: 8, net: 8, social: 8, media: 8 })
  })

  it('下限是規則（cyber_rule.cap_min）：蓋成 10 之後 40 配把現實分到 5 的軟體，現實是 10', () => {
    const g = make({ extraPack: [{ id: 'r', content: { cyber_rule: [{ id: 'default', cap_min: 10 }] } } as unknown as ContentPack] })
    wear(g, 'bp_bridge', parts('pt_chip40', 'pt_sw_five'))
    expect(caps(g)).toEqual({ meat: 10, net: 10, social: 10, media: 10 })
  })

  it('沒有過渡了（M4-creation-body 之後）：身上沒有橋那一件，ext.bridge.capacity 寫什麼都不算；裝了橋那一件就以零件為準', () => {
    const g = make({ pc: { ext: { bridge: { ...PARAMS, capacity: { meat: 12, net: 3, social: 20, media: 'x' } } } } })
    expect(caps(g)).toEqual({ meat: 0, net: 0, social: 0, media: 0 })
    expect(capacityOf(g.k, g.state, 'pc').social.max).toBe(0)
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'))
    expect(caps(g)).toEqual({ meat: 13, net: 13, social: 13, media: 13 })
    const none = make({ pc: { ext: { bridge: null } } })
    expect(caps(none)).toEqual({ meat: 0, net: 0, social: 0, media: 0 })
  })

  it('沒有橋是 0；休養中的橋容量照算；衍生數值 bridge_cap_<類> 就是容量', () => {
    const g = make()
    expect(caps(g)).toEqual({ meat: 0, net: 0, social: 0, media: 0 })
    expect(stat(g, 'bridge_cap_meat')).toBe(0)
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_net'), 'old', { ready_at: now(g) + 5000 })
    expect([stat(g, 'bridge_cap_meat'), stat(g, 'bridge_cap_net'), stat(g, 'bridge_cap_social'), stat(g, 'bridge_cap_media')]).toEqual([8, 28, 8, 8])
  })

  it('isBridge：橋的判斷只有一個函式（收一件或部位的 id）', () => {
    expect(isBridge('bridge')).toBe(true)
    expect(isBridge({ slot: 'bridge' })).toBe(true)
    expect(isBridge({ slot: 'brain' })).toBe(false)
    expect(isBridge('arm_l')).toBe(false)
    expect(isBridge(undefined)).toBe(false)
  })
})

// ---- abilities 讀新的容量 ----

describe('abilities 的 capacityOf 讀衍生數值', () => {
  it('裝了 cyberware 的 kernel 讀上面的數字；沒有橋是 0', () => {
    const g = make()
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 0, max: 0 })
    wear(g, 'bp_bridge', parts('pt_chip54', 'pt_sw_real', 'pt_neuron_meat'))
    expect(capacityOf(g.k, g.state, 'pc')).toEqual({ meat: { used: 0, max: 20 }, net: { used: 0, max: 15 }, social: { used: 0, max: 10 }, media: { used: 0, max: 10 } })
  })

  it('只裝 abilities 的 kernel 照舊讀 ext.bridge.capacity（每類最少 8；沒有橋是 0）', () => {
    const mini = { id: 'mini', content: { path: ABILITY_CONTENT.path, ability: ABILITY_CONTENT.ability } } as unknown as ContentPack
    const { game } = makeGame({
      features: [abilitiesFeature], content: [mini], pc: { ext: { bridge: { capacity: { meat: 12, net: 20, social: 3, media: 8 } } } },
    })
    expect(capacityOf(game.k, game.state, 'pc')).toEqual({ meat: { used: 0, max: 12 }, net: { used: 0, max: 20 }, social: { used: 0, max: 8 }, media: { used: 0, max: 8 } })
    const { game: bare } = makeGame({ features: [abilitiesFeature], content: [mini], pc: { ext: { bridge: null } } })
    expect(capacityOf(bare.k, bare.state, 'pc').meat.max).toBe(0)
  })

  it('裝技能照新容量擋：現實 13 裝得下 3＋5＋5，換成現實 8 的橋之後再裝一次就被擋', () => {
    const g = make({
      pc: { ext: { bridge: PARAMS, abilities: { xp: 0, learned: ['sk_instinct', 'sk_aimed', 'sk_burst'], equipped: [], spent: {} } } },
      extraPack: [{ id: 'r', content: { ability_rule: [{ id: 'default', loadout_facility_types: [] }] } } as unknown as ContentPack],
    })
    stand(g, 'F1')
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'))
    expect(capacityOf(g.k, g.state, 'pc').meat.max).toBe(13)
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_instinct', 'sk_aimed', 'sk_burst']))
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 13, max: 13 })
    ;(pc(g).ext as Rec).cyber = { pieces: [{ uid: 'new', bp: 'bp_bridge', slot: 'bridge', parts: parts('pt_chip52', 'pt_sw_net'), sink: 4, at: 0 }] }
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 13, max: 8 })
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_instinct', 'sk_aimed', 'sk_burst'])).toThrow('現實型的容量不夠（要 13，橋只有 8）。')
  })
})

// ---- 換橋 ----

describe('換橋：一次手術拆舊的、裝新的', () => {
  const setup = (o: Opts = {}) => {
    const g = make(o)
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'old', { sink: 4 })
    stand(g, 'F1')
    give(g, 'bp_bridge_hot', parts('pt_chip52', 'pt_sw_net'), 'new')
    return g
  }

  it('扣的是安裝費的兩倍（1800）、時間 +60 分鐘、休養 3 天、沉溺成本換成新橋的（9 的正規診所 −10％ ＝ 8）、沉溺補到下限、效果 sink_floor 給 +5 七天', async () => {
    const g = setup()
    const t0 = now(g)
    const q = bridgeQuote(g.k, g.state, swapOpts({ uid: 'new' }))!
    expect(q).toMatchObject({ price: 1800, install_fee: 900, fee: 1800, sink: 8, minutes: 60, recovery_minutes: 4320, complication: 0, registered: true, pay: 'cred', keeps: false })
    expect(q.replaces).toMatchObject({ uid: 'old', sink: 4 })
    expect(q.temp_sink).toEqual({ amount: 5, days: 7 })
    expect(q.before).toMatchObject({ total: 52 })
    expect(q.after.split).toEqual({ meat: 8, net: 28, social: 8, media: 8 })
    const { violations } = await observed(g, () => g.commit(swap(g, { uid: 'new' })))
    expect(violations).toEqual([])
    expect(g.state.money.cred).toBe(20000 - 1800)
    expect(now(g) - t0).toBe(60)
    const pieces = cyberOf(g.state, 'pc')
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ uid: 'new', bp: 'bp_bridge_hot', slot: 'bridge', sink: 8, registered: true, parts: parts('pt_chip52', 'pt_sw_net') })
    expect(pieces[0]!.ready_at).toBe(now(g) + 4320)
    expect(pc(g).conditions.find((c) => c.id === 'recovering')).toEqual({ id: 'recovering', until: now(g) + 4320 })
    expect(stat(g, 'sink_floor')).toBe(8)
    expect(pc(g).sink).toBe(8)
    expect(g.state.flags).toMatchObject({ tmp_floor: 5, tmp_days: 7 })
    expect(g.state.inventory.some((s) => s.data?.uid === 'new')).toBe(false)
    expect(last(g)).toMatchObject({ kind: 'action', action: 'cyber.bridge', actor: 'pc', outcome: { result: 'swapped' } })
    // 結果的句子不帶機制數字
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
  })

  it('舊橋沒有 keep 就沒有了；keep 時回到背包、state: used、同一個 uid、零件不少', () => {
    const g = setup()
    g.commit(swap(g, { uid: 'new' }))
    expect(g.state.inventory.some((s) => s.data?.uid === 'old')).toBe(false)
    const h = setup()
    h.commit(swap(h, { uid: 'new', keep: true }))
    const back = h.state.inventory.find((s) => s.data?.uid === 'old')
    expect(back).toMatchObject({ id: 'bp_bridge', qty: 1, data: { uid: 'old', state: 'used', parts: parts('pt_chip52', 'pt_sw_even') } })
    expect(back!.data).not.toHaveProperty('slot')
    expect(back!.data).not.toHaveProperty('sink')
    expect(bridgeQuote(h.k, h.state, swapOpts({ uid: 'new', keep: true }))).toBeNull()
  })

  it('全生體的舊橋就算 keep 也沒有了（離開身體就死了）', () => {
    const g = make()
    wear(g, 'bp_bridge', { chip: 'pt_chip52', neuron: 'pt_neuron_bio', software: 'pt_sw_even' }, 'old')
    // 只有神經元是生體：混裝，機械的留下、生體的死了
    stand(g, 'F1')
    give(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_net'), 'new')
    g.commit(swap(g, { uid: 'new', keep: true }))
    const back = g.state.inventory.find((s) => s.data?.uid === 'old')!
    expect(back.data).toMatchObject({ state: 'used', parts: { chip: 'pt_chip52', software: 'pt_sw_even' } })
    expect((back.data as Rec).parts).not.toHaveProperty('neuron')
  })

  it('ext.bridge 的四項參數沒有變；沒有人註冊 sink_floor 時換橋照做、只是沒有暫時的沉溺', () => {
    const g = setup({ sink: false })
    expect(bridgeQuote(g.k, g.state, swapOpts({ uid: 'new' }))!.temp_sink).toBeNull()
    g.commit(swap(g, { uid: 'new' }))
    expect(pc(g).ext.bridge).toEqual(PARAMS)
    expect(g.state.flags.tmp_floor).toBeUndefined()
    expect(cyberOf(g.state, 'pc')[0]!.uid).toBe('new')
    const h = setup()
    h.commit(swap(h, { uid: 'new' }))
    expect(pc(h).ext.bridge).toEqual(PARAMS)
  })

  it('裝著的技能超過新容量時不自動卸；結果的句子提醒一次；變大的換橋沒有這句', () => {
    const g = setup({ pc: { ext: { bridge: PARAMS, abilities: { xp: 0, learned: ['sk_instinct', 'sk_aimed', 'sk_burst'], equipped: ['sk_instinct', 'sk_aimed', 'sk_burst'], spent: {} } } } })
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 13, max: 13 })
    g.commit(swap(g, { uid: 'new' }))
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 13, max: 8 })
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['sk_instinct', 'sk_aimed', 'sk_burst'])
    // 換橋那一份的後面，abilities 另外接一份 ability.capacity 的提醒（M4-abilities-m4）；換橋自己那一份不再寫「容量比舊橋小」（M4-followups-2 第 7 項：提醒由 abilities 接手）
    const texts = g.state.reports.filter((r) => r.action === 'cyber.bridge').at(-1)!.narration!.results!
    expect(texts.filter((t) => t.includes('容量比舊橋小'))).toHaveLength(0)
    expect(last(g).action).toBe('ability.capacity')
    expect(last(g).narration!.results!.join('')).toContain('超過橋現在的容量')
    // 換成每一類都不小的橋：沒有提醒
    const h = make()
    wear(h, 'bp_bridge', parts('pt_chip40', 'pt_sw_even'), 'old')
    stand(h, 'F1')
    give(h, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'new')
    h.commit(swap(h, { uid: 'new' }))
    expect(last(h).narration!.results!.join('')).not.toContain('容量比舊橋小')
  })

  it('休養期間橋的容量照算（不然整段時間沒有技能）；沉溺成本照新的那一座', () => {
    const g = setup()
    g.commit(swap(g, { uid: 'new' }))
    expect(caps(g)).toEqual({ meat: 8, net: 28, social: 8, media: 8 })
    expect(capacityOf(g.k, g.state, 'pc').net.max).toBe(28)
    expect(stat(g, 'sink_floor')).toBe(8)
  })

  it('費用的倍數、休養時間、暫時沉溺都是規則（cyber_rule）', () => {
    const g = setup({ extraPack: [{ id: 'r', content: { cyber_rule: [{ id: 'default', bridge_fee_mult: 3, bridge_recovery_minutes: 100, bridge_swap_sink: { amount: 7, days: 2 } }] } } as unknown as ContentPack] })
    g.commit(swap(g, { uid: 'new' }))
    expect(g.state.money.cred).toBe(20000 - 2700)
    expect(cyberOf(g.state, 'pc')[0]!.ready_at).toBe(now(g) + 100)
    expect(g.state.flags).toMatchObject({ tmp_floor: 7, tmp_days: 2 })
    expect(DEFAULT_CYBER_RULES).toMatchObject({ bridge_fee_mult: 2, bridge_recovery_minutes: 4320, bridge_swap_sink: { amount: 5, days: 7 }, cap_min: 8 })
  })

  it('規則表的新欄位格式錯誤被擋下', () => {
    for (const bad of [{ bridge_fee_mult: -1 }, { bridge_recovery_minutes: 1.5 }, { bridge_swap_sink: { amount: 5 } }, { bridge_swap_sink: { amount: 5, days: 0 } }, { cap_min: 100 }]) {
      expect(() => make({ extraPack: [{ id: 'r', content: { cyber_rule: [{ id: 'default', ...bad }] } } as unknown as ContentPack] })).toThrow(ContentError)
    }
  })

  it('黑診所照機率留併發症（骰子固定 0.1 留、0.9 不留）；診所不留', () => {
    const g = setup()
    stand(g, 'F3')
    const spy = vi.spyOn(Rng.prototype, 'next').mockReturnValue(0.1)
    let d: ReportDraft
    try {
      d = swap(g, { uid: 'new', via: 'black' })
    } finally {
      spy.mockRestore()
    }
    g.commit(d)
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ quirks: ['cx_scar'], registered: false })
    expect(g.state.money.cred).toBe(20000 - 1440)
    const h = setup()
    stand(h, 'F3')
    const spy2 = vi.spyOn(Rng.prototype, 'next').mockReturnValue(0.9)
    try {
      h.commit(swap(h, { uid: 'new', via: 'black' }))
    } finally {
      spy2.mockRestore()
    }
    expect(cyberOf(h.state, 'pc')[0]!.quirks).toBeUndefined()
  })

  it('擋下的原因一條一句：不是橋、是義眼、背包沒有、錢不夠、自己動刀、沒有診所、舊橋有授權鎖', () => {
    const g = setup()
    give(g, 'bp_eye', { sensor: 'pt_eye' }, 'eye')
    expect(swapBridgeBlock(g.k, g.state, swapOpts({ uid: 'eye' }))).toBe('義眼不是橋。')
    expect(swapBridgeBlock(g.k, g.state, swapOpts({ uid: 'nope' }))).toBe('背包裡沒有這一件。')
    expect(swapBridgeBlock(g.k, g.state, { actor: 'ghost', uid: 'new', via: 'clinic' })).toBe('找不到這個角色。')
    expect(swapBridgeBlock(g.k, g.state, swapOpts({ uid: 'new', via: 'self' }))).toBe('橋是大手術，只有診所做得了。')
    expect(swapBridgeBlock(g.k, g.state, swapOpts({ uid: 'new', via: 'black' }))).toBe('這裡沒有黑診所。')
    expect(reasonOf(() => swap(g, { uid: 'new', via: 'black' }))).toBe('這裡沒有黑診所。')
    const poor = setup({ money: { cred: 100, cash: 100 } })
    expect(swapBridgeBlock(poor.k, poor.state, swapOpts({ uid: 'new' }))).toContain('錢不夠')
    const locked = setup()
    ;((pc(locked).ext as Rec).cyber.pieces as Rec[])[0]!.off = { why: 'lock' }
    expect(swapBridgeProblems(locked.k, locked.state, swapOpts({ uid: 'new' }))).toEqual(['舊橋有授權鎖，要先解鎖。'])
    const missing = setup()
    give(missing, 'bp_bridge', { chip: 'pt_chip52', neuron: 'pt_neuron' }, 'part')
    expect(swapBridgeBlock(missing.k, missing.state, swapOpts({ uid: 'part' }))).toBe('缺零件：軟體。')
  })
})

// ---- 沒有橋的人 ----

describe('沒有橋的人', () => {
  it('四類容量都是 0；裝上第一座之後 ext.bridge 有四項預設值（30）、容量是算出來的；費用不加倍、沒有暫時的沉溺', () => {
    const g = make({ pc: { ext: { bridge: null } } })
    stand(g, 'F1')
    expect(caps(g)).toEqual({ meat: 0, net: 0, social: 0, media: 0 })
    expect(capacityOf(g.k, g.state, 'pc').social).toEqual({ used: 0, max: 0 })
    give(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'first')
    const q = bridgeQuote(g.k, g.state, swapOpts({ uid: 'first' }))!
    expect(q).toMatchObject({ install_fee: 900, fee: 900, replaces: null, temp_sink: null })
    g.commit(swap(g, { uid: 'first' }))
    expect(g.state.money.cred).toBe(20000 - 900)
    expect(pc(g).ext.bridge).toEqual({ sensitivity: 30, tolerance: 30, craving: 30, docility: 30 })
    expect(caps(g)).toEqual({ meat: 13, net: 13, social: 13, media: 13 })
    expect(capacityOf(g.k, g.state, 'pc').media.max).toBe(13)
    expect(g.state.flags.tmp_floor).toBeUndefined()
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ uid: 'first', slot: 'bridge', sink: 4 })
    expect(pc(g).sink).toBe(4)
    expect(last(g)).toMatchObject({ action: 'cyber.bridge', outcome: { result: 'installed' } })
  })

  it('預設值讀 lewd_rule 的 default_bridge；查不到用 30', () => {
    const g = make({ pc: { ext: { bridge: null } }, extraPack: [{ id: 'r', content: { lewd_rule: [{ id: 'default', default_bridge: 45 }] } } as unknown as ContentPack] })
    stand(g, 'F1')
    give(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'first')
    g.commit(swap(g, { uid: 'first' }))
    expect(pc(g).ext.bridge).toEqual({ sensitivity: 45, tolerance: 45, craving: 45, docility: 45 })
  })

  it('沒有橋時別的義體（需要橋的）裝不上，裝了橋就裝得上；橋不能走一般的裝上與拆下', () => {
    const g = make({ pc: { ext: { bridge: null } } })
    stand(g, 'F1')
    give(g, 'bp_eye', { sensor: 'pt_eye' }, 'eye')
    give(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'first')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'eye', via: 'clinic' })).toBe('這件義體要接在橋上，你還沒有橋。')
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'first', via: 'clinic' })).toBe('換橋是另一種手術。')
    g.commit(swap(g, { uid: 'first' }))
    expect(installBlock(g.k, g.state, { actor: 'pc', uid: 'eye', via: 'clinic' })).toBeNull()
  })

  it('removeDraft 對橋被擋並有原因（拆到沒有橋不開放）', () => {
    const g = make()
    wear(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'old')
    stand(g, 'F1')
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'old', via: 'clinic' })).toBe('橋不能這樣拆，換橋是另一種手術。')
    expect(reasonOf(() => removeDraft(g.k, g.state, { actor: 'pc', uid: 'old', via: 'clinic' }))).toBe('橋不能這樣拆，換橋是另一種手術。')
  })
})

// ---- 橋的機能是被動效果 ----

describe('橋的機能（設計圖的 effects）', () => {
  it('耐受 +15：好了之後 load_cap 多 7；休養期間沒有，但容量有', () => {
    const g = make()
    stand(g, 'F1')
    const base = stat(g, 'load_cap')
    give(g, 'bp_bridge_fx', parts('pt_chip52', 'pt_sw_even'), 'fx')
    g.commit(swap(g, { uid: 'fx' }))
    expect(cyberOf(g.state, 'pc')[0]!.ready_at).toBe(now(g) + 4320)
    expect(stat(g, 'load_cap')).toBe(base)
    expect(stat(g, 'bridge_tolerance')).toBe(30)
    expect(caps(g)).toEqual({ meat: 13, net: 13, social: 13, media: 13 })
    advance(g, 4319)
    expect(stat(g, 'load_cap')).toBe(base)
    advance(g, 1)
    expect(stat(g, 'load_cap')).toBe(base + 7)
    expect(stat(g, 'bridge_tolerance')).toBe(45)
    expect(fromCyber(g, 'bridge_tolerance')).toEqual([{ label: '機能橋', value: 15, source: 'cyber' }])
  })

  it('RAM +2、換配置半小時（−30）、同步檔位上限 +1、敏感度 −15 都寫得出來，來源標 cyber', () => {
    const g = make()
    stand(g, 'F1')
    const ram = stat(g, 'ram_max')
    const loadout = stat(g, 'loadout_minutes')
    const sync = stat(g, 'sync_cap_bonus')
    const sens = stat(g, 'bridge_sensitivity')
    give(g, 'bp_bridge_fx', parts('pt_chip52', 'pt_sw_even'), 'fx')
    g.commit(swap(g, { uid: 'fx' }))
    expect([stat(g, 'ram_max'), stat(g, 'loadout_minutes'), stat(g, 'sync_cap_bonus'), stat(g, 'bridge_sensitivity')]).toEqual([ram, loadout, sync, sens])
    advance(g, 4320)
    expect(stat(g, 'ram_max')).toBe(ram + 2)
    expect(stat(g, 'loadout_minutes')).toBe(loadout - 30)
    expect(stat(g, 'sync_cap_bonus')).toBe(sync + 1)
    expect(stat(g, 'bridge_sensitivity')).toBe(sens - 15)
    for (const id of ['ram_max', 'loadout_minutes', 'sync_cap_bonus', 'bridge_sensitivity']) expect(fromCyber(g, id)).toHaveLength(1)
  })

  it('換掉有機能的橋：新橋沒有 effects，機能跟著舊橋走', () => {
    const g = make()
    wear(g, 'bp_bridge_fx', parts('pt_chip52', 'pt_sw_even'), 'old')
    stand(g, 'F1')
    expect(stat(g, 'ram_max')).toBeGreaterThanOrEqual(6)
    const withFx = stat(g, 'ram_max')
    give(g, 'bp_bridge', parts('pt_chip52', 'pt_sw_even'), 'plain')
    g.commit(swap(g, { uid: 'plain' }))
    advance(g, 4320)
    expect(stat(g, 'ram_max')).toBe(withFx - 2)
  })
})
