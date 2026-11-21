// L7 外殼：AI 的設定。形狀沿用介面那邊 localStorage 鍵 cpp-ai-v1 的物件（docs/mockups/settings.html 的 AI0），
// 所以 ui 的 store 把讀到的物件原樣傳進來就行。引擎只收設定物件，不碰 localStorage。
// 這是這台機器的偏好，所有存檔共用，不進存檔（AI_TASKS 2.5 節）。

import type { ProviderFactory, ProviderSource, Provider } from './provider'
import { bool, clamp, int, isRecord } from '../../core/util/sanitize'

export interface AiSettings {
  /** 總開關：關掉時每一步都走程式的退路 */
  ai: boolean
  /** 自由行動的判定 */
  judge_free: boolean
  /** 打工的一班 */
  judge_work: boolean
  /** 事件的「我要做別的」 */
  judge_other: boolean
  /** 玩家要求的結果也夾值（預設開） */
  clamp_asked: boolean
  /** 敘事：所有的正文 */
  narrate: boolean
  trade_text: boolean
  combat_text: boolean
  /** 哪幾種鏈開了潤色，鍵是鏈的代號（free、move、trade……） */
  polish: Record<string, boolean>
  sexrec: boolean
  bg_flavor_shop: boolean
  bg_flavor_roster: boolean
  bg_npc_news: boolean
  bg_stream_goal: boolean
  bg_stream_chat: boolean
  bg_footage_caption: boolean
  /** Agent 模式 */
  agent: boolean
  query_only: boolean
  hook_text: boolean
  hook_block: boolean
  hook_night: boolean
  hook_comm: boolean
  hook_shop: boolean
  lim_hook: number
  lim_visit: number
  lim_event: number
  lim_night: number
  lim_comm: number
  lim_shop: number
  /** 任務鏈列：0 出錯時展開、1 一直展開、2 隱藏 */
  chainbar: number
  /** 每個任務出錯時自動重試的次數（0～3，預設 1），鍵是任務 id */
  retry: Record<string, number>
  /** 每個任務用哪個來源，鍵是任務 id，值是來源的名字 */
  src: Record<string, string>
  /** 每個任務的備用來源 */
  fb: Record<string, string>
  /** 成人路由的來源，鍵是 narrate_adult、scene、aftercare…… */
  adult: Record<string, string>
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  ai: true, judge_free: true, judge_work: true, judge_other: true, clamp_asked: true, narrate: true, trade_text: true, combat_text: false,
  polish: {}, sexrec: true,
  bg_flavor_shop: true, bg_flavor_roster: true, bg_npc_news: true, bg_stream_goal: true, bg_stream_chat: true, bg_footage_caption: true,
  agent: false, query_only: false, hook_text: true, hook_block: true, hook_night: true, hook_comm: true, hook_shop: true,
  lim_hook: 1, lim_visit: 10, lim_event: 3, lim_night: 10, lim_comm: 10, lim_shop: 10, chainbar: 0,
  retry: {}, src: {}, fb: {}, adult: {},
}

/** 沒有另外指定時，每個任務用哪個來源（mockups 的 SRC0）。 */
export const DEFAULT_TASK_SOURCE: Record<string, string> = { judge: '主力', narrate: '主力', reward: '便宜的小模型', relate: '便宜的小模型', flavor_shop: '便宜的小模型' }
export const DEFAULT_SOURCE_NAME = '主力'
export const RETRY_DEFAULT = 1
export const RETRY_MAX = 3

const record = <T>(v: unknown, pick: (x: unknown) => T | undefined): Record<string, T> => {
  const out: Record<string, T> = {}
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) { const y = pick(x); if (y !== undefined) out[k] = y }
  return out
}

/** 把外面傳進來的設定清乾淨。開關收布林，也收 0／1（cpp-ai-v1 存的是 0／1）；缺的補預設值。 */
export function sanitizeAiSettings(raw: unknown): AiSettings {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_AI_SETTINGS
  const out = { ...d } as unknown as Record<string, unknown>
  for (const [k, dv] of Object.entries(d)) {
    if (typeof dv === 'boolean') out[k] = bool(r[k], dv)
    else if (typeof dv === 'number') out[k] = Math.max(0, int(r[k], dv))
  }
  out.polish = record(r.polish, (x) => (x === true || x === 1 ? true : x === false || x === 0 ? false : undefined))
  out.retry = record(r.retry, (x) => (typeof x === 'number' && Number.isFinite(x) ? clamp(Math.round(x), 0, RETRY_MAX) : undefined))
  for (const k of ['src', 'fb', 'adult'] as const) out[k] = record(r[k], (x) => (typeof x === 'string' && x ? x : undefined))
  return out as unknown as AiSettings
}

export function retriesFor(settings: AiSettings, task: string): number {
  return settings.retry[task] ?? RETRY_DEFAULT
}

/**
 * 服務商的總管：照設定替每個任務找出要用的服務商。
 * - 總開關關著：一律沒有（走退路）。
 * - 任務指到的來源有金鑰、而且那一家的服務商已經接上（factories 裡有）：用真的。
 * - 否則用假的服務商（有給的話）；沒給就沒有（走退路）。
 */
export class ProviderHub {
  /** 真的服務商：照 provider id 註冊。M0 是空的 */
  readonly factories: Partial<Record<string, ProviderFactory>> = {}
  private cache = new Map<string, Provider>()

  constructor(public sources: Record<string, ProviderSource> = {}, public fake: Provider | null = null) {}

  sourceNameFor(settings: AiSettings, task: string): string {
    return settings.src[task] ?? DEFAULT_TASK_SOURCE[task] ?? DEFAULT_SOURCE_NAME
  }

  resolve(settings: AiSettings, task: string): Provider | null {
    if (!settings.ai) return null
    const source = this.sources[this.sourceNameFor(settings, task)]
    const factory = source ? this.factories[source.provider] : undefined
    if (source?.apiKey && factory) {
      const key = `${source.name}/${source.provider}/${source.model}`
      if (!this.cache.has(key)) this.cache.set(key, factory(source))
      return this.cache.get(key)!
    }
    return this.fake
  }
}
