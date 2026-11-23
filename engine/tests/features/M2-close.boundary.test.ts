// 邊界：副本做完的評價、路線留下的敵對值、歷練點。
// 規格：COMMISSIONS 2.3 節（歷練點 小 20、中 35、大 60）、第 8 節與 FACTIONS 6.2 節（走了現實的階段 +5、每個強攻的階段再 +3、最多 +15；全部潛行或交涉成功不加）；dev/adr/0016 G16（評價從 B 起算：
// 每個潛行或交涉成功的階段 +1、三個以上連動 +1、警戒最後 60 以上 −1、到過 100 再 −1，夾在 C～S）；存檔規則的歷練倍率夾在 0.5～2。
// 性質：任何路線、連動數、警戒與最高警戒：評價在 C～S 之內、單調（多一個成功的階段不會變差、警戒越高不會變好）；警戒 59／60、最高 99／100 的門檻；敵對值 = 0 或 min(15, 5 + 3 × 強攻)；歷練點 = round(基準 × 倍率)。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMMISSION_RULES, RATINGS, fallout, rate, xpFor } from '../../src/features/commission'
import type { Rating } from '../../src/features/commission'

const R = DEFAULT_COMMISSION_RULES
type Roll = 'pass' | 'fail' | undefined
const stage = (n: number, kind: string, roll: Roll, face = 'meat') => ({ stage: n, face, kind, ...(roll ? { roll } : {}) })

const run = (route: Array<ReturnType<typeof stage>>, links = 0, faction = 'f_corp') =>
  ({ route, links: Array.from({ length: links }, (_, i) => ({ id: `l${i}` })), def: { target_faction: faction } }) as never

const idx = (r: Rating) => RATINGS.indexOf(r)

describe('邊界 G16：評價', () => {
  it('B 起算：沒有任何加減是 B；一個階段潛行成功 A；兩個 S；三個還是 S（夾在最高）；全部強攻、警戒 100 到過 100：C（夾在最低）', () => {
    expect(rate(run([]), R, 0, 0).rating).toBe('B')
    expect(rate(run([stage(1, 'stealth', 'pass')]), R, 0, 0).rating).toBe('A')
    expect(rate(run([stage(1, 'stealth', 'pass'), stage(2, 'talk', 'pass')]), R, 0, 0).rating).toBe('S')
    expect(rate(run([stage(1, 'stealth', 'pass'), stage(2, 'talk', 'pass'), stage(3, 'stealth', 'pass')], 3), R, 0, 0).rating).toBe('S')
    expect(rate(run([stage(1, 'assault', undefined)]), R, 100, 100).rating).toBe('C')
  })

  it('門檻：警戒 59 不扣、60 扣 1；最高警戒 99 不扣、100 再扣 1；連動 2 個不加、3 個加 1', () => {
    const base = run([], 0)
    expect(rate(base, R, 59, 0).parts.alert).toBe(0)
    expect(rate(base, R, 60, 0).parts.alert).toBe(-1)
    expect(rate(base, R, 0, 99).parts.peak).toBe(0)
    expect(rate(base, R, 0, 100).parts.peak).toBe(-1)
    expect(rate(run([], 2), R, 0, 0).parts.links).toBe(0)
    expect(rate(run([], 3), R, 0, 0).parts.links).toBe(1)
    expect(rate(run([], 3), R, 60, 100).rating).toBe('C')
  })

  it('同一個階段的兩條路（潛行成功兩次）只算一個階段；內海與輿論面的成功也算（只看有沒有 pass）；失敗的不算', () => {
    expect(rate(run([stage(1, 'stealth', 'pass'), stage(1, 'talk', 'pass')]), R, 0, 0).parts.stealth).toBe(1)
    expect(rate(run([stage(1, 'stealth', 'fail')]), R, 0, 0).parts.stealth).toBe(0)
  })

  it('性質：評價在 C～S；多一個成功的階段不會變差；警戒或最高警戒越高不會變好；連動越多不會變差', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ kind: fc.constantFrom('assault', 'stealth', 'talk'), roll: fc.constantFrom('pass', 'fail', undefined) }), { maxLength: 6 }),
        fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }),
        (rows, links, alert, peak) => {
          const route = rows.map((r, i) => stage(i + 1, r.kind, r.roll as Roll))
          const a = rate(run(route, links), R, alert, peak)
          expect(idx(a.rating)).toBeGreaterThanOrEqual(0)
          expect(idx(a.rating)).toBeLessThanOrEqual(RATINGS.length - 1)
          expect(idx(rate(run([...route, stage(route.length + 1, 'stealth', 'pass')], links), R, alert, peak).rating)).toBeGreaterThanOrEqual(idx(a.rating))
          expect(idx(rate(run(route, links), R, Math.min(100, alert + 1), peak).rating)).toBeLessThanOrEqual(idx(a.rating))
          expect(idx(rate(run(route, links), R, alert, Math.min(100, peak + 1)).rating)).toBeLessThanOrEqual(idx(a.rating))
          expect(idx(rate(run(route, links + 1), R, alert, peak).rating)).toBeGreaterThanOrEqual(idx(a.rating))
        },
      ),
      { numRuns: 200, seed: 71 },
    )
  })
})

