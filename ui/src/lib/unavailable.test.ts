import { describe, it, expect } from 'vitest'
import { unavailable } from './unavailable'

describe('做不到的灰掉', () => {
  it('有原因：灰掉、aria-disabled、title 是原因', () => {
    expect(unavailable('錢不夠。')).toEqual({ class: 'is-unavailable', 'aria-disabled': 'true', title: '錢不夠。' })
  })
  it('沒有原因：什麼都不加', () => {
    expect(unavailable(null)).toEqual({})
    expect(unavailable('')).toEqual({})
    expect(unavailable(false)).toEqual({})
  })
})
