import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ActionInput, ContentEntry, Feature, ContentPack, ItemEntry, Actor, AttributeEntry, BattleInput, BattleMode, BattleOptions, BattleSetup, BattleStepResult, Change, GameState, GridDir, GridView, Report, ReportDraft, SkillEntry, OriginEntry, PerkEntry } from '@engine/src'
import { ActionBlocked, ChangeError, FakeProvider, Game, meterOf, modeOf, unpackSave, attrMod as engineAttrMod, blankState, sanitizeRules } from '@engine/src'
import type { ActStatus, StepActions } from '@engine/src'
import type { StepRecord } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { armorOf, concealment, equip as gearEquip, equipBlock as gearEquipBlock, gearOf, quickBlock, quickCapacity, scanFinds, unequip as gearUnequip, weaponOf } from '@engine/src/features/gear'
import type { BlueprintEntry, PartEntry } from '@engine/src/features/gear'
import type { GearLookup } from '../lib/gearView'
import { abilitiesOf, capacityOf, applyLoadout, loadoutMinutes, loadoutBlock as abilityLoadoutBlock, learn as abilityLearn, learnBlock as abilityLearnBlock, resonanceOn, treeTier, TREE_XP } from '@engine/src/features/abilities'
import type { AbilityEntry, PathEntry } from '@engine/src/features/abilities'
import { acceptDefeat, chooseDefeatOption, defeatOf, defeatView, skipDefeat, watchDefeat } from '@engine/src/features/defeat'
import type { DefeatViewInfo } from '@engine/src/features/defeat'
import { auxChance, breathe as commissionBreathe, chooseBranch, chooseFace, commissionView, checkGoal as commissionCheckGoal, playScene as commissionPlayScene, replay as commissionReplay, retreat as commissionRetreat } from '@engine/src/features/commission'
import type { AuxChance, CommissionView } from '@engine/src/features/commission'
import { abandonRepOf, accept as fixerAccept, activeJobs, board as fixerBoard, borrowOption, buyIntel as fixerBuyIntel, drop as fixerDrop, fixerRules, go as fixerGo, goBlock as fixerGoBlock, haggle as fixerHaggle, hire as fixerHire, hireOptions as fixerHireOptions, jobOf, jobsOf, repGainOf, scout as fixerScout, scoutView as fixerScoutView, splitPreview, unhire as fixerUnhire } from '@engine/src/features/fixer'
import type { AuxFace, BoardView, FixerEntry, HireInput, HireOption, IntelWith, Job, Offer, PayKind, ScoutView, Split } from '@engine/src/features/fixer'
import { muster as rosterMuster, musterBlocks, rosterRules, rosterView, recruitBlock as rosterRecruitBlock, recruitDc, recruitInput, readRoster, leave as rosterLeave, isRunner as rosterIsRunner } from '@engine/src/features/roster'
import type { Candidate as RosterCandidate } from '@engine/src/features/roster'
import { affinityStage, editMemory, forgetMemory, interactInput, interactions, memoriesOf, meetNpc, newsOf, npcOf, npcsHere, readNpcs, recall, relationOf, successChance, watchNpc } from '@engine/src/features/npcs'
import type { InteractExtra, InteractKind, InteractionView, Memory, MemoryPatch, NewsItem, Npc, Relation, StageView } from '@engine/src/features/npcs'
import { call as favorCall, favorsOf, spend as favorSpend, spendBlock as favorSpendBlock } from '@engine/src/features/favors'
import type { FavorsState } from '@engine/src/features/favors'
import { exploreFeature, unlock as exploreUnlock } from '@engine/src/features/explore'
import type { GridKernel } from '@engine/src'
import { ratingOf, sceneAct, sceneNext, sceneOf, sceneOptions, sceneRules, sceneSkip, sceneView, setSceneMode, sceneModeOf } from '@engine/src/features/scene'
import type { SceneInput, SceneMode, SceneOptions, SceneView } from '@engine/src/features/scene'
import { setupFromEncounter } from '@engine/src/features/enemies'
import { arrive as worldArrive, cityGraph, worldView } from '@engine/src/features/world'
import type { CityGraph, WorldView } from '@engine/src/features/world'
import { advance as transitAdvance, advanceBlock as transitAdvanceBlock, alight as transitAlight, board as transitBoard, boardBlock as transitBoardBlock, taxi as transitTaxi, taxiArrival as transitTaxiArrival, transitView, wait as transitWait } from '@engine/src/features/transit'
import type { BoardInput, TransitView } from '@engine/src/features/transit'
import { chooseOption, directorView, eventView } from '@engine/src/features/director'
import type { DirectorView, EventView } from '@engine/src/features/director'
import { toMinutes } from '@engine/src/core/util/time'
import { hostilityView, scanView, timedFloors } from '@engine/src/features/security'
import type { HostilityRow, ScanView } from '@engine/src/features/security'
import { bargainByFavor, bargainInput, checkout as tradeCheckout, planCheckout, routesHint, shopView } from '@engine/src/features/trade'
import type { BargainMethod, Cart, CheckoutPlan, RoutesHint, ShopView } from '@engine/src/features/trade'
import { billPreview, setBill } from '@engine/src/features/bills'
import type { BillPreview, BillSetting } from '@engine/src/features/bills'
import { jobsHere, shift as workShift } from '@engine/src/features/work'
import type { JobView } from '@engine/src/features/work'
import { breathBlock, breathDraft, depositOf, homeOf, leaveBlock, leaveDraft, readRest, rentBlock, rentDraft, residencePools, restRules, sleepBlock, sleepDraft, sleepOptions } from '@engine/src/features/rest'
import type { Level, ResidenceEntry, SleepOption, SleepSpotId } from '@engine/src/features/rest'
import type { PartyMember } from '../data/types'
import { DEMO_SCENES, demoPack, demoPeopleChanges, demoSceneChanges, demoStartFeature } from '../data/demo'
import type { CreationBlock, CreationDraft } from '@engine/src/features/creation'
import { ageBlock, attrBlock, attrBudget, attrStepBlock, attrTotals, buildCreationReport, creationBlocks, creationLimits, originView, perkBlock, perkSummary, skillBlock, skillLeft, startMoney } from '@engine/src/features/creation'
import { debriefOf } from '../lib/scene/sceneView'
import type { Debrief } from '../lib/scene/sceneView'
import { aiSettingsFromUi, logEntryOf, type EngineLogEntry, type UiAiFields } from '../lib/engineView'

