import { ATTRS, ATTR_ARRAY, ATTR_FREE, ATTR_MAX, ATTR_MIN, BASIC_MAX, BASIC_POINTS, CYBER_POINTS, CYBER_POINT_MONEY, GEAR_POINTS, GEAR_POINT_MONEY, TRAIT_MAX, FLAW_MAX, BRAND_LOOK, BEAST_LINES, type AttrName, type CyberOption, type TraitOption } from '../data/creation'
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
// 分完之後可以把任何一項往下壓（最低 4，調整值 −3），每壓 1 點多 1 點自由點數，拿去加別的項（CHARACTER 5.1 節）。
// bonus 是每一項的增減：正的花自由點數，負的是壓下去、換回自由點數。
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
/** 自由點數：總共有幾點（2 ＋ 壓下去的點數）、花了幾點、剩幾點。 */
export function attrBudget(bonus: Partial<Record<AttrName, number>>) {
  const lowered = ATTRS.reduce((s, a) => s + Math.max(0, -(bonus[a] ?? 0)), 0)
  const spent = ATTRS.reduce((s, a) => s + Math.max(0, bonus[a] ?? 0), 0)
  const total = ATTR_FREE + lowered
  return { total, lowered, spent, left: total - spent }
}
/** 按一下 ± 會不會被擋：加要有剩的自由點數、不超過 18；減不低於 4。 */
export function attrStepBlock(pick: AttrPick, bonus: Partial<Record<AttrName, number>>, a: AttrName, delta: 1 | -1): string | null {
  if (pick[a] === undefined) return '先選這一項的數字。'
  const v = pick[a]! + (bonus[a] ?? 0)
  if (delta > 0) {
    if (v >= ATTR_MAX) return `單項最高 ${ATTR_MAX}。`
    if ((bonus[a] ?? 0) < 0) return null // 把壓下去的加回來，不花自由點數
    if (attrBudget(bonus).left <= 0) return '自由點數用完了：先把別的屬性往下壓，一點換一點。'
    return null
  }
  if (v <= ATTR_MIN) return `最低 ${ATTR_MIN}（調整值 ${attrMod(ATTR_MIN)}）。`
  return null
}
export function attrBlock(pick: AttrPick, bonus: Partial<Record<AttrName, number>>): string | null {
  const unset = ATTRS.filter(a => pick[a] === undefined)
  if (unset.length) return `還有 ${unset.length} 項屬性沒有分配。`
  const pool = [...ATTR_ARRAY] as number[]
  for (const a of ATTRS) { const i = pool.indexOf(pick[a]!); if (i < 0) return '每個數字只能用一次。'; pool.splice(i, 1) }
  const b = attrBudget(bonus)
  if (b.spent > b.total) return `自由點數只有 ${b.total} 點。`
  if (b.left > 0) return `還有 ${b.left} 點自由點數沒有用。`
  const over = ATTRS.find(a => pick[a]! + (bonus[a] ?? 0) > ATTR_MAX)
  if (over) return `${over}最高 ${ATTR_MAX}。`
  const under = ATTRS.find(a => pick[a]! + (bonus[a] ?? 0) < ATTR_MIN)
  if (under) return `${under}最低 ${ATTR_MIN}。`
  return null
}
/** 調整值帶正負號（−2、+0、+3）。 */
export const fmtMod = (m: number) => (m < 0 ? `−${-m}` : `+${m}`)
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

// ---- 起始裝備：12 點，只能買 I～II 級；一件＝目錄價 ÷ 250 無條件進位，最少 1；沒花完每點換 250（使用者 2026-11-25；CHARACTER 5.4 節） ----
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

// ---- 外觀裡推出來的三樣（第四版）：外露的義體、獸化、風格 ----
/** 一件物品的風格標籤：「街頭 +1」→ 街頭 1、「櫻町系」→ 櫻町系 1、「+1」沒有標籤。 */
export function styleTags(item: { stats?: Array<[string, string]> }): Array<[string, number]> {
  const out: Array<[string, number]> = []
  for (const [k, v] of item.stats ?? []) {
    if (k !== '風格') continue
    const m = /^(.*?)\s*\+?(\d+)?$/.exec(v.trim())
    const tag = (m?.[1] ?? '').replace(/\+$/, '').trim()
    if (tag) out.push([tag, Number(m?.[2] ?? 1)])
  }
  return out
}
export interface DerivedLooks {
  cyber: string[]
  beast: string[]
  style: { tags: Array<[string, number]>; main: string | null; line: string }
}
const brandKey = (brand: string) => (brand.includes('二手') ? '二手' : brand.includes('同人') ? '同人' : brand)
/**
 * 從裝的義體、獸化零件與穿著推出外觀（NPC_SYSTEM 13.11 節的模板）。
 * baseStyle：出身白給的那一套日常服裝的風格（CHARACTER 5.4 節）；line：獸化的系。
 */
export function derivedLooks(o: { cyber: CyberOption[]; gear: Array<{ name: string; stats?: Array<[string, string]>; kind?: string }>; pronoun: string; baseStyle: string; line: string }): DerivedLooks {
  const he = o.pronoun === '自訂' ? '你' : o.pronoun
  const what = (c: CyberOption) => { const b = c.brand.replace('（二手）', '').split('／')[0]; const n = c.name.includes(b) ? c.name : `${b}的${c.name}`; return c.kind === 'bridge' ? `${n}的橋接口` : n }
  const cyber = o.cyber.filter(c => c.visible).map(c => `${he}的${c.visible!.at}是${what(c)}，${c.visible!.line ?? BRAND_LOOK[brandKey(c.brand)] ?? '外殼沒有什麼特別'}。`)
  const L = BEAST_LINES[o.line] ?? BEAST_LINES['貓']
  const look = (school: 'mech' | 'bio') => (school === 'mech' ? '外殼是霧面的黑色，耳根有一圈金屬的接縫' : '毛是真的，摸得到底下的軟骨')
  const beast: string[] = []
  for (const c of o.cyber.filter(x => x.beast)) {
    if (c.beast!.part === 'ears') beast.push(`${he}的頭上有一對${o.line}耳，${look(c.beast!.school)}，${he}${L.mood}的時候耳朵會${L.move}。`)
    else beast.push(`${he}的身後拖著一條${o.line}尾，${c.beast!.school === 'mech' ? '外殼是霧面的黑色，尾根有一圈金屬的接縫' : '毛是真的，摸得到底下的骨節'}。`)
  }
  const sum = new Map<string, number>([[o.baseStyle, 1]])
  for (const it of o.gear) for (const [t, n] of styleTags(it)) sum.set(t, (sum.get(t) ?? 0) + n)
  const tags = [...sum.entries()].sort((a, b) => b[1] - a[1])
  const worn = o.gear.filter(g => g.kind === 'clothing' || g.kind === 'armor' || g.kind === 'accessory').map(g => g.name)
  const line = `${he}今天穿著出身那一區的${o.baseStyle}日常服裝${worn.length ? `，外面加上${worn.join('、')}` : ''}。`
  return { cyber, beast, style: { tags, main: tags[0]?.[0] ?? null, line } }
}
