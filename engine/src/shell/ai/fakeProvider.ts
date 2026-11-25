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

const KANJI = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
/** 把一個數字寫成國字（逐位：12 → 一二）。 */
const kanji = (n: number): string => [...String(Math.max(0, Math.floor(n)))].map((d) => KANJI[Number(d)]).join('')

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
    // 成人場景的任務（M4-core-scene-ai）：合規的自動回應。進場景照輸入給的性質（明寫的設定優先）；每回合選一個挑逗或主導（沒有就空的）；
    // 沉溺照規則的退路；傾向交程式列出的全部；算關係取範圍的中間值；算回報沒有參考範圍就交空的（上面的 reward 照 hint）
    case 'scene_gate': {
      const nature = input.fixed?.nature ?? input.natures?.[0]?.id
      return { json: { enter: true, nature, ...(input.fixed?.goal ? { goal: input.fixed.goal } : {}), reason: '（假的服務商）照情境進場景。', ...(input.fixed?.circles ? { circles: input.fixed.circles } : {}) } }
    }
    case 'scene_turn': {
      const pick = ((input.legal as Array<Record<string, unknown>>) ?? []).find((m) => m.kind === 'tease' || m.kind === 'dominate' || m.kind === 'yield')
      return { json: { moves: pick ? [{ kind: pick.kind, ...(typeof pick.target === 'string' ? { target: pick.target } : {}) }] : [], line: `（假的服務商）${input.actor?.name ?? '他'}靠了過來。` } }
    }
    case 'scene_talk':
      return { json: { fit: 3, ...(input.scene?.goal ? { goal: 5 } : {}), agree: true, reason: '（假的服務商）這句話說到了心裡。' } }
    case 'sex_record':
      return { json: { records: ((input.people as Array<{ id: string; name: string }>) ?? []).map((p) => ({ with: p.id, kind: input.nature, note: `（假的服務商）和${p.name}的這一場。` })) } }
    case 'sink':
      return { json: { kind: input.rule.kind, amount: input.rule.amount, reason: '（假的服務商）照規則。' } }
    case 'tendency':
      return { json: { tags: ((input.touched as Array<{ id: string }>) ?? []).map((t) => t.id) } }
    // 未登錄零件（M4-core-part-ai）：名字是「測試件」加流水號的國字（流水號取 <input>.id 裡的數字，每一件不同），說明與怪癖各一句、沒有數字
    case 'design_part': {
      const n = Number(/\d+/.exec(String(input.id ?? ''))?.[0] ?? 0)
      return { json: { name: `測試件${kanji(n)}`, desc: '（假的服務商）一件合規的測試零件。', quirk: input.quirk ? '（假的服務商）它偶爾會自己嗡嗡作響。' : '' } }
    }
    case 'relate':
      return { json: input.scene ? { items: (input.cast as Array<{ id: string; range: [number, number] }>).map((c) => ({ id: c.id, amount: Math.round((c.range[0] + c.range[1]) / 2) })) } : {} }
    default:
      return { json: {} }
  }
}

/** 成人場景的對抗劇本（M4-core-scene-ai）：每一個是一個任務交出不合規的回應。不放進 ADVERSARIAL_MODES（那一組會被每個任務的測試逐個跑）。 */
export const SCENE_ADVERSARIES = ['turn_stop', 'turn_other_circle', 'sink_over', 'gate_bad_nature', 'tendency_untouched', 'talk_over'] as const
export type SceneAdversary = (typeof SCENE_ADVERSARIES)[number]

/** 每一個對抗劇本打在哪個任務上。 */
export const SCENE_ADVERSARY_TASK: Record<SceneAdversary, string> = {
  turn_stop: 'scene_turn', turn_other_circle: 'scene_turn', sink_over: 'sink', gate_bad_nature: 'scene_gate', tendency_untouched: 'tendency', talk_over: 'scene_talk',
}

