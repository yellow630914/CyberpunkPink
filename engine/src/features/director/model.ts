// L6 功能 director 的資料與純函式：內容的格式、狀態的形狀、規則、篩選與權重、對外的檢視。不碰登錄表（登錄在 index.ts、走流程在 flow.ts）。
// 規格：EVENTS 第 1 節、2.1、2.2 節（欄位與條件）、第 3 節（導演）、第 6 節（內容篩選）、第 7 節（設定的樣子）；dev/adr/0016 第四、六節。

import type { ConditionCtx, ContentEntry, GameState, GameTime, Kernel } from '../../core'
import { clone, isRecord, isSafeInt, tagsAllowed, toMinutes } from '../../core'
import type { Condition } from '../../core'

export const OWNER = 'director'
export const EXT = 'director'
export const SCOPE_KIND = 'event_scope'
export const RULE_KIND = 'event_rule'
export const EVENT_KIND = 'event'

/** 類型（EVENTS 3.5 節）：人情、麻煩、機會、傳聞、買賣、慾望。 */
export const CATEGORIES = ['favor', 'trouble', 'opportunity', 'rumor', 'trade', 'desire'] as const
export type EventCategory = (typeof CATEGORIES)[number]

/** 延後的事件、排隊的通知，沒有寫 defer_hours 時最多留幾小時（EVENTS 3.4 節：家園的上門「延後，最多 6 小時」）。 */
export const DEFAULT_DEFER_HOURS = 6
/** 一次跨過好幾天時，daily 與 weekly 各最多補幾次（取最近的幾次）。 */
export const MAX_CATCH_UP = 3

// ---- 內容：範圍、規則、事件 ----

export interface ScopeEntry extends ContentEntry {
  /** 觸發點 → 擲中的機率（0～1） */
  triggers: Record<string, number>
  cooldown_hours?: number
  repeat_days?: number
  daily_cap?: number
  /** 小的先；沒有寫的不排順序（同一回合好幾個擲中時隨機留一個） */
  priority?: number
  lost?: 'drop' | 'defer'
  defer_hours?: number
  /** 副本進行中也擲（EVENTS 3.4 節：副本內只擲這種範圍；也不算在城裡每天的上限裡） */
  in_commission?: boolean
  /** 同一件委託裡，同一件事件不重複（EVENTS 3.3 節「單件不重複：同一件委託不重複」；不看天數，看副本的 id） */
  unique_in_commission?: boolean
  /**
   * 這個範圍的某個觸發點，事件在 triggers 裡寫的是另一個名字：{ pressure: 'stage' } 是壓力條跨過門檻那一擲（機率 15%）用的觸發點，
   * 事件寫的還是 stage（EVENTS 3.1 節：stage ＝ 每個階段開始；壓力條跨過 60）。key 與值都要在 triggers 的表裡。
   */
  events_as?: Record<string, string>
  /** 事件視窗擲檢定的人（M2-event-run 讀；導演只驗格式） */
  roller?: 'pc' | 'best'
  dc_plus?: number
}

/** 範圍補上預設值之後的樣子（導演內部用）。 */
export interface Scope {
  id: string
  triggers: Record<string, number>
  cooldown_hours: number
  repeat_days: number
  daily_cap: number | null
  priority: number | null
  lost: 'drop' | 'defer'
  defer_hours: number
  in_commission: boolean
  unique_in_commission: boolean
  events_as: Record<string, string>
}

export interface EventEntry extends ContentEntry {
  scope: string
  triggers: string[]
  where?: Record<string, string | string[]>
  when?: { time?: string[]; weekday?: number[] }
  requires?: Condition | Condition[]
  weight?: number
  weight_mods?: Array<{ if: Condition; mult: number }>
  category?: EventCategory
  /** 要回應才能繼續（預設是）；false 是通知 */
  blocking?: boolean
  repeat_days?: number
  tags?: string[]
  adult?: boolean
  /** 通知的內文與效果（不擋的事件當場結算；擋住的事件內文由 M2-event-run 定） */
  text?: string
  effects?: Array<Record<string, unknown>>
}

