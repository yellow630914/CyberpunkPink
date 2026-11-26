// L6 功能 sink 的「長時間帶著餘韻」（DOWNTIME 3.2 節：身上有餘韻每滿 6 小時，沉溺 +1；CORE_RULES 4.3 節「上升的原因」）。
// 平常餘韻每十分鐘消一層（features/character），所以只有「有東西讓餘韻消不掉」（渴求調校、發情蠕蟲）時才會真的帶很久。
//
// 記在 actor.ext.sink：carry_from（餘韻從哪一分鐘起一直帶著）與 carry_paid（這一段已經算過幾次沉溺）。
//   report.before  主角的餘韻從 0 變成有（或身上本來有而沒有起點）：起點是這份報告結束的那一刻；餘韻往下消（消完或消了一部分）：消完就清掉，
//                  沒消完就重新起算（「中間餘韻消過的重新算」）。
//   time.passed    主角身上有餘韻、有起點：算「起點到這一次時間經過的起點」之間滿了幾個 6 小時，減掉已經算過的，沉溺加上去。
//                  為什麼只算到這一次的起點、不算這一次經過的時間：time.passed 跑的時候餘韻的自然消退（character）還沒有套上去，
//                  這一次經過的時間裡餘韻是不是真的沒有消，要到下一次才看得出來；先算進去的話，每一次長時間的行動（打工、等待）都會誤加。
//                  只差一次時間經過，所以「過 13 小時」是在那之後的下一次時間經過時補上 +2。
// 往上加沉溺走 sinkUpChanges（有人註冊 sink 效果就走它：帶著 sink_resist 的人每一次 +2 變 +1；M4 收尾修正批 應修 5）；句子不帶機制數字。

import type { Change, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { clone, sinkUpChanges, toMinutes } from '../../core'
import { EXT_OP, nowOf, readExt, sinkRules } from './model'

export const CARRY_ACTION = 'sink.carry'

const spanOf = (changes: readonly Change[]): number => changes.reduce((n, c) => n + (c.op === 'time' && typeof c.minutes === 'number' && Number.isFinite(c.minutes) ? c.minutes : 0), 0)

/** report.before：維護起點。 */
export function carryBefore(state: GameState, draft: ReportDraft): Change[] | undefined {
  const pc = state.pc
  const a = pc ? state.actors[pc] : undefined
  if (!pc || !a) return undefined
  let delta = 0
  for (const c of draft.changes) if (c.op === 'actor.track' && c.track === 'afterglow' && c.id === pc && typeof c.delta === 'number') delta += c.delta
  if (delta === 0) return undefined
  const after = a.afterglow + delta
  const ext = readExt(state, pc)
  if (after <= 0) return ext.carry_from !== undefined || ext.carry_paid !== undefined ? [{ op: EXT_OP, id: pc, patch: { carry_from: null, carry_paid: null } } as Change] : undefined
  const end = nowOf(state) + spanOf(draft.changes)
  const started = a.afterglow <= 0 || ext.carry_from === undefined
  if (delta > 0 && !started) return undefined
  return [{ op: EXT_OP, id: pc, patch: { carry_from: end, carry_paid: 0 } } as Change]
}

/** time.passed：滿了幾個 6 小時就加幾點沉溺。沒有事回 []。 */
export function carryDrafts(k: Kernel, state: GameState, from: GameTime): ReportDraft[] {
  const pc = state.pc
  const a = pc ? state.actors[pc] : undefined
  if (!pc || !a) return []
  const ext = readExt(state, pc)
  const start = toMinutes(from)
  if (a.afterglow <= 0) {
    // 餘韻已經沒有了（沒有經過報告的路徑，例如直接改的狀態）：記號清掉
    return ext.carry_from !== undefined || ext.carry_paid !== undefined ? [draftOf(state, pc, [{ op: EXT_OP, id: pc, patch: { carry_from: null, carry_paid: null } } as Change], 'timer', '')] : []
  }
  // 沒有起點的（開局就帶著餘韻）：從這一次時間經過的起點算，記下來
  if (ext.carry_from === undefined) return [draftOf(state, pc, [{ op: EXT_OP, id: pc, patch: { carry_from: start, carry_paid: 0 } } as Change], 'timer', '')]
  const rule = sinkRules(k).afterglow_carry
  if (rule.amount <= 0) return []
  const total = Math.max(0, Math.floor((start - ext.carry_from) / (rule.hours * 60)))
  const due = total - (ext.carry_paid ?? 0)
  if (due <= 0) return []
  const text = '餘韻一直沒有退下去，沉溺悄悄往下陷了一點。'
  return [draftOf(state, pc, [
    ...sinkUpChanges(k, state, pc, rule.amount, due),
    { op: EXT_OP, id: pc, patch: { carry_paid: total } } as Change,
  ], 'carried', text)]
}

function draftOf(state: GameState, pc: string, changes: Change[], result: string, text: string): ReportDraft {
  const beats = text ? [{ layer: 'meat' as const, actor: pc, text, tag: CARRY_ACTION }] : []
  return {
    kind: 'system', action: CARRY_ACTION, location: clone(state.location), actor: pc, party: [], timeline: beats, changes,
    outcome: { result, summary: text || '記號整理了一下。' }, ...(text ? { narration: { results: [text] } } : {}),
  }
}
