// L6 功能 transit 的資料與純函式：內容的格式檢查、規則的預設、狀態的形狀、站與車資的查詢。不碰登錄表（登錄在 index.ts）。
// 規格：DISTRICTS 1.2.1 節（公共交通、搭車）；EVENTS 3.1 節；dev/adr/0016 第一、六節；dev/work/M2-transit.md。
//
// 內容種類：
//   transit_line  { id, name, kind: 'metro' | 'light_rail' | 'bus' | 'ferry', stops: [{ id, name, block, at }], minutes_per_stop, wait: [最少, 最多],
//                   fare: { base, per_stop }, pay: ['cred' | 'cash'], scan?: 0～3, faction?: 勢力 id（掃橋時看誰的敵對值）, night?: false（深夜停駛）, loop?: true（環線，只往前開） }
//   transit_rule  { id: default, ...DEFAULT_TRANSIT_RULES 的鍵 }（計程車的起跳、每公里、兩區之間的公里數表、哪些區不去、尖峰與深夜是哪些時段）
// 站：一條線上的一個 stop 是「某一塊街區上的某一個標記」；同一塊街區同一個標記是同一個站（可以轉乘）。
//
// 狀態 state.ext.transit：{ visited: [站的 key], trips: 搭過幾趟, trip: 現在這一趟 | null }。

import type { ContentEntry, GameState, Kernel, SegmentId } from '../../core'
import { SEGMENT_IDS, isRecord, isSafeInt, segmentOf } from '../../core'

export const OWNER = 'transit'
export const EXT = 'transit'
export const LINE_KIND = 'transit_line'
export const RULE_KIND = 'transit_rule'
export const RIDE_ACTIVITY = 'ride'

export const LINE_KINDS = ['metro', 'light_rail', 'bus', 'ferry'] as const
export type LineKind = (typeof LINE_KINDS)[number]
export const PAY_KINDS = ['cred', 'cash'] as const
export type PayKind = (typeof PAY_KINDS)[number]
export const PAY_NAME: Record<PayKind, string> = { cred: '帳戶', cash: '現金' }
export const KIND_NAME: Record<LineKind, string> = { metro: '地鐵', light_rail: '輕軌', bus: '巴士', ferry: '渡輪' }
export const MAX_SCAN = 3

export interface StopDef {
  id: string
  name: string
  /** 這一站在哪一塊街區 */
  block: string
  /** 街區版面上的標記 id（車站設施的格子） */
  at: string
}

export interface LineEntry extends ContentEntry {
  name: string
  kind: LineKind
  stops: StopDef[]
  minutes_per_stop: number
  wait: [number, number]
  fare: { base: number; per_stop: number }
  pay: PayKind[]
  scan?: number
  faction?: string
  night?: boolean
  loop?: boolean
}

export type Period = 'peak' | 'night' | 'day'

/** 規則的數字（DISTRICTS 1.2.1 節的暫定值）；資料的 transit_rule（id: default）蓋掉。 */
export interface TransitRules {
  /** 浮空計程車：起跳 C$25，每公里 C$4，10 分鐘 */
  taxi_base: number
  taxi_per_km: number
  taxi_minutes: number
  /** 同一個區裡、或兩區之間表上沒寫的公里數 */
  taxi_same_km: number
  taxi_default_km: number
  /** 兩區之間的公里數（不分方向） */
  km: Array<{ a: string; b: string; km: number }>
  /** 計程車不去的區（目的地在那裡的站不能叫） */
  no_taxi: string[]
  /** 尖峰與深夜是哪些時段（時段 id；深夜是 night: false 的線停駛的時段） */
  peak: SegmentId[]
  night: SegmentId[]
  /** 沒去過的站也能叫計程車（存檔規則放寬的那一條；核心的存檔規則沒有這一項，先放在規則的資料裡） */
  anywhere: boolean
}

export const DEFAULT_TRANSIT_RULES: TransitRules = {
  taxi_base: 25, taxi_per_km: 4, taxi_minutes: 10, taxi_same_km: 2, taxi_default_km: 10,
  km: [], no_taxi: [], peak: ['morning', 'afternoon'], night: ['late'], anywhere: false,
}

