// L6 裝備：染色（EQUIPMENT 第 9 節；DATA 7.7 節）。每一件成品的武器、衣服、護甲可以染兩個顏色（主色調、副色調），純外觀，不改任何數值。
// 染過的顏色放在那一件的 ProductData.dye（背包裡的那一疊的 data.dye；穿上時跟著那一格，脫下來還是那個顏色）；沒有實例資料的一疊（飾品）先不能染。
//   店家代染（by: 'shop'）：要站在設施種類帶 dye 欄位的地方；每改一個顏色 gear_rule.dye_shop_price（現金）、等 dye_shop_minutes 分鐘（不論改幾個）。
//   自己染（by: 'self'）：要在住處（條件 at_home）；每改一個顏色用掉一份帶 dye 標籤的物品、花 dye_self_minutes 分鐘。
//   換回預設（給 null）：不要錢、不花時間、哪裡都行。
//   SKIN（內海化身的穿著；uid 寫 SKIN 的 id，內容種類 skin、背包裡要有一套）：純外觀的自己改，不要錢、不花時間、哪裡都行（化身編輯），顏色記在那個人的 ext.gear.skin_dye；
//   by 可以不寫。穿上脫下、換了一套再換回來，顏色都還在。
// 顏色的值是 dye_ 開頭的色票 id 或 #RRGGBB；其餘擋下。dyeBlock 回傳第一條原因（能染是 null），dyeProblems 回傳全部；dyeDraft 不成立丟 ActionBlocked。

import type { ActorId, Change, ContentEntry, GameState, ItemEntry, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, countItem, formatAmount, formatDuration, stackOf } from '../../core'
import { blueprintOf, gearOf } from './model'
import { gearRules } from './rules'

export const DYE_ACTION = 'gear.dye'
export const DYE_TAG = 'dye'
const FACILITY_TYPE_KIND = 'facility_type'
/** 內容種類 skin（features/deck 的化身穿著）：這裡只讀它的名字與預設顏色，不 import deck */
const SKIN_KIND = 'skin'

export type DyeBy = 'shop' | 'self'
export interface DyeColors {
  primary_color?: string
  secondary_color?: string
}
export interface DyeOpts {
  uid: string
  /** 字串是改成那個顏色；null 是換回預設；沒寫是不動 */
  primary_color?: string | null
  secondary_color?: string | null
  by: DyeBy
  /** 誰的東西（預設主角） */
  actor?: ActorId
}

/** uid 不是背包裡的成品、而是背包裡有的一套 SKIN 的 id：回傳它的名字與預設顏色。 */
function skinOf(k: Kernel, state: GameState, uid: unknown): { id: string; name: string; base: DyeColors } | undefined {
  if (typeof uid !== 'string' || !uid || stackOf(state, uid) || !k.content.hasKind(SKIN_KIND) || countItem(state.inventory, uid) < 1) return undefined
  const e = k.content.get<ContentEntry & { name?: string } & DyeColors>(SKIN_KIND, uid)
  if (!e) return undefined
  const base: DyeColors = {}
  if (isColor(e.primary_color)) base.primary_color = e.primary_color
  if (isColor(e.secondary_color)) base.secondary_color = e.secondary_color
  return { id: uid, name: typeof e.name === 'string' ? e.name : uid, base }
}

const FIELDS = ['primary_color', 'secondary_color'] as const
const COLOR_NAME: Record<(typeof FIELDS)[number], string> = { primary_color: '主色調', secondary_color: '副色調' }

/** 色票的 id（dye_black……）或 #RRGGBB。 */
export function isColor(v: unknown): v is string {
  return typeof v === 'string' && (/^dye_[a-z0-9_]{1,40}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v))
}

/**
 * 這一件現在的顏色：染過的，沒染的照設計圖的預設（目錄上的顏色；沒寫就沒有）。
 * uid 是 SKIN 的 id 時讀那個人（actor，預設主角）染過的，沒染的照 SKIN 內容的預設。
 */
