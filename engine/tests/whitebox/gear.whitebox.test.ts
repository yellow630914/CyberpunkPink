// 白箱測試：features/gear（裝備：設計圖與零件的格式、身上四層的變更、穿脫、算出來的數字、帶進戰鬥）。
// 補主套件沒有走到的分支：內容格式的每一個欄位、三種變更的每一條擋下的原因、存檔裡壞掉的資料、穿脫的各條原因、武器與護甲的算式、
// 帶進戰鬥與戰鬥結束的細節。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, GameState, ItemStack } from '../../src'
import { createKernel } from '../../src'
import { armorOf, bodyArmorOf, concealment, equip, equipBlock, gearFeature, gearOf, quickCapacity, scanFinds, unequip, weaponOf } from '../../src/features/gear'
import { QUICK_MAX } from '../../src/features/gear'
import { emptyGear, fitQuick, gearFromRaw, partsOf, setSlot, stackOf, sumQty, wornPieces } from '../../src/features/gear/model'
import { characterFeature } from '../../src/features/character'
import { TEST_COMBAT, makeBattleGame, makeGame } from '../../src/testkit'
import { duel, foe, one, raw } from '../helpers/battle'

const SKILLS = ['firearms', 'brawl'].map((id) => ({ id, name: id, attr: id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'blade', name: '刀', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 1, traits: ['melee'], attr: 'body', skill: 'brawl' },
]
const bp = (id: string, kind: string, more: Record<string, unknown> = {}) => ({ id, kind, name: id, desc: `${id}。`, brand: 'b', grade: 1, legal: 'free', price: 0, size: 1, weight: 1, require: [], optional: [], ...more })
const part = (id: string, type: string, grade: number, stats: Record<string, number> = {}, more: Record<string, unknown> = {}) => ({ id, name: id, type, material: 'mech', brand: 'b', grade, price: 0, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new', ...more })
const item = (id: string, more: Record<string, unknown> = {}) => ({ id, name: id, desc: `${id}。`, category: 'accessory', grade: 1, size: 0, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'g',
  content: {
    skill: SKILLS, weapon_class: WEAPONS,
    blueprint: [
      bp('bp_pistol', 'weapon', { class: 'pistol', carry: 'side' }),
      bp('bp_rifle', 'weapon', { class: 'pistol', carry: 'main', size: 3 }),
      bp('bp_blade', 'weapon', { class: 'blade', carry: 'melee' }),
      bp('bp_vest', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', quick: 3 }),
      bp('bp_shirt', 'armor', { armor: 0, covers: ['upper'], weight_class: 'light' }),
      bp('bp_heavy', 'armor', { armor: 1, covers: ['armor'], weight_class: 'heavy' }),
      bp('bp_coat', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: 5 }),
      bp('bp_helmet', 'armor', { armor: 0, covers: ['head'], weight_class: 'light' }),
    ],
    part: [
      part('pt_fiber', 'fiber', 1, { armor: 2 }), part('pt_plate3', 'plate', 3, { armor: 3 }), part('pt_plate1', 'plate', 1, { armor: 1 }),
      part('pt_barrel', 'barrel', 4, { damage: 2, hit: 1, pierce: 1, range_far: 2, mag: 1 }), part('pt_barrel2', 'barrel', 2), part('pt_blade', 'blade', 5, { damage: 1 }),
    ],
    item: [
      item('it_ring', { tags: ['acc:any'] }), item('it_collar', { tags: ['acc:neck'] }), item('it_garter', { tags: ['acc:leg'] }),
      item('it_bag', { tags: ['belt'], quick: 2 }), item('it_stone', { category: 'consumable' }), item('it_gel', { category: 'consumable', use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 5 }] } }),
    ],
  },
}
const made = (uid: string, blueprint: string, parts: Record<string, unknown> = {}): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts } })
const INV = (): ItemStack[] => [
  made('p1', 'bp_pistol', { barrel: 'pt_barrel' }), made('r1', 'bp_rifle'), made('b1', 'bp_blade', { blade: 'pt_blade' }), made('v1', 'bp_vest', { fiber: 'pt_fiber', plate: ['pt_plate3', 'pt_plate1'] }),
  made('s1', 'bp_shirt'), made('hv', 'bp_heavy', { plate: 'pt_plate3' }), made('c1', 'bp_coat'), made('he', 'bp_helmet', { plate: 'pt_plate3' }),
  { id: 'it_ring', qty: 2 }, { id: 'it_collar', qty: 1 }, { id: 'it_garter', qty: 1 }, { id: 'it_bag', qty: 1 }, { id: 'it_gel', qty: 4 },
]
const setup = (inv: ItemStack[] = INV(), pc: Record<string, unknown> = { attrs: { reflex: 14, body: 12 }, skills: { firearms: 2, brawl: 1 } }) => makeGame({ features: [characterFeature, gearFeature, TEST_COMBAT], content: [PACK], pc, patch: { inventory: inv } }).game
type G = ReturnType<typeof setup>
const apply = (g: G, changes: Change[]) => g.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: 't' } })
const wear = (g: G, what: string, slot?: string) => g.commit(equip(g.k, g.state, 'pc', what, slot))
const problems = (kind: 'blueprint' | 'part', e: Record<string, unknown>): string => createKernel([gearFeature]).content.validate(kind, [e]).join('\n')
const edit = (kind: 'blueprint' | 'part', base: Record<string, unknown>, field: string, value: unknown): string => {
  const e = { ...base, [field]: value }
  if (value === undefined) delete e[field]
  return problems(kind, e)
}

