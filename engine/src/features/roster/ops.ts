// L6 功能 roster 的入口：進名冊、離開、召集（隊伍與同行）、設薪水，還有每週的忠誠。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
// 規格：NPC_SYSTEM 10.0（隊伍與同行）、10.4（忠誠）、10.6（離隊）、10.7（候選人）；COMMISSIONS 6.1 節；dev/work/M2-roster.md。

import type { Change, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, countCrossings, deriveRng, meterOf, toMinutes, weeklyCrossings, weeklyRule } from '../../core'
import type { CandidateSource, Member, PayKind } from './model'
import {
  busyReasons, isRunner, nameOf, readRoster, reliabilityOf, rosterCap, rosterRules, startLoyalty,
} from './model'

const own = (o: object, key: string): boolean => Object.hasOwn(o, key)
const placeOf = (state: Pick<GameState, 'location'>) => ({ ...state.location })
const draftOf = (state: GameState, kind: ReportDraft['kind'], action: string, changes: Change[], result: string, summary: string): ReportDraft => ({
  kind, action, location: placeOf(state), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [], changes, outcome: { result, summary },
})

// ---- 進名冊 ----

export interface JoinOpts {
  /** 出場費或分紅；固定夥伴預設分紅，其餘預設出場費 */
  pay?: PayKind
  /** 固定夥伴 */
  fixed?: boolean
  /** 候選人的來源決定忠誠的起始值（救過的 50、介紹的 40）；沒寫時看他在不在候選名單裡 */
  source?: CandidateSource
  /** 直接指定忠誠起始值與可靠度 */
  loyalty?: number
  reliability?: number
  /** 每週薪水（現金） */
  weekly?: number
}

/** 現在能不能把他放進名冊：回傳擋住的原因，可以就是 null。（只管容量與是不是角色；要不要是行者由招募自己看。） */
export function joinBlock(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: string): string | null {
  if (id === state.pc) return '主角不用進自己的名冊。'
  if (!own(state.actors, id)) return `查不到 ${id} 這個角色：要先讓他變成角色才能進名冊。`
  const name = state.actors[id]!.name
  const r = readRoster(state)
  if (own(r.members, id)) return `${name}已經在你的名冊上了。`
  const cap = rosterCap(k, state)
  const size = Object.keys(r.members).length
  if (size >= cap) return `名冊滿了（${size}／${cap}）：要先騰出位子，${name}才進得來。`
  return null
}

/** 進名冊要套的變更（不檢查；呼叫的人先問 joinBlock）：成員、忠誠起始值，並把他從候選與「再想想」拿掉。 */
export function joinChanges(k: Pick<Kernel, 'content'>, state: GameState, id: string, opts: JoinOpts = {}): Change[] {
  const rules = rosterRules(k)
  const r = readRoster(state)
  const source = opts.source ?? r.candidates.find((c) => c.who === id)?.source
  const fixed = opts.fixed === true
  const pay: PayKind = opts.pay ?? (fixed ? 'share' : 'fee')
  const reliability = Math.max(0, Math.min(100, Math.round(opts.reliability ?? reliabilityOf(state, rules, id))))
  const loyalty = Math.max(0, Math.min(100, Math.round(opts.loyalty ?? startLoyalty(rules, source))))
  return [
    { op: 'roster.join', who: id, since: { ...state.time }, reliability, pay, ...(fixed ? { fixed: true } : {}), ...(opts.weekly !== undefined ? { weekly: opts.weekly } : {}) },
    { op: 'meter', kind: 'loyalty', key: id, set: loyalty },
  ]
}

/** 把一個角色放進名冊（救過的人、介紹的人、開場的固定夥伴、買下的契約人……）。放不進去丟 ActionBlocked。 */
export function join(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: string, opts: JoinOpts = {}): ReportDraft {
  const block = joinBlock(k, state, id)
  if (block) throw new ActionBlocked(block)
  const name = nameOf(state, id)
  return draftOf(state, 'social', 'roster.join', joinChanges(k, state, id, opts), 'joined', `${name}進了你的名冊。`)
}

// ---- 離開 ----

export type LeaveReason = 'removed' | 'loyalty'

const LEAVE_TEXT: Record<LeaveReason, (name: string) => string> = {
  removed: (n) => `你把${n}從名冊上拿掉了。`,
  loyalty: (n) => `${n}對你已經沒有信任了，離開了你的名冊。`,
}

