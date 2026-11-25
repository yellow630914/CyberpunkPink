// L7 外殼：任務鏈的引擎（AI_TASKS 第 2 節）。編排是程式：跑哪幾步、順序、哪幾步同時跑，照模板決定。
//
// - 三種步驟：code（程式）、ai（一次請求）、apply（套用，永遠最後、一條鏈只有一個）。
// - 每一步寫明依賴（needs）；依賴都完成才開始。沒有依賴關係的步驟同時跑，AI 的請求由 Limiter 限制在 3 個。
// - 套用之前什麼都不寫進存檔：每一步的結果只放在這條鏈的草稿（draft）。所以任何一步都能重試。
// - 重試一步會讓所有依賴它的後面幾步失效重跑；沒有依賴它的保留結果。擲骰的步驟重試時不重擲，只有 reroll 才換骰。
// - 被略過的步驟（when 不成立、分支沒走到）視為已經完成。

import type { ClampNote, GameState, Report, ReportDraft } from '../../core/types'
import type { Kernel } from '../../core/kernel'
import { commitTurn } from '../../core/action/turn'
import { clone } from '../../core/util/clone'
import type { AiErrorKind } from './provider'
import type { AiSettings } from './settings'
import type { AttemptLog, TaskEnv, TaskRegistry } from './tasks'
import { runTask } from './tasks'

export interface StepTemplate {
  id: string
  kind: 'code' | 'ai' | 'apply'
  /** code：要跑的程式步驟的名字 */
  run?: string
  /** ai：任務的 id */
  task?: string
  needs?: string[]
  /** 程式判斷的條件；不成立時這一步略過 */
  when?: string
  /** 寫正文的模式：new、continue、rewrite…… */
  mode?: string
  /** 這一步的結果決定後面走哪一段：結果的 branch 欄位（或結果本身）→ 要走的步驟。沒被選到的那幾段略過 */
  branch?: Record<string, string[]>
}

export interface ChainTemplate {
  chain: string
  steps: StepTemplate[]
  /** Agent 的掛點；Agent 關時不看 */
  hooks?: string[]
}

export type StepStatus = 'waiting' | 'running' | 'done' | 'failed' | 'fallback' | 'skipped'

/** 一步的紀錄：任務鏈列上的一顆標籤，也是存檔裡保留的細節。 */
export interface StepRecord {
  id: string
  kind: 'code' | 'ai' | 'apply'
  task?: string
  status: StepStatus
  /** 附加的記號：clamped（有夾值）、uncovered（沒寫到） */
  marks: string[]
  result?: unknown
  clamps?: ClampNote[]
  error?: { kind: AiErrorKind | 'code'; message: string; details: string[] }
  attempts?: AttemptLog[]
  model?: string
  /** 這一顆骰重擲過幾次 */
  rerolls?: number
  /** 玩家按了「用規則代替」 */
  byRules?: boolean
}

export interface ChainCtx {
  k: Kernel
  /** 這條鏈開始時的狀態。套用之前不會變；步驟不可以改它 */
  state: GameState
  settings: AiSettings
  /** 這條鏈的輸入（自由行動是 ActionInput） */
  input: unknown
  /** 草稿：每一步的結果，鍵是步驟的 id。被略過的步驟沒有 */
  draft: Record<string, unknown>
  /** 每一顆骰重擲過幾次 */
  rerolls: Record<string, number>
  chainId: string
  /** 判定被夾的紀錄等，步驟之間要傳的雜項 */
  records: Record<string, StepRecord>
}

export interface ChainDef {
  template: ChainTemplate
  /** 設定裡這種鏈的代號（潤色的開關用）：free、move、trade…… */
  code: string
  /** 這條鏈有沒有正文（有的話算一樓）。可以是函式：同一條鏈有時有正文、有時沒有（場景的一步：結束的那一步才有）；套用之前問，看這條鏈已經算好的草稿 */
  hasText: boolean | ((ctx: ChainCtx) => boolean)
  codeSteps: Record<string, (ctx: ChainCtx, step: StepTemplate) => unknown | Promise<unknown>>
  whens?: Record<string, (ctx: ChainCtx) => boolean>
  /** 可以重擲的步驟 */
  rerollable?: string[]
  /** 組出 AI 步驟的輸入 */
  aiInput(step: StepTemplate, ctx: ChainCtx): unknown
  /** 這一步的 AI 有沒有開（照設定裡各任務的開關）；關著就直接走退路 */
  aiEnabled?(step: StepTemplate, ctx: ChainCtx): boolean
  /**
   * 這條鏈的 AI 請求走不走成人路由（請求的 adult 記號；報告帶 adult 的鏈：narrated）。沒寫就是不走。
   * 第二個參數是正在跑的那一步：同一條鏈裡有的步驟走（寫正文）、有的不走（reward、relate 讀的是摘要版；PROMPTS 7.2 節）。
   * 任務自己寫了 adult（TaskDef.adult）的，不論這裡怎麼回答都走成人路由。
   */
  adult?(ctx: ChainCtx, step?: StepTemplate): boolean
  /** 套用：把草稿組成報告草稿 */
  apply(ctx: ChainCtx): ReportDraft
}

