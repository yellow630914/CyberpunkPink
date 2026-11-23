// 驗收測試：dev/work/M2-market.md（cpp-feature）。規格：TRADE 3.2（類別倍率、收購遞減、貨物）、第 4 節（4.1～4.3）、第 5 節（殺價）；CORE_RULES 第 3 節；dev/adr/0016 第三節。
// 內容一律用測試自帶的最小假資料：兩個區（A 電子 ×0.7、B 電子 ×1.3；各寫幾個夾值用的行情）、幾種店（脾氣 0、+1、null）、幾樣貨物與一般的東西。
// 量表：親密度、敵對值、好感用 testMeter；豔名與傾向用真的 lewd；人情用真的 favors（兩個都是 L6 功能，測試可以一起裝）。
// 殺價的骰子：換 state.seq.chain 找出想要的骰面（行動的骰面只看存檔的亂數與這個序號），再用 Game.act 真的跑一次主動行動。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx, prepareAction } from '../../src'
import { favorsFeature } from '../../src/features/favors'
import { lewdFeature } from '../../src/features/lewd'
import {
  DEFAULT_TRADE_RULES, bargainBlock, bargainByFavor, bargainDc, bargainInput, bargainView, buyBlock, checkout, closedToday, intakeCount, marketMult, planCheckout, quote, routesHint,
  sellPrices, shopBlock, shopView, tradeCategoryOf, tradeFeature, tradeOf,
} from '../../src/features/trade'
import type { BargainMethod } from '../../src/features/trade'
import type { FakeProviderOpts } from '../../src/shell/ai/fakeProvider'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>
const item = (id: string, more: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS: Rec[] = [
  item('i_chip', { name: '偶像晶片（貨物）', category: 'cargo', cargo: true, tags: ['electronics'], price: 100 }),
  item('i_plainchip', { name: '一般晶片', tags: ['electronics'], price: 100 }),
  item('i_gun', { name: '手槍', category: 'weapon', price: 100 }),
  item('i_bulk', { name: '子彈（散裝）', category: 'ammo', price: 1000 }),
  item('i_bulk2', { name: '子彈（盒裝）', category: 'ammo', price: 1000 }),
  item('i_food', { name: '罐頭', category: 'consumable', tags: ['food'], price: 100 }),
  item('i_med', { name: '醫療包', category: 'consumable', tags: ['medical'], price: 100 }),
  item('i_rug', { name: '地毯', category: 'misc', trade_category: 'furniture', price: 100 }),
  item('i_part', { name: '零件', category: 'part', price: 100 }),
  item('i_suit', { name: '西裝', category: 'clothing', price: 100 }),
  item('i_perfume', { name: '香水', category: 'misc', trade_category: 'luxury', price: 100 }),
]

// 兩個區：A（電子 ×0.7、奢侈品 3 → 夾成 2.5、武器 0.1 → 夾成 0.5）、B（電子 ×1.3）；C 沒有寫行情
const DISTRICTS_CONTENT = [
  { id: 'd_a', name: '甲區', market: { electronics: 0.7, luxury: 3, weapon: 0.1 } },
  { id: 'd_b', name: '乙區', price_mult: 1, market: { electronics: 1.3 } },
  { id: 'd_c', name: '丙區' },
]
const BUYS = ['misc', 'ammo', 'weapon', 'consumable', 'electronics', 'cargo', 'part', 'clothing', 'luxury', 'furniture']
const SHOP_TYPES = [
  { id: 't_gen', name: '雜貨店', catalog: ['weapon'], buys: BUYS, grade_max: 3, cash: true, shop_mult: 1, temper: 0 },
  { id: 't_hard', name: '難纏的店', catalog: ['weapon'], buys: BUYS, grade_max: 3, cash: true, shop_mult: 1, temper: 1 },
  { id: 't_corp', name: '原廠直營', catalog: ['weapon'], buys: BUYS, grade_max: 3, cash: true, shop_mult: 1, temper: null },
]
const SHOPS = [
  // 甲區的店：有店主（安）、後台是幫派（貝塔）
  { id: 's_a', type: 't_gen', name: '甲區商行', district: 'd_a', owner: 'npc_ann', backer: 'f_beta', fixed: ['i_chip', 'i_gun', 'i_plainchip'] },
  { id: 's_b', type: 't_gen', name: '乙區攤子', district: 'd_b', fixed: ['i_chip', 'i_plainchip', 'i_gun'] },
  { id: 's_c', type: 't_gen', name: '丙區小店', district: 'd_c', fixed: ['i_gun'] },
  { id: 's_hard', type: 't_hard', name: '難纏的店', district: 'd_c', owner: 'npc_ann', fixed: ['i_gun'] },
  { id: 's_corp', type: 't_corp', name: '原廠店', district: 'd_c', backer: 'f_alpha', fixed: ['i_gun'] },
  { id: 's_corpgen', type: 't_gen', name: '企業旗下的店', district: 'd_c', backer: 'f_alpha', fixed: ['i_gun'] },
]
const BARGAIN = { id: 'bargain', name: '殺價', desc: '殺價。', attr: 'charm', skill: 'negotiate', dc: 'normal', minutes: 15, max_minutes: 60, owner: 'trade' }

const content = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    skill: [
      { id: 'negotiate', name: '交涉', attr: 'charm', desc: '講價、說服。' },
      { id: 'seduce', name: '誘惑', attr: 'charm', desc: '撒嬌、放電。' },
      { id: 'intimidate', name: '威嚇', attr: 'resolve', desc: '施壓。' },
    ],
    district: structuredClone(DISTRICTS_CONTENT), item: structuredClone(ITEMS), shop_type: structuredClone(SHOP_TYPES), shop: structuredClone(SHOPS), action_kind: [structuredClone(BARGAIN)],
  }
  patch(c)
  return { id: 'market_test', content: c as unknown as ContentPack['content'] }
}

/** 區是別的功能（world）的內容種類：測試自己定義（量表的鍵、店的引用要查得到區）。 */
const DISTRICTS: Feature = { id: 'test_districts', install: (k: Kernel) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }

const METERS = [
  testMeter({ kind: 'favor', owner: 't', name: '好感', keyed: 'faction' }),
  testMeter({ kind: 'hostility', owner: 't', name: '敵對值', keyed: 'faction' }),
  testMeter({ kind: 'affinity', owner: 't', name: '親密度', keyed: 'npc', min: -100 }),
]

interface Opts {
  pack?: ContentPack
  features?: Feature[]
  /** 不裝人情、傾向（lewd 也提供豔名）：測「沒有人註冊的那一種殺法不列」 */
  bare?: boolean
  fake?: FakeProviderOpts
  charm?: number
}
const mk = (o: Opts = {}) =>
  makeGame({
    features: [meterFeature(...METERS), DISTRICTS, ...(o.bare ? [] : [lewdFeature, favorsFeature]), tradeFeature, ...(o.features ?? [])],
    content: [METER_CONTENT, o.pack ?? content()],
    patch: { money: { cred: 100_000, cash: 100_000 } },
    ...(o.fake ? { fake: o.fake } : {}),
    ...(o.charm ? { pc: { attrs: { charm: o.charm } } } : {}),
  }).game
type G = ReturnType<typeof mk>

