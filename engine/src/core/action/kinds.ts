// L5 行動核心：行動種類的登錄表。自由行動、乞討、打聽、撬鎖、踩點的各種手段……每一種是一筆。
// 核心只內建最通用的 free（玩家自己寫要做什麼）；有名字的種類由功能註冊。

import type { ActionInput, ActorId, AttrId, Change, GameState, Grade, ReportKind, SkillId } from '../types'
import type { Probe } from '../state/probe'
import type { DcTier } from '../rules/check'
import type { Effect } from '../rules/effects'
import type { Degree } from '../types'

// 玩家送出的一次行動：型別在 L0（報告要帶它，Report.args）；這裡留一份舊的出處
export type { ActionInput }

export interface HintCtx {
  state: GameState
  input: ActionInput
  actor: ActorId
  degree: Degree
  /** 成功時差距不到 3 點（是，但是） */
  narrow: boolean
  grade: Grade
}

/** 退路（fallback）收到的：和參考範圍一樣的情境，再加上參考範圍本身（hint 算出來的那一份，沒有 hint 就是空的）。 */
export interface FallbackCtx extends HintCtx {
  hint: Effect[]
}

export interface ActionKindDef {
  id: string
  owner: string
  /** 給玩家看的名字 */
  name: string
  attr: AttrId
  skill?: SkillId
  /** 參考 DC：階梯上的一檔，或照情況算 */
  dc: DcTier | ((state: GameState, input: ActionInput) => DcTier | number)
  /** 平常花多久、最多花多久（分鐘）。判定給的時間超過上限會被夾住 */
  minutes: number
  maxMinutes: number
  reportKind: ReportKind
  /** 情境的標籤，給特質與狀態的修正看 */
  tags?: string[]
  /** 現在能不能做：回傳擋住的原因（給玩家看的完整句子），可以做就回傳 null */
  block?(state: GameState, input: ActionInput): string | null
  /** 參考範圍：照成功程度與這一區的等級，平常會拿到什麼（AI_TASKS 3.1 節第 3 步）。這是給 AI 的預設，不是上限 */
  hint?(ctx: HintCtx): Effect[]
  /**
   * 這一次行動的起手：先套的變更（例：和人互動，先認識他，後面的親密度才有鍵）。照任務鏈開始時的狀態算，純函式、不改狀態。
   * 套法：算回報時驗證用的狀態先套上它（所以算回報的效果、退路 fallback 看到的是套過之後的狀態）；報告的變更把它排在最前面。
   * 必須套得上去，不能是只有一半成立的東西（套不上去整次行動丟錯）。
   */
  prelude?(state: GameState, input: ActionInput): Change[]
  /**
   * 算回報的退路給的效果（AI_TASKS 4.1 節 reward 的「退路」）：AI 關著、這一步被玩家按了「用規則代替」、AI 試到最後都沒過時，鏈用它，
   * 取代預設的「參考範圍的一半」。照內建的來源驗（`source: 'builtin'`）：不受 AI 的一件事上限管，寫多少就是多少
   * （金錢照區的等級、格式的底線照舊）；所以只能放「規則表」本來就會給的東西，不要放 AI 的提議。
   * 沒有寫就走預設。有 fallback 的種類，結果的欄位（報告的 narration.results）就是這些效果驗過、夾過的白話。
   * 效果有一筆不合格，整批退成什麼都不給。
   */
  fallback?(ctx: FallbackCtx): Effect[]
  /**
   * 算回報這一步只照規則（用上面的 fallback），不問 AI：結果完全由規則表決定、AI 沒有東西可以補的種類（例：殺價只看成功程度查表）。
   * 這樣 AI 不會漏交、也不會交出和判定不一致的結果。要有 fallback 才能設（註冊時檢查）。
   * 判定（judge）與寫正文照舊，只有算回報這一步固定走退路（步驟的狀態是 fallback）。
   */
  rewardByRules?: boolean
}

export class ActionRegistry {
  private defs = new Map<string, ActionKindDef>()

  constructor(private probe: Probe) {}

  /** 註冊一種行動。id 重複就丟錯；唯一的例外：核心內建的預設（owner 是 core，例如 free）可以被功能照資料註冊的同一個 id 取代。 */
  register(def: ActionKindDef): void {
    const old = this.defs.get(def.id)
    if (old && !(old.owner === 'core' && def.owner !== 'core')) throw new Error(`行動種類重複註冊：${def.id}（已經由 ${old.owner} 註冊）`)
    if (def.maxMinutes < def.minutes) throw new Error(`行動種類 ${def.id}：maxMinutes 不能比 minutes 小`)
    if (def.rewardByRules && !def.fallback) throw new Error(`行動種類 ${def.id}：rewardByRules 要有 fallback（算回報只照規則，規則是 fallback 給的）`)
    this.defs.set(def.id, def)
    this.probe.emit('core/action/kinds', 'registry.register', { registry: 'actions', id: def.id, owner: def.owner })
  }

  get(id: string): ActionKindDef | undefined {
    return this.defs.get(id)
  }

  list(): ActionKindDef[] {
    return [...this.defs.values()]
  }
}

/**
 * 內建的自由行動：玩家自己寫要做什麼，自己選（或讓判定選）屬性與基本功（AI_TASKS 3.1 節「自由行動的預設」：智識、DC 13、30／240 分鐘）。
 * 這是沒有載入行動種類的資料時的預設；data/rules/actions.json 有 free 這一筆時，行動種類的功能用資料的那一筆取代它（多了參考範圍）。
 */
export const FREE_ACTION: ActionKindDef = {
  id: 'free', owner: 'core', name: '自由行動',
  attr: 'intellect', dc: 'normal', minutes: 30, maxMinutes: 240, reportKind: 'action',
}
