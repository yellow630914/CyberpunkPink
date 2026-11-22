// L7 外殼：一局遊戲的門面。ui 的 store 包住的就是這個：呼叫它的動作、拿回報告、把狀態交給畫面。
// 這裡不寫規則，只把核心、功能、AI 任務鏈、存檔與回退接在一起。

import type { BattleInput, BattleState, GameState, Report, ReportDraft, SegmentId, SnapshotSlot, Weekday } from '../core/types'
import type { Feature, Kernel } from '../core/kernel'
import { createKernel, readyFeatures } from '../core/kernel'
import type { ContentPack } from '../core/content/registry'
import { ActionBlocked } from '../core/action/action'
import type { ActionInput } from '../core/action/kinds'
import { commitTurn } from '../core/action/turn'
import type { BattleSetup } from '../core/battle/setup'
import type { GridDir } from '../core/grid/model'
import type { GridView, OpenMapOpts } from '../core/grid/walk'
import { GridBlocked, gridView, gridWalk, openMap } from '../core/grid/walk'
import type { BattleOptions } from '../core/battle/step'
import { BattleBlocked, battleAct, battleAuto, battleOptions, startBattle } from '../core/battle/step'
import { blankState } from '../core/state/blank'
import { commitReport, commitReportAll } from '../core/state/commit'
import { sanitizeRules } from '../core/state/saveRules'
import { clone, replaceInPlace } from '../core/util/clone'
import { daysUntilWeekday, segmentOf, segmentWeekdayOf, weekdayOf } from '../core/util/time'
import type { ChainStatus, StepRequest } from './ai/chain'
import { ChainRegistry, ChainRun } from './ai/chain'
import { battleEndChain } from './battle'
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

/**
 * 一次行動的結果。兩種「做不成」分開，不共用同一個字：
 * - refused：行動本身被擋下（還沒有主角、條件不符……）。reason 是給玩家看的原因。狀態不變、不留回退、沒有鏈可以重試。
 * - paused：鏈跑到一半有一步失敗，停下來等玩家重試、重擲或改用規則（任務鏈列展開那一步）。狀態還沒有被改。
 * 其餘：applied（套用了）、cancelled（被取消：回退、讀檔、關掉 AI）。
 */
export type ActStatus = ChainStatus | 'refused'

export interface ActResult {
  status: ActStatus
  run: ChainRun
  /** 套用時提交的報告；還沒套用時是空的 */
  reports: Report[]
  /** status 是 refused 時：擋住的原因（給玩家看的完整句子） */
  reason?: string
}

export interface ActOptions {
  /** 有步驟失敗、要等玩家處理時，自動改用規則（沒有畫面的測試與批次用） */
  autoRules?: boolean
}

export interface CommitOptions {
  /** 回退選單上這一步的名字；沒給用報告的摘要 */
  label?: string
  /**
   * 併進最新一樓：不另留一步回退（AI_TASKS 5.5 節：沒有正文的鏈算在當時最新的那一樓）。
   * 回退一步時，這一份跟著它前面那一步一起收回。買東西的帳、坐車的時間這類沒有正文的結算用這個。
   */
  attach?: boolean
  /** false：這份報告不是一個「回合」，不跑回合結束的流程（turn.end）。戰鬥裡的每一步用這個；戰鬥結束那一份才算一個回合 */
  turn?: boolean
}

/** 戰鬥裡一步的結果：refused 是這一步做不成（reasons 一條一條列出缺的條件），狀態不變。 */
export interface BattleStepResult {
  status: 'applied' | 'refused'
  reports: Report[]
  reasons?: string[]
  /** 這一步之後戰鬥分出結果了：接著呼叫 finishBattle */
  over: boolean
}

/** 任務鏈列上一步的三個按鈕各自能不能按：null 是可以，字串是不能按的原因。 */
export interface StepActions {
  retry: string | null
  useRules: string | null
  reroll: string | null
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
  /**
   * 最新一條鏈、它開始前的狀態、它套用完那一刻的報告流水號（還沒套用是 null）。
   * 最新一樓可以在套用之後重試；流水號對不上，表示之後又有別的提交，這條鏈就只能回退。
   */
  private last: { run: ChainRun; before: GameState; seqAfter: number | null } | null = null
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
    this.chains.register(battleEndChain())
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

