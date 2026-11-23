import type { ContentPack } from '@engine/src'
import { LINES, type LineId } from '../transit'
import { blockIdOf, districtKm, stationMarkerOf } from './world'

/**
 * 示意世界包的交通部分：ui/src/data/transit.ts 的五條線整理成引擎的 transit_line，加一筆計程車的規則 transit_rule。
 * 資料轉換，沒有規則：車資、每站分鐘、深夜停駛、掃橋強度都是引擎讀的資料。
 */
const KIND: Record<LineId, string> = { red: 'metro', sakura: 'metro', loop: 'light_rail', bus: 'bus', ferry: 'ferry' }
const PAY: Record<LineId, string[]> = { red: ['cred', 'cash'], sakura: ['cred', 'cash'], loop: ['cred', 'cash'], bus: ['cash'], ferry: ['cash'] }
/** 進站掃橋的強度與看的勢力：紅線是市警、櫻線是緋櫻（FACTIONS）；其餘不掃 */
const SCAN: Partial<Record<LineId, { scan: number; faction: string }>> = { red: { scan: 1, faction: 'police' }, sakura: { scan: 2, faction: 'hizakura' } }
/** 深夜停駛（night: false）：紅線；櫻線與其他照開 */
const NO_NIGHT: LineId[] = ['red']
/** 等車的分鐘範圍：舊資料只有「大約幾分鐘」，這裡放寬成一個範圍 */
const waitRange = (w: number): [number, number] => [Math.max(1, Math.round(w / 2)), Math.round(w * 1.5)]

export function transitContent(): NonNullable<ContentPack['content']> {
  const transit_line = LINES.map(l => ({
    id: `line_${l.id}`, name: l.name, kind: KIND[l.id], minutes_per_stop: l.perStop, wait: waitRange(l.wait),
    fare: { base: l.fare.base, per_stop: l.fare.perStop }, pay: PAY[l.id],
    ...(SCAN[l.id] ?? {}), ...(NO_NIGHT.includes(l.id) ? { night: false } : {}), ...(l.loop ? { loop: true } : {}),
    icon: l.icon, note: l.note,
    stops: l.stops.map((s, i) => {
      const block = blockIdOf(s.district, s.block)
      const at = stationMarkerOf(block)
      if (!at) throw new Error(`示意包：${s.block} 沒有車站設施。`)
      return { id: `s${i + 1}`, name: s.name, block, at }
    }),
  }))
  const transit_rule = [{ id: 'default', taxi_base: 25, taxi_per_km: 4, taxi_minutes: 10, taxi_same_km: 1, taxi_default_km: 10, km: districtKm(), no_taxi: ['under'] }]
  // transit_rule（default）已經在引擎的規則表裡（CORE_PACK），id 不能重複；示意的公里數表（districtKm）暫時不載入，計程車用規則表的預設公里數
  void transit_rule
  return { transit_line } as unknown as NonNullable<ContentPack['content']>
}
