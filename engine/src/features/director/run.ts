// L6 功能：事件視窗的執行器（活動 event；EVENTS 2.1、2.3、2.4、3.6、第 5 節；dev/adr/0016 第一、四節；dev/work/M2-event-run.md）。
//
// 一件事件（資料裡的，或別的功能當場給的內嵌整筆）開起來、列出選項、擲檢定、照成功程度結算效果、多段的走到下一段、做完交回給發起的人。
// 導演（index.ts）放行擋住型的事件時用 k.activity.start(k, state, 'event', { event: id }, { by: 'director', ... }) 開它；
// 別的功能（掃橋、俘虜、戰敗、打工、升階）用 { inline: 一件事件 } 或 launch 開它，做完從 activity.end 拿到 { event, option, degree, flags, stage }。
//
// 對外的純函式（不改狀態，回傳報告草稿，由介面交給 Game.commit 或 commitNarrated）：
//   eventView(k, state)               畫面要的全部：正文、每個選項（看不看得到、選不了的原因、檢定與成功率、誰擲）、登場角色
//   chooseOption(k, state, id)        選一個選項：擲檢定、結算效果、換段或收尾（回傳 event.choose 或 event.close）
// 開始（event.open）在活動的 start；自由回應（玩家在事件開著時直接做自由行動）在 report.after：那一份自由行動套用之後，事件以 option 'free' 收尾。
//
// 接上核心的地方：
//   活動  event（order 30；放行 commit:event.、chain:free_action；別的功能要在事件開著時照常做的事用 k.activity.allow('event', 前綴, 自己的 id) 加進來）
//   內容  事件的內文檢查（addEventBodyCheck；body.ts）：效果的種類要有人註冊、指示只能是 fight、chain、start、inherit 指得到、版本至少有 default、chain 只連一層
//   掛點  director.cast（這個功能宣告）：開的時候對每個 cast 問一次，npcs 之類的功能回答是誰；沒有人答的用一個只有名字的臨時角色（ext.event_temp: true）
//   狀態  state.ext.director.open（OpenEvent）：和導演的狀態在同一個 ext 鍵，導演改寫自己的部分時原樣帶著（flow.ts 的 takeOpen）
// 報告：event.open、event.choose、event.close（kind 都是 event）；activity.end 的 result：{ event, option, degree?, flags, stage, version }。
//
// 這一張刻意不收的（見完成回報）：adult_soft、事件開頭由 AI 改寫、deadline（契約指令與鉤子）。

import type { Actor, ActivityDef, Change, CheckRoll, Condition, Degree, Feature, GameState, Kernel, Launch, Origin, ReportDraft, RollPart, TimelineBeat } from '../../core'
import {
  ASSIST_BONUS, ASSIST_MIN_SKILL, ATTR_IDS, ActionBlocked, DEGREE_NAME, checkParts, clone, computeDegree, dcFor, effectCtx, endActivity, isRecord, rollCheck, tagsAllowed, attachActivityEnd,
} from '../../core'
import type { CheckSpec, EventBodyFields, OptionDef, ResolvedBody, ResolvedStage, SceneSpec } from './body'
import { eventBodyProblems, hasChain, isDirective, normalCheck, outcomeList, resolveBody, sceneWhenMatches, substitute } from './body'
import type { ScopeEntry } from './model'
import { EVENT_KIND, EXT, SCOPE_KIND, addEventBodyCheck, directorOf, eventRules } from './model'

export const EVENT_RUN_OWNER = 'event_run'
export const EVENT_ACTIVITY = 'event'
/** 選了「我要做別的」收尾時，activity.end 的 result.option。 */
export const FREE_OPTION = 'free'
/** 自由回應的那條任務鏈（核心的 free_action）。 */
const FREE_CHAIN = 'free_action'
/** 登場角色的代號 pc 指主角。 */
const PC_ROLE = 'pc'
/** 沒有人回答、也沒寫名字的登場角色叫什麼。 */
const NAMELESS = '路人'
/** 擲檢定時帶的標籤，特質與狀態的修正看得到。 */
const EVENT_TAG = 'event'

