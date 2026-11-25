// L6 功能 trade 的資料與純函式：規則、內容的格式、狀態的形狀、今天的清單、價格與拆解。不碰登錄表（登記在 index.ts）。
// 規格：TRADE 第 1 節（每天的清單、購物車）、第 2 節（種類的表與件數）、第 3 節（3.1～3.3）、第 7 節（付款）、第 9 節（折扣與加價）、第 11、12 節；
// LIFE 1.1 節；dev/adr/0016 第三節；dev/work/M2-trade.md。
//
// 內容種類：
//   shop_type   { id, name, catalog: [物品的類別或標籤], buys: [...], grade_max, cash: boolean | 'only', scan_registered?, shop_mult, temper?: number | null }
//   shop        { id, type, name, district, block?, facility?, owner?: npc, backer?: faction, fixed?: [物品 id], fixed_products?: [設計圖 id] }
//               fixed_products：貨架上固定放的成品（M4-craft）：設計圖加它的原廠組合（stock），價錢是核心的 productPrice；買到的那一疊帶完整的 ProductData
//   trade_rule  { id: 'default', ... }（規則的數字，蓋掉下面的 DEFAULT_TRADE_RULES）
// 物品多讀的欄位：price（沒有就不上架也不收）、trade_category?（貿易類別；沒寫的照 category 與 tags 推）、cargo?: true（貨物）、no_sell?（不能賣）。
// 組裝出來的成品（背包裡 id 是設計圖、data 是 ProductData 的一疊；M4-craft）不是 item 的一筆：productItem 把設計圖當成一個物品看（類別照設計圖的種類：武器、護甲、義體是 part），
// 買的價錢是 productPrice，賣的價錢只算零件（TRADE 8.3 節：收購成品時只算零件，不算組裝的那兩成與型係數）。
// 「物品的類別或標籤」的比對：物品的 category、tags 裡的任何一個、trade_category，有一個相同就算。
// 區多讀的欄位：district.market?: { [貿易類別]: 倍率 }（TRADE 4.2；寫在區的資料裡，夾在 0.5～2.5）。
//
// 狀態 state.ext.trade（空的欄位不寫）：
//   shops    { [商店 id]: { day, sold: { [物品 id]: 今天賣掉幾個 } } }。清單本身不存：每次用（存檔種子、店、第幾天）重算，結果一樣；day 不是今天的紀錄當作沒有賣過（跨日重抽）
//   intake   { [商店 id]: { [貿易類別]: { n, day } } }：收購遞減（TRADE 3.2）；記的是 day 那天的累計，之後每天回復 decay_recover 件
//   bargains { [商店 id]: { day, mult, method, degree } }：今天整車殺過價（每間店每天一次）與殺到的倍率（TRADE 第 5 節）
//   closed   { [商店 id]: day }：施壓大失敗被趕出去，day 那天不做你的生意

import type { ActorId, BlueprintEntry, Change, ContentEntry, Degree, GameState, ItemEntry, ItemStack, Kernel } from '../../core'
import { QUALITY_PRICE_MULT, USED_PRICE_MULT, deriveRng, findByUid, isRecord, meterOf, productOf, productPrice, readProduct, stackPart } from '../../core'

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
  /** 後台勢力對你的敵對值加價：[這個值以上, 倍率]，由小到大，取最後一個達到的（FACTIONS 6.1 節：20～39 ×1.1、40～59 ×1.2）；沒有達到的是 ×1 */
  hostility_markups: Array<[number, number]>
  /** 這個值以上不做生意（60：追捕） */
  hostility_refuse_at: number
  /** 用帳戶買違禁品，後台勢力的敵對值當場加多少（TRADE 7 只寫「當場加」，數字沒寫：暫定每一種 3 點） */
  dirty_hostility: number
  /** 每天上架幾種（含 fixed 以外的抽選）：[最少, 最多] */
  list_size: [number, number]
  /** 每種東西上架幾個（TRADE 2 最後一條）：先看標籤、再看類別、最後是 default */
  stock_by_tag: Record<string, [number, number]>
  stock_by_category: Record<string, [number, number]>
  stock_default: [number, number]
  /** 貿易類別（TRADE 4.1）：id → 名字 */
  categories: Record<string, string>
  /** 物品沒寫 trade_category 時照什麼推：先看標籤、再看類別；都沒對上就是 category_default */
  category_by_tag: Record<string, string>
  category_by_category: Record<string, string>
  category_default: string
  /** 行情（區的 market）的整體幅度（1 + (行情 − 1) × market_scale）與夾值（TRADE 3.2：0.5～2.5） */
  market_scale: number
  market_min: number
  market_max: number
  /** 貨物的收購比例（TRADE 4.3：90%） */
  cargo_ratio: number
  /** 收購遞減（TRADE 3.2）：每多收一件 −3%、最多 −50%、每天回復 5 件 */
  decay_step: number
  decay_max: number
  decay_recover: number
  /** 殺價（TRADE 第 5 節）：DC = bargain_dc − ⌊店主親密度 ÷ bargain_affinity_step⌋ ＋ 店的脾氣 */
  bargain_dc: number
  bargain_affinity_step: number
  /** 撒嬌要這一區的豔名到這個值；傾向相合時 +bargain_tendency_bonus */
  bargain_fame_min: number
  bargain_tendency_bonus: number
  /** 施壓大失敗：店主後台勢力的敵對值加多少 */
  bargain_pressure_hostility: number
  /** 結果的表：價格倍率與店主親密度的變化 */
  bargain_results: Record<'critical' | 'success' | 'fail' | 'fumble', { mult: number; affinity: number }>
}

