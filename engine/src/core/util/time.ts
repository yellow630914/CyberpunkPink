// L1 純工具：時間。全專案只有這一組換算（ElondiaRPG 有約 17 個，CODESCAN 2.1 節）。
// 起算方式只有一種：第 1 天 00:00 是第 0 分鐘。

import type { GameTime, SegmentId, Weekday } from '../types/time'
import { SEGMENT_IDS } from '../types/time'

export const MINUTES_PER_DAY = 1440
/** 一個時段 4 小時（CORE_RULES 7.4 節）。 */
export const SEGMENT_HOURS = 4

/** 時段與星期的兩個參數（CORE_RULES 7.4 節已定案的值是預設值）。 */
export interface TimeRules {
  /** 清晨這個時段從幾點開始；之後每 4 小時一個時段 */
  dawnHour: number
  /** day % 7 等於這個數字的那一天是週一（收租日） */
  mondayRemainder: number
}
/** 清晨 3～7、上午 7～11、中午 11～15、下午 15～19、黃金時段 19～23、深夜 23～3；第 1 天週二，第 7、14、21 天週一。 */
export const DEFAULT_TIME_RULES: TimeRules = { dawnHour: 3, mondayRemainder: 0 }

export function toMinutes(t: GameTime): number {
  return (t.day - 1) * MINUTES_PER_DAY + t.hour * 60 + t.minute
}

export function fromMinutes(total: number): GameTime {
  const m = Math.max(0, Math.floor(total))
  return { day: Math.floor(m / MINUTES_PER_DAY) + 1, hour: Math.floor((m % MINUTES_PER_DAY) / 60), minute: m % 60 }
}

/** 往後推若干分鐘。時間只往前走：負數當 0。 */
export function addMinutes(t: GameTime, minutes: number): GameTime {
  return fromMinutes(toMinutes(t) + Math.max(0, Math.round(minutes)))
}

export function addHours(t: GameTime, hours: number): GameTime {
  return addMinutes(t, hours * 60)
}

export function minutesBetween(from: GameTime, to: GameTime): number {
  return toMinutes(to) - toMinutes(from)
}

export function segmentOf(t: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): SegmentId {
  const h = (t.hour - rules.dawnHour + 24) % 24
  return SEGMENT_IDS[Math.floor(h / SEGMENT_HOURS)]!
}

/**
 * 這個時段算在第幾天：深夜跨過午夜，午夜到清晨之前算前一天的最後一段（CORE_RULES 7.4 節）。
 * 排事情（事件的「週四深夜」、班表）用這個；畫面上的日期與收租日用日曆的 t.day。
 */
export function segmentDayOf(t: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): number {
  return t.hour < rules.dawnHour ? t.day - 1 : t.day
}

const weekdayOfDay = (day: number, rules: TimeRules): Weekday => ((((day - rules.mondayRemainder) % 7) + 7) % 7) as Weekday

/** 日曆上的星期（午夜換日）。0＝週一。第 1 天是週二，第 7、14、21 天是週一。 */
export function weekdayOf(t: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): Weekday {
  return weekdayOfDay(t.day, rules)
}

/** 這個時段算在星期幾：和 weekdayOf 只差在午夜到清晨之前（那一段算前一天的深夜）。事件的時間條件用這個。 */
export function segmentWeekdayOf(t: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): Weekday {
  return weekdayOfDay(segmentDayOf(t, rules), rules)
}

/** 離下一個星期幾還有幾天（日曆的天數；今天就是的話回傳 0）。例：離收租日（週一，0）還有幾天。 */
export function daysUntilWeekday(t: GameTime, weekday: Weekday, rules: TimeRules = DEFAULT_TIME_RULES): number {
  return (((weekday - weekdayOf(t, rules)) % 7) + 7) % 7
}

/** 到下一個時段開始還有幾分鐘（剛好在邊界上回傳一整個時段）。 */
export function minutesToNextSegment(t: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): number {
  const into = (((t.hour - rules.dawnHour + 24) % 24) % SEGMENT_HOURS) * 60 + t.minute
  return SEGMENT_HOURS * 60 - into
}

