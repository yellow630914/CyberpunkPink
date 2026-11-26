// L6 auction 的目錄與競標者（LEWD_SYSTEM 6.2 節；dev/adr/0019 P76、P77、P79、P84）。
// catalogOf 是純函式：亂數用 deriveRng，游標固定在 0（鍵是 auction、拍賣行、場次），所以同一場不管什麼時候問、問幾次都一樣，不動存檔亂數的游標。
// （目錄還看三樣會變的東西：拍品的 needs、內容篩選、sold 裡的 once；它們沒變，目錄就逐欄相同。）
// catalogView 是給畫面的讀法：不帶仿品的記號，也不帶競標者的預算。

import type { Condition, GameState, Kernel, Rng } from '../../core'
import { contentAllowed, deriveRng, partOf, productPrice, toMinutes } from '../../core'
import type { BidderEntry, HouseEntry, LookResult, LotEntry, LotKind } from './model'
import { BIDDER_KIND, DEFAULT_CERT, FAKEABLE, LOT_KIND, LOT_KINDS, auctionOf, auctionRules, kindName, lotKey } from './model'
import { undeliverable } from './give'
import type { SessionTimes } from './session'
import { sessionAt, sessionOf } from './session'

export interface CatalogLot {
  /** 第幾件（0 起算） */
  index: number
  /** 看貨結果的鍵 */
  key: string
  /** 拍品的 id（內容的一筆） */
  id: string
  kind: LotKind
  name: string
  desc?: string
  cert: string
  market: number
  reserve: number
  step: number
  /** 仿品（不外露；只有零件與義體會是） */
  fake: boolean
  part?: string
  blueprint?: string
  item?: string
  npc?: string
  contract?: Record<string, unknown>
  effects?: Array<Record<string, unknown>>
  once: boolean
  tags: string[]
}

export interface CatalogBidder {
  id: string
  name: string
  /** 內容的競標者才有；補的「N 號牌」是 undefined */
  npc?: string
  interests: LotKind[]
  /** 這一場的預算倍率（0.8～1.6 之類，小數兩位；每一件都用同一個倍率乘那一件的市價；不外露） */
  mult: number
}

export interface Catalog {
  house: string
  /** 這一場的時間（不看現在幾點：目錄與競標者同一場問幾次都一樣；現在在哪一階看 sessionOf 的 stage） */
  session: SessionTimes
  lots: CatalogLot[]
  bidders: CatalogBidder[]
}

const round10 = (n: number): number => Math.round(n / 10) * 10
const byId = <T extends { id: string }>(list: T[]): T[] => list.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/** 這一場專用的亂數：用途不同就是不同的一串；游標固定在 0，場次（開槌日的天數）當重擲次數。 */
const streamOf = (state: Pick<GameState, 'rng'>, house: string, day: number, purpose: string): Rng => deriveRng({ seed: state.rng.seed, cursor: 0 }, `auction/${house}/${purpose}`, day)

/** 這一件拍品現在抽得到嗎（種類、哪幾家、需要的條件、被內容篩選關掉的標籤、賣過就不再出現的、沒有人處理的契約）。 */
function eligible(k: Kernel, state: GameState, house: HouseEntry, lot: LotEntry, sold: readonly string[]): boolean {
  if (!house.kinds.includes(lot.kind)) return false
  if (lot.houses !== undefined && !lot.houses.includes(house.id)) return false
  if (lot.once === true && sold.includes(lot.id)) return false
  if (lot.tags?.some((t) => !contentAllowed(state.rules, t))) return false
  // 契約要有人處理（沒有人註冊 contract_hold 時不抽）
  if (lot.kind === 'contract' && !k.effects.has('contract_hold')) return false
  if (lot.needs !== undefined) {
    const ctx = { state, stats: k.stats, timeRules: k.timeRules }
    if (!lot.needs.every((c) => k.conditions.test(c as unknown as Condition, ctx))) return false
  }
  // 契約與機密：現在交不出去的先不抽（已經持有他的契約、人還不在場上、效果落空……；LEWD_SYSTEM 6.2 節「交不出去」）
  if ((lot.kind === 'contract' || lot.kind === 'secret') && undeliverable(k, state, lot, house.name) !== null) return false
  // 零件與義體：資料要查得到（格式檢查在載入時擋過；這裡是不 import 別的功能的最後一道）
  if (lot.kind === 'part' && !(lot.part !== undefined && partOf(k.content, lot.part))) return false
  if (lot.kind === 'cyberware' && !(lot.blueprint !== undefined && k.content.get('blueprint', lot.blueprint))) return false
  return true
}

