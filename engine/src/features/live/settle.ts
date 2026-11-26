// L6 功能 live 的收播（MEDIA 1.2 節；dev/adr/0020 第三節、V25、V26；dev/work/M5-live.md 要做的 6）。
// 收播的算法只有一套（settleSession）：宿主結束（activity.end）、提早收播（cutLive）、回到快照時還在播的那一場（rewind.ts）都走它：
//   目標逐條照 counts 檢查（每條 +熱度與打賞）→ 訂閱 = 熱度 × 6 ＋ 觀看數 ÷ 400、打賞 = 熱度 × 8 ＋ 達成的目標各自的打賞 → 請 media 記一則（media.record；沒裝就沒有）
//   → 發 activity.end（種類 live；頻道把它記成一集）→ 記進 log、清掉 session。
// 宿主結束時收播不出自己的報告：結算併在宿主結束的那一份裡（changes 與句子；結果在 live.close 那一筆的 entry 與 live.end 那一拍——提早收播的報告才有那一拍）。
// 沒有頻道（量表 subs 沒人定義、或這一場不進頻道）就沒有訂閱，只有打賞；沒有 media 就沒有紀錄。

import type { ActivityEndReturn, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, endActivity, meterOf, toMinutes } from '../../core'
import type { GoalRow, HostKind, Session, Settled, Viewers } from './model'
import { CUT_ACTION, HOST_NAME, LOST_OUTCOMES, OWNER, RECORD_QUALITY_STAT, capOnly, goalMet, liveRules, liveSession, partyMax, subsOfHeat, templateById, viewersFrom } from './model'

// media 的掛點用字串名字問（media 已經用 declare module 宣告了型別，這裡不 import 別的功能、也不重複宣告）
type AnyHook = (name: string, payload: unknown) => Array<{ owner: string; result: unknown }>
const askHook = (k: Kernel, name: string, payload: unknown): Array<{ owner: string; result: unknown }> => (k.hooks.run as unknown as AnyHook).call(k.hooks, name, payload)
const hookOwners = (k: Kernel, name: string): string[] => (k.hooks.owners as unknown as (n: string) => string[]).call(k.hooks, name)

export interface SettleOpts {
  /** 宿主怎麼收場（activity.end 的 outcome）；提早收播與回到快照各自寫 cut、rewind */
  outcome: string
  /** 提早收播：只有「最多幾次」的目標還沒到終點，不算達成 */
  early: boolean
  /** 宿主輸了（紀錄標戰敗的畫面） */
  lost: boolean
  /** 算訂閱與時間用的狀態；沒給就是 state（回到快照時 state 是回去之後的、這個是回去之前的） */
  numbers?: GameState
}

export interface Settlement {
  entry: Settled
  /** 訂閱、打賞、紀錄、別人聽 activity.end 回的變更（不含 live.close） */
  changes: Change[]
  /** 收掉這一場的那一筆變更 */
  close: Change
  lines: string[]
  /** activity.end（種類 live）發出去的 result */
  result: Record<string, unknown>
  viewers: Viewers
  goals: Array<{ id: string; text: string; heat: number; tip: number; done: boolean }>
}

const TYPE_OF_HOST: Record<HostKind, string> = { battle: 'battle', scene: 'intimate', commission: 'battle' }

