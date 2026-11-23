// 邊界測試：交易的價格（TRADE 3.2 節的公式、第 9 節的好感折扣與敵對值加價、4.2 節的行情夾值、3.2 節的收購遞減）。cpp-tester-boundary 寫的；邊界表在這份測試的回報裡。
// 數字照 TRADE 第 9 節的表（使用者 2026-11-23 裁決：好感折扣照 TRADE，不照 FACTIONS 5.1；敵對值 20～39 ×1.1、40～59 ×1.2、60 以上不做生意）。
// 內容一律用測試自帶的最小假資料：一種攤子（店家倍率 0.9，賣也收武器與消耗品）、一間有店主與後台勢力的店、一間都沒有的店；區的物價倍率每個測試自己給。
// 量表（好感、敵對值、親密度）用 testkit 的 testMeter 定義。
//
// 同一間店同一天「買進再賣回去」賺得到錢（TRADE 3.2 的公式加第 5 節的整車交涉），是規格本身的問題，另外寫在 engine/tests/pending/B017-*.test.ts。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ContentPack, GameState } from '../../src'
import { worldFeature } from '../../src/features/world'
import {
  DEFAULT_TRADE_RULES, buyBlock, checkout, clampMarket, decayMult, favorDiscount, hostilityMarkup, quote, round, sellBlock, shopView, tradeFeature,
} from '../../src/features/trade'
import { bargainOutcome } from '../../src/features/trade/bargain'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, unknown>
const item = (id: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })

const MAP = {
  id: 'm_bt_street', kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5],
    layout: ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '攤位' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
}

export interface PackOpts { area?: number; market?: Record<string, number>; shopMult?: number; rule?: Rec; price?: number }

/** 一個區（物價 area、行情 market）、一種攤子、兩間店：s_bt_backed（店主 npc_ann、後台 f_alpha）、s_bt_plain（都沒有）。 */
export function tradePack(o: PackOpts = {}): ContentPack {
  return {
    id: 'trade_boundary',
    content: {
      special_map: [structuredClone(MAP)],
      facility_type: [{ id: 'fac_bt_shop', name: '商店' }],
      district: [{ id: 'd_bt', name: '測試區', grade: 1, price_mult: o.area ?? 1, blocks: ['b_bt'], ...(o.market ? { market: o.market } : {}) }],
      block: [{ id: 'b_bt', district: 'd_bt', name: '市場', kind: 'block', map: 'm_bt_street', exits: {}, facilities: { F1: { type: 'fac_bt_shop', name: '攤子' } } }],
      item: [
        item('i_bt_gun', { name: '手槍', category: 'weapon', price: o.price ?? 1000 }),
        item('i_bt_med', { name: '醫療包', category: 'consumable', price: 50, tags: ['medical'] }),
      ],
      shop_type: [{ id: 't_bt_stall', name: '攤子', catalog: ['weapon', 'consumable'], buys: ['weapon', 'consumable'], grade_max: 3, cash: true, shop_mult: o.shopMult ?? 0.9, temper: -1 }],
      shop: [
        { id: 's_bt_backed', type: 't_bt_stall', name: '有後台的攤子', district: 'd_bt', block: 'b_bt', facility: 'F1', owner: 'npc_ann', backer: 'f_alpha' },
        { id: 's_bt_plain', type: 't_bt_stall', name: '路邊攤', district: 'd_bt', block: 'b_bt', facility: 'F1' },
      ],
      ...(o.rule ? { trade_rule: [{ id: 'default', ...o.rule }] } : {}),
    } as unknown as ContentPack['content'],
  }
}

const METERS = [
  testMeter({ kind: 'favor', owner: 't', name: '好感', keyed: 'faction' }),
  testMeter({ kind: 'hostility', owner: 't', name: '敵對值', keyed: 'faction' }),
  testMeter({ kind: 'affinity', owner: 't', name: '親密度', keyed: 'npc', min: -100 }),
]

export const mk = (o: PackOpts = {}, money: GameState['money'] = { cred: 0, cash: 100000 }) =>
  makeGame({ features: [meterFeature(...METERS), worldFeature, tradeFeature], content: [METER_CONTENT, tradePack(o)], patch: { money } }).game
type G = ReturnType<typeof mk>

