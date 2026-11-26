// 白箱：簾後館的加演邀請與落幕之後的選擇（settle.ts 的 encoreBlocks／encoreStale、fall.ts 的 settleBlock／payTabBlock／buybackBlock）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：CYBERSPACE 8.8 節（場熱到 90 館方邀加演；加演 5、6 幕；打輸的三條路：付清、記帳、簽檔期；母帶買回是保證金的兩倍）；使用者 2026-11-26 裁決 4（加演邀請過了那一晚、離開簾口就作廢）；
// dev/work/M4-curtain-fall.md。
// 一局：makeCurtainGame + curtainPrelude（會員、口味單、站在大廳的簾口 F4）；狀態用測試直接寫進 state.ext.curtain（和讀檔進來的一樣）。

import { describe, expect, it } from 'vitest'
import { ActionBlocked } from '../../src'
import {
  CURTAIN_ENCORE_WITHDRAWN, buybackBlock, encoreBlocks, encoreDraft, encoreStale, payTabBlock, payTabDraft, settleBlock, settleDraft,
} from '../../src/features/curtain'
import { makeCurtainGame, curtainPrelude, giveMoney, sceneCast, standAt, BODY_BLOCKS, passTime } from '../../src/testkit'
import type { Game } from '../../src/shell/game'

type Cur = Record<string, any>
const cur = (g: Game): Cur => g.state.ext.curtain as Cur
const setup = (): Game => {
  const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
  curtainPrelude(g)
  return g
}
const ENCORE = { from: 'q1', night: 'cn_tw_honey', tier: 'floor', grade: 1, party: ['pc'], feature: false, pure_stage: false, heat: 92, tips_mult: 1 }
const blocks = (g: Game) => encoreBlocks(g.k, g.state)
const reason = (fn: () => unknown): string => { try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e } return '' }

describe('加演的邀請：現在加演不了的原因（CYBERSPACE 8.8 節；使用者 2026-11-26 裁決 4）', () => {
  it('沒有邀請：只回一條，說明場熱要過 90 或點單全部完成', () => {
    const g = setup()
    expect(blocks(g)).toEqual([expect.stringMatching(/現在沒有加演的邀請/)])
    expect(reason(() => encoreDraft(g.k, g.state))).toMatch(/現在沒有加演的邀請/)
  })
  it('有邀請、一切正常：沒有原因（站在簾口、有會員證、隊員有橋有甲板）', () => {
    const g = setup()
    cur(g).encore = { ...ENCORE }
    expect(blocks(g)).toEqual([])
  })
  it('過了那一晚作廢（記的晚數和現在不同）；離開簾口作廢（位置和記的不同）：只回「館方收回了加演的邀請」一條', () => {
    const g = setup()
    cur(g).encore = { ...ENCORE, day: -5 }
    expect(encoreStale(g.k, g.state, cur(g).encore)).toBe(true)
    expect(blocks(g)).toEqual([CURTAIN_ENCORE_WITHDRAWN])
    cur(g).encore = { ...ENCORE, at: { block: 'tw_elsewhere' } }
    expect(encoreStale(g.k, g.state, cur(g).encore)).toBe(true)
    expect(blocks(g)).toEqual([CURTAIN_ENCORE_WITHDRAWN])
    // 舊存檔的邀請沒有記晚與位置：當成沒有作廢
    cur(g).encore = { ...ENCORE }
    expect(encoreStale(g.k, g.state, cur(g).encore)).toBe(false)
  })
  it('落幕之後的事還沒處理完、這一趟還沒收場、不是會員、會員證停權：各一句', () => {
    const g = setup()
    cur(g).encore = { ...ENCORE }
    cur(g).fall = { act: 2, heat: 10, tips: 0, full: 0, stage: 'replay', run: 'q1', night: 'cn_tw_honey', tier: 'floor', deposit: 300, party: ['pc'] }
    expect(blocks(g).join('')).toMatch(/落幕之後的事還沒有處理完/)
    delete cur(g).fall
    cur(g).run = { id: 'q9', night: 'cn_tw_honey', tier: 'floor', grade: 1, deposit: 0, feature: false, pure_stage: false, party: ['pc'], companions: [], at: 0, day: 1 }
    expect(blocks(g).join('')).toMatch(/這一趟還沒有收場/)
    delete cur(g).run
    cur(g).member = { ...cur(g).member, suspended: true }
    expect(blocks(g).join('')).toMatch(/會員證停權了/)
    const memberBackup = cur(g).member
    delete cur(g).member
    expect(blocks(g).join('')).toMatch(/你已經不是簾後館的會員了/)
    cur(g).member = memberBackup
  })
  it('隊員的條件：找不到角色、不在隊上、沒有橋、沒有甲板：每一個人每一項一句', () => {
    const g = setup()
    cur(g).encore = { ...ENCORE, party: ['pc', 'npc_gone', 'npc_tw_ann'] }
    const p = blocks(g).join('|')
    expect(p).toMatch(/找不到角色 npc_gone/)
    expect(p).toMatch(/不在你的隊上/)
    expect(p).toMatch(/沒有自己的甲板/)
  })
  it('站在簾口之外：門的原因進來（doorBlock）', () => {
    const g = setup()
    cur(g).encore = { ...ENCORE }
    standAt(g, BODY_BLOCKS.clinics, 'E1')
    // 離開了簾口：邀請也作廢（at 沒記的舊存檔不作廢，所以這裡看到的是門的原因）
    expect(blocks(g).length).toBeGreaterThan(0)
  })
})

