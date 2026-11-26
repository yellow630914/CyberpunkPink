// L6 功能 channel 的設備（MEDIA 4.6；dev/adr/0020 V17；dev/work/M5-channel-shows.md 第 3、7 項）。
// 設備是 item 這種內容，帶 studio 欄位：{ cls: 'lens' | 'mic' | 'light' | 'edit' | 'stream', grade: 1 消費 | 2 專業 | 3 企業, portable: boolean }。
// 從背包「裝進頻道」才算數（拿走背包裡的一件，可以拆回去）；它不經 gear（穿戴物），也不算被動效果。
// 一集用到的設備（MEDIA 4.6 的「用在」表，節目的 gear 欄位）每一類取裝著的最高一件相加，最多 +gear.cap（6）：
//   便攜的：任何地方都算；消費級 +1、專業級 +2 −1、企業級 +3 −1（便攜的專業級以上少 gear.portable_cut）
//   棚內的：只在自己的住處算（條件 at_home），而且每類最多算 studio_slots 件裡最高的一件（studio_slots 預設：有住處 1、沒有 0；home 之後加 provider）；
//           裝進頻道時同一類的棚內設備也不能超過 studio_slots 件
// 衍生數值（這個功能定義）：studio_slots、episode_bonus（基礎 0，abilities 的技能加）、stream_gear_bonus（直播讀：收音、鏡頭、串流各取最高一件相加，最多 +3；算法和開一集的設備同一套）。

import type { ActorId, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, countItem, isRecord, isSafeInt } from '../../core'
import type { GearClass, GearRow } from './model'
import { GEAR_CLASSES, GEAR_NAME, channelRules, readChannel } from './model'

export const GEAR_ACTION = 'channel.gear'
export const STUDIO_SLOTS_STAT = 'studio_slots'
export const EPISODE_BONUS_STAT = 'episode_bonus'
export const STREAM_GEAR_STAT = 'stream_gear_bonus'
/** 直播用到的三類設備（MEDIA 4.6：收音、鏡頭、串流） */
export const STREAM_CLASSES: GearClass[] = ['mic', 'lens', 'stream']

const GRADE_NAME = ['', '消費級', '專業級', '企業級'] as const

const ctxOf = (k: Kernel, state: GameState) => ({ state, stats: k.stats, timeRules: k.timeRules })
const conditionOn = (k: Pick<Kernel, 'conditions'>, kind: string): boolean => k.conditions.kinds().includes(kind)

/** 在自己的住處嗎（條件 at_home；沒有人註冊就當不在）。 */
export const atHome = (k: Kernel, state: GameState): boolean => conditionOn(k, 'at_home') && k.conditions.test({ kind: 'at_home' }, ctxOf(k, state))

export interface Studio {
  cls: GearClass
  grade: number
  portable: boolean
}

/** 物品的 studio 欄位（格式不對、不是設備回 null）。 */
export function studioOf(k: Pick<Kernel, 'content'>, item: string): Studio | null {
  const e = k.content.has('item', item) ? k.content.get<Record<string, unknown>>('item', item) : undefined
  const s = e?.studio
  if (!isRecord(s) || !(GEAR_CLASSES as readonly unknown[]).includes(s.cls) || !isSafeInt(s.grade) || s.grade < 1 || s.grade > 3 || typeof s.portable !== 'boolean') return null
  return { cls: s.cls as GearClass, grade: s.grade, portable: s.portable }
}

const nameOfItem = (k: Pick<Kernel, 'content'>, id: string): string => {
  const n = k.content.has('item', id) ? k.content.get<Record<string, unknown>>('item', id)?.name : undefined
  return typeof n === 'string' && n ? n : id
}

/** 住處放得下每類幾件棚內的設備（衍生數值 studio_slots；沒有主角是 0）。 */
export const studioSlots = (k: Kernel, state: GameState): number => (state.pc && state.actors[state.pc] ? k.stats.stat(state, state.pc, STUDIO_SLOTS_STAT) : 0)

// ---- 一集的設備加值 ----

export interface GearPart {
  cls: GearClass
  /** 給玩家看的一句：這一類用的是哪一件、加多少 */
  label: string
  value: number
  uid: string | null
}

export interface GearResult {
  /** 夾在上限之內的合計 */
  total: number
  /** 夾之前 */
  raw: number
  capped: boolean
  parts: GearPart[]
}

/** 一件設備現在在這裡能加多少（棚內的不在自己的住處、或住處沒有放設備的位子是 0）。 */
export function gearValue(k: Kernel, g: GearRow, home: boolean, slots: number): number {
  const r = channelRules(k).gear
  const base = r.bonus[g.grade - 1] ?? 0
  if (g.portable) return Math.max(0, base - (g.grade >= 2 ? r.portable_cut : 0))
  return home && slots >= 1 ? base : 0
}

