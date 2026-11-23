// 驗收測試：dev/work/M2-trade.md（cpp-feature）。規格：TRADE 第 1 節（每天的清單、購物車）、第 2 節（種類的表、件數）、第 3 節（3.1～3.3）、第 7 節（付款）、
// 第 9 節（好感的折扣、敵對值的加價、店主的親密度、上限 30%）、第 11、12 節；LIFE 1.1 節；UI 3.8 節；dev/adr/0016 第三節。
// 內容一律用測試自帶的最小假資料：一種店（t_gen：店家倍率 0.9）、兩間店（蜂巢的商行有店主與後台勢力、鏽帶的攤子都沒有）、兩個區（蜂巢 ×1.2、鏽帶 ×1）、六樣東西。
// 量表（好感、敵對值、親密度）用 testkit 的 testMeter 定義；站上設施的那一條用真的 world。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState } from '../../src'
import { ActionBlocked, ContentError, meterOf } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { arrive, worldFeature } from '../../src/features/world'
import {
  DEFAULT_TRADE_RULES, buyBlock, checkout, planCheckout, quote, refuseReason, sellBlock, shopView, stockOf, tradeFeature,
} from '../../src/features/trade'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>
const item = (id: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS: Rec[] = [
  item('i_gun', { name: '手槍', category: 'weapon', grade: 2, price: 100 }),
  item('i_reg', { name: '登記的護甲', category: 'armor', grade: 2, price: 200, legal: 'register' }),
  item('i_med', { name: '醫療包', category: 'consumable', price: 50, tags: ['medical'] }),
  item('i_food', { name: '罐頭', category: 'consumable', price: 10, tags: ['food'] }),
  item('i_junk', { name: '舊零件', category: 'consumable', price: 20, no_sell: true }),
  item('i_noprice', { name: '沒標價的東西', category: 'misc' }),
]

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [14, 5],
  sheets: [{
    id: 'street', name: '街', size: [14, 5],
    layout: ['##############', '#F...........#', 'E.1........2.E', '#............#', '##############'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '攤位' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [11, 2], cover: 'dense' }],
  }],
}

const T_GEN = { id: 't_gen', name: '雜貨店', catalog: ['weapon', 'armor', 'consumable'], buys: ['weapon', 'consumable'], grade_max: 3, cash: true, shop_mult: 0.9, temper: 0 }

const content = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [{ id: 'fac_shop', name: '商店' }],
    district: [
      { id: 'd_hive', name: '蜂巢', grade: 1, price_mult: 1.2, blocks: ['b_market'] },
      { id: 'd_rust', name: '鏽帶', grade: 2, price_mult: 1, blocks: ['b_yard'] },
    ],
    block: [
      { id: 'b_market', district: 'd_hive', name: '市場', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '商行的門面' } } },
      { id: 'b_yard', district: 'd_rust', name: '院子', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '鐵皮攤' } } },
    ],
    item: structuredClone(ITEMS),
    shop_type: [structuredClone(T_GEN)],
    shop: [
      { id: 's_alpha', type: 't_gen', name: '蜂巢商行', district: 'd_hive', block: 'b_market', facility: 'F1', owner: 'npc_ann', backer: 'f_alpha' },
      { id: 's_beta', type: 't_gen', name: '鏽帶攤子', district: 'd_rust', block: 'b_yard', facility: 'F1' },
    ],
  }
  patch(c)
  return { id: 'trade_test', content: c as unknown as ContentPack['content'] }
}

const METERS = [
  testMeter({ kind: 'favor', owner: 't', name: '好感', keyed: 'faction' }),
  testMeter({ kind: 'hostility', owner: 't', name: '敵對值', keyed: 'faction' }),
  testMeter({ kind: 'affinity', owner: 't', name: '親密度', keyed: 'npc', min: -100 }),
]

interface Opts { pack?: ContentPack; features?: Feature[]; money?: GameState['money']; seed?: number; meters?: boolean }
const mk = (o: Opts = {}) =>
  makeGame({
    features: [...(o.meters === false ? [] : [meterFeature(...METERS)]), worldFeature, tradeFeature, ...(o.features ?? [])],
    content: [METER_CONTENT, o.pack ?? content()], ...(o.seed !== undefined ? { seed: o.seed } : {}),
    patch: { money: o.money ?? { cred: 1000, cash: 500 } },
  }).game
type G = ReturnType<typeof mk>

const setMeter = (g: G, kind: string, key: string, v: number): void => { (g.state.meters[kind] ??= {})[key] = v }
const day = (g: G, d: number): void => { g.state.time = { ...g.state.time, day: d } }
const give = (g: G, id: string, qty = 1): void => { g.state.inventory.push({ id, qty }) }
const rows = (g: G, shop = 's_alpha') => stockOf(g.k, g.state, shop)
const left = (g: G, id: string, shop = 's_alpha'): number => rows(g, shop).find((r) => r.item === id)!.left
const withRule = (rule: Rec) => content((c) => { c.trade_rule = [{ id: 'default', ...rule }] })

