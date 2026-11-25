// L6 功能 npcs 的資料與純函式：內容的格式、規則、狀態的形狀、npcOf、關係的階段、今天在哪。不碰登錄表（登錄在 index.ts）。
// 規格：NPC_SYSTEM 第 1、2 節、3.1～3.3、第 5 節（5.1、5.2）、第 7 節、第 12 節；DATA 第 8 節；dev/adr/0016 第三、七節；dev/work/M2-npcs.md。
//
// 三種 NPC：固定的（內容 npc，存檔只記變動）、生成的（存檔 state.ext.npcs.gen 整筆）、臨時的（戰鬥的敵人、事件的路人；有了關係條目就升格）。
// npcOf 讀出來都是同一個形狀（Npc）。

import type { Actor, AttrId, ContentEntry, GameState, GameTime, Kernel, SegmentId, Weekday } from '../../core'
import { ATTR_IDS, Rng, SEGMENT_IDS, clone, hash32, isRecord, isSafeInt, segmentDayOf, segmentOf, segmentWeekdayOf } from '../../core'

export const OWNER = 'npcs'
export const EXT = 'npcs'
export const NPC_KIND = 'npc'
export const GEN_KIND = 'npc_gen'
export const POOL_KIND = 'name_pool'
export const RULE_KIND = 'npc_rule'
/** 個人的親密度（量表）的種類。 */
export const AFFINITY = 'affinity'
/** 臨時角色身上的記號（事件執行器放的；升格時拿掉）。 */
export const TEMP_FLAG = 'event_temp'
/** 這些狀態的人今天不照出沒表（NPC_SYSTEM 5.2 節；id 是核心共用的字彙）。 */
export const ABSENT_CONDITIONS = ['busy', 'lying_low', 'arrested'] as const

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)
const isNat = (v: unknown): v is number => isSafeInt(v) && v >= 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 身分類、性別、傾向軸 ----

export const NPC_KINDS = ['citizen', 'runner', 'staff'] as const
export type NpcKind = (typeof NPC_KINDS)[number]
export const KIND_NAME: Record<NpcKind, string> = { citizen: '街坊', runner: '行者', staff: '職員' }

/** 性別的五個值（DATA 第 1 節）與各自對應的內容篩選標籤（關掉的標籤那一種不會生成）。 */
export const GENDERS = ['female', 'male', 'femboy', 'trans_f', 'futa'] as const
export type Gender = (typeof GENDERS)[number]
export const GENDER_TAG: Record<Gender, string> = { female: 'female_partner', male: 'male_partner', femboy: 'femboy_partner', trans_f: 'trans_partner', futa: 'futa_partner' }
export const BODIES = ['masc', 'fem', 'andro'] as const
export type Body = (typeof BODIES)[number]

/** 傾向的四條軸與標籤的狀態（LEWD_SYSTEM 1.1 節；格式和 lewd 功能存在 actor.ext.tendency 的一樣，這裡不 import）。 */
export const AXES = ['relation', 'sense', 'body', 'costume'] as const
export type Axis = (typeof AXES)[number]
export const TAG_STATES = ['latent', 'has', 'deep'] as const
export type TagState = (typeof TAG_STATES)[number]
export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
export type BridgeParam = (typeof BRIDGE_PARAMS)[number]
export const PATH_SLOTS = ['main', 'sub', 'third'] as const
export type PathSlot = (typeof PATH_SLOTS)[number]

// ---- 資料的形狀 ----

export interface Haunt {
  district: string
  block?: string
  /** 設施的標記（那一塊街區裡的哪一間）或設施的種類 */
  facility?: string
  time?: SegmentId[]
  weekday?: Weekday[]
  weight?: number
}

export interface PathRow {
  path: string
  slot: PathSlot
  tier: number
}

export interface Tendencies {
  axes: Record<Axis, number>
  tags: Record<string, TagState>
}

/** 外貌：這一批只留空的欄位（句子、綽號由之後的批次與內容補）。 */
export type Look = Record<string, unknown>

/** npcOf 回傳的樣子：固定與生成的都是這個形狀。 */
export interface Npc {
  id: string
  name: string
  nick?: string
  kind: NpcKind
  source: 'fixed' | 'gen'
  age: number
  gender?: string
  body?: string
  faction?: string
  occupation?: string
  guard: number
  wealth: number
  home: { district: string; block?: string }
  haunts: Haunt[]
  persona: { attrs: string[]; quadrants: string[] }
  tendencies: Tendencies
  /** 沒有橋的人是 null */
  bridge: Record<BridgeParam, number> | null
  sink: number
  /** 只有行者 */
  paths: PathRow[]
  flags: string[]
  attrs: Record<AttrId, number>
  skills: Record<string, number>
  look: Look
}

/** 內容種類 npc 的一筆（固定 NPC）。只有 id 與名字的是舊的 id 表（DATA 1.1 節）。 */
export interface NpcEntry extends ContentEntry {
  name: string
  [field: string]: unknown
}

/** 內容種類 npc_gen：每區一筆（NPC_SYSTEM 3.1、3.3、13.8 節）。 */
export interface GenEntry extends ContentEntry {
  district: string
  citizens: number
  runners: number
  /** [名字, 權重] */
  occupations: Array<[string, number]>
  /** [勢力 id 或 none, 權重] */
  factions: Array<[string, number]>
  /** 名字池的 id，或 [id, 權重] */
  names: Array<string | [string, number]>
  /** 路數的權重：[路數 id, 權重]；沒寫就是所有路數一樣 */
  paths?: Array<[string, number]>
  /** 出沒表的模板（沒有 district，生成時補這一區）；kind 沒寫就是三種都能用 */
  haunts?: Array<Omit<Haunt, 'district'> & { kind?: NpcKind[] }>
}

