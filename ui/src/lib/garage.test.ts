import { describe, it, expect } from 'vitest'
import { START_MECH, mechMax, overhaulQuote, upgradeQuote, applyOverhaul, applyUpgrade, carRepairQuote, repairQuote, type MechState } from '../data/garage'

const fresh = (): MechState => structuredClone(START_MECH)
describe('機甲的大修、升級與載具的修理（CRAFTING 15.3、15.4、15.6 節）', () => {
  it('大修：修滿的修理費 × 2（自己修減半）；缺的零件用殘件抵（一件抵兩件）', () => {
    const m = fresh()
    m.hp = 0
    const full = repairQuote(m, mechMax(m), false)
    const q = overhaulQuote(m, false)
    expect(q.money).toBe(full.money * 2)
    expect(overhaulQuote(m, true).money).toBe(repairQuote(m, mechMax(m), true).money * 2)
    expect(q.missing).toEqual(['機械神經元'])
    expect(q.salvageNeed).toBe(1)
    expect(q.enoughParts).toBe(true)
    applyOverhaul(m)
    expect(m.hp).toBe(mechMax(m))
    expect(m.salvage).toBe(0)
    expect(m.parts!['致動器']).toBe(0)
  })
  it('升級：下一級的骨架價 × 3、骨架與要的同步跟著升', () => {
    const m = fresh()
    const q = upgradeQuote(m)!
    expect(q.money).toBe(6480 * 3)
    expect(q.sync).toBe(3)
    applyUpgrade(m)
    expect(m.grade).toBe(3)
    expect(m.base).toBe(54)
    expect(m.hp).toBe(mechMax(m))
    m.grade = 4
    expect(upgradeQuote(m)).toBeNull()
  })
  it('載具被打爛：拖車 200、修理費目錄價的 15%（自己修半價、兩天）', () => {
    expect(carRepairQuote({ price: 3040, grade: 1 }, false)).toEqual({ tow: 200, money: 456, days: 1, dc: 12 })
    expect(carRepairQuote({ price: 3040, grade: 1 }, true).money).toBe(228)
  })
})
