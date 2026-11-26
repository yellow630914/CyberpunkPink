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

describe('條件的說明句（ConditionDef.describe、ConditionRegistry.explain；M4 收尾修正批）', () => {
  const k = createKernel()
  k.meters.define({ kind: 'favor', owner: 'test', name: '好感', min: 0, max: 100, start: 0, keyed: 'faction', cap: { down: 100, up: 100 } })
  k.content.loadPack({ id: 'explain_pack', content: { faction: [{ id: 'f_echo', name: '回音會', short: '回音', class: 'street' }] } } as never)
  const explain = (cond: Condition, patch: Record<string, unknown> = {}) => k.conditions.explain(cond, { state: makeState({ patch: patch as never }), stats: k.stats, timeRules: k.timeRules })

  it('成立的條件沒有原因（null）', () => {
    expect(explain({ kind: 'money', wallet: 'cash', max: 99999 })).toBeNull()
    expect(explain({ kind: 'flag', key: 'x' }, { flags: { x: true } })).toBeNull()
  })

  it('量表的條件：「回音的好感要在 20 以上」（對象查得到名字用名字、查不到用 id；不分對象的量表不寫對象）', () => {
    expect(explain({ kind: 'favor', key: 'f_echo', min: 20 })).toBe('回音的好感要在 20 以上')
    expect(explain({ kind: 'favor', key: 'f_nobody', min: 20 })).toBe('f_nobody的好感要在 20 以上')
    expect(explain({ kind: 'favor', key: 'f_echo', min: 30, max: 60 }, {})).toBe('回音的好感要在 30 到 60 之間')
  })

  it('核心的條件：屬性、基本功、錢、旗標、計數器、物品', () => {
    expect(explain({ kind: 'money', wallet: 'cash', min: 5000 })).toBe('現金要在 5000 以上')
    expect(explain({ kind: 'money', wallet: 'total', min: 10 ** 9 })).toBe('帳戶加現金要在 1000000000 以上')
    expect(explain({ kind: 'flag', key: 'met_ayin' })).toBe('還沒有發生過「met_ayin」那件事')
    expect(explain({ kind: 'counter', key: 'sleeps', min: 4 })).toBe('「sleeps」的次數要在 4 以上')
    expect(explain({ kind: 'has_item', id: 'it_nothing', min: 3 })).toBe('要有 3 件it_nothing')
    expect(explain({ kind: 'attr', attr: 'body', min: 99 })).toMatch(/要在 99 以上$/)
    expect(explain({ kind: 'skill', skill: 'negotiate', min: 5 })).toMatch(/要在 5 以上$/)
  })

  it('all 取第一個不成立的那一條；any 都不成立時把每一條接起來（「，或」）；not 與沒有說明的種類是 null', () => {
    const ok: Condition = { kind: 'money', wallet: 'cash', max: 10 ** 9 }
    expect(explain({ kind: 'all', of: [ok, { kind: 'favor', key: 'f_echo', min: 20 }, { kind: 'money', wallet: 'cash', min: 10 ** 8 }] })).toBe('回音的好感要在 20 以上')
    expect(explain({ kind: 'any', of: [{ kind: 'favor', key: 'f_echo', min: 20 }, { kind: 'flag', key: 'x' }] })).toBe('回音的好感要在 20 以上，或還沒有發生過「x」那件事')
    // any 其中一條成立就整個成立
    expect(explain({ kind: 'any', of: [{ kind: 'favor', key: 'f_echo', min: 20 }, ok] })).toBeNull()
    expect(explain({ kind: 'not', of: ok })).toBeNull()
    expect(explain({ kind: 'time', segment: ['dawn'] }, { time: { day: 2, hour: 12, minute: 0 } })).toBeNull()
  })
})
