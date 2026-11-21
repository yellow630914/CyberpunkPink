import { describe, it, expect } from 'vitest'
import { SCHEMA_SAMPLES, blankEntry } from './schemas'
import { checkWorld, planImport, type WorldEntry } from './worldCheck'
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

describe('第三版的種類照欄位表檢查', () => {
  it('樣本都過得了檢查', () => {
    const iss = checkWorld(SCHEMA_SAMPLES as WorldEntry[])
    expect(iss.filter(i => i.blocking)).toEqual([])
  })
  it('必填、整數、範圍與選項', () => {
    const bad = [
      { id: 'pr_x', kind: 'opponent', name: '壞對手', strength: 5 },
      { id: 'en_x', kind: 'lace', name: '壞蕾絲', grade: 1.5, rank: 'king', load_max: 22 },
      { id: 'g_x', kind: 'guide', name: 'x', title: '', trigger: 't', pages: [] },
    ] as WorldEntry[]
    const iss = checkWorld(bad).filter(i => i.code === 'FIELD')
    expect(iss.find(i => i.id === 'pr_x' && i.where === 'strength')?.text).toContain('不能大於 3')
    expect(iss.find(i => i.id === 'en_x' && i.where === 'grade')?.text).toContain('整數')
    expect(iss.find(i => i.id === 'en_x' && i.where === 'rank')).toBeTruthy()
    expect(iss.filter(i => i.id === 'g_x').map(i => i.where).sort()).toEqual(['pages', 'title'])
  })
  it('新的一筆先填好必填與預設值', () => {
    const e = blankEntry('lace', 'en_new')
    expect(e).toMatchObject({ id: 'en_new', kind: 'lace', rank: 'mook', load_max: 22 })
  })
})
