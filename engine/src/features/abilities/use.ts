// 消耗與次數：行動點、RAM、現金、人情、每回合／每場／每件委託的次數、共用次數的組。
// 規格：dev/work/M1b-skill-format.md 第一節；dev/adr/0015 E1～E3。
// 錢與人情是池（pools.cash、pools.favor_small／favor_mid／favor_big）：行動的 cost() 把它們一起回傳，核心照池檢查與扣；
// 戰鬥結束時差額寫回（end.ts）。每件委託的次數記在 unit.uses['commission:<技能 id>']，開打時讀進來、結束時寫回。

import type { BattleRun, BattleState, BattleUnit, BattleView } from '../../core'
import { amount } from '../../core'
import { FAVORS } from './format'
import { isRec, tierIn } from './unitdata'
import type { AbilityEntry, AbilityUse } from './types'

/** 這一組消耗：直接寫的，或照戰場分的 meat 那一組（這一張只讀 meat）。 */
export function useOf(ab: Pick<AbilityEntry, 'use'>): AbilityUse {
  const u = ab.use
  if (!u) return {}
  if ('meat' in u || 'net' in u || 'opinion' in u) return u.meat ?? {}
  return u
}

const poolCost = (u: AbilityUse): boolean => u.ram !== undefined || u.ram_all_min !== undefined || u.cash !== undefined || u.favor !== undefined

export type Cost = { ap: number; [pool: string]: number }

/** 花掉全部 RAM 的技能：花費算出來的當下記下花了多少（核心先問花費、再扣、再做行動，做的時候池已經空了）。 */
const ramSpent = new WeakMap<BattleUnit, number>()
export const spentRam = (u: BattleUnit): number => ramSpent.get(u) ?? 0

/** 一個技能要花的：行動點（沒寫行動點、也沒寫別的池時是 1，和舊的一樣）、RAM、現金、人情。 */
export function costOf(view: BattleView, u: BattleUnit, ab: AbilityEntry): Cost {
  const use = useOf(ab)
  const cost: Cost = { ap: use.ap ?? (poolCost(use) ? 0 : 1) }
  if (use.ram) cost.ram = use.ram
  if (use.ram_all_min !== undefined) {
    const now = u.pools.ram?.now ?? 0
    cost.ram = now
    ramSpent.set(u, now)
  }
  if (use.cash !== undefined) {
    const v = Math.max(0, Math.round(amount({ run: view as unknown as BattleRun, user: u, n: { tier: tierIn(u, ab.path) } }, use.cash)))
    if (v) cost.cash = v
  }
  if (use.favor) cost[`favor_${use.favor}`] = 1
  return cost
}

const groupKey = (g: string): string => `turn:group:${g}`
export const commissionUse = (id: string): string => `commission:${id}`

/** 這個技能現在用不了的原因（次數類的）。錢與行動點不夠由核心列。 */
export function usageBlocks(view: Pick<BattleView, 'battle'>, u: BattleUnit, ab: AbilityEntry): string[] {
  const use = useOf(ab)
  const out: string[] = []
  if (use.per_fight !== undefined && (u.uses[ab.id] ?? 0) >= use.per_fight) out.push('這一場已經用過了。')
  if (use.per_commission !== undefined && (u.uses[commissionUse(ab.id)] ?? 0) >= use.per_commission) out.push(`這件委託的次數用完了（每件委託 ${use.per_commission} 次）。`)
  if (use.first_round && view.battle.round !== 1) out.push('只能在第一回合用。')
  if (use.not_first_round && view.battle.round === 1) out.push('第一回合不能用。')
  if (use.per_turn !== undefined) {
    if (use.group !== undefined) {
      const n = u.uses[groupKey(use.group)] ?? 0
      if (n >= use.per_turn) out.push(`這一回合「${use.group}」這一組的技能已經用了 ${n} 次，不能再用。`)
    } else if ((u.uses[`turn:${ab.id}`] ?? 0) >= use.per_turn) out.push('這一回合已經用過了。')
  }
  if (use.ram_all_min !== undefined) {
    const now = u.pools.ram?.now ?? 0
    if (now < use.ram_all_min) out.push(`要有 ${use.ram_all_min} 點以上的 RAM 才能用（現在 ${now} 點）。`)
  }
  return out
}

/** 用掉一次：記每場、每回合（同一組的合起來記）、每件委託的次數。 */
export function bumpUses(u: BattleUnit, ab: AbilityEntry): void {
  const use = useOf(ab)
  if (use.per_fight !== undefined) u.uses[ab.id] = (u.uses[ab.id] ?? 0) + 1
  if (use.per_turn !== undefined) {
    const key = use.group !== undefined ? groupKey(use.group) : `turn:${ab.id}`
    u.uses[key] = (u.uses[key] ?? 0) + 1
  }
  if (use.per_commission !== undefined) u.uses[commissionUse(ab.id)] = (u.uses[commissionUse(ab.id)] ?? 0) + 1
}

// ---- 池 ----

/** 這場戰鬥算哪一件委託：開戰設定的 origin.ext.commission；沒有就是這一場自己（各算一件）。 */
export const commissionKeyOf = (b: Pick<BattleState, 'id' | 'origin'>): string => {
  const v = b.origin.ext?.commission
  return typeof v === 'string' || typeof v === 'number' ? String(v) : b.id
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)

/** 人情的池名。 */
export const favorPool = (f: (typeof FAVORS)[number]): string => `favor_${f}`

/**
 * 單位剛組好、有角色的：建現金與三種人情的池（已經有的不動），把這件委託已經用過的次數讀進 uses。
 * 現金是隊伍的錢包（state.money.cash）；人情讀 actor.ext.favors（沒有是 0）。
 */
export function setupResources(run: Pick<BattleRun, 'state' | 'battle'>, u: BattleUnit): void {
  if (!u.actor) return
  const actor = run.state.actors[u.actor]
  if (!actor) return
  if (!u.pools.cash) {
    const cash = count(run.state.money.cash)
    u.pools.cash = { now: cash, max: cash, regen: 0 }
  }
  const favors = isRec(actor.ext.favors) ? actor.ext.favors : {}
  for (const f of FAVORS) {
    const name = favorPool(f)
    if (u.pools[name]) continue
    const n = count(favors[f])
    u.pools[name] = { now: n, max: n, regen: 0 }
  }
  const mine = actor.ext.abilities
  const stored = isRec(mine) && isRec(mine.commission) ? mine.commission[commissionKeyOf(run.battle)] : undefined
  if (isRec(stored)) for (const [id, n] of Object.entries(stored)) if (typeof n === 'number' && n > 0) u.uses[commissionUse(id)] = n
}
