// L7 外殼：AI 服務商的介面（AI_TASKS 第 8 節）。真的服務商（Anthropic、OpenAI、相容 OpenAI 的服務、Gemini、Vertex）
// 與假的服務商實作同一個介面。M0 只有假的；真的服務商之後註冊到 ProviderHub.factories。
// 引擎不碰瀏覽器 API：金鑰、來源的設定由外面（ui 的 store）讀好傳進來。

export type ProviderId = 'anthropic' | 'openai' | 'openai_compatible' | 'gemini' | 'vertex' | 'fake'

/** 一個模型來源（設定頁裡的「主力」「便宜的小模型」「成人路由」各是一個）。 */
export interface ProviderSource {
  /** 來源的名字，設定裡每個任務指到它 */
  name: string
  provider: ProviderId
  model: string
  apiKey?: string
  baseUrl?: string
  maxTokens?: number
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** 多輪訊息。blocks 原樣保留服務商的區塊（Anthropic 的思考區塊在多輪之間要帶回去）。 */
export interface AiMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  blocks?: unknown[]
}

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema */
  parameters: Record<string, unknown>
}

export interface AiRequest {
  /** 任務的 id（judge、narrate、reward……） */
  task: string
  /** 固定前段：規則、工具定義、常駐的世界書。放在前面讓快取命中 */
  system: string
  messages: AiMessage[]
  /** 結構化輸出的格式；服務商不支援時改成「只回 JSON」的提示加程式解析，用同一套驗證 */
  schema?: { name: string; schema: Record<string, unknown> }
  /** 只在 Agent 模式有 */
  tools?: ToolDef[]
  /** 走成人路由 */
  adult?: boolean
  meta: { chain?: string; step?: string; attempt: number }
}

/** 串流是事件流：文字、思考、工具呼叫、工具結果、結束。 */
export type AiEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'done'; stop: 'end' | 'refusal' | 'max_tokens'; usage?: TokenUsage }

/** 錯誤的分類；自動重試看這個決定要不要重試（AI_TASKS 第 8 節）。 */
export type AiErrorKind = 'timeout' | 'network' | 'format' | 'validation' | 'refusal' | 'cancel'

export class AiError extends Error {
  constructor(public readonly kind: AiErrorKind, message: string, public readonly details: string[] = []) {
    super(message)
    this.name = 'AiError'
  }
}

export interface Provider {
  source: ProviderSource
  supports: { structured: boolean; tools: boolean }
  /** 送出一次請求。逾時、取消、網路錯誤用 AiError 丟出；被拒絕是 done 事件的 stop: 'refusal'。 */
  request(req: AiRequest, signal: AbortSignal): AsyncIterable<AiEvent>
}

export type ProviderFactory = (source: ProviderSource) => Provider

/** 同時跑的請求數上限（AI_TASKS 2.2、第 8 節）。 */
export const MAX_CONCURRENT_REQUESTS = 3

/** 排隊：同時最多 max 個在跑，超過的等前面的結束。 */
export class Limiter {
  private running = 0
  private queue: Array<() => void> = []
  /** 觀察用：到目前為止同時跑過最多幾個 */
  peak = 0

  constructor(public readonly max = MAX_CONCURRENT_REQUESTS) {}

  get active(): number {
    return this.running
  }

  get waiting(): number {
    return this.queue.length
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve))
    this.running++
    this.peak = Math.max(this.peak, this.running)
    try {
      return await fn()
    } finally {
      this.running--
      this.queue.shift()?.()
    }
  }
}
