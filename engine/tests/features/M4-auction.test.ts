// 驗收測試：dev/work/M4-auction.md（cpp-feature）。拍賣行「白槌」的前半：一家拍賣行是一筆內容、會員與推薦、每週的目錄與競標者、預展看貨。
// 規格：LEWD_SYSTEM 6.2 節（進場、一場拍賣、成交裡預展看貨那一條）、第 9 節；FACTIONS 5.1 節；dev/adr/0019 第十八節與 P76、P77、P79、P81、P83、P84。
// 內容一律用測試自帶的最小假資料：一家拍賣行（週五、晚上那一段、4～6 件、五種都賣、must 是零件與義體、會員看一個勢力的好感 40 或推薦）、
// 第二家只賣契約的（週三）、十二件拍品、四位競標者（一位帶 npc）、兩位帶 auction_ref 的 NPC；好感、親密度用測試註冊的假量表。
// 一起裝：world（設施）、favors（人情；有一組測試沒裝它）、auction；測試自己的功能註冊假量表與（選裝）假的 contract_hold 效果。
// 時間：第 1 天是週二，所以第 4、11、18…天是週五，第 9、16…天是週三，第 10、17…天是週四。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, deriveRng, effectCtx, productPrice, toMinutes } from '../../src'
import {
  DEFAULT_AUCTION_RULES, auctionFeature, auctionOf, auctionRules, catalogOf, catalogView, housesHere, inspectBlock, inspectDraft, inspectOptions, memberOf, refBlock, refDraft, refOptions, sessionOf,
} from '../../src/features/auction'
import { favorsFeature, favorsOf } from '../../src/features/favors'
import { worldFeature } from '../../src/features/world'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const MAP = {
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
}
const SKILLS = [
  { id: 'cyberware', name: '義體學', attr: 'tech', desc: '義體學。' }, { id: 'investigate', name: '調查', attr: 'intellect', desc: '調查。' },
  { id: 'negotiate', name: '交涉', attr: 'charm', desc: '交涉。' },
]
const part = (id: string, type: string, grade: number, price: number, over: Rec = {}): Rec => ({
  id, name: `零件${id}`, type, material: 'mech', brand: 'hz', grade, price, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS: Rec[] = [
  part('pt_3a', 'sensor', 3, 3000), part('pt_3b', 'power', 3, 2400), part('pt_4a', 'plate', 4, 9000), part('pt_4b', 'actuator', 4, 7600),
  part('pc_chip3', 'chip', 3, 2500), part('pc_chip4', 'chip', 4, 6000),
]
const bp = (id: string, over: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, brand: 'hz', grade: 3, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...over })
const BLUEPRINTS: Rec[] = [
  bp('bp_c1', { kind: 'cyberware', name: '義眼', slot: 'eye', invasiveness: 'invasive', sink_cost: 5, require: [{ type: 'chip' }], stock: { chip: 'pc_chip3' } }),
  bp('bp_c2', { kind: 'cyberware', name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 4, require: [{ type: 'chip' }], stock: { chip: 'pc_chip4' } }),
]
const item = (id: string, name: string): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 3, size: 1, legal: 'free', price: 100 })
const ITEMS: Rec[] = [item('it_art_a', '玻璃岸的畫'), item('it_art_b', '會呼吸的雕塑'), item('it_sec', '一捲帶子')]
const FACTIONS = [{ id: 'f_eden', name: '伊甸園', short: '伊甸', class: 'corp' }]
const NPCS: Rec[] = [
  { id: 'npc_ref', name: '常客甲', auction_ref: ['h_white'] }, { id: 'npc_ref2', name: '鑑定師乙', auction_ref: true }, { id: 'npc_bid', name: '認識的買家' },
  { id: 'npc_holder', name: '債主' }, { id: 'npc_plain', name: '路人' },
]

const HOUSES: Rec[] = [
  { id: 'h_white', name: '白槌', weekday: 4, segment: 'prime', lots: [4, 6], kinds: ['part', 'cyberware', 'art', 'secret', 'contract'], must: ['part', 'cyberware'], bidders: [3, 6], member: { faction: 'f_eden', favor_min: 40, ref: true } },
  { id: 'h_park', name: '樂園二樓', weekday: 2, segment: 'prime', lots: [2, 3], kinds: ['contract'], bidders: [3, 4], member: { faction: 'f_eden', favor_min: 60 } },
]
const LOTS: Rec[] = [
  { id: 'l_p3a', kind: 'part', part: 'pt_3a' }, { id: 'l_p3b', kind: 'part', part: 'pt_3b', name: '舊貨架上的電源', cert: '鑑定師簽了名。' },
  { id: 'l_p4a', kind: 'part', part: 'pt_4a' }, { id: 'l_p4b', kind: 'part', part: 'pt_4b' },
  { id: 'l_c1', kind: 'cyberware', blueprint: 'bp_c1' }, { id: 'l_c2', kind: 'cyberware', blueprint: 'bp_c2', desc: '一條新的義臂。' },
  { id: 'l_art_a', kind: 'art', item: 'it_art_a', market: 4000 }, { id: 'l_art_b', kind: 'art', item: 'it_art_b', market: 6000, tags: ['fx_tag'] },
  { id: 'l_sec_a', kind: 'secret', item: 'it_sec', market: 5000, name: '一捲帶子' }, { id: 'l_sec_b', kind: 'secret', market: 3000, name: '一則只賣一次的情報', effects: [{ kind: 'cash', amount: 1 }] },
  { id: 'l_con_a', kind: 'contract', contract: { type: 'debt' }, npc: 'npc_holder', market: 20000, once: true, name: '債主的契約' }, { id: 'l_con_b', kind: 'contract', contract: { type: 'debt' }, market: 9000, houses: ['h_park'] },
]
const BIDDERS: Rec[] = [
  { id: 'b_npc', name: '認識的買家', npc: 'npc_bid', interests: ['art'] }, { id: 'b_a', name: '收藏家', interests: ['art', 'secret'] },
  { id: 'b_b', name: '採購員', interests: ['part', 'cyberware'], weight: 2 }, { id: 'b_c', name: '債權人', interests: ['contract'] },
]

type Pack = Record<string, Rec[]>
const pack = (mod?: (c: Pack) => void): ContentPack => {
  const c: Pack = {
    skill: structuredClone(SKILLS), faction: structuredClone(FACTIONS), npc: structuredClone(NPCS), special_map: [structuredClone(MAP)],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 3, blocks: ['b_shops'], factions: ['f_eden'] }],
    block: [{ id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '雜貨店' }, F2: { type: 'fac_auction', name: '白槌拍賣行' }, F3: { type: 'fac_park', name: '樂園二樓' } } }],
    facility_type: [{ id: 'fac_plain', name: '雜貨店' }, { id: 'fac_auction', name: '拍賣行', auction: { house: 'h_white' } }, { id: 'fac_park', name: '契約拍賣廳', auction: { house: 'h_park' } }],
    part: structuredClone(PARTS), blueprint: structuredClone(BLUEPRINTS), item: structuredClone(ITEMS),
    auction_house: structuredClone(HOUSES), auction_lot: structuredClone(LOTS), auction_bidder: structuredClone(BIDDERS),
  }
  mod?.(c)
  return { id: 'm4_auction', content: c as unknown as ContentPack['content'] }
}

// ---- 測試自己的功能：假量表、假的 contract_hold ----

