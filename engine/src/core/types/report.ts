// L0 型別：報告與變更（GAME_DESIGN 第 9 節）。報告是事件紀錄；changes 套用之後就是狀態的變化。

import type { CheckRoll } from './check'
import type { ActorId, ReportId } from './ids'
import type { GameTime } from './time'

export const REPORT_KINDS = ['gig', 'combat', 'netrun', 'action', 'event', 'broadcast', 'deal', 'social', 'downtime', 'system'] as const
/** system：開新遊戲、建角、讀檔修復這類不是玩家行動的紀錄（GAME_DESIGN 第 9 節沒有列，核心自己用）。 */
export type ReportKind = (typeof REPORT_KINDS)[number]

/**
 * 一筆變更。op 是登錄表裡的種類（核心有 cred、cash、time、flag、counter、item、actor.add、actor.patch、rng、ext；
 * 其餘由功能註冊）。其他欄位由那個種類自己定義。
 */
export interface Change {
  op: string
  [field: string]: unknown
}

export interface ReportLocation {
  district?: string
  block?: string
  facility?: string
  /** 場景格或場景的一句話 */
  scene?: string
  /** 竄網時：子網 id 與層 */
  subnet?: { id: string; layer: number }
}

/** 隊伍快照：hp、load、sink 各一組 [前, 後, 上限]。 */
export interface PartySnapshot {
  id: ActorId
  name: string
  hp?: [number, number, number]
  load?: [number, number, number]
  sink?: [number, number, number]
  afterglow?: number
}

export interface TimelineBeat {
  /** 現實的節拍標 meat，竄網的標 net */
  layer: 'meat' | 'net'
  actor?: ActorId
  text: string
  roll?: CheckRoll
  /** 判定的轉折一句（「但是／而且」的內容）；紀錄的擲骰行下面顯示 */
  twist?: string
  /**
   * 這一拍是什麼事（戰鬥的事件：BATTLE_EVENTS 裡的一個，例如 crit、overload、down、subdue）。
   * 直播的亮點、任務目標、成就聽的就是這個；沒有就是一般的敘述。
   */
  tag?: string
  /** 事件的數字與對象（target、amount、slot……），給聽事件的功能與畫面用 */
  data?: Record<string, unknown>
}

export interface ReportOutcome {
  /** 結果的代號，例如 success、fail、created */
  result: string
  /** 給玩家看的摘要（AI 關閉時的戰報） */
  summary: string
}

/** 被夾值的一筆：原本的值、上限、夾過的值，以及給玩家看的白話提醒（AI_TASKS 2.5 節）。 */
export interface ClampNote {
  path: string
  from: unknown
  to: unknown
  limit?: unknown
  /** 白話：不出現欄位名稱與硬規則編號 */
  notice: string
}

export interface ReportNarration {
  /** AI 的正文；AI 關閉或走退路時沒有 */
  text?: string
  /** 定案的結果，一行一筆（AI_TASKS 4.1 節的 <results>） */
  results?: string[]
  /** 正文漏寫的那幾行（對照） */
  uncovered?: number[]
  /** 這一幕正在直播 */
  stream?: { viewers: number; heat: number; mood: string }
}

export interface Report {
  id: ReportId
  kind: ReportKind
  /** 行動種類或事件 id，例如 free、creation.commit */
  action?: string
  time: { start: GameTime; end: GameTime }
  location: ReportLocation
  actor?: ActorId
  /** 玩家這一回合的輸入原文 */
  input?: string
  party: PartySnapshot[]
  timeline: TimelineBeat[]
  changes: Change[]
  outcome: ReportOutcome
  clamps?: ClampNote[]
  narration?: ReportNarration
  /** 這份報告屬於哪一條任務鏈（任務鏈列用） */
  chain?: string
  /**
   * 被收回的經歷（SERIES 第 6 節）：委託副本撤退、戰敗後回退時，狀態回到快照那一刻，但這段紀錄留著。
   * 標了這個記號的報告只是紀錄：它的 changes 已經不算數。只有 Game.rewind 會標。
   */
  retracted?: boolean
}

/** 還沒提交的報告：id 與時間由 commitReport 補上。 */
export type ReportDraft = Omit<Report, 'id' | 'time'> & { time?: { start: GameTime; end: GameTime } }