describe('今天的清單', () => {
  it('同一天看幾次都一樣；不在清單上的：沒有 price 的東西；每種的件數照種類（裝備 1、消耗品 2～5、食物 20）', () => {
    const g = mk()
    const a = rows(g)
    expect(rows(g)).toEqual(a)
    expect(a.map((r) => r.item)).not.toContain('i_noprice')
    expect(a.map((r) => r.item)).toEqual(['i_food', 'i_gun', 'i_junk', 'i_med', 'i_reg'])
    const total = (id: string) => a.find((r) => r.item === id)!.total
    expect(total('i_gun')).toBe(1)
    expect(total('i_reg')).toBe(1)
    expect(total('i_food')).toBe(20)
    expect(total('i_med')).toBeGreaterThanOrEqual(2)
    expect(total('i_med')).toBeLessThanOrEqual(5)
    expect(a.every((r) => r.left === r.total && r.sold === 0)).toBe(true)
  })

  it('隔天不同（只看存檔種子、店、第幾天）；同一個種子重來一次一樣；換種子或換一間店不一樣', () => {
    const pack = withRule({ list_size: [2, 3] })
    const g = mk({ pack })
    const sig = (gg: G, d: number, shop = 's_alpha'): string => { day(gg, d); return JSON.stringify(stockOf(gg.k, gg.state, shop)) }
    const days = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => sig(g, d))
    expect(new Set(days).size).toBeGreaterThan(1)
    const again = mk({ pack })
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => sig(again, d))).toEqual(days)
    const other = mk({ pack, seed: 99 })
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => sig(other, d))).not.toEqual(days)
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => sig(g, d, 's_beta'))).not.toEqual(days)
    // 擲過別的骰子（亂數游標動了）不改清單
    day(g, 3)
    const before = rows(g)
    g.state.rng.cursor += 17
    expect(rows(g)).toEqual(before)
  })

  it('買掉一件之後今天剩下的數量少一；隔天又是滿的', () => {
    const g = mk()
    const before = left(g, 'i_med')
    g.commit(checkout(g.k, g.state, 's_alpha', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cred' }))
    expect(left(g, 'i_med')).toBe(before - 1)
    expect(rows(g).find((r) => r.item === 'i_med')!.sold).toBe(1)
    day(g, 2)
    expect(rows(g).find((r) => r.item === 'i_med')!.sold).toBe(0)
    // 別的店不受影響
    expect(left(g, 'i_med', 's_beta')).toBe(rows(g, 's_beta').find((r) => r.item === 'i_med')!.total)
  })

  it('買完了等明天：賣完的那一列有原因、不能再買', () => {
    const g = mk()
    g.commit(checkout(g.k, g.state, 's_alpha', { buy: [{ item: 'i_gun', qty: 1 }], pay: 'cred' }))
    expect(left(g, 'i_gun')).toBe(0)
    expect(buyBlock(g.k, g.state, 's_alpha', 'i_gun')).toBe('手槍今天賣完了，明天再來。')
    expect(shopView(g.k, g.state, 's_alpha').shelf.find((r) => r.item === 'i_gun')).toMatchObject({ left: 0, block: '手槍今天賣完了，明天再來。' })
    day(g, 2)
    expect(buyBlock(g.k, g.state, 's_alpha', 'i_gun')).toBeNull()
  })

  it('超過 grade_max 的不上架；fixed 一定上架（沒有 price 的還是不上）', () => {
    const g = mk({
      pack: content((c) => {
        c.item!.push(item('i_big', { category: 'weapon', grade: 4, price: 900 }))
        c.shop!.push({ id: 's_fixed', type: 't_gen', name: '特約', district: 'd_hive', fixed: ['i_big', 'i_noprice'] })
      }),
    })
    expect(rows(g).map((r) => r.item)).not.toContain('i_big')
    expect(rows(g, 's_fixed').map((r) => r.item)).toContain('i_big')
    expect(rows(g, 's_fixed').map((r) => r.item)).not.toContain('i_noprice')
  })

  it('list_size 蓋掉預設：只抽幾種', () => {
    const g = mk({ pack: withRule({ list_size: [2, 2] }) })
    expect(rows(g)).toHaveLength(2)
    expect(DEFAULT_TRADE_RULES.list_size).toEqual([6, 10])
  })
})

