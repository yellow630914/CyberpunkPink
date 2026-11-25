// 邊界測試：M3 自己去挖的子網（CYBERSPACE 8.3 節「追蹤度在生成的子網裡」；NETRUNNING 5 節：起始值、登出時留下的敵對值；dev/adr/0018 N16、N34、N35）。
// 每個數值測：下限、下限−1、上限、上限+1、零、最大組合；組合用 fast-check。
//
// 邊界表：
//   敵對值 → 追蹤度起點         0～19 是 0、20（記名）起 15、99 仍是 15、100（通緝）是 30；詞條與設定寫的起點取最高的、不相加
//   起點的夾值                   連動與預備的加減算完之後落在 −30～100（量表的範圍）
//   離開時留下的敵對值          ceil(追蹤度 ÷ 20)，最多 5：追蹤度 −30、−1、0、1、20、21、100；被定位另外 +5
//   七天內再進去                 離開後剛好 7 天（10,080 分鐘）還是同一張、多 1 分鐘就重整；追蹤度從上次的一半（無條件捨去）起算，和敵對值的起點取高的
//   後門清除                     機率 0 永遠不清、1 永遠清、0.5 約一半；同一座同一次離開永遠同一個結果（骰面固定）

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { clone, meterOf } from '../../src'
import { go as diveGo } from '../../src/features/dive'
import { keptOf, logout, netExt, readRun } from '../../src/features/netrun'
import { backdoorClears, expired, traceStartOf } from '../../src/features/netrun/dig'
import { DEFAULT_RULES } from '../../src/features/netrun/model'
import { diveIn, makeDiveGame } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']

const SITE = 'tw_site_a'
// 潛入中只放行一部分的 doing（DIVE_ALLOW）：用「事件」這一類的報告提交測試用的變更（commit:event. 放行）
const commit = (g: G, changes: unknown[]) => g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })
const hostility = (g: G, n: number) => commit(g, [{ op: 'meter', kind: 'hostility', key: 'f_gang', set: n }])
const trace = (g: G): number => meterOf(g.k, g.state, 'trace', readRun(g.state)!.map)
const putTrace = (g: G, v: number) => commit(g, [{ op: 'meter', kind: 'trace', key: readRun(g.state)!.map, set: v }])
/** 潛入、選去處（自己去挖的子網）。 */
function dig(g: G): void {
  if (!g.k.activity.active(g.state).some((a) => a.kind === 'dive')) diveIn(g)
  g.commit(diveGo(g.k, g.state, 'ns_tw_dig'))
}
const newGame = (seed = 4): G => makeDiveGame({ seed }).game

describe('邊界 NETRUNNING 5／ADR 0018 N16：敵對值 → 追蹤度的起點', () => {
  it('敵對值 0、19（記名之前）是 0；20（記名的下限）是 15；99 是 15；100（通緝）是 30', () => {
    const start = (h: number): number => {
      const g = newGame()
      hostility(g, h)
      dig(g)
      return trace(g)
    }
    expect([0, 1, 19].map(start)).toEqual([0, 0, 0])
    expect([20, 21, 39, 40, 99].map(start)).toEqual([15, 15, 15, 15, 15])
    expect(start(100)).toBe(30)
  })

  it('traceStartOf：幾個來源取最高、不相加；沒有來源是 0；加減照給（負的可以到 −30 之下，量表自己夾）；性質：= max(0, 來源…) + 加減', () => {
    expect(traceStartOf([], 0)).toBe(0)
    expect(traceStartOf([0, 15, 10], 0)).toBe(15)
    expect(traceStartOf([10], 0)).toBe(10)
    expect(traceStartOf([15], -5)).toBe(10)
    expect(traceStartOf([0], -40)).toBe(-40)
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 4 }), fc.integer({ min: -50, max: 50 }), (src, d) => {
      expect(traceStartOf(src, d)).toBe(Math.max(0, ...src) + d)
    }), { numRuns: 100 })
  })

  it('預備與連動讓起點超出 −30～100：量表夾在 −30 與 100（+200 → 100、−200 → −30）；敵對值通緝再加預備不會超過 100', () => {
    for (const [delta, want, h] of [[200, 100, 0], [-200, -30, 0], [90, 100, 100], [-5, 25, 100], [0, 0, 0]] as const) {
      const g = newGame()
      g.k.stats.addStatProvider('net_trace_start', 'm3_dig_boundary', () => [{ label: '邊界', value: delta, source: 'test' }])
      hostility(g, h)
      dig(g)
      expect(trace(g), `加減 ${delta}、敵對值 ${h}`).toBe(want)
    }
  })
})

