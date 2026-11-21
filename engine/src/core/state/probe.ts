// L3 狀態核心：探針（dev/test-harness.md 第 2 節）。唯讀的觀察點：提交報告前後、每一個掛鉤被呼叫時、
// 登錄表註冊時、任務鏈每一步的狀態變化。沒有 start() 時 emit 直接返回，不複製任何東西，正式版不受影響。

import { clone } from '../util/clone'

export interface ProbeEvent {
  /** 時間順序 */
  seq: number
  /** 來源模組，例如 core/state/commit、shell/ai/chain */
  source: string
  /** 事件種類，例如 report.before、hook.call、registry.register、chain.step */
  type: string
  /** 內容的快照（複製過，之後狀態再變也不影響） */
  data: unknown
}

export class Probe {
  private events: ProbeEvent[] | null = null
  private seq = 0

  get active(): boolean {
    return this.events !== null
  }

  start(): void {
    this.events = []
    this.seq = 0
  }

  stop(): ProbeEvent[] {
    const out = this.events ?? []
    this.events = null
    return out
  }

  /** data 可以給函式：探針沒開時不會被呼叫，所以組資料的成本只在觀察時才付。 */
  emit(source: string, type: string, data: unknown | (() => unknown)): void {
    if (!this.events) return
    const value = typeof data === 'function' ? (data as () => unknown)() : data
    this.events.push({ seq: this.seq++, source, type, data: safeClone(value) })
  }
}

function safeClone(v: unknown): unknown {
  try {
    return clone(v)
  } catch {
    return String(v)
  }
}