/** 這幾類設備的加值：每一類取最高的一件，相加，夾在 cap 之內。 */
export function gearBonus(k: Kernel, state: GameState, classes: readonly GearClass[], cap: number): GearResult {
  const gear = readChannel(state).gear
  const home = atHome(k, state)
  const slots = studioSlots(k, state)
  const parts: GearPart[] = []
  for (const cls of classes) {
    let best: { g: GearRow; v: number } | null = null
    for (const g of gear) {
      if (g.cls !== cls) continue
      const v = gearValue(k, g, home, slots)
      if (v > 0 && (!best || v > best.v)) best = { g, v }
    }
    if (best) parts.push({ cls, value: best.v, uid: best.g.uid, label: `${GEAR_NAME[cls]}（${best.g.portable ? '便攜' : '棚內'}${GRADE_NAME[best.g.grade]}）` })
  }
  const raw = parts.reduce((s, p) => s + p.value, 0)
  return { total: Math.min(cap, raw), raw, capped: raw > cap, parts }
}

// ---- 裝上與拆下 ----

/** 裝上去擋下的原因（成立是 null）。 */
export function mountBlock(k: Kernel, state: GameState, item: string): string | null {
  if (!readChannel(state).open) return '還沒有頻道，沒有地方裝設備。'
  if (typeof item !== 'string' || !item) return '要先指定哪一件設備。'
  const studio = studioOf(k, item)
  if (!studio) return `「${nameOfItem(k, item)}」不是頻道的設備。`
  if (countItem(state.inventory, item) < 1) return `你的背包裡沒有「${nameOfItem(k, item)}」。`
  if (!studio.portable) {
    const slots = studioSlots(k, state)
    if (slots < 1) return `你還沒有住處，棚內的${GEAR_NAME[studio.cls]}沒有地方放。`
    const have = readChannel(state).gear.filter((g) => !g.portable && g.cls === studio.cls).length
    if (have >= slots) return `你的住處每一類棚內設備只放得下 ${slots} 件，${GEAR_NAME[studio.cls]}已經裝滿了。`
  }
  return k.activity.blockOf(state, `commit:${GEAR_ACTION}`)
}

const reportOf = (state: GameState, changes: Change[], result: string, text: string, data: Record<string, unknown>): ReportDraft => ({
  kind: 'broadcast', action: GEAR_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
  timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: GEAR_ACTION, data }], changes, outcome: { result, summary: text }, narration: { results: [text] },
})

/** 把背包裡的一件設備裝進頻道（拿走背包裡的一件）。 */
export function mountGear(k: Kernel, state: GameState, item: string): ReportDraft {
  const block = mountBlock(k, state, item)
  if (block) throw new ActionBlocked(block)
  const studio = studioOf(k, item)!
  const ch = readChannel(state)
  const uid = `gr${ch.seq + 1}`
  const row: GearRow = { uid, item, cls: studio.cls, grade: studio.grade, portable: studio.portable }
  const text = `你把「${nameOfItem(k, item)}」裝進了頻道（${GEAR_NAME[studio.cls]}、${studio.portable ? '便攜' : '棚內'}${GRADE_NAME[studio.grade]}）。`
  return reportOf(state, [{ op: 'item', id: item, qty: -1 }, { op: 'channel.gear_add', gear: row }], 'mounted', text, { uid, item, cls: studio.cls, grade: studio.grade, portable: studio.portable })
}

export function unmountBlock(k: Kernel, state: GameState, uid: string): string | null {
  const ch = readChannel(state)
  if (!ch.open) return '還沒有頻道。'
  if (!ch.gear.some((g) => g.uid === uid)) return '頻道裡沒有裝這件設備。'
  return k.activity.blockOf(state, `commit:${GEAR_ACTION}`)
}

/** 把一件設備拆回背包。 */
export function unmountGear(k: Kernel, state: GameState, uid: string): ReportDraft {
  const block = unmountBlock(k, state, uid)
  if (block) throw new ActionBlocked(block)
  const g = readChannel(state).gear.find((x) => x.uid === uid)!
  const text = `你把「${nameOfItem(k, g.item)}」從頻道拆了下來，放回背包。`
  return reportOf(state, [{ op: 'channel.gear_remove', uid }, { op: 'item', id: g.item, qty: 1 }], 'unmounted', text, { uid, item: g.item, cls: g.cls })
}

export interface GearRowView extends GearRow {
  name: string
  /** 現在在這裡能加多少 */
  value: number
}

/** 裝著的設備，每一件現在在這裡能加多少。 */
export function gearView(k: Kernel, state: GameState): GearRowView[] {
  const home = atHome(k, state)
  const slots = studioSlots(k, state)
  return readChannel(state).gear.map((g) => ({ ...g, name: nameOfItem(k, g.item), value: gearValue(k, g, home, slots) }))
}

// ---- 衍生數值 ----

/** 定義三個衍生數值（install 時呼叫）。 */
export function defineGearStats(k: Kernel, owner: string): void {
  k.stats.defineStat({
    id: STUDIO_SLOTS_STAT, owner, name: '住處放得下的棚內設備（每類幾件）', min: 0, max: 9,
    base: (state, actor) => (conditionOn(k, 'has_home') && k.conditions.test({ kind: 'has_home' }, { ...ctxOf(k, state), actor: actor as ActorId }) ? 1 : 0),
  })
  k.stats.defineStat({ id: EPISODE_BONUS_STAT, owner, name: '節目的檢定加值', min: -5, max: 10, base: () => 0 })
  k.stats.defineStat({
    id: STREAM_GEAR_STAT, owner, name: '直播的設備加值', min: 0, max: 9,
    base: (state) => (readChannel(state).open ? gearBonus(k, state, STREAM_CLASSES, channelRules(k).gear.stream_cap).total : 0),
  })
}

