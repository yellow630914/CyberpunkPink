// L6 功能 drugs 隨時間發生的事（dev/work/M4-drugs.md 第 4、5 點；ITEMS 4.1 節；DOWNTIME 3.5 節）。
//   time.passed  時間到的藥效過了（跑 after：instant 的效果、藥效過後的被動效果）、每個週一這一週沒用過的藥成癮 −weekly_decay、
//                依賴的人停藥滿幾天進入戒斷（重度的天數短、懲罰加倍）、戒斷期過完成癮歸零。出一份 drug.wear_off 報告（每個人一份）。
//                一次跨好幾天（睡覺、旅行）時照時間順序算：週一的消退、戒斷的開始與結束各發生在它們真正的時刻。
//   rest.done    喘口氣、階段之間的喘口氣（也包括睡一覺）：持續「一場戰鬥」的藥效結束，跑 after。回傳的只有變更，所以在 pending 留一筆 notice，
//                report.after 補一份 drug.wear_off 說「藥效結束了」。
// 「這一週用過」看 row.last 在不在那個週一之前的七天裡（used_week 只是寫的時候順手記的）。

import type { ActorId, Change, Effect, GameState, GameTime, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { clone, isRecord, toMinutes, weeklyCrossings, weeklyRule } from '../../core'
import type { AddictionRow, DrugsExt, WithdrawalRow } from './model'
import { DAY, EXT, WEAR_OFF_ACTION, drugDef, drugRules, nameOfDrug, nowOf, readDrugs, writeDrugs } from './model'
import { resolveEffects } from './dose'

type Kind = 'worn_off' | 'withdrawal' | 'recovered' | 'decay'
interface Note {
  kind: Kind
  text: string
  drug?: string
}

/** 有 ext.drugs 的角色（沒有的不必算）。 */
const withDrugs = (state: GameState): ActorId[] => Object.keys(state.actors).filter((id) => isRecord(state.actors[id]!.ext[EXT]))

/** 一份 drug.wear_off 報告的骨架。 */
function wearOffDraft(state: GameState, actor: ActorId, notes: Note[], effectLines: string[], changes: Change[]): ReportDraft {
  const order: Kind[] = ['withdrawal', 'recovered', 'worn_off', 'decay']
  const result = order.find((kind) => notes.some((n) => n.kind === kind)) ?? 'worn_off'
  const lines = [...notes.map((n) => n.text), ...effectLines]
  const beats: TimelineBeat[] = [
    ...notes.map((n) => ({ layer: 'meat' as const, actor, text: n.text, tag: WEAR_OFF_ACTION, data: { kind: n.kind, ...(n.drug ? { drug: n.drug } : {}) } })),
    ...effectLines.map((text) => ({ layer: 'meat' as const, actor, text, tag: 'drug.note' })),
  ]
  return {
    kind: 'downtime', action: WEAR_OFF_ACTION, location: clone(state.location), actor, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}

/** time.passed：每個人一份。 */
export function timePassed(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const nowTo = toMinutes(to)
  const mondays = weeklyCrossings(from, to, k.timeRules).map(toMinutes)
  const rules = drugRules(k)
  const week = weeklyRule(k.timeRules).every
  const out: ReportDraft[] = []
  for (const actor of withDrugs(state)) {
    const d = readDrugs(state, actor)
    const notes: Note[] = []
    const instants: Effect[] = []
    const name = (id: string): string => nameOfDrug(k, id)

    // 1. 時間到的藥效（被戰鬥接住的撐到喘口氣）
    const expired = d.active.filter((a) => !a.battle && a.until <= nowTo).sort((x, y) => x.until - y.until)
    if (expired.length > 0) {
      d.active = d.active.filter((a) => a.battle || a.until > nowTo)
      for (const e of expired) {
        notes.push({ kind: 'worn_off', text: `${name(e.id)}的藥效過了。`, drug: e.id })
        const def = drugDef(k, e.id)
        if (!def?.after) continue
        instants.push(...clone(def.after.instant))
        const end = e.until + def.after.minutes
        if (def.after.effects.length > 0 && def.after.minutes > 0 && end > nowTo) d.pending.push({ at: end, drug: e.id, kind: 'after' })
      }
    }
    // 休息留的 notice 已經由同一份報告的 report.after 寫成報告了（它先跑），這裡整份寫回時不能把它帶回去
    d.pending = d.pending.filter((p) => p.kind === 'after' && p.at > nowTo)

    // 2. 成癮：週一的消退、戒斷的開始與結束，照時間順序
    const decayed: Array<[string, number]> = []
    for (const id of Object.keys({ ...d.addiction, ...d.withdrawal })) {
      let row: AddictionRow | undefined = d.addiction[id]
      let wd: WithdrawalRow | undefined = d.withdrawal[id]
      const def = drugDef(k, id)
      const tryStart = (limit: number): void => {
        if (wd || !row || !def?.addiction || row.value < rules.depend_at) return
        const heavy = row.value >= rules.heavy_at
        const start = row.last + (heavy ? rules.heavy_days : rules.depend_days) * DAY
        if (start > limit) return
        wd = { until: start + def.addiction.withdrawal.days * DAY, heavy }
        notes.push({ kind: 'withdrawal', text: `${def.name}斷了藥，進入${heavy ? '重度的' : ''}戒斷（${def.addiction.withdrawal.days} 天）。`, drug: id })
      }
      const tryEnd = (limit: number): void => {
        if (!wd || wd.until > limit) return
        notes.push({ kind: 'recovered', text: `${name(id)}的戒斷期過完了，成癮歸零。`, drug: id })
        wd = undefined
        row = undefined
      }
      for (const m of mondays) {
        tryStart(m)
        tryEnd(m)
        if (!row) continue
        // 這一週（這個週一之前的七天）沒用過的才退
        if (row.last < m - week) {
          row.value = Math.max(0, row.value - rules.weekly_decay)
          decayed.push([id, row.value])
        }
        row.used_week = row.last >= m
        if (row.value <= 0 && !wd) row = undefined
      }
      tryStart(nowTo)
      tryEnd(nowTo)
      if (row) d.addiction[id] = row
      else delete d.addiction[id]
      if (wd) d.withdrawal[id] = wd
      else delete d.withdrawal[id]
    }
    if (decayed.length > 0) {
      const last = new Map(decayed)
      notes.push({ kind: 'decay', text: `這一週沒用的藥，成癮各退了 ${rules.weekly_decay}：${[...last].map(([id, v]) => `${name(id)}（剩 ${v}）`).join('、')}。` })
    }
    if (notes.length === 0) continue
    const fx = resolveEffects(k, state, actor, instants)
    out.push(wearOffDraft(state, actor, notes, fx.lines, [writeDrugs(actor, d), ...fx.changes]))
  }
  return out
}

// ---- 休息 ----

/** rest.done：持續「一場戰鬥」的藥效結束。state 是休息做完之前的狀態。 */
export function restDone(k: Kernel, state: GameState): Change[] | undefined {
  const now = nowOf(state)
  const changes: Change[] = []
  for (const actor of withDrugs(state)) {
    const d: DrugsExt = readDrugs(state, actor)
    const ended = d.active.filter((a) => (a.battle === true || a.until > now) && drugDef(k, a.id)?.duration?.battle === true)
    if (ended.length === 0) continue
    d.active = d.active.filter((a) => !ended.includes(a))
    const instants: Effect[] = []
    for (const e of ended) {
      d.pending.push({ at: now, drug: e.id, kind: 'notice' })
      const def = drugDef(k, e.id)
      if (!def?.after) continue
      instants.push(...clone(def.after.instant))
      if (def.after.effects.length > 0 && def.after.minutes > 0) d.pending.push({ at: now + def.after.minutes, drug: e.id, kind: 'after' })
    }
    changes.push(writeDrugs(actor, d), ...resolveEffects(k, state, actor, instants).changes)
  }
  return changes.length > 0 ? changes : undefined
}

/** report.after：把 rest.done 留下的 notice 寫成一份 drug.wear_off 報告（每個人一份），並把 notice 拿掉。 */
export function noticeDrafts(k: Kernel, state: GameState): ReportDraft[] {
  const out: ReportDraft[] = []
  for (const actor of withDrugs(state)) {
    const d = readDrugs(state, actor)
    const notices = d.pending.filter((p) => p.kind === 'notice')
    if (notices.length === 0) continue
    d.pending = d.pending.filter((p) => p.kind !== 'notice')
    const notes: Note[] = notices.map((p) => ({ kind: 'worn_off', text: `${nameOfDrug(k, p.drug)}的藥效結束了。`, drug: p.drug }))
    out.push(wearOffDraft(state, actor, notes, [], [writeDrugs(actor, d)]))
  }
  return out
}
