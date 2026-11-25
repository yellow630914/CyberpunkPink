// L6 功能 contract 隨時間與別的報告發生的事（dev/work/M4-contract.md 第 2、6、7、8、9 點；EVENTS 4.5 節；DOWNTIME 4.2 節；dev/adr/0019 P27～P30）。
//   time.passed     這一刻在委託副本裡：每一條還沒了結的指令的期限往後挪經過的時間（報告 contract.pause）；沒在副本裡才計時：
//                   期滿 → 解約（contract.end）；強制的過了期限 → overdue、滿意 −10、抽一種處置（鎖義體、感載、報位置），沒有效果可用的那一種不抽；
//                   送達或作廢的過了期限 → 作廢、滿意 −5（contract.overdue）；
//                   每天 08:00：每週回報那一天排一條 report（不擲）、佇列不到 queue_max 就擲要不要下指令、下哪一種（contract.order）；
//                   債務契約每 30 天加一期月息（contract.pay）；
//                   每天 05:00：有宵禁就查人在不在住處（條件 at_home；沒有人註冊就不查），不在記一次違規（contract.rule）。
//   report.before   指令裡有照做中或被強制的工作，而且這份報告是打工結算（action 以 work. 開頭）：往上的錢 (1 − income_keep) 改成不給，
//                   債務契約把那些記成還債；債還完就解約。並在這份報告的結果加一句。
//   report.after    把記著的通知（簽下、解約、事件塞進來的指令）寫成報告（contract.sign、contract.end、contract.order）；
//                   一份讓主角走進禁區的報告之後接一份違規（contract.rule、滿意 −5）。
// 骰子一律 deriveRng（用途帶時間或 id）；一次跨很多天，每一種最多補最近三次。

import type { ActorId, Change, Effect, GameState, GameTime, Kernel, Report, ReportDraft } from '../../core'
import { MINUTES_PER_DAY, clone, compareNatural, crossings, dailyCrossings, deriveRng, toMinutes, weekdayOf } from '../../core'
import { draftOf } from './draft'
import type { Contract, ContractExt, Order } from './model'
import {
  COMMISSION, DEBT_PERIOD_DAYS, END_ACTION, HOLD_ACTION, RELEASE_ACTION, LOAD_CAP_STAT, METER_KEY, ORDER_ACTION, ORDER_NAME, OVERDUE_ACTION, PAUSE_ACTION, PAY_ACTION, RULE_ACTION, SATISFACTION, SIGN_ACTION,
  activeCount, contractOf, contractRules, dailyChance, extAfter, extChange, extOf, isActive, kindWeights, meterNow, nowOf, pcOf, scopeData, trimRecords,
} from './model'
import { builtinFx, endPlan, makeOrder, orderText } from './plans'
import { holderDrafts, releasedTrigger } from './held'

/** 一次跨過很多天，每一種最多補最近幾次。 */
const MAX_CATCH_UP = 3
const CURFEW_RULE = { every: 1440, offset: 5 * 60 }

const inCommission = (k: Kernel, state: GameState): boolean => k.activity.active(state).some((a) => a.kind === COMMISSION)

// ---- 逾期的處置 ----

export type OverdueId = 'lock' | 'load' | 'expose'

export interface OverdueOption {
  id: OverdueId
  name: string
  weight: number
  /** 現在查得到效果、驗得過 */
  available: boolean
  effects: Effect[]
  changes: Change[]
  lines: string[]
  text: string
}

