import { describe, it, expect } from 'vitest'
import { BLOCKS, DISTRICTS, buildBlockMap } from '../data/districts'
import { reachable } from './grid'

describe('手畫的街區（DISTRICTS 1.3 節）', () => {
  it('每一區至少一塊手畫的街區', () => {
    for (const d of DISTRICTS) expect(Object.values(BLOCKS).some(b => b.district === d.id && b.rows)).toBe(true)
  })
  for (const b of Object.values(BLOCKS).filter(x => x.rows)) {
    it(`${b.name}：13 × 9，設施與出口數量對得上，全部走得到`, () => {
      expect(b.rows!.length).toBe(9)
      for (const r of b.rows!) expect([...r].length).toBe(13)
      const nF = b.rows!.join('').split('F').length - 1
      const nE = b.rows!.join('').split('>').length - 1
      expect(nF).toBe(b.facilities.length)
      expect(nE).toBe(b.exits.length)
      const m = buildBlockMap(b)
      const start = [...m.exitAt.keys()][0].split(',').map(Number)
      const r = reachable({ w: m.w, h: m.h, passable: (x, y) => m.cells[y]?.[x] !== undefined && m.cells[y][x] !== '#' }, { x: start[0], y: start[1] })
      for (const k of [...m.facilityAt.keys(), ...m.exitAt.keys()]) expect(r.has(k)).toBe(true)
    })
  }
})
