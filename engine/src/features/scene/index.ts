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
//   量表  insight（體悟；單一、0 起、沒有上限；同名的效果與條件核心自動有）
//   狀態  state.ext.scene（見 model.ts 的 SceneState）；actor.ext.scene（誰會什麼：positions、skills；選填 parts、part_tags）；actor.ext.sex_record（性經歷）
//   掛鉤  rewind.keep：回到快照之後性經歷留著；scene.body（這個功能宣告：義體、調校、內海的化身回答多出來的部位、各部位的敏感度修正與標籤）
//   讀別人的  actor.ext.bridge、actor.ext.tendency（只認格式）、k.stats（ap_max、load_cap、afterglow_cap、bridge_sensitivity、bridge_docility；沒有人註冊就照設計書的公式）、
//            k.content（item）、state.inventory、效果 affinity／bridge／tendency（沒有人註冊的略過）
// 報告：scene.start、scene.act、scene.next（對方的一步與回合的結算）、scene.end（adult: true、kind social；強制結束與略過也是它）。
//
// 對外：sceneStart／startProblems（開場的摘要）、sceneAct、sceneNext、sceneSkip、sceneInterrupt、sceneView、sceneOptions、scenePreview、sceneOf（舊名字外觀）、sceneRawOf（第二版的原樣）、setSceneMode。
// 外面來的東西（SceneEnv）：dice、moves（外殼從 scene_turn 拿到的某個人這一步的一串行動）、talk（scene_talk 的結果）、gears（每個人這一步換到哪一檔；partner_gear 是舊的鍵）。

import type { ActorId, Feature, GameState, Kernel, Origin, ReportDraft, SyncGear } from '../../core'
import { ActionBlocked, ContentError, clone, isRecord } from '../../core'
import type { ActivityDef } from '../../core'
import { endDraft, logBeats, sceneDraft, stepDraft } from './end'
import type { CircleRec, Dice, Goal, Nature, PositionEntry, Role, SceneKind, SceneMode, SceneRaw, Who } from './model'
import {
  ACTIVITY, EXT, GENDER_FILTER, GOALS, GOAL_NAME, LAYERS, NATURES, NET_ACTIVITIES, NATURE_FILTER, NATURE_NAME, NTR_FILTER, OWNER, POSITION_KIND, ROLES, ROLE_NAME, RULE_KIND, SKILL_KIND, SOLO_POSE_KIND, beat,
  genderIn, hasTendencyTag, isGoal, isMode, isNature, isRole, knownAll, openingInit, positionProblems, readSceneDef, ruleProblems, sceneModeOf, sceneRawOf, sceneRules, sexRecordOf, skillProblems, soloPoseProblems, soloPoses, startGear, tendencyTagIds,
} from './model'
import type { RevealView } from './night'
import { RESONANCE_KIND, resonanceProblems, revealFor } from './night'
import type { SceneInput, TalkEnv } from './play'
import { MAX_MOVES, Play, diceOf, inputProblem } from './play'

