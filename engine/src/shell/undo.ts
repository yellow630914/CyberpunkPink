// L7 外殼：回退（做法照搬 ElondiaRPG 的 stores/undo.ts）。每次動作前留一份狀態，回退就是把狀態換回那一份。
//
// - 快照不進存檔：讀檔、開新遊戲之後就不能回退到之前。
// - 回退之後狀態和當時完全相同（dev/invariants.md 第 3 條），亂數狀態也一樣：再做同樣的行動會擲出同樣的骰。
//   想換一顆骰用任務鏈的「重擲」，會留紀錄（AI_TASKS 2.4 節）。這一點和 ElondiaRPG 不同（那邊回退時換種子），見 dev/adr/0003。
// - 委託副本的快照（回退時保留紀錄、性經歷與共同記憶，SERIES 第 6 節）是另一件事，M2 做委託時用 restore 的 keep 參數。

import type { GameState } from '../core/types'
import { clone } from '../core/util/clone'

/** 最多回退幾步。 */
export const UNDO_STEPS = 5

export interface UndoStep {
  /** 這一步開始前的狀態 */
  state: GameState
  /** 給玩家看的名字（這一步做了什麼） */
  label: string
}

export class UndoStack {
  private steps: UndoStep[] = []

  constructor(public readonly max = UNDO_STEPS) {}

  get size(): number {
    return this.steps.length
  }

  labels(): string[] {
    return this.steps.map((s) => s.label)
  }

  /** 動作之前呼叫：記下現在的狀態。 */
  push(state: GameState, label: string): void {
    this.steps.push({ state: clone(state), label })
    if (this.steps.length > this.max) this.steps.shift()
  }

  /** 動作沒有成立（被擋下、出錯）：丟掉剛才記的那一份。 */
  drop(): void {
    this.steps.pop()
  }

  /** 回退 n 步：回傳那一步開始前的狀態（複製過的）。沒有那麼多步就回傳 null，什麼都不動。 */
  pop(n = 1): GameState | null {
    if (n < 1 || n > this.steps.length) return null
    const step = this.steps[this.steps.length - n]!
    this.steps.length -= n
    return clone(step.state)
  }

  clear(): void {
    this.steps = []
  }
}

/**
 * 把快照套回去，但保留現在狀態裡的幾樣東西（委託副本的回退用）。keep 拿到（現在的狀態, 要還原成的狀態），直接改後者。
 */
export function restoreKeeping(current: GameState, snapshot: GameState, keep?: (current: GameState, restored: GameState) => void): GameState {
  const out = clone(snapshot)
  keep?.(current, out)
  return out
}
