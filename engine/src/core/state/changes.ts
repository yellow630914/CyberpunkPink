// L3 狀態核心：變更的登錄表。報告的 changes 是一串 { op, ... }；每一種 op 在這裡註冊「怎麼驗、怎麼套」。
// 核心只註冊通用的那幾種（coreChanges.ts），其餘由功能註冊。狀態只會被這裡的 apply 改到。

import type { Change, GameState } from '../types'
import type { Probe } from './probe'

export interface ChangeDef<C extends Change = Change> {
  op: string
  owner: string
  /** 這筆變更現在能不能套；回傳錯誤訊息（空的就是可以）。不可以改狀態。 */
  validate(state: GameState, change: C): string[]
  /** 套用。只能改 state；同一個狀態、同一筆變更一定得到同一個結果（不擲骰、不看時鐘）。 */
  apply(state: GameState, change: C): void
  /** 記進紀錄時的瘦身版（例：任務鏈的細節只放在 state.chains，不在紀錄裡再存一份）。沒有就原樣記。 */
  forLog?(change: C): Change
  /** 給玩家看的一行（報告卡的 changes 摘要）；回傳 null 就不顯示。 */
  describe?(change: C, state: GameState): string | null
}

export class ChangeError extends Error {
  constructor(public readonly problems: string[]) {
    super(`變更不合法：${problems.join('；')}`)
    this.name = 'ChangeError'
  }
}

export class ChangeRegistry {
  private defs = new Map<string, ChangeDef>()

  constructor(private probe: Probe) {}

  register<C extends Change>(def: ChangeDef<C>): void {
    if (this.defs.has(def.op)) throw new Error(`變更種類重複註冊：${def.op}（已經由 ${this.defs.get(def.op)!.owner} 註冊）`)
    this.defs.set(def.op, def as unknown as ChangeDef)
    this.probe.emit('core/state/changes', 'registry.register', { registry: 'changes', id: def.op, owner: def.owner })
  }

  get(op: string): ChangeDef | undefined {
    return this.defs.get(op)
  }

  ops(): string[] {
    return [...this.defs.keys()]
  }

  /** 照順序驗一筆套一筆（後面的變更可以依賴前面的結果）。有一筆不合法就丟 ChangeError；呼叫的人負責不讓半套的狀態流出去。 */
  applyAll(state: GameState, changes: readonly Change[]): void {
    changes.forEach((c, i) => {
      const def = this.defs.get(c.op)
      if (!def) throw new ChangeError([`changes[${i}]：沒有 ${String(c.op)} 這種變更`])
      const problems = def.validate(state, c)
      if (problems.length) throw new ChangeError(problems.map((p) => `changes[${i}]（${c.op}）：${p}`))
      def.apply(state, c)
    })
  }

  /** 記進紀錄的那一份 changes。 */
  forLog(changes: readonly Change[]): Change[] {
    return changes.map((c) => this.defs.get(c.op)?.forLog?.(c) ?? c)
  }

  describe(state: GameState, changes: readonly Change[]): string[] {
    const out: string[] = []
    for (const c of changes) {
      const line = this.defs.get(c.op)?.describe?.(c, state)
      if (line) out.push(line)
    }
    return out
  }
}
