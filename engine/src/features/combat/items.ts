// L6 功能 combat：使用道具（只能用快取格裡的）與五種道具效果。COMBAT_SYSTEM 1.3 節；ITEMS 5.2 節。

import type { BattleActionDef, BattleInput, BattleKernel, BattleTarget, BattleUnit, BattleView, ItemEntry, Kernel } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, unitTag, unitsOf } from '../../core'

const OWNER = 'combat'

type Slot = { side: 'ally' | 'foe'; slot: number }

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

const isSlotUse = (t: string): boolean => t === 'slot' || t === 'ally_slot'

const item: BattleActionDef = {
  id: 'item', owner: OWNER, name: '使用道具', desc: '從快取格裡拿出一件道具來用，可以用在自己或相鄰的隊友身上，或是我方的一格上。',
  group: 'supply', order: 3, target: 'unit', modes: ['meat'],
  cost: (view, u, input) => {
    if (!input) return { ap: 1 }
    const found = chosen(view, u, input)
    if (!found) return { ap: 1 }
    const t = input.target
    const other = !!t && 'unit' in t && t.unit !== u.id
    return { ap: other ? (found.entry.use.ap_other ?? found.entry.use.ap) : found.entry.use.ap }
  },
  blocks: (view, u) => (usableItems(view.k, u, view.battle.mode).length ? [] : ['快取格裡沒有能用的道具。']),
  targets: (view, u) => {
    const out: Array<{ target: BattleTarget; blocks: string[] }> = unitsOf(view.battle, u.side).map((t) => ({
      target: { unit: t.id }, blocks: Math.abs(t.slot - u.slot) > 1 ? ['要相鄰才用得到。'] : [],
    }))
    if (usableItems(view.k, u, view.battle.mode).some((x) => isSlotUse(x.entry.use.target))) {
      for (let slot = 1; slot <= BATTLE_SLOTS; slot++) out.push({ target: { side: u.side, slot }, blocks: [] })
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
      if (onUnit) throw new BattleBlocked(['這個道具不是這樣用的。'])
    } else {
      // 對敵人用的道具（foe、foe_slot）要等投擲物那一批
      throw new BattleBlocked(['這個道具現在還不能這樣用。'])
    }
    const unit = onUnit ? run.unit(target.unit) : undefined
    run.say(`${u.name} 使用${found.entry.name}${unit && unit.id !== u.id ? `，用在${unit.name}身上` : ''}。`, 'item', { unit: u.id, item: found.slot.item, target }, u)
    for (const effect of use.effects) {
      const fn = run.k.battle.getItemOp(String(effect.op))
      if (!fn) throw new Error(`item/${found.entry.id}：不認得的效果 ${String(effect.op)}`)
      fn({ run, user: u, target, ...(unit ? { unit } : {}), item: found.slot.item }, effect)
    }
    found.slot.qty -= 1
    if (found.slot.qty <= 0) u.quick = u.quick.filter((q) => q.qty > 0)
  },
}

export const ITEM_ACTIONS: BattleActionDef[] = [item]

/** 這個功能註冊的五種道具效果。 */
export function registerItemOps(k: Kernel): void {
  k.battle.itemOp('heal', OWNER, ({ run, unit }, e) => {
    if (unit) run.heal(unit, Number(e.amount) || 0)
  })
  k.battle.itemOp('cleanse', OWNER, ({ run, unit }, e) => {
    if (!unit) return
    if (typeof e.by === 'string') run.cleanse(unit, e.by)
    else if (typeof e.status === 'string') run.removeStatus(unit, e.status)
  })
  k.battle.itemOp('afterglow', OWNER, ({ run, unit }, e) => {
    if (!unit) return
    const layers = Math.max(0, Math.min(unit.layersMax, unit.layers + (Number(e.layers) || 0)))
    const delta = layers - unit.layers
    unit.layers = layers
    if (delta) run.say(`${unitTag(unit)} 餘韻 ${delta > 0 ? '+' : '−'}${Math.abs(delta)} 層。`, undefined, { target: unit.id, layers: delta })
  })
  k.battle.itemOp('vent', OWNER, ({ run, unit }, e) => {
    if (unit) run.vent(unit, Number(e.amount) || 0)
  })
  k.battle.itemOp('soft_cover', OWNER, ({ run, target }, e) => {
    if (!('slot' in target)) return
    const t: Slot = target
    run.softCover(t.side, t.slot, String(e.kind), typeof e.rounds === 'number' ? e.rounds : undefined)
  })
}

/** 內容裡的道具用了沒有人註冊的效果：載入時擋下（格式錯誤）。 */
export function checkItems(k: Kernel): void {
  const ops = k.battle.itemOpIds()
  for (const e of k.content.list<ItemEntry>('item')) {
    for (const effect of e.use?.effects ?? []) {
      if (!ops.includes(String(effect.op))) throw new Error(`item/${e.id}：不認得的效果 ${String(effect.op)}`)
    }
  }
}

