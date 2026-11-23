// L6 功能 security 的敵對值與好感：每週消退、收買、給介面看的清單（FACTIONS 第 5、6 節；dev/work/M2-security.md）。
// 量表本身（hostility、hostility_floor、favor）是核心的狀態，定義在 index.ts；這裡是它們的規則。
// 改狀態的入口都是匯出一個純函式、回傳報告草稿：消退由 time.passed 掛鉤提交，收買由介面交給 Game.commit。

import type { Change, ContentEntry, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord, meterOf, weeklyCrossings } from '../../core'
import type { TierView } from './model'
import { EXT, favorTierOf, hostilityTierOf, securityRules } from './model'

const nameOf = (k: Pick<Kernel, 'content'>, id: string): string => {
  const f = k.content.get<ContentEntry & { short?: string; name?: string }>('faction', id)
  return f?.short ?? f?.name ?? id
}

// ---- 這一週有沒有新的敵對值 ----

/** state.ext.security：{ fresh: { 勢力: true } }，那一週內有新的敵對值的勢力。 */
function extOf(state: Pick<GameState, 'ext'>): Record<string, unknown> {
  const raw = state.ext[EXT]
  return isRecord(raw) ? raw : {}
}
const freshOf = (state: Pick<GameState, 'ext'>): Record<string, true> => {
  const f = extOf(state).fresh
  return isRecord(f) ? Object.fromEntries(Object.keys(f).map((x) => [x, true as const])) : {}
}

/** 把 fresh 寫回 ext（空的就整個拿掉）。 */
function extChange(state: Pick<GameState, 'ext'>, fresh: Record<string, true>): Change {
  const rest = { ...clone(extOf(state)) }
  delete rest.fresh
  const value = Object.keys(fresh).length > 0 ? { ...rest, fresh } : rest
  return { op: 'ext', key: EXT, value: Object.keys(value).length > 0 ? value : null }
}

/**
 * 掛在每一份報告套用之前：報告裡有勢力的敵對值上升了，就記下「那一週有新的敵對值」（消退用）；
 * 下限被抬高了，順手讓敵對值落在下限之上（量表的夾值是「落在範圍內」，delta 0 就會把它抬上去）。
 * 看的是報告裡的 meter 變更（效果已經結算成實際的量），所以不管是掃橋、事件、委託，哪一條路加的敵對值都記得到。
 */
export function standingBefore(k: Kernel, state: GameState, changes: Change[]): Change[] {
  const known = freshOf(state)
  const fresh = { ...known }
  const lift: string[] = []
  for (const c of changes) {
    if (c.op !== 'meter' || typeof c.key !== 'string') continue
    const delta = typeof c.delta === 'number' ? c.delta : undefined
    const set = typeof c.set === 'number' ? c.set : undefined
    if (c.kind === 'hostility') {
      if ((delta !== undefined && delta > 0) || (set !== undefined && set > meterOf(k, state, 'hostility', c.key))) fresh[c.key] = true
    } else if (c.kind === 'hostility_floor') {
      if ((delta !== undefined && delta > 0) || (set !== undefined && set > meterOf(k, state, 'hostility_floor', c.key))) lift.push(c.key)
    }
  }
  const out: Change[] = []
  if (Object.keys(fresh).length !== Object.keys(known).length) out.push(extChange(state, fresh))
  for (const faction of lift) out.push({ op: 'meter', kind: 'hostility', key: faction, delta: 0 })
  return out
}

// ---- 消退（FACTIONS 6.3 節：時間） ----

/**
 * 每週一（照時間點的規則）：每個勢力的敵對值 −5；那一週沒有新的敵對值再 −5（合計 −10）；不低於下限。
 * 一次跨過好幾個週一補好幾次（只有第一個週一看「那一週有沒有新的」，之後的週一都沒有新的）。沒有跨過週一回傳 null。
 */