describe('價格與拆解', () => {
  it('目錄價 100、店家倍率 0.9、區倍率 1.2 → 108；每一步的名字、倍率、數字都對得上', () => {
    const g = mk()
    const q = quote(g.k, g.state, 's_alpha', 'i_gun', 'buy')
    expect(q.price).toBe(108)
    expect(q.steps).toEqual([
      { id: 'catalog', name: '目錄價', mult: 1, value: 100 },
      { id: 'shop', name: '店家倍率', mult: 0.9, value: 90 },
      { id: 'district', name: '區倍率', mult: 1.2, value: 108 },
      { id: 'category', name: '類別的行情', mult: 1, value: 108 },
      { id: 'discount', name: '折扣', mult: 1, value: 108 },
      { id: 'hostility', name: '敵對值的加價', mult: 1, value: 108 },
    ])
  })

  it('好感 45（折 6%）加親密度 20（折 4%）→ 97；敵對值 45 再 ×1.2 → 116', () => {
    const g = mk()
    setMeter(g, 'favor', 'f_alpha', 45)
    setMeter(g, 'affinity', 'npc_ann', 20)
    const q = quote(g.k, g.state, 's_alpha', 'i_gun', 'buy')
    expect(q.price).toBe(97)
    expect(q.discount).toMatchObject({ favor: 0.06, keeper: expect.closeTo(0.04, 9), total: expect.closeTo(0.1, 9) })
    expect(q.steps.map((s) => s.value)).toEqual([100, 90, 108, 108, 97, 97])
    setMeter(g, 'hostility', 'f_alpha', 45)
    const hot = quote(g.k, g.state, 's_alpha', 'i_gun', 'buy')
    expect(hot.price).toBe(116)
    expect(hot.steps.at(-1)).toEqual({ id: 'hostility', name: '敵對值的加價', mult: 1.2, value: 116 })
  })

  it('好感的折扣照表（0～19 無、20 起 3%、40 起 6%、60 起 10%、80 起 15%）；店主親密度每點 0.2%、最多 10%、負的不加價', () => {
    const g = mk()
    const d = (favor: number, aff = 0) => {
      setMeter(g, 'favor', 'f_alpha', favor)
      setMeter(g, 'affinity', 'npc_ann', aff)
      return quote(g.k, g.state, 's_alpha', 'i_gun', 'buy').discount
    }
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map((f) => d(f).favor)).toEqual([0, 0, 0.03, 0.03, 0.06, 0.06, 0.1, 0.1, 0.15, 0.15])
    expect(d(0, 50).keeper).toBeCloseTo(0.1, 9)
    expect(d(0, 100).keeper).toBeCloseTo(0.1, 9)
    expect(d(0, -50).keeper).toBe(0)
    // 敵對值分段加價（FACTIONS 6.1 節、TRADE 第 9 節；M2 修正批 9）：0～19 不加、20～39 ×1.1、40～59 ×1.2；60 以上不做生意（另一條測試）
    setMeter(g, 'favor', 'f_alpha', 0)
    const priceAt = (h: number) => {
      setMeter(g, 'hostility', 'f_alpha', h)
      return quote(g.k, g.state, 's_alpha', 'i_gun', 'buy')
    }
    expect([0, 19].map((h) => priceAt(h).price)).toEqual([108, 108])
    expect([20, 39].map((h) => priceAt(h).price)).toEqual([119, 119]) // 108 × 1.1
    expect([40, 59].map((h) => priceAt(h).price)).toEqual([130, 130]) // 108 × 1.2
    expect(priceAt(20).steps.at(-1)).toMatchObject({ id: 'hostility', mult: 1.1 })
    expect(priceAt(40).steps.at(-1)).toMatchObject({ id: 'hostility', mult: 1.2 })
  })

  it('折扣合計最多 30%（規則可以調）', () => {
    const g = mk({ pack: withRule({ favor_discounts: [0.1, 0.2, 0.3, 0.4] }) })
    setMeter(g, 'favor', 'f_alpha', 85)
    setMeter(g, 'affinity', 'npc_ann', 100)
    const q = quote(g.k, g.state, 's_alpha', 'i_gun', 'buy')
    expect(q.discount.raw).toBeCloseTo(0.5, 9)
    expect(q.discount.total).toBe(0.3)
    expect(q.price).toBe(76)
    const g2 = mk({ pack: withRule({ discount_cap: 0.1 }) })
    setMeter(g2, 'favor', 'f_alpha', 85)
    expect(quote(g2.k, g2.state, 's_alpha', 'i_gun', 'buy').discount.total).toBe(0.1)
  })

  it('沒有後台勢力、沒有店主的店沒有折扣也沒有加價；沒有人定義量表時也照樣報價', () => {
    const g = mk()
    setMeter(g, 'favor', 'f_alpha', 90)
    expect(quote(g.k, g.state, 's_beta', 'i_gun', 'buy').price).toBe(90)
    const bare = mk({ meters: false })
    expect(quote(bare.k, bare.state, 's_alpha', 'i_gun', 'buy').price).toBe(108)
  })

  it('收購價 = 目錄價 × 40% × 收購的區倍率（1 + (1.2 − 1) × 0.25）×（1 + 折扣 ÷ 2）；敵對值不影響', () => {
    const g = mk()
    const q = quote(g.k, g.state, 's_alpha', 'i_gun', 'sell')
    expect(q.steps).toEqual([
      { id: 'catalog', name: '目錄價', mult: 1, value: 100 },
      { id: 'ratio', name: '收購比例', mult: 0.4, value: 40 },
      { id: 'sell_district', name: '收購的區倍率', mult: expect.closeTo(1.05, 9), value: 42 },
      { id: 'category', name: '類別的行情', mult: 1, value: 42 },
      { id: 'sell_bonus', name: '折扣加成', mult: 1, value: 42 },
    ])
    setMeter(g, 'favor', 'f_alpha', 45)
    setMeter(g, 'affinity', 'npc_ann', 20)
    setMeter(g, 'hostility', 'f_alpha', 45)
    const q2 = quote(g.k, g.state, 's_alpha', 'i_gun', 'sell')
    expect(q2.price).toBe(44) // 42 × (1 + 0.1 ÷ 2) = 44.1
    expect(quote(g.k, g.state, 's_beta', 'i_gun', 'sell').price).toBe(40)
    const g3 = mk({ pack: withRule({ buy_ratio: 0.5 }) })
    expect(quote(g3.k, g3.state, 's_beta', 'i_gun', 'sell').price).toBe(50)
  })

  it('沒有 price 的東西報價丟錯', () => {
    const g = mk()
    expect(() => quote(g.k, g.state, 's_alpha', 'i_noprice', 'buy')).toThrow('沒有定價')
  })
})

