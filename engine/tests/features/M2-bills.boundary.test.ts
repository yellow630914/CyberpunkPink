// 邊界：每週帳單的結算（planWeek）與下坡路。
// 規格：DOWNTIME 5.1（收入先入帳、照順序扣、錢不夠就停在那一項）、5.2（欠繳週數；第 3 週併成債、債主敵對值 +10）、5.3（帳單倍率 ×0～2）；FIXER 第 4 節；EVENTS 2.4（寬限 7 天）；
// dev/invariants.md 第 7 條（兩種錢不會變成負數）。
// 性質：任何一串項目、任何兩種錢、任何倍率：
//   ① 套完結算的變更，兩種錢 = 原本 + 收入 − 付掉的，而且不是負的；② 一項要嘛全付、要嘛全沒付（沒有付一半）；
//   ③ 某一種錢停在某一項之後，那一種錢後面的項目（沒停掉、沒寬限、金額 > 0）都沒付；④ 有沒付的才加欠繳週數，付清歸零；
//   ⑤ 倍率 0 時沒有任何應付；⑥ 停掉與寬限中的項目不算欠、也不擋後面的。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Feature } from '../../src'
import { clone, toMinutes } from '../../src'
import type { BillLine } from '../../src/features/bills'
import { billsFeature, planWeek, readBills } from '../../src/features/bills'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

interface Box { lines: BillLine[] }
const box: Box = { lines: [] }
const stub: Feature = {
  id: 'collect_stub',
  install(k) {
    k.hooks.on('bill.collect', 'collect_stub', () => clone(box.lines))
  },
}
const { game } = makeGame({
  features: [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), stub, billsFeature],
  content: [METER_CONTENT, { id: 'b', content: { bill_rule: [{ id: 'default', debt_faction: 'f_alpha', debt_rate: 0.1 }] } as never }], seed: 7,
  patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 0, cash: 0 } },
})
const k = game.k
const MONDAY = { day: 7, hour: 6, minute: 0 }

const lineArb = (i: number): fc.Arbitrary<BillLine> =>
  fc.record({
    id: fc.constant(`l${i}`), owner: fc.constant('collect_stub'), name: fc.constant(`項目${i}`),
    kind: fc.constantFrom('income', 'due', 'due', 'due') as fc.Arbitrary<'income' | 'due'>,
    amount: fc.oneof(fc.constant(0), fc.constant(1), fc.integer({ min: 0, max: 800 })),
    order: fc.integer({ min: 1, max: 10 }),
    pay: fc.constantFrom('cred', 'cash', 'either') as fc.Arbitrary<'cred' | 'cash' | 'either'>,
  })

const scenario = fc.record({
  lines: fc.array(fc.nat(7), { maxLength: 8 }).chain((ix) => fc.tuple(...ix.map((_, i) => lineArb(i)))).map((x) => x as BillLine[]),
  cred: fc.integer({ min: 0, max: 2000 }),
  cash: fc.integer({ min: 0, max: 2000 }),
  mult: fc.constantFrom(0, 0.5, 1, 1.5, 2),
  overdue: fc.integer({ min: 0, max: 5 }),
  stopped: fc.array(fc.nat(7), { maxLength: 3 }),
  grace: fc.array(fc.nat(7), { maxLength: 3 }),
  cashPick: fc.array(fc.nat(7), { maxLength: 3 }),
})

function build(o: { lines: BillLine[]; cred: number; cash: number; mult: number; overdue: number; stopped: number[]; grace: number[]; cashPick: number[] }) {
  box.lines = o.lines
  const state = structuredClone(game.state)
  state.money.cred = o.cred
  state.money.cash = o.cash
  state.rules.billMult = o.mult
  const bills = readBills(state)
  bills.overdue = o.overdue
  bills.stopped = [...new Set(o.stopped.map((i) => `l${i}`))]
  bills.grace = Object.fromEntries([...new Set(o.grace.map((i) => `l${i}`))].map((id) => [id, toMinutesOf(MONDAY) + 10]))
  bills.cash = [...new Set(o.cashPick.map((i) => `l${i}`))]
  state.ext.bills = bills as never
  return state
}
const toMinutesOf = toMinutes

