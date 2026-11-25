// L6 功能 tuning 的資料與純函式：規則（內建的預設加資料蓋掉）、調校的內容格式、角色身上的記錄怎麼讀、這一個功能共用的名字。
// 規格：LEWD_SYSTEM 第 1 節「怎麼變」、第 4 節、第 6 節表裡「調校診所」那一列；CYBERWARE 第 1 節；dev/adr/0019 第七節與 P48、P49、P65；dev/work/M4-tuning.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { ActorId, Condition, ContentEntry, GameState, Kernel, PassiveEffect } from '../../core'
import { clone, isRecord, isSafeInt, toMinutes, weeklyRule } from '../../core'

export const OWNER = 'tuning'
export const KIND = 'tuning'
export const RULE_KIND = 'tuning_rule'
export const FACILITY_TYPE_KIND = 'facility_type'
/** actor.ext 的鍵。 */
export const EXT = 'tuning'
/** 報告的 action。 */
export const INSTALL_ACTION = 'tuning.install'
export const REMOVE_ACTION = 'tuning.remove'
export const QUIET_ACTION = 'tuning.quiet'
export const WEEK_ACTION = 'tuning.week'
/** 條件與效果的名字。 */
export const TUNING_CONDITION = 'tuning'
export const TUNING_EFFECT = 'tuning'
export const TUNING_REMOVE_EFFECT = 'tuning_remove'
/** 別的功能的名字（只認名字與格式，不 import）。 */
export const BRIDGE_EFFECT = 'bridge'
export const SINK_EFFECT = 'sink'
export const HAS_BRIDGE = 'has_bridge'
export const AT_FACILITY = 'at_facility'
export const NO_BRIDGE_TEXT = '沒有橋就沒有調校槽。'
/** 一次斷線的鎖可以持續的天數換成分鐘。 */
export const MINUTES_PER_DAY = 1440
export const MAX_LOCK_DAYS = 3650
/** 一次跨好幾週最多補幾次。 */
export const MAX_CATCH_UP = 3

/** 橋的四項參數（features/lewd 的名字；這裡只認名字）。 */
export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
export type BridgeParam = (typeof BRIDGE_PARAMS)[number]
export const PARAM_NAME: Record<BridgeParam, string> = { sensitivity: '敏感度', tolerance: '耐受', craving: '慾求', docility: '馴化' }
export const isParam = (v: unknown): v is BridgeParam => (BRIDGE_PARAMS as readonly unknown[]).includes(v)
export const paramStatId = (p: BridgeParam): string => `bridge_${p}`

/** 傾向的四條軸（features/lewd 的名字）。 */
export const AXES = ['relation', 'sense', 'body', 'costume'] as const
export type Axis = (typeof AXES)[number]
export const AXIS_NAME: Record<Axis, string> = { relation: '關係', sense: '感官', body: '身體', costume: '扮相' }

/** 寫不成被動效果的幾個開關（封閉清單）。 */
export const FLAGS = ['no_load_decay', 'sink_weekly', 'sink_resist', 'no_full_sync', 'afterglow_double', 'hp_to_load'] as const
export type TuningFlag = (typeof FLAGS)[number]
export const isFlag = (v: unknown): v is TuningFlag => (FLAGS as readonly unknown[]).includes(v)
/** 反面的開關：requires 不成立（裝不穩）也照算。其餘是正面的開關，裝不穩就不算。 */
export const NEGATIVE_FLAGS: readonly TuningFlag[] = ['no_load_decay', 'sink_weekly', 'no_full_sync']
export const FLAG_NAME: Record<TuningFlag, string> = {
  no_load_decay: '感載不自然消退', sink_weekly: '沉溺每週 +1', sink_resist: '沉溺每次上升 −1', no_full_sync: '開不了全檔', afterglow_double: '餘韻的正面效果加倍', hp_to_load: '受到的生命傷害有兩成改成感載',
}
/** no_full_sync 用的同步上限衍生數值（核心的 syncCapOf 讀；沒有人定義時 ready 補上）。 */
export const SYNC_CAP_STAT = 'sync_cap_bonus'

