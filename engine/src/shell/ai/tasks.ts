// L7 外殼：AI 任務。一個任務只做一件事：自己的請求、輸出格式、驗證與退路（AI_TASKS 第 1 節第 2、5 條）。
// runTask 是所有任務共用的管線：排隊（同時最多 3 個）→ 送出 → 逾時與取消 → 解析 → 驗證與夾值 →
// 失敗時照分類自動重試（把上一次的錯誤放進 <previous_error>）→ 都失敗就等玩家或走退路。

import type { ClampNote } from '../../core/types'
import type { Probe } from '../../core/state/probe'
import type { AiErrorKind, AiRequest, Limiter, Provider, TokenUsage } from './provider'
import { AiError } from './provider'
import type { AiSettings, ProviderHub } from './settings'
import { retriesFor } from './settings'

/** 逾時：閒置 3 分鐘（收到文字、思考或工具呼叫就重設）。所有任務一致（AI_TASKS 2.6 節）。 */
export const IDLE_TIMEOUT_MS = 180_000

export interface TaskCtx {
  settings: AiSettings
  chain?: string
  step?: string
  /** 走成人路由 */
  adult?: boolean
}

export interface TaskPrompt {
  /** 固定前段（規則）。提示詞的內容在 PROMPTS，之後從資料載入 */
  system: string
  /** 請求的每一段：[標籤, 內容]，照順序排成 <標籤>…</標籤> */
  sections: Array<[tag: string, body: string]>
}

export type TaskCheck<O> =
  | { ok: true; value: O; clamps?: ClampNote[]; /** 附加的記號，例如 uncovered（沒寫到） */ marks?: string[] }
  | { ok: false; errors: string[] }

export interface TaskDef<I = unknown, O = unknown> {
  id: string
  owner: string
  /** 模型大小：大＝寫長文、中＝判斷要看情境、小＝格式固定 */
  size: 'L' | 'M' | 'S'
  output: 'json' | 'text'
  /** 結構化輸出的格式 */
  schema?: { name: string; schema: Record<string, unknown> }
  /** 自動重試都失敗之後：wait 停下來等玩家（判定與寫正文），fallback 自動用規則代替（其他任務） */
  onExhausted: 'wait' | 'fallback'
  build(input: I, ctx: TaskCtx): TaskPrompt
  /** 驗證與夾值。raw 是解析過的 JSON（output 是 json）或整段文字。errors 引用欄位的路徑，重試時原樣帶回去 */
  check(raw: unknown, input: I, ctx: TaskCtx): TaskCheck<O>
  /** 不用 AI 的退路：照規則結算 */
  fallback(input: I, ctx: TaskCtx): O
}

export class TaskRegistry {
  private defs = new Map<string, TaskDef>()

  constructor(private probe: Probe) {}

  register<I, O>(def: TaskDef<I, O>): void {
    if (this.defs.has(def.id)) throw new Error(`AI 任務重複註冊：${def.id}（已經由 ${this.defs.get(def.id)!.owner} 註冊）`)
    this.defs.set(def.id, def as unknown as TaskDef)
    this.probe.emit('shell/ai/tasks', 'registry.register', { registry: 'tasks', id: def.id, owner: def.owner })
  }

  get(id: string): TaskDef | undefined {
    return this.defs.get(id)
  }

  ids(): string[] {
    return [...this.defs.keys()]
  }
}

export interface AttemptLog {
  n: number
  model: string
  start: number
  end: number
  usage?: TokenUsage
  /** 送出去的請求（使用者那一段；固定前段不重複存） */
  prompt: string
  /** 原始的回應 */
  raw: string
  error?: { kind: AiErrorKind; message: string; details: string[] }
}

export interface TaskOutcome<O = unknown> {
  /** done：AI 交出、驗證通過；fallback：用了退路；failed：失敗，等玩家重試或改用規則 */
  status: 'done' | 'fallback' | 'failed'
  value?: O
  clamps: ClampNote[]
  marks: string[]
  attempts: AttemptLog[]
  error?: { kind: AiErrorKind; message: string; details: string[] }
  model?: string
}

export interface TaskEnv {
  hub: ProviderHub
  limiter: Limiter
  probe: Probe
  /** 時鐘（毫秒）。測試給固定的，結果才可重現 */
  now(): number
  idleTimeoutMs: number
}

export interface RunTaskOpts {
  signal?: AbortSignal
  /** 這個任務的開關關著，或玩家按了「用規則代替」：不問 AI，直接走退路 */
  forceFallback?: boolean
  /** 手動重試時帶進去的錯誤（上一次的錯誤、被夾掉的值、漏寫的那幾行） */
  previousError?: string[]
}

export function renderPrompt(prompt: TaskPrompt, previousError: string[] = []): string {
  const parts = prompt.sections.map(([tag, body]) => `<${tag}>\n${body}\n</${tag}>`)
  // 只帶錯誤，不帶上一次的整份輸出，避免 AI 照抄（AI_TASKS 5.3 節）
  if (previousError.length) parts.push(`<previous_error>\n${previousError.join('\n')}\n</previous_error>`)
  return parts.join('\n\n')
}

