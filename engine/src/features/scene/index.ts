// L6 功能：成人場景的最小可操作版，第十種行動「換檔」是 M3-scene-sync（LEWD_SYSTEM 第 3 節，3.5 節是完整的規則；DATA 第 3 節、第 4 節 adult_scene；CORE_RULES 4.2 節；UI 第 10 節；
// dev/adr/0016 第一、二節、G6、G11；dev/work/M2-scene.md）。
//
// 一種活動 scene（order 20）：回合制（M4-scene-seats：狀態是第二版的座位與配對；M4-scene-circles：三到四人一圈、分圈、換圈與叫人）。行動點、感載與餘韻、契合、主動權、體位、部位與連接、目的的進度；玩家按「停下」才結束（或三種強制結束），
// 結束之後一次結算。所有參與者都是成年人（核心的底線在提交與讀檔時擋）。
// 沒有每回合的 AI：對方的行動與說話的判定走規則（sceneNext、說話用骰子）；AI 只在結束之後寫整場的正文（報告帶 adult: true，外殼用 commitNarrated 走成人路由）。
// 每回合只有一句中性的動作描述（state.ext.scene.lines）；不寫任何露骨的文字。
//
// 兩種模式（設定 scene_mode，預設 simple；setSceneMode(k, mode)；下一場生效）：規則與數字完全相同，差別只在誰來選部位：精簡版用技能、道具、說話時沒給部位由引擎挑
//（技能寫的部位裡空著的優先、有標籤的部位優先、都佔著就換掉最早的一條），切換體位之後把能接的接回去；完整版要玩家自己選部位。
// 精簡版固定一對一（P37）：多人的設定只展開主角與第一圈的第一個人，其餘收成不展開的圈、在旁邊算；完整版可以三到四人一圈、分圈、換圈。
//
// 多人（M4-scene-circles；dev/adr/0019 第九節、P33～P37）：kind 是 pair（一對一，一次 sceneNext 走一步）或 group（完整版，這一場除了主角還有兩個以上的人；
// 一次 sceneNext 走完一整輪：每個由程式控制的人照座位的順序各走完自己的回合，再做連接的自動效果、別的圈各算一次、強制結束的檢查）。契合與主動權只記主角對每個人（P33）；
// 體位由「主角對他主動權最低」的人決定（P34）；失神的人退出、人數對不上自動換體位；換圈 2 點、叫人 1 點（只有主角；精簡版沒有）。
// 輸入多兩種：{ kind: 'move_circle', circle }、{ kind: 'call', who }；結算的 result 在多人時多 pairs（每個對象）與 circles（別的圈）。
//
// 單人（M4-scene-solo；LEWD_SYSTEM 3.5 節第九點、dev/adr/0019 第九節與 P38～P40）：setup.solo: true，沒有對象、沒有主動權；kind 是 solo、座位只有主角、pairs 是空的；節奏（pace）取代契合；
// 位置是五個單人姿勢（model.ts 的 DEFAULT_SOLO_POSES；資料的 solo_pose 換掉或多一個）；行動多加快與放慢、沒有主導、迎合、挑逗與圈；技能與道具看資料的 scene.solo；
// 說話只有 setup.audience 為 true（直播開著；M5 之前沒有人會給）才行；節奏掉的時候、強制結束（沒了興致 bored）、結算（體悟打折、性經歷只加 solo_times）見 play.ts 與 end.ts。
//
// 內海（M4-scene-net；LEWD_SYSTEM 3.4 節、CYBERSPACE 第 10 節、dev/adr/0019 第九節與 P41、P42）：setup.layer 寫 net，或沒寫而進行中的活動有 dive、netrun、face.net，這一場就是內海的場景（每一拍標 net、
// 結算的 result 帶 layer）。規則、數字、感載、餘韻、換檔、結算兩層相同；差別只有：部位問 scene.body 時帶 layer（現實的義體不算、化身的 deck 回答）、對象性別的篩選看化身的性別（genderIn）、
// 回合結算的感載消退是 net_load_decay（基礎 0，沒有 mod(意志)；CORE_RULES 4.2 節）。要有橋與甲板（夢 dream: true 不要甲板）；網內的行程被強制結束時聽 activity.end 把這一場打斷（夢不算）。
//
// 接上核心的地方：
//   內容  position（DATA 3.2；M2 只收 people: 2）、solo_pose（單人姿勢；內建五個，資料換掉或多一個）、night_skill（DATA 3.1；M2 只用 scene、tag、tags、name）、scene_rule（id: default，規則的數字蓋掉內建的）；
//         物品多讀一個 scene 欄位（DATA 3.3，載入之後 ready 查格式）
//   活動  scene（setup 見 SceneSetup；放行 commit:scene.）；結束時發 activity.end（result: { with, fit, rating, goal, goal_done, reason }）
//   內容  night_resonance（夜課的共鳴；M4-nightclass，night.ts）；night_skill 多讀 branch、tier、insight、requires、filters、deep（格式在 night.ts；nightclass 讀）
//         共鳴多的幾種鍵（M4-night-resonance，格式在 night.ts、行為在 play.ts）：per_round（條件式的每回合效果：if 是 bind_link、contract_partner、init_extreme、watched、style_match）、
//         link_bonus（依連接的部位加持續的契合：口、多出來的部位）、keep_extra_links、once（set_init、fit_floor、free_tease、no_glow、free_dress）、opening（開場的主動權與契合）、
//         tease_flat、restrain_dice、load_cap、tease_exposure。共鳴只在成人場景裡有效，所以感載上限與曝露度加成不走被動效果的來源（核心的來源清單是封閉的，沒有 night），直接算在場景裡。
//         共鳴給的兩種行動（沒有那個共鳴就用不出來）：once（夜課的功夫：每場一次，主動權直接設成 70 或 30、契合拉到 50）與 dress（脫換衣服：第一次不花行動點；只花行動點與記一行，穿脫在場景外）。
//   條件  partnered { not? }（有固定的伴：最喜歡的人不是 not、或是契約人）；技能的 needs 可以寫 { kind: 'target', of: 條件 }：「對方……」的需要，內層的條件看這個行動的對象
//   量表  insight（體悟；單一、0 起、沒有上限；同名的效果與條件核心自動有）
//   狀態  state.ext.scene（見 model.ts 的 SceneRaw）；actor.ext.scene（誰會什麼：positions、skills；選填 parts、part_tags）；actor.ext.sex_record（性經歷）
//   掛鉤  rewind.keep：回到快照之後性經歷留著；scene.body（這個功能宣告：義體、調校、內海的化身回答多出來的部位、各部位的敏感度修正與標籤）
//   讀別人的  actor.ext.bridge、actor.ext.tendency（只認格式）、k.stats（ap_max、load_cap、afterglow_cap、bridge_sensitivity、bridge_docility；沒有人註冊就照設計書的公式）、
//            k.content（item）、state.inventory、效果 affinity／bridge／tendency（沒有人註冊的略過）
// 報告：scene.start、scene.act、scene.next（對方的一步與回合的結算）、scene.end（adult: true、kind social；強制結束與略過也是它）。
//
// 對外：sceneStart／startProblems（開場的摘要）、sceneAct、sceneNext、sceneSkip、sceneInterrupt、sceneView、sceneOptions、scenePreview、sceneRawOf（第二版的原樣）、setSceneMode。
// 外面來的東西（SceneEnv）：dice、moves（外殼從 scene_turn 拿到的某個人這一步的一串行動）、talk（scene_talk 的結果）、gears（每個人這一步換到哪一檔；partner_gear 是舊的鍵）、
//   closing（結束時 AI 的收尾結果：sink、tendency、sex_record、relate；程式驗過才用，AI 關著就全照規則；M4-scene-close，結算的細節在 close.ts 與 end.ts）。

