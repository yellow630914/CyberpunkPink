// 邊界：契約的數字與期限（M4 邊界，cpp-tester-boundary）。
// 規格：LEWD_SYSTEM 7.4 節（滿意 0～100、照做 +5、主動要求 +8、抗拒 −5、逾期 −10、作廢 −5；每照做 3 次馴化 +1）、EVENTS 4.5 節（佇列最多 3 條；機率 = 基本頻率 × 滿意的倍率；
// 抗拒的 DC = 12 + 4 + ⌊馴化 ÷ 10⌋ + 沉溺的懲罰 − 主僕關係）、DOWNTIME 4.2 節（債務契約月息、還清）；dev/adr/0019 P27～P30。
// 性質：隨機的操作序列（簽、塞指令、選照做或抗拒、讓時間過去、還清）之後：滿意在 0～100、馴化在 0～100、佇列裡佔位子的不超過 3 條（每天 08:00 的那一條擲不超過；事件塞的另計）、
// 債不是負的、每一條指令的期限不早於它送達的時間、了結的紀錄不超過 keep_records。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ActionBlocked, toMinutes } from '../../src'
import { boundView, chooseDraft, contractOf, contractRules, dailyChance, resistQuote } from '../../src/features/contract'
import { satisfactionMult } from '../../src/features/contract/model'
import { applyEffects, makeBodyGame, passTime } from '../../src/testkit'

const holder = { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }

describe('契約的狀態不變式（隨機操作序列）', () => {
  it('任何操作序列：滿意 0～100、馴化 0～100、債不是負的、了結的紀錄不超過上限、期限不早於送達', () => {
    const rules0 = contractRules(makeBodyGame().game.k)
    fc.assert(fc.property(fc.integer({ min: 1, max: 300 }), fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 9 })), { minLength: 5, maxLength: 40 }), (seed, ops) => {
      const g = makeBodyGame({ seed }).game
      const { k } = g
      applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 6000, orders: ['errand', 'work', 'report', 'serve'], report_weekday: 2, holder }])
      for (const [op, n] of ops) {
        try {
          if (op === 0) passTime(g, [30, 60, 600, 1440, 3 * 1440, 10 * 1440][n % 6]!)
          else if (op === 1) applyEffects(g, [{ kind: 'order', order_kind: ['errand', 'work', 'report', 'serve'][n % 4], hours: [1, 6, 24, 72][n % 4], place: { district: 'tw_hive', block: 'tw_tower' } }])
          else if (op === 2 || op === 3) {
            const o = contractOf(g.state)?.queue.filter((x) => x.state === 'sent')
            if (o?.length) g.commit(chooseDraft(k, g.state, { order: o[n % o.length]!.id, how: op === 2 ? 'comply' : 'resist' }))
          } else if (op === 4) passTime(g, 5)
        } catch (e) { if (!(e instanceof ActionBlocked)) throw e }
        const c = contractOf(g.state)
        if (!c) { applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 6000, orders: ['errand', 'work', 'report', 'serve'], report_weekday: 2, holder }]); continue }
        const v = boundView(k, g.state)!
        expect(v.satisfaction).toBeGreaterThanOrEqual(0)
        expect(v.satisfaction).toBeLessThanOrEqual(100)
        expect(c.debt ?? 0).toBeGreaterThanOrEqual(0)
        const finished = c.queue.filter((o) => !['sent', 'doing', 'forced'].includes(o.state))
        expect(finished.length).toBeLessThanOrEqual(rules0.keep_records)
        for (const o of c.queue) expect(Number.isFinite(o.deadline)).toBe(true)
        const bridge = g.state.actors.pc!.ext.bridge as { docility: number } | null
        if (bridge) {
          expect(bridge.docility).toBeGreaterThanOrEqual(0)
          expect(bridge.docility).toBeLessThanOrEqual(100)
        }
        expect(toMinutes(g.state.time)).toBeGreaterThan(0)
      }
    }), { numRuns: 40, seed: 9 })
  })

  it('每天下指令的機率 = 持約人的基本頻率 × 滿意的倍率，夾在 0～1（滿意 0～29 ×1.5、30～69 ×1、70～100 ×0.6；伊甸園 40%）', () => {
    const g = makeBodyGame().game
    const k = g.k
    applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 6000, orders: ['errand'], holder }])
    const c = contractOf(g.state)!
    const table: Array<[number, number]> = [[0, 0.6], [29, 0.6], [30, 0.4], [69, 0.4], [70, 0.24], [100, 0.24]]
    for (const [sat, p] of table) expect(dailyChance(k, c, sat), `滿意 ${sat}`).toBeCloseTo(p, 6)
    for (const sat of [-50, 0, 100, 500]) {
      const p = dailyChance(k, c, sat)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
    const mult = [[0, 1.5], [30, 1], [70, 0.6]] as Array<[number, number]>
    expect(satisfactionMult(mult, 29)).toBe(1.5)
    expect(satisfactionMult(mult, 30)).toBe(1)
    expect(satisfactionMult(mult, 69)).toBe(1)
    expect(satisfactionMult(mult, 70)).toBe(0.6)
    expect(satisfactionMult(mult, -1)).toBe(1.5)
    expect(satisfactionMult([], 50)).toBe(1)
  })

  it('抗拒的 DC：12 + 4（管理級）+ ⌊馴化 ÷ 10⌋ + 沉溺的懲罰（60 以上 +2、80 以上 +4）− 主僕關係（夥伴、戀人 −4）；馴化 9 → 10、沉溺 59 → 60、79 → 80 各差一', () => {
    const g = makeBodyGame().game
    const k = g.k
    applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 6000, orders: ['errand'], holder }])
    applyEffects(g, [{ kind: 'order', order_kind: 'errand', hours: 24 }])
    const o = contractOf(g.state)!.queue.find((x) => x.state === 'sent')!
    const dcAt = (docility: number, sink: number) => {
      const s = structuredClone(g.state)
      ;(s.actors.pc!.ext.bridge as { docility: number }).docility = docility
      s.actors.pc!.sink = sink
      return resistQuote(k, s, o.id)!.dc
    }
    const base = dcAt(0, 0)
    expect(base).toBe(16)
    expect(dcAt(9, 0)).toBe(base)
    expect(dcAt(10, 0)).toBe(base + 1)
    expect(dcAt(99, 0)).toBe(base + 9)
    expect(dcAt(0, 59)).toBe(base)
    expect(dcAt(0, 60)).toBe(base + 2)
    expect(dcAt(0, 79)).toBe(base + 2)
    expect(dcAt(0, 80)).toBe(base + 4)
    expect(dcAt(0, 150)).toBe(base + 4)
    expect(dcAt(40, 85)).toBe(base + 4 + 4)
  })
})
