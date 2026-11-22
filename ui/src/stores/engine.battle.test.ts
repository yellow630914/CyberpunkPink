// 驗收測試：dev/work/M1-ui-combat.md（交給 cpp-ui）。
// 規格：COMBAT_SYSTEM 第 10 節（畫面）；docs/art/UI.md 第 17 節第 1 項（手機：敵上我下，兩排的第 1 格都在左邊；2026-11-22 定案）；
// docs/plan/PLAN.md 5.5 節第一項（制伏灰掉要寫出缺哪個條件）。規則都在引擎：畫面只讀 battleOptions 與 state.battle。
// 前置：dev/work/M1-data-rules.md 與 dev/work/M1-combat.md 已經做完（store 用 allFeatures() 與 CORE_PACK，裡面要有現實戰鬥的行動表）。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { END_TURN, MOVE } from '@engine/src'
import { useEngine } from './engine'
import { RING_KEYS, battleView, disabledReason, ringOf, slotLayout } from '../lib/battleView'

describe('M1-ui-combat：store 包住引擎的戰鬥', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const start = () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(BATTLE_SETUPS.encounter())
    return e
  }

  it('開打之後畫面讀得到戰鬥；每一步之後狀態跟著換（state 是整份複製，畫面不會改到引擎）', () => {
    const e = start()
    expect(e.battle).toMatchObject({ id: 'b1', round: 1 })
    expect(e.inBattle).toBe(true)
    const before = e.battle
    // 輪到 AI 就讓它走一步；輪到玩家就結束回合
    const o = e.battleOptions()!
    const r = o.waiting === 'ai' ? e.battleNext() : e.battleAct({ action: END_TURN })
    expect(r.status).toBe('applied')
    expect(e.battle).not.toBe(before)
    ;(e.battle as { round: number }).round = 99
    expect(e.battleOptions()!.round).toBe(1)
  })

  it('做不成的一步回傳 refused 與每一條原因，狀態不變；戰鬥分出結果之後結算，戰鬥從畫面上拿掉', async () => {
    const e = start()
    while (e.battleOptions()!.waiting === 'ai') e.battleNext()
    const bad = e.battleAct({ action: 'nope' })
    expect(bad).toMatchObject({ status: 'refused' })
    expect(bad.reasons!.length).toBeGreaterThan(0)
    for (let i = 0; i < 3000 && e.battleOptions()!.waiting !== 'over'; i++) e.battleNext({ anyone: true })
    expect(e.battleOptions()!.waiting).toBe('over')
    const end = await e.finishBattle()
    expect(end.status).toBe('applied')
    expect(e.inBattle).toBe(false)
    // 這場戰鬥收成一份 combat 報告（打輸的話它後面還接著一份戰敗的報告）
    expect(e.log.some((r) => r.kind === 'combat')).toBe(true)
  })

  it('重來這場戰鬥：回到開打之前', async () => {
    const e = start()
    for (let i = 0; i < 20; i++) e.battleNext({ anyone: true })
    expect(e.retryBattle()).toBeNull()
    expect(e.battle).toMatchObject({ round: 1 })
  })
})

