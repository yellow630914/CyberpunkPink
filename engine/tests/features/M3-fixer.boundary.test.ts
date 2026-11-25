// 邊界測試：出發時敵對值的分段對內海委託的影響（NETRUNNING 5 節的起始值；FACTIONS 6.1 節的分段：記名 20、找麻煩 40、追捕 60、懸賞 80、通緝 100；dev/adr/0018 N16）。
// 邊界表：
//   追蹤度起點      敵對值 19 → 0、20（記名）→ 15、99 → 15、100（通緝）→ 30；踩點驚動 15 和敵對值取高的、不相加；沒有內海階段的委託敵對值不算
//   遭遇預算 +1     敵對值 39 沒有、40（找麻煩）起 +1（FIXER 第 2 節③）
//   警戒起始 +20    敵對值 59 沒有、60（追捕）起 +20；上限 100
//   性質            敵對值越高，三樣加成只增不減

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { clone } from '../../src'
import { go, jobOf, traceStartOf } from '../../src/features/fixer'
import { fixerNetRules, fixerRules } from '../../src/features/fixer/model'
import { makeNetCommissionGame } from '../../src/testkit'

type T = ReturnType<typeof makeNetCommissionGame>

function setup() {
  const t = makeNetCommissionGame()
  return t
}
/** 手上那一件委託的原始資料（jobOf 回傳的是複本，要改得改狀態裡的）。 */
const rawJob = (t: T): Record<string, unknown> => ((t.game.state.ext.fixer as { jobs: Array<Record<string, unknown>> }).jobs.find((j) => j.id === t.job))!
const hostility = (t: T, n: number) => { t.game.state.meters.hostility = { ...t.game.state.meters.hostility, f_gang: n } }
const start = (t: T): number => traceStartOf(t.game.k, t.game.state, jobOf(t.game.state, t.job)!)
const launch = (t: T): { setup: Record<string, unknown> } => {
  const d = go(t.game.k, t.game.state, t.job)
  return d.launch![0] as never
}

describe('邊界 NETRUNNING 5／ADR 0018 N16：出發時追蹤度的起點（委託）', () => {
  it('規則表的數字：記名 15、通緝 30、踩點驚動 15', () => {
    expect(fixerNetRules(makeNetCommissionGame().game.k).trace_start).toEqual({ noted: 15, wanted: 30, scout_alert: 15 })
  })

  it('敵對值 0、19 是 0；20（記名的下限）、21、99 是 15；100（通緝）是 30；setup 只在大於 0 時才帶 trace_start', () => {
    for (const [h, want] of [[0, 0], [1, 0], [19, 0], [20, 15], [21, 15], [39, 15], [99, 15], [100, 30]] as const) {
      const t = setup()
      hostility(t, h)
      expect(start(t), `敵對值 ${h}`).toBe(want)
      const s = launch(t).setup
      if (want > 0) expect(s.trace_start, `敵對值 ${h}`).toBe(want)
      else expect(s).not.toHaveProperty('trace_start')
    }
  })

  it('踩點驚動過（job.trace_start 15）和敵對值取最高的、不相加：敵對值 0 → 15、19 → 15、20 → 15（不是 30）、100 → 30；踩點的數字大過敵對值也照用（夾在 100）', () => {
    for (const [h, want] of [[0, 15], [19, 15], [20, 15], [99, 15], [100, 30]] as const) {
      const t = setup()
      hostility(t, h)
      rawJob(t).trace_start = 15
      expect(start(t), `敵對值 ${h} 加踩點驚動`).toBe(want)
    }
    const t = setup()
    rawJob(t).trace_start = 500
    expect(start(t)).toBe(100)
  })

  it('沒有內海階段的委託：敵對值不算進追蹤度（現實面的委託照樣出發）；踩點記的照舊', () => {
    const t = setup()
    hostility(t, 100)
    const job = jobOf(t.game.state, t.job)!
    const meatOnly = clone(job)
    meatOnly.commission.stages = meatOnly.commission.stages.map((st) => ({ ...st, faces: { meat: (st.faces as Record<string, unknown>).meat } })) as never
    expect(traceStartOf(t.game.k, t.game.state, meatOnly)).toBe(0)
    meatOnly.trace_start = 15
    expect(traceStartOf(t.game.k, t.game.state, meatOnly)).toBe(15)
  })
})

describe('邊界 FACTIONS 6.1／FIXER 第 2 節③：敵對值的分段對出發的加成', () => {
  it('找麻煩（40）起遭遇預算 +1（39 沒有）；追捕（60）起警戒起始 +20（59 沒有）；懸賞與通緝（高的段包含低的段）都有；警戒起始夾在 100', () => {
    const rules = fixerRules(makeNetCommissionGame().game.k)
    for (const [h, plus, alert] of [[0, false, false], [39, false, false], [40, true, false], [59, true, false], [60, true, true], [80, true, true], [100, true, true]] as const) {
      const t = setup()
      hostility(t, h)
      const s = launch(t).setup
      expect(s.encounter_plus, `敵對值 ${h} 的遭遇預算`).toBe(plus ? rules.hostile_budget : undefined)
      expect(s.alert_start as number, `敵對值 ${h} 的警戒起始`).toBe(alert ? rules.hostile_alert : 0)
    }
    const t = setup()
    hostility(t, 60)
    ;(rawJob(t).commission as Record<string, unknown>).alert_start = 95
    expect(launch(t).setup.alert_start).toBe(100)
  })

  it('性質：敵對值（0～100）越高，追蹤度起點、遭遇預算、警戒起始都只增不減', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      const ta = setup(); hostility(ta, lo)
      const tb = setup(); hostility(tb, hi)
      expect(start(tb)).toBeGreaterThanOrEqual(start(ta))
      const sa = launch(ta).setup, sb = launch(tb).setup
      expect((sb.encounter_plus as number | undefined) ?? 0).toBeGreaterThanOrEqual((sa.encounter_plus as number | undefined) ?? 0)
      expect(sb.alert_start as number).toBeGreaterThanOrEqual(sa.alert_start as number)
    }), { numRuns: 20 })
  })
})