describe('白箱 blueprint 的格式（DATA 7.1 節；EQUIPMENT 第 2、4、6 節）', () => {
  const W = bp('bp_x', 'weapon', { class: 'pistol', carry: 'side' })
  const A = bp('bp_y', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium' })

  it('合格的樣本收得進來', () => {
    expect(problems('blueprint', W)).toBe('')
    expect(problems('blueprint', A)).toBe('')
    expect(problems('blueprint', { ...A, conceal: 3, conceal_add: 2, quick: 1, optional: [{ type: 'plate', grade_min: 2 }] })).toBe('')
  })

  it.each([
    ['kind', 'toy', /kind 只能是 weapon、armor/],
    ['name', '', /要有 name/],
    ['desc', '', /要有 desc（完整的句子）/],
    ['brand', undefined, /要有 brand/],
    ['grade', 0, /grade 要是 1～5/],
    ['grade', 2.5, /grade 要是 1～5/],
    ['legal', 'sometimes', /legal 只能是/],
    ['price', -1, /price 要是 0 以上的整數/],
    ['price', 1.5, /price 要是 0 以上的整數/],
    ['size', 5, /size 要是 0～4/],
    ['weight', -1, /weight 要是 0 以上的數字/],
    ['require', 'x', /require 要是 \{ type \} 的陣列/],
    ['require', [{}], /require\[0\] 要有 type/],
    ['require', [{ type: 'plate', grade_min: 6 }], /require\[0\]\.grade_min 要是 1～5/],
    ['optional', 3, /optional 要是 \{ type \} 的陣列/],
  ] as const)('設計圖 %s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('blueprint', W, field, value as unknown)).toMatch(re)
  })

  it('武器：沒有 class、carry 不對；護甲：基礎護甲只能 0 或 1、covers 不能空或重複或不是穿著格、重量級、藏匿量與快取格要是非負整數', () => {
    expect(edit('blueprint', W, 'class', undefined)).toMatch(/武器要寫 class/)
    expect(edit('blueprint', W, 'carry', 'back')).toMatch(/carry 只能是 main、side、melee/)
    expect(edit('blueprint', A, 'armor', 2)).toMatch(/armor（設計圖的基礎護甲）要是 0 或 1/)
    expect(edit('blueprint', A, 'covers', [])).toMatch(/covers 要是至少一個、不重複的穿著格/)
    expect(edit('blueprint', A, 'covers', ['armor', 'armor'])).toMatch(/covers 要是至少一個、不重複的穿著格/)
    expect(edit('blueprint', A, 'covers', ['tail'])).toMatch(/covers 要是至少一個、不重複的穿著格/)
    expect(edit('blueprint', A, 'covers', 'armor')).toMatch(/covers 要是至少一個、不重複的穿著格/)
    expect(edit('blueprint', A, 'weight_class', 'tiny')).toMatch(/weight_class 只能是 light、medium、heavy/)
    expect(edit('blueprint', A, 'conceal', -1)).toMatch(/conceal（藏匿量）要是 0 以上的整數/)
    expect(edit('blueprint', A, 'conceal_add', 1.5)).toMatch(/conceal_add（內藏槽加的藏匿量）要是 0 以上的整數/)
    expect(edit('blueprint', A, 'quick', -1)).toMatch(/quick（多給的快取格）要是 0 以上的整數/)
    // 武器不檢查護甲的欄位
    expect(problems('blueprint', { ...W, covers: [], armor: 9 })).toBe('')
  })

  it('refs：武器引用的 weapon_class；護甲不引用', () => {
    const k = createKernel([gearFeature])
    k.content.load('blueprint', [{ ...W, class: 'ghost' }, A])
    expect(k.content.checkRefs()).toEqual(['blueprint/bp_x：引用了不存在的 weapon_class/ghost'])
  })
})

