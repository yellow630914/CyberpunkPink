// B037（邊界，cpp-tester-boundary）：新的帳單項目金額大到接近安全整數的上限：關著時照收、之後的欠款累加溢位；AI 的那條路預算先溢位、整筆拿掉。
// 規格：EVENTS 2.4 節「格式的底線，夾值關著也照擋：數值要是正常範圍的整數（不能大到溢位……）」；dev/invariants.md 第 36 條（套用之後的值也是安全整數）；
// bills 自己的規則（features/bills/index.ts 的 budget 註解、dev/adr/0017 第 17 項）：一期都付不起的縮成上限、只收一期。
// 重現：tests/pending/fixtures/B037-bill-extra-overflow.json。dev/bugs/B037-bill-extra-overflow.md。

import { describe, expect, it } from 'vitest'
import { clone } from '../../src'
import { makeCityGame, passUntil } from '../../src/testkit'
import { ctxOf, fixture } from './_b03x'

interface Fx { inputs: Array<{ type: string; route?: 'off'; effects?: unknown[]; to?: { day: number; hour: number } }>; ai_case: { effects: unknown[] } }
const fx = fixture<Fx>('B037-bill-extra-overflow')

const numbers = (v: unknown): number[] => (typeof v === 'number' ? [v] : Array.isArray(v) ? v.flatMap(numbers) : v && typeof v === 'object' ? Object.values(v).flatMap(numbers) : [])

describe('B037：帳單的數字不溢位', () => {
  it('關、asked 對得上：安全整數最大值的保護費三週，兩個週一之後帳單裡每一個數字都是安全整數（或一開始就不收）', () => {
    const { game: g } = makeCityGame()
    for (const step of fx.inputs) {
      if (step.type === 'resolve+commit') {
        const r = g.k.effects.resolve(step.effects!, ctxOf(g, step.route!, fx.player_input))
        if (r.errors.length) return // 格式的底線擋下也算對
        g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
      } else passUntil(g, step.to!)
    }
    const bad = numbers(g.state.ext.bills).filter((n) => !Number.isSafeInteger(n))
    expect(bad).toEqual([])
    expect(Number.isSafeInteger(g.state.money.cred) && Number.isSafeInteger(g.state.money.cash)).toBe(true)
  })

  it('AI：同一個金額、520 週 → 縮成上限 120、只收一期（不是整筆拿掉）', () => {
    const { game: g } = makeCityGame()
    const r = g.k.effects.resolve(fx.ai_case.effects, ctxOf(g, 'ai'))
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([expect.objectContaining({ op: 'bills.extra', amount: 120, weeks: 1 })])
    for (const c of r.clamps) expect(Number.isSafeInteger(c.from as number), String(c.from)).toBe(true)
  })
})