// ---- 掛點：登場角色 ----

declare module '../../core' {
  interface HookMap {
    /**
     * 事件開的時候，對每個 cast 問一次：這個登場角色是誰。回傳角色的 id 與要先套的變更（例：新生成的人的 actor.add）；沒有人回答的用臨時角色。
     * spec 是那一筆 cast 去掉 role 的樣子（{ npc? } 指定的固定 NPC、{ known? } 主角認識的人、{ gen? } 依當下的區新生成的人）。
     */
    'director.cast': [{ state: GameState; event: string; role: string; spec: Record<string, unknown> }, { actor: string; changes?: Change[] } | void]
  }
}

// ---- 狀態 ----

/** 開著的那一件事件（存在 state.ext.director.open，跟著存檔走）。 */
export interface OpenEvent {
  /** 這一段活動的 id（ev12） */
  id: string
  /** 事件的 id（資料裡的，或內嵌的那一筆自己的 id） */
  event: string
  /** 內嵌的整筆事件；資料裡的沒有這個欄位 */
  inline?: Record<string, unknown>
  /** 走哪一個版本（沒有分版本的是 default） */
  version: string
  /** 第幾段（從 0 起算） */
  stage: number
  /** 登場角色：代號 → 角色 id */
  cast: Record<string, string>
  /** 誰發起的（做完原樣交回） */
  origin: Origin
  /** 這件是 chain 帶出來的：不能再帶 */
  chained?: boolean
}

function readOpen(raw: unknown): OpenEvent | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.event !== 'string' || typeof raw.version !== 'string') return null
  if (typeof raw.stage !== 'number' || !isRecord(raw.cast) || !isRecord(raw.origin) || typeof raw.origin.by !== 'string') return null
  return raw as unknown as OpenEvent
}

/** 現在開著的事件；沒有是 null。 */
export function openEventOf(state: Pick<GameState, 'ext'>): OpenEvent | null {
  return readOpen(directorOf(state).open)
}

/** 把 state.ext.director 改成帶（或不帶）open 的樣子：整份是一個 ext 變更，導演自己的部分原樣帶著。 */
function openChange(state: Pick<GameState, 'ext'>, open: OpenEvent | null): Change {
  const d: Record<string, unknown> = { ...clone(directorOf(state)) }
  if (open) d.open = clone(open)
  else delete d.open
  return { op: 'ext', key: EXT, value: d }
}

// ---- 讀進來：這件事件、版本、第幾段、範圍 ----

interface Loaded {
  open: OpenEvent
  entry: EventBodyFields
  body: ResolvedBody
  stage: ResolvedStage
  scope: ScopeEntry | undefined
}

function entryOf(k: Pick<Kernel, 'content'>, open: OpenEvent): EventBodyFields | undefined {
  return open.inline ? (open.inline as EventBodyFields) : k.content.get<EventBodyFields>(EVENT_KIND, open.event)
}

function load(k: Kernel, state: GameState): Loaded {
  const open = openEventOf(state)
  if (!open) throw new ActionBlocked('現在沒有開著的事件。')
  const entry = entryOf(k, open)
  if (!entry) throw new ActionBlocked(`開著的事件 ${open.event} 在內容裡找不到了（存檔之後內容換過）。`)
  const body = resolveBody(entry, open.version)
  if (typeof body === 'string') throw new ActionBlocked(`開著的事件 ${open.event} 的內文解不開：${body}。`)
  const stage = body.stages[open.stage]
  if (!stage) throw new ActionBlocked(`開著的事件 ${open.event} 沒有第 ${open.stage + 1} 段。`)
  return { open, entry, body, stage, scope: typeof entry.scope === 'string' ? k.content.get<ScopeEntry>(SCOPE_KIND, entry.scope) : undefined }
}

// ---- 選項：看不看得到、檢定、誰擲 ----

const NOT_YET = '現在還不符合這個選項的條件。'

