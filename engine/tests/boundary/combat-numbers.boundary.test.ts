// 邊界測試：現實戰鬥的數字（M1）。cpp-tester-boundary 寫的；邊界表在這份測試的回報裡（每一個 describe 開頭也列了它管的那幾列）。
//
// 規格：COMBAT_SYSTEM 1.2 節（行動點）、1.3 節（打遮蔽、制伏、脫離）、2 節（站位與距離）、2.1 節（遮蔽）、第 3 節（命中）、
// 第 4 節（護甲）、第 7 節（兩種打法、制伏）、8.1 節（倒下）；CORE_RULES 4.2 節（感載、過載、餘韻、消退）；
// ENEMIES 第 4 節（AI 一回合最多 6 步）、1.5 節（位階的傷害倍率）。不變式第 7、45、49～53 條。
//
// 每一個數值都測：下限、下限−1、上限、上限+1、零、空、最大組合；能寫成性質的用 fast-check。
// 找到、還沒修的（B012～B014）的重現在 tests/pending/ 與 tests/boundary/fixtures/，這裡只斷言規格和程式一致的部分。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BattleActionDef, BattleSetup, BattleUnit, Feature, Grade, UnitRank } from '../../src'
import {
  BattleRun, DEFAULT_NUMBERS, aiStep, attrMod, beginTurn, clone, coverHpFor, createKernel, distance, endBattle, modeOf, rangeMod, unitFromActor,
} from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { TEST_COMBAT, TEST_WEAPONS, enemyUnit, fixDice, makeGame, makeState, testWeapon } from '../../src/testkit'
import { arena, duel, foe, one } from '../helpers/battle'

const N = DEFAULT_NUMBERS
const RANKS: UnitRank[] = ['minion', 'elite', 'boss']
const GRADES: Grade[] = [1, 2, 3, 4, 5]
/** 擲傷害骰用的骰面：夠多顆，每顆都一樣 */
const many = (v: number, n = 40) => Array.from({ length: n }, () => v)
const runOn = (a: ReturnType<typeof arena>, dice?: number[]) => {
  const b = clone(a.battle)
  const run = new BattleRun(a.k, a.state, b)
  return dice ? fixDice(run, dice) : run
}

// ---------------------------------------------------------------------------------------------
// 1. 行動點（COMBAT_SYSTEM 1.2 節）
//   上限 = 4 ＋ floor((mod(反應) ＋ mod(魅力)) ÷ 2)，有效屬性 1～24（CORE_RULES 第 1 節）
//   每回合回 3、不超過上限；第一回合從上限開始；被埋伏的一方從「上限 − 2」開始