export interface TuningEntry extends ContentEntry {
  name: string
  desc: string
  effects: PassiveEffect[]
  requires?: { axis?: Partial<Record<Axis, number>>; tag?: string }
  tags?: string[]
  price?: number
  flags?: TuningFlag[]
  scene?: { sensitivity?: Record<string, number> }
}

export interface TuningRules {
  /** 橋上的調校槽數 */
  slots: number
  install: { price: number; minutes: number }
  remove: { price: number; minutes: number }
  /** 靜室：一次調幾點、價錢、每週幾次、往上調沉溺加幾、花的時間 */
  quiet: { step: number; price: number; per_week: number; sink_up: number; minutes: number }
}

/** LEWD_SYSTEM 第 4 節與 dev/adr/0019 P48。 */
export const DEFAULT_TUNING_RULES: TuningRules = {
  slots: 2,
  install: { price: 300, minutes: 60 },
  remove: { price: 150, minutes: 60 },
  quiet: { step: 5, price: 500, per_week: 1, sink_up: 1, minutes: 120 },
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isCount = (v: unknown, max = 1_000_000): v is number => isSafeInt(v) && v >= 0 && v <= max
const isPositive = (v: unknown, max = 1_000_000): v is number => isSafeInt(v) && v >= 1 && v <= max

/** tuning_rule 的格式檢查。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.slots !== undefined && !isPositive(e.slots, 8)) p.push('slots 要是 1～8 的整數')
  for (const key of ['install', 'remove'] as const) {
    const v = e[key]
    if (v === undefined) continue
    if (!isRecord(v)) { p.push(`${key} 要是 { price, minutes }`); continue }
    if (v.price !== undefined && !isCount(v.price)) p.push(`${key}.price 要是 0～1000000 的整數`)
    if (v.minutes !== undefined && !isCount(v.minutes, 525_600)) p.push(`${key}.minutes 要是 0～525600 的整數（分鐘）`)
  }
  if (e.quiet !== undefined) {
    const q = e.quiet
    if (!isRecord(q)) p.push('quiet 要是 { step, price, per_week, sink_up, minutes }')
    else {
      if (q.step !== undefined && !isPositive(q.step, 100)) p.push('quiet.step 要是 1～100 的整數')
      if (q.price !== undefined && !isCount(q.price)) p.push('quiet.price 要是 0～1000000 的整數')
      if (q.per_week !== undefined && !isPositive(q.per_week, 100)) p.push('quiet.per_week 要是 1～100 的整數')
      if (q.sink_up !== undefined && !isCount(q.sink_up, 1000)) p.push('quiet.sink_up 要是 0～1000 的整數')
      if (q.minutes !== undefined && !isCount(q.minutes, 525_600)) p.push('quiet.minutes 要是 0～525600 的整數（分鐘）')
    }
  }
  return p
}

/** 現在生效的規則：資料 tuning_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function tuningRules(k: Pick<Kernel, 'content'>): TuningRules {
  const out = clone(DEFAULT_TUNING_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：[]/)[0]))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('slots')) out.slots = e.slots as number
  if (ok('install')) Object.assign(out.install, clone(e.install as Record<string, number>))
  if (ok('remove')) Object.assign(out.remove, clone(e.remove as Record<string, number>))
  if (ok('quiet')) Object.assign(out.quiet, clone(e.quiet as Record<string, number>))
  return out
}

/** 調校的內容格式檢查（被動效果的部分要等條件種類都裝好才查得出，放在 index.ts 的 ready）。 */
export function entryProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是一句話')
  if (!isText(e.desc)) p.push('desc 要是一句話')
  if (!Array.isArray(e.effects)) p.push('effects 要是被動效果的陣列（可以是空的）')
  if (e.requires !== undefined) {
    const r = e.requires
    if (!isRecord(r)) p.push('requires 要是 { axis?, tag? }')
    else {
      for (const f of Object.keys(r)) if (f !== 'axis' && f !== 'tag') p.push(`requires 沒有 ${f} 這個欄位（只有 axis、tag）`)
      if (r.tag !== undefined && !isText(r.tag)) p.push('requires.tag 要是傾向標籤的 id')
      if (r.axis !== undefined) {
        if (!isRecord(r.axis)) p.push('requires.axis 要是 { 軸: 最低等級 }')
        else {
          for (const [ax, lv] of Object.entries(r.axis)) {
            if (!(AXES as readonly string[]).includes(ax)) p.push(`requires.axis 的軸 ${ax} 要是 ${AXES.join('、')} 其中一個`)
            else if (!isSafeInt(lv) || lv < 0 || lv > 100) p.push(`requires.axis.${ax} 要是 0～100 的整數`)
          }
        }
      }
    }
  }
  if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(isText))) p.push('tags 要是字串的陣列')
  if (e.price !== undefined && !isCount(e.price)) p.push('price 要是 0～1000000 的整數')
  if (e.flags !== undefined) {
    if (!Array.isArray(e.flags)) p.push('flags 要是開關的陣列')
    else for (const f of e.flags) if (!isFlag(f)) p.push(`flags：「${String(f)}」不在清單裡（可以寫：${FLAGS.join('、')}）`)
  }
  if (e.scene !== undefined) {
    const s = e.scene
    if (!isRecord(s)) p.push('scene 要是 { sensitivity? }')
    else {
      for (const f of Object.keys(s)) if (f !== 'sensitivity') p.push(`scene 沒有 ${f} 這個欄位（只有 sensitivity）`)
      if (s.sensitivity !== undefined) {
        if (!isRecord(s.sensitivity)) p.push('scene.sensitivity 要是 { 部位: 數字 }')
        else for (const [part, n] of Object.entries(s.sensitivity)) if (typeof n !== 'number' || !Number.isFinite(n)) p.push(`scene.sensitivity.${part} 要是數字`)
      }
    }
  }
  for (const f of Object.keys(e)) if (!['id', 'name', 'desc', 'effects', 'requires', 'tags', 'price', 'flags', 'scene'].includes(f)) p.push(`沒有 ${f} 這個欄位`)
  return p
}

