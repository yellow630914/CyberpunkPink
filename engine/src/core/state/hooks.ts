// L3 狀態核心：掛鉤。L6 的功能之間不直接 import，要互相用到就掛在這裡（CODESCAN 第 3 節）。
// 掛鉤的處理函式是唯讀的觀察者：拿到狀態不可以改，要改狀態就回傳變更或報告草稿，由提交報告統一套用。
// 提交當中的掛鉤（report.before、report.after、time.passed、turn.end）拿到的 state 是這次提交的工作副本：
// 已經包含到目前為止的每一份報告；整串成功才換進正式的狀態，所以不要把它留著以後用。

import type { Change, GameState, GameTime, Report, ReportDraft } from '../types'
import type { Probe } from './probe'

/**
 * 核心定義的掛點。功能可以用 declare module 擴充這張表，加上自己的掛點（例如戰鬥結束）。
 * 每一項是 [收到的東西, 可以回傳的東西]。
 */
export interface HookMap {
  /** 報告套用之前：可以回傳要加進這份報告的變更（例：契約的收益歸屬）。 */
  'report.before': [{ state: GameState; draft: ReportDraft }, Change[] | void]
  /** 報告套用之後：可以回傳接著要提交的報告（例：跨過週一時的帳單）。 */
  'report.after': [{ state: GameState; report: Report }, ReportDraft[] | void]
  /** 時間往前走了：from 到 to。可以回傳接著要提交的報告。 */
  'time.passed': [{ state: GameState; from: GameTime; to: GameTime }, ReportDraft[] | void]
  /** 開新遊戲：狀態骨架建好之後。可以回傳變更（功能放自己的初始狀態）。 */
  'game.new': [{ state: GameState }, Change[] | void]
  /** 讀檔之後、交給遊戲之前：讀檔修復。可以回傳變更。 */
  'save.loaded': [{ state: GameState; fromVersion: number }, Change[] | void]
  /** 一個行動的回合結束（報告提交之後的收尾流程）。可以回傳接著要提交的報告。 */
  'turn.end': [{ state: GameState; report: Report }, ReportDraft[] | void]
  /**
   * 回到快照（委託副本的撤退、戰敗後的回退；SERIES 第 6 節）：current 是回去之前的狀態，restored 是快照那一刻的狀態。
   * 紀錄由核心保留；功能要保留自己那一塊（性經歷、共同記憶……）就回傳變更，套在 restored 上。
   */
  'rewind.keep': [{ current: GameState; restored: GameState }, Change[] | void]
}

export type HookName = keyof HookMap
type Handler<N extends HookName> = (payload: HookMap[N][0]) => HookMap[N][1]

interface Entry {
  owner: string
  order: number
  fn: (payload: unknown) => unknown
}

export class HookBus {
  private handlers = new Map<string, Entry[]>()

  constructor(private probe: Probe) {}

  /** 掛上一個處理函式。order 小的先跑（預設 0）；同一個 order 照註冊的順序。 */
  on<N extends HookName>(name: N, owner: string, fn: Handler<N>, order = 0): void {
    const list = this.handlers.get(name) ?? []
    list.push({ owner, order, fn: fn as (payload: unknown) => unknown })
    list.sort((a, b) => a.order - b.order)
    this.handlers.set(name, list)
    this.probe.emit('core/state/hooks', 'registry.register', { registry: 'hooks', id: name, owner })
  }

  /** 呼叫一個掛點，收集每個處理函式回傳的東西（void 的略過）。 */
  run<N extends HookName>(name: N, payload: HookMap[N][0]): Array<{ owner: string; result: Exclude<HookMap[N][1], void | null | undefined> }> {
    const out: Array<{ owner: string; result: Exclude<HookMap[N][1], void | null | undefined> }> = []
    for (const h of this.handlers.get(name) ?? []) {
      const result = h.fn(payload) as HookMap[N][1]
      this.probe.emit('core/state/hooks', 'hook.call', () => ({ hook: name, owner: h.owner, result }))
      if (result !== undefined && result !== null) out.push({ owner: h.owner, result: result as Exclude<HookMap[N][1], void | null | undefined> })
    }
    return out
  }

  owners(name: HookName): string[] {
    return (this.handlers.get(name) ?? []).map((h) => h.owner)
  }
}
