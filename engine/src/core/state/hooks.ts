// L3 狀態核心：掛鉤。L6 的功能之間不直接 import，要互相用到就掛在這裡（CODESCAN 第 3 節）。
// 掛鉤的處理函式是唯讀的觀察者：拿到狀態不可以改，要改狀態就回傳變更或報告草稿，由提交報告統一套用。
// 提交當中的掛鉤（report.before、report.after、time.passed、turn.end）拿到的 state 是這次提交的工作副本：
// 已經包含到目前為止的每一份報告；整串成功才換進正式的狀態，所以不要把它留著以後用。

import type { ActionInput, Change, GameState, GameTime, Launch, Origin, Report, ReportDraft, ReportRewind } from '../types'
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
 * 自由行動的視窗（掛點 action.window）一個回答：插一個選項，或替玩家選（妖精的吻擴散階段；CYBERWARE 第 5 節；M4-core-gaps 第 16 項）。
 * 兩個鍵都選填、可以一起給：option 是多一個選項（玩家選了就送出 input）；replace 是玩家這一次送出的行動直接換成別的（只能換成同一種行動——kind 一樣；why 是給玩家看的一句話，進報告 action.override 那一拍與結果）。
 * 回答要從狀態導出（不能用 Math.random）：重擲與讀檔重來要得到同一個答案，種子重播才不會壞（M4 審查建議 3）。
 */
export interface ActionWindowAnswer {
  option?: { id: string; label: string; input: ActionInput }
  replace?: { input: ActionInput; why: string }
}

/** 掛點 report.before 的回答：要加進這份報告的變更，和接在結果後面的句子（給玩家看的完整句子）。 */
export interface ReportBeforeAnswer {
  changes: Change[]
  lines?: string[]
}

/**
 * 核心定義的掛點。功能可以用 declare module 擴充這張表，加上自己的掛點（例如戰鬥結束）。
 * 每一項是 [收到的東西, 可以回傳的東西]。
 */
export interface HookMap {
  /**
   * 報告套用之前：可以回傳要加進這份報告的變更（例：契約的收益歸屬）；要在這份報告的結果多說一句話，回傳 { changes, lines }（M4 收尾修正批）：
   * 核心把 lines 接到 narration.results 與 outcome.summary 後面。處理函式拿到的 draft 是唯讀的：不要直接改它的正文與摘要。
   */
  'report.before': [{ state: GameState; draft: ReportDraft }, Change[] | ReportBeforeAnswer | void]
  /** 報告套用之後：可以回傳接著要提交的報告（例：跨過週一時的帳單）。 */
  'report.after': [{ state: GameState; report: Report }, ReportDraft[] | void]
  /** 時間往前走了：from 到 to。可以回傳接著要提交的報告。 */
  'time.passed': [{ state: GameState; from: GameTime; to: GameTime }, ReportDraft[] | void]
  /** 開新遊戲：狀態骨架建好之後。可以回傳變更（功能放自己的初始狀態）。 */
  'game.new': [{ state: GameState }, Change[] | void]
  /** 讀檔之後、交給遊戲之前：讀檔修復。可以回傳變更。 */
  'save.loaded': [{ state: GameState; fromVersion: number }, Change[] | void]
  /**
   * 一個行動的回合結束（報告提交之後的收尾流程）。可以回傳接著要提交的報告。
   * report 是玩家這個行動自己的那一份；reports 是這一回合到目前為止提交的每一份（第一份就是 report，後面是 report.after 的掛鉤接著提交的），
   * 唯讀：陣列是複製的，裡面的報告和狀態裡的是同一份。導演用它收集這一回合的觸發點：行動之後才發現的事（警戒漲過門檻）由功能接一份報告，觸發點寫在那一份上（dev/adr/0017 M2 修正批 4）。
   */
  'turn.end': [{ state: GameState; report: Report; reports: readonly Report[] }, ReportDraft[] | void]
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
  /**
   * 玩家要做一個主動行動（prepareAction 擲骰之前）的視窗：功能可以插一個選項（option；畫面用 actionWindow 取來列出）、
   * 或替玩家選（replace：這一次的行動換成它，換了之後的行動種類要存在、而且沒被擋；pending.replaced 記著原本的與原因）。
   * 處理函式只讀，不改狀態；沒有人回答就什麼都不變。成人場景裡的同一種視窗是 features/scene 宣告的 scene.window。
   */
  'action.window': [{ state: GameState; input: ActionInput }, ActionWindowAnswer | void]
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
