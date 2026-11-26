import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ActionInput, ContentEntry, ItemStack, Feature, ContentPack, ItemEntry, Actor, AttributeEntry, BattleInput, BattleMode, BattleOptions, BattleSetup, BattleStepResult, Change, GameState, GridDir, GridView, Report, ReportDraft, SkillEntry, OriginEntry, PerkEntry } from '@engine/src'
import { lockedTarget, ActionBlocked, ChangeError, FakeProvider, Game, stackPart, partTypeName, productOf, productPrice, slotProblems, NET_LEGEND, SYNC_GEARS, gridHere, meterOf, sightOf, syncBlocks, syncCapOf, syncRuleOf, modeOf, statusRuleOf, unpackSave, attrMod as engineAttrMod, blankState, sanitizeRules, contentAllowed } from '@engine/src'
import type { ActStatus, StepActions } from '@engine/src'
import type { StepRecord } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { CAP_STAT, LOAD_STAT, armorOf, concealment, dyeBlock as gearDyeBlock, dyeDraft as gearDyeDraft, dyeOf as gearDyeOf, dyeShopHere, equip as gearEquip, equipBlock as gearEquipBlock, coveredSlots, gearOf, gearRules, overweight as gearOverweight, quickBlock, quickCapacity, scanFinds, styleOf, unequip as gearUnequip, weaponOf } from '@engine/src/features/gear'
import type { DyeOpts } from '@engine/src/features/gear'
import * as craftFx from '@engine/src/features/craft'
import { dissectDraft, dissectOptions, unitFormView } from '@engine/src/features/enemies'
import type { UnitFormView } from '@engine/src/features/enemies'
import * as curtainFx from '@engine/src/features/curtain'
import * as unregFx from '@engine/src/features/unreg'
import * as auctionFx from '@engine/src/features/auction'
import type { DissectOption } from '@engine/src/features/enemies'
import type { BlueprintEntry, PartEntry } from '@engine/src/features/gear'
import type { GearLookup } from '../lib/gearView'
import { abilitiesOf, usesOf as abilityUses, capacityOf, applyLoadout, loadoutMinutes, loadoutBlock as abilityLoadoutBlock, learn as abilityLearn, learnBlock as abilityLearnBlock, resonanceOn, treeTier, TREE_XP, skillUpBlock, skillUpCost, skillUpDraft, respecBlock, respecDraft, respecQuote, SKILL_UP_ACTION, RESPEC_ACTION } from '@engine/src/features/abilities'
import type { AbilityEntry, AbilityState, PathEntry } from '@engine/src/features/abilities'
import { acceptDefeat, chooseDefeatOption, defeatOf, defeatView, skipDefeat, watchDefeat } from '@engine/src/features/defeat'
import type { DefeatViewInfo } from '@engine/src/features/defeat'
import { auxChance, breathe as commissionBreathe, chooseBranch, chooseFace, commissionView, checkGoal as commissionCheckGoal, playScene as commissionPlayScene, replay as commissionReplay, retreat as commissionRetreat } from '@engine/src/features/commission'
import type { AuxChance, CommissionView } from '@engine/src/features/commission'
import { abandonRepOf, accept as fixerAccept, activeJobs, board as fixerBoard, borrowOption, buyIntel as fixerBuyIntel, drop as fixerDrop, fixerRules, go as fixerGo, goBlock as fixerGoBlock, haggle as fixerHaggle, hire as fixerHire, hireOptions as fixerHireOptions, jobOf, jobsOf, repGainOf, scout as fixerScout, scoutView as fixerScoutView, splitPreview, unhire as fixerUnhire } from '@engine/src/features/fixer'
import type { AuxFace, BoardView, FixerEntry, HireInput, HireOption, IntelWith, Job, Offer, PayKind, ScoutView, Split } from '@engine/src/features/fixer'
import { muster as rosterMuster, musterBlocks, rosterRules, rosterView, recruitBlock as rosterRecruitBlock, recruitDc, recruitInput, readRoster, leave as rosterLeave, isRunner as rosterIsRunner } from '@engine/src/features/roster'
import type { Candidate as RosterCandidate } from '@engine/src/features/roster'
import { CALL_MAX, GIFT_NOTE_MAX, callNamesBlock, callNamesDraft, callNamesOf, affinityStage, editMemory, forgetMemory, interactInput, interactions, memoriesOf, meetNpc, newsOf, npcOf, npcsHere, readNpcs, recall, relationOf, successChance, watchNpc } from '@engine/src/features/npcs'
import type { InteractExtra, InteractKind, InteractionView, Memory, MemoryPatch, NewsItem, Npc, Relation, StageView } from '@engine/src/features/npcs'
import { call as favorCall, favorsOf, spend as favorSpend, spendBlock as favorSpendBlock } from '@engine/src/features/favors'
import type { FavorsState } from '@engine/src/features/favors'
import { exploreFeature, unlock as exploreUnlock } from '@engine/src/features/explore'
import type { GridKernel } from '@engine/src'
import { SKILL_KIND as NIGHT_SKILL_KIND, RESONANCE_KIND, resonanceOf, sexRecordOf, ratingOf, sceneCanSkip, sceneGateSummary, sceneOptions, sceneRawOf, sceneRules, sceneView, setSceneMode, sceneModeOf } from '@engine/src/features/scene'
import type { SceneInput, SceneMode, SceneOptions, SceneView, StartSummary } from '@engine/src/features/scene'
import { learnBlock as nightLearnBlock, learnDraft as nightLearnDraft, nightList } from '@engine/src/features/nightclass'
import type { NightListView } from '@engine/src/features/nightclass'
import { AVATAR_GENDERS, AVATAR_PARTS, AVATAR_SAVES_MAX, AVATAR_TEXT_MAX, avatarBlock, avatarDraft, avatarOf } from '@engine/src/features/deck'
import type { Avatar, AvatarOpts } from '@engine/src/features/deck'
import type { SceneResult } from '@engine/src'
import { setupFromEncounter } from '@engine/src/features/enemies'
import { netBattleView, repairBlock as netRepairBlock, repairDraft as netRepairDraft, repairHere as netRepairHere, repairRows as netRepairRows } from '@engine/src/features/netcombat'
import type { RepairRow as NetRepairRow } from '@engine/src/features/netcombat'
import { deckOf, deckView, equipDraft as deckEquipDraft, installDraft as deckInstallDraft, removeDraft as deckRemoveDraft, scriptsBlock as deckScriptsBlock, scriptsDraft as deckScriptsDraft, skinDraft as deckSkinDraft, deckExtOf } from '@engine/src/features/deck'
import type { ConstructEntry, DeckView, ScriptEntry } from '@engine/src/features/deck'
import type { NetBattleView } from '@engine/src/features/netcombat'
import { descend as netDescend, keptOf, logout as netLogout, netExt, netrunView, useNode as netUseNode } from '@engine/src/features/netrun'
import { diveOptions, diveView, enter as diveEnter, exit as diveExit, go as diveGo } from '@engine/src/features/dive'
import type { DiveOptions, DiveView } from '@engine/src/features/dive'
import { brackets as mazeBrackets, enter as mazeEnter, mazeView, useMaze } from '@engine/src/features/maze'
import type { BracketRow, MazeView } from '@engine/src/features/maze'
import type { NetrunView } from '@engine/src/features/netrun'
import { arrive as worldArrive, cityGraph, worldView } from '@engine/src/features/world'
import type { CityGraph, WorldView } from '@engine/src/features/world'
import { advance as transitAdvance, advanceBlock as transitAdvanceBlock, alight as transitAlight, board as transitBoard, boardBlock as transitBoardBlock, taxi as transitTaxi, taxiArrival as transitTaxiArrival, transitView, wait as transitWait } from '@engine/src/features/transit'
import type { BoardInput, TransitView } from '@engine/src/features/transit'
import { chooseOption, directorView, eventView } from '@engine/src/features/director'
import type { DirectorView, EventView } from '@engine/src/features/director'
import { toMinutes, fromMinutes, formatTime, weekdayOf } from '@engine/src'
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
import * as cyberware from '@engine/src/features/cyberware'
import * as medical from '@engine/src/features/medical'
import * as drugs from '@engine/src/features/drugs'
import * as sink from '@engine/src/features/sink'
import * as contractFx from '@engine/src/features/contract'
import * as malwareFx from '@engine/src/features/malware'
import * as tuningFx from '@engine/src/features/tuning'
import * as lureFx from '@engine/src/features/lure'
import { lessonBlock as trainBlock, lessonDraft as trainDraft, teachOptions as trainOptions, tutorBlock as tutorBlockFx, tutorDraft as tutorDraftFx, tutorMax, tutorOptions as tutorOptionsFx, FACILITY_MAX } from '@engine/src/features/abilities'
import type { LessonOpts as TrainOpts, TeachOption, TutorOpts, TutorOption } from '@engine/src/features/abilities'
import { AXES, AXIS_NAME, BRIDGE_PARAMS, PARAM_NAME, TAG_KIND, bridgeOf as lewdBridgeOf, tendencyOf } from '@engine/src/features/lewd'
import type { TagEntry } from '@engine/src/features/lewd'
import { paramStatId } from '@engine/src/features/lewd/model'

import { PASSIVE_SOURCE_NAMES } from '@engine/src'
import type { RollPart } from '@engine/src'
import type { BodyBag, BodyBagKind, BodyPassive } from '../lib/bodyView'
import type { PartyMember } from '../data/types'
import { DEMO_SCENES, demoBoundChanges, demoBodyChanges, demoHolderChanges, demoCraftChanges, demoNetChanges, demoPack, demoPeopleChanges, demoPartsChanges, demoAuctionChanges, demoSceneChanges, demoStartFeature, withDemoOrigins, demoCurtainChanges } from '../data/demo'
import type { CreationBlock, CreationDraft } from '@engine/src/features/creation'
import { MAX_KINKS, TABLE_NAME, abilitiesStepBlock, ageBlock, askStep, attrBlock, attrBudget, attrStepBlock, attrTotals, buildCreationReport, creationBlocks, creationCatalog, creationLimits, creationLook, lookTexts, suggestedKit, creationSummary, cyberStepBlock, gearStepBlock, kinkChoices, lifepathProblems, lifepathResults, lifepathRoll, lifepathTables, originView, perkBlock, perkSummary, skillBlock, skillLeft, startMoney } from '@engine/src/features/creation'
import type { BodyStep, LifepathTable } from '@engine/src/features/creation'
import { NO_BRIDGE_ABILITY, NO_BRIDGE_NOTE } from '@engine/src/features'
import { treeTierOf } from '@engine/src/features/abilities/learn'
import { debriefOf } from '../lib/scene/sceneView'
import type { Debrief } from '../lib/scene/sceneView'
import { lastRound as auctionLastRound, settlementOf as auctionSettlementOf } from '../lib/auctionView'
import { aiSettingsFromUi, logEntryOf, type EngineLogEntry, type UiAiFields } from '../lib/engineView'

/**
 * 包住引擎的 store：呼叫引擎的動作、拿回報告、把狀態交給畫面。不寫規則。
 * 引擎的 state 是普通物件、會被整份換掉內容，所以每次變化後把一份複製放進 shallowRef。
 */
