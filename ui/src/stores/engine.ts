import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ActionInput, Actor, AttributeEntry, BattleInput, BattleOptions, BattleSetup, BattleStepResult, Change, GameState, SkillEntry, OriginEntry, PerkEntry } from '@engine/src'
import { FakeProvider, Game, unpackSave, attrMod as engineAttrMod, blankState, sanitizeRules } from '@engine/src'
import type { ActStatus, StepActions } from '@engine/src'
import type { StepRecord } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { acceptDefeat, defeatOf } from '@engine/src/features/defeat'
import { setupFromEncounter } from '@engine/src/features/enemies'
import type { CreationBlock, CreationDraft } from '@engine/src/features/creation'
import { ageBlock, attrBlock, attrBudget, attrStepBlock, attrTotals, buildCreationReport, creationBlocks, creationLimits, originView, perkBlock, perkSummary, skillBlock, skillLeft, startMoney } from '@engine/src/features/creation'
import { aiSettingsFromUi, logEntryOf, type EngineLogEntry, type UiAiFields } from '../lib/engineView'

/**
 * 包住引擎的 store：呼叫引擎的動作、拿回報告、把狀態交給畫面。不寫規則。
 * 引擎的 state 是普通物件、會被整份換掉內容，所以每次變化後把一份複製放進 shallowRef。
 */
export interface ActOutcome { status: ActStatus | 'busy'; reason?: string }