/** 內容種類 name_pool。 */
export interface PoolEntry extends ContentEntry {
  given: string[]
  family?: string[]
  /** family_first（姓在前，預設）或 given_first（名在前加「·」） */
  order?: 'family_first' | 'given_first'
}

// ---- 關係（親密度本身在量表裡，這裡是條目） ----

export interface Relation {
  first: GameTime
  last: GameTime
  at?: { district?: string; block?: string }
  /** 已知的事：tendency:<標籤>、bridge、contract、secret:<關鍵字>、recent:<地方> */
  known: string[]
  watch: boolean
  /** 與主角的關係（一句話） */
  relation: string
  /** 稱呼（NPC_SYSTEM 7.0 節；使用者 2026-11-25）：你怎麼叫他、他怎麼叫你，玩家自由填，最多 CALL_MAX 字；沒填就照名字與他的習慣。原樣存，不篩選、不改寫；不改親密度與任何數值 */
  call_them?: string
  call_me?: string
}

/** 稱呼的字數上限（NPC_SYSTEM 7.0 節） */
export const CALL_MAX = 12

export interface RosterEntry {
  /** 名單是不是已經照 npc_gen 建好（臨時的人先升格時只有 ids） */
  built: boolean
  ids: string[]
}

/** 每個人今天做過哪些互動（M2-npc-interact）：day 是記的那一天（state.time.day），換了一天就當成空的。 */
export interface TodayState {
  day: number
  done: Record<string, string[]>
}

/** 共同記憶的地點（NPC_SYSTEM 8.1 節）：區、街區、設施；在內海時另記子網與層（layer: net）。 */
export interface MemoryWhere {
  district?: string
  block?: string
  facility?: string
  layer?: 'net'
  subnet?: string
  depth?: number
}

/** 共同記憶的一筆（NPC_SYSTEM 第 8 節）：重要程度 1 日常、2 重要、3 難忘；merged 是「合併 N 筆」。 */
export interface Memory {
  id: string
  at: GameTime
  where: MemoryWhere
  who: string[]
  text: string
  weight: 1 | 2 | 3
  pinned?: true
  merged?: number
}

/** 一則近況（NPC_SYSTEM 第 9 節）：what 是哪一類的事（job、injured、arrested、debt、near_sink、implant、joined、left、moved、died……）。 */
export interface NewsItem {
  at: GameTime
  what: string
  text: string
}

export interface NpcsState {
  gen: Record<string, Npc>
  rosters: Record<string, RosterEntry>
  seq: Record<string, number>
  rel: Record<string, Relation>
  /** 固定 NPC 的變動（淺層蓋掉內容的欄位） */
  over: Record<string, Partial<Npc>>
  /** 今天做過哪些互動（互動選單的每天次數）；沒有互動過就沒有這個欄位 */
  today?: TodayState
  /** 共同記憶（M2-npc-life）；沒有記過就沒有這個欄位 */
  memories?: Memory[]
  /** 記憶流水號 */
  memSeq?: number
  /** 每個人最多 6 則近況（M2-npc-life） */
  news?: Record<string, NewsItem[]>
}

const emptyState = (): NpcsState => ({ gen: {}, rosters: {}, seq: {}, rel: {}, over: {} })

/** 唯讀：存檔裡的 npcs 狀態（沒有或壞掉的回傳空的）。不要改它。 */
export function readNpcs(state: Pick<GameState, 'ext'>): NpcsState {
  const raw = state.ext[EXT]
  if (!isRecord(raw)) return emptyState()
  const f = (key: keyof NpcsState): Record<string, never> => (isRecord(raw[key]) ? (raw[key] as Record<string, never>) : {})
  return {
    gen: f('gen'), rosters: f('rosters'), seq: f('seq'), rel: f('rel'), over: f('over'),
    ...(isRecord(raw.today) ? { today: raw.today as unknown as TodayState } : {}),
    ...(Array.isArray(raw.memories) ? { memories: raw.memories as Memory[] } : {}),
    ...(isSafeInt(raw.memSeq) ? { memSeq: raw.memSeq } : {}),
    ...(isRecord(raw.news) ? { news: raw.news as unknown as Record<string, NewsItem[]> } : {}),
  } as NpcsState
}

/** 今天（state.time.day）這個人做過哪些互動（沒記過、或記的是別天，就是空的）。 */
export function doneToday(state: Pick<GameState, 'ext' | 'time'>, id: string): string[] {
  const t = readNpcs(state).today
  return t && t.day === state.time.day && isRecord(t.done) && Array.isArray(t.done[id]) ? [...(t.done[id] as string[])] : []
}

/** 變更用：把 npcs 狀態整理好並放回 state.ext，回傳可以直接改的那一份。 */
export function ensureNpcs(state: Pick<GameState, 'ext'>): NpcsState {
  const s = readNpcs(state)
  state.ext[EXT] = s
  return s
}

// ---- 規則（內容種類 npc_rule，id: default 蓋掉內建的數字） ----

type Range = [number, number]
export interface NpcRules {
  age: { min: number; max: number; main: Range; main_chance: number; runner: Range }
  /** 性別的權重（NPC_SYSTEM 4.1 節：女四成、男四成、其餘合計兩成） */
  gender: Record<Gender, number>
  andro_chance: number
  guard: Range
  /** 財富 0～5 各自的權重 */
  wealth: number[]
  persona: { attrs: string[]; attr_count: Range; quadrants: string[][] }
  tendency: { tag_chance: number; axis_max: number; states: Record<TagState, number>; culture: Record<string, string>; culture_mult: number }
  bridge: { none_chance: number; range: Range; bridgeless: string[]; sink: Range }
  stats: { attr: Range; runner_bonus: number; hp_base: number; skills: Record<NpcKind, Range> }
  paths: {
    /** 一條、兩條、三條的權重（60／30／10） */
    counts: [number, number, number]
    /** 這一區的等級從幾起算中、高 */
    mid_from: number
    high_from: number
    tiers: Record<'low' | 'mid' | 'high', Record<PathSlot, Range>>
    by_faction: Record<string, Array<[string, number]>>
  }
  haunt_count: number
  name_tries: number
}