const setMeter = (g: G, kind: string, key: string, v: number): void => { (g.state.meters[kind] ??= {})[key] = v }
const day = (g: G, d: number): void => { g.state.time = { ...g.state.time, day: d } }
const give = (g: G, id: string, qty = 1): void => { g.state.inventory.push({ id, qty }) }
const buyPrice = (g: G, shop: string, it: string): number => quote(g.k, g.state, shop, it, 'buy').price
const sellPrice = (g: G, shop: string, it: string): number => quote(g.k, g.state, shop, it, 'sell').price
const draft = (changes: Change[], action = 'test.give'): ReportDraft => ({
  kind: 'event', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const owe = (g: G, who: string, size = 'small'): void => { g.commit(draft([{ op: 'favor.add', dir: 'owed_to_pc', who, size }])) }
const trade = (g: G) => tradeOf(g.state)

/** 換 state.seq.chain，找到擲出指定骰面的那一個（行動的骰面只看存檔的亂數與這個序號）。 */
function rig(g: G, shop: string, method: BargainMethod, natural: number): void {
  const input = bargainInput(g.k, g.state, shop, method)
  for (let c = 0; c < 5000; c++) {
    g.state.seq.chain = c
    if (prepareAction(g.k, g.state, input).roll.natural === natural) return
  }
  throw new Error(`找不到擲出 ${natural} 的序號`)
}
/** 想要的成功程度 → 骰面（PC 魅力 10、基本功 0、DC 13：大成功 20、成功 15、失敗 10、大失敗 1）。 */
const DIE = { critical: 20, success: 15, fail: 10, fumble: 1 } as const

/** 用骰面擲一次殺價（Game.act 真的跑一次主動行動）。 */
async function haggle(g: G, shop: string, degree: keyof typeof DIE, method: BargainMethod = 'haggle') {
  rig(g, shop, method, DIE[degree])
  return g.act(bargainInput(g.k, g.state, shop, method))
}

describe('類別的行情（TRADE 4.2）', () => {
  it('電子在一區 ×0.7、另一區 ×1.3：同一件貨物兩邊的買價與賣價對得上，拆解的「類別的行情」那一步是區的行情', () => {
    const g = mk()
    const buyA = quote(g.k, g.state, 's_a', 'i_chip', 'buy')
    expect(buyA.price).toBe(70)
    expect(buyA.steps.map((s) => [s.id, s.mult, s.value])).toEqual([['catalog', 1, 100], ['shop', 1, 100], ['district', 1, 100], ['category', 0.7, 70], ['discount', 1, 70], ['hostility', 1, 70]])
    expect(buyPrice(g, 's_b', 'i_chip')).toBe(130)
    // 賣也乘行情：貨物 90% × 區的收購倍率（物價 1 就是 1）× 行情
    const sellB = quote(g.k, g.state, 's_b', 'i_chip', 'sell')
    expect(sellB.price).toBe(117)
    expect(sellB.steps.map((s) => [s.id, s.mult, s.value])).toEqual([['catalog', 1, 100], ['ratio', 0.9, 90], ['sell_district', 1, 90], ['category', 1.3, 117], ['sell_bonus', 1, 117]])
    expect(sellPrice(g, 's_a', 'i_chip')).toBe(63)
  })

  it('貨物在甲區買、乙區賣：價差就是利潤（真的結帳，現金差額對得上）；一般的東西（收購 40%）搬了是虧的', () => {
    const g = mk()
    const start = g.state.money.cred
    g.commit(checkout(g.k, g.state, 's_a', { buy: [{ item: 'i_chip', qty: 1 }], pay: 'cred' }))
    g.commit(checkout(g.k, g.state, 's_b', { sell: [{ item: 'i_chip', qty: 1 }], pay: 'cred' }))
    expect(g.state.money.cred - start).toBe(117 - 70)
    expect(g.state.inventory).toEqual([])
    // 一般的晶片（另開一局：同一間店同一個類別剛收過貨物，會接著遞減）：甲區買 70、乙區賣 100 × 0.4 × 1.3 = 52
    const h = mk()
    expect(buyPrice(h, 's_a', 'i_plainchip')).toBe(70)
    expect(sellPrice(h, 's_b', 'i_plainchip')).toBe(52)
    const before = h.state.money.cred
    h.commit(checkout(h.k, h.state, 's_a', { buy: [{ item: 'i_plainchip', qty: 1 }], pay: 'cred' }))
    h.commit(checkout(h.k, h.state, 's_b', { sell: [{ item: 'i_plainchip', qty: 1 }], pay: 'cred' }))
    expect(h.state.money.cred - before).toBe(52 - 70)
    expect(52 - 70).toBeLessThan(0)
    // 同一局裡貨物賣過之後，同一個類別（電子）接著遞減：52 × 0.97 = 50
    expect(sellPrice(g, 's_b', 'i_plainchip')).toBe(50)
  })

  it('貨物的收購比例是 90%（別的東西照預設 40%）；存檔規則 trade_rule 可以改兩個比例', () => {
    const g = mk()
    expect(quote(g.k, g.state, 's_c', 'i_chip', 'sell').steps[1]).toEqual({ id: 'ratio', name: '收購比例', mult: 0.9, value: 90 })
    expect(quote(g.k, g.state, 's_c', 'i_plainchip', 'sell').steps[1]).toEqual({ id: 'ratio', name: '收購比例', mult: 0.4, value: 40 })
    // category: cargo 沒寫 cargo: true 也算貨物
    expect(quote(g.k, g.state, 's_c', 'i_chip', 'sell').price).toBe(90)
    const h = mk({ pack: content((c) => { c.item!.push(item('i_crate', { category: 'cargo', price: 100 })); c.trade_rule = [{ id: 'default', cargo_ratio: 0.8, buy_ratio: 0.5 }] }) })
    expect(sellPrice(h, 's_c', 'i_crate')).toBe(80)
    expect(sellPrice(h, 's_c', 'i_plainchip')).toBe(50)
  })

  it('行情寫 3 被夾成 2.5；寫 0.1 被夾成 0.5；整體幅度（market_scale）可以在規則裡調', () => {
    const g = mk()
    expect(marketMult(g.k, 'd_a', 'luxury')).toBe(2.5)
    expect(marketMult(g.k, 'd_a', 'weapon')).toBe(0.5)
    expect(quote(g.k, g.state, 's_a', 'i_perfume', 'buy').steps.find((s) => s.id === 'category')).toEqual({ id: 'category', name: '類別的行情', mult: 2.5, value: 250 })
    expect(buyPrice(g, 's_a', 'i_gun')).toBe(50)
    expect(marketMult(g.k, 'd_a', 'food')).toBe(1)
    expect(marketMult(g.k, 'd_c', 'electronics')).toBe(1)
    expect(marketMult(g.k, undefined, 'electronics')).toBe(1)
    // 幅度 ×0.5：電子 0.7 → 1 + (0.7 − 1) × 0.5 = 0.85；3 → 2（沒到上限）
    const h = mk({ pack: content((c) => { c.trade_rule = [{ id: 'default', market_scale: 0.5 }] }) })
    expect(marketMult(h.k, 'd_a', 'electronics')).toBe(0.85)
    expect(marketMult(h.k, 'd_a', 'luxury')).toBe(2)
    // 上下限也是規則
    const j = mk({ pack: content((c) => { c.trade_rule = [{ id: 'default', market_min: 0.8, market_max: 1.5 }] }) })
    expect(marketMult(j.k, 'd_a', 'luxury')).toBe(1.5)
    expect(marketMult(j.k, 'd_a', 'weapon')).toBe(0.8)
  })

  it('貿易類別：寫了 trade_category 照寫的；沒寫先看標籤、再看物品的類別；規則可以改對照', () => {
    const g = mk()
    const cat = (id: string) => tradeCategoryOf(g.k, g.k.content.get('item', id) as never)
    expect(cat('i_rug')).toBe('furniture')
    expect(cat('i_perfume')).toBe('luxury')
    expect(cat('i_chip')).toBe('electronics') // 標籤
    expect(cat('i_food')).toBe('food')
    expect(cat('i_med')).toBe('medicine')
    expect(cat('i_gun')).toBe('weapon')
    expect(cat('i_suit')).toBe('apparel')
    expect(cat('i_part')).toBe('mech')
    expect(cat('i_bulk')).toBe('ammo')
    expect(cat('i_plainchip')).toBe('electronics')
    const h = mk({ pack: content((c) => { c.trade_rule = [{ id: 'default', category_by_category: { weapon: 'luxury' } }] }) })
    expect(tradeCategoryOf(h.k, h.k.content.get('item', 'i_gun') as never)).toBe('luxury')
  })

  it('資料錯誤擋下：行情的類別不存在、倍率不是正數、物品的 trade_category 查不到、cargo 不是布林值、規則的類別對照指向不存在的類別', () => {
    const bad = (patch: (c: Record<string, Rec[]>) => void) => () => mk({ pack: content(patch) })
    expect(bad((c) => { c.district![0]!.market = { gems: 1.2 } })).toThrow(ContentError)
    expect(bad((c) => { c.district![0]!.market = { weapon: 0 } })).toThrow('market.weapon')
    expect(bad((c) => { c.district![0]!.market = [1] })).toThrow('market 要是')
    expect(bad((c) => { c.item![0]!.trade_category = 'gems' })).toThrow('trade_category')
    expect(bad((c) => { c.item![0]!.cargo = 'yes' })).toThrow('cargo')
    expect(bad((c) => { c.trade_rule = [{ id: 'default', category_by_tag: { food: 'gems' } }] })).toThrow(ContentError)
    expect(bad((c) => { c.trade_rule = [{ id: 'default', market_min: 3, market_max: 2 }] })).toThrow(ContentError)
    expect(bad((c) => { c.trade_rule = [{ id: 'default', decay_step: 2 }] })).toThrow(ContentError)
    expect(bad((c) => { c.trade_rule = [{ id: 'default', bargain_results: { critical: { mult: 0.8, affinity: 2 } } }] })).toThrow(ContentError)
    expect(bad((c) => { c.action_kind!.push({ ...BARGAIN, id: 'haggle2' }) })).toThrow('交易只認 bargain')
    // 沒有 bargain 那一筆：照樣能載入，只是沒有殺價這種行動
    const g = mk({ pack: content((c) => { c.action_kind = [] }) })
    expect(g.k.actions.get('bargain')).toBeUndefined()
    expect(shopView(g.k, g.state, 's_a').bargain.options.map((o) => o.method)).toContain('haggle')
  })

  it('routesHint：這樣東西在哪幾區便宜、哪幾區貴，與最好的買處賣處；貨物差價是正的、一般的東西是負的', () => {
    const g = mk()
    const chip = routesHint(g.k, g.state, 'i_chip')
    expect(chip).toMatchObject({ item: 'i_chip', category: 'electronics', categoryName: '電子', cargo: true, cheap: ['d_a'], dear: ['d_b'] })
    expect(chip.rows.map((r) => [r.district, r.market, r.verdict, r.buy, r.sell])).toEqual([['d_a', 0.7, 'cheap', 70, 63], ['d_c', 1, 'even', 100, 90], ['d_b', 1.3, 'dear', 130, 117]])
    expect(chip.best).toEqual({ buy: { district: 'd_a', price: 70 }, sell: { district: 'd_b', price: 117 }, margin: 47 })
    const plain = routesHint(g.k, g.state, 'i_plainchip')
    expect(plain.cargo).toBe(false)
    expect(plain.best!.margin).toBe(52 - 70)
    expect(routesHint(g.k, g.state, 'i_gun')).toMatchObject({ cheap: ['d_a'], dear: [], category: 'weapon' })
    expect(() => routesHint(g.k, g.state, 'i_nothing')).toThrow('沒有定價')
  })
})

describe('收購遞減（TRADE 3.2）', () => {
  it('同一類賣第 1、2、18 件的收購價各是 100%、97%、50%（照順序）；買不受影響', () => {
    const g = mk()
    give(g, 'i_bulk', 18)
    const plan = planCheckout(g.k, g.state, 's_c', { sell: [{ item: 'i_bulk', qty: 18 }], pay: 'cred' })
    expect(plan.problems).toEqual([])
    const prices = plan.sell[0]!.prices
    expect(prices).toHaveLength(18)
    expect(prices[0]).toBe(400) // 1000 × 40%
    expect(prices[1]).toBe(388) // × 97%
    expect(prices[2]).toBe(376)
    expect(prices[16]).toBe(208) // 第 17 件：−48%
    expect(prices[17]).toBe(200) // 第 18 件：−51% 被夾在 −50%
    expect(plan.sell[0]!.unit).toBe(400)
    expect(plan.sell[0]!.total).toBe(prices.reduce((a, b) => a + b, 0))
    expect(plan.sell[0]!.quote.steps.map((s) => s.id)).toEqual(['catalog', 'ratio', 'sell_district', 'category', 'sell_bonus']) // 第一件沒有遞減
    // 用 quote 的 taken 看每一步的倍率
    expect(quote(g.k, g.state, 's_c', 'i_bulk', 'sell', { taken: 1 }).steps.find((s) => s.id === 'decay')).toEqual({ id: 'decay', name: '收購遞減', mult: 0.97, value: 388 })
    expect(quote(g.k, g.state, 's_c', 'i_bulk', 'sell', { taken: 17 }).steps.find((s) => s.id === 'decay')).toEqual({ id: 'decay', name: '收購遞減', mult: 0.5, value: 200 })
    expect(quote(g.k, g.state, 's_c', 'i_bulk', 'sell', { taken: 500 }).price).toBe(200)
    // 結帳的錢是每一件各自的價錢加起來，報告列出每一件
    const before = g.state.money.cash
    const [r] = g.commit(checkout(g.k, g.state, 's_c', { sell: [{ item: 'i_bulk', qty: 18 }], pay: 'cash' }))
    expect(g.state.money.cash - before).toBe(plan.sell[0]!.total)
    expect(r!.narration?.results?.[0]).toContain('400 起遞減到 200')
    // 買的價錢不受影響
    expect(buyPrice(g, 's_c', 'i_gun')).toBe(100)
  })

  it('賣得少時報告列出每一件的價錢；同一件的 qty、單價 × 個數在沒有遞減時照舊', () => {
    const g = mk()
    give(g, 'i_bulk', 3)
    const [r] = g.commit(checkout(g.k, g.state, 's_c', { sell: [{ item: 'i_bulk', qty: 3 }], pay: 'cash' }))
    expect(r!.narration?.results?.[0]).toBe('賣 子彈（散裝） ×3：400 + 388 + 376 = 1,164')
    // 沒有遞減的（不同類別各一件）仍是單價 × 個數
    const h = mk()
    give(h, 'i_gun'); give(h, 'i_plainchip')
    const [r2] = h.commit(checkout(h.k, h.state, 's_c', { sell: [{ item: 'i_gun', qty: 1 }, { item: 'i_plainchip', qty: 1 }], pay: 'cash' }))
    expect(r2!.narration?.results?.[0]).toBe('賣 手槍 ×1：40 × 1 = 40')
  })

  it('累計記在那間店那個類別：賣掉之後再報價，價錢是接著遞減的；別間店、別的類別不受影響；同車裡同類別的兩種東西接著算', () => {
    const g = mk()
    give(g, 'i_bulk', 2); give(g, 'i_bulk2', 2); give(g, 'i_gun')
    g.commit(checkout(g.k, g.state, 's_c', { sell: [{ item: 'i_bulk', qty: 2 }], pay: 'cash' }))
    expect(intakeCount(g.k, g.state, 's_c', 'ammo')).toBe(2)
    expect(sellPrice(g, 's_c', 'i_bulk2')).toBe(376) // 第 3 件
    expect(sellPrice(g, 's_c', 'i_gun')).toBe(40) // 武器沒賣過
    expect(sellPrice(g, 's_b', 'i_bulk2')).toBe(400) // 別間店
    expect(trade(g).intake).toEqual({ s_c: { ammo: { n: 2, day: 1 } } })
    // 同一台車裡兩種同類別的東西：照購物車的順序接著遞減
    give(g, 'i_bulk')
    const plan = planCheckout(g.k, g.state, 's_b', { sell: [{ item: 'i_bulk', qty: 1 }, { item: 'i_bulk2', qty: 2 }], pay: 'cash' })
    expect(plan.problems).toEqual([])
    expect(plan.sell.map((l) => l.prices)).toEqual([[400], [388, 376]])
    // shopView 的收購那一列帶著累計與遞減
    const row = shopView(g.k, g.state, 's_c').sell.find((r) => r.item === 'i_bulk2')!
    expect(row).toMatchObject({ tradeCategory: 'ammo', tradeCategoryName: '彈藥', cargo: false, taken: 2, decay: 0.94, price: 376, prices: [376, 364] })
    expect(sellPrices(g.k, g.state, g.k.content.get('shop', 's_c') as never, 'i_bulk2', 2).prices).toEqual([376, 364])
  })

  it('隔天回復 5 件；賣了 18 件之後：隔天剩 13、第四天回復完；存檔往返記得', () => {
    const g = mk()
    give(g, 'i_bulk', 18)
    g.commit(checkout(g.k, g.state, 's_c', { sell: [{ item: 'i_bulk', qty: 18 }], pay: 'cash' }))
    expect(intakeCount(g.k, g.state, 's_c', 'ammo')).toBe(18)
    const raw = g.save()
    day(g, 2)
    expect(intakeCount(g.k, g.state, 's_c', 'ammo')).toBe(13)
    expect(sellPrice(g, 's_c', 'i_bulk')).toBe(244) // 1000 × 0.4 × (1 − 0.39)
    day(g, 3)
    expect(intakeCount(g.k, g.state, 's_c', 'ammo')).toBe(8)
    day(g, 5)
    expect(intakeCount(g.k, g.state, 's_c', 'ammo')).toBe(0)
    expect(sellPrice(g, 's_c', 'i_bulk')).toBe(400)
    // 存檔往返
    const other = mk()
    expect(other.load(raw)).toBeNull()
    expect(intakeCount(other.k, other.state, 's_c', 'ammo')).toBe(18)
    day(other, 2)
    expect(intakeCount(other.k, other.state, 's_c', 'ammo')).toBe(13)
    // 回復完的紀錄在下一次結帳時清掉
    day(g, 9)
    give(g, 'i_gun')
    g.commit(checkout(g.k, g.state, 's_c', { sell: [{ item: 'i_gun', qty: 1 }], pay: 'cash' }))
    expect(trade(g).intake).toEqual({ s_c: { weapon: { n: 1, day: 9 } } })
  })

  it('遞減的上限、每件的折數與回復的件數都是規則（trade_rule）', () => {
    const g = mk({ pack: content((c) => { c.trade_rule = [{ id: 'default', decay_step: 0.1, decay_max: 0.3, decay_recover: 1 }] }) })
    expect(quote(g.k, g.state, 's_c', 'i_bulk', 'sell', { taken: 2 }).price).toBe(320)
    expect(quote(g.k, g.state, 's_c', 'i_bulk', 'sell', { taken: 9 }).price).toBe(280)
    give(g, 'i_bulk', 4)
    g.commit(checkout(g.k, g.state, 's_c', { sell: [{ item: 'i_bulk', qty: 4 }], pay: 'cash' }))
    day(g, 3)
    expect(intakeCount(g.k, g.state, 's_c', 'ammo')).toBe(2)
    expect(DEFAULT_TRADE_RULES).toMatchObject({ decay_step: 0.03, decay_max: 0.5, decay_recover: 5, cargo_ratio: 0.9, market_min: 0.5, market_max: 2.5 })
  })
})

describe('殺價的 DC（TRADE 第 5 節）', () => {
  it('DC = 13 − ⌊店主親密度 ÷ 25⌋ ＋ 店的脾氣：親密度 50、脾氣 +1 → 12；負的親密度向下取整（−10 → +1）；沒有店主是 0', () => {
    const g = mk()
    setMeter(g, 'affinity', 'npc_ann', 50)
    expect(bargainDc(g.k, g.state, 's_hard')).toBe(12)
    expect(bargainDc(g.k, g.state, 's_a')).toBe(11) // 脾氣 0
    setMeter(g, 'affinity', 'npc_ann', 24)
    expect(bargainDc(g.k, g.state, 's_a')).toBe(13)
    setMeter(g, 'affinity', 'npc_ann', 100)
    expect(bargainDc(g.k, g.state, 's_a')).toBe(9)
    setMeter(g, 'affinity', 'npc_ann', -10)
    expect(bargainDc(g.k, g.state, 's_a')).toBe(14)
    expect(bargainDc(g.k, g.state, 's_c')).toBe(13) // 沒有店主
    // 行動真的擲的就是這個 DC
    setMeter(g, 'affinity', 'npc_ann', 50)
    expect(prepareAction(g.k, g.state, bargainInput(g.k, g.state, 's_hard', 'haggle')).roll.dc).toBe(12)
    expect(prepareAction(g.k, g.state, bargainInput(g.k, g.state, 's_hard', 'haggle')).refDc).toBe(12)
    // 存檔難度的偏移照加
    g.state.rules = { ...g.state.rules, dcOffset: 2 }
    expect(prepareAction(g.k, g.state, bargainInput(g.k, g.state, 's_hard', 'haggle')).refDc).toBe(14)
    expect(bargainView(g.k, g.state, 's_hard').options.find((o) => o.method === 'haggle')!.dc).toBe(14)
    expect(bargainView(g.k, g.state, 's_hard').dc).toBe(12)
  })

  it('不能殺價的店（temper 是 null）有原因：bargainBlock、bargainView、直接送出行動都一樣；沒寫 temper 的店當一般的店', () => {
    const g = mk()
    expect(bargainDc(g.k, g.state, 's_corp')).toBeNull()
    expect(bargainBlock(g.k, g.state, 's_corp', 'haggle')).toBe('原廠店不能殺價（原廠直營的店只談長期折扣）。')
    const v = bargainView(g.k, g.state, 's_corp')
    expect(v).toMatchObject({ dc: null, options: [], block: '原廠店不能殺價（原廠直營的店只談長期折扣）。' })
    expect(shopView(g.k, g.state, 's_corp').temper).toBeNull()
    expect(() => prepareAction(g.k, g.state, bargainInput(g.k, g.state, 's_corp', 'haggle'))).toThrow(ActionBlocked)
    const h = mk({ pack: content((c) => { delete (c.shop_type![0] as Rec).temper }) })
    expect(bargainDc(h.k, h.state, 's_c')).toBe(13)
    expect(shopView(h.k, h.state, 's_c').temper).toBe(0)
  })

  it('不認得的殺法、沒有店、沒有選店的送出都被擋下並有原因', async () => {
    const g = mk()
    expect(bargainBlock(g.k, g.state, 's_c', 'nag')).toBe('不知道「nag」這種殺法。')
    expect(bargainBlock(g.k, g.state, 's_nope', 'haggle')).toBe('沒有 s_nope 這間店。')
    const seq = g.state.seq.report
    expect((await g.act({ kind: 'bargain' })).reason).toBe('要先選一間店。')
    expect((await g.act({ kind: 'bargain', shop: 's_c' } as never)).reason).toBe('要先選一種殺法。')
    expect((await g.act({ kind: 'bargain', shop: 's_c', method: 'favor' } as never)).reason).toContain('不用擲骰')
    expect(g.state.seq.report).toBe(seq)
  })
})

describe('殺價的結果（固定骰面，Game.act 真的擲一次）', () => {
  // buy／sell：甲區的店的手槍（武器行情 ×0.5，買 50、收購 40 × 0.5 = 20）殺價之後的價錢；hard：難纏的店（沒有行情）的手槍（買 100、收購 40）
  const table = [
    { degree: 'critical', mult: 0.8, aff: 2, buy: 40, sell: 25, hard: [80, 50] },
    { degree: 'success', mult: 0.9, aff: 0, buy: 45, sell: 22, hard: [90, 44] },
    { degree: 'fail', mult: 1, aff: 0, buy: 50, sell: 20, hard: [100, 40] },
    { degree: 'fumble', mult: 1.1, aff: -3, buy: 55, sell: 18, hard: [110, 36] },
  ] as const
  for (const t of table) {
    it(`${t.degree}：價錢 ×${t.mult}（買的乘、賣的除以）、店主親密度 ${t.aff >= 0 ? '+' : ''}${t.aff}；報告是 bargain 自己的報告`, async () => {
      const g = mk()
      expect([buyPrice(g, 's_a', 'i_gun'), sellPrice(g, 's_a', 'i_gun'), buyPrice(g, 's_c', 'i_gun')]).toEqual([50, 20, 100])
      const { status, reports } = await haggle(g, 's_a', t.degree)
      expect(status).toBe('applied')
      expect(reports).toHaveLength(1)
      const r = reports[0]!
      expect(r.action).toBe('bargain')
      expect(r.outcome.result).toBe(t.degree)
      expect(r.timeline[0]!.roll!.natural).toBe(DIE[t.degree])
      expect(r.narration?.results?.length).toBe(1)
      // 倍率與紀錄
      expect(trade(g).bargains).toEqual({ s_a: { day: 1, mult: t.mult, method: 'haggle', degree: t.degree } })
      expect(g.state.meters.affinity?.npc_ann ?? 0).toBe(t.aff)
      // 這間店今天：買的乘、賣的除以（拆解多一步「殺價」）
      const buy = quote(g.k, g.state, 's_a', 'i_gun', 'buy')
      expect(buy.steps.at(-1)).toEqual({ id: 'bargain', name: '殺價', mult: t.mult, value: buy.price })
      expect(buy.price).toBe(t.buy)
      const sell = quote(g.k, g.state, 's_a', 'i_gun', 'sell')
      expect(sell.steps.at(-1)).toEqual({ id: 'bargain', name: '殺價', mult: expect.closeTo(1 / t.mult, 5), value: sell.price })
      expect(sell.price).toBe(t.sell)
      // 別間店不受影響
      expect(buyPrice(g, 's_c', 'i_gun')).toBe(100)
      expect(sellPrice(g, 's_c', 'i_gun')).toBe(40)
    })
  }

  it('殺過之後今天這間店的買價與賣價：一件沒有行情的東西（難纏的店的手槍）對得上表：買 100 × 倍率、收購 40 ÷ 倍率', async () => {
    const out: Array<readonly [number, number]> = []
    for (const t of table) {
      const h = mk()
      await haggle(h, 's_hard', t.degree)
      out.push([buyPrice(h, 's_hard', 'i_gun'), sellPrice(h, 's_hard', 'i_gun')])
    }
    expect(out).toEqual(table.map((t) => t.hard))
  })

  it('第二次殺被擋（同一間店每天一次，不管結果）：行動回傳 refused 與原因、狀態不動；別間店還能殺；隔天恢復', async () => {
    const g = mk()
    await haggle(g, 's_hard', 'fail')
    expect(buyPrice(g, 's_hard', 'i_gun')).toBe(100)
    const why = '今天已經在難纏的店殺過價了（整車每間店每天一次），明天再來。'
    expect(bargainBlock(g.k, g.state, 's_hard', 'haggle')).toBe(why)
    expect(bargainView(g.k, g.state, 's_hard').block).toBe(why)
    expect(bargainView(g.k, g.state, 's_hard').today).toMatchObject({ mult: 1, degree: 'fail' })
    const seq = g.state.seq.report
    const again = await g.act(bargainInput(g.k, g.state, 's_hard', 'haggle'))
    expect(again).toMatchObject({ status: 'refused', reason: why })
    expect(g.state.seq.report).toBe(seq)
    // 別間店
    expect(bargainBlock(g.k, g.state, 's_c', 'haggle')).toBeNull()
    await haggle(g, 's_c', 'success')
    expect(buyPrice(g, 's_c', 'i_gun')).toBe(90)
    // 隔天恢復：倍率沒了、能再殺
    day(g, 2)
    expect(buyPrice(g, 's_c', 'i_gun')).toBe(100)
    expect(bargainBlock(g.k, g.state, 's_c', 'haggle')).toBeNull()
    expect(bargainView(g.k, g.state, 's_c').today).toBeNull()
    await haggle(g, 's_c', 'critical')
    expect(buyPrice(g, 's_c', 'i_gun')).toBe(80)
    // 之後的結帳把過期的紀錄清掉，只留今天的
    g.commit(checkout(g.k, g.state, 's_c', { buy: [{ item: 'i_gun', qty: 1 }], pay: 'cred' }))
    expect(Object.keys(trade(g).bargains)).toEqual(['s_c'])
    expect(trade(g).bargains.s_c).toMatchObject({ day: 2, mult: 0.8 })
  })

  it('結帳照殺到的價：買 ×倍率、賣 ÷倍率；存檔往返記得今天殺過', async () => {
    const g = mk()
    await haggle(g, 's_hard', 'critical')
    give(g, 'i_plainchip')
    const before = g.state.money.cred
    g.commit(checkout(g.k, g.state, 's_hard', { buy: [{ item: 'i_gun', qty: 1 }], sell: [{ item: 'i_plainchip', qty: 1 }], pay: 'cred' }))
    expect(before - g.state.money.cred).toBe(80 - Math.round(40 / 0.8)) // 買 80、賣 50
    const raw = g.save()
    const other = mk()
    expect(other.load(raw)).toBeNull()
    expect(buyPrice(other, 's_hard', 'i_gun')).toBe(80)
    expect(bargainBlock(other.k, other.state, 's_hard', 'haggle')).toContain('殺過價')
  })

  it('跨日的殺價：半夜殺價、做完跨到隔天，倍率算到新的一天（行動做完的那一天）', async () => {
    const g = mk()
    g.state.time = { ...g.state.time, hour: 23, minute: 55 }
    const d0 = g.state.time.day
    await haggle(g, 's_hard', 'success')
    expect(g.state.time.day).toBe(d0 + 1)
    expect(trade(g).bargains.s_hard!.day).toBe(d0 + 1)
    expect(buyPrice(g, 's_hard', 'i_gun')).toBe(90)
  })

  it('沒有店主的店殺價：只改價錢，沒有親密度的變化；沒有人定義親密度這張量表也照樣跑', async () => {
    const g = mk()
    await haggle(g, 's_c', 'critical')
    expect(g.state.meters.affinity).toBeUndefined()
    expect(buyPrice(g, 's_c', 'i_gun')).toBe(80)
    const bare = makeGame({ features: [DISTRICTS, tradeFeature], content: [METER_CONTENT, content()], patch: { money: { cred: 1000, cash: 1000 } } }).game
    const input = bargainInput(bare.k, bare.state, 's_hard', 'haggle')
    for (let c = 0; c < 5000; c++) { bare.state.seq.chain = c; if (prepareAction(bare.k, bare.state, input).roll.natural === 20) break }
    expect((await bare.act(input)).status).toBe('applied')
    expect(buyPrice(bare, 's_hard', 'i_gun')).toBe(80)
  })
})

describe('每一種殺法列不列、做不做得成', () => {
  it('撒嬌在豔名 20 的區不列；到 30 列出來；沒有人定義豔名時不列（也不丟錯）', () => {
    const g = mk()
    setMeter(g, 'fame', 'd_a', 20)
    expect(bargainView(g.k, g.state, 's_a').options.map((o) => o.method)).not.toContain('coax')
    expect(bargainBlock(g.k, g.state, 's_a', 'coax')).toBe('你在甲區的豔名只有 20，要到 30 才用得了撒嬌、放電。')
    setMeter(g, 'fame', 'd_a', 29)
    expect(bargainView(g.k, g.state, 's_a').options.map((o) => o.method)).not.toContain('coax')
    setMeter(g, 'fame', 'd_a', 30)
    expect(bargainView(g.k, g.state, 's_a').options.map((o) => o.method)).toContain('coax')
    expect(bargainBlock(g.k, g.state, 's_a', 'coax')).toBeNull()
    // 豔名看店所在的區：乙區的豔名不夠
    expect(bargainView(g.k, g.state, 's_b').options.map((o) => o.method)).not.toContain('coax')
    const bare = mk({ bare: true })
    expect(bargainView(bare.k, bare.state, 's_a').options.map((o) => o.method)).toEqual(['haggle', 'pressure'])
  })

  it('撒嬌：魅力＋誘惑；店主的傾向和你合時檢定 +2（明細裡一條），不合不加', async () => {
    const g = mk()
    setMeter(g, 'fame', 'd_a', 40)
    const npc = { id: 'npc_ann', name: '安', role: 'npc', age: 30, gender: 'female', perks: [], hp: 20, load: 0, afterglow: 0, sink: 0, conditions: [], attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, ext: { tendency: { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_shared: 'has', tg_only_npc: 'has' } } } }
    g.state.actors.npc_ann = npc as never
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_shared: 'deep' } }
    const withTags = mk({ pack: content((c) => { c.tendency_tag = [{ id: 'tg_shared', name: '共同', axis: 'relation' }, { id: 'tg_only_npc', name: '店主獨有', axis: 'sense' }] }) })
    withTags.state.actors.npc_ann = npc as never
    withTags.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_shared: 'deep' } }
    setMeter(withTags, 'fame', 'd_a', 40)
    const input = bargainInput(withTags.k, withTags.state, 's_a', 'coax')
    expect(input).toMatchObject({ kind: 'bargain', shop: 's_a', method: 'coax', attr: 'charm', skill: 'seduce', situation: [{ label: '店主的傾向和你合', value: 2 }] })
    const rolled = prepareAction(withTags.k, withTags.state, input).roll
    expect(rolled.parts.find((p) => p.label === '店主的傾向和你合')).toMatchObject({ value: 2 })
    expect(rolled.total).toBe(rolled.natural + 2)
    // 傾向不合：玩家沒有店主有的那個
    withTags.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: {} }
    expect(bargainInput(withTags.k, withTags.state, 's_a', 'coax').situation).toBeUndefined()
    expect(prepareAction(withTags.k, withTags.state, bargainInput(withTags.k, withTags.state, 's_a', 'coax')).roll.parts.map((p) => p.label)).not.toContain('店主的傾向和你合')
    // 沒有傾向內容、也沒有人註冊傾向條件（不裝 lewd）時照樣能組輸入
    expect(bargainInput(g.k, g.state, 's_a', 'coax').situation).toBeUndefined()
    const bare = mk({ bare: true })
    expect(bargainInput(bare.k, bare.state, 's_a', 'coax')).toMatchObject({ method: 'coax' })
  })

  it('用人情在沒有人情的功能時不列（bargainBlock 說原因）；裝了功能但沒有人欠你：列出來但做不成', () => {
    const bare = mk({ bare: true })
    expect(bargainView(bare.k, bare.state, 's_a').options.map((o) => o.method)).not.toContain('favor')
    expect(bargainBlock(bare.k, bare.state, 's_a', 'favor')).toBe('現在沒有人情可以用。')
    const g = mk()
    const v = bargainView(g.k, g.state, 's_a')
    expect(v.options.find((o) => o.method === 'favor')).toEqual({ method: 'favor', name: '用人情', block: '店主和他的後台勢力現在都沒有欠你的小人情。' })
    expect(() => bargainByFavor(g.k, g.state, 's_a')).toThrow('店主和他的後台勢力現在都沒有欠你的小人情。')
    owe(g, 'npc_ann', 'mid') // 中人情不算（只用小人情）
    expect(bargainBlock(g.k, g.state, 's_a', 'favor')).not.toBeNull()
    owe(g, 'npc_ann')
    expect(bargainBlock(g.k, g.state, 's_a', 'favor')).toBeNull()
    expect(bargainView(g.k, g.state, 's_a').options.find((o) => o.method === 'favor')!.block).toBeNull()
  })

  it('每一種要擲的殺法列出屬性、基本功、DC、加值與成功的機率；用人情沒有', () => {
    const g = mk()
    setMeter(g, 'fame', 'd_a', 50)
    const opts = bargainView(g.k, g.state, 's_a').options
    expect(opts.map((o) => o.method)).toEqual(['haggle', 'coax', 'pressure', 'favor'])
    expect(opts[0]).toMatchObject({ method: 'haggle', name: '講價', attr: 'charm', skill: 'negotiate', dc: 13, modifier: 0, block: null })
    // 魅力 10、沒有基本功：d20 ≥ 13 成功（13～20 共八面）
    expect(opts[0]!.chance).toBe(8 / 20)
    expect(opts[2]).toMatchObject({ method: 'pressure', attr: 'resolve', skill: 'intimidate' })
    expect(opts[3]!.dc).toBeUndefined()
    // 魅力 18（+4）：d20 + 4 ≥ 13
    const strong = mk({ charm: 18 })
    const o = bargainView(strong.k, strong.state, 's_c').options[0]!
    expect(o.modifier).toBe(4)
    expect(o.chance).toBe(12 / 20)
  })

  it('施壓只在後台是幫派（class: street）的店：企業旗下的店與沒有後台的店不列、直接送出被擋', () => {
    const g = mk()
    expect(bargainView(g.k, g.state, 's_a').options.map((o) => o.method)).toContain('pressure')
    expect(bargainView(g.k, g.state, 's_c').options.map((o) => o.method)).not.toContain('pressure')
    expect(bargainView(g.k, g.state, 's_corpgen').options.map((o) => o.method)).not.toContain('pressure')
    expect(bargainBlock(g.k, g.state, 's_corpgen', 'pressure')).toBe('只有後台是幫派的店才能施壓。')
    expect(() => prepareAction(g.k, g.state, bargainInput(g.k, g.state, 's_c', 'pressure'))).toThrow('只有後台是幫派的店才能施壓。')
  })
})

