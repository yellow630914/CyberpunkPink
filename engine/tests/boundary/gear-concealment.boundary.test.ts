// 邊界測試：裝備的藏匿量與掃描（M1）。cpp-tester-boundary 寫的。
//
// 規格：EQUIPMENT 6.1 節（大小與藏匿量）、6.3 節（被掃到）；EQUIPMENT 第 4 節（攜帶格、快取格上限）；
// COMBAT_SYSTEM 第 4 節（護甲：不疊、頭盔最多 +1）；dev/work/M1-gear.md 第六節（藏匿量的算法，規格沒寫的地方的定案）。
//
// 邊界表（數值或條件｜範圍｜出處｜測的點）：
//   大小                0～4                           EQUIPMENT 6.1       每個大小 × 藏匿量；大小 4 藏不了（B012）
//   藏匿量的基本量      沒穿 1、短外套 3、長外套 5      EQUIPMENT 6.1       0（沒有外套）、1、3、5、6（最大）
//   外套敞開時減半      ⌊c ÷ 2⌋，不低於 1               EQUIPMENT 6.1       c = 0、1、2、3、5、6（奇數、偶數、零）
//   內藏槽              +2，疊在上面、不取最大、敞開不減半  EQUIPMENT 6.1     0 件、1 件、2 件
//   飾品                每個 +1，五格                    EQUIPMENT 6.1       0、1、5 個（最大組合）
//   藏好的條件          大小加起來 ≤ 藏匿量              EQUIPMENT 6.1       剛好等於、多 1、0 大小的永遠藏得好
//   掃描強度            0 不掃；1 只掃大小 ≥ 2 的武器；≥ 2 掃全部   EQUIPMENT 6.3   0、0.5、1、1.5、2、3、NaN、負數、Infinity
//   防掃描零件          每個零件都帶才掃不到；一個掃得到整件就掃得到   EQUIPMENT 6.3   0 個零件、全帶、差 1 個
//   生體件              掃不到                           EQUIPMENT 6.3       （B013）
//   快取格              2 ＋ 件的加成，上限 8            EQUIPMENT 4.1       7、8、9
//   護甲                不疊取最高，頭盔最多 +1，捨去      COMBAT_SYSTEM 第 4 節  最大組合
//
// 找到的 bug（B012、B013）的測試在 tests/pending/，這裡斷言規格和程式一致的部分。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ContentPack, GameState, ItemStack } from '../../src'
import { createKernel } from '../../src'
import { QUICK_MAX, armorOf, bodyArmorOf, concealment, gearFeature, quickCapacity, scanFinds } from '../../src/features/gear'
import { gearOf } from '../../src/features/gear'
import { makeState } from '../../src/testkit'

