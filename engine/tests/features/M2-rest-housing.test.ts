// 驗收測試：dev/work/M2-rest-housing.md（cpp-feature）。規格：DOWNTIME 第 1、2 節、7.1、7.2 節、5.1、5.2 節；EVENTS 3.1 節；CORE_RULES 4.1、4.2 節；dev/adr/0016 第六節。
// 內容一律用測試自帶的最小假資料：一張街的地圖（三個設施標記）、兩個區、兩塊街區、四種設施（家、膠囊旅館、潛艙店的隔間、空的）、幾間住處。
// 生命值上限用真的 character 功能（20 ＋ 體格 × 2，體格 10 就是 40）；站上設施用真的 world；帳單用真的 bills（房租掛在它的兩個掛點上）。
// 副本是 commission 的活動，測試用一個叫 commission 的替身活動（旗標 in_run 決定它在不在進行）。
//
// 時間：測試從第 3 天 10:00 開始；第 7、14、21 天的 06:00 是週一（第 1、2、3 週）。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { billPreview, billsFeature, currentLines, readBills, setBill } from '../../src/features/bills'
import { characterFeature } from '../../src/features/character'
import {
  breathDraft, homeOf, leaveDraft, readRest, rentDraft, restFeature, sleepDraft, sleepOptions,
} from '../../src/features/rest'
import { arrive, worldFeature } from '../../src/features/world'
import { METER_CONTENT, makeActor, makeGame, meterFeature, observed, testMeter } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '住處' }, { id: 'F2', at: [3, 1], mark: 'F', name: '旅館' }, { id: 'F3', at: [5, 1], mark: 'F', name: '空的設施' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const base = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_home', name: '公寓' },
      { id: 'fac_capsule', name: '膠囊旅館', sleep: { rate: 0.25, cost: 20 } },
      { id: 'fac_pod', name: '潛艙店', sleep: { rate: 0.2, cost: 10 } },
    ],
    district: [
      { id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_hive'] },
      { id: 'd_rust', name: '鏽帶', grade: 2, blocks: ['b_yard'] },
    ],
    block: [
      { id: 'b_hive', district: 'd_hive', name: '四號塔', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_home', name: '四號塔的單位' }, F2: { type: 'fac_capsule', name: '繭' }, F3: { type: 'fac_home', name: '鐵皮屋' } } },
      { id: 'b_yard', district: 'd_rust', name: '院子', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_pod', name: '潛艙店' } } },
    ],
    residence: [
      { id: 'r_unit', name: '四號塔的單位', district: 'd_hive', block: 'b_hive', facility: 'F1', level: 1, rent: 100 },
      { id: 'r_shack', name: '鐵皮屋', district: 'd_hive', block: 'b_hive', facility: 'F3', level: 0, rent: 60, cash_ok: 'only' },
      { id: 'r_loft', name: '打通戶', district: 'd_hive', block: 'b_hive', level: 2, rent: 300, cash_ok: true },
    ],
    bill_rule: [{ id: 'default', debt_faction: 'f_alpha', debt_rate: 0.1 }],
  }
  patch(c)
  return { id: 'rest_test', content: c as unknown as ContentPack['content'] }
}

/** 副本：旗標 in_run 在的時候進行中（放行 test. 開頭的行動，其餘擋掉）。 */
const COMMISSION_STUB: Feature = {
  id: 'commission_stub',
  install(k) {
    k.activity.define({
      kind: 'commission', owner: 'commission_stub', order: 90,
      active: (s) => (s.flags.in_run === true ? { id: 'c1', label: '委託副本' } : null),
      allow: ['commit:test.'],
      reason: () => '委託副本進行中，先把它做完。',
    })
  },
}

/** 聽 rest.done 的替身：把種類記成旗標。 */
const REST_LISTENER: Feature = {
  id: 'rest_listener',
  install(k) {
    k.hooks.on('rest.done', 'rest_listener', ({ kind }) => [{ op: 'flag', key: `rested_${kind}`, value: true }] as Change[])
  },
}

interface Opts {
  pc?: Rec
  actors?: ReturnType<typeof makeActor>[]
  money?: { cred: number; cash: number }
  pack?: ContentPack
  extra?: Feature[]
  world?: boolean
  location?: Rec
  hp?: number
  seed?: number
}

const make = (o: Opts = {}) => {
  const features: Feature[] = [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), characterFeature]
  if (o.world !== false) features.push(worldFeature)
  features.push(billsFeature, restFeature, ...(o.extra ?? []))
  const { game } = makeGame({
    features, content: [METER_CONTENT, o.pack ?? base()], seed: o.seed ?? 7,
    pc: { hp: o.hp ?? 40, ...(o.pc ?? {}) }, actors: o.actors ?? [],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 1000, cash: 100 }, ...(o.location ? { location: o.location as never } : {}) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const put = (g: G, changes: ReportDraft['changes']) => g.commit(draft(changes))
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const HOUR = 60
const goTo = (g: G, day: number, hour = 10, minute = 0) => advance(g, toMinutes({ day, hour, minute }) - toMinutes(g.state.time))
const stand = (g: G, block: string, at: string) => { g.commit(arrive(g.k, g.state, block, at)) }
const pc = (g: G) => g.state.actors.pc!
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const last = (g: G): Report => g.state.reports[g.state.reports.length - 1]!
const points = (r: Report): string[] => (r.triggers ?? []).map((t) => t.point)
const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
const treated = (g: G, who = 'pc') => { g.state.actors[who]!.conditions.push({ id: 'treated' }) }
const loaded = (g: G, who = 'pc', load = 6, glow = 2) => { g.state.actors[who]!.load = load; g.state.actors[who]!.afterglow = glow }
const rentHome = (g: G, id = 'r_unit') => g.commit(rentDraft(g.k, g.state, id))

// ---- 喘口氣 ----

describe('喘口氣', () => {
  it('時間 +60 分鐘；感載與餘韻歸零；體格 14 的人回 4 點', () => {
    const g = make({ pc: { attrs: { body: 14 } }, hp: 20 })
    loaded(g)
    const t0 = toMinutes(g.state.time)
    g.commit(breathDraft(g.k, g.state))
    expect(toMinutes(g.state.time) - t0).toBe(60)
    expect(pc(g).load).toBe(0)
    expect(pc(g).afterglow).toBe(0)
    expect(pc(g).hp).toBe(24)
    expect(last(g)).toMatchObject({ kind: 'downtime', action: 'rest.breath' })
  })

  it('生命回 2 ＋ mod(體格)，最少 1；補不過上限', () => {
    const weak = make({ pc: { attrs: { body: 4 } }, hp: 10 })
    weak.commit(breathDraft(weak.k, weak.state))
    expect(pc(weak).hp).toBe(11)
    const full = make({ hp: 40 })
    full.commit(breathDraft(full.k, full.state))
    expect(pc(full).hp).toBe(40)
    const near = make({ hp: 39 })
    near.commit(breathDraft(near.k, near.state))
    expect(pc(near).hp).toBe(40)
  })

  it('兩次睡一覺之間只有前兩次回生命；第三次不回（感載與餘韻照樣歸零）；睡過之後重新算', () => {
    const g = make({ pc: { attrs: { body: 14 } }, hp: 10 })
    g.commit(breathDraft(g.k, g.state))
    g.commit(breathDraft(g.k, g.state))
    expect(pc(g).hp).toBe(18)
    loaded(g)
    const third = breathDraft(g.k, g.state)
    g.commit(third)
    expect(pc(g).hp).toBe(18)
    expect(pc(g).load).toBe(0)
    expect(third.outcome.summary).toContain('沒有回復生命值')
    expect(readRest(g.state).breaths).toBe(3)
    g.commit(sleepDraft(g.k, g.state, { spot: 'wild' }))
    expect(readRest(g.state).breaths).toBe(0)
    const hp = pc(g).hp
    g.commit(breathDraft(g.k, g.state))
    expect(pc(g).hp).toBe(hp + 4)
  })

  it('隊上每個人都算：各自的感載、餘韻歸零，各自照自己的體格回生命', () => {
    const friend = makeActor({ id: 'friend', name: '夥伴', role: 'companion', hp: 10, attrs: { body: 16 } })
    const g = make({ actors: [friend], pc: { attrs: { body: 14 } }, hp: 20 })
    loaded(g)
    loaded(g, 'friend', 9, 3)
    g.commit(breathDraft(g.k, g.state))
    expect(g.state.actors.friend).toMatchObject({ load: 0, afterglow: 0, hp: 15 })
    expect(pc(g).hp).toBe(24)
  })

  it('發 rest.done（breath）：處理函式被叫到，它回傳的變更在同一份報告裡', () => {
    const g = make({ extra: [REST_LISTENER] })
    const d = breathDraft(g.k, g.state)
    expect(d.changes).toContainEqual({ op: 'flag', key: 'rested_breath', value: true })
    g.commit(d)
    expect(g.state.flags.rested_breath).toBe(true)
    expect(g.state.flags.rested_sleep).toBeUndefined()
    expect(last(g).changes).toContainEqual({ op: 'flag', key: 'rested_breath', value: true })
  })

  it('帶觸發點 rest（只有 rest，沒有 sleep_out 與 home）', () => {
    const g = make()
    g.commit(breathDraft(g.k, g.state))
    expect(points(last(g))).toEqual(['rest'])
  })
})

// ---- 睡一覺 ----

describe('睡一覺：時間、間隔、清空', () => {
  it('480 分鐘；感載、餘韻歸零；發 rest.done（sleep）', () => {
    const g = make({ extra: [REST_LISTENER], hp: 30 })
    loaded(g)
    const t0 = toMinutes(g.state.time)
    g.commit(sleepDraft(g.k, g.state))
    expect(toMinutes(g.state.time) - t0).toBe(480)
    expect(pc(g)).toMatchObject({ load: 0, afterglow: 0 })
    expect(g.state.flags.rested_sleep).toBe(true)
    expect(last(g)).toMatchObject({ kind: 'downtime', action: 'rest.sleep' })
    expect(last(g).changes).toContainEqual({ op: 'flag', key: 'rested_sleep', value: true })
  })

  it('上次睡完 10 小時再睡被擋並有原因；滿 16 小時可以', () => {
    const g = make({ hp: 30 })
    g.commit(sleepDraft(g.k, g.state))
    advance(g, 10 * HOUR)
    const why = reasonOf(() => sleepDraft(g.k, g.state))
    expect(why).toContain('10 小時')
    expect(why).toContain('16 小時')
    expect(g.blockOf('commit:rest.sleep')).toBeNull()
    advance(g, 5 * HOUR + 59)
    expect(() => sleepDraft(g.k, g.state)).toThrow(ActionBlocked)
    advance(g, 1)
    expect(() => g.commit(sleepDraft(g.k, g.state))).not.toThrow()
  })

  it('間隔是從上次睡完算起，不是從睡著算起', () => {
    const g = make({ hp: 30 })
    g.commit(sleepDraft(g.k, g.state))
    expect(readRest(g.state).lastSleep).toBe(toMinutes(g.state.time))
    advance(g, 16 * HOUR)
    expect(() => sleepDraft(g.k, g.state)).not.toThrow()
  })

  it('間隔被擋時 sleepOptions 的每一項都帶同一個原因；喘口氣不受影響', () => {
    const g = make({ hp: 30 })
    g.commit(sleepDraft(g.k, g.state))
    const opts = sleepOptions(g.k, g.state)
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.every((o) => typeof o.block === 'string' && o.block.includes('16 小時'))).toBe(true)
    expect(() => breathDraft(g.k, g.state)).not.toThrow()
  })
})

describe('睡在哪：回復率與價錢（上限 40 的人）', () => {
  // 生命 18、傷口處理過：不碰重傷限制，剛好看得出回復率
  const fresh = (o: Opts = {}) => {
    const g = make({ hp: 18, ...o })
    treated(g)
    return g
  }

  it('露宿回 4（10%、不花錢）', () => {
    const g = fresh()
    const cred = g.state.money.cred
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(22)
    expect(g.state.money.cred).toBe(cred)
  })

  it('膠囊旅館回 10 並扣錢（帳戶）', () => {
    const g = fresh()
    stand(g, 'b_hive', 'F2')
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(28)
    expect(g.state.money).toEqual({ cred: 980, cash: 100 })
  })

  it('1 級住處回 22；0 級 25%、2 級與 3 級 60%', () => {
    const g = fresh()
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(40)

    const zero = fresh({ money: { cred: 0, cash: 500 } })
    rentHome(zero, 'r_shack')
    stand(zero, 'b_hive', 'F3')
    zero.commit(sleepDraft(zero.k, zero.state))
    expect(pc(zero).hp).toBe(28)

    const two = make({ hp: 10, pc: { attrs: { body: 20 } } })
    treated(two)
    rentHome(two, 'r_loft')
    two.state.location = { district: 'd_hive', block: 'b_hive' }
    two.commit(sleepDraft(two.k, two.state))
    expect(pc(two).hp).toBe(10 + Math.floor(60 * 0.6))
  })

  it('規則的數字可以被 rest_rule 蓋掉', () => {
    const pack = base((c) => { c.rest_rule = [{ id: 'default', wild_rate: 0.5, sleep_gap_hours: 1, sleep_minutes: 360, home_rates: { 1: 0.9 } }] })
    const g = fresh({ pack })
    const t0 = toMinutes(g.state.time)
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(38)
    expect(toMinutes(g.state.time) - t0).toBe(360)
    advance(g, 60)
    expect(() => sleepDraft(g.k, g.state)).not.toThrow()
  })

  it('錢不夠付旅館：預設睡的地方就是旅館，被擋並寫出原因；改露宿可以', () => {
    const g = fresh({ money: { cred: 5, cash: 5 } })
    stand(g, 'b_hive', 'F2')
    expect(reasonOf(() => sleepDraft(g.k, g.state))).toContain('不夠')
    const opts = sleepOptions(g.k, g.state)
    expect(opts.map((o) => o.id)).toEqual(['facility', 'wild'])
    expect(opts[0]).toMatchObject({ current: true, cost: 20, pay: null })
    expect(opts[0]!.block).toContain('20')
    expect(opts[1]!.block).toBeNull()
    g.commit(sleepDraft(g.k, g.state, { spot: 'wild' }))
    expect(pc(g).hp).toBe(22)
    expect(g.state.money).toEqual({ cred: 5, cash: 5 })
  })

  it('帳戶不夠就扣現金；也可以指定付哪一種', () => {
    const g = fresh({ money: { cred: 5, cash: 50 } })
    stand(g, 'b_hive', 'F2')
    g.commit(sleepDraft(g.k, g.state))
    expect(g.state.money).toEqual({ cred: 5, cash: 30 })
    const h = fresh({ money: { cred: 100, cash: 50 } })
    stand(h, 'b_hive', 'F2')
    h.commit(sleepDraft(h.k, h.state, { pay: 'cash' }))
    expect(h.state.money).toEqual({ cred: 100, cash: 30 })
    const poor = fresh({ money: { cred: 100, cash: 5 } })
    stand(poor, 'b_hive', 'F2')
    expect(() => sleepDraft(poor.k, poor.state, { pay: 'cash' })).toThrow(ActionBlocked)
  })

  it('設施的 sleep 欄位給的是回復率與價錢：潛艙店 20%、10', () => {
    const g = fresh()
    stand(g, 'b_yard', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(26)
    expect(g.state.money.cred).toBe(990)
  })

  it('沒有 sleep 的設施只能露宿', () => {
    const g = fresh()
    stand(g, 'b_hive', 'F3')
    expect(sleepOptions(g.k, g.state).map((o) => o.id)).toEqual(['wild'])
  })
})

describe('重傷限制', () => {
  it('生命 10／40 而且沒有 treated：睡在 1 級住處只回到 20；有 treated 回到 32', () => {
    const a = make({ hp: 10 })
    rentHome(a)
    stand(a, 'b_hive', 'F1')
    const d = sleepDraft(a.k, a.state)
    a.commit(d)
    expect(pc(a).hp).toBe(20)
    expect(d.outcome.summary).toContain('最多只回到一半')

    const b = make({ hp: 10 })
    treated(b)
    rentHome(b)
    stand(b, 'b_hive', 'F1')
    b.commit(sleepDraft(b.k, b.state))
    expect(pc(b).hp).toBe(32)
  })

  it('一半就不算低於一半：生命 20／40 不受限制；限制不會把人往下扣', () => {
    const a = make({ hp: 20 })
    rentHome(a)
    stand(a, 'b_hive', 'F1')
    a.commit(sleepDraft(a.k, a.state))
    expect(pc(a).hp).toBe(40)
    // 露宿只回 4：19 → 20（沒超過一半，照回復率）；5 → 9（沒碰到上限）
    const b = make({ hp: 5 })
    b.commit(sleepDraft(b.k, b.state))
    expect(pc(b).hp).toBe(9)
  })

  it('每個人各算各的：處理過的夥伴不受限制，沒處理過的只回到一半', () => {
    const friend = makeActor({ id: 'friend', name: '夥伴', role: 'companion', hp: 10 })
    const g = make({ actors: [friend], hp: 10 })
    treated(g, 'friend')
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(20)
    expect(g.state.actors.friend!.hp).toBe(32)
  })

  it('treated 帶到期時間：過期了就當沒處理過', () => {
    const g = make({ hp: 10 })
    g.state.actors.pc!.conditions.push({ id: 'treated', until: toMinutes(g.state.time) - 1 })
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(pc(g).hp).toBe(20)
  })
})

describe('觸發點', () => {
  it('露宿：rest 與 sleep_out', () => {
    const g = make()
    g.commit(sleepDraft(g.k, g.state))
    expect(points(last(g))).toEqual(['rest', 'sleep_out'])
  })

  it('旅館：只有 rest', () => {
    const g = make()
    stand(g, 'b_hive', 'F2')
    g.commit(sleepDraft(g.k, g.state))
    expect(points(last(g))).toEqual(['rest'])
    expect(last(g).triggers![0]!.where).toMatchObject({ district: 'd_hive', block: 'b_hive' })
  })

  it('在自己的住處：rest 與 home（沒有 sleep_out）', () => {
    const g = make()
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(points(last(g))).toEqual(['rest', 'home'])
  })

  it('站在別人的住處（沒租）等於露宿', () => {
    const g = make()
    stand(g, 'b_hive', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(points(last(g))).toEqual(['rest', 'sleep_out'])
  })
})

// ---- 睡處的清單與格子上能做的事 ----

describe('sleepOptions 與站在設施上能做的事', () => {
  it('沒有家、不在設施上：只有露宿', () => {
    const g = make()
    expect(sleepOptions(g.k, g.state)).toEqual([{ id: 'wild', name: '露宿', rate: 0.1, cost: 0, pay: null, current: true, block: null }])
  })

  it('有家但人在別處：自己的住處列出來但灰掉，寫「你不在自己的住處」', () => {
    const g = make()
    rentHome(g)
    const opts = sleepOptions(g.k, g.state)
    expect(opts.map((o) => o.id)).toEqual(['home', 'wild'])
    expect(opts[0]).toMatchObject({ name: '四號塔的單位', rate: 0.55, current: false })
    expect(opts[0]!.block).toContain('不在自己的住處')
    expect(opts[1]).toMatchObject({ current: true, block: null })
  })

  it('站在自己的住處上：住處是現在站的地方', () => {
    const g = make()
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    expect(sleepOptions(g.k, g.state)[0]).toMatchObject({ id: 'home', current: true, block: null })
  })

  it('站在自己住處的設施上：usesOf 列出睡一覺與喘口氣；別的設施與別的格子沒有', () => {
    const g = make()
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'rest.sleep', name: '睡一覺', block: null }, { id: 'rest.breath', name: '喘口氣', block: null }])
    stand(g, 'b_hive', 'F3')
    expect(g.gridView()!.here.uses).toEqual([])
    stand(g, 'b_yard', 'F1')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'rest.sleep', name: '睡一覺（潛艙店，10）', block: null }])
  })

  it('沒有租的時候，站在那間設施上也不列', () => {
    const g = make()
    stand(g, 'b_hive', 'F1')
    expect(g.gridView()!.here.uses).toEqual([])
  })

  it('旅館的格子：睡一覺帶價錢；錢不夠灰掉並寫原因', () => {
    const g = make({ money: { cred: 3, cash: 0 } })
    stand(g, 'b_hive', 'F2')
    expect(g.gridView()!.here.uses).toEqual([{ id: 'rest.sleep', name: '睡一覺（繭，20）', block: expect.stringContaining('不夠') }])
  })

  it('間隔不到時，格子上的睡一覺灰掉；喘口氣照常', () => {
    const g = make()
    rentHome(g)
    stand(g, 'b_hive', 'F1')
    g.commit(sleepDraft(g.k, g.state))
    const uses = g.gridView()!.here.uses
    expect(uses[0]).toMatchObject({ id: 'rest.sleep', block: expect.stringContaining('16 小時') })
    expect(uses[1]).toEqual({ id: 'rest.breath', name: '喘口氣', block: null })
  })

  it('沒有裝世界：sleepOptions 只剩露宿與自己的住處（人要站在住處的街區上，沒寫設施的住處整塊街區都算）', () => {
    const noWorld = base((c) => {
      for (const kind of ['special_map', 'facility_type', 'district', 'block']) delete c[kind]
    })
    const g = make({ world: false, pack: noWorld, location: { district: 'd_hive', block: 'b_hive' } })
    expect(sleepOptions(g.k, g.state).map((o) => o.id)).toEqual(['wild'])
    g.commit(rentDraft(g.k, g.state, 'r_loft'))
    const opts = sleepOptions(g.k, g.state)
    expect(opts.map((o) => o.id)).toEqual(['home', 'wild'])
    expect(opts[0]).toMatchObject({ current: true, block: null, rate: 0.6 })
    g.state.location = { district: 'd_rust', block: 'b_yard' }
    expect(sleepOptions(g.k, g.state)[0]).toMatchObject({ current: false })
  })
})

