// L6 功能：感官擂台（LEWD_SYSTEM 第 6 節的表；EVENTS 4.7 節「擂台的邀約」；CORE_RULES 4.2 節過載；dev/adr/0019 P62、第十四節；dev/work/M4-venues.md）。
// 兩個人接上同一條線，比誰先過載：用戰鬥規則（現實戰場的一對一），雙方手上只有擂台發的一件神經武器，先過載的輸；可以押自己那一場。
// 場邊的下注、線上版、轉播、擂台的對手與邀約事件的內容是資料或之後的事，不在這裡。
//
// 接上核心的地方：
//   內容  arena_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_ARENA_RULES）；設施種類的欄位 arena: { grades, stake_max? }（facility_type；ready 時查格式）
//   條件  at_facility（問腳下是不是擂台；沒有人註冊就沒有擂台）
//   戰鬥  掛點 overload（第一次過載就分出勝負）、battle.result（自然分出的結果記輸贏）、onEnd（丟掉開打前的快照：輸了也不走戰敗的三選一）
//   掛點  activity.end（kind battle、origin.by arena：結算押的錢與豔名）、report.after（寫 arena.result）
//   狀態  state.ext.arena：{ wins, losses, announce }（形狀見 model.ts；只經由報告裡的 ext 變更寫）
// 報告：arena.enter（報名，帶 launch 開戰）、arena.result（帶觸發點 arena_result，where.won 是 'true' 或 'false'；輸的一方的後續交給事件與場景的 scene_gate）。
// 對外：arenaOptions、arenaBlock、enterBlock、enterProblems、enterQuote、enterDraft、arenaView、arenaRules、oddsOf、readArena。
//
// 不碰別的功能：和 work 不互相 import；豔名只經由效果 fame（用登錄表跑，沒有量表就不加）。

import type { ContentEntry, Feature, Kernel } from '../../core'
import { ContentError } from '../../core'
import { FACILITY_TYPE_KIND, OWNER, RULE_KIND, facilityFieldProblems, ruleProblems } from './model'
import { announceDraft, installBattle, onBattleEnd } from './settle'

export { arenaBlock, arenaOptions, arenaView, enterBlock, enterDraft, enterProblems, enterQuote, oddsOf } from './enter'
export type { ArenaOptions, ArenaQuote, ArenaRow, ArenaView, EnterOpts } from './enter'
export {
  DEFAULT_ARENA_RULES, ENTER_ACTION as ARENA_ENTER_ACTION, EXT as ARENA_EXT, FIELD_KEY as ARENA_FIELD, OWNER as ARENA_OWNER, RESULT_ACTION as ARENA_RESULT_ACTION,
  RESULT_POINT as ARENA_RESULT_POINT, RULE_KIND as ARENA_RULE_KIND, arenaHere, arenaRules, blankArena, readArena,
} from './model'
export type { Announce as ArenaAnnounce, ArenaFacility, ArenaOdds, ArenaRules, ArenaState, ArenaWeapon } from './model'

export const arenaFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    installBattle(k)
    k.hooks.on('activity.end', OWNER, ({ state, kind, origin, outcome }) => (kind === 'battle' ? onBattleEnd(k, state, origin, outcome) : undefined))
    k.hooks.on('report.after', OWNER, ({ state }) => {
      const draft = announceDraft(state)
      return draft ? [draft] : undefined
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { arena?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.arena !== undefined) problems.push(...facilityFieldProblems(t.arena).map((m) => `${FACILITY_TYPE_KIND}/${t.id}：${m}`))
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
