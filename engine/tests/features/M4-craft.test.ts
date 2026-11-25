// 驗收測試：dev/work/M4-craft.md（cpp-feature）。規格：CRAFTING 第 1、3.4、4、6 節，第 10.1、10.2 節，第 11 節第一條；TRADE 3.4 節與 8.3 節；ITEMS 1.4 節；dev/adr/0019 第四節與 P16、第十七節（內嵌的零件）。
// 內容一律用測試自帶的最小假資料：一張 II 級的手槍、一張 II 級的義臂、一張全生體的獸耳、一座橋，十來個零件（兩個牌子 hz／ka、一個 III 級、三個生體），
// 三種設施（店家、同人社團、原廠）與一個沒有 craft 的設施，三筆 quirk（瑕疵、同人、不適用手槍的瑕疵），一間賣成品的店。
// 站上設施用真的 world；住處的條件 at_home 在大部分測試用替身（旗標 home_level），level_min 另外用真的 rest 驗；條件 ability 由測試的替身註冊（沒裝就沒有工坊的加成）。
// 骰子：用 vi.spyOn(Rng.prototype, 'next') 固定每一次 next() 的值（只包住「建草稿」那一步，提交不受影響）。
//
// 數字：主角技術 14（調整值 +2）、機械 2、義體學 2、醫療 1，所以機械與義體學的檢定加值是 +4。手槍 II 級 DC 13：骰面 9 起成功、14 起大成功、5～8 失敗、4 以下大失敗。
// 成品價 ＝ 零件目錄價合計 × 1.2：手槍（槍管 200 ＋ 機構 200）480；精工 ×1.1；帶瑕疵 ×0.8。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ContentPack, Feature, ItemStack, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, Rng, UNREG_STACK_ID, effectCtx, makeCheck, partOf, productOf, productPrice, stackOf, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import {
  DEFAULT_CRAFT_RULES, assembleBlock, assembleDraft, assembleProblems, assemblyPreview, craftFeature, craftOf, isKnown, knownBlueprints, learnBlock, learnDraft, makers,
} from '../../src/features/craft'
import { characterFeature } from '../../src/features/character'
import { gearFeature, weaponOf } from '../../src/features/gear'
import { buyBlock, checkout, planCheckout, quote, sellBlock, shopView, stockOf, tradeFeature } from '../../src/features/trade'
import { breathDraft, rentDraft, restFeature } from '../../src/features/rest'
import { arrive, worldFeature } from '../../src/features/world'
import { makeActor, makeGame, observed } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'mechanics', name: '機械', attr: 'tech', desc: '機械。' },
  { id: 'cyberware', name: '義體學', attr: 'tech', desc: '義體學。' }, { id: 'medicine', name: '醫療', attr: 'tech', desc: '醫療。' },
]
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: ['concealable'], attr: 'reflex', skill: 'firearms' }]

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS: Rec[] = [
  part('pt_barrel', 'barrel', { price: 200, stats: { hit: 1, damage: 2 } }),
  part('pt_barrel_ka', 'barrel', { price: 200, brand: 'ka', stats: { hit: 2 } }),
  part('pt_barrel_3', 'barrel', { price: 600, brand: 'ka', grade: 3, stats: { hit: 3, damage: 3 } }),
  part('pt_barrel_3h', 'barrel', { price: 600, grade: 3, stats: { hit: 3, damage: 3 } }),
  part('pt_barrel_4', 'barrel', { price: 900, grade: 4, legal: 'banned' }),
  part('pt_action', 'action', { price: 200, stats: { damage: 1 } }),
  part('pt_action_ka', 'action', { price: 200, brand: 'ka' }),
  part('pt_plate', 'plate', { price: 150, stats: { armor: 2 } }),
  part('pt_act', 'actuator', { price: 150 }),
  part('pt_neuron_bio', 'neuron', { price: 300, material: 'bio' }),
  part('pt_skin_bio', 'skin', { price: 200, material: 'bio' }),
  part('pt_ear', 'skin', { price: 500, grade: 1, material: 'bio' }),
  part('pt_chip', 'chip', { price: 500 }),
]

