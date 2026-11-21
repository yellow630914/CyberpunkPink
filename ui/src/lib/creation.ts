import { ATTRS, ATTR_ARRAY, ATTR_FREE, ATTR_MAX, BASIC_MAX, BASIC_POINTS, CYBER_POINTS, CYBER_POINT_MONEY, GEAR_POINTS, GEAR_POINT_MONEY, TRAIT_MAX, FLAW_MAX, type AttrName, type CyberOption, type TraitOption } from '../data/creation'
import type { ItemDef } from '../data/types'

/**
 * 建角的點數預算（CHARACTER 第 1、2.1、5 節）。純函式：每一步回傳「還剩幾點」與「擋住下一步的原因」。
 * 原因是畫面上直接顯示的完整句子（UI 規則 5 的例外：擋住操作的警告）。
 */

/** 年齡是硬界線：只收整數，低於 18 擋下（UI 第 14 節）。 */
export function ageBlock(raw: string | number): string | null {
  const s = String(raw).trim()
  if (!/^\d+$/.test(s)) return '年齡要填整數。'
  if (Number(s) < 18) return '所有角色都是成年人：年齡要 18 以上。'
  if (Number(s) > 200) return '年齡填不到這麼大。'
  return null
}

// ---- 屬性：15、14、13、12、10、8 分到六項，再加 2 點自由點數，單項最高 18 ----
export type AttrPick = Partial<Record<AttrName, number>>

/** 還沒被選走的數字（每一項的下拉只列這些，加上它自己現在的值）。 */
export function freeValues(pick: AttrPick, self?: AttrName): number[] {
  const used = ATTRS.filter(a => a !== self).map(a => pick[a]).filter((v): v is number => v !== undefined)
  const pool = [...ATTR_ARRAY] as number[]
  for (const v of used) { const i = pool.indexOf(v); if (i >= 0) pool.splice(i, 1) }
  return pool
}
export function attrTotals(pick: AttrPick, bonus: Partial<Record<AttrName, number>>): Record<AttrName, number> {
  return Object.fromEntries(ATTRS.map(a => [a, (pick[a] ?? 0) + (bonus[a] ?? 0)])) as Record<AttrName, number>
}
export function attrBlock(pick: AttrPick, bonus: Partial<Record<AttrName, number>>): string | null {
  const unset = ATTRS.filter(a => pick[a] === undefined)
  if (unset.length) return `還有 ${unset.length} 項屬性沒有分配。`
  const pool = [...ATTR_ARRAY] as number[]
  for (const a of ATTRS) { const i = pool.indexOf(pick[a]!); if (i < 0) return '每個數字只能用一次。'; pool.splice(i, 1) }
  const spent = ATTRS.reduce((s, a) => s + (bonus[a] ?? 0), 0)
  if (ATTRS.some(a => (bonus[a] ?? 0) < 0)) return '自由點數不能是負的。'
  if (spent > ATTR_FREE) return `自由點數只有 ${ATTR_FREE} 點。`
  if (spent < ATTR_FREE) return `還有 ${ATTR_FREE - spent} 點自由點數沒有用。`
  const over = ATTRS.find(a => pick[a]! + (bonus[a] ?? 0) > ATTR_MAX)
  if (over) return `${over}最高 ${ATTR_MAX}。`
  return null
}
/** 調整值：（屬性 − 10）÷ 2，無條件捨去。 */
export const attrMod = (v: number) => Math.floor((v - 10) / 2)

// ---- 基本功：10 點，單項最高 3 級；出身另外給一項 +1（可以到 4） ----
export function basicLeft(levels: Record<string, number>, points = BASIC_POINTS): number {
  return points - Object.values(levels).reduce((s, v) => s + v, 0)
}
export function basicStepBlock(levels: Record<string, number>, name: string, delta: 1 | -1, max = BASIC_MAX, points = BASIC_POINTS): string | null {
  const v = levels[name] ?? 0
  if (delta > 0 && v >= max) return `建角時單項最高 ${max} 級。`
  if (delta > 0 && basicLeft(levels, points) <= 0) return '點數用完了。'
  if (delta < 0 && v <= 0) return '已經是 0 級。'
  return null
}