export const useEngine = defineStore('engine', () => {
  const game = new Game({ features: allFeatures(), content: [CORE_PACK], fakeProvider: new FakeProvider() })

  const snapshot = (): GameState => structuredClone(game.state)
  const state = shallowRef<GameState>(snapshot())
  const steps = shallowRef<StepRecord[]>([])
  const undoSize = ref(0)
  const busy = ref(false)

  function refreshSteps(): void {
    steps.value = structuredClone(game.lastRun?.steps ?? [])
  }
  function refresh(): void {
    state.value = snapshot()
    undoSize.value = game.undo.size
    refreshSteps()
  }
  game.subscribe(refresh)

  const hasCharacter = computed(() => state.value.pc !== null)
  const pc = computed<Actor | null>(() => (state.value.pc === null ? null : state.value.actors[state.value.pc] ?? null))
  const money = computed(() => ({ cred: state.value.money.cred, cash: state.value.money.cash }))
  const timeLabel = computed(() => `${String(state.value.time.hour).padStart(2, '0')}:${String(state.value.time.minute).padStart(2, '0')}`)
  const log = computed<EngineLogEntry[]>(() => {
    const describe = (c: Change[]): string[] => game.k.changes.describe(state.value, c)
    return state.value.reports.filter((r) => r.action !== 'game.new' && r.action !== 'ui.money' && r.action !== 'ui.time').map((r) => logEntryOf(r, describe)).reverse()
  })
  const chainSteps = computed(() => steps.value)
  const canUndo = computed(() => undoSize.value > 0)

  /** 建角畫面還沒開始時預覽用的規則（難度、特質點）：有設定時，建角的檢查拿一份只有這些規則的空狀態去問引擎，不動現在這一局。 */
  const previewRules = shallowRef<object | null>(null)
  const cstate = (): GameState => {
    if (!previewRules.value) return game.state
    const s = blankState(0)
    s.rules = sanitizeRules(previewRules.value)
    return s
  }

  /** 開新局；有 draft 時開局與建角一起提交（被擋下就原樣回傳是哪一步，原本那一局完全不動）。 */
  function newGame(opts: { seed: number; rules?: object; draft?: CreationDraft }): CreationBlock[] {
    const { draft, ...rest } = opts
    if (draft) {
      const probe = blankState(0)
      probe.rules = sanitizeRules(opts.rules ?? {})
      const blocks = creationBlocks(game.k, probe, draft)
      if (blocks.length > 0) return blocks
      previewRules.value = null
      game.newGame({ ...rest, setup: (state) => buildCreationReport(game.k, state, draft) })
      return []
    }
    previewRules.value = null
    game.newGame(rest)
    return []
  }

  /** 先問引擎每一步行不行；有問題原樣回傳、狀態不動；沒問題才提交。 */
  function createCharacter(draft: CreationDraft): CreationBlock[] {
    const blocks = creationBlocks(game.k, game.state, draft)
    if (blocks.length > 0) return blocks
    game.commit(buildCreationReport(game.k, game.state, draft))
    return []
  }

  const creation = {
    ageBlock,
    attrTotals,
    attrBudget: (bonus: Parameters<typeof attrTotals>[1]) => attrBudget(game.k, bonus),
    attrBlock: (pick: Parameters<typeof attrTotals>[0], bonus: Parameters<typeof attrTotals>[1]) => attrBlock(game.k, pick, bonus),
    skillLeft: (levels: Record<string, number>) => skillLeft(game.k, cstate(), levels),
    skillBlock: (levels: Record<string, number>) => skillBlock(game.k, cstate(), levels),
    perkSummary: (picked: string[]) => perkSummary(game.k, cstate(), picked),
    perkBlock: (picked: string[]) => perkBlock(game.k, cstate(), picked),
    blocks: (draft: CreationDraft) => creationBlocks(game.k, cstate(), draft),
    /** 建角畫面開著的時候，把設定頁的存檔規則交給引擎預覽（rulesFromUi 的輸出）；newGame 之後清掉 */
    previewRules: (rules: object | null) => { previewRules.value = rules },
    /** 建角的數字（給畫面顯示與下拉選單用，來源是引擎的資料與規則） */
    get limits() { return creationLimits(game.k, cstate()) },
    /** 按一下屬性的 ± 會不會被擋（問引擎）；null 是可以 */
    attrStepBlock: (pick: Parameters<typeof attrTotals>[0], bonus: Parameters<typeof attrTotals>[1], a: string, delta: 1 | -1): string | null => attrStepBlock(game.k, pick, bonus, a as never, delta),
    /** 出身給畫面顯示用的名字：勢力（id＋短名）、開場名冊（id＋名字） */
    originView: (id: string) => originView(game.k, id),
    /** 起始的錢（含沒花完的義體與裝備點數換的現金） */
    startMoney: (draft: Parameters<typeof startMoney>[2]) => startMoney(game.k, cstate(), draft),
    /** 引擎的屬性調整值（（屬性 − 10）÷ 2 捨去）：畫面只顯示，不自己算 */
    attrMod: (v: number) => engineAttrMod(v),
    get attributes(): AttributeEntry[] { return game.k.content.list<AttributeEntry>('attribute') },
    get skills(): SkillEntry[] { return game.k.content.list<SkillEntry>('skill') },
    get origins(): OriginEntry[] { return game.k.content.list<OriginEntry>('origin') },
    get perks(): PerkEntry[] { return game.k.content.list<PerkEntry>('perk') },
  }

  async function run(f: () => Promise<{ status: ActStatus; reason?: string }>): Promise<ActOutcome> {
    // 上一條鏈還在跑：這一次不送進引擎，也不碰 busy（第一條鏈結束時才由它放開）
    if (busy.value) return { status: 'busy', reason: '上一條任務鏈還在跑。' }
    busy.value = true
    const timer = setInterval(refreshSteps, 120)
    try {
      const r = await f()
      return r.reason !== undefined ? { status: r.status, reason: r.reason } : { status: r.status }
    } finally {
      clearInterval(timer)
      busy.value = false
      refresh()
    }
  }
  const act = (input: ActionInput) => run(() => game.act(input))
  const retryStep = (id: string) => run(() => game.retryStep(id))
  const useRules = (id: string) => run(() => game.useRules(id))
  const reroll = () => run(() => game.reroll())

  const stepActions = (stepId: string): StepActions => game.stepActions(stepId)

  function setAi(ui: Partial<UiAiFields>): void {
    game.setAiSettings(aiSettingsFromUi(ui))
  }
  function save(): string {
    return game.save('manual', new Date().toISOString())
  }
  /** 只驗證、不套用：引擎的存檔讀得進來嗎（錯誤訊息；null 是可以）。 */
  function checkSave(raw: string): string | null {
    const r = unpackSave(raw)
    return r.ok ? null : r.error
  }
  function load(raw: string): string | null {
    const err = game.load(raw)
    refresh()
    return err
  }
  /** 撤退：狀態回到快照，快照之後的紀錄留著並標成被收回，多一則交代這件事的。回傳錯誤訊息或 null。 */
  function rewind(raw: string, summary: string): string | null {
    const err = game.rewind(raw, { summary })
    refresh()
    return err
  }
  const clock = computed(() => { void state.value; return game.clock() })
  function undo(): boolean {
    const ok = game.undoSteps(1)
    refresh()
    return ok
  }
  /**
   * 還沒搬進引擎的舊系統（useGame）要動時間、錢、紀錄時走這裡，讓兩邊不各走各的。
   * action 是 'ui.money'、'ui.time' 的報告不顯示在紀錄裡（只是帳）；'ui.legacy' 是舊系統寫的一則紀錄。
   */
  function commit(parts: { summary: string; changes?: Change[]; action?: string; prose?: string[]; results?: string[]; place?: string }, opts?: { attach?: boolean }): void {
    game.commit({
      kind: 'system', action: parts.action ?? 'ui.legacy', location: parts.place ? { facility: parts.place } : {}, party: [], timeline: [], changes: parts.changes ?? [],
      outcome: { result: 'ok', summary: parts.summary },
      ...(parts.prose || parts.results ? { narration: { ...(parts.prose ? { text: parts.prose.join('\n\n') } : {}), ...(parts.results ? { results: parts.results } : {}) } } : {}),
    }, opts?.attach ? { attach: true } : undefined)
  }
  /** 錢與時間的帳（不進紀錄）。 */
  function ledger(changes: Change[]): void {
    const real = changes.filter((c) => c.delta !== 0)
    if (real.length) commit({ summary: '帳', action: 'ui.money', changes: real }, { attach: true })
  }

  // ---- 戰鬥（COMBAT_SYSTEM；dev/work/M1-ui-combat.md）：包住引擎的 battle*，畫面只讀這裡的東西 ----
  const battle = computed(() => state.value.battle)
  const inBattle = computed(() => state.value.battle !== null)
  const defeat = computed(() => defeatOf(state.value))
  /** 現在輪到誰、能做什麼（引擎算）；沒有在打是 null。每次呼叫都問一次引擎，所以回傳的是新的一份。 */
  function battleOptions(): BattleOptions | null {
    void state.value
    return game.battleOptions()
  }
  function startBattle(setup: BattleSetup): void {
    game.startBattle(setup)
    refresh()
  }
  /** 照遭遇的 id 開打：我方是隊上的人；找不到這個遭遇就丟錯（畫面先用 encounterIds 查）。 */
  function startEncounter(id: string): void {
    startBattle(setupFromEncounter(game.k, game.state, id, { allies: game.state.party.map((a) => ({ from: 'actor' as const, id: a })) }))
  }
  /** 內容裡的遭遇 id（照引擎給的順序）與它的等級，給畫面挑預設的一場。 */
  function encounters(): Array<{ id: string; grade: number }> {
    return game.k.content.list<{ id: string; grade: number }>('encounter').map((e) => ({ id: e.id, grade: e.grade }))
  }
  function battleAct(input: BattleInput): BattleStepResult {
    const r = game.battleAct(input)
    if (r.status === 'applied') refresh()
    return r
  }
  function battleNext(o?: { anyone?: boolean }): BattleStepResult {
    const r = game.battleNext(o)
    if (r.status === 'applied') refresh()
    return r
  }
  const finishBattle = () => run(() => game.finishBattle())
  function retryBattle(): string | null {
    const err = game.retryBattle()
    if (err === null) refresh()
    return err
  }
  function acceptDefeatNow(): void {
    game.commit(acceptDefeat(game.k, game.state))
    refresh()
  }
  /** 內容的名字（道具、狀態……；顯示用，查內容不是規則）；查不到是 undefined */
  const contentName = (kind: string, id: string): string | undefined => game.k.content.get<{ name?: string }>(kind, id)?.name

  return { state, battle, inBattle, defeat, battleOptions, startBattle, startEncounter, encounters, battleAct, battleNext, finishBattle, retryBattle, acceptDefeat: acceptDefeatNow, contentName, hasCharacter, pc, money, timeLabel, log, busy, chainSteps, canUndo, clock, newGame, createCharacter, creation, act, retryStep, useRules, reroll, stepActions, rewind, setAi, save, checkSave, load, undo, commit, ledger }
})
