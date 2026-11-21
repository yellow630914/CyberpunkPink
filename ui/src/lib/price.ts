import type { Shop, ItemDef, Condition, DistrictId } from '../data/types'

/** 價格（docs/systems/TRADE.md 3.2 節）。每一步四捨五入，回傳拆解給畫面的「價格拆解」。 */
export const DISTRICT_PRICE: Record<DistrictId, number> = { hive: 0.8, ave42: 1, sakura: 1.2, crown: 3, oldport: 0.7, glass: 4, rust: 0.9, under: 1 }
export const CONDITION_MULT: Record<Condition, number> = { 全新: 1, 二手: 0.45, 瑕疵: 0.8, 同人: 0.7, 精工: 1.2 }
export const BUYBACK_RATE = 0.4

export interface PriceStep { label: string; mult: number; value: number }
export interface PriceQuote { base: number; steps: PriceStep[]; total: number }

const clampTrend = (m: number) => Math.min(2.5, Math.max(0.5, m))

export function buyPrice(item: ItemDef, shop: Shop, condition: Condition = '全新'): PriceQuote {
  const steps: PriceStep[] = []
  let v = item.price
  const push = (label: string, mult: number) => { v = Math.round(v * mult); steps.push({ label, mult, value: v }) }
  if (shop.shopMult !== 1) push('店家倍率', shop.shopMult)
  push('區倍率', DISTRICT_PRICE[shop.district])
  push(`類別行情（${item.trade}）`, clampTrend(1 + (shop.trend[item.trade] ?? 0)))
  if (condition !== '全新') push(`狀態（${condition}）`, CONDITION_MULT[condition])
  const discount = Math.min(0.3, shop.discount)
  if (discount > 0) push('折扣', 1 - discount)
  return { base: item.price, steps, total: v }
}

/** 收購價：目錄價 × 收購比例 × 收購的區倍率 × 類別倍率 × 狀態倍率 × (1 + 折扣 ÷ 2)。 */
export function sellPrice(item: ItemDef, shop: Shop, condition: Condition = '全新'): PriceQuote {
  const steps: PriceStep[] = []
  let v = item.price
  const push = (label: string, mult: number) => { v = Math.round(v * mult); steps.push({ label, mult, value: v }) }
  push('收購比例', BUYBACK_RATE)
  push('收購的區倍率', 1 + (DISTRICT_PRICE[shop.district] - 1) * 0.25)
  push(`類別行情（${item.trade}）`, clampTrend(1 + (shop.trend[item.trade] ?? 0)))
  if (condition !== '全新') push(`狀態（${condition}）`, CONDITION_MULT[condition])
  const discount = Math.min(0.3, shop.discount)
  if (discount > 0) push('好感與親密度', 1 + discount / 2)
  return { base: item.price, steps, total: v }
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
