// L6 功能 work 的一班與升階：能不能做、擲一次、結算報酬與附帶效果、班數、觸發點；升階的檢查、雇主問的那件事件、選完之後換階段。
// 規格：DOWNTIME 4.1a、4.2；EVENTS 3.1、3.3 節；AI_TASKS 3.13 節（程式的步驟：擲骰、結算、升階的檢查；G15：判定由程式照 DC）；dev/adr/0016 第一、六節。
//
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit（或 commitNarrated 寫正文）。

import type { ActivityEndReturn, Change, CheckRoll, Condition, Degree, GameState, Kernel, Launch, Origin, ReportDraft, ReportOutcome, ReportTrigger, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, addMinutes, checkParts, clone, computeDegree, dcFor, effectCtx, formatAmount, formatDuration, meterOf, rollCheck, toMinutes } from '../../core'
import type { JobCheck, JobCut, JobEntry, JobState, LastShift, ModeDef, StageDef, WorkRules } from './model'
import {
  EXT, OWNER, POOL_NAME, PROMOTE_ACTION, SHIFT_ACTION, WORK_POINT,
  blankJob, daysBlock, effectiveStage, facilityHere, facilityLabel, hasModes, jobAtFacility, jobEntry, jobStateOf, openModes, readWork, stageHidden, workRules,
} from './model'

/** 事件視窗做完時，origin.ext 帶的東西。 */
interface PromoteOrigin {
  job: string
  from: number
  to: number
}

/** 擲檢定時帶的標籤，特質與狀態的修正看得到。 */
const WORK_TAG = 'work'
/** 升階事件的選項 id（事件視窗做完交回 result.option）。 */
export const OPTION_PROMOTE = 'promote'
export const OPTION_STAY = 'stay'
const EVENT_ACTIVITY = 'event'

const condCtx = (k: Pick<Kernel, 'stats' | 'timeRules'>, state: GameState) => ({ state, stats: k.stats, timeRules: k.timeRules })
const pcOf = (state: GameState): string => state.pc ?? 'pc'

function writeWork(state: Pick<GameState, 'ext'>, edit: (w: ReturnType<typeof readWork>) => void): Change {
  const w = readWork(state)
  edit(w)
  return { op: 'ext', key: EXT, value: clone(w) as unknown as Record<string, unknown> }
}

// ---- 檢定 ----

export interface CheckPlan {
  attr: JobCheck['attr']
  skill?: string
  dc: number
  /** 屬性的調整值、基本功、特質與狀態的修正合計 */
  bonus: number
  tags: string[]
}

/** 這份工作現在擲的檢定（沒寫 check 是 null，不擲）。選了模式的看模式：它寫了 check 用它的，寫 false 不擲，沒寫用工作的。 */
export function checkPlan(k: Kernel, state: GameState, job: JobEntry, mode?: ModeDef): CheckPlan | null {
  const c = mode && mode.check !== undefined ? (mode.check === false ? undefined : mode.check) : job.check
  if (!c || !state.actors[pcOf(state)]) return null
  const tags = [WORK_TAG]
  const bonus = checkParts(k.stats, state, pcOf(state), { attr: c.attr, ...(c.skill ? { skill: c.skill } : {}), tags }).reduce((s, p) => s + p.value, 0)
  return { attr: c.attr, ...(c.skill ? { skill: c.skill } : {}), dc: dcFor(c.dc, state.rules), bonus, tags }
}

/** 四種成功程度各佔幾成（1d20 每一面各 1/20；自然 20 與自然 1 寫死，照核心的算法）。 */
export function chancesOf(plan: Pick<CheckPlan, 'bonus' | 'dc'>): Record<Degree, number> {
  const out: Record<Degree, number> = { critical: 0, success: 0, fail: 0, fumble: 0 }
  for (let n = 1; n <= 20; n++) out[computeDegree(n, n + plan.bonus, plan.dc)] += 1 / 20
  return out
}

/** 一班的時薪與分帳（模式、公式、分帳都算進去）。 */
export interface PayOpts {
  /** 這一班用的時薪（沒給用工作的 wage） */
  wage?: number
  /** 店家的分帳（沒給用工作的 cut） */
  cut?: JobCut
}

/**
 * 報酬 = 時數 × 時薪 ×（有 cut 時 1 − house）− rent（最少 0）× 階段的倍率 × 成功程度（四捨五入成整數；區域狀態的修正這一步是 1）。
 * LEWD_SYSTEM 6.1 節：一班 6 小時 × 150 × 四成 − 120 ＝ 240，再乘階段與成功程度。
 */
