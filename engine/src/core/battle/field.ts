// L5 戰鬥：戰場的查詢（COMBAT_SYSTEM 第 2、3 節）。純函式，只讀戰鬥狀態：站位、距離、遮蔽、能不能換位。
// 以第四版介面的 ui/src/lib/combat/field.ts 當底，照設計書改寫成不帶狀態的函式。

import type { BattleCover, BattleOverlay, BattleSide, BattleState, BattleTarget, BattleUnit, BattleWeapon, CoverLevel } from '../types'
import { BATTLE_SLOTS } from '../types'
import type { BattleNumbers } from './rules'
import { LOSE_TURN } from './rules'

export const otherSide = (side: BattleSide): BattleSide => (side === 'ally' ? 'foe' : 'ally')
export const SIDE_NAME: Record<BattleSide, string> = { ally: '我方', foe: '敵方' }

/** 資源池的顯示名（給玩家看的句子用）：行動點、RAM、現金、三種人情。沒列的池（功能自己加的）用它自己的鍵。 */
export const POOL_NAMES: Record<string, string> = { ap: '行動點', ram: 'RAM', cash: '現金', favor_small: '小人情', favor_mid: '中人情', favor_big: '大人情' }
export const poolName = (key: string): string => POOL_NAMES[key] ?? key

/** 某個池不夠的那一句（「現金不夠（要 500，現在 300）。」）；名字以拉丁字母結尾（RAM）時和後面的字隔一個空格。 */
export const poolShort = (key: string, need: number, have: number): string => {
  const name = poolName(key)
  return `${name}${/[A-Za-z]$/.test(name) ? ' ' : ''}不夠（要 ${need}，現在 ${have}）。`
}

/** 還在場上（沒有倒下、沒有退出、不在後方排隊）。 */
export const onField = (u: BattleUnit): boolean => !u.out && u.slot >= 1

export function unitsOf(b: BattleState, side: BattleSide): BattleUnit[] {
  return Object.values(b.units).filter((u) => u.side === side && onField(u)).sort((x, y) => x.slot - y.slot)
}

export function unitAt(b: BattleState, side: BattleSide, slot: number): BattleUnit | undefined {
  return Object.values(b.units).find((u) => u.side === side && u.slot === slot && onField(u))
}

/** 輪到誰。 */
export function currentUnit(b: BattleState): BattleUnit | undefined {
  return b.units[b.order[b.turn] ?? '']
}

/** 距離 = 我在第幾格 ＋ 對方在第幾格 − 1（1 到 7）；雙方的第 1 格是近身。 */
export function distance(a: { slot: number }, t: { slot: number }): number {
  return a.slot + t.slot - 1
}

/**
 * 一個單位到對面每個還在場上的單位、每一台沒被擊落的掛著的東西的距離（鍵是那個單位或那一台的 id；用上面的 distance，不另寫一份）。
 * 他自己不在場上（還在後方、已經退出）回傳空的。給 battleOptions 的 distances：畫面不必自己算。
 */
export function distancesFrom(b: BattleState, u: BattleUnit): Record<string, number> {
  const out: Record<string, number> = {}
  if (!onField(u)) return out
  const foe = otherSide(u.side)
  for (const t of unitsOf(b, foe)) out[t.id] = distance(u, t)
  for (const o of b.overlays) if (!o.down && o.side === foe) out[o.id] = distance(u, o)
  return out
}

export function coverAt(b: BattleState, side: BattleSide, slot: number): BattleCover {
  return b.cover[side][slot - 1] ?? { level: 0, hp: 0 }
}

/** 這一格算幾級遮蔽：煙霧、人群（打不破的）至少算半掩體。 */
export function coverLevel(c: BattleCover): CoverLevel {
  return c.soft && c.level < 1 ? 1 : c.level
}

/** 這個單位現在吃到幾級遮蔽：開著機體的人用不了遮蔽，永遠暴露。 */
export function coverOf(b: BattleState, u: BattleUnit): CoverLevel {
  return u.hull ? 0 : coverLevel(coverAt(b, u.side, u.slot))
}

/** 站在暴露的格子上（監視看的就是這個）。 */
export function isExposed(b: BattleState, u: BattleUnit): boolean {
  return onField(u) && coverLevel(coverAt(b, u.side, u.slot)) === 0
}

/** 距離修正：比適用距離近或遠，每格 −2；長槍站在第 1 格再 −4（COMBAT_SYSTEM 2.3、第 3 節）。 */
export function rangeMod(n: BattleNumbers, a: { slot: number }, t: { slot: number }, w: Pick<BattleWeapon, 'range' | 'traits'>): number {
  const d = distance(a, t)
  let m = 0
  if (d < w.range[0]) m += n.rangeStep * (w.range[0] - d)
  if (d > w.range[1]) m += n.rangeStep * (d - w.range[1])
  if (w.traits.includes('long') && a.slot === 1) m += n.longAtFront
  return m
}

