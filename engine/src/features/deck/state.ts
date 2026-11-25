// L6 功能 deck：算出一個角色現在的甲板（deckOf）：哪一副（租的蓋過自己的）、等級、防火牆、槽數、用掉幾槽、裝著的每一件，
// 以及帶著的腳本。資料壞掉（uid 指到不存在的那一疊、slots 不是陣列）時讀成沒有甲板或空的槽，不丟錯。
// 槽的規則：能用的槽 ＝ deck_slots − deck_slots_reserved；裝著的東西照槽的順序算，一件一件加上去、加到放不下為止，後面的不算
// （租來的甲板槽比較少、被招牌能力佔掉槽的時候都是這樣；裝著的清單本身不變，槽回來了就又算進去）。

import type { ContentEntry, GameState, ItemEntry, Kernel } from '../../core'
import { countItem, findByUid, isRecord } from '../../core'
import type { ConstructEntry, DeckEntry, DeckRules, DeckSource, ScriptEntry } from './model'
import { CONSTRUCT_KIND, DECK_KIND, SCRIPT_TAG, QUICKHACK_KIND, SKIN_KIND, deckRules, extOf } from './model'

export type PieceKind = 'construct' | 'quickhack'

/** 裝在槽裡的一件（已經確認背包裡有、內容查得到）。 */
export interface Piece {
  /** 物品與內容的 id */
  id: string
  kind: PieceKind
  name: string
  /** 構裝的種類（快駭程式沒有） */
  class?: string
  /** 資料上的等級（快駭程式是它有的最高一級） */
  grade: number
  /** 實際照哪一級算（資料不夾等級時就是 grade；快駭程式的實際等級由 features/hack 依甲板與主控決定，這裡寫甲板的等級夾過的數字） */
  runsAt: number
  /** 佔幾個槽 */
  size: number
}

export interface RawDeck {
  /** 租的、背包裡裝上的（M3；沒有人掛 deck.source 時才有）、還是腦部的義體（implant） */
  source: 'rental' | 'own' | 'implant'
  entry: DeckEntry
  /** 自己那一副在背包裡的編號，或腦部那一件的編號（租的沒有） */
  uid?: string
}

export interface DeckInfo {
  /** 有沒有甲板 */
  has: boolean
  source: 'rental' | 'own' | 'implant' | null
  /** 甲板的內容 id（沒有甲板是 null） */
  deck: string | null
  name: string | null
  uid?: string
  grade: number
  firewall: number
  /** 甲板的槽數（deck_slots，含技能的加成；沒有甲板是 0） */
  slotsTotal: number
  /** 被招牌能力的專屬構裝佔掉的槽（deck_slots_reserved） */
  reserved: number
  /** 能用的槽 ＝ 槽數 − 被佔掉的（最少 0） */
  capacity: number
  /** 用掉幾槽（只算實際生效的那幾件） */
  used: number
  /** 還剩幾槽 */
  free: number
  /** 實際生效的每一件，照槽的順序 */
  equipped: Piece[]
  /** 記在槽上、但現在沒有生效的 id（槽放不下、背包裡已經沒有、查不到內容） */
  inactive: string[]
  /** 腳本：最多帶幾支、現在帶的（已經照背包夠不夠與上限整理過） */
  scriptLimit: number
  scripts: ScriptEntry[]
  /** 穿著的 SKIN（背包裡有、內容查得到才算） */
  skin: string | null
}

const held = (state: GameState, id: string): boolean => countItem(state.inventory, id) >= 1

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** 掛點 deck.source 的第一個回答，整理成一筆 DeckEntry 的樣子（資料壞掉的欄位當 0）；沒有回答、或不像一副甲板是 null。 */
function implantOf(k: Pick<Kernel, 'hooks'>, state: GameState, actor: string): { entry: DeckEntry; uid: string; ready: boolean } | null {
  const first = k.hooks.run('deck.source', { state, actor })[0]?.result as DeckSource | undefined
  if (!isRecord(first) || typeof first.uid !== 'string' || !first.uid || typeof first.name !== 'string') return null
  const ram = isRecord(first.ram) ? { ...(num(first.ram.max) ? { max: num(first.ram.max) } : {}), ...(num(first.ram.regen) ? { regen: num(first.ram.regen) } : {}) } : {}
  const entry: DeckEntry = {
    id: typeof first.id === 'string' && first.id ? first.id : first.uid, name: first.name, desc: '', grade: num(first.grade), slots: num(first.slots), firewall: num(first.firewall),
    ...(Object.keys(ram).length ? { ram } : {}), ...(num(first.cooling) ? { cooling: num(first.cooling) } : {}), legal: 'free',
  }
  return { entry, uid: first.uid, ready: first.ready === true }
}

