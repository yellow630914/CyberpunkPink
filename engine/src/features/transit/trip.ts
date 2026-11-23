// L6 功能 transit 的行動：上車、等車、坐一站、下車、浮空計程車。每一個都是純函式：回傳報告草稿（不成立時丟 ActionBlocked，
// 原因是給玩家看的完整句子；一個一個條件）。xxxBlock 只問不做，回傳原因或 null，給畫面灰掉按鈕用。
// 規格：DISTRICTS 1.2.1 節（搭車）；EVENTS 3.1 節（transit_wait、transit_stop、transit_taxi）；LIFE 2.1 節（進站掃橋）；dev/adr/0016 第一、六節；dev/work/M2-transit.md。
//
// 一趟的流程：board（站上車站、付起跳；有掃橋的線先掃）→ wait（月台等車，擲幾分鐘）→ advance（坐一站，付這一站的錢）……→ alight（下車，放到那一站）。
// 錢的算法：起跳在上車時付，每一站的錢在坐那一站時付；沒掃過、沒坐過的不收。目的地只是記號，到了不會自動下車；到終點站（環線沒有）要下車。

import type { ActivityEndMerged, Change, GameState, Kernel, ReportDraft, ReportTrigger, TimelineBeat } from '../../core'
import { ActionBlocked, attachActivityEnd, clone, deriveRng, effectCtx, endActivity, formatAmount } from '../../core'
import type { LineEntry, PayKind, Station, StopDef, Trip } from './model'
import {
  OWNER, PAY_NAME, RIDE_ACTIVITY, blockInfo, districtInfo, kmBetween, lineClosed, lineEntry, nextIndex, periodAt, stationHere, stationKey, stationsOf,
  stopIndex, stopKey, stopsBetween, taxiFare, terminalOf, transitOf, transitRules,
} from './model'

export const SCAN_KIND = 'scan'
/** 掃橋發起的人記在 origin 的 by 與 ref。 */
export const BOARD_REF = 'board'

// ---- 報告的共用部分 ----

function draft(state: GameState, action: string, text: string, changes: Change[], result: string, summary: string, o: { triggers?: ReportTrigger[]; data?: Record<string, unknown>; extra?: Partial<ReportDraft> } = {}): ReportDraft {
  const beat: TimelineBeat = { layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: action, ...(o.data ? { data: o.data } : {}) }
  return {
    kind: 'action', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [beat], changes,
    outcome: { result, summary }, ...(o.triggers?.length ? { triggers: o.triggers } : {}), ...(o.extra ?? {}),
  }
}

const held = (state: GameState, pay: PayKind): number => state.money[pay]
const short = (state: GameState, pay: PayKind, need: number): string => `${PAY_NAME[pay]}不夠：要 ${formatAmount(need)}，你有 ${formatAmount(held(state, pay))}。`

/** 觸發點的 where：線、種類、站、街區、區、時段（尖峰或深夜）。值都是字串。 */
function whereOf(k: Kernel, line: LineEntry, stop: StopDef, time: GameState['time']): Record<string, string> {
  const district = blockInfo(k, stop.block)?.district
  return { line: line.id, kind: line.kind, stop: stop.id, block: stop.block, ...(district ? { district } : {}), period: periodAt(k, time) }
}

const timeAfter = (state: GameState, minutes: number): GameState['time'] => {
  const total = (state.time.day - 1) * 1440 + state.time.hour * 60 + state.time.minute + minutes
  return { day: Math.floor(total / 1440) + 1, hour: Math.floor((total % 1440) / 60), minute: total % 60 }
}

// ---- 上車 ----

export interface BoardInput {
  line: string
  /** 往哪個方向（1 往 stops 的後面、-1 往前面）；沒寫就是這一站往得出去的第一個方向（環線只有 1） */
  dir?: 1 | -1
  /** 目的地的 stop id（只是記號）；沒寫就是沒選 */
  dest?: string
  pay: PayKind
}

