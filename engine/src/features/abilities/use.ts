// 消耗與次數：行動點、RAM、現金、人情、每回合／每場／每件委託的次數、共用次數的組。
// 規格：dev/work/M1b-skill-format.md 第一節；dev/adr/0015 E1～E3。
// 錢與人情是池（pools.cash、pools.favor_small／favor_mid／favor_big）：行動的 cost() 把它們一起回傳，核心照池檢查與扣；
// 戰鬥結束時差額寫回（end.ts）。每件委託的次數記在 unit.uses['commission:<技能 id>']，開打時讀進來、結束時寫回。

import type { BattleKernel, BattleRun, BattleState, BattleUnit, BattleView, GameState } from '../../core'
import { amount } from '../../core'
import type { Layer } from './column'
import { layerOf } from './column'
import { FAVORS } from './format'
import { isRec, tierIn } from './unitdata'
import { rememberPool } from './wallet'
import type { AbilityEntry, AbilityUse } from './types'

/** 這一組消耗：直接寫的（每個戰場都一樣），或照戰場分的那一組（layer 是 meat 或 net；沒寫那一組就是空的）。沒給 layer 是現實（預備與戰鬥外用）。 */
export function useOf(ab: Pick<AbilityEntry, 'use'>, layer: Layer = 'meat'): AbilityUse {
  const u = ab.use
  if (!u) return {}
  if ('meat' in u || 'net' in u || 'opinion' in u) return u[layer] ?? {}
  return u
}

/** 每個戰場各一組消耗（use 照戰場分時：有寫的那幾個戰場；直接寫一組的是 field: null，每個戰場都一樣）。介面寫技能卡的消耗用它。 */
export function usesOf(ab: Pick<AbilityEntry, 'use'>): Array<{ field: 'meat' | 'net' | 'opinion' | null; use: AbilityUse }> {
  const u = ab.use
  if (!u) return []
  if (!('meat' in u || 'net' in u || 'opinion' in u)) return [{ field: null, use: u }]
  return (['meat', 'net', 'opinion'] as const).filter((f) => u[f] !== undefined).map((f) => ({ field: f, use: u[f]! }))
}

const poolCost = (u: AbilityUse): boolean => u.ram !== undefined || u.ram_all_min !== undefined || u.cash !== undefined || u.favor !== undefined

export type Cost = { ap: number; [pool: string]: number }

