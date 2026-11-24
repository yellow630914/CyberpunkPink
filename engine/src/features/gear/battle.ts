// L6 裝備：帶進戰鬥（loadout）與戰鬥結束時用掉的快取格（onEnd）。EQUIPMENT 4.1 節：戰鬥中只能用快取格裡的道具。
// 護甲不在這裡回傳：它是衍生數值 armor，戰鬥的單位自己讀（回傳了會算兩次）。

import type { Change, ItemEntry, Kernel } from '../../core'
import { countItem, modeOf } from '../../core'
import { carriedBattleWeapons } from './numbers'
import { OWNER, fitQuick, gearOf, quickCapacity } from './model'

const totals = (list: ReadonlyArray<{ item: string; qty: number }>): Map<string, number> => {
  const m = new Map<string, number>()
  for (const q of list) m.set(q.item, (m.get(q.item) ?? 0) + q.qty)
  return m
}

export function installBattle(k: Kernel): void {
  k.battle.loadout(OWNER, (state, actor, mode) => {
    if (!state.actors[actor]) return
    // 槍械與快取格只帶進現實的戰鬥：內海的武器是構裝、腳本由甲板的功能給（M3）
    if (modeOf(k.content, mode)?.layer !== 'meat') return { weapons: [], quick: [] }
    return { weapons: carriedBattleWeapons(k, state, actor), quick: gearOf(state, actor).quick }
  })

  k.battle.onEnd(OWNER, ({ state, battle }) => {
    // 戰後用掉的快取格只看現實：內海的單位沒帶快取格，拿來比會當成全部用掉
    if (modeOf(k.content, battle.mode)?.layer !== 'meat') return
    const changes: Change[] = []
    const lines: string[] = []
    const seen = new Set<string>()
    for (const u of Object.values(battle.units)) {
      if (u.side !== 'ally' || !u.actor || seen.has(u.actor) || !state.actors[u.actor]) continue
      seen.add(u.actor)
      const gear = gearOf(state, u.actor)
      // 開打時帶進來的就是角色的快取格；戰鬥中狀態不會變，所以拿現在的來比
      const start = totals(gear.quick)
      const now = totals(u.quick)
      const used = new Map<string, number>()
      for (const [item, qty] of start) if ((now.get(item) ?? 0) < qty) used.set(item, qty - (now.get(item) ?? 0))
      if (!used.size) continue

      const gone = new Map<string, number>()
      for (const [item, qty] of used) {
        const take = Math.min(qty, countItem(state.inventory, item))
        if (take > 0) changes.push({ op: 'item', id: item, qty: -take })
        gone.set(item, take)
        lines.push(`用掉：${k.content.get<ItemEntry>('item', item)?.name ?? item} ×${qty}`)
      }
      // 快取格改成剩下的
      const left = new Map(used)
      const rest: Array<{ item: string; qty: number }> = []
      for (const e of gear.quick) {
        const cut = Math.min(left.get(e.item) ?? 0, e.qty)
        left.set(e.item, (left.get(e.item) ?? 0) - cut)
        if (e.qty - cut > 0) rest.push({ item: e.item, qty: e.qty - cut })
      }
      changes.push({ op: 'gear.quick', id: u.actor, items: fitQuick(rest, quickCapacity(k, state, gear), (item) => countItem(state.inventory, item) - (gone.get(item) ?? 0)) })
    }
    return changes.length ? { changes, lines } : undefined
  })
}
