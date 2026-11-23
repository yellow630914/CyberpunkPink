// L6 功能 trade 的資料與純函式：規則、內容的格式、狀態的形狀、今天的清單、價格與拆解。不碰登錄表（登記在 index.ts）。
// 規格：TRADE 第 1 節（每天的清單、購物車）、第 2 節（種類的表與件數）、第 3 節（3.1～3.3）、第 7 節（付款）、第 9 節（折扣與加價）、第 11、12 節；
// LIFE 1.1 節；dev/adr/0016 第三節；dev/work/M2-trade.md。
//
// 內容種類：
//   shop_type   { id, name, catalog: [物品的類別或標籤], buys: [...], grade_max, cash: boolean | 'only', scan_registered?, shop_mult, temper?: number | null }
//   shop        { id, type, name, district, block?, facility?, owner?: npc, backer?: faction, fixed?: [物品 id] }
//   trade_rule  { id: 'default', ... }（規則的數字，蓋掉下面的 DEFAULT_TRADE_RULES）
// 物品多讀的欄位：price（沒有就不上架也不收）、trade_category?（貿易類別；M2-market 用）、no_sell?（不能賣）。
// 「物品的類別或標籤」的比對：物品的 category、tags 裡的任何一個、trade_category，有一個相同就算。
//
// 狀態 state.ext.trade：{ shops: { [商店 id]: { day, sold: { [物品 id]: 今天賣掉幾個 } } } }。清單本身不存：每次用（存檔種子、店、第幾天）重算，結果一樣；
// day 不是今天的紀錄當作沒有賣過（跨日重抽）。

import type { ActorId, ContentEntry, GameState, ItemEntry, ItemStack, Kernel } from '../../core'
import { deriveRng, isRecord, meterOf } from '../../core'

export const OWNER = 'trade'
export const EXT = 'trade'
export const SHOP_TYPE_KIND = 'shop_type'
export const SHOP_KIND = 'shop'
export const RULE_KIND = 'trade_rule'

export type Pay = 'cred' | 'cash'
export const PAYS: readonly Pay[] = ['cred', 'cash']
export const PAY_NAME: Record<Pay, string> = { cred: '帳戶', cash: '現金晶片' }

// ---- 規則（TRADE 3.2、9、2；數字沒寫的照 dev/adr 與工單） ----

export interface TradeRules {
  /** 收購比例（TRADE 3.2：40%，存檔規則可調） */
  buy_ratio: number
  /** 收購的區倍率打幾折：1 + (區倍率 − 1) × 這個數（0.25） */
  sell_area_slope: number
  /** 折扣合計上限（30%） */
  discount_cap: number
  /** 後台勢力的好感：每一段的下限與折扣（TRADE 9：0～19 無、20 起 3%、40 起 6%、60 起 10%、80 起 15%） */
  favor_bands: number[]
  favor_discounts: number[]
  /** 店主親密度：每點折扣多少、最多折多少（0.2%、10%） */
  keeper_per_point: number
  keeper_cap: number
  /** 敵對值：這個值以上加價（40 起 ×1.2）、這個值以上不做生意（60） */
  hostility_markup_at: number
  hostility_markup: number
  hostility_refuse_at: number
  /** 用帳戶買違禁品，後台勢力的敵對值當場加多少（TRADE 7 只寫「當場加」，數字沒寫：暫定每一種 3 點） */
  dirty_hostility: number
  /** 每天上架幾種（含 fixed 以外的抽選）：[最少, 最多] */
  list_size: [number, number]
  /** 每種東西上架幾個（TRADE 2 最後一條）：先看標籤、再看類別、最後是 default */
  stock_by_tag: Record<string, [number, number]>
  stock_by_category: Record<string, [number, number]>
  stock_default: [number, number]
}

export const DEFAULT_TRADE_RULES: TradeRules = {
  buy_ratio: 0.4, sell_area_slope: 0.25, discount_cap: 0.3,
  favor_bands: [20, 40, 60, 80], favor_discounts: [0.03, 0.06, 0.1, 0.15],
  keeper_per_point: 0.002, keeper_cap: 0.1,
  hostility_markup_at: 40, hostility_markup: 1.2, hostility_refuse_at: 60, dirty_hostility: 3,
  list_size: [6, 10],
  stock_by_tag: { food: [20, 20] },
  stock_by_category: { weapon: [1, 1], armor: [1, 1], clothing: [1, 1], accessory: [1, 1], blueprint: [1, 1], misc: [20, 20] },
  stock_default: [2, 5],
}

