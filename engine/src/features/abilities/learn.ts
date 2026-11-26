// 學技能與裝技能（SKILLS 1.3、1.4 節；CORE_RULES 6.4 節）：歷練點、前置、樹的階、橋的四類容量。
// 狀態存在 actor.ext.abilities（AbilityState）；橋的容量讀衍生數值 bridge_cap_<類>（features/cyberware 定義），沒有人定義時讀 actor.ext.bridge.capacity。

import type { ActorId, GameState, Kernel, ReportDraft } from '../../core'
import { clone } from '../../core'
import { abilityEntry, bridgeClosedFor, isNightId } from './outside'
import type { AbilityEntry, AbilityState, Category, Lesson, LessonFrom, PathEntry, PreparedEntry } from './types'
import { CATEGORIES, CATEGORY_NAME, TREE_XP } from './types'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 角色的技能資料；沒有的人是空的。回傳的是複製，改它不會動到狀態。 */
export function abilitiesOf(state: GameState, actor: ActorId): AbilityState {
  const raw = state.actors[actor]?.ext.abilities
  const r = isRec(raw) ? raw : {}
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const spent: Record<string, number> = {}
  if (isRec(r.spent)) for (const [key, v] of Object.entries(r.spent)) if (typeof v === 'number' && Number.isFinite(v)) spent[key] = v
  // 每件委託的次數與預備好的：沒有就不出現這兩個鍵（學、裝的報告照舊整份帶著它們）
  const commission: Record<string, Record<string, number>> = {}
  if (isRec(r.commission)) {
    for (const [key, used] of Object.entries(r.commission)) {
      if (!isRec(used)) continue
      const counts = Object.fromEntries(Object.entries(used).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)))
      if (Object.keys(counts).length) commission[key] = counts as Record<string, number>
    }
  }
  const prepared: PreparedEntry[] = Array.isArray(r.prepared)
    ? r.prepared.filter((x): x is PreparedEntry => isRec(x) && typeof x.id === 'string' && (x.scope === 'next_battle' || x.scope === 'commission')).map((x) => ({ id: x.id, scope: x.scope, ...(typeof x.key === 'string' ? { key: x.key } : {}), ...(typeof x.target === 'string' ? { target: x.target } : {}) }))
    : []
  // 上到一半的課（M4-training）：格式不對的略過；沒有就不出現這個鍵
  const lessons: Record<string, Lesson> = {}
  if (isRec(r.lessons)) {
    for (const [skill, x] of Object.entries(r.lessons)) {
      const from = isRec(x) && isRec(x.from) ? x.from : null
      const key = from ? (['npc', 'facility', 'tutor'] as const).find((f) => typeof from[f] === 'string' && from[f]) : undefined
      if (!isRec(x) || ![x.level, x.done, x.need].every((n) => typeof n === 'number' && Number.isFinite(n)) || !from || !key) continue
      lessons[skill] = { level: x.level as number, done: x.done as number, need: x.need as number, from: { [key]: from[key] } as LessonFrom, ...(x.pay === 'affinity' || x.pay === 'tuition' || x.pay === 'favor' ? { pay: x.pay } : {}) }
    }
  }
  // 向 NPC 學工藝（M4-craft-teach）：老師 → 基本功；格式不對的略過，沒有就不出現這個鍵
  const tutored: Record<string, string> = {}
  if (isRec(r.tutored)) for (const [npc, skill] of Object.entries(r.tutored)) if (typeof skill === 'string' && skill) tutored[npc] = skill
  return {
    xp: typeof r.xp === 'number' && Number.isFinite(r.xp) ? r.xp : 0, learned: list(r.learned), equipped: list(r.equipped), spent,
    ...(Object.keys(commission).length ? { commission } : {}), ...(prepared.length ? { prepared } : {}), ...(typeof r.stance === 'string' && r.stance ? { stance: r.stance } : {}),
    ...(Object.keys(lessons).length ? { lessons } : {}),
    ...(Object.keys(tutored).length ? { tutored } : {}),
  }
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

/**
 * 這棵樹的第 tier 階共鳴現在生效嗎：樹開到那一階、而且橋裡裝著這棵樹的招牌（和戰鬥裡 mods.ts 的算法同一條：沒裝招牌不生效）。
 * 介面標「生效中」問它，不自己拿樹階比。
 */
export function resonanceOn(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, path: string, tier: number): boolean {
  const p = k.content.get<PathEntry>('path', path)
  if (!p) return false
  return abilitiesOf(state, actor).equipped.includes(p.signature) && tier <= treeTier(k, state, actor, path)
}

/** 敵人的招牌行動（標了 enemy）不能學、也不能裝進橋。 */
const NOT_LEARNABLE = '這不是學得到的技能。'

/** 現在學不學得到這個技能；學不到就回傳第一個原因（給玩家看的完整句子），學得到是 null。 */
export function learnBlock(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, id: string): string | null {
  if (isNightId(id)) return abilityEntry(k, id) ? '夜課的技能要在夜課學，這裡只能裝上。' : '沒有這個技能。'
  const ab = abilityEntry(k, id)
  if (!ab) return '沒有這個技能。'
  if (ab.enemy) return NOT_LEARNABLE
  const mine = abilitiesOf(state, actor)
  if (mine.learned.includes(id)) return '已經學會了。'
  const spent = mine.spent[ab.path] ?? 0
  if (treeTierOf(spent) < ab.tier) {
    const name = k.content.get<PathEntry>('path', ab.path)?.name ?? ab.path
    return `${name}這棵樹還沒開到 ${ab.tier} 階（要在這棵樹累計花 ${TREE_XP[ab.tier - 1]} 點，現在 ${spent} 點）。`
  }
  if (ab.after && !mine.learned.includes(ab.after)) return `要先學會${abilityEntry(k, ab.after)?.name ?? ab.after}。`
  if (mine.xp < ab.xp) return `歷練點不夠（要 ${ab.xp} 點，現在 ${mine.xp} 點）。`
  return null
}

