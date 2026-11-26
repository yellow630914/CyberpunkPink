// L6 功能 drugs 的資料與純函式：規則（內建的預設加資料蓋掉）、藥的格式（物品的 drug 欄位）、角色身上的藥狀態（actor.ext.drugs）怎麼讀、這一個功能共用的名字。
// 規格：ITEMS 第 4 節（4.1 成癮與戒斷）；DOWNTIME 3.4、3.5 節；CYBERWARE 第 2 節；LIFE 第 6 節；CRAFTING 5.5 節；dev/adr/0019 第五節與 P13、P20、P65；dev/work/M4-drugs.md。
//
// 不碰登錄表（登記在 index.ts）。

import type { ActorId, ContentEntry, Effect, GameState, GameTime, Kernel, PassiveEffect } from '../../core'
import { MINUTES_PER_DAY, clone, isRecord, isSafeInt, toMinutes, weeklyRule } from '../../core'

export const OWNER = 'drugs'
export const RULE_KIND = 'drug_rule'
export const ITEM_KIND = 'item'
export const FACILITY_TYPE_KIND = 'facility_type'
/** actor.ext 的鍵 */
export const EXT = 'drugs'
/** 戰鬥的效果 op 與戰鬥單位 ext 的鍵 */
export const DRUG_OP = 'drug'

export const USE_ACTION = 'drug.use'
export const DETOX_ACTION = 'drug.detox'
export const WEAR_OFF_ACTION = 'drug.wear_off'
export const SUPPRESSANT_ACTION = 'drug.suppressant'
/** 帳單裡抑制劑那一項（DOWNTIME 5.1 節：第 3 項，帳戶） */
export const SUPPRESSANT_BILL_ID = 'drug.suppressant'
export const SUPPRESSANT_BILL_ORDER = 3

export const MAX_ADDICTION = 100

// ---- 規則 ----

export interface DrugRules {
  /** 每週一，這一週沒用過的藥成癮值 −多少 */
  weekly_decay: number
  /** 成癮值到這裡算依賴；距離最後一次滿 depend_days 天就進入戒斷 */
  depend_at: number
  depend_days: number
  /** 成癮值到這裡算重度：heavy_days 天就戒斷，戒斷的懲罰加倍 */
  heavy_at: number
  heavy_days: number
  /** 持續「一場戰鬥」的藥：戰鬥外吃的話，開打前幾分鐘內吃才撐得到那一場（藥自己的 duration.minutes 優先） */
  prebattle_minutes: number
  /** 診所的戒斷療程：成癮值 −amount、過 days 天、收 price（診所的戒斷療程 600，DOWNTIME 3.5 節；district_price：price 乘這一區的物價倍率，預設乘，M4 收尾修正批） */
  detox: { amount: number; days: number; price: number; district_price: boolean }
  /** 抑制劑：生效中沉溺的下限加 floor（負的）、別人看到的沉溺加 shown（負的）；停藥反彈下限加 rebound、持續 rebound_days 天；一週份的價錢（LIFE 1.2 節的 80） */
  suppressant: { floor: number; shown: number; rebound: number; rebound_days: number; price: number }
}

export const DEFAULT_DRUG_RULES: DrugRules = {
  weekly_decay: 10, depend_at: 40, depend_days: 7, heavy_at: 80, heavy_days: 3, prebattle_minutes: 10,
  detox: { amount: 40, days: 3, price: 600, district_price: true },
  suppressant: { floor: -10, shown: -20, rebound: 15, rebound_days: 14, price: 80 },
}

