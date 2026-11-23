// L6 功能：探索的幾何（視線與巡邏的走法；SITES 12.5 節「被看到」「巡邏」）。純函式，只讀 Sheet。

import type { Sheet } from '../../core'
import { pointKey } from '../../core'

export type Pt = [number, number]
export interface Mover { at: Pt; leg: number; gone?: boolean }

export const samePt = (a: Pt, b: Pt): boolean => a[0] === b[0] && a[1] === b[1]

/** 兩格之間的直線（Bresenham）經過的格子，不含兩端。 */
function between(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = []
  let [x, y] = a
  const dx = Math.abs(b[0] - x)
  const dy = Math.abs(b[1] - y)
  const sx = x < b[0] ? 1 : -1
  const sy = y < b[1] ? 1 : -1
  let err = dx - dy
  for (;;) {
    if (x === b[0] && y === b[1]) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
    if (x === b[0] && y === b[1]) break
    out.push([x, y])
  }
  return out
}

const clear = (sheet: Sheet, a: Pt, b: Pt): boolean => between(a, b).every(([x, y]) => sheet.traitsAt(x, y).see)

/**
 * a 看得到 b：同一個區塊、中間沒有擋視線的格子（牆、關著的門、擺設）。
 * 直線從哪一頭畫過去結果可能不同（格子的角），兩頭任何一條畫得通就算看得到，這樣看得到不看誰先。
 */
export function sees(sheet: Sheet, a: Pt, b: Pt): boolean {
  const za = sheet.zoneAt(a[0], a[1])
  if (za === undefined || za !== sheet.zoneAt(b[0], b[1])) return false
  return clear(sheet, a, b) || clear(sheet, b, a)
}

/** 保全自己走的路：地板，加上上鎖的門（他們有鑰匙）。 */
const guardPass = (sheet: Sheet) => (x: number, y: number): boolean => sheet.walkable(x, y) || !!sheet.traitsAt(x, y).locked

/** 從 from 出發每一格的走路距離（四方向）。 */
function distMap(sheet: Sheet, from: Pt): Map<string, number> {
  const pass = guardPass(sheet)
  const dist = new Map<string, number>([[pointKey(from[0], from[1]), 0]])
  const queue: Pt[] = [from]
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!
    const d = dist.get(pointKey(cur[0], cur[1]))!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cur[0] + dx
      const y = cur[1] + dy
      const key = pointKey(x, y)
      if (dist.has(key) || !sheet.inBounds(x, y) || !pass(x, y)) continue
      dist.set(key, d + 1)
      queue.push([x, y])
    }
  }
  return dist
}

export interface Patrol {
  /** 照順序要去的區塊（走不到的拿掉） */
  route: string[]
  /** 每一個區塊的落點，和 route 一一對應 */
  anchors: Pt[]
}

/**
 * 一個保全的巡邏路線：每個區塊的落點是「從保全站的位置走路最近的地板格」（一樣近取上面、左邊的），
 * 保全站的那一區的落點就是他站的那一格，所以走完一圈剛好回原位。走得到的區塊少於兩個就沒有巡邏。
 * half：「巡邏減半」的連動，只留路線的前一半（至少兩個區塊）。
 */
export function patrolOf(sheet: Sheet, guard: string, home: Pt, half = false): Patrol | null {
  const def = (sheet.def.patrols ?? []).find((p) => p.guard === guard)
  if (!def || !Array.isArray(def.route)) return null
  const full = def.route.filter((z): z is string => typeof z === 'string')
  const kept = half ? full.slice(0, Math.max(2, Math.ceil(full.length / 2))) : full
  const dist = distMap(sheet, home)
  const homeZone = sheet.zoneAt(home[0], home[1])
  const route: string[] = []
  const anchors: Pt[] = []
  for (const zone of kept) {
    let best: Pt | undefined
    if (zone === homeZone) best = home
    else {
      let bestD = Infinity
      for (let y = 0; y < sheet.h; y++) {
        for (let x = 0; x < sheet.w; x++) {
          if (sheet.zoneAt(x, y) !== zone || !sheet.walkable(x, y)) continue
          const d = dist.get(pointKey(x, y))
          if (d !== undefined && d < bestD) { best = [x, y]; bestD = d }
        }
      }
    }
    if (!best) continue
    route.push(zone)
    anchors.push(best)
  }
  return route.length >= 2 ? { route, anchors } : null
}

/** 保全一開始的狀態：站在原位；站的那一區是路線的第一個區塊時，下一個要去的是第二個。 */
export function startMover(sheet: Sheet, home: Pt, patrol: Patrol): Mover {
  return { at: [home[0], home[1]], leg: sheet.zoneAt(home[0], home[1]) === patrol.route[0] ? 1 % patrol.route.length : 0 }
}

/** 往下一個區塊走一格（走區塊之間的最短路）；到了落點就改成往再下一個。回傳新的狀態。 */
export function stepMover(sheet: Sheet, patrol: Patrol, mover: Mover): Mover {
  const n = patrol.anchors.length
  let leg = ((Math.trunc(mover.leg) % n) + n) % n
  let guard = 0
  while (samePt(mover.at, patrol.anchors[leg]!) && guard++ < n) leg = (leg + 1) % n
  const target = patrol.anchors[leg]!
  const path = sheet.findPath({ x: mover.at[0], y: mover.at[1] }, { x: target[0], y: target[1] }, guardPass(sheet))
  if (!path || path.length < 2) return { at: mover.at, leg }
  const next: Pt = [path[1]!.x, path[1]!.y]
  if (samePt(next, target)) leg = (leg + 1) % n
  return { at: next, leg }
}
