// L6 功能 netrun：節點上的檢定與用掉的東西（第二張 M3-netrun-nodes）。
// 檢定都經核心的 rollCheck（骰面由狀態的亂數加用途導出，同一份狀態、同一個用途骰面一定一樣；每一份做檢定的報告都帶一筆 rng，下一次骰面就不同）。
// 「主控」：不 import 技能的功能，讀衍生數值 master_tier（技能的功能給，主角與夥伴都算）與共用的資料慣例 actor.ext.paths（路數與階數；DATA 第 8 節）：階數 1 以上就是有主控。
// 後門鑰匙：背包裡帶 backdoor_key 標籤、等級等於這一趟的道具（快取格與腳本裡的也在背包裡；ITEMS 11.4 節「I 級只對 I 級閘門有效」）。

import type { ActorId, AttrId, Change, CheckRoll, GameState, Kernel, RollPart, TimelineBeat } from '../../core'
import { DEGREE_NAME, checkParts, clone, countItem, isRecord, rollCheck } from '../../core'
import { beatOf } from './common'
import { netrunRules } from './rules'
import { partyOf } from './start'

export const KEY_TAG = 'backdoor_key'

/** 過了嗎（大成功與成功）。 */
export const passed = (r: Pick<CheckRoll, 'degree'>): boolean => r.degree === 'critical' || r.degree === 'success'

const ATTR_OF: Record<string, AttrId> = { stealth: 'reflex', interface: 'intellect', negotiate: 'charm' }

/** 一項基本功對的屬性（內容裡有就用內容的）。 */
export function skillAttr(k: Pick<Kernel, 'content'>, skill: string, fallback: AttrId = 'intellect'): AttrId {
  return ((k.content.get('skill', skill)?.attr as string | undefined) ?? ATTR_OF[skill] ?? fallback) as AttrId
}

// ---- 主控 ----

/** 技能那邊提供的衍生數值：這個人主控的樹階（features/abilities 定義；主角看裝著的招牌與學習紀錄，夥伴看路數；沒有裝技能的功能就沒有這個數值）。 */
export const MASTER_TIER_STAT = 'master_tier'

/**
 * 這個人主控的階數（0 是沒有主控）。兩個來源取高的：衍生數值 master_tier（技能的功能給：主角的學習紀錄、夥伴的路數）；
 * 共用的資料慣例 actor.ext.paths 裡 master_path 那一路的階數（DATA 第 8 節；沒有裝技能的功能時只有這一個）。夾在 0～5；壞掉的列略過。
 * 不 import 技能的功能：衍生數值只經 k.stats 查，沒有人定義就當 0。
 */
export function masterTier(k: Kernel, state: GameState, id: ActorId): number {
  let best = 0
  if (state.actors[id] && k.stats.hasStat(MASTER_TIER_STAT)) {
    const v = k.stats.stat(state, id, MASTER_TIER_STAT)
    if (Number.isFinite(v)) best = Math.max(0, Math.min(5, Math.floor(v)))
  }
  const raw = state.actors[id]?.ext.paths
  if (!Array.isArray(raw)) return best
  const path = netrunRules(k).master_path
  for (const r of raw) if (isRecord(r) && r.path === path && typeof r.tier === 'number' && Number.isFinite(r.tier)) best = Math.max(best, Math.min(5, Math.floor(r.tier)))
  return best
}

/** 隊上有主控的人（階數 1 以上）。 */
export function mastersOf(k: Kernel, state: GameState): Array<{ id: ActorId; tier: number }> {
  return partyOf(state).map((id) => ({ id, tier: masterTier(k, state, id) })).filter((m) => m.tier >= 1)
}

/** 隊上最高的主控階數（0 是沒有人有主控）。 */
export const bestTier = (k: Kernel, state: GameState): number => mastersOf(k, state).reduce((n, m) => Math.max(n, m.tier), 0)

// ---- 檢定 ----

export interface Picked {
  id: ActorId
  attr: AttrId
  skill?: string
  /** 情境的加值（主控的階數那一項） */
  situation: RollPart[]
  /** 這一次檢定所有加值的總和（挑人用） */
  mod: number
}

/** 從這些人與這些基本功裡挑加值最高的那一組（同分取前面的）。situationOf 給每個人的情境加值。沒有人可挑是 null。 */
export function pickBest(k: Kernel, state: GameState, ids: readonly ActorId[], skills: readonly string[], situationOf: (id: ActorId) => RollPart[] = () => []): Picked | null {
  let best: Picked | null = null
  for (const id of ids) {
    for (const skill of skills) {
      const attr = skillAttr(k, skill)
      const situation = situationOf(id)
      const mod = checkParts(k.stats, state, id, { attr, skill, tags: [] }, situation).reduce((s, p) => s + p.value, 0)
      if (!best || mod > best.mod) best = { id, attr, skill, situation, mod }
    }
  }
  return best
}