// ---- 橋與義體：10 點；一定要一座橋；沒花完的點數每點換 500 ----
export function cyberSummary(picked: CyberOption[], points = CYBER_POINTS) {
  const spent = picked.reduce((s, o) => s + o.points, 0)
  const bridge = picked.find(o => o.kind === 'bridge') ?? null
  return { spent, left: points - spent, money: Math.max(0, points - spent) * CYBER_POINT_MONEY, sinkFloor: picked.reduce((s, o) => s + o.sink, 0), bridge }
}
export function cyberPickBlock(picked: CyberOption[], add: CyberOption, origin: { id: string; corp?: string | null }, points = CYBER_POINTS): string | null {
  if (add.corpOnly && !(origin.id === 'corp' && origin.corp === add.corpOnly)) return `企業出身、而且是${add.corpOnly}才選得到。`
  const others = add.kind === 'bridge' ? picked.filter(o => o.kind !== 'bridge') : picked
  const left = points - others.reduce((s, o) => s + o.points, 0)
  if (add.points > left) return `要 ${add.points} 點，剩 ${left} 點。`
  if (add.kind !== 'bridge' && picked.some(o => o.part === add.part && o.kind !== 'bridge' && o.id !== add.id && add.part !== '腦')) return `${add.part}已經有一件了。`
  return null
}
export function cyberBlock(picked: CyberOption[], points = CYBER_POINTS): string | null {
  const s = cyberSummary(picked, points)
  if (!s.bridge) return '要選一座橋。'
  if (s.left < 0) return `超過了 ${-s.left} 點。`
  return null
}

// ---- 特質：4 點（設定可以調），最多 2 個缺陷，總數上限 8（不含出身特質與缺陷） ----
export function traitSummary(picked: TraitOption[], points: number) {
  const cost = picked.filter(t => !t.flaw).reduce((s, t) => s + t.cost, 0)
  const refund = picked.filter(t => t.flaw).reduce((s, t) => s + t.cost, 0)
  return { left: points + refund - cost, traits: picked.filter(t => !t.flaw).length, flaws: picked.filter(t => t.flaw).length }
}
export function traitPickBlock(picked: TraitOption[], add: TraitOption, points: number): string | null {
  if (picked.some(t => t.id === add.id)) return null
  const s = traitSummary(picked, points)
  if (add.flaw) return s.flaws >= FLAW_MAX ? `缺陷最多 ${FLAW_MAX} 個。` : null
  if (s.traits >= TRAIT_MAX) return `特質最多 ${TRAIT_MAX} 個。`
  if (add.cost > s.left) return `要 ${add.cost} 點，剩 ${s.left} 點。`
  return null
}
export function traitBlock(picked: TraitOption[], points: number): string | null {
  const s = traitSummary(picked, points)
  if (s.left < 0) return `特質點超過了 ${-s.left} 點。`
  return null
}

// ---- 起始裝備：12 點，只能買 I～II 級；一件＝目錄價 ÷ 250 無條件進位，最少 1；沒花完每點換 150 ----
export const gearPoints = (d: Pick<ItemDef, 'price'>) => Math.max(1, Math.ceil(d.price / 250))
const GEAR_KINDS = new Set(['weapon', 'armor', 'clothing', 'tool', 'consumable', 'ammo', 'construct', 'skin'])
export function gearItemBlock(d: ItemDef): string | null {
  if (d.grade > 2) return '起始的裝備只能買 I～II 級。'
  if (d.unique) return '獨特物品不能用點數買。'
  // 甲板與構裝可以買（CHARACTER 5.4 節），其他義體走義體點數
  const deck = d.kind === 'cyberware' && /甲板/.test(d.name)
  if (!GEAR_KINDS.has(d.kind) && !deck) return '這一類不能用裝備點數買。'
  return null
}
export function gearSummary(items: ItemDef[], points = GEAR_POINTS) {
  const spent = items.reduce((s, d) => s + gearPoints(d), 0)
  return { spent, left: points - spent, money: Math.max(0, points - spent) * GEAR_POINT_MONEY }
}
export function gearAddBlock(items: ItemDef[], add: ItemDef, points = GEAR_POINTS): string | null {
  const b = gearItemBlock(add)
  if (b) return b
  const left = gearSummary(items, points).left
  if (gearPoints(add) > left) return `要 ${gearPoints(add)} 點，剩 ${left} 點。`
  return null
}

/** 建議組合超過 12 點時，從最後一件開始拿掉（CHARACTER 5.4 節）。 */
export function fitKit(items: ItemDef[], points = GEAR_POINTS): ItemDef[] {
  const out = [...items]
  while (out.length && gearSummary(out, points).left < 0) out.pop()
  return out
}
