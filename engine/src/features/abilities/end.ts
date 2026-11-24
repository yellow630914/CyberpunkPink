// 戰鬥結束時技能這邊要寫回去的：現金的差額（一筆變更）、人情用掉幾個（每個一筆 favor.spend）、
// 每件委託的次數與預備（寫回 actor.ext.abilities）。dev/adr/0015 E2、E3、E4；M2-favors。

import type { BattleKernel, BattleState, Change, GameState } from '../../core'
import { modeOf } from '../../core'
import { FAVORS } from './format'
import { abilitiesOf } from './learn'
import type { AbilityState } from './types'
import { commissionKeyOf, favorCountOf, favorPool } from './use'
import { broughtPrep } from './unitdata'
import { walletActor, walletOf } from './wallet'

/**
 * 結束時的變更。k 給了而且有人註冊 favor.spend（人情的功能裝著）時，人情池用掉幾個就發幾筆 `favor.spend { dir: 'owed_to_pc', size }`
 * （每筆用掉那個大小最早記下的一筆；不超過現在實際還有的個數）；沒給 k 或沒有人註冊就不發（人情沒裝的一局，池是 0 本來就用不了）。
 */
export function endChanges(state: GameState, battle: BattleState, k?: Pick<BattleKernel, 'stats' | 'changes'> & { content?: BattleKernel['content'] }): Change[] {
  const changes: Change[] = []
  // 預備只在現實戰鬥帶進來（看戰場的 layer；沒給核心時只認核心自帶的 meat）
  const meat = k?.content ? modeOf(k.content, battle.mode)?.layer === 'meat' : battle.mode === 'meat'
  const key = commissionKeyOf(battle)

  // 現金與人情是隊伍共用的一份（wallet.ts）：只算一次差額。現金扣隊伍的錢包；人情用掉的記在主角名下（欠你的）
  const cash = walletOf(battle, 'cash')
  const cashSpent = cash ? Math.max(0, cash.max - cash.now) : 0
  const owner = walletActor(state, battle)
  if (k && owner && owner === state.pc && k.changes.get('favor.spend')) {
    for (const f of FAVORS) {
      const pool = walletOf(battle, favorPool(f))
      if (!pool) continue
      const used = Math.min(Math.max(0, pool.max - pool.now), favorCountOf(k, state, f))
      for (let i = 0; i < used; i++) changes.push({ op: 'favor.spend', dir: 'owed_to_pc', size: f })
    }
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
    const brought = meat ? broughtPrep(u) : []
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
