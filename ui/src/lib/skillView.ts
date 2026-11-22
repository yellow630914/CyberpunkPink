/**
 * 技能樹與橋的整理：把引擎的內容（路數、技能）與狀態整理成畫面要的樹、卡、列。純函式，只整理與排序。
 * 不判斷能不能學、能不能裝：這些一律由 store 問引擎（stores/engine.ts 的 skills），原因就是引擎回的那一句。
 * 這裡只有名字、顏色、說明文字的對照，以及「現在用掉的加上它的容量」的預覽（只做加法）。
 */
import type { AbilityEntry, AbilityState, PathEntry } from '@engine/src/features/abilities'
import { CATEGORIES, CATEGORY_NAME } from '@engine/src/features/abilities/types'
import type { Category } from '@engine/src/features/abilities/types'

export { CATEGORIES, CATEGORY_NAME }
export type { Category }

/** 每一類容量的顏色（UI.md 8.3 節：現實淡紫、內海薄荷、社交金、媒體紫），都是設計代幣。 */
export const CAT_COLOR: Record<Category, string> = { meat: 'var(--ink-2)', net: 'var(--ram)', social: 'var(--ap)', media: 'var(--ep)' }

export const KIND_NAME: Record<string, string> = { active: '主動', passive: '被動', reaction: '反應', stance: '姿態', prep: '預備', daily: '日常' }
export const KIND_SHORT: Record<string, string> = { active: '動', passive: '被', reaction: '反', stance: '姿', prep: '備', daily: '常' }
export const DOMAIN_NAME: Record<string, string> = { strong: '強', strong_support: '強（輔助）', mid: '中', weak: '弱', none: '無' }
export const LAYER_NAME: Record<string, string> = { signature: '招牌', front: '前層', back: '後層' }
export const LANES = [
  { key: 'meat', domain: 'meat', label: '現實' },
  { key: 'net', domain: 'net', label: '內海' },
  { key: 'opinion', domain: 'opinion', label: '輿論' },
] as const
export const PENDING_LINE = '還沒有做成機制。'

// ---- 文字 ----

export interface TextSeg { text: string; bold: boolean }
/** 說明文字裡的 **粗體** 轉成片段（畫面用 <b> 畫出來，不印出星號）。 */
export function richText(text: string): TextSeg[] {
  const out: TextSeg[] = []
  const parts = text.split('**')
  parts.forEach((p, i) => {
    if (p !== '') out.push({ text: p, bold: i % 2 === 1 })
  })
  // 星號沒有成對時，最後一段不當粗體（把落單的星號整個丟掉）
  if (parts.length % 2 === 0 && out.length > 0) out[out.length - 1]!.bold = false
  return out
}

/** 消耗寫成一句（照 `use`）。沒有寫消耗的寫「沒有消耗」。 */
export function useLine(ab: AbilityEntry): string {
  const u = ab.use
  if (!u) return '沒有消耗'
  const bits: string[] = []
  if (u.ap !== undefined) bits.push(`${u.ap} 行動點`)
  if (u.per_turn !== undefined) bits.push(`每回合 ${u.per_turn} 次`)
  if (u.per_fight !== undefined) bits.push(`每場 ${u.per_fight} 次`)
  if (u.first_round) bits.push('只能在第一回合')
  if (u.note) bits.push(u.note)
  return bits.length ? bits.join('，') : '沒有消耗'
}

export interface LaneView { key: string; label: string; level: string; dim: boolean; pending: boolean; line: string }
/** 三個戰場各一列：值是 null 的變淡；標 pending 的寫「還沒有做成機制」，有說明就接在後面。 */
export function lanesOf(ab: AbilityEntry, path: PathEntry | undefined): LaneView[] {
  return LANES.map((l) => {
    const v = ab[l.key] as Record<string, unknown> | null
    const level = DOMAIN_NAME[path?.domains[l.domain] ?? 'none'] ?? '—'
    if (v === null || v === undefined) return { key: l.key, label: l.label, level, dim: true, pending: false, line: '沒有效果' }
    const pending = v.pending === true
    const text = typeof v.text === 'string' ? v.text : ''
    return { key: l.key, label: l.label, level, dim: false, pending, line: pending ? `${PENDING_LINE}${text ? ` ${text}` : ''}` : text }
  })
}

// ---- 樹 ----

export interface CardView {
  id: string
  name: string
  kind: string
  kindShort: string
  cap: number
  xp: number
  tier: number
  layer: string
  state: 'learned' | 'can' | 'blocked' | 'locked'
  /** 引擎回的原因（學會了與可以學是 null） */
  why: string | null
  after: string | null
}
export interface TreeView {
  id: string
  name: string
  tree: string
  category: Category
  signature: string
  /** 這棵樹累計花的歷練點 */
  spent: number
  /** 引擎說這棵樹開到第幾階 */
  tier: number
  /** 離下一階還差多少（滿階是 null） */
  toNext: number | null
  /** 一點都沒花：變淡 */
  dim: boolean
  abilities: AbilityEntry[]
}

/** 內容裡有的樹：沒有任何技能資料的路數不列。 */
export function listTrees(paths: readonly PathEntry[], abilities: readonly AbilityEntry[], mine: AbilityState, tierOf: (path: string) => number, treeXp: readonly number[]): TreeView[] {
  return paths
    .map((p) => {
      const list = abilities.filter((a) => a.path === p.id)
      const spent = mine.spent[p.id] ?? 0
      const tier = tierOf(p.id)
      return { id: p.id, name: p.name, tree: p.tree, category: p.category, signature: p.signature, spent, tier, toNext: treeXp[tier] === undefined ? null : treeXp[tier]! - spent, dim: spent === 0, abilities: list }
    })
    .filter((t) => t.abilities.length > 0)
}

