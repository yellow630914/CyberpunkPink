// L6 功能 roster 的入口：進名冊、離開、召集（隊伍與同行）、設薪水，還有每週的忠誠。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
// 規格：NPC_SYSTEM 10.0（隊伍與同行）、10.4（忠誠）、10.6（離隊）、10.7（候選人）；COMMISSIONS 6.1 節；dev/work/M2-roster.md。

import type { Change, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, attrMod, clone, countCrossings, deriveRng, effectCtx, isRecord, makeCheck, meterOf, toMinutes, weeklyCrossings, weeklyRule } from '../../core'
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

/**
 * 建角之後：出身的名冊（主角角色的 ext.origin.roster，npc 的 id；CHARACTER 第 1 節）進名冊，當開場的固定夥伴（分紅、不會因為冷落而降忠誠）。
 * 這個功能不 import npcs：還不是角色的人問「meet」這個效果（npcs 登記，會把人變成角色）；沒有人登記、或那個人查不到資料就略過。
 * 名冊滿了、已經在名冊上的也略過。每一位一份 roster.join；回傳的草稿由掛鉤（report.after）接著提交。
 */
export function originRosterDrafts(k: Kernel, state: GameState): ReportDraft[] {
  const pc = state.pc ? state.actors[state.pc] : undefined
  const origin = pc && isRecord(pc.ext.origin) ? pc.ext.origin : undefined
  const ids = origin && Array.isArray(origin.roster) ? (origin.roster as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
  const out: ReportDraft[] = []
  // 一位一位算：前面的人進了名冊，後面的人看到的是進了之後的狀態（名冊的容量）
  const sim = clone(state)
  for (const id of new Set(ids)) {
    if (id === sim.pc || own(readRoster(sim).members, id)) continue
    let meet: Change[] = []
    if (!own(sim.actors, id)) {
      if (!k.effects.has('meet')) continue
      const res = k.effects.resolve([{ kind: 'meet', npc: id }], effectCtx(k, sim, { source: 'builtin' }))
      if (res.errors.length > 0 || !res.changes.some((c) => c.op === 'actor.add')) continue
      meet = res.changes
      k.changes.applyAll(sim, meet)
    }
    if (joinBlock(k, sim, id)) continue
    const join = joinChanges(k, sim, id, { fixed: true })
    k.changes.applyAll(sim, join)
    const name = nameOf(sim, id)
    out.push(draftOf(sim, 'social', 'roster.join', [...meet, ...join], 'joined', `${name}是你出身帶來的夥伴，進了你的名冊。`))
  }
  return out
}

// ---- 離開 ----

/** removed 玩家拿掉；loyalty 忠誠太低；sunk 他自己的沉溺到頂（NPC_SYSTEM 10.6 節）；pc_sunk 主角的沉溺藏不住了 */
export type LeaveReason = 'removed' | 'loyalty' | 'sunk' | 'pc_sunk'

const LEAVE_TEXT: Record<LeaveReason, (name: string) => string> = {
  removed: (n) => `你把${n}從名冊上拿掉了。`,
  loyalty: (n) => `${n}對你已經沒有信任了，離開了你的名冊。`,
  sunk: (n) => `${n}沉得太深，已經不是原來的那個人了，離開了你的名冊。`,
  pc_sunk: (n) => `${n}看見了你沉到了什麼地步，離開了你的名冊。`,
}

/** 他的沉溺到頂離開時立的旗標；之後以別的身分出現是內容。 */
export const sunkAwayFlag = (id: string): string => `sunk_away:${id}`
/** 主角的沉溺到頂、這個人跟著走時立的旗標。 */
export const followsDownFlag = (id: string): string => `follows_down:${id}`
/** 主角的沉溺到頂的名冊反應已經發生過（只發生一次）。 */
export const PC_SUNK_DONE = 'pc_sunk_done'

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

// ---- 沉溺到 100（NPC_SYSTEM 10.6 節） ----

const SHOWN_STAT = 'sink_shown'

/** 藏沉溺的手段有幾種（掃橋用的掛點 scan.person 的 hide；功能之間不互相 import，這裡只認名字與格式，沒有人回答就是 0）。 */
function hideOf(k: Pick<Kernel, 'hooks'>, state: GameState, actor: string): number {
  let n = 0
  for (const { result } of k.hooks.run('scan.person', { state, actor, strength: 0 })) {
    const h = isRecord(result) ? result.hide : undefined
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) n += Math.floor(h)
  }
  return n
}