const SKILLS = ['firearms', 'brawl'].map((id) => ({ id, name: id, attr: id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const bp = (id: string, kind: string, more: Record<string, unknown> = {}) => ({ id, kind, name: id, desc: `${id}。`, brand: 'b', grade: 1, legal: 'free', price: 0, size: 1, weight: 1, require: [], optional: [], ...more })
const part = (id: string, type: string, stats: Record<string, number> = {}, more: Record<string, unknown> = {}) => ({ id, name: id, type, material: 'mech', brand: 'b', grade: 1, price: 0, legal: 'free', cells: 1, stats, weight: 1, size: 1, state: 'new', ...more })
const item = (id: string, more: Record<string, unknown> = {}) => ({ id, name: id, desc: `${id}。`, category: 'accessory', grade: 1, size: 0, legal: 'free', ...more })

const OUTER_CONCEAL = [0, 1, 2, 3, 4, 5, 6]
const PACK: ContentPack = {
  id: 'gear_boundary',
  content: {
    skill: SKILLS, weapon_class: WEAPONS,
    blueprint: [
      ...[0, 1, 2, 3, 4].map((s) => bp(`bp_w${s}`, 'weapon', { class: 'pistol', carry: 'side', size: s })),
      ...OUTER_CONCEAL.map((c) => bp(`bp_outer${c}`, 'armor', { armor: 0, covers: ['outer'], weight_class: 'light', conceal: c })),
      bp('bp_vest_conceal', 'armor', { armor: 0, covers: ['upper'], weight_class: 'light', conceal: 4 }),
      bp('bp_uniform', 'armor', { armor: 1, covers: ['armor'], weight_class: 'medium', conceal_add: 2 }),
      bp('bp_uniform2', 'armor', { armor: 0, covers: ['lower'], weight_class: 'light', conceal_add: 2 }),
      ...[0, 1, 2, 3, 4, 5].map((a) => bp(`bp_arm${a}`, 'armor', { armor: a > 1 ? 1 : a, covers: ['armor'], weight_class: 'medium', quick: a })),
      bp('bp_helmet', 'armor', { armor: 0, covers: ['head'], weight_class: 'light' }),
    ],
    part: [
      part('pt_proof', 'frame', {}, { traits: ['scan_proof'] }), part('pt_plain', 'barrel'), part('pt_bio', 'claw', {}, { material: 'bio', state: 'living' }),
      part('pt_plate1', 'plate', { armor: 1 }), part('pt_plate3', 'plate', { armor: 3 }), part('pt_fiber2', 'fiber', { armor: 2 }),
    ],
    item: [
      item('it_holster', { tags: ['acc:any'], conceal: 1 }), item('it_leg', { tags: ['acc:leg'], conceal: 1 }), item('it_neck', { tags: ['acc:neck'], conceal: 1 }), item('it_plain', { tags: ['acc:any'] }),
      item('it_bag', { tags: ['belt'], quick: 3 }),
    ],
  },
}
const kernel = () => { const k = createKernel([gearFeature]); k.content.loadPack(PACK); return k }
const made = (uid: string, blueprint: string, parts: Record<string, unknown> = {}): ItemStack => ({ id: blueprint, qty: 1, data: { uid, parts } })

interface Loadout {
  /** 外套：藏匿量（沒有就 null）與敞開或扣上 */
  outer: number | null
  coat: 'open' | 'closed'
  vest: boolean
  uniform: number // 裝甲制服的件數 0～2
  acc: Array<'it_holster' | 'it_leg' | 'it_neck' | 'it_plain'>
  /** 每一個攜帶格：武器的大小，零件是 proof（全帶防掃描）、plain（沒帶）、mixed（差 1 個）、none（沒有零件） */
  weapons: Array<{ slot: 'main' | 'side' | 'melee'; size: number; parts: 'proof' | 'plain' | 'mixed' | 'none' | 'bio' }>
}
const PARTS_OF: Record<string, Record<string, unknown>> = { proof: { frame: 'pt_proof', barrel: 'pt_proof' }, plain: { frame: 'pt_plain' }, mixed: { frame: 'pt_proof', barrel: 'pt_plain' }, none: {}, bio: { claw: 'pt_bio' } }

/** 把一份配置寫進狀態（直接寫 ext.gear 與背包，不經過穿脫的規則：這裡要測的是算出來的數字）。 */
function build(l: Loadout): { k: ReturnType<typeof kernel>; state: GameState } {
  const k = kernel()
  const state = makeState()
  const inv: ItemStack[] = []
  const gear = { worn: {} as Record<string, string>, acc: {} as Record<string, string>, carry: {} as Record<string, string>, quick: [], coat: l.coat }
  if (l.outer !== null) { inv.push(made('outer', `bp_outer${l.outer}`)); gear.worn.outer = 'outer' }
  if (l.vest) { inv.push(made('vest', 'bp_vest_conceal')); gear.worn.upper = 'vest' }
  if (l.uniform >= 1) { inv.push(made('uni', 'bp_uniform')); gear.worn.armor = 'uni' }
  if (l.uniform >= 2) { inv.push(made('uni2', 'bp_uniform2')); gear.worn.lower = 'uni2' }
  const slots = ['neck', 'leg', 'any1', 'any2', 'any3'] as const
  l.acc.forEach((id, i) => { inv.push({ id, qty: 1 }); gear.acc[slots[i]!] = id })
  l.weapons.forEach((w, i) => {
    inv.push(made(`w${i}`, `bp_w${w.size}`, PARTS_OF[w.parts]))
    gear.carry[w.slot] = `w${i}`
  })
  state.inventory = inv
  state.actors.pc!.ext.gear = gear
  return { k, state }
}

const loadoutArb: fc.Arbitrary<Loadout> = fc.record({
  outer: fc.option(fc.constantFrom(...OUTER_CONCEAL), { nil: null }),
  coat: fc.constantFrom<'open' | 'closed'>('open', 'closed'),
  vest: fc.boolean(),
  uniform: fc.integer({ min: 0, max: 2 }),
  acc: fc.array(fc.constantFrom<'it_holster' | 'it_leg' | 'it_neck' | 'it_plain'>('it_holster', 'it_leg', 'it_neck', 'it_plain'), { maxLength: 5 }),
  weapons: fc.uniqueArray(fc.record({ slot: fc.constantFrom<'main' | 'side' | 'melee'>('main', 'side', 'melee'), size: fc.integer({ min: 0, max: 3 }), parts: fc.constantFrom<'proof' | 'plain' | 'mixed' | 'none'>('proof', 'plain', 'mixed', 'none') }), { selector: (w) => w.slot, maxLength: 3 }),
})

/** 藏匿量：規格的表，另外寫一份（敞開的外套減半取整、至少 1；內藏槽疊上去；飾品每個照自己的值）。 */
function capacityOracle(l: Loadout): number {
  const parts: number[] = []
  if (l.outer !== null && l.outer > 0) parts.push(l.coat === 'open' ? Math.floor(l.outer / 2) : l.outer)
  if (l.vest) parts.push(4)
  const base = Math.max(0, ...parts) || 1
  return base + (l.uniform >= 1 ? 2 : 0) + (l.uniform >= 2 ? 2 : 0) + l.acc.filter((a) => a !== 'it_plain').length
}

describe('邊界 EQUIPMENT 6.1：藏匿量', () => {
  it('性質：藏匿量 = 基本量（身上最大的那件，外套敞開減半、至少 1）＋ 內藏槽 ＋ 飾品；至少 1', () => {
    fc.assert(fc.property(loadoutArb, (l) => {
      const { k, state } = build(l)
      const c = concealment(k, state, 'pc')
      expect(c.capacity).toBe(capacityOracle(l))
      expect(c.capacity).toBeGreaterThanOrEqual(1)
    }), { numRuns: 300 })
  })

  it('性質：藏好的 ＋ 露在外面的 = 攜帶格裡的全部武器（不重複）；藏好的大小加起來 ≤ 藏匿量；放不下的每一件加進去都會超過', () => {
    fc.assert(fc.property(loadoutArb, (l) => {
      const { k, state } = build(l)
      const c = concealment(k, state, 'pc')
      const sizeOf = (uid: string) => l.weapons[Number(uid.slice(1))]!.size
      const all = l.weapons.map((_, i) => `w${i}`).sort()
      expect([...c.hidden, ...c.shown].sort()).toEqual(all)
      expect(new Set([...c.hidden, ...c.shown]).size).toBe(all.length)
      const used = c.hidden.reduce((n, u) => n + sizeOf(u), 0)
      expect(used).toBeLessThanOrEqual(c.capacity)
      for (const u of c.shown) expect(used + sizeOf(u), `${u} 放得進去卻露在外面`).toBeGreaterThan(c.capacity)
      // 大小 0 的永遠藏得好
      for (const w of l.weapons.map((x, i) => ({ ...x, uid: `w${i}` }))) if (w.size === 0) expect(c.hidden).toContain(w.uid)
      expect([...c.hidden]).toEqual([...c.hidden].sort())
      expect([...c.shown]).toEqual([...c.shown].sort())
    }), { numRuns: 300 })
  })

  it('性質：外套扣上的藏匿量 ≥ 敞開的（敞開只會減、不會加）；攜帶格裡放什麼武器不影響藏匿量', () => {
    const capOf = (l: Loadout) => { const b = build(l); return concealment(b.k, b.state, 'pc').capacity }
    fc.assert(fc.property(loadoutArb, (l) => {
      expect(capOf({ ...l, coat: 'closed' })).toBeGreaterThanOrEqual(capOf({ ...l, coat: 'open' }))
      expect(capOf({ ...l, weapons: [] })).toBe(capOf(l))
    }), { numRuns: 100 })
  })

  it('規格的表：沒穿外套 1；短外套 3；長外套 5；各加上內藏槽 +2、五個飾品 +5：最大組合 5 ＋ 2 ＋ 2 ＋ 5 = 14（外套扣上）', () => {
    const cap = (l: Partial<Loadout>) => { const b = build({ outer: null, coat: 'closed', vest: false, uniform: 0, acc: [], weapons: [], ...l }); return concealment(b.k, b.state, 'pc').capacity }
    expect(cap({})).toBe(1)
    expect(cap({ outer: 3 })).toBe(3)
    expect(cap({ outer: 5 })).toBe(5)
    expect(cap({ outer: 5, uniform: 1 })).toBe(7)
    expect(cap({ acc: ['it_holster'] })).toBe(2)
    expect(cap({ outer: 5, uniform: 2, acc: ['it_holster', 'it_leg', 'it_neck', 'it_holster', 'it_holster'] })).toBe(14)
    // 沒有藏匿量的飾品加 0
    expect(cap({ outer: 5, acc: ['it_plain', 'it_plain'] })).toBe(5)
  })

  it('外套敞開時減半（無條件捨去、至少 1）：藏匿量 0、1、2、3、4、5、6 → 1、1、1、1、2、2、3；扣上照原值（0 的是 1）；內藏槽不減半', () => {
    const open = [0, 1, 2, 3, 4, 5, 6].map((c) => { const b = build({ outer: c, coat: 'open', vest: false, uniform: 0, acc: [], weapons: [] }); return concealment(b.k, b.state, 'pc').capacity })
    expect(open).toEqual([1, 1, 1, 1, 2, 2, 3])
    const closed = [0, 1, 2, 3, 4, 5, 6].map((c) => { const b = build({ outer: c, coat: 'closed', vest: false, uniform: 0, acc: [], weapons: [] }); return concealment(b.k, b.state, 'pc').capacity })
    expect(closed).toEqual([1, 1, 2, 3, 4, 5, 6])
    const withUniform = build({ outer: 5, coat: 'open', vest: false, uniform: 1, acc: [], weapons: [] })
    expect(concealment(withUniform.k, withUniform.state, 'pc').capacity).toBe(2 + 2)
  })

  it('藏好的邊：藏匿量 3 的外套扣上，大小 1＋2 剛好藏好、1＋2＋0 還是、1＋3 放不下露出來；大小 0 的永遠藏得好', () => {
    const run = (sizes: number[]) => {
      const slots = ['main', 'side', 'melee'] as const
      const b = build({ outer: 3, coat: 'closed', vest: false, uniform: 0, acc: [], weapons: sizes.map((size, i) => ({ slot: slots[i]!, size, parts: 'plain' as const })) })
      return concealment(b.k, b.state, 'pc')
    }
    expect(run([1, 2])).toMatchObject({ hidden: ['w0', 'w1'], shown: [] })
    expect(run([1, 2, 0])).toMatchObject({ hidden: ['w0', 'w1', 'w2'], shown: [] })
    expect(run([1, 3])).toMatchObject({ hidden: ['w0'], shown: ['w1'] })
    expect(run([3, 3])).toMatchObject({ hidden: ['w0'], shown: ['w1'] }) // 一樣大照 uid 的順序
    expect(run([0, 0, 0]).shown).toEqual([])
    expect(run([])).toEqual({ capacity: 3, hidden: [], shown: [] })
  })
})

describe('邊界 EQUIPMENT 6.3：掃描', () => {
  const weaponsOf = (specs: Array<[number, Loadout['weapons'][number]['parts']]>): Loadout => {
    const slots = ['main', 'side', 'melee'] as const
    return { outer: null, coat: 'closed', vest: false, uniform: 0, acc: [], weapons: specs.map(([size, parts], i) => ({ slot: slots[i]!, size, parts })) }
  }
  const scan = (l: Loadout, strength: number) => { const b = build(l); return scanFinds(b.k, b.state, 'pc', strength) }

  it('強度的邊：0 不掃；0.5、−1、NaN 不到 1 不掃；1 只掃大小 ≥ 2；1.5 同 1；2、3、Infinity 掃全部', () => {
    const l = weaponsOf([[1, 'plain'], [2, 'plain'], [3, 'plain']])
    expect(scan(l, 0)).toEqual([])
    for (const s of [0.5, 0.999, -1, Number.NaN, -Infinity]) expect(scan(l, s), String(s)).toEqual([])
    for (const s of [1, 1.5, 1.999]) expect(scan(l, s), String(s)).toEqual(['w1', 'w2'])
    for (const s of [2, 3, 10, Infinity]) expect(scan(l, s), String(s)).toEqual(['w0', 'w1', 'w2'])
  })

  it('防掃描零件：每個零件都帶才掃不到；差一個就掃得到；沒有零件的當成掃得到', () => {
    const l = weaponsOf([[2, 'proof'], [2, 'mixed'], [2, 'none']])
    expect(scan(l, 2)).toEqual(['w1', 'w2'])
    expect(scan(l, 1)).toEqual(['w1', 'w2'])
  })

  it('性質：強度越高掃到的越多（單調）；掃到的都是攜帶格裡的武器；強度 1 掃到的 = 強度 2 掃到的裡面大小 ≥ 2 的；全是防掃描零件的永遠掃不到', () => {
    const weaponArb = fc.uniqueArray(fc.record({ slot: fc.constantFrom<'main' | 'side' | 'melee'>('main', 'side', 'melee'), size: fc.integer({ min: 0, max: 3 }), parts: fc.constantFrom<'proof' | 'plain' | 'mixed' | 'none'>('proof', 'plain', 'mixed', 'none') }), { selector: (w) => w.slot, maxLength: 3 })
    fc.assert(fc.property(weaponArb, (weapons) => {
      const l: Loadout = { outer: null, coat: 'closed', vest: false, uniform: 0, acc: [], weapons }
      const b = build(l)
      const found = (s: number) => scanFinds(b.k, b.state, 'pc', s)
      const [s0, s1, s2, s3] = [found(0), found(1), found(2), found(3)]
      expect(s0).toEqual([])
      expect(s1.every((u) => s2.includes(u))).toBe(true)
      expect(s3).toEqual(s2)
      const sizeOf = (uid: string) => weapons[Number(uid.slice(1))]!.size
      const proof = (uid: string) => weapons[Number(uid.slice(1))]!.parts === 'proof'
      expect(s2).toEqual(weapons.map((_, i) => `w${i}`).filter((u) => !proof(u)).sort())
      expect(s1).toEqual(s2.filter((u) => sizeOf(u) >= 2))
    }), { numRuns: 200 })
  })
})

describe('邊界 EQUIPMENT 4.1／COMBAT_SYSTEM 第 4 節：快取格與護甲', () => {
  const wearing = (worn: Record<string, string>, inv: ItemStack[], acc: Record<string, string> = {}) => {
    const k = kernel()
    const state = makeState()
    state.inventory = [...inv, ...Object.values(acc).map((id) => ({ id, qty: 1 }))]
    state.actors.pc!.ext.gear = { worn, acc, carry: {}, quick: [], coat: 'closed' }
    return { k, state }
  }

  it('快取格：2 ＋ 身上件的加成 ＋ 飾品的加成，最多 8；7、8、9 的交界', () => {
    const q = (a: number, bag = 0) => {
      const w = wearing({ armor: 'a' }, [made('a', `bp_arm${a}`)], bag ? { any1: 'it_bag' } : {})
      return quickCapacity(w.k, w.state, gearOf(w.state, 'pc'))
    }
    expect([0, 1, 2, 3, 4, 5].map((a) => q(a))).toEqual([2, 3, 4, 5, 6, 7])
    expect(q(5, 1)).toBe(QUICK_MAX) // 2 + 5 + 3 = 10 → 夾在 8
    expect(q(4, 1)).toBe(QUICK_MAX) // 2 + 4 + 3 = 9 → 夾在 8（上限 +1）
    expect(q(3, 1)).toBe(QUICK_MAX) // 2 + 3 + 3 = 8 剛好
    expect(q(2, 1)).toBe(7) // 2 + 2 + 3 = 7（上限 −1）
  })

  it('性質：護甲 = ⌊身上最高的一件（不疊）＋ 頭盔的 1⌋；沒有帶板材的頭盔不加；軀幹的份不含頭盔', () => {
    fc.assert(fc.property(fc.constantFrom('pt_plate1', 'pt_plate3', 'pt_fiber2', null), fc.constantFrom('pt_plate1', 'pt_plate3', null), fc.boolean(), fc.boolean(), (bodyPart, helmetPart, uniform, helmetOn) => {
      const inv: ItemStack[] = [made('arm', 'bp_arm1', bodyPart ? { [bodyPart.startsWith('pt_plate') ? 'plate' : 'fiber']: bodyPart } : {}), made('uni', 'bp_uniform'), made('he', 'bp_helmet', helmetPart ? { plate: helmetPart } : {})]
      const worn: Record<string, string> = { armor: 'arm' }
      if (uniform) worn.lower = 'uni' // 同一件設計圖不重複；這裡只是多穿一件基礎 0 的
      if (helmetOn) worn.head = 'he'
      const w = wearing(worn, inv)
      const plate = (id: string | null) => (id === 'pt_plate1' ? 1 : id === 'pt_plate3' ? 3 : id === 'pt_fiber2' ? 2 : 0)
      const bodyV = 1 + plate(bodyPart) // 設計圖的基礎 1
      const uniV = uniform ? 1 : 0 // bp_uniform 的基礎是 1，沒有零件
      const body = Math.max(bodyV, uniV)
      const helmet = helmetOn && plate(helmetPart) > 0 ? 1 : 0
      expect(armorOf(w.k, w.state, 'pc')).toBe(Math.floor(body + helmet))
      expect(bodyArmorOf(w.k, w.state, 'pc')).toBe(Math.floor(body))
    }), { numRuns: 100 })
  })
})
