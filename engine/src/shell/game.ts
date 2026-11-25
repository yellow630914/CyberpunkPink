// L7 外殼：一局遊戲的門面。ui 的 store 包住的就是這個：呼叫它的動作、拿回報告、把狀態交給畫面。
// 這裡不寫規則，只把核心、功能、AI 任務鏈、存檔與回退接在一起。

import type { BattleInput, BattleState, Change, GameState, Launch, Origin, Report, ReportDraft, SegmentId, SnapshotSlot, Weekday } from '../core/types'
import type { Feature, Kernel } from '../core/kernel'
import { contentWarnings, createKernel, readyFeatures } from '../core/kernel'
import type { ContentPack } from '../core/content/registry'
import { ActionBlocked } from '../core/action/action'
import type { ActionInput } from '../core/action/kinds'
import { battleSetupWithOrigin } from '../core/action/coreActivities'
import { commitTurnIn } from '../core/action/turn'
import type { BattleSetup } from '../core/battle/setup'
import type { GridDir } from '../core/grid/model'
import type { GridView, OpenMapOpts } from '../core/grid/walk'
import { GridBlocked, gridView, gridWalk, openMap } from '../core/grid/walk'
import type { BattleOptions } from '../core/battle/step'
import { BattleBlocked, abortBattle, battleAct, battleAuto, battleOptions, pendingDefeat, startBattle } from '../core/battle/step'
import { modeOf, statusRuleOf } from '../core/battle/rules'
import { blankState } from '../core/state/blank'
import type { CommitTx } from '../core/state/commit'
import { commitAtomic, commitReport, commitReportAll } from '../core/state/commit'
import { sanitizeRules } from '../core/state/saveRules'
import { clone, replaceInPlace } from '../core/util/clone'
import { isRecord } from '../core/util/sanitize'
import { daysUntilWeekday, segmentOf, segmentWeekdayOf, weekdayOf } from '../core/util/time'
import type { ChainEnv, ChainStatus, StepRequest } from './ai/chain'
import { ChainRegistry, ChainRun } from './ai/chain'
import type { SceneInput, SceneSetup } from '../features/scene'
import { sceneAct, sceneInterrupt, sceneNext, sceneRawOf, sceneSkip } from '../features/scene'
import type { BattleEndInput } from './battle'
import { battleEndChain } from './battle'
import type { NarratedInput } from './narrated'
import { NARRATED_CHAIN, NARRATED_GATE_CHAIN, narratedChain } from './narrated'
import { hasAiGate } from './ai/eventGate'
import { freeActionChain, registerFreeActionTasks } from './ai/freeAction'
import type { AdultActionInput, SceneRoundInput, SceneRoundMode } from './ai/sceneChains'
import { ADULT_ACTION_CHAIN, DIRECTION_MAX, SCENE_ROUND_CHAIN, adultActionChain, aiTurnNeeded, sceneRoundChain } from './ai/sceneChains'
import { registerSceneTasks } from './ai/sceneTasks'
import type { PartChainInput } from './ai/partChain'
import { PART_CHAIN, partChain } from './ai/partChain'
import { PART_TASK, registerPartTask } from './ai/partTask'
import { deliverBlock, deliverDraft } from '../features/unreg'
import type { Provider, ProviderSource } from './ai/provider'
import { Limiter } from './ai/provider'
import type { AiSettings } from './ai/settings'
import { ProviderHub, partAiOf, sanitizeAiSettings, sceneAiOf } from './ai/settings'
import type { TaskEnv } from './ai/tasks'
import { IDLE_TIMEOUT_MS, TaskRegistry } from './ai/tasks'
import type { SaveMeta } from './save'
import { packSave, saveMeta, snapshotText, unpackSave } from './save'
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
  /** 提醒（玩家寫的寫法指令被截到 200 字、AI 關著指令用不到）；沒有提醒就沒有這個鍵 */
  notices?: string[]
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

/** commitNarrated 的選項（dev/adr/0016 第二節）。 */
export interface NarratedOptions extends ActOptions {
  /** 寫正文的模式（new、continue、rewrite……；AI_TASKS 3.1 節）：給 narrate 任務的 mode */
  mode: string
  /** 回退選單上這一步的名字；沒給用報告的摘要 */
  label?: string
  /** 併進最新一樓：不另留一步回退（同 CommitOptions.attach；買東西的帳、坐車的時間這類） */
  attach?: boolean
  /**
   * 玩家寫的寫法指令（戰敗事件的正文；COMBAT_SYSTEM 8.3 節）：最多 200 字，超過截斷並提醒；原樣放進寫正文的 <direction>，我們這端不篩選、不改寫、不提示
   * （使用者 2026-11-25）；AI 關著時不收、回傳提醒。只影響經過與文風，結果與分支不受影響。
   */
  direction?: string
}

/** 成人場景的一個入口（sceneBegin、sceneStep、sceneFinish）的結果。 */
export interface SceneResult {
  status: ActStatus
  /** 提交的報告；沒有提交（被擋下、停在半路）是空的 */
  reports: Report[]
  reason?: string
  /** 有走任務鏈時的那一條（任務鏈列看得到每一步） */
  run?: ChainRun
  /** 提醒：玩家寫的指令被截斷、AI 關著指令用不到 */
  notices: string[]
  /** 這一步之後場景結束了 */
  ended: boolean
  /** sceneBegin：這一步之後場景開起來了（可能進場景的行動，scene_gate 不讓進時是 false） */
  started?: boolean
}

/** 成人場景的 AI 走到哪裡：pure 沒有 AI（照功能的純函式）；text 只有結束之後整場的正文；closing 加上進場與收尾；full 加上每回合。 */
export type SceneRoute = 'pure' | 'text' | 'closing' | 'full'

/** sceneBegin 的選項：origin 與 label 只用在直接給場景設定的那一種；ActOptions 用在走任務鏈的那一種。 */
export interface SceneBeginOptions extends ActOptions {
  origin?: Origin
  label?: string
}

