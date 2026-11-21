import { describe, it, expect } from 'vitest'
import { checkWorld, planImport } from './worldCheck'
import { START_ENTRIES, BUILTIN } from '../data/editor'

describe('世界編輯器的檢查：只擋格式錯誤與內容的底線', () => {
  const issues = checkWorld(START_ENTRIES, BUILTIN)
  it('樣本世界包的四個格式錯誤', () => {
    const fmt = issues.filter(i => i.blocking && ['FIELD', 'DUP', 'REF'].includes(i.code)).map(i => i.code).sort()
    expect(fmt).toEqual(['DUP', 'FIELD', 'REF', 'REF'])
  })
  it('年齡低於 18 擋下', () => { expect(issues.find(i => i.code === 'AGE')?.id).toBe('npc_dock_runner') })
  it('兩個提醒不擋', () => { expect(issues.filter(i => !i.blocking).map(i => i.id).sort()).toEqual(['dock_union', 's:ledger:raid_failed']) })
  it('不寫懷孕、不寫血腥', () => {
    const r = checkWorld([{ id: 'ev_x', kind: 'event', name: 'x', text: '她懷孕了', options: [{ text: '走' }] }])
    expect(r.some(i => i.code === 'FLOOR')).toBe(true)
  })
  it('數值多大都不擋', () => {
    expect(checkWorld([{ id: 'it_big', kind: 'item', name: '很強的槍', grade: 5, damage: 999999 }])).toEqual([])
  })
  it('匯入：引用壞掉的先不載入，其餘照常', () => {
    const plan = planImport([
      { id: 'ev_ok', kind: 'event', name: '好的', text: 't', options: [{ text: 'a' }] },
      { id: 'ev_bad', kind: 'event', name: '壞的', text: 't', options: [{ text: 'a', success: { item: 'nope' } }] },
      { id: 'en_dock_guard', kind: 'enemy', name: '撞名', grade: 1 },
    ], START_ENTRIES, BUILTIN)
    expect(plan.load.map(e => e.id)).toEqual(['ev_ok', 'en_dock_guard'])
    expect(plan.skipped).toBe(1)
    expect(plan.clashes).toEqual(['en_dock_guard'])
  })
})