describe('施壓大失敗：被趕出去', () => {
  it('敵對值 +5、今天進不了這間店（結帳、貨架、殺價都被擋）；隔天又能進；別間店不受影響；價錢沒有被抬', async () => {
    const g = mk()
    setMeter(g, 'hostility', 'f_beta', 10)
    setMeter(g, 'affinity', 'npc_ann', 10)
    const { status, reports } = await haggle(g, 's_a', 'fumble', 'pressure')
    expect(status).toBe('applied')
    expect(reports[0]).toMatchObject({ action: 'bargain', outcome: { result: 'fumble' } })
    expect(reports[0]!.timeline[0]!.roll).toMatchObject({ attr: 'resolve', skill: 'intimidate' })
    expect(g.state.meters.hostility!.f_beta).toBe(15)
    expect(g.state.meters.affinity!.npc_ann).toBe(7) // 照表：大失敗店主親密度 −3
    expect(closedToday(g.state, 's_a')).toBe(true)
    expect(trade(g).bargains.s_a).toMatchObject({ mult: 1, method: 'pressure', degree: 'fumble' }) // 被趕出去取代 ×1.1
    const why = '你剛才在甲區商行施壓失敗，被趕了出來，今天這間店不做你的生意。'
    expect(shopBlock(g.k, g.state, 's_a')).toBe(why)
    expect(shopView(g.k, g.state, 's_a').closed).toBe(why)
    expect(buyBlock(g.k, g.state, 's_a', 'i_gun')).toBe(why)
    expect(() => checkout(g.k, g.state, 's_a', { buy: [{ item: 'i_gun', qty: 1 }], pay: 'cred' })).toThrow(why)
    give(g, 'i_gun')
    expect(() => checkout(g.k, g.state, 's_a', { sell: [{ item: 'i_gun', qty: 1 }], pay: 'cred' })).toThrow(why)
    expect(bargainBlock(g.k, g.state, 's_a', 'haggle')).toBe(why)
    expect(shopBlock(g.k, g.state, 's_b')).toBeNull()
    expect(shopBlock(g.k, g.state, 's_c')).toBeNull()
    day(g, 2)
    expect(closedToday(g.state, 's_a')).toBe(false)
    expect(shopBlock(g.k, g.state, 's_a')).toBeNull()
    expect(() => checkout(g.k, g.state, 's_a', { buy: [{ item: 'i_gun', qty: 1 }], pay: 'cred' })).not.toThrow()
    // 被趕出去的紀錄存檔往返
    const g2 = mk()
    await haggle(g2, 's_a', 'fumble', 'pressure')
    const other = mk()
    expect(other.load(g2.save())).toBeNull()
    expect(closedToday(other.state, 's_a')).toBe(true)
  })

  it('講價大失敗不會被趕出去：×1.1、親密度 −3，店照樣做生意；施壓只是失敗：價錢不變', async () => {
    const g = mk()
    setMeter(g, 'hostility', 'f_beta', 10)
    await haggle(g, 's_a', 'fumble')
    expect(closedToday(g.state, 's_a')).toBe(false)
    expect(g.state.meters.hostility!.f_beta).toBe(10)
    expect(trade(g).bargains.s_a!.mult).toBe(1.1)
    const h = mk()
    await haggle(h, 's_a', 'fail', 'pressure')
    expect(h.state.meters.hostility).toBeUndefined()
    expect(closedToday(h.state, 's_a')).toBe(false)
    expect(trade(h).bargains.s_a!.mult).toBe(1)
  })

  it('後台勢力的敵對值已經 60 的店本來就不做生意：殺價也被擋（講的是那一句）', () => {
    const g = mk()
    setMeter(g, 'hostility', 'f_beta', 60)
    expect(bargainBlock(g.k, g.state, 's_a', 'haggle')).toBe('這間店的後台勢力（貝塔）對你的敵對值已經到了 60 以上，不做你的生意。')
  })
})