describe('邊界 COMBAT_SYSTEM 1.2：行動點', () => {
  const mode = modeOf(createKernel([]).content, 'meat')!
  const apOf = (reflex: number, charm: number, features: Feature[]) => {
    const k = createKernel(features)
    const state = makeState({ pc: { attrs: { reflex, charm } } })
    return unitFromActor(k, state, 'pc', mode, 1).ap
  }

  it('上限的表：建角的下限（4、4）是 1；10、11 都是 mod 0；12＋10 的 floor(1÷2) 不進位；有效屬性的上限（24、24）是 11', () => {
    for (const features of [[], [characterFeature]]) {
      expect(apOf(4, 4, features).max).toBe(1)
      expect(apOf(5, 5, features).max).toBe(1) // mod(5) = −3
      expect(apOf(6, 6, features).max).toBe(2)
      expect(apOf(10, 10, features).max).toBe(4)
      expect(apOf(11, 11, features).max).toBe(4)
      expect(apOf(12, 10, features).max).toBe(4)
      expect(apOf(12, 12, features).max).toBe(5)
      expect(apOf(16, 16, features).max).toBe(7) // M1 審查問過的：反應與魅力都是 16 → 7
      expect(apOf(18, 18, features).max).toBe(8)
      expect(apOf(24, 24, features).max).toBe(11)
      expect(apOf(25, 25, features).max).toBe(11) // 有效屬性夾在 24
    }
  })

  it('性質：反應與魅力在 2～24（上限 ≥ 0 的範圍）時，上限照公式、開打時從上限開始、每回合回 3', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 24 }), fc.boolean(), (r, c, withChar) => {
      fc.pre(4 + Math.floor((attrMod(r) + attrMod(c)) / 2) >= 0)
      const ap = apOf(r, c, withChar ? [characterFeature] : [])
      expect(ap.max).toBe(4 + Math.floor((attrMod(r) + attrMod(c)) / 2))
      expect(ap.now).toBe(ap.max)
      expect(ap.regen).toBe(3)
    }))
  })

  it('每回合回 3、不超過上限：剩 0 → 3；剩 上限−3 → 上限；剩 上限−2 → 上限（多的不留）；剩 上限 → 上限；第一個自己的回合不回', () => {
    const a = arena(duel([one()], [foe()]))
    const u = a.ally(1)
    const max = u.ap.max // 5
    const cases: Array<[number, number]> = [[0, 3], [max - 3, max], [max - 2, max], [max - 1, max], [max, max]]
    for (const [now, expected] of cases) {
      u.uses.turns = 1
      u.ap.now = now
      beginTurn(a.run(), u)
      expect(u.ap.now, `剩 ${now}`).toBe(expected)
    }
    u.uses = {}
    u.ap.now = 0
    beginTurn(a.run(), u)
    expect(u.ap.now).toBe(0)
  })

  it('性質：任何上限（1～12）、剩下的點數（0～上限）、回復（0～6），回合開始之後 = min(上限, 剩下 ＋ 回復)，不會超過上限也不會變少', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), fc.nat(12), fc.nat(6), (max, nowRaw, regen) => {
      const now = Math.min(nowRaw, max)
      const a = arena(duel([one({ ap: { now, max, regen } })], [foe()]))
      const u = a.ally(1)
      u.uses.turns = 1
      u.ap.now = now
      beginTurn(a.run(), u)
      expect(u.ap.now).toBe(Math.min(max, now + regen))
      expect(u.ap.now).toBeLessThanOrEqual(max)
      expect(u.ap.now).toBeGreaterThanOrEqual(now)
    }))
  })

  it('被埋伏：第一回合從「上限 − 2」開始，上限 1、2 的從 0 開始（不會是負的）；埋伏的一方從上限開始；在後方等的人補上來時從上限開始', () => {
    for (const max of [1, 2, 3, 5, 12]) {
      const setup = duel([one({ ap: { now: max, max, regen: 3 } }), one({ ap: { now: max, max, regen: 3 } }, 2)], [foe(), foe()], undefined, { ambush: 'foe' })
      const a = arena(setup)
      // 先攻最高的人已經開始他的回合：被埋伏的我方第一個回合不回行動點，所以照樣看得到開場的數字
      for (const id of ['a1', 'a2']) expect(a.battle.units[id]!.ap.now, `上限 ${max}`).toBe(Math.max(0, max - 2))
      for (const id of ['f1', 'f2']) expect(a.battle.units[id]!.ap.now).toBe(a.battle.units[id]!.ap.max)
    }
    const five = arena({ ...duel([one()], [foe(), foe(), foe(), foe(), foe('minion', { ap: { now: 4, max: 4, regen: 3 } })]), ambush: 'ally' })
    const reserve = five.foe(5)
    expect(reserve.slot).toBe(0)
    expect(reserve.ap.now).toBe(reserve.ap.max)
  })
})

describe('邊界 ENEMIES 第 4 節：AI 一個回合最多做 6 步', () => {
  // 一個不花行動點、AI 一定想做的行動：沒有 6 步的上限的話，這個人會一直做下去
  const FREE: BattleActionDef = {
    id: 'test.free', owner: 'test', name: '喘口氣', desc: '不花行動點的小動作。', group: 'tactic', icon: 'wait', target: 'none',
    cost: () => ({ ap: 0 }), run: (run, u) => run.say(`${u.name} 喘口氣。`, 'test'), aiScore: () => 5,
  }
  const freeFeature: Feature = { id: 'test_free', install: (k) => k.battle.action(FREE) }

  it('第 6 步照做、第 7 步不做（回合結束、換人）；行動點再多也一樣', () => {
    const a = arena(duel([one({ control: 'ai' })], [foe('boss', { ap: { now: 99, max: 99, regen: 3 } })]), [TEST_COMBAT, freeFeature])
    // 讓敵人先動
    a.battle.order = ['f1', 'a1']
    a.battle.turn = 0
    a.battle.aiSteps = 0
    const run = a.run()
    const f = a.foe(1)
    let acted = 0
    while (aiStep(run, f)) acted++
    expect(acted).toBe(N.aiMaxSteps)
    expect(N.aiMaxSteps).toBe(6)
    expect(a.battle.aiSteps).toBe(6)
    // 下一個回合重新算
    beginTurn(run, f)
    expect(a.battle.aiSteps).toBe(0)
    expect(aiStep(run, f)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 距離（COMBAT_SYSTEM 2.2 節）與距離修正（第 3 節、2.3 節）
//   距離 = 我在第幾格 ＋ 對方在第幾格 − 1，1～7；適用距離內不扣，每超出 1 格 −2；長槍在第 1 格 −4

describe('邊界 COMBAT_SYSTEM 2.2／第 3 節：距離與距離修正', () => {
  it('性質：距離在 1～7；近身（距離 1）只有雙方都在第 1 格', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), (x, y) => {
      const d = distance({ slot: x }, { slot: y })
      expect(d).toBe(x + y - 1)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(7)
      expect(d === 1).toBe(x === 1 && y === 1)
    }))
  })

  it('每一把測試武器：適用距離的下限、上限不扣；下限−1、上限+1 各 −2；長槍在第 1 格另外 −4', () => {
    for (const [kind, w] of Object.entries(TEST_WEAPONS)) {
      const [lo, hi] = w.range
      for (let a = 1; a <= 4; a++) for (let t = 1; t <= 4; t++) {
        const d = a + t - 1
        const long = w.traits.includes('long') && a === 1 ? N.longAtFront : 0
        const expected = (d < lo ? -2 * (lo - d) : d > hi ? -2 * (d - hi) : 0) + long
        expect(rangeMod(N, { slot: a }, { slot: t }, w), `${kind} ${a}→${t}`).toBe(expected)
        if (d === lo || d === hi) expect(rangeMod(N, { slot: a }, { slot: t }, w) - long, `${kind} 剛好在邊上`).toBe(0)
        if (d === lo - 1 || d === hi + 1) expect(rangeMod(N, { slot: a }, { slot: t }, w) - long, `${kind} 差一格`).toBe(-2)
      }
    }
  })

  it('性質：任何適用距離 [下, 上] ⊂ 1～7 與站位，修正 ≤ 0；超出 k 格是 −2k；最大組合（狙擊 5～7 在第 1 格打第 1 格）是 −8 −4', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 7 }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), fc.boolean(), (lo, span, a, t, long) => {
      const hi = Math.min(7, lo + span)
      const m = rangeMod(N, { slot: a }, { slot: t }, { range: [lo, hi], traits: long ? ['long'] : [] })
      const d = a + t - 1
      const out = d < lo ? lo - d : d > hi ? d - hi : 0
      expect(m).toBe(-2 * out + (long && a === 1 ? -4 : 0))
      expect(m).toBeLessThanOrEqual(0)
    }))
    expect(rangeMod(N, { slot: 1 }, { slot: 1 }, testWeapon('sniper', 0))).toBe(-8 - 4)
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 命中（COMBAT_SYSTEM 第 3 節；不變式第 50 條）
//   攻擊 ≥ 迴避命中；超過迴避 5 以上要害；自然 20 一定中、自然 1 一定失手；命中率顯示夾在 5～95%