export interface ChainEnv {
  k: Kernel
  tasks: TaskRegistry
  taskEnv: TaskEnv
  /**
   * 套用時怎麼提交（回合流程加上報告帶的 launch，整件事是一次提交）。Game 給；沒給的話直接 commitTurn（沒有 launch 的處理）。
   * 提交不成立（含 launch 開不成丟 ActionBlocked）時狀態完全不動，這條鏈停下來。
   */
  commit?(draft: ReportDraft): Report[]
}

/**
 * 一條鏈的狀態。paused：有一步失敗（或程式出錯），鏈停下來等玩家重試、重擲或改用規則；狀態還沒有被改。
 * （行動本身被擋下、根本做不了，不是鏈的狀態：那是 Game.act 回傳的 refused。）
 */
export type ChainStatus = 'idle' | 'running' | 'paused' | 'applied' | 'cancelled'

/** 對一步提出的請求：重試、用規則代替、重擲。 */
export type StepRequest = 'retry' | 'rules' | 'reroll'

/** 判定類與寫正文類的任務（模板的格式檢查用）：判定與寫正文之間一定隔著程式（AI_TASKS 2.2 節）。 */
export const JUDGE_TASKS: readonly string[] = ['judge']
export const TEXT_TASKS: readonly string[] = ['narrate']

const SETTLED: ReadonlySet<StepStatus> = new Set(['done', 'fallback', 'skipped'])

export class ChainRegistry {
  private defs = new Map<string, ChainDef>()

  register(def: ChainDef): void {
    const id = def.template.chain
    if (this.defs.has(id)) throw new Error(`任務鏈重複註冊：${id}`)
    validateTemplate(def.template)
    this.defs.set(id, def)
  }

  get(id: string): ChainDef | undefined {
    return this.defs.get(id)
  }
}

/**
 * 模板的格式檢查：id 不重複、依賴找得到、沒有循環、剛好一個 apply 而且在最後、判定與寫正文之間隔著程式。
 *
 * 「判定與寫正文之間隔著程式」（AI_TASKS 2.2 節）怎麼驗（dev/adr/0009）：寫正文的步驟只要（直接或間接）依賴一個判定的步驟，
 * 就要另外有一個程式的步驟夾在中間：寫正文（直接或間接）依賴它，它（直接或間接）依賴那個判定。
 * 寫正文可以同時直接依賴判定（要讀成功程度與轉折），只要有一條路經過程式。沒有依賴判定的寫正文不受這一條限制。
 */
