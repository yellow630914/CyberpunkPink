// L6 功能 curtain 給畫面看的一趟：第幾幕、場熱與三段的說明、這一幕用了幾回合、點單、票根、贊助人在不在、現在能做的事。

import type { GameState, GridUse, Kernel, MarkerDef } from '../../core'
import { ctxOf, defOf } from './ctx'
import { heatBand, heatOf, tipsRatio } from './heat'
import type { OfferRec, OrderRec, PendingRec } from './model'
import { NIGHT_KIND, curtainRules, readCurtain } from './model'
import type { NightEntry } from './model'
import { bookBlock, exploreOf, nearUses, roomOpen, roundsOf } from './nodes'
import { orderText } from './orders'
import { stubsOf } from './tables'

export interface HeatBand {
  /** 這一段的下限 */
  from: number
  /** 打賞的比例 */
  ratio: number
  /** 現在在這一段 */
  here: boolean
}

export interface CurtainView {
  /** 這一趟的編號 */
  id: string
  night: { id: string; name: string; culture: string; feature: boolean }
  tier: string
  pure_stage: boolean
  /** 第幾幕（從 1 起算）、這一幕的名字、一共幾幕、標準回合數、這一幕用了幾回合 */
  act: { number: number; name: string; total: number; standard: number; used: number; explored: number; boss: string | null }
  encore: boolean
  heat: { value: number; ratio: number; bands: HeatBand[]; sponsor_at: number; encore_at: number; peak: number }
  /** 贊助人在場 */
  sponsor: boolean
  /** 場熱到 0：觀眾散場，這一趟只能收場 */
  cut: boolean
  /** 可以加演（場熱到過門檻） */
  encore_open: boolean
  tips_mult: number
  signed: boolean
  stubs: number
  stub_value: number
  orders: OrderRec[]
  /** 看過、等著決定的點單 */
  offer: (OfferRec & { text: string }) | null
  pending: (PendingRec & { text: string }) | null
  /** 現在站的位置旁邊的節點能做的事 */
  near: Array<{ marker: MarkerDef; role: string; uses: GridUse[] }>
  /** 不在哪一格都能做的事（化妝室的包場） */
  free: GridUse[]
  /** 化妝室現在開著 */
  room: boolean
  docked: number
}

/** 現在這一趟（沒有是 null）。人不在簾後館的地圖上（例如結算中）也回得出大部分欄位，只是沒有 near。 */
export function curtainView(k: Kernel, state: GameState): CurtainView | null {
  const run = readCurtain(state).run
  if (!run || run.over) return null
  const rules = curtainRules(k)
  const c = ctxOf(k, state)
  const night = k.content.get<NightEntry>(NIGHT_KIND, run.night)
  const map = c?.map ?? run.map
  const heat = heatOf(k, state, map)
  const act = c?.act ?? run.act ?? 0
  const def = defOf(rules, act)
  const base = run.encore ? rules.act_defs.length : 0
  const total = run.encore ? rules.encore.names.length : rules.act_defs.length
  const offer = run.offer ? { ...run.offer, text: orderText(run.offer.kind, run.offer.name, run.offer.style) } : null
  const pending = run.pending ? { ...run.pending, text: orderText(run.pending.kind, run.orders?.[run.pending.order]?.name ?? '點單', run.pending.style) } : null
  const edges = [0, ...rules.tips_edges]
  const band = heatBand(rules, heat)
  return {
    id: run.id,
    night: { id: run.night, name: night?.name ?? run.night, culture: night?.culture ?? '', feature: run.feature },
    tier: run.tier, pure_stage: run.pure_stage,
    act: { number: act - base + 1, name: def.name, total, standard: def.turns, used: roundsOf(state, run.id, act), explored: exploreOf(state, run.id, act), boss: def.boss ?? null },
    encore: run.encore !== undefined,
    heat: { value: heat, ratio: tipsRatio(rules, heat), bands: edges.map((from, i) => ({ from, ratio: rules.tips[i] ?? 0, here: i === band })), sponsor_at: rules.heat.sponsor, encore_at: rules.heat.encore, peak: Math.max(run.peak ?? 0, heat) },
    sponsor: run.sponsor === true, cut: run.cut === true, encore_open: run.encore_open === true, tips_mult: run.tips_mult ?? 1, signed: run.signed === true, stubs: stubsOf(state), stub_value: rules.stub_value,
    orders: (run.orders ?? []).map((o) => ({ ...o })), offer, pending,
    near: c ? nearUses(c) : [],
    free: c ? [{ id: 'book', name: '包場', block: bookBlock(c) }].filter((u) => run.sponsor === true || u.block === null) : [],
    room: c ? roomOpen(c) : false,
    docked: run.docked ?? 0,
  }
}
