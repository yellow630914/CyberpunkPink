// L6 功能 combat：使用道具（只能用快取格裡的）。道具的效果是效果登錄表上的 op（ops.ts）。COMBAT_SYSTEM 1.3 節；ITEMS 5.2 節。

import type { BattleActionDef, BattleInput, BattleKernel, BattlePick, BattleSide, BattleTarget, BattleUnit, BattleView, ItemEntry, Kernel } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, isRecord, otherSide, overlayAt, sameTarget, unitsOf } from '../../core'
import { ammoProblems, fxProblems } from './fx'
import { throwBlock } from './throw'

const OWNER = 'combat'

/** 快取格裡「能用的道具」：數量大於 0、內容裡有 use、use.modes 沒寫或包含這個戰場。束帶與鎖橋器沒有 use，不算。 */
export function usableItems(k: BattleKernel, u: BattleUnit, mode: string): Array<{ slot: { item: string; qty: number }; entry: ItemEntry & { use: NonNullable<ItemEntry['use']> } }> {
  const out = []
  for (const slot of u.quick) {
    if (slot.qty <= 0) continue
    const entry = k.content.get<ItemEntry>('item', slot.item)
    if (!entry?.use) continue
    if (entry.use.modes && !entry.use.modes.includes(mode)) continue
    out.push({ slot, entry: entry as ItemEntry & { use: NonNullable<ItemEntry['use']> } })
  }
  return out
}

/** 這一步選的是哪個道具：pick.item 有寫就用它；沒寫而能用的只有一種就用那一種；否則是 null。 */
function chosen(view: BattleView, u: BattleUnit, input?: BattleInput) {
  const list = usableItems(view.k, u, view.battle.mode)
  const id = input?.pick?.item
  if (id !== undefined) return list.find((x) => x.slot.item === id)
  return list.length === 1 ? list[0] : undefined
}

const isSlotUse = (t: string): boolean => t === 'slot' || t === 'ally_slot' || t === 'foe_slot'

/** 這個道具的標籤（內容的 tags：medical、throwable……）；查不到是空的。 */
export const tagsOf = (k: BattleKernel, id: string | undefined): string[] => (id ? (k.content.get<ItemEntry>('item', id)?.tags ?? []) : [])

type Use = NonNullable<ItemEntry['use']>
const ops = (use: Use): Array<Record<string, unknown>> => use.effects.filter((e): e is Record<string, unknown> => isRecord(e))
/** 要玩家多選相鄰的一格（pick.also）：投擲物，與寫了 also 的煙霧彈。 */
const needsAlso = (use: Use): boolean => ops(use).some((e) => e.op === 'throw' || (e.op === 'soft_cover' && e.also === true))
const isDecoy = (use: Use): boolean => ops(use).some((e) => e.op === 'decoy')
const cellsOf = (side: BattleSide): BattleTarget[] => Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ side, slot: i + 1 }))

/** 這個道具可以用在哪些目標上（行動列的目標裡挑）：自己用的只有自己，給隊友的是我方每一個人，放在格子上的是我方四格，丟出去的是敵方四格；其餘的現在還不能用。 */
function itemTargets(view: BattleView, u: BattleUnit, use: { target: string }): { for: BattleTarget[]; blocks: string[] } {
  if (use.target === 'self') return { for: [{ unit: u.id }], blocks: [] }
  if (use.target === 'ally') return { for: unitsOf(view.battle, u.side).map((t) => ({ unit: t.id })), blocks: [] }
  if (use.target === 'foe_slot') return { for: cellsOf(otherSide(u.side)), blocks: [] }
  if (isSlotUse(use.target)) return { for: cellsOf(u.side), blocks: [] }
  // 對一個敵人用的道具（foe）還不能用
  return { for: [], blocks: ['這個道具現在還不能這樣用。'] }
}

/** 這個道具放在這一格現在行不行（一格一格灰掉、寫出原因）：投擲物看距離，立牌看那一格有沒有掛著東西。 */
function cellBlocks(view: BattleView, u: BattleUnit, use: Use, cell: { side: BattleSide; slot: number }): string[] {
  if (use.target === 'foe_slot') {
    const far = throwBlock(u, cell.slot)
    return far ? [far] : []
  }
  if (isDecoy(use) && overlayAt(view.battle, cell.side, cell.slot)) return ['那一格已經掛著東西了。']
  return []
}

