// L6 功能：成人場景的最小可操作版（LEWD_SYSTEM 第 3 節，3.5 節是完整的規則；DATA 第 3 節、第 4 節 adult_scene；CORE_RULES 4.2 節；UI 第 10 節；
// dev/adr/0016 第一、二節、G6、G11；dev/work/M2-scene.md）。
//
// 一種活動 scene（order 20）：一對一、回合制。行動點、感載與餘韻、契合、主動權、體位、部位與連接、目的的進度；玩家按「停下」才結束（或三種強制結束），
// 結束之後一次結算。所有參與者都是成年人（核心的底線在提交與讀檔時擋）。
// 沒有每回合的 AI：對方的行動與說話的判定走規則（sceneNext、說話用骰子）；AI 只在結束之後寫整場的正文（報告帶 adult: true，外殼用 commitNarrated 走成人路由）。
// 每回合只有一句中性的動作描述（state.ext.scene.lines）；不寫任何露骨的文字。
//
// 兩種模式（設定 scene_mode，預設 simple；setSceneMode(k, mode)；下一場生效）：規則與數字完全相同，差別只在誰來選部位：精簡版用技能、道具、說話時沒給部位由引擎挑
//（技能寫的部位裡空著的優先、有標籤的部位優先、都佔著就換掉最早的一條），切換體位之後把能接的接回去；完整版要玩家自己選部位。兩種都是一對一。
//
// 接上核心的地方：
//   內容  position（DATA 3.2；M2 只收 people: 2）、night_skill（DATA 3.1；M2 只用 scene、tag、tags、name）、scene_rule（id: default，規則的數字蓋掉內建的）；
//         物品多讀一個 scene 欄位（DATA 3.3，載入之後 ready 查格式）
//   活動  scene（setup 見 SceneSetup；放行 commit:scene.）；結束時發 activity.end（result: { with, fit, rating, goal, goal_done, reason }）
//   量表  insight（體悟；單一、0 起、沒有上限；同名的效果與條件核心自動有）
//   狀態  state.ext.scene（見 model.ts 的 SceneState）；actor.ext.scene（誰會什麼：positions、skills；選填 parts、part_tags）；actor.ext.sex_record（性經歷）
//   掛鉤  rewind.keep：回到快照之後性經歷留著
//   讀別人的  actor.ext.bridge、actor.ext.tendency（只認格式）、k.stats（ap_max、load_cap、afterglow_cap、bridge_sensitivity、bridge_docility；沒有人註冊就照設計書的公式）、
//            k.content（item）、state.inventory、效果 affinity／bridge／tendency（沒有人註冊的略過）
// 報告：scene.start、scene.act、scene.next（對方的一步與回合的結算）、scene.end（adult: true、kind social；強制結束與略過也是它）。
//
// 對外：sceneStart／startProblems、sceneAct、sceneNext、sceneSkip、sceneInterrupt、sceneView、sceneOptions、scenePreview、sceneOf、setSceneMode。

import type { Feature, GameState, Kernel, Origin, ReportDraft } from '../../core'
import { ActionBlocked, ContentError, clone, isRecord } from '../../core'
import type { ActivityDef } from '../../core'
import { endDraft, logBeats, sceneDraft, stepDraft } from './end'
import type { Dice, Goal, Nature, PositionEntry, Role, SceneMode, SceneState, Who } from './model'
import {
  ACTIVITY, EXT, GOALS, NATURES, NATURE_FILTER, NATURE_NAME, OWNER, POSITION_KIND, ROLES, RULE_KIND, SKILL_KIND, beat, docilityOf, hasTendencyTag, isGoal, isMode, isNature, isRole,
  knownPositions, positionProblems, readSceneDef, ruleProblems, sceneModeOf, sceneOf, sceneRules, sexRecordOf, skillProblems, tendencyTagIds,
} from './model'
import type { SceneInput } from './play'
import { Play, diceOf, inputProblem } from './play'

