// L7 外殼：一局遊戲的門面。ui 的 store 包住的就是這個：呼叫它的動作、拿回報告、把狀態交給畫面。
// 這裡不寫規則，只把核心、功能、AI 任務鏈、存檔與回退接在一起。

import type { GameState, Report, ReportDraft } from '../core/types'
import type { Feature, Kernel } from '../core/kernel'
import { createKernel, readyFeatures } from '../core/kernel'
import type { ContentPack } from '../core/content/registry'
import type { ActionInput } from '../core/action/kinds'
import { commitTurn } from '../core/action/turn'
import { blankState } from '../core/state/blank'
import { commitReport } from '../core/state/commit'
import { sanitizeRules } from '../core/rules/saveRules'
import { clone, replaceInPlace } from '../core/util/clone'
import type { ChainStatus } from './ai/chain'
import { ChainRegistry, ChainRun } from './ai/chain'
import { freeActionChain, registerFreeActionTasks } from './ai/freeAction'
import type { Provider, ProviderSource } from './ai/provider'
import { Limiter } from './ai/provider'
import type { AiSettings } from './ai/settings'
import { ProviderHub, sanitizeAiSettings } from './ai/settings'
import type { TaskEnv } from './ai/tasks'
import { IDLE_TIMEOUT_MS, TaskRegistry } from './ai/tasks'
import type { SaveMeta } from './save'
import { packSave, saveMeta, unpackSave } from './save'
import { UndoStack } from './undo'

export interface GameOptions {
  features?: Feature[]
  /** 內容（規則數值、世界內容），照順序載入 */
  content?: ContentPack[]
  /** AI 的設定物件（cpp-ai-v1 的形狀）；引擎不碰 localStorage */
  ai?: unknown
  /** 模型來源，鍵是來源的名字 */
  sources?: Record<string, ProviderSource>
  /** 假的服務商：沒有金鑰（或那一家還沒接上）的任務用它；給 null 就是走退路 */
  fakeProvider?: Provider | null
  /** 時鐘（毫秒）：只用來記每一次請求花了多久。測試給固定的 */
  now?: () => number
  idleTimeoutMs?: number
  /** 嚴格模式：檢查掛鉤有沒有偷改狀態 */
  strict?: boolean
}

export interface ActResult {
  status: ChainStatus
  run: ChainRun
  /** 套用時提交的報告；還沒套用（blocked）時是空的 */
  reports: Report[]
}

export interface ActOptions {
  /** 有步驟失敗、要等玩家處理時，自動改用規則（沒有畫面的測試與批次用） */
  autoRules?: boolean
}

type Listener = (state: GameState, reports: Report[]) => void

export class Game {
  readonly k: Kernel
  readonly tasks: TaskRegistry
  readonly chains = new ChainRegistry()
  readonly hub: ProviderHub
  readonly limiter = new Limiter()
  readonly undo = new UndoStack()
  /** 遊戲狀態。這個物件本身不會換掉（讀檔與回退是把內容換掉），外面可以一直拿著 */
  readonly state: GameState
  settings: AiSettings
  /** 最新一條鏈與它開始前的狀態（最新一樓可以在套用之後重試） */
  private last: { run: ChainRun; before: GameState } | null = null
  private listeners: Listener[] = []
  private taskEnv: TaskEnv

