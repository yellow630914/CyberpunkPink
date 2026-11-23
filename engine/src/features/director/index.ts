// L6 功能：事件導演（EVENTS 第 1～3 節、第 6、7 節；dev/adr/0016 第四、六節；dev/work/M2-director.md）。
//
// 唯一的導演：讀每一回合報告上的觸發點（report.triggers），照範圍的機率、冷卻、篩選、權重挑事件，照每回合的上限放行或延後。
// 發觸發點的功能只在自己的報告上寫 triggers，不知道導演存在；導演也不認得任何一個發觸發點的功能。新增一種範圍只要加一筆資料。
// 事件視窗裡的選項與檢定不在這個功能裡，在同一個資料夾的另一個功能 eventRunFeature（run.ts、body.ts；M2-event-run）：
// 擋住型的事件放行 ＝ 開一段 event 活動（k.activity.start），沒有人登記時改成排隊。兩個功能各自安裝（FEATURES 裡 eventRunFeature 排在這個後面）；
// 沒裝 eventRunFeature 的一局（導演的測試用替身活動）不受影響。開著的事件存在 state.ext.director.open，導演改寫自己的狀態時原樣帶著（flow.ts 的 takeOpen）。
//
// 接上核心的地方：
//   內容  event_scope（每個範圍一筆）、event_rule（id: default，每回合的上限、城裡每天的上限、類型平衡）、event（表頭；內文檢查用 addEventBodyCheck 再掛）
//         載入之後 ready 跑 directorProblems：scope 查不到、觸發點不在範圍的表裡、通知的效果格式不對，整批擋下並寫出是哪一件
//   掛鉤  turn.end：這一回合的觸發點；time.passed（順序 20）：每天 08:00 的 daily、週一 06:00 的 weekly（一次跨好幾天，各最多補 3 次）
//   狀態  state.ext.director：每個範圍的冷卻與今天的件數、每件事上次的日子、最近的類型、延後的事件、排隊的通知（形狀見 model.ts）
// 報告：event.notice（不擋的事件，效果當場結算）；director.queue（只有排隊的更新，沒有別的事發生時）。
//
// 還沒做的（EVENTS 第 3 節）：存檔規則的範圍倍率與成人比重、曝露度的修正（街頭機率 ×1.5）、鉤子與 AI 提出的事件、
// 契約的佇列與家園的帳單機率（只收範圍的格式）、同一處的不重複天數。

import type { Feature, Kernel } from '../../core'
import { ContentError, dailyCrossings, toMinutes, weeklyCrossings } from '../../core'
import type { Pass } from './flow'
import { runPasses } from './flow'
import type { EventEntry } from './model'
import { EVENT_KIND, MAX_CATCH_UP, OWNER, RULE_KIND, SCOPE_KIND, directorProblems, eventProblems, noticeBodyProblems, ruleProblems, runBodyChecks, scopeProblems } from './model'

export { EVENT_ACTIVITY, EVENT_RUN_OWNER, FREE_OPTION, chooseOption, eventActivity, eventRunFeature, eventView, openEventOf } from './run'
export type { EventView, OpenEvent, OptionView } from './run'
export { DC_MAX, DC_MIN, MAX_CAST, MAX_OPTIONS, eventBodyProblems, normalCheck, outcomeList, resolveBody, substitute } from './body'
export type { CheckSpec, EventBodyFields, OptionDef, ResolvedBody, ResolvedStage, StageDef } from './body'
export { runPasses } from './flow'
export type { Pass, RunOpts } from './flow'
export {
  CATEGORIES, DEFAULT_DEFER_HOURS, DEFAULT_EVENT_RULES, EVENT_KIND, MAX_CATCH_UP, RULE_KIND, SCOPE_KIND,
  addEventBodyCheck, categoryFactor, directorOf, directorProblems, directorView, emptyDirector, eligibleEvents, eventRules, eventWeight, matchesWhen, matchesWhere, scopeOf, scopesOf,
} from './model'
export type { DirectorState, DirectorView, EligibleOpts, EventBodyCheck, EventCategory, EventEntry, EventRules, Queued, Scope, ScopeEntry, ScopeState } from './model'

export const directorFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: SCOPE_KIND, owner: OWNER, validate: scopeProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })
    k.content.defineKind({
      kind: EVENT_KIND, owner: OWNER,
      validate: (e) => {
        const p = eventProblems(k, e)
        // 表頭有錯時內文的檢查沒有意義（欄位型別不對）
        return p.length > 0 ? p : [...noticeBodyProblems(e), ...runBodyChecks(k, e as unknown as EventEntry, 'load')]
      },
    })

    // 一個行動的回合結束：這一回合碰到的觸發點。報告帶 rewind 時狀態馬上換成快照那一刻，導演做什麼都不會留下，所以不走
    k.hooks.on('turn.end', OWNER, ({ state, report }) => {
      if (report.rewind) return
      const drafts = runPasses(k, state, [{ triggers: report.triggers ?? [], at: state.time }], { turnKey: report.id, launchPending: (report.launch?.length ?? 0) > 0 })
      return drafts.length > 0 ? drafts : undefined
    })

    // 時間往前走了：跨過的每天 08:00（daily）、週一 06:00（weekly）當成觸發點，走同一條流程（順序在帳單 10、敵對值消退 12、名冊 14、NPC 16 之後）
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const days = dailyCrossings(from, to).slice(-MAX_CATCH_UP).map((at): Pass & { order: number } => ({ triggers: [{ point: 'daily' }], at, order: toMinutes(at) }))
      const weeks = weeklyCrossings(from, to, k.timeRules).slice(-MAX_CATCH_UP).map((at): Pass & { order: number } => ({ triggers: [{ point: 'weekly' }], at, order: toMinutes(at) }))
      const passes = [...days, ...weeks].sort((a, b) => a.order - b.order)
      if (passes.length === 0) return
      const drafts = runPasses(k, state, passes, { turnKey: last.id, launchPending: (last.launch?.length ?? 0) > 0 })
      return drafts.length > 0 ? drafts : undefined
    }, 20)
  },

  ready(k: Kernel) {
    const problems = directorProblems(k)
    if (problems.length > 0) throw new ContentError(problems)
  },
}