export * from './model'
export type { Preview, PreviewLoad, SceneInput, PartPick } from './play'
export { Play } from './play'
export { sceneOptions, scenePreview, sceneView } from './view'
export type { ActionOption, ChoiceOption, LinkView, PartView, PersonView, ScenePick, ScenePickOption, ScenePair, SceneOptions, SceneView } from './view'

/** 測試用：換掉骰子（拿到一個 int(min, max) 的東西）。沒給就照存檔的亂數導出：同一個種子、同樣的行動序列，結果一樣。 */
export interface SceneEnv { dice?: Dice }

/** 開場景的設定：事件帶出來的是 DATA 第 4 節的 adult_scene 原樣（沒有 with，對象從 circles[0] 去掉主角取得）；委託、俘虜等用 with。 */
export interface SceneSetup {
  /** 對象（M2 剛好一個） */
  with?: string[]
  /** DATA 第 4 節的分圈：M2 只收一圈、主角加一個人 */
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
  [more: string]: unknown
}

const one = (what: string): string => `這一版的成人場景只有一對一（${what}）。`

interface Parsed {
  pc: string
  partner: string
  nature: Nature
  role: Role
  goal: Goal | null
  place?: string
  tags: string[]
  mode: SceneMode
  start?: string
}

/** 開場景的條件：一條一句；空的就是開得成。 */
export function startProblems(k: Kernel, state: GameState, setup: unknown): { problems: string[]; parsed?: Parsed } {
  const p: string[] = []
  if (sceneOf(state)) return { problems: ['已經有一場成人場景在進行，先把它結束。'] }
  const s = isRecord(setup) ? setup : null
  if (!s) return { problems: ['場景要有設定：{ with 或 circles, nature, ... }。'] }
  const pc = state.pc
  if (!pc || !state.actors[pc]) p.push('還沒有主角，開不起場景。')
  let partner = ''
  if (Array.isArray(s.with)) {
    if (s.with.length !== 1) p.push(one('with 要剛好一個人'))
    else partner = String(s.with[0])
  } else if (Array.isArray(s.circles) && s.circles.length > 0) {
    if (s.circles.length > 1) p.push(one('不分圈'))
    else {
      const c = Array.isArray(s.circles[0]) ? (s.circles[0] as unknown[]).map(String) : []
      const others = c.filter((x) => x !== pc)
      if (others.length !== 1) p.push(one('這一圈要剛好主角加一個人'))
      else partner = others[0]!
    }
  } else p.push('場景要寫對象：with 或 circles。')
  if (partner) {
    if (partner === pc) p.push('對象不能是主角自己。')
    else if (!state.actors[partner]) p.push(`找不到對象（${partner}）：場景的對象要是已經在場的人。`)
  }
  if (!isNature(s.nature)) p.push(`性質（nature）要是 ${NATURES.join('、')} 其中一個。`)
  if (s.role !== undefined && !isRole(s.role)) p.push(`身分（role）要是 ${ROLES.join('、')} 其中一個。`)
  if (s.goal !== undefined && s.goal !== 'none' && !isGoal(s.goal)) p.push(`目的（goal）要是 ${GOALS.join('、')} 或 none。`)
  const mode = s.mode !== undefined ? s.mode : sceneModeOf(k)
  if (!isMode(mode)) p.push('mode 要是 full 或 simple。')
  const filter = isNature(s.nature) ? NATURE_FILTER[s.nature] : undefined
  if (filter && state.rules.contentOff.includes(filter.tag)) p.push(`「${filter.name}」被你的內容篩選關掉了，這一種場景開不起來。`)
  if (p.length === 0 && knownBoth(k, state, pc!, partner).length === 0) p.push('資料裡沒有雙方都會的兩人體位，場景開不起來。')
  if (p.length > 0) return { problems: p }
  const tags = Array.isArray(s.tags) ? [...new Set((s.tags as unknown[]).filter((t): t is string => typeof t === 'string' && !!t && !state.rules.contentOff.includes(t)))] : []
  return {
    problems: [],
    parsed: {
      pc: pc!, partner, nature: s.nature as Nature, role: (s.role as Role | undefined) ?? 'none', goal: s.goal === undefined || s.goal === 'none' ? null : (s.goal as Goal), tags, mode: mode as SceneMode,
      ...(typeof s.place === 'string' && s.place ? { place: s.place } : {}), ...(typeof s.start_position === 'string' ? { start: s.start_position } : {}),
    },
  }
}