describe('白箱 part 的格式（DATA 7.2 節）', () => {
  const P = part('pt_x', 'plate', 2, { armor: 2 })

  it('合格的樣本收得進來', () => {
    expect(problems('part', P)).toBe('')
    expect(problems('part', { ...P, traits: ['scan_proof'] })).toBe('')
  })

  it.each([
    ['name', '', /要有 name/],
    ['type', undefined, /要有 type/],
    ['brand', ' ', /要有 brand/],
    ['material', 'wood', /material 只能是 mech、bio/],
    ['grade', 6, /grade 要是 1～5/],
    ['price', -1, /price 要是 0 以上的整數/],
    ['legal', 'x', /legal 只能是/],
    ['cells', -1, /cells（份量）要是 0 以上的整數/],
    ['stats', 'x', /stats 要是「數字的名字 → 數字」/],
    ['stats', { armor: 'x' }, /stats 要是「數字的名字 → 數字」/],
    ['weight', -1, /weight 要是 0 以上的數字/],
    ['size', 9, /size 要是 0～4/],
    ['state', 'broken', /state 只能是 new、used、doujin、living/],
    ['traits', 'x', /traits 要是字串的陣列/],
    ['traits', [3], /traits 要是字串的陣列/],
  ] as const)('零件 %s 寫成 %j 擋下', (field, value, re) => {
    expect(edit('part', P, field, value as unknown)).toMatch(re)
  })
})

