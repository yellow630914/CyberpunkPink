import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ActionInput, Actor, AttributeEntry, Change, CreationRuleEntry, GameState, SkillEntry, OriginEntry, PerkEntry } from '@engine/src'
import { ActionBlocked, FakeProvider, Game, attrMod as engineAttrMod, blankState, sanitizeRules } from '@engine/src'
import type { StepRecord } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import type { CreationBlock, CreationDraft } from '@engine/src/features/creation'
import { ageBlock, attrBlock, attrBudget, attrTotals, buildCreationReport, creationBlocks, perkBlock, perkSummary, skillBlock, skillLeft } from '@engine/src/features/creation'
import { aiSettingsFromUi, logEntryOf, type EngineLogEntry, type UiAiFields } from '../lib/engineView'

/**
 * 包住引擎的 store：呼叫引擎的動作、拿回報告、把狀態交給畫面。不寫規則。
 * 引擎的 state 是普通物件、會被整份換掉內容，所以每次變化後把一份複製放進 shallowRef。
 */
export interface ActOutcome { status: string; reason?: string }

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

  function newGame(opts: { seed: number; rules?: object }): void {
    previewRules.value = null
    game.newGame(opts)
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
    get limits() {
      const r = game.k.content.get<CreationRuleEntry>('creation_rule', 'default')
      const rules = cstate().rules
      return { attrArray: r?.attr_array ?? [], attrFree: r?.attr_free ?? 0, attrMax: r?.attr_max ?? 18, attrMin: r?.attr_min ?? 4, skillPoints: rules.startSkillPoints, skillMax: rules.startSkillMax, perkPoints: rules.startPerkPoints, perkMax: r?.perk_max ?? 8, flawMax: r?.flaw_max ?? 2 }
    },
    /** 按一下屬性的 ± 會不會被擋（問引擎的自由點數與上下限）；null 是可以 */
    attrStepBlock(pick: Parameters<typeof attrTotals>[0], bonus: Parameters<typeof attrTotals>[1], a: string, delta: 1 | -1): string | null {
      const id = a as keyof typeof pick
      if (pick[id] === undefined) return '先選這一項的數字。'
      const next = { ...bonus, [id]: (bonus[id] ?? 0) + delta }
      const total = attrTotals(pick, next)[id]
      const lim = this.limits
      if (delta > 0 && total > lim.attrMax) return `單項最高 ${lim.attrMax}。`
      if (delta < 0 && total < lim.attrMin) return `最低 ${lim.attrMin}（調整值 ${engineAttrMod(lim.attrMin)}）。`
      if (attrBudget(game.k, next).left < 0) return '自由點數用完了：先把別的屬性往下壓，一點換一點。'
      return null
    },
    /** 引擎的屬性調整值（（屬性 − 10）÷ 2 捨去）：畫面只顯示，不自己算 */
    attrMod: (v: number) => engineAttrMod(v),
    get attributes(): AttributeEntry[] { return game.k.content.list<AttributeEntry>('attribute') },
    get skills(): SkillEntry[] { return game.k.content.list<SkillEntry>('skill') },
    get origins(): OriginEntry[] { return game.k.content.list<OriginEntry>('origin') },
    get perks(): PerkEntry[] { return game.k.content.list<PerkEntry>('perk') },
  }

  async function run(f: () => Promise<{ status: string }>): Promise<ActOutcome> {
    busy.value = true
    const timer = setInterval(refreshSteps, 120)
    try {
      const r = await f()
      return { status: r.status }
    } catch (e) {
      if (e instanceof ActionBlocked) return { status: 'blocked', reason: e.reason }
      throw e
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

  function setAi(ui: Partial<UiAiFields>): void {
    game.setAiSettings(aiSettingsFromUi(ui))
  }
  function save(): string {
    return game.save('manual', new Date().toISOString())
  }
  function load(raw: string): string | null {
    const err = game.load(raw)
    refresh()
    return err
  }
  function undo(): boolean {
    const ok = game.undoSteps(1)
    refresh()
    return ok
  }
  /**
   * 還沒搬進引擎的舊系統（useGame）要動時間、錢、紀錄時走這裡，讓兩邊不各走各的。
   * action 是 'ui.money'、'ui.time' 的報告不顯示在紀錄裡（只是帳）；'ui.legacy' 是舊系統寫的一則紀錄。
   */
  function commit(parts: { summary: string; changes?: Change[]; action?: string; prose?: string[]; results?: string[]; place?: string }): void {
    game.commit({
      kind: 'system', action: parts.action ?? 'ui.legacy', location: parts.place ? { facility: parts.place } : {}, party: [], timeline: [], changes: parts.changes ?? [],
      outcome: { result: 'ok', summary: parts.summary },
      ...(parts.prose || parts.results ? { narration: { ...(parts.prose ? { text: parts.prose.join('\n\n') } : {}), ...(parts.results ? { results: parts.results } : {}) } } : {}),
    })
  }
  /** 錢與時間的帳（不進紀錄）。 */
  function ledger(changes: Change[]): void {
    const real = changes.filter((c) => c.delta !== 0)
    if (real.length) commit({ summary: '帳', action: 'ui.money', changes: real })
  }

  return { state, hasCharacter, pc, money, timeLabel, log, busy, chainSteps, canUndo, newGame, createCharacter, creation, act, retryStep, useRules, reroll, setAi, save, load, undo, commit, ledger }
})
