// 邊界測試：建角的數值（CHARACTER 第 1 節第 3、4、7 步，5.1、5.3、5.6 節；UI 第 14 節的年齡）。cpp-tester-boundary 寫的。
//
// 每一個數值都測：下限、下限−1、上限、上限+1、零、空、最大組合；再用 fast-check 拿「規格寫的條件」當預言，
// 隨機的草稿被收或被擋，要和預言一模一樣，被收的草稿提交之後狀態合法（不變式 7、12、32）。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { AttrId, ContentPack, Game } from '../../src'
import { ATTR_IDS, SKILL_MAX, sanitizeRules, validateActor } from '../../src'
import type { CreationDraft } from '../../src/features/creation'
import { ageBlock, attrBlock, buildCreationReport, creationBlocks, creationFeature, perkBlock, skillBlock } from '../../src/features/creation'
import { makeGame, observed } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const ARRAY = [15, 14, 13, 12, 10, 8]
/** 規格的數字（CHARACTER 5.1、5.3、5.6 節） */
const SPEC = { attrFree: 2, attrMin: 4, attrMax: 18, skillPoints: 10, skillMax: 3, skillCap: 6, perkPoints: 4, perkMax: 8, flawMax: 2 }

/**
 * 特質多一點的內容包：十個 1 點的特質、三個 3 點的特質、四個缺陷（退 1～3 點），才湊得到「特質 8 個」「缺陷 2 個」的邊。
 * 出身與基本功沿用 MINI_PACK。
 */
const PERK_PACK: ContentPack = {
  id: 'boundary_perks',
  content: {
    perk: [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `cheap_${i}`, name: `便宜的特質 ${i}`, category: 'street', cost: 1, flaw: false, desc: '很窄的情境 +2。' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `dear_${i}`, name: `貴的特質 ${i}`, category: 'social', cost: 3, flaw: false, desc: '兩格的效果。' })),
      { id: 'flaw_1', name: '小缺陷', category: 'body', cost: 1, flaw: true, desc: '很少碰到。' },
      { id: 'flaw_2', name: '中缺陷', category: 'body', cost: 2, flaw: true, desc: '有時碰到。' },
      { id: 'flaw_3a', name: '大缺陷甲', category: 'body', cost: 3, flaw: true, desc: '常常碰到。' },
      { id: 'flaw_3b', name: '大缺陷乙', category: 'social', cost: 3, flaw: true, desc: '常常碰到。' },
    ],
  },
}
const CHEAP = Array.from({ length: 10 }, (_, i) => `cheap_${i}`)
const DEAR = ['dear_0', 'dear_1', 'dear_2']
const FLAWS = ['flaw_1', 'flaw_2', 'flaw_3a', 'flaw_3b']
const COST: Record<string, number> = { ...Object.fromEntries(CHEAP.map((p) => [p, 1])), ...Object.fromEntries(DEAR.map((p) => [p, 3])), flaw_1: 1, flaw_2: 2, flaw_3a: 3, flaw_3b: 3 }

function setup(rules: Record<string, unknown> = {}): Game {
  return makeGame({ scenario: 'beforeCreation', features: [creationFeature], content: [MINI_PACK, PERK_PACK], patch: { rules: sanitizeRules(rules) } }).game
}

/** 一份合格的草稿（CHARACTER 5.1 節的例子）。 */
const draft = (over: Partial<CreationDraft> = {}): CreationDraft => ({
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: '孤星連' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: [],
  ...over,
})

const PICK: Record<AttrId, number> = { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 }

// ---------------------------------------------------------------------------------------------
// 第 1 步：年齡（UI 第 14 節：低於 18 擋下）

describe('邊界 CHARACTER 第 1 步：年齡', () => {
  it('下限 18 收、17 擋；零、負數、空、只有空白擋；頭尾空白不算；小數與指數寫法擋', () => {
    expect(ageBlock(18)).toBeNull()
    expect(ageBlock('18')).toBeNull()
    expect(ageBlock(' 18 ')).toBeNull()
    expect(ageBlock(17)).not.toBeNull()
    expect(ageBlock('17')).not.toBeNull()
    expect(ageBlock(0)).not.toBeNull()
    expect(ageBlock(-18)).not.toBeNull()
    expect(ageBlock('')).not.toBeNull()
    expect(ageBlock('   ')).not.toBeNull()
    expect(ageBlock('17.9')).not.toBeNull()
    expect(ageBlock('18.0')).not.toBeNull()
    expect(ageBlock(1e21)).not.toBeNull()
    expect(ageBlock(Number.NaN)).not.toBeNull()
  })

  it('性質：任何整數年齡，收不收只看 18 ≤ 年齡 ≤ 200；收下的提交之後主角的年齡 ≥ 18（不變式 12）', () => {
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), (age) => (ageBlock(age) === null) === (age >= 18 && age <= 200)))
    const game = setup()
    fc.assert(fc.property(fc.integer({ min: 18, max: 200 }), fc.constantFrom('', ' ', '0'), (age, pad) => {
      const raw = `${pad}${age} `
      const blocks = creationBlocks(game.k, game.state, draft({ age: raw }))
      if (blocks.length) return false
      return buildCreationReport(game.k, game.state, draft({ age: raw })).changes.some((c) => c.op === 'actor.add' && (c as unknown as { actor: { age: number } }).actor.age === age)
    }))
  })
})