// ---- 租與退租 ----

describe('租與退租', () => {
  it('押金是兩週房租，從帳戶扣；記在狀態裡', () => {
    const g = make()
    const d = rentDraft(g.k, g.state, 'r_unit')
    expect(d).toMatchObject({ kind: 'downtime', action: 'home.rent' })
    g.commit(d)
    expect(g.state.money).toEqual({ cred: 800, cash: 100 })
    expect(readRest(g.state).home).toEqual({ id: 'r_unit', deposit: 200, pool: 'cred', arrears: 0, locked: false })
    expect(test(g, { kind: 'has_home' })).toBe(true)
  })

  it('錢不夠被擋：寫出要多少、有多少；狀態不變', () => {
    const g = make({ money: { cred: 150, cash: 0 } })
    const why = reasonOf(() => rentDraft(g.k, g.state, 'r_unit'))
    expect(why).toContain('200')
    expect(why).toContain('150')
    expect(g.state.money).toEqual({ cred: 150, cash: 0 })
    expect(readRest(g.state).home).toBeNull()
    expect(test(g, { kind: 'has_home' })).toBe(false)
  })

  it('退租拿回押金（用什麼錢付的就退什麼錢）', () => {
    const g = make()
    rentHome(g)
    const d = leaveDraft(g.k, g.state)
    expect(d).toMatchObject({ kind: 'downtime', action: 'home.leave' })
    g.commit(d)
    expect(g.state.money).toEqual({ cred: 1000, cash: 100 })
    expect(readRest(g.state).home).toBeNull()
    expect(test(g, { kind: 'has_home' })).toBe(false)
    const shack = make({ money: { cred: 0, cash: 500 } })
    rentHome(shack, 'r_shack')
    expect(shack.state.money).toEqual({ cred: 0, cash: 380 })
    shack.commit(leaveDraft(shack.k, shack.state))
    expect(shack.state.money).toEqual({ cred: 0, cash: 500 })
  })

  it('沒有家不能退租', () => {
    const g = make()
    expect(reasonOf(() => leaveDraft(g.k, g.state))).toContain('沒有租')
  })

  it('同時只有一個家：第二個被擋，先退租才能換', () => {
    const g = make()
    rentHome(g)
    expect(reasonOf(() => rentDraft(g.k, g.state, 'r_loft'))).toContain('已經有一個家')
    expect(reasonOf(() => rentDraft(g.k, g.state, 'r_unit'))).toContain('已經租著')
    g.commit(leaveDraft(g.k, g.state))
    g.commit(rentDraft(g.k, g.state, 'r_loft'))
    expect(readRest(g.state).home!.id).toBe('r_loft')
  })

  it('查不到的住處被擋', () => {
    const g = make()
    expect(reasonOf(() => rentDraft(g.k, g.state, 'nope'))).toContain('nope')
  })

  it('收現金的住處（cash_ok）：沒寫只收帳戶、true 都收、only 只收現金', () => {
    const cashOnly = make({ money: { cred: 1000, cash: 0 } })
    expect(reasonOf(() => rentDraft(cashOnly.k, cashOnly.state, 'r_shack'))).toContain('現金')
    const credOnly = make({ money: { cred: 0, cash: 1000 } })
    expect(reasonOf(() => rentDraft(credOnly.k, credOnly.state, 'r_unit'))).toContain('不夠')
    expect(reasonOf(() => rentDraft(credOnly.k, credOnly.state, 'r_unit', { pay: 'cash' }))).toContain('不收現金')
    const either = make({ money: { cred: 100, cash: 1000 } })
    either.commit(rentDraft(either.k, either.state, 'r_loft'))
    expect(either.state.money).toEqual({ cred: 100, cash: 400 })
    expect(readRest(either.state).home!.pool).toBe('cash')
    const chosen = make({ money: { cred: 1000, cash: 1000 } })
    chosen.commit(rentDraft(chosen.k, chosen.state, 'r_loft', { pay: 'cash' }))
    expect(chosen.state.money).toEqual({ cred: 1000, cash: 400 })
  })

  it('房租是 0 的住處不收押金', () => {
    const g = make({ pack: base((c) => { c.residence!.push({ id: 'r_free', name: '收容所', district: 'd_hive', block: 'b_hive', level: 0, rent: 0 }) }) })
    g.commit(rentDraft(g.k, g.state, 'r_free'))
    expect(g.state.money).toEqual({ cred: 1000, cash: 100 })
    expect(currentLines(g.k, g.state).filter((l) => l.owner === 'rest')).toEqual([])
  })
})

