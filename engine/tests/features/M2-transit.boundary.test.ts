// 邊界：搭車與浮空計程車的錢與時間。
// 規格：DISTRICTS 1.2.1（地鐵每站 5 分鐘；車資 C$2 + 每站 1；計程車 C$25 + 每公里 C$4、乘目的地那一區的物價、低於 ×1 的照 ×1、10 分鐘、去過的站才能叫、帳戶付）；
// dev/invariants.md 第 7 條（錢不會是負的）、第 115 條（車上的事件選了開打，這趟車先結束）。
// 性質：① 計程車車資 = round((25 + 4 × 公里) × max(1, 物價))，單調不減、不是負的；公里數表不分方向；② 一趟車花的錢 = 起跳 + 每站 × 坐了幾站，付現金就不動帳戶，兩邊都不會是負的；
// ③ 錢剛好夠下一站可以坐、少 1 塊就留在這一站；④ 時間 = 等車（班距範圍內）+ 每站 5 分鐘；⑤ 沒去過的站叫不了計程車。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked, toMinutes } from '../../src'
import { DEFAULT_TRANSIT_RULES, stationsOf, advance, advanceBlock, alight, board, boardBlock, taxi, taxiBlock, taxiQuote, transitOf, wait } from '../../src/features/transit'
import { kmBetween, taxiFare } from '../../src/features/transit/model'
import { makeCityGame, walkTo } from '../../src/testkit'

const rules = DEFAULT_TRANSIT_RULES

describe('邊界 DISTRICTS 1.2.1：浮空計程車的車資', () => {
  it('性質：任何公里數（0～200）與物價倍率（0.1～5）：車資 = round((25 + 4 × km) × max(1, 倍率))，是正整數、公里越遠越貴、倍率越高越貴、低於 ×1 的照 ×1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.double({ min: 0.1, max: 5, noNaN: true }), fc.double({ min: 0.1, max: 5, noNaN: true }), (km, a, b) => {
        const fare = taxiFare(rules, km, a)
        expect(fare).toBe(Math.round((25 + 4 * km) * Math.max(1, a)))
        expect(Number.isInteger(fare)).toBe(true)
        expect(fare).toBeGreaterThanOrEqual(25)
        expect(taxiFare(rules, km + 1, a)).toBeGreaterThan(fare)
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        expect(taxiFare(rules, km, hi)).toBeGreaterThanOrEqual(taxiFare(rules, km, lo))
        if (a <= 1) expect(fare).toBe(taxiFare(rules, km, 1))
      }),
      { numRuns: 200, seed: 41 },
    )
  })

  it('公里數：同一區 2 公里；兩區之間照表（不分方向）；表上沒寫、或不知道在哪一區的是預設 10 公里', () => {
    const r = { ...rules, km: [{ a: 'x', b: 'y', km: 7 }] }
    expect(kmBetween(r, 'x', 'x')).toBe(2)
    expect(kmBetween(r, 'x', 'y')).toBe(7)
    expect(kmBetween(r, 'y', 'x')).toBe(7)
    expect(kmBetween(r, 'x', 'z')).toBe(10)
    expect(kmBetween(r, undefined, 'x')).toBe(10)
    expect(kmBetween(r, 'x', undefined)).toBe(10)
    expect(kmBetween(r, undefined, undefined)).toBe(10)
  })

  it('實際叫車：去過的站才叫得動；錢剛好夠可以、少 1 塊不行；扣的是帳戶；時間 10 分鐘；到了之後人在那一站', () => {
    const t = makeCityGame({ seed: 7 })
    const { game } = t
    const k = game.k
    // 還沒去過任何站：叫不了
    const stations = stationsOf(k)
    expect(stations.length).toBe(3)
    expect(taxiBlock(k, game.state, stations[2]!.key)).toContain('沒去過')
    expect(taxiBlock(k, game.state, 'no_such_station')).toContain('沒有')
    // 搭一趟地鐵到院子站：去過了
    walkTo(game, 'F2')
    game.commit(board(k, game.state, { line: 'tw_metro', pay: 'cred', dest: 's_yard' }))
    game.commit(wait(k, game.state))
    for (let i = 0; i < 4; i++) {
      if (advanceBlock(k, game.state)) break
      game.commit(advance(k, game.state))
    }
    game.commit(alight(k, game.state))
    expect(transitOf(game.state).visited.length).toBeGreaterThan(0)
    // 回到市場站再叫車去院子站
    const stationKeys = transitOf(game.state).visited
    expect(stationKeys.length).toBeGreaterThanOrEqual(2)
    const dest = stationKeys.find((x) => x !== stationKeys[stationKeys.length - 1])!
    const q = taxiQuote(k, game.state, dest)!
    expect(q.fare).toBe(taxiFare(DEFAULT_TRANSIT_RULES, q.km, 1))
    expect(q.minutes).toBe(10)
    game.state.money.cred = q.fare - 1
    expect(taxiBlock(k, game.state, dest)).not.toBeNull()
    expect(() => taxi(k, game.state, dest)).toThrow(ActionBlocked)
    game.state.money.cred = q.fare
    const t0 = toMinutes(game.state.time)
    for (const d of taxi(k, game.state, dest)) game.commit(d)
    expect(game.state.money.cred).toBe(0)
    expect(toMinutes(game.state.time) - t0).toBe(10)
  })
})

