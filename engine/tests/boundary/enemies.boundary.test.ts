// 邊界測試：敵人的數字（M1）。cpp-tester-boundary 寫的。
//
// 規格：ENEMIES 1.5 節（目標表、位階的固定值與傷害倍率）、4.4 節（士氣）、第 13 節（點數、強度係數、對決的修正）；
// BALANCE 7.2、7.3 節（難度的係數與自訂的範圍）；CORE_RULES 第 3 節（檢定、自然 1 與 20）。
//
// 邊界表（數值或條件｜範圍｜出處｜測的點）：
//   等級              I～V（1～5）                       ENEMIES 1.1   1、5、0、6 夾住、小數無條件捨去
//   生命表            三個位階 × 五級                    ENEMIES 1.5   每一格都對、× 兵種的 hp（0.5～1.5）× 難度 × 強度四捨五入
//   感載上限          同上；沒有橋的沒有                 ENEMIES 1.5、1.4  每一格都對
//   護甲／迴避／攻擊  每級 +1 的表 ＋ 兵種的整數修正       ENEMIES 1.5   每一級、修正的正負
//   行動點            雜兵 4／精英 5／首領 6，IV 級以上的精英與首領 +1   ENEMIES 1.5   3 級與 4 級的交界、雜兵不加
//   承受層數          1／2／4，最少 1                    ENEMIES 1.5   修正 −9 不會是 0
//   位階的傷害倍率    ×0.4／×0.6／×1，只乘生命            ENEMIES 1.5   感載傷害不打折
//   難度係數          五個預設 ＋ 自訂（0.25～5、0.01 一步）  BALANCE 7.2、7.3   每格的下限−1、上限+1、NaN、字串；分段看敵人的等級
//   強度係數          一般 ×1、具名 ×1.3、遭遇指定；雜兵不乘    ENEMIES 第 13 節  4 人以上才乘
//   對決              1 人：精英 ×0.8／首領 ×0.35 與 ×0.5；2 人：首領 ×0.8；3 人以上 ×1   ENEMIES 第 13 節   1、2、3、4 人
//   遭遇的點數        1／2.5／5，高一級 ×1.75，強度係數乘上去   ENEMIES 第 13 節   最大組合、空的遭遇
//   士氣              雜兵 DC 13、精英 DC 10、首領不檢定   ENEMIES 4.4  DC 剛好／差 1；自然 1 與 20；倒了一半的邊；flee_below 的邊
//   自然 1 與 20      CORE_RULES 第 3 節                  每一個自然骰 × 合計
//
// 這份測試裡的「期望值」都是照規格的表另外寫一份（不 import ENEMY_CURVE）：程式的表抄錯了，這裡會抓到。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { BattleUnit, ContentPack, UnitRef } from '../../src'
import {
  CRIT_MARGIN, CLEAN_MARGIN, DC_LADDER, DIFFICULTY_ENEMY_COEF, clone, computeDegree, createKernel, dcFor, sanitizeRules, verdictOf,
} from '../../src'
import { ENCOUNTER_BUDGET, encounterPoints, enemiesFeature, enemyStats, setupFromEncounter } from '../../src/features/enemies'
import { TEST_COMBAT, makeState } from '../../src/testkit'
import { arena, duel, one } from '../helpers/battle'

// ---- 規格的表（ENEMIES 1.5 節；BALANCE 7.2 節） ----
type Rank = 'minion' | 'elite' | 'boss'
const RANKS: Rank[] = ['minion', 'elite', 'boss']
const GRADES = [1, 2, 3, 4, 5] as const
const HP: Record<Rank, number[]> = { minion: [45, 55, 67, 82, 100], elite: [110, 130, 165, 205, 250], boss: [260, 300, 380, 470, 580] }
const LOAD: Record<Rank, number[]> = { minion: [22, 27, 33, 40, 49], elite: [37, 45, 55, 67, 82], boss: [52, 63, 77, 94, 115] }
const ARMOR = [1, 2, 3, 4, 5]
const EVADE = [10, 12, 14, 16, 18]
const ATTACK = [3, 4, 5, 6, 7]
const AP: Record<Rank, number> = { minion: 4, elite: 5, boss: 6 }
const LAYERS: Record<Rank, number> = { minion: 1, elite: 2, boss: 4 }
const RANK_DMG: Record<Rank, number> = { minion: 0.4, elite: 0.6, boss: 1 }
const POINTS: Record<Rank, number> = { minion: 1, elite: 2.5, boss: 5 }
type Coef = { hp: number; dmg: number; load: number }
/** BALANCE 7.2 節：[首領, 雜兵與精英]，每格是 生命／傷害／感載上限 */
const DIFFS: Record<string, [Coef, Coef]> = {
  story: [{ hp: 0.6, dmg: 0.5, load: 0.6 }, { hp: 0.6, dmg: 0.4, load: 0.6 }],
  easy: [{ hp: 0.85, dmg: 0.8, load: 0.85 }, { hp: 0.85, dmg: 0.75, load: 0.85 }],
  normal: [{ hp: 1, dmg: 1, load: 1 }, { hp: 1, dmg: 1, load: 1 }],
  hard: [{ hp: 1.15, dmg: 1.35, load: 1.15 }, { hp: 1.15, dmg: 1.35, load: 1.15 }],
  legend: [{ hp: 1.3, dmg: 1.5, load: 1.3 }, { hp: 1.3, dmg: 1.7, load: 1.3 }],
}
const DC_OFFSET: Record<string, number> = { story: -2, easy: -1, normal: 0, hard: 1, legend: 2 }

