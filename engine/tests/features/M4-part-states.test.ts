// 驗收測試：dev/work/M4-core-part-ai.md 的總指揮補記（二手零件狀態進成品；M4-craft-salvage 回報）。
// 核心 ProductData.part_states（槽 → 每個零件各自的狀態，和 parts 的順序一一對應）：readProduct 整理、partsOf／productOf 套上去、productPrice 照零件的實際狀態算（二手 ×0.5）；
// craft 的組裝與換零件放進二手件時寫進去、放進全新的就清掉。規格：CRAFTING 4 節（狀態）、10.1、10.3、10.4 節；dev/adr/0019 P11、P68、第十七節。
// 內容一律用測試自帶的最小假資料：一把手槍（槍管與機構）、兩支槍管（同牌與別牌）、一家槍店（店家做，一定成功、不擲骰）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentPack, ItemStack } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { PART_STATES, Rng, partOf, partStateAt, productOf, productPrice, readProduct, setPartState, stackPart } from '../../src'
import { assembleDraft, assemblyPreview, craftFeature, salvageDraft, swapDraft, swapPreview } from '../../src/features/craft'
import { characterFeature } from '../../src/features/character'
import { gearFeature } from '../../src/features/gear'
import { tradeFeature } from '../../src/features/trade'
import { arrive, worldFeature } from '../../src/features/world'
import { makeGame } from '../../src/testkit'

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
const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS: Rec[] = [
  part('pt_barrel', 'barrel', { price: 200, stats: { hit: 1, damage: 2 } }),
  part('pt_barrel_ka', 'barrel', { price: 200, brand: 'ka', stats: { hit: 2 } }),
  part('pt_action', 'action', { price: 200, stats: { damage: 1 } }),
  part('pt_old_action', 'action', { price: 200, stats: { damage: 1 }, state: 'used' }),
]
const BLUEPRINTS: Rec[] = [{
  id: 'bp_pistol', kind: 'weapon', name: '手槍', desc: '手槍。', brand: 'hz', grade: 2, legal: 'register', price: 100, size: 1, weight: 1, class: 'pistol', carry: 'side',
  require: [{ type: 'barrel' }, { type: 'action' }], optional: [], stock: { barrel: 'pt_barrel', action: 'pt_action' },
}]
const pack = (): ContentPack => ({
  id: 'part_states_test',
  content: {
    skill: [{ id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'mechanics', name: '機械', attr: 'tech', desc: '機械。' }],
    weapon_class: [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }],
    special_map: [MAP], facility_type: [{ id: 'fac_shop', name: '槍店', craft: { by: 'shop' } }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_shops'] }],
    block: [{ id: 'b_shops', district: 'd_hive', name: '店街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_shop', name: '槍店' } } }],
    blueprint: structuredClone(BLUEPRINTS), part: structuredClone(PARTS), quirk: [],
  } as unknown as ContentPack['content'],
})

const make = () => {
  const { game } = makeGame({
    features: [characterFeature, worldFeature, gearFeature, tradeFeature, craftFeature], content: [pack()], seed: 7,
    pc: { hp: 40, attrs: { tech: 14 }, skills: { firearms: 2, mechanics: 2 } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 5000, cash: 500 } },
  })
  game.commit(arrive(game.k, game.state, 'b_shops', 'F1'))
  return game
}
type G = ReturnType<typeof make>
const products = (g: G): ItemStack[] => g.state.inventory.filter((s) => s.id === 'bp_pistol')
afterEach(() => { vi.restoreAllMocks() })
const usedStack = (g: G, id: string, uid: string): void => { g.state.inventory.push({ id, qty: 1, data: { uid, state: 'used' } }) }

