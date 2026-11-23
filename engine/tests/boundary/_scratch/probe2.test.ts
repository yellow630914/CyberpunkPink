import { it } from 'vitest'
import type { ContentPack } from '../../../src'
import { worldFeature } from '../../../src/features/world'
import { checkout, quote, tradeFeature } from '../../../src/features/trade'
import { bargainOutcome } from '../../../src/features/trade/bargain'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../../src/testkit'

it('probe arbitrage', () => {
  const pack: ContentPack = { id: 'p', content: {
    special_map: [{ id: 'm_st', kind: 'street', size: [14, 5], sheets: [{ id: 'street', name: '街', size: [14, 5],
      layout: ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'],
      cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '攤位' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
      spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }] }] }],
    facility_type: [{ id: 'fac_shop', name: '商店' }],
    district: [{ id: 'd_port', name: '港', grade: 1, price_mult: 0.7, blocks: ['b_pier'] }],
    block: [{ id: 'b_pier', district: 'd_port', name: '碼頭', kind: 'block', map: 'm_st', exits: {}, facilities: { F1: { type: 'fac_shop', name: '攤' } } }],
    item: [{ id: 'i_gun', name: '手槍', desc: '槍。', category: 'weapon', grade: 1, size: 1, legal: 'free', price: 1000 }],
    shop_type: [{ id: 't_stall', name: '攤', catalog: ['weapon'], buys: ['weapon'], grade_max: 3, cash: true, shop_mult: 0.9, temper: -1 }],
    shop: [{ id: 's_x', type: 't_stall', name: '攤子', district: 'd_port', block: 'b_pier', facility: 'F1', owner: 'npc_ann', backer: 'f_alpha' }],
  } as any }
  const METERS = [testMeter({ kind: 'favor', owner: 't', name: '好感', keyed: 'faction' }), testMeter({ kind: 'hostility', owner: 't', name: '敵對值', keyed: 'faction' }), testMeter({ kind: 'affinity', owner: 't', name: '親密度', keyed: 'npc', min: -100 })]
  const g = makeGame({ features: [meterFeature(...METERS), worldFeature, tradeFeature], content: [METER_CONTENT, pack], patch: { money: { cred: 0, cash: 5000 } } }).game
  const show = (label: string) => console.log(label, 'buy', quote(g.k, g.state, 's_x', 'i_gun', 'buy').price, 'sell', quote(g.k, g.state, 's_x', 'i_gun', 'sell').price)
  show('plain')
  g.commit({ kind: 'action', action: 'bargain', location: {}, party: [], timeline: [], changes: bargainOutcome(g.k, g.state, 's_x', 'haggle', 'critical').changes, outcome: { result: 'critical', summary: 'x' } } as any)
  show('crit')
  g.state.meters.affinity = { npc_ann: 50 }
  show('crit+keeper50')
  g.state.meters.favor = { f_alpha: 40 }
  show('crit+keeper50+favor40')
  const cash0 = g.state.money.cash
  g.commit(checkout(g.k, g.state, 's_x', { buy: [{ item: 'i_gun', qty: 1 }], pay: 'cash' }))
  console.log('after buy', g.state.money.cash, JSON.stringify(g.state.inventory))
  g.commit(checkout(g.k, g.state, 's_x', { sell: [{ item: 'i_gun', qty: 1 }], pay: 'cash' } as any))
  console.log('after sell', g.state.money.cash, 'net', g.state.money.cash - cash0)
})
