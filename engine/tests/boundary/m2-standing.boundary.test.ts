// 邊界測試：勢力的好感與敵對值（FACTIONS 第 5、6 節），以及它們對委託的後果（FACTIONS 6.1；dev/adr/0017 M2 修正批 7）、名冊的出場費分段（NPC_SYSTEM 10.4）。
// cpp-tester-boundary 寫的；邊界表在這份測試的回報裡。
//
// 每一個數值都測：下限、下限−1、上限、上限+1、零、空、最大組合；分段的每一個門檻與門檻−1。
// 內容用測試自帶的最小假資料（兩個勢力：收錢的、不收錢的；一個區），委託的那一段用 testkit 的委託情境（TEST_WORLD）。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { Change, ContentPack, Feature, ReportDraft } from '../../src'
import { meterOf } from '../../src'
import {
  DEFAULT_SECURITY_RULES, FAVOR_TIERS, HOSTILITY_TIERS, bribe, bribeBlock, bribeUnit, favorTierOf, hostilityTierOf, securityFeature,
} from '../../src/features/security'
import { readRun } from '../../src/features/commission'
import { go, jobOf } from '../../src/features/fixer'
import { feeOf, join } from '../../src/features/roster'
import { makeCommissionGame, makeGame, makeRunner, makeWorldGame, RUNNER } from '../../src/testkit'

// ---- 假資料 ----

const PACK: ContentPack = {
  id: 'standing_boundary',
  content: {
    faction: [
      { id: 'f_bs_pay', name: '收錢的公司', short: '收錢', class: 'corp', bribe: true },
      { id: 'f_bs_proud', name: '不收錢的幫', short: '不收錢', class: 'street', bribe: false },
    ],
    district: [{ id: 'bs_d', name: '測試區' }],
  } as unknown as ContentPack['content'],
}
const DISTRICT_KIND: Feature = { id: 'test_districts', install: (k) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }

/** 第 3 天（星期四）上午 10:00；第 7 天是第一個週一。 */
const make = (cash = 1_000_000) =>
  makeGame({ features: [DISTRICT_KIND, securityFeature], content: [PACK], seed: 7, patch: { money: { cred: 0, cash }, time: { day: 3, hour: 10, minute: 0 } } }).game
type G = ReturnType<typeof make>

