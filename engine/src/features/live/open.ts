// L6 功能 live 的開播（MEDIA 1.2 節；dev/adr/0020 第三節、V21～V24；dev/work/M5-live.md 要做的 1～3）。
//   livePreview  現在能不能開、每一條擋住的原因、哪個宿主、哪個模板、抽到的目標、起始熱度、同意與偷播、風險的句子（純函式：不改狀態）
//   goLive       開播：回傳報告草稿 live.go（kind broadcast）；不成立丟 ActionBlocked（原因一條一句，接在一起）
// 宿主的資訊只從 k.activity.active、state.battle、報告的 action 與那一拍的 data 拿（不讀副本、場景的 state.ext）。
// 目標用固定亂數抽：（存檔種子、宿主的種類與 id）導出的一顆，不看游標，所以預覽與開播抽到的一樣、同一場永遠同一組。

import type { ContentEntry, GameState, Kernel, Report, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, areaGrade, clone, deriveRng, isRecord, meterOf } from '../../core'
import type { GoalRow, HostKind, LiveRules, Session, TemplateEntry } from './model'
import {
  GOAL_EXTRA_STAT, GOAL_KIND, GO_ACTION, HOST_NAME, SCOPE_OF_HOST, fameLevel, isText, liveRules, liveSession, partyMax, readGoal, readLive, templateFor,
} from './model'

/** 宿主：進行中的戰鬥、成人場景或委託副本（同時有副本與戰鬥時是副本，V22）。 */
export interface HostInfo {
  kind: HostKind
  id: string
  label: string
}

/** 照 V22 的順序找宿主：副本、戰鬥、成人場景。 */
export function hostOf(k: Pick<Kernel, 'activity'>, state: GameState): HostInfo | null {
  const act = k.activity.active(state)
  for (const kind of ['commission', 'battle', 'scene'] as const) {
    const a = act.find((x) => x.kind === kind)
    if (a) return { kind, id: a.id, label: a.label }
  }
  return null
}

const lastReport = (state: GameState, pred: (r: Report) => boolean): Report | undefined => {
  for (let i = state.reports.length - 1; i >= 0; i--) if (pred(state.reports[i]!)) return state.reports[i]
  return undefined
}

const beatOf = (r: Report | undefined, tag: string): TimelineBeat | undefined => r?.timeline.find((b) => b.tag === tag)

/** 副本進場那一份報告的那一拍（commission.enter：id、grade、faction、stream_goals；副本還沒有帶就是空的）。 */
export function commissionEnter(state: GameState): { id?: string; grade?: number; faction?: string; stream_goals: string[] } {
  const d = beatOf(lastReport(state, (r) => r.action === 'commission.enter'), 'commission.enter')?.data
  const data = isRecord(d) ? d : {}
  return {
    ...(isText(data.id) ? { id: data.id } : {}), ...(typeof data.grade === 'number' && Number.isSafeInteger(data.grade) && data.grade >= 1 ? { grade: data.grade } : {}),
    ...(isText(data.faction) && data.faction !== 'none' ? { faction: data.faction } : {}),
    stream_goals: Array.isArray(data.stream_goals) ? data.stream_goals.filter(isText) : [],
  }
}

/** 場景開場那一拍（scene.start：對象、單人、層）。 */
function sceneStart(state: GameState): { solo: boolean; people: string[]; net: boolean } {
  const b = beatOf(lastReport(state, (r) => r.action === 'scene.start'), 'scene.start')
  const d = isRecord(b?.data) ? b!.data! : {}
  const people = Array.isArray(d.people) ? d.people.filter(isText) : isText(d.with) ? [d.with] : []
  return { solo: d.solo === true, people: [...new Set(people)], net: b?.layer === 'net' }
}

// ---- 不准錄的地方（V6 的 no_rec 欄位；和 media 讀的是同一份資料，不 import media） ----

const flagged = (k: Pick<Kernel, 'content'>, kind: string, id: unknown): boolean => isText(id) && k.content.hasKind(kind) && k.content.get(kind, id)?.no_rec === true

function noRecHere(k: Pick<Kernel, 'content'>, state: GameState, people: string[]): boolean {
  const loc = state.location
  if (flagged(k, 'facility_type', loc.facility) || flagged(k, 'block', loc.block) || flagged(k, 'district', loc.district)) return true
  const at = state.maps?.at
  const inst = at ? state.maps.instances[at.map] : undefined
  if (inst && flagged(k, 'special_map', inst.def)) return true
  return people.some((p) => flagged(k, 'npc', p))
}

