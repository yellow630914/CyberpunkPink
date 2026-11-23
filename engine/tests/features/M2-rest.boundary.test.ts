// 邊界：休息（喘口氣、睡一覺）的數字。
// 規格：DOWNTIME 2.1（回 2 + mod(體格)，最少 1，兩次睡一覺之間只有前兩次）、2.2（16 小時；重傷限制：低於一半而且沒處理過最多回到一半）、2.3（回復率 10%／20%／25%／55%／60%）、
// 7.2（押金兩週、欠兩週換鎖）；CORE_RULES 4.1（生命值上限 20 + 體格 × 2）。
// 性質：任何體格、任何生命值、任何睡處，回的生命值都落在 0～（上限 − 現有）；重傷限制剛好在「一半」這條線上切換；沒處理過的人睡覺不會因為上限而掉血。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContentPack, ReportDraft } from '../../src'
import { ActionBlocked, attrMod, toMinutes } from '../../src'
import { billsFeature } from '../../src/features/bills'
import { characterFeature } from '../../src/features/character'
import { breathDraft, leaveDraft, readRest, rentDraft, restFeature, sleepDraft, sleepOptions } from '../../src/features/rest'
import { arrive, worldFeature } from '../../src/features/world'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

const MAP = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '住處' }, { id: 'F2', at: [3, 1], mark: 'F', name: '旅館' }, { id: 'F3', at: [5, 1], mark: 'F', name: '診所' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const pack = (rent = 100, extra: Record<string, unknown> = {}): ContentPack => ({
  id: 'rest_boundary',
  content: {
    special_map: [structuredClone(MAP)],
    facility_type: [
      { id: 'fac_home', name: '公寓' }, { id: 'fac_capsule', name: '膠囊旅館', sleep: { rate: 0.25, cost: 20 } }, { id: 'fac_clinic', name: '診所', sleep: { rate: 0.6, cost: 50 } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_hive'] }],
    block: [{ id: 'b_hive', district: 'd_hive', name: '四號塔', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_home', name: '單位' }, F2: { type: 'fac_capsule', name: '繭' }, F3: { type: 'fac_clinic', name: '診所' } } }],
    residence: [{ id: 'r_unit', name: '四號塔的單位', district: 'd_hive', block: 'b_hive', facility: 'F1', level: 1, rent }],
    ...extra,
  } as never,
})

function make(o: { body?: number; hp?: number; money?: { cred: number; cash: number }; rent?: number; extra?: Record<string, unknown> } = {}) {
  const { game } = makeGame({
    features: [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), characterFeature, worldFeature, billsFeature, restFeature],
    content: [METER_CONTENT, pack(o.rent ?? 100, o.extra)], seed: 7,
    pc: { hp: o.hp ?? 40, attrs: { body: o.body ?? 10 } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 1000, cash: 100 } },
  })
  return game
}
type G = ReturnType<typeof make>
const advance = (g: G, minutes: number) => g.commit({ kind: 'action', action: 'test.wait', location: { district: 'test' }, party: [], timeline: [], changes: [{ op: 'time', minutes }], outcome: { result: 'ok', summary: '等' } } satisfies ReportDraft)
/** 有效屬性值最多 24（CORE_RULES 第 1 節；核心的 EFFECTIVE_ATTR_MAX），體格 25 以上和 24 一樣 */
const eff = (body: number) => Math.min(24, body)
const maxHp = (body: number) => 20 + eff(body) * 2
const hpOf = (g: G) => g.state.actors.pc!.hp

describe('邊界 DOWNTIME 2.1：喘口氣回的生命值', () => {
  it('性質：任何體格（1～30）與生命值，前兩次回 max(1, 2 + mod(體格))，補不過上限；第三次起不回；睡過之後重新算', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), fc.double({ min: 0, max: 1, noNaN: true }), (body, frac) => {
        const max = maxHp(body)
        const hp = Math.max(1, Math.min(max, Math.floor(frac * max)))
        const g = make({ body, hp })
        const want = Math.max(1, 2 + attrMod(eff(body)))
        let cur = hp
        for (let i = 0; i < 2; i++) {
          g.commit(breathDraft(g.k, g.state))
          const next = Math.min(max, cur + want)
          expect(hpOf(g), `第 ${i + 1} 次`).toBe(next)
          expect(hpOf(g)).toBeLessThanOrEqual(max)
          cur = next
        }
        g.commit(breathDraft(g.k, g.state))
        expect(hpOf(g)).toBe(cur)
        expect(readRest(g.state).breaths).toBe(3)
      }),
      { numRuns: 60, seed: 11 },
    )
  })

  it('體格的兩端：1 和 30 照樣最少回 1；生命值已經是上限時回 0、不超過上限', () => {
    const weak = make({ body: 1, hp: 10 })
    weak.commit(breathDraft(weak.k, weak.state))
    expect(hpOf(weak)).toBe(11)
    const strong = make({ body: 30, hp: 10 })
    strong.commit(breathDraft(strong.k, strong.state))
    expect(hpOf(strong)).toBe(10 + 2 + attrMod(24))
    const full = make({ body: 30, hp: maxHp(30) })
    full.commit(breathDraft(full.k, full.state))
    expect(hpOf(full)).toBe(maxHp(30))
  })
})