const draft = (changes: Change[], action = 'event.test'): ReportDraft => ({ kind: 'event', action, location: { district: 'bs_d' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const put = (g: G, kind: string, key: string, v: number) => { g.state.meters[kind] = { ...g.state.meters[kind], [key]: v } }
const h = (g: G, f = 'f_bs_pay') => meterOf(g.k, g.state, 'hostility', f)
const minutesTo = (g: G, day: number, hour: number) => (day - g.state.time.day) * 1440 + (hour - g.state.time.hour) * 60 - g.state.time.minute

// ===================================================================================================================

describe('邊界 FACTIONS 6.1、5.1：分段', () => {
  const hostilityTier = (v: number) => (v >= 100 ? 5 : v >= 80 ? 4 : v >= 60 ? 3 : v >= 40 ? 2 : v >= 20 ? 1 : 0)
  const favorTier = (v: number) => (v >= 80 ? 4 : v >= 60 ? 3 : v >= 40 ? 2 : v >= 20 ? 1 : 0)

  it('敵對值：每個門檻與門檻−1（19/20、39/40、59/60、79/80、99/100）落在對的段；0 是沒注意、100 是通緝', () => {
    const want: Array<[number, string]> = [[0, 'unnoticed'], [19, 'unnoticed'], [20, 'recorded'], [39, 'recorded'], [40, 'trouble'], [59, 'trouble'], [60, 'pursuit'], [79, 'pursuit'], [80, 'bounty'], [99, 'bounty'], [100, 'wanted']]
    for (const [v, id] of want) expect(hostilityTierOf(DEFAULT_SECURITY_RULES, v).id, `敵對值 ${v}`).toBe(id)
  })

  it('好感：19/20、39/40、59/60、79/80；0 是外人、100 是自己人', () => {
    const want: Array<[number, string]> = [[0, 'stranger'], [19, 'stranger'], [20, 'known'], [39, 'known'], [40, 'friendly'], [59, 'friendly'], [60, 'trusted'], [79, 'trusted'], [80, 'kin'], [100, 'kin']]
    for (const [v, id] of want) expect(favorTierOf(DEFAULT_SECURITY_RULES, v).id, `好感 ${v}`).toBe(id)
  })

  it('性質：0～100 的每一個值落在照表算的那一段；段的 min 不比值大；量表外的值（−1、101）提交之後夾回 0、100', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (v) => {
      const a = hostilityTierOf(DEFAULT_SECURITY_RULES, v)
      const b = favorTierOf(DEFAULT_SECURITY_RULES, v)
      return a.index === hostilityTier(v) && a.id === HOSTILITY_TIERS[a.index]!.id && a.min <= v && b.index === favorTier(v) && b.id === FAVOR_TIERS[b.index]!.id && b.min <= v
    }), { numRuns: 101 })
    const g = make()
    g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_bs_pay', set: 101 }, { op: 'meter', kind: 'favor', key: 'f_bs_pay', set: -1 }]))
    expect([h(g), meterOf(g.k, g.state, 'favor', 'f_bs_pay')]).toEqual([100, 0])
    g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_bs_pay', delta: -1_000_000 }, { op: 'meter', kind: 'favor', key: 'f_bs_pay', delta: Number.MAX_SAFE_INTEGER }]))
    expect([h(g), meterOf(g.k, g.state, 'favor', 'f_bs_pay')]).toEqual([0, 100])
  })

  it('條件 hostility_tier：剛好到門檻成立、門檻−1 不成立（每一段）', () => {
    const g = make()
    const test = (min: string) => g.k.conditions.test({ kind: 'hostility_tier', faction: 'f_bs_pay', min } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    for (const [id, at] of [['recorded', 20], ['trouble', 40], ['pursuit', 60], ['bounty', 80], ['wanted', 100]] as const) {
      put(g, 'hostility', 'f_bs_pay', at - 1)
      expect(test(id), `${id} 在 ${at - 1}`).toBe(false)
      put(g, 'hostility', 'f_bs_pay', at)
      expect(test(id), `${id} 在 ${at}`).toBe(true)
    }
  })
})

describe('邊界 FACTIONS 6.3：每週消退', () => {
  /** 從第 3 天走到第 day 天 07:00（跨過 (day − 3) ÷ 7 進位個週一 06:00）。 */
  const passTo = (g: G, day: number) => g.commit(draft([{ op: 'time', minutes: minutesTo(g, day, 7) }], 'event.wait'))

  it('性質：任意起始敵對值、下限、那一週有沒有新的、跨過幾個週一，結果 = 一週一週扣（第一週有新的 −5、其餘 −10），不低於下限、不低於 0、不增加', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.boolean(), fc.integer({ min: 1, max: 4 }), (start, floorRaw, fresh, weeks) => {
      const floor = Math.min(floorRaw, start - 1)
      const g = make()
      if (floor > 0) put(g, 'hostility_floor', 'f_bs_pay', floor)
      if (fresh) {
        // 這一週有新的敵對值：先放 start − 1，再用一份報告 +1
        put(g, 'hostility', 'f_bs_pay', start - 1)
        g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_bs_pay', delta: 1 }]))
      } else put(g, 'hostility', 'f_bs_pay', start)
      if (h(g) !== start) return false
      passTo(g, 7 + 7 * (weeks - 1))
      let want = start
      for (let w = 0; w < weeks && want > floor; w++) want = Math.max(floor, want - (w === 0 && fresh ? 5 : 10))
      const got = h(g)
      return got === want && got >= floor && got >= 0 && got <= start
    }), { numRuns: 80 })
  })

  it('剛好在週一 06:00 前一分鐘：不消退；剛好走到 06:00：消退（時間點的邊界）', () => {
    const g = make()
    put(g, 'hostility', 'f_bs_pay', 50)
    g.commit(draft([{ op: 'time', minutes: minutesTo(g, 7, 6) - 1 }], 'event.wait'))
    expect(h(g)).toBe(50)
    g.commit(draft([{ op: 'time', minutes: 1 }], 'event.wait'))
    expect(h(g)).toBe(40)
  })

  it('零：敵對值 0、或已經在下限上，不出消退的報告；1 點消退到 0（不變成負數）', () => {
    const g = make()
    put(g, 'hostility', 'f_bs_proud', 0)
    put(g, 'hostility', 'f_bs_pay', 30)
    put(g, 'hostility_floor', 'f_bs_pay', 30)
    const rs = passTo(g, 7)
    expect(rs.map((r) => r.action)).not.toContain('security.decay')
    const one = make()
    put(one, 'hostility', 'f_bs_pay', 1)
    passTo(one, 7)
    expect(h(one)).toBe(0)
  })
})