// ---- 帳單 ----

describe('房租在每週帳單裡', () => {
  it('帳單有房租這一項（order 1；pay 照住處收的錢）', () => {
    const g = make()
    rentHome(g)
    const lines = currentLines(g.k, g.state).filter((l) => l.owner === 'rest')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ id: 'rent', kind: 'due', amount: 100, order: 1, pay: 'cred' })
    expect(billPreview(g.k, g.state).lines.some((l) => l.id === 'rent' && l.amount === 100)).toBe(true)

    const shack = make({ money: { cred: 0, cash: 500 } })
    rentHome(shack, 'r_shack')
    expect(currentLines(shack.k, shack.state).find((l) => l.id === 'rent')).toMatchObject({ amount: 60, pay: 'cash' })
    const loft = make({ money: { cred: 0, cash: 1000 } })
    rentHome(loft, 'r_loft')
    expect(currentLines(loft.k, loft.state).find((l) => l.id === 'rent')).toMatchObject({ amount: 300, pay: 'either' })
  })

  it('沒有家就沒有這一項；退租之後也沒有', () => {
    const g = make()
    expect(currentLines(g.k, g.state).some((l) => l.owner === 'rest')).toBe(false)
    rentHome(g)
    g.commit(leaveDraft(g.k, g.state))
    expect(currentLines(g.k, g.state).some((l) => l.owner === 'rest')).toBe(false)
  })

  it('週一照帳戶扣房租；付成了欠繳週數是 0', () => {
    const g = make()
    rentHome(g)
    goTo(g, 7, 7)
    expect(g.state.money.cred).toBe(700)
    expect(readRest(g.state).home).toMatchObject({ arrears: 0, locked: false })
  })

  it('連兩週沒付：門鎖被換、sleepOptions 裡自己的住處灰掉並有原因；付清之後恢復', () => {
    const g = make({ money: { cred: 200, cash: 0 } })
    rentHome(g) // 押金 200 扣光
    expect(g.state.money.cred).toBe(0)
    stand(g, 'b_hive', 'F1')
    goTo(g, 7, 7)
    expect(readRest(g.state).home).toMatchObject({ arrears: 1, locked: false })
    expect(sleepOptions(g.k, g.state)[0]).toMatchObject({ id: 'home', block: null })
    goTo(g, 14, 7)
    expect(readRest(g.state).home).toMatchObject({ arrears: 2, locked: true })
    const home = sleepOptions(g.k, g.state).find((o) => o.id === 'home')!
    expect(home.block).toContain('門鎖')
    expect(home.block).toContain('房租')
    expect(sleepOptions(g.k, g.state).find((o) => o.id === 'wild')!.block).toBeNull()
    // 人就站在自己家門口：預設睡的地方被擋；指定住處也被擋；露宿可以
    expect(reasonOf(() => sleepDraft(g.k, g.state))).toContain('門鎖')
    expect(reasonOf(() => sleepDraft(g.k, g.state, { spot: 'home' }))).toContain('門鎖')
    expect(g.gridView()!.here.uses[0]).toMatchObject({ id: 'rest.sleep', block: expect.stringContaining('門鎖') })
    expect(test(g, { kind: 'at_home' })).toBe(true)
    // 付清：下一個週一付得出房租，門鎖開、欠繳歸零
    g.state.money.cred = 500
    goTo(g, 21, 7)
    expect(readRest(g.state).home).toMatchObject({ arrears: 0, locked: false })
    expect(sleepOptions(g.k, g.state)[0]).toMatchObject({ id: 'home', current: true, block: null })
    expect(() => sleepDraft(g.k, g.state)).not.toThrow()
  })

  it('一次睡過兩個週一都沒付：兩週都累計（欠繳 2、門鎖被換）', () => {
    const g = make({ money: { cred: 200, cash: 0 } })
    rentHome(g)
    goTo(g, 15, 10)
    expect(readRest(g.state).home).toMatchObject({ arrears: 2, locked: true })
    expect(g.state.reports.filter((r) => r.action === 'bill.settle')).toHaveLength(2)
  })

  it('沒付成的是別的項目、房租付成了：房租不算欠', () => {
    const g = make({ money: { cred: 300, cash: 0 }, extra: [{
      id: 'other_bill',
      install(k) { k.hooks.on('bill.collect', 'other_bill', () => [{ id: 'big', owner: 'other_bill', name: '大筆帳單', kind: 'due' as const, amount: 5000, order: 3, pay: 'cred' as const }]) },
    }] })
    rentHome(g)
    g.state.money.cred = 150
    goTo(g, 7, 7)
    expect(readRest(g.state).home).toMatchObject({ arrears: 0, locked: false })
    expect(g.state.money.cred).toBe(50)
  })

  it('玩家把房租停掉（不付也不算欠）：不累計、不換鎖', () => {
    const g = make({ money: { cred: 200, cash: 0 } })
    rentHome(g)
    g.commit(setBill(g.k, g.state, 'rent', { stopped: true }))
    goTo(g, 15, 10)
    expect(readRest(g.state).home).toMatchObject({ arrears: 0, locked: false })
    expect(readBills(g.state).overdue).toBe(0)
  })

  it('收現金的住處：欠繳照樣累計（付現金）', () => {
    const g = make({ money: { cred: 5000, cash: 120 } })
    rentHome(g, 'r_shack')
    expect(g.state.money.cash).toBe(0)
    goTo(g, 14, 7)
    expect(g.state.money.cred).toBe(5000)
    expect(readRest(g.state).home).toMatchObject({ arrears: 2, locked: true })
  })

  it('門鎖被換掉之後，退租照樣退押金；退租後不再收房租也不再累計', () => {
    const g = make({ money: { cred: 200, cash: 0 } })
    rentHome(g)
    goTo(g, 14, 7)
    expect(readRest(g.state).home!.locked).toBe(true)
    g.commit(leaveDraft(g.k, g.state))
    expect(g.state.money.cred).toBe(200)
    goTo(g, 28, 7)
    expect(readRest(g.state).home).toBeNull()
  })
})

