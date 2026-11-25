// L6 功能 curtain 的掛點：一個探索回合過了（netrun.round）、戰鬥打完（k.battle.onEnd）、合演的場景結束（activity.end）。
// 規格：CYBERSPACE 8.8 節「場熱」「點單」。
//
// 一趟的回合數、倒下的人次不放在這一趟的紀錄裡，放在核心的計數器（加法）：一段路好幾格時 netrun.round 每一格各問一次、讀到的狀態都是這一段路開始之前的，
// 「讀出來再寫回」會漏算（和迷宮館同一個理由）。場熱是量表的 delta，也是加法。

import type { BattleState, Change, GameState, Kernel } from '../../core'
import { isRecord } from '../../core'
import { defOf } from './ctx'
import { heatDelta, highlightHeat, highlightsOf } from './heat'
import type { CurtainRules, RunRecord } from './model'
import { NIGHT_KIND, ORIGIN_BY, curtainRules, isInt, readCurtain } from './model'
import type { NightEntry } from './model'
import { duetEnded, resolvePending } from './orders'
import { runPatch } from './patch'
import { exploreKey, roundKey } from './nodes'
import { rewardOf } from './tables'

/** 整趟裡的第幾幕：加演的一趟從基本的幾幕之後算起。 */
export const actOf = (rules: Pick<CurtainRules, 'act_defs'>, run: Pick<RunRecord, 'encore'>, layer: number): number => (run.encore ? rules.act_defs.length : 0) + layer

interface RunLike {
  id: string
  layer: number
  round: number
  map: string
  origin: { by: string }
}

/** 掛點 netrun.round：這一幕的回合與探索回合各加一；每走 explore_per 個探索回合場熱 −1（觀眾等得不耐煩）。 */
export function onRound(k: Kernel, state: GameState, run: RunLike): Change[] | undefined {
  if (run.origin.by !== ORIGIN_BY) return undefined
  const r = readCurtain(state).run
  if (!r || r.over) return undefined
  const rules = curtainRules(k)
  const act = actOf(rules, r, run.layer)
  const changes: Change[] = [{ op: 'counter', key: roundKey(r.id, act), delta: 1 }, { op: 'counter', key: exploreKey(r.id, act), delta: 1 }]
  if (run.round > 0 && run.round % rules.heat.explore_per === 0) changes.push(...heatDelta(run.map, rules.heat.explore_pen))
  return changes
}

type EndBattle = Pick<BattleState, 'round' | 'origin' | 'units' | 'steps' | 'field'>

/**
 * 戰鬥打完（只認這個功能開的那一場：origin.ext.curtain.run 是這一趟）：這一幕的回合數加上這一場；戰鬥的亮點（要害、把對手打到過載、一回合打倒兩個）
 * 每個 +2、一場最多 +10；倒下的人每個 −10；等著驗收的點單（換裝、守規矩、收尾）算完成或沒完成；守閘門的最後一關（首領）打贏了保證擲一次獎品表。
 */
export function onBattleEnd(k: Kernel, state: GameState, battle: EndBattle, outcome: string): { changes: Change[]; lines: string[] } | undefined {
  const link = isRecord(battle.origin.ext) ? battle.origin.ext.curtain : undefined
  const net = isRecord(battle.origin.ext) ? battle.origin.ext.net : undefined
  const r = readCurtain(state).run
  if (!r || r.over || !isRecord(link) || link.run !== r.id) return undefined
  const rules = curtainRules(k)
  const map = isRecord(net) && typeof net.map === 'string' ? net.map : r.map
  if (!map) return undefined
  const act = isInt(link.act) ? link.act : r.act ?? 0
  const changes: Change[] = [{ op: 'counter', key: roundKey(r.id, act), delta: Math.max(1, battle.round) }]
  const lines: string[] = []
  // 亮點
  const h = highlightsOf(state.reports, battle)
  const gain = highlightHeat(rules, h)
  if (gain > 0) {
    changes.push(...heatDelta(map, gain))
    lines.push(`這一場有 ${h.total} 個亮點（要害 ${h.crits}、過載 ${h.overloads}、一回合倒兩個 ${h.doubles}），場熱 +${gain}。`)
  }
  // 倒下
  const downs = Object.values(battle.units).filter((u) => u.side === 'ally' && (u.out === 'down' || u.out === 'burnout' || u.out === 'pinned')).length
  if (downs > 0) {
    changes.push(...heatDelta(map, downs * rules.heat.down), runPatch({ inc: { downed: downs } }))
    lines.push(`${downs} 個人倒下了，場熱 ${downs * rules.heat.down}。`)
  }
  // 等著的點單
  const done = resolvePending({ k, state, run: r, rules, map }, battle, outcome, state.reports, typeof link.skin_ok === 'boolean' ? link.skin_ok : undefined)
  if (done) {
    changes.push(...done.changes)
    lines.push(...done.lines)
  }
  // 首領保證擲一次獎品表
  if (outcome === 'win' && link.guard === true && link.last === true) {
    const night = k.content.get<NightEntry>(NIGHT_KIND, r.night)
    const tier = rules.tiers.find((t) => t.id === r.tier)
    if (night && tier) {
      const got = rewardOf(k, state, rules, 'prize', { purpose: `curtain/${r.id}/boss/${act}`, grade: tier.grade, night })
      if (got.lines.length) {
        changes.push({ op: 'rng', advance: 1 }, ...got.changes)
        lines.push(`${defOf(rules, act).boss === 'host' ? '主持' : '守關的'}倒下了，保證掉一份獎品：`, ...got.lines)
      }
    }
  }
  return { changes, lines }
}

/** 合演的場景結束（activity.end，kind scene、origin.by 是 curtain）：場熱照契合的評價換、點單算完成。 */
export function onSceneEnd(k: Kernel, state: GameState, origin: { by: string; ext?: Record<string, unknown> }, result: Record<string, unknown>): { changes: Change[]; lines: string[] } | undefined {
  if (origin.by !== ORIGIN_BY) return undefined
  const ext = isRecord(origin.ext) ? origin.ext.curtain : undefined
  const r = readCurtain(state).run
  if (!r || r.over || !isRecord(ext) || !isInt(ext.duet)) return undefined
  const map = r.map ?? state.maps.at?.map
  if (!map) return undefined
  const fit = typeof result.fit === 'number' ? result.fit : typeof result.pace === 'number' ? result.pace : 0
  return duetEnded({ k, state, run: r, rules: curtainRules(k), map }, ext.duet, fit) ?? undefined
}