export const setMeter = (g: G, kind: string, key: string, v: number): void => { (g.state.meters[kind] ??= {})[key] = v }
const price = (g: G, side: 'buy' | 'sell', shop = 's_bt_backed', it = 'i_bt_gun') => quote(g.k, g.state, shop, it, side).price
const r6 = (x: number) => Number(x.toFixed(6))

// ===================================================================================================================

describe('邊界 TRADE 9：後台勢力的好感折扣', () => {
  it('分段：0、19 → 0；20、39 → 3%；40、59 → 6%；60、79 → 10%；80、100 → 15%（下限、下限−1 都測）', () => {
    const want: Array<[number, number]> = [[0, 0], [19, 0], [20, 0.03], [39, 0.03], [40, 0.06], [59, 0.06], [60, 0.1], [79, 0.1], [80, 0.15], [100, 0.15]]
    for (const [favor, d] of want) {
      expect(favorDiscount(DEFAULT_TRADE_RULES, favor), `好感 ${favor}`).toBe(d)
      const g = mk()
      setMeter(g, 'favor', 'f_alpha', favor)
      expect(quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy').discount.favor, `好感 ${favor}`).toBe(d)
    }
  })

  it('性質：好感越高折得越多（不會變少），最多 15%；沒有後台勢力的店不管好感多少都是 0', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      return favorDiscount(DEFAULT_TRADE_RULES, lo) <= favorDiscount(DEFAULT_TRADE_RULES, hi) && favorDiscount(DEFAULT_TRADE_RULES, hi) <= 0.15
    }))
    const g = mk()
    setMeter(g, 'favor', 'f_alpha', 100)
    expect(quote(g.k, g.state, 's_bt_plain', 'i_bt_gun', 'buy').discount.total).toBe(0)
  })
})

describe('邊界 TRADE 9：店主的親密度（每點 0.2%，最多 10%）與合計上限 30%', () => {
  it('親密度 −100、−1、0 → 0；1 → 0.2%；49 → 9.8%；50 → 10%；51、100 → 10%', () => {
    for (const [aff, d] of [[-100, 0], [-1, 0], [0, 0], [1, 0.002], [49, 0.098], [50, 0.1], [51, 0.1], [100, 0.1]] as const) {
      const g = mk()
      setMeter(g, 'affinity', 'npc_ann', aff)
      expect(r6(quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy').discount.keeper), `親密度 ${aff}`).toBe(d)
    }
  })

  it('預設的最大組合（好感 80 加親密度 50）是 25%，在 30% 以內不被夾', () => {
    const g = mk()
    setMeter(g, 'favor', 'f_alpha', 100)
    setMeter(g, 'affinity', 'npc_ann', 100)
    expect(quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy').discount).toMatchObject({ favor: 0.15, keeper: 0.1, total: 0.25 })
  })

  it('上限（存檔規則可調）：合計剛好等於上限不夾；超過一點夾在上限；上限 0 時一律 0', () => {
    for (const [cap, want] of [[0.25, 0.25], [0.249, 0.249], [0.3, 0.25], [0, 0]] as const) {
      const g = mk({ rule: { discount_cap: cap } })
      setMeter(g, 'favor', 'f_alpha', 80)
      setMeter(g, 'affinity', 'npc_ann', 50)
      const d = quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy').discount
      expect(r6(d.total), `上限 ${cap}`).toBe(want)
      expect(r6(d.raw), `上限 ${cap}`).toBe(0.25)
    }
    // 好感的折扣改大，合計 0.4 + 0.1 被夾在 30%
    const big = mk({ rule: { favor_discounts: [0.1, 0.2, 0.3, 0.4] } })
    setMeter(big, 'favor', 'f_alpha', 80)
    setMeter(big, 'affinity', 'npc_ann', 50)
    expect(r6(quote(big.k, big.state, 's_bt_backed', 'i_bt_gun', 'buy').discount.total)).toBe(0.3)
  })

  it('性質：任何好感、親密度下，折扣在 0～上限之間；等於 min(上限, 好感的折扣 + 親密度的折扣)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: -100, max: 100 }), (favor, aff) => {
      const g = mk()
      setMeter(g, 'favor', 'f_alpha', favor)
      setMeter(g, 'affinity', 'npc_ann', aff)
      const d = quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy').discount
      const want = Math.min(0.3, favorDiscount(DEFAULT_TRADE_RULES, favor) + Math.min(0.1, Math.max(0, aff) * 0.002))
      return d.total >= 0 && d.total <= 0.3 && r6(d.total) === r6(want)
    }), { numRuns: 60 })
  })
})

