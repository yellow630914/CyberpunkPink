// L6 裝備：重量與負重（EQUIPMENT 第 7 節）。
//   carry_load  身上的總重量：穿著的每一件、攜帶格的武器、戴著的飾品、快取格（物品的 weight；成品是核心 productOf 的 weight）。
//   carry_cap   負重的上限 ＝ gear_rule 的 carry_base ＋ 體格 × carry_per_body。義體的致動器之後用被動效果加這個衍生數值（{ stat: 'carry_cap' }）。
//   超重        carry_load 大於 carry_cap：經 k.passives（來源 gear）給迴避 over_evade、帶 stealth 標籤的檢定 over_stealth、換位 move_ap +over_move_ap
//               （只在現實的戰場算：內海的化身不背重量）。超重不影響行動點的回復。

import type { ActorId, GameState, ItemEntry, Kernel, PassiveEffect } from '../../core'
import { CARRY_SLOTS } from '../../core'
import { gearOf, productOfStack, stackOf, wornPieces } from './model'
import { gearRules } from './rules'

export const LOAD_STAT = 'carry_load'
export const CAP_STAT = 'carry_cap'

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** 身上的總重量（不含被動效果；沒有這個人是 0）。 */
export function carryLoadOf(k: Kernel, state: GameState, actor: ActorId): number {
  if (!state.actors[actor]) return 0
  const gear = gearOf(state, actor)
  const itemWeight = (id: string): number => finite(k.content.get<ItemEntry>('item', id)?.weight)
  let total = 0
  for (const p of wornPieces(k, state, gear)) total += finite(productOfStack(k, p.stack)?.weight)
  for (const slot of CARRY_SLOTS) {
    const uid = gear.carry[slot]
    const stack = uid ? stackOf(state, uid) : undefined
    const info = productOfStack(k, stack)
    if (info?.bp.kind === 'weapon') total += finite(info.weight)
  }
  for (const id of Object.values(gear.acc)) total += itemWeight(id as string)
  for (const q of gear.quick) total += itemWeight(q.item) * q.qty
  return total
}

/** 負重的基礎（體格用有效屬性；之後的加減走衍生數值 carry_cap 的 provider 與被動效果）。 */
export function carryCapBase(k: Kernel, state: GameState, actor: ActorId): number {
  if (!state.actors[actor]) return 0
  const rules = gearRules(k)
  return rules.carry_base + k.stats.effectiveAttr(state, actor, 'body') * rules.carry_per_body
}

/** 超重了嗎（身上的總重量超過負重的上限）。 */
export function overweight(k: Kernel, state: GameState, actor: ActorId): boolean {
  if (!state.actors[actor]) return false
  return k.stats.stat(state, actor, LOAD_STAT) > k.stats.stat(state, actor, CAP_STAT)
}

// 同一個人正在算超重的時候（上限要讀體格，體格又會問被動效果）不再往下算：回傳空的
const computing = new Set<ActorId>()

/** 超重時的被動效果（來源 gear）。 */
export function weightPassives(k: Kernel, state: GameState, actor: ActorId): PassiveEffect[] {
  if (computing.has(actor) || !state.actors[actor]?.ext.gear) return []
  computing.add(actor)
  try {
    if (!overweight(k, state, actor)) return []
  } finally {
    computing.delete(actor)
  }
  const rules = gearRules(k)
  const label = '超重'
  const out: PassiveEffect[] = []
  if (rules.over_evade !== 0) out.push({ mod: 'evade', amount: rules.over_evade, layer: 'meat', label })
  if (rules.over_stealth !== 0) out.push({ check: { tags: ['stealth'] }, amount: rules.over_stealth, label })
  if (rules.over_move_ap !== 0) out.push({ mod: 'move_ap', amount: rules.over_move_ap, layer: 'meat', label })
  return out
}
