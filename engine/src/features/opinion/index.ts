// L6 功能：輿論戰的本體（OPINION 第 3、4、5 節；DATA 6.3、9.1；dev/adr/0020 第五節、V31～V34、V39；dev/work/M5-opinion.md）。
// 一場輿論戰：九個格子、聲量與風向、編輯點、料／說法／手段三種牌、佔領與防守、六個（或四個）回合、對手的公關點與行動表、城市事件、四級結果。
// 這一張只用基本牌與「任何人」的編輯點；誰坐編輯台、技能、素材進牌庫、後果在下一張（M5-opinion-desk），委託副本的那一段在 M5-opinion-face。
//
// 接上核心的地方：
//   內容  opinion_rule（規則表，id: default）、topic_kind（五種議題類型＋四列預設的分數）、topic、pr_opponent、pr_action、opinion_card、city_card（model.ts）
//   變更  opinion.war（整份換上一場戰役、或清掉；形狀見 War）
//   活動  opinion（order 50；放行 commit:opinion.；原因「輿論戰進行中，要先打完（或認輸）。」）；也往 commission 的放行清單加 commit:opinion.
//   狀態  state.ext.opinion.war；只經由 opinion.war 寫
//   警告  資料裡寫 murmur 的（議題、對手、議題類型）：當 whisper 收，提醒改寫
// 報告（kind broadcast）：opinion.start、opinion.play、opinion.capture、opinion.turn（對手的整個回合與下一回合的城市事件、抽牌都在這一份）、
//   opinion.bribe、opinion.concede、opinion.end（結算；發 activity.end：outcome 是 major、minor、draw、lost）。
// 對外：opinionView、startDraft（開場的草稿；活動的 start 也用它）、playCard、capture、endTurn、answerBribe、concede、settle（各有一個 …Block 回答原因）、defenseOf、scoreOf、parseWhen。
// 不碰別的功能：不用戰鬥引擎、不讀別的功能的 state.ext；公信力只問量表有沒有人定義（meterOf）。

import type { Feature, Kernel, Origin, ReportDraft } from '../../core'
import type { ContentEntry } from '../../core'
import { clone } from '../../core'
import { EP_BONUS_STAT, OPEN_HAND_STAT } from './desk'
import { answerCheck } from './hooks'
import type { War } from './model'
import {
  ACTION_KIND, ACTIVITY, BUSY_REASON, CARD_KIND, CITY_KIND, EXT, OPPONENT_KIND, OWNER, RULE_KIND, TOPIC_KIND, TOPIC_KIND_KIND, WAR_OP, actionProblems, cardProblems, cityProblems,
  opponentProblems, readWar, ruleProblems, topicKindProblems, topicProblems, warProblems,
} from './model'
import type { OpinionSetup } from './start'
import { startDraft } from './start'