export interface BoardPlan {
  line: LineEntry
  stop: StopDef
  index: number
  dir: 1 | -1
  dest: StopDef | null
  pay: PayKind
  station: Station
}

/** 上車的條件（一條一個條件，照順序問）：成立回傳規劃，不成立回傳原因。 */
export function planBoard(k: Kernel, state: GameState, input: BoardInput): BoardPlan | string {
  if (transitOf(state).trip) return '你已經在車上了，要先下車才能再搭別的車。'
  const line = lineEntry(k, input.line)
  if (!line) return `沒有 ${input.line} 這條線。`
  const station = stationHere(k, state)
  const index = station ? line.stops.findIndex((s) => stopKey(s) === station.key) : -1
  if (!station || index < 0) return `你不在${line.name}的車站上，要走到車站才能上車。`
  const stop = line.stops[index]!
  const closed = lineClosed(k, state, line)
  if (closed) return closed
  const dirs: Array<1 | -1> = line.loop === true ? [1] : [1, -1]
  const destIdx = input.dest === undefined ? -1 : stopIndex(line, input.dest)
  if (input.dest !== undefined && destIdx < 0) return `${line.name}沒有 ${input.dest} 這一站。`
  // 沒指定方向：有目的地就往開得到目的地的方向，沒有就是這一站往得出去的第一個方向
  const dir = input.dir ?? dirs.find((d) => nextIndex(line, index, d) !== null && (destIdx < 0 || stopsBetween(line, index, d, destIdx) !== null))
    ?? dirs.find((d) => nextIndex(line, index, d) !== null)
  if (dir === undefined) return `${stop.name}是${line.name}唯一的一站，沒有車可以搭。`
  if (!dirs.includes(dir)) return `${line.name}是環線，只往一個方向開。`
  if (nextIndex(line, index, dir) === null) return `${stop.name}站是${line.name}往${dirName(line, dir)}的終點站，沒有車從這裡往那個方向開。`
  const dest: StopDef | null = destIdx >= 0 ? line.stops[destIdx]! : null
  if (dest && stopsBetween(line, index, dir, destIdx) === null) return `${dest.name}站不在這個方向上，車開不到那裡。`
  if (!line.pay.includes(input.pay)) return `${line.name}不收${PAY_NAME[input.pay]}。`
  const need = line.fare.base + line.fare.per_stop
  if (held(state, input.pay) < need) return short(state, input.pay, need)
  return { line, stop, index, dir, dest, pay: input.pay, station }
}

/** 現在能不能上這一班：回傳原因或 null。 */
export function boardBlock(k: Kernel, state: GameState, input: BoardInput): string | null {
  const p = planBoard(k, state, input)
  return typeof p === 'string' ? p : null
}

/** 上了車要記的變更：付起跳、這一站記成去過、這一趟開始（在月台上，等著車來）。 */
export function boardChanges(state: GameState, plan: BoardPlan): { changes: Change[]; trip: Trip } {
  const n = transitOf(state).trips + 1
  const trip: Trip = {
    id: `r${n}`, n, line: plan.line.id, dir: plan.dir, at: plan.index, from: plan.stop.id, dest: plan.dest?.id ?? null, pay: plan.pay, phase: 'platform', rode: 0, paid: plan.line.fare.base,
  }
  return {
    changes: [...(plan.line.fare.base > 0 ? [{ op: plan.pay, delta: -plan.line.fare.base } as Change] : []), { op: 'transit.visit', station: plan.station.key }, { op: 'transit.trip', trip }],
    trip,
  }
}

const dirName = (line: LineEntry, dir: 1 | -1): string => { const t = terminalOf(line, dir); return t ? `${t.name}站` : '環線的下一站（繞一圈）' }

/**
 * 上車（報告 transit.board）：站在車站上、線開著、付得起；成立之後這一趟開始，人在月台上，下一步是等車。
 * 線寫了 scan 而且有人登記了掃橋（活動 scan）：這一份只帶 launch 一個 scan，沒有扣錢、沒有開始；
 * 掃橋做完從 activity.end 拿到 passed，過了才由那一份報告開始這一趟（沒過就什麼都沒有，車資不扣）。沒有人登記掃橋就當作過了。
 */
