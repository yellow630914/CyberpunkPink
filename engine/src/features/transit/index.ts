// L6 功能：公共交通（DISTRICTS 1.2.1 節；EVENTS 3.1 節；UI 3.13、3.14 節；LIFE 2.1 節；dev/adr/0016 第一、六節；dev/work/M2-transit.md）。
//
// 在車站上車、等車、一站一站坐、選一站下車；浮空計程車點到點。車資、時間、進站的掃橋、每一站與計程車的事件觸發點。
// 車廂裡的人與車上能做的每一件事不在這裡（別的功能照活動的放行接上來：k.activity.allow('ride', 前綴)）；自己的車不在這裡。
//
// 接上核心的地方：
//   內容  transit_line（格式見 model.ts；載入之後 ready 查每一站的街區與勢力找得到）、transit_rule（id: default，蓋掉計程車的預設與尖峰、深夜的時段）
//   變更  transit.trip（記這一趟，或結束）、transit.visit（記一站去過）
//   活動  ride（order 80；放行 commit:transit.、commit:event.、event.start、chain:free_action、commit:npc.）；在車上走地圖、做別的事都被擋下
//   格子  usesOf：站在車站的標記上列「搭車」（現在每條線都不開時灰掉並寫原因）
//   掛點  activity.end（掃橋做完：過了才上車、車資這時才扣；沒過就沒有上車）
// 報告：transit.board、transit.wait、transit.stop、transit.alight、transit.taxi（出發與抵達各一份）。
// 觸發點：transit_wait、transit_stop（where: line、kind、stop、block、district、period 是 peak／night／day）、transit_taxi（where.phase 是 depart 或 arrive）。
// 狀態 state.ext.transit：{ visited, trips, trip }。位置本身用核心的 location（block 與 facility 是站的街區與標記）。
// 對外：board、wait、advance、alight、taxi（回傳報告草稿）、boardBlock／waitBlock／advanceBlock／alightBlock／taxiBlock（只問不做）、transitView。

import type { Change, Feature, GameState, GridUse, Kernel } from '../../core'
import { ContentError, isRecord, isSafeInt } from '../../core'
import { BOARD_REF, SCAN_KIND, boardChanges, planBoard } from './trip'
import type { BoardInput } from './trip'
import type { LineEntry, Trip } from './model'
import {
  EXT, LINE_KIND, OWNER, PAY_KINDS, RIDE_ACTIVITY, RULE_KIND, lineClosed, lineEntry, linesOf, lineProblems, ruleProblems, stationAt, transitOf, tripProblems,
} from './model'

export { SCAN_KIND, BOARD_REF, advance, advanceBlock, alight, alightBlock, board, boardBlock, planBoard, taxi, taxiBlock, taxiQuote, wait, waitBlock } from './trip'
export type { BoardInput, BoardPlan, TaxiQuote } from './trip'
export { transitView } from './view'
export type { DirectionView, RideStopView, RideView, StationLineView, TaxiDestinationView, TransitView } from './view'
export {
  DEFAULT_TRANSIT_RULES, KIND_NAME, LINE_KINDS, PAY_KINDS, PAY_NAME, RIDE_ACTIVITY, fareFor, lineClosed, nextIndex, periodAt, stationHere, stationKey, stationsOf, stopsBetween, taxiFare, terminalOf, transitOf, transitRules,
} from './model'
export type { LineEntry, LineKind, PayKind, Period, Station, StopDef, TransitRules, TransitState, Trip } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function rideLabel(k: Kernel, state: GameState): { id: string; label: string } | null {
  const trip = transitOf(state).trip
  if (!trip) return null
  const line = lineEntry(k, trip.line)
  const name = line?.name ?? trip.line
  return { id: trip.id, label: trip.phase === 'platform' ? `在${line?.stops[trip.at]?.name ?? ''}站的月台等${name}` : `搭乘${name}中` }
}

