// L2 內容：設計圖（blueprint）、零件（part）、怪癖（quirk）三種內容的格式，成品的資料（ProductData），
// 與讀寫「零件的引用」的小工具（partOf、stackPart、partStack、partsOf、readProduct）。
// 規格：CRAFTING 第 1～6、14 節；DATA 7.1、7.2、3.4 節；CYBERWARE 第 1、2 節；dev/adr/0019 第一節與第十七節（內嵌的零件）。
// 核心只管格式與「讀得到」：不解釋 stats 的鍵（武器與護甲的由 gear 讀、義體的由 cyberware 讀）；effects 這裡只查是陣列，
// 內容是被動效果（rules/passive.ts），條件種類要等功能都裝上才知道，所以整份的檢查（passiveContentProblems）放在 readyFeatures 的最後。
// 一件成品合起來是什麼（productOf）、放不放得進槽（slotProblems）、價錢（productPrice）在 rules/product.ts。
//
// 零件的引用（PartRef）只有兩種：內容的 id（字串），或內嵌的一筆（InlinePart，未登錄零件用；整筆住在狀態裡）。
// 成品的 parts 與背包裡的零件一律經 partOf／stackPart／partStack 讀寫，不要把 parts 的值直接當成內容的 id 用。

import type { GameState, ItemStack } from '../types'
import { clone } from '../util/clone'
import { isRecord } from '../util/sanitize'
import { LEGALITIES, availableProblems, availableRefs } from './kinds'
import type { ContentEntry, ContentRegistry } from './registry'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const inList = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v)

// ---- 名字與常數 ----

/** 穿著 10 格（EQUIPMENT 第 2 節）。護甲設計圖的 covers 用它。 */
export const WEAR_SLOTS = ['head', 'face', 'upper', 'lower', 'outer', 'armor', 'hands', 'shoes', 'underwear_top', 'underwear_bottom'] as const
/** 攜帶 3 格（EQUIPMENT 第 4 節）。武器設計圖的 carry 用它。 */
export const CARRY_SLOTS = ['main', 'side', 'melee'] as const
export const WEIGHT_CLASSES = ['light', 'medium', 'heavy'] as const
/** 設計圖的種類（DATA 7.1 節；2026-11-24 多了義體）。 */
export const BLUEPRINT_KINDS = ['weapon', 'armor', 'cyberware'] as const
/** 零件的狀態（DATA 7.2 節）。 */
export const PART_STATES = ['new', 'used', 'doujin', 'living'] as const
export const PART_MATERIALS = ['mech', 'bio'] as const
/** 設計圖每個槽收哪種材質（CRAFTING 3.4 節）：any 是兩種都收。 */
export const SLOT_MATERIALS = ['mech', 'bio', 'any'] as const
/** 四類親和與橋的四類容量（CORE_RULES 6.4 節）：現實、內海、社交、媒體。 */
export const AFFINITY_KEYS = ['meat', 'net', 'social', 'media'] as const
/** 義體的部位（CYBERWARE 第 1 節；dev/adr/0019 P1）。arm、leg 裝的時候才分左右。 */
export const CYBER_SLOTS = ['bridge', 'brain', 'eye', 'ear_throat', 'torso', 'skin', 'arm', 'leg', 'intimate'] as const
/** 侵入度（CYBERWARE 第 2 節）：表層、一般、侵入、重度、極限。 */
export const INVASIVENESS = ['surface', 'light', 'invasive', 'heavy', 'extreme'] as const
/** 授權鎖的種類（CYBERWARE 第 5 節）：買斷是沒寫。 */
export const LOCK_KINDS = ['subscription', 'contract'] as const
export const TATTOO_KINDS = ['deco', 'gang'] as const
/** 怪癖的種類：殘響、怪癖、瑕疵、併發症（CRAFTING 第 4 節；CYBERWARE 第 5 節）。 */
export const QUIRK_KINDS = ['echo', 'quirk', 'flaw', 'complication'] as const
/** 怪癖從哪些池抽得到。 */
export const QUIRK_POOLS = ['used', 'doujin', 'flaw', 'complication'] as const
/** 成品的品質（CRAFTING 10.1 節：精工、照規格、帶瑕疵）。 */
export const PRODUCT_QUALITIES = ['fine', 'standard', 'flawed'] as const
/** 背包裡單獨一件內嵌零件的那一疊用的物品 id（stack.data = { uid, part }）。 */
export const UNREG_STACK_ID = 'unreg_part'

