// L7 外殼：事件的 adult_scene.gate: ai 走 scene_gate（M4-followups-2 第 7 項；DATA 第 4 節的 adult_scene.gate；dev/adr/0019 M4-core-scene-ai 補記「缺的接口」(4)）。
//
// 事件資料的 adult_scene 寫 gate: 'ai' 時，不是照寫的性質直接開場景，而是先問 scene_gate（進不進、性質與目的、分圈）。這裡是給「寫正文的鏈」（narrated）多的兩步：
//   gate（AI：scene_gate）→ setup（程式：把答案換進報告的 launch）。報告草稿裡 launch 的 scene 帶 gate: 'ai' 才走；AI 關著、sceneAi 是 off、
//   scene_gate 被拒絕或交不出合格的結果（走退路）時，launch 一個字不動，等於 gate: fixed 的 M2 做法（AI 關閉時行為不變）。
//   AI 說不進：拿掉那一筆 launch（事件照常結算，只是沒有場景）；AI 說進：照它給的性質、目的、分圈開（驗得過 startProblems 才換，驗不過維持原樣）。
// 輸入照 adult_action 那一條鏈的 GateInput 一樣的形狀（共用 gateInput）。

import type { ActorId, GameState, Kernel, Launch, ReportDraft } from '../../core'
import { contentAllowed, isRecord, meterOf } from '../../core'
import type { Goal, Nature, SceneSetup } from '../../features/scene'
import { GOALS, GOAL_NAME, NATURE_FILTER, NATURE_NAME, startProblems, tendencyTagIds } from '../../features/scene'
import { callsFor } from './people'
import type { GateFixed, GateInput, GateOutput } from './sceneTasks'
import { GATE_NATURES } from './sceneTasks'

/** 這份報告有沒有要問 scene_gate 的場景（launch 的 scene 帶 gate: ai）。 */
export const hasAiGate = (draft: ReportDraft): boolean => (draft.launch ?? []).some(isAiGate)

const isAiGate = (l: Launch): boolean => l.kind === 'scene' && isRecord(l.setup) && l.setup.gate === 'ai'

/** 場景設定裡主角以外的人（circles 展開；沒有就是 with）。 */
function castOf(spec: Record<string, unknown>, pc: ActorId | null): ActorId[] {
  const ids: string[] = Array.isArray(spec.circles) ? (spec.circles as unknown[]).flatMap((c) => (Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [])) : Array.isArray(spec.with) ? (spec.with as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return [...new Set(ids)].filter((id) => id !== pc)
}

/** scene_gate 的輸入（adult_action 的 gateInputOf 與事件共用）：在場的人、可選的性質與目的（依內容篩選刪過）、觸發它的東西。 */
export function gateInput(k: Kernel, state: GameState, o: { cast: ActorId[]; trigger: GateInput['trigger']; forced: boolean; fixed?: GateFixed }): GateInput {
  return {
    pc: { id: state.pc!, name: state.actors[state.pc!]!.name },
    cast: o.cast.filter((id) => !!state.actors[id]).map((id) => ({
      id, name: state.actors[id]!.name, ...callsFor(state, id), affinity: meterOf(k, state, 'affinity', id),
      tags: tendencyTagIds(state.actors[id]).filter((t) => contentAllowed(state.rules, t)).map((t) => (k.content.get('tendency_tag', t)?.name as string | undefined) ?? t),
    })),
    trigger: o.trigger,
    // 清單已經依內容篩選刪過：被關掉的性質根本不在裡面
    natures: GATE_NATURES.filter((n) => { const f = NATURE_FILTER[n]; return !f || contentAllowed(state.rules, f.tag) }).map((n) => ({ id: n, name: NATURE_NAME[n] })),
    goals: GOALS.map((g) => ({ id: g, name: GOAL_NAME[g] })),
    forced: o.forced,
    ...(o.fixed ? { fixed: o.fixed } : {}),
  }
}

/** 事件結算那一份報告帶的第一筆要問 scene_gate 的場景，換成 scene_gate 的輸入。 */
export function eventGateInput(k: Kernel, state: GameState, draft: ReportDraft): GateInput {
  const l = (draft.launch ?? []).find(isAiGate)
  if (!l || !state.pc) throw new Error('這份報告沒有要問 scene_gate 的場景。')
  const spec = l.setup as Record<string, unknown>
  const nature = typeof spec.nature === 'string' ? (spec.nature as Nature) : undefined
  const fixed: GateFixed | undefined = nature
    ? {
      nature, ...(typeof spec.role === 'string' ? { role: spec.role as GateFixed['role'] } : {}), ...(typeof spec.goal === 'string' && spec.goal !== 'none' ? { goal: spec.goal as Goal } : {}),
      ...(typeof spec.place === 'string' ? { place: spec.place } : {}), ...(Array.isArray(spec.with) ? { with: spec.with as string[] } : {}), ...(Array.isArray(spec.circles) ? { circles: spec.circles as string[][] } : {}),
    }
    : undefined
  return gateInput(k, state, {
    cast: castOf(spec, state.pc),
    trigger: { action: '事件', degree: draft.outcome.result, summary: draft.outcome.summary, ...(typeof spec.place === 'string' ? { place: spec.place } : {}) },
    forced: nature === 'forced', ...(fixed ? { fixed } : {}),
  })
}

/** setup 那一步的結果：換過的 launch（整份）；沒有要換（AI 沒交、驗不過）是 null。 */
export interface EventGateResult {
  launch: Launch[] | null
  note?: string
}

/**
 * 把 scene_gate 的答案換進報告的 launch：不進就拿掉那一筆；進就把性質、目的、分圈換進設定（gate 改成 fixed，其餘的鍵原樣）。
 * 換進去的設定要過 startProblems，過不了維持原樣（走照寫的）。gate 是 undefined（AI 沒交、走了退路）回傳 null：launch 不動。
 */
export function applyGate(k: Kernel, state: GameState, draft: ReportDraft, gate: GateOutput | undefined): EventGateResult {
  if (!gate) return { launch: null }
  const launch = (draft.launch ?? []).map((l) => ({ ...l }))
  const out: Launch[] = []
  for (const l of launch) {
    if (!isAiGate(l)) { out.push(l); continue }
    if (!gate.enter || !gate.nature) continue
    const spec = l.setup as Record<string, unknown>
    const setup = { ...spec, nature: gate.nature, gate: 'fixed', ...(gate.goal ? { goal: gate.goal } : {}), ...(gate.circles ? { circles: gate.circles } : {}) } as SceneSetup
    if (startProblems(k, state, setup).problems.length > 0) {
      out.push({ ...l, setup: { ...spec, gate: 'fixed' } })
      continue
    }
    out.push({ ...l, setup })
  }
  return { launch: out, note: gate.enter ? undefined : gate.reason }
}
