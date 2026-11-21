import { describe, it, expect } from 'vitest'
import { budgetUse, budgetOf, lineDiff, loreChanges, LORE_DEFAULTS, BUDGET_DEFAULTS, type LoreEntry } from './lorebook'

describe('世界書的字數預算（PROMPTS 9.6 節）', () => {
  it('依注入方式算在不同的預算；停用的不算', () => {
    const by = (uid: string) => budgetOf(LORE_DEFAULTS.find(e => e.uid === uid)!)
    expect(by('wb_city')).toBe('city')
    expect(by('wb_hive')).toBe('place')
    expect(by('wb_monroe')).toBe('keyword')
    expect(by('wb_adult_base')).toBe('adult')
    expect(budgetOf({ ...LORE_DEFAULTS[0], mode: 'off' })).toBeNull()
  })
  it('依 order 保留前面的，超出的標「超出預算」；成人常駐不算在合計裡', () => {
    const long = (uid: string, order: number): LoreEntry => ({ uid, comment: uid, key: ['x'], content: 'x'.repeat(3000), order, mode: 'keyword' })
    const r = budgetUse([long('a', 1), long('b', 2)], BUDGET_DEFAULTS)
    expect(r.state.a).toBe('送')
    expect(r.state.b).toBe('超出預算')
    expect(r.used.keyword).toBe(3000)
    const r2 = budgetUse(LORE_DEFAULTS, BUDGET_DEFAULTS)
    expect(r2.used.total).toBe(LORE_DEFAULTS.filter(e => !e.adult).reduce((s, e) => s + e.content.length, 0))
  })
})

describe('和預設比較', () => {
  it('逐行差異', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: ' ', text: 'c' }, { op: '+', text: 'd' }])
    expect(lineDiff('', 'x')).toEqual([{ op: '+', text: 'x' }])
  })
  it('世界書條目：新增、刪除、改過', () => {
    const cur = structuredClone(LORE_DEFAULTS).filter(e => e.uid !== 'wb_lace')
    cur[0].mode = 'off'
    cur.push({ uid: 'wb_new', comment: '新的', key: [], content: '…', order: 99, mode: 'keyword' })
    const ch = loreChanges(cur)
    expect(ch.find(c => c.uid === 'wb_new')?.kind).toBe('新增')
    expect(ch.find(c => c.uid === 'wb_lace')?.kind).toBe('刪除')
    expect(ch.find(c => c.uid === cur[0].uid)?.fields).toEqual(['mode'])
  })
})
