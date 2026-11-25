// L6 auction 的場次與場所（LEWD_SYSTEM 6.2 節「進場」「一場拍賣」；dev/adr/0019 P77、P80）：
//   sessionOf：下一場的開槌日、目錄公布的時間、預展的起訖、開槌的起訖（都是「第 1 天 00:00 起算的分鐘」）。
//   housesHere：腳下的設施是哪一家拍賣行（設施種類多讀選填的欄位 auction: { house }；照 features/rest 讀 sleep 的做法）。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { MINUTES_PER_DAY, SEGMENT_HOURS, SEGMENT_IDS, isRecord, toMinutes, weekdayOf } from '../../core'
import type { HouseEntry } from './model'
import { BLOCK_KIND, DAY_MINUTES, FACILITY_TYPE_KIND, HOUSE_KIND, auctionOf, auctionRules, facilityProblems, houseOf, isText } from './model'

export interface Session {
  house: string
  /** 這一場開槌日的天數（`day`；也是場次的編號） */
  day: number
  /** 目錄公布的時間 */
  catalog_at: number
  /** 預展的起訖：[開始, 結束)（開槌前 days_before 天的 from_hour～to_hour） */
  preview: { from: number; to: number }
  /** 開槌的時段：[開始, 結束)；深夜那一段會跨過午夜 */
  start: number
  end: number
}

/** 這個時段從幾點開始（清晨從 dawnHour 起，每 4 小時一段）。 */
export const segmentStartHour = (k: Pick<Kernel, 'timeRules'>, segment: HouseEntry['segment']): number => (k.timeRules.dawnHour + SEGMENT_IDS.indexOf(segment) * SEGMENT_HOURS) % 24

/** 第 day 天的第 hour 點是第幾分鐘（day 可以小於 1，只是算術）。 */
const at = (day: number, hour: number): number => (day - 1) * MINUTES_PER_DAY + hour * 60

/** 開槌日是 day 的那一場。 */
export function sessionAt(k: Pick<Kernel, 'content' | 'timeRules'>, house: HouseEntry, day: number): Session {
  const rule = auctionRules(k)
  const start = at(day, segmentStartHour(k, house.segment))
  const before = day - rule.preview.days_before
  return {
    house: house.id, day,
    catalog_at: at(before, rule.preview.from_hour),
    preview: { from: at(before, rule.preview.from_hour), to: at(before, rule.preview.to_hour) },
    start, end: start + SEGMENT_HOURS * 60,
  }
}

/**
 * 下一場：從現在往後找第一個星期對得上、開槌的時段還沒過、而且還沒去過（done）的那一天。
 * 週五的黃金時段（19～23）：週五 20:00 問還是這一場（可以進場），週五 23:30 問是下週五；深夜那一段跨過午夜，午夜之後還是前一天開的那一場。
 * 沒有這家拍賣行是 null。
 */
export function sessionOf(k: Pick<Kernel, 'content' | 'timeRules'>, state: Pick<GameState, 'time' | 'ext'>, houseId: string): Session | null {
  const house = houseOf(k, houseId)
  if (!house) return null
  const now = toMinutes(state.time)
  const done = auctionOf(state).done[house.id]
  const first = Math.max(1, state.time.day - 1)
  for (let day = first; day <= first + 16; day++) {
    if (weekdayOf({ day, hour: 0, minute: 0 }, k.timeRules) !== house.weekday) continue
    if (done !== undefined && day <= done) continue
    const s = sessionAt(k, house, day)
    if (s.end > now) return s
  }
  return null
}

/** 現在在預展的起訖裡嗎。 */
export const inPreview = (s: Session, now: number): boolean => now >= s.preview.from && now < s.preview.to

export interface HouseHere {
  id: string
  name: string
  /** 設施種類的 id */
  type: string
}

/** 腳下的設施是哪一家拍賣行（設施種類的欄位 auction.house）。不在設施上、那種設施沒寫、或查不到拍賣行是空的。 */
export function housesHere(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'location'>): HouseHere[] {
  const { block, facility } = state.location
  if (!block || !facility || !k.content.hasKind(BLOCK_KIND) || !k.content.hasKind(FACILITY_TYPE_KIND) || !k.content.hasKind(HOUSE_KIND)) return []
  const b = k.content.get<ContentEntry & { facilities?: Record<string, { type?: unknown }> }>(BLOCK_KIND, block)
  const f = b && isRecord(b.facilities) ? b.facilities[facility] : undefined
  if (!f || !isText(f.type)) return []
  const type = k.content.get<ContentEntry & { auction?: unknown }>(FACILITY_TYPE_KIND, f.type)
  if (!type || type.auction === undefined || facilityProblems(type.auction).length > 0) return []
  const house = houseOf(k, (type.auction as { house: string }).house)
  return house ? [{ id: house.id, name: house.name, type: f.type }] : []
}

/** 這個分鐘數是哪一天（第幾天；給「停權到第幾天」的句子用）。 */
export const dayOfMinutes = (minutes: number): number => Math.floor(Math.max(0, minutes) / DAY_MINUTES) + 1