/** 市價：零件是目錄價；義體是設計圖加原廠組合的 productPrice；其餘是資料的 market。 */
export function marketOf(k: Pick<Kernel, 'content'>, lot: LotEntry): number {
  if (lot.kind === 'part') return Math.max(0, partOf(k.content, lot.part)?.price ?? 0)
  if (lot.kind === 'cyberware') return lot.blueprint !== undefined ? productPrice(k.content, lot.blueprint) : 0
  return lot.market ?? 0
}

/** 名字：資料寫了用資料的；沒寫就用零件、設計圖、物品的名字。 */
export function lotName(k: Pick<Kernel, 'content'>, lot: LotEntry): string {
  if (lot.name !== undefined) return lot.name
  const from =
    lot.kind === 'part' && lot.part !== undefined ? partOf(k.content, lot.part)?.name
    : lot.kind === 'cyberware' && lot.blueprint !== undefined ? (k.content.get('blueprint', lot.blueprint)?.name as string | undefined)
    : lot.item !== undefined ? (k.content.get('item', lot.item)?.name as string | undefined)
    : undefined
  return typeof from === 'string' && from !== '' ? from : lot.id
}

function drawLots(k: Kernel, state: GameState, house: HouseEntry, day: number): LotEntry[] {
  const auction = auctionOf(state)
  const pool = k.content.hasKind(LOT_KIND) ? byId(k.content.list<LotEntry>(LOT_KIND)).filter((l) => eligible(k, state, house, l, auction.sold)) : []
  const rng = streamOf(state, house.id, day, 'lots')
  const want = rng.int(house.lots[0], house.lots[1])
  const left = pool.slice()
  const picked: LotEntry[] = []
  while (picked.length < want && left.length > 0) {
    const one = rng.weighted(left, (l) => l.weight ?? 1)
    picked.push(one)
    left.splice(left.indexOf(one), 1)
  }
  // 至少有 must 裡的一種：沒有就把最後一件換成池裡一件（池裡沒有就維持）
  if (house.must && house.must.length > 0 && picked.length > 0 && !picked.some((l) => house.must!.includes(l.kind))) {
    const swaps = left.filter((l) => house.must!.includes(l.kind))
    if (swaps.length > 0) picked[picked.length - 1] = streamOf(state, house.id, day, 'must').weighted(swaps, (l) => l.weight ?? 1)
  }
  return picked
}

function drawBidders(k: Pick<Kernel, 'content'>, state: GameState, house: HouseEntry, day: number): CatalogBidder[] {
  const rules = auctionRules(k)
  const rng = streamOf(state, house.id, day, 'bidders')
  const count = rng.int(house.bidders[0], house.bidders[1])
  const left = k.content.hasKind(BIDDER_KIND) ? byId(k.content.list<BidderEntry>(BIDDER_KIND)) : []
  const mult = (): number => {
    const [lo, hi] = rules.budget
    return Math.min(hi, Math.max(lo, Math.round((lo + rng.next() * (hi - lo)) * 100) / 100))
  }
  const out: CatalogBidder[] = []
  while (out.length < count && left.length > 0) {
    const one = rng.weighted(left, (b) => b.weight ?? 1)
    left.splice(left.indexOf(one), 1)
    out.push({ id: one.id, name: one.name, ...(one.npc !== undefined ? { npc: one.npc } : {}), interests: [...one.interests], mult: mult() })
  }
  // 不夠補「N 號牌」：興趣照種子給一到三種
  while (out.length < count) {
    const n = out.length + 1
    const kinds = LOT_KINDS.slice() as LotKind[]
    const interests: LotKind[] = []
    for (let i = rng.int(1, 3); i > 0; i--) interests.push(kinds.splice(rng.int(0, kinds.length - 1), 1)[0]!)
    out.push({ id: `paddle_${n}`, name: `${n} 號牌`, interests, mult: mult() })
  }
  return out
}

