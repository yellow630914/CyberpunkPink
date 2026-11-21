/**
 * 世界編輯器的檢查（UI 第 15 節、GAME_DESIGN 第 3 節第 13 條）：只擋格式錯誤與內容的底線，不檢查強弱。
 * 格式錯誤：欄位不對、id 重複、引用到不存在的東西。內容的底線：所有角色都是成年人（年齡低於 18）、不寫血腥、不寫懷孕。
 * 另外列兩種提醒（不擋）：宣告了卻沒有人推的計數器、寫了卻沒有人讀的旗標。純函式。
 */
import { SCHEMAS, fieldError } from './schemas'

export type EntryKind = 'event' | 'npc' | 'enemy' | 'item' | 'counter' | 'facility' | 'series' | 'site'
  | 'block' | 'faction' | 'citynews' | 'subnet' | 'lace' | 'bp' | 'drug' | 'cloth' | 'acc' | 'adult' | 'skin' | 'tree' | 'trait' | 'opponent' | 'tmpl' | 'run' | 'guide'
export interface WorldEntry {
  id: string
  kind: EntryKind
  name: string
  /** 其餘欄位照 DATA 的格式；這裡只看檢查要用的幾個 */
  [k: string]: unknown
}
export type IssueCode = 'FIELD' | 'DUP' | 'REF' | 'AGE' | 'FLOOR' | 'WARN'
export interface Issue { code: IssueCode; id: string; where: string; text: string; blocking: boolean }

const REQUIRED: Partial<Record<EntryKind, string[]>> = {
  event: ['id', 'name', 'text', 'options'], npc: ['id', 'name', 'age'], enemy: ['id', 'name', 'grade'], item: ['id', 'name', 'grade'],
  counter: ['id', 'name', 'range'], facility: ['id', 'name', 'functions'], series: ['id', 'name', 'members'], site: ['id', 'name'],
}
const FLOOR_WORDS = ['懷孕', '懷上', '受孕', '血肉模糊', '肚破腸流', '斷肢', '內臟']

/** 找出一筆內容裡所有的字串（檢查內容的底線用）。 */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}

export function checkWorld(entries: WorldEntry[], builtin: { items: Set<string>; counters: Set<string>; flagsRead?: Set<string> } = { items: new Set(), counters: new Set() }): Issue[] {
  const out: Issue[] = []
  const ids = new Map<string, WorldEntry[]>()
  for (const e of entries) ids.set(e.id, [...(ids.get(e.id) ?? []), e])
  for (const [id, list] of ids) if (id && list.length > 1) out.push({ code: 'DUP', id, where: 'id', text: `id 重複 ${id}：${list.map(e => `「${e.name}」`).join('與')}`, blocking: true })
  const itemIds = new Set([...builtin.items, ...entries.filter(e => e.kind === 'item').map(e => e.id)])
  const counterIds = new Set([...builtin.counters, ...entries.filter(e => e.kind === 'counter').map(e => e.id)])
  const flagsWritten = new Map<string, string>()
  const flagsRead = new Set(builtin.flagsRead ?? [])
  const countersPushed = new Set<string>()

  for (const e of entries) {
    for (const f of REQUIRED[e.kind] ?? []) {
      if (e[f] === undefined || e[f] === '' || e[f] === null) out.push({ code: 'FIELD', id: e.id || '（沒有 id）', where: f, text: `少了必填的欄位 ${f}`, blocking: true })
    }
    // 第三版的種類照欄位表（lib/schemas.ts）擋必填、型別、範圍與選項
    for (const f of SCHEMAS[e.kind]?.fields ?? []) {
      const err = fieldError(f, e[f.k])
      if (err) out.push({ code: 'FIELD', id: e.id || '（沒有 id）', where: f.k, text: err, blocking: true })
    }
    if (e.kind === 'npc' && typeof e.age === 'number' && e.age < 18) out.push({ code: 'AGE', id: e.id, where: 'age', text: `年齡低於 18：「${e.name}」age ${e.age}。所有角色都是成年人，這一筆不能存進遊戲`, blocking: true })
    if (e.kind === 'npc' && e.age !== undefined && (typeof e.age !== 'number' || !Number.isInteger(e.age))) out.push({ code: 'FIELD', id: e.id, where: 'age', text: '年齡要是整數', blocking: true })
    const bad = strings(e).flatMap(s => FLOOR_WORDS.filter(w => s.includes(w)))
    if (bad.length) out.push({ code: 'FLOOR', id: e.id, where: 'text', text: `碰到內容的底線（不寫血腥、不寫懷孕）：${[...new Set(bad)].join('、')}`, blocking: true })
    if (e.kind === 'event') {
      const opts = Array.isArray(e.options) ? (e.options as Array<Record<string, unknown>>) : []
      opts.forEach((o, i) => {
        if (!o.text) out.push({ code: 'FIELD', id: e.id, where: `options[${i}].text`, text: `少了必填的欄位 options[${i}].text`, blocking: true })
        for (const r of ['success', 'fail', 'any'] as const) {
          const oc = o[r] as Record<string, unknown> | undefined
          if (!oc) continue
          if (typeof oc.item === 'string' && !itemIds.has(oc.item)) out.push({ code: 'REF', id: e.id, where: `options[${i}].${r}.item`, text: `引用到不存在的物品 ${oc.item}`, blocking: true })
          if (typeof oc.flag === 'string') flagsWritten.set(oc.flag, e.name)
          if (oc.counters && typeof oc.counters === 'object') for (const c of Object.keys(oc.counters)) { countersPushed.add(c); if (!counterIds.has(c)) out.push({ code: 'REF', id: e.id, where: `options[${i}].${r}.counters`, text: `引用到不存在的計數器 ${c}`, blocking: true }) }
        }
      })
      const req = (e.requires ?? {}) as { flags?: string[]; counters?: Record<string, string> }
      for (const f of req.flags ?? []) flagsRead.add(f)
      for (const c of Object.keys(req.counters ?? {})) if (!counterIds.has(c)) out.push({ code: 'REF', id: e.id, where: 'requires.counters', text: `引用到不存在的計數器 ${c}`, blocking: true })
    }
  }
  for (const c of entries.filter(x => x.kind === 'counter')) if (!countersPushed.has(c.id) && !c.builtin) out.push({ code: 'WARN', id: c.id, where: 'counter', text: `宣告了卻沒有人推的計數器 ${c.id}：沒有任何內容改它`, blocking: false })
  for (const [f, by] of flagsWritten) if (!flagsRead.has(f)) out.push({ code: 'WARN', id: f, where: 'flag', text: `寫了卻沒有人讀的旗標 ${f}：「${by}」寫入，沒有成員讀它`, blocking: false })
  return out
}