export function validateTemplate(t: ChainTemplate): void {
  const ids = new Set<string>()
  for (const s of t.steps) {
    if (ids.has(s.id)) throw new Error(`任務鏈 ${t.chain}：步驟 ${s.id} 重複`)
    ids.add(s.id)
  }
  const applies = t.steps.filter((s) => s.kind === 'apply')
  if (applies.length !== 1 || t.steps[t.steps.length - 1]!.kind !== 'apply') throw new Error(`任務鏈 ${t.chain}：要剛好有一個 apply，而且在最後`)
  for (const s of t.steps) {
    for (const n of s.needs ?? []) {
      if (!ids.has(n)) throw new Error(`任務鏈 ${t.chain}：步驟 ${s.id} 依賴不存在的 ${n}`)
      if (t.steps.findIndex((x) => x.id === n) >= t.steps.findIndex((x) => x.id === s.id)) throw new Error(`任務鏈 ${t.chain}：步驟 ${s.id} 只能依賴排在它前面的步驟（${n}）`)
    }
    if (s.kind === 'ai' && !s.task) throw new Error(`任務鏈 ${t.chain}：AI 步驟 ${s.id} 沒有寫 task`)
    if (s.kind === 'code' && !s.run) throw new Error(`任務鏈 ${t.chain}：程式步驟 ${s.id} 沒有寫 run`)
    for (const list of Object.values(s.branch ?? {})) for (const b of list) if (!ids.has(b)) throw new Error(`任務鏈 ${t.chain}：分支引用不存在的步驟 ${b}`)
  }
  // 每一步（直接或間接）依賴的所有步驟。前面已經確認依賴只往前指，所以照順序算一次就好
  const ancestors = new Map<string, Set<string>>()
  for (const s of t.steps) {
    const set = new Set<string>()
    for (const n of s.needs ?? []) {
      set.add(n)
      for (const a of ancestors.get(n) ?? []) set.add(a)
    }
    ancestors.set(s.id, set)
  }
  const byId = new Map(t.steps.map((s) => [s.id, s]))
  for (const text of t.steps.filter((s) => s.kind === 'ai' && TEXT_TASKS.includes(s.task ?? ''))) {
    const before = [...ancestors.get(text.id)!].map((id) => byId.get(id)!)
    for (const judge of before.filter((s) => s.kind === 'ai' && JUDGE_TASKS.includes(s.task ?? ''))) {
      const between = before.some((s) => s.kind === 'code' && ancestors.get(s.id)!.has(judge.id))
      if (!between) throw new Error(`任務鏈 ${t.chain}：判定（${judge.id}）與寫正文（${text.id}）之間要隔著程式的步驟（AI_TASKS 2.2 節）`)
    }
  }
}

export class ChainRun {
  readonly id: string
  readonly steps: StepRecord[]
  readonly template: ChainTemplate
  status: ChainStatus = 'idle'
  /** 套用時提交的報告（第一份是這條鏈自己的） */
  reports: Report[] = []
  private ctx: ChainCtx
  private abort = new AbortController()
  private retryNotes: Record<string, string[]> = {}

  constructor(private env: ChainEnv, readonly def: ChainDef, state: GameState, input: unknown, settings: AiSettings) {
    this.id = `c${state.seq.chain + 1}`
    this.template = withPolish(def, settings, env.tasks)
    this.steps = this.template.steps.map((s) => ({ id: s.id, kind: s.kind, ...(s.task ? { task: s.task } : {}), status: 'waiting' as StepStatus, marks: [] }))
    this.ctx = { k: env.k, state, settings, input: clone(input), draft: {}, rerolls: {}, chainId: this.id, records: Object.fromEntries(this.steps.map((s) => [s.id, s])) }
  }

  get draft(): Readonly<Record<string, unknown>> {
    return this.ctx.draft
  }

  step(id: string): StepRecord {
    const s = this.steps.find((x) => x.id === id)
    if (!s) throw new Error(`任務鏈 ${this.template.chain} 沒有 ${id} 這一步`)
    return s
  }

  private tpl(id: string): StepTemplate {
    return this.template.steps.find((s) => s.id === id)!
  }

  private set(s: StepRecord, status: StepStatus): void {
    s.status = status
    this.env.k.probe.emit('shell/ai/chain', 'chain.step', () => ({ chain: this.id, template: this.template.chain, step: s.id, status, marks: s.marks, result: s.result, error: s.error }))
  }

  private needsMet(s: StepRecord): boolean {
    if (s.kind === 'apply') return this.steps.every((x) => x === s || SETTLED.has(x.status))
    return (this.tpl(s.id).needs ?? []).every((n) => SETTLED.has(this.step(n).status))
  }

