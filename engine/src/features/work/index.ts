// L6 功能：打工（DOWNTIME 第 4 節：4.1 的表只看欄位、4.1a 階段、4.2 結算；EVENTS 3.1 節 work、3.3 節打工那一列；AI_TASKS 3.13 節（程式的步驟）；
// LEWD_SYSTEM 第 9 節；UI 3.12 節；dev/adr/0016 第一、六節與 G15；dev/work/M2-work.md）。
//
// 一份工作在一個設施上，一班 2、4、6、8 小時，擲一次、照公式拿錢與附帶的東西；做久了、和雇主熟了可以升階段，雇主問一次（事件視窗）。
// 十九份工作的內容是資料，不在這裡；成人階段的事件與場景也是事件的資料，這裡只帶觸發點 work。
//
// 接上核心的地方：
//   內容  job（格式見 model.ts；載入之後 ready 查效果與條件的種類、設施與區在不在、基本功在不在）、work_rule（id: default，蓋掉內建的規則數字）
//   條件  job_stage { job, min?, max? }：那份工作現在在第幾階段（從 1 起算；被內容篩選卡住的算前一階；沒做過是第 1 階）
//   掛點  activity.end（升階的事件做完，選了升就換階段；只認 origin.by 是自己的）、report.after（剛升階就寫一份 work.promote）
//   格子  usesOf：人站在對的設施上列「打工」（灰掉的帶原因）
//   狀態  state.ext.work：{ jobs: { [工作 id]: { shifts, minutes, stage, asked, last, modes } }, announce }（形狀見 model.ts；只經由報告裡的 ext 變更寫；升階看 minutes 累計時數，不看班數）
// 讀的：meterOf 的 affinity（雇主的親密度；沒有人定義時是 0）、k.effects（附帶效果與大失敗的親密度）、k.conditions（extra）、k.activity（有活動進行時擋；有人登記 event 才問升階）、
//       k.content（block、facility_type、npc）、state.rules.contentOff（階段的 tags）。
// 報告：work.shift（kind downtime；帶觸發點 work，where 有 district、block、facility（設施的種類）、job、stage（從 1 起算））、work.promote（kind downtime）。
//
// 結算報告的形狀（M4-followups；契約人的收入歸屬、之後的派工靠它認，功能之間不 import，只認這個格式；有測試守著：M4-followups.test.ts「打工報告的形狀」）：
//   report.action        'work.shift'（SHIFT_ACTION）；kind 'downtime'；report.actor 是主角
//   錢的那一筆變更       changes 裡 { op: 'cred' | 'cash', delta: 領到的錢 }，op 就是工作寫的那一種錢（job.pay），delta 是正的整數；領 0 元（大失敗等）沒有這一筆
//   其餘                 changes 裡 { op: 'time', minutes } 一筆（一班的時間）、{ op: 'ext', key: 'work', ... } 一筆（班數與累計分鐘）；
//                        report.timeline[0].data 是 { job, stage（從 1 起算）, hours, degree（沒有檢定是 null）, amount, pay, mode? }；report.outcome.result 是成功程度（沒有檢定是 'done'）
//   amnesia 的那一班     outcome.amnesia 是 true，結果只有兩句；錢的那一筆照舊
// 對外：shift、shiftBlock、jobsHere、jobView、promotionDue、needProgress、checkPlan、chancesOf、wageOf、readWork、jobStateOf、effectiveStage、workRules。
// M4-venues：工作多讀 modes（人偶館的戴晶片與清醒；shift 的入口多收 mode）、cut（店家的分帳與晶片租金）、wage_formula（公式型的時薪）；
//   amnesia 的那一班報告的 outcome 多 amnesia: true（共同記憶、性經歷之類聽 report.after 的功能要不要略過是它們的事）。對外多：modeCheck、hourlyWage、payBasis、openModes、hasModes。
//
// 不在這裡（DOWNTIME 第 4 節）：4.1b 自己的店面、4.3 派別人去打工（M5）、契約人的收入歸屬（M4）、區域狀態的修正（這一步是 1）、小費與玩家寫做法的主動行動（AI_TASKS 3.13 第 2、5、6 步）。

import type { Condition, ConditionCtx, ContentEntry, Feature, GridCtx, GridUse, Kernel } from '../../core'
import { ContentError, blankState } from '../../core'
import type { JobEntry } from './model'
import {
  BLOCK_KIND, FACILITY_TYPE_KIND, JOB_KIND, OWNER, RULE_KIND, effectiveStage, isText, jobProblems, jobStateOf, jobsAt, ruleProblems,
} from './model'
import { announceDraft, jobBlock, onPromoteEnd } from './shift'

export { DEFAULT_WORK_RULES, DEGREES, EXT as WORK_EXT, JOB_KIND, OWNER as WORK_OWNER, PROMOTE_ACTION, RULE_KIND as WORK_RULE_KIND, SHIFT_ACTION, WORK_POINT, blankJob, blankWork, effectiveStage, facilityHere, hasModes, jobAtFacility, jobEntry, jobStateOf, jobsAt, openModes, readWork, stageHidden, workRules } from './model'
export type { JobCheck, JobCut, JobEntry, JobState, LastShift, ModeDef, ModeEvery, Pool, StageDef, StageNeed, WageFormula, WorkRules, WorkState } from './model'
export { AMNESIA_RESIDUE, OPTION_PROMOTE, OPTION_STAY, chancesOf, checkPlan, hourlyWage, jobBlock, modeCheck, needProgress, payBasis, promoteEvent, promotionDue, shift, shiftBlock, wageOf } from './shift'
export type { CheckPlan, NeedProgress, PayOpts } from './shift'
export { jobView, jobsHere } from './view'
export type { JobView, ModeView, ShiftOptionView, StageView } from './view'