export function wageOf(rules: WorkRules, job: JobEntry, stage: StageDef, hours: number, degree: Degree, o: PayOpts = {}): number {
  const wage = o.wage ?? (typeof job.wage === 'number' ? job.wage : 0)
  const cut = o.cut ?? job.cut
  const gross = hours * wage
  const net = cut ? Math.max(0, gross * (1 - cut.house) - (cut.rent ?? 0)) : gross
  return Math.round(net * stage.mult * rules.degree_mult[degree])
}

/** 公式型時薪的值（每一項查得到才加；查不到當 0）。 */
function formulaWage(k: Kernel, state: GameState, job: JobEntry): number | undefined {
  const f = job.wage_formula
  if (!f) return undefined
  const pc = pcOf(state)
  let total = f.base
  for (const a of f.add) {
    let v = 0
    try {
      if (a.stat !== undefined) v = k.stats.hasStat(a.stat) && state.actors[pc] ? k.stats.stat(state, pc, a.stat) : 0
      else if (a.meter !== undefined) v = k.meters.get(a.meter) ? meterOf(k, state, a.meter) : 0
    } catch {
      v = 0
    }
    total += Number.isFinite(v) ? v / a.div : 0
  }
  return Math.max(0, Math.floor(total))
}

/** 這一班實際用的時薪：模式的 wage，其次公式，其次工作的 wage。 */
export function hourlyWage(k: Kernel, state: GameState, job: JobEntry, mode?: ModeDef): number {
  if (mode) return mode.wage
  return formulaWage(k, state, job) ?? (typeof job.wage === 'number' ? job.wage : 0)
}

/** 一班的付法與檢定（view 與 shift 共用）：時薪、分帳、擲什麼。 */
export function payBasis(k: Kernel, state: GameState, job: JobEntry, mode?: ModeDef): { pay: PayOpts; plan: CheckPlan | null } {
  return { pay: { wage: hourlyWage(k, state, job, mode), ...(job.cut ? { cut: job.cut } : {}) }, plan: checkPlan(k, state, job, mode) }
}

// ---- 模式 ----

/** 這份工作現在可以選的做法的名字（給原因的句子用）。 */
const modeNames = (state: GameState, job: JobEntry): string => openModes(state.rules, job).map(([id, m]) => `${m.name}（${id}）`).join('、')

/**
 * 選的做法現在行不行：有 modes 的工作要選一種，沒給或選了沒有（或被內容篩選關掉）的擋下並列出可以選的；沒有 modes 的工作不收 mode。
 * 行是 null；行的話第二個回傳值是那一種做法。
 */
export function modeCheck(state: GameState, job: JobEntry, mode?: string): { block: string | null; mode?: [string, ModeDef] } {
  if (!hasModes(job)) return mode === undefined ? { block: null } : { block: `${job.name}沒有分做法，不用選。` }
  const open = openModes(state.rules, job)
  if (open.length === 0) return { block: `${job.name}現在沒有可以選的做法（相關的題材被你的內容篩選關掉了）。` }
  if (mode === undefined) return { block: `${job.name}要先選一種做法：${modeNames(state, job)}。` }
  const found = open.find(([id]) => id === mode)
  if (!found) return { block: `${job.name}沒有「${mode}」這種做法，可以選：${modeNames(state, job)}。` }
  return { block: null, mode: found }
}

// ---- 能不能做 ----

/** 這份工作現在能不能做（和做幾小時無關）：沒有主角、活動擋住、不在那個設施、不在那一區、日子與時段不對；能是 null。 */
export function jobBlock(k: Kernel, state: GameState, job: JobEntry): string | null {
  if (!state.pc || !state.actors[state.pc]) return '還沒有主角。'
  const act = k.activity.blockOf(state, `commit:${SHIFT_ACTION}`)
  if (act) return act
  if (!jobAtFacility(k, state, job) || (job.district !== undefined && job.district !== state.location.district)) {
    return `${job.name}要到${facilityLabel(k, job.facility)}才能做，你現在不在那裡。`
  }
  return daysBlock(k, state, job)
}

/** 這一班現在能不能做；能是 null。有 modes 的工作要給 mode。 */
export function shiftBlock(k: Kernel, state: GameState, jobId: string, hours: number, mode?: string): string | null {
  const job = jobEntry(k, jobId)
  if (!job) return `沒有 ${jobId} 這份工作。`
  const rules = workRules(k)
  if (!rules.hours.includes(hours)) return `一班只能做 ${rules.hours.join('、')} 小時。`
  return jobBlock(k, state, job) ?? modeCheck(state, job, mode).block
}

