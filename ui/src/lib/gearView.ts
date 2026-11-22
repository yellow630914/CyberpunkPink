/**
 * 裝備分頁與背包的整理：把引擎的狀態（身上四層、背包、內容）整理成畫面要的列。純函式，只整理與排序。
 * 不判斷能不能穿、不算護甲、不算藏匿量、不算快取格的格數：這些一律由 store 問引擎（stores/engine.ts 的 gear）。
 * 這裡的表只有「名字」「圖標」「分類」這類顯示用的對照。
 */
import type { ItemEntry, ItemStack } from '@engine/src'
import type { BattleWeapon } from '@engine/src'
import type { BlueprintEntry, Gear, PartEntry } from '@engine/src/features/gear'
import { ACCESSORY_SLOTS, CARRY_SLOTS, WEAR_SLOTS } from '@engine/src/features/gear'
import type { Grade } from '../data/types'

/** 物品格要的最小資料（ItemSlot 讀這幾個欄位）。 */
export interface SlotItem {
  id: string
  name: string
  grade: Grade
  icon?: string
  l2?: string
  unique?: boolean
  legality?: string
}

/** 查內容用的介面（store 提供；測試也可以自己給）。 */
export interface GearLookup {
  blueprint(id: string): BlueprintEntry | undefined
  item(id: string): ItemEntry | undefined
  part(id: string): PartEntry | undefined
}

export type GearGroupId = 'worn' | 'acc' | 'carry'

const clampGrade = (n: unknown): Grade => (typeof n === 'number' && n >= 1 && n <= 5 ? (Math.floor(n) as Grade) : 1)

/** 合法性的名字（引擎給的是 free、register、permit、banned）。 */
export const LEGAL_NAMES: Record<string, string> = { free: '自由', register: '登記', permit: '許可', banned: '違禁' }
export const legalName = (legal: string | undefined): string => LEGAL_NAMES[legal ?? ''] ?? '自由'

// ---- 欄位 ----

export interface SlotMeta { name: string; icon: string }
/** 欄位的名字與通用圖標（空格用）。 */
export const SLOT_META: Record<string, SlotMeta> = {
  head: { name: '頭部', icon: 'ic-slot_head' }, face: { name: '面部', icon: 'ic-slot_face' },
  upper: { name: '上身', icon: 'ic-slot_top' }, lower: { name: '下身', icon: 'ic-slot_bottom' },
  outer: { name: '外套', icon: 'ic-slot_coat' }, armor: { name: '護甲', icon: 'ic-slot_armor' },
  hands: { name: '手', icon: 'ic-slot_hands' }, shoes: { name: '鞋', icon: 'ic-slot_shoes' },
  underwear_top: { name: '內衣', icon: 'ic-slot_bra' }, underwear_bottom: { name: '內褲', icon: 'ic-slot_panties' },
  neck: { name: '頸', icon: 'ic-acc_neck' }, leg: { name: '腿', icon: 'ic-acc_leg' },
  any1: { name: '通用', icon: 'ic-acc_ring' }, any2: { name: '通用', icon: 'ic-acc_ring' }, any3: { name: '通用', icon: 'ic-acc_ring' },
  main: { name: '主武器', icon: 'ic-carry_main' }, side: { name: '副武器', icon: 'ic-carry_side' }, melee: { name: '近戰', icon: 'ic-carry_melee' },
}
export const slotName = (slot: string): string => SLOT_META[slot]?.name ?? slot

/**
 * 外套扣上時看不到底下哪幾個穿著格（EQUIPMENT 第 5 節）。暫時放在這裡只為了顯示「被外套蓋住」；
 * 引擎還沒有這張表（回報給 cpp-architect：要的話由引擎給「外套扣上時被蓋住的格子」）。
 */
export const COAT_COVERS: readonly string[] = ['upper', 'armor', 'underwear_top']

export const GROUP_TITLES: Record<GearGroupId, string> = { worn: '穿著', acc: '飾品', carry: '攜帶' }
const GROUP_SLOT_IDS: Record<GearGroupId, readonly string[]> = { worn: WEAR_SLOTS, acc: ACCESSORY_SLOTS, carry: CARRY_SLOTS }

// ---- 物品的樣子 ----

const ACC_ICON: Record<string, string> = { neck: 'ic-acc_neck', leg: 'ic-acc_leg' }

