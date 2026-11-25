// L6 功能 unreg 的資料與純函式：規則表（unreg_rule）、預設清單（unreg_preset）的格式、狀態的形狀（state.ext.unreg）、這個功能共用的名字。
// 規格：CRAFTING 11.1 節、5.5 節、第 2.1 節；dev/adr/0019 第十七節與 P66～P68、P74、P75；dev/work/M4-part-unreg.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { AffinityKey, BlueprintKind, ContentEntry, GameState, Kernel } from '../../core'
import { AFFINITY_KEYS, BLUEPRINT_KINDS, LEGALITIES, PART_TYPE_NAMES, clone, isRecord, isSafeInt } from '../../core'

export const OWNER = 'unreg'
export const EXT = 'unreg'
export const RULE_KIND = 'unreg_rule'
export const PRESET_KIND = 'unreg_preset'
/** 變更：等著交貨的清單（add 帶 spec，流水號、框架、預設文字在套用的那一刻才定；remove 帶 id）。 */
export const PENDING_OP = 'unreg.pending'
/** 變更：記下「只能拿一次」的標記。 */
export const ONCE_OP = 'unreg.once'
/** 變更：記下給過的名字。 */
export const NAME_OP = 'unreg.name'
/** 效果：多一件等著交貨的未登錄零件（內建的來源才收，ai: false）。 */
export const PART_EFFECT = 'part_unreg'
/** 報告：交貨。 */
export const DELIVER_ACTION = 'unreg.deliver'
/** 等著交貨的那一筆的 id，也是交貨之後那件零件的 uid。 */
export const UID_PREFIX = 'up'
/** 五個來源（CRAFTING 11.1 節）：委託的報酬、訂做、勢力的固定窗口、口頭要到，加上沒寫來源時的預設（gift）。 */
export const SOURCES = ['reward', 'order', 'window', 'ask', 'gift'] as const
export type Source = (typeof SOURCES)[number]
/** 最高 IV 級（V 級不走這四條，P75）。 */
export const MAX_GRADE = 4
export const GRADES = [1, 2, 3, 4] as const
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
export const MATERIALS = ['mech', 'bio'] as const
export type Material = (typeof MATERIALS)[number]
/** 備註的字數上限（玩家的描述）。 */
export const REQUEST_MAX = 80

// ---- 規則（CRAFTING 11.1、5.5 節；dev/adr/0019 P66～P68、P74） ----

/** 一種零件「能帶什麼」的一項（CRAFTING 5.5 節那張表的一列）。 */
export interface UnregOption {
  id: string
  name: string
  /** 數字寫進零件的 stats 還是 affinity */
  put: 'stats' | 'affinity'
  key: string
  /** 一份給多少（可以是負的，例如重量） */
  amount: number
  /** 一份算幾格（0.5 的倍數） */
  cost: number
  /** 最多幾份 */
  max: number
  /** 某幾級的份數上限（蓋掉 max，例如 I、II 級的板材護甲最多 1 份） */
  max_at?: Record<number, number>
  grade_min?: number
  material?: Material
  tags?: string[]
}

export interface UnregType {
  name: string
  /** false：沒有生體版（槍管、機構） */
  bio?: boolean
  /** 這種零件用在哪幾種成品；沒寫是都可以（抽怪癖時用） */
  kinds?: BlueprintKind[]
}

export interface UnregRules {
  /** 每一級的份量（格） */
  cells: Record<number, number>
  /** 每一級最多幾條屬性 */
  lines: Record<number, number>
  /** 表價 */
  price: Record<number, number>
  legal: Record<number, string>
  shape: { weight: number; size: number }
  types: Record<string, UnregType>
  options: Record<string, UnregOption[]>
  /** 怪癖退幾格：stats 有負數的是 costly，其餘 plain */
  refund: { plain: number; costly: number }
  /** 每個來源一筆；這一張只讀 grade_cap，其餘的鍵是 M4-part-sources 的 */
  sources: Record<string, { grade_cap: number; [key: string]: unknown }>
  /** 三段文字的字數範圍 */
  text: { name: [number, number]; desc: [number, number]; quirk: [number, number] }
}