export const DEFAULT_NPC_RULES: NpcRules = {
  age: { min: 18, max: 75, main: [20, 35], main_chance: 0.7, runner: [20, 40] },
  gender: { female: 40, male: 40, femboy: 7, trans_f: 7, futa: 6 },
  andro_chance: 0.1,
  guard: [12, 19],
  wealth: [3, 4, 3, 2, 1, 0.5],
  persona: { attrs: [], attr_count: [1, 2], quadrants: [] },
  tendency: { tag_chance: 0.5, axis_max: 3, states: { latent: 2, has: 7, deep: 1 }, culture: {}, culture_mult: 3 },
  bridge: { none_chance: 0.1, range: [15, 60], bridgeless: [], sink: [5, 20] },
  stats: { attr: [8, 12], runner_bonus: 1, hp_base: 20, skills: { citizen: [1, 1], runner: [3, 3], staff: [1, 2] } },
  paths: {
    counts: [60, 30, 10], mid_from: 2, high_from: 4,
    tiers: {
      low: { main: [1, 2], sub: [1, 1], third: [1, 1] },
      mid: { main: [2, 3], sub: [1, 2], third: [1, 1] },
      high: { main: [3, 4], sub: [2, 3], third: [1, 2] },
    },
    by_faction: {},
  },
  haunt_count: 2,
  name_tries: 30,
}

function merge(base: unknown, over: unknown): unknown {
  if (isRecord(base) && isRecord(over)) {
    const out: Record<string, unknown> = { ...base }
    for (const [key, v] of Object.entries(over)) out[key] = key in base ? merge(base[key], v) : v
    return out
  }
  return over === undefined ? base : over
}

export function npcRules(k: Pick<Kernel, 'content'>): NpcRules {
  const e = k.content.get(RULE_KIND, 'default')
  if (!e) return clone(DEFAULT_NPC_RULES)
  const { id: _id, ...rest } = e
  return merge(clone(DEFAULT_NPC_RULES), rest) as NpcRules
}