describe('做不成的原因（一條一句）', () => {
  it('後台勢力的敵對值 60 以上不做生意：進不了貨架、原因是那一句；59 還做', () => {
    const g = mk()
    setMeter(g, 'hostility', 'f_alpha', 59)
    expect(shopView(g.k, g.state, 's_alpha').closed).toBeNull()
    setMeter(g, 'hostility', 'f_alpha', 60)
    const why = '這間店的後台勢力（阿爾法）對你的敵對值已經到了 60 以上，不做你的生意。'
    expect(refuseReason(g.k, g.k.content.get('shop', 's_alpha') as never, 60)).toBe(why)
    const v = shopView(g.k, g.state, 's_alpha')
    expect(v.closed).toBe(why)
    expect(v.shelf.length).toBeGreaterThan(0)
    expect(v.shelf.every((r) => r.block === why && r.pay.cred === why && r.pay.cash === why)).toBe(true)
    expect(() => checkout(g.k, g.state, 's_alpha', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cred' })).toThrow(why)
    expect(() => checkout(g.k, g.state, 's_alpha', { sell: [{ item: 'i_gun', qty: 1 }], pay: 'cred' })).toThrow(why)
    // 別間店（沒有後台勢力）不受影響
    expect(shopView(g.k, g.state, 's_beta').closed).toBeNull()
  })

  it('收購：這種店不收的類別有原因；no_sell、身上穿著的、有記號的那一件、背包裡沒有的也都有原因', () => {
    const g = mk()
    give(g, 'i_reg')
    give(g, 'i_junk')
    give(g, 'i_gun')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_reg')).toBe('這種店（雜貨店）不收登記的護甲這一類的東西。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_junk')).toBe('舊零件不能賣。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun')).toBeNull()
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 2)).toBe('背包裡能賣的手槍只有 1 個。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_med')).toBe('背包裡沒有醫療包。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_noprice')).toBe('沒標價的東西沒有定價，店不收。')
    // 身上穿著（gear 的格式：actor.ext.gear）
    g.state.actors.pc!.ext.gear = { carry: { main: 'i_gun' } }
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun')).toBe('手槍正穿戴在身上，先脫下來才能賣。')
    give(g, 'i_gun')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 2)).toBe('背包裡能賣的手槍只有 1 個。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun')).toBeNull()
    // 有實例資料的那一件（組裝的成品）：不指名是哪一件就賣不了（免得拿錯）；指名了（uid）才賣得了，見下一條
    g.state.inventory = [{ id: 'i_gun', qty: 1, data: { uid: 'u1' } }]
    g.state.actors.pc!.ext.gear = {}
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun')).toBe('手槍是有記號的那一件（組裝的成品或零件），賣的時候要指名是哪一件。')
  })

  it('指名賣有記號的那一件（uid）：價錢照目錄價；結帳只拿走那一件；穿戴中、沒有這一件、數量不夠都有原因', () => {
    const g = mk()
    g.state.inventory = [{ id: 'i_gun', qty: 1, data: { uid: 'u1', tune: 2 } }, { id: 'i_gun', qty: 1, data: { uid: 'u2' } }, { id: 'i_gun', qty: 1 }]
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 1, 'u1')).toBeNull()
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 1, 'u9')).toBe('背包裡沒有手槍（u9）這一件。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 2, 'u1')).toBe('那一件手槍只有 1 個。')
    // 穿戴中的那一件（gear 的格式：值是 uid）不能賣，別的實例不受影響
    g.state.actors.pc!.ext.gear = { worn: { main: 'u1' } }
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 1, 'u1')).toBe('手槍正穿戴在身上，先脫下來才能賣。')
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun', 1, 'u2')).toBeNull()
    // 價錢和一般的一把一樣（目錄價；店家倍率照常），結帳拿走的是指名的那一疊，沒有實例資料的那一把與別的實例都還在
    const plain = planCheckout(g.k, g.state, 's_beta', { sell: [{ item: 'i_gun', qty: 1 }], pay: 'cash' })
    const named = planCheckout(g.k, g.state, 's_beta', { sell: [{ item: 'i_gun', qty: 1, uid: 'u2' }], pay: 'cash' })
    expect(named.problems).toEqual([])
    expect(named.sell[0]).toMatchObject({ item: 'i_gun', uid: 'u2', unit: plain.sell[0]!.unit })
    const [r] = g.commit(checkout(g.k, g.state, 's_beta', { sell: [{ item: 'i_gun', qty: 1, uid: 'u2' }], pay: 'cash' }))
    expect(r!.changes.find((c) => c.op === 'item')).toMatchObject({ id: 'i_gun', qty: -1, data: { uid: 'u2' } })
    expect(g.state.inventory).toEqual([{ id: 'i_gun', qty: 1, data: { uid: 'u1', tune: 2 } }, { id: 'i_gun', qty: 1 }])
    expect(g.state.money.cash).toBe(500 + named.sellTotal)
  })

  it('購物車的 uid：只有賣的才能寫、要是非空字串；同一個 uid 的列合併；買的列不能寫', () => {
    const g = mk()
    g.state.inventory = [{ id: 'i_gun', qty: 2, data: { uid: 'u1' } }]
    const plan = (cart: object) => planCheckout(g.k, g.state, 's_beta', { pay: 'cash', ...cart })
    expect(plan({ sell: [{ item: 'i_gun', qty: 1, uid: 'u1' }, { item: 'i_gun', qty: 1, uid: 'u1' }] }).problems).toEqual([])
    expect(plan({ sell: [{ item: 'i_gun', qty: 3, uid: 'u1' }] }).problems).toEqual(['那一件手槍只有 2 個。'])
    expect(plan({ sell: [{ item: 'i_gun', qty: 1, uid: '' }] }).problems[0]).toContain('uid')
    expect(plan({ buy: [{ item: 'i_med', qty: 1, uid: 'u1' }] }).problems[0]).toContain('uid')
  })

  it('shopView：有記號的每一件各一列（帶 uid、能不能賣），一般的同一種物品合成一列', () => {
    const g = mk()
    g.state.inventory = [{ id: 'i_gun', qty: 1, data: { uid: 'u1' } }, { id: 'i_gun', qty: 2 }, { id: 'i_gun', qty: 1, data: { uid: 'u2' } }]
    g.state.actors.pc!.ext.gear = { worn: { main: 'u2' } }
    const sell = shopView(g.k, g.state, 's_beta').sell.filter((r) => r.item === 'i_gun')
    expect(sell.map((r) => [r.uid ?? null, r.qty, r.block])).toEqual([['u1', 1, null], [null, 2, null], ['u2', 1, '手槍正穿戴在身上，先脫下來才能賣。']])
  })

  it('同時有有記號的與沒有記號的：只賣沒有記號的，核心的 item 變更先拿沒有記號的那一疊', () => {
    const g = mk()
    g.state.inventory = [{ id: 'i_gun', qty: 1, data: { uid: 'u1' } }, { id: 'i_gun', qty: 1 }]
    g.commit(checkout(g.k, g.state, 's_beta', { sell: [{ item: 'i_gun', qty: 1 }], pay: 'cash' }))
    expect(g.state.inventory).toEqual([{ id: 'i_gun', qty: 1, data: { uid: 'u1' } }])
    expect(sellBlock(g.k, g.state, 's_beta', 'i_gun')).toBe('手槍是有記號的那一件（組裝的成品或零件），賣的時候要指名是哪一件。')
  })

  it('錢：只收現金的店選帳戶被擋；不收現金的店選現金被擋；兩種都收的店兩種都行', () => {
    const g = mk({
      pack: content((c) => {
        c.shop_type!.push({ ...T_GEN, id: 't_cash', cash: 'only' }, { ...T_GEN, id: 't_card', cash: false })
        c.shop!.push({ id: 's_cash', type: 't_cash', name: '黑攤', district: 'd_rust' }, { id: 's_card', type: 't_card', name: '正規店', district: 'd_rust' })
      }),
    })
    const buy = [{ item: 'i_med', qty: 1 }]
    expect(() => checkout(g.k, g.state, 's_cash', { buy, pay: 'cred' })).toThrow('這間店只收現金晶片。')
    expect(() => checkout(g.k, g.state, 's_card', { buy, pay: 'cash' })).toThrow('這間店不收現金晶片，要用帳戶。')
    expect(() => checkout(g.k, g.state, 's_cash', { buy, pay: 'cash' })).not.toThrow()
    expect(() => checkout(g.k, g.state, 's_card', { buy, pay: 'cred' })).not.toThrow()
    expect(() => checkout(g.k, g.state, 's_beta', { buy, pay: 'cred' })).not.toThrow()
    expect(() => checkout(g.k, g.state, 's_beta', { buy, pay: 'cash' })).not.toThrow()
    const v = shopView(g.k, g.state, 's_cash')
    expect(v).toMatchObject({ cash: 'only', pay: { cred: '這間店只收現金晶片。', cash: null } })
    // 登記的護甲選現金還是要被擋（兩條都不成立時先講登記類）
    expect(v.shelf.filter((r) => r.item !== 'i_reg').every((r) => r.pay.cred === '這間店只收現金晶片。' && r.pay.cash === null)).toBe(true)
    expect(v.shelf.find((r) => r.item === 'i_reg')!.pay.cash).toContain('一定要用帳戶')
    expect(shopView(g.k, g.state, 's_card')).toMatchObject({ cash: 'no', pay: { cred: null, cash: '這間店不收現金晶片，要用帳戶。' } })
    expect(shopView(g.k, g.state, 's_beta')).toMatchObject({ cash: 'yes', pay: { cred: null, cash: null } })
  })

  it('登記類：選現金被擋、選帳戶行；無籍的人帳戶也買不到（不掃橋的店不管）', () => {
    const g = mk({ pack: content((c) => { c.shop_type!.push({ ...T_GEN, id: 't_dark', scan_registered: false }); c.shop!.push({ id: 's_dark', type: 't_dark', name: '暗巷', district: 'd_rust' }) }) })
    const buy = [{ item: 'i_reg', qty: 1 }]
    expect(() => checkout(g.k, g.state, 's_beta', { buy, pay: 'cash' })).toThrow('登記類的登記的護甲一定要用帳戶買（買的時候要掃橋）。')
    expect(buyBlock(g.k, g.state, 's_beta', 'i_reg', 1, 'cash')).toContain('一定要用帳戶')
    expect(buyBlock(g.k, g.state, 's_beta', 'i_reg', 1, 'cred')).toBeNull()
    const row = shopView(g.k, g.state, 's_beta').shelf.find((r) => r.item === 'i_reg')!
    expect(row.block).toBeNull()
    expect(row.pay.cred).toBeNull()
    expect(row.pay.cash).toContain('一定要用帳戶')
    expect(buyBlock(g.k, g.state, 's_dark', 'i_reg', 1, 'cash')).toBeNull()
    g.state.actors.pc!.ext.identity = { class: 'unregistered' }
    expect(buyBlock(g.k, g.state, 's_beta', 'i_reg', 1, 'cred')).toBe('你是無籍，這間店不賣登記類的登記的護甲給你。')
    expect(shopView(g.k, g.state, 's_beta').shelf.find((r) => r.item === 'i_reg')!.block).toContain('你是無籍')
    expect(buyBlock(g.k, g.state, 's_beta', 'i_med', 1, 'cred')).toBeNull()
    expect(buyBlock(g.k, g.state, 's_dark', 'i_reg', 1, 'cred')).toBeNull()
    // 市民與社員沒問題
    g.state.actors.pc!.ext.identity = { class: 'member' }
    expect(buyBlock(g.k, g.state, 's_beta', 'i_reg', 1, 'cred')).toBeNull()
  })

  it('清單上沒有、買太多、沒有定價、買不到的：各有一句', () => {
    const g = mk({ pack: withRule({ list_size: [1, 1] }) })
    const listed = rows(g, 's_beta')[0]!
    const missing = ['i_gun', 'i_reg', 'i_med', 'i_food', 'i_junk'].find((i) => i !== listed.item)!
    expect(buyBlock(g.k, g.state, 's_beta', missing)).toMatch(/^今天的清單上沒有.+。$/)
    expect(buyBlock(g.k, g.state, 's_beta', listed.item, listed.total + 1)).toMatch(/^.+今天只剩 \d+ 個。$/)
    expect(buyBlock(g.k, g.state, 's_beta', 'i_noprice')).toBe('沒標價的東西沒有定價，店不賣。')
    expect(buyBlock(g.k, g.state, 's_beta', 'i_nothing')).toBe('沒有 i_nothing 這樣東西。')
  })
})

