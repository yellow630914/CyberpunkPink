// L6 裝備：身上的四層怎麼記（actor.ext.gear）、內容的型別，以及讀它們的小工具（EQUIPMENT 第 1～4 節；DATA 7.1、7.2 節）。
// 穿上、帶上之後東西還在背包裡，Gear 只記哪一格放的是哪一件。

import type { ActorId, ContentEntry, GameState, ItemEntry, ItemStack, Kernel } from '../../core'
import { isRecord } from '../../core'

export const OWNER = 'gear'

/** 穿著 10 格（EQUIPMENT 第 2 節）。 */
export const WEAR_SLOTS = ['head', 'face', 'upper', 'lower', 'outer', 'armor', 'hands', 'shoes', 'underwear_top', 'underwear_bottom'] as const
/** 飾品 5 格（EQUIPMENT 第 3 節）：頸、腿、通用 ×3。 */
export const ACCESSORY_SLOTS = ['neck', 'leg', 'any1', 'any2', 'any3'] as const
/** 通用的三格（存檔規則可以多給的部分先不做：dev/adr/0013 D10）。 */
export const GENERIC_ACCESSORY_SLOTS = ['any1', 'any2', 'any3'] as const
/** 攜帶 3 格（EQUIPMENT 第 4 節）。 */
export const CARRY_SLOTS = ['main', 'side', 'melee'] as const
/** 快取格：每個人 2 格，上限 8（EQUIPMENT 4.1 節）。 */
export const QUICK_BASE = 2
export const QUICK_MAX = 8

export type WearSlot = (typeof WEAR_SLOTS)[number]
export type AccessorySlot = (typeof ACCESSORY_SLOTS)[number]
export type CarrySlot = (typeof CARRY_SLOTS)[number]
export type GearGroup = 'worn' | 'acc' | 'carry'

export const GROUP_SLOTS: Record<GearGroup, readonly string[]> = { worn: WEAR_SLOTS, acc: ACCESSORY_SLOTS, carry: CARRY_SLOTS }
/** 攜帶格的名字（給玩家看）。 */
export const CARRY_NAMES: Record<CarrySlot, string> = { main: '主武器', side: '副武器', melee: '近戰' }
export const WEIGHT_CLASSES = ['light', 'medium', 'heavy'] as const
export const BLUEPRINT_KINDS = ['weapon', 'armor'] as const

export interface Gear {
  worn: Partial<Record<WearSlot, string>>
  acc: Partial<Record<AccessorySlot, string>>
  carry: Partial<Record<CarrySlot, string>>
  quick: Array<{ item: string; qty: number }>
  coat: 'open' | 'closed'
}

export interface PartNeed {
  type: string
  grade_min?: number
}

/** 設計圖（DATA 7.1 節）。武器與護甲各有自己的欄位。 */
export interface BlueprintEntry extends ContentEntry {
  kind: (typeof BLUEPRINT_KINDS)[number]
  name: string
  desc: string
  brand: string
  grade: number
  legal: string
  price: number
  size: number
  weight: number
  require: PartNeed[]
  optional: PartNeed[]
  /** 武器：weapon_class 的 id */
  class?: string
  /** 武器：帶在哪一格 */
  carry?: CarrySlot
  /** 護甲：設計圖的基礎（0 或 1）、佔哪幾個穿著格、重量級 */
  armor?: number
  covers?: WearSlot[]
  weight_class?: (typeof WEIGHT_CLASSES)[number]
  /** 藏匿量：身上每一件的 conceal 取最大的那個（短外套 3、長外套 5；佔外套格的那一件敞開時減半） */
  conceal?: number
  /** 藏匿量：加在上面（裝甲制服的內藏槽 +2）；不取最大、敞開外套時也不減半（EQUIPMENT 6.1 節） */
  conceal_add?: number
  quick?: number
}

/** 零件（DATA 7.2 節）。 */
export interface PartEntry extends ContentEntry {
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
}

export function emptyGear(): Gear {
  return { worn: {}, acc: {}, carry: {}, quick: [], coat: 'open' }
}

/** 把存檔裡的東西整理成 Gear：不認得的格、壞掉的資料直接丟掉。回傳全新的物件。 */
export function gearFromRaw(raw: unknown): Gear {
  const g = emptyGear()
  if (!isRecord(raw)) return g
  for (const group of ['worn', 'acc', 'carry'] as const) {
    const src = raw[group]
    if (!isRecord(src)) continue
    for (const slot of GROUP_SLOTS[group]) if (typeof src[slot] === 'string' && src[slot]) (g[group] as Record<string, string>)[slot] = src[slot] as string
  }
  if (Array.isArray(raw.quick)) {
    for (const q of raw.quick) if (isRecord(q) && typeof q.item === 'string' && Number.isSafeInteger(q.qty) && (q.qty as number) > 0) g.quick.push({ item: q.item, qty: q.qty as number })
  }
  if (raw.coat === 'closed') g.coat = 'closed'
  return g
}

