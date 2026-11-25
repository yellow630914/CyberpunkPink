// L6 功能：簾後館（CYBERSPACE 8.7 節、8.8 節；LEWD_SYSTEM 1.1、第 9 節；dev/adr/0018 第六、十三節；dev/adr/0019 第十二節、P56、P57；dev/work/M4-curtain-entry.md）。
//
// 暗礁裡會員制的成人地城。這一張是第一段：邀請函、面談與會員證、三個席次、保證金與每週會費、口味單、檔期主題與每週主打、報名並開一趟。
// 一趟裡面的節點、場熱與結算（M4-curtain-run）、落幕與補演、帳與檔期（M4-curtain-fall）接在後面。
// 它是生成器與「一趟網內的行程」的第三個使用者：只靠活動 netrun（launch；setup.region 整筆放這一區的規則）、掛點與格子的登錄表接上去，不 import netrun、maze、dive、deck。
//
// 接上核心的地方：
//   內容  curtain_rule（規則表，overridable，id: default：三個席次、邀請函、面談、會費、不收的人、口味單、這一區的規則……）、curtain_night（八個夜各一筆，是內容）
//   效果  curtain_invite { days? }（ai: false，只有內建的來源收）：邀請函三天有效
//   條件  curtain_member { tier? }（主角有會員證、沒停權，席次不低於 tier）；用到別人登記的：has_bridge（沒有橋進不來；沒有人註冊就當沒有）
//   掛點  bill.collect（每週一行會費）、bill.settled（付了 paid_until 往後一週；連續 fee_grace_weeks 週沒付停權）
//   放行  netrun 進行中放行 commit:curtain.（和迷宮館同一個做法）
//   狀態  state.ext.curtain：形狀見 model.ts
// 衍生數值與量表只讀：街頭信譽 rep（meterOf）、敵對值 hostility、deck_grade（有沒有甲板）、角色的沉溺（actor.sink）。
// 報告：curtain.interview（action）、curtain.taste（action）、curtain.enter（netrun，帶 launch 開一趟）。
// 對外：curtainOf、memberView、interviewBlock／interviewBlocks／interviewDraft、tasteOptions／tasteBlock／tasteDraft、nights／nightPool／featureOf、enterBlocks／enterQuote／enterDraft。
//
// 沒有做的（工單明講不做）：介紹人、試鏡、蚌殼市的假邀請函（內容；引擎只有效果 curtain_invite，P56）；檔期榜與月榜升席（P57）；簾口的位置（暗礁的節點、領位員）。
// 不收的人裡「勢力的清單」是規則表（refuse.factions），內容匯入前是空的。

import type { Condition, ConditionCtx, ContentEntry, Effect, Feature, GameState, Kernel } from '../../core'
import { ContentError } from '../../core'
import {
  ACT_NETRUN, DAY_MINUTES, INVITE_EFFECT, MEMBER_CONDITION, NIGHT_KIND, OWNER, RULE_KIND, TIER_IDS, curtainChange, curtainRules, isInt, nightProblems, nowOf, readCurtain, ruleProblems, tierIndex,
} from './model'
import type { NightEntry, TierId } from './model'
import { feeLine, feeSettled } from './member'

export { enterBlocks, enterDraft, enterQuote } from './enter'
export type { EnterOpts, EnterQuote } from './enter'
export { hasBridge, hasDeck, interviewBlock, interviewBlocks, interviewDraft, interviewProblems, memberView, refuseReasons } from './member'
export type { InterviewOpts, MemberView, TierView } from './member'
export { featureOf, nightPool, nights, runsTonight, tasteBlock, tasteDraft, tasteOptions, weekOf } from './nights'
export type { NightPool, NightRow, TasteOption } from './nights'
export {
  DEFAULT_REGION as CURTAIN_DEFAULT_REGION, DEFAULT_RULES as CURTAIN_DEFAULT_RULES, ENTER_ACTION as CURTAIN_ENTER_ACTION, EXT as CURTAIN_EXT, FEE_BILL_ID as CURTAIN_FEE_BILL_ID,
  INTERVIEW_ACTION as CURTAIN_INTERVIEW_ACTION, INVITE_EFFECT as CURTAIN_INVITE_EFFECT, MEMBER_CONDITION as CURTAIN_MEMBER_CONDITION, NIGHT_KIND as CURTAIN_NIGHT_KIND,
  ORIGIN_BY as CURTAIN_ORIGIN, REGION_ID as CURTAIN_REGION, RULE_KIND as CURTAIN_RULE_KIND, TASTE_ACTION as CURTAIN_TASTE_ACTION, TIER_IDS as CURTAIN_TIERS,
  curtainChange, curtainRules, mondayOf as curtainMondayOf, nightProblems, readCurtain as curtainOf, ruleProblems as curtainRuleProblems, weekIndexOf as curtainWeekIndex,
} from './model'
export type { CurtainRules, CurtainState, MemberRecord, NightEntry, RunRecord, TierDef, TierId, WeekRecord } from './model'

