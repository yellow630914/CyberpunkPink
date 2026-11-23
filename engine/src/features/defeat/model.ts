// L6 功能 defeat 的資料與純函式：戰敗事件的格式、等待中的戰敗（state.ext.defeat）的形狀、存檔規則換算出來的上限。
// 規格：COMBAT_SYSTEM 8.3～8.5 節；ENEMIES 第 6 節；DATA 第 5 節；dev/work/M2-defeat.md。

import type { Change, ContentEntry, Effect, GameState, Origin, VersionId } from '../../core'

export const OWNER = 'defeat'
export const KIND = 'defeat_event'
export const EXT = 'defeat'
export const VERSION_KEYS: readonly VersionId[] = ['default', 'masc', 'yuri']
/** 戰敗事件開在事件視窗的那一種活動。 */
export const EVENT_ACTIVITY = 'event'

export type Raw = Record<string, unknown>

/**
 * 一個版本：text 加 stages（事件的格式，寫法同 M2-event-run），或舊的寫法 effects（M1：只有一段、一個選項）。
 * 也收 options（只有一段的簡寫，同事件）。三種剛好寫一種。
 */
export interface DefeatVersion {
  text: string
  effects?: Effect[]
  stages?: Raw[]
  options?: Raw[]
}

export interface DefeatEventEntry extends ContentEntry {
  name: string
  /** 種類的 id（ENEMIES 第 6 節那張表的 id，或 generic）：只是標籤，引擎不替任何一種寫專屬的程式 */
  kind: string
  factions: string[]
  fails_commission: boolean
  versions: Partial<Record<VersionId, DefeatVersion>>
  default?: boolean
  tags?: string[]
  fallback?: string
  adult?: boolean
  /** 天使急救的那一件：有會員資格（旗標 angel_member）時優先選它 */
  angel?: boolean
  /** 登場角色（同事件的 cast），原樣交給事件視窗 */
  cast?: Raw[]
}

/** 戰敗時多出來的一個選項（別的功能經 defeat.options 掛點給）。選了就套 changes、不進戰敗事件的內容。 */
export interface DefeatOption {
  id: string
  name: string
  /** 給玩家看的說明（完整的句子：會發生什麼） */
  desc: string
  /** 現在選不了的原因（完整的句子，一條一個條件）；空的就是選得了。選不了的照樣列出來：灰掉但看得到 */
  blocks: string[]
  /** 選了之後要套的變更（付錢……）；結算時再加上清掉等待中的戰敗與開打前的快照 */
  changes: Change[]
  /** 結算的敘述，一行一筆 */
  lines: string[]
  /** 報告的摘要 */
  summary: string
}

/** 用哪一條規則選到這一件（見 choose.ts 的順序）。 */
export type PickTier = 'angel' | 'origin' | 'enemy' | 'faction' | 'generic'

/** 等待的步驟：ask 先問（要不要看、或別的選項）、playing 事件正在演、played 事件做完（或不演），可以三選一。 */
export type DefeatStage = 'ask' | 'playing' | 'played'

/** 事件做完的結果（事件視窗的 activity.end）。 */
export interface PlayedResult {
  /** 最後做的那個選項（自由回應是 free） */
  option: string
  /** 每個選項帶的旗標（照順序；chain 帶出來的第二件接在後面） */
  flags: string[]
  degree?: string
  /** chain 帶出來的第二件的選項 */
  chained?: string
}

export interface PendingDefeat {
  /** 戰敗事件的 id */
  event: string
  version: 'default' | 'masc' | 'yuri'
  /** 贏的那一方的勢力 */
  faction?: string
  outcome: 'lose' | 'surrender'
  /** 算不算委託失敗：事件預設的，被選項的旗標（no_fail、fail）蓋掉之後是現在的 */
  fails_commission: boolean
  /** 接受的話會發生什麼（不演版），一行一筆（白話） */
  lines: string[]
  choices: ['accept', 'retry', 'stage']
  /** 存檔規則當時的設定 */
  view: 'always' | 'skippable' | 'never'
  /** 走不演版：沒有事件視窗可用、設定是不看、選了不看，或事件開不起來。事件真的演了是 false */
  skipped: boolean
  /** 那一場戰鬥的 id */
  battle: string
  /** 現在在哪一步；M1 存的沒有這個欄位，當成 played */
  stage?: DefeatStage
  /** 怎麼選到的 */
  tier?: PickTier
  /** 那一場戰鬥的發起人（activity.end 的 origin） */
  origin?: Origin
  /** 事件做完的結果 */
  played?: PlayedResult
}