describe('邊界 COMBAT_SYSTEM 第 3 節：命中、要害、自然 1／20、命中率', () => {
  /** 我方第 a 格拿手槍（加值 bonus），打敵方第 t 格（迴避 evade，遮蔽 cover） */
  const field = (o: { bonus: number; evade: number; cover: number; a: number; t: number; layersMe: number; layersIt: number; wounded: boolean; dark: boolean }) => {
    const allies = [1, 2, 3, 4].map((i) => one({ weapon: 'pistol', weapons: [testWeapon('pistol', o.bonus)], layers: i === o.a ? o.layersMe : 0, layersMax: 4, ...(i === o.a && o.wounded ? { hp: { now: 10, max: 46 } } : {}) }, i))
    const foes = [1, 2, 3, 4].map((i) => foe('elite', { evade: o.evade, layers: i === o.t ? o.layersIt : 0, layersMax: 4, hp: { now: 999, max: 999 } }))
    const cover = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0].map((_, i) => (i + 1 === o.t ? o.cover : 0)) }
    return arena(duel(allies, foes, cover, o.dark ? { field: { dark: true } } : {}))
  }
  const sample = fc.record({
    bonus: fc.integer({ min: -30, max: 30 }), evade: fc.integer({ min: -20, max: 40 }), cover: fc.integer({ min: 0, max: 2 }),
    a: fc.integer({ min: 1, max: 4 }), t: fc.integer({ min: 1, max: 4 }), layersMe: fc.integer({ min: 0, max: 4 }), layersIt: fc.integer({ min: 0, max: 4 }),
    wounded: fc.boolean(), dark: fc.boolean(),
  })

  it('性質：畫面上的命中率 = 二十個骰面裡真的打中的個數 × 5（含距離、遮蔽、黑暗、餘韻、重傷），一定在 5～95', () => {
    fc.assert(fc.property(sample, (o) => {
      const a = field(o)
      const me = `a${o.a}`, it_ = `f${o.t}`
      const shown = a.run().hitChance(a.battle.units[me]!, a.battle.units[it_]!)
      let hits = 0
      for (let face = 1; face <= 20; face++) {
        const run = runOn(a, [face, ...many(1)])
        if (run.attack(run.unit(me), run.unit(it_)).hit) hits++
      }
      expect(shown).toBe(hits * 5)
      expect(shown).toBeGreaterThanOrEqual(5)
      expect(shown).toBeLessThanOrEqual(95)
    }), { numRuns: 150 })
  })

  it('命中率的夾值：需要擲 1 以下 → 95；剛好 2 → 95；11 → 50；剛好 20 → 5；21 以上 → 5', () => {
    const base = { bonus: 0, cover: 0, a: 2, t: 1, layersMe: 0, layersIt: 0, wounded: false, dark: false } // 第 2 格打第 1 格：距離 2，手槍不扣
    const chance = (need: number) => {
      const a = field({ ...base, evade: need })
      return a.run().hitChance(a.ally(2), a.foe(1))
    }
    expect(chance(-50)).toBe(95)
    expect(chance(1)).toBe(95)
    expect(chance(2)).toBe(95)
    expect(chance(3)).toBe(90)
    expect(chance(11)).toBe(50)
    expect(chance(19)).toBe(10)
    expect(chance(20)).toBe(5)
    expect(chance(21)).toBe(5)
    expect(chance(99)).toBe(5)
  })

  it('攻擊 = 迴避命中、迴避 − 1 沒中；超過 4 不是要害、超過 5 是要害（多一顆骰）；自然 20 一定中但不一定是要害；自然 1 在超過 5 以上也失手', () => {
    const base = { bonus: 0, cover: 0, a: 2, t: 1, layersMe: 0, layersIt: 0, wounded: false, dark: false }
    const a = field({ ...base, evade: 10 })
    const shoot = (face: number) => {
      const run = runOn(a, [face, ...many(1)])
      return run.attack(run.unit('a2'), run.unit('f1'))
    }
    expect(shoot(9)).toMatchObject({ hit: false, total: 9 })
    expect(shoot(10)).toMatchObject({ hit: true, crit: false, raw: 3 }) // 3d6 全 1
    expect(shoot(14)).toMatchObject({ hit: true, crit: false, raw: 3 })
    expect(shoot(15)).toMatchObject({ hit: true, crit: true, raw: 4 }) // 要害：多一顆
    const far = field({ ...base, evade: 60 })
    const nat20 = runOn(far, [20, ...many(1)]).attack(far.battle.units.a2!, far.battle.units.f1!)
    expect(nat20).toMatchObject({ hit: true, crit: false })
    const near = field({ ...base, evade: -40 })
    const run1 = runOn(near, [1, ...many(1)])
    expect(run1.attack(run1.unit('a2'), run1.unit('f1'))).toMatchObject({ hit: false, natural: 1 })
  })

  it('性質：要害 ⇔ 命中而且（攻擊 − 迴避）≥ 5；要害多擲一顆骰；沒中的不扣生命', () => {
    fc.assert(fc.property(sample, fc.integer({ min: 1, max: 20 }), (o, face) => {
      const a = field(o)
      const run = runOn(a, [face, ...many(2)])
      const t = run.unit(`f${o.t}`)
      const hp = t.hp!.now
      const r = run.attack(run.unit(`a${o.a}`), t)
      expect(r.crit).toBe(r.hit && r.total - r.evade >= N.critMargin)
      expect(r.hit).toBe(face === 20 || (face !== 1 && r.total >= r.evade))
      if (r.hit) expect(r.raw).toBe(2 * (3 + (r.crit ? 1 : 0))) // 手槍 3d6、全 2（這裡的手槍沒有固定傷害）
      else expect(t.hp!.now).toBe(hp)
    }), { numRuns: 300 })
  })
})