describe('邊界 TRADE 9／FACTIONS 6.1：敵對值的加價與不做生意', () => {
  it('加價：0、19 → ×1；20、39 → ×1.1；40、59 → ×1.2（只在買價；賣價不受影響）', () => {
    const base = mk()
    const sell0 = price(base, 'sell')
    for (const [h, m] of [[0, 1], [19, 1], [20, 1.1], [39, 1.1], [40, 1.2], [59, 1.2]] as const) {
      expect(hostilityMarkup(DEFAULT_TRADE_RULES, h), `敵對值 ${h}`).toBe(m)
      const g = mk()
      setMeter(g, 'hostility', 'f_alpha', h)
      const q = quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy')
      expect(q.steps.find((s) => s.id === 'hostility')!.mult, `敵對值 ${h}`).toBe(m)
      expect(price(g, 'sell'), `敵對值 ${h} 的賣價`).toBe(sell0)
    }
  })

  it('59 照常做生意（買得到、賣得掉）；60 起不做你的生意：買、賣都擋，原因寫出門檻；100 也一樣；別的勢力的敵對值不算', () => {
    const g = mk()
    g.state.inventory.push({ id: 'i_bt_gun', qty: 1 })
    setMeter(g, 'hostility', 'f_alpha', 59)
    expect(buyBlock(g.k, g.state, 's_bt_backed', 'i_bt_med')).toBeNull()
    expect(sellBlock(g.k, g.state, 's_bt_backed', 'i_bt_gun')).toBeNull()
    for (const h of [60, 61, 100]) {
      setMeter(g, 'hostility', 'f_alpha', h)
      expect(buyBlock(g.k, g.state, 's_bt_backed', 'i_bt_med'), `敵對值 ${h}`).toMatch(/60 以上，不做你的生意/)
      expect(sellBlock(g.k, g.state, 's_bt_backed', 'i_bt_gun'), `敵對值 ${h}`).toMatch(/60 以上，不做你的生意/)
      expect(() => checkout(g.k, g.state, 's_bt_backed', { buy: [{ item: 'i_bt_med', qty: 1 }], pay: 'cash' }), `敵對值 ${h}`).toThrow(/不做你的生意/)
      // 沒有後台勢力的店照常
      expect(buyBlock(g.k, g.state, 's_bt_plain', 'i_bt_med')).toBeNull()
    }
    setMeter(g, 'hostility', 'f_alpha', 0)
    setMeter(g, 'hostility', 'f_beta', 100)
    expect(buyBlock(g.k, g.state, 's_bt_backed', 'i_bt_med')).toBeNull()
  })

  it('門檻可調（hostility_refuse_at）：0 時誰都不做；101 時 100 也做（加價取最後一個達到的 ×1.2）', () => {
    const zero = mk({ rule: { hostility_refuse_at: 0 } })
    expect(buyBlock(zero.k, zero.state, 's_bt_backed', 'i_bt_med')).toMatch(/不做你的生意/)
    const high = mk({ rule: { hostility_refuse_at: 101 } })
    setMeter(high, 'hostility', 'f_alpha', 100)
    expect(buyBlock(high.k, high.state, 's_bt_backed', 'i_bt_med')).toBeNull()
    expect(quote(high.k, high.state, 's_bt_backed', 'i_bt_gun', 'buy').steps.find((s) => s.id === 'hostility')!.mult).toBe(1.2)
  })

  it('性質：敵對值在 0～59，買價隨敵對值不減；好感與親密度越高，買價不增、賣價不減', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 59 }), fc.integer({ min: 0, max: 59 }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      const g = mk()
      setMeter(g, 'hostility', 'f_alpha', lo)
      const p1 = price(g, 'buy')
      setMeter(g, 'hostility', 'f_alpha', hi)
      return p1 <= price(g, 'buy')
    }), { numRuns: 40 })
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: -100, max: 100 }), (f1, f2, a1, a2) => {
      const g = mk()
      setMeter(g, 'favor', 'f_alpha', Math.min(f1, f2))
      setMeter(g, 'affinity', 'npc_ann', Math.min(a1, a2))
      const [b1, s1] = [price(g, 'buy'), price(g, 'sell')]
      setMeter(g, 'favor', 'f_alpha', Math.max(f1, f2))
      setMeter(g, 'affinity', 'npc_ann', Math.max(a1, a2))
      return price(g, 'buy') <= b1 && price(g, 'sell') >= s1
    }), { numRuns: 40 })
  })
})

