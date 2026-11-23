// B017（cpp-tester-boundary）：同一間店、同一天，買進再原樣賣回去，賣得比買的貴（TRADE 3.2 節的公式、第 5 節整車交涉）。
// 使用者 2026-11-23 裁決：接受，不修（引擎照公式算，沒有寫錯；設計的意思是不能套利，但數字留著，之後平衡再看）。
// 這份測試記錄現況，不是驗收：把那組數字釘住，哪天公式改了（買價、收購價、殺價的倍率）這一條會紅，提醒回頭看這份裁決還成不成立。
// 重現的資料：tests/boundary/fixtures/B017-buy-sell-loop.json。bug 報告：dev/bugs/B017-buy-sell-loop.md。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
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

describe('B017（接受的行為，不修）：同一間店、同一天，買進再賣回去賺得到錢（TRADE 3.2、第 5 節）', () => {
  it('現況：物價 ×0.7 的區、市場攤 0.9、店主親密度 50、好感 40、殺價大成功 → 買 423、賣 500，一來一回現金多 77', () => {
    const g = mk(0.7, 0.9)
    g.state.meters.affinity = { npc_ann: 50 }
    g.state.meters.favor = { f_alpha: 40 }
    bargain(g, 'critical')
    const buy = quote(g.k, g.state, 's_b17', 'i_b17_gun', 'buy').price
    const sell = quote(g.k, g.state, 's_b17', 'i_b17_gun', 'sell').price
    const cash0 = g.state.money.cash
    g.commit(checkout(g.k, g.state, 's_b17', { buy: [{ item: 'i_b17_gun', qty: 1 }], pay: 'cash' }))
    g.commit(checkout(g.k, g.state, 's_b17', { sell: [{ item: 'i_b17_gun', qty: 1 }], pay: 'cash' }))
    // 裁決是接受：數字就是公式算出來的（記在 fixture 的 observed）
    expect({ buy, sell, net_cash: g.state.money.cash - cash0 }).toEqual(FIX.observed)
    expect(g.state.money.cash - cash0).toBeGreaterThan(0)
  })
})
