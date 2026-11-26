// L6 功能 channel 的開頻道與等級（MEDIA 第 4 節開頭、4.5；dev/adr/0020 V14、V18）。
// 任何人都能開頻道：取名、不花錢；訂閱設成 start_subs（預設 100），公信力、推薦權重用量表的起始值（50、0）。開了頻道才能開節目與直播（發文不必）。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, meterOf, toMinutes } from '../../core'
import { OPEN_ACTION, SUBS, channelRules, levelOf, readChannel, seatsOf } from './model'

/** 開頻道擋下的原因（成立是 null）。名字只擋空的：打的字原樣存，太長的由 openChannel 照字截斷。 */
export function openBlock(k: Pick<Kernel, 'activity'>, state: GameState, name: string): string | null {
  if (readChannel(state).open) return '你已經有頻道了。'
  if (typeof name !== 'string' || name.trim().length === 0) return '頻道要有一個名字。'
  return k.activity.blockOf(state, `commit:${OPEN_ACTION}`)
}

/** 開頻道：名字照 name_max 字截斷（照「字」算，原樣存、不 trim），訂閱不到 start_subs 的補到 start_subs。 */
export function openChannel(k: Pick<Kernel, 'activity' | 'content' | 'meters'>, state: GameState, name: string): ReportDraft {
  const block = openBlock(k, state, name)
  if (block) throw new ActionBlocked(block)
  const rules = channelRules(k)
  const chars = Array.from(name)
  const stored = chars.length > rules.name_max ? chars.slice(0, rules.name_max).join('') : name
  const subs = meterOf(k, state, SUBS)
  const changes: Change[] = [{ op: OPEN_ACTION, name: stored, at: toMinutes(state.time) }]
  if (subs < rules.start_subs) changes.push({ op: 'meter', kind: SUBS, key: '_', set: rules.start_subs })
  const text = `你開了頻道「${stored}」，訂閱 ${Math.max(subs, rules.start_subs)} 人。${stored !== name ? `名字太長，只留了前 ${rules.name_max} 個字。` : ''}`
  return {
    kind: 'broadcast', action: OPEN_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: OPEN_ACTION, data: { name: stored, subs: Math.max(subs, rules.start_subs) } }],
    changes, outcome: { result: 'ok', summary: text },
  }
}

/** 現在的頻道等級：沒有頻道是 0；其餘 1 起，訂閱到一個門檻升一級（預設 1,000、10,000）。 */
export function channelLevel(k: Pick<Kernel, 'content' | 'meters'>, state: GameState): number {
  return readChannel(state).open ? levelOf(channelRules(k), meterOf(k, state, SUBS)) : 0
}

/** 現在的編制位子數（MEDIA 4.5：1 級 2 格、2 級 3 格、3 級 4 格；沒有頻道是 0）。 */
export function channelSeats(k: Pick<Kernel, 'content' | 'meters'>, state: GameState): number {
  return seatsOf(channelRules(k), channelLevel(k, state))
}
