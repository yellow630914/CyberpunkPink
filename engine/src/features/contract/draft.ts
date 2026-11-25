// L6 功能 contract 的報告骨架與檢定的小工具（play.ts、time.ts 共用）。

import type { ActorId, Change, CheckRoll, GameState, Kernel, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { DEGREE_NAME, checkParts, clone, dcFor, makeCheck } from '../../core'
import type { Contract } from './model'
import { DOCILITY_STAT, contractRules, pcOf, sinkPenalty } from './model'

export const pcName = (state: GameState): string => state.actors[state.pc ?? '']?.name ?? '你'

/** 一份報告的骨架。text 空的是 system（不給玩家看）。 */
export function draftOf(
  state: GameState, kind: ReportDraft['kind'], action: string, changes: Change[], lines: string[], result: string,
  extra: { triggers?: ReportDraft['triggers']; beats?: TimelineBeat[] } = {},
): ReportDraft {
  const pc = pcOf(state)
  const text = lines.join('')
  const beats: TimelineBeat[] = [...lines.map((t): TimelineBeat => ({ layer: 'meat', ...(pc ? { actor: pc } : {}), text: t, tag: action })), ...(extra.beats ?? [])]
  return {
    kind: text ? kind : 'system', action, location: clone(state.location), ...(pc ? { actor: pc } : {}), party: [], timeline: text ? beats : [], changes,
    outcome: { result, summary: text || '時間又過了一些。' }, ...(text ? { narration: { results: lines } } : {}),
    ...(extra.triggers && extra.triggers.length > 0 ? { triggers: extra.triggers } : {}),
  }
}

export const rollBeat = (actor: ActorId, roll: CheckRoll, tag: string): TimelineBeat => ({
  layer: 'meat', actor, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag, data: { degree: roll.degree },
})

/** 一次檢定（加值已定）過關的機率：自然骰 1～20 各一次，成功與大成功算過。 */
export function passChance(parts: RollPart[], dc: number): number {
  let ok = 0
  for (let n = 1; n <= 20; n++) {
    const d = makeCheck({ natural: n, parts, dc }).degree
    if (d === 'success' || d === 'critical') ok++
  }
  return ok / 20
}

export interface ResistPlan {
  dc: number
  /** DC 是怎麼湊出來的（給畫面一列一列寫） */
  breakdown: Array<{ label: string; value: number }>
  parts: RollPart[]
  /** 抗拒成功的機率（0～1） */
  chance: number
}

export const RESIST_ATTR = 'resolve'
export const RESIST_SKILL = 'composure'
export const RESIST_TAGS = ['resist_control']

/** 抗拒的 DC 與成功率：12 ＋ 4（管理級）＋ ⌊馴化有效值 ÷ 10⌋ ＋ 沉溺的懲罰 − 主僕關係（夥伴、戀人）。DC 另外加存檔難度的偏移。 */
export function resistPlan(k: Kernel, state: GameState, actor: ActorId, c: Contract): ResistPlan {
  const r = contractRules(k).resist
  const docility = k.stats.hasStat(DOCILITY_STAT) ? k.stats.stat(state, actor, DOCILITY_STAT) : 0
  const sink = state.actors[actor]?.sink ?? 0
  const breakdown = [
    { label: '基本', value: r.base }, { label: '管理級', value: r.manage }, { label: '馴化', value: Math.floor(docility / r.docility_div) },
    { label: '沉溺', value: sinkPenalty(r.sink, sink) }, { label: '主僕關係', value: c.relation === 'partner' || c.relation === 'lover' ? r.relation : 0 },
  ].filter((b) => b.value !== 0 || b.label === '基本')
  const dc = dcFor(breakdown.reduce((s, b) => s + b.value, 0), state.rules)
  const parts = checkParts(k.stats, state, actor, { attr: RESIST_ATTR, skill: RESIST_SKILL, tags: RESIST_TAGS })
  return { dc, breakdown, parts, chance: passChance(parts, dc) }
}
