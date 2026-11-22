// 學技能與裝技能（SKILLS 1.3、1.4 節；CORE_RULES 6.4 節）：歷練點、前置、樹的階、橋的四類容量。
// 狀態存在 actor.ext.abilities（AbilityState）；橋的容量讀 actor.ext.bridge.capacity。

import type { ActorId, GameState, Kernel, ReportDraft } from '../../core'
import { clone } from '../../core'
import type { AbilityEntry, AbilityState, Category, PathEntry } from './types'
import { CATEGORIES, CATEGORY_NAME, TREE_XP } from './types'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 角色的技能資料；沒有的人是空的。回傳的是複製，改它不會動到狀態。 */
export function abilitiesOf(state: GameState, actor: ActorId): AbilityState {
  const raw = state.actors[actor]?.ext.abilities
  const r = isRec(raw) ? raw : {}
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const spent: Record<string, number> = {}
  if (isRec(r.spent)) for (const [key, v] of Object.entries(r.spent)) if (typeof v === 'number' && Number.isFinite(v)) spent[key] = v
  return { xp: typeof r.xp === 'number' && Number.isFinite(r.xp) ? r.xp : 0, learned: list(r.learned), equipped: list(r.equipped), spent }
}

/** 一棵樹開到幾階（1～5）：這棵樹累計花的歷練點達到 TREE_XP[N-1] 的最大的 N。 */
export function treeTierOf(spent: number): number {
  let tier = 1
  for (let n = 1; n <= TREE_XP.length; n++) if (spent >= TREE_XP[n - 1]!) tier = n
  return tier
}

export function treeTier(_k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, path: string): number {
  return treeTierOf(abilitiesOf(state, actor).spent[path] ?? 0)
}

/** 現在學不學得到這個技能；學不到就回傳第一個原因（給玩家看的完整句子），學得到是 null。 */
export function learnBlock(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): string | null {
  const ab = k.content.get<AbilityEntry>('ability', id)
  if (!ab) return '沒有這個技能。'
  const mine = abilitiesOf(state, actor)
  if (mine.learned.includes(id)) return '已經學會了。'
  const spent = mine.spent[ab.path] ?? 0
  if (treeTierOf(spent) < ab.tier) {
    const name = k.content.get<PathEntry>('path', ab.path)?.name ?? ab.path
    return `${name}這棵樹還沒開到 ${ab.tier} 階（要在這棵樹累計花 ${TREE_XP[ab.tier - 1]} 點，現在 ${spent} 點）。`
  }
  if (ab.after && !mine.learned.includes(ab.after)) return `要先學會${k.content.get<AbilityEntry>('ability', ab.after)?.name ?? ab.after}。`
  if (mine.xp < ab.xp) return `歷練點不夠（要 ${ab.xp} 點，現在 ${mine.xp} 點）。`
  return null
}

const reportOf = (state: GameState, actor: ActorId, action: string, value: AbilityState, summary: string, result: string): ReportDraft => ({
  kind: 'action', action, location: clone(state.location), actor, party: [], timeline: [],
  changes: [{ op: 'actor.ext', id: actor, key: 'abilities', value }],
  outcome: { result, summary },
})

/** 學一個技能：花歷練點、記進這棵樹的累計。不花遊戲時間。不能學就丟錯（訊息是那個原因）。 */
export function learn(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): ReportDraft {
  const why = learnBlock(k, state, actor, id)
  if (why) throw new Error(why)
  const ab = k.content.require<AbilityEntry>('ability', id)
  const mine = abilitiesOf(state, actor)
  const next: AbilityState = { ...mine, xp: mine.xp - ab.xp, learned: [...mine.learned, id], spent: { ...mine.spent, [ab.path]: (mine.spent[ab.path] ?? 0) + ab.xp } }
  return reportOf(state, actor, 'ability.learn', next, `學會了${ab.name}（花 ${ab.xp} 點歷練點）。`, 'learned')
}

/** 每一類容量的下限（CORE_RULES 6.4 節、CYBERWARE 7.1 節：任何一座橋的每一類最低 8）。 */
export const BRIDGE_CAPACITY_MIN = 8

/** 橋的容量。有橋（ext.bridge.capacity 是物件）的每一類至少 8，壞掉的數字當 8；沒有橋就是 0（沒有橋就沒有容量）。 */
function bridgeCapacity(state: GameState, actor: ActorId): Record<Category, number> {
  const raw = state.actors[actor]?.ext.bridge
  const hasBridge = isRec(raw) && isRec(raw.capacity)
  const cap = hasBridge ? raw.capacity as Record<string, unknown> : {}
  const out = {} as Record<Category, number>
  for (const c of CATEGORIES) {
    const v = cap[c]
    out[c] = hasBridge ? Math.max(BRIDGE_CAPACITY_MIN, typeof v === 'number' && Number.isFinite(v) ? v : 0) : 0
  }
  return out
}

/** 每一類：裝著的技能照各自的 category 把 cap 加起來，以及橋的容量。 */
export function capacityOf(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): Record<Category, { used: number; max: number }> {
  return capacityFor(k, state, actor, abilitiesOf(state, actor).equipped)
}

function capacityFor(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, ids: string[]): Record<Category, { used: number; max: number }> {
  const max = bridgeCapacity(state, actor)
  const out = {} as Record<Category, { used: number; max: number }>
  for (const c of CATEGORIES) out[c] = { used: 0, max: max[c] }
  for (const id of ids) {
    const ab = k.content.get<AbilityEntry>('ability', id)
    if (ab && out[ab.category]) out[ab.category].used += ab.cap
  }
  return out
}

/** 整份換掉裝著的清單。有沒學的、或某一類裝不下就丟錯（不動狀態）。不花遊戲時間。 */
export function equipAbilities(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, ids: string[]): ReportDraft {
  const mine = abilitiesOf(state, actor)
  const list = [...new Set(ids)]
  for (const id of list) {
    if (!mine.learned.includes(id)) throw new Error(`還沒學會${k.content.get<AbilityEntry>('ability', id)?.name ?? id}。`)
  }
  const cap = capacityFor(k, state, actor, list)
  for (const c of CATEGORIES) {
    if (cap[c].used > cap[c].max) throw new Error(`${CATEGORY_NAME[c]}的容量不夠（要 ${cap[c].used}，橋只有 ${cap[c].max}）。`)
  }
  const names = list.map((id) => k.content.get<AbilityEntry>('ability', id)?.name ?? id)
  return reportOf(state, actor, 'ability.equip', { ...mine, equipped: list }, list.length ? `裝上：${names.join('、')}。` : '把裝著的技能都卸下了。', 'equipped')
}
