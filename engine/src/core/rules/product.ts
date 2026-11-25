// L4 規則核心：成品的三個純函式（dev/adr/0019 第一節；工單 M4-core-product）。
//   productOf     一件成品合起來是什麼：槽裡的零件、缺的必要槽、等級、合法性、牌子、接面、重量、stats 與親和的合計、帶著的怪癖。
//   slotProblems  一個零件放不放得進一個槽（類型、材質、等級、挑剔的設計圖；超規）。
//   productPrice  成品的目錄價（交易、組裝的預覽、安裝費、建角的點數都用這一個數字）。
// 核心不解釋 stats 的鍵：武器與護甲的由 gear 讀、義體的由 cyberware 讀。零件一律經 partOf 讀（內容的 id 與內嵌的零件都收）。
// 規格：CRAFTING 第 4～6 節；ITEMS 1.3、1.4 節；dev/adr/0019 P11、P16。

import type { BlueprintEntry, ContentLookup, FittedPart, PartEntry, PartNeed, PartRef, ProductData, QuirkEntry } from '../content/product'
import { AFFINITY_KEYS, partOf, partTypeName, partsOf, readProduct } from '../content/product'
import { LEGALITIES } from '../content/kinds'
import { clone } from '../util/clone'

/** 成品目錄價＝零件的目錄價合計 × 1.2（組裝與通路）× 型係數（ITEMS 1.4 節）。 */
export const PRODUCT_PRICE_MARKUP = 1.2
/** 二手的成品 ×0.5（dev/adr/0019 P11）。 */
export const USED_PRICE_MULT = 0.5
/** 品質的價錢係數（暫定，M4-core-product 回報；使用者尚未定）：精工 ×1.1、照規格 ×1、帶瑕疵 ×0.8。 */
export const QUALITY_PRICE_MULT: Readonly<Record<string, number>> = { fine: 1.1, standard: 1, flawed: 0.8 }

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const grade = (n: number): string => ROMAN[n] ?? String(n)