export interface EventRules {
  per_turn: { blocking: number; notices: number }
  city_daily_blocking: number
  category_recent: number
  category_penalty: number
}
/** 照 EVENTS 第 7 節：每回合一件擋住的加兩則通知、城裡每天 8 件、記最近 6 件的類型、每次 ×0.35。 */
export const DEFAULT_EVENT_RULES: EventRules = { per_turn: { blocking: 1, notices: 2 }, city_daily_blocking: 8, category_recent: 6, category_penalty: 0.35 }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNat = (v: unknown): v is number => isSafeInt(v) && v >= 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

export function scopeProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isRecord(e.triggers)) p.push('triggers 要是 { 觸發點: 機率 }')
  else {
    for (const [point, prob] of Object.entries(e.triggers)) {
      if (!isText(point)) p.push('triggers 的觸發點要是字串')
      if (!(isNum(prob) && prob >= 0 && prob <= 1)) p.push(`triggers.${point}：機率要是 0～1 的數字`)
    }
  }
  if (e.cooldown_hours !== undefined && !(isNum(e.cooldown_hours) && e.cooldown_hours >= 0)) p.push('cooldown_hours 要是 0 以上的數字')
  if (e.repeat_days !== undefined && !isNat(e.repeat_days)) p.push('repeat_days 要是 0 以上的整數')
  if (e.daily_cap !== undefined && !(isSafeInt(e.daily_cap) && e.daily_cap >= 1)) p.push('daily_cap 要是 1 以上的整數')
  if (e.priority !== undefined && !isNum(e.priority)) p.push('priority 要是數字（小的先）')
  if (e.lost !== undefined && e.lost !== 'drop' && e.lost !== 'defer') p.push("lost 只能是 'drop' 或 'defer'")
  if (e.defer_hours !== undefined && !(isNum(e.defer_hours) && e.defer_hours > 0)) p.push('defer_hours 要是大於 0 的數字')
  if (e.in_commission !== undefined && typeof e.in_commission !== 'boolean') p.push('in_commission 要是 true 或 false')
  if (e.unique_in_commission !== undefined && typeof e.unique_in_commission !== 'boolean') p.push('unique_in_commission 要是 true 或 false')
  if (e.events_as !== undefined) {
    if (!isRecord(e.events_as) || Object.values(e.events_as).some((v) => !isText(v))) p.push('events_as 要是 { 觸發點: 事件寫的觸發點 }')
    else if (isRecord(e.triggers)) {
      for (const [from, to] of Object.entries(e.events_as)) {
        if (e.triggers[from] === undefined) p.push(`events_as.${from}：這個觸發點不在 triggers 的表裡`)
        if (e.triggers[to as string] === undefined) p.push(`events_as.${from}：${String(to)} 不在 triggers 的表裡`)
      }
    }
  }
  if (e.roller !== undefined && e.roller !== 'pc' && e.roller !== 'best') p.push("roller 只能是 'pc' 或 'best'")
  if (e.dc_plus !== undefined && !isSafeInt(e.dc_plus)) p.push('dc_plus 要是整數')
  return p
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.per_turn !== undefined) {
    if (!isRecord(e.per_turn)) p.push('per_turn 要是 { blocking, notices }')
    else {
      // 同一時間只有一個事件視窗，所以擋住型的事件一回合最多一件
      if (e.per_turn.blocking !== undefined && !(e.per_turn.blocking === 0 || e.per_turn.blocking === 1)) p.push('per_turn.blocking 只能是 0 或 1（同一時間只有一個事件視窗）')
      if (e.per_turn.notices !== undefined && !isNat(e.per_turn.notices)) p.push('per_turn.notices 要是 0 以上的整數')
    }
  }
  if (e.city_daily_blocking !== undefined && !isNat(e.city_daily_blocking)) p.push('city_daily_blocking 要是 0 以上的整數')
  if (e.category_recent !== undefined && !isNat(e.category_recent)) p.push('category_recent 要是 0 以上的整數')
  if (e.category_penalty !== undefined && !(isNum(e.category_penalty) && e.category_penalty >= 0 && e.category_penalty <= 1)) p.push('category_penalty 要是 0～1 的數字')
  return p
}

/** 現在生效的規則：資料 event_rule/default 蓋掉內建的預設。 */
export function eventRules(k: Pick<Kernel, 'content'>): EventRules {
  const e = k.content.get<ContentEntry & Partial<EventRules>>(RULE_KIND, 'default')
  const d = DEFAULT_EVENT_RULES
  return {
    per_turn: { blocking: e?.per_turn?.blocking ?? d.per_turn.blocking, notices: e?.per_turn?.notices ?? d.per_turn.notices },
    city_daily_blocking: e?.city_daily_blocking ?? d.city_daily_blocking,
    category_recent: e?.category_recent ?? d.category_recent,
    category_penalty: e?.category_penalty ?? d.category_penalty,
  }
}

