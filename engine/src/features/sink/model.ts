// L6 功能 sink 的資料與純函式：規則（內建的預設加資料蓋掉）、角色身上的記錄怎麼讀、這一個功能共用的名字。
// 規格：CORE_RULES 4.3 節（分段）；DOWNTIME 3.2、3.3 節；NPCS 8.3 節「隱藏沉溺」；dev/adr/0019 第六節與 P17～P21；dev/work/M4-sink.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { ActorId, Condition, ContentEntry, GameState, Kernel, PassiveEffect } from '../../core'
import { clone, isRecord, isSafeInt, toMinutes, weeklyRule } from '../../core'

export const OWNER = 'sink'
export const RULE_KIND = 'sink_rule'
export const FACILITY_TYPE_KIND = 'facility_type'
/** actor.ext 的鍵。 */
export const EXT = 'sink'
/** 變更種類：改 actor.ext.sink（合併著寫，不會蓋掉別的鍵）。 */
export const EXT_OP = 'sink.ext'
/** 條件與效果與衍生數值的名字。 */
export const SUNK_CONDITION = 'sunk'
export const FLOOR_EFFECT = 'sink_floor'
export const SHOWN_STAT = 'sink_shown'
/** 報告的 action。 */
export const WEEK_ACTION = 'sink.week'
export const THERAPY_ACTION = 'sink.therapy'
/** 斷線靜修進行中的報告（待下去、提早離開）；活動的名字。 */
export const RETREAT_ACTION = 'sink.retreat'
export const RETREAT_ACTIVITY = 'retreat'

/** 沉溺到這個數字就是溺感者（CORE_RULES 4.3 節）。 */
export const SUNK_AT = 100
/** 睡一覺的計數器鍵（features/rest 寫的）：sleeps:<第幾週>。週的編號見 weekOf。 */
export const sleepKey = (week: number): string => `sleeps:${week}`
/** 一次跨好幾週最多補幾次。 */
export const MAX_CATCH_UP = 3
/** 一次斷線靜修的天數換成分鐘。 */
export const MINUTES_PER_DAY = 1440
/** 有期限的下限最長幾天（防呆；一年）。 */
export const MAX_FLOOR_DAYS = 365

export const THERAPY_KINDS = ['counsel', 'retreat'] as const
export type TherapyKind = (typeof THERAPY_KINDS)[number]

export interface BandWeekly {
  /** 每週一發的觸發點（事件導演讀） */
  trigger?: string
  /** 每週替 watchers 的每個勢力加幾點敵對值 */
  hostility?: number
}

export interface SinkBand {
  /** 從這個數字起算（含） */
  min: number
  id: string
  name: string
  /** 這一段給的被動效果（往上累加：落在這一段以上的每一段都給） */
  effects: PassiveEffect[]
  /** 這一段（所在的最高那一段）每週的事 */
  weekly?: BandWeekly
  /** 在這一段時，前面每一段裡檢定類的加減再算一次（P18） */
  double?: boolean
}

export interface SinkRules {
  bands: SinkBand[]
  /** 超過 100 之後每滿這麼多點，承受層數再 +1 */
  over_step: number
  /** 每週自然下降：這一週睡滿 sleeps 次，沉溺 −amount */
  decay: { amount: number; sleeps: number }
  /** 每週替這些勢力加敵對值（band.weekly.hostility） */
  watchers: string[]
  therapy: {
    /** price 乘這一區的物價倍率（district_price，預設乘；M4 收尾修正批） */
    counsel: { amount: number; minutes: number; price: number; per_week: number; district_price: boolean }
    retreat: { amount: number; days: number }
  }
  /** 「一段」是幾點（藥、調校、面具讓別人看到的沉溺低一段時用） */
  hide_step: number
  /** 長時間帶著餘韻：每滿 hours 小時沉溺 +amount（DOWNTIME 3.2 節） */
  afterglow_carry: { hours: number; amount: number }
}

