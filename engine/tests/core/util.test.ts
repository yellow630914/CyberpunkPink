import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { SegmentId } from '../../src/core'
import {
  DEFAULT_TIME_RULES, Rng, SEGMENT_IDS, addHours, addMinutes, bool, clamp, clone, daysUntilWeekday, deepEqual, deriveRng, diffPaths, formatAmount, formatDuration, formatMoney, formatTime, fromMinutes, hash32, int, isId, isValidTime,
  minutesToNextSegment, num, oneOf, roll, segmentDayOf, segmentOf, segmentWeekdayOf, str, toMinutes, weekdayOf,
} from '../../src/core'

describe('L1 亂數', () => {
  it('同一個種子得到同一串數字', () => {
    const a = new Rng(42), b = new Rng(42)
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()))
  })

  it('int 含兩端、不出界', () => {
    fc.assert(fc.property(fc.integer(), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }), (seed, min, span) => {
      const v = new Rng(seed).int(min, min + span)
      return v >= min && v <= min + span && Number.isInteger(v)
    }))
  })

  it('1d20 每一面都擲得出來', () => {
    const rng = new Rng(1)
    const seen = new Set(Array.from({ length: 2000 }, () => rng.int(1, 20)))
    expect(seen.size).toBe(20)
  })

  it('roll 解析骰式，壞的骰式丟錯', () => {
    const r = roll(new Rng(3), '2d6+3')
    expect(r.rolls).toHaveLength(2)
    expect(r.total).toBe(r.rolls[0]! + r.rolls[1]! + 3)
    expect(roll(new Rng(3), 'd8').rolls).toHaveLength(1)
    expect(() => roll(new Rng(3), '2x6')).toThrow()
    expect(() => roll(new Rng(3), '1d0')).toThrow()
  })

  it('pick 與 weighted：空的丟錯，權重 0 的抽不到', () => {
    expect(() => new Rng(1).pick([])).toThrow()
    const rng = new Rng(5)
    for (let i = 0; i < 200; i++) expect(rng.weighted(['a', 'b', 'c'], (x) => (x === 'b' ? 0 : 1))).not.toBe('b')
    expect(() => rng.weighted(['a'], () => 0)).toThrow()
  })

  it('deriveRng：同樣的（種子、游標、用途、重擲次數）同一顆骰；任何一項不同就是另一顆', () => {
    const base = { seed: 7, cursor: 3 }
    const seq = (r: Rng) => Array.from({ length: 8 }, () => r.int(1, 20)).join(',')
    const a = seq(deriveRng(base, 'x'))
    expect(seq(deriveRng({ ...base }, 'x'))).toBe(a)
    expect(seq(deriveRng(base, 'y'))).not.toBe(a)
    expect(seq(deriveRng(base, 'x', 1))).not.toBe(a)
    expect(seq(deriveRng({ seed: 7, cursor: 4 }, 'x'))).not.toBe(a)
    expect(seq(deriveRng({ seed: 8, cursor: 3 }, 'x'))).not.toBe(a)
  })

  it('hash32 分得出字串與數字、分得出切法', () => {
    expect(hash32('1')).not.toBe(hash32(1))
    expect(hash32('ab', 'c')).not.toBe(hash32('a', 'bc'))
  })
})

