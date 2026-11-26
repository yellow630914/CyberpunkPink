// 驗收測試：M4 收尾修正批・拍賣（dev/work/M4-fix-engine.md；dev/reviews/2026-11-26-M4.md 必修 2；使用者 2026-11-26 裁決 5、9）。
//   交不出去    標到的契約（與機密的效果）交不出去：不收錢，改由出價第二高的 NPC 得標（沒有就流標），結果「這一件撤拍」；目錄抽籤先排除；ready 時驗拍品的 contract、effects 格式
//   once        once 的拍品被 NPC 買走也記進 sold
//   自動跟價    bidDraft 收 { auto: { max } }，一回合一份報告（M4-fix-2 改成可以中途取消：auto_next、auto_off）
//   放行        進行中只放行 auction.bid、auction.leave、auction.close
//   型別與回顧  AuctionOutcome（不用轉型）、auctionSummary
// 契約用真的 contractFeature（不是假效果：審查指出原本的測試換了一個 validate: () => [] 的假貨，所以抓不到「已經持有」與「debt 沒寫」兩種落空）。
// 內容是測試自帶的最小假資料；進場之後直接改狀態裡的 run 來要確切的一場（和 M4-auction-bid 同一個做法）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx } from '../../src'
import {
  auctionFeature, auctionOf, auctionOutcome, auctionRunOf, auctionSummary, auctionView, autoChoice, bidDraft, bidOptions, catalogOf, enterDraft, undeliverable,
} from '../../src/features/auction'
import type { Run } from '../../src/features/auction'
import { auctionRules, leaveDraft } from '../../src/features/auction'
import { characterFeature } from '../../src/features/character'
import { contractFeature, contractOf, heldOf } from '../../src/features/contract'
import { lewdFeature } from '../../src/features/lewd'
import { worldFeature } from '../../src/features/world'
import { makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

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
const PARTS: Rec[] = [{ id: 'pt_3a', name: '零件甲', type: 'sensor', material: 'mech', brand: 'hz', grade: 3, price: 3000, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new' }]
const FACTIONS = [{ id: 'f_eden', name: '伊甸園', short: '伊甸', class: 'corp' }]
const NPCS: Rec[] = [{ id: 'npc_holder', name: '債主' }, { id: 'npc_other', name: '別的債主' }]
const HOUSES: Rec[] = [
  { id: 'h_white', name: '白槌', weekday: 4, segment: 'prime', lots: [3, 3], kinds: ['part', 'contract', 'secret'], must: ['part'], bidders: [3, 3], member: { faction: 'f_eden', favor_min: 40, ref: true } },
]
const LOT_PART = { id: 'l_p', kind: 'part', part: 'pt_3a' }
const LOT_CON = { id: 'l_con', kind: 'contract', contract: { type: 'debt', debt: 5000 }, npc: 'npc_holder', market: 5000, once: true, name: '債主的契約' }
const LOT_CON2 = { id: 'l_con2', kind: 'contract', contract: { type: 'work' }, npc: 'npc_other', market: 3000, name: '另一份契約' }
const LOT_SEC = { id: 'l_sec', kind: 'secret', market: 3000, name: '一則只賣一次的情報', effects: [{ kind: 'contract_hold', npc: 'npc_holder', type: 'work' }] }
const BIDDERS: Rec[] = [{ id: 'b_a', name: '甲', interests: ['contract'] }, { id: 'b_b', name: '乙', interests: ['contract'] }, { id: 'b_c', name: '丙', interests: ['part'] }]

type Pack = Record<string, Rec[]>
const pack = (mod?: (c: Pack) => void): ContentPack => {
  const c: Pack = {
    skill: structuredClone(SKILLS), faction: structuredClone(FACTIONS), npc: structuredClone(NPCS), special_map: [structuredClone(MAP)],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 3, blocks: ['b_shops'], factions: ['f_eden'] }],
    block: [{ id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F2: { type: 'fac_auction', name: '白槌拍賣行' } } }],
    facility_type: [{ id: 'fac_auction', name: '拍賣行', auction: { house: 'h_white' } }],
    part: structuredClone(PARTS), auction_house: structuredClone(HOUSES), auction_lot: [structuredClone(LOT_PART), structuredClone(LOT_CON)], auction_bidder: structuredClone(BIDDERS),
  }
  mod?.(c)
  return { id: 'm4_fix_auction', content: c as unknown as ContentPack['content'] }
}
const CALM = (c: Pack): void => void (c.auction_rule = [{ id: 'default', interest: { yes: 0, no: 0, after_raise: 0 } }])