describe('結帳：買與賣同一台購物車', () => {
  it('一車裡買兩件、賣一件：淨額對、背包多了買的少了賣的、錢只動選的那一種、報告是 trade.checkout（deal）', () => {
    const g = mk()
    give(g, 'i_gun')
    const before = left(g, 'i_med', 's_beta')
    const draft = checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 2 }], sell: [{ item: 'i_gun', qty: 1 }], pay: 'cash' })
    expect(draft).toMatchObject({ kind: 'deal', action: 'trade.checkout' })
    expect(draft.changes.filter((c) => c.op === 'cred' || c.op === 'cash')).toEqual([{ op: 'cash', delta: -50 }])
    const [r] = g.commit(draft)
    expect(r!.action).toBe('trade.checkout')
    expect(g.state.money).toEqual({ cred: 1000, cash: 450 }) // 醫療包 50 × 0.9 = 45，×2 = 90；賣手槍 40；淨付 50
    expect(g.state.inventory).toEqual([{ id: 'i_med', qty: 2 }])
    expect(left(g, 'i_med', 's_beta')).toBe(before - 2)
    expect(r!.outcome.summary).toBe('在鏽帶攤子買了醫療包 ×2，賣了手槍 ×1；付了 50（現金晶片）。')
  })

  it('用帳戶結：現金不動；賣的比買的多：淨額收進來', () => {
    const g = mk()
    give(g, 'i_gun', 2)
    g.commit(checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_food', qty: 1 }], sell: [{ item: 'i_gun', qty: 2 }], pay: 'cred' }))
    expect(g.state.money).toEqual({ cred: 1000 + 79 - 9, cash: 500 }) // 罐頭 10 × 0.9 = 9；手槍 40 + 39（同一個貿易類別的第二件 −3%，M2-market）
    expect(g.state.inventory).toEqual([{ id: 'i_food', qty: 1 }])
  })

  it('只賣東西也行（淨額是收入）；只買東西也行', () => {
    const g = mk()
    give(g, 'i_med', 3)
    g.commit(checkout(g.k, g.state, 's_beta', { sell: [{ item: 'i_med', qty: 3 }], pay: 'cash' }))
    expect(g.state.money.cash).toBe(500 + 58) // 50 × 0.4 = 20；同類別第二、三件 −3%、−6%（M2-market）：20 + 19 + 19
    expect(g.state.inventory).toEqual([])
  })

  it('錢不夠時整車不結、狀態不變；原因寫出要付多少、有多少', () => {
    const g = mk({ money: { cred: 10, cash: 5 } })
    give(g, 'i_junk')
    const snapshot = JSON.stringify(g.state)
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_gun', qty: 1 }, { item: 'i_med', qty: 1 }], pay: 'cred' })).toThrow('帳戶不夠：這一車要付 135，你的帳戶只有 10。')
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_gun', qty: 1 }], pay: 'cash' })).toThrow('現金晶片不夠：這一車要付 90，你的現金晶片只有 5。')
    expect(JSON.stringify(g.state)).toBe(snapshot)
    // 賣出去的錢抵得上就可以
    give(g, 'i_gun', 2)
    expect(() => g.commit(checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], sell: [{ item: 'i_gun', qty: 2 }], pay: 'cred' }))).not.toThrow()
    // 先賣再買的順序：這一台車用淨額算，不會因為「先扣再收」卡住
    expect(g.state.money.cred).toBe(10 - 45 + 79)
  })

  it('任何一條不成立整車不結：好的那幾列也不結', () => {
    const g = mk()
    give(g, 'i_reg')
    const snapshot = JSON.stringify(g.state)
    const plan = planCheckout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], sell: [{ item: 'i_reg', qty: 1 }], pay: 'cash' })
    expect(plan.problems).toEqual(['這種店（雜貨店）不收登記的護甲這一類的東西。'])
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], sell: [{ item: 'i_reg', qty: 1 }], pay: 'cash' })).toThrow(ActionBlocked)
    expect(JSON.stringify(g.state)).toBe(snapshot)
  })

  it('空車、數量不對、同一樣東西又買又賣、沒選錢：都不結', () => {
    const g = mk()
    give(g, 'i_med')
    expect(() => checkout(g.k, g.state, 's_beta', { pay: 'cash' })).toThrow('購物車是空的。')
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 0 }], pay: 'cash' })).toThrow('i_med 的數量要是 1 以上的整數。')
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1.5 }], pay: 'cash' })).toThrow('數量要是 1 以上的整數')
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], sell: [{ item: 'i_med', qty: 1 }], pay: 'cash' })).toThrow('醫療包不能在同一車裡又買又賣。')
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], pay: 'gold' as never })).toThrow('要選一種錢來付')
    expect(() => checkout(g.k, g.state, 'no_such_shop', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cash' })).toThrow('沒有 no_such_shop 這間店。')
  })

  it('同一樣東西分兩列買會合併起來算數量（上限看今天剩下的）', () => {
    const g = mk()
    const total = left(g, 'i_med', 's_beta')
    expect(() => checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: total }, { item: 'i_med', qty: 1 }], pay: 'cash' })).toThrow(`醫療包今天只剩 ${total} 個。`)
    g.commit(checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }, { item: 'i_med', qty: 1 }], pay: 'cash' }))
    expect(g.state.inventory).toEqual([{ id: 'i_med', qty: 2 }])
  })

  it('用帳戶買違禁品：後台勢力的敵對值當場加；用現金不加；沒有後台勢力的店不加；沒有人定義敵對值時照常結', () => {
    const pack = content((c) => c.item!.push(item('i_black', { name: '黑貨', category: 'weapon', price: 80, legal: 'banned' })))
    const g = mk({ pack })
    g.commit(checkout(g.k, g.state, 's_alpha', { buy: [{ item: 'i_black', qty: 1 }], pay: 'cash' }))
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(0)
    day(g, 2)
    const r = g.commit(checkout(g.k, g.state, 's_alpha', { buy: [{ item: 'i_black', qty: 1 }], pay: 'cred' }))[0]!
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(DEFAULT_TRADE_RULES.dirty_hostility)
    expect(r.changes).toContainEqual({ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: DEFAULT_TRADE_RULES.dirty_hostility })
    g.commit(checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_black', qty: 1 }], pay: 'cred' }))
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(DEFAULT_TRADE_RULES.dirty_hostility)
    const bare = mk({ pack, meters: false })
    expect(() => bare.commit(checkout(bare.k, bare.state, 's_alpha', { buy: [{ item: 'i_black', qty: 1 }], pay: 'cred' }))).not.toThrow()
  })

  it('報告裡帳戶與現金分開記：changes 只有選的那一種', () => {
    const g = mk()
    const d1 = checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cred' })
    expect(d1.changes.some((c) => c.op === 'cash')).toBe(false)
    expect(d1.changes).toContainEqual({ op: 'cred', delta: -45 })
    const d2 = checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cash' })
    expect(d2.changes.some((c) => c.op === 'cred')).toBe(false)
  })
})

