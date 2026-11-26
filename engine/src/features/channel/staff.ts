// L6 功能 channel 的編制（MEDIA 4.5；dev/adr/0020 V15；dev/work/M5-channel-shows.md 第 6 項）。
// 三種位子：製作（帶著開一集：檢定 +2，那個人的路數是主播或偶像 +4）、線人（每週帶回一段素材）、公關（危機事件，內容不在這裡）。
// 位子數 = 頻道等級 + 1（1 級 2 格、2 級 3 格、3 級 4 格；三種位子各最多一人，所以最多坐三個）。放的是角色的 id（名冊上的人或任何一個角色；不能是主角自己），同一個人只能坐一個位子。
// 薪水（V15）：雇來的（不在名冊上，條件 in_roster 不成立）每週 wage.hired（250）；名冊上的人是他出場費（衍生數值 roster_fee）的一半。坐上去那一刻定下，每週從預算扣（weekly.ts 的 wageStep）。
// 讀別的功能的東西只經由條件 in_roster、衍生數值 roster_fee、核心的 actor.conditions 與 actor.ext.paths。

import type { Change, Condition, ConditionCtx, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord, isSafeInt, toMinutes } from '../../core'
import { channelSeats } from './open'
import type { Role, Staff } from './model'
import { ROLES, ROLE_NAME, channelRules, isText, readChannel } from './model'

export const HIRE_ACTION = 'channel.hire'
export const DISMISS_ACTION = 'channel.dismiss'

/** 核心共用的字彙（dev/adr/0016 第三節）：身上有這幾個狀態的人現在沒空。 */
const BUSY = ['busy', 'injured', 'lying_low', 'arrested'] as const
const BUSY_TEXT: Record<(typeof BUSY)[number], (name: string) => string> = {
  busy: (n) => `${n}正在忙別的事，現在沒空。`,
  injured: (n) => `${n}受傷了，現在沒空。`,
  lying_low: (n) => `${n}正在躲風頭，現在沒空。`,
  arrested: (n) => `${n}被抓了，現在沒空。`,
}

const ctxOf = (k: Kernel, state: GameState, actor?: string) => ({ state, stats: k.stats, timeRules: k.timeRules, ...(actor ? { actor } : {}) })
const conditionOn = (k: Pick<Kernel, 'conditions'>, kind: string): boolean => k.conditions.kinds().includes(kind)

export const actorName = (state: Pick<GameState, 'actors'>, id: string): string => (Object.hasOwn(state.actors, id) ? state.actors[id]!.name : id)

/** 這個人現在沒空的原因（有空是 null；上鏡的人與編制裡的人照 actor.conditions 看；手術後休養的人不擋）。 */
export function busyReason(state: Pick<GameState, 'actors' | 'time'>, id: string): string | null {
  const a = Object.hasOwn(state.actors, id) ? state.actors[id] : undefined
  if (!a) return null
  const now = toMinutes(state.time)
  const c = BUSY.find((b) => a.conditions.some((x) => x.id === b && (x.until === undefined || x.until > now)))
  return c ? BUSY_TEXT[c](a.name) : null
}

// ---- 路數 ----

/** 這個人某一條路數的階數（沒有是 0；actor.ext.paths 的格式照 DATA 第 8 節：{ path, slot, tier }）。 */
export function pathTier(state: Pick<GameState, 'actors'>, id: string, path: string): number {
  const raw = Object.hasOwn(state.actors, id) ? state.actors[id]!.ext.paths : undefined
  if (!Array.isArray(raw)) return 0
  return raw.reduce<number>((best, r) => (isRecord(r) && r.path === path && isSafeInt(r.tier) ? Math.max(best, r.tier) : best), 0)
}

export type MediaPath = 'anchor' | 'idol' | 'media'

