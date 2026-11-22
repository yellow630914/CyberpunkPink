// 技能的型別：兩種內容（path 路數、ability 技能）與角色、單位上的資料。規格：SKILLS 1.1～1.4、1.8 節；dev/work/M1-abilities.md 第二、四節。

import type { StatusUntil } from '../../core'

export const OWNER = 'abilities'

/** 橋的四類容量（CORE_RULES 6.4 節）。 */
export const CATEGORIES = ['meat', 'net', 'social', 'media'] as const
export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_NAME: Record<Category, string> = { meat: '現實型', net: '內海型', social: '社交型', media: '媒體型' }

export const DOMAIN_LEVELS = ['strong', 'strong_support', 'mid', 'weak', 'none'] as const
export type DomainLevel = (typeof DOMAIN_LEVELS)[number]

export const LAYERS = ['signature', 'front', 'back'] as const
export const KINDS = ['active', 'passive', 'reaction', 'stance', 'prep', 'daily'] as const

/** 一棵樹開到第 N 階，要在這棵樹累計花 TREE_XP[N-1] 點（SKILLS 1.3 節）。 */
export const TREE_XP: readonly number[] = [0, 40, 120, 240, 400]

/** 共鳴的效果（封閉清單）。 */
export interface ResonanceEffect {
  initiative?: number
  free_move?: { per_fight: number }
  pending?: true
}
export interface Resonance {
  tier: number
  cells: number
  text: string
  effect?: ResonanceEffect
}

export interface PathEntry {
  id: string
  name: string
  tree: string
  category: Category
  signature: string
  domains: { meat: DomainLevel; net: DomainLevel; opinion: DomainLevel }
  resonance: Resonance[]
  [field: string]: unknown
}

export type MeatTarget = 'enemy' | 'ally' | 'self' | 'ally_slot' | 'enemy_slot' | 'none'
export type CallOption = 'shot' | 'cover_up' | 'cover_down'

/** `meat` 欄的封閉清單（工單第四節）。 */
export interface MeatDef {
  target?: MeatTarget
  attack?: {
    aimed?: boolean
    hit?: number
    spend?: 'all'
    min_mag?: number
    dice?: 'spent_minus_1'
    suppress?: { dc: 'spent' | number; skill: string }
    at?: 'attacker'
  }
  apply?: Array<{ status: string; until?: StatusUntil }>
  free_move?: { swap_adjacent_pair?: boolean }
  /** per_turn：每回合只有前幾次花 ap，之後照原價。cost 與 weapon_cost 都寫時兩邊共用同一個回合計數（所以數字要一樣） */
  cost?: { ability: string; ap: number; per_turn?: number }
  weapon_cost?: { trait: string; ap: number; per_turn?: number }
  trigger?: 'ally_attacked' | 'ally_attacked_adjacent'
  evade?: number
  on_hit?: { hit_against_ally?: number }
  give_ap?: { max: 'one_plus_half_tier' }
  call?: { options: CallOption[]; per_fight: 'half_tier_up'; ap: number }
  instinct?: true
  pending?: true
}

export interface AbilityUse {
  ap?: number
  per_turn?: number
  per_fight?: number
  first_round?: boolean
  note?: string
}

export interface AbilityEntry {
  id: string
  name: string
  text: string
  path: string
  category: Category
  tier: number
  layer: (typeof LAYERS)[number]
  kind: (typeof KINDS)[number]
  cap: number
  xp: number
  cells: number
  after?: string
  use?: AbilityUse
  meat: MeatDef | null
  net: Record<string, unknown> | null
  opinion: Record<string, unknown> | null
  prep?: Record<string, unknown> | null
  daily?: Record<string, unknown> | null
  [field: string]: unknown
}

/** 角色身上的資料（actor.ext.abilities）。 */
export interface AbilityState {
  xp: number
  learned: string[]
  equipped: string[]
  spent: Record<string, number>
}

/** 戰鬥裡每個單位的資料（unit.ext.abilities）。 */
export interface UnitAbilities {
  equipped: string[]
  tiers: Record<string, number>
}
