// L6 功能 commission 的結算：評價、路線留下的後果、歷練點；戰敗被接受之後的委託失敗（回到入口）與不算失敗（留在這個階段的開頭）。
// 規格：COMMISSIONS 2.3 節的表（規模與歷練點）、第 8 節；COMBAT_SYSTEM 8.4、8.5 節；SERIES 第 6 節；FACTIONS 6.2 節；CORE_RULES 7.1 節；
// dev/adr/0016 第一、二節與 G16；dev/work/M2-commission-close.md。
//
// 純函式：讀狀態、回傳數字或報告草稿；不碰登錄表（登記在 index.ts）。報酬、付法、分帳、街頭信譽不在這裡：
// M2-fixer 聽 activity.end 自己算，這裡只把評價（rating）與進來時的 terms 交出去。
//
// 失敗怎麼走（接受戰敗、fails_commission 是 true）：
//   1. 聽 activity.end（kind defeat、outcome accept、那一場的 origin 是這件委託）：回傳一筆變更（失敗的記號，pending）與 rewind（entry）。
//   2. 核心在同一次提交裡回到進去之前的快照；rewind.keep 把失敗的記號與要發的結果帶到回去之後的狀態。
//   3. 回去之後的那一份報告（action rewind）套用之後，report.after 看到 pending 的記號，接著提交一份 commission.failed，
//      在那一份裡發 activity.end（outcome failed）；記號留著（pending 變成 false），其餘的都回去了。
// 沒有 fails_commission：不回退。人留在這個階段，地圖關掉、回到選分支之前（遭遇下次選分支時重新放），警戒與拿到的連動留著。

import type { ActivityEndMerged, ActivityEndReturn, Change, GameState, Kernel, Origin, ReportDraft, ReportRewind } from '../../core'
import { clone, effectCtx, endActivity, isRecord, meterOf } from '../../core'
import type { Run } from './model'
import { ACTIVITY, DEFAULT_NET_RULES, FAILED_EXT, SCALE_STAGES, TRACE_MIN, clamp, commissionRules, gradeOf, netRules, readRun, runChange } from './model'
import type { CommissionRules, NetRules } from './model'

/** 評價的四級，由低到高 */
export const RATINGS = ['C', 'B', 'A', 'S'] as const
export type Rating = (typeof RATINGS)[number]
/** 從 B 起算 */
const BASE_RATING = 1

/** 給歷練點的效果種類：還沒有人註冊（abilities 的功能沒裝或還沒做）時只在結果裡帶數字，不寫進狀態。 */
export const XP_EFFECT = 'xp'
/** 敵對值的效果種類（核心的量表自動註冊；沒有人定義量表時不加） */
export const HOSTILITY_EFFECT = 'hostility'

// ---- 評價 ----

export interface RatingParts {
  /** 潛行或交涉成功的階段數（每個 +1） */
  stealth: number
  /** 拿到的連動夠不夠多（+1 或 0） */
  links: number
  /** 警戒最後在門檻以上（−1 或 0） */
  alert: number
  /** 警戒到過上限（−1 或 0） */
  peak: number
  /** 加起來的分數（B 為 0） */
  score: number
}

/**
 * 評價（G16）：從 B 起算；每個潛行或交涉成功的階段 +1、三個以上連動 +1、警戒最後在 60 以上 −1、到過 100 再 −1；夾在 C～S 四級之內。
 * 內海面（M3-commission-net）的壓力條照同一個門檻看追蹤度：最後在 60 以上 −1（和警戒同一項，兩條都過了也只扣一次）、到過 90 再 −1（同樣是那一項）。
 */
export function rate(run: Run, rules: CommissionRules, alert: number, peak: number, net: NetRules = DEFAULT_NET_RULES): { rating: Rating; parts: RatingParts } {
  const stealth = new Set(run.route.filter((r) => r.roll === 'pass').map((r) => r.stage)).size
  const links = run.links.length >= rules.rating_links ? 1 : 0
  const high = alert >= rules.rating_alert || (run.trace ?? 0) >= rules.rating_alert ? -1 : 0
  const top = peak >= rules.rating_peak || (run.net_peak ?? 0) >= net.rating_trace_peak ? -1 : 0
  const score = stealth + links + high + top
  return { rating: RATINGS[clamp(BASE_RATING + score, 0, RATINGS.length - 1)]!, parts: { stealth, links, alert: high, peak: top, score } }
}

// ---- 路線的後果 ----

