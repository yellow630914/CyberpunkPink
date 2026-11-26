// 測試基礎建設：中途存檔再讀檔（dev/test-harness.md 第 4 節；dev/work/M4-smoke.md 第 4 點）。
// 一條冒煙在幾個檢查點呼叫 roundTrip：存檔、讀檔，狀態（含亂數與紀錄）一模一樣、讀得進來；之後接著走。
// 「中途存讀的結果和不中斷的一樣」由測試把整條主幹跑兩遍（一遍有檢查點、一遍沒有），比最後的 stateHash。

import type { Game } from '../shell/game'
import { stateHash } from './repro'

/** 存檔用的固定時間字串（存檔裡的時間戳記不是遊戲狀態，固定了才不會讓兩遍的雜湊不同）。 */
export const SAVE_NOW = '2026-11-26T00:00:00Z'

/** 存檔再讀檔：讀得進來、狀態的雜湊讀之前讀之後一樣。不一樣丟 Error（寫出檢查點的名字）。 */
export function roundTrip(game: Game, label: string): void {
  const before = stateHash(game.state)
  const err = game.load(game.save('manual', SAVE_NOW, label))
  if (err) throw new Error(`檢查點「${label}」：讀檔失敗：${err}`)
  const after = stateHash(game.state)
  if (after !== before) throw new Error(`檢查點「${label}」：讀檔之後狀態不一樣（${before} → ${after}）`)
}
