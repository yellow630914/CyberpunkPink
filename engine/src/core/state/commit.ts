// L3 狀態核心：提交報告。整個引擎只有這一個地方會改遊戲狀態（dev/invariants.md 第 1、2 條）。
//
// 流程：report.before 掛鉤（可以替這份報告加變更）→ 在一份複製的狀態上照順序套 changes → 把報告記進紀錄 →
// 全部成功才換進正式的狀態（有一筆不合法就整份不套）→ report.after 與 time.passed 掛鉤（可以回傳接著要提交的報告）。
//
// 「changes 套用之後等於狀態的變化」的精確意思：
//   提交後的狀態 ＝ applyReport(提交前的狀態, 報告)；applyReport 只做三件事：套 changes、把報告放進 reports、流水號加一。
//   （記進 reports 的那一份，任務鏈的細節會拿掉：細節只放在 state.chains，五樓以外的才清得掉。）
// 測試用 expectedAfterCommit() 驗這一條。

import type { GameState, Report, ReportDraft } from '../types'
import { clone, deepEqual, diffPaths, replaceInPlace } from '../util/clone'
import { toMinutes } from '../util/time'
import type { StateKernel } from './kernel'

/** 掛鉤接著提交的報告最多連幾層，超過就丟錯（防止兩個功能互相觸發個沒完）。 */
export const MAX_FOLLOW_UP_DEPTH = 8

/** 純粹的套用：不跑掛鉤。回退後重播、測試驗不變式都用它。會改 state。 */
export function applyReport(k: StateKernel, state: GameState, report: Report): void {
  k.changes.applyAll(state, report.changes)
  state.reports.push(clone({ ...report, changes: k.changes.forLog(report.changes) }))
  state.seq.report += 1
}

/** 測試用：提交前的狀態加上這份報告，應該得到的狀態。不改傳進來的東西。 */
export function expectedAfterCommit(k: StateKernel, before: GameState, report: Report): GameState {
  const s = clone(before)
  applyReport(k, s, report)
  return s
}

/**
 * 提交一份報告。回傳提交後的報告（補上 id 與時間）以及掛鉤接著提交的報告。
 * 不合法時丟 ChangeError，狀態完全不變。
 */
export function commitReport(k: StateKernel, state: GameState, draft: ReportDraft): Report {
  return commitMany(k, state, draft, 0)[0]!
}

/** 同 commitReport，但把掛鉤接著提交的報告也一起回傳（第一份是原本那份）。 */
export function commitReportAll(k: StateKernel, state: GameState, draft: ReportDraft): Report[] {
  return commitMany(k, state, draft, 0)
}

function commitMany(k: StateKernel, state: GameState, draft: ReportDraft, depth: number): Report[] {
  if (depth > MAX_FOLLOW_UP_DEPTH) throw new Error(`掛鉤接著提交的報告超過 ${MAX_FOLLOW_UP_DEPTH} 層，可能是兩個功能互相觸發`)
  const work = clone(state)
  const d: ReportDraft = clone(draft)
  for (const { result } of k.hooks.run('report.before', { state: work, draft: d })) d.changes.push(...result)
  if (k.strict && !deepEqual(work, state)) throw new Error(`report.before 的掛鉤直接改了狀態：${diffPaths(state, work).join('、')}`)

  const start = clone(work.time)
  const id = `r${work.seq.report + 1}`
  k.probe.emit('core/state/commit', 'report.before', () => ({ id, draft: d, state: work }))
  // 先算出結束的時間：套一次才知道。套在 work 上，失敗就丟掉 work，正式的狀態不受影響。
  const probeState = clone(work)
  k.changes.applyAll(probeState, d.changes)
  const report: Report = { ...d, id, time: d.time ?? { start, end: clone(probeState.time) } }
  applyReport(k, work, report)
  replaceInPlace(state, work)
  k.probe.emit('core/state/commit', 'report.after', () => ({ id, report, state }))

  const out: Report[] = [report]
  const followUps: ReportDraft[] = []
  const guard = k.strict ? clone(state) : null
  for (const { result } of k.hooks.run('report.after', { state, report })) followUps.push(...result)
  if (toMinutes(report.time.end) > toMinutes(start)) {
    for (const { result } of k.hooks.run('time.passed', { state, from: start, to: report.time.end })) followUps.push(...result)
  }
  if (guard && !deepEqual(guard, state)) throw new Error(`report.after／time.passed 的掛鉤直接改了狀態：${diffPaths(guard, state).join('、')}`)
  for (const f of followUps) out.push(...commitMany(k, state, f, depth + 1))
  return out
}
