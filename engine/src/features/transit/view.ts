// L6 功能 transit 的對外查詢：給畫面的「這個車站停哪幾條線」與「車上」（UI 3.13、3.14 節）。唯讀。

import type { GameState, Kernel } from '../../core'
import type { LineEntry, LineKind, PayKind, Period, Station } from './model'
import {
  blockInfo, districtInfo, fareFor, lineClosed, lineEntry, nextIndex, periodAt, stationHere, stationsOf, stopKey, stopsBetween, terminalOf, transitOf, transitRules,
} from './model'
import { advanceBlock, taxiBlock, taxiQuote, waitBlock } from './trip'

export interface DirectionView {
  dir: 1 | -1
  /** 往哪一站（環線沒有終點，是 null） */
  toward: string | null
  /** 這個方向上的每一站：幾站、車資（起跳加每一站）、幾分鐘（不含等車） */
  stops: Array<{ id: string; name: string; count: number; fare: number; minutes: number }>
  /** 從這一站往這個方向上不了車的原因（終點站）；上得了是 null */
  reason: string | null
}

export interface StationLineView {
  id: string
  name: string
  kind: LineKind
  /** 現在開不開；不開的原因是一句話 */
  open: boolean
  reason: string | null
  scan: number
  pay: PayKind[]
  wait: [number, number]
  minutes_per_stop: number
  fare: { base: number; per_stop: number }
  directions: DirectionView[]
  /** 現在付得起哪幾種錢（起跳加一站） */
  affordable: PayKind[]
}

export interface RideStopView {
  id: string
  name: string
  block: string
  state: 'past' | 'here' | 'ahead'
  dest: boolean
  /** 在這一站可以轉乘的別條線 */
  transfers: string[]
}

export interface RideView {
  line: { id: string; name: string; kind: LineKind }
  dir: 1 | -1
  toward: string | null
  phase: 'platform' | 'aboard'
  period: Period
  /** 路線條：這一條線的每一站 */
  stops: RideStopView[]
  /** 現在在第幾站（stops 的位置，0 起算） */
  at: number
  /** 坐了幾站 */
  rode: number
  /** 到終點站還有幾站（環線沒有終點，是 null） */
  toTerminal: number | null
  dest: { id: string; name: string } | null
  /** 到目的地還有幾站、幾分鐘（沒選目的地、或已經過了是 null） */
  toDest: { stops: number; minutes: number } | null
  minutes_per_stop: number
  pay: PayKind
  paid: number
  /** 下一站的車資（錢不夠時下一步會被擋） */
  nextFare: number
  /** 這個時候能做的事：等車、坐一站、下車；做不到的帶原因 */
  actions: { wait: string | null; advance: string | null }
  /** 付款有沒有留紀錄：帳戶刷卡留下，現金不留 */
  recorded: boolean
}

export interface TaxiDestinationView {
  key: string
  name: string
  block: string
  blockName: string
  district: string | null
  districtName: string | null
  visited: boolean
  km: number
  fare: number
  /** 叫不成的原因；叫得成是 null */
  reason: string | null
}

export interface TransitView {
  /** 在車上（或月台上）時才有 */
  ride: RideView | null
  /** 站在車站上、沒有在搭車時：這一站停哪幾條線 */
  station: { key: string; name: string; lines: StationLineView[] } | null
  /** 浮空計程車：有沒有得叫、每一站多少錢（不在車上時才列） */
  taxi: { reason: string | null; minutes: number; destinations: TaxiDestinationView[] }
  visited: string[]
}

function directions(line: LineEntry, index: number): DirectionView[] {
  const dirs: Array<1 | -1> = line.loop === true ? [1] : [1, -1]
  return dirs.map((dir) => {
    const stops = line.stops.flatMap((s, i) => {
      const count = stopsBetween(line, index, dir, i)
      return count === null || (line.loop !== true && i === index) ? [] : [{ id: s.id, name: s.name, count, fare: fareFor(line, count), minutes: count * line.minutes_per_stop }]
    }).sort((a, b) => a.count - b.count)
    const terminal = terminalOf(line, dir)
    return { dir, toward: terminal?.name ?? null, stops, reason: nextIndex(line, index, dir) === null ? `${line.stops[index]!.name}站是${line.name}往${terminal?.name ?? ''}站的終點站，沒有車從這裡往那個方向開。` : null }
  }).filter((d) => d.stops.length > 0 || d.reason === null)
}

