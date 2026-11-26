// L6 功能：直播的容器（熱度、目標、亮點、收播結算）與活動直播——掛在進行中的戰鬥、成人場景或委託副本上，宿主結束就收播；直播不回退
// （MEDIA 1.2 節、第 3 節「副本裡的直播不回退」、第 6 節；DATA 9.2、第 11 節；COMMISSIONS 2.3 節；UI 6.3 節；dev/adr/0020 第三節、V21～V26；dev/work/M5-live.md）。
// 時段直播（M5-live-slot）與內場、迷宮館的直播（M5-live-houses）在後面的工單；這裡的容器已經留好 mode: 'slot' 與 house 欄位。
//
// 接上核心的地方：
//   內容  live_rule（規則表，overridable；id: default；DEFAULT_LIVE_RULES）、stream_template（直播模板，overridable；DEFAULT_TEMPLATES 三筆）、stream_goal（直播目標，內容）
//   衍生數值  live_goal_extra、live_record_quality：只定義、預設 0
//   條件  live_on { mode?, viewers_min? }（conditions.ts）
//   變更  live.open、live.add、live.close（ops.ts）；回到快照時用整份 ext 換
//   活動  live（order 40；session 存在就是進行中；deny: ['undo']；活動直播時全部放行，用 allowEverywhere 放行 commit:live.）
//   掛鉤  game.new（空的狀態）、report.before（亮點與敵對值 ×1.5；順序 100，排在別人的變更後面）、activity.end（宿主結束就收播）、rewind.keep（不回退）
//   掛點  用 media.record（字串名字問，沒裝 media 就沒有紀錄）；發 activity.end（種類 live，頻道聽）
//   狀態  state.ext.live：形狀見 model.ts
// 報告（kind broadcast）：live.go（開播）、live.cut（提早收播）。宿主結束時收播併在宿主結束的那一份裡。
// 對外：livePreview、goLive、cutLive、liveView、viewersOf。
//
// 不碰別的功能：不讀別的功能的 state.ext；宿主的資訊只從 k.activity.active、state.battle、報告的 action 與那一拍的 data 拿；不給戰鬥任何加成。

import type { Feature, Kernel } from '../../core'
import { defineStats, installConditions } from './conditions'
import { onReportBefore } from './events'
import { blankLive, EXT, GOAL_KIND, LIVE_PREFIX, OWNER, RULE_KIND, TEMPLATE_KIND, goalProblems, liveValue, readLive, ruleProblems, templateProblems } from './model'
import { installOps } from './ops'
import { onRewind } from './rewind'
import { onActivityEnd } from './settle'

export { goLive, hostOf, livePreview, riskLines } from './open'
export type { ConsentRow, GoInput, HostInfo, LivePreview } from './open'
export { cutBlock, cutLive, settleSession } from './settle'
export type { SettleOpts, Settlement } from './settle'
export { liveView } from './view'
export type { LiveGoalView, LiveSessionView, LiveView } from './view'
export { eventsOf, hostilityExtra } from './events'
export {
  CUT_ACTION as LIVE_CUT_ACTION, DEFAULT_LIVE_RULES, DEFAULT_TEMPLATES, EVENTS as LIVE_EVENTS, EVENT_NAME as LIVE_EVENT_NAME, EXT as LIVE_EXT, GOAL_EXTRA_STAT as LIVE_GOAL_EXTRA_STAT,
  GO_ACTION as LIVE_GO_ACTION, GOAL_KIND as LIVE_GOAL_KIND, OWNER as LIVE_OWNER, RECORD_QUALITY_STAT as LIVE_RECORD_QUALITY_STAT, RULE_KIND as LIVE_RULE_KIND, TEMPLATE_KIND as LIVE_TEMPLATE_KIND,
  VIEWER_TIER_NAME as LIVE_VIEWER_TIER_NAME, blankLive, liveRules, liveSession, readLive, subsOfHeat, templateFor, templatesOf, viewersFrom, viewersOf,
} from './model'
export type { GoalCheck, GoalEntry, GoalRow, Highlight, House, LiveEvent, LiveRules, LiveState, Mode as LiveMode, Scope as LiveScope, Session as LiveSession, Settled as LiveSettled, TemplateEntry, Viewers, ViewerTier } from './model'

export const liveFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: TEMPLATE_KIND, owner: OWNER, overridable: true, validate: templateProblems })
    // 直播目標是內容（不匯入）：id 重複照舊整批擋下
    k.content.defineKind({ kind: GOAL_KIND, owner: OWNER, validate: goalProblems })
    defineStats(k)
    installOps(k)
    installConditions(k)

    // 活動直播：疊在別的活動上，全部放行（宿主照常擋它自己要擋的）；開播與收播（commit:live.）在每一層活動裡都做得了：
    // 不列例外（戰鬥第一輪要開得了、任何一層裡都要收播得了；M4 的 B030 就是簾後館漏列了外面那一層 dive）。
    k.activity.allowEverywhere(LIVE_PREFIX, OWNER)
    k.activity.define({
      kind: 'live', owner: OWNER, order: 40,
      active: (state) => {
        const s = readLive(state).session
        return s ? { id: s.id, label: s.mode === 'activity' ? '活動直播' : '時段直播' } : null
      },
      allow: [],
      allows: (state) => readLive(state).session?.mode === 'activity',
      deny: ['undo'],
      // deny 擋下時第二個參數是外殼動作的名字（'undo'），不是 doing
      reason: (_state, doing) => (doing === 'undo' ? '直播進行中，不能回退。要先收播。' : '直播進行中，先把它收掉（提早收播，或把這一場打完）。'),
    })

    k.hooks.on('game.new', OWNER, () => [{ op: 'ext', key: EXT, value: liveValue(blankLive()) }])
    // 順序 100：排在別人加的變更後面，敵對值 ×1.5 才看得到同一份草稿裡每一筆
    k.hooks.on('report.before', OWNER, ({ state, draft }) => onReportBefore(k, state, draft), 100)
    k.hooks.on('activity.end', OWNER, (p) => onActivityEnd(k, p))
    k.hooks.on('rewind.keep', OWNER, ({ current, restored }) => onRewind(k, current, restored))
  },
}