  /**
   * 開新遊戲：空白的狀態加上存檔規則，再讓每個功能放自己的初始狀態（game.new 掛鉤）。
   * setup（可以沒有）：開局接著要提交的報告，例如建角（拿到新的狀態，回傳報告草稿）。整件事先在旁邊做完才換進來：
   * 任何一步丟錯，現在這一局完全不動（開新局不會因為建角被擋下而把原本那一局弄丟）。開局不留回退。
   */
  newGame(opts: { seed: number; rules?: unknown; setup?: (state: GameState) => ReportDraft | ReportDraft[] }): Report {
    const fresh = blankState(opts.seed)
    fresh.rules = sanitizeRules(opts.rules)
    const changes = this.k.hooks.run('game.new', { state: fresh }).flatMap((r) => r.result)
    const reports = [commitReport(this.k, fresh, {
      kind: 'system', action: 'game.new', location: {}, party: [], timeline: [], changes, outcome: { result: 'created', summary: '開新遊戲。' },
    })]
    if (opts.setup) {
      const drafts = opts.setup(fresh)
      for (const d of Array.isArray(drafts) ? drafts : [drafts]) reports.push(...commitTurn(this.k, fresh, d))
    }
    this.last?.run.cancel()
    replaceInPlace(this.state, fresh)
    this.undo.clear()
    this.last = null
    this.notify(reports)
    return reports[0]!
  }

  /** 上一條鏈停在半路（等玩家處理）就做了別的事：那一條作廢，它留的那一步回退也拿掉。 */
  private abandonPaused(): void {
    if (this.last?.run.status !== 'paused') return
    this.last.run.cancel()
    this.undo.drop()
    this.last = null
  }

  /**
   * 提交一份程式結算的報告（不經過 AI 的動作：建角的確認、買賣、穿脫……）。
   * 預設留一步回退；opts.attach 是併進最新一樓、不另留回退。第二個參數給字串就是 label。
   * 不合法時丟 ChangeError：狀態完全不變，能回退的步數也不變。任務鏈還在跑的時候不能提交（丟錯）。
   * 這之後，更早套用的那條鏈就不能再重試、重擲（只能回退）：重試會把這一份提交一起抹掉。
   * 停在半路等玩家的鏈則作廢（和開始新的行動一樣）。
   */
  commit(draft: ReportDraft, opts: string | CommitOptions = {}): Report[] {
    const o: CommitOptions = typeof opts === 'string' ? { label: opts } : opts
    // 鏈還在跑的時候不能插進別的提交：那條鏈的每一步都是照開始時的狀態算的
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    const before = o.attach ? null : clone(this.state)
    const reports = o.turn === false ? commitReportAll(this.k, this.state, draft) : commitTurn(this.k, this.state, draft)
    this.abandonPaused()
    if (before) this.undo.pushSnapshot(before, o.label ?? draft.outcome.summary)
    this.notify(reports)
    return reports
  }

  /** 自由行動：跑 free_action 這條鏈。 */
  act(input: ActionInput, opts: ActOptions = {}): Promise<ActResult> {
    return this.runChain('free_action', input, opts, input.text || input.kind)
  }

