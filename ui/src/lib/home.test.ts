import { describe, it, expect } from 'vitest'
import { HomeMap, validatePlacement, deriveRooms, comfort, storage, footprint, walkGrid, type PlacedFurniture } from './home'
import { reachable } from './grid'
import { FURNITURE, TOWER4_LAYOUTS, START_FURNITURE } from '../data/home'

const map1 = new HomeMap(TOWER4_LAYOUTS[1])
const map2 = new HomeMap(TOWER4_LAYOUTS[2])
const put = (def: string, x: number, y: number, rot: PlacedFurniture['rot'] = 0): PlacedFurniture => ({ uid: 'new', def, x, y, rot })

describe('家園的地圖', () => {
  it('一級 11×8、二級 15×10', () => {
    expect([map1.w, map1.h]).toEqual([11, 8])
    expect([map2.w, map2.h]).toEqual([15, 10])
  })
  it('每一間房都從大門走得到', () => {
    for (const m of [map1, map2]) {
      const r = reachable(walkGrid(m, [], FURNITURE), m.entrance())
      for (const id of m.roomIds()) for (const c of m.roomCells(id)) expect(r.has(`${c.x},${c.y}`)).toBe(true)
    }
  })
  it('升級之後，一級的家具位置仍然合法', () => {
    const placed: PlacedFurniture[] = []
    for (const f of START_FURNITURE) {
      expect(validatePlacement(map2, FURNITURE, placed, f)).toMatchObject({ ok: true })
      placed.push(f)
    }
  })
})

describe('擺家具', () => {
  it('轉 90 度時寬高對調', () => {
    expect(footprint({ w: 2, h: 1 }, 90)).toEqual({ w: 1, h: 2 })
    expect(footprint({ w: 2, h: 1 }, 180)).toEqual({ w: 2, h: 1 })
  })
  it('空地可以放', () => {
    expect(validatePlacement(map1, FURNITURE, START_FURNITURE, put('plant_real', 5, 2))).toEqual({ ok: true, room: 'M' })
  })
  it('壓到牆、門、重疊都不行', () => {
    expect(validatePlacement(map1, FURNITURE, START_FURNITURE, put('plant_real', 0, 0))).toMatchObject({ ok: false, reason: '壓到牆了。' })
    expect(validatePlacement(map1, FURNITURE, START_FURNITURE, put('plant_real', 8, 5))).toMatchObject({ ok: false, reason: '不能擋住門。' })
    const r = validatePlacement(map1, FURNITURE, START_FURNITURE, put('plant_real', 1, 2))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('折疊床墊')
  })
  it('跨兩間房不行', () => {
    // 二級：工作台橫放在主室與第三間之間（中間是牆）一定失敗；放在門兩側也失敗
    expect(validatePlacement(map2, FURNITURE, START_FURNITURE, put('workbench', 9, 3)).ok).toBe(false)
  })
  it('家具位滿了不行', () => {
    const full = [...START_FURNITURE, { uid: 'x1', def: 'box', x: 5, y: 1, rot: 0 as const }]
    const r = validatePlacement(map1, FURNITURE, full, put('box', 6, 1))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.reason).toContain('家具位滿了')
  })
  it('不能把路堵死', () => {
    // 浴廁的門在 (8,5)，門裡面只有兩格；把唯一的空格佔掉，門後面就是死路但仍走得到；
    // 改成把主室通往浴廁門的那一格（8,4）擋住：(7,4)～(9,4) 一排擋住之後門走不到
    const blockers: PlacedFurniture[] = [
      ...START_FURNITURE.filter(f => !['stream_desk', 'sofa', 'safe'].includes(f.def)),
      { uid: 'b1', def: 'box', x: 7, y: 4, rot: 0 },
      { uid: 'b2', def: 'box', x: 9, y: 4, rot: 0 },
    ]
    const r = validatePlacement(map1, FURNITURE, blockers, put('plant_real', 8, 4))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.reason).toContain('堵死')
  })
  it('整備架只能放在車庫', () => {
    const r = validatePlacement(map2, FURNITURE, START_FURNITURE, put('mechrack', 11, 1))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.reason).toContain('車庫')
  })
  it('有人站的格子不行', () => {
    expect(validatePlacement(map1, FURNITURE, START_FURNITURE, put('plant_real', 5, 2), { people: [{ x: 5, y: 2 }] })).toMatchObject({ ok: false, reason: '有人站在那裡。' })
  })
})

describe('房間的用途與數字', () => {
  it('用途照家具推：床→臥室、直播桌→攝影間、工作台→工作間', () => {
    const rooms = deriveRooms(map2, FURNITURE, [...START_FURNITURE, { uid: 'w', def: 'workbench', x: 11, y: 1, rot: 0 }])
    const m = rooms.find(r => r.id === 'M')!
    expect(m.qualified).toEqual(['studio', 'bedroom'])
    expect(m.use).toBe('studio')
    expect(rooms.find(r => r.id === 'C')!.use).toBe('workshop')
    expect(rooms.find(r => r.id === 'D')!.use).toBeNull()
    expect(rooms.find(r => r.id === 'B')!.use).toBeNull()
  })
  it('玩家選的用途要在條件裡才生效', () => {
    const rooms = deriveRooms(map1, FURNITURE, START_FURNITURE, { chosen: { M: 'bedroom' } })
    expect(rooms.find(r => r.id === 'M')!.use).toBe('bedroom')
    const bad = deriveRooms(map1, FURNITURE, START_FURNITURE, { chosen: { M: 'garage' } })
    expect(bad.find(r => r.id === 'M')!.use).toBe('studio')
  })
  it('兩件儲物家具→倉庫，容量 +25%', () => {
    const placed = [...START_FURNITURE, { uid: 'b1', def: 'box', x: 11, y: 1, rot: 0 as const }, { uid: 'b2', def: 'box', x: 12, y: 1, rot: 0 as const }]
    const rooms = deriveRooms(map2, FURNITURE, placed)
    expect(rooms.find(r => r.id === 'C')!.use).toBe('storeroom')
    expect(storage(FURNITURE, rooms)).toEqual({ kinds: 20 + Math.floor(24 * 1.25), safe: 6 })
  })
  it('舒適度：家具＋臥室−擁擠；到 6 是睡得好', () => {
    const rooms = deriveRooms(map1, FURNITURE, START_FURNITURE, { chosen: { M: 'bedroom' } })
    const c = comfort(FURNITURE, START_FURNITURE, rooms, { sleepers: 1 })
    expect(c).toMatchObject({ furniture: 3, bedrooms: 1, crowding: 0, total: 4, beds: 1, tier: null })
    const crowded = comfort(FURNITURE, START_FURNITURE, rooms, { sleepers: 3 })
    expect(crowded.crowding).toBe(4)
    const withPlant = [...START_FURNITURE, { uid: 'p', def: 'plant_real', x: 5, y: 2, rot: 0 as const }]
    expect(comfort(FURNITURE, withPlant, rooms, { sleepers: 1 }).tier).toBe('睡得好')
  })
  it('同一個風格 4 件以上是套組 +2', () => {
    const placed: PlacedFurniture[] = ['a', 'b', 'c', 'd'].map((u, i) => ({ uid: u, def: 'neon', x: 1 + i, y: 4, rot: 0 }))
    expect(comfort(FURNITURE, placed, [], { sleepers: 0 }).sets).toBe(2)
  })
})