// ---- 開新局 ----

describe('開新局', () => {
  const withStart = () => base((c) => { c.residence![0] = { ...c.residence![0]!, start: true } })

  it('內容裡有 start 的住處：主角一開始就租著它（不收押金）、has_home 成立', () => {
    const g = make({ pack: withStart() })
    g.newGame({ seed: 11 })
    expect(test(g, { kind: 'has_home' })).toBe(true)
    expect(readRest(g.state).home).toEqual({ id: 'r_unit', deposit: 0, pool: 'cred', arrears: 0, locked: false })
    expect(homeOf(g.k, g.state)!.residence.name).toBe('四號塔的單位')
    expect(g.state.money).toEqual(expect.objectContaining({ cred: expect.any(Number) }))
    // 房租照收；退租不退押金（沒付過）
    expect(currentLines(g.k, g.state).find((l) => l.id === 'rent')).toMatchObject({ amount: 100 })
  })

  it('沒有 start：開新局沒有家', () => {
    const g = make()
    g.newGame({ seed: 11 })
    expect(test(g, { kind: 'has_home' })).toBe(false)
    expect(g.state.ext.rest).toBeUndefined()
  })

  it('起點的住處退租沒有押金可退，可以另外租別的', () => {
    const g = make({ pack: withStart() })
    g.newGame({ seed: 11 })
    const cred = g.state.money.cred
    g.state.actors = make().state.actors
    g.state.pc = 'pc'
    g.state.party = ['pc']
    g.commit(leaveDraft(g.k, g.state))
    expect(g.state.money.cred).toBe(cred)
    expect(test(g, { kind: 'has_home' })).toBe(false)
  })
})