describe('用人情殺價（不擲，當成大成功）', () => {
  it('用掉店主欠你的一個小人情：倍率 ×0.8、店主親密度 +2、報告 bargain、花 15 分鐘；今天不能再殺', () => {
    const g = mk()
    owe(g, 'npc_ann')
    owe(g, 'f_beta')
    const t0 = g.state.time
    const d = bargainByFavor(g.k, g.state, 's_a')
    expect(d).toMatchObject({ kind: 'action', action: 'bargain', outcome: { result: 'critical' } })
    expect(d.changes.find((c) => c.op === 'favor.spend')).toEqual({ op: 'favor.spend', dir: 'owed_to_pc', who: 'npc_ann', size: 'small' })
    const [r] = g.commit(d)
    expect(r!.action).toBe('bargain')
    // 店主欠的用掉了，勢力欠的還在
    const favors = (g.state.ext.favors as { owed_to_pc: Array<{ who: string }> }).owed_to_pc
    expect(favors.map((f) => f.who)).toEqual(['f_beta'])
    expect(trade(g).bargains.s_a).toMatchObject({ mult: 0.8, method: 'favor', degree: 'critical' })
    expect(g.state.meters.affinity!.npc_ann).toBe(2)
    expect(buyPrice(g, 's_hard', 'i_gun')).toBe(100)
    expect(quote(g.k, g.state, 's_a', 'i_gun', 'buy').steps.at(-1)).toMatchObject({ id: 'bargain', mult: 0.8 })
    expect((g.state.time.minute + g.state.time.hour * 60) - (t0.minute + t0.hour * 60)).toBe(15)
    expect(() => bargainByFavor(g.k, g.state, 's_a')).toThrow('殺過價')
  })

  it('店主沒有欠、他的後台勢力欠：用勢力的；用的是小人情，大小不對的不算', () => {
    const g = mk()
    owe(g, 'f_beta')
    const d = bargainByFavor(g.k, g.state, 's_a')
    expect(d.changes.find((c) => c.op === 'favor.spend')).toMatchObject({ who: 'f_beta' })
    g.commit(d)
    expect((g.state.ext.favors as { owed_to_pc: unknown[] } | undefined)?.owed_to_pc ?? []).toEqual([])
    expect(trade(g).bargains.s_a!.mult).toBe(0.8)
    // 沒有店主也沒有後台勢力的店沒有人可以欠
    const h = mk()
    owe(h, 'npc_ann')
    expect(() => bargainByFavor(h.k, h.state, 's_c')).toThrow(ActionBlocked)
  })

  it('不能殺價的店、被趕出來的店、今天殺過的店都不能用人情', async () => {
    const g = mk()
    owe(g, 'npc_ann')
    expect(() => bargainByFavor(g.k, g.state, 's_corp')).toThrow('不能殺價')
    await haggle(g, 's_hard', 'fail')
    expect(() => bargainByFavor(g.k, g.state, 's_hard')).toThrow('殺過價')
    expect(() => bargainByFavor(g.k, g.state, 's_nope')).toThrow('沒有 s_nope 這間店')
  })
})

