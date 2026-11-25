// L6 功能 curtain 的口味單與檔期主題（CYBERSPACE 8.8 節「口味單」「檔期主題」；LEWD_SYSTEM 1.1、第 9 節；dev/adr/0019 P56、P57）。
//
// 口味單：從傾向的軸與標籤裡挑（內容種類 tendency_tag；扮相軸的標籤就是服裝的風格標籤）；被內容篩選關掉的不列、不收。
// 這一週可以抽的夜：tags 和口味單有交集、tags 沒有全部被篩選關掉、needs_filter 開著。
// 純舞台場次（pure_stage）：口味單裡還開著的標籤少於 taste_min 個。純舞台場次的夜不看口味單的交集（成人場景換成表演檢定，題材用不到）：
//   有交集的夜照樣優先；一個交集都沒有時，抽得到的是所有沒被篩選擋掉的夜。
// 每週的主打：每週一用種子挑一個，不看口味單（同一週每次問都是同一個；跨週換一個）；只從沒被篩選擋掉的夜裡挑。

import type { GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, Rng, clone, contentAllowed, deriveRng, hash32, segmentDayOf } from '../../core'
import type { CurtainRules, NightEntry, WeekRecord } from './model'
import { TASTE_ACTION, allNights, curtainChange, curtainRules, nowOf, readCurtain, weekIndexOf } from './model'

const AXIS_ORDER = ['relation', 'sense', 'body', 'costume']
const AXIS_NAME: Record<string, string> = { relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
const TAG_KIND = 'tendency_tag'

export interface TasteOption {
  id: string
  name: string
  /** 哪一條軸（relation、sense、body、costume） */
  axis: string
  axisName: string
  /** 現在在口味單上 */
  on: boolean
}

/** 口味單的選項：查得到的 tendency_tag，被內容篩選關掉的不列。 */
export function tasteOptions(k: Pick<Kernel, 'content'>, state: GameState): TasteOption[] {
  if (!k.content.hasKind(TAG_KIND)) return []
  const taste = new Set(readCurtain(state).taste)
  const out: TasteOption[] = []
  for (const e of k.content.list(TAG_KIND)) {
    if (!contentAllowed(state.rules, e.id)) continue
    const axis = typeof e.axis === 'string' ? e.axis : ''
    out.push({ id: e.id, name: typeof e.name === 'string' && e.name ? e.name : e.id, axis, axisName: AXIS_NAME[axis] ?? axis, on: taste.has(e.id) })
  }
  return out.sort((a, b) => (AXIS_ORDER.indexOf(a.axis) - AXIS_ORDER.indexOf(b.axis)) || (a.id < b.id ? -1 : 1))
}

/** 口味單上還開著的標籤（被篩選關掉的不算）。 */
export const openTaste = (state: GameState): string[] => readCurtain(state).taste.filter((t) => contentAllowed(state.rules, t))

/** 現在改不了口味單的原因（一句）；能改是 null。 */
export function tasteBlock(k: Kernel, state: GameState, tags: readonly string[]): string | null {
  if (!state.pc || !state.actors[state.pc]) return '還沒有主角，沒有人可以勾口味單。'
  const other = k.activity.blockOf(state, `commit:${TASTE_ACTION}`)
  if (other) return other
  const options = new Map(tasteOptions(k, state).map((o) => [o.id, o]))
  for (const t of tags) if (!options.has(t)) return `口味單上沒有「${t}」這一項（查不到這個傾向標籤，或被你的內容篩選關掉了）。`
  return null
}

/** 改口味單（報告 curtain.taste）。tags 是整張單子（不在裡面的就拿掉）。不成立丟 ActionBlocked。 */
export function tasteDraft(k: Kernel, state: GameState, tags: readonly string[]): ReportDraft {
  const why = tasteBlock(k, state, tags)
  if (why) throw new ActionBlocked(why)
  const list = [...new Set(tags)]
  const cur = readCurtain(state)
  cur.taste = list
  const names = new Map(tasteOptions(k, state).map((o) => [o.id, o.name]))
  const text = list.length ? `口味單：${list.map((t) => names.get(t) ?? t).join('、')}。` : '口味單清空了。'
  const rules = curtainRules(k)
  const pure = list.length < rules.taste_min
  const lines = [text, ...(pure ? [`勾的題材不到 ${rules.taste_min} 個，館方會安排純舞台的場次。`] : [])]
  return {
    kind: 'action', action: TASTE_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: TASTE_ACTION, data: { taste: list, pure_stage: pure } }],
    changes: [curtainChange(cur)], outcome: { result: list.length ? 'set' : 'cleared', summary: lines.join('') }, narration: { results: lines },
  }
}

