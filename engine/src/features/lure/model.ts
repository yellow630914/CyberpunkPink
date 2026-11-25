// L6 功能 lure 的資料與純函式：規則（內建的預設加資料蓋掉）、流竄 AI 的內容格式、state.ext.lure 怎麼讀寫、誰現在可以來。
// 規格：EVENTS 4.8 節；LURE_EVENTS 開頭到「一、蠱惑」的共通規則；CORE_RULES 4.3 節「流竄 AI」；LEWD_SYSTEM 1.1 節、第 9 節；dev/adr/0019 第六節與 P22～P24；dev/work/M4-lure.md。
//
// 不碰登錄表（登記在 index.ts）。傾向（actor.ext.tendency）只認格式：標籤的狀態、軸的等級；不 import lewd。

import type { ActorId, ContentEntry, GameState, Kernel } from '../../core'
import { clone, contentAllowed, isRecord, isSafeInt, toMinutes } from '../../core'

export const OWNER = 'lure'
export const KIND = 'rogue_ai'
export const RULE_KIND = 'lure_rule'
/** state.ext 的鍵。 */
export const EXT = 'lure'

/** 條件與效果的名字。 */
export const OPEN_CONDITION = 'lure_open'
export const MODE_CONDITION = 'lure_mode'
export const COUNT_CONDITION = 'lure_count'
export const LURE_EFFECT = 'lure'

/** 別的功能的名字（只認名字與格式，不 import）。 */
export const TENDENCY_EFFECT = 'tendency'
export const MALWARE_EFFECT = 'malware'
export const MALWARE_CONDITION = 'malware'

/** 報告的 action 與擴散階段的觸發點。 */
export const KISS_ACTION = 'lure.kiss'
export const KISS_POINT = 'kiss_choose'

/** 旗標。 */
export const clueFlag = (ai: string): string => `lure_clue:${ai}`
export const loreFlag = (ai: string, slot: string): string => `ai_lore:${ai}:${slot}`

/** 牠的事：固定的四格，問牠是誰時照這個順序揭開（LURE_EVENTS：原名、牠想要什麼、牠和誰處得來或處不來、牠的群落在哪）。 */
export const LORE_SLOTS = ['origin', 'want', 'ties', 'home'] as const
export type LoreSlot = (typeof LORE_SLOTS)[number]
export const isLoreSlot = (v: unknown): v is LoreSlot => (LORE_SLOTS as readonly unknown[]).includes(v)

/** 傾向的四條軸（只認名字；和 features/lewd 的格式一致）。 */
export const AXES = ['relation', 'sense', 'body', 'costume'] as const
export type Axis = (typeof AXES)[number]
export const isAxis = (v: unknown): v is Axis => (AXES as readonly unknown[]).includes(v)

export const CHOICES = ['follow', 'refuse', 'ask'] as const
export type Choice = (typeof CHOICES)[number]
export const isChoice = (v: unknown): v is Choice => (CHOICES as readonly unknown[]).includes(v)

export const MODES = ['first', 'gated', 'service'] as const
export type Mode = (typeof MODES)[number]
export const isMode = (v: unknown): v is Mode => (MODES as readonly unknown[]).includes(v)

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// ---- 規則 ----

export interface LureRules {
  /** 沉溺超過這個數字，沒有標籤的也會來（EVENTS 4.8 節：65） */
  open_sink: number
  /** 順著牠累計到第幾次，給一則指向粉牆的線索（3） */
  clue_at: number
  /** 順著牠從第幾次起，每次有機會得到牠的吻（5） */
  kiss_from: number
  /** 得到牠的吻的機率（LURE_EVENTS：20%） */
  kiss_chance: number
  /** 有標籤而沉溺超過這個數字，順著牠一定進成人場景（性侍奉；65） */
  service_sink: number
  /** candidates 的權重：基礎、每一級軸的加成、標籤是「深」的倍率（LURE_EVENTS：3、0.2、1.5） */
  weight: number
  axis_step: number
  deep_mult: number
}

