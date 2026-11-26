// 委託副本決定性的一步沒贏（平手或敗）的三選一（COMBAT_SYSTEM 8.4 的三個選項；dev/adr/0020 V37）：戰役留在狀態裡（pending: 'lost'），不交回，
// 出牌、佔領、走路都被擋；做得了的只有這三個——
//   重來這一場（opinion.retry）：回到種類 opinion 的快照（開戰前；帶進牌庫的料扣掉的次數跟著回去）。報告帶 rewind（fresh：回去之後骰子換一批）；
//                                  回去之後這一段還沒開，由介面照快照 data 帶的 setup 與 origin 再開一次（報告不能同時帶 launch 與 rewind）。
//   回到這個階段開始（opinion.back）：回到種類 stage 的快照（副本在選面之前存的）；副本沒有存的話就等於重來這一場。委託沒有失敗，可以換一面、換一條分支。
//   接受結果（opinion.accept）：這時才發 activity.end（outcome lost；result.board 是棋盤上的結果），副本照「戰敗被接受而且算失敗」處理。
// 收買被接受與被找上門帶走不給三選一，直接交回 lost。

import type { GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone } from '../../core'
import { OPINION_SNAPSHOT } from './faceopen'
import { ACCEPT_ACTION, BACK_ACTION, RETRY_ACTION, readWar } from './model'
import { Run } from './run'
import { closeDraft } from './turn'

const hasSnapshot = (state: GameState, kind: string): boolean => state.snapshots.some((s) => s.kind === kind)

function lostBlock(state: GameState): string | null {
  const w = readWar(state)
  if (!w) return '現在沒有輿論戰。'
  if (w.pending !== 'lost') return '這一場還沒有分出沒贏，不用選。'
  return null
}

export function retryBlock(k: Kernel, state: GameState): string | null {
  const b = lostBlock(state)
  if (b) return b
  if (!hasSnapshot(state, OPINION_SNAPSHOT)) return '這一場開戰前沒有留快照，不能重來。'
  return k.activity.blockOf(state, `commit:${RETRY_ACTION}`)
}

export function backBlock(k: Kernel, state: GameState): string | null {
  const b = lostBlock(state)
  if (b) return b
  if (!hasSnapshot(state, 'stage') && !hasSnapshot(state, OPINION_SNAPSHOT)) return '這個階段開始時沒有留快照，不能回去。'
  return k.activity.blockOf(state, `commit:${BACK_ACTION}`)
}

export function acceptBlock(k: Kernel, state: GameState): string | null {
  const b = lostBlock(state)
  if (b) return b
  return k.activity.blockOf(state, `commit:${ACCEPT_ACTION}`)
}

/** 三個選項現在各自能不能選（原因是 null 就是可以）：給畫面。沒有在等三選一時三個都是原因。 */
export function lostChoices(k: Kernel, state: GameState): { retry: string | null; back: string | null; accept: string | null } {
  return { retry: retryBlock(k, state), back: backBlock(k, state), accept: acceptBlock(k, state) }
}

function rewindDraft(state: GameState, action: string, kind: string, summary: string, text: string, fresh: boolean): ReportDraft {
  return {
    kind: 'broadcast', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', text, tag: action, data: { kind } }], changes: [],
    outcome: { result: 'rewound', summary: text }, rewind: { kind, summary, ...(fresh ? { fresh: true } : {}) },
    narration: { results: [text] },
  }
}

/** 重來這一場：回到開戰之前，骰子不保證和剛才一樣（0017 的 fresh）。 */
export function retryWar(k: Kernel, state: GameState): ReportDraft {
  const block = retryBlock(k, state)
  if (block) throw new ActionBlocked(block)
  return rewindDraft(state, RETRY_ACTION, OPINION_SNAPSHOT, '你回到這一場輿論戰開打之前。剛才那一場像一段太真的預演。', '你決定把這一場重打一次。', true)
}

/** 回到這個階段開始：委託沒有失敗，可以換一面、換一條分支再走；副本沒有存階段的快照就等於重來這一場。 */
export function backToStage(k: Kernel, state: GameState): ReportDraft {
  const block = backBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const stage = hasSnapshot(state, 'stage')
  return rewindDraft(state, BACK_ACTION, stage ? 'stage' : OPINION_SNAPSHOT, '你回到這個階段開始的時候。', '你決定退回這個階段的開頭，換個辦法。', !stage)
}

/** 接受結果：這時才交回，outcome 是 lost（棋盤上是平手或敗，記在 result.board）；副本照戰敗被接受處理。 */
export function acceptLoss(k: Kernel, state: GameState): ReportDraft {
  const block = acceptBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), 'accept')
  run.note('你接受了這個結果。', { tag: 'opinion.accept', plain: '你接受了這個結果。' })
  return closeDraft(run, ACCEPT_ACTION, { outcome: 'lost' })
}