const bp = (id: string, over: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, brand: 'hz', grade: 2, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...over })
const BLUEPRINTS: Rec[] = [
  bp('bp_pistol', { kind: 'weapon', name: '手槍', class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'action' }], stock: { barrel: 'pt_barrel', action: 'pt_action' } }),
  bp('bp_smg', { kind: 'weapon', name: '衝鋒槍', class: 'pistol', carry: 'main', require: [{ type: 'barrel' }, { type: 'action' }] }),
  bp('bp_arm', {
    kind: 'cyberware', name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6,
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }, { type: 'skin' }],
  }),
  bp('bp_ears', { kind: 'cyberware', name: '獸耳', slot: 'ear_throat', invasiveness: 'light', sink_cost: 3, grade: 1, needs_bridge: false, require: [{ type: 'skin', material: 'bio' }] }),
  bp('bp_bridge', { kind: 'cyberware', name: '邊緣橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }] }),
]
const QUIRKS: Rec[] = [
  { id: 'qx_loose', name: '鬆動的準星', desc: '準星有點鬆。', kind: 'flaw', pool: ['flaw'], applies: ['weapon', 'armor'], stats: { hit: -1 } },
  { id: 'qx_numb', name: '神經遲鈍', desc: '接口有點遲鈍。', kind: 'flaw', pool: ['flaw'], applies: ['cyberware'], stats: { sink: 1 } },
  { id: 'qx_club', name: '社團的簽名', desc: '槍身刻了社團的簽名。', kind: 'quirk', pool: ['doujin'], applies: ['weapon', 'cyberware'], stats: { hit: 1 } },
]
const ITEMS: Rec[] = [
  { id: 'it_lic', name: '手槍的授權書', desc: '一份授權書。', category: 'blueprint', grade: 2, size: 0, legal: 'free', price: 500, teaches: 'bp_pistol' },
  { id: 'it_lic_smg', name: '衝鋒槍的授權書', desc: '一份授權書。', category: 'blueprint', grade: 2, size: 0, legal: 'free', price: 500, teaches: 'bp_smg' },
  { id: 'it_junk', name: '雜物', desc: '一件雜物。', category: 'misc', grade: 1, size: 1, legal: 'free' },
]
const FACILITIES: Rec[] = [
  { id: 'fac_shop', name: '槍店', craft: { by: 'shop' } },
  { id: 'fac_doujin', name: '同人社團', craft: { by: 'doujin' } },
  { id: 'fac_factory', name: '原廠直營', craft: { by: 'factory', brand: 'hz' } },
  { id: 'fac_plain', name: '雜貨店' },
]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    skill: structuredClone(SKILLS), weapon_class: structuredClone(WEAPONS), special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: structuredClone(FACILITIES),
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_shops', 'b_flat'] }],
    block: [
      { id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '槍店' }, F2: { type: 'fac_doujin', name: '社團' }, F3: { type: 'fac_factory', name: '原廠' }, F4: { type: 'fac_plain', name: '雜貨店' } } },
      { id: 'b_flat', district: 'd_hive', name: '住宅區', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_plain', name: '空房' } } },
    ],
    blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS), quirk: structuredClone(QUIRKS), item: structuredClone(ITEMS),
    shop_type: [{ id: 't_gun', name: '槍店', catalog: ['weapon'], buys: ['weapon', 'part', 'armor'], grade_max: 3, cash: true, shop_mult: 1, temper: 0 }],
    shop: [{ id: 's_gun', type: 't_gun', name: '槍店的櫃檯', district: 'd_hive', fixed_products: ['bp_pistol'] }],
  }
  patch(c)
  return { id: 'craft_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：條件 at_home（旗標 home_level 是住處的等級；level_min 照真的 rest 的意思）。 */
const HOME: Feature = {
  id: 'home_stub',
  install(k) {
    k.conditions.register<Condition & { level_min?: number }>({
      kind: 'at_home', owner: 'home_stub', validate: () => [],
      test: (c, { state }) => typeof state.flags.home_level === 'number' && state.flags.home_level >= (c.level_min ?? 0),
    })
  },
}
/** 測試的替身：條件 ability（abilities 註冊的那個；旗標 workshop 在，工坊就成立）。沒裝就沒有工坊的加成。 */
const ABILITY: Feature = {
  id: 'ability_stub',
  install(k) {
    k.conditions.register<Condition & { daily?: string }>({
      kind: 'ability', owner: 'ability_stub', validate: () => [],
      test: (c, { state }) => c.daily === 'workshop' && state.flags.workshop === true,
    })
  },
}

interface Opts {
  pack?: ContentPack
  pc?: Rec
  money?: { cred: number; cash: number }
  ability?: boolean
  actors?: ReturnType<typeof makeActor>[]
  party?: string[]
}
const make = (o: Opts = {}) => {
  const features: Feature[] = [characterFeature, worldFeature, HOME, ...(o.ability ? [ABILITY] : []), gearFeature, tradeFeature, craftFeature]
  const { game } = makeGame({
    features, content: [o.pack ?? pack()], seed: 7,
    pc: { hp: 40, attrs: { tech: 14 }, skills: { firearms: 2, mechanics: 2, cyberware: 2, medicine: 1 }, ...(o.pc ?? {}) },
    ...(o.actors ? { actors: o.actors } : {}),
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 5000, cash: 500 }, ...(o.party ? { party: o.party } : {}) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const stand = (g: G, at: string, block = 'b_shops') => { g.commit(arrive(g.k, g.state, block, at)) }
const pc = (g: G) => g.state.actors.pc!
const now = (g: G) => toMinutes(g.state.time)
const last = (g: G) => g.state.reports[g.state.reports.length - 1]!
const know = (g: G, ...ids: string[]) => { g.state.ext.craft = { known: ids } }
const give = (g: G, id: string, qty = 1) => { g.state.inventory.push({ id, qty }) }
const count = (g: G, id: string) => g.state.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)
const product = (g: G, id = 'bp_pistol'): ItemStack | undefined => g.state.inventory.find((s) => s.id === id && s.data?.uid)
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

/** 把每一次 next() 固定成 v（或依序給一串，最後一個一直用），只包住 fn。 */
function withDice<T>(v: number | number[], fn: () => T): T {
  const spy = vi.spyOn(Rng.prototype, 'next')
  if (Array.isArray(v)) {
    for (const x of v.slice(0, -1)) spy.mockReturnValueOnce(x)
    spy.mockReturnValue(v[v.length - 1]!)
  } else spy.mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
afterEach(() => { vi.restoreAllMocks() })

// 骰面：自然骰 = 1 + floor(next × 20)；手槍 DC 13、加值 +4
const NAT20 = 0.99 // 大成功
const NAT14 = 0.65 // 14 + 4 = 18：大成功
const NAT10 = 0.45 // 10 + 4 = 14：成功
const NAT6 = 0.25 // 6 + 4 = 10：失敗
const NAT1 = 0 // 大失敗

const PISTOL = { barrel: 'pt_barrel', action: 'pt_action' }
/** 同牌全套的手槍用的零件、在背包裡放一份。 */
const stockParts = (g: G) => { give(g, 'pt_barrel'); give(g, 'pt_action') }
const opts = (o: Rec = {}) => ({ blueprint: 'bp_pistol', parts: PISTOL, maker: 'self' as const, ...o })
const asSelf = (g: G) => { g.state.flags.home_level = 2; know(g, 'bp_pistol'); stockParts(g) }

// ---- 設計圖：學會 ----

describe('會做的設計圖', () => {
  it('沒學過的設計圖自己做被擋、原因寫出來；學過就行', () => {
    const g = make()
    g.state.flags.home_level = 2
    stockParts(g)
    expect(assembleBlock(g.k, g.state, opts())).toContain('還沒學過')
    expect(reasonOf(() => assembleDraft(g.k, g.state, opts()))).toContain('還沒學過')
    expect(isKnown(g.state, 'bp_pistol')).toBe(false)
    know(g, 'bp_pistol')
    expect(assembleBlock(g.k, g.state, opts())).toBeNull()
  })

  it('用掉授權書：known 有它、授權書少一張；已經會的、不是授權書的、背包裡沒有的都被擋', () => {
    const g = make()
    give(g, 'it_lic', 2)
    expect(learnBlock(g.k, g.state, { item: 'it_lic' })).toBeNull()
    g.commit(learnDraft(g.k, g.state, { item: 'it_lic' }))
    expect(craftOf(g.state).known).toEqual(['bp_pistol'])
    expect(knownBlueprints(g.k, g.state).map((b) => b.id)).toEqual(['bp_pistol'])
    expect(count(g, 'it_lic')).toBe(1)
    expect(last(g)).toMatchObject({ kind: 'action', action: 'craft.learn' })
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
    expect(reasonOf(() => learnDraft(g.k, g.state, { item: 'it_lic' }))).toContain('已經會做')
    give(g, 'it_junk')
    expect(learnBlock(g.k, g.state, { item: 'it_junk' })).toContain('不是設計圖的授權書')
    expect(learnBlock(g.k, g.state, { item: 'it_lic_smg' })).toContain('背包裡沒有')
    expect(learnBlock(g.k, g.state, { item: 'it_nope' })).toContain('沒有 it_nope')
    // 存檔往返
    const again = make()
    again.load(g.save())
    expect(craftOf(again.state).known).toEqual(['bp_pistol'])
  })

  it('效果 blueprint 也學得會；AI 與玩家要的被擋；不認得的設計圖被擋；已經會的不重複', () => {
    const g = make()
    const learn = (effect: Rec, source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve([effect], effectCtx(g.k, g.state, { source }))
    const r = learn({ kind: 'blueprint', id: 'bp_arm' })
    expect(r.errors).toEqual([])
    expect(r.lines[0]).toContain('學會了')
    g.commit(draft(r.changes))
    expect(isKnown(g.state, 'bp_arm')).toBe(true)
    expect(learn({ kind: 'blueprint', id: 'bp_arm' }).changes).toEqual([])
    expect(learn({ kind: 'blueprint', id: 'bp_pistol' }, 'ai').errors.length).toBeGreaterThan(0)
    expect(learn({ kind: 'blueprint', id: 'bp_pistol' }, 'player').errors.length).toBeGreaterThan(0)
    expect(learn({ kind: 'blueprint', id: 'bp_nope' }).errors.length).toBeGreaterThan(0)
    expect(learn({ kind: 'blueprint' }).errors.length).toBeGreaterThan(0)
    // 兩筆同時學：前一筆的結果算進去
    const two = g.k.effects.resolve([{ kind: 'blueprint', id: 'bp_pistol' }, { kind: 'blueprint', id: 'bp_pistol' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    g.commit(draft(two.changes))
    expect(craftOf(g.state).known).toEqual(['bp_arm', 'bp_pistol'])
  })

  it('壞掉的 known 讀成沒有；content 的格式不對在載入時擋下', () => {
    const g = make()
    g.state.ext.craft = { known: ['bp_pistol', 7, '', 'bp_pistol', null] }
    expect(craftOf(g.state).known).toEqual(['bp_pistol'])
    g.state.ext.craft = 'garbage'
    expect(craftOf(g.state).known).toEqual([])
    const bad = (patch: (c: Record<string, Rec[]>) => void) => () => make({ pack: pack(patch) })
    expect(bad((c) => { c.item!.push({ id: 'it_bad', name: '壞授權書', desc: '壞的。', category: 'blueprint', grade: 1, size: 0, legal: 'free', teaches: 'bp_nope' }) })).toThrow('item/it_bad')
    expect(bad((c) => { c.item!.push({ id: 'it_bad', name: '壞授權書', desc: '壞的。', category: 'misc', grade: 1, size: 0, legal: 'free', teaches: 'bp_pistol' }) })).toThrow(ContentError)
    expect(bad((c) => { c.facility_type![0] = { id: 'fac_shop', name: '槍店', craft: { by: 'wizard' } } })).toThrow('facility_type/fac_shop')
    expect(bad((c) => { c.facility_type![2] = { id: 'fac_factory', name: '原廠', craft: { by: 'factory' } } })).toThrow(ContentError)
    expect(bad((c) => { c.craft_rule = [{ id: 'default', dc: [1, 2, 3] }] })).toThrow(ContentError)
    expect(bad((c) => { c.craft_rule = [{ id: 'default', makers: { doujin: { quirk_chance: 2 } } }] })).toThrow(ContentError)
    expect(bad((c) => { c.shop![0] = { ...c.shop![0]!, fixed_products: ['bp_nope'] } })).toThrow('blueprint/bp_nope')
    expect(bad((c) => { c.shop![0] = { ...c.shop![0]!, fixed_products: ['bp_smg'] } })).toThrow('bp_smg')
  })
})

// ---- 預覽 ----

describe('預覽：難度、成功率、數字', () => {
  const pre = (g: G, o: Rec = {}) => assemblyPreview(g.k, g.state, opts(o))

  it('同牌全套的難度是 13；多一個牌子 14；一個超規 17（牌子也多一個）；兩個接面的義臂 15；橋 16', () => {
    const g = make()
    asSelf(g)
    give(g, 'pt_barrel_ka'); give(g, 'pt_barrel_3')
    const base = pre(g)
    expect(base.problems).toEqual([])
    expect(base.difficulty).toMatchObject({ base: 13, brands: 0, seams: 0, overspec: 0, bridge: 0, total: 13 })
    expect(base.difficulty!.lines.map((l) => l.id)).toEqual(['grade'])
    expect(pre(g, { parts: { barrel: 'pt_barrel_ka', action: 'pt_action' } }).difficulty).toMatchObject({ brands: 1, total: 14 })
    const over = pre(g, { parts: { barrel: 'pt_barrel_3', action: 'pt_action' } })
    expect(over.difficulty).toMatchObject({ base: 13, brands: 1, overspec: 3, total: 17 })
    expect(over.slots.find((s) => s.type === 'barrel')!.picked[0]).toMatchObject({ overspec: true, problems: [] })
    expect(over.result!.overspec).toBe(1)
    // 兩個接面的義臂：兩個機械、兩個生體
    know(g, 'bp_arm')
    for (const id of ['pt_plate', 'pt_act', 'pt_neuron_bio', 'pt_skin_bio']) give(g, id)
    const arm = assemblyPreview(g.k, g.state, { blueprint: 'bp_arm', parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' } })
    expect(arm.problems).toEqual([])
    expect(arm.result).toMatchObject({ seams: 2, allBio: false })
    expect(arm.difficulty).toMatchObject({ seams: 2, total: 15 })
    expect(arm.check!.skill).toBe('cyberware')
    // 橋再 +3
    know(g, 'bp_bridge'); give(g, 'pt_chip')
    expect(assemblyPreview(g.k, g.state, { blueprint: 'bp_bridge', parts: { chip: 'pt_chip' } }).difficulty).toMatchObject({ bridge: 3, total: 16 })
  })

  it('難度偏移（dcOffset）算進去；檢定用技術加機械：加值 +4、成功率和 makeCheck 的門檻對得上', () => {
    const g = make()
    asSelf(g)
    const p = pre(g)
    expect(p.check).toMatchObject({ by: 'pc', attr: 'tech', skill: 'mechanics', bonus: 4, dc: 13, workshop: false })
    // 骰面 5～8 失敗（總和 9～12）、9～13 成功、14 起（含 20）大成功、4 以下（含 1）大失敗
    expect(p.check!.odds).toEqual({ critical: 7 / 20, success: 5 / 20, fail: 4 / 20, fumble: 4 / 20 })
    expect(p.check!.success).toBeCloseTo(12 / 20, 9)
    for (let face = 1; face <= 20; face++) {
      const r = makeCheck({ natural: face, parts: p.check!.parts, dc: p.check!.dc })
      expect(r.degree === 'critical' || r.degree === 'success').toBe(face + 4 >= 13 || face === 20)
    }
    g.state.rules = { ...g.state.rules, dcOffset: 2 } as never
    const hard = pre(g)
    expect(hard.difficulty).toMatchObject({ offset: 2, total: 15 })
    expect(hard.check!.dc).toBe(15)
    expect(hard.check!.odds.critical).toBeLessThan(p.check!.odds.critical)
  })

  it('成品的等級、合法性（最嚴的零件）、價錢、重量、stats 與親和的合計', () => {
    const g = make()
    asSelf(g)
    give(g, 'pt_barrel_4')
    const p = pre(g)
    expect(p.result).toMatchObject({ grade: 2, legal: 'register', price: 480, weight: 3, stats: { hit: 1, damage: 3 }, brands: ['hz'], fullSet: true, quality: null })
    expect(p.result!.price).toBe(productPrice(g.k.content, 'bp_pistol', { uid: '', parts: PISTOL, quality: 'standard' }))
    const four = pre(g, { parts: { barrel: 'pt_barrel_4', action: 'pt_action' } })
    expect(four.slots.find((s) => s.type === 'barrel')!.picked[0]!.problems).toEqual(['比設計圖高兩級以上，塞不進去。'])
    expect(four.block).toContain('塞不進去')
    expect(four.result!.stats).toEqual({ damage: 1 }) // 有問題的零件不算進成品：只剩機構
  })

  it('少一個必要的零件：預覽列出缺什麼、assembleDraft 被擋並寫出缺哪一種；一個零件都沒放也一樣', () => {
    const g = make()
    asSelf(g)
    const p = pre(g, { parts: { barrel: 'pt_barrel' } })
    expect(p.missing).toEqual(['機構'])
    expect(p.slots.find((s) => s.type === 'action')).toMatchObject({ required: true, missing: 1, picked: [] })
    expect(p.problems).toContain('缺零件：機構。')
    expect(reasonOf(() => assembleDraft(g.k, g.state, opts({ parts: { barrel: 'pt_barrel' } })))).toContain('缺零件：機構')
    const none = pre(g, { parts: {} })
    expect(none.missing).toEqual(['槍管', '機構'])
    expect(none.result).toBeNull() // 不拿設計圖的原廠組合補上
    expect(none.block).toBe('缺零件：槍管、機構。')
    expect(count(g, 'pt_barrel')).toBe(1)
  })

  it('預覽不改狀態、不擲骰：連看幾次一樣、亂數游標不動', () => {
    const g = make()
    asSelf(g)
    const before = JSON.stringify(g.state)
    const a = pre(g)
    const b = pre(g)
    expect(b).toEqual(a)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('零件有問題的原因：背包裡沒有、不是零件、放兩次、放不進槽、槽放太多；義體另外給沉溺成本', () => {
    const g = make()
    asSelf(g)
    give(g, 'it_junk')
    expect(pre(g, { parts: { barrel: 'pt_barrel_ka', action: 'pt_action' } }).problems[0]).toContain('背包裡沒有')
    expect(pre(g, { parts: { barrel: 'it_junk', action: 'pt_action' } }).problems.join('')).toContain('不是能組裝的零件') // it_junk 是背包裡的東西、但不是零件
    g.state.inventory.push({ id: 'it_junk', qty: 1, data: { uid: 'junk1' } })
    expect(pre(g, { parts: { barrel: 'junk1', action: 'pt_action' } }).problems.join('')).toContain('不是能組裝的零件')
    expect(pre(g, { parts: { barrel: ['pt_barrel', 'pt_barrel'], action: 'pt_action' } }).problems.join('')).toContain('最多放 1 個')
    expect(pre(g, { parts: { chip: 'pt_chip', barrel: 'pt_barrel', action: 'pt_action' } }).problems.join('')).toContain('沒有晶片的槽')
    expect(pre(g, { parts: { barrel: 'pt_action', action: 'pt_action' } }).problems.join('')).toContain('這個槽要的是槍管')
    expect(pre(g, { blueprint: 'bp_nope' }).problems).toEqual(['找不到這張設計圖。'])
    expect(pre(g, { maker: 'wizard' as never }).problems[0]).toContain('要說是誰來做')
    // 同一種零件只有一個，放兩個槽
    give(g, 'pt_act'); give(g, 'pt_plate'); give(g, 'pt_neuron_bio'); give(g, 'pt_skin_bio')
    know(g, 'bp_arm')
    const arm = assemblyPreview(g.k, g.state, { blueprint: 'bp_arm', parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' } })
    expect(arm.result!.sink).toEqual({ base: 6, parts: 0, total: 6 })
    expect(pre(g).result!.sink).toBeUndefined()
    // 機械的槽放生體的零件
    const wrong = assemblyPreview(g.k, g.state, { blueprint: 'bp_arm', parts: { plate: 'pt_skin_bio', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' } })
    expect(wrong.problems.join('')).toContain('要的是板材')
  })
})

// ---- 自己做：四種成功程度 ----

describe('組裝的四種成功程度（固定骰子）', () => {
  const make1 = () => { const g = make(); asSelf(g); return g }

  it('大成功是精工：bonus 加在 stats 合計最高的那一個鍵上 +1，價錢 ×1.1；零件拿掉、時間 +240 分鐘、自己做不收錢', async () => {
    const g = make1()
    const t0 = now(g)
    const d = withDice(NAT14, () => assembleDraft(g.k, g.state, opts()))
    const { violations } = await observed(g, () => g.commit(d))
    expect(violations).toEqual([])
    const made = product(g)!
    expect(made.data).toMatchObject({ uid: 'pr1', parts: PISTOL, quality: 'fine', bonus: { damage: 1 }, state: 'new' })
    expect(made.data!.quirks).toBeUndefined()
    expect(count(g, 'pt_barrel')).toBe(0)
    expect(count(g, 'pt_action')).toBe(0)
    expect(now(g) - t0).toBe(240)
    expect(g.state.money).toEqual({ cred: 5000, cash: 500 })
    expect(g.state.seq.uid).toBe(1)
    expect(g.state.rng.cursor).toBeGreaterThan(0)
    expect(productPrice(g.k.content, 'bp_pistol', made.data)).toBe(Math.round(480 * 1.1))
    expect(productOf(g.k.content, 'bp_pistol', made.data)!.stats).toEqual({ hit: 1, damage: 4 })
    expect(last(g)).toMatchObject({ kind: 'action', action: 'craft.assemble', actor: 'pc', outcome: { result: 'fine' } })
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
    expect(last(g).timeline.some((b) => b.roll?.degree === 'critical')).toBe(true)
    // 組好的手槍 gear 讀得到（damage 4：精工多一點）
    expect(weaponOf(g.k, g.state, 'pc', 'pr1').flat).toBe(4)
  })

  it('義體的精工是 bonus: { sink: -1 }', () => {
    const g = make()
    g.state.flags.home_level = 2
    know(g, 'bp_arm')
    for (const id of ['pt_plate', 'pt_act', 'pt_neuron_bio', 'pt_skin_bio']) give(g, id)
    // 義臂 II 級、兩個接面：DC 15，加值 +4（義體學）：骰 20 大成功
    const d = withDice(NAT20, () => assembleDraft(g.k, g.state, { blueprint: 'bp_arm', parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' } }))
    g.commit(d)
    const arm = product(g, 'bp_arm')!
    expect(arm.data).toMatchObject({ quality: 'fine', bonus: { sink: -1 } })
    expect(productOf(g.k.content, 'bp_arm', arm.data)!.stats.sink).toBe(-1)
  })

  it('成功照規格：標準品質、沒有瑕疵、價錢 480', () => {
    const g = make1()
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, opts())))
    const made = product(g)!
    expect(made.data).toMatchObject({ uid: 'pr1', parts: PISTOL, quality: 'standard', state: 'new' })
    expect(made.data!.bonus).toBeUndefined()
    expect(made.data!.quirks).toBeUndefined()
    expect(productPrice(g.k.content, 'bp_pistol', made.data)).toBe(480)
    expect(last(g).outcome.result).toBe('standard')
  })

  it('失敗是帶瑕疵：flawed 加一筆 flaw 的怪癖（pool 含 flaw、applies 對得上的）；價錢 ×0.8；武器不會抽到只給義體的那一筆', () => {
    const g = make1()
    g.commit(withDice(NAT6, () => assembleDraft(g.k, g.state, opts())))
    const made = product(g)!
    expect(made.data).toMatchObject({ quality: 'flawed', quirks: ['qx_loose'] })
    expect(productPrice(g.k.content, 'bp_pistol', made.data)).toBe(Math.round(480 * 0.8))
    expect(productOf(g.k.content, 'bp_pistol', made.data)!.stats.hit).toBe(0)
    expect(count(g, 'pt_barrel')).toBe(0)
    expect(last(g).outcome.result).toBe('flawed')
    // 義體抽到義體的那一筆
    const arm = make()
    arm.state.flags.home_level = 2
    know(arm, 'bp_ears')
    give(arm, 'pt_ear')
    // 獸耳 I 級：DC 10、全生體用醫療（+2 屬性 +1 技能 = +3）：骰 6 → 9 失敗
    arm.commit(withDice(NAT6, () => assembleDraft(arm.k, arm.state, { blueprint: 'bp_ears', parts: { skin: 'pt_ear' } })))
    expect(product(arm, 'bp_ears')!.data).toMatchObject({ quality: 'flawed', quirks: ['qx_numb'] })
    // 排異（CRAFTING 第 6 節；M4-followups-2 第 4 項）：義體組裝失敗，沉溺成本另外多 reject_sink（預設 1）；武器的失敗沒有這一筆
    const armData = product(arm, 'bp_ears')!.data!
    expect(armData.bonus).toEqual({ sink: 1 })
    expect(productOf(arm.k.content, 'bp_ears', armData)!.stats.sink).toBe(productOf(arm.k.content, 'bp_ears', { ...armData, bonus: undefined })!.stats.sink + 1)
    expect(last(arm).narration?.results?.join('')).toContain('排異')
    expect(made.data!.bonus).toBeUndefined()
  })

  it('失敗時內容裡沒有適用的瑕疵：照樣是 flawed，只是沒有怪癖', () => {
    const g = make({ pack: pack((c) => { c.quirk = c.quirk!.filter((q) => q.id !== 'qx_loose') }) })
    asSelf(g)
    g.commit(withDice(NAT6, () => assembleDraft(g.k, g.state, opts())))
    const made = product(g)!
    expect(made.data!.quality).toBe('flawed')
    expect(made.data!.quirks).toBeUndefined()
  })

  it('大失敗少一個零件、沒有成品、其餘零件還在、時間照過；有超規的燒超規的那一個', () => {
    const g = make1()
    const t0 = now(g)
    g.commit(withDice([NAT1, 0.99], () => assembleDraft(g.k, g.state, opts())))
    expect(product(g)).toBeUndefined()
    expect(count(g, 'pt_barrel') + count(g, 'pt_action')).toBe(1)
    expect(now(g) - t0).toBe(240)
    expect(g.state.seq.uid).toBe(0)
    expect(last(g).outcome.result).toBe('burned')
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
    // 第二個骰面 0.99 抽到的是最後一個（機構）：槍管還在
    expect(count(g, 'pt_barrel')).toBe(1)
    // 有超規的：燒超規的那一個（不管第二顆骰子）
    const o = make()
    asSelf(o)
    give(o, 'pt_barrel_3h')
    const burn = (v: number) => {
      const copy = make()
      copy.load(o.save())
      copy.commit(withDice([NAT1, v], () => assembleDraft(copy.k, copy.state, opts({ parts: { barrel: 'pt_barrel_3h', action: 'pt_action' } }))))
      return copy
    }
    for (const v of [0, 0.99]) {
      const r = burn(v)
      expect(count(r, 'pt_barrel_3h')).toBe(0)
      expect(count(r, 'pt_action')).toBe(1)
      expect(count(r, 'pt_barrel')).toBe(1)
    }
  })

  it('同樣的狀態重擲結果一樣（骰子從狀態導出），失手之後再試才換新的骰面（游標往前）', () => {
    const g = make1()
    const a = assembleDraft(g.k, g.state, opts())
    const b = assembleDraft(g.k, g.state, opts())
    expect(b).toEqual(a)
    expect(a.changes.some((c) => c.op === 'rng')).toBe(true)
    const cursor = g.state.rng.cursor
    g.commit(a)
    expect(g.state.rng.cursor).toBe(cursor + 1)
  })

  it('工坊（條件 ability，daily: workshop）：檢定 +2、超規的修正減半；沒有人註冊這個條件就沒有加成', () => {
    const g = make({ ability: true })
    asSelf(g)
    give(g, 'pt_barrel_3h')
    const parts = { barrel: 'pt_barrel_3h', action: 'pt_action' }
    const plain = assemblyPreview(g.k, g.state, opts({ parts }))
    expect(plain.difficulty).toMatchObject({ overspec: 3, total: 16 })
    expect(plain.check!.bonus).toBe(4)
    g.state.flags.workshop = true
    const ws = assemblyPreview(g.k, g.state, opts({ parts }))
    expect(ws.check).toMatchObject({ workshop: true, bonus: 6 })
    expect(ws.difficulty).toMatchObject({ overspec: 2, total: 15 })
    expect(ws.check!.parts.some((p) => p.label === '工坊' && p.value === 2)).toBe(true)
    // 真的擲的時候也加：骰 9（9 + 6 = 15 剛好成功），沒有工坊 9 + 4 = 13 對 16 失敗
    g.commit(withDice(0.4, () => assembleDraft(g.k, g.state, opts({ parts }))))
    expect(product(g)!.data!.quality).toBe('standard')
    const none = make()
    asSelf(none)
    give(none, 'pt_barrel_3h')
    none.state.flags.workshop = true
    expect(assemblyPreview(none.k, none.state, opts({ parts })).check).toMatchObject({ workshop: false, bonus: 4 })
  })

  it('全生體用醫療、義體用義體學、武器用機械；隊友動手要在隊上', () => {
    const g = make({ actors: [makeActor({ id: 'friend', name: '阿友', role: 'companion', attrs: { tech: 10 } as never, skills: { mechanics: 3 } })] })
    asSelf(g)
    expect(pre(g).check!.skill).toBe('mechanics')
    know(g, 'bp_pistol', 'bp_ears')
    give(g, 'pt_ear')
    const ears = assemblyPreview(g.k, g.state, { blueprint: 'bp_ears', parts: { skin: 'pt_ear' } })
    expect(ears.check).toMatchObject({ skill: 'medicine', bonus: 3 })
    expect(ears.result!.allBio).toBe(true)
    // 隊友不在隊上：被擋；進了隊：用他的加值
    g.state.party = []
    expect(pre(g, { by: 'friend' }).block).toContain('隊上')
    g.state.party = ['pc', 'friend']
    const friend = pre(g, { by: 'friend' })
    expect(friend.block).toBeNull()
    expect(friend.check).toMatchObject({ by: 'friend', bonus: 3 })
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, opts({ by: 'friend' }))))
    expect(last(g).actor).toBe('friend')
    expect(pre(g, { by: 'nobody' }).block).toContain('找不到動手的人')
  })
  const pre = (g: G, o: Rec = {}) => assemblyPreview(g.k, g.state, opts(o))
})

// ---- 在哪裡做、誰來做 ----

describe('誰來做', () => {
  it('自己做：要在二級以上的住處或帶 craft 的設施；一級的住處不行', () => {
    const g = make()
    know(g, 'bp_pistol')
    stockParts(g)
    stand(g, 'F1', 'b_flat')
    expect(assembleBlock(g.k, g.state, opts())).toContain('有工作台')
    g.state.flags.home_level = 1
    expect(assembleBlock(g.k, g.state, opts())).toContain('有工作台')
    g.state.flags.home_level = 2
    expect(assembleBlock(g.k, g.state, opts())).toBeNull()
    g.state.flags.home_level = 0
    stand(g, 'F4') // 沒有 craft 的設施
    expect(assembleBlock(g.k, g.state, opts())).toContain('有工作台')
    stand(g, 'F1') // 槍店的工作台：自己也能用
    expect(assembleBlock(g.k, g.state, opts())).toBeNull()
  })

  it('makers 列出這裡有誰：自己動手一直列（不在工作台時帶原因），站在店裡多一個', () => {
    const g = make()
    stand(g, 'F4')
    expect(makers(g.k, g.state).map((m) => [m.id, m.block === null])).toEqual([['self', false]])
    stand(g, 'F1')
    expect(makers(g.k, g.state).map((m) => [m.id, m.block])).toEqual([['self', null], ['shop', null]])
    stand(g, 'F2')
    expect(makers(g.k, g.state).map((m) => m.id)).toEqual(['self', 'doujin'])
    stand(g, 'F3')
    expect(makers(g.k, g.state).find((m) => m.id === 'factory')).toMatchObject({ brand: 'hz', rule: { fee_per_grade: 150, full_set_only: true, fine: true } })
    // 在別人的設施選別人的那一種被擋
    know(g, 'bp_pistol')
    stockParts(g)
    expect(assembleBlock(g.k, g.state, opts({ maker: 'shop' }))).toBe('這裡沒有店家代工。')
  })

  it('店家：扣 200、一定成功、不用自己會這張圖、不做超規（原因寫出來）；會登記', () => {
    const g = make()
    stockParts(g)
    give(g, 'pt_barrel_3h')
    stand(g, 'F1')
    const p = assemblyPreview(g.k, g.state, opts({ maker: 'shop' }))
    expect(p).toMatchObject({ fee: 200, pay: 'cred', registered: true, check: null, block: null })
    expect(p.result!.quality).toBe('standard')
    const t0 = now(g)
    g.commit(assembleDraft(g.k, g.state, opts({ maker: 'shop' })))
    expect(g.state.money.cred).toBe(5000 - 200)
    expect(product(g)!.data).toMatchObject({ parts: PISTOL, quality: 'standard' })
    expect(now(g) - t0).toBe(240)
    expect(g.state.rng.cursor).toBe(0) // 一定成功：沒有擲骰
    // 超規被擋
    give(g, 'pt_action')
    const over = assemblyPreview(g.k, g.state, opts({ maker: 'shop', parts: { barrel: 'pt_barrel_3h', action: 'pt_action' } }))
    expect(over.block).toContain('不做超規')
    expect(reasonOf(() => assembleDraft(g.k, g.state, opts({ maker: 'shop', parts: { barrel: 'pt_barrel_3h', action: 'pt_action' } })))).toContain('不做超規')
  })

  it('同人社團：扣 120、要自己會這張圖、超規照做；機率 1 時多一筆 doujin 池的怪癖而且 state 是 doujin；機率 0 時沒有', () => {
    const g = make({ pack: pack((c) => { c.craft_rule = [{ id: 'default', makers: { doujin: { quirk_chance: 1 } } }] }) })
    stockParts(g)
    give(g, 'pt_barrel_3h')
    stand(g, 'F2')
    expect(assembleBlock(g.k, g.state, opts({ maker: 'doujin' }))).toContain('自己要先會做')
    know(g, 'bp_pistol')
    const parts = { barrel: 'pt_barrel_3h', action: 'pt_action' }
    const pv = assemblyPreview(g.k, g.state, opts({ maker: 'doujin', parts }))
    // 同人社團的成功率高：照主角的檢定，DC 比設計圖的難度低 4（CRAFTING 10.1 節；M4-followups-2 第 4 項），不是一定成功
    expect(pv).toMatchObject({ fee: 120, block: null })
    expect(pv.check).not.toBeNull()
    expect(pv.check!.dc).toBe(pv.difficulty!.total - 4)
    expect(pv.difficulty!.overspec).toBe(3)
    g.commit(withDice(0.5, () => assembleDraft(g.k, g.state, opts({ maker: 'doujin', parts }))))
    expect(g.state.money.cred).toBe(5000 - 120)
    const made = product(g)!
    expect(made.data).toMatchObject({ quality: 'standard', state: 'doujin', quirks: ['qx_club'] })
    expect(last(g).outcome.result).toBe('doujin')
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
    // 預設的 0.25：骰 0.9 沒有、骰 0.1 有
    const d = make()
    know(d, 'bp_pistol')
    stockParts(d)
    stand(d, 'F2')
    d.commit(withDice(0.9, () => assembleDraft(d.k, d.state, opts({ maker: 'doujin' }))))
    expect(product(d)!.data!.quirks).toBeUndefined()
    expect(product(d)!.data!.state).toBe('new')
    const e = make()
    know(e, 'bp_pistol')
    stockParts(e)
    stand(e, 'F2')
    e.commit(withDice(0.1, () => assembleDraft(e.k, e.state, opts({ maker: 'doujin' }))))
    // 骰 0.1 連檢定也失敗（同人不是一定成功）：多一筆瑕疵的怪癖，再加社團自己的那一筆
    expect(product(e)!.data).toMatchObject({ state: 'doujin', quality: 'flawed' })
    expect(product(e)!.data!.quirks).toContain('qx_club')
  })

  it('原廠：混牌被擋、全套一定成功而且是精工；工錢暫定 150 × 等級；不做超規；只做自己牌子的', () => {
    const g = make()
    stockParts(g)
    give(g, 'pt_barrel_ka'); give(g, 'pt_barrel_3h')
    stand(g, 'F3')
    const mixed = assemblyPreview(g.k, g.state, opts({ maker: 'factory', parts: { barrel: 'pt_barrel_ka', action: 'pt_action' } }))
    expect(mixed.block).toContain('混了別的牌子')
    expect(reasonOf(() => assembleDraft(g.k, g.state, opts({ maker: 'factory', parts: { barrel: 'pt_barrel_ka', action: 'pt_action' } })))).toContain('混了別的牌子')
    expect(assemblyPreview(g.k, g.state, opts({ maker: 'factory', parts: { barrel: 'pt_barrel_3h', action: 'pt_action' } })).block).toContain('不做超規')
    const full = assemblyPreview(g.k, g.state, opts({ maker: 'factory' }))
    expect(full).toMatchObject({ fee: 300, block: null, check: null, registered: true })
    expect(full.result).toMatchObject({ quality: 'fine', price: Math.round(480 * 1.1), fullSet: true })
    g.commit(assembleDraft(g.k, g.state, opts({ maker: 'factory' })))
    expect(g.state.money.cred).toBe(5000 - 300)
    expect(product(g)!.data).toMatchObject({ quality: 'fine', bonus: { damage: 1 } })
    // 原廠只做自己牌子（hz）：ka 的設計圖與零件整套都是 ka 也不收
    const ka = make({ pack: pack((c) => { c.blueprint![0] = { ...c.blueprint![0]!, brand: 'ka' } }) })
    stand(ka, 'F3')
    give(ka, 'pt_barrel_ka'); give(ka, 'pt_action_ka')
    const wrong = assemblyPreview(ka.k, ka.state, opts({ maker: 'factory', parts: { barrel: 'pt_barrel_ka', action: 'pt_action_ka' } }))
    expect(wrong.block).toBe('這間原廠只做 hz 的東西。')
    expect(wrong.difficulty).toMatchObject({ brands: 0, total: 13 })
  })

  it('工錢付不起被擋；指定現金付；帳戶不夠先帳戶再現金', () => {
    const g = make({ money: { cred: 100, cash: 250 } })
    stockParts(g)
    stand(g, 'F1')
    expect(assemblyPreview(g.k, g.state, opts({ maker: 'shop' })).pay).toBe('cash')
    expect(assemblyPreview(g.k, g.state, opts({ maker: 'shop', pay: 'cred' })).block).toContain('錢不夠')
    g.commit(assembleDraft(g.k, g.state, opts({ maker: 'shop', pay: 'cash' })))
    expect(g.state.money).toEqual({ cred: 100, cash: 50 })
    const poor = make({ money: { cred: 50, cash: 50 } })
    stockParts(poor)
    stand(poor, 'F1')
    expect(reasonOf(() => assembleDraft(poor.k, poor.state, opts({ maker: 'shop' })))).toContain('錢不夠')
  })

  it('規則表蓋掉預設：dc、牌子的加成、工錢、做一件花的時間', () => {
    const g = make({ pack: pack((c) => { c.craft_rule = [{ id: 'default', dc: [8, 9, 10, 11, 12], brand_step: 2, minutes: 60, makers: { shop: { fee_per_grade: 10 } } }] }) })
    stockParts(g)
    give(g, 'pt_barrel_ka')
    stand(g, 'F1')
    expect(assemblyPreview(g.k, g.state, opts({ maker: 'shop' })).fee).toBe(20)
    const p = assemblyPreview(g.k, g.state, opts({ parts: { barrel: 'pt_barrel_ka', action: 'pt_action' } }))
    expect(p.difficulty).toMatchObject({ base: 9, brands: 2, total: 11 })
    expect(p.minutes).toBe(60)
    expect(DEFAULT_CRAFT_RULES.dc).toEqual([10, 13, 16, 19, 22])
    know(g, 'bp_pistol')
    const t0 = now(g)
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, opts())))
    expect(now(g) - t0).toBe(60)
  })
})

// ---- 內嵌的零件 ----

describe('內嵌的零件（未登錄零件）', () => {
  const INLINE = {
    name: '無名的槍管', type: 'barrel', material: 'mech', brand: 'hz', grade: 2, price: 300, legal: 'free', cells: 2, stats: { hit: 3, damage: 2 }, weight: 1, size: 1, state: 'new',
    unreg: true, uid: 'u1', desc: '一根不在任何目錄上的槍管。',
  }
  const withInline = () => {
    const g = make()
    asSelf(g)
    g.state.inventory = g.state.inventory.filter((s) => s.id !== 'pt_barrel')
    g.state.inventory.push({ id: UNREG_STACK_ID, qty: 1, data: { uid: 'u1', part: structuredClone(INLINE) } })
    return g
  }
  const parts = { barrel: 'u1', action: 'pt_action' }

  it('預覽與成品的 stats 算到它、那一疊沒有了、成品的 parts 裡是那一整筆', () => {
    const g = withInline()
    const p = assemblyPreview(g.k, g.state, opts({ parts }))
    expect(p.problems).toEqual([])
    expect(p.result!.stats).toEqual({ hit: 3, damage: 3 })
    expect(p.slots.find((s) => s.type === 'barrel')!.picked[0]).toMatchObject({ key: 'u1', id: 'unreg:u1', unreg: true, name: '無名的槍管' })
    expect(p.result!.price).toBe(Math.round((300 + 200) * 1.2))
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, opts({ parts }))))
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
    const made = product(g)!
    expect(made.data!.parts).toEqual({ barrel: INLINE, action: 'pt_action' })
    expect(partOf(g.k.content, (made.data!.parts as Rec).barrel)).toMatchObject({ name: '無名的槍管', unreg: true })
    expect(productOf(g.k.content, 'bp_pistol', made.data)!.stats.hit).toBe(3)
    expect(weaponOf(g.k, g.state, 'pc', made.data!.uid as string).hit).toBe(0 + 2 + 3) // 反射調整值 0 ＋ 槍械 2 ＋ 零件的命中 3
  })

  it('失敗與大失敗：內嵌的零件照樣整筆處理（大失敗燒掉的是那一疊，其餘還在）', () => {
    const g = withInline()
    g.commit(withDice([NAT1, 0], () => assembleDraft(g.k, g.state, opts({ parts }))))
    expect(product(g)).toBeUndefined()
    expect(g.state.inventory.some((s) => s.id === UNREG_STACK_ID)).toBe(false)
    expect(count(g, 'pt_action')).toBe(1)
  })

  it('壞掉的內嵌零件不是零件；同一個 uid 放兩次被擋；也不會被當成 id 搬進成品', () => {
    const g = withInline()
    g.state.inventory.push({ id: UNREG_STACK_ID, qty: 1, data: { uid: 'u2', part: { ...structuredClone(INLINE), uid: 'u2', unreg: false } } })
    expect(assemblyPreview(g.k, g.state, opts({ parts: { barrel: 'u2', action: 'pt_action' } })).problems.join('')).toContain('不是能組裝的零件')
    expect(assemblyPreview(g.k, g.state, opts({ parts: { barrel: ['u1', 'u1'], action: 'pt_action' } })).problems.join('')).toContain('最多放 1 個')
  })

  it('內嵌的零件超規、牌子不同一樣算進難度；有帶怪癖的零件，怪癖算進成品', () => {
    const g = make()
    asSelf(g)
    g.state.inventory.push({ id: UNREG_STACK_ID, qty: 1, data: { uid: 'u3', part: { ...structuredClone(INLINE), uid: 'u3', grade: 3, brand: 'ka', quirk: 'qx_club' } } })
    const p = assemblyPreview(g.k, g.state, opts({ parts: { barrel: 'u3', action: 'pt_action' } }))
    expect(p.difficulty).toMatchObject({ brands: 1, overspec: 3, total: 17 })
    // 怪癖 qx_club 的 stats（hit +1）：3 + 1
    expect(p.result!.stats.hit).toBe(4)
  })
})

// ---- 成品進交易 ----

describe('成品在交易裡買得到、賣得掉', () => {
  const sellRow = (g: G, uid: string) => shopView(g.k, g.state, 's_gun').sell.find((r) => r.uid === uid)

  it('組出來的手槍在店裡賣得掉：要指名 uid、價錢只算零件（TRADE 8.3）乘收購比例；不指名被擋；穿著的不能賣', () => {
    const g = make()
    asSelf(g)
    g.commit(withDice(NAT10, () => assembleDraft(g.k, g.state, opts())))
    const uid = product(g)!.data!.uid as string
    expect(sellBlock(g.k, g.state, 's_gun', 'bp_pistol', 1)).toContain('指名')
    expect(sellBlock(g.k, g.state, 's_gun', 'bp_pistol', 1, uid)).toBeNull()
    const q = quote(g.k, g.state, 's_gun', 'bp_pistol', 'sell', { uid })
    expect(q.price).toBe(Math.round(400 * 0.4)) // 零件 200 ＋ 200，收購比例 40%，不算組裝的兩成
    expect(q.steps[0]).toEqual({ id: 'catalog', name: '目錄價', mult: 1, value: 400 })
    expect(q.price).toBeLessThan(Math.round(productPrice(g.k.content, 'bp_pistol', product(g)!.data) * 0.4))
    expect(sellRow(g, uid)).toMatchObject({ item: 'bp_pistol', price: 160, block: null, tradeCategory: 'weapon', qty: 1 })
    const plan = planCheckout(g.k, g.state, 's_gun', { sell: [{ item: 'bp_pistol', qty: 1, uid }], pay: 'cred' })
    expect(plan.problems).toEqual([])
    const cred = g.state.money.cred
    g.commit(checkout(g.k, g.state, 's_gun', { sell: [{ item: 'bp_pistol', qty: 1, uid }], pay: 'cred' }))
    expect(g.state.money.cred).toBe(cred + 160)
    expect(product(g)).toBeUndefined()
  })

  it('精工、帶瑕疵、二手的價錢照核心的係數（精工 ×1.1、瑕疵 ×0.8、二手 ×0.5）；穿戴中的不能賣', () => {
    const g = make()
    g.state.inventory.push(
      { id: 'bp_pistol', qty: 1, data: { uid: 'pf', parts: PISTOL, quality: 'fine', bonus: { damage: 1 } } },
      { id: 'bp_pistol', qty: 1, data: { uid: 'pw', parts: PISTOL, quality: 'flawed' } },
      { id: 'bp_pistol', qty: 1, data: { uid: 'pu', parts: PISTOL, state: 'used' } },
    )
    const price = (uid: string) => quote(g.k, g.state, 's_gun', 'bp_pistol', 'sell', { uid }).price
    expect([price('pf'), price('pw'), price('pu')]).toEqual([Math.round(400 * 1.1 * 0.4), Math.round(400 * 0.8 * 0.4), Math.round(400 * 0.5 * 0.4)])
    g.state.actors.pc!.ext.gear = { worn: {}, acc: {}, carry: { side: 'pf' } }
    expect(sellBlock(g.k, g.state, 's_gun', 'bp_pistol', 1, 'pf')).toContain('穿戴')
    expect(sellRow(g, 'pf')!.block).toContain('穿戴')
  })

  it('全生體的成品不收（生體件是活的）；店不收這一類的也有原因', () => {
    const g = make({ pack: pack((c) => { c.shop_type![0] = { ...c.shop_type![0]!, buys: ['weapon'] } }) })
    g.state.inventory.push({ id: 'bp_ears', qty: 1, data: { uid: 'e1', parts: { skin: 'pt_ear' } } })
    expect(sellBlock(g.k, g.state, 's_gun', 'bp_ears', 1, 'e1')).toBeTruthy()
    const g2 = make()
    g2.state.inventory.push({ id: 'bp_ears', qty: 1, data: { uid: 'e1', parts: { skin: 'pt_ear' } } })
    expect(sellBlock(g2.k, g2.state, 's_gun', 'bp_ears', 1, 'e1')).toContain('生體件')
    // 混裝的義臂：算 part 類（機械義體與零件）、店收
    g2.state.inventory.push({ id: 'bp_arm', qty: 1, data: { uid: 'a1', parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron_bio', skin: 'pt_skin_bio' } } })
    expect(sellBlock(g2.k, g2.state, 's_gun', 'bp_arm', 1, 'a1')).toBeNull()
    expect(sellRow(g2, 'a1')).toMatchObject({ tradeCategory: 'mech', price: Math.round((150 + 150 + 300 + 200) * 0.4) })
  })

  it('店裡買一件原廠的成品：標價是 productPrice、背包多一疊帶 parts 的（uid 用核心的流水號）；一件一疊；今天賣完了', () => {
    const g = make()
    const shelf = stockOf(g.k, g.state, 's_gun')
    expect(shelf.map((r) => [r.item, r.total, r.left])).toEqual([['bp_pistol', 1, 1]])
    expect(quote(g.k, g.state, 's_gun', 'bp_pistol', 'buy').price).toBe(480)
    expect(shopView(g.k, g.state, 's_gun').shelf[0]).toMatchObject({ item: 'bp_pistol', name: '手槍', price: 480, grade: 2, legal: 'register', tradeCategory: 'weapon', block: null })
    const cred = g.state.money.cred
    g.commit(checkout(g.k, g.state, 's_gun', { buy: [{ item: 'bp_pistol', qty: 1 }], pay: 'cred' }))
    expect(g.state.money.cred).toBe(cred - 480)
    expect(g.state.inventory).toEqual([{ id: 'bp_pistol', qty: 1, data: { uid: 'pr1', parts: PISTOL, quality: 'standard', state: 'new' } }])
    expect(g.state.seq.uid).toBe(1)
    expect(stackOf(g.state, 'pr1')).toBeTruthy()
    expect(weaponOf(g.k, g.state, 'pc', 'pr1').name).toBe('手槍')
    expect(buyBlock(g.k, g.state, 's_gun', 'bp_pistol')).toContain('賣完')
    // 買來的馬上賣回去：只算零件，不賺錢
    const back = quote(g.k, g.state, 's_gun', 'bp_pistol', 'sell', { uid: 'pr1' }).price
    expect(back).toBeLessThan(480)
  })

  it('一次買兩把：各有各的 uid、各一疊；買來的 parts 是原廠組合的複本（改一把不影響設計圖）', () => {
    const g = make({ pack: pack((c) => { c.shop![0] = { ...c.shop![0]!, fixed_products: ['bp_pistol'] }; c.trade_rule = [{ id: 'default', stock_by_category: { weapon: [3, 3] } }] }) })
    g.commit(checkout(g.k, g.state, 's_gun', { buy: [{ item: 'bp_pistol', qty: 2 }], pay: 'cred' }))
    expect(g.state.inventory.map((s) => [s.id, s.qty, s.data!.uid])).toEqual([['bp_pistol', 1, 'pr1'], ['bp_pistol', 1, 'pr2']])
    expect(g.state.seq.uid).toBe(2)
    ;(g.state.inventory[0]!.data!.parts as Rec).barrel = 'pt_barrel_ka'
    expect(g.k.content.get<{ id: string; stock: Rec }>('blueprint', 'bp_pistol')!.stock.barrel).toBe('pt_barrel')
    expect((g.state.inventory[1]!.data!.parts as Rec).barrel).toBe('pt_barrel')
  })

  it('既有的物品交易不變：沒有 item 的 id 也不是設計圖，照舊說沒有這樣東西', () => {
    const g = make()
    expect(buyBlock(g.k, g.state, 's_gun', 'zz_nothing')).toContain('沒有 zz_nothing')
    expect(sellBlock(g.k, g.state, 's_gun', 'zz_nothing', 1)).toContain('沒有 zz_nothing')
    expect(sellBlock(g.k, g.state, 's_gun', 'bp_smg', 1)).toContain('沒有') // 設計圖 bp_smg 沒有原廠組合，不當成可以賣的東西
  })
})

// ---- 住處的等級（rest 的條件 at_home 多收 level_min） ----

describe('at_home 的 level_min（真的 rest）', () => {
  const homePack = (): ContentPack => ({
    id: 'home_test',
    content: {
      special_map: [structuredClone(MAP)],
      facility_type: [{ id: 'fac_home', name: '公寓' }],
      district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_hive'] }],
      block: [{ id: 'b_hive', district: 'd_hive', name: '四號塔', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_home', name: '一級單位' }, F2: { type: 'fac_home', name: '二級單位' } } }],
      residence: [
        { id: 'r_one', name: '一級單位', district: 'd_hive', block: 'b_hive', facility: 'F1', level: 1, rent: 100 },
        { id: 'r_two', name: '二級單位', district: 'd_hive', block: 'b_hive', facility: 'F2', level: 2, rent: 300, cash_ok: true },
      ],
    } as unknown as ContentPack['content'],
  })
  const mk = (id: string) => {
    const { game } = makeGame({ features: [characterFeature, worldFeature, restFeature], content: [homePack()], seed: 7, pc: { hp: 40 }, patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 5000, cash: 5000 } } })
    game.commit(rentDraft(game.k, game.state, id))
    game.commit(arrive(game.k, game.state, 'b_hive', id === 'r_one' ? 'F1' : 'F2'))
    return game
  }
  const at = (g: ReturnType<typeof mk>, c: Rec) => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('level_min: 2：一級的住處不成立、二級的成立；不帶的行為和以前一樣', () => {
    const one = mk('r_one')
    expect(at(one, { kind: 'at_home' })).toBe(true)
    expect(at(one, { kind: 'at_home', level_min: 1 })).toBe(true)
    expect(at(one, { kind: 'at_home', level_min: 2 })).toBe(false)
    const two = mk('r_two')
    expect(at(two, { kind: 'at_home' })).toBe(true)
    expect(at(two, { kind: 'at_home', level_min: 2 })).toBe(true)
    expect(at(two, { kind: 'at_home', level_min: 3 })).toBe(false)
    // 不在住處站著：level_min 再低也不成立
    two.commit(arrive(two.k, two.state, 'b_hive', 'F1'))
    expect(at(two, { kind: 'at_home', level_min: 0 })).toBe(false)
  })

  it('格式檢查：level_min 要是 0～3 的整數', () => {
    const g = mk('r_one')
    expect(g.k.conditions.validate({ kind: 'at_home', level_min: 2 })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'at_home' })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'at_home', level_min: 4 })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'at_home', level_min: 1.5 })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'at_home', level_min: 'x' })).not.toEqual([])
  })

  it('組裝：真的 rest 加 craft，一級的住處自己組被擋、二級的行', () => {
    const run = (id: string) => {
      const { game } = makeGame({
        features: [characterFeature, worldFeature, restFeature, craftFeature], content: [homePack(), pack((c) => { c.skill = structuredClone(SKILLS); c.weapon_class = structuredClone(WEAPONS); delete c.shop; delete c.shop_type; delete c.special_map; delete c.district; delete c.block; delete c.facility_type })],
        seed: 7, pc: { hp: 40, attrs: { tech: 14 }, skills: { mechanics: 2 } }, patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 5000, cash: 5000 } },
      }) as { game: ReturnType<typeof mk> }
      game.commit(rentDraft(game.k, game.state, id))
      game.commit(arrive(game.k, game.state, 'b_hive', id === 'r_one' ? 'F1' : 'F2'))
      game.state.ext.craft = { known: ['bp_pistol'] }
      give(game as unknown as G, 'pt_barrel'); give(game as unknown as G, 'pt_action')
      return assembleBlock(game.k, game.state, opts())
    }
    expect(run('r_one')).toContain('有工作台')
    expect(run('r_two')).toBeNull()
  })
})