export function board(k: Kernel, state: GameState, input: BoardInput): ReportDraft {
  const plan = planBoard(k, state, input)
  if (typeof plan === 'string') throw new ActionBlocked(plan)
  const scan = plan.line.scan ?? 0
  if (scan > 0 && k.activity.get(SCAN_KIND)) {
    return draft(state, 'transit.board', `你走向${plan.stop.name}站的閘門。`, [], 'scanning', `你走向${plan.stop.name}站的閘門，要先過掃描。`, {
      extra: {
        launch: [{
          kind: SCAN_KIND,
          setup: { point: `${plan.line.id}:${plan.stop.id}`, name: `${plan.stop.name}站的閘門`, strength: scan, ...(plan.line.faction !== undefined ? { faction: plan.line.faction } : {}) },
          origin: { by: OWNER, ref: BOARD_REF, ext: { line: plan.line.id, dir: plan.dir, pay: plan.pay, ...(plan.dest ? { dest: plan.dest.id } : {}) } },
        }],
      },
    })
  }
  return boardedDraft(state, plan)
}

function boardedDraft(state: GameState, plan: BoardPlan): ReportDraft {
  const { changes } = boardChanges(state, plan)
  const how = plan.pay === 'cred' ? '刷了帳戶' : '用現金買了單程票'
  const text = `你在${plan.stop.name}站${how}，進了月台。`
  return draft(state, 'transit.board', text, changes, 'boarded', `${text}${plan.line.name}往${dirName(plan.line, plan.dir)}。`, { data: { line: plan.line.id, stop: plan.stop.id, dir: plan.dir, pay: plan.pay } })
}

// ---- 等車 ----

function tripOf(k: Kernel, state: GameState): { trip: Trip; line: LineEntry } | string {
  const trip = transitOf(state).trip
  if (!trip) return '你沒有在搭車。'
  const line = lineEntry(k, trip.line)
  return line ? { trip, line } : `這一趟的線 ${trip.line} 已經不存在了。`
}

export function waitBlock(k: Kernel, state: GameState): string | null {
  const t = tripOf(k, state)
  if (typeof t === 'string') return t
  return t.trip.phase === 'platform' ? null : '你已經在車上了，不用再等車。'
}

/**
 * 月台等車（報告 transit.wait）：照班距在 wait 的範圍裡擲幾分鐘（用種子導出，同一個種子同一個結果），等到了就上了車。
 * 那一份帶 transit_wait 的觸發點。
 */
export function wait(k: Kernel, state: GameState): ReportDraft {
  const t = tripOf(k, state)
  if (typeof t === 'string') throw new ActionBlocked(t)
  const { trip, line } = t
  if (trip.phase !== 'platform') throw new ActionBlocked('你已經在車上了，不用再等車。')
  const [lo, hi] = line.wait
  const minutes = deriveRng(state.rng, `transit/wait/${trip.id}`).int(lo, hi)
  const stop = line.stops[trip.at]!
  const text = `你在${stop.name}站的月台等了 ${minutes} 分鐘，${line.name}進站了，你上了車。`
  return draft(
    state, 'transit.wait', text,
    [{ op: 'time', minutes }, { op: 'rng', advance: 1 }, { op: 'transit.trip', trip: { ...trip, phase: 'aboard' } }],
    'waited', text,
    { triggers: [{ point: 'transit_wait', where: whereOf(k, line, stop, timeAfter(state, minutes)) }], data: { line: line.id, minutes } },
  )
}

// ---- 坐一站 ----

export function advanceBlock(k: Kernel, state: GameState): string | null {
  const t = tripOf(k, state)
  if (typeof t === 'string') return t
  const { trip, line } = t
  if (trip.phase !== 'aboard') return '車還沒來，要先在月台上等車。'
  if (nextIndex(line, trip.at, trip.dir) === null) return `這裡是${line.name}往${dirName(line, trip.dir)}的終點站，車不再往前開了，要在這一站下車。`
  if (held(state, trip.pay) < line.fare.per_stop) return `${PAY_NAME[trip.pay]}不夠付下一站的車資（要 ${formatAmount(line.fare.per_stop)}，你有 ${formatAmount(held(state, trip.pay))}），在這一站下車吧。`
  return null
}

