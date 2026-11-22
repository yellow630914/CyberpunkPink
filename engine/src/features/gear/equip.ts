// L6 裝備：穿上、帶上、脫下（EQUIPMENT 第 2～4 節；dev/work/M1-gear.md 第四節）。不花時間。

import type { Change, ItemEntry, Kernel, GameState, ReportDraft, TimelineBeat, WeaponClassEntry } from '../../core'
import { clone, countItem } from '../../core'
import type { Gear, GearGroup } from './model'
import { ACCESSORY_SLOTS, CARRY_NAMES, GENERIC_ACCESSORY_SLOTS, blueprintOf, fitQuick, gearOf, quickCapacity, setSlot, stackOf, sumQty, wornPieces } from './model'

interface Plan {
  block: string | null
  changes: Change[]
  summary: string
  timeline: TimelineBeat[]
}

const blocked = (block: string): Plan => ({ block, changes: [], summary: '', timeline: [] })
const slotChange = (id: string, group: GearGroup, slot: string, item: string | null): Change => ({ op: 'gear.slot', id, group, slot, item })

/**
 * 換了裝備之後快取格可能變少：超出的東西收回背包（只是不再記在快取格上，東西還在背包裡）。
 * 先在 Gear 的複本上預演這一批變更，放不下就多加一筆 gear.quick。
 */
function withQuickTrim(k: Kernel, state: GameState, actor: string, gear: Gear, changes: Change[]): { changes: Change[]; timeline: TimelineBeat[] } {
  const next = clone(gear)
  for (const c of changes) if (c.op === 'gear.slot') setSlot(next, c.group as GearGroup, c.slot as string, c.item as string | null)
  const cap = quickCapacity(k, state, next)
  if (sumQty(next.quick) <= cap) return { changes, timeline: [] }
  const items = fitQuick(next.quick, cap, (item) => countItem(state.inventory, item))
  return {
    changes: [...changes, { op: 'gear.quick', id: actor, items }],
    timeline: [{ layer: 'meat', actor, text: `快取格只剩 ${cap} 格，放不下的東西收回背包了。` }],
  }
}

function planEquip(k: Kernel, state: GameState, actor: string, what: string, slot?: string): Plan {
  if (!state.actors[actor]) return blocked(`沒有 ${actor} 這個角色。`)
  const gear = gearOf(state, actor)
  const stack = stackOf(state, what)
  let changes: Change[]
  let summary: string

  if (stack) {
    const bp = blueprintOf(k, stack)
    if (!bp) return blocked('這一件不能穿戴。')
    if (bp.kind === 'weapon') {
      const carry = bp.carry!
      if (slot !== undefined && slot !== carry) {
        const cls = k.content.get<WeaponClassEntry>('weapon_class', bp.class ?? '')
        return blocked(`${cls?.name ?? bp.name}要帶在${CARRY_NAMES[carry]}那一格。`)
      }
      changes = [slotChange(actor, 'carry', carry, what)]
      summary = `帶上${bp.name}。`
    } else {
      const covers = bp.covers ?? []
      const pieces = wornPieces(k, state, gear)
      // 這件穿上去之後，佔著這幾格的東西整件換下來（連身類它佔的每一格都清掉）
      const replaced = pieces.filter((p) => p.slots.some((s) => covers.includes(s)))
      const kept = pieces.filter((p) => !replaced.includes(p))
      if (bp.weight_class === 'heavy' && gear.worn.outer && !covers.includes('outer')) return blocked('穿重甲的時候不能再穿外套，先把外套脫掉。')
      if (covers.includes('outer') && kept.some((p) => p.bp.weight_class === 'heavy')) return blocked('穿著重甲，不能再穿外套。')
      const clears = new Set(replaced.flatMap((p) => p.slots).filter((s) => !covers.includes(s)))
      changes = [...[...clears].map((s) => slotChange(actor, 'worn', s, null)), ...covers.map((s) => slotChange(actor, 'worn', s, what))]
      summary = `穿上${bp.name}。`
    }
  } else {
    if (countItem(state.inventory, what) < 1) return blocked('背包裡沒有這一件。')
    const item = k.content.get<ItemEntry>('item', what)
    if (!item || item.category !== 'accessory') return blocked('這一件不能穿戴。')
    const tags = item.tags ?? []
    const target = tags.includes('acc:neck') ? 'neck' : tags.includes('acc:leg') ? 'leg' : GENERIC_ACCESSORY_SLOTS.find((s) => !gear.acc[s])
    if (!target) return blocked(`通用的飾品格滿了（${GENERIC_ACCESSORY_SLOTS.length} 格）。`)
    // 頸與腿原本的那個會換下來，所以不算在已經戴著的數量裡
    const worn = ACCESSORY_SLOTS.filter((s) => s !== target && gear.acc[s] === what).length
    if (worn >= countItem(state.inventory, what)) return blocked('背包裡的這個飾品都已經戴上了。')
    changes = [slotChange(actor, 'acc', target, what)]
    summary = `戴上${item.name}。`
  }

  const trimmed = withQuickTrim(k, state, actor, gear, changes)
  return { block: null, changes: trimmed.changes, summary, timeline: trimmed.timeline }
}