import type { ActorId, Condition, Feature, GameState, Kernel, Origin, PassiveEffect, ReportDraft, SyncGear } from '../../core'
import { ActionBlocked, ContentError, clone, isRecord } from '../../core'
import type { ActivityDef } from '../../core'
import type { Closing } from './close'
import { endDraft, logBeats, sceneDraft, stepDraft } from './end'
export { AMNESIA_RESIDUE } from './end'
import type { CircleRec, Dice, Goal, Nature, PositionEntry, Role, SceneKind, SceneMode, SceneRaw, Who } from './model'
import {
  ACTIVITY, EXT, GENDER_FILTER, GOALS, GOAL_NAME, LAYERS, NATURES, NET_ACTIVITIES, NATURE_FILTER, NATURE_NAME, NTR_FILTER, OWNER, POSITION_KIND, ROLES, ROLE_NAME, RULE_KIND, SKILL_KIND, SOLO_POSE_KIND, beat,
  genderIn, hasTendencyTag, isGoal, isMode, isNature, isRole, knownAll, openingFit, openingInit, openingPace, positionProblems, readSceneDef, ruleProblems, sceneModeOf, sceneRawOf, sceneRules, sexRecordOf, skillProblems, soloPoseProblems, soloPoses, startGear, tendencyTagIds,
} from './model'
import type { RevealView } from './night'
import { RESONANCE_KIND, resonanceOf, resonanceProblems, revealFor } from './night'
import type { SceneInput, TalkEnv } from './play'
import { MAX_MOVES, Play, diceOf, inputProblem } from './play'
import { sceneWindow } from './window'

export * from './model'
export type { SceneWindow, SceneWindowAnswer } from './window'
export { sceneWindow } from './window'
export type { Closing, SinkKind, SinkPlan, BridgeParam } from './close'
export { SINK_KINDS, bridgeParamOf } from './close'
export type { Resonance, RevealView } from './night'
export { BRANCHES, RESONANCE_KIND, knowFor, npcKnow, resonanceOf } from './night'
export type { Preview, PreviewLoad, SceneInput, PartPick, TalkEnv, TalkEnvs } from './play'
export { Play, MAX_MOVES, costOf as inputCostOf } from './play'
export { sceneOptions, scenePreview, sceneView } from './view'
export type { ActionOption, ChoiceOption, GearView, LineView, LinkView, PairView, PartView, PersonView, ScenePick, ScenePickOption, ScenePair, SceneOptions, SceneView } from './view'

/** 測試用：換掉骰子（拿到一個 int(min, max) 的東西）。沒給就照存檔的亂數導出：同一個種子、同樣的行動序列，結果一樣。 */
export interface SceneEnv {
  dice?: Dice
  /** 對方這個回合換到哪一檔（舊的鍵，一對一的對方；等於 gears[對方的 id]） */
  partner_gear?: SyncGear
  /** 每個人這個回合換到哪一檔（scene_turn 的 AI 給；沒給走規則：感載七成以上退一檔）。不合規（超過他的上限、這回合換過了）就當沒給 */
  gears?: Record<ActorId, SyncGear>
  /**
   * 外殼從 scene_turn 拿到的、這個人這一步的一串行動（角色的 id → 行動）。輪到這個人時，照順序一個一個驗：行動點夠、有主動權才能切換體位、部位空著或照連接的規則中斷、
   * 要標籤的技能有標籤、體位他會、needs 過得了；不能是 stop。第一個不合規的連同後面的全部丟掉，他剩下的行動點照現有的規則走（接下來的 sceneNext）；
   * 報告的 timeline 多一拍 scene.dropped，data 記下丟掉幾個與第一個的原因。沒給就全照規則。
   */
  moves?: Record<ActorId, SceneInput[]>
  /**
   * scene_talk 的結果，每個人一份（鍵是說話的人；M4-core-gaps 第 15 項：多人同時說話也各有各的）：這個人這一步說話（或主角叫人過來）時有給就用它
   * （契合夾在 −5～+10、目的的進度夾在 0～+20），不擲檢定；沒給的人照現有的檢定
   */
  talk?: Record<ActorId, TalkEnv>
  /**
   * AI 給的一句動作或台詞（scene_turn 的 line），每人一句（M4-core-gaps 第 15 項）：放進這一步的紀錄（timeline 的 scene.line，data.source 是 scene_turn）與整場的紀錄（ext.scene.lines）。
   * 只收場景裡的人（座位與別的圈）；一個人只收第一句、空的與不認得的人丟掉、最多 200 字。只有對方的一步（sceneNext）讀它。
   */
  lines?: Array<{ who: ActorId; text: string }>
  /**
   * 結束時 AI 的收尾結果（AI_TASKS 3.7、3.8 節：sex_record、sink、tendency，加上關係的數字）。外殼把驗過格式的結果放進來，結算用它（程式再驗一次、夾住、丟掉不合的並留提醒）；
   * 沒給（AI 關著）就全照規則：沉溺照退路、傾向記這一場碰到的全部、關係照評價的固定值。只有結束的那一步（stop、強制結束、略過、打斷）讀它。
   */
  closing?: Closing
}

