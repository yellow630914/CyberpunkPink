// L6 裝備：算出來的數字。全身的護甲（COMBAT_SYSTEM 第 4 節）、一把組好的武器（第 5 節）、藏匿量與掃描（EQUIPMENT 6.1、6.3 節）。

import type { BattleWeapon, GameState, ItemEntry, ItemStack, Kernel, WeaponClassEntry } from '../../core'
import { attrMod, gradeDice, weaponFromClass } from '../../core'
import type { BlueprintEntry, Gear } from './model'
import { CARRY_SLOTS, blueprintOf, gearOf, num, partStat, partsOf, stackOf, wornPieces } from './model'

// ---- 護甲 ----

/** 一件 ＝ 設計圖的基礎 ＋ 纖維 ＋ 最好的一塊板材 ＋ 其他每塊板材的一半（還沒捨去）。 */
function pieceArmor(k: Kernel, stack: ItemStack, bp: BlueprintEntry): number {
  let fiber = 0
  const plates: number[] = []
  for (const { type, part } of partsOf(k, stack)) {
    if (type === 'fiber') fiber += partStat(part, 'armor')
    else if (type === 'plate') plates.push(partStat(part, 'armor'))
  }
  plates.sort((a, b) => b - a)
  return num(bp.armor) + fiber + (plates[0] ?? 0) + plates.slice(1).reduce((n, v) => n + v / 2, 0)
}

/**
 * 全身的護甲：身上最高的那一件（不疊；佔頭的那一件不算在這裡）＋ 頭盔（佔 head 的那一件，值大於 0 就 +1，最多 +1），最後無條件捨去。
 * 義體上的板材值在 M4。同時註冊成衍生數值 armor（index.ts），戰鬥的單位讀那一個。
 */
export function armorOf(k: Kernel, state: GameState, actor: string): number {
  const gear = gearOf(state, actor)
  const headUid = gear.worn.head
  let body = 0
  let helmet = 0
  for (const p of wornPieces(k, state, gear)) {
    const v = pieceArmor(k, p.stack, p.bp)
    if (p.uid === headUid) helmet = v > 0 ? 1 : 0
    else body = Math.max(body, v)
  }
  return Math.floor(body + helmet)
}

// ---- 武器 ----

function buildWeapon(k: Kernel, state: GameState, actor: string, stack: ItemStack, bp: BlueprintEntry): BattleWeapon {
  const uid = stack.data!.uid as string
  const cls = k.content.require<WeaponClassEntry>('weapon_class', bp.class ?? '')
  const parts = partsOf(k, stack)
  const sum = (key: string) => parts.reduce((n, p) => n + partStat(p.part, key), 0)
  const melee = cls.traits.includes('melee')
  // 決定傷害的零件：槍是槍管，近戰是刃；有好幾個時看最高的等級
  const damagePart = melee ? 'blade' : 'barrel'
  const extraDice = parts.filter((p) => p.type === damagePart).reduce((n, p) => Math.max(n, gradeDice(p.part.grade)), 0)
  const a = state.actors[actor]!
  return weaponFromClass(k.content, cls.id, {
    id: uid, item: uid, name: bp.name,
    hit: attrMod(k.stats.effectiveAttr(state, actor, cls.attr)) + (a.skills[cls.skill] ?? 0) + sum('hit'),
    extraDice,
    flat: sum('damage') + (melee ? attrMod(k.stats.effectiveAttr(state, actor, 'body')) : 0),
    pierce: sum('pierce'),
    range: [cls.range[0], cls.range[1] + sum('range_far')],
    ...(cls.mag ? { mag: cls.mag + sum('mag') } : {}),
  })
}

/** 背包裡這一件組好的武器，換成戰鬥裡的數字。找不到、或它不是武器就丟錯。 */
export function weaponOf(k: Kernel, state: GameState, actor: string, uid: string): BattleWeapon {
  if (!state.actors[actor]) throw new Error(`沒有 ${actor} 這個角色。`)
  const stack = stackOf(state, uid)
  if (!stack) throw new Error('背包裡沒有這一件。')
  const bp = blueprintOf(k, stack)
  if (bp?.kind !== 'weapon') throw new Error('這一件不是武器。')
  return buildWeapon(k, state, actor, stack, bp)
}

/** 攜帶格裡的武器：主武器、副武器、近戰的順序（背包裡已經不在的略過）。 */
export function carriedWeapons(k: Kernel, state: GameState, gear: Gear): Array<{ uid: string; stack: ItemStack; bp: BlueprintEntry }> {
  const out: Array<{ uid: string; stack: ItemStack; bp: BlueprintEntry }> = []
  for (const slot of CARRY_SLOTS) {
    const uid = gear.carry[slot]
    const stack = uid ? stackOf(state, uid) : undefined
    const bp = blueprintOf(k, stack)
    if (uid && stack && bp?.kind === 'weapon') out.push({ uid, stack, bp })
  }
  return out
}

export function carriedBattleWeapons(k: Kernel, state: GameState, actor: string): BattleWeapon[] {
  return carriedWeapons(k, state, gearOf(state, actor)).map((w) => buildWeapon(k, state, actor, w.stack, w.bp))
}

// ---- 藏匿與掃描 ----

const byUid = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 藏匿量 ＝ 身上每一件設計圖的 conceal 裡最大的那個（佔外套格的那一件，外套敞開時先減半、無條件捨去），一件都沒有就是 1；再加戴著的每一個飾品的 conceal。
 * 要藏的是攜帶格裡的武器：照 size 由小到大（一樣大照 uid）一件一件放，加起來不超過藏匿量的藏好了（hidden），放不下的露在外面（shown）。
 */
export function concealment(k: Kernel, state: GameState, actor: string): { capacity: number; hidden: string[]; shown: string[] } {
  const gear = gearOf(state, actor)
  let base = 0
  for (const p of wornPieces(k, state, gear)) {
    const c = Math.floor(num(p.bp.conceal))
    if (c <= 0) continue
    base = Math.max(base, p.slots.includes('outer') && gear.coat === 'open' ? Math.floor(c / 2) : c)
  }
  if (base === 0) base = 1
  const capacity = Object.values(gear.acc).reduce((n, id) => n + num(k.content.get<ItemEntry>('item', id as string)?.conceal), base)

  const hidden: string[] = []
  const shown: string[] = []
  let used = 0
  for (const w of [...carriedWeapons(k, state, gear)].sort((a, b) => a.bp.size - b.bp.size || byUid(a.uid, b.uid))) {
    if (used + w.bp.size <= capacity) {
      hidden.push(w.uid)
      used += w.bp.size
    } else shown.push(w.uid)
  }
  return { capacity, hidden: hidden.sort(byUid), shown: shown.sort(byUid) }
}

/**
 * 掃描看的是攜帶格裡的武器本身，回傳掃得到的 uid（照字串順序）。強度 0 不掃；1 只掃大小 2 以上的；2 以上掃全部。
 * 一件東西的每一個零件都帶 scan_proof 才掃不到；只要有一個掃得到的零件，整件就掃得到（沒有零件的當成掃得到）。
 */
export function scanFinds(k: Kernel, state: GameState, actor: string, strength: number): string[] {
  if (!(strength >= 1)) return []
  const out: string[] = []
  for (const w of carriedWeapons(k, state, gearOf(state, actor))) {
    if (strength < 2 && w.bp.size < 2) continue
    const parts = partsOf(k, w.stack)
    if (parts.length > 0 && parts.every((p) => p.part.traits?.includes('scan_proof'))) continue
    out.push(w.uid)
  }
  return out.sort(byUid)
}
