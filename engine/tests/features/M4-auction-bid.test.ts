// 驗收測試：dev/work/M4-auction-bid.md（cpp-feature）。拍賣行「白槌」的後半：進場、一場拍賣是一個活動、一回合一回合地喊、落槌、付款與佣金、當場取貨、仿品、結束。
// 規格：LEWD_SYSTEM 6.2 節（進場、一場拍賣的時間、競價的回合、成交）、dev/adr/0019 第十八節與 P78～P80、P82、P83。
// 使用者裁決（M4-plan 第 29 題）：玩家是最高的人時只能等；NPC 一次只加一階；流標；仿品 15%；成交加 10% 佣金；一件最多 8 回合。
// 內容一律用測試自帶的最小假資料（沿用 M4-auction 測試的那一套）：一家拍賣行（週五、晚上那一段）、十二件拍品、四位競標者；
// 好感用測試註冊的假量表；contract_hold 與 hostility 用測試註冊的假效果（把收到的參數與次數寫進旗標與計數器）。
// 想要確切的一場時，進場之後直接改狀態裡的 run（拍品、競標者、預算倍率）；走真的目錄的測試（性質測試、整場）不改。
// 時間：第 1 天是週二，所以第 4、11、18…天是週五。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, productPrice, toMinutes } from '../../src'
import {
  auctionOf, auctionRules, auctionView, bidDraft, bidOptions, catalogOf, enterBlocks, enterDraft, leaveDraft, auctionFeature, auctionRunOf, sessionOf,
} from '../../src/features/auction'
import type { BidInput, Run } from '../../src/features/auction'
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
const SKILLS = [{ id: 'cyberware', name: '義體學', attr: 'tech', desc: '義體學。' }, { id: 'investigate', name: '調查', attr: 'intellect', desc: '調查。' }]
const part = (id: string, type: string, grade: number, price: number, over: Rec = {}): Rec => ({
  id, name: `零件${id}`, type, material: 'mech', brand: 'hz', grade, price, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS: Rec[] = [
  part('pt_3a', 'sensor', 3, 3000), part('pt_3b', 'power', 3, 2400), part('pt_ban', 'sensor', 4, 5000, { legal: 'banned' }),
  part('pc_chip3', 'chip', 3, 2500), part('pc_chip4', 'chip', 4, 6000),
]
const bp = (id: string, over: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, brand: 'hz', grade: 3, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...over })
const BLUEPRINTS: Rec[] = [
  bp('bp_c1', { kind: 'cyberware', name: '義眼', slot: 'eye', invasiveness: 'invasive', sink_cost: 5, require: [{ type: 'chip' }], stock: { chip: 'pc_chip3' } }),
  bp('bp_c2', { kind: 'cyberware', name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 4, require: [{ type: 'chip' }], stock: { chip: 'pc_chip4' } }),
]
const item = (id: string, name: string): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 3, size: 1, legal: 'free', price: 100 })
const ITEMS: Rec[] = [item('it_art_a', '玻璃岸的畫'), item('it_art_b', '會呼吸的雕塑'), item('it_sec', '一捲帶子')]
const FACTIONS = [{ id: 'f_eden', name: '伊甸園', short: '伊甸', class: 'corp' }, { id: 'f_cops', name: '巡警', short: '巡警', class: 'public' }]
const NPCS: Rec[] = [{ id: 'npc_holder', name: '債主' }]
const QUIRKS: Rec[] = [{ id: 'q_flaw', name: '接觸不良', desc: '偶爾斷訊。', kind: 'flaw', pool: ['flaw'] }]

const HOUSES: Rec[] = [
  { id: 'h_white', name: '白槌', weekday: 4, segment: 'prime', lots: [4, 6], kinds: ['part', 'cyberware', 'art', 'secret', 'contract'], must: ['part', 'cyberware'], bidders: [3, 6], member: { faction: 'f_eden', favor_min: 40, ref: true } },
]
const LOTS: Rec[] = [
  { id: 'l_p3a', kind: 'part', part: 'pt_3a' }, { id: 'l_p3b', kind: 'part', part: 'pt_3b' }, { id: 'l_c1', kind: 'cyberware', blueprint: 'bp_c1' }, { id: 'l_c2', kind: 'cyberware', blueprint: 'bp_c2' },
  { id: 'l_art_a', kind: 'art', item: 'it_art_a', market: 4000 }, { id: 'l_art_b', kind: 'art', item: 'it_art_b', market: 6000 },
  { id: 'l_sec_a', kind: 'secret', item: 'it_sec', market: 5000 }, { id: 'l_sec_b', kind: 'secret', market: 3000, name: '一則只賣一次的情報', effects: [{ kind: 'cash', amount: 1 }] },
  { id: 'l_con_a', kind: 'contract', contract: { type: 'debt' }, npc: 'npc_holder', market: 20000, once: true, name: '債主的契約' },
]
const BIDDERS: Rec[] = [
  { id: 'b_a', name: '收藏家', interests: ['art', 'secret'] }, { id: 'b_b', name: '採購員', interests: ['part', 'cyberware'], weight: 2 }, { id: 'b_c', name: '債權人', interests: ['contract'] },
]