/** 雙方都會的兩人體位：基本的（每個人都會）在前，照內容的順序。 */
function knownBoth(k: Kernel, state: GameState, a: string, b: string): PositionEntry[] {
  const mine = new Set(knownPositions(k, state, a).map((x) => x.id))
  const list = knownPositions(k, state, b).filter((x) => mine.has(x.id))
  return [...list.filter((x) => (x.unlocked_by ?? null) === null), ...list.filter((x) => (x.unlocked_by ?? null) !== null)]
}

/** 開場的主動權：50 ＋（對方的馴化 − 自己的馴化）÷ 4，再照性質與身分調整（LEWD_SYSTEM 3.5 節第二點）。 */
export function openingInit(k: Kernel, state: GameState, o: { pc: string; partner: string; nature: Nature; role: Role }): number {
  const r = sceneRules(k)
  // 性質是工作而沒寫身分，主角就是工作的人；work 的 −20 由身分給，不算兩次
  const role: Role = o.role === 'none' && o.nature === 'work' ? 'worker' : o.role
  const v = r.init_base + (docilityOf(k, state, o.partner) - docilityOf(k, state, o.pc)) / r.init_docility_div + r.nature_init[o.nature] + r.role_init[role]
  return Math.max(0, Math.min(100, Math.round(v)))
}

const needScene = (state: GameState): SceneState => {
  const s = sceneOf(state)
  if (!s) throw new ActionBlocked('現在沒有進行中的成人場景。')
  return s
}

function startScene(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[] {
  const r = startProblems(k, state, setup)
  if (!r.parsed) throw new ActionBlocked(r.problems.join(''))
  const o = r.parsed
  const rules = sceneRules(k)
  const scene: SceneState = {
    id: `sc${state.seq.uid + 1}`, mode: o.mode, pc: o.pc, partner: o.partner, nature: o.nature, role: o.role, goal: o.goal, ...(o.place ? { place: o.place } : {}), tags: o.tags,
    round: 1, turn: 'pc', step: 0, ap: { pc: 0, partner: 0 }, fit: rules.fit_start, init: openingInit(k, state, o), goal_progress: o.goal ? 0 : null,
    position: '', roles: { pc: '', partner: '' }, links: [], link_seq: 0, teased: { pc: false, partner: false }, restrained: { pc: false, partner: false },
    climax: { pc: 0, partner: 0 }, received: { pc: 0, partner: 0 }, used_positions: [], touched: [...o.tags], lines: [],
    first_person: sexRecordOf(state.actors[o.pc]).people[o.partner] === undefined, origin: clone(origin),
  }
  const p = new Play(k, state, scene, diceOf(state, scene))
  p.s.ap = { pc: p.apMax.pc, partner: p.apMax.partner }
  // 起始的體位：寫了而且雙方都會就用它；沒寫（或不能用）就挑第一個基本的
  const both = knownBoth(k, state, o.pc, o.partner)
  const start = (o.start ? both.find((x) => x.id === o.start) : undefined) ?? both[0]!
  p.enter(start, p.holder())
  const name = state.actors[o.partner]!.name
  const text = `你和${name}進入了這一場（${NATURE_NAME[o.nature]}${o.place ? `，${o.place}` : ''}）。`
  const d = sceneDraft(state, p, 'scene.start', [beat(o.pc, text, 'scene.start', { with: o.partner, nature: o.nature, position: start.id })], [{ op: 'uid', advance: 1 }, { op: 'ext', key: EXT, value: clone(p.s) }], 'start', text)
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
  const blocks = p.blocks('pc', input)
  if (blocks.length > 0) throw new ActionBlocked(blocks.join(''))
  p.perform('pc', input)
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state))
  if (input.kind !== 'end_turn' && p.s.ap.pc <= 0) p.s.turn = 'partner'
  return stepDraft(p, 'scene.act')
}