// ---- 角色身上的記錄 ----

export interface TuningLock {
  /** 鑰匙在誰手上（角色或勢力的 id，或一句名字） */
  by: string
  /** 到這一分鐘為止（不含）有效；沒寫是永久的 */
  until?: number
}

export interface TuningExt {
  /** 每個槽裡裝的調校 id；沒裝是 null */
  slots: Array<string | null>
  locked: Record<string, TuningLock>
  /** 最近一次在靜室調過是第幾週、那一週調了幾次 */
  quiet_week?: number
  quiet_n?: number
}

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)

/** 這一刻是第幾週（第一個週一 06:00 是第 1 週；功能之間不互相 import，各寫一份）。 */
export function weekOf(k: Pick<Kernel, 'timeRules'>, at: number): number {
  const rule = weeklyRule(k.timeRules)
  return Math.floor((at - rule.offset) / rule.every) + 1
}

/** 讀 actor.ext.tuning（壞的欄位略過；槽數補到規則的數字，不夠的補 null；過了期限的鎖不列）。 */
export function readExt(state: Pick<GameState, 'actors' | 'time'>, actor: ActorId, slots: number): TuningExt {
  const raw = state.actors[actor]?.ext[EXT]
  const out: TuningExt = { slots: Array.from({ length: slots }, () => null), locked: {} }
  if (!isRecord(raw)) return out
  const now = nowOf(state)
  if (Array.isArray(raw.slots)) {
    raw.slots.slice(0, Math.max(slots, 0)).forEach((v, i) => { if (isText(v)) out.slots[i] = v })
  }
  if (isRecord(raw.locked)) {
    for (const [id, lock] of Object.entries(raw.locked)) {
      if (!isRecord(lock) || !isText(lock.by)) continue
      const until = isSafeInt(lock.until) ? lock.until : undefined
      if (until !== undefined && until <= now) continue
      out.locked[id] = { by: lock.by, ...(until !== undefined ? { until } : {}) }
    }
  }
  if (isSafeInt(raw.quiet_week)) out.quiet_week = raw.quiet_week
  if (isSafeInt(raw.quiet_n)) out.quiet_n = raw.quiet_n
  return out
}