// ---------------------------------------------------------------------------------------------
// 4. 護甲與傷害（COMBAT_SYSTEM 第 4 節；ENEMIES 1.5 節）
//   實際傷害 = max(0, 傷害 − max(0, 護甲 − 穿甲))；敵人的生命傷害再乘位階倍率，四捨五入、最少 1

describe('邊界 COMBAT_SYSTEM 第 4 節：護甲、穿甲、位階的傷害倍率', () => {
  it('性質：我方打敵人：扣護甲之後的傷害 = max(0, 原始 − max(0, 護甲 − 穿甲))；穿甲 ≥ 護甲時等於原始（多的不變成傷害）；生命不會低於 0', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 80 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 1, max: 120 }), (raw_, armor, pierce, hp) => {
      const a = arena(duel([one()], [foe('elite', { armor, hp: { now: hp, max: 120 } })]))
      const run = a.run()
      const t = a.foe(1)
      const d = run.damage(t, raw_, 'physical', a.ally(1), { pierce })
      const expected = Math.max(0, raw_ - Math.max(0, armor - pierce))
      expect(Math.min(d.dealt, hp)).toBe(Math.min(expected, hp))
      if (pierce >= armor) expect(d.dealt).toBe(raw_)
      expect(d.dealt).toBeLessThanOrEqual(raw_)
      expect(t.hp!.now).toBe(Math.max(0, hp - expected))
      expect(t.out === 'down').toBe(hp - expected <= 0)
    }))
  })

  it('位階倍率的邊上：扣完護甲 0 → 0（不補成 1）；1 → 1（雜兵 0.4 四捨五入是 0，最少 1）；雜兵 3 → 1、4 → 2；精英 1 → 1、3 → 2；首領照算', () => {
    const a = arena(duel([one({ armor: 0 })], [foe('minion'), foe('elite'), foe('boss')]))
    const me = a.ally(1)
    me.hp = { now: 999, max: 999 }
    const run = a.run()
    const by = (i: number, v: number) => run.damage(me, v, 'physical', a.foe(i)).dealt
    expect(by(1, 0)).toBe(0)
    expect(by(1, 1)).toBe(1)
    expect(by(1, 2)).toBe(1)
    expect(by(1, 3)).toBe(1)
    expect(by(1, 4)).toBe(2)
    expect(by(2, 1)).toBe(1)
    expect(by(2, 3)).toBe(2)
    expect(by(3, 1)).toBe(1)
    expect(by(3, 37)).toBe(37)
  })

  it('性質：敵人打我方的生命傷害：扣完護甲是 0 就是 0；不是 0 的話 = max(1, round(扣完 × 倍率))，不超過扣完的', () => {
    fc.assert(fc.property(fc.constantFrom(...RANKS), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 8 }), (rank, v, armor) => {
      const a = arena(duel([one({ armor, hp: { now: 999, max: 999 } })], [foe(rank)]))
      const after = Math.max(0, v - armor)
      const d = a.run().damage(a.ally(1), v, 'physical', a.foe(1)).dealt
      expect(d).toBe(after === 0 ? 0 : Math.max(1, Math.round(after * N.rankDamage[rank])))
      expect(d).toBeLessThanOrEqual(after)
    }))
  })
})

