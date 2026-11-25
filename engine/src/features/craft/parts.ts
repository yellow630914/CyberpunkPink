// L6 craft 的零件小工具：拆解與換零件共用（CRAFTING 10.3、10.4 節；dev/adr/0019 第四節與第十七節；dev/work/M4-craft-salvage.md）。
// 一件成品裝著哪些零件、拆下來的零件怎麼回背包：零件的引用一律經核心的 partOf／partStack 讀寫（M4-plan 規定 10：
// 內嵌的零件整筆搬、不改內容；內容的零件回背包是 { state: 'used', uid } 的一疊，和全新的分開放）。

import type { ActorId, BlueprintEntry, Change, GameState, ItemStack, Kernel, PartEntry, PartRef, ProductData } from '../../core'
import { blueprintOf, clone, isRecord, partOf, partStack, readProduct, stackOf } from '../../core'
import { inParty } from './model'

/** 拆下來、換下來的二手零件的 uid 前綴（核心的流水號 seq.uid ＋ 1 起）。有 uid 才能指名那一件（核心的 item 變更只認 uid）。 */
export const USED_PART_UID_PREFIX = 'us'

/** 成品裡的一個零件。part 是 undefined 表示內容查不到（引用還在，零件已經不存在）。 */
export interface Fitted {
  type: string
  /** 同一類裡的第幾個（從 0 起） */
  index: number
  ref: PartRef
  part?: PartEntry
}

/** 這件成品實際裝著的零件，每一類一個陣列：資料沒有 parts（或是空的）而設計圖有 stock 時用 stock（和核心的 productOf 一樣）。 */
export function partsByType(bp: BlueprintEntry, data: ProductData): Record<string, PartRef[]> {
  const raw = Object.keys(data.parts).length === 0 && bp.stock ? clone(bp.stock) : data.parts
  const out: Record<string, PartRef[]> = {}
  for (const [type, v] of Object.entries(raw)) out[type] = (Array.isArray(v) ? v : [v]).map((r) => clone(r))
  return out
}

/** 一個零件一筆，照設計圖槽的順序以外的資料順序（parts 的鍵序）。 */
export function fittedOf(k: Pick<Kernel, 'content'>, bp: BlueprintEntry, data: ProductData): Fitted[] {
  const out: Fitted[] = []
  for (const [type, refs] of Object.entries(partsByType(bp, data))) {
    refs.forEach((ref, index) => {
      const part = partOf(k.content, ref)
      out.push({ type, index, ref, ...(part ? { part } : {}) })
    })
  }
  return out
}

/** 把「類型 → 引用陣列」整理回成品資料的 parts（一個給單一的引用，兩個以上給陣列；空的類型拿掉）。 */
export function toPartsRecord(by: Record<string, PartRef[]>): Record<string, PartRef | PartRef[]> {
  const out: Record<string, PartRef | PartRef[]> = {}
  for (const [type, refs] of Object.entries(by)) if (refs.length > 0) out[type] = refs.length === 1 ? refs[0]! : refs
  return out
}

/** 背包裡 data.uid 是這個編號、而且是這張設計圖的成品的那一疊；不是成品（零件、物品）是 undefined。 */
export function productStack(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'inventory'>, uid: unknown): { stack: ItemStack; bp: BlueprintEntry } | undefined {
  if (typeof uid !== 'string' || uid === '') return undefined
  const stack = stackOf(state, uid)
  const bp = blueprintOf(k.content, stack)
  return stack && bp ? { stack, bp } : undefined
}

/** 這一件（背包裡 data.uid）正穿著、戴著或帶著嗎：讀每個隊員 actor.ext.gear 的 worn／acc／carry（gear 的資料格式，共用的慣例，只認格式、不 import；trade 一樣）。 */
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

/** 動手的人要是主角或隊上的人（沒給預設主角）。 */
export const byOf = (state: GameState, by: ActorId | undefined): ActorId => by ?? state.pc ?? ''
export const byBlock = (state: GameState, by: ActorId): string | null => (inParty(state, by) ? null : '動手的人要是主角或隊上的人。')

/**
 * 一個零件回到背包的變更。內嵌的零件整筆放回（核心的 partStack，不改內容）；內容的零件是 { state: 'used', uid } 的一疊。
 * 生體的零件不回來（拆了就死，CRAFTING 8.1 節）：回傳 undefined。uid 是這一疊的編號（內容的零件才用）。
 */
export function usedPartChange(ref: PartRef, part: PartEntry, uid: string): Change | undefined {
  if (part.material === 'bio') return undefined
  if (typeof ref !== 'string') {
    const s = partStack(ref)
    return { op: 'item', id: s.id, qty: s.qty, ...(s.data ? { data: s.data } : {}) }
  }
  return { op: 'item', id: ref, qty: 1, data: { state: 'used', uid } }
}

/** 內容的零件回背包要用幾個新的 uid（內嵌的與生體的不用）。 */
export const needsUid = (ref: PartRef, part: PartEntry): boolean => typeof ref === 'string' && part.material !== 'bio'

/** 拿到一個成品的資料副本（stack.data 整理過；缺的鍵用預設）。 */
export const dataOf = (k: Pick<Kernel, 'content'>, stack: ItemStack): ProductData => readProduct(stack.data, k.content)
