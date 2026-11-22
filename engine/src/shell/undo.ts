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
  /** 最近一次 push 擠掉的那一步：那一次的動作沒有成立（drop）時放回去 */
  private evicted: UndoStep | null = null

  constructor(public readonly max = UNDO_STEPS) {}

  get size(): number {
    return this.steps.length
  }

  labels(): string[] {
    return this.steps.map((s) => s.label)
  }

  /** 動作之前呼叫：記下現在的狀態。超過上限時最舊的一步被擠掉（先留著：這個動作沒有成立的話要放回去）。 */
  push(state: GameState, label: string): void {
    this.pushSnapshot(clone(state), label)
  }

  /** 同 push，但快照已經複製好了（動作成立之後才記的寫法）。 */
  pushSnapshot(snapshot: GameState, label: string): void {
    this.steps.push({ state: snapshot, label })
    this.evicted = this.steps.length > this.max ? this.steps.shift()! : null
  }

  /** 動作沒有成立（被擋下、出錯、作廢）：丟掉剛才記的那一份，被它擠掉的那一步放回去。不成立的動作不改能回退的步數。 */
  drop(): void {
    if (this.steps.pop() === undefined) return
    if (this.evicted) this.steps.unshift(this.evicted)
    this.evicted = null
  }

  /** 回退 n 步：回傳那一步開始前的狀態（複製過的）。n 不是正整數、或沒有那麼多步，回傳 null，什麼都不動。 */
  pop(n = 1): GameState | null {
    if (!Number.isInteger(n) || n < 1 || n > this.steps.length) return null
    const step = this.steps[this.steps.length - n]!
    this.steps.length -= n
    this.evicted = null
    return clone(step.state)
  }

  clear(): void {
    this.steps = []
    this.evicted = null
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