/** 開場景的設定：事件帶出來的是 DATA 第 4 節的 adult_scene 原樣（沒有 with，對象從 circles[0] 去掉主角取得）；委託、俘虜等用 with。 */
export interface SceneSetup {
  /** 主角這一圈的對象（一到三個；多人時等於一圈） */
  with?: string[]
  /** DATA 第 4 節的分圈：含主角的那一圈展開（沒有人含主角就是第一圈），其餘不展開；每圈最多四人、每個人只在一圈、全部最多八人 */
  circles?: string[][]
  nature: Nature
  role?: Role
  goal?: Goal | 'none'
  start_position?: string
  place?: string
  /** 這一場碰到的標籤（內容篩選關掉的不算） */
  tags?: string[]
  /** 蓋掉設定的模式（測試與特殊的場合）；沒給就看 setSceneMode */
  mode?: SceneMode
  /** 限回合的場景：回合數到了就強制結束，原因是「被外面的事打斷」 */
  max_rounds?: number
  /**
   * 現實（meat）或內海（net）。沒寫：開的時候進行中的活動有 dive、netrun、face.net 就是 net，否則 meat。寫 net 而沒有那三種活動（事件的夢）也開得起來；
   * 內海的場景要有甲板與橋（沒有橋一律開不了；沒有甲板只有 dream: true 開得了）。規則、數字、感載、餘韻、結算兩層相同（P41）；差別只有部位來自化身、性別看化身、內海每回合的感載消退是 net_load_decay
   */
  layer?: 'meat' | 'net'
  /**
   * 記憶被抹掉的場景（人偶晶片之類；M4-followups-2 第 7 項，outcome.amnesia 的下游）：結束時報告的 outcome 多 amnesia: true、結果只有兩句，
   * 不寫性經歷、不長傾向、不加沉溺累計（沉溺的結算與全檔過載累積都不做）；共同記憶（features/npcs）與正文（外殼）看 outcome.amnesia 自己略過。契合、體悟、橋參數、親密度照算
   */
  amnesia?: boolean
  /** 內海的夢（流竄 AI 的夢）：要明寫 layer: 'net'；不需要甲板；網內的行程結束時不跟著被打斷 */
  dream?: boolean
  /** 單人（M4-scene-solo）：沒有對象（不能給 with、circles）、沒有主動權；nature 寫 solo 或不寫；goal 只收 footage；start_position 是單人姿勢的 id */
  solo?: boolean
  /** 單人時有沒有人在看（直播開著）：要有觀眾的技能與說話才用得出來。M5 之前沒有人會給 true */
  audience?: boolean
  [more: string]: unknown
}

/** 一圈最多四個人（體位的人數上限）；全部最多八個人（LEWD_SYSTEM 3.5 節第七點）。 */
const CIRCLE_MAX = 4
const PEOPLE_MAX = 8

interface Parsed {
  pc: string
  /** 主角這一圈展開的人（座位）：完整版是這一圈所有的人，精簡版只有第一個 */
  seated: string[]
  /** 不展開的圈：精簡版從主角這一圈收出來的人（一圈）加上別的圈 */
  circles: string[][]
  nature: Nature
  role: Role
  goal: Goal | null
  place?: string
  tags: string[]
  mode: SceneMode
  start?: string
  max_rounds?: number
  /** 單人：沒有座位以外的人；audience 是這一場有沒有人在看 */
  solo?: boolean
  audience?: boolean
  layer: 'meat' | 'net'
  dream?: boolean
  amnesia?: boolean
}

/** 開場的摘要（確認框用：不必自己判斷第 0 步）：誰、性質、身分、目的、會碰到的標籤。 */
export interface StartSummary {
  kind: SceneKind
  layer: 'meat' | 'net'
  /** 內海的夢（沒有甲板也開得起來）；不是夢沒有這個鍵 */
  dream?: true
  /** 內海的場景才有：每個人（主角與每個對象）看化身的性別（沒有化身照角色的；沒有性別的人沒有這一項）。對象性別的篩選與版本看這一份；現實的摘要沒有這個鍵（和以前逐欄相同） */
  genders?: Record<string, string>
  mode: SceneMode
  pc: { id: string; name: string }
  /** 主角這一圈展開的人（精簡版只有第一個） */
  with: Array<{ id: string; name: string }>
  /** 不展開的圈（每一圈的人；沒有就沒有這個鍵） */
  circles?: Array<Array<{ id: string; name: string }>>
  nature: Nature
  nature_name: string
  role: Role
  role_name: string
  goal: { id: Goal; name: string } | null
  place?: string
  /** 這一場一開始就碰到的傾向標籤（內容篩選之後還在的） */
  tags: Array<{ id: string; name: string }>
  /** 這一場碰到的內容篩選項目（都是開著的；關掉的就開不起來）：性質、對象的性別、NTR */
  filters: Array<{ tag: string; name: string }>
  max_rounds?: number
  /** 單人才有：這一場有沒有人在看 */
  audience?: boolean
  /** 共鳴 reveal（夜課）：主角一開場就看得到的、每個對象最高的那一條軸或他有的一個標籤；沒有這個共鳴就沒有這個鍵 */
  reveal?: RevealView[]
}

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

/** 每個人在這一層的性別（沒有性別的人沒有這一項）。 */
function gendersOf(state: GameState, ids: string[], layer: 'meat' | 'net'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    const g = genderIn(state, id, layer)
    if (g !== undefined) out[id] = g
  }
  return out
}

