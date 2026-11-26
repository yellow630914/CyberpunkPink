// 驗收測試：dev/work/M4-gear-m4.md（cpp-feature）。規格：EQUIPMENT 第 5 節（外層蓋住內層）、第 7 節（重量）、第 9 節（染色）；LEWD_SYSTEM 第 2 節（曝露度與風格）；
// DATA 7.1、7.7 節；CRAFTING 3.3 節（外皮決定風格與曝露度）；dev/adr/0019 第一、二節。曝露度的算法照 ElondiaRPG 的 src/engine/lewd.ts（上身、下身、內衣、真空）。
// 內容一律用測試自帶的最小假資料：上衣、下身、外套（短、長）、內衣、一把槍（可以帶瑕疵與精工）、三種外皮、重甲、染料與一間店家。
// 站上設施用真的 world；住處用測試的替身條件 at_home（旗標 home）。

import { describe, expect, it } from 'vitest'
import type { Condition, ContentPack, Feature, ItemStack, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx, stackOf, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import {
  DEFAULT_GEAR_RULES, armorOf, carryCapBase, carryLoadOf, coveredSlots, dyeBlock, dyeDraft, dyeOf, equip, gearFeature, gearOf, gearRules, overweight, styleOf, unequip, weaponOf,
} from '../../src/features/gear'
import { arrive, worldFeature } from '../../src/features/world'
import { makeGame, observed } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.....#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}
const SKILLS = ['firearms', 'brawl', 'stealth'].map((id) => ({ id, name: id, attr: id === 'firearms' || id === 'stealth' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: ['concealable'], attr: 'reflex', skill: 'firearms' }]
const bp = (id: string, kind: string, more: Rec): Rec => ({ id, kind, name: id, desc: `${id}。`, brand: 'starbelle', grade: 1, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...more })
const garment = (id: string, covers: string[], more: Rec = {}): Rec => bp(id, 'armor', { armor: 0, covers, weight_class: 'light', require: [{ type: 'fiber' }], ...more })
const part = (id: string, type: string, stats: Rec = {}, more: Rec = {}): Rec => ({ id, name: id, type, material: 'mech', brand: 'starbelle', grade: 1, price: 100, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new', ...more })
const street = (value = 1) => ({ tag: 'street', value })

const BLUEPRINTS = [
  bp('bp_pistol', 'weapon', { class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'action' }] }),
  garment('bp_cap', ['head'], { style: street() }),
  garment('bp_shirt', ['upper'], { style: street(), exposure: 2 }),
  garment('bp_shirt0', ['upper'], { style: street(), exposure: 0 }),
  garment('bp_tee1', ['upper'], { style: street(), exposure: 1 }),
  garment('bp_pants', ['lower'], { style: street(), exposure: 0 }),
  garment('bp_boots', ['shoes'], { style: street() }),
  garment('bp_boots_punk', ['shoes'], { style: { tag: 'punk', value: 1 } }),
  garment('bp_jacket', ['outer'], { style: street(), conceal: 3 }),
  garment('bp_longcoat', ['outer'], { style: street(), conceal: 5, long: true }),
  garment('bp_bra', ['underwear_top'], { exposure: 0 }),
  garment('bp_briefs', ['underwear_bottom'], { exposure: 0 }),
  garment('bp_dress', ['upper', 'lower'], { style: 'from_skin', exposure: 'from_skin', require: [{ type: 'fiber' }, { type: 'skin' }], optional: [{ type: 'plate' }] }),
  bp('bp_vest', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', weight: 2, require: [{ type: 'fiber' }, { type: 'plate' }] }),
  bp('bp_heavy', 'armor', { armor: 1, covers: ['armor'], weight_class: 'heavy', weight: 12, require: [{ type: 'fiber' }, { type: 'plate' }] }),
  garment('bp_dyed_default', ['upper'], { primary_color: 'dye_pink', secondary_color: '#101010' }),
]
const PARTS = [
  part('pt_barrel', 'barrel', { damage: 1, hit: 1 }), part('pt_action', 'action'), part('pt_fiber', 'fiber', { armor: 1 }, { weight: 0 }), part('pt_fiber0', 'fiber', {}, { weight: 0 }),
  part('pt_plate', 'plate', { armor: 2 }, { weight: 3 }), part('pt_plate_ugly', 'plate', { armor: 1 }, { drawback: { style: -1 }, weight: 1 }),
  part('pt_skin_maid', 'skin', { style: 3, exposure: 1 }, { style_tag: 'maid', weight: 0 }),
  part('pt_skin_idol', 'skin', { style: 2, exposure: 3 }, { style_tag: 'idol', weight: 0 }),
  part('pt_skin_plain', 'skin', {}, { weight: 0 }),
]
const QUIRKS = [
  { id: 'q_loose', name: '鬆動的準星', desc: '準星有點鬆。', kind: 'flaw', stats: { hit: -1 } },
  { id: 'q_thin', name: '纖維偏薄', desc: '織得不夠密。', kind: 'flaw', stats: { armor: -1 } },
]
const ITEMS = [
  { id: 'it_dye', name: '染料', desc: '一份染料。', category: 'consumable', grade: 1, size: 0, legal: 'free', tags: ['dye'], weight: 0 },
  { id: 'it_ring', name: '戒指', desc: '一枚戒指。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['acc:any'], weight: 0 },
  { id: 'it_choker', name: '項圈', desc: '一條項圈。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['acc:neck'], weight: 1, style: street() },
]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    skill: structuredClone(SKILLS), weapon_class: structuredClone(WEAPONS), special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [{ id: 'fac_paint', name: '烤漆店', dye: true }, { id: 'fac_shop', name: '雜貨店' }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_paint', name: '烤漆店' }, F2: { type: 'fac_shop', name: '雜貨店' } } }],
    blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS), quirk: structuredClone(QUIRKS), item: structuredClone(ITEMS),
  }
  patch(c)
  return { id: 'gear_m4_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：條件 at_home（旗標 home 在就是在家）。 */
const HOME: Feature = {
  id: 'gear_home_stub',
  install(k) {
    k.conditions.register<Condition>({ kind: 'at_home', owner: 'gear_home_stub', validate: () => [], test: (_c, { state }) => state.flags.home === true })
  },
}

/** 一件組好的成品。uid 是背包裡這一件的編號。 */
const made = (uid: string, blueprint: string, parts: Rec = {}, more: Rec = {}): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts, ...more } })
const CLOTH = { fiber: 'pt_fiber0' }
const INVENTORY = (): ItemStack[] => [
  made('p1', 'bp_pistol', { barrel: 'pt_barrel', action: 'pt_action' }),
  made('p2', 'bp_pistol', { barrel: 'pt_barrel', action: 'pt_action' }, { quirks: ['q_loose'] }),
  made('p3', 'bp_pistol', { barrel: 'pt_barrel', action: 'pt_action' }, { quality: 'fine', bonus: { hit: 2, damage: 1 } }),
  made('cap', 'bp_cap', CLOTH), made('shirt', 'bp_shirt', CLOTH), made('shirt0', 'bp_shirt0', CLOTH), made('tee1', 'bp_tee1', CLOTH), made('pants', 'bp_pants', CLOTH),
  made('boots', 'bp_boots', CLOTH), made('punk', 'bp_boots_punk', CLOTH), made('jacket', 'bp_jacket', CLOTH), made('long', 'bp_longcoat', CLOTH),
  made('bra', 'bp_bra', CLOTH), made('briefs', 'bp_briefs', CLOTH),
  made('maid', 'bp_dress', { fiber: 'pt_fiber0', skin: 'pt_skin_maid' }), made('idol', 'bp_dress', { fiber: 'pt_fiber0', skin: 'pt_skin_idol' }),
  made('maid_ugly', 'bp_dress', { fiber: 'pt_fiber0', skin: 'pt_skin_maid', plate: 'pt_plate_ugly' }), made('bare', 'bp_dress', { fiber: 'pt_fiber0', skin: 'pt_skin_plain' }),
  made('vest', 'bp_vest', { fiber: 'pt_fiber', plate: 'pt_plate' }), made('vest_thin', 'bp_vest', { fiber: 'pt_fiber', plate: 'pt_plate' }, { quirks: ['q_thin'] }),
  made('heavy', 'bp_heavy', { fiber: 'pt_fiber', plate: 'pt_plate' }), made('tinted', 'bp_dyed_default', CLOTH),
  { id: 'it_dye', qty: 3 }, { id: 'it_ring', qty: 1 }, { id: 'it_choker', qty: 1 },
]

interface Opts {
  pack?: ContentPack
  pc?: Rec
  money?: { cred: number; cash: number }
  home?: boolean
}
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: [characterFeature, worldFeature, HOME, gearFeature], content: [o.pack ?? pack()], seed: 7,
    pc: { attrs: { body: 10, reflex: 12 }, skills: { firearms: 2 }, ...(o.pc ?? {}) },
    patch: { inventory: INVENTORY(), time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 1000, cash: 500 } },
  })
  if (o.home) game.state.flags.home = true
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const wear = (g: G, ...uids: string[]) => { for (const uid of uids) g.commit(equip(g.k, g.state, 'pc', uid)) }
const off = (g: G, uid: string) => g.commit(unequip(g.k, g.state, 'pc', uid))
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const stat = (g: G, id: string) => g.k.stats.stat(g.state, 'pc', id)
const look = (g: G) => styleOf(g.k, g.state, 'pc')
const seenIds = (g: G) => look(g).seen.map((p) => p.id)
const now = (g: G) => toMinutes(g.state.time)
const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const dye = (g: G, o: Rec) => dyeDraft(g.k, g.state, { uid: 'shirt', by: 'shop', ...o } as never)
/** 戰鬥的修正（現實或內海的戰場）。 */
const mod = (g: G, kind: string, layer = 'meat') => g.k.battle.modifiers({ kind: kind as never, unit: { actor: 'pc', tags: [] } as never, tags: [], view: { mode: { layer }, k: g.k, state: g.state } as never }).reduce((n, p) => n + p.value, 0)