// ---- 階段與升階 ----

export interface NeedProgress {
  shifts: { have: number; need: number; ok: boolean }
  affinity: { have: number; need: number; ok: boolean }
  /** 沒有額外條件是 null */
  extra: boolean | null
  /** 三項都到了 */
  met: boolean
}

/** 升到第 target 階段（從 0 起算）的進度；第一階段沒有條件是 null。state 是看雇主親密度與額外條件的狀態。 */
export function needProgress(k: Kernel, state: GameState, job: JobEntry, js: Pick<JobState, 'shifts'>, target: number): NeedProgress | null {
  const need = job.stages[target]?.need
  if (!need) return null
  const have = job.employer ? meterOf(k, state, 'affinity', job.employer) : 0
  const extraList: Condition[] = need.extra === undefined ? [] : Array.isArray(need.extra) ? need.extra : [need.extra]
  const extra = extraList.length === 0 ? null : extraList.every((c) => k.conditions.test(c, condCtx(k, state)))
  const shifts = { have: js.shifts, need: need.shifts, ok: js.shifts >= need.shifts }
  const affinity = { have, need: need.affinity, ok: have >= need.affinity }
  return { shifts, affinity, extra, met: shifts.ok && affinity.ok && extra !== false }
}

/** 現在該不該問升階：停在記下來的階段（沒被內容篩選卡住）、下一階沒被關掉、這一階還沒問過、三項條件都到了。 */
export function promotionDue(k: Kernel, state: GameState, job: JobEntry, js: JobState): boolean {
  const at = effectiveStage(state.rules, job, js.stage)
  if (at !== js.stage || at + 1 >= job.stages.length || js.asked) return false
  if (stageHidden(state.rules, job, at + 1)) return false
  return needProgress(k, state, job, js, at + 1)?.met === true
}

/** 雇主問要不要升的那件內嵌事件：升，或留在原本的階段。 */
export function promoteEvent(k: Kernel, job: JobEntry, from: number, to: number): Record<string, unknown> {
  const stage = job.stages[to]!
  const here = job.stages[from]!
  const boss = job.employer ? k.content.get<{ id: string; name?: string }>('npc', job.employer)?.name ?? '雇主' : '雇主'
  return {
    id: `work_promote_${job.id}_${to + 1}`,
    text: `${boss}把你叫到一旁：「${job.name}你做得不錯，要不要換個更重要的位置？」`,
    options: [
      { id: OPTION_PROMOTE, text: `升到「${stage.name}」（時薪 ×${stage.mult}）。`, outcomes: { any: [] } },
      { id: OPTION_STAY, text: `留在「${here.name}」。`, outcomes: { any: [] } },
    ],
  }
}

// ---- 一班 ----

/** amnesia 的那一班留下的一句模糊的殘留（不帶機制數字、不寫內文）。 */
export const AMNESIA_RESIDUE = '這一班的事只剩一段模糊的殘留，怎麼也想不起細節。'

/**
 * 打一班工（hours 要在規則的 hours 裡，預設 2、4、8；有 modes 的工作要給 mode）：
 *  - 時間加 hours 小時；有 check 擲一次（沒有的當成功），報酬 = 時數 × 時薪（模式、公式、分帳都算）× 階段的倍率 × 成功程度，付工作寫的那一種錢；
 *  - 大失敗雇主親密度 −3（沒有人定義 affinity 時略過）；每一班的附帶效果（工作的加上模式的、這個階段的、模式 every 到班數的）經 k.effects 結算；班數 +1；
 *  - amnesia 的模式：報告的 outcome 多 amnesia: true、結果只有兩句（賺了多少、一句模糊的殘留），時間照過、變更照做；
 *  - 報告帶觸發點 work（where：district、block、facility 是設施的種類、job、stage 是第幾階段從 1 起算、mode 是做法的 id）；
 *  - 這一班做完滿足升階的條件、這一階還沒問過：報告帶 launch 一件內嵌的事件（有人登記事件視窗才問；沒有就不問、也不記成問過）。
 */
