// 邊界測試：武器的表、傷害類型的骰數與護甲、彈匣（M1）。cpp-tester-boundary 寫的。
//
// 規格：COMBAT_SYSTEM 第 4 節（護甲、電磁與熱能的武器少一顆骰）、第 5 節（武器表、槍管的等級骰、彈匣、連射、掃射、
// 傷害類型的五種）；ENEMIES 1.5 節（武器骰：基礎 +N 顆）；dev/adr/0014（傷害類型的 dice 欄位）。
//
// 邊界表（數值或條件｜範圍｜出處｜測的點）：
//   武器表            11 列的骰數、距離、彈匣、遮蔽倍率、穿甲   COMBAT_SYSTEM 第 5 節   每一列照規格的表（另寫一份）
//   槍管的等級骰       I、II 0；III +1；IV +2；V +3          第 5 節／ENEMIES 1.5   等級 0、1、2、3、4、5、6
//   霰彈的距離骰       距離 1～2 是 5d6、3 以上 3d6           第 5 節                距離 2 與 3
//   傷害骰            基礎 ＋ 類型（熱能、電磁 −1）＋ 要害 +1，最少 1    第 4 節       基礎 1 的熱能（不低於 1）、要害、組合
//   護甲              max(0, 傷害 − max(0, 護甲 − 穿甲))；物理照扣、熱能無視一半、電磁不看、神經與快感打感載   第 4、5 節   穿甲 0、= 護甲、> 護甲
//   電磁              對機器加倍；神經與快感對沒有橋的無效；快感另加沉溺 +1   第 5 節   有橋、沒橋
//   彈匣              1～4 格；射擊花 1、掃射花 2（要有 2 格）、換彈補滿；不會是負的   第 5 節   0、1、容量、容量 +1
//   狙擊槍的一槍       3 點行動點                              第 5 節

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BattleUnit, DamageType } from '../../src'
import { CORE_PACK } from '../../data'
import { BattleRun, clone, createKernel, gradeDice } from '../../src'
import { allFeatures } from '../../src/features'
import { combatFeature } from '../../src/features/combat'
import { TEST_WEAPONS, enemyUnit, makeBattleGame, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

// ---------------------------------------------------------------------------------------------
// 1. 武器表與槍管的等級骰

/** COMBAT_SYSTEM 第 5 節的表，另寫一份：[骰數, 距離, 彈匣, 遮蔽倍率, 穿甲, 類型] */
const SPEC_WEAPONS: Record<string, { dice: number; range: [number, number]; mag?: number; cover: number; pierce: number; type: DamageType; far?: { beyond: number; dice: number } }> = {
  melee: { dice: 3, range: [1, 1], cover: 0, pierce: 0, type: 'physical' },
  shotgun: { dice: 5, range: [1, 3], mag: 2, cover: 1.5, pierce: 0, type: 'physical', far: { beyond: 2, dice: 3 } },
  pistol: { dice: 3, range: [1, 4], mag: 2, cover: 0.25, pierce: 0, type: 'physical' },
  smg: { dice: 3, range: [2, 5], mag: 3, cover: 0.5, pierce: 0, type: 'physical' },
  rifle: { dice: 4, range: [3, 7], mag: 3, cover: 0.5, pierce: 2, type: 'physical' },
  sniper: { dice: 6, range: [5, 7], mag: 1, cover: 0.25, pierce: 4, type: 'physical' },
  lmg: { dice: 4, range: [3, 6], mag: 4, cover: 1, pierce: 0, type: 'physical' },
  heavy: { dice: 7, range: [3, 7], mag: 1, cover: 2, pierce: 0, type: 'physical' },
  neural_gun: { dice: 3, range: [2, 5], mag: 2, cover: 0, pierce: 0, type: 'neural' },
  neural_melee: { dice: 2, range: [1, 2], cover: 0, pierce: 0, type: 'neural' },
}

describe('邊界 COMBAT_SYSTEM 第 5 節：武器表', () => {
  const k = createKernel(allFeatures())
  k.content.loadPack(CORE_PACK)
  const classes = new Map((CORE_PACK.content.weapon_class as unknown as Array<{ id: string }>).map((c) => [c.id, c as never as Record<string, unknown>]))

  it('資料裡每一種武器的骰數、適用距離、彈匣、遮蔽倍率、穿甲、傷害類型都和規格的表一樣（沒有彈匣的不寫）', () => {
    for (const [id, want] of Object.entries(SPEC_WEAPONS)) {
      const c = classes.get(id)
      expect(c, id).toBeDefined()
      expect(c!.dice, `${id} 骰數`).toBe(want.dice)
      expect(c!.range, `${id} 距離`).toEqual(want.range)
      expect(c!.mag, `${id} 彈匣`).toBe(want.mag)
      expect(c!.cover_mult, `${id} 遮蔽倍率`).toBe(want.cover)
      expect(c!.pierce, `${id} 穿甲`).toBe(want.pierce)
      expect(c!.type, `${id} 類型`).toBe(want.type)
      expect(c!.far, `${id} 遠距骰`).toEqual(want.far)
    }
    expect(classes.get('sniper')!.ap).toBe(3) // 一槍 3 點行動點
    for (const c of classes.values()) if (c.mag !== undefined) { expect(c.mag).toBeGreaterThanOrEqual(1); expect(c.mag).toBeLessThanOrEqual(4) }
  })

  it('測試用的武器表（testkit）和規格一致：testWeapon 的基礎骰、遠距骰、彈匣、距離、穿甲', () => {
    for (const [id, w] of Object.entries(TEST_WEAPONS)) {
      const want = SPEC_WEAPONS[w.class]
      expect(want, id).toBeDefined()
      expect(w.dice, id).toBe(want!.dice)
      expect(w.range, id).toEqual(want!.range)
      expect(w.coverMult, id).toBe(want!.cover)
      if (id !== 'knife') expect(w.pierce, id).toBe(want!.pierce) // 測試用的刀穿甲 1（「穿甲看武器」，不是類型的基礎）
      expect(w.mag?.max, id).toBe(want!.mag)
    }
  })

  it('槍管的等級骰：I、II 級 +0、III +1、IV +2、V +3；等級 0 與負數夾成 I、6 以上夾成 V、小數無條件捨去', () => {
    expect([1, 2, 3, 4, 5].map(gradeDice)).toEqual([0, 0, 1, 2, 3])
    expect([0, -4, 6, 99, Infinity, 2.9, 3.99, 4.5].map(gradeDice)).toEqual([0, 0, 3, 3, 3, 0, 1, 2])
  })

  it('性質：testWeapon 的骰數 = 基礎 ＋ 等級骰（遠距的骰也加）', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(TEST_WEAPONS)), fc.integer({ min: 0, max: 3 }), (id, extra) => {
      const w = testWeapon(id, 3, extra)
      expect(w.dice).toBe(TEST_WEAPONS[id]!.dice + extra)
      if (w.far) expect(w.far.dice).toBe(TEST_WEAPONS[id]!.far!.dice + extra)
    }))
  })

  it('敵人的武器骰（ENEMIES 1.5）：基礎 ＋ 等級骰；打感載的神經武器：雜兵 4、精英 6、首領 11 顆加等級骰（enemyUnit 的測試版與規格一致）', () => {
    for (const [rank, base] of [['minion', 4], ['elite', 6], ['boss', 11]] as const) {
      for (const grade of [1, 2, 3, 4, 5] as const) {
        const u = enemyUnit(rank, grade, { capture: true })
        const w = u.weapons.find((x) => x.type === 'neural')
        if (!w) continue // 測試版的敵人帶什麼武器不是這一條要測的
        expect(w.dice, `${rank} ${grade}`).toBe(base + gradeDice(grade))
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 傷害類型：骰數與護甲

/** 把 run 的骰面改成「記下要擲幾顆」：d20 先給 d20 的值，其餘的 d6 每一顆都是 face。 */
function counting(run: BattleRun, d20: number, face = 3) {
  const asked: number[] = []
  run.roll = (count: number, sides: number) => {
    if (sides === 20) return Array.from({ length: count }, () => d20)
    asked.push(count)
    return Array.from({ length: count }, () => face)
  }
  run.rand = () => 0.5
  return asked
}

describe('邊界 COMBAT_SYSTEM 第 4、5 節：傷害骰的顆數', () => {
  /** 我方第 1 格一把武器、距離 dist 的敵人（精英，不會多一顆重創骰）；武器的 hit 很高（一定要害）或很低（只靠自然 20 命中，不是要害） */
  const shot = (o: { weapon: ReturnType<typeof testWeapon>; type?: DamageType; natural?: number; dist?: number }) => {
    const a = arena(duel([one({ weapon: 'pistol', weapons: [o.weapon] })], [foe('elite', { hp: { now: 999, max: 999 }, armor: 0, evade: 10 })]))
    const run = new BattleRun(a.k, a.state, a.battle)
    const asked = counting(run, o.natural ?? 20)
    const me = run.unit('a1')
    if (o.dist) a.battle.units.f1!.slot = o.dist
    const r = run.attack(me, run.unit('f1'), { ...(o.type ? { type: o.type } : {}), spend: 0 })
    return { dice: asked[0]!, r }
  }

  it('各類型的骰數（基礎 3d6 的手槍，只靠自然 20 命中、不是要害）：物理 3、熱能 2、電磁 2、神經 3、快感 3', () => {
    const w = () => testWeapon('pistol', -50)
    expect(shot({ weapon: w() }).dice).toBe(3)
    expect(shot({ weapon: w(), type: 'physical' }).dice).toBe(3)
    expect(shot({ weapon: w(), type: 'thermal' }).dice).toBe(2)
    expect(shot({ weapon: w(), type: 'em' }).dice).toBe(2)
    expect(shot({ weapon: w(), type: 'neural' }).dice).toBe(3)
    expect(shot({ weapon: w(), type: 'pleasure' }).dice).toBe(3)
  })

  it('要害多一顆；不是要害的命中不多（差 4 不是、差 5 是）；熱能與電磁最少還是 1 顆', () => {
    // 迴避 10；自然 20 加 hit：total = 20 + hit，差 = 10 + hit。差 4 → hit −6；差 5 → hit −5
    expect(shot({ weapon: testWeapon('pistol', -6) }).r.crit).toBe(false)
    expect(shot({ weapon: testWeapon('pistol', -6) }).dice).toBe(3)
    expect(shot({ weapon: testWeapon('pistol', -5) }).r.crit).toBe(true)
    expect(shot({ weapon: testWeapon('pistol', -5) }).dice).toBe(4)
    expect(shot({ weapon: testWeapon('pistol', -5), type: 'em' }).dice).toBe(3)
    // 基礎只有 1 顆的武器打熱能：1 − 1 = 0，最少 1
    const one_ = { ...testWeapon('pistol', -50), dice: 1 }
    expect(shot({ weapon: one_, type: 'thermal' }).dice).toBe(1)
    expect(shot({ weapon: { ...one_, dice: 2 }, type: 'thermal' }).dice).toBe(1)
    expect(shot({ weapon: { ...one_, dice: 3 }, type: 'em' }).dice).toBe(2)
  })

  it('霰彈槍：距離 1～2 是 5d6，距離 3 起是 3d6（再加等級骰）', () => {
    const sg = (extra: number) => testWeapon('shotgun', -50, extra)
    expect([1, 2, 3].map((dist) => shot({ weapon: sg(0), dist }).dice)).toEqual([5, 5, 3])
    expect([1, 2, 3].map((dist) => shot({ weapon: sg(2), dist }).dice)).toEqual([7, 7, 5])
  })

  it('性質：任何基礎骰（1～12）、類型、要害與否、等級骰：骰數 = max(1, 基礎 ＋ 類型 ＋ 要害)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), fc.constantFrom<DamageType>('physical', 'thermal', 'em', 'neural', 'pleasure'), fc.boolean(), (base, type, crit) => {
      const w = { ...testWeapon('pistol', crit ? 100 : -50), dice: base }
      const typeDice = type === 'thermal' || type === 'em' ? -1 : 0
      expect(shot({ weapon: w, type }).dice).toBe(Math.max(1, base + typeDice + (crit ? 1 : 0)))
    }))
  })
})

