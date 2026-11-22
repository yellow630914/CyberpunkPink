// 戰鬥裡單位身上的技能資料（unit.ext.abilities）：裝著什麼、每棵樹幾階、buff、這一場帶進來的預備。
// 讀的函式不改單位；要寫的人用 dataOf（沒有就補一份空的）。

import type { BattleUnit, Kernel } from '../../core'
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
export const tierIn = (u: BattleUnit, path: string): number => unitAbilities(u).tiers[path] ?? 1

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
