// B039（M4 探針，cpp-tester-probe）→ M4-fix-2 修正，使用者 2026-11-26 裁決 2：欠的房租沒補齊時轉成債（併進帳單的債），房間可以解鎖。
// 規格：DOWNTIME 5.2「只要還有沒付的項目……欠繳週數 +1；付清歸零」與「房租欠了兩週：門鎖換掉，東西扣在裡面，付清才開」；FIXER 第 4 節（付不出來的下坡）。
// 以前：欠了幾週之後只付當週的，planWeek 把累積的欠款（arrears）一筆勾銷，門鎖卻開了；欠的錢不再被收、也沒有變成債。
// 現在：這一週付清了、可是之前累積的欠款沒補，就併成一筆債（債主、利率照規則表 bill_rule；敵對值照併債的規矩加），欠繳歸零，門鎖照當週付清的規矩解開。
// 重現：makeCityGame（週租 100）；dev/bugs/B039-rent-arrears-forgiven.md。

import { describe, expect, it } from 'vitest'
import { readBills, billRules, planWeek } from '../../src/features/bills'
import { readRest } from '../../src/features/rest'
import { makeCityGame, observed, passUntil } from '../../src/testkit'

type G = ReturnType<typeof makeCityGame>['game']
const money = (g: G, changes: Array<{ op: 'cred' | 'cash'; delta: number }>): void => {
  g.commit({ kind: 'system', action: 'test.money', location: { ...g.state.location }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
}
const broke = (g: G): void => money(g, [{ op: 'cred', delta: -g.state.money.cred }, { op: 'cash', delta: -g.state.money.cash }])
const monday = (g: G): void => {
  let day = g.state.time.day
  while (day % 7 !== 0 || (day === g.state.time.day && g.state.time.hour >= 6)) day += 1
  passUntil(g, { day, hour: 6 })
}
const owedDebts = (g: G): number => readBills(g.state).debts.reduce((n, d) => n + d.principal, 0)

describe('B039：欠的房租沒補齊時轉成債', () => {
  it('欠兩週（欠款 200、門鎖換掉）之後有錢的那個週一：當週的 100 照收，欠的 200 併成一筆債，欠繳歸零、門鎖打開', async () => {
    const { game: g } = makeCityGame()
    broke(g)
    monday(g)
    monday(g)
    const owed = readBills(g.state)
    expect(owed).toMatchObject({ overdue: 2, arrears: 200 })
    expect(owed.debts).toEqual([])
    expect(readRest(g.state).home!.locked).toBe(true)

    money(g, [{ op: 'cred', delta: 1000 }])
    const run = await observed(g, () => monday(g))
    const after = readBills(g.state)
    expect(g.state.money.cred).toBe(900)
    expect(after.overdue).toBe(0)
    expect(after.arrears).toBe(0)
    expect(after.debts).toHaveLength(1)
    expect(after.debts[0]).toMatchObject({ principal: 200, to: billRules(g.k).debt_faction })
    expect(readRest(g.state).home!.locked).toBe(false)
    expect(run.violations).toEqual([])
  })

  it('這一週的結算報告寫出併債的那一句；債之後每週收利息', () => {
    const { game: g } = makeCityGame()
    broke(g)
    monday(g)
    monday(g)
    money(g, [{ op: 'cred', delta: 1000 }])
    monday(g)
    const settle = [...g.state.reports].reverse().find((r) => r.action === 'bill.settle')!
    expect(settle.outcome.summary).toContain('併成了一筆 200 的債')
    // 下一個週一：房租 100 加債息（5% × 200 = 10）
    const before = g.state.money.cred
    monday(g)
    expect(before - g.state.money.cred).toBe(100 + Math.round(200 * billRules(g.k).debt_rate))
  })

  it('欠到第 4 週（第 3 週已併過債）再補當週：第 4 週累積的欠款也不勾銷，轉成第二筆債，本金的總和是 300 + 115', () => {
    const { game: g } = makeCityGame()
    broke(g)
    for (let i = 0; i < 4; i++) monday(g)
    const mid = readBills(g.state)
    expect(mid.overdue).toBe(4)
    expect(mid.debts).toHaveLength(1)
    expect(mid.debts[0]!.principal).toBe(300)
    expect(mid.arrears).toBe(115)
    money(g, [{ op: 'cred', delta: 5000 }])
    monday(g)
    const after = readBills(g.state)
    expect(after.overdue).toBe(0)
    expect(after.arrears).toBe(0)
    expect(owedDebts(g)).toBe(300 + 115)
    expect(after.debts).toHaveLength(2)
    expect(readRest(g.state).home!.locked).toBe(false)
  })

  it('一直付得起的人不受影響：沒有欠款就不會有新債；預覽（planWeek）與真的結算是同一個數字', () => {
    const { game: g } = makeCityGame()
    monday(g)
    expect(readBills(g.state)).toMatchObject({ overdue: 0, arrears: 0 })
    expect(readBills(g.state).debts).toEqual([])
    // 欠了一週、還沒滿三週、當週補得起：預覽也看得到欠款會轉成債
    broke(g)
    monday(g)
    expect(readBills(g.state)).toMatchObject({ overdue: 1, arrears: 100 })
    money(g, [{ op: 'cred', delta: 1000 }])
    const plan = planWeek(g.k, g.state, { ...g.state.time, day: g.state.time.day + 7, hour: 6, minute: 0 })
    expect(plan.merged).toMatchObject({ principal: 100 })
    expect(plan.next.arrears).toBe(0)
    expect(plan.next.debts).toHaveLength(1)
  })
})