// ---------------------------------------------------------------------------------------------
// 第 3 步：屬性（5.1 節）

describe('邊界 CHARACTER 5.1：屬性 4～18、自由點數 2、往下壓一點換一點', () => {
  it('上限 18 收、19 擋；下限 4 收、3 擋（自由點數都剛好用完）', () => {
    const k = setup().k
    expect(attrBlock(k, PICK, { reflex: 3, tech: -1 })).toBeNull() // 反應 18
    expect(attrBlock(k, PICK, { reflex: 4, tech: -2 })).toMatch(/18/) // 反應 19
    expect(attrBlock(k, PICK, { tech: -4, reflex: 3, resolve: 3 })).toBeNull() // 技術 4
    expect(attrBlock(k, PICK, { tech: -5, reflex: 3, resolve: 3, charm: 1 })).toMatch(/最低 4/) // 技術 3
  })

  it('自由點數：剛好用完收；剩 1 點擋；多花 1 點擋；零（不動）擋，因為還有 2 點', () => {
    const k = setup().k
    expect(attrBlock(k, PICK, { charm: 2 })).toBeNull()
    expect(attrBlock(k, PICK, { charm: 1 })).toMatch(/1 點自由點數沒有用/)
    expect(attrBlock(k, PICK, { charm: 3 })).toMatch(/自由點數只有 2 點/)
    expect(attrBlock(k, PICK, {})).toMatch(/2 點自由點數沒有用/)
  })

  it('最大組合：五項都壓到 4，換來的點數全部堆到一項 —— 堆不下（超過 18）就擋；能分完的才收', () => {
    const k = setup().k
    // 15、14、13、12、10 壓到 4：多 11+10+9+8+6 = 44 點，加 2 點 = 46 點；技術 8 最多加到 18（10 點），其餘 36 點沒地方放
    const allDown = { reflex: -11, charm: -10, intellect: -9, body: -8, resolve: -6 }
    expect(attrBlock(k, PICK, { ...allDown, tech: 10 })).toMatch(/還有 36 點/)
    expect(attrBlock(k, PICK, { ...allDown, tech: 46 })).toMatch(/18/)
    // 合計永遠是 72 + 2 = 74；四項 18、兩項 1 不行（低於 4），三項 18、兩項 4、一項 12 可以
    const pick = PICK
    const target = { reflex: 18, charm: 18, intellect: 18, body: 4, resolve: 4, tech: 12 }
    const bonus = Object.fromEntries(ATTR_IDS.map((a) => [a, target[a] - pick[a]]))
    expect(attrBlock(k, pick, bonus)).toBeNull()
  })

  it('空：沒有分配的項、同一個數字用兩次、不在陣列裡的數字、小數與 NaN 的增減，都擋', () => {
    const k = setup().k
    expect(attrBlock(k, {}, {})).toMatch(/6 項屬性沒有分配/)
    expect(attrBlock(k, { ...PICK, tech: 15 }, { charm: 2 })).toMatch(/一次/)
    expect(attrBlock(k, { ...PICK, tech: 9 }, { charm: 1 })).toMatch(/一次/)
    expect(attrBlock(k, PICK, { charm: 1.5, body: 0.5 })).toMatch(/整數/)
    expect(attrBlock(k, PICK, { charm: Number.NaN })).toMatch(/整數/)
    expect(attrBlock(k, PICK, { charm: Number.POSITIVE_INFINITY, tech: Number.NEGATIVE_INFINITY })).toMatch(/整數/)
  })

  it('性質：隨機的分配與增減，收不收和規格的條件（陣列各用一次、增減是整數、每項 4～18、合計 74）完全一致；收下的提交後屬性在 4～18', () => {
    const game = setup()
    const k = game.k
    const perm = fc.shuffledSubarray(ARRAY, { minLength: 6, maxLength: 6 })
    fc.assert(fc.property(perm, fc.array(fc.integer({ min: -14, max: 14 }), { minLength: 6, maxLength: 6 }), (order, deltas) => {
      const pick = Object.fromEntries(ATTR_IDS.map((a, i) => [a, order[i]!])) as Record<AttrId, number>
      const bonus = Object.fromEntries(ATTR_IDS.map((a, i) => [a, deltas[i]!]))
      const totals = ATTR_IDS.map((a, i) => pick[a] + deltas[i]!)
      const want = totals.every((t) => t >= SPEC.attrMin && t <= SPEC.attrMax) && totals.reduce((s, t) => s + t, 0) === 72 + SPEC.attrFree
      const got = attrBlock(k, pick, bonus) === null
      if (got !== want) return false
      if (!got) return true
      const report = buildCreationReport(k, game.state, draft({ attrPick: pick, attrBonus: bonus }))
      const actor = (report.changes[0] as unknown as { actor: { attrs: Record<string, number> } }).actor
      return ATTR_IDS.every((a) => actor.attrs[a]! >= SPEC.attrMin && actor.attrs[a]! <= SPEC.attrMax)
    }), { numRuns: 400 })
  })

  it('性質：把增減往合格的方向推（每項 4～18、合計 74），一定收', () => {
    const k = setup().k
    fc.assert(fc.property(fc.shuffledSubarray(ARRAY, { minLength: 6, maxLength: 6 }), fc.array(fc.integer({ min: 4, max: 18 }), { minLength: 6, maxLength: 6 }), (order, raw) => {
      // 把隨機的六個數修成合計 74：多的從大的扣、少的往小的加，每項仍在 4～18
      const t = [...raw]
      let diff = t.reduce((s, x) => s + x, 0) - 74
      for (let guard = 0; diff !== 0 && guard < 200; guard++) {
        const i = diff > 0 ? t.indexOf(Math.max(...t)) : t.indexOf(Math.min(...t))
        t[i]! += diff > 0 ? -1 : 1
        diff += diff > 0 ? -1 : 1
      }
      const pick = Object.fromEntries(ATTR_IDS.map((a, i) => [a, order[i]!]))
      const bonus = Object.fromEntries(ATTR_IDS.map((a, i) => [a, t[i]! - order[i]!]))
      return attrBlock(k, pick, bonus) === null
    }))
  })
})