const skillCheck = (skills: string[], amount: number): PassiveEffect => ({ check: { skills }, amount })
const tagCheck = (tags: string[], amount: number): PassiveEffect => ({ check: { tags }, amount })
/** 感知類檢定（CORE_RULES 4.3 節微醺「感知類檢定 +1」；M4-followups-2 第 6 項）：調查（主動找）與街頭直覺（被動察覺）這兩項基本功，或檢定帶 perception 標籤。 */
export const PERCEPTION_SKILLS = ['investigate', 'streetwise'] as const
const perceptionCheck = (amount: number): PassiveEffect => ({ check: { skills: [...PERCEPTION_SKILLS], tags: ['perception'] }, amount })

/** CORE_RULES 4.3 節的分段表。 */
export const DEFAULT_SINK_RULES: SinkRules = {
  bands: [
    { min: 0, id: 'clear', name: '清明', effects: [] },
    { min: 20, id: 'tipsy', name: '微醺', effects: [perceptionCheck(1), tagCheck(['resist_lure'], -1)] },
    {
      min: 40, id: 'indulgent', name: '貪歡',
      effects: [{ stat: 'afterglow_cap', amount: 1 }, { mod: 'load_dealt_pct', amount: 10 }, skillCheck(['composure'], -1)],
      weekly: { trigger: 'impulse' },
    },
    { min: 60, id: 'drunk', name: '迷醉', effects: [skillCheck(['composure'], -1), tagCheck(['resist_control'], -2)], weekly: { hostility: 1 } },
    { min: 80, id: 'edge', name: '溺感邊緣', effects: [], double: true },
    // 100 以上照樣加倍，和 80～99 一致（CORE_RULES 4.3 節；使用者 2026-11-26）：檢定的加減與餘韻的正面效果加倍，承受層數的加成不加倍
    { min: 100, id: 'sunk', name: '溺感', effects: [{ stat: 'afterglow_cap', amount: 2 }], double: true },
  ],
  over_step: 25,
  decay: { amount: 2, sleeps: 4 },
  watchers: [],
  therapy: { counsel: { amount: 5, minutes: 240, price: 1000, per_week: 1, district_price: true }, retreat: { amount: 6, days: 3 } },
  hide_step: 20,
  afterglow_carry: { hours: 6, amount: 1 },
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isCount = (v: unknown, max = 1_000_000): v is number => isSafeInt(v) && v >= 0 && v <= max
const isPositive = (v: unknown, max = 1_000_000): v is number => isSafeInt(v) && v >= 1 && v <= max

function bandProblems(raw: unknown, at: string): string[] {
  if (!isRecord(raw)) return [`${at} 要是 { min, id, name, effects, weekly?, double? }`]
  const p: string[] = []
  if (!isCount(raw.min, 10_000)) p.push(`${at}.min 要是 0～10000 的整數`)
  if (!isText(raw.id)) p.push(`${at}.id 要是文字`)
  if (!isText(raw.name)) p.push(`${at}.name 要是文字`)
  if (!(Array.isArray(raw.effects) && raw.effects.every(isRecord))) p.push(`${at}.effects 要是被動效果的陣列`)
  if (raw.double !== undefined && typeof raw.double !== 'boolean') p.push(`${at}.double 要是 true 或 false`)
  if (raw.weekly !== undefined) {
    const w = raw.weekly
    if (!isRecord(w)) p.push(`${at}.weekly 要是 { trigger?, hostility? }`)
    else {
      if (w.trigger !== undefined && !isText(w.trigger)) p.push(`${at}.weekly.trigger 要是觸發點的名字`)
      if (w.hostility !== undefined && !isCount(w.hostility, 100)) p.push(`${at}.weekly.hostility 要是 0～100 的整數`)
    }
  }
  return p
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.bands !== undefined) {
    if (!Array.isArray(e.bands) || e.bands.length === 0) p.push('bands 要是由低到高的分段的陣列（至少一段）')
    else {
      e.bands.forEach((b, i) => p.push(...bandProblems(b, `bands[${i}]`)))
      const list = e.bands.filter(isRecord)
      if (list.length === e.bands.length && p.length === 0) {
        if (list[0]!.min !== 0) p.push('bands 的第一段 min 要是 0（不然低的沉溺沒有分段可以落）')
        for (let i = 1; i < list.length; i++) if ((list[i]!.min as number) <= (list[i - 1]!.min as number)) p.push(`bands[${i}].min 要比前一段大（由低到高）`)
        const ids = list.map((b) => b.id)
        if (new Set(ids).size !== ids.length) p.push('bands 的 id 不能重複')
      }
    }
  }
  if (e.over_step !== undefined && !isPositive(e.over_step, 10_000)) p.push('over_step 要是 1～10000 的整數')
  if (e.decay !== undefined) {
    const d = e.decay
    if (!isRecord(d)) p.push('decay 要是 { amount, sleeps }')
    else {
      if (d.amount !== undefined && !isCount(d.amount, 1000)) p.push('decay.amount 要是 0～1000 的整數')
      if (d.sleeps !== undefined && !isCount(d.sleeps, 1000)) p.push('decay.sleeps 要是 0～1000 的整數')
    }
  }
  if (e.watchers !== undefined && !(Array.isArray(e.watchers) && e.watchers.every(isText))) p.push('watchers 要是勢力 id 的陣列')
  if (e.therapy !== undefined) {
    const t = e.therapy
    if (!isRecord(t)) p.push('therapy 要是 { counsel, retreat }')
    else {
      const c = t.counsel
      if (c !== undefined) {
        if (!isRecord(c)) p.push('therapy.counsel 要是 { amount, minutes, price, per_week }')
        else {
          if (c.amount !== undefined && !isPositive(c.amount, 1000)) p.push('therapy.counsel.amount 要是 1～1000 的整數')
          if (c.minutes !== undefined && !isCount(c.minutes, 525_600)) p.push('therapy.counsel.minutes 要是 0～525600 的整數（分鐘）')
          if (c.price !== undefined && !isCount(c.price)) p.push('therapy.counsel.price 要是 0～1000000 的整數')
          if (c.per_week !== undefined && !isPositive(c.per_week, 100)) p.push('therapy.counsel.per_week 要是 1～100 的整數')
          if (c.district_price !== undefined && typeof c.district_price !== 'boolean') p.push('therapy.counsel.district_price 要是 true 或 false（心理治療的價錢乘不乘這一區的物價倍率）')
        }
      }
      const r = t.retreat
      if (r !== undefined) {
        if (!isRecord(r)) p.push('therapy.retreat 要是 { amount, days }')
        else {
          if (r.amount !== undefined && !isPositive(r.amount, 1000)) p.push('therapy.retreat.amount 要是 1～1000 的整數')
          if (r.days !== undefined && !isPositive(r.days, 365)) p.push('therapy.retreat.days 要是 1～365 的整數')
        }
      }
    }
  }
  if (e.hide_step !== undefined && !isPositive(e.hide_step, 1000)) p.push('hide_step 要是 1～1000 的整數')
  if (e.afterglow_carry !== undefined) {
    const a = e.afterglow_carry
    if (!isRecord(a)) p.push('afterglow_carry 要是 { hours, amount }')
    else {
      if (a.hours !== undefined && !isPositive(a.hours, 10_000)) p.push('afterglow_carry.hours 要是 1～10000 的整數')
      if (a.amount !== undefined && !isCount(a.amount, 1000)) p.push('afterglow_carry.amount 要是 0～1000 的整數')
    }
  }
  return p
}

