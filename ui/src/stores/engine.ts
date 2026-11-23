import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ActionInput, ContentEntry, Feature, ContentPack, ItemEntry, Actor, AttributeEntry, BattleInput, BattleMode, BattleOptions, BattleSetup, BattleStepResult, Change, GameState, GridDir, GridView, Report, ReportDraft, SkillEntry, OriginEntry, PerkEntry } from '@engine/src'
import { ActionBlocked, ChangeError, FakeProvider, Game, modeOf, unpackSave, attrMod as engineAttrMod, blankState, sanitizeRules } from '@engine/src'
import type { ActStatus, StepActions } from '@engine/src'
import type { StepRecord } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { armorOf, concealment, equip as gearEquip, equipBlock as gearEquipBlock, gearOf, quickBlock, quickCapacity, scanFinds, unequip as gearUnequip, weaponOf } from '@engine/src/features/gear'
import type { BlueprintEntry, PartEntry } from '@engine/src/features/gear'
import type { GearLookup } from '../lib/gearView'
import { abilitiesOf, capacityOf, applyLoadout, loadoutBlock as abilityLoadoutBlock, learn as abilityLearn, learnBlock as abilityLearnBlock, resonanceOn, treeTier, TREE_XP } from '@engine/src/features/abilities'
import type { AbilityEntry, PathEntry } from '@engine/src/features/abilities'
import { acceptDefeat, chooseDefeatOption, defeatOf, defeatView, skipDefeat, watchDefeat } from '@engine/src/features/defeat'
import type { DefeatViewInfo } from '@engine/src/features/defeat'
import { commissionView } from '@engine/src/features/commission'
import { sceneSkip } from '@engine/src/features/scene'
import { setupFromEncounter } from '@engine/src/features/enemies'
import { arrive as worldArrive, cityGraph, worldView } from '@engine/src/features/world'
import type { CityGraph, WorldView } from '@engine/src/features/world'
import { advance as transitAdvance, advanceBlock as transitAdvanceBlock, alight as transitAlight, board as transitBoard, boardBlock as transitBoardBlock, taxi as transitTaxi, transitView, wait as transitWait } from '@engine/src/features/transit'
import type { BoardInput, TransitView } from '@engine/src/features/transit'
import { chooseOption, directorView, eventView } from '@engine/src/features/director'
import type { DirectorView, EventView } from '@engine/src/features/director'
import { scanView } from '@engine/src/features/security'
import type { ScanView } from '@engine/src/features/security'
import { demoPack, demoStartFeature } from '../data/demo'
import type { CreationBlock, CreationDraft } from '@engine/src/features/creation'
import { ageBlock, attrBlock, attrBudget, attrStepBlock, attrTotals, buildCreationReport, creationBlocks, creationLimits, originView, perkBlock, perkSummary, skillBlock, skillLeft, startMoney } from '@engine/src/features/creation'
import { aiSettingsFromUi, logEntryOf, type EngineLogEntry, type UiAiFields } from '../lib/engineView'

/**
 * 包住引擎的 store：呼叫引擎的動作、拿回報告、把狀態交給畫面。不寫規則。
 * 引擎的 state 是普通物件、會被整份換掉內容，所以每次變化後把一份複製放進 shallowRef。
 */
export interface ActOutcome { status: ActStatus | 'busy'; reason?: string }