/** 規格的「對決」：我方人數 → [生命, 傷害]（第 13 節）；4 人以上看強度係數。 */
function duelOf(rank: Rank, allies: number, strength: number): [number, number] {
  if (rank === 'minion') return [1, 1]
  if (allies >= 4) return [strength, strength]
  if (rank === 'elite') return allies <= 1 ? [0.8, 0.8] : [1, 1]
  if (allies <= 1) return [0.35, 0.5]
  if (allies === 2) return [0.8, 0.8]
  return [1, 1]
}

/** 四捨五入的結果：浮點的乘法順序不同會差一個最小單位，剛好壓在 .5 上時允許差 1，其餘要完全一樣。 */
function sameRounded(actual: number, exact: number): boolean {
  const frac = Math.abs(exact - Math.floor(exact) - 0.5)
  return frac < 1e-9 ? Math.abs(actual - Math.round(exact)) <= 1 : actual === Math.round(exact)
}

// ---- 測試用的內容 ----
const SKILLS = ['firearms', 'brawl', 'composure'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'firearms' ? 'reflex' : 'body', desc: `${id}。` }))
const WEAPON_CLASSES = [
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 1, traits: [], attr: 'reflex', skill: 'firearms' },
  { id: 'stun', name: '電擊', dice: 3, type: 'neural', range: [1, 1], cover_mult: 0, pierce: 0, traits: ['melee'], attr: 'body', skill: 'brawl' },
]
const baseEnemy = (id: string, rank: string, more: Record<string, unknown> = {}) => ({
  id, name: `兵${id}`, desc: '測試用的敵人。', faction: 'none', rank, grades: [1, 5], kind: 'human', position: { prefer: [1] }, mode: 'lethal',
  weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0.5 }, ...more,
})
const PACK: ContentPack = { id: 'enemies_boundary', content: { skill: SKILLS, weapon_class: WEAPON_CLASSES, faction: [], enemy: [] } }
const kernel = () => { const k = createKernel([enemiesFeature, TEST_COMBAT]); k.content.loadPack(PACK); return k }

// ---------------------------------------------------------------------------------------------
// 1. 目標表 × 兵種的修正 × 難度 × 強度 × 對決

const modsArb = fc.record({
  hp: fc.option(fc.double({ min: 0.5, max: 1.5, noNaN: true }), { nil: undefined }),
  load: fc.option(fc.double({ min: 0.5, max: 1.5, noNaN: true }), { nil: undefined }),
  armor: fc.option(fc.integer({ min: -2, max: 3 }), { nil: undefined }),
  evade: fc.option(fc.integer({ min: -3, max: 3 }), { nil: undefined }),
  attack: fc.option(fc.integer({ min: -3, max: 3 }), { nil: undefined }),
  ap: fc.option(fc.integer({ min: -1, max: 2 }), { nil: undefined }),
  layers: fc.option(fc.integer({ min: -9, max: 3 }), { nil: undefined }),
  sensitivity: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
}).map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)))

const coefArb = fc.record({ hp: fc.integer({ min: 25, max: 500 }), dmg: fc.integer({ min: 25, max: 500 }), load: fc.integer({ min: 25, max: 500 }) }).map((c): Coef => ({ hp: c.hp / 100, dmg: c.dmg / 100, load: c.load / 100 }))
const difficultyArb = fc.oneof(
  fc.constantFrom('story', 'easy', 'normal', 'hard', 'legend').map((d) => ({ difficulty: d, boss: DIFFS[d]![0], minions: [DIFFS[d]![1], DIFFS[d]![1], DIFFS[d]![1]] })),
  fc.record({ boss: coefArb, a: coefArb, b: coefArb, c: coefArb }).map((r) => ({ difficulty: 'custom', boss: r.boss, minions: [r.a, r.b, r.c] })),
)
const stateWith = (d: { difficulty: string; boss: Coef; minions: Coef[] }) =>
  ({ ...makeState(), rules: sanitizeRules({ difficulty: d.difficulty, enemyCoef: { boss: d.boss, minions: d.minions } }) })
/** 等級在哪一段：I～II、III、IV～V（BALANCE 7.3 節，看敵人的等級） */
const band = (g: number) => (g <= 2 ? 0 : g === 3 ? 1 : 2)