export const DEFAULT_LURE_RULES: LureRules = {
  open_sink: 65, clue_at: 3, kiss_from: 5, kiss_chance: 0.2, service_sink: 65, weight: 3, axis_step: 0.2, deep_mult: 1.5,
}

const RULE_FIELDS = ['open_sink', 'clue_at', 'kiss_from', 'kiss_chance', 'service_sink', 'weight', 'axis_step', 'deep_mult'] as const

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const int = (key: string, lo: number, hi: number): void => {
    if (e[key] !== undefined && !(isSafeInt(e[key]) && (e[key] as number) >= lo && (e[key] as number) <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  }
  const num = (key: string, lo: number, hi: number): void => {
    if (e[key] !== undefined && !(typeof e[key] === 'number' && Number.isFinite(e[key]) && (e[key] as number) >= lo && (e[key] as number) <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的數字`)
  }
  int('open_sink', 0, 1000)
  int('clue_at', 1, 1000)
  int('kiss_from', 1, 1000)
  num('kiss_chance', 0, 1)
  int('service_sink', 0, 1000)
  num('weight', 0, 1000)
  num('axis_step', 0, 100)
  num('deep_mult', 0, 100)
  for (const f of Object.keys(e)) if (f !== 'id' && !(RULE_FIELDS as readonly string[]).includes(f)) p.push(`沒有 ${f} 這個欄位（${RULE_FIELDS.join('、')}）`)
  return p
}

/** 現在生效的規則：資料 lure_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function lureRules(k: Pick<Kernel, 'content'>): LureRules {
  const out = clone(DEFAULT_LURE_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  for (const key of RULE_FIELDS) if (e[key] !== undefined && !bad.has(key)) out[key] = e[key] as number
  return out
}

// ---- 內容格式 ----

export interface RogueAiEntry extends ContentEntry {
  /** 自稱 */
  name: string
  /** 對應的傾向標籤（夜后沒有） */
  tag?: string
  axis?: Axis
  /** 內容篩選的標籤（例 ai:媽咪） */
  filter: string
  /** 牠的事：剛好四格，各一句 */
  lore: Record<LoreSlot, string>
  /** 牠的吻是哪一筆惡意韌體 */
  kiss?: string
}

const ENTRY_FIELDS = ['id', 'name', 'tag', 'axis', 'filter', 'lore', 'kiss']

export function entryProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是牠的自稱')
  if (e.tag !== undefined && !isText(e.tag)) p.push('tag 要是傾向標籤的 id')
  if (e.axis !== undefined && !isAxis(e.axis)) p.push(`axis 要是 ${AXES.join('、')} 其中一個`)
  if (!isText(e.filter)) p.push('filter 要是內容篩選的標籤（例 ai:媽咪）')
  if (e.kiss !== undefined && !isText(e.kiss)) p.push('kiss 要是惡意韌體的 id')
  if (!isRecord(e.lore)) p.push(`lore 要是 { ${LORE_SLOTS.join('、')} } 四格，各一句`)
  else {
    for (const slot of LORE_SLOTS) if (!isText(e.lore[slot])) p.push(`lore.${slot} 要是一句話`)
    for (const f of Object.keys(e.lore)) if (!isLoreSlot(f)) p.push(`lore 沒有 ${f} 這一格（只有 ${LORE_SLOTS.join('、')}）`)
  }
  for (const f of Object.keys(e)) if (!ENTRY_FIELDS.includes(f)) p.push(`沒有 ${f} 這個欄位`)
  return p
}

export const entryOf = (k: Pick<Kernel, 'content'>, id: string): RogueAiEntry | undefined => (k.content.hasKind(KIND) ? k.content.get<RogueAiEntry>(KIND, id) : undefined)
export const allEntries = (k: Pick<Kernel, 'content'>): RogueAiEntry[] => (k.content.hasKind(KIND) ? k.content.list<RogueAiEntry>(KIND) : [])

// ---- state.ext.lure ----

export interface LureRow {
  follow: number
  refused: number
  asked: number
  /** 已經揭開的格（照揭開的順序） */
  lore: LoreSlot[]
  /** 最近一次選的那一刻（總分鐘數） */
  last?: number
}

const count = (v: unknown): number => (isSafeInt(v) && v > 0 ? v : 0)

/** 讀一筆（壞掉的欄位用預設）。 */
export function readRow(raw: unknown): LureRow {
  const r = isRecord(raw) ? raw : {}
  const lore: LoreSlot[] = []
  if (Array.isArray(r.lore)) for (const s of r.lore) if (isLoreSlot(s) && !lore.includes(s)) lore.push(s)
  return { follow: count(r.follow), refused: count(r.refused), asked: count(r.asked), lore, ...(isSafeInt(r.last) ? { last: r.last } : {}) }
}

/** 整張表：state.ext.lure（形狀不對的當沒有；回傳複製品）。 */
export function lureOf(state: Pick<GameState, 'ext'>): Record<string, LureRow> {
  const raw = state.ext[EXT]
  const out: Record<string, LureRow> = {}
  if (!isRecord(raw)) return out
  for (const [id, row] of Object.entries(raw)) if (isRecord(row)) out[id] = readRow(row)
  return out
}

export const writeRow = (row: LureRow): Record<string, unknown> => ({ ...row, lore: [...row.lore] })
export const extValue = (rows: Record<string, LureRow>): Record<string, Record<string, unknown>> => Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, writeRow(r)]))

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)

// ---- 傾向與沉溺 ----

export type TagState = 'latent' | 'has' | 'deep'

/** 這個人身上某個標籤的狀態（讀 actor.ext.tendency.tags；沒有這一筆是 null）。 */
export function tagState(state: Pick<GameState, 'actors'>, actor: ActorId, tag: string): TagState | null {
  const t = state.actors[actor]?.ext.tendency
  if (!isRecord(t) || !isRecord(t.tags)) return null
  const s = t.tags[tag]
  return s === 'latent' || s === 'has' || s === 'deep' ? s : null
}

/** 那一軸的等級（讀 actor.ext.tendency.axes；沒有是 0）。 */
export function axisLevel(state: Pick<GameState, 'actors'>, actor: ActorId, axis: Axis | undefined): number {
  if (!axis) return 0
  const t = state.actors[actor]?.ext.tendency
  const v = isRecord(t) && isRecord(t.axes) ? t.axes[axis] : undefined
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

/** 真正的沉溺（角色身上的軌；不是別人看到的 sink_shown）。 */
export const realSink = (state: Pick<GameState, 'actors'>, actor: ActorId): number => state.actors[actor]?.sink ?? 0

/** 主角「有」牠的標籤（有或深）。牠沒有標籤（夜后）永遠不算有。 */
export function ownsTag(state: Pick<GameState, 'actors'>, actor: ActorId, e: RogueAiEntry): boolean {
  if (e.tag === undefined) return false
  const s = tagState(state, actor, e.tag)
  return s === 'has' || s === 'deep'
}

/** 牠的 filter 與 tag 都沒被玩家關掉。 */
export const allowed = (state: Pick<GameState, 'rules'>, e: RogueAiEntry): boolean =>
  contentAllowed(state.rules, e.filter) && (e.tag === undefined || contentAllowed(state.rules, e.tag))

/** 這個流竄 AI 現在可以來：沒被篩選關掉，而且（主角有牠的標籤，或真正的沉溺超過 open_sink）。 */
export function isOpen(state: Pick<GameState, 'actors' | 'rules'>, actor: ActorId, e: RogueAiEntry, rules: LureRules): boolean {
  return allowed(state, e) && (ownsTag(state, actor, e) || realSink(state, actor) > rules.open_sink)
}

/**
 * 這一次是哪一個版本（P24）：first＝牠有標籤可以給而主角還沒有（這一次會得到）；
 * 其餘看沉溺：不超過 service_sink 是 gated，超過是 service。牠沒有標籤（夜后）沒有「得到」這回事，只分 gated 與 service。
 */
export function modeOf(state: Pick<GameState, 'actors'>, actor: ActorId, e: RogueAiEntry, rules: LureRules): Mode {
  if (e.tag !== undefined && !ownsTag(state, actor, e)) return 'first'
  return realSink(state, actor) > rules.service_sink ? 'service' : 'gated'
}