const num = (v: unknown, min: number, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const int = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const range = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && int(v[0], 1) && int(v[1], 1) && (v[0] as number) <= (v[1] as number)
const rangeMap = (v: unknown): boolean => isRecord(v) && Object.values(v).every(range)

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const ratios: Array<keyof TradeRules> = ['buy_ratio', 'sell_area_slope', 'discount_cap', 'keeper_per_point', 'keeper_cap']
  for (const f of ratios) if (e[f] !== undefined && !num(e[f], 0, 1)) p.push(`${f} 要是 0～1 的數字`)
  if (e.hostility_markup !== undefined && !num(e.hostility_markup, 1)) p.push('hostility_markup 要是 1 以上的倍率')
  for (const f of ['hostility_markup_at', 'hostility_refuse_at'] as const) if (e[f] !== undefined && !int(e[f], 0)) p.push(`${f} 要是 0 以上的整數`)
  if (e.dirty_hostility !== undefined && !int(e.dirty_hostility, 0)) p.push('dirty_hostility 要是 0 以上的整數')
  if (e.favor_bands !== undefined || e.favor_discounts !== undefined) {
    const b = e.favor_bands ?? DEFAULT_TRADE_RULES.favor_bands
    const d = e.favor_discounts ?? DEFAULT_TRADE_RULES.favor_discounts
    if (!(Array.isArray(b) && b.every((x, i) => int(x, 0) && (i === 0 || x > (b[i - 1] as number))))) p.push('favor_bands 要是遞增的整數')
    else if (!(Array.isArray(d) && d.length === b.length && d.every((x) => num(x, 0, 1)))) p.push('favor_discounts 要和 favor_bands 一樣長（預設四個），每個是 0～1 的數字')
  }
  if (e.list_size !== undefined && !range(e.list_size)) p.push('list_size 要是 [最少, 最多]：兩個 1 以上的整數')
  if (e.stock_default !== undefined && !range(e.stock_default)) p.push('stock_default 要是 [最少, 最多]')
  for (const f of ['stock_by_tag', 'stock_by_category'] as const) if (e[f] !== undefined && !rangeMap(e[f])) p.push(`${f} 要是 { 名稱: [最少, 最多] }`)
  return p
}

/** 規則：內容 trade_rule/default 蓋掉預設（沒寫的欄位用預設）。 */
export function tradeRules(k: Pick<Kernel, 'content'>): TradeRules {
  const e = k.content.get<ContentEntry & Partial<TradeRules>>(RULE_KIND, 'default')
  if (!e) return DEFAULT_TRADE_RULES
  const { id: _id, ...rest } = e
  return { ...DEFAULT_TRADE_RULES, ...(rest as Partial<TradeRules>) }
}

// ---- 內容 ----

export interface ShopTypeEntry extends ContentEntry {
  name: string
  catalog: string[]
  buys: string[]
  grade_max: number
  cash: boolean | 'only'
  scan_registered?: boolean
  shop_mult: number
  temper?: number | null
}

export interface ShopEntry extends ContentEntry {
  type: string
  name: string
  district: string
  block?: string
  facility?: string
  owner?: string
  backer?: string
  fixed?: string[]
}

const idList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

export function shopTypeProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!idList(e.catalog)) p.push('catalog 要是物品類別或標籤的陣列')
  if (!idList(e.buys)) p.push('buys 要是物品類別或標籤的陣列（不收東西就寫空陣列）')
  if (!(int(e.grade_max, 1) && (e.grade_max as number) <= 5)) p.push('grade_max 要是 1～5')
  if (!(typeof e.cash === 'boolean' || e.cash === 'only')) p.push("cash 要是 true、false 或 'only'")
  if (e.scan_registered !== undefined && typeof e.scan_registered !== 'boolean') p.push('scan_registered 要是 true 或 false')
  if (!(typeof e.shop_mult === 'number' && Number.isFinite(e.shop_mult) && e.shop_mult > 0)) p.push('shop_mult 要是大於 0 的倍率')
  if (e.temper !== undefined && e.temper !== null && !(typeof e.temper === 'number' && Number.isFinite(e.temper))) p.push('temper 要是數字或 null')
  return p
}