function needOk(k: Kernel, state: GameState, need: OptionDef['need']): boolean {
  if (need === undefined) return true
  const list: Condition[] = Array.isArray(need) ? need : [need]
  return list.every((c) => k.conditions.test(c, { state, stats: k.stats, timeRules: k.timeRules }))
}

/** 這個選項現在：看不看得到，看得到的話選不選得了、不能選的原因。 */
function availability(k: Kernel, state: GameState, o: OptionDef): { visible: boolean; reason: string | null } {
  if (needOk(k, state, o.need)) return { visible: true, reason: null }
  if (o.show_locked === undefined || o.show_locked === false) return { visible: false, reason: null }
  return { visible: true, reason: typeof o.show_locked === 'string' ? o.show_locked : NOT_YET }
}

/** 檢定用的屬性：寫了就用，沒寫看基本功的預設屬性（沒有基本功的內容就是智識）。 */
function attrOf(k: Pick<Kernel, 'content'>, c: CheckSpec): (typeof ATTR_IDS)[number] {
  const a = c.attr ?? (k.content.get('skill', c.skill)?.attr as string | undefined)
  return ((ATTR_IDS as readonly string[]).includes(a ?? '') ? a : 'intellect') as (typeof ATTR_IDS)[number]
}

interface Plan {
  check: CheckSpec
  attr: (typeof ATTR_IDS)[number]
  dc: number
  roller: string
  /** 另一位隊友有同一項 2 級以上，協力 +2 */
  assist: boolean
  situation: RollPart[]
  tags: string[]
}

/**
 * 這一次檢定誰擲、難度多少：範圍的 roller 是 pc 就主角擲；best 是隊上這一項最好的人擲（一樣好的照隊伍的順序），
 * 另一位有同一項 2 級以上時協力 +2。DC ＝ 難度的階梯（或寫的數字）＋存檔規則的難度偏移＋範圍的 dc_plus。
 */
function planCheck(k: Kernel, state: GameState, loaded: Loaded, spec: CheckSpec): Plan {
  const attr = attrOf(k, spec)
  const tags = [EVENT_TAG, ...(Array.isArray(loaded.entry.tags) ? loaded.entry.tags : [])]
  const total = (actor: string): number => checkParts(k.stats, state, actor, { attr, skill: spec.skill, tags }).reduce((s, p) => s + p.value, 0)
  const pc = state.pc ?? 'pc'
  let roller = pc
  let assist = false
  if (loaded.scope?.roller === 'best') {
    const team = state.party.filter((id) => state.actors[id])
    let best = -Infinity
    for (const id of team) {
      const t = total(id)
      if (t > best) { best = t; roller = id }
    }
    assist = team.some((id) => id !== roller && (state.actors[id]!.skills[spec.skill] ?? 0) >= ASSIST_MIN_SKILL)
  }
  const dc = dcFor(spec.dc, state.rules) + (loaded.scope?.dc_plus ?? 0)
  return { check: spec, attr, dc, roller, assist, situation: assist ? [{ label: '協力', value: ASSIST_BONUS, source: 'situation' }] : [], tags }
}

/** 成功率（%）：骰面 1～20 各算一次，成功或大成功的比例（自然 1 與自然 20 照核心的規則）。 */
function chanceOf(k: Kernel, state: GameState, plan: Plan): number {
  const bonus = checkParts(k.stats, state, plan.roller, { attr: plan.attr, skill: plan.check.skill, tags: plan.tags }, plan.situation).reduce((s, p) => s + p.value, 0)
  let ok = 0
  for (let n = 1; n <= 20; n++) {
    const d = computeDegree(n, n + bonus, plan.dc)
    if (d === 'success' || d === 'critical') ok += 1
  }
  return Math.round((ok / 20) * 100)
}

// ---- 檢視 ----