describe('白箱 三種變更（gear.slot、gear.quick、gear.coat；不變式第 3 條：整筆不收）', () => {
  const refuse = (g: G, change: Change) => {
    const before = JSON.stringify(g.state.actors.pc!.ext)
    expect(() => apply(g, [change])).toThrow()
    expect(JSON.stringify(g.state.actors.pc!.ext)).toBe(before)
  }
  const reason = (g: G, change: Change) => { try { apply(g, [change]) } catch (e) { return (e as Error).message } return '' }

  it('gear.slot：沒有這個角色、group 不對、沒有這一格、item 不是字串或空字串', () => {
    const g = setup()
    expect(reason(g, { op: 'gear.slot', id: 'ghost', group: 'worn', slot: 'head', item: null })).toMatch(/沒有 ghost 這個角色/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'pocket', slot: 'head', item: null })).toMatch(/group 只能是 worn、acc、carry/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'tail', item: null })).toMatch(/worn 沒有 tail 這一格/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'head', item: 5 })).toMatch(/item 要是物品的編號，或 null/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'head', item: '' })).toMatch(/item 要是物品的編號，或 null/)
    expect(reason(g, { op: 'gear.slot', id: undefined, group: 'worn', slot: 'head', item: null } as never)).toMatch(/沒有 undefined 這個角色/)
  })

  it('gear.slot：飾品要背包裡有、而且真的是飾品；穿著與攜帶要背包裡有這一件、設計圖放得進這一格', () => {
    const g = setup()
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'acc', slot: 'any1', item: 'it_nope' })).toMatch(/背包裡沒有這一件/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'acc', slot: 'any1', item: 'it_gel' })).toMatch(/這一件不是飾品/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'head', item: 'nope' })).toMatch(/背包裡沒有這一件/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'carry', slot: 'main', item: 'v1' })).toMatch(/這一件不能帶在這一格/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'carry', slot: 'main', item: 'p1' })).toMatch(/這一件不能帶在這一格/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'head', item: 'p1' })).toMatch(/這一件不能穿在這一格/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'head', item: 'v1' })).toMatch(/這一件不能穿在這一格/)
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'armor', item: 'v1' })).toBe('')
    expect(gearOf(g.state, 'pc').worn.armor).toBe('v1')
    expect(reason(g, { op: 'gear.slot', id: 'pc', group: 'worn', slot: 'armor', item: null })).toBe('')
    expect(gearOf(g.state, 'pc').worn.armor).toBeUndefined()
    refuse(g, { op: 'gear.slot', id: 'pc', group: 'carry', slot: 'melee', item: 'p1' })
  })

  it('gear.quick：items 格式、超過快取格、背包裡不夠（只回第一條）；整份換掉', () => {
    const g = setup()
    const quick = (items: unknown) => reason(g, { op: 'gear.quick', id: 'pc', items } as never)
    expect(quick('x')).toMatch(/items 要是 \{ item, qty \} 的陣列/)
    expect(quick([{ item: 'it_gel', qty: 0 }])).toMatch(/items 要是/)
    expect(quick([{ item: 'it_gel', qty: 1.5 }])).toMatch(/items 要是/)
    expect(quick([{ item: '', qty: 1 }])).toMatch(/items 要是/)
    expect(quick([{ item: 'it_gel', qty: 3 }])).toMatch(/快取格只有 2 格/)
    expect(quick([{ item: 'it_gel', qty: 2 }, { item: 'it_nope', qty: 0 }])).toMatch(/items 要是/)
    expect(quick([{ item: 'it_stone', qty: 1 }])).toMatch(/背包裡的it_stone不夠 1 個/)
    // 快取格只放藥、彈匣、手榴彈、工具（E6）：飾品、設計圖、不在目錄裡的都不收，原因排在格數之前
    expect(quick([{ item: 'it_ring', qty: 1 }])).toMatch(/不能放進快取格/)
    expect(quick([{ item: 'it_missing', qty: 1 }])).toMatch(/不能放進快取格/)
    expect(quick([{ item: 'it_gel', qty: 1 }, { item: 'it_ring', qty: 5 }])).toMatch(/不能放進快取格/)
    expect(quick([{ item: 'it_gel', qty: 1 }, { item: 'it_gel', qty: 1 }])).toBe('')
    expect(gearOf(g.state, 'pc').quick).toEqual([{ item: 'it_gel', qty: 1 }, { item: 'it_gel', qty: 1 }])
    expect(reason(g, { op: 'gear.quick', id: 'ghost', items: [] })).toMatch(/沒有 ghost 這個角色/)
    const many = setup(INV().map((s) => (s.id === 'it_gel' ? { ...s, qty: 1 } : s)))
    expect(reason(many, { op: 'gear.quick', id: 'pc', items: [{ item: 'it_gel', qty: 1 }, { item: 'it_gel', qty: 1 }] })).toMatch(/背包裡的it_gel不夠 2 個/)
  })

  it('gear.coat：只有 open 與 closed；描述一句話', () => {
    const g = setup()
    expect(reason(g, { op: 'gear.coat', id: 'pc', coat: 'half' } as never)).toMatch(/coat 只能是 open 或 closed/)
    expect(reason(g, { op: 'gear.coat', id: 'ghost', coat: 'open' })).toMatch(/沒有 ghost 這個角色/)
    const r = apply(g, [{ op: 'gear.coat', id: 'pc', coat: 'closed' }])
    expect(r[0]!.changes.map((c) => c.op)).toContain('gear.coat')
    expect(gearOf(g.state, 'pc').coat).toBe('closed')
    apply(g, [{ op: 'gear.coat', id: 'pc', coat: 'open' }])
    expect(gearOf(g.state, 'pc').coat).toBe('open')
  })
})