/** 現在這一趟。 */
export interface Trip {
  /** r1、r2……：搭過的第幾趟 */
  id: string
  n: number
  line: string
  /** 1 往 stops 的後面開，-1 往前面開（環線只有 1） */
  dir: 1 | -1
  /** 現在在 stops 的第幾格（0 起算）：上車時是上車的那一站 */
  at: number
  /** 上車的那一站的 stop id */
  from: string
  /** 目的地的 stop id（只是記號）；沒選是 null */
  dest: string | null
  pay: PayKind
  /** platform 在月台上等車、aboard 在車上 */
  phase: 'platform' | 'aboard'
  /** 坐了幾站 */
  rode: number
  /** 這一趟付了多少 */
  paid: number
}

export interface TransitState {
  /** 去過的站（站的 key），照第一次去的順序 */
  visited: string[]
  trips: number
  trip: Trip | null
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNat = (v: unknown): v is number => isSafeInt(v) && v >= 0

export function tripProblems(t: unknown): string[] {
  if (!isRecord(t)) return ['trip 要是物件或 null']
  const p: string[] = []
  if (!isText(t.id)) p.push('trip.id 要是字串')
  if (!(isSafeInt(t.n) && t.n >= 1)) p.push('trip.n 要是 1 以上的整數')
  if (!isText(t.line)) p.push('trip.line 要是線的 id')
  if (t.dir !== 1 && t.dir !== -1) p.push('trip.dir 要是 1 或 -1')
  if (!isNat(t.at)) p.push('trip.at 要是 0 以上的整數')
  if (!isText(t.from)) p.push('trip.from 要是站的 id')
  if (t.dest !== null && !isText(t.dest)) p.push('trip.dest 要是站的 id 或 null')
  if (!(PAY_KINDS as readonly unknown[]).includes(t.pay)) p.push('trip.pay 要是 cred 或 cash')
  if (t.phase !== 'platform' && t.phase !== 'aboard') p.push('trip.phase 要是 platform 或 aboard')
  if (!isNat(t.rode)) p.push('trip.rode 要是 0 以上的整數')
  if (!isNat(t.paid)) p.push('trip.paid 要是 0 以上的整數')
  return p
}

/** 讀 state.ext.transit：沒有、或形狀不對的部分當成空的（回傳的是複製品）。 */
export function transitOf(state: Pick<GameState, 'ext'>): TransitState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const trip = isRecord(r.trip) && tripProblems(r.trip).length === 0 ? (structuredClone(r.trip) as unknown as Trip) : null
  return {
    visited: Array.isArray(r.visited) ? r.visited.filter(isText) : [],
    trips: isNat(r.trips) ? r.trips : 0,
    trip,
  }
}

// ---- 內容的格式檢查（單筆） ----

export function lineProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!(LINE_KINDS as readonly unknown[]).includes(e.kind)) p.push(`kind 只能是 ${LINE_KINDS.join('、')}`)
  if (!Array.isArray(e.stops) || e.stops.length < 2) p.push('stops 要有至少兩站')
  else {
    const ids = new Set<string>()
    e.stops.forEach((s, i) => {
      const at = `stops/${i}`
      if (!isRecord(s)) return p.push(`${at}：要是 { id, name, block, at }`)
      if (!isText(s.id)) p.push(`${at}：要有 id`)
      else if (ids.has(s.id)) p.push(`${at}：站的 id ${s.id} 重複`)
      else ids.add(s.id)
      if (!isText(s.name)) p.push(`${at}：要有 name`)
      if (!isText(s.block)) p.push(`${at}：要有 block（街區的 id）`)
      if (!isText(s.at)) p.push(`${at}：要有 at（街區版面上的標記 id）`)
    })
    if (e.loop === true && e.stops.length < 3) p.push('環線至少要有三站')
  }
  if (!(isSafeInt(e.minutes_per_stop) && e.minutes_per_stop >= 1)) p.push('minutes_per_stop 要是 1 以上的整數')
  if (!(Array.isArray(e.wait) && e.wait.length === 2 && isNat(e.wait[0]) && isNat(e.wait[1]) && e.wait[0] <= e.wait[1])) p.push('wait 要是 [最少, 最多]（分鐘，最少不大於最多）')
  if (!isRecord(e.fare) || !isNat(e.fare.base) || !isNat(e.fare.per_stop)) p.push('fare 要是 { base, per_stop }（0 以上的整數）')
  if (!(Array.isArray(e.pay) && e.pay.length > 0 && e.pay.every((x) => (PAY_KINDS as readonly unknown[]).includes(x)))) p.push(`pay 要是 ${PAY_KINDS.join('、')} 的陣列`)
  if (e.scan !== undefined && !(isSafeInt(e.scan) && e.scan >= 0 && e.scan <= MAX_SCAN)) p.push(`scan 要是 0～${MAX_SCAN} 的整數（掃描強度）`)
  if (e.faction !== undefined && !isText(e.faction)) p.push('faction 要是勢力的 id')
  if (e.night !== undefined && typeof e.night !== 'boolean') p.push('night 要是 true 或 false（false 是深夜停駛）')
  if (e.loop !== undefined && typeof e.loop !== 'boolean') p.push('loop 要是 true 或 false')
  return p
}

