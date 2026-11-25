// L6 功能 deck 的入口：裝上甲板、裝與卸構裝（和快駭程式共用同一排槽）、帶腳本、穿 SKIN。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」；不成立丟 ActionBlocked，原因是給玩家看的完整句子、一條一個條件（xxxBlock 回傳同一句，成立是 null）。
// 狀態只經由核心的 actor.ext 變更（key deck）、time、item 改；報告的 action 是 deck.equip、deck.install、deck.remove、deck.skin、deck.scripts。
// 規格：ITEMS 11.9 節（怎麼存、怎麼裝）、5.2 節（腳本）；CYBERSPACE 4.2、4.3 節；dev/adr/0018 第三節。

import type { Change, ContentEntry, GameState, ItemEntry, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, countItem } from '../../core'
import type { ScriptEntry } from './model'
import { SKIN_KIND, deckRules, extOf, extValue } from './model'
import { deckOf, deckStack, describePiece, fitScripts, isScript, pieceKind } from './state'

const ACTION_EQUIP = 'deck.equip'
const ACTION_INSTALL = 'deck.install'
const ACTION_REMOVE = 'deck.remove'
const ACTION_SKIN = 'deck.skin'
const ACTION_SCRIPTS = 'deck.scripts'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const roman = (g: number): string => ROMAN[g] ?? String(g)
/** 腦部的義體才是甲板的來源（有人掛 deck.source 時）：背包裡的甲板不能直接裝上。 */
export const IMPLANT_ONLY = '甲板是腦部的義體，要動手術才裝得上。'
const nameOf = (state: GameState, actor: string): string => state.actors[actor]?.name ?? actor

const draftOf = (state: GameState, actor: string, action: string, changes: Change[], summary: string, extra: TimelineBeat[] = []): ReportDraft => ({
  kind: 'action', action, location: clone(state.location), actor, party: [],
  timeline: [{ layer: 'meat', actor, text: summary, tag: action }, ...extra],
  changes, outcome: { result: 'ok', summary },
})

const ext = (actor: string, value: Record<string, unknown>): Change => ({ op: 'actor.ext', id: actor, key: 'deck', value })

const itemName = (k: Kernel, id: string): string =>
  k.content.get<ContentEntry & { name?: string }>('construct', id)?.name ?? (k.content.hasKind('quickhack') ? k.content.get<ContentEntry & { name?: string }>('quickhack', id)?.name : undefined) ?? k.content.get<ItemEntry>('item', id)?.name ?? id

/**
 * 現在的活動擋不擋這件事：戰鬥中、網內的行程進行中（face.net、netrun）、潛入中（dive）各一句；其他活動（事件、成人場景、副本……）照活動的白名單。
 * what 是「換構裝」「換腳本」這類的動作名；戰鬥以外的活動只有 skin 以外的才擋（allActivities）。
 */
function activityBlock(k: Kernel, state: GameState, what: string, doing: string, onlyBattle = false): string | null {
  for (const a of k.activity.active(state)) {
    if (a.kind === 'battle') return `戰鬥中不能${what}。`
    if (onlyBattle) continue
    if (a.kind === 'face.net' || a.kind === 'netrun') return `人在網內，不能${what}。`
    if (a.kind === 'dive') return `潛入中，不能${what}。`
  }
  return k.activity.blockOf(state, doing)
}

const noActor = (state: GameState, actor: string): string | null => (state.actors[actor] ? null : `沒有 ${actor} 這個角色。`)

// ---- 裝上甲板 ----

/** 不能裝上這一副甲板（uid 是背包裡那一副的 data.uid；null 是卸下自己的甲板）的原因；可以是 null。 */
export function equipBlock(k: Kernel, state: GameState, actor: string, uid: string | null): string | null {
  const bad = noActor(state, actor)
  if (bad) return bad
  if (k.hooks.owners('deck.source').length > 0) return IMPLANT_ONLY
  const doing = activityBlock(k, state, '換甲板', `commit:${ACTION_EQUIP}`)
  if (doing) return doing
  const ext0 = extOf(state, actor)
  if (uid === null) return ext0.uid === undefined ? '現在沒有裝著自己的甲板。' : null
  if (!deckStack(k, state, uid)) return '背包裡沒有那一副甲板。'
  if (ext0.uid === uid) return '這一副已經裝著了。'
  return null
}

