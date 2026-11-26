// 冒煙 M4・白名單的掃描（dev/work/M4-smoke.md 第 7 點）：成人場景、簾後館的一趟、擂台的一場、一場拍賣進行中，
// 逐一試每一種報告的前綴（M4_ACTION_PREFIXES 的每一個，用 `commit:<前綴>.probe` 問 Game.blockOf），放行的只有該放行的。
// 沒有活動的時候全部放行（對照組，確認掃的方法本身有效）。

import { describe, expect, it, vi } from 'vitest'
import { enterDraft as arenaEnter } from '../../src/features/arena'
import { enterDraft as auctionEnter } from '../../src/features/auction'
import type { Game } from '../../src/shell/game'
import {
  AUCTION_HOUSE, BODY_BLOCKS, CURTAIN_NIGHTS, M4_ACTION_PREFIXES, curtainEnter, curtainPrelude, fightOut, giveMoney, makeBodyGame, makeCurtainGame, observed, openScene, passUntil, sceneCast,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 60_000 })

/** 現在放行的前綴（每個前綴問一個沒有人用的動詞：不被任何功能自己的放行規則特別對待）。 */
const allowed = (g: Game): string[] => M4_ACTION_PREFIXES.filter((p) => g.blockOf(`commit:${p}.probe`) === null).sort()

describe('冒煙 M4：白名單的掃描', () => {
  it('對照組：沒有活動的時候每一個前綴都放行', () => {
    const g = makeBodyGame({ actors: sceneCast('ann') }).game
    expect(allowed(g)).toEqual([...M4_ACTION_PREFIXES].sort())
  })

  it('成人場景進行中：只放行 scene', () => {
    const g = makeBodyGame({ actors: sceneCast('ann') }).game
    openScene(g, { with: ['npc_tw_ann'], nature: 'mutual', goal: 'please', mode: 'full' })
    expect(allowed(g)).toEqual(['scene'])
    // 場景裡主角的行動與結算以外，商店、睡覺、手術一律擋下並寫出原因
    for (const a of ['trade.checkout', 'rest.sleep', 'cyber.install', 'curtain.enter', 'auction.bid']) expect(g.blockOf(`commit:${a}`), a).toMatch(/成人場景/)
  })

  it('簾後館的一趟進行中：放行的是一趟裡面要用的（戰鬥、簾後館、戰敗的選擇、事件、格子、網內的行程、場景；迷宮館的前綴是 netrun 的放行清單一起放行的），其餘擋下', async () => {
    const g = makeCurtainGame({ seed: 3, actors: sceneCast('ann') }).game
    const { violations } = await observed(g, async () => {
      curtainPrelude(g)
      curtainEnter(g, CURTAIN_NIGHTS.a)
    })
    expect(violations).toEqual([])
    expect(allowed(g)).toEqual(['battle', 'curtain', 'defeat', 'event', 'grid', 'maze', 'netrun', 'scene'])
    for (const a of ['trade.checkout', 'rest.sleep', 'cyber.install', 'drug.use', 'auction.enter', 'unreg.order']) expect(g.blockOf(`commit:${a}`), a).toBeTruthy()
    // 契約指令的回話在任何活動裡都能做（使用者 2026-11-26 裁決 2）；走到了、做完是要走動的事，仍然擋下
    expect(g.blockOf('commit:contract.choose')).toBeNull()
    for (const a of ['contract.arrive', 'contract.done']) expect(g.blockOf(`commit:${a}`), a).toBeTruthy()
  })

  it('擂台的一場：報名（押 0）→ 戰鬥進行中只放行 battle；打贏結算之後恢復放行', async () => {
    const g = makeBodyGame({ noGear: false, pc: { attrs: { body: 20, reflex: 20 } } as never, at: { block: BODY_BLOCKS.hall, marker: 'F2' } }).game
    giveMoney(g, 0, 2000)
    const reports = g.commit(arenaEnter(g.k, g.state, { foe: 'en_tw_mook', stake: 0 }))
    expect(reports.map((r) => r.action)).toContain('arena.enter')
    expect(g.battle).not.toBeNull()
    expect(allowed(g)).toEqual(['battle'])
    const done = await fightOut(g)
    expect(done).not.toBeNull()
    expect(allowed(g)).toEqual([...M4_ACTION_PREFIXES].sort())
  })

  it('一場拍賣進行中：只放行 auction.bid、auction.leave、auction.close（預展 auction.inspect、換推薦函 auction.ref、再進場 auction.enter 要擋），其餘擋下', () => {
    const g = makeBodyGame({ at: { block: BODY_BLOCKS.hall, marker: 'F1' } }).game
    g.commit({ kind: 'system', action: 'test.favor', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'favor', key: 'f_tw_gallery', set: 40 }] as never, outcome: { result: 'ok', summary: '測試給的好感。' } })
    passUntil(g, { day: 11, hour: 19, minute: 10 })
    giveMoney(g, 0, 3000)
    g.commit(auctionEnter(g.k, g.state, { house: AUCTION_HOUSE, pay: 'cash' }))
    // 前綴整個掃：auction. 沒有任何一個前綴是整個放行的（逐一指名放行三個動作）
    expect(allowed(g)).toEqual([])
    for (const a of ['auction.bid', 'auction.leave', 'auction.close']) expect(g.blockOf(`commit:${a}`), a).toBeNull()
    for (const a of ['auction.inspect', 'auction.ref', 'auction.enter']) expect(g.blockOf(`commit:${a}`), a).toBeTruthy()
    for (const a of ['trade.checkout', 'rest.sleep', 'cyber.install', 'curtain.enter']) expect(g.blockOf(`commit:${a}`), a).toBeTruthy()
    // 契約的回話在任何活動裡都能做
    expect(g.blockOf('commit:contract.choose')).toBeNull()
  })
})