// ===================================================================================================================
describe('核心：readProduct 整理 part_states', () => {
  const parts = { barrel: 'pt_barrel', action: ['pt_action', 'pt_old_action'], skin: { unreg: true, uid: 'u1' } }
  const read = (states: unknown, p: unknown = parts) => readProduct({ uid: 'x', parts: p, part_states: states })

  it('留下對得上 parts 的、認得的狀態；結尾的 null 去掉；整個類型都沒有的拿掉；一筆都沒有就沒有這一欄', () => {
    expect(read({ barrel: ['used'] }).part_states).toEqual({ barrel: ['used'] })
    expect(read({ action: [null, 'used'] }).part_states).toEqual({ action: [null, 'used'] })
    expect(read({ action: ['used', null, null] }).part_states).toEqual({ action: ['used'] })
    expect(read({ barrel: [null] }).part_states).toBeUndefined()
    expect(read({ barrel: [] }).part_states).toBeUndefined()
    expect(read(undefined).part_states).toBeUndefined()
    expect('part_states' in read({})).toBe(false)
    for (const s of PART_STATES) expect(read({ barrel: [s] }).part_states).toEqual({ barrel: [s] })
  })

  it('壞的丟掉：不是陣列、不認得的狀態、parts 裡沒有的類型、比零件多出來的格；內嵌的零件（自帶 state）那一格一律當沒有', () => {
    expect(read({ barrel: 'used' }).part_states).toBeUndefined()
    expect(read({ barrel: ['broken'] }).part_states).toBeUndefined()
    expect(read({ nothing: ['used'] }).part_states).toBeUndefined()
    expect(read({ barrel: ['used', 'used', 'used'] }).part_states).toEqual({ barrel: ['used'] })
    expect(read({ skin: ['used'] }).part_states).toBeUndefined()
    expect(read({ __proto__: ['used'], barrel: [1, 'used'] }).part_states).toBeUndefined()
    expect(read('用過的').part_states).toBeUndefined()
  })

  it('partStateAt／setPartState：讀與改都不動傳進來的東西；null 是沿用零件自己的、結尾的 null 會被拿掉', () => {
    const base = { barrel: ['used' as const] }
    expect(partStateAt({ part_states: base }, 'barrel', 0)).toBe('used')
    expect(partStateAt({ part_states: base }, 'barrel', 1)).toBeUndefined()
    expect(partStateAt({ part_states: base }, 'action', 0)).toBeUndefined()
    expect(partStateAt({}, 'barrel', 0)).toBeUndefined()
    expect(partStateAt(null, 'barrel', 0)).toBeUndefined()
    const next = setPartState(base, 'action', 1, 'used')
    expect(next).toEqual({ barrel: ['used'], action: [null, 'used'] })
    expect(base).toEqual({ barrel: ['used'] })
    expect(setPartState(next, 'barrel', 0, null)).toEqual({ action: [null, 'used'] })
    expect(setPartState(setPartState(next, 'barrel', 0, null), 'action', 1, null)).toBeUndefined()
    expect(setPartState(undefined, 'barrel', 0, null)).toBeUndefined()
    expect(setPartState(undefined, 'barrel', 2, 'used')).toEqual({ barrel: [null, null, 'used'] })
  })
})

// ===================================================================================================================
describe('核心：productOf 套上零件的狀態、productPrice 照實際狀態算', () => {
  const g = make()
  const k = g.k
  const data = (extra: Rec = {}) => ({ uid: 'p1', parts: { barrel: 'pt_barrel', action: 'pt_action' }, ...extra })

  it('part_states 指定二手：那個零件的 state 是 used，別的不變；登錄表裡的那一筆不被改', () => {
    const info = productOf(k.content, 'bp_pistol', data({ part_states: { barrel: ['used'] } }))!
    expect(info.parts.map((p) => [p.type, p.part.state])).toEqual([['barrel', 'used'], ['action', 'new']])
    expect((k.content.get('part', 'pt_barrel') as Rec).state).toBe('new')
    expect(partOf(k.content, 'pt_barrel')!.state).toBe('new')
    // 沒有指定的和以前一樣
    expect(productOf(k.content, 'bp_pistol', data())!.parts.map((p) => p.part.state)).toEqual(['new', 'new'])
    // 數字（stats、牌子、等級）不因狀態而變
    expect(productOf(k.content, 'bp_pistol', data({ part_states: { barrel: ['used'] } }))!.stats).toEqual(productOf(k.content, 'bp_pistol', data())!.stats)
  })

  it('同一類兩個零件各自的狀態：照順序對（第二個二手）；內容裡本來就是二手的零件照舊', () => {
    const info = productOf(k.content, 'bp_pistol', data({ parts: { barrel: 'pt_barrel', action: ['pt_action', 'pt_action'] }, part_states: { action: [null, 'used'] } }))!
    expect(info.parts.filter((p) => p.type === 'action').map((p) => p.part.state)).toEqual(['new', 'used'])
    expect(productOf(k.content, 'bp_pistol', data({ parts: { barrel: 'pt_barrel', action: 'pt_old_action' } }))!.parts[1]!.part.state).toBe('used')
  })

  it('沒有 parts 用原廠的 stock：全新，part_states 不套在 stock 上', () => {
    const info = productOf(k.content, 'bp_pistol', { uid: 'p1', parts: {}, part_states: { barrel: ['used'] } })!
    expect(info.parts.map((p) => p.part.state)).toEqual(['new', 'new'])
    expect(productPrice(k.content, 'bp_pistol', { uid: 'p1', part_states: { barrel: ['used'] } })).toBe(productPrice(k.content, 'bp_pistol'))
  })

  it('productPrice：二手的零件 ×0.5（只折那一個零件）；成品整件是二手時不再重複折；內嵌的零件（doujin）不折', () => {
    const full = productPrice(k.content, 'bp_pistol', data())
    expect(full).toBe(Math.round(400 * 1.2))
    expect(productPrice(k.content, 'bp_pistol', data({ part_states: { barrel: ['used'] } }))).toBe(Math.round((100 + 200) * 1.2))
    expect(productPrice(k.content, 'bp_pistol', data({ part_states: { barrel: ['used'], action: ['used'] } }))).toBe(Math.round(200 * 1.2))
    // 成品整件二手：×0.5 一次，零件的二手不再折
    expect(productPrice(k.content, 'bp_pistol', data({ state: 'used' }))).toBe(Math.round(400 * 1.2 * 0.5))
    expect(productPrice(k.content, 'bp_pistol', data({ state: 'used', part_states: { barrel: ['used'] } }))).toBe(Math.round(400 * 1.2 * 0.5))
    // 內嵌的零件（未登錄零件，state: doujin）照原價
    const inline = { unreg: true, uid: 'u1', desc: '一根槍管。', name: '無名的槍管', type: 'barrel', material: 'mech', brand: 'hz', grade: 2, price: 300, legal: 'free', cells: 2, stats: { hit: 3 }, weight: 1, size: 1, state: 'doujin' }
    expect(productPrice(k.content, 'bp_pistol', data({ parts: { barrel: inline, action: 'pt_action' }, part_states: { barrel: ['used'] } }))).toBe(Math.round(500 * 1.2))
  })
})