// ---- 條件 ----

describe('條件', () => {
  it('at_home：站在自己的住處上才成立（沒寫設施的住處整塊街區都算）', () => {
    const g = make()
    expect(test(g, { kind: 'at_home' })).toBe(false)
    rentHome(g)
    expect(test(g, { kind: 'at_home' })).toBe(false)
    stand(g, 'b_hive', 'F3')
    expect(test(g, { kind: 'at_home' })).toBe(false)
    stand(g, 'b_hive', 'F1')
    expect(test(g, { kind: 'at_home' })).toBe(true)
    g.commit(leaveDraft(g.k, g.state))
    expect(test(g, { kind: 'at_home' })).toBe(false)
    const loft = make({ money: { cred: 1000, cash: 1000 } })
    loft.commit(rentDraft(loft.k, loft.state, 'r_loft'))
    stand(loft, 'b_hive', 'F2')
    expect(test(loft, { kind: 'at_home' })).toBe(true)
    stand(loft, 'b_yard', 'F1')
    expect(test(loft, { kind: 'at_home' })).toBe(false)
  })

  it('slept_within { hours }：從上次睡完算起；沒睡過不成立', () => {
    const g = make()
    expect(test(g, { kind: 'slept_within', hours: 24 })).toBe(false)
    g.commit(sleepDraft(g.k, g.state))
    expect(test(g, { kind: 'slept_within', hours: 8 })).toBe(true)
    advance(g, 8 * HOUR)
    expect(test(g, { kind: 'slept_within', hours: 8 })).toBe(true)
    advance(g, 1)
    expect(test(g, { kind: 'slept_within', hours: 8 })).toBe(false)
    expect(test(g, { kind: 'slept_within', hours: 24 })).toBe(true)
  })

  it('格式檢查：slept_within 的 hours 要是正數', () => {
    const g = make()
    expect(g.k.conditions.validate({ kind: 'slept_within', hours: 8 })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'slept_within' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'slept_within', hours: 0 })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'has_home' })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'at_home' })).toEqual([])
  })
})