export function decayDraft(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft | null {
  const weeks = weeklyCrossings(from, to, k.timeRules).length
  if (weeks === 0) return null
  const rules = securityRules(k)
  const fresh = freshOf(state)
  const rows: Array<{ faction: string; from: number; to: number }> = []
  for (const faction of Object.keys(state.meters.hostility ?? {}).sort()) {
    const start = meterOf(k, state, 'hostility', faction)
    if (start <= 0) continue
    const floor = meterOf(k, state, 'hostility_floor', faction)
    let cur = start
    for (let w = 0; w < weeks && cur > floor; w++) cur = Math.max(floor, cur - (w === 0 && fresh[faction] ? rules.decay_weekly : rules.decay_quiet))
    if (cur !== start) rows.push({ faction, from: start, to: cur })
  }
  const hadFresh = Object.keys(fresh).length > 0
  if (rows.length === 0 && !hadFresh) return null
  const lines = rows.map((r) => `${nameOf(k, r.faction)}對你的敵對值從 ${r.from} 降到 ${r.to}`)
  const text = lines.length > 0 ? `過了${weeks > 1 ? ` ${weeks} 週` : '一週'}，${lines.join('；')}。` : `過了${weeks > 1 ? ` ${weeks} 週` : '一週'}，沒有勢力的敵對值要消退。`
  return {
    kind: 'downtime', action: 'security.decay', location: clone(state.location), party: [],
    timeline: rows.map((r) => ({ layer: 'meat' as const, text: `${nameOf(k, r.faction)}對你的敵對值從 ${r.from} 降到 ${r.to}。`, tag: 'security.decay', data: { faction: r.faction, from: r.from, to: r.to } })),
    changes: [...rows.map((r): Change => ({ op: 'meter', kind: 'hostility', key: r.faction, delta: r.to - r.from })), ...(hadFresh ? [extChange(state, {})] : [])],
    outcome: { result: 'decay', summary: text },
    ...(lines.length > 0 ? { narration: { results: lines } } : {}),
  }
}

// ---- 收買（FACTIONS 6.3 節） ----

/** 每降 1 點的單價：50 ×（敵對值 ÷ 20 進位）。 */
export function bribeUnit(k: Pick<Kernel, 'content'>, hostility: number): number {
  const r = securityRules(k)
  return r.bribe_per_point * Math.ceil(hostility / r.bribe_step)
}

/** 降 points 點要付多少錢（照現在的敵對值算單價）。 */
export function bribePrice(k: Kernel, state: GameState, faction: string, points: number): number {
  return bribeUnit(k, meterOf(k, state, 'hostility', faction)) * points
}

/** 現在收買做不做得成：null 是做得成，否則是一句話的原因（一次只講一條）。 */
export function bribeBlock(k: Kernel, state: GameState, faction: string, points: number): string | null {
  const f = k.content.get<ContentEntry & { bribe?: unknown }>('faction', faction)
  if (!f) return `沒有 ${faction} 這個勢力。`
  const name = nameOf(k, faction)
  const rules = securityRules(k)
  if (!Number.isInteger(points) || points < 1) return `要收買幾點：1～${rules.bribe_max} 的整數。`
  if (f.bribe !== true) return `${name}不收錢。`
  const h = meterOf(k, state, 'hostility', faction)
  const floor = meterOf(k, state, 'hostility_floor', faction)
  if (h <= 0) return `${name}現在沒有在找你麻煩，不用收買。`
  if (h <= floor) return `${name}對你的敵對值已經降到下限（${floor}），錢買不動了。`
  if (points > rules.bribe_max) return `收買一次最多降 ${rules.bribe_max} 點。`
  if (points > h - floor) return `${name}的敵對值最多還能降 ${h - floor} 點（現在 ${h}，下限 ${floor}）。`
  const price = bribeUnit(k, h) * points
  if (state.money.cash < price) return `現金不夠：降 ${points} 點要 ${price} C$，你的現金只有 ${state.money.cash} C$。`
  return null
}

/** 收買：付現金，敵對值降 points 點。做不成丟 ActionBlocked（原因同 bribeBlock）。 */
export function bribe(k: Kernel, state: GameState, faction: string, points: number): ReportDraft {
  const why = bribeBlock(k, state, faction, points)
  if (why) throw new ActionBlocked(why)
  const h = meterOf(k, state, 'hostility', faction)
  const price = bribeUnit(k, h) * points
  const text = `你給${nameOf(k, faction)}的人塞了 ${price} C$，它對你的敵對值從 ${h} 降到 ${h - points}。`
  return {
    kind: 'deal', action: 'security.bribe', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: 'security.bribe', data: { faction, points, price, from: h, to: h - points } }],
    changes: [{ op: 'cash', delta: -price }, { op: 'meter', kind: 'hostility', key: faction, delta: -points }],
    outcome: { result: 'bribed', summary: text },
    narration: { results: [`付了 ${price} C$，${nameOf(k, faction)}的敵對值降了 ${points} 點`] },
  }
}

// ---- 給介面看的清單 ----

export interface HostilityRow {
  faction: string
  name: string
  value: number
  tier: TierView
  /** 下限（0 是沒有） */
  floor: number
  /** 現在收買得動嗎：不收錢、已經在下限等原因；做得動是 null（點數照 1 點試） */
  bribe: string | null
}

/** 現在有敵對值的勢力（畫面上只顯示這幾個）：高的在前；每一筆有哪一段與下限。 */
export function hostilityView(k: Kernel, state: GameState): HostilityRow[] {
  const rules = securityRules(k)
  const ids = new Set([...Object.keys(state.meters.hostility ?? {}), ...Object.keys(state.meters.hostility_floor ?? {})])
  const rows: HostilityRow[] = []
  for (const faction of ids) {
    const value = meterOf(k, state, 'hostility', faction)
    const floor = meterOf(k, state, 'hostility_floor', faction)
    if (value <= 0 && floor <= 0) continue
    rows.push({ faction, name: nameOf(k, faction), value, tier: hostilityTierOf(rules, value), floor, bribe: bribeBlock(k, state, faction, 1) })
  }
  return rows.sort((a, b) => b.value - a.value || (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0))
}

export interface FavorRow {
  faction: string
  name: string
  value: number
  tier: TierView
}

/** 好感的清單：好感不是起始值（10）的勢力。 */
export function favorView(k: Kernel, state: GameState): FavorRow[] {
  const rules = securityRules(k)
  const start = k.meters.get('favor')?.start ?? 0
  return Object.keys(state.meters.favor ?? {})
    .map((faction) => ({ faction, name: nameOf(k, faction), value: meterOf(k, state, 'favor', faction) }))
    .filter((r) => r.value !== start)
    .map((r) => ({ ...r, tier: favorTierOf(rules, r.value) }))
    .sort((a, b) => b.value - a.value || (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0))
}