export interface Fallout {
  /** 受影響的勢力（目標勢力；沒有目標勢力是 null） */
  faction: string | null
  /** 目標勢力的敵對值加多少（現實與內海兩份加起來；沒有就是 0） */
  delta: number
  /** 走了現實的階段數（潛行或交涉成功的不算） */
  reality: number
  /** 其中強攻的階段數（強攻，或潛行與交涉沒過、照強攻走的） */
  assault: number
  /** 走了內海留下的那一份（N34；有階段走了內海才有這個欄位）：走了幾個內海的階段、整趟最後的追蹤度、被定位算進去的那一份、目標勢力的內海敵對值（delta 已經包含它） */
  net?: { stages: number; trace: number; located: number; delta: number }
  /** 管網路的勢力各加多少（net_watchers；有階段走了內海才有這個欄位） */
  watchers?: Array<{ faction: string; delta: number }>
}

/**
 * 路線的後果（COMMISSIONS 第 8 節、FACTIONS 6.2 節）：有階段走了現實，目標勢力的敵對值 +5，每個強攻的階段再 +3，最多 +15；全部走潛行或交涉成功不加。
 * 有階段走了內海（N34）：每 20 點追蹤度（做完時整趟最後的值）目標勢力的敵對值 +1（進位、最多 5），不算被定位的那一次（不算失敗的戰敗而且是被定位：另外 +5）；
 * 管網路的勢力（規則表 net_watchers）各 +2。
 */
export function fallout(run: Run, rules: CommissionRules, netR: NetRules = DEFAULT_NET_RULES): Fallout {
  const faction = run.def.target_faction !== 'none' && run.def.target_faction.trim() ? run.def.target_faction : null
  const real = run.route.filter((r) => r.face === 'meat' && r.roll !== 'pass')
  const assault = real.filter((r) => r.kind === 'assault' || r.roll === 'fail').length
  const meat = faction !== null && real.length > 0 ? Math.min(rules.hostility_max, rules.hostility_base + rules.hostility_per_assault * assault) : 0
  const stages = new Set(run.route.filter((r) => r.face === 'net').map((r) => r.stage)).size
  if (stages === 0) return { faction, delta: meat, reality: real.length, assault }
  const trace = run.trace ?? 0
  const located = run.net_located === true ? netR.net_located_hostility : 0
  const net = faction !== null ? Math.min(netR.net_hostility_max, Math.ceil(Math.max(0, trace) / netR.net_hostility_step)) + located : 0
  const watchers = netR.net_watcher_hostility > 0 ? netR.net_watchers.map((f) => ({ faction: f, delta: netR.net_watcher_hostility })) : []
  return { faction, delta: meat + net, reality: real.length, assault, net: { stages, trace, located, delta: net }, watchers }
}

// ---- 歷練點 ----

/** 歷練點：照規模固定給（小 20、中 35、大 60），不看評價；乘存檔規則的歷練倍率（四捨五入）。 */
export function xpFor(state: Pick<GameState, 'rules'>, rules: CommissionRules, scale: string): number {
  if (!Object.hasOwn(SCALE_STAGES, scale)) return 0
  const base = rules[`xp_${scale}` as 'xp_small']
  return Math.round(base * state.rules.xpMult)
}

// ---- 給畫面的預估 ----

export interface CloseForecast {
  /** 現在做完的話會是什麼評價 */
  rating: Rating
  parts: RatingParts
  /** 現在的路線會留下的敵對值 */
  fallout: Fallout
  /** 做完拿到的歷練點 */
  xp: number
}

/** 預估：照現在的路線、連動與警戒（alert 是現在的、peak 是到過的最高）算做完的話會是什麼。 */
export function forecast(state: GameState, run: Run, rules: CommissionRules, alert: number, peak: number, net: NetRules = DEFAULT_NET_RULES): CloseForecast {
  const r = rate(run, rules, alert, peak, net)
  return { rating: r.rating, parts: r.parts, fallout: fallout(run, rules, net), xp: xpFor(state, rules, run.def.scale) }
}

// ---- 結果 ----

/** activity.end 的 result：進來時的 terms 與輔助面的設定原樣不動；extra 是評價、歷練點與路線的後果（做完或失敗才有）。 */
export function resultOf(run: Run, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commission: run.def.id, kind: run.def.kind, main: run.def.main, scale: run.def.scale, grade: gradeOf(run.def.grade),
    target_faction: run.def.target_faction, district: run.def.district, ...(run.def.employer !== undefined ? { employer: run.def.employer } : {}),
    stages: run.def.stages.length, route: clone(run.route), links: run.links.map((l) => l.id), alert: run.alert, peak: run.peak,
    trace: run.trace ?? 0, net_peak: run.net_peak ?? 0,
    ...(run.def.conditions ? { conditions: clone(run.def.conditions) } : {}),
    ...(run.setup.terms !== undefined ? { terms: clone(run.setup.terms) } : {}), ...(run.setup.aux !== undefined ? { aux: clone(run.setup.aux) } : {}),
    ...(run.aux && run.aux.log.length > 0 ? { aux_log: clone(run.aux.log) } : {}),
    ...clone(extra),
  }
}