// ---- 活動擋住 ----

describe('有 commission 的活動進行時', () => {
  const inRun = (g: G) => put(g, [{ op: 'flag', key: 'in_run', value: true }])

  it('兩種休息都被擋；也不能租或退租；狀態不變', () => {
    const g = make({ extra: [COMMISSION_STUB] })
    rentHome(g)
    // 旗標用測試自己的行動放行（test. 開頭）
    const breath = breathDraft(g.k, g.state)
    inRun(g)
    const t0 = toMinutes(g.state.time)
    expect(g.blockOf('commit:rest.breath', breath)).toBe('委託副本進行中，先把它做完。')
    expect(() => g.commit(breath)).toThrow(ActionBlocked)
    expect(reasonOf(() => breathDraft(g.k, g.state))).toBeTruthy()
    expect(reasonOf(() => sleepDraft(g.k, g.state))).toContain('委託副本')
    expect(sleepOptions(g.k, g.state).every((o) => o.block === '委託副本進行中，先把它做完。')).toBe(true)
    expect(reasonOf(() => leaveDraft(g.k, g.state))).toContain('委託副本')
    expect(toMinutes(g.state.time)).toBe(t0)
    put(g, [{ op: 'flag', key: 'in_run', value: null }])
    expect(() => g.commit(breathDraft(g.k, g.state))).not.toThrow()
    expect(() => g.commit(sleepDraft(g.k, g.state))).not.toThrow()
  })

  it('租不了房（有活動時）', () => {
    const g = make({ extra: [COMMISSION_STUB] })
    inRun(g)
    expect(reasonOf(() => rentDraft(g.k, g.state, 'r_unit'))).toContain('委託副本')
  })
})