/** 一個角色身上的四層。沒穿過東西的人是空的；回傳的是複本，改它不會改到狀態。 */
export function gearOf(state: GameState, actor: ActorId): Gear {
  return gearFromRaw(state.actors[actor]?.ext.gear)
}

/** 一筆「放進或拿掉一格」套在 Gear 上（變更的 apply 與穿脫前的預演共用）。 */
export function setSlot(g: Gear, group: GearGroup, slot: string, item: string | null): void {
  const bag = g[group] as Record<string, string>
  if (item === null) delete bag[slot]
  else bag[slot] = item
}

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const stat = (p: PartEntry, key: string): number => (typeof p.stats?.[key] === 'number' && Number.isFinite(p.stats[key]) ? p.stats[key]! : 0)
export { stat as partStat }

/** 背包裡 data.uid 是這個編號的那一格。 */
export function stackOf(state: GameState, uid: string): ItemStack | undefined {
  return state.inventory.find((s) => s.data?.uid === uid)
}

export function blueprintOf(k: Kernel, stack: ItemStack | undefined): BlueprintEntry | undefined {
  return stack ? k.content.get<BlueprintEntry>('blueprint', stack.id) : undefined
}

export interface PartRef {
  /** 裝在哪一類（parts 的鍵） */
  type: string
  part: PartEntry
}

/** 一件成品裝著的零件（找不到的零件 id 略過）。 */
export function partsOf(k: Kernel, stack: ItemStack): PartRef[] {
  const raw = stack.data?.parts
  if (!isRecord(raw)) return []
  const out: PartRef[] = []
  for (const [type, v] of Object.entries(raw)) {
    for (const id of Array.isArray(v) ? v : [v]) {
      const part = typeof id === 'string' ? k.content.get<PartEntry>('part', id) : undefined
      if (part) out.push({ type, part })
    }
  }
  return out
}

export interface WornPiece {
  uid: string
  stack: ItemStack
  bp: BlueprintEntry
  /** 它佔著的穿著格 */
  slots: WearSlot[]
}

/** 身上穿著的每一件（連身類只算一件；背包裡已經不在的、設計圖不是護甲的略過）。 */
export function wornPieces(k: Kernel, state: GameState, gear: Gear): WornPiece[] {
  const out = new Map<string, WornPiece>()
  for (const slot of WEAR_SLOTS) {
    const uid = gear.worn[slot]
    if (!uid) continue
    const have = out.get(uid)
    if (have) {
      have.slots.push(slot)
      continue
    }
    const stack = stackOf(state, uid)
    const bp = blueprintOf(k, stack)
    if (stack && bp?.kind === 'armor') out.set(uid, { uid, stack, bp, slots: [slot] })
  }
  return [...out.values()]
}

/** 快取格的格數：每個人 2 ＋ 身上每一件設計圖的 quick ＋ 戴著的每一個飾品的 quick，最多 8（EQUIPMENT 4.1 節）。 */
export function quickCapacity(k: Kernel, state: GameState, gear: Gear): number {
  let n = QUICK_BASE
  for (const p of wornPieces(k, state, gear)) n += Math.floor(num(p.bp.quick))
  for (const id of Object.values(gear.acc)) n += Math.floor(num(k.content.get<ItemEntry>('item', id as string)?.quick))
  return Math.min(QUICK_MAX, n)
}

export const sumQty = (list: ReadonlyArray<{ qty: number }>): number => list.reduce((n, q) => n + q.qty, 0)

/** 快取格照順序放，放不下的（超過格數、背包裡不夠的）去掉。 */
export function fitQuick(list: ReadonlyArray<{ item: string; qty: number }>, cap: number, have: (item: string) => number): Array<{ item: string; qty: number }> {
  const out: Array<{ item: string; qty: number }> = []
  const used = new Map<string, number>()
  let room = cap
  for (const e of list) {
    const q = Math.min(e.qty, room, have(e.item) - (used.get(e.item) ?? 0))
    if (q <= 0) continue
    out.push({ item: e.item, qty: q })
    used.set(e.item, (used.get(e.item) ?? 0) + q)
    room -= q
  }
  return out
}
