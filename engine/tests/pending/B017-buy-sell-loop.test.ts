// B017（cpp-tester-boundary；規格問題，等使用者裁決）：同一間店、同一天，買進再原樣賣回去，賣得比買的貴。
// TRADE 3.2 節的公式：收購價 × (1 + 折扣 ÷ 2)、收購的區倍率 = 1 + (區倍率 − 1) × 0.25；TRADE 第 5 節：整車交涉「買的部分乘倍率，賣的部分除以倍率」。
// 物價低於 1 的區（DISTRICTS 第 2 節：舊港 ×0.7、蜂巢 ×0.8、鏽帶 ×0.9）加上市場攤的店家倍率 0.9，買價壓得比收購價低；殺價大成功（×0.8／÷0.8）與店主親密度再把差距拉開。
// 3.2 節寫了「不然在舊港買、到冠冕區賣就是印鈔機」，設計的意思是不能套利；引擎照公式算，沒有寫錯，所以這是規格的問題。
// 重現的資料：tests/boundary/fixtures/B017-buy-sell-loop.json。使用者裁決、規格與引擎改好之後搬到 tests/boundary/。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ContentPack, Degree } from '../../src'
import { worldFeature } from '../../src/features/world'
import { checkout, quote, tradeFeature } from '../../src/features/trade'
import { bargainOutcome } from '../../src/features/trade/bargain'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

const FIX = JSON.parse(readFileSync(new URL('../boundary/fixtures/B017-buy-sell-loop.json', import.meta.url), 'utf8')) as { seed: number; observed: { buy: number; sell: number; net_cash: number } }

function pack(area: number, shopMult: number): ContentPack {
  return {
    id: 'b17',
    content: {
      special_map: [{
        id: 'm_b17', kind: 'street', size: [14, 5],
        sheets: [{ id: 'street', name: '街', size: [14, 5], layout: ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'],
          cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '攤位' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
          spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }] }],
      }],
      facility_type: [{ id: 'fac_b17', name: '商店' }],
      district: [{ id: 'd_b17', name: '港', grade: 1, price_mult: area, blocks: ['b_b17'] }],
      block: [{ id: 'b_b17', district: 'd_b17', name: '碼頭', kind: 'block', map: 'm_b17', exits: {}, facilities: { F1: { type: 'fac_b17', name: '攤' } } }],
      item: [{ id: 'i_b17_gun', name: '手槍', desc: '槍。', category: 'weapon', grade: 1, size: 1, legal: 'free', price: 1000 }],
      shop_type: [{ id: 't_b17', name: '市場攤', catalog: ['weapon'], buys: ['weapon'], grade_max: 3, cash: true, shop_mult: shopMult, temper: -1 }],
      shop: [{ id: 's_b17', type: 't_b17', name: '碼頭的攤子', district: 'd_b17', block: 'b_b17', facility: 'F1', owner: 'npc_ann', backer: 'f_alpha' }],
    } as unknown as ContentPack['content'],
  }
}
const METERS = [
  testMeter({ kind: 'favor', owner: 't', name: '好感', keyed: 'faction' }),
  testMeter({ kind: 'hostility', owner: 't', name: '敵對值', keyed: 'faction' }),
  testMeter({ kind: 'affinity', owner: 't', name: '親密度', keyed: 'npc', min: -100 }),
]
const mk = (area: number, shopMult: number) =>
  makeGame({ seed: FIX.seed, features: [meterFeature(...METERS), worldFeature, tradeFeature], content: [METER_CONTENT, pack(area, shopMult)], patch: { money: { cred: 0, cash: 5000 } } }).game
type G = ReturnType<typeof mk>
const bargain = (g: G, degree: Degree) =>
  g.commit({ kind: 'action', action: 'bargain', location: {}, party: [], timeline: [], changes: bargainOutcome(g.k, g.state, 's_b17', 'haggle', degree).changes, outcome: { result: degree, summary: '殺價' } })

describe('B017：同一間店、同一天，買進再賣回去不該賺錢（TRADE 3.2、第 5 節）', () => {
  it('重現：物價 ×0.7 的區、市場攤 0.9、店主親密度 50、好感 40、殺價大成功 → 買 423、賣 500，一來一回現金多 77', () => {
    const g = mk(0.7, 0.9)
    g.state.meters.affinity = { npc_ann: 50 }
    g.state.meters.favor = { f_alpha: 40 }
    bargain(g, 'critical')
    const buy = quote(g.k, g.state, 's_b17', 'i_b17_gun', 'buy').price
    const sell = quote(g.k, g.state, 's_b17', 'i_b17_gun', 'sell').price
    const cash0 = g.state.money.cash
    g.commit(checkout(g.k, g.state, 's_b17', { buy: [{ item: 'i_b17_gun', qty: 1 }], pay: 'cash' }))
    g.commit(checkout(g.k, g.state, 's_b17', { sell: [{ item: 'i_b17_gun', qty: 1 }], pay: 'cash' }))
    // 現在看到的（記在 fixture 的 observed）：確認重現得出來
    expect({ buy, sell, net_cash: g.state.money.cash - cash0 }).toEqual(FIX.observed)
    // 期望：不賺錢
    expect(g.state.money.cash - cash0).toBeLessThanOrEqual(0)
  })

  it('性質：任何區的物價（DISTRICTS 第 2 節的七個值）、店家倍率、好感、店主親密度、今天的殺價結果，同一間店的賣價不高過買價', () => {
    fc.assert(fc.property(
      fc.constantFrom(0.7, 0.8, 0.9, 1, 1.2, 3, 4), fc.constantFrom(0.9, 1, 1.1, 1.3), fc.integer({ min: 0, max: 100 }), fc.integer({ min: -100, max: 100 }),
      fc.constantFrom<Degree | null>(null, 'critical', 'success', 'fail', 'fumble'),
      (area, shopMult, favor, aff, degree) => {
        const g = mk(area, shopMult)
        g.state.meters.favor = { f_alpha: favor }
        g.state.meters.affinity = { npc_ann: aff }
        if (degree) bargain(g, degree)
        return quote(g.k, g.state, 's_b17', 'i_b17_gun', 'sell').price <= quote(g.k, g.state, 's_b17', 'i_b17_gun', 'buy').price
      },
    ), { numRuns: 200, seed: 1123 })
  })
})
