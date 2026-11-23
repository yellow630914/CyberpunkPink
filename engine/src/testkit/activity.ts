// 測試基礎建設：玩具活動（dev/test-harness.md 第 1 節；dev/adr/0016 第一節）。
//
// TEST_ACTIVITY 是一個最小的活動，給核心與下游的測試當替身，不必等事件、成人場景、委託副本做完：
//   狀態     state.ext.toy：{ id, steps, goal, origin }，沒有在進行是 null
//   開始     Game.launch('toy', setup, origin) 或報告的 launch；setup 是 { goal?, refuse?, then? }
//            （refuse 是開不成的原因，一條一句；then 是開始的那份報告自己帶的 launch）
//   走一步   toyStep(state) 回傳報告草稿（toy.step）
//   結束     toyEnd(k, state, outcome) 回傳結束的報告草稿（toy.end）：發 activity.end，處理函式回傳的東西併進去
//   進行中   放行 toy.、commit:toy.，其餘全擋（原因：玩具活動進行中，先把它做完。）；order 20
// 活動的主人怎麼組「結束的那一份報告」（endActivity、attachActivityEnd），看 toyEnd 就是範例。

import type { GameState, Launch, Origin, ReportDraft } from '../core/types'
import type { Feature, Kernel } from '../core/kernel'
import { ActionBlocked } from '../core/action/action'
import type { ActivityDef } from '../core/action/activity'
import { attachActivityEnd, endActivity } from '../core/action/activity'
import { clone } from '../core/util/clone'
import { isRecord } from '../core/util/sanitize'

export const TOY = 'toy'

export interface ToyState {
  id: string
  steps: number
  goal: number
  origin: Origin
}

export interface ToySetup {
  /** 要走幾步才算做完（只是記著，toyEnd 不檢查）；預設 2 */
  goal?: number
  /** 開不成的原因：有寫就丟 ActionBlocked，句子照順序接起來 */
  refuse?: string[]
  /** 開始的那份報告自己帶的 launch（測連開幾層） */
  then?: Launch[]
}

/** 現在進行中的玩具活動；沒有是 null。 */
export function toyOf(state: GameState): ToyState | null {
  return isRecord(state.ext.toy) ? (state.ext.toy as unknown as ToyState) : null
}

const draftOf = (state: GameState, action: string, summary: string, result: string, changes: ReportDraft['changes']): ReportDraft => ({
  kind: 'event', action, location: clone(state.location), party: [], timeline: [], changes, outcome: { result, summary },
})

const TOY_ACTIVITY: ActivityDef = {
  kind: TOY, owner: TOY, order: 20,
  active: (s) => {
    const t = toyOf(s)
    return t ? { id: t.id, label: '玩具活動' } : null
  },
  allow: ['toy.', 'commit:toy.'],
  reason: () => '玩具活動進行中，先把它做完。',
  start(_k, state, setup, origin) {
    const s = (isRecord(setup) ? setup : {}) as ToySetup
    if (toyOf(state)) throw new ActionBlocked('已經有一個玩具活動在進行。')
    const refuse = Array.isArray(s.refuse) ? s.refuse.filter((x) => typeof x === 'string') : []
    if (refuse.length) throw new ActionBlocked(refuse.join(''))
    const toy: ToyState = { id: `y${state.seq.uid + 1}`, steps: 0, goal: typeof s.goal === 'number' ? s.goal : 2, origin: clone(origin) }
    const draft = draftOf(state, 'toy.start', '玩具活動開始了。', 'started', [{ op: 'uid', advance: 1 }, { op: 'ext', key: TOY, value: toy }])
    if (Array.isArray(s.then) && s.then.length) draft.launch = clone(s.then)
    return [draft]
  },
}

/** 玩具活動：裝在 makeGame 的 features 裡。 */
export const TEST_ACTIVITY: Feature = {
  id: TOY,
  install(k) {
    k.activity.define(TOY_ACTIVITY)
  },
}

/** 玩具活動走一步（toy.step）。沒有在進行丟錯。 */
export function toyStep(state: GameState): ReportDraft {
  const t = toyOf(state)
  if (!t) throw new Error('現在沒有玩具活動。')
  return draftOf(state, 'toy.step', `玩具活動走到第 ${t.steps + 1} 步。`, 'step', [{ op: 'ext', key: TOY, value: { ...t, steps: t.steps + 1 } }])
}

/**
 * 玩具活動結束（toy.end）：發 activity.end（kind 是 toy，result 是 { steps, goal }），處理函式回傳的 changes 接在後面、lines 進結果、
 * launch 與 rewind 放到報告上。沒有在進行丟錯。
 */
export function toyEnd(k: Kernel, state: GameState, outcome = 'done'): ReportDraft {
  const t = toyOf(state)
  if (!t) throw new Error('現在沒有玩具活動。')
  const end = endActivity(k, { state, kind: TOY, id: t.id, origin: t.origin, outcome, result: { steps: t.steps, goal: t.goal } })
  const draft = draftOf(state, 'toy.end', ['玩具活動結束了。', ...end.lines].join(''), outcome, [{ op: 'ext', key: TOY, value: null }, ...end.changes])
  if (end.lines.length) draft.narration = { results: end.lines }
  return attachActivityEnd(draft, end)
}