/** 開場景的條件：一條一句；空的就是開得成。 */
export function startProblems(k: Kernel, state: GameState, setup: unknown): { problems: string[]; parsed?: Parsed; summary?: StartSummary } {
  const p: string[] = []
  if (sceneRawOf(state)) return { problems: ['已經有一場成人場景在進行，先把它結束。'] }
  const s = isRecord(setup) ? setup : null
  if (!s) return { problems: ['場景要有設定：{ with 或 circles, nature, ... }。'] }
  const pc = state.pc
  if (!pc || !state.actors[pc]) p.push('還沒有主角，開不起場景。')
  // 主角這一圈的其他人，與別的圈（DATA 第 4 節的 circles：含主角的那一圈是主角這一圈；都沒有主角就是第一圈）
  let main: string[] = []
  let extra: string[][] = []
  const solo = s.solo === true
  if (s.solo !== undefined && typeof s.solo !== 'boolean') p.push('solo 要是 true 或 false。')
  if (s.audience !== undefined && typeof s.audience !== 'boolean') p.push('audience 要是 true 或 false。')
  if (solo) {
    // 單人沒有對象
    if (s.with !== undefined || s.circles !== undefined) p.push('單人的場景沒有對象：不能同時給 with 或 circles。')
  } else if (Array.isArray(s.with)) {
    main = idList(s.with)
    if (main.includes(pc ?? '')) p.push('對象不能是主角自己。')
    main = main.filter((x) => x !== pc)
    if (main.length < 1 || main.length > CIRCLE_MAX - 1) p.push(`with 要有一到三個對象（加上主角一圈最多四個人）。`)
  } else if (Array.isArray(s.circles) && s.circles.length > 0) {
    const cs = (s.circles as unknown[]).map(idList)
    const at = cs.findIndex((c) => c.includes(pc ?? ''))
    const mainAt = at >= 0 ? at : 0
    main = cs[mainAt]!.filter((x) => x !== pc)
    extra = cs.filter((_, i) => i !== mainAt).map((c) => c.filter((x) => x !== pc))
    if (main.length < 1 || main.length > CIRCLE_MAX - 1) p.push('主角這一圈要有一到三個對象（加上主角一圈最多四個人）。')
    if (extra.some((c) => c.length < 1 || c.length > CIRCLE_MAX)) p.push('別的圈每圈要有一到四個人。')
  } else p.push('場景要寫對象：with 或 circles。')
  const everyone = [...main, ...extra.flat()]
  if (new Set(everyone).size !== everyone.length) p.push('同一個人只能在一圈裡。')
  if (new Set(everyone).size + 1 > PEOPLE_MAX) p.push(`一場最多 ${PEOPLE_MAX} 個人（含主角）。`)
  for (const id of new Set(everyone)) if (!state.actors[id]) p.push(`找不到對象（${id}）：場景的對象要是已經在場的人。`)
  if (solo) {
    if (s.nature !== undefined && s.nature !== 'solo') p.push('單人的場景性質只能是 solo（或不寫）。')
    if (s.goal !== undefined && s.goal !== 'none' && s.goal !== 'footage') p.push('單人的場景目的只收 footage（拿素材）或 none。')
  } else {
    if (!isNature(s.nature)) p.push(`性質（nature）要是 ${NATURES.join('、')} 其中一個。`)
    else if (s.nature === 'solo') p.push('性質 solo 要搭配 solo: true（單人的場景）。')
    if (s.goal !== undefined && s.goal !== 'none' && !isGoal(s.goal)) p.push(`目的（goal）要是 ${GOALS.join('、')} 或 none。`)
  }
  if (s.role !== undefined && !isRole(s.role)) p.push(`身分（role）要是 ${ROLES.join('、')} 其中一個。`)
  const mode = s.mode !== undefined ? s.mode : sceneModeOf(k)
  if (!isMode(mode)) p.push('mode 要是 full 或 simple。')
  const filter = !solo && isNature(s.nature) ? NATURE_FILTER[s.nature] : undefined
  if (filter && state.rules.contentOff.includes(filter.tag)) p.push(`「${filter.name}」被你的內容篩選關掉了，這一種場景開不起來。`)
  // 現實還是內海：明寫的優先；沒寫看進行中的活動（dive、netrun、face.net 就是內海）
  if (s.layer !== undefined && !(LAYERS as readonly unknown[]).includes(s.layer)) p.push(`layer 要是 ${LAYERS.join('、')} 其中一個。`)
  if (s.dream !== undefined && typeof s.dream !== 'boolean') p.push('dream 要是 true 或 false。')
  if (s.amnesia !== undefined && typeof s.amnesia !== 'boolean') p.push('amnesia 要是 true 或 false。')
  const inNetActivity = k.activity.active(state).some((a) => (NET_ACTIVITIES as readonly string[]).includes(a.kind))
  const layer: 'meat' | 'net' = s.layer === 'net' || s.layer === 'meat' ? s.layer : inNetActivity ? 'net' : 'meat'
  const dream = s.dream === true
  if (dream && s.layer !== 'net') p.push("夢的場景要明寫 layer: 'net'。")
  if (layer === 'net' && pc && state.actors[pc]) {
    // 內海的場景：沒有橋沒有感載，沒有甲板進不了內海（夢是例外：夢裡不需要甲板）
    if (state.actors[pc]!.ext.bridge === null) p.push('你沒有橋，感覺不到內海裡的一切，開不起這一場。')
    if (!dream && !(k.stats.hasStat('deck_grade') && k.stats.stat(state, pc, 'deck_grade') > 0)) p.push('你沒有甲板，進不了內海，開不起這一場。')
  }
  // 對象的性別對到的內容篩選（LEWD_SYSTEM 第 9 節）；NTR 看 setup.tags
  const genderFilters = new Map<string, { tag: string; name: string }>()
  for (const id of everyone) {
    // 內海看化身的性別（現實看角色的）
    const gender = genderIn(state, id, layer)
    const gf = gender !== undefined ? GENDER_FILTER[gender] : undefined
    if (gf && !genderFilters.has(gf.tag)) {
      genderFilters.set(gf.tag, gf)
      if (state.rules.contentOff.includes(gf.tag)) p.push(`「${gf.name}」被你的內容篩選關掉了，對象是這個性別的場景開不起來。`)
    }
  }
  const wantsNtr = Array.isArray(s.tags) && (s.tags as unknown[]).includes(NTR_FILTER.tag)
  if (wantsNtr && state.rules.contentOff.includes(NTR_FILTER.tag)) p.push(`「${NTR_FILTER.name}」被你的內容篩選關掉了，這一場開不起來。`)
  if (s.max_rounds !== undefined && !(typeof s.max_rounds === 'number' && Number.isSafeInteger(s.max_rounds) && s.max_rounds >= 1)) p.push('max_rounds 要是 1 以上的整數。')
  // 精簡版固定一對一（P37）：只展開主角這一圈的第一個人，這一圈其餘的人收成一個不展開的圈
  const simple = mode === 'simple'
  const seated = simple ? main.slice(0, 1) : main
  if (p.length === 0 && !solo && knownAll(k, state, [pc!, ...seated]).length === 0) {
    p.push(seated.length === 1 ? '資料裡沒有雙方都會的兩人體位，場景開不起來。' : `資料裡沒有這 ${seated.length + 1} 個人都會的 ${seated.length + 1} 人體位，場景開不起來。`)
  }
  if (p.length > 0) return { problems: p }
  const tags = Array.isArray(s.tags) ? [...new Set((s.tags as unknown[]).filter((t): t is string => typeof t === 'string' && !!t && !state.rules.contentOff.includes(t)))] : []
  const circles = [...(simple && main.length > 1 ? [main.slice(1)] : []), ...extra]
  const parsed: Parsed = {
    pc: pc!, seated, circles, nature: solo ? 'solo' : (s.nature as Nature), role: (s.role as Role | undefined) ?? 'none', goal: s.goal === undefined || s.goal === 'none' ? null : (s.goal as Goal), tags, mode: mode as SceneMode,
    layer, ...(dream ? { dream: true } : {}), ...(s.amnesia === true ? { amnesia: true } : {}),
    ...(solo ? { solo: true, audience: s.audience === true } : {}),
    ...(typeof s.place === 'string' && s.place ? { place: s.place } : {}), ...(typeof s.start_position === 'string' ? { start: s.start_position } : {}),
    ...(typeof s.max_rounds === 'number' ? { max_rounds: s.max_rounds } : {}),
  }
  // 開場的摘要：性質是工作而沒寫身分，主角就是工作的人（和開場的主動權同一個算法）
  const role: Role = parsed.role === 'none' && parsed.nature === 'work' ? 'worker' : parsed.role
  const filters = [filter, ...genderFilters.values(), wantsNtr ? NTR_FILTER : undefined].filter((f): f is { tag: string; name: string } => !!f)
  const ref = (id: string): { id: string; name: string } => ({ id, name: state.actors[id]!.name })
  const summary: StartSummary = {
    kind: kindOf(parsed), layer, ...(dream ? { dream: true as const } : {}), ...(layer === 'net' ? { genders: gendersOf(state, [pc!, ...everyone], layer) } : {}), mode: parsed.mode, pc: ref(pc!), with: seated.map(ref), ...(circles.length > 0 ? { circles: circles.map((c) => c.map(ref)) } : {}),
    nature: parsed.nature, nature_name: NATURE_NAME[parsed.nature], role, role_name: ROLE_NAME[role], goal: parsed.goal ? { id: parsed.goal, name: GOAL_NAME[parsed.goal] } : null,
    ...(parsed.place ? { place: parsed.place } : {}), tags: tags.map((id) => ({ id, name: (k.content.get('tendency_tag', id)?.name as string | undefined) ?? id })),
    filters: [...new Map(filters.map((f) => [f.tag, { tag: f.tag, name: f.name }])).values()], ...(parsed.max_rounds !== undefined ? { max_rounds: parsed.max_rounds } : {}),
    ...(parsed.solo ? { audience: parsed.audience === true } : {}),
  }
  if (!solo) {
    const reveal = revealFor(k, state, pc!, [...seated, ...circles.flat()])
    if (reveal) summary.reveal = reveal
  }
  return { problems: [], parsed, summary }
}

