import type { DeckCandidate, DeckCell, DeckView, ConstructEntry } from '@engine/src/features/deck'
import type { SlotItem } from './gearView'
import type { Grade } from '../data/types'
import { ITEMS } from '../data/items'

/**
 * 內海分頁的整理（M3-ui-deck）：把引擎 `deckView` 給的格子、候選、SKIN、腳本排成畫面要的樣子（物品格的圖標與等級色、種類的字、數字的字樣）。
 * 只整理與排序，沒有規則：槽數、能不能裝、為什麼不能、防護取哪一件，全是引擎的答案。
 */

export const CLASS_NAME: Record<string, string> = { weapon: '武器', defense: '防護', tool: '工具', hack: '駭入', body: '構裝體', unique: '專屬' }
/** 構裝的種類圖標（第 2 層）；快駭程式用駭入的 */
const CLASS_ICON: Record<string, string> = { weapon: 'ic-net_weapon', defense: 'ic-net_defense', tool: 'ic-net_tool', hack: 'ic-net_hack', body: 'ic-net_body', unique: 'ic-net_unique' }
export const LEGAL_NAME: Record<string, string> = { free: '自由', register: '登記', permit: '許可', banned: '違禁' }
export const grade = (g: number): Grade => (Math.max(1, Math.min(5, Math.round(g))) as Grade)

/** 一件構裝或快駭程式的物品格資料（圖標：舊資料有同 id 的用它的第 3 層圖標，沒有就用種類的第 2 層）。 */
export function pieceSlot(p: { id: string; name: string; grade: number; class?: string; kind?: string }): SlotItem {
  return { id: p.id, name: p.name, grade: grade(p.grade), icon: ITEMS[p.id]?.icon, l2: p.kind === 'quickhack' ? 'ic-net_hack' : CLASS_ICON[p.class ?? ''] ?? 'ic-net_tool' }
}
export const deckSlot = (d: { item: string; name: string; grade: number }): SlotItem => ({ id: d.item, name: d.name, grade: grade(d.grade), l2: 'ic-cw_brain' })
export const skinSlot = (s: { item: string; name: string }): SlotItem => ({ id: s.item, name: s.name, grade: grade(ITEMS[s.item]?.grade ?? 1), icon: ITEMS[s.item]?.icon, l2: 'ic-skin' })

export interface CellRow { cell: DeckCell; item: SlotItem | null; label?: string }
/** 構裝槽一排：有東西的格寫種類，佔兩槽以上的件後面的格標「接上一格」，被專屬構裝佔掉的格標出來。 */
export function slotRows(view: DeckView): CellRow[] {
  return view.cells.map((cell) => ({
    cell,
    item: cell.piece && !cell.continued ? pieceSlot(cell.piece) : null,
    label: cell.reserved ? '專屬' : cell.continued ? '接上格' : cell.piece ? (cell.piece.kind === 'quickhack' ? '快駭' : CLASS_NAME[cell.piece.class ?? ''] ?? '構裝') : undefined,
  }))
}

/** 候選：裝得上的在前（引擎已排好）；一列的字。 */
export function candidateLine(c: DeckCandidate): string {
  return `${c.piece.kind === 'quickhack' ? '快駭' : CLASS_NAME[c.piece.class ?? ''] ?? '構裝'}・${c.piece.grade} 級${c.piece.size > 1 ? `・佔 ${c.piece.size} 槽` : ''}`
}

/** 構裝本身的數字一行行（資料上寫的，原樣列出；怎麼算不在這裡）。 */
export function constructLines(e: ConstructEntry | undefined): string[] {
  if (!e) return []
  const out: string[] = []
  if (e.class === 'weapon') {
    out.push(`每次攻擊 RAM ${e.ram ?? 0}`, e.type === 'jam' ? '類型：干擾' : e.type === 'pleasure' ? '類型：快感' : '類型：神經')
    if (e.archetype) out.push(`原型：${e.archetype}`)
  }
  if (e.class === 'defense') out.push(`防護 ${e.guard ?? 0}`)
  if (e.class === 'tool') out.push(e.passive ? '被動：裝著就有效' : `行動點 ${e.ap ?? 0}・RAM ${e.ram ?? 0}`)
  if (e.brand) out.push(`牌子：${e.brand}`)
  out.push(`合法性：${LEGAL_NAME[e.legal] ?? e.legal}`)
  return out
}

/** 甲板的槽數那一行：能用的槽（含被專屬構裝佔掉的）。 */
export function slotsText(v: DeckView): string {
  const d = v.deck
  if (!d.has) return '0'
  return d.reserved > 0 ? `${d.used}／${d.capacity}（另有 ${d.reserved} 槽被專屬構裝佔掉）` : `${d.used}／${d.capacity}`
}

/** 合併後的新腳本清單：某一種加一支或減一支（上限、夠不夠由引擎判斷，這裡只改清單）。 */
export function bumpScript(list: Array<{ item: string; qty: number }>, item: string, by: 1 | -1): Array<{ item: string; qty: number }> {
  const out = list.map((s) => ({ ...s }))
  const row = out.find((s) => s.item === item)
  if (row) row.qty += by
  else if (by > 0) out.push({ item, qty: 1 })
  return out.filter((s) => s.qty > 0)
}
