// 選哪一件戰敗事件、哪一個版本（ENEMIES 第 6 節；COMBAT_SYSTEM 8.3 節；AI_TASKS 3.14 節第 1 步）。純函式。
//
// 順序（第一個有的就用；用到被關掉的標籤時沿著 fallback 找，找不到就用通用的那一件）：
//   1. 主角有天使急救的資格（旗標 angel_member）而且有 angel 的事件
//   2. 那一場戰鬥的 origin.ext.defeat_event（副本自訂的）
//   3. 打贏的那一方裡個別敵人寫的（敵人資料的 defeat；字串或字串陣列，好幾個時照骰值挑一個）
//   4. 贏的那一方的勢力的預設（機器贏了用它所屬的勢力，沒有就用場地的 origin.faction）
//   5. 通用的那一件（標 default: true）
// 版本：照主角的性別與骰值（pickVersion）。

import type { BattleState, BattleUnit, RulesKernel } from '../../core'
import { pickVersion, resolveFiltered } from '../../core'
import type { GameState, VersionId } from '../../core'
import type { DefeatEventEntry, PickTier } from './model'
import { KIND } from './model'

export interface PickOpts {
  /** 贏的那一方的勢力 */
  faction?: string
  /** 0～1 的骰值（導出來的：同一個狀態選到同一個版本） */
  roll: number
  /** 副本自訂的戰敗事件（origin.ext.defeat_event） */
  event?: string
  /** 打贏的那一方裡個別敵人寫的戰敗事件 */
  enemies?: string[]
  /** 主角有天使急救的資格；沒給就看旗標 angel_member */
  angel?: boolean
}

export interface Picked {
  entry: DefeatEventEntry
  version: VersionId
  tier: PickTier
}

export const hasAngel = (state: Pick<GameState, 'flags'>): boolean => !!state.flags.angel_member

/** 選事件（還沒挑版本）。沒有任何可用的事件回傳 undefined。 */
export function chooseEntry(k: Pick<RulesKernel, 'content'>, state: Pick<GameState, 'rules' | 'flags'>, o: PickOpts): { entry: DefeatEventEntry; tier: PickTier } | undefined {
  const all = k.content.list<DefeatEventEntry>(KIND)
  const get = (id: string) => k.content.get<DefeatEventEntry>(KIND, id)
  const generic = all.find((e) => e.default === true)
  const found = (): { entry: DefeatEventEntry; tier: PickTier } | undefined => {
    if ((o.angel ?? hasAngel(state))) {
      const e = all.find((x) => x.angel === true)
      if (e) return { entry: e, tier: 'angel' }
    }
    if (o.event !== undefined) {
      const e = get(o.event)
      if (e) return { entry: e, tier: 'origin' }
    }
    const own = [...new Set(o.enemies ?? [])].filter((id) => get(id))
    if (own.length > 0) {
      // 第二顆骰值：和版本的骰值錯開，不然「挑第幾件」和「抽哪個版本」連在一起
      const r2 = (Math.min(Math.max(o.roll, 0), 0.999999) * 7919) % 1
      return { entry: get(own[Math.min(own.length - 1, Math.floor(r2 * own.length))]!)!, tier: 'enemy' }
    }
    if (o.faction !== undefined) {
      const e = all.find((x) => x.factions.includes(o.faction!))
      if (e) return { entry: e, tier: 'faction' }
    }
    return generic ? { entry: generic, tier: 'generic' } : undefined
  }
  const first = found()
  if (!first) return undefined
  const usable = resolveFiltered(state.rules, first.entry, get)
  if (usable) return { entry: usable, tier: first.tier }
  const fallback = generic && resolveFiltered(state.rules, generic, get)
  return fallback ? { entry: fallback, tier: 'generic' } : undefined
}

export function pick(k: Pick<RulesKernel, 'content'>, state: Pick<GameState, 'rules' | 'flags' | 'actors' | 'pc'>, o: PickOpts): Picked | undefined {
  const c = chooseEntry(k, state, o)
  if (!c) return undefined
  const available = Object.keys(c.entry.versions) as VersionId[]
  const gender = state.pc ? state.actors[state.pc]?.gender : undefined
  return { entry: c.entry, tier: c.tier, version: pickVersion(gender, o.roll, { available }) }
}

// ---- 誰贏了 ----

const MACHINE_KINDS = ['machine', 'vehicle']

export interface Winners {
  /** 打贏的那一方裡個別敵人寫的戰敗事件 */
  enemies: string[]
  /** 贏的那一方的勢力 */
  faction?: string
  /** 贏的全是非人形的機器 */
  machines: boolean
}

/**
 * 戰鬥打輸之後，贏的那一方（敵方還站著的人；沒有人站著就看所有敵方）：
 * - 個別敵人寫的戰敗事件（敵人資料的 defeat）；
 * - 勢力：贏的全是非人形的機器（無人機、砲塔、機械獵犬這類不進成人場景的）用它所屬的勢力，沒有就用場地的 origin.faction；
 *   其餘用場地的 origin.faction（原本的做法），沒有再用站著的人裡第一個有勢力的。
 */
export function winnersOf(k: Pick<RulesKernel, 'content'>, battle: BattleState): Winners {
  const foes: BattleUnit[] = Object.values(battle.units).filter((u) => u.side === 'foe')
  const standing = foes.filter((u) => !u.out)
  const side = standing.length > 0 ? standing : foes
  const entries = side.map((u) => (u.enemy ? k.content.get('enemy', u.enemy) : undefined)).filter((e): e is NonNullable<typeof e> => !!e)
  const enemies: string[] = []
  for (const e of entries) {
    const d = e.defeat
    if (typeof d === 'string') enemies.push(d)
    else if (Array.isArray(d)) enemies.push(...d.filter((x): x is string => typeof x === 'string'))
  }
  const factionOf = (e: Record<string, unknown> | undefined) => (typeof e?.faction === 'string' ? e.faction : undefined)
  const machines = side.length > 0 && side.every((u) => {
    const e = u.enemy ? k.content.get('enemy', u.enemy) : undefined
    return !!e && MACHINE_KINDS.includes(String(e.kind)) && e.humanoid !== true
  })
  const place = battle.origin.faction
  const faction = machines
    ? (factionOf(entries[0]) ?? place)
    : (place ?? entries.map(factionOf).find((f) => f !== undefined))
  return { enemies, ...(faction !== undefined ? { faction } : {}), machines }
}

export const originEventOf = (battle: BattleState): string | undefined => {
  const e = battle.origin.ext?.defeat_event
  return typeof e === 'string' && e ? e : undefined
}

