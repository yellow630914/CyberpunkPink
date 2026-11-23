// 邊界：名冊與隊伍的數字。
// 規格：NPC_SYSTEM 10.0（隊伍最多 4 人含主角、同行最多 2 位）、10.2（招募 DC = 16 − ⌊親密度 ÷ 10⌋ + 2 × max(0, 階數 − 信譽階序)）、10.4（忠誠 0～100、20～39 出場費 +25%）、10.5（出場費 = 階數² × 200 × (1 ± 25%)）；FIXER 第 6 節（名冊容量 = 3 + mod(魅力) + 2 × 人面階數）。
// 性質：容量剛好滿了就擋、少一個就進得來；隊伍第 4 位（不含主角）、同行第 3 位被擋，寫出是誰；招募 DC 對每一個親密度（−100～100）等於公式；出場費對階數 1～5 隨階數² 成長、不是負的。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked, attrMod } from '../../src'
import { join, joinBlock, muster, musterBlocks, readRoster, recruitDc, rosterCap, rosterView, feeOf, DEFAULT_ROSTER_RULES } from '../../src/features/roster'
import { makeActor, makeCityGame, makeRunner } from '../../src/testkit'

const runnersOf = (n: number, tier = 2) =>
  Array.from({ length: n }, (_, i) => makeActor({ id: `rn_${i}`, name: `行者${i}`, role: 'npc', ext: { paths: [{ path: 'p_gun', slot: 'main', tier }] } }))

describe('邊界 FIXER 6、NPC_SYSTEM 10.0：名冊容量', () => {
  it('性質：魅力 1～30，容量 = max(0, 3 + mod(有效魅力) + 2 × 人面階數)；名冊剛好滿了擋、少一個進得來', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (charm) => {
        const t = makeCityGame({ seed: 7, pc: { attrs: { charm } }, actors: runnersOf(12) })
        const { game } = t
        const cap = rosterCap(game.k, game.state)
        expect(cap).toBe(Math.max(0, 3 + attrMod(Math.min(24, charm))))
        let size = 0
        for (let i = 0; i < 12; i++) {
          const id = `rn_${i}`
          if (size < cap) {
            expect(joinBlock(game.k, game.state, id), `第 ${size + 1} 個（容量 ${cap}）`).toBeNull()
            game.commit(join(game.k, game.state, id))
            size++
          } else {
            expect(joinBlock(game.k, game.state, id)).toContain('名冊滿了')
            expect(() => join(game.k, game.state, id)).toThrow(ActionBlocked)
          }
        }
        expect(Object.keys(readRoster(game.state).members).length).toBe(Math.min(12, cap))
        expect(rosterView(game.k, game.state).cap).toBe(cap)
      }),
      { numRuns: 15, seed: 21 },
    )
  })

  it('主角自己、查不到的人、已經在名冊上的人不能進；重複進被擋', () => {
    const t = makeCityGame({ seed: 7, pc: { attrs: { charm: 20 } }, actors: [makeRunner()] })
    const { game } = t
    expect(joinBlock(game.k, game.state, 'pc')).toContain('主角')
    expect(joinBlock(game.k, game.state, 'nobody')).toContain('查不到')
    game.commit(join(game.k, game.state, 'a_tw_runner'))
    expect(joinBlock(game.k, game.state, 'a_tw_runner')).toContain('已經在你的名冊上')
  })
})