// ---- 內容的格式檢查 ----

describe('內容的格式', () => {
  it('住處的欄位不對：載入時擋下（等級、房租、cash_ok、facility）', () => {
    const bad = (patch: Rec) => base((c) => { c.residence = [{ id: 'r_bad', name: '壞的', district: 'd_hive', block: 'b_hive', level: 1, rent: 10, ...patch }] })
    for (const patch of [{ level: 4 }, { rent: -1 }, { rent: 1.5 }, { cash_ok: 'maybe' }, { name: '' }, { start: 'yes' }, { facility: 3 }]) {
      expect(() => make({ pack: bad(patch) }), JSON.stringify(patch)).toThrow()
    }
    expect(() => make({ pack: bad({}) })).not.toThrow()
  })

  it('住處的街區與設施要真的在（裝了世界時）', () => {
    const noBlock = base((c) => { c.residence![0] = { ...c.residence![0]!, block: 'b_nowhere' } })
    expect(() => make({ pack: noBlock })).toThrow(ContentError)
    const noFac = base((c) => { c.residence![0] = { ...c.residence![0]!, facility: 'F9' } })
    expect(() => make({ pack: noFac })).toThrow(/F9/)
    const wrongDistrict = base((c) => { c.residence![0] = { ...c.residence![0]!, district: 'd_rust' } })
    expect(() => make({ pack: wrongDistrict })).toThrow(/district/)
  })

  it('設施種類的 sleep 欄位：rate 要是 0～1、cost 要是 0 以上的整數', () => {
    const bad = (sleep: unknown) => base((c) => { c.facility_type![1] = { id: 'fac_capsule', name: '膠囊旅館', sleep } })
    for (const sleep of [{ rate: 2, cost: 1 }, { rate: 0.2, cost: -1 }, { rate: 0.2, cost: 1.5 }, { rate: 0.2 }, 'cheap']) {
      expect(() => make({ pack: bad(sleep) }), JSON.stringify(sleep)).toThrow(ContentError)
    }
    expect(() => make({ pack: bad({ rate: 0.2, cost: 0 }) })).not.toThrow()
  })

  it('規則：數字不對的欄位被內容檢查擋下', () => {
    expect(() => make({ pack: base((c) => { c.rest_rule = [{ id: 'default', sleep_gap_hours: -1 }] }) })).toThrow()
    expect(() => make({ pack: base((c) => { c.rest_rule = [{ id: 'default', home_rates: { 9: 0.5 } }] }) })).toThrow()
  })
})

