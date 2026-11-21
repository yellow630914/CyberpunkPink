// L3 狀態核心：背包。用穩定的物品 id 當鍵（ElondiaRPG 用中文名字，CODESCAN 2.4 節）。
// 沒有實例資料的同一種物品疊在一起；帶實例資料的（零件、染色）各自一疊。

import type { ItemStack } from '../types'

export function countItem(inv: readonly ItemStack[], id: string): number {
  return inv.reduce((n, s) => (s.id === id ? n + s.qty : n), 0)
}

export function addItem(inv: ItemStack[], id: string, qty: number, data?: Record<string, unknown>): void {
  if (qty <= 0) return
  if (!data) {
    const stack = inv.find((s) => s.id === id && !s.data)
    if (stack) {
      stack.qty += qty
      return
    }
  }
  inv.push(data ? { id, qty, data } : { id, qty })
}

/** 拿走若干個；不夠就丟錯（呼叫前先用 countItem 驗）。先拿沒有實例資料的那一疊。 */
export function removeItem(inv: ItemStack[], id: string, qty: number): void {
  if (qty <= 0) return
  if (countItem(inv, id) < qty) throw new Error(`背包裡的 ${id} 不夠 ${qty} 個`)
  let left = qty
  const order = [...inv.keys()].filter((i) => inv[i]!.id === id).sort((a, b) => Number(!!inv[a]!.data) - Number(!!inv[b]!.data))
  for (const i of order) {
    const take = Math.min(left, inv[i]!.qty)
    inv[i]!.qty -= take
    left -= take
    if (left === 0) break
  }
  for (let i = inv.length - 1; i >= 0; i--) if (inv[i]!.qty <= 0) inv.splice(i, 1)
}