/** 不能穿（帶、戴）的原因；可以就是 null。檢查的順序照工單第四節。 */
export function equipBlock(k: Kernel, state: GameState, actor: string, what: string, slot?: string): string | null {
  return planEquip(k, state, actor, what, slot).block
}

const draft = (state: GameState, actor: string, action: 'gear.equip' | 'gear.unequip', plan: Pick<Plan, 'changes' | 'summary' | 'timeline'>): ReportDraft => ({
  kind: 'action', action, location: clone(state.location), actor, party: [], timeline: plan.timeline, changes: plan.changes, outcome: { result: 'ok', summary: plan.summary },
})

/** 穿上、帶上、戴上。不能穿就丟錯（訊息是 equipBlock 回傳的原因）。what 給成品的 uid，或飾品的物品 id。 */
export function equip(k: Kernel, state: GameState, actor: string, what: string, slot?: string): ReportDraft {
  const plan = planEquip(k, state, actor, what, slot)
  if (plan.block) throw new Error(plan.block)
  return draft(state, actor, 'gear.equip', plan)
}

/** 脫下。what 不在身上就丟錯。飾品同一種戴了好幾個時，先拿最後戴上的那一格。 */
export function unequip(k: Kernel, state: GameState, actor: string, what: string): ReportDraft {
  if (!state.actors[actor]) throw new Error(`沒有 ${actor} 這個角色。`)
  const gear = gearOf(state, actor)
  const changes: Change[] = []
  let summary = ''
  const stack = stackOf(state, what)
  const name = (stack ? blueprintOf(k, stack)?.name : undefined) ?? k.content.get<ItemEntry>('item', what)?.name ?? what

  const worn = Object.entries(gear.worn).filter(([, uid]) => uid === what)
  const carried = Object.entries(gear.carry).filter(([, uid]) => uid === what)
  if (worn.length) {
    for (const [s] of worn) changes.push(slotChange(actor, 'worn', s, null))
    summary = `脫下${name}。`
  } else if (carried.length) {
    for (const [s] of carried) changes.push(slotChange(actor, 'carry', s, null))
    summary = `收起${name}。`
  } else {
    const last = [...ACCESSORY_SLOTS].reverse().find((s) => gear.acc[s] === what)
    if (last) {
      changes.push(slotChange(actor, 'acc', last, null))
      summary = `摘下${name}。`
    }
  }
  if (!changes.length) throw new Error('這一件不在身上。')
  const trimmed = withQuickTrim(k, state, actor, gear, changes)
  return draft(state, actor, 'gear.unequip', { changes: trimmed.changes, summary, timeline: trimmed.timeline })
}