describe('L1 時間', () => {
  const time = fc.record({ day: fc.integer({ min: 1, max: 5000 }), hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }) })

  it('換算來回一致', () => {
    fc.assert(fc.property(time, (t) => deepEqual(fromMinutes(toMinutes(t)), t)))
  })

  it('時間只往前走：加負數不動；加多少分鐘就差多少', () => {
    fc.assert(fc.property(time, fc.integer({ min: -1000, max: 100000 }), (t, m) => toMinutes(addMinutes(t, m)) - toMinutes(t) === Math.max(0, m)))
  })

  it('跨日與格式', () => {
    expect(addHours({ day: 1, hour: 23, minute: 30 }, 1)).toEqual({ day: 2, hour: 0, minute: 30 })
    expect(formatTime({ day: 14, hour: 7, minute: 5 })).toBe('第 14 天 07:05')
    expect(isValidTime({ day: 1, hour: 24, minute: 0 })).toBe(false)
    expect(isValidTime({ day: 0, hour: 1, minute: 0 })).toBe(false)
  })

  it('一天六個時段，各 4 小時，從清晨 3 點起算（CORE_RULES 7.4 節）', () => {
    const ids = Array.from({ length: 24 }, (_, h) => segmentOf({ day: 1, hour: h, minute: 0 }))
    expect(new Set(ids).size).toBe(6)
    for (const id of new Set(ids)) expect(ids.filter((x) => x === id)).toHaveLength(4)
    expect(DEFAULT_TIME_RULES).toEqual({ dawnHour: 3, mondayRemainder: 0 })
    // 清晨 3～7、上午 7～11、中午 11～15、下午 15～19、黃金時段 19～23、深夜 23～3：每一段的第一分鐘與最後一分鐘
    const TABLE: Array<[SegmentId, number, number]> = [['dawn', 3, 7], ['morning', 7, 11], ['noon', 11, 15], ['afternoon', 15, 19], ['prime', 19, 23], ['late', 23, 3]]
    expect(TABLE.map(([id]) => id)).toEqual([...SEGMENT_IDS])
    for (const [id, from, to] of TABLE) {
      expect(segmentOf({ day: 1, hour: from, minute: 0 }), `${id} 開始`).toBe(id)
      expect(segmentOf({ day: 1, hour: (to + 23) % 24, minute: 59 }), `${id} 結束前`).toBe(id)
      expect(segmentOf({ day: 1, hour: to, minute: 0 }), `${id} 結束`).not.toBe(id)
    }
    expect(segmentOf({ day: 1, hour: 2, minute: 59 })).toBe('late')
    expect(segmentOf({ day: 1, hour: 0, minute: 0 })).toBe('late')
    expect(minutesToNextSegment({ day: 1, hour: 3, minute: 0 })).toBe(240)
    expect(minutesToNextSegment({ day: 1, hour: 6, minute: 59 })).toBe(1)
    expect(minutesToNextSegment({ day: 1, hour: 23, minute: 0 })).toBe(240)
    expect(minutesToNextSegment({ day: 2, hour: 2, minute: 30 })).toBe(30)
  })

  it('深夜跨過午夜，午夜到清晨之前算前一天的最後一段：segmentDayOf、segmentWeekdayOf', () => {
    expect(segmentDayOf({ day: 6, hour: 23, minute: 0 })).toBe(6)
    expect(segmentDayOf({ day: 7, hour: 0, minute: 0 })).toBe(6)
    expect(segmentDayOf({ day: 7, hour: 2, minute: 59 })).toBe(6)
    expect(segmentDayOf({ day: 7, hour: 3, minute: 0 })).toBe(7)
    // 第 7 天是週一：週一的深夜到第 8 天凌晨 3 點之前都算週一；日曆的星期在午夜換
    expect(segmentWeekdayOf({ day: 7, hour: 23, minute: 30 })).toBe(0)
    expect(segmentWeekdayOf({ day: 8, hour: 1, minute: 0 })).toBe(0)
    expect(weekdayOf({ day: 8, hour: 1, minute: 0 })).toBe(1)
    expect(segmentWeekdayOf({ day: 8, hour: 3, minute: 0 })).toBe(1)
    expect(segmentWeekdayOf({ day: 7, hour: 1, minute: 0 })).toBe(6)
    fc.assert(fc.property(time, (t) => (t.hour >= 3 ? segmentWeekdayOf(t) === weekdayOf(t) : segmentWeekdayOf(t) === weekdayOf({ ...t, day: t.day + 6 }))))
  })

  it('星期每七天一輪；第 1 天是週二，第 7、14、21 天是週一（收租日）；和時段從幾點起算無關', () => {
    expect(weekdayOf({ day: 1, hour: 8, minute: 0 })).toBe(1)
    for (const day of [7, 14, 21, 700]) expect(weekdayOf({ day, hour: 0, minute: 0 }), `第 ${day} 天`).toBe(0)
    expect(weekdayOf({ day: 15, hour: 0, minute: 0 })).toBe(1)
    expect(weekdayOf({ day: 6, hour: 23, minute: 59 })).toBe(6)
    fc.assert(fc.property(time, (t) => weekdayOf(t) === weekdayOf({ ...t, day: t.day + 7 })))
    // 日曆的星期不看 dawnHour：改了時段的起點，週一還是那幾天
    fc.assert(fc.property(time, fc.integer({ min: 0, max: 23 }), (t, dawnHour) => weekdayOf(t, { dawnHour, mondayRemainder: 0 }) === weekdayOf(t)))
    expect(daysUntilWeekday({ day: 7, hour: 9, minute: 0 }, 0)).toBe(0)
    expect(daysUntilWeekday({ day: 1, hour: 9, minute: 0 }, 0)).toBe(6)
    expect(daysUntilWeekday({ day: 8, hour: 0, minute: 0 }, 0)).toBe(6)
    expect(daysUntilWeekday({ day: 13, hour: 23, minute: 59 }, 0)).toBe(1)
  })

  it('一段時間的白話照實寫：分鐘、整數小時、小時加分鐘（B002）', () => {
    expect(formatDuration(0)).toBe('0 分鐘')
    expect(formatDuration(20)).toBe('20 分鐘')
    expect(formatDuration(30)).toBe('30 分鐘')
    expect(formatDuration(60)).toBe('1 小時')
    expect(formatDuration(90)).toBe('1 小時 30 分鐘')
    expect(formatDuration(240)).toBe('4 小時')
    expect(formatDuration(481)).toBe('8 小時 1 分鐘')
    fc.assert(fc.property(fc.nat({ max: 100000 }), (m) => {
      const text = formatDuration(m)
      const said = Number(/(\d+) 小時/.exec(text)?.[1] ?? 0) * 60 + Number(/(\d+) 分鐘/.exec(text)?.[1] ?? 0)
      return said === m
    }))
  })
})