/**
 * 包住引擎的 store：呼叫引擎的動作、拿回報告、把狀態交給畫面。不寫規則。
 * 引擎的 state 是普通物件、會被整份換掉內容，所以每次變化後把一份複製放進 shallowRef。
 */
export interface ActOutcome { status: ActStatus | 'busy'; reason?: string }

/** 住處的抬頭（引擎的住處與押金、欠繳）：哪一間、週租、押金、欠了幾週、鎖了沒有 */
export interface HomeView { id: string; name: string; rent: number; level: Level; deposit: number; pool: 'cred' | 'cash'; arrears: number; locked: boolean; lockWeeks: number }
/** 內容裡的一處住處：押金照引擎的規則（週租 × 週數）；block_reason 是現在租不了的原因（引擎的 rentBlock），租得了是 null */
export interface ResidenceView { id: string; name: string; rent: number; level: Level; deposit: number; pools: Array<'cred' | 'cash'>; block: string | null; block_reason: string | null }

export const useEngine = defineStore('engine', () => {
  // 示意世界包（ui/src/data/demo；dev/work/M2-plan.md 使用者定案第 5 項）：引擎不再匯入內容，所以畫面自己帶一份，開新局時載入。
  // 測試自帶最小假資料（testContent）時不載入它。
  // 開局站在哪（示意包的起點）是 game.new 掛點給的變更（demoStartFeature），不另開一份報告，所以紀錄一開始是空的。
  // 成人場景的模式（設定 scene_mode，預設精簡；下一場生效）：每個新建的引擎都套上現在的設定
  let sceneModeNow: SceneMode = 'simple'
  const build = (extra: ContentPack[] = [], demo = true, features: Feature[] = []): Game => withSceneMode(new Game({ features: [...allFeatures(), ...(demo ? [demoStartFeature()] : []), ...features], content: [...(demo ? [CORE_PACK, demoPack()] : [CORE_PACK]), ...extra], fakeProvider: new FakeProvider() }))
  const withSceneMode = (g: Game): Game => { setSceneMode(g.k, sceneModeNow); return g }
  let game = build()
  /** 這一局載的是示意世界包（測試自帶內容時不是）：開新局之後附上示意的名冊 */
  let demoOn = true

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
  /**
   * 這一步提交新產生的報告（引擎每次提交通知的那一份）：App 靠它開帳單、顯示通知。
   * 報告的 id 每一局都從 r1 起算，所以不能用「上次看到的 id」往回找；這裡每次提交換一份、seq 加一。
   * 讀檔、開新局不算新報告（讀進來的舊紀錄不會再觸發一次）。
   */
  const feed = shallowRef<{ seq: number; reports: Report[] }>({ seq: 0, reports: [] })
  const onCommit = (_state: GameState, reports: Report[]): void => {
    if (reports.length > 0) feed.value = { seq: feed.value.seq + 1, reports: structuredClone(reports) }
    refresh()
  }
  game.subscribe(onCommit)

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

  /** 示意世界包的開局名冊（小麥、雷在名冊上，奈奈、喬是候選人）的變更：併進建角那份報告（開局不多一份紀錄） */
  const seedChanges = (): Change[] => (demoOn ? demoPeopleChanges(game.k, game.state) : [])
  /** 建角畫面還沒開始時預覽用的規則（難度、特質點）：有設定時，建角的檢查拿一份只有這些規則的空狀態去問引擎，不動現在這一局。 */
  const previewRules = shallowRef<object | null>(null)
  const cstate = (): GameState => {
    if (!previewRules.value) return game.state
    const s = blankState(0)
    s.rules = sanitizeRules(previewRules.value)
    return s
  }

  /** 開新局；有 draft 時開局與建角一起提交（被擋下就原樣回傳是哪一步，原本那一局完全不動）。 */
  function newGame(opts: { seed: number; rules?: object; draft?: CreationDraft; testContent?: ContentPack[]; testFeatures?: Feature[]; people?: boolean }): CreationBlock[] {
    const { draft, testContent, testFeatures, people, ...rest } = opts
    // 只給測試用：把測試自帶的最小內容接在核心的內容後面，換一個新的引擎（畫面與正式的流程不傳這個參數）
    if (testContent) {
      clearQueued()
      game = build(testContent, false, testFeatures)
      demoOn = false
      game.subscribe(onCommit)
    }
    if (draft) {
      const probe = blankState(0)
      probe.rules = sanitizeRules(opts.rules ?? {})
      const blocks = creationBlocks(game.k, probe, draft)
      if (blocks.length > 0) return blocks
      previewRules.value = null
      clearQueued()
      game.newGame({ ...rest, setup: (state) => withPeople(buildCreationReport(game.k, state, draft), state, people !== false, draft.origin) })
      return []
    }
    previewRules.value = null
    clearQueued()
    game.newGame(rest)
    return []
  }

  /** 建角的開新局：名冊的成員是引擎照出身的名冊放的，示意包只補候選人 */
  const withPeople = (r: ReportDraft, state: GameState, on: boolean, origin: string): ReportDraft => (on && demoOn ? { ...r, changes: [...r.changes, ...demoPeopleChanges(game.k, state, { origin: (originView(game.k, origin)?.roster ?? []).map((n) => n.id) })] } : r)
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
    if (err === null) clearQueued()
    refresh()
    return err
  }
  /** 撤退：狀態回到快照，快照之後的紀錄留著並標成被收回，多一則交代這件事的。回傳錯誤訊息或 null。 */
  function rewind(raw: string, summary: string): string | null {
    const err = game.rewind(raw, { summary })
    if (err === null) clearQueued()
    refresh()
    return err
  }
  const clock = computed(() => { void state.value; return game.clock() })
  function undo(): boolean {
    const ok = game.undoSteps(1)
    if (ok) clearQueued()
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
    if (err === null) { clearQueued(); refresh() }
    return err
  }
  /** 回到這個階段開始時（戰敗三選一的第三個）：規則在引擎（Game.rewindToStage，COMBAT_SYSTEM 8.4 節），這裡只轉接。 */
  function rewindToStage(): string | null {
    const err = game.rewindToStage()
    if (err === null) { clearQueued(); refresh() }
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
  // ---- 成人場景（M2-ui-scene）：全部轉接 features/scene，畫面不算感載、契合、主動權、預覽，也不判斷能不能做 ----
  /** 這一場結束之後的那一份報告（scene.end）：戰報卡用；按「回去」之後清掉 */
  const sceneEnded = shallowRef<Report | null>(null)
  const scene = {
    active: (): boolean => { void state.value; return sceneOf(game.state) !== null },
    /** 畫面要的全部；selected 給一個行動就多一份它的原因與預覽 */
    view: (selected?: SceneInput): SceneView | null => { void state.value; return sceneView(game.k, game.state, selected) },
    /** 九種行動一次列出來：花費、原因、要選的部位、技能與道具與體位各自的選項、預覽 */
    options: (): SceneOptions | null => { void state.value; return sceneOptions(game.k, game.state) },
    /** 內容篩選關掉的題材（存檔規則的 contentOff） */
    contentOff: (): string[] => [...state.value.rules.contentOff],
    /** 設定的模式（精簡 simple、完整 full）；下一場生效 */
    mode: (): SceneMode => sceneModeNow,
    setMode(mode: SceneMode): void { sceneModeNow = mode; setSceneMode(game.k, mode) },
    modeOfEngine: (): SceneMode => sceneModeOf(game.k),
    ended: sceneEnded,
    /** 示範的場景開場的那一句（確認框的標題）；不是示範的場景是 null */
    demoOpening: (id: string): string | null => DEMO_SCENES.find((x) => x.id === id)?.opening ?? null,
    /** 戰報卡的欄位（評價、體悟、關係、餘韻、AI 的正文）；還沒有結束是 null */
    debrief: (): Debrief | null => {
      const r = sceneEnded.value
      return r ? debriefOf(r, (c) => game.k.changes.describe(state.value, c), (fit) => ratingOf(sceneRules(game.k), fit).name) : null
    },
    clearEnded(): void { sceneEnded.value = null },
    /** 提交一份場景的報告；結束的那一份（scene.end）記下來給戰報卡 */
    async commitStep(make: () => ReportDraft, label: string): Promise<ActOutcome> {
      const before = game.state.reports.length
      const r = await commitDrafts(make, label)
      const fresh = game.state.reports.slice(before)
      const end = fresh.find((x) => x.action === 'scene.end')
      if (end) sceneEnded.value = structuredClone(end)
      return r
    },
    /** 玩家的一步 */
    act(input: SceneInput): Promise<ActOutcome> { return scene.commitStep(() => sceneAct(game.k, game.state, input), '場景') },
    /** 對方的一步（輪到他的時候） */
    next(): Promise<ActOutcome> { return scene.commitStep(() => sceneNext(game.k, game.state), '場景') },
    /** 略過：不操作，引擎直接算出結果 */
    skip(): Promise<ActOutcome> { return scene.commitStep(() => sceneSkip(game.k, game.state), '略過場景') },
    /** 輪到對方的時候一步一步呼叫對方的一步，直到交回給玩家或場景結束；wait 是每一步之間等幾毫秒（給畫面看得清楚） */
    async partnerTurn(wait = 0): Promise<void> {
      for (let i = 0; i < 40; i++) {
        const s = sceneOf(game.state)
        if (!s || s.turn !== 'partner') return
        if (wait > 0) await new Promise((res) => setTimeout(res, wait))
        const r = await scene.next()
        if (r.status !== 'applied') return
      }
    },
    /** 開一場（測試與示範用；平常是委託、戰敗事件、事件的效果開的）：引擎擋下回傳原因，開成回傳 null */
    begin(setup: unknown, origin: { by: string; ref?: string } = { by: 'ui' }): string | null {
      try {
        sceneEnded.value = null
        game.launch('scene', setup, origin)
        return null
      } catch (e) {
        const w = reasonOf(e)
        if (w === null) throw e
        return w
      }
    },
    /** 示範的場景（#/scene?scene=amber|rin）：先把對象與主角的招式放好，再開場。回傳引擎的原因或 null。 */
    startDemo(id: string): string | null {
      const d = DEMO_SCENES.find((x) => x.id === id) ?? DEMO_SCENES[0]!
      const pcId = game.state.pc
      if (pcId === null) return '還沒有主角：先去建角。'
      const pcActor = game.state.actors[pcId]!
      const changes = demoSceneChanges(d, { actor: !!game.state.actors[d.partner.id], pc: pcId, ext: pcActor.ext, items: game.state.inventory.map((x) => x.id) })
      const why = commit({ summary: '準備示範的場景', action: 'ui.demo_scene', changes }, { attach: true })
      return why ?? scene.begin(d.setup, { by: 'ui', ref: d.id })
    },
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
    /** 換一次配置要花幾分鐘（引擎的衍生數值 loadout_minutes）；沒有主角是 0 */
    loadoutMinutes: (): number => { void state.value; return game.state.pc === null ? 0 : loadoutMinutes(game.k, game.state, game.state.pc) },
    /** 套用一整組（引擎的 applyLoadout：花半小時、地點與容量由引擎檢查）；擋下時回傳原因 */
    equip: (ids: string[]): string | null => commitGear((pc) => applyLoadout(game.k, game.state, pc, ids)),
  }

  // ---- 城市、搭車、事件視窗、掃橋（M2-ui-world）：全部轉接 features/world、transit、director、security，畫面不自己判斷 ----
  /**
   * 留著等引擎放行的草稿：只有「同一個動作的前一份已經提交、後面那份被擋下」才留（例：計程車出發之後事件開了，抵達先等）。
   * 整個動作被引擎擋下（refused）的草稿不留：引擎沒做、狀態不變，之後也不會自己生效。
   * make 在放行的時候才呼叫，照當下的狀態重做；做不出來（引擎擋下）就丟掉。
   */
  interface Queued { action: string; make: () => ReportDraft }
  const queued: Queued[] = []
  /** 開新局、讀檔、回退、回到階段開始、重來戰鬥：狀態換了，留著的草稿都是舊的，全部丟掉 */
  const clearQueued = (): void => { queued.length = 0 }
  /**
   * 把一份（或幾份）報告草稿交給引擎提交（走 commitNarrated：AI 關著就是一般的提交）。草稿做不出來（被擋下）回傳原因。
   * remake(i)：第 i 份草稿（i ≥ 1）若要留著等放行，放行時用它照當下狀態重做；沒給就用原來那一份。
   */
  async function commitDrafts(make: () => ReportDraft | ReportDraft[], label?: string, remake?: (i: number) => ReportDraft): Promise<ActOutcome> {
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
        // 前面的已經提交了、這一份被擋下（例：出發之後事件開了）：留著，等引擎放行再提交（計程車的抵達）。第一份就被擋下的不留。
        if (i > 0) for (let j = i; j < drafts.length; j++) queued.push({ action: drafts[j]!.action ?? '', make: remake ? () => remake(j) : () => drafts[j]! })
        return r
      }
    }
    return last
  }
  /** 引擎放行了就把留著的草稿提交掉（事件做完之後呼叫） */
  async function drainQueued(): Promise<void> {
    while (queued.length > 0 && game.blockOf(`commit:${queued[0]!.action}`) === null) {
      const q = queued.shift()!
      let d: ReportDraft
      try { d = q.make() } catch (e) { if (reasonOf(e) === null) throw e; continue }
      await run(() => game.commitNarrated(d, { mode: 'new' }))
    }
  }
  /** 計程車抵達那一份，照現在的狀態重做（引擎的 taxiArrival；只做抵達，不問付不付得起）。 */
  const taxiArrival = (to: string): ReportDraft => transitTaxiArrival(game.k, game.state, to)

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
    /**
     * 站在出口那一格上「前往」（引擎在這一格列的 world.go，GO_USE）：照出口的 to 與 arrive 叫引擎的 arrive。
     * 不在出口上時引擎沒有列這一項，這裡回傳 refused 與原因，狀態不動。
     */
    go(): Promise<ActOutcome> {
      const view = worldView(game.k, game.state)
      const at = game.gridView()?.at
      const exit = at ? view.exits.find(x => x.at !== null && x.at[0] === at[0] && x.at[1] === at[1]) : undefined
      if (!exit) return Promise.resolve({ status: 'refused', reason: '這一格不是出口。' })
      return commitDrafts(() => worldArrive(game.k, game.state, exit.to, exit.arrive))
    },
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
    taxi: (to: string) => commitDrafts(() => transitTaxi(game.k, game.state, to), '叫計程車', () => taxiArrival(to)),
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


  // ---- 中間人與委託（M2-ui-commission）：全部轉接 features/fixer、commission、roster、explore，畫面不自己判斷 ----
  const fixer = {
    /** 內容裡的中間人（id 照內容的順序）與一位的資料 */
    ids: (): string[] => game.k.content.list<FixerEntry>('fixer').map((f) => f.id),
    entry: (id: string): FixerEntry | undefined => game.k.content.get<FixerEntry>('fixer', id),
    /** 這位中間人今天的委託、信譽夠不夠、簡報與三種付法（引擎的 board） */
    board: (id: string): BoardView => { void state.value; return fixerBoard(game.k, game.state, id) },
    /** 手上進行中的委託（最近接的在最前） */
    jobs: (): Job[] => { void state.value; return structuredClone(activeJobs(game.state)) },
    job: (id: string): Job | null => { void state.value; const j = jobOf(game.state, id); return j ? structuredClone(j) : null },
    /** 接案前的一輪交涉 */
    haggle: (offer: Pick<Offer, 'id' | 'fixer'>) => commitDrafts(() => fixerHaggle(game.k, game.state, offer), '交涉'),
    accept: (offer: Pick<Offer, 'id' | 'fixer'>, pay: PayKind) => commitDrafts(() => fixerAccept(game.k, game.state, offer, { pay }), '接案'),
    /** 放棄一件委託信譽掉多少（負數；引擎的 abandonRepOf：出發前 rep_abandon_early、出發過 rep_abandon；沒給 id 或找不到那件就是出發前的），確認框寫給玩家看 */
    abandonRep: (jobId?: string): number => {
      void state.value
      const j = jobId ? jobOf(game.state, jobId) : null
      return abandonRepOf(game.k, j ?? {})
    },
    /** 失敗一件委託信譽掉多少（負數；引擎的規則 rep_failed），副本裡的預告寫給玩家看 */
    repFailed: (): number => { void state.value; return fixerRules(game.k).rep_failed },
    /** 一件副本剛結束、入帳過的那件委託（done 或 failed；有入帳紀錄，信譽實際的變化在 payout.rep）；撤退（委託還在手上）與找不到是 null */
    settledJob: (commissionId: string): Job | null => {
      void state.value
      const j = jobsOf(game.state).filter((x) => x.commission.id === commissionId && x.status !== 'active' && x.payout !== null).sort((a, b) => b.seq - a.seq)[0]
      return j ? structuredClone(j) : null
    },
    /** 完成這件委託信譽加多少（引擎的 repGainOf，照主角現在的級；評價預設 B，S 的加成另算在 topBonus） */
    repGain: (commission: Job['commission'], rating: 'S' | 'A' | 'B' | 'C' = 'B'): { amount: number; relation: 'higher' | 'same' | 'lower'; topBonus: number } => {
      void state.value
      const g = repGainOf(game.k, game.state, { commission }, rating)
      const s = repGainOf(game.k, game.state, { commission }, 'S')
      return { amount: g.amount, relation: g.relation, topBonus: s.amount - g.amount }
    },
    drop: (jobId: string) => commitDrafts(() => fixerDrop(game.k, game.state, jobId), '放棄委託'),
    /** 踩點頁的資料（未知清單、次數與難度、手段與原因、買情報、上一次的結果） */
    scoutView: (jobId: string): ScoutView => { void state.value; return fixerScoutView(game.k, game.state, jobId) },
    scout: (jobId: string, method: string) => commitDrafts(() => fixerScout(game.k, game.state, jobId, method), '踩點'),
    buyIntel: (jobId: string, unknownId: string, pay: IntelWith) => commitDrafts(() => fixerBuyIntel(game.k, game.state, jobId, unknownId, pay), '買情報'),
    /** 召集：分帳預覽、輔助面請人的辦法與原因、借人、請與退 */
    split: (jobId: string): Split | null => { void state.value; const j = jobOf(game.state, jobId); return j ? splitPreview(game.k, game.state, j) : null },
    hireOptions: (jobId: string, face: AuxFace, actor: string): HireOption[] => { void state.value; const j = jobOf(game.state, jobId); return j ? fixerHireOptions(game.k, game.state, j, face, actor) : [] },
    borrowOption: (jobId: string, face: AuxFace): HireOption | null => { void state.value; const j = jobOf(game.state, jobId); return j ? borrowOption(game.k, game.state, j, face) : null },
    hire: (jobId: string, input: HireInput) => commitDrafts(() => fixerHire(game.k, game.state, jobId, input), '請人'),
    unhire: (jobId: string, actor: string) => commitDrafts(() => fixerUnhire(game.k, game.state, jobId, actor), '退人'),
    /** 派這些人去這一面的算式與成功率（還沒進副本也能問）；沒有人是 null */
    auxChance: (jobId: string, face: AuxFace, actors: string[], borrowed: string[] = []): AuxChance | null => {
      void state.value
      const j = jobOf(game.state, jobId)
      return j ? auxChance(game.k, game.state, j.commission as never, face, actors, borrowed) : null
    },
    /** 出發不成立的原因（可以出發是 null；戰鬥中、事件開著等引擎的放行也算） */
    goBlock: (jobId: string): string | null => {
      void state.value
      const j = jobOf(game.state, jobId)
      return j ? fixerGoBlock(game.k, game.state, j) ?? game.blockOf('commit:fixer.go') : '手上沒有這件委託。'
    },
    go: (jobId: string) => commitDrafts(() => fixerGo(game.k, game.state, jobId), '出發'),
    /** 名冊（成員、容量、有沒有空）與召集 */
    roster: () => { void state.value; return rosterView(game.k, game.state) },
    musterBlocks: (party: string[], tagalong: string[]): string[] => { void state.value; return musterBlocks(game.k, game.state, { party, tagalong }) },
    muster: (party: string[], tagalong: string[]) => commitDrafts(() => rosterMuster(game.k, game.state, { party, tagalong }), '召集'),
    /** 隊上現在的人（含主角） */
    party: (): string[] => { void state.value; return [...game.state.party] },
    /** 隊伍與同行的人數上限（引擎的名冊規則 party_max、tagalong_max；資料可以蓋掉） */
    crewRules: (): { party: number; tagalong: number } => { void state.value; const r = rosterRules(game.k); return { party: r.party_max, tagalong: r.tagalong_max } },
    /** 角色的名字（顯示用） */
    actorName: (id: string): string => game.state.actors[id]?.name ?? id,
  }

  const commission = {
    /** 現在這件副本的樣子（階段軌、面、分支與原因、連動、警戒、喘口氣與撤退、評價預估）；不在副本裡是 null */
    view: (): CommissionView | null => { void state.value; return commissionView(game.k, game.state) },
    chooseFace: (face: 'meat' | 'net' | 'opinion') => commitDrafts(() => chooseFace(game.k, game.state, face), '選面'),
    chooseBranch: (id: string) => commitDrafts(() => chooseBranch(game.k, game.state, id), '進入這一段'),
    breathe: () => commitDrafts(() => commissionBreathe(game.k, game.state), '喘口氣'),
    retreat: () => commitDrafts(() => commissionRetreat(game.k, game.state), '撤退'),
    check: () => commitDrafts(() => commissionCheckGoal(game.k, game.state), '動手'),
    scene: () => commitDrafts(() => commissionPlayScene(game.k, game.state), '場景'),
    replay: () => commitDrafts(() => commissionReplay(game.k, game.state), '再來一次'),
    /** 這一格能做的事（引擎的 grid.here.uses；id 對應 explore 的 take、plug、key、seize、open、carry、leave） */
    use: (id: string) => commitDrafts(() => exploreFeature.useHere(game.k as unknown as GridKernel, game.state, id), '這一格'),
    /** 身邊上鎖的門：撬鎖（pick）或破門（break） */
    unlock: (at: [number, number], how: 'pick' | 'break') => commitDrafts(() => exploreUnlock(game.k as unknown as GridKernel, game.state, at, how), how === 'pick' ? '撬鎖' : '破門'),
  }

  // ---- 過日子（M2-ui-life）：全部轉接 features/trade、bills、work、rest，畫面不算價錢、報酬、回復量，也不判斷能不能做 ----
  const shopExists = (id: string): boolean => !!game.k.content.get('shop', id)
  const trade = {
    has: (id: string): boolean => { void state.value; return shopExists(id) },
    /** 一間店的畫面（抬頭、貨架與每一列的價錢拆解與原因、背包裡這間店收的東西、殺價）；沒有這間店是 null */
    view: (id: string): ShopView | null => { void state.value; return shopExists(id) ? shopView(game.k, game.state, id) : null },
    /** 進行中的活動（委託副本……）擋住結帳與殺價時的原因；可以做是 null */
    lock: (): string | null => { void state.value; return game.blockOf('commit:trade.checkout') },
    /** 這一車結不結得了：每一列的價錢、淨額與所有不成立的原因（引擎的 planCheckout）；不改任何東西 */
    plan: (id: string, cart: Cart): CheckoutPlan => { void state.value; return planCheckout(game.k, game.state, id, cart) },
    /** 這樣東西在哪幾區便宜、哪幾區貴（價差提示）；沒有定價是 null */
    routes: (item: string): RoutesHint | null => {
      void state.value
      try { return routesHint(game.k, game.state, item) } catch { return null }
    },
    checkout: (id: string, cart: Cart) => commitDrafts(() => tradeCheckout(game.k, game.state, id, cart), '結帳'),
    /** 殺價（整車、每間店每天一次）：擲骰的送主動行動，用人情的直接提交 */
    bargain: (id: string, method: BargainMethod): Promise<ActOutcome> =>
      method === 'favor' ? commitDrafts(() => bargainByFavor(game.k, game.state, id), '殺價') : act(bargainInput(game.k, game.state, id, method)),
  }

  const bills = {
    /** 下一次要付的每一項、帳戶與現金夠不夠、會停在哪一項、下坡的四格（引擎的 billPreview） */
    preview: (): BillPreview => { void state.value; return billPreview(game.k, game.state) },
    /** 改設定被活動擋住的原因（副本裡不能改）；可以改是 null */
    lock: (): string | null => { void state.value; return game.blockOf('commit:bill.set') },
    /** 一項改成用現金付、或這一項不付了 */
    set: (item: string, patch: BillSetting) => commitDrafts(() => setBill(game.k, game.state, item, patch), '帳單'),
    /** 最近一份結算的報告（bill.settle）；還沒結過是 null。每一項付了多少、欠多少在 timeline 的 data */
    lastSettle: (): Report | null => {
      const list = state.value.reports
      for (let i = list.length - 1; i >= 0; i--) if (list[i]!.action === 'bill.settle') return structuredClone(list[i]!)
      return null
    },
  }

  const work = {
    /** 站的這個位置能做的工作（階段、升階的條件與進度、預計的錢與成功率、現在不能做的原因、上一班） */
    here: (): JobView[] => { void state.value; return jobsHere(game.k, game.state) },
    lock: (): string | null => { void state.value; return game.blockOf('commit:work.shift') },
    /** 上一班：升階的詢問是事件，做完之後事件視窗自己打開 */
    shift: (job: string, hours: number) => commitDrafts(() => workShift(game.k, game.state, job, hours), '打工'),
  }

  const rest = {
    /** 睡處的選項（回復率、價錢、選不了的原因） */
    options: (): SleepOption[] => { void state.value; return sleepOptions(game.k, game.state) },
    /** 睡一覺本身現在不能做的原因（活動擋住、距上次太近）；能是 null */
    sleepBlock: (): string | null => { void state.value; return sleepBlock(game.k, game.state) },
    breathBlock: (): string | null => { void state.value; return breathBlock(game.k, game.state) },
    /** 兩次睡一覺之間喘口氣會回生命值的次數：已經用了幾次、一共幾次 */
    breaths: (): { used: number; heals: number } => { void state.value; return { used: readRest(game.state).breaths, heals: restRules(game.k).breath_heals } },
    sleep: (spot?: SleepSpotId, pay?: 'cred' | 'cash') => commitDrafts(() => sleepDraft(game.k, game.state, { ...(spot ? { spot } : {}), ...(pay ? { pay } : {}) }), '睡一覺'),
    breath: () => commitDrafts(() => breathDraft(game.k, game.state), '喘口氣'),
    home: (): HomeView | null => {
      void state.value
      const h = homeOf(game.k, game.state)
      return h ? { id: h.residence.id, name: h.residence.name, rent: h.residence.rent, level: h.residence.level, deposit: h.home.deposit, pool: h.home.pool, arrears: h.home.arrears, locked: h.home.locked, lockWeeks: restRules(game.k).lock_weeks } : null
    },
    /** 內容裡的住處與現在租不租得了（原因是引擎的）；押金是引擎的 depositOf */
    residences: (): ResidenceView[] => {
      void state.value
      return game.k.content.list<ResidenceEntry>('residence').map((r) => ({
        id: r.id, name: r.name, rent: r.rent, level: r.level, deposit: depositOf(game.k, r), pools: residencePools(r),
        block: game.k.content.get<{ id: string; name?: string }>('block', r.block)?.name ?? null, block_reason: rentBlock(game.k, game.state, r.id),
      }))
    },
    leaveBlock: (): string | null => { void state.value; return leaveBlock(game.k, game.state) },
    rent: (id: string, pay?: 'cred' | 'cash') => commitDrafts(() => rentDraft(game.k, game.state, id, pay ? { pay } : {}), '租房'),
    leave: () => commitDrafts(() => leaveDraft(game.k, game.state), '退租'),
  }


  // ---- 人（M2-ui-people）：全部轉接 features/npcs、roster、favors、abilities，畫面不算 DC、成功率、親密度的階段、容量 ----
  /** 查內容的名字（顯示用，不是規則） */
  const nameIn = (kind: string, id: string): string => game.k.content.get<{ id: string; name?: string; short?: string }>(kind, id)?.name ?? id
  const peopleLook = {
    tag: (id: string): string => nameIn('tendency_tag', id),
    faction: (id: string): string => game.k.content.get<{ id: string; short?: string; name?: string }>('faction', id)?.short ?? nameIn('faction', id),
    path: (id: string): string => nameIn('path', id),
    item: (id: string): string => nameIn('item', id),
    place: (loc: { district?: string; block?: string; facility?: string }): string => placeName(loc),
  }
  const people = {
    look: peopleLook,
    /** 示意局（第 14 天）用：示意名冊的變更，放進推到第 14 天那一筆帳裡（沒有載示意包是空的） */
    demoChanges: (): Change[] => seedChanges(),
    /** 這個位置、時段與星期對得上出沒表的人（引擎的 npcsHere） */
    here: (): Npc[] => { void state.value; return npcsHere(game.k, game.state) },
    npc: (id: string): Npc | null => { void state.value; return npcOf(game.k, game.state, id) ?? null },
    /** 認識的人（有關係條目）的 id */
    known: (): string[] => { void state.value; return Object.keys(readNpcs(game.state).rel).sort() },
    rel: (id: string): Relation | null => { void state.value; return relationOf(game.state, id) ?? null },
    affinity: (id: string): number => { void state.value; return meterOf(game.k, game.state, 'affinity', id) },
    stage: (id: string): StageView => { void state.value; return affinityStage(meterOf(game.k, game.state, 'affinity', id)) },
    /** 忠誠（名冊上的人才有意義；不在名冊上是 null） */
    loyalty: (id: string): number | null => { void state.value; return Object.hasOwn(readRoster(game.state).members, id) ? meterOf(game.k, game.state, 'loyalty', id) : null },
    /** 對這個人每一種互動：能不能做、原因、DC 與成功率（引擎的 interactions） */
    interactions: (id: string): InteractionView[] => { void state.value; return interactions(game.k, game.state, id) },
    /** 送出一個互動（主動行動：先擲骰再判定）；被擋下的原因是引擎的 */
    interact: (kind: InteractKind, id: string, extra: InteractExtra = {}): Promise<ActOutcome> => {
      try {
        return act(interactInput(game.k, game.state, kind, id, extra))
      } catch (e) {
        return Promise.resolve({ status: 'refused', reason: reasonOf(e) ?? '現在做不了。' })
      }
    },
    /** 還不認識的人在這裡：先認識他（引擎的 meetNpc） */
    meet: (id: string) => commitDrafts(() => meetNpc(game.k, game.state, id), '認識'),
    watch: (id: string, on: boolean) => commitDrafts(() => watchNpc(game.k, game.state, id, on), on ? '關注' : '取消關注'),
    /** 共同記憶：這個人的（照引擎的檢索取前幾筆，沒給 limit 就是引擎的預設）或全部 */
    recall: (id: string, limit?: number): Memory[] => {
      void state.value
      const l = game.state.location
      return recall(game.k, game.state, { who: id, where: { ...(l.district ? { district: l.district } : {}), ...(l.block ? { block: l.block } : {}), ...(l.facility ? { facility: l.facility } : {}) }, ...(limit !== undefined ? { limit } : {}) })
    },
    memoriesOf: (id: string): Memory[] => { void state.value; return memoriesOf(game.state).filter((m) => m.who.includes(id)) },
    editMemory: (id: string, patch: MemoryPatch) => commitDrafts(() => editMemory(game.k, game.state, id, patch), '改記憶'),
    forgetMemory: (id: string) => commitDrafts(() => forgetMemory(game.k, game.state, id), '刪記憶'),
    news: (id: string): NewsItem[] => { void state.value; return newsOf(game.state, id) },
    /** 和這個人的互動紀錄（引擎的報告，照時間，最新的在最下面） */
    talkLog: (id: string, limit = 12): EngineLogEntry[] => {
      void state.value
      return game.state.reports.filter((r) => r.args?.target === id && r.action !== 'ui.legacy').slice(-limit)
        .map((r) => logEntryOf(r, (c: Change[]) => game.k.changes.describe(game.state, c), placeName))
    },
    /** 名冊：容量、成員（出場費、忠誠、有空沒有）、候選人、同行 */
    roster: () => { void state.value; return rosterView(game.k, game.state) },
    isRunner: (id: string): boolean => { void state.value; return rosterIsRunner(game.state, id) },
    /** 招募：現在能不能（引擎的原因）、DC 與每一條來源、成功率 */
    recruitInfo: (id: string): { block: string | null; dc: number; mods: Array<{ label: string; value: number }>; chance: number | null } => {
      void state.value
      const block = rosterRecruitBlock(game.k, game.state, id)
      const d = recruitDc(game.k, game.state, id)
      const def = game.k.actions.get('npc_recruit')
      const input = { kind: 'npc_recruit', target: id }
      let chance: number | null = null
      try { chance = def ? successChance(game.k, game.state, def, input, d.dc) : null } catch { chance = null }
      return { block, dc: d.dc, mods: d.mods, chance }
    },
    recruit: (id: string): Promise<ActOutcome> => {
      try {
        return act(recruitInput(game.k, game.state, id))
      } catch (e) {
        return Promise.resolve({ status: 'refused', reason: reasonOf(e) ?? '現在招募不了。' })
      }
    },
    /** 把成員拿出名冊（引擎的 leave） */
    removeMember: (id: string) => commitDrafts(() => rosterLeave(game.state, id, 'removed'), '拿出名冊'),
    /** 這個人是候選人嗎（候選人名單的列） */
    candidates: (): RosterCandidate[] => { void state.value; return readRoster(game.state).candidates },
    /** 人情：欠你的與你欠的（引擎的 favorsOf） */
    favors: (): FavorsState => { void state.value; return favorsOf(game.state) },
    /** 人情的對象（角色、固定 NPC 或勢力）的名字；都查不到才用 id */
    favorName: (who: string): string => game.state.actors[who]?.name ?? (game.k.content.has('npc', who) ? nameIn('npc', who) : game.k.content.has('faction', who) ? peopleLook.faction(who) : who),
    favorUseBlock: (id: string): string | null => { void state.value; return favorSpendBlock(game.k, game.state, { id }) },
    favorUse: (id: string) => commitDrafts(() => favorSpend(game.k, game.state, { id }), '用掉人情'),
    /** 被討：答應（do）或回絕（refuse） */
    favorAnswer: (id: string, answer: 'do' | 'refuse') => commitDrafts(() => favorCall(game.k, game.state, id, answer), answer === 'do' ? '答應' : '回絕'),
  }

  // ---- 主畫面的小隊與狀態列的敵對值：讀引擎的隊伍、生命值、感載與量表 ----
  const statOf = (id: string, stat: string, fallback: number): number => (game.k.stats.hasStat(stat) ? Math.max(1, game.k.stats.stat(game.state, id, stat)) : fallback)
  /** 小隊（引擎的 state.party；生命值與感載上限是引擎的衍生數值 max_hp、load_cap）。主職是路數的名字（沒有路數的主角不寫） */
  function partyRows(): PartyMember[] {
    void state.value
    const s = game.state
    return s.party.flatMap((id): PartyMember[] => {
      const a = s.actors[id]
      if (!a) return []
      const main = (Array.isArray(a.ext.paths) ? a.ext.paths as Array<{ path: string; slot: string }> : []).find((p) => p.slot === 'main')
      return [{ id, name: a.name, role: main ? peopleLook.path(main.path) : '', sink: a.sink, hp: [a.hp, statOf(id, 'max_hp', Math.max(1, a.hp))], load: [a.load, statOf(id, 'load_cap', Math.max(1, a.load))], afterglow: a.afterglow, me: id === s.pc }]
    })
  }
  /** 敵對值清單（引擎的 hostilityView：floor 已是永久與有期限取較高）；timed 是還沒到期的有期限下限，days 是剩幾天（進位） */
  function hostilityRows(): Array<HostilityRow & { timed: Array<{ value: number; days: number }> }> {
    void state.value
    const now = game.state.time
    const nowMin = toMinutes(now)
    const timed = timedFloors(game.state)
    return hostilityView(game.k, game.state).map((r) => ({
      ...r,
      timed: timed.filter((f) => f.faction === r.faction && f.until > nowMin).map((f) => ({ value: f.value, days: Math.max(1, Math.ceil((f.until - nowMin) / 1440)) })).sort((a, b) => b.value - a.value),
    }))
  }
  /** 敵對值最高的幾個勢力（引擎的量表 hostility；0 的不列）。名字是勢力的短名 */
  function hostilityTop(n = 2): Array<[string, number]> {
    void state.value
    return game.k.content.list<{ id: string }>('faction')
      .map((f): [string, number] => [peopleLook.faction(f.id), meterOf(game.k, game.state, 'hostility', f.id)])
      .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n)
  }

  return { state, feed, partyRows, hostilityTop, hostilityRows, world, transit, people, event, fixer, commission, scene, trade, bills, work, rest, placeName, skills, gear, battle, inBattle, defeat, pendingDefeat, blockOf, battleOptions, battleMode, startBattle, startEncounter, encounters, battleAct, battleNext, finishBattle, retryBattle, rewindToStage, acceptDefeat: acceptDefeatNow, defeatFlow, sceneGate, eventInline, hostEvent, contentName, hasCharacter, pc, money, timeLabel, log, busy, chainSteps, canUndo, clock, newGame, createCharacter, creation, act, retryStep, useRules, reroll, stepActions, rewind, setAi, save, checkSave, load, undo, commit, ledger }
})
