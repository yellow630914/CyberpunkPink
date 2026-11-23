// L3 狀態核心：掛鉤。L6 的功能之間不直接 import，要互相用到就掛在這裡（CODESCAN 第 3 節）。
// 掛鉤的處理函式是唯讀的觀察者：拿到狀態不可以改，要改狀態就回傳變更或報告草稿，由提交報告統一套用。
// 提交當中的掛鉤（report.before、report.after、time.passed、turn.end）拿到的 state 是這次提交的工作副本：
// 已經包含到目前為止的每一份報告；整串成功才換進正式的狀態，所以不要把它留著以後用。

import type { Change, GameState, GameTime, Launch, Origin, Report, ReportDraft, ReportRewind } from '../types'
import type { Probe } from './probe'

/** 休息的種類（掛點 rest.done）：breath 喘口氣、sleep 睡一覺、stage 副本裡階段之間的喘口氣。 */
export type RestKind = 'breath' | 'sleep' | 'stage'

/** 掛點 activity.end 的處理函式可以回傳的東西：活動的主人把它們併進「結束的那一份報告」（共用的函式 endActivity）。 */
export interface ActivityEndReturn {
  /** 接在結束報告的變更後面 */
  changes?: Change[]
  /** 進結果的句子 */
  lines?: string[]
  /** 結束提交之後接著開的活動 */
  launch?: Launch[]
  /** 結束提交之後回到最近一份這個種類的快照；好幾個處理函式都回傳時只取第一個 */
  rewind?: ReportRewind
}

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
  /**
   * 一段活動結束了（dev/adr/0016 第一節）：收到活動的種類、這一段的 id、當初是誰發起的（origin）、結果（outcome）與結果的細節（result）。
   * 活動的主人組「結束的那一份報告」時呼叫（共用的函式 endActivity），處理函式回傳的東西併進那一份。
   * 聽的人看 origin.by 是不是自己。核心的戰鬥結算也發（kind 是 battle，outcome 是 win、lose、fled、surrender）。
   * state 是結束之前的狀態，唯讀。
   */
  'activity.end': [{ state: GameState; kind: string; id: string; origin: Origin; outcome: string; result: Record<string, unknown> }, ActivityEndReturn | void]
  /**
   * 休息做完了（dev/adr/0016 第六節）：「每次休息回滿」的東西聽它、回傳變更（回傳的接在休息那一份報告的變更後面）。
   * 發的人是功能（休息、副本的階段之間），用共用的函式 restDone；state 是休息做完之前的狀態，唯讀。
   */
  'rest.done': [{ state: GameState; kind: RestKind }, Change[] | void]
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
