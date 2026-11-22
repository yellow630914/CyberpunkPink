// 驗收測試：dev/work/M1-gear.md（cpp-feature）。工單做完之前照預期失敗（features/gear 還不存在）。
// 規格：EQUIPMENT 第 1～4、6 節（四層、穿著 10 格、飾品 5 格、攜帶、快取格、藏匿與掃描）；COMBAT_SYSTEM 第 4 節（全身的護甲怎麼算）、
// 第 5 節（槍管的等級骰）；DATA 7.1、7.2 節（設計圖與零件）。組裝的檢定、品質、拆解是 M4，不在這一張。

import { describe, expect, it } from 'vitest'
import type { ContentPack, ItemStack } from '../../src'
import { attrMod } from '../../src'
import { ACCESSORY_SLOTS, CARRY_SLOTS, QUICK_BASE, QUICK_MAX, WEAR_SLOTS, armorOf, concealment, equip, equipBlock, gearFeature, gearOf, scanFinds, unequip, weaponOf } from '../../src/features/gear'
import { characterFeature } from '../../src/features/character'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame } from '../../src/testkit'

const SKILLS = ['firearms', 'brawl', 'heavy'].map((id) => ({ id, name: id, attr: id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: ['concealable'], attr: 'reflex', skill: 'firearms' },
  { id: 'rifle', name: '步槍', dice: 4, type: 'physical', range: [3, 7], mag: 3, cover_mult: 0.5, pierce: 2, traits: ['long'], attr: 'reflex', skill: 'firearms' },
  { id: 'melee', name: '近戰', dice: 3, type: 'physical', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee', 'silent'], attr: 'body', skill: 'brawl' },
]
const bp = (id: string, kind: string, more: Record<string, unknown>) => ({ id, kind, name: id, desc: `${id}。`, brand: 'starbelle', grade: 1, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...more })
const part = (id: string, type: string, grade: number, stats: Record<string, number> = {}, more: Record<string, unknown> = {}) => ({ id, name: id, type, material: 'mech', brand: 'starbelle', grade, price: 100, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new', ...more })
const PACK: ContentPack = {
  id: 'gear_test',
  content: {
    skill: SKILLS, weapon_class: WEAPONS,
    blueprint: [
      bp('bp_pistol', 'weapon', { class: 'pistol', carry: 'side', require: [{ type: 'barrel' }, { type: 'action' }, { type: 'plate' }], optional: [{ type: 'sensor' }] }),
      bp('bp_rifle', 'weapon', { class: 'rifle', carry: 'main', size: 3, grade: 3, require: [{ type: 'barrel' }, { type: 'action' }, { type: 'plate' }] }),
      bp('bp_knife', 'weapon', { class: 'melee', carry: 'melee', require: [{ type: 'blade' }] }),
      bp('bp_vest', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', require: [{ type: 'fiber' }, { type: 'plate' }], optional: [{ type: 'plate' }, { type: 'plate' }], quick: 2 }),
      bp('bp_heavy', 'armor', { armor: 1, covers: ['armor'], weight_class: 'heavy', require: [{ type: 'fiber' }, { type: 'plate' }] }),
      bp('bp_shirt', 'armor', { armor: 0, covers: ['upper'], weight_class: 'light', require: [{ type: 'fiber' }] }),
      bp('bp_maid', 'armor', { armor: 1, covers: ['upper', 'lower'], weight_class: 'medium', require: [{ type: 'fiber' }], conceal: 2 }),
      bp('bp_coat', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', require: [{ type: 'fiber' }], conceal: 5 }),
      bp('bp_helmet', 'armor', { armor: 1, covers: ['head'], weight_class: 'medium', require: [{ type: 'plate' }] }),
    ],
    part: [
      part('pt_barrel_1', 'barrel', 1, { damage: 1 }), part('pt_barrel_3', 'barrel', 3, { damage: 3, range_far: 1 }), part('pt_barrel_4', 'barrel', 4, { damage: 4 }),
      part('pt_action_1', 'action', 1), part('pt_action_big', 'action', 2, { mag: 1 }), part('pt_plate_1', 'plate', 1, { armor: 1 }), part('pt_plate_3', 'plate', 3, { armor: 3 }),
      part('pt_plate_ceramic', 'plate', 2, { armor: 2 }, { traits: ['scan_proof'] }), part('pt_sensor', 'sensor', 2, { hit: 1 }),
      part('pt_fiber_2', 'fiber', 2, { armor: 2 }), part('pt_fiber_0', 'fiber', 1), part('pt_blade', 'blade', 2, { damage: 2, pierce: 1 }),
    ],
    item: [
      { id: 'it_ring', name: '戒指', desc: '一枚戒指。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['acc:any'] },
      { id: 'it_collar', name: '項圈', desc: '一條項圈。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['acc:neck'] },
      { id: 'it_belt', name: '腰帶', desc: '一條戰術腰帶。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['belt'], quick: 2 },
      { id: 'it_medgel_1', name: '急救凝膠', desc: '一管急救凝膠。', category: 'consumable', grade: 1, size: 0, legal: 'free', use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 8 }] } },
      { id: 'it_holster', name: '槍套腿帶', desc: '槍套。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['acc:leg'], conceal: 1 },
    ],
  },
}
/** 一件組好的成品：設計圖加零件。uid 是背包裡這一件的編號。 */
const made = (uid: string, blueprint: string, parts: Record<string, string | string[]> = {}): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts } })
const INVENTORY: ItemStack[] = [
  made('g1', 'bp_pistol', { barrel: 'pt_barrel_1', action: 'pt_action_1', plate: 'pt_plate_1' }),
  made('g2', 'bp_rifle', { barrel: 'pt_barrel_3', action: 'pt_action_big', plate: 'pt_plate_1' }),
  made('g3', 'bp_knife', { blade: 'pt_blade' }),
  made('g4', 'bp_vest', { fiber: 'pt_fiber_2', plate: ['pt_plate_3', 'pt_plate_1', 'pt_plate_1'] }),
  made('g5', 'bp_shirt', { fiber: 'pt_fiber_0' }), made('g6', 'bp_coat', { fiber: 'pt_fiber_0' }), made('g7', 'bp_helmet', { plate: 'pt_plate_3' }),
  made('g8', 'bp_heavy', { fiber: 'pt_fiber_2', plate: 'pt_plate_3' }), made('g9', 'bp_maid', { fiber: 'pt_fiber_2' }),
  made('g10', 'bp_pistol', { barrel: 'pt_barrel_4', action: 'pt_action_1', plate: 'pt_plate_ceramic', sensor: 'pt_sensor' }),
  { id: 'it_ring', qty: 5 }, { id: 'it_collar', qty: 1 }, { id: 'it_belt', qty: 1 }, { id: 'it_medgel_1', qty: 6 }, { id: 'it_holster', qty: 1 },
]
const setup = () => makeGame({ features: [characterFeature, gearFeature, TEST_COMBAT], content: [PACK], pc: { attrs: { reflex: 14, body: 12 }, skills: { firearms: 2, brawl: 1 } }, patch: { inventory: structuredClone(INVENTORY) } }).game
type G = ReturnType<typeof setup>
const wear = (g: G, uid: string, slot?: string) => g.commit(equip(g.k, g.state, 'pc', uid, slot))

describe('四層與欄位（EQUIPMENT 第 1～4 節）', () => {
  it('穿著 10 格、飾品 5 格（頸、腿、通用 ×3）、攜帶 3 格；每個人有 2 格快取，上限 8', () => {
    expect([...WEAR_SLOTS]).toEqual(['head', 'face', 'upper', 'lower', 'outer', 'armor', 'hands', 'shoes', 'underwear_top', 'underwear_bottom'])
    expect([...ACCESSORY_SLOTS]).toEqual(['neck', 'leg', 'any1', 'any2', 'any3'])
    expect([...CARRY_SLOTS]).toEqual(['main', 'side', 'melee'])
    expect([QUICK_BASE, QUICK_MAX]).toEqual([2, 8])
    const g = setup()
    expect(gearOf(g.state, 'pc')).toEqual({ worn: {}, acc: {}, carry: {}, quick: [], coat: 'open' })
  })

  it('穿上、帶上、脫下都是一份報告；東西還在背包裡（只是標成身上的），脫下就回去；放錯格、沒有這一件會被擋下', () => {
    const g = setup()
    expect(equipBlock(g.k, g.state, 'pc', 'g1', 'main')).toBe('手槍要帶在副武器那一格。')
    expect(equipBlock(g.k, g.state, 'pc', 'nope')).toBe('背包裡沒有這一件。')
    wear(g, 'g1')
    wear(g, 'g2')
    wear(g, 'g3')
    expect(gearOf(g.state, 'pc').carry).toEqual({ main: 'g2', side: 'g1', melee: 'g3' })
    expect(g.state.inventory.find((s) => s.data?.uid === 'g1')).toBeDefined()
    g.commit(unequip(g.k, g.state, 'pc', 'g1'))
    expect(gearOf(g.state, 'pc').carry).toEqual({ main: 'g2', melee: 'g3' })
    expect(g.undoSteps()).toBe(true)
    expect(gearOf(g.state, 'pc').carry.side).toBe('g1')
  })

  it('連身類同時佔上身與下身；重甲佔護甲格，而且不能再穿外套', () => {
    const g = setup()
    wear(g, 'g5')
    wear(g, 'g9') // 裝甲女僕服：連身，把上衣換下來
    expect(gearOf(g.state, 'pc').worn).toEqual({ upper: 'g9', lower: 'g9' })
    wear(g, 'g6')
    expect(equipBlock(g.k, g.state, 'pc', 'g8')).toBe('穿重甲的時候不能再穿外套，先把外套脫掉。')
    g.commit(unequip(g.k, g.state, 'pc', 'g6'))
    wear(g, 'g8')
    expect(equipBlock(g.k, g.state, 'pc', 'g6')).toBe('穿著重甲，不能再穿外套。')
  })

  it('飾品：頸與腿各一格、通用三格；存檔規則可以多給通用格', () => {
    const g = setup()
    for (let i = 0; i < 3; i++) g.commit(equip(g.k, g.state, 'pc', 'it_ring'))
    expect(equipBlock(g.k, g.state, 'pc', 'it_ring')).toBe('通用的飾品格滿了（3 格）。')
    g.commit(equip(g.k, g.state, 'pc', 'it_collar'))
    expect(gearOf(g.state, 'pc').acc).toEqual({ any1: 'it_ring', any2: 'it_ring', any3: 'it_ring', neck: 'it_collar' })
  })

  it('快取格：每個人 2 格，腰帶與戰術背心再加，上限 8；一格一件小東西', () => {
    const g = setup()
    const put = (n: number) => g.commit({ kind: 'system', action: 'gear.quick', location: {}, party: [], timeline: [], changes: [{ op: 'gear.quick', id: 'pc', items: [{ item: 'it_medgel_1', qty: n }] }], outcome: { result: 'ok', summary: '整理快取格。' } })
    put(2)
    expect(gearOf(g.state, 'pc').quick).toEqual([{ item: 'it_medgel_1', qty: 2 }])
    expect(() => put(3)).toThrow(/快取格只有 2 格/)
    g.commit(equip(g.k, g.state, 'pc', 'it_belt'))
    wear(g, 'g4') // 戰術背心 +2
    put(6)
    expect(() => put(7)).toThrow(/快取格只有 6 格/)
  })
})

describe('護甲與武器的數字（COMBAT_SYSTEM 第 4、5 節）', () => {
  it('一件 ＝ 設計圖的基礎 ＋ 纖維 ＋ 最好的一塊板材 ＋ 其他每塊板材的一半；全身 ＝ 身上最高的那一件（不疊）＋ 頭盔（最多 +1）', () => {
    const g = setup()
    expect(armorOf(g.k, g.state, 'pc')).toBe(0)
    wear(g, 'g5')
    expect(armorOf(g.k, g.state, 'pc')).toBe(0)
    wear(g, 'g4') // 背心：基礎 1 ＋ 纖維 2 ＋ 最好的板材 3 ＋ 另外兩塊各 0.5 = 7
    expect(armorOf(g.k, g.state, 'pc')).toBe(7)
    wear(g, 'g9') // 女僕服 1 ＋ 2 = 3：不疊，還是 7
    expect(armorOf(g.k, g.state, 'pc')).toBe(7)
    wear(g, 'g7') // 頭盔最多 +1
    expect(armorOf(g.k, g.state, 'pc')).toBe(8)
    // 進了衍生數值：戰鬥與報告讀同一個數字
    expect(g.k.stats.stat(g.state, 'pc', 'armor')).toBe(8)
  })

  it('武器 ＝ 設計圖的類型 ＋ 零件：命中是 mod(屬性) ＋ 基本功 ＋ 零件；槍管 III 級 +1 顆、IV 級 +2 顆（等級骰）；彈匣來自機構', () => {
    const g = setup()
    const pistol = weaponOf(g.k, g.state, 'pc', 'g1')
    expect(pistol).toMatchObject({ id: 'g1', class: 'pistol', dice: 3, flat: 1, hit: attrMod(14) + 2, mag: { now: 2, max: 2 }, range: [1, 4], item: 'g1' })
    const rifle = weaponOf(g.k, g.state, 'pc', 'g2')
    expect(rifle).toMatchObject({ class: 'rifle', dice: 4 + 1, flat: 3, range: [3, 8], mag: { now: 4, max: 4 }, pierce: 2, traits: ['long'] })
    expect(weaponOf(g.k, g.state, 'pc', 'g10')).toMatchObject({ dice: 3 + 2, flat: 4, hit: attrMod(14) + 2 + 1 })
    // 近戰用體格 ＋ 格鬥，傷害加 mod(體格)
    expect(weaponOf(g.k, g.state, 'pc', 'g3')).toMatchObject({ class: 'melee', hit: attrMod(12) + 1, flat: 2 + attrMod(12), pierce: 1 })
  })

  it('帶進戰鬥：主武器、副武器、近戰照這個順序，快取格與護甲一起；沒帶武器就是空手', () => {
    const g = setup()
    for (const uid of ['g1', 'g2', 'g3', 'g4']) wear(g, uid)
    g.commit({ kind: 'system', action: 'gear.quick', location: {}, party: [], timeline: [], changes: [{ op: 'gear.quick', id: 'pc', items: [{ item: 'it_medgel_1', qty: 2 }] }], outcome: { result: 'ok', summary: '整理快取格。' } })
    g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    const me = g.battle!.units.a1!
    expect(me.weapons.map((w) => w.class)).toEqual(['rifle', 'pistol', 'melee'])
    expect(me.armor).toBe(7)
    expect(me.quick).toEqual([{ item: 'it_medgel_1', qty: 2 }])
    expect(me.evade).toBe(10 + attrMod(14))
    const bare = setup()
    bare.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    expect(bare.battle!.units.a1!.weapons.map((w) => w.id)).toEqual(['unarmed'])
  })
})

describe('藏匿與掃描（EQUIPMENT 第 6 節）', () => {
  it('藏匿量：沒穿外套 1；長外套 5（扣上才算滿，敞開減半）；槍套 +1。想藏的東西大小加起來不超過就是藏好了', () => {
    const g = setup()
    wear(g, 'g1') // 手槍，大小 1
    expect(concealment(g.k, g.state, 'pc')).toEqual({ capacity: 1, hidden: ['g1'], shown: [] })
    wear(g, 'g2') // 步槍，大小 3：藏不住
    expect(concealment(g.k, g.state, 'pc')).toMatchObject({ capacity: 1, hidden: ['g1'], shown: ['g2'] })
    wear(g, 'g6')
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(2) // 敞開：5 的一半，無條件捨去
    g.commit({ kind: 'system', action: 'gear.coat', location: {}, party: [], timeline: [], changes: [{ op: 'gear.coat', id: 'pc', coat: 'closed' }], outcome: { result: 'ok', summary: '把外套扣上。' } })
    expect(concealment(g.k, g.state, 'pc')).toEqual({ capacity: 5, hidden: ['g1', 'g2'], shown: [] })
    g.commit(equip(g.k, g.state, 'pc', 'it_holster'))
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(6)
  })

  it('掃描看的是東西本身：強度 0 不掃、1 只掃大小 2 以上的武器、2 以上掃所有武器；每個零件都掃不到的那一件才掃不到', () => {
    const g = setup()
    wear(g, 'g1')
    wear(g, 'g2')
    expect(scanFinds(g.k, g.state, 'pc', 0)).toEqual([])
    expect(scanFinds(g.k, g.state, 'pc', 1)).toEqual(['g2'])
    expect(scanFinds(g.k, g.state, 'pc', 2)).toEqual(['g1', 'g2'])
    // 一件東西只要有一個掃得到的零件，整件就掃得到
    g.commit(unequip(g.k, g.state, 'pc', 'g1'))
    wear(g, 'g10')
    expect(scanFinds(g.k, g.state, 'pc', 2)).toEqual(['g10', 'g2'])
  })
})