/** 十二種零件的預設（沿用 core 的 PART_TYPE_NAMES 與 features/gear 在用的 id）。bio: false 的沒有生體版。kinds 是抽怪癖時用的暫定表。 */
export const DEFAULT_UNREG_TYPES: Record<string, UnregType> = {
  chip: { name: PART_TYPE_NAMES.chip!, kinds: ['cyberware', 'weapon', 'armor'] },
  neuron: { name: PART_TYPE_NAMES.neuron!, kinds: ['cyberware', 'weapon'] },
  software: { name: PART_TYPE_NAMES.software!, kinds: ['cyberware', 'weapon'] },
  plate: { name: PART_TYPE_NAMES.plate!, kinds: ['cyberware', 'weapon', 'armor'] },
  actuator: { name: PART_TYPE_NAMES.actuator!, kinds: ['cyberware', 'armor'] },
  sensor: { name: PART_TYPE_NAMES.sensor!, kinds: ['cyberware', 'weapon', 'armor'] },
  power: { name: PART_TYPE_NAMES.power!, kinds: ['cyberware', 'weapon', 'armor'] },
  skin: { name: PART_TYPE_NAMES.skin!, kinds: ['cyberware', 'armor'] },
  barrel: { name: PART_TYPE_NAMES.barrel!, bio: false, kinds: ['weapon'] },
  action: { name: PART_TYPE_NAMES.action!, bio: false, kinds: ['weapon'] },
  blade: { name: PART_TYPE_NAMES.blade!, kinds: ['weapon', 'cyberware'] },
  fiber: { name: PART_TYPE_NAMES.fiber!, kinds: ['armor'] },
}

export const DEFAULT_UNREG_RULES: UnregRules = {
  cells: { 1: 0.5, 2: 1, 3: 1.5, 4: 2 },
  lines: { 1: 1, 2: 2, 3: 2, 4: 3 },
  price: { 1: 200, 2: 600, 3: 2000, 4: 8000 },
  legal: { 1: 'free', 2: 'free', 3: 'permit', 4: 'banned' },
  shape: { weight: 0.2, size: 1 },
  types: DEFAULT_UNREG_TYPES,
  // 每種零件每一項的數字由 M4-data-rules 填
  options: {},
  refund: { plain: 0.5, costly: 1 },
  sources: {
    // 'window' 寫成字串：分層檢查會把沒有引號的 window 當成瀏覽器的全域物件
    reward: { grade_cap: 3 }, order: { grade_cap: 3 }, 'window': { grade_cap: 4 }, ask: { grade_cap: 2 }, gift: { grade_cap: 4 },
  },
  text: { name: [1, 10], desc: [4, 60], quirk: [4, 80] },
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isHalf = (v: unknown): v is number => isNum(v) && Number.isInteger(v * 2)
const inList = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v)
const gradeKey = (g: string): boolean => GRADES.some((x) => String(x) === g)

/** 「等級 → 值」的表：鍵只能是 1～4。 */
function perGrade(v: unknown, ok: (x: unknown) => boolean, what: string, name: string): string[] {
  if (!isRecord(v)) return [`${name} 要是「等級（1～4）→ ${what}」`]
  return Object.entries(v).flatMap(([g, x]) => (!gradeKey(g) ? [`${name}.${g}：等級只有 1～4`] : ok(x) ? [] : [`${name}.${g} 要是${what}`]))
}