/** 十二種零件的名字（CRAFTING 2.1 節；給玩家看的句子用）。類型的 id 不限於這十二個，沒有名字的就寫 id。 */
export const PART_TYPE_NAMES: Readonly<Record<string, string>> = {
  chip: '晶片', neuron: '機械神經元', software: '軟體', plate: '板材', actuator: '致動器', sensor: '感測器',
  power: '電源', skin: '外皮', barrel: '槍管', action: '機構', blade: '刃', fiber: '纖維',
}
export const partTypeName = (type: string): string => PART_TYPE_NAMES[type] ?? type

export type WearSlot = (typeof WEAR_SLOTS)[number]
export type CarrySlot = (typeof CARRY_SLOTS)[number]
export type WeightClass = (typeof WEIGHT_CLASSES)[number]
export type BlueprintKind = (typeof BLUEPRINT_KINDS)[number]
export type PartState = (typeof PART_STATES)[number]
export type SlotMaterial = (typeof SLOT_MATERIALS)[number]
export type AffinityKey = (typeof AFFINITY_KEYS)[number]
export type CyberSlot = (typeof CYBER_SLOTS)[number]
export type Invasiveness = (typeof INVASIVENESS)[number]
export type QuirkKind = (typeof QUIRK_KINDS)[number]
export type ProductQuality = (typeof PRODUCT_QUALITIES)[number]

/** 內容查詢的最小介面（ContentRegistry 的子集）：純函式只要這兩個。 */
export type ContentLookup = Pick<ContentRegistry, 'get' | 'has'>

// ---- 型別 ----

/** 設計圖的一個槽（require 或 optional 的一項）。material 沒寫是 any；count 沒寫是 1（同一種零件要幾個）。 */
export interface PartNeed {
  type: string
  grade_min?: number
  material?: SlotMaterial
  count?: number
}

/** 設計圖（DATA 7.1 節）。武器、護甲、義體各有自己的欄位；三種共通的在最前面。 */
export interface BlueprintEntry extends ContentEntry {
  kind: BlueprintKind
  name: string
  desc: string
  brand: string
  grade: number
  legal: string
  price: number
  /** 義體可以不寫 size 與 weight（沒寫當 0）；武器與護甲一定要寫 */
  size: number
  weight: number
  require: PartNeed[]
  optional: PartNeed[]
  /** 挑剔的設計圖：這幾類零件只認設計圖自己牌子的（CRAFTING 第 6 節） */
  picky?: string[]
  /** 原廠組合：零件類型 → 零件 id 或陣列；目錄上的「一件成品」就是設計圖加它的 stock */
  stock?: Record<string, string | string[]>
  /** 型係數（ITEMS 1.4 節；大於 0，沒寫是 1） */
  price_mult?: number
  /** 武器：weapon_class 的 id */
  class?: string
  /** 武器：帶在哪一格 */
  carry?: CarrySlot
  /** 護甲：設計圖的基礎（0 或 1）、佔哪幾個穿著格、重量級 */
  armor?: number
  covers?: WearSlot[]
  weight_class?: WeightClass
  /** 藏匿量：身上每一件的 conceal 取最大的那個（短外套 3、長外套 5；佔外套格的那一件敞開時減半） */
  conceal?: number
  /** 藏匿量：加在上面（裝甲制服的內藏槽 +2）；不取最大、敞開外套時也不減半（EQUIPMENT 6.1 節） */
  conceal_add?: number
  quick?: number
  /** 義體：部位、侵入度、沉溺成本、要不要橋才能裝（沒寫是 true） */
  slot?: CyberSlot
  invasiveness?: Invasiveness
  sink_cost?: number
  needs_bridge?: boolean
  /** 義體：一直生效的被動效果（內容在 M4-core-passive 檢查，這裡只查是陣列） */
  effects?: Array<Record<string, unknown>>
  /** 義體：戰鬥裡多出來的行動與修正（格式由 cyberware 的戰鬥那一張查，這裡只查是物件） */
  battle?: Record<string, unknown>
  scene_parts?: { adds?: string[]; sensitivity?: Record<string, number> }
  /** 義體：這一件是甲板（數字的意思照 features/deck 的內容種類 deck） */
  deck?: { slots: number; firewall: number; ram?: { max?: number; regen?: number }; cooling?: number }
  /** 義體：這一件是橋 */
  bridge?: { tuning_slots?: number }
  /** 義體：出廠就帶授權鎖（買斷是沒寫） */
  lock?: (typeof LOCK_KINDS)[number]
  upkeep_weekly?: number
  creation_points?: number
  /** 建角買不買得到的限制（出身、勢力）；沒寫不限 */
  available?: { origins?: string[]; faction?: string }
  tattoo?: { kind: (typeof TATTOO_KINDS)[number]; faction?: string }
}