type Pack = Record<string, Rec[]>
const pack = (mod?: (c: Pack) => void): ContentPack => {
  const c: Pack = {
    skill: structuredClone(SKILLS), faction: structuredClone(FACTIONS), npc: structuredClone(NPCS), special_map: [structuredClone(MAP)], quirk: structuredClone(QUIRKS),
    district: [{ id: 'd_hive', name: '蜂巢', grade: 3, blocks: ['b_shops'], factions: ['f_eden'] }],
    block: [{ id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '雜貨店' }, F2: { type: 'fac_auction', name: '白槌拍賣行' } } }],
    facility_type: [{ id: 'fac_plain', name: '雜貨店' }, { id: 'fac_auction', name: '拍賣行', auction: { house: 'h_white' } }],
    part: structuredClone(PARTS), blueprint: structuredClone(BLUEPRINTS), item: structuredClone(ITEMS),
    auction_house: structuredClone(HOUSES), auction_lot: structuredClone(LOTS), auction_bidder: structuredClone(BIDDERS),
  }
  mod?.(c)
  return { id: 'm4_auction_bid', content: c as unknown as ContentPack['content'] }
}
/** 規則表 default 蓋掉幾個值。 */
const rules = (over: Rec) => (c: Pack): void => void (c.auction_rule = [{ id: 'default', ...over }])
/** 不亂跳的對手：每個人的機率都是 0（要誰加價自己改）。 */
const CALM = { interest: { yes: 0, no: 0, after_raise: 0 } }

// ---- 測試自己的功能：假量表、假效果 ----

const METERS: Feature = {
  id: 'test_meters',
  install(k: Kernel) {
    k.meters.define({ kind: 'favor', owner: 'test_meters', name: '好感', min: 0, max: 100, start: 0, keyed: 'faction', cap: { down: 100, up: 100 } })
  },
}
/** contract_hold 把整筆參數寫進旗標 held:<npc>；hostility 把量加進計數器 hostile:<勢力>。 */
const EFFECTS: Feature = {
  id: 'test_effects',
  install(k: Kernel) {
    k.effects.register({
      kind: 'contract_hold', owner: 'test_effects', ai: false, validate: () => [],
      toChanges: (e: Rec) => [{ op: 'flag', key: `held:${String(e.npc)}`, value: JSON.stringify(e) }], describe: () => '你成了持約人。',
    })
    k.effects.register({
      kind: 'hostility', owner: 'test_effects', ai: false, validate: () => [],
      toChanges: (e: Rec) => [{ op: 'counter', key: `hostile:${String(e.key)}`, delta: Number(e.amount) }], describe: () => '',
    })
  },
}

// ---- 建局 ----

const PC = { hp: 40, attrs: { reflex: 10, charm: 10, tech: 14, intellect: 14 }, skills: { cyberware: 2, investigate: 1 } }
const HOUSE_AT = { district: 'd_hive', block: 'b_shops', facility: 'F2' }
const SHOP_AT = { district: 'd_hive', block: 'b_shops', facility: 'F1' }
const FEATURES: Feature[] = [worldFeature, METERS, EFFECTS, auctionFeature]
/** 第 11 天是週五。 */
const FRI = 11