export const reportOf = (state: GameState, actor: ActorId, action: string, value: AbilityState, summary: string, result: string): ReportDraft => ({
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

/**
 * 橋的容量。裝了 cyberware（有衍生數值 bridge_cap_meat）時四類都讀衍生數值（沒有橋是 0；義體功能照零件算，dev/adr/0019 P8）；
 * 沒有人定義時照舊讀 ext.bridge.capacity：有橋（capacity 是物件）的每類至少 8，壞掉的數字當 8；沒有橋就是 0。
 */
function bridgeCapacity(k: Pick<Kernel, 'stats' | 'activity'>, state: GameState, actor: ActorId): Record<Category, number> {
  const out = {} as Record<Category, number>
  // 橋關著（斷線靜修）：四類容量都是 0
  if (bridgeClosedFor(k, state, actor)) {
    for (const c of CATEGORIES) out[c] = 0
    return out
  }
  if (k.stats.hasStat(`bridge_cap_${CATEGORIES[0]}`)) {
    for (const c of CATEGORIES) out[c] = k.stats.hasStat(`bridge_cap_${c}`) ? Math.max(0, Math.floor(k.stats.stat(state, actor, `bridge_cap_${c}`))) : 0
    return out
  }
  const raw = state.actors[actor]?.ext.bridge
  const hasBridge = isRec(raw) && isRec(raw.capacity)
  const cap = hasBridge ? raw.capacity as Record<string, unknown> : {}
  for (const c of CATEGORIES) {
    const v = cap[c]
    out[c] = hasBridge ? Math.max(BRIDGE_CAPACITY_MIN, typeof v === 'number' && Number.isFinite(v) ? v : 0) : 0
  }
  return out
}

/** 一類容量一次最多挪用幾點、被動技能少佔幾點、主動技能少花幾點 RAM 的衍生數值（abilities 定義，橋與別的功能加）。 */
export const capDiscountStat = (c: Category): string => `cap_discount_${c}`
export const ramDiscountStat = (c: Category): string => `ram_discount_${c}`
export const CAP_FLEX_STAT = 'cap_flex'

const statInt = (k: Pick<Kernel, 'stats'>, state: GameState, actor: ActorId, id: string): number =>
  k.stats.hasStat(id) ? Math.max(0, Math.floor(k.stats.stat(state, actor, id))) : 0

/** 一個裝著的技能佔幾點：被動技能照那一類的 cap_discount_<類> 少佔（最少 1）；其餘照寫的 cap。 */
export const capCostOf = (ab: Pick<AbilityEntry, 'kind' | 'cap'>, discount: number): number => (ab.kind === 'passive' && discount > 0 ? Math.max(1, ab.cap - discount) : ab.cap)

/** 四類容量加上「四類之間可以挪用」的那一份（衍生數值 cap_flex；有才多這一欄）。 */
export type Capacity = Record<Category, { used: number; max: number }> & { flex?: { used: number; max: number } }

/** 每一類：裝著的技能照各自的 category 把 cap 加起來（被動技能照 cap_discount 少佔），以及橋的容量。cap_flex 大於 0 時多一欄 flex：超出的合計與最多能挪用的點數。 */
export function capacityOf(k: Pick<Kernel, 'content' | 'stats' | 'activity'>, state: GameState, actor: ActorId): Capacity {
  return capacityFor(k, state, actor, abilitiesOf(state, actor).equipped)
}

export function capacityFor(k: Pick<Kernel, 'content' | 'stats' | 'activity'>, state: GameState, actor: ActorId, ids: string[]): Capacity {
  const max = bridgeCapacity(k, state, actor)
  const out = {} as Capacity
  const discount = {} as Record<Category, number>
  for (const c of CATEGORIES) {
    out[c] = { used: 0, max: max[c] }
    discount[c] = statInt(k, state, actor, capDiscountStat(c))
  }
  for (const id of ids) {
    const ab = abilityEntry(k, id)
    if (ab && out[ab.category]) out[ab.category].used += capCostOf(ab, discount[ab.category])
  }
  const flexMax = statInt(k, state, actor, CAP_FLEX_STAT)
  if (flexMax > 0) out.flex = { used: CATEGORIES.reduce((n, c) => n + Math.max(0, out[c].used - out[c].max), 0), max: flexMax }
  return out
}

/**
 * 這樣的配置裝得下嗎：每一類都不超過就行；超過的部分要在 cap_flex 以內，而且其他類要有空著的容量可以挪過來（挪用，不是憑空多出來）。
 * 裝不下回傳第一個原因（給玩家看的完整句子）。
 */
export function capacityBlock(cap: Capacity): string | null {
  const over = CATEGORIES.filter((c) => cap[c].used > cap[c].max)
  if (over.length === 0) return null
  const first = over[0]!
  const plain = `${CATEGORY_NAME[first]}的容量不夠（要 ${cap[first].used}，橋只有 ${cap[first].max}）。`
  if (!cap.flex) return plain
  const spare = CATEGORIES.reduce((n, c) => n + Math.max(0, cap[c].max - cap[c].used), 0)
  const allowed = Math.min(cap.flex.max, spare)
  if (cap.flex.used <= allowed) return null
  return `${plain.slice(0, -1)}；四類之間最多只能挪用 ${allowed} 點，現在超出 ${cap.flex.used} 點。`
}
