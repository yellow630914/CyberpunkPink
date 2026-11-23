// 邊界：橋參數（敏感度、耐受、慾求、馴化）與傾向的夾值。
// 規格：LEWD_SYSTEM 第 1 節（橋參數 0～100、超過 100 的部分邊際遞減、慾求 60 以上開戰帶感載、傾向每一軸 0～axis_max）；CORE_RULES 4.2 節（耐受每 40 點多一層餘韻上限）；dev/adr/0016 G10、G14。
// 性質：存檔或 AI 給的橋參數是什麼鬼東西（NaN、無限大、字串、負的、超大）都夾回 0～100 的整數；超過 100 的效力單調不減、不超過 100 + over_scale、在 100 連續；
// 有效值 = 基本值 + 來源（夾在 ±gear_cap），整體在 0～(100 + gear_cap)，段的範圍剛好蓋住 0～(100 + gear_cap) 不重疊；傾向的軸夾在 0～axis_max、點數不是負的。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BRIDGE_PARAMS, DEFAULT_LEWD_RULES, TAG_STATES, bridgeOf, powerOf, readBridge, tendencyOf } from '../../src/features/lewd'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import { makeActor, makeGame } from '../../src/testkit'

const wild = fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.double({ noNaN: false }), fc.constantFrom('x', '50', null, undefined, true, [], {}), fc.constant(Number.MAX_SAFE_INTEGER), fc.constant(-Infinity))

describe('邊界 LEWD_SYSTEM 1：橋參數', () => {
  it('性質：什麼值都夾回 0～100 的整數；不是物件就是沒有橋；少的那一項補預設', () => {
    fc.assert(
      fc.property(fc.record({ sensitivity: wild, tolerance: wild, craving: wild, docility: wild }, { requiredKeys: [] }), (raw) => {
        const b = readBridge(raw)!
        for (const p of BRIDGE_PARAMS) {
          expect(Number.isInteger(b[p])).toBe(true)
          expect(b[p]).toBeGreaterThanOrEqual(0)
          expect(b[p]).toBeLessThanOrEqual(100)
          const v = (raw as Record<string, unknown>)[p]
          if (typeof v !== 'number' || !Number.isFinite(v)) expect(b[p]).toBe(DEFAULT_LEWD_RULES.default_bridge)
        }
      }),
      { numRuns: 200, seed: 51 },
    )
    for (const nope of [null, undefined, 5, 'x', true, []]) expect(readBridge(nope)).toBeNull()
    expect(readBridge({})).toEqual({ sensitivity: 30, tolerance: 30, craving: 30, docility: 30 })
  })

  it('性質：效力 powerOf——100 以內等於原值；超過 100 單調不減、連續（101 只比 100 多 0 或 1）、不超過 100 + over_scale', () => {
    const over = DEFAULT_LEWD_RULES.over_scale
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (v) => {
        const p = powerOf(v, over)
        expect(Number.isInteger(p)).toBe(true)
        if (v <= 100) expect(p).toBe(v)
        else {
          expect(p).toBeGreaterThanOrEqual(100)
          expect(p).toBeLessThanOrEqual(100 + over)
        }
        expect(powerOf(v + 1, over)).toBeGreaterThanOrEqual(p)
        expect(powerOf(v + 1, over) - p).toBeLessThanOrEqual(1)
      }),
      { numRuns: 300, seed: 52 },
    )
    expect(powerOf(100, over)).toBe(100)
    expect(powerOf(100, 0)).toBe(100)
    expect(powerOf(101, 0)).toBe(100)
  })

  it('性質：有效值夾在 0～(100 + gear_cap)；段的 range 彼此接得上、最後一段到 100 + gear_cap；有效值落在自己那一段的 range 裡', () => {
    const t = makeGame({ features: [characterFeature, lewdFeature], pc: false, actors: [makeActor({ id: 'pc', name: '主', role: 'pc' })], seed: 3 })
    const { game } = t
    const rules = DEFAULT_LEWD_RULES
    fc.assert(
      fc.property(fc.record({ sensitivity: wild, tolerance: wild, craving: wild, docility: wild }, { requiredKeys: [] }), (raw) => {
        const s = structuredClone(game.state)
        s.actors.pc!.ext.bridge = raw as never
        const v = bridgeOf(game.k, s, 'pc')!
        const last = Math.ceil(100 / rules.band_size) - 1
        for (const p of BRIDGE_PARAMS) {
          const x = v[p]
          expect(x.value).toBeGreaterThanOrEqual(0)
          expect(x.value).toBeLessThanOrEqual(100 + rules.gear_cap)
          expect(x.band).toBeGreaterThanOrEqual(0)
          expect(x.band).toBeLessThanOrEqual(last)
          expect(x.value).toBeGreaterThanOrEqual(x.range[0])
          expect(x.value).toBeLessThanOrEqual(x.range[1])
          expect(x.range[0]).toBe(x.band * rules.band_size)
          if (x.band === last) expect(x.range[1]).toBe(100 + rules.gear_cap)
          else expect(x.range[1]).toBe(x.range[0] + rules.band_size - 1)
        }
      }),
      { numRuns: 100, seed: 53 },
    )
  })
})

describe('邊界 LEWD_SYSTEM 1.1：傾向', () => {
  it('性質：存檔裡的傾向是什麼都行：軸夾在 0～axis_max 的整數、點數不是負的整數、不認得的標籤狀態拿掉', () => {
    const t = makeGame({ features: [characterFeature, lewdFeature], pc: false, actors: [makeActor({ id: 'pc', name: '主', role: 'pc' })], seed: 3 })
    const { game } = t
    fc.assert(
      fc.property(fc.record({ relation: wild, sense: wild, body: wild, costume: wild }, { requiredKeys: [] }), fc.record({ relation: wild, sense: wild, body: wild, costume: wild }, { requiredKeys: [] }), fc.dictionary(fc.constantFrom('a', 'b', 'c'), wild), (axes, points, tags) => {
        const s = structuredClone(game.state)
        s.actors.pc!.ext.tendency = { axes, points, tags } as never
        const tr = tendencyOf(s, 'pc')
        for (const ax of ['relation', 'sense', 'body', 'costume'] as const) {
          expect(Number.isInteger(tr.axes[ax])).toBe(true)
          expect(tr.axes[ax]).toBeGreaterThanOrEqual(0)
          expect(tr.axes[ax]).toBeLessThanOrEqual(DEFAULT_LEWD_RULES.axis_max)
          expect(Number.isInteger(tr.points[ax])).toBe(true)
          expect(tr.points[ax]).toBeGreaterThanOrEqual(0)
        }
        for (const st of Object.values(tr.tags)) expect(TAG_STATES as readonly unknown[]).toContain(st)
      }),
      { numRuns: 150, seed: 54 },
    )
  })
})