/** 這一週有沒有和主角在一起：上一個週一 06:00 之後被召集過（隊伍或同行）。從最近一次召集走到這個週一，只跨過這個週一自己一次。 */
const withPcThisWeek = (m: Member, at: GameTime, rule: ReturnType<typeof weeklyRule>): boolean => countCrossings(m.last_called, at, rule) <= 1

interface Sunk {
  /** 離開的人與原因 */
  gone: Map<string, LeaveReason>
  /** 跟著走的人 */
  follows: string[]
  /** 主角的反應有沒有發生（有人看到了 100） */
  pcDone: boolean
  /** 擲過看穿的紀錄（報告用） */
  lines: string[]
}

/**
 * 一個週一 06:00 的沉溺檢查：
 *  - 名冊上的人自己的沉溺到 sink_away_at：離開（原因 sunk）；
 *  - 主角看起來的沉溺（別人看到的，藏著的時候要先被看穿）到 pc_sunk_at：只發生一次；忠誠 pc_sunk_leave 以下的人離開（pc_sunk），
 *    親密度 follow_affinity 以上而且他自己沉溺 follow_sink 以上的人跟著走（只立旗標），其餘留下。
 * 主角藏著的時候（別人看到的比真正的低），這一週和主角在一起的每個人各擲一次看穿，骰面從狀態導出。
 */