/** 一件東西的第 2 層圖標（引擎的內容沒有第 3 層圖標，退回第 2 層）。 */
function iconOf(kind: string, bp?: BlueprintEntry, item?: ItemEntry): string {
  if (bp?.kind === 'weapon') return SLOT_META[bp.carry ?? '']?.icon ?? 'ic-carry_side'
  if (bp?.kind === 'armor') return SLOT_META[bp.covers?.[0] ?? '']?.icon ?? 'ic-slot_armor'
  if (kind === 'part') return 'ic-part_plate'
  if (kind === 'accessory') {
    const t = item?.tags?.find((x) => x.startsWith('acc:'))?.slice(4) ?? ''
    return ACC_ICON[t] ?? 'ic-acc_ring'
  }
  if (kind === 'cargo') return 'ic-cargo'
  if (kind === 'consumable' || kind === 'ammo') return 'ic-consumable'
  return 'ic-unknown'
}

export type BagFilterId = 'all' | 'gear' | 'cyberware' | 'part' | 'blueprint' | 'consumable' | 'material' | 'cargo' | 'misc'
export const BAG_FILTERS: Array<{ id: BagFilterId; name: string }> = [
  { id: 'all', name: '全部' }, { id: 'gear', name: '裝備' }, { id: 'cyberware', name: '義體' }, { id: 'part', name: '零件' }, { id: 'blueprint', name: '設計圖' },
  { id: 'consumable', name: '消耗品' }, { id: 'material', name: '素材' }, { id: 'cargo', name: '貨物' }, { id: 'misc', name: '雜物' },
]
/** 現在還沒有東西的篩選（M4 之前）。 */
export const EMPTY_FILTERS: readonly BagFilterId[] = ['cyberware', 'material']

const CATEGORY_FILTER: Record<string, BagFilterId> = {
  weapon: 'gear', armor: 'gear', clothing: 'gear', accessory: 'gear', part: 'part', blueprint: 'blueprint',
  consumable: 'consumable', ammo: 'consumable', cargo: 'cargo', tool: 'misc', misc: 'misc',
}
export const CATEGORY_NAMES: Record<string, string> = {
  weapon: '武器', armor: '護甲', clothing: '衣服', accessory: '飾品', part: '零件', blueprint: '設計圖',
  consumable: '消耗品', ammo: '彈藥', cargo: '貨物', tool: '工具', misc: '雜物',
}
export const PART_TYPE_NAMES: Record<string, string> = {
  barrel: '槍管', action: '機構', plate: '板材', fiber: '纖維', blade: '刃', sensor: '感測器', chip: '晶片', actuator: '致動器', power: '電源',
}

/** 背包裡的一格（一疊）整理後的樣子。 */
export interface BagEntry {
  /** 選取用的鍵：組好的成品用 data.uid，其他用物品的 id */
  key: string
  /** 穿脫時交給引擎的編號：組好的成品是 uid，飾品是物品的 id；其他沒有 */
  what: string | null
  stack: ItemStack
  qty: number
  /** 引擎的種類：weapon、armor、accessory、part、blueprint、consumable…… */
  category: string
  filter: BagFilterId
  /** 白話的類別 */
  type: string
  name: string
  grade: Grade
  brand?: string
  legal: string
  size?: number
  /** 武器與護甲：組好的成品 */
  crafted: boolean
  /** 能放進快取格的（消耗品、彈藥、工具） */
  quickable: boolean
  slotItem: SlotItem
}

