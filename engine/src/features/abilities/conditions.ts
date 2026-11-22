// 技能的條件：自己的（when）、目標的（needs）、距離（range）。每一項不成立就是一句完整的灰掉的原因。
// 只讀戰鬥狀態，不改任何東西。mods 的 when 也用同一組（只看成不成立）。

import type { BattleUnit, BattleView, ItemEntry, UnitRank } from '../../core'
import { coverOf, distance, hasStatus, isExposed, isWounded, onField, statusRuleOf, wielded } from '../../core'
import type { AbilityEntry, NeedsDef, WhenDef } from './types'

const RANK_NAME: Record<UnitRank, string> = { minion: '雜兵', elite: '精英', boss: '首領' }
const list = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v])
const orJoin = (v: string[]): string => v.join('或')

function statusName(view: Pick<BattleView, 'k'>, id: string): string {
  return statusRuleOf(view.k.content, id)?.name ?? id
}

/** 自己的條件：每一項不成立各一句。other 是這一步的對手（只有 mods 的 other_* 用得到）。 */
export function whenBlocks(view: BattleView, u: BattleUnit, w: WhenDef | undefined, other?: BattleUnit): string[] {
  if (!w) return []
  const out: string[] = []
  const weapon = wielded(u)
  if (w.wield !== undefined) {
    const want = list(w.wield)
    if (!weapon || !want.some((x) => weapon.class === x || weapon.traits.includes(x))) out.push(`手上要拿著${orJoin(want)}類的武器才能用。`)
  }
  if (w.mag_min !== undefined && (weapon?.mag?.now ?? 0) < w.mag_min) out.push(`彈匣裡要有 ${w.mag_min} 格以上才能用。`)
  if (w.hull === true && !u.hull) out.push('要在機甲狀態才能用。')
  if (w.hull === false && u.hull) out.push('機甲狀態下不能用。')
  if (w.stance !== undefined && u.stance !== w.stance) {
    const name = view.k.content.get<AbilityEntry>('ability', w.stance)?.name ?? w.stance
    out.push(`要先開著「${name}」姿態才能用。`)
  }
  if (w.slot !== undefined) {
    const slots = Array.isArray(w.slot) ? w.slot : [w.slot]
    if (!slots.includes(u.slot)) out.push(`要站在第 ${slots.join('、')} 格才能用。`)
  }
  if (w.node_taken !== undefined) {
    const kind = w.node_taken === true ? undefined : w.node_taken
    if (!view.battle.nodes.some((n) => n.taken && (!kind || n.kind === kind))) out.push(kind ? `要先接管${kind}類的控制節點才能用。` : '要先接管一個控制節點才能用。')
  }
  if (w.first_round && view.battle.round !== 1) out.push('只能在第一回合用。')
  if (w.wounded && !isWounded(u)) out.push('自己要是重傷（生命低於一半）才能用。')
  if (w.in_cover && coverOf(view.battle, u) < 1) out.push('自己要站在有遮蔽的格子才能用。')
  if (w.other_exposed && !(other && isExposed(view.battle, other))) out.push('對手要站在暴露的格子才能用。')
  if (w.other_cyber && !((other?.cyber ?? 0) > 0)) out.push('對手要有義體才能用。')
  if (w.other_status !== undefined && !(other && hasStatus(other, w.other_status))) out.push(`對手要帶著${statusName(view, w.other_status)}才能用。`)
  if (w.other_contract && !other?.implants?.some((i) => i.contract)) out.push('對手要有契約義體（授權鎖）才能用。')
  // 沒有對象時（問花費）當成成立：行動自己已經把對象限在自己或相鄰一格
  if (w.target_near && other && other.id !== u.id && !(onField(other) && onField(u) && Math.abs(other.slot - u.slot) === 1)) out.push('對象要是自己或相鄰一格的隊友才能用。')
  return out
}

/** 目標的條件：每一項不成立各一句。 */
export function needsBlocks(view: BattleView, t: BattleUnit, n: NeedsDef | undefined): string[] {
  if (!n) return []
  const out: string[] = []
  if (n.bridged === true && !t.load) out.push(`${t.name}要有橋才能用。`)
  if (n.bridged === false && t.load) out.push(`${t.name}有橋，不能對有橋的人用。`)
  const cyber = (t.cyber ?? 0) > 0
  if (n.cyber === true && !cyber) out.push(`${t.name}要有義體才能用。`)
  if (n.cyber === false && cyber) out.push(`${t.name}有義體，不能對有義體的人用。`)
  if (n.status !== undefined) {
    const want = list(n.status)
    if (!want.some((id) => hasStatus(t, id))) out.push(`${t.name}要帶著${orJoin(want.map((id) => statusName(view, id)))}才能用。`)
  }
  if (n.no_rank?.includes(t.rank)) out.push(`不能對${RANK_NAME[t.rank]}用（${t.name}是${RANK_NAME[t.rank]}）。`)
  if (n.rank && !n.rank.includes(t.rank)) out.push(`只能對${orJoin(n.rank.map((r) => RANK_NAME[r as UnitRank] ?? r))}用（${t.name}是${RANK_NAME[t.rank]}）。`)
  if (n.wounded && !isWounded(t)) out.push(`${t.name}要是重傷（生命低於一半）才能用。`)
  if (n.afterglow !== undefined && t.layers < n.afterglow) out.push(`${t.name}要疊著 ${n.afterglow} 層以上的餘韻才能用（現在 ${t.layers} 層）。`)
  if (n.tag !== undefined && !t.tags.includes(n.tag)) out.push(`${t.name}要帶著「${n.tag}」標籤才能用。`)
  if (n.implant_off && !t.statuses.some((s) => s.id.startsWith('off_') || s.id === 'jammed')) out.push(`${t.name}身上要已經有一件被干擾的義體才能用。`)
  if (n.cache_tag !== undefined && !t.quick.some((q) => q.qty > 0 && view.k.content.get<ItemEntry>('item', q.item)?.tags?.includes(n.cache_tag!))) out.push(`${t.name}的快取格裡要有帶「${n.cache_tag}」標籤的道具才能用。`)
  // any：成立任何一組就算；全都不成立時合成一句（每一組的原因用「，或」接起來）
  if (n.any?.length) {
    const alts = n.any.map((a) => needsBlocks(view, t, a))
    if (alts.every((why) => why.length > 0)) out.push(alts.map((why) => why.join('').replace(/。$/, '')).join('；或是') + '。')
  }
  return out
}

/** 距離：自己的格與目標的格（slot 是目標站第幾格）。在範圍裡回傳 null。 */
export function rangeBlock(u: BattleUnit, slot: number, range: readonly [number, number] | undefined): string | null {
  if (!range || slot < 1) return null
  const d = distance(u, { slot })
  const [lo, hi] = range
  if (d >= lo && d <= hi) return null
  if (lo === 1 && hi === 1) return `目標要在近身的距離（雙方都站第 1 格），現在距離 ${d}。`
  if (lo === hi) return `目標要正好在距離 ${lo}，現在距離 ${d}。`
  return `目標要在距離 ${lo}～${hi} 以內，現在距離 ${d}。`
}

/** 手上是能射擊的槍（不是近戰、不是空手）。 */
export const heldGun = (u: BattleUnit) => {
  const w = wielded(u)
  return w && !w.traits.includes('melee') ? w : undefined
}