const normalScope = (e: ScopeEntry): Scope => ({
  id: e.id, triggers: { ...e.triggers },
  cooldown_hours: e.cooldown_hours ?? 0, repeat_days: e.repeat_days ?? 0, daily_cap: e.daily_cap ?? null, priority: e.priority ?? null,
  lost: e.lost ?? 'drop', defer_hours: e.defer_hours ?? DEFAULT_DEFER_HOURS, in_commission: e.in_commission === true,
  unique_in_commission: e.unique_in_commission === true, events_as: { ...(e.events_as ?? {}) },
})

/** 每個範圍（照內容載入的順序）。 */
export function scopesOf(k: Pick<Kernel, 'content'>): Scope[] {
  return k.content.list<ScopeEntry>(SCOPE_KIND).map(normalScope)
}

export function scopeOf(k: Pick<Kernel, 'content'>, id: string): Scope | undefined {
  const e = k.content.get<ScopeEntry>(SCOPE_KIND, id)
  return e ? normalScope(e) : undefined
}

// ---- 事件表頭的格式 ----

type Cx = Pick<Kernel, 'conditions'>

function conditionProblems(k: Cx, raw: unknown, path: string): string[] {
  if (Array.isArray(raw)) return raw.flatMap((c, i) => k.conditions.validate(c, `${path}[${i}]`))
  return k.conditions.validate(raw, path)
}

/** 事件表頭的格式（內文的檢查由 addEventBodyCheck 掛上去的函式管；範圍、觸發點與效果要看別的內容，在 directorProblems）。 */
export function eventProblems(k: Cx, e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.scope)) p.push('scope 要是範圍的 id')
  if (!(isTextList(e.triggers) && e.triggers.length > 0)) p.push('triggers 要是觸發點的陣列（至少一個）')
  if (e.where !== undefined) {
    if (!isRecord(e.where)) p.push('where 要是 { 鍵: 值或值的陣列 }')
    else for (const [key, v] of Object.entries(e.where)) if (!(isText(v) || (isTextList(v) && v.length > 0))) p.push(`where.${key} 要是字串或字串的陣列`)
  }
  if (e.when !== undefined) {
    if (!isRecord(e.when)) p.push('when 要是 { time?, weekday? }')
    else {
      for (const key of Object.keys(e.when)) if (key !== 'time' && key !== 'weekday') p.push(`when.${key}：只有 time（時段）與 weekday（星期，0 是週一）`)
      p.push(...k.conditions.validate({ kind: 'time', ...(e.when.time !== undefined ? { segment: e.when.time } : {}), ...(e.when.weekday !== undefined ? { weekday: e.when.weekday } : {}) }, 'when'))
    }
  }
  if (e.requires !== undefined) p.push(...conditionProblems(k, e.requires, 'requires'))
  if (e.weight !== undefined && !(isNum(e.weight) && e.weight >= 0)) p.push('weight 要是 0 以上的數字')
  if (e.weight_mods !== undefined) {
    if (!Array.isArray(e.weight_mods)) p.push('weight_mods 要是 [{ if: 條件, mult }]')
    else {
      e.weight_mods.forEach((m, i) => {
        if (!isRecord(m)) return void p.push(`weight_mods[${i}]：要是 { if, mult }`)
        p.push(...k.conditions.validate(m.if, `weight_mods[${i}].if`))
        if (!(isNum(m.mult) && m.mult >= 0)) p.push(`weight_mods[${i}].mult 要是 0 以上的數字`)
      })
    }
  }
  if (e.category !== undefined && !(CATEGORIES as readonly unknown[]).includes(e.category)) p.push(`category 只能是 ${CATEGORIES.join('、')}`)
  if (e.blocking !== undefined && typeof e.blocking !== 'boolean') p.push('blocking 要是 true 或 false')
  if (e.repeat_days !== undefined && !isNat(e.repeat_days)) p.push('repeat_days 要是 0 以上的整數')
  if (e.tags !== undefined && !isTextList(e.tags)) p.push('tags 要是字串的陣列')
  if (e.adult !== undefined && typeof e.adult !== 'boolean') p.push('adult 要是 true 或 false')
  return p
}

