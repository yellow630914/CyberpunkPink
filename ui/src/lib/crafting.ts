import type { Grade, ItemDef, PartType } from '../data/types'

/**
 * 組裝（CRAFTING 第 3、4、6、10 節）：設計圖的槽、零件能不能裝、難度與預覽。純函式。
 * 引擎做好之後，預覽改由 assemblyPreview(blueprint, parts, who) 給（UI 第 9 節），這裡是它的參考做法。
 */
export type SlotMaterial = '機' | '生' | '皆'
export interface BlueprintSlot { id: string; type: PartType; required: boolean; material: SlotMaterial; label?: string }
export interface Blueprint {
  /** 設計圖的物品 id（bp_…） */
  item: string
  /** 成品的物品 id */
  product: string
  /** 成品的種類：義體用義體學，武器與護甲用機械（CRAFTING 10.1 節） */
  family: '義體' | '武器' | '護甲' | '服裝'
  grade: Grade
  brand: string
  slots: BlueprintSlot[]
  /** 成品的基礎數值（沒裝選配時） */
  base: Array<[string, number | string]>
  /** 原廠全套的加成 */
  setBonus?: string
  /** 挑剔的設計圖：只認自家這幾類零件 */
  picky?: PartType[]
}

/** 標準 DC 照等級（BALANCE 2.12 節）：I 10、II 13、III 16、IV 19、V 22。 */
export const STANDARD_DC: Record<Grade, number> = { 1: 10, 2: 13, 3: 16, 4: 19, 5: 22 }
export const OVERSPEC_DC = 3

export interface SlotCheck { ok: boolean; reason?: string; overspec?: boolean }

/** 一個零件能不能放進這個槽。不收的回傳原因（畫面上直接寫），超規的回傳 overspec。 */
export function checkSlot(bp: Blueprint, slot: BlueprintSlot, part: ItemDef): SlotCheck {
  if (!part.part) return { ok: false, reason: '這不是零件。' }
  if (part.part.type !== slot.type) return { ok: false, reason: `這個槽只收${slot.type}。` }
  if (slot.material !== '皆' && part.part.material !== slot.material) return { ok: false, reason: `這個槽只收${slot.material === '機' ? '機械' : '生體'}。` }
  if (bp.picky?.includes(slot.type) && part.brand !== bp.brand) return { ok: false, reason: `這張設計圖只認${bp.brand}的${slot.type}，要先破解。` }
  if (part.grade > bp.grade + 1) return { ok: false, reason: `比設計圖高兩級以上，塞不進去。` }
  if (part.grade > bp.grade) return { ok: true, overspec: true }
  return { ok: true }
}

export type Fill = Record<string, ItemDef | null | undefined>

export interface AssemblyCheck {
  ok: boolean
  /** 缺的必要槽 */
  missing: string[]
  /** 放錯的槽：槽 id → 原因 */
  bad: Record<string, string>
  brands: number
  interfaces: number
  overspec: number
  dc: number
  dcParts: Array<[string, number]>
  legality: ItemDef['legality']
  fullSet: boolean
}

const LEGAL_ORDER: ItemDef['legality'][] = ['自由', '登記', '許可', '違禁']

/** 整張設計圖的檢查與難度：難度＝等級的標準 DC ＋（牌子數 − 1）＋ 機械接生體的接面數 ＋ 超規 3／件。 */
export function checkAssembly(bp: Blueprint, fill: Fill, bpLegality: ItemDef['legality'] = '自由'): AssemblyCheck {
  const missing: string[] = []
  const bad: Record<string, string> = {}
  const parts: ItemDef[] = []
  let overspec = 0
  for (const s of bp.slots) {
    const p = fill[s.id]
    if (!p) { if (s.required) missing.push(s.label ?? s.type); continue }
    const c = checkSlot(bp, s, p)
    if (!c.ok) { bad[s.id] = c.reason!; continue }
    if (c.overspec) overspec++
    parts.push(p)
  }
  const brandSet = new Set([bp.brand, ...parts.map(p => p.brand)])
  const brands = brandSet.size
  const mats = new Set(parts.map(p => p.part!.material))
  // 機械與生體混裝：每一件和多數材質不同的零件算一個接面
  const nBio = parts.filter(p => p.part!.material === '生').length
  const interfaces = mats.size > 1 ? Math.min(nBio, parts.length - nBio) : 0
  const dcParts: Array<[string, number]> = [[`${['', 'I', 'II', 'III', 'IV', 'V'][bp.grade]} 級`, STANDARD_DC[bp.grade]]]
  if (brands > 1) dcParts.push(['牌子', brands - 1])
  if (interfaces) dcParts.push(['接面', interfaces])
  if (overspec) dcParts.push(['超規', overspec * OVERSPEC_DC])
  const dc = Math.min(25, dcParts.reduce((s, [, v]) => s + v, 0))
  let legality = bpLegality
  for (const p of parts) if (LEGAL_ORDER.indexOf(p.legality) > LEGAL_ORDER.indexOf(legality)) legality = p.legality
  return {
    ok: !missing.length && !Object.keys(bad).length, missing, bad, brands, interfaces, overspec, dc, dcParts, legality,
    fullSet: brands === 1 && parts.length > 0 && bp.slots.filter(s => s.required).every(s => fill[s.id]),
  }
}

/** 成功率：1d20 ＋ 加值 ≥ DC（自然 20 一定成功、自然 1 一定失敗）。 */
export function successChance(mod: number, dc: number): number {
  const need = dc - mod
  const n = Math.max(1, Math.min(19, 21 - need))
  return Math.round((n / 20) * 100)
}

/** 誰來做（CRAFTING 10.1 節）：自己或夥伴擲技術；店家穩定成功、收工錢、不做超規；同人社團願意超規。 */
export interface Crafter { id: string; name: string; skill?: number; fee: number; hours: number; quality?: string; noOverspec?: boolean; fullSetOnly?: boolean }

export function crafterBlock(c: Crafter, a: AssemblyCheck): string | null {
  if (c.noOverspec && a.overspec) return `${c.name}不做超規。`
  if (c.fullSetOnly && !a.fullSet) return `${c.name}只裝原廠全套。`
  return null
}
