import { describe, it, expect } from 'vitest'
import { defaultOption, pressE, type HereOption } from './here'

const mk = (id: string, extra: Partial<HereOption> = {}, log: string[] = []): HereOption => ({ id, name: id, run: () => log.push(id), ...extra })

describe('到了看得到選單、E 才做', () => {
  it('出口優先於預設', () => {
    expect(defaultOption([mk('a', { auto: true }), mk('x', { exit: true })])!.id).toBe('x')
  })
  it('沒有出口時做標成預設的，沒有標就是第一個', () => {
    expect(defaultOption([mk('a'), mk('b', { auto: true })])!.id).toBe('b')
    expect(defaultOption([mk('a'), mk('b')])!.id).toBe('a')
    expect(defaultOption([])).toBeNull()
  })
  it('E 只做預設的那一個；做不到時回傳原因', () => {
    const log: string[] = []
    expect(pressE([mk('a', {}, log), mk('b', { auto: true }, log)])).toBeNull()
    expect(log).toEqual(['b'])
    expect(pressE([mk('a', { auto: true, reason: '已經翻過了。' }, log)])).toBe('已經翻過了。')
    expect(log).toEqual(['b'])
    expect(pressE([])).toBe('腳下沒有可以互動的東西。')
  })
})