/** 貿易類別（TRADE 4.1）的預設清單。 */
export const DEFAULT_TRADE_CATEGORIES: Record<string, string> = {
  food: '食物', daily: '日用', medicine: '藥', ammo: '彈藥', weapon: '武器', apparel: '護甲與服裝', mech: '機械義體與零件', bio: '生體件',
  electronics: '電子', fuel: '燃料', luxury: '奢侈品', material: '素材與帶子', furniture: '家具',
}

export const DEFAULT_TRADE_RULES: TradeRules = {
  buy_ratio: 0.4, sell_area_slope: 0.25, discount_cap: 0.3,
  favor_bands: [20, 40, 60, 80], favor_discounts: [0.03, 0.06, 0.1, 0.15],
  keeper_per_point: 0.002, keeper_cap: 0.1,
  hostility_markups: [[20, 1.1], [40, 1.2]], hostility_refuse_at: 60, dirty_hostility: 3,
  list_size: [6, 10],
  stock_by_tag: { food: [20, 20] },
  stock_by_category: { weapon: [1, 1], armor: [1, 1], clothing: [1, 1], accessory: [1, 1], blueprint: [1, 1], misc: [20, 20] },
  stock_default: [2, 5],
  categories: DEFAULT_TRADE_CATEGORIES,
  category_by_tag: { food: 'food', medical: 'medicine', luxury: 'luxury', electronics: 'electronics', fuel: 'fuel', furniture: 'furniture' },
  category_by_category: {
    weapon: 'weapon', armor: 'apparel', clothing: 'apparel', accessory: 'apparel', ammo: 'ammo', consumable: 'daily', tool: 'daily', part: 'mech',
    blueprint: 'material', cargo: 'daily', misc: 'daily',
  },
  category_default: 'daily',
  market_scale: 1, market_min: 0.5, market_max: 2.5,
  cargo_ratio: 0.9,
  decay_step: 0.03, decay_max: 0.5, decay_recover: 5,
  bargain_dc: 13, bargain_affinity_step: 25, bargain_fame_min: 30, bargain_tendency_bonus: 2, bargain_pressure_hostility: 5,
  bargain_results: {
    critical: { mult: 0.8, affinity: 2 }, success: { mult: 0.9, affinity: 0 }, fail: { mult: 1, affinity: 0 }, fumble: { mult: 1.1, affinity: -3 },
  },
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
  if (e.hostility_markups !== undefined) {
    const m = e.hostility_markups
    if (!(Array.isArray(m) && m.every((x, i) => Array.isArray(x) && x.length === 2 && int(x[0], 0) && num(x[1], 1) && (i === 0 || (x[0] as number) > ((m[i - 1] as unknown[])[0] as number))))) {
      p.push('hostility_markups 要是 [敵對值, 倍率] 的陣列，敵對值是遞增的整數、倍率是 1 以上的數字')
    }
  }
  if (e.hostility_refuse_at !== undefined && !int(e.hostility_refuse_at, 0)) p.push('hostility_refuse_at 要是 0 以上的整數')
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

  // 行情、貨物、收購遞減、殺價（M2-market）
  const cats = e.categories !== undefined ? e.categories : DEFAULT_TRADE_CATEGORIES
  if (!(isRecord(cats) && Object.keys(cats).length > 0 && Object.values(cats).every(isText))) p.push('categories 要是 { 貿易類別 id: 名字 }（至少一種）')
  const catIds = isRecord(cats) ? Object.keys(cats) : Object.keys(DEFAULT_TRADE_CATEGORIES)
  for (const f of ['category_by_tag', 'category_by_category'] as const) {
    if (e[f] === undefined) continue
    const m = e[f]
    if (!(isRecord(m) && Object.values(m).every((v) => isText(v) && catIds.includes(v)))) p.push(`${f} 要是 { 標籤或類別: 貿易類別 id }，貿易類別要在 categories 裡`)
  }
  if (e.category_default !== undefined && !(isText(e.category_default) && catIds.includes(e.category_default))) p.push('category_default 要是 categories 裡的貿易類別 id')
  if (e.market_scale !== undefined && !num(e.market_scale, 0)) p.push('market_scale 要是 0 以上的數字')
  for (const f of ['market_min', 'market_max'] as const) if (e[f] !== undefined && !(num(e[f], 0) && (e[f] as number) > 0)) p.push(`${f} 要是大於 0 的倍率`)
  if (typeof e.market_min === 'number' && typeof e.market_max === 'number' && e.market_min > e.market_max) p.push('market_min 不能比 market_max 大')
  if (e.cargo_ratio !== undefined && !num(e.cargo_ratio, 0, 1)) p.push('cargo_ratio 要是 0～1 的數字')
  for (const f of ['decay_step', 'decay_max'] as const) if (e[f] !== undefined && !num(e[f], 0, 1)) p.push(`${f} 要是 0～1 的數字`)
  if (e.decay_recover !== undefined && !int(e.decay_recover, 0)) p.push('decay_recover 要是 0 以上的整數')
  for (const f of ['bargain_dc', 'bargain_fame_min', 'bargain_tendency_bonus', 'bargain_pressure_hostility'] as const) if (e[f] !== undefined && !(typeof e[f] === 'number' && Number.isSafeInteger(e[f]))) p.push(`${f} 要是整數`)
  if (e.bargain_affinity_step !== undefined && !int(e.bargain_affinity_step, 1)) p.push('bargain_affinity_step 要是 1 以上的整數')
  if (e.bargain_results !== undefined) {
    const r = e.bargain_results
    const keys = ['critical', 'success', 'fail', 'fumble']
    if (!(isRecord(r) && keys.every((d) => isRecord(r[d]) && num((r[d] as Rec).mult, 0.01) && typeof (r[d] as Rec).affinity === 'number' && Number.isSafeInteger((r[d] as Rec).affinity)))) {
      p.push('bargain_results 要有 critical、success、fail、fumble 四項，每項是 { mult: 大於 0 的倍率, affinity: 整數 }')
    }
  }
  return p
}
type Rec = Record<string, unknown>

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
  /** 貨架上固定放的成品：設計圖的 id（要有 stock）；M4-craft */
  fixed_products?: string[]
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
  if (e.fixed_products !== undefined && !idList(e.fixed_products)) p.push('fixed_products 要是設計圖 id 的陣列（組好的成品放在貨架上）')
  return p
}

