// L0 型別：遊戲狀態的骨架。功能自己的狀態放在 ext[功能 id]，形狀由功能定義；核心不認得裡面的東西。

import type { BattleState } from './battle'
import type { MapsState } from './grid'
import type { ActorId, AttrId, SkillId } from './ids'
import type { Report, ReportLocation } from './report'
import type { GameTime } from './time'

/**
 * 狀態的版本。第 2 版（M1）：多了 battle（進行中的戰鬥）、maps（格子地圖的實例與位置）、snapshots（快照），
 * 存檔規則多了敵人的係數（enemyCoef）、戰敗扣錢的金額上限（defeatMoneyCap）、重創要不要留傷勢（heavyWounds）。
 * 第 3 版（M2）：多了 meters（量表：照對象分開記、有範圍的數字；dev/adr/0016 第三節）。
 */
export const STATE_VERSION = 3

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

/** 敵人的一組係數：生命、傷害、感載上限（普通都是 1）。 */
export interface EnemyCoef {
  hp: number
  dmg: number
  load: number
}
export interface EnemyCoefTable {
  boss: EnemyCoef
  /** 雜兵與精英：低（I～II）、中（III）、高（IV～V） */
  minions: [EnemyCoef, EnemyCoef, EnemyCoef]
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
  /**
   * 敵人的係數（BALANCE 7.2 節）：乘在敵人的生命、傷害、感載上限上。預設的五個難度照表；自訂時每一格 0.25～5。
   * 首領一組；雜兵與精英照敵人的等級分三段：低（I～II）、中（III）、高（IV～V）
   */
  enemyCoef: EnemyCoefTable
  /** 戰敗的三個設定（COMBAT_SYSTEM 8.3 節） */
  defeatView: 'always' | 'skippable' | 'never'
  defeatTakeGear: boolean
  /** 戰敗最多扣身上現金的多少（0～1）；預設 1：照事件，最多 100% */
  defeatMoneyLoss: number
  /** 戰敗扣錢的金額上限；null 是不另外設上限 */
  defeatMoneyCap: number | null
  /** 重創重的那一級（要治療的傷勢）留不留；關掉時只留戰鬥中的狀態（COMBAT_SYSTEM 第 6 節） */
  heavyWounds: boolean
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

/**
 * 一份快照：某一刻的整份狀態（存檔的文字），之後可以回到那一刻而保留紀錄（SERIES 第 6 節；COMBAT_SYSTEM 8.4 節）。
 * 進委託副本的入口、每個階段開始時、每場戰鬥開打前各存一份。快照跟著存檔走；快照裡不再包快照（存的那一份 snapshots 是空的）。
 */
export interface SnapshotSlot {
  /** s1、s2…… */
  id: string
  /** battle（戰鬥開打前）、stage（階段開始時）、entry（進入口時）；功能可以用自己的種類 */
  kind: string
  /** 給玩家看的名字 */
  label: string
  /** Game.save 那種存檔的文字 */
  raw: string
  /** 存的那一刻要怎麼重來（戰鬥：開打的設定），由發起的功能定義 */
  data?: Record<string, unknown>
  /**
   * 誰存的（功能自己決定：委託的 id、功能的 id；dev/adr/0016 第二節）。`snapshot.take` 的 `replace` 只換同一個 owner、同一種的舊快照。
   * 沒有 owner 的快照（戰鬥開打前、`snapshot.add` 存的）互相算同一個 owner。
   */
  owner?: string
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
  /** 進行中的戰鬥；沒有在打是 null。現實與內海的戰鬥不同場，同時只有一場 */
  battle: BattleState | null
  /** 格子地圖：開著的實例與現在站的位置 */
  maps: MapsState
  /** 快照：回到那一刻用的（撤退、戰敗後重來）。照存的順序 */
  snapshots: SnapshotSlot[]
  /**
   * 量表（dev/adr/0016 第三節）：照種類、再照對象（勢力、人、區、地圖實例、`_`）分開記的有範圍的數字。
   * 只記寫過的鍵：沒寫過的讀出來是那張量表的起始值（`meterOf`）。範圍、夾值、自動註冊的效果與條件由量表的定義（`k.meters.define`）管；
   * 沒有人定義的種類（那個功能這一局沒裝）也照樣留在存檔裡。只經由 `meter` 變更改。
   */
  meters: Record<string, Record<string, number>>
  /** 流水號 */
  seq: { report: number; chain: number; uid: number; floor: number }
  /** 功能自己的狀態，鍵是功能 id */
  ext: Record<string, unknown>
}
