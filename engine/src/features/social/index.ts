// L6 功能：社交媒體——追蹤、用素材或片發文（算式照 MEDIA 13.1）、每週的轉換與流失、一面只有氛圍數字的動態牆（M5-social）
// （MEDIA 第 10 節、13 節、2.1 節；SERIES 5.3 節；LEWD_SYSTEM 第 5 節；dev/adr/0020 第四節、第十三節、V29、V30、V54；dev/work/M5-social.md）。
//
// 接上核心的地方：
//   內容  social_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_SOCIAL_RULES；動態牆的來源對照表也在裡面）
//   量表  followers（追蹤，0 起、沒有上限；AI 一件事最多現值的 2%、最少 20）：同名的效果與條件自動有
//   變更  social.post、social.week（ops.ts）
//   掛點  social.feed（宣告並問：動態牆多的貼文；之後的線索池、npcs 回答）；問 media 的 media.spend（how 'post'）
//   掛鉤  game.new（空的狀態）、time.passed（順序 11：週一 06:00 的結算）
//   狀態  state.ext.social：形狀見 model.ts 的 SocialState；只經由 social.* 變更寫
// 報告：social.post（kind broadcast）、social.weekly（kind downtime）。
// 對外：postPreview、postBlock、post、postSources、socialView、feedView。
//
// 不碰別的功能：不讀別的功能的 state.ext；用料只走 media.spend；別人的量表（subs、reco、credibility、popularity、fame、affinity）只經 meterOf、
// 效果 subs 與 fame 先問有沒有人註冊；名冊只問條件 in_roster。沒有任何入口給街頭信譽、動公信力、加敵對值、動親密度（MEDIA 13.1「之後再定」）；沒有 AI 任務。

import type { Feature, Kernel, MeterDef } from '../../core'
import { meterEffectDef, meterOf } from '../../core'
import { installOps } from './ops'
import { weeklyDrafts } from './weekly'
import { blankSocial, EXT, FOLLOWERS, OWNER, RULE_KIND, ruleProblems, socialRules, socialValue } from './model'

export { feedView } from './feed'
export type { FeedPost } from './feed'
export { NO_LIBRARY as SOCIAL_NO_LIBRARY, TAG_OFF as SOCIAL_TAG_OFF, fameGain, post, postBlock, postPreview, postSources, sourceOf } from './post'
export type { FameGain, PostPreview } from './post'
export { settleWeek, weeklyDrafts } from './weekly'
export { socialView } from './view'
export type { SocialView } from './view'
export {
  DEFAULT_FEED_SOURCES, DEFAULT_SOCIAL_RULES, EXT as SOCIAL_EXT, FEED_SOURCES, FOLLOWERS as SOCIAL_FOLLOWERS, OWNER as SOCIAL_OWNER, POST_ACTION as SOCIAL_POST_ACTION, RULE_KIND as SOCIAL_RULE_KIND,
  WEEKLY_ACTION as SOCIAL_WEEKLY_ACTION, blankSocial, channelIndex, engagement, fameIndex, firstSentence, numbersOf, popularityOf, postText, readSocial, socialRules,
} from './model'
export type { FeedAnswer, FeedAs, FeedRow, FeedSource, Numbers as SocialNumbers, Part as SocialPart, Post as SocialPost, SocialRules, SocialState, Source as SocialSource } from './model'

const money = (n: number): string => n.toLocaleString('en-US')

export const socialFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 追蹤：AI 一件事合計最多現值的 ai_followers.pct %（最少 min）。同名的效果自己註冊（上限看現值算）：要在 k.meters.define 之前
    const followers: MeterDef = { kind: FOLLOWERS, owner: OWNER, name: '追蹤', min: 0, max: Infinity, start: 0, keyed: 'none', cap: { down: 20, up: 20 }, ownEffect: true }
    const base = meterEffectDef(followers, k.meters)
    k.effects.register({
      ...base,
      owner: OWNER,
      budget(e, ctx) {
        const b = base.budget?.(e, ctx)
        if (!b) return null
        const rules = socialRules(k)
        const cap = Math.max(rules.ai_followers.min, Math.floor((meterOf(k, ctx.state, FOLLOWERS) * rules.ai_followers.pct) / 100))
        return {
          ...b, min: -cap, max: cap,
          notice: (to) => (b.amount > 0
            ? (to === 0 ? `一次最多讓追蹤增加 ${money(cap)} 人，這一筆沒有再算。` : `一次最多讓追蹤增加 ${money(cap)} 人，實際增加了 ${money(to)} 人。`)
            : (to === 0 ? `一次最多讓追蹤減少 ${money(cap)} 人，這一筆沒有再算。` : `一次最多讓追蹤減少 ${money(cap)} 人，實際減少了 ${money(-to)} 人。`)),
        }
      },
    })
    k.meters.define(followers)

    installOps(k)

    k.hooks.on('game.new', OWNER, () => [{ op: 'ext', key: EXT, value: socialValue(blankSocial()) }])

    // 每週的結算（順序 11：帳單 10 之後）
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const drafts = weeklyDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    }, 11)
  },
}