/** 一對一（pair）還是多人（group）：完整版這一場除了主角還有兩個以上的人是多人（一次 sceneNext 走完一輪）；精簡版固定一對一。 */
function kindOf(o: Pick<Parsed, 'seated' | 'circles' | 'mode' | 'solo'>): SceneKind {
  if (o.solo) return 'solo'
  return o.mode === 'full' && o.seated.length + o.circles.reduce((n, c) => n + c.length, 0) > 1 ? 'group' : 'pair'
}

const needScene = (state: GameState): SceneRaw => {
  const s = sceneRawOf(state)
  if (!s) throw new ActionBlocked('現在沒有進行中的成人場景。')
  return s
}

function startScene(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[] {
  const r = startProblems(k, state, setup)
  if (!r.parsed) throw new ActionBlocked(r.problems.join(''))
  const o = r.parsed
  const rules = sceneRules(k)
  const seat = (id: ActorId): SceneRaw['seats'][number] => ({
    id, ap: 0, gear: 'standard', max_gear: 'standard', shifted: false, sink_gain: 0, climax: 0, received: 0, teased: false, restrained: false,
  })
  const circles: CircleRec[] = o.circles.map((people, i) => ({
    id: `c${i + 1}`, people: [...people], fit: rules.other_circle.fit_start, climax: Object.fromEntries(people.map((id) => [id, 0])), line: '',
  }))
  const pairs: SceneRaw['pairs'] = {}
  const solo = o.solo === true
  for (const id of o.seated) pairs[id] = { fit: openingFit(k, state, { pc: o.pc, partner: id, nature: o.nature, role: o.role, layer: o.layer }), init: openingInit(k, state, { pc: o.pc, partner: id, nature: o.nature, role: o.role, layer: o.layer }), first: sexRecordOf(state.actors[o.pc]).people[id] === undefined }
  const scene: SceneRaw = {
    v: 2, id: `sc${state.seq.uid + 1}`, mode: o.mode, kind: kindOf(o), layer: o.layer, pc: o.pc, nature: o.nature, role: o.role, goal: o.goal, ...(o.place ? { place: o.place } : {}), tags: o.tags,
    round: 1, turn: o.pc, step: 0, seats: [seat(o.pc), ...o.seated.map(seat)], pairs,
    goal_progress: o.goal ? 0 : null, position: '', roles: {}, links: [], link_seq: 0, turn_began: false,
    used_positions: [], touched: [...o.tags], lines: [], origin: clone(origin), circles, ...(o.max_rounds !== undefined ? { max_rounds: o.max_rounds } : {}),
    ...(solo ? { pace: openingPace(k, state, { pc: o.pc, layer: o.layer }), audience: o.audience === true } : {}),
    ...(o.dream ? { dream: true as const } : {}), ...(o.amnesia ? { amnesia: true as const } : {}),
  }
  const p = new Play(k, state, scene, diceOf(state, scene))
  for (const id of p.ids) p.seat(id).ap = p.apMax[id]!
  // 起始的檔位是標準；上限不到標準的人是淺（Play 把欄位補齊時已算；這裡是起始的明確寫入）
  for (const id of p.ids) {
    p.seat(id).gear = startGear(p.gearCap[id]!)
    p.seat(id).max_gear = p.seat(id).gear
  }
  // 單人：起始的姿勢是 start_position 寫的（查得到才算），沒寫就是第一個；沒有對象、沒有主動權
  if (solo) {
    const pose = p.poses.find((x) => x.id === o.start) ?? p.poses[0]!
    p.enterPose(pose)
    const text = `你獨自進入了這一場（${o.place ? `${o.place}，` : ''}${pose.name}）。`
    return [sceneDraft(state, p, 'scene.start', [beat(o.pc, text, 'scene.start', { nature: o.nature, position: pose.id, solo: true, audience: o.audience === true })], [{ op: 'uid', advance: 1 }, { op: 'ext', key: EXT, value: clone(p.s) }], 'start', text)]
  }
  // 起始的體位：寫了而且全圈都會就用它；沒寫（或不能用）就挑第一個全圈都會的基本體位
  const both = knownAll(k, state, p.ids)
  const start = (o.start ? both.find((x) => x.id === o.start) : undefined) ?? both[0]!
  p.enter(start, p.decider())
  const names = o.seated.map((id) => state.actors[id]!.name).join('、')
  const text = `你和${names}進入了這一場（${NATURE_NAME[o.nature]}${o.place ? `，${o.place}` : ''}）。`
  const d = sceneDraft(state, p, 'scene.start', [beat(o.pc, text, 'scene.start', { with: o.seated[0], nature: o.nature, position: start.id, ...(o.seated.length > 1 ? { people: o.seated } : {}), ...(r.summary?.reveal ? { reveal: r.summary.reveal } : {}) })], [{ op: 'uid', advance: 1 }, { op: 'ext', key: EXT, value: clone(p.s) }], 'start', text)
  return [d]
}

// ---- 玩家的一步、對方的一步、停下、略過、被外面打斷 ----

/**
 * 玩家做一個行動：回傳報告草稿（scene.act；停下或強制結束時是 scene.end）。現在做不到（不是你的回合、行動點不夠、沒有連接、體位碰不到……）丟 ActionBlocked，
 * 原因一條一句（sceneOptions 一次列出每一個行動的原因）。行動點用完回合就交給對方；要提早交出去用 { kind: 'end_turn' }。
 */
export function sceneAct(k: Kernel, state: GameState, input: SceneInput, env: SceneEnv = {}): ReportDraft {
  const bad = inputProblem(input)
  if (bad) throw new ActionBlocked(bad)
  const scene = needScene(state)
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  p.talkEnv = env.talk
  // 視窗（掛點 scene.window；M4-core-gaps 第 16 項）：有功能替玩家選了，這一步做的是換掉之後的行動（玩家按停下不換）；原因記一句進紀錄
  if (input.kind !== 'stop') {
    const win = sceneWindow(k, state, p)
    if (win.replace) {
      p.line(scene.pc, win.replace.why, 'scene.override', { owner: win.replace.owner, from: input.kind, to: win.replace.input.kind })
      input = win.replace.input
    }
  }
  const blocks = p.blocks(scene.pc, input)
  if (blocks.length > 0) throw new ActionBlocked(blocks.join(''))
  p.perform(scene.pc, input)
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state), env.closing)
  if (input.kind !== 'end_turn' && p.seat(scene.pc).ap <= 0) p.passTurn(scene.pc)
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state), env.closing)
  return stepDraft(p, 'scene.act')
}