/** 三種處置現在各自能不能用（鎖義體要有 cyber_lock、感載要有橋、報位置要持約人有勢力；效果查不到或驗不過的不算）。 */
export function overdueOptions(k: Kernel, state: GameState, pc: ActorId, c: Contract): OverdueOption[] {
  const r = contractRules(k).overdue
  const a = state.actors[pc]
  const cap = k.stats.hasStat(LOAD_CAP_STAT) ? k.stats.stat(state, pc, LOAD_CAP_STAT) : 20
  const loadAmount = a ? Math.ceil(cap * r.load.share) - a.load : 0
  const specs: Array<{ id: OverdueId; name: string; weight: number; ok: boolean; effects: Effect[]; text: string }> = [
    { id: 'lock', name: '鎖住一件義體', weight: r.lock.weight, ok: true, effects: [{ kind: 'cyber_lock', on: true, hours: r.lock.hours, why: 'contract' }], text: '橋自己動手，鎖住了你身上的一件義體。' },
    { id: 'load', name: '一陣感載', weight: r.load.weight, ok: !!a && a.ext.bridge !== null && loadAmount > 0, effects: [{ kind: 'load', amount: loadAmount }], text: '橋猛地一拉，你的感載一下子衝了上去。' },
    {
      id: 'expose', name: '把位置報出去', weight: r.expose.weight, ok: c.holder.faction !== undefined,
      effects: c.holder.faction !== undefined ? [{ kind: 'hostility', key: c.holder.faction, amount: r.expose.hostility }] : [], text: `橋把你的位置報給了${c.holder.name}，那邊的人開始盯著你。`,
    },
  ]
  return specs.map((s) => {
    const fx = s.ok && s.weight > 0 ? builtinFx(k, state, pc, s.effects) : { ok: false, changes: [] as Change[], lines: [] as string[] }
    return { id: s.id, name: s.name, weight: s.weight, available: fx.ok, effects: s.effects, changes: fx.changes, lines: fx.lines, text: s.text }
  })
}

/** 一條強制的指令過了期限：橋自己動手。回傳這一份報告的草稿（已經照 sim 的狀態算好）。 */
function overdueDraft(k: Kernel, sim: GameState, pc: ActorId, orderId: string): ReportDraft | null {
  const ext = extOf(sim)
  const c = ext.mine
  const o = c?.queue.find((x) => x.id === orderId)
  if (!c || !o) return null
  const rules = contractRules(k)
  const forced = o.state === 'forced'
  o.state = 'overdue'
  o.closed = nowOf(sim)
  if (!forced) o.lapsed = true
  trimRecords(c, rules.keep_records)
  const changes: Change[] = [extChange(ext), { op: 'meter', kind: SATISFACTION, key: METER_KEY, delta: forced ? rules.satisfaction.overdue : rules.satisfaction.expire }]
  const name = ORDER_NAME[o.kind]
  if (!forced) return draftOf(sim, 'downtime', OVERDUE_ACTION, changes, [`${c.holder.name}交代的${name}過了期限，沒有人理它，指令作廢了，${c.holder.name}的滿意掉了一點。`], 'lapsed')
  const avail = overdueOptions(k, sim, pc, c).filter((x) => x.available)
  const lines = [`${c.holder.name}交代的${name}過了期限，你還是沒有做，滿意掉了一大截。`]
  let result = 'overdue'
  if (avail.length > 0) {
    const pick = deriveRng(sim.rng, `${OVERDUE_ACTION}/${o.id}`).weighted(avail, (x) => x.weight)
    changes.push({ op: 'rng', advance: 1 }, ...pick.changes)
    lines.push(pick.text)
    result = `overdue_${pick.id}`
  }
  return draftOf(sim, 'downtime', OVERDUE_ACTION, changes, lines, result)
}

// ---- time.passed ----

/** 沒事回 []。每一份草稿都接在前一份之後（sim 是一路套下去的複製）。 */
export function timeDrafts(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const pc = pcOf(state)
  if (!pc || (!contractOf(state) && Object.keys(extOf(state).held).length === 0)) return []
  const sim = clone(state)
  const out: ReportDraft[] = []
  const emit = (d: ReportDraft): void => {
    out.push(d)
    k.changes.applyAll(sim, d.changes)
  }
  // 兩個方向共用一份 ext：先做主角是契約人的（有契約才做），再做主角是持約人的（M4-contract-holder）
  if (contractOf(sim)) mineDrafts(k, sim, emit, pc, from, to)
  holderDrafts(k, sim, emit, from, to)
  return out
}

