// L7 外殼：假的 AI 服務商（dev/test-harness.md 第 3 節）。和真的服務商同一個介面。
//
// - 劇本模式：照測試給的回應依序回傳（可以分任務各一串）。
// - 自動模式：劇本用完（或沒有劇本）時，照請求裡的 <input> 自己回一份合格的回應。介面在沒有金鑰時就接這個。
// - 對抗模式：adversarial() 把一份合格的回應弄壞：壞掉的 JSON、超出上限的數值、不存在的 id、少欄位、多欄位、
//   拒絕、逾時、串流中斷、asked 對不上、少交 <covered>。
// - 記錄每一次收到的請求，讓測試檢查請求裡有沒有 <results>、<previous_error> 等。

import type { AiEvent, AiRequest, Provider, ProviderSource } from './provider'
import { AiError } from './provider'

export interface FakeReply {
  /** 回應的文字（寫正文）；json 與 text 擇一 */
  text?: string
  /** 結構化的回應；會被轉成 JSON 文字送出 */
  json?: unknown
  /** 被服務商拒絕 */
  refusal?: boolean
  /** 永遠不回（測逾時與取消） */
  hang?: boolean
  /** 串流到一半就斷：送出前幾個字之後不送結束的事件 */
  breakAfter?: number
  /** 網路錯誤 */
  networkError?: string
  /** 送出前先等幾毫秒（測同時跑的上限） */
  delayMs?: number
}

export type FakeScriptEntry = FakeReply | ((req: AiRequest) => FakeReply)

export const ADVERSARIAL_MODES = ['bad_json', 'over_cap', 'unknown_id', 'missing_field', 'extra_field', 'refusal', 'timeout', 'stream_break', 'asked_mismatch', 'no_covered'] as const
export type AdversarialMode = (typeof ADVERSARIAL_MODES)[number]

/** 從請求裡取出某一段。 */
export function sectionOf(req: AiRequest, tag: string): string | null {
  const user = req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  const m = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(user)
  return m ? m[1]! : null
}

/** 請求裡機器讀的那一段 <input>。 */
export function inputOf<T = Record<string, unknown>>(req: AiRequest): T {
  const raw = sectionOf(req, 'input')
  return (raw ? JSON.parse(raw) : {}) as T
}

/**
 * 假的正文的第一句：「誰做了什麼，結果如何。」每一條鏈交給寫正文的報告欄位不一樣（NarrateInput.report）：
 * 自由行動有 actor、action、degree；戰鬥結束有 action 與 result（勝利、戰敗……），沒有 actor 與 degree。
 * 有什麼寫什麼，沒有的略過，不把 undefined 寫進正文。
 */
export function fakeHeadline(report: unknown): string {
  const r = (report && typeof report === 'object' ? report : {}) as Record<string, unknown>
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const what = `${text(r.actor)}${text(r.action)}`
  const how = text(r.degree) || text(r.result) || text(r.outcome)
  const line = [what, how].filter((x) => x !== '').join('，')
  return line ? `${line}。` : ''
}

/** 自動模式：每個任務一份合格的回應。 */
export function goodReply(req: AiRequest): FakeReply {
  const input = inputOf<Record<string, any>>(req)
  switch (req.task) {
    case 'judge':
      return { json: { degree: input.roll.degree, attr: input.roll.attr, ...(input.roll.skill ? { skill: input.roll.skill } : {}), dc: input.ref_dc, reason: '照骰子與情境判斷。', twist: '', minutes: input.minutes, new_person: false } }
    case 'reward':
      return { json: { items: (input.hint as Array<Record<string, unknown>>).map((e) => ({ ...e, from: { source: 'degree' } })) } }
    case 'narrate':
    case 'polish': {
      const results = (input.results as string[]) ?? []
      const body = req.task === 'polish' ? String(input.text) : `（假的服務商）${fakeHeadline(input.report)}${results.join('，')}`
      return { text: `${body}\n<covered>${results.map((_, i) => i + 1).join(',')}</covered>` }
    }
    default:
      return { json: {} }
  }
}