/** 這一場的目錄與競標者。沒有這家拍賣行是 null。 */
export function catalogOf(k: Kernel, state: GameState, houseId: string): Catalog | null {
  const found = sessionOf(k, state, houseId)
  const house = k.content.hasKind('auction_house') ? k.content.get<HouseEntry>('auction_house', houseId) : undefined
  if (!found || !house) return null
  const session = sessionAt(k, house, found.day)
  const rules = auctionRules(k)
  const lots: CatalogLot[] = drawLots(k, state, house, session.day).map((lot, index) => {
    const market = marketOf(k, lot)
    const reserve = round10(market * rules.reserve_pct)
    const step = round10(Math.max(reserve * rules.step_pct, rules.step_min))
    const fake = FAKEABLE.includes(lot.kind) && streamOf(state, house.id, session.day, `fake/${index}`).chance(rules.fake.chance)
    return {
      index, key: lotKey(house.id, session.day, index), id: lot.id, kind: lot.kind, name: lotName(k, lot), ...(lot.desc !== undefined ? { desc: lot.desc } : {}), cert: lot.cert ?? DEFAULT_CERT,
      market, reserve, step, fake,
      ...(lot.part !== undefined ? { part: lot.part } : {}), ...(lot.blueprint !== undefined ? { blueprint: lot.blueprint } : {}), ...(lot.item !== undefined ? { item: lot.item } : {}),
      ...(lot.npc !== undefined ? { npc: lot.npc } : {}), ...(lot.contract !== undefined ? { contract: structuredClone(lot.contract) } : {}), ...(lot.effects !== undefined ? { effects: structuredClone(lot.effects) } : {}),
      once: lot.once === true, tags: [...(lot.tags ?? [])],
    }
  })
  return { house: house.id, session, lots, bidders: drawBidders(k, state, house, session.day) }
}

// ---- 給畫面的讀法 ----

/** 看貨的結果的句子（P79）。 */
export const LOOK_TEXT: Record<LookResult, string> = { ok: '看起來沒有問題。', fake: '這一件是仿品，或者有瑕疵。', unknown: '看不出什麼。' }

export interface CatalogLotView {
  index: number
  name: string
  desc?: string
  /** 種類的 id 與名字（契約在 contract_dom 關掉時名字是「債權」） */
  kind: LotKind
  kind_name: string
  reserve: number
  step: number
  cert: string
  /** 看過貨才有 */
  looked?: { result: LookResult; text: string }
}

export type CatalogView =
  | { house: string; name: string; open: false; at: number }
  | {
    house: string; name: string; open: true; at: number
    /** 這一場開槌日的天數 */
    day: number
    session: { start: number; end: number; preview: { from: number; to: number } }
    lots: CatalogLotView[]
    /** 競標者：只有名字與人數 */
    bidders: { count: number; names: string[] }
  }

/** 目錄給畫面看的樣子：還沒到公布的時間只有公布的時間；之後列每一件（不帶仿品的記號）與競標者的名字（不帶預算）。沒有這家拍賣行是 null。 */
export function catalogView(k: Kernel, state: GameState, houseId: string): CatalogView | null {
  const c = catalogOf(k, state, houseId)
  if (!c) return null
  const name = k.content.get<HouseEntry>('auction_house', houseId)!.name
  if (toMinutes(state.time) < c.session.catalog_at) return { house: houseId, name, open: false, at: c.session.catalog_at }
  const looked = auctionOf(state).looked
  return {
    house: houseId, name, open: true, at: c.session.catalog_at, day: c.session.day,
    session: { start: c.session.start, end: c.session.end, preview: { ...c.session.preview } },
    lots: c.lots.map((l): CatalogLotView => {
      const r = looked[l.key]
      return {
        index: l.index, name: l.name, ...(l.desc !== undefined ? { desc: l.desc } : {}), kind: l.kind, kind_name: kindName(l.kind, state), reserve: l.reserve, step: l.step, cert: l.cert,
        ...(r !== undefined ? { looked: { result: r, text: LOOK_TEXT[r] } } : {}),
      }
    }),
    bidders: { count: c.bidders.length, names: c.bidders.map((b) => b.name) },
  }
}

