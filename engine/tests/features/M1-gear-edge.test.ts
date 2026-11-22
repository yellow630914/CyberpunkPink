// M1-gear 的補充單元測試：戰鬥結束時用掉的快取格、快取格變少、穿脫的細節、背包裡的東西不見了、內容格式、藏匿與掃描的邊界。
// 驗收測試是 M1-gear.test.ts；這裡補它沒有涵蓋的（工單第五節：戰鬥結束的那一段要自己補）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, ItemStack } from '../../src'
import { armorOf, concealment, equip, equipBlock, gearFeature, gearOf, scanFinds, unequip, weaponOf } from '../../src/features/gear'
import { characterFeature } from '../../src/features/character'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame, observed, playOut } from '../../src/testkit'

const SKILLS = ['firearms', 'brawl'].map((id) => ({ id, name: id, attr: id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'smg', name: '衝鋒槍', dice: 3, type: 'physical', range: [2, 5], mag: 3, cover_mult: 0.5, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]
const bp = (id: string, kind: string, more: Record<string, unknown>) => ({ id, kind, name: id, desc: `${id}。`, brand: 'starbelle', grade: 1, legal: 'register', price: 100, size: 1, weight: 1, require: [], optional: [], ...more })
const part = (id: string, type: string, grade: number, stats: Record<string, number> = {}, more: Record<string, unknown> = {}) => ({ id, name: id, type, material: 'mech', brand: 'starbelle', grade, price: 100, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new', ...more })
const item = (id: string, more: Record<string, unknown> = {}) => ({ id, name: id === 'it_medgel_1' ? '急救凝膠' : id === 'it_smoke' ? '煙霧彈' : id, desc: `${id}。`, category: 'consumable', grade: 1, size: 0, legal: 'free', ...more })
const PACK: ContentPack = {
  id: 'gear_edge',
  content: {
    skill: SKILLS, weapon_class: WEAPONS,
    blueprint: [
      bp('bp_pistol', 'weapon', { class: 'pistol', carry: 'side' }),
      bp('bp_smg', 'weapon', { class: 'smg', carry: 'main', size: 2 }),
      bp('bp_vest', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', quick: 2 }),
      bp('bp_helmet', 'armor', { armor: 1, covers: ['head'], weight_class: 'medium' }),
      bp('bp_cap', 'armor', { armor: 0, covers: ['head'], weight_class: 'light' }),
      bp('bp_hood', 'armor', { armor: 1, covers: ['head', 'outer'], weight_class: 'light' }),
      bp('bp_coat', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: 1 }),
      bp('bp_jacket', 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: 3 }),
      bp('bp_maid', 'armor', { armor: 1, covers: ['upper', 'lower'], weight_class: 'medium', conceal_add: 2 }),
      bp('bp_maid_coat', 'armor', { armor: 1, covers: ['upper', 'lower', 'outer'], weight_class: 'medium', conceal: 4, conceal_add: 2 }),
      bp('bp_heavy', 'armor', { armor: 1, covers: ['armor'], weight_class: 'heavy' }),
    ],
    part: [
      part('pt_barrel', 'barrel', 1), part('pt_plate_3', 'plate', 3, { armor: 3 }), part('pt_plate_1', 'plate', 1, { armor: 1 }),
      part('pt_ceramic', 'plate', 2, {}, { traits: ['scan_proof'] }), part('pt_shield', 'barrel', 2, {}, { traits: ['scan_proof'] }),
    ],
    item: [
      item('it_medgel_1', { use: { ap: 1, target: 'self', effects: [{ op: 'heal', amount: 8 }] } }), item('it_smoke'),
      item('it_belt', { category: 'accessory', tags: ['belt'], quick: 2 }), item('it_collar', { category: 'accessory', tags: ['acc:neck'] }),
    ],
  },
}
const made = (uid: string, blueprint: string, parts: Record<string, string | string[]> = {}): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts } })
const INVENTORY = (): ItemStack[] => [
  made('p1', 'bp_pistol', { barrel: 'pt_barrel' }), made('p2', 'bp_pistol', { barrel: 'pt_shield', plate: 'pt_ceramic' }), made('p3', 'bp_pistol'),
  made('s1', 'bp_smg', { barrel: 'pt_shield', plate: 'pt_ceramic' }), made('s2', 'bp_smg', { barrel: 'pt_barrel' }),
  made('v1', 'bp_vest', { plate: ['pt_plate_3', 'pt_plate_1'] }), made('h1', 'bp_helmet', { plate: 'pt_plate_1' }), made('h0', 'bp_cap'), made('hd', 'bp_hood', { plate: 'pt_plate_3' }),
  made('c1', 'bp_coat'), made('j1', 'bp_jacket'), made('m1', 'bp_maid'), made('m2', 'bp_maid_coat'), made('hv', 'bp_heavy', { plate: 'pt_plate_3' }),
  { id: 'it_medgel_1', qty: 6 }, { id: 'it_smoke', qty: 3 }, { id: 'it_belt', qty: 1 }, { id: 'it_collar', qty: 1 },
]
const setup = (inventory: ItemStack[] = INVENTORY()) => makeGame({ features: [characterFeature, gearFeature, TEST_COMBAT], content: [PACK], pc: { attrs: { reflex: 14 }, skills: { firearms: 2 } }, patch: { inventory } }).game
type G = ReturnType<typeof setup>
const wear = (g: G, what: string, slot?: string) => g.commit(equip(g.k, g.state, 'pc', what, slot))
const setQuick = (g: G, items: Array<{ item: string; qty: number }>) =>
  g.commit({ kind: 'system', action: 'gear.quick', location: {}, party: [], timeline: [], changes: [{ op: 'gear.quick', id: 'pc', items }], outcome: { result: 'ok', summary: '整理快取格。' } })
