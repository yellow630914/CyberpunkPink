// L6 功能 curtain 一趟裡面共用的小工具：報告草稿、隊上的人、檢定（取隊上加值最高的那一個）、效果的格式。

import type { ActorId, AttrId, Change, CheckRoll, GameState, Kernel, Launch, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { DEGREE_NAME, checkParts, clone, modeAttr, rollCheck } from '../../core'
import type { CheckDef, RunRecord } from './model'
import { USE_ACTION } from './model'

export const BUSY = '正在戰鬥，先把這一場打完。'

export const nameOf = (state: Pick<GameState, 'actors'>, id: ActorId): string => state.actors[id]?.name ?? id

/** 這一趟隊上的人（還在名冊裡的）。 */
export const partyOf = (state: Pick<GameState, 'actors'>, run: Pick<RunRecord, 'party'>): ActorId[] => run.party.filter((id) => !!state.actors[id])

/** 一份簾後館的報告草稿（kind netrun；位置照現在）。 */
export function draftOf(
  state: GameState, action: string, result: string, summary: string, changes: Change[],
  o: { lines?: string[]; beats?: TimelineBeat[]; launch?: Launch[] } = {},
): ReportDraft {
  const lines = o.lines ?? []
  return {
    kind: 'netrun', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: o.beats?.length ? o.beats : [{ layer: 'net', ...(state.pc ? { actor: state.pc } : {}), text: lines[0] ?? summary, tag: action }],
    changes, outcome: { result, summary }, ...(lines.length ? { narration: { results: lines } } : {}), ...(o.launch?.length ? { launch: o.launch } : {}),
  }
}

export const useDraft = (state: GameState, result: string, summary: string, changes: Change[], o: Parameters<typeof draftOf>[5] = {}): ReportDraft => draftOf(state, USE_ACTION, result, summary, changes, o)

export const isRoll = (r: Pick<CheckRoll, 'degree'>): boolean => r.degree === 'critical' || r.degree === 'success'

export interface Picked {
  id: ActorId
  def: CheckDef
  attr: AttrId
  mod: number
}

/** 隊上能擲這一種檢定的人與辦法裡加值最高的那一組（情境修正由 situation 給）。 */
export function bestCheck(k: Kernel, state: GameState, who: readonly ActorId[], defs: readonly CheckDef[], situation: (id: ActorId) => RollPart[] = () => []): Picked | null {
  let best: Picked | null = null
  for (const id of who) {
    for (const def of defs) {
      const attr = modeAttr(k.content, 'net', def.attr as AttrId)
      const mod = checkParts(k.stats, state, id, { attr, ...(def.skill ? { skill: def.skill } : {}), tags: [] }, situation(id)).reduce((s, p) => s + p.value, 0)
      if (!best || mod > best.mod) best = { id, def, attr, mod }
    }
  }
  return best
}

/** 擲一次：骰面由狀態的亂數與 purpose 導出（報告要帶 rng 變更讓下一次換一顆）。回傳這一拍與結果。 */
export function rollPicked(k: Kernel, state: GameState, pick: Picked, dc: number, purpose: string, label: string, situation: RollPart[] = []): { roll: CheckRoll; beat: TimelineBeat; ok: boolean } {
  const roll = rollCheck(k.stats, state, {
    actor: pick.id, attr: pick.attr, ...(pick.def.skill ? { skill: pick.def.skill } : {}), dc, purpose, tags: ['curtain'], ...(situation.length ? { situation } : {}),
  })
  const beat: TimelineBeat = {
    layer: 'net', actor: pick.id, tag: 'curtain.roll', roll, data: { dc },
    text: `${nameOf(state, pick.id)}${label}：${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`,
  }
  return { roll, beat, ok: isRoll(roll) }
}

export const rngStep: Change = { op: 'rng', advance: 1 }