const METERS: Feature = {
  id: 'test_meters',
  install(k: Kernel) {
    k.meters.define({ kind: 'favor', owner: 'test_meters', name: '好感', min: 0, max: 100, start: 0, keyed: 'faction', cap: { down: 100, up: 100 } })
  },
}

const FRI = 11
const HOUSE_AT = { district: 'd_hive', block: 'b_shops', facility: 'F2' }
const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }

interface Opts { mod?: (c: Pack) => void; npcs?: string[]; features?: Feature[] }
function make(o: Opts = {}) {
  const actors = (o.npcs ?? ['npc_holder', 'npc_other']).map((id) => makeActor({ id, name: id === 'npc_holder' ? '債主' : '別的債主', role: 'npc', gender: 'female', ext: { bridge: { ...BRIDGE } } }))
  const { game } = makeGame({
    features: o.features ?? [worldFeature, characterFeature, lewdFeature, METERS, contractFeature, auctionFeature], content: [pack(o.mod)], seed: 7,
    pc: { hp: 40, attrs: { reflex: 10, charm: 10, tech: 14, intellect: 14 }, skills: { cyberware: 2, investigate: 1 }, ext: { bridge: { ...BRIDGE } } } as never, actors,
    patch: { time: { day: FRI, hour: 19, minute: 10 }, money: { cred: 100000, cash: 100000 } },
  })
  game.state.location = { ...HOUSE_AT }
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: ReportDraft['changes']): ReportDraft => ({ kind: 'system', action: 'test.step', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const run = (g: G): Run => auctionRunOf(g.state)!
const writeRun = (g: G, r: Run): void => void (g.state.ext.auction = { ...(g.state.ext.auction as object), run: structuredClone(r) })
const lotRun = (over: Rec = {}): Rec => ({
  lot: 0, id: 'l_x', key: `h_white:${FRI}:0`, kind: 'part', name: '測試件', cert: '附鑑定書。', market: 2000, reserve: 1000, step: 100, fake: false, once: false,
  price: 1000, holder: null, round: 0, quiet: 0, out: [], pc_out: false, bids: {}, state: 'open', part: 'pt_3a', ...over,
})
const bidder = (id: string, over: Rec = {}): Rec => ({ id, name: `競標者${id}`, interests: ['contract'], mult: 1, ...over })

/** 進場、換成指定的拍品與競標者。 */
function scene(lots: Rec[], bidders: Rec[], o: Opts & { before?: (g: G) => void } = {}): G {
  const g = make({ ...o, mod: (c) => { CALM(c); o.mod?.(c) } })
  g.commit(sys([{ op: 'meter', kind: 'favor', key: 'f_eden', set: 40 }]))
  o.before?.(g)
  g.commit(enterDraft(g.k, g.state, { house: 'h_white', pay: 'cash' }))
  const r = run(g) as unknown as Rec
  r.lots = lots.map((l, i) => lotRun({ ...l, lot: i, key: `h_white:${FRI}:${i}` }))
  r.bidders = bidders
  r.at = 0
  writeRun(g, r as Run)
  return g
}
/** 主角成為他的持約人（真的 contract_hold 效果）。 */
function hold(g: G, npc = 'npc_holder'): void {
  const fx = g.k.effects.resolve([{ kind: 'contract_hold', npc, type: 'work' }], effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(fx.errors).toEqual([])
  expect(fx.changes.length).toBeGreaterThan(0)
  g.commit(sys(fx.changes))
  expect(Object.keys(heldOf(g.state))).toContain(npc)
}
const conLot = (over: Rec = {}): Rec => ({ id: 'l_con', kind: 'contract', name: '債主的契約', npc: 'npc_holder', contract: { type: 'debt', debt: 5000 }, once: true, market: 5000, price: 1000, ...over })
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

// ===================================================================================================================
describe('交不出去：目錄先排除（真的 contract_hold）', () => {
  const lotIds = (g: G): string[] => catalogOf(g.k, g.state, 'h_white')!.lots.map((l) => l.id)

  it('契約的人在場上、還沒持有：抽得到；已經持有他的契約：不抽；那個人還不是場上的角色：不抽', () => {
    const g = make()
    expect(lotIds(g)).toContain('l_con')
    expect(undeliverable(g.k, g.state, LOT_CON as never, '白槌')).toBeNull()
    hold(g)
    expect(lotIds(g)).not.toContain('l_con')
    expect(undeliverable(g.k, g.state, LOT_CON as never, '白槌')).toMatch(/持約人/)
    // 不在場上
    const none = make({ npcs: ['npc_other'] })
    expect(lotIds(none)).not.toContain('l_con')
    expect(undeliverable(none.k, none.state, LOT_CON as never, '白槌')).toMatch(/找不到這個人/)
  })

  it('機密：只有效果、效果落空的不抽；有 item 的就算效果落空也拿得到物品，照抽', () => {
    const g = make({ mod: (c) => { c.auction_lot = [LOT_PART, LOT_SEC, { ...LOT_CON, once: false }] } })
    expect(lotIds(g)).toContain('l_sec')
    hold(g)
    expect(lotIds(g)).not.toContain('l_sec')
    const withItem = { ...LOT_SEC, item: 'it_x' }
    expect(undeliverable(g.k, g.state, withItem as never, '白槌')).toBeNull()
  })
})

// ===================================================================================================================
describe('交不出去：落槌時不收錢、改由第二高的 NPC 得標、沒有就流標', () => {
  /** 場上：玩家以 1300 標到契約（甲 1200、乙 1100 先前出過價）；落槌之前玩家變成已經持有那個人的契約。 */
  function scenario(bids: Record<string, number>, over: Rec = {}): G {
    return scene([conLot({ price: 1300, holder: 'pc', round: 3, quiet: 1, bids: { pc: 1300, ...bids }, ...over })], [bidder('b_a'), bidder('b_b')], { before: (g) => hold(g) })
  }

  it('已經持有那個人的契約：標到了也不收錢（現金與帳戶都不動），這一件撤拍，改由出價第二高的 NPC 得標；結果寫給玩家看', () => {
    const g = scenario({ b_a: 1200, b_b: 1100 })
    const cash0 = g.state.money.cash
    const [r] = g.commit(bidDraft(g.k, g.state, { act: 'wait' }))
    expect(g.state.money.cash).toBe(cash0)
    expect(g.state.money.cred).toBe(100000)
    const o = auctionOutcome(r!)!
    expect(o.hammers).toEqual([expect.objectContaining({ lot: 0, result: 'sold', winner: 'b_a', price: 1200, withdrawn: expect.stringMatching(/持約人/) })])
    const text = r!.timeline.map((b) => b.text).join('')
    expect(text).toContain('這一件撤拍')
    expect(text).toContain('不收你的錢')
    expect(text).toContain('競標者b_a')
    expect(run(g)?.won ?? []).toEqual([])
  })

  it('沒有別的 NPC 出過價：流標（還是不收錢）；once 的拍品沒賣出去，不記進 sold', () => {
    const g = scenario({})
    const cash0 = g.state.money.cash
    const [r] = g.commit(bidDraft(g.k, g.state, { act: 'wait' }))
    expect(g.state.money.cash).toBe(cash0)
    const h = auctionOutcome(r!)!.hammers[0]!
    expect(h).toMatchObject({ result: 'passed', winner: null, withdrawn: expect.any(String) })
    expect(r!.timeline.map((b) => b.text).join('')).toContain('撤拍')
    expect(auctionOf(g.state).sold).toEqual([])
  })

  it('NPC 得標的 once 拍品記進 sold（世界上只有一件）：之後的目錄不再抽它', () => {
    const g = scene([conLot({ price: 1300, holder: 'b_a', round: 3, quiet: 1, bids: { b_a: 1300 } })], [bidder('b_a'), bidder('b_b')])
    g.commit(bidDraft(g.k, g.state, { act: 'fold' }))
    expect(auctionOf(g.state).sold).toEqual(['l_con'])
    // 撤拍而由 NPC 得標的也一樣
    const g2 = scenario({ b_a: 1200 })
    g2.commit(bidDraft(g2.k, g2.state, { act: 'wait' }))
    expect(auctionOf(g2.state).sold).toEqual(['l_con'])
  })

  it('交得出去的照舊：付價錢加佣金、拿到契約（真的 contract_hold：held 有了他）、once 記進 sold', () => {
    const g = scene([conLot({ price: 1300, holder: 'pc', round: 3, quiet: 1, bids: { pc: 1300 } })], [bidder('b_a')])
    const cash0 = g.state.money.cash
    const [r] = g.commit(bidDraft(g.k, g.state, { act: 'wait' }))
    expect(cash0 - g.state.money.cash).toBe(1300 + 130)
    expect(Object.keys(heldOf(g.state))).toContain('npc_holder')
    expect(auctionOutcome(r!)!.hammers[0]!.withdrawn).toBeUndefined()
    expect(auctionOf(g.state).sold).toEqual(['l_con'])
    void contractOf
  })

  it('機密只有效果又落空：同樣撤拍、不收錢', () => {
    const g = scene([{ id: 'l_sec', kind: 'secret', name: '情報', market: 3000, price: 1000, holder: 'pc', round: 3, quiet: 1, bids: { pc: 1000 }, effects: [{ kind: 'contract_hold', npc: 'npc_holder', type: 'work' }], part: undefined }], [bidder('b_a')], { before: (g) => hold(g) })
    const cash0 = g.state.money.cash
    const [r] = g.commit(bidDraft(g.k, g.state, { act: 'wait' }))
    expect(g.state.money.cash).toBe(cash0)
    expect(auctionOutcome(r!)!.hammers[0]!.withdrawn).toBeTruthy()
  })
})

// ===================================================================================================================
describe('載入時驗拍品的 contract、effects 格式', () => {
  it('債務契約沒寫 debt：載入就擋下（真的 contract_hold 會驗不過）', () => {
    expect(() => make({ mod: (c) => { c.auction_lot = [LOT_PART, { ...LOT_CON, contract: { type: 'debt' } }] } })).toThrow(ContentError)
    try {
      make({ mod: (c) => { c.auction_lot = [LOT_PART, { ...LOT_CON, contract: { type: 'debt' } }] } })
    } catch (e) {
      expect((e as ContentError).problems.join('')).toMatch(/auction_lot\/l_con：.*債務契約要寫 debt/)
    }
  })

  it('機密的 effects 有沒有登記的效果種類、格式不合：擋下；寫對的不擋', () => {
    expect(() => make({ mod: (c) => { c.auction_lot = [LOT_PART, { id: 'l_s', kind: 'secret', market: 3000, effects: [{ kind: 'no_such_effect' }] }] } })).toThrow(/auction_lot\/l_s：效果 no_such_effect 沒有人登記/)
    expect(() => make({ mod: (c) => { c.auction_lot = [LOT_PART, { id: 'l_s', kind: 'secret', market: 3000, effects: [{ kind: 'contract_hold', npc: 'npc_holder', type: 'work', extra: 1 }] }] } })).toThrow(/auction_lot\/l_s/)
    expect(() => make({ mod: (c) => { c.auction_lot = [LOT_PART, LOT_CON, LOT_CON2, LOT_SEC] } })).not.toThrow()
  })

  it('沒有人登記 contract_hold 時契約照舊不進目錄、也不算內容的錯', () => {
    const g = make({ features: [worldFeature, METERS, auctionFeature] })
    expect(catalogOf(g.k, g.state, 'h_white')!.lots.map((l) => l.kind)).not.toContain('contract')
  })
})

// ===================================================================================================================
// 自動跟價（LEWD_SYSTEM 6.2 節第 6 點；使用者 2026-11-26「中途隨時可以取消，改回手動」）：一份報告一個回合，和手動一樣；上限記在這一件上（LotRun.auto）。
//   { auto: { max } } 設上限並走這一回合；{ act: 'auto_next' } 照上限再走一回合；{ act: 'auto_off' } 取消；手動的一手、落槌、退出之後上限自動拿掉。
describe('自動跟價（bidDraft 收 { auto: { max } }；一回合一份報告，可以隨時取消）', () => {
  const rules = auctionRules
  /** 設上限、一直 auto_next 到這一件（第 0 件）落槌或玩家退出；回傳每一份報告的 outcome */
  function autoToEnd(g: G, max: number): Array<NonNullable<ReturnType<typeof auctionOutcome>>> {
    const out: Array<NonNullable<ReturnType<typeof auctionOutcome>>> = []
    const [first] = g.commit(bidDraft(g.k, g.state, { auto: { max } }))
    out.push(auctionOutcome(first!)!)
    for (let guard = 0; guard < 50 && run(g).at === 0 && run(g).lots[0]!.auto !== undefined; guard++) {
      const [r] = g.commit(bidDraft(g.k, g.state, { act: 'auto_next' }))
      out.push(auctionOutcome(r!)!)
    }
    return out
  }
  const chase = (): G => scene([{ kind: 'part', price: 1000 }, { kind: 'part', name: '第二件' }], [bidder('a', { mult: 1.2, interests: ['part'] })], { mod: (c) => { c.auction_rule = [{ id: 'default', interest: { yes: 1, no: 1, after_raise: 0 } }] } })

  it('別人加價就跟一階、超過上限就退出這一件：一回合一份報告、一路走到這一件落槌；規則和手動一樣（回合、付錢、佣金）', () => {
    // 競標者 a 每回合加一階直到預算（mult 1.2 × 市價 2000 = 2400）；玩家上限 1700 → 跟到 1700 為止，再下一階 1800 超過就退出
    const g = chase()
    const cash0 = g.state.money.cash
    const outcomes = autoToEnd(g, 1700)
    // 每一份只有一個回合（沒落槌的）；最後一份帶落槌
    expect(outcomes.length).toBeGreaterThan(2)
    expect(outcomes.slice(0, -1).every((o) => o.rounds.length === 1 && o.hammers.length === 0)).toBe(true)
    const hammers = outcomes.flatMap((o) => o.hammers)
    expect(hammers).toHaveLength(1)
    expect(hammers[0]).toMatchObject({ lot: 0, result: 'sold', winner: 'a' })
    expect(g.state.money.cash).toBe(cash0)
    // 玩家加過價的每一手都不超過上限、一次一階
    const pcRaises = outcomes.flatMap((o) => o.rounds).flatMap((x) => x.acts).filter((a) => a.who === 'pc' && a.act === 'raise')
    expect(pcRaises.length).toBeGreaterThan(0)
    expect(Math.max(...pcRaises.map((a) => a.price))).toBeLessThanOrEqual(1700)
    expect(pcRaises.every((a) => a.steps === 1)).toBe(true)
    // 落槌之後上限拿掉；第二件由玩家自己接著喊（自動跟價只管這一件）
    expect(run(g).at).toBe(1)
    expect(run(g).lots[0]!.auto).toBeUndefined()
    expect(run(g).lots[1]!.auto).toBeUndefined()
  })

  it('一回合一份報告：設上限的那一份就走一回合、上限記在這一件上；auctionView.auto 與 bidOptions.auto.current 讀得到', () => {
    const g = chase()
    expect(auctionView(g.k, g.state)!.auto).toBeNull()
    expect(bidOptions(g.k, g.state)!.auto.current).toBeNull()
    const [r] = g.commit(bidDraft(g.k, g.state, { auto: { max: 1700 } }))
    const o = auctionOutcome(r!)!
    expect(o.rounds).toHaveLength(1)
    expect(o.hammers).toHaveLength(0)
    expect(run(g).lots[0]!.auto).toBe(1700)
    expect(auctionView(g.k, g.state)!.auto).toBe(1700)
    expect(bidOptions(g.k, g.state)!.auto).toMatchObject({ can: true, current: 1700 })
    expect(bidOptions(g.k, g.state)!.auto_next.can).toBe(true)
    expect(bidOptions(g.k, g.state)!.auto_off.can).toBe(true)
  })

  it('中途取消（auto_off）：上限拿掉、不走回合、沒有時間；之後自己手動喊；沒設的時候取消與 auto_next 都擋下並說原因', () => {
    const g = chase()
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'auto_off' }))).toContain('沒有設自動跟價')
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'auto_next' }))).toContain('沒有設自動跟價')
    g.commit(bidDraft(g.k, g.state, { auto: { max: 1700 } }))
    g.commit(bidDraft(g.k, g.state, { act: 'auto_next' }))
    const lot0 = run(g).lots[0]!
    const round0 = lot0.round
    const price0 = lot0.price
    const cash0 = g.state.money.cash
    const time0 = structuredClone(g.state.time)
    const [r] = g.commit(bidDraft(g.k, g.state, { act: 'auto_off' }))
    expect(auctionOutcome(r!)!.result).toBe('auto_off')
    expect(auctionOutcome(r!)!.rounds).toEqual([])
    expect(r!.timeline.map((b) => b.text).join('')).toContain('取消了自動跟價')
    expect(run(g).lots[0]!.auto).toBeUndefined()
    expect(run(g).lots[0]!.round).toBe(round0)
    expect(run(g).lots[0]!.price).toBe(price0)
    expect(g.state.money.cash).toBe(cash0)
    expect(g.state.time).toEqual(time0)
    expect(reasonOf(() => bidDraft(g.k, g.state, { act: 'auto_next' }))).toContain('沒有設自動跟價')
    // 改回手動：一樣的規則（不是最高的人時能加價）
    expect(bidOptions(g.k, g.state)!.raise[0]!.can).toBe(true)
    g.commit(bidDraft(g.k, g.state, { act: 'fold' }))
  })

  it('手動的一手（加價、等、退出）接手：上限自動拿掉', () => {
    for (const manual of [{ act: 'raise', steps: 1 }, { act: 'fold' }] as const) {
      const g = chase()
      g.commit(bidDraft(g.k, g.state, { auto: { max: 1700 } }))
      expect(run(g).lots[0]!.auto).toBe(1700)
      g.commit(bidDraft(g.k, g.state, manual))
      expect(run(g).lots[0]?.auto).toBeUndefined()
    }
  })

  it('玩家已經是最高的人時自動等；沒有別人加價就落槌、玩家得標，照付價錢加佣金', () => {
    const g = scene([{ kind: 'part', price: 1000, holder: 'pc', bids: { pc: 1000 } }, { kind: 'part' }], [bidder('a', { interests: ['art'] })])
    const cash0 = g.state.money.cash
    const outcomes = autoToEnd(g, 5000)
    const hammers = outcomes.flatMap((o) => o.hammers)
    expect(hammers[0]).toMatchObject({ result: 'sold', winner: 'pc', price: 1000 })
    expect(outcomes.flatMap((o) => o.rounds).flatMap((x) => x.acts).filter((a) => a.who === 'pc').every((a) => a.act === 'wait')).toBe(true)
    expect(cash0 - g.state.money.cash).toBe(1100)
  })

  it('上限低於再加一階：這一回合就退出（等於 fold，由程式算完這一件）；付不起也退出', () => {
    const g = scene([{ kind: 'part', price: 1000 }, { kind: 'part' }], [bidder('a', { interests: ['art'] })])
    const [r] = g.commit(bidDraft(g.k, g.state, { auto: { max: 1050 } }))
    expect(auctionOutcome(r!)!.hammers[0]).toMatchObject({ result: 'passed' })
    expect(run(g).lots[0]!.pc_out).toBe(true)
    expect(run(g).lots[0]!.auto).toBeUndefined()
    // 付不起
    const poor = scene([{ kind: 'part', price: 1000 }, { kind: 'part' }], [bidder('a', { interests: ['art'] })])
    poor.state.money.cash = 1000
    expect(autoChoice(poor.state, run(poor), rules(poor.k), run(poor).lots[0]!, 99999)).toEqual({ act: 'fold' })
  })

  it('上限要是大於 0 的整數；這一件已經退出的不能再自動跟；bidOptions.auto 列能不能用與最低要給多少', () => {
    const g = scene([{ kind: 'part', price: 1000 }, { kind: 'part' }], [bidder('a', { interests: ['art'] })])
    expect(reasonOf(() => bidDraft(g.k, g.state, { auto: { max: 0 } }))).toContain('大於 0')
    expect(reasonOf(() => bidDraft(g.k, g.state, { auto: { max: 10.5 } }))).toContain('大於 0')
    const o = bidOptions(g.k, g.state)!
    expect(o.auto).toMatchObject({ act: 'auto', can: true, min: 1100, current: null })
    expect(o.auto_next.can).toBe(false)
    expect(o.auto_off.can).toBe(false)
    g.commit(bidDraft(g.k, g.state, { act: 'fold' }))
    const after = bidOptions(g.k, g.state)!
    expect(after.auto.can).toBe(true)
  })

  it('同一個狀態、同一個上限跑兩次逐欄相同；離場時上限也拿掉', () => {
    const g = scene([{ kind: 'part', price: 1000 }, { kind: 'part' }], [bidder('a', { mult: 1.5, interests: ['part'] })], { mod: (c) => { c.auction_rule = [{ id: 'default', interest: { yes: 0.6, no: 0.6, after_raise: 0.1 } }] } })
    expect(bidDraft(g.k, g.state, { auto: { max: 1600 } })).toEqual(bidDraft(g.k, g.state, { auto: { max: 1600 } }))
    g.commit(bidDraft(g.k, g.state, { auto: { max: 1600 } }))
    g.commit(leaveDraft(g.k, g.state))
    expect(auctionRunOf(g.state)).toBeNull()
  })
})