export interface OptionView {
  id: string
  text: string
  /** 選不了的原因（完整的句子）；選得了是 null。看不到的選項不在清單裡 */
  locked: string | null
  /** 這個選項有檢定才有 */
  check?: {
    skill: string
    skill_name: string
    attr: string
    attr_name: string
    dc: number
    /** 難度寫成階梯的名字才有 */
    tier?: string
    roller: string
    roller_name: string
    /** 有隊友協力 +2 */
    assist: boolean
    /** 擲的人這一項的所有加值合計 */
    bonus: number
    /** 成功率（%，成功與大成功） */
    chance: number
  }
  /** 選了會結束這件事件（最後一段、寫了 ends，或結果裡有指示） */
  ends: boolean
  /** 結果可能開成人場景 */
  scene: boolean
}

export interface EventView {
  /** 這一段活動的 id */
  id: string
  event: string
  version: string
  /** 正文：第一段是開頭加這一段的字，之後只有這一段的字 */
  text: string
  stage: { index: number; count: number }
  cast: Array<{ role: string; actor: string; name: string }>
  options: OptionView[]
  /** 永遠有：「我要做別的」，走自由行動 */
  free: boolean
  origin: Origin
}

/** 畫面要的全部。沒有開著的事件是 null。 */
export function eventView(k: Kernel, state: GameState): EventView | null {
  if (!openEventOf(state)) return null
  const l = load(k, state)
  const options: OptionView[] = []
  for (const o of l.stage.options) {
    const a = availability(k, state, o)
    if (!a.visible) continue
    const spec = o.check !== undefined ? normalCheck(o.check) : null
    const view: OptionView = { id: o.id, text: o.text, locked: a.reason, ends: willEnd(l, o), scene: o.adult_scene !== undefined }
    if (spec) {
      const plan = planCheck(k, state, l, spec)
      view.check = {
        skill: spec.skill, skill_name: k.stats.skillName(spec.skill), attr: plan.attr, attr_name: k.stats.attrName(plan.attr), dc: plan.dc,
        ...(typeof spec.dc === 'string' ? { tier: spec.dc } : {}), roller: plan.roller, roller_name: state.actors[plan.roller]?.name ?? plan.roller, assist: plan.assist,
        bonus: checkParts(k.stats, state, plan.roller, { attr: plan.attr, skill: spec.skill, tags: plan.tags }, plan.situation).reduce((s, p) => s + p.value, 0), chance: chanceOf(k, state, plan),
      }
    }
    options.push(view)
  }
  const stageText = l.stage.text ?? ''
  const text = l.open.stage === 0 ? [l.body.text, stageText].filter((t) => t.length > 0).join('\n') : stageText || l.body.text
  return {
    id: l.open.id, event: l.open.event, version: l.body.version, text, stage: { index: l.open.stage, count: l.body.stages.length },
    cast: Object.entries(l.open.cast).map(([role, actor]) => ({ role, actor, name: state.actors[actor]?.name ?? actor })),
    options, free: true, origin: clone(l.open.origin),
  }
}

/** 選了這個選項就結束嗎（最後一段、寫了 ends，或任何一組結果裡有指示；成人場景要看成功程度，所以不算在這裡）。 */
function willEnd(l: Loaded, o: OptionDef): boolean {
  return l.open.stage >= l.body.stages.length - 1 || o.ends === true || Object.values(o.outcomes ?? {}).some((list) => (list ?? []).some(isDirective))
}

// ---- 開始 ----

function castName(k: Pick<Kernel, 'content'>, spec: Record<string, unknown>): string {
  const named = (v: unknown): string | undefined => (isRecord(v) && typeof v.name === 'string' && v.name.trim() ? v.name : undefined)
  if (typeof spec.npc === 'string') return (k.content.get('npc', spec.npc)?.name as string | undefined) ?? spec.npc
  return named(spec.gen) ?? named(spec.known) ?? NAMELESS
}