describe('邊界 FACTIONS 6.2：路線留下的敵對值', () => {
  it('走了現實：第一個階段強攻 +5 +3 = 8；兩個階段強攻 11；三個 14；四個封頂 15；潛行成功的階段不算現實；全部潛行成功不加；沒有目標勢力不加', () => {
    const assaults = (n: number) => run(Array.from({ length: n }, (_, i) => stage(i + 1, 'assault', undefined)))
    expect([1, 2, 3, 4, 5].map((n) => fallout(assaults(n), R).delta)).toEqual([8, 11, 14, 15, 15])
    expect(fallout(run([stage(1, 'stealth', 'pass'), stage(2, 'talk', 'pass')]), R).delta).toBe(0)
    expect(fallout(run([stage(1, 'stealth', 'fail')]), R)).toMatchObject({ delta: 8, assault: 1, reality: 1 }) // 潛行沒過、照強攻走
    expect(fallout(run([stage(1, 'stealth', 'pass'), stage(2, 'assault', undefined)]), R).delta).toBe(8)
    expect(fallout(run([stage(1, 'assault', undefined)], 0, 'none'), R)).toMatchObject({ faction: null, delta: 0 })
    expect(fallout(run([stage(1, 'assault', undefined)], 0, '  '), R).faction).toBeNull()
    expect(fallout(run([]), R).delta).toBe(0)
  })

  it('性質：任何路線，敵對值是 0 或在 5～15；強攻的階段越多不會變少', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ kind: fc.constantFrom('assault', 'stealth', 'talk', 'linked'), roll: fc.constantFrom('pass', 'fail', undefined), face: fc.constantFrom('meat', 'net') }), { maxLength: 8 }), (rows) => {
        const route = rows.map((r, i) => stage(i + 1, r.kind, r.roll as Roll, r.face))
        const f = fallout(run(route), R)
        expect(f.delta === 0 || (f.delta >= 5 && f.delta <= 15)).toBe(true)
        expect(f.assault).toBeLessThanOrEqual(f.reality)
        const more = fallout(run([...route, stage(99, 'assault', undefined)]), R)
        expect(more.delta).toBeGreaterThanOrEqual(f.delta)
      }),
      { numRuns: 150, seed: 72 },
    )
  })
})

describe('邊界 COMMISSIONS 2.3：歷練點', () => {
  const st = (xpMult: number) => ({ rules: { xpMult } }) as never
  it('小 20、中 35、大 60；倍率 0.5 → 10、17.5 進位成 18（四捨五入）、30；倍率 2 → 40、70、120；不認得的規模是 0', () => {
    expect(['small', 'medium', 'large'].map((s) => xpFor(st(1), R, s))).toEqual([20, 35, 60])
    expect(['small', 'medium', 'large'].map((s) => xpFor(st(0.5), R, s))).toEqual([10, 18, 30])
    expect(['small', 'medium', 'large'].map((s) => xpFor(st(2), R, s))).toEqual([40, 70, 120])
    for (const bad of ['huge', '', '__proto__', 'constructor', 'toString']) expect(xpFor(st(1), R, bad)).toBe(0)
  })

  it('性質：倍率 0.5～2 的任何值：歷練點是整數、不是負的、單調（倍率越高不會越少）', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 2, noNaN: true }), fc.double({ min: 0.5, max: 2, noNaN: true }), fc.constantFrom('small', 'medium', 'large'), (a, b, scale) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        const x = xpFor(st(lo), R, scale)
        expect(Number.isInteger(x)).toBe(true)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(xpFor(st(hi), R, scale)).toBeGreaterThanOrEqual(x)
      }),
      { numRuns: 100, seed: 73 },
    )
  })
})
