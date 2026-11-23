// 戰鬥結束時技能這邊要寫回去的：現金的差額（一筆變更）、人情的差額（寫回 actor.ext.favors）、
// 每件委託的次數與預備（寫回 actor.ext.abilities）。dev/adr/0015 E2、E3、E4。

import type { BattleState, Change, GameState } from '../../core'
import { FAVORS } from './format'
import { abilitiesOf } from './learn'
import type { AbilityState } from './types'
import { commissionKeyOf, favorPool } from './use'
import { broughtPrep, isRec } from './unitdata'
import { walletActor, walletOf } from './wallet'

export function endChanges(state: GameState, battle: BattleState): Change[] {
  const changes: Change[] = []
  const key = commissionKeyOf(battle)

  // 現金與人情是隊伍共用的一份（wallet.ts）：只算一次差額。現金扣隊伍的錢包；人情寫回主角名下
  const cash = walletOf(battle, 'cash')
  const cashSpent = cash ? Math.max(0, cash.max - cash.now) : 0
  const owner = walletActor(state, battle)
  const ownerActor = owner ? state.actors[owner] : undefined
  if (owner && ownerActor) {
    const before = isRec(ownerActor.ext.favors) ? ownerActor.ext.favors : {}
    const favors: Record<string, unknown> = { ...before }
    let favorChanged = false
    for (const f of FAVORS) {
      const pool = walletOf(battle, favorPool(f))
      if (pool && pool.now !== pool.max) {
        favors[f] = pool.now
        favorChanged = true
      }
    }
    if (favorChanged) changes.push({ op: 'actor.ext', id: owner, key: 'favors', value: favors })
  }

  for (const u of Object.values(battle.units)) {
    if (!u.actor) continue
    const actor = state.actors[u.actor]
    if (!actor) continue

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
