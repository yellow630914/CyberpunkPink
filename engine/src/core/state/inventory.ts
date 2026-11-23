// L3 狀態核心：背包。用穩定的物品 id 當鍵（ElondiaRPG 用中文名字，CODESCAN 2.4 節）。
// 沒有實例資料的同一種物品疊在一起；帶實例資料的（零件、染色）各自一疊。
// 帶實例資料的物品用 data.uid（字串）指名是哪一疊：拿走時給 uid，就只動那一疊（removeItemByUid）。

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

/** 背包裡 id 與 data.uid 都對得上的那一疊；沒有就是 undefined。 */
export function findByUid(inv: readonly ItemStack[], id: string, uid: unknown): ItemStack | undefined {
  return typeof uid === 'string' && uid !== '' ? inv.find((s) => s.id === id && s.data?.uid === uid) : undefined
}

/** 從指定的那一疊（id 加 data.uid）拿走 qty 個；找不到或不夠就丟錯（呼叫前先用 findByUid 驗）。拿光了那一疊就整個移除。 */
export function removeItemByUid(inv: ItemStack[], id: string, uid: unknown, qty: number): void {
  if (qty <= 0) return
  const stack = findByUid(inv, id, uid)
  if (!stack || stack.qty < qty) throw new Error(`背包裡沒有 ${id}（${String(uid)}）${qty} 個`)
  stack.qty -= qty
  if (stack.qty <= 0) inv.splice(inv.indexOf(stack), 1)
}