/** 零件的欄位（內容的一筆與內嵌的一筆共用；DATA 7.2 節）。 */
export interface PartBase {
  name: string
  type: string
  material: string
  brand: string
  grade: number
  price: number
  legal: string
  cells: number
  stats: Record<string, number>
  weight: number
  size: number
  state: string
  traits?: string[]
  affinity?: Partial<Record<AffinityKey, number>>
  /** 代價：鍵 → 負的數字，算進 stats 的合計 */
  drawback?: Record<string, number>
  effects?: Array<Record<string, unknown>>
}

/** 零件（內容的一筆）。bridge 是橋的零件才有：晶片的總容量與軟體的配分。 */
export interface PartEntry extends ContentEntry, PartBase {
  bridge?: { capacity?: number; split?: Partial<Record<AffinityKey, number>> }
  // 以下只有內嵌的零件（partOf 從 InlinePart 整理出來的）才有
  unreg?: boolean
  uid?: string
  desc?: string
  quirk?: string
  quirk_text?: string
  from?: string
}

/**
 * 內嵌的零件（未登錄零件；dev/adr/0019 第十七節）：part 的每一個欄位（不含 id、不收 bridge）加上自己的幾個欄位。
 * 它不在內容裡，整筆住在狀態裡；把零件從背包放進成品、從成品拿回背包都是整筆搬，不改它的內容。
 */
export interface InlinePart extends PartBase {
  unreg: true
  uid: string
  desc: string
  /** quirk 的 id（怪癖的數字與效果走內容那一筆） */
  quirk?: string
  /** 怪癖的那一句話（AI 或預設清單寫的） */
  quirk_text?: string
  /** 從哪裡來（來源的標籤，給玩家看） */
  from?: string
}

/** 零件的引用：內容的 id，或內嵌的一筆。 */
export type PartRef = string | InlinePart

/** 怪癖（殘響、怪癖、瑕疵、併發症共用）。 */
export interface QuirkEntry extends ContentEntry {
  name: string
  desc: string
  kind: QuirkKind
  /** 哪幾種設計圖會有；沒寫是都可以 */
  applies?: BlueprintKind[]
  /** 從哪些池抽得到 */
  pool?: Array<(typeof QUIRK_POOLS)[number]>
  stats?: Record<string, number>
  effects?: Array<Record<string, unknown>>
  tags?: string[]
}

/** 一件成品的資料（背包裡的一疊放在 stack.data，身上的一件放在 actor.ext.cyber.pieces[]；兩邊同一個形狀）。stack.id 是設計圖的 id。 */
export interface ProductData {
  uid: string
  /** 槽（零件類型）→ 零件的引用或陣列 */
  parts: Record<string, PartRef | PartRef[]>
  quality?: ProductQuality
  /** 精工多的那一項（逐鍵加進 stats） */
  bonus?: Record<string, number>
  /** quirk 的 id */
  quirks?: string[]
  state?: PartState
  lock?: Record<string, unknown>
  dye?: { primary_color?: string; secondary_color?: string }
}

/** 裝在一件成品上的一個零件。type 是裝在哪一類（parts 的鍵）。 */
export interface FittedPart {
  type: string
  part: PartEntry
}

// ---- 格式檢查 ----

