import { describe, it, expect } from 'vitest'
import { refreshFloor } from './dungeon'
import { TRASH_CHUTE } from '../data/dungeon'
import { parseRows, reachable } from './grid'

describe('地下城的刷新（SITES 第 11 節）', () => {
  for (const [i, f] of TRASH_CHUTE.floors.entries()) {
    it(`${f.name}：版面不變，遭遇、陷阱、藏貨的數量不變，名字跟著搬`, () => {
      const r = refreshFloor(f, 7 + i)
      const count = (rows: string[], ch: string) => rows.join('').split(ch).length - 1
      for (const ch of ['#', 'E', 'T', 'L', 'S', 'U', 'D', 'R']) expect(count(r.rows, ch)).toBe(count(f.rows, ch))
      r.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#' || 'SUDR'.includes(c)) expect(f.rows[y][x]).toBe(c) }))
      expect(Object.keys(r.names).length).toBe(Object.keys(f.names).length)
      const cells = parseRows(r.rows)
      const start = r.rows.findIndex(row => /[SU]/.test(row))
      const sx = r.rows[start].search(/[SU]/)
      const reach = reachable({ w: 11, h: 9, passable: (x, y) => cells[y]?.[x] !== undefined && cells[y][x] !== '#' }, { x: sx, y: start })
      r.rows.forEach((row, y) => [...row].forEach((c, x) => { if ('ETL'.includes(c)) expect(reach.has(`${x},${y}`)).toBe(true) }))
    })
  }
  it('同一個種子擺出來的一樣，換種子不一樣', () => {
    const f = TRASH_CHUTE.floors[0]
    expect(refreshFloor(f, 3)).toEqual(refreshFloor(f, 3))
    expect(refreshFloor(f, 3).rows).not.toEqual(refreshFloor(f, 4).rows)
  })
})