// ---- 其餘 ----

describe('其餘', () => {
  it('assembleProblems 一條一句列全部（不重複、都是完整的句子）', () => {
    const g = make()
    stand(g, 'F4')
    const all = assembleProblems(g.k, g.state, opts({ parts: { barrel: 'pt_barrel' } }))
    expect(all.length).toBeGreaterThanOrEqual(3)
    expect(new Set(all).size).toBe(all.length)
    expect(all.every((m) => /[。]$/.test(m))).toBe(true)
  })

  it('有副本之類的活動擋住時不能組（原因照活動的）', () => {
    const stub: Feature = {
      id: 'run_stub',
      install(k) {
        k.activity.define({ kind: 'commission', owner: 'run_stub', order: 90, active: (s) => (s.flags.in_run === true ? { id: 'c1', label: '委託副本' } : null), allow: ['commit:test.'], reason: () => '委託副本進行中，先把它做完。' })
      },
    }
    const { game: g } = makeGame({ features: [characterFeature, worldFeature, HOME, craftFeature, stub], content: [pack((c) => { delete c.shop; delete c.shop_type })], seed: 7, pc: { hp: 40, attrs: { tech: 14 }, skills: { mechanics: 2 } }, patch: { time: { day: 3, hour: 10, minute: 0 } } })
    asSelf(g as unknown as G)
    expect(assembleBlock(g.k, g.state, opts())).toBeNull()
    g.state.flags.in_run = true
    expect(assembleBlock(g.k, g.state, opts())).toBe('委託副本進行中，先把它做完。')
    expect(reasonOf(() => assembleDraft(g.k, g.state, opts()))).toBe('委託副本進行中，先把它做完。')
    expect(learnBlock(g.k, g.state, { item: 'it_lic' })).toBe('委託副本進行中，先把它做完。')
  })

  it('存檔往返：組好的成品與 known 還在；重新讀檔再組一次結果一樣', () => {
    const g = make()
    asSelf(g)
    const d = assembleDraft(g.k, g.state, opts())
    const raw = g.save()
    g.commit(d)
    const again = make()
    again.load(raw)
    again.commit(assembleDraft(again.k, again.state, opts()))
    expect(product(again)!.data).toEqual(product(g)!.data)
    const copy = make()
    copy.load(again.save())
    expect(product(copy)!.data).toEqual(product(g)!.data)
    expect(isKnown(copy.state, 'bp_pistol')).toBe(true)
    expect(pc(g).name).toBeTruthy()
  })

  it('不認得的 maker、不存在的主角的錯誤不丟 TypeError（只丟 ActionBlocked）', () => {
    const g = make()
    expect(() => assembleDraft(g.k, g.state, opts({ maker: 'x' as never }))).toThrow(ActionBlocked)
    expect(() => assembleDraft(g.k, g.state, opts({ blueprint: 'bp_nope' }))).toThrow(ActionBlocked)
    expect(() => assembleDraft(g.k, g.state, { blueprint: 'bp_pistol', parts: { barrel: 7 as never } })).toThrow(ActionBlocked)
    expect(breathDraft).toBeTypeOf('function')
  })
})
