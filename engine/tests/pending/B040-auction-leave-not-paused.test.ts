// B040（M4 探針，cpp-tester-whitebox）：拍賣離場那一份報告把時間推到時段結束，契約指令的期限沒有跟著暫停。
// 規格：EVENTS 4.5 節「期限暫停：主角處於任何獨佔的活動時（委託副本、潛入、簾後館一趟、網內行程、拍賣、成人場景）所有契約指令的期限暫停，活動結束才接著算」；LEWD_SYSTEM 7.4。
// 重現：engine/tests/pending/fixtures/B040-auction-leave-not-paused.json。dev/bugs/B040-auction-leave-not-paused.md。
// 成因推測：contract/time.ts 的 mineDrafts 用「time.passed 發生當下的狀態」判斷在不在活動裡（inActivity(state)）；
// 離場那一份報告同時結束活動與推進時間，掛點看到的已經是離場之後的狀態。

import { describe, expect, it } from 'vitest'
import type { Change } from '../../src'
import { toMinutes } from '../../src'
import { auctionRunOf, enterDraft, leaveDraft } from '../../src/features/auction'
import { chooseDraft, contractOf } from '../../src/features/contract'
import { AUCTION_HOUSE, BODY_BLOCKS, applyEffects, giveMoney, makeBodyGame, passUntil } from '../../src/testkit'
import { readFileSync } from 'node:fs'

const fx = JSON.parse(readFileSync(new URL('./fixtures/B040-auction-leave-not-paused.json', import.meta.url), 'utf8')) as { seed: number; order_hours: number; enter_at: { day: number; hour: number; minute: number } }

describe('B040：拍賣裡經過的時間，契約指令的期限要暫停', () => {
  it('照做中的差事（期限 72 小時）：進場 19:10、離場被推到 23:00（230 分鐘）；期限要往後挪 230 分鐘', () => {
    const g = makeBodyGame({ seed: fx.seed, at: { block: BODY_BLOCKS.hall, marker: 'F1' } }).game
    const { k } = g
    g.commit({ kind: 'system', action: 'test.give', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 } as unknown as Change], outcome: { result: 'ok', summary: '測試。' } })
    applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 24000, orders: ['errand'], report_weekday: 0, holder: { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }, rules: [] }])
    applyEffects(g, [{ kind: 'order', order_kind: 'errand', place: { district: 'tw_hive', block: 'tw_tower' }, hours: fx.order_hours }])
    const o = contractOf(g.state)!.queue.at(-1)!
    g.commit(chooseDraft(k, g.state, { order: o.id, how: 'comply' }))
    passUntil(g, fx.enter_at)
    giveMoney(g, 0, 10000)
    const deadline = () => contractOf(g.state)!.queue.find((x) => x.id === o.id)!.deadline
    g.commit(enterDraft(k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
    expect(auctionRunOf(g.state)).not.toBeNull()
    const d0 = deadline()
    const t0 = toMinutes(g.state.time)
    g.commit(leaveDraft(k, g.state))
    const spent = toMinutes(g.state.time) - t0
    expect(spent).toBeGreaterThan(200)
    expect(deadline() - d0).toBe(spent)
  })
})