// ---- 品質與瑕疵進數字 ----

describe('武器與護甲的數字吃得到瑕疵、代價與精工（productOf 的 stats）', () => {
  it('帶 quirk（hit −1）的槍命中少 1；精工的 bonus 加進去；沒有這些的和以前一樣', () => {
    const g = make()
    const plain = weaponOf(g.k, g.state, 'pc', 'p1')
    const flawed = weaponOf(g.k, g.state, 'pc', 'p2')
    const fine = weaponOf(g.k, g.state, 'pc', 'p3')
    expect(flawed.hit).toBe(plain.hit - 1)
    expect(fine.hit).toBe(plain.hit + 2)
    expect(flawed.flat).toBe(plain.flat)
    expect(fine.flat).toBe(plain.flat + 1)
  })

  it('護甲：帶著的怪癖（armor −1）讓那一件少 1；全身的護甲照舊取最高的一件', () => {
    const g = make()
    wear(g, 'vest')
    expect(armorOf(g.k, g.state, 'pc')).toBe(1 + 1 + 2)
    off(g, 'vest')
    wear(g, 'vest_thin')
    expect(armorOf(g.k, g.state, 'pc')).toBe(1 + 1 + 2 - 1)
  })
})

// ---- 看得到的那幾件、曝露度 ----

