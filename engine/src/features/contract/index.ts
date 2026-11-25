// L6 功能：契約（主角是契約人那一面；LEWD_SYSTEM 第 7 節 7.1～7.4、7.6、7.8；LIFE 3.4 節；EVENTS 4.5 節；DOWNTIME 4.2 節；dev/adr/0019 第八節與 P27～P30；dev/work/M4-contract.md）。
// 簽下一份管理級的契約之後：每天 08:00 持約人擲要不要下指令，指令進一條有期限的佇列；玩家選照做或抗拒（定力檢定）；走到指定的地方時發觸發點，事件由導演挑；
// 做完滿意上升、每照做三次馴化 +1；強制的過了期限橋自己動手；打工的收入大部分歸持約人；禁區與宵禁會被發現；還清（或事件的結果）解約。
// 只做機制，不寫任何一件指令事件的內容；牆外的契約（誓約）不做，格式留 oath?；九條脫身的路只做「還清」與效果 contract_end；主角是持約人那一面是下一張（M4-contract-holder）。
//
// 接上核心的地方：
//   內容  contract_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_CONTRACT_RULES：kind_weights、person_weights、deadline_hours、resist、satisfaction、docility_every、
//         overdue、income_keep、debt_monthly、buyout、crossed_out_mult、keep_records）；讀導演定義的 event_scope 的 contract 那一筆（daily_roll、satisfaction_mult、queue_max；沒有就用 EVENTS 4.5 節的預設）
//   量表  satisfaction（0～100，keyed: none，起始 0；AI 與玩家要的一律不收，只有內建的來源能動；同名的效果與條件自動有）
//   被動  k.passives.register 來源 contract：目前沒有固定的（留給之後的條款）
//   效果  contract_sign、contract_end、order、order_done、bridge_right（都 ai: false；effects.ts）
//   條件  contract（side: bound／holder）、order_pending（order_kind?）
//   掛點  time.passed（逾期、每天的指令、月息、宵禁、副本裡期限暫停）、report.before（打工收入歸屬）、report.after（通知與禁區）；
//         掃橋用匯出的 scanAnswer（掛點 scan.person 由 M4-security-m4 接）
//   用到別人登記的（查不到就略過）：效果 bridge、cyber_lock、load、hostility；衍生數值 bridge_docility、load_cap；條件 at_home；內容 faction、npc、block、item、event_scope；k.activity（commission）
// 狀態  state.ext.contract：{ mine, held, rights, seq, notes }（形狀見 model.ts；只經由報告裡的 ext 變更寫；跟著快照回去）；主角的身分 actor.ext.identity.class（簽下是 bound，解約改回去）
// 報告  contract.sign、contract.order、contract.choose、contract.arrive（帶觸發點 order，where { order, holder, relation }）、contract.done、contract.overdue、contract.pay、contract.end、
//       contract.rule、contract.pause（副本裡期限往後挪，system）、contract.cover
// 對外：contractOf、boundView、resistQuote、chooseBlock／chooseDraft、arriveBlock／arriveDraft、completeBlock／completeDraft、askOrderBlock／askOrderDraft、
//       payoffQuote／payoffBlock／payoffDraft、coverMarkBlock／coverMarkDraft、scanAnswer、contractRules。
//
// 沒有做：任何一件指令事件的內容；牆外的契約；契約鎖（lock.kind: contract）擋破解與遠端接管（那是 cyberware 的 crack.ts 要問的事，見回報）；NTR 篩選（只管持約人那一面）；
//       規矩的服裝與不准見的人（只記錄）；轉讓、買下別人的契約（內容）。

import type { Feature, Kernel, ReportDraft } from '../../core'
import { afterDrafts, incomeBefore, timeDrafts } from './time'
import { installEffects } from './effects'
import { OWNER, RULE_KIND, SATISFACTION, ruleProblems } from './model'

export {
  ACTIVE_STATES, CONTRACT_TYPES, DEFAULT_CONTRACT_RULES, DEFAULT_DAILY_ROLL, DEFAULT_QUEUE_MAX, DEFAULT_SATISFACTION_MULT, EXT as CONTRACT_EXT, HOLDER_KINDS, ORDER_KINDS, ORDER_NAME,
  ORDER_STATES, RELATIONS, RULE_KIND as CONTRACT_RULE_KIND, SATISFACTION as CONTRACT_SATISFACTION, contractOf, contractRules, dailyChance, extOf as contractExt, scopeData as contractScope,
} from './model'
export type {
  Contract, ContractExt, ContractRule, ContractRules, ContractType, DeadlineSpec, Holder, HolderKind, Note, Order, OrderKind, OrderState, Place, Relation, Right, RightLevel, RuleType,
} from './model'
export { resistPlan } from './draft'
export type { ResistPlan } from './draft'
export {
  arriveBlock, arriveDraft, askOrderBlock, askOrderDraft, chooseBlock, chooseDraft, completeBlock, completeDraft, coverMarkBlock, coverMarkDraft, payoffBlock, payoffDraft, payoffQuote, resistQuote,
} from './play'
export type { AskOpts, ChooseOpts, CoverOpts, OrderOpts, PayoffOpts, PayoffQuote } from './play'
export { overdueOptions } from './time'
export type { OverdueOption } from './time'
export { boundView, scanAnswer } from './view'
export type { BoundView, OrderView, ScanContract } from './view'

export const contractFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 量表：滿意。不分對象（主角身上一次只有一份管理級的契約）；只有內建的來源（契約自己的往來、事件資料）能動它
    k.meters.define({
      kind: SATISFACTION, owner: OWNER, name: '滿意', min: 0, max: 100, start: 0, keyed: 'none',
      accepts: () => '持約人的滿意只會因為你和他之間發生的事而變，不能直接要。',
    })

    // 被動效果：目前沒有固定的（留給之後的條款）
    k.passives.register(OWNER, 'contract', () => [], '契約')

    installEffects(k)

    k.hooks.on('report.before', OWNER, ({ state, draft }) => incomeBefore(k, state, draft))
    k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
      const drafts = afterDrafts(k, state, report)
      return drafts.length > 0 ? drafts : undefined
    })
    k.hooks.on('time.passed', OWNER, ({ state, from, to }): ReportDraft[] | void => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = timeDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    })
  },
}

export { OWNER as CONTRACT_OWNER }
