// L6 功能 tuning 的靜室（MIGRATION N 組 purify；LEWD_SYSTEM 第 1 節「怎麼變」；dev/adr/0019 P48；dev/work/M4-tuning.md 第 6 點）。
// 在 tuning.quiet_room 的設施，付錢把一項橋參數往上或往下調 step 點（用 bridge 效果，內建的來源，照它的 0～100 夾）；每週 per_week 次；
// 往上調的那一次沉溺 +sink_up（走 sink 效果；沒有人註冊就略過）。沒有橋的人擋下。價錢還沒有乘區的倍率。

import type { ActorId, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, effectCtx, formatAmount } from '../../core'
import type { BridgeParam } from './model'
import { BRIDGE_EFFECT, NO_BRIDGE_TEXT, PARAM_NAME, QUIET_ACTION, SINK_EFFECT, hasBridge, isParam, nameOfActor, nowOf, paramStatId, readExt, tuningRules, weekOf } from './model'
import type { Pool } from './install'
import { POOL_NAME, activityBlock, extChange, payPool, tuningHere, tuningReport } from './install'

export interface QuietOpts {
  actor?: ActorId
  param: BridgeParam
  /** 往上（1）或往下（−1） */
  dir: 1 | -1
  pay?: Pool
}

export interface QuietQuote {
  actor: ActorId
  param: BridgeParam
  dir: 1 | -1
  facility: string
  /** 現在的基本值 */
  from: number
  /** 實際調幾點（夾在 0～100 之後；已經到頭是 0） */
  delta: number
  price: number
  minutes: number
  /** 往上調時沉溺加幾點（往下是 0） */
  sink: number
  pay: Pool | null
}

interface Plan {
  problems: string[]
  quote: QuietQuote | null
  changes: Change[]
}

/** 橋參數的基本值（衍生數值 bridge_<參數> 的「基礎」那一筆；沒有人定義那個數值是 null）。 */
export function baseOf(k: Kernel, state: GameState, actor: ActorId, param: BridgeParam): number | null {
  const id = paramStatId(param)
  if (!k.stats.hasStat(id)) return null
  return k.stats.statParts(state, actor, id).find((p) => p.source === 'base')?.value ?? null
}