describe('邊界 NETRUNNING 5／ADR 0018 N34：離開時留下的敵對值', () => {
  /** 在追蹤度 t 的時候登出，目標勢力的敵對值多了多少。 */
  function left(t: number): number {
    const g = newGame()
    dig(g)
    putTrace(g, t)
    const before = meterOf(g.k, g.state, 'hostility', 'f_gang')
    g.commit(logout(g.k, g.state))
    return meterOf(g.k, g.state, 'hostility', 'f_gang') - before
  }

  it('每 20 點 +1、進位、最多 5：追蹤度 −30、−1、0 是 0；1、20 是 1；21 是 2；40 是 2；41 是 3；80 是 4；81、100 是 5', () => {
    const want: Array<[number, number]> = [[-30, 0], [-1, 0], [0, 0], [1, 1], [19, 1], [20, 1], [21, 2], [40, 2], [41, 3], [60, 3], [61, 4], [80, 4], [81, 5], [99, 5], [100, 5]]
    for (const [t, d] of want) expect(left(t), `追蹤度 ${t}`).toBe(d)
  })

  it('性質：任何追蹤度（−30～100）離開時留下的敵對值 = min(5, ceil(max(0, t) ÷ 20))；追蹤度越高留下的越多（不減）', () => {
    const rules = DEFAULT_RULES
    expect(rules.leave_hostility).toBe(20)
    expect(rules.leave_hostility_max).toBe(5)
    fc.assert(fc.property(fc.integer({ min: -30, max: 100 }), (t) => {
      expect(left(t)).toBe(Math.min(5, Math.ceil(Math.max(0, t) / 20)))
    }), { numRuns: 12 })
  })
})

