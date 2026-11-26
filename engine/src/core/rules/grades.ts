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

/**
 * 主角所在那一區的物價倍率（district 內容的 price_mult；沒有區、沒寫、不是大於 0 的數字是 1）。
 * 服務的價錢（診所的治療、心理治療、戒斷療程、向人學工藝）乘它（TRADE 第 3 節；M4 收尾修正批）：各功能照自己的規則欄位 district_price 決定乘不乘，
 * 不各自讀 district（功能之間不互相 import，倍率的讀法只有這一份）。
 */
export function areaPriceMult(k: Pick<RulesKernel, 'content'>, state: Pick<GameState, 'location'>): number {
  const id = state.location.district
  if (typeof id !== 'string' || !k.content.hasKind('district')) return 1
  const m = (k.content.get('district', id) as { price_mult?: unknown } | undefined)?.price_mult
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 1
}

/** 衍生數值的 id：主角的街頭信譽那一階接得到的委託等級（1～5）。由街頭信譽的功能註冊（M2）。 */
export const REP_GRADE_STAT = 'rep_grade'

/** 街頭信譽六階（CORE_RULES 第 8 節）：無名、熟面孔、有號、搶手、頂尖、傳說；括號裡是到那一階要的信譽值。 */
export const REP_TIERS = ['nobody', 'familiar', 'named', 'in_demand', 'top', 'legend'] as const
export type RepTier = (typeof REP_TIERS)[number]
export const REP_TIER_NAME: Record<RepTier, string> = { nobody: '無名', familiar: '熟面孔', named: '有號', in_demand: '搶手', top: '頂尖', legend: '傳說' }
/** 到每一階要的信譽值：0、15、35、55、75、90。 */
export const REP_TIER_MIN: readonly number[] = [0, 15, 35, 55, 75, 90]
/**
 * 六階對 I～V 級（LIFE 1.3 節，2026-11-22 定案）：最低兩階（無名、熟面孔）都是 I 級，之後每升一階升一級
 * （有號 II、搶手 III、頂尖 IV、傳說 V）。AI 給的錢的上限照這個對法（EVENTS 2.4 節）。
 */
export const REP_TIER_GRADE: readonly Grade[] = [1, 1, 2, 3, 4, 5]

/** 信譽值在第幾階（0～5）。 */
export function repTierOf(rep: number): number {
  let tier = 0
  REP_TIER_MIN.forEach((min, i) => { if (rep >= min) tier = i })
  return tier
}

/** 第幾階（0～5，超出的夾住）對到的委託等級。街頭信譽的功能用它註冊 rep_grade。 */
export function gradeOfRepTier(tier: number): Grade {
  return REP_TIER_GRADE[clamp(Math.floor(tier), 0, REP_TIER_GRADE.length - 1)]!
}

/**
 * 主角的街頭信譽那一階對應的委託等級（LIFE 1.3 節）。AI 給的錢的上限用它（EVENTS 2.4 節）。
 * 街頭信譽的功能還沒搬進來之前（沒有人註冊 rep_grade）一律是 I 級：無名。
 * 註冊的那個功能用 gradeOfRepTier(repTierOf(信譽值)) 算，對法只有這一份。
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
