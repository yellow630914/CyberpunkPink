// 白箱測試：M1-ui-combat-picks 在 store 加的轉接（dev/work/M1-ui-combat-picks.md 第二節第 7、8 步、第四節）：
// engine.ts 的 battleMode()、rewindToStage()；game.ts 的 pay、advance、addLog 被引擎擋下時回傳原因（不當成成功）。
// 規格：COMBAT_SYSTEM 8.4 節（戰敗之後的三個選擇）；dev/adr/0014「等著選的戰敗」；dev/invariants.md 第 1、42、48、57、59 條。
// 已知會失敗的（規格說的、程式還沒做到的）放在 ui/tests/pending/M1-ui-combat-picks-bugs.test.ts，不在這裡。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { useEngine } from './engine'
import { useGame } from './game'
import { useUi } from './ui'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
const WAITING = '先在戰敗的三個選擇裡選一個：接受結果、重來這場戰鬥，或回到這個階段開始時。'

beforeEach(() => setActivePinia(createPinia()))

function withCharacter() {
  const e = useEngine()
  e.newGame({ seed: 7 })
  expect(e.createCharacter(DRAFT)).toEqual([])
  return e
}
/** 打一場一定輸的，結算到等三選一 */
async function lose(e: ReturnType<typeof useEngine>) {
  e.startBattle(BATTLE_SETUPS.hopeless())
  for (let i = 0; i < 500 && e.battleOptions()!.waiting !== 'over'; i++) {
    if (e.battleOptions()!.waiting === 'ai') e.battleNext()
    else expect(e.battleAct({ action: 'surrender' }).status).toBe('applied')
  }
  expect(e.battleOptions()!.waiting).toBe('over')
  expect((await e.finishBattle()).status).toBe('applied')
  expect(e.pendingDefeat).not.toBeNull()
}
/** 存一份引擎的快照（委託副本的功能在 M2 會這樣存；ADR 0011：種類 stage、entry） */
function snapshot(e: ReturnType<typeof useEngine>, id: string, kind: string, label: string) {
  const raw = e.save()
  expect(e.commit({ summary: label, action: 'ui.snapshot', changes: [{ op: 'snapshot.add', slot: { id, kind, label, raw } } as never] })).toBeNull()
}

describe('battleMode()：這個戰場的規則從這一局的內容來（工單第四節；審查 S9）', () => {
  it('沒有在打是 null；在打的時候是這一場的戰場（現實：遮蔽的名字與耐久照規則表）', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    expect(e.battleMode()).toBeNull()
    e.startBattle(BATTLE_SETUPS.encounter())
    const m = e.battleMode()!
    expect(m.id).toBe(e.battle!.mode)
    expect(m.coverNames).toEqual(['暴露', '半掩體', '掩體'])
    expect(m.numbers.coverHp).toEqual({ half: [15, 15, 20, 25, 30], full: [30, 30, 40, 50, 60] })
  })

  it('戰場的 id 在內容裡查不到（也不是預設的那幾個）時是 null，不丟錯', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(BATTLE_SETUPS.encounter())
    // 只改 store 的投影（不經過提交）：模擬一個 battle.mode 對不到規則的情形，看轉接本身的退路
    const fake = { ...e.state, battle: { ...e.battle!, mode: 'no_such_mode' } }
    e.state = fake as never
    expect(e.battleMode()).toBeNull()
  })
})

describe('rewindToStage()：戰敗三選一的「回到這個階段開始時」（COMBAT_SYSTEM 8.4；dev/adr/0014）', () => {
  it('沒有在等戰敗的選擇：回傳原因，狀態不變', () => {
    const e = withCharacter()
    const before = JSON.stringify(e.state)
    expect(e.rewindToStage()).toBe('現在沒有在等戰敗的選擇。')
    e.startBattle(BATTLE_SETUPS.encounter())
    const mid = JSON.stringify(e.state)
    expect(e.rewindToStage()).toBe('現在沒有在等戰敗的選擇。')
    expect(JSON.stringify(e.state)).toBe(mid)
    expect(before).not.toBe(mid)
  })

  it('開打前有階段開始的快照：回到那一刻（時間、錢），之後的紀錄留著標成被收回（第 42 條），等著選的戰敗解除（第 59 條），開打前的快照丟掉（第 57 條）', async () => {
    const e = withCharacter()
    e.ledger([{ op: 'cash', delta: 300 }])
    snapshot(e, 'stage1', 'stage', '第一階段開始')
    const at = { ...e.state.time }
    const cash = e.money.cash
    e.ledger([{ op: 'cash', delta: -120 }, { op: 'time', minutes: 90 } as never])
    await lose(e)
    const n = e.state.reports.length
    expect(e.state.snapshots.map((s) => s.kind)).toEqual(['stage', 'battle'])
    expect(e.rewindToStage()).toBeNull()
    expect(e.state.time).toEqual(at)
    expect(e.money.cash).toBe(cash)
    expect(e.pendingDefeat).toBeNull()
    expect(e.defeat).toBeNull()
    expect(e.inBattle).toBe(false)
    expect(e.state.snapshots.some((s) => s.kind === 'battle')).toBe(false)
    // 紀錄：快照之後的每一份都留著、標成被收回；多一份交代的
    expect(e.state.reports.length).toBe(n + 1)
    expect(e.state.reports.at(-1)).toMatchObject({ action: 'rewind', outcome: { summary: '你回到這個階段開始的時候。' } })
    expect(e.state.reports.filter((r) => r.retracted).length).toBeGreaterThan(3)
    // 解除之後別的事做得成；再按一次是「沒有在等」
    expect(e.blockOf('commit:ui.legacy')).toBeNull()
    expect(e.rewindToStage()).toBe('現在沒有在等戰敗的選擇。')
  })

  it('入口、階段、開打前三份都在：回到的是緊貼著開打前的那一份（最近的階段），不是入口', async () => {
    const e = withCharacter()
    snapshot(e, 'entry1', 'entry', '入口')
    e.ledger([{ op: 'time', minutes: 30 } as never])
    snapshot(e, 'stage1', 'stage', '第一階段開始')
    e.ledger([{ op: 'time', minutes: 30 } as never])
    snapshot(e, 'stage2', 'stage', '第二階段開始')
    const at = { ...e.state.time }
    e.ledger([{ op: 'time', minutes: 45 } as never])
    await lose(e)
    expect(e.rewindToStage()).toBeNull()
    expect(e.state.time).toEqual(at)
    // 比它晚的與它自己一起丟掉（不變式第 57 條），更早的留著
    expect(e.state.snapshots.map((s) => s.id)).toEqual(['entry1', 'stage1'])
  })

  it('回不去（快照壞了）：回傳原因，還在等三選一，狀態不變', async () => {
    const e = withCharacter()
    expect(e.commit({ summary: '壞掉的快照', action: 'ui.snapshot', changes: [{ op: 'snapshot.add', slot: { id: 'bad', kind: 'stage', label: '壞的', raw: '{不是存檔' } } as never] })).toBeNull()
    await lose(e)
    const before = JSON.stringify(e.state)
    const err = e.rewindToStage()
    expect(typeof err).toBe('string')
    expect(JSON.stringify(e.state)).toBe(before)
    expect(e.pendingDefeat).not.toBeNull()
  })
})