// ---- 能不能開 ----

/** 宿主還沒做第一步嗎（V21）：不是的話回傳原因。 */
function firstStepBlock(state: GameState, host: HostInfo): string | null {
  if (host.kind === 'battle') {
    const b = state.battle
    // steps 裡有開打那一步；再多一步就是有人行動過了
    return !b || b.result || b.round > 1 || b.steps.length > 1 ? '這場戰鬥已經有人動手了：直播要在第一輪、還沒有人行動之前開播。' : null
  }
  const last = lastReport(state, (r) => (r.action ?? '').startsWith('commission.') || (r.action ?? '').startsWith('scene.'))
  if (host.kind === 'commission') return last?.action === 'commission.enter' ? null : '副本已經往下走了：直播要在剛進副本、還沒有選面之前開播。'
  return last?.action === 'scene.start' ? null : '這一場已經做過行動了：直播要在場景剛開始、還沒有做任何行動之前開播。'
}

/** 條件 channel_open 有人註冊才問。 */
function channelBlock(k: Kernel, state: GameState): string | null {
  if (!k.conditions.kinds().includes('channel_open')) return null
  return k.conditions.test({ kind: 'channel_open' }, { state, stats: k.stats, timeRules: k.timeRules }) ? null : '還沒有開頻道，不能直播。'
}

// ---- 目標 ----

/** 這一場的等級（打賞 = 目標的 tip_per_grade × 等級）：副本照進場那一拍寫的、戰鬥照戰場的、場景照所在的區。 */
function gradeOf(k: Kernel, state: GameState, host: HostInfo): number {
  if (host.kind === 'commission') return commissionEnter(state).grade ?? areaGrade(k, state)
  if (host.kind === 'battle' && state.battle) return state.battle.grade
  return areaGrade(k, state)
}

const rowOf = (g: NonNullable<ReturnType<typeof readGoal>>, rules: LiveRules, grade: number): GoalRow => ({
  id: g.id, text: g.text, heat: g.heat ?? rules.goal_heat, tip: (g.tip_per_grade ?? 0) * grade, done: false, check: { ...g.check },
})

export interface DrawnGoals {
  /** 抽到的（含多抽的那幾個） */
  goals: GoalRow[]
  /** 玩家要挑掉幾個（live_goal_extra 讓抽到的比平常多） */
  drop: number
}

/**
 * 抽目標（模板寫 pick）：從 stream_goal 裡 scope 對得上的抽 [最少, 最多] 個，live_goal_extra 大於 0 時多抽那麼多個，玩家在開播時挑掉同樣多個；
 * 模板寫 host（副本）：用進場那一拍 stream_goals 列的 id（查不到的略過）。寫了 channel（頻道的定位）的目標先不抽：頻道還沒有定位欄位。
 */
function drawGoals(k: Kernel, state: GameState, host: HostInfo, tpl: TemplateEntry, rules: LiveRules, grade: number): DrawnGoals {
  const lookup = (id: string): ReturnType<typeof readGoal> => (k.content.hasKind(GOAL_KIND) && k.content.has(GOAL_KIND, id) ? readGoal(k.content.get(GOAL_KIND, id) as ContentEntry) : null)
  if (tpl.goals === 'host') {
    const rows = commissionEnter(state).stream_goals.flatMap((id) => { const g = lookup(id); return g ? [rowOf(g, rules, grade)] : [] })
    return { goals: rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i), drop: 0 }
  }
  const pool = (k.content.hasKind(GOAL_KIND) ? k.content.list(GOAL_KIND) : [])
    .map(readGoal).filter((g): g is NonNullable<typeof g> => g !== null && g.scope.includes(tpl.scope) && g.channel === undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const rng = deriveRng({ seed: state.rng.seed, cursor: 0 }, `live.goals/${host.kind}/${host.id}`)
  const [lo, hi] = tpl.goals.pick
  const want = Math.min(rng.int(lo, hi), pool.length)
  const extra = partyMax(k, state, GOAL_EXTRA_STAT)
  const total = Math.min(pool.length, want + extra)
  const bag = [...pool]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
  }
  return { goals: bag.slice(0, total).map((g) => rowOf(g, rules, grade)), drop: total - want }
}

// ---- 同意與起始熱度 ----