describe('活動擋住結帳', () => {
  it('有 commission 的替身活動進行時結帳被擋（白名單）；沒有活動時行', () => {
    const fake: Feature = {
      id: 'fake_commission',
      install(k) {
        k.activity.define({ kind: 'commission', owner: 'fake_commission', order: 90, active: (s) => (s.flags.in_commission ? { id: 'cm', label: '委託副本' } : null), allow: [], reason: () => '先把委託做完。' })
      },
    }
    const g = mk({ features: [fake] })
    const draft = checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cash' })
    g.commit(checkout(g.k, g.state, 's_beta', { buy: [{ item: 'i_food', qty: 1 }], pay: 'cash' }))
    g.commit({ kind: 'system', action: 'test.flag', location: { ...g.state.location }, party: [], timeline: [], changes: [{ op: 'flag', key: 'in_commission', value: true }], outcome: { result: 'ok', summary: '進副本。' } })
    expect(g.blockOf('commit:trade.checkout', draft)).toBe('先把委託做完。')
    const money = { ...g.state.money }
    expect(() => g.commit(draft)).toThrow(ActionBlocked)
    expect(g.state.money).toEqual(money)
  })
})

describe('設施與商店的畫面', () => {
  const stand = (g: G, block: string, at = 'F1'): void => { g.commit(arrive(g.k, g.state, block, at)) }

  it('站在設施上，列「進店」；後台勢力不做生意時灰掉並寫原因；別的格子沒有', () => {
    const g = mk()
    stand(g, 'b_market')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'trade.shop:s_alpha', name: '進店：蜂巢商行', block: null }])
    setMeter(g, 'hostility', 'f_alpha', 70)
    expect(g.gridView()!.here.uses).toEqual([{ id: 'trade.shop:s_alpha', name: '進店：蜂巢商行', block: expect.stringContaining('不做你的生意') }])
    stand(g, 'b_market', 'E1')
    expect(g.gridView()!.here.uses).toEqual([])
    stand(g, 'b_yard')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'trade.shop:s_beta', name: '進店：鏽帶攤子', block: null }])
  })

  it('shopView：抬頭（種類、區、店主與親密度、後台勢力、收哪幾種錢、脾氣）、貨架每一列的價錢與拆解、背包裡這間店收的東西與收購價', () => {
    const g = mk()
    setMeter(g, 'favor', 'f_alpha', 45)
    setMeter(g, 'affinity', 'npc_ann', 20)
    setMeter(g, 'hostility', 'f_alpha', 10)
    give(g, 'i_gun', 2)
    give(g, 'i_reg')
    give(g, 'i_noprice')
    const v = shopView(g.k, g.state, 's_alpha')
    expect(v.shop).toEqual({ id: 's_alpha', name: '蜂巢商行', type: 't_gen', typeName: '雜貨店', district: 'd_hive', districtName: '蜂巢' })
    expect(v.keeper).toEqual({ id: 'npc_ann', name: '安', affinity: 20 })
    expect(v.backer).toEqual({ id: 'f_alpha', name: '阿爾法', favor: 45, hostility: 10 })
    expect(v).toMatchObject({ cash: 'yes', temper: 0, scan_registered: true, closed: null, markup: 1 })
    expect(v.discount.total).toBeCloseTo(0.1, 9)
    const gun = v.shelf.find((r) => r.item === 'i_gun')!
    expect(gun).toMatchObject({ name: '手槍', grade: 2, category: 'weapon', legal: 'free', price: 97, left: 1, total: 1, block: null })
    expect(gun.quote.steps.map((s) => s.value)).toEqual([100, 90, 108, 108, 97, 97])
    expect(v.shelf.map((r) => r.item)).not.toContain('i_noprice')
    // 背包裡這間店收的：手槍（收購價 44）；登記的護甲這種店不收、沒標價的不收
    expect(v.sell).toMatchObject([{ item: 'i_gun', name: '手槍', qty: 2, price: 44, prices: [44, 43], quote: expect.anything(), block: null }])
  })

  it('敵對值 20～39 的 markup 是 1.1、40 以上是 1.2；沒有後台勢力與店主的店抬頭是 null', () => {
    const g = mk()
    setMeter(g, 'hostility', 'f_alpha', 10)
    expect(shopView(g.k, g.state, 's_alpha').markup).toBe(1)
    setMeter(g, 'hostility', 'f_alpha', 25)
    expect(shopView(g.k, g.state, 's_alpha').markup).toBe(1.1)
    setMeter(g, 'hostility', 'f_alpha', 45)
    expect(shopView(g.k, g.state, 's_alpha').markup).toBe(1.2)
    const v = shopView(g.k, g.state, 's_beta')
    expect(v.keeper).toBeNull()
    expect(v.backer).toBeNull()
  })

  it('shopView 的收購列：有穿著的那件扣掉；賣不了的列有原因', () => {
    const g = mk()
    give(g, 'i_gun', 2)
    give(g, 'i_junk')
    g.state.actors.pc!.ext.gear = { carry: { main: 'i_gun' } }
    const v = shopView(g.k, g.state, 's_beta')
    expect(v.sell.find((r) => r.item === 'i_gun')).toMatchObject({ qty: 1, block: null })
    expect(v.sell.find((r) => r.item === 'i_junk')).toMatchObject({ qty: 1, block: '舊零件不能賣。' })
  })
})