describe('白箱 身上的資料與小工具（EQUIPMENT 4.1 節）', () => {
  it('gearFromRaw：不是物件、不認得的格、不是字串的值、壞掉的快取格都丟掉；coat 只認 closed', () => {
    expect(gearFromRaw(undefined)).toEqual(emptyGear())
    expect(gearFromRaw('x')).toEqual(emptyGear())
    expect(gearFromRaw([])).toEqual(emptyGear())
    const g = gearFromRaw({
      worn: { head: 'a', tail: 'b', armor: 5, upper: '' }, acc: 'x', carry: { main: 'c' },
      quick: [{ item: 'i', qty: 2 }, { item: 'j', qty: 0 }, { item: 'k', qty: 1.5 }, 'x', { item: 3, qty: 1 }, { item: 'l', qty: Number.MAX_SAFE_INTEGER + 2 }],
      coat: 'closed',
    })
    expect(g).toEqual({ worn: { head: 'a' }, acc: {}, carry: { main: 'c' }, quick: [{ item: 'i', qty: 2 }], coat: 'closed' })
    expect(gearFromRaw({ coat: 'half' }).coat).toBe('open')
  })

  it('setSlot：放進、拿掉；gearOf 是複本，改它不動狀態', () => {
    const g = emptyGear()
    setSlot(g, 'worn', 'head', 'x')
    setSlot(g, 'acc', 'neck', 'y')
    expect(g.worn.head).toBe('x')
    setSlot(g, 'worn', 'head', null)
    expect(g.worn).toEqual({})
    const game = setup()
    const copy = gearOf(game.state, 'pc')
    copy.coat = 'closed'
    expect(gearOf(game.state, 'pc').coat).toBe('open')
    expect(gearOf(game.state, 'ghost')).toEqual(emptyGear())
  })

  it('fitQuick：照順序放；超過格數的去掉；背包裡不夠的去掉（同一種合起來算）；數量 0 以下不留', () => {
    const have = (item: string) => ({ a: 3, b: 1, c: 0 })[item as 'a'] ?? 0
    expect(fitQuick([{ item: 'a', qty: 2 }, { item: 'b', qty: 2 }, { item: 'a', qty: 5 }], 8, have)).toEqual([{ item: 'a', qty: 2 }, { item: 'b', qty: 1 }, { item: 'a', qty: 1 }])
    expect(fitQuick([{ item: 'a', qty: 3 }, { item: 'b', qty: 1 }], 2, have)).toEqual([{ item: 'a', qty: 2 }])
    expect(fitQuick([{ item: 'c', qty: 1 }], 5, have)).toEqual([])
    expect(fitQuick([], 5, have)).toEqual([])
    expect(sumQty([{ qty: 1 }, { qty: 4 }])).toBe(5)
  })

  it('quickCapacity：2 ＋ 身上每一件的 quick ＋ 飾品的 quick，最多 8', () => {
    const g = setup()
    expect(quickCapacity(g.k, g.state, emptyGear())).toBe(2)
    wear(g, 'v1')
    expect(quickCapacity(g.k, g.state, gearOf(g.state, 'pc'))).toBe(2 + 3)
    wear(g, 'it_bag')
    expect(quickCapacity(g.k, g.state, gearOf(g.state, 'pc'))).toBe(2 + 3 + 2)
    const big = emptyGear()
    big.worn = { armor: 'v1' }
    big.acc = { any1: 'it_bag', any2: 'it_bag', any3: 'it_bag' }
    expect(quickCapacity(g.k, g.state, big)).toBe(QUICK_MAX)
    big.acc = { any1: 'it_ghost' }
    expect(quickCapacity(g.k, g.state, big)).toBe(2 + 3) // 不認得的飾品不加
  })

  it('stackOf 與 partsOf：找 data.uid；零件可以是單一 id 或陣列；找不到的零件略過；parts 不是物件就是沒有零件', () => {
    const g = setup()
    expect(stackOf(g.state, 'v1')?.id).toBe('bp_vest')
    expect(stackOf(g.state, 'nope')).toBeUndefined()
    expect(partsOf(g.k, stackOf(g.state, 'v1')!).map((p) => [p.type, p.part.id])).toEqual([['fiber', 'pt_fiber'], ['plate', 'pt_plate3'], ['plate', 'pt_plate1']])
    expect(partsOf(g.k, made('x', 'bp_vest', { plate: ['pt_ghost', 3, 'pt_plate1'] }))).toHaveLength(1)
    expect(partsOf(g.k, { id: 'bp_vest', qty: 1, data: { uid: 'x', parts: 'oops' } })).toEqual([])
    expect(partsOf(g.k, { id: 'bp_vest', qty: 1 })).toEqual([])
  })

  it('wornPieces：連身類只算一件；背包裡已經不在的、設計圖不是護甲的略過', () => {
    const g = setup()
    const gear = emptyGear()
    gear.worn = { armor: 'v1', upper: 'p1', lower: 'ghost', head: 'he' }
    expect(wornPieces(g.k, g.state, gear).map((p) => p.uid)).toEqual(['he', 'v1'])
    gear.worn = { upper: 'v1', lower: 'v1' }
    expect(wornPieces(g.k, g.state, gear)).toHaveLength(1)
    expect(wornPieces(g.k, g.state, gear)[0]!.slots).toEqual(['upper', 'lower'])
  })
})