describe('外套敞開與扣上（EQUIPMENT 第 5 節）', () => {
  it('看得到的：頭、外套、上身、下身、鞋、頸飾、主武器之外的副武器藏得住就看不到；內衣與通用飾品不算', () => {
    const g = make()
    wear(g, 'cap', 'shirt', 'pants', 'boots', 'jacket', 'bra', 'briefs', 'p1')
    g.commit(equip(g.k, g.state, 'pc', 'it_ring'))
    g.commit(equip(g.k, g.state, 'pc', 'it_choker'))
    const l = look(g)
    expect(l.seen.map((p) => [p.slot, p.id])).toEqual([
      ['head', 'cap'], ['upper', 'shirt'], ['lower', 'pants'], ['outer', 'jacket'], ['shoes', 'boots'], ['neck', 'it_choker'],
    ])
    // 短外套敞開藏匿量減半成 1：手槍（大小 1）剛好藏得住，所以不算看得到
    expect(l.seen.some((p) => p.kind === 'weapon')).toBe(false)
  })

  it('外套扣上：看得到的少了上身；曝露度從 2 變 0；短外套蓋不到下身', () => {
    const g = make()
    wear(g, 'shirt', 'pants', 'jacket', 'bra', 'briefs')
    expect(seenIds(g)).toContain('shirt')
    expect(stat(g, 'exposure')).toBe(2)
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(seenIds(g)).not.toContain('shirt')
    expect(seenIds(g)).toEqual(expect.arrayContaining(['pants', 'jacket']))
    expect(stat(g, 'exposure')).toBe(0)
    expect(look(g).exposure).toBe(0)
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'open' }]))
    expect(stat(g, 'exposure')).toBe(2)
  })

  it('扣上的短外套：下身自己的曝露度照算；長外套扣上全身最多 1，而且連下身也看不到', () => {
    const g = make({ pack: pack((c) => c.blueprint!.push(garment('bp_shorts', ['lower'], { style: street(), exposure: 3 }))) })
    g.state.inventory.push(made('shorts', 'bp_shorts', CLOTH))
    wear(g, 'shirt', 'shorts', 'jacket')
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(stat(g, 'exposure')).toBe(3)
    off(g, 'jacket')
    wear(g, 'long')
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'open' }]))
    expect(stat(g, 'exposure')).toBe(3) // 敞開
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(stat(g, 'exposure')).toBe(1)
    expect(seenIds(g)).toEqual(['long'])
    // 底下本來就不到 1 的不會被拉高
    off(g, 'shorts')
    wear(g, 'pants')
    expect(stat(g, 'exposure')).toBe(0)
  })

  it('coveredSlots：外套扣上才有被蓋住的穿著格（上身、護甲；長外套再加下身）；敞開或沒穿外套是空的（M4 收尾修正批；畫面不自己列哪幾格）', () => {
    const g = make()
    const covered = () => [...coveredSlots(g.k, g.state, 'pc')].sort()
    wear(g, 'shirt', 'pants', 'jacket', 'vest')
    expect(covered()).toEqual([])
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(covered()).toEqual(['armor', 'upper'])
    off(g, 'jacket')
    expect(covered()).toEqual([])
    wear(g, 'long')
    expect(covered()).toEqual(['armor', 'lower', 'upper'])
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'open' }]))
    expect(covered()).toEqual([])
    // styleOf 看得到的格就是沒被蓋住的格：兩邊同一份算法
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(seenIds(g)).toEqual(['long'])
  })

  it('扣上或敞開的設定記在身上，換了外套之後還在；沒穿外套時扣上沒有作用', () => {
    const g = make()
    wear(g, 'shirt', 'pants', 'bra', 'briefs')
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(stat(g, 'exposure')).toBe(2)
    expect(seenIds(g)).toContain('shirt')
  })
})

