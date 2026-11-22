// L5 行動核心：行動種類的登錄表。自由行動、乞討、打聽、撬鎖、踩點的各種手段……每一種是一筆。
// 核心只內建最通用的 free（玩家自己寫要做什麼）；有名字的種類由功能註冊。

import type { ActorId, AttrId, GameState, Grade, ReportKind, RollPart, SkillId } from '../types'
import type { Probe } from '../state/probe'
import type { DcTier } from '../rules/check'
import type { Effect } from '../rules/effects'
import type { Degree } from '../types'

/** 玩家送出的一次行動。 */
export interface ActionInput {
  /** 行動種類的 id */
  kind: string
  /** 玩家寫的描述（自由行動的本文；asked 要對得上它） */
  text?: string
  /** 玩家自己選的屬性與基本功；沒選就用種類的預設 */
  attr?: AttrId
  skill?: SkillId
  target?: ActorId
  /** 發起的功能自己算好的情境修正 */
  situation?: RollPart[]
}

export interface HintCtx {
  state: GameState
  input: ActionInput
  actor: ActorId
  degree: Degree
  /** 成功時差距不到 3 點（是，但是） */
  narrow: boolean
  grade: Grade
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
}

export class ActionRegistry {
  private defs = new Map<string, ActionKindDef>()

  constructor(private probe: Probe) {}

  /** 註冊一種行動。id 重複就丟錯；唯一的例外：核心內建的預設（owner 是 core，例如 free）可以被功能照資料註冊的同一個 id 取代。 */
  register(def: ActionKindDef): void {
    const old = this.defs.get(def.id)
    if (old && !(old.owner === 'core' && def.owner !== 'core')) throw new Error(`行動種類重複註冊：${def.id}（已經由 ${old.owner} 註冊）`)
    if (def.maxMinutes < def.minutes) throw new Error(`行動種類 ${def.id}：maxMinutes 不能比 minutes 小`)
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
