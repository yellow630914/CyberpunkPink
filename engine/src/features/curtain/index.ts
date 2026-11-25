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
// M4-curtain-run 補的（一趟裡的四幕；dev/work/M4-curtain-run.md）：
//   內容  curtain_table（點單表、賞箱表、獎品表，各一筆 d6 的表）
//   量表  heat（場熱，0～100、起算 30、鍵是那一趟的地圖實例；AI 與玩家要的效果一律不收）；票根是核心的計數器 curtain:stubs
//   變更  curtain.patch（改 state.ext.curtain 的一小塊，在套用的那一刻讀現在的狀態，同一份報告裡好幾個掛點各改各的不會互相蓋掉）
//   單位  來源 curtain_pick（每場遭遇擲文化，從那個文化的敵人資料裡挑，再交給 enemy 來源做出單位）
//   掛點  netrun.round（回合數、每 3 個探索回合場熱 −1）、netrun.close（結算）；battle.onEnd（亮點、倒下、點單的驗收、首領的獎品）；
//         戰鬥的 action.done（記超頻，給守規矩用）；activity.end（合演的場景結束換場熱）；report.after（結果、化妝室、場熱跨門檻）
//   格子  k.grid.usesOf（遭遇、點單、賞箱、條文、近道、獎品室；這一區的 handled 讓 netrun 不列它們）
// 報告：curtain.use（遭遇、點單、賞箱、條文、近道、獎品室、包場）、curtain.rest（化妝室）、curtain.stage（贊助人、加演、提早落幕、記下地圖）、curtain.result（結算）、curtain.encore（進第 5、6 幕）。
// 對外：useCurtain、orderChoices、restDraft、curtainView、encoreDraft／encoreBlocks／encoreOf、cultureFor、highlightsOf、tipsRatio。
//
// 沒有做的（工單明講不做）：介紹人、試鏡、蚌殼市的假邀請函（內容；引擎只有效果 curtain_invite，P56）；檔期榜與月榜升席（P57）；簾口的位置（暗礁的節點、領位員）。
// 不收的人裡「勢力的清單」是規則表（refuse.factions），內容匯入前是空的。

import type { ActorId, Condition, ConditionCtx, ContentEntry, Effect, Feature, GameState, Kernel } from '../../core'
import { ActionBlocked, ContentError } from '../../core'
import {
  ACT_NETRUN, DAY_MINUTES, HEAT, INVITE_EFFECT, MEMBER_CONDITION, NIGHT_KIND, OWNER, PICK_SOURCE, RULE_KIND, TABLE_KIND, TIER_IDS, curtainChange, curtainRules, isInt, nightProblems, nowOf, readCurtain, ruleProblems, tableProblems, tierIndex,
} from './model'
import type { CurtainTable, NightEntry, TierId } from './model'
import { feeLine, feeSettled } from './member'
import { afterReport } from './after'
import { onBattleEnd, onRound, onSceneEnd } from './battle'
import { ctxOf } from './ctx'
import { pickUnit } from './culture'
import { restDraft as restDraftAt, useAt, usesOfMarker } from './nodes'
import { orderChoices as orderChoicesOf } from './orders'
import { registerPatch } from './patch'
import { closeRun } from './settle'

export { enterBlocks, enterDraft, enterQuote } from './enter'
export { curtainView } from './view'
export type { CurtainView, HeatBand } from './view'
export { encoreBlocks, encoreDraft, encoreOf } from './settle'
export { cultureFor, cultures, encounterCulture, pickCandidates as culturePickCandidates } from './culture'
export { heatBand, heatOf as curtainHeat, highlightHeat, highlightsOf, overshoot as curtainOvershoot, sceneHeat, tipsRatio } from './heat'
export { exploreOf as curtainExplored, roundsOf as curtainRounds } from './nodes'
export { stubsOf as curtainStubs, tableOf as curtainTableOf } from './tables'
export { PATCH_OP as CURTAIN_PATCH_OP } from './patch'
export type { OrderChoice } from './orders'
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
  ENCORE_ACTION as CURTAIN_ENCORE_ACTION, FLAG_SPONSOR as CURTAIN_FLAG_SPONSOR, HEAT as CURTAIN_HEAT, ORDER_KINDS as CURTAIN_ORDER_KINDS, PICK_SOURCE as CURTAIN_PICK_SOURCE, REST_ACTION as CURTAIN_REST_ACTION,
  RESULT_ACTION as CURTAIN_RESULT_ACTION, STAGE_ACTION as CURTAIN_STAGE_ACTION, STUBS as CURTAIN_STUBS, TABLE_KIND as CURTAIN_TABLE_KIND, USE_ACTION as CURTAIN_USE_ACTION, tableProblems as curtainTableProblems,
} from './model'
export type {
  ActDef, CurtainRules, CurtainState, CurtainTable, EncoreRec, MemberRecord, NightEntry, OfferRec, OrderKind, OrderRec, PendingRec, RunRecord, SettleResult, TableRow, TierDef, TierId, WeekRecord,
} from './model'