const invCount = (g: G, id: string) => g.state.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0)

describe('戰鬥結束：用掉的快取格（EQUIPMENT 4.1 節）', () => {
  // 開打前先放好快取格，開打之後直接改單位身上的快取格當成「打的時候用掉了」，再把戰鬥打完結束
  const run = async (quick: Array<{ item: string; qty: number }>, during: Array<{ item: string; qty: number }>) => {
    const game = setup()
    setQuick(game, quick)
    game.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    expect(game.battle!.units.a1!.quick).toEqual(quick)
    game.state.battle!.units.a1!.quick = during
    playOut(game)
    await game.finishBattle()
    return game
  }

  it('用掉的從背包扣掉，快取格改成剩下的，每一種用掉的東西一行', async () => {
    const game = await run([{ item: 'it_medgel_1', qty: 2 }], [{ item: 'it_medgel_1', qty: 1 }])
    expect(invCount(game, 'it_medgel_1')).toBe(5)
    expect(gearOf(game.state, 'pc').quick).toEqual([{ item: 'it_medgel_1', qty: 1 }])
    const end = game.state.reports.at(-1)!
    expect(end.action).toBe('battle.end')
    expect(end.narration?.results).toContain('用掉：急救凝膠 ×1')
    expect(end.changes).toContainEqual({ op: 'item', id: 'it_medgel_1', qty: -1 })
    expect(game.state.battle).toBeNull()
  })

  it('全部用完：快取格清空；兩種東西各一行、各自扣', async () => {
    const game = await run([{ item: 'it_medgel_1', qty: 2 }], [])
    expect(invCount(game, 'it_medgel_1')).toBe(4)
    expect(gearOf(game.state, 'pc').quick).toEqual([])

    const two = setup()
    wear(two, 'v1') // 快取格 4
    setQuick(two, [{ item: 'it_medgel_1', qty: 2 }, { item: 'it_smoke', qty: 2 }])
    two.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    two.state.battle!.units.a1!.quick = [{ item: 'it_medgel_1', qty: 1 }]
    playOut(two)
    await two.finishBattle()
    expect(two.state.reports.at(-1)!.narration?.results).toEqual(expect.arrayContaining(['用掉：急救凝膠 ×1', '用掉：煙霧彈 ×2']))
    expect([invCount(two, 'it_medgel_1'), invCount(two, 'it_smoke')]).toEqual([5, 1])
    expect(gearOf(two.state, 'pc').quick).toEqual([{ item: 'it_medgel_1', qty: 1 }])
  })

  it('沒有用掉東西的戰鬥：背包與快取格都不動，也不寫「用掉」', async () => {
    const quick = [{ item: 'it_medgel_1', qty: 2 }]
    const game = await run(quick, quick)
    expect(invCount(game, 'it_medgel_1')).toBe(6)
    expect(gearOf(game.state, 'pc').quick).toEqual(quick)
    expect(game.state.reports.at(-1)!.narration?.results?.some((l) => l.startsWith('用掉'))).toBe(false)
    expect(game.state.reports.at(-1)!.changes.some((c) => c.op === 'gear.quick')).toBe(false)
  })

  it('同一種東西分在兩格：用掉的從前面的那一格先扣', async () => {
    const game = await run([{ item: 'it_medgel_1', qty: 1 }, { item: 'it_smoke', qty: 1 }], [{ item: 'it_smoke', qty: 1 }])
    expect(gearOf(game.state, 'pc').quick).toEqual([{ item: 'it_smoke', qty: 1 }])
    expect(invCount(game, 'it_medgel_1')).toBe(5)
  })

  it('背包裡的東西已經不夠（中途賣掉了）：扣到 0 為止，結算不會壞掉', async () => {
    const game = setup()
    setQuick(game, [{ item: 'it_smoke', qty: 2 }])
    game.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    game.state.inventory = game.state.inventory.filter((s) => s.id !== 'it_smoke')
    game.state.battle!.units.a1!.quick = []
    playOut(game)
    await game.finishBattle()
    expect(invCount(game, 'it_smoke')).toBe(0)
    expect(gearOf(game.state, 'pc').quick).toEqual([])
  })

  it('敵人與沒有角色的單位不算；整個過程沒有違反提交的不變式', async () => {
    const game = setup()
    setQuick(game, [{ item: 'it_medgel_1', qty: 1 }])
    game.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] })
    for (const u of Object.values(game.state.battle!.units)) if (u.side === 'foe') u.quick = [{ item: 'it_smoke', qty: 9 }]
    playOut(game)
    const { violations } = await observed(game, () => game.finishBattle())
    expect(violations).toEqual([])
    expect(invCount(game, 'it_smoke')).toBe(3)
  })
})