interface Opts { seed?: number; mod?: (c: Pack) => void; at?: Rec; cash?: number; cred?: number }
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: FEATURES, content: [pack(o.mod)], seed: o.seed ?? 7, pc: PC as never,
    patch: { time: { day: FRI, hour: 19, minute: 10 }, money: { cred: o.cred ?? 5000, cash: o.cash ?? 3000 } },
  })
  game.state.location = { ...(o.at ?? HOUSE_AT) }
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: ReportDraft['changes']): ReportDraft => ({ kind: 'system', action: 'test.step', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const setFavor = (g: G, n: number): void => void g.commit(sys([{ op: 'meter', kind: 'favor', key: 'f_eden', set: n }]))
const setTime = (g: G, day: number, hour: number, minute = 0): void => void (g.state.time = { day, hour, minute })
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const run = (g: G): Run => auctionRunOf(g.state)!
const writeRun = (g: G, r: Run): void => void (g.state.ext.auction = { ...(g.state.ext.auction as object), run: structuredClone(r) })
const bid = (g: G, input: BidInput) => g.commit(bidDraft(g.k, g.state, input))
const raise = (g: G, steps = 1) => bid(g, { act: 'raise', steps })

/** 好感夠、進場（預設現金）。 */
function enter(g: G, pay: 'cash' | 'cred' = 'cash'): void {
  setFavor(g, 40)
  g.commit(enterDraft(g.k, g.state, { house: 'h_white', pay }))
}

const lotRun = (over: Rec = {}): Rec => ({
  lot: 0, id: 'l_x', key: `h_white:${FRI}:0`, kind: 'part', name: '測試件', cert: '附鑑定書。', market: 2000, reserve: 1000, step: 100, fake: false, once: false,
  price: 1000, holder: null, round: 0, quiet: 0, out: [], pc_out: false, state: 'open', part: 'pt_3a', ...over,
})
const bidder = (id: string, over: Rec = {}): Rec => ({ id, name: `競標者${id}`, interests: ['part'], mult: 1, ...over })
/** 進場之後換成想要的拍品與競標者（lot 的編號與鍵照順序補）。 */
function setup(g: G, lots: Rec[], bidders: Rec[], over: Rec = {}): void {
  const r = run(g) as unknown as Rec
  r.lots = lots.map((l, i) => lotRun({ ...l, lot: i, key: `h_white:${FRI}:${i}` }))
  r.bidders = bidders
  r.at = 0
  Object.assign(r, over)
  writeRun(g, r as Run)
}
/** 一個場景：進場、換成指定的拍品與競標者、現金給夠。 */
function scene(lots: Rec[], bidders: Rec[], o: Opts & { pay?: 'cash' | 'cred' } = {}): G {
  const g = make({ ...o, mod: (c) => { rules(CALM)(c); o.mod?.(c) }, cash: o.cash ?? 100000, cred: o.cred ?? 100000 })
  enter(g, o.pay ?? 'cash')
  setup(g, lots, bidders)
  return g
}
const cash = (g: G): number => g.state.money.cash
const stacks = (g: G, id: string) => g.state.inventory.filter((s) => s.id === id)
const textOf = (r: { timeline: Array<{ text: string }> }): string => r.timeline.map((b) => b.text).join('')

// ===================================================================================================================
describe('進場', () => {
  it('不是會員、不在開槌的時段、不在拍賣行、這一場進過了：各被擋並有原因', () => {
    const g = make()
    // 不是會員
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('伊甸')
    expect(reasonOf(() => enterDraft(g.k, g.state, { house: 'h_white', pay: 'cash' }))).toContain('伊甸')
    setFavor(g, 40)
    expect(enterBlocks(g.k, g.state, 'h_white')).toEqual([])
    // 不在開槌的時段：當天白天還沒開、當晚過了結束、不是週五
    setTime(g, FRI, 12)
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('才開槌')
    setTime(g, FRI, 23, 30)
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('第 18 天')
    setTime(g, FRI + 1, 20)
    expect(enterBlocks(g.k, g.state, 'h_white')).not.toEqual([])
    setTime(g, FRI, 19, 10)
    // 不在拍賣行
    g.state.location = { ...SHOP_AT }
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('要站在白槌裡')
    g.state.location = { ...HOUSE_AT }
    expect(reasonOf(() => enterDraft(g.k, g.state, { house: 'h_white', pay: 'bank' }))).toContain('現金晶片還是帳戶')
    expect(reasonOf(() => enterDraft(g.k, g.state, { house: 'h_nope', pay: 'cash' }))).toContain('指定哪一家')
    // 進過了
    g.commit(enterDraft(g.k, g.state, { house: 'h_white', pay: 'cash' }))
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('你已經在拍賣廳裡')
    g.commit(leaveDraft(g.k, g.state))
    setTime(g, FRI, 22, 59)
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('進過了')
  })

  it('進場：目錄與競標者抄進 run；活動 auction 進行中，別的報告被擋、auction.bid 放行；結果帶寄存與掃描那一句', () => {
    const g = make()
    setFavor(g, 40)
    const c = catalogOf(g.k, g.state, 'h_white')!
    const [r] = g.commit(enterDraft(g.k, g.state, { house: 'h_white', pay: 'cred' }))
    expect(r!.action).toBe('auction.enter')
    expect(r!.outcome.summary).toContain('武器寄存在門口；會場掃了義體，沒有登記。')
    const st = run(g)
    expect(st).toMatchObject({ house: 'h_white', session: FRI, pay: 'cred', at: 0, spent: 0, won: [], log: [] })
    expect(st.lots.map((l) => [l.id, l.price, l.holder, l.state, l.fake])).toEqual(c.lots.map((l) => [l.id, l.reserve, null, 'open', l.fake]))
    expect(st.bidders.map((b) => [b.id, b.mult])).toEqual(c.bidders.map((b) => [b.id, b.mult]))
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('auction')
    expect(g.k.activity.blockOf(g.state, 'commit:world.move')).toBe('拍賣還在進行：先把這一場喊完，或是離場。')
    expect(g.k.activity.blockOf(g.state, 'commit:auction.bid')).toBeNull()
    expect(g.blockOf('commit:world.move')).toContain('拍賣還在進行')
  })
})

// ===================================================================================================================
describe('一回合', () => {
  const LOTS2 = [{ kind: 'part' }]
  it('加 2 階：現價多兩階、玩家是最高；預算不夠的那位退出、有興趣的那位跟了一階；全部記在 outcome', () => {
    const g = scene(LOTS2, [bidder('poor', { mult: 0.5 }), bidder('rich', { mult: 3 }), bidder('cold', { mult: 3, interests: ['art'] })], { mod: rules({ interest: { yes: 1, no: 0, after_raise: 0 } }) })
    const [r] = raise(g, 2)
    expect(r!.action).toBe('auction.bid')
    const lot = run(g).lots[0]!
    // 玩家 1000+200，rich 再加一階
    expect(lot.holder).toBe('rich')
    expect(lot.price).toBe(1300)
    expect(lot.out).toEqual(['poor'])
    expect(lot.round).toBe(1)
    expect(lot.quiet).toBe(0)
    const o = r!.outcome as Rec
    expect(o.rounds[0].acts.map((a: Rec) => [a.who, a.act, a.price])).toEqual([['pc', 'raise', 1200], ['poor', 'out', 1200], ['rich', 'raise', 1300], ['cold', 'pass', 1300]])
    expect(o.rounds[0].price).toBe(1300)
    expect(r!.timeline.map((b) => b.text).join('')).toContain('加了 2 階')
  })

  it('同一個狀態、同一個選擇跑兩次逐欄相同；不動存檔亂數的游標；讀檔重來一樣', () => {
    const g = scene(LOTS2, [bidder('a', { mult: 3 }), bidder('b', { mult: 3 })], { mod: rules({ interest: { yes: 0.5, no: 0.5, after_raise: 0.1 } }) })
    const d1 = bidDraft(g.k, g.state, { act: 'raise', steps: 1 })
    const d2 = bidDraft(g.k, g.state, { act: 'raise', steps: 1 })
    expect(d1).toEqual(d2)
    const cursor = g.state.rng.cursor
    g.commit(d1)
    expect(g.state.rng.cursor).toBe(cursor)
    const again = make({ mod: (c) => rules({ interest: { yes: 0.5, no: 0.5, after_raise: 0.1 } })(c) })
    expect(again.load(g.save())).toBeNull()
    expect(bidDraft(again.k, again.state, { act: 'raise', steps: 1 }).changes).toEqual(bidDraft(g.k, g.state, { act: 'raise', steps: 1 }).changes)
  })

  it('玩家是最高的人時 raise 與 fold 灰掉、wait 可以；不是的時候 wait 灰掉', () => {
    const g = scene(LOTS2, [bidder('a')])
    let o = bidOptions(g.k, g.state)!
    expect(o.wait.can).toBe(false)
    expect(o.wait.blocks.join('')).toContain('不是目前最高')
    expect(o.fold.can).toBe(true)
    expect(o.raise.map((x) => [x.steps, x.can, x.price, x.fee, x.total])).toEqual([[1, true, 1100, 110, 1210], [2, true, 1200, 120, 1320], [3, true, 1300, 130, 1430]])
    raise(g)
    o = bidOptions(g.k, g.state)!
    expect(o.wait.can).toBe(true)
    expect(o.fold.can).toBe(false)
    expect(o.raise.every((x) => !x.can && x.blocks.join('').includes('只能等'))).toBe(true)
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'raise', steps: 1 }))).toContain('只能等')
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'fold' }))).toContain('不能退出')
    expect(() => bidDraft(g.k, g.state, { act: 'wait' })).not.toThrow()
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'raise', steps: 4 }))).toContain('1～3 階')
  })

  it('錢只夠付現價不夠付佣金時加價灰掉：付不起這個價（含一成佣金）。', () => {
    const g = scene(LOTS2, [bidder('a')])
    g.state.money.cash = 1100
    const o = bidOptions(g.k, g.state)!
    expect(o.raise[0]).toMatchObject({ can: false, blocks: ['付不起這個價（含一成佣金）。'] })
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'raise', steps: 1 }))).toBe('付不起這個價（含一成佣金）。')
    g.state.money.cash = 1210
    expect(bidOptions(g.k, g.state)!.raise[0]!.can).toBe(true)
    expect(bidOptions(g.k, g.state)!.raise[1]!.can).toBe(false)
  })

  it('沒有進行中的拍賣：bidOptions 與 auctionView 是 null，bidDraft 被擋', () => {
    const g = make()
    expect(bidOptions(g.k, g.state)).toBeNull()
    expect(auctionView(g.k, g.state)).toBeNull()
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'wait' }))).toContain('不在拍賣廳')
    expect(reasonOf(() => leaveDraft(g.k, g.state))).toContain('不在拍賣廳')
  })
})

