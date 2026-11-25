// L6 功能 tuning 的裝與拆（LEWD_SYSTEM 第 4 節；dev/adr/0019 P48；dev/work/M4-tuning.md 第 1、2、7 點）。
//   裝  要有橋、站在 tuning.install 的設施、有空槽、沒裝過同一個、調校沒被內容篩選關掉；付錢、花時間。requires 不成立照樣裝得上（裝不穩：正的那幾筆不算）。
//   拆  付錢、花時間；上鎖的拆不了（寫出鑰匙在誰手上）；過了 until 的鎖自己失效。
// 每一個動作：xxxProblems（全部原因，一條一句）、xxxBlock（第一條）、xxxQuote（報價）、xxxDraft（不成立丟 ActionBlocked）。
// 價錢還沒有乘區的倍率（和 features/medical 一樣）。

import type { ActorId, Change, ContentEntry, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, contentAllowed, formatAmount, isRecord } from '../../core'
import type { TuningEntry, TuningExt, TuningLock } from './model'
import { AT_FACILITY, EXT, FACILITY_TYPE_KIND, INSTALL_ACTION, NO_BRIDGE_TEXT, REMOVE_ACTION, entryOf, hasBridge, nameOfActor, readExt, requiresText, stableOf, tuningRules, writeExt } from './model'

export type Pool = 'cred' | 'cash'
export const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }

/** 付一筆錢用哪一種：指定的就用指定的（不夠回 null）；沒指定先帳戶、不夠再現金。 */
export function payPool(money: GameState['money'], cost: number, want?: Pool): Pool | null {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}

export interface TuningFacility {
  type: string
  name: string
  install: boolean
  quiet_room: boolean
}

type FacilityTypeEntry = ContentEntry & { name?: unknown; tuning?: unknown }

/** 腳下的設施做不做調校（用條件 at_facility 問；沒有人註冊就沒有）。 */
export function tuningHere(k: Kernel, state: GameState): TuningFacility | null {
  if (!k.conditions.kinds().includes(AT_FACILITY) || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    const f = t.tuning
    if (!isRecord(f)) continue
    if (!k.conditions.test({ kind: AT_FACILITY, types: [t.id] }, ctx)) continue
    return { type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, install: f.install === true, quiet_room: f.quiet_room === true }
  }
  return null
}

/** 戰鬥中與別的活動擋住時的原因；行是 null。 */
export function activityBlock(k: Kernel, state: GameState, action: string): string | null {
  if (state.battle) return '戰鬥中不能這樣處理。'
  return k.activity.blockOf(state, `commit:${action}`)
}

/** 鑰匙在誰手上的一句話。 */
export function keyText(state: GameState, lock: TuningLock): string {
  return `這個調校的鑰匙在${nameOfActor(state, lock.by)}手上。`
}

/** 這個題材被內容篩選關掉了嗎（調校自己的 tags）。 */
export const filteredOut = (state: GameState, entry: TuningEntry): boolean => (entry.tags ?? []).some((t) => !contentAllowed(state.rules, t))

export interface InstallOpts {
  /** 誰裝；不寫是主角 */
  actor?: ActorId
  /** 裝哪一個調校 */
  id: string
  /** 錢從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

export type RemoveOpts = InstallOpts

export interface TuningQuote {
  actor: ActorId
  id: string
  name: string
  facility: string
  price: number
  minutes: number
  /** 錢從哪裡付；不用付是 null */
  pay: Pool | null
  /** 裝的時候：requires 成立嗎（不成立照樣裝得上，只是裝不穩） */
  stable: boolean
  /** 裝不穩的原因（成立或沒寫 requires 是空字串） */
  unstable_why: string
  /** 裝在第幾個槽（0 起算；拆是現在的槽） */
  slot: number
}

interface Plan {
  problems: string[]
  quote: TuningQuote | null
}

const slotsOf = (k: Kernel): number => tuningRules(k).slots

function common(k: Kernel, state: GameState, actor: ActorId | undefined, action: string): { who: ActorId | null; problems: string[] } {
  const who = actor ?? state.pc
  if (!who || !state.actors[who]) return { who: null, problems: ['找不到這個角色。'] }
  const problems: string[] = []
  const act = activityBlock(k, state, action)
  if (act) problems.push(act)
  if (!state.party.includes(who)) problems.push('要調校的人不在隊上。')
  if (!hasBridge(k, state, who)) problems.push(NO_BRIDGE_TEXT)
  return { who, problems }
}

function planInstall(k: Kernel, state: GameState, o: InstallOpts): Plan {
  const c = common(k, state, o.actor, INSTALL_ACTION)
  if (c.who === null) return { problems: c.problems, quote: null }
  const who = c.who
  const problems = c.problems
  const rules = tuningRules(k)
  const entry = entryOf(k, o.id)
  if (!entry) return { problems: [...problems, `找不到這個調校：${o.id}。`], quote: null }
  const here = tuningHere(k, state)
  if (!here || !here.install) problems.push('這裡不是調校診所，裝不了調校。')
  if (filteredOut(state, entry)) problems.push(`「${entry.name}」這個題材被你的內容篩選關掉了。`)
  const ext = readExt(state, who, rules.slots)
  const has = ext.slots.includes(o.id)
  if (has) problems.push(`${entry.name}已經裝著了。`)
  const slot = ext.slots.indexOf(null)
  if (slot < 0 && !has) problems.push(`${nameOfActor(state, who)}的 ${rules.slots} 個調校槽都滿了，先拆一個。`)
  const price = entry.price ?? rules.install.price
  const pay = payPool(state.money, price, o.pay)
  if (price > 0 && pay === null) problems.push(`錢不夠：裝${entry.name}要 ${formatAmount(price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`)
  const stable = stableOf(k, state, who, entry)
  return {
    problems,
    quote: { actor: who, id: o.id, name: entry.name, facility: here?.name ?? '', price, minutes: rules.install.minutes, pay: price > 0 ? pay : null, stable, unstable_why: stable ? '' : requiresText(k, entry), slot },
  }
}