/** 一件成品合起來是什麼（productOf 的回傳）。 */
export interface ProductInfo {
  /** 設計圖 */
  bp: BlueprintEntry
  /** 槽裡的零件（type 是裝在哪一類）；查不到的零件略過 */
  parts: FittedPart[]
  /** 缺的必要槽，寫零件類型的名字（一個一格；要兩個缺一個就列一次） */
  missing: string[]
  /** 成品的等級＝設計圖的等級 */
  grade: number
  /** 合法性：設計圖與每個零件裡最嚴的；全生體一律 free */
  legal: string
  /** 牌子：設計圖與每個零件的牌子（不重複）；只有一個就是原廠全套 */
  brands: string[]
  /** 機械接生體的接面：兩種材質都有時是比較少的那一種的件數，否則 0 */
  seams: number
  /** 裝著的零件至少一個，而且全部是生體 */
  allBio: boolean
  /** 設計圖的重量加每個零件的重量（暫定） */
  weight: number
  /** 每個零件的 stats 與 drawback、每個怪癖的 stats、data.bonus，逐鍵相加（合計是 0 的鍵也留著） */
  stats: Record<string, number>
  /** 每個零件的 affinity 逐鍵相加 */
  affinity: Record<string, number>
  /** 帶著的怪癖（data.quirks 與內嵌零件的 quirk，不重複，查不到的略過） */
  quirks: QuirkEntry[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function addInto(to: Record<string, number>, from: unknown): void {
  if (!from || typeof from !== 'object') return
  for (const [k, v] of Object.entries(from as Record<string, unknown>)) {
    if (k === '__proto__' || !isNum(v)) continue
    to[k] = (to[k] ?? 0) + v
  }
}

const legalRank = (legal: unknown): number => {
  const i = (LEGALITIES as readonly unknown[]).indexOf(legal)
  return i < 0 ? 0 : i
}

/** 這個成品實際用的零件資料：沒有 parts（或是空的）而設計圖有 stock 時用 stock。 */
function resolve(content: ContentLookup, bp: BlueprintEntry, data: unknown): ProductData {
  const d = readProduct(data, content)
  if (Object.keys(d.parts).length === 0 && bp.stock) d.parts = clone(bp.stock)
  return d
}

/**
 * 一件成品合起來是什麼。bpId 是設計圖的 id（背包的疊上就是 stack.id），data 是 stack.data 或 ProductData（壞掉的資料會先整理）。
 * 查不到設計圖回 undefined。data 沒有 parts（或是空的）而設計圖有 stock 時，用 stock。
 */
export function productOf(content: ContentLookup, bpId: string, data?: unknown): ProductInfo | undefined {
  const bp = content.get<BlueprintEntry>('blueprint', bpId)
  if (!bp) return undefined
  const d = resolve(content, bp, data)
  const parts = partsOf(content, d)

  const have = new Map<string, number>()
  for (const { type } of parts) have.set(type, (have.get(type) ?? 0) + 1)
  const need = new Map<string, number>()
  for (const n of bp.require ?? []) need.set(n.type, (need.get(n.type) ?? 0) + (n.count ?? 1))
  const missing: string[] = []
  for (const [type, n] of need) for (let i = have.get(type) ?? 0; i < n; i++) missing.push(type)

  const mech = parts.filter((p) => p.part.material === 'mech').length
  const bio = parts.filter((p) => p.part.material === 'bio').length
  const allBio = parts.length > 0 && bio === parts.length

  const quirkIds = [...new Set([...(d.quirks ?? []), ...parts.flatMap((p) => (typeof p.part.quirk === 'string' ? [p.part.quirk] : []))])]
  const quirks = quirkIds.flatMap((id) => {
    const q = content.get<QuirkEntry>('quirk', id)
    return q ? [q] : []
  })

  const stats: Record<string, number> = {}
  for (const { part } of parts) {
    addInto(stats, part.stats)
    addInto(stats, part.drawback)
  }
  for (const q of quirks) addInto(stats, q.stats)
  addInto(stats, d.bonus)

  const affinity: Record<string, number> = {}
  for (const { part } of parts) for (const key of AFFINITY_KEYS) if (isNum(part.affinity?.[key])) affinity[key] = (affinity[key] ?? 0) + part.affinity![key]!

  const legal = allBio ? 'free' : (LEGALITIES[Math.max(legalRank(bp.legal), ...parts.map((p) => legalRank(p.part.legal)))] ?? 'free')

  return {
    bp,
    parts,
    missing,
    grade: bp.grade,
    legal,
    brands: [...new Set([bp.brand, ...parts.map((p) => p.part.brand)])],
    seams: mech > 0 && bio > 0 ? Math.min(mech, bio) : 0,
    allBio,
    weight: (isNum(bp.weight) ? bp.weight : 0) + parts.reduce((n, p) => n + (isNum(p.part.weight) ? p.part.weight : 0), 0),
    stats,
    affinity,
    quirks,
  }
}

/** slotProblems 的回傳：problems 是不能放的原因（一條一句，寫給玩家看）；overspec 是「可以放，但高設計圖一級，是超規」。 */
export interface SlotCheck {
  problems: string[]
  overspec: boolean
}

/**
 * 這個零件放不放得進設計圖的這個槽（type 是槽的零件類型）。ref 是零件的引用（內容的 id 或內嵌的一筆）。
 * 檢查：槽存在、類型、材質、grade_min、等級比設計圖高兩級以上、挑剔的設計圖（picky）牌子不同。
 * 剛好高一級：沒有問題、overspec 是 true（超規要擲檢定，由組裝的功能處理）。有任何問題時 overspec 是 false。
 */
export function slotProblems(content: ContentLookup, bp: BlueprintEntry | string, type: string, ref: PartRef | unknown): SlotCheck {
  const blueprint = typeof bp === 'string' ? content.get<BlueprintEntry>('blueprint', bp) : bp
  if (!blueprint) return { problems: ['找不到這張設計圖。'], overspec: false }
  const slot: PartNeed | undefined = [...(blueprint.require ?? []), ...(blueprint.optional ?? [])].find((n) => n.type === type)
  if (!slot) return { problems: [`這張設計圖沒有${partTypeName(type)}的槽。`], overspec: false }
  const part: PartEntry | undefined = partOf(content, ref)
  if (!part) return { problems: ['找不到這個零件。'], overspec: false }

  const problems: string[] = []
  if (part.type !== type) problems.push(`這個槽要的是${partTypeName(type)}，不是${partTypeName(part.type)}。`)
  const material = slot.material ?? 'any'
  if (material !== 'any' && part.material !== material) problems.push(material === 'mech' ? '這個槽只收機械的零件，生體的放不進去。' : '這個槽只收生體的零件，機械的放不進去。')
  if (slot.grade_min !== undefined && part.grade < slot.grade_min) problems.push(`這個槽的${partTypeName(type)}至少要 ${grade(slot.grade_min)} 級。`)
  if (part.grade >= blueprint.grade + 2) problems.push('比設計圖高兩級以上，塞不進去。')
  if (blueprint.picky?.includes(type) && part.brand !== blueprint.brand) problems.push(`這張設計圖只認自家的${partTypeName(type)}，要先破解。`)
  return { problems, overspec: problems.length === 0 && part.grade === blueprint.grade + 1 }
}

/**
 * 成品的目錄價：零件的 price 合計 × 1.2 × 設計圖的 price_mult（沒寫是 1），四捨五入到整數；
 * 成品 state 是 used 再 ×0.5；quality 是 fine ×1.1、flawed ×0.8（暫定）。沒有零件、查不到設計圖回 0。
 * 設計圖有 stock 而 data 沒有 parts 時用 stock（目錄上的原廠成品）。
 */
export function productPrice(content: ContentLookup, bpId: string, data?: unknown): number {
  const bp = content.get<BlueprintEntry>('blueprint', bpId)
  if (!bp) return 0
  const d = resolve(content, bp, data)
  const parts = partsOf(content, d)
  if (parts.length === 0) return 0
  const sum = parts.reduce((n, p) => n + (isNum(p.part.price) ? p.part.price : 0), 0)
  const mult = isNum(bp.price_mult) && bp.price_mult > 0 ? bp.price_mult : 1
  const used = d.state === 'used' ? USED_PRICE_MULT : 1
  const quality = QUALITY_PRICE_MULT[d.quality ?? 'standard'] ?? 1
  return Math.round(sum * PRODUCT_PRICE_MARKUP * mult * used * quality + 1e-9)
}