describe('L1 錢與清理', () => {
  it('錢的格式', () => {
    expect(formatAmount(1234567)).toBe('1,234,567')
    expect(formatAmount(-1500)).toBe('-1,500')
    expect(formatMoney(1500)).toBe('C$1,500')
  })

  it('清理函式', () => {
    expect(num('12')).toBe(12)
    expect(num('abc', 3)).toBe(3)
    expect(num(Number.NaN, 1)).toBe(1)
    expect(num(Infinity, 1)).toBe(1)
    expect(int(2.6)).toBe(3)
    expect(str('  hi  ')).toBe('hi')
    expect(str(5, 10, 'x')).toBe('x')
    expect(str('abcdef', 3)).toBe('abc')
    expect(bool(1)).toBe(true)
    expect(bool('yes', true)).toBe(true)
    expect(oneOf('b', ['a', 'b'] as const, 'a')).toBe('b')
    expect(oneOf('z', ['a', 'b'] as const, 'a')).toBe('a')
    expect(clamp(5, 0, 3)).toBe(3)
    expect(isId('sk_fire_1')).toBe(true)
    expect(isId('Bad Id')).toBe(false)
  })

  it('clone、deepEqual、diffPaths', () => {
    const a = { x: 1, y: { z: [1, 2, { w: 3 }] } }
    const b = clone(a)
    expect(b).toEqual(a)
    expect(b.y).not.toBe(a.y)
    expect(deepEqual(a, b)).toBe(true)
    b.y.z[2] = { w: 4 }
    expect(deepEqual(a, b)).toBe(false)
    expect(diffPaths(a, b)).toEqual(['y.z.2.w'])
    expect(deepEqual({ a: undefined, b: 1 }, { b: 1 })).toBe(true)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
  })
})
