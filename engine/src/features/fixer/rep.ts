// L6 功能 fixer 的街頭信譽規則（CORE_RULES 8.1 節、LIFE 1.3 節與第 9 節；2026-11-23 使用者定案；dev/adr/0017 M2 修 bug 批的補記）。
//
// 信譽 0～100，六階門檻 15／35／55／75／90。主角的「級」照階：無名、熟面孔 I 級；有號 II；搶手 III；頂尖 IV；傳說 V（core 的 repGrade）。
//   完成委託：同級 +2，評價 S 再 +1；高一級以上 +4（S 也 +1）；比主角低級的委託信譽不變（錢與歷練照給）。
//   失敗 −3（不分等級）；中途放棄 −5（暫定）。數字都在 fixer_rule（rep_same、rep_higher、rep_lower、rep_top、rep_failed、rep_abandon）。
//   非委託來源（事件、打工、街頭的小事、媒體的片）的正值：最多加到下一階門檻的前一分，不能跨階；負值照扣。這條夾值寫在信譽量表的定義
//   （repNonCommissionCeil；量表的 ceilOf），所以每一個走效果 rep 進來的來源都一樣，事件自己不用判斷；委託的結算把算好的量帶 final: true 繞過它。
// 純函式：讀狀態、回傳數字或變更。

import type { Change, GameState, Kernel } from '../../core'
import { REP_TIER_MIN, effectCtx, repGrade, repTierOf } from '../../core'
import type { Job, Rating } from './model'
import { fixerRules, gradeOf } from './model'

/** 非委託來源最多能把信譽加到多少：現在這一階門檻的下一階前一分（最高一階是 100）。信譽量表的 ceilOf 用它。 */
export function repNonCommissionCeil(rep: number): number {
  const tier = repTierOf(rep)
  return tier + 1 < REP_TIER_MIN.length ? REP_TIER_MIN[tier + 1]! - 1 : 100
}

export type RepRelation = 'higher' | 'same' | 'lower'

export interface RepGain {
  /** 這一件委託比主角現在的級高、同級、低 */
  relation: RepRelation
  /** 完成它信譽加多少（0 是不變） */
  amount: number
  /** 評價 S 的加成有沒有算進去 */
  top: boolean
}

/** 完成這件委託、評價 rating，信譽加多少（照主角現在的級）。畫面預告與入帳共用。 */
export function repGainOf(k: Kernel, state: GameState, job: Pick<Job, 'commission'>, rating: Rating): RepGain {
  const rules = fixerRules(k)
  const mine = repGrade(k, state)
  const theirs = gradeOf(job.commission)
  const relation: RepRelation = theirs > mine ? 'higher' : theirs === mine ? 'same' : 'lower'
  if (relation === 'lower') return { relation, amount: rules.rep_lower, top: false }
  const top = rating === 'S'
  return { relation, amount: (relation === 'higher' ? rules.rep_higher : rules.rep_same) + (top ? rules.rep_top : 0), top }
}

/**
 * 委託結算的信譽變更：量是算好的（final: true，不再被非委託來源的夾值管）。沒有人定義信譽、或量是 0 就沒有。
 * lines 是定案的結果那一行（效果自己的白話）。
 */
export function repChanges(k: Kernel, state: GameState, amount: number): { changes: Change[]; lines: string[] } {
  if (amount === 0 || !k.effects.has('rep')) return { changes: [], lines: [] }
  const res = k.effects.resolve([{ kind: 'rep', amount, final: true }], effectCtx(k, state, { source: 'builtin' }))
  return res.errors.length > 0 ? { changes: [], lines: [] } : { changes: res.changes, lines: res.lines }
}