// ===================================================================================================================
describe('落槌', () => {
  it('興趣的機率是 0：玩家加一階之後連等兩回合，第二回合結束落槌、玩家得標（倒數一次在中間）', () => {
    const g = scene([{ kind: 'part' }, { kind: 'part', name: '第二件' }], [bidder('a')])
    raise(g)
    expect(run(g).lots[0]).toMatchObject({ holder: 'pc', quiet: 0, state: 'open' })
    const [w1] = bid(g, { act: 'wait' })
    expect((w1!.outcome as Rec).rounds[0]).toMatchObject({ quiet: 1, countdown: true })
    expect(textOf(w1!)).toContain('倒數一次')
    expect(run(g).at).toBe(0)
    expect(auctionView(g.k, g.state)!.countdown).toBe(true)
    const [w2] = bid(g, { act: 'wait' })
    expect((w2!.outcome as Rec).hammers).toEqual([expect.objectContaining({ lot: 0, result: 'sold', winner: 'pc', price: 1100, rounds: 3 })])
    expect(run(g)).toMatchObject({ at: 1, spent: 1210 })
    expect(run(g).won).toEqual([{ lot: 0, price: 1100, fee: 110 }])
    expect(auctionView(g.k, g.state)!.lot_no).toBe(2)
  })

  it('沒有任何人出過價的那一件流標；到了第 8 回合以現價落槌（機率 1、預算很高）', () => {
    const g = scene([{ kind: 'part' }, { kind: 'part' }], [bidder('a', { mult: 1000 }), bidder('b', { mult: 1000 })])
    const [f] = bid(g, { act: 'fold' })
    const o = f!.outcome as Rec
    expect(o.hammers).toEqual([expect.objectContaining({ lot: 0, result: 'passed', winner: null, rounds: 2 })])
    expect(run(g).log[0]).toMatchObject({ lot: 0, winner: null, price: 1000 })
    expect(textOf(f!)).toContain('流標')
    expect(cash(g)).toBe(100000)

    const g2 = scene([{ kind: 'part' }], [bidder('a', { mult: 1000 }), bidder('b', { mult: 1000 })], { mod: rules({ interest: { yes: 1, no: 1, after_raise: 0 } }) })
    for (let i = 0; i < 7; i++) {
      raise(g2)
      expect(run(g2)).toBeTruthy()
    }
    const [last] = bid(g2, { act: 'fold' })
    expect((last!.outcome as Rec).hammers[0]).toMatchObject({ rounds: 8, result: 'sold' })
    expect(auctionOf(g2.state).done.h_white).toBe(FRI)
  })

  it('NPC 在場內時也有結果：一次只加一階，下一階超過預算就退出這一件（得標價不超過預算）', () => {
    const g = scene([{ kind: 'part' }], [bidder('a', { mult: 1.25 })], { mod: rules({ interest: { yes: 1, no: 1, after_raise: 0 } }) })
    // 預算 2000 × 1.25 = 2500，一階 100：玩家每次加 3 階、a 跟一階
    for (const price of [1400, 1800, 2200]) {
      raise(g, 3)
      expect(run(g).lots[0]).toMatchObject({ holder: 'a', price })
    }
    raise(g, 1) // 玩家 2300，a 再加一階 2400（沒超過預算）
    expect(run(g).lots[0]).toMatchObject({ holder: 'a', price: 2400 })
    const [r] = raise(g, 1) // 玩家 2500，a 的下一階 2600 超過預算 → 退出這一件
    expect(run(g).lots[0]).toMatchObject({ holder: 'pc', price: 2500, out: ['a'] })
    expect((r!.outcome as Rec).rounds[0].acts.map((x: Rec) => x.act)).toEqual(['raise', 'out'])
    // 場上沒有別人：等兩回合落槌，玩家得標
    bid(g, { act: 'wait' })
    const [w] = bid(g, { act: 'wait' })
    expect((w!.outcome as Rec).hammers[0]).toMatchObject({ winner: 'pc', price: 2500 })
  })
})