const METERS: Feature = {
  id: 'test_meters',
  install(k: Kernel) {
    k.meters.define({ kind: 'favor', owner: 'test_meters', name: '好感', min: 0, max: 100, start: 0, keyed: 'faction', cap: { down: 100, up: 100 } })
    k.meters.define({ kind: 'affinity', owner: 'test_meters', name: '親密度', min: -100, max: 100, start: 0, keyed: 'npc', cap: { down: 100, up: 100 } })
  },
}
const HOLD: Feature = {
  id: 'test_hold',
  install(k: Kernel) {
    k.effects.register({ kind: 'contract_hold', owner: 'test_hold', ai: false, validate: () => [], toChanges: () => [], describe: () => '持約。' })
  },
}

// ---- 建局 ----

const PC = { hp: 40, attrs: { reflex: 10, charm: 10, tech: 14, intellect: 14 }, skills: { cyberware: 2, investigate: 1 } }
const HOUSE_AT = { district: 'd_hive', block: 'b_shops', facility: 'F2' }
const PARK_AT = { district: 'd_hive', block: 'b_shops', facility: 'F3' }
const SHOP_AT = { district: 'd_hive', block: 'b_shops', facility: 'F1' }

interface Opts { seed?: number; hold?: boolean; favors?: boolean; mod?: (c: Pack) => void; day?: number; hour?: number; at?: Record<string, string>; skills?: Rec }
const make = (o: Opts = {}) => {
  const features: Feature[] = [worldFeature, METERS, ...(o.favors === false ? [] : [favorsFeature]), ...(o.hold === false ? [] : [HOLD]), auctionFeature]
  const { game } = makeGame({
    features, content: [pack(o.mod)], seed: o.seed ?? 7, pc: { ...PC, skills: o.skills ?? PC.skills } as never,
    patch: { time: { day: o.day ?? 9, hour: o.hour ?? 12, minute: 0 }, money: { cred: 5000, cash: 3000 } },
  })
  game.state.location = { ...(o.at ?? HOUSE_AT) }
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const resolve = (g: G, effects: Rec[], source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
const give = (g: G, ...effects: Rec[]) => {
  const r = resolve(g, effects)
  expect(r.errors).toEqual([])
  g.commit(sys(r.changes))
  return r
}
const setFavor = (g: G, faction: string, n: number): void => void g.commit(sys([{ op: 'meter', kind: 'favor', key: faction, set: n }]))
const setAffinity = (g: G, npc: string, n: number): void => void g.commit(sys([{ op: 'meter', kind: 'affinity', key: npc, set: n }]))
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const setTime = (g: G, day: number, hour = 12, minute = 0): void => void (g.state.time = { day, hour, minute })
/** 第 w 週的週三（開槌日往前兩天）：第 9 天是第 0 週。 */
const wed = (w: number): number => 9 + 7 * w
const now = (g: G): number => toMinutes(g.state.time)
const catalogAt = (g: G, w: number, house = 'h_white') => {
  setTime(g, wed(w))
  return catalogOf(g.k, g.state, house)!
}
/** 把存檔的亂數游標撥到想要的骰面。 */
function findNatural(g: G, purpose: string, want: number): void {
  for (let c = 0; c < 100000; c++) {
    if (deriveRng({ seed: g.state.rng.seed, cursor: c }, purpose, 0).int(1, 20) === want) {
      g.state.rng.cursor = c
      return
    }
  }
  throw new Error(`找不到骰面 ${want}`)
}
/** 往後找一週：第一個目錄符合條件的那一場（回傳週與那一件）。 */
function findLot(g: G, pred: (l: NonNullable<ReturnType<typeof catalogOf>>['lots'][number]) => boolean, house = 'h_white') {
  for (let w = 0; w < 120; w++) {
    const c = catalogAt(g, w, house)
    const lot = c.lots.find(pred)
    if (lot) return { w, lot, c }
  }
  throw new Error('找不到符合條件的拍品')
}

// ===================================================================================================================
describe('格式：內容種類與載入時的檢查', () => {
  it('V 級的零件當拍品被擋；V 級的義體設計圖也一樣', () => {
    expect(() => make({ mod: (c) => { c.part!.push(part('pt_5', 'plate', 5, 20000)); c.auction_lot!.push({ id: 'l_v', kind: 'part', part: 'pt_5' }) } })).toThrow(/V 級不上拍/)
    expect(() => make({
      mod: (c) => {
        c.part!.push(part('pc_chip5', 'chip', 5, 20000))
        c.blueprint!.push(bp('bp_v', { kind: 'cyberware', slot: 'arm', invasiveness: 'invasive', sink_cost: 8, grade: 5, require: [{ type: 'chip' }], stock: { chip: 'pc_chip5' } }))
        c.auction_lot!.push({ id: 'l_v', kind: 'cyberware', blueprint: 'bp_v' })
      },
    })).toThrow(/V 級不上拍/)
  })

  it('art、secret、contract 沒寫 market 被擋；kind 要的那一欄沒寫被擋', () => {
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'art', item: 'it_art_a' }) })).toThrow(/market/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'secret', item: 'it_sec' }) })).toThrow(/market/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'contract', contract: {} }) })).toThrow(/market/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'part' }) })).toThrow(/要寫 part/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'cyberware' }) })).toThrow(/要寫 blueprint/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'art', market: 100 }) })).toThrow(/要寫 item/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'contract', market: 100 }) })).toThrow(/要寫 contract/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'secret', market: 100 }) })).toThrow(/item.*effects|effects/)
  })

  it('義體的設計圖要是義體、要有原廠組合；零件的引用查不到被擋；houses 查不到被擋；needs 的條件不認得被擋', () => {
    expect(() => make({ mod: (c) => { c.blueprint!.push(bp('bp_nostock', { kind: 'cyberware', slot: 'arm', invasiveness: 'light', sink_cost: 1, require: [{ type: 'chip' }] })); c.auction_lot!.push({ id: 'bad', kind: 'cyberware', blueprint: 'bp_nostock' }) } })).toThrow(/stock/)
    expect(() => make({ mod: (c) => { c.blueprint!.push(bp('bp_gun', { kind: 'armor', armor: 1, covers: ['upper'], weight_class: 'light', stock: { chip: 'pc_chip3' }, require: [{ type: 'chip' }] })); c.auction_lot!.push({ id: 'bad', kind: 'cyberware', blueprint: 'bp_gun' }) } })).toThrow(/不是義體/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'part', part: 'pt_nope' }) })).toThrow(/pt_nope/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'part', part: 'pt_3a', houses: ['h_nope'] }) })).toThrow(/h_nope/)
    expect(() => make({ mod: (c) => c.auction_lot!.push({ id: 'bad', kind: 'part', part: 'pt_3a', needs: [{ kind: 'no_such_condition' }] }) })).toThrow(/no_such_condition/)
  })

  it('拍賣行、競標者、規則表、NPC 的 auction_ref、設施的 auction 各有格式檢查', () => {
    expect(() => make({ mod: (c) => c.auction_house!.push({ ...HOUSES[0]!, id: 'h_bad', weekday: 9 }) })).toThrow(/weekday/)
    expect(() => make({ mod: (c) => c.auction_house!.push({ ...HOUSES[0]!, id: 'h_bad', segment: 'nope' }) })).toThrow(/segment/)
    expect(() => make({ mod: (c) => c.auction_house!.push({ ...HOUSES[0]!, id: 'h_bad', lots: [5, 3] }) })).toThrow(/lots/)
    expect(() => make({ mod: (c) => c.auction_house!.push({ ...HOUSES[1]!, id: 'h_bad', must: ['part'] }) })).toThrow(/must/)
    expect(() => make({ mod: (c) => c.auction_house!.push({ ...HOUSES[0]!, id: 'h_bad', member: { faction: 'f_nope' } }) })).toThrow(/f_nope/)
    expect(() => make({ mod: (c) => c.auction_bidder!.push({ id: 'b_bad', name: 'x', interests: [] }) })).toThrow(/interests/)
    expect(() => make({ mod: (c) => c.auction_rule = [{ id: 'default', grades: [5] }] })).toThrow(/grades/)
    expect(() => make({ mod: (c) => c.npc!.push({ id: 'npc_bad', name: 'x', auction_ref: 'h_white' }) })).toThrow(/auction_ref/)
    expect(() => make({ mod: (c) => c.npc!.push({ id: 'npc_bad', name: 'x', auction_ref: ['h_nope'] }) })).toThrow(/h_nope/)
    expect(() => make({ mod: (c) => c.facility_type!.push({ id: 'fac_bad', name: 'x', auction: { house: 'h_nope' } }) })).toThrow(/h_nope/)
  })

  it('規則表：預設值照規格；資料逐項蓋掉', () => {
    const g = make()
    expect(auctionRules(g.k)).toEqual(DEFAULT_AUCTION_RULES)
    expect(DEFAULT_AUCTION_RULES).toEqual({
      grades: [3, 4], reserve_pct: 0.5, step_pct: 0.1, step_min: 50, budget: [0.8, 1.6], fake: { chance: 0.15, dc: 16, skills: ['cyberware', 'investigate'], minutes: 10 },
      preview: { days_before: 1, from_hour: 8, to_hour: 18 }, ref: { favor: 'small', affinity: 40 }, ban_days: 28,
      // M4-auction-bid 多讀的鍵
      rounds_max: 8, raise_max: 3, interest: { yes: 0.7, no: 0.15, after_raise: 0.1 }, fee_pct: 0.1, min_minutes: 60, cred_dirty: { amount: 2, factions: [] },
    })
    const o = make({ mod: (c) => c.auction_rule = [{ id: 'default', ban_days: 7, fake: { dc: 12 }, preview: { from_hour: 9 }, budget: [1, 1.2], bid_rounds: 8 }] })
    const r = auctionRules(o.k)
    expect(r.ban_days).toBe(7)
    expect(r.fake).toEqual({ chance: 0.15, dc: 12, skills: ['cyberware', 'investigate'], minutes: 10 })
    expect(r.preview).toEqual({ days_before: 1, from_hour: 9, to_hour: 18 })
    expect(r.budget).toEqual([1, 1.2])
    expect(r.grades).toEqual([3, 4])
  })
})