/** 一個技能要花的：行動點（沒寫行動點、也沒寫別的池時是 1，和舊的一樣）、RAM、現金、人情。 */
export function costOf(view: BattleView, u: BattleUnit, ab: AbilityEntry): Cost {
  const use = useOf(ab, layerOf(view))
  const cost: Cost = { ap: use.ap ?? (poolCost(use) ? 0 : 1) }
  if (use.ram) cost.ram = use.ram
  if (use.ram_all_min !== undefined) {
    cost.ram = u.pools.ram?.now ?? 0
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

/** 每場幾次：寫了 per_fight 照寫的；低血才解開的招牌行動（ai.unlock: 'low'）每場一次。 */
const perFightOf = (ab: AbilityEntry, layer: Layer): number | undefined => useOf(ab, layer).per_fight ?? (ab.ai?.unlock === 'low' ? 1 : undefined)

// ---- 管理行動（只有內海）----
// 次數的資料慣例（dev/adr/0018 第十三節；features/netcombat 的管理行動寫與讀同一份）：基數是 unit.ext.net.admin（開打時由技能寫、敵人由資料寫），
// 加上修正 admin_uses；這一回合用掉的記在 unit.uses['turn:admin']（核心每個回合開始清掉 'turn:' 開頭的鍵）。實際扣一次走效果 net.admin_spend。

/** 管理行動的次數上限（基數加修正）。 */
export function adminCap(view: Pick<BattleView, 'mods'>, u: BattleUnit): number {
  const n = isRec(u.ext.net) && typeof u.ext.net.admin === 'number' ? u.ext.net.admin : 0
  return Math.max(0, n + view.mods('admin_uses', u).reduce((sum, p) => sum + p.value, 0))
}

/** 這個回合還剩幾次。 */
export const adminLeft = (view: Pick<BattleView, 'mods'>, u: BattleUnit): number => Math.max(0, adminCap(view, u) - (u.uses['turn:admin'] ?? 0))

/** 這個技能的管理行動消耗（內海才有；現實一律 0）。 */
export const adminNeed = (ab: AbilityEntry, layer: Layer): number => (layer === 'net' ? useOf(ab, layer).admin ?? 0 : 0)

/** 這個技能現在用不了的原因（次數類的）。錢與行動點不夠由核心列。 */
export function usageBlocks(view: Pick<BattleView, 'battle' | 'mode' | 'mods'>, u: BattleUnit, ab: AbilityEntry): string[] {
  const layer = layerOf(view)
  const use = useOf(ab, layer)
  const out: string[] = []
  const perFight = perFightOf(ab, layer)
  if (perFight !== undefined && (u.uses[ab.id] ?? 0) >= perFight) out.push('這一場已經用過了。')
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
  const need = adminNeed(ab, layer)
  if (need > 0) {
    const cap = adminCap(view, u)
    const used = u.uses['turn:admin'] ?? 0
    if (cap - used < need) out.push(cap <= 0 ? '沒有管理行動的次數（要有主控這類管理權限）。' : `這一回合的管理行動只剩 ${Math.max(0, cap - used)} 次（一回合 ${cap} 次，已經用了 ${used} 次；這個技能要 ${need} 次）。`)
  }
  return out
}

/** 用掉一次：記每場、每回合（同一組的合起來記）、每件委託的次數。 */
export function bumpUses(u: BattleUnit, ab: AbilityEntry, layer: Layer = 'meat'): void {
  const use = useOf(ab, layer)
  if (perFightOf(ab, layer) !== undefined) u.uses[ab.id] = (u.uses[ab.id] ?? 0) + 1
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
 * 主角名下欠你的人情有幾個（衍生數值 favor_small／favor_mid／favor_big，人情的功能註冊，資料在 state.ext.favors；沒有人註冊或沒有主角就是 0）。
 * 戰鬥的人情池讀它（M2-favors）；舊的 actor.ext.favors 格式不再讀。
 */
export function favorCountOf(k: Pick<BattleKernel, 'stats'> | undefined, state: Pick<GameState, 'pc' | 'actors'>, f: (typeof FAVORS)[number]): number {
  const id = `favor_${f}`
  if (!k || !state.pc || !state.actors[state.pc] || !k.stats.hasStat(id)) return 0
  return count(k.stats.stat(state as GameState, state.pc, id))
}

/**
 * 單位剛組好、有角色的：建現金與三種人情的池（已經有的不動），把這件委託已經用過的次數讀進 uses。
 * 現金是隊伍的錢包（state.money.cash）、人情是主角名下欠你的（favorCountOf；FIXER 第 8 節）：同一場戰鬥裡每個人的池是同一個數字
 * （已經有隊友建好池就照他現在的數字，不是開打時的；之後的花費由 wallet.ts 同步）。
 */
export function setupResources(run: Pick<BattleRun, 'state' | 'battle'> & { k?: Pick<BattleKernel, 'stats'> }, u: BattleUnit): void {
  if (!u.actor) return
  const actor = run.state.actors[u.actor]
  if (!actor) return
  const share = (name: string, fallback: number): void => {
    if (!u.pools[name]) {
      const mate = Object.values(run.battle.units).find((x) => x !== u && x.actor && x.pools[name])?.pools[name]
      u.pools[name] = mate ? { now: mate.now, max: mate.max, regen: 0 } : { now: fallback, max: fallback, regen: 0 }
    }
    rememberPool(u, name)
  }
  share('cash', count(run.state.money.cash))
  for (const f of FAVORS) share(favorPool(f), favorCountOf(run.k, run.state, f))
  const mine = actor.ext.abilities
  const stored = isRec(mine) && isRec(mine.commission) ? mine.commission[commissionKeyOf(run.battle)] : undefined
  if (isRec(stored)) for (const [id, n] of Object.entries(stored)) if (typeof n === 'number' && n > 0) u.uses[commissionUse(id)] = n
}