describe('邊界 DOWNTIME 2.2、2.3：睡一覺的回復與重傷限制', () => {
  it('性質：露宿（10%）：任何體格與生命值，回的 = min(上限 − 現有, floor(上限 × 10%))，而且沒處理過、低於一半時不超過一半；絕不扣血、絕不超過上限', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 100 }), fc.boolean(), (body, pct, treated) => {
        const max = maxHp(body)
        const hp = Math.max(1, Math.round((max * pct) / 100))
        const g = make({ body, hp })
        if (treated) g.state.actors.pc!.conditions.push({ id: 'treated' })
        g.commit(sleepDraft(g.k, g.state, { spot: 'wild' }))
        const after = hpOf(g)
        expect(after).toBeGreaterThanOrEqual(hp)
        expect(after).toBeLessThanOrEqual(max)
        const plain = Math.min(max, hp + Math.floor(max * 0.1))
        const hurt = hp < max * 0.5 && !treated
        if (!hurt) expect(after).toBe(plain)
        else expect(after).toBe(plain > Math.ceil(max * 0.5) ? Math.max(hp, Math.ceil(max * 0.5)) : plain)
      }),
      { numRuns: 120, seed: 12 },
    )
  })

  it('重傷限制剛好在一半：生命 19／40 沒處理過，睡旅館最多回到 20；生命 20／40 不受限制；處理過的人 19／40 照回', () => {
    const run = (hp: number, treated: boolean) => {
      const g = make({ hp })
      if (treated) g.state.actors.pc!.conditions.push({ id: 'treated' })
      g.commit(arrive(g.k, g.state, 'b_hive', 'F2'))
      g.commit(sleepDraft(g.k, g.state))
      return hpOf(g)
    }
    expect(run(19, false)).toBe(20)
    expect(run(20, false)).toBe(30)
    expect(run(19, true)).toBe(29)
  })

  it('已經在一半以下又超過限制的人（例：舊傷、生命在上限一半之下，睡眠回復率 0）：不會被「回到一半」拉低', () => {
    // 回復率 0 的睡處：生命 5/40 睡完仍然 5（限制是「最多回到一半」，不是「回到一半」）
    const g = make({ hp: 5, extra: { rest_rule: [{ id: 'default', wild_rate: 0 }] } })
    g.commit(sleepDraft(g.k, g.state, { spot: 'wild' }))
    expect(hpOf(g)).toBe(5)
  })

  it('睡處的錢：剛好付得起可以、少 1 塊擋下（寫出原因）；帳戶不夠才扣現金；兩種都不夠的人還能露宿', () => {
    const exact = make({ money: { cred: 20, cash: 0 } })
    exact.commit(arrive(exact.k, exact.state, 'b_hive', 'F2'))
    exact.commit(sleepDraft(exact.k, exact.state))
    expect(exact.state.money).toEqual({ cred: 0, cash: 0 })
    const short = make({ money: { cred: 19, cash: 0 } })
    short.commit(arrive(short.k, short.state, 'b_hive', 'F2'))
    expect(() => sleepDraft(short.k, short.state)).toThrow(ActionBlocked)
    expect(sleepOptions(short.k, short.state).find((x) => x.id === 'wild')!.block).toBeNull()
    const split = make({ money: { cred: 19, cash: 20 } })
    split.commit(arrive(split.k, split.state, 'b_hive', 'F2'))
    split.commit(sleepDraft(split.k, split.state))
    expect(split.state.money).toEqual({ cred: 19, cash: 0 })
  })

  it('間隔：16 小時（960 分鐘）整點可以，少 1 分鐘不行；規則改成 0 小時就沒有間隔；改成 1000 小時（上限）也不溢位', () => {
    const g = make({ hp: 30 })
    g.commit(sleepDraft(g.k, g.state, { spot: 'wild' }))
    advance(g, 959)
    expect(() => sleepDraft(g.k, g.state, { spot: 'wild' })).toThrow(ActionBlocked)
    advance(g, 1)
    expect(() => sleepDraft(g.k, g.state, { spot: 'wild' })).not.toThrow()
    const free = make({ hp: 30, extra: { rest_rule: [{ id: 'default', sleep_gap_hours: 0 }] } })
    free.commit(sleepDraft(free.k, free.state, { spot: 'wild' }))
    expect(() => sleepDraft(free.k, free.state, { spot: 'wild' })).not.toThrow()
    const long = make({ hp: 30, extra: { rest_rule: [{ id: 'default', sleep_gap_hours: 1000 }] } })
    long.commit(sleepDraft(long.k, long.state, { spot: 'wild' }))
    advance(long, 1000 * 60 - 1)
    expect(() => sleepDraft(long.k, long.state, { spot: 'wild' })).toThrow(ActionBlocked)
    advance(long, 1)
    expect(() => sleepDraft(long.k, long.state, { spot: 'wild' })).not.toThrow()
  })
})