export { cardBlock, cardOf, cardText, costOf, faceOf, fuelVoice, guardable, lineWind, playBlock, playDraft as playCard, warBlock } from './cards'
export type { Face, PlayInput } from './cards'
export { startDraft, skeleton } from './start'
export type { DeskSetup, OpinionSetup, Skeleton } from './start'
export {
  bribeBlock, bribeDraft as answerBribe, captureBlockOf, captureDraft as capture, closeDraft, concedeBlock, concedeDraft as concede, endTurnBlock, endTurnDraft as endTurn, settleBlock, settleDraft as settle,
} from './turn'
export type { BribeInput, CaptureInput, EndTurnInput } from './turn'
export { opinionView } from './view'
export type { CellView, HandView, OpinionView } from './view'
export { FAME_CELLS, applicableDefMods, capturable, captureBlock, cellBlock, cellScore, cellsOwnedBy, defenseOf, fameLevel, frontier, lockedCells, planCapture, scoreOf } from './board'
export type { CapturePlan } from './board'
export { OP_EFFECTS, OP_MODS, OP_TRIGGERS, REACTION_ONLY, SHIELD_WHAT, askMoves, askOpen, askPassives, effectProblems, moveProblems, openProblems, passiveProblems } from './hooks'
export type { Asked, OpEffect, OpEffectKind, OpMod, OpModKind, OpMove, OpOpen, OpPassive, OpReact, OpTrigger } from './hooks'
export { moveBlock, moveDraft as useMove, movesView } from './moves'
export type { MoveInput, MoveView } from './moves'
export { applyEffects, fireReactions, reservables } from './fx'
export type { FxCtx, FxFlags, FxInput, Reservable } from './fx'
export { DEFAULT_ENV, modHas, modSum, modsOf } from './mods'
export type { Env } from './mods'
export { EP_BONUS_STAT, OPEN_HAND_STAT, deskOptions, epBonusOf, epOf, openHandBonus, pathBonus } from './desk'
export type { DeskOption, EpPart } from './desk'
export { bringOptions, cardOfMaterial, isFake, planBring, relationOf } from './bring'
export type { BringCard, BringOption, BringPlan, BroughtMaterial, Relation } from './bring'
export { consequences, standingFaction } from './after'
export type { AfterResult } from './after'
export { factionGrade, foeFor, isSelfTopic, selfTopic } from './self'
export { WHEN_OPS, WHEN_VARS, evalWhen, parseWhen, whenHolds } from './when'
export type { When, WhenOp, WhenTerm, WhenVar, WhenVars } from './when'
export { Run, credOf, outcomeName } from './run'
export { checkOnce, foeTurn, prPoints, whenVars } from './foe'
export {
  ACTION_IDS, CELLS as OPINION_CELLS, CELL_NAME as OPINION_CELL_NAME, DEFAULT_CARDS, DEFAULT_CITY_CARDS, DEFAULT_OPINION_RULES, DEFAULT_PR_ACTIONS, DEFAULT_TOPIC_KINDS, EXT as OPINION_EXT,
  ACTIVITY as OPINION_ACTIVITY, adjacent, cardCatalog, cityCatalog, neighbors, normalizeCellMap, opinionRules, oppositeOf, prActions, readWar, topicKinds,
} from './model'
export type {
  ActionId, Cell, CardEntry, CityEffect, CityEntry, Means, OnceRule, OpinionRules, OpponentEntry, Outcome, PrActionEntry, Seat, Signature, TopicEntry, TopicKindEntry, War, WarCard, WarCell, WarFoe,
  WarResult, WarTopic, Who,
} from './model'

/** 開一場輿論戰（編輯台的入口）：topic 可以是議題的 id、整筆議題、或只給類型與目標勢力（自己發起）；foe 沒給就找對得上勢力的對手；desk 是坐編輯台的人；bring 是要帶進牌庫的料。回傳 opinion.start 的報告草稿。 */
export function startWar(k: Kernel, state: Parameters<typeof startDraft>[1], setup: OpinionSetup, origin: Origin = { by: 'shell' }): ReportDraft {
  return startDraft(k, state, setup, origin)
}

