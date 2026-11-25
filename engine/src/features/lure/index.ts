// L6 功能：蠱惑（流竄 AI 的接觸；EVENTS 4.8 節；LURE_EVENTS 開頭到「一、蠱惑」的共通規則；CORE_RULES 4.3 節「流竄 AI」；LEWD_SYSTEM 1.1 節、第 9 節；dev/adr/0019 第六節與 P22～P24；dev/work/M4-lure.md）。
// 蠱惑事件本身是事件的資料，照舊由導演從範圍 rogue_ai 挑（登入 15%、進子網的一層 10%、長休醒來 15%、冷卻 24 小時、一天一件是範圍的資料）；
// 這個功能只做導演不知道的那一段：誰可以來、順著牠／拒絕／問牠是誰各自留下什麼、累計與「牠的事」。
//
// 接上核心的地方：
//   內容  rogue_ai（{ name, tag?, axis?, filter, lore: { origin, want, ties, home }, kiss? }）、lure_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_LURE_RULES）
//   條件  lure_open { ai }、lure_mode { ai, mode: first | gated | service }、lure_count { ai, follow_min?, follow_max? }（effects.ts）
//   效果  lure { ai, choice: follow | refuse | ask }（ai: false）；用別人登記的：tendency、malware（用登錄表跑，查不到略過）
//   掛點  report.after：妖精的吻擴散階段的「替你做決定」，在一個決定的時刻之後接一份 lure.kiss，帶觸發點 kiss_choose（spread.ts）
//   狀態  state.ext.lure：Record<流竄 AI 的 id, { follow, refused, asked, lore: 已揭開的格, last? }>；旗標 lure_clue:<ai>、ai_lore:<ai>:<格>
// 檢定標籤：蠱惑事件的檢定要帶 resist_lure（沉溺的分段加減看它）——導演擲檢定時帶事件自己的 tags，所以事件資料的 tags 要寫 resist_lure（見回報）。
// 讀的：k.content、k.conditions（malware，看有沒有牠的吻）、k.effects（tendency、malware）、actor.ext.tendency（只認格式）、角色的 sink（真正的沉溺，不是 sink_shown）、旗標。
// 對外：lureOf、lureView、candidates、lureRules、lurePlan。
//
// 沒有做：任何一個流竄 AI 與事件的內容；觸發點（登入、進子網一層、長休醒來都有人發）；過牆、群落、任務線、親密度（M6）；
//       「自由行動與成人場景裡牠插進一個選項、甚至替你選」只做到事件這一端（觸發點 kiss_choose）——在那兩種視窗裡直接插選項需要它們開掛點。

import type { ContentEntry, Feature, Kernel } from '../../core'
import { ContentError } from '../../core'
import { installEffects } from './effects'
import { KIND, OWNER, RULE_KIND, entryProblems, ruleProblems } from './model'
import type { RogueAiEntry } from './model'
import { spreadAfter } from './spread'

export { lurePlan } from './effects'
export type { LurePlan } from './effects'
export { candidates, lureView } from './view'
export type { Candidate, LureViewRow } from './view'
export {
  CHOICES as LURE_CHOICES, DEFAULT_LURE_RULES, EXT as LURE_EXT, KIND as LURE_KIND, KISS_ACTION as LURE_KISS_ACTION, KISS_POINT as LURE_KISS_POINT, LORE_SLOTS as LURE_LORE_SLOTS,
  MODES as LURE_MODES, RULE_KIND as LURE_RULE_KIND, clueFlag as lureClueFlag, loreFlag as lureLoreFlag, lureOf, lureRules,
} from './model'
export type { Choice as LureChoice, LoreSlot as LureLoreSlot, LureRow, LureRules, Mode as LureMode, RogueAiEntry } from './model'

export const lureFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: KIND, owner: OWNER, validate: entryProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    installEffects(k)
    k.hooks.on('report.after', OWNER, ({ state, report }) => spreadAfter(k, state, report))
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    if (k.content.hasKind(KIND) && k.content.hasKind('malware')) {
      for (const e of k.content.list<ContentEntry & Partial<RogueAiEntry>>(KIND)) {
        if (e.kiss !== undefined && !k.content.has('malware', e.kiss)) problems.push(`${KIND}/${e.id}：kiss 查不到 ${e.kiss} 這個惡意韌體`)
      }
    }
    if (k.content.hasKind(KIND) && k.content.hasKind('tendency_tag')) {
      for (const e of k.content.list<ContentEntry & Partial<RogueAiEntry>>(KIND)) {
        if (e.tag !== undefined && !k.content.has('tendency_tag', e.tag)) problems.push(`${KIND}/${e.id}：tag 查不到 ${e.tag} 這個傾向標籤`)
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}

export { OWNER as LURE_OWNER }