/** 主角是契約人那一面隨時間發生的事。 */
function mineDrafts(k: Kernel, sim: GameState, emit: (d: ReportDraft) => void, pc: ActorId, from: GameTime, to: GameTime): void {
  const state = sim
  const nowTo = toMinutes(to)
  const span = nowTo - toMinutes(from)
  const paused = inCommission(k, state)
  const rules = contractRules(k)

  // 委託副本裡不計時：期限往後挪經過的時間
  if (paused && span > 0 && extOf(sim).mine!.queue.some(isActive)) {
    const ext = extOf(sim)
    for (const o of ext.mine!.queue) if (isActive(o)) o.deadline += span
    emit(draftOf(sim, 'system', PAUSE_ACTION, [extChange(ext)], [], 'paused'))
  }

  // 期滿
  const c0 = contractOf(sim)
  if (c0?.until !== undefined && nowTo >= c0.until) {
    const end = endPlan(sim, pc, 'expired', { silent: true })!
    emit(draftOf(sim, 'downtime', END_ACTION, end.changes, [end.text], 'expired'))
    return
  }

  // 逾期（副本裡不計）
  if (!paused) {
    const due = contractOf(sim)!.queue.filter((o) => isActive(o) && o.deadline <= nowTo).sort((a, b) => a.deadline - b.deadline || compareNatural(a.id, b.id))
    for (const o of due) {
      const d = overdueDraft(k, sim, pc, o.id)
      if (d) emit(d)
    }
  }

  // 每天 08:00：每週回報、擲要不要下指令
  for (const t of dailyCrossings(from, to).slice(-MAX_CATCH_UP)) {
    const tm = toMinutes(t)
    const credit = paused ? nowTo - tm : 0
    const live = (o: Order): boolean => o.deadline + credit > nowTo
    // 每週回報：那一天自動排一條，不擲、不佔機率
    let c = contractOf(sim)
    if (c && c.report_weekday !== undefined && weekdayOf(t, k.timeRules) === c.report_weekday && !c.queue.some((o) => isActive(o) && o.kind === 'report')) {
      const ext = extOf(sim)
      const order = makeOrder(k, sim, ext, { kind: 'report', now: tm })
      order.deadline += credit
      if (live(order)) {
        ext.mine!.queue.push(order)
        emit(draftOf(sim, 'downtime', ORDER_ACTION, [extChange(ext)], [orderText(ext.mine!, order)], 'weekly'))
      }
    }
    c = contractOf(sim)
    if (!c || activeCount(c) >= scopeData(k).queue_max) continue
    const rng = deriveRng(sim.rng, `contract/roll/${tm}`)
    if (!(rng.next() < dailyChance(k, c, meterNow(k, sim)))) continue
    const kinds = kindWeights(k, sim, c)
    if (kinds.length === 0) continue
    const kind = rng.weighted(kinds, (x) => x[1])[0]
    const ext = extOf(sim)
    const order = makeOrder(k, sim, ext, { kind, now: tm })
    order.deadline += credit
    if (!live(order)) continue
    ext.mine!.queue.push(order)
    emit(draftOf(sim, 'downtime', ORDER_ACTION, [extChange(ext)], [orderText(ext.mine!, order)], 'sent'))
  }

  // 債務的月息
  const c2 = contractOf(sim)
  if (c2 && c2.type === 'debt' && c2.interest_at !== undefined && (c2.debt ?? 0) > 0 && nowTo >= c2.interest_at && rules.debt_monthly > 0) {
    const period = DEBT_PERIOD_DAYS * MINUTES_PER_DAY
    const n = Math.min(12, Math.floor((nowTo - c2.interest_at) / period) + 1)
    const ext = extOf(sim)
    for (let i = 0; i < n; i++) ext.mine!.debt = ext.mine!.debt! + Math.round(ext.mine!.debt! * rules.debt_monthly)
    ext.mine!.interest_at = c2.interest_at + Math.floor((nowTo - c2.interest_at) / period + 1) * period
    emit(draftOf(sim, 'downtime', PAY_ACTION, [extChange(ext)], [`你欠${c2.holder.name}的債又滾了一期月息。`], 'interest'))
  }

  // 宵禁：每天 05:00 查人在不在住處
  const cur = contractOf(sim)
  if (cur?.rules.some((r) => r.kind === 'curfew') && k.conditions.kinds().includes('at_home')) {
    for (const _t of crossings(from, to, CURFEW_RULE).slice(-MAX_CATCH_UP)) {
      void _t
      const home = k.conditions.test({ kind: 'at_home' }, { state: sim, actor: pc, stats: k.stats, timeRules: k.timeRules })
      if (home) continue
      emit(draftOf(sim, 'downtime', RULE_ACTION, [{ op: 'meter', kind: SATISFACTION, key: METER_KEY, delta: rules.satisfaction.rule }], [`${cur.holder.name}設的宵禁到了，你不在住處，橋把這一次記了下來。`], 'curfew'))
    }
  }
}