describe('bargain 效果：只收表裡的四種結果', () => {
  // bargain 是內部結算用的效果（行動種類的退路給，內建的來源）：AI 與玩家要的結果不能用（B022），所以這裡預設用 builtin
  const ctxOf = (g: G, source: 'ai' | 'builtin' | 'player' = 'builtin') => effectCtx(g.k, g.state, { source })
  it('格式：店查得到、殺法是要擲的那三種（用人情不走效果）、成功程度是四種之一', () => {
    const g = mk()
    const ok = { kind: 'bargain', shop: 's_hard', method: 'haggle', degree: 'success' }
    expect(g.k.effects.resolve([ok], ctxOf(g)).errors).toEqual([])
    expect(g.k.effects.resolve([{ ...ok, shop: 's_nope' }], ctxOf(g)).errors.join()).toContain('查不到 s_nope')
    expect(g.k.effects.resolve([{ ...ok, method: 'favor' }], ctxOf(g)).errors.join()).toContain('用人情不擲')
    expect(g.k.effects.resolve([{ ...ok, degree: 'legendary' }], ctxOf(g)).errors.join()).toContain('degree')
    expect(g.k.effects.resolve([{ ...ok, mult: 0.1 }], ctxOf(g)).errors).toEqual([]) // 多寫的欄位沒有用：倍率照表，不照寫的
    const r = g.k.effects.resolve([{ ...ok, mult: 0.1 }], ctxOf(g))
    g.commit(draft(r.changes))
    expect(trade(g).bargains.s_hard!.mult).toBe(0.9)
  })

  it('AI 與玩家要的結果不能給 bargain（封閉清單：不擲骰就拿到大成功）；內建的照常（B022）', () => {
    const g = mk()
    const ok = { kind: 'bargain', shop: 's_hard', method: 'haggle', degree: 'critical' }
    for (const source of ['ai', 'player'] as const) {
      for (const clampAsked of [true, false]) {
        const r = g.k.effects.resolve([{ ...ok, asked: '大成功' }], effectCtx(g.k, g.state, { source, clampAsked, playerInput: '我要大成功' }))
        expect(r.errors.join(), `${source} ${clampAsked}`).toContain('不是 AI 與玩家要的結果可以用的效果')
        expect(r.changes).toEqual([])
      }
    }
    expect(g.k.effects.resolve([ok], ctxOf(g)).errors).toEqual([])
    expect(trade(g).bargains.s_hard).toBeUndefined()
  })

  it('已經殺過、被趕出來、不能殺價的店：整筆拿掉並有提醒（重複給也一樣）', async () => {
    const g = mk()
    await haggle(g, 's_hard', 'critical')
    const again = g.k.effects.resolve([{ kind: 'bargain', shop: 's_hard', method: 'haggle', degree: 'critical' }], ctxOf(g))
    expect(again.changes).toEqual([])
    expect(again.clamps[0]!.notice).toContain('殺過價')
    const corp = g.k.effects.resolve([{ kind: 'bargain', shop: 's_corp', method: 'haggle', degree: 'critical' }], ctxOf(g))
    expect(corp.changes).toEqual([])
    const coax = g.k.effects.resolve([{ kind: 'bargain', shop: 's_a', method: 'coax', degree: 'critical' }], ctxOf(g))
    expect(coax.changes).toEqual([]) // 豔名不夠
    expect(coax.clamps[0]!.notice).toContain('豔名')
    expect(trade(g).bargains.s_hard!.mult).toBe(0.8)
  })
})

