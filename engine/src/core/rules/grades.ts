// L4 規則核心：效果的上限要用的兩個等級，以及組出效果情境（EffectCtx）的共用函式。
// 每一條會結算效果的鏈都用 effectCtx() 組情境，兩個等級才不會各算各的。

import type { ActorId, Change, GameState, Grade } from '../types'
import { clamp } from '../util/sanitize'
import type { EffectCtx, EffectSource } from './effects'
import type { RulesKernel } from './kernel'

/** 這一區的等級。區的資料還沒搬進來之前一律是 I 級；有 district 內容之後讀它的 grade。 */
export function areaGrade(k: RulesKernel, state: GameState): Grade {
  const g = state.location.district ? k.content.get('district', state.location.district)?.grade : undefined
  return (typeof g === 'number' && g >= 1 && g <= 5 ? g : 1) as Grade
}

/** 衍生數值的 id：主角的街頭信譽那一階接得到的委託等級（1～5）。由街頭信譽的功能註冊（M2）。 */
export const REP_GRADE_STAT = 'rep_grade'

/**
 * 主角的街頭信譽那一階對應的委託等級（LIFE 1.3 節「信譽六階對應 I～V 級」）。AI 給的錢的上限用它（EVENTS 2.4 節）。
 * 街頭信譽的功能還沒搬進來之前（沒有人註冊 rep_grade）一律是 I 級：無名。
 */
export function repGrade(k: RulesKernel, state: GameState): Grade {
  if (!state.pc || !state.actors[state.pc] || !k.stats.hasStat(REP_GRADE_STAT)) return 1
  return clamp(k.stats.stat(state, state.pc, REP_GRADE_STAT), 1, 5) as Grade
}

export interface EffectCtxOpts {
  source: EffectSource
  /** 設定「玩家要求的結果也夾值」；沒給當開著 */
  clampAsked?: boolean
  /** 效果落在誰身上；沒給就是主角 */
  actor?: ActorId
  playerInput?: string
  combat?: boolean
  action?: { minutes: number; maxMinutes: number }
  tail?: Change[]
  /** 事件所在的要地的等級；沒給就用主角所在那一區的 */
  grade?: Grade
}

/** 組出效果的情境：兩個等級由這裡算。 */
export function effectCtx(k: RulesKernel, state: GameState, o: EffectCtxOpts): EffectCtx {
  return {
    state, actor: o.actor ?? state.pc ?? 'pc', grade: o.grade ?? areaGrade(k, state), repGrade: repGrade(k, state),
    source: o.source, clampAsked: o.clampAsked ?? true, content: k.content,
    ...(o.playerInput !== undefined ? { playerInput: o.playerInput } : {}),
    ...(o.combat ? { combat: true } : {}), ...(o.action ? { action: o.action } : {}), ...(o.tail ? { tail: o.tail } : {}),
  }
}