// ---------------------------------------------------------------------------------------------
// 第 4 步：基本功（5.6 節的設定；第 1 節第 4 步：出身 +1 可以超過建角的上限，但基本功最高 6 級）

describe('邊界 CHARACTER 第 4 步、5.6 節：基本功點數 10、單項 3、出身 +1、最高 6', () => {
  it('點數：剛好 10 收、11 擋；零（一項都不買）收', () => {
    const { k, state } = setup()
    expect(skillBlock(k, state, { streetwise: 3, negotiate: 3, perform: 3, stealth: 1 })).toBeNull()
    expect(skillBlock(k, state, { streetwise: 3, negotiate: 3, perform: 3, stealth: 2 })).toMatch(/10 點/)
    expect(skillBlock(k, state, {})).toBeNull()
    expect(skillBlock(k, state, { streetwise: 0, negotiate: 0 })).toBeNull()
  })

  it('單項：3 收、4 擋；−1、小數、NaN 擋；不存在的基本功買 1 級擋、0 級不算', () => {
    const { k, state } = setup()
    expect(skillBlock(k, state, { streetwise: 3 })).toBeNull()
    expect(skillBlock(k, state, { streetwise: 4 })).toMatch(/3 級/)
    expect(skillBlock(k, state, { streetwise: -1, negotiate: 1 })).not.toBeNull()
    expect(skillBlock(k, state, { streetwise: 0.5 })).not.toBeNull()
    expect(skillBlock(k, state, { streetwise: Number.NaN })).not.toBeNull()
    expect(skillBlock(k, state, { juggling: 1 })).toMatch(/juggling/)
    expect(skillBlock(k, state, { juggling: 0 })).toBeNull()
  })

  it('出身 +1：買到建角上限 3 → 4（可以超過建角的上限）；沒買的那一項 0 → 1', () => {
    const game = setup()
    const pc = (d: CreationDraft) => (buildCreationReport(game.k, game.state, d).changes[0] as unknown as { actor: { skills: Record<string, number> } }).actor
    expect(pc(draft({ skills: { streetwise: 3 } })).skills.streetwise).toBe(4)
    expect(pc(draft({ skills: { negotiate: 3 } })).skills.streetwise).toBe(1)
  })

  it('設定的上限調到 6：買 6 級收（花 6 點），出身那一項夾在 6；調到 7 收成 6、−1 收成 0', () => {
    expect(sanitizeRules({ startSkillMax: 7 }).startSkillMax).toBe(6)
    expect(sanitizeRules({ startSkillMax: 99 }).startSkillMax).toBe(6)
    expect(sanitizeRules({ startSkillMax: -1 }).startSkillMax).toBe(0)
    expect(sanitizeRules({ startSkillMax: 2.6 }).startSkillMax).toBeLessThanOrEqual(6)
    const game = setup({ startSkillMax: 6 })
    expect(game.state.rules.startSkillMax).toBe(6)
    expect(skillBlock(game.k, game.state, { streetwise: 6 })).toBeNull()
    expect(skillBlock(game.k, game.state, { streetwise: 7 })).toMatch(/6 級/)
    game.commit(buildCreationReport(game.k, game.state, draft({ skills: { streetwise: 6, negotiate: 4 } })))
    const pc = game.state.actors[game.state.pc!]!
    expect(pc.skills.streetwise).toBe(SKILL_MAX)
    expect(validateActor(pc)).toEqual([])
  })

  it('設定的上限 0、點數 0：什麼都買不了，出身的 +1 照給', () => {
    const game = setup({ startSkillMax: 0, startSkillPoints: 0 })
    expect(skillBlock(game.k, game.state, { streetwise: 1 })).not.toBeNull()
    expect(skillBlock(game.k, game.state, {})).toBeNull()
    game.commit(buildCreationReport(game.k, game.state, draft({ skills: {} })))
    expect(game.state.actors[game.state.pc!]!.skills).toEqual({ streetwise: 1 })
  })

  it('性質：隨機的設定（上限 0～9、點數 0～30）與隨機的購買，收不收照規格；收下的提交之後每一項在 0～6（不變式 7），出身那一項 = min(6, 買的 + 1)', () => {
    const SKILLS = ['streetwise', 'negotiate', 'perform', 'mechanics', 'stealth']
    fc.assert(fc.property(fc.integer({ min: -2, max: 9 }), fc.integer({ min: 0, max: 30 }), fc.array(fc.integer({ min: -1, max: 8 }), { minLength: 5, maxLength: 5 }), (max, points, levels) => {
      const game = setup({ startSkillMax: max, startSkillPoints: points })
      const cap = Math.min(6, Math.max(0, max))
      const buy = Object.fromEntries(SKILLS.map((s, i) => [s, levels[i]!]))
      const want = levels.every((v) => v >= 0 && v <= cap) && levels.reduce((s, v) => s + v, 0) <= points
      const got = skillBlock(game.k, game.state, buy) === null
      if (got !== want) return false
      if (!got) return true
      game.commit(buildCreationReport(game.k, game.state, draft({ skills: buy })))
      const pc = game.state.actors[game.state.pc!]!
      return Object.values(pc.skills).every((v) => v >= 0 && v <= SKILL_MAX) && pc.skills.streetwise === Math.min(SKILL_MAX, buy.streetwise! + 1)
    }), { numRuns: 200 })
  })
})