describe('穿脫的細節', () => {
  it('脫下不在身上的東西丟錯；飾品同一種戴到背包裡的數量為止，頸再戴一次是換上去', () => {
    const g = setup()
    expect(() => unequip(g.k, g.state, 'pc', 'p1')).toThrow('這一件不在身上。')
    wear(g, 'it_belt')
    expect(equipBlock(g.k, g.state, 'pc', 'it_belt')).toBe('背包裡的這個飾品都已經戴上了。')
    wear(g, 'it_collar')
    expect(equipBlock(g.k, g.state, 'pc', 'it_collar')).toBeNull()
    wear(g, 'it_collar')
    expect(gearOf(g.state, 'pc').acc).toEqual({ any1: 'it_belt', neck: 'it_collar' })
    expect(g.undoSteps()).toBe(true)
    g.commit(unequip(g.k, g.state, 'pc', 'it_belt'))
    expect(gearOf(g.state, 'pc').acc).toEqual({ neck: 'it_collar' })
  })

  it('背包裡有東西但不是能穿的：說明原因；沒有這個東西：背包裡沒有', () => {
    const g = setup()
    expect(equipBlock(g.k, g.state, 'pc', 'it_medgel_1')).toBe('這一件不能穿戴。')
    expect(equipBlock(g.k, g.state, 'pc', 'it_nothing')).toBe('背包裡沒有這一件。')
    expect(() => equip(g.k, g.state, 'pc', 'it_nothing')).toThrow('背包裡沒有這一件。')
  })

  it('報告：不花時間、一句話；穿上自己已經穿著的那一件不出錯', () => {
    const g = setup()
    const before = g.state.time
    const reports = wear(g, 'v1')
    expect(reports[0]).toMatchObject({ action: 'gear.equip', kind: 'action', outcome: { summary: '穿上bp_vest。' } })
    expect(g.state.time).toEqual(before)
    wear(g, 'v1')
    expect(gearOf(g.state, 'pc').worn).toEqual({ armor: 'v1' })
    const off = g.commit(unequip(g.k, g.state, 'pc', 'v1'))
    expect(off[0]).toMatchObject({ action: 'gear.unequip', outcome: { summary: '脫下bp_vest。' } })
  })

  it('脫下戰術背心之後快取格變少：放不下的收回背包（東西還在背包裡），並寫在報告裡', () => {
    const g = setup()
    wear(g, 'v1')
    setQuick(g, [{ item: 'it_medgel_1', qty: 3 }, { item: 'it_smoke', qty: 1 }])
    const [r] = g.commit(unequip(g.k, g.state, 'pc', 'v1'))
    expect(gearOf(g.state, 'pc').quick).toEqual([{ item: 'it_medgel_1', qty: 2 }])
    expect(r!.timeline[0]!.text).toBe('快取格只剩 2 格，放不下的東西收回背包了。')
    expect(invCount(g, 'it_medgel_1')).toBe(6)
    expect(invCount(g, 'it_smoke')).toBe(3)
  })

  it('佔頭與外套的連身帽：換上去之後外套格的東西一起換下來；重甲只擋沒被換掉的外套', () => {
    const g = setup()
    wear(g, 'c1')
    wear(g, 'hd')
    expect(gearOf(g.state, 'pc').worn).toEqual({ head: 'hd', outer: 'hd' })
    wear(g, 'h0') // 帽子只佔頭：連身帽整件換下來，外套格也空了
    expect(gearOf(g.state, 'pc').worn).toEqual({ head: 'h0' })
    wear(g, 'hv')
    expect(equipBlock(g.k, g.state, 'pc', 'hd')).toBe('穿著重甲，不能再穿外套。')
    expect(equipBlock(g.k, g.state, 'pc', 'c1')).toBe('穿著重甲，不能再穿外套。')
  })

  it('穿脫之後的狀態通過提交的不變式', async () => {
    const g = setup()
    const { violations } = await observed(g, () => {
      for (const w of ['p1', 's1', 'v1', 'it_belt', 'c1']) wear(g, w)
      g.commit(unequip(g.k, g.state, 'pc', 's1'))
    })
    expect(violations).toEqual([])
  })

  it('變更自己擋下寫進去會壞掉的：放錯格、不在背包裡的東西', () => {
    const g = setup()
    const slot = (group: string, slotName: string, it: string | null) =>
      g.commit({ kind: 'system', action: 'gear.slot', location: {}, party: [], timeline: [], changes: [{ op: 'gear.slot', id: 'pc', group, slot: slotName, item: it }], outcome: { result: 'ok', summary: '測試。' } })
    expect(() => slot('carry', 'main', 'p1')).toThrow('這一件不能帶在這一格。')
    expect(() => slot('worn', 'upper', 'v1')).toThrow('這一件不能穿在這一格。')
    expect(() => slot('worn', 'armor', 'nope')).toThrow('背包裡沒有這一件。')
    expect(() => slot('acc', 'neck', 'it_medgel_1')).toThrow('這一件不是飾品。')
    expect(() => slot('worn', 'tail', null)).toThrow(/沒有 tail 這一格/)
    expect(() => slot('belt', 'main', null)).toThrow(/group 只能是/)
    expect(() => g.commit({ kind: 'system', action: 'gear.coat', location: {}, party: [], timeline: [], changes: [{ op: 'gear.coat', id: 'pc', coat: 'half' }], outcome: { result: 'ok', summary: '測試。' } })).toThrow(/coat 只能是/)
    expect(() => setQuick(g, [{ item: 'it_medgel_1', qty: 0 }])).toThrow(/qty 是 1 以上/)
    expect(() => setQuick(g, [{ item: 'it_smoke', qty: 2 }, { item: 'it_smoke', qty: 2 }])).toThrow(/快取格只有 2 格/)
    expect(() => setQuick(g, [{ item: 'it_smoke', qty: 1 }, { item: 'it_medgel_1', qty: 1 }])).not.toThrow()
    const poor = setup([{ id: 'it_smoke', qty: 1 }])
    expect(() => setQuick(poor, [{ item: 'it_smoke', qty: 2 }])).toThrow('背包裡的煙霧彈不夠 2 個。')
    expect(() => setQuick(poor, [{ item: 'it_smoke', qty: 1 }, { item: 'it_smoke', qty: 1 }])).toThrow('背包裡的煙霧彈不夠 2 個。')
  })
})

