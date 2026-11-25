// L6 功能 netcombat：重創的構裝付錢修（CYBERSPACE 6.5 節；B028，使用者 2026-11-25）。
// 重創（破損又中一次）之後，戰後角色帶著狀況 net_broken 與 actor.ext.net_broken（壞掉的是哪幾件；jam.ts）直到修好。修好的三種辦法：
//   睡一覺（rest.done 的 sleep，jam.ts 的 clearBroken）、戰鬥裡改造師的除錯（net.fix）、這裡：到有修理服務的地方付錢修。
// 有修理服務的地方：設施種類（world 的 facility_type）的 functions 有 repair_construct（大街的構裝店「備品庫」這類；資料是內容，不在這裡寫）。
// 價錢：那件構裝價（內容 construct 的 price）的 repair.pct %（規則表 netcombat_rule；預設 10），四捨五入，最少 repair.min；沒寫價的構裝、傷害骰少一顆的那一筆都收 repair.min。
// 改狀態的入口照 features/deck 的樣子：repairBlock 回傳原因（能修是 null）、repairDraft 回傳報告草稿（不成立丟 ActionBlocked）。只用現金。
// 報告（kind action）：netcombat.repair。

import type { ContentEntry, GameState, GridUse, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, formatAmount, isNetMapKind } from '../../core'
import type { ConstructInfo } from './model'
import { BROKEN_CONDITION, BROKEN_EXT, OWNER, carriedOf, constructEntry, netcombatRules } from './model'

const ACTION = 'netcombat.repair'
/** 設施種類的 functions 裡寫這個字，那一種設施就提供修理構裝的服務。 */
export const REPAIR_FUNCTION = 'repair_construct'
const FACILITY_TYPE_KIND = 'facility_type'

/** 要修的一筆：id 是構裝的 id（傷害骰少 1 顆的那一筆是 'dice'）。 */
export interface RepairRow {
  id: string
  name: string
  price: number
}

type FacilityTypeEntry = ContentEntry & { name?: unknown; functions?: unknown }

/** 現在站的設施提供修理服務嗎（用條件 at_facility 問，城市的功能登記的；沒有人登記就沒有修理服務）。回傳設施種類的名字，不是這種地方是 null。 */
export function repairHere(k: Kernel, state: GameState): string | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    if (!Array.isArray(t.functions) || !t.functions.includes(REPAIR_FUNCTION)) continue
    if (k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) return typeof t.name === 'string' && t.name ? t.name : t.id
  }
  return null
}

/** 這一件的修理費：構裝價的 pct %（四捨五入），最少 min；沒寫價的收 min。 */
export function repairPrice(k: Kernel, id: string): number {
  const rules = netcombatRules(k).repair
  const price = id === 'dice' ? undefined : (constructEntry(k, id) as ConstructInfo & { price?: number } | undefined)?.price
  if (typeof price !== 'number' || !Number.isFinite(price)) return rules.min
  return Math.max(rules.min, Math.round((price * rules.pct) / 100))
}

/** 這個角色身上要修的構裝，一件一列；沒有帶重創的是空的。有狀況而沒記是哪一件的，記成一筆 id 是 'unknown' 的（付一次最少的錢就修好）。 */
export function repairRows(k: Kernel, state: GameState, actor: string): RepairRow[] {
  const ids = carriedOf(state, actor)
  if (ids === null) return []
  if (!ids.length) return [{ id: 'unknown', name: '破損的構裝', price: netcombatRules(k).repair.min }]
  return ids.map((id) => ({ id, name: id === 'dice' ? '破損的構裝' : (constructEntry(k, id)?.name ?? id), price: repairPrice(k, id) }))
}

/** 現在能不能修（id 是只修那一件；沒寫是全修）：原因是完整的句子，能修是 null。 */
export function repairBlock(k: Kernel, state: GameState, actor: string, id?: string): string | null {
  if (!state.actors[actor]) return `沒有 ${actor} 這個角色。`
  const doing = k.activity.blockOf(state, `commit:${ACTION}`)
  if (doing) return doing
  if (!repairHere(k, state)) return '這裡沒有修理構裝的服務：要到大街的構裝店這類設施。'
  const rows = repairRows(k, state, actor)
  if (!rows.length) return '身上沒有需要修的構裝。'
  const chosen = id === undefined ? rows : rows.filter((r) => r.id === id)
  if (!chosen.length) return '那一件沒有破損。'
  const cost = chosen.reduce((n, r) => n + r.price, 0)
  if (state.money.cash < cost) return `現金不夠：修理要 ${formatAmount(cost)}，手上只有 ${formatAmount(state.money.cash)}。`
  return null
}

/** 付錢修（id 是只修那一件；沒寫是全修）：付現金、拿掉修好的那幾筆；全修好了就把狀況也拿掉。 */
export function repairDraft(k: Kernel, state: GameState, actor: string, id?: string): ReportDraft {
  const block = repairBlock(k, state, actor, id)
  if (block) throw new ActionBlocked(block)
  const rows = repairRows(k, state, actor)
  const chosen = id === undefined ? rows : rows.filter((r) => r.id === id)
  const cost = chosen.reduce((n, r) => n + r.price, 0)
  // 記著的重創少了修好的那幾筆；一件都不剩就連狀況一起拿掉
  const left = id === undefined ? [] : (carriedOf(state, actor) ?? []).filter((x) => x !== id)
  const changes = [
    { op: 'cash', delta: -cost },
    ...(left.length > 0
      ? [{ op: 'actor.ext', id: actor, key: BROKEN_EXT, value: left }]
      : [{ op: 'actor.condition', id: actor, condition: BROKEN_CONDITION, remove: true }, { op: 'actor.ext', id: actor, key: BROKEN_EXT, value: null }]),
  ]
  const name = state.actors[actor]!.name
  const what = chosen.map((r) => `「${r.name}」`).join('、')
  const summary = `${name}付了 ${formatAmount(cost)}，把${what}修好了。`
  return {
    kind: 'action', action: ACTION, location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text: summary, tag: ACTION }], changes, outcome: { result: 'ok', summary },
  }
}

/** 站在有修理服務的設施上：列「修理構裝」（做不到的原因照 repairBlock）。 */
export function installRepair(k: Kernel): void {
  k.grid.usesOf(OWNER, (ctx, marker): GridUse[] => {
    const st = ctx.state
    if (isNetMapKind(ctx.map.kind) || st.location.facility !== marker.id || !st.pc || !repairHere(k, st)) return []
    const rows = repairRows(k, st, st.pc)
    const cost = rows.reduce((n, r) => n + r.price, 0)
    return [{ id: ACTION, name: cost > 0 ? `修理構裝（${formatAmount(cost)}）` : '修理構裝', block: repairBlock(k, st, st.pc) }]
  })
}