/** 從回應裡取出 JSON：去掉程式碼框，取第一個 { 到最後一個 }。 */
export function parseJsonLoose(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new AiError('format', '回應不是 JSON', ['(root)：期望一個 JSON 物件'])
  try {
    return JSON.parse(t.slice(a, b + 1))
  } catch (e) {
    throw new AiError('format', '回應的 JSON 讀不出來', [`(root)：${(e as Error).message}`])
  }
}

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(['timeout', 'network', 'format', 'validation'])

async function collect(provider: Provider, req: AiRequest, env: TaskEnv, signal?: AbortSignal): Promise<{ text: string; stop: string; usage?: TokenUsage }> {
  const ac = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: (e: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  aborted.catch(() => {})
  const fail = () => rejectAbort(new AiError(timedOut ? 'timeout' : 'cancel', timedOut ? `閒置超過 ${Math.round(env.idleTimeoutMs / 1000)} 秒` : '取消'))
  const onOuterAbort = () => { ac.abort(); fail() }
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timedOut = true; ac.abort(); fail() }, env.idleTimeoutMs)
  }
  if (signal?.aborted) throw new AiError('cancel', '取消')
  signal?.addEventListener('abort', onOuterAbort)
  try {
    arm()
    const it = provider.request(req, ac.signal)[Symbol.asyncIterator]()
    let text = ''
    for (;;) {
      const next = await Promise.race([it.next(), aborted])
      if (next.done) throw new AiError('network', '串流中斷：沒有收到結束的事件')
      arm()
      const ev = next.value
      if (ev.type === 'text') text += ev.text
      else if (ev.type === 'done') return { text, stop: ev.stop, usage: ev.usage }
    }
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

/** 跑一個任務。永遠不丟錯：結果用 status 表示。 */
export async function runTask<I, O>(env: TaskEnv, def: TaskDef<I, O>, input: I, ctx: TaskCtx, opts: RunTaskOpts = {}): Promise<TaskOutcome<O>> {
  const out: TaskOutcome<O> = { status: 'failed', clamps: [], marks: [], attempts: [] }
  const provider = opts.forceFallback ? null : env.hub.resolve(ctx.settings, def.id)
  if (!provider) return { ...out, status: 'fallback', value: def.fallback(input, ctx) }

  out.model = `${provider.source.provider}/${provider.source.model}`
  const prompt = def.build(input, ctx)
  const maxAttempts = 1 + retriesFor(ctx.settings, def.id)
  let previousError = [...(opts.previousError ?? [])]

  for (let n = 1; n <= maxAttempts; n++) {
    const user = renderPrompt(prompt, previousError)
    const req: AiRequest = {
      task: def.id, system: prompt.system, messages: [{ role: 'user', content: user }],
      ...(def.schema ? { schema: def.schema } : {}), ...(ctx.adult ? { adult: true } : {}),
      meta: { chain: ctx.chain, step: ctx.step, attempt: n },
    }
    const log: AttemptLog = { n, model: out.model, start: 0, end: 0, prompt: user, raw: '' }
    try {
      const res = await env.limiter.run(async () => {
        log.start = env.now()
        try {
          return await collect(provider, req, env, opts.signal)
        } finally {
          log.end = env.now()
        }
      })
      log.raw = res.text
      log.usage = res.usage
      if (res.stop === 'refusal') throw new AiError('refusal', '服務商拒絕了這次請求')
      const raw = def.output === 'json' ? parseJsonLoose(res.text) : res.text
      const checked = def.check(raw, input, ctx)
      if (!checked.ok) throw new AiError('validation', '驗證不過', checked.errors)
      out.attempts.push(log)
      env.probe.emit('shell/ai/tasks', 'task.done', () => ({ task: def.id, attempt: n, clamps: checked.clamps ?? [], marks: checked.marks ?? [] }))
      return { ...out, status: 'done', value: checked.value, clamps: checked.clamps ?? [], marks: checked.marks ?? [] }
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError('network', (e as Error)?.message ?? String(e))
      log.error = { kind: err.kind, message: err.message, details: err.details }
      if (!log.end) log.end = env.now()
      out.attempts.push(log)
      out.error = log.error
      env.probe.emit('shell/ai/tasks', 'task.error', () => ({ task: def.id, attempt: n, error: log.error }))
      // 被拒絕的不自動重試、不換備用模型；取消也不重試
      if (!RETRYABLE.has(err.kind)) return out
      // 帶進下一次請求的只有格式與驗證的錯誤；逾時與網路錯誤沒有東西可以讓 AI 改
      if (err.kind === 'format' || err.kind === 'validation') previousError = err.details.length ? err.details : [err.message]
    }
  }
  // 自動重試都失敗：判定與寫正文停下來等玩家，其他任務自動用規則代替
  if (def.onExhausted === 'fallback') return { ...out, status: 'fallback', value: def.fallback(input, ctx) }
  return out
}