describe('邊界 ENEMIES 1.5／第 13 節／BALANCE 7：敵人的數字', () => {
  const k = kernel()
  let n = 0
  it('性質：每一個位階 × 等級 × 兵種修正 × 難度（預設與自訂）× 我方人數 × 強度，單位的數字照規格的表算', () => {
    fc.assert(fc.property(
      fc.constantFrom(...RANKS), fc.constantFrom(...GRADES), modsArb, difficultyArb, fc.integer({ min: 0, max: 8 }),
      fc.option(fc.integer({ min: 1, max: 20 }).map((x) => x / 10), { nil: undefined }), fc.boolean(), fc.constantFrom('human', 'machine', 'lace'),
      (rank, grade, mods, diff, allies, strength, named, kind) => {
        const id = `en_p${n++}`
        k.content.load('enemy', [baseEnemy(id, rank, { mods, named, kind })])
        const st = enemyStats(k, stateWith(diff), id, { grade, allies, ...(strength !== undefined ? { strength } : {}) })
        const g = grade - 1
        const m = mods as Record<string, number | undefined>
        const c = rank === 'boss' ? diff.boss : diff.minions[band(grade)]!
        const base = rank === 'minion' ? 1 : (strength ?? (named ? 1.3 : 1))
        const [sHp, sDmg] = duelOf(rank, allies, base)
        // 自訂的係數會先夾在 0.25～5、取到 0.01（這裡產生的已經在範圍裡）
        expect(sameRounded(st.hp, HP[rank][g]! * (m.hp ?? 1) * c.hp * sHp), `生命 ${st.hp}`).toBe(true)
        if (kind === 'human' || kind === 'lace') expect(sameRounded(st.load!, LOAD[rank][g]! * (m.load ?? 1) * c.load), `感載 ${st.load}`).toBe(true)
        else expect(st.load, '沒有橋的沒有感載').toBeUndefined()
        expect(st.armor).toBe(Math.max(0, ARMOR[g]! + (m.armor ?? 0))) // 護甲最少 0（ENEMIES 第 2 節）
        expect(st.evade).toBe(EVADE[g]! + (m.evade ?? 0))
        expect(st.attack).toBe(ATTACK[g]! + (m.attack ?? 0))
        expect(st.ap).toBe(Math.max(1, AP[rank] + (rank !== 'minion' && grade >= 4 ? 1 : 0) + (m.ap ?? 0))) // 行動點最少 1
        expect(st.layers).toBe(Math.max(1, LAYERS[rank] + (m.layers ?? 0)))
        expect(st.sensitivity).toBe(m.sensitivity ?? 50)
        // 傷害倍率：生命的傷害 = 位階倍率 × 難度 × 強度（對決）；感載的傷害不吃位階倍率
        expect(st.dmgMult.hp).toBeCloseTo(RANK_DMG[rank] * c.dmg * sDmg, 9)
        expect(st.dmgMult.load).toBeCloseTo(c.dmg * sDmg, 9)
        expect(st.grade).toBe(grade)
        expect(st.rank).toBe(rank)
      }), { numRuns: 400 })
  })

  it('整張表的每一格（普通難度、4 人、強度 1）：和規格一字不差；等級的下限 1 與上限 5', () => {
    const s = makeState()
    for (const rank of RANKS) {
      k.content.load('enemy', [baseEnemy(`en_t_${rank}`, rank)])
      GRADES.forEach((grade, g) => {
        const st = enemyStats(k, s, `en_t_${rank}`, { grade })
        expect(st, `${rank} ${grade}`).toMatchObject({ hp: HP[rank][g], load: LOAD[rank][g], armor: ARMOR[g], evade: EVADE[g], attack: ATTACK[g], layers: LAYERS[rank], sensitivity: 50 })
      })
    }
  })

  it('等級夾在 1～5：0、−3 夾成 I 級；6、999、Infinity 夾成 V 級；小數無條件捨去（2.9 是 II 級）', () => {
    const s = makeState()
    k.content.load('enemy', [baseEnemy('en_clamp', 'elite')])
    for (const [input, grade] of [[0, 1], [-3, 1], [1, 1], [5, 5], [6, 5], [999, 5], [Infinity, 5], [2.9, 2], [1.999, 1], [4.0001, 4]] as const) {
      expect(enemyStats(k, s, 'en_clamp', { grade: input }).grade, `輸入 ${input}`).toBe(grade)
    }
  })

  it('行動點：III 級與 IV 級的交界——雜兵不加、精英與首領從 IV 級起 +1；最大組合（V 級首領 mods.ap +2）是 9', () => {
    const s = makeState()
    for (const rank of RANKS) k.content.load('enemy', [baseEnemy(`en_ap_${rank}`, rank), baseEnemy(`en_apx_${rank}`, rank, { mods: { ap: 2 } })])
    expect([1, 2, 3, 4, 5].map((grade) => enemyStats(k, s, 'en_ap_minion', { grade }).ap)).toEqual([4, 4, 4, 4, 4])
    expect([1, 2, 3, 4, 5].map((grade) => enemyStats(k, s, 'en_ap_elite', { grade }).ap)).toEqual([5, 5, 5, 6, 6])
    expect([1, 2, 3, 4, 5].map((grade) => enemyStats(k, s, 'en_ap_boss', { grade }).ap)).toEqual([6, 6, 6, 7, 7])
    expect(enemyStats(k, s, 'en_apx_boss', { grade: 5 }).ap).toBe(9)
  })

  it('承受層數的下限：修正再低也至少 1 層（精英 −9、首領 −9、雜兵 −1 都是 1）', () => {
    const s = makeState()
    for (const rank of RANKS) k.content.load('enemy', [baseEnemy(`en_ly_${rank}`, rank, { mods: { layers: -9 } })])
    for (const rank of RANKS) expect(enemyStats(k, s, `en_ly_${rank}`, { grade: 3 }).layers).toBe(1)
  })

  it('兵種修正的下限與上限：hp 0.5、1.5（資料格式的邊）剛好收；0.49、1.51、NaN、字串被擋', () => {
    const load = (hp: unknown) => createKernel([enemiesFeature]).content.validate('enemy', [baseEnemy('en_v', 'minion', { mods: { hp } })]).join('\n')
    expect(load(0.5)).toBe('')
    expect(load(1.5)).toBe('')
    for (const bad of [0.49, 1.51, 0, -1, NaN, Infinity, '1', null]) expect(load(bad), String(bad)).toMatch(/mods\.hp/)
  })

  it('對決的表：1、2、3、4 人 × 精英／首領（沒有難度、沒有強度的普通情況）', () => {
    const s = makeState()
    k.content.load('enemy', [baseEnemy('en_d_elite', 'elite'), baseEnemy('en_d_boss', 'boss'), baseEnemy('en_d_named', 'boss', { named: true })])
    const at = (id: string, allies: number) => enemyStats(k, s, id, { grade: 1, allies })
    expect([1, 2, 3, 4].map((a) => at('en_d_elite', a).hp)).toEqual([88, 110, 110, 110])
    expect([1, 2, 3, 4].map((a) => at('en_d_elite', a).dmgMult.hp)).toEqual([0.6 * 0.8, 0.6, 0.6, 0.6])
    expect([1, 2, 3, 4].map((a) => at('en_d_boss', a).hp)).toEqual([91, 208, 260, 260])
    expect([1, 2, 3, 4].map((a) => at('en_d_boss', a).dmgMult.hp)).toEqual([0.5, 0.8, 1, 1])
    // 具名的首領：4 人以上 ×1.3；少於 4 人不乘具名的係數，改乘對決的表
    expect([1, 2, 3, 4, 5].map((a) => at('en_d_named', a).hp)).toEqual([91, 208, 260, 338, 338])
  })

  it('強度係數：遭遇指定的蓋過兵種自己的；雜兵一律不乘；人數少於 4 時遭遇指定的也不乘', () => {
    const s = makeState()
    k.content.load('enemy', [baseEnemy('en_s_elite', 'elite', { strength: 1.2 }), baseEnemy('en_s_minion', 'minion', { strength: 2, named: true })])
    expect(enemyStats(k, s, 'en_s_elite', { grade: 1 }).hp).toBe(132)
    expect(enemyStats(k, s, 'en_s_elite', { grade: 1, strength: 1.5 }).hp).toBe(165)
    expect(enemyStats(k, s, 'en_s_elite', { grade: 1, strength: 1.5, allies: 3 }).hp).toBe(110)
    expect(enemyStats(k, s, 'en_s_minion', { grade: 1, strength: 3 }).hp).toBe(45) // 雜兵不乘
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 難度的存檔規則：預設五個與自訂的範圍

describe('邊界 BALANCE 7.2／7.3：難度的係數與 DC 的偏移', () => {
  it('預設的五個難度：敵人的係數與 DC 的偏移和規格的表一字不差；存檔裡亂寫的 enemyCoef 不會蓋過預設', () => {
    for (const [d, [boss, minion]] of Object.entries(DIFFS)) {
      const r = sanitizeRules({ difficulty: d, enemyCoef: { boss: { hp: 99, dmg: 99, load: 99 } }, dcOffset: 4 })
      expect(r.enemyCoef.boss, d).toEqual(boss)
      expect(r.enemyCoef.minions, d).toEqual([minion, minion, minion])
      expect(r.dcOffset, d).toBe(DC_OFFSET[d])
      expect(DIFFICULTY_ENEMY_COEF[d as 'story']).toEqual({ boss, minions: [minion, minion, minion] })
    }
  })

  it('自訂每格的邊：下限 0.25 剛好、0.24 與負數夾成 0.25；上限 5 剛好、5.01 與 1e9 夾成 5；兩位小數；NaN、字串、缺的補普通的 1', () => {
    const one_ = (v: unknown) => sanitizeRules({ difficulty: 'custom', enemyCoef: { boss: { hp: v, dmg: 1, load: 1 }, minions: [] } }).enemyCoef.boss.hp
    expect(one_(0.25)).toBe(0.25)
    expect(one_(0.24)).toBe(0.25)
    expect(one_(0)).toBe(0.25)
    expect(one_(-3)).toBe(0.25)
    expect(one_(5)).toBe(5)
    expect(one_(5.01)).toBe(5)
    expect(one_(1e9)).toBe(5)
    expect(one_(1.234)).toBe(1.23)
    expect(one_(1.235)).toBeCloseTo(1.24, 2)
    // 不是有限的數字（NaN、Infinity）、字串、空的：用普通難度的 1
    for (const bad of [NaN, Infinity, -Infinity, 'x', null, undefined, {}, []]) expect(one_(bad), String(bad)).toBe(1)
  })

  it('性質：自訂的任何輸入（亂數的數字）出來都在 0.25～5、至多兩位小數；DC 偏移在 −4～+4 的整數；其餘的格子照樣填滿', () => {
    fc.assert(fc.property(
      fc.array(fc.oneof(fc.double(), fc.integer(), fc.string(), fc.constant(null)), { minLength: 0, maxLength: 12 }), fc.oneof(fc.double(), fc.integer({ min: -50, max: 50 })),
      (xs, dc) => {
        const at = (i: number) => xs[i % Math.max(1, xs.length)]
        const raw = { difficulty: 'custom', dcOffset: dc, enemyCoef: { boss: { hp: at(0), dmg: at(1), load: at(2) }, minions: [{ hp: at(3), dmg: at(4), load: at(5) }, { hp: at(6) }, 7] } }
        const r = sanitizeRules(raw)
        const all = [r.enemyCoef.boss, ...r.enemyCoef.minions].flatMap((c) => [c.hp, c.dmg, c.load])
        expect(all).toHaveLength(12)
        for (const v of all) {
          expect(v).toBeGreaterThanOrEqual(0.25)
          expect(v).toBeLessThanOrEqual(5)
          expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9)
        }
        expect(Number.isInteger(r.dcOffset)).toBe(true)
        expect(r.dcOffset).toBeGreaterThanOrEqual(-4)
        expect(r.dcOffset).toBeLessThanOrEqual(4)
      }), { numRuns: 300 })
  })

  it('DC 偏移：自訂 −4 與 +4 剛好、−5 與 +5 夾住、小數取整；dcFor 把寫成檔位的 DC 加上偏移', () => {
    const off = (v: unknown) => sanitizeRules({ difficulty: 'custom', dcOffset: v }).dcOffset
    expect([off(-4), off(4), off(-5), off(5), off(-1e9), off(1e9), off(2.4), off(NaN), off(undefined)]).toEqual([-4, 4, -4, 4, -4, 4, 2, 0, 0])
    for (const tier of DC_LADDER) expect(dcFor(tier, { dcOffset: -4 })).toBe(tier - 4)
    expect(dcFor('hard' as never, { dcOffset: 0 })).toBe(16)
  })

  it('敵人的係數看敵人的等級，不看區的等級：自訂三段（I～II、III、IV～V）；首領只有一組', () => {
    const state = stateWith({ difficulty: 'custom', boss: { hp: 2, dmg: 1, load: 1 }, minions: [{ hp: 0.5, dmg: 1, load: 1 }, { hp: 0.75, dmg: 1, load: 1 }, { hp: 1.5, dmg: 1, load: 1 }] })
    const k = kernel()
    k.content.load('enemy', [baseEnemy('en_b_minion', 'minion'), baseEnemy('en_b_elite', 'elite'), baseEnemy('en_b_boss', 'boss')])
    const hp = (id: string, grade: number) => enemyStats(k, state, id, { grade }).hp
    expect([1, 2, 3, 4, 5].map((g) => hp('en_b_minion', g))).toEqual([22.5, 27.5, 67 * 0.75, 82 * 1.5, 100 * 1.5].map(Math.round))
    expect([1, 2, 3, 4, 5].map((g) => hp('en_b_elite', g))).toEqual([55, 65, 165 * 0.75, 205 * 1.5, 250 * 1.5].map(Math.round))
    expect([1, 2, 3, 4, 5].map((g) => hp('en_b_boss', g))).toEqual([520, 600, 760, 940, 1160])
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 遭遇的點數

describe('邊界 ENEMIES 第 13 節：遭遇的點數與預算', () => {
  const k = kernel()
  k.content.load('enemy', [
    ...RANKS.map((r) => baseEnemy(`en_${r}`, r)),
    baseEnemy('en_named_boss', 'boss', { named: true }),
    baseEnemy('en_narrow', 'minion', { grades: [3, 4] }),
  ])
  const foeArb = fc.record({
    enemy: fc.constantFrom('en_minion', 'en_elite', 'en_boss', 'en_named_boss'),
    grade: fc.option(fc.constantFrom(...GRADES), { nil: undefined }),
    strength: fc.option(fc.integer({ min: 10, max: 20 }).map((x) => x / 10), { nil: undefined }),
  }).map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as { enemy: string; grade?: number; strength?: number })

  it('預算的四個數字：輕 2、一般 4、重 5.5、首領戰 8，每一級都一樣', () => {
    expect(ENCOUNTER_BUDGET).toEqual({ light: 2, normal: 4, heavy: 5.5, boss: 8 })
  })

  it('性質：點數 = 每個敵人 位階的點數 ×（高一級 1.75）×（精英與首領的強度係數）的總和；空的遭遇是 0；順序不影響', () => {
    fc.assert(fc.property(fc.array(foeArb, { maxLength: 10 }), fc.constantFrom(...GRADES), (foes, scene) => {
      const named = (id: string) => id === 'en_named_boss'
      const want = foes.reduce((sum, f) => {
        const rank = (f.enemy.replace('en_named_', '').replace('en_', '') as Rank)
        const grade = f.grade ?? scene // 兵種的等級範圍是 1～5，不夾
        const s = rank === 'minion' ? 1 : (f.strength ?? (named(f.enemy) ? 1.3 : 1))
        return sum + POINTS[rank] * (grade >= scene + 1 ? 1.75 : 1) * s
      }, 0)
      expect(encounterPoints(k, foes, scene)).toBeCloseTo(want, 9)
      expect(encounterPoints(k, [...foes].reverse(), scene)).toBeCloseTo(want, 9)
    }), { numRuns: 300 })
  })

  it('規格裡寫出來的例子：高一級 2 雜兵加 1 同級雜兵 = 4.5 點（3.5 + 1）；高一級 1 精英加 1 同級雜兵 ≈ 5.4；×1.5 的具名首領 = 7.5 點', () => {
    expect(encounterPoints(k, [{ enemy: 'en_minion', grade: 3 }, { enemy: 'en_minion', grade: 3 }, { enemy: 'en_minion', grade: 2 }], 2)).toBe(4.5)
    expect(encounterPoints(k, [{ enemy: 'en_elite', grade: 3 }, { enemy: 'en_minion', grade: 2 }], 2)).toBeCloseTo(5.375, 9)
    expect(encounterPoints(k, [{ enemy: 'en_boss', strength: 1.5 }], 2)).toBe(7.5)
    expect(encounterPoints(k, [{ enemy: 'en_named_boss' }], 2)).toBeCloseTo(6.5, 9)
  })

  it('邊上：同級不加、低一級不減、高一級才 ×1.75（剛好 +1）；沒寫等級時場景的等級夾進兵種的等級範圍再比', () => {
    expect(encounterPoints(k, [{ enemy: 'en_minion', grade: 2 }], 2)).toBe(1)
    expect(encounterPoints(k, [{ enemy: 'en_minion', grade: 1 }], 2)).toBe(1)
    expect(encounterPoints(k, [{ enemy: 'en_minion', grade: 3 }], 2)).toBe(1.75)
    expect(encounterPoints(k, [], 3)).toBe(0)
    // 這個兵種只出現在 III～IV 級；放在 I 級的場景：照最近的 III 級算數值（ENEMIES 1.6），比場景高 2 級 → 高一級以上 ×1.75
    expect(encounterPoints(k, [{ enemy: 'en_narrow' }], 1)).toBe(1.75)
    expect(encounterPoints(k, [{ enemy: 'en_narrow' }], 3)).toBe(1)
    expect(encounterPoints(k, [{ enemy: 'en_narrow' }], 5)).toBe(1) // 夾在 IV 級，比場景低
  })

  it('開打的設定：遭遇的每個敵人都帶上；沒寫勢力時取位階最高的那一個的勢力（一樣高取前面的）', () => {
    k.content.load('faction', [{ id: 'fa', name: 'A', short: 'A', class: 'corp' }, { id: 'fb', name: 'B', short: 'B', class: 'corp' }])
    k.content.load('enemy', [baseEnemy('en_fa', 'elite', { faction: 'fa' }), baseEnemy('en_fb', 'elite', { faction: 'fb' }), baseEnemy('en_fm', 'minion', { faction: 'fb' })])
    k.content.load('encounter', [{ id: 'enc_x', name: 'x', grade: 2, cover: 'medium', foes: [{ enemy: 'en_fm' }, { enemy: 'en_fa' }, { enemy: 'en_fb' }] }])
    const setup = setupFromEncounter(k, makeState(), 'enc_x', { allies: [] })
    expect(setup.foes).toHaveLength(3)
    expect(setup.origin?.faction).toBe('fa')
  })
})

// ---------------------------------------------------------------------------------------------
// 4. 士氣（ENEMIES 4.4 節）與自然 1／20（CORE_RULES 第 3 節）

describe('邊界 ENEMIES 4.4 節：士氣', () => {
  const PACK2: ContentPack = {
    id: 'morale',
    content: {
      skill: SKILLS, weapon_class: WEAPON_CLASSES, faction: [],
      enemy: RANKS.map((r) => baseEnemy(`en_${r}`, r)),
    },
  }
  /** 我方 m 人、敵方 n 人（第一個是被測的那個，其餘是同位階的同伴；首領戰的場上另有一個首領）。 */
  function field(rank: Rank, n: number, m: number) {
    const foes: UnitRef[] = Array.from({ length: n }, () => ({ from: 'enemy', id: `en_${rank}`, grade: 1 }) as UnitRef)
    const setup = { ...duel(Array.from({ length: m }, (_, i) => one({}, i + 1)), []), foes }
    const a = arena(setup, [enemiesFeature, TEST_COMBAT], (kk) => kk.content.loadPack(PACK2))
    return a
  }
  const tryMorale = (a: ReturnType<typeof field>, u: BattleUnit, dice: number[]) => a.k.battle.emit('ai.step', { run: a.run(dice), unit: u })

  it('DC：雜兵 13、精英 10；剛好等於 DC 過、少 1 不過（擲骰的組合：自然 2～19，意志 mod 與定力不同）', () => {
    fc.assert(fc.property(fc.constantFrom<Rank>('minion', 'elite'), fc.integer({ min: 2, max: 19 }), fc.integer({ min: 4, max: 24 }), fc.integer({ min: 0, max: 6 }), (rank, nat, resolve, comp) => {
      const a = field(rank, 1, 1)
      const u = a.foe(1)
      u.attrs.resolve = resolve
      u.skills = { composure: comp }
      // 用 flee_below 1 與「只少一點」的生命來觸發：生命還在一半以上，沒有重傷的 −2（CORE_RULES 4.1 節）
      u.hp = { now: 19, max: 20 }
      u.ai!.fleeBelow = 1
      const dc = rank === 'minion' ? 13 : 10
      const total = nat + Math.floor((resolve - 10) / 2) + comp
      const handled = tryMorale(a, u, [nat])
      expect(handled, `${rank} 自然 ${nat} 合計 ${total}`).toBe(total < dc)
      expect(u.uses.morale).toBe(1)
      expect(u.out === undefined || u.out === null || u.out === 'fled' || u.out === 'surrendered').toBe(true)
    }), { numRuns: 200 })
  })

  it('自然 20 一定過、自然 1 一定不過：定力與意志再高也一樣（DC 13：意志 24 的 +7 加定力 6）；意志再低自然 20 照過', () => {
    for (const [nat, passes] of [[20, true], [1, false]] as const) {
      const a = field('minion', 1, 1)
      const u = a.foe(1)
      u.attrs.resolve = nat === 20 ? 4 : 24
      u.skills = { composure: nat === 20 ? 0 : 6 }
      u.hp!.now = 1
      expect(tryMorale(a, u, [nat]), `自然 ${nat}`).toBe(!passes)
    }
  })

  it('撤退或投降：對方還站著的人數 ≥ 自己這一方的兩倍才投降（1 對 2 投降；2 對 3 撤退；2 對 4 投降）；倒下的不算站著', () => {
    for (const [mine, theirs, want] of [[1, 1, 'fled'], [1, 2, 'surrendered'], [2, 3, 'fled'], [2, 4, 'surrendered'], [3, 5, 'fled'], [3, 6, 'surrendered'], [1, 4, 'surrendered']] as const) {
      const a = field('minion', mine, theirs)
      const u = a.foe(1)
      u.hp!.now = 1
      expect(tryMorale(a, u, [2]), `${mine} 對 ${theirs}`).toBe(true)
      expect(u.out, `${mine} 對 ${theirs}`).toBe(want)
    }
    // 倒下的不算站著：6 個人對 2 個敵人，倒 2 個剩 4 ≥ 4 投降；倒 3 個剩 3 < 4 撤退
    for (const [down, want] of [[0, 'surrendered'], [2, 'surrendered'], [3, 'fled']] as const) {
      const a = field('minion', 2, 6)
      for (let i = 1; i <= down; i++) a.ally(i).out = 'down'
      a.foe(1).hp!.now = 1
      tryMorale(a, a.foe(1), [2])
      expect(a.foe(1).out, `倒 ${down} 個`).toBe(want)
    }
  })

  it('生命比例的邊：低於 flee_below 才檢定（嚴格小於）：10 點生命 flee_below 0.5，剩 5（剛好 0.5）不擲、剩 4 擲', () => {
    for (const [now, rolls] of [[10, false], [6, false], [5, false], [4, true], [1, true], [0, true]] as const) {
      const a = field('minion', 1, 1)
      const u = a.foe(1)
      u.hp = { now, max: 10 }
      tryMorale(a, u, [2])
      expect(u.uses.morale !== undefined, `生命 ${now}／10`).toBe(rolls)
    }
  })

  it('同伴倒了一半（雜兵）：用開打時的人數算，倒下 ×2 ≥ 開打時的人數才擲；4 人倒 1 不擲、倒 2 擲；3 人倒 1 不擲、倒 2 擲；1 人本身倒了也算', () => {
    for (const [total, down, rolls] of [[4, 1, false], [4, 2, true], [4, 3, true], [3, 1, false], [3, 2, true], [2, 1, true], [5, 2, false], [5, 3, true], [6, 3, true], [6, 2, false]] as const) {
      const a = field('minion', total, 1)
      for (let i = 0; i < down; i++) a.foe(total - i).out = 'down'
      tryMorale(a, a.foe(1), [2])
      expect(a.foe(1).uses.morale !== undefined, `${total} 人倒 ${down}`).toBe(rolls)
    }
  })

  it('精英：同伴倒了一半不擲；只有首領倒下（或生命低於 flee_below）才擲；首領本人從來不擲', () => {
    const a = field('elite', 4, 1)
    for (const i of [2, 3, 4]) a.foe(i).out = 'down'
    tryMorale(a, a.foe(1), [2])
    expect(a.foe(1).uses.morale).toBeUndefined()
    // 首領倒下
    const b = arena({ ...duel([one()], []), foes: [{ from: 'enemy', id: 'en_elite', grade: 1 } as UnitRef, { from: 'enemy', id: 'en_boss', grade: 1 } as UnitRef, { from: 'enemy', id: 'en_minion', grade: 1 } as UnitRef] }, [enemiesFeature, TEST_COMBAT], (kk) => kk.content.loadPack(PACK2))
    b.foe(2).out = 'down'
    for (const i of [1, 3]) expect(tryMorale(b, b.foe(i), [2]), `單位 ${i}`).toBe(true)
    const c = arena({ ...duel([one()], []), foes: [{ from: 'enemy', id: 'en_boss', grade: 1 } as UnitRef] }, [enemiesFeature, TEST_COMBAT], (kk) => kk.content.loadPack(PACK2))
    c.foe(1).hp!.now = 1
    expect(tryMorale(c, c.foe(1), [1])).toBe(false)
    expect(c.foe(1).uses.morale).toBeUndefined()
  })

  it('每場只擲一次：第二次呼叫不擲（骰面不被用掉）、沒過的已經退出之後也不再處理', () => {
    const a = field('minion', 1, 1)
    const u = a.foe(1)
    u.hp!.now = 1
    const run = a.run([20, 1, 1])
    expect(a.k.battle.emit('ai.step', { run, unit: u })).toBe(false)
    expect(a.k.battle.emit('ai.step', { run, unit: u })).toBe(false) // 第二次：已經擲過
    expect(u.uses.morale).toBe(1)
  })
})

describe('邊界 CORE_RULES 第 3 節：自然 1 與 20、成功程度的邊', () => {
  it('窮舉：自然 1～20 × 合計與 DC 的差 −12～+12：自然 20 大成功、自然 1 大失敗；其餘 ≥ +5 大成功、≥ 0 成功、≤ −5 大失敗、其餘失敗', () => {
    expect(CRIT_MARGIN).toBe(5)
    expect(CLEAN_MARGIN).toBe(3)
    for (let nat = 1; nat <= 20; nat++) {
      for (let margin = -12; margin <= 12; margin++) {
        const want = nat === 20 ? 'critical' : nat === 1 ? 'fumble' : margin >= 5 ? 'critical' : margin <= -5 ? 'fumble' : margin >= 0 ? 'success' : 'fail'
        expect(computeDegree(nat, 13 + margin, 13), `自然 ${nat} 差 ${margin}`).toBe(want)
      }
    }
  })

  it('成功再看差距：成功的 margin 0、1、2 是「是，但是」，3 以上是「是」；大成功「是，而且」；失敗「不，但是」；大失敗「不，而且」', () => {
    expect([0, 1, 2, 3, 4].map((m) => verdictOf('success', m))).toEqual(['yes_but', 'yes_but', 'yes_but', 'yes', 'yes'])
    expect(verdictOf('critical', 0)).toBe('yes_and')
    expect(verdictOf('fail', -1)).toBe('no_but')
    expect(verdictOf('fumble', -20)).toBe('no_and')
  })

  it('性質：合計不管多大，自然 1 就是大失敗；合計不管多小，自然 20 就是大成功（含負的、極端的 DC）', () => {
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }), (total, dc) => {
      expect(computeDegree(1, total, dc)).toBe('fumble')
      expect(computeDegree(20, total, dc)).toBe('critical')
    }))
  })

  it('不被複製的常數：資料與設定壞掉時 clone 出來的規則仍是完整的一份（難度表不被改動）', () => {
    const before = clone(DIFFICULTY_ENEMY_COEF)
    const r = sanitizeRules({ difficulty: 'hard' })
    r.enemyCoef.boss.hp = 99
    r.enemyCoef.minions[0]!.dmg = 99
    expect(DIFFICULTY_ENEMY_COEF).toEqual(before)
  })
})