describe('M1-ui-combat：畫面的模型（純函式，不寫規則）', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const view = () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(BATTLE_SETUPS.encounter())
    while (e.battleOptions()!.waiting === 'ai') e.battleNext()
    return { e, v: battleView(e.battle!, e.battleOptions()!, e.battleMode()!) }
  }

  it('八格：桌面是我方 4→1、敵方 1→4 排成一列；手機是敵上我下，兩排的第 1 格都在左邊', () => {
    expect(slotLayout('desktop').map((s) => `${s.side}${s.slot}`)).toEqual(['ally4', 'ally3', 'ally2', 'ally1', 'foe1', 'foe2', 'foe3', 'foe4'])
    expect(slotLayout('desktop').map((s) => [s.row, s.col])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8]])
    const mobile = slotLayout('mobile')
    expect(mobile.filter((s) => s.side === 'foe').map((s) => [s.row, s.col, s.slot])).toEqual([[1, 1, 1], [1, 2, 2], [1, 3, 3], [1, 4, 4]])
    expect(mobile.filter((s) => s.side === 'ally').map((s) => [s.row, s.col, s.slot])).toEqual([[2, 1, 1], [2, 2, 2], [2, 3, 3], [2, 4, 4]])
  })

  it('每一格：單位的兩條量條（生命、感載）、餘韻的層數、遮蔽的級數與耐久；先攻條敵我混排、標出輪到誰', () => {
    const { e, v } = view()
    const cell = v.cells.find((c) => c.side === 'ally' && c.slot === 2)!
    expect(cell).toMatchObject({ cover: { level: 1, name: '半掩體', hp: 15, max: 15 }, unit: { id: 'a2', name: '你', hp: { now: 46, max: 46 }, load: { now: 0, max: 38 }, layers: 0, layersMax: 3, weapon: '衝鋒槍' } })
    expect(v.order.map((o) => o.id)).toEqual(e.battle!.order)
    expect(v.order.filter((o) => o.now).map((o) => o.id)).toEqual([e.battleOptions()!.current])
    expect(v.round).toBe(1)
    // 選了行動者之後列出他到每個敵人的距離
    const cur = e.battle!.units[e.battleOptions()!.current!]!
    expect(v.distances).toEqual(['f1', 'f2', 'f3', 'f4'].map((id) => ({ id, name: e.battle!.units[id]!.name, distance: cur.slot + e.battle!.units[id]!.slot - 1 })))
  })

  it('行動圓環照引擎給的分圈：中心是技能，內環攻擊、中環補充與切換、外環戰術；結束回合、脫離、投降在圓環外面；數字鍵由內環往外', () => {
    const { e } = view()
    const ring = ringOf(e.battleOptions()!)
    expect(ring.attack.map((a) => a.id)).toEqual(['shoot', 'melee'])
    expect(ring.supply.map((a) => a.id)).toEqual(['reload', 'swap', 'item'])
    expect(ring.tactic.map((a) => a.id)).toEqual([MOVE, 'hit_cover', 'watch', 'subdue'])
    // 圓環外面那一列：結束回合點一下就生效；脫離與投降要長按
    expect(ring.system.map((a) => [a.id, !!a.hold])).toEqual([[END_TURN, false], ['flee', true], ['surrender', true]])
    expect(ring.skill).toEqual([])
    // 數字鍵 1～9：由內環往外
    expect(RING_KEYS(e.battleOptions()!)).toEqual(['shoot', 'melee', 'reload', 'swap', 'item', MOVE, 'hit_cover', 'watch', 'subdue'])
  })

  it('灰掉的那一格在泡泡裡寫出原因：行動本身的原因一條一條列；每個目標各自的原因也列得出來', () => {
    const { e } = view()
    const o = e.battleOptions()!
    const reload = o.actions.find((a) => a.id === 'reload')!
    expect(disabledReason(reload)).toBe('彈匣是滿的。')
    expect(disabledReason(o.actions.find((a) => a.id === END_TURN)!)).toBeNull()
    // 引擎給幾條就寫幾條（制伏缺的每一個條件各一句），不自己湊字
    expect(disabledReason({ ...reload, ok: false, blocks: ['對方沒有在過載、失去回合。', '精英與首領要餘韻疊滿才制伏得了（現在 1／2 層）。'] })).toBe('對方沒有在過載、失去回合。\n精英與首領要餘韻疊滿才制伏得了（現在 1／2 層）。')
    expect(disabledReason({ ...reload, ok: false, blocks: [], targets: [{ target: { unit: 'f1' }, blocks: ['要在近身：雙方都站在第 1 格。'] }] })).toBe('要在近身：雙方都站在第 1 格。')
  })
})
