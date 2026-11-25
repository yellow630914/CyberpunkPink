// L6 功能 lure：妖精的吻擴散階段的「替你做決定」（CYBERWARE 第 5 節；LURE_EVENTS「四、妖精的吻」的 wa_kiss_spread_choose；dev/work/M4-lure.md 總指揮補記）。
// 「剛發生一件帶成人場景的事件、或一次誘惑之後」，主角身上有某個流竄 AI 已經進到擴散階段的吻，就在那一份報告後面接一份 lure.kiss（system、沒有變更），
// 帶觸發點 kiss_choose（where: { ai, malware }）；事件資料掛在範圍 rogue_ai 的這個觸發點，由導演照事件的 where 與 requires 挑，事件的內容與選項（牠替你選、你收回來）是資料。
// 「剛發生」的兩種：報告標了 adult（成人場景或帶成人場景的事件），或報告裡有這個功能自己的 state.ext.lure 變更（一次蠱惑的選擇）。
// 牠的吻在牠的 filter 或 tag 被關掉時沉睡（和惡意韌體一致）：不發。看有沒有吻只經由條件 malware（沒有人註冊就不發）。
// 「傳給和你親近的人」不需要程式：擴散的階段觸發點（惡意韌體的 pulse）加既有的親密度條件與 flag 效果就寫得出來（見回報）。

import type { GameState, Kernel, Report, ReportDraft } from '../../core'
import { clone } from '../../core'
import { EXT, KISS_ACTION, KISS_POINT, MALWARE_CONDITION, allEntries, allowed } from './model'

/** 這份報告是「一個決定的時刻」：成人場景，或這個功能自己寫了 state.ext.lure。 */
const decisive = (report: Report): boolean => report.adult === true || report.changes.some((c) => c.op === 'ext' && c.key === EXT)

export function spreadAfter(k: Kernel, state: GameState, report: Report): ReportDraft[] | void {
  if (report.rewind || report.action === KISS_ACTION || !decisive(report)) return
  const pc = state.pc
  if (!pc || !state.actors[pc] || !k.conditions.kinds().includes(MALWARE_CONDITION)) return
  const ctx = { state, stats: k.stats, timeRules: k.timeRules, actor: pc }
  const triggers = allEntries(k)
    .filter((e) => e.kiss !== undefined && allowed(state, e) && k.conditions.test({ kind: MALWARE_CONDITION, id: e.kiss, stage: 2 }, ctx))
    .map((e) => ({ point: KISS_POINT, where: { ai: e.id, malware: e.kiss! } }))
  if (triggers.length === 0) return
  return [{
    kind: 'system', action: KISS_ACTION, location: clone(state.location), actor: pc, party: [], timeline: [], changes: [],
    outcome: { result: 'whisper', summary: '那個聲音搶在你前面開了口。' }, triggers,
  }]
}
