// 測試基礎建設：用探針檢查不變式（dev/invariants.md）。四種測試都可以掛上它。

import type { GameState, Report } from '../core/types'
import type { ProbeEvent } from '../core/state/probe'
import { expectedAfterCommit } from '../core/state/commit'
import type { StateKernel } from '../core/state/kernel'
import { deepEqual, diffPaths } from '../core/util/clone'
import { MAX_CONCURRENT_REQUESTS } from '../shell/ai/provider'
import type { Game } from '../shell/game'

/**
 * 不變式第 2 條：每一份報告的 changes 套用之後等於狀態的實際變化。
 * 從探針的事件裡成對取出 report.before（套用前的狀態）與 report.after（報告與套用後的狀態），重算一次比對。
 */
export function commitViolations(k: StateKernel, events: ProbeEvent[]): string[] {
  const out: string[] = []
  const before = new Map<string, GameState>()
  for (const e of events) {
    if (e.source !== 'core/state/commit') continue
    const d = e.data as { id: string; state: GameState; report?: Report }
    if (e.type === 'report.before') before.set(d.id, d.state)
    if (e.type === 'report.after') {
      const b = before.get(d.id)
      if (!b) { out.push(`${d.id}：沒有對應的 report.before`); continue }
      const expected = expectedAfterCommit(k, b, d.report!)
      if (!deepEqual(expected, d.state)) out.push(`${d.id}：changes 套用之後和實際的狀態不一樣（${diffPaths(expected, d.state).join('、')}）`)
    }
  }
  return out
}

/** 跑一段動作並檢查：提交的不變式、同時跑的請求數。回傳動作的結果、探針的事件與違規的清單。 */
export async function observed<T>(game: Game, fn: () => T | Promise<T>): Promise<{ result: T; events: ProbeEvent[]; violations: string[] }> {
  game.k.probe.start()
  let result: T
  let events: ProbeEvent[] = []
  try {
    result = await fn()
  } finally {
    events = game.k.probe.stop()
  }
  const violations = commitViolations(game.k, events)
  if (game.limiter.peak > MAX_CONCURRENT_REQUESTS) violations.push(`同時跑的 AI 請求有 ${game.limiter.peak} 個，超過 ${MAX_CONCURRENT_REQUESTS} 個`)
  return { result, events, violations }
}

/** 探針事件的摘要（探針腳本輸出用）：一行一個事件。 */
export function summarize(events: ProbeEvent[]): string[] {
  return events.map((e) => {
    const d = e.data as Record<string, unknown> | null
    const tag = d && typeof d === 'object' ? (d.step ?? d.hook ?? d.id ?? d.task ?? '') : ''
    const extra = d && typeof d === 'object' && 'status' in d ? ` ${String(d.status)}` : ''
    return `${String(e.seq).padStart(3, '0')} ${e.source} ${e.type}${tag ? ` ${String(tag)}` : ''}${extra}`
  })
}