const isRange = (v: unknown, lo = -Infinity, hi = Infinity): boolean => Array.isArray(v) && v.length === 2 && v.every((n) => isSafeInt(n) && n >= lo && n <= hi) && (v[0] as number) <= (v[1] as number)

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const rec = (key: string): Record<string, unknown> | null => {
    if (e[key] === undefined) return null
    if (!isRecord(e[key])) {
      p.push(`${key} 要是物件`)
      return null
    }
    return e[key] as Record<string, unknown>
  }
  const age = rec('age')
  if (age) {
    if (age.min !== undefined && !(isSafeInt(age.min) && age.min >= 18)) p.push('age.min 不能低於 18：所有 NPC 都是成年人')
    if (age.max !== undefined && !(isSafeInt(age.max) && age.max >= 18)) p.push('age.max 要是 18 以上的整數')
    for (const f of ['main', 'runner']) if (age[f] !== undefined && !isRange(age[f], 18)) p.push(`age.${f} 要是 [下限, 上限]，都是 18 以上的整數`)
    if (age.main_chance !== undefined && !(isNum(age.main_chance) && age.main_chance >= 0 && age.main_chance <= 1)) p.push('age.main_chance 要是 0～1 的數字')
  }
  const gender = rec('gender')
  if (gender) for (const [g, w] of Object.entries(gender)) if (!(GENDERS as readonly string[]).includes(g) || !(isNum(w) && w >= 0)) p.push(`gender.${g}：性別只有 ${GENDERS.join('、')}，權重要是 0 以上的數字`)
  if (e.andro_chance !== undefined && !(isNum(e.andro_chance) && e.andro_chance >= 0 && e.andro_chance <= 1)) p.push('andro_chance 要是 0～1 的數字')
  if (e.guard !== undefined && !isRange(e.guard, 12, 19)) p.push('guard 要是 [下限, 上限]，在 12～19 之間')
  if (e.wealth !== undefined && !(Array.isArray(e.wealth) && e.wealth.length === 6 && e.wealth.every((n) => isNum(n) && n >= 0))) p.push('wealth 要是 6 個權重（財富 0～5）')
  const persona = rec('persona')
  if (persona) {
    if (persona.attrs !== undefined && !(Array.isArray(persona.attrs) && persona.attrs.every(isText))) p.push('persona.attrs 要是字串的陣列')
    if (persona.attr_count !== undefined && !isRange(persona.attr_count, 0)) p.push('persona.attr_count 要是 [下限, 上限]')
    if (persona.quadrants !== undefined && !(Array.isArray(persona.quadrants) && persona.quadrants.every((q) => Array.isArray(q) && q.every(isText)))) p.push('persona.quadrants 要是「每個象限一個字串陣列」的陣列')
  }
  const tendency = rec('tendency')
  if (tendency) {
    if (tendency.tag_chance !== undefined && !(isNum(tendency.tag_chance) && tendency.tag_chance >= 0 && tendency.tag_chance <= 1)) p.push('tendency.tag_chance 要是 0～1 的數字')
    if (tendency.axis_max !== undefined && !(isSafeInt(tendency.axis_max) && tendency.axis_max >= 1 && tendency.axis_max <= 3)) p.push('tendency.axis_max 要是 1～3 的整數')
    if (tendency.culture_mult !== undefined && !(isNum(tendency.culture_mult) && tendency.culture_mult >= 1)) p.push('tendency.culture_mult 要是 1 以上的數字')
    if (tendency.culture !== undefined && !(isRecord(tendency.culture) && Object.values(tendency.culture).every(isText))) p.push('tendency.culture 要是 { 勢力 id: 標籤 id }')
    if (tendency.states !== undefined && !(isRecord(tendency.states) && Object.entries(tendency.states).every(([s, w]) => (TAG_STATES as readonly string[]).includes(s) && isNum(w) && w >= 0))) p.push('tendency.states 要是 { latent?, has?, deep? } 的權重')
  }
  const bridge = rec('bridge')
  if (bridge) {
    if (bridge.none_chance !== undefined && !(isNum(bridge.none_chance) && bridge.none_chance >= 0 && bridge.none_chance <= 1)) p.push('bridge.none_chance 要是 0～1 的數字')
    for (const f of ['range', 'sink']) if (bridge[f] !== undefined && !isRange(bridge[f], 0, f === 'range' ? 100 : Number.MAX_SAFE_INTEGER)) p.push(`bridge.${f} 要是 [下限, 上限]`)
    if (bridge.bridgeless !== undefined && !(Array.isArray(bridge.bridgeless) && bridge.bridgeless.every(isText))) p.push('bridge.bridgeless 要是勢力 id 的陣列')
  }
  const stats = rec('stats')
  if (stats) {
    if (stats.attr !== undefined && !isRange(stats.attr, 1, 30)) p.push('stats.attr 要是 [下限, 上限]')
    if (stats.runner_bonus !== undefined && !isNat(stats.runner_bonus)) p.push('stats.runner_bonus 要是 0 以上的整數')
    if (stats.hp_base !== undefined && !(isSafeInt(stats.hp_base) && stats.hp_base >= 1)) p.push('stats.hp_base 要是 1 以上的整數')
    if (stats.skills !== undefined && !(isRecord(stats.skills) && Object.entries(stats.skills).every(([kind, r]) => (NPC_KINDS as readonly string[]).includes(kind) && isRange(r, 0)))) p.push('stats.skills 要是 { 街坊／行者／職員的 kind: [下限, 上限] }（每個人有幾項基本功）')
  }
  const paths = rec('paths')
  if (paths) {
    if (paths.counts !== undefined && !(Array.isArray(paths.counts) && paths.counts.length === 3 && paths.counts.every((n) => isNum(n) && n >= 0))) p.push('paths.counts 要是 3 個權重（一條、兩條、三條）')
    for (const f of ['mid_from', 'high_from']) if (paths[f] !== undefined && !isNat(paths[f])) p.push(`paths.${f} 要是 0 以上的整數`)
    if (paths.tiers !== undefined) {
      const t = paths.tiers
      if (!isRecord(t)) p.push('paths.tiers 要是 { low, mid, high }')
      else {
        for (const [band, slots] of Object.entries(t)) {
          if (!['low', 'mid', 'high'].includes(band) || !isRecord(slots)) {
            p.push(`paths.tiers.${band}：只有 low、mid、high，內容要是 { main, sub, third }`)
            continue
          }
          for (const [slot, r] of Object.entries(slots)) if (!(PATH_SLOTS as readonly string[]).includes(slot) || !isRange(r, 1, 5)) p.push(`paths.tiers.${band}.${slot}：要是 [下限, 上限]，階數 1～5`)
        }
      }
    }
    if (paths.by_faction !== undefined && !(isRecord(paths.by_faction) && Object.values(paths.by_faction).every(weightedList))) p.push('paths.by_faction 要是 { 勢力 id: [[路數 id, 權重]] }')
  }
  if (e.haunt_count !== undefined && !isNat(e.haunt_count)) p.push('haunt_count 要是 0 以上的整數')
  if (e.name_tries !== undefined && !(isSafeInt(e.name_tries) && e.name_tries >= 1)) p.push('name_tries 要是 1 以上的整數')
  return p
}

const weightedList = (v: unknown): boolean => Array.isArray(v) && v.every((x) => Array.isArray(x) && x.length === 2 && isText(x[0]) && isNum(x[1]) && x[1] > 0)

// ---- 內容的格式 ----

const haunt = (raw: unknown): { time?: unknown; weekday?: unknown } | null => (isRecord(raw) ? raw : null)

function hauntProblems(raw: unknown, path: string, needDistrict: boolean): string[] {
  const h = haunt(raw)
  if (!h) return [`${path}：要是 { district, block?, facility?, time?, weekday? }`]
  const p: string[] = []
  const r = h as Record<string, unknown>
  if (needDistrict && !isText(r.district)) p.push(`${path}.district 要是區的 id`)
  for (const f of ['block', 'facility']) if (r[f] !== undefined && !isText(r[f])) p.push(`${path}.${f} 要是字串`)
  if (r.time !== undefined) {
    const list = Array.isArray(r.time) ? r.time : [r.time]
    if (list.length === 0 || !list.every((t) => (SEGMENT_IDS as readonly unknown[]).includes(t))) p.push(`${path}.time 要是時段 ${SEGMENT_IDS.join('、')}（一個或一個陣列）`)
  }
  if (r.weekday !== undefined) {
    const list = Array.isArray(r.weekday) ? r.weekday : [r.weekday]
    if (list.length === 0 || !list.every((d) => isSafeInt(d) && d >= 0 && d <= 6)) p.push(`${path}.weekday 要是 0（週一）～6（週日）（一個或一個陣列）`)
  }
  if (r.weight !== undefined && !(isNum(r.weight) && r.weight > 0)) p.push(`${path}.weight 要是大於 0 的數字`)
  return p
}