/** 要寫回去的值：只留還裝著的鎖。 */
export function writeExt(ext: TuningExt): Record<string, unknown> {
  const locked: Record<string, TuningLock> = {}
  for (const [id, lock] of Object.entries(ext.locked)) if (ext.slots.includes(id)) locked[id] = lock
  return {
    slots: [...ext.slots], locked,
    ...(ext.quiet_week !== undefined ? { quiet_week: ext.quiet_week } : {}), ...(ext.quiet_n !== undefined ? { quiet_n: ext.quiet_n } : {}),
  }
}

export const cloneExt = (ext: TuningExt): TuningExt => clone(ext)

/** 這個人裝著的調校 id（槽的順序，不含空的）。 */
export const installedIds = (ext: TuningExt): string[] => ext.slots.filter((s): s is string => s !== null)

export const entryOf = (k: Pick<Kernel, 'content'>, id: string): TuningEntry | undefined => (k.content.hasKind(KIND) ? k.content.get<TuningEntry>(KIND, id) : undefined)

export const nameOfActor = (state: Pick<GameState, 'actors'>, id: ActorId): string => state.actors[id]?.name ?? id

/** 這個人有橋嗎（用條件 has_bridge 問；沒有人註冊就當沒有）。 */
export function hasBridge(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, actor: ActorId): boolean {
  if (!state.actors[actor] || !k.conditions.kinds().includes(HAS_BRIDGE)) return false
  return k.conditions.test({ kind: HAS_BRIDGE }, { state, actor, stats: k.stats, timeRules: k.timeRules })
}

/** requires 成立嗎（用條件 tendency_axis、tendency_tag 問；沒有人註冊那兩個條件就不成立）。 */
export function stableOf(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, actor: ActorId, entry: TuningEntry): boolean {
  const r = entry.requires
  if (!r) return true
  const ctx = { state, actor, stats: k.stats, timeRules: k.timeRules }
  const known = k.conditions.kinds()
  const checks: Condition[] = []
  if (r.axis) for (const [axis, min] of Object.entries(r.axis)) if (typeof min === 'number' && min > 0) checks.push({ kind: 'tendency_axis', axis, min } as Condition)
  if (r.tag) checks.push({ kind: 'tendency_tag', tag: r.tag } as Condition)
  return checks.every((c) => known.includes(c.kind) && k.conditions.test(c, ctx))
}

/** requires 寫了什麼的一句話（給「裝不穩」的原因用）。 */
export function requiresText(k: Pick<Kernel, 'content'>, entry: TuningEntry): string {
  const r = entry.requires
  if (!r) return ''
  const parts: string[] = []
  if (r.axis) for (const [axis, min] of Object.entries(r.axis)) if (typeof min === 'number' && min > 0) parts.push(`${AXIS_NAME[axis as Axis] ?? axis}${min} 級以上`)
  if (r.tag) {
    const t = k.content.hasKind('tendency_tag') ? (k.content.get<ContentEntry & { name?: unknown }>('tendency_tag', r.tag)?.name as string | undefined) : undefined
    parts.push(`有「${t ?? r.tag}」這個傾向`)
  }
  return parts.join('、')
}

/** 正的那一筆嗎（裝不穩時不算的是這些）：amount 為正的，或加標籤的 unit_tag。 */
export const isPositiveEffect = (e: PassiveEffect): boolean => ('unit_tag' in e ? true : (e as { amount: number }).amount > 0)
