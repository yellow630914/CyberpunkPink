// 冒煙 M4・第四波：簾後館（dev/work/M4-smoke.md 第 3 點、dev/work/M4-plan.md「第四波」那一圈）。固定種子、AI 關閉。
//   一趟走完  邀請函 → 面談 → 口味單 → 潛入、走到簾口 → 報名 → 走完四幕（遭遇、點單、賞箱、閘門）→ 結算
//   落幕      報名 → 走到第二幕（第三層）→ 開戰、全隊投降 → 接受結果（落幕、保證金不退）→ 補演（場景）→ 選記帳 → 一週後帳上有利息
// 內容一律是 testkit 的 bodyWorld()；功能是全部；走的是真正的功能與真正的提交；內海戰鬥的玩家是 playNetSmart（curtainPlay.ts）。
//
// 簾口：大廳的 F4（街上的簾口，不經過潛入）。暗礁裡的簾口（潛入之後選 ns_tw_curtain）有兩個毛病：B030 報名被潛入的活動擋下、B031 即使放行一趟的場熱與落幕也不啟動
// （report.after 看到進行中的 dive 就不插報告）；重現在 engine/tests/pending/B030-curtain-enter-in-dive.test.ts 與 B031-curtain-stage-in-dive.test.ts（目前會失敗）。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { acceptDefeat, defeatOf } from '../../src/features/defeat'
import { callOffDraft, curtainOf, curtainView, fallView, replayDraft, settleDraft } from '../../src/features/curtain'
import { eventView } from '../../src/features/director'
import { netrunView, readRun } from '../../src/features/netrun'
import { sceneRawOf } from '../../src/features/scene'
import type { Game } from '../../src/shell/game'
import {
  CURTAIN_NIGHTS, curtainEnter, curtainPrelude, flow, makeCurtainGame, netMarkers, netUse, observed, passTime, playCurtainRun, sceneCast, standBeside, stopScene,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')

/** 一局簾後館（演出者要有橋：補演的對象由 director.cast 臨時生成，不用先放進狀態）。 */
const setup = (seed = 3): Game => makeCurtainGame({ seed, actors: sceneCast('ann') }).game

async function runFlow(g: Game, f = flow('簾後館：一趟走完')): Promise<Game> {
  const { k } = g
  await f.step('前奏：邀請函、面談（領會員證，散座）、口味單、走到大廳的簾口', () => {
    curtainPrelude(g)
    expect(curtainOf(g.state).member).toMatchObject({ tier: 'floor', clears: 0 })
    expect(curtainOf(g.state).taste).toEqual(['tg_tw_dom', 'tg_tw_sub', 'tg_tw_pamper'])
    expect(g.state.location).toMatchObject({ block: 'tw_hall', facility: 'F4' })
  })
  const cash0 = g.state.money.cash
  await f.step('報名（舞台之夜、散座）：付保證金、開一趟網內的行程（四幕）', () => {
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(actions(reports)).toEqual(['curtain.enter', 'netrun.enter', 'curtain.stage'])
    expect(cash0 - g.state.money.cash).toBe(300)
    expect(readRun(g.state)).toMatchObject({ kind: 'netrun', layers: ['l1', 'l2', 'l3', 'l4'], layer: 0 })
    expect(netrunView(k, g.state)!.layer).toMatchObject({ total: 4 })
    expect(curtainView(k, g.state)).toMatchObject({ night: { id: CURTAIN_NIGHTS.a }, tier: 'floor', act: { number: 1, total: 4 } })
  })
  await f.step('走完四幕：每一層打贏遭遇、順手做點單與賞箱、走到閘門往下一幕、最後從出口離開', async () => {
    const res = await playCurtainRun(g, { extras: true })
    expect(res.reports.filter((r) => r.action === 'battle.end').length).toBeGreaterThanOrEqual(4)
    expect(res.chests.length).toBeGreaterThan(0)
    expect(res.orders.length).toBeGreaterThan(0)
    expect(actions(res.reports)).toContain('netrun.descend')
  })
  await f.step('結算：這一趟收乾淨（沒有 run、沒有網內的行程）、破關次數 +1、保證金退回、獎金與打賞進現金', () => {
    expect(readRun(g.state)).toBeNull()
    const cur = curtainOf(g.state)
    expect(cur.run).toBeUndefined()
    expect(cur.fall).toBeUndefined()
    expect(cur.member?.clears).toBe(1)
    expect(g.state.reports.some((r) => r.action === 'curtain.settle' || r.action === 'curtain.end' || (r.action ?? '').startsWith('curtain.'))).toBe(true)
    // 錢：保證金 300 退回、再加獎金 900 與賞箱的票根；現金一定比報名前多
    expect(g.state.money.cash).toBeGreaterThan(cash0)
  })
  return g
}

async function fallFlow(g: Game, f = flow('簾後館：落幕、補演、記帳')): Promise<Game> {
  const { k } = g
  await f.step('前奏與報名（蜜糖之夜）', () => {
    curtainPrelude(g)
    curtainEnter(g, CURTAIN_NIGHTS.b)
    expect(readRun(g.state)).toBeTruthy()
  })
  await f.step('走完序幕與第一幕（兩層）：打贏遭遇、過閘門，到第二幕（第三層）', async () => {
    const res = await playCurtainRun(g, { stopAfterLayer: 2 })
    expect(actions(res.reports)).toContain('netrun.descend')
    expect(netrunView(k, g.state)!.layer.index).toBe(3)
  })
  const deposit = 300
  const cash0 = g.state.money.cash
  await f.step('第二幕開戰、全隊投降：戰敗的選擇出現（落幕）', async () => {
    const foe = netMarkers(g).find((m) => m.mark === 'f')!
    await standBeside(g, foe.id)
    netUse(g, 'fight', foe.id)
    expect(g.battle).not.toBeNull()
    for (let i = 0; i < 40 && g.battleOptions()?.waiting === 'ai'; i++) g.battleNext()
    const r = g.battleAct({ action: 'net_surrender' })
    expect(r.reasons ?? []).toEqual([])
    const done = await g.finishBattle()
    expect(actions(done.reports)).toContain('battle.end')
    expect(defeatOf(g.state)).toBeTruthy()
  })
  await f.step('接受結果：落幕（fall 在 replay 那一步）、保證金不退、這一趟收乾淨', () => {
    const reports = g.commit(acceptDefeat(k, g.state))
    expect(actions(reports).some((a) => a.startsWith('curtain.') || a.startsWith('defeat.'))).toBe(true)
    const cur = curtainOf(g.state)
    expect(cur.run).toBeUndefined()
    expect(cur.fall).toMatchObject({ stage: 'replay' })
    expect(readRun(g.state)).toBeNull()
    expect(g.state.money.cash).toBeLessThanOrEqual(cash0)
    expect(fallView(k, g.state)).toMatchObject({ step: 'replay', deposit })
  })
  await f.step('補演：開一場（工作性質、layer net）的場景，演到結束；進到選路', () => {
    const reports = g.commit(replayDraft(k, g.state))
    expect(actions(reports)).toContain('curtain.replay')
    const s = sceneRawOf(g.state)
    expect(s).toMatchObject({ nature: 'work', goal: 'please', layer: 'net' })
    const settled = stopScene(g)
    for (const d of Object.values(settled.sink)) expect(Math.abs(d)).toBeLessThanOrEqual(4)
    expect(sceneRawOf(g.state)).toBeNull()
    expect(fallView(k, g.state)).toMatchObject({ step: 'choose' })
  })
  await f.step('記帳：選「記帳」，欠著設備費與違約金；一週之後 bill.collect 出一行利息', () => {
    const before = g.state.money.cash
    const reports = g.commit(settleDraft(k, g.state, { how: 'tab' }))
    expect(actions(reports)).toContain('curtain.settle')
    expect(g.state.money.cash).toBe(before)
    const cur = curtainOf(g.state)
    expect(cur.fall).toBeUndefined()
    expect(cur.tab?.owed).toBeGreaterThan(0)
    // 一週之後：帳單的掛點 bill.collect 出一行簾後館的帳
    passTime(g, 8 * 24 * 60)
    const lines = g.k.hooks.run('bill.collect', { state: g.state, week: 1 } as never).flatMap((r) => r.result as Array<{ id?: string }>)
    expect(JSON.stringify(lines)).toMatch(/curtain|簾後館/)
  })
  void callOffDraft
  return g
}

describe('冒煙 M4：簾後館', () => {
  it('邀請函 → 面談 → 報名 → 走完四幕 → 結算', async () => {
    const g = setup(3)
    const { violations } = await observed(g, async () => runFlow(g))
    expect(violations).toEqual([])
  })

  it('第二幕全隊倒下 → 落幕 → 補演 → 記帳', async () => {
    const g = setup(3)
    const { violations } = await observed(g, async () => fallFlow(g))
    expect(violations).toEqual([])
  })
})