// ===================================================================================================================
describe('退出', () => {
  it('fold：同一份報告裡這一件算到落槌、換到下一件；這一件之後不能再喊', () => {
    const g = scene([{ kind: 'part', name: '一號件' }, { kind: 'part', name: '二號件' }], [bidder('a', { mult: 3 })], { mod: rules({ interest: { yes: 1, no: 1, after_raise: 0 } }) })
    const [r] = bid(g, { act: 'fold' })
    const o = r!.outcome as Rec
    // a 在第 1 回合出價 1100，之後沒有人再加（a 是最高的人不動）：倒數、落槌
    expect(o.rounds.map((x: Rec) => [x.round, x.quiet])).toEqual([[1, 0], [2, 1], [3, 2]])
    expect(o.hammers).toEqual([expect.objectContaining({ lot: 0, winner: 'a', price: 1100 })])
    expect(run(g).lots[0]).toMatchObject({ pc_out: true, state: 'sold' })
    expect(run(g).at).toBe(1)
    expect(cash(g)).toBe(100000)
    expect(auctionView(g.k, g.state)!.lot.name).toBe('二號件')
    expect(textOf(r!)).toContain('主持人：第 2 件')
  })

  it('玩家 fold 之後不能對退出的那一件喊（已退出的拍品在 run 裡 pc_out；下一件照常可以）', () => {
    const g = scene([{ kind: 'part' }, { kind: 'part' }], [bidder('a')])
    bid(g, { act: 'fold' })
    expect(run(g).lots[0]!.pc_out).toBe(true)
    const stale = run(g)
    stale.at = 0
    writeRun(g, stale)
    expect(bidOptions(g.k, g.state)!.raise.every((x) => !x.can && x.blocks.join('').includes('已經退出'))).toBe(true)
    stale.at = 1
    writeRun(g, stale)
    expect(bidOptions(g.k, g.state)!.raise[0]!.can).toBe(true)
  })
})