export function dyeOf(k: Kernel, state: GameState, uid: string, actor?: ActorId): DyeColors | undefined {
  const skin = skinOf(k, state, uid)
  if (skin) {
    const dye = gearOf(state, actor ?? state.pc ?? '').skin_dye?.[skin.id] ?? {}
    const out: DyeColors = {}
    const primary = isColor(dye.primary_color) ? dye.primary_color : skin.base.primary_color
    const secondary = isColor(dye.secondary_color) ? dye.secondary_color : skin.base.secondary_color
    if (primary) out.primary_color = primary
    if (secondary) out.secondary_color = secondary
    return out
  }
  const stack = stackOf(state, uid)
  const bp = blueprintOf(k, stack)
  if (!stack || !bp) return undefined
  const dye = (stack.data?.dye ?? {}) as DyeColors
  const base = bp as unknown as DyeColors
  const out: DyeColors = {}
  const primary = isColor(dye.primary_color) ? dye.primary_color : isColor(base.primary_color) ? base.primary_color : undefined
  const secondary = isColor(dye.secondary_color) ? dye.secondary_color : isColor(base.secondary_color) ? base.secondary_color : undefined
  if (primary) out.primary_color = primary
  if (secondary) out.secondary_color = secondary
  return out
}

/** 現在站的設施是店家代染的地方嗎（設施種類帶 dye 欄位；用條件 at_facility 問，沒有人登記就沒有）。 */
export function dyeShopHere(k: Kernel, state: GameState): boolean {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return false
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  return k.content.list<{ id: string; dye?: unknown }>(FACILITY_TYPE_KIND).some(
    (t) => t.dye !== undefined && t.dye !== null && t.dye !== false && k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx),
  )
}

/** 背包裡帶 dye 標籤的物品（染料），一份一份列出來：[物品 id, 份數]。 */
function dyeStock(k: Kernel, state: GameState): Array<[string, number]> {
  const out = new Map<string, number>()
  for (const s of state.inventory) {
    if (s.data !== undefined) continue
    if (k.content.get<ItemEntry>('item', s.id)?.tags?.includes(DYE_TAG)) out.set(s.id, (out.get(s.id) ?? 0) + s.qty)
  }
  return [...out.entries()]
}

interface DyePlan {
  problems: string[]
  /** 寫進 gear.dye 的內容（null 是換回預設） */
  patch: Partial<Record<(typeof FIELDS)[number], string | null>>
  /** 要付費的顏色個數 */
  paid: number
  cash: number
  minutes: number
  /** 自己染用掉的染料：[物品 id, 份數] */
  uses: Array<[string, number]>
  name: string
}