/**
 * 對方的一步（scene.next）：輪到他的時候呼叫，一次一個行動；他沒有行動可做（行動點用完）就做這一回合的結算：連接自動生效、主動權、感載消退、強制結束的檢查、
 * 新的一回合（每個人回行動點、輪到主角）。亂數是 scene/<id>/<第幾步>。結束時（對方不玩了、有人失神、回合數到了）回傳 scene.end。
 * env.moves 給了這個人的一串行動時，這一步就照那一串做（不合規的第一個起丟掉，timeline 多一拍 scene.dropped）；一個都沒做成就照規則挑一個；剩下的行動點照規則走（下一次 sceneNext）。
 */
export function sceneNext(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  if (scene.turn === scene.pc) throw new ActionBlocked('還沒輪到對方。')
  const w = scene.turn
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  p.talkEnv = env.talk
  if (scene.kind === 'group') return groupRound(state, p, env)
  const acted = pairStep(p, w, env)
  addEnvLines(p, env.lines)
  if (!p.ended && (acted === 0 || p.seat(w).ap <= 0)) p.settleRound()
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state), env.closing)
  return stepDraft(p, 'scene.next')
}

/**
 * 一對一：對方這一步（換檔、env.moves 給的一串行動、一個都沒做成就照規則挑一個）。剩下的行動點留給下一次呼叫。回傳這一步做了幾個行動。
 * sceneNext 與 sceneNpcTurn 共用。
 */
function pairStep(p: Play, w: ActorId, env: SceneEnv): number {
  p.npcTurnStart(w, env.gears?.[w] ?? (w === p.partnerId ? env.partner_gear : undefined))
  let acted = 0
  const moves = env.moves?.[w]
  if (Array.isArray(moves) && moves.length > 0) {
    const r = p.performMoves(w, moves)
    acted = r.done
    if (r.dropped > 0) p.beats.push(beat(w, '（他的幾個行動不合規，沒有照做。）', 'scene.dropped', { actor: w, dropped: r.dropped, done: r.done, reason: r.reason }))
  }
  if (acted === 0 && !p.ended) {
    const choice = p.choiceFor(w)
    if (choice) {
      p.perform(w, choice)
      acted = 1
    }
  }
  return acted
}

/**
 * 多人（kind: group）：同一圈裡一個由程式控制的人走完自己的回合（換檔、env.moves 給的一串行動、剩下的行動點照規則走，最多 MAX_MOVES 個）。
 * groupRound 與 sceneNpcTurn 共用。
 */
function groupTurn(p: Play, w: ActorId, env: SceneEnv): void {
  p.s.turn = w
  p.s.turn_began = false
  p.npcTurnStart(w, env.gears?.[w])
  const moves = env.moves?.[w]
  if (Array.isArray(moves) && moves.length > 0) {
    const r = p.performMoves(w, moves)
    if (r.dropped > 0) p.beats.push(beat(w, '（他的幾個行動不合規，沒有照做。）', 'scene.dropped', { actor: w, dropped: r.dropped, done: r.done, reason: r.reason }))
  }
  for (let i = 0; i < MAX_MOVES && !p.ended && p.inCircle(w); i++) {
    const choice = p.choiceFor(w)
    if (!choice) break
    p.perform(w, choice)
  }
}

/**
 * 多人（kind: group）的一輪：同一圈裡由程式控制的每個人照座位的順序各走完自己的回合（groupTurn），
 * 然後做這一回合的結算（連接的自動效果、別的圈各算一次、強制結束的檢查），輪到主角。一次 sceneNext 走完，後一個人依賴前一個人的結算。
 */
function groupRound(state: GameState, p: Play, env: SceneEnv): ReportDraft {
  for (const w of p.activeOthers(p.pc)) {
    if (p.ended) break
    if (!p.inCircle(w)) continue
    groupTurn(p, w, env)
  }
  addEnvLines(p, env.lines)
  if (!p.ended) p.settleRound()
  if (p.ended) return endDraft(p.k, p, p.ended, logBeats(state), env.closing)
  return stepDraft(p, 'scene.next')
}

/** env.lines：AI 給的一句動作或台詞，每人一句（只收場景裡的人、空的丟掉、最多 200 字、一個人只收第一句）。 */
function addEnvLines(p: Play, lines: SceneEnv['lines']): void {
  if (!Array.isArray(lines)) return
  const seen = new Set<string>()
  for (const l of lines) {
    if (!isRecord(l) || typeof l.who !== 'string' || typeof l.text !== 'string' || seen.has(l.who) || !p.everyone.includes(l.who)) continue
    const text = l.text.trim().slice(0, 200)
    if (!text) continue
    seen.add(l.who)
    p.line(l.who, text, 'scene.line', { source: 'scene_turn' })
  }
}

const newPlay = (k: Kernel, state: GameState, env: SceneEnv): Play => {
  const scene = needScene(state)
  return new Play(k, state, scene, env.dice ?? diceOf(state, scene))
}

/**
 * 只走一個人的回合（M4-core-gaps 第 15 項；外殼替 AI 組「前一個人做完之後」的輸入用）：who 照 sceneNext 的做法做完自己的一步——
 * 多人是他這一輪的整個回合（換檔、env.moves 給的一串行動、剩下的行動點照規則走），一對一是對方這一步（一個行動）。不做回合的結算（連接的自動效果、別的圈、強制結束的檢查），也不寫任何狀態：
 * 回傳的是做完之後的 Play。from 是前一個人做完之後的 Play（沒給就從狀態新開一個）：一個一個接下去，亂數的順序和真正的 sceneNext 一樣，所以預演出來的和真正結算時前面的人一樣。
 * env 讀 moves、gears、talk（每人一份）、dice。已經結束、不在這一圈的人不做事。
 */