/** 技能卡的狀態：學會了、可以學、條件不夠（引擎的原因）、那一階還沒開。tier 與 open 都是引擎給的數字。 */
export function cardOf(ab: AbilityEntry, mine: AbilityState, openTier: number, why: string | null): CardView {
  const learned = mine.learned.includes(ab.id)
  const locked = !learned && ab.tier > openTier
  const state: CardView['state'] = learned ? 'learned' : locked ? 'locked' : why === null ? 'can' : 'blocked'
  return { id: ab.id, name: ab.name, kind: KIND_NAME[ab.kind] ?? ab.kind, kindShort: KIND_SHORT[ab.kind] ?? '', cap: ab.cap, xp: ab.xp, tier: ab.tier, layer: ab.layer, state, why: learned ? null : why, after: ab.after ?? null }
}

export interface TreeGrid {
  columns: number
  signature: AbilityEntry | null
  /** 每一階：前層、後層各一列，每一列每一欄放幾張（同一格有分支時不只一張） */
  tiers: Array<{ tier: number; rows: Array<{ layer: 'front' | 'back'; cells: AbilityEntry[][] }> }>
}

/** 一棵樹的排版：招牌在最上面；三條線照 after 的鏈排（同一條鏈一欄）。 */
export function gridOf(tree: TreeView): TreeGrid {
  const byId = new Map(tree.abilities.map((a) => [a.id, a]))
  const sig = byId.get(tree.signature) ?? null
  const column = new Map<string, number>()
  let next = 0
  const colOf = (a: AbilityEntry): number => {
    const got = column.get(a.id)
    if (got !== undefined) return got
    const parent = a.after ? byId.get(a.after) : undefined
    const c = parent && parent.id !== tree.signature ? colOf(parent) : next++
    column.set(a.id, c)
    return c
  }
  const rest = tree.abilities.filter((a) => a.id !== tree.signature)
  for (const a of rest) colOf(a)
  const columns = Math.max(next, 1)
  const tiers = [1, 2, 3, 4, 5].map((tier) => ({
    tier,
    rows: (['front', 'back'] as const).map((layer) => {
      const cells: AbilityEntry[][] = Array.from({ length: columns }, () => [])
      for (const a of rest) if (a.tier === tier && a.layer === layer) cells[column.get(a.id)!]!.push(a)
      return { layer, cells }
    }),
  }))
  return { columns, signature: sig, tiers }
}

// ---- 橋 ----

export interface BridgeRow {
  id: string
  name: string
  path: string
  treeName: string
  tier: number
  signature: boolean
  kind: string
  category: Category
  cap: number
  text: string
}

/** 橋的清單：只列學會的技能（照內容的順序）。 */
export function bridgeRows(paths: readonly PathEntry[], abilities: readonly AbilityEntry[], mine: AbilityState): BridgeRow[] {
  return abilities
    .filter((a) => mine.learned.includes(a.id))
    .map((a) => {
      const p = paths.find((x) => x.id === a.path)
      return { id: a.id, name: a.name, path: a.path, treeName: p?.name ?? a.path, tier: a.tier, signature: a.layer === 'signature', kind: KIND_NAME[a.kind] ?? a.kind, category: a.category, cap: a.cap, text: a.text }
    })
}

/** 篩選：全部、某一棵樹、只看裝著的（照暫存的清單）。 */
export function filterRows(rows: readonly BridgeRow[], filter: string, draft: readonly string[]): BridgeRow[] {
  if (filter === 'all') return [...rows]
  if (filter === 'on') return rows.filter((r) => draft.includes(r.id))
  return rows.filter((r) => r.path === filter)
}

/** 暫存清單勾選／取消勾選一個（回傳新的清單）。 */
export function toggleDraft(draft: readonly string[], id: string): string[] {
  return draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id]
}
export const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/** 暫存清單用掉的容量：每一類把裝著的技能的容量加起來（只做加法）。 */
export function draftUse(rows: readonly BridgeRow[], draft: readonly string[]): Record<Category, number> {
  const out: Record<Category, number> = { meat: 0, net: 0, social: 0, media: 0 }
  for (const r of rows) if (draft.includes(r.id)) out[r.category] += r.cap
  return out
}

/** 游標指著還沒裝的技能：那一類現在用掉的加上它的容量。已經勾著的沒有預覽。 */
export function previewOf(row: BridgeRow | null, draft: readonly string[], used: Record<Category, number>): { category: Category; after: number } | null {
  if (!row || draft.includes(row.id)) return null
  return { category: row.category, after: used[row.category] + row.cap }
}

export interface CapCell { on: boolean; preview: boolean; over: boolean }
/** 一條容量條的格子：一格一點；實色是用掉的、空心是預覽、超出橋容量的格子加紅框（超出的格數照 max 顯示，不是規則）。 */
export function capCells(max: number, used: number, after: number | null): CapCell[] {
  const total = Math.max(max, used, after ?? 0)
  return Array.from({ length: total }, (_, i) => {
    const on = i < used
    const pv = !on && after !== null && i < after
    return { on, preview: pv, over: i >= max && (on || pv) }
  })
}