export const shopEntry = (k: Pick<Kernel, 'content'>, shop: string | ShopEntry): ShopEntry | undefined => (typeof shop === 'string' ? k.content.get<ShopEntry>(SHOP_KIND, shop) : shop)
export const shopTypeOf = (k: Pick<Kernel, 'content'>, shop: ShopEntry): ShopTypeEntry | undefined => k.content.get<ShopTypeEntry>(SHOP_TYPE_KIND, shop.type)

// ---- 物品 ----

export interface TradeItem extends ItemEntry {
  trade_category?: string
  cargo?: boolean
  no_sell?: boolean
}

/** 設計圖的種類對到物品的類別（成品進交易時；貿易類別再照類別推：武器 weapon、護甲 apparel、義體 mech）。 */
const PRODUCT_CATEGORY: Record<string, ItemEntry['category']> = { weapon: 'weapon', armor: 'armor', cyberware: 'part' }

/**
 * 賣一件成品的底價（TRADE 8.3 節：收購成品時只算零件）：每個零件目錄價的合計，二手與品質照核心的係數（USED_PRICE_MULT、QUALITY_PRICE_MULT），
 * 不乘 1.2 與型係數（那是組裝與通路的加價，productPrice 才有）。所以「買零件、組起來、賣掉」不賺錢。
 */
