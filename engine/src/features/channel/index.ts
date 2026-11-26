// L6 功能：頻道——開頻道、三張長期的量表、預算與贊助、每週結算、flow_tier 的來源（M5-channel）；
// 節目、成人檔、開一集、評價與結算、編制、設備與每一集的觸發點（M5-channel-shows）
// （MEDIA 第 4 節、4.3、4.3a、4.4～4.6、4.8；EVENTS 2.4 節的 credibility、3.1 節的觸發點；dev/adr/0020 第二節、第十三節、V12～V20、V55；dev/work/M5-channel.md、M5-channel-shows.md）。
//
// 接上核心的地方：
//   內容  channel_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_CHANNEL_RULES）、show（節目，overridable；shows.ts 的 DEFAULT_SHOWS 六筆）
//   衍生數值  studio_slots（住處放得下每類幾件棚內設備；基礎：有住處 1、沒有 0）、episode_bonus（開一集的檢定加值；基礎 0，abilities 的技能加）、
//             stream_gear_bonus（直播讀：收音、鏡頭、串流各取裝著的最高一件相加，最多 +3；gear.ts）
//   掛點  channel.episode（宣告並問：這一集多的選項、檢定的加值、各評價多給的效果、多花的時段；idol、abilities 回答）；問 media 的 media.materials、media.spend（how 'episode'）
//   變更  channel.staff、channel.staff_set、channel.gear_add、channel.gear_remove（編制與設備；ops.ts）
//   量表  subs（訂閱，0 起、沒有上限）、credibility（公信力，0～100，起始 50）、reco（推薦權重，−3～3）：同名的效果與條件自動有（effects.ts）
//   衍生數值  flow_tier 的 provider（abilities 定義這個數值；沒裝 abilities 就不加）：訂閱的位數 −3，公信力 60 以上 +1，沒有頻道是 0；給主角的隊伍（主角與夥伴）
//   變更  channel.open、channel.budget、channel.sponsor、channel.sponsor_set、channel.sponsor_end、channel.week、channel.log（ops.ts）
//   效果  aired、channel_fund、sponsor；條件  channel_open、channel_level、has_sponsor（effects.ts）、channel_staff { role }、channel_path { path?, min? }（staff.ts）
//   掛鉤  game.new（空的頻道）、time.passed（順序 11：週一 06:00 的結算）、activity.end（kind live 收播：這一週算開過、記一筆）
//   狀態  state.ext.channel：形狀見 model.ts 的 ChannelState；只經由 channel.* 變更寫
// 報告：channel.open、channel.fund（補貼）、channel.withdraw、channel.sponsor_end、channel.weekly（kind downtime，帶觸發點 channel_week）；
//       channel.episode（kind broadcast，帶觸發點 episode）、channel.hire、channel.dismiss、channel.gear（裝上、拆下）。
// 對外：channelView、openChannel、fund、withdraw、withdrawPreview、endSponsor、payFromBudget（開銷的扣法）、channelLevel；
//       showOptions、episodePreview、airEpisode、seatStaff、dismissStaff、mountGear、unmountGear、staffSlots。
//
// 不碰別的功能：不讀別的功能的 state.ext；直播收播的資訊只從 activity.end 的 result 拿；好感與敵對值只問量表有沒有人定義。

import type { Feature, Kernel } from '../../core'
import { meterOf, toMinutes } from '../../core'
import { defineMeters, installConditions, installEffects } from './effects'
import { defineGearStats } from './gear'
import { installOps } from './ops'
import { SHOW_KIND, showProblems } from './shows'
import { installStaffConditions } from './staff'
import { weeklyDrafts } from './weekly'
import { CREDIBILITY, EXT, FLOW_TIER_STAT, OWNER, RULE_KIND, SUBS, blankChannel, channelRules, channelValue, flowTierOf, readChannel, ruleProblems } from './model'

