// L6 功能 sink 的每週（DOWNTIME 3.3 節「自然下降」；CORE_RULES 4.3 節的分段表；dev/adr/0019 P17、P19）。
// 每跨過一個週一 06:00（一次跨好幾週各算一次，最多補最近的三次），只看主角：
//   自然下降  上一週的計數器 sleeps:<週> 滿 decay.sleeps 而且沉溺不到 100：沉溺 −decay.amount，走 sink 效果（下限會擋）。
//   每週的事  那一刻沉溺所在的那一段（下降之前，也就是剛過完的那一週待的地方）：
//             weekly.hostility：替 watchers 的每個勢力加敵對值（量表 hostility 的效果；沒有人註冊、查不到勢力就略過）；
//             weekly.trigger：這一份報告帶那個觸發點（事件導演讀）。
// 沒有任何事發生就不出報告。每一次一份報告（action sink.week）；後面的週接著前面的結果算（用一份複製的狀態推下去）。
// 報告的句子不帶機制數字（M4-plan 規定 8）。

import type { Change, ContentEntry, GameState, GameTime, Kernel, ReportDraft, ReportTrigger, TimelineBeat } from '../../core'
import { clone, effectCtx, toMinutes, weeklyCrossings } from '../../core'
import type { SinkRules } from './model'
import { EXT_OP, MAX_CATCH_UP, SUNK_AT, WEEK_ACTION, bandOf, liveMods, nowOf, readExt, sinkRules, sleepKey, weekOf } from './model'

const HOSTILITY = 'hostility'

/** 觸發點的 where：現在在哪一區哪一塊（有站在設施上就帶設施的標記）。 */
function whereOf(state: GameState): Record<string, string> {
  const { district, block, facility } = state.location
  return { ...(district ? { district } : {}), ...(block ? { block } : {}), ...(facility ? { facility } : {}) }
}

/** 對一串效果走 resolve；整批不合格或有錯就是 null（略過，不讓壞資料擋住時間）。 */
function resolveAll(k: Kernel, state: GameState, actor: string, fx: Array<Record<string, unknown>>): { changes: Change[] } | null {
  const ctx = effectCtx(k, state, { source: 'builtin', actor })
  if (k.effects.validate(fx, ctx).length > 0) return null
  const res = k.effects.resolve(fx, ctx)
  return res.errors.length > 0 ? null : { changes: res.changes }
}

/** 一次週一的事：回傳這一份報告（沒有事是 null）。work 是這一週開始時的狀態。 */
function oneWeek(k: Kernel, work: GameState, rules: SinkRules, at: GameTime): ReportDraft | null {
  const pc = work.pc!
  const a = work.actors[pc]!
  const cur = a.sink
  const band = bandOf(rules, cur)
  const week = weekOf(k, toMinutes(at))
  const sleeps = work.counters[sleepKey(week - 1)] ?? 0
  const changes: Change[] = []
  const beats: TimelineBeat[] = []
  const say = (text: string, tag: string, data?: Record<string, unknown>): void => { beats.push({ layer: 'meat', actor: pc, text, tag, ...(data ? { data } : {}) }) }

  // 自然下降：睡得夠、沒到溺感者
  if (rules.decay.amount > 0 && sleeps >= rules.decay.sleeps && cur < SUNK_AT) {
    const r = resolveAll(k, work, pc, [{ kind: 'sink', amount: -rules.decay.amount }])
    if (r && r.changes.length > 0) {
      changes.push(...r.changes)
      say('這一週睡得夠，沉溺慢慢退了一點。', 'sink.decay', { sleeps })
    }
  }

  // 這一段每週的事
  const hostility = band.weekly?.hostility ?? 0
  if (hostility > 0 && k.effects.has(HOSTILITY)) {
    for (const faction of rules.watchers) {
      const r = resolveAll(k, work, pc, [{ kind: HOSTILITY, key: faction, amount: hostility }])
      if (!r || r.changes.length === 0) continue
      changes.push(...r.changes)
      const name = k.content.hasKind('faction') ? (k.content.get<ContentEntry & { name?: unknown }>('faction', faction)?.name as string | undefined) ?? faction : faction
      say(`${name}又多留意了你一些。`, 'sink.watch', { faction })
    }
  }
  const triggers: ReportTrigger[] = band.weekly?.trigger ? [{ point: band.weekly.trigger, where: whereOf(work) }] : []
  if (triggers.length > 0) say('身體裡有一股衝動，又在這個週一冒出來了。', 'sink.impulse', { band: band.id })

  if (changes.length === 0 && triggers.length === 0) return null
  // 過期的下限順手清掉
  const ext = readExt(work, pc)
  if (ext.floor_mods.length > liveMods(ext, nowOf(work)).length) changes.push({ op: EXT_OP, id: pc, prune: true } as Change)
  const summary = beats.map((b) => b.text).join('')
  return {
    kind: 'downtime', action: WEEK_ACTION, location: clone(work.location), actor: pc, party: [], timeline: beats, changes,
    outcome: { result: changes.length > 0 ? 'week' : 'impulse', summary },
    narration: { results: beats.map((b) => b.text) }, ...(triggers.length > 0 ? { triggers } : {}),
  }
}

/** 跨過的每個週一 06:00 各一份報告（最多最近三次）；沒有事就是 []。 */
export function weeklyDrafts(k: Kernel, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  if (!state.pc || !state.actors[state.pc]) return []
  const crossed = weeklyCrossings(from, to, k.timeRules).slice(-MAX_CATCH_UP)
  if (crossed.length === 0) return []
  const rules = sinkRules(k)
  const work = clone(state)
  const out: ReportDraft[] = []
  for (const at of crossed) {
    const draft = oneWeek(k, work, rules, at)
    if (!draft) continue
    k.changes.applyAll(work, draft.changes)
    out.push(draft)
  }
  return out
}