type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

interface InviteEffect extends Effect { days?: number }
interface MemberCondition extends Condition { tier?: TierId }

export const curtainFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: NIGHT_KIND, owner: OWNER, validate: nightProblems })

    // ---- 效果 curtain_invite：邀請函（內建的來源才收：誰給邀請函是內容，P56） ----
    k.effects.register<InviteEffect>({
      kind: INVITE_EFFECT, owner: OWNER, ai: false,
      validate: (raw) => [
        ...(raw.days === undefined || (isInt(raw.days) && raw.days >= 1 && raw.days <= 60) ? [] : ['days 要是 1～60 的整數（沒寫是規則表的 invite_days）']),
        ...Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && f !== 'days').map((f) => `${f}：沒有這個欄位（可以寫：days）`),
      ],
      toChanges(e, ctx) {
        const days = e.days ?? curtainRules(k).invite_days
        const cur = readCurtain(ctx.state)
        cur.invite = { until: nowOf(ctx.state) + days * DAY_MINUTES }
        return [curtainChange(cur)]
      },
      describe: (e) => `簾後館的邀請函：${e.days ?? curtainRules(k).invite_days} 天內有效`,
    })

    // ---- 條件 curtain_member：主角有會員證、沒停權，席次不低於 tier ----
    k.conditions.register<MemberCondition>({
      kind: MEMBER_CONDITION, owner: OWNER,
      validate: (raw) => [
        ...(raw.tier === undefined || (TIER_IDS as readonly unknown[]).includes(raw.tier) ? [] : [`tier 要是 ${TIER_IDS.join('、')} 其中一個`]),
        ...Object.keys(raw).filter((f) => f !== 'kind' && f !== 'tier').map((f) => `${f}：沒有這個欄位（可以寫：tier）`),
      ],
      test(c, { state }: ConditionCtx) {
        const m = readCurtain(state).member
        if (!m || m.suspended) return false
        return c.tier === undefined || tierIndex(m.tier) >= tierIndex(c.tier)
      },
    })

    // ---- 每週帳單：會費 ----
    const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
    on('bill.collect', OWNER, (({ state }: { state: GameState }) => {
      const line = feeLine(k, state)
      return line ? [line] : undefined
    }) as never)
    on('bill.settled', OWNER, (({ state, week, lines }: { state: GameState; week: number; lines: Parameters<typeof feeSettled>[3] }) => {
      const changes = feeSettled(k, state, week, lines)
      return changes.length > 0 ? changes : undefined
    }) as never)

    // ---- netrun 進行中放行簾後館自己的報告 ----
    k.activity.allow(ACT_NETRUN, 'commit:curtain.', OWNER)
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    if (k.content.hasKind(NIGHT_KIND)) {
      for (const n of k.content.list<NightEntry & ContentEntry>(NIGHT_KIND)) {
        if (k.content.hasKind('faction') && typeof n.faction === 'string' && !k.content.has('faction', n.faction)) problems.push(`${NIGHT_KIND}/${n.id}：包場的勢力 ${n.faction} 不在內容裡`)
      }
    }
    const rules = curtainRules(k)
    if (k.content.hasKind('faction')) {
      for (const f of rules.refuse.factions) if (!k.content.has('faction', f)) problems.push(`${RULE_KIND}：refuse.factions 的勢力 ${f} 不在內容裡`)
    }
    if (problems.length) throw new ContentError(problems)
  },
}
