// L5 行動核心：回合流程。ElondiaRPG 把「每回合結束要跑什麼」寫在狀態層（stores/game.ts 的 run、afterMove），
// 這裡移進引擎：一個行動的報告提交之後跑 turn.end 掛鉤，功能回傳接著要提交的報告（狀態到期、帳單、事件導演……）。
//
// 整個回合是一件事：行動的報告、它帶出來的報告、回合結束的報告，全部成功才換進正式的狀態。
// 其中任何一份不合法，丟 ChangeError，狀態完全不變（行動那一份也不留）。

import type { GameState, Report, ReportDraft } from '../types'
import type { CommitTx } from '../state/commit'
import { commitAtomic, guardHooks } from '../state/commit'
import type { StateKernel } from '../state/kernel'

/**
 * 在一次提交（commitAtomic）裡面跑一個回合：提交行動的報告、跑 turn.end、提交它回傳的報告。
 * 要在同一件事裡接著做別的（外殼處理報告的 launch）就用這個；回傳這一回合提交的所有報告（第一份是行動本身）。
 */
export function commitTurnIn(k: StateKernel, tx: CommitTx, draft: ReportDraft): Report[] {
  const reports = tx.commit(draft)
  const followUps: ReportDraft[] = []
  guardHooks(k, tx.work, 'turn.end', () => {
    for (const { result } of k.hooks.run('turn.end', { state: tx.work, report: reports[0]!, reports: [...reports] })) followUps.push(...result)
  })
  for (const f of followUps) reports.push(...tx.commit(f))
  return reports
}

/** 提交一個行動的報告並跑回合結束的流程。回傳這一回合提交的所有報告（第一份是行動本身）。 */
export function commitTurn(k: StateKernel, state: GameState, draft: ReportDraft): Report[] {
  return commitAtomic(k, state, (tx) => commitTurnIn(k, tx, draft))
}