/** 媒體型路數的階數：anchor 主播、idol 偶像、media 兩條取高的。 */
export function mediaTier(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, id: string, which: MediaPath = 'media'): number {
  const r = channelRules(k).paths
  const a = which === 'idol' ? 0 : pathTier(state, id, r.anchor)
  const i = which === 'anchor' ? 0 : pathTier(state, id, r.idol)
  return Math.max(a, i)
}

// ---- 薪水 ----

/** 這個人坐上位子的週薪與是不是雇來的：不在名冊上的雇來的拿 wage.hired；名冊上的人是他出場費的 1 ÷ roster_div。 */
export function wageOf(k: Kernel, state: GameState, who: string): { hired: boolean; wage: number } {
  const rules = channelRules(k)
  const inRoster = conditionOn(k, 'in_roster') && k.conditions.test({ kind: 'in_roster', who }, ctxOf(k, state))
  if (!inRoster) return { hired: true, wage: rules.wage.hired }
  const fee = k.stats.hasStat('roster_fee') && Object.hasOwn(state.actors, who) ? k.stats.stat(state, who, 'roster_fee') : 0
  return { hired: false, wage: Math.floor(fee / rules.wage.roster_div) }
}

// ---- 坐上去、請他離開 ----

export interface HireInput {
  role: Role
  who: string
}

/** 坐上位子擋下的原因（成立是 null）。 */
export function hireBlock(k: Kernel, state: GameState, input: HireInput): string | null {
  const ch = readChannel(state)
  if (!ch.open) return '還沒有頻道。'
  if (!(ROLES as readonly unknown[]).includes(input.role)) return '要選製作、線人或公關其中一個位子。'
  if (!isText(input.who)) return '要先指定是誰。'
  if (!Object.hasOwn(state.actors, input.who)) return `查不到 ${input.who} 這個人：要先認識他。`
  const name = actorName(state, input.who)
  if (input.who === state.pc) return '你自己不用坐編制的位子。'
  const taken = ch.staff[input.role]
  if (taken) return `「${ROLE_NAME[input.role]}」的位子已經有人（${actorName(state, taken.who)}）：先請他離開。`
  const other = ROLES.find((r) => ch.staff[r]?.who === input.who)
  if (other) return `${name}已經坐在「${ROLE_NAME[other]}」的位子上了。`
  const seats = channelSeats(k, state)
  const used = ROLES.filter((r) => ch.staff[r]).length
  if (used >= seats) return `你的頻道只有 ${seats} 個位子，都坐滿了：訂閱再多一些才會多一個位子。`
  const busy = busyReason(state, input.who)
  if (busy) return busy
  return k.activity.blockOf(state, `commit:${HIRE_ACTION}`)
}

const reportOf = (state: GameState, action: string, changes: Change[], result: string, text: string, data: Record<string, unknown>): ReportDraft => ({
  kind: 'broadcast', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
  timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: action, data }], changes, outcome: { result, summary: text }, narration: { results: [text] },
})

/** 請一個人坐上編制的位子：薪水坐上去那一刻定下。 */
export function seatStaff(k: Kernel, state: GameState, input: HireInput): ReportDraft {
  const block = hireBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const { hired, wage } = wageOf(k, state, input.who)
  const name = actorName(state, input.who)
  const text = `你請${name}坐上了頻道「${ROLE_NAME[input.role]}」的位子${hired ? '（雇來的人）' : '（名冊上的人）'}，每週薪水 ${wage.toLocaleString('en-US')}。`
  return reportOf(state, HIRE_ACTION, [{ op: 'channel.staff', role: input.role, staff: { who: input.who, hired, wage } }], 'hired', text, { role: input.role, who: input.who, hired, wage })
}

export function dismissBlock(k: Kernel, state: GameState, role: Role): string | null {
  const ch = readChannel(state)
  if (!ch.open) return '還沒有頻道。'
  if (!(ROLES as readonly unknown[]).includes(role)) return '要選製作、線人或公關其中一個位子。'
  if (!ch.staff[role]) return `「${ROLE_NAME[role]}」的位子本來就沒有人。`
  return k.activity.blockOf(state, `commit:${DISMISS_ACTION}`)
}

