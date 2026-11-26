// L6 功能 scene：「有沒有人在看」（M5-live 第 9 項；dev/adr/0020 M4 對帳 D2、V58）。
// 單人場景開場時由發起的人給 audience（開場存進狀態的值不改）；開場之後才開播，場景不知道。所以讀的時候問：開場給的是 true，
// 或條件 live_on 有人註冊而且現在成立（直播進行中）。scene 不 import live，只問條件；沒裝直播的局條件不存在，就只看開場給的。
// 說話（「沒有人在聽。」）、要有人在看的技能、共鳴的 watched、場景結束結果的 audience、畫面的 audience 都問這一個。

import type { GameState, Kernel } from '../../core'

/** 這一場現在有沒有人在看。s 是場景的狀態（唯讀）。 */
export function watchedNow(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, s: { audience?: boolean }): boolean {
  if (s.audience === true) return true
  return k.conditions.kinds().includes('live_on') && k.conditions.test({ kind: 'live_on' }, { state, stats: k.stats, timeRules: k.timeRules })
}