type StageCondition = Condition & { job: string; min?: number; max?: number }

const isStageNo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3

/** 站著的這一格列「打工」：這個位置有工作就列；全部都現在不能做時灰掉，原因寫第一份的。 */
function workUses(ctx: GridCtx, marker: { id: string }): GridUse[] {
  const k = ctx.k as Kernel
  if (ctx.state.location.facility !== marker.id) return []
  const jobs = jobsAt(k, ctx.state)
  if (jobs.length === 0) return []
  const blocks = jobs.map((j) => jobBlock(k, ctx.state, j))
  const open = blocks.some((b) => b === null)
  return [{ id: 'work.shift', name: '打工', block: open ? null : (blocks[0] ?? null) }]
}

export const workFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind<JobEntry>({
      kind: JOB_KIND, owner: OWNER, validate: jobProblems,
      refs: (e) => (typeof e.employer === 'string' ? [['npc', e.employer]] : []),
    })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    k.conditions.register<StageCondition>({
      kind: 'job_stage', owner: OWNER,
      validate: (raw) => [
        ...(isText(raw.job) ? [] : ['job 要是工作的 id']),
        ...(raw.min === undefined && raw.max === undefined ? ['要寫 min 或 max（第幾階段，1～3）'] : []),
        ...(['min', 'max'] as const).filter((f) => raw[f] !== undefined && !isStageNo(raw[f])).map((f) => `${f} 要是 1～3 的整數（第幾階段）`),
      ],
      test(c, { state }: ConditionCtx) {
        const job = k.content.get<JobEntry>(JOB_KIND, c.job)
        if (!job) return false
        const stage = effectiveStage(state.rules, job, jobStateOf(state, c.job).stage) + 1
        return stage >= (c.min ?? 1) && stage <= (c.max ?? 3)
      },
    })

    // 升階的事件做完：選了升就進下一階段
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, result }) => (kind === 'event' ? onPromoteEnd(k, state, origin, result) : undefined))
    // 剛升階：寫一份 work.promote
    k.hooks.on('report.after', OWNER, ({ state }) => {
      const draft = announceDraft(k, state)
      return draft ? [draft] : undefined
    })

    k.grid.usesOf(OWNER, workUses)
  },

  ready(k) {
    const problems: string[] = []
    const hasSkills = k.content.list('skill').length > 0
    // 效果的格式要有一個狀態可以驗（量表的鍵之類在內容裡查，不看狀態）
    const ctx = { state: blankState(0), actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as Parameters<Kernel['effects']['validate']>[1]
    for (const j of k.content.list<JobEntry>(JOB_KIND)) {
      const at = `${JOB_KIND}/${j.id}`
      if (j.perks) problems.push(...k.effects.validate(j.perks, ctx, 'perks').map((m) => `${at}：${m}`))
      if (j.facility.includes('/')) {
        const slash = j.facility.indexOf('/')
        const bid = j.facility.slice(0, slash)
        const marker = j.facility.slice(slash + 1)
        if (k.content.hasKind(BLOCK_KIND)) {
          const b = k.content.get<ContentEntry & { facilities?: Record<string, unknown> }>(BLOCK_KIND, bid)
          if (!b) problems.push(`${at}：facility ${j.facility} 的街區 ${bid} 找不到`)
          else if (!(b.facilities && Object.hasOwn(b.facilities, marker))) problems.push(`${at}：街區 ${bid} 沒有 ${marker} 這個設施`)
        }
      } else if (k.content.hasKind(FACILITY_TYPE_KIND) && !k.content.has(FACILITY_TYPE_KIND, j.facility)) {
        problems.push(`${at}：facility ${j.facility} 沒有這種設施（facility_type）；要指定某一間請寫「街區 id/標記 id」`)
      }
      if (j.district !== undefined && k.content.hasKind('district') && !k.content.has('district', j.district)) problems.push(`${at}：district ${j.district} 沒有這個區`)
      if (j.check?.skill && hasSkills && !k.content.has('skill', j.check.skill)) problems.push(`${at}：check.skill ${j.check.skill} 沒有這項基本功`)
      for (const [mid, m] of Object.entries(j.modes ?? {})) {
        const here = `${at}：modes.${mid}`
        if (m.perks) problems.push(...k.effects.validate(m.perks, ctx, 'perks').map((x) => `${here}.${x}`))
        m.every?.forEach((ev, n) => problems.push(...k.effects.validate(ev.effects, ctx, 'effects').map((x) => `${here}.every[${n}].${x}`)))
        if (m.check && hasSkills && m.check.skill && !k.content.has('skill', m.check.skill)) problems.push(`${here}.check.skill ${m.check.skill} 沒有這項基本功`)
      }
      j.stages.forEach((s, i) => {
        const here = `${at}：stages[${i}]`
        if (s.perks) problems.push(...k.effects.validate(s.perks, ctx, 'perks').map((m) => `${here}.${m}`))
        if (s.need?.extra !== undefined) {
          const list = Array.isArray(s.need.extra) ? s.need.extra : [s.need.extra]
          list.forEach((c, n) => problems.push(...k.conditions.validate(c, `need.extra[${n}]`).map((m) => `${here}.${m}`)))
        }
        if (s.need && s.need.affinity > 0 && j.employer === undefined) problems.push(`${here}：need.affinity 是 ${s.need.affinity}，可是這份工作沒有 employer（親密度永遠是 0，升不上去）`)
      })
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}