describe('邊界 CYBERSPACE 8.3：七天內再進去同一座（追蹤度從上次離開時的一半起算）', () => {
  it('追蹤度的一半無條件捨去：離開時 0、1、2、3、29、30、60、100 → 再進去 0、0、1、1、14、15、30、50；敵對值的起點（記名 15、通緝 30）比較高時取高的', () => {
    for (const [t, half] of [[0, 0], [1, 0], [2, 1], [3, 1], [29, 14], [30, 15], [60, 30], [100, 50]] as const) {
      const g = newGame()
      dig(g)
      putTrace(g, t)
      g.commit(logout(g.k, g.state))
      dig(g)
      expect(trace(g), `離開時 ${t}`).toBe(half)
      expect(netExt(g.state, readRun(g.state)!.map)!.dig!.visits).toBe(2)
    }
    // 記名（15）的人上次離開時 10：一半是 5，起點取 15
    const g = newGame()
    dig(g)
    putTrace(g, 10)
    g.commit(logout(g.k, g.state))
    hostility(g, 20)
    dig(g)
    expect(trace(g)).toBe(15)
    // 通緝（30）、上次離開 100：一半是 50，取 50
    const h = newGame()
    dig(h)
    putTrace(h, 100)
    h.commit(logout(h.k, h.state))
    hostility(h, 100)
    dig(h)
    expect(trace(h)).toBe(50)
  })

  it('離開之後剛好 7 天（10,080 分鐘）還是同一張圖；多 1 分鐘（10,081）被重整、下次是新的一張（visits 回到 1）；少 1 分鐘當然還在', () => {
    for (const [minutes, same] of [[10_079, true], [10_080, true], [10_081, false]] as const) {
      const g = newGame()
      dig(g)
      const map = readRun(g.state)!.map
      g.commit(logout(g.k, g.state))
      commit(g, [{ op: 'time', minutes }])
      expect(!!keptOf(g.state, SITE), `${minutes} 分鐘`).toBe(same)
      dig(g)
      expect(readRun(g.state)!.map === map, `${minutes} 分鐘後是同一張`).toBe(same)
      expect(netExt(g.state, readRun(g.state)!.map)!.dig!.visits).toBe(same ? 2 : 1)
    }
  })

  it('expired：沒有 left（人還在裡面）永遠不過期；剛好 keep_days 天不過期、多 1 分鐘過期；性質：離開時間越早越容易過期', () => {
    const rules = DEFAULT_RULES
    expect(rules.keep_days).toBe(7)
    expect(expired(rules, null, 10 ** 9)).toBe(false)
    expect(expired(rules, { left: undefined } as never, 10 ** 9)).toBe(false)
    const net = { left: { at: 1000, trace: 0 } } as never
    expect(expired(rules, net, 1000 + 7 * 1440)).toBe(false)
    expect(expired(rules, net, 1000 + 7 * 1440 + 1)).toBe(true)
    expect(expired(rules, net, 999)).toBe(false)
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 30_000 }), fc.integer({ min: 0, max: 30_000 }), (at, a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      const n = { left: { at, trace: 0 } } as never
      if (expired(rules, n, at + lo)) expect(expired(rules, n, at + hi)).toBe(true)
    }), { numRuns: 100 })
  })
})

describe('邊界 CYBERSPACE 8.3：被定位之後後門有一半的機會被清掉', () => {
  it('機率 0 永遠不清、1 永遠清；同一座同一層同一次離開永遠同一個結果（骰面由種子與層固定）', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), fc.integer({ min: 1, max: 9 }), (seed, visits) => {
      expect(backdoorClears(seed, 'm1', 'l1', visits, 0)).toBe(false)
      expect(backdoorClears(seed, 'm1', 'l1', visits, 1)).toBe(true)
      expect(backdoorClears(seed, 'm1', 'l1', visits, 0.5)).toBe(backdoorClears(seed, 'm1', 'l1', visits, 0.5))
    }), { numRuns: 100 })
  })

  it('機率越高越容易清（同一個骰面，清得掉的機率不會因為機率變大反而清不掉）；0.5 時兩千個種子裡清掉的約一半（45%～55%）', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (seed, a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      if (backdoorClears(seed, 'm2', 'l2', 1, lo)) expect(backdoorClears(seed, 'm2', 'l2', 1, hi)).toBe(true)
    }), { numRuns: 100 })
    let cleared = 0
    for (let seed = 1; seed <= 2000; seed++) if (backdoorClears(seed * 7919, 'm3', 'l1', 1, 0.5)) cleared += 1
    expect(cleared).toBeGreaterThan(900)
    expect(cleared).toBeLessThan(1100)
  })

  it('被定位的離開：留下的後門各照骰面清或留；沒被定位的離開（登出）不動後門；來源是 DEFAULT 規則的 backdoor_clear 0.5', () => {
    expect(DEFAULT_RULES.backdoor_clear).toBe(0.5)
    const g = newGame()
    dig(g)
    const map = readRun(g.state)!.map
    const st = clone(netExt(g.state, map)!)
    st.backdoors = ['l1', 'l2']
    commit(g, [{ op: 'map.ext', map, value: { ...clone(g.state.maps.instances[map]!.ext ?? {}), net: st } }])
    g.commit(logout(g.k, g.state))
    expect(netExt(g.state, map)!.backdoors).toEqual(['l1', 'l2'])
  })
})