  constructor(opts: GameOptions = {}) {
    this.k = createKernel(opts.features ?? [])
    this.k.strict = opts.strict ?? false
    for (const pack of opts.content ?? []) this.k.content.loadPack(pack)
    const dangling = this.k.content.checkRefs()
    if (dangling.length) throw new Error(`內容的引用斷了：${dangling.slice(0, 5).join('；')}`)
    readyFeatures(this.k)
    this.settings = sanitizeAiSettings(opts.ai)
    this.hub = new ProviderHub(opts.sources ?? {}, opts.fakeProvider ?? null)
    this.tasks = new TaskRegistry(this.k.probe)
    this.taskEnv = { hub: this.hub, limiter: this.limiter, probe: this.k.probe, now: opts.now ?? (() => Date.now()), idleTimeoutMs: opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS }
    registerFreeActionTasks(this.k, this.tasks)
    this.chains.register(freeActionChain())
    this.state = blankState(0)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn)
    return () => { this.listeners = this.listeners.filter((x) => x !== fn) }
  }

  private notify(reports: Report[]): void {
    for (const fn of this.listeners) fn(this.state, reports)
  }

  setAiSettings(raw: unknown): void {
    this.settings = sanitizeAiSettings(raw)
    // 關掉 AI：進行中的步驟被取消
    if (!this.settings.ai && this.last?.run.status === 'running') this.last.run.cancel()
  }

  /** 開新遊戲：空白的狀態加上存檔規則，再讓每個功能放自己的初始狀態（game.new 掛鉤）。 */
  newGame(opts: { seed: number; rules?: unknown }): Report {
    const fresh = blankState(opts.seed)
    fresh.rules = sanitizeRules(opts.rules)
    replaceInPlace(this.state, fresh)
    this.undo.clear()
    this.last = null
    const changes = this.k.hooks.run('game.new', { state: this.state }).flatMap((r) => r.result)
    const report = commitReport(this.k, this.state, {
      kind: 'system', action: 'game.new', location: {}, party: [], timeline: [], changes, outcome: { result: 'created', summary: '開新遊戲。' },
    })
    this.notify([report])
    return report
  }

  /** 提交一份程式結算的報告（不經過 AI 的動作：建角的確認、買賣、穿脫……）。會留一步回退。 */
  commit(draft: ReportDraft, label = draft.outcome.summary): Report[] {
    this.undo.push(this.state, label)
    try {
      const reports = commitTurn(this.k, this.state, draft)
      this.notify(reports)
      return reports
    } catch (e) {
      this.undo.drop()
      throw e
    }
  }

  /** 自由行動：跑 free_action 這條鏈。 */
  act(input: ActionInput, opts: ActOptions = {}): Promise<ActResult> {
    return this.runChain('free_action', input, opts, input.text || input.kind)
  }

  /** 跑一條任務鏈。被擋下的行動（ActionBlocked）會丟出來，狀態不變。 */
  async runChain(chainId: string, input: unknown, opts: ActOptions = {}, label = chainId): Promise<ActResult> {
    const def = this.chains.get(chainId)
    if (!def) throw new Error(`沒有 ${chainId} 這條任務鏈`)
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    // 上一條鏈停在半路（等玩家處理）就開始新的行動：那一條作廢，它留的那一步回退也拿掉
    if (this.last?.run.status === 'blocked') {
      this.last.run.cancel()
      this.undo.drop()
    }
    const before = clone(this.state)
    const run = new ChainRun({ k: this.k, tasks: this.tasks, taskEnv: this.taskEnv }, def, this.state, input, this.settings)
    this.undo.push(this.state, label)
    this.last = { run, before }
    try {
      return await this.settle(run, await run.run(), opts)
    } catch (e) {
      this.undo.drop()
      this.last = null
      throw e
    }
  }

  private async settle(run: ChainRun, status: ChainStatus, opts: ActOptions): Promise<ActResult> {
    let s = status
    while (s === 'blocked' && opts.autoRules) {
      const failed = run.steps.find((x) => x.status === 'failed' && x.kind === 'ai')
      if (!failed) break
      s = await run.useRules(failed.id)
    }
    if (s === 'applied') this.notify(run.reports)
    return { status: s, run, reports: run.reports }
  }

  /** 最新一條鏈。 */
  get lastRun(): ChainRun | null {
    return this.last?.run ?? null
  }

  /** 已經套用的最新一樓要重試：先用套用前的快照回退這一次套用（AI_TASKS 2.4 節）。 */
  private reopenLast(): ChainRun {
    if (!this.last) throw new Error('沒有可以重試的任務鏈；更早的樓只能回退。')
    const { run, before } = this.last
    if (run.status === 'applied') {
      replaceInPlace(this.state, clone(before))
      run.reopen()
    }
    return run
  }

  async retryStep(stepId: string, opts: ActOptions = {}): Promise<ActResult> {
    const run = this.reopenLast()
    return this.settle(run, await run.retry(stepId), opts)
  }

  async useRules(stepId: string, opts: ActOptions = {}): Promise<ActResult> {
    const run = this.reopenLast()
    return this.settle(run, await run.useRules(stepId), opts)
  }

  async reroll(stepId = 'roll', opts: ActOptions = {}): Promise<ActResult> {
    const run = this.reopenLast()
    return this.settle(run, await run.reroll(stepId), opts)
  }

  /** 打包成一份存檔的文字。savedAt 由外面給（引擎不看時鐘）。 */
  save(kind: SaveMeta['kind'] = 'manual', savedAt = '', label?: string): string {
    return packSave(this.state, saveMeta(this.state, kind, savedAt, label))
  }

  /** 讀一份存檔的文字。失敗時回傳錯誤訊息，狀態不變；成功回傳 null。讀檔之後不能回退到讀檔之前。 */
  load(raw: string): string | null {
    const r = unpackSave(raw)
    if (!r.ok) return r.error
    this.last?.run.cancel()
    replaceInPlace(this.state, r.file.state)
    this.undo.clear()
    this.last = null
    // 讀檔修復：功能回傳變更，有才提交一份報告
    const changes = this.k.hooks.run('save.loaded', { state: this.state, fromVersion: r.fromVersion }).flatMap((x) => x.result)
    const reports = changes.length
      ? [commitReport(this.k, this.state, { kind: 'system', action: 'save.repair', location: clone(this.state.location), party: [], timeline: [], changes, outcome: { result: 'repaired', summary: '讀檔時修了幾樣東西。' } })]
      : []
    this.notify(reports)
    return null
  }

  /** 回退 n 步。回退的時候進行中的鏈被取消，那一樓的任務鏈一起消失（它在狀態裡）。成功回傳 true。 */
  undoSteps(n = 1): boolean {
    const restored = this.undo.pop(n)
    if (!restored) return false
    this.last?.run.cancel()
    this.last = null
    replaceInPlace(this.state, restored)
    this.notify([])
    return true
  }
}
