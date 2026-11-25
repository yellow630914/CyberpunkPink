// L6 裝備：拿走身上的裝備（效果 gear_take；戰敗事件「被拆、被改」的那一類：COMBAT_SYSTEM 8.3 節）。
// 內建的來源才收（ai: false）：AI 與玩家要的結果給不出這個效果。寫法 { kind: 'gear_take', group?, slot?, uid? }：
//   uid    成品的 uid（飾品是物品的 id）；group 是 worn、acc、carry；slot 是那一組的格。至少要寫一個；寫了幾個就是同時符合的那些。
//   拿走的是那一件整件：從身上（連身類佔著的每一格都清掉）也從背包拿走；戴著的飾品一格拿一個。
// 同時回答掛點 defeat.gear（存檔規則「戰敗時拿走義體與裝備」關著時，戰敗事件裡的這個效果拿掉）。

import type { Change, Effect, EffectCtx, GameState, ItemEntry, Kernel } from '../../core'
import { stackOf } from '../../core'
import { withQuickTrim } from './equip'
import type { Gear, GearGroup } from './model'
import { GROUP_SLOTS, OWNER, blueprintOf, gearOf } from './model'

export const TAKE_KIND = 'gear_take'

interface TakeEffect extends Effect {
  group?: GearGroup
  slot?: string
  uid?: string
}

interface Taken {
  group: GearGroup
  slot: string
  id: string
}

/** 符合的格（還沒展開連身類）。 */
function matches(gear: Gear, e: TakeEffect): Taken[] {
  const out: Taken[] = []
  for (const group of Object.keys(GROUP_SLOTS) as GearGroup[]) {
    if (e.group !== undefined && e.group !== group) continue
    for (const [slot, id] of Object.entries(gear[group] as Record<string, string | undefined>)) {
      if (!id || (e.slot !== undefined && e.slot !== slot) || (e.uid !== undefined && e.uid !== id)) continue
      out.push({ group, slot, id })
    }
  }
  return out
}

/** 拿走的格（連身類佔著的每一格都算）與背包要減的東西。 */
function plan(k: Kernel, state: GameState, actor: string, e: TakeEffect): { changes: Change[]; names: string[] } {
  const gear = gearOf(state, actor)
  const hit = matches(gear, e)
  // 成品（worn、carry）整件：同一個 uid 佔著的每一格
  const products = new Set(hit.filter((t) => t.group !== 'acc').map((t) => t.id))
  const slots: Taken[] = [
    ...hit.filter((t) => t.group === 'acc'),
    ...(['worn', 'carry'] as const).flatMap((group) =>
      Object.entries(gear[group] as Record<string, string | undefined>).filter(([, id]) => id && products.has(id)).map(([slot, id]) => ({ group, slot, id: id! }))),
  ]
  const changes: Change[] = slots.map((t) => ({ op: 'gear.slot', id: actor, group: t.group, slot: t.slot, item: null }))
  const names: string[] = []
  for (const uid of products) {
    const stack = stackOf(state, uid)
    if (stack) {
      changes.push({ op: 'item', id: stack.id, qty: -1, data: { uid } })
      names.push(blueprintOf(k, stack)?.name ?? stack.id)
    }
  }
  const acc = new Map<string, number>()
  for (const t of hit.filter((x) => x.group === 'acc')) acc.set(t.id, (acc.get(t.id) ?? 0) + 1)
  for (const [id, qty] of acc) {
    const have = state.inventory.filter((s) => s.id === id && s.data === undefined).reduce((n, s) => n + s.qty, 0)
    if (have > 0) changes.push({ op: 'item', id, qty: -Math.min(qty, have) })
    names.push(k.content.get<ItemEntry>('item', id)?.name ?? id)
  }
  // 換了裝備之後快取格可能變少：超出的收回
  return { changes: slots.length ? withQuickTrim(k, state, actor, gear, changes).changes : changes, names }
}

export function installTake(k: Kernel): void {
  k.effects.register<TakeEffect>({
    kind: TAKE_KIND, owner: OWNER, ai: false,
    validate(raw, ctx: EffectCtx) {
      const p: string[] = []
      if (raw.group !== undefined && !(typeof raw.group === 'string' && raw.group in GROUP_SLOTS)) p.push('group 只能是 worn、acc、carry')
      else if (raw.slot !== undefined && !(typeof raw.slot === 'string' && (raw.group === undefined ? Object.values(GROUP_SLOTS).some((s) => s.includes(raw.slot as string)) : GROUP_SLOTS[raw.group as GearGroup].includes(raw.slot as string)))) p.push('slot 要是那一組裡有的格')
      if (raw.uid !== undefined && !(typeof raw.uid === 'string' && raw.uid)) p.push('uid 要是成品的 uid（飾品是物品的 id）')
      if (raw.group === undefined && raw.slot === undefined && raw.uid === undefined) p.push('group、slot、uid 至少要寫一個（不然不知道要拿走什麼）')
      if (!ctx.state.actors[ctx.actor]) p.push(`沒有 ${ctx.actor} 這個角色。`)
      return p
    },
    toChanges: (e, ctx) => plan(k, ctx.state, ctx.actor, e).changes,
    describe(e, ctx) {
      const { names } = plan(k, ctx.state, ctx.actor, e)
      return names.length > 0 ? `被拿走：${names.join('、')}` : '身上沒有可以被拿走的東西。'
    },
  })

  // 掛點 defeat.gear 是 features/defeat 宣告的：這裡只認名字（照 features/maze 掛 netrun.round 的做法）
  const on = k.hooks.on.bind(k.hooks) as unknown as (name: string, owner: string, fn: (payload: never) => unknown) => void
  on('defeat.gear', OWNER, (({ effect }: { effect: Effect }) => (effect.kind === TAKE_KIND ? true : undefined)) as never)
}
