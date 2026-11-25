// L6 功能 medical 的重創手術（戰鬥外；DOWNTIME 3.1 節；COMBAT_SYSTEM 第 6 節；dev/adr/0019 P46；dev/work/M4-medical.md 第 5 點）。
//
// 戰鬥結束時 combat 給的重的重創（wound_limb、wound_head、wound_torso）要在診所或自己動刀處理：
//   診所（via: 'clinic'）：腳下的設施有 clinic，收 wound_price（三種診所一樣，P46）；
//   自己或隊友動刀（via: 'self'）：不收錢、花一個時段（self_minutes）、要在住處或診所、動刀的人要通過 self_requires（預設條件 ability 的 daily: 'surgery'；沒有人註冊就不列）。
// 做了：把那一種狀況拿掉、掛 wound_recovering（wound_recovery_minutes，預設三天；期間 recovery_effects 的檢定 −2）。頭的重創手術之後，cyberware 讀狀況失效的眼或腦的義體就恢復了。
// 這一張沒有併發症（併發症是裝在義體上的小缺陷，這裡沒有義體）；「肢體接回還是直接換義肢」的選擇（TRADE 3.4 節）沒有做。

import type { ActorId, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, formatAmount, formatDuration } from '../../core'
import { atHomeOrClinic, clinicHere, moneyProblem, outOfBattleBlock, payPool, reportOf, selfConditionProblem, selfListed } from './common'
import type { Pool, WoundPart } from './model'
import { CLINIC_NAME, WOUND_NAME, WOUND_RECOVERING, hasCond, isWoundPart, medicalRules, nameOf, nowOf, woundCondition } from './model'

export const SURGERY_ACTION = 'medical.surgery'

export type WoundVia = 'clinic' | 'self'
export const isWoundVia = (v: unknown): v is WoundVia => v === 'clinic' || v === 'self'

export interface WoundSurgeryOpts {
  /** 被動刀的人 */
  target: ActorId
  /** 哪一種重創 */
  part: WoundPart
  via: WoundVia
  /** 動刀的人（只有 self 看它；預設是被動刀的人自己） */
  by?: ActorId
  /** 手術費從哪裡付（只有 clinic 收錢）；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

export interface WoundSurgeryQuote {
  target: ActorId
  part: WoundPart
  via: WoundVia
  /** 手術費（自己動刀是 0） */
  fee: number
  pay: Pool | null
  /** 手術花的時間（分鐘） */
  minutes: number
  /** 手術之後休養多久（分鐘） */
  recovery_minutes: number
}

interface Plan {
  problems: string[]
  quote: WoundSurgeryQuote | null
}

function planSurgery(k: Kernel, state: GameState, o: WoundSurgeryOpts): Plan {
  if (!state.actors[o.target]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isWoundPart(o.part)) return { problems: ['要說是哪一種重創（肢體、頭、軀幹）。'], quote: null }
  if (!isWoundVia(o.via)) return { problems: ['要說是在診所還是自己動刀。'], quote: null }
  const rules = medicalRules(k)
  const by = o.by ?? o.target
  const problems: string[] = []
  const out = outOfBattleBlock(k, state, SURGERY_ACTION)
  if (out) problems.push(out)
  const t = state.actors[o.target]!
  if (!state.party.includes(o.target)) problems.push('要動刀的人不在隊上。')
  if (!hasCond(state, o.target, woundCondition(o.part))) problems.push(`${t.name}的${WOUND_NAME[o.part]}沒有要動手術的重創。`)

  let fee = 0
  let minutes = rules.surgery_minutes
  if (o.via === 'clinic') {
    if (!clinicHere(k, state)) problems.push('這裡沒有診所。')
    fee = rules.wound_price
    const mp = moneyProblem(state, fee, o.pay, '手術費')
    if (mp) problems.push(mp)
  } else {
    minutes = rules.self_minutes
    if (!selfListed(k, rules)) problems.push('現在還不能自己動刀。')
    else if (!state.actors[by]) problems.push('找不到動刀的人。')
    else if (by !== o.target && !state.party.includes(by)) problems.push('動刀的人不在隊上。')
    else {
      const need = selfConditionProblem(k, state, by, rules)
      if (need) problems.push(need)
      else if (!atHomeOrClinic(k, state)) problems.push('自己動刀要在住處或診所。')
    }
  }
  const quote: WoundSurgeryQuote = {
    target: o.target, part: o.part, via: o.via, fee, pay: fee > 0 ? payPool(state.money, fee, o.pay) : null, minutes, recovery_minutes: rules.wound_recovery_minutes,
  }
  return { problems, quote }
}

/** 重創手術現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const woundSurgeryProblems = (k: Kernel, state: GameState, o: WoundSurgeryOpts): string[] => planSurgery(k, state, o).problems
/** 重創手術現在行不行：第一條原因；行是 null。 */
export const woundSurgeryBlock = (k: Kernel, state: GameState, o: WoundSurgeryOpts): string | null => planSurgery(k, state, o).problems[0] ?? null
/** 這一次手術的報價；人不存在或沒說清楚是 null。 */
export const woundSurgeryQuote = (k: Kernel, state: GameState, o: WoundSurgeryOpts): WoundSurgeryQuote | null => planSurgery(k, state, o).quote

/**
 * 動重創的手術。不成立丟 ActionBlocked。
 * 寫進狀態：扣手術費（診所）、時間加 minutes、把 wound_<部位> 拿掉、掛 wound_recovering（until 是手術做完之後 wound_recovery_minutes；原本還在休養的取比較晚的）。報告 medical.surgery。
 */
export function woundSurgeryDraft(k: Kernel, state: GameState, o: WoundSurgeryOpts): ReportDraft {
  const plan = planSurgery(k, state, o)
  if (plan.problems.length > 0 || !plan.quote) throw new ActionBlocked(plan.problems[0] ?? '現在動不了手術。')
  const q = plan.quote
  const by = o.by ?? o.target
  const patient = state.actors[o.target]!
  const here = clinicHere(k, state)
  const ready = nowOf(state) + q.minutes + q.recovery_minutes
  const old = patient.conditions.find((c) => c.id === WOUND_RECOVERING)?.until ?? 0
  const changes: Change[] = []
  if (q.fee > 0) changes.push({ op: q.pay!, delta: -q.fee })
  changes.push({ op: 'time', minutes: q.minutes }, { op: 'actor.condition', id: o.target, condition: woundCondition(o.part), remove: true })
  if (q.recovery_minutes > 0) changes.push({ op: 'actor.condition', id: o.target, condition: WOUND_RECOVERING, until: Math.max(ready, old) })
  const who = q.via === 'self' ? (by !== o.target ? `${nameOf(state, by)}替${patient.name}動刀` : `${patient.name}自己動刀`) : `${patient.name}在${here ? CLINIC_NAME[here.grade] : '診所'}動了手術`
  const lines = [`${who}，${WOUND_NAME[o.part]}的重創處理好了${q.fee > 0 ? `，手術費 ${formatAmount(q.fee)}` : ''}，花了 ${formatDuration(q.minutes)}。`]
  if (q.recovery_minutes > 0) lines.push(`接下來要養 ${formatDuration(q.recovery_minutes)}，這段時間相關的檢定會差一點。`)
  const data = { target: o.target, part: o.part, via: q.via, by, fee: q.fee, minutes: q.minutes, ready_at: q.recovery_minutes > 0 ? Math.max(ready, old) : null }
  return reportOf(state, SURGERY_ACTION, by, o.target, changes, lines, 'done', data)
}