// ===================================================================================================================
describe('得標', () => {
  it('扣的是現價加一成佣金（四捨五入）；零件進背包、沒有仿品的那一疊沒有資料', () => {
    const g = scene([{ kind: 'part', part: 'pt_3a', reserve: 1005, price: 1005, step: 105 }, { kind: 'part' }], [bidder('a')])
    raise(g)
    bid(g, { act: 'wait' })
    const [r] = bid(g, { act: 'wait' })
    // 價 1110，佣金 111
    expect(cash(g)).toBe(100000 - 1110 - 111)
    expect(stacks(g, 'pt_3a')).toEqual([{ id: 'pt_3a', qty: 1 }])
    expect(r!.outcome.summary).toContain('付了')
    expect(run(g).spent).toBe(1221)
  })

  it('仿品沒看過的零件帶 state: used 與「拿到手才發現」那一句；預展看出來的沒有那一句（東西一樣）', () => {
    const g = scene([{ kind: 'part', fake: true }], [bidder('a')])
    raise(g)
    bid(g, { act: 'wait' })
    const [r] = bid(g, { act: 'wait' })
    expect(stacks(g, 'pt_3a')[0]!.data).toMatchObject({ state: 'used' })
    expect(textOf(r!)).toContain('拿到手才發現這一件是仿品。')
    expect(r!.narration!.results).toContain('拿到手才發現這一件是仿品。')

    const g2 = scene([{ kind: 'part', fake: true }], [bidder('a')])
    g2.state.ext.auction = { ...(g2.state.ext.auction as object), looked: { [`h_white:${FRI}:0`]: 'fake' } }
    raise(g2)
    bid(g2, { act: 'wait' })
    const [r2] = bid(g2, { act: 'wait' })
    expect(stacks(g2, 'pt_3a')[0]!.data).toMatchObject({ state: 'used' })
    expect(textOf(r2!)).not.toContain('拿到手才發現')
  })

  it('義體是一疊帶 parts 的成品；仿品是二手帶瑕疵（quirk），productPrice 比真品低', () => {
    const win = (fake: boolean): G => {
      const g = scene([{ kind: 'cyberware', blueprint: 'bp_c1', part: undefined, fake, market: 4000, reserve: 2000, price: 2000, step: 200 }], [bidder('a')])
      raise(g)
      bid(g, { act: 'wait' })
      bid(g, { act: 'wait' })
      return g
    }
    const real = stacks(win(false), 'bp_c1')
    expect(real).toHaveLength(1)
    expect(real[0]!.data).toMatchObject({ parts: { chip: 'pc_chip3' }, quality: 'standard', state: 'new' })
    expect(real[0]!.data!.uid).toMatch(/^pr\d+$/)
    const gf = win(true)
    const fakeStack = stacks(gf, 'bp_c1')[0]!
    expect(fakeStack.data).toMatchObject({ parts: { chip: 'pc_chip3' }, quality: 'flawed', state: 'used', quirks: ['q_flaw'] })
    expect(productPrice(gf.k.content, 'bp_c1', fakeStack.data)).toBeLessThan(productPrice(gf.k.content, 'bp_c1', real[0]!.data))
    expect(gf.state.seq.uid).toBe(1)
  })

  it('契約那一件叫到 contract_hold、帶 npc 與拍賣行的名字；once 的進了 sold；機密與藝術品給物品、跑效果', () => {
    const g = scene([
      { kind: 'contract', id: 'l_con_a', part: undefined, contract: { type: 'debt' }, npc: 'npc_holder', once: true, name: '債主的契約' },
      { kind: 'art', id: 'l_art_a', part: undefined, item: 'it_art_a' },
      { kind: 'secret', id: 'l_sec_b', part: undefined, item: 'it_sec', effects: [{ kind: 'cash', amount: 77 }] },
    ], [bidder('a')])
    const take = (): void => {
      raise(g)
      bid(g, { act: 'wait' })
      bid(g, { act: 'wait' })
    }
    take()
    const held = JSON.parse(String(g.state.flags['held:npc_holder']))
    expect(held).toMatchObject({ kind: 'contract_hold', type: 'debt', npc: 'npc_holder', origin: '白槌' })
    expect(auctionOf(g.state).sold).toEqual(['l_con_a'])
    take()
    expect(stacks(g, 'it_art_a')).toEqual([{ id: 'it_art_a', qty: 1 }])
    expect(auctionOf(g.state).sold).toEqual(['l_con_a'])
    const before = cash(g)
    take()
    expect(stacks(g, 'it_sec')).toHaveLength(1)
    // 效果的 cash +77 照內建來源跑
    // 機密的效果（cash +77）照內建的來源跑：付 1100 加佣金 110，再加 77
    expect(before - cash(g)).toBe(1100 + 110 - 77)
    expect(auctionRunOf(g.state)).toBeNull()
  })

  it('帳戶付違禁的零件：cred_dirty.factions 是空的時沒有事；設了一個勢力之後敵對值 +2；現金付不加', () => {
    const buy = (pay: 'cash' | 'cred', dirty: Rec | undefined, partId = 'pt_ban'): G => {
      const g = scene([{ kind: 'part', part: partId }], [bidder('a')], { pay, mod: dirty ? rules({ ...CALM, cred_dirty: dirty }) : undefined })
      raise(g)
      bid(g, { act: 'wait' })
      bid(g, { act: 'wait' })
      return g
    }
    expect(buy('cred', undefined).state.counters['hostile:f_eden'] ?? 0).toBe(0)
    expect(buy('cred', { factions: [] }).state.counters['hostile:f_eden'] ?? 0).toBe(0)
    const g = buy('cred', { amount: 2, factions: ['f_eden'] })
    expect(g.state.counters['hostile:f_eden']).toBe(2)
    expect(g.state.money.cred).toBe(100000 - 1100 - 110)
    expect(buy('cash', { amount: 2, factions: ['f_eden'] }).state.counters['hostile:f_eden'] ?? 0).toBe(0)
    // 契約一律算（用帳戶付）
    const c = scene([{ kind: 'contract', contract: { type: 'debt' }, npc: 'npc_holder', market: 2000 }], [bidder('a')], { pay: 'cred', mod: rules({ ...CALM, cred_dirty: { amount: 3, factions: ['f_eden', 'f_cops'] } }) })
    raise(c)
    bid(c, { act: 'wait' })
    bid(c, { act: 'wait' })
    expect([c.state.counters['hostile:f_eden'], c.state.counters['hostile:f_cops']]).toEqual([3, 3])
    // 不違禁的零件用帳戶付也不加
    expect(buy('cred', { amount: 2, factions: ['f_eden'] }, 'pt_3a').state.counters['hostile:f_eden'] ?? 0).toBe(0)
  })

  it('預設規則：佣金一成、一件 8 回合、一次最多 3 階、帳戶紀錄清單預設空的；資料蓋得掉', () => {
    const g = make()
    expect(auctionRules(g.k)).toMatchObject({ rounds_max: 8, raise_max: 3, fee_pct: 0.1, min_minutes: 60, interest: { yes: 0.7, no: 0.15, after_raise: 0.1 }, cred_dirty: { amount: 2, factions: [] }, fake: { chance: 0.15 } })
    const h = make({ mod: rules({ fee_pct: 0.2, raise_max: 2, rounds_max: 3 }) })
    expect(auctionRules(h.k)).toMatchObject({ rounds_max: 3, raise_max: 2, fee_pct: 0.2 })
    expect(bidOptions(h.k, (enter(h), h.state))!.raise).toHaveLength(2)
  })
})