describe('背包裡的東西不見了、換了人', () => {
  it('穿著或帶著的東西已經不在背包裡：護甲、藏匿、掃描、戰鬥都略過它，不會丟錯', () => {
    const g = setup()
    wear(g, 'v1')
    wear(g, 'p1')
    expect(armorOf(g.k, g.state, 'pc')).toBe(4)
    g.state.inventory = g.state.inventory.filter((s) => s.data?.uid !== 'v1' && s.data?.uid !== 'p1')
    expect(armorOf(g.k, g.state, 'pc')).toBe(0)
    expect(concealment(g.k, g.state, 'pc')).toEqual({ capacity: 1, hidden: [], shown: [] })
    expect(scanFinds(g.k, g.state, 'pc', 3)).toEqual([])
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').weapons).toEqual([])
    expect(() => weaponOf(g.k, g.state, 'pc', 'p1')).toThrow('背包裡沒有這一件。')
  })

  it('weaponOf：不是武器、沒有這個角色都丟錯', () => {
    const g = setup()
    expect(() => weaponOf(g.k, g.state, 'pc', 'v1')).toThrow('這一件不是武器。')
    expect(() => weaponOf(g.k, g.state, 'nobody', 'p1')).toThrow('沒有 nobody 這個角色。')
  })

  it('沒有穿過東西的角色：護甲 0、藏匿量 1、什麼都掃不到；存檔裡壞掉的資料不會讓它出錯', () => {
    const g = setup()
    g.state.actors.pc!.ext.gear = { worn: { head: 3, nowhere: 'p1' }, acc: 'oops', carry: null, quick: [{ item: 'x', qty: -1 }, 'z'], coat: 'weird' }
    expect(gearOf(g.state, 'pc')).toEqual({ worn: {}, acc: {}, carry: {}, quick: [], coat: 'open' })
    expect(armorOf(g.k, g.state, 'pc')).toBe(0)
    expect(gearOf(g.state, 'nobody')).toEqual({ worn: {}, acc: {}, carry: {}, quick: [], coat: 'open' })
  })
})