function optionProblems(o: unknown, at: string): string[] {
  if (!isRecord(o)) return [`${at} 要是一個物件`]
  const p: string[] = []
  if (!isText(o.id)) p.push(`${at}：要有 id`)
  if (!isText(o.name)) p.push(`${at}：要有 name`)
  if (o.put !== 'stats' && o.put !== 'affinity') p.push(`${at}：put 只能是 stats 或 affinity`)
  if (!isText(o.key)) p.push(`${at}：要有 key`)
  else if (o.put === 'affinity' && !inList(AFFINITY_KEYS, o.key)) p.push(`${at}：親和的 key 只能是 ${AFFINITY_KEYS.join('、')}`)
  if (!isNum(o.amount) || o.amount === 0) p.push(`${at}：amount 要是不為 0 的數字（一份給多少，可以是負的）`)
  else if (o.put === 'affinity' && !Number.isInteger(o.amount)) p.push(`${at}：親和的 amount 要是整數`)
  if (!isHalf(o.cost) || o.cost < 0) p.push(`${at}：cost 要是 0.5 的倍數（一份幾格）`)
  if (!isSafeInt(o.max) || o.max < 1) p.push(`${at}：max 要是 1 以上的整數（最多幾份）`)
  if (o.max_at !== undefined) p.push(...perGrade(o.max_at, (x) => isSafeInt(x) && x >= 1, '1 以上的整數', `${at}.max_at`))
  if (o.grade_min !== undefined && !(isSafeInt(o.grade_min) && o.grade_min >= 1 && o.grade_min <= MAX_GRADE)) p.push(`${at}：grade_min 要是 1～${MAX_GRADE}`)
  if (o.material !== undefined && !inList(MATERIALS, o.material)) p.push(`${at}：material 只能是 ${MATERIALS.join('、')}`)
  if (o.tags !== undefined && !(Array.isArray(o.tags) && o.tags.every(isText))) p.push(`${at}：tags 要是字串的陣列`)
  return p
}

const FIELD_CHECKS: Record<string, (v: unknown) => string[]> = {
  cells: (v) => perGrade(v, (x) => isHalf(x) && x >= 0, '0.5 的倍數', 'cells'),
  lines: (v) => perGrade(v, (x) => isSafeInt(x) && x >= 1 && x <= 8, '1～8 的整數', 'lines'),
  price: (v) => perGrade(v, (x) => isSafeInt(x) && x >= 0, '0 以上的整數', 'price'),
  legal: (v) => perGrade(v, (x) => inList(LEGALITIES, x), `${LEGALITIES.join('、')} 之一`, 'legal'),
  shape: (v) => {
    if (!isRecord(v)) return ['shape 要是 { weight, size }']
    const p: string[] = []
    if (v.weight !== undefined && !(isNum(v.weight) && v.weight >= 0)) p.push('shape.weight 要是 0 以上的數字')
    if (v.size !== undefined && !(isSafeInt(v.size) && v.size >= 0 && v.size <= 4)) p.push('shape.size 要是 0～4 的整數')
    return p
  },
  types: (v) => {
    if (!isRecord(v)) return ['types 要是「零件類型 → { name, bio?, kinds? }」']
    return Object.entries(v).flatMap(([id, t]) => {
      if (!isRecord(t)) return [`types.${id} 要是 { name, bio?, kinds? }`]
      const p: string[] = []
      if (!isText(t.name)) p.push(`types.${id}：要有 name`)
      if (t.bio !== undefined && typeof t.bio !== 'boolean') p.push(`types.${id}：bio 要是 true 或 false`)
      if (t.kinds !== undefined && !(Array.isArray(t.kinds) && t.kinds.length > 0 && t.kinds.every((x) => inList(BLUEPRINT_KINDS, x)))) p.push(`types.${id}：kinds 要是至少一個的陣列，每一項是 ${BLUEPRINT_KINDS.join('、')} 之一`)
      return p
    })
  },
  options: (v) => {
    if (!isRecord(v)) return ['options 要是「零件類型 → 選項的陣列」']
    return Object.entries(v).flatMap(([type, list]) => {
      if (!Array.isArray(list)) return [`options.${type} 要是選項的陣列`]
      const seen = new Set<string>()
      return list.flatMap((o, i) => {
        const p = optionProblems(o, `options.${type}[${i}]`)
        if (isRecord(o) && isText(o.id)) {
          if (seen.has(o.id)) p.push(`options.${type}[${i}]：id ${o.id} 重複`)
          seen.add(o.id)
        }
        return p
      })
    })
  },
  refund: (v) => {
    if (!isRecord(v)) return ['refund 要是 { plain, costly }']
    return (['plain', 'costly'] as const).flatMap((f) => (v[f] !== undefined && !(isHalf(v[f]) && (v[f] as number) >= 0) ? [`refund.${f} 要是 0.5 的倍數`] : []))
  },
  sources: (v) => {
    if (!isRecord(v)) return ['sources 要是「來源 → { grade_cap, … }」']
    return Object.entries(v).flatMap(([id, s]) => {
      if (!(SOURCES as readonly string[]).includes(id)) return [`sources.${id}：來源只有 ${SOURCES.join('、')}`]
      if (!isRecord(s)) return [`sources.${id} 要是一個物件`]
      return s.grade_cap !== undefined && !(isSafeInt(s.grade_cap) && s.grade_cap >= 1 && s.grade_cap <= MAX_GRADE) ? [`sources.${id}.grade_cap 要是 1～${MAX_GRADE}`] : []
    })
  },
  text: (v) => {
    if (!isRecord(v)) return ['text 要是 { name, desc, quirk }：每一項是 [最少字數, 最多字數]']
    return (['name', 'desc', 'quirk'] as const).flatMap((f) => {
      const r = v[f]
      if (r === undefined) return []
      return Array.isArray(r) && r.length === 2 && r.every((n) => isSafeInt(n) && n >= 0 && n <= 1000) && (r[0] as number) <= (r[1] as number) ? [] : [`text.${f} 要是 [最少字數, 最多字數]`]
    })
  },
}

