// 戰鬥結束時技能這邊要寫回去的：現金的差額（一筆變更）、人情的差額（寫回 actor.ext.favors）、
// 每件委託的次數與預備（寫回 actor.ext.abilities）。dev/adr/0015 E2、E3、E4。

import type { BattleState, Change, GameState } from '../../core'
import { FAVORS } from './format'
import { abilitiesOf } from './learn'
import type { AbilityState } from './types'
import { commissionKeyOf, favorPool } from './use'
import { broughtPrep, isRec } from './unitdata'

export function endChanges(state: GameState, battle: BattleState): Change[] {
  const changes: Change[] = []
  const key = commissionKeyOf(battle)
  let cashSpent = 0
  for (const u of Object.values(battle.units)) {
    if (!u.actor) continue
    const actor = state.actors[u.actor]
    if (!actor) continue

    // 現金是隊伍的錢包：每個人花掉的加起來扣一次（池的上限就是開打時的數字）
    const cash = u.pools.cash
    if (cash) cashSpent += Math.max(0, cash.max - cash.now)

    // 人情：池剩下的就是現在有的
    const before = isRec(actor.ext.favors) ? actor.ext.favors : {}
    const favors: Record<string, unknown> = { ...before }
    let favorChanged = false
    for (const f of FAVORS) {
      const pool = u.pools[favorPool(f)]
      if (pool && pool.now !== pool.max) {
        favors[f] = pool.now
        favorChanged = true
      }
    }
    if (favorChanged) changes.push({ op: 'actor.ext', id: u.actor, key: 'favors', value: favors })

    // 每件委託的次數、預備
    const mine = abilitiesOf(state, u.actor)
    let next: AbilityState = mine
    const used = Object.entries(u.uses).filter(([id, n]) => id.startsWith('commission:') && n > 0).map(([id, n]) => [id.slice('commission:'.length), n] as const)
    const old = mine.commission?.[key] ?? {}
    if (used.some(([id, n]) => old[id] !== n)) next = { ...next, commission: { ...mine.commission, [key]: { ...old, ...Object.fromEntries(used) } } }
    const brought = battle.mode === 'meat' ? broughtPrep(u) : []
    if (brought.length && mine.prepared?.length) {
      const prepared = mine.prepared
        .filter((p) => !(p.scope === 'next_battle' && brought.includes(p.id)))
        .map((p) => (p.scope === 'commission' && p.key === undefined && brought.includes(p.id) ? { ...p, key } : p))
      next = { ...next, prepared }
    }
    if (next !== mine) changes.push({ op: 'actor.ext', id: u.actor, key: 'abilities', value: next })
  }
  if (cashSpent > 0 && state.money.cash > 0) changes.push({ op: 'cash', delta: -Math.min(cashSpent, state.money.cash) })
  return changes
}