function needList(v: unknown, at: string, p: string[]): void {
  if (!Array.isArray(v)) return void p.push(`${at} 要是 { type } 的陣列`)
  v.forEach((x, i) => {
    if (!isRecord(x) || !isText(x.type)) return void p.push(`${at}[${i}] 要有 type（零件的類型）`)
    if (x.grade_min !== undefined && !(isInt(x.grade_min) && x.grade_min >= 1 && x.grade_min <= 5)) p.push(`${at}[${i}].grade_min 要是 1～5`)
    if (x.material !== undefined && !inList(SLOT_MATERIALS, x.material)) p.push(`${at}[${i}].material 只能是 ${SLOT_MATERIALS.join('、')}`)
    if (x.count !== undefined && !(isInt(x.count) && x.count >= 1)) p.push(`${at}[${i}].count 要是 1 以上的整數`)
  })
}

const needTypes = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (isRecord(x) && isText(x.type) ? [x.type] : [])) : [])

const isIntRecord = (v: unknown, keys?: readonly string[], min?: number): v is Record<string, number> =>
  isRecord(v) && Object.entries(v).every(([k, n]) => isInt(n) && (min === undefined || n >= min) && (!keys || keys.includes(k)))

function cyberwareProblems(e: Record<string, unknown>, p: string[]): void {
  if (!inList(CYBER_SLOTS, e.slot)) p.push(`slot（部位）只能是 ${CYBER_SLOTS.join('、')}`)
  if (!inList(INVASIVENESS, e.invasiveness)) p.push(`invasiveness（侵入度）只能是 ${INVASIVENESS.join('、')}`)
  if (!isInt(e.sink_cost) || e.sink_cost < 0) p.push('sink_cost（沉溺成本）要是 0 以上的整數')
  if (e.needs_bridge !== undefined && typeof e.needs_bridge !== 'boolean') p.push('needs_bridge 要是布林值')
  if (e.effects !== undefined && !Array.isArray(e.effects)) p.push('effects 要是陣列')
  if (e.battle !== undefined && !isRecord(e.battle)) p.push('battle 要是一個物件')
  if (e.scene_parts !== undefined) {
    const s = e.scene_parts
    if (!isRecord(s)) p.push('scene_parts 要是 { adds?, sensitivity? }')
    else {
      if (s.adds !== undefined && !(Array.isArray(s.adds) && s.adds.every(isText))) p.push('scene_parts.adds 要是部位 id 的陣列')
      if (s.sensitivity !== undefined && !isIntRecord(s.sensitivity)) p.push('scene_parts.sensitivity 要是「部位 → 整數」')
    }
  }
  if (e.deck !== undefined) {
    const d = e.deck
    if (!isRecord(d)) p.push('deck 要是 { slots, firewall, ram?, cooling? }')
    else {
      if (!(isInt(d.slots) && d.slots >= 0 && d.slots <= 32)) p.push('deck.slots（構裝槽）要是 0～32 的整數')
      if (!(isInt(d.firewall) && d.firewall >= 0)) p.push('deck.firewall 要是 0 以上的整數')
      if (d.ram !== undefined) {
        if (!isRecord(d.ram)) p.push('deck.ram 要是 { max?, regen? }')
        else for (const f of ['max', 'regen']) if (d.ram[f] !== undefined && !(isInt(d.ram[f]) && (d.ram[f] as number) >= 0)) p.push(`deck.ram.${f} 要是 0 以上的整數`)
      }
      if (d.cooling !== undefined && !(isInt(d.cooling) && d.cooling >= 0)) p.push('deck.cooling 要是 0 以上的整數')
    }
  }
  if (e.bridge !== undefined) {
    if (!isRecord(e.bridge)) p.push('bridge 要是 { tuning_slots? }')
    else if (e.bridge.tuning_slots !== undefined && !(isInt(e.bridge.tuning_slots) && e.bridge.tuning_slots >= 0)) p.push('bridge.tuning_slots 要是 0 以上的整數')
  }
  if (e.lock !== undefined && !inList(LOCK_KINDS, e.lock)) p.push(`lock 只能是 ${LOCK_KINDS.join('、')}（買斷就不要寫）`)
  if (e.upkeep_weekly !== undefined && !(isInt(e.upkeep_weekly) && e.upkeep_weekly >= 0)) p.push('upkeep_weekly 要是 0 以上的整數')
  if (e.creation_points !== undefined && !(isInt(e.creation_points) && e.creation_points >= 0)) p.push('creation_points 要是 0 以上的整數')
  if (e.tattoo !== undefined) {
    const t = e.tattoo
    if (!isRecord(t) || !inList(TATTOO_KINDS, t.kind)) p.push(`tattoo 要是 { kind: ${TATTOO_KINDS.join(' | ')}, faction? }`)
    else if (t.faction !== undefined && !isText(t.faction)) p.push('tattoo.faction 要是勢力的 id')
  }
}

