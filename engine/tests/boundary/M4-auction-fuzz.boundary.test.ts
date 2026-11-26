// 邊界：拍賣的整場性質測試（M4 邊界，cpp-tester-boundary）。
// 規格：LEWD_SYSTEM 6.2 節：底價是市價的 50%；加價的一階是底價的 10%（最少 C$50）；加價 1～3 階、跟、退出；一件最多 8 回合；
// 玩家是最高的人時只能等；成交價加 10% 佣金；結束時時間推到時段結束，而且從進場算起至少過一小時；錢不會是負的（invariants 第 7 條）。
// 做法：種子與亂數選動作（只選 bidOptions 說可以做的），一路走到整場結束，每一步檢查現價、回合、錢；整場的帳要對得上。

import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { toMinutes } from '../../src'
import { auctionRules, auctionRunOf, auctionSummary, bidDraft, bidOptions, enterDraft, leaveDraft } from '../../src/features/auction'
import type { Change, ReportDraft } from '../../src'
import { AUCTION_HOUSE, BODY_BLOCKS, giveMoney, makeBodyGame, passUntil } from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const round10 = (n: number): number => Math.round(n / 10) * 10
const sys = (changes: Change[]): ReportDraft => ({ kind: 'system', action: 'test.give', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })

function play(seed: number, picks: number[], pay: 'cash' | 'cred') {
  const g = makeBodyGame({ seed, at: { block: BODY_BLOCKS.hall, marker: 'F1' } }).game
  g.commit(sys([{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 } as unknown as Change]))
  passUntil(g, { day: 4, hour: 19, minute: 10 })
  giveMoney(g, 50_000, 50_000)
  const k = g.k
  const rules = auctionRules(k)
  const before = { ...g.state.money }
  const entered = toMinutes(g.state.time)
  g.commit(enterDraft(k, g.state, { house: AUCTION_HOUSE, pay }))
  const seen: string[] = []
  const reports: Array<ReturnType<typeof g.commit>[number]> = []
  let i = 0
  for (let steps = 0; steps < 400 && auctionRunOf(g.state); steps++) {
    const run = auctionRunOf(g.state)!
    const lot = run.lots[run.at]!
    // 每一步的不變式
    for (const l of run.lots) {
      expect(l.price, `${l.name} 現價不低於底價`).toBeGreaterThanOrEqual(l.reserve)
      expect((l.price - l.reserve) % l.step, `${l.name} 現價是底價加整數階`).toBe(0)
      expect(l.round, `${l.name} 回合數`).toBeLessThanOrEqual(rules.rounds_max)
      // 底價與一階都進位到 10（規格沒寫取整；實作取到十位）
      expect(l.reserve).toBe(round10(l.market * rules.reserve_pct))
      expect(l.step).toBe(round10(Math.max(l.reserve * rules.step_pct, rules.step_min)))
    }
    expect(g.state.money.cash).toBeGreaterThanOrEqual(0)
    expect(g.state.money.cred).toBeGreaterThanOrEqual(0)
    const o = bidOptions(k, g.state)!
    const legal: Array<Parameters<typeof bidDraft>[2]> = []
    for (const r of o.raise) if (r.can) legal.push({ act: 'raise', steps: r.steps! })
    if (o.wait.can) legal.push({ act: 'wait' })
    if (o.fold.can) legal.push({ act: 'fold' })
    if (o.auto.can) legal.push({ act: 'auto', max: o.auto.min + (picks[i % picks.length]! % 5) * lot.step })
    expect(legal.length, '沒有任何合法的動作，場卡住了').toBeGreaterThan(0)
    const choice = legal[picks[i++ % picks.length]! % legal.length]!
    seen.push(`${run.at}:${(choice as { act: string }).act}`)
    // 玩家是最高的人時不能對自己加價
    if (lot.holder === 'pc') expect(o.raise.some((r) => r.can), '最高的人還能加價').toBe(false)
    reports.push(...g.commit(bidDraft(k, g.state, choice)))
  }
  if (auctionRunOf(g.state)) reports.push(...g.commit(leaveDraft(k, g.state)))
  return { g, before, entered, rules, reports }
}

describe('拍賣整場性質（LEWD_SYSTEM 6.2 節）', () => {
  it('任何種子與任何選擇：每一步現價、回合、錢都在規格裡；整場的帳對得上（付的 = 成交價 + 10% 佣金）；結束的時間在時段結束而且至少過一小時', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 60 }), fc.constantFrom('cash' as const, 'cred' as const), (seed, picks, pay) => {
      const { g, before, entered, rules, reports } = play(seed, picks, pay)
      expect(auctionRunOf(g.state)).toBeNull()
      const other = pay === 'cash' ? 'cred' : 'cash'
      expect(g.state.money[other], '另一種錢不動').toBe(before[other])
      const spent = before[pay] - g.state.money[pay]
      expect(spent).toBeGreaterThanOrEqual(0)
      // 整場的帳：成交價加 10% 佣金，付的就是帳上寫的
      const recap = reports.map((r) => auctionSummary(r)).find((x) => x !== null)!
      expect(recap, '整場結束要有一份總結').toBeTruthy()
      let sum = 0
      for (const w of recap.won) {
        expect(w.fee).toBe(Math.round(w.price * rules.fee_pct))
        sum += w.price + w.fee
      }
      expect(recap.spent).toBe(sum)
      expect(spent, '錢少掉的 = 帳上寫的（這個世界沒有別的進出）').toBe(sum)
      // 結束時間：時段結束（23:00）或進場後至少一小時，取晚的
      const now = toMinutes(g.state.time)
      expect(now).toBeGreaterThanOrEqual(toMinutes({ day: 4, hour: 23, minute: 0 }))
      expect(now - entered).toBeGreaterThanOrEqual(rules.min_minutes)
    }), { numRuns: 40, seed: 11 })
  })
})
