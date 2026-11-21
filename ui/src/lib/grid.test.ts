import { describe, it, expect } from 'vitest'
import { findPath, reachable, visibleFrom, parseRows } from './grid'

function gridFrom(rows: string[]) {
  const c = parseRows(rows)
  return { w: c[0].length, h: c.length, passable: (x: number, y: number) => c[y][x] !== '#' }
}

describe('findPath', () => {
  const g = gridFrom([
    '.....',
    '.###.',
    '.#...',
    '.#.#.',
    '...#.',
  ])
  it('找到最短路，含起點與終點', () => {
    const p = findPath(g, { x: 0, y: 0 }, { x: 4, y: 4 })!
    expect(p[0]).toEqual({ x: 0, y: 0 })
    expect(p[p.length - 1]).toEqual({ x: 4, y: 4 })
    expect(p.length).toBe(9)
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y)).toBe(1)
  })
  it('終點是牆時回傳 null', () => {
    expect(findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull()
  })
  it('被圍住時回傳 null', () => {
    const closed = gridFrom(['..#..', '..#..', '..#..'])
    expect(findPath(closed, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull()
  })
  it('起點等於終點', () => {
    expect(findPath(g, { x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }])
  })
})

describe('reachable 與 visibleFrom', () => {
  const g = gridFrom(['..#..', '..#..'])
  it('牆的另一邊走不到', () => {
    const r = reachable(g, { x: 0, y: 0 })
    expect(r.has('1,1')).toBe(true)
    expect(r.has('3,0')).toBe(false)
  })
  it('視野被牆擋住，但牆本身看得到', () => {
    const v = visibleFrom(g, { x: 1, y: 0 }, 3)
    expect(v.has('2,0')).toBe(true)
    expect(v.has('3,0')).toBe(false)
  })
})