// ---------------------------------------------------------------------------------------------
// 5. 遮蔽（COMBAT_SYSTEM 2.1 節；不變式第 51 條）
//   迴避 暴露 0／半掩體 +2／掩體 +4；耐久 半掩體 15／15／20／25／30、掩體 30／30／40／50／60；打穿一級多的算到下一級；
//   沒人站的格子 ×2；煙霧打不破；指定打遮蔽一律 2 點、倍率加倍（至少 ×1）

describe('邊界 COMBAT_SYSTEM 2.1：遮蔽', () => {
  it('每一級在每一個場景等級的耐久；等級的下限−1（0）與上限+1（6）夾在 I、V', () => {
    for (const g of GRADES) {
      expect(coverHpFor(N, 1, g)).toBe([15, 15, 20, 25, 30][g - 1])
      expect(coverHpFor(N, 2, g)).toBe([30, 30, 40, 50, 60][g - 1])
      const a = arena({ ...duel([one()], [foe()], { ally: [2, 1, 0, 0], foe: [2, 1, 0, 0] }), grade: g })
      expect(a.battle.cover.foe.map((c) => c.hp)).toEqual([coverHpFor(N, 2, g), coverHpFor(N, 1, g), 0, 0])
    }
    expect(coverHpFor(N, 2, 0 as Grade)).toBe(30)
    expect(coverHpFor(N, 2, 6 as Grade)).toBe(60)
  })

  it('迴避：暴露 +0、半掩體 +2、掩體 +4；煙霧在暴露的格子上算半掩體、在掩體上照算掩體；被埋伏降一級不低於暴露', () => {
    const a = arena(duel([one()], [foe(), foe(), foe(), foe()], { ally: [0, 0, 0, 0], foe: [0, 1, 2, 0] }))
    const run = a.run()
    expect([1, 2, 3].map((i) => run.evadeOf(a.foe(i)).total - a.foe(i).evade)).toEqual([0, 2, 4])
    a.battle.cover.foe[0]!.soft = { kind: 'smoke' }
    a.battle.cover.foe[2]!.soft = { kind: 'smoke' }
    expect(run.evadeOf(a.foe(1)).total - a.foe(1).evade).toBe(2)
    expect(run.evadeOf(a.foe(3)).total - a.foe(3).evade).toBe(4)
    const caught = arena({ ...duel([one()], [foe()], { ally: [0, 1, 2, 0], foe: [0, 0, 0, 0] }), ambush: 'foe' })
    expect(caught.battle.cover.ally.map((c) => c.level)).toEqual([0, 0, 1, 0])
  })

  it('打穿的邊上（I 級，有人站）：掩體 30 吃 29 剩 1；吃 30 剛好降成半掩體、耐久 15；吃 44 剩半掩體 1；吃 45 剛好變暴露；吃 999 也只是暴露、耐久 0', () => {
    const hit = (dmg: number) => {
      const a = arena(duel([one()], [foe()], { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }))
      a.run().hurtCover('foe', 1, dmg)
      return a.battle.cover.foe[0]
    }
    expect(hit(0)).toEqual({ level: 2, hp: 30 })
    expect(hit(29)).toEqual({ level: 2, hp: 1 })
    expect(hit(30)).toEqual({ level: 1, hp: 15 })
    expect(hit(44)).toEqual({ level: 1, hp: 1 })
    expect(hit(45)).toEqual({ level: 0, hp: 0 })
    expect(hit(999)).toEqual({ level: 0, hp: 0 })
    expect(hit(-5)).toEqual({ level: 2, hp: 30 })
    expect(hit(0.4)).toEqual({ level: 2, hp: 30 }) // 四捨五入是 0：不受傷
    expect(hit(0.5)).toEqual({ level: 2, hp: 29 })
  })

  it('性質：遮蔽的「剩下的總耐久」（這一級剩的 ＋ 下面每一級的滿耐久）每一擊剛好少「傷害 ×（沒人站 2、有人站 1）」，到 0 為止；等級在 0～2、耐久不超過那一級的滿值', () => {
    const total = (c: { level: number; hp: number }, g: Grade) => (c.level === 0 ? 0 : c.hp + (c.level === 2 ? coverHpFor(N, 1, g) : 0))
    fc.assert(fc.property(fc.constantFrom(...GRADES), fc.integer({ min: 1, max: 2 }), fc.boolean(), fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 8 }), (g, level, empty, hits) => {
      // 敵方三個人站第 1～3 格；打第 3 格（有人）或第 4 格（沒人、後面也沒人，不會補位）
      const slot = empty ? 4 : 3
      const levels = [0, 0, 0, 0]
      levels[slot - 1] = level
      const a = arena({ ...duel([one()], [foe(), foe(), foe()], { ally: [0, 0, 0, 0], foe: levels }), grade: g })
      const run = a.run()
      for (const d of hits) {
        const c = a.battle.cover.foe[slot - 1]!
        const before = total(c, g)
        run.hurtCover('foe', slot, d)
        const after = total(a.battle.cover.foe[slot - 1]!, g)
        expect(after).toBe(Math.max(0, before - (before > 0 ? d * (empty ? 2 : 1) : 0)))
        const now = a.battle.cover.foe[slot - 1]!
        expect([0, 1, 2]).toContain(now.level)
        if (now.level === 0) expect(now.hp).toBe(0)
        else {
          expect(now.hp).toBeGreaterThan(0)
          expect(now.hp).toBeLessThanOrEqual(coverHpFor(N, now.level as 1 | 2, g))
        }
      }
    }))
  })

  it('煙霧與人群：吃多少都打不破（傷害 0、1、999）', () => {
    for (const dmg of [0, 1, 999]) {
      const a = arena(duel([one()], [foe()], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), undefined)
      const run = a.run()
      run.softCover('foe', 1, 'smoke', 2)
      run.hurtCover('foe', 1, dmg)
      expect(run.evadeOf(a.foe(1)).total - a.foe(1).evade).toBe(2)
    }
  })

  describe('指定打遮蔽（features/combat 的 hit_cover）：一律 2 點、倍率加倍、至少 ×1', () => {
    const shoot = (weapon: string, foeSlot = 1, dice = 6) => {
      const a = arena(duel([one({ weapon })], [foe(), foe(), foe(), foe()], { ally: [0, 0, 0, 0], foe: [2, 2, 2, 2] }), [combatFeature])
      for (const c of a.battle.cover.foe) {
        c.max = [500, 1000]
        c.hp = 1000
      }
      const def = a.k.battle.getAction('hit_cover')!
      const run = runOn(a, many(dice))
      const u = run.unit('a1')
      const cost = def.cost(run, u)
      def.run(run, u, { side: 'foe', slot: foeSlot }, { action: 'hit_cover', target: { side: 'foe', slot: foeSlot } })
      return { cost: cost.ap, dealt: 1000 - run.battle.cover.foe[foeSlot - 1]!.hp, blocks: def.blocks?.(run, u) ?? [] }
    }
    it('花費：手槍、狙擊槍都是 2 點', () => {
      expect(shoot('pistol').cost).toBe(2)
      expect(shoot('sniper', 4).cost).toBe(2)
    })
    it('倍率：手槍 0.25 → ×1（至少 ×1）；衝鋒槍 0.5 → ×1；步槍 0.5 → ×1；霰彈 1.5 → ×3；神經 0 → ×1', () => {
      expect(shoot('pistol').dealt).toBe(18 * 1)
      expect(shoot('smg', 2).dealt).toBe(18 * 1)
      expect(shoot('rifle', 3).dealt).toBe(24 * 1)
      expect(shoot('shotgun', 1).dealt).toBe(30 * 3) // 距離 1：5d6
      expect(shoot('stun', 2).dealt).toBe(18 * 1)
    })
    it('近戰武器不能指定打遮蔽（灰掉的原因寫出來）', () => {
      expect(shoot('knife').blocks).toEqual(['近戰武器打不了遮蔽。'])
    })
  })
})

