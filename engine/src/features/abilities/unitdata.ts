// 戰鬥裡單位身上的技能資料（unit.ext.abilities）：裝著什麼、每棵樹幾階、buff、這一場帶進來的預備。
// 讀的函式不改單位；要寫的人用 dataOf（沒有就補一份空的）。

import type { BattleState, BattleUnit, Kernel } from '../../core'
import type { AbilityEntry, UnitAbilities, UnitBuff } from './types'

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const EMPTY: UnitAbilities = { equipped: [], tiers: {} }

/** 這個單位裝著什麼、每棵樹開到幾階。沒有資料的單位是空的。 */
export function unitAbilities(u: BattleUnit): UnitAbilities {
  const d = u.ext.abilities
  if (!isRec(d)) return EMPTY
  const tiers: Record<string, number> = {}
  if (isRec(d.tiers)) for (const [key, v] of Object.entries(d.tiers)) if (typeof v === 'number') tiers[key] = v
  return { equipped: Array.isArray(d.equipped) ? d.equipped.filter((x): x is string => typeof x === 'string') : [], tiers }
}

/** 單位的技能資料（要寫的時候用：沒有就補一份空的）。 */
export function dataOf(u: BattleUnit): Record<string, unknown> {
  if (!isRec(u.ext.abilities)) u.ext.abilities = { equipped: [], tiers: {} }
  return u.ext.abilities as Record<string, unknown>
}

export const hasAbility = (u: BattleUnit, id: string): boolean => unitAbilities(u).equipped.includes(id)
/**
 * 這個單位在這棵樹開到幾階。敵人的招牌行動沒有樹（path 是 undefined），公式的 tier 代單位的等級；
 * 敵人單位（有 enemy）沒有記某棵樹的階數時也是等級，其他人是 1。
 */
export const tierIn = (u: BattleUnit, path: string | undefined): number => (path === undefined ? undefined : unitAbilities(u).tiers[path]) ?? (path === undefined || u.enemy !== undefined ? u.grade : 1)

/** 裝著的技能的內容（找不到的略過）。 */
export function equippedOf(view: { k: Pick<Kernel, 'content'> }, u: BattleUnit): AbilityEntry[] {
  const ids = unitAbilities(u).equipped
  if (!ids.length) return []
  return ids.map((id) => view.k.content.get<AbilityEntry>('ability', id)).filter((a): a is AbilityEntry => !!a)
}

export function unitBuffs(u: BattleUnit): UnitBuff[] {
  const d = u.ext.abilities
  return isRec(d) && Array.isArray(d.buffs) ? (d.buffs as UnitBuff[]) : []
}

export function setBuffs(u: BattleUnit, buffs: UnitBuff[]): void {
  dataOf(u).buffs = buffs
}

/** 這一場帶進來的預備（技能 id）。 */
export function broughtPrep(u: BattleUnit): string[] {
  const d = u.ext.abilities
  return isRec(d) && Array.isArray(d.brought) ? d.brought.filter((x): x is string => typeof x === 'string') : []
}

/** 這一場帶進來的預備裡，選了人的（技能 id → 他）：讀人。 */
export function broughtTargets(u: BattleUnit): Record<string, string> {
  const d = u.ext.abilities
  const raw = isRec(d) && isRec(d.read) ? d.read : {}
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

/** 這個單位就是那個人嗎：單位的角色，或單位自己記的 ext.npc。 */
export const isPerson = (u: BattleUnit, person: string): boolean => u.actor === person || u.ext.npc === person

/** 這一場開打前被識破了嗎：開戰設定的 origin.ext.pre.spotted 是 true（偽裝與入戲的「第一回合不被當成目標」這一場不生效）。 */
export function spotted(battle: Pick<BattleState, 'origin'>): boolean {
  const pre = battle.origin?.ext?.pre
  return isRec(pre) && pre.spotted === true
}