describe('邊界 TRADE 3.2：公式逐步四捨五入', () => {
  const AREAS = [0.7, 0.8, 0.9, 1, 1.2, 3, 4]

  it('性質：買價 = 目錄價 × 店家倍率 × 區倍率 × 類別的行情 ×（1 − 折扣）× 敵對值加價，每一步四捨五入；賣價 = 目錄價 × 40% ×（1 + (區倍率 − 1) × 0.25）× 行情 ×（1 + 折扣 ÷ 2）', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 200000 }), fc.constantFrom(...AREAS), fc.constantFrom(0.9, 1, 1.1, 1.3), fc.double({ min: 0.1, max: 3, noNaN: true }),
      fc.integer({ min: 0, max: 100 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: 0, max: 59 }),
      (catalog, area, shopMult, market, favor, aff, h) => {
        const g = mk({ area, shopMult, market: { weapon: market }, price: catalog })
        setMeter(g, 'favor', 'f_alpha', favor)
        setMeter(g, 'affinity', 'npc_ann', aff)
        setMeter(g, 'hostility', 'f_alpha', h)
        const d = Math.min(0.3, favorDiscount(DEFAULT_TRADE_RULES, favor) + Math.min(0.1, Math.max(0, aff) * 0.002))
        const cat = clampMarket(DEFAULT_TRADE_RULES, market)
        let buy = catalog
        for (const m of [shopMult, area, cat, 1 - d, hostilityMarkup(DEFAULT_TRADE_RULES, h)]) buy = round(buy * m)
        let sell = catalog
        for (const m of [0.4, 1 + (area - 1) * 0.25, cat, 1 + d / 2]) sell = round(sell * m)
        const qb = quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'buy')
        const qs = quote(g.k, g.state, 's_bt_backed', 'i_bt_gun', 'sell')
        return qb.price === buy && qs.price === sell && Number.isSafeInteger(qb.price) && qb.price >= 0 && qs.price >= 0
      },
    ), { numRuns: 120 })
  })

  it('目錄價 0：買賣都是 0；目錄價 1：每一步四捨五入之後買價 1、賣價 0（0.4 捨去）', () => {
    const z = mk({ price: 0 })
    expect([price(z, 'buy'), price(z, 'sell')]).toEqual([0, 0])
    const one = mk({ price: 1, shopMult: 1 })
    expect([price(one, 'buy'), price(one, 'sell')]).toEqual([1, 0])
  })

  it('行情（4.2）：0.49 夾到 0.5、0.5 不夾、2.5 不夾、2.51 夾到 2.5；0 與負數是格式錯誤（載入就擋）；沒寫是 1', () => {
    for (const [m, want] of [[0.49, 0.5], [0.5, 0.5], [1, 1], [2.5, 2.5], [2.51, 2.5], [100, 2.5]] as const) {
      expect(clampMarket(DEFAULT_TRADE_RULES, m), `行情 ${m}`).toBe(want)
      const g = mk({ market: { weapon: m } })
      expect(quote(g.k, g.state, 's_bt_plain', 'i_bt_gun', 'buy').steps.find((s) => s.id === 'category')!.mult, `行情 ${m}`).toBe(want)
    }
    // 0 與負數：載入時就擋下（格式錯誤，不是夾值）
    for (const m of [0, -1]) expect(() => mk({ market: { weapon: m } }), `行情 ${m}`).toThrow(/market\.weapon 要是大於 0 的倍率/)
    expect(quote(mk().k, mk().state, 's_bt_plain', 'i_bt_gun', 'buy').steps.find((s) => s.id === 'category')!.mult).toBe(1)
  })

  it('收購遞減（3.2）：同一類第 1 件不打折；之後每件 −3%；第 17 件起（已收 17 件）封頂 −50%；每天回復 5 件', () => {
    for (const [taken, want] of [[0, 1], [1, 0.97], [16, 0.52], [17, 0.5], [18, 0.5], [100, 0.5]] as const) expect(decayMult(DEFAULT_TRADE_RULES, taken), `已收 ${taken}`).toBe(want)
    const g = mk({ price: 100 })
    g.state.inventory.push({ id: 'i_bt_med', qty: 30 })
    const first = quote(g.k, g.state, 's_bt_plain', 'i_bt_med', 'sell').price
    g.commit(checkout(g.k, g.state, 's_bt_plain', { sell: [{ item: 'i_bt_med', qty: 10 }], pay: 'cash' }))
    expect(quote(g.k, g.state, 's_bt_plain', 'i_bt_med', 'sell').steps.find((s) => s.id === 'decay')!.mult).toBe(0.7)
    g.state.time = { ...g.state.time, day: g.state.time.day + 1 }
    expect(quote(g.k, g.state, 's_bt_plain', 'i_bt_med', 'sell').steps.find((s) => s.id === 'decay')!.mult).toBe(0.85)
    g.state.time = { ...g.state.time, day: g.state.time.day + 1 }
    expect(quote(g.k, g.state, 's_bt_plain', 'i_bt_med', 'sell').price).toBe(first)
  })

  it('性質：一車賣同一類 n 件，總價 = 每一件照「已收件數」遞減的價錢加總（不會超過 n × 第一件，也不低於 n × 第一件的一半再捨入）', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), (n) => {
      const g = mk()
      g.state.inventory.push({ id: 'i_bt_med', qty: n })
      const unit = quote(g.k, g.state, 's_bt_plain', 'i_bt_med', 'sell').price
      const each = Array.from({ length: n }, (_, i) => quote(g.k, g.state, 's_bt_plain', 'i_bt_med', 'sell', { taken: i }).price)
      const cash0 = g.state.money.cash
      g.commit(checkout(g.k, g.state, 's_bt_plain', { sell: [{ item: 'i_bt_med', qty: n }], pay: 'cash' }))
      const got = g.state.money.cash - cash0
      return got === each.reduce((s, x) => s + x, 0) && got <= n * unit && got >= n * Math.floor(unit / 2)
    }), { numRuns: 30 })
  })

  it('畫面拿到的和結帳一樣：shopView 的折扣、加價與 quote 一致（敵對值 40、好感 60、親密度 25）', () => {
    const g = mk()
    setMeter(g, 'hostility', 'f_alpha', 40)
    setMeter(g, 'favor', 'f_alpha', 60)
    setMeter(g, 'affinity', 'npc_ann', 25)
    const v = shopView(g.k, g.state, 's_bt_backed') as unknown as { markup: number; discount: { total: number } }
    expect(v.markup).toBe(1.2)
    expect(r6(v.discount.total)).toBe(0.15)
  })
})

