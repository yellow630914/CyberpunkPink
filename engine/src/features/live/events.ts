// L6 功能 live 的亮點（MEDIA 1.2 節；dev/adr/0020 第三節、V22、V23；dev/work/M5-live.md 要做的 4、5）。
// 掛鉤 report.before 看每一份草稿：對出事件、照模板加熱度（max_from 夾每一種的上限）、記進 counts 與 highlights，變更接在那一份後面（所以回退、重來時熱度跟著走）；
// 模板有 risk.hostility_mult 時，同一份草稿裡加在勢力敵對值上的正數補一筆多出來的部分（進位）。
//
// 事件從報告的 action 與每一拍的標籤對出來（封閉清單 EVENTS）：
//   戰鬥（battle.start、battle.step 的每一拍；結束那一份 battle.end 是把每一步重述一次，不算，不然每件事算兩次）：
//     crit（tag crit，攻擊的人是我方）、overload_foe（tag overload，被打的是敵方）、foe_down（tag down 或 subdue，退出的是敵方）、ally_down（同上，退出的是我方）、
//     battle_won／battle_lost（tag battle.end，data.outcome 是 win／lose 或 surrender）
//   副本：commission.milestone → stage_done；commission.branch → branch
//   成人場景：scene.act → scene_act（玩家按「等著」的那一步不算；被視窗換掉的行動照換了之後的算一次，不多算）；scene.end → scene_end
// 單位在哪一邊先查 state.battle，查不到（這一步才進場的）用單位 id 的開頭（a 是我方、f 是敵方）。
// 數不出來的：「有人只剩一口氣」（MEDIA 1.2 的戰鬥亮點）——現在沒有這種標籤。

import type { Change, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { isRecord } from '../../core'
import type { LiveEvent, LiveRules, TemplateEntry } from './model'
import { isText, liveRules, liveSession, templateById } from './model'

const sideOf = (state: GameState, id: unknown): 'ally' | 'foe' | undefined => {
  if (!isText(id)) return undefined
  const u = state.battle?.units[id]
  if (u) return u.side
  return id.startsWith('a') ? 'ally' : id.startsWith('f') ? 'foe' : undefined
}

function battleEvents(state: GameState, beats: readonly TimelineBeat[]): LiveEvent[] {
  const out: LiveEvent[] = []
  for (const b of beats) {
    const d = isRecord(b.data) ? b.data : {}
    switch (b.tag) {
      case 'crit': if (sideOf(state, d.attacker) === 'ally') out.push('crit'); break
      case 'overload': if (sideOf(state, d.target) === 'foe') out.push('overload_foe'); break
      case 'down': case 'subdue': {
        const side = d.side === 'foe' || d.side === 'ally' ? d.side : sideOf(state, d.target)
        if (side === 'foe') out.push('foe_down')
        else if (side === 'ally') out.push('ally_down')
        break
      }
      case 'battle.end':
        if (d.outcome === 'win') out.push('battle_won')
        else if (d.outcome === 'lose' || d.outcome === 'surrender') out.push('battle_lost')
        break
      default: break
    }
  }
  return out
}

/** 這一份草稿有哪些事件（照出現的順序）。純函式。 */
export function eventsOf(state: GameState, draft: Pick<ReportDraft, 'action' | 'timeline'>): LiveEvent[] {
  const action = draft.action ?? ''
  if (action.startsWith('battle.')) return action === 'battle.end' || action === 'battle.abort' ? [] : battleEvents(state, draft.timeline)
  if (action === 'commission.milestone') return ['stage_done']
  if (action === 'commission.branch') return ['branch']
  if (action === 'scene.act') return draft.timeline.some((b) => b.tag === 'end_turn') ? [] : ['scene_act']
  if (action === 'scene.end') return ['scene_end']
  return []
}

/** 這種事件在這個模板的上限（沒寫的不設；成人直播的 scene_act 沒寫用規則的 adult_cap）。 */
export function capOf(tpl: TemplateEntry, rules: LiveRules, event: string): number {
  const own = tpl.max_from && Object.hasOwn(tpl.max_from, event) ? tpl.max_from[event]! : undefined
  return own ?? (tpl.scope === 'adult' && event === 'scene_act' ? rules.adult_cap : Infinity)
}

/** 敵對值 ×N：同一份草稿裡加在勢力敵對值上的正數，補一筆多出來的（總共進位成 ceil(原本 × N)）。 */
export function hostilityExtra(changes: readonly Change[], mult: number): Change[] {
  const out: Change[] = []
  for (const c of changes) {
    if (c.op !== 'meter' || c.kind !== 'hostility' || typeof c.delta !== 'number' || !Number.isFinite(c.delta) || c.delta <= 0 || typeof c.key !== 'string') continue
    const extra = Math.ceil(c.delta * mult - 1e-9) - c.delta
    if (extra > 0) out.push({ op: 'meter', kind: 'hostility', key: c.key, delta: extra })
  }
  return out
}

/** 掛鉤 report.before。 */
export function onReportBefore(k: Kernel, state: GameState, draft: ReportDraft): Change[] | undefined {
  // 回到快照的那一份是補結算的（rewind.ts），不是一場直播裡的事
  if (draft.action === 'rewind') return undefined
  const ses = liveSession(state)
  if (!ses || ses.mode !== 'activity') return undefined
  const tpl = templateById(k, ses.template)
  if (!tpl) return undefined
  const out: Change[] = []
  // 這一份已經把直播收掉了（宿主結束）：事件不再算，不然變更接在收播後面會沒有這一場可以加
  if (!draft.changes.some((c) => c.op === 'live.close' || c.op === 'live.open')) {
    const events = eventsOf(state, draft)
    if (events.length > 0) {
      const rules = liveRules(k)
      const heatOf = new Map(tpl.highlights.map((h) => [h.event, h.heat]))
      const added: Record<string, number> = {}
      const report = `r${state.seq.report + 1}`
      let heat = 0
      const list = events.map((event) => {
        const room = capOf(tpl, rules, event) - (ses.from[event] ?? 0) - (added[event] ?? 0)
        const give = Math.max(0, Math.min(heatOf.get(event) ?? 0, room))
        added[event] = (added[event] ?? 0) + give
        heat += give
        return { event, heat: give, report }
      })
      out.push({ op: 'live.add', events: list, heat, tips: heat * rules.heat_tips })
    }
  }
  const mult = tpl.risk?.hostility_mult
  if (mult !== undefined && mult > 1 && k.meters.has('hostility')) out.push(...hostilityExtra(draft.changes, mult))
  return out.length > 0 ? out : undefined
}
