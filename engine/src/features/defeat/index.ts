// L6 功能：戰敗（COMBAT_SYSTEM 8.3、8.4、8.5 節；ENEMIES 第 6 節；DATA 第 5 節；AI_TASKS 3.14 節只看流程；UI 4.1 節；dev/work/M2-defeat.md）。
//
// 戰鬥打輸（全隊倒下）或投降之後：選一件戰敗事件與版本（choose.ts：天使急救、副本自訂、個別敵人、勢力的預設、通用的；
// 版本照性別）→ 照存檔規則演或不演（flow.ts）→ 演就用事件視窗（活動 event）跑，多段、選項、檢定、可能接成人場景都是它的事 →
// 事件做完或跳過之後才出現三選一（接受結果、重來這場戰鬥、回到這個階段開始時）→ 接受之後發 activity.end（kind defeat）交回給發起那一場的人。
// 等待中的戰敗放在 state.ext.defeat；「重來」與「回到階段」由介面呼叫 Game.retryBattle() 等，ext 與事件造成的改變跟著快照回去。
// 等玩家三選一的期間不能做別的事，是核心擋的（活動 defeat：打輸之後開打前的快照還在，就是在等）；
// 事件視窗、場景在演的時候放行它們自己的報告（k.activity.allow），接受要等它們做完。
//
// 不替任何一種 kind 寫專屬的程式（dev/adr/0016 G5）：kind 只是資料上的標籤，每一種都用通用的事件格式加封閉的效果清單寫。
// 不 import features/director 與 features/commission：事件視窗只經 k.activity 開，委託失敗只把 fails_commission 交出去。

import type { Condition, Feature, Launch } from '../../core'
import { ContentError } from '../../core'
import type { RulesKernel, GameState } from '../../core'
import { effectProblems } from './body'
import { afterBattleEnd, onBattleEnd, onEventEnd } from './flow'
import { pick as pickEntry } from './choose'
import type { PickOpts } from './choose'
import { EVENT_ACTIVITY, KIND, OWNER, defeatOf, entryProblems } from './model'
import type { DefeatEventEntry } from './model'

export { acceptDefeat, chooseDefeatOption, companionNames, defeatOptions, defeatView, failsAfter, rewriteOf, skipDefeat, watchDefeat } from './flow'
export type { DefeatChoice, DefeatViewInfo } from './flow'
export { hasAngel, locatedEventOf, locatedOf, winnersOf } from './choose'
export type { PickOpts } from './choose'
export { inlineEvent, playSkipped, rewriteEffects } from './body'
export type { Rewrite, SkipPlay } from './body'
export { STAGE_KIND as DEFEAT_STAGE_KIND, defeatOf, moneyLimit, stageOf } from './model'
export type { DefeatEventEntry, DefeatOption, DefeatStage, DefeatVersion, PendingDefeat, PickTier, PlayedResult } from './model'

/** 選事件與版本（純函式，測試與介面問「會選到哪一件」用）。沒有任何可用的事件丟錯。 */
export function pickDefeat(k: RulesKernel, state: GameState, o: PickOpts): { event: string; version: string; fails_commission: boolean; tier: string } {
  const r = pickEntry(k, state, o)
  if (!r) throw new Error('沒有可用的戰敗事件（沒有勢力對得上的，也沒有標 default 的通用事件）。')
  return { event: r.entry.id, version: r.version, fails_commission: r.entry.fails_commission, tier: r.tier }
}

/**
 * 這一次開活動是不是戰敗自己的流程開出來的：戰敗自己開的事件（origin.by 是 defeat）、它的事件 chain 帶出來的第二件，
 * 還有這些事件的 fight 結果開的戰鬥（origin 是導演、ext.caller 是 defeat，或是 chain 帶出來的那一件；那一件的 caller 記的是導演）。
 * 等玩家三選一的期間只放行這些：玩家自己開戰、別的功能開的事件都不放行（M1 審查 E1）。
 */
export function fromDefeatFlow(launch: Launch | undefined): boolean {
  const o = launch?.origin
  if (!o) return false
  return o.by === OWNER || (o.by === 'director' && (o.ext?.caller === OWNER || o.ext?.caller === 'director'))
}