describe('白箱 穿脫的各條原因（EQUIPMENT 第 2～4 節；dev/work/M1-gear.md 第四節）', () => {
  it('equipBlock：沒有這個角色、武器放錯格（有類型名就用類型名）、帶在同一格的不同武器換上去', () => {
    const g = setup()
    expect(equipBlock(g.k, g.state, 'ghost', 'p1')).toBe('沒有 ghost 這個角色。')
    expect(equipBlock(g.k, g.state, 'pc', 'p1', 'main')).toBe('手槍要帶在副武器那一格。')
    expect(equipBlock(g.k, g.state, 'pc', 'p1', 'side')).toBeNull()
    expect(equipBlock(g.k, g.state, 'pc', 'p1')).toBeNull()
    const noClass = setup([{ id: 'bp_orphan', qty: 1, data: { uid: 'o1', parts: {} } }])
    expect(equipBlock(noClass.k, noClass.state, 'pc', 'o1')).toBe('這一件不能穿戴。')
    wear(g, 'p1')
    wear(g, 'r1')
    expect(gearOf(g.state, 'pc').carry).toEqual({ side: 'p1', main: 'r1' })
  })

  it('護甲：重甲不能再穿外套、穿著重甲不能再穿外套（兩個方向各一句）；換掉佔同一格的', () => {
    const g = setup()
    wear(g, 'c1')
    expect(equipBlock(g.k, g.state, 'pc', 'hv')).toBe('穿重甲的時候不能再穿外套，先把外套脫掉。')
    g.commit(unequip(g.k, g.state, 'pc', 'c1'))
    wear(g, 'hv')
    expect(equipBlock(g.k, g.state, 'pc', 'c1')).toBe('穿著重甲，不能再穿外套。')
    expect(equipBlock(g.k, g.state, 'pc', 'v1')).toBeNull() // 換掉佔同一格的重甲
    wear(g, 'v1')
    expect(gearOf(g.state, 'pc').worn.armor).toBe('v1')
  })

  it('飾品：背包裡沒有、不是飾品、頸與腿原本的換下來、通用格滿了、背包裡的數量都戴上了', () => {
    const g = setup()
    expect(equipBlock(g.k, g.state, 'pc', 'it_nope')).toBe('背包裡沒有這一件。')
    expect(equipBlock(g.k, g.state, 'pc', 'it_gel')).toBe('這一件不能穿戴。')
    wear(g, 'it_collar')
    wear(g, 'it_garter')
    wear(g, 'it_ring')
    wear(g, 'it_ring')
    expect(gearOf(g.state, 'pc').acc).toEqual({ neck: 'it_collar', leg: 'it_garter', any1: 'it_ring', any2: 'it_ring' })
    expect(equipBlock(g.k, g.state, 'pc', 'it_ring')).toBe('背包裡的這個飾品都已經戴上了。')
    expect(equipBlock(g.k, g.state, 'pc', 'it_collar')).toBeNull() // 頸原本的那個會換下來，戴同一個不算多戴
    const full = setup(INV().map((s) => (s.id === 'it_ring' ? { ...s, qty: 9 } : s)))
    for (let i = 0; i < 3; i++) wear(full, 'it_ring')
    expect(equipBlock(full.k, full.state, 'pc', 'it_ring')).toBe('通用的飾品格滿了（3 格）。')
  })

  it('unequip：沒有這個角色、不在身上丟錯；穿著、攜帶、飾品各自的說法；同一種飾品先拿最後戴上的那一格', () => {
    const g = setup()
    expect(() => unequip(g.k, g.state, 'ghost', 'p1')).toThrow(/沒有 ghost 這個角色/)
    expect(() => unequip(g.k, g.state, 'pc', 'p1')).toThrow(/這一件不在身上/)
    wear(g, 'p1')
    wear(g, 'v1')
    wear(g, 'it_ring')
    wear(g, 'it_ring')
    expect(unequip(g.k, g.state, 'pc', 'p1').outcome.summary).toBe('收起bp_pistol。')
    expect(unequip(g.k, g.state, 'pc', 'v1').outcome.summary).toBe('脫下bp_vest。')
    const r = unequip(g.k, g.state, 'pc', 'it_ring')
    expect(r.outcome.summary).toBe('摘下it_ring。')
    expect(r.changes).toEqual([{ op: 'gear.slot', id: 'pc', group: 'acc', slot: 'any2', item: null }])
  })

  it('穿上或脫下讓快取格變少：放不下的收回背包並寫一句；東西還在背包裡', () => {
    const g = setup()
    wear(g, 'v1')
    apply(g, [{ op: 'gear.quick', id: 'pc', items: [{ item: 'it_gel', qty: 4 }] }])
    const r = unequip(g.k, g.state, 'pc', 'v1')
    expect(r.changes.at(-1)).toEqual({ op: 'gear.quick', id: 'pc', items: [{ item: 'it_gel', qty: 2 }] })
    expect(r.timeline[0]!.text).toBe('快取格只剩 2 格，放不下的東西收回背包了。')
  })
})