export function shift(k: Kernel, state: GameState, jobId: string, hours: number, modeId?: string): ReportDraft {
  const block = shiftBlock(k, state, jobId, hours, modeId)
  if (block) throw new ActionBlocked(block)
  const job = jobEntry(k, jobId)!
  const mode = modeCheck(state, job, modeId).mode
  const rules = workRules(k)
  const js = jobStateOf(state, job.id)
  const at = effectiveStage(state.rules, job, js.stage)
  const stage = job.stages[at]!
  const pc = pcOf(state)
  const minutes = hours * 60
  const { pay: payOpts, plan } = payBasis(k, state, job, mode?.[1])
  const amnesia = mode?.[1].amnesia === true

  // 擲一次（沒有 check 的當成功）
  let roll: CheckRoll | null = null
  if (plan) {
    roll = rollCheck(k.stats, state, {
      actor: pc, attr: plan.attr, ...(plan.skill ? { skill: plan.skill } : {}), dc: plan.dc, tags: plan.tags,
      purpose: `work/${job.id}/${toMinutes(state.time)}/${js.shifts}`,
    })
  }
  const degree: Degree = roll ? roll.degree : 'success'
  const amount = wageOf(rules, job, stage, hours, degree, payOpts)

  const changes: Change[] = [{ op: 'time', minutes }]
  if (amount > 0) changes.push({ op: job.pay, delta: amount })
  const lines: string[] = []

  // 大失敗：雇主親密度（沒有人定義 affinity、或這一筆結算不成立就略過）
  if (degree === 'fumble' && job.employer && rules.fumble_affinity > 0 && k.effects.has('affinity')) {
    const res = k.effects.resolve([{ kind: 'affinity', key: job.employer, amount: -rules.fumble_affinity }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length === 0) {
      changes.push(...res.changes)
      lines.push(...res.lines)
    }
  }

  // 這個模式做了幾班（這一班算進去）；every 是「每做滿幾班」給一次的效果
  const modeCount = mode ? (js.modes?.[mode[0]] ?? 0) + 1 : 0
  const every = mode ? (mode[1].every ?? []).filter((x) => modeCount % x.shifts === 0).flatMap((x) => x.effects) : []

  // 每一班的附帶效果：工作的加上模式的、這個階段的、模式的 every
  const perks = [...(job.perks ?? []), ...(mode?.[1].perks ?? []), ...(stage.perks ?? []), ...every]
  if (perks.length > 0) {
    const res = k.effects.resolve(perks, effectCtx(k, state, { source: 'builtin', tail: clone(changes) }))
    if (res.errors.length > 0) throw new ActionBlocked(`${job.name}這一班的附帶效果現在結算不了：${res.errors.join('；')}。`)
    changes.push(...res.changes)
    lines.push(...res.lines)
  }

  // 升階的檢查：照這一班做完之後的狀態（錢、豔名、雇主親密度都算進去）
  const done: JobState = { shifts: js.shifts + 1, stage: js.stage, asked: js.asked, last: null, ...(mode || js.modes ? { modes: { ...js.modes, ...(mode ? { [mode[0]]: modeCount } : {}) } } : {}) }
  let launch: Launch[] | undefined
  if (k.activity.get(EVENT_ACTIVITY)) {
    const sim = clone(state)
    k.changes.applyAll(sim, changes)
    if (promotionDue(k, sim, job, done)) {
      done.asked = true
      const origin: Origin = { by: OWNER, ref: job.id, ext: { job: job.id, from: at, to: at + 1 } satisfies PromoteOrigin as unknown as Record<string, unknown> }
      launch = [{ kind: EVENT_ACTIVITY, setup: { inline: promoteEvent(k, job, at, at + 1) }, origin }]
    }
  }
  done.last = { hours, degree: roll ? degree : null, amount, pay: job.pay, stage: at + 1, at: toMinutes(addMinutes(state.time, minutes)), ...(mode ? { mode: mode[0] } : {}) } satisfies LastShift
  changes.push(writeWork(state, (w) => { w.jobs[job.id] = done }))
  if (roll) changes.push({ op: 'rng', advance: 1 })

  // 報告
  const where: Record<string, string> = {
    ...(state.location.district ? { district: state.location.district } : {}), ...(state.location.block ? { block: state.location.block } : {}),
    facility: facilityHere(k, state)?.type ?? job.facility, job: job.id, stage: String(at + 1), ...(mode ? { mode: mode[0] } : {}),
  }
  const triggers: ReportTrigger[] = [{ point: WORK_POINT, where }]
  const place = facilityHere(k, state)?.name ?? facilityLabel(k, job.facility)
  const data = { job: job.id, stage: at + 1, hours, degree: roll ? degree : null, amount, pay: job.pay, ...(mode ? { mode: mode[0] } : {}) }
  if (amnesia) {
    // 戴著晶片的那一班：只留賺了多少與一句模糊的殘留，過程與附帶的句子都不寫（變更照做）
    const earned = amount > 0 ? `你從${place}下了班，${POOL_NAME[job.pay]}多了 ${formatAmount(amount)}。` : `你從${place}下了班，一毛錢也沒領到。`
    const results = [earned, AMNESIA_RESIDUE]
    const outcome = { result: roll ? degree : 'done', summary: results.join(''), amnesia: true } as ReportOutcome
    return {
      kind: 'downtime', action: SHIFT_ACTION, location: clone(state.location), actor: pc, party: [],
      timeline: [{ layer: 'meat', actor: pc, text: earned, tag: SHIFT_ACTION, data: { ...data, amnesia: true } }, { layer: 'meat', actor: pc, text: AMNESIA_RESIDUE, tag: 'work.amnesia' }],
      changes, outcome, narration: { results }, triggers, ...(launch ? { launch } : {}),
    }
  }
  const head = `你在${place}做了 ${formatDuration(minutes)}的${job.name}${mode ? `（${mode[1].name}）` : ''}${roll ? `（${DEGREE_NAME[degree]}）` : ''}`
  const pay = amount > 0 ? `，領了 ${formatAmount(amount)}（${POOL_NAME[job.pay]}）。` : '，一毛錢也沒領到。'
  const text = `${head}${pay}`
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: pc, text, tag: SHIFT_ACTION, data }]
  if (roll) beats.push({ layer: 'meat', actor: pc, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'work.roll', data: { job: job.id, degree: roll.degree } })
  const results = [text, ...lines.map((l) => `${l}。`)]
  return {
    kind: 'downtime', action: SHIFT_ACTION, location: clone(state.location), actor: pc, party: [], timeline: beats, changes,
    outcome: { result: roll ? degree : 'done', summary: results.join('') },
    narration: { results }, triggers, ...(launch ? { launch } : {}),
  }
}

