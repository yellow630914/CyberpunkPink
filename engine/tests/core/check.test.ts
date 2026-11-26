import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { DC_LADDER, DC_TIERS, attrMod, checkPassChance, computeDegree, createKernel, dcFor, makeCheck, rollCheck, sanitizeRules, snapToLadder, verdictOf } from '../../src/core'
import { makeState } from '../../src/testkit'

// 規格：CORE_RULES 第 3 節
describe('L4 檢定', () => {
  it('調整值是（屬性 − 10）÷ 2，無條件捨去', () => {
    expect([4, 8, 9, 10, 11, 15, 18, 24].map(attrMod)).toEqual([-3, -1, -1, 0, 0, 2, 4, 7])
  })

  it('DC 的階梯是 10、13、16、19、22、25', () => {
    expect(DC_LADDER).toEqual([10, 13, 16, 19, 22, 25])
    expect(snapToLadder(14)).toBe(13)
    expect(snapToLadder(15)).toBe(16)
    expect(snapToLadder(99)).toBe(25)
    expect(snapToLadder(1)).toBe(10)
  })

  it('成功程度四級：超過 DC 5 以上或自然 20 大成功；低於 DC 5 以上或自然 1 大失敗', () => {
    expect(computeDegree(10, 18, 13)).toBe('critical')
    expect(computeDegree(10, 17, 13)).toBe('success')
    expect(computeDegree(10, 13, 13)).toBe('success')
    expect(computeDegree(10, 12, 13)).toBe('fail')
    expect(computeDegree(10, 9, 13)).toBe('fail')
    expect(computeDegree(10, 8, 13)).toBe('fumble')
    expect(computeDegree(20, 5, 25)).toBe('critical')
    expect(computeDegree(1, 30, 10)).toBe('fumble')
  })

  it('性質：不看自然 20 與 1 時，合計越高結果不會越差', () => {
    const rank = { fumble: 0, fail: 1, success: 2, critical: 3 }
    fc.assert(fc.property(fc.integer({ min: 2, max: 19 }), fc.integer({ min: -10, max: 40 }), fc.integer({ min: 5, max: 30 }), (nat, total, dc) =>
      rank[computeDegree(nat, total + 1, dc)] >= rank[computeDegree(nat, total, dc)]))
  })

  it('成功再看差距：不到 3 點是「是，但是」，3 點以上是乾淨的「是」', () => {
    expect(verdictOf('success', 0)).toBe('yes_but')
    expect(verdictOf('success', 2)).toBe('yes_but')
    expect(verdictOf('success', 3)).toBe('yes')
    expect(verdictOf('critical', 9)).toBe('yes_and')
    expect(verdictOf('fail', -1)).toBe('no_but')
    expect(verdictOf('fumble', -9)).toBe('no_and')
  })

  it('makeCheck：合計是骰面加所有加值；0 的加值不記', () => {
    const c = makeCheck({ natural: 11, dc: 13, parts: [{ label: '魅力', value: 1 }, { label: '交涉', value: 2 }, { label: '沒有', value: 0 }] })
    expect(c.total).toBe(14)
    expect(c.parts).toHaveLength(2)
    expect(c.margin).toBe(1)
    expect(c.degree).toBe('success')
    expect(c.verdict).toBe('yes_but')
  })

  it('難度只調 DC 的偏移：預設五個難度是 −2～+2，自訂 −4～+4', () => {
    expect(['story', 'easy', 'normal', 'hard', 'legend'].map((d) => dcFor('normal', sanitizeRules({ difficulty: d })))).toEqual([11, 12, 13, 14, 15])
    expect(dcFor('easy', sanitizeRules({ difficulty: 'story' }))).toBe(8)
    expect(sanitizeRules({ difficulty: 'custom', dcOffset: 9 }).dcOffset).toBe(4)
    expect(sanitizeRules({ difficulty: 'custom', dcOffset: -9 }).dcOffset).toBe(-4)
    expect(sanitizeRules({ difficulty: 'hard', dcOffset: -4 }).dcOffset).toBe(1)
    expect(dcFor(DC_TIERS.mythic, { dcOffset: 0 })).toBe(25)
  })

  it('rollCheck：1d20 + mod(屬性) + 基本功等級 + 情境；不改狀態；同一個用途同一顆骰', () => {
    const k = createKernel()
    const state = makeState({ pc: { attrs: { charm: 16 }, skills: { negotiate: 2 } } })
    const before = JSON.stringify(state)
    const input = { actor: 'pc', attr: 'charm' as const, skill: 'negotiate', dc: 13, purpose: 't', situation: [{ label: '協力', value: 2 }] }
    const a = rollCheck(k.stats, state, input)
    expect(a.total).toBe(a.natural + 3 + 2 + 2)
    expect(a.natural).toBeGreaterThanOrEqual(1)
    expect(a.natural).toBeLessThanOrEqual(20)
    expect(rollCheck(k.stats, state, input)).toEqual(a)
    expect(JSON.stringify(state)).toBe(before)
    const naturals = new Set(Array.from({ length: 30 }, (_, i) => rollCheck(k.stats, state, { ...input, reroll: i }).natural))
    expect(naturals.size).toBeGreaterThan(5)
  })

  it('檢定讀有效屬性：來源登記之後生效，上限 24；衍生數值與修正也走登錄表', () => {
    const k = createKernel()
    const state = makeState({ pc: { attrs: { body: 14 } } })
    k.stats.addAttrProvider('test', (_s, _a, attr) => (attr === 'body' ? [{ label: '義臂', value: 4 }] : []))
    expect(k.stats.effectiveAttr(state, 'pc', 'body')).toBe(18)
    k.stats.addAttrProvider('test2', (_s, _a, attr) => (attr === 'body' ? [{ label: '藥', value: 20 }] : []))
    expect(k.stats.effectiveAttr(state, 'pc', 'body')).toBe(24)
    expect(() => k.stats.stat(state, 'pc', 'max_hp')).toThrow(/還沒有功能註冊/)
    k.stats.defineStat({ id: 'max_hp', owner: 'test', name: '生命值上限', base: (s, a, st) => 20 + st.effectiveAttr(s, a, 'body') * 2 })
    k.stats.addStatProvider('max_hp', 'test', () => [{ label: '耐打', value: 5 }])
    expect(k.stats.stat(state, 'pc', 'max_hp')).toBe(20 + 48 + 5)
    expect(() => k.stats.defineStat({ id: 'max_hp', owner: 'x', name: '', base: () => 0 })).toThrow(/重複註冊/)
    k.stats.addCheckModifier('test', (_s, _a, ctx) => (ctx.tags.includes('social') ? [{ label: '能言善道', value: 2 }] : []))
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', tags: ['social'] })).toEqual([{ label: '能言善道', value: 2 }])
    expect(k.stats.checkModifiers(state, 'pc', { attr: 'charm', tags: [] })).toEqual([])
  })
})