describe('白箱 護甲與武器的算式（COMBAT_SYSTEM 第 4、5 節；EQUIPMENT 6.1、6.3 節）', () => {
  it('護甲：纖維加最好的一塊板材加其他板材的一半，全身捨去；頭盔值大於 0 就 +1；沒有穿東西是 0', () => {
    const g = setup(INV().concat([made('v2', 'bp_vest', { plate: ['pt_plate1', 'pt_plate1'] })]))
    expect(armorOf(g.k, g.state, 'pc')).toBe(0)
    wear(g, 'v1')
    expect(armorOf(g.k, g.state, 'pc')).toBe(Math.floor(1 + 2 + 3 + 0.5))
    expect(bodyArmorOf(g.k, g.state, 'pc')).toBe(6)
    wear(g, 'he')
    expect(armorOf(g.k, g.state, 'pc')).toBe(7)
    expect(bodyArmorOf(g.k, g.state, 'pc')).toBe(6)
    wear(g, 'v2')
    expect(bodyArmorOf(g.k, g.state, 'pc')).toBe(Math.floor(1 + 1 + 0.5)) // 設計圖 1 ＋ 最好的一塊 1 ＋ 另一塊的一半，捨去
    expect(g.k.stats.stat(g.state, 'pc', 'armor')).toBe(armorOf(g.k, g.state, 'pc'))
    expect(g.k.stats.stat(g.state, 'pc', 'armor_body')).toBe(bodyArmorOf(g.k, g.state, 'pc'))
  })

  it('武器：命中 = mod(屬性) ＋ 基本功 ＋ 零件的 hit；槍管最高的等級骰；零件的 damage、pierce、range_far、mag；近戰的傷害加體格調整、用刃的等級骰', () => {
    const g = setup()
    const p = weaponOf(g.k, g.state, 'pc', 'p1')
    expect(p).toMatchObject({ id: 'p1', item: 'p1', name: 'bp_pistol', hit: 2 + 2 + 1, dice: 3 + 2, flat: 2, pierce: 1, range: [1, 6], mag: { now: 3, max: 3 } })
    const b = weaponOf(g.k, g.state, 'pc', 'b1')
    expect(b).toMatchObject({ hit: 1 + 1, dice: 3 + 3, flat: 1 + 1, pierce: 1 })
    expect(b.mag).toBeUndefined()
    const bare = weaponOf(g.k, g.state, 'pc', 'r1')
    expect(bare).toMatchObject({ dice: 3, flat: 0, range: [1, 4], mag: { now: 2, max: 2 } })
  })

  it('weaponOf：沒有這個角色、背包裡沒有、不是武器都丟錯；武器引用不存在的類型時丟錯', () => {
    const g = setup()
    expect(() => weaponOf(g.k, g.state, 'ghost', 'p1')).toThrow(/沒有 ghost 這個角色/)
    expect(() => weaponOf(g.k, g.state, 'pc', 'zz')).toThrow(/背包裡沒有這一件/)
    expect(() => weaponOf(g.k, g.state, 'pc', 'v1')).toThrow(/這一件不是武器/)
    const bad = setup([{ id: 'bp_ghostclass', qty: 1, data: { uid: 'gc', parts: {} } }])
    expect(() => weaponOf(bad.k, bad.state, 'pc', 'gc')).toThrow(/不是武器/)
  })

  it('藏匿量與掃描：長外套敞開減半、扣上才滿；同樣大小照 uid 排；放不下的露在外面；強度 0 不掃、1 只掃大小 2 以上', () => {
    const g = setup()
    wear(g, 'c1')
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(2)
    wear(g, 'p1')
    wear(g, 'r1')
    wear(g, 'b1')
    const c = concealment(g.k, g.state, 'pc')
    expect(c.hidden).toEqual(['b1', 'p1'])
    expect(c.shown).toEqual(['r1'])
    apply(g, [{ op: 'gear.coat', id: 'pc', coat: 'closed' }])
    expect(concealment(g.k, g.state, 'pc')).toEqual({ capacity: 5, hidden: ['b1', 'p1', 'r1'], shown: [] })
    expect(scanFinds(g.k, g.state, 'pc', 0)).toEqual([])
    expect(scanFinds(g.k, g.state, 'pc', Number.NaN)).toEqual([])
    expect(scanFinds(g.k, g.state, 'pc', 1)).toEqual(['r1'])
    expect(scanFinds(g.k, g.state, 'pc', 2)).toEqual(['b1', 'p1', 'r1'])
  })
})

