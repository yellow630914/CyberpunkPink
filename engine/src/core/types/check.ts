// L0 型別：檢定（CORE_RULES 第 3 節）。

import type { AttrId, SkillId } from './ids'

/** 成功程度四級：大成功、成功、失敗、大失敗。 */
export type Degree = 'critical' | 'success' | 'fail' | 'fumble'

/** 主持人的五種走向（GAME_DESIGN 第 10 節）：成功再看差距分成乾淨的「是」與「是，但是」。 */
export type Verdict = 'yes_and' | 'yes' | 'yes_but' | 'no_but' | 'no_and'

/** 擲骰的一項加值（紀錄裡看得到「骰 11 + 魅力 +1 + 交涉 +2」）。 */
export interface RollPart {
  label: string
  value: number
  /** 來源：attr、skill、situation、perk、condition…… */
  source?: string
}

export interface CheckRoll {
  dice: '1d20'
  /** 骰面 */
  natural: number
  parts: RollPart[]
  /** 骰面加所有加值 */
  total: number
  dc: number
  degree: Degree
  verdict: Verdict
  /** total − dc */
  margin: number
  attr?: AttrId
  skill?: SkillId
  /** 這一顆重擲過幾次（AI_TASKS 2.4 節：每次重擲都記一筆） */
  rerolls?: number
  /** 每一次重擲之前的骰面 */
  history?: number[]
}