function plan(k: Kernel, state: GameState, o: DyeOpts): DyePlan {
  const rules = gearRules(k)
  const out: DyePlan = { problems: [], patch: {}, paid: 0, cash: 0, minutes: 0, uses: [], name: '' }
  const actor = o.actor ?? state.pc
  if (!actor || !state.actors[actor]) {
    out.problems.push(`沒有 ${String(actor)} 這個角色。`)
    return out
  }
  const skin = skinOf(k, state, o.uid)
  if (!skin && o.by !== 'shop' && o.by !== 'self') out.problems.push('要說明是店家代染，還是自己染。')
  const stack = typeof o.uid === 'string' ? stackOf(state, o.uid) : undefined
  if (!stack && !skin) {
    out.problems.push(typeof o.uid === 'string' && state.inventory.some((s) => s.id === o.uid) ? '這一件是現成的單件，目前還不能染色。' : '背包裡沒有這一件。')
    return out
  }
  const bp = skin ? undefined : blueprintOf(k, stack)
  if (!skin && (!bp || (bp.kind !== 'weapon' && bp.kind !== 'armor'))) {
    out.problems.push('這一件不是武器、衣服或護甲，不能染色。')
    return out
  }
  out.name = skin ? skin.name : bp!.name
  const stored = (skin ? gearOf(state, actor).skin_dye?.[skin.id] : stack?.data?.dye) as DyeColors | undefined

  const now = dyeOf(k, state, o.uid, actor) ?? {}
  for (const f of FIELDS) {
    const v = o[f]
    if (v === undefined) continue
    if (v === null) {
      // 換回預設：本來就是預設（沒染過）就不算變
      if (stored?.[f] !== undefined) out.patch[f] = null
      continue
    }
    if (!isColor(v)) {
      out.problems.push(`${COLOR_NAME[f]}的顏色不對：要是色票的 id（dye_ 開頭）或 #RRGGBB。`)
      continue
    }
    if (now[f]?.toLowerCase() === v.toLowerCase()) continue
    out.patch[f] = v
    out.paid += 1
  }
  if (out.problems.length > 0) return out
  if (Object.keys(out.patch).length === 0) {
    out.problems.push('顏色沒有變：這一件已經是那個顏色了。')
    return out
  }
  if (out.paid === 0) return out // 只是換回預設：不要錢、不花時間、哪裡都行
  if (skin) return out // SKIN：化身編輯，改顏色也不要錢、不花時間

  if (o.by === 'shop') {
    if (!dyeShopHere(k, state)) out.problems.push('這裡沒有烤漆與染色的店家，要到槍店、修車廠或服飾店。')
    out.cash = out.paid * rules.dye_shop_price
    out.minutes = rules.dye_shop_minutes
    if (out.cash > state.money.cash) out.problems.push(`現金不夠：染 ${out.paid} 個顏色要 ${formatAmount(out.cash)}，身上只有 ${formatAmount(state.money.cash)}。`)
  } else if (o.by === 'self') {
    const atHome = k.conditions.kinds().includes('at_home') && k.conditions.test({ kind: 'at_home' }, { state, actor, stats: k.stats, timeRules: k.timeRules })
    if (!atHome) out.problems.push('自己染要在住處的工作間。')
    out.minutes = rules.dye_self_minutes
    let need = out.paid
    for (const [id, have] of dyeStock(k, state)) {
      const take = Math.min(need, have)
      if (take > 0) out.uses.push([id, take])
      need -= take
      if (need === 0) break
    }
    if (need > 0) out.problems.push(`染料不夠：每個顏色要一份染料，還差 ${need} 份。`)
  }
  return out
}

/** 現在染不了的原因（第一條）；能染是 null。 */
export function dyeBlock(k: Kernel, state: GameState, o: DyeOpts): string | null {
  return plan(k, state, o).problems[0] ?? null
}

/** 染不了的每一條原因。 */
export function dyeProblems(k: Kernel, state: GameState, o: DyeOpts): string[] {
  return plan(k, state, o).problems
}

/** 染色（報告 gear.dye）。不成立丟 ActionBlocked。 */
export function dyeDraft(k: Kernel, state: GameState, o: DyeOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0) throw new ActionBlocked(p.problems[0]!)
  const actor = o.actor ?? state.pc!
  const isSkin = skinOf(k, state, o.uid) !== undefined
  const changes: Change[] = [isSkin ? { op: 'gear.dye', skin: o.uid, actor, dye: clone(p.patch) } : { op: 'gear.dye', uid: o.uid, dye: clone(p.patch) }]
  if (p.cash > 0) changes.push({ op: 'cash', delta: -p.cash })
  for (const [id, qty] of p.uses) changes.push({ op: 'item', id, qty: -qty })
  if (p.minutes > 0 && p.paid > 0) changes.push({ op: 'time', minutes: p.minutes })
  const reset = Object.values(p.patch).every((v) => v === null)
  const summary = reset
    ? `${p.name}換回了出廠的顏色。`
    : p.cash > 0
      ? `${p.name}染好了，花了 ${formatAmount(p.cash)}、${formatDuration(p.minutes)}。`
      : p.minutes > 0
        ? `${p.name}染好了，花了 ${formatDuration(p.minutes)}。`
        : `${p.name}染好了。`
  return {
    kind: 'action', action: DYE_ACTION, location: clone(state.location), actor, party: [], timeline: [], changes,
    outcome: { result: reset ? 'reset' : 'dyed', summary },
    narration: { results: [summary] },
  }
}