// ---- 升階的事件做完（掛點 activity.end） ----

function readPromoteOrigin(origin: Origin): PromoteOrigin | null {
  const x = origin.ext
  if (origin.by !== OWNER || !x || typeof x.job !== 'string' || typeof x.from !== 'number' || typeof x.to !== 'number') return null
  return { job: x.job, from: x.from, to: x.to }
}

/**
 * 升階的事件做完：選了升就進下一階段（變更接在事件結束的那一份報告後面；記下 announce，報告掛鉤再寫一份 work.promote），其餘（留下、我要做別的）停在原本的階段。
 * 這一階已經問過了（asked），不會再問。
 */
export function onPromoteEnd(k: Kernel, state: GameState, origin: Origin, result: Record<string, unknown>): ActivityEndReturn | void {
  const o = readPromoteOrigin(origin)
  if (!o) return
  const job = jobEntry(k, o.job)
  if (!job || !job.stages[o.to]) return
  if (result.option !== OPTION_PROMOTE) return { lines: [`你留在「${job.stages[o.from]?.name ?? job.name}」。`] }
  const js = jobStateOf(state, job.id)
  // 兩次問的中間狀態變了（例如階段已經不是當初問的那一階）：不升
  if (js.stage !== o.from) return
  const change = writeWork(state, (w) => {
    const cur = w.jobs[job.id] ?? blankJob()
    w.jobs[job.id] = { ...cur, stage: o.to, asked: false }
    w.announce = { job: job.id, from: o.from, to: o.to }
  })
  return { changes: [change], lines: [`你在${job.name}升到了「${job.stages[o.to]!.name}」。`] }
}

/** 剛升階：寫 work.promote 這一份報告（沒有別的變更，只清掉 announce）；沒有要寫的是 null。 */
export function announceDraft(k: Kernel, state: GameState): ReportDraft | null {
  const a = readWork(state).announce
  if (!a) return null
  const job = jobEntry(k, a.job)
  const stage = job?.stages[a.to]
  const text = job && stage ? `${job.name}升階了：「${job.stages[a.from]?.name ?? ''}」→「${stage.name}」，時薪 ×${stage.mult}。` : '升階了。'
  const pc = state.pc
  return {
    kind: 'downtime', action: PROMOTE_ACTION, location: clone(state.location), ...(pc ? { actor: pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(pc ? { actor: pc } : {}), text, tag: PROMOTE_ACTION, data: { job: a.job, from: a.from + 1, to: a.to + 1 } }],
    changes: [writeWork(state, (w) => { w.announce = null })],
    outcome: { result: 'promoted', summary: text }, narration: { results: [text] },
  }
}