  /**
   * 跑一條任務鏈。行動被擋下（ActionBlocked）不丟錯：回傳 status 'refused' 與原因，狀態不變、不留回退。
   * 程式的錯誤（沒有這種行動、鏈的程式步驟出錯）照樣丟出來，狀態不變。
   */
  async runChain(chainId: string, input: unknown, opts: ActOptions = {}, label = chainId): Promise<ActResult> {
    const def = this.chains.get(chainId)
    if (!def) throw new Error(`沒有 ${chainId} 這條任務鏈`)
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    // 戰鬥中不能做別的事（探索用格子、戰鬥是另一個畫面；COMBAT_SYSTEM 第 10 節）：只有結束戰鬥的那條鏈可以跑
    if (this.state.battle && chainId !== 'battle_end') {
      return { status: 'refused', reason: '正在戰鬥，先把這一場打完。', run: new ChainRun({ k: this.k, tasks: this.tasks, taskEnv: this.taskEnv }, def, this.state, input, this.settings), reports: [] }
    }
    this.abandonPaused()
    const before = clone(this.state)
    const run = new ChainRun({ k: this.k, tasks: this.tasks, taskEnv: this.taskEnv }, def, this.state, input, this.settings)
    this.undo.pushSnapshot(before, label)
    this.last = { run, before, seqAfter: null }
    try {
      return await this.settle(run, await run.run(), opts)
    } catch (e) {
      // 這個行動沒有成立：狀態沒變（提交是原子的），回退那一步放回原樣
      if (this.last?.run === run) {
        this.undo.drop()
        this.last = null
      }
      if (e instanceof ActionBlocked) return { status: 'refused', reason: e.reason, run, reports: [] }
      throw e
    }
  }

  private async settle(run: ChainRun, status: ChainStatus, opts: ActOptions): Promise<ActResult> {
    let s = status
    while (s === 'paused' && opts.autoRules) {
      const failed = run.steps.find((x) => x.status === 'failed' && x.kind === 'ai')
      if (!failed) break
      s = await run.useRules(failed.id)
    }
    const mine = this.last?.run === run
    if (s === 'applied') {
      if (mine) this.last!.seqAfter = this.state.seq.report
      this.notify(run.reports)
    } else if (s === 'cancelled' && mine) {
      // 被取消（關掉 AI）：這個行動沒有成立，它留的那一步回退也拿掉。回退、讀檔造成的取消已經自己清過了
      this.undo.drop()
      this.last = null
    }
    return { status: s, run, reports: run.reports }
  }

  /** 最新一條鏈。 */
  get lastRun(): ChainRun | null {
    return this.last?.run ?? null
  }

  /** 對最新一條鏈的一步提出請求（重試、用規則代替、重擲）現在成不成立；不成立回傳原因。什麼都不改。 */
  private requestBlock(kind: StepRequest, stepId: string): string | null {
    const last = this.last
    if (!last) return '沒有可以重試的任務鏈；更早的樓只能回退。'
    // 已經套用的鏈之後又有別的提交：重試會把之後的提交一起抹掉，所以只能回退（AI_TASKS 2.4 節：只有最新一樓）
    if (last.run.status === 'applied' && last.seqAfter !== this.state.seq.report) return '這一樓之後已經做了別的事，不能再重試；只能回退。'
    return last.run.requestBlock(kind, stepId)
  }

  /**
   * 任務鏈列上這一步的三個按鈕各自能不能按（null 是可以，字串是原因）。畫面照這個顯示按鈕，不自己判斷。
   * 沒有最新的鏈、或這一樓之後已經有別的提交時，三個都不能按。
   */
  stepActions(stepId: string): StepActions {
    return { retry: this.requestBlock('retry', stepId), useRules: this.requestBlock('rules', stepId), reroll: this.requestBlock('reroll', stepId) }
  }

  /**
   * 重試、用規則代替、重擲共用：先確認請求成立（不成立就丟錯，狀態與鏈都不動），
   * 已經套用的最新一樓才用套用前的快照回退這一次套用（AI_TASKS 2.4 節），再重跑。
   */
  private async request(kind: StepRequest, stepId: string, opts: ActOptions): Promise<ActResult> {
    const block = this.requestBlock(kind, stepId)
    if (block) throw new Error(block)
    const { run, before } = this.last!
    if (run.status === 'applied') {
      replaceInPlace(this.state, clone(before))
      run.reopen()
      this.last!.seqAfter = null
      this.notify([])
    }
    const status = await (kind === 'retry' ? run.retry(stepId) : kind === 'rules' ? run.useRules(stepId) : run.reroll(stepId))
    return this.settle(run, status, opts)
  }