/** sceneFinish 的選項：怎麼結束（預設玩家按停下）、玩家寫的寫法指令（略過時填；最多 200 字）。 */
export interface SceneFinishOptions {
  how?: 'stop' | 'skip' | 'interrupt'
  direction?: string
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

/** 報告的 launch 最多連開幾層（開出來的活動的開始報告自己又帶 launch……）；超過丟錯，防止兩個功能互相觸發個沒完（dev/adr/0016 第二節）。 */
export const MAX_LAUNCH_DEPTH = 4

/** 找不到那種快照的原因（給玩家看的完整句子）。 */
const noSnapshotOfKind = (kind: string): string => `沒有「${kind}」這種快照，回不去。`

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
   * 最新一條鏈、它開始前的狀態、它套用完那一刻的報告流水號（還沒套用是 null）、它有沒有另留一步回退（pushed；attach 的鏈沒有）。
   * 最新一樓可以在套用之後重試；流水號對不上，表示之後又有別的提交，這條鏈就只能回退。
   */
  private last: { run: ChainRun; before: GameState; seqAfter: number | null; pushed: boolean } | null = null
  private listeners: Listener[] = []
  /** 正在跑 part_unreg 的那幾筆（同一筆同時只跑一條；Game.unregDeliver） */
  private unregBusy = new Map<string, Promise<ActResult>>()
  private taskEnv: TaskEnv
  /** 任務鏈的環境：套用時的提交走 commitWithLaunch（報告帶的 launch 在同一次提交裡開；開不成整條鏈的套用不成立） */
  private readonly chainEnv: ChainEnv

  constructor(opts: GameOptions = {}) {
    this.k = createKernel(opts.features ?? [])
    this.k.strict = opts.strict ?? false
    // 變更 snapshot.take 存快照用的序列化函式：外殼注入，內容就是戰鬥開打前存快照的那一份文字（dev/adr/0016 第二節）
    this.k.serialize = snapshotText
    for (const pack of opts.content ?? []) this.k.content.loadPack(pack)
    const dangling = this.k.content.checkRefs()
    if (dangling.length) throw new Error(`內容的引用斷了：${dangling.slice(0, 5).join('；')}`)
    readyFeatures(this.k)
    this.settings = sanitizeAiSettings(opts.ai)
    this.hub = new ProviderHub(opts.sources ?? {}, opts.fakeProvider ?? null)
    this.tasks = new TaskRegistry(this.k.probe)
    this.taskEnv = { hub: this.hub, limiter: this.limiter, probe: this.k.probe, now: opts.now ?? (() => Date.now()), idleTimeoutMs: opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS }
    this.chainEnv = { k: this.k, tasks: this.tasks, taskEnv: this.taskEnv, commit: (draft) => this.commitWithLaunch(draft, true) }
    registerFreeActionTasks(this.k, this.tasks)
    registerSceneTasks(this.k, this.tasks)
    registerPartTask(this.k, this.tasks)
    this.chains.register(freeActionChain())
    this.chains.register(adultActionChain())
    this.chains.register(sceneRoundChain())
    this.chains.register(battleEndChain())
    this.chains.register(narratedChain())
    this.chains.register(narratedChain(true))
    this.chains.register(partChain())
    this.state = blankState(0)
  }

