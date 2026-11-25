// L6 功能 tuning 的每週與換橋（dev/work/M4-tuning.md 第 3、7 點）。
//   sink_weekly  裝著的調校帶這個開關（反面，裝不穩也算）：每跨過一個週一 06:00，主角沉溺 +1（走 sink 效果；沒有人註冊就略過；一次最多補最近三次）。報告 tuning.week。
//   換橋         聽 report.after：看到 action 是 cyber.bridge 的報告，被換橋的那個人沒上鎖的槽清空（上鎖的留著），接一份 tuning.remove 說明。
// 句子不帶機制數字（M4-plan 規定 8）。

import type { ActorId, Change, GameState, GameTime, Kernel, Report, ReportDraft } from '../../core'
import { effectCtx, weeklyCrossings } from '../../core'
import { extChange, tuningReport } from './install'
import { activeFlags } from './passive'
import { MAX_CATCH_UP, REMOVE_ACTION, SINK_EFFECT, WEEK_ACTION, installedIds, nameOfActor, readExt, tuningRules } from './model'

/** 換橋那一份報告的 action（features/cyberware）。 */
export const CYBER_BRIDGE_ACTION = 'cyber.bridge'

/** time.passed：跨過的每個週一各一份報告（最多最近三次）；沒有事是 []。 */
export function weeklyDrafts(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const pc = state.pc
  if (!pc || !state.actors[pc] || !k.effects.has(SINK_EFFECT)) return []
  if (!activeFlags(k, state, pc).has('sink_weekly')) return []
  const crossed = weeklyCrossings(from, to, k.timeRules).slice(-MAX_CATCH_UP)
  const out: ReportDraft[] = []
  for (let i = 0; i < crossed.length; i++) {
    const ctx = effectCtx(k, state, { source: 'builtin', actor: pc })
    const fx = [{ kind: SINK_EFFECT, amount: 1 }]
    if (k.effects.validate(fx, ctx).length > 0) continue
    const res = k.effects.resolve(fx, ctx)
    if (res.errors.length > 0 || res.changes.length === 0) continue
    const text = `${nameOfActor(state, pc)}橋裡的調校一直在往下拉，這一週沉溺又陷了一點。`
    out.push(tuningReport(state, WEEK_ACTION, pc, res.changes, [text], 'week', {}))
  }
  return out
}

/** report.after：換橋之後沒上鎖的調校清掉。 */
export function bridgeChanged(k: Kernel, state: GameState, report: Report): ReportDraft[] {
  if (report.action !== CYBER_BRIDGE_ACTION) return []
  const ids = new Set<ActorId>()
  const reportActor = (report as { actor?: unknown }).actor
  if (typeof reportActor === 'string') ids.add(reportActor)
  for (const c of report.changes) {
    const t = c as { op: string; id?: unknown; key?: unknown }
    if (t.op === 'actor.ext' && t.key === 'cyber' && typeof t.id === 'string') ids.add(t.id)
  }
  const rules = tuningRules(k)
  const out: ReportDraft[] = []
  for (const id of ids) {
    if (!state.actors[id]) continue
    const ext = readExt(state, id, rules.slots)
    const dropped = installedIds(ext).filter((t) => !ext.locked[t])
    if (dropped.length === 0) continue
    ext.slots = ext.slots.map((s) => (s !== null && !ext.locked[s] ? null : s))
    const changes: Change[] = [extChange(id, ext)]
    const kept = installedIds(ext).length
    const lines = [`${nameOfActor(state, id)}換了橋，原本裝的調校都是照舊橋設定的，沒上鎖的都掉了，要重新裝。`]
    if (kept > 0) lines.push('上了鎖的還留在槽裡。')
    out.push(tuningReport(state, REMOVE_ACTION, id, changes, lines, 'bridge_changed', { removed: dropped, kept }))
  }
  return out
}