/** 請編制裡的一個人離開（位子空出來）。 */
export function dismissStaff(k: Kernel, state: GameState, role: Role): ReportDraft {
  const block = dismissBlock(k, state, role)
  if (block) throw new ActionBlocked(block)
  const s = readChannel(state).staff[role]!
  const text = `你請${actorName(state, s.who)}離開了頻道「${ROLE_NAME[role]}」的位子。`
  return reportOf(state, DISMISS_ACTION, [{ op: 'channel.staff', role, staff: null }], 'dismissed', text, { role, who: s.who, unpaid_weeks: s.unpaid_weeks })
}

export interface StaffRow {
  role: Role
  role_name: string
  /** 沒有人坐是 null */
  who: string | null
  name: string | null
  hired: boolean | null
  wage: number
  unpaid_weeks: number
  /** 他是主播或偶像的路數（製作 +2 變 +4） */
  media: boolean
  /** 現在沒空的原因 */
  busy: string | null
}

/** 編制現在的樣子：位子數、坐了幾個、每一個位子。 */
export function staffSlots(k: Kernel, state: GameState): { seats: number; used: number; free: number; rows: StaffRow[] } {
  const ch = readChannel(state)
  const seats = ch.open ? channelSeats(k, state) : 0
  const rows = ROLES.map((role): StaffRow => {
    const s: Staff | undefined = ch.staff[role]
    return {
      role, role_name: ROLE_NAME[role], who: s?.who ?? null, name: s ? actorName(state, s.who) : null, hired: s?.hired ?? null, wage: s?.wage ?? 0, unpaid_weeks: s?.unpaid_weeks ?? 0,
      media: s ? mediaTier(k, state, s.who) > 0 : false, busy: s ? busyReason(state, s.who) : null,
    }
  })
  const used = rows.filter((r) => r.who !== null).length
  return { seats, used, free: Math.max(0, seats - used), rows }
}

// ---- 條件 ----

interface StaffCond extends Condition { role: Role }
interface PathCond extends Condition { path?: MediaPath; min?: number }

const unknownFields = (raw: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

const PATH_NAME: Record<MediaPath, string> = { anchor: '主播', idol: '偶像', media: '主播或偶像' }

export function installStaffConditions(k: Kernel, owner: string): void {
  k.conditions.register<StaffCond>({
    kind: 'channel_staff', owner,
    validate(raw) {
      const p = unknownFields(raw, ['role'])
      if (!(ROLES as readonly unknown[]).includes(raw.role)) p.push(`role 要是 ${ROLES.join('、')} 其中一個`)
      return p
    },
    test: (c, ctx: ConditionCtx) => readChannel(ctx.state).staff[c.role] !== undefined,
    describe: (c) => `要有人坐頻道「${ROLE_NAME[c.role] ?? c.role}」的位子`,
  })

  // 上鏡的人（ctx.actor，沒寫是主角）有主播或偶像的路數幾階以上：公演與獨家的 requires 用它
  k.conditions.register<PathCond>({
    kind: 'channel_path', owner,
    validate(raw) {
      const p = unknownFields(raw, ['path', 'min'])
      if (raw.path !== undefined && !['anchor', 'idol', 'media'].includes(raw.path as string)) p.push('path 要是 anchor（主播）、idol（偶像）或 media（兩者之一）')
      if (raw.min !== undefined && !(isSafeInt(raw.min) && raw.min >= 1)) p.push('min 要是 1 以上的整數')
      return p
    },
    test(c, ctx) {
      const id = ctx.actor ?? ctx.state.pc
      return !!id && mediaTier(k, ctx.state, id, c.path ?? 'media') >= (c.min ?? 1)
    },
    describe: (c) => `要有${PATH_NAME[c.path ?? 'media']}的路數 ${c.min ?? 1} 階以上`,
  })
}