describe('數字的邊界', () => {
  it('護甲：板材的一半加起來不是整數時捨去；頭盔的值是 0 不加；佔頭的連身帽不算在身體那一件', () => {
    const g = setup()
    wear(g, 'v1') // 基礎 1 ＋ 最好的 3 ＋ 另一塊的一半 0.5 = 4.5
    expect(armorOf(g.k, g.state, 'pc')).toBe(4)
    wear(g, 'h0') // 帽子的值是 0：不加
    expect(armorOf(g.k, g.state, 'pc')).toBe(4)
    wear(g, 'h1') // 頭盔 1 ＋ 1 = 2：加 1
    expect(armorOf(g.k, g.state, 'pc')).toBe(5)
    wear(g, 'hd') // 連身帽佔頭與外套：它是頭盔，不是身體那一件（1 ＋ 3 = 4 不拿去比）
    expect(armorOf(g.k, g.state, 'pc')).toBe(5)
    expect(g.k.stats.stat(g.state, 'pc', 'armor')).toBe(5)
  })

  it('藏匿量：外套的值很小、敞開時減半變 0，還是 1；掃描：沒有零件的當成掃得到，每個零件都防掃描才掃不到', () => {
    const g = setup()
    wear(g, 'c1')
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(1)
    wear(g, 'p3') // 沒有零件
    expect(scanFinds(g.k, g.state, 'pc', 2)).toEqual(['p3'])
    wear(g, 'p2') // 副武器換成：槍管與板材都防掃描
    expect(scanFinds(g.k, g.state, 'pc', 3)).toEqual([])
    wear(g, 's1') // 主武器：每個零件都防掃描
    expect(scanFinds(g.k, g.state, 'pc', 3)).toEqual([])
    wear(g, 'p1') // 有一個掃得到的零件：整件掃得到
    expect(scanFinds(g.k, g.state, 'pc', 1)).toEqual([]) // 大小 1：強度 1 不掃
    expect(scanFinds(g.k, g.state, 'pc', 2)).toEqual(['p1'])
    wear(g, 's2')
    expect(scanFinds(g.k, g.state, 'pc', 1)).toEqual(['s2']) // 大小 2：強度 1 就掃
    expect(scanFinds(g.k, g.state, 'pc', 3)).toEqual(['p1', 's2'])
  })

  it('藏匿量：內藏槽（conceal_add）疊在上面；短外套 3 ＋ 裝甲制服 2 ＝ 5，外套敞開只有外套那 3 減半：1 ＋ 2 ＝ 3', () => {
    const g = setup()
    wear(g, 'm1')
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(3) // 沒穿外套：基本 1 ＋ 內藏槽 2
    wear(g, 'j1')
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(3) // 敞開：(3 → 1) ＋ 2
    g.commit({ kind: 'system', action: 'gear.coat', location: {}, party: [], timeline: [], changes: [{ op: 'gear.coat', id: 'pc', coat: 'closed' }], outcome: { result: 'ok', summary: '把外套扣上。' } })
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(5) // 扣上：3 ＋ 2
    wear(g, 'c1') // 另一件外套把短外套換下來：conceal 1，內藏槽還在
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(3)
  })

  it('藏匿量：同一件既有 conceal 又有 conceal_add 時分開算；內藏槽換下來就沒了；多件內藏槽相加', () => {
    const g = setup()
    wear(g, 'm2') // 佔外套格：敞開 (4 → 2) 減半，內藏槽 2 不減半
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(4)
    g.commit({ kind: 'system', action: 'gear.coat', location: {}, party: [], timeline: [], changes: [{ op: 'gear.coat', id: 'pc', coat: 'closed' }], outcome: { result: 'ok', summary: '把外套扣上。' } })
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(6)
    g.commit(unequip(g.k, g.state, 'pc', 'm2'))
    expect(concealment(g.k, g.state, 'pc').capacity).toBe(1)
  })

  it('內海的戰鬥不帶槍：武器是構裝（M3）；快取格照帶', () => {
    const g = setup()
    wear(g, 'p1')
    setQuick(g, [{ item: 'it_medgel_1', qty: 1 }])
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'net')).toMatchObject({ weapons: [], quick: [{ item: 'it_medgel_1', qty: 1 }], armor: 0 })
    expect(g.k.battle.loadoutOf(g.state, 'pc', 'meat').weapons.map((w) => w.id)).toEqual(['p1'])
  })
})