export function poolProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!(Array.isArray(e.given) && e.given.length > 0 && e.given.every(isText))) p.push('given 要是名字的陣列（至少一個）')
  if (e.family !== undefined && !(Array.isArray(e.family) && e.family.length > 0 && e.family.every(isText))) p.push('family 要是姓的陣列（至少一個）')
  if (e.order !== undefined && e.order !== 'family_first' && e.order !== 'given_first') p.push("order 只能是 'family_first'（姓在前）或 'given_first'（名在前加「·」）")
  return p
}

export function genProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.district)) p.push('district 要是區的 id')
  for (const f of ['citizens', 'runners']) if (!isNat(e[f])) p.push(`${f} 要是 0 以上的整數（這一區的名單有幾個）`)
  if (!weightedList(e.occupations)) p.push('occupations 要是 [[名字, 權重]]')
  if (!weightedList(e.factions)) p.push('factions 要是 [[勢力 id（沒有勢力寫 none）, 權重]]')
  if (!(Array.isArray(e.names) && e.names.every((n) => isText(n) || (Array.isArray(n) && n.length === 2 && isText(n[0]) && isNum(n[1]) && n[1] > 0)))) p.push('names 要是名字池的 id（或 [id, 權重]）的陣列')
  if (e.paths !== undefined && !weightedList(e.paths)) p.push('paths 要是 [[路數 id, 權重]]')
  if (e.haunts !== undefined) {
    if (!Array.isArray(e.haunts)) p.push('haunts 要是出沒表模板的陣列')
    else {
      e.haunts.forEach((h, i) => {
        p.push(...hauntProblems(h, `haunts[${i}]`, false))
        if (isRecord(h) && h.kind !== undefined && !(Array.isArray(h.kind) && h.kind.every((x) => (NPC_KINDS as readonly unknown[]).includes(x)))) p.push(`haunts[${i}].kind 要是 ${NPC_KINDS.join('、')} 的陣列`)
      })
    }
  }
  return p
}

/** 固定 NPC 才有的新欄位；一個都沒有的是舊的 id 表（只有 id 與名字），照舊收。 */
const NEW_FIELDS = ['kind', 'nick', 'age', 'gender', 'body', 'faction', 'occupation', 'guard', 'wealth', 'home', 'haunts', 'persona', 'tendencies', 'bridge', 'sink', 'paths', 'flags', 'attrs', 'skills'] as const

/** 一筆固定 NPC 的格式（載入之後 ready 跑）。 */
export function npcEntryProblems(e: Record<string, unknown>): string[] {
  if (!NEW_FIELDS.some((f) => e[f] !== undefined)) return []
  const p: string[] = []
  const kind = e.kind
  if (!(NPC_KINDS as readonly unknown[]).includes(kind)) p.push(`kind 要是 ${NPC_KINDS.join('、')}（街坊、行者、職員）`)
  if (e.nick !== undefined && !isText(e.nick)) p.push('nick 要是字串')
  if (e.age !== undefined) {
    if (!isSafeInt(e.age)) p.push('age 要是整數')
    else if (e.age < 18) p.push(`所有 NPC 都是成年人：age 要 18 以上（拿到 ${e.age}）`)
  }
  if (e.gender !== undefined && !(GENDERS as readonly unknown[]).includes(e.gender)) p.push(`gender 要是 ${GENDERS.join('、')}`)
  if (e.body !== undefined && !(BODIES as readonly unknown[]).includes(e.body)) p.push(`body 要是 ${BODIES.join('、')}`)
  if (e.faction !== undefined && !isText(e.faction)) p.push('faction 要是勢力的 id')
  if (e.occupation !== undefined && !isText(e.occupation)) p.push('occupation 要是字串')
  if (e.guard !== undefined && !(isSafeInt(e.guard) && e.guard >= 12 && e.guard <= 19)) p.push('guard（警覺）要是 12～19 的整數')
  if (e.wealth !== undefined && !(isSafeInt(e.wealth) && e.wealth >= 0 && e.wealth <= 5)) p.push('wealth（財富）要是 0～5 的整數')
  if (e.home !== undefined && !(isRecord(e.home) && isText(e.home.district) && (e.home.block === undefined || isText(e.home.block)))) p.push('home 要是 { district, block? }')
  if (e.haunts !== undefined) {
    if (!Array.isArray(e.haunts)) p.push('haunts 要是出沒表的陣列')
    else e.haunts.forEach((h, i) => p.push(...hauntProblems(h, `haunts[${i}]`, true)))
  }
  if (e.persona !== undefined && !(isRecord(e.persona) && (e.persona.attrs === undefined || (Array.isArray(e.persona.attrs) && e.persona.attrs.every(isText))) && (e.persona.quadrants === undefined || (Array.isArray(e.persona.quadrants) && e.persona.quadrants.every(isText))))) p.push('persona 要是 { attrs: [字串], quadrants: [字串] }')
  if (e.tendencies !== undefined) {
    const t = e.tendencies
    if (!isRecord(t)) p.push('tendencies 要是 { axes, tags }')
    else {
      if (t.axes !== undefined && !(isRecord(t.axes) && Object.entries(t.axes).every(([a, lv]) => (AXES as readonly string[]).includes(a) && isSafeInt(lv) && lv >= 0 && lv <= 3))) p.push(`tendencies.axes 要是 { ${AXES.join('、')}: 0～3 }`)
      if (t.tags !== undefined && !(isRecord(t.tags) && Object.values(t.tags).every((s) => (TAG_STATES as readonly unknown[]).includes(s)))) p.push(`tendencies.tags 要是 { 標籤 id: ${TAG_STATES.join('、')} }`)
    }
  }
  if (e.bridge !== undefined && e.bridge !== null && !(isRecord(e.bridge) && BRIDGE_PARAMS.every((b) => isSafeInt((e.bridge as Record<string, unknown>)[b]) && (e.bridge as Record<string, number>)[b]! >= 0 && (e.bridge as Record<string, number>)[b]! <= 100))) p.push('bridge 要是 null（沒有橋）或四項橋參數（各 0～100 的整數）')
  if (e.sink !== undefined && !isNat(e.sink)) p.push('sink 要是 0 以上的整數')
  if (e.flags !== undefined && !(Array.isArray(e.flags) && e.flags.every(isText))) p.push('flags 要是字串的陣列（例：no_steal）')
  if (e.attrs !== undefined && !(isRecord(e.attrs) && Object.entries(e.attrs).every(([a, v]) => (ATTR_IDS as readonly string[]).includes(a) && isSafeInt(v) && v >= 1))) p.push(`attrs 要是 { ${ATTR_IDS.join('、')}: 整數 }`)
  if (e.skills !== undefined && !(isRecord(e.skills) && Object.values(e.skills).every((v) => isSafeInt(v) && v >= 0 && v <= 6))) p.push('skills 要是 { 基本功 id: 0～6 }')
  // 路數：只有行者有，而且至少一條、最多三條、有一個主職
  if (kind === 'runner') {
    if (!Array.isArray(e.paths) || e.paths.length < 1 || e.paths.length > 3) p.push('行者要有 paths（一到三條路數）')
    else {
      const slots = new Set<unknown>()
      e.paths.forEach((r, i) => {
        if (!isRecord(r) || !isText(r.path) || !(PATH_SLOTS as readonly unknown[]).includes(r.slot) || !(isSafeInt(r.tier) && r.tier >= 1 && r.tier <= 5)) p.push(`paths[${i}]：要是 { path, slot: ${PATH_SLOTS.join('／')}, tier: 1～5 }`)
        else {
          if (slots.has(r.slot)) p.push(`paths[${i}]：${r.slot} 重複`)
          slots.add(r.slot)
        }
      })
      if (!slots.has('main')) p.push('paths 要有一條主職（slot: main）')
    }
  } else if (kind === 'citizen' || kind === 'staff') {
    if (e.paths !== undefined) p.push(`${KIND_NAME[kind]}沒有路數：不能寫 paths（只有行者有）`)
  }
  return p
}