// ===================================================================================================================
describe('進行中的放行與報告的型別', () => {
  it('進行中只放行 auction.bid、auction.leave、auction.close；預展與推薦與再進場擋下', () => {
    const g = scene([{ kind: 'part' }], [bidder('a')])
    for (const a of ['bid', 'leave', 'close']) expect(g.blockOf(`commit:auction.${a}`), a).toBeNull()
    for (const a of ['inspect', 'ref', 'enter']) expect(g.blockOf(`commit:auction.${a}`), a).toMatch(/拍賣還在進行/)
  })

  it('auctionOutcome 讀拍賣報告的 outcome（正式的型別，不用轉型）；別的報告是 null', () => {
    const g = scene([{ kind: 'part' }], [bidder('a')])
    const [r] = g.commit(bidDraft(g.k, g.state, { act: 'fold' }))
    const o = auctionOutcome(r!)!
    expect(o.house).toBe('h_white')
    expect(o.closed).toBe(true)
    expect(Array.isArray(o.rounds)).toBe(true)
    const other = g.commit(sys([]))[0]!
    expect(auctionOutcome(other)).toBeNull()
  })

  it('auctionSummary：整場結束的報告帶回顧（每一件的結果、我的、撤拍、付了多少）；沒結束的是 null', () => {
    const g = scene([
      { kind: 'part', name: '甲件', price: 1000, holder: 'pc', quiet: 1, bids: { pc: 1000 } },
      conLot({ price: 1300 }),
    ], [bidder('b_a')])
    const first = g.commit(bidDraft(g.k, g.state, { act: 'wait' }))
    expect(first.map((r) => auctionSummary(r))).toEqual([null])
    // 第二件：玩家退出，b_a 沒出價 → 流標；整場結束
    const last = g.commit(bidDraft(g.k, g.state, { act: 'fold' }))
    const sum = auctionSummary(last[0]!)!
    expect(sum).toMatchObject({ house: 'h_white', house_name: '白槌', pay: 'cash', left: false, spent: 1100 })
    expect(sum.lots.map((l) => [l.name, l.result, l.mine])).toEqual([['甲件', 'sold', true], ['債主的契約', 'passed', false]])
    expect(sum.won).toEqual([{ lot: 0, name: '甲件', price: 1000, fee: 100 }])
    expect(sum).toMatchObject({ passed: 1, lost: 0, withdrawn: 0 })
    expect(sum.text).toContain('這一場結束了')
  })

  it('離場（auction.leave）也有回顧，left 是 true', () => {
    const g = scene([{ kind: 'part' }, { kind: 'part' }], [bidder('a')])
    const done = g.commit(leaveDraft(g.k, g.state))
    const sum = auctionSummary(done[0]!)!
    expect(sum.left).toBe(true)
    expect(sum.lots).toHaveLength(2)
  })
})