/** 「第 14 天 17:20」 */
export function formatTime(t: GameTime): string {
  return `第 ${t.day} 天 ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

/** 一段時間的白話：「2 小時 30 分鐘」「3 小時」「20 分鐘」。給玩家看的提醒照實寫，不四捨五入成整數小時。 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60), rest = m % 60
  if (h === 0) return `${rest} 分鐘`
  return rest === 0 ? `${h} 小時` : `${h} 小時 ${rest} 分鐘`
}

export function isValidTime(t: unknown): t is GameTime {
  if (!t || typeof t !== 'object') return false
  const { day, hour, minute } = t as Record<string, unknown>
  return Number.isSafeInteger(day) && (day as number) >= 1 && Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23
    && Number.isInteger(minute) && (minute as number) >= 0 && (minute as number) <= 59
}

// ---- 跨過的時間點（dev/adr/0016 第六節）：每天 08:00、每週一 06:00 這類「走過這一刻就發生」的事共用 ----

/** 一種週期的時間點：每 every 分鐘一個，落在「第 1 天 00:00 起算的總分鐘數」除以 every 的餘數等於 offset 的那些刻。 */
export interface CrossingRule {
  /** 週期（分鐘），正整數 */
  every: number
  /** 週期裡的第幾分鐘（整數；可以超出 0～every − 1，照餘數算） */
  offset: number
}

/** crossings 最多回傳幾個點；超過丟錯（多半是 every 寫得太小，或時間差大得不合理）。要數量就用 countCrossings。 */
export const MAX_CROSSINGS = 100_000
/** 每天的時間點：08:00（EVENTS 3.1 節，導演的 daily）。 */
export const DAILY_AT_MINUTE = 8 * 60
/** 每週的時間點：週一 06:00（DOWNTIME 5.1 節，收租日與每週的事）。 */
export const WEEKLY_AT_MINUTE = 6 * 60

const mod = (n: number, m: number): number => ((n % m) + m) % m

function checkRule(rule: CrossingRule): number {
  if (!Number.isSafeInteger(rule.every) || rule.every < 1) throw new RangeError(`crossings：every 要是正整數（拿到 ${String(rule.every)}）`)
  if (!Number.isSafeInteger(rule.offset)) throw new RangeError(`crossings：offset 要是整數（拿到 ${String(rule.offset)}）`)
  return mod(rule.offset, rule.every)
}

/** 從 from 走到 to，跨過了幾個時間點。（from, to]：剛好站在點上出發的不算，剛好走到點上的算；同一刻、或 to 比 from 早，是 0。 */
export function countCrossings(from: GameTime, to: GameTime, rule: CrossingRule): number {
  const off = checkRule(rule)
  const a = toMinutes(from), b = toMinutes(to)
  if (b <= a) return 0
  return Math.floor((b - off) / rule.every) - Math.floor((a - off) / rule.every)
}

/**
 * 從 from 走到 to，跨過的每一個時間點（照時間順序）。規矩同 countCrossings：（from, to]。
 * 跨過超過 MAX_CROSSINGS 個丟 RangeError。
 */
export function crossings(from: GameTime, to: GameTime, rule: CrossingRule): GameTime[] {
  const n = countCrossings(from, to, rule)
  if (n > MAX_CROSSINGS) throw new RangeError(`crossings：跨過了 ${n} 個時間點，超過 ${MAX_CROSSINGS}`)
  if (n === 0) return []
  const off = mod(rule.offset, rule.every)
  const first = (Math.floor((toMinutes(from) - off) / rule.every) + 1) * rule.every + off
  return Array.from({ length: n }, (_, i) => fromMinutes(first + i * rule.every))
}

/** 每天 08:00 的規則。 */
export const DAILY_RULE: CrossingRule = { every: MINUTES_PER_DAY, offset: DAILY_AT_MINUTE }

/** 每週一 06:00 的規則（哪一天是週一照時段規則 TimeRules.mondayRemainder：預設第 7、14、21 天）。 */
export function weeklyRule(rules: TimeRules = DEFAULT_TIME_RULES): CrossingRule {
  const r = mod(rules.mondayRemainder, 7)
  const firstMonday = r === 0 ? 7 : r
  return { every: 7 * MINUTES_PER_DAY, offset: (firstMonday - 1) * MINUTES_PER_DAY + WEEKLY_AT_MINUTE }
}

/** 跨過的每一個「每天 08:00」。 */
export function dailyCrossings(from: GameTime, to: GameTime): GameTime[] {
  return crossings(from, to, DAILY_RULE)
}

/** 跨過的每一個「每週一 06:00」（週一照 TimeRules）。 */
export function weeklyCrossings(from: GameTime, to: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): GameTime[] {
  return crossings(from, to, weeklyRule(rules))
}
