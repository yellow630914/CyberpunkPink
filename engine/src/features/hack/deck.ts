// L6 功能 hack：甲板與主控的讀法。單位的甲板在 unit.ext.deck（{ grade, firewall, slots }；測試直接給，敵人資料由 M1b-enemy-moves 放上來，主角的等 M4 的義體），
// 誰有主控只看單位的標籤 quickhack（技能的 meat.tags 給）；主控的樹階讀 unit.ext.abilities.tiers，讀不到當 1。不 import 別的功能。

import type { BattleUnit } from '../../core'
import { isRecord } from '../../core'

export const OWNER = 'hack'

/** 快駭程式的種類（NETRUNNING 第 2 節；DATA 7.5 節）。 */
export const HACK_CLASSES = ['device', 'cyberware', 'neural', 'control', 'support'] as const
export type HackClass = (typeof HACK_CLASSES)[number]
export const CLASS_NAME: Record<HackClass, string> = { device: '裝置', cyberware: '義體', neural: '神經', control: '控制', support: '支援' }

/**
 * 主控屬於哪一棵樹：預設 netrunner（潛網者的路數 id）；甲板上可以寫 tree 換成別的 id。
 * 讀單位上的 ext.abilities.tiers[樹]，讀不到當 1。
 */
export const DEFAULT_TREE = 'netrunner'

export interface Deck {
  /** 甲板的等級（1～4） */
  grade: number
  /** 防火牆（抵擋快駭與反駭的 DC） */
  firewall: number
  /** 裝在構裝槽裡、戰鬥中能用的快駭程式 id */
  slots: string[]
  tree?: string
}

export function deckOf(u: BattleUnit): Deck | undefined {
  const d = u.ext.deck
  if (!isRecord(d) || typeof d.grade !== 'number' || !Number.isFinite(d.grade)) return undefined
  return {
    grade: Math.max(1, Math.floor(d.grade)),
    firewall: typeof d.firewall === 'number' && Number.isFinite(d.firewall) ? d.firewall : 10,
    slots: Array.isArray(d.slots) ? d.slots.filter((x): x is string => typeof x === 'string') : [],
    ...(typeof d.tree === 'string' && d.tree ? { tree: d.tree } : {}),
  }
}

/** 主控的樹階（1～5）。讀不到時：敵人（敵方潛網者沒有技能樹）用自己的等級，其他的當 1。 */
export function treeTier(u: BattleUnit): number {
  const tree = deckOf(u)?.tree ?? DEFAULT_TREE
  const a = u.ext.abilities
  const t = isRecord(a) && isRecord(a.tiers) ? a.tiers[tree] : undefined
  if (typeof t === 'number' && Number.isFinite(t)) return Math.min(5, Math.max(1, Math.floor(t)))
  return u.enemy !== undefined && Number.isFinite(u.grade) ? Math.min(5, Math.max(1, Math.floor(u.grade))) : 1
}

/** 主控的樹階能跑的等級：1→I、2→II、3→III、4～5→IV（ITEMS 11.9 節）。 */
export const levelOfTier = (tier: number): number => Math.min(4, Math.max(1, tier))

/** 這個單位現在跑得動幾級：主控的樹階對照與甲板的等級取低的。沒有甲板回傳 0。 */
export function runLevel(u: BattleUnit): number {
  const deck = deckOf(u)
  return deck ? Math.min(levelOfTier(treeTier(u)), deck.grade) : 0
}

/** 能快駭：有 quickhack 標籤，而且有甲板。 */
export const canHack = (u: BattleUnit): boolean => u.tags.includes('quickhack') && !!deckOf(u)

export const ROMAN = ['', 'I', 'II', 'III', 'IV'] as const

/** 等級的檢定加值（ITEMS 11.9 節的表）：I 0、II +1、III +1、IV +2。 */
export const GRADE_CHECK: Record<number, number> = { 1: 0, 2: 1, 3: 1, 4: 2 }

/** 目標身上的義體件數（沒寫 cyber 時用 implants 的件數）。 */
export const cyberCount = (u: BattleUnit): number => u.cyber ?? u.implants?.length ?? 0