export const isRec = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function defeatOf(state: Pick<GameState, 'ext'>): PendingDefeat | null {
  const d = state.ext[EXT]
  return isRec(d) && typeof d.event === 'string' ? (d as unknown as PendingDefeat) : null
}

export const stageOf = (p: PendingDefeat): DefeatStage => p.stage ?? 'played'

// ---- 內容的格式 ----

export function entryProblems(e: Raw): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.kind)) p.push('kind 要是種類的 id（字串）')
  if (!(Array.isArray(e.factions) && e.factions.every(isText))) p.push('factions 要是勢力 id 的陣列（可以是空的）')
  if (typeof e.fails_commission !== 'boolean') p.push('fails_commission 要是 true 或 false')
  const v = e.versions
  if (!isRec(v)) p.push('versions 要是物件，鍵只能是 default、masc、yuri')
  else {
    const keys = Object.keys(v)
    if (keys.length === 0) p.push('versions 至少要寫一個版本（default、masc、yuri）')
    for (const key of keys) {
      const at = `versions.${key}`
      if (!(VERSION_KEYS as readonly string[]).includes(key)) { p.push(`versions 的鍵只能是 default、masc、yuri（拿到 ${key}）`); continue }
      const one = v[key]
      if (!isRec(one)) { p.push(`${at} 要是 { text, effects }（舊寫法）或 { text, stages }（事件的寫法）`); continue }
      if (!isText(one.text)) p.push(`${at}.text 要是一段敘事`)
      const shapes = ['effects', 'stages', 'options'].filter((f) => one[f] !== undefined)
      if (shapes.length > 1) p.push(`${at}：effects（舊寫法）、stages、options 只能寫一種`)
      else if (one.stages !== undefined) {
        if (!(Array.isArray(one.stages) && one.stages.length > 0 && one.stages.every(isRec))) p.push(`${at}.stages 要是一段一段（物件）的陣列，至少一段`)
      } else if (one.options !== undefined) {
        if (!(Array.isArray(one.options) && one.options.length > 0 && one.options.every(isRec))) p.push(`${at}.options 要是選項（物件）的陣列，至少一個`)
      } else if (!(Array.isArray(one.effects) && one.effects.every(isRec))) p.push(`${at}.effects 要是效果（物件）的陣列（或改寫成事件的 stages）`)
    }
  }
  if (e.default !== undefined && typeof e.default !== 'boolean') p.push('default 要是 true 或 false')
  if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every(isText))) p.push('tags 要是字串的陣列')
  if (e.fallback !== undefined && !isText(e.fallback)) p.push('fallback 要是戰敗事件的 id')
  if (e.adult !== undefined && typeof e.adult !== 'boolean') p.push('adult 要是 true 或 false')
  if (e.angel !== undefined && typeof e.angel !== 'boolean') p.push('angel 要是 true 或 false')
  if (e.cast !== undefined && !(Array.isArray(e.cast) && e.cast.every(isRec))) p.push('cast 要是登場角色（物件）的陣列')
  return p
}

// ---- 存檔規則換算出來的上限 ----

/** 戰敗扣錢最多扣多少（COMBAT_SYSTEM 8.3 節第三個設定）：min(floor(身上現金 × 比例), 金額上限)。 */
export function moneyLimit(state: Pick<GameState, 'money' | 'rules'>): number {
  return Math.max(0, Math.min(Math.floor(state.money.cash * state.rules.defeatMoneyLoss), state.rules.defeatMoneyCap ?? Infinity))
}
