import { describe, it, expect } from 'vitest'
import { buyPrice, sellPrice } from './price'
import { SHOPS } from '../data/shops'
import { ITEMS } from '../data/items'

describe('價格（TRADE 3.2 節）', () => {
  it('舊港的槍店：區倍率 0.7、武器 −20%、折扣 5%', () => {
    const q = buyPrice(ITEMS.it_6fa4e8, SHOPS.gunshop)
    // 1510 × 0.7 = 1057；× 0.8 = 846；× 0.95 = 804
    expect(q.steps.map(s => s.value)).toEqual([1057, 846, 804])
    expect(q.total).toBe(804)
  })
  it('收購價比售價低很多', () => {
    const s = sellPrice(ITEMS.it_6fa4e8, SHOPS.gunshop, '二手')
    expect(s.total).toBeLessThan(buyPrice(ITEMS.it_6fa4e8, SHOPS.gunshop).total / 3)
  })
})