const isIntIn = (v: unknown, lo: number, hi: number): v is number => isSafeInt(v) && v >= lo && v <= hi
const DETOX_FIELDS = ['amount', 'days', 'price'] as const
const DETOX_BOOLS = ['district_price'] as const
const SUPPRESSANT_FIELDS = ['floor', 'shown', 'rebound', 'rebound_days', 'price'] as const

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const int = (key: string, lo: number, hi: number): void => {
    if (e[key] !== undefined && !isIntIn(e[key], lo, hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  }
  int('weekly_decay', 0, 100)
  int('depend_at', 1, 100)
  int('depend_days', 1, 365)
  int('heavy_at', 1, 100)
  int('heavy_days', 1, 365)
  int('prebattle_minutes', 0, 1440)
  if (isIntIn(e.depend_at, 1, 100) && isIntIn(e.heavy_at, 1, 100) && e.heavy_at < e.depend_at) p.push('heavy_at 不能比 depend_at 小')
  if (e.detox !== undefined) {
    const d = e.detox
    if (!isRecord(d)) p.push('detox 要是 { amount, days, price }')
    else {
      for (const f of Object.keys(d)) if (!(DETOX_FIELDS as readonly string[]).includes(f) && !(DETOX_BOOLS as readonly string[]).includes(f)) p.push(`detox.${f}：沒有這個欄位（${[...DETOX_FIELDS, ...DETOX_BOOLS].join('、')}）`)
      if (d.district_price !== undefined && typeof d.district_price !== 'boolean') p.push('detox.district_price 要是 true 或 false（戒斷療程的價錢乘不乘這一區的物價倍率）')
      if (d.amount !== undefined && !isIntIn(d.amount, 1, 100)) p.push('detox.amount 要是 1～100 的整數')
      if (d.days !== undefined && !isIntIn(d.days, 0, 365)) p.push('detox.days 要是 0～365 的整數')
      if (d.price !== undefined && !isIntIn(d.price, 0, 1_000_000)) p.push('detox.price 要是 0～1000000 的整數')
    }
  }
  if (e.suppressant !== undefined) {
    const s = e.suppressant
    if (!isRecord(s)) p.push('suppressant 要是 { floor, shown, rebound, rebound_days, price }')
    else {
      for (const f of Object.keys(s)) if (!(SUPPRESSANT_FIELDS as readonly string[]).includes(f)) p.push(`suppressant.${f}：沒有這個欄位（${SUPPRESSANT_FIELDS.join('、')}）`)
      for (const f of ['floor', 'shown'] as const) if (s[f] !== undefined && !isIntIn(s[f], -100, 0)) p.push(`suppressant.${f} 要是 -100～0 的整數（下降是負的）`)
      if (s.rebound !== undefined && !isIntIn(s.rebound, 0, 100)) p.push('suppressant.rebound 要是 0～100 的整數')
      if (s.rebound_days !== undefined && !isIntIn(s.rebound_days, 0, 365)) p.push('suppressant.rebound_days 要是 0～365 的整數')
      if (s.price !== undefined && !isIntIn(s.price, 0, 1_000_000)) p.push('suppressant.price 要是 0～1000000 的整數')
    }
  }
  return p
}

/** 現在生效的規則：資料 drug_rule/default 蓋掉內建的預設（格式不對的欄位忽略；detox、suppressant 逐項蓋）。 */
export function drugRules(k: Pick<Kernel, 'content'>): DrugRules {
  const out = clone(DEFAULT_DRUG_RULES)
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  for (const key of ['weekly_decay', 'depend_at', 'depend_days', 'heavy_at', 'heavy_days', 'prebattle_minutes'] as const) if (ok(key)) out[key] = e[key] as number
  if (ok('detox')) {
    const d = e.detox as Record<string, unknown>
    for (const f of DETOX_FIELDS) if (typeof d[f] === 'number') out.detox[f] = d[f] as number
    if (typeof d.district_price === 'boolean') out.detox.district_price = d.district_price
  }
  if (ok('suppressant')) {
    const s = e.suppressant as Record<string, unknown>
    for (const f of SUPPRESSANT_FIELDS) if (typeof s[f] === 'number') out.suppressant[f] = s[f] as number
  }
  return out
}

// ---- 藥的格式（物品的 drug 欄位） ----

export interface DrugDef {
  id: string
  name: string
  /** 持續：minutes（幾分鐘）或 battle（一場戰鬥，戰鬥外吃的話最多撐 minutes，沒寫是規則表的 prebattle_minutes）；沒寫是沒有持續的效果 */
  duration?: { minutes?: number; battle?: true }
  effects: PassiveEffect[]
  side: PassiveEffect[]
  upkeep_load: number
  instant: Effect[]
  after?: { minutes: number; effects: PassiveEffect[]; instant: Effect[] }
  addiction?: { per_dose: number; withdrawal: { days: number; effects: PassiveEffect[] } }
  suppressant: boolean
  eases_withdrawal: boolean
  needs_bridge: boolean
}

const DRUG_KEYS = ['duration', 'effects', 'side', 'upkeep_load', 'instant', 'after', 'addiction', 'suppressant', 'eases_withdrawal', 'needs_bridge'] as const
const AFTER_KEYS = ['minutes', 'effects', 'instant'] as const
const ADDICTION_KEYS = ['per_dose', 'withdrawal'] as const
const WITHDRAWAL_KEYS = ['days', 'effects'] as const

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(isRecord) as unknown as T[]) : [])