describe('邊界 NPC_SYSTEM 10.0：召集', () => {
  const setup = () => {
    const t = makeCityGame({ seed: 7, pc: { attrs: { charm: 24 } }, actors: [...runnersOf(5), makeActor({ id: 'ct_a', name: '街坊甲', role: 'npc' }), makeActor({ id: 'ct_b', name: '街坊乙', role: 'npc' }), makeActor({ id: 'ct_c', name: '街坊丙', role: 'npc' })] })
    for (let i = 0; i < 5; i++) t.game.commit(join(t.game.k, t.game.state, `rn_${i}`))
    return t.game
  }

  it('隊伍：主角加 3 位行者（共 4 人）可以；第 4 位被擋並點名；重複寫同一個人只算一個；寫了主角自己不算', () => {
    const g = setup()
    expect(musterBlocks(g.k, g.state, { party: ['rn_0', 'rn_1', 'rn_2'] })).toEqual([])
    const four = musterBlocks(g.k, g.state, { party: ['rn_0', 'rn_1', 'rn_2', 'rn_3'] })
    expect(four).toHaveLength(1)
    expect(four[0]).toContain('行者3')
    expect(four[0]).toContain('4 人')
    expect(musterBlocks(g.k, g.state, { party: ['rn_0', 'rn_0', 'rn_0', 'rn_1', 'rn_2'] })).toEqual([])
    expect(musterBlocks(g.k, g.state, { party: ['pc', 'rn_0', 'rn_1', 'rn_2'] })).toEqual([])
    expect(() => muster(g.k, g.state, { party: ['rn_0', 'rn_1', 'rn_2', 'rn_3', 'rn_4'] })).toThrow(ActionBlocked)
    g.commit(muster(g.k, g.state, { party: ['rn_0', 'rn_1', 'rn_2'] }))
    expect(g.state.party).toEqual(expect.arrayContaining(['pc', 'rn_0', 'rn_1', 'rn_2']))
    expect(g.state.party).toHaveLength(4)
  })

  it('同行：2 位可以、第 3 位被擋；街坊可以同行、不能進隊伍；已經在隊伍的人不能再當同行；查不到的人被擋', () => {
    const g = setup()
    expect(musterBlocks(g.k, g.state, { tagalong: ['ct_a', 'ct_b'] })).toEqual([])
    const three = musterBlocks(g.k, g.state, { tagalong: ['ct_a', 'ct_b', 'ct_c'] })
    expect(three).toHaveLength(1)
    expect(three[0]).toContain('街坊丙')
    expect(musterBlocks(g.k, g.state, { party: ['ct_a'] }).join('')).toContain('不在你的名冊上')
    expect(musterBlocks(g.k, g.state, { party: ['rn_0'], tagalong: ['rn_0'] }).join('')).toContain('已經在隊伍裡')
    expect(musterBlocks(g.k, g.state, { tagalong: ['nobody'] }).join('')).toContain('查不到')
    expect(musterBlocks(g.k, g.state, { party: ['nobody'] }).join('')).toContain('查不到')
  })

  it('性質：任意挑隊伍與同行（可重複、可含主角與不存在的人）：成立時 state.party 剛好是主角加上不重複的隊伍，不超過 4 人；不成立時狀態不動', () => {
    const ids = ['pc', 'rn_0', 'rn_1', 'rn_2', 'rn_3', 'rn_4', 'ct_a', 'ct_b', 'ct_c', 'nobody']
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ids), { maxLength: 7 }), fc.array(fc.constantFrom(...ids), { maxLength: 5 }), (party, tagalong) => {
        const g = setup()
        const before = JSON.stringify(g.state)
        const blocks = musterBlocks(g.k, g.state, { party, tagalong })
        if (blocks.length > 0) {
          expect(() => muster(g.k, g.state, { party, tagalong })).toThrow(ActionBlocked)
          expect(JSON.stringify(g.state)).toBe(before)
          return
        }
        g.commit(muster(g.k, g.state, { party, tagalong }))
        const want = [...new Set(party.filter((x) => x !== 'pc'))]
        expect(g.state.party.filter((x) => x !== 'pc').sort()).toEqual([...want].sort())
        expect(g.state.party.length).toBeLessThanOrEqual(DEFAULT_ROSTER_RULES.party_max)
      }),
      { numRuns: 60, seed: 22 },
    )
  })
})

describe('邊界 NPC_SYSTEM 10.2、10.5：招募的 DC 與出場費', () => {
  it('性質：親密度 −100～100：DC = 16 − ⌊親密度 ÷ 10⌋ + 2 × max(0, 階數 − 信譽階序)；負的親密度會讓 DC 變難（⌊−1 ÷ 10⌋ = −1）', () => {
    const t = makeCityGame({ seed: 7, actors: runnersOf(1, 3) })
    const { game } = t
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (aff) => {
        const s = structuredClone(game.state)
        ;(s as unknown as { meters: Record<string, Record<string, number>> }).meters.affinity = { rn_0: aff }
        const { dc } = recruitDc(game.k, s, 'rn_0')
        expect(dc).toBe(16 - Math.floor(aff / 10) + 2 * Math.max(0, 3 - 0))
      }),
      { numRuns: 201, seed: 23 },
    )
    const s = structuredClone(game.state)
    ;(s as unknown as { meters: Record<string, Record<string, number>> }).meters.affinity = { rn_0: -1 }
    expect(recruitDc(game.k, s, 'rn_0').dc).toBe(16 + 1 + 6)
    ;(s as unknown as { meters: Record<string, Record<string, number>> }).meters.affinity = { rn_0: 9 }
    expect(recruitDc(game.k, s, 'rn_0').dc).toBe(16 + 6)
    ;(s as unknown as { meters: Record<string, Record<string, number>> }).meters.affinity = { rn_0: 10 }
    expect(recruitDc(game.k, s, 'rn_0').dc).toBe(15 + 6)
  })

  it('出場費：階數 1～5 的行者（出場費制），隨階數² 增加、都是正整數；拿分紅的人是 0；不在名冊上的人是 0', () => {
    const fees: number[] = []
    for (let tier = 1; tier <= 5; tier++) {
      const t = makeCityGame({ seed: 7, pc: { attrs: { charm: 24 } }, actors: runnersOf(1, tier) })
      t.game.commit(join(t.game.k, t.game.state, 'rn_0', { pay: 'fee', loyalty: 60, reliability: 50 }))
      fees.push(feeOf(t.game.k, t.game.state, 'rn_0'))
    }
    fees.forEach((f) => {
      expect(Number.isInteger(f)).toBe(true)
      expect(f).toBeGreaterThan(0)
    })
    expect([...fees].sort((a, b) => a - b)).toEqual(fees)
    // 階數² × 200 × (1 ± 25%) × 信譽階序比他低時再 +20%：5 階最多 25 × 200 × 1.25 × 1.2 = 7500、最少 1 階 200 × 0.75
    expect(fees[0]).toBeGreaterThanOrEqual(150)
    expect(fees[4]).toBeLessThanOrEqual(7500)
    const share = makeCityGame({ seed: 7, pc: { attrs: { charm: 24 } }, actors: runnersOf(1, 3) })
    share.game.commit(join(share.game.k, share.game.state, 'rn_0', { pay: 'share' }))
    expect(feeOf(share.game.k, share.game.state, 'rn_0')).toBe(0)
    expect(feeOf(share.game.k, share.game.state, 'rn_nope')).toBe(0)
  })
})