describe('checkPassChance（報價的成功率；M4-fix-2）', () => {
  /** 獨立的算法：自然 20 一定過、自然 1 一定不過，其餘看合計有沒有到 DC */
  const brute = (bonus: number, dc: number): number => {
    let ok = 0
    for (let n = 1; n <= 20; n++) if (n === 20 || (n !== 1 && n + bonus >= dc)) ok++
    return ok / 20
  }

  it('幾個算好的數字：加值 0 對 DC 13 是 8/20（自然 13～20）；加值 5 對 DC 15 是 11/20；DC 很低也只到 19/20（自然 1 一定失敗）；DC 很高還有自然 20 的 1/20', () => {
    expect(checkPassChance(0, 13)).toBe(0.4)
    expect(checkPassChance(5, 15)).toBe(0.55)
    expect(checkPassChance(20, 10)).toBe(0.95)
    expect(checkPassChance(0, 40)).toBe(0.05)
  })

  it('和 computeDegree 逐面一致：任何加值與 DC 都等於「成功或大成功的骰面數 ÷ 20」；加值越高機率不降、DC 越高不升', () => {
    fc.assert(fc.property(fc.integer({ min: -30, max: 30 }), fc.integer({ min: 1, max: 40 }), (bonus, dc) => {
      expect(checkPassChance(bonus, dc)).toBe(brute(bonus, dc))
      expect(checkPassChance(bonus + 1, dc)).toBeGreaterThanOrEqual(checkPassChance(bonus, dc))
      expect(checkPassChance(bonus, dc + 1)).toBeLessThanOrEqual(checkPassChance(bonus, dc))
      const p = checkPassChance(bonus, dc)
      expect(p).toBeGreaterThanOrEqual(0.05)
      expect(p).toBeLessThanOrEqual(0.95)
    }))
  })
})