/**
 * 裝上（或換成）背包裡的一副甲板；uid 給 null 是卸下。換甲板時槽裡裝不下的構裝退回背包（還在背包裡，只是不在槽上），
 * 帶的腳本也照新甲板的上限整理。租來的甲板蓋過自己的：這時換自己的甲板不動槽。不花時間。
 */
export function equipDraft(k: Kernel, state: GameState, actor: string, uid: string | null): ReportDraft {
  const block = equipBlock(k, state, actor, uid)
  if (block) throw new ActionBlocked(block)
  // 先在一份複製的狀態上換好，再看新甲板放得下哪些
  const after = clone(state)
  after.actors[actor]!.ext.deck = extValue(after, actor, { uid })
  const next = deckOf(k, after, actor)
  const here = extOf(state, actor)
  const renting = next.source === 'rental'
  const keep = renting ? here.slots : next.equipped.map((p) => p.id)
  const scripts = renting ? here.scripts : fitScripts(k, state, here.scripts, next.scriptLimit)
  const back = renting ? [] : here.slots.filter((id) => !keep.includes(id) && countItem(state.inventory, id) >= 1)
  const summary = uid === null ? `卸下了${nameOf(state, actor)}的甲板。` : `裝上${deckStack(k, state, uid)!.entry.name}。`
  const beats: TimelineBeat[] = back.length ? [{ layer: 'meat', actor, text: `槽放不下了，${back.map((id) => itemName(k, id)).join('、')}退回背包。`, tag: ACTION_EQUIP, data: { returned: back } }] : []
  return draftOf(state, actor, ACTION_EQUIP, [ext(actor, extValue(state, actor, { uid, slots: keep, scripts }))], summary, beats)
}

// ---- 裝與卸構裝 ----

/** 這個角色現在裝不了這一件東西的原因（條件一條一句，照順序回第一條）；裝得了是 null。item 是構裝或快駭程式的 id（也是背包裡的物品 id）。 */
export function installBlock(k: Kernel, state: GameState, actor: string, item: string): string | null {
  const bad = noActor(state, actor)
  if (bad) return bad
  const doing = activityBlock(k, state, '換構裝', `commit:${ACTION_INSTALL}`)
  if (doing) return doing
  const info = deckOf(k, state, actor)
  if (!info.has) return '沒有甲板。'
  if (pieceKind(k, item) === null) return '這一件不是構裝，也不是快駭程式。'
  if (countItem(state.inventory, item) < 1) return '背包裡沒有這一件。'
  if (extOf(state, actor).slots.includes(item)) return '這一件已經裝在槽裡了。'
  const piece = describePiece(k, item, info.grade, deckRules(k))!
  if (piece.size > info.free) return info.free <= 0 ? `構裝槽滿了（能用的 ${info.capacity} 槽都裝著東西）。` : `構裝槽不夠（只剩 ${info.free} 槽，${piece.name}要 ${piece.size} 槽）。`
  return null
}

/** 裝上一件構裝或快駭程式。花 deck_rule 的 swap_minutes（預設 1）分鐘。 */
export function installDraft(k: Kernel, state: GameState, actor: string, item: string): ReportDraft {
  const block = installBlock(k, state, actor, item)
  if (block) throw new ActionBlocked(block)
  const slots = [...extOf(state, actor).slots, item]
  return draftOf(state, actor, ACTION_INSTALL, [{ op: 'time', minutes: deckRules(k).swap_minutes }, ext(actor, extValue(state, actor, { slots }))], `裝上${itemName(k, item)}。`)
}

export function removeBlock(k: Kernel, state: GameState, actor: string, item: string): string | null {
  const bad = noActor(state, actor)
  if (bad) return bad
  const doing = activityBlock(k, state, '換構裝', `commit:${ACTION_REMOVE}`)
  if (doing) return doing
  return extOf(state, actor).slots.includes(item) ? null : '這一件沒有裝在槽裡。'
}