function stationView(k: Kernel, state: GameState, st: Station): NonNullable<TransitView['station']> {
  const lines: StationLineView[] = st.lines.flatMap(({ line: id, index }) => {
    const line = lineEntry(k, id)
    if (!line) return []
    const reason = lineClosed(k, state, line)
    const need = line.fare.base + line.fare.per_stop
    return [{
      id: line.id, name: line.name, kind: line.kind, open: reason === null, reason, scan: line.scan ?? 0, pay: [...line.pay], wait: [line.wait[0], line.wait[1]] as [number, number],
      minutes_per_stop: line.minutes_per_stop, fare: { ...line.fare }, directions: directions(line, index), affordable: line.pay.filter((p) => state.money[p] >= need),
    }]
  })
  return { key: st.key, name: st.name, lines }
}

function rideView(k: Kernel, state: GameState): RideView | null {
  const trip = transitOf(state).trip
  const line = trip ? lineEntry(k, trip.line) : undefined
  if (!trip || !line) return null
  const all = stationsOf(k)
  const stops: RideStopView[] = line.stops.map((s, i) => ({
    id: s.id, name: s.name, block: s.block, dest: trip.dest === s.id,
    state: i === trip.at ? 'here' : stopsBetween(line, trip.at, trip.dir, i) !== null ? 'ahead' : 'past',
    transfers: (all.find((st) => st.key === stopKey(s))?.lines ?? []).filter((l) => l.line !== line.id).map((l) => l.line),
  }))
  const destIdx = trip.dest ? line.stops.findIndex((s) => s.id === trip.dest) : -1
  const toDestStops = destIdx >= 0 && destIdx !== trip.at ? stopsBetween(line, trip.at, trip.dir, destIdx) : null
  const terminal = terminalOf(line, trip.dir)
  const toTerminal = terminal ? (stopsBetween(line, trip.at, trip.dir, line.stops.indexOf(terminal)) ?? 0) : null
  return {
    line: { id: line.id, name: line.name, kind: line.kind }, dir: trip.dir, toward: terminal?.name ?? null, phase: trip.phase, period: periodAt(k, state.time), stops, at: trip.at, rode: trip.rode,
    toTerminal, dest: destIdx >= 0 ? { id: trip.dest!, name: line.stops[destIdx]!.name } : null,
    toDest: toDestStops === null ? null : { stops: toDestStops, minutes: toDestStops * line.minutes_per_stop }, minutes_per_stop: line.minutes_per_stop, pay: trip.pay, paid: trip.paid,
    nextFare: line.fare.per_stop, actions: { wait: waitBlock(k, state), advance: advanceBlock(k, state) }, recorded: trip.pay === 'cred',
  }
}

/** 給畫面：現在在車上（路線條、到了第幾站、還有幾站），或站在車站上時這一站停哪幾條線；加上浮空計程車每一站的車資與原因。 */
export function transitView(k: Kernel, state: GameState): TransitView {
  const w = transitOf(state)
  const ride = rideView(k, state)
  const here = ride ? undefined : stationHere(k, state)
  const rules = transitRules(k)
  const destinations: TaxiDestinationView[] = stationsOf(k).map((st) => {
    const q = taxiQuote(k, state, st.key)!
    const b = blockInfo(k, st.block)
    const d = districtInfo(k, q.districtId)
    return { key: st.key, name: st.name, block: st.block, blockName: b?.name ?? st.block, district: q.districtId ?? null, districtName: d?.name ?? null, visited: w.visited.includes(st.key), km: q.km, fare: q.fare, reason: taxiBlock(k, state, st.key) }
  })
  const reason = ride ? '你在車上，要先下車才能叫計程車。' : !state.rules.fastTravel ? '存檔規則關掉了快速移動，浮空計程車叫不到。' : null
  return { ride, station: here ? stationView(k, state, here) : null, taxi: { reason, minutes: rules.taxi_minutes, destinations }, visited: [...w.visited] }
}