// ---- 內容與狀態的整體檢查（載入之後 ready 跑） ----

type Cx = Pick<Kernel, 'content'>

/** 跨筆的檢查：固定 NPC 的格式、勢力與區與路數查得到、名單的名字池查得到、每區只有一筆 npc_gen。回傳問題的清單。 */
export function npcsProblems(k: Cx): string[] {
  const p: string[] = []
  const has = (kind: string, id: string) => k.content.has(kind, id)
  const hasKind = (kind: string) => k.content.hasKind(kind)
  for (const e of k.content.list<NpcEntry>(NPC_KIND)) {
    const here = `npc/${e.id}`
    for (const m of npcEntryProblems(e)) p.push(`${here}：${m}`)
    if (isText(e.faction) && !has('faction', e.faction)) p.push(`${here}：勢力 ${e.faction} 不存在`)
    const places: string[] = [...(isRecord(e.home) && isText(e.home.district) ? [e.home.district] : []), ...(Array.isArray(e.haunts) ? e.haunts.filter(isRecord).map((h) => h.district).filter(isText) : [])]
    if (hasKind('district')) for (const d of places) if (!has('district', d)) p.push(`${here}：區 ${d} 不存在`)
    if (Array.isArray(e.paths) && hasKind('path')) for (const r of e.paths) if (isRecord(r) && isText(r.path) && !has('path', r.path)) p.push(`${here}：路數 ${r.path} 不存在`)
  }
  const seen = new Set<string>()
  for (const g of k.content.list<GenEntry>(GEN_KIND)) {
    const here = `${GEN_KIND}/${g.id}`
    if (seen.has(g.district)) p.push(`${here}：區 ${g.district} 已經有一筆名單的規則了`)
    seen.add(g.district)
    if (hasKind('district') && !has('district', g.district)) p.push(`${here}：區 ${g.district} 不存在`)
    for (const [f] of g.factions) if (f !== 'none' && !has('faction', f)) p.push(`${here}：勢力 ${f} 不存在`)
    for (const n of g.names) if (!has(POOL_KIND, Array.isArray(n) ? n[0] : n)) p.push(`${here}：名字池 ${Array.isArray(n) ? n[0] : n} 不存在`)
    if (g.paths && hasKind('path')) for (const [id] of g.paths) if (!has('path', id)) p.push(`${here}：路數 ${id} 不存在`)
  }
  return p
}

// ---- 親密度的階段（NPC_SYSTEM 7.1 節） ----

export interface StageDef {
  id: string
  name: string
  /** 這一段的下限 */
  min: number
}

export const STAGES: readonly StageDef[] = [
  { id: 'foe', name: '仇', min: -100 },
  { id: 'wary', name: '嫌', min: -49 },
  { id: 'stranger', name: '生', min: -19 },
  { id: 'familiar', name: '熟', min: 20 },
  { id: 'close', name: '交心', min: 40 },
  { id: 'dear', name: '親近', min: 60 },
  { id: 'bond', name: '羈絆', min: 80 },
]

export interface StageView extends StageDef {
  index: number
}

/** 親密度的值落在哪一段。 */
export function affinityStage(value: number): StageView {
  let at = 0
  STAGES.forEach((s, i) => {
    if (value >= s.min) at = i
  })
  return { ...STAGES[at]!, index: at }
}

/** 段的 id 或第幾段（0 起算）→ 第幾段；寫錯是 null。 */
export function stageIndex(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < STAGES.length ? v : null
  const i = STAGES.findIndex((s) => s.id === v)
  return i < 0 ? null : i
}

