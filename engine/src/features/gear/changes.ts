// L6 裝備：三種變更。gear.slot（放進或拿掉一格）、gear.quick（整份換掉快取格）、gear.coat（外套敞開或扣上）。
// 狀態只經由這幾筆變更改變（invariants 第 1 條）；穿脫的規則在 equip.ts，這裡只擋「寫進去會壞掉」的。

import type { Change, GameState, ItemEntry, Kernel } from '../../core'
import { clone, countItem, isRecord } from '../../core'
import type { Gear, GearGroup } from './model'
import { GROUP_SLOTS, OWNER, blueprintOf, gearFromRaw, gearOf, quickCapacity, setSlot, stackOf, sumQty } from './model'

type SlotChange = Change & { id: string; group: GearGroup; slot: string; item: string | null }
type QuickChange = Change & { id: string; items: Array<{ item: string; qty: number }> }
type CoatChange = Change & { id: string; coat: 'open' | 'closed' }

/** 取出（沒有就補上）角色身上 ext.gear 那份，之後直接改它。 */
function ensureGear(state: GameState, id: string): Gear {
  const a = state.actors[id]!
  const g = gearFromRaw(a.ext.gear)
  a.ext.gear = g
  return g
}

export function installChanges(k: Kernel): void {
  const needActor = (state: Parameters<typeof gearOf>[0], id: unknown): string[] => (typeof id === 'string' && state.actors[id] ? [] : [`沒有 ${String(id)} 這個角色。`])

  k.changes.register<SlotChange>({
    op: 'gear.slot', owner: OWNER,
    validate(state, c) {
      const bad = needActor(state, c.id)
      if (bad.length) return bad
      const slots = GROUP_SLOTS[c.group]
      if (!slots) return ['group 只能是 worn、acc、carry。']
      if (!slots.includes(c.slot)) return [`${c.group} 沒有 ${String(c.slot)} 這一格。`]
      if (c.item === null) return []
      if (typeof c.item !== 'string' || !c.item) return ['item 要是物品的編號，或 null（把這一格清掉）。']
      if (c.group === 'acc') {
        if (countItem(state.inventory, c.item) < 1) return ['背包裡沒有這一件。']
        return k.content.get<ItemEntry>('item', c.item)?.category === 'accessory' ? [] : ['這一件不是飾品。']
      }
      const stack = stackOf(state, c.item)
      if (!stack) return ['背包裡沒有這一件。']
      const bp = blueprintOf(k, stack)
      if (c.group === 'carry') return bp?.kind === 'weapon' && bp.carry === c.slot ? [] : ['這一件不能帶在這一格。']
      return bp?.kind === 'armor' && bp.covers?.includes(c.slot as never) ? [] : ['這一件不能穿在這一格。']
    },
    apply(state, c) {
      setSlot(ensureGear(state, c.id), c.group, c.slot, c.item)
    },
  })

  k.changes.register<QuickChange>({
    op: 'gear.quick', owner: OWNER,
    validate(state, c) {
      const bad = needActor(state, c.id)
      if (bad.length) return bad
      if (!Array.isArray(c.items) || !c.items.every((q) => isRecord(q) && typeof q.item === 'string' && q.item && Number.isSafeInteger(q.qty) && q.qty >= 1)) return ['items 要是 { item, qty } 的陣列，qty 是 1 以上的整數。']
      // 照順序檢查，第一條不過就只回那一條：先看格數，再看背包夠不夠
      const cap = quickCapacity(k, state, gearOf(state, c.id))
      if (sumQty(c.items) > cap) return [`快取格只有 ${cap} 格。`]
      const want = new Map<string, number>()
      for (const q of c.items) want.set(q.item, (want.get(q.item) ?? 0) + q.qty)
      for (const [item, qty] of want) {
        if (countItem(state.inventory, item) < qty) return [`背包裡的${k.content.get<ItemEntry>('item', item)?.name ?? item}不夠 ${qty} 個。`]
      }
      return []
    },
    apply(state, c) {
      ensureGear(state, c.id).quick = clone(c.items)
    },
    describe: () => '整理快取格。',
  })

  k.changes.register<CoatChange>({
    op: 'gear.coat', owner: OWNER,
    validate(state, c) {
      const bad = needActor(state, c.id)
      if (bad.length) return bad
      return c.coat === 'open' || c.coat === 'closed' ? [] : ['coat 只能是 open 或 closed。']
    },
    apply(state, c) {
      ensureGear(state, c.id).coat = c.coat
    },
    describe: (c) => (c.coat === 'closed' ? '外套扣上了。' : '外套敞開了。'),
  })
}