const segList = (v: unknown): v is SegmentId[] => Array.isArray(v) && v.every((s) => (SEGMENT_IDS as readonly unknown[]).includes(s))

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of ['taxi_base', 'taxi_per_km', 'taxi_same_km', 'taxi_default_km'] as const) if (e[key] !== undefined && !isNat(e[key])) p.push(`${key} 要是 0 以上的整數`)
  if (e.taxi_minutes !== undefined && !(isSafeInt(e.taxi_minutes) && e.taxi_minutes >= 1)) p.push('taxi_minutes 要是 1 以上的整數')
  if (e.km !== undefined) {
    if (!Array.isArray(e.km)) p.push('km 要是 [{ a, b, km }]')
    else e.km.forEach((r, i) => { if (!(isRecord(r) && isText(r.a) && isText(r.b) && isNat(r.km))) p.push(`km/${i}：要是 { a: 區的 id, b: 區的 id, km: 公里數 }`) })
  }
  if (e.no_taxi !== undefined && !(Array.isArray(e.no_taxi) && e.no_taxi.every(isText))) p.push('no_taxi 要是區的 id 的陣列')
  for (const key of ['peak', 'night'] as const) if (e[key] !== undefined && !segList(e[key])) p.push(`${key} 要是時段 id 的陣列（${SEGMENT_IDS.join('、')}）`)
  if (e.anywhere !== undefined && typeof e.anywhere !== 'boolean') p.push('anywhere 要是 true 或 false')
  return p
}

/** 規則：預設的數字，資料的 transit_rule（id: default）有寫而且格式對的欄位蓋掉。 */
export function transitRules(k: Pick<Kernel, 'content'>): TransitRules {
  const out: TransitRules = { ...DEFAULT_TRANSIT_RULES, km: [...DEFAULT_TRANSIT_RULES.km], no_taxi: [], peak: [...DEFAULT_TRANSIT_RULES.peak], night: [...DEFAULT_TRANSIT_RULES.night] }
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  for (const key of ['taxi_base', 'taxi_per_km', 'taxi_same_km', 'taxi_default_km'] as const) if (isNat(e[key])) out[key] = e[key]
  if (isSafeInt(e.taxi_minutes) && e.taxi_minutes >= 1) out.taxi_minutes = e.taxi_minutes
  if (Array.isArray(e.km)) out.km = e.km.filter((r): r is { a: string; b: string; km: number } => isRecord(r) && isText(r.a) && isText(r.b) && isNat(r.km)).map((r) => ({ a: r.a, b: r.b, km: r.km }))
  if (Array.isArray(e.no_taxi)) out.no_taxi = e.no_taxi.filter(isText)
  if (segList(e.peak)) out.peak = [...e.peak]
  if (segList(e.night)) out.night = [...e.night]
  if (typeof e.anywhere === 'boolean') out.anywhere = e.anywhere
  return out
}

// ---- 線與站 ----

type Cx = Pick<Kernel, 'content'>
export const lineEntry = (k: Cx, id: string | undefined): LineEntry | undefined => (id ? k.content.get<LineEntry>(LINE_KIND, id) : undefined)
export const linesOf = (k: Cx): LineEntry[] => k.content.list<LineEntry>(LINE_KIND)

/** 站的 key：同一塊街區的同一個標記是同一個站。 */
export const stationKey = (block: string, at: string): string => `${block}:${at}`
export const stopKey = (s: StopDef): string => stationKey(s.block, s.at)

export interface Station {
  key: string
  name: string
  block: string
  at: string
  /** 停這一站的線，與在那條線上的第幾格 */
  lines: Array<{ line: string; index: number }>
}

/** 全部的站（照線的順序、站的順序；同一個站只出現一次，名字用第一條線給的）。 */
export function stationsOf(k: Cx): Station[] {
  const map = new Map<string, Station>()
  for (const line of linesOf(k)) {
    line.stops.forEach((s, index) => {
      const key = stopKey(s)
      const st = map.get(key) ?? { key, name: s.name, block: s.block, at: s.at, lines: [] }
      st.lines.push({ line: line.id, index })
      map.set(key, st)
    })
  }
  return [...map.values()]
}

