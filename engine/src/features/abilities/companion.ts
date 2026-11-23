// 夥伴的技能（dev/adr/0016 G4；使用者 2026-11-23 定案）：有 actor.ext.paths（路數與階數，DATA 第 8 節）、沒有自己的學習紀錄（沒學過也沒裝過技能）的角色——名冊上的夥伴——
// 上場時，他每一條路數那棵樹、階數以內、不是 pending 的技能都算裝著，不看橋的容量；樹階就是那一列的階數。有自己學習紀錄的角色（主角）照自己的。

import type { ActorId, GameState, Kernel } from '../../core'
import { abilitiesOf } from './learn'
import type { AbilityEntry, UnitAbilities } from './types'
import { isRec } from './unitdata'

/** 角色身上 ext.paths 的每一列（路數的 id 與階數 1～5）；壞掉的列略過，同一條路數取最高的階。 */
export function pathRows(state: Pick<GameState, 'actors'>, actor: ActorId): Array<{ path: string; tier: number }> {
  const raw = state.actors[actor]?.ext.paths
  if (!Array.isArray(raw)) return []
  const best = new Map<string, number>()
  for (const r of raw) {
    if (!isRec(r) || typeof r.path !== 'string' || !r.path || typeof r.tier !== 'number' || !Number.isFinite(r.tier)) continue
    const tier = Math.min(5, Math.max(1, Math.floor(r.tier)))
    best.set(r.path, Math.max(best.get(r.path) ?? 0, tier))
  }
  return [...best].map(([path, tier]) => ({ path, tier }))
}

/** 這個角色有沒有自己的學習紀錄（學過技能或裝過技能）。 */
export const hasOwnRecord = (state: GameState, actor: ActorId): boolean => {
  const mine = abilitiesOf(state, actor)
  return mine.learned.length > 0 || mine.equipped.length > 0
}

/** 夥伴上場時的技能；不是夥伴（沒有 ext.paths，或有自己的學習紀錄）回傳 undefined。 */
export function companionAbilities(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): UnitAbilities | undefined {
  const rows = pathRows(state, actor)
  if (!rows.length || hasOwnRecord(state, actor)) return undefined
  const tiers: Record<string, number> = {}
  for (const r of rows) tiers[r.path] = r.tier
  const equipped = k.content
    .list<AbilityEntry>('ability')
    .filter((ab) => !ab.enemy && tiers[ab.path] !== undefined && ab.tier <= tiers[ab.path]! && !ab.meat?.pending)
    .map((ab) => ab.id)
  return { equipped, tiers }
}
