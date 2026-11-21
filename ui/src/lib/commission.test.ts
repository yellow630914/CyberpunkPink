import { describe, it, expect } from 'vitest'
import { payOptions, split, scoutDc, scoutRoll, chance, supportRoll, negotiate } from './commission'
import { installQuote, removeQuote, freeSlot } from './clinic'
import { mechMax, mechStatus, repairQuote, START_MECH } from '../data/garage'
import { sequence, face20 } from './combat/rng'
import { ITEMS } from '../data/items'

describe('委託：接案', () => {
  it('怎麼付：現金全額、匯進帳戶 85%、三成換人情 70%', () => {
    const p = payOptions(7400)
    expect(p.map(x => x.get)).toEqual([7400, 6290, 5180])
  })
  it('分帳：先扣抽成（換人情不抽）與出場費，你拿兩份', () => {
    const s = split({ reward: 7400, cut: 0.15, pay: 'cash', fees: 450, members: 2 })
    expect(s.cut).toBe(1110)
    expect(s.rest).toBe(7400 - 1110 - 450)
    expect(s.mine).toBe(Math.round((s.rest / 3) * 2))
    expect(split({ reward: 7400, cut: 0.15, pay: 'fav', fees: 0, members: 0 }).cut).toBe(0)
  })
  it('談判：最多推到底線 ×1.15；自然 1 就談不下去', () => {
    expect(negotiate(7400, 7400, 20, 4).value).toBeLessThanOrEqual(Math.round(7400 * 1.15))
    expect(negotiate(7400, 7400, 1, 4).done).toBe(true)
  })
})

describe('委託：踩點與輔助面', () => {
  it('DC 是 10 ＋ 等級 × 2，第 4 次起每次 +1', () => {
    expect(scoutDc(2, 1)).toBe(14)
    expect(scoutDc(2, 4)).toBe(15)
    expect(scoutDc(2, 5)).toBe(16)
  })
  it('超過 5 以上揭開兩項；自然 1 驚動目標', () => {
    expect(scoutRoll(sequence([face20(15)]), 5, 14).reveal).toBe(2)
    expect(scoutRoll(sequence([face20(10)]), 5, 14).reveal).toBe(1)
    expect(scoutRoll(sequence([face20(1)]), 5, 14).alarm).toBe(true)
  })
  it('成功率：自然 1 一定失敗', () => {
    expect(chance(5, 14)).toBe(60)
    expect(chance(30, 14)).toBe(95)
  })
  it('輔助面：分量修正強 +4、中 +2、弱 0', () => {
    const r = supportRoll(sequence([face20(10)]), 3, '強', 2)
    expect(r.tot).toBe(17)
    expect(r.result).toBe('成功')
    expect(supportRoll(sequence([face20(1)]), 9, '強', 2).result).toBe('出事')
  })
})

describe('診所', () => {
  const arm = ITEMS.it_844ea8
  it('正規診所收售價的 10%、沉溺成本 −10%；黑診所 5% 有併發症；自己動手要擲', () => {
    expect(installQuote(arm, 'clinic')).toMatchObject({ fee: Math.round(arm.price * 0.1), sink: Math.round(arm.cyber!.sink * 0.9), complication: 0, dc: null })
    expect(installQuote(arm, 'black').complication).toBe(15)
    expect(installQuote(arm, 'self')).toMatchObject({ fee: 0, dc: 10 + arm.grade * 2 })
    expect(installQuote(arm, 'clinic').hours).toBe(24)
  })
  it('有授權鎖的拆不了；橋的調校槽不給一般義體', () => {
    expect(removeQuote(ITEMS.it_d553bd).reason).toContain('授權鎖')
    expect(removeQuote(arm).reason).toBeNull()
    expect(freeSlot(['it_x', null, null], 'bridge')).toBe(-1)
    expect(freeSlot([null, null], 'armL')).toBe(0)
  })
})

describe('機甲整備', () => {
  it('上限：骨架＋板材，最多同級精英生命 × 0.4；欠整備費每週 −5', () => {
    const m = structuredClone(START_MECH)
    expect(mechMax(m)).toBe(43 + 4)
    m.plates = [2, 2, 2]
    expect(mechMax(m)).toBe(52)
    m.owedWeeks = 2
    expect(mechMax(m)).toBe(42)
  })
  it('狀態與修理的估價（CRAFTING 15.2、15.3 節）', () => {
    expect(mechStatus(0, 47)).toBe('損毀')
    expect(mechStatus(20, 47)).toBe('重損')
    expect(mechStatus(30, 47)).toBe('受損')
    const q = repairQuote(START_MECH, 21, false)
    expect(q.per).toBe(Math.round(40 * 0.7))
    expect(q.plates).toBe(2)
    expect(repairQuote(START_MECH, 21, true).money).toBe(Math.round(q.money / 2))
  })
})
