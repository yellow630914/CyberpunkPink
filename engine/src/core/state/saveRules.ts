// L3 狀態核心：存檔規則表（MIGRATION A「存檔規則」；BALANCE 第 7 節；CHARACTER 5.6 節）與內容篩選（LEWD_SYSTEM 第 9 節）。
// 難度只調敵人與 DC：DC 的偏移（dcOffset）與敵人的係數（enemyCoef，BALANCE 7.2 節）。
// 放在狀態核心：rules 變更要用 sanitizeRules 驗值（提交得進去的規則，存檔再讀檔要一模一樣）。

import type { EnemyCoef, EnemyCoefTable, SaveRules } from '../types'
import { clone } from '../util/clone'
import { bool, clamp, int, isId, isRecord, num, oneOf } from '../util/sanitize'
import { DEFAULT_RULES } from './blank'

export const DIFFICULTIES = ['story', 'easy', 'normal', 'hard', 'legend', 'custom'] as const
/** 預設的五個難度的 DC 偏移（BALANCE 7.2 節）。 */
export const DIFFICULTY_DC_OFFSET: Record<Exclude<SaveRules['difficulty'], 'custom'>, number> = { story: -2, easy: -1, normal: 0, hard: 1, legend: 2 }
/** 自訂難度的 DC 偏移範圍（CORE_RULES 第 3 節：−4～+4）。 */
export const CUSTOM_DC_OFFSET_RANGE = [-4, 4] as const

const coef = (hp: number, dmg: number, load: number): EnemyCoef => ({ hp, dmg, load })
const table = (boss: EnemyCoef, minions: EnemyCoef): EnemyCoefTable => ({ boss, minions: [{ ...minions }, { ...minions }, { ...minions }] })
/**
 * 預設的五個難度的敵人係數（BALANCE 7.2 節）：首領一組，雜兵與精英一組（三段都用同一個數字；分段只留給自訂）。
 * 生命／傷害／感載上限。傷害乘在位階的傷害倍率之後，對生命與感載的傷害都算。
 */
export const DIFFICULTY_ENEMY_COEF: Record<Exclude<SaveRules['difficulty'], 'custom'>, EnemyCoefTable> = {
  story: table(coef(0.6, 0.5, 0.6), coef(0.6, 0.4, 0.6)),
  easy: table(coef(0.85, 0.8, 0.85), coef(0.85, 0.75, 0.85)),
  normal: table(coef(1, 1, 1), coef(1, 1, 1)),
  hard: table(coef(1.15, 1.35, 1.15), coef(1.15, 1.35, 1.15)),
  legend: table(coef(1.3, 1.5, 1.3), coef(1.3, 1.7, 1.3)),
}
/** 自訂難度每一格係數的範圍（BALANCE 7.3 節；tools/balance/sim.py 的 CUSTOM_COEF）。 */
export const CUSTOM_COEF_RANGE = [0.25, 5] as const
/** 敵人的等級在哪一段：低（I～II）0、中（III）1、高（IV～V）2。 */
export const COEF_BAND_OF_GRADE: readonly number[] = [0, 0, 1, 2, 2]

function sanitizeCoef(raw: unknown, fallback: EnemyCoef): EnemyCoef {
  const r = isRecord(raw) ? raw : {}
  const one = (v: unknown, d: number) => Math.round(clamp(num(v, d), CUSTOM_COEF_RANGE[0], CUSTOM_COEF_RANGE[1]) * 100) / 100
  return { hp: one(r.hp, fallback.hp), dmg: one(r.dmg, fallback.dmg), load: one(r.load, fallback.load) }
}

function sanitizeCoefTable(raw: unknown): EnemyCoefTable {
  const r = isRecord(raw) ? raw : {}
  const d = DIFFICULTY_ENEMY_COEF.normal
  const m = Array.isArray(r.minions) ? r.minions : []
  return { boss: sanitizeCoef(r.boss, d.boss), minions: [sanitizeCoef(m[0], d.minions[0]), sanitizeCoef(m[1], d.minions[1]), sanitizeCoef(m[2], d.minions[2])] }
}

/** 這個敵人（等級、是不是首領）在這份存檔規則下的係數。 */
export function enemyCoefFor(rules: Pick<SaveRules, 'enemyCoef'>, grade: number, boss: boolean): EnemyCoef {
  return boss ? rules.enemyCoef.boss : rules.enemyCoef.minions[COEF_BAND_OF_GRADE[clamp(Math.floor(grade), 1, 5) - 1]!]!
}

/**
 * 內容篩選的標籤：「身體的私密描寫」（建角的私處與角色的成人分頁；DATA 第 8 節的 look.private）。
 * DATA 第 1 節的標籤表還沒有這一個的 id，這是暫定的名字（dev/adr/0009）。
 */
export const CONTENT_TAG_INTIMATE_BODY = 'intimate_body'

/** 這個標籤的內容現在開著嗎（沒有被玩家關掉）。 */
export function contentAllowed(rules: Pick<SaveRules, 'contentOff'>, tag: string): boolean {
  return !rules.contentOff.includes(tag)
}

/** 把外面來的存檔規則清乾淨：缺的補預設值，超出範圍的夾住。選了預設難度時 DC 偏移與敵人的係數跟著難度走。 */
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
    enemyCoef: difficulty === 'custom' ? sanitizeCoefTable(r.enemyCoef) : clone(DIFFICULTY_ENEMY_COEF[difficulty]),
    defeatMoneyLoss: clamp(num(r.defeatMoneyLoss, d.defeatMoneyLoss), 0, 1),
    // 金額的上限：null 與沒寫是不設上限；壞掉的值（不是有限的數字）回到預設（不設上限），不是 0；負數夾成 0
    defeatMoneyCap: Number.isNaN(num(r.defeatMoneyCap, Number.NaN)) ? d.defeatMoneyCap : Math.max(0, Math.round(num(r.defeatMoneyCap))),
    heavyWounds: bool(r.heavyWounds, d.heavyWounds),
    rosterDeath: bool(r.rosterDeath, d.rosterDeath),
    xpMult: clamp(num(r.xpMult, d.xpMult), 0.5, 2),
    startXp: Math.max(0, int(r.startXp, d.startXp)),
    startSkillPoints: Math.max(0, int(r.startSkillPoints, d.startSkillPoints)),
    startSkillMax: clamp(int(r.startSkillMax, d.startSkillMax), 0, 6),
    startPerkPoints: Math.max(0, int(r.startPerkPoints, d.startPerkPoints)),
    startCyberPoints: Math.max(0, int(r.startCyberPoints, d.startCyberPoints)),
    startMoney: Math.max(0, int(r.startMoney, d.startMoney)),
    contentOff: Array.isArray(r.contentOff) ? [...new Set(r.contentOff.filter(isId))].sort() : [],
  }
}