describe('邊界 DISTRICTS 1.2.1：一趟車', () => {
  it('性質：付帳戶或現金、坐 1～2 站：花的 = 2 + 1 × 站數，只動付的那一種錢；時間 = 等車（2～6 分鐘）+ 5 × 站數；錢不夠下一站時留在這一站', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.constantFrom('cred', 'cash') as fc.Arbitrary<'cred' | 'cash'>, fc.integer({ min: 0, max: 6 }), (seed, pay, money) => {
        const t = makeCityGame({ seed })
        const { game } = t
        const k = game.k
        walkTo(game, 'F2') // 塔下站
        game.state.money.cred = pay === 'cred' ? money : 77
        game.state.money.cash = pay === 'cash' ? money : 77
        const other = pay === 'cred' ? 'cash' : 'cred'
        const t0 = toMinutes(game.state.time)
        const block = boardBlock(k, game.state, { line: 'tw_metro', pay })
        if (money < 3) {
          expect(block).not.toBeNull() // 起跳 2 + 第一站 1 = 3：不夠第一站就不給上車
          expect(() => board(k, game.state, { line: 'tw_metro', pay })).toThrow(ActionBlocked)
          return
        }
        expect(block).toBeNull()
        game.commit(board(k, game.state, { line: 'tw_metro', pay }))
        expect(game.state.money[pay]).toBe(money - 2)
        game.commit(wait(k, game.state))
        const waited = toMinutes(game.state.time) - t0
        expect(waited).toBeGreaterThanOrEqual(2)
        expect(waited).toBeLessThanOrEqual(6)
        let rode = 0
        for (let i = 0; i < 5; i++) {
          const why = advanceBlock(k, game.state)
          if (why) {
            // 是到了終點，或是錢不夠下一站（每站 1 塊）
            if (!why.includes('終點站')) {
              expect(game.state.money[pay]).toBeLessThan(1)
              expect(why).toContain('不夠')
            }
            break
          }
          game.commit(advance(k, game.state))
          rode++
        }
        game.commit(alight(k, game.state))
        expect(game.state.money[pay]).toBe(money - 2 - rode)
        expect(game.state.money[pay]).toBeGreaterThanOrEqual(0)
        expect(game.state.money[other]).toBe(77)
        expect(toMinutes(game.state.time) - t0).toBe(waited + 5 * rode)
        expect(rode).toBeLessThanOrEqual(money - 2)
        expect(rode).toBeLessThanOrEqual(2) // 塔下站在三站線的中間，往一個方向最多再坐一站；環線與回頭另算
      }),
      { numRuns: 40, seed: 42 },
    )
  })
})