export function productSellBase(k: Pick<Kernel, 'content'>, id: string, data?: unknown): number {
  const info = productOf(k.content, id, data)
  if (!info) return 0
  const d = readProduct(data, k.content)
  const sum = info.parts.reduce((n, p) => n + (typeof p.part.price === 'number' ? p.part.price : 0), 0)
  return Math.round(sum * (d.state === 'used' ? USED_PRICE_MULT : 1) * (QUALITY_PRICE_MULT[d.quality ?? 'standard'] ?? 1) + 1e-9)
}

/**
 * 一件成品（設計圖加零件）當成一個物品：名字、等級、合法性照設計圖與零件裡最嚴的；買的價是 productPrice，賣的價是 productSellBase。
 * data 是背包那一疊的 data；沒給（貨架上）就用設計圖的原廠組合 stock。沒有零件（也沒有 stock）、查不到設計圖是 undefined。
 * 全生體的成品不能賣（TRADE 3.3 節：生體件是活的，只有冷庫收）。
 */
export function productItem(k: Pick<Kernel, 'content'>, id: string, data?: unknown, side: 'buy' | 'sell' = 'buy'): (TradeItem & { price: number }) | undefined {
  const bp = k.content.get<BlueprintEntry>('blueprint', id)
  const info = bp ? productOf(k.content, id, data) : undefined
  if (!bp || !info || info.parts.length === 0) return undefined
  return {
    id, name: bp.name, desc: bp.desc, category: PRODUCT_CATEGORY[bp.kind] ?? 'misc', grade: bp.grade, size: bp.size, weight: info.weight,
    legal: info.legal as ItemEntry['legal'], price: side === 'sell' ? productSellBase(k, id, data) : productPrice(k.content, id, data), tags: ['product', bp.kind],
    ...(info.allBio ? { trade_category: 'bio', no_sell: true } : {}),
  }
}

/** 這個 id 是組裝的成品（有這張設計圖、而且不是一筆物品）。 */
export const isProductId = (k: Pick<Kernel, 'content'>, id: string): boolean => !k.content.has('item', id) && k.content.has('blueprint', id)

/**
 * 單獨一件零件（背包裡帶實例資料的那一疊；M4-part-unreg）當成一個物品：核心的 stackPart 讀得到的（內容的零件帶 data.state、或內嵌的未登錄零件），類別當 part；
 * 目錄價是那個零件的價錢，狀態不是 new 的 ×0.5（二手價；0019 P11、P68）。內嵌的零件不進任何貨架（貨架只從 item 與 fixed_products 來）。
 * 沒有實例資料的零件（data 沒給）不當成物品：行為和原本一樣。
 */
export function partItem(k: Pick<Kernel, 'content'>, id: string, data?: unknown): (TradeItem & { price: number }) | undefined {
  if (!isRecord(data)) return undefined
  const part = stackPart(k.content, { id, qty: 1, data })
  if (!part) return undefined
  return {
    id, name: part.name, desc: typeof part.desc === 'string' ? part.desc : '', category: 'part', grade: part.grade, size: part.size, weight: part.weight, legal: part.legal as ItemEntry['legal'],
    price: Math.round(part.price * (part.state === 'new' ? 1 : USED_PRICE_MULT) + 1e-9), tags: ['part'],
  }
}

/** 物品；組裝的成品（id 是設計圖）、單獨一件零件（帶實例資料）當成一個物品看（side 與 data 決定價錢，見 productItem、partItem）。 */
export const itemOf = (k: Pick<Kernel, 'content'>, id: string, data?: unknown, side: 'buy' | 'sell' = 'buy'): TradeItem | undefined =>
  k.content.get<TradeItem>('item', id) ?? productItem(k, id, data, side) ?? partItem(k, id, data)

