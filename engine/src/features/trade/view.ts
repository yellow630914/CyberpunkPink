// L6 功能 trade 給畫面看的商店（UI 3.8 節：抬頭、貨架、背包裡這間店收的東西）。唯讀；改狀態走 checkout.ts。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { meterOf } from '../../core'
import type { Pay, Quote, ShopEntry } from './model'
import type { BargainView } from './bargain'
import { bargainView, temperOf } from './bargain'
import { buyBlock, payBlock, sellBlock, sellPrices, shopBlock } from './checkout'
import {
  PAYS, categoryName, decayMult, discountOf, hostilityMarkup, hostilityOf, intakeCount, isCargo, itemOf, marketMult, marketOf, matches, plainCount, priced, quote, shopEntry, shopTypeOf, stockOf,
  tradeCategoryOf, tradeRules, wornCount,
} from './model'

export interface ShelfRow {
  item: string
  name: string
  grade: number
  category: string
  /** 貿易類別（id 與名字；TRADE 4.1）與是不是貨物 */
  tradeCategory: string
  tradeCategoryName: string
  cargo: boolean
  legal: string
  tags: string[]
  /** 一個的價錢；拆解的每一步在 quote.steps */
  price: number
  quote: Quote
  /** 今天上架幾個、還剩幾個 */
  total: number
  left: number
  /** 和付款無關、選不了的原因（賣完了、整間店不做生意、無籍買不到登記類）；能買是 null */
  block: string | null
  /** 選了這一種錢做不做得成：每一種錢一句原因，行得通是 null */
  pay: Record<Pay, string | null>
}

export interface SellRow {
  item: string
  /** 帶實例資料的那一件（組裝的成品、零件；背包裡 data.uid）才有：每一件一列，賣的時候購物車的列要帶同一個 uid */
  uid?: string
  name: string
  /** 貿易類別（id 與名字）與是不是貨物 */
  tradeCategory: string
  tradeCategoryName: string
  cargo: boolean
  /** 能賣幾個（沒有實例資料的那幾疊，扣掉身上穿著的；帶 uid 的是那一疊的個數） */
  qty: number
  /** 賣第一個的價錢（收購遞減之後，同一個類別每多賣一個再低一點：prices 是照順序賣 qty 個每一個的價錢） */
  price: number
  prices: number[]
  /** 這間店這個貿易類別已經累計收了幾件（含每天回復）與再收一件的遞減倍率 */
  taken: number
  decay: number
  quote: Quote
  /** 這一個賣不賣得了；能賣是 null */
  block: string | null
}

export interface ShopView {
  shop: { id: string; name: string; type: string; typeName: string; district: string; districtName: string }
  /** 店主與親密度；沒有指定店主是 null */
  keeper: { id: string; name: string; affinity: number } | null
  /** 後台勢力與好感、敵對值；獨立的店是 null */
  backer: { id: string; name: string; favor: number; hostility: number } | null
  /** 收哪幾種錢：no 不收現金、only 只收現金；accepts 每一種錢收不收（不收是原因） */
  cash: 'yes' | 'only' | 'no'
  pay: Record<Pay, string | null>
  scan_registered: boolean
  temper: number | null
  /** 這一區的行情（只列有寫的貿易類別；倍率已經夾在 0.5～2.5）：id、名字、倍率 */
  market: Array<{ category: string; name: string; mult: number }>
  /** 殺價：DC、今天殺到的倍率、每一種列得出來的殺法與原因 */
  bargain: BargainView
  /** 整間店不做你的生意的原因；做的話是 null */
  closed: string | null
  /** 現在的折扣（合計與兩個來源）與敵對值加價 */
  discount: { favor: number; keeper: number; total: number }
  markup: number
  shelf: ShelfRow[]
  sell: SellRow[]
}

const nameOf = (k: Pick<Kernel, 'content'>, kind: string, id: string): string => {
  const e = k.content.get<ContentEntry & { name?: string; short?: string }>(kind, id)
  return (kind === 'faction' ? e?.short : undefined) ?? e?.name ?? id
}

/**
 * 開一間店的畫面：抬頭、貨架（今天的清單，每一列的價錢、拆解與選不了的原因）、背包裡這間店收的東西與收購價。
 * 不需要人站在店門口（人站在設施上時由 k.grid.usesOf 列「進店」；沒有世界也能直接開）。
 */