/** 離開的變更：成員拿掉，也離開隊伍與同行。 */
export function leaveChanges(state: GameState, id: string): Change[] {
  const out: Change[] = [{ op: 'roster.leave', who: id }]
  if (state.party.includes(id) && id !== state.pc) out.push({ op: 'party', id, remove: true })
  return out
}

/** 離開名冊（忠誠太低、玩家自己拿掉）。不在名冊上丟 ActionBlocked。 */
export function leave(state: GameState, id: string, reason: LeaveReason = 'removed'): ReportDraft {
  if (!own(readRoster(state).members, id)) throw new ActionBlocked(`${nameOf(state, id)}不在你的名冊上。`)
  return draftOf(state, 'social', 'roster.leave', leaveChanges(state, id), reason, LEAVE_TEXT[reason](nameOf(state, id)))
}

// ---- 召集 ----

export interface MusterInput {
  /** 隊伍：名冊上有空的行者（主角自己會被補在最前面，寫不寫都行） */
  party?: string[]
  /** 同行：誰都可以（最多 2 位） */
  tagalong?: string[]
}

const uniq = (ids: string[]): string[] => [...new Set(ids)]

/** 召集不成立的每一個原因（一條一個條件，寫出是誰）；空的就是成立。 */
export function musterBlocks(k: Pick<Kernel, 'content'>, state: GameState, input: MusterInput): string[] {
  const rules = rosterRules(k)
  const pc = state.pc
  const party = uniq(input.party ?? []).filter((id) => id !== pc)
  const tagalong = uniq(input.tagalong ?? []).filter((id) => id !== pc)
  const roster = readRoster(state)
  const out: string[] = []
  // 隊伍含主角最多 4 人：多出來的從後面排起，一個一句
  party.forEach((id, i) => {
    if (i + 1 >= rules.party_max) out.push(`隊伍最多 ${rules.party_max} 人（含你自己），${nameOf(state, id)}排不進去。`)
  })
  for (const id of party) {
    const name = nameOf(state, id)
    if (!own(state.actors, id)) out.push(`查不到 ${id} 這個人。`)
    else if (!own(roster.members, id)) out.push(`${name}不在你的名冊上，不能進隊伍（只能同行）。`)
    else if (!isRunner(state, id)) out.push(`${name}不是行者，不能進隊伍（只能同行）。`)
    else out.push(...busyReasons(state, id))
    if (tagalong.includes(id)) out.push(`${name}已經在隊伍裡了，不用再當同行。`)
  }
  tagalong.forEach((id, i) => {
    const name = nameOf(state, id)
    if (!own(state.actors, id)) out.push(`查不到 ${id} 這個人。`)
    if (i >= rules.tagalong_max) out.push(`同行最多 ${rules.tagalong_max} 位，${name}排不進去。`)
  })
  return out
}

/**
 * 召集：隊伍含主角最多 4 人、都要是名冊上有空的行者；同行最多 2 位、誰都可以（要查得到這個人）。成功之後 state.party 就是主角加上那幾個人，
 * 被召集的名冊成員記下這一刻是最近一次召集（連兩週沒召集的忠誠看它）。不成立丟 ActionBlocked，訊息是每一個原因接起來。
 */
export function muster(k: Pick<Kernel, 'content'>, state: GameState, input: MusterInput): ReportDraft {
  if (!state.pc) throw new ActionBlocked('還沒有主角。')
  const blocks = musterBlocks(k, state, input)
  if (blocks.length > 0) throw new ActionBlocked(blocks.join(''))
  const pc = state.pc
  const party = uniq(input.party ?? []).filter((id) => id !== pc)
  const tagalong = uniq(input.tagalong ?? []).filter((id) => id !== pc)
  const changes: Change[] = [{ op: 'roster.muster', party, tagalong, at: { ...state.time } }]
  for (const id of state.party) if (id !== pc && !party.includes(id)) changes.push({ op: 'party', id, remove: true })
  for (const id of party) changes.push({ op: 'party', id })
  const names = (ids: string[]): string => ids.map((id) => nameOf(state, id)).join('、')
  const summary = `召集：${party.length > 0 ? `隊伍是你加上${names(party)}` : '這趟你一個人出門'}${tagalong.length > 0 ? `；${names(tagalong)}同行` : ''}。`
  return draftOf(state, 'social', 'roster.muster', changes, 'mustered', summary)
}