export const useEngine = defineStore('engine', () => {
  // 示意世界包（ui/src/data/demo；dev/work/M2-plan.md 使用者定案第 5 項）：引擎不再匯入內容，所以畫面自己帶一份，開新局時載入。
  // 測試自帶最小假資料（testContent）時不載入它。
  // 開局站在哪（示意包的起點）是 game.new 掛點給的變更（demoStartFeature），不另開一份報告，所以紀錄一開始是空的。
  const build = (extra: ContentPack[] = [], demo = true, features: Feature[] = []): Game => new Game({ features: [...allFeatures(), ...(demo ? [demoStartFeature()] : []), ...features], content: [CORE_PACK, ...(demo ? [demoPack()] : []), ...extra], fakeProvider: new FakeProvider() })
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
    // 走路（grid.move）每一步都是一份報告，不放進紀錄（位置與時間在狀態列；到了哪、碰到什麼事各有自己的報告）
    return state.value.reports.filter((r) => r.action !== 'game.new' && r.action !== 'ui.money' && r.action !== 'ui.time' && r.action !== 'grid.move').map((r) => logEntryOf(r, describe, placeName)).reverse()
  })
  /** 報告上的地點（區、街區、設施的 id）換成名字；查不到的照原樣 */
  const placeName = (loc: { district?: string; block?: string; facility?: string }): string => {
    const d = loc.district ? game.k.content.get<ContentEntry & { name?: string }>('district', loc.district)?.name ?? loc.district : ''
    const b = loc.block ? game.k.content.get<ContentEntry & { name?: string; facilities?: Record<string, { name?: string }> }>('block', loc.block) : undefined
    const f = loc.facility ? b?.facilities?.[loc.facility]?.name ?? loc.facility : ''
    return [d, loc.block ? b?.name ?? loc.block : '', f].filter(Boolean).join(' · ')
  }
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
  function newGame(opts: { seed: number; rules?: object; draft?: CreationDraft; testContent?: ContentPack[]; testFeatures?: Feature[] }): CreationBlock[] {
    const { draft, testContent, testFeatures, ...rest } = opts
    // 只給測試用：把測試自帶的最小內容接在核心的內容後面，換一個新的引擎（畫面與正式的流程不傳這個參數）
    if (testContent) {
      game = build(testContent, false, testFeatures)
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
  const act = async (input: ActionInput): Promise<ActOutcome> => {
    const r = await run(() => game.act(input))
    await drainQueued() // 事件用自由行動收掉之後，留著的草稿（計程車的抵達）接著提交
    return r
  }
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
  // ---- 戰敗之後（M2-ui-battle-after）：全部轉接 features/defeat 與 commission，畫面不自己判斷 ----
  /** 把引擎做好的一份報告草稿提交（Game.commit：帶 launch、rewind 的也在同一次提交裡）；被擋下回傳引擎的原因，成功回傳 null */
  function commitMade(make: () => ReportDraft): string | null {
    try {
      game.commit(make())
      refresh()
      return null
    } catch (e) {
      const why = reasonOf(e)
      if (why === null) throw e
      return why
    }
  }
  const defeatFlow = {
    /** 現在在哪一步、哪一件事件與版本、能做的選擇與原因、接受的話會怎樣（引擎的 defeatView）；沒有在等是 null */
    view: (): DefeatViewInfo | null => { void state.value; return defeatView(game.k, game.state) },
    /** 先問的時候選「看」：事件視窗開起來 */
    watch: (): string | null => commitMade(() => watchDefeat(game.k, game.state)),
    /** 先問的時候選「不看」：只列出結果 */
    skip: (): string | null => commitMade(() => skipDefeat(game.k, game.state)),
    /** 接受結果：被擋下（事件還沒做完……）回傳引擎的原因；在副本裡而且算失敗時，引擎在同一次提交裡回退 */
    accept: (): string | null => commitMade(() => acceptDefeat(game.k, game.state)),
    /** 別的功能多給的選項（被贖回……）：選了就結算 */
    choose: (id: string): string | null => commitMade(() => chooseDefeatOption(game.k, game.state, id)),
    /** 人在不在委託的副本裡（引擎的 commissionView）；不在是 null */
    commission: (): { id: string; name: string; stage: number; stages: number } | null => {
      void state.value
      const v = commissionView(game.k, game.state)
      return v ? { id: v.id, name: v.name, stage: v.stage, stages: v.stages } : null
    },
  }
  /**
   * 事件帶出來的成人場景（俘虜「帶走」、戰敗事件的選項）：場景的畫面是 M2-ui-scene，還沒做之前入口只有「略過」（引擎的 sceneSkip：直接算出結果）。
   * M2-ui-scene 接上之後這一組換掉。
   */
  const sceneGate = {
    active: (): boolean => { void state.value; return game.k.activity.active(game.state).some((a) => a.kind === 'scene') },
    /** 略過：回傳引擎的原因（做不到）或 null；結果那一份報告（scene.end）在 state.reports 最後 */
    skip: (): string | null => commitMade(() => sceneSkip(game.k, game.state)),
  }
  /** 有幾個面板把事件視窗嵌在自己裡面（戰敗、戰利品與俘虜）：大於 0 時全域的事件對話框讓出來 */
  const eventInline = ref(0)
  const hostEvent = (on: boolean): void => { eventInline.value = Math.max(0, eventInline.value + (on ? 1 : -1)) }
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
    /** 現在換不換得了配置（要在住處或調校診所、不在副本）：引擎的原因，可以換是 null */
    loadoutBlock: (): string | null => { void state.value; return game.state.pc === null ? NO_PC : game.blockOf('commit:ability.loadout') ?? abilityLoadoutBlock(game.k, game.state, game.state.pc) },
    /** 套用一整組（引擎的 applyLoadout：花半小時、地點與容量由引擎檢查）；擋下時回傳原因 */
    equip: (ids: string[]): string | null => commitGear((pc) => applyLoadout(game.k, game.state, pc, ids)),
  }

  // ---- 城市、搭車、事件視窗、掃橋（M2-ui-world）：全部轉接 features/world、transit、director、security，畫面不自己判斷 ----
  /** 把一份（或幾份）報告草稿交給引擎提交（走 commitNarrated：AI 關著就是一般的提交）。草稿做不出來（被擋下）回傳原因。 */
  const queued: ReportDraft[] = []
  async function commitDrafts(make: () => ReportDraft | ReportDraft[], label?: string): Promise<ActOutcome> {
    let drafts: ReportDraft[]
    try {
      const made = make()
      drafts = Array.isArray(made) ? made : [made]
    } catch (e) {
      const why = reasonOf(e)
      if (why === null) throw e
      return { status: 'refused', reason: why }
    }
    let last: ActOutcome = { status: 'applied' }
    for (const [i, d] of drafts.entries()) {
      const r = await run(() => game.commitNarrated(d, { mode: 'new', ...(label ? { label } : {}) }))
      last = r
      if (r.status !== 'applied') {
        // 前面的已經提交了、這一份被擋下（例：出發之後事件開了）：留著，等引擎放行再提交（計程車的抵達）
        if (i > 0 || r.status === 'refused') queued.push(...drafts.slice(i))
        return r
      }
    }
    return last
  }
  /** 引擎放行了就把留著的草稿提交掉（事件做完之後呼叫） */
  async function drainQueued(): Promise<void> {
    while (queued.length > 0 && game.blockOf(`commit:${queued[0]!.action}`) === null) {
      const d = queued.shift()!
      await run(() => game.commitNarrated(d, { mode: 'new' }))
    }
  }

  const world = {
    /** 現在在哪一區哪一塊、出口與設施（引擎的 worldView） */
    view: (): WorldView => { void state.value; return worldView(game.k, game.state) },
    /** 區與街區怎麼連（城市地圖用） */
    graph: (): CityGraph => { void state.value; return cityGraph(game.k) },
    /** 內容的原始資料（區、街區的名字與示意包多給的欄位；顯示用，不是規則） */
    entry: <T extends object>(kind: string, id: string): T | undefined => game.k.content.get<T & { id: string }>(kind, id),
    /** 現在這一塊的格子：看過的格子、站的位置、這一格能做的事、四個方向走不走得過去 */
    grid: (): GridView | null => { void state.value; return game.gridView() },
    /** 把人帶到一塊街區（報告 world.arrive）。測試與還沒有出口的畫面用；平常是走到出口那一格。 */
    arrive: (block: string, at?: string) => commitDrafts(() => worldArrive(game.k, game.state, block, at)),
    /** 走：一個方向（一格）或一個目的地（照最短路走，遇到事情就停）。被擋下回傳引擎的原因。 */
    walk(to: GridDir | [number, number]): { ok: boolean; reason?: string } {
      const r = game.gridMove(to)
      if (r.status === 'refused') return { ok: false, reason: r.reason ?? '現在走不了。' }
      return { ok: true }
    },
  }

  const transit = {
    view: (): TransitView => { void state.value; return transitView(game.k, game.state) },
    /** 上車的原因（可以上車回傳 null） */
    boardBlock: (input: BoardInput): string | null => { void state.value; return game.blockOf('commit:transit.board') ?? transitBoardBlock(game.k, game.state, input) },
    board: (input: BoardInput) => commitDrafts(() => transitBoard(game.k, game.state, input)),
    wait: () => commitDrafts(() => transitWait(game.k, game.state)),
    advance: () => commitDrafts(() => transitAdvance(game.k, game.state)),
    alight: () => commitDrafts(() => transitAlight(game.k, game.state)),
    /** 計程車：出發與抵達各一份報告，照順序提交 */
    taxi: (to: string) => commitDrafts(() => transitTaxi(game.k, game.state, to), '叫計程車'),
    /**
     * 坐到目的地：一站一站呼叫引擎，路上開了事件（或引擎說坐不下去）就停。到了目的地也停，不自動下車。
     * stopped：dest 到了、event 路上開了事件、blocked 引擎擋下（reason 是它的原因）、none 沒有目的地。
     */
    async rideToDest(): Promise<{ stopped: 'dest' | 'event' | 'blocked' | 'none'; stops: number; reason?: string }> {
      let stops = 0
      for (let guard = 0; guard < 200; guard++) {
        const ride = transitView(game.k, game.state).ride
        if (!ride || ride.dest === null) return { stopped: 'none', stops }
        if (ride.toDest === null) return { stopped: 'dest', stops }
        if (ride.phase === 'platform') {
          const w = await commitDrafts(() => transitWait(game.k, game.state))
          if (w.status !== 'applied') return { stopped: 'blocked', stops, ...(w.reason ? { reason: w.reason } : {}) }
          if (eventView(game.k, game.state)) return { stopped: 'event', stops }
          continue
        }
        const why = transitAdvanceBlock(game.k, game.state)
        if (why) return { stopped: 'blocked', stops, reason: why }
        const r = await commitDrafts(() => transitAdvance(game.k, game.state))
        if (r.status !== 'applied') return { stopped: 'blocked', stops, ...(r.reason ? { reason: r.reason } : {}) }
        stops += 1
        if (eventView(game.k, game.state)) return { stopped: 'event', stops }
      }
      return { stopped: 'blocked', stops, reason: '坐了太多站，先停一下。' }
    },
  }

  const event = {
    /** 開著的事件（正文、選項、檢定的成功率）；沒有是 null */
    view: (): EventView | null => { void state.value; return eventView(game.k, game.state) },
    /** 延後的事件、排隊的通知有幾件 */
    director: (): DirectorView => { void state.value; return directorView(game.state) },
    /** 選一個選項；做完回傳這一步提交的報告（擲骰與結果在裡面）。被擋下回傳原因。 */
    async choose(id: string): Promise<ActOutcome & { reports?: Report[] }> {
      const before = game.state.reports.length
      const r = await commitDrafts(() => chooseOption(game.k, game.state, id))
      await drainQueued()
      return { ...r, reports: structuredClone(game.state.reports.slice(before)) }
    },
    /** 事件開著時直接做自由行動（「我要做別的」）；做完事件以 free 收尾，留著的草稿接著提交 */
    free: (text: string) => act({ kind: 'free', text }),
    /** 掃橋的事件開著時：四步、身上會被掃到的東西、怎麼過；沒有是 null */
    scan: (): ScanView | null => { void state.value; return scanView(game.k, game.state) },
  }

  return { state, world, transit, event, placeName, skills, gear, battle, inBattle, defeat, pendingDefeat, blockOf, battleOptions, battleMode, startBattle, startEncounter, encounters, battleAct, battleNext, finishBattle, retryBattle, rewindToStage, acceptDefeat: acceptDefeatNow, defeatFlow, sceneGate, eventInline, hostEvent, contentName, hasCharacter, pc, money, timeLabel, log, busy, chainSteps, canUndo, clock, newGame, createCharacter, creation, act, retryStep, useRules, reroll, stepActions, rewind, setAi, save, checkSave, load, undo, commit, ledger }
})
