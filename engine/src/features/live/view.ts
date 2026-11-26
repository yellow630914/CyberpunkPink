// L6 功能 live 給畫面的一份：直播面板要的東西（UI 6.3：抬頭、數字、直播目標、亮點、風險）。唯讀，不改狀態。
//   模式、模板、宿主、熱度、觀看數與級距、目標與現在的達成、亮點、打賞、風險；沒在直播時回最近幾場的結果。

import type { Kernel } from '../../core'
import type { GoalCheck, Highlight, HostKind, Mode, Settled, ViewerTier } from './model'
import { EVENT_NAME, HOST_NAME, VIEWER_TIER_NAME, capOnly, goalMet, liveRules, readLive, subsOfHeat, templateById, viewersFrom } from './model'
import { riskLines } from './open'
import { meterOf } from '../../core'
import type { GameState } from '../../core'

export interface LiveGoalView {
  id: string
  text: string
  heat: number
  tip: number
  /** 現在的次數照目標算是不是成立 */
  met: boolean
  /** 成不成立已經定了嗎（「最多幾次」的目標要到宿主結束才定；其餘一旦成立就不會變回去） */
  settled: boolean
  check: GoalCheck
}

export interface LiveSessionView {
  id: string
  mode: Mode
  template: { id: string; name: string }
  host: { kind: HostKind; id: string; name: string } | null
  heat: number
  /** 現在的觀看數、基本盤、倍率與級距（畫面每次更新在這個數字的 ±5% 裡起伏，是畫面的事） */
  viewers: { count: number; base: number; mult: number; tier: ViewerTier; tier_name: string }
  tips: number
  goals: LiveGoalView[]
  highlights: Array<Highlight & { name: string }>
  counts: Record<string, number>
  secret: boolean
  risk: string[]
  /** 現在收播的話會得到多少（目標照現在的次數算、「最多幾次」的不算） */
  projection: { heat: number; subs: number; tips: number }
}

export interface LiveView {
  on: boolean
  session: LiveSessionView | null
  /** 最近幾場收播的結果（最新的在最後） */
  log: Settled[]
}

export function liveView(k: Kernel, state: GameState): LiveView {
  const live = readLive(state)
  const s = live.session
  if (!s) return { on: false, session: null, log: live.log }
  const rules = liveRules(k)
  const tpl = templateById(k, s.template)
  const subsNow = meterOf(k, state, 'subs')
  const v = viewersFrom(rules, subsNow, s.heat, s.house?.views_mult ?? 1)
  const goals = s.goals.map((g): LiveGoalView => {
    const met = goalMet(g.check, s.counts)
    return { id: g.id, text: g.text, heat: g.heat, tip: g.tip, met, settled: capOnly(g.check) ? false : met, check: { ...g.check } }
  })
  const done = goals.filter((g) => g.met && !capOnly(g.check))
  const heat = s.heat + done.reduce((n, g) => n + g.heat, 0)
  const pv = viewersFrom(rules, subsNow, heat, s.house?.views_mult ?? 1)
  const toChannel = s.house?.to_channel !== false
  return {
    on: true,
    session: {
      id: s.id, mode: s.mode, template: { id: s.template, name: tpl?.name ?? s.template },
      host: s.host ? { ...s.host, name: HOST_NAME[s.host.kind] } : null,
      heat: s.heat, viewers: { count: v.viewers, base: v.base, mult: v.mult, tier: v.tier, tier_name: VIEWER_TIER_NAME[v.tier] },
      tips: s.tips, goals, highlights: s.highlights.map((h) => ({ ...h, name: EVENT_NAME[h.event as keyof typeof EVENT_NAME] ?? h.event })), counts: { ...s.counts },
      secret: s.secret === true, risk: tpl ? riskLines(tpl, s.secret === true) : [],
      projection: {
        heat, subs: toChannel && k.meters.has('subs') ? subsOfHeat(rules, heat, pv.viewers) : 0,
        tips: Math.floor((heat * rules.heat_tips + done.reduce((n, g) => n + g.tip, 0)) * (s.house?.tips_mult ?? 1) + 1e-9),
      },
    },
    log: live.log,
  }
}
