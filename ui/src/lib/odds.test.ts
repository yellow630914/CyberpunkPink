import { describe, expect, it } from 'vitest'
import { chance } from './odds'

describe('成功率（假系統的顯示）', () => {
  it('1d20 + 加值 ≥ DC，自然 1 一定失敗', () => {
    expect(chance(5, 14)).toBe(60)
    expect(chance(30, 14)).toBe(95)
  })
})