describe('內容的格式', () => {
  const bad = (patch: (c: Record<string, Rec[]>) => void) => () => mk({ pack: content(patch) })

  it('shop_type、shop、trade_rule 的格式不對在載入時擋下', () => {
    expect(bad((c) => { c.shop_type = [{ ...T_GEN, cash: 'maybe' }] })).toThrow(ContentError)
    expect(bad((c) => { c.shop_type = [{ ...T_GEN, shop_mult: 0 }] })).toThrow(ContentError)
    expect(bad((c) => { c.shop_type = [{ ...T_GEN, grade_max: 6 }] })).toThrow(ContentError)
    expect(bad((c) => { c.shop = [{ id: 's_x', type: 't_gen', name: 'x', district: 'd_rust', facility: 'F1' }] })).toThrow(ContentError)
    expect(bad((c) => { c.trade_rule = [{ id: 'default', buy_ratio: 2 }] })).toThrow(ContentError)
    expect(bad((c) => { c.trade_rule = [{ id: 'default', favor_bands: [20, 40], favor_discounts: [0.1] }] })).toThrow(ContentError)
  })

  it('shop 引用的店種、區、勢力、店主、固定貨品查不到時擋下；設施的標記不在那塊街區上也擋下', () => {
    const refs = (patch: Rec): (() => unknown) => bad((c) => { c.shop = [{ id: 's_x', type: 't_gen', name: 'x', district: 'd_rust', ...patch }] })
    expect(refs({ type: 't_nope' })).toThrow('shop_type/t_nope')
    expect(refs({ district: 'd_nope' })).toThrow('district/d_nope')
    expect(refs({ backer: 'f_nope' })).toThrow('faction/f_nope')
    expect(refs({ owner: 'npc_nope' })).toThrow('npc/npc_nope')
    expect(refs({ fixed: ['i_nope'] })).toThrow('item/i_nope')
    expect(refs({ block: 'b_yard', facility: 'F9' })).toThrow(ContentError)
    expect(refs({ block: 'b_market' })).toThrow(ContentError)
    expect(refs({ block: 'b_yard', facility: 'F1' })).not.toThrow()
  })
})

describe('存檔往返', () => {
  it('今天賣掉的數量還在；隔天自動重抽', () => {
    const g = mk()
    g.commit(checkout(g.k, g.state, 's_alpha', { buy: [{ item: 'i_med', qty: 1 }, { item: 'i_gun', qty: 1 }], pay: 'cred' }))
    const rowsBefore = rows(g)
    const raw = g.save()
    const other = mk()
    expect(other.load(raw)).toBeNull()
    expect(rows(other)).toEqual(rowsBefore)
    expect(left(other, 'i_gun')).toBe(0)
    expect(other.state.ext.trade).toEqual({ shops: { s_alpha: { day: 1, sold: { i_med: 1, i_gun: 1 } } } })
    day(other, 2)
    expect(left(other, 'i_gun')).toBe(1)
    // 隔天買東西時，前一天的紀錄清掉
    other.commit(checkout(other.k, other.state, 's_beta', { buy: [{ item: 'i_med', qty: 1 }], pay: 'cred' }))
    expect(Object.keys((other.state.ext.trade as { shops: object }).shops)).toEqual(['s_beta'])
  })
})