describe('邊界 DOWNTIME 7.2：押金與換鎖', () => {
  it('押金 = 週租 × 2：帳戶剛好夠可以、少 1 塊擋下；週租 0 的住處不收押金；退租退回同一種錢、同一個數字', () => {
    const ok = make({ rent: 100, money: { cred: 200, cash: 0 } })
    ok.commit(rentDraft(ok.k, ok.state, 'r_unit'))
    expect(ok.state.money.cred).toBe(0)
    expect(readRest(ok.state).home).toMatchObject({ id: 'r_unit', deposit: 200, pool: 'cred' })
    ok.commit(leaveDraft(ok.k, ok.state))
    expect(ok.state.money.cred).toBe(200)
    expect(readRest(ok.state).home).toBeNull()
    const poor = make({ rent: 100, money: { cred: 199, cash: 0 } })
    expect(() => rentDraft(poor.k, poor.state, 'r_unit')).toThrow(ActionBlocked)
    const free = make({ rent: 0, money: { cred: 0, cash: 0 } })
    free.commit(rentDraft(free.k, free.state, 'r_unit'))
    expect(readRest(free.state).home).toMatchObject({ deposit: 0 })
    expect(free.state.money).toEqual({ cred: 0, cash: 0 })
  })

  it('性質：任何週租（0～2000），押金 = 2 × 週租，付完的錢 + 押金 = 原本的錢；退租之後回到原本', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 5000 }), (rent, cred) => {
        const g = make({ rent, money: { cred, cash: 0 } })
        if (rent * 2 > cred) {
          expect(() => rentDraft(g.k, g.state, 'r_unit')).toThrow(ActionBlocked)
          return
        }
        g.commit(rentDraft(g.k, g.state, 'r_unit'))
        expect(g.state.money.cred).toBe(cred - rent * 2)
        g.commit(leaveDraft(g.k, g.state))
        expect(g.state.money.cred).toBe(cred)
      }),
      { numRuns: 80, seed: 13 },
    )
  })

  it('跨過每一個週一都收房租；欠兩週換鎖，付清開鎖（欠的週數歸零）；沒錢時鎖在第二個週一，不是第一個', () => {
    const g = make({ rent: 100, money: { cred: 200, cash: 0 } })
    g.commit(rentDraft(g.k, g.state, 'r_unit'))
    expect(g.state.money.cred).toBe(0)
    const monday = (n: number) => toMinutes({ day: 7 * n, hour: 6, minute: 0 })
    advance(g, monday(1) - toMinutes(g.state.time))
    expect(readRest(g.state).home).toMatchObject({ arrears: 1, locked: false })
    advance(g, monday(2) - toMinutes(g.state.time))
    expect(readRest(g.state).home).toMatchObject({ arrears: 2, locked: true })
    // 鎖著的時候睡不了自己的家
    g.commit(arrive(g.k, g.state, 'b_hive', 'F1'))
    expect(sleepOptions(g.k, g.state).find((x) => x.id === 'home')!.block).toContain('門鎖')
    g.state.money.cred = 1000
    advance(g, monday(3) - toMinutes(g.state.time))
    expect(readRest(g.state).home).toMatchObject({ arrears: 0, locked: false })
  })
})
