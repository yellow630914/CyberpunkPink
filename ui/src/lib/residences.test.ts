import { describe, it, expect } from 'vitest'
import { RESIDENCES, RESIDENCE_LAYOUTS, layoutFor } from '../data/home'
import { HomeMap } from './home'
import { findPath } from './grid'

describe('其他住處的地圖（第四版）', () => {
  it('每一處都有圖；每一間房從大門走得到；放得下機甲的住處有車庫', () => {
    for (const r of RESIDENCES) {
      expect(RESIDENCE_LAYOUTS[r.id], r.id).toBeTruthy()
      for (const t of [1, 2] as const) {
        const L = RESIDENCE_LAYOUTS[r.id][t]
        if (!L) continue
        const m = new HomeMap(L)
        const ent = m.entrance()
        const passable = (x: number, y: number) => !['wall', 'void'].includes(m.kind(x, y))
        for (const key of Object.keys(L.rooms)) {
          const y = L.rows.findIndex(row => row.includes(key))
          expect(y, `${r.id}/${t}/${key}`).toBeGreaterThanOrEqual(0)
          const x = L.rows[y].indexOf(key)
          expect(findPath({ w: m.w, h: m.h, passable }, ent, { x, y }), `${r.id}/${t}/${key}`).toBeTruthy()
        }
      }
      if (/機甲/.test(r.note)) expect(Object.values(layoutFor(r.id, r.tiers[1]).rooms).some(x => x.garage), r.id).toBe(true)
    }
  })
})

describe('搬家（DOWNTIME 7.2 節）', async () => {
  const { setActivePinia, createPinia } = await import('pinia')
  const { useHome } = await import('../stores/home')
  it('新家原位擺得下的照原位，擺不下的打包；浴廁的淋浴間每一處自己有', () => {
    setActivePinia(createPinia())
    const h = useHome()
    const before = h.floors.up.filter(f => f.def !== 'shower').length
    const boxed = h.moveTo('container')
    expect(h.residence).toBe('container')
    expect(h.floors.up.filter(f => f.def !== 'shower').length + boxed.length).toBe(before)
    expect(h.boxed).toEqual(boxed)
    const sh = h.floors.up.find(f => f.def === 'shower')!
    expect(h.map.roomAt(sh.x, sh.y)).toBe('B')
    expect(h.rooms.some(r => r.id === 'G')).toBe(true)
  })
})