// ---------------------------------------------------------------------------------------------
// 第 7 步：特質與缺陷（5.3 節）

describe('邊界 CHARACTER 5.3：特質點 4、特質最多 8 個、缺陷最多 2 個', () => {
  it('特質點：剛好用完收；多 1 點擋；零（不買）收', () => {
    const { k, state } = setup()
    expect(perkBlock(k, state, CHEAP.slice(0, 4))).toBeNull()
    expect(perkBlock(k, state, CHEAP.slice(0, 5))).toMatch(/超過了 1 點/)
    expect(perkBlock(k, state, [])).toBeNull()
  })

  it('缺陷：2 個收、3 個擋；缺陷退的點數可以買特質（4 + 3 + 3 = 10 點）', () => {
    const { k, state } = setup()
    expect(perkBlock(k, state, ['flaw_3a', 'flaw_3b'])).toBeNull()
    expect(perkBlock(k, state, ['flaw_1', 'flaw_2', 'flaw_3a'])).toMatch(/缺陷最多 2 個/)
    expect(perkBlock(k, state, ['flaw_3a', 'flaw_3b', ...CHEAP.slice(0, 8), 'dear_0'])).toMatch(/特質最多 8 個|超過/)
    expect(perkBlock(k, state, ['flaw_3a', 'flaw_3b', ...DEAR, 'cheap_0'])).toBeNull()
  })

  it('特質總數：8 個收、9 個擋（點數夠的時候也擋）；出身特質與缺陷不算在 8 個裡', () => {
    const rich = setup({ startPerkPoints: 40 })
    expect(perkBlock(rich.k, rich.state, CHEAP.slice(0, 8))).toBeNull()
    expect(perkBlock(rich.k, rich.state, CHEAP.slice(0, 9))).toMatch(/特質最多 8 個/)
    expect(perkBlock(rich.k, rich.state, [...CHEAP.slice(0, 8), 'flaw_1', 'flaw_2'])).toBeNull()
    // 最大組合：8 個特質 + 2 個缺陷 + 出身特質，提交之後主角身上 11 個
    rich.commit(buildCreationReport(rich.k, rich.state, draft({ perks: [...CHEAP.slice(0, 8), 'flaw_1', 'flaw_2'] })))
    expect(rich.state.actors[rich.state.pc!]!.perks).toHaveLength(11)
  })

  it('預設的特質點 4、缺陷最多退 6 點：8 個 1 點的特質剛好買得起（4 + 3 + 3 − 8 = 2）', () => {
    const { k, state } = setup()
    expect(perkBlock(k, state, [...CHEAP.slice(0, 8), 'flaw_3a', 'flaw_3b'])).toBeNull()
    expect(perkBlock(k, state, [...CHEAP.slice(0, 9), 'flaw_3a', 'flaw_3b'])).toMatch(/特質最多 8 個/)
  })

  it('空與重複：同一個特質兩次、不存在的、出身特質都擋', () => {
    const { k, state } = setup()
    expect(perkBlock(k, state, ['cheap_0', 'cheap_0'])).toMatch(/兩次/)
    expect(perkBlock(k, state, ['flaw_1', 'flaw_1'])).toMatch(/兩次/)
    expect(perkBlock(k, state, [''])).not.toBeNull()
    expect(perkBlock(k, state, ['origin_hive'])).toMatch(/出身特質/)
  })

  it('性質：隨機挑特質與缺陷、隨機的特質點（0～12），收不收和規格的條件完全一致', () => {
    const POOL = [...CHEAP, ...DEAR, ...FLAWS, 'origin_hive', 'no_such']
    fc.assert(fc.property(fc.integer({ min: 0, max: 12 }), fc.array(fc.constantFrom(...POOL), { maxLength: 16 }), (points, picked) => {
      const { k, state } = setup({ startPerkPoints: points })
      const unique = new Set(picked).size === picked.length
      const known = picked.every((p) => p in COST)
      const perks = picked.filter((p) => !FLAWS.includes(p))
      const flaws = picked.filter((p) => FLAWS.includes(p))
      const left = points + flaws.reduce((s, p) => s + COST[p]!, 0) - perks.reduce((s, p) => s + (COST[p] ?? 0), 0)
      const want = unique && known && flaws.length <= SPEC.flawMax && perks.length <= SPEC.perkMax && left >= 0
      return (perkBlock(k, state, picked) === null) === want
    }), { numRuns: 400 })
  })
})