/** 做完（finish）要套的：敵對值與歷練點的變更、給玩家看的句子、算出來的數字（放進 result）。沒有人註冊的效果種類不套（功能沒裝）。 */
export function settleDone(k: Kernel, state: GameState, run: Run): { changes: Change[]; lines: string[]; result: Record<string, unknown> } {
  const rules = commissionRules(k)
  const nr = netRules(k)
  const { rating, parts } = rate(run, rules, run.alert, run.peak, nr)
  const fall = fallout(run, rules, nr)
  const xp = xpFor(state, rules, run.def.scale)
  const changes: Change[] = []
  const lines: string[] = [`評價 ${rating}。`]
  const ctx = effectCtx(k, state, { source: 'builtin' })
  // 同一個勢力（目標勢力也在管網路的清單裡）只結算一次
  const hostile = new Map<string, number>()
  if (fall.faction !== null && fall.delta > 0) hostile.set(fall.faction, fall.delta)
  for (const w of fall.watchers ?? []) if (w.delta > 0) hostile.set(w.faction, (hostile.get(w.faction) ?? 0) + w.delta)
  if (k.effects.has(HOSTILITY_EFFECT)) {
    for (const [faction, amount] of hostile) {
      const res = k.effects.resolve([{ kind: HOSTILITY_EFFECT, key: faction, amount }], ctx)
      if (res.errors.length === 0) {
        changes.push(...res.changes)
        lines.push(...res.lines)
      }
    }
  }
  if (xp > 0 && k.effects.has(XP_EFFECT)) {
    const res = k.effects.resolve([{ kind: XP_EFFECT, amount: xp }], ctx)
    if (res.errors.length === 0) {
      changes.push(...res.changes)
      lines.push(...res.lines)
    }
  }
  return {
    changes, lines,
    result: { rating, rating_parts: parts, xp, hostility: { faction: fall.faction, delta: fall.delta, reality: fall.reality, assault: fall.assault, ...(fall.net ? { net: fall.net, watchers: fall.watchers } : {}) } },
  }
}

// ---- 撤退（玩家按撤退，與 face.net 交回 retreat 共用） ----

/** 撤退回到進去之前的那一句（報告的 rewind） */
export const RETREAT_REWIND: ReportRewind = { kind: 'entry', summary: '你從副本撤退，所有進度回到進去之前；剛才那段經歷只留下紀錄。', fresh: true }

/** 撤退的結算：發 commission 的 activity.end（outcome retreat；中間人聽它記下「委託還在手上」）。撤退之後不會再開新的活動：處理函式要的 launch 丟掉。 */
export function retreatEnd(k: Kernel, state: GameState, run: Run): ActivityEndMerged {
  const end = endActivity(k, { state, kind: ACTIVITY, id: run.def.id, origin: run.origin, outcome: 'retreat', result: resultOf(run) })
  end.launch = []
  return end
}

// ---- 內海面交回（活動 face.net 的 activity.end；dev/adr/0018 第九節） ----

const intOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : fallback)

/**
 * face.net 交回了：
 *   done      整趟的追蹤度與到過的最高值記下來、這一段算做完（接里程碑照舊）；這件委託第一次到過 net_alert_at（60）警戒 +net_alert，只加一次；
 *             面的資料寫了 controls 而 result.controls 是空的（沒有接管）：這一面的 gives 不給（no_gives）。
 *   retreat   和玩家按撤退一樣：同一份結算（commission 的 retreat）、同一個 rewind。
 *   located   和「戰敗被接受而且算失敗」一樣（N15）：留失敗的記號、回到進去之前；目標勢力的敵對值另外加。
 *   其餘      這一段沒有完成，可以再來一次。
 */