export * from './model'
export * from './legacy'
export type { Resonance, RevealView } from './night'
export { BRANCHES, RESONANCE_KIND, knowFor, npcKnow, resonanceOf } from './night'
export type { Preview, PreviewLoad, SceneInput, PartPick, TalkEnv } from './play'
export { Play, MAX_MOVES } from './play'
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
  /** scene_talk 的結果：這一步是說話時有給就用它（契合夾在 −5～+10、目的的進度夾在 0～+20），不擲檢定；沒給照現有的檢定 */
  talk?: TalkEnv
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
    layer, ...(dream ? { dream: true } : {}),
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
  for (const id of o.seated) pairs[id] = { fit: rules.fit_start, init: openingInit(k, state, { pc: o.pc, partner: id, nature: o.nature, role: o.role }), first: sexRecordOf(state.actors[o.pc]).people[id] === undefined }
  const scene: SceneRaw = {
    v: 2, id: `sc${state.seq.uid + 1}`, mode: o.mode, kind: kindOf(o), layer: o.layer, pc: o.pc, nature: o.nature, role: o.role, goal: o.goal, ...(o.place ? { place: o.place } : {}), tags: o.tags,
    round: 1, turn: o.pc, step: 0, seats: [seat(o.pc), ...o.seated.map(seat)], pairs,
    goal_progress: o.goal ? 0 : null, position: '', roles: {}, links: [], link_seq: 0, turn_began: false,
    used_positions: [], touched: [...o.tags], lines: [], origin: clone(origin), circles, ...(o.max_rounds !== undefined ? { max_rounds: o.max_rounds } : {}),
    ...(solo ? { pace: rules.solo.pace_start, audience: o.audience === true } : {}),
    ...(o.dream ? { dream: true as const } : {}),
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
  const blocks = p.blocks(scene.pc, input)
  if (blocks.length > 0) throw new ActionBlocked(blocks.join(''))
  p.perform(scene.pc, input)
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state))
  if (input.kind !== 'end_turn' && p.seat(scene.pc).ap <= 0) p.passTurn(scene.pc)
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state))
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
  if (!p.ended && (acted === 0 || p.seat(w).ap <= 0)) p.settleRound()
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state))
  return stepDraft(p, 'scene.next')
}

/**
 * 多人（kind: group）的一輪：同一圈裡由程式控制的每個人照座位的順序各走完自己的回合（換檔、env.moves 給的一串行動、剩下的行動點照規則走），
 * 然後做這一回合的結算（連接的自動效果、別的圈各算一次、強制結束的檢查），輪到主角。一次 sceneNext 走完，後一個人依賴前一個人的結算。
 */
function groupRound(state: GameState, p: Play, env: SceneEnv): ReportDraft {
  for (const w of p.activeOthers(p.pc)) {
    if (p.ended) break
    if (!p.inCircle(w)) continue
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
  if (!p.ended) p.settleRound()
  if (p.ended) return endDraft(p.k, p, p.ended, logBeats(state))
  return stepDraft(p, 'scene.next')
}

/** 略過（LEWD_SYSTEM 3.1 節）：還沒做任何行動時，照雙方的數值直接算出契合，體悟打七折。回傳 scene.end。 */
export function sceneSkip(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  if (scene.step !== 0 || scene.round !== 1) throw new ActionBlocked('場景已經開始了，只能按「停下」結束。')
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  const r = p.rules.skip
  // 單人：節奏 = 略過公式的基底加亂數（沒有對象的幾項不算）
  if (p.solo) {
    const sk = p.rules.solo.skip
    p.s.pace = Math.max(0, Math.min(100, sk.base + p.dice.int(0, sk.spread - 1)))
    if (p.s.goal !== null) p.s.goal_progress = Math.max(p.s.goal_progress ?? 0, p.s.pace)
    p.line(p.pc, '這一場略過了：寫成一段敘事，自動結算。', 'skip')
    return endDraft(k, p, 'skip', [])
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
  return endDraft(k, p, 'skip', [])
}

/** 被外面的事打斷（事件、追兵、時間到了的工作）：強制結束，照現在的樣子結算。留給別的功能呼叫的入口。 */
export function sceneInterrupt(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  p.line(p.pc, '被外面的事打斷了。', 'interrupt')
  return endDraft(k, p, 'interrupted', logBeats(state))
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
    // 單人姿勢（內建五個；資料寫同一個 id 換掉、寫新的 id 多一個）
    k.content.defineKind({ kind: SOLO_POSE_KIND, owner: OWNER, validate: soloPoseProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 體悟（LEWD_SYSTEM 第 10 節）：單一、0 起、沒有上限。AI 一件事只能加（0～+5）、不能扣（EVENTS 2.4 節；使用者 2026-11-24 裁決，dev/adr/0017 最後一批的補記）。
    // 成人場景收尾照契合給的 5～20 點是內建的結算，不受這張表管
    k.meters.define({ kind: 'insight', owner: OWNER, name: '體悟', min: 0, max: Infinity, start: 0, keyed: 'none', cap: { down: 0, up: 5 } })

    k.activity.define(sceneActivity)

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