/** 收一場直播：純函式，回傳要併進報告的變更與句子。 */
export function settleSession(k: Kernel, state: GameState, s: Session, o: SettleOpts): Settlement {
  const rules = liveRules(k)
  const num = o.numbers ?? state
  const goals = s.goals.map((g): GoalRow => ({ ...g, done: goalMet(g.check, s.counts) && !(o.early && capOnly(g.check)) }))
  const done = goals.filter((g) => g.done)
  const heat = s.heat + done.reduce((n, g) => n + g.heat, 0)
  const goalTips = done.reduce((n, g) => n + g.tip, 0)
  const viewers = viewersFrom(rules, meterOf(k, num, 'subs'), heat, s.house?.views_mult ?? 1)
  const toChannel = s.house?.to_channel !== false
  const subs = toChannel && k.meters.has('subs') ? subsOfHeat(rules, heat, viewers.viewers) : 0
  const tips = Math.floor((heat * rules.heat_tips + goalTips) * (s.house?.tips_mult ?? 1) + 1e-9)

  const changes: Change[] = []
  if (subs !== 0) changes.push({ op: 'meter', kind: 'subs', key: '_', delta: subs })
  if (tips > 0) changes.push({ op: 'cred', delta: tips })

  // 請 media 記一則（高品質、直播、宿主輸了帶戰敗的畫面）。live_record_quality 放在 hint（media 讀得到的是 hq；數字的欄位 quality 目前沒有人讀，見實作補記）
  let recorded = false
  if (hookOwners(k, 'media.record').length > 0) {
    const tpl = templateById(k, s.template)
    const kind = s.host?.kind
    const quality = partyMax(k, num, RECORD_QUALITY_STAT)
    const hint = {
      live: true, hq: true, ...(o.lost ? { lost: true } : {}), ...(kind ? { type: TYPE_OF_HOST[kind] } : {}), ...(kind === 'scene' ? { adult: true } : {}),
      ...(s.faction ? { involves: { factions: [s.faction] } } : {}), ...(quality > 0 ? { quality } : {}),
    }
    const label = `${tpl?.name ?? '直播'}${kind ? `（${HOST_NAME[kind]}）` : ''}`
    for (const a of askHook(k, 'media.record', { state, source: { kind: 'live', ref: s.id }, label, hint })) {
      if (Array.isArray(a.result) && a.result.length > 0) { changes.push(...(clone(a.result) as Change[])); recorded = true }
    }
  }

  const entry: Settled = {
    id: s.id, at: toMinutes(num.time), mode: s.mode, template: s.template, heat, subs, tips, goals_done: done.length,
    ...(recorded ? { record: true as const } : {}), ...(o.lost ? { lost: true as const } : {}),
    viewers: viewers.viewers, tier: viewers.tier, ...(s.grade !== undefined ? { grade: s.grade } : {}), ...(toChannel ? {} : { off_channel: true as const }),
  }
  const result: Record<string, unknown> = {
    mode: s.mode, template: s.template, heat, viewers: viewers.viewers, subs, tips, goals_done: done.length, to_channel: toChannel,
    ...(s.host ? { host: { kind: s.host.kind, id: s.host.id } } : {}), tier: viewers.tier, ...(s.grade !== undefined ? { grade: s.grade } : {}),
    ...(o.lost ? { lost: true } : {}), ...(s.secret ? { secret: true } : {}),
  }
  const end = endActivity(k, { state, kind: 'live', id: s.id, origin: { by: OWNER, ...(s.host ? { ref: s.host.id } : {}) }, outcome: o.early ? 'cut' : o.lost ? 'lost' : 'done', result })
  changes.push(...end.changes)

  // 結果的句子不帶機制數字（數字在變更與 live.end 那一拍的 data）
  const lines = ['直播收播了。']
  if (done.length > 0) lines.push('直播目標達成了。')
  if (subs > 0 && tips > 0) lines.push('訂閱漲了，打賞也入了帳。')
  else if (subs > 0) lines.push('訂閱漲了。')
  else if (tips > 0) lines.push('收到了一些打賞。')
  lines.push(...end.lines)

  return {
    entry, changes, close: { op: 'live.close', entry }, lines, result, viewers,
    goals: goals.map((g) => ({ id: g.id, text: g.text, heat: g.heat, tip: g.tip, done: g.done })),
  }
}

/** 掛鉤 activity.end：宿主（種類與 id 對得上）結束，就把這一場收掉，結算併進宿主結束的那一份。 */
export function onActivityEnd(k: Kernel, p: { state: GameState; kind: string; id: string; outcome: string }): ActivityEndReturn | undefined {
  const s = liveSession(p.state)
  if (!s || s.mode !== 'activity' || !s.host || s.host.kind !== p.kind || s.host.id !== p.id) return undefined
  const st = settleSession(k, p.state, s, { outcome: p.outcome, early: false, lost: LOST_OUTCOMES.includes(p.outcome) })
  return { changes: [...st.changes, st.close], lines: st.lines }
}

// ---- 提早收播 ----

/** 現在能不能提早收播：不能回傳完整的原因。 */
export function cutBlock(k: Kernel, state: GameState): string | null {
  const s = liveSession(state)
  if (!s) return '現在沒有在直播。'
  if (s.mode !== 'activity') return '時段直播要照時段的流程收播。'
  return k.activity.blockOf(state, `commit:${CUT_ACTION}`)
}

/**
 * 提早收播（活動直播）：和宿主結束時同一套結算，出自己的一份報告（live.cut，kind broadcast；那一拍 live.end 帶這一場的數字）。
 * 沒打完的時候只有「最多幾次」的目標還不算達成（還沒到終點，不然一開播就收等於白拿）。
 */
export function cutLive(k: Kernel, state: GameState): ReportDraft {
  const block = cutBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const s = liveSession(state)!
  const st = settleSession(k, state, s, { outcome: 'cut', early: true, lost: false })
  const e = st.entry
  const text = `你提早收了直播：熱度 ${e.heat}，觀看 ${st.viewers.viewers}，訂閱 ${e.subs >= 0 ? '+' : '−'}${Math.abs(e.subs)}，打賞 ${e.tips}。`
  return {
    kind: 'broadcast', action: CUT_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{
      layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: 'live.end',
      data: { id: e.id, mode: e.mode, heat: e.heat, goals: st.goals.filter((g) => g.done).map((g) => g.id), goals_done: e.goals_done, viewers: st.viewers.viewers, subs: e.subs, tips: e.tips, early: true },
    }],
    changes: [...st.changes, st.close],
    outcome: { result: 'cut', summary: text },
    narration: { results: st.lines },
  }
}