/** 主控的檢定（管理行動）：智識加介面（規則表 admin_skills），加主控的階數的一半進位；隊上沒有人有主控是 null。 */
export function pickAdmin(k: Kernel, state: GameState): Picked | null {
  const masters = mastersOf(k, state)
  const tiers = new Map(masters.map((m) => [m.id, m.tier]))
  return pickBest(k, state, masters.map((m) => m.id), netrunRules(k).admin_skills, (id) => [{ label: '主控', value: Math.ceil((tiers.get(id) ?? 0) / 2), source: 'skill' }])
}

/** 一個人做的檢定（對人快駭、交涉、找人）：這一組基本功裡加值最高的那一項。 */
export const pickOf = (k: Kernel, state: GameState, ids: readonly ActorId[], skills: readonly string[]): Picked | null => pickBest(k, state, ids, skills)

/** 擲一次。purpose 要夠獨特（一份狀態同一個用途的骰面一定一樣）。 */
export function rollPicked(k: Kernel, state: GameState, p: Picked, dc: number, purpose: string, tags: string[]): CheckRoll {
  return rollCheck(k.stats, state, { actor: p.id, attr: p.attr, ...(p.skill ? { skill: p.skill } : {}), dc, purpose, tags, ...(p.situation.length ? { situation: p.situation } : {}) })
}

/** 一次檢定的一拍（給報告的 timeline）。 */
export function checkBeat(k: Kernel, state: GameState, p: Picked, r: CheckRoll, what: string, tag = 'netrun.roll'): TimelineBeat {
  const skill = p.skill ? `（${k.stats.skillName(p.skill)}）` : ''
  return beatOf(p.id, `${state.actors[p.id]!.name}${what}${skill}：${DEGREE_NAME[r.degree]}（骰 ${r.natural}，合計 ${r.total}，對 DC ${r.dc}）`, { tag, roll: r, data: { dc: r.dc, skill: p.skill } })
}

// ---- 後門鑰匙 ----

/** 背包裡可以用的後門鑰匙（帶 backdoor_key 標籤、等級等於這一趟的）：物品 id 與數量。 */
export function keysIn(k: Kernel, state: GameState, grade: number): Array<{ id: string; qty: number }> {
  const out: Array<{ id: string; qty: number }> = []
  for (const stack of state.inventory) {
    if (out.some((o) => o.id === stack.id)) continue
    const def = k.content.get('item', stack.id)
    const tags = Array.isArray(def?.tags) ? (def!.tags as unknown[]) : []
    if (!tags.includes(KEY_TAG) || def?.grade !== grade) continue
    out.push({ id: stack.id, qty: countItem(state.inventory, stack.id) })
  }
  return out
}

/** 用掉一把後門鑰匙的變更：背包少一件；腳本裡記的比背包還多時，從記著它的人的腳本扣掉（deck 的 ext.deck.scripts 是 { item, qty }）。 */
export function spendKey(k: Kernel, state: GameState, id: string): Change[] {
  const changes: Change[] = [{ op: 'item', id, qty: -1 }]
  const left = countItem(state.inventory, id) - 1
  let over = -left
  for (const actor of partyOf(state)) over += scriptQty(state, actor, id)
  for (const actor of partyOf(state)) {
    if (over <= 0) break
    const deck = state.actors[actor]?.ext.deck
    if (!isRecord(deck) || !Array.isArray(deck.scripts)) continue
    const scripts = clone(deck.scripts as unknown[]).filter(isRecord)
    const row = scripts.find((s) => s.item === id && typeof s.qty === 'number' && s.qty >= 1)
    if (!row) continue
    const cut = Math.min(over, row.qty as number)
    row.qty = (row.qty as number) - cut
    over -= cut
    changes.push({ op: 'actor.ext', id: actor, key: 'deck', value: { ...clone(deck), scripts: scripts.filter((s) => (s.qty as number) >= 1) } })
  }
  void k
  return changes
}

function scriptQty(state: GameState, actor: ActorId, item: string): number {
  const deck = state.actors[actor]?.ext.deck
  if (!isRecord(deck) || !Array.isArray(deck.scripts)) return 0
  return deck.scripts.reduce((n: number, s: unknown) => (isRecord(s) && s.item === item && typeof s.qty === 'number' ? n + s.qty : n), 0)
}