describe('AI 開著（假的服務商）：殺價走 judge，結果仍然在表的四個倍率裡', () => {
  const MULTS = [0.8, 0.9, 1, 1.1]

  it('判定走 judge：請求裡有這次的骰值與 DC；判定的成功程度被夾回骰子（骰到 10 是失敗，AI 說大成功也只是失敗）', async () => {
    const g = mk({ fake: { byTask: { judge: [{ json: { degree: 'critical', dc: 13, reason: '老闆被逗笑了。', twist: '', minutes: 15, new_person: false } }] } } })
    rig(g, 's_hard', 'haggle', DIE.fail)
    const r = await g.act(bargainInput(g.k, g.state, 's_hard', 'haggle'))
    expect(r.status).toBe('applied')
    expect(r.run.steps.find((s) => s.id === 'judge')!.status).toBe('done')
    const rec = trade(g).bargains.s_hard!
    expect(rec.degree).toBe('fail') // 骰面 10、DC 13：被夾回失敗
    expect(rec.mult).toBe(1)
    expect(r.reports[0]!.outcome.result).toBe('fail')
    expect(r.reports[0]!.clamps?.some((c) => c.path === 'judgment.degree')).toBe(true)
  })

  it('AI 判定大成功、骰面也到了：×0.8；結果一定是表裡的四個之一（大失敗、成功也各跑一次）', async () => {
    for (const degree of ['critical', 'success', 'fail', 'fumble'] as const) {
      const g = mk({ fake: {} })
      const r = await haggle(g, 's_hard', degree)
      expect(r.status).toBe('applied')
      const rec = trade(g).bargains.s_hard!
      expect(rec.degree).toBe(degree)
      expect(MULTS).toContain(rec.mult)
      expect(rec.mult).toBe({ critical: 0.8, success: 0.9, fail: 1, fumble: 1.1 }[degree])
      expect(MULTS).toContain(buyPrice(g, 's_hard', 'i_gun') / 100)
    }
  })

  it('假的服務商亂給（over_cap：判定 DC 99、時間 99999、成功程度大成功）：判定被夾，倍率仍在表裡；價錢只有一種變化', async () => {
    const g = mk({ fake: { adversarial: { mode: 'over_cap', tasks: ['judge'] } } })
    rig(g, 's_hard', 'haggle', DIE.fumble)
    const r = await g.act(bargainInput(g.k, g.state, 's_hard', 'haggle'))
    expect(r.status).toBe('applied')
    const rec = trade(g).bargains.s_hard!
    expect(rec.degree).toBe('fumble')
    expect(MULTS).toContain(rec.mult)
    expect(rec.mult).toBe(1.1)
    expect(r.reports[0]!.clamps!.length).toBeGreaterThan(0)
    // 時間被夾在行動種類的上限（60 分鐘）
    expect(g.state.time.hour * 60 + g.state.time.minute).toBeLessThanOrEqual(8 * 60 + 60 + 24 * 60)
  })

  it('算回報只照規則（rewardByRules）：AI 不會被問 reward，劇本給了別的店、別的成功程度都沒有用；步驟的狀態是 fallback，結果照判定定案的成功程度', async () => {
    const g = mk({
      fake: {
        byTask: {
          reward: [
            { json: { items: [{ kind: 'bargain', shop: 's_nope', method: 'haggle', degree: 'critical', from: { source: 'degree' } }] } },
            { json: { items: [{ kind: 'bargain', shop: 's_hard', method: 'haggle', degree: 'critical', from: { source: 'degree' } }] } },
          ],
        },
      },
    })
    rig(g, 's_hard', 'haggle', DIE.success)
    const r = await g.act(bargainInput(g.k, g.state, 's_hard', 'haggle'))
    expect(r.status).toBe('applied')
    expect(r.run.steps.find((s) => s.id === 'reward')).toMatchObject({ status: 'fallback' })
    expect(r.run.steps.find((s) => s.id === 'judge')!.status).toBe('done')
    // 判定走了 AI（假的服務商自己回合格的），算回報沒有發出請求
    expect(trade(g).bargains.s_hard).toMatchObject({ mult: 0.9, degree: 'success' })
    expect(r.reports[0]!.narration!.results).toHaveLength(1)
  })

  it('AI 開著，判定被夾過之後的成功程度才是殺價的結果（不是 AI 另外交的）；效果由退路產生，一定有、一定是報告上那一個', async () => {
    for (const degree of ['critical', 'success', 'fail', 'fumble'] as const) {
      const g = mk({ fake: { adversarial: { mode: 'over_cap', tasks: ['judge', 'reward'] } } })
      rig(g, 's_hard', 'haggle', DIE[degree])
      const r = await g.act(bargainInput(g.k, g.state, 's_hard', 'haggle'))
      expect(r.status).toBe('applied')
      // 假的服務商亂給判定（DC 99、大成功）：DC 被夾回參考值 ±3，成功程度照夾過的算；殺價的結果就是報告上那個成功程度
      const settled = r.reports[0]!.outcome.result as keyof typeof DIE
      expect(r.reports[0]!.clamps!.length).toBeGreaterThan(0)
      expect(trade(g).bargains.s_hard).toMatchObject({ degree: settled, mult: { critical: 0.8, success: 0.9, fail: 1, fumble: 1.1 }[settled] })
      expect(r.run.steps.find((s) => s.id === 'reward')!.status).toBe('fallback')
    }
  })

  it('AI 關著：同樣走主動行動（沒有 judge 請求），結果照骰面', async () => {
    const g = mk()
    const r = await haggle(g, 's_hard', 'success')
    expect(r.status).toBe('applied')
    expect(r.run.steps.find((s) => s.id === 'judge')?.status).not.toBe('failed')
    expect(trade(g).bargains.s_hard).toMatchObject({ mult: 0.9, degree: 'success' })
  })
})