/**
 * 坐一站（報告 transit.stop）：付這一站的錢、花這條線每站的分鐘、停靠在下一站。
 * 帶 transit_stop 的觸發點（where 有線、站、時段）；到了目的地只在摘要提一句，不下車。
 */
export function advance(k: Kernel, state: GameState): ReportDraft {
  const block = advanceBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const { trip, line } = tripOf(k, state) as { trip: Trip; line: LineEntry }
  const to = nextIndex(line, trip.at, trip.dir)!
  const stop = line.stops[to]!
  const per = line.fare.per_stop
  const arrives = timeAfter(state, line.minutes_per_stop)
  const atDest = trip.dest === stop.id
  const text = `${line.name}開到了${stop.name}站。${atDest ? '這是你要去的那一站。' : ''}`
  const last = nextIndex(line, to, trip.dir) === null
  return draft(
    state, 'transit.stop', text,
    [...(per > 0 ? [{ op: trip.pay, delta: -per } as Change] : []), { op: 'time', minutes: line.minutes_per_stop }, { op: 'transit.trip', trip: { ...trip, at: to, rode: trip.rode + 1, paid: trip.paid + per } }],
    'stopped', `${text}${last ? '終點站，要下車了。' : ''}`,
    { triggers: [{ point: 'transit_stop', where: whereOf(k, line, stop, arrives) }], data: { line: line.id, stop: stop.id, index: to, rode: trip.rode + 1, dest: atDest } },
  )
}

// ---- 下車 ----

export function alightBlock(k: Kernel, state: GameState): string | null {
  const t = tripOf(k, state)
  return typeof t === 'string' ? t : null
}

function moveChanges(k: Kernel, state: GameState, stop: StopDef): { changes: Change[]; lines: string[] } {
  const res = k.effects.resolve([{ kind: 'move', block: stop.block, at: stop.at }], effectCtx(k, state, { source: 'builtin' }))
  if (res.errors.length > 0) throw new ActionBlocked(`${stop.name}站放不下人：${res.errors.join('；')}`)
  return { changes: res.changes, lines: res.lines }
}

/**
 * 下車（報告 transit.alight）：用效果 move 把人放到這一站所在的街區與標記，這一站記成去過，這一趟結束（活動 ride 做完，發 activity.end）。
 * 還在月台上、或上車之後一站都沒坐：人還在上車的那一站，只結束這一趟（起跳不退）。
 */
export function alight(k: Kernel, state: GameState): ReportDraft {
  const t = tripOf(k, state)
  if (typeof t === 'string') throw new ActionBlocked(t)
  const { trip, line } = t
  const stop = line.stops[trip.at]!
  const moved = trip.rode > 0 ? moveChanges(k, state, stop) : { changes: [], lines: [] }
  const end: ActivityEndMerged = endActivity(k, {
    state, kind: RIDE_ACTIVITY, id: trip.id, origin: { by: OWNER, ref: line.id }, outcome: 'alight',
    result: { line: line.id, stop: stop.id, rode: trip.rode, paid: trip.paid, pay: trip.pay },
  })
  const text = trip.rode > 0 ? `你在${stop.name}站下了車。` : `你沒有坐車，離開了${stop.name}站的月台。`
  const lines = [...moved.lines, ...end.lines]
  const d = draft(
    state, 'transit.alight', text,
    [...moved.changes, { op: 'transit.visit', station: stopKey(stop) }, { op: 'transit.trip', trip: null }, ...end.changes],
    'alighted', `${text}坐了 ${trip.rode} 站，花了 ${formatAmount(trip.paid)}（${PAY_NAME[trip.pay]}）。${lines.map((x) => `${x}。`).join('')}`,
    { data: { line: line.id, stop: stop.id, rode: trip.rode, paid: trip.paid } },
  )
  return attachActivityEnd(d, end)
}