// ---- report.before：收入歸屬 ----

/** 這份報告是打工的結算：action 以 work. 開頭（features/work 的是 work.shift）。 */
export const isWorkSettle = (draft: Pick<ReportDraft, 'action'>): boolean => typeof draft.action === 'string' && draft.action.startsWith('work.')

export function incomeBefore(k: Kernel, state: GameState, draft: ReportDraft): Change[] | undefined {
  if (!isWorkSettle(draft)) return undefined
  const pc = pcOf(state)
  const ext: ContractExt = extAfter(state, draft.changes)
  const c = ext.mine
  if (!pc || !c || !c.queue.some((o) => o.kind === 'work' && (o.state === 'doing' || o.state === 'forced'))) return undefined
  const keep = contractRules(k).income_keep
  const out: Change[] = []
  let taken = 0
  for (const ch of draft.changes) {
    if ((ch.op !== 'cash' && ch.op !== 'cred') || typeof ch.delta !== 'number' || ch.delta <= 0) continue
    const cut = Math.floor(ch.delta * (1 - keep) + 1e-9)
    if (cut <= 0) continue
    taken += cut
    out.push({ op: ch.op, delta: -cut })
  }
  if (taken <= 0) return undefined
  let line: string
  if (c.type === 'debt') {
    c.debt = Math.max(0, (c.debt ?? 0) - taken)
    line = '工作的收入大部分直接抵了債，只有一點零用錢到了你手上。'
  } else line = '工作的收入大部分歸了持約人，你只拿到一點零頭。'
  if (c.type === 'debt' && c.debt === 0) out.push(...endPlan(state, pc, 'paid_off', { base: ext })!.changes)
  else out.push(extChange(ext))
  draft.narration = { ...(draft.narration ?? {}), results: [...(draft.narration?.results ?? []), line] }
  draft.outcome = { ...draft.outcome, summary: `${draft.outcome.summary}${line}` }
  return out
}

// ---- report.after：通知與禁區 ----

const NOTE_ACTION = { sign: SIGN_ACTION, order: ORDER_ACTION, end: END_ACTION, hold: HOLD_ACTION, release: RELEASE_ACTION } as const
const NOTE_RESULT = { sign: 'signed', order: 'sent', end: 'ended', hold: 'held', release: 'released' } as const

export function afterDrafts(k: Kernel, state: GameState, report: Report): ReportDraft[] {
  if (report.rewind || report.retracted) return []
  const pc = pcOf(state)
  if (!pc) return []
  const out: ReportDraft[] = []
  const ext = extOf(state)
  // 記著的通知：第一份把全部清掉（接著提交的每一份報告又會問一次這個掛鉤，不能留著重發）
  ext.notes.forEach((n, i) => {
    const triggers = n.kind === 'release' && !n.stay && n.npc ? releasedTrigger(n.npc, n.relation ?? 'formal') : undefined
    out.push(draftOf(state, 'downtime', NOTE_ACTION[n.kind], i === 0 ? [extChange({ ...ext, notes: [] })] : [], [n.text], n.result ?? NOTE_RESULT[n.kind], triggers ? { triggers } : {}))
  })
  // 走進禁區
  const c = ext.mine
  if (c && !(ext.notes.some((n) => n.kind === 'end'))) {
    const zones = c.rules.filter((r) => r.kind === 'zone' && typeof r.value === 'string').map((r) => r.value as string)
    const moved = [...report.changes].reverse().find((ch) => ch.op === 'location') as { to?: { district?: string; block?: string } } | undefined
    if (zones.length > 0 && moved?.to) {
      const into = (loc: { district?: string; block?: string }): string[] => zones.filter((z) => loc.district === z || loc.block === z)
      const was = new Set(into(report.location))
      const entered = into(moved.to).filter((z) => !was.has(z))
      if (entered.length > 0) {
        const delta = contractRules(k).satisfaction.rule
        out.push(draftOf(state, 'downtime', RULE_ACTION, [{ op: 'meter', kind: SATISFACTION, key: METER_KEY, delta }], [`你走進了${c.holder.name}劃給你的禁區，橋把這一次記了下來。`], 'zone'))
      }
    }
  }
  return out
}