export { endSponsor, endSponsorBlock, fund, fundBlock, payFromBudget, poolOrder, withdraw, withdrawPreview } from './budget'
export type { FundInput, Paid, PayAnswer, Purse as ChannelPurse, WithdrawInput, WithdrawPreview } from './budget'
export { channelLevel, channelSeats, openBlock, openChannel } from './open'
export { channelView } from './view'
export type { ChannelView, PoolRow, SponsorRow } from './view'
export { DEFAULT_SHOWS, acceptedTypes, showOf, showsOf } from './shows'
export type { ShowEntry } from './shows'
export { EPISODE_ACTION as CHANNEL_EPISODE_ACTION, EPISODE_TRIGGER as CHANNEL_EPISODE_TRIGGER, airBlock, airEpisode, costOf, episodePreview, fitReason, gradeChances, library, showOptions, stageHere } from './episode'
export type { EpisodeAnswer, EpisodeAsk, EpisodeInput, EpisodeMaterial, EpisodeOption, EpisodePreview, EpisodeResult, RollInfo, ShowOption, StageInfo } from './episode'
export { dismissBlock, dismissStaff, hireBlock, mediaTier, pathTier, seatStaff, staffSlots, wageOf } from './staff'
export type { HireInput, MediaPath, StaffRow } from './staff'
export { DISMISS_ACTION as CHANNEL_DISMISS_ACTION, HIRE_ACTION as CHANNEL_HIRE_ACTION } from './staff'
export { EPISODE_BONUS_STAT as CHANNEL_EPISODE_BONUS_STAT, GEAR_ACTION as CHANNEL_GEAR_ACTION, STREAM_GEAR_STAT as CHANNEL_STREAM_GEAR_STAT, STUDIO_SLOTS_STAT as CHANNEL_STUDIO_SLOTS_STAT, gearBonus, gearView, mountBlock, mountGear, studioOf, studioSlots, unmountBlock, unmountGear } from './gear'
export type { GearPart, GearResult, GearRowView, Studio } from './gear'
export { WEEK_STEPS, settleWeek, weeklyDrafts } from './weekly'
export type { WeekCtx, WeekStep } from './weekly'
export {
  DEFAULT_CHANNEL_RULES, EXT as CHANNEL_EXT, FLOW_TIER_STAT as CHANNEL_FLOW_TIER_STAT, OPEN_ACTION as CHANNEL_OPEN_ACTION, OWNER as CHANNEL_OWNER, FUND_ACTION as CHANNEL_FUND_ACTION,
  RULE_KIND as CHANNEL_RULE_KIND, SPONSOR_END_ACTION as CHANNEL_SPONSOR_END_ACTION, WEEKLY_ACTION as CHANNEL_WEEKLY_ACTION, WEEK_TRIGGER as CHANNEL_WEEK_TRIGGER,
  WITHDRAW_ACTION as CHANNEL_WITHDRAW_ACTION, CREDIBILITY as CHANNEL_CREDIBILITY, RECO as CHANNEL_RECO, SUBS as CHANNEL_SUBS,
  blankChannel, channelOpen, channelRules, flowTierOf, levelOf as channelLevelOf, readChannel, seatsOf as channelSeatsOf,
  GEAR_CLASSES as CHANNEL_GEAR_CLASSES, GRADES as CHANNEL_GRADES, GRADE_NAME as CHANNEL_GRADE_NAME, ROLES as CHANNEL_ROLES, ROLE_NAME as CHANNEL_ROLE_NAME, TIER_IDS as CHANNEL_TIERS, TIER_NAME as CHANNEL_TIER_NAME,
} from './model'
export type { ChannelRules, ChannelState, ChannelWeek, Episode, GearClass, GearRow, Grade as ChannelGrade, GradeRule, Pool, Role as ChannelRole, Sponsor, Staff, TierId as ChannelTier, TierRule } from './model'

export const channelFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: SHOW_KIND, owner: OWNER, overridable: true, validate: showProblems })
    defineMeters(k)
    defineGearStats(k, OWNER)
    installOps(k)
    installEffects(k)
    installConditions(k)
    installStaffConditions(k, OWNER)

    k.hooks.on('game.new', OWNER, () => [{ op: 'ext', key: EXT, value: channelValue(blankChannel()) }])

    // 聽直播的收播：沒有回退的那種直播自己用效果加訂閱與打賞，這裡只記「這一週開過」與最近的一筆（V12）
    k.hooks.on('activity.end', OWNER, ({ state, kind, result }) => {
      if (kind !== 'live' || !readChannel(state).open || result.to_channel === false) return undefined
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      const mode = result.mode === 'slot' ? '一場時段直播' : '一場活動直播'
      return {
        changes: [
          { op: 'channel.week', lives: 1 },
          {
            op: 'channel.log',
            entry: {
              at: toMinutes(state.time), kind: 'live', subs: num(result.subs), tips: num(result.tips), note: `${mode}。`,
              ...(typeof result.tier === 'string' || typeof result.tier === 'number' ? { tier: result.tier } : {}),
              ...(typeof result.grade === 'string' || typeof result.grade === 'number' ? { grade: result.grade } : {}),
              ...(typeof result.heat === 'number' && Number.isFinite(result.heat) ? { heat: result.heat } : {}),
            },
          },
        ],
      }
    })

    // 每週的結算（順序 11：帳單 10 之後）
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = weeklyDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    }, 11)
  },

  // flow_tier 由 abilities 定義：全部裝好之後才問得到有沒有人定義（沒有就不加 provider）
  ready(kernel) {
    const k = kernel as Kernel
    if (!k.stats.hasStat(FLOW_TIER_STAT)) return
    k.stats.addStatProvider(FLOW_TIER_STAT, OWNER, (state, actor) => {
      const ch = readChannel(state)
      if (!ch.open || !state.party.includes(actor)) return []
      const v = flowTierOf(channelRules(k), true, meterOf(k, state, SUBS), meterOf(k, state, CREDIBILITY))
      return v === 0 ? [] : [{ label: '頻道的訂閱與公信力', value: v, source: 'channel' }]
    })
  },
}