/** 這一塊街區的這個標記是不是站。 */
export const stationAt = (k: Cx, block: string | undefined, at: string | undefined): Station | undefined => (block && at ? stationsOf(k).find((s) => s.block === block && s.at === at) : undefined)

/** 站在哪個站上：這一塊街區、這個標記（location.facility）就是站。 */
export const stationHere = (k: Cx, state: Pick<GameState, 'location'>): Station | undefined => stationAt(k, state.location.block, state.location.facility)

export const stopIndex = (line: LineEntry, stopId: string): number => line.stops.findIndex((s) => s.id === stopId)

/** 往這個方向的下一格；到了盡頭（不是環線）回傳 null。 */
export function nextIndex(line: LineEntry, at: number, dir: 1 | -1): number | null {
  const n = line.stops.length
  const next = at + dir
  if (line.loop === true) return ((next % n) + n) % n
  return next < 0 || next >= n ? null : next
}

/** 往這個方向開，終點站是哪一站（環線沒有終點，回傳 null）。 */
export function terminalOf(line: LineEntry, dir: 1 | -1): StopDef | null {
  if (line.loop === true) return null
  return dir === 1 ? line.stops[line.stops.length - 1]! : line.stops[0]!
}

/** 從 at 往 dir 開，幾站會到 target；到不了回傳 null（環線繞一圈才回到自己是 n 站）。 */
export function stopsBetween(line: LineEntry, at: number, dir: 1 | -1, target: number): number | null {
  const n = line.stops.length
  if (line.loop === true) {
    const d = (((target - at) * dir) % n + n) % n
    return d === 0 ? n : d
  }
  const d = (target - at) * dir
  return d > 0 ? d : null
}

export const fareFor = (line: LineEntry, stops: number): number => line.fare.base + line.fare.per_stop * stops

// ---- 時段 ----

export function periodAt(k: Pick<Kernel, 'content' | 'timeRules'>, time: GameState['time']): Period {
  const rules = transitRules(k)
  const seg = segmentOf(time, k.timeRules)
  return rules.night.includes(seg) ? 'night' : rules.peak.includes(seg) ? 'peak' : 'day'
}

/** 這條線現在開不開；不開的原因是一句話。 */
export function lineClosed(k: Pick<Kernel, 'content' | 'timeRules'>, state: Pick<GameState, 'time'>, line: LineEntry): string | null {
  if (line.night === false && periodAt(k, state.time) === 'night') return `${line.name}深夜停駛，末班車已經過了。`
  return null
}

// ---- 計程車 ----

interface PlaceEntry extends ContentEntry { district?: string; name?: string; price_mult?: number }

export const blockInfo = (k: Cx, id: string | undefined): { name: string; district: string | undefined } | undefined => {
  const b = id ? k.content.get<PlaceEntry>('block', id) : undefined
  return b ? { name: typeof b.name === 'string' ? b.name : b.id, district: typeof b.district === 'string' ? b.district : undefined } : undefined
}

export const districtInfo = (k: Cx, id: string | undefined): { name: string; mult: number } | undefined => {
  const d = id ? k.content.get<PlaceEntry>('district', id) : undefined
  return d ? { name: typeof d.name === 'string' ? d.name : d.id, mult: typeof d.price_mult === 'number' && Number.isFinite(d.price_mult) ? d.price_mult : 1 } : undefined
}

/** 兩區之間幾公里：同一區用 taxi_same_km；表上沒有的用 taxi_default_km；現在不在任何區也用 taxi_default_km。 */
export function kmBetween(rules: TransitRules, from: string | undefined, to: string | undefined): number {
  if (!from || !to) return rules.taxi_default_km
  if (from === to) return rules.taxi_same_km
  const hit = rules.km.find((r) => (r.a === from && r.b === to) || (r.a === to && r.b === from))
  return hit ? hit.km : rules.taxi_default_km
}

/** 浮空計程車的車資：(起跳 ＋ 每公里 × 公里數) × 目的地那一區的物價（低於 1 當 1），四捨五入成整數。 */
export function taxiFare(rules: TransitRules, km: number, priceMult: number): number {
  return Math.round((rules.taxi_base + rules.taxi_per_km * km) * Math.max(1, priceMult))
}