export function sceneNpcTurn(k: Kernel, state: GameState, who: ActorId, env: SceneEnv = {}, from?: Play): Play {
  const p = from ?? newPlay(k, state, env)
  if (env.talk) p.talkEnv = { ...(p.talkEnv ?? {}), ...env.talk }
  if (p.ended) return p
  if (p.s.kind === 'group') {
    if (p.inCircle(who)) groupTurn(p, who, env)
  } else pairStep(p, who, env)
  return p
}

/**
 * 輪到 who 的那一刻：多人把輪到他設好、做回合開頭的處理（換檔），一對一做回合開頭的處理。問他現在合法的行動（Play.blocks）之前先呼叫它。
 * from 是前一個人做完之後的 Play（沒給就從狀態新開一個）。不寫狀態。
 */
export function sceneNpcBegin(k: Kernel, state: GameState, who: ActorId, env: SceneEnv = {}, from?: Play): Play {
  const p = from ?? newPlay(k, state, env)
  if (env.talk) p.talkEnv = { ...(p.talkEnv ?? {}), ...env.talk }
  if (p.s.kind === 'group') {
    p.s.turn = who
    p.s.turn_began = false
  }
  p.npcTurnStart(who, env.gears?.[who])
  return p
}

/**
 * 現在能不能略過（M4-core-gaps 第 17 項；畫面的確認框直接問它，不必在複本上試一次 sceneSkip）：能略過是 null，不能是原因（一句）。
 * 條件：有進行中的場景、還沒有做任何行動（第 1 回合、第 0 步）。sceneSkip 的檢查就是這一個。
 */
export function sceneCanSkip(state: GameState): string | null {
  const scene = sceneRawOf(state)
  if (!scene) return '現在沒有進行中的成人場景。'
  return scene.step !== 0 || scene.round !== 1 ? '場景已經開始了，只能按「停下」結束。' : null
}

/**
 * 進行中的場景還原成開場的設定（startProblems 要的形狀）：誰是對象、哪幾圈、性質、身分、目的、地點、標籤、模式、現實或內海、最多幾回合、單人與有沒有人在看。
 * 只翻譯欄位的名字，不判斷任何事（M4-core-gaps 第 17 項：以前畫面自己還原）。
 */
export function sceneSetupOf(raw: SceneRaw): Record<string, unknown> {
  const others = raw.seats.filter((x) => x.id !== raw.pc).map((x) => x.id)
  const common: Record<string, unknown> = {
    role: raw.role, goal: raw.goal ?? 'none', tags: [...raw.tags], mode: raw.mode, layer: raw.layer,
    ...(raw.place ? { place: raw.place } : {}), ...(raw.dream ? { dream: true } : {}), ...(raw.amnesia ? { amnesia: true } : {}), ...(raw.max_rounds !== undefined ? { max_rounds: raw.max_rounds } : {}),
  }
  if (raw.kind === 'solo') return { ...common, solo: true, audience: raw.audience === true }
  const circles = raw.circles.map((c) => [...c.people, ...(c.out ?? [])])
  return { ...common, nature: raw.nature, ...(circles.length > 0 ? { circles: [[raw.pc, ...others], ...circles] } : { with: others }) }
}

/**
 * 開場確認框的摘要（這一場的 startProblems 摘要：誰、性質、身分、目的、會碰到的標籤、是不是單人、在哪一層）：由場景的狀態還原設定、在沒有這一場的狀態上問一次。
 * 沒有進行中的場景、或問不出來是 null（M4-core-gaps 第 17 項）。
 */
export function sceneGateSummary(k: Kernel, state: GameState): StartSummary | null {
  const raw = sceneRawOf(state)
  if (!raw) return null
  const probe = clone(state)
  delete probe.ext[EXT]
  return startProblems(k, probe, sceneSetupOf(raw)).summary ?? null
}

/** 略過（LEWD_SYSTEM 3.1 節）：還沒做任何行動時，照雙方的數值直接算出契合，體悟打七折。回傳 scene.end。 */
export function sceneSkip(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  const why = sceneCanSkip(state)
  if (why) throw new ActionBlocked(why)
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  const r = p.rules.skip
  // 單人：節奏 = 略過公式的基底加亂數（沒有對象的幾項不算）
  if (p.solo) {
    const sk = p.rules.solo.skip
    p.s.pace = Math.max(0, Math.min(100, sk.base + p.dice.int(0, sk.spread - 1)))
    if (p.s.goal !== null) p.s.goal_progress = Math.max(p.s.goal_progress ?? 0, p.s.pace)
    p.line(p.pc, '這一場略過了：寫成一段敘事，自動結算。', 'skip')
    return endDraft(k, p, 'skip', [], env.closing)
  }
  const roll = (shared: number, sens: number): number => Math.max(0, Math.min(100, r.base + shared * r.per_tag + Math.round((sens - 50) / r.sens_div) + p.dice.int(0, r.spread - 1)))
  // 每一對照自己的數值各算一次；別的圈用圈裡共同的標籤數與平均的敏感度
  for (const x of p.activeOthers(p.pc)) p.s.pairs[x]!.fit = roll(tendencyTagIds(p.actor(p.pc)).filter((t) => hasTendencyTag(p.actor(x), t)).length, p.sens[x]!)
  for (const c of p.s.circles) {
    if (c.people.length === 0) continue
    const shared = tendencyTagIds(p.actor(c.people[0]!)).filter((t) => c.people.every((id) => hasTendencyTag(p.actor(id), t))).length
    c.fit = roll(shared, c.people.reduce((a, id) => a + p.sens[id]!, 0) / c.people.length)
  }
  const fits = Object.values(p.s.pairs).map((x) => x.fit)
  if (p.s.goal !== null) p.s.goal_progress = Math.min(p.rules.skip_goal.cap, p.rules.skip_goal.base + Math.floor(Math.round(fits.reduce((a, b) => a + b, 0) / Math.max(1, fits.length)) / 2))
  p.line(p.pc, '這一場略過了：寫成一段敘事，自動結算。', 'skip')
  return endDraft(k, p, 'skip', [], env.closing)
}

/** 被外面的事打斷（事件、追兵、時間到了的工作）：強制結束，照現在的樣子結算。留給別的功能呼叫的入口。 */
export function sceneInterrupt(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  p.line(p.pc, '被外面的事打斷了。', 'interrupt')
  return endDraft(k, p, 'interrupted', logBeats(state), env.closing)
}

/** 輪到誰（舊名字：'pc' 是主角、'partner' 是別人；畫面決定要不要呼叫 sceneNext）；沒有場景是 null。要角色的 id 讀 sceneRawOf(state).turn。 */
export function sceneTurn(state: GameState): Who | null {
  const s = sceneRawOf(state)
  return s ? (s.turn === s.pc ? 'pc' : 'partner') : null
}

// ---- 活動與功能 ----