// ===================================================================================================================
describe('housesHere：腳下的設施是哪一家', () => {
  it('在拍賣行的設施上是那一家；在別的設施、不在設施上是空的', () => {
    const g = make()
    expect(housesHere(g.k, g.state).map((h) => h.id)).toEqual(['h_white'])
    g.state.location = { ...PARK_AT }
    expect(housesHere(g.k, g.state).map((h) => h.id)).toEqual(['h_park'])
    g.state.location = { ...SHOP_AT }
    expect(housesHere(g.k, g.state)).toEqual([])
    g.state.location = { district: 'd_hive', block: 'b_shops' }
    expect(housesHere(g.k, g.state)).toEqual([])
  })
})

// ===================================================================================================================
describe('sessionOf：場次', () => {
  it('週三問：開槌日是這個週五、目錄週四 08:00 公布、預展週四 08:00～18:00、開槌是晚上那一段', () => {
    const g = make()
    const s = sessionOf(g.k, g.state, 'h_white')!
    expect(s.day).toBe(11)
    expect(s.catalog_at).toBe(toMinutes({ day: 10, hour: 8, minute: 0 }))
    expect(s.preview).toEqual({ from: toMinutes({ day: 10, hour: 8, minute: 0 }), to: toMinutes({ day: 10, hour: 18, minute: 0 }) })
    expect(s.start).toBe(toMinutes({ day: 11, hour: 19, minute: 0 }))
    expect(s.end).toBe(toMinutes({ day: 11, hour: 23, minute: 0 }))
  })

  it('開槌的時段裡問還是這一場；週五 23:30 問是下週五；去過（done）了也是下週五', () => {
    const g = make()
    setTime(g, 11, 20, 0)
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBe(11)
    setTime(g, 11, 22, 59)
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBe(11)
    setTime(g, 11, 23, 30)
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBe(18)
    setTime(g, 11, 12, 0)
    g.commit(sys([{ op: 'auction.patch', done: { h_white: 11 } }]))
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBe(18)
    expect(sessionOf(g.k, g.state, 'h_park')!.day).toBe(16)
  })

  it('開槌日當天早上問：預展的那一天是昨天，已經過了', () => {
    const g = make()
    setTime(g, 11, 8, 0)
    const s = sessionOf(g.k, g.state, 'h_white')!
    expect(s.day).toBe(11)
    expect(now(g)).toBeGreaterThan(s.preview.to)
  })

  it('深夜那一段跨過午夜：午夜之後、清晨 3 點之前還是前一天開的那一場', () => {
    const g = make({ mod: (c) => { c.auction_house![0]!.segment = 'late' } })
    setTime(g, 11, 23, 30)
    const s = sessionOf(g.k, g.state, 'h_white')!
    expect(s.day).toBe(11)
    expect(s.start).toBe(toMinutes({ day: 11, hour: 23, minute: 0 }))
    expect(s.end).toBe(toMinutes({ day: 12, hour: 3, minute: 0 }))
    setTime(g, 12, 1, 0)
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBe(11)
    setTime(g, 12, 3, 0)
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBe(18)
  })

  it('預展的日子與時間照規則表；沒有這家拍賣行是 null', () => {
    const g = make({ mod: (c) => c.auction_rule = [{ id: 'default', preview: { days_before: 2, from_hour: 10, to_hour: 12 } }] })
    const s = sessionOf(g.k, g.state, 'h_white')!
    expect(s.catalog_at).toBe(toMinutes({ day: 9, hour: 10, minute: 0 }))
    expect(s.preview.to).toBe(toMinutes({ day: 9, hour: 12, minute: 0 }))
    expect(sessionOf(g.k, g.state, 'h_nope')).toBeNull()
  })
})

