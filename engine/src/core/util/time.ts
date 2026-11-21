// L1 純工具：時間。全專案只有這一組換算（ElondiaRPG 有約 17 個，CODESCAN 2.1 節）。
// 起算方式只有一種：第 1 天 00:00 是第 0 分鐘。

import type { GameTime, SegmentId, Weekday } from '../types/time'
import { SEGMENT_IDS } from '../types/time'

export const MINUTES_PER_DAY = 1440
/** 一個時段 4 小時（CORE_RULES 7.4 節）。 */
export const SEGMENT_HOURS = 4

/** 規格沒寫的兩件事做成參數（dev/adr/0004）：清晨從幾點開始、第幾天是週一。 */
export interface TimeRules {
  /** 清晨這個時段從幾點開始；之後每 4 小時一個時段 */
  dawnHour: number
  /** day % 7 等於這個數字的那一天是週一（收租日） */
  mondayRemainder: number
}
export const DEFAULT_TIME_RULES: TimeRules = { dawnHour: 4, mondayRemainder: 0 }

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

export function weekdayOf(t: GameTime, rules: TimeRules = DEFAULT_TIME_RULES): Weekday {
  return ((((t.day - rules.mondayRemainder) % 7) + 7) % 7) as Weekday
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

export function isValidTime(t: unknown): t is GameTime {
  if (!t || typeof t !== 'object') return false
  const { day, hour, minute } = t as Record<string, unknown>
  return Number.isInteger(day) && (day as number) >= 1 && Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23
    && Number.isInteger(minute) && (minute as number) >= 0 && (minute as number) <= 59
}
