import { describe, it, expect } from 'vitest'
import { checkSlot, checkAssembly, successChance, crafterBlock } from './crafting'
import { BLUEPRINTS, CRAFTERS } from '../data/crafting'
import { ITEMS } from '../data/items'

const arm = BLUEPRINTS.find(b => b.item === 'bp_sanbu')!
const slot = (id: string) => arm.slots.find(s => s.id === id)!

describe('組裝的槽（CRAFTING 3.4 節、第 4 節）', () => {
  it('類型不對、材質不對都說原因', () => {
    expect(checkSlot(arm, slot('act'), ITEMS.it_b86505)).toEqual({ ok: false, reason: '這個槽只收致動器。' })
    expect(checkSlot(arm, slot('act'), ITEMS.it_398b67)).toEqual({ ok: false, reason: '這個槽只收機械。' })
    expect(checkSlot(arm, slot('neuron'), ITEMS.it_303b76)).toEqual({ ok: true })
  })
  it('高一級是超規，高兩級塞不進去', () => {
    expect(checkSlot(arm, slot('act'), ITEMS.it_3fe2b1)).toEqual({ ok: true, overspec: true })
    const rifle = BLUEPRINTS.find(b => b.item === 'bp_meshtop')!
    expect(checkSlot(rifle, rifle.slots[0], ITEMS.it_0377b8).ok).toBe(true)
  })
})

describe('整張設計圖的檢查與難度', () => {
  it('缺必要的零件', () => {
    const a = checkAssembly(arm, { plate: ITEMS.it_b86505 })
    expect(a.ok).toBe(false)
    expect(a.missing).toEqual(['致動器', '機械神經元'])
  })
  it('難度＝標準 DC ＋ 牌子 ＋ 接面 ＋ 超規', () => {
    // II 級 13；緋櫻＋織女＋蜜腺 三個牌子 +2；機械接生體一處 +1；細工・五分咲超規 +3
    const a = checkAssembly(arm, { plate: ITEMS.it_b86505, act: ITEMS.it_3fe2b1, neuron: ITEMS.it_303b76 })
    expect(a.ok).toBe(true)
    expect(a.dc).toBe(13 + 2 + 1 + 3)
    expect(a.dcParts.map(p => p[0])).toEqual(['II 級', '牌子', '接面', '超規'])
    expect(a.legality).toBe('許可')
  })
  it('放錯的零件記在 bad，不算 ok', () => {
    const a = checkAssembly(arm, { plate: ITEMS.it_b86505, act: ITEMS.it_398b67, neuron: ITEMS.it_e7b262 })
    expect(a.ok).toBe(false)
    expect(a.bad.act).toBe('這個槽只收機械。')
  })
  it('成功率與誰來做', () => {
    expect(successChance(0, 10)).toBe(55)
    expect(successChance(-5, 25)).toBe(5)
    expect(successChance(30, 10)).toBe(95)
    const a = checkAssembly(arm, { plate: ITEMS.it_b86505, act: ITEMS.it_3fe2b1, neuron: ITEMS.it_303b76 })
    expect(crafterBlock(CRAFTERS.find(c => c.id === 'fengfeng')!, a)).toBe('縫縫診所不做超規。')
    expect(crafterBlock(CRAFTERS.find(c => c.id === 'doujin')!, a)).toBeNull()
  })
})