  /** 跑到不能再跑：全部完成就套用（applied）；有一步失敗、等玩家處理就停下（paused）。 */
  async run(): Promise<ChainStatus> {
    if (this.status === 'applied') return this.status
    this.status = 'running'
    const inflight = new Map<string, Promise<void>>()
    let codeError: unknown
    for (;;) {
      if (this.abort.signal.aborted) break
      let progressed = false
      for (const s of this.steps) {
        if (s.status !== 'waiting' || s.kind === 'apply' || !this.needsMet(s)) continue
        const t = this.tpl(s.id)
        const when = t.when ? this.def.whens?.[t.when] : undefined
        if (t.when && !when) throw new Error(`任務鏈 ${this.template.chain}：沒有 ${t.when} 這個條件`)
        if (when && !when(this.ctx)) {
          this.set(s, 'skipped')
          progressed = true
          continue
        }
        this.set(s, 'running')
        inflight.set(s.id, this.exec(s, t).catch((e) => { codeError ??= e }).finally(() => { inflight.delete(s.id) }))
      }
      if (progressed) continue
      if (inflight.size === 0) break
      await Promise.race(inflight.values())
      if (codeError) break
    }
    await Promise.allSettled(inflight.values())
    if (codeError) {
      this.status = 'paused'
      throw codeError
    }
    if (this.abort.signal.aborted) return (this.status = 'cancelled')
    const apply = this.steps[this.steps.length - 1]!
    if (!this.needsMet(apply)) return (this.status = 'paused')
    this.set(apply, 'running')
    const hasText = typeof this.def.hasText === 'function' ? this.def.hasText(this.ctx) : this.def.hasText
    const floor = hasText ? this.ctx.state.seq.floor + 1 : Math.max(1, this.ctx.state.seq.floor)
    const draft = this.def.apply(this.ctx)
    apply.status = 'done'
    draft.chain = this.id
    draft.changes.push({ op: 'chain', slot: { id: this.id, floor, detail: { chain: this.template.chain, steps: clone(this.steps) } } })
    try {
      this.reports = this.env.commit ? this.env.commit(draft) : commitTurn(this.env.k, this.ctx.state, draft)
    } catch (e) {
      // 套用只寫驗證過的草稿，照理不會失敗；真的失敗時（例：掛鉤接著提交的報告不合法）整個回合不套、狀態完全沒變，這條鏈停下來
      apply.error = { kind: 'code', message: (e as Error).message, details: [] }
      this.set(apply, 'failed')
      this.status = 'paused'
      throw e
    }
    this.set(apply, 'done')
    return (this.status = 'applied')
  }

  private async exec(s: StepRecord, t: StepTemplate): Promise<void> {
    if (t.kind === 'code') {
      const fn = this.def.codeSteps[t.run!]
      if (!fn) throw new Error(`任務鏈 ${this.template.chain}：沒有 ${t.run} 這個程式步驟`)
      try {
        s.result = await fn(this.ctx, t)
      } catch (e) {
        s.error = { kind: 'code', message: (e as Error).message, details: [] }
        this.set(s, 'failed')
        throw e
      }
      if (this.ctx.rerolls[s.id]) s.rerolls = this.ctx.rerolls[s.id]
      this.ctx.draft[s.id] = s.result
      this.set(s, 'done')
    } else {
      const def = this.env.tasks.get(t.task!)
      if (!def) throw new Error(`任務鏈 ${this.template.chain}：沒有 ${t.task} 這個 AI 任務`)
      const enabled = this.def.aiEnabled?.(t, this.ctx) ?? true
      const adult = this.def.adult?.(this.ctx, t) ?? false
      const outcome = await runTask(this.env.taskEnv, def, this.def.aiInput(t, this.ctx), { settings: this.ctx.settings, chain: this.id, step: s.id, ...(adult ? { adult: true } : {}) }, {
        signal: this.abort.signal, forceFallback: !enabled || !!s.byRules, previousError: this.retryNotes[s.id],
      })
      delete this.retryNotes[s.id]
      s.attempts = outcome.attempts
      s.model = outcome.model
      s.error = outcome.error
      s.clamps = outcome.clamps.length ? outcome.clamps : undefined
      s.marks = [...(outcome.clamps.length ? ['clamped'] : []), ...outcome.marks]
      if (outcome.status === 'failed') return void this.set(s, 'failed')
      if (outcome.status === 'done') delete s.error
      s.result = outcome.value
      this.ctx.draft[s.id] = outcome.value
      this.set(s, outcome.status)
    }
    // 分支：沒被選到的那幾段略過
    if (t.branch) {
      const r = s.result as { branch?: unknown } | undefined
      const key = String(r && typeof r === 'object' && 'branch' in r ? r.branch : s.result)
      const chosen = new Set(t.branch[key] ?? [])
      for (const list of Object.values(t.branch)) for (const id of list) if (!chosen.has(id) && this.step(id).status === 'waiting') this.set(this.step(id), 'skipped')
    }
  }

  /** 直接或間接依賴這一步的所有步驟（含 apply）。 */
  dependents(id: string): string[] {
    const out = new Set<string>()
    let grew = true
    while (grew) {
      grew = false
      for (const t of this.template.steps) {
        if (out.has(t.id) || t.id === id) continue
        if ((t.needs ?? []).some((n) => n === id || out.has(n))) {
          out.add(t.id)
          grew = true
        }
      }
    }
    return [...out, ...this.template.steps.filter((t) => t.kind === 'apply').map((t) => t.id)]
  }

  private reset(s: StepRecord): void {
    delete this.ctx.draft[s.id]
    delete s.result
    delete s.error
    delete s.clamps
    delete s.attempts
    s.marks = []
    this.set(s, 'waiting')
  }