describe('邊界 TRADE 5：整車交涉的倍率只有表裡的四個', () => {
  it('大成功 ×0.8、成功 ×0.9、失敗 ×1、大失敗 ×1.1：買乘、賣除（今天這間店）；施壓大失敗被趕出去（今天不做、敵對值 +5）', () => {
    for (const [degree, mult] of [['critical', 0.8], ['success', 0.9], ['fail', 1], ['fumble', 1.1]] as const) {
      // 沒有店主的店（大成功、大失敗的親密度變化不會連帶改折扣）
      const g = mk()
      const [b0, s0] = [price(g, 'buy', 's_bt_plain'), price(g, 'sell', 's_bt_plain')]
      g.commit({ kind: 'action', action: 'bargain', location: {}, party: [], timeline: [], changes: bargainOutcome(g.k, g.state, 's_bt_plain', 'haggle', degree).changes, outcome: { result: degree, summary: '殺價' } })
      expect(price(g, 'buy', 's_bt_plain'), degree).toBe(round(b0 * mult))
      expect(price(g, 'sell', 's_bt_plain'), degree).toBe(round(s0 * Number((1 / mult).toFixed(6))))
      // 別間店不受影響
      expect(price(g, 'buy'), degree).toBe(price(mk(), 'buy'))
    }
    const p = mk()
    p.commit({ kind: 'action', action: 'bargain', location: {}, party: [], timeline: [], changes: bargainOutcome(p.k, p.state, 's_bt_backed', 'pressure', 'fumble').changes, outcome: { result: 'fumble', summary: '殺價' } })
    expect(buyBlock(p.k, p.state, 's_bt_backed', 'i_bt_med')).toMatch(/被趕了出來/)
    expect(p.state.meters.hostility?.f_alpha).toBe(5)
  })
})
