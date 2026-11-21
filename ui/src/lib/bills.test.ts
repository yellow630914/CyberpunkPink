import { describe, it, expect } from 'vitest'
import { settleBills, billMultiplier, downhillStage, launderNeeded, type BillItem } from './bills'
import { BILL_ITEMS, INCOMES } from '../data/weekly'

const item = (id: string, order: number, base: number, from: '帳戶' | '現金' = '帳戶', extra: Partial<BillItem> = {}): BillItem => ({ id, order, name: id, note: '', base, from, ifUnpaid: '', ...extra })

describe('每週帳單（DOWNTIME 第 5 節）', () => {
  it('這份假存檔：帳戶 2,061、現金 180，付得清', () => {
    const r = settleBills(BILL_ITEMS, INCOMES, { acc: 4620, cash: 3700 }, 1)
    expect(r.dueAcc).toBe(2061)
    expect(r.dueCash).toBe(180)
    expect(r.owing).toBe(false)
    expect(r.accAfter).toBe(4620 - 2061)
    expect(r.cashAfter).toBe(3700 + 180 - 180)
  })
  it('收入先入帳，再照順序扣；錢不夠就停在那一項', () => {
    const items = [item('rent', 1, 150), item('sub', 2, 400), item('angel', 6, 120)]
    const r = settleBills(items, [{ id: 'i', name: '抽成', amount: 100, to: '帳戶' }], { acc: 400, cash: 0 }, 1)
    expect(r.lines.map(l => l.state)).toEqual(['paid', 'short', 'unpaid'])
    expect(r.firstShort?.id).toBe('sub')
    expect(r.accAfter).toBe(350)
    expect(r.owing).toBe(true)
  })
  it('倍率乘在金額上；關閉是 ×0；範圍 ×0～2', () => {
    expect(settleBills([item('rent', 1, 150)], [], { acc: 1000, cash: 0 }, 1.5).dueAcc).toBe(225)
    expect(billMultiplier('關閉', 1)).toBe(0)
    expect(billMultiplier('標準', 3)).toBe(2)
    expect(settleBills([item('rent', 1, 150)], [], { acc: 0, cash: 0 }, 0).owing).toBe(false)
  })
  it('主動停掉的不算欠款', () => {
    const r = settleBills([item('angel', 6, 120, '帳戶', { skipped: true })], [], { acc: 0, cash: 0 }, 1)
    expect(r.owing).toBe(false)
    expect(r.lines[0].state).toBe('skipped')
  })
  it('下坡路：欠繳週數 +1；寬鬆最多到第 1 步', () => {
    expect(downhillStage(false, 3, '標準')).toBe(0)
    expect(downhillStage(true, 0, '標準')).toBe(1)
    expect(downhillStage(true, 2, '嚴苛')).toBe(3)
    expect(downhillStage(true, 5, '標準')).toBe(4)
    expect(downhillStage(true, 2, '寬鬆')).toBe(1)
    expect(downhillStage(true, 2, '關閉')).toBe(0)
  })
  it('補上差額：洗錢攤抽 15% 時要洗多少', () => {
    expect(launderNeeded(850, 0.15)).toBe(1000)
    expect(launderNeeded(0, 0.15)).toBe(0)
  })
})