// ===================================================================================================================
describe('catalogOf：目錄與競標者', () => {
  it('同一場問兩次逐欄相同；不管什麼時候問（週三、週四、週五）也一樣；不動存檔亂數的游標', () => {
    const g = make()
    const cursor = g.state.rng.cursor
    const a = catalogAt(g, 0)
    const b = catalogAt(g, 0)
    expect(b).toEqual(a)
    setTime(g, 10, 9)
    expect(catalogOf(g.k, g.state, 'h_white')).toEqual(a)
    setTime(g, 11, 20)
    expect(catalogOf(g.k, g.state, 'h_white')).toEqual(a)
    g.state.rng.cursor += 50
    expect(catalogOf(g.k, g.state, 'h_white')).toEqual(a)
    g.state.rng.cursor = cursor
    expect(g.state.rng.cursor).toBe(cursor)
  })

  it('不同場不同（不是每一場都長一樣）；不同的拍賣行不同', () => {
    const g = make()
    const sigs = new Set(Array.from({ length: 8 }, (_, w) => JSON.stringify(catalogAt(g, w).lots.map((l) => l.id))))
    expect(sigs.size).toBeGreaterThan(1)
    const bidders = new Set(Array.from({ length: 8 }, (_, w) => JSON.stringify(catalogAt(g, w).bidders.map((x) => [x.id, x.mult]))))
    expect(bidders.size).toBeGreaterThan(1)
  })

  it('件數在 4～6；至少一件零件或義體（把零件與義體的 weight 調到很低也成立）；拍品不重複', () => {
    const low = make({ mod: (c) => { for (const l of c.auction_lot!) if (l.kind === 'part' || l.kind === 'cyberware') l.weight = 0.0001 } })
    for (let w = 0; w < 80; w++) {
      const c = catalogAt(low, w)
      expect(c.lots.length).toBeGreaterThanOrEqual(4)
      expect(c.lots.length).toBeLessThanOrEqual(6)
      expect(c.lots.some((l) => l.kind === 'part' || l.kind === 'cyberware'), `第 ${w} 週`).toBe(true)
      expect(new Set(c.lots.map((l) => l.id)).size).toBe(c.lots.length)
    }
    // 沒有調低的時候也成立，而且 must 的換掉不是每一場都發生
    const g = make()
    for (let w = 0; w < 80; w++) expect(catalogAt(g, w).lots.some((l) => l.kind === 'part' || l.kind === 'cyberware')).toBe(true)
  })

  it('底價是市價的一半（四捨五入到十位）、一階是底價的一成而且至少 50（也是十位）；市價：零件是目錄價、義體是 productPrice、其餘是資料的', () => {
    const g = make()
    const seen = new Set<string>()
    for (let w = 0; w < 40; w++) {
      for (const l of catalogAt(g, w).lots) {
        seen.add(l.kind)
        expect(l.reserve).toBe(Math.round((l.market * 0.5) / 10) * 10)
        expect(l.step).toBe(Math.round(Math.max(l.reserve * 0.1, 50) / 10) * 10)
        expect(l.step).toBeGreaterThanOrEqual(50)
        expect(l.step % 10).toBe(0)
        if (l.kind === 'part') expect(l.market).toBe(PARTS.find((p) => p.id === l.part)!.price)
        if (l.kind === 'cyberware') expect(l.market).toBe(productPrice(g.k.content, l.blueprint!))
        if (l.kind === 'art' || l.kind === 'secret' || l.kind === 'contract') expect(l.market).toBe(LOTS.find((x) => x.id === l.id)!.market)
      }
    }
    expect([...seen].sort()).toEqual(['art', 'cyberware', 'part', 'secret'].concat(g.k.effects.has('contract_hold') ? ['contract'] : []).sort())
    expect(productPrice(g.k.content, 'bp_c1')).toBe(3000)
  })

  it('一階最少 50：市價很低的拍品底價與一階照規則', () => {
    const g = make({ mod: (c) => c.auction_lot!.push({ id: 'l_cheap', kind: 'art', item: 'it_art_a', market: 200 }) })
    const { lot } = findLot(g, (l) => l.id === 'l_cheap')
    expect(lot.reserve).toBe(100)
    expect(lot.step).toBe(50)
  })

  it('競標者 3～6 位；資料的不夠補「N 號牌」；倍率在 0.8～1.6、小數兩位；同一場同一位的倍率不變', () => {
    const g = make()
    let paddles = 0
    let named = 0
    for (let w = 0; w < 60; w++) {
      const c = catalogAt(g, w)
      expect(c.bidders.length).toBeGreaterThanOrEqual(3)
      expect(c.bidders.length).toBeLessThanOrEqual(6)
      expect(new Set(c.bidders.map((b) => b.id)).size).toBe(c.bidders.length)
      for (const b of c.bidders) {
        expect(b.mult).toBeGreaterThanOrEqual(0.8)
        expect(b.mult).toBeLessThanOrEqual(1.6)
        expect(Math.round(b.mult * 100) / 100).toBe(b.mult)
        expect(b.interests.length).toBeGreaterThanOrEqual(1)
        if (b.id.startsWith('paddle_')) {
          paddles++
          expect(b.name).toMatch(/^\d+ 號牌$/)
          expect(b.interests.length).toBeLessThanOrEqual(3)
          expect(new Set(b.interests).size).toBe(b.interests.length)
        } else named++
      }
      expect(c.bidders.find((b) => b.id === 'b_npc' || b.npc !== undefined)?.npc ?? 'npc_bid').toBe('npc_bid')
    }
    expect(paddles).toBeGreaterThan(0)
    expect(named).toBeGreaterThan(0)
  })

  it('沒裝會註冊 contract_hold 的功能時目錄裡沒有契約；有就有；第二家只出契約', () => {
    const without = make({ hold: false })
    for (let w = 0; w < 60; w++) expect(catalogAt(without, w).lots.some((l) => l.kind === 'contract')).toBe(false)
    // 契約都不進目錄，第二家（只賣契約）沒有東西可上
    expect(catalogAt(without, 0, 'h_park').lots).toEqual([])
    const withHold = make()
    expect(findLot(withHold, (l) => l.kind === 'contract').lot.kind).toBe('contract')
    for (let w = 0; w < 30; w++) {
      const c = catalogAt(withHold, w, 'h_park')
      expect(c.lots.length).toBeGreaterThanOrEqual(1)
      expect(c.lots.every((l) => l.kind === 'contract')).toBe(true)
      expect(c.lots.length).toBeLessThanOrEqual(3)
    }
  })

  it('houses 只在寫的那幾家出現', () => {
    const g = make()
    for (let w = 0; w < 80; w++) expect(catalogAt(g, w).lots.some((l) => l.id === 'l_con_b')).toBe(false)
    expect(findLot(g, (l) => l.id === 'l_con_b', 'h_park').lot.id).toBe('l_con_b')
  })

  it('once 的那一件記進 sold 之後不再出現', () => {
    const g = make()
    const { w } = findLot(g, (l) => l.id === 'l_con_a')
    expect(findLot(g, (l) => l.id === 'l_con_a').lot.once).toBe(true)
    g.commit(sys([{ op: 'auction.patch', sold: ['l_con_a'] }]))
    expect(auctionOf(g.state).sold).toEqual(['l_con_a'])
    for (let x = 0; x < 120; x++) expect(catalogAt(g, x).lots.some((l) => l.id === 'l_con_a'), `第 ${x} 週（原本第 ${w} 週有）`).toBe(false)
    // 不是 once 的，賣掉了也還會再出現
    g.commit(sys([{ op: 'auction.patch', sold: ['l_p3a'] }]))
    expect(findLot(g, (l) => l.id === 'l_p3a').lot.id).toBe('l_p3a')
  })

  it('拍品的 tags 被內容篩選關掉時不出現', () => {
    const g = make()
    expect(findLot(g, (l) => l.id === 'l_art_b').lot.tags).toEqual(['fx_tag'])
    g.state.rules = { ...g.state.rules, contentOff: ['fx_tag'] }
    for (let w = 0; w < 120; w++) expect(catalogAt(g, w).lots.some((l) => l.id === 'l_art_b')).toBe(false)
    g.state.rules = { ...g.state.rules, contentOff: [] }
    expect(findLot(g, (l) => l.id === 'l_art_b').lot.id).toBe('l_art_b')
  })

  it('needs：條件不成立的不抽', () => {
    const g = make({ mod: (c) => c.auction_lot!.push({ id: 'l_need', kind: 'art', item: 'it_art_a', market: 4000, needs: [{ kind: 'flag', key: 'vip' }] }) })
    for (let w = 0; w < 80; w++) expect(catalogAt(g, w).lots.some((l) => l.id === 'l_need')).toBe(false)
    g.state.flags.vip = true
    expect(findLot(g, (l) => l.id === 'l_need').lot.id).toBe('l_need')
  })

  it('仿品：只有零件與義體會是，大約 15%；其餘一律不是', () => {
    const g = make()
    let fake = 0
    let fakeable = 0
    for (let w = 0; w < 200; w++) {
      for (const l of catalogAt(g, w).lots) {
        if (l.kind === 'part' || l.kind === 'cyberware') { fakeable++; if (l.fake) fake++ } else expect(l.fake).toBe(false)
      }
    }
    expect(fake / fakeable).toBeGreaterThan(0.08)
    expect(fake / fakeable).toBeLessThan(0.25)
    const none = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 0 } }] })
    for (let w = 0; w < 30; w++) expect(catalogAt(none, w).lots.every((l) => !l.fake)).toBe(true)
    const all = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 1 } }] })
    for (let w = 0; w < 30; w++) for (const l of catalogAt(all, w).lots) expect(l.fake).toBe(l.kind === 'part' || l.kind === 'cyberware')
  })

  it('池子太小：有幾件給幾件；池子是空的是 0 件，不丟錯', () => {
    const two = make({ mod: (c) => { c.auction_lot = c.auction_lot!.filter((l) => l.id === 'l_p3a' || l.id === 'l_art_a') } })
    for (let w = 0; w < 10; w++) expect(catalogAt(two, w).lots.map((l) => l.id).sort()).toEqual(['l_art_a', 'l_p3a'])
    const none = make({ mod: (c) => { c.auction_lot = [] } })
    expect(catalogAt(none, 0).lots).toEqual([])
    expect(catalogAt(none, 0).bidders.length).toBeGreaterThanOrEqual(3)
    // 池裡一件零件與義體都沒有：must 的換不了，維持
    const noMust = make({ mod: (c) => { c.auction_lot = c.auction_lot!.filter((l) => l.kind === 'art') } })
    expect(catalogAt(noMust, 0).lots.map((l) => l.kind)).toEqual(expect.arrayContaining(['art']))
    expect(catalogAt(noMust, 0).lots.every((l) => l.kind === 'art')).toBe(true)
  })

  it('性質：隨機的場次，件數、must、底價、一階、競標者的人數與倍率都成立；同一場問兩次相同', () => {
    const g = make()
    fc.assert(fc.property(fc.integer({ min: 0, max: 400 }), fc.constantFrom('h_white', 'h_park'), (w, house) => {
      const c = catalogAt(g, w, house)
      const h = HOUSES.find((x) => x.id === house)!
      expect(c.lots.length).toBeLessThanOrEqual(h.lots[1])
      const pool = house === 'h_white' ? 11 : 2
      expect(c.lots.length).toBeGreaterThanOrEqual(Math.min(h.lots[0], pool))
      for (const l of c.lots) {
        expect(h.kinds).toContain(l.kind)
        expect(l.reserve).toBe(Math.round((l.market * 0.5) / 10) * 10)
        expect(l.step).toBeGreaterThanOrEqual(50)
      }
      if (h.must) expect(c.lots.some((l) => h.must.includes(l.kind))).toBe(true)
      expect(c.bidders.length).toBeGreaterThanOrEqual(h.bidders[0])
      expect(c.bidders.length).toBeLessThanOrEqual(h.bidders[1])
      for (const b of c.bidders) expect(b.mult >= 0.8 && b.mult <= 1.6).toBe(true)
      expect(catalogOf(g.k, g.state, house)).toEqual(c)
    }), { numRuns: 150 })
  })
})