/**
 * 這個物品的藥格式；沒有 drug 欄位（或不是物件）是 null。格式不對的欄位當作沒寫（載入時 ready 已經擋過了，這裡只是不丟錯）。
 * 每一次都重新讀內容登錄表裡的那一筆，不快取。
 */
export function drugDef(k: Pick<Kernel, 'content'>, id: string): DrugDef | null {
  if (!k.content.hasKind(ITEM_KIND)) return null
  const e = k.content.get<ContentEntry & { name?: unknown; drug?: unknown }>(ITEM_KIND, id)
  if (!e || !isRecord(e.drug)) return null
  const d = e.drug
  const out: DrugDef = {
    id, name: typeof e.name === 'string' && e.name ? e.name : id,
    effects: list<PassiveEffect>(d.effects), side: list<PassiveEffect>(d.side), upkeep_load: isIntIn(d.upkeep_load, 0, 100) ? d.upkeep_load : 0,
    instant: list<Effect>(d.instant), suppressant: d.suppressant === true, eases_withdrawal: d.eases_withdrawal === true, needs_bridge: d.needs_bridge === true,
  }
  const dur = d.duration
  if (isRecord(dur)) {
    if (dur.battle === true) out.duration = { battle: true, ...(isIntIn(dur.minutes, 1, 525_600) ? { minutes: dur.minutes } : {}) }
    else if (isIntIn(dur.minutes, 1, 525_600)) out.duration = { minutes: dur.minutes }
  }
  if (isRecord(d.after)) out.after = { minutes: isIntIn(d.after.minutes, 0, 525_600) ? d.after.minutes : 0, effects: list<PassiveEffect>(d.after.effects), instant: list<Effect>(d.after.instant) }
  if (isRecord(d.addiction) && isRecord(d.addiction.withdrawal)) {
    const w = d.addiction.withdrawal
    out.addiction = {
      per_dose: isIntIn(d.addiction.per_dose, 0, MAX_ADDICTION) ? d.addiction.per_dose : 0,
      withdrawal: { days: isIntIn(w.days, 1, 365) ? w.days : 1, effects: list<PassiveEffect>(w.effects) },
    }
  }
  return out
}

/** 內容裡每一個帶 drug 欄位的物品 id。 */
export function drugIds(k: Pick<Kernel, 'content'>): string[] {
  if (!k.content.hasKind(ITEM_KIND)) return []
  return k.content.list<ContentEntry & { drug?: unknown }>(ITEM_KIND).filter((e) => isRecord(e.drug)).map((e) => e.id)
}

