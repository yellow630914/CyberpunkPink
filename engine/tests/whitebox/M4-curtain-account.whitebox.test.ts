// 白箱：features/curtain 落幕之後的帳（fall.ts 的還款、買回母帶）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：LEWD_SYSTEM 第 8 節「簾後館」的落幕（罰款三條路：付清、記帳、簽檔期；母帶買回是保證金的兩倍）；dev/work/M4-curtain-fall.md；dev/adr/0019 簾後館的那幾條。
// 一局：makeBodyGame；欠款與母帶直接寫進 state.ext.curtain（和 tests/features/M4-curtain-fall.test.ts 第 563 行同一種寫法）。

import { describe, expect, it } from 'vitest'
import type { Change, ReportDraft } from '../../src'
import { ActionBlocked } from '../../src'
import { accountView, buybackBlock, curtainOf, payTabBlock, payTabDraft } from '../../src/features/curtain'
import { makeBodyGame } from '../../src/testkit'

const sys = (changes: Change[], action = 'test.give'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
/** 欠簾後館 owed（現金 2,000）。 */
function owing(owed: number, extra: Record<string, unknown> = {}) {
  const g = makeBodyGame().game
  g.commit(sys([{ op: 'ext', key: 'curtain', value: { ...curtainOf(g.state), tab: { owed, since: 0 }, ...extra } as never }]))
  return g
}

describe('還款（LEWD_SYSTEM 第 8 節落幕「記帳」：欠的錢之後用現金還）', () => {
  it('沒有欠款：「你沒有欠簾後館的錢。」', () => {
    const g = makeBodyGame().game
    expect(payTabBlock(g.k, g.state)).toBe('你沒有欠簾後館的錢。')
    expect(reasonOf(() => payTabDraft(g.k, g.state))).toBe('你沒有欠簾後館的錢。')
  })

  it('金額不是 1 以上的整數（0、負數、小數）：擋下', () => {
    const g = owing(500)
    for (const amount of [0, -10, 12.5]) expect(payTabBlock(g.k, g.state, { amount }), String(amount)).toBe('還的金額要是 1 以上的整數。')
  })

  it('還得比欠的多：「你只欠 C$500。」之類的一句；剛好還清可以', () => {
    const g = owing(500)
    expect(payTabBlock(g.k, g.state, { amount: 501 })).toMatch(/^你只欠 .*500。$/)
    expect(payTabBlock(g.k, g.state, { amount: 500 })).toBeNull()
  })

  it('現金不夠（帳戶有錢也不算）：寫出要多少、有多少；不寫金額是全部，現金不夠一樣擋（不會只還現金有的那麼多）', () => {
    const g = owing(5000)
    expect(g.state.money.cred).toBeGreaterThan(5000)
    expect(payTabBlock(g.k, g.state)).toMatch(/^現金不夠：要還 .*5,000，你只有 .*2,000。$/)
    expect(payTabBlock(g.k, g.state, { amount: 2000 })).toBeNull()
  })

  it('還一部分：現金少那麼多、欠款少那麼多、句子寫還欠多少；再還剩下的就清掉（tab 不見、畫面的 tab 是 null）', () => {
    const g = owing(500)
    const [r] = g.commit(payTabDraft(g.k, g.state, { amount: 200 }))
    expect(r!.outcome.summary).toMatch(/還欠/)
    expect(g.state.money.cash).toBe(1800)
    expect(curtainOf(g.state).tab!.owed).toBe(300)
    const [r2] = g.commit(payTabDraft(g.k, g.state))
    expect(r2!.outcome.summary).toMatch(/還清了/)
    expect(curtainOf(g.state).tab).toBeUndefined()
    expect(accountView(g.k, g.state).tab).toBeNull()
  })
})

describe('買回母帶（LEWD_SYSTEM 第 8 節：保證金的兩倍）', () => {
  it('沒有這一支、已經買回、現金不夠：各一句', () => {
    const g = owing(1, { tapes: [{ id: 't1', leaked: false, price: 600, bought: true }, { id: 't2', leaked: false, price: 5000 }] })
    expect(buybackBlock(g.k, g.state, { tape: 'nope' })).toBe('沒有編號「nope」的母帶。')
    expect(curtainOf(g.state).tapes.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(buybackBlock(g.k, g.state, { tape: 't1' })).toBe('這一支母帶已經買回來了。')
    expect(buybackBlock(g.k, g.state, { tape: 't2' })).toMatch(/^現金不夠：買回要 .*5,000，你只有 .*2,000。$/)
  })
})
