// L6 功能 deck：給畫面的整理（角色的內海分頁：甲板、構裝槽、SKIN、腳本）。只讀，不改狀態；規則都在 state.ts 與 ops.ts，這裡把它們排成畫面要的樣子：
// 每一格（cells）、背包裡裝得上的與裝不上的原因（candidates）、背包裡的甲板、SKIN、腳本。

import type { ContentEntry, GameState, ItemEntry, Kernel } from '../../core'
import { countItem } from '../../core'
import type { DeckEntry } from './model'
import { CONSTRUCT_KIND, DECK_KIND, SCRIPT_TAG, SKIN_KIND, deckRules, extOf } from './model'
import { equipBlock, installBlock, removeBlock, scriptsBlock, skinBlock } from './ops'
import type { DeckInfo, Piece } from './state'
import { deckOf, describePiece, pieceKind } from './state'

/** 一個構裝槽（畫面上的一格）。佔兩槽以上的件，第一格寫它，後面的格 continued 是 true。被專屬構裝佔掉的格 reserved 是 true。 */
export interface DeckCell {
  index: number
  piece: Piece | null
  continued?: boolean
  reserved?: boolean
}

/** 背包裡的一件可以裝的東西，以及現在裝不裝得上、為什麼。 */
export interface DeckCandidate {
  item: string
  piece: Piece
  /** 裝不上的原因（完整的一句）；裝得上是 null */
  block: string | null
}

export interface DeckView {
  deck: DeckInfo
  cells: DeckCell[]
  /** 背包裡還沒裝、裝得上或裝不上的構裝與快駭程式（裝得上的在前） */
  candidates: DeckCandidate[]
  /** 槽上的每一件現在能不能卸下（原因是完整的一句；能卸是 null），以及等級高過甲板時的提示（「甲板無法發揮這項構裝的所有性能」） */
  equipped: Array<{ piece: Piece; removeBlock: string | null; over: boolean; note: string | null }>
  /** 背包裡的甲板（可以裝上的 uid）與現在裝不裝得上 */
  decks: Array<{ uid: string; item: string; name: string; grade: number; slots: number; firewall: number; current: boolean; block: string | null }>
  skins: Array<{ item: string; name: string; worn: boolean; block: string | null }>
  scripts: { limit: number; carried: Array<{ item: string; name: string; qty: number }>; available: Array<{ item: string; name: string; have: number }>; block: string | null }
}

const nameOf = (k: Kernel, item: string): string => k.content.get<ItemEntry>('item', item)?.name ?? k.content.get<ContentEntry & { name?: string }>(CONSTRUCT_KIND, item)?.name ?? item

/** 構裝或快駭程式等級高過甲板時的提示：實際照幾級算寫在 piece.runsAt；照甲板的等級跑才有這句。 */
function overNote(piece: Piece, deckGrade: number): { over: boolean; note: string | null } {
  const over = piece.grade > deckGrade
  return { over, note: over && piece.runsAt < piece.grade ? `甲板無法發揮這項構裝的所有性能（構裝 ${piece.grade} 級、甲板 ${deckGrade} 級，照 ${piece.runsAt} 級算）。` : null }
}

export function deckView(k: Kernel, state: GameState, actor: string): DeckView {
  const deck = deckOf(k, state, actor)
  const rules = deckRules(k)

  const cells: DeckCell[] = []
  for (const p of deck.equipped) {
    cells.push({ index: cells.length, piece: p })
    for (let i = 1; i < p.size; i++) cells.push({ index: cells.length, piece: p, continued: true })
  }
  while (cells.length < deck.capacity) cells.push({ index: cells.length, piece: null })
  while (cells.length < deck.slotsTotal) cells.push({ index: cells.length, piece: null, reserved: true })

  const have = new Set(extOf(state, actor).slots)
  const candidates: DeckCandidate[] = []
  const seen = new Set<string>()
  for (const s of state.inventory) {
    if (seen.has(s.id) || have.has(s.id) || pieceKind(k, s.id) === null) continue
    seen.add(s.id)
    const piece = describePiece(k, s.id, deck.grade, rules)
    if (piece) candidates.push({ item: s.id, piece, block: installBlock(k, state, actor, s.id) })
  }
  candidates.sort((a, b) => Number(a.block !== null) - Number(b.block !== null))

  const decks: DeckView['decks'] = []
  for (const s of state.inventory) {
    const uid = s.data?.uid
    const e = typeof uid === 'string' ? k.content.get<DeckEntry>(DECK_KIND, s.id) : undefined
    if (e && typeof uid === 'string') decks.push({ uid, item: s.id, name: e.name, grade: e.grade, slots: e.slots, firewall: e.firewall, current: deck.source === 'own' && deck.uid === uid, block: equipBlock(k, state, actor, uid) })
  }

  const skins: DeckView['skins'] = []
  for (const s of state.inventory) {
    if (!k.content.has(SKIN_KIND, s.id) || skins.some((x) => x.item === s.id)) continue
    skins.push({ item: s.id, name: k.content.get<ContentEntry & { name: string }>(SKIN_KIND, s.id)!.name, worn: deck.skin === s.id, block: skinBlock(k, state, actor, s.id) })
  }

  const carried = deck.scripts.map((s) => ({ item: s.item, name: nameOf(k, s.item), qty: s.qty }))
  const available: DeckView['scripts']['available'] = []
  for (const s of state.inventory) {
    if (!k.content.get<ItemEntry>('item', s.id)?.tags?.includes(SCRIPT_TAG) || available.some((x) => x.item === s.id)) continue
    available.push({ item: s.id, name: nameOf(k, s.id), have: countItem(state.inventory, s.id) })
  }

  return {
    deck, cells, candidates,
    equipped: deck.equipped.map((piece) => ({ piece, removeBlock: removeBlock(k, state, actor, piece.id), ...overNote(piece, deck.grade) })),
    decks, skins,
    scripts: { limit: deck.scriptLimit, carried, available, block: scriptsBlock(k, state, actor, deck.scripts) },
  }
}
