// L6 功能 cyberware 的甲板（工單 M4-cyber-deck；dev/adr/0019 第三節「甲板是腦部的義體」與 P50、P51；CYBERWARE 第 1 節、第 2 節）。
// 甲板是腦部的一件義體，有兩種：
//   設計圖帶 deck 欄位的（一般的義體：槽數、防火牆……是設計圖的 deck 加上零件 stats 的合計；kind_of: 'blueprint'）；
//   內容種類 deck 的成品甲板（M3 的格式，沒有零件，數字照那一筆；kind_of: 'deck'；功能之間不互相 import，這裡只認那個種類的欄位）。
// 這個檔提供：掛點 deck.source 的回答（deckSourceOf）、腦裡有沒有甲板、一件是不是甲板、網內的行程擋不擋動手術、內容種類 deck 的一筆。
// 狀態不在這裡改；裝與拆在 surgery.ts。

import type { ActorId, ContentEntry, GameState, Kernel } from '../../core'
import { productOf } from '../../core'
import type { CyberPiece } from './model'
import { blueprintEntry, cyberOf, isReady, nowOf } from './model'

export const DECK_KIND = 'deck'
export const DECK_FULL = '腦裡已經有一副甲板，要先拆掉。'

/** 內容種類 deck 的一筆（M3 的格式；只列這裡讀的欄位）。 */
export interface DeckContent extends ContentEntry {
  name: string
  grade: number
  slots: number
  firewall: number
  ram?: { max?: number; regen?: number }
  cooling?: number
  price?: number
  sink_cost?: number
  invasiveness?: string
}

/** 掛點 deck.source 的回答（features/deck 宣告；這裡只認格式）。 */
export interface DeckSourceAnswer {
  uid: string
  id: string
  name: string
  grade: number
  slots: number
  firewall: number
  ram?: { max?: number; regen?: number }
  cooling?: number
  ready: boolean
}

/** 內容種類 deck 的一筆；沒有人定義那個種類（沒裝 features/deck）或查不到是 undefined。 */
export const deckContentOf = (k: Pick<Kernel, 'content'>, id: string): DeckContent | undefined =>
  k.content.hasKind(DECK_KIND) ? k.content.get<DeckContent>(DECK_KIND, id) : undefined

/** 這一件的設計圖（kind_of 是 deck 的沒有設計圖）。 */
export const pieceBlueprint = (k: Pick<Kernel, 'content'>, piece: Pick<CyberPiece, 'bp' | 'kind_of'>) =>
  piece.kind_of === 'deck' ? undefined : blueprintEntry(k, piece.bp)

/** 這一件是甲板：內容種類 deck 的成品，或設計圖帶 deck 欄位。 */
export function isDeckPiece(k: Pick<Kernel, 'content'>, piece: Pick<CyberPiece, 'bp' | 'kind_of'>): boolean {
  return piece.kind_of === 'deck' ? true : pieceBlueprint(k, piece)?.deck !== undefined
}

/** 腦裡的甲板（不管休養中、壞了、被鎖）；沒有是 undefined。 */
export const brainDeck = (k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, actor: ActorId): CyberPiece | undefined =>
  cyberOf(state, actor).find((p) => p.slot === 'brain' && isDeckPiece(k, p))

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const count = (v: unknown): number => Math.max(0, Math.floor(num(v)))

/** 數字都是 0 以上的整數；ram、cooling 是 0 的不寫。 */
function answer(piece: CyberPiece, id: string, name: string, grade: number, n: { slots: number; firewall: number; ram_max: number; ram_regen: number; cooling: number }, ready: boolean): DeckSourceAnswer {
  const ram = { ...(n.ram_max > 0 ? { max: n.ram_max } : {}), ...(n.ram_regen > 0 ? { regen: n.ram_regen } : {}) }
  return {
    uid: piece.uid, id, name, grade, slots: n.slots, firewall: n.firewall, ...(Object.keys(ram).length ? { ram } : {}), ...(n.cooling > 0 ? { cooling: n.cooling } : {}), ready,
  }
}

/**
 * 掛點 deck.source 的回答：腦部的槽裡第一件「設計圖有 deck 欄位」或「kind_of 是 deck」而且沒有 off 的。
 * 設計圖組的：設計圖的 deck 加上零件（與怪癖、精工）stats 裡 slots、firewall、ram_max、ram_regen、cooling 的合計，等級是設計圖的等級；
 * 成品甲板：直接照那一筆。ready 是這一件休養好了沒有（休養中 deckOf 說沒有甲板）。不讀任何衍生數值（deck 的衍生數值經它算出來，不能繞回來）。
 */
export function deckSourceOf(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): DeckSourceAnswer | undefined {
  const now = nowOf(state)
  for (const piece of cyberOf(state, actor)) {
    if (piece.slot !== 'brain' || piece.off) continue
    const ready = isReady(piece, now)
    if (piece.kind_of === 'deck') {
      const e = deckContentOf(k, piece.bp)
      if (!e) continue
      return answer(piece, e.id, e.name, e.grade, { slots: count(e.slots), firewall: count(e.firewall), ram_max: count(e.ram?.max), ram_regen: count(e.ram?.regen), cooling: count(e.cooling) }, ready)
    }
    const bp = blueprintEntry(k, piece.bp)
    if (!bp?.deck) continue
    const stats = productOf(k.content, piece.bp, piece)?.stats ?? {}
    const d = bp.deck
    return answer(piece, piece.bp, bp.name, bp.grade, {
      slots: count(num(d.slots) + num(stats.slots)), firewall: count(num(d.firewall) + num(stats.firewall)),
      ram_max: count(num(d.ram?.max) + num(stats.ram_max)), ram_regen: count(num(d.ram?.regen) + num(stats.ram_regen)), cooling: count(num(d.cooling) + num(stats.cooling)),
    }, ready)
  }
  return undefined
}

/** 人在網內（face.net、netrun）或潛入中（dive）時不能動甲板的手術；wording 照 features/deck 的換甲板。可以動是 null。 */
export function netActivityBlock(k: Pick<Kernel, 'activity'>, state: GameState, what: string): string | null {
  for (const a of k.activity.active(state)) {
    if (a.kind === 'face.net' || a.kind === 'netrun') return `人在網內，不能${what}。`
    if (a.kind === 'dive') return `潛入中，不能${what}。`
  }
  return null
}
