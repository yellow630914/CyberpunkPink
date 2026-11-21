import { describe, it, expect } from 'vitest'
import { RealBattle } from './real'
import { seeded } from './rng'
import { REAL_ENCOUNTERS } from '../../data/encounters'

/** 第四版：主動技能、快駭、機甲、無人機、控制節點與場地效果 */
const mk = (id = 'warehouse', seed = 1) => new RealBattle(structuredClone(REAL_ENCOUNTERS.find(e => e.id === id)!.setup), seeded(seed))
/** 把回合轉到某個我方的人 */
function turnOf(b: RealBattle, name: string) {
  const id = b.units.find(u => u.side === 'P' && u.name === name)!.id
  b.idx = b.order.indexOf(id)
  const u = b.cur(); u.ap = u.apMax
  return u
}
const foe = (b: RealBattle, i = 0) => b.alive('E').sort((a, c) => a.slot - c.slot)[i]

describe('現實戰鬥・第四版', () => {
  it('技能清單只列學了（裝著）的技能；要害射擊有定點射時只花 2 點、算瞄準過', () => {
    const b = mk()
    const u = turnOf(b, '你')
    const list = b.skillList(u).map(s => s.n)
    expect(list).toContain('要害射擊'); expect(list).toContain('連射')
    expect(b.skillList(u).find(s => s.k === 'aim')!.c).toBe(2)
    expect(b.skillList(turnOf(b, '奈奈')).some(s => s.k === 'aim')).toBe(false)
    turnOf(b, '你')
    b.skillAct('aim')
    expect(b.mode).toBe('sk:aim')
    const t = foe(b), ap = u.ap, mag = u.ws[u.wi].mag
    b.pick({ kind: 'unit', id: t.id })
    expect(u.ap).toBe(ap - 2)
    expect(u.ws[u.wi].mag).toBe(mag - 1)
    expect(b.lines.some(l => l.t.includes('要害射擊'))).toBe(true)
  })
  it('連射花掉剩下的全部，自帶壓制的定力檢定', () => {
    const b = mk()
    const u = turnOf(b, '你')
    b.skillAct('burst'); b.pick({ kind: 'unit', id: foe(b).id })
    expect(u.ws[u.wi].mag).toBe(0)
    expect(b.lines.some(l => l.t.includes('定力'))).toBe(true)
    expect(b.skillReason('burst')).not.toBeNull()
  })
  it('快駭：標記不用檢定、每回合一次；癱瘓要先標記；花 RAM', () => {
    const b = mk()
    const u = turnOf(b, '零')
    expect(b.skillReason('qh_freeze')).toBe('沒有被標記的敵人')
    b.skillAct('qh_tag'); b.pick({ kind: 'unit', id: foe(b).id })
    expect(foe(b).mark).toBe(u.id)
    expect(u.ram).toBe(7)
    expect(b.skillReason('qh_tag')).toContain('用過了')
    expect(b.skillReason('qh_freeze')).toBeNull()
  })
  it('控制節點：拿下之後可以關燈（黑暗：全場迴避 +2，有夜視的不算）與放下防爆門', () => {
    const b = mk('warehouse', 3)
    const u = turnOf(b, '零')
    for (let i = 0; i < 6 && !b.nodes[0].taken; i++) { u.ap = u.apMax; u.ram = 8; b.skillAct('node:n0') }
    expect(b.nodes[0].taken).toBe(true)
    const t = foe(b), me = b.units.find(x => x.name === '你')!
    const d0 = b.dodge(t, me)
    u.ap = u.apMax; b.skillAct('use:n0')
    expect(b.dark).toBe(true)
    expect(b.dodge(t, me)).toBe(d0 + 2)
    expect(b.dodge(t, u)).toBe(d0)
  })
  it('無人機：照同步限制台數、和人重疊、永遠暴露；擊落時操作者感載 +5', () => {
    const b = mk()
    const u = turnOf(b, '喬')
    expect(b.droneCap(u)).toBe(2)
    b.skillAct('drone'); b.pick({ kind: 'slot', side: 'P', slot: 1 })
    expect(b.drones).toHaveLength(1)
    const d = b.drones[0]
    b.skillAct(`cmd:${d.id}`); b.pick({ kind: 'unit', id: foe(b).id })
    expect(d.used).toBe(true)
    d.hp = 1
    const e = b.units.find(x => x.side === 'E' && !x.down)!
    const load = u.load
    for (let i = 0; i < 20 && !d.down; i++) b.shootDrone(e, d)
    expect(d.down).toBe(true)
    expect(u.load === load + 5 || u.layers > 0).toBe(true)
  })
  it('機甲：每場一次、3 點；傷害先打機體、20% 回灌成感載；機體歸零損毀，感載 +15', () => {
    const b = mk()
    const u = turnOf(b, '喬')
    b.skillAct('mech')
    expect(u.mechOn).toBe(true)
    expect(u.armor).toBe(6)
    u.ap = u.apMax
    expect(b.skillReason('mech')).toBe('這一場用過了')
    b.mechHit(u, 10)
    expect(u.mechDur).toBe(23)
    expect(u.load).toBe(2)
    b.mechHit(u, 30)
    expect(u.mechOn).toBe(false)
    expect(u.armor).toBe(2)
  })
  it('敵方的機師在第 2 回合啟動機甲；整場打得完', () => {
    for (const seed of [1, 2, 3]) {
      const b = mk('mech', seed)
      let started = false
      let p = b.start()
      for (let g = 0; g < 400 && !b.end; g++) {
        if (p === 'enemy') { while (b.aiStep()); }
        else if (p === 'player') {
          const t = b.alive('E')[0]
          if (t && !b.reason('shoot')) { b.act('shoot'); b.pick({ kind: 'unit', id: t.id }) }
        }
        if (b.units.some(x => x.side === 'E' && x.mechUsed)) started = true
        if (!b.end) p = b.endTurn()
      }
      expect(b.end).not.toBeNull()
      expect(started).toBe(true)
    }
  })
})