const sceneActivity: ActivityDef = {
  kind: ACTIVITY, owner: OWNER, order: 20,
  active: (s) => {
    const x = sceneRawOf(s)
    return x ? { id: x.id, label: '成人場景' } : null
  },
  // 場景自己的報告（結束那一份走 commitNarrated 也是 commit:scene.end）；別的功能要在場景裡做的事自己 k.activity.allow
  allow: ['commit:scene.'],
  reason: (_s, doing) => (doing.startsWith(`${ACTIVITY}.start`) ? '已經有一場成人場景在進行，先把它結束。' : '成人場景進行中：先按「停下」結束這一場，才能做別的事。'),
  start: (k, state, setup, origin) => startScene(k, state, setup, origin),
}

/** 來源 night：場景進行中、這個人在場時，共鳴給的感載上限（沒有共鳴的資料或 load_cap 是 0 就沒有）。 */
function nightPassives(k: Kernel, state: GameState, actor: string): PassiveEffect[] {
  const s = sceneRawOf(state)
  if (!s || !state.actors[actor]) return []
  const here = s.seats.some((x) => x.id === actor) || s.circles.some((c) => c.people.includes(actor) || (c.out ?? []).includes(actor))
  if (!here) return []
  const n = resonanceOf(k, state, actor, s.kind === 'solo').load_cap
  return n !== 0 ? [{ stat: 'load_cap', amount: n }] : []
}

export const sceneFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind<PositionEntry>({
      kind: POSITION_KIND, owner: OWNER, validate: positionProblems,
      refs: (e) => (typeof e.unlocked_by === 'string' ? [[SKILL_KIND, e.unlocked_by]] : []),
    })
    k.content.defineKind({ kind: SKILL_KIND, owner: OWNER, validate: skillProblems })
    // 夜課的共鳴（M4-nightclass；每個分支開到第幾階就有幾個）：場景開始時照每個人開到的階生效（night.ts）
    k.content.defineKind({ kind: RESONANCE_KIND, owner: OWNER, validate: resonanceProblems })
    // 夜課共鳴的感載上限（身體 2 階：成人場景裡 +4；M4-followups-2 第 11 項）：場景進行時這個人（在場的）這一筆經被動效果的來源 night 給衍生數值 load_cap，
    // 數字和 Play 用的是同一個（resonanceOf）；場景以外不給（設計書：共鳴只在成人場景裡有效）。Play 自己算場景的感載上限時先把這一筆扣掉、再加共鳴，所以兩邊不會算兩次。
    // 曝露度的加成（扮相 4 階 tease_exposure）是挑逗時才算的一個式子，不是屬性、衍生數值、檢定、戰鬥修正或標籤其中一種，仍直接算在場景裡
    k.passives.register(OWNER, 'night', (state, actor) => nightPassives(k, state, actor), '夜課的功夫')
    // 單人姿勢（內建五個；資料寫同一個 id 換掉、寫新的 id 多一個）
    k.content.defineKind({ kind: SOLO_POSE_KIND, owner: OWNER, validate: soloPoseProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 體悟（LEWD_SYSTEM 第 10 節）：單一、0 起、沒有上限。AI 一件事只能加（0～+5）、不能扣（EVENTS 2.4 節；使用者 2026-11-24 裁決，dev/adr/0017 最後一批的補記）。
    // 成人場景收尾照契合給的 5～20 點是內建的結算，不受這張表管
    k.meters.define({ kind: 'insight', owner: OWNER, name: '體悟', min: 0, max: Infinity, start: 0, keyed: 'none', cap: { down: 0, up: 5 } })

    k.activity.define(sceneActivity)

    // 條件 partnered { not? }（M4-night-resonance）：這個人有固定的伴——性經歷裡有「最喜歡的人」而且不是 not、或是契約人（actor.ext.identity.class 是 bound）。
    // 技能的 needs 用 { kind: 'target', of: { kind: 'partnered' } } 問對方（not 自動是用的那個人）。交往的關係（親密度的階段）這裡看不到，不算
    k.conditions.register<Condition & { not?: string }>({
      kind: 'partnered', owner: OWNER,
      validate: (raw) => (raw.not === undefined || (typeof raw.not === 'string' && raw.not.trim()) ? [] : ['not 要是角色的 id']),
      test(c, ctx) {
        const a = ctx.state.actors[ctx.actor ?? ctx.state.pc ?? '']
        if (!a) return false
        const fav = sexRecordOf(a).favorite
        if (typeof fav === 'string' && fav !== '' && fav !== c.not) return true
        const identity = isRecord(a.ext.identity) ? a.ext.identity : {}
        return identity.class === 'bound'
      },
    })

    // 網內的行程被強制結束（被定位、斷線、登出）：進行中的內海場景跟著被打斷、照現在的樣子結算（M4-scene-net；夢不跟著走）。
    // 結算併進那一份結束的報告：變更、句子、launch 與 rewind 都交給它
    k.hooks.on('activity.end', OWNER, ({ state, kind }) => {
      if (!(NET_ACTIVITIES as readonly string[]).includes(kind)) return
      const s = sceneRawOf(state)
      if (!s || s.layer !== 'net' || s.dream === true) return
      const d = sceneInterrupt(k, state)
      return { changes: d.changes, lines: d.narration?.results ?? [], launch: d.launch ?? [], ...(d.rewind ? { rewind: d.rewind } : {}) }
    })

    // 回到快照之後性經歷留著（工單；AI_TASKS 第 1 節：場景之後的紀錄不隨回退消失）
    k.hooks.on('rewind.keep', OWNER, ({ current, restored }) => {
      const out = []
      for (const [id, a] of Object.entries(current.actors)) {
        const rec = a.ext.sex_record
        const back = restored.actors[id]
        if (rec === undefined || !back || JSON.stringify(rec) === JSON.stringify(back.ext.sex_record)) continue
        out.push({ op: 'actor.ext', id, key: 'sex_record', value: clone(rec) })
      }
      return out.length > 0 ? out : undefined
    })
  },

  ready(k: Kernel) {
    const problems: string[] = []
    const positions = new Set([...k.content.list(POSITION_KIND).map((e) => e.id), ...soloPoses(k).map((x) => x.id)])
    const check = (kind: string, id: string, raw: unknown, item: boolean): void => {
      const r = readSceneDef(raw, item)
      if ('problems' in r) problems.push(...r.problems.map((x) => `${kind}/${id}：${x}`))
      else for (const pos of r.def.positions ?? []) if (!positions.has(pos)) problems.push(`${kind}/${id}：scene.positions 查不到體位 ${pos}`)
    }
    // 物品的 scene 欄位（核心的 item 種類不認得它，這裡補查）
    for (const e of k.content.list('item')) if (e.scene !== undefined) check('item', e.id, e.scene, true)
    for (const e of k.content.list(SKILL_KIND)) if (e.scene !== undefined) check(SKILL_KIND, e.id, e.scene, false)
    if (problems.length > 0) throw new ContentError(problems)
  },
}