export function netEnd(k: Kernel, state: GameState, run: Run, outcome: string, result: Record<string, unknown>): ActivityEndReturn {
  if (outcome === 'retreat') {
    const end = retreatEnd(k, state, run)
    return { changes: end.changes, lines: ['你們登出了：委託的這一段撤退。', ...end.lines], rewind: RETREAT_REWIND }
  }
  if (outcome === 'located') return failReturn(k, run, { located: true, net: true, ...(typeof result.trace === 'number' ? { trace: result.trace } : {}) }, true)
  if (outcome !== 'done') return { changes: [runChange({ ...run, done: false })], lines: ['這一段沒有完成，可以再來一次。'] }
  const rules = netRules(k)
  const trace = clamp(intOr(result.trace, run.trace), TRACE_MIN, 100)
  const peak = Math.max(run.net_peak, trace, clamp(intOr(result.peak, trace), TRACE_MIN, 100))
  const lines = ['這一段完成了。']
  const next: Run = { ...run, done: true, trace, net_peak: peak }
  if (!run.net_alerted && peak >= rules.net_alert_at) {
    next.net_alerted = true
    const before = next.alert
    next.alert = clamp(before + rules.net_alert, 0, 100)
    next.peak = Math.max(next.peak, next.alert)
    if (next.alert > before) lines.push(`追蹤度到過 ${rules.net_alert_at}：委託的警戒 +${next.alert - before}。`)
  }
  // 面的資料寫了 controls：接管了才有那個連動（沒寫 controls 的面不受影響）
  const wanted = run.def.stages[run.stage - 1]?.faces.net?.controls
  const taken = Array.isArray(result.controls) ? result.controls.length : 0
  if (Array.isArray(wanted) && wanted.length > 0 && taken === 0) next.no_gives = true
  else delete next.no_gives
  return { changes: [runChange(next)], lines }
}

// ---- 失敗的記號 ----

export interface FailedMark {
  commission: string
  name: string
  /** 當初是誰發起這一趟的（activity.end 的 origin） */
  origin: Origin
  /** activity.end（outcome failed）要帶的結果 */
  result: Record<string, unknown>
  /** 還沒有發 activity.end（回去之後的那一份報告套用之後才發） */
  pending: boolean
  /** 被定位而失敗（N15、N34）：回去之後目標勢力的敵對值 +amount（失敗的路線後果不留，這一份是被定位另外的） */
  located?: { faction: string; amount: number }
}/** 讀 state.ext.commission_failed：沒有、或壞掉的回傳 null（回傳的是複製品）。 */
export function failedOf(state: Pick<GameState, 'ext'>): FailedMark | null {
  const raw = state.ext[FAILED_EXT]
  if (!isRecord(raw) || typeof raw.commission !== 'string' || !isRecord(raw.origin) || typeof raw.origin.by !== 'string' || !isRecord(raw.result) || typeof raw.pending !== 'boolean') return null
  return clone(raw) as unknown as FailedMark
}

const failedChange = (mark: FailedMark | null): Change => ({ op: 'ext', key: FAILED_EXT, value: mark ? clone(mark) : null })

/** 這一場戰鬥是這件委託這一段發起的（看 ext 的 commission 與 stage：探索進圖開的戰鬥 by 會被換成 core，ext 的鍵還在）。 */
export function mineOf(run: Run, origin: { ext?: Record<string, unknown> }): boolean {
  const ext = origin.ext
  return !!ext && ext.commission === run.def.id && ext.stage === run.stage
}

// ---- 戰敗被接受 ----

/**
 * 聽 activity.end（kind defeat、outcome accept、那一場是這件委託發起的）。
 * fails_commission 是 true：留下失敗的記號、回傳 rewind（entry），其餘交給核心回到進去之前。
 * 是 false：不回退，人留在這個階段、回到選分支之前。
 * 副本自訂的 defeat_event 寫明不算失敗時，戰敗功能已經把它算進 fails_commission 裡，這裡照它的結果走。
 */
export function onDefeatAccepted(k: Kernel, state: GameState, origin: Origin, result: Record<string, unknown>): ActivityEndReturn | undefined {
  const run = readRun(state)
  if (!run || run.step !== 'play' || !mineOf(run, origin)) return undefined
  const located = result.located === true
  if (result.fails_commission === true) return failReturn(k, run, isRecord(result) ? clone(result) : {}, located)
  return { changes: continueChanges(k, state, run, located), lines: ['這一趟沒有失敗：你回到這個階段選分支之前，委託還在。'] }
}

/**
 * 委託失敗：留下失敗的記號、回傳 rewind（entry），其餘交給核心回到進去之前。戰敗被接受（fails_commission）與內海被定位（N15）共用。
 * 被定位的（located）多記一份目標勢力的敵對值（規則表 net_located_hostility），回去之後那一份 commission.failed 才加。
 */