/** 示意局的開局：一般、主角是契約人（欠伊甸園的債，佇列三條）、主角是持約人（買下阿音的債） */
export type StartKind = 'normal' | 'bound' | 'holder'
/** 開新局的「示意模式」：關著時沒有任何示意捷徑（契約開局、簾後館邀請函、拍賣行常客的交情）；開著才依選項給。 */
export interface DemoOpts { on: boolean; /** 簾後館：開局給一張邀請函 */ invite?: boolean; /** 拍賣行：常客的交情夠寫推薦函 */ auction?: boolean }
export interface ActOutcome { status: ActStatus | 'busy'; reason?: string; /** 提醒（玩家寫的寫法指令被截到 200 字、AI 關著指令用不到） */ notices?: string[] }
/** 自己潛進去的一趟離開時的帳（見 store 的 lastEnd）：報告的句子、拿到的東西、迷宮館的結算 */
export interface EndRecord {
  seq: number
  action: string
  outcome: string
  summary: string
  lines: string[]
  loot: Array<{ name: string; qty: number }>
  region: string
  layers: number
  rounds: number
  dig: boolean
  maze: { summary: string; data: Record<string, unknown> } | null
  /** 簾後館的結算（curtain.result 的資料：獎金、打賞、票根、保證金；引擎算好的） */
  curtain: { summary: string; data: Record<string, unknown> } | null
}

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
  const build = (extra: ContentPack[] = [], demo = true, features: Feature[] = [], provider?: FakeProvider): Game => withSceneMode(new Game({ features: [...allFeatures(), ...(demo ? [demoStartFeature()] : []), ...features], content: [...(demo ? [withDemoOrigins(CORE_PACK), demoPack()] : [CORE_PACK]), ...extra], fakeProvider: provider ?? new FakeProvider() }))
  const withSceneMode = (g: Game): Game => { setSceneMode(g.k, sceneModeNow); return g }
  let game = build()
  /** 這一局是用「示意模式」開的（開新局的開關；關著沒有任何示意捷徑）。讀檔、測試自帶內容時是 false */
  const demoMode = ref(false)
  /** 這一局載的是示意世界包（測試自帶內容時不是）：開新局之後附上示意的名冊 */
  let demoOn = true

  const snapshot = (): GameState => structuredClone(game.state)
  const state = shallowRef<GameState>(snapshot())
  const steps = shallowRef<StepRecord[]>([])
  const undoSize = ref(0)
  const busy = ref(false)
  /** 每一步之後看有沒有可以交的未登錄零件：有就排一次交貨（微任務；不在同一次提交裡再提交） */
  function scheduleDeliver(): void {
    if (unregFx.readyParts(game.k, game.state).some((p) => !game.unregPaused().includes(p.id))) queueMicrotask(() => { void deliverReady() })
  }

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
  /**
   * 委託的內海階段離開時的那份帳（M3-ui-commission-net）：引擎把這一趟拿到的東西放在 activity.end 的結果裡，不留在副本的狀態上，
   * 畫面在這一段還開著的時候每次提交都抄一份引擎的 netrunView（loot、controls、層數），這一段結束後副本頁拿它寫「拿到的東西」。不算任何東西。
   */
  const netStageMemo = shallowRef<{ run: string; commission: string; stage: number; loot: Array<{ name: string; qty: number }>; controls: number; layers: number; rounds: number } | null>(null)
  function rememberNetStage(): void {
    const nv = netrunView(game.k, game.state)
    const cv = commissionView(game.k, game.state)
    if (!cv) { netStageMemo.value = null; return }
    if (!nv || nv.kind !== 'face.net') return
    netStageMemo.value = { run: nv.id, commission: cv.id, stage: cv.stage, loot: nv.loot.map((l) => ({ name: l.name, qty: l.qty })), controls: nv.controls.length, layers: nv.layer.total, rounds: nv.round }
  }
  /**
   * 自己潛進去的那一趟（netrun）離開時的帳（M3-ui-dive）：拿到的東西只在 activity.end 的 result 裡，所以畫面開著的時候每次提交都抄一份引擎的 netrunView（loot、設施、層數），
   * 離開那一份報告（netrun.logout／end／located）進來時，連同報告的句子（敵對值、後門、丟掉的東西是引擎寫的）與迷宮館的結算（maze.result 的資料）收成一份給畫面。不算任何東西。
   */
  const runMemo = shallowRef<{ id: string; kind: string; region: string; loot: Array<{ name: string; qty: number }>; layers: number; rounds: number; site: string | null } | null>(null)
  const lastEnd = shallowRef<EndRecord | null>(null)
  function rememberRun(): void {
    const nv = netrunView(game.k, game.state)
    if (nv && nv.kind === 'netrun' && runMemo.value?.id !== nv.id) lastEnd.value = null
    // 行程沒了又沒有結束報告收走（接受戰敗、回退……）：舊的帳不留
    if (!nv && runMemo.value) runMemo.value = null
    if (nv && nv.kind === 'netrun') runMemo.value = { id: nv.id, kind: nv.kind, region: nv.region.name, loot: nv.loot.map((l) => ({ name: l.name, qty: l.qty })), layers: nv.layer.total, rounds: nv.round, site: nv.dig?.site ?? null }
  }
  /** 讀檔、回退、開新局、重來：這一趟的帳都不算數了，清掉（之後只認引擎現在的行程） */
  function clearMemos(): void { runMemo.value = null; lastEnd.value = null; netStageMemo.value = null; rememberRun(); rememberNetStage() }
  function recordEnd(reports: Report[]): void {
    const end = reports.find((r) => r.action === 'netrun.logout' || r.action === 'netrun.end' || r.action === 'netrun.located')
    const memo = runMemo.value
    if (!end || !memo) return
    const maze = reports.find((r) => r.action === 'maze.result')
    const curtainResult = reports.find((r) => r.action === 'curtain.result')
    lastEnd.value = {
      seq: feed.value.seq, action: end.action ?? '', outcome: end.outcome.result, summary: end.outcome.summary, lines: [...(end.narration?.results ?? [])],
      loot: memo.loot, region: memo.region, layers: memo.layers, rounds: memo.rounds, dig: memo.site !== null,
      maze: maze ? { summary: maze.outcome.summary, data: (maze.timeline[0]?.data ?? {}) as Record<string, unknown> } : null,
      curtain: curtainResult ? { summary: curtainResult.outcome.summary, data: (curtainResult.timeline[0]?.data ?? {}) as Record<string, unknown> } : null,
    }
    runMemo.value = null
  }
  const onCommit = (_state: GameState, reports: Report[]): void => {
    if (reports.length > 0) feed.value = { seq: feed.value.seq + 1, reports: structuredClone(reports) }
    refresh()
    rememberNetStage()
    recordEnd(reports)
    rememberRun()
    scheduleDeliver()
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
  function newGame(opts: { seed: number; rules?: object; draft?: CreationDraft; testContent?: ContentPack[]; testFeatures?: Feature[]; testProvider?: FakeProvider; people?: boolean; start?: StartKind; demo?: DemoOpts }): CreationBlock[] {
    const { draft, testContent, testFeatures, testProvider, people, start, demo, ...rest } = opts
    demoMode.value = demo?.on === true
    // 只給測試用：把測試自帶的最小內容接在核心的內容後面，換一個新的引擎（畫面與正式的流程不傳這個參數）
    if (testContent) {
      clearQueued()
      game = build(testContent, false, testFeatures, testProvider)
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
      game.newGame({ ...rest, setup: (state) => withPeople(buildCreationReport(game.k, state, draft), state, people !== false, draft, demo?.on ? start ?? 'normal' : 'normal', demo?.on ? demo : undefined) })
      return []
    }
    previewRules.value = null
    clearQueued()
    game.newGame(rest)
    return []
  }

  /**
   * 建角的開新局：名冊的成員是引擎照出身的名冊放的，示意包只補候選人。
   * 草稿自己選了橋、義體或裝備（第 6、9 步）時，身上有什麼完全是引擎照選的給的：示意包不再送那一副橋、甲板、義眼與整包構裝（只補組裝的零件與候選人）。
   */
  const withPeople = (r: ReportDraft, state: GameState, on: boolean, draft: CreationDraft, start: StartKind = 'normal', demo?: DemoOpts): ReportDraft => {
    if (!(on && demoOn)) return r
    const picked = draft.bridge !== undefined || draft.cyber !== undefined || draft.gear !== undefined
    const roster = { origin: (originView(game.k, draft.origin)?.roster ?? []).map((n) => n.id) }
    const base: ReportDraft = { ...r, changes: [...r.changes, ...(picked ? [] : [...demoNetChanges(), ...demoBodyChanges()]), ...demoCraftChanges(), ...demoPartsChanges(), ...(demo?.auction ? demoAuctionChanges() : []), ...demoPeopleChanges(game.k, state, roster)] }
    if (start === 'normal' && !demo?.invite) return base
    // 契約的開局與邀請函要看得到主角：先把前面的變更套在一份複本上，再問示意包（契約怎麼建、名冊怎麼進、效果怎麼算都是引擎自己的函式）
    const sim = structuredClone(state)
    game.k.changes.applyAll(sim, base.changes)
    const extra: Change[] = [
      ...(start === 'holder' ? demoHolderChanges(game.k, sim) : start === 'bound' ? demoBoundChanges(game.k, sim) : []),
      ...(demo?.invite ? demoCurtainChanges(game.k, sim) : []),
    ]
    return { ...base, changes: [...base.changes, ...extra] }
  }
  /** 先問引擎每一步行不行；有問題原樣回傳、狀態不動；沒問題才提交。 */
  function createCharacter(draft: CreationDraft): CreationBlock[] {
    const blocks = creationBlocks(game.k, game.state, draft)
    if (blocks.length > 0) return blocks
    game.commit(buildCreationReport(game.k, game.state, draft))
    return []
  }

  const stepBlocksOf = (draft: CreationDraft, step: BodyStep): string[] => {
    const blocks = askStep(game.k, cstate(), draft, step).blocks
    const top = (step === 'cyber' ? cyberStepBlock : step === 'abilities' ? abilitiesStepBlock : gearStepBlock)(game.k, cstate(), draft)
    return top && !blocks.includes(top.reason) ? [...blocks, top.reason] : blocks
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
    /** 建角買得到什麼（第 6 步的橋與義體、第 9 步的裝備，分四組）：引擎的 creationCatalog（各功能回答、出身買不買得到的原因在每一列的 block） */
    catalog: (draft: CreationDraft) => creationCatalog(game.k, cstate(), draft),
    /** 出身的建議組合（引擎的 suggestedKit：照點數裁過）；出身沒寫是 has: false */
    suggested: (draft: CreationDraft) => suggestedKit(game.k, cstate(), draft),
    /** 外觀裡推出來的三樣（外露的義體、獸化、風格與穿著）：引擎的 creationLook */
    look: (draft: CreationDraft) => creationLook(game.k, cstate(), draft),
    /** 獸化的系（引擎的外觀文字表：預設加上資料蓋掉的） */
    beastLines: (): string[] => Object.keys(lookTexts(game.k).beast_lines),
    /** 出身給畫面顯示用的名字：勢力（id＋短名）、開場名冊（id＋名字） */
    originView: (id: string) => originView(game.k, id),
    /** 起始的錢（含沒花完的義體與裝備點數換的現金） */
    startMoney: (draft: Parameters<typeof startMoney>[2]) => startMoney(game.k, cstate(), draft),
    // ---- 第 5 步：生命軌跡（features/creation 的 lifepath；畫面只編排） ----
    lifepath: {
      /** 每張表看得到的條目（照出身換好說法、照內容篩選過濾；整張被濾掉的表不列） */
      tables: (draft: CreationDraft) => lifepathTables(game.k, cstate(), draft),
      /** 擲一張表（照這份存檔的種子；reroll 是第幾次重擲，0 是第一次）；沒有條目是 null */
      roll: (draft: CreationDraft, table: LifepathTable, reroll = 0): string | null => lifepathRoll(game.k, cstate(), draft, table, reroll),
      /** 每一條選的會變成什麼（一句一句） */
      results: (draft: CreationDraft) => lifepathResults(game.k, cstate(), draft),
      /** 可以自己挑的潛在性癖標籤 */
      kinks: () => kinkChoices(game.k, cstate()),
      /** 全部的問題（第一條也是擋住下一步的原因） */
      problems: (draft: CreationDraft): string[] => lifepathProblems(game.k, cstate(), draft),
      kinkMax: MAX_KINKS,
      tableName: (t: LifepathTable): string => TABLE_NAME[t],
    },
    // ---- 第 6、8、9 步：橋與義體、技能、錢與裝備（features/creation 的 creationSummary 與 askStep；點數、原因、白給的全是引擎的） ----
    /** 三種點數與換多少現金、沉溺的起點、四類容量、身上已經有的、每一步的提醒與擋住的原因 */
    summary: (draft: CreationDraft) => creationSummary(game.k, cstate(), draft),
    /** 第 6 步（橋與義體）的選項：設計圖的內容（名字、牌子、等級、說明）與要不要選左右 */
    blueprint: (id: string): (BlueprintEntry & { needsSide: boolean }) | null => {
      const bp = game.k.content.get<BlueprintEntry>('blueprint', id)
      return bp ? { ...bp, needsSide: bp.kind === 'cyberware' && cyberware.partIdOf(bp.slot) === null } : null
    },
    /** 部位的名字（義體；arm、leg 要給左右） */
    partName: (slot: string | undefined, side?: 'l' | 'r'): string => { const id = cyberware.partIdOf(slot, side); return id ? cyberware.PART_NAME[id] : '' },
    /** 物品的內容（名字、類別、等級、說明、價錢；顯示用） */
    entryOf: (kind: string, id: string): { id: string; name: string; desc?: string; category?: string; grade?: number; price?: number } | null => game.k.content.get(kind, id) as never ?? null,
    /**
     * 只選這一件的話：花幾點、沉溺的成本、各功能擋住的原因（沒有橋之類和別的選擇有關的原因也在裡面，畫面用 addBlock 看「加進去之後」多了什麼）。
     * 選項照 creation.step 掛點的格式：cyber { blueprint, side?, bridge? }、gear { id, qty? }。
     */
    lone: (draft: CreationDraft, step: 'cyber' | 'gear', pick: { blueprint?: string; side?: 'l' | 'r'; bridge?: boolean; id?: string; qty?: number }) => {
      const { bridge: _b, cyber: _c, gear: _g, abilities: _a, cyberSpent: _x, gearSpent: _y, ...rest } = draft
      const only: CreationDraft = step === 'cyber'
        ? { ...rest, ...(pick.bridge ? { bridge: pick.blueprint! } : { cyber: [{ blueprint: pick.blueprint!, ...(pick.side ? { side: pick.side } : {}) }] }) }
        : { ...rest, gear: [{ id: pick.id!, ...(pick.qty ? { qty: pick.qty } : {}) }] }
      const r = askStep(game.k, cstate(), only, step)
      return { points: r.points ?? 0, sink: r.sink, blocks: r.blocks }
    },
    /** 這一步現在的每一條問題（一條一個條件）；點數超過也算（引擎的那一句） */
    stepBlocks: (draft: CreationDraft, step: BodyStep): string[] => stepBlocksOf(draft, step),
    /** 從 before 改成 after 之後這一步多了什麼原因（這一次動作被擋下的那一句）；沒有是 null */
    addBlock: (before: CreationDraft, after: CreationDraft, step: BodyStep): string | null => {
      const was = new Set(stepBlocksOf(before, step))
      return stepBlocksOf(after, step).find((b) => !was.has(b)) ?? null
    },
    /** 選了「沒有橋」的後果：引擎在那一步的提醒（先讓玩家知道，再讓他確認） */
    noBridgeNotes: (draft: CreationDraft): string[] => creationSummary(game.k, cstate(), { ...draft, bridge: null }).notes.cyber,
    /** 沒有橋時第 8 步整頁的那一句（引擎的） */
    noBridgeAbility: NO_BRIDGE_ABILITY,
    /** 第 8 步學的技能的狀態：歷練點、學會的（引擎擋下的不在裡面）、每棵樹累計花的 */
    abilityState: (draft: CreationDraft): AbilityState => {
      const change = askStep(game.k, cstate(), draft, 'abilities').changes.find((c) => (c as { key?: string }).key === 'abilities') as { value?: AbilityState } | undefined
      return change?.value ?? { xp: cstate().rules.startXp, learned: [], equipped: [], spent: {} }
    },
    /** 一棵樹開到第幾階（引擎的 treeTierOf） */
    treeTier: (spent: number): number => treeTierOf(spent),
    /** 引擎的屬性調整值（（屬性 − 10）÷ 2 捨去）：畫面只顯示，不自己算 */
    attrMod: (v: number) => engineAttrMod(v),
    get attributes(): AttributeEntry[] { return game.k.content.list<AttributeEntry>('attribute') },
    get skills(): SkillEntry[] { return game.k.content.list<SkillEntry>('skill') },
    get origins(): OriginEntry[] { return game.k.content.list<OriginEntry>('origin') },
    get perks(): PerkEntry[] { return game.k.content.list<PerkEntry>('perk') },
  }

  async function run(f: () => Promise<{ status: ActStatus; reason?: string; notices?: string[] }>): Promise<ActOutcome> {
    // 上一條鏈還在跑：這一次不送進引擎，也不碰 busy（第一條鏈結束時才由它放開）
    if (busy.value) return { status: 'busy', reason: '上一條任務鏈還在跑。' }
    busy.value = true
    const timer = setInterval(refreshSteps, 120)
    try {
      const r = await f()
      return { status: r.status, ...(r.reason !== undefined ? { reason: r.reason } : {}), ...(r.notices && r.notices.length > 0 ? { notices: r.notices } : {}) }
    } finally {
      clearInterval(timer)
      busy.value = false
      refresh()
      scheduleDeliver()
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
  /** 戰鬥結束的結算；direction 是玩家寫的「想怎麼寫這一場」（原樣送出、不篩選；引擎截到 200 字、AI 關著時回提醒） */
  const finishBattle = (direction?: string) => run(() => game.finishBattle(direction ? { direction } : {}))
  /** 戰敗畫面的「想怎麼發生」：戰敗事件演的每一步（事件選項的正文）帶著它；接受結果之後清掉 */
  const defeatDirection = ref('')
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
    accept: (): string | null => {
      const why = commitMade(() => acceptDefeat(game.k, game.state))
      if (why === null) defeatDirection.value = ''
      return why
    },
    /** 玩家寫的寫法指令（戰敗事件的正文）；畫面直接綁它 */
    direction: defeatDirection,
    /** 別的功能多給的選項（被贖回……）：選了就結算 */
    choose: (id: string): string | null => commitMade(() => chooseDefeatOption(game.k, game.state, id)),
    /** 人在不在委託的副本裡（引擎的 commissionView）；不在是 null */
    commission: (): { id: string; name: string; stage: number; stages: number } | null => {
      void state.value
      const v = commissionView(game.k, game.state)
      return v ? { id: v.id, name: v.name, stage: v.stage, stages: v.stages } : null
    },
  }
  // ---- 成人場景（M2-ui-scene、M4-ui-scene）：全部轉接 Game.sceneBegin／sceneStep／sceneFinish 與 features/scene、nightclass，畫面不算感載、契合、主動權、預覽，也不判斷能不能做 ----
  /** 這一場結束之後的那一份報告（scene.end）：戰報卡用；按「回去」之後清掉 */
  const sceneEnded = shallowRef<Report | null>(null)
  /** 最近一步的提醒（寫法指令被截斷、AI 關著指令用不到） */
  const sceneNotices = ref<string[]>([])
  /** 場景的一步（sceneBegin、sceneStep、sceneFinish 共用）：走 run（上一條鏈還在跑就不送）、記下結束的那一份報告與提醒 */
  async function sceneRun(f: () => Promise<SceneResult>): Promise<ActOutcome & { ended: boolean }> {
    const before = game.state.reports.length
    let ended = false
    const r = await run(async () => {
      const x = await f()
      ended = x.ended
      return x
    })
    const fresh = game.state.reports.slice(before)
    const end = fresh.find((x) => x.action === 'scene.end')
    if (end) sceneEnded.value = structuredClone(end)
    sceneNotices.value = r.notices ?? []
    return { ...r, ended: ended || !!end }
  }
  const scene = {
    active: (): boolean => { void state.value; return sceneRawOf(game.state) !== null },
    /** 畫面要的全部；selected 給一個行動就多一份它的原因與預覽 */
    view: (selected?: SceneInput): SceneView | null => { void state.value; return sceneView(game.k, game.state, selected) },
    /** 行動一次列出來：花費、原因、要選的部位、技能與道具與體位各自的選項、預覽 */
    options: (target?: string | null): SceneOptions | null => { void state.value; return sceneOptions(game.k, game.state, target ? { target } : {}) },
    /** 這一場每一回合的那一句（照角色的 id：多人時哪一句是誰說的）；名字是狀態裡的 */
    lines: (): Array<{ round: number; who: string; name: string; text: string }> => {
      void state.value
      const raw = sceneRawOf(game.state)
      return raw ? raw.lines.map((l) => ({ round: l.round, who: l.who, name: l.who === raw.pc ? '你' : game.state.actors[l.who]?.name ?? l.who, text: l.text })) : []
    },
    /** 現在輪到誰（角色的 id）、主角是誰；沒有場景是 null。畫面判斷「輪到對方了嗎」只看它 */
    turn: (): { turn: string; pc: string } | null => { void state.value; const raw = sceneRawOf(game.state); return raw ? { turn: raw.turn, pc: raw.pc } : null },
    /** 開場的確認框用的摘要（引擎的 sceneGateSummary）：誰、性質、身分、目的、會碰到的標籤、是不是單人、在哪一層；沒有場景是 null */
    gate: (): StartSummary | null => { void state.value; return sceneGateSummary(game.k, game.state) },
    /** 現在能不能略過（引擎的 sceneCanSkip：還沒有任何行動才行）：能略過是 null，不能是引擎的原因。確認框看它決定要不要出來 */
    skipBlock: (): string | null => { void state.value; return sceneCanSkip(game.state) },
    /** 評價的名字（引擎的評價表；契合條旁邊與別的圈用） */
    rating: (fit: number): string => ratingOf(sceneRules(game.k), fit).name,
    /** 成人場景的 AI 走到哪裡（引擎的 sceneRoute）：pure 沒有 AI、text 只有整場的正文、closing 進場與收尾、full 每回合都問 */
    route: (): 'pure' | 'text' | 'closing' | 'full' => { void state.value; return game.sceneRoute() },
    /** 內容篩選關掉的題材（存檔規則的 contentOff） */
    contentOff: (): string[] => [...state.value.rules.contentOff],
    /** 設定的模式（精簡 simple、完整 full）；下一場生效 */
    mode: (): SceneMode => sceneModeNow,
    setMode(mode: SceneMode): void { sceneModeNow = mode; setSceneMode(game.k, mode) },
    modeOfEngine: (): SceneMode => sceneModeOf(game.k),
    ended: sceneEnded,
    notices: sceneNotices,
    /** 示範的場景開場的那一句（確認框的標題）；不是示範的場景是 null */
    demoOpening: (id: string): string | null => DEMO_SCENES.find((x) => x.id === id)?.opening ?? null,
    /** 戰報卡的欄位（評價、體悟、關係、餘韻、AI 的正文、每個對象各一列）；還沒有結束是 null */
    debrief: (): Debrief | null => {
      const r = sceneEnded.value
      return r ? debriefOf(r, (c) => game.k.changes.describe(state.value, c), (fit) => ratingOf(sceneRules(game.k), fit).name, (id) => state.value.actors[id]?.name ?? id) : null
    },
    clearEnded(): void { sceneEnded.value = null; sceneNotices.value = [] },
    /** 玩家的一步（Game.sceneStep；給 stop 就是結束） */
    act: (input: SceneInput) => sceneRun(() => game.sceneStep(input)),
    /** 對方的一步（輪到他的時候；Game.sceneStep 不給行動）。多人時一次走完一整輪 */
    next: () => sceneRun(() => game.sceneStep()),
    /** 結束：停下（預設）、略過（還沒有任何行動時才行；direction 是「想怎麼發生」，原樣送出、不篩選）、被外面打斷 */
    finish: (o: { how?: 'stop' | 'skip' | 'interrupt'; direction?: string } = {}) => sceneRun(() => game.sceneFinish(o)),
    /** 略過：不操作，引擎直接算出結果；寫法指令原樣交給引擎 */
    skip: (direction?: string) => sceneRun(() => game.sceneFinish({ how: 'skip', ...(direction !== undefined && direction !== '' ? { direction } : {}) })),
    /** 輪到對方的時候一步一步呼叫對方的一步，直到交回給玩家或場景結束；wait 是每一步之間等幾毫秒（給畫面看得清楚） */
    async partnerTurn(wait = 0): Promise<void> {
      for (let i = 0; i < 40; i++) {
        const raw = sceneRawOf(game.state)
        if (!raw || raw.turn === raw.pc) return
        if (wait > 0) await new Promise((res) => setTimeout(res, wait))
        const r = await scene.next()
        if (r.status !== 'applied') return
      }
    },
    /** 開一場（Game.sceneBegin；測試與示範用，平常是委託、戰敗事件、事件的效果開的）：引擎擋下回傳原因，開成回傳 null */
    async begin(setup: unknown, origin: { by: string; ref?: string } = { by: 'ui' }): Promise<string | null> {
      sceneEnded.value = null
      sceneNotices.value = []
      const r = await run(() => game.sceneBegin(setup as never, { origin: origin as never }))
      return r.status === 'applied' ? null : r.reason ?? '開不起來。'
    },
    /** 示範的場景（#/scene?scene=amber|rin）：先把對象與主角的招式放好，再開場。回傳引擎的原因或 null。 */
    async startDemo(id: string): Promise<string | null> {
      const d = DEMO_SCENES.find((x) => x.id === id) ?? DEMO_SCENES[0]!
      const pcId = game.state.pc
      if (pcId === null) return '還沒有主角：先去建角。'
      const pcActor = game.state.actors[pcId]!
      const changes = demoSceneChanges(d, { actor: !!game.state.actors[d.partner.id], pc: pcId, ext: pcActor.ext, items: game.state.inventory.map((x) => x.id), known: Object.keys(game.state.actors) })
      const why = commit({ summary: '準備示範的場景', action: 'ui.demo_scene', changes }, { attach: true })
      return why ?? scene.begin(d.setup, { by: 'ui', ref: d.id })
    },
    /** 在住處獨處（單人）：開一場單人的場景。引擎擋下（沒有橋、被內容篩選擋下……）回傳原因 */
    soloAtHome: (): Promise<string | null> => scene.begin({ solo: true, place: '住處' }, { by: 'ui', ref: 'solo_home' }),
  }
  /**
   * 事件帶出來的成人場景（俘虜「帶走」、戰敗事件的選項）：場景開起來時畫面會自己換到 #/scene；回到戰敗畫面時的兩個按鈕是進入場景與略過。
   * 略過走 Game.sceneFinish({ how: 'skip', direction })，結果那一份報告（scene.end）在 state.reports 最後。
   */
  const sceneGate = {
    active: (): boolean => { void state.value; return game.k.activity.active(game.state).some((a) => a.kind === 'scene') },
    skip: (direction?: string): Promise<ActOutcome & { ended: boolean }> => scene.skip(direction),
  }
  /** 有幾個面板把事件視窗嵌在自己裡面（戰敗、戰利品與俘虜）：大於 0 時全域的事件對話框讓出來 */
  const eventInline = ref(0)
  const hostEvent = (on: boolean): void => { eventInline.value = Math.max(0, eventInline.value + (on ? 1 : -1)) }
  /** 這個戰場的規則（遮蔽的名字、數值：照這一局的內容，不是預設值）；沒有在打是 null。 */
  function battleMode(): BattleMode | null {
    const b = state.value.battle
    return b ? modeOf(game.k.content, b.mode) ?? null : null
  }
  /** 這個戰場在哪一層（現實 meat、內海 net；引擎的戰場資料）；沒有在打是 null。畫面照它換頁與換皮，不看網址 */
  function battleLayer(): string | null { return battleMode()?.layer ?? null }
  /**
   * 內海戰鬥的畫面資料（features/netcombat 的 netBattleView：每個我方單位的檔位與每一檔的原因、破損的槽、管理行動的次數、追蹤度與門檻、定位的倒數、是不是在委託副本裡）。
   * 沒有在打、或打的不是內海是 null。
   */
  function netBattle(): NetBattleView | null {
    void state.value
    return state.value.battle ? netBattleView(game.k, state.value) : null
  }
  /** 戰鬥狀態的名字（引擎的規則表，核心自帶的失去回合與閃斷也查得到）；查不到是 undefined */
  const statusName = (id: string): string | undefined => statusRuleOf(game.k.content, id)?.name
  /** 一個技能這一次要花幾次管理行動（內海；引擎的技能資料 use.net.admin）；不花是 0。技能清單用它標出來 */
  function skillAdminCost(id: string): number {
    const ab = game.k.content.get<AbilityEntry>('ability', id)
    if (!ab) return 0
    const net = abilityUses(ab).find((u) => u.field === 'net' || u.field === null)
    return net?.use.admin ?? 0
  }
  /** 內容的名字（道具、狀態……；顯示用，查內容不是規則）；查不到是 undefined */
  const contentName = (kind: string, id: string): string | undefined => game.k.content.get<{ id: string; name?: string }>(kind, id)?.name


  // ---- 裝備與背包（EQUIPMENT；dev/work/M1b-ui-gear.md）：全部轉接 features/gear，畫面不自己判斷 ----
  /** 查內容（名字、等級、零件）；顯示用，不是規則 */
  const gearLook: GearLookup = {
    blueprint: (id) => game.k.content.get<BlueprintEntry>('blueprint', id),
    item: (id) => game.k.content.get<ItemEntry>('item', id),
    part: (id) => game.k.content.get<PartEntry>('part', id),
    stackPart: (st) => stackPart(game.k.content, st),
    quickBlock: (id) => quickBlock(game.k, id),
    // 外套扣上時被蓋住的穿著格：引擎的 coveredSlots（M4 收尾修正批；介面不再自己從 styleOf 推）
    covered: () => {
      void state.value
      const pc = game.state.pc
      if (pc === null || !game.state.actors[pc]) return []
      return [...coveredSlots(game.k, game.state, pc)]
    },
  }
  /** 引擎擋下的原因：ChangeError 的訊息前面有「changes[0]（gear.quick）：」，去掉它只留引擎寫的那一句 */
  const reasonOf = (e: unknown): string | null => {
    if (e instanceof ActionBlocked) return e.reason
    if (e instanceof ChangeError) return e.problems.map((p) => p.replace(/^changes\[\d+\]（[^）]*）：/, '')).join('')
    if (e instanceof Error) return e.message
    return null
  }
  const NO_PC = '還沒有主角。'
  /**
   * 問引擎時丟出例外的處理（不把引擎的原因換成介面自己的句子）：引擎擋下（ActionBlocked／ChangeError）時，答案是字串或字串陣列的就用引擎的那一句；
   * 其他例外是引擎的程式錯誤，記到 console 再回 fallback（不悄悄吞掉）。
   */
  function failedAs<T>(e: unknown, fallback: T): T {
    if (e instanceof ActionBlocked || e instanceof ChangeError) {
      const why = reasonOf(e)
      if (why) {
        if (typeof fallback === 'string') return why as T
        if (Array.isArray(fallback) && fallback.length > 0 && fallback.every((x) => typeof x === 'string')) return [why] as T
      }
      return fallback
    }
    console.error(e)
    return fallback
  }
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
    /** 別人看到的樣子：曝露度、風格（主要的標籤、是不是一致）、風格值、威脅感，與身上的重量和上限（全是引擎的 styleOf 與衍生數值）；沒有主角是 null */
    style: () => {
      void state.value
      const pc = game.state.pc
      if (pc === null || !game.state.actors[pc]) return null
      const info = styleOf(game.k, game.state, pc)
      const stat = (id: string): number => game.k.stats.stat(game.state, pc, id)
      return {
        exposure: stat('exposure'), styleValue: stat('style_value'), main: info.main, unified: info.unified, tags: info.tags, threat: info.threat,
        load: stat(LOAD_STAT), cap: stat(CAP_STAT), over: gearOverweight(game.k, game.state, pc),
        unifiedMin: gearRules(game.k).unified_min, unifiedBonus: gearRules(game.k).unified_bonus,
      }
    },
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

  // ---- 組裝、拆解、換零件、學設計圖、解剖、染色（CRAFTING 10；dev/work/M4-ui-craft.md）：全部轉接 features/craft、enemies 的解剖與 gear 的染色，畫面不自己判斷 ----
  /** 提交一份引擎做好的草稿並把報告的結果交回去：被擋下回傳 why；成功時 result 是報告的結果、lines 是報告給玩家的句子（畫面照寫，不自己拼） */
  interface Done { why: string | null; result: string; lines: string[] }
  function commitDone(make: () => ReportDraft): Done {
    let draft: ReportDraft
    try {
      draft = make()
    } catch (e) {
      const why = reasonOf(e)
      if (why === null) throw e
      return { why, result: '', lines: [] }
    }
    const why = commitMade(() => draft)
    return { why, result: why ? '' : draft.outcome?.result ?? '', lines: why ? [] : [...(draft.narration?.results ?? [])] }
  }
  /** 背包裡一疊零件的資料：內嵌的零件（未登錄）是那一整筆，內容的零件是 id */
  const refOfStack = (stack: ItemStack): unknown => (stack.data && typeof stack.data.part === 'object' && stack.data.part !== null ? stack.data.part : stack.id)
  const craft = {
    /** 會做的設計圖（照學會的順序） */
    known: () => { void state.value; return craftFx.knownBlueprints(game.k, game.state) },
    /** 這裡有誰可以做（自己動手一直列；站的設施帶 craft 的多一種）；每一種帶現在選它不行的原因 */
    /** 動手的人：主角在前，加上隊上的隊友（引擎的 by 收這幾個人） */
    crew: (): Array<{ id: string; name: string; me: boolean }> => {
      void state.value
      const s = game.state
      const ids = [...new Set([...(s.pc ? [s.pc] : []), ...s.party])]
      return ids.flatMap((id) => (s.actors[id] ? [{ id, name: s.actors[id]!.name, me: id === s.pc }] : []))
    },
    makers: (by?: string): craftFx.MakerOption[] => { void state.value; return craftFx.makers(game.k, game.state, by) },
    /** 站的設施帶 craft 的話：是哪一種、叫什麼（沒有是 null） */
    here: () => { void state.value; return craftFx.craftHere(game.k, game.state) },
    /** 組裝的預覽：每一個數字都是引擎的 */
    preview: (o: craftFx.PreviewOpts): craftFx.AssemblyPreview => { void state.value; return craftFx.assemblyPreview(game.k, game.state, o) },
    assemble: (o: craftFx.AssembleOpts): Done => commitDone(() => craftFx.assembleDraft(game.k, game.state, o)),
    /** 背包裡能拿來組的零件（有零件資料的那幾疊）：key 是指名用的 id 或 uid */
    parts: () => {
      void state.value
      return game.state.inventory.filter((s) => s.qty > 0).flatMap((stack) => {
        const part = stackPart(game.k.content, stack)
        return part ? [{ key: typeof stack.data?.uid === 'string' ? stack.data.uid : stack.id, stack, part }] : []
      })
    },
    /** 這個零件放進這張設計圖的這個槽行不行：原因（一條一句）與是不是超規（引擎的 slotProblems） */
    slotCheck: (bp: string, type: string, stack: ItemStack): { problems: string[]; overspec: boolean } => slotProblems(game.k.content, bp, type, refOfStack(stack)),
    /** 背包裡的成品（id 是設計圖、帶 uid 的那幾疊） */
    products: (): ItemStack[] => { void state.value; return game.state.inventory.filter((s) => s.qty > 0 && typeof s.data?.uid === 'string' && game.k.content.has('blueprint', s.id)) },
    /** 一件成品現在的樣子（零件、數值、品質、怪癖）與目錄價；查不到設計圖是 null */
    detail: (stack: ItemStack) => {
      void state.value
      const info = productOf(game.k.content, stack.id, stack.data)
      return info ? { info, price: productPrice(game.k.content, stack.id, stack.data) } : null
    },
    salvagePreview: (o: craftFx.SalvageOpts): craftFx.SalvagePreview => { void state.value; return craftFx.salvagePreview(game.k, game.state, o) },
    salvage: (o: craftFx.SalvageOpts): Done => commitDone(() => craftFx.salvageDraft(game.k, game.state, o)),
    swapPreview: (o: craftFx.SwapOpts): craftFx.SwapPreview => { void state.value; return craftFx.swapPreview(game.k, game.state, o) },
    swap: (o: craftFx.SwapOpts): Done => commitDone(() => craftFx.swapDraft(game.k, game.state, o)),
    /** 授權書：教哪一張設計圖、會不會了；不是授權書是 null */
    licence: (itemId: string): { teaches: string; name: string; known: boolean } | null => {
      void state.value
      const it = game.k.content.get<craftFx.LicenceItem>('item', itemId)
      if (!it || typeof it.teaches !== 'string') return null
      return { teaches: it.teaches, name: game.k.content.get<BlueprintEntry>('blueprint', it.teaches)?.name ?? it.teaches, known: craftFx.isKnown(game.state, it.teaches) }
    },
    learnBlock: (o: craftFx.LearnOpts): string | null => { void state.value; return craftFx.learnBlock(game.k, game.state, o) },
    learn: (o: craftFx.LearnOpts): Done => commitDone(() => craftFx.learnDraft(game.k, game.state, o)),
    /** 戰後可以解剖的對象（一小時內、一場一次）；沒有是空的 */
    dissectOptions: (by?: string): DissectOption[] => { void state.value; return dissectOptions(game.k, game.state, by) },
    dissect: (target: string, by?: string): Done => commitDone(() => dissectDraft(game.k, game.state, { target, ...(by ? { by } : {}) })),
  }
  const dye = {
    /** 這一件現在的顏色（染過的，或設計圖的預設；都沒有是空的） */
    colorsOf: (uid: string) => { void state.value; return gearDyeOf(game.k, game.state, uid) },
    /** 店家代染的價錢與時間、自己染的時間（引擎的規則表；只給說明文字用） */
    rules: () => { const r = gearRules(game.k); return { shopPrice: r.dye_shop_price, shopMinutes: r.dye_shop_minutes, selfMinutes: r.dye_self_minutes } },
    shopHere: (): boolean => { void state.value; return dyeShopHere(game.k, game.state) },
    block: (o: DyeOpts): string | null => { void state.value; return gearDyeBlock(game.k, game.state, o) },
    /** 這樣染要付多少現金、花幾分鐘、用掉哪些染料（照引擎的草稿讀；染不了是 block 的原因） */
    quote: (o: DyeOpts): { block: string | null; cash: number; minutes: number; uses: Array<{ item: string; qty: number }> } => {
      void state.value
      try {
        const changes = gearDyeDraft(game.k, game.state, o).changes as Array<Record<string, unknown>>
        return {
          block: null,
          cash: changes.filter((c) => c.op === 'cash').reduce((n, c) => n - Number(c.delta), 0),
          minutes: changes.filter((c) => c.op === 'time').reduce((n, c) => n + Number(c.minutes), 0),
          uses: changes.filter((c) => c.op === 'item').map((c) => ({ item: String(c.id), qty: -Number(c.qty) })),
        }
      } catch (e) {
        const why = reasonOf(e)
        if (why === null) throw e
        return { block: why, cash: 0, minutes: 0, uses: [] }
      }
    },
    apply: (o: DyeOpts): Done => commitDone(() => gearDyeDraft(game.k, game.state, o)),
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
    // ---- 基本功升級與洗點（CORE_RULES 7.2 節；features/abilities 的 train）：歷練點、花多少、能不能、原因都是引擎的 ----
    /** 這項基本功現在幾級（引擎的主角） */
    basicLevel: (skill: string): number => { void state.value; return game.state.pc ? game.state.actors[game.state.pc]?.skills[skill] ?? 0 : 0 },
    /** 升到下一級要花幾點歷練點（引擎的 skillUpCost） */
    basicCost: (skill: string): number => { void state.value; return skillUpCost(game.k, game.state.pc ? game.state.actors[game.state.pc]?.skills[skill] ?? 0 : 0) },
    /** 現在升不升得了：引擎的原因（5、6 級要有人教也是引擎那一句）；可以升是 null */
    basicBlock: (skill: string): string | null => {
      void state.value
      if (game.state.pc === null) return NO_PC
      return game.blockOf(`commit:${SKILL_UP_ACTION}`) ?? skillUpBlock(game.k, game.state, game.state.pc, skill)
    },
    /** 升一級（花歷練點、基本功 +1）；擋下就回傳原因 */
    basicUp: (skill: string): string | null => commitGear((pc) => skillUpDraft(game.k, game.state, pc, skill)),
    /** 洗點的報價（洗哪些、退多少歷練點、付多少錢、休養多久）；沒有主角是 null */
    respecQuote: (path?: string) => { void state.value; return game.state.pc === null ? null : respecQuote(game.k, game.state, game.state.pc, path !== undefined ? { path } : {}) },
    /** 現在洗不洗得了（要在調校診所）：引擎的原因；可以洗是 null */
    respecBlock: (path?: string): string | null => {
      void state.value
      if (game.state.pc === null) return NO_PC
      return game.blockOf(`commit:${RESPEC_ACTION}`) ?? respecBlock(game.k, game.state, game.state.pc, path !== undefined ? { path } : {})
    },
    respec: (path?: string): string | null => commitGear((pc) => respecDraft(game.k, game.state, pc, path !== undefined ? { path } : {})),
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
  const clearQueued = (): void => { queued.length = 0; clearMemos() }
  /**
   * 把一份（或幾份）報告草稿交給引擎提交（走 commitNarrated：AI 關著就是一般的提交）。草稿做不出來（被擋下）回傳原因。
   * remake(i)：第 i 份草稿（i ≥ 1）若要留著等放行，放行時用它照當下狀態重做；沒給就用原來那一份。
   */
  async function commitDrafts(make: () => ReportDraft | ReportDraft[], label?: string, remake?: (i: number) => ReportDraft, extra?: { direction?: string }): Promise<ActOutcome> {
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
      const r = await run(() => game.commitNarrated(d, { mode: 'new', ...(label ? { label } : {}), ...(extra?.direction ? { direction: extra.direction } : {}) }))
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

  // ---- 子網（M3-ui-subnet）：全部轉接 features/netrun 與核心的格子；畫面不自己判斷（巡邏、陷阱、追蹤度、能不能做都是引擎的） ----
  /** 這一層看過的標記（名字、位置、種類、處理過了沒有）與視野半徑：畫面用它畫節點的圖示與打勾；沒看過的格子不給 */
  interface NetMarker { id: string; name: string; mark: string; kind: string; at: [number, number]; used: boolean }
  interface NetSheet { sight: number; visible: Set<string>; markers: NetMarker[] }
  const net = {
    /** 現在這一趟的畫面資料（引擎的 netrunView）；沒有在網內是 null */
    view: (): NetrunView | null => { void state.value; return netrunView(game.k, game.state) },
    /** 這一層的格子（看過的、站的位置）：和街區圖同一份 gridView */
    grid: (): GridView | null => { void state.value; return game.gridView() },
    /** 這一層看過的標記與現在看得到的格子（視野半徑與看穿是引擎的） */
    sheet: (): NetSheet | null => {
      void state.value
      const h = gridHere(game.k, game.state)
      if (!h) return null
      const sight = sightOf(h.sheet.def)
      const seen = (x: number, y: number): boolean => h.sheetState.seen[y]?.[x] === '1'
      const markers = (h.sheet.def.cells ?? []).filter((m) => seen(m.at[0], m.at[1])).map((m): NetMarker => ({
        id: m.id, name: m.name, mark: m.mark, kind: NET_LEGEND[m.mark] ?? 'floor', at: [m.at[0], m.at[1]], used: h.sheetState.cells[`${m.at[0]},${m.at[1]}`]?.used === true,
      }))
      const visible = new Set<string>()
      for (const key of h.sheet.visibleFrom({ x: h.at.x, y: h.at.y }, sight)) visible.add(key)
      return { sight, visible, markers }
    },
    /** 隊員的化身：感載、餘韻與同步檔位上限（引擎的衍生數值與規則） */
    party: (): Array<{ id: string; name: string; load: [number, number]; afterglow: number; syncCap: string; me: boolean }> => {
      void state.value
      const rule = syncRuleOf(game.k.content)
      return game.state.party.flatMap((id) => {
        const a = game.state.actors[id]
        if (!a) return []
        const cap = rule.gears[syncCapOf(game.k, game.state, id)]
        return [{ id, name: a.name, load: [a.load, statOf(id, 'load_cap', Math.max(1, a.load))] as [number, number], afterglow: a.afterglow, syncCap: cap?.name ?? '', me: id === game.state.pc }]
      })
    },
    /** 走（一個方向或一個目的地，照最短路走，遇到事情就停）；被擋下回傳引擎的原因 */
    walk: (to: GridDir | [number, number]): { ok: boolean; reason?: string } => world.walk(to),
    /** 做一件事：id 是引擎列的（fight、sneak、rest、descend、pass、download、crack、wipe……），at 是站在旁邊的遭遇節點的 id */
    use: (id: string, at?: string): Promise<ActOutcome> => commitDrafts(() => netUseNode(game.k, game.state, id, at)),
    descend: (): Promise<ActOutcome> => commitDrafts(() => netDescend(game.k, game.state)),
    logout: (): Promise<ActOutcome> => commitDrafts(() => netLogout(game.k, game.state)),
    /** 開一趟（測試與示範用；平常是委託副本的內海面與自己潛進去的入口開的）：引擎擋下回傳原因，開成回傳 null */
    begin(setup: unknown, kind: 'netrun' | 'face.net' = 'netrun', origin: { by: string; ref?: string; ext?: Record<string, unknown> } = { by: 'ui' }): string | null {
      try {
        game.launch(kind, setup, origin)
        refresh()
        return null
      } catch (e) {
        const w = reasonOf(e)
        if (w === null) throw e
        return w
      }
    },
  }

  // ---- 潛入與登出（M3-ui-dive）：全部轉接 features/dive 與 features/maze；費用、能不能去、評價、押金都是引擎的 ----
  const dive = {
    options: (): DiveOptions => { void state.value; return diveOptions(game.k, game.state) },
    view: (): DiveView => { void state.value; return diveView(game.k, game.state) },
    /** 潛入（付費、租甲板、記下身體在哪）；被擋下回傳引擎的原因 */
    enter: (): Promise<ActOutcome> => commitDrafts(() => diveEnter(game.k, game.state), '潛入'),
    /** 選一個去處（自己去挖的子網、街區……） */
    go: (siteId: string): Promise<ActOutcome> => commitDrafts(() => diveGo(game.k, game.state, siteId), '前往'),
    /** 登出：回到身體的位置、收回租的甲板、退押金 */
    exit: (): Promise<ActOutcome> => commitDrafts(() => diveExit(game.k, game.state), '登出'),
    /** 留著的那座子網（自己去挖的，七天內再進去是同一張圖）上次離開的時間（總分鐘）與現在的差幾天；沒有留著的是 null */
    kept(site: string): { daysAgo: number; trace: number; located: boolean } | null {
      void state.value
      const inst = keptOf(game.state, site)
      const left = inst ? netExt(game.state, inst.id)?.left : undefined
      if (!left) return null
      return { daysAgo: Math.floor((toMinutes(game.state.time) - left.at) / 1440), trace: left.trace, located: left.located === true }
    },
    /** 上一趟離開的帳；看過就清掉 */
    lastEnd: (): EndRecord | null => lastEnd.value,
    clearEnd: (): void => { lastEnd.value = null },
  }
  // 迷宮館（報名、機關與寶箱、這一趟的回合數與預估的評價）
  const maze = {
    brackets: (): BracketRow[] => { void state.value; return mazeBrackets(game.k, game.state) },
    view: (): MazeView | null => { void state.value; return mazeView(game.k, game.state) },
    enter: (bracket: string, grade?: number): Promise<ActOutcome> => commitDrafts(() => mazeEnter(game.k, game.state, bracket, grade !== undefined ? { grade } : {}), '報名'),
    /** 開寶箱或解機關：id 是引擎列的（open、solve:<辦法>），at 是機關或寶箱的標記 */
    use: (id: string, at?: string): Promise<ActOutcome> => commitDrafts(() => useMaze(game.k, game.state, id, at), '迷宮館'),
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
      // 戰敗事件在演的時候，玩家在戰敗畫面寫的「想怎麼發生」跟著這一步的正文一起送（原樣；引擎截到 200 字、AI 關著時回提醒）
      const direction = defeatOf(game.state) && defeatDirection.value ? defeatDirection.value : undefined
      const r = await commitDrafts(() => chooseOption(game.k, game.state, id), undefined, undefined, direction ? { direction } : undefined)
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
    /** 剛做完的內海階段留下的帳（離開時拿到的東西）；這件委託與這個階段對得上才給 */
    netStage: (stage: number): { loot: Array<{ name: string; qty: number }>; controls: number; layers: number; rounds: number } | null => {
      void state.value
      const m = netStageMemo.value
      const cv = commissionView(game.k, game.state)
      return m && cv && m.commission === cv.id && m.stage === stage ? m : null
    },
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
    /** 稱呼（NPC_SYSTEM 7.0）：你怎麼叫他、他怎麼叫你；沒填的是空字串。字數上限、能不能改與原因是引擎的 */
    callNames: (id: string): { call_them: string; call_me: string } => { void state.value; const c = callNamesOf(game.state, id); return { call_them: c.call_them ?? '', call_me: c.call_me ?? '' } },
    callMax: CALL_MAX,
    callNamesBlock: (id: string, names: { call_them: string; call_me: string }): string | null => { void state.value; return callNamesBlock(game.state, id, names) },
    /** 改稱呼：玩家寫的字原樣送出（空字串是清掉） */
    setCallNames: (id: string, names: { call_them: string; call_me: string }) => commitDrafts(() => callNamesDraft(game.k, game.state, id, names), '改稱呼'),
    /** 送禮附的一句話字數上限（引擎的 GIFT_NOTE_MAX） */
    giftNoteMax: GIFT_NOTE_MAX,
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
      return [{ id, name: a.name, role: main ? peopleLook.path(main.path) : '', sink: a.sink, hp: [a.hp, statOf(id, 'max_hp', Math.max(1, a.hp))], load: [a.load, statOf(id, 'load_cap', Math.max(1, a.load))], afterglow: a.afterglow, ...(game.k.stats.hasStat('afterglow_cap') ? { afterglowCap: game.k.stats.stat(game.state, id, 'afterglow_cap') } : {}), me: id === s.pc, ...(body.painBlind(id) ? { hpBlur: true } : {}) }]
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


  // ---- 內海分頁：甲板、構裝槽、SKIN、腳本（features/deck；M3-ui-deck）。這裡只轉接，能不能裝、為什麼、數字都是引擎的答案 ----
  const deckStat = (id: string): number => { const pc = game.state.pc; return pc !== null && game.k.stats.hasStat(id) ? game.k.stats.stat(game.state, pc, id) : 0 }
  const deck = {
    /** 現在的主角（沒有是 null） */
    get actor(): string | null { void state.value; return game.state.pc },
    /** 整頁唯讀的原因（戰鬥中、網內的行程進行中……；引擎的那一句）；可以動是 null */
    lock: (): string | null => { void state.value; return game.blockOf('commit:deck.install') },
    view: (): DeckView | null => { void state.value; return game.state.pc === null ? null : deckView(game.k, game.state, game.state.pc) },
    /** 構裝的內容（畫面寫它的種類與數字；查不到是 undefined） */
    construct: (id: string): ConstructEntry | undefined => game.k.content.get<ConstructEntry>('construct', id),
    /** 網內的數字（引擎的衍生數值）；沒有主角全是 0 */
    numbers: () => {
      void state.value
      const pc = game.state.pc
      const info = pc === null ? null : deckOf(game.k, game.state, pc)
      return {
        ramMax: deckStat('ram_max'), ramRegen: deckStat('ram_regen'), guard: deckStat('net_guard'), firewall: deckStat('deck_firewall'), slots: deckStat('deck_slots'), reserved: deckStat('deck_slots_reserved'),
        loadCap: deckStat('load_cap'), layers: deckStat('afterglow_cap'), grade: deckStat('deck_grade'), hasDeck: info?.has ?? false,
      }
    },
    /** 同步四檔：名字、開得到不到（上限那一檔以下可以）、開不了的原因（引擎每個沒夠的條件一句） */
    sync: (): { cap: string; gears: Array<{ id: string; name: string; ok: boolean; why: string[] }> } | null => {
      void state.value
      const pc = game.state.pc
      if (pc === null) return null
      const rule = syncRuleOf(game.k.content)
      return { cap: syncCapOf(game.k, game.state, pc), gears: SYNC_GEARS.map((g) => { const why = syncBlocks(game.k, game.state, pc, g); return { id: g, name: `${rule.gears[g].name}檔`, ok: why.length === 0, why } }) }
    },
    /** 帶著的腳本（原樣，改的時候整份換） */
    scriptList: (): ScriptEntry[] => { void state.value; return game.state.pc === null ? [] : deckExtOf(game.state, game.state.pc).scripts.map((s) => ({ ...s })) },
    install: (item: string): string | null => commitGear((pc) => deckInstallDraft(game.k, game.state, pc, item)),
    remove: (item: string): string | null => commitGear((pc) => deckRemoveDraft(game.k, game.state, pc, item)),
    equip: (uid: string | null): string | null => commitGear((pc) => deckEquipDraft(game.k, game.state, pc, uid)),
    skin: (item: string | null): string | null => commitGear((pc) => deckSkinDraft(game.k, game.state, pc, item)),
    /** 這一份腳本清單帶不帶得了（引擎的原因；可以是 null） */
    scriptsBlock: (list: ScriptEntry[]): string | null => { void state.value; return game.state.pc === null ? '還沒有主角。' : deckScriptsBlock(game.k, game.state, game.state.pc, list) },
    scripts: (list: ScriptEntry[]): string | null => commitGear((pc) => deckScriptsDraft(game.k, game.state, pc, list)),
    /** 化身（M4-scene-net）：內海的場景裡的樣子。部位只有加裝、尾、觸手，最多存 AVATAR_SAVES_MAX 套；數字與擋住的原因是引擎的 */
    avatar: {
      get: (): Avatar | null => { void state.value; return game.state.pc === null ? null : avatarOf(game.state, game.state.pc) },
      /** 可以開的部位的 id、五個性別值、最多存幾套（引擎的常數；名字是畫面的） */
      parts: AVATAR_PARTS as readonly string[],
      genders: AVATAR_GENDERS as readonly string[],
      /** 外觀描述的字數上限（引擎的 AVATAR_TEXT_MAX） */
      textMax: AVATAR_TEXT_MAX,
      savesMax: AVATAR_SAVES_MAX,
      /** 這樣改現在行不行：不行是引擎的原因，行是 null */
      block: (o: AvatarOpts): string | null => { void state.value; return game.state.pc === null ? '還沒有主角。' : avatarBlock(game.k, game.state, game.state.pc, o) },
      set: (o: AvatarOpts): string | null => commitGear((pc) => avatarDraft(game.k, game.state, pc, o)),
    },
  }

  // ---- 夜課的學習（M4-ui-scene）：全部轉接 features/nightclass 與 scene；開階、看得到哪些、學得了學不了與原因都是引擎的 ----
  const night = {
    /** 五個分支各自開到幾階、看得到的技能（狀態：學會了、能學、階沒開、條件不夠）、現在的體悟；沒有主角是 null */
    list: (): NightListView | null => { void state.value; return game.state.pc === null ? null : nightList(game.k, game.state, game.state.pc) },
    /** 共鳴的清單（night_resonance）：每一筆它的分支與階、有沒有生效、一句說明；照內容的順序。生不生效是引擎的 resonanceOf（不在場景裡，照雙人算） */
    resonances: (): Array<{ id: string; name: string; branch: string; tier: number; desc: string; on: boolean }> => {
      void state.value
      if (!game.k.content.hasKind(RESONANCE_KIND)) return []
      const on = game.state.pc === null ? [] : resonanceOf(game.k, game.state, game.state.pc, false).ids
      return game.k.content.list<{ id: string; name?: string; branch?: string; tier?: number; desc?: string }>(RESONANCE_KIND).map((r) => ({
        id: r.id, name: r.name ?? r.id, branch: r.branch ?? '', tier: r.tier ?? 0, desc: r.desc ?? '', on: on.includes(r.id),
      }))
    },
    /** 技能的內容（說明、掛的標籤的名字）；顯示用 */
    skill: (id: string): { desc: string; how: string; tagName: string | null } => {
      const e = game.k.content.get<{ id: string; desc?: string; how?: string; tag?: string }>(NIGHT_SKILL_KIND, id)
      return { desc: e?.desc ?? '', how: e?.how ?? '', tagName: e?.tag ? (game.k.content.get<{ id: string; name?: string }>('tendency_tag', e.tag)?.name ?? e.tag) : null }
    },
    /** 現在學不學得了：學得了是 null，否則是引擎的第一個原因（戰鬥中、場景進行中也擋） */
    learnBlock: (id: string): string | null => { void state.value; return game.state.pc === null ? '還沒有主角。' : nightLearnBlock(game.k, game.state, game.state.pc, id) },
    learn: (id: string): string | null => commitGear((pc) => nightLearnDraft(game.k, game.state, pc, id)),
  }

  // ---- 角色的成人分頁（UI 8.2 節）：傾向、性經歷、豔名都讀引擎（lewd 的 tendencyOf、scene 的 sexRecordOf、量表 fame）；只讀 ----
  const adult = {
    /** 傾向：四條軸（等級）與每條軸上「有」或「深」的標籤（潛在的、被內容篩選關掉的不列）；沒有主角是空的 */
    tendency: (): Array<{ axis: string; name: string; level: number; tags: Array<{ id: string; name: string; deep: boolean }> }> => {
      void state.value
      const pc = game.state.pc
      if (pc === null || !game.state.actors[pc]) return []
      const t = tendencyOf(game.state, pc)
      const entries = game.k.content.hasKind(TAG_KIND) ? game.k.content.list<TagEntry>(TAG_KIND) : []
      return AXES.map((axis) => ({
        axis, name: AXIS_NAME[axis], level: t.axes[axis],
        tags: entries.filter((e) => e.axis === axis && (t.tags[e.id] === 'has' || t.tags[e.id] === 'deep') && contentAllowed(game.state.rules, e.id)).map((e) => ({ id: e.id, name: e.name, deep: t.tags[e.id] === 'deep' })),
      }))
    },
    /** 性經歷：次數、對象的人數、第一次、最喜歡的人（名字）；引擎的 sexRecordOf */
    sex: (): { times: number; partners: number; services: number; first: { who: string; note: string } | null; favorite: string | null } => {
      void state.value
      const pc = game.state.pc
      const r = sexRecordOf(pc === null ? undefined : game.state.actors[pc])
      const nm = (id: string): string => game.state.actors[id]?.name ?? id
      return { times: r.times, partners: r.partners, services: r.service_times, first: r.first ? { who: nm(r.first.with), note: r.first.note } : null, favorite: r.favorite ? nm(r.favorite) : null }
    },
    /** 豔名：每一區各一格（引擎的量表 fame，照區）；在哪一區是引擎的世界視圖 */
    fame: (): Array<{ id: string; name: string; value: number; here: boolean }> => {
      void state.value
      if (!game.k.meters.has('fame')) return []
      const here = worldView(game.k, game.state).district?.id ?? null
      return cityGraph(game.k).districts.map((d) => ({ id: d.id, name: d.name, value: meterOf(game.k, game.state, 'fame', d.id), here: d.id === here }))
    },
  }

  // ---- 義體、醫療、藥、沉溺（M4-ui-body）：全部轉接 features/cyberware、medical、drugs、sink、lewd，畫面不算費用、成本、機率與原因 ----
  // 每個入口都是「報價（quote）、擋住的原因（block）、送出（動作）」三件：報價與原因問引擎，送出就是提交引擎做好的報告草稿。
  const NO_BODY = '還沒有主角。'
  /** 有主角時用主角 id 問；沒有主角給預設值。每次都讀引擎現在的狀態 */
  function onPc<T>(f: (pc: string) => T, none: T): T {
    void state.value
    const pc = game.state.pc
    if (pc === null || !game.state.actors[pc]) return none
    try {
      return f(pc)
    } catch (e) {
      return failedAs(e, none)
    }
  }
  /** 提交一份引擎做好的草稿（有主角才做）；被擋下回傳引擎的原因 */
  function doOnPc(make: (pc: string) => ReportDraft): string | null {
    const pc = game.state.pc
    if (pc === null || !game.state.actors[pc]) return NO_BODY
    return commitMade(() => make(pc))
  }
  const bagKindOf = (stackId: string): { kind: BodyBagKind; slot: string | null; name: string; grade: number } | null => {
    const bp = game.k.content.get<{ id: string; kind?: string; slot?: string; name: string; grade: number; deck?: unknown }>('blueprint', stackId)
    if (bp && bp.kind === 'cyberware') return { kind: bp.slot === 'bridge' ? 'bridge' : bp.deck ? 'deck' : 'cyber', slot: bp.slot ?? null, name: bp.name, grade: bp.grade }
    const dk = game.k.content.hasKind('deck') ? game.k.content.get<{ id: string; name: string; grade: number }>('deck', stackId) : undefined
    return dk ? { kind: 'deck', slot: 'brain', name: dk.name, grade: dk.grade } : null
  }
  const body = {
    /** 主角的 id（沒有是 null） */
    get actor(): string | null { void state.value; return game.state.pc },
    /** 身上的義體：每個部位的每一槽（引擎的 cyberView） */
    cyber: (): cyberware.CyberView | null => onPc((pc) => cyberware.cyberView(game.k, game.state, pc), null),
    /** 背包裡能裝的義體（成品與甲板，帶 uid 的） */
    bag: (): BodyBag[] => {
      void state.value
      return game.state.inventory.flatMap((s) => {
        const uid = typeof s.data?.uid === 'string' ? s.data.uid : null
        const info = uid ? bagKindOf(s.id) : null
        return uid && info ? [{ uid, id: s.id, name: info.name, grade: info.grade, kind: info.kind, slot: info.slot }] : []
      })
    },
    /** 背包裡能拿來換的零件（某一類）：key 是交給引擎的名字（有 uid 的給 uid，其餘給零件的 id） */
    partsBag: (type: string): Array<{ key: string; name: string; grade: number; material: string; state: string; qty: number }> => {
      void state.value
      return game.state.inventory.flatMap((s) => {
        const p = stackPart(game.k.content, s)
        if (!p || p.type !== type) return []
        return [{ key: typeof s.data?.uid === 'string' ? s.data.uid : s.id, name: p.name, grade: p.grade, material: p.material, state: p.state, qty: s.qty }]
      })
    },
    /** 設計圖要哪幾類零件（換零件選槽用）：類型與數量 */
    slotsOf: (bp: string): Array<{ type: string; count: number }> => {
      void state.value
      const b = game.k.content.get<{ id: string; require?: Array<{ type: string; count?: number }>; optional?: Array<{ type: string; count?: number }> }>('blueprint', bp)
      return b ? [...(b.require ?? []), ...(b.optional ?? [])].map((n) => ({ type: n.type, count: n.count ?? 1 })) : []
    },
    /** 零件類型的名字（引擎的 partTypeName） */
    typeName: (type: string): string => partTypeName(type),
    /** 屬性與基本功的名字（引擎的內容） */
    names: {
      attr: (id: string): string => game.k.stats.attrName(id as never),
      skill: (id: string): string => game.k.stats.skillName(id),
    },
    /** 身上一件義體的組成：設計圖的資料、每個零件（甲板沒有零件）；找不到是 null */
    compose: (uid: string): { brand: string[]; legal: string; invasiveness: string; allBio: boolean; seams: number; parts: Array<{ type: string; typeName: string; name: string; grade: number; material: string; state: string }> } | null => onPc((pc) => {
      const piece = cyberware.cyberOf(game.state, pc).find((p) => p.uid === uid)
      if (!piece || piece.kind_of === 'deck') return null
      const info = productOf(game.k.content, piece.bp, piece)
      if (!info) return null
      return {
        brand: info.brands, legal: info.legal, invasiveness: info.bp.invasiveness ?? 'light', allBio: info.allBio, seams: info.seams,
        parts: info.parts.map(({ type, part }) => ({ type, typeName: partTypeName(type), name: part.name, grade: part.grade, material: part.material, state: part.state })),
      }
    }, null),
    /** 沒有橋的說明（引擎的 NO_BRIDGE_NOTE：沒感載、沒技能、不能潛入、不能再選接在橋上的義體） */
    noBridgeNote: NO_BRIDGE_NOTE,
    /** 現在站的診所（沒有是 null） */
    clinic: (): { type: string; name: string; grade: 'clinic' | 'unlicensed' | 'black' } | null => { void state.value; return cyberware.clinicHere(game.k, game.state) },
    /** 這個人現在可以請誰動刀（引擎的 surgeons；站在診所是那一種診所，加上條件夠的話自己動刀） */
    surgeons: (): cyberware.SurgeonOption[] => onPc((pc) => cyberware.surgeons(game.k, game.state, pc), []),
    /**
     * 診所對話框開不開得了：站在診所上，或在住處而且自己動得了刀（引擎的 surgeons 有一項能選）；開得了是 null，開不了是一句話。
     * 能不能自己動刀的原因是引擎的（surgeons 的 block）。
     */
    clinicGate: (): string | null => {
      void state.value
      if (game.state.pc === null) return NO_BODY
      const list = cyberware.surgeons(game.k, game.state, game.state.pc)
      if (list.some((o) => o.block === null)) return null
      return list.find((o) => o.id === 'self')?.block ?? '這裡沒有診所。'
    },
    installQuote: (o: Omit<cyberware.InstallOpts, 'actor'>): cyberware.InstallQuote | null => onPc((pc) => cyberware.installQuote(game.k, game.state, { ...o, actor: pc }), null),
    installBlock: (o: Omit<cyberware.InstallOpts, 'actor'>): string | null => onPc((pc) => cyberware.installBlock(game.k, game.state, { ...o, actor: pc }), NO_BODY),
    install: (o: Omit<cyberware.InstallOpts, 'actor'>): string | null => doOnPc((pc) => cyberware.installDraft(game.k, game.state, { ...o, actor: pc })),
    removeQuote: (o: Omit<cyberware.RemoveOpts, 'actor'>): cyberware.RemoveQuote | null => onPc((pc) => cyberware.removeQuote(game.k, game.state, { ...o, actor: pc }), null),
    removeBlock: (o: Omit<cyberware.RemoveOpts, 'actor'>): string | null => onPc((pc) => cyberware.removeBlock(game.k, game.state, { ...o, actor: pc }), NO_BODY),
    remove: (o: Omit<cyberware.RemoveOpts, 'actor'>): string | null => doOnPc((pc) => cyberware.removeDraft(game.k, game.state, { ...o, actor: pc })),
    bridgeQuote: (o: Omit<cyberware.BridgeOpts, 'actor'>): cyberware.BridgeQuote | null => onPc((pc) => cyberware.bridgeQuote(game.k, game.state, { ...o, actor: pc }), null),
    bridgeBlock: (o: Omit<cyberware.BridgeOpts, 'actor'>): string | null => onPc((pc) => cyberware.swapBridgeBlock(game.k, game.state, { ...o, actor: pc }), NO_BODY),
    swapBridge: (o: Omit<cyberware.BridgeOpts, 'actor'>): string | null => doOnPc((pc) => cyberware.swapBridgeDraft(game.k, game.state, { ...o, actor: pc })),
    /** 橋的四類容量與組成（引擎的衍生數值 bridge_cap_*；沒有橋是全 0） */
    capacity: (): cyberware.BridgeCapacity | null => onPc((pc) => cyberware.bridgeCapacityOf(game.k, game.state, pc), null),
    /** 身上那一座橋的詳細（型號、等級、機能的效果、狀態）；沒有橋是 null */
    bridge: (): cyberware.ViewPiece | null => onPc((pc) => {
      const piece = cyberware.bridgeOf(game.state, pc)
      return piece ? cyberware.viewPiece(game.k, game.state, pc, piece.uid) ?? null : null
    }, null),
    /** 四項橋參數：基本值、有效值（引擎的衍生數值 bridge_*）與每個來源；沒有橋是 null */
    bridgeParams: (): Array<{ id: string; name: string; base: number; value: number; band: number; parts: RollPart[] }> | null => onPc((pc) => {
      const v = lewdBridgeOf(game.k, game.state, pc)
      if (!v) return null
      return BRIDGE_PARAMS.map((p) => {
        const sid = paramStatId(p)
        return { id: p, name: PARAM_NAME[p], base: v[p].base, value: v[p].value, band: v[p].band, parts: game.k.stats.hasStat(sid) ? game.k.stats.statParts(game.state, pc, sid).filter((x) => x.source !== 'base') : [] }
      })
    }, null),
    /** 授權鎖：身上有鎖的每一件 */
    locks: (): cyberware.LockViewItem[] => onPc((pc) => cyberware.lockView(game.k, game.state, pc), []),
    payBlock: (uid: string, pay?: 'cred' | 'cash'): string | null => onPc((pc) => cyberware.payLockBlock(game.k, game.state, { actor: pc, uid, ...(pay ? { pay } : {}) }), NO_BODY),
    pay: (uid: string, pay?: 'cred' | 'cash'): string | null => doOnPc((pc) => cyberware.payLockDraft(game.k, game.state, { actor: pc, uid, ...(pay ? { pay } : {}) })),
    crackQuote: (uid: string): cyberware.CrackQuote | null => onPc((pc) => cyberware.crackQuote(game.k, game.state, { actor: pc, uid }), null),
    crackBlock: (uid: string): string | null => onPc((pc) => cyberware.crackBlock(game.k, game.state, { actor: pc, uid }), NO_BODY),
    crack: (uid: string): string | null => doOnPc((pc) => cyberware.crackDraft(game.k, game.state, { actor: pc, uid })),
    repairQuote: (o: Omit<cyberware.RepairOpts, 'actor'>): cyberware.RepairQuote | null => onPc((pc) => cyberware.repairQuote(game.k, game.state, { ...o, actor: pc }), null),
    repairBlock: (o: Omit<cyberware.RepairOpts, 'actor'>): string | null => onPc((pc) => cyberware.repairBlock(game.k, game.state, { ...o, actor: pc }), NO_BODY),
    repair: (o: Omit<cyberware.RepairOpts, 'actor'>): string | null => doOnPc((pc) => cyberware.repairDraft(game.k, game.state, { ...o, actor: pc })),
    modifyQuote: (o: Omit<cyberware.ModifyOpts, 'actor'>): cyberware.ModifyQuote | null => onPc((pc) => cyberware.modifyQuote(game.k, game.state, { ...o, actor: pc }), null),
    modifyBlock: (o: Omit<cyberware.ModifyOpts, 'actor'>): string | null => onPc((pc) => cyberware.modifyBlock(game.k, game.state, { ...o, actor: pc }), NO_BODY),
    modify: (o: Omit<cyberware.ModifyOpts, 'actor'>): string | null => doOnPc((pc) => cyberware.modifyDraft(game.k, game.state, { ...o, actor: pc })),
    /** 這個部位要不要選左右（引擎的 partIdOf：部位 id 不是單一部位就要選）：建角用的 blueprint().needsSide 同一個判斷 */
    needsSide: (slot: string | null): boolean => slot !== null && cyberware.partIdOf(slot) === null,
    /** 身上現在生效的被動效果（來源是義體、怪癖、藥、沉溺、戒斷、傷勢……）：引擎的 k.passives */
    passives: (): BodyPassive[] => onPc((pc) => game.k.passives.of(game.state, pc).map((e) => ({ ...e })), []),
    /** 生命值要不要模糊顯示：引擎的衍生數值 hp_blur（痛覺編輯器生效中是 1；cyberView.hp_blur 的同一個答案），介面不認標籤名 */
    painBlind: (id?: string): boolean => {
      void state.value
      const who = id ?? game.state.pc
      if (who === null || who === undefined || !game.state.actors[who] || !game.k.stats.hasStat(cyberware.HP_BLUR_STAT)) return false
      return game.k.stats.stat(game.state, who, cyberware.HP_BLUR_STAT) > 0
    },
    // ---- 醫療 ----
    medical: (by?: string): medical.MedicalView | null => { void state.value; return game.state.pc === null ? null : medical.medicalView(game.k, game.state, by ? { by } : {}) },
    aid: (by: string, target: string): string | null => commitMade(() => medical.aidDraft(game.k, game.state, { by, target })),
    heal: (target: string, pay?: 'cred' | 'cash'): string | null => commitMade(() => medical.clinicHealDraft(game.k, game.state, { target, ...(pay ? { pay } : {}) })),
    woundSurgery: (o: medical.WoundSurgeryOpts): string | null => commitMade(() => medical.woundSurgeryDraft(game.k, game.state, o)),
    // ---- 藥 ----
    drugs: (): drugs.DrugView | null => onPc((pc) => drugs.drugView(game.k, game.state, pc), null),
    useDrug: (item: string): string | null => doOnPc((pc) => drugs.useDraft(game.k, game.state, { actor: pc, item })),
    detox: (drug: string, pay?: 'cred' | 'cash'): string | null => doOnPc((pc) => drugs.detoxDraft(game.k, game.state, { actor: pc, drug, ...(pay ? { pay } : {}) })),
    suppressantBlock: (weekly: boolean): string | null => onPc(() => drugs.suppressantBlock(game.k, game.state, { weekly }), NO_BODY),
    suppressant: (weekly: boolean): string | null => doOnPc(() => drugs.suppressantDraft(game.k, game.state, { weekly })),
    // ---- 沉溺 ----
    sink: (): sink.SinkView | null => onPc((pc) => sink.sinkView(game.k, game.state, pc), null),
    therapyHere: (): sink.TherapyFacility | null => { void state.value; return sink.therapyHere(game.k, game.state) },
    therapyQuote: (o: sink.TherapyOpts = {}): sink.TherapyQuote | null => { void state.value; try { return sink.therapyQuote(game.k, game.state, o) } catch { return null } },
    therapyBlock: (o: sink.TherapyOpts = {}): string | null => ask(() => sink.therapyBlock(game.k, game.state, o), '現在不能做治療。'),
    /** 進傳教所只是開始（引擎的活動 retreat）；之後在 RetreatPanel 待下去或提早離開 */
    therapy: (o: sink.TherapyOpts = {}): string | null => commitMade(() => sink.therapyDraft(game.k, game.state, o)),
    /** 進行中的斷線靜修（哪一間、還剩幾天、結束時最多降多少、進去時的沉溺）；沒有是 null */
    retreat: (): sink.RetreatView | null => { void state.value; return sink.retreatView(game.state) },
    stayBlock: (): string | null => ask(() => sink.retreatStayBlock(game.k, game.state), '現在待不下去。'),
    stay: (): string | null => commitMade(() => sink.retreatStayDraft(game.k, game.state)),
    leaveBlock: (): string | null => ask(() => sink.retreatLeaveBlock(game.k, game.state), '現在離不開。'),
    leave: (): string | null => commitMade(() => sink.retreatLeaveDraft(game.k, game.state)),
    /** 被動效果來源的名字（引擎的 PASSIVE_SOURCE_NAMES） */
    sourceName: (source: string): string => (PASSIVE_SOURCE_NAMES as Record<string, string>)[source] ?? source,
  }

  // ---- 契約、惡意韌體、調校、蠱惑、請教（M4-ui-contract）：全部轉接引擎的匯出，畫面不算 DC、成功率、價錢、能不能做 ----
  /** 問引擎「現在做不做得了」：引擎擋下就用它的原因（字串答案），其他例外記 console 後回 fallback */
  const ask = <T>(f: () => T, fallback: T): T => { void state.value; try { return f() } catch (e) { return failedAs(e, fallback) } }
  const contract = {
    /** 主角是契約人時的面板（引擎的 boundView；沒有契約是 null） */
    bound: (): contractFx.BoundView | null => ask(() => contractFx.boundView(game.k, game.state), null),
    /** 主角持有的人（引擎的 heldPeople） */
    held: (): Array<{ id: string; home: contractFx.ContractHome }> => ask(() => contractFx.heldPeople(game.state), []),
    /** 持約人那一面的契約頁（引擎的 holderContractView） */
    holder: (npc: string): contractFx.HolderContractView | null => ask(() => contractFx.holderContractView(game.k, game.state, npc), null),
    /** 持約人那一面的事件頁：五種事各自能不能做、原因（引擎的 holderEvents） */
    events: (npc: string): contractFx.HolderEvent[] => ask(() => contractFx.holderEvents(game.k, game.state, npc), []),
    /** 他的名字（角色的名字） */
    nameOf: (id: string): string => { void state.value; return game.state.actors[id]?.name ?? id },
    /** 身上被裝了什麼（引擎的 cyberView；可以問任何一個角色） */
    cyberOf: (id: string): cyberware.CyberView | null => ask(() => cyberware.cyberView(game.k, game.state, id), null),
    choose: (order: string, how: 'comply' | 'resist'): string | null => commitMade(() => contractFx.chooseDraft(game.k, game.state, { order, how })),
    chooseBlock: (order: string, how: 'comply' | 'resist'): string | null => ask(() => contractFx.chooseBlock(game.k, game.state, { order, how }), null),
    arriveBlock: (order: string): string | null => ask(() => contractFx.arriveBlock(game.k, game.state, { order }), '現在去不了。'),
    arrive: (order: string): string | null => commitMade(() => contractFx.arriveDraft(game.k, game.state, { order })),
    completeBlock: (order: string): string | null => ask(() => contractFx.completeBlock(game.k, game.state, { order }), '現在做不了。'),
    complete: (order: string): string | null => commitMade(() => contractFx.completeDraft(game.k, game.state, { order })),
    askBlock: (kind: contractFx.OrderKind): string | null => ask(() => contractFx.askOrderBlock(game.k, game.state, { kind }), '現在要不了。'),
    askOrder: (kind: contractFx.OrderKind): string | null => commitMade(() => contractFx.askOrderDraft(game.k, game.state, { kind })),
    payoffQuote: (): contractFx.PayoffQuote | null => ask(() => contractFx.payoffQuote(game.k, game.state), null),
    payoffBlock: (o: contractFx.PayoffOpts = {}): string | null => ask(() => contractFx.payoffBlock(game.k, game.state, o), '現在還不了。'),
    payoff: (o: contractFx.PayoffOpts = {}): string | null => commitMade(() => contractFx.payoffDraft(game.k, game.state, o)),
    coverBlock: (covered: boolean): string | null => ask(() => contractFx.coverMarkBlock(game.k, game.state, { covered }), '現在改不了。'),
    cover: (covered: boolean): string | null => commitMade(() => contractFx.coverMarkDraft(game.k, game.state, { covered })),
    triggerBlock: (npc: string, kind: contractFx.HolderEventKind): string | null => ask(() => contractFx.triggerBlock(game.k, game.state, { npc, kind }), '現在做不了。'),
    trigger: (npc: string, kind: contractFx.HolderEventKind): string | null => commitMade(() => contractFx.triggerDraft(game.k, game.state, { npc, kind })),
    adjustBlock: (npc: string, patch: contractFx.AdjustPatch): string | null => ask(() => contractFx.adjustBlock(game.k, game.state, { npc, patch }), '現在改不了。'),
    adjust: (npc: string, patch: contractFx.AdjustPatch): string | null => commitMade(() => contractFx.adjustDraft(game.k, game.state, { npc, patch })),
    releaseBlock: (npc: string, stay?: boolean): string | null => ask(() => contractFx.releaseBlock(game.k, game.state, { npc, ...(stay ? { stay } : {}) }), '現在解不了約。'),
    release: (npc: string, stay?: boolean): string | null => commitMade(() => contractFx.releaseDraft(game.k, game.state, { npc, ...(stay ? { stay } : {}) })),
  }

  /** 身上的惡意韌體：每一筆的階段、效果、清除的每一條路（引擎的 malwareView） */
  const malware = {
    view: (id?: string): malwareFx.MalwareView[] => onPc((pc) => malwareFx.malwareView(game.k, game.state, id ?? pc), []),
    cleanBlock: (o: Omit<malwareFx.CleanOpts, 'actor'>): string | null => onPc((pc) => malwareFx.cleanBlock(game.k, game.state, { ...o, actor: pc }), NO_BODY),
    clean: (o: Omit<malwareFx.CleanOpts, 'actor'>): string | null => doOnPc((pc) => malwareFx.cleanDraft(game.k, game.state, { ...o, actor: pc })),
  }

  /** 調校：兩個槽、四項橋參數的來源、能裝的清單、站的地方做不做調校與靜室（引擎的 tuning） */
  const tuning = {
    view: (): tuningFx.BridgeViewOfTuning | null => onPc((pc) => tuningFx.bridgeView(game.k, game.state, pc), null),
    list: () => onPc((pc) => tuningFx.tuningList(game.k, game.state, pc), []),
    here: (): tuningFx.TuningFacility | null => ask(() => tuningFx.tuningHere(game.k, game.state), null),
    installQuote: (id: string): tuningFx.TuningQuote | null => onPc((pc) => tuningFx.installQuote(game.k, game.state, { actor: pc, id }), null),
    installBlock: (id: string): string | null => onPc((pc) => tuningFx.installBlock(game.k, game.state, { actor: pc, id }), NO_BODY),
    install: (id: string): string | null => doOnPc((pc) => tuningFx.installDraft(game.k, game.state, { actor: pc, id })),
    removeQuote: (id: string): tuningFx.TuningQuote | null => onPc((pc) => tuningFx.removeQuote(game.k, game.state, { actor: pc, id }), null),
    removeBlock: (id: string): string | null => onPc((pc) => tuningFx.removeBlock(game.k, game.state, { actor: pc, id }), NO_BODY),
    remove: (id: string): string | null => doOnPc((pc) => tuningFx.removeDraft(game.k, game.state, { actor: pc, id })),
    quietQuote: (param: tuningFx.QuietOpts['param'], dir: 1 | -1): tuningFx.QuietQuote | null => onPc((pc) => tuningFx.quietQuote(game.k, game.state, { actor: pc, param, dir }), null),
    quietBlock: (param: tuningFx.QuietOpts['param'], dir: 1 | -1): string | null => onPc((pc) => tuningFx.quietBlock(game.k, game.state, { actor: pc, param, dir }), NO_BODY),
    quiet: (param: tuningFx.QuietOpts['param'], dir: 1 | -1): string | null => doOnPc((pc) => tuningFx.quietDraft(game.k, game.state, { actor: pc, param, dir })),
  }

  /** 蠱惑：找過主角的流竄 AI（順著幾次、揭開了哪幾格；引擎的 lureView） */
  const lure = {
    view: (): lureFx.LureViewRow[] => ask(() => lureFx.lureView(game.k, game.state), []),
  }

  /** 請教與上課（引擎的 teachOptions、lessonDraft）：npc 是向人請教，facility 是去機構上課（不給是腳下的設施種類） */
  const training = {
    options: (o: { npc?: string; facility?: string } = {}): TeachOption[] => ask(() => trainOptions(game.k, game.state, o), []),
    block: (o: TrainOpts): string | null => ask(() => trainBlock(game.k, game.state, o), '現在上不了課。'),
    lesson: (o: TrainOpts): string | null => commitMade(() => trainDraft(game.k, game.state, o)),
    /** 向 NPC 學工藝（M4-craft-teach；基本功 0～2 級）：互動選單「請教」的 handoff 帶 also 時兩邊都列。學費、時段、擋住的原因全是引擎的 */
    tutorOptions: (npc: string): TutorOption[] => ask(() => tutorOptionsFx(game.k, game.state, { npc }), []),
    tutorBlock: (o: TutorOpts): string | null => ask(() => tutorBlockFx(game.k, game.state, o), '現在上不了課。'),
    tutorLesson: (o: TutorOpts): string | null => commitMade(() => tutorDraftFx(game.k, game.state, o)),
    skillName: (id: string): string => game.k.content.get<{ id: string; name?: string }>('skill', id)?.name ?? id,
    /** 說明文字用的數字（引擎的常數與規則）：機構最多教到幾級、工藝課最多教到幾級 */
    limits: (): { facilityMax: number; tutorMax: number } => ({ facilityMax: FACILITY_MAX, tutorMax: tutorMax(game.k) }),
  }

  // ---- 修理構裝（M4-ui-followups；features/netcombat 的 repairRows／repairBlock／repairDraft）：站在有 repair_construct 的設施上才列；價錢與原因全是引擎的 ----
  const repair = {
    /** 現在站的設施提供修理構裝嗎（設施種類的名字；不是 null） */
    here: (): string | null => ask(() => netRepairHere(game.k, game.state), null),
    /** 身上要修的構裝，一件一列（id、名字、價錢）；沒有帶重創的是空的 */
    rows: (): NetRepairRow[] => ask(() => (game.state.pc === null ? [] : netRepairRows(game.k, game.state, game.state.pc)), []),
    /** 修某一件（沒給是全修）現在行不行：不行是引擎的原因 */
    block: (id?: string): string | null => ask(() => (game.state.pc === null ? NO_BODY : netRepairBlock(game.k, game.state, game.state.pc, id)), NO_BODY),
    /** 付錢修；被擋下回傳引擎的原因，修好是 null */
    fix: (id?: string): string | null => commitMade(() => netRepairDraft(game.k, game.state, game.state.pc ?? '', id)),
  }


  // ---- 未登錄零件（M4-ui-parts；features/unreg、Game.unregDeliver）：全部轉接引擎的匯出，畫面不算價錢、等級上限、能不能訂、能不能換、怪癖的候選 ----
  /** 一筆等著交貨的零件給畫面看的樣子：引擎的 pendingView（框架、還要幾天、交不交得了與原因）加上停在半路與否（引擎的 Game.unregPaused） */
  type PendingRow = unregFx.PendingView & { /** 交貨停在半路（寫正文被拒），等玩家處理 */ paused: boolean }
  /** 交一件貨：AI 開著走任務鏈（沿用現有的任務鏈列），否則直接提交。被擋下回傳 refused 與原因 */
  async function deliver(id: string, opts: { autoRules?: boolean } = {}): Promise<ActOutcome> {
    let r: ActOutcome
    try {
      r = await run(() => game.unregDeliver(id, opts))
    } catch (e) {
      const why = reasonOf(e)
      if (why === null) throw e
      return { status: 'refused', reason: why }
    }
    return r
  }
  let delivering = false
  /** 每一步之後交掉可以交的（被活動擋住的留到下一步；停在半路的不再自動碰） */
  async function deliverReady(): Promise<void> {
    if (delivering || busy.value) return
    delivering = true
    try {
      for (let guard = 0; guard < 20; guard++) {
        const next = unregFx.readyParts(game.k, game.state).find((p) => !game.unregPaused().includes(p.id) && unregFx.deliverBlock(game.k, game.state, p.id) === null)
        if (!next) break
        const r = await deliver(next.id)
        if (r.status !== 'applied') break
      }
    } finally {
      delivering = false
    }
  }
  const unreg = {
    /** 全部等著交貨的（背包的小區塊與委託台的訂單頁） */
    pending: (): PendingRow[] => ask(() => { const paused = game.unregPaused(); return unregFx.pendingView(game.k, game.state).map((p) => ({ ...p, paused: paused.includes(p.id) })) }, []),
    /** 腳下的委託台（設施種類帶 unreg_desk）；不在是 null */
    desk: (): unregFx.DeskHere | null => ask(() => unregFx.deskHere(game.k, game.state), null),
    orderView: (): unregFx.OrderView => { void state.value; return unregFx.orderOptions(game.k, game.state) },
    orderBlock: (o: unregFx.OrderInput): string | null => ask(() => unregFx.orderBlock(game.k, game.state, o), '現在訂不了。'),
    order: (o: unregFx.OrderInput): Promise<ActOutcome> => commitDrafts(() => unregFx.orderDraft(game.k, game.state, o), '訂做零件'),
    windowOptions: (): unregFx.WindowOption[] => ask(() => unregFx.windowOptions(game.k, game.state), []),
    windowBlock: (o: unregFx.WindowInput): string | null => ask(() => unregFx.windowBlock(game.k, game.state, o), '現在換不了。'),
    window: (o: unregFx.WindowInput): Promise<ActOutcome> => commitDrafts(() => unregFx.windowDraft(game.k, game.state, o), '換零件'),
    deliver,
    /** 這一件現在能交嗎（引擎的 deliverBlock）；能交是 null */
    deliverBlock: (id: string): string | null => ask(() => unregFx.deliverBlock(game.k, game.state, id), '現在交不了貨。'),
    /** 現在的分鐘數（訂做還要幾天的算式用） */
    now: (): number => { void state.value; return toMinutes(game.state.time) },
  }

  // ---- 拍賣行（M4-ui-auction；features/auction）：全部轉接引擎的匯出；仿品的記號與競標者的預算不經過這裡（只用 catalogView、auctionView、bidOptions） ----
  /** 拍賣的報告：一般的回合直接提交；落槌之後整場結束的那一份走 commitNarrated（結尾的正文） */
  async function commitAuction(make: () => ReportDraft): Promise<ActOutcome> {
    let d: ReportDraft
    try {
      d = make()
    } catch (e) {
      const why = reasonOf(e)
      if (why === null) throw e
      return { status: 'refused', reason: why }
    }
    if ((d.outcome as { closed?: boolean }).closed === true) return commitDrafts(() => d, '拍賣結束')
    const why = commitMade(() => d)
    return why ? { status: 'refused', reason: why } : { status: 'applied' }
  }
  const auction = {
    /** 腳下的設施是哪幾家拍賣行（設施種類的欄位 auction.house） */
    here: (): auctionFx.HouseHere[] => ask(() => auctionFx.housesHere(game.k, game.state), []),
    session: (house: string): auctionFx.Session | null => ask(() => auctionFx.sessionOf(game.k, game.state, house), null),
    catalog: (house: string): auctionFx.CatalogView | null => ask(() => auctionFx.catalogView(game.k, game.state, house), null),
    member: (house: string): auctionFx.Membership => ask(() => auctionFx.memberOf(game.k, game.state, house), { house, member: false, blocks: ['現在查不到會員的資料。'], reason: '現在查不到會員的資料。' }),
    refOptions: (house: string): auctionFx.RefOption[] => ask(() => auctionFx.refOptions(game.k, game.state, house), []),
    refBlock: (o: auctionFx.RefInput): string | null => ask(() => auctionFx.refBlock(game.k, game.state, o), '現在請不了推薦函。'),
    ref: (o: auctionFx.RefInput): Promise<ActOutcome> => commitDrafts(() => auctionFx.refDraft(game.k, game.state, o), '推薦函'),
    inspectOptions: (house: string, by?: string): auctionFx.InspectOption[] => ask(() => auctionFx.inspectOptions(game.k, game.state, house, by), []),
    inspectBlock: (o: auctionFx.InspectInput): string | null => ask(() => auctionFx.inspectBlock(game.k, game.state, o), '現在看不了貨。'),
    inspect: (o: auctionFx.InspectInput): Promise<ActOutcome> => commitAuction(() => auctionFx.inspectDraft(game.k, game.state, o)),
    enterBlocks: (house: string): string[] => ask(() => auctionFx.enterBlocks(game.k, game.state, house), ['現在進不了場。']),
    enter: (house: string, pay: 'cash' | 'cred'): Promise<ActOutcome> => commitAuction(() => auctionFx.enterDraft(game.k, game.state, { house, pay })),
    view: (): auctionFx.AuctionView | null => ask(() => auctionFx.auctionView(game.k, game.state), null),
    bidOptions: (): auctionFx.BidOptions | null => ask(() => auctionFx.bidOptions(game.k, game.state), null),
    bid: (input: auctionFx.BidInput | auctionFx.AutoInput): Promise<ActOutcome> => commitAuction(() => auctionFx.bidDraft(game.k, game.state, input)),
    /** 這樣喊現在行不行（含自動跟價 { auto: { max } }）：引擎的第一個原因，行是 null */
    bidBlock: (input: auctionFx.BidInput | auctionFx.AutoInput): string | null => ask(() => auctionFx.bidBlock(game.k, game.state, input), '現在不能喊。'),
    leaveBlock: (): string | null => ask(() => auctionFx.leaveBlock(game.k, game.state), '現在不在拍賣廳裡。'),
    leave: (): Promise<ActOutcome> => commitAuction(() => auctionFx.leaveDraft(game.k, game.state)),
    /** 引擎的分鐘數寫成「第 N 天 HH:MM（週幾）」（開槌與公布的時間） */
    at: (minutes: number): string => { const t = fromMinutes(minutes); return `${formatTime(t)}（${unregFx.weekdaysText([weekdayOf(t, game.k.timeRules)])}）` },
    /** 現在的分鐘數（階段是照它分的） */
    now: (): number => { void state.value; return toMinutes(game.state.time) },
    /** 最近一場結束了的拍賣（從報告讀：落槌的結果、玩家得標的、花了多少、結束時間）；進行中或沒有是 null */
    settlement: () => auctionSettlementOf(state.value.reports),
    /** 最近一份拍賣回合的報告（這一回合每個人的動作在它的 timeline） */
    lastRound: () => auctionLastRound(state.value.reports),
  }

  // ---- 簾後館（M4-ui-curtain）：全部轉接 features/curtain 與 enemies 的 unitFormView；入會、費用、場熱、打賞、三條路的數字與能不能做都是引擎的 ----
  const curtain = {
    /** 會員的全貌（邀請函、席次、會費、這一週的主打、今晚還能報幾場、每個席次能不能升與原因）；引擎的 memberView */
    member: (): curtainFx.MemberView | null => ask(() => curtainFx.memberView(game.k, game.state), null),
    /** 簾口：現在站的位置不是簾口時報名不成立的原因；站在簾口或這一局沒有簾口這回事是 null（引擎的 doorBlock） */
    door: (): string | null => ask(() => curtainFx.doorBlock(game.k, game.state), null),
    interviewBlocks: (o: curtainFx.InterviewOpts): string[] => ask(() => curtainFx.interviewBlocks(game.k, game.state, o), ['現在談不了。']),
    interviewBlock: (o: curtainFx.InterviewOpts): string | null => ask(() => curtainFx.interviewBlock(game.k, game.state, o), '現在談不了。'),
    interview: (o: curtainFx.InterviewOpts): Promise<ActOutcome> => commitDrafts(() => curtainFx.interviewDraft(game.k, game.state, o), '面談'),
    tasteOptions: (): curtainFx.TasteOption[] => ask(() => curtainFx.tasteOptions(game.k, game.state), []),
    tasteBlock: (tags: string[]): string | null => ask(() => curtainFx.tasteBlock(game.k, game.state, tags), '現在改不了口味單。'),
    taste: (tags: string[]): Promise<ActOutcome> => commitDrafts(() => curtainFx.tasteDraft(game.k, game.state, tags), '口味單'),
    /** 這一週抽得到的夜（口味單與內容篩選之下）與是不是純舞台場次 */
    pool: (): curtainFx.NightPool | null => ask(() => curtainFx.nightPool(game.k, game.state), null),
    quote: (o: curtainFx.EnterOpts): curtainFx.EnterQuote | null => ask(() => curtainFx.enterQuote(game.k, game.state, o), null),
    enterBlocks: (o: curtainFx.EnterOpts): string[] => ask(() => curtainFx.enterBlocks(game.k, game.state, o), ['現在報不了名。']),
    enter: (o: curtainFx.EnterOpts): Promise<ActOutcome> => commitDrafts(() => curtainFx.enterDraft(game.k, game.state, o), '報名'),
    /** 一趟裡的畫面資料（第幾幕、場熱與三段、票根、點單、贊助人、這裡能做的事）；沒有在簾後館的一趟裡是 null */
    view: (): curtainFx.CurtainView | null => ask(() => curtainFx.curtainView(game.k, game.state), null),
    /** 做一件事：id 是引擎列的（order、order:accept、order:refuse、chest、clause、clause:sign、shortcut、prize、book），at 是節點的 id；合演的對象用 opts.with */
    use: (id: string, at?: string, opts: { with?: string } = {}): Promise<ActOutcome> => commitDrafts(() => curtainFx.useCurtain(game.k, game.state, id, at, opts), '簾後館'),
    /** 看過、等著決定的點單（內容、接受與拒絕各自能不能做、合演可以選的對象） */
    orders: (): ReturnType<typeof curtainFx.orderChoices> => ask(() => curtainFx.orderChoices(game.k, game.state), null),
    /** 化妝室：book 是贊助人在場時的包場 */
    rest: (o: { book?: boolean } = {}): Promise<ActOutcome> => commitDrafts(() => curtainFx.restDraft(game.k, game.state, o), '化妝室'),
    /** 最近一次進化妝室的那一份報告的句子（引擎寫的） */
    roomLines: (): string[] => { void state.value; const r = [...game.state.reports].reverse().find((x) => x.action === 'curtain.rest'); return r ? [...(r.narration?.results ?? [r.outcome.summary])] : [] },
    encoreBlocks: (): string[] => ask(() => curtainFx.encoreBlocks(game.k, game.state), ['現在沒有加演。']),
    encoreOf: (): curtainFx.EncoreRec | null => ask(() => curtainFx.encoreOf(game.state), null),
    encore: (): Promise<ActOutcome> => commitDrafts(() => curtainFx.encoreDraft(game.k, game.state), '加演'),
    /** 帳與母帶（不必在落幕之後也看得到）：欠款與上限與每週利息、簽著的檔期、每一支母帶；全部是引擎的 accountView（沒有欠的是 null 與空的） */
    account: (): curtainFx.AccountView => ask(() => curtainFx.accountView(game.k, game.state), { tab: null, gig: null, tapes: [] }),
    /** 落幕之後：現在在哪一步（補演或三條路）、數字與能不能選（引擎的 fallView）；沒有是 null */
    fall: (): curtainFx.FallView | null => ask(() => curtainFx.fallView(game.k, game.state), null),
    replay: (): Promise<ActOutcome> => commitDrafts(() => curtainFx.replayDraft(game.k, game.state), '補演'),
    callOff: (): Promise<ActOutcome> => commitDrafts(() => curtainFx.callOffDraft(game.k, game.state), '喊停'),
    settleBlock: (how: curtainFx.HowSettle): string | null => ask(() => curtainFx.settleBlock(game.k, game.state, how), '現在選不了。'),
    settle: (how: curtainFx.HowSettle): Promise<ActOutcome> => commitDrafts(() => curtainFx.settleDraft(game.k, game.state, { how }), '落幕之後'),
    payTabBlock: (amount?: number): string | null => ask(() => curtainFx.payTabBlock(game.k, game.state, amount === undefined ? {} : { amount }), '現在還不了。'),
    payTab: (amount?: number): Promise<ActOutcome> => commitDrafts(() => curtainFx.payTabDraft(game.k, game.state, amount === undefined ? {} : { amount }), '還款'),
    buybackBlock: (tape: string): string | null => ask(() => curtainFx.buybackBlock(game.k, game.state, { tape }), '現在買不回來。'),
    buyback: (tape: string): Promise<ActOutcome> => commitDrafts(() => curtainFx.buybackDraft(game.k, game.state, { tape }), '買回母帶'),
    /** 敵人的名牌與立繪：這個敵人現在對 target（它鎖定的目標；沒有就照主角）是哪一個形象，與兩種可能的樣子（引擎的 unitFormView）；沒有雙形象是 null */
    unitForm: (unitId: string): UnitFormView | null => ask(() => {
      const b = game.state.battle
      const u = b?.units[unitId]
      if (!b || !u) return null
      return unitFormView(game.k, game.state, u, lockedTarget(b, u)) ?? null
    }, null),
    /** 內容裡的名字（夜、勢力、傾向標籤） */
    nameOf: (kind: string, id: string): string => game.k.content.get<{ id: string; name?: string }>(kind, id)?.name ?? id,
    /** 示意模式才有（開新局的開關）：再給一張邀請函（引擎的效果 curtain_invite；誰給邀請函是內容）。關著或被擋下回傳原因 */
    invite: (days?: number): string | null => demoMode.value ? commitMade(() => {
      const changes = demoCurtainChanges(game.k, game.state, days)
      if (changes.length === 0) throw new ActionBlocked('現在給不了邀請函。')
      return { kind: 'system', action: 'curtain.invite_demo', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '你拿到一張簾後館的邀請函。' } }
    }) : '示意模式沒有開（開新局時的選項）。',
  }

  return { state, feed, demoMode, adult, curtain, unreg, auction, repair, body, contract, malware, tuning, lure, training, craft, dye, partyRows, hostilityTop, hostilityRows, world, net, dive, maze, transit, people, event, fixer, commission, scene, deck, trade, bills, work, rest, placeName, skills, gear, battle, inBattle, defeat, pendingDefeat, blockOf, battleOptions, battleMode, battleLayer, netBattle, statusName, skillAdminCost, night, startBattle, startEncounter, encounters, battleAct, battleNext, finishBattle, retryBattle, rewindToStage, acceptDefeat: acceptDefeatNow, defeatFlow, sceneGate, eventInline, hostEvent, contentName, hasCharacter, pc, money, timeLabel, log, busy, chainSteps, canUndo, clock, newGame, createCharacter, creation, act, retryStep, useRules, reroll, stepActions, rewind, setAi, save, checkSave, load, undo, commit, ledger }
})
