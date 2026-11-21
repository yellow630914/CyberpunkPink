import { describe, it, expect } from 'vitest'
import { NetBattle, T60_UNITS } from './net'
import { seeded } from './rng'
import { NET_ENCOUNTERS } from '../../data/encounters'

const enc = (id: string) => structuredClone(NET_ENCOUNTERS.find(e => e.id === id)!.setup)

describe('內海戰鬥・第四版', () => {
  it('守著節點的人不能換位；每回合結束下載一回合、追蹤度 +2（加上回合的 +3）', () => {
    const b = new NetBattle(enc('download'), seeded(1))
    const h = b.units[b.dl!.holder]
    expect(h.name).toBe('零')
    expect(b.canMove(h, h.slot + 1)).toBe(false)
    const t0 = b.trace
    b.idx = b.order.length - 1
    b.advance()
    expect(b.dl!.left).toBe(2)
    expect(b.trace).toBeGreaterThanOrEqual(t0 + 5)
  })
  it('守著的人倒下或拔線，下載中斷；撐完就贏', () => {
    const b = new NetBattle(enc('download'), seeded(2))
    b.units[b.dl!.holder].down = true
    b.downloadTick()
    expect(b.dl!.broken).toBe(true)
    const c = new NetBattle(enc('download'), seeded(3))
    c.dl!.left = 1
    c.downloadTick()
    expect(c.end?.result).toBe('win')
  })
  it('追蹤度 60：精英上線、現實的保全警戒；格子滿了就排隊，空出來再上線', () => {
    const b = new NetBattle(enc('bluewhale'), seeded(4))
    b.trace = 60
    b.traceCheck()
    expect(b.realAlert).toBe(true)
    expect(b.queue.map(q => q.name)).toContain(T60_UNITS.runner.name)
    b.units.find(u => u.side === 'E' && !u.down)!.down = true
    b.drainQueue()
    expect(b.queue).toHaveLength(0)
    expect(b.units.some(u => u.name === T60_UNITS.runner.name)).toBe(true)
  })
  it('星旗的子網：60 是精英蕾絲，定位之後兩回合就斷線', () => {
    const b = new NetBattle({ ...enc('patrol'), owner: '星旗防務' }, seeded(5))
    b.trace = 90
    b.traceCheck()
    expect(b.units.some(u => u.name === T60_UNITS.lace.name) || b.queue.length > 0).toBe(true)
    expect(b.loc).toBe(2)
  })
})
