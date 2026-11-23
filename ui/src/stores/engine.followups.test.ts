// store 包住引擎的幾個補充（M1 第一波之後的核心修正，dev/adr/0014）：
// 開打回傳 battle.start 的報告、戰鬥中與等著選的戰敗時別的提交被擋下（回傳原因，不丟例外）、引擎的行動都帶圖示與 picks。

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { useEngine } from './engine'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}

/** M2-defeat：打輸之後戰敗事件的視窗可能自己開起來（事件窗開著時要先回應）；一直選第一個選得了的選項到事件演完（最多十次） */
async function playOutEvents(e: ReturnType<typeof useEngine>) {
  for (let i = 0; i < 10 && e.event.view(); i++) {
    const o = e.event.view()!.options.find((x) => !x.locked)
    expect(o).toBeTruthy()
    expect((await e.event.choose(o!.id)).status).toBe('applied')
  }
  expect(e.event.view()).toBeNull()
}

describe('store：開打、被擋下的提交、行動的宣告', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('startBattle 與 startEncounter 回傳開打的報告：第一份是 battle.start，開場的每一拍在 timeline（畫面放進戰鬥紀錄）', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    const reports = e.startBattle(BATTLE_SETUPS.encounter())
    expect(reports[0]).toMatchObject({ kind: 'combat', action: 'battle.start' })
    expect(reports[0]!.timeline[0]!.text).toMatch(/^戰鬥開始/)
    expect(reports[0]!.timeline.some((b) => b.tag === 'turn')).toBe(true)

    setActivePinia(createPinia())
    const f = useEngine()
    f.newGame({ seed: 7 })
    expect(f.createCharacter(DRAFT)).toEqual([])
    const id = f.encounters().find((x) => x.grade === 1)!.id
    const started = f.startEncounter(id)
    expect(started[0]).toMatchObject({ action: 'battle.start' })
    expect(f.inBattle).toBe(true)
    // 這一份也在這一場的 steps 裡：讀檔回來照它重建紀錄
    expect(f.battle!.steps).toEqual([started[0]!.id])
  })

  it('戰鬥中舊系統的提交（commit、ledger）不收：回傳原因、不丟例外，錢與紀錄都沒動', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.commit({ summary: '開打之前收得進去。' })).toBeNull()
    e.ledger([{ op: 'cash', delta: 100 }])
    e.startBattle(BATTLE_SETUPS.encounter())
    const before = e.log.length
    expect(e.commit({ summary: '打到一半去買東西。' })).toBe('正在戰鬥，先把這一場打完。')
    expect(e.ledger([{ op: 'cash', delta: -50 }])).toBe('正在戰鬥，先把這一場打完。')
    expect(e.ledger([{ op: 'cash', delta: 0 }])).toBeNull()
    expect(e.money.cash).toBe(100)
    expect(e.log.length).toBe(before)
    expect(e.blockOf('grid.move')).toBe('正在戰鬥，先把這一場打完。')
  })

  it('打輸之後還沒選：pendingDefeat 有東西，別的事被擋下、原因寫出來；接受之後就不擋', async () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.createCharacter(DRAFT)).toEqual([])
    e.startBattle(BATTLE_SETUPS.hopeless())
    while (e.battleOptions()!.waiting === 'ai') e.battleNext()
    // 輪得到我方就投降；輪不到（已經被打倒）就是全隊倒下。兩種都是戰敗
    if (e.battleOptions()!.waiting === 'player') expect(e.battleAct({ action: 'surrender' }).status).toBe('applied')
    expect(e.battleOptions()!.waiting).toBe('over')
    expect((await e.finishBattle()).status).toBe('applied')
    expect(e.defeat).not.toBeNull()
    expect(['lose', 'surrender']).toContain(e.pendingDefeat!.outcome)
    // 戰敗事件的視窗開著時，原因是事件視窗的；不演的話是三選一的提示
    const why = e.commit({ summary: '去逛街。' })
    expect(why).toMatch(/眼前有一件事要先回應|先在戰敗的三個選擇裡選一個/)
    expect(e.blockOf('commit:ui.legacy')).toBe(why)
    // 事件還沒演完不能接受
    if (e.event.view()) expect(() => e.acceptDefeat()).toThrow(/眼前有一件事/)
    await playOutEvents(e)
    e.acceptDefeat()
    expect(e.defeat).toBeNull()
    expect(e.pendingDefeat).toBeNull()
    expect(e.commit({ summary: '接受之後收得進去。' })).toBeNull()
    expect(e.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
  })

  it('battleOptions 的每個行動都帶圖示的鍵與 picks（陣列）', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(BATTLE_SETUPS.encounter())
    while (e.battleOptions()!.waiting === 'ai') e.battleNext()
    const actions = e.battleOptions()!.actions
    expect(actions.length).toBeGreaterThan(5)
    for (const a of actions) {
      expect(typeof a.icon, a.id).toBe('string')
      expect(Array.isArray(a.picks), a.id).toBe(true)
    }
  })
})