/** 一個物品的 drug 欄位格式檢查：回傳每一條問題（不含前綴）。passive 與 effect 的檢查由呼叫的人交進來（要等功能都裝好才查得出條件與效果的種類）。 */
export function drugProblems(raw: unknown, check: { passive(v: unknown, path: string): string[]; effects(v: unknown, path: string): string[] }): string[] {
  if (!isRecord(raw)) return ['drug 要是物件']
  const p: string[] = []
  for (const key of Object.keys(raw)) if (!(DRUG_KEYS as readonly string[]).includes(key)) p.push(`drug.${key}：沒有這個欄位（${DRUG_KEYS.join('、')}）`)
  const d = raw.duration
  if (d !== undefined) {
    if (!isRecord(d)) p.push('drug.duration 要是 { minutes } 或 { battle: true, minutes? }')
    else {
      for (const f of Object.keys(d)) if (f !== 'minutes' && f !== 'battle') p.push(`drug.duration.${f}：沒有這個欄位（minutes、battle）`)
      if (d.battle !== undefined && d.battle !== true) p.push('drug.duration.battle 只能寫 true')
      if (d.minutes !== undefined && !isIntIn(d.minutes, 1, 525_600)) p.push('drug.duration.minutes 要是 1～525600 的整數（分鐘）')
      if (d.battle !== true && d.minutes === undefined) p.push('drug.duration 要寫 minutes，或寫 battle: true')
    }
  }
  for (const key of ['effects', 'side'] as const) if (raw[key] !== undefined) p.push(...check.passive(raw[key], `drug.${key}`))
  if (raw.upkeep_load !== undefined && !isIntIn(raw.upkeep_load, 0, 100)) p.push('drug.upkeep_load 要是 0～100 的整數')
  if (raw.instant !== undefined) p.push(...instantProblems(raw.instant, 'drug.instant', check))
  const a = raw.after
  if (a !== undefined) {
    if (!isRecord(a)) p.push('drug.after 要是 { minutes?, effects?, instant? }')
    else {
      for (const f of Object.keys(a)) if (!(AFTER_KEYS as readonly string[]).includes(f)) p.push(`drug.after.${f}：沒有這個欄位（${AFTER_KEYS.join('、')}）`)
      if (a.minutes !== undefined && !isIntIn(a.minutes, 1, 525_600)) p.push('drug.after.minutes 要是 1～525600 的整數（分鐘）')
      if (a.effects !== undefined) p.push(...check.passive(a.effects, 'drug.after.effects'))
      if (a.instant !== undefined) p.push(...instantProblems(a.instant, 'drug.after.instant', check))
      if (a.effects !== undefined && a.minutes === undefined) p.push('drug.after.effects 要搭配 drug.after.minutes（藥效過後的被動效果持續多久）')
      if (a.minutes !== undefined && a.effects === undefined) p.push('drug.after.minutes 要搭配 drug.after.effects')
      if (a.effects === undefined && a.instant === undefined) p.push('drug.after 要寫 effects（加 minutes）或 instant')
    }
  }
  const ad = raw.addiction
  if (ad !== undefined) {
    if (!isRecord(ad)) p.push('drug.addiction 要是 { per_dose, withdrawal: { days, effects } }')
    else {
      for (const f of Object.keys(ad)) if (!(ADDICTION_KEYS as readonly string[]).includes(f)) p.push(`drug.addiction.${f}：沒有這個欄位（${ADDICTION_KEYS.join('、')}）`)
      if (!isIntIn(ad.per_dose, 0, MAX_ADDICTION)) p.push('drug.addiction.per_dose 要是 0～100 的整數')
      const w = ad.withdrawal
      if (!isRecord(w)) p.push('drug.addiction.withdrawal 要是 { days, effects }')
      else {
        for (const f of Object.keys(w)) if (!(WITHDRAWAL_KEYS as readonly string[]).includes(f)) p.push(`drug.addiction.withdrawal.${f}：沒有這個欄位（${WITHDRAWAL_KEYS.join('、')}）`)
        if (!isIntIn(w.days, 1, 365)) p.push('drug.addiction.withdrawal.days 要是 1～365 的整數（天）')
        if (w.effects !== undefined) p.push(...check.passive(w.effects, 'drug.addiction.withdrawal.effects'))
      }
    }
  }
  for (const key of ['suppressant', 'eases_withdrawal', 'needs_bridge'] as const) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') p.push(`drug.${key} 要是 true 或 false`)
  return p
}

/** instant：戰鬥外的效果的陣列；不能再寫 drug（吃一劑裡面又吃一劑會繞圈）。 */
function instantProblems(raw: unknown, path: string, check: { effects(v: unknown, path: string): string[] }): string[] {
  if (!Array.isArray(raw)) return [`${path} 要是效果的陣列`]
  const p = check.effects(raw, path)
  raw.forEach((e, i) => {
    if (isRecord(e) && e.kind === 'drug') p.push(`${path}[${i}]：instant 裡不能再寫 drug（吃一劑會繞圈）`)
  })
  return p
}

// ---- 角色身上的藥狀態（actor.ext.drugs） ----

export interface ActiveDrug {
  id: string
  /** 藥效到什麼時候（總分鐘） */
  until: number
  /** 這一筆被一場戰鬥接住了：不看 until，撐到那一場之後的喘口氣（rest.done）為止 */
  battle?: true
}
export interface AddictionRow {
  value: number
  /** 最後一次用（或成癮被加上）的總分鐘 */
  last: number
  /** 這一週用過（週一的消退看它，過了就歸 false） */
  used_week: boolean
}
export interface WithdrawalRow {
  /** 戒斷到什麼時候（總分鐘） */
  until: number
  heavy: boolean
}
/** 等著發生的事：after 是藥效過後的被動效果，到 at 為止；notice 是「這一劑的藥效結束了」還沒寫成報告（休息時拿掉的，report.after 補一份 drug.wear_off）。 */
export interface PendingRow {
  at: number
  drug: string
  kind: 'after' | 'notice'
}
export interface SuppressantRow {
  /** 這一週有吃（付了帳單或單買一劑）：到什麼時候為止（總分鐘，下一個週一） */
  until?: number
  /** 停藥反彈到什麼時候為止 */
  rebound_until?: number
  /** 開著「每週帳單付抑制劑」 */
  weekly?: boolean
}
export interface DrugsExt {
  active: ActiveDrug[]
  addiction: Record<string, AddictionRow>
  withdrawal: Record<string, WithdrawalRow>
  pending: PendingRow[]
  suppressant?: SuppressantRow
}