/** 現在生效的規則：資料 sink_rule/default 蓋掉內建的預設（格式不對的欄位忽略；decay、therapy、afterglow_carry 逐項蓋）。 */
export function sinkRules(k: Pick<Kernel, 'content'>): SinkRules {
  const out = clone(DEFAULT_SINK_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：[]/)[0]))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('bands')) out.bands = clone(e.bands as SinkBand[])
  if (ok('over_step')) out.over_step = e.over_step as number
  if (ok('decay')) Object.assign(out.decay, clone(e.decay as Record<string, number>))
  if (ok('watchers')) out.watchers = [...(e.watchers as string[])]
  if (ok('therapy')) {
    const t = e.therapy as Record<string, Record<string, number> | undefined>
    if (t.counsel) Object.assign(out.therapy.counsel, t.counsel)
    if (t.retreat) Object.assign(out.therapy.retreat, t.retreat)
  }
  if (ok('hide_step')) out.hide_step = e.hide_step as number
  if (ok('afterglow_carry')) Object.assign(out.afterglow_carry, clone(e.afterglow_carry as Record<string, number>))
  return out
}

// ---- 分段 ----

/** 沉溺 value 落在哪一段（最高的、min 不超過 value 的那一段）。value 比第一段的 min 還低時給第一段。 */
export function bandOf(rules: Pick<SinkRules, 'bands'>, value: number): SinkBand {
  let hit = rules.bands[0]!
  for (const b of rules.bands) if (b.min <= value) hit = b
  return hit
}