/** 把一份合格的回應弄壞。不適用於這個任務的模式回傳原樣的合格回應。 */
export function adversarial(mode: AdversarialMode, req: AiRequest): FakeReply {
  const good = goodReply(req)
  const j = good.json as Record<string, any> | undefined
  switch (mode) {
    case 'bad_json':
      return j ? { text: '{"degree": "success", "reason": "少了結尾' } : { text: '' }
    case 'refusal':
      return { refusal: true }
    case 'timeout':
      return { hang: true }
    case 'stream_break':
      return { ...good, breakAfter: 5 }
    case 'no_covered':
      return good.text !== undefined ? { text: good.text.replace(/\n?<covered>[\s\S]*$/, '') } : good
    case 'missing_field':
      if (req.task === 'judge') { const { degree: _d, ...rest } = j!; return { json: rest } }
      if (req.task === 'reward') return { json: { items: [{ kind: 'cash', amount: 5 }] } }
      return good
    case 'extra_field':
      return j ? { json: { ...j, status_bar: 'HP 999', __proto_note: '多出來的欄位' } } : good
    case 'over_cap':
      if (req.task === 'judge') return { json: { ...j, dc: 99, minutes: 99999, degree: 'critical' } }
      if (req.task === 'reward') return { json: { items: [{ kind: 'cash', amount: 99999999, from: { source: 'degree' } }] } }
      return good
    case 'unknown_id':
      if (req.task === 'judge') return { json: { ...j, skill: 'no_such_skill', attr: 'luck' } }
      if (req.task === 'reward') return { json: { items: [{ kind: 'no_such_effect', amount: 1, from: { source: 'degree' } }, { kind: 'item', id: 'it_no_such_thing', qty: 1, from: { source: 'degree' } }] } }
      return good
    case 'asked_mismatch':
      if (req.task === 'judge') return { json: { ...j, degree: 'critical', dc: 2, asked: '玩家沒有說過的一句話' } }
      if (req.task === 'reward') return { json: { items: [{ kind: 'cash', amount: 99999999, asked: '玩家沒有說過的一句話', from: { source: 'degree' } }] } }
      return good
  }
}

export interface FakeProviderOpts {
  /** 不分任務的劇本：照順序用 */
  script?: FakeScriptEntry[]
  /** 分任務的劇本：先用這個 */
  byTask?: Record<string, FakeScriptEntry[]>
  /** 劇本用完之後：auto 自己回合格的回應（預設）；error 丟網路錯誤 */
  whenEmpty?: 'auto' | 'error'
  /** 每一次請求都套用的對抗模式（可以只對某幾個任務） */
  adversarial?: { mode: AdversarialMode; tasks?: string[] }
}

export class FakeProvider implements Provider {
  readonly source: ProviderSource = { name: '假的服務商', provider: 'fake', model: 'fake-1' }
  readonly supports = { structured: true, tools: false }
  /** 收到的每一次請求 */
  readonly requests: AiRequest[] = []
  private script: FakeScriptEntry[]
  private byTask: Record<string, FakeScriptEntry[]>

  constructor(private opts: FakeProviderOpts = {}) {
    this.script = [...(opts.script ?? [])]
    this.byTask = Object.fromEntries(Object.entries(opts.byTask ?? {}).map(([k, v]) => [k, [...v]]))
  }

  requestsFor(task: string): AiRequest[] {
    return this.requests.filter((r) => r.task === task)
  }

  private next(req: AiRequest): FakeReply {
    const entry = this.byTask[req.task]?.shift() ?? this.script.shift()
    if (entry) return typeof entry === 'function' ? entry(req) : entry
    const adv = this.opts.adversarial
    if (adv && (!adv.tasks || adv.tasks.includes(req.task))) return adversarial(adv.mode, req)
    if (this.opts.whenEmpty === 'error') return { networkError: '假的服務商：劇本用完了' }
    return goodReply(req)
  }

  async *request(req: AiRequest, signal: AbortSignal): AsyncIterable<AiEvent> {
    this.requests.push(JSON.parse(JSON.stringify(req)) as AiRequest)
    const reply = this.next(req)
    if (reply.delayMs) await sleep(reply.delayMs, signal)
    if (reply.networkError) throw new AiError('network', reply.networkError)
    if (reply.hang) await sleep(2 ** 30, signal)
    if (reply.refusal) return void (yield { type: 'done', stop: 'refusal' })
    const text = reply.text ?? (reply.json !== undefined ? JSON.stringify(reply.json) : '')
    if (reply.breakAfter !== undefined) {
      yield { type: 'text', text: text.slice(0, reply.breakAfter) }
      return
    }
    // 分兩段送，像串流
    const half = Math.ceil(text.length / 2)
    if (text) yield { type: 'text', text: text.slice(0, half) }
    if (text.length > half) yield { type: 'text', text: text.slice(half) }
    yield { type: 'done', stop: 'end', usage: { input: req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0), output: text.length } }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AiError('cancel', '取消'))
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new AiError('cancel', '取消')) }, { once: true })
  })
}