export const blankDrugs = (): DrugsExt => ({ active: [], addiction: {}, withdrawal: {}, pending: [] })

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 讀一個人的藥狀態：缺的與壞的欄位補成空的（讀檔修復的格式）。回傳的是複本，可以隨便改。 */
export function readDrugs(state: Pick<GameState, 'actors'>, actor: ActorId): DrugsExt {
  const raw = state.actors[actor]?.ext[EXT]
  const out = blankDrugs()
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.active)) {
    for (const a of raw.active) {
      if (isRecord(a) && typeof a.id === 'string' && a.id && num(a.until)) out.active.push({ id: a.id, until: a.until, ...(a.battle === true ? { battle: true as const } : {}) })
    }
  }
  if (isRecord(raw.addiction)) {
    for (const [id, r] of Object.entries(raw.addiction)) {
      if (isRecord(r) && num(r.value) && r.value > 0) out.addiction[id] = { value: Math.min(MAX_ADDICTION, Math.round(r.value)), last: num(r.last) ? r.last : 0, used_week: r.used_week === true }
    }
  }
  if (isRecord(raw.withdrawal)) {
    for (const [id, r] of Object.entries(raw.withdrawal)) if (isRecord(r) && num(r.until)) out.withdrawal[id] = { until: r.until, heavy: r.heavy === true }
  }
  if (Array.isArray(raw.pending)) {
    for (const p of raw.pending) {
      if (isRecord(p) && num(p.at) && typeof p.drug === 'string' && (p.kind === 'after' || p.kind === 'notice')) out.pending.push({ at: p.at, drug: p.drug, kind: p.kind })
    }
  }
  if (isRecord(raw.suppressant)) {
    const s: SuppressantRow = {}
    if (num(raw.suppressant.until)) s.until = raw.suppressant.until
    if (num(raw.suppressant.rebound_until)) s.rebound_until = raw.suppressant.rebound_until
    if (raw.suppressant.weekly === true) s.weekly = true
    if (Object.keys(s).length > 0) out.suppressant = s
  }
  return out
}

/** 寫回一個人的藥狀態（actor.ext 的變更）。 */
export const writeDrugs = (actor: ActorId, d: DrugsExt): { op: 'actor.ext'; id: ActorId; key: string; value: DrugsExt } => ({ op: 'actor.ext', id: actor, key: EXT, value: clean(d) })

/** 寫出去的樣子：沒有的欄位不寫（suppressant 是空的就不寫）。 */
function clean(d: DrugsExt): DrugsExt {
  const out: DrugsExt = { active: d.active, addiction: d.addiction, withdrawal: d.withdrawal, pending: d.pending }
  if (d.suppressant && Object.keys(d.suppressant).length > 0) out.suppressant = d.suppressant
  return out
}

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)
export const minutesOf = (t: GameTime): number => toMinutes(t)
export const DAY = MINUTES_PER_DAY

/** 這一筆藥效現在還在嗎：被戰鬥接住的撐到休息為止，其餘看 until。 */
export const isLive = (a: ActiveDrug, now: number): boolean => a.battle === true || a.until > now

/** 這個人身上現在有效的藥（沒有重複的 id）。 */
export function liveDrugs(state: Pick<GameState, 'actors' | 'time'>, actor: ActorId): string[] {
  const now = nowOf(state)
  return [...new Set(readDrugs(state, actor).active.filter((a) => isLive(a, now)).map((a) => a.id))]
}

/** 沒有橋是明寫的（P15）：actor.ext.bridge 是 null。沒寫的不算。 */
export const isUnbridged = (state: Pick<GameState, 'actors'>, actor: ActorId): boolean => state.actors[actor]?.ext.bridge === null

/** 現在之後的下一個週一 06:00（總分鐘；剛好站在點上的算下一個）。 */
export function nextMonday(k: Pick<Kernel, 'timeRules'>, now: number): number {
  const rule = weeklyRule(k.timeRules)
  return (Math.floor((now - rule.offset) / rule.every) + 1) * rule.every + rule.offset
}

/** 第 week 週的結算那個週一（總分鐘；第一個週一 06:00 是第 1 週）。 */
export function mondayOf(k: Pick<Kernel, 'timeRules'>, week: number): number {
  const rule = weeklyRule(k.timeRules)
  return rule.offset + (week - 1) * rule.every
}

export const nameOfDrug = (k: Pick<Kernel, 'content'>, id: string): string => drugDef(k, id)?.name ?? id
