// L6 功能 work 的檢視（UI 3.12 節「打工」）：這個位置能做的工作、每一份現在第幾階段、下一階的條件與進度、預計的錢與成功率、現在不能做的原因。
// 純函式，不改狀態。

import type { Degree, GameState, GameTime, Kernel } from '../../core'
import { addMinutes, effectCtx, meterOf } from '../../core'
import type { NeedProgress } from './shift'
import { chancesOf, jobBlock, needProgress, payBasis, wageOf } from './shift'
import type { JobEntry, LastShift, ModeDef, Pool } from './model'
import { DEGREES, effectiveStage, facilityLabel, jobStateOf, jobsAt, openModes, stageHidden, workRules } from './model'

export interface StageView {
  /** 第幾階段（從 1 起算） */
  number: number
  name: string
  mult: number
  /** 這一階的時薪（工作的時薪 × 倍率；有 modes 的工作照第一種做法） */
  wage: number
  adult: boolean
  /** 每一班的附帶（這一階的 perks 現在結算出來的句子；結算不了是空的） */
  perks: string[]
  /** 現在在這一階 */
  current: boolean
  /** 已經到過（含現在） */
  reached: boolean
  /** 怎麼升上來（第一階段是 null）。進度照現在的班數與雇主親密度 */
  need: NeedProgress | null
}

export interface ShiftOptionView {
  hours: number
  minutes: number
  /** 成功時的錢（沒有檢定的工作就是這一筆） */
  expected: number
  /** 四種成功程度各領多少 */
  by_degree: Record<Degree, number>
  /** 時間從哪到哪 */
  from: GameTime
  to: GameTime
}

/** 一種做法（有 modes 的工作；現在沒被內容篩選關掉的才列）。 */
export interface ModeView {
  id: string
  name: string
  /** 這一種的時薪（客人付的；有 cut 時還沒扣店家的） */
  wage: number
  /** 這一種擲的檢定與成功率（不擲是 null） */
  check: { attr: string; skill?: string; dc: number; bonus: number; chances: Record<Degree, number> } | null
  /** 這一種的那一班自己不記得過程 */
  amnesia: boolean
  /** 這一種做了幾班 */
  shifts: number
  /** 一班 2、4、8 小時各自的預計（照現在的階段） */
  options: ShiftOptionView[]
}

export interface JobView {
  id: string
  name: string
  /** 設施的名字 */
  facility: string
  district?: string
  employer: { id: string; name: string; affinity: number } | null
  pay: Pool
  /** 檢定與成功率（不擲的工作是 null） */
  check: { attr: string; skill?: string; dc: number; bonus: number; chances: Record<Degree, number> } | null
  /** 這份工作總共做滿幾班 */
  shifts: number
  /** 現在第幾階段（從 1 起算；被內容篩選卡住的算前一階） */
  stage: number
  /** 沒有被內容篩選關掉的階段（關掉的不顯示） */
  stages: StageView[]
  /** 下一階（沒有或被關掉是 null） */
  next: StageView | null
  /** 這一階升階的事件問過了沒有 */
  asked: boolean
  /** 一班 2、4、8 小時各自的預計（照現在的階段）；有 modes 的工作是第一種做法的 */
  options: ShiftOptionView[]
  /** 可以選的做法（沒有 modes 的工作是空的）；上班前要選一種，shift 的 mode 就是它的 id */
  modes: ModeView[]
  /** 現在不能做的原因（給玩家看的完整句子）；能做是 null */
  block: string | null
  /** 上一班的結果 */
  last: LastShift | null
}

const npcName = (k: Pick<Kernel, 'content'>, id: string): string => k.content.get<{ id: string; name?: string }>('npc', id)?.name ?? id

function perkLines(k: Kernel, state: GameState, job: JobEntry, index: number): string[] {
  const perks = job.stages[index]?.perks ?? []
  if (perks.length === 0) return []
  const res = k.effects.resolve(perks, effectCtx(k, state, { source: 'builtin' }))
  return res.errors.length === 0 ? res.lines : []
}

function stageViews(k: Kernel, state: GameState, job: JobEntry, current: number, hourly: number): StageView[] {
  const js = jobStateOf(state, job.id)
  const out: StageView[] = []
  job.stages.forEach((s, i) => {
    if (stageHidden(state.rules, job, i)) return
    out.push({
      number: i + 1, name: s.name, mult: s.mult, wage: Math.round(hourly * s.mult * 100) / 100, adult: s.adult === true,
      perks: perkLines(k, state, job, i), current: i === current, reached: i <= current, need: needProgress(k, state, job, js, i),
    })
  })
  return out
}

const optionsOf = (k: Kernel, state: GameState, job: JobEntry, mode: ModeDef | undefined, at: number): ShiftOptionView[] => {
  const rules = workRules(k)
  const stage = job.stages[at]!
  const { pay } = payBasis(k, state, job, mode)
  return rules.hours.map((hours) => ({
    hours, minutes: hours * 60,
    expected: wageOf(rules, job, stage, hours, 'success', pay),
    by_degree: Object.fromEntries(DEGREES.map((d) => [d, wageOf(rules, job, stage, hours, d, pay)])) as Record<Degree, number>,
    from: state.time, to: addMinutes(state.time, hours * 60),
  }))
}

/** 一份工作現在的樣子（不管站在哪裡；block 照現在的位置與時間）。 */
export function jobView(k: Kernel, state: GameState, job: JobEntry): JobView {
  const js = jobStateOf(state, job.id)
  const at = effectiveStage(state.rules, job, js.stage)
  const open = openModes(state.rules, job)
  const first = open[0]?.[1]
  const { pay, plan } = payBasis(k, state, job, first)
  const chances = plan ? chancesOf(plan) : null
  const stages = stageViews(k, state, job, at, pay.wage ?? 0)
  const modes: ModeView[] = open.map(([id, m]) => {
    const p = payBasis(k, state, job, m)
    const c = p.plan ? chancesOf(p.plan) : null
    return {
      id, name: m.name, wage: p.pay.wage ?? 0,
      check: p.plan && c ? { attr: p.plan.attr, ...(p.plan.skill ? { skill: p.plan.skill } : {}), dc: p.plan.dc, bonus: p.plan.bonus, chances: c } : null,
      amnesia: m.amnesia === true, shifts: js.modes?.[id] ?? 0, options: optionsOf(k, state, job, m, at),
    }
  })
  return {
    id: job.id, name: job.name, facility: facilityLabel(k, job.facility), ...(job.district !== undefined ? { district: job.district } : {}),
    employer: job.employer ? { id: job.employer, name: npcName(k, job.employer), affinity: meterOf(k, state, 'affinity', job.employer) } : null,
    pay: job.pay,
    check: plan && chances ? { attr: plan.attr, ...(plan.skill ? { skill: plan.skill } : {}), dc: plan.dc, bonus: plan.bonus, chances } : null,
    shifts: js.shifts, stage: at + 1, stages, next: stages.find((s) => s.number === at + 2) ?? null, asked: js.asked,
    options: optionsOf(k, state, job, first, at), modes,
    block: jobBlock(k, state, job), last: js.last,
  }
}

/** 這個位置能做的工作（設施對上、在那一區）：每一份現在第幾階段、下一階的條件與進度、預計的錢與成功率、現在不能做的原因。 */
export function jobsHere(k: Kernel, state: GameState): JobView[] {
  return jobsAt(k, state).map((j) => jobView(k, state, j))
}