export function blueprintProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const cyber = e.kind === 'cyberware'
  if (!inList(BLUEPRINT_KINDS, e.kind)) p.push(`kind 只能是 ${BLUEPRINT_KINDS.join('、')}`)
  for (const f of ['name', 'desc', 'brand'] as const) if (!isText(e[f])) p.push(`要有 ${f}${f === 'desc' ? '（完整的句子）' : ''}`)
  if (!isInt(e.grade) || e.grade < 1 || e.grade > 5) p.push('grade 要是 1～5')
  if (!inList(LEGALITIES, e.legal)) p.push(`legal 只能是 ${LEGALITIES.join('、')}`)
  if (!isInt(e.price) || e.price < 0) p.push('price 要是 0 以上的整數')
  // 義體可以不寫 size 與 weight（當 0）；寫了就要合格
  if (!(cyber && e.size === undefined) && (!isInt(e.size) || e.size < 0 || e.size > 4)) p.push('size 要是 0～4')
  if (!(cyber && e.weight === undefined) && (!isNum(e.weight) || e.weight < 0)) p.push('weight 要是 0 以上的數字')
  needList(e.require, 'require', p)
  needList(e.optional, 'optional', p)
  if (e.picky !== undefined && !(Array.isArray(e.picky) && e.picky.every(isText))) p.push('picky 要是零件類型的陣列')
  if (e.price_mult !== undefined && !(isNum(e.price_mult) && e.price_mult > 0)) p.push('price_mult（型係數）要是大於 0 的數字')
  if (e.stock !== undefined) {
    if (!isRecord(e.stock)) p.push('stock 要是「零件類型 → 零件 id 或陣列」')
    else {
      const known = new Set([...needTypes(e.require), ...needTypes(e.optional)])
      for (const [type, v] of Object.entries(e.stock)) {
        const ids = Array.isArray(v) ? v : [v]
        if (!ids.length || !ids.every(isText)) p.push(`stock.${type} 要是零件的 id 或 id 的陣列`)
        else if (Array.isArray(e.require) && Array.isArray(e.optional) && !known.has(type)) p.push(`stock.${type}：這張設計圖沒有 ${type} 這個槽`)
      }
    }
  }
  if (e.kind === 'weapon') {
    if (!isText(e.class)) p.push('武器要寫 class（weapon_class 的 id）')
    if (!inList(CARRY_SLOTS, e.carry)) p.push(`carry 只能是 ${CARRY_SLOTS.join('、')}`)
  }
  if (e.kind === 'armor') {
    if (e.armor !== 0 && e.armor !== 1) p.push('armor（設計圖的基礎護甲）要是 0 或 1')
    if (!Array.isArray(e.covers) || !e.covers.length || !e.covers.every((s) => inList(WEAR_SLOTS, s)) || new Set(e.covers).size !== e.covers.length) p.push(`covers 要是至少一個、不重複的穿著格（${WEAR_SLOTS.join('、')}）`)
    if (!inList(WEIGHT_CLASSES, e.weight_class)) p.push(`weight_class 只能是 ${WEIGHT_CLASSES.join('、')}`)
    if (e.conceal !== undefined && !(isInt(e.conceal) && e.conceal >= 0)) p.push('conceal（藏匿量）要是 0 以上的整數')
    if (e.conceal_add !== undefined && !(isInt(e.conceal_add) && e.conceal_add >= 0)) p.push('conceal_add（內藏槽加的藏匿量）要是 0 以上的整數')
    if (e.quick !== undefined && !(isInt(e.quick) && e.quick >= 0)) p.push('quick（多給的快取格）要是 0 以上的整數')
  }
  if (e.available !== undefined) p.push(...availableProblems(e.available))
  if (cyber) cyberwareProblems(e, p)
  return p
}

