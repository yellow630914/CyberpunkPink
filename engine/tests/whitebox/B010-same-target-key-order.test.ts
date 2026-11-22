// B010：同一個目標，鍵的順序不同就被當成「這個目標不能選」（dev/bugs/B010-target-match-depends-on-key-order.md）。
// 規格：dev/invariants.md 第 46 條（做不成的一步回傳原因；目標由 targets 列出，列出來的合法目標一步送得出去）；BattleTarget 是一個聯集型別（core/types/battle.ts），物件的鍵沒有順序。
// 現況：core/battle/field.ts 的 sameTarget 用 JSON.stringify 比對，{ slot: 2, side: 'ally' } 與 { side: 'ally', slot: 2 } 不相等。
// 從存檔、JSON 傳輸或別的程式組出來的目標（鍵的順序不一定）會被擋下。已修好（2026-11-22），這一份是回歸測試。

import { describe, expect, it } from 'vitest'
import { sameTarget } from '../../src'
import { TEST_COMBAT, makeBattleGame } from '../../src/testkit'

describe('B010：目標的比對不看鍵的順序', () => {
  it('sameTarget：兩個鍵順序不同的同一個格子相等', () => {
    expect(sameTarget({ side: 'ally', slot: 2 }, { slot: 2, side: 'ally' } as never)).toBe(true)
  })

  it('battleAct：換位的目標鍵順序反過來也送得出去', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT], battle: 'encounter' })
    const b = game.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = 9
    const r = game.battleAct({ action: 'move', target: { slot: 2, side: 'ally' } as never })
    expect(r.reasons).toBeUndefined()
    expect(r.status).toBe('applied')
  })

  it('對照：鍵順序和 targets 列的一樣就送得出去（這一條現在就是對的）', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT], battle: 'encounter' })
    const b = game.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = 9
    expect(game.battleAct({ action: 'move', target: { side: 'ally', slot: 2 } }).status).toBe('applied')
  })
})