describe('battleAct、battleNext 被擋下：不刷新、狀態不變（不變式第 46 條）', () => {
  it('輪到玩家時叫 AI 走一步、輪到 AI 時玩家下指令：回傳 refused 與原因，store 的狀態不變', () => {
    const e = useEngine()
    e.newGame({ seed: 7 })
    e.startBattle(BATTLE_SETUPS.encounter())
    const opts = e.battleOptions()!
    const before = JSON.stringify(e.state)
    const wrong = opts.waiting === 'player' ? e.battleNext() : e.battleAct({ action: 'end' })
    expect(wrong.status).toBe('refused')
    expect((wrong.reasons ?? []).length).toBeGreaterThan(0)
    expect(JSON.stringify(e.state)).toBe(before)
  })
})

describe('checkSave()：只驗證、不套用', () => {
  it('讀不進來的回傳原因，讀得進來的回傳 null；兩種都不改現在這一局', () => {
    const e = withCharacter()
    const good = e.save()
    const before = JSON.stringify(e.state)
    expect(typeof e.checkSave('{壞掉')).toBe('string')
    expect(e.checkSave(good)).toBeNull()
    expect(JSON.stringify(e.state)).toBe(before)
  })
})

describe('舊系統的錢、時間、紀錄被引擎擋下時不當成成功（工單第二節第 8 步；不變式第 48、59 條）', () => {
  it('戰鬥中：改錢、advance、addLog 都把擋下的原因寫進提示，錢、時間、紀錄都沒動', () => {
    const g = useGame()
    const e = useEngine()
    const ui = useUi()
    vi.useFakeTimers()
    try {
      e.startBattle(BATTLE_SETUPS.encounter())
      const before = { cash: e.money.cash, cred: e.money.cred, time: { ...e.state.time }, n: e.state.reports.length }
      g.money.cash = before.cash - 100
      g.money.acc = before.cred + 100
      g.advance(30)
      g.addLog({ prose: ['打到一半去逛街。'] } as never)
      expect(ui.toasts.map((t) => [t.text, t.kind])).toEqual(Array(4).fill(['正在戰鬥，先把這一場打完。', 'warn']))
      expect({ cash: e.money.cash, cred: e.money.cred, time: e.state.time, n: e.state.reports.length }).toEqual(before)
      // 錢沒變：沒有變化就不送、不提示
      g.money.cash = before.cash
      expect(ui.toasts).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('等著選的戰敗：同樣擋下、寫出三選一的提示；接受結果之後就收', async () => {
    const g = useGame()
    const e = useEngine()
    const ui = useUi()
    expect(e.createCharacter(DRAFT)).toEqual([])
    await lose(e)
    vi.useFakeTimers()
    try {
      const cash = e.money.cash
      g.money.cash = cash + 50
      g.advance(10)
      g.addLog({ prose: ['先去喝一杯。'] } as never)
      expect(ui.toasts.map((t) => t.text)).toEqual([WAITING, WAITING, WAITING])
      expect(e.money.cash).toBe(cash)
      e.acceptDefeat()
      const after = e.money.cash
      g.money.cash = after + 50
      expect(e.money.cash).toBe(after + 50)
      expect(ui.toasts).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('錢不夠（引擎不讓錢變負數）照舊提示「錢不夠。」，不丟錯', () => {
    const g = useGame()
    const e = useEngine()
    const ui = useUi()
    vi.useFakeTimers()
    try {
      e.newGame({ seed: 3 })
      g.money.cash = -5
      expect(e.money.cash).toBe(0)
      expect(ui.toasts.map((t) => t.text)).toEqual(['錢不夠。'])
    } finally {
      vi.useRealTimers()
    }
  })
})