function plan(k: Kernel, state: GameState, o: QuietOpts): Plan {
  const who = o.actor ?? state.pc
  if (!who || !state.actors[who]) return { problems: ['找不到這個角色。'], quote: null, changes: [] }
  const problems: string[] = []
  const act = activityBlock(k, state, QUIET_ACTION)
  if (act) problems.push(act)
  if (!state.party.includes(who)) problems.push('要調整的人不在隊上。')
  if (!isParam(o.param)) return { problems: [...problems, '沒有這一項橋參數。'], quote: null, changes: [] }
  if (o.dir !== 1 && o.dir !== -1) return { problems: [...problems, '要往上或往下調，沒有第三種。'], quote: null, changes: [] }
  if (!hasBridge(k, state, who)) problems.push(NO_BRIDGE_TEXT)
  const rules = tuningRules(k)
  const here = tuningHere(k, state)
  if (!here || !here.quiet_room) problems.push('這裡沒有靜室，調不了橋參數。')
  const ext = readExt(state, who, rules.slots)
  const week = weekOf(k, nowOf(state))
  const used = ext.quiet_week === week ? ext.quiet_n ?? 1 : 0
  if (used >= rules.quiet.per_week) problems.push('這一週已經在靜室調過了，下個週一再來。')
  const name = PARAM_NAME[o.param]
  const from = hasBridge(k, state, who) ? baseOf(k, state, who, o.param) : null
  if (from !== null) {
    if (o.dir > 0 && from >= 100) problems.push(`${name}已經是 100，沒辦法再往上調了。`)
    if (o.dir < 0 && from <= 0) problems.push(`${name}已經是 0，沒辦法再往下調了。`)
  }
  const price = rules.quiet.price
  const pay = payPool(state.money, price, o.pay)
  if (price > 0 && pay === null) problems.push(`錢不夠：靜室要 ${formatAmount(price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`)
  // 用 bridge 效果實際算一次（夾值照它的）；沉溺走 sink 效果
  let delta = 0
  let sink = 0
  const changes: Change[] = []
  const clean = problems.length === 0
  if (from !== null && k.effects.has(BRIDGE_EFFECT)) {
    const ctx = effectCtx(k, state, { source: 'builtin', actor: who })
    const fx: Array<Record<string, unknown>> = [{ kind: BRIDGE_EFFECT, param: o.param, amount: o.dir * rules.quiet.step }]
    if (o.dir > 0 && rules.quiet.sink_up > 0 && k.effects.has(SINK_EFFECT)) fx.push({ kind: SINK_EFFECT, amount: rules.quiet.sink_up })
    const errors = k.effects.validate(fx, ctx)
    const res = errors.length > 0 ? null : k.effects.resolve(fx, ctx)
    if (!res || res.errors.length > 0) { if (clean) problems.push(errors[0] ?? res?.errors[0] ?? '這一次調不了。') }
    else {
      for (const c of res.changes) {
        const t = c as { op: string; key?: unknown; value?: Record<string, unknown>; track?: unknown; delta?: unknown }
        if (t.op === 'actor.ext' && t.key === 'bridge' && t.value) delta = (t.value[o.param] as number) - from
        if (t.op === 'actor.track' && t.track === 'sink' && typeof t.delta === 'number') sink += t.delta
      }
      changes.push(...res.changes)
      if (clean && delta === 0) problems.push(`${name}調不動了。`)
    }
  } else if (from !== null && clean) {
    problems.push(NO_BRIDGE_TEXT)
  }
  const quote: QuietQuote = {
    actor: who, param: o.param, dir: o.dir, facility: here?.name ?? '', from: from ?? 0, delta, price, minutes: rules.quiet.minutes, sink, pay: price > 0 ? pay : null,
  }
  return { problems, quote, changes }
}

export const quietProblems = (k: Kernel, state: GameState, o: QuietOpts): string[] => plan(k, state, o).problems
export const quietBlock = (k: Kernel, state: GameState, o: QuietOpts): string | null => plan(k, state, o).problems[0] ?? null
/** 這一次靜室的報價（實際調幾點、沉溺加幾點）；人不存在或參數不對是 null。 */
export const quietQuote = (k: Kernel, state: GameState, o: QuietOpts): QuietQuote | null => plan(k, state, o).quote

/**
 * 在靜室調一項橋參數。不成立丟 ActionBlocked。
 * 寫進狀態：付錢、橋參數 ±step（夾在 0～100）、往上調時沉溺 +sink_up、記下這一週用過一次、時間加 minutes。報告 tuning.quiet。
 */
export function quietDraft(k: Kernel, state: GameState, o: QuietOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0 || !p.quote) throw new ActionBlocked(p.problems[0] ?? '現在調不了。')
  const q = p.quote
  const rules = tuningRules(k)
  const ext = readExt(state, q.actor, rules.slots)
  const week = weekOf(k, nowOf(state))
  ext.quiet_n = ext.quiet_week === week ? (ext.quiet_n ?? 1) + 1 : 1
  ext.quiet_week = week
  const changes: Change[] = []
  if (q.pay && q.price > 0) changes.push({ op: q.pay, delta: -q.price })
  changes.push(...p.changes, extChange(q.actor, ext), { op: 'time', minutes: q.minutes })
  const name = PARAM_NAME[q.param]
  const lines = [`${nameOfActor(state, q.actor)}在${q.facility}的靜室裡，把橋的${name}${q.dir > 0 ? '往上' : '往下'}調了一點。`]
  if (q.sink > 0) lines.push('往上調的時候，人也跟著往下陷了一點。')
  return tuningReport(state, QUIET_ACTION, q.actor, changes, lines, q.dir > 0 ? 'up' : 'down', { param: q.param, from: q.from, delta: q.delta, sink: q.sink, price: q.price, minutes: q.minutes })
}