  /**
   * 這個請求本身成不成立（不看這條鏈是不是已經套用：已經套用的由 Game 先回退那一次套用再打開）。
   * 不成立就回傳原因（給玩家看的句子）。純粹的檢查，什麼都不改：Game 在動任何東西之前先問這個。
   */
  requestBlock(kind: StepRequest, id: string): string | null {
    const s = this.steps.find((x) => x.id === id)
    if (!s) return `任務鏈 ${this.template.chain} 沒有 ${id} 這一步`
    if (this.status === 'running') return '這條鏈還在跑。'
    if (this.status === 'cancelled') return '這條鏈已經取消了。'
    if (kind === 'reroll') return (this.def.rerollable ?? []).includes(id) ? null : '這一步不是擲骰，不能重擲。'
    if (kind === 'rules') return s.kind === 'ai' ? null : '只有 AI 的步驟可以用規則代替。'
    return s.kind === 'apply' ? '套用不能單獨重試。' : null
  }

  /** 這一步現在能不能重試；不能就回傳原因（給玩家看的句子）。已經套用的鏈要先由 Game 回退那一次套用。 */
  retryBlock(id: string): string | null {
    this.step(id)
    if (this.status === 'applied') return '這條鏈已經套用了；只有最新一樓可以先回退這一次套用再重試。'
    return this.requestBlock('retry', id)
  }

  private invalidate(id: string, extraNotes: string[] = []): void {
    const block = this.retryBlock(id)
    if (block) throw new Error(block)
    const s = this.step(id)
    // 手動重試時把被夾掉的值、漏寫的那幾行帶進下一次請求（AI_TASKS 5.3 節）
    const notes = [...extraNotes, ...(s.error?.details ?? []), ...(s.clamps ?? []).map((c) => `${c.path}：原本的值 ${JSON.stringify(c.from)}，上限 ${JSON.stringify(c.limit ?? '')}，夾過的值 ${JSON.stringify(c.to)}`)]
    const uncovered = (s.result as { uncovered?: number[] } | undefined)?.uncovered
    if (uncovered?.length) notes.push(`正文沒有寫到 <results> 的第 ${uncovered.join('、')} 行`)
    if (notes.length) this.retryNotes[id] = notes
    this.reset(s)
    for (const d of this.dependents(id)) this.reset(this.step(d))
  }

  /** 重試一步：重跑這一步，以及所有依賴它的後面幾步。 */
  retry(id: string): Promise<ChainStatus> {
    this.invalidate(id)
    this.step(id).byRules = false
    return this.run()
  }

  /** 用規則代替：這一步改走程式的退路；依賴它的後面幾步一樣失效重跑。 */
  useRules(id: string): Promise<ChainStatus> {
    const block = this.requestBlock('rules', id)
    if (block) throw new Error(block)
    this.invalidate(id)
    this.step(id).byRules = true
    return this.run()
  }

  /** 重擲：換一顆骰子，依賴它的後面幾步失效重跑。每次重擲都記一筆。 */
  reroll(id: string): Promise<ChainStatus> {
    const block = this.requestBlock('reroll', id)
    if (block) throw new Error(block)
    this.invalidate(id)
    this.ctx.rerolls[id] = (this.ctx.rerolls[id] ?? 0) + 1
    return this.run()
  }

  /** 已經套用的鏈要重試：呼叫的人先把狀態回退到套用前，再用這個把鏈打開。 */
  reopen(): void {
    if (this.status !== 'applied') return
    this.status = 'paused'
    this.reports = []
    this.step(this.steps[this.steps.length - 1]!.id).status = 'waiting'
  }

  /** 取消：玩家回退、離開這個畫面、關掉 AI。進行中的步驟標成失敗，原因是「取消」。 */
  cancel(): void {
    this.abort.abort()
  }
}

/** 開了潤色的鏈：text 之後、apply 之前多一步 polish。 */
function withPolish(def: ChainDef, settings: AiSettings, tasks: TaskRegistry): ChainTemplate {
  const t = def.template
  if (!settings.ai || !settings.polish[def.code] || !tasks.get('polish') || !t.steps.some((s) => s.id === 'text') || t.steps.some((s) => s.id === 'polish')) return t
  const steps = [...t.steps]
  steps.splice(steps.length - 1, 0, { id: 'polish', kind: 'ai', task: 'polish', needs: ['text'] })
  return { ...t, steps }
}