describe('內容的格式', () => {
  const build = (extra: { blueprint?: unknown[]; part?: unknown[] }) => () => makeGame({ features: [gearFeature], content: [{ id: 'bad', content: { skill: SKILLS, weapon_class: WEAPONS, ...extra } as ContentPack['content'] }] })
  it('設計圖：欄位不對一律擋下，訊息寫出哪一個欄位', () => {
    expect(build({ blueprint: [bp('b', 'armor', { armor: 2, covers: ['upper'], weight_class: 'light' })] })).toThrow(/armor.*0 或 1/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: [], weight_class: 'light' })] })).toThrow(/covers/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['upper', 'upper'], weight_class: 'light' })] })).toThrow(/covers/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['tail'], weight_class: 'light' })] })).toThrow(/covers/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['upper'], weight_class: 'huge' })] })).toThrow(/weight_class/)
    expect(build({ blueprint: [bp('b', 'weapon', { class: 'pistol', carry: 'back' })] })).toThrow(/carry/)
    expect(build({ blueprint: [bp('b', 'weapon', { carry: 'main' })] })).toThrow(/class/)
    expect(build({ blueprint: [bp('b', 'weapon', { class: 'pistol', carry: 'main', size: 5 })] })).toThrow(/size/)
    expect(build({ blueprint: [bp('b', 'weapon', { class: 'pistol', carry: 'main', require: [{}] })] })).toThrow(/require\[0\]/)
    expect(build({ blueprint: [bp('b', 'cyber', {})] })).toThrow(/kind/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['upper'], weight_class: 'light', conceal: -1 })] })).toThrow(/conceal/)
  })
  it('設計圖：conceal_add 要是 0 以上的整數', () => {
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['upper'], weight_class: 'light', conceal_add: -2 })] })).toThrow(/conceal_add/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['upper'], weight_class: 'light', conceal_add: 1.5 })] })).toThrow(/conceal_add/)
    expect(build({ blueprint: [bp('b', 'armor', { armor: 1, covers: ['upper'], weight_class: 'light', conceal_add: 2 })] })).not.toThrow()
  })
  it('設計圖引用不存在的武器類型：載入時擋下', () => {
    expect(build({ blueprint: [bp('b', 'weapon', { class: 'railgun', carry: 'main' })] })).toThrow(/weapon_class\/railgun/)
  })
  it('零件：stats 要是數字、state 與 material 照表', () => {
    expect(build({ part: [part('p', 'barrel', 1, { damage: 'x' as never })] })).toThrow(/stats/)
    expect(build({ part: [part('p', 'barrel', 1, {}, { state: 'broken' })] })).toThrow(/state/)
    expect(build({ part: [part('p', 'barrel', 1, {}, { material: 'wood' })] })).toThrow(/material/)
    expect(build({ part: [part('p', 'barrel', 1, {}, { traits: [1] })] })).toThrow(/traits/)
    expect(build({ part: [part('p', 'barrel', 1, { damage: 1 }, { traits: ['scan_proof'] })] })).not.toThrow()
  })
})
