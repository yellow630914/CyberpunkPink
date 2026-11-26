// L4 規則核心：檢定（CORE_RULES 第 3 節）。1d20 + mod(屬性) + 基本功等級 + 情境修正，對 DC。
// 成功程度的算法照搬 ElondiaRPG 的 checks.ts，門檻換成這邊的：超過 5 大成功、低於 5 大失敗、自然 20 與自然 1 寫死。

import type { ActorId, AttrId, CheckRoll, Degree, GameState, RollPart, SaveRules, SkillId, Verdict } from '../types'
import { deriveRng } from '../util/rng'
import type { StatRegistry } from './stats'
import type { CheckCtx } from './stats'

/** DC 的階梯：容易、普通、困難、極難、傳說、超凡。 */
export const DC_TIERS = { easy: 10, normal: 13, hard: 16, extreme: 19, legendary: 22, mythic: 25 } as const
export type DcTier = keyof typeof DC_TIERS
export const DC_LADDER: readonly number[] = Object.values(DC_TIERS)
/** 超過 DC 這麼多是大成功，低於這麼多是大失敗。 */
export const CRIT_MARGIN = 5
/** 成功再看差距：超過 DC 不到這麼多是「是，但是」。 */
export const CLEAN_MARGIN = 3
/** 協力：隊友有同一項基本功 2 級以上，+2。 */
export const ASSIST_MIN_SKILL = 2
export const ASSIST_BONUS = 2

/** 調整值：（屬性 − 10）÷ 2，無條件捨去。 */
export function attrMod(value: number): number {
  return Math.floor((value - 10) / 2)
}

export function computeDegree(natural: number, total: number, dc: number): Degree {
  if (natural === 20) return 'critical'
  if (natural === 1) return 'fumble'
  if (total >= dc + CRIT_MARGIN) return 'critical'
  if (total <= dc - CRIT_MARGIN) return 'fumble'
  return total >= dc ? 'success' : 'fail'
}

/**
 * 一次檢定過關（成功或大成功）的機率：加值（擲骰面以外的合計）已定，1d20 每一面各 1/20，自然 20 一定過、自然 1 一定不過（報價的 chance 用；
 * 和 rollCheck 真的擲出來的是同一套 computeDegree）。
 */
export function checkPassChance(bonus: number, dc: number): number {
  let ok = 0
  for (let natural = 1; natural <= 20; natural++) {
    const degree = computeDegree(natural, natural + bonus, dc)
    if (degree === 'success' || degree === 'critical') ok++
  }
  return ok / 20
}

/** 主持人的走向：大成功＝是，而且；成功差距 3 以上＝是；不到 3＝是，但是；失敗＝不，但是；大失敗＝不，而且。 */
export function verdictOf(degree: Degree, margin: number): Verdict {
  if (degree === 'critical') return 'yes_and'
  if (degree === 'fumble') return 'no_and'
  if (degree === 'fail') return 'no_but'
  return margin >= CLEAN_MARGIN ? 'yes' : 'yes_but'
}

export const DEGREE_NAME: Record<Degree, string> = { critical: '大成功', success: '成功', fail: '失敗', fumble: '大失敗' }
export const VERDICT_NAME: Record<Verdict, string> = { yes_and: '是，而且', yes: '是', yes_but: '是，但是', no_but: '不，但是', no_and: '不，而且' }

/** 把任何數字靠到階梯上最近的一檔（一樣近時取低的）。 */
export function snapToLadder(dc: number): number {
  return DC_LADDER.reduce((best, x) => (Math.abs(x - dc) < Math.abs(best - dc) ? x : best), DC_LADDER[0]!)
}

/** 寫成檔位的 DC 加上難度的偏移（BALANCE 7.2 節：先在階梯上取檔，再加偏移）。 */
export function dcFor(tierOrDc: DcTier | number, rules: Pick<SaveRules, 'dcOffset'>): number {
  const base = typeof tierOrDc === 'number' ? tierOrDc : DC_TIERS[tierOrDc]
  return base + rules.dcOffset
}

export interface CheckInput {
  natural: number
  parts: RollPart[]
  dc: number
  attr?: AttrId
  skill?: SkillId
}

/** 用給定的骰面組出一次檢定的結果（純函式）。值是 0 的加值不記。 */
export function makeCheck(input: CheckInput): CheckRoll {
  const parts = input.parts.filter((p) => p.value !== 0)
  const total = input.natural + parts.reduce((s, p) => s + p.value, 0)
  const degree = computeDegree(input.natural, total, input.dc)
  const margin = total - input.dc
  return {
    dice: '1d20', natural: input.natural, parts, total, dc: input.dc, degree, verdict: verdictOf(degree, margin), margin,
    ...(input.attr ? { attr: input.attr } : {}), ...(input.skill ? { skill: input.skill } : {}),
  }
}

export interface RollCheckInput {
  actor: ActorId
  attr: AttrId
  skill?: SkillId
  dc: number
  /** 這顆骰子的用途：同一個狀態、同一個用途、同一個重擲次數，骰面一定一樣 */
  purpose: string
  reroll?: number
  /** 情境修正（呼叫的人自己算好的那幾項） */
  situation?: RollPart[]
  /** 情境的標籤，給特質與狀態的修正看 */
  tags?: string[]
  target?: ActorId
}

/** 擲一次檢定。不改狀態：骰面從存檔的亂數狀態導出，游標在報告提交時才往前。 */
export function rollCheck(stats: StatRegistry, state: GameState, input: RollCheckInput): CheckRoll {
  const actor = state.actors[input.actor]
  if (!actor) throw new Error(`沒有 ${input.actor} 這個角色`)
  const natural = deriveRng(state.rng, input.purpose, input.reroll ?? 0).int(1, 20)
  const ctx: CheckCtx = { attr: input.attr, skill: input.skill, tags: input.tags ?? [], target: input.target }
  return makeCheck({ natural, parts: checkParts(stats, state, input.actor, ctx, input.situation), dc: input.dc, attr: input.attr, skill: input.skill })
}

/** 一次檢定的所有加值：屬性的調整值（讀有效屬性）、基本功等級、登記的修正、情境。 */
export function checkParts(stats: StatRegistry, state: GameState, actorId: ActorId, ctx: CheckCtx, situation: RollPart[] = []): RollPart[] {
  const actor = state.actors[actorId]
  if (!actor) throw new Error(`沒有 ${actorId} 這個角色`)
  const parts: RollPart[] = [{ label: stats.attrName(ctx.attr), value: attrMod(stats.effectiveAttr(state, actorId, ctx.attr)), source: 'attr' }]
  if (ctx.skill) parts.push({ label: stats.skillName(ctx.skill), value: actor.skills[ctx.skill] ?? 0, source: 'skill' })
  parts.push(...stats.checkModifiers(state, actorId, ctx), ...situation)
  return parts
}