/**
 * 一個對抗劇本的回應：scene_turn 交 stop；scene_turn 交別圈的人當對象（target 給那個人的 id，沒給就是一個不在場的人）；sink 交 +9；
 * scene_gate 交清單外的性質；tendency 交沒碰到的標籤；scene_talk 交 +50。
 */
export function sceneAdversary(name: SceneAdversary, o: { target?: string } = {}): FakeReply {
  switch (name) {
    case 'turn_stop': return { json: { moves: [{ kind: 'tease' }, { kind: 'stop' }], line: '（對抗）他想結束這一場。' } }
    case 'turn_other_circle': return { json: { moves: [{ kind: 'talk', target: o.target ?? 'npc_nobody' }], line: '（對抗）他看向別的圈。' } }
    case 'sink_over': return { json: { kind: 'anchor', amount: 9, reason: '（對抗）沉溺大漲。' } }
    case 'gate_bad_nature': return { json: { enter: true, nature: 'no_such_nature', reason: '（對抗）清單外的性質。' } }
    case 'tendency_untouched': return { json: { tags: ['tg_not_touched'] } }
    case 'talk_over': return { json: { fit: 50, goal: 99, agree: true, reason: '（對抗）說得太好了。' } }
  }
}

/**
 * 劇本用的：同一個對抗回應排 times 次（自動重試也拿到同一份壞的；預設 4 次，重試上限是 3），之後照自動模式。
 * 用法：new FakeProvider({ byTask: { sink: sceneScript('sink_over') } })。
 */
export function sceneScript(name: SceneAdversary, o: { target?: string; times?: number } = {}): FakeScriptEntry[] {
  return Array.from({ length: o.times ?? 4 }, () => sceneAdversary(name, o))
}

/** 未登錄零件的對抗劇本（M4-core-part-ai）：每一個是 design_part 交出不合規的回應。不放進 ADVERSARIAL_MODES（那一組會被每個任務的測試逐個跑），另外放這一組。 */
export const PART_ADVERSARIES = ['bad_json', 'name_digit', 'name_dup', 'desc_long', 'extra_stats', 'refusal'] as const
export type PartAdversary = (typeof PART_ADVERSARIES)[number]

/**
 * 一個對抗劇本的回應（req 是 design_part 的請求，好的部分照它的 <input> 算）：bad_json 交一半的 JSON；name_digit 名字帶阿拉伯數字；
 * name_dup 名字和內容裡一個零件同名（o.dup 給那個名字；沒給就用 <input>.samples 的第一筆）；desc_long 說明超過 60 字；
 * extra_stats 多一個 stats 欄位（想偷偷改數字）；refusal 服務商拒絕。
 */
export function partAdversary(name: PartAdversary, req: AiRequest, o: { dup?: string } = {}): FakeReply {
  const good = goodReply(req).json as { name: string; desc: string; quirk: string }
  const samples = (inputOf<{ samples?: string[] }>(req).samples ?? []) as string[]
  switch (name) {
    case 'bad_json': return { text: '{"name": "壞掉的回應' }
    case 'name_digit': return { json: { ...good, name: '測試件3號' } }
    case 'name_dup': return { json: { ...good, name: o.dup ?? samples[0] ?? good.name } }
    case 'desc_long': return { json: { ...good, desc: '一件很長很長的測試零件說明。'.repeat(6) } }
    case 'extra_stats': return { json: { ...good, stats: { damage: 99 } } }
    case 'refusal': return { refusal: true }
  }
}

/** 劇本用的：同一個對抗回應排 times 次（自動重試也拿到同一份壞的；預設 4 次，重試上限是 2），之後照自動模式。用法 new FakeProvider({ byTask: { design_part: partScript('desc_long') } })。 */
export function partScript(name: PartAdversary, o: { dup?: string; times?: number } = {}): FakeScriptEntry[] {
  return Array.from({ length: o.times ?? 4 }, () => (req: AiRequest) => partAdversary(name, req, o))
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