/** 匯入一個世界包：引用到不存在的東西的那幾筆先不載入，其餘照常載入；撞名的 id 列出來讓玩家選。 */
export function planImport(incoming: WorldEntry[], existing: WorldEntry[], builtin: { items: Set<string>; counters: Set<string> }) {
  const issues = checkWorld([...existing.filter(e => !incoming.some(i => i.id === e.id)), ...incoming], builtin).filter(i => incoming.some(e => e.id === i.id))
  const blockedIds = new Set(issues.filter(i => i.blocking && i.code !== 'DUP').map(i => i.id))
  const clashes = incoming.filter(e => existing.some(x => x.id === e.id)).map(e => e.id)
  const load = incoming.filter(e => !blockedIds.has(e.id))
  return { issues, load, skipped: incoming.length - load.length, clashes }
}

/**
 * 「用在哪」（第四版，所有種類）：掃過每一筆內容的每一個欄位（巢狀的也算），
 * 找出它引用的其他內容（值等於某一筆的 id）與引用它的內容，連欄位的位置一起列出來。
 */
export interface UseRef { id: string; name: string; kind: string; where: string }
function walk(v: unknown, path: string, out: Array<[string, string]>) {
  if (typeof v === 'string') out.push([path, v])
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { walk(k, `${path}.${k}（鍵）`, out); walk(x, path ? `${path}.${k}` : k, out) }
}
export function whereUsed(e: { id: string }, all: Array<{ id: string; name?: unknown; kind?: unknown }>): { refs: UseRef[]; usedBy: UseRef[] } {
  const byId = new Map(all.map(x => [x.id, x]))
  const strs: Array<[string, string]> = []
  for (const [k, v] of Object.entries(e)) if (k !== 'id') walk(v, k, strs)
  const refs = strs.filter(([, s]) => s !== e.id && byId.has(s)).map(([where, s]) => { const x = byId.get(s)!; return { id: s, name: String(x.name ?? s), kind: String(x.kind ?? ''), where } })
  const usedBy: UseRef[] = []
  for (const x of all) {
    if (x.id === e.id) continue
    const ss: Array<[string, string]> = []
    for (const [k, v] of Object.entries(x)) if (k !== 'id') walk(v, k, ss)
    for (const [where, s] of ss) if (s === e.id) usedBy.push({ id: x.id, name: String(x.name ?? x.id), kind: String(x.kind ?? ''), where })
  }
  return { refs, usedBy }
}