/**
 * 這個角色用的那一副甲板的內容（還沒算槽數）。順序：租來的 → 腦部的義體（掛點 deck.source 的回答）→ 背包裡 ext.deck.uid 那一副（M3；只在沒有人掛 deck.source 時，
 * 留給不裝義體功能的局）。租的內容查不到就當沒有租；背包裡那一副要真的在背包裡；腦部的義體還在休養（ready 是 false）就當沒有甲板，不退到背包那一副。
 */
export function rawDeck(k: Pick<Kernel, 'content' | 'hooks'>, state: GameState, actor: string): RawDeck | null {
  if (!state.actors[actor]) return null
  const ext = extOf(state, actor)
  if (ext.rental) {
    const entry = k.content.get<DeckEntry>(DECK_KIND, ext.rental.deck)
    if (entry) return { source: 'rental', entry }
  }
  if (k.hooks.owners('deck.source').length > 0) {
    const implant = implantOf(k, state, actor)
    return implant && implant.ready ? { source: 'implant', entry: implant.entry, uid: implant.uid } : null
  }
  if (ext.uid !== undefined) {
    const stack = state.inventory.find((s) => s.data?.uid === ext.uid && k.content.has(DECK_KIND, s.id))
    const entry = stack ? k.content.get<DeckEntry>(DECK_KIND, stack.id) : undefined
    if (entry) return { source: 'own', entry, uid: ext.uid }
  }
  return null
}

/** 一件東西的種類：構裝、快駭程式，都不是回傳 null（沒有人定義 quickhack 這個種類時快駭程式不收）。 */
export function pieceKind(k: Pick<Kernel, 'content'>, id: string): PieceKind | null {
  if (k.content.has(CONSTRUCT_KIND, id)) return 'construct'
  if (k.content.hasKind(QUICKHACK_KIND) && k.content.has(QUICKHACK_KIND, id)) return 'quickhack'
  return null
}

/** 構裝等級實際照幾級算：資料可以要求夾在甲板的等級（規則 cap_construct_grade）。 */
export const constructRunsAt = (rules: DeckRules, grade: number, deckGrade: number): number => (rules.cap_construct_grade ? Math.min(grade, deckGrade) : grade)

/** 描述一件東西（背包裡有沒有不看）：給 deckView 與生效的清單用。找不到內容回傳 null。 */
export function describePiece(k: Pick<Kernel, 'content'>, id: string, deckGrade: number, rules: DeckRules): Piece | null {
  const kind = pieceKind(k, id)
  if (kind === 'construct') {
    const e = k.content.require<ConstructEntry>(CONSTRUCT_KIND, id)
    return { id, kind, name: e.name, class: e.class, grade: e.grade, runsAt: constructRunsAt(rules, e.grade, deckGrade), size: e.slots ?? 1 }
  }
  if (kind === 'quickhack') {
    const e = k.content.require<ContentEntry & { name?: unknown; grades?: unknown }>(QUICKHACK_KIND, id)
    const grades = Array.isArray(e.grades) ? e.grades.filter((g): g is number => typeof g === 'number') : []
    const top = grades.length ? Math.max(...grades) : 1
    return { id, kind, name: typeof e.name === 'string' ? e.name : id, grade: top, runsAt: Math.min(top, deckGrade), size: 1 }
  }
  return null
}

/** 腳本：帶 script 標籤的道具。 */
export const isScript = (k: Pick<Kernel, 'content'>, item: string): boolean => !!k.content.get<ItemEntry>('item', item)?.tags?.includes(SCRIPT_TAG)