export function shopProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.type)) p.push('要有 type（shop_type 的 id）')
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.district)) p.push('要有 district（區的 id）')
  if (e.block !== undefined && !isText(e.block)) p.push('block 要是街區的 id')
  if (e.facility !== undefined && !isText(e.facility)) p.push('facility 要是設施的標記 id')
  if (e.facility !== undefined && e.block === undefined) p.push('寫了 facility 就要寫 block（設施的標記 id 在每一塊街區都會重複）')
  if (e.owner !== undefined && !isText(e.owner)) p.push('owner 要是 NPC 的 id')
  if (e.backer !== undefined && !isText(e.backer)) p.push('backer 要是勢力的 id')
  if (e.fixed !== undefined && !idList(e.fixed)) p.push('fixed 要是物品 id 的陣列')
  return p
}

export const shopEntry = (k: Pick<Kernel, 'content'>, shop: string | ShopEntry): ShopEntry | undefined => (typeof shop === 'string' ? k.content.get<ShopEntry>(SHOP_KIND, shop) : shop)
export const shopTypeOf = (k: Pick<Kernel, 'content'>, shop: ShopEntry): ShopTypeEntry | undefined => k.content.get<ShopTypeEntry>(SHOP_TYPE_KIND, shop.type)

// ---- 物品 ----

export interface TradeItem extends ItemEntry {
  trade_category?: string
  no_sell?: boolean
}

export const itemOf = (k: Pick<Kernel, 'content'>, id: string): TradeItem | undefined => k.content.get<TradeItem>('item', id)
/** 有定價才上架也才收：目錄價是 0 以上的整數（0 算有定價）。 */
export const priced = (it: TradeItem | undefined): it is TradeItem & { price: number } => !!it && typeof it.price === 'number' && Number.isFinite(it.price) && it.price >= 0

/** 物品屬不屬於「類別或標籤」的清單：category、tags、trade_category 任何一個相同。 */
export function matches(it: TradeItem, list: readonly string[]): boolean {
  return list.some((c) => it.category === c || it.trade_category === c || (it.tags ?? []).includes(c))
}

// ---- 狀態 ----

export interface ShopDay {
  day: number
  sold: Record<string, number>
}
export interface TradeState {
  shops: Record<string, ShopDay>
}

export function tradeOf(state: Pick<GameState, 'ext'>): TradeState {
  const raw = state.ext[EXT]
  const shops: Record<string, ShopDay> = {}
  if (isRecord(raw) && isRecord(raw.shops)) {
    for (const [id, v] of Object.entries(raw.shops)) {
      if (!isRecord(v) || !int(v.day, 0) || !isRecord(v.sold)) continue
      const sold: Record<string, number> = {}
      for (const [item, n] of Object.entries(v.sold)) if (int(n, 1)) sold[item] = n
      shops[id] = { day: v.day, sold }
    }
  }
  return { shops }
}

/** 今天這間店每樣東西賣掉了幾個。 */
export function soldToday(state: GameState, shop: string): Record<string, number> {
  const d = tradeOf(state).shops[shop]
  return d && d.day === state.time.day ? d.sold : {}
}

// ---- 今天的清單 ----

export interface StockRow {
  item: string
  /** 今天上架的數量 */
  total: number
  /** 今天賣掉了幾個 */
  sold: number
  /** 還剩幾個（0 是賣完了，等明天） */
  left: number
}

function stockRange(rules: TradeRules, it: TradeItem): [number, number] {
  for (const t of it.tags ?? []) if (rules.stock_by_tag[t]) return rules.stock_by_tag[t]!
  return rules.stock_by_category[it.category] ?? rules.stock_default
}