// ---- 內文的檢查：留給 M2-event-run 再掛 ----

/** 內文檢查：回傳錯誤訊息。phase 是 load（載入這一筆時，只看這一筆）或 ready（所有內容都載入之後，可以查引用）。 */
export type EventBodyCheck = (k: Kernel, entry: EventEntry, phase: 'load' | 'ready') => string[]
const bodyChecks = new WeakMap<object, EventBodyCheck[]>()

/** 掛一個內文檢查（選項、檢定、結果的格式；M2-event-run 用）。每個核心各自的清單。 */
export function addEventBodyCheck(k: Kernel, fn: EventBodyCheck): void {
  bodyChecks.set(k, [...(bodyChecks.get(k) ?? []), fn])
}

export function runBodyChecks(k: Kernel, e: EventEntry, phase: 'load' | 'ready'): string[] {
  return (bodyChecks.get(k) ?? []).flatMap((fn) => fn(k, e, phase))
}

/** 通知（blocking: false）的內文：text 是一句話，effects 是效果的陣列。擋住型事件的內文不在這裡看。 */
export function noticeBodyProblems(e: Record<string, unknown>): string[] {
  if (e.blocking !== false) return []
  const p: string[] = []
  if (e.text !== undefined && !isText(e.text)) p.push('text 要是一句話')
  if (e.effects !== undefined && !(Array.isArray(e.effects) && e.effects.every(isRecord))) p.push('effects 要是效果（物件）的陣列')
  return p
}

// ---- 狀態：state.ext.director ----

export interface Queued {
  event: string
  scope: string
  trigger: string
  /** 什麼時候排進去的（總分鐘） */
  from: number
  /** 到這一刻還沒放行就作廢（總分鐘） */
  until: number
}

export interface ScopeState {
  /** 冷卻到什麼時候（總分鐘）：這一刻之前不擲 */
  until: number
  /** 下面的 count 是哪一天的 */
  day: number
  /** 那一天放行了幾件 */
  count: number
}

export interface DirectorState {
  scopes: Record<string, ScopeState>
  /** 每件事上次放行的日子 */
  seen: Record<string, number>
  /** 最近放行的類型（舊的在前），最多 category_recent 個 */
  recent: string[]
  deferred: Queued[]
  notices: Queued[]
  /** 城裡這一天放行了幾件擋住型（不含副本內的範圍） */
  city: { day: number; blocking: number }
  /** 這一回合（key 是那個行動的報告 id）已經放行了幾件擋住型、幾則通知 */
  turn: { key: string; blocking: number; notices: number }
  /**
   * 現在這件委託（id 是委託的副本 id）裡已經放行過的事件（unique_in_commission 的範圍用）。換了一件委託就整份換掉，不留舊的；
   * 回到進去之前（撤退、失敗）時狀態整份回去，所以重來一趟不算「重複」。
   */
  in_commission?: { id: string; events: string[] }
  /**
   * 開著的那一件事件（事件視窗，M2-event-run 管；形狀見 run.ts 的 OpenEvent）。沒有開著的沒有這個欄位。
   * 導演自己不讀它，只在改寫 state.ext.director 時原樣帶著走（整份是一個 ext 變更，不帶就等於把事件視窗關掉）。
   */
  open?: Record<string, unknown>
}

export const emptyDirector = (): DirectorState => ({ scopes: {}, seen: {}, recent: [], deferred: [], notices: [], city: { day: 0, blocking: 0 }, turn: { key: '', blocking: 0, notices: 0 } })

const isQueued = (v: unknown): v is Queued => isRecord(v) && isText(v.event) && isText(v.scope) && typeof v.trigger === 'string' && isSafeInt(v.from) && isSafeInt(v.until)

