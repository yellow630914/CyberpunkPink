import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ActionInput, ContentPack, ItemEntry, Actor, AttributeEntry, BattleInput, BattleMode, BattleOptions, BattleSetup, BattleStepResult, Change, GameState, Report, SkillEntry, OriginEntry, PerkEntry } from '@engine/src'
import { ActionBlocked, ChangeError, FakeProvider, Game, modeOf, unpackSave, attrMod as engineAttrMod, blankState, sanitizeRules } from '@engine/src'
import type { ActStatus, StepActions } from '@engine/src'
import type { StepRecord } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { armorOf, concealment, equip as gearEquip, equipBlock as gearEquipBlock, gearOf, quickBlock, quickCapacity, scanFinds, unequip as gearUnequip, weaponOf } from '@engine/src/features/gear'
import type { BlueprintEntry, PartEntry } from '@engine/src/features/gear'
import type { GearLookup } from '../lib/gearView'
import { abilitiesOf, capacityOf, equipAbilities, learn as abilityLearn, learnBlock as abilityLearnBlock, resonanceOn, treeTier, TREE_XP } from '@engine/src/features/abilities'
import type { AbilityEntry, PathEntry } from '@engine/src/features/abilities'
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
  const build = (extra: ContentPack[] = []): Game => new Game({ features: allFeatures(), content: [CORE_PACK, ...extra], fakeProvider: new FakeProvider() })
  let game = build()

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
  function newGame(opts: { seed: number; rules?: object; draft?: CreationDraft; testContent?: ContentPack[] }): CreationBlock[] {
    const { draft, testContent, ...rest } = opts
    // 只給測試用：把測試自帶的最小內容接在核心的內容後面，換一個新的引擎（畫面與正式的流程不傳這個參數）
    if (testContent) {
      game = build(testContent)
      game.subscribe(refresh)
    }
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
   * 戰鬥中、或有等著選的戰敗時，引擎不收別的報告：回傳擋住的原因（沒有被擋回傳 null），狀態不變。
   */
  function commit(parts: { summary: string; changes?: Change[]; action?: string; prose?: string[]; results?: string[]; place?: string }, opts?: { attach?: boolean }): string | null {
    try {
      game.commit({
        kind: 'system', action: parts.action ?? 'ui.legacy', location: parts.place ? { facility: parts.place } : {}, party: [], timeline: [], changes: parts.changes ?? [],
        outcome: { result: 'ok', summary: parts.summary },
        ...(parts.prose || parts.results ? { narration: { ...(parts.prose ? { text: parts.prose.join('\n\n') } : {}), ...(parts.results ? { results: parts.results } : {}) } } : {}),
      }, opts?.attach ? { attach: true } : undefined)
      return null
    } catch (e) {
      if (e instanceof ActionBlocked) return e.reason
      throw e
    }
  }
  /** 錢與時間的帳（不進紀錄）。被擋下時回傳原因（見 commit）。 */
  function ledger(changes: Change[]): string | null {
    const real = changes.filter((c) => c.delta !== 0)
    return real.length ? commit({ summary: '帳', action: 'ui.money', changes: real }, { attach: true }) : null
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
  /**
   * 等著玩家三選一的戰敗（引擎的判斷：打輸之後開打前的快照還在）；沒有在等是 null。這段時間引擎不收別的事。
   * defeat（上面）是戰敗事件的內容（哪一個事件、接受的話會發生什麼）。
   */
  const pendingDefeat = computed(() => { void state.value; return game.pendingDefeat })
  /** 現在這件事做不做得成（戰鬥中、等著選的戰敗）：回傳擋住的原因，可以做回傳 null。 */
  const blockOf = (doing: string): string | null => game.blockOf(doing)
  /** 開打。回傳提交的報告：第一份是 battle.start，開場的每一拍在它的 timeline（畫面放進戰鬥紀錄）。 */
  function startBattle(setup: BattleSetup): Report[] {
    const reports = game.startBattle(setup)
    refresh()
    return reports
  }
  /** 照遭遇的 id 開打：我方是隊上的人；找不到這個遭遇就丟錯（畫面先用 encounterIds 查）。回傳開打的報告（見 startBattle）。 */
  function startEncounter(id: string): Report[] {
    return startBattle(setupFromEncounter(game.k, game.state, id, { allies: game.state.party.map((a) => ({ from: 'actor' as const, id: a })) }))
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
  /** 回到這個階段開始時（戰敗三選一的第三個）：規則在引擎（Game.rewindToStage，COMBAT_SYSTEM 8.4 節），這裡只轉接。 */
  function rewindToStage(): string | null {
    const err = game.rewindToStage()
    if (err === null) refresh()
    return err
  }
  function acceptDefeatNow(): void {
    game.commit(acceptDefeat(game.k, game.state))
    refresh()
  }
  /** 這個戰場的規則（遮蔽的名字、數值：照這一局的內容，不是預設值）；沒有在打是 null。 */
  function battleMode(): BattleMode | null {
    const b = state.value.battle
    return b ? modeOf(game.k.content, b.mode) ?? null : null
  }
  /** 內容的名字（道具、狀態……；顯示用，查內容不是規則）；查不到是 undefined */
  const contentName = (kind: string, id: string): string | undefined => game.k.content.get<{ id: string; name?: string }>(kind, id)?.name


  // ---- 裝備與背包（EQUIPMENT；dev/work/M1b-ui-gear.md）：全部轉接 features/gear，畫面不自己判斷 ----
  /** 查內容（名字、等級、零件）；顯示用，不是規則 */
  const gearLook: GearLookup = {
    blueprint: (id) => game.k.content.get<BlueprintEntry>('blueprint', id),
    item: (id) => game.k.content.get<ItemEntry>('item', id),
    part: (id) => game.k.content.get<PartEntry>('part', id),
    quickBlock: (id) => quickBlock(game.k, id),
  }
  /** 引擎擋下的原因：ChangeError 的訊息前面有「changes[0]（gear.quick）：」，去掉它只留引擎寫的那一句 */
  const reasonOf = (e: unknown): string | null => {
    if (e instanceof ActionBlocked) return e.reason
    if (e instanceof ChangeError) return e.problems.map((p) => p.replace(/^changes\[\d+\]（[^）]*）：/, '')).join('')
    if (e instanceof Error) return e.message
    return null
  }
  const NO_PC = '還沒有主角。'
  /** 提交一份裝備的報告；被擋下回傳原因，成功回傳 null */
  function commitGear(make: (pc: string) => Parameters<Game['commit']>[0]): string | null {
    const pcId = game.state.pc
    if (pcId === null) return NO_PC
    try {
      game.commit(make(pcId))
      return null
    } catch (e) {
      const why = reasonOf(e)
      if (why === null) throw e
      return why
    }
  }
  const gearDraft = (action: string, summary: string, changes: Change[]) => ({
    kind: 'system' as const, action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary },
  })
  const gear = {
    look: gearLook,
    /** 現在的主角（沒有是 null） */
    get actor(): string | null { void state.value; return game.state.pc },
    /** 戰鬥中或等著選戰敗時整頁唯讀：引擎給的原因；可以動回傳 null */
    lock: (): string | null => { void state.value; return game.blockOf('commit:gear.equip') },
    of: () => { void state.value; return gearOf(game.state, game.state.pc ?? '') },
    inventory: () => { void state.value; return game.state.inventory },
    /** 這一件能不能穿、帶、戴（可以是 null；slot 只給武器用） */
    equipBlock: (what: string, slot?: string): string | null => {
      void state.value
      if (game.state.pc === null) return NO_PC
      return game.blockOf('commit:gear.equip') ?? gearEquipBlock(game.k, game.state, game.state.pc, what, slot)
    },
    /** 穿上之後會佔哪幾格（照引擎的報告草稿；穿不上是空的）。畫面用它寫「裝到哪一格」 */
    equipSlots: (what: string, slot?: string): string[] => {
      void state.value
      if (game.state.pc === null) return []
      try {
        return gearEquip(game.k, game.state, game.state.pc, what, slot).changes.filter((c) => c.op === 'gear.slot' && c.item === what).map((c) => c.slot as string)
      } catch {
        return []
      }
    },
    equip: (what: string, slot?: string): string | null => commitGear((pc) => gearEquip(game.k, game.state, pc, what, slot)),
    unequip: (what: string): string | null => commitGear((pc) => gearUnequip(game.k, game.state, pc, what)),
    /** 整份換掉快取格；放不下、背包不夠時引擎擋下，回傳它的原因 */
    setQuick: (items: Array<{ item: string; qty: number }>): string | null => commitGear((pc) => gearDraft('gear.quick', '整理快取格。', [{ op: 'gear.quick', id: pc, items }])),
    setCoat: (coat: 'open' | 'closed'): string | null => commitGear((pc) => gearDraft('gear.coat', coat === 'closed' ? '外套扣上了。' : '外套敞開了。', [{ op: 'gear.coat', id: pc, coat }])),
    quickCapacity: (): number => { void state.value; return quickCapacity(game.k, game.state, gearOf(game.state, game.state.pc ?? '')) },
    armor: (): number => { void state.value; return game.state.pc === null ? 0 : armorOf(game.k, game.state, game.state.pc) },
    concealment: () => { void state.value; return game.state.pc === null ? { capacity: 0, hidden: [] as string[], shown: [] as string[] } : concealment(game.k, game.state, game.state.pc) },
    scanFinds: (strength: number): string[] => { void state.value; return game.state.pc === null ? [] : scanFinds(game.k, game.state, game.state.pc, strength) },
    /** 一件組好的武器在戰鬥裡的數字；不是武器或找不到是 null */
    weapon: (uid: string) => {
      void state.value
      if (game.state.pc === null) return null
      try {
        return weaponOf(game.k, game.state, game.state.pc, uid)
      } catch {
        return null
      }
    },
  }

  // ---- 技能與橋（SKILLS 1.3、1.4；dev/work/M1b-ui-skills.md）：全部轉接 features/abilities，畫面不自己判斷 ----
  const skills = {
    /** 內容裡的路數與技能（照內容登錄表的順序） */
    paths: (): PathEntry[] => game.k.content.list<PathEntry>('path'),
    abilities: (): AbilityEntry[] => game.k.content.list<AbilityEntry>('ability'),
    /** 歷練點、學會的、裝著的、每棵樹累計花的（沒有主角是空的） */
    mine: () => { void state.value; return abilitiesOf(game.state, game.state.pc ?? '') },
    /** 這棵樹開到第幾階（引擎算） */
    tierOf: (path: string): number => { void state.value; return treeTier(game.k, game.state, game.state.pc ?? '', path) },
    treeXp: TREE_XP,
    /** 這棵樹第 tier 階的共鳴現在生效嗎（引擎算：樹階到了、而且裝著這棵樹的招牌） */
    resonanceOn: (path: string, tier: number): boolean => { void state.value; return resonanceOn(game.k, game.state, game.state.pc ?? '', path, tier) },
    /** 戰鬥中或等著選戰敗時整頁唯讀：引擎給的原因；可以動回傳 null */
    lock: (): string | null => { void state.value; return game.blockOf('commit:ability.equip') },
    /** 現在學不學得到：先看整頁的鎖，再問引擎；可以學是 null */
    learnBlock: (id: string): string | null => {
      void state.value
      if (game.state.pc === null) return NO_PC
      return game.blockOf('commit:ability.learn') ?? abilityLearnBlock(game.k, game.state, game.state.pc, id)
    },
    learn: (id: string): string | null => commitGear((pc) => abilityLearn(game.k, game.state, pc, id)),
    /** 橋四類的容量（used 是裝著的，max 是橋） */
    capacity: () => { void state.value; return capacityOf(game.k, game.state, game.state.pc ?? '') },
    /** 整份換掉裝著的清單；引擎擋下就回傳原因（狀態不動） */
    equip: (ids: string[]): string | null => commitGear((pc) => equipAbilities(game.k, game.state, pc, ids)),
  }

  return { state, skills, gear, battle, inBattle, defeat, pendingDefeat, blockOf, battleOptions, battleMode, startBattle, startEncounter, encounters, battleAct, battleNext, finishBattle, retryBattle, rewindToStage, acceptDefeat: acceptDefeatNow, contentName, hasCharacter, pc, money, timeLabel, log, busy, chainSteps, canUndo, clock, newGame, createCharacter, creation, act, retryStep, useRules, reroll, stepActions, rewind, setAi, save, checkSave, load, undo, commit, ledger }
})