/** 把一份腳本清單整理成現在帶得了的：合併同一種、拿掉不是腳本的與背包裡沒有的、照順序加到上限為止。 */
export function fitScripts(k: Pick<Kernel, 'content'>, state: GameState, list: readonly ScriptEntry[], limit: number): ScriptEntry[] {
  const out: ScriptEntry[] = []
  let room = limit
  for (const s of list) {
    if (room <= 0) break
    if (!isScript(k, s.item)) continue
    const have = countItem(state.inventory, s.item) - (out.find((x) => x.item === s.item)?.qty ?? 0)
    const q = Math.min(s.qty, room, have)
    if (q <= 0) continue
    const found = out.find((x) => x.item === s.item)
    if (found) found.qty += q
    else out.push({ item: s.item, qty: q })
    room -= q
  }
  return out
}

const stat = (k: Kernel, state: GameState, actor: string, id: string): number => (k.stats.hasStat(id) ? k.stats.stat(state, actor, id) : 0)

/** 槽裡實際生效的東西（照順序累加，放不下就停）。沒有甲板時沒有槽。 */
export function activeSlots(k: Kernel, state: GameState, actor: string, capacity: number, deckGrade: number): { equipped: Piece[]; inactive: string[]; used: number } {
  const rules = deckRules(k)
  const equipped: Piece[] = []
  const inactive: string[] = []
  let used = 0
  let full = false
  for (const id of extOf(state, actor).slots) {
    const piece = held(state, id) ? describePiece(k, id, deckGrade, rules) : null
    if (!piece) {
      inactive.push(id)
      continue
    }
    if (full || used + piece.size > capacity) {
      full = true
      inactive.push(id)
      continue
    }
    equipped.push(piece)
    used += piece.size
  }
  return { equipped, inactive, used }
}

/**
 * 一個角色現在的甲板。沒有甲板：has 是 false、槽數 0、沒有裝著的東西、不能帶腳本。
 * 這是 features/deck 唯一算槽與腳本的地方；衍生數值（net_guard、戰鬥的單位）都從這裡讀。
 */
export function deckOf(k: Kernel, state: GameState, actor: string): DeckInfo {
  const raw = rawDeck(k, state, actor)
  const none: DeckInfo = {
    has: false, source: null, deck: null, name: null, grade: 0, firewall: 0, slotsTotal: 0, reserved: 0, capacity: 0, used: 0, free: 0,
    equipped: [], inactive: [...extOf(state, actor).slots], scriptLimit: 0, scripts: [], skin: null,
  }
  if (!raw) return none
  const rules = deckRules(k)
  const grade = stat(k, state, actor, 'deck_grade')
  const slotsTotal = stat(k, state, actor, 'deck_slots')
  const reserved = stat(k, state, actor, 'deck_slots_reserved')
  const capacity = Math.max(0, slotsTotal - reserved)
  const { equipped, inactive, used } = activeSlots(k, state, actor, capacity, grade)
  const scriptLimit = grade + rules.script_extra
  const ext = extOf(state, actor)
  return {
    has: true, source: raw.source, deck: raw.entry.id, name: raw.entry.name, ...(raw.uid !== undefined ? { uid: raw.uid } : {}),
    grade, firewall: stat(k, state, actor, 'deck_firewall'), slotsTotal, reserved, capacity, used, free: Math.max(0, capacity - used),
    equipped, inactive, scriptLimit, scripts: fitScripts(k, state, ext.scripts, scriptLimit),
    skin: ext.skin !== undefined && held(state, ext.skin) && k.content.has(SKIN_KIND, ext.skin) ? ext.skin : null,
  }
}

/** 背包裡這個編號的那一副甲板（id 要是 deck 的內容）。 */
export function deckStack(k: Pick<Kernel, 'content'>, state: GameState, uid: string): { id: string; entry: DeckEntry } | null {
  const stack = state.inventory.find((s) => s.data?.uid === uid && k.content.has(DECK_KIND, s.id))
  if (!stack || !findByUid(state.inventory, stack.id, uid)) return null
  return { id: stack.id, entry: k.content.require<DeckEntry>(DECK_KIND, stack.id) }
}

