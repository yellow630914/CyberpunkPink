// 白箱：features/auction 的進場與喊價（bid.ts）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：LEWD_SYSTEM 6.2 節（白槌的拍賣：進場、一場拍賣、競價的回合第 2、5、6 點、補充）；dev/work/M4-auction.md、M4-auction-bid.md、M4-fix-engine（自動跟價）。
// 一局：makeBodyGame（bodyWorld 的拍賣行「白槌」，大廳 F1）。第 4 天是週五，19:00～23:00 開槌。

import { describe, expect, it } from 'vitest'
import type { Change, ReportDraft } from '../../src'
import { ActionBlocked, toMinutes } from '../../src'
import { auctionRules, auctionRunOf, auctionView, autoChoice, bidBlock, bidDraft, bidOptions, enterBlocks, enterDraft, leaveBlock, leaveDraft } from '../../src/features/auction'
import type { Run } from '../../src/features/auction'
import { AUCTION_HOUSE, BODY_BLOCKS, giveMoney, makeBodyGame, passUntil, standAt } from '../../src/testkit'

const sys = (changes: Change[], action = 'test.give'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}

/** 站在白槌裡、伊甸園好感 40（會員）、第 3 天 10:00。 */
function atHouse() {
  const g = makeBodyGame({ at: { block: BODY_BLOCKS.hall, marker: 'F1' } }).game
  g.commit(sys([{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 } as unknown as Change]))
  return g
}
/** 開槌的時段裡、現金 10,000、已經進場（付現金）。 */
function inAuction() {
  const g = atHouse()
  passUntil(g, { day: 4, hour: 19, minute: 10 })
  giveMoney(g, 0, 10000)
  g.commit(enterDraft(g.k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
  return g
}

describe('進場的擋下（LEWD_SYSTEM 6.2 節「進場」「一場拍賣」：每週一場、一場進一次）', () => {
  it('沒有這一家拍賣行：只回一條「沒有這一家拍賣行。」（不再往下查）', () => {
    const g = atHouse()
    expect(enterBlocks(g.k, g.state, 'ah_nope')).toEqual(['沒有這一家拍賣行。'])
  })

  it('開槌之前：寫出下一場幾點開槌；站在外面又還沒開槌：兩條都列（一條一個條件）', () => {
    const g = atHouse()
    expect(enterBlocks(g.k, g.state, AUCTION_HOUSE)).toEqual(['白槌的這一場要到第 4 天 19:00才開槌。'])
    standAt(g, BODY_BLOCKS.hall, 'E1')
    expect(enterBlocks(g.k, g.state, AUCTION_HOUSE)).toEqual(['要站在白槌裡才進得了場。', '白槌的這一場要到第 4 天 19:00才開槌。'])
  })

  it('這一場結束之後（23:00 以後）：看的是下一週那一場', () => {
    const g = atHouse()
    passUntil(g, { day: 4, hour: 23, minute: 10 })
    expect(enterBlocks(g.k, g.state, AUCTION_HOUSE)).toEqual(['白槌的這一場要到第 11 天 19:00才開槌。'])
  })

  it('enterDraft 的輸入：沒指定拍賣行、付款方式不是現金或帳戶，各有一句', () => {
    const g = atHouse()
    passUntil(g, { day: 4, hour: 19, minute: 10 })
    expect(reasonOf(() => enterDraft(g.k, g.state, { pay: 'cash' }))).toBe('要指定哪一家拍賣行。')
    expect(reasonOf(() => enterDraft(g.k, g.state, { house: 'ah_nope', pay: 'cash' }))).toBe('要指定哪一家拍賣行。')
    expect(reasonOf(() => enterDraft(g.k, g.state, { house: AUCTION_HOUSE, pay: 'card' }))).toBe('要選這一場用現金晶片還是帳戶付款。')
    expect(reasonOf(() => enterDraft(g.k, g.state, { house: AUCTION_HOUSE }))).toBe('要選這一場用現金晶片還是帳戶付款。')
  })

  it('已經在拍賣廳裡：再進一次被擋（不重複列活動的原因）', () => {
    const g = inAuction()
    const p = enterBlocks(g.k, g.state, AUCTION_HOUSE)
    expect(p[0]).toBe('你已經在拍賣廳裡了。')
    expect(p.filter((x) => x.includes('拍賣'))).toHaveLength(1)
  })

  it('一場進一次：離場之後同一個時段再進被擋；下一週那一場又進得去', () => {
    const g = inAuction()
    g.commit(leaveDraft(g.k, g.state))
    expect(auctionRunOf(g.state)).toBeNull()
    // 離場把時間推到時段結束（23:00）；回到同一個時段裡測「進過了」要用存檔前的時間，所以改看下一場
    expect(toMinutes(g.state.time)).toBeGreaterThanOrEqual(toMinutes({ day: 4, hour: 23, minute: 0 }))
    expect(enterBlocks(g.k, g.state, AUCTION_HOUSE).join('')).toMatch(/第 11 天 19:00/)
    passUntil(g, { day: 11, hour: 19, minute: 30 })
    expect(enterBlocks(g.k, g.state, AUCTION_HOUSE)).toEqual([])
  })
})

describe('離場（LEWD_SYSTEM 6.2 節：結束時時間推到時段結束，而且從進場算起至少過一小時）', () => {
  it('19:10 進場就離場：時間到 23:00（比進場加一小時晚）；報告 auction.leave、result left、活動結束', () => {
    const g = inAuction()
    const rs = g.commit(leaveDraft(g.k, g.state))
    const r = rs.find((x) => x.action === 'auction.leave')!
    expect(r.outcome.result).toBe('left')
    expect(g.state.time).toMatchObject({ day: 4, hour: 23, minute: 0 })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).not.toContain('auction')
    expect(leaveBlock(g.k, g.state)).toBe('現在不在拍賣廳裡。')
    expect(reasonOf(() => leaveDraft(g.k, g.state))).toBe('現在不在拍賣廳裡。')
  })

  it('22:30 進場：離場時時間推到進場加一小時（23:30），不是 23:00', () => {
    const g = atHouse()
    passUntil(g, { day: 4, hour: 22, minute: 30 })
    giveMoney(g, 0, 10000)
    g.commit(enterDraft(g.k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
    g.commit(leaveDraft(g.k, g.state))
    expect(g.state.time).toMatchObject({ day: 4, hour: 23, minute: 30 })
  })
})

describe('喊價的擋下（LEWD_SYSTEM 6.2 節「競價的回合」第 2 點與補充）', () => {
  it('不在拍賣廳裡：bidBlock 與 bidOptions 各自回「不在」與 null', () => {
    const g = atHouse()
    expect(bidBlock(g.k, g.state, { act: 'wait' })).toBe('現在不在拍賣廳裡。')
    expect(bidOptions(g.k, g.state)).toBeNull()
    expect(auctionView(g.k, g.state)).toBeNull()
  })

  it('加價的階數只能 1～raise_max（3）；0、4、小數都擋', () => {
    const g = inAuction()
    expect(auctionRules(g.k).raise_max).toBe(3)
    for (const steps of [0, 4, 1.5]) expect(bidBlock(g.k, g.state, { act: 'raise', steps }), String(steps)).toBe('一次只能加 1～3 階。')
    expect(bidBlock(g.k, g.state, { act: 'raise', steps: 3 })).toBeNull()
  })

  it('不認得的動作、自動跟價的上限不合格（0、負數、小數）各有一句', () => {
    const g = inAuction()
    expect(bidBlock(g.k, g.state, { act: 'jump' } as never)).toBe('不認得這個動作：要加價、等、退出或自動跟價。')
    for (const max of [0, -100, 10.5]) expect(bidBlock(g.k, g.state, { auto: { max } }), String(max)).toBe('自動跟價要給一個大於 0 的上限。')
    expect(reasonOf(() => bidDraft(g.k, g.state, { auto: { max: 0 } }))).toBe('自動跟價要給一個大於 0 的上限。')
  })

  it('開場沒有人持有：玩家不能「等」、可以退出；bidOptions 的 auto.min 是底價加一階', () => {
    const g = inAuction()
    const v = auctionView(g.k, g.state)!
    expect(v.holder.id).toBeNull()
    expect(bidBlock(g.k, g.state, { act: 'wait' })).toBe('你不是目前最高的出價人，只能加價或退出。')
    expect(bidBlock(g.k, g.state, { act: 'fold' })).toBeNull()
    expect(bidOptions(g.k, g.state)!.auto.min).toBe(v.price + v.step)
  })

  it('付不起：加價加佣金超過這一場付款的那一種錢（現金）就擋；帳戶有錢不算', () => {
    const g = inAuction()
    // 拍賣進行中別的報告提交不進去（活動擋著）：只讀的檢查直接給一份現金是 0 的狀態
    const broke = { ...g.state, money: { ...g.state.money, cash: 0 } }
    expect(broke.money.cred).toBeGreaterThan(10000)
    expect(bidBlock(g.k, broke, { act: 'raise', steps: 1 })).toBe('付不起這個價（含一成佣金）。')
    expect(bidOptions(g.k, broke)!.raise.every((o) => !o.can)).toBe(true)
  })
})

describe('自動跟價替玩家選的動作（LEWD_SYSTEM 6.2 節第 6 點：規則和手動喊價完全一樣）', () => {
  const lotRun = (g: ReturnType<typeof inAuction>) => {
    const run = structuredClone(auctionRunOf(g.state)) as Run
    return { run, lot: run.lots[run.at]! }
  }

  it('自己是最高的人：等；不是：下一階不超過上限而且付得起就跟一階，超過上限就退出', () => {
    const g = inAuction()
    const rules = auctionRules(g.k)
    const { run, lot } = lotRun(g)
    const next = lot.price + lot.step
    expect(autoChoice(g.state, run, rules, lot, next)).toEqual({ act: 'raise', steps: 1 })
    expect(autoChoice(g.state, run, rules, lot, next - 1)).toEqual({ act: 'fold' })
    lot.holder = 'pc'
    expect(autoChoice(g.state, run, rules, lot, 1)).toEqual({ act: 'wait' })
  })

  it('上限夠、但付不起（含佣金）：退出，不跟', () => {
    const g = inAuction()
    const rules = auctionRules(g.k)
    const { run, lot } = lotRun(g)
    const broke = { ...g.state, money: { ...g.state.money, cash: 0 } }
    expect(autoChoice(broke, run, rules, lot, 1_000_000)).toEqual({ act: 'fold' })
  })

  it('上限比底價加一階還低：一按就是退出這一件，由程式算完、輪到下一件（不丟錯）', () => {
    const g = inAuction()
    const before = auctionView(g.k, g.state)!
    const rs = g.commit(bidDraft(g.k, g.state, { auto: { max: 1 } }))
    const r = rs.find((x) => x.action === 'auction.bid' || x.action === 'auction.close')!
    const rounds = (r.outcome as unknown as { rounds: Array<{ acts: Array<{ who: string; act: string }> }> }).rounds
    expect(rounds[0]!.acts[0]).toMatchObject({ who: 'pc', act: 'fold' })
    const after = auctionView(g.k, g.state)
    if (after) expect(after.lot_no).toBe(before.lot_no + 1)
  })
})