// ===================================================================================================================
describe('catalogView：給畫面的目錄', () => {
  it('週三是 open: false 並帶公布的時間；週四 07:59 還沒有；週四 08:00 列得出來', () => {
    const g = make()
    expect(catalogView(g.k, g.state, 'h_white')).toMatchObject({ open: false, at: toMinutes({ day: 10, hour: 8, minute: 0 }), house: 'h_white', name: '白槌' })
    setTime(g, 10, 7, 59)
    expect(catalogView(g.k, g.state, 'h_white')!.open).toBe(false)
    setTime(g, 10, 8, 0)
    const v = catalogView(g.k, g.state, 'h_white')!
    expect(v.open).toBe(true)
    if (!v.open) return
    expect(v.day).toBe(11)
    expect(v.lots.length).toBeGreaterThanOrEqual(4)
    expect(catalogView(g.k, g.state, 'h_nope')).toBeNull()
  })

  it('任何一欄都沒有仿品與預算；名字資料沒寫就用零件、設計圖、物品的名字；鑑定書沒寫是預設的一句', () => {
    const g = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 1 } }] })
    const seen = new Map<string, Rec>()
    for (let w = 0; w < 40; w++) {
      setTime(g, wed(w) + 1, 9)
      const v = catalogView(g.k, g.state, 'h_white')!
      if (!v.open) throw new Error('應該已經公布')
      const json = JSON.stringify(v)
      expect(json).not.toContain('fake')
      expect(json).not.toContain('mult')
      expect(json).not.toContain('budget')
      expect(json).not.toContain('market')
      for (const l of v.lots) seen.set(l.name, l)
      expect(v.bidders.count).toBe(v.bidders.names.length)
    }
    expect(seen.get('零件pt_3a')!.cert).toBe('附鑑定書，來路乾淨。')
    expect(seen.get('舊貨架上的電源')!.cert).toBe('鑑定師簽了名。')
    expect(seen.get('義眼')!.kind).toBe('cyberware')
    expect(seen.get('義眼')!.kind_name).toBe('義體')
    expect(seen.get('玻璃岸的畫')!.kind_name).toBe('藝術品')
    expect(seen.get('義臂')!.desc).toBe('一條新的義臂。')
  })

  it('看過貨的結果只有 looked 裡有的才帶；contract_dom 關掉時契約的種類名字是「債權」，種類的 id 不變', () => {
    const g = make()
    const { w, lot } = findLot(g, (l) => l.kind === 'part')
    setTime(g, wed(w) + 1, 9)
    expect((catalogView(g.k, g.state, 'h_white') as Rec).lots.every((l: Rec) => l.looked === undefined)).toBe(true)
    g.commit(sys([{ op: 'auction.patch', looked: { [lot.key]: 'fake' } }]))
    const v = catalogView(g.k, g.state, 'h_white') as Rec
    expect(v.lots.find((l: Rec) => l.index === lot.index).looked).toEqual({ result: 'fake', text: '這一件是仿品，或者有瑕疵。' })
    expect(v.lots.filter((l: Rec) => l.looked !== undefined)).toHaveLength(1)

    const con = findLot(g, (l) => l.kind === 'contract')
    setTime(g, wed(con.w) + 1, 9)
    const on = (catalogView(g.k, g.state, 'h_white') as Rec).lots.find((l: Rec) => l.kind === 'contract')
    expect(on.kind_name).toBe('契約')
    g.state.rules = { ...g.state.rules, contentOff: ['contract_dom'] }
    const off = (catalogView(g.k, g.state, 'h_white') as Rec).lots.find((l: Rec) => l.kind === 'contract')
    expect(off.kind_name).toBe('債權')
    expect(off.index).toBe(on.index)
    expect(off.reserve).toBe(on.reserve)
  })
})