// ---- 整體：報告與不變式 ----

describe('報告與不變式', () => {
  it('睡、喘、租、退一連串下來，變更套用之後等於實際的變化', async () => {
    const g = make({ hp: 12, money: { cred: 600, cash: 0 } })
    const { violations } = await observed(g, () => {
      loaded(g)
      g.commit(rentDraft(g.k, g.state, 'r_unit'))
      stand(g, 'b_hive', 'F1')
      g.commit(breathDraft(g.k, g.state))
      g.commit(sleepDraft(g.k, g.state))
      goTo(g, 14, 7)
      g.commit(leaveDraft(g.k, g.state))
    })
    expect(violations).toEqual([])
    expect(g.state.reports.some((r) => r.action === 'rest.sleep')).toBe(true)
  })

  it('同一個種子、存檔讀檔之後結果一樣', () => {
    const run = (g: G) => {
      rentHome(g)
      stand(g, 'b_hive', 'F1')
      g.commit(sleepDraft(g.k, g.state))
      goTo(g, 14, 7)
      return JSON.stringify([g.state.ext.rest, g.state.money, pc(g).hp, toMinutes(g.state.time)])
    }
    const a = run(make({ hp: 10, money: { cred: 300, cash: 0 } }))
    const b = run(make({ hp: 10, money: { cred: 300, cash: 0 } }))
    expect(a).toBe(b)
  })

  it('狀態形狀壞掉時讀成空的，不丟錯', () => {
    const g = make()
    g.state.ext.rest = { lastSleep: 'x', breaths: -3, home: { id: 5 } }
    expect(readRest(g.state)).toEqual({ lastSleep: null, breaths: 0, home: null })
    g.state.ext.rest = 42
    expect(readRest(g.state)).toEqual({ lastSleep: null, breaths: 0, home: null })
    expect(() => g.commit(sleepDraft(g.k, g.state))).not.toThrow()
  })
})
