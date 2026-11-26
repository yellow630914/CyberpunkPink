// 誰坐編輯台、每個人每回合的編輯點（OPINION 4.3b、第 7 節；dev/adr/0020 第五節、「M4 對帳」D8；V40）。
// 編輯點 = 基礎 2 ＋ 路數（actor.ext.paths：主播、偶像 2 ＋ 階數的一半進位；名媛、掮客捨去）＋ 被動的 ep ＋ 被動的 ep_cap（合計最多 ep_cap_max）
//   ＋ 衍生數值 ep_bonus（義體、藥、裝備給的：交給核心的 regenTotal，來源屬於 TEMPO_SOURCES 的正值合計最多 +1，負值與其他來源照算）。
// 被動回的 ep 不限（技能、編制、親衛隊）；沒寫 actor 的被動（製作 +1 這類整張編輯台的）加在第一個座位。
// 讀別的功能的東西只經由 actor.ext.paths（格式）、衍生數值（k.stats）與掛點 opinion.passives。

import type { GameState, Kernel } from '../../core'
import { ActionBlocked, isRecord, isSafeInt, regenTotal } from '../../core'
import { askPassives } from './hooks'
import type { OpPassive } from './hooks'
import type { OpinionRules, Seat } from './model'
import { opinionRules } from './model'

export const EP_BONUS_STAT = 'ep_bonus'
export const OPEN_HAND_STAT = 'open_hand_bonus'
/** 一個座位每回合的編輯點最多幾點（setup 自己給的也不超過）。 */
export const EP_MAX = 12

export interface EpPart {
  label: string
  value: number
}

/** 這個人的路數裡編輯點加得最多的那一條：{ path, tier, bonus }；沒有媒體路數是 null。 */
export function pathBonus(rules: OpinionRules, state: Pick<GameState, 'actors'>, actor: string): { path: string; tier: number; bonus: number } | null {
  const raw = Object.hasOwn(state.actors, actor) ? state.actors[actor]!.ext.paths : undefined
  if (!Array.isArray(raw)) return null
  let best: { path: string; tier: number; bonus: number } | null = null
  for (const r of raw) {
    if (!isRecord(r) || typeof r.path !== 'string' || !isSafeInt(r.tier) || r.tier < 1) continue
    const how = Object.hasOwn(rules.ep_paths, r.path) ? rules.ep_paths[r.path] : undefined
    if (how === undefined) continue
    const bonus = how === 'up' ? Math.ceil(r.tier / 2) : Math.floor(r.tier / 2)
    if (best === null || bonus > best.bonus) best = { path: r.path, tier: r.tier, bonus }
  }
  return best
}

/** 義體、藥、裝備給的編輯點：statParts 的每一筆（丟掉基礎）交給 regenTotal 夾。沒有這個衍生數值（opinion 沒裝）是 0。 */
export function epBonusOf(k: Kernel, state: GameState, actor: string): { total: number; parts: EpPart[] } {
  if (!k.stats.hasStat(EP_BONUS_STAT) || !Object.hasOwn(state.actors, actor)) return { total: 0, parts: [] }
  const parts = k.stats.statParts(state, actor, EP_BONUS_STAT).filter((p) => p.source !== 'base')
  return { total: regenTotal(parts), parts: parts.map((p) => ({ label: p.label, value: p.value })) }
}