describe('邊界 FACTIONS 6.3：收買', () => {
  it('單價 50 ×（敵對值 ÷ 20 進位）：1、20 → 50；21、40 → 100；41 → 150；99、100 → 250', () => {
    for (const [v, unit] of [[1, 50], [20, 50], [21, 100], [40, 100], [41, 150], [60, 150], [61, 200], [80, 200], [81, 250], [99, 250], [100, 250]] as const) {
      expect(bribeUnit(make().k, v), `敵對值 ${v}`).toBe(unit)
    }
  })

  it('點數：0、−1、1.5 擋；1 可以；20 可以；21 擋（一次最多 20）；最多降到下限（下限 + 1 那一點可以、再多一點擋）', () => {
    const g = make()
    put(g, 'hostility', 'f_bs_pay', 50)
    for (const p of [0, -1, 1.5, Number.NaN]) expect(bribeBlock(g.k, g.state, 'f_bs_pay', p), `${p}`).toMatch(/1～20 的整數/)
    expect(bribeBlock(g.k, g.state, 'f_bs_pay', 1)).toBeNull()
    expect(bribeBlock(g.k, g.state, 'f_bs_pay', 20)).toBeNull()
    expect(bribeBlock(g.k, g.state, 'f_bs_pay', 21)).toMatch(/最多降 20 點/)
    put(g, 'hostility_floor', 'f_bs_pay', 45)
    expect(bribeBlock(g.k, g.state, 'f_bs_pay', 5)).toBeNull()
    expect(bribeBlock(g.k, g.state, 'f_bs_pay', 6)).toMatch(/最多還能降 5 點/)
    put(g, 'hostility', 'f_bs_pay', 45)
    expect(bribeBlock(g.k, g.state, 'f_bs_pay', 1)).toMatch(/下限/)
  })

  it('現金剛好夠可以、少 1 元擋；用的是現金，帳戶的錢不算', () => {
    for (const [cash, ok] of [[50 * 3 * 10, true], [50 * 3 * 10 - 1, false]] as const) {
      const g = make(cash)
      g.state.money.cred = 1_000_000
      put(g, 'hostility', 'f_bs_pay', 45)
      const why = bribeBlock(g.k, g.state, 'f_bs_pay', 10)
      expect(why === null, `現金 ${cash}`).toBe(ok)
      if (ok) {
        g.commit(bribe(g.k, g.state, 'f_bs_pay', 10))
        expect([g.state.money.cash, h(g)]).toEqual([0, 35])
      } else expect(why).toMatch(/現金不夠/)
    }
  })

  it('性質：做得成時，付的錢 = 單價（照收買前的敵對值）× 點數，敵對值剛好降那麼多、不低於下限；做不成時狀態不動', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: -2, max: 25 }), fc.boolean(), (start, floorRaw, points, proud) => {
      const faction = proud ? 'f_bs_proud' : 'f_bs_pay'
      const floor = Math.min(floorRaw, start)
      const g = make()
      put(g, 'hostility', faction, start)
      if (floor > 0) put(g, 'hostility_floor', faction, floor)
      const cash0 = g.state.money.cash
      const why = bribeBlock(g.k, g.state, faction, points)
      const canDo = !proud && start > 0 && start > floor && Number.isInteger(points) && points >= 1 && points <= 20 && points <= start - floor
      if ((why === null) !== canDo) return false
      if (why !== null) {
        expect(() => bribe(g.k, g.state, faction, points)).toThrow()
        return h(g, faction) === start && g.state.money.cash === cash0
      }
      g.commit(bribe(g.k, g.state, faction, points))
      return h(g, faction) === start - points && g.state.money.cash === cash0 - 50 * Math.ceil(start / 20) * points && h(g, faction) >= floor
    }), { numRuns: 150 })
  })
})

