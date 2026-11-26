// 冒煙 M4・第四波：簾後館（dev/work/M4-smoke.md 第 3 點、dev/work/M4-plan.md「第四波」那一圈）。固定種子、AI 關閉。
//   一趟走完  邀請函 → 面談 → 口味單 → 潛入、走到簾口 → 報名 → 走完四幕（遭遇、點單、賞箱、閘門）→ 結算
//   落幕      報名 → 走到第二幕（第三層）→ 開戰、全隊投降 → 接受結果（落幕、保證金不退）→ 補演（場景）→ 選記帳 → 一週後帳上有利息
// 內容一律是 testkit 的 bodyWorld()；功能是全部；走的是真正的功能與真正的提交；內海戰鬥的玩家是 playNetSmart（curtainPlay.ts）。
//
// 簾口：大廳的 F4（街上的簾口，不經過潛入），或暗礁裡的簾口（潛入之後選 ns_tw_curtain，人站在潛入裡的網內街區；M4 收尾修正批修好 B030、B031 之後，
// 一趟走完與落幕兩條主幹都有走潛入的版本：`dive: true`）。

import { describe, expect, it, vi } from 'vitest'
import type { Report } from '../../src'
import { acceptDefeat, defeatOf } from '../../src/features/defeat'
import { callOffDraft, curtainOf, curtainView, fallView, replayDraft, settleDraft } from '../../src/features/curtain'
import { exit as diveExit } from '../../src/features/dive'
import { netrunView, readRun } from '../../src/features/netrun'
import { sceneRawOf } from '../../src/features/scene'
import type { Game } from '../../src/shell/game'
import {
  CURTAIN_NIGHTS, M4_ACTION_PREFIXES, curtainEnter, curtainPrelude, flow, makeCurtainGame, netMarkers, netUse, observed, passTime, playCurtainRun, prefixProblems, roundTrip, sceneCast, standBeside, stateHash, stopScene,
} from '../../src/testkit'

vi.setConfig({ testTimeout: 120_000 })

const actions = (rs: Report[]): string[] => rs.map((r) => r.action ?? '')

/** 一局簾後館（演出者要有橋：補演的對象由 director.cast 臨時生成，不用先放進狀態）。 */
const setup = (seed = 3): Game => makeCurtainGame({ seed, actors: sceneCast('ann') }).game

async function runFlow(g: Game, f = flow('簾後館：一趟走完'), checkpoint: (label: string) => void = () => undefined, dive = false): Promise<Game> {
  const { k } = g
  await f.step(`前奏：邀請函、面談（領會員證，散座）、口味單、走到${dive ? '暗礁裡的簾口（潛入）' : '大廳的簾口'}`, () => {
    curtainPrelude(g, { dive })
    expect(curtainOf(g.state).member).toMatchObject({ tier: 'floor', clears: 0 })
    expect(curtainOf(g.state).taste).toEqual(['tg_tw_dom', 'tg_tw_sub', 'tg_tw_pamper'])
    if (dive) {
      expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('dive')
      expect(g.state.location).toMatchObject({ block: 'tw_curtain_door', facility: 'F1' })
    } else expect(g.state.location).toMatchObject({ block: 'tw_hall', facility: 'F4' })
  })
  const cash0 = g.state.money.cash
  await f.step('報名（舞台之夜、散座）：付保證金、開一趟網內的行程（四幕）', () => {
    const reports = curtainEnter(g, CURTAIN_NIGHTS.a)
    expect(actions(reports)).toEqual(['curtain.enter', 'netrun.enter', 'curtain.stage'])
    // 簾口在潛入裡時，一趟的外框是潛入（dive）與這一趟（netrun）同時進行
    expect(cash0 - g.state.money.cash).toBe(300)
    expect(readRun(g.state)).toMatchObject({ kind: 'netrun', layers: ['l1', 'l2', 'l3', 'l4'], layer: 0 })
    expect(netrunView(k, g.state)!.layer).toMatchObject({ total: 4 })
    expect(curtainView(k, g.state)).toMatchObject({ night: { id: CURTAIN_NIGHTS.a }, tier: 'floor', act: { number: 1, total: 4 } })
    checkpoint('after-enter')
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
    expect(prefixProblems(g, M4_ACTION_PREFIXES)).toEqual([])
    checkpoint('after-settle')
  })
  return g
}

