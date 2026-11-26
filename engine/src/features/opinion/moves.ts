// 用一招（opinion.move；OPINION 4.3「技能」、第 7 節；dev/adr/0020 第五節）：坐著的人有哪些主動的招，由別的功能經掛點 opinion.moves 回答（每次問、不存起來）；
// 用一招花編輯點（一個人付，不能合付；V40）、有每場或每回合的次數、有條件（k.conditions，看用招的那個人）、效果是封閉清單 OP_EFFECTS（fx.ts）。
// 格式不對的那一筆（opinion.check 同一套檢查）在畫面上不列、用不了，原因寫在 skipped；不丟錯。

import type { GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked } from '../../core'
import { cellsOwnedBy } from './board'
import { warBlock } from './cards'
import type { FxInput } from './fx'
import { applyEffects, newFlags, seatOf } from './fx'
import type { OpMove } from './hooks'
import { askMoves } from './hooks'
import type { Cell, War } from './model'
import { CELL_NAME, MOVE_ACTION, isCell, readWar } from './model'
import { Run } from './run'

export interface MoveInput extends FxInput {
  id: string
}

const left = (w: War, m: OpMove): number | null => (m.limit ? Math.max(0, m.limit.n - (w.moves_used[`${m.limit.per}:${m.id}`] ?? 0)) : null)

/** 這一招的效果裡有沒有要玩家選格子的設防。 */
const needsCell = (m: OpMove): boolean => m.effects.some((e) => e.kind === 'guard' && e.cells === 'pick')

/** 這一招現在做得了嗎：回傳原因（一句完整的話），可以回 null。move 是已經問回來的那一筆。 */
function blockOf(k: Kernel, state: GameState, w: War, m: OpMove, input: FxInput): string | null {
  const seat = w.desk.find((s) => s.actor === m.actor)
  if (!seat) return `${m.name}要由坐在編輯台的人來用。`
  const l = left(w, m)
  if (l !== null && l <= 0) return `「${m.name}」${m.limit!.per === 'war' ? '這一場' : '這一回合'}的次數用完了。`
  if (m.need !== undefined) {
    const ctx = { state, actor: m.actor, stats: k.stats, timeRules: k.timeRules }
    if (!k.conditions.test(m.need as never, ctx)) return `${k.conditions.explain(m.need as never, ctx) ?? `「${m.name}」現在用不了（條件不成立）`}。`
  }
  if (seat.ep < m.cost) return `編輯點不夠：「${m.name}」要 ${m.cost} 點，${state.actors[m.actor]?.name ?? '他'}只有 ${seat.ep} 點（一招由一個人付）。`
  if (needsCell(m)) {
    if (input.cell === undefined) return '要選一格來設防。'
    if (!isCell(input.cell)) return `「${input.cell}」不是格子的 id。`
    if (!cellsOwnedBy(w, 'you').includes(input.cell)) return `「${CELL_NAME[input.cell]}」不是你的格子。`
  }
  return null
}

export function moveBlock(k: Kernel, state: GameState, input: MoveInput): string | null {
  const war = readWar(state)
  const b = warBlock(war)
  if (b) return b
  const w = war!
  const asked = askMoves(k, state, w, w.desk.map((s) => s.actor))
  const m = asked.items.find((x) => x.id === input.id)
  if (!m) return asked.skipped.length > 0 ? `沒有這一招，或它的資料有問題：${asked.skipped[0]}` : '現在沒有這一招。'
  return blockOf(k, state, w, m, input) ?? k.activity.blockOf(state, `commit:${MOVE_ACTION}`)
}

/** 用一招：花編輯點、記次數、做效果。回傳 opinion.move 的報告草稿。 */
export function moveDraft(k: Kernel, state: GameState, input: MoveInput): ReportDraft {
  const block = moveBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const run = new Run(k, state, readWar(state), `move/${input.id}`)
  const w = run.w
  const m = askMoves(k, state, w, w.desk.map((s) => s.actor)).items.find((x) => x.id === input.id)!
  const seat = seatOf(run, m.actor)
  seat.ep -= m.cost
  w.moves_used[`turn:${m.id}`] = (w.moves_used[`turn:${m.id}`] ?? 0) + 1
  w.moves_used[`war:${m.id}`] = (w.moves_used[`war:${m.id}`] ?? 0) + 1
  const lines: string[] = []
  applyEffects(run, m.effects, { src: m.name, actor: m.actor, seat, input }, newFlags(), lines)
  const who = state.actors[m.actor]?.name ?? m.actor
  run.note(`${who}用了「${m.name}」（花 ${m.cost} 點）：${lines.join('，')}。`, {
    tag: 'opinion.move', actor: m.actor, data: { move: m.id, owner: m.owner, actor: m.actor, cost: m.cost, effects: m.effects.map((e) => e.kind) }, plain: `${who}用了「${m.name}」。`,
  })
  const d = run.draft(MOVE_ACTION, 'moved', run.beats.map((b) => b.text).join(''))
  return d
}

export interface MoveView {
  id: string
  name: string
  owner: string
  actor: string
  cost: number
  can: boolean
  /** 現在不能用的原因（一句完整的話） */
  reason: string | null
  /** 次數限制：每場或每回合、還剩幾次 */
  limit: { per: 'turn' | 'war'; n: number; left: number } | null
  /** 要先選格子（設防）：可以選的格子 */
  pick: Cell[] | null
}

/** 現在有哪些招（照 opinion.moves 問回來的）：每一招能不能用與原因；格式不對略過的另外列。唯讀。 */
export function movesView(k: Kernel, state: GameState): { moves: MoveView[]; skipped: string[] } {
  const w = readWar(state)
  if (!w) return { moves: [], skipped: [] }
  const phase = warBlock(w)
  const asked = askMoves(k, state, w, w.desk.map((s) => s.actor))
  const moves = asked.items.map((m): MoveView => {
    const why = phase ?? blockOf(k, state, w, m, needsCell(m) ? { cell: cellsOwnedBy(w, 'you')[0] } : {})
    return {
      id: m.id, name: m.name, owner: m.owner, actor: m.actor, cost: m.cost, can: why === null, reason: why,
      limit: m.limit ? { per: m.limit.per, n: m.limit.n, left: left(w, m) ?? 0 } : null, pick: needsCell(m) ? cellsOwnedBy(w, 'you') : null,
    }
  })
  return { moves, skipped: asked.skipped }
}
