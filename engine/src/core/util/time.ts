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