/** 手上那一把武器。 */
export function wielded(u: BattleUnit): BattleWeapon | undefined {
  return u.weapons[u.wield]
}

/** 這個單位帶著某個狀態嗎。 */
export function hasStatus(u: BattleUnit, id: string): boolean {
  return u.statuses.some((s) => s.id === id)
}

/** 正在失去回合（過載、被癱瘓）：這段時間可以被制伏。 */
export function losingTurn(u: BattleUnit): boolean {
  return hasStatus(u, LOSE_TURN)
}

/** 餘韻疊滿了：再過載一次就會倒下。 */
export function afterglowFull(u: BattleUnit): boolean {
  return u.layers >= u.layersMax
}

/** 重傷：生命值低於上限的一半（剛好一半不算）。 */
export function isWounded(u: BattleUnit): boolean {
  return !!u.hp && u.hp.now * 2 < u.hp.max
}

/** 斷路（run.cutSlot）記在 battle.field 的鍵：cut:<方>:<格>，值是到第幾輪結束為止（dev/adr/0018 第一節）。 */
export const cutKey = (side: BattleSide, slot: number): string => `cut:${side}:${slot}`

/** 這一格被斷路到第幾輪結束；沒有被斷路（或已經過期、還沒被清掉）是 undefined。 */
export function cutUntil(b: BattleState, side: BattleSide, slot: number): number | undefined {
  const v = b.field[cutKey(side, slot)]
  return typeof v === 'number' && Number.isFinite(v) && v >= b.round ? v : undefined
}

/** 這一格現在被斷路了嗎：不能換位進出，後面的人也補不進來。 */
export const isCut = (b: BattleState, side: BattleSide, slot: number): boolean => cutUntil(b, side, slot) !== undefined

/** 被斷路到什麼時候的一句話（「這一輪」「到第 3 回合結束」）。 */
const cutWhen = (b: BattleState, until: number): string => (until <= b.round ? '這一輪' : `到第 ${until} 回合結束`)

/**
 * 換到那一格行不行；不行就回傳原因（給玩家看的句子）。noMove 是「帶著不能換位的狀態」（由呼叫的人查資料）。
 * - 只能換到相鄰的格：和那一格的隊友交換，或移到空格。
 * - 往後退到空格、讓原本那一格空著：原本那一格要有遮蔽（掩體、半掩體或煙霧）。沒有遮蔽的空格撐不住線，退了也會被補位推回來。
 * - 被斷路的那一格（run.cutSlot）不能換位進出：站在上面的人出不去，別人也換不進去。
 */
export function moveBlock(b: BattleState, u: BattleUnit, to: number, noMove: boolean): string | null {
  if (to < 1 || to > BATTLE_SLOTS) return '沒有這一格。'
  if (Math.abs(to - u.slot) !== 1) return '只能換到相鄰的格。'
  const from = cutUntil(b, u.side, u.slot)
  if (from !== undefined) return `第 ${u.slot} 格被斷路了，${cutWhen(b, from)}站在這一格的人換不了位。`
  const into = cutUntil(b, u.side, to)
  if (into !== undefined) return `第 ${to} 格被斷路了，${cutWhen(b, into)}換不進這一格。`
  if (noMove) return '被壓制了，這一回合不能換位。'
  if (unitAt(b, u.side, to)) return null
  if (to > u.slot && coverLevel(coverAt(b, u.side, u.slot)) === 0) return '往後退、讓前面空著的時候，原本那一格要有遮蔽（掩體、半掩體或煙霧）；沒有遮蔽的空格撐不住線。'
  return null
}

export function overlayAt(b: BattleState, side: BattleSide, slot: number): BattleOverlay | undefined {
  return b.overlays.find((o) => !o.down && o.side === side && o.slot === slot)
}

/** 兩個目標是不是同一個：逐鍵比對，不看鍵的順序（B010）。 */
export function sameTarget(a: BattleTarget, t: BattleTarget): boolean {
  const x = a as unknown as Record<string, unknown>
  const y = t as unknown as Record<string, unknown>
  const keys = Object.keys(x)
  return keys.length === Object.keys(y).length && keys.every((key) => Object.prototype.hasOwnProperty.call(y, key) && x[key] === y[key])
}

/** 這一方還站著的人數（沒有倒下、沒有退出；在後方排隊的也算還有人）。 */
export function standing(b: BattleState, side: BattleSide): number {
  return Object.values(b.units).filter((u) => u.side === side && !u.out).length
}

/** 目標寫成一句話（紀錄用）。 */
export function unitTag(u: BattleUnit): string {
  return u.side === 'foe' ? `敵・${u.name}` : u.name
}