  retryStep(stepId: string, opts: ActOptions = {}): Promise<ActResult> {
    return this.request('retry', stepId, opts)
  }

  useRules(stepId: string, opts: ActOptions = {}): Promise<ActResult> {
    return this.request('rules', stepId, opts)
  }

  reroll(stepId = 'roll', opts: ActOptions = {}): Promise<ActResult> {
    return this.request('reroll', stepId, opts)
  }

  // ---- 戰鬥（COMBAT_SYSTEM；dev/adr/0010、0011）：每一步是一份報告，直接提交；結束時跑 battle_end 這條鏈 ----

  /** 進行中的戰鬥；沒有在打是 null。 */
  get battle(): BattleState | null {
    return this.state.battle
  }

  /** 現在輪到誰、每個行動能不能做、做不到的原因。畫面照這個顯示，不自己判斷。 */
  battleOptions(): BattleOptions | null {
    return battleOptions(this.k, this.state)
  }

  /**
   * 開打。留一步回退（回退就回到開打之前），並存一份「戰鬥開打前」的快照：戰敗之後可以重來這場戰鬥（COMBAT_SYSTEM 8.4 節）。
   * 不成立（已經在打、沒有人上場）丟錯，狀態不變。
   */
  startBattle(setup: BattleSetup, o: { label?: string; snapshot?: boolean } = {}): Report[] {
    const draft = startBattle(this.k, this.state, setup)
    if (o.snapshot !== false) {
      const slot: SnapshotSlot = { id: `s${this.state.seq.uid + 1}`, kind: 'battle', label: o.label ?? '戰鬥開打前', raw: this.snapshotText(), data: { setup: clone(setup) as unknown as Record<string, unknown> } }
      draft.changes.push({ op: 'snapshot.drop', kind: 'battle' }, { op: 'snapshot.add', slot })
    }
    return this.commit(draft, { label: o.label ?? '開戰', turn: false })
  }

  private battleStep(make: () => ReportDraft): BattleStepResult {
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    let draft: ReportDraft
    try {
      draft = make()
    } catch (e) {
      if (e instanceof BattleBlocked) return { status: 'refused', reports: [], reasons: e.reasons, over: !!this.state.battle?.result }
      throw e
    }
    // 併進最新一樓：戰鬥裡的每一步不另留回退（回退回到開打之前）；也不算一個回合
    const reports = this.commit(draft, { attach: true, turn: false })
    return { status: 'applied', reports, over: !!this.state.battle?.result }
  }

  /** 玩家的一步。做不成回傳 refused 與每一條原因（缺的是哪個條件），狀態不變。 */
  battleAct(input: BattleInput): BattleStepResult {
    return this.battleStep(() => battleAct(this.k, this.state, input))
  }

  /** AI 的一步（輪到 AI 操縱的人時呼叫）。anyone：輪到玩家的人時也由程式代打（自動戰鬥、沒有畫面的測試）。 */
  battleNext(o: { anyone?: boolean } = {}): BattleStepResult {
    return this.battleStep(() => battleAuto(this.k, this.state, o))
  }

  /**
   * 戰鬥分出結果之後的結算：跑 battle_end 這條鏈（結算 → 寫正文 → 套用）。套用之後 state.battle 變回 null，
   * 這場戰鬥每一步的報告收成一份 combat 報告；AI 關閉時只有戰報（摘要）。
   */
  finishBattle(opts: ActOptions = {}): Promise<ActResult> {
    return this.runChain('battle_end', null, opts, '戰鬥結束')
  }

  /** 現在的狀態存成一份快照的文字（快照裡不再包快照）。 */
  private snapshotText(): string {
    const copy = clone(this.state)
    copy.snapshots = []
    return packSave(copy, saveMeta(copy, 'snapshot', ''))
  }

  /**
   * 回到一份快照那一刻（保留之後的紀錄；見 rewind）。比它晚存的快照與它自己一起丟掉，比它早的留著。
   * 失敗回傳錯誤訊息；成功回傳 null。
   */
  rewindTo(id: string, opts: { summary: string }): string | null {
    const i = this.state.snapshots.findIndex((x) => x.id === id)
    if (i < 0) return '沒有這份快照。'
    const keep = clone(this.state.snapshots.slice(0, i))
    return this.rewind(this.state.snapshots[i]!.raw, opts, keep)
  }