/** 同上，賣的時候背包裡那一件（uid）的資料也一起看。 */
export function goodsOf(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'inventory'>, id: string, side: 'buy' | 'sell', uid?: string): TradeItem | undefined {
  return itemOf(k, id, uid !== undefined ? findByUid(state.inventory, id, uid)?.data : undefined, side)
}
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
/** 收購遞減：day 那天累計收了 n 件（之後每天回復 decay_recover 件）。 */
export interface Intake {
  n: number
  day: number
}
/** 今天整車殺過價：倍率（買的乘、賣的除以）、用什麼殺、判定的成功程度。 */
export interface BargainRec {
  day: number
  mult: number
  method: string
  degree: Degree
}
export interface TradeState {
  shops: Record<string, ShopDay>
  intake: Record<string, Record<string, Intake>>
  bargains: Record<string, BargainRec>
  closed: Record<string, number>
}

const DEGREES_ALL: readonly string[] = ['critical', 'success', 'fail', 'fumble']

export const emptyTrade = (): TradeState => ({ shops: {}, intake: {}, bargains: {}, closed: {} })

export function tradeOf(state: Pick<GameState, 'ext'>): TradeState {
  const raw = state.ext[EXT]
  const out = emptyTrade()
  if (!isRecord(raw)) return out
  if (isRecord(raw.shops)) {
    for (const [id, v] of Object.entries(raw.shops)) {
      if (!isRecord(v) || !int(v.day, 0) || !isRecord(v.sold)) continue
      const sold: Record<string, number> = {}
      for (const [item, n] of Object.entries(v.sold)) if (int(n, 1)) sold[item] = n
      out.shops[id] = { day: v.day, sold }
    }
  }
  if (isRecord(raw.intake)) {
    for (const [id, cats] of Object.entries(raw.intake)) {
      if (!isRecord(cats)) continue
      const m: Record<string, Intake> = {}
      for (const [cat, v] of Object.entries(cats)) if (isRecord(v) && int(v.n, 1) && int(v.day, 0)) m[cat] = { n: v.n, day: v.day }
      if (Object.keys(m).length > 0) out.intake[id] = m
    }
  }
  if (isRecord(raw.bargains)) {
    for (const [id, v] of Object.entries(raw.bargains)) {
      if (isRecord(v) && int(v.day, 0) && num(v.mult, 0.01) && typeof v.method === 'string' && DEGREES_ALL.includes(v.degree as string)) {
        out.bargains[id] = { day: v.day, mult: v.mult, method: v.method, degree: v.degree as Degree }
      }
    }
  }
  if (isRecord(raw.closed)) for (const [id, d] of Object.entries(raw.closed)) if (int(d, 0)) out.closed[id] = d
  return out
}

/**
 * 把整份狀態寫回去的那一筆變更：過期的紀錄順手清掉（清單每天重抽；殺價與被趕出去只管當天；收購遞減回復到 0 的拿掉），空的欄位不寫，全空就是 null。
 * 所有改 state.ext.trade 的地方都走這裡，不會互相蓋掉。
 */