/** 沒有人回答的登場角色：一個只有名字的臨時角色（留在 state.actors，ext.event_temp 標著；npcs 之類的功能之後可以接手或清掉）。 */
function tempActor(k: Pick<Kernel, 'content'>, uid: number, role: string, spec: Record<string, unknown>): Actor {
  return {
    id: `tmp_${uid}_${role}`, name: castName(k, spec), role: 'npc', age: 25,
    attrs: Object.fromEntries(ATTR_IDS.map((a) => [a, 10])) as Actor['attrs'], skills: {}, perks: [], hp: 20, load: 0, afterglow: 0, sink: 0, conditions: [], ext: { event_temp: true },
  }
}

/** 對每個 cast 問 director.cast，沒有人答的（或答的人查不到）用臨時角色。 */
function resolveCast(k: Kernel, state: GameState, entry: EventBodyFields, uid: number): { cast: Record<string, string>; changes: Change[] } {
  const cast: Record<string, string> = {}
  const changes: Change[] = []
  for (const c of entry.cast ?? []) {
    const { role, ...spec } = c as unknown as Record<string, unknown> & { role: string }
    let found: { actor: string; changes: Change[] } | null = null
    for (const { result } of k.hooks.run('director.cast', { state, event: entry.id, role, spec: clone(spec) })) {
      const r = result as { actor?: unknown; changes?: Change[] }
      const made = (r.changes ?? []).some((ch) => ch.op === 'actor.add' && isRecord(ch.actor) && ch.actor.id === r.actor)
      if (typeof r.actor === 'string' && (state.actors[r.actor] || made)) {
        found = { actor: r.actor, changes: clone(r.changes ?? []) }
        break
      }
    }
    if (found) {
      cast[role] = found.actor
      changes.push(...found.changes)
    } else {
      const a = tempActor(k, uid, role, spec)
      cast[role] = a.id
      changes.push({ op: 'actor.add', actor: a })
    }
  }
  return { cast, changes }
}

/** 開不成的原因寫成一句話。 */
const refuse = (why: string): never => {
  throw new ActionBlocked(why)
}

/** 用到被關掉的標籤時沿著 fallback 找；找不到（或繞圈）就開不成。 */
function allowedEntry(k: Kernel, state: GameState, entry: EventBodyFields): EventBodyFields {
  let cur = entry
  for (let depth = 0; !tagsAllowed(state.rules, cur.tags as string[] | undefined); depth++) {
    const next = typeof cur.fallback === 'string' && depth < 8 ? k.content.get<EventBodyFields>(EVENT_KIND, cur.fallback) : undefined
    if (!next) return refuse('這件事用到被關掉的內容標籤，也沒有可以改走的版本，不會發生。')
    cur = next
  }
  return cur
}