export function shopView(k: Kernel, state: GameState, shop: string | ShopEntry): ShopView {
  const entry = shopEntry(k, shop)
  if (!entry) throw new Error(`沒有 ${String(shop)} 這間店`)
  const type = shopTypeOf(k, entry)
  if (!type) throw new Error(`${entry.id}：查不到店的種類 ${entry.type}`)
  const rules = tradeRules(k)
  const closed = shopBlock(k, state, entry)
  const discount = discountOf(k, state, entry)
  const hostility = hostilityOf(k, state, entry)

  const shelf: ShelfRow[] = []
  for (const row of stockOf(k, state, entry)) {
    const it = itemOf(k, row.item)
    if (!priced(it)) continue
    const q = quote(k, state, entry, row.item, 'buy')
    const block = buyBlock(k, state, entry, row.item, 1)
    const pay = Object.fromEntries(PAYS.map((p) => [p, block ?? buyBlock(k, state, entry, row.item, 1, p)])) as Record<Pay, string | null>
    shelf.push({
      item: row.item, name: it.name, grade: it.grade, category: it.category, legal: it.legal, tags: it.tags ?? [],
      price: q.price, quote: q, total: row.total, left: row.left, block, pay,
      tradeCategory: tradeCategoryOf(k, it), tradeCategoryName: categoryName(k, tradeCategoryOf(k, it)), cargo: isCargo(it),
    })
  }

  const sell: SellRow[] = []
  const sellRow = (item: string, qty: number, uid?: string): SellRow | null => {
    const it = itemOf(k, item)
    if (!priced(it) || !matches(it, type.buys)) return null
    const q = quote(k, state, entry, item, 'sell')
    const category = tradeCategoryOf(k, it)
    const taken = intakeCount(k, state, entry.id, category)
    const { prices } = sellPrices(k, state, entry, item, Math.max(1, qty))
    return {
      item, ...(uid !== undefined ? { uid } : {}), name: it.name, tradeCategory: category, tradeCategoryName: categoryName(k, category), cargo: isCargo(it), qty, price: q.price, prices: qty > 0 ? prices : [],
      taken, decay: decayMult(rules, taken), quote: q, block: sellBlock(k, state, entry, item, 1, uid),
    }
  }
  const seen = new Set<string>()
  for (const s of state.inventory) {
    // 帶 uid 的實例各一列；其餘的同一種物品合成一列（沒有實例資料的那幾疊，扣掉身上穿著的）
    const uid = typeof s.data?.uid === 'string' ? s.data.uid : undefined
    if (uid === undefined && seen.has(s.id)) continue
    if (uid === undefined) seen.add(s.id)
    const row = sellRow(s.id, uid !== undefined ? s.qty : Math.max(0, plainCount(state, s.id) - wornCount(state, s.id)), uid)
    if (row) sell.push(row)
  }

  return {
    shop: { id: entry.id, name: entry.name, type: type.id, typeName: type.name, district: entry.district, districtName: nameOf(k, 'district', entry.district) },
    keeper: entry.owner ? { id: entry.owner, name: nameOf(k, 'npc', entry.owner), affinity: meterOf(k, state, 'affinity', entry.owner) } : null,
    backer: entry.backer ? { id: entry.backer, name: nameOf(k, 'faction', entry.backer), favor: meterOf(k, state, 'favor', entry.backer), hostility } : null,
    cash: type.cash === 'only' ? 'only' : type.cash ? 'yes' : 'no',
    pay: { cred: payBlock(k, state, entry, 'cred'), cash: payBlock(k, state, entry, 'cash') },
    scan_registered: type.scan_registered !== false,
    temper: temperOf(k, entry),
    market: Object.keys(marketOf(k, entry.district)).filter((c) => c in rules.categories).sort().map((c) => ({ category: c, name: categoryName(k, c), mult: marketMult(k, entry.district, c) })),
    bargain: bargainView(k, state, entry),
    closed,
    discount: { favor: discount.favor, keeper: discount.keeper, total: discount.total },
    markup: hostilityMarkup(rules, hostility),
    shelf, sell,
  }
}