// ---- npcOf ----

const ZERO_TENDENCIES = (): Tendencies => ({ axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: {} })

function asList<T>(v: T | T[] | undefined): T[] | undefined {
  return v === undefined ? undefined : Array.isArray(v) ? v : [v]
}

/** 出沒表的一筆：時段與星期一律整理成陣列。 */
export function normalizeHaunt(h: Record<string, unknown>, district?: string): Haunt {
  const time = asList(h.time as SegmentId | SegmentId[] | undefined)
  const weekday = asList(h.weekday as Weekday | Weekday[] | undefined)
  return {
    district: (h.district as string | undefined) ?? district ?? '',
    ...(h.block !== undefined ? { block: h.block as string } : {}),
    ...(h.facility !== undefined ? { facility: h.facility as string } : {}),
    ...(time ? { time } : {}), ...(weekday ? { weekday } : {}),
    ...(h.weight !== undefined ? { weight: h.weight as number } : {}),
  }
}

/** 固定 NPC：內容的一筆整理成 Npc。沒寫的欄位用預設（舊的 id 表只有名字：街坊、25 歲、沒有橋）。 */
function fromContent(k: Cx, e: NpcEntry): Npc {
  const rules = npcRules(k)
  const haunts = Array.isArray(e.haunts) ? e.haunts.filter(isRecord).map((h) => normalizeHaunt(h)) : []
  const home = isRecord(e.home) ? { district: e.home.district as string, ...(e.home.block !== undefined ? { block: e.home.block as string } : {}) } : { district: haunts[0]?.district ?? '', ...(haunts[0]?.block !== undefined ? { block: haunts[0].block } : {}) }
  const persona = isRecord(e.persona) ? e.persona : {}
  const tend = isRecord(e.tendencies) ? e.tendencies : {}
  const attrs = Object.fromEntries(ATTR_IDS.map((a) => [a, (isRecord(e.attrs) ? (e.attrs[a] as number | undefined) : undefined) ?? 10])) as Record<AttrId, number>
  const bridge = isRecord(e.bridge) ? (Object.fromEntries(BRIDGE_PARAMS.map((b) => [b, (e.bridge as Record<string, number>)[b]!])) as Record<BridgeParam, number>) : null
  return {
    id: e.id, name: e.name, ...(isText(e.nick) ? { nick: e.nick } : {}),
    kind: (NPC_KINDS as readonly unknown[]).includes(e.kind) ? (e.kind as NpcKind) : 'citizen', source: 'fixed',
    age: isSafeInt(e.age) ? e.age : 25,
    ...(isText(e.gender) ? { gender: e.gender } : {}), ...(isText(e.body) ? { body: e.body } : {}),
    ...(isText(e.faction) ? { faction: e.faction } : {}), ...(isText(e.occupation) ? { occupation: e.occupation } : {}),
    guard: isSafeInt(e.guard) ? e.guard : Math.round((rules.guard[0] + rules.guard[1]) / 2),
    wealth: isSafeInt(e.wealth) ? e.wealth : 1,
    home, haunts,
    persona: { attrs: Array.isArray(persona.attrs) ? [...(persona.attrs as string[])] : [], quadrants: Array.isArray(persona.quadrants) ? [...(persona.quadrants as string[])] : [] },
    tendencies: { axes: { ...ZERO_TENDENCIES().axes, ...(isRecord(tend.axes) ? (tend.axes as Record<Axis, number>) : {}) }, tags: isRecord(tend.tags) ? { ...(tend.tags as Record<string, TagState>) } : {} },
    bridge, sink: isNat(e.sink) ? e.sink : 0,
    paths: Array.isArray(e.paths) ? e.paths.filter(isRecord).map((r) => ({ path: r.path as string, slot: r.slot as PathSlot, tier: r.tier as number })) : [],
    flags: Array.isArray(e.flags) ? [...(e.flags as string[])] : [],
    attrs, skills: isRecord(e.skills) ? { ...(e.skills as Record<string, number>) } : {},
    look: {},
  }
}

/**
 * 一個人現在的樣子：生成的讀存檔、固定的讀內容加存檔裡的變動；他已經是角色（actors 裡有）的話，沉溺、橋參數、傾向與路數照角色身上現在的值。
 * 兩種回傳同一個形狀；查不到回傳 undefined（臨時角色沒有資料）。回傳的是複製，改它不影響狀態。
 */
export function npcOf(k: Cx, state: Pick<GameState, 'ext' | 'actors'>, id: string): Npc | undefined {
  const s = readNpcs(state)
  let npc: Npc | undefined
  if (own(s.gen, id)) npc = clone(s.gen[id]!)
  else {
    const e = k.content.get<NpcEntry>(NPC_KIND, id)
    if (!e) return undefined
    npc = fromContent(k, e)
    if (own(s.over, id)) npc = { ...npc, ...clone(s.over[id]!) }
  }
  const a: Actor | undefined = own(state.actors, id) ? state.actors[id] : undefined
  if (a) {
    npc.sink = a.sink
    if (own(a.ext, 'bridge')) npc.bridge = isRecord(a.ext.bridge) ? (Object.fromEntries(BRIDGE_PARAMS.map((b) => [b, (a.ext.bridge as Record<string, number>)[b] ?? 0])) as Record<BridgeParam, number>) : null
    if (isRecord(a.ext.tendency)) {
      const t = a.ext.tendency
      npc.tendencies = { axes: { ...npc.tendencies.axes, ...(isRecord(t.axes) ? (t.axes as Record<Axis, number>) : {}) }, tags: isRecord(t.tags) ? { ...(t.tags as Record<string, TagState>) } : npc.tendencies.tags }
    }
    if (Array.isArray(a.ext.paths)) npc.paths = clone(a.ext.paths as PathRow[])
  }
  return npc
}

