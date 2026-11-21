// L5 行動核心：回合流程。ElondiaRPG 把「每回合結束要跑什麼」寫在狀態層（stores/game.ts 的 run、afterMove），
// 這裡移進引擎：一個行動的報告提交之後跑 turn.end 掛鉤，功能回傳接著要提交的報告（狀態到期、帳單、事件導演……）。

import type { GameState, Report, ReportDraft } from '../types'
import { commitReportAll } from '../state/commit'
import type { StateKernel } from '../state/kernel'

/** 提交一個行動的報告並跑回合結束的流程。回傳這一回合提交的所有報告（第一份是行動本身）。 */
export function commitTurn(k: StateKernel, state: GameState, draft: ReportDraft): Report[] {
  const reports = commitReportAll(k, state, draft)
  const followUps: ReportDraft[] = []
  for (const { result } of k.hooks.run('turn.end', { state, report: reports[0]! })) followUps.push(...result)
  for (const f of followUps) reports.push(...commitReportAll(k, state, f))
  return reports
}