describe('曝露度（照 ElondiaRPG 的 exposureLevel：上身、下身、內衣、真空）', () => {
  it('什麼都沒穿是 3；只穿內衣（曝露度 0）至少算 2；上身與下身有穿就看那一件，取兩側的最大值', () => {
    const g = make()
    expect(stat(g, 'exposure')).toBe(3)
    wear(g, 'bra', 'briefs')
    expect(stat(g, 'exposure')).toBe(DEFAULT_GEAR_RULES.underwear_visible)
    wear(g, 'shirt0', 'pants')
    expect(stat(g, 'exposure')).toBe(0)
    off(g, 'shirt0')
    wear(g, 'shirt')
    expect(stat(g, 'exposure')).toBe(2)
  })

  it('只穿上身沒穿下身：下身看內褲，沒有內褲就是全裸（3）', () => {
    const g = make()
    wear(g, 'shirt0')
    expect(stat(g, 'exposure')).toBe(3)
    wear(g, 'briefs')
    expect(stat(g, 'exposure')).toBe(2)
  })

  it('連身類佔著上身與下身，一件就遮住兩側', () => {
    const g = make()
    wear(g, 'maid', 'bra', 'briefs')
    expect(gearOf(g.state, 'pc').worn).toMatchObject({ upper: 'maid', lower: 'maid' })
    expect(stat(g, 'exposure')).toBe(1)
    // 沒穿內衣內褲：外皮的曝露度 1 ＋ 真空 1
    off(g, 'bra')
    expect(stat(g, 'exposure')).toBe(2)
  })

  it('真空：外面那件曝露度 ≥ 1 而且那一側底下沒穿內衣（內褲），多 1；有穿就不加；曝露度 0 的不會走光', () => {
    const g = make()
    wear(g, 'tee1', 'pants', 'briefs')
    // 上身曝露度 1、沒穿內衣：真空 +1 ＝ 2
    expect(stat(g, 'exposure')).toBe(2)
    wear(g, 'bra')
    expect(stat(g, 'exposure')).toBe(1)
    off(g, 'tee1')
    wear(g, 'shirt0')
    off(g, 'bra')
    expect(stat(g, 'exposure')).toBe(0)
  })

  it('曝露度最多 3：曝露度 3 的外皮再真空也是 3', () => {
    const g = make()
    wear(g, 'idol')
    expect(stat(g, 'exposure')).toBe(3)
  })

  it('條件 exposure { min?, max? } 看有效值', () => {
    const g = make()
    wear(g, 'shirt', 'pants', 'bra', 'briefs')
    expect(test(g, { kind: 'exposure', min: 2 })).toBe(true)
    expect(test(g, { kind: 'exposure', min: 3 })).toBe(false)
    expect(test(g, { kind: 'exposure', max: 1 })).toBe(false)
    expect(test(g, { kind: 'exposure', min: 1, max: 2 })).toBe(true)
    expect(g.k.conditions.validate({ kind: 'exposure' } as never, 'c')).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'exposure', min: 4 } as never, 'c')).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'exposure', min: 2, max: 1 } as never, 'c')).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'exposure', max: 0 } as never, 'c')).toEqual([])
  })
})

// ---- 外皮與風格 ----

describe('風格：看得到的每一件的標籤與值', () => {
  it('四件同一個風格：unified 是 true、style_value 多 2；條件 style 成立，換掉一件之後不成立', () => {
    const g = make()
    wear(g, 'cap', 'shirt', 'pants', 'boots')
    let l = look(g)
    expect(l.tags).toEqual([['street', 4]])
    expect(l.main).toBe('street')
    expect(l.unified).toBe(true)
    expect(stat(g, 'style_value')).toBe(4 + DEFAULT_GEAR_RULES.unified_bonus)
    expect(test(g, { kind: 'style', tag: 'street', min: 4 })).toBe(true)
    expect(test(g, { kind: 'style', tag: 'street' })).toBe(true)
    expect(test(g, { kind: 'style', tag: 'punk' })).toBe(false)
    off(g, 'boots')
    wear(g, 'punk')
    l = look(g)
    expect(l.tags).toEqual([['street', 3], ['punk', 1]])
    expect(l.unified).toBe(false)
    expect(stat(g, 'style_value')).toBe(4)
    expect(test(g, { kind: 'style', tag: 'street', min: 4 })).toBe(false)
    expect(test(g, { kind: 'style', tag: 'street', min: 3 })).toBe(true)
  })

  it('三件同風格不夠（要四件以上）；外套扣上之後底下穿什麼都不算', () => {
    const g = make()
    wear(g, 'cap', 'shirt', 'boots')
    expect(look(g).unified).toBe(false)
    wear(g, 'pants', 'jacket')
    expect(look(g).unified).toBe(true)
    expect(look(g).tags).toEqual([['street', 5]])
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(look(g).tags).toEqual([['street', 4]])
    expect(look(g).seen.map((p) => p.id)).not.toContain('shirt')
  })

  it('from_skin：風格的標籤與曝露度讀裝著的外皮，換一塊外皮就換風格；板材的代價（風格 −1）算進去', () => {
    const g = make()
    wear(g, 'bra', 'briefs', 'maid')
    expect(look(g).tags).toEqual([['maid', 3]])
    expect(look(g).main).toBe('maid')
    expect(stat(g, 'exposure')).toBe(1)
    off(g, 'maid')
    wear(g, 'idol')
    expect(look(g).tags).toEqual([['idol', 2]])
    expect(stat(g, 'exposure')).toBe(3)
    off(g, 'idol')
    wear(g, 'maid_ugly')
    expect(look(g).tags).toEqual([['maid', 2]])
  })

  it('外皮沒有風格標籤：這一件沒有風格，只有代價時風格值照算（最少 0）', () => {
    const g = make()
    wear(g, 'bare')
    expect(look(g).tags).toEqual([])
    expect(look(g).main).toBeNull()
    expect(stat(g, 'style_value')).toBe(0)
  })

  it('飾品的風格（頸）也算；看得到的武器算進威脅感（護甲值大於 0 的護甲也算）', () => {
    const g = make()
    g.commit(equip(g.k, g.state, 'pc', 'it_choker'))
    expect(look(g).tags).toEqual([['street', 1]])
    expect(look(g).threat).toBe(0)
    wear(g, 'vest')
    expect(look(g).threat).toBe(1)
    wear(g, 'p1')
    // 沒穿外套：藏匿量 1，手槍藏得住
    expect(look(g).threat).toBe(1)
    wear(g, 'cap')
    expect(look(g).threat).toBe(1)
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(look(g).threat).toBe(1)
    wear(g, 'jacket')
    g.commit(draft([{ op: 'gear.coat', id: 'pc', coat: 'closed' }]))
    expect(look(g).threat).toBe(0) // 護甲被外套蓋住，手槍藏在外套裡
  })

  it('條件 style 的格式', () => {
    const g = make()
    expect(g.k.conditions.validate({ kind: 'style' } as never, 'c')).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'style', tag: 'maid', min: 0 } as never, 'c')).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'style', tag: 'maid', min: 2 } as never, 'c')).toEqual([])
  })

  it('設計圖與零件的新欄位格式不對會擋下（style、exposure、long、style_tag、設施的 dye）', () => {
    expect(() => make({ pack: pack((c) => { c.blueprint![1]!.style = { tag: 'x' } }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.blueprint![2]!.exposure = 5 }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.blueprint![3]!.long = 'yes' }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.part![6]!.style_tag = 3 }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.facility_type![0]!.dye = 'yes' }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.blueprint![1]!.primary_color = 'pink' }) })).toThrow(ContentError)
  })
})

