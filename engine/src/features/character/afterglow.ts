// L6 角色：餘韻在戰鬥外隨時間消退（CORE_RULES 4.3 節「脫離戰鬥後每十分鐘消一層；短休與睡覺全消」；CYBERSPACE 4.1、6.7 節；B029）。
// 短休與睡覺全消是 features/rest 做的（同一份報告裡的 actor.track）；這裡做「每十分鐘消一層」。戰鬥裡時間不走（戰鬥的每一步不推時間），所以只要時間在走就是戰鬥外。
//
// 計時：actor.ext.glow_at 是這個人的餘韻從哪一分鐘（總分鐘數）起算十分鐘一層。
//   report.before：這份報告讓某個人的餘韻增加（actor.track afterglow、delta 正的；戰鬥結束、場景結束、效果都一樣），就把他的計時重新起算在這份報告結束的那一刻（含這份報告自己推的時間）。
//   time.passed：餘韻大於 0 的人，從計時起點到現在每滿十分鐘消一層（一次過很久就一次消完，最少到 0）；沒有消完的把起點往前推剛好消掉的那幾個十分鐘，消完的拿掉 glow_at。
//     只有真的消了一層（或第一次補上起點）才接一份報告；沒有計時起點的人（開局就帶著餘韻、舊存檔）從這一次時間經過的起點算。
// 冷卻劑（立刻消一層）不在這裡（它是戰鬥裡的道具）。

import type { Change, Kernel, ReportDraft } from '../../core'
import { clone, toMinutes } from '../../core'
import { OWNER } from './stats'

/** 脫離戰鬥後每幾分鐘消一層（CORE_RULES 4.3 節）。 */
export const GLOW_MINUTES = 10
/** actor.ext 的鍵：餘韻從哪一分鐘起算十分鐘一層。 */
export const GLOW_KEY = 'glow_at'

const isMinute = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 這份報告自己推了幾分鐘（所有 time 變更的合計）。 */
const spanOf = (changes: readonly Change[]): number => changes.reduce((n, c) => n + (c.op === 'time' && typeof c.minutes === 'number' && Number.isFinite(c.minutes) ? c.minutes : 0), 0)

export function installAfterglow(k: Kernel): void {
  k.hooks.on('report.before', OWNER, ({ state, draft }) => {
    const raised = new Set<string>()
    for (const c of draft.changes) if (c.op === 'actor.track' && c.track === 'afterglow' && typeof c.id === 'string' && typeof c.delta === 'number' && c.delta > 0) raised.add(c.id)
    if (!raised.size) return undefined
    const at = toMinutes(state.time) + spanOf(draft.changes)
    return [...raised].map((id): Change => ({ op: 'actor.ext', id, key: GLOW_KEY, value: at }))
  })

  k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
    const last = state.reports[state.reports.length - 1]
    if (!last || last.rewind) return undefined
    const now = toMinutes(to)
    const changes: Change[] = []
    const beats: ReportDraft['timeline'] = []
    for (const a of Object.values(state.actors)) {
      if (a.afterglow <= 0) continue
      const mark = a.ext[GLOW_KEY]
      const since = isMinute(mark) ? mark : toMinutes(from)
      const layers = Math.floor((now - since) / GLOW_MINUTES)
      if (layers <= 0) {
        // 還沒有計時起點的：這一次時間經過的起點就是起點，記下來（只記一次）
        if (!isMinute(mark)) changes.push({ op: 'actor.ext', id: a.id, key: GLOW_KEY, value: since })
        continue
      }
      const lose = Math.min(layers, a.afterglow)
      changes.push({ op: 'actor.track', id: a.id, track: 'afterglow', delta: -lose })
      changes.push({ op: 'actor.ext', id: a.id, key: GLOW_KEY, value: a.afterglow - lose > 0 ? since + layers * GLOW_MINUTES : null })
      beats.push({ layer: 'meat', actor: a.id, text: a.afterglow - lose > 0 ? `${a.name}的餘韻淡了一些。` : `${a.name}的餘韻都退了。`, tag: 'afterglow' })
    }
    if (!changes.length) return undefined
    const summary = beats.length ? beats.map((b) => b.text).join('') : '餘韻開始計時。'
    return [{
      kind: 'system', action: 'character.afterglow', location: clone(state.location), party: [], timeline: beats, changes,
      outcome: { result: beats.length ? 'faded' : 'timer', summary },
    }]
  })
}
