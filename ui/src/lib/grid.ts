import type { Point } from '../data/types'

/** 格子引擎共用的部分：家園、子網、地下城與街區用同一套（SITES 第 11 節、CYBERSPACE 第 8 節）。 */
export interface Passable { w: number; h: number; passable(x: number, y: number): boolean }

export const key = (p: Point) => `${p.x},${p.y}`
export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y
export const inBounds = (g: { w: number; h: number }, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h
const DIRS: Point[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]

/** 四方向的最短路（BFS）。回傳含起點與終點的路；走不到回傳 null。起點本身不必可走。 */
export function findPath(g: Passable, from: Point, to: Point): Point[] | null {
  if (!inBounds(g, to.x, to.y) || !g.passable(to.x, to.y)) return null
  if (samePoint(from, to)) return [from]
  const prev = new Map<string, Point>()
  const seen = new Set<string>([key(from)])
  const queue: Point[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const d of DIRS) {
      const n = { x: cur.x + d.x, y: cur.y + d.y }
      const k = key(n)
      if (seen.has(k) || !inBounds(g, n.x, n.y) || !g.passable(n.x, n.y)) continue
      seen.add(k)
      prev.set(k, cur)
      if (samePoint(n, to)) {
        const path: Point[] = [n]
        let p: Point | undefined = cur
        while (p) { path.unshift(p); p = prev.get(key(p)) }
        return path
      }
      queue.push(n)
    }
  }
  return null
}

/** 從起點走得到的所有格子。 */
export function reachable(g: Passable, from: Point): Set<string> {
  const seen = new Set<string>([key(from)])
  const queue: Point[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const d of DIRS) {
      const n = { x: cur.x + d.x, y: cur.y + d.y }
      const k = key(n)
      if (seen.has(k) || !inBounds(g, n.x, n.y) || !g.passable(n.x, n.y)) continue
      seen.add(k)
      queue.push(n)
    }
  }
  return seen
}

/** 視野：曼哈頓距離 r 以內、而且沿著可走的格子連得到（牆擋視線的簡化版）。牆本身在邊上看得到。 */
export function visibleFrom(g: Passable, from: Point, r: number): Set<string> {
  const out = new Set<string>([key(from)])
  const dist = new Map<string, number>([[key(from), 0]])
  const queue: Point[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    const d0 = dist.get(key(cur))!
    if (d0 >= r) continue
    for (const d of DIRS) {
      const n = { x: cur.x + d.x, y: cur.y + d.y }
      const k = key(n)
      if (!inBounds(g, n.x, n.y) || dist.has(k)) continue
      dist.set(k, d0 + 1)
      out.add(k)
      if (g.passable(n.x, n.y)) queue.push(n)
    }
  }
  return out
}

/** 把 ASCII 版面轉成二維陣列（每一列等長，短的補空白）。 */
export function parseRows(rows: string[]): string[][] {
  const w = Math.max(...rows.map(r => [...r].length))
  return rows.map(r => { const a = [...r]; while (a.length < w) a.push(' '); return a })
}