describe('shopView 帶上行情、貨物、遞減與殺價', () => {
  it('抬頭有這一區的行情（夾過）、貨架每列有貿易類別與是不是貨物、殺價的畫面（DC、今天的結果、每一種殺法）', async () => {
    const g = mk()
    setMeter(g, 'fame', 'd_a', 30)
    const v = shopView(g.k, g.state, 's_a')
    expect(v.market).toEqual([
      { category: 'electronics', name: '電子', mult: 0.7 },
      { category: 'luxury', name: '奢侈品', mult: 2.5 },
      { category: 'weapon', name: '武器', mult: 0.5 },
    ])
    const chip = v.shelf.find((r) => r.item === 'i_chip')!
    expect(chip).toMatchObject({ tradeCategory: 'electronics', tradeCategoryName: '電子', cargo: true, price: 70 })
    expect(chip.quote.steps[3]).toEqual({ id: 'category', name: '類別的行情', mult: 0.7, value: 70 })
    expect(v.shelf.find((r) => r.item === 'i_gun')).toMatchObject({ tradeCategory: 'weapon', cargo: false, price: 50 })
    expect(v.bargain).toMatchObject({ today: null, block: null, dc: 13 })
    expect(v.bargain.options.map((o) => o.method)).toEqual(['haggle', 'coax', 'pressure', 'favor'])
    await haggle(g, 's_a', 'success')
    const after = shopView(g.k, g.state, 's_a')
    expect(after.bargain.today).toMatchObject({ mult: 0.9, degree: 'success' })
    expect(after.bargain.block).toContain('殺過價')
    expect(after.shelf.find((r) => r.item === 'i_chip')!.price).toBe(63)
    expect(shopView(g.k, g.state, 's_c').market).toEqual([])
    expect(shopView(g.k, g.state, 's_corp').bargain).toMatchObject({ dc: null, options: [] })
  })
})
