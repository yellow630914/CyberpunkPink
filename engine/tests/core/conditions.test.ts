// L4 條件：時間的條件照時段算（CORE_RULES 7.4 節：深夜跨過午夜，算前一天的最後一段）。規格：EVENTS 2.1、2.2 節。

import { describe, expect, it } from 'vitest'
import type { Condition, GameTime } from '../../src/core'
import { createKernel } from '../../src/core'
import { makeState } from '../../src/testkit'

describe('L4 條件：時段與星期', () => {
  const k = createKernel()
  const at = (cond: Condition, time: GameTime) => k.conditions.test(cond, { state: makeState({ patch: { time } }), stats: k.stats, timeRules: k.timeRules })

  it('時段的邊界：清晨 3～7、上午 7～11、中午 11～15、下午 15～19、黃金時段 19～23、深夜 23～3', () => {
    const table: Array<[string, number, number]> = [['dawn', 3, 6], ['morning', 7, 10], ['noon', 11, 14], ['afternoon', 15, 18], ['prime', 19, 22], ['late', 23, 2]]
    for (const [segment, first, last] of table) {
      expect(at({ kind: 'time', segment: [segment] }, { day: 2, hour: first, minute: 0 }), `${segment} ${first}:00`).toBe(true)
      expect(at({ kind: 'time', segment: [segment] }, { day: 2, hour: last, minute: 59 }), `${segment} ${last}:59`).toBe(true)
      expect(at({ kind: 'time', segment: [segment] }, { day: 2, hour: (last + 1) % 24, minute: 0 }), `${segment} 之後`).toBe(false)
    }
  })

  it('「週四深夜」（第 3 天是週四）：從週四 23:00 到週五凌晨 2:59 都成立；週四凌晨（那是週三的深夜）不成立', () => {
    const thursdayLate: Condition = { kind: 'time', weekday: [3], segment: ['late'] }
    expect(at(thursdayLate, { day: 3, hour: 23, minute: 0 })).toBe(true)
    expect(at(thursdayLate, { day: 4, hour: 0, minute: 30 })).toBe(true)
    expect(at(thursdayLate, { day: 4, hour: 2, minute: 59 })).toBe(true)
    expect(at(thursdayLate, { day: 4, hour: 3, minute: 0 })).toBe(false)
    expect(at(thursdayLate, { day: 3, hour: 1, minute: 0 })).toBe(false)
    expect(at(thursdayLate, { day: 3, hour: 22, minute: 59 })).toBe(false)
    // 只寫星期：凌晨 3 點之前還算前一天
    expect(at({ kind: 'time', weekday: [0] }, { day: 7, hour: 3, minute: 0 })).toBe(true)
    expect(at({ kind: 'time', weekday: [0] }, { day: 7, hour: 2, minute: 59 })).toBe(false)
    expect(at({ kind: 'time', weekday: [0] }, { day: 8, hour: 2, minute: 59 })).toBe(true)
    // min_day 看日曆的天數
    expect(at({ kind: 'time', min_day: 8 }, { day: 8, hour: 0, minute: 0 })).toBe(true)
  })

  it('時段的起點跟著這一局的規則走（kernel.timeRules）', () => {
    const k2 = createKernel()
    k2.timeRules.dawnHour = 6
    const test = (cond: Condition, time: GameTime) => k2.conditions.test(cond, { state: makeState({ patch: { time } }), stats: k2.stats, timeRules: k2.timeRules })
    expect(test({ kind: 'time', segment: ['late'] }, { day: 2, hour: 5, minute: 0 })).toBe(true)
    expect(test({ kind: 'time', segment: ['dawn'] }, { day: 2, hour: 6, minute: 0 })).toBe(true)
  })
})