// ---------------------------------------------------------------------------------------------
// 6. 感載、過載、餘韻（CORE_RULES 4.2 節；COMBAT_SYSTEM 第 7 節；不變式第 53 條）
//   受到的感載 = 原始 ×（0.75 ＋ 敏感度 ÷ 200）；到上限就過載：歸零、疊一層；疊滿再過載倒下；消退 2 ＋ mod(意志)，最少 0

describe('邊界 CORE_RULES 4.2：感載、過載、餘韻、消退', () => {
  it('敏感度的下限 0 是 ×0.75、上限 100 是 ×1.25、50 是 ×1；原始 0 不加、不留一拍', () => {
    const a = arena(duel([one()], [0, 50, 100].map((s) => foe('boss', { sensitivity: s, load: { now: 0, max: 999 } }))))
    const run = a.run()
    expect(run.addLoad(a.foe(1), 20)).toBe(15)
    expect(run.addLoad(a.foe(2), 20)).toBe(20)
    expect(run.addLoad(a.foe(3), 20)).toBe(25)
    const beats = run.beats.length
    expect(run.addLoad(a.foe(2), 0)).toBe(0)
    expect(run.beats.length).toBe(beats)
  })

  it('上限的邊上：剩 上限−1 再加 0 不過載；加到剛好上限就過載（歸零、多的不留）；承受 0 層的第一次過載就倒下', () => {
    const a = arena(duel([one()], [foe('elite', { load: { now: 0, max: 40 } }), foe('minion', { layersMax: 0 })]))
    const t = a.foe(1)
    const run = a.run()
    t.load!.now = 39
    expect(t.layers).toBe(0)
    run.addLoad(t, 1, undefined, { exact: true })
    expect(t.load!.now).toBe(0)
    expect(t.layers).toBe(1)
    t.load!.now = 38
    run.addLoad(t, 1, undefined, { exact: true })
    expect(t.load!.now).toBe(39)
    expect(t.layers).toBe(1)
    const zero = a.foe(2)
    run.addLoad(zero, 999, undefined, { exact: true })
    expect(zero.out).toBe('burnout')
    expect(zero.layers).toBe(0)
  })

  it('性質：任何上限（1～120）、承受層數（0～6）、一串感載，沒倒下的時候感載在 0～上限−1、層數在 0～承受層數；倒下 ⇔ 過載了「承受層數 ＋ 1」次', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 120 }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 100 }), fc.array(fc.integer({ min: 0, max: 150 }), { maxLength: 20 }), (max, layersMax, sens, adds) => {
      const a = arena(duel([one()], [foe('boss', { load: { now: 0, max }, layersMax, sensitivity: sens }), foe()]))
      const t = a.foe(1)
      const run = a.run()
      let overloads = 0
      for (const v of adds) {
        if (t.out) break
        const before = t.load!.now
        const got = run.addLoad(t, v)
        expect(got).toBe(Math.max(0, Math.round(v * (0.75 + sens / 200))))
        if (before + got >= max) overloads++
        if (!t.out) {
          expect(t.load!.now).toBeGreaterThanOrEqual(0)
          expect(t.load!.now).toBeLessThan(max)
          expect(t.layers).toBeLessThanOrEqual(layersMax)
        }
      }
      expect(t.out === 'burnout').toBe(overloads >= layersMax + 1)
      if (!t.out) expect(t.layers).toBe(overloads)
    }))
  })

  it('性質：消退 = max(0, 2 ＋ mod(意志))，感載不會低於 0；意志 4、5、6 不消退（也不往上加），意志 24 消退 9', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 24 }), fc.integer({ min: 0, max: 60 }), (resolve, now) => {
      const a = arena(duel([one({ attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve, charm: 10 }, load: { now: 0, max: 61 } })], [foe()]))
      const u = a.ally(1)
      u.load!.now = now
      beginTurn(a.run(), u)
      expect(u.load!.now).toBe(Math.max(0, now - Math.max(0, 2 + attrMod(resolve))))
    }))
    for (const [resolve, decay] of [[4, 0], [5, 0], [6, 0], [7, 0], [8, 1], [10, 2], [24, 9]] as const) {
      const a = arena(duel([one({ attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve, charm: 10 } })], [foe()]))
      const u = a.ally(1)
      u.load!.now = 20
      beginTurn(a.run(), u)
      expect(20 - u.load!.now, `意志 ${resolve}`).toBe(decay)
    }
  })

  it('性質：每一層餘韻，命中、迴避、豁免各 −1，自己造成的感載 +10%（層數 0～6）', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), (n) => {
      const a = arena(duel([one({ layers: n, layersMax: 6 })], [foe('boss', { load: { now: 0, max: 9999 } })]))
      const run = a.run()
      const me = a.ally(1)
      const part = (kind: 'hit' | 'evade' | 'save') => run.mods(kind, me).filter((p) => p.source === 'afterglow').reduce((s, p) => s + p.value, 0)
      expect(part('hit') + 0).toBe(-n + 0)
      expect(part('evade') + 0).toBe(-n + 0)
      expect(part('save') + 0).toBe(-n + 0)
      expect(run.damage(a.foe(1), 100, 'neural', me).dealt).toBe(Math.round(100 * (1 + 0.1 * n)))
    }))
  })
})