describe('白箱 帶進戰鬥與戰鬥結束（EQUIPMENT 4.1 節）', () => {
  it('loadout：不認得的角色什麼都不給；內海的戰鬥不帶槍、也不帶快取格（M3-mode-audit，ADR 0018）', () => {
    const g = setup()
    wear(g, 'p1')
    apply(g, [{ op: 'gear.quick', id: 'pc', items: [{ item: 'it_gel', qty: 1 }] }])
    expect(g.k.battle.loadoutOf(g.state, 'ghost', 'meat')).toEqual({ weapons: [], armor: 0, evade: 0, quick: [], tags: [] })
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').weapons.map((w) => w.id)).toEqual(['p1'])
    const net = g.k.battle.loadoutOf(g.state, 'pc', 'net')
    expect(net.weapons).toEqual([])
    expect(net.quick).toEqual([])
  })

  it('戰鬥結束：沒有對應角色的我方單位、同一個角色出現兩次都不會壞；快取格沒有變化就不留變更', async () => {
    const { game } = makeBattleGame({
      features: [characterFeature, gearFeature, TEST_COMBAT], content: [PACK], pc: { attrs: { reflex: 14 } }, patch: { inventory: INV() },
      battle: { ...duel([], []), allies: [{ from: 'actor', id: 'pc' }, raw(one({}, 2))], foes: [raw(foe('minion', { hp: { now: 1, max: 1 } }))], cover: 'medium' },
    })
    const state = structuredClone(game.state) as GameState
    state.battle!.result = { outcome: 'win', text: 'x' }
    const extras = game.k.battle.endExtras({ k: game.k, state, battle: state.battle!, outcome: 'win' })
    expect(extras.filter((e) => e.lines?.some((l) => l.startsWith('用掉')))).toEqual([])
  })
})
