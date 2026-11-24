// L6 功能 netrun：帶出去才算數（CYBERSPACE 8.1 節「帶出去才算數」；工單 M3-netrun-nodes 第 9 項）。
// 正常結束、登出、拔線：這一趟拿到的東西全部帶走。倒下（戰敗被接受）或被強制斷線（被定位）而且沒有回到快照時，loot 的每一件擲一次 d6，
// 1～3（規則表 lose_max）丟掉；帶出來的那一件（goal）一定丟。丟掉的用 item／cred／cash 變更拿走（背包裡沒有那麼多就拿走剩下的），result.lost 列出來。

import type { Change, GameState, Kernel } from '../../core'
import { countItem, deriveRng } from '../../core'
import type { LootEntry, NetRun } from './model'
import { netrunRules } from './rules'

export interface Loss {
  changes: Change[]
  lost: LootEntry[]
  lines: string[]
}

const label = (e: LootEntry): string => (e.kind === 'item' ? `${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}` : `${e.name}（${e.qty}）`)

/** 這一趟拿到的東西，哪些丟掉了。每一件的骰面由狀態的亂數與這一趟的 id、第幾件導出（同一份狀態一定一樣）。 */
export function lossOf(k: Kernel, state: GameState, run: Pick<NetRun, 'id' | 'loot'>): Loss {
  const rules = netrunRules(k)
  const out: Loss = { changes: [], lost: [], lines: [] }
  const items = new Map<string, number>()
  let cred = state.money.cred
  let cash = state.money.cash
  run.loot.forEach((entry, i) => {
    const roll = deriveRng(state.rng, `netrun/${run.id}/lose/${i}`).int(1, 6)
    if (!entry.goal && roll > rules.lose_max) return
    out.lost.push({ ...entry })
    if (entry.kind === 'item' && entry.id) {
      const have = items.get(entry.id) ?? countItem(state.inventory, entry.id)
      const take = Math.min(entry.qty, have)
      items.set(entry.id, have - take)
      if (take > 0) out.changes.push({ op: 'item', id: entry.id, qty: -take })
    } else if (entry.kind === 'cred') {
      const take = Math.min(entry.qty, cred)
      cred -= take
      if (take > 0) out.changes.push({ op: 'cred', delta: -take })
    } else if (entry.kind === 'cash') {
      const take = Math.min(entry.qty, cash)
      cash -= take
      if (take > 0) out.changes.push({ op: 'cash', delta: -take })
    }
  })
  if (out.lost.length) out.lines.push(`慌亂中丟掉了：${out.lost.map(label).join('、')}。`)
  else if (run.loot.length) out.lines.push('這一趟拿到的東西都帶出來了。')
  return out
}