function planRemove(k: Kernel, state: GameState, o: RemoveOpts): Plan {
  const c = common(k, state, o.actor, REMOVE_ACTION)
  if (c.who === null) return { problems: c.problems, quote: null }
  const who = c.who
  const problems = c.problems
  const rules = tuningRules(k)
  const entry = entryOf(k, o.id)
  const label = entry?.name ?? o.id
  const here = tuningHere(k, state)
  if (!here || !here.install) problems.push('這裡不是調校診所，拆不了調校。')
  const ext = readExt(state, who, rules.slots)
  const slot = ext.slots.indexOf(o.id)
  if (slot < 0) problems.push(`${label}沒有裝在身上。`)
  const lock = ext.locked[o.id]
  if (slot >= 0 && lock) problems.push(keyText(state, lock))
  const price = rules.remove.price
  const pay = payPool(state.money, price, o.pay)
  if (price > 0 && pay === null) problems.push(`錢不夠：拆${label}要 ${formatAmount(price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`)
  return {
    problems,
    quote: { actor: who, id: o.id, name: label, facility: here?.name ?? '', price, minutes: rules.remove.minutes, pay: price > 0 ? pay : null, stable: true, unstable_why: '', slot },
  }
}

/** 裝得了嗎：全部的原因（一條一句）；行是空陣列。 */
export const installProblems = (k: Kernel, state: GameState, o: InstallOpts): string[] => planInstall(k, state, o).problems
/** 裝得了嗎：第一條原因；行是 null。 */
export const installBlock = (k: Kernel, state: GameState, o: InstallOpts): string | null => planInstall(k, state, o).problems[0] ?? null
/** 這一次裝的報價；人不存在或查不到調校是 null。 */
export const installQuote = (k: Kernel, state: GameState, o: InstallOpts): TuningQuote | null => planInstall(k, state, o).quote

export const removeProblems = (k: Kernel, state: GameState, o: RemoveOpts): string[] => planRemove(k, state, o).problems
export const removeBlock = (k: Kernel, state: GameState, o: RemoveOpts): string | null => planRemove(k, state, o).problems[0] ?? null
export const removeQuote = (k: Kernel, state: GameState, o: RemoveOpts): TuningQuote | null => planRemove(k, state, o).quote

/** 寫 actor.ext.tuning 的變更。 */
export const extChange = (actor: ActorId, ext: TuningExt): Change => ({ op: 'actor.ext', id: actor, key: EXT, value: writeExt(ext) }) as Change

/** 報告草稿的共用骨架：第一句是主句，其餘是補充。 */
export function tuningReport(state: GameState, action: string, actor: ActorId, changes: Change[], lines: string[], result: string, data: Record<string, unknown>): ReportDraft {
  return {
    kind: 'action', action, location: clone(state.location), actor, party: [],
    timeline: lines.map((text, i) => ({ layer: 'meat' as const, actor, text, tag: i === 0 ? action : 'tuning.note', ...(i === 0 ? { data } : {}) })),
    changes, outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}

/**
 * 裝一個調校。不成立丟 ActionBlocked。
 * 寫進狀態：付錢、調校放進第一個空槽、時間加 minutes。報告 tuning.install（outcome.result 是 stable 或 unstable）。
 */
export function installDraft(k: Kernel, state: GameState, o: InstallOpts): ReportDraft {
  const p = planInstall(k, state, o)
  if (p.problems.length > 0 || !p.quote) throw new ActionBlocked(p.problems[0] ?? '現在裝不了調校。')
  const q = p.quote
  const ext = readExt(state, q.actor, slotsOf(k))
  ext.slots[q.slot] = q.id
  const changes: Change[] = []
  if (q.pay && q.price > 0) changes.push({ op: q.pay, delta: -q.price })
  changes.push(extChange(q.actor, ext), { op: 'time', minutes: q.minutes })
  const lines = [`${nameOfActor(state, q.actor)}在${q.facility}把「${q.name}」裝進了橋的調校槽。`]
  if (!q.stable) lines.push(`不過橋還沒有準備好（要${q.unstable_why}），這個調校裝得不穩，好的那一面現在發揮不出來。`)
  return tuningReport(state, INSTALL_ACTION, q.actor, changes, lines, q.stable ? 'stable' : 'unstable', { id: q.id, slot: q.slot, price: q.price, minutes: q.minutes, stable: q.stable })
}

/** 拆一個調校。不成立丟 ActionBlocked。報告 tuning.remove。 */
export function removeDraft(k: Kernel, state: GameState, o: RemoveOpts): ReportDraft {
  const p = planRemove(k, state, o)
  if (p.problems.length > 0 || !p.quote) throw new ActionBlocked(p.problems[0] ?? '現在拆不了調校。')
  const q = p.quote
  const ext = readExt(state, q.actor, slotsOf(k))
  ext.slots[q.slot] = null
  delete ext.locked[q.id]
  const changes: Change[] = []
  if (q.pay && q.price > 0) changes.push({ op: q.pay, delta: -q.price })
  changes.push(extChange(q.actor, ext), { op: 'time', minutes: q.minutes })
  const lines = [`${nameOfActor(state, q.actor)}在${q.facility}把「${q.name}」從橋上拆了下來。`]
  return tuningReport(state, REMOVE_ACTION, q.actor, changes, lines, 'removed', { id: q.id, slot: q.slot, price: q.price, minutes: q.minutes })
}