  /** 資料檢查的警告（格式合格、但多半不是你要的；不擋載入）：載入的內容與裝上的功能決定。給世界編輯器與介面的資料頁看。 */
  contentWarnings(): string[] {
    return contentWarnings(this.k)
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
      // 開局的報告帶 launch 也照順序開（開不成整個開局不成立，原本那一局不動）
      for (const d of Array.isArray(drafts) ? drafts : [drafts]) {
        reports.push(...commitAtomic(this.k, fresh, (tx) => {
          const made = this.settleIn(tx, d, true)
          this.rewindIn(tx, made)
          return made
        }))
      }
    }
    this.last?.run.cancel()
    replaceInPlace(this.state, fresh)
    this.undo.clear()
    this.last = null
    this.notify(reports)
    return reports[0]!
  }

  /**
   * 等著玩家三選一的戰敗（COMBAT_SYSTEM 8.4 節：接受結果、重來這場戰鬥、回到這個階段開始時）；沒有在等是 null。
   * 打輸或投降的那一場結算之後、開打前的快照還留著的期間就是在等：接受（提交的報告把那份快照丟掉）、重來、回到更早的快照，才會離開。
   */
  get pendingDefeat(): { snapshot: string; battle: string; outcome: string } | null {
    return pendingDefeat(this.state)
  }

  /**
   * 現在這件事做不做得成（不變式第 48、59 條）：回傳擋住的原因（給玩家看的完整句子），可以做回傳 null。什麼都不改。
   * 只是問活動的登錄表（k.activity.blockOf；dev/adr/0016）：進行中的每一個活動照 order 都要放行，第一個不放行的給原因。
   * 核心內建的兩個：
   * - 戰鬥中只能做戰鬥的事（戰鬥的每一步、結束的結算、重來）：別的報告、別的任務鏈、走地圖都擋下。
   * - 有等著選的戰敗時，只能三選一：重來、回到快照，或提交一份把開打前的快照丟掉的報告（接受結果）。
   * 其餘的活動（事件、成人場景、委託副本）由功能登記。
   * doing：chain:<鏈的 id>、commit:<報告的 action>、<種類>.start、battle.retry、rewind:<快照的種類>、grid.enter、grid.move。
   * launch：問的是「開一段活動」時，要開的是哪一段（帶條件的放行看它的 origin：戰敗只放自己開的事件與戰鬥）。
   */
  blockOf(doing: string, draft?: ReportDraft, launch?: Launch): string | null {
    return this.k.activity.blockOf(this.state, doing, draft, launch)
  }

  /** 上一條鏈停在半路（等玩家處理）就做了別的事：那一條作廢，它留的那一步回退也拿掉。 */
  private abandonPaused(): void {
    if (this.last?.run.status !== 'paused') return
    this.last.run.cancel()
    if (this.last.pushed) this.undo.drop()
    this.last = null
  }

  /** 這一步裡有一份報告帶 rewind、而且做了：回到快照之後不能回退到這之前（和 rewind 一樣），最新的鏈也不能再重試。 */
  private afterRewind(): void {
    this.last?.run.cancel()
    this.undo.clear()
    this.last = null
  }

  /**
   * 提交一份程式結算的報告（不經過 AI 的動作：建角的確認、買賣、穿脫……）。
   * 預設留一步回退；opts.attach 是併進最新一樓、不另留回退。第二個參數給字串就是 label。
   * 不合法時丟 ChangeError：狀態完全不變，能回退的步數也不變。任務鏈還在跑的時候不能提交（丟錯）。
   * 戰鬥中、或有等著選的戰敗時，別的報告不收：丟 ActionBlocked（reason 是給玩家看的原因；見 blockOf），狀態不變。
   * 這之後，更早套用的那條鏈就不能再重試、重擲（只能回退）：重試會把這一份提交一起抹掉。
   * 停在半路等玩家的鏈則作廢（和開始新的行動一樣）。
   * 報告帶 launch（dev/adr/0016）：提交之後照順序開那些活動，開出來的報告接在回傳的後面；和這份報告是同一步回退、不另算一個回合。
   * 任何一個開不成，整步不成立：狀態回到這一步之前（含這份報告本身），丟 ActionBlocked（原因是那個活動給的）。
   * 報告帶 rewind（dev/adr/0016 第二節）：提交完（開活動之後）回到最近一份那個種類的快照（見 rewindToKind）；找不到那種快照，
   * 整步不成立（同 launch 的回滾，丟 ActionBlocked）。回到快照之後不能回退到這之前，回傳的報告標成被收回、最後多一份交代這件事的。
   */
  commit(draft: ReportDraft, opts: string | CommitOptions = {}): Report[] {
    const block = this.blockOf(`commit:${draft.action}`, draft)
    if (block) throw new ActionBlocked(block)
    return this.commitNow(draft, opts)
  }

  /** 提交（不問 blockOf）：門面自己的入口已經問過了才用它。報告帶的 launch 一起處理（見 commitWithLaunch）。 */
  private commitNow(draft: ReportDraft, opts: string | CommitOptions = {}): Report[] {
    const o: CommitOptions = typeof opts === 'string' ? { label: opts } : opts
    // 鏈還在跑的時候不能插進別的提交：那條鏈的每一步都是照開始時的狀態算的
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    const before = o.attach ? null : clone(this.state)
    const reports = this.commitWithLaunch(draft, o.turn !== false)
    this.abandonPaused()
    if (reports.some((r) => r.rewind)) this.afterRewind()
    else if (before) this.undo.pushSnapshot(before, o.label ?? draft.outcome.summary)
    this.notify(reports)
    return reports
  }

  // ---- 活動的開始：報告的 launch 與 Game.launch（dev/adr/0016 第一、二節） ----

  /**
   * 提交一份報告，連同它（與回合結束的流程帶出來的每一份報告）的 launch，最後做報告帶的 rewind：整件事是一次提交（commitAtomic）。
   * turn 是 false 時只提交報告、不跑回合結束的流程。任何一個 launch 開不成、或 rewind 找不到快照，整件事不成立：
   * 狀態回到這一步之前（含那份報告本身），丟 ActionBlocked；連開超過 MAX_LAUNCH_DEPTH 層丟一般的錯（狀態一樣不動）。
   * 任務鏈的套用（ChainEnv.commit）、commit 都走這裡。回傳的第一份是報告本身，開出來的報告接在後面，有 rewind 的最後是交代回到快照的那一份。
   */
  private commitWithLaunch(draft: ReportDraft, turn: boolean): Report[] {
    return commitAtomic(this.k, this.state, (tx) => {
      const reports = this.settleIn(tx, draft, turn)
      this.rewindIn(tx, reports)
      return reports
    })
  }

  /** 在一次提交裡：提交一份報告（回合流程或單純的報告），再照順序開它們帶的 launch。 */
  private settleIn(tx: CommitTx, draft: ReportDraft, turn: boolean): Report[] {
    const reports = turn ? commitTurnIn(this.k, tx, draft) : tx.commit(draft)
    this.launchAll(tx, reports)
    return reports
  }

  /**
   * 照順序處理每一份報告的 launch；開出來的報告自己帶的 launch 接著處理（深度優先，層數照 MAX_LAUNCH_DEPTH）。
   * 開出來的報告（連同它們再開出來的）接在 reports 後面，順序就是提交的順序。
   */
  private launchAll(tx: CommitTx, reports: Report[], depth = 1): void {
    for (const r of [...reports]) {
      for (const l of r.launch ?? []) {
        if (depth > MAX_LAUNCH_DEPTH) throw new Error(`活動連開超過 ${MAX_LAUNCH_DEPTH} 層（${r.action ?? r.id} 還在開 ${l.kind}），可能是兩個功能互相觸發。`)
        const made = this.launchIn(tx, l)
        this.launchAll(tx, made, depth + 1)
        reports.push(...made)
      }
    }
  }

  /**
   * 開一段活動：問放行（<種類>.start；看的是這一次提交到目前為止的狀態）、k.activity.start 拿到草稿、接著提交（不算一個回合，不另留回退）。
   * 開不成丟 ActionBlocked。戰鬥照原本的 startBattle：開打前的快照照舊（存的是開打之前、這份報告之後的狀態），
   * origin 的 by、ref 與 ext 併進 setup.origin.ext（所以重來這場戰鬥時 origin 還在）。
   */
  private launchIn(tx: CommitTx, l: Launch): Report[] {
    const block = this.k.activity.blockOf(tx.work, `${l.kind}.start`, undefined, l)
    if (block) throw new ActionBlocked(block)
    const origin: Origin = l.origin ?? { by: 'core' }
    const setup = l.kind === 'battle' && isRecord(l.setup) ? battleSetupWithOrigin(l.setup as unknown as BattleSetup, origin) : l.setup
    const drafts = this.k.activity.start(this.k, tx.work, l.kind, setup, origin)
    const out: Report[] = []
    drafts.forEach((d, i) => {
      if (l.kind === 'battle' && i === 0) d.changes.push(...this.battleSnapshotChanges(tx.work, setup as BattleSetup))
      out.push(...tx.commit(d))
    })
    return out
  }

  /**
   * 開一段活動（對外的入口）：先問放行（<種類>.start），再照種類開始。留一步回退（開始一段活動是玩家的一個動作；
   * 和 startBattle、enterMap 一樣）；開出來的報告自己帶的 launch 接著開。回傳提交的報告，開始的報告在前。
   * 不成立（被擋下、沒有這種活動、活動自己開不成）丟 ActionBlocked，狀態與回退的步數都不變。
   */
  launch(kind: string, setup: unknown, origin?: Origin, o: { label?: string } = {}): Report[] {
    const block = this.blockOf(`${kind}.start`, undefined, { kind, setup, ...(origin ? { origin } : {}) })
    if (block) throw new ActionBlocked(block)
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    const before = clone(this.state)
    const reports = commitAtomic(this.k, this.state, (tx) => {
      const made = this.launchIn(tx, { kind, setup, ...(origin ? { origin } : {}) })
      this.launchAll(tx, made)
      this.rewindIn(tx, made)
      return made
    })
    this.abandonPaused()
    if (reports.some((r) => r.rewind)) this.afterRewind()
    else this.undo.pushSnapshot(before, o.label ?? (kind === 'battle' ? '開戰' : (reports[0]?.outcome.summary ?? kind)))
    this.notify(reports)
    return reports
  }

  /**
   * 自由行動：跑 free_action 這條鏈。資料寫了 chain: adult_action 的種類（誘惑 flirt）轉到 adult_action 這條鏈（可能進成人場景；
   * 和 sceneBegin({ action }) 同一條，對象是 input.target）。
   */
  act(input: ActionInput, opts: ActOptions = {}): Promise<ActResult> {
    if (this.k.actions.get(input.kind)?.chain === ADULT_ACTION_CHAIN) return this.runChain(ADULT_ACTION_CHAIN, { action: input }, opts, input.text || input.kind)
    return this.runChain('free_action', input, opts, input.text || input.kind)
  }

  /**
   * 跑一條任務鏈。行動被擋下（ActionBlocked）不丟錯：回傳 status 'refused' 與原因，狀態不變、不留回退。
   * 程式的錯誤（沒有這種行動、鏈的程式步驟出錯）照樣丟出來，狀態不變。
   */
  runChain(chainId: string, input: unknown, opts: ActOptions = {}, label = chainId): Promise<ActResult> {
    return this.startChain(chainId, input, opts, label, { doing: `chain:${chainId}` })
  }

  /**
   * 結算之後寫正文（dev/adr/0016 第二節）：給定的報告草稿（功能用純函式算好的結算）→ 寫正文（narrate；草稿帶 adult 走成人路由）→ 套用，
   * 跑通用的鏈 narrated，不替任何功能另開一條。M2 的移動、交易、休息、事件、打工、副本的階段、場景的結束都走它。
   * - 放行問 commit:<草稿的 action>（和 commit 同一個；戰鬥中、等著選的戰敗、別的活動進行中都擋，回傳 refused 與原因，狀態不變、不留回退）。
   * - AI 關著、或設定關掉寫正文時（settings.ai、settings.narrate），報告沒有正文，其餘和 commit 一樣：同一份草稿、同一份變更。
   * - 重試、用規則代替、重擲照現有的鏈（retryStep、useRules）；停在半路等玩家時，狀態還沒有被改。
   * - 套用之後照常處理草稿的 launch 與 rewind（見 commit）；開不成或找不到快照，整步不成立，回傳 refused。
   * - 預設留一步回退；opts.attach 是併進最新一樓、不另留（同 commit）。
   */
  async commitNarrated(draft: ReportDraft, opts: NarratedOptions): Promise<ActResult> {
    if (!opts || typeof opts.mode !== 'string' || !opts.mode) throw new Error('commitNarrated 要給寫正文的模式（mode）。')
    const dir = this.directionFor(opts.direction, this.narrateLive())
    const input: NarratedInput = { draft, mode: opts.mode, ...(dir.text ? { direction: dir.text } : {}) }
    // 事件的場景要問 scene_gate（adult_scene.gate: ai）：走 narrated_gate（多 gate、setup 兩步；M4-followups-2 第 7 項）；AI 關著時那兩步走退路，launch 不動
    const r = await this.startChain(hasAiGate(draft) && !!this.state.pc ? NARRATED_GATE_CHAIN : NARRATED_CHAIN, input, opts, opts.label ?? draft.outcome.summary, { doing: `commit:${draft.action}`, draft, attach: opts.attach === true })
    return dir.notices.length > 0 ? { ...r, notices: dir.notices } : r
  }

  /** runChain 與 commitNarrated 共用：o.doing 是問放行的那一個（draft 給 allows 看）；o.attach 是不另留一步回退。 */
  private async startChain(chainId: string, input: unknown, opts: ActOptions, label: string, o: { doing: string; draft?: ReportDraft; attach?: boolean }): Promise<ActResult> {
    const def = this.chains.get(chainId)
    if (!def) throw new Error(`沒有 ${chainId} 這條任務鏈`)
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    // 戰鬥中不能做別的事（探索用格子、戰鬥是另一個畫面；COMBAT_SYSTEM 第 10 節）：只有結束戰鬥的那條鏈可以跑。
    // 有等著選的戰敗時也一樣：先三選一（8.4 節）
    const block = this.blockOf(o.doing, o.draft)
    if (block) {
      return { status: 'refused', reason: block, run: new ChainRun(this.chainEnv, def, this.state, input, this.settings), reports: [] }
    }
    this.abandonPaused()
    const before = clone(this.state)
    const run = new ChainRun(this.chainEnv, def, this.state, input, this.settings)
    const pushed = !o.attach
    if (pushed) this.undo.pushSnapshot(before, label)
    this.last = { run, before, seqAfter: null, pushed }
    try {
      return await this.settle(run, await run.run(), opts)
    } catch (e) {
      // 這個行動沒有成立：狀態沒變（提交是原子的），回退那一步放回原樣
      if (this.last?.run === run) {
        if (pushed) this.undo.drop()
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
      // 套用的報告帶 rewind 而且做了：回到快照之後不能回退到這之前，這條鏈也不能再重試（重試會抹掉那次回到快照）
      if (mine && run.reports.some((r) => r.rewind)) this.afterRewind()
      else if (mine) this.last!.seqAfter = this.state.seq.report
      this.notify(run.reports)
    } else if (s === 'cancelled' && mine) {
      // 被取消（關掉 AI）：這個行動沒有成立，它留的那一步回退也拿掉（attach 的沒有留）。回退、讀檔造成的取消已經自己清過了
      if (this.last!.pushed) this.undo.drop()
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

  // ---- 未登錄零件交貨（M4-core-part-ai；dev/adr/0019 第十七節；AI_TASKS 3.20 節） ----

  /**
   * 替一件等著交貨的未登錄零件（features/unreg 的 pending）交貨，回傳 ActResult。外殼不在提交之後自己偷偷交：這是明確的入口，由介面或測試呼叫（種子重播才對得上）。
   * - AI 開著（總開關開、`partAi` 沒關、有服務商）：跑任務鏈 part_unreg（讀框架 → design_part 起名與怪癖 → 組交貨的草稿 → 寫正文 → 套用）。
   *   design_part 驗證不過重來最多 2 次，仍不過、被拒絕、逾時都用預設清單的文字交貨；零件的數字完全相同，差別只有名字、說明與怪癖的那一句。
   * - 否則直接 `commit(deliverDraft(k, state, { id }))`，不發任何請求；回傳的 run 是一條沒有跑的空鏈（每一步 skipped）。
   * 現在交不了（進行中的活動擋著、訂做的還沒到、查不到那一筆）丟 ActionBlocked（原因照功能與活動的），狀態不動、那一筆 pending 留著，之後再呼叫。
   * 同一筆同時只跑一條（再呼叫拿到同一個 Promise）；回退、讀檔、開新局時還在跑的那條被取消（回傳 status 'cancelled'），pending 還在，再叫一次就好。
   * 寫正文步驟失敗而停在半路（paused）時，鏈留著等玩家重試或用規則代替；opts.autoRules 自動改用規則。
   */
  unregDeliver(id: string, opts: ActOptions = {}): Promise<ActResult> {
    const live = this.unregBusy.get(id)
    if (live) return live
    const run = this.unregRun(id, opts).finally(() => { this.unregBusy.delete(id) })
    this.unregBusy.set(id, run)
    return run
  }

  /** 這一局交貨走不走 AI：總開關開、partAi 沒關、有人接得住 design_part。 */
  private partLive(): boolean {
    return this.settings.ai && partAiOf(this.settings) && this.hub.resolve(this.settings, PART_TASK) !== null
  }

  private async unregRun(id: string, opts: ActOptions): Promise<ActResult> {
    const block = deliverBlock(this.k, this.state, id)
    if (block) throw new ActionBlocked(block)
    const label = '收下未登錄零件'
    const input: PartChainInput = { id }
    if (this.partLive()) {
      const r = await this.startChain(PART_CHAIN, input, opts, label, { doing: 'commit:unreg.deliver' })
      // 行動本身被擋下（活動、或套用時開不成）：這個入口一律丟 ActionBlocked，狀態不變
      if (r.status === 'refused') throw new ActionBlocked(r.reason ?? '現在交不了貨。')
      return r
    }
    const reports = this.commit(deliverDraft(this.k, this.state, { id }), label)
    // 沒有跑任務鏈：回一條空的、每一步都略過的鏈，ActResult 的形狀和跑過的一樣
    const run = new ChainRun(this.chainEnv, this.chains.get(PART_CHAIN)!, this.state, input, this.settings)
    run.status = 'applied'
    run.reports = reports
    for (const s of run.steps) s.status = 'skipped'
    return { status: 'applied', run, reports }
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
   * 回傳提交的報告，第一份是 battle.start（開場的每一拍在它的 timeline：畫面放進戰鬥紀錄）。
   * 不成立（已經在打、沒有人上場）丟錯；有等著選的戰敗時丟 ActionBlocked。狀態不變。
   */
  startBattle(setup: BattleSetup, o: { label?: string; snapshot?: boolean } = {}): Report[] {
    if (this.state.battle) throw new Error('已經有一場戰鬥在進行。')
    const block = this.blockOf('battle.start', undefined, { kind: 'battle', setup })
    if (block) throw new ActionBlocked(block)
    const draft = startBattle(this.k, this.state, setup)
    draft.changes.push(...this.battleSnapshotChanges(this.state, setup, o))
    return this.commitNow(draft, { label: o.label ?? '開戰', turn: false })
  }

  /**
   * 開打前的快照的變更：上一場留下來的先丟（同一時間只留這一場的；這一場不留快照時也丟，免得打輸時標到別場的快照上），
   * 再存這一場的（state 是開打之前的狀態）。data.setup 是重來這場戰鬥時要照著再開的設定。
   */
  private battleSnapshotChanges(state: GameState, setup: BattleSetup, o: { label?: string; snapshot?: boolean } = {}): Change[] {
    const changes: Change[] = [{ op: 'snapshot.drop', kind: 'battle' }]
    if (o.snapshot !== false) {
      const slot: SnapshotSlot = { id: `s${state.seq.uid + 1}`, kind: 'battle', label: o.label ?? '戰鬥開打前', raw: snapshotText(state), data: { setup: clone(setup) as unknown as Record<string, unknown> } }
      changes.push({ op: 'snapshot.add', slot })
    }
    return changes
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
    const reports = this.commitNow(draft, { attach: true, turn: false })
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
  async finishBattle(opts: ActOptions & { direction?: string } = {}): Promise<ActResult> {
    // 玩家的寫法指令（COMBAT_SYSTEM 8.3 節）：最多 200 字，原樣放進寫正文；結果與分支不受影響
    const dir = this.directionFor(opts.direction, this.narrateLive())
    const input: BattleEndInput | null = dir.text ? { direction: dir.text } : null
    const r = await this.runChain('battle_end', input, opts, '戰鬥結束')
    return dir.notices.length > 0 ? { ...r, notices: dir.notices } : r
  }

  /**
   * 回到一份快照那一刻（保留之後的紀錄；見 rewind）。比它晚存的快照與它自己一起丟掉，比它早的留著。
   * 失敗回傳錯誤訊息；成功回傳 null。
   */
  rewindTo(id: string, opts: { summary: string; fresh?: boolean }): string | null {
    const i = this.state.snapshots.findIndex((x) => x.id === id)
    if (i < 0) return '沒有這份快照。'
    const keep = clone(this.state.snapshots.slice(0, i))
    return this.rewind(this.state.snapshots[i]!.raw, opts, keep)
  }

  /**
   * 回到最近一份這個種類的快照（dev/adr/0016 第二節；rewindTo 的包裝）：比它晚的快照與它自己一起丟掉，比它早的留著；
   * 之後的紀錄留著並標成被收回，summary 寫成一筆 system 的報告，rewind.keep 掛點照舊。
   * 報告帶 rewind 時外殼提交完會自己呼叫同一套（撤退、委託失敗都是一份帶 rewind 的報告，介面不直接呼叫這個）。
   * 直接呼叫的人先問 blockOf('rewind:<種類>')：這裡也問，被活動擋下回傳它的原因。
   * 找不到那種快照、回不去回傳原因（狀態不變）；成功回傳 null。
   * o.fresh（見 ReportRewind.fresh）：回去之後亂數的游標往前推，骰子不固定；一般的回退不給。
   */
  rewindToKind(kind: string, summary: string, o: { fresh?: boolean } = {}): string | null {
    const block = this.blockOf(`rewind:${kind}`)
    if (block) return block
    const slot = [...this.state.snapshots].reverse().find((x) => x.kind === kind)
    if (!slot) return noSnapshotOfKind(kind)
    return this.rewindTo(slot.id, { summary, ...(o.fresh ? { fresh: true } : {}) })
  }

  /**
   * 一步裡的 rewind（在 commitAtomic 裡面，提交完、開完活動之後）：這一步的報告裡有一份帶 rewind，就在同一次提交裡回到最近一份那個種類的快照。
   * 找不到快照、回不去，丟 ActionBlocked：整步不成立（狀態回到這一步之前，含那份報告本身；同 launch 開不成）。
   * 一步只能有一份帶 rewind 的報告。回傳的報告（reports）原地改：標成被收回、最後接上交代這件事的那一份。
   */
  private rewindIn(tx: CommitTx, reports: Report[]): void {
    const asked = reports.filter((r) => r.rewind)
    if (asked.length === 0) return
    if (asked.length > 1) throw new Error(`同一步裡有 ${asked.length} 份報告都帶 rewind（${asked.map((r) => r.action ?? r.id).join('、')}）：一步只能回到一份快照。`)
    const { kind, summary } = asked[0]!.rewind!
    const at = tx.work.snapshots.map((x) => x.kind).lastIndexOf(kind)
    if (at < 0) throw new ActionBlocked(noSnapshotOfKind(kind))
    const res = this.restoreFrom(tx.work, tx.work.snapshots[at]!.raw, summary, clone(tx.work.snapshots.slice(0, at)), asked[0]!.rewind!.fresh === true)
    if (typeof res === 'string') throw new ActionBlocked(res)
    replaceInPlace(tx.work, res.next)
    const retracted = new Set(res.next.reports.filter((r) => r.retracted).map((r) => r.id))
    reports.forEach((r, i) => { if (retracted.has(r.id)) reports[i] = { ...r, retracted: true } })
    // 交代回到快照的那一份，加上掛鉤（report.after）接著提交的（例：commission.failed）：都是這一步的報告
    reports.push(...res.reports)
  }

  /**
   * 重來這場戰鬥（COMBAT_SYSTEM 8.4 節：任何難度、任何存檔規則下都可以）：回到開打之前，照同一份設定再開打一次。
   * 紀錄、性經歷、記憶留著；骰子不保證和上一次一樣。
   * 只在兩個時候成立：這一場還在打（打到一半重新開始），或這一場打輸了、還在等玩家三選一。
   * 打贏、脫離、戰敗已經接受之後，開打前的快照已經丟掉，不能再重來（不然就是一個沒有步數限制的回退；不變式第 4 條）。
   * 打到一半重來的，先把這一場到現在的每一步收成一份報告（留在紀錄裡、標成被收回），不然重來幾次紀錄裡就多幾百筆。
   * 不成立回傳原因（狀態不變）；成功回傳 null。
   */
  retryBattle(summary = '你回到開打之前。剛才那一場像一段太真的預演。'): string | null {
    const fighting = this.state.battle
    const waiting = this.pendingDefeat
    const slot = fighting ? [...this.state.snapshots].reverse().find((x) => x.kind === 'battle') : waiting ? this.state.snapshots.find((x) => x.id === waiting.snapshot) : undefined
    const setup = slot?.data?.setup as BattleSetup | undefined
    if (!slot || !setup) return fighting ? '這一場開打前沒有留快照，不能重來。' : '沒有這場戰鬥開打前的快照。'
    if (this.last?.run.status === 'running') return '上一條任務鏈還在跑。'
    // 回不去的話（快照壞了）整件事不成立：連「把這一場收成一份」也收回去
    const before = fighting ? clone(this.state) : null
    if (fighting) this.commitNow(abortBattle(this.k, this.state), { attach: true, turn: false })
    const err = this.rewindTo(slot.id, { summary })
    if (err) {
      if (before) {
        replaceInPlace(this.state, before)
        this.notify([])
      }
      return err
    }
    this.startBattle(setup, { label: slot.label })
    return null
  }

  /**
   * 回到這個階段開始時（戰敗三選一的第三個；COMBAT_SYSTEM 8.4 節）：回到開打前那份快照之前最近的一份 `stage` 快照
   * （rewindTo：比它晚的快照一起丟掉）。沒有（副本以外的戰鬥）就等於重來這場戰鬥（retryBattle）。
   * 只在等玩家三選一時成立；不成立或回不去回傳原因（狀態不變），成功回傳 null。
   */
  rewindToStage(): string | null {
    const waiting = this.pendingDefeat
    if (!waiting) return '現在沒有在等戰敗的選擇。'
    const at = this.state.snapshots.findIndex((x) => x.id === waiting.snapshot)
    const stage = this.state.snapshots.slice(0, Math.max(0, at)).reverse().find((x) => x.kind === 'stage')
    if (!stage) return this.retryBattle()
    return this.rewindTo(stage.id, { summary: '你回到這個階段開始的時候。' })
  }

  // ---- 成人場景（dev/work/M4-core-scene-ai.md；AI_TASKS 3.5～3.8 節；dev/adr/0019 第十三節）：sceneBegin、sceneStep、sceneFinish ----

  /** 玩家寫的寫法指令：最多 DIRECTION_MAX 字（超過截斷並提醒）；原樣放進 prompt，不篩選、不改寫、不提示；live 是 false（AI 關著）時不收、提醒一句。 */
  private directionFor(raw: string | undefined, live: boolean): { text?: string; notices: string[] } {
    if (typeof raw !== 'string' || raw.trim() === '') return { notices: [] }
    const notices: string[] = []
    const chars = Array.from(raw)
    const text = chars.length > DIRECTION_MAX ? chars.slice(0, DIRECTION_MAX).join('') : raw
    if (chars.length > DIRECTION_MAX) notices.push(`指令最多 ${DIRECTION_MAX} 字，超過的部分沒有送出。`)
    if (!live) return { notices: [...notices, 'AI 關著，指令不會用到。'] }
    return { text, notices }
  }

  /** 寫正文有沒有人在寫：總開關開著、設定沒有關掉敘事、有服務商（真的或假的）。 */
  private narrateLive(): boolean {
    return this.settings.ai && this.settings.narrate && this.hub.resolve(this.settings, 'narrate', { adult: true }) !== null
  }

  /**
   * 成人場景的 AI 走到哪裡（照設定與有沒有服務商）。AI 關著（總開關關、沒有服務商）是 pure：三個入口直接呼叫功能的純函式、用 commit 提交，
   * 和介面現在直接呼叫的一樣；sceneAi 是 off 時只剩結束之後整場的正文（text）。
   */
  sceneRoute(): SceneRoute {
    if (!this.settings.ai || this.hub.resolve(this.settings, 'narrate', { adult: true }) === null) return 'pure'
    const m = sceneAiOf(this.settings)
    return m === 'off' ? 'text' : m
  }

  private sceneResult(status: ActStatus, o: Partial<SceneResult> = {}): SceneResult {
    return { status, reports: [], notices: [], ended: false, ...o }
  }

  /**
   * 開成人場景。給場景的設定（SceneSetup）就直接開（和 launch('scene', ...) 一樣，留一步回退）；給 { action, ... }（可能進場景的行動：誘惑、性交易、蜜罐的那一步）
   * 就跑 adult_action 這條鏈：擲骰 → 判定 → 結算上限 → scene_gate →（進）場景開起來，玩家可以玩，或在還沒有任何行動時略過（sceneFinish({ how: 'skip' })）/（不進）算回報、算關係、寫正文。
   * 做不成回傳 refused 與原因；started 是這一步之後場景有沒有開起來。
   */
  async sceneBegin(arg: SceneSetup | AdultActionInput, o: SceneBeginOptions = {}): Promise<SceneResult> {
    if (isRecord(arg) && isRecord(arg.action) && typeof arg.action.kind === 'string') {
      const input = arg as unknown as AdultActionInput
      const r = await this.startChain(ADULT_ACTION_CHAIN, input, o, input.action.text || input.action.kind, { doing: `chain:${ADULT_ACTION_CHAIN}` })
      return this.sceneResult(r.status, { reports: r.reports, run: r.run, ...(r.reason ? { reason: r.reason } : {}), started: sceneRawOf(this.state) !== null })
    }
    try {
      const reports = this.launch('scene', arg, o.origin ?? { by: 'shell' }, o.label ? { label: o.label } : {})
      return this.sceneResult('applied', { reports, started: true })
    } catch (e) {
      if (e instanceof ActionBlocked) return this.sceneResult('refused', { reason: e.reason, started: false })
      throw e
    }
  }

  /**
   * 場景的一步：輪到玩家時給一個行動（SceneInput；給 stop 就是 sceneFinish），輪到對方時不給（對方的一步）。
   * - pure：功能的純函式，用 commit 提交（逐欄和直接呼叫一樣）。
   * - text：同上；結束的那一步用 commitNarrated 寫整場的正文（和 M2 一樣）。
   * - closing：每一步照規則走；讓場景結束的那一步跑收尾段（reward、sex_record、sink、tendency、relate 同時跑 → SceneEnv.closing → 寫正文）。
   * - full：另外對方的每一步跑 scene_turn（同圈每個人依序各一次）、玩家說話與對方說話時跑 scene_talk。
   * 做不成（不是你的回合、行動點不夠……）回傳 refused 與功能給的原因，狀態不變。
   */
  async sceneStep(input?: SceneInput, opts: ActOptions = {}): Promise<SceneResult> {
    const scene = sceneRawOf(this.state)
    if (!scene) return this.sceneResult('refused', { reason: '現在沒有進行中的成人場景。' })
    if (input?.kind === 'stop') return this.sceneFinish({ how: 'stop' }, opts)
    const mode: SceneRoundMode = scene.turn === scene.pc ? 'pc' : 'npc'
    let d0: ReportDraft
    try {
      if (input) d0 = sceneAct(this.k, this.state, input)
      else if (mode === 'pc') return this.sceneResult('refused', { reason: '輪到你了：要給一個行動。' })
      else d0 = sceneNext(this.k, this.state)
    } catch (e) {
      if (e instanceof ActionBlocked) return this.sceneResult('refused', { reason: e.reason })
      throw e
    }
    const route = this.sceneRoute()
    const ended = d0.action === 'scene.end'
    const needsAi = route === 'full' && (mode === 'npc' ? aiTurnNeeded(scene) : input?.kind === 'talk')
    if (route === 'pure' || route === 'text' || (!ended && !needsAi)) return this.sceneCommit(d0, route, '場景', undefined, opts)
    const chainInput: SceneRoundInput = { mode, ...(mode === 'pc' ? { input } : {}) }
    return this.sceneRound(chainInput, d0, '場景', opts)
  }

  /**
   * 結束這一場：玩家按停下（how: 'stop'，預設）、略過（'skip'；還沒有任何行動時才行）、被外面打斷（'interrupt'）。
   * 略過時玩家可以寫一段指令（direction，最多 200 字）：收尾段的寫正文照它寫經過與文風，算性經歷與算傾向把它當參考；數字不受影響。
   * 玩家的指令不經篩選與改寫、原樣放進 prompt；AI 關著時不收，回傳提醒「AI 關著，指令不會用到。」照常結束。
   */
  async sceneFinish(o: SceneFinishOptions = {}, opts: ActOptions = {}): Promise<SceneResult> {
    const scene = sceneRawOf(this.state)
    if (!scene) return this.sceneResult('refused', { reason: '現在沒有進行中的成人場景。' })
    const how = o.how ?? 'stop'
    let d0: ReportDraft
    try {
      d0 = how === 'skip' ? sceneSkip(this.k, this.state) : how === 'interrupt' ? sceneInterrupt(this.k, this.state) : sceneAct(this.k, this.state, { kind: 'stop' })
    } catch (e) {
      if (e instanceof ActionBlocked) return this.sceneResult('refused', { reason: e.reason })
      throw e
    }
    const route = this.sceneRoute()
    const dir = this.directionFor(o.direction, route !== 'pure')
    const label = how === 'skip' ? '略過場景' : '場景結束'
    if (route === 'pure' || route === 'text') return this.sceneCommit(d0, route, label, dir, opts)
    return this.sceneRound({ mode: how, ...(dir.text ? { direction: dir.text } : {}) }, d0, label, opts, dir.notices)
  }

  /** pure 與 text：功能的草稿直接提交；結束的那一步在 text 時寫整場的正文。 */
  private async sceneCommit(d0: ReportDraft, route: SceneRoute, label: string, dir: { text?: string; notices: string[] } | undefined, opts: ActOptions): Promise<SceneResult> {
    const notices = dir?.notices ?? []
    const draft = d0
    const ended = d0.action === 'scene.end'
    try {
      if (route === 'text' && ended) {
        const r = await this.commitNarrated(draft, { ...opts, mode: 'new', label, ...(dir?.text ? { direction: dir.text } : {}) })
        return this.sceneResult(r.status, { reports: r.reports, run: r.run, ...(r.reason ? { reason: r.reason } : {}), notices, ended: r.status === 'applied' })
      }
      const reports = this.commit(draft, label)
      return this.sceneResult('applied', { reports, notices, ended })
    } catch (e) {
      if (e instanceof ActionBlocked) return this.sceneResult('refused', { reason: e.reason, notices })
      throw e
    }
  }

  /** closing 與 full：場景的一步走 scene_round 這條鏈。問放行時用功能那份草稿的 action（commit:scene.*，場景進行中放行）。 */
  private async sceneRound(input: SceneRoundInput, d0: ReportDraft, label: string, opts: ActOptions, notices: string[] = []): Promise<SceneResult> {
    const r = await this.startChain(SCENE_ROUND_CHAIN, input, opts, label, { doing: `commit:${d0.action}`, draft: d0 })
    return this.sceneResult(r.status, { reports: r.reports, run: r.run, ...(r.reason ? { reason: r.reason } : {}), notices, ended: r.status === 'applied' && sceneRawOf(this.state) === null })
  }

  // ---- 格子地圖（MIGRATION E 的 grid、specialMaps；dev/adr/0012） ----

  /** 現在這一張圖：看過的格子、站的位置、這一格能做的事、四個方向能不能走。不在格子地圖上是 null。 */
  gridView(): GridView | null {
    return gridView(this.k, this.state)
  }

  /** 開一份地圖的實例並站進去（留一步回退）。回傳實例的 id。 */
  enterMap(defId: string, o: OpenMapOpts & { label?: string } = {}): string {
    const block = this.blockOf('grid.enter')
    if (block) throw new ActionBlocked(block)
    const { id, changes } = openMap(this.k, this.state, defId, o)
    this.commitNow({ kind: 'action', action: 'grid.enter', location: clone(this.state.location), party: [], timeline: [], changes, outcome: { result: 'entered', summary: '進到一張地圖裡。' } }, { label: o.label ?? '進地圖' })
    return id
  }

  /**
   * 在格子地圖上走：一個方向（一格），或一個目的地（照最短路走，遇到事情就停）。
   * 走不過去回傳 refused 與原因，狀態不變。走到敵人那一格就開打：這一步提交之後接著開戰（state.battle 有了）。
   * 開不成戰（遭遇點寫了不存在的敵人、隊伍是空的）整步不成立：先試開打、成了才提交走路，不會人已經站過去、戰卻沒開（不變式第 3 條）。
   * 走這一步帶出來的 launch（GridEffect.launch）也是這一步的一部分：走路、接著的報告、它們的 launch、開打是一次提交，
   * 任何一個開不成（被活動擋下、活動自己開不成）整步不成立，回傳 refused 與原因。
   */
  gridMove(to: GridDir | [number, number]): { status: 'applied' | 'refused'; reason?: string; reports: Report[] } {
    const block = this.blockOf('grid.move')
    if (block) return { status: 'refused', reason: block, reports: [] }
    let walked: ReturnType<typeof gridWalk>
    try {
      walked = gridWalk(this.k, this.state, to)
      // 先試一次開打（只算、不改狀態）：開不成就整步不走
      if (walked.battle) startBattle(this.k, this.state, walked.battle)
    } catch (e) {
      if (e instanceof GridBlocked) return { status: 'refused', reason: e.reason, reports: [] }
      if (walked! && walked.battle) return { status: 'refused', reason: `這裡的戰鬥開不起來（${(e as Error).message}）。`, reports: [] }
      throw e
    }
    if (this.last?.run.status === 'running') throw new Error('上一條任務鏈還在跑。')
    // 走路併進最新一樓：不另留回退；接著的事（事件、開打）各自是一份報告，開戰另留一步回退（回到人已經站在那一格的時候）
    let beforeBattle: GameState | null = null
    let reports: Report[]
    try {
      reports = commitAtomic(this.k, this.state, (tx) => {
        const out = this.settleIn(tx, walked.draft, true)
        for (const f of walked.followUps) out.push(...this.settleIn(tx, f, true))
        if (walked.battle) {
          const blocked = this.k.activity.blockOf(tx.work, 'battle.start', undefined, { kind: 'battle', setup: walked.battle })
          if (blocked) throw new ActionBlocked(blocked)
          beforeBattle = clone(tx.work)
          const draft = startBattle(this.k, tx.work, walked.battle)
          draft.changes.push(...this.battleSnapshotChanges(tx.work, walked.battle))
          const started = tx.commit(draft)
          out.push(...started)
          this.launchAll(tx, started)
        }
        this.rewindIn(tx, out)
        return out
      })
    } catch (e) {
      if (e instanceof ActionBlocked) return { status: 'refused', reason: e.reason, reports: [] }
      throw e
    }
    this.abandonPaused()
    if (reports.some((r) => r.rewind)) this.afterRewind()
    else if (beforeBattle) this.undo.pushSnapshot(beforeBattle, '開戰')
    this.notify(reports)
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
    // 進行中的戰鬥要對得上這一局的內容：戰場與狀態都查得到（查不到的話，讀進來之後每一步都會丟錯，整局卡死）
    const broken = this.battleContentProblems(next)
    if (broken.length) return `存檔壞了（${broken.slice(0, 3).join('；')}）。`
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

  /** 存檔裡進行中的戰鬥用到的戰場、狀態，在這一局的內容裡查不查得到。 */
  private battleContentProblems(state: GameState): string[] {
    const b = state.battle
    if (!b) return []
    const p: string[] = []
    if (!modeOf(this.k.content, b.mode)) p.push(`battle：沒有 ${b.mode} 這個戰場`)
    const unknown = new Set<string>()
    for (const u of Object.values(b.units)) for (const st of u.statuses) if (!statusRuleOf(this.k.content, st.id)) unknown.add(st.id)
    if (unknown.size) p.push(`battle：不認得的狀態 ${[...unknown].join('、')}`)
    return p
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
  rewind(raw: string, opts: { summary: string; fresh?: boolean }, keepSnapshots?: SnapshotSlot[]): string | null {
    const res = this.restoreFrom(this.state, raw, opts.summary, keepSnapshots, opts.fresh === true)
    if (typeof res === 'string') return res
    this.last?.run.cancel()
    replaceInPlace(this.state, res.next)
    this.undo.clear()
    this.last = null
    this.notify(res.reports)
    return null
  }

  /**
   * 回到一份存檔那一刻的做法（純的：不碰 this.state）：算出回去之後的狀態與交代這件事的報告。rewind、rewindToKind、報告帶的 rewind 共用。
   * reports 的第一份是交代回到快照的那一份，之後是掛鉤（report.after）接著提交的報告（例：委託失敗的 commission.failed）：
   * 它們已經在 next.reports 裡，這裡一併回傳，呼叫的人放進回傳與通知的報告。
   * current 是現在的狀態（讀它，不改它）。失敗回傳錯誤訊息。規矩見 rewind。
   * fresh：亂數的游標接在「現在」之後再往前推一格（比快照的、比現在的都大），回去之後的骰子換一批；沒給就照快照的亂數（固定骰值）。
   */
  private restoreFrom(current: GameState, raw: string, summary: string, keepSnapshots?: SnapshotSlot[], fresh = false): { next: GameState; reports: Report[] } | string {
    const r = unpackSave(raw)
    if (!r.ok) return r.error
    const next = r.file.state
    const kept = next.reports.length
    if (kept > current.reports.length || next.reports.some((x, i) => current.reports[i]!.id !== x.id)) return '這份快照不是這一局更早的狀態，不能用來撤退。'
    try {
      const changes = this.k.hooks.run('rewind.keep', { current, restored: next }).flatMap((x) => x.result)
      next.reports = [...next.reports, ...current.reports.slice(kept).map((x) => ({ ...clone(x), retracted: true }))]
      next.chains = clone(current.chains)
      next.seq = { ...current.seq }
      if (fresh) next.rng = { seed: next.rng.seed, cursor: Math.max(next.rng.cursor, current.rng.cursor) + 1 }
      // 快照跟著現在的走：沒有指定就留著現在的每一份（rewindTo 會只留比那一份早的），
      // 但「戰鬥開打前」的那一種不留：回到更早的時間點之後，那一場已經不存在，留著只會變成一個隨時能用的回退
      next.snapshots = clone(keepSnapshots ?? current.snapshots.filter((x) => x.kind !== 'battle'))
      const reports = commitReportAll(this.k, next, { kind: 'system', action: 'rewind', location: clone(next.location), party: [], timeline: [], changes, outcome: { result: 'rewound', summary } })
      return { next, reports }
    } catch (e) {
      return `沒有辦法回到那一刻（${(e as Error).message}）。`
    }
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