export interface ConsentRow { id: string; name: string; ok: boolean }

/** 成人直播的對象有沒有同意（V24）：親密度到 consent 以上，或資料標 stream_ok；單人場景沒有這個問題。 */
function consentOf(k: Kernel, state: GameState, rules: LiveRules, host: HostInfo): ConsentRow[] {
  if (host.kind !== 'scene') return []
  const { solo, people } = sceneStart(state)
  if (solo) return []
  return people.map((id) => {
    const okByData = (k.content.hasKind('npc') && k.content.get('npc', id)?.stream_ok === true) || state.actors[id]?.ext.stream_ok === true
    const okByTrust = k.meters.has('affinity') && meterOf(k, state, 'affinity', id) >= rules.consent
    const name = state.actors[id]?.name ?? (k.content.hasKind('npc') && isText(k.content.get('npc', id)?.name) ? (k.content.get('npc', id)!.name as string) : id)
    return { id, name, ok: okByData || okByTrust }
  })
}

/** 起始熱度：成人模板是主角各區豔名最高那一區的級數，曝露度有人定義時每 exposure_step 級再 +1（內海的場景讀 skin_exposure）。 */
function startHeat(k: Kernel, state: GameState, rules: LiveRules, tpl: TemplateEntry, host: HostInfo): number {
  if (tpl.start_heat !== 'fame_tier') return 0
  let heat = fameLevel(k, state, rules)
  const stat = host.kind === 'scene' && sceneStart(state).net ? 'skin_exposure' : 'exposure'
  if (state.pc && k.stats.hasStat(stat)) heat += Math.floor(Math.max(0, k.stats.stat(state, state.pc, stat)) / rules.exposure_step)
  return heat
}

/** 這種直播的代價，一條一句。 */
export function riskLines(tpl: TemplateEntry, secret: boolean): string[] {
  const out: string[] = []
  const mult = tpl.risk?.hostility_mult
  if (mult !== undefined && mult > 1) out.push(`敵人也在看：直播期間，勢力的敵對值增加變成原來的 ${mult} 倍。`)
  if (tpl.blocks?.includes('stealth_branch')) out.push('直播中不能走潛行的路線。')
  if (secret) out.push('對象沒有同意：這是偷播，被發現的後果很重。')
  return out
}

// ---- 預覽與開播 ----

export interface LivePreview {
  ok: boolean
  /** 擋住的原因，一條一個條件（ok 的時候是空的） */
  blocks: string[]
  host: HostInfo | null
  template: { id: string; name: string; scope: string } | null
  /** 抽到的目標（含多抽的；drop 大於 0 時玩家要挑掉那麼多個） */
  goals: Array<{ id: string; text: string; heat: number; tip: number }>
  drop: number
  start_heat: number
  grade: number
  /** 成人直播的對象與各自有沒有同意；secret 是有人沒同意（偷播） */
  consent: ConsentRow[]
  secret: boolean
  risk: string[]
}

export interface GoInput {
  /** 玩家挑掉的目標 id（live_goal_extra 讓抽到的比平常多時，要剛好挑掉 drop 個） */
  drop?: string[]
}

interface Plan {
  preview: LivePreview
  tpl: TemplateEntry | null
  rows: GoalRow[]
  rules: LiveRules
}

function plan(k: Kernel, state: GameState): Plan {
  const rules = liveRules(k)
  const blocks: string[] = []
  const host = hostOf(k, state)
  if (!state.pc) blocks.push('還沒有主角，不能直播。')
  if (liveSession(state)) blocks.push('已經在直播了：先收播。')
  const ch = channelBlock(k, state)
  if (ch) blocks.push(ch)
  let tpl: TemplateEntry | null = null
  let drawn: DrawnGoals = { goals: [], drop: 0 }
  let consent: ConsentRow[] = []
  let grade = 1
  let heat = 0
  if (!host) blocks.push('現在沒有可以掛直播的活動：要在戰鬥、成人場景或委託副本裡。')
  else {
    const step = firstStepBlock(state, host)
    if (step) blocks.push(step)
    tpl = templateFor(k, SCOPE_OF_HOST[host.kind])
    if (!tpl) blocks.push(`沒有${HOST_NAME[host.kind]}直播的模板。`)
    consent = consentOf(k, state, rules, host)
    if (noRecHere(k, state, consent.map((c) => c.id))) blocks.push('這裡不准錄影，開不了直播。')
    grade = gradeOf(k, state, host)
    if (tpl) {
      drawn = drawGoals(k, state, host, tpl, rules, grade)
      heat = startHeat(k, state, rules, tpl, host)
    }
  }
  // 別的活動擋不擋（例：事件視窗開著）：開播的報告要過每一個進行中的活動的放行
  if (host) {
    const other = k.activity.blockOf(state, GO_ACTION_DOING)
    if (other) blocks.push(other)
  }
  const secret = consent.some((c) => !c.ok)
  const preview: LivePreview = {
    ok: blocks.length === 0, blocks, host, template: tpl ? { id: tpl.id, name: tpl.name, scope: tpl.scope } : null,
    goals: drawn.goals.map((g) => ({ id: g.id, text: g.text, heat: g.heat, tip: g.tip })), drop: drawn.drop, start_heat: heat, grade, consent, secret,
    risk: tpl ? riskLines(tpl, secret) : [],
  }
  return { preview, tpl, rows: drawn.goals, rules }
}