// ---- 重量 ----

describe('重量（EQUIPMENT 第 7 節）', () => {
  it('carry_load 是穿的、帶的、飾品與快取格的重量合計；carry_cap 是 6 加體格（暫定）', () => {
    const g = make()
    expect(stat(g, 'carry_load')).toBe(0)
    expect(stat(g, 'carry_cap')).toBe(16)
    wear(g, 'shirt', 'p1', 'vest')
    // 上衣 1 ＋ 手槍 1（纖維 0、槍管與機構各 1 ＝ 3）＋ 背心 2 ＋ 纖維 0 ＋ 板材 3
    expect(carryLoadOf(g.k, g.state, 'pc')).toBe(1 + (1 + 2) + (2 + 3))
    expect(stat(g, 'carry_load')).toBe(9)
    g.commit(equip(g.k, g.state, 'pc', 'it_choker'))
    expect(stat(g, 'carry_load')).toBe(10)
    expect(carryCapBase(g.k, g.state, 'pc')).toBe(16)
  })

  it('沒超重：沒有任何懲罰', () => {
    const g = make()
    wear(g, 'shirt', 'vest')
    expect(overweight(g.k, g.state, 'pc')).toBe(false)
    expect(mod(g, 'evade')).toBe(0)
    expect(mod(g, 'move_ap')).toBe(0)
    expect(g.k.passives.of(g.state, 'pc').filter((e) => e.source === 'gear')).toEqual([])
  })

  it('超重：迴避 −2、換位多 1 點、帶 stealth 標籤的檢定 −2（來源 gear）；只在現實的戰場；脫掉重甲之後回來', () => {
    const g = make()
    wear(g, 'shirt', 'pants', 'heavy', 'p1')
    // 1 ＋ 1 ＋（12 ＋ 3）＋ 3 ＝ 20 > 16
    expect(stat(g, 'carry_load')).toBe(20)
    expect(overweight(g.k, g.state, 'pc')).toBe(true)
    expect(mod(g, 'evade')).toBe(-2)
    expect(mod(g, 'move_ap')).toBe(1)
    expect(mod(g, 'evade', 'net')).toBe(0)
    expect(mod(g, 'move_ap', 'net')).toBe(0)
    expect(mod(g, 'ap_regen')).toBe(0)
    const parts = g.k.passives.checkParts(g.state, 'pc', { skill: 'stealth', tags: ['stealth'] })
    expect(parts).toEqual([{ label: '超重', value: -2, source: 'gear' }])
    expect(g.k.passives.checkParts(g.state, 'pc', { skill: 'firearms', tags: [] })).toEqual([])
    expect(g.k.passives.modParts(g.state, 'pc', 'evade', { layer: 'meat' })[0]).toMatchObject({ source: 'gear', label: '超重' })
    off(g, 'heavy')
    expect(overweight(g.k, g.state, 'pc')).toBe(false)
    expect(mod(g, 'evade')).toBe(0)
    expect(mod(g, 'move_ap')).toBe(0)
    expect(g.k.passives.checkParts(g.state, 'pc', { skill: 'stealth', tags: ['stealth'] })).toEqual([])
  })

  it('剛好等於上限不算超重；體格高的人負重高；別人經衍生數值加上限', () => {
    const g = make({ pack: pack((c) => c.blueprint!.push(bp('bp_brick', 'armor', { armor: 0, covers: ['hands'], weight_class: 'light', weight: 16, require: [] }))) })
    g.state.inventory.push(made('brick', 'bp_brick'))
    wear(g, 'brick')
    expect(stat(g, 'carry_load')).toBe(16)
    expect(overweight(g.k, g.state, 'pc')).toBe(false)
    wear(g, 'cap')
    expect(stat(g, 'carry_load')).toBe(17)
    expect(overweight(g.k, g.state, 'pc')).toBe(true)
    g.state.actors.pc!.attrs.body = 12
    expect(stat(g, 'carry_cap')).toBe(18)
    expect(overweight(g.k, g.state, 'pc')).toBe(false)
    g.state.actors.pc!.attrs.body = 10
    expect(overweight(g.k, g.state, 'pc')).toBe(true)
    g.k.stats.addStatProvider('carry_cap', 'test', () => [{ label: '致動器', value: 4, source: 'cyber' }])
    expect(stat(g, 'carry_cap')).toBe(20)
    expect(overweight(g.k, g.state, 'pc')).toBe(false)
  })

  it('規則表 gear_rule 蓋掉預設（負重、懲罰），格式不對的欄位忽略', () => {
    const g = make({ pack: pack((c) => { c.gear_rule = [{ id: 'default', carry_base: 0, over_evade: -5, over_move_ap: 2 }] }) })
    expect(gearRules(g.k)).toMatchObject({ carry_base: 0, over_evade: -5, over_move_ap: 2, carry_per_body: 1 })
    wear(g, 'shirt', 'p1')
    // 重量 4 ＞ 上限 0 ＋ 10
    expect(overweight(g.k, g.state, 'pc')).toBe(false)
    wear(g, 'heavy')
    expect(mod(g, 'evade')).toBe(-5)
    expect(mod(g, 'move_ap')).toBe(2)
    expect(() => make({ pack: pack((c) => { c.gear_rule = [{ id: 'default', over_evade: 3 }] }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.gear_rule = [{ id: 'default', dye_shop_price: 1.5 }] }) })).toThrow(ContentError)
  })

  it('沒穿過東西的人（沒有 ext.gear）不會被算超重，也不拖慢別的數字', () => {
    const g = make()
    expect(stat(g, 'carry_load')).toBe(0)
    expect(g.k.passives.of(g.state, 'pc')).toEqual([])
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'body')).toBe(10)
  })
})