// ---- 夜 ----

/** 這個夜被篩選整個擋掉嗎：needs_filter 關掉、或 tags 全部關掉。 */
export function nightOff(state: GameState, n: NightEntry): boolean {
  if (n.needs_filter !== undefined && !contentAllowed(state.rules, n.needs_filter)) return true
  return n.tags.length > 0 && n.tags.every((t) => !contentAllowed(state.rules, t))
}

export interface NightRow {
  id: string
  name: string
  /** 包場的勢力 */
  faction: string
  culture: string
  tags: string[]
  /** 和口味單的交集 */
  matched: string[]
  /** 這一週的主打 */
  feature: boolean
}

export interface NightPool {
  rows: NightRow[]
  /** 口味單裡還開著的標籤少於 taste_min：這一週開純舞台場次 */
  pure_stage: boolean
  /** 口味單上還開著的標籤 */
  taste: string[]
}

/** 這一週的主打（沒有夜可以挑是 null）。這一週已經記過而且還挑得到就是它；否則用週數導出的種子挑，不看口味單、不隨亂數游標變。 */
export function featureOf(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState): NightEntry | null {
  const index = weekIndexOf(k, nowOf(state))
  const pool = allNights(k).filter((n) => !nightOff(state, n))
  if (!pool.length) return null
  const week = readCurtain(state).week
  if (week && week.index === index) {
    const kept = pool.find((n) => n.id === week.feature)
    if (kept) return kept
  }
  return new Rng(hash32(state.rng.seed, 'curtain/feature', index)).pick(pool)
}

/** 口味單與篩選之下這一週抽得到的夜。 */
export function nightPool(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState, rules?: CurtainRules): NightPool {
  const r = rules ?? curtainRules(k)
  const taste = openTaste(state)
  const pure = taste.length < r.taste_min
  const feature = featureOf(k, state)?.id
  const live = allNights(k).filter((n) => !nightOff(state, n))
  const row = (n: NightEntry): NightRow => ({ id: n.id, name: n.name, faction: n.faction, culture: n.culture, tags: [...n.tags], matched: n.tags.filter((t) => taste.includes(t)), feature: n.id === feature })
  let rows = live.map(row).filter((n) => n.matched.length > 0)
  if (!rows.length && pure) rows = live.map(row)
  return { rows, pure_stage: pure, taste }
}

/** 口味單與篩選之下這一週抽得到的夜（CYBERSPACE 8.8 節「檔期主題」）。 */
export const nights = (k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState): NightRow[] => nightPool(k, state).rows

// ---- 這一週與今晚 ----

/** 今晚是遊戲的哪一天（午夜到清晨三點算前一天的晚上）。 */
export const nightOf = (k: Pick<Kernel, 'timeRules'>, state: GameState): number => segmentDayOf(state.time, k.timeRules)

/** 這一週的紀錄：記著的是這一週就用它，不是（沒有、或上一週的）就是一張新的（主打照 featureOf，打賞與場次歸零）。 */
export function weekOf(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState): WeekRecord {
  const index = weekIndexOf(k, nowOf(state))
  const week = readCurtain(state).week
  const feature = featureOf(k, state)?.id ?? week?.feature ?? ''
  if (week && week.index === index) return { ...week, feature }
  return { index, feature, tips: 0, runs: {}, drawn: {} }
}

/** 今晚報了幾場。 */
export const runsTonight = (k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState): number => weekOf(k, state).runs[String(nightOf(k, state))] ?? 0

/** 擲一個夜：先排掉今天已經跑過的（同一個夜一天之內擲到兩次就重擲）；排完沒有剩的就不排。骰面照狀態的亂數導出，報告裡的 rng 變更讓下一次換一顆。 */
export function rollNight(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState, pool: NightRow[], day: number): NightRow {
  const used = new Set(weekOf(k, state).drawn[String(day)] ?? [])
  const fresh = pool.filter((n) => !used.has(n.id))
  const list = fresh.length ? fresh : pool
  return deriveRng(state.rng, `curtain/night/${day}/${used.size}`).pick(list)
}
