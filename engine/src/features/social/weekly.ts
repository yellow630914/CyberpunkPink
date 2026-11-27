// L6 功能 social 的每週（MEDIA 13.1 節「每週」、第 10 節；dev/work/M5-social.md「要做的」第 4 項）。
// 週一 06:00（time.passed，順序 11：帳單 10 之後）：追蹤的 3% 轉成訂閱（追蹤不減；效果 subs 有人註冊才給）；這一週一篇都沒發，追蹤流失 3%；清這一週的計數。
// 自己出一份報告 social.weekly（downtime）。追蹤是 0、而且這一週沒發過文（也沒有豔名計數）的什麼都不做。
// 一次時間跳過很多週時，每個週一各結一次（最多 max_catch_up 週）：第一週用記著的計數，其餘各週的計數都是 0。

import type { Change, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { clone, effectCtx, meterOf, toMinutes, weeklyCrossings } from '../../core'
import { FOLLOWERS, WEEKLY_ACTION, readSocial, socialRules } from './model'

const money = (n: number): string => n.toLocaleString('en-US')

/** 一個週一的結算：回報告草稿（沒有事可做是 null）；state 要是上一週都套完之後的狀態。 */
export function settleWeek(k: Kernel, state: GameState, at: number): ReportDraft | null {
  const rules = socialRules(k)
  const week = readSocial(state).week
  const followers = meterOf(k, state, FOLLOWERS)
  if (followers <= 0 && week.posts === 0 && week.fame === 0) return null
  const changes: Change[] = []
  const lines: string[] = []

  // 追蹤的 subs_pct % 轉成訂閱（追蹤不減）
  const toSubs = Math.floor((followers * rules.weekly.subs_pct) / 100)
  let subs = 0
  if (toSubs > 0 && k.effects.has('subs')) {
    const fx = [{ kind: 'subs', amount: toSubs }]
    const ctx = effectCtx(k, state, { source: 'builtin' })
    if (k.effects.validate(fx, ctx).length === 0) {
      const res = k.effects.resolve(fx, ctx)
      if (res.errors.length === 0 && res.changes.length > 0) {
        changes.push(...res.changes)
        subs = toSubs
        lines.push('社群上有些追蹤的人成了頻道的訂閱。')
      }
    }
  }

  // 一篇都沒發：追蹤流失 churn_pct %
  const idle = week.posts === 0
  const loss = idle ? Math.floor((followers * rules.weekly.churn_pct) / 100) : 0
  if (loss > 0) {
    changes.push({ op: 'meter', kind: FOLLOWERS, key: '_', delta: -loss })
    lines.push('這一週你一篇都沒發，有些追蹤的人走了。')
  }
  changes.push({ op: 'social.week', reset: true })

  const after = followers - loss
  const summary = `社群的每週結算：${idle ? '這一週一篇都沒發，' : `這一週發了 ${week.posts} 篇，`}追蹤 ${money(followers)} → ${money(after)}${subs > 0 ? `，${money(subs)} 位轉成了訂閱` : ''}。`
  return {
    kind: 'downtime', action: WEEKLY_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{
      layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: summary, tag: WEEKLY_ACTION,
      data: { posts: week.posts, fame: week.fame, followers, to_subs: subs, loss, at },
    }],
    changes, outcome: { result: 'weekly', summary }, ...(lines.length > 0 ? { narration: { results: lines } } : {}),
  }
}

/**
 * time.passed（順序 11）：from 到 to 跨過的每一個週一各結一次（每週一份報告，最多補 max_catch_up 週）。
 * 最近的一份報告是回到快照的（rewind）時不結：那一刻時間往回走，不是時間過去。
 */
export function weeklyDrafts(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const last = state.reports[state.reports.length - 1]
  if (!last || last.rewind) return []
  const marks = weeklyCrossings(from, to, k.timeRules).map(toMinutes)
  if (marks.length === 0) return []
  const rules = socialRules(k)
  const out: ReportDraft[] = []
  let sim = state
  marks.slice(-rules.max_catch_up).forEach((m, i, all) => {
    const draft = settleWeek(k, sim, m)
    if (!draft) return
    out.push(draft)
    if (i < all.length - 1) {
      sim = clone(sim)
      k.changes.applyAll(sim, draft.changes)
    }
  })
  return out
}