// ---------------------------------------------------------------------------------------------
// 整份：最大組合提交之後狀態合法

describe('邊界 CHARACTER：最大組合的建角提交之後，狀態合法、不變式成立', () => {
  it('屬性 18/18/18/4/4/12、基本功上限 6 全部堆滿、8 個特質 2 個缺陷：一份報告、狀態合法', async () => {
    const game = setup({ startSkillMax: 6, startSkillPoints: 30, startPerkPoints: 2 })
    const target = { reflex: 18, charm: 18, intellect: 18, body: 4, resolve: 4, tech: 12 }
    const d = draft({
      attrBonus: Object.fromEntries(ATTR_IDS.map((a) => [a, target[a] - PICK[a]])),
      skills: { streetwise: 6, negotiate: 6, perform: 6, mechanics: 6, stealth: 6 },
      perks: [...CHEAP.slice(0, 8), 'flaw_3a', 'flaw_3b'],
    })
    expect(creationBlocks(game.k, game.state, d)).toEqual([])
    const { violations } = await observed(game, async () => game.commit(buildCreationReport(game.k, game.state, d)))
    expect(violations).toEqual([])
    const pc = game.state.actors[game.state.pc!]!
    expect(pc.attrs).toEqual(target)
    expect(Math.max(...Object.values(pc.skills))).toBe(SKILL_MAX)
    expect(validateActor(pc)).toEqual([])
    // 存檔再讀檔一模一樣（不變式 6）
    const before = JSON.stringify(game.state)
    expect(game.load(game.save())).toBeNull()
    expect(JSON.stringify(game.state)).toBe(before)
  })
})
