import { describe, it, expect } from 'vitest'
import { linesAt, ride, rideBlock, km, taxiQuote, taxiBlock, driveBlock } from './transit'
import { LINES } from '../data/transit'
import { DISTRICTS } from '../data/districts'

describe('搭車與計程車（DISTRICTS 1.2.1 節）', () => {
  it('車站停哪幾條線；坐幾站、幾分鐘、多少錢', () => {
    expect(linesAt('中央廣場').map(l => l.id)).toEqual(['red', 'sakura'])
    const red = LINES.find(l => l.id === 'red')!
    expect(ride(red, '中央廣場', 4)).toEqual({ stops: 4, minutes: 4 + 20, fare: 6 })
    expect(rideBlock(red, '中央廣場', 0, 100)).toBe('你就在這一站。')
    const loop = LINES.find(l => l.id === 'loop')!
    expect(ride(loop, '中城段・南', 0).stops).toBe(1) // 環線只往前開
  })
  it('計程車照距離收錢；地下層、舊港與鏽帶深處叫不到；錢不夠擋下', () => {
    const here = { district: 'hive' as const, block: '四號塔' }
    expect(km(DISTRICTS, 'hive', 'hive')).toBe(1)
    const q = taxiQuote(DISTRICTS, here, { district: 'crown', block: '中央廣場' })
    expect(q.fare).toBeGreaterThan(100)
    expect(taxiBlock(here, { district: 'under', block: '月台市' }, 9999, 10)).toContain('地下層')
    expect(taxiBlock(here, { district: 'oldport', block: '倉庫區' }, 9999, 10)).toContain('舊港')
    expect(taxiBlock(here, { district: 'crown', block: '中央廣場' }, 10, q.fare)).toContain('帳戶只有')
    expect(taxiBlock(here, { district: 'crown', block: '中央廣場' }, 99999, q.fare)).toBeNull()
  })
  it('自己的車：要有車，不要錢', () => {
    const here = { district: 'hive' as const, block: '四號塔' }
    expect(driveBlock([], here, { district: 'crown', block: '濱海' })).toContain('沒有車')
    expect(driveBlock(['街車'], here, { district: 'crown', block: '濱海' })).toBeNull()
  })
})
