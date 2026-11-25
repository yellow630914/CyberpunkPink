import { describe, it, expect } from 'vitest'
import { LOOK_GROUPS, BUILD_FIGURE } from './creation'

const field = (k: string) => LOOK_GROUPS.flatMap(g => g.fields).find(f => f.k === k)!

describe('建角外觀選項', () => {
  it('每一格的選項不重複、不是空的', () => {
    for (const f of LOOK_GROUPS.flatMap(g => g.fields)) {
      expect(f.opts.length, f.k).toBeGreaterThan(1)
      expect(new Set(f.opts).size, f.k).toBe(f.opts.length)
    }
  })
  it('新增的格子都在：唇、聲音、腳（腳在腿之後）', () => {
    const detail = LOOK_GROUPS.find(g => g.id === 'detail')!.fields.map(f => f.k)
    expect(detail.indexOf('feet')).toBe(detail.indexOf('legs') + 1)
    for (const k of ['lips', 'voice', 'feet']) expect(field(k).opts.length).toBeGreaterThanOrEqual(6)
    for (const k of ['hips', 'legs', 'hands']) expect(field(k).opts.length).toBe(8)
  })
  it('髮型分短、中長、長三組，各至少 8 個，opts 是攤平的結果', () => {
    const h = field('hair')
    expect(h.groups!.map(g => g.group)).toEqual(['短髮', '中長髮', '長髮'])
    for (const g of h.groups!) expect(g.items.length).toBeGreaterThanOrEqual(8)
    expect(h.opts).toEqual(h.groups!.flatMap(g => g.items))
    for (const w of ['莫霍克', '狼尾', '公主切', '丸子頭', '半紮（半丸子）', '側剃（一邊剃到頭皮）']) expect(h.opts.some(o => o.includes(w)), w).toBe(true)
  })
  it('髮色有漸層、雙色與街頭色；眼色拆開了「淺色」', () => {
    const c = field('hairColor').opts
    expect(c.some(o => o.startsWith('漸層'))).toBe(true)
    expect(c.some(o => o.startsWith('雙色'))).toBe(true)
    for (const w of ['螢光綠', '白金', '紫紅']) expect(c).toContain(w)
    const e = field('eyes').opts
    expect(e).not.toContain('淺色')
    for (const w of ['琥珀', '灰綠', '淺藍']) expect(e).toContain(w)
  })
  it('體型六種，每一種都對得到身材帶', () => {
    const b = field('build').opts
    expect(b).toHaveLength(6)
    const bands = field('figure').opts
    for (const o of b) expect(bands).toContain(BUILD_FIGURE[o])
  })
  it('詞庫不收幼態的字', () => {
    const bad = /幼|稚|蘿|童|少女|未成年|學生/
    for (const f of LOOK_GROUPS.flatMap(g => g.fields)) for (const o of f.opts) expect(bad.test(o), o).toBe(false)
  })
})