/** 規則表 unreg_rule 的格式檢查（每條一句）。 */
export function unregRuleProblems(e: Record<string, unknown>): string[] {
  return Object.entries(FIELD_CHECKS).flatMap(([f, check]) => (e[f] !== undefined ? check(e[f]) : []))
}

/** 現在生效的規則：資料 unreg_rule/default 蓋掉內建的預設（格式不對的欄位忽略；每一級、每種零件、每個來源逐項蓋）。 */
export function unregRules(k: Pick<Kernel, 'content'>): UnregRules {
  const out = clone(DEFAULT_UNREG_RULES)
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const ok = (f: string): boolean => e[f] !== undefined && (FIELD_CHECKS[f]?.(e[f]) ?? ['?']).length === 0
  for (const f of ['cells', 'lines', 'price', 'legal'] as const) if (ok(f)) Object.assign(out[f], clone(e[f] as Record<string, never>))
  if (ok('shape')) Object.assign(out.shape, clone(e.shape as Record<string, number>))
  if (ok('types')) Object.assign(out.types, clone(e.types as Record<string, UnregType>))
  if (ok('options')) Object.assign(out.options, clone(e.options as Record<string, UnregOption[]>))
  if (ok('refund')) Object.assign(out.refund, clone(e.refund as Record<string, number>))
  if (ok('sources')) for (const [id, s] of Object.entries(e.sources as Record<string, Record<string, unknown>>)) out.sources[id] = { ...out.sources[id]!, ...clone(s) } as UnregRules['sources'][string]
  if (ok('text')) Object.assign(out.text, clone(e.text as Record<string, [number, number]>))
  return out
}

/** 這個來源的等級上限（最高 IV）；不認得的來源當 IV。 */
export const gradeCap = (rules: UnregRules, source: string | undefined): number =>
  Math.min(MAX_GRADE, source !== undefined ? rules.sources[source]?.grade_cap ?? MAX_GRADE : MAX_GRADE)

/** 一個零件類型的名字；不在表裡寫 id。 */
export const typeName = (rules: UnregRules, type: string): string => rules.types[type]?.name ?? PART_TYPE_NAMES[type] ?? type

/** 這個選項在這一級最多幾份。 */
export const maxShares = (o: UnregOption, grade: number): number => Math.min(o.max, o.max_at?.[grade] ?? o.max)

// ---- 預設清單（內容種類 unreg_preset） ----

export interface PresetEntry extends ContentEntry {
  type: string
  grade?: number
  material?: Material
  name: string
  desc: string
  quirk_text?: string
}