export const opinionFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    // 勢力的聲望（V41）：每個勢力一條，0～100、起始 50；M5 只記、顯示、給事件與委託的條件讀。同名的效果與條件自動有（AI 一件事 ±5）
    k.meters.define({ kind: 'standing', owner: OWNER, name: '聲望', min: 0, max: 100, start: 50, keyed: 'faction', cap: { down: 5, up: 5 } })
    // 義體、藥、裝備給的編輯點與開場手牌（M4 對帳 D8）：資料用被動效果 { stat: 'ep_bonus', amount: 1 } 寫；編輯點的合計夾法在 desk.ts（regenTotal）
    k.stats.defineStat({ id: EP_BONUS_STAT, owner: OWNER, name: '輿論戰每回合的編輯點加值', base: () => 0, min: -6, max: 6 })
    k.stats.defineStat({ id: OPEN_HAND_STAT, owner: OWNER, name: '輿論戰的開場手牌加值', base: () => 0, min: -3, max: 5 })
    // 一筆招、被動或開場的格式問題：opinion 自己回答（abilities 在內容載入之後把每個技能的輿論欄交過來）
    k.hooks.on('opinion.check', OWNER, ({ what, data }) => answerCheck(k, what, data))
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind({ kind: TOPIC_KIND_KIND, owner: OWNER, overridable: true, validate: topicKindProblems })
    k.content.defineKind({ kind: TOPIC_KIND, owner: OWNER, validate: topicProblems })
    k.content.defineKind({ kind: OPPONENT_KIND, owner: OWNER, validate: opponentProblems })
    k.content.defineKind({ kind: ACTION_KIND, owner: OWNER, overridable: true, validate: actionProblems })
    k.content.defineKind({ kind: CARD_KIND, owner: OWNER, overridable: true, validate: cardProblems })
    k.content.defineKind({ kind: CITY_KIND, owner: OWNER, overridable: true, validate: cityProblems })

    k.changes.register<{ op: string; war: War | null }>({
      op: WAR_OP, owner: OWNER,
      validate: (_s, c) => warProblems(c.war),
      apply(s, c) {
        if (c.war === null) delete s.ext[EXT]
        else s.ext[EXT] = { war: clone(c.war) }
      },
    })

    k.activity.define({
      kind: ACTIVITY, owner: OWNER, order: 50,
      active(state) {
        const w = readWar(state)
        return w && w.mode === 'solo' ? { id: w.id, label: `輿論戰進行中（${w.topic.name}）` } : null
      },
      allow: ['commit:opinion.'],
      reason: () => BUSY_REASON,
      start: (k2, state, setup, origin) => [startDraft(k2 as Kernel, state, setup as Parameters<typeof startDraft>[2], origin)],
    })
    // 委託副本的輿論面（face.opinion，M5-opinion-face）跑起來時，它的報告要放得進副本
    k.activity.allow('commission', 'commit:opinion.', OWNER)
  },

  // 資料裡寫 murmur 的：載入時當 whisper 收，這裡提醒（不擋）
  warnings(kernel) {
    const k = kernel as Kernel
    const out: string[] = []
    const note = (kind: string, id: string, where: string): void => {
      out.push(`${kind}/${id}：${where}寫的是 murmur，引擎當作 whisper（街上的耳語）收；請改寫成 whisper。`)
    }
    const hasMurmur = (o: unknown): boolean => typeof o === 'object' && o !== null && Object.hasOwn(o, 'murmur')
    const has = (kind: string): boolean => k.content.hasKind(kind)
    if (has(TOPIC_KIND)) {
      for (const e of k.content.list<ContentEntry>(TOPIC_KIND)) {
        if (hasMurmur(e.scores)) note(TOPIC_KIND, e.id as string, 'scores')
        if (e.target_cell === 'murmur') note(TOPIC_KIND, e.id as string, 'target_cell')
        if (e.your_start === 'murmur') note(TOPIC_KIND, e.id as string, 'your_start')
      }
    }
    if (has(OPPONENT_KIND)) {
      for (const e of k.content.list<ContentEntry>(OPPONENT_KIND)) {
        if (hasMurmur(e.cell_priority)) note(OPPONENT_KIND, e.id as string, 'cell_priority')
        const cells = ((e.signature as { effect?: { def_minus?: { cells?: unknown[] } } } | undefined)?.effect?.def_minus?.cells) ?? []
        if (cells.includes('murmur')) note(OPPONENT_KIND, e.id as string, 'signature.effect.def_minus.cells')
      }
    }
    if (has(TOPIC_KIND_KIND)) for (const e of k.content.list<ContentEntry>(TOPIC_KIND_KIND)) if (hasMurmur(e.scores)) note(TOPIC_KIND_KIND, e.id as string, 'scores')
    return out
  },
}