/** 卸下一件（不管現在算不算得進槽裡）。東西留在背包。花 swap_minutes 分鐘。 */
export function removeDraft(k: Kernel, state: GameState, actor: string, item: string): ReportDraft {
  const block = removeBlock(k, state, actor, item)
  if (block) throw new ActionBlocked(block)
  const slots = extOf(state, actor).slots.filter((id) => id !== item)
  return draftOf(state, actor, ACTION_REMOVE, [{ op: 'time', minutes: deckRules(k).swap_minutes }, ext(actor, extValue(state, actor, { slots }))], `卸下${itemName(k, item)}。`)
}

// ---- 腳本 ----

const merged = (list: readonly ScriptEntry[]): ScriptEntry[] => {
  const out: ScriptEntry[] = []
  for (const s of list) {
    const found = out.find((x) => x.item === s.item)
    if (found) found.qty += s.qty
    else out.push({ ...s })
  }
  return out
}

/** 帶這一份腳本的原因（整份換掉）：list 是 { item, qty } 的陣列，空的是全部放下。成立是 null。 */
export function scriptsBlock(k: Kernel, state: GameState, actor: string, list: readonly ScriptEntry[]): string | null {
  const bad = noActor(state, actor)
  if (bad) return bad
  const doing = activityBlock(k, state, '換腳本', `commit:${ACTION_SCRIPTS}`, true)
  if (doing) return doing
  const info = deckOf(k, state, actor)
  if (list.length > 0 && !info.has) return '沒有甲板，不能帶腳本。'
  if (!list.every((s) => typeof s.item === 'string' && Number.isSafeInteger(s.qty) && s.qty >= 1)) return '腳本的數量要是 1 以上的整數。'
  const all = merged(list)
  for (const s of all) if (!isScript(k, s.item)) return `${itemName(k, s.item)}不是腳本。`
  const total = all.reduce((n, s) => n + s.qty, 0)
  if (total > info.scriptLimit) return `最多帶 ${info.scriptLimit} 支腳本（${roman(info.grade)} 級甲板），現在要帶 ${total} 支。`
  for (const s of all) if (countItem(state.inventory, s.item) < s.qty) return `背包裡的${itemName(k, s.item)}不夠 ${s.qty} 個。`
  return null
}

/** 整份換成這幾支腳本（一次最多帶「甲板等級 ＋ 1」支，不佔構裝槽）。 */
export function scriptsDraft(k: Kernel, state: GameState, actor: string, list: readonly ScriptEntry[]): ReportDraft {
  const block = scriptsBlock(k, state, actor, list)
  if (block) throw new ActionBlocked(block)
  const scripts = merged(list)
  const total = scripts.reduce((n, s) => n + s.qty, 0)
  return draftOf(state, actor, ACTION_SCRIPTS, [ext(actor, extValue(state, actor, { scripts }))], total === 0 ? '放下了帶著的腳本。' : `帶上 ${total} 支腳本。`)
}

// ---- SKIN ----

/** 穿上這一套 SKIN（背包裡要有；null 是脫下）的原因。這一條只擋戰鬥中（接入點的限制是 M3-dive 的事）。 */
export function skinBlock(k: Kernel, state: GameState, actor: string, skin: string | null): string | null {
  const bad = noActor(state, actor)
  if (bad) return bad
  const doing = activityBlock(k, state, '換 SKIN', `commit:${ACTION_SKIN}`, true)
  if (doing) return doing
  const cur = extOf(state, actor).skin
  if (skin === null) return cur === undefined ? '現在沒有穿著 SKIN。' : null
  if (!k.content.has(SKIN_KIND, skin)) return '這不是一套 SKIN。'
  if (countItem(state.inventory, skin) < 1) return '背包裡沒有這一套 SKIN。'
  if (cur === skin) return '已經穿著這一套了。'
  return null
}

export function skinDraft(k: Kernel, state: GameState, actor: string, skin: string | null): ReportDraft {
  const block = skinBlock(k, state, actor, skin)
  if (block) throw new ActionBlocked(block)
  const name = skin === null ? '' : (k.content.get<ContentEntry & { name?: string }>(SKIN_KIND, skin)?.name ?? skin)
  return draftOf(state, actor, ACTION_SKIN, [ext(actor, extValue(state, actor, { skin }))], skin === null ? '脫下了 SKIN。' : `換上 SKIN「${name}」。`)
}