/** 這個角色是不是事件執行器放的臨時角色（還沒升格）。 */
export const isTemp = (state: Pick<GameState, 'actors'>, id: string): boolean => own(state.actors, id) && state.actors[id]!.ext[TEMP_FLAG] === true

/** 關係條目（沒有就是還不認識）。 */
export function relationOf(state: Pick<GameState, 'ext'>, id: string): Relation | undefined {
  const s = readNpcs(state)
  return own(s.rel, id) ? clone(s.rel[id]!) : undefined
}

/** 認不認識（有沒有關係條目）。 */
export const knows = (state: Pick<GameState, 'ext'>, id: string): boolean => own(readNpcs(state).rel, id)

/** 已知的事（沒有條目是空的）。 */
export const knownFacts = (state: Pick<GameState, 'ext'>, id: string): string[] => relationOf(state, id)?.known ?? []

export interface KnownFact {
  kind: 'tendency' | 'bridge' | 'contract' | 'secret' | 'recent'
  /** 標籤、關鍵字或去過的地方（bridge 與 contract 沒有） */
  arg?: string
}

/** 已知的事的寫法：tendency:<標籤>（tendency:none 是讀過、沒有傾向）、bridge、contract、secret:<關鍵字>、recent:<去過的區或街區>。 */
export function parseFact(fact: unknown): KnownFact | null {
  if (typeof fact !== 'string') return null
  if (fact === 'bridge' || fact === 'contract') return { kind: fact }
  const m = /^(tendency|secret|recent):(.+)$/.exec(fact)
  return m ? { kind: m[1] as 'tendency' | 'secret' | 'recent', arg: m[2]! } : null
}

/** 已知的事寫成給玩家看的一小段（接在人名後面）：「的傾向「窺視」」。 */
export function knowFactText(fact: string, tagName: (tag: string) => string = (t) => t, placeName: (place: string) => string = (p) => p): string {
  const f = parseFact(fact)
  if (!f) return `的一件事`
  switch (f.kind) {
    case 'tendency': return f.arg === 'none' ? '沒有特別的傾向' : `的傾向「${tagName(f.arg!)}」`
    case 'recent': return `最近去過${placeName(f.arg!)}`
    case 'bridge': return '的橋參數'
    case 'contract': return '的契約'
    case 'secret': return `的秘密（${f.arg}）`
  }
}

// ---- 今天在哪（NPC_SYSTEM 5.2 節）----

/** 所有名單上的人（每一區已經建好的名單，不重複；先固定、後生成的順序照名單）。 */
export function rosterIds(state: Pick<GameState, 'ext'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of Object.values(readNpcs(state).rosters)) {
    for (const id of r.ids) {
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

/** 他在忙別的事（被捕、躲風頭、在忙）：不照出沒表。 */
function absent(state: Pick<GameState, 'actors'>, id: string): boolean {
  const a = own(state.actors, id) ? state.actors[id] : undefined
  return !!a && a.conditions.some((c) => (ABSENT_CONDITIONS as readonly string[]).includes(c.id))
}

/**
 * 他現在這個時段在哪（出沒表的一筆；不在任何地方是 null）。出沒表裡對得上現在的時段與星期的幾筆，用「id 加日子」的固定亂數挑一筆：
 * 同一天、同一個時段永遠是同一筆，所以同一個時刻不會同時在兩個地方；日子換了重算。深夜算前一天（和時段與星期同一個算法）。
 */
export function whereIs(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState, id: string): Haunt | null {
  const npc = npcOf(k, state, id)
  if (!npc || absent(state, id)) return null
  const segment = segmentOf(state.time, k.timeRules)
  const weekday = segmentWeekdayOf(state.time, k.timeRules)
  const day = segmentDayOf(state.time, k.timeRules)
  const options = npc.haunts.filter((h) => (!h.time || h.time.includes(segment)) && (!h.weekday || h.weekday.includes(weekday)))
  if (options.length === 0) return null
  return new Rng(hash32(state.rng.seed, 'npcs/where', id, day)).weighted(options, (h) => h.weight ?? 1)
}

/** 站的那一間設施的種類（location.facility 是標記 id，種類查街區的 facilities；沒有 block 的內容就查不到）。 */
function facilityTypeAt(k: Cx, loc: GameState['location']): string | undefined {
  if (!loc.block || !loc.facility) return undefined
  const b = k.content.get('block', loc.block)
  const f = isRecord(b?.facilities) ? (b.facilities as Record<string, unknown>)[loc.facility] : undefined
  return isRecord(f) && isText(f.type) ? f.type : undefined
}

/** 出沒表的一筆對不對得上這個位置：區要一樣；寫了街區要一樣；寫了設施要站在那一間（標記或種類）；沒寫設施的要在街上（不在設施裡）。 */
export function hauntMatches(k: Cx, h: Haunt, loc: GameState['location']): boolean {
  if (!loc.district || h.district !== loc.district) return false
  if (h.block !== undefined && h.block !== loc.block) return false
  if (h.facility !== undefined) return loc.facility !== undefined && (h.facility === loc.facility || h.facility === facilityTypeAt(k, loc))
  return loc.facility === undefined
}

/** 現在這個位置（區、街區、設施）、時段與星期對得上出沒表的人。名單照順序（固定的在前）。 */
export function npcsHere(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState): Npc[] {
  const out: Npc[] = []
  for (const id of rosterIds(state)) {
    const h = whereIs(k, state, id)
    if (h && hauntMatches(k, h, state.location)) out.push(npcOf(k, state, id)!)
  }
  return out
}