const GO_ACTION_DOING = `commit:${GO_ACTION}`

/** 現在能不能開播、為什麼、會抽到哪些目標（純函式）。 */
export const livePreview = (k: Kernel, state: GameState): LivePreview => plan(k, state).preview

/**
 * 開播：宿主還沒做第一步時，把這一場直播掛上去。回傳報告草稿（live.go，kind broadcast）。
 * 不成立（沒有宿主、宿主做過第一步、沒開頻道、有別的直播、不准錄……）丟 ActionBlocked；live_goal_extra 讓抽到的比平常多時，input.drop 要剛好挑掉那麼多個。
 */
export function goLive(k: Kernel, state: GameState, input: GoInput = {}): ReportDraft {
  const { preview, tpl, rows, rules } = plan(k, state)
  if (!preview.ok || !tpl || !preview.host || !state.pc) throw new ActionBlocked(preview.blocks.join('') || '現在開不了直播。')
  const dropped = input.drop ?? []
  if (dropped.length !== preview.drop || new Set(dropped).size !== dropped.length) throw new ActionBlocked(preview.drop > 0 ? `這一場抽到的目標多了 ${preview.drop} 個：要挑掉剛好 ${preview.drop} 個才能開播。` : '這一場沒有要挑掉的目標。')
  if (dropped.some((id) => !rows.some((r) => r.id === id))) throw new ActionBlocked('挑掉的目標不在這一場抽到的清單裡。')
  const goals = rows.filter((r) => !dropped.includes(r.id))
  const host = preview.host
  const faction = host.kind === 'commission' ? commissionEnter(state).faction : host.kind === 'battle' && isText(state.battle?.origin.faction) ? (state.battle!.origin.faction as string) : undefined
  const session: Session = {
    id: `lv${readLive(state).seq + 1}`, mode: 'activity', template: tpl.id, host: { kind: host.kind, id: host.id }, by: state.pc, where: clone(state.location),
    heat: preview.start_heat, goals, highlights: [], counts: {}, from: {}, tips: preview.start_heat * rules.heat_tips,
    ...(preview.secret ? { secret: true as const } : {}), ...(faction ? { faction } : {}), grade: preview.grade,
  }
  const net = host.kind === 'scene' && sceneStart(state).net
  const text = `你開了${tpl.name}${host.kind === 'scene' ? '' : `（${HOST_NAME[host.kind]}）`}：${goals.length > 0 ? `這一場有 ${goals.length} 個直播目標。` : '這一場沒有直播目標。'}${preview.secret ? '對象不知道你在播。' : ''}`
  return {
    kind: 'broadcast', action: GO_ACTION, location: clone(state.location), actor: state.pc, party: [],
    timeline: [{
      layer: net ? 'net' : 'meat', actor: state.pc, text, tag: 'live.go',
      data: { id: session.id, mode: 'activity', template: tpl.id, host: { kind: host.kind, id: host.id }, goals: goals.map((g) => g.id), start_heat: preview.start_heat, ...(preview.secret ? { secret: true } : {}) },
    }],
    changes: [{ op: 'live.open', session }],
    outcome: { result: 'go', summary: text },
    narration: { results: [`你開了直播。${preview.secret ? '對象沒有同意，這是偷播。' : ''}`] },
    ...(preview.secret ? { triggers: [{ point: 'live_secret', where: { host: { kind: host.kind, id: host.id }, template: tpl.id } }] } : {}),
  }
}
