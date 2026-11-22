// B014：戰鬥結束的寫正文，硬規則的檢查只擋「標題」，狀態欄與寫進文字的數字都原樣存進報告。
// 規格：AI_TASKS 4.1 節 narrate 那一列「硬規則的檢查（不含數字、不含標題與狀態欄……）」、2.5 節「驗證不過算失敗」；
// PROMPTS 4 節 H4（擲骰、DC、數值不寫進文字）、H10（不寫標題、狀態欄、系統訊息）、H1（報告裡的結果、數值不改、不新增）。
// 現況：`checkProse`（shell/ai/freeAction.ts）只擋「# 標題」；「HP: 999/999」這樣的狀態欄、「擲出 17 對 DC 13，造成 99999999 點傷害」都通過，原樣存進 report.narration.text。
// 狀態本身不受影響（結算在寫正文之前定案）。這裡的期望：正文被擋下（驗證不過 → 重試、停下來等玩家）或把那幾段拿掉，兩種做法都算過；
// 只要存進報告的正文裡沒有狀態欄與數值。
// 2026-11-22 修好（dev/bugs 的 B012～B014 報告）：從 tests/pending 搬進主套件。

import { describe, expect, it } from 'vitest'
import { characterFeature } from '../../src/features/character'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame } from '../../src/testkit'

function lost(reply: string) {
  const t = makeGame({ features: [characterFeature, TEST_COMBAT], pc: { hp: 30, load: 3, afterglow: 1, sink: 4 }, actors: [], seed: 11, ai: { ai: 1, narrate: 1, retry: { narrate: 1 } }, fake: { byTask: { narrate: [{ text: reply }, { text: reply }] } } })
  t.game.startBattle({ ...BATTLE_SETUPS.hopeless(), allies: [{ from: 'actor', id: 'pc' }] })
  while (t.game.battle && !t.game.battle.result) t.game.battleNext({ anyone: true })
  return t.game
}
const stored = (g: ReturnType<typeof lost>) => g.state.reports.map((r) => r.narration?.text ?? '').join('\n')

describe('B014：寫正文的硬規則（AI_TASKS 4.1 節 narrate）', () => {
  it('對照：標題會被擋下（這一條現在就是對的）', async () => {
    const g = lost('# 戰鬥結算\n你倒在地上。\n<covered>1</covered>')
    await g.finishBattle()
    expect(stored(g)).not.toContain('戰鬥結算')
  })

  it('狀態欄（「HP: 999/999」）不能存進正文', async () => {
    const g = lost('HP: 999/999  感載 0/52\n你倒在地上。\n<covered>1</covered>')
    await g.finishBattle()
    expect(stored(g)).not.toMatch(/HP:\s*999/)
  })

  it('擲骰、DC 與編出來的數值（「擲出 17 對 DC 13，造成 99999999 點傷害」）不能存進正文', async () => {
    const g = lost('你擲出 17 對 DC 13，被打了 99999999 點傷害，倒在地上。\n<covered>1</covered>')
    await g.finishBattle()
    expect(stored(g)).not.toMatch(/99999999|DC\s*13/)
  })
})