// ---- 染色 ----

describe('染色（EQUIPMENT 第 9 節；DATA 7.7 節）', () => {
  it('店家染兩個顏色扣 40、時間 +10 分鐘；顏色記在那一件身上，穿著與脫下都跟著', async () => {
    const g = make()
    stand(g, 'F1')
    wear(g, 'shirt')
    const t0 = now(g)
    expect(dyeBlock(g.k, g.state, { uid: 'shirt', by: 'shop', primary_color: 'dye_pink', secondary_color: '#1A1520' })).toBeNull()
    const { violations } = await observed(g, () => g.commit(dye(g, { primary_color: 'dye_pink', secondary_color: '#1A1520' })))
    expect(violations).toEqual([])
    expect(g.state.money.cash).toBe(500 - 40)
    expect(now(g) - t0).toBe(10)
    expect(stackOf(g.state, 'shirt')!.data!.dye).toEqual({ primary_color: 'dye_pink', secondary_color: '#1A1520' })
    expect(dyeOf(g.k, g.state, 'shirt')).toEqual({ primary_color: 'dye_pink', secondary_color: '#1A1520' })
    expect(g.state.reports.at(-1)).toMatchObject({ action: 'gear.dye', actor: 'pc' })
    expect(g.state.reports.at(-1)!.narration?.results?.join('')).not.toMatch(/dye_|#/)
    off(g, 'shirt')
    expect(dyeOf(g.k, g.state, 'shirt')!.primary_color).toBe('dye_pink')
    // 純外觀：風格與曝露度不變
    wear(g, 'shirt')
    expect(stat(g, 'exposure')).toBe(3)
    expect(look(g).tags).toEqual([['street', 1]])
  })

  it('只改一個顏色扣 20；改成現在就是的顏色不算（也不收錢）；全都沒變被擋', () => {
    const g = make()
    stand(g, 'F1')
    g.commit(dye(g, { primary_color: 'dye_black' }))
    expect(g.state.money.cash).toBe(480)
    expect(reasonOf(() => dye(g, { primary_color: 'dye_black' }))).toContain('已經是那個顏色')
    g.commit(dye(g, { primary_color: 'dye_black', secondary_color: 'dye_olive' }))
    expect(g.state.money.cash).toBe(460)
  })

  it('不在有 dye 的設施被擋並有原因（雜貨店、街上都不行）', () => {
    const g = make()
    expect(reasonOf(() => dye(g, { primary_color: 'dye_pink' }))).toContain('烤漆與染色')
    stand(g, 'F2')
    expect(dyeBlock(g.k, g.state, { uid: 'shirt', by: 'shop', primary_color: 'dye_pink' })).toContain('烤漆與染色')
    expect(g.state.money.cash).toBe(500)
  })

  it('亂寫的顏色被擋：不是 dye_ 開頭、#RRGGBB 少一位、十六進位以外、空字串', () => {
    const g = make()
    stand(g, 'F1')
    for (const bad of ['pink', '#12345', '#GGGGGG', '', 'dye_', 'DYE_PINK', 'dye_pink;x', '#1234567']) {
      expect(reasonOf(() => dye(g, { primary_color: bad }))).toContain('主色調的顏色不對')
    }
    expect(reasonOf(() => dye(g, { secondary_color: 'red' }))).toContain('副色調的顏色不對')
    expect(g.state.money.cash).toBe(500)
    expect(g.state.inventory.find((s) => s.data?.uid === 'shirt')!.data!.dye).toBeUndefined()
  })

  it('現金不夠被擋；不是武器衣服護甲、沒有這一件、沒有實例資料的飾品都擋並有原因', () => {
    const g = make({ money: { cred: 1000, cash: 30 } })
    stand(g, 'F1')
    expect(reasonOf(() => dye(g, { primary_color: 'dye_pink', secondary_color: 'dye_black' }))).toContain('現金不夠')
    g.commit(dye(g, { primary_color: 'dye_pink' }))
    expect(g.state.money.cash).toBe(10)
    expect(reasonOf(() => dye(g, { uid: 'nope', primary_color: 'dye_pink' }))).toBe('背包裡沒有這一件。')
    expect(reasonOf(() => dye(g, { uid: 'it_ring', primary_color: 'dye_pink' }))).toContain('現成的單件')
    expect(reasonOf(() => dye(g, { uid: 'it_dye', primary_color: 'dye_pink' }))).toContain('現成的單件')
  })

  it('自己染：要在住處、每個顏色用掉一份帶 dye 標籤的物品、10 分鐘、不收錢；染料不夠被擋', () => {
    const g = make()
    expect(reasonOf(() => dye(g, { by: 'self', primary_color: 'dye_pink' }))).toContain('住處')
    g.state.flags.home = true
    const t0 = now(g)
    g.commit(dye(g, { by: 'self', primary_color: 'dye_pink', secondary_color: 'dye_black' }))
    expect(now(g) - t0).toBe(10)
    expect(g.state.money.cash).toBe(500)
    expect(g.state.inventory.find((s) => s.id === 'it_dye')!.qty).toBe(1)
    expect(reasonOf(() => dye(g, { by: 'self', primary_color: 'dye_olive', secondary_color: 'dye_white' }))).toContain('染料不夠')
    g.commit(dye(g, { by: 'self', primary_color: 'dye_olive' }))
    expect(g.state.inventory.some((s) => s.id === 'it_dye')).toBe(false)
  })

  it('換回預設（給 null）不要錢、不花時間、哪裡都行；預設的顏色讀設計圖的目錄顏色', () => {
    const g = make()
    expect(dyeOf(g.k, g.state, 'tinted')).toEqual({ primary_color: 'dye_pink', secondary_color: '#101010' })
    stand(g, 'F1')
    g.commit(dye(g, { uid: 'tinted', primary_color: 'dye_black', secondary_color: 'dye_olive' }))
    expect(dyeOf(g.k, g.state, 'tinted')).toEqual({ primary_color: 'dye_black', secondary_color: 'dye_olive' })
    expect(g.state.money.cash).toBe(460)
    stand(g, 'F2')
    const t0 = now(g)
    g.commit(dye(g, { uid: 'tinted', primary_color: null, secondary_color: null, by: 'shop' }))
    expect(now(g)).toBe(t0)
    expect(g.state.money.cash).toBe(460)
    expect(dyeOf(g.k, g.state, 'tinted')).toEqual({ primary_color: 'dye_pink', secondary_color: '#101010' })
    expect(stackOf(g.state, 'tinted')!.data!.dye).toBeUndefined()
    expect(reasonOf(() => dye(g, { uid: 'tinted', primary_color: null }))).toContain('沒有變')
  })

  it('一個換回預設、一個染新色：只收新色的錢', () => {
    const g = make()
    stand(g, 'F1')
    g.commit(dye(g, { primary_color: 'dye_black', secondary_color: 'dye_olive' }))
    expect(g.state.money.cash).toBe(460)
    g.commit(dye(g, { primary_color: null, secondary_color: 'dye_white' }))
    expect(g.state.money.cash).toBe(440)
    expect(dyeOf(g.k, g.state, 'shirt')).toEqual({ secondary_color: 'dye_white' })
  })

  it('規則表蓋掉店家的價錢與時間', () => {
    const g = make({ pack: pack((c) => { c.gear_rule = [{ id: 'default', dye_shop_price: 5, dye_shop_minutes: 30 }] }) })
    stand(g, 'F1')
    const t0 = now(g)
    g.commit(dye(g, { primary_color: 'dye_pink', secondary_color: 'dye_black' }))
    expect(g.state.money.cash).toBe(490)
    expect(now(g) - t0).toBe(30)
  })

  it('染過的那一件存檔再讀，顏色還在', () => {
    const g = make()
    stand(g, 'F1')
    wear(g, 'shirt')
    g.commit(dye(g, { primary_color: 'dye_pink', secondary_color: '#1A1520' }))
    const text = g.save()
    g.commit(dye(g, { primary_color: 'dye_black' }))
    expect(dyeOf(g.k, g.state, 'shirt')!.primary_color).toBe('dye_black')
    expect(g.load(text)).toBeNull()
    expect(dyeOf(g.k, g.state, 'shirt')).toEqual({ primary_color: 'dye_pink', secondary_color: '#1A1520' })
    expect(gearOf(g.state, 'pc').worn.upper).toBe('shirt')
  })

  it('變更 gear.dye 的格式：沒有這一件、亂寫的欄位與顏色都擋', () => {
    const g = make()
    expect(() => g.commit(draft([{ op: 'gear.dye', uid: 'nope', dye: { primary_color: 'dye_pink' } }]))).toThrow()
    expect(() => g.commit(draft([{ op: 'gear.dye', uid: 'shirt', dye: { primary_color: 'pink' } }]))).toThrow()
    expect(() => g.commit(draft([{ op: 'gear.dye', uid: 'shirt', dye: { tertiary: 'dye_pink' } }]))).toThrow()
    expect(() => g.commit(draft([{ op: 'gear.dye', uid: 'shirt', dye: {} }]))).toThrow()
  })
})

// ---- 拿走裝備 ----

describe('gear_take 與 defeat.gear', () => {
  const take = (g: G, effect: Rec, source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve([effect], effectCtx(g.k, g.state, { source }))
  const hooked = (g: G, effect: Rec): boolean => (g.k.hooks as unknown as { run: (n: string, p: unknown) => Array<{ result: unknown }> }).run('defeat.gear', { effect }).some((r) => r.result === true)

  it('拿走穿著的那一件：身上的格清掉、背包也沒有了；連身類佔的每一格都清掉', () => {
    const g = make()
    wear(g, 'maid', 'cap', 'boots')
    const r = take(g, { kind: 'gear_take', group: 'worn', slot: 'upper' })
    expect(r.errors).toEqual([])
    expect(r.lines).toEqual(['被拿走：bp_dress'])
    g.commit(draft(r.changes, 'test.take'))
    expect(gearOf(g.state, 'pc').worn).toEqual({ head: 'cap', shoes: 'boots' })
    expect(stackOf(g.state, 'maid')).toBeUndefined()
    expect(stackOf(g.state, 'cap')).toBeDefined()
  })

  it('用 uid 拿走、拿走攜帶的武器、拿走戴著的飾品（一格一個）', () => {
    const g = make()
    wear(g, 'p1', 'cap')
    g.commit(equip(g.k, g.state, 'pc', 'it_choker'))
    g.commit(equip(g.k, g.state, 'pc', 'it_ring'))
    g.commit(draft(take(g, { kind: 'gear_take', uid: 'p1' }).changes))
    expect(gearOf(g.state, 'pc').carry).toEqual({})
    expect(stackOf(g.state, 'p1')).toBeUndefined()
    g.commit(draft(take(g, { kind: 'gear_take', group: 'acc', slot: 'neck' }).changes))
    expect(gearOf(g.state, 'pc').acc.neck).toBeUndefined()
    expect(g.state.inventory.some((s) => s.id === 'it_choker')).toBe(false)
    expect(gearOf(g.state, 'pc').acc.any1).toBe('it_ring')
    // 只寫 group：那一組全拿走
    g.commit(draft(take(g, { kind: 'gear_take', group: 'worn' }).changes))
    expect(gearOf(g.state, 'pc').worn).toEqual({})
    expect(g.state.inventory.some((s) => s.data?.uid === 'cap')).toBe(false)
    expect(g.state.inventory.some((s) => s.id === 'it_ring')).toBe(true)
  })

  it('拿走的東西影響快取格時一併收回；沒有符合的東西就什麼都不做（不算錯誤）', () => {
    const g = make({ pack: pack((c) => { c.blueprint!.push(garment('bp_pack', ['hands'], { quick: 2 })) }) })
    g.state.inventory.push(made('pack', 'bp_pack', CLOTH))
    wear(g, 'pack')
    g.commit(draft([{ op: 'gear.quick', id: 'pc', items: [{ item: 'it_dye', qty: 3 }] }]))
    expect(gearOf(g.state, 'pc').quick).toEqual([{ item: 'it_dye', qty: 3 }])
    g.commit(draft(take(g, { kind: 'gear_take', uid: 'pack' }).changes))
    expect(gearOf(g.state, 'pc').quick).toEqual([{ item: 'it_dye', qty: 2 }])
    expect(g.state.inventory.find((s) => s.id === 'it_dye')!.qty).toBe(3)
    const none = take(g, { kind: 'gear_take', group: 'worn', slot: 'head' })
    expect(none.errors).toEqual([])
    expect(none.changes).toEqual([])
    expect(none.lines).toEqual(['身上沒有可以被拿走的東西。'])
  })

  it('AI 與玩家要的這個效果被擋；格式不對的整批驗證不過；defeat.gear 對它回答 true、對別的效果不回答', () => {
    const g = make()
    wear(g, 'shirt')
    expect(take(g, { kind: 'gear_take', uid: 'shirt' }, 'ai').errors.length).toBeGreaterThan(0)
    expect(take(g, { kind: 'gear_take', uid: 'shirt' }, 'player').errors.length).toBeGreaterThan(0)
    expect(take(g, { kind: 'gear_take' }).errors.length).toBeGreaterThan(0)
    expect(take(g, { kind: 'gear_take', group: 'cloak' }).errors.length).toBeGreaterThan(0)
    expect(take(g, { kind: 'gear_take', group: 'worn', slot: 'neck' }).errors.length).toBeGreaterThan(0)
    expect(take(g, { kind: 'gear_take', uid: 3 }).errors.length).toBeGreaterThan(0)
    expect(hooked(g, { kind: 'gear_take', uid: 'shirt' })).toBe(true)
    expect(hooked(g, { kind: 'cash', amount: -5 })).toBe(false)
    expect(gearOf(g.state, 'pc').worn.upper).toBe('shirt')
  })
})

// ---- 其餘 ----

describe('沒有裝這個功能的東西時，M1 的行為不變', () => {
  it('舊的設計圖（沒有 style、exposure）也算得出曝露度與風格：沒寫就是 0、沒有標籤', () => {
    const g = make()
    wear(g, 'vest')
    expect(look(g).tags).toEqual([])
    expect(look(g).main).toBeNull()
    expect(look(g).unified).toBe(false)
    expect(look(g).seen.map((p) => p.id)).toEqual(['vest'])
    // 護甲穿在上身那一格沒人佔著時，當作上身那一層（曝露度 0）；下身沒穿是全裸
    expect(stat(g, 'exposure')).toBe(3)
  })
})