// ===================================================================================================================
describe('結束', () => {
  const finishAll = (g: G): ReturnType<G['commit']> => {
    let last: ReturnType<G['commit']> = []
    for (let i = 0; i < 200 && auctionRunOf(g.state); i++) last = bid(g, { act: 'fold' })
    return last
  }

  it('19:10 進場，auction.close 之後時間是 23:00；done 記了、run 沒了、同一場再進被擋；帶觸發點 auction_done 與 activity.end', () => {
    const g = make()
    enter(g)
    const ends: Rec[] = []
    g.k.hooks.on('activity.end', 'test', (p: Rec) => void (p.kind === 'auction' && ends.push(p)))
    const reports = finishAll(g)
    const last = reports[0]!
    expect(last.action).toBe('auction.close')
    expect(g.state.time).toEqual({ day: FRI, hour: 23, minute: 0 })
    expect(auctionOf(g.state).done).toEqual({ h_white: FRI })
    expect(auctionRunOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
    expect(last.triggers).toEqual([{ point: 'auction_done', where: { house: 'h_white', won: 0 } }])
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ outcome: 'done', origin: { by: 'auction', ref: 'h_white' }, result: { house: 'h_white', won: [], spent: 0 } })
    expect(ends[0]!.result.log.length).toBeGreaterThanOrEqual(4)
    expect(enterBlocks(g.k, g.state, 'h_white')).not.toEqual([])
    expect(sessionOf(g.k, g.state, 'h_white')!.day).toBeGreaterThan(FRI)
    setTime(g, FRI, 22, 59)
    expect(enterBlocks(g.k, g.state, 'h_white').join('')).toContain('進過了')
  })

  it('每一件都立刻退出時至少過 min_minutes（從進場算起）；進得晚的過了時段結束也照這個算', () => {
    const g = make({ mod: rules({ min_minutes: 300 }) })
    setTime(g, FRI, 19, 0)
    enter(g)
    finishAll(g)
    expect(toMinutes(g.state.time)).toBe(toMinutes({ day: FRI, hour: 19 + 5, minute: 0 }))
    const h = make()
    setTime(h, FRI, 22, 30)
    enter(h)
    finishAll(h)
    expect(h.state.time).toEqual({ day: FRI, hour: 23, minute: 30 })
    const i = make()
    setTime(i, FRI, 19, 0)
    enter(i)
    finishAll(i)
    expect(i.state.time).toEqual({ day: FRI, hour: 23, minute: 0 })
  })

  it('leaveDraft 在第二件中途離場：剩下的每一件都有落槌的結果；玩家是最高的人的那一件照算（出價收不回）', () => {
    const g = scene([{ kind: 'part' }, { kind: 'part' }, { kind: 'part' }], [bidder('a', { mult: 3 })], { mod: rules({ interest: { yes: 1, no: 1, after_raise: 0 } }) })
    bid(g, { act: 'fold' })
    expect(run(g).at).toBe(1)
    raise(g)
    // a 跟了一階：玩家不是最高的人，離場
    expect(run(g).lots[1]!.holder).toBe('a')
    const [r] = g.commit(leaveDraft(g.k, g.state))
    expect(r!.action).toBe('auction.leave')
    expect(r!.outcome.result).toBe('left')
    expect((r!.outcome as Rec).hammers.map((h: Rec) => h.lot)).toEqual([1, 2])
    expect(auctionRunOf(g.state)).toBeNull()
    expect(auctionOf(g.state).done.h_white).toBe(FRI)
    expect(r!.triggers![0]).toMatchObject({ point: 'auction_done', where: { won: 0 } })
    expect(cash(g)).toBe(100000)

    // 玩家正是最高的人時離場：這一件算到落槌，沒人加價就是玩家得標、照付
    const h = scene([{ kind: 'part' }, { kind: 'part' }], [bidder('a')])
    raise(h)
    const [lr] = h.commit(leaveDraft(h.k, h.state))
    expect((lr!.outcome as Rec).hammers[0]).toMatchObject({ lot: 0, winner: 'pc', price: 1100 })
    expect((lr!.outcome as Rec).hammers[1]).toMatchObject({ lot: 1, result: 'passed' })
    expect(cash(h)).toBe(100000 - 1210)
  })

  it('六件左右的一場大約幾份報告（只確認有限、不超過每件 8 回合再加進場與收尾）', () => {
    const g = make()
    enter(g)
    const n = run(g).lots.length
    let reports = 0
    while (auctionRunOf(g.state)) {
      const o = bidOptions(g.k, g.state)!
      bid(g, o.raise[0]!.can ? { act: 'raise', steps: 1 } : o.wait.can ? { act: 'wait' } : { act: 'fold' })
      reports++
    }
    expect(reports).toBeLessThanOrEqual(n * 9)
  })
})