export function failReturn(k: Pick<Kernel, 'content'>, run: Run, defeat: Record<string, unknown>, located: boolean): ActivityEndReturn {
  const name = run.def.name ?? run.def.id
  const rules = netRules(k)
  const faction = run.def.target_faction !== 'none' && run.def.target_faction.trim() ? run.def.target_faction : null
  const hostile = located && faction !== null && rules.net_located_hostility > 0 ? { faction, amount: rules.net_located_hostility } : null
  const mark: FailedMark = {
    commission: run.def.id, name, origin: clone(run.origin), pending: true,
    // 失敗：評價最低，不給歷練點（CORE_RULES 7.1 節「戰敗後回退的不算」）；路線的後果跟著回去，不留（被定位的那一份例外，見 FailedMark.located）
    result: resultOf(run, { rating: 'C' satisfies Rating, xp: 0, defeat, ...(hostile ? { hostility: { faction: hostile.faction, delta: hostile.amount, reality: 0, assault: 0, located: true } } : {}) }),
    ...(hostile ? { located: hostile } : {}),
  }
  return {
    changes: [failedChange(mark)],
    lines: [`「${name}」失敗了。`],
    rewind: { kind: 'entry', summary: `「${name}」失敗了，所有進度回到進去之前；剛才那段經歷只留下紀錄。`, fresh: true },
  }
}

/**
 * 不算失敗的戰敗之後：留在這個階段，回到選分支之前。這一段的地圖關掉（遭遇下次選分支時重新放）、
 * 警戒收回來（這張地圖上漲的留著；連動「警戒不漲」的回到這一段開始的樣子）、拿到的連動留著、這一段選過的路線記錄拿掉（它要重選）。
 */
function continueChanges(k: Kernel, state: GameState, run: Run, located = false): Change[] {
  const changes: Change[] = []
  let alert = run.alert
  if (run.face === 'meat' && run.map) {
    alert = clamp(run.frozen ? (run.start_alert ?? run.alert) : meterOf(k, state, 'alert', run.map), 0, 100)
    if (state.maps.at?.map === run.map) changes.push({ op: 'map.at', to: null })
    if (state.maps.instances[run.map]) changes.push({ op: 'map.close', id: run.map })
  }
  // 內海的階段：netrun 已經自己收掉了；Run.trace 維持這一段開始前的值（這一段的追蹤度不收）。被定位的記下來，做完時敵對值另外加
  const next: Run = { ...run, step: 'branch', alert, peak: Math.max(run.peak, alert), route: run.route.filter((r) => r.stage !== run.stage), ...(located && run.face === 'net' ? { net_located: true as const } : {}) }
  for (const key of ['branch', 'map', 'start_alert', 'frozen', 'won', 'checked', 'scene', 'done', 'pressured', 'no_gives'] as const) delete next[key]
  changes.push(runChange(next))
  return changes
}

// ---- 回到入口之後 ----

/** 掛點 rewind.keep：回去之前（current）有還沒發的失敗記號，就放到回去之後的狀態（restored）裡。 */
export function keepFailed(current: GameState): Change[] | undefined {
  const mark = failedOf(current)
  return mark && mark.pending ? [failedChange(mark)] : undefined
}

/** 回去之後的那一份報告（action rewind）套用之後：有還沒發的失敗記號，接著提交 commission.failed，在那一份裡發 activity.end（outcome failed）。 */
export function failedDraft(k: Kernel, state: GameState): ReportDraft | undefined {
  const mark = failedOf(state)
  if (!mark || !mark.pending) return undefined
  const end = endActivity(k, { state, kind: ACTIVITY, id: mark.commission, origin: mark.origin, outcome: 'failed', result: mark.result })
  // 這一份已經是回去之後的：不會再開新的活動、也不會再回退（處理函式要的 launch 與 rewind 丟掉）
  const lines = [`「${mark.name}」失敗了。`, ...end.lines]
  // 被定位：目標勢力的敵對值另外加（回去之後的狀態上結算；沒有人註冊敵對值就只留在結果裡）
  const hostile: Change[] = []
  if (mark.located && k.effects.has(HOSTILITY_EFFECT)) {
    const res = k.effects.resolve([{ kind: HOSTILITY_EFFECT, key: mark.located.faction, amount: mark.located.amount }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length === 0) {
      hostile.push(...res.changes)
      lines.push(...res.lines)
    }
  }
  return {
    kind: 'gig', action: 'commission.failed', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [],
    changes: [failedChange({ ...mark, pending: false }), ...hostile, ...end.changes],
    outcome: { result: 'failed', summary: `「${mark.name}」失敗了。` },
    narration: { results: lines },
  }
}