/** 相鄰的一格（pick.also）：用得到的道具各自要選哪一方的格；選項只適用於「緊鄰它」的目標那一格（目標在第 1 或第 4 格時只有一個選項）。 */
function alsoPick(view: BattleView, u: BattleUnit): BattlePick | null {
  const sides = new Set<BattleSide>()
  for (const x of usableItems(view.k, u, view.battle.mode)) if (needsAlso(x.entry.use)) sides.add(x.entry.use.target === 'foe_slot' ? otherSide(u.side) : u.side)
  if (!sides.size) return null
  const options = [...sides].flatMap((side) => Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).map((slot) => ({
    value: slot, label: `第 ${slot} 格`, blocks: [] as string[], at: { side, slot } as BattleTarget,
    for: [slot - 1, slot + 1].filter((s) => s >= 1 && s <= BATTLE_SLOTS).map((s) => ({ side, slot: s }) as BattleTarget),
  })))
  // 不一定要選：目標在邊上時只有一個相鄰的格，就用它；在中間而沒選，行動會擋下
  return { key: 'also', label: '相鄰的一格', kind: sides.has(otherSide(u.side)) ? 'foe_slot' : 'ally_slot', required: false, options }
}

const item: BattleActionDef = {
  id: 'item', owner: OWNER, name: '使用道具', desc: '從快取格裡拿出一件道具來用，可以用在自己或相鄰的隊友身上，或是我方的一格上。',
  group: 'supply', icon: 'item', order: 3, target: 'unit', modes: ['meat'],
  // 用哪一個道具（pick.item）：快取格裡能用的才列（束帶、鎖橋器不是這樣用的，不列）；只有一種時可以不選
  picks: (view, u): BattlePick[] => {
    const list = usableItems(view.k, u, view.battle.mode)
    if (!list.length) return []
    const also = alsoPick(view, u)
    return [{
      key: 'item', label: '用哪一個道具', kind: 'choice', required: list.length > 1,
      options: list.map((x) => {
        const t = itemTargets(view, u, x.entry.use)
        return { value: x.slot.item, label: `${x.entry.name} ×${x.slot.qty}`, blocks: t.blocks, for: t.for, hint: { ap: x.entry.use.ap, ap_other: x.entry.use.ap_other ?? x.entry.use.ap, qty: x.slot.qty, ...(needsAlso(x.entry.use) ? { also: true } : {}) } }
      }),
    }, ...(also ? [also] : [])]
  },
  cost: (view, u, input) => {
    if (!input) return { ap: 1 }
    const found = chosen(view, u, input)
    if (!found) return { ap: 1 }
    const t = input.target
    const other = !!t && 'unit' in t && t.unit !== u.id
    return { ap: other ? (found.entry.use.ap_other ?? found.entry.use.ap) : found.entry.use.ap }
  },
  // 用的是哪一類道具：['item', …物品的標籤各加 item: 前綴]，花費的減免才認得出「用醫療道具」（item:medical）
  costTags: (view, u, input) => ['item', ...tagsOf(view.k, chosen(view, u, input)?.entry.id).map((t) => `item:${t}`)],
  blocks: (view, u) => (usableItems(view.k, u, view.battle.mode).length ? [] : ['快取格裡沒有能用的道具。']),
  targets: (view, u) => {
    // 每一種能用的道具各自用得到的目標；一個目標沒有任何一種用得上，就灰掉、寫出原因
    const reach = usableItems(view.k, u, view.battle.mode).flatMap((x) => itemTargets(view, u, x.entry.use).for)
    const usable = (t: BattleTarget) => reach.some((r) => sameTarget(r, t))
    const out: Array<{ target: BattleTarget; blocks: string[] }> = unitsOf(view.battle, u.side).map((t) => {
      const target: BattleTarget = { unit: t.id }
      return { target, blocks: [...(Math.abs(t.slot - u.slot) > 1 ? ['要相鄰才用得到。'] : []), ...(usable(target) ? [] : [t.id === u.id ? '快取格裡沒有可以用在自己身上的道具。' : '快取格裡沒有可以用在別人身上的道具。'])] }
    })
    // 一格一格：每一種用得到這一格的道具各自看這一格行不行（距離、有沒有掛著東西）；有一種行就行，都不行就灰掉、寫出原因
    const cells: Array<{ side: BattleSide; slot: number }> = []
    for (const r of reach) if ('slot' in r && !cells.some((c) => c.side === r.side && c.slot === r.slot)) cells.push(r)
    for (const cell of cells) {
      const asks = usableItems(view.k, u, view.battle.mode)
        .filter((x) => itemTargets(view, u, x.entry.use).for.some((r) => 'slot' in r && r.side === cell.side && r.slot === cell.slot))
        .map((x) => cellBlocks(view, u, x.entry.use, cell))
      out.push({ target: { side: cell.side, slot: cell.slot }, blocks: asks.some((b) => b.length === 0) ? [] : [...new Set(asks.flat())] })
    }
    return out
  },
  run: (run, u, target, input) => {
    const list = usableItems(run.k, u, run.battle.mode)
    let id = input.pick?.item
    if (id === undefined) {
      if (list.length !== 1) throw new BattleBlocked(['要選用哪一個道具。'])
      id = list[0]!.slot.item
    }
    const found = list.find((x) => x.slot.item === id)
    if (!found) throw new BattleBlocked(['快取格裡沒有這個道具。'])
    const use = found.entry.use
    if (!target) throw new BattleBlocked(['要選一個目標。'])
    const onUnit = 'unit' in target
    if (use.target === 'self') {
      if (onUnit && target.unit !== u.id) throw new BattleBlocked(['這個道具只能自己用。'])
      if (!onUnit) throw new BattleBlocked(['這個道具不是這樣用的。'])
    } else if (use.target === 'ally') {
      if (!onUnit) throw new BattleBlocked(['這個道具不是這樣用的。'])
    } else if (isSlotUse(use.target)) {
      if (onUnit || !('slot' in target)) throw new BattleBlocked(['這個道具不是這樣用的。'])
      if (use.target === 'foe_slot') {
        if (target.side === u.side) throw new BattleBlocked(['這個道具要丟在敵方的一格上。'])
        const far = throwBlock(u, target.slot)
        if (far) throw new BattleBlocked([far])
      } else if (use.target === 'ally_slot' && target.side !== u.side) throw new BattleBlocked(['這個道具只能放在我方的一格上。'])
    } else {
      // 對一個敵人用的道具（foe）還不能用
      throw new BattleBlocked(['這個道具現在還不能這樣用。'])
    }
    const unit = onUnit ? run.unit(target.unit) : undefined
    run.say(`${u.name} 使用${found.entry.name}${unit && unit.id !== u.id ? `，用在${unit.name}身上` : ''}。`, 'item', { unit: u.id, item: found.slot.item, target }, u)
    run.effects(use.effects, { user: u, target, source: { kind: 'item', id: found.slot.item, name: found.entry.name }, pick: input.pick ?? {} })
    found.slot.qty -= 1
    if (found.slot.qty <= 0) u.quick = u.quick.filter((q) => q.qty > 0)
  },
}

