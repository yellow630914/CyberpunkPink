// L3 狀態核心：提交報告。整個引擎只有這一個地方會改遊戲狀態（dev/invariants.md 第 1、2 條）。
//
// 流程：report.before 掛鉤（可以替這份報告加變更）→ 在一份複製的狀態上照順序套 changes → 把報告記進紀錄 →
// report.after 與 time.passed 掛鉤（可以回傳接著要提交的報告，一樣套在那份複製的狀態上）→
// 整串（原本那份加上所有接著的）全部成功，才一次換進正式的狀態。有任何一筆不合法：整串不套，正式的狀態完全不變。
//
// 「changes 套用之後等於狀態的變化」的精確意思：
//   提交後的狀態 ＝ applyReport(提交前的狀態, 報告)；applyReport 只做三件事：套 changes、把報告放進 reports、流水號加一。
//   （記進 reports 的那一份，任務鏈的細節會拿掉：細節只放在 state.chains，五樓以外的才清得掉。）
// 測試用 expectedAfterCommit() 驗這一條。

import type { GameState, Report, ReportDraft } from '../types'
import { clone, deepEqual, diffPaths, replaceInPlace } from '../util/clone'
import { toMinutes } from '../util/time'
import { ChangeError } from './changes'
import { underageAt } from './coreChanges'
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
 * 提交一份報告。回傳提交後的報告（補上 id 與時間）。
 * 不合法時丟 ChangeError，狀態完全不變：掛鉤接著提交的報告不合法也一樣，原本那份不會留下一半。
 */
export function commitReport(k: StateKernel, state: GameState, draft: ReportDraft): Report {
  return commitReportAll(k, state, draft)[0]!
}

/** 同 commitReport，但把掛鉤接著提交的報告也一起回傳（第一份是原本那份）。 */
export function commitReportAll(k: StateKernel, state: GameState, draft: ReportDraft): Report[] {
  return commitAtomic(k, state, (tx) => tx.commit(draft))
}

/** 一次提交裡的操作：都作用在同一份複製的狀態上，全部成功才換進正式的狀態。 */
export interface CommitTx {
  /** 複製的狀態：掛鉤看到的是它（唯讀）。它已經包含這次提交到目前為止的每一份報告 */
  readonly work: GameState
  /** 提交一份報告，連同掛鉤接著提交的。回傳這一份與接著的 */
  commit(draft: ReportDraft): Report[]
}

/**
 * 把好幾份報告當成一件事提交：fn 裡的每一次 tx.commit 都套在同一份複製的狀態上，fn 正常結束才換進正式的狀態。
 * 中途丟錯：正式的狀態完全不變。回合流程（commitTurn）、讀檔修復都用它。
 */
export function commitAtomic<T>(k: StateKernel, state: GameState, fn: (tx: CommitTx) => T): T {
  const work = clone(state)
  // 探針的事件先收著：整串成功才送出去（沒有換進去的報告不該出現在觀察的紀錄裡）
  const events: Array<() => void> = []
  const result = fn({ work, commit: (draft) => commitInto(k, work, draft, 0, events) })
  replaceInPlace(state, work)
  for (const emit of events) emit()
  return result
}

/** 嚴格模式：跑一段掛鉤，前後的狀態要一模一樣（掛鉤是唯讀的觀察者）。 */
export function guardHooks<T>(k: StateKernel, state: GameState, names: string, run: () => T): T {
  const guard = k.strict ? clone(state) : null
  const out = run()
  if (guard && !deepEqual(guard, state)) throw new Error(`${names} 的掛鉤直接改了狀態：${diffPaths(guard, state).join('、')}`)
  return out
}

/** 在 work 上提交一份報告與掛鉤接著提交的。失敗時 work 可能套了一半：呼叫的人丟掉 work。 */
function commitInto(k: StateKernel, work: GameState, draft: ReportDraft, depth: number, events: Array<() => void>): Report[] {
  if (depth > MAX_FOLLOW_UP_DEPTH) throw new Error(`掛鉤接著提交的報告超過 ${MAX_FOLLOW_UP_DEPTH} 層，可能是兩個功能互相觸發`)
  const d: ReportDraft = clone(draft)
  guardHooks(k, work, 'report.before', () => {
    for (const { result } of k.hooks.run('report.before', { state: work, draft: d })) d.changes.push(...result)
  })
  // 所有角色都是成年人：報告裡任何深度有低於 18 的年齡，整份不收（和讀檔同一條底線，所以提交得進去的一定讀得回來）
  const young = underageAt(d)
  if (young.length) throw new ChangeError([`所有角色都是成年人：報告裡有低於 18 的年齡（${young.slice(0, 3).join('、')}）`])

  const start = clone(work.time)
  const id = `r${work.seq.report + 1}`
  if (k.probe.active) {
    const before = clone(work)
    events.push(() => k.probe.emit('core/state/commit', 'report.before', { id, draft: d, state: before }))
  }
  // 先算出結束的時間：套一次才知道
  const trial = clone(work)
  k.changes.applyAll(trial, d.changes)
  const report: Report = { ...d, id, time: d.time ?? { start, end: clone(trial.time) } }
  applyReport(k, work, report)
  if (k.probe.active) {
    const after = clone(work)
    events.push(() => k.probe.emit('core/state/commit', 'report.after', { id, report, state: after }))
  }

  const out: Report[] = [report]
  const followUps: ReportDraft[] = []
  guardHooks(k, work, 'report.after／time.passed', () => {
    for (const { result } of k.hooks.run('report.after', { state: work, report })) followUps.push(...result)
    if (toMinutes(report.time.end) > toMinutes(start)) {
      for (const { result } of k.hooks.run('time.passed', { state: work, from: start, to: report.time.end })) followUps.push(...result)
    }
  })
  for (const f of followUps) out.push(...commitInto(k, work, f, depth + 1, events))
  return out
}