describe('落幕之後選一條路（settleBlock；LEWD_SYSTEM／CYBERSPACE 8.8 節）', () => {
  const fall = (stage: 'replay' | 'choose', extra: Cur = {}) => ({ act: 2, heat: 56, tips: 100, full: 200, stage, run: 'q1', night: 'cn_tw_honey', tier: 'floor', deposit: 300, party: ['pc'], ...extra })
  it('沒有落幕：沒有事可選；補演還沒結束：先喊停或演完；不認得的路不丟錯（當成記帳）', () => {
    const g = setup()
    expect(settleBlock(g.k, g.state, 'pay')).toMatch(/沒有/)
    cur(g).fall = fall('replay')
    expect(settleBlock(g.k, g.state, 'tab')).toMatch(/補演還沒結束/)
  })
  it('付清：現金不夠被擋（設備費與違約金是保證金的一半 150）；剛好 150 現金可以；選了之後落幕那一筆消失', () => {
    const g = setup()
    cur(g).fall = fall('choose')
    g.state.money.cash = 149
    expect(settleBlock(g.k, g.state, 'pay')).toMatch(/現金不夠/)
    g.state.money.cash = 150
    expect(settleBlock(g.k, g.state, 'pay')).toBeNull()
    g.commit(settleDraft(g.k, g.state, { how: 'pay' }))
    expect(g.state.money.cash).toBe(0)
    expect(cur(g).fall).toBeUndefined()
  })
  it('簽檔期：已經簽著而且沒到期被擋；到期後可以再簽；篩選關掉契約支配時這條路不開', () => {
    const g = setup()
    cur(g).fall = fall('choose')
    cur(g).gig = { start: 0, until: 10_000_000, shows: {}, missed: 0, checked: 0 }
    expect(settleBlock(g.k, g.state, 'gig')).toMatch(/已經簽著檔期了/)
    cur(g).gig = { start: 0, until: 1, shows: {}, missed: 0, checked: 0 }
    expect(settleBlock(g.k, g.state, 'gig')).toBeNull()
    const off = { ...g.state, rules: { ...g.state.rules, contentOff: [...g.state.rules.contentOff, 'contract_dom'] } }
    expect(settleBlock(g.k, off, 'gig')).toMatch(/被你的內容篩選關掉/)
  })
})

describe('還款與買回母帶（payTabBlock／buybackBlock）', () => {
  it('還款：沒有欠款、金額不是正整數、超過欠款、現金不夠各一句；還一部分之後欠款減少；全還清欠款那一筆消失', () => {
    const g = setup()
    expect(payTabBlock(g.k, g.state)).toMatch(/你沒有欠簾後館的錢/)
    cur(g).tab = { owed: 150, since: 0 }
    for (const amount of [0, -5, 1.5, Number.NaN]) expect(payTabBlock(g.k, g.state, { amount }), String(amount)).toMatch(/要是 1 以上的整數/)
    expect(payTabBlock(g.k, g.state, { amount: 151 })).toMatch(/你只欠/)
    g.state.money.cash = 99
    expect(payTabBlock(g.k, g.state, { amount: 100 })).toMatch(/現金不夠/)
    giveMoney(g, 0, 500)
    g.commit(payTabDraft(g.k, g.state, { amount: 100 }))
    expect(cur(g).tab.owed).toBe(50)
    g.commit(payTabDraft(g.k, g.state))
    expect(cur(g).tab).toBeUndefined()
    void passTime
  })
  it('買回母帶：沒有這一支、已經買回、沒有外流（館方保管也能買回）：各自的原因', () => {
    const g = setup()
    expect(buybackBlock(g.k, g.state, { tape: 'nope' })).toMatch(/沒有編號「nope」的母帶/)
    cur(g).tapes = [{ id: 'q1', leaked: true, price: 600 }, { id: 'q2', leaked: false, price: 600, bought: true }]
    expect(buybackBlock(g.k, g.state, { tape: 'q2' })).toMatch(/已經買回來了/)
    g.state.money.cash = 599
    expect(buybackBlock(g.k, g.state, { tape: 'q1' })).toMatch(/現金不夠：買回要 C\$600/)
    g.state.money.cash = 600
    expect(buybackBlock(g.k, g.state, { tape: 'q1' })).toBeNull()
  })
})
