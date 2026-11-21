import { LINES, TAXI, TAXI_NO_GO, type TransitLine } from '../data/transit'
import type { DistrictId } from '../data/types'

/**
 * 移動的價錢與時間（DISTRICTS 1.2.1 節）。純函式。
 * - 城市地圖只看「你在哪裡」；從它直接過去只有浮空計程車（要錢）與自己的車（不要錢）。
 * - 地鐵、輕軌、巴士、渡輪要走到街區圖上的車站，按 E 上車，選一站。
 */
export interface Place { district: DistrictId; block: string }
interface Spot { id: DistrictId; x: number; y: number }

/** 這個街區有哪幾條線停（車站設施的內容）。 */
export function linesAt(block: string): TransitLine[] {
  return LINES.filter(l => l.stops.some(s => s.block === block))
}
/** 從這一站坐到第 toIdx 站：經過幾站、幾分鐘（含等車）、多少錢。環線只往前開。 */
export function ride(line: TransitLine, fromBlock: string, toIdx: number) {
  const from = line.stops.findIndex(s => s.block === fromBlock)
  const n = line.stops.length
  const stops = line.loop ? (toIdx - from + n) % n : Math.abs(toIdx - from)
  return { stops, minutes: line.wait + stops * line.perStop, fare: line.fare.base + line.fare.perStop * stops }
}
export function rideBlock(line: TransitLine, fromBlock: string, toIdx: number, money: number): string | null {
  if (line.stops[toIdx]?.block === fromBlock) return '你就在這一站。'
  const r = ride(line, fromBlock, toIdx)
  if (money < r.fare) return `車資要 C$${r.fare}，錢不夠。`
  return null
}

/** 城市地圖上兩個區的距離，換成公里（地圖 1600 像素約 16 公里）。同一區算 1 公里。 */
export function km(spots: Spot[], a: DistrictId, b: DistrictId): number {
  if (a === b) return 1
  const p = spots.find(s => s.id === a)!, q = spots.find(s => s.id === b)!
  return Math.max(1, Math.round(Math.hypot(p.x - q.x, p.y - q.y) / 100))
}
/** 浮空計程車：基本 25 ＋ 每公里 4，乘目的地那一區的物價（低於 1 的照 1）。 */
export function taxiQuote(spots: Array<Spot & { price: number }>, from: Place, to: Place) {
  const k = km(spots, from.district, to.district)
  const price = spots.find(s => s.id === to.district)!.price
  return { km: k, fare: Math.round((TAXI.base + TAXI.perKm * k) * Math.max(1, price)), minutes: from.district === to.district ? TAXI.sameDistrictMinutes : TAXI.minutes }
}
export function taxiBlock(from: Place, to: Place, money: number, fare: number): string | null {
  if (from.district === to.district && from.block === to.block) return '你就在這裡。'
  if (to.district === 'under' || from.district === 'under') return '地下層沒有地面站點，叫不到浮空計程車。'
  if (TAXI_NO_GO[from.block]) return `這裡叫不到車：${TAXI_NO_GO[from.block]}`
  if (TAXI_NO_GO[to.block]) return TAXI_NO_GO[to.block]
  if (money < fare) return `車資要 C$${fare}，你的帳戶只有 C$${money}。`
  return null
}
/** 自己的車（機車、汽車、浮空車，ITEMS 第 14 節）：不要錢；地下層開不進去。 */
export function driveBlock(vehicles: string[], from: Place, to: Place): string | null {
  if (!vehicles.length) return '你沒有車：機車或汽車要先買（ITEMS 第 14 節）。'
  if (from.district === to.district && from.block === to.block) return '你就在這裡。'
  if (to.district === 'under' || from.district === 'under') return '地下層開不進去，要用走的。'
  return null
}
export const driveMinutes = (from: Place, to: Place) => (from.district === to.district ? 4 : 10)