async function fallFlow(g: Game, f = flow('簾後館：落幕、補演、記帳'), checkpoint: (label: string) => void = () => undefined, dive = false): Promise<Game> {
  const { k } = g
  await f.step('前奏與報名（蜜糖之夜）', () => {
    curtainPrelude(g, { dive })
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
    // 館方演的戰敗事件不強制斷線：潛入中的人還在潛入裡（補演與選路在簾口接著做）
    if (dive) expect(k.activity.active(g.state).map((x) => x.kind)).toEqual(['dive'])
    checkpoint('after-fall')
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
    // 潛入中（暗礁的簾口）：先登出，時間才走得動（潛入的放行清單不放休息與等待）
    if (dive) g.commit(diveExit(g.k, g.state))
    // 一週之後：帳單的掛點 bill.collect 出一行簾後館的帳
    passTime(g, 8 * 24 * 60)
    const lines = g.k.hooks.run('bill.collect', { state: g.state, week: 1 } as never).flatMap((r) => r.result as Array<{ id?: string }>)
    expect(JSON.stringify(lines)).toMatch(/curtain|簾後館/)
    expect(prefixProblems(g, M4_ACTION_PREFIXES)).toEqual([])
  })
  void callOffDraft
  return g
}

describe('冒煙 M4：簾後館（暗礁裡的簾口，潛入中走完）', () => {
  it('潛入、選簾口、報名 → 走完四幕 → 結算；結算之後人還在潛入裡的簾口，登出回到身體（B030、B031）', async () => {
    const g = setup(3)
    const { violations } = await observed(g, async () => {
      await runFlow(g, flow('簾後館（潛入）：一趟走完'), () => undefined, true)
      // 一趟收掉之後潛入還在、人還站在簾口：不用再潛一次，登出就回到現實
      expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['dive'])
      expect(g.state.location).toMatchObject({ block: 'tw_curtain_door', facility: 'F1' })
      expect(g.blockOf('commit:dive.exit')).toBeNull()
      g.commit(diveExit(g.k, g.state))
      expect(g.k.activity.active(g.state)).toEqual([])
    })
    expect(violations).toEqual([])
  })

  it('潛入裡第二幕全隊倒下 → 落幕 → 補演 → 記帳（潛入的外框不擋落幕；館方演的戰敗事件不強制斷線，人還在簾口）', async () => {
    const g = setup(3)
    const { violations } = await observed(g, async () => fallFlow(g, flow('簾後館落幕（潛入）'), () => undefined, true))
    expect(violations).toEqual([])
    // 記帳那一步之後人登出了（fallFlow 的最後）
    expect(g.k.activity.active(g.state)).toEqual([])
  })
})

describe('冒煙 M4：簾後館', () => {
  it('邀請函 → 面談 → 報名 → 走完四幕 → 結算；報名之後、結算之後各存讀一次，接著走，最後的狀態和不中斷的一遍逐欄相同', async () => {
    const g = setup(3)
    const { violations } = await observed(g, async () => runFlow(g))
    expect(violations).toEqual([])
    const saved = setup(3)
    const again = await observed(saved, async () => runFlow(saved, flow('簾後館（存讀）'), (label) => roundTrip(saved, label)))
    expect(again.violations).toEqual([])
    expect(stateHash(saved.state)).toBe(stateHash(g.state))
  })

  it('第二幕全隊倒下 → 落幕 → 補演 → 記帳；落幕之後存讀一次，補演、記帳照樣走完，最後的狀態和不中斷的一遍逐欄相同', async () => {
    const g = setup(3)
    const { violations } = await observed(g, async () => fallFlow(g))
    expect(violations).toEqual([])
    const saved = setup(3)
    const again = await observed(saved, async () => fallFlow(saved, flow('簾後館落幕（存讀）'), (label) => roundTrip(saved, label)))
    expect(again.violations).toEqual([])
    expect(stateHash(saved.state)).toBe(stateHash(g.state))
  })
})
