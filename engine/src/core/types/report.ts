// L0 型別：報告與變更（GAME_DESIGN 第 9 節）。報告是事件紀錄；changes 套用之後就是狀態的變化。

import type { CheckRoll, RollPart } from './check'
import type { ActorId, AttrId, ReportId, SkillId } from './ids'
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

/**
 * 一段活動是誰發起的（dev/adr/0016 第一節）。by 是功能的 id（沒有人發起、核心自己開的是 core）；
 * ref 是發起的那件事的 id（委託、事件）；ext 放慣用的鍵（commission、stage、face、pre、defeat_event……）。
 * 做完交回給發起的人時原樣帶回去（掛點 activity.end 的 origin）。
 */
export interface Origin {
  by: string
  ref?: string
  ext?: Record<string, unknown>
}

/** 一份報告提交之後接著開的一段活動（Game 照順序 k.activity.start 再提交；開不成整步不成立）。setup 的形狀由那種活動定義。 */
export interface Launch {
  kind: string
  setup: unknown
  origin?: Origin
}

/**
 * 提交之後回到最近一份這個種類的快照（撤退、委託失敗；dev/adr/0016 第二節）。
 * 型別放在這裡是因為掛點 activity.end 的處理函式可以回傳它、核心的結算併進報告；外殼提交完之後執行（Game.rewindToKind）：
 * 紀錄留著並標成被收回（連同這份報告自己），summary 寫成一筆 system 的報告。同一份報告不能同時帶 launch 與 rewind。
 */
export interface ReportRewind {
  kind: string
  summary: string
  /**
   * true：回去之後亂數的游標往前推，重來時骰子不保證和上一趟一樣（SERIES 第 6 節：撤退放棄整趟進度本身就是代價，所以不像一般的回退那樣固定骰值；
   * dev/adr/0017 M2 修正批 3）。種子不動（種子是這一局的世界：名冊的出場費、NPC、商品庫存都靠它），只有游標換。沒寫是 false：一般的回退固定骰值。
   */
  fresh?: boolean
}

/** 這一回合碰到的觸發點（EVENTS 3.1 的名字）。外殼不做事；事件導演在 turn.end 讀它。 */
export interface ReportTrigger {
  point: string
  where?: Record<string, unknown>
}

/**
 * 玩家送出的一次行動（行動種類的登錄表與任務鏈的輸入）。型別放在 L0 是因為報告要帶它（Report.args）：
 * 功能自己的行動多半在這個形狀上加欄位（對象、禮物、店……），多的欄位原樣留在輸入與報告裡。
 */
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
  /** 這一份報告的經歷只留模糊的殘留（人偶館戴晶片的失憶班：work 寫）；共同記憶、性經歷之類聽 report.after 的功能要不要略過是它們的事 */
  amnesia?: boolean
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
  /**
   * 主動行動的結構化輸入（對象 target、禮物 item、店 shop 等；整份 ActionInput，功能加的欄位都在）。
   * 只有行動的任務鏈做出來的報告帶它（buildActionReport）；`report.before` 與 `report.after` 的掛鉤靠它知道這一次行動是對誰、用什麼做的，
   * 不必再把資料藏進文字裡。
   */
  args?: ActionInput
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
  /** 這份報告提交之後接著開的活動（dev/adr/0016 第二節）：Game 照順序處理，開不成整步不成立 */
  launch?: Launch[]
  /**
   * 這份報告提交之後回到最近一份這個種類的快照（外殼的 Game.rewindToKind）。找不到那種快照，整步不成立（和 launch 開不成同一條）。
   * 不能和 launch 同時寫：launch 之後不會再有 rewind，兩個都寫的報告提交時就擋下。
   */
  rewind?: ReportRewind
  /** 這一回合碰到的觸發點（事件導演讀） */
  triggers?: ReportTrigger[]
  /** 這一份是成人場景（GAME_DESIGN 第 9 節的 adult_scene 記號）：寫正文時走成人路由，其餘規則不因它而不同 */
  adult?: boolean
}

/** 還沒提交的報告：id 與時間由 commitReport 補上。 */
export type ReportDraft = Omit<Report, 'id' | 'time'> & { time?: { start: GameTime; end: GameTime } }
