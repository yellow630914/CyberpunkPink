// 邊界：沉溺的下限 = 身上所有義體的沉溺成本合計（M4 邊界，cpp-tester-boundary）。
// 規格：CORE_RULES 4.3 節「沉溺的下限 = 所有義體的沉溺成本合計；沉溺不會低於下限；拆掉義體把下限降下來」；CYBERWARE 第 2 節；dev/adr/0019 第三節。
// 性質：隨機裝、拆義體（診所）、讓時間過去、睡覺之後：衍生數值 sink_floor = 身上義體的沉溺成本合計（沒有暫時的加減時）；沉溺不低於下限；
// 拆掉一件之後下限剛好少那一件的成本；下限不會是負的。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked } from '../../src'
import { cyberOf, installDraft, removeDraft } from '../../src/features/cyberware'
import { BODY_BLOCKS, giveMoney, giveProduct, makeBodyGame, passTime, standAt } from '../../src/testkit'

const COST: Record<string, number> = { bp_tw_eye: 3, bp_tw_plating: 2, bp_tw_pump: 3 }

describe('沉溺的下限（義體的沉溺成本合計）', () => {
  it('任何裝與拆的順序：下限 = 身上義體的成本合計；沉溺不低於下限；拆掉之後下限降下來', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), fc.array(fc.tuple(fc.constantFrom(...Object.keys(COST)), fc.boolean(), fc.integer({ min: 0, max: 3 })), { minLength: 1, maxLength: 12 }), (seed, ops) => {
      const g = makeBodyGame({ seed }).game
      const { k } = g
      giveMoney(g, 500_000, 50_000)
      standAt(g, BODY_BLOCKS.clinics, 'F1')
      let n = 0
      for (const [bp, install, wait] of ops) {
        try {
          if (install) {
            const uid = `U${++n}`
            giveProduct(g, bp, uid)
            g.commit(installDraft(k, g.state, { actor: 'pc', uid, via: 'clinic' }))
          } else {
            const mine = cyberOf(g.state, 'pc').find((p) => p.bp === bp)
            if (mine) g.commit(removeDraft(k, g.state, { actor: 'pc', uid: mine.uid, via: 'clinic' }))
          }
          if (wait) passTime(g, wait * 1440)
        } catch (e) { if (!(e instanceof ActionBlocked)) throw e }
        const floor = k.stats.stat(g.state, 'pc', 'sink_floor')
        const pieces = cyberOf(g.state, 'pc')
        const baseCost = pieces.reduce((s, p) => s + (COST[p.bp] ?? 0), 0)
        // 建角給的橋與義眼之類不在這個世界（makeBodyGame 沒有建角）：下限只有這幾件
        expect(floor, `身上 ${pieces.map((p) => p.bp).join(',')}`).toBe(baseCost)
        expect(floor).toBeGreaterThanOrEqual(0)
        expect(g.state.actors.pc!.sink).toBeGreaterThanOrEqual(floor)
      }
    }), { numRuns: 25, seed: 4 })
  })
})