  /**
   * 重來這場戰鬥（COMBAT_SYSTEM 8.4 節：任何難度、任何存檔規則下都可以）：回到開打之前，照同一份設定再開打一次。
   * 紀錄、性經歷、記憶留著；骰子不保證和上一次一樣。沒有快照回傳錯誤訊息；成功回傳 null。
   */
  retryBattle(summary = '你回到開打之前。剛才那一場像一段太真的預演。'): string | null {
    const slot = [...this.state.snapshots].reverse().find((x) => x.kind === 'battle')
    const setup = slot?.data?.setup as BattleSetup | undefined
    if (!slot || !setup) return '沒有這場戰鬥開打前的快照。'
    const err = this.rewindTo(slot.id, { summary })
    if (err) return err
    this.startBattle(setup, { label: slot.label })
    return null
  }

  // ---- 格子地圖（MIGRATION E 的 grid、specialMaps；dev/adr/0012） ----

  /** 現在這一張圖：看過的格子、站的位置、這一格能做的事、四個方向能不能走。不在格子地圖上是 null。 */
  gridView(): GridView | null {
    return gridView(this.k, this.state)
  }

  /** 開一份地圖的實例並站進去（留一步回退）。回傳實例的 id。 */
  enterMap(defId: string, o: OpenMapOpts & { label?: string } = {}): string {
    const { id, changes } = openMap(this.k, this.state, defId, o)
    this.commit({ kind: 'action', action: 'grid.enter', location: clone(this.state.location), party: [], timeline: [], changes, outcome: { result: 'entered', summary: '進到一張地圖裡。' } }, { label: o.label ?? '進地圖' })
    return id
  }

  /**
   * 在格子地圖上走：一個方向（一格），或一個目的地（照最短路走，遇到事情就停）。
   * 走不過去回傳 refused 與原因，狀態不變。走到敵人那一格就開打：這一步提交之後接著開戰（state.battle 有了）。
   */
  gridMove(to: GridDir | [number, number]): { status: 'applied' | 'refused'; reason?: string; reports: Report[] } {
    let walked: ReturnType<typeof gridWalk>
    try {
      walked = gridWalk(this.k, this.state, to)
    } catch (e) {
      if (e instanceof GridBlocked) return { status: 'refused', reason: e.reason, reports: [] }
      throw e
    }
    // 走路併進最新一樓：不另留回退；接著的事（事件、開打）各自提交
    const reports = this.commit(walked.draft, { attach: true })
    for (const f of walked.followUps) reports.push(...this.commit(f, { attach: true }))
    if (walked.battle) reports.push(...this.startBattle(walked.battle))
    return { status: 'applied', reports }
  }

  /** 打包成一份存檔的文字。savedAt 由外面給（引擎不看時鐘）。 */
  save(kind: SaveMeta['kind'] = 'manual', savedAt = '', label?: string): string {
    const originName = (id: string) => this.k.content.get('origin', id)?.name as string | undefined
    return packSave(this.state, saveMeta(this.state, kind, savedAt, label, originName))
  }

  /**
   * 讀一份存檔的文字。失敗時回傳錯誤訊息，狀態、回退、進行中的鏈都不變；成功回傳 null。讀檔之後不能回退到讀檔之前。
   * 讀檔修復（save.loaded 掛鉤）先在讀進來的那一份上做完，成功才換進來；修復失敗也算讀檔失敗。
   */
  load(raw: string): string | null {
    const r = unpackSave(raw)
    if (!r.ok) return r.error
    const next = r.file.state
    let reports: Report[] = []
    try {
      // 讀檔修復：功能回傳變更，有才提交一份報告
      const changes = this.k.hooks.run('save.loaded', { state: next, fromVersion: r.fromVersion }).flatMap((x) => x.result)
      if (changes.length) {
        reports = [commitReport(this.k, next, { kind: 'system', action: 'save.repair', location: clone(next.location), party: [], timeline: [], changes, outcome: { result: 'repaired', summary: '讀檔時修了幾樣東西。' } })]
      }
    } catch (e) {
      return `讀檔時的修復沒有成功，這份存檔沒有讀進來（${(e as Error).message}）。`
    }
    this.last?.run.cancel()
    replaceInPlace(this.state, next)
    this.undo.clear()
    this.last = null
    this.notify(reports)
    return null
  }

