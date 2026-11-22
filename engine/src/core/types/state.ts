// L0 型別：遊戲狀態的骨架。功能自己的狀態放在 ext[功能 id]，形狀由功能定義；核心不認得裡面的東西。

import type { ActorId, AttrId, SkillId } from './ids'
import type { Report, ReportLocation } from './report'
import type { GameTime } from './time'

export const STATE_VERSION = 1

/** 亂數狀態：種子與游標。每一次要擲骰，從（種子、游標、用途、重擲次數）導出一顆骰子的種子。 */
export interface RngState {
  seed: number
  /** 已經用掉幾次（每條任務鏈套用時加一） */
  cursor: number
}

/** 兩種錢（LIFE 1.1 節）：帳上的信用點與現金晶片。 */
export interface Money {
  cred: number
  cash: number
}

export interface ItemStack {
  /** 物品定義的 id（穩定編號，不用名字當鍵） */
  id: string
  qty: number
  /** 實例的資料（零件、染色……），由功能定義 */
  data?: Record<string, unknown>
}

export type FlagValue = boolean | number | string

/**
 * 角色的骨架：主角、夥伴、NPC 共用。這裡只放檢定與報告要讀的最小欄位，
 * 其餘（橋參數、義體、外觀、關係……）在 ext，由各功能定義。
 */
export interface Actor {
  id: ActorId
  name: string
  role: 'pc' | 'companion' | 'npc'
  /** 所有角色 18 歲以上：低於 18 的寫入一律擋下 */
  age: number
  gender?: string
  /** 基礎屬性；檢定讀的是有效屬性（rules/stats） */
  attrs: Record<AttrId, number>
  /** 基本功等級 0～6 */
  skills: Record<SkillId, number>
  /** 特質與缺陷的 id */
  perks: string[]
  hp: number
  /** 感載 */
  load: number
  /** 餘韻的層數 */
  afterglow: number
  /** 沉溺 */
  sink: number
  /** 暫時的狀態（EVENTS 2.4.1 節）：id 與到期的時間（總分鐘數；沒有就是不會自己消退） */
  conditions: Array<{ id: string; until?: number }>
  ext: Record<string, unknown>
}

/** 存檔規則（MIGRATION A「存檔規則」、BALANCE 第 7 節、CHARACTER 5.6 節）。 */
export interface SaveRules {
  difficulty: 'story' | 'easy' | 'normal' | 'hard' | 'legend' | 'custom'
  /** 檢定 DC 的偏移：預設的五個難度是 −2～+2，自訂 −4～+4 */
  dcOffset: number
  /** 關閉快速移動 */
  fastTravel: boolean
  /** 每週帳單的倍率 ×0～2 */
  billMult: number
  /** 戰敗的三個設定 */
  defeatView: 'always' | 'skippable' | 'never'
  defeatTakeGear: boolean
  defeatMoneyLoss: number
  /** 名冊 NPC 會死 */
  rosterDeath: boolean
  /** 歷練倍率 0.5～2 */
  xpMult: number
  /** 建角的數字（CHARACTER 5.6 節） */
  startXp: number
  startSkillPoints: number
  startSkillMax: number
  startPerkPoints: number
  startCyberPoints: number
  startMoney: number
  /**
   * 內容篩選（LEWD_SYSTEM 第 9 節；UI 第 15 節：跟著存檔走）：玩家關掉的標籤。沒有列在這裡的都是開著。
   * 標籤的 id 照 DATA 第 1 節的 tags；「身體的私密描寫」是 CONTENT_TAG_INTIMATE_BODY。
   */
  contentOff: string[]
}

/** 一條任務鏈留在存檔裡的細節（AI_TASKS 5.5 節：只留最近五樓）。內容的形狀由 L7 的任務鏈引擎定義。 */
export interface ChainRecordSlot {
  id: string
  /** 第幾樓（一段正文是一樓） */
  floor: number
  /** 已清理：只剩結果 */
  cleaned?: boolean
  detail?: unknown
}

export interface GameState {
  version: number
  rng: RngState
  time: GameTime
  money: Money
  location: ReportLocation
  /** 主角的 id；還沒建角時是 null */
  pc: ActorId | null
  actors: Record<ActorId, Actor>
  /** 隊伍：含主角 */
  party: ActorId[]
  inventory: ItemStack[]
  flags: Record<string, FlagValue>
  counters: Record<string, number>
  rules: SaveRules
  /** 紀錄：提交過的報告，照時間順序 */
  reports: Report[]
  /** 任務鏈的細節 */
  chains: ChainRecordSlot[]
  /** 流水號 */
  seq: { report: number; chain: number; uid: number; floor: number }
  /** 功能自己的狀態，鍵是功能 id */
  ext: Record<string, unknown>
}