export const transitFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind<LineEntry>({
      kind: LINE_KIND, owner: OWNER, validate: lineProblems,
      refs: (e) => [...e.stops.map((s): [string, string] => ['block', s.block]), ...(e.faction !== undefined ? [['faction', e.faction] as [string, string]] : [])],
    })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })

    // ---- 變更 ----
    k.changes.register<Change & { trip: Trip | null }>({
      op: 'transit.trip', owner: OWNER,
      validate: (_state, c) => (c.trip === null ? [] : tripProblems(c.trip)),
      apply(state, c) {
        const w = transitOf(state)
        w.trip = c.trip === null ? null : structuredClone(c.trip)
        if (c.trip && c.trip.n > w.trips) w.trips = c.trip.n
        state.ext[EXT] = w
      },
      describe: (c) => (c.trip === null ? '這一趟結束' : null),
    })
    k.changes.register<Change & { station: string }>({
      op: 'transit.visit', owner: OWNER,
      validate: (_state, c) => (isText(c.station) ? [] : ['station 要是站的 key']),
      apply(state, c) {
        const w = transitOf(state)
        if (!w.visited.includes(c.station)) w.visited.push(c.station)
        state.ext[EXT] = w
      },
    })

    // ---- 活動：車上 ----
    k.activity.define({
      kind: RIDE_ACTIVITY, owner: OWNER, order: 80,
      active: (state) => rideLabel(k, state),
      allow: ['commit:transit.', 'commit:event.', 'event.start', 'chain:free_action', 'commit:npc.'],
      reason: (state) => `你${transitOf(state).trip?.phase === 'platform' ? '在月台上' : '在車上'}，要先下車才能做這件事。`,
    })

    // ---- 站在車站的標記上：列「搭車」 ----
    k.grid.usesOf(OWNER, (ctx, marker): GridUse[] => {
      const st = stationAt(k, ctx.state.location.block, marker.id)
      if (!st || transitOf(ctx.state).trip) return []
      const lines = st.lines.flatMap((l) => lineEntry(k, l.line) ?? [])
      if (lines.length === 0) return []
      const reasons = lines.map((l) => lineClosed(k, ctx.state, l))
      return [{ id: 'transit.board', name: '搭車', block: reasons.every((r) => r !== null) ? reasons[0]! : null }]
    })

    // ---- 掃橋做完：過了才上車 ----
    k.hooks.on('activity.end', OWNER, (p) => {
      if (p.kind !== SCAN_KIND || p.origin.by !== OWNER || p.origin.ref !== BOARD_REF) return
      if (p.result.passed !== true) return { lines: ['你沒有上車，車資沒有扣'] }
      const ext = isRecord(p.origin.ext) ? p.origin.ext : {}
      const input: BoardInput = {
        line: String(ext.line ?? ''), pay: (PAY_KINDS as readonly unknown[]).includes(ext.pay) ? (ext.pay as BoardInput['pay']) : 'cred',
        ...(ext.dir === 1 || ext.dir === -1 ? { dir: ext.dir } : {}), ...(typeof ext.dest === 'string' ? { dest: ext.dest } : {}),
      }
      const plan = planBoard(k, p.state, input)
      if (typeof plan === 'string') return { lines: [`你沒有上車：${plan.replace(/。$/, '')}`] }
      const how = plan.pay === 'cred' ? '刷了帳戶' : '用現金買了單程票'
      return { changes: boardChanges(p.state, plan).changes, lines: [`你在${plan.stop.name}站${how}，進了月台`] }
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    for (const line of linesOf(k)) {
      if (!isSafeInt(line.minutes_per_stop)) continue
      // 同一條線上同一塊街區同一個標記不能出現兩次（那是同一個站）
      const seen = new Set<string>()
      for (const s of line.stops) {
        const key = `${s.block}:${s.at}`
        if (seen.has(key)) problems.push(`transit_line/${line.id}：站 ${s.id} 和前面的站在同一個地方（${key}）`)
        seen.add(key)
        // 車站是街區圖上的車站設施：街區（world 的內容）有列設施的話，這個標記要在裡面
        const facilities = k.content.get<{ id: string; facilities?: unknown }>('block', s.block)?.facilities
        if (isRecord(facilities) && !(s.at in facilities)) problems.push(`transit_line/${line.id}：站 ${s.id} 在 ${s.block} 的 ${s.at}，但那一塊街區沒有這個設施（車站要是街區的設施）`)
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
