// 邊界：打工的數字。
// 規格：DOWNTIME 4.1（一班 2、4、8 小時）、4.1a（階段倍率 1、1.5、2.5；第二階段要做滿 5 班、雇主親密度 20）、4.2（報酬 = 時數 × 時薪 × 階段 × 成功程度；大成功 1.5、成功 1、失敗 0.5、大失敗 0 且雇主親密度 −3）；
// dev/invariants.md 第 7 條（錢不會是負的）。
// 性質：任何種子與班長，報酬 = round(時數 × 時薪 × 階段倍率 × 成功程度)，付的錢就是記的那一筆，另一種錢不動，時間剛好是班長；
// 不是 2、4、8 的班長一律擋；大失敗沒有錢也扣雇主親密度 3 而不會低於 0；升階的邊界（第 4 班不問、第 5 班問；親密度 19 不問、20 問）。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked, meterOf, toMinutes } from '../../src'
import { DEFAULT_WORK_RULES, jobStateOf, promotionDue, shift, shiftBlock, wageOf, workRules } from '../../src/features/work'
import { makeCityGame, walkTo } from '../../src/testkit'

const JOB = 'j_tw_porter'

/** 站到碼頭上（塔下的西口走到市場、再走到市場的碼頭 F2）；時間會走掉。 */
function atDock(seed: number) {
  const t = makeCityGame({ seed })
  walkTo(t.game, 'F1') // 起點本來就站在西口上，要先離開再走回去才算走進出口
  walkTo(t.game, 'E1')
  walkTo(t.game, 'F2')
  return t.game
}

describe('邊界 DOWNTIME 4.2：一班的報酬', () => {
  it('性質：任何種子與班長（2、4、8）：報酬 = round(時數 × 時薪 × 階段 × 成功程度)，記了就付、只動工作寫的那種錢；時間剛好是班長；大失敗扣雇主親密度 3（親密度的範圍是 −100～100，不會低於 −100）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), fc.constantFrom(2, 4, 8), (seed, hours) => {
        const g = atDock(seed)
        const k = g.k
        const t0 = toMinutes(g.state.time)
        const money = { ...g.state.money }
        const affinity = meterOf(k, g.state, 'affinity', 'npc_tw_vendor')
        const reports = g.commit(shift(k, g.state, JOB, hours))
        const r = reports[0]!
        const beat = r.timeline.find((b) => b.tag === 'work.shift')!.data as { degree: string | null; amount: number; pay: string }
        const mult = DEFAULT_WORK_RULES.degree_mult[(beat.degree ?? 'success') as keyof typeof DEFAULT_WORK_RULES.degree_mult]
        expect(beat.amount).toBe(Math.round(hours * 10 * 1 * mult))
        expect(g.state.money.cash - money.cash).toBe(beat.amount)
        expect(g.state.money.cred).toBe(money.cred)
        expect(toMinutes(g.state.time) - t0).toBe(hours * 60)
        const after = meterOf(k, g.state, 'affinity', 'npc_tw_vendor')
        if (beat.degree === 'fumble') expect(after).toBe(Math.max(-100, affinity - 3))
        else expect(after).toBeGreaterThanOrEqual(affinity)
        expect(jobStateOf(g.state, JOB).shifts).toBe(1)
      }),
      { numRuns: 30, seed: 5 },
    )
  })

  it('公式：wageOf 在四種成功程度、三種班長、兩個階段下都是整數、不是負的；大失敗是 0；大成功是成功的 1.5 倍（四捨五入）', () => {
    const k = atDock(7).k
    const job = k.content.get('job', JOB) as never as { wage: number; stages: Array<{ mult: number }> }
    const rules = workRules(k)
    for (const stage of job.stages) {
      for (const hours of [2, 4, 8]) {
        const w = (d: 'critical' | 'success' | 'fail' | 'fumble') => wageOf(rules, job as never, stage as never, hours, d)
        for (const d of ['critical', 'success', 'fail', 'fumble'] as const) {
          expect(Number.isInteger(w(d))).toBe(true)
          expect(w(d)).toBeGreaterThanOrEqual(0)
        }
        expect(w('fumble')).toBe(0)
        expect(w('critical')).toBeGreaterThanOrEqual(w('success'))
        expect(w('success')).toBeGreaterThanOrEqual(w('fail'))
        expect(w('critical')).toBe(Math.round(hours * job.wage * stage.mult * 1.5))
      }
    }
  })

  it('班長只能是規則裡的 2、4、8：0、1、3、−2、1.5、NaN、Infinity、9、16 一律擋（寫出可以的班長）；規則改了就跟著改', () => {
    const g = atDock(7)
    for (const h of [0, 1, 3, 5, 6, 7, 9, 16, 24, -2, -8, 1.5, 2.0000001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const why = shiftBlock(g.k, g.state, JOB, h)
      expect(why, String(h)).toContain('2、4、8')
      expect(() => shift(g.k, g.state, JOB, h), String(h)).toThrow(ActionBlocked)
    }
    for (const h of [2, 4, 8]) expect(shiftBlock(g.k, g.state, JOB, h)).toBeNull()
    expect(shiftBlock(g.k, g.state, 'j_nope', 4)).toContain('沒有 j_nope')
  })

  it('不在碼頭上不能做；沒有主角不能做', () => {
    const t = makeCityGame({ seed: 7 })
    expect(shiftBlock(t.game.k, t.game.state, JOB, 4)).toContain('才能做')
    const noPc = makeCityGame({ seed: 7 })
    noPc.game.state.pc = null as never
    expect(shiftBlock(noPc.game.k, noPc.game.state, JOB, 4)).toBe('還沒有主角。')
  })
})

describe('邊界 DOWNTIME 4.1a：升階的條件', () => {
  it('第 2 階段要做滿 5 班而且雇主親密度 ≥ 20：班數差 1 不問、親密度差 1 不問、兩個都剛好才問', () => {
    const g = atDock(7)
    const job = g.k.content.get('job', JOB) as never
    const sim = (shifts: number, affinity: number) => {
      const s = structuredClone(g.state)
      s.ext.work = { jobs: { [JOB]: { shifts, stage: 0, asked: false, last: null } }, announce: [] } as never
      s.ext.meters = s.ext.meters
      // 親密度是量表：直接在狀態裡設定
      const meters = (s as unknown as { meters: Record<string, Record<string, number>> }).meters
      meters.affinity = { ...(meters.affinity ?? {}), npc_tw_vendor: affinity }
      return promotionDue(g.k, s, job, jobStateOf(s, JOB))
    }
    expect(sim(5, 20)).toBe(true)
    expect(sim(4, 20)).toBe(false)
    expect(sim(5, 19)).toBe(false)
    expect(sim(100, 100)).toBe(true)
    expect(sim(0, 0)).toBe(false)
  })
})