// ===================================================================================================================
describe('會員：好感、推薦、停權', () => {
  it('好感 39 不是並寫差多少、可以找誰寫推薦；40 是（靠好感，不存）；掉下去又不是', () => {
    const g = make()
    setFavor(g, 'f_eden', 39)
    const m = memberOf(g.k, g.state, 'h_white')
    expect(m.member).toBe(false)
    expect(m.reason).toContain('還差 1 點')
    expect(m.reason).toContain('常客甲')
    expect(m.reason).toContain('鑑定師乙')
    setFavor(g, 'f_eden', 40)
    expect(memberOf(g.k, g.state, 'h_white')).toMatchObject({ member: true, via: 'favor', reason: null })
    expect(auctionOf(g.state).member).toEqual({})
    setFavor(g, 'f_eden', 10)
    expect(memberOf(g.k, g.state, 'h_white').member).toBe(false)
    expect(memberOf(g.k, g.state, 'h_white').reason).toContain('還差 30 點')
  })

  it('用小人情換推薦：之後好感 0 也是會員；人情少一個；時間加 10 分鐘；報告 auction.ref', () => {
    const g = make()
    give(g, { kind: 'owed_to_pc', who: 'npc_ref', size: 'small' })
    expect(favorsOf(g.state).owed_to_pc).toHaveLength(1)
    const opt = refOptions(g.k, g.state, 'h_white').find((o) => o.npc === 'npc_ref')!
    expect(opt.pays.map((p) => [p.pay, p.ok])).toEqual([['favor', true], ['affinity', false]])
    const t0 = now(g)
    const [r] = g.commit(refDraft(g.k, g.state, { house: 'h_white', npc: 'npc_ref', pay: 'favor' }))
    expect(r!.action).toBe('auction.ref')
    expect(favorsOf(g.state).owed_to_pc).toHaveLength(0)
    expect(now(g) - t0).toBe(10)
    expect(auctionOf(g.state).member.h_white).toMatchObject({ by: 'npc_ref' })
    setFavor(g, 'f_eden', 0)
    expect(memberOf(g.k, g.state, 'h_white')).toMatchObject({ member: true, via: 'ref' })
  })

  it('人情要是這個人欠的、而且是小的：欠的是中人情、或欠的是別人，都不行', () => {
    const g = make()
    give(g, { kind: 'owed_to_pc', who: 'npc_ref', size: 'mid' })
    give(g, { kind: 'owed_to_pc', who: 'npc_plain', size: 'small' })
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref', pay: 'favor' })).toContain('小人情')
    expect(refOptions(g.k, g.state, 'h_white').find((o) => o.npc === 'npc_ref')!.pays[0]!.ok).toBe(false)
    expect(() => refDraft(g.k, g.state, { house: 'h_white', npc: 'npc_ref', pay: 'favor' })).toThrow(ActionBlocked)
    expect(favorsOf(g.state).owed_to_pc).toHaveLength(2)
  })

  it('親密度 40 的那一位不扣東西；39 不行並寫差多少', () => {
    const g = make()
    give(g, { kind: 'owed_to_pc', who: 'npc_ref2', size: 'small' })
    setAffinity(g, 'npc_ref2', 39)
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref2', pay: 'affinity' })).toContain('40')
    setAffinity(g, 'npc_ref2', 40)
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref2', pay: 'affinity' })).toBeNull()
    g.commit(refDraft(g.k, g.state, { house: 'h_white', npc: 'npc_ref2', pay: 'affinity' }))
    expect(favorsOf(g.state).owed_to_pc).toHaveLength(1)
    expect(memberOf(g.k, g.state, 'h_white')).toMatchObject({ member: true, via: 'ref' })
    expect(auctionOf(g.state).member.h_white!.by).toBe('npc_ref2')
  })

  it('只有資料帶 auction_ref、對得上這一家的人寫得出推薦；已經是會員、停權中各擋一句', () => {
    const g = make()
    give(g, { kind: 'owed_to_pc', who: 'npc_plain', size: 'small' })
    expect(refOptions(g.k, g.state, 'h_white').map((o) => o.npc)).toEqual(['npc_ref', 'npc_ref2'])
    expect(refOptions(g.k, g.state, 'h_park')).toEqual([]) // 第二家不收推薦
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_plain', pay: 'favor' })).toContain('寫不出')
    expect(refBlock(g.k, g.state, { house: 'h_park', npc: 'npc_ref2', pay: 'affinity' })).toContain('不收推薦函')
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref', pay: 'bad' as never })).toContain('換法')
    expect(refBlock(g.k, g.state, {})).toContain('哪一家')
    // 好感夠 → 已經是會員
    setFavor(g, 'f_eden', 40)
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref2', pay: 'affinity' })).toContain('已經是')
    // 停權中
    give(g, { kind: 'auction_ban', house: 'h_white' })
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref2', pay: 'affinity' })).toContain('停權')
  })

  it('沒裝 favors：用人情換推薦不列，親密度那一種照舊', () => {
    const g = make({ favors: false })
    const opt = refOptions(g.k, g.state, 'h_white').find((o) => o.npc === 'npc_ref')!
    expect(opt.pays.map((p) => p.pay)).toEqual(['affinity'])
    expect(refBlock(g.k, g.state, { house: 'h_white', npc: 'npc_ref', pay: 'favor' })).toContain('沒有人情')
    setAffinity(g, 'npc_ref', 40)
    g.commit(refDraft(g.k, g.state, { house: 'h_white', npc: 'npc_ref', pay: 'affinity' }))
    expect(memberOf(g.k, g.state, 'h_white').member).toBe(true)
  })

  it('auction_ban 之後不是並寫到哪一天，過了 28 天又是；停權期間好感夠也不算；靠推薦的資格留著', () => {
    const g = make()
    give(g, { kind: 'auction_ref', house: 'h_white', by: 'npc_ref' })
    setFavor(g, 'f_eden', 80)
    expect(memberOf(g.k, g.state, 'h_white').member).toBe(true)
    setTime(g, 9, 12, 0)
    give(g, { kind: 'auction_ban', house: 'h_white' })
    const m = memberOf(g.k, g.state, 'h_white')
    expect(m.member).toBe(false)
    expect(m.reason).toContain('第 37 天')
    expect(m.banned).toBe(toMinutes({ day: 37, hour: 12, minute: 0 }))
    expect(auctionOf(g.state).member.h_white).toBeDefined()
    setTime(g, 36, 23, 59)
    expect(memberOf(g.k, g.state, 'h_white').member).toBe(false)
    setTime(g, 37, 12, 0)
    expect(memberOf(g.k, g.state, 'h_white').member).toBe(true)
    // 好感掉下去之後，推薦還在
    setFavor(g, 'f_eden', 0)
    expect(memberOf(g.k, g.state, 'h_white')).toMatchObject({ member: true, via: 'ref' })
  })

  it('auction_ban 寫了天數用天數、規則表的 ban_days 蓋得掉預設；已經停著的取比較晚的；別家不受影響', () => {
    const g = make()
    give(g, { kind: 'auction_ban', house: 'h_white', days: 5 })
    expect(auctionOf(g.state).banned.h_white).toBe(now(g) + 5 * 1440)
    give(g, { kind: 'auction_ban', house: 'h_white', days: 2 })
    expect(auctionOf(g.state).banned.h_white).toBe(now(g) + 5 * 1440)
    give(g, { kind: 'auction_ban', house: 'h_white', days: 9 })
    expect(auctionOf(g.state).banned.h_white).toBe(now(g) + 9 * 1440)
    expect(auctionOf(g.state).banned.h_park).toBeUndefined()
    const o = make({ mod: (c) => c.auction_rule = [{ id: 'default', ban_days: 7 }] })
    give(o, { kind: 'auction_ban', house: 'h_white' })
    expect(auctionOf(o.state).banned.h_white).toBe(now(o) + 7 * 1440)
  })

  it('AI 給的 auction_ref、auction_ban 被擋；玩家要的也不行；內建的照收；查不到的拍賣行格式不合', () => {
    const g = make()
    for (const e of [{ kind: 'auction_ref', house: 'h_white' }, { kind: 'auction_ban', house: 'h_white' }]) {
      for (const source of ['ai', 'player'] as const) {
        const r = resolve(g, [e], source)
        expect(r.errors.join(), `${e.kind}/${source}`).toContain('不是 AI 與玩家要的結果可以用的效果')
        expect(r.changes).toEqual([])
      }
    }
    expect(g.k.effects.aiKinds()).not.toContain('auction_ref')
    expect(g.k.effects.aiKinds()).not.toContain('auction_ban')
    expect(resolve(g, [{ kind: 'auction_ref', house: 'h_nope' }]).errors.join()).toContain('拍賣行')
    expect(resolve(g, [{ kind: 'auction_ban', house: 'h_white', days: 0 }]).errors.join()).toContain('days')
    expect(resolve(g, [{ kind: 'auction_ref', house: 'h_white' }]).errors).toEqual([])
  })

  it('條件 auction_member：和 memberOf 同一個答案', () => {
    const g = make()
    const test = (house: string) => g.k.conditions.test({ kind: 'auction_member', house } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test('h_white')).toBe(false)
    setFavor(g, 'f_eden', 40)
    expect(test('h_white')).toBe(true)
    expect(test('h_park')).toBe(false) // 第二家要 60
    setFavor(g, 'f_eden', 60)
    expect(test('h_park')).toBe(true)
    expect(g.k.conditions.validate({ kind: 'auction_member' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'auction_member', house: 'h_white' })).toEqual([])
  })

  it('不認得的拍賣行：不是會員，原因一句', () => {
    const g = make()
    expect(memberOf(g.k, g.state, 'h_nope')).toMatchObject({ member: false })
  })
})