// ===================================================================================================================
describe('craft：組裝放進二手件，狀態留下來', () => {
  it('二手槍管（拆下來的，帶 uid）加全新機構：預覽價錢折了那一個零件；做出來的成品有 part_states；productOf 讀得到二手', () => {
    const g = make()
    usedStack(g, 'pt_barrel', 'us1')
    g.state.inventory.push({ id: 'pt_action', qty: 1 })
    const opts = { blueprint: 'bp_pistol', parts: { barrel: 'us1', action: 'pt_action' }, maker: 'shop' as const }
    const pv = assemblyPreview(g.k, g.state, opts)
    expect(pv.problems).toEqual([])
    expect(pv.result!.price).toBe(Math.round((100 + 200) * 1.2))
    g.commit(assembleDraft(g.k, g.state, opts))
    const made = products(g)
    expect(made).toHaveLength(1)
    expect(made[0]!.data!.part_states).toEqual({ barrel: ['used'] })
    expect(made[0]!.data!.parts).toEqual({ barrel: 'pt_barrel', action: 'pt_action' })
    expect(made[0]!.data!.state).toBe('new')
    const info = productOf(g.k.content, 'bp_pistol', made[0]!.data)!
    expect(info.parts.map((p) => p.part.state)).toEqual(['used', 'new'])
    // 背包裡兩個零件都用掉了
    expect(g.state.inventory.filter((s) => s.id === 'pt_barrel' || s.id === 'pt_action')).toEqual([])
  })

  it('全新的零件做出來的成品沒有 part_states 這一欄（和以前逐欄相同）；內容裡本來就是二手的零件也不寫（沒有和自己不同）', () => {
    const g = make()
    g.state.inventory.push({ id: 'pt_barrel', qty: 1 }, { id: 'pt_action', qty: 1 })
    g.commit(assembleDraft(g.k, g.state, { blueprint: 'bp_pistol', parts: { barrel: 'pt_barrel', action: 'pt_action' }, maker: 'shop' }))
    expect('part_states' in products(g)[0]!.data!).toBe(false)
    const h = make()
    h.state.inventory.push({ id: 'pt_barrel', qty: 1 }, { id: 'pt_old_action', qty: 1 })
    h.commit(assembleDraft(h.k, h.state, { blueprint: 'bp_pistol', parts: { barrel: 'pt_barrel', action: 'pt_old_action' }, maker: 'shop' }))
    expect('part_states' in products(h)[0]!.data!).toBe(false)
    expect(productOf(h.k.content, 'bp_pistol', products(h)[0]!.data)!.parts[1]!.part.state).toBe('used')
  })

  it('背包裡的二手件用 stackPart 讀得到二手（預覽選出來的零件狀態也是 used）', () => {
    const g = make()
    usedStack(g, 'pt_barrel', 'us1')
    expect(stackPart(g.k.content, g.state.inventory.find((s) => s.data?.uid === 'us1'))!.state).toBe('used')
  })
})