/** 下一段（沒有更高的是 null）。 */
export function nextBandOf(rules: Pick<SinkRules, 'bands'>, value: number): SinkBand | null {
  return rules.bands.find((b) => b.min > value) ?? null
}

// ---- 角色身上的記錄 ----

export interface FloorMod {
  amount: number
  /** 到這一分鐘為止（不含）有效；沒寫是永久的 */
  until?: number
  why?: string
}

/** 進行中的斷線靜修（M4 收尾修正批；使用者 2026-11-26）：facility 是設施的名字，since／until 是開始與結束的時間（總分鐘），amount 是結束時沉溺最多降多少，from 是進去時的沉溺。 */
export interface RetreatRec {
  facility: string
  since: number
  until: number
  amount: number
  from: number
}

export interface SinkExt {
  floor_mods: FloorMod[]
  /** 進行中的斷線靜修（活動 retreat）；沒有是不在靜修 */
  retreat?: RetreatRec
  /** 最近一次心理治療在第幾週，與那一週做了幾次 */
  therapy_week?: number
  therapy_n?: number
  /** 餘韻從哪一分鐘起一直帶著，與這一段已經算過幾次沉溺 */
  carry_from?: number
  carry_paid?: number
}

export const blankExt = (): SinkExt => ({ floor_mods: [] })

/** 讀 actor.ext.sink（壞的欄位略過，不讓壞檔擋住遊戲）。 */
export function readExt(state: Pick<GameState, 'actors'>, actor: ActorId): SinkExt {
  const raw = state.actors[actor]?.ext[EXT]
  const out = blankExt()
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.floor_mods)) {
    out.floor_mods = raw.floor_mods
      .filter((m): m is Record<string, unknown> => isRecord(m) && isSafeInt(m.amount) && m.amount !== 0)
      .map((m) => ({ amount: m.amount as number, ...(isSafeInt(m.until) ? { until: m.until } : {}), ...(isText(m.why) ? { why: m.why } : {}) }))
  }
  if (isSafeInt(raw.therapy_week)) out.therapy_week = raw.therapy_week
  if (isSafeInt(raw.therapy_n)) out.therapy_n = raw.therapy_n
  if (isSafeInt(raw.carry_from)) out.carry_from = raw.carry_from
  if (isSafeInt(raw.carry_paid)) out.carry_paid = raw.carry_paid
  const r = raw.retreat
  if (isRecord(r) && isText(r.facility) && isSafeInt(r.since) && isSafeInt(r.until) && isSafeInt(r.amount) && isSafeInt(r.from)) out.retreat = { facility: r.facility, since: r.since, until: r.until, amount: r.amount, from: r.from }
  return out
}

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)

/** 現在還有效的下限加減（沒有期限的永遠有效）。 */
export const liveMods = (ext: SinkExt, now: number): FloorMod[] => ext.floor_mods.filter((m) => m.until === undefined || m.until > now)

/** 這一刻是第幾週（第一個週一 06:00 是第 1 週；和 features/bills 的算法一樣，功能之間不互相 import 所以各寫一份）。 */
export function weekOf(k: Pick<Kernel, 'timeRules'>, at: number): number {
  const rule = weeklyRule(k.timeRules)
  return Math.floor((at - rule.offset) / rule.every) + 1
}

export const nameOf = (state: Pick<GameState, 'actors'>, id: ActorId): string => state.actors[id]?.name ?? id

/** 一種錢的名字。 */
export type Pool = 'cred' | 'cash'
export const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }

/** 付一筆錢用哪一種：指定的就用指定的（不夠回 null）；沒指定先帳戶、不夠再現金。 */
export function payPool(money: GameState['money'], cost: number, want?: Pool): Pool | null {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}

export type SunkCondition = Condition
