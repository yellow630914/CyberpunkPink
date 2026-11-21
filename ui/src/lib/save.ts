/**
 * 存檔的打包、讀回與回退（UI 第 15 節、SERIES 第 6 節、COMBAT_SYSTEM 8.4 節）。純函式。
 * - 存檔是一份 JSON：{ format, version, meta, state }。v1 的格式（沒有 format，欄位直接在最外層）照樣讀得回來。
 * - 匯入時有低於 18 的年齡，整筆拒絕，不自動改成 18（UI 第 14 節）。
 * - 回退（重來這場戰鬥、回到這個階段開始時、撤退）把狀態換回快照，但保留三樣：紀錄、性經歷記錄、共同記憶。
 */
export const SAVE_FORMAT = 'cyberpunkpink-save'
export const SAVE_VERSION = 2

export interface SaveMeta { label: string; day: number; time: string; place: string; savedAt: string; kind?: '手動' | '自動' | '快照' }
export interface SaveFile<S = Record<string, unknown>> { format: string; version: number; meta: SaveMeta; state: S }

export function packSave<S>(state: S, meta: SaveMeta): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, meta, state } satisfies SaveFile<S>)
}

export type Unpacked<S> = { ok: true; file: SaveFile<Partial<S>> } | { ok: false; error: string }

/** 找出所有的年齡欄位（任何深度的 age），回傳低於 18 的那幾個的位置。 */
export function underageAt(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => underageAt(x, `${path}[${i}]`))
  if (v && typeof v === 'object') {
    const out: string[] = []
    for (const [k, x] of Object.entries(v)) {
      if (k === 'age' && typeof x === 'number' && x < 18) out.push(path ? `${path}.age` : 'age')
      else out.push(...underageAt(x, path ? `${path}.${k}` : k))
    }
    return out
  }
  return []
}

export function unpackSave<S>(raw: string): Unpacked<S> {
  let d: unknown
  try { d = JSON.parse(raw) } catch { return { ok: false, error: '這不是存檔：JSON 讀不出來。' } }
  if (!d || typeof d !== 'object') return { ok: false, error: '這不是存檔。' }
  const o = d as Record<string, unknown>
  let file: SaveFile<Partial<S>>
  if (o.format === SAVE_FORMAT) {
    if (typeof o.version !== 'number' || o.version > SAVE_VERSION) return { ok: false, error: `存檔格式 ${String(o.version)} 比這個版本新，讀不了。` }
    if (!o.state || typeof o.state !== 'object') return { ok: false, error: '存檔裡沒有狀態。' }
    file = o as unknown as SaveFile<Partial<S>>
  } else if ('day' in o && 'minutes' in o) {
    // v1：設定頁存的假存檔，欄位在最外層
    file = { format: SAVE_FORMAT, version: 1, meta: { label: `第 ${String(o.day)} 天`, day: Number(o.day), time: '', place: '', savedAt: '' }, state: o as Partial<S> }
  } else return { ok: false, error: '這不是存檔：缺了格式標記。' }
  const young = underageAt(file.state)
  if (young.length) return { ok: false, error: `存檔裡有低於 18 的年齡（${young.slice(0, 3).join('、')}）：所有角色都是成年人，整筆不讀。` }
  return { ok: true, file }
}

/** 回退時保留的三樣東西（SERIES 第 6 節）。 */
export interface KeepOnRollback {
  log: unknown[]
  sexRecord: unknown
  /** npc id → 共同記憶 */
  memories: Record<string, unknown[]>
}
export interface RollbackState { log: unknown[]; sexRecord: unknown; npcs: Record<string, { memories: unknown[] } & Record<string, unknown>> }

/** 把快照套回去，但紀錄、性經歷記錄與共同記憶用現在的（紀錄另外加一行交代這是被收回的經歷）。 */
export function rollbackKeeping<S extends RollbackState>(current: S, snapshot: S, note?: unknown): S {
  const out = structuredClone(snapshot)
  out.log = note ? [note, ...structuredClone(current.log)] : structuredClone(current.log)
  out.sexRecord = structuredClone(current.sexRecord)
  for (const [id, n] of Object.entries(current.npcs)) {
    if (out.npcs[id]) out.npcs[id].memories = structuredClone(n.memories)
  }
  return out
}

/** 委託副本的快照（SERIES 第 6 節）：每個階段開始時與每場戰鬥開打前各存一個；進入入口那一刻是撤退的點。 */
export type SnapshotKind = '入口' | '階段' | '戰鬥'
export interface Snapshot { id: string; kind: SnapshotKind; label: string; at: string; state: string }

/** 哪些快照現在能用：戰鬥的那個（重來）、目前這個階段的（回到開始時）、入口（撤退）一律可以；更早的階段只留著。 */
export function snapshotUse(list: Snapshot[], s: Snapshot): { action: string; reason: string | null } {
  if (s.kind === '戰鬥') return { action: '重來這場戰鬥', reason: null }
  if (s.kind === '入口') return { action: '撤退', reason: null }
  const stages = list.filter(x => x.kind === '階段')
  const latest = stages[stages.length - 1]
  return latest?.id === s.id
    ? { action: '回到這個階段開始時', reason: null }
    : { action: '回到這個階段開始時', reason: '已經過了這個階段，所以只留著，不能直接跳回去。' }
}