/** 做一件事：id 是 fight、order、order:accept、order:refuse、chest、clause、clause:sign、shortcut、prize、book；at 是標記的 id（沒寫是站著的那一格；開戰要寫旁邊的遭遇）。合演的對象可以用 opts.with 指定同行的人。不成立丟 ActionBlocked。 */
export function useCurtain(k: Kernel, state: GameState, id: string, at?: string, opts: { with?: ActorId } = {}): ReturnType<typeof useAt> {
  const c = ctxOf(k, state)
  if (!c) throw new ActionBlocked('現在不在簾後館的一趟裡。')
  return useAt(c, id, at, opts)
}

/** 現在看過、等著決定的點單與選項（沒有是 null）。 */
export function orderChoices(k: Kernel, state: GameState): ReturnType<typeof orderChoicesOf> {
  const run = readCurtain(state).run
  return run ? orderChoicesOf(k, state, run) : null
}

/** 化妝室（層與層之間；往下一幕之後自動發一次）：book: true 是贊助人在場時的包場。不成立丟 ActionBlocked。 */
export function restDraft(k: Kernel, state: GameState, o: { book?: boolean } = {}): ReturnType<typeof restDraftAt> {
  const c = ctxOf(k, state)
  if (!c) throw new ActionBlocked('現在不在簾後館的一趟裡。')
  return restDraftAt(c, o)
}

type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

interface InviteEffect extends Effect { days?: number }
interface MemberCondition extends Condition { tier?: TierId }

export const curtainFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: NIGHT_KIND, owner: OWNER, validate: nightProblems })
    k.content.defineKind({ kind: TABLE_KIND, owner: OWNER, validate: tableProblems })

    // ---- 場熱：一趟一條（鍵是那一趟的地圖實例）；只由館內的事決定，AI 與玩家要的一律不收 ----
    k.meters.define({
      kind: HEAT, owner: OWNER, name: '場熱', min: 0, max: 100, start: 30, keyed: 'map', cap: { down: 0, up: 0 },
      accepts: () => '場熱是觀眾的興致，只由戰鬥與場景的結果決定，不能自己加減。',
    })
    registerPatch(k, OWNER)

    // ---- 單位來源 curtain_pick：每場遭遇擲到的文化，從那個文化的敵人資料裡挑 ----
    k.battle.unitSource(PICK_SOURCE, OWNER, (ref, ctx) => pickUnit(k, ctx.state, ref, ctx))

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

    // ---- 一趟裡面的掛點（netrun.round、netrun.close 是 features/netrun 宣告的：這裡只認名字與格式，不 import） ----
    type RunPayload = { id: string; layer: number; round: number; map: string; origin: { by: string } }
    on('netrun.round', OWNER, (({ state, run }: { state: GameState; run: RunPayload }) => onRound(k, state, run)) as never)
    on('netrun.close', OWNER, (({ state, run, outcome }: { state: GameState; run: RunPayload; outcome: string }) => closeRun(k, state, run, outcome)) as never)
    k.battle.onEnd(OWNER, ({ state, battle, outcome }) => onBattleEnd(k, state, battle, outcome))
    // 守規矩的點單看這一場我方超頻過沒有：行動的標籤記在場地上（換檔的事件在紀錄裡）
    k.battle.on('action.done', OWNER, ({ run, unit, tags }) => {
      if (unit.side === 'ally' && tags.includes('overclock') && run.battle.origin.ext?.curtain) run.battle.field.curtain_oc = true
    })
    // 收尾的點單看最後一個倒下的敵人是被哪一種傷害打倒的（我方的攻擊結算完、目標已經退出）
    k.battle.on('attack.after', OWNER, ({ run, attacker, target, weapon, opts }) => {
      if (attacker.side === 'ally' && target.side === 'foe' && target.out && run.battle.origin.ext?.curtain) run.battle.field.curtain_finish = String(opts.type ?? weapon.type ?? '')
    })
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, result }) => (kind === 'scene' ? onSceneEnd(k, state, origin, result) : undefined))
    k.hooks.on('report.after', OWNER, ({ state, report }) => afterReport(k, state, report))
    // 節點能做的事（遭遇、點單、賞箱、條文、近道、獎品室）
    k.grid.usesOf(OWNER, (g, marker) => {
      const c = ctxOf(k, g.state)
      return c && c.map === g.at.map ? usesOfMarker(c, marker) : []
    })

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
    if (k.content.hasKind(TABLE_KIND)) {
      for (const t of k.content.list<CurtainTable & ContentEntry>(TABLE_KIND)) {
        for (const [i, row] of (Array.isArray(t.rows) ? t.rows : []).entries()) {
          for (const e of Array.isArray(row.give) ? row.give : []) {
            if (typeof e.kind === 'string' && !k.effects.has(e.kind)) problems.push(`${TABLE_KIND}/${t.id}：rows[${i}] 的效果 ${e.kind} 沒有人登記`)
          }
        }
      }
    }
    for (const [kind, want] of Object.entries(rules.tables)) {
      if (want && !(k.content.hasKind(TABLE_KIND) && k.content.has(TABLE_KIND, want))) problems.push(`${RULE_KIND}：tables.${kind} 的表 ${want} 不在內容裡`)
    }
    if (k.content.hasKind('faction')) {
      for (const f of rules.refuse.factions) if (!k.content.has('faction', f)) problems.push(`${RULE_KIND}：refuse.factions 的勢力 ${f} 不在內容裡`)
    }
    if (problems.length) throw new ContentError(problems)
  },
}