// ===================================================================================================================
describe('craft：換零件，狀態跟著那一格', () => {
  const newPistol = (g: G, extra: Rec = {}) => g.state.inventory.push({ id: 'bp_pistol', qty: 1, data: { uid: 'pr1', parts: { barrel: 'pt_barrel', action: 'pt_action' }, quality: 'standard', state: 'new', ...extra } })

  it('換上二手槍管：那一格的 part_states 是 used、價錢折了那一個零件；換下來的全新槍管變成二手回背包；再換上全新的就清掉', () => {
    const g = make()
    newPistol(g)
    usedStack(g, 'pt_barrel_ka', 'us1')
    const opts = { uid: 'pr1', type: 'barrel', part: 'us1', maker: 'shop' as const }
    const pv = swapPreview(g.k, g.state, opts)
    expect(pv.problems).toEqual([])
    expect(pv.before!.price).toBe(Math.round(400 * 1.2))
    expect(pv.after!.price).toBe(Math.round((100 + 200) * 1.2))
    g.commit(swapDraft(g.k, g.state, opts))
    const swapped = products(g)[0]!
    expect(swapped.data!.parts).toEqual({ barrel: 'pt_barrel_ka', action: 'pt_action' })
    expect(swapped.data!.part_states).toEqual({ barrel: ['used'] })
    expect(g.state.inventory.find((s) => s.id === 'pt_barrel' && s.data?.state === 'used')).toBeDefined()
    expect(productOf(g.k.content, 'bp_pistol', swapped.data)!.parts[0]!.part.state).toBe('used')
    // 再換上一支全新的：那一格清掉，不留 part_states
    g.state.inventory.push({ id: 'pt_barrel', qty: 1 })
    g.commit(swapDraft(g.k, g.state, { uid: 'pr1', type: 'barrel', part: 'pt_barrel', maker: 'shop' }))
    expect('part_states' in products(g)[0]!.data!).toBe(false)
    expect(productOf(g.k.content, 'bp_pistol', products(g)[0]!.data)!.parts.map((p) => p.part.state)).toEqual(['new', 'new'])
  })

  it('換的是別的槽：原本的二手狀態留在原位（不跟著跑到別的零件上）', () => {
    const g = make()
    newPistol(g, { part_states: { barrel: ['used'] } })
    g.state.inventory.push({ id: 'pt_action', qty: 1 })
    g.commit(swapDraft(g.k, g.state, { uid: 'pr1', type: 'action', part: 'pt_action', maker: 'shop' }))
    expect(products(g)[0]!.data!.part_states).toEqual({ barrel: ['used'] })
    expect(productOf(g.k.content, 'bp_pistol', products(g)[0]!.data)!.parts.map((p) => p.part.state)).toEqual(['used', 'new'])
  })
})

// ===================================================================================================================
describe('craft：拆解之後的零件回背包仍是二手（不受 part_states 影響）；拆下來再組回去，狀態又寫回成品', () => {
  it('成品的二手槍管拆下來是 used 的一疊；全部完好時拿去重組，part_states 又出現', () => {
    const g = make()
    g.state.flags.home_level = 2
    g.state.inventory.push({ id: 'bp_pistol', qty: 1, data: { uid: 'pr1', parts: { barrel: 'pt_barrel', action: 'pt_action' }, part_states: { barrel: ['used'] }, quality: 'standard', state: 'new' } })
    g.commit(arrive(g.k, g.state, 'b_shops', 'F1'))
    // 槍店有工作台（craft.by === shop）可以拆；骰面固定成 0（每個零件都完好）
    const spy = vi.spyOn(Rng.prototype, 'next').mockReturnValue(0)
    const d = salvageDraft(g.k, g.state, { uid: 'pr1' })
    spy.mockRestore()
    g.commit(d)
    const back = g.state.inventory.filter((s) => s.data?.state === 'used')
    expect(back.map((s) => s.id).sort()).toEqual(['pt_action', 'pt_barrel'])
    for (const s of back) expect(s.data!.uid).toMatch(/^us/)
    expect(products(g)).toEqual([])
    const opts = { blueprint: 'bp_pistol', parts: { barrel: back.find((s) => s.id === 'pt_barrel')!.data!.uid as string, action: back.find((s) => s.id === 'pt_action')!.data!.uid as string }, maker: 'shop' as const }
    g.commit(assembleDraft(g.k, g.state, opts))
    expect(products(g)[0]!.data!.part_states).toEqual({ barrel: ['used'], action: ['used'] })
    expect(productOf(g.k.content, 'bp_pistol', products(g)[0]!.data)!.parts.map((p) => p.part.state)).toEqual(['used', 'used'])
  })
})