/** 一個人坐上編輯台的每回合編輯點（和算式的每一筆）。first 是他是不是第一個座位（沒寫 actor 的被動算在他身上）。 */
export function epOf(k: Kernel, state: GameState, actor: string, passives: OpPassive[], first: boolean): { ep: number; parts: EpPart[] } {
  const rules = opinionRules(k)
  const parts: EpPart[] = [{ label: '基礎', value: rules.ep_base }]
  const path = pathBonus(rules, state, actor)
  if (path && path.bonus > 0) parts.push({ label: `路數（${path.path} ${path.tier} 階）`, value: path.bonus })
  let cap = 0
  for (const p of passives) {
    if (p.actor !== actor && !(p.actor === undefined && first)) continue
    for (const m of p.mods ?? []) {
      if (m.kind === 'ep' && (m.amount ?? 0) !== 0) parts.push({ label: p.name, value: m.amount! })
      if (m.kind === 'ep_cap') cap += m.amount ?? 0
    }
  }
  if (cap > 0) parts.push({ label: '編輯點的上限', value: Math.min(cap, rules.ep_cap_max) })
  const bonus = epBonusOf(k, state, actor)
  if (bonus.total !== 0) parts.push({ label: '義體、藥與裝備', value: bonus.total })
  const total = parts.reduce((s, p) => s + p.value, 0)
  return { ep: Math.max(0, Math.min(EP_MAX, total)), parts }
}

/** 開場手牌多幾張的衍生數值（通宵 MAX 這類）：坐著的人裡最高的那一個；不夾 +1，手牌上限照舊夾。 */
export function openHandBonus(k: Kernel, state: GameState, desk: string[]): number {
  if (!k.stats.hasStat(OPEN_HAND_STAT)) return 0
  const list = desk.filter((a) => Object.hasOwn(state.actors, a)).map((a) => k.stats.stat(state, a, OPEN_HAND_STAT))
  return list.length > 0 ? Math.max(...list) : 0
}

export interface DeskOption {
  actor: string
  name: string
  /** 他坐上去每回合的編輯點 */
  ep: number
  parts: EpPart[]
}

/** 隊伍裡誰可以坐編輯台、各自的編輯點（沒寫 actor 的被動算在主角身上）。 */
export function deskOptions(k: Kernel, state: GameState): DeskOption[] {
  const ids = [...new Set([...(state.pc ? [state.pc] : []), ...state.party])].filter((id) => Object.hasOwn(state.actors, id))
  const passives = askPassives(k, state, null, ids).items
  return ids.map((actor) => {
    const e = epOf(k, state, actor, passives, actor === state.pc)
    return { actor, name: state.actors[actor]!.name, ep: e.ep, parts: e.parts }
  })
}

/** setup 給的座位（字串，或 { actor, ep }）變成座位：每個人的編輯點照上面的算式；setup 自己給的 ep 優先。要在隊伍裡、不重複、最多兩個。 */
export function seatsOf(k: Kernel, state: GameState, raw: Array<string | { actor: string; ep?: number }> | undefined, passives: OpPassive[]): Seat[] {
  const list = raw && raw.length > 0 ? raw : [state.pc ?? 'you']
  if (list.length > 2) throw new ActionBlocked('編輯台最多坐兩個人。')
  const seen = new Set<string>()
  return list.map((x, i) => {
    const d = typeof x === 'string' ? { actor: x } : x
    if (!isRecord(d) || typeof d.actor !== 'string' || d.actor === '') throw new ActionBlocked('編輯台的座位要寫是誰（actor）。')
    if (seen.has(d.actor)) throw new ActionBlocked(`「${d.actor}」不能坐兩個位子。`)
    seen.add(d.actor)
    if (raw && raw.length > 0 && !state.actors[d.actor]) throw new ActionBlocked(`找不到要坐編輯台的人「${d.actor}」。`)
    if (raw && raw.length > 0 && !(d.actor === state.pc || state.party.includes(d.actor))) throw new ActionBlocked(`「${state.actors[d.actor]!.name}」不在你的隊伍裡，不能坐編輯台。`)
    const ep = d.ep === undefined ? (state.actors[d.actor] ? epOf(k, state, d.actor, passives, i === 0).ep : opinionRules(k).ep_base) : d.ep
    if (!isSafeInt(ep) || ep < 0 || ep > EP_MAX) throw new ActionBlocked(`編輯點要是 0～${EP_MAX} 的整數。`)
    return { actor: d.actor, ep, ep_max: ep }
  })
}
