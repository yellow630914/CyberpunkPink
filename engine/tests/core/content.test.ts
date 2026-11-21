import { describe, expect, it } from 'vitest'
import { ContentError, ContentRegistry } from '../../src/core'

function registry(): ContentRegistry {
  const c = new ContentRegistry()
  c.defineKind({ kind: 'skill', owner: 'test', validate: (e) => (typeof e.name === 'string' ? [] : ['要有 name']) })
  c.defineKind({
    kind: 'perk', owner: 'test',
    validate: (e) => (Array.isArray(e.skills) ? [] : ['要有 skills']),
    refs: (e) => (e.skills as string[]).map((s) => ['skill', s]),
  })
  return c
}

// 規格：GAME_DESIGN 第 3 節第 13 條（格式錯誤一律擋下）；CODESCAN 2.1 節（覆蓋：快照 → 還原 → 套用）
describe('L2 內容登錄表', () => {
  it('載入、取用', () => {
    const c = registry()
    c.load('skill', [{ id: 'negotiate', name: '交涉' }, { id: 'stealth', name: '隱匿' }])
    expect(c.get('skill', 'negotiate')?.name).toBe('交涉')
    expect(c.list('skill')).toHaveLength(2)
    expect(c.has('skill', 'nope')).toBe(false)
    expect(() => c.require('skill', 'nope')).toThrow(/不存在/)
  })

  it('取出來的東西改了不影響登錄表裡的；載入之後改原本的物件也不影響', () => {
    const c = registry()
    const src = [{ id: 'negotiate', name: '交涉' }]
    c.load('skill', src)
    src[0]!.name = '改掉'
    expect(c.get('skill', 'negotiate')?.name).toBe('交涉')
  })

  it('格式錯誤整批不收：欄位不對、id 的格式、id 重複、沒有這個種類', () => {
    const c = registry()
    expect(() => c.load('skill', [{ id: 'a', name: 'A' }, { id: 'b' }])).toThrow(ContentError)
    expect(c.list('skill')).toHaveLength(0)
    expect(() => c.load('skill', [{ id: 'Bad Id', name: 'x' }])).toThrow(/小寫英文/)
    expect(() => c.load('skill', [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }])).toThrow(/重複/)
    expect(() => c.load('nope', [])).toThrow(/沒有這個內容種類/)
    expect(() => c.load('skill', { id: 'a' })).toThrow(/陣列/)
    c.load('skill', [{ id: 'a', name: 'A' }])
    expect(() => c.load('skill', [{ id: 'a', name: 'A2' }])).toThrow(/重複/)
    expect(() => c.defineKind({ kind: 'skill', owner: 'x', validate: () => [] })).toThrow(/重複註冊/)
  })

  it('引用檢查：引用不存在的東西會被找出來', () => {
    const c = registry()
    c.load('skill', [{ id: 'negotiate', name: '交涉' }])
    c.load('perk', [{ id: 'talker', skills: ['negotiate'] }, { id: 'ghost', skills: ['no_such'] }])
    expect(c.checkRefs()).toEqual(['perk/ghost：引用了不存在的 skill/no_such'])
  })

  it('世界包：有一個種類不合格，整包不收', () => {
    const c = registry()
    expect(() => c.loadPack({ id: 'p', content: { skill: [{ id: 'a', name: 'A' }], perk: [{ id: 'x' }] } })).toThrow(ContentError)
    expect(c.list('skill')).toHaveLength(0)
  })

  it('覆蓋：每次都從基底重新套；拿掉覆蓋就回到基底', () => {
    const c = registry()
    c.load('skill', [{ id: 'negotiate', name: '交涉' }, { id: 'stealth', name: '隱匿' }])
    c.applyOverlays([{ id: 'mod_a', content: { skill: { set: [{ id: 'negotiate', name: '談判' }, { id: 'new_one', name: '新的' }], remove: ['stealth'] } } }])
    expect(c.get('skill', 'negotiate')?.name).toBe('談判')
    expect(c.has('skill', 'stealth')).toBe(false)
    expect(c.has('skill', 'new_one')).toBe(true)
    c.applyOverlays([{ id: 'mod_b', content: { skill: { set: [{ id: 'other', name: '別的' }] } } }])
    expect(c.get('skill', 'negotiate')?.name).toBe('交涉')
    expect(c.has('skill', 'new_one')).toBe(false)
    expect(c.has('skill', 'other')).toBe(true)
    c.applyOverlays([])
    expect(c.list('skill').map((s) => s.id).sort()).toEqual(['negotiate', 'stealth'])
  })

  it('壞的覆蓋整組不套，內容回到基底', () => {
    const c = registry()
    c.load('skill', [{ id: 'negotiate', name: '交涉' }])
    c.load('perk', [{ id: 'talker', skills: ['negotiate'] }])
    // 拿掉被引用的東西：引用斷掉
    expect(() => c.applyOverlays([{ id: 'bad', content: { skill: { remove: ['negotiate'] } } }])).toThrow(/引用了不存在/)
    expect(c.has('skill', 'negotiate')).toBe(true)
    expect(() => c.applyOverlays([{ id: 'bad2', content: { skill: { set: [{ id: 'x' }] } } }])).toThrow(ContentError)
    expect(() => c.applyOverlays([{ id: 'bad3', content: { nope: { set: [] } } }])).toThrow(/沒有 nope/)
    expect(c.list('skill')).toHaveLength(1)
  })
})