/** 整理背包裡的一疊。查不到內容的當成雜物（名字用 id）。 */
export function bagEntry(look: GearLookup, stack: ItemStack): BagEntry {
  const uid = typeof stack.data?.uid === 'string' ? stack.data.uid : null
  const bp = uid ? look.blueprint(stack.id) : undefined
  if (bp && uid) {
    const legal = legalName(bp.legal)
    return {
      key: uid, what: uid, stack, qty: stack.qty, category: bp.kind, filter: 'gear', type: CATEGORY_NAMES[bp.kind] ?? bp.kind, name: bp.name, grade: clampGrade(bp.grade), brand: bp.brand, legal, size: bp.size, crafted: true, quickable: false,
      slotItem: { id: uid, name: bp.name, grade: clampGrade(bp.grade), icon: iconOf(bp.kind, bp), legality: legal },
    }
  }
  const item = look.item(stack.id)
  if (item) {
    const legal = legalName(item.legal)
    return {
      key: stack.id, what: item.category === 'accessory' ? stack.id : null, stack, qty: stack.qty, category: item.category, filter: CATEGORY_FILTER[item.category] ?? 'misc', type: CATEGORY_NAMES[item.category] ?? item.category,
      name: item.name, grade: clampGrade(item.grade), legal, size: item.size, crafted: false, quickable: item.category === 'consumable' || item.category === 'ammo' || item.category === 'tool',
      slotItem: { id: stack.id, name: item.name, grade: clampGrade(item.grade), icon: iconOf(item.category, undefined, item), legality: legal },
    }
  }
  const part = look.part(stack.id)
  if (part) {
    const legal = legalName(part.legal)
    return {
      key: stack.id, what: null, stack, qty: stack.qty, category: 'part', filter: 'part', type: `零件・${PART_TYPE_NAMES[part.type] ?? part.type}`, name: part.name, grade: clampGrade(part.grade), brand: part.brand, legal, size: part.size, crafted: false, quickable: false,
      slotItem: { id: stack.id, name: part.name, grade: clampGrade(part.grade), icon: iconOf('part'), legality: legal },
    }
  }
  const sheet = look.blueprint(stack.id)
  if (sheet) {
    const legal = legalName(sheet.legal)
    return {
      key: stack.id, what: null, stack, qty: stack.qty, category: 'blueprint', filter: 'blueprint', type: '設計圖', name: sheet.name, grade: clampGrade(sheet.grade), brand: sheet.brand, legal, size: sheet.size, crafted: false, quickable: false,
      slotItem: { id: stack.id, name: sheet.name, grade: clampGrade(sheet.grade), icon: iconOf('blueprint'), legality: legal },
    }
  }
  return { key: stack.id, what: null, stack, qty: stack.qty, category: 'misc', filter: 'misc', type: '雜物', name: stack.id, grade: 1, legal: '自由', crafted: false, quickable: false, slotItem: { id: stack.id, name: stack.id, grade: 1, icon: 'ic-unknown' } }
}

const byGradeName = (a: BagEntry, b: BagEntry): number => b.grade - a.grade || a.name.localeCompare(b.name, 'zh-Hant') || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** 背包整理成清單：等級高的在前、同級照名字；filter 不是 all 時只留那一類。 */
export function bagEntries(look: GearLookup, inventory: readonly ItemStack[], filter: BagFilterId = 'all'): BagEntry[] {
  return inventory.filter((s) => s.qty > 0).map((s) => bagEntry(look, s)).filter((e) => filter === 'all' || e.filter === filter).sort(byGradeName)
}

/** 成品的組成（零件的類型、名字、等級）。 */
export function compositionOf(look: GearLookup, stack: ItemStack): Array<{ type: string; typeName: string; name: string; grade: Grade }> {
  const raw = stack.data?.parts
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const out: Array<{ type: string; typeName: string; name: string; grade: Grade }> = []
  for (const [type, v] of Object.entries(raw as Record<string, unknown>)) {
    for (const id of Array.isArray(v) ? v : [v]) {
      const part = typeof id === 'string' ? look.part(id) : undefined
      if (part) out.push({ type, typeName: PART_TYPE_NAMES[type] ?? type, name: part.name, grade: clampGrade(part.grade) })
    }
  }
  return out
}

/** 武器給畫面看的數字（照引擎 weaponOf 回的物件）。 */
export function weaponLines(w: BattleWeapon): Array<{ label: string; value: string }> {
  const lines = [
    { label: '命中', value: `${w.hit >= 0 ? '+' : ''}${w.hit}` },
    { label: '骰數', value: `${w.dice}d6${w.flat ? `${w.flat > 0 ? '+' : ''}${w.flat}` : ''}` },
    { label: '射程', value: `${w.range[0]}～${w.range[1]}` },
  ]
  if (w.pierce) lines.push({ label: '穿透', value: String(w.pierce) })
  if (w.mag) lines.push({ label: '彈匣', value: String(w.mag.max) })
  return lines
}

// ---- 裝備分頁 ----

export interface GearCell {
  group: GearGroupId
  slot: string
  label: string
  icon: string
  uid: string | null
  item: SlotItem | null
  /** 外套扣上、這一格被蓋住 */
  covered: boolean
}
export interface GearGroupRow { id: GearGroupId; title: string; cells: GearCell[] }

const stackByUid = (inventory: readonly ItemStack[], uid: string): ItemStack | undefined => inventory.find((s) => s.data?.uid === uid)