// ===================================================================================================================

describe('邊界 FACTIONS 6.1：目標勢力的敵對值對委託的後果（出發的那一刻）', () => {
  /** 委託情境：把目標勢力的敵對值設成 v，出發，讀副本的設定。 */
  function goWith(v: number) {
    const t = makeCommissionGame({ seed: 6 })
    const g = t.game
    const target = String(jobOf(g.state, t.job)!.commission.target_faction)
    g.commit({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'hostility', key: target, set: v }], outcome: { result: 'ok', summary: '測試' } })
    g.commit(go(g.k, g.state, t.job))
    const run = readRun(g.state)! as unknown as { setup: { encounter_plus?: number }; alert: number }
    // 出發時算的警戒起始值併進副本的 alert（setup 裡不留 alert_start）
    return { encounter_plus: run.setup.encounter_plus, alert_start: run.alert }
  }
  const base = goWith(0)

  it('每個門檻與門檻−1：39 沒有加成、40 遭遇預算 +1；59 警戒起始照常、60 起 +20；100（最大）同 60 的加成', () => {
    const alert0 = base.alert_start ?? 0
    const want: Array<[number, number | undefined, number]> = [[0, undefined, alert0], [19, undefined, alert0], [20, undefined, alert0], [39, undefined, alert0], [40, 1, alert0], [59, 1, alert0], [60, 1, Math.min(100, alert0 + 20)], [79, 1, Math.min(100, alert0 + 20)], [100, 1, Math.min(100, alert0 + 20)]]
    for (const [v, plus, alert] of want) {
      const s = goWith(v)
      expect(s.encounter_plus, `敵對值 ${v}`).toBe(plus)
      expect(s.alert_start ?? 0, `敵對值 ${v}`).toBe(alert)
    }
  })

  it('性質：0～100 的任何敵對值，遭遇預算的加成是 0 或 1、警戒起始在 0～100，而且都只看門檻', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (v) => {
      const s = goWith(v)
      const alert = s.alert_start ?? 0
      return (s.encounter_plus ?? 0) === (v >= 40 ? 1 : 0) && alert >= 0 && alert <= 100 && alert === Math.min(100, (base.alert_start ?? 0) + (v >= 60 ? 20 : 0))
    }), { numRuns: 15 })
  }, 60000)
})

describe('邊界 NPC_SYSTEM 10.4：忠誠對出場費的分段', () => {
  it('忠誠 19、40、70：照常；20、39：出場費 +25%（剛好 20 是 20～39 那一段）；0 與 100 也照常', () => {
    const { game: g } = makeWorldGame({ seed: 4, actors: [makeRunner()] })
    g.commit(join(g.k, g.state, RUNNER, { pay: 'fee' }))
    const at = (v: number) => {
      g.state.meters.loyalty = { ...g.state.meters.loyalty, [RUNNER]: v }
      return feeOf(g.k, g.state, RUNNER)
    }
    const normal = at(40)
    expect(normal).toBeGreaterThan(0)
    for (const v of [0, 19, 40, 69, 70, 100]) expect(at(v), `忠誠 ${v}`).toBe(normal)
    // 出場費取整數：和 ×1.25 差不到 1
    for (const v of [20, 39]) expect(Math.abs(at(v) - normal * 1.25), `忠誠 ${v}`).toBeLessThanOrEqual(1)
  })
})