/** 讀 state.ext.director：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function directorOf(state: Pick<GameState, 'ext'>): DirectorState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const out = emptyDirector()
  if (isRecord(r.scopes)) {
    for (const [id, s] of Object.entries(r.scopes)) if (isRecord(s) && isSafeInt(s.until) && isSafeInt(s.day) && isSafeInt(s.count)) out.scopes[id] = { until: s.until, day: s.day, count: s.count }
  }
  if (isRecord(r.seen)) for (const [id, day] of Object.entries(r.seen)) if (isSafeInt(day)) out.seen[id] = day
  if (Array.isArray(r.recent)) out.recent = r.recent.filter(isText)
  if (Array.isArray(r.deferred)) out.deferred = r.deferred.filter(isQueued).map((q) => clone(q))
  if (Array.isArray(r.notices)) out.notices = r.notices.filter(isQueued).map((q) => clone(q))
  if (isRecord(r.city) && isSafeInt(r.city.day) && isSafeInt(r.city.blocking)) out.city = { day: r.city.day, blocking: r.city.blocking }
  if (isRecord(r.turn) && typeof r.turn.key === 'string' && isSafeInt(r.turn.blocking) && isSafeInt(r.turn.notices)) out.turn = { key: r.turn.key, blocking: r.turn.blocking, notices: r.turn.notices }
  if (isRecord(r.open)) out.open = clone(r.open)
  if (isRecord(r.in_commission) && isText(r.in_commission.id) && isTextList(r.in_commission.events)) out.in_commission = { id: r.in_commission.id, events: [...r.in_commission.events] }
  return out
}

/** 這個範圍在這一天放行了幾件。 */
export const scopeCountToday = (d: DirectorState, scope: string, day: number): number => (d.scopes[scope]?.day === day ? d.scopes[scope]!.count : 0)
/** 城裡這一天放行了幾件擋住型。 */
export const cityBlockingToday = (d: DirectorState, day: number): number => (d.city.day === day ? d.city.blocking : 0)

// ---- 篩選與權重 ----

const condCtx = (k: Pick<Kernel, 'stats' | 'timeRules'>, state: GameState): ConditionCtx => ({ state, stats: k.stats, timeRules: k.timeRules })

/** where 的每一個鍵對觸發點的 where 與 state.location（陣列是任一個）；鍵寫複數（blocks）時也認單數（block）。 */
export function matchesWhere(where: EventEntry['where'], trigger: Record<string, unknown> | undefined, location: Record<string, unknown>): boolean {
  if (!where) return true
  for (const [key, want] of Object.entries(where)) {
    const pick = (src: Record<string, unknown> | undefined): unknown => src?.[key] ?? (key.endsWith('s') ? src?.[key.slice(0, -1)] : undefined)
    const actual = pick(trigger) ?? pick(location)
    if (actual === undefined || actual === null) return false
    const wants = Array.isArray(want) ? want : [want]
    const actuals = Array.isArray(actual) ? actual : [actual]
    if (!actuals.some((a) => wants.includes(a as string))) return false
  }
  return true
}

/** when：時段與星期（照核心的 time 條件：深夜跨過午夜算前一天）。 */
export function matchesWhen(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, when: EventEntry['when']): boolean {
  if (!when) return true
  const cond: Condition = { kind: 'time', ...(when.time !== undefined ? { segment: when.time } : {}), ...(when.weekday !== undefined ? { weekday: when.weekday } : {}) }
  return k.conditions.test(cond, condCtx(k, state))
}

function requiresOk(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, requires: EventEntry['requires']): boolean {
  if (!requires) return true
  const list = Array.isArray(requires) ? requires : [requires]
  return list.every((c) => k.conditions.test(c, condCtx(k, state)))
}

export interface EligibleOpts {
  /** 觸發點帶的 where */
  where?: Record<string, unknown>
  /** 現在（算 repeat_days 用）；沒給就是 state.time */
  at?: GameTime
  /** 不抽的事件 id（已經排在延後或通知佇列裡的） */
  exclude?: ReadonlySet<string>
}

/** 這一次觸發，這個範圍的候選事件：scope 與觸發點對得上，過了內容篩選、不重複天數、where、when、requires。 */
export function eligibleEvents(k: Kernel, state: GameState, scope: Scope, point: string, o: EligibleOpts = {}): EventEntry[] {
  const d = directorOf(state)
  const day = (o.at ?? state.time).day
  // 事件寫的觸發點：有 events_as 的（壓力條那一擲）事件寫的是另一個名字，兩種寫法都收
  const as = scope.events_as[point]
  // 同一件委託不重複：現在進行中的委託（活動 commission 的 id）這一趟已經放行過的事件
  const commission = scope.unique_in_commission ? k.activity.active(state).find((a) => a.kind === 'commission')?.id : undefined
  const done = commission !== undefined && d.in_commission?.id === commission ? d.in_commission.events : []
  return k.content.list<EventEntry>(EVENT_KIND).filter((e) => {
    if (e.scope !== scope.id || !(e.triggers.includes(point) || (as !== undefined && e.triggers.includes(as)))) return false
    if (done.includes(e.id)) return false
    if (o.exclude?.has(e.id)) return false
    if (!tagsAllowed(state.rules, e.tags)) return false
    const repeat = e.repeat_days ?? scope.repeat_days
    const last = d.seen[e.id]
    if (last !== undefined && day - last < repeat) return false
    return matchesWhere(e.where, o.where, state.location as Record<string, unknown>) && matchesWhen(k, state, e.when) && requiresOk(k, state, e.requires)
  })
}

