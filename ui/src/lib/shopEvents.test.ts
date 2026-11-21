import { describe, it, expect } from 'vitest'
import { bargainDc, bargainResult, bargainWayReason, validateDeal, rollShopEvent, shopDaySeed, SHOP_DEALS } from './shopEvents'
import { seeded } from './combat/rng'

describe('商店的事件（第四版）', () => {
  it('殺價的 DC 照 TRADE 第 5 節：13 − ⌊親密度 ÷ 25⌋ ＋ 脾氣；原廠直營不能殺', () => {
    expect(bargainDc(41, '好說話')).toBe(12)
    expect(bargainDc(0, '高檔')).toBe(16)
    expect(bargainDc(0, '同人攤', 'flaw')).toBe(9)
    expect(bargainDc(80, '原廠直營')).toBeNull()
  })
  it('殺價的結果：超過 5 以上大成功、自然 1 大失敗', () => {
    expect(bargainResult(15, 3, 13)).toBe('大成功')
    expect(bargainResult(10, 3, 13)).toBe('成功')
    expect(bargainResult(5, 3, 13)).toBe('失敗')
    expect(bargainResult(1, 20, 13)).toBe('大失敗')
  })
  it('撒嬌要豔名 30、挑毛病只對二手件、用人情要有人情', () => {
    const o = { fame: 10, usedOnly: false, blackOrGang: false, favors: 0 }
    expect(bargainWayReason('charm', o)).toContain('豔名')
    expect(bargainWayReason('flaw', o)).toContain('二手')
    expect(bargainWayReason('favor', o)).toContain('人情')
    expect(bargainWayReason('talk', o)).toBeNull()
  })
  it('特別交易的驗證：價格拉回內容價值的 80%；氣氛交易不帶東西', () => {
    const d = SHOP_DEALS.alian[0]
    expect(validateDeal(d, 100).price).toBe(80)
    expect(validateDeal({ ...d, affinity: 5 }, 0).ok).toBe(false)
    expect(validateDeal({ id: 'x', title: '', desc: '', price: 0, pay: 'cash', flavor: true, item: 'it_x', stock: 1 }, 0).ok).toBe(false)
  })
  it('走進店裡的事件：同一天同一間店擲出來的是同一件', () => {
    const a = rollShopEvent('alian', seeded(shopDaySeed('alian', 14)), 1)
    const b = rollShopEvent('alian', seeded(shopDaySeed('alian', 14)), 1)
    expect(a?.id).toBe(b?.id)
    expect(rollShopEvent('alian', seeded(3), 0)).toBeNull()
  })
})