/** 這種店的商品池：照 catalog 比對、不超過 grade_max、有定價的東西（照 id 排好，亂數才穩定）。 */
export function candidatesOf(k: Pick<Kernel, 'content'>, type: ShopTypeEntry): Array<TradeItem & { price: number }> {
  return k.content.list<TradeItem>('item')
    .filter((it): it is TradeItem & { price: number } => priced(it) && it.grade <= type.grade_max && matches(it, type.catalog))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * 今天這間店的清單（TRADE 第 1、2 節）：亂數只看（存檔種子、店、第幾天），所以同一天看幾次都一樣、隔天重抽。
 * 一般商品從這種店的商品池抽 list_size 種、每種的件數照 stock_*，加上 fixed（沒有定價的不上）。買掉的從今天的紀錄扣，買完了等明天。
 * 店的種類查不到、或商品池是空的（又沒有 fixed）就是空的清單。
 */
export function stockOf(k: Pick<Kernel, 'content'>, state: GameState, shop: string | ShopEntry): StockRow[] {
  const entry = shopEntry(k, shop)
  const type = entry ? shopTypeOf(k, entry) : undefined
  if (!entry || !type) return []
  const rules = tradeRules(k)
  const day = state.time.day
  // 游標固定成 0：清單不受之後擲過幾顆骰影響（只看種子、店、第幾天）
  const rng = deriveRng({ seed: state.rng.seed, cursor: 0 }, `trade/stock/${entry.id}`, day)
  const pool = candidatesOf(k, type)
  const order = pool.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const want = Math.min(pool.length, rng.int(rules.list_size[0], rules.list_size[1]))
  const picked = order.slice(0, want).map((i) => pool[i]!)
  const chosen = new Map<string, TradeItem & { price: number }>()
  for (const id of entry.fixed ?? []) {
    const it = itemOf(k, id)
    if (priced(it)) chosen.set(id, it)
  }
  for (const it of picked) if (!chosen.has(it.id)) chosen.set(it.id, it)
  const sold = soldToday(state, entry.id)
  return [...chosen.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((it) => {
      const [lo, hi] = stockRange(rules, it)
      const total = rng.int(lo, hi)
      const n = sold[it.id] ?? 0
      return { item: it.id, total, sold: Math.min(n, total), left: Math.max(0, total - n) }
    })
}

// ---- 價格與拆解（TRADE 3.2、9） ----

export interface QuoteStep {
  id: 'catalog' | 'shop' | 'district' | 'category' | 'discount' | 'hostility' | 'ratio' | 'sell_district' | 'sell_bonus'
  name: string
  /** 這一步乘多少（目錄價那一步是 1） */
  mult: number
  /** 到這一步為止的數字（每一步四捨五入） */
  value: number
}

export interface Discount {
  /** 後台勢力的好感折的 */
  favor: number
  /** 店主的親密度折的 */
  keeper: number
  /** 合計（夾在上限內） */
  total: number
  /** 沒夾之前的合計 */
  raw: number
}

export interface Quote {
  item: string
  side: 'buy' | 'sell'
  /** 一個的價錢（最後一步的數字） */
  price: number
  steps: QuoteStep[]
  discount: Discount
}

/** 四捨五入（先消掉浮點的尾巴：108 × 0.9 = 97.2、0.5 往上）。 */
export const round = (x: number): number => Math.round(Number(x.toFixed(6)))

/** 後台勢力的好感折幾成（TRADE 9 的表）。 */
export function favorDiscount(rules: TradeRules, favor: number): number {
  let d = 0
  rules.favor_bands.forEach((from, i) => { if (favor >= from) d = rules.favor_discounts[i] ?? d })
  return d
}

/** 折扣：後台勢力的好感加店主的親密度（每點 0.2%、最多 10%），合計最多 30%；沒有後台勢力或店主就是 0。 */
export function discountOf(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, shop: ShopEntry): Discount {
  const rules = tradeRules(k)
  const favor = shop.backer ? favorDiscount(rules, meterOf(k, state, 'favor', shop.backer)) : 0
  const keeper = shop.owner ? Math.min(rules.keeper_cap, Math.max(0, meterOf(k, state, 'affinity', shop.owner)) * rules.keeper_per_point) : 0
  const raw = favor + keeper
  return { favor, keeper, raw, total: Math.min(rules.discount_cap, raw) }
}

/** 後台勢力對你的敵對值（沒有後台勢力是 0）。 */
export const hostilityOf = (k: Pick<Kernel, 'meters'>, state: GameState, shop: ShopEntry): number => (shop.backer ? meterOf(k, state, 'hostility', shop.backer) : 0)

const districtMult = (k: Pick<Kernel, 'content'>, shop: ShopEntry): number => {
  const m = k.content.get<ContentEntry & { price_mult?: unknown }>('district', shop.district)?.price_mult
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 1
}

/**
 * 類別的行情（TRADE 4.2）：M2-market 才接上；這一張固定是 1。步驟照樣列在拆解裡，接上之後只改這一個函式。
 */
export function categoryMult(_k: Pick<Kernel, 'content'>, _state: GameState, _shop: ShopEntry, _item: TradeItem): number {
  return 1
}

/**
 * 一個東西在這間店的價錢與拆解。
 *   買：目錄價 → 店家倍率 → 區倍率 → 類別的行情 → 折扣 → 敵對值的加價
 *   賣：目錄價 → 收購比例 → 收購的區倍率（1 + (區倍率 − 1) × 0.25）→ 類別的行情 → 折扣加成（1 + 折扣 ÷ 2）
 * 每一步四捨五入。沒有定價的東西、店的種類查不到丟錯（呼叫的人要先確認）。
 */
export function quote(k: Kernel, state: GameState, shop: string | ShopEntry, item: string, side: 'buy' | 'sell'): Quote {
  const entry = shopEntry(k, shop)
  if (!entry) throw new Error(`沒有 ${String(shop)} 這間店`)
  const type = shopTypeOf(k, entry)
  if (!type) throw new Error(`${entry.id}：查不到店的種類 ${entry.type}`)
  const it = itemOf(k, item)
  if (!priced(it)) throw new Error(`${item} 沒有定價`)
  const rules = tradeRules(k)
  const discount = discountOf(k, state, entry)
  const steps: QuoteStep[] = [{ id: 'catalog', name: '目錄價', mult: 1, value: it.price }]
  let v = it.price
  const push = (id: QuoteStep['id'], name: string, mult: number): void => {
    v = round(v * mult)
    steps.push({ id, name, mult, value: v })
  }
  const area = districtMult(k, entry)
  const cat = categoryMult(k, state, entry, it)
  if (side === 'buy') {
    push('shop', '店家倍率', type.shop_mult)
    push('district', '區倍率', area)
    push('category', '類別的行情', cat)
    push('discount', '折扣', 1 - discount.total)
    push('hostility', '敵對值的加價', hostilityOf(k, state, entry) >= rules.hostility_markup_at ? rules.hostility_markup : 1)
  } else {
    push('ratio', '收購比例', rules.buy_ratio)
    push('sell_district', '收購的區倍率', 1 + (area - 1) * rules.sell_area_slope)
    push('category', '類別的行情', cat)
    push('sell_bonus', '折扣加成', 1 + discount.total / 2)
  }
  return { item, side, price: v, steps, discount }
}

// ---- 身上的東西 ----

/** 背包裡沒有實例資料的那幾疊一共有幾個（賣只賣這些：核心的 item 變更先拿沒有實例資料的，不會拿錯那一件）。 */
export function plainCount(state: GameState, item: string): number {
  return state.inventory.reduce((n: number, s: ItemStack) => (s.id === item && !s.data ? n + s.qty : n), 0)
}

/**
 * 身上穿著、戴著、帶著的這個物品有幾件：讀每個隊員 actor.ext.gear 的 worn／acc／carry（gear 功能的資料格式，和 actor.ext.identity 一樣是共用的慣例，
 * 這裡只認格式、不 import）。
 */
export function wornCount(state: GameState, item: string): number {
  let n = 0
  for (const id of new Set<ActorId>([...state.party, ...(state.pc ? [state.pc] : [])])) {
    const gear = state.actors[id]?.ext.gear
    if (!isRecord(gear)) continue
    for (const group of ['worn', 'acc', 'carry'] as const) {
      const slots = gear[group]
      if (isRecord(slots)) for (const v of Object.values(slots)) if (v === item) n++
    }
  }
  return n
}

/** 主角的身分（actor.ext.identity.class；沒寫就是市民）。 */
export function identityClass(state: GameState): string {
  const raw = state.pc ? state.actors[state.pc]?.ext.identity : undefined
  return isRecord(raw) && typeof raw.class === 'string' ? raw.class : 'citizen'
}