// ===================================================================================================================
describe('預展看貨', () => {
  const thu = (w: number, hour = 10) => ({ day: 10 + 7 * w, hour })
  /** 預展的時候站在拍賣行，找一件目錄上的貨（pred），回傳它的週與那一件。 */
  const setup = (g: G, pred: (l: ReturnType<typeof catalogOf> extends infer C ? (C extends { lots: Array<infer L> } ? L : never) : never) => boolean) => {
    const f = findLot(g, pred)
    setTime(g, thu(f.w).day, 10)
    return f
  }
  const purposeOf = (g: G, key: string, by = g.state.pc!) => `auction.inspect/${key}/${by}`

  it('週四 10:00 在拍賣行可以看零件與義體；其餘（藝術品、機密、契約）被擋；每一件回答原因、基本功、DC 與成功率', () => {
    const g = make()
    const f = setup(g, (l) => l.kind === 'part')
    const opts = inspectOptions(g.k, g.state, 'h_white')
    expect(opts.length).toBe(f.c.lots.length)
    for (const o of opts) {
      if (o.kind === 'part' || o.kind === 'cyberware') {
        expect(o.can, o.name).toBe(true)
        expect(o.blocks).toEqual([])
        expect(o).toMatchObject({ skill: 'cyberware', attr: 'tech', dc: 16 })
        expect(o.success).toBeGreaterThan(0)
        expect(o.success).toBeLessThan(1)
      } else {
        expect(o.can).toBe(false)
        expect(o.blocks.join()).toContain('沒有仿品')
        expect(o.skill).toBeUndefined()
      }
    }
    expect(inspectBlock(g.k, g.state, { house: 'h_white', lot: f.lot.index })).toBeNull()
  })

  it('基本功選等級最高的那一項（一樣高取前面的）；屬性照基本功的資料；成功率隨加值變', () => {
    const g = make({ skills: { cyberware: 3, investigate: 1 } })
    setup(g, (l) => l.kind === 'part')
    const hi = inspectOptions(g.k, g.state, 'h_white').find((o) => o.skill)!
    expect(hi).toMatchObject({ skill: 'cyberware', attr: 'tech', dc: 16 })
    const tie = make({ skills: { cyberware: 2, investigate: 2 } })
    setup(tie, (l) => l.kind === 'part')
    expect(inspectOptions(tie.k, tie.state, 'h_white').find((o) => o.skill)!.skill).toBe('cyberware')
    const none = make({ skills: {} })
    setup(none, (l) => l.kind === 'part')
    expect(inspectOptions(none.k, none.state, 'h_white').find((o) => o.skill)!.skill).toBe('cyberware')
    expect(hi.success!).toBeGreaterThan(inspectOptions(none.k, none.state, 'h_white').find((o) => o.skill)!.success!)
  })

  it('週四 19:00 被擋（預展過了）；週三被擋（預展還沒開）；不在拍賣行被擋；站在別家被擋；沒有主角被擋', () => {
    const g = make()
    const f = setup(g, (l) => l.kind === 'part')
    const ask = () => inspectBlock(g.k, g.state, { house: 'h_white', lot: f.lot.index })
    expect(ask()).toBeNull()
    setTime(g, thu(f.w).day, 19)
    expect(ask()).toContain('預展')
    expect(inspectOptions(g.k, g.state, 'h_white').every((o) => !o.can)).toBe(true)
    setTime(g, thu(f.w).day, 18, 0)
    expect(ask()).toContain('預展')
    setTime(g, thu(f.w).day, 17, 59)
    expect(ask()).toBeNull()
    setTime(g, wed(f.w), 12)
    expect(ask()).toContain('預展')
    expect(inspectOptions(g.k, g.state, 'h_white')).toEqual([]) // 目錄還沒公布，不列
    setTime(g, thu(f.w).day, 10)
    g.state.location = { ...SHOP_AT }
    expect(ask()).toContain('白槌')
    g.state.location = { ...PARK_AT }
    expect(ask()).toContain('白槌')
    g.state.location = { ...HOUSE_AT }
    expect(ask()).toBeNull()
  })

  it('契約那一件被擋；沒有那一件被擋', () => {
    const g = make()
    const f = setup(g, (l) => l.kind === 'contract')
    expect(inspectBlock(g.k, g.state, { house: 'h_white', lot: f.lot.index })).toContain('沒有仿品')
    expect(reasonOf(() => inspectDraft(g.k, g.state, { house: 'h_white', lot: f.lot.index }))).toContain('沒有仿品')
    expect(inspectBlock(g.k, g.state, { house: 'h_white', lot: 99 })).toContain('哪一件')
    expect(inspectBlock(g.k, g.state, { house: 'h_nope', lot: 0 })).toContain('哪一家')
  })

  it('固定骰子：成功時 looked 記真的結果（仿品是 fake、真品是 ok）；失敗是 unknown；時間各加 10 分鐘；不必是會員', () => {
    const g = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 0.5 } }] })
    const fakeOne = setup(g, (l) => l.fake && (l.kind === 'part' || l.kind === 'cyberware'))
    expect(memberOf(g.k, g.state, 'h_white').member).toBe(false)
    const t0 = now(g)
    findNatural(g, purposeOf(g, fakeOne.lot.key), 20)
    const [r] = g.commit(inspectDraft(g.k, g.state, { house: 'h_white', lot: fakeOne.lot.index }))
    expect(r!.action).toBe('auction.inspect')
    expect(r!.outcome.result).toBe('fake')
    expect(r!.narration?.results?.join()).toContain('這一件是仿品，或者有瑕疵。')
    expect(auctionOf(g.state).looked[fakeOne.lot.key]).toBe('fake')
    expect(now(g) - t0).toBe(10)

    const g2 = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 0.5 } }] })
    const realOne = setup(g2, (l) => !l.fake && (l.kind === 'part' || l.kind === 'cyberware'))
    findNatural(g2, purposeOf(g2, realOne.lot.key), 20)
    const [r2] = g2.commit(inspectDraft(g2.k, g2.state, { house: 'h_white', lot: realOne.lot.index }))
    expect(r2!.outcome.result).toBe('ok')
    expect(r2!.narration?.results?.join()).toContain('看起來沒有問題。')
    expect(auctionOf(g2.state).looked[realOne.lot.key]).toBe('ok')
  })

  it('失敗（骰 1）：不論真假都記 unknown，句子是「看不出什麼。」，時間照加', () => {
    for (const wantFake of [true, false]) {
      const g = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 0.5 } }] })
      const t = setup(g, (l) => l.fake === wantFake && (l.kind === 'part' || l.kind === 'cyberware'))
      const t0 = now(g)
      findNatural(g, purposeOf(g, t.lot.key), 1)
      const [r] = g.commit(inspectDraft(g.k, g.state, { house: 'h_white', lot: t.lot.index }))
      expect(r!.outcome.result).toBe('unknown')
      expect(r!.narration?.results?.join()).toContain('看不出什麼。')
      expect(JSON.stringify(r)).not.toContain('"fake"')
      expect(auctionOf(g.state).looked[t.lot.key]).toBe('unknown')
      expect(now(g) - t0).toBe(10)
    }
  })

  it('同一件第二次被擋（成功、失敗都一樣）；別的件照樣可以看；看過的結果出現在目錄上', () => {
    const g = make({ mod: (c) => c.auction_rule = [{ id: 'default', fake: { chance: 0.5 } }] })
    const f = setup(g, (l) => l.kind === 'part')
    const [a, b] = f.c.lots.filter((l) => l.kind === 'part' || l.kind === 'cyberware')
    expect(b).toBeDefined()
    g.commit(inspectDraft(g.k, g.state, { house: 'h_white', lot: a!.index }))
    expect(inspectBlock(g.k, g.state, { house: 'h_white', lot: a!.index })).toContain('已經看過')
    expect(reasonOf(() => inspectDraft(g.k, g.state, { house: 'h_white', lot: a!.index }))).toContain('已經看過')
    const opts = inspectOptions(g.k, g.state, 'h_white')
    expect(opts.find((o) => o.index === a!.index)!.can).toBe(false)
    expect(opts.find((o) => o.index === b!.index)!.can).toBe(true)
    g.commit(inspectDraft(g.k, g.state, { house: 'h_white', lot: b!.index }))
    const v = catalogView(g.k, g.state, 'h_white') as Rec
    expect(v.lots.filter((l: Rec) => l.looked !== undefined).map((l: Rec) => l.index).sort()).toEqual([a!.index, b!.index].sort())
    // 下一場是新的一場：同一個位置的貨還可以看
    expect(Object.keys(auctionOf(g.state).looked).every((key) => key.startsWith(`h_white:${f.c.session.day}:`))).toBe(true)
  })

  it('by：隊上的人可以代看（用他的基本功與屬性）；不在隊上的人被擋；同一把骰子重擲結果不變', () => {
    const g = make()
    const f = setup(g, (l) => l.kind === 'part')
    const pc = g.state.actors[g.state.pc!]!
    g.state.actors.ally = { ...structuredClone(pc), id: 'ally', name: '同伴', skills: { cyberware: 4 } } as never
    g.state.actors.stranger = { ...structuredClone(pc), id: 'stranger', name: '路人', skills: {} } as never
    g.state.party.push('ally')
    const opts = inspectOptions(g.k, g.state, 'h_white', 'ally')
    expect(opts.find((o) => o.skill)!.skill).toBe('cyberware')
    expect(inspectBlock(g.k, g.state, { house: 'h_white', lot: f.lot.index, by: 'stranger' })).toContain('主角或隊上')
    expect(inspectOptions(g.k, g.state, 'h_white', 'stranger').find((o) => o.skill)).toBeUndefined()
    const draft = inspectDraft(g.k, g.state, { house: 'h_white', lot: f.lot.index, by: 'ally' })
    expect(draft.actor).toBe('ally')
    expect(inspectDraft(g.k, g.state, { house: 'h_white', lot: f.lot.index, by: 'ally' }).outcome).toEqual(draft.outcome)
    g.commit(draft)
    expect(auctionOf(g.state).looked[f.lot.key]).toBeDefined()
  })
})

