// L6 功能：頻道的前半——開頻道、三張長期的量表、預算與贊助、每週結算、flow_tier 的來源
// （MEDIA 第 4 節開頭、4.1、4.2、4.8；EVENTS 2.4 節的 credibility、3.1 節的觸發點；dev/adr/0020 第二節、第十三節、V12～V16、V18、V19；dev/work/M5-channel.md）。
// 節目、編制、設備與開一集在下一張（M5-channel-shows）。
//
// 接上核心的地方：
//   內容  channel_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_CHANNEL_RULES）
//   量表  subs（訂閱，0 起、沒有上限）、credibility（公信力，0～100，起始 50）、reco（推薦權重，−3～3）：同名的效果與條件自動有（effects.ts）
//   衍生數值  flow_tier 的 provider（abilities 定義這個數值；沒裝 abilities 就不加）：訂閱的位數 −3，公信力 60 以上 +1，沒有頻道是 0；給主角的隊伍（主角與夥伴）
//   變更  channel.open、channel.budget、channel.sponsor、channel.sponsor_set、channel.sponsor_end、channel.week、channel.log（ops.ts）
//   效果  aired、channel_fund、sponsor；條件  channel_open、channel_level、has_sponsor（effects.ts）
//   掛鉤  game.new（空的頻道）、time.passed（順序 11：週一 06:00 的結算）、activity.end（kind live 收播：這一週算開過、記一筆）
//   狀態  state.ext.channel：形狀見 model.ts 的 ChannelState；只經由 channel.* 變更寫
// 報告：channel.open、channel.fund（補貼）、channel.withdraw、channel.sponsor_end、channel.weekly（kind downtime，帶觸發點 channel_week）。
// 對外：channelView、openChannel、fund、withdraw、withdrawPreview、endSponsor、payFromBudget（開銷的扣法；下一張用）、channelLevel。
//
// 不碰別的功能：不讀別的功能的 state.ext；直播收播的資訊只從 activity.end 的 result 拿；好感與敵對值只問量表有沒有人定義。

import type { Feature, Kernel } from '../../core'
import { meterOf, toMinutes } from '../../core'
import { defineMeters, installConditions, installEffects } from './effects'
import { installOps } from './ops'
import { weeklyDrafts } from './weekly'
import { CREDIBILITY, EXT, FLOW_TIER_STAT, OWNER, RULE_KIND, SUBS, blankChannel, channelRules, channelValue, flowTierOf, readChannel, ruleProblems } from './model'

export { endSponsor, endSponsorBlock, fund, fundBlock, payFromBudget, poolOrder, withdraw, withdrawPreview } from './budget'
export type { FundInput, Paid, PayAnswer, Purse as ChannelPurse, WithdrawInput, WithdrawPreview } from './budget'
export { channelLevel, channelSeats, openBlock, openChannel } from './open'
export { channelView } from './view'
export type { ChannelView, PoolRow, SponsorRow } from './view'
export { WEEK_STEPS, settleWeek, weeklyDrafts } from './weekly'
export type { WeekCtx, WeekStep } from './weekly'
export {
  DEFAULT_CHANNEL_RULES, EXT as CHANNEL_EXT, FLOW_TIER_STAT as CHANNEL_FLOW_TIER_STAT, OPEN_ACTION as CHANNEL_OPEN_ACTION, OWNER as CHANNEL_OWNER, FUND_ACTION as CHANNEL_FUND_ACTION,
  RULE_KIND as CHANNEL_RULE_KIND, SPONSOR_END_ACTION as CHANNEL_SPONSOR_END_ACTION, WEEKLY_ACTION as CHANNEL_WEEKLY_ACTION, WEEK_TRIGGER as CHANNEL_WEEK_TRIGGER,
  WITHDRAW_ACTION as CHANNEL_WITHDRAW_ACTION, CREDIBILITY as CHANNEL_CREDIBILITY, RECO as CHANNEL_RECO, SUBS as CHANNEL_SUBS,
  blankChannel, channelOpen, channelRules, flowTierOf, levelOf as channelLevelOf, readChannel, seatsOf as channelSeatsOf,
} from './model'
export type { ChannelRules, ChannelState, ChannelWeek, Episode, Pool, Sponsor } from './model'

export const channelFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    defineMeters(k)
    installOps(k)
    installEffects(k)
    installConditions(k)

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