// ---- 薪水 ----

/** 設一個成員的出場費或分紅、每週薪水（null 是不給週薪）。 */
export function setPay(state: GameState, id: string, patch: { pay?: PayKind; weekly?: number | null }): ReportDraft {
  const m = readRoster(state).members[id]
  if (!m) throw new ActionBlocked(`${nameOf(state, id)}不在你的名冊上。`)
  if (patch.weekly !== undefined && patch.weekly !== null && !(Number.isSafeInteger(patch.weekly) && patch.weekly > 0)) throw new ActionBlocked('週薪要是大於 0 的整數。')
  const pay = patch.pay ?? m.pay
  // 改成分紅：原有的週薪一起拿掉；本來就是分紅的人不能再給週薪
  if (pay === 'share' && typeof patch.weekly === 'number') throw new ActionBlocked(`${nameOf(state, id)}拿的是分紅，不能再給週薪。`)
  const name = nameOf(state, id)
  const text = patch.weekly === null ? `${name}不再領週薪。` : patch.weekly !== undefined ? `${name}的週薪是 ${patch.weekly}。` : `${name}改領${pay === 'fee' ? '出場費' : '分紅'}。`
  return draftOf(state, 'social', 'roster.pay', [{ op: 'roster.pay', who: id, ...(patch.pay !== undefined ? { pay: patch.pay } : {}), ...(patch.weekly !== undefined ? { weekly: patch.weekly } : {}) }], 'set', text)
}

// ---- 每週：沒召集的忠誠、離開（time.passed 順序 14）----

const clampLoyalty = (v: number): number => Math.max(0, Math.min(100, v))

/**
 * 每跨過一個週一 06:00：
 *  - 連續兩週沒召集的生成行者（不是固定夥伴）忠誠 −2（每滿兩週一次：沒召集滿 2、4、6……週時）；
 *  - 忠誠在 leave_at 以下的人 30% 離開（照人與那一週的固定亂數；先扣、再判斷）。
 * 一次跨好幾週就一週一週算。回傳忠誠的報告（roster.weekly）與每個離開的人一份報告（roster.leave）；沒有事就是 []。
 */
export function weeklyDrafts(k: Pick<Kernel, 'content' | 'timeRules' | 'meters'>, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const weeks = weeklyCrossings(from, to, k.timeRules)
  if (weeks.length === 0) return []
  const rules = rosterRules(k)
  const roster = readRoster(state)
  const ids = Object.keys(roster.members).filter((id) => own(state.actors, id)).sort()
  if (ids.length === 0) return []
  const rule = weeklyRule(k.timeRules)
  const loyalty = new Map(ids.map((id) => [id, meterOf(k, state, 'loyalty', id)] as const))
  const gone = new Set<string>()
  const decay: Change[] = []
  const lines: string[] = []
  for (const at of weeks) {
    for (const id of ids) {
      if (gone.has(id)) continue
      const m = roster.members[id]!
      const idle = countCrossings(m.last_called, at, rule)
      if (!m.fixed && idle >= rules.idle_weeks && idle % rules.idle_weeks === 0 && rules.idle_delta !== 0) {
        const before = loyalty.get(id)!
        const next = clampLoyalty(before + rules.idle_delta)
        if (next !== before) {
          decay.push({ op: 'meter', kind: 'loyalty', key: id, delta: next - before })
          loyalty.set(id, next)
          lines.push(`${nameOf(state, id)}已經 ${idle} 週沒被召集，忠誠 ${next - before}。`)
        }
      }
      if (loyalty.get(id)! <= rules.leave_at && deriveRng(state.rng, `roster/leave/${id}/${toMinutes(at)}`).chance(rules.leave_chance)) gone.add(id)
    }
  }
  const out: ReportDraft[] = []
  if (decay.length > 0) out.push(draftOf(state, 'downtime', 'roster.weekly', decay, 'weekly', lines.join('')))
  for (const id of ids) if (gone.has(id)) out.push(draftOf(state, 'social', 'roster.leave', leaveChanges(state, id), 'loyalty', LEAVE_TEXT.loyalty(nameOf(state, id))))
  return out
}

/** 召集用：成員的原始資料（給介面列名冊）。 */
export function memberOf(state: Pick<GameState, 'ext'>, id: string): Member | undefined {
  return readRoster(state).members[id]
}