function startEvent(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[] {
  if (openEventOf(state)) return refuse('已經有一件事件開著，先回應它。')
  const s = isRecord(setup) ? setup : {}
  if (s.event !== undefined && s.inline !== undefined) return refuse('事件視窗要開哪一件：給資料裡的 id（event）或內嵌的整筆（inline），不能兩個都給。')
  let entry: EventBodyFields
  let inline: Record<string, unknown> | undefined
  if (typeof s.event === 'string') {
    const found = k.content.get<EventBodyFields>(EVENT_KIND, s.event)
    if (!found) return refuse(`沒有「${s.event}」這件事件，開不起來。`)
    entry = found
  } else if (isRecord(s.inline)) {
    if (typeof s.inline.id !== 'string' || !s.inline.id) return refuse('內嵌的事件要有自己的 id。')
    const problems = eventBodyProblems(k, s.inline as EventBodyFields, 'inline', state)
    if (problems.length > 0) return refuse(`這件內嵌的事件格式不對：${problems.join('；')}。`)
    entry = s.inline as EventBodyFields
    inline = clone(s.inline)
  } else return refuse('事件視窗要開哪一件：給資料裡的 id（event）或內嵌的整筆（inline）。')
  if (entry.blocking === false) return refuse(`事件 ${entry.id} 是不擋的通知，不開事件視窗。`)
  const chained = s.chained === true
  if (chained && hasChain(entry)) return refuse('被 chain 帶出來的事件不能再帶下一件（事件只能連一層）。')
  const used = allowedEntry(k, state, entry)
  if (used !== entry) {
    // 改走 fallback：整件換成那一件（內嵌的整筆不會有 fallback 指到內容之外）
    entry = used
    inline = undefined
  }
  const body = resolveBody(entry, typeof s.version === 'string' ? s.version : 'default')
  if (typeof body === 'string') return refuse(`事件 ${entry.id} 的內文解不開：${body}。`)
  const uid = state.seq.uid + 1
  const { cast, changes } = resolveCast(k, state, entry, uid)
  const open: OpenEvent = { id: `ev${uid}`, event: entry.id, ...(inline ? { inline } : {}), version: body.version, stage: 0, cast, origin: clone(origin), ...(chained ? { chained: true } : {}) }
  const text = [body.text, body.stages[0]!.text].filter((t): t is string => !!t).join('\n')
  return [{
    kind: 'event', action: 'event.open', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', text, tag: 'event.open', data: { event: entry.id, version: body.version, cast } }],
    changes: [{ op: 'uid', advance: 1 }, ...changes, openChange(state, open)],
    outcome: { result: 'open', summary: text },
    ...(entry.adult === true ? { adult: true } : {}),
  }]
}

// ---- 選一個選項 ----

/** 結果裡的指示 ＋ 場景，變成報告的 launch（一個選項最多開一段活動：格式檢查擋了同時寫）。 */
function launchesOf(k: Kernel, state: GameState, l: Loaded, o: OptionDef, list: Array<Record<string, unknown>>, degree: Degree | null, ids: Record<string, string>): Launch[] {
  const from: Origin = { by: 'director', ref: l.open.event, ext: { event: l.open.event, caller: l.open.origin.by, ...(l.open.origin.ref !== undefined ? { caller_ref: l.open.origin.ref } : {}) } }
  const out: Launch[] = []
  for (const d of list.filter(isDirective)) {
    // chain 帶出來的那一件不能再帶（載入時已經擋了；這裡是最後一道）
    if (d.kind === 'chain' && l.open.chained) continue
    if (d.kind === 'fight') {
      out.push({
        kind: 'battle',
        setup: {
          mode: 'meat',
          allies: state.party.map((id) => ({ from: 'actor', id })),
          foes: clone(d.foes),
          ...(d.cover !== undefined ? { cover: clone(d.cover) } : {}),
          origin: { escapable: true, ...(typeof d.faction === 'string' ? { faction: d.faction } : {}), ext: { event: l.open.event } },
        },
        origin: from,
      })
    } else if (d.kind === 'start') {
      // 開一種登記過、而且列在 event_rule.startable 的活動（載入時已經擋了；這裡再看一次，之後才被改掉的當沒有）
      const kind = String(d.activity)
      if (k.activity.get(kind) && eventRules(k).startable.includes(kind)) out.push({ kind, setup: clone(isRecord(d.setup) ? d.setup : {}), origin: from })
    } else out.push({ kind: EVENT_ACTIVITY, setup: { event: d.event, chained: true }, origin: { ...from, ext: { ...from.ext, chain: true } } })
  }
  // 成人場景：成功程度對得上 when，而且有人登記了 scene 這種活動才開（沒有就當沒有，不丟錯）
  const scene = o.adult_scene as SceneSpec | undefined
  if (scene && out.length === 0 && sceneWhenMatches(scene.when, degree) && k.activity.get('scene')) {
    out.push({ kind: 'scene', setup: substitute(clone(scene), ids), origin: from })
  }
  return out
}

/** 結果與收尾共用：把結算的草稿組起來（終止時發 activity.end 並併進去）。 */
interface Finish {
  option: string
  degree: Degree | null
  flags: string[]
}

interface CloseBase {
  timeline: TimelineBeat[]
  changes: Change[]
  actor?: string
  lines: string[]
  summary: string
  launch?: Launch[]
}

function closeDraft(k: Kernel, state: GameState, l: Loaded, base: CloseBase, fin: Finish): ReportDraft {
  // launch：這件事結束之後接著開的活動種類（場景、戰鬥、下一件事件）。臨時的登場角色要留到那段活動做完（npcs 看這個決定要不要現在清）
  const launched = (base.launch ?? []).map((x) => x.kind)
  const result: Record<string, unknown> = {
    event: l.open.event, option: fin.option, flags: fin.flags, stage: l.open.stage, version: l.open.version, ...(fin.degree ? { degree: fin.degree } : {}),
    ...(launched.length > 0 ? { launch: launched } : {}),
  }
  const end = endActivity(k, { state, kind: EVENT_ACTIVITY, id: l.open.id, origin: l.open.origin, outcome: fin.degree ?? (fin.option === FREE_OPTION ? FREE_OPTION : 'done'), result })
  const lines = [...base.lines, ...end.lines]
  const draft: ReportDraft = {
    kind: 'event', action: 'event.close', location: clone(state.location), ...(base.actor ? { actor: base.actor } : {}), party: [],
    timeline: base.timeline,
    changes: [...base.changes, openChange(state, null), ...end.changes],
    outcome: { result: fin.degree ?? fin.option, summary: [base.summary, ...end.lines.map((x) => `${x}。`)].join('') },
    ...(lines.length > 0 ? { narration: { results: lines } } : {}),
    ...(l.entry.adult === true || (base.launch ?? []).some((x) => x.kind === 'scene') ? { adult: true } : {}),
  }
  // 發起的人要回到快照（rewind）時，我們自己開的活動就不開了：launch 與 rewind 不能放在同一份報告
  const own = end.rewind ? [] : (base.launch ?? [])
  if (own.length > 0) draft.launch = own
  return attachActivityEnd(draft, end)
}

/**
 * 選一個選項：回傳報告草稿（純函式）。有檢定的先擲（誰擲、DC 見 planCheck；骰面從存檔的亂數導出，同一個狀態一定一樣），
 * 照成功程度結算那一組效果（內建的事件：照寫的算，錢照區的等級；結算不成立，例如付不出錢，丟 ActionBlocked 並寫出原因）。
 * 還有下一段就換段（event.choose）；最後一段、選項寫了 ends、或結果裡有指示，就收尾（event.close）：發 activity.end、清掉 open、
 * 把指示變成報告的 launch（fight 開戰鬥、chain 開另一件、start 開登記過而且在 startable 裡的活動、adult_scene 在成功程度對得上 when 而且有人登記 scene 時開場景）。
 */
export function chooseOption(k: Kernel, state: GameState, id: string): ReportDraft {
  const l = load(k, state)
  const o = l.stage.options.find((x) => x.id === id)
  if (!o) throw new ActionBlocked('現在沒有這個選項。')
  const a = availability(k, state, o)
  if (!a.visible) throw new ActionBlocked('現在沒有這個選項。')
  if (a.reason) throw new ActionBlocked(a.reason)

  // 檢定
  const spec = o.check !== undefined ? normalCheck(o.check) : null
  let roll: CheckRoll | null = null
  let roller: string | undefined
  if (spec) {
    const plan = planCheck(k, state, l, spec)
    roller = plan.roller
    roll = rollCheck(k.stats, state, {
      actor: plan.roller, attr: plan.attr, skill: spec.skill, dc: plan.dc, purpose: `event/${l.open.id}/${l.open.stage}/${o.id}`, situation: plan.situation, tags: plan.tags,
    })
  }
  const degree = roll ? roll.degree : null

  // 結果：登場角色的代號換成 id，指示拆出來，效果交給 k.effects 結算
  const ids: Record<string, string> = { ...l.open.cast, [PC_ROLE]: state.pc ?? 'pc' }
  const list = substitute(outcomeList(o, degree), ids)
  const res = k.effects.resolve(list.filter((e) => !isDirective(e)), effectCtx(k, state, { source: 'builtin' }))
  if (res.errors.length > 0) throw new ActionBlocked(`這個選項現在做不成：${res.errors.join('；')}。`)
  const launch = launchesOf(k, state, l, o, list, degree, ids)

  const who = roller ?? state.pc
  const timeline: TimelineBeat[] = [{ layer: 'meat', ...(who ? { actor: who } : {}), text: o.text, tag: 'event.choose', data: { event: l.open.event, option: o.id, stage: l.open.stage } }]
  if (roll) timeline.push({ layer: 'meat', ...(roller ? { actor: roller } : {}), text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'event.roll', data: { event: l.open.event, option: o.id, degree: roll.degree } })
  const summary = `${o.text}${roll ? `（${DEGREE_NAME[roll.degree]}）` : ''}`
  const base = { timeline, changes: [...res.changes, ...(roll ? [{ op: 'rng', advance: 1 } as Change] : [])], lines: res.lines, summary: `${summary}。${res.lines.map((x) => `${x}。`).join('')}`, ...(who ? { actor: who } : {}), launch }

  const last = l.open.stage >= l.body.stages.length - 1
  if (last || o.ends === true || launch.length > 0) {
    return closeDraft(k, state, l, base, { option: o.id, degree, flags: [...(o.flags ?? [])] })
  }
  // 換下一段
  const next: OpenEvent = { ...l.open, stage: l.open.stage + 1 }
  return {
    kind: 'event', action: 'event.choose', location: clone(state.location), ...(who ? { actor: who } : {}), party: [],
    timeline, changes: [...base.changes, openChange(state, next)],
    outcome: { result: degree ?? 'chosen', summary: base.summary },
    ...(res.lines.length > 0 ? { narration: { results: res.lines } } : {}),
  }
}

// ---- 自由回應 ----

/** 這一份報告是不是自由行動那條鏈做出來的（核心的 free_action；寫正文的 narrated 不算）。 */
function isFreeActionReport(state: GameState, chain: string | undefined): boolean {
  if (!chain) return false
  const slot = state.chains.find((c) => c.id === chain)
  return isRecord(slot?.detail) && slot.detail.chain === FREE_CHAIN
}

function freeClose(k: Kernel, state: GameState, degree: string | undefined): ReportDraft {
  const l = load(k, state)
  const known: Degree[] = ['critical', 'success', 'fail', 'fumble']
  const d = known.find((x) => x === degree) ?? null
  const text = '你沒有照選項做，直接去做了別的事。'
  return closeDraft(k, state, l, {
    timeline: [{ layer: 'meat', text, tag: 'event.free', data: { event: l.open.event, stage: l.open.stage } }],
    changes: [], lines: [], summary: text, ...(state.pc ? { actor: state.pc } : {}),
  }, { option: FREE_OPTION, degree: d, flags: [] })
}

// ---- 活動與功能 ----

const REASON_OPEN = '眼前有一件事要先回應：選一個選項，或寫下你要做的別的事。'

export const eventActivity: ActivityDef = {
  kind: EVENT_ACTIVITY, owner: EVENT_RUN_OWNER, order: 30,
  active: (s) => {
    const o = openEventOf(s)
    return o ? { id: o.id, label: '事件視窗' } : null
  },
  allow: ['commit:event.', `chain:${FREE_CHAIN}`],
  reason: (_s, doing) => (doing.startsWith(`${EVENT_ACTIVITY}.start`) ? '已經有一件事件開著，先回應它。' : REASON_OPEN),
  start: startEvent,
}

export const eventRunFeature: Feature = {
  id: EVENT_RUN_OWNER,
  install(k: Kernel) {
    k.activity.define(eventActivity)
    addEventBodyCheck(k, (kernel, e, phase) => eventBodyProblems(kernel, e as unknown as EventBodyFields, phase))
    // 事件開著時玩家直接做了自由行動：那一份自由行動套用之後，這件事件以 option free 收尾
    k.hooks.on('report.after', EVENT_RUN_OWNER, ({ state, report }) => {
      if (!openEventOf(state) || !isFreeActionReport(state, report.chain)) return
      return [freeClose(k, state, report.outcome.result)]
    })
  },
}