describe('邊界 DOWNTIME 5.1、5.2：每週結算', () => {
  it('性質：錢的守恆與不為負、全付或全沒付、停在那一項、欠繳週數、倍率 0', () => {
    fc.assert(
      fc.property(scenario, (o) => {
        const state = build(o)
        const plan = planWeek(k, state, MONDAY)
        const after = structuredClone(state)
        k.changes.applyAll(after, plan.changes)
        for (const pool of ['cred', 'cash'] as const) {
          expect(after.money[pool], pool).toBe(state.money[pool] + plan.income[pool] - plan.paid[pool])
          expect(after.money[pool]).toBeGreaterThanOrEqual(0)
        }
        for (const l of plan.lines.filter((x) => x.kind === 'due')) {
          if (l.skipped) {
            expect(l.paid + l.unpaid).toBe(0)
            continue
          }
          expect(l.paid === 0 || l.unpaid === 0, `${l.id} 付一半`).toBe(true)
          expect(l.paid + l.unpaid).toBe(l.amount)
        }
        // 停在那一項：同一種錢，第一個沒付成的之後（照 order、同 order 照收集順序），沒停掉、沒寬限、金額 > 0 的都沒付
        for (const pool of ['cred', 'cash'] as const) {
          const dues = plan.lines.filter((x) => x.kind === 'due' && x.pool === pool && !x.skipped && x.amount > 0)
          const firstUnpaid = dues.findIndex((x) => x.unpaid > 0)
          if (firstUnpaid >= 0) for (const l of dues.slice(firstUnpaid)) expect(l.unpaid, `${pool} 停在 ${dues[firstUnpaid]!.id} 之後 ${l.id} 還付了`).toBeGreaterThan(0)
        }
        const short = plan.lines.some((l) => l.unpaid > 0)
        expect(plan.short).toBe(short)
        expect(plan.overdue).toBe(short ? o.overdue + 1 : 0)
        expect(plan.next.overdue).toBe(plan.overdue)
        if (!short) expect(plan.next.arrears).toBe(0)
        if (o.mult === 0) expect(plan.lines.filter((l) => l.kind === 'due').every((l) => l.amount === 0)).toBe(true)
        expect(plan.stopsAt === null).toBe(!short)
        // 收入不受倍率、停掉與寬限影響
        const incomeLines = plan.lines.filter((l) => l.kind === 'income')
        for (const l of incomeLines) expect(l.paid).toBe(l.amount)
      }),
      { numRuns: 400, seed: 20261125 },
    )
  })

  it('第 3 週併成債：沒付清而欠繳週數剛好走到第 3 週，所有欠款併成一筆債（本金 = 累計欠款）、欠款歸零、債主敵對值 +10；第 4 週起不再併', () => {
    box.lines = [{ id: 'rent', owner: 'collect_stub', name: '房租', kind: 'due', amount: 100, order: 1, pay: 'cred' }]
    const state = structuredClone(game.state)
    state.money.cred = 0
    const run = (overdue: number, arrears: number) => {
      const s = structuredClone(state)
      const b = readBills(s)
      b.overdue = overdue
      b.arrears = arrears
      s.ext.bills = b as never
      return planWeek(k, s, MONDAY)
    }
    const w1 = run(0, 0)
    expect(w1.overdue).toBe(1)
    expect(w1.merged).toBeNull()
    expect(w1.next.arrears).toBe(100)
    const w2 = run(1, 100)
    expect(w2.overdue).toBe(2)
    expect(w2.merged).toBeNull()
    const w3 = run(2, 200)
    expect(w3.overdue).toBe(3)
    expect(w3.merged).toMatchObject({ to: 'f_alpha', principal: 300 })
    expect(w3.next.arrears).toBe(0)
    expect(w3.next.debts).toHaveLength(1)
    expect(w3.changes).toContainEqual({ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 10 })
    const w4 = run(3, 0)
    expect(w4.overdue).toBe(4)
    expect(w4.merged).toBeNull()
    expect(w4.changes.some((c) => c.op === 'meter')).toBe(false)
    expect(w4.next.arrears).toBe(100)
  })

  it('剛好付得起（帳戶 = 項目的總和）不算欠；少 1 塊整項沒付；收入先入帳可以讓原本付不起的付得起', () => {
    box.lines = [
      { id: 'a', owner: 'collect_stub', name: 'a', kind: 'due', amount: 60, order: 1, pay: 'cred' },
      { id: 'b', owner: 'collect_stub', name: 'b', kind: 'due', amount: 40, order: 2, pay: 'cred' },
    ]
    const at = (cred: number) => {
      const s = structuredClone(game.state)
      s.money.cred = cred
      return planWeek(k, s, MONDAY)
    }
    expect(at(100).short).toBe(false)
    const short = at(99)
    expect(short.short).toBe(true)
    expect(short.stopsAt).toBe('b')
    expect(short.paid.cred).toBe(60)
    expect(short.unpaid.cred).toBe(40)
    box.lines = [{ id: 'pay', owner: 'collect_stub', name: '收入', kind: 'income', amount: 1, order: 1, pay: 'cred' }, ...box.lines]
    expect(at(99).short).toBe(false)
  })

  it('停掉的與寬限中的項目不算欠、也不擋後面的；寬限到期的那一刻（until 剛好 = 現在）還算寬限，晚 1 分鐘就要付', () => {
    box.lines = [
      { id: 'sub', owner: 'collect_stub', name: '訂閱', kind: 'due', amount: 500, order: 1, pay: 'cred' },
      { id: 'rent', owner: 'collect_stub', name: '房租', kind: 'due', amount: 50, order: 2, pay: 'cred' },
    ]
    const s = structuredClone(game.state)
    s.money.cred = 50
    const b = readBills(s)
    b.stopped = ['sub']
    s.ext.bills = b as never
    const stopped = planWeek(k, s, MONDAY)
    expect(stopped.short).toBe(false)
    expect(stopped.lines.find((l) => l.id === 'sub')).toMatchObject({ skipped: true, why: 'stopped' })
    const t = structuredClone(game.state)
    t.money.cred = 50
    const g = readBills(t)
    g.grace = { sub: toMinutesOf(MONDAY) }
    t.ext.bills = g as never
    expect(planWeek(k, t, MONDAY).lines.find((l) => l.id === 'sub')).toMatchObject({ skipped: true, why: 'grace' })
    g.grace = { sub: toMinutesOf(MONDAY) - 1 }
    t.ext.bills = g as never
    const late = planWeek(k, t, MONDAY)
    expect(late.lines.find((l) => l.id === 'sub')!.unpaid).toBe(500)
    expect(late.short).toBe(true)
  })
})
