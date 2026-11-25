// L6 unreg 的委託台（同人社團的訂做；CRAFTING 11.1 節、SITES 13.5 節；dev/adr/0019 P72）：站的設施是不是帶 unreg_desk、今天開不開。
// 設施種類（world 的 facility_type）多讀一個欄位 unreg_desk: { faction?: 勢力的 id（看哪個勢力的好感）, brand?: 零件的牌子, weekdays?: 開的星期（0＝週一…6＝週日；沒寫是每天） }。
// 現實的攤位（週六的同人夜市）與網內的委託台是同一種設施欄位、同一個條件（at_facility）。

import type { GameState, Kernel } from '../../core'
import { isRecord, isSafeInt, weekdayOf } from '../../core'

export const FACILITY_TYPE_KIND = 'facility_type'
export const DEFAULT_BRAND = 'doujin'
export const WEEKDAY_NAME = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']

export interface DeskDef {
  faction?: string
  brand?: string
  weekdays?: number[]
}

export interface DeskHere extends DeskDef {
  /** 設施種類的 id 與名字 */
  type: string
  name: string
  /** 牌子（沒寫是 doujin） */
  brand: string
  /** 今天開不開 */
  open: boolean
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** unreg_desk 的格式問題（每條一句）。 */
export function deskProblems(d: unknown): string[] {
  if (!isRecord(d)) return ['unreg_desk 要是 { faction?, brand?, weekdays? }']
  const p: string[] = []
  if (d.faction !== undefined && !isText(d.faction)) p.push('unreg_desk.faction 要是勢力的 id')
  if (d.brand !== undefined && !isText(d.brand)) p.push('unreg_desk.brand 要是牌子的 id')
  if (d.weekdays !== undefined && !(Array.isArray(d.weekdays) && d.weekdays.length > 0 && d.weekdays.every((x) => isSafeInt(x) && x >= 0 && x <= 6))) p.push('unreg_desk.weekdays 要是 0～6 的整數陣列（0 是週一）')
  return p
}

/** 現在站的設施是委託台嗎（用條件 at_facility 問；沒有人註冊、或沒有設施種類就沒有）。不在、或那種設施沒寫 unreg_desk 是 null。 */
export function deskHere(k: Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules'>, state: GameState): DeskHere | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND) || !state.location.facility) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list(FACILITY_TYPE_KIND)) {
    const d = t.unreg_desk
    if (!isRecord(d) || deskProblems(d).length > 0) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) continue
    const weekdays = Array.isArray(d.weekdays) ? (d.weekdays as number[]) : undefined
    return {
      type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, brand: isText(d.brand) ? d.brand : DEFAULT_BRAND,
      ...(isText(d.faction) ? { faction: d.faction } : {}), ...(weekdays ? { weekdays: [...weekdays] } : {}),
      open: !weekdays || weekdays.includes(weekdayOf(state.time, k.timeRules)),
    }
  }
  return null
}

/** 這個攤位開在哪幾天（給原因用）。 */
export const weekdaysText = (weekdays: readonly number[]): string => weekdays.map((d) => WEEKDAY_NAME[d] ?? String(d)).join('、')