/** 零件的欄位檢查（內容的一筆與內嵌的一筆共用；沒有 bridge 與內嵌專用的欄位）。 */
function partFieldProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const f of ['name', 'type', 'brand'] as const) if (!isText(e[f])) p.push(`要有 ${f}`)
  if (!inList(PART_MATERIALS, e.material)) p.push(`material 只能是 ${PART_MATERIALS.join('、')}`)
  if (!isInt(e.grade) || e.grade < 1 || e.grade > 5) p.push('grade 要是 1～5')
  if (!isInt(e.price) || e.price < 0) p.push('price 要是 0 以上的整數')
  if (!inList(LEGALITIES, e.legal)) p.push(`legal 只能是 ${LEGALITIES.join('、')}`)
  if (!isInt(e.cells) || e.cells < 0) p.push('cells（份量）要是 0 以上的整數')
  if (!isRecord(e.stats) || !Object.values(e.stats).every(isNum)) p.push('stats 要是「數字的名字 → 數字」')
  if (!isNum(e.weight) || e.weight < 0) p.push('weight 要是 0 以上的數字')
  if (!isInt(e.size) || e.size < 0 || e.size > 4) p.push('size 要是 0～4')
  if (!inList(PART_STATES, e.state)) p.push(`state 只能是 ${PART_STATES.join('、')}`)
  if (e.traits !== undefined && !(Array.isArray(e.traits) && e.traits.every(isText))) p.push('traits 要是字串的陣列')
  if (e.affinity !== undefined && !isIntRecord(e.affinity, AFFINITY_KEYS)) p.push(`affinity 要是「${AFFINITY_KEYS.join('、')} → 整數」`)
  if (e.drawback !== undefined && !(isRecord(e.drawback) && Object.values(e.drawback).every((n) => isNum(n) && n < 0))) p.push('drawback 要是「數字的名字 → 負的數字」')
  if (e.effects !== undefined && !Array.isArray(e.effects)) p.push('effects 要是陣列')
  return p
}

export function partProblems(e: Record<string, unknown>): string[] {
  const p = partFieldProblems(e)
  if (e.bridge !== undefined) {
    const b = e.bridge
    if (!isRecord(b)) p.push('bridge 要是 { capacity?, split? }')
    else {
      if (b.capacity !== undefined && !isInt(b.capacity)) p.push('bridge.capacity 要是整數')
      if (b.split !== undefined && !isIntRecord(b.split, AFFINITY_KEYS, 0)) p.push(`bridge.split 要是「${AFFINITY_KEYS.join('、')} → 0 以上的整數」`)
    }
  }
  return p
}

export function quirkProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.desc)) p.push('要有 desc（完整的句子）')
  if (!inList(QUIRK_KINDS, e.kind)) p.push(`kind 只能是 ${QUIRK_KINDS.join('、')}`)
  if (e.applies !== undefined && !(Array.isArray(e.applies) && e.applies.length > 0 && e.applies.every((x) => inList(BLUEPRINT_KINDS, x)))) p.push(`applies 要是至少一個的陣列，每一項是 ${BLUEPRINT_KINDS.join('、')} 之一`)
  if (e.pool !== undefined && !(Array.isArray(e.pool) && e.pool.every((x) => inList(QUIRK_POOLS, x)))) p.push(`pool 要是陣列，每一項是 ${QUIRK_POOLS.join('、')} 之一`)
  if (e.stats !== undefined && !(isRecord(e.stats) && Object.values(e.stats).every(isNum))) p.push('stats 要是「數字的名字 → 數字」')
  if (e.effects !== undefined && !Array.isArray(e.effects)) p.push('effects 要是陣列')
  if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(isText))) p.push('tags 要是字串的陣列')
  return p
}