// ---- 浮空計程車 ----

export interface TaxiQuote {
  station: Station
  km: number
  fare: number
  minutes: number
  districtId: string | undefined
}

/** 到這一站要多少錢、幾公里、幾分鐘（不看能不能叫；不是站回傳 null）。 */
export function taxiQuote(k: Kernel, state: GameState, to: string): TaxiQuote | null {
  const station = stationsOf(k).find((s) => s.key === to)
  if (!station) return null
  const rules = transitRules(k)
  const districtId = blockInfo(k, station.block)?.district
  const km = kmBetween(rules, state.location.district, districtId)
  return { station, km, fare: taxiFare(rules, km, districtInfo(k, districtId)?.mult ?? 1), minutes: rules.taxi_minutes, districtId }
}

/** 叫得成嗎：回傳原因或 null。to 是站的 key（stationKey）。 */
export function taxiBlock(k: Kernel, state: GameState, to: string): string | null {
  if (transitOf(state).trip) return '你在車上，要先下車才能叫計程車。'
  if (!state.rules.fastTravel) return '存檔規則關掉了快速移動，浮空計程車叫不到。'
  const q = taxiQuote(k, state, to)
  if (!q) return `沒有 ${to} 這一站。`
  const rules = transitRules(k)
  const here = stationHere(k, state)
  if (here && here.key === q.station.key) return `你已經在${q.station.name}站了。`
  if (!rules.anywhere && !transitOf(state).visited.includes(q.station.key)) return `你還沒去過${q.station.name}站，浮空計程車只載你去去過的站。`
  if (q.districtId && rules.no_taxi.includes(q.districtId)) return `浮空計程車不進${districtInfo(k, q.districtId)?.name ?? q.districtId}。`
  if (held(state, 'cred') < q.fare) return short(state, 'cred', q.fare)
  return null
}

/**
 * 叫浮空計程車（報告 transit.taxi，出發與抵達各一份，照順序提交）：帳戶付車資（起跳 ＋ 每公里 × 公里數，乘目的地那一區的物價），
 * 出發那一份花 10 分鐘、抵達那一份用 move 把人放到那一站；兩份各帶一個 transit_taxi（where.phase 是 depart 或 arrive）。
 */
export function taxi(k: Kernel, state: GameState, to: string): ReportDraft[] {
  const block = taxiBlock(k, state, to)
  if (block) throw new ActionBlocked(block)
  const q = taxiQuote(k, state, to)!
  const stop: StopDef = { id: q.station.key, name: q.station.name, block: q.station.block, at: q.station.at }
  const from = { ...(state.location.district ? { district: state.location.district } : {}), ...(state.location.block ? { block: state.location.block } : {}) }
  const moved = moveChanges(k, state, stop)
  const depart = draft(
    state, 'transit.taxi', `你叫了一輛浮空計程車，往${stop.name}站。`,
    [{ op: 'cred', delta: -q.fare }, { op: 'time', minutes: q.minutes }], 'departed', `你叫了一輛浮空計程車往${stop.name}站，${q.km} 公里，車資 ${formatAmount(q.fare)}（帳戶）。`,
    { triggers: [{ point: 'transit_taxi', where: { phase: 'depart', kind: 'taxi', ...from } }], data: { to: q.station.key, km: q.km, fare: q.fare } },
  )
  const arrive = draft(
    state, 'transit.taxi', `浮空計程車停在${stop.name}站。`,
    [...moved.changes, { op: 'transit.visit', station: q.station.key }], 'arrived', `你到了${stop.name}站。`,
    { triggers: [{ point: 'transit_taxi', where: { phase: 'arrive', kind: 'taxi', block: q.station.block, ...(q.districtId ? { district: q.districtId } : {}) } }], data: { to: q.station.key } },
  )
  return [depart, arrive]
}

export { stationKey }
