// L4 規則核心：存檔規則表（MIGRATION A「存檔規則」；BALANCE 第 7 節；CHARACTER 5.6 節）。
// 難度只調敵人與 DC；核心只管 DC 的偏移，敵人的係數等 M1 的戰鬥再加。

import type { SaveRules } from '../types'
import { DEFAULT_RULES } from '../state/blank'
import { bool, clamp, int, isRecord, num, oneOf } from '../util/sanitize'

export const DIFFICULTIES = ['story', 'easy', 'normal', 'hard', 'legend', 'custom'] as const
/** 預設的五個難度的 DC 偏移（BALANCE 7.2 節）。 */
export const DIFFICULTY_DC_OFFSET: Record<Exclude<SaveRules['difficulty'], 'custom'>, number> = { story: -2, easy: -1, normal: 0, hard: 1, legend: 2 }
/** 自訂難度的 DC 偏移範圍（CORE_RULES 第 3 節：−4～+4）。 */
export const CUSTOM_DC_OFFSET_RANGE = [-4, 4] as const

/** 把外面來的存檔規則清乾淨：缺的補預設值，超出範圍的夾住。選了預設難度時 DC 偏移跟著難度走。 */
export function sanitizeRules(raw: unknown): SaveRules {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_RULES
  const difficulty = oneOf(r.difficulty, DIFFICULTIES, d.difficulty)
  return {
    difficulty,
    dcOffset: difficulty === 'custom' ? clamp(int(r.dcOffset, 0), CUSTOM_DC_OFFSET_RANGE[0], CUSTOM_DC_OFFSET_RANGE[1]) : DIFFICULTY_DC_OFFSET[difficulty],
    fastTravel: bool(r.fastTravel, d.fastTravel),
    billMult: clamp(num(r.billMult, d.billMult), 0, 2),
    defeatView: oneOf(r.defeatView, ['always', 'skippable', 'never'] as const, d.defeatView),
    defeatTakeGear: bool(r.defeatTakeGear, d.defeatTakeGear),
    defeatMoneyLoss: clamp(num(r.defeatMoneyLoss, d.defeatMoneyLoss), 0, 1),
    rosterDeath: bool(r.rosterDeath, d.rosterDeath),
    xpMult: clamp(num(r.xpMult, d.xpMult), 0.5, 2),
    startXp: Math.max(0, int(r.startXp, d.startXp)),
    startSkillPoints: Math.max(0, int(r.startSkillPoints, d.startSkillPoints)),
    startSkillMax: clamp(int(r.startSkillMax, d.startSkillMax), 0, 6),
    startPerkPoints: Math.max(0, int(r.startPerkPoints, d.startPerkPoints)),
    startCyberPoints: Math.max(0, int(r.startCyberPoints, d.startCyberPoints)),
    startMoney: Math.max(0, int(r.startMoney, d.startMoney)),
  }
}
