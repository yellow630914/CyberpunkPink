// L6 功能 channel 給畫面看的整理（MEDIA 第 4 節；dev/adr/0020 第二節）：名字、等級與位子數、三個數字、離下一級差多少、預算的每一格、每個金主的額度與條件、最近的集數。
// 純函式、唯讀。沒有頻道回「還沒有頻道」。

import type { GameState, Kernel } from '../../core'
import { meterOf } from '../../core'
import { poolName, poolOrder } from './budget'
import type { Episode } from './model'
import { CREDIBILITY, RECO, SUBS, channelRules, flowTierOf, levelOf, readChannel, seatsOf } from './model'

export interface PoolRow {
  /** own 或勢力的 id */
  pool: string
  name: string
  cred: number
  cash: number
  /** 可支領額度（自有資金沒有，是 null） */
  quota: number | null
  /** 有贊助的勢力才有的欄位：贊助還在不在 */
  sponsored: boolean
}

export interface SponsorRow {
  faction: string
  name: string
  every_weeks: number
  amount: number
  /** 還有幾週撥下一次款 */
  weeks_left: number
  /** 這個勢力公帳現在剩多少、額度多少 */
  pool: { cred: number; quota: number }
  /** 業配：每幾集要掛一次、掛一次的酬勞、離上次掛了幾集、是不是該掛了；沒寫 plug_every 的贊助是 null */
  plug: { every: number; pay: number; since_last: number; due: boolean } | null
  no_report: { faction?: string; npc?: string } | null
  tiers_off: string[]
}

export type ChannelView =
  | { open: false; note: string }
  | {
    open: true
    name: string
    since: number
    level: number
    seats: number
    subs: number
    credibility: number
    reco: number
    flow_tier: number
    /** 離下一級還差多少訂閱（已經是最高級是 null） */
    next: { level: number; at: number; gap: number } | null
    budget: { rows: PoolRow[]; total: { cred: number; cash: number } }
    sponsors: SponsorRow[]
    /** 這一週開過幾集節目、幾場直播 */
    week: { episodes: number; lives: number }
    /** 最近的集數（新的在前） */
    recent: Episode[]
  }

export function channelView(k: Pick<Kernel, 'content' | 'meters'>, state: GameState): ChannelView {
  const ch = readChannel(state)
  if (!ch.open) return { open: false, note: '還沒有頻道。' }
  const rules = channelRules(k)
  const subs = meterOf(k, state, SUBS)
  const credibility = meterOf(k, state, CREDIBILITY)
  const level = levelOf(rules, subs)
  const nextAt = rules.level_at[level - 1]
  const rows: PoolRow[] = [{ pool: 'own', name: '自有資金', cred: ch.budget.own.cred, cash: ch.budget.own.cash, quota: null, sponsored: false }]
  for (const id of poolOrder(ch)) {
    const pool = ch.budget.pools[id] ?? { cred: 0, quota: 0 }
    const sponsored = ch.sponsors.some((s) => s.faction === id)
    if (!sponsored && pool.cred === 0 && pool.quota === 0) continue
    rows.push({ pool: id, name: poolName(k, id), cred: pool.cred, cash: 0, quota: pool.quota, sponsored })
  }
  const total = { cred: rows.reduce((s, r) => s + r.cred, 0), cash: rows.reduce((s, r) => s + r.cash, 0) }
  return {
    open: true, name: ch.name, since: ch.since, level, seats: seatsOf(rules, level), subs, credibility, reco: meterOf(k, state, RECO), flow_tier: flowTierOf(rules, true, subs, credibility),
    next: nextAt === undefined ? null : { level: level + 1, at: nextAt, gap: Math.max(0, nextAt - subs) },
    budget: { rows, total },
    sponsors: ch.sponsors.map((s): SponsorRow => ({
      faction: s.faction, name: poolName(k, s.faction), every_weeks: s.every_weeks, amount: s.amount, weeks_left: s.weeks_left_to_pay,
      pool: { cred: ch.budget.pools[s.faction]?.cred ?? 0, quota: ch.budget.pools[s.faction]?.quota ?? 0 },
      plug: s.plug_every === undefined ? null : { every: s.plug_every, pay: s.plug_pay ?? 0, since_last: s.eps_since_plug, due: s.eps_since_plug >= s.plug_every },
      no_report: s.no_report ? { ...s.no_report } : null, tiers_off: [...(s.tiers_off ?? [])],
    })),
    week: { episodes: ch.week.episodes, lives: ch.week.lives },
    recent: [...ch.log].reverse(),
  }
}
