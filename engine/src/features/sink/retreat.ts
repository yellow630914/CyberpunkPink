// L6 功能 sink 的斷線靜修：進行中的活動 retreat（DOWNTIME 3.3 節；使用者 2026-11-26：斷線靜修改成進行中的活動，期間關橋、禁止潛入，結束才結算）。
//
// 進傳教所（therapyDraft，kind retreat）只是開始：記下 actor.ext.sink.retreat（哪一間、什麼時候開始與結束、結束時最多降多少、進去時的沉溺），時間沒有動、沉溺沒有降、不收錢。
// 之後是活動 retreat（order 70）：橋是關著的，不能潛入、不能做別的事——放行的只有這個功能自己的報告（待下去 sink.retreat 的 stay、提早離開 leave）與意外的事（事件、戰鬥）。
//   待下去（retreatStayDraft）  過一天（最後一天只過剩下的）；時間到了就結算
//   提早離開（retreatLeaveDraft）  不結算：沉溺不降，已經過去的時間不退
//   結算（report.after，時間到了而且手上沒有別的活動）  沉溺走 sink 效果往下降（下限會擋）、拿掉進行中的記號；報告 sink.retreat 的 result 是 done
// 期間契約指令的期限暫停（任何活動都暫停；features/contract）。「黑泉記得你來過」是內容，引擎不管。

import type { ActorId, Change, GameState, Kernel, Report, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, effectCtx } from '../../core'
import type { RetreatRec } from './model'
import { EXT_OP, MINUTES_PER_DAY, RETREAT_ACTION, nameOf, nowOf, readExt } from './model'

/** 進行中的斷線靜修（主角的）；沒有是 null。 */
export function retreatOf(state: GameState): RetreatRec | null {
  const pc = state.pc
  return pc && state.actors[pc] ? clone(readExt(state, pc).retreat ?? null) : null
}

export interface RetreatView {
  facility: string
  /** 開始與結束的時間（總分鐘） */
  since: number
  until: number
  /** 還剩幾分鐘、幾天（進位） */
  minutes_left: number
  days_left: number
  /** 結束時沉溺最多降多少（下限會擋）、進去時的沉溺 */
  amount: number
  from: number
  /** 「待下去」一次過多久（分鐘；最後一次只過剩下的） */
  step: number
}

/** 給畫面的讀法：沒有在靜修是 null。 */
export function retreatView(state: GameState): RetreatView | null {
  const r = retreatOf(state)
  if (!r) return null
  const left = Math.max(0, r.until - nowOf(state))
  return { facility: r.facility, since: r.since, until: r.until, minutes_left: left, days_left: Math.ceil(left / MINUTES_PER_DAY), amount: r.amount, from: r.from, step: Math.min(MINUTES_PER_DAY, Math.max(0, left)) }
}

/** 進行中時被活動擋下的原因（給活動 retreat 的 reason 用）。 */
export const retreatReason = (state: GameState): string => {
  const v = retreatView(state)
  return v ? `你在${v.facility}斷線靜修，橋關著，還有 ${v.days_left} 天：不能潛入，也做不了別的事。待下去，或提早離開。` : '你在斷線靜修。'
}

const beat = (who: ActorId, text: string, data?: Record<string, unknown>): TimelineBeat => ({ layer: 'meat', actor: who, text, tag: RETREAT_ACTION, ...(data ? { data } : {}) })

function draftOf(state: GameState, who: ActorId, result: string, lines: string[], changes: Change[], data?: Record<string, unknown>): ReportDraft {
  return {
    kind: 'downtime', action: RETREAT_ACTION, location: clone(state.location), actor: who, party: [], timeline: lines.map((l, i) => beat(who, l, i === 0 ? data : undefined)), changes,
    outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}

// ---- 待下去 ----

/** 現在待不下去的原因（一句）；能是 null。 */
export function retreatStayBlock(k: Kernel, state: GameState): string | null {
  if (!retreatOf(state)) return '你現在不在斷線靜修。'
  if (state.battle) return '戰鬥中不能這樣處理。'
  return k.activity.blockOf(state, `commit:${RETREAT_ACTION}`)
}

/** 待下去：過一天（最後一天只過剩下的）；時間到了之後由結算接著發（report.after）。 */
export function retreatStayDraft(k: Kernel, state: GameState): ReportDraft {
  const why = retreatStayBlock(k, state)
  if (why) throw new ActionBlocked(why)
  const who = state.pc!
  const v = retreatView(state)!
  const minutes = Math.max(1, v.step)
  const done = nowOf(state) + minutes >= v.until
  const line = done ? `${nameOf(state, who)}在${v.facility}安安靜靜待到了最後一天。` : `${nameOf(state, who)}在${v.facility}又待了一天，橋還關著。`
  return draftOf(state, who, done ? 'last_day' : 'stay', [line], [{ op: 'time', minutes }], { facility: v.facility, minutes, days_left: Math.max(0, v.days_left - 1) })
}

// ---- 提早離開 ----

export function retreatLeaveBlock(k: Kernel, state: GameState): string | null {
  if (!retreatOf(state)) return '你現在不在斷線靜修。'
  if (state.battle) return '戰鬥中不能這樣處理。'
  return k.activity.blockOf(state, `commit:${RETREAT_ACTION}`)
}

/** 提早離開：不結算（沉溺不降），已經過去的時間不退；橋回來了。 */
export function retreatLeaveDraft(k: Kernel, state: GameState): ReportDraft {
  const why = retreatLeaveBlock(k, state)
  if (why) throw new ActionBlocked(why)
  const who = state.pc!
  const r = retreatOf(state)!
  return draftOf(state, who, 'left', [`${nameOf(state, who)}沒有靜完就離開了${r.facility}：橋回來了，腦子還是原來的樣子。`], [{ op: EXT_OP, id: who, retreat: null } as Change], { facility: r.facility, left_early: true })
}

// ---- 結算 ----

/**
 * 掛點 report.after：時間到了（now ≥ until）而且手上除了斷線靜修沒有別的活動（戰鬥、事件打完了才算）：結算。
 * 沉溺走 sink 效果往下降（下限會擋）；沒有人註冊 sink 效果時略過沉溺（記號照樣拿掉）。
 */
export function retreatSettle(k: Kernel, state: GameState, report: Report): ReportDraft[] | undefined {
  if (report.rewind || report.action === 'rewind') return undefined
  const r = retreatOf(state)
  if (!r || nowOf(state) < r.until || state.battle) return undefined
  if (k.activity.active(state).some((a) => a.kind !== 'retreat')) return undefined
  const who = state.pc!
  const changes: Change[] = []
  let dropped = 0
  if (k.effects.has('sink')) {
    const fx = [{ kind: 'sink', amount: -r.amount }]
    const ctx = effectCtx(k, state, { source: 'builtin', actor: who })
    if (k.effects.validate(fx, ctx).length === 0) {
      const res = k.effects.resolve(fx, ctx)
      if (res.errors.length === 0) {
        changes.push(...res.changes)
        dropped = -res.changes.reduce((n, c) => n + (c.op === 'actor.track' && c.track === 'sink' && typeof c.delta === 'number' ? c.delta : 0), 0)
      }
    }
  }
  changes.push({ op: EXT_OP, id: who, retreat: null } as Change)
  const lines = [`${nameOf(state, who)}在${r.facility}斷了線，安安靜靜待了好幾天，回來的時候腦子清楚了一些。`]
  if (dropped === 0) lines.push('不過身上的義體還是把你墊在原來的地方。')
  return [draftOf(state, who, 'done', lines, changes, { facility: r.facility, from: r.from, dropped, minutes: r.until - r.since })]
}