/** 身上的一個編號對應的物品格資料：成品用 uid，飾品用物品的 id；找不到是 null。 */
export function carriedItem(look: GearLookup, inventory: readonly ItemStack[], group: GearGroupId, ref: string): BagEntry | null {
  if (group === 'acc') {
    const s = inventory.find((x) => x.id === ref && !x.data?.uid) ?? { id: ref, qty: 1 }
    return look.item(ref) ? bagEntry(look, s) : null
  }
  const stack = stackByUid(inventory, ref)
  return stack ? bagEntry(look, stack) : null
}

export function coveredSlots(gear: Gear): readonly string[] {
  return gear.coat === 'closed' && gear.worn.outer ? COAT_COVERS : []
}

/** 穿著、飾品、攜帶三組格子。連身的衣服佔著的每一格都顯示它。 */
export function gearGroups(look: GearLookup, inventory: readonly ItemStack[], gear: Gear): GearGroupRow[] {
  const covered = coveredSlots(gear)
  return (['worn', 'acc', 'carry'] as const).map((group) => ({
    id: group,
    title: GROUP_TITLES[group],
    cells: GROUP_SLOT_IDS[group].map((slot) => {
      const ref = (gear[group] as Record<string, string | undefined>)[slot] ?? null
      const entry = ref ? carriedItem(look, inventory, group, ref) : null
      return {
        group, slot, label: slotName(slot), icon: SLOT_META[slot]?.icon ?? 'ic-unknown', uid: entry ? ref : null, item: entry?.slotItem ?? null,
        covered: group === 'worn' && !!entry && covered.includes(slot),
      }
    }),
  }))
}

/** 一格有關的候選：背包裡放得進這一格的東西（只看內容上這件東西屬於哪一格；能不能穿、為什麼不能，由呼叫的人去問引擎）。 */
export function slotCandidates(look: GearLookup, inventory: readonly ItemStack[], group: GearGroupId, slot: string): BagEntry[] {
  const out: BagEntry[] = []
  for (const stack of inventory) {
    const e = bagEntry(look, stack)
    if (e.what === null) continue
    if (group === 'acc') {
      if (e.category !== 'accessory') continue
      const tags = look.item(stack.id)?.tags ?? []
      const special = ['neck', 'leg'].find((t) => tags.includes(`acc:${t}`))
      if (slot === 'neck' || slot === 'leg' ? special !== slot : !!special) continue
    } else {
      const bp = look.blueprint(stack.id)
      if (!bp || !e.crafted) continue
      if (group === 'carry' ? !(bp.kind === 'weapon' && bp.carry === slot) : !(bp.kind === 'armor' && bp.covers?.includes(slot as never))) continue
    }
    out.push(e)
  }
  return out.sort(byGradeName)
}

// ---- 快取格 ----

export interface QuickCell { index: number; itemId: string | null; item: SlotItem | null }

/** 快取格一格一件：把「某物 × 幾個」攤開；cap 是引擎給的格數，不夠的補空格。 */
export function quickUnits(gear: Gear): string[] {
  return gear.quick.flatMap((q) => Array.from({ length: q.qty }, () => q.item))
}
export function quickCells(look: GearLookup, gear: Gear, cap: number): QuickCell[] {
  const units = quickUnits(gear)
  const n = Math.max(cap, units.length)
  return Array.from({ length: n }, (_, index) => {
    const itemId = units[index] ?? null
    const entry = itemId ? look.item(itemId) : undefined
    return { index, itemId, item: itemId ? { id: itemId, name: entry?.name ?? itemId, grade: clampGrade(entry?.grade), icon: iconOf(entry?.category ?? 'consumable', undefined, entry), legality: legalName(entry?.legal) } : null }
  })
}

const regroup = (units: string[]): Array<{ item: string; qty: number }> => {
  const order: string[] = []
  const count = new Map<string, number>()
  for (const u of units) {
    if (!count.has(u)) order.push(u)
    count.set(u, (count.get(u) ?? 0) + 1)
  }
  return order.map((item) => ({ item, qty: count.get(item)! }))
}
/** 把 itemId 放進第 index 格（那一格有東西就換掉它，超過現有的就接在最後）。結果交給引擎的 gear.quick。 */
export function quickPut(gear: Gear, index: number, itemId: string): Array<{ item: string; qty: number }> {
  const units = quickUnits(gear)
  if (index < units.length) units[index] = itemId
  else units.push(itemId)
  return regroup(units)
}
/** 清空第 index 格。 */
export function quickClear(gear: Gear, index: number): Array<{ item: string; qty: number }> {
  const units = quickUnits(gear)
  units.splice(index, 1)
  return regroup(units)
}