// ===================================================================================================================
describe('存檔與回退', () => {
  it('中途存檔再讀，接著喊完的結果和不中斷的逐欄相同', () => {
    const g = make({ seed: 21 })
    enter(g)
    g.state.money.cash = 100000
    const play = (x: G, steps: number): void => {
      for (let i = 0; i < steps && auctionRunOf(x.state); i++) {
        const o = bidOptions(x.k, x.state)!
        bid(x, o.raise[0]!.can && i % 3 !== 2 ? { act: 'raise', steps: 1 } : o.wait.can ? { act: 'wait' } : { act: 'fold' })
      }
    }
    play(g, 5)
    expect(auctionRunOf(g.state)).toBeTruthy()
    const raw = g.save()
    const again = make({ seed: 21 })
    expect(again.load(raw)).toBeNull()
    expect(auctionRunOf(again.state)).toEqual(auctionRunOf(g.state))
    expect(again.k.activity.active(again.state).map((a) => a.kind)).toContain('auction')
    play(g, 500)
    play(again, 500)
    expect(auctionRunOf(g.state)).toBeNull()
    expect(again.state.ext.auction).toEqual(g.state.ext.auction)
    expect(again.state.money).toEqual(g.state.money)
    expect(again.state.inventory).toEqual(g.state.inventory)
    expect(again.state.time).toEqual(g.state.time)
    expect(again.state.flags).toEqual(g.state.flags)
  })

  it('回退：一步一回合；回到喊價前的現價', () => {
    const g = scene([{ kind: 'part' }], [bidder('a')])
    expect(g.undoSteps(1)).toBe(true) // 回到進場之前
    expect(auctionRunOf(g.state)).toBeNull()
    enter(g)
    setup(g, [{ kind: 'part' }], [bidder('a')])
    raise(g, 2)
    expect(run(g).lots[0]!.price).toBe(1200)
    expect(g.undoSteps(1)).toBe(true)
    expect(auctionRunOf(g.state)).toBeTruthy()
    expect(run(g).lots[0]).toMatchObject({ round: 0, holder: null })
  })

  it('壞掉的 run 當作沒有：活動不進行、不丟錯', () => {
    const g = make()
    g.state.ext.auction = { member: {}, banned: {}, looked: {}, sold: [], done: {}, run: { house: 3 } }
    expect(auctionRunOf(g.state)).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
  })
})

// ===================================================================================================================
describe('性質（隨機的種子與隨機的玩家動作）', () => {
  it('每一件的回合數不超過 8；成交價不低於底價加一階；得標的 NPC 的成交價不超過他的預算；玩家付的總數不超過進場時身上的錢', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 20, maxLength: 80 }), fc.integer({ min: 3000, max: 40000 }), (seed, picks, money) => {
        const g = make({ seed, cash: money })
        enter(g)
        const start = run(g)
        const entered = cash(g)
        const budget = (lotNo: number, id: string): number => start.lots[lotNo]!.market * start.bidders.find((b) => b.id === id)!.mult
        let i = 0
        while (auctionRunOf(g.state)) {
          const o = bidOptions(g.k, g.state)!
          const pick = picks[i++ % picks.length]!
          const choices: BidInput[] = []
          for (const r of o.raise) if (r.can) choices.push({ act: 'raise', steps: r.steps! })
          if (o.wait.can) choices.push({ act: 'wait' })
          if (o.fold.can) choices.push({ act: 'fold' })
          const input = pick === 5 && i > 10 ? null : choices[pick % choices.length]!
          const [r] = input ? bid(g, input) : g.commit(leaveDraft(g.k, g.state))
          const out = r!.outcome as Rec
          for (const round of out.rounds as Rec[]) expect(round.round).toBeLessThanOrEqual(8)
          for (const h of out.hammers as Rec[]) {
            expect(h.rounds).toBeLessThanOrEqual(8)
            if (h.winner === null) continue
            const lot = start.lots[h.lot]!
            expect(h.price).toBeGreaterThanOrEqual(lot.reserve + lot.step)
            if (h.winner !== 'pc') expect(h.price).toBeLessThanOrEqual(budget(h.lot, h.winner))
          }
          expect(cash(g)).toBeGreaterThanOrEqual(0)
          if (i > 400) throw new Error('沒有結束')
        }
        expect(entered - cash(g)).toBeLessThanOrEqual(entered)
        const log = auctionOf(g.state).done
        expect(log.h_white).toBe(FRI)
      }),
      { numRuns: 25 },
    )
  })
})