// ===================================================================================================================
describe('auction.patch：改狀態的唯一一條路', () => {
  it('member、banned、looked、sold、done、run 各自合併；null 刪掉；同一份報告裡好幾筆不會互相蓋掉', () => {
    const g = make()
    g.commit(sys([
      { op: 'auction.patch', member: { h_white: { at: 5, by: 'npc_ref' } } },
      { op: 'auction.patch', member: { h_park: { at: 6 } }, banned: { h_white: 99999 }, looked: { 'h_white:11:0': 'ok' }, sold: ['a', 'b'], done: { h_white: 4 }, run: { x: 1 } },
      { op: 'auction.patch', sold: ['b', 'c'], looked: { 'h_white:11:1': 'fake' } },
    ]))
    expect(auctionOf(g.state)).toEqual({
      member: { h_white: { at: 5, by: 'npc_ref' }, h_park: { at: 6 } }, banned: { h_white: 99999 }, looked: { 'h_white:11:0': 'ok', 'h_white:11:1': 'fake' },
      sold: ['a', 'b', 'c'], done: { h_white: 4 }, run: { x: 1 },
    })
    g.commit(sys([{ op: 'auction.patch', member: { h_park: null }, banned: { h_white: null }, run: null }]))
    const a = auctionOf(g.state)
    expect(a.member).toEqual({ h_white: { at: 5, by: 'npc_ref' } })
    expect(a.banned).toEqual({})
    expect(a.run).toBeUndefined()
  })

  it('格式不合的整筆被擋；壞掉的狀態讀出來是整理過的空狀態', () => {
    const g = make()
    expect(() => g.commit(sys([{ op: 'auction.patch', looked: { k: 'maybe' } } as never]))).toThrow()
    expect(() => g.commit(sys([{ op: 'auction.patch', member: { h: { by: 'x' } } } as never]))).toThrow()
    expect(() => g.commit(sys([{ op: 'auction.patch', sold: [1] } as never]))).toThrow()
    g.state.ext.auction = { member: 'oops', sold: [1, 'ok'], looked: { a: 'bad', b: 'ok' } }
    expect(auctionOf(g.state)).toEqual({ member: {}, banned: {}, looked: { b: 'ok' }, sold: ['ok'], done: {} })
  })
})