/** 建 kernel 時註冊三種內容（blueprint、part、quirk；owner 是 core）。 */
export function registerProductKinds(content: ContentRegistry): void {
  content.defineKind<BlueprintEntry>({
    kind: 'blueprint', owner: 'core',
    validate: blueprintProblems,
    refs: (e) => [
      ...(e.kind === 'weapon' && e.class ? [['weapon_class', e.class] as [string, string]] : []),
      ...Object.values(e.stock ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]).map((id): [string, string] => ['part', id])),
      ...(e.tattoo?.faction ? [['faction', e.tattoo.faction] as [string, string]] : []),
      ...availableRefs(e.available),
    ],
  })
  content.defineKind<PartEntry>({ kind: 'part', owner: 'core', validate: partProblems })
  content.defineKind<QuirkEntry>({ kind: 'quirk', owner: 'core', validate: quirkProblems })
}

// ---- 內嵌的零件 ----

/** 內嵌零件留下的欄位（readProduct 與 partOf 照它挑；id 與 bridge 不收）。 */
const INLINE_KEYS = ['name', 'type', 'material', 'brand', 'grade', 'price', 'legal', 'cells', 'stats', 'weight', 'size', 'state', 'traits', 'affinity', 'drawback', 'effects', 'unreg', 'uid', 'desc', 'quirk', 'quirk_text', 'from'] as const

/**
 * 一筆內嵌零件的格式檢查：part 的欄位，加上 unreg 是 true、uid 與 desc 是字串、quirk 有寫就要查得到（content 沒給就不查）、不能有 bridge。
 * 回傳問題的清單（空的就是合格）。
 */
export function inlinePartProblems(content: ContentLookup | undefined, raw: unknown): string[] {
  if (!isRecord(raw)) return ['內嵌的零件要是一個物件']
  const p = partFieldProblems(raw)
  if (raw.unreg !== true) p.push('unreg 要是 true')
  if (!isText(raw.uid)) p.push('要有 uid（字串）')
  if (typeof raw.desc !== 'string') p.push('desc 要是字串')
  if (raw.quirk !== undefined) {
    if (!isText(raw.quirk)) p.push('quirk 要是 quirk 的 id')
    else if (content && !content.has('quirk', raw.quirk)) p.push(`quirk ${raw.quirk} 查不到`)
  }
  if (raw.quirk_text !== undefined && typeof raw.quirk_text !== 'string') p.push('quirk_text 要是字串')
  if (raw.from !== undefined && typeof raw.from !== 'string') p.push('from 要是字串')
  if (raw.bridge !== undefined) p.push('內嵌的零件不能帶 bridge（橋的晶片總容量與軟體的配分不開放）')
  return p
}

/** 只留內嵌零件認得的欄位，深複製（不改傳進來的東西）。 */
function pickInline(raw: Record<string, unknown>): InlinePart {
  const out: Record<string, unknown> = {}
  for (const key of INLINE_KEYS) if (raw[key] !== undefined) out[key] = clone(raw[key])
  return out as unknown as InlinePart
}

/**
 * 一個零件的引用是哪個零件：字串查內容；內嵌的整理成 PartEntry 的樣子（id 是 `unreg:<uid>`，回傳的是複本）；
 * 查不到、不合格的回 undefined。零件的引用只經這一個函式讀。
 * 注意：內容的零件回傳的是登錄表裡的那一筆本身，不要改它。
 */
export function partOf(content: ContentLookup, ref: unknown): PartEntry | undefined {
  if (typeof ref === 'string') return content.get<PartEntry>('part', ref)
  if (!isRecord(ref) || inlinePartProblems(content, ref).length > 0) return undefined
  const part = pickInline(ref)
  return { ...part, id: `unreg:${part.uid}` } as unknown as PartEntry
}

/**
 * 背包的這一疊是哪個零件：data.part 是合格的內嵌零件就是它；否則照 stack.id 查內容，
 * 疊上帶 data.state（拆下來的二手件、同人件）的，回傳的零件狀態換成它。都不是回 undefined。
 */
export function stackPart(content: ContentLookup, stack: ItemStack | undefined): PartEntry | undefined {
  if (!stack) return undefined
  const inline = stack.data?.part
  if (isRecord(inline)) {
    const p = partOf(content, inline)
    if (p) return p
  }
  const base = content.get<PartEntry>('part', stack.id)
  if (!base) return undefined
  const state = stack.data?.state
  return inList(PART_STATES, state) && state !== base.state ? { ...base, state: state as string } : base
}