export const defeatFeature: Feature = {
  id: OWNER,
  install(k) {
    k.content.defineKind<DefeatEventEntry>({
      kind: KIND, owner: OWNER,
      validate(e) {
        const p = entryProblems(e)
        if (e.default === true) {
          const other = k.content.list<DefeatEventEntry>(KIND).find((x) => x.default === true && x.id !== e.id)
          if (other) p.push(`default: true 整份內容裡最多一筆（${other.id} 已經是了）`)
        }
        return p
      },
      refs: (e) => [
        ...(Array.isArray(e.factions) ? e.factions.map((f) => ['faction', f] as [string, string]) : []),
        ...(e.fallback ? [[KIND, e.fallback] as [string, string]] : []),
      ],
    })

    // 條件（事件的選項寫 need: { kind: 'defeat_tethered' }）：等待中的戰敗是內海的、被扣線了
    k.conditions.register<Condition>({ kind: 'defeat_net', owner: OWNER, validate: () => [], test: (_c, { state }) => defeatOf(state)?.net === true })
    k.conditions.register<Condition>({ kind: 'defeat_tethered', owner: OWNER, validate: () => [], test: (_c, { state }) => defeatOf(state)?.tethered === true })

    // 打輸或投降：選事件與版本，記下等待中的戰敗
    k.battle.onEnd(OWNER, ({ state, battle, outcome }) => onBattleEnd(k, state, battle, outcome))

    // 戰鬥結束的報告之後接一份戰敗的報告（always 而且沒有別的選項時，同一份帶 launch：事件視窗自己開起來）
    k.hooks.on('report.after', OWNER, ({ state, report }) => {
      if (report.action !== 'battle.end') return
      if (report.outcome.result !== 'lose' && report.outcome.result !== 'surrender') return
      const d = afterBattleEnd(k, state)
      return d ? [d] : undefined
    })

    // 事件視窗做完：記下選了什麼與算不算委託失敗
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, result }) => (kind === EVENT_ACTIVITY ? onEventEnd(state, origin, result) : undefined))

    // 三選一的報告：等待中的戰敗只放行自己的報告（defeat.view、defeat.skip、defeat.accept、defeat.option）
    k.activity.allow('defeat', 'commit:defeat.', OWNER)
  },

  ready(k) {
    const defaults = k.content.list<DefeatEventEntry>(KIND).filter((e) => e.default === true)
    if (defaults.length > 1) throw new Error(`戰敗事件的 default: true 整份內容裡最多一筆（現在有 ${defaults.map((e) => e.id).join('、')}）。`)
    // 每一筆效果的種類要有人註冊、格式要對：用到沒裝的功能（義體、調校、惡意韌體、契約……）的事件，載入時就指出是哪一件（M4-followups）
    const problems = k.content.list<DefeatEventEntry>(KIND).flatMap((e) => effectProblems(k, e))
    if (problems.length > 0) throw new ContentError(problems)
    // 等著三選一的期間，事件視窗與成人場景自己的報告要放行（所有功能都安裝之後才知道有沒有人登記這兩種活動；
    // 沒有事件視窗的一局維持 M1 的樣子：等著選的戰敗擋住自由行動，不開口子）。
    // 放行照階段（COMBAT_SYSTEM 8.4 節、M1 審查 E1）：
    // - 事件視窗：只放戰敗自己的流程開的（不放別的功能開的；導演也因此把等待中的戰敗當成「另一個活動進行中」）；
    // - 自由行動：只在事件視窗開著時放行（回應事件）；問要不要看（ask）與三選一（played）的期間不放行；
    // - 戰鬥：只放事件的 fight 結果開的（劫囚之類），玩家自己開戰仍然擋住。
    const eventWindow = k.activity.get(EVENT_ACTIVITY)
    if (eventWindow) {
      k.activity.allow('defeat', 'commit:event.', OWNER)
      k.activity.allow('defeat', 'event.start', OWNER, (_s, _doing, _draft, launch) => fromDefeatFlow(launch))
      k.activity.allow('defeat', 'chain:free_action', OWNER, (s) => eventWindow.active(s) !== null)
      k.activity.allow('defeat', 'battle.start', OWNER, (_s, _doing, _draft, launch) => fromDefeatFlow(launch))
    }
    if (k.activity.get('scene')) for (const prefix of ['scene.start', 'commit:scene.']) k.activity.allow('defeat', prefix, OWNER)
  },
}