describe('邊界 COMBAT_SYSTEM 第 4、5 節：護甲、穿甲與傷害類型', () => {
  const unitWith = (o: Partial<BattleUnit>) => {
    const a = arena(duel([one()], [foe('elite', { hp: { now: 9999, max: 9999 }, armor: 0, dmgMult: { hp: 1, load: 1 }, ...o })]))
    return { a, run: new BattleRun(a.k, a.state, a.battle) }
  }

  it('性質：物理 = max(0, 傷害 − max(0, 護甲 − 穿甲))；穿甲只抵銷護甲，多的不變成傷害', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 }), (raw, armor, pierce) => {
      const { run, a } = unitWith({ armor })
      const t = a.foe(1)
      const r = run.damage(t, raw, 'physical', undefined, { pierce })
      expect(r.dealt).toBe(Math.max(0, raw - Math.max(0, armor - pierce)))
      expect(r.dealt).toBeLessThanOrEqual(raw)
      expect(t.hp!.now).toBe(9999 - r.dealt)
    }))
  })

  it('性質：熱能無視一半護甲（⌊護甲 ÷ 2⌋），電磁不看護甲，穿甲照樣只抵銷剩下的護甲', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 }), (raw, armor, pierce) => {
      const th = unitWith({ armor })
      expect(th.run.damage(th.a.foe(1), raw, 'thermal', undefined, { pierce }).dealt).toBe(Math.max(0, raw - Math.max(0, Math.floor(armor / 2) - pierce)))
      const em = unitWith({ armor })
      expect(em.run.damage(em.a.foe(1), raw, 'em', undefined, { pierce }).dealt).toBe(raw)
    }))
  })

  it('電磁對機器（machine 標籤）加倍，對人不加倍；加倍在護甲之後（護甲不看，所以就是 ×2）', () => {
    const human = unitWith({ armor: 5 })
    expect(human.run.damage(human.a.foe(1), 10, 'em').dealt).toBe(10)
    const machine = unitWith({ armor: 5, tags: ['machine'] })
    expect(machine.run.damage(machine.a.foe(1), 10, 'em').dealt).toBe(20)
    expect(machine.run.damage(machine.a.foe(1), 10, 'physical').dealt).toBe(5)
  })

  it('神經與快感打感載、不看護甲；沒有橋的目標（沒有感載這一條）無效；快感另外讓沉溺 +1（有橋、有打進去才算）', () => {
    const bridged = unitWith({ armor: 9, load: { now: 0, max: 100 }, sensitivity: 50 })
    const n = bridged.run.damage(bridged.a.foe(1), 10, 'neural')
    expect(n).toEqual({ dealt: 10, track: 'load' })
    expect(bridged.a.foe(1).hp!.now).toBe(9999)
    expect(bridged.a.foe(1).sink).toBe(0)
    const p = bridged.run.damage(bridged.a.foe(1), 10, 'pleasure')
    expect(p.track).toBe('load')
    expect(bridged.a.foe(1).sink).toBe(1)
    const bare = unitWith({ armor: 0, load: undefined })
    expect(bare.run.damage(bare.a.foe(1), 50, 'neural')).toEqual({ dealt: 0, track: 'none' })
    expect(bare.run.damage(bare.a.foe(1), 50, 'pleasure')).toEqual({ dealt: 0, track: 'none' })
    expect(bare.a.foe(1).hp!.now).toBe(9999)
    expect(bare.a.foe(1).sink).toBe(0)
    // 傷害 0：沒有沉溺
    const zero = unitWith({ load: { now: 0, max: 100 } })
    zero.run.damage(zero.a.foe(1), 0, 'pleasure')
    expect(zero.a.foe(1).sink).toBe(0)
  })

  it('傷害 0 與負數：不扣生命、不留負的生命', () => {
    for (const raw of [0, -5, -1000]) {
      const { run, a } = unitWith({ armor: 3 })
      expect(run.damage(a.foe(1), raw, 'physical').dealt).toBe(0)
      expect(a.foe(1).hp!.now).toBe(9999)
    }
  })

  it('生命不會低於 0：打超過剩下的生命，單位倒下、生命是 0', () => {
    const { run, a } = unitWith({ armor: 0, hp: { now: 7, max: 50 } })
    run.damage(a.foe(1), 9999, 'physical')
    expect(a.foe(1).hp!.now).toBe(0)
    expect(a.foe(1).out).toBe('down')
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 彈匣

describe('邊界 COMBAT_SYSTEM 第 5 節：彈匣', () => {
  const game = (weapon: ReturnType<typeof testWeapon>) =>
    makeBattleGame({ features: [combatFeature], content: [{ id: 'weapons_boundary', content: { battle_status: TEST_STATUSES } }], battle: duel([one({ weapon: 'pistol', weapons: [weapon], ap: { now: 30, max: 30, regen: 3 } })], [foe('minion', { hp: { now: 9999, max: 9999 }, evade: 0 })]), seed: 7 }).game
  type G = ReturnType<typeof game>
  /** 每一步之後狀態整份換掉：要用的時候再取一次 */
  const me = (g: G): BattleUnit => g.state.battle!.units.a1!
  const turn = (g: G, ap = 30) => { const b = g.state.battle!; b.turn = b.order.indexOf('a1'); const u = b.units.a1!; u.ap.now = ap; u.control = 'player'; return u }
  const mag = (g: G) => me(g).weapons[0]!.mag!

  it('射擊花 1 格、彈匣空了不能射擊（原因寫出來）；換彈補滿、滿的不能換；彈匣容量 1～4 各一次，不會是負的', () => {
    for (const cap of [1, 2, 3, 4]) {
      const g = game({ ...testWeapon('pistol', 20), mag: { now: cap, max: cap } })
      for (let i = cap; i >= 1; i--) {
        turn(g)
        expect(mag(g).now).toBe(i)
        expect(g.battleAct({ action: 'shoot', target: { unit: 'f1' } }).status, `容量 ${cap} 第 ${cap - i + 1} 發`).toBe('applied')
        expect(mag(g).now).toBe(i - 1)
      }
      turn(g)
      expect(g.battleAct({ action: 'shoot', target: { unit: 'f1' } })).toMatchObject({ status: 'refused', reasons: ['彈匣空了，要先換彈。'] })
      expect(mag(g).now).toBe(0)
      expect(g.battleAct({ action: 'reload' }).status).toBe('applied')
      expect(mag(g).now).toBe(cap)
      expect(g.battleAct({ action: 'reload' })).toMatchObject({ status: 'refused', reasons: ['彈匣是滿的。'] })
    }
  })

  it('換彈花 1 點行動點；沒有彈匣的武器（近戰）不用換彈、不能射擊', () => {
    const g = game({ ...testWeapon('pistol', 20), mag: { now: 0, max: 2 } })
    turn(g)
    const ap = me(g).ap.now
    g.battleAct({ action: 'reload' })
    expect(ap - me(g).ap.now).toBe(1)
    const m = game(testWeapon('knife', 20))
    turn(m)
    expect(m.battleAct({ action: 'reload' })).toMatchObject({ status: 'refused', reasons: ['這把武器不用換彈。'] })
    expect(m.battleAct({ action: 'shoot', target: { unit: 'f1' } })).toMatchObject({ status: 'refused', reasons: ['手上是近戰武器，不能射擊。'] })
  })

  it('狙擊槍的一槍 3 點行動點（行動點剛好 3 可以、少 1 不行），一般的槍 2 點（剛好 2 可以、1 不行）', () => {
    const spend = (weapon: ReturnType<typeof testWeapon>, ap: number) => {
      const g = game(weapon)
      turn(g, ap)
      const r = g.battleAct({ action: 'shoot', target: { unit: 'f1' } })
      return { status: r.status, left: me(g).ap.now }
    }
    expect(spend(testWeapon('sniper', 20), 3)).toEqual({ status: 'applied', left: 0 })
    expect(spend(testWeapon('sniper', 20), 2)).toMatchObject({ status: 'refused', left: 2 })
    expect(spend(testWeapon('sniper', 20), 4)).toEqual({ status: 'applied', left: 1 })
    expect(spend(testWeapon('pistol', 20), 2)).toEqual({ status: 'applied', left: 0 })
    expect(spend(testWeapon('pistol', 20), 1)).toMatchObject({ status: 'refused', left: 1 })
    expect(spend(testWeapon('pistol', 20), 0)).toMatchObject({ status: 'refused', left: 0 })
  })

  it('輕機槍的掃射：要彈匣裡有 2 格（1 格不行、2 格可以）、花 2 格；不是輕機槍不能掃射；打完目標要過定力 DC 14', () => {
    const lmg = (now: number) => ({ ...testWeapon('rifle', 30), name: '輕機槍', class: 'lmg', mag: { now, max: 4 }, traits: ['sweep', 'heavy'] })
    const g1 = game(lmg(1))
    turn(g1)
    expect(g1.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })).toMatchObject({ status: 'refused', reasons: ['掃射要彈匣裡有 2 格。'] })
    const g2 = game(lmg(2))
    turn(g2)
    const r = g2.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })
    expect(r.status).toBe('applied')
    expect(mag(g2).now).toBe(0)
    const save = r.reports[0]!.timeline.map((b) => b.roll).find((x) => x?.skill === 'composure')
    expect(save?.dc).toBe(14)
    const g4 = game(lmg(4))
    turn(g4)
    g4.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })
    expect(mag(g4).now).toBe(2)
    const g3 = game(testWeapon('rifle', 30))
    turn(g3)
    expect(g3.battleAct({ action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } }).status).toBe('refused')
  })

  it('性質：任何一串射擊與換彈之後，彈匣在 0～容量；射擊一次剛好少 1（有彈匣時）、換彈補滿；做不成的不改彈匣', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.array(fc.constantFrom('shoot', 'reload'), { maxLength: 14 }), (cap, acts) => {
      const g = game({ ...testWeapon('pistol', 20), mag: { now: cap, max: cap } })
      for (const a of acts) {
        if (g.state.battle!.result) break
        turn(g)
        const before = mag(g).now
        const r = a === 'shoot' ? g.battleAct({ action: 'shoot', target: { unit: 'f1' } }) : g.battleAct({ action: 'reload' })
        const now = clone(mag(g))
        expect(now.now).toBeGreaterThanOrEqual(0)
        expect(now.now).toBeLessThanOrEqual(now.max)
        if (r.status === 'applied') expect(now.now).toBe(a === 'shoot' ? before - 1 : now.max)
        else expect(now.now).toBe(before)
      }
    }), { numRuns: 40 })
  })
})