/** 類型平衡：最近放行的 category_recent 件裡，這個類型出現過幾次，權重就 × category_penalty 幾次。 */
export function categoryFactor(k: Pick<Kernel, 'content'>, state: GameState, category: string | undefined): number {
  if (!category) return 1
  const rules = eventRules(k)
  const recent = rules.category_recent > 0 ? directorOf(state).recent.slice(-rules.category_recent) : []
  return rules.category_penalty ** recent.filter((c) => c === category).length
}

/** 一件候選事件現在的權重 ＝ weight ×（成立的 weight_mods 的倍率）× 類型平衡。敵對值、豔名這類共通的修正寫在資料的 weight_mods 裡。 */
export function eventWeight(k: Kernel, state: GameState, e: EventEntry): number {
  let w = e.weight ?? 1
  for (const m of e.weight_mods ?? []) if (k.conditions.test(m.if, condCtx(k, state))) w *= m.mult
  return w * categoryFactor(k, state, e.category)
}

// ---- 載入之後的整體檢查 ----

/**
 * 載入之後的整體檢查：scope 查得到、每個觸發點都在那個範圍的表裡、通知的效果格式對（效果要在內容都載入之後才查得到引用）、內文檢查（phase ready）。
 * 回傳問題的清單，每一條寫出是哪一件事件（空的就是沒問題）。
 */
export function directorProblems(k: Kernel): string[] {
  const p: string[] = []
  const ctx = { state: { time: { day: 1, hour: 0, minute: 0 } }, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as unknown as Parameters<Kernel['effects']['validate']>[1]
  for (const e of k.content.list<EventEntry>(EVENT_KIND)) {
    const scope = k.content.get<ScopeEntry>(SCOPE_KIND, e.scope)
    if (!scope) p.push(`event/${e.id}：scope ${e.scope} 查不到（沒有這個範圍）`)
    else for (const t of e.triggers) if (scope.triggers[t] === undefined) p.push(`event/${e.id}：觸發點 ${t} 不在範圍 ${e.scope} 的表裡（那個範圍的觸發點：${Object.keys(scope.triggers).join('、') || '沒有'}）`)
    if (e.blocking === false && e.effects !== undefined) p.push(...k.effects.validate(e.effects, ctx, 'effects').map((m) => `event/${e.id}：${m}`))
    p.push(...runBodyChecks(k, e, 'ready').map((m) => `event/${e.id}：${m}`))
  }
  return p
}

// ---- 對外的檢視（介面與探針用） ----

export interface DirectorView {
  /** 延後的事件有幾件 */
  deferred: number
  /** 排隊等著的通知有幾則 */
  notices: number
  today: {
    day: number
    /** 今天各範圍加起來放行了幾件（擋住的加通知） */
    released: number
    /** 城裡今天放行了幾件擋住型（不含副本內的範圍；這個數字到 city_daily_blocking 就不再放行） */
    city_blocking: number
  }
  /** 每個放行過的範圍：冷卻還剩幾分鐘（0 是已經可以擲）、今天放行了幾件 */
  scopes: Record<string, { cooldown_left: number; today: number }>
}

export function directorView(state: GameState): DirectorView {
  const d = directorOf(state)
  const now = toMinutes(state.time)
  const day = state.time.day
  const scopes: DirectorView['scopes'] = {}
  let released = 0
  for (const [id, s] of Object.entries(d.scopes)) {
    const today = s.day === day ? s.count : 0
    released += today
    scopes[id] = { cooldown_left: Math.max(0, s.until - now), today }
  }
  return {
    deferred: d.deferred.filter((q) => q.until > now).length,
    notices: d.notices.filter((q) => q.until > now).length,
    today: { day, released, city_blocking: cityBlockingToday(d, day) },
    scopes,
  }
}