/** 把一個零件的引用變成要放回背包的那一疊：字串是 { id, qty: 1 }；內嵌的是 { id: UNREG_STACK_ID, qty: 1, data: { uid, part } }（整筆複製）。 */
export function partStack(ref: PartRef): ItemStack {
  if (typeof ref === 'string') return { id: ref, qty: 1 }
  return { id: UNREG_STACK_ID, qty: 1, data: { uid: ref.uid, part: clone(ref) } }
}

// ---- 成品的資料 ----

const unsafeKey = (k: string): boolean => k === '__proto__'

function readRef(v: unknown, content: ContentLookup | undefined): PartRef | undefined {
  if (typeof v === 'string') return v.length > 0 ? v : undefined
  if (isRecord(v) && inlinePartProblems(content, v).length === 0) return pickInline(v)
  return undefined
}

function numRecord(v: unknown): Record<string, number> | undefined {
  if (!isRecord(v)) return undefined
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v)) if (!unsafeKey(k) && isNum(n)) out[k] = n
  return out
}

/**
 * 把存檔或背包裡的成品資料整理成合格的 ProductData：不認得的鍵丟掉，壞掉的值丟掉（零件不是字串也不是合格的內嵌零件、
 * quirks 混了數字……），不丟錯。回傳全新的物件，不改傳進來的東西。沒有 uid 的當 ''。
 * content 有給時，內嵌零件的 quirk 也要查得到才留下；沒給只查格式（查不到的零件 id 與 quirk 之後由 partOf 略過）。
 */
export function readProduct(raw: unknown, content?: ContentLookup): ProductData {
  const r = isRecord(raw) ? raw : {}
  const out: ProductData = { uid: typeof r.uid === 'string' ? r.uid : '', parts: {} }
  if (isRecord(r.parts)) {
    for (const [type, v] of Object.entries(r.parts)) {
      if (!type || unsafeKey(type)) continue
      if (Array.isArray(v)) {
        const refs = v.map((x) => readRef(x, content)).filter((x): x is PartRef => x !== undefined)
        if (refs.length > 0) out.parts[type] = refs
      } else {
        const ref = readRef(v, content)
        if (ref !== undefined) out.parts[type] = ref
      }
    }
  }
  if (inList(PRODUCT_QUALITIES, r.quality)) out.quality = r.quality as ProductQuality
  const bonus = numRecord(r.bonus)
  if (bonus && Object.keys(bonus).length > 0) out.bonus = bonus
  if (Array.isArray(r.quirks)) {
    const ids = [...new Set(r.quirks.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length > 0) out.quirks = ids
  }
  if (inList(PART_STATES, r.state)) out.state = r.state as PartState
  if (isRecord(r.lock)) out.lock = clone(r.lock)
  if (isRecord(r.dye)) {
    const dye: { primary_color?: string; secondary_color?: string } = {}
    if (isText(r.dye.primary_color)) dye.primary_color = r.dye.primary_color
    if (isText(r.dye.secondary_color)) dye.secondary_color = r.dye.secondary_color
    if (Object.keys(dye).length > 0) out.dye = dye
  }
  return out
}

/** 一件成品裝著的零件（查不到、不合格的略過；parts 不是物件就是沒有零件）。data 是 stack.data 或 ProductData。 */
export function partsOf(content: ContentLookup, data: unknown): FittedPart[] {
  const raw = isRecord(data) ? data.parts : undefined
  if (!isRecord(raw)) return []
  const out: FittedPart[] = []
  for (const [type, v] of Object.entries(raw)) {
    for (const ref of Array.isArray(v) ? v : [v]) {
      const part = partOf(content, ref)
      if (part) out.push({ type, part })
    }
  }
  return out
}

/** 背包裡 data.uid 是這個編號的那一格。 */
export function stackOf(state: Pick<GameState, 'inventory'>, uid: string): ItemStack | undefined {
  return state.inventory.find((s) => s.data?.uid === uid)
}

/** 這一疊的設計圖（stack.id 是設計圖的 id）。 */
export function blueprintOf(content: ContentLookup, stack: ItemStack | undefined): BlueprintEntry | undefined {
  return stack ? content.get<BlueprintEntry>('blueprint', stack.id) : undefined
}