export const ITEM_ACTIONS: BattleActionDef[] = [item]

/**
 * 內容裡的道具與敵人的武器格式不對：載入時擋下（格式錯誤）。道具：用了沒有人註冊的效果（或欄位不對）、ammo 欄位、投擲物與立牌的 use；
 * 敵人：weapons[].fx（效果由敵人的功能帶進單位，格式在這裡查）。
 */
export function checkItems(k: Kernel): void {
  for (const e of k.content.list<ItemEntry>('item')) {
    const problems = [...k.battle.effectProblems(e.use?.effects ?? []), ...ammoProblems(k, e), ...useProblems(e)]
    if (problems.length) throw new Error(`item/${e.id}：${problems.join('；')}`)
  }
  for (const e of k.content.list('enemy')) {
    const weapons = Array.isArray(e.weapons) ? e.weapons : []
    weapons.forEach((w, i) => {
      if (!isRecord(w) || w.fx === undefined) return
      const problems = fxProblems(k, w.fx)
      if (problems.length) throw new Error(`enemy/${e.id}：weapons[${i}].fx：${problems.join('；')}`)
    })
  }
}

/** 投擲物（throw）要丟在敵方的一格、2 點行動點；立牌（decoy）放在我方的一格。 */
function useProblems(e: ItemEntry): string[] {
  const use = e.use
  if (!use || !Array.isArray(use.effects)) return []
  const out: string[] = []
  const has = (op: string): boolean => use.effects.some((x) => isRecord(x) && x.op === op)
  if (has('throw') && use.target !== 'foe_slot') out.push(`use.target：投擲物（throw）要寫 foe_slot，不是 ${use.target}`)
  if (has('throw') && use.ap !== 2) out.push(`use.ap：投擲物（throw）要花 2 點行動點，不是 ${use.ap}`)
  if (has('decoy') && use.target !== 'ally_slot' && use.target !== 'slot') out.push(`use.target：立牌（decoy）要放在我方的一格，寫 ally_slot，不是 ${use.target}`)
  return out
}