export function tradeChange(state: Pick<GameState, 'time'>, trade: TradeState, recover: number): Change {
  const today = state.time.day
  const value: Record<string, unknown> = {}
  const shops = Object.fromEntries(Object.entries(trade.shops).filter(([, v]) => v.day === today))
  const intake: Record<string, Record<string, Intake>> = {}
  for (const [shop, cats] of Object.entries(trade.intake)) {
    const kept = Object.fromEntries(Object.entries(cats).filter(([, v]) => v.n - recover * Math.max(0, today - v.day) > 0))
    if (Object.keys(kept).length > 0) intake[shop] = kept
  }
  const bargains = Object.fromEntries(Object.entries(trade.bargains).filter(([, v]) => v.day >= today))
  const closed = Object.fromEntries(Object.entries(trade.closed).filter(([, d]) => d >= today))
  if (Object.keys(shops).length > 0) value.shops = shops
  if (Object.keys(intake).length > 0) value.intake = intake
  if (Object.keys(bargains).length > 0) value.bargains = bargains
  if (Object.keys(closed).length > 0) value.closed = closed
  return { op: 'ext', key: EXT, value: Object.keys(value).length > 0 ? value : null }
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
  for (const id of entry.fixed_products ?? []) {
    const it = productItem(k, id)
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
  id: 'catalog' | 'shop' | 'district' | 'category' | 'discount' | 'hostility' | 'ratio' | 'sell_district' | 'decay' | 'sell_bonus' | 'bargain'
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

/** 這個敵對值的加價倍率（規則 hostility_markups，取最後一個達到的；沒有達到的是 1）。 */
export function hostilityMarkup(rules: Pick<TradeRules, 'hostility_markups'>, hostility: number): number {
  let mult = 1
  for (const [at, m] of rules.hostility_markups) if (hostility >= at) mult = m
  return mult
}

const districtMult = (k: Pick<Kernel, 'content'>, shop: ShopEntry): number => {
  const m = k.content.get<ContentEntry & { price_mult?: unknown }>('district', shop.district)?.price_mult
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 1
}

// ---- 貿易類別、行情、貨物（TRADE 4.1～4.3） ----

/** 物品屬於哪一個貿易類別：寫了 trade_category 就照寫的；否則先看標籤、再看類別（規則 category_by_tag、category_by_category），都沒對上是 category_default。 */
export function tradeCategoryOf(k: Pick<Kernel, 'content'>, it: TradeItem): string {
  if (typeof it.trade_category === 'string' && it.trade_category) return it.trade_category
  const rules = tradeRules(k)
  for (const t of it.tags ?? []) if (rules.category_by_tag[t]) return rules.category_by_tag[t]!
  return rules.category_by_category[it.category] ?? rules.category_default
}

export const categoryName = (k: Pick<Kernel, 'content'>, id: string): string => tradeRules(k).categories[id] ?? id

/** 貨物（TRADE 4.3）：寫了 cargo: true，或物品的類別就是 cargo。 */
export const isCargo = (it: TradeItem): boolean => it.cargo === true || it.category === 'cargo'

/** 這一區的行情表（沒寫的是空的）：只留貿易類別查得到、倍率是正數的。 */
export function marketOf(k: Pick<Kernel, 'content'>, district: string | undefined): Record<string, number> {
  const raw = district ? k.content.get<ContentEntry & { market?: unknown }>('district', district)?.market : undefined
  const out: Record<string, number> = {}
  if (!isRecord(raw)) return out
  for (const [cat, m] of Object.entries(raw)) if (typeof m === 'number' && Number.isFinite(m) && m > 0) out[cat] = m
  return out
}

/** 一個行情值換成實際的倍率：整體幅度（market_scale）之後夾在 market_min～market_max（預設 0.5～2.5）。 */
export function clampMarket(rules: Pick<TradeRules, 'market_scale' | 'market_min' | 'market_max'>, m: number): number {
  const v = 1 + (m - 1) * rules.market_scale
  return Number(Math.min(rules.market_max, Math.max(rules.market_min, v)).toFixed(6))
}

/** 這一區這個貿易類別的行情倍率（沒寫是 1）。區域狀態（DOWNTIME 第 6 節）M2 沒有，乘 1。 */
export function marketMult(k: Pick<Kernel, 'content'>, district: string | undefined, category: string): number {
  const m = marketOf(k, district)[category]
  return m === undefined ? 1 : clampMarket(tradeRules(k), m)
}

/**
 * 類別的行情（TRADE 4.2）：這間店所在的區、這個物品的貿易類別的行情倍率，夾在 0.5～2.5；買與賣都乘。
 */
export function categoryMult(k: Pick<Kernel, 'content'>, _state: GameState, shop: ShopEntry, item: TradeItem): number {
  return marketMult(k, shop.district, tradeCategoryOf(k, item))
}

// ---- 收購遞減（TRADE 3.2） ----

/** 今天這間店這個貿易類別已經累計收了幾件：記下來的件數，扣掉過了幾天 × 每天回復的件數。 */
export function intakeCount(k: Pick<Kernel, 'content'>, state: GameState, shop: string, category: string): number {
  const rec = tradeOf(state).intake[shop]?.[category]
  if (!rec) return 0
  return Math.max(0, rec.n - tradeRules(k).decay_recover * Math.max(0, state.time.day - rec.day))
}

/** 已經收了 taken 件之後，再收一件的倍率：1 − 每件的折數 × taken，最多折 decay_max。 */
export function decayMult(rules: Pick<TradeRules, 'decay_step' | 'decay_max'>, taken: number): number {
  return Number((1 - Math.min(rules.decay_max, rules.decay_step * Math.max(0, taken))).toFixed(6))
}

// ---- 今天的殺價、被趕出去 ----

/** 今天這間店整車殺過的價；沒殺過是 null。 */
export function bargainToday(state: GameState, shop: string): BargainRec | null {
  const b = tradeOf(state).bargains[shop]
  return b && b.day === state.time.day ? b : null
}

/** 今天因為施壓大失敗被這間店趕出來了嗎。 */
export const closedToday = (state: GameState, shop: string): boolean => tradeOf(state).closed[shop] === state.time.day

export interface QuoteOpts {
  /** 收購：這一車裡同一個貿易類別已經先賣掉幾件（照順序遞減；沒給是 0） */
  taken?: number
  /** 收購：賣的是背包裡帶記號的那一件（成品；data.uid）時指名，價錢才看得到它的零件 */
  uid?: string
}

/**
 * 一個東西在這間店的價錢與拆解（TRADE 3.2）。
 *   買：目錄價 → 店家倍率 → 區倍率 → 類別的行情 → 折扣 → 敵對值的加價 →（今天殺過價才有）殺價的倍率
 *   賣：目錄價 → 收購比例（貨物 90%）→ 收購的區倍率（1 + (區倍率 − 1) × 0.25）→ 類別的行情 →（收過同類才有）收購遞減 → 折扣加成（1 + 折扣 ÷ 2）→（今天殺過價才有）殺價的倍率的倒數
 * 每一步四捨五入。沒有定價的東西、店的種類查不到丟錯（呼叫的人要先確認）。
 * 收購遞減回傳的是「再收一件」的價錢：這間店這個類別已經累計收的件數（含回復）加上 opts.taken。
 */
export function quote(k: Kernel, state: GameState, shop: string | ShopEntry, item: string, side: 'buy' | 'sell', opts: QuoteOpts = {}): Quote {
  const entry = shopEntry(k, shop)
  if (!entry) throw new Error(`沒有 ${String(shop)} 這間店`)
  const type = shopTypeOf(k, entry)
  if (!type) throw new Error(`${entry.id}：查不到店的種類 ${entry.type}`)
  const it = goodsOf(k, state, item, side, opts.uid)
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
  const bargain = bargainToday(state, entry.id)
  if (side === 'buy') {
    push('shop', '店家倍率', type.shop_mult)
    push('district', '區倍率', area)
    push('category', '類別的行情', cat)
    push('discount', '折扣', 1 - discount.total)
    push('hostility', '敵對值的加價', hostilityMarkup(rules, hostilityOf(k, state, entry)))
    if (bargain) push('bargain', '殺價', bargain.mult)
  } else {
    push('ratio', '收購比例', isCargo(it) ? rules.cargo_ratio : rules.buy_ratio)
    push('sell_district', '收購的區倍率', 1 + (area - 1) * rules.sell_area_slope)
    push('category', '類別的行情', cat)
    const decay = decayMult(rules, intakeCount(k, state, entry.id, tradeCategoryOf(k, it)) + Math.max(0, opts.taken ?? 0))
    if (decay < 1) push('decay', '收購遞減', decay)
    push('sell_bonus', '折扣加成', 1 + discount.total / 2)
    if (bargain) push('bargain', '殺價', Number((1 / bargain.mult).toFixed(6)))
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

/** 這一件（帶實例資料的成品或零件，背包裡 data.uid）正穿著、戴著或帶著嗎：同樣讀每個隊員 actor.ext.gear 的 worn／acc／carry，值是 uid。 */
export function wornUid(state: GameState, uid: string): boolean {
  for (const id of new Set<ActorId>([...state.party, ...(state.pc ? [state.pc] : [])])) {
    const gear = state.actors[id]?.ext.gear
    if (!isRecord(gear)) continue
    for (const group of ['worn', 'acc', 'carry'] as const) {
      const slots = gear[group]
      if (isRecord(slots) && Object.values(slots).includes(uid)) return true
    }
  }
  return false
}

/** 主角的身分（actor.ext.identity.class；沒寫就是市民）。 */
export function identityClass(state: GameState): string {
  const raw = state.pc ? state.actors[state.pc]?.ext.identity : undefined
  return isRecord(raw) && typeof raw.class === 'string' ? raw.class : 'citizen'
}