/**
 * 對方的一步（scene.next）：輪到他的時候呼叫，一次一個行動；他沒有行動可做（行動點用完）就做這一回合的結算：連接自動生效、主動權、感載消退、強制結束的檢查、
 * 新的一回合（雙方回行動點、輪到主角）。亂數是 scene/<id>/<第幾步>。結束時（對方不玩了、有人失神）回傳 scene.end。
 */
export function sceneNext(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  if (scene.turn !== 'partner') throw new ActionBlocked('還沒輪到對方。')
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  const choice = p.partnerChoice()
  if (choice) p.perform('partner', choice)
  if (!p.ended && (!choice || p.s.ap.partner <= 0)) p.settleRound()
  if (p.ended) return endDraft(k, p, p.ended, logBeats(state))
  return stepDraft(p, 'scene.next')
}

/** 略過（LEWD_SYSTEM 3.1 節）：還沒做任何行動時，照雙方的數值直接算出契合，體悟打七折。回傳 scene.end。 */
export function sceneSkip(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  if (scene.step !== 0 || scene.round !== 1) throw new ActionBlocked('場景已經開始了，只能按「停下」結束。')
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  const r = p.rules.skip
  const shared = tendencyTagIds(p.actor('pc')).filter((t) => hasTendencyTag(p.actor('partner'), t)).length
  p.s.fit = Math.max(0, Math.min(100, r.base + shared * r.per_tag + Math.round((p.sens.partner - 50) / r.sens_div) + p.dice.int(0, r.spread - 1)))
  if (p.s.goal !== null) p.s.goal_progress = Math.min(p.rules.skip_goal.cap, p.rules.skip_goal.base + Math.floor(p.s.fit / 2))
  p.line('pc', '這一場略過了：寫成一段敘事，自動結算。', 'skip')
  return endDraft(k, p, 'skip', [])
}

/** 被外面的事打斷（事件、追兵、時間到了的工作）：強制結束，照現在的樣子結算。留給別的功能呼叫的入口。 */
export function sceneInterrupt(k: Kernel, state: GameState, env: SceneEnv = {}): ReportDraft {
  const scene = needScene(state)
  const p = new Play(k, state, scene, env.dice ?? diceOf(state, scene))
  p.line('pc', '被外面的事打斷了。', 'interrupt')
  return endDraft(k, p, 'interrupted', logBeats(state))
}

/** 輪到誰（畫面決定要不要呼叫 sceneNext）；沒有場景是 null。 */
export function sceneTurn(state: GameState): Who | null {
  return sceneOf(state)?.turn ?? null
}

// ---- 活動與功能 ----

const sceneActivity: ActivityDef = {
  kind: ACTIVITY, owner: OWNER, order: 20,
  active: (s) => {
    const x = sceneOf(s)
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
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 體悟（LEWD_SYSTEM 第 10 節）：單一、0 起、沒有上限。AI 一件事只能加（0～+5）、不能扣（EVENTS 2.4 節；使用者 2026-11-24 裁決，dev/adr/0017 最後一批的補記）。
    // 成人場景收尾照契合給的 5～20 點是內建的結算，不受這張表管
    k.meters.define({ kind: 'insight', owner: OWNER, name: '體悟', min: 0, max: Infinity, start: 0, keyed: 'none', cap: { down: 0, up: 5 } })

    k.activity.define(sceneActivity)

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
    const positions = new Set(k.content.list(POSITION_KIND).map((e) => e.id))
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