  /**
   * 回到一份存檔那一刻，但保留之後的紀錄（SERIES 第 6 節：委託副本的撤退、戰敗後的回退）。
   * raw 是之前用 save() 留下的快照（進入口時、每個階段開始時、每場戰鬥開打前）；它必須是這一局更早的狀態。
   * - 生命、錢、時間、物品、旗標……全部回到快照那一刻；亂數的位置也回去。
   * - 快照之後的報告留在紀錄裡，標成 retracted（被收回的經歷）；流水號接著往下走，不重複。
   * - 功能要保留自己那一塊（性經歷、共同記憶）：掛 rewind.keep，回傳變更。
   * - 最後提交一份報告交代這件事，summary 是那一段特別的敘述（由發起的功能寫）。
   * 失敗時回傳錯誤訊息，狀態不變；成功回傳 null。之後不能回退到這之前。
   */
  rewind(raw: string, opts: { summary: string }, keepSnapshots?: SnapshotSlot[]): string | null {
    const r = unpackSave(raw)
    if (!r.ok) return r.error
    const next = r.file.state
    const current = this.state
    const kept = next.reports.length
    if (kept > current.reports.length || next.reports.some((x, i) => current.reports[i]!.id !== x.id)) return '這份快照不是這一局更早的狀態，不能用來撤退。'
    let reports: Report[] = []
    try {
      const changes = this.k.hooks.run('rewind.keep', { current, restored: next }).flatMap((x) => x.result)
      next.reports = [...next.reports, ...current.reports.slice(kept).map((x) => ({ ...clone(x), retracted: true }))]
      next.chains = clone(current.chains)
      next.seq = { ...current.seq }
      // 快照跟著現在的走：沒有指定就留著現在的每一份（rewindTo 會只留比那一份早的）
      next.snapshots = clone(keepSnapshots ?? current.snapshots)
      reports = [commitReport(this.k, next, { kind: 'system', action: 'rewind', location: clone(next.location), party: [], timeline: [], changes, outcome: { result: 'rewound', summary: opts.summary } })]
    } catch (e) {
      return `沒有辦法回到那一刻（${(e as Error).message}）。`
    }
    this.last?.run.cancel()
    replaceInPlace(this.state, next)
    this.undo.clear()
    this.last = null
    this.notify(reports)
    return null
  }

  /** 回退 n 步。回退的時候進行中的鏈被取消，那一樓的任務鏈一起消失（它在狀態裡）。成功回傳 true；n 不是正整數或沒有那麼多步回傳 false。 */
  undoSteps(n = 1): boolean {
    const restored = this.undo.pop(n)
    if (!restored) return false
    this.last?.run.cancel()
    this.last = null
    replaceInPlace(this.state, restored)
    this.notify([])
    return true
  }

  /**
   * 現在是星期幾、哪個時段（照這一局的時段規則算；畫面不自己算）。
   * weekday 是日曆的星期（0＝週一；午夜換日），segmentWeekday 是這個時段算在星期幾（深夜跨過午夜算前一天），
   * daysToMonday 是離下一個收租日（週一）還有幾天（今天就是的話是 0）。
   */
  clock(): { weekday: Weekday; segment: SegmentId; segmentWeekday: Weekday; daysToMonday: number } {
    const t = this.state.time, rules = this.k.timeRules
    return { weekday: weekdayOf(t, rules), segment: segmentOf(t, rules), segmentWeekday: segmentWeekdayOf(t, rules), daysToMonday: daysUntilWeekday(t, 0, rules) }
  }
}