export function presetProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.type)) p.push('要有 type（零件類型的 id）')
  if (e.grade !== undefined && !(isSafeInt(e.grade) && e.grade >= 1 && e.grade <= MAX_GRADE)) p.push(`grade 要是 1～${MAX_GRADE}`)
  if (e.material !== undefined && !inList(MATERIALS, e.material)) p.push(`material 只能是 ${MATERIALS.join('、')}`)
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.desc)) p.push('要有 desc（一句說明）')
  if (e.quirk_text !== undefined && typeof e.quirk_text !== 'string') p.push('quirk_text 要是字串')
  return p
}

// ---- 狀態 state.ext.unreg ----

/** 一件零件的框架（引擎定的全部數字）。 */
export interface Frame {
  type: string
  material: Material
  grade: number
  brand: string
  /** 屬性：每一條是哪個選項、放了幾份 */
  attrs: Array<{ option: string; shares: number }>
  stats: Record<string, number>
  affinity: Partial<Record<AffinityKey, number>>
  /** 抽到的怪癖與它退的格；一筆都抽不到是 null */
  quirk: { id: string; refund: number } | null
  budget: number
  used: number
  price: number
  legal: string
  weight: number
  size: number
}

/** 預設的文字（AI 關著、失敗、被擋時用；AI 開著而且驗過的文字在交貨時才蓋掉它）。 */
export interface PresetText {
  name: string
  desc: string
  quirk_text: string
}

/** 一件等著交貨的零件：框架與預設的文字在加進來的那一刻就定了。 */
export interface Pending {
  id: string
  source: string
  frame: Frame
  preset: PresetText
  /** order：訂做的，時間到了還要到委託台取貨（取貨的地點由 M4-part-sources 加） */
  hold?: 'order'
  ready_at?: number
  request?: string
  from?: string
  at: number
}

export interface UnregState {
  seq: number
  pending: Pending[]
  names: string[]
  once: string[]
}

export const emptyUnreg = (): UnregState => ({ seq: 0, pending: [], names: [], once: [] })

/** 讀 state.ext.unreg：壞掉的整理掉（不是紀錄的、沒有 id 與框架的筆丟掉），不丟錯。回傳的是複本。 */
export function unregOf(state: Pick<GameState, 'ext'>): UnregState {
  const raw = state.ext[EXT]
  const out = emptyUnreg()
  if (!isRecord(raw)) return out
  if (isSafeInt(raw.seq) && raw.seq >= 0) out.seq = raw.seq
  if (Array.isArray(raw.pending)) {
    for (const p of raw.pending) {
      if (!isRecord(p) || !isText(p.id) || !isRecord(p.frame) || out.pending.some((x) => x.id === p.id)) continue
      const pre = isRecord(p.preset) ? p.preset : {}
      out.pending.push({
        id: p.id, source: typeof p.source === 'string' ? p.source : 'gift', frame: clone(p.frame) as unknown as Frame,
        preset: { name: typeof pre.name === 'string' ? pre.name : '', desc: typeof pre.desc === 'string' ? pre.desc : '', quirk_text: typeof pre.quirk_text === 'string' ? pre.quirk_text : '' },
        ...(p.hold === 'order' ? { hold: 'order' as const } : {}), ...(isSafeInt(p.ready_at) ? { ready_at: p.ready_at } : {}),
        ...(typeof p.request === 'string' ? { request: p.request } : {}), ...(typeof p.from === 'string' ? { from: p.from } : {}),
        at: isSafeInt(p.at) ? p.at : 0,
      })
    }
  }
  if (Array.isArray(raw.names)) for (const n of raw.names) if (typeof n === 'string' && n && !out.names.includes(n)) out.names.push(n)
  if (Array.isArray(raw.once)) for (const n of raw.once) if (typeof n === 'string' && n && !out.once.includes(n)) out.once.push(n)
  return out
}

/** 把整份狀態寫回 state.ext（套用變更時用；保留 ext.unreg 裡別人加的鍵不需要：這個鍵只有 unreg 自己寫）。 */
export function writeUnreg(state: Pick<GameState, 'ext'>, u: UnregState): void {
  state.ext[EXT] = clone(u)
}