function sunkAt(k: Pick<Kernel, 'content' | 'meters' | 'stats' | 'hooks' | 'timeRules'>, state: GameState, at: GameTime, ids: string[], gone: Set<string>, done: boolean): Sunk {
  const rules = rosterRules(k)
  const roster = readRoster(state)
  const rule = weeklyRule(k.timeRules)
  const out: Sunk = { gone: new Map(), follows: [], pcDone: false, lines: [] }
  for (const id of ids) {
    if (gone.has(id)) continue
    if ((state.actors[id]!.sink ?? 0) >= rules.sink_away_at) {
      out.gone.set(id, 'sunk')
      gone.add(id)
    }
  }
  const pc = state.pc ? state.actors[state.pc] : undefined
  if (!pc || done) return out
  const real = pc.sink ?? 0
  if (real < rules.pc_sunk_at) return out
  const shown = k.stats.hasStat(SHOWN_STAT) ? k.stats.stat(state, pc.id, SHOWN_STAT) : real
  // 別人看到的已經到頂，不用看穿；沒有藏就更不用
  const hidden = shown < real && shown < rules.pc_sunk_at
  const hide = hidden ? hideOf(k, state, pc.id) : 0
  const dc = rules.see_base + attrMod(k.stats.effectiveAttr(state, pc.id, 'resolve')) + (pc.skills.composure ?? 0) + hide * rules.see_per_hide
  for (const id of ids) {
    if (gone.has(id) || !withPcThisWeek(roster.members[id]!, at, rule)) continue
    const a = state.actors[id]!
    let sees = !hidden
    if (hidden) {
      const affinity = meterOf(k, state, 'affinity', id)
      const natural = deriveRng(state.rng, `roster/see/${id}/${toMinutes(at)}`).int(1, 20)
      const skill = Math.max(0, ...rules.see_skills.map((s) => a.skills[s] ?? 0))
      const check = makeCheck({
        natural, dc,
        parts: [{ label: '看人的本事', value: skill, source: 'skill' }, { label: `親密度 ${affinity}`, value: Math.max(0, Math.floor(affinity / rules.see_per_affinity)), source: 'situation' }],
      })
      sees = check.total >= dc
      out.lines.push(`${nameOf(state, id)}${sees ? '看穿了你藏著的沉溺' : '沒有看出你藏著的沉溺'}（${check.total} 對 ${dc}）。`)
    }
    if (!sees) continue
    out.pcDone = true
    if (meterOf(k, state, 'loyalty', id) <= rules.pc_sunk_leave) {
      out.gone.set(id, 'pc_sunk')
      gone.add(id)
    } else if (meterOf(k, state, 'affinity', id) >= rules.follow_affinity && (a.sink ?? 0) >= rules.follow_sink) out.follows.push(id)
  }
  return out
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
 *  - 忠誠低於 leave_at 的人 30% 離開（NPC_SYSTEM 10.4：20 剛好是「出場費 +25%」那一段，不離開）（照人與那一週的固定亂數；先扣、再判斷）。
 * 一次跨好幾週就一週一週算。回傳忠誠的報告（roster.weekly）與每個離開的人一份報告（roster.leave）；沒有事就是 []。
 */
export function weeklyDrafts(k: Pick<Kernel, 'content' | 'timeRules' | 'meters' | 'stats' | 'hooks'>, state: GameState, from: GameTime, to: GameTime): ReportDraft[] {
  const weeks = weeklyCrossings(from, to, k.timeRules)
  if (weeks.length === 0) return []
  const rules = rosterRules(k)
  const roster = readRoster(state)
  const ids = Object.keys(roster.members).filter((id) => own(state.actors, id)).sort()
  if (ids.length === 0) return []
  const rule = weeklyRule(k.timeRules)
  const loyalty = new Map(ids.map((id) => [id, meterOf(k, state, 'loyalty', id)] as const))
  const gone = new Set<string>()
  const reasons = new Map<string, LeaveReason>()
  const follows: string[] = []
  const decay: Change[] = []
  const lines: string[] = []
  const sunkLines: string[] = []
  let pcDone = state.flags[PC_SUNK_DONE] === true
  for (const at of weeks) {
    // 沉溺到 100（先於忠誠的離開：已經走了的不再擲）
    const sunk = sunkAt(k, state, at, ids, gone, pcDone)
    for (const [id, why] of sunk.gone) reasons.set(id, why)
    follows.push(...sunk.follows)
    sunkLines.push(...sunk.lines)
    if (sunk.pcDone) pcDone = true
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
      if (loyalty.get(id)! < rules.leave_at && deriveRng(state.rng, `roster/leave/${id}/${toMinutes(at)}`).chance(rules.leave_chance)) gone.add(id)
    }
  }
  const out: ReportDraft[] = []
  if (decay.length > 0) out.push(draftOf(state, 'downtime', 'roster.weekly', decay, 'weekly', lines.join('')))
  if (state.flags[PC_SUNK_DONE] !== true && pcDone) {
    const text = follows.length > 0 ? `你沉到了什麼地步，身邊的人都看見了。${follows.map((id) => nameOf(state, id)).join('、')}沒有走，反而跟了下來。` : '你沉到了什麼地步，身邊的人都看見了。'
    out.push(draftOf(state, 'social', 'roster.sunk', [{ op: 'flag', key: PC_SUNK_DONE, value: true }, ...follows.map((id): Change => ({ op: 'flag', key: followsDownFlag(id), value: true }))], 'pc_sunk', [text, ...sunkLines].join('')))
  } else if (sunkLines.length > 0) out.push(draftOf(state, 'social', 'roster.sunk', [], 'unseen', sunkLines.join('')))
  for (const id of ids) {
    if (!gone.has(id)) continue
    const why = reasons.get(id) ?? 'loyalty'
    const flags: Change[] = why === 'sunk' ? [{ op: 'flag', key: sunkAwayFlag(id), value: true }] : []
    out.push(draftOf(state, 'social', 'roster.leave', [...leaveChanges(state, id), ...flags], why, LEAVE_TEXT[why](nameOf(state, id))))
  }
  return out
}

/** 召集用：成員的原始資料（給介面列名冊）。 */
export function memberOf(state: Pick<GameState, 'ext'>, id: string): Member | undefined {
  return readRoster(state).members[id]
}
