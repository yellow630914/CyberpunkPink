// L6 功能 curtain 的場熱（CYBERSPACE 8.8 節「場熱」「打賞」）。沒有直播的簾後館（P57）：場熱只算戰鬥與場景。
//
// 開播（M5）時要動的三個地方：每場戰鬥結束場熱 +2（battle.ts 的 onBattleEnd，規則加一個 heat.live）、打賞加倍（settle.ts 的 closeRun 算 tips 的那一行）、
// 點單擲到「返場」不再重擲（orders.ts 的 usable，把 encore 收下並記下剛打完的層主）。內場帶、檔期榜上別隊的模擬也是 M5。
//
// 場熱是量表 heat（0～100、起算 30、鍵是那一趟的地圖實例），這裡只放算法：每一項漲跌多少、戰鬥的亮點怎麼數、打賞的比例。
// 漲跌都寫成量表的 delta 變更（加法，同一份報告裡好幾個掛點各加各的不會蓋掉）；跨門檻（贊助人、加演、到 0）等報告套用之後由 report.after 看（curtain.stage）。

import type { BattleState, Change, GameState, Kernel, Report } from '../../core'
import { meterOf } from '../../core'
import type { CurtainRules, HeatRules } from './model'
import { HEAT } from './model'

/** 這一趟現在的場熱（沒有地圖是起始值 30）。 */
export const heatOf = (k: Pick<Kernel, 'meters'>, state: GameState, map: string | undefined): number => (map ? meterOf(k, state, HEAT, map) : 30)

/** 場熱加減（量表的 delta；0 不寫）。 */
export const heatDelta = (map: string, delta: number): Change[] => (delta !== 0 ? [{ op: 'meter', kind: HEAT, key: map, delta }] : [])

/** 場熱到這個數字（直接設；加演接著上一趟的場熱時用）。 */
export const heatSet = (map: string, value: number): Change => ({ op: 'meter', kind: HEAT, key: map, set: value })

/** 打賞的比例：場熱落在哪一段（tips_edges 是後四段的下限）。 */
export function tipsRatio(rules: Pick<CurtainRules, 'tips' | 'tips_edges'>, heat: number): number {
  let band = 0
  rules.tips_edges.forEach((edge, i) => { if (heat >= edge) band = i + 1 })
  return rules.tips[band] ?? 0
}

/** 場熱落在第幾段（0～4；畫面標三段的說明用）。 */
export function heatBand(rules: Pick<CurtainRules, 'tips_edges'>, heat: number): number {
  let band = 0
  rules.tips_edges.forEach((edge, i) => { if (heat >= edge) band = i + 1 })
  return band
}

/** 成人場景的結算換場熱：契合到哪一級（heat.scene 由高到低，第一個 min 以下的就是）。 */
export function sceneHeat(rules: Pick<CurtainRules, 'heat'>, fit: number): number {
  return rules.heat.scene.find((r) => fit >= r.min)?.delta ?? rules.heat.scene[rules.heat.scene.length - 1]?.delta ?? 0
}

/** 超過標準回合要扣的場熱：每多 over_per 回合扣 over_pen（沒超過是 0）。 */
export function overshoot(rules: { heat: Pick<HeatRules, 'over_per' | 'over_pen'> }, rounds: number, standard: number): { over: number; heat: number } {
  const over = Math.max(0, rounds - standard)
  return { over, heat: Math.floor(over / rules.heat.over_per) * rules.heat.over_pen }
}

export interface Highlights {
  /** 我方打出的要害 */
  crits: number
  /** 把對手打到過載 */
  overloads: number
  /** 一回合打倒兩個以上（每一回合算一次） */
  doubles: number
  total: number
}

/**
 * 這一場戰鬥的亮點（戰鬥結束時數）：我方的要害（crit）、把對手打到過載（overload）、同一回合打倒兩個敵人（down）各算一個。
 * 事件來自這場戰鬥每一步的紀錄的 tag（BATTLE_EVENTS），所以只看引擎本來就會發出的事（MEDIA 1.2 節）。
 */
export function highlightsOf(reports: readonly Pick<Report, 'id' | 'timeline'>[], battle: Pick<BattleState, 'steps' | 'units'>): Highlights {
  const ids = new Set(battle.steps)
  const sideOf = (id: unknown): string | undefined => (typeof id === 'string' ? battle.units[id]?.side : undefined)
  let crits = 0
  let overloads = 0
  let doubles = 0
  let downs = 0
  for (const r of reports) {
    if (!ids.has(r.id)) continue
    for (const b of r.timeline) {
      const d = b.data ?? {}
      if (b.tag === 'round') downs = 0
      else if (b.tag === 'crit' && sideOf(d.attacker) === 'ally') crits++
      else if (b.tag === 'overload' && sideOf(d.target) === 'foe') overloads++
      else if (b.tag === 'down' && (d.side === 'foe' || sideOf(d.target) === 'foe')) {
        downs++
        if (downs === 2) doubles++
      }
    }
  }
  return { crits, overloads, doubles, total: crits + overloads + doubles }
}

/** 這一場戰鬥的亮點換多少場熱（每個 highlight 點，一場最多 highlight_cap）。 */
export const highlightHeat = (rules: Pick<CurtainRules, 'heat'>, h: Pick<Highlights, 'total'>): number => Math.min(rules.heat.highlight_cap, h.total * rules.heat.highlight)