// ---------------------------------------------------------------------------------------------
// 7. 制伏與脫離的 DC（COMBAT_SYSTEM 第 7 節、1.3 節）
//   制伏：10 ＋ 目標的等級 × 2，精英 +2、首領 +4；脫離：10 ＋ 敵方最高的等級 × 2

describe('邊界 COMBAT_SYSTEM 第 7 節／1.3 節：制伏與脫離的 DC', () => {
  it('制伏的 DC：等級 I～V × 三種位階', () => {
    for (const rank of RANKS) for (const g of GRADES) {
      const a = arena(duel([one()], [enemyUnit(rank, g)]), [combatFeature])
      const def = a.k.battle.getAction('subdue')!
      const run = a.run()
      const t = def.targets!(run, a.ally(1)).find((x) => 'unit' in x.target && x.target.unit === 'f1')!
      expect((t as { hint?: { dc?: number } }).hint?.dc, `${rank} ${g}`).toBe(10 + 2 * g + (rank === 'elite' ? 2 : rank === 'boss' ? 4 : 0))
    }
  })

  it('制伏的條件的邊上：精英與首領 餘韻 承受−1 層不行、剛好疊滿可以；雜兵 0 層也可以；不在近身（任一方不在第 1 格）不行', () => {
    for (const rank of RANKS) {
      const a = arena(duel([one(), one({}, 2)], [enemyUnit(rank, 1), enemyUnit(rank, 1)]), [combatFeature])
      const def = a.k.battle.getAction('subdue')!
      const run = a.run()
      const t = a.foe(1)
      run.applyStatus(t, 'lose_turn', { force: true })
      const blocksFor = (u: BattleUnit) => def.targets!(run, u).find((x) => 'unit' in x.target && x.target.unit === 'f1')!.blocks
      t.layers = Math.max(0, t.layersMax - 1)
      expect(blocksFor(a.ally(1)).length > 0, `${rank} 差一層`).toBe(rank !== 'minion')
      t.layers = t.layersMax
      expect(blocksFor(a.ally(1)), `${rank} 疊滿`).toEqual([])
      expect(blocksFor(a.ally(2)).length, `${rank} 第 2 格`).toBe(1)
    }
  })

  it('脫離的 DC = 10 ＋ 場上敵方最高的等級 × 2；擲到剛好 DC 成功、DC − 1 失敗', () => {
    for (const g of GRADES) {
      const a = arena({ ...duel([one({ skills: { athletics: 0 } as never, attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 } })], [enemyUnit('minion', 1), enemyUnit('elite', g)]), origin: { escapable: true } }, [combatFeature])
      const def = a.k.battle.getAction('flee')!
      const dc = 10 + 2 * g
      for (const [face, ok] of [[dc, true], [dc - 1, false]] as const) {
        if (face < 2 || face > 19) continue
        const run = runOn(a, [face])
        def.run(run, run.unit('a1'), null, { action: 'flee' })
        const roll = run.beats.find((b) => b.roll)!.roll!
        expect(roll.dc, `等級 ${g}`).toBe(dc)
        expect(run.battle.result?.outcome === 'fled', `等級 ${g} 擲 ${face}`).toBe(ok)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 8. 戰鬥結束寫回角色（COMBAT_SYSTEM 8.1、8.2 節；CORE_RULES 4.2 節；不變式第 7、49 條）
//   生命最少剩 1、最多上限；感載最多 上限−1；餘韻 0～承受層數；疊滿再過載倒下的：餘韻清空、沉溺 +2

describe('邊界 COMBAT_SYSTEM 8.1／8.2：戰鬥結束寫回三條軌', () => {
  it('性質：不論戰鬥裡的生命、感載、層數、沉溺與怎麼退出的，寫回之後生命在 1～上限、感載在 0～上限−1、餘韻在 0～承受層數；疊滿再過載倒下的餘韻 0、沉溺 +2', () => {
    const { game } = makeGame({ features: [characterFeature, TEST_COMBAT], pc: { hp: 40, load: 0, afterglow: 0, sink: 5 }, actors: [] })
    game.startBattle({ ...duel([], [foe()]), allies: [{ from: 'actor', id: 'pc' }] } as BattleSetup)
    const hpMax = game.battle!.units.a1!.hp!.max
    const loadMax = game.battle!.units.a1!.load!.max
    fc.assert(fc.property(
      fc.integer({ min: 0, max: hpMax }), fc.integer({ min: 0, max: loadMax - 1 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 5 }),
      fc.constantFrom(undefined, 'down', 'burnout', 'subdued', 'surrendered'), fc.constantFrom('win', 'lose', 'fled', 'surrender'),
      (hp, load, layers, sink, out, outcome) => {
        const s = clone(game.state)
        const u = s.battle!.units.a1!
        u.hp!.now = out === 'down' ? 0 : hp
        u.load!.now = load
        u.layers = out === 'burnout' ? 3 : layers
        u.sink = sink
        if (out) u.out = out
        s.battle!.result = { outcome, text: '測試' }
        const draft = endBattle(game.k, s)
        const after = clone(s)
        game.k.changes.applyAll(after, draft.changes)
        const pc = after.actors.pc!
        expect(pc.hp).toBeGreaterThanOrEqual(1)
        expect(pc.hp).toBeLessThanOrEqual(hpMax)
        expect(pc.hp).toBe(Math.max(1, u.hp!.now))
        expect(pc.load).toBeGreaterThanOrEqual(0)
        expect(pc.load).toBeLessThanOrEqual(loadMax - 1)
        expect(pc.afterglow).toBe(out === 'burnout' ? 0 : layers)
        expect(pc.sink).toBe(5 + sink + (out === 'burnout' ? 2 : 0))
        expect(after.battle).toBeNull()
      },
    ))
  })
})
