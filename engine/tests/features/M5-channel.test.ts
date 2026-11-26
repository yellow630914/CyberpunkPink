// 驗收測試：dev/work/M5-channel.md（cpp-feature）。頻道的前半：開頻道、三張長期的量表、預算與贊助、每週結算、flow_tier 的來源。
// 規格：MEDIA 第 4 節開頭、4.1、4.2、4.5（位子數）、4.8；EVENTS 2.4 節的 credibility、3.1 節的觸發點；dev/adr/0020 第二節、第十三節、V12～V16、V18、V19。
// 內容一律用測試自帶的最小假資料：兩個勢力（testkit 的 METER_CONTENT：f_alpha、f_beta）、好感與敵對值的替身量表（security 的樣子）、
// 一個定義 flow_tier 的替身（abilities 的替身）、玩具的 commission 活動（旗標 in_run 決定它在不在進行）、玩具的 live 結束（endActivity 發 activity.end）。
// 時間：測試從第 3 天 10:00 開始；第 7、14、21 天的 06:00 是週一。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, effectCtx, endActivity, meterOf, toMinutes } from '../../src'
import {
  DEFAULT_CHANNEL_RULES, channelFeature, channelLevel, channelRules, channelSeats, channelView, endSponsor, fund, openChannel, payFromBudget, readChannel, withdraw, withdrawPreview,
} from '../../src/features/channel'
import { ruleProblems } from '../../src/features/channel/model'
import { makeActor, makeGame, meterFeature, METER_CONTENT, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

/** abilities 的替身：只定義 flow_tier（基礎 0）。channel 在內容載入之後（ready）才看有沒有人定義，所以排在哪裡都行。 */
const FLOW_TOY: Feature = {
  id: 'flow_toy',
  install(k: Kernel) {
    k.stats.defineStat({ id: 'flow_tier', owner: 'flow_toy', name: '導流階', base: () => 0, min: 0, max: 9 })
  },
}

/** security 的替身：好感（起始 10）與敵對值。 */
const STANDING = meterFeature(
  testMeter({ kind: 'favor', owner: 'sec_toy', name: '好感', start: 10, keyed: 'faction' }),
  testMeter({ kind: 'hostility', owner: 'sec_toy', name: '敵對值', keyed: 'faction' }),
)

/** 副本：旗標 in_run 在的時候進行中（放行 test. 開頭的行動，其餘擋掉）。 */
const COMMISSION_STUB: Feature = {
  id: 'commission_stub',
  install(k: Kernel) {
    k.activity.define({
      kind: 'commission', owner: 'commission_stub', order: 90,
      active: (s) => (s.flags.in_run === true ? { id: 'c1', label: '委託副本' } : null),
      allow: ['commit:test.'],
      reason: () => '委託副本進行中，先把它做完。',
    })
  },
}

/** 另一種進行中的活動（潛入）：每週結算照常結，不像副本那樣延後。 */
const DIVE_STUB: Feature = {
  id: 'dive_stub',
  install(k: Kernel) {
    k.activity.define({
      kind: 'dive', owner: 'dive_stub', order: 80,
      active: (s) => (s.flags.in_dive === true ? { id: 'd1', label: '潛入' } : null),
      allow: ['commit:test.'],
      reason: () => '潛入進行中。',
    })
  },
}

interface Opts {
  cred?: number
  cash?: number
  features?: Feature[]
  packs?: ContentPack[]
  /** 不裝好感與敵對值（security 沒裝的局） */
  bare?: boolean
  /** 不裝 flow_tier 的定義（abilities 沒裝的局） */
  noFlow?: boolean
  /** 開好頻道（預設不開） */
  open?: boolean
  name?: string
}

const make = (o: Opts = {}) => {
  const features: Feature[] = [COMMISSION_STUB, DIVE_STUB, ...(o.bare ? [] : [STANDING]), ...(o.noFlow ? [] : [FLOW_TOY]), channelFeature, ...(o.features ?? [])]
  const { game } = makeGame({
    features, content: [METER_CONTENT, ...(o.packs ?? [])], seed: 7,
    actors: [makeActor({ id: 'bud', name: '夥伴', role: 'companion' }), makeActor({ id: 'stranger', name: '路人', role: 'npc' })],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: o.cred ?? 5000, cash: o.cash ?? 2000 } },
  })
  if (o.open) game.commit(openChannel(game.k, game.state, o.name ?? '測試頻道'))
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: Change[], action = 'test.give', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...extra,
})
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const subsOf = (g: G): number => meterOf(g.k, g.state, 'subs')
const credOf = (g: G): number => meterOf(g.k, g.state, 'credibility')
const recoOf = (g: G): number => meterOf(g.k, g.state, 'reco')
const setMeter = (g: G, kind: string, value: number) => give(g, [{ op: 'meter', kind, key: '_', set: value }])
const ch = (g: G) => readChannel(g.state)
const advance = (g: G, minutes: number) => g.commit({ kind: 'action', action: 'test.wait', location: {}, party: [], timeline: [], changes: [{ op: 'time', minutes }], outcome: { result: 'ok', summary: '測試' } })
const goTo = (g: G, day: number, hour = 10, minute = 0) => advance(g, toMinutes({ day, hour, minute }) - toMinutes(g.state.time))
const weeklies = (g: G) => g.state.reports.filter((r) => r.action === 'channel.weekly')
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}

/** 效果走一遍（內建的來源）、套上去，回傳解出來的整份。 */
function effects(g: G, list: unknown[], source: 'builtin' | 'ai' | 'player' = 'builtin') {
  const r = g.k.effects.resolve(list, effectCtx(g.k, g.state, { source }))
  if (r.errors.length === 0) g.commit(sys(r.changes))
  return r
}

/** 一個勢力的公帳與額度（直接放進去）。 */
const pool = (g: G, faction: string, cred: number, quota = 0) => give(g, [{ op: 'channel.budget', pool: faction, cred, quota }])
const poolOf = (g: G, faction: string) => ch(g).budget.pools[faction] ?? { cred: 0, quota: 0 }

const SPONSOR_A = { kind: 'sponsor', faction: 'f_alpha', every_weeks: 1, amount: 3000 }

// ===================================================================================================================
describe('開頻道（MEDIA 第 4 節；V14、V18）', () => {
  it('開了之後訂閱 100、公信力 50、推薦權重 0；不花錢；報告是 channel.open', () => {
    const g = make()
    const before = { ...g.state.money }
    const r = g.commit(openChannel(g.k, g.state, '夜行頻道'))[0]!
    expect(r.action).toBe('channel.open')
    expect(ch(g)).toMatchObject({ open: true, name: '夜行頻道', since: toMinutes(r.time.start) })
    expect([subsOf(g), credOf(g), recoOf(g)]).toEqual([100, 50, 0])
    expect(g.state.money).toEqual(before)
    expect(ch(g).budget).toEqual({ own: { cred: 0, cash: 0 }, pools: {} })
  })

  it('沒開的時候：channelView 回「還沒有頻道」、等級 0、flow_tier 是 0', () => {
    const g = make()
    const v = channelView(g.k, g.state)
    expect(v).toMatchObject({ open: false })
    expect((v as { note: string }).note).toContain('還沒有頻道')
    expect(channelLevel(g.k, g.state)).toBe(0)
    expect(channelSeats(g.k, g.state)).toBe(0)
    expect(g.k.stats.stat(g.state, 'pc', 'flow_tier')).toBe(0)
    expect(g.k.conditions.test({ kind: 'channel_open' }, { state: g.state, k: g.k } as never)).toBe(false)
  })

  it('已經有頻道、名字是空的，原因是完整的一句；名字原樣存（不 trim），太長的照字截斷並提醒', () => {
    const g = make({ open: true })
    expect(reasonOf(() => openChannel(g.k, g.state, '又一個'))).toBe('你已經有頻道了。')
    const h = make()
    expect(reasonOf(() => openChannel(h.k, h.state, '   '))).toBe('頻道要有一個名字。')
    h.commit(openChannel(h.k, h.state, '  夜  '))
    expect(ch(h).name).toBe('  夜  ')
    const long = make()
    const draft = openChannel(long.k, long.state, '字'.repeat(25))
    expect(draft.outcome.summary).toContain('只留了前 20 個字')
    long.commit(draft)
    expect(Array.from(ch(long).name)).toHaveLength(20)
  })

  it('公信力與推薦權重在開頻道之前就有的，不被開頻道蓋掉；訂閱已經多過 100 的不往下改', () => {
    const g = make()
    setMeter(g, 'credibility', 70)
    setMeter(g, 'subs', 400)
    g.commit(openChannel(g.k, g.state, 'A'))
    expect([subsOf(g), credOf(g)]).toEqual([400, 70])
  })

  it('進行中的副本擋住開頻道（放行清單之外的報告）', () => {
    const g = make()
    give(g, [{ op: 'flag', key: 'in_run', value: true }])
    expect(reasonOf(() => openChannel(g.k, g.state, 'A'))).toContain('委託副本進行中')
  })
})

// ===================================================================================================================
describe('flow_tier（MEDIA 4.1：訂閱的位數 −3，公信力 60 以上 +1）', () => {
  const tier = (g: G, subs: number, cred: number): number => {
    setMeter(g, 'subs', subs)
    setMeter(g, 'credibility', cred)
    return g.k.stats.stat(g.state, 'pc', 'flow_tier')
  }

  it('訂閱 999、1,000、10,000、100,000、1,000,000 與公信力 59、60 對表', () => {
    const g = make({ open: true })
    const table: Array<[number, number, number]> = [
      [999, 59, 0], [999, 60, 1], [1000, 59, 1], [1000, 60, 2], [9999, 59, 1], [10000, 59, 2], [10000, 60, 3], [100000, 59, 3], [100000, 60, 4], [1000000, 59, 4], [1000000, 60, 5],
    ]
    for (const [subs, cred, want] of table) expect(tier(g, subs, cred), `${subs}／${cred}`).toBe(want)
  })

  it('只有隊伍（主角與夥伴）拿得到；不在隊伍的人是 0', () => {
    const g = make({ open: true })
    tier(g, 10000, 60)
    expect(g.k.stats.stat(g.state, 'pc', 'flow_tier')).toBe(3)
    expect(g.k.stats.stat(g.state, 'bud', 'flow_tier')).toBe(3)
    expect(g.k.stats.stat(g.state, 'stranger', 'flow_tier')).toBe(0)
  })

  it('abilities 沒裝（沒有人定義 flow_tier）：不報錯、也沒有 provider', () => {
    const g = make({ open: true, noFlow: true })
    expect(g.k.stats.hasStat('flow_tier')).toBe(false)
  })
})

// ===================================================================================================================
describe('頻道等級與位子（MEDIA 4.5）', () => {
  it('訂閱 999 是 1 級（2 格）、1,000 是 2 級（3 格）、10,000 是 3 級（4 格）；channel_level 條件對表', () => {
    const g = make({ open: true })
    const ctx = (): never => ({ state: g.state, k: g.k }) as never
    for (const [subs, level, seats] of [[0, 1, 2], [999, 1, 2], [1000, 2, 3], [9999, 2, 3], [10000, 3, 4], [5_000_000, 3, 4]] as const) {
      setMeter(g, 'subs', subs)
      expect([channelLevel(g.k, g.state), channelSeats(g.k, g.state)], `${subs}`).toEqual([level, seats])
    }
    setMeter(g, 'subs', 1000)
    expect(g.k.conditions.test({ kind: 'channel_level', min: 2 }, ctx())).toBe(true)
    expect(g.k.conditions.test({ kind: 'channel_level', min: 3 }, ctx())).toBe(false)
    expect(g.k.conditions.test({ kind: 'channel_level', max: 1 }, ctx())).toBe(false)
    expect(g.k.conditions.test({ kind: 'channel_level', min: 1, max: 2 }, ctx())).toBe(true)
    expect(g.k.conditions.explain({ kind: 'channel_level', min: 3 }, ctx())).toContain('頻道的等級要在 3 以上')
  })

  it('channelView：離下一級差多少、最高級沒有下一級', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 700)
    let v = channelView(g.k, g.state) as Extract<ReturnType<typeof channelView>, { open: true }>
    expect(v).toMatchObject({ open: true, level: 1, seats: 2, subs: 700, credibility: 50, reco: 0, next: { level: 2, at: 1000, gap: 300 } })
    setMeter(g, 'subs', 20000)
    v = channelView(g.k, g.state) as typeof v
    expect(v).toMatchObject({ level: 3, seats: 4, next: null, flow_tier: 2 })
  })
})

// ===================================================================================================================
describe('預算：補貼與開銷的扣法（MEDIA 4.2）', () => {
  it('補貼：從帳戶投進自有的帳戶、從現金投進自有的現金；沒有代價；錢不夠、沒頻道、數字不對都被擋', () => {
    const g = make({ open: true, cred: 1000, cash: 500 })
    g.commit(fund(g.k, g.state, { purse: 'cred', amount: 400 }))
    g.commit(fund(g.k, g.state, { purse: 'cash', amount: 100 }))
    expect(g.state.money).toEqual({ cred: 600, cash: 400 })
    expect(ch(g).budget.own).toEqual({ cred: 400, cash: 100 })
    expect(g.state.reports.at(-1)!.action).toBe('channel.fund')
    expect(reasonOf(() => fund(g.k, g.state, { purse: 'cred', amount: 700 }))).toBe('你的帳戶只有 600，投不了 700。')
    expect(reasonOf(() => fund(g.k, g.state, { purse: 'cash', amount: 0 }))).toContain('1 以上的整數')
    const none = make()
    expect(reasonOf(() => fund(none.k, none.state, { purse: 'cred', amount: 10 }))).toContain('還沒有頻道')
  })

  it('開銷的順序：公帳 300、自有 500，付 600 → 公帳 0、自有 200', () => {
    const g = make({ open: true })
    pool(g, 'f_alpha', 300, 60)
    give(g, [{ op: 'channel.budget', pool: 'own', cred: 500 }])
    const ans = payFromBudget(g.state, 600)
    expect('changes' in ans).toBe(true)
    if (!('changes' in ans)) return
    expect(ans.paid).toEqual([{ pool: 'f_alpha', purse: 'cred', amount: 300 }, { pool: 'own', purse: 'cred', amount: 300 }])
    give(g, ans.changes)
    expect(poolOf(g, 'f_alpha').cred).toBe(0)
    expect(ch(g).budget.own).toEqual({ cred: 200, cash: 0 })
    // 付開銷不動可支領額度
    expect(poolOf(g, 'f_alpha').quota).toBe(60)
  })

  it('照金主加入的先後扣：先加入的公帳先扣完才輪到後面的', () => {
    const g = make({ open: true })
    effects(g, [SPONSOR_A, { ...SPONSOR_A, faction: 'f_beta' }])
    pool(g, 'f_beta', 100)
    pool(g, 'f_alpha', 100)
    const ans = payFromBudget(g.state, 150)
    if (!('changes' in ans)) throw new Error('應該付得出來')
    expect(ans.paid).toEqual([{ pool: 'f_alpha', purse: 'cred', amount: 100 }, { pool: 'f_beta', purse: 'cred', amount: 50 }])
  })

  it('只收一種錢的開銷：只收現金時公帳（帳戶）付不了，自有現金不夠就付不出來、狀態不變', () => {
    const g = make({ open: true })
    pool(g, 'f_alpha', 900)
    give(g, [{ op: 'channel.budget', pool: 'own', cred: 100, cash: 50 }])
    const before = JSON.stringify(g.state.ext.channel)
    const cash = payFromBudget(g.state, 80, { purse: 'cash' })
    expect(cash).toEqual({ block: '預算不夠：這筆只收現金（公帳是帳戶，付不了），自有資金的現金共有 50，要 80，還差 30。' })
    const cred = payFromBudget(g.state, 2000, { purse: 'cred' })
    expect('block' in cred && cred.block).toBe('預算不夠：這筆只收帳戶，公帳加自有資金的帳戶共有 1,000，要 2,000，還差 1,000。')
    expect(JSON.stringify(g.state.ext.channel)).toBe(before)
    // 夠的時候：只收現金就只扣自有的現金
    const ok = payFromBudget(g.state, 50, { purse: 'cash' })
    expect('changes' in ok && ok.changes).toEqual([{ op: 'channel.budget', pool: 'own', cash: -50 }])
  })

  it('沒寫錢的種類時自有的帳戶先、現金後；付 0 是空的變更；沒頻道付不了；格子不會被扣成負的', () => {
    const g = make({ open: true })
    give(g, [{ op: 'channel.budget', pool: 'own', cred: 100, cash: 100 }])
    const ans = payFromBudget(g.state, 150)
    expect('paid' in ans && ans.paid).toEqual([{ pool: 'own', purse: 'cred', amount: 100 }, { pool: 'own', purse: 'cash', amount: 50 }])
    expect(payFromBudget(g.state, 0)).toEqual({ changes: [], paid: [] })
    expect('block' in payFromBudget(make().state, 5)).toBe(true)
    // 直接扣超過的變更整份不收
    expect(() => give(g, [{ op: 'channel.budget', pool: 'own', cred: -101 }])).toThrow()
    expect(ch(g).budget.own.cred).toBe(100)
  })
})

// ===================================================================================================================
describe('預算：拿出來（MEDIA 4.2）', () => {
  it('自有資金沒有代價：帳戶拿進帳戶、現金拿進現金', () => {
    const g = make({ open: true, cred: 0, cash: 0 })
    give(g, [{ op: 'channel.budget', pool: 'own', cred: 500, cash: 200 }])
    g.commit(withdraw(g.k, g.state, { pool: 'own', amount: 300 }))
    g.commit(withdraw(g.k, g.state, { pool: 'own', amount: 200, purse: 'cash' }))
    expect(g.state.money).toEqual({ cred: 300, cash: 200 })
    expect(ch(g).budget.own).toEqual({ cred: 200, cash: 0 })
    expect(meterOf(g.k, g.state, 'favor', 'f_alpha')).toBe(10)
  })

  it('額度 400 時拿 300 沒有代價、額度剩 100；再拿 700（超過 600）→ 好感 −1、敵對值 +1', () => {
    const g = make({ open: true, cred: 0 })
    pool(g, 'f_alpha', 2000, 400)
    g.commit(withdraw(g.k, g.state, { pool: 'f_alpha', amount: 300 }))
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 1700, quota: 100 })
    expect(g.state.money.cred).toBe(300)
    expect([meterOf(g.k, g.state, 'favor', 'f_alpha'), meterOf(g.k, g.state, 'hostility', 'f_alpha')]).toEqual([10, 0])

    const preview = withdrawPreview(g.k, g.state, { pool: 'f_alpha', amount: 700 })
    expect(preview).toMatchObject({ ok: true, free: 100, over: 600, steps: 1, favor: -1, hostility: 1, faction: 'f_alpha', quota_before: 100, quota_after: 0 })
    const draft = withdraw(g.k, g.state, { pool: 'f_alpha', amount: 700 })
    // 預覽和實際一樣：實際的變更就是預覽說的那幾筆
    expect(draft.changes).toEqual(expect.arrayContaining([
      { op: 'channel.budget', pool: 'f_alpha', cred: -700, quota: -100 },
      { op: 'cred', delta: 700 },
      { op: 'meter', kind: 'favor', key: 'f_alpha', delta: preview.favor },
      { op: 'meter', kind: 'hostility', key: 'f_alpha', delta: preview.hostility },
    ]))
    g.commit(draft)
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 1000, quota: 0 })
    expect(g.state.money.cred).toBe(1000)
    expect([meterOf(g.k, g.state, 'favor', 'f_alpha'), meterOf(g.k, g.state, 'hostility', 'f_alpha')]).toEqual([9, 1])
  })

  it('超過額度的部分每滿 500 才算一次：499 不算、500 算一次、1,000 算兩次', () => {
    const cases: Array<[number, number]> = [[499, 0], [500, 1], [999, 1], [1000, 2]]
    for (const [over, steps] of cases) {
      const g = make({ open: true })
      pool(g, 'f_beta', 5000, 0)
      const p = withdrawPreview(g.k, g.state, { pool: 'f_beta', amount: over })
      expect(p.steps, `${over}`).toBe(steps)
      g.commit(withdraw(g.k, g.state, { pool: 'f_beta', amount: over }))
      expect(meterOf(g.k, g.state, 'hostility', 'f_beta')).toBe(steps)
      expect(meterOf(g.k, g.state, 'favor', 'f_beta')).toBe(10 - steps)
    }
  })

  it('好感與敵對值沒有人定義（security 沒裝）：照拿，只是沒有那兩筆', () => {
    const g = make({ open: true, bare: true, cred: 0 })
    pool(g, 'f_alpha', 2000, 0)
    const draft = withdraw(g.k, g.state, { pool: 'f_alpha', amount: 1000 })
    expect(draft.changes.some((c) => c.op === 'meter')).toBe(false)
    g.commit(draft)
    expect(g.state.money.cred).toBe(1000)
  })

  it('擋下的原因都是完整的一句：公帳不夠、公帳沒有現金、沒有這一格、沒頻道、數字不對', () => {
    const g = make({ open: true })
    pool(g, 'f_alpha', 100, 100)
    expect(reasonOf(() => withdraw(g.k, g.state, { pool: 'f_alpha', amount: 101 }))).toBe('阿爾法的公帳只有 100，拿不了 101。')
    expect(reasonOf(() => withdraw(g.k, g.state, { pool: 'f_alpha', amount: 10, purse: 'cash' }))).toBe('阿爾法的公帳只有帳戶，拿不了現金。')
    expect(reasonOf(() => withdraw(g.k, g.state, { pool: 'f_beta', amount: 10 }))).toBe('貝塔的公帳只有 0，拿不了 10。')
    expect(reasonOf(() => withdraw(g.k, g.state, { pool: 'own', amount: 10 }))).toBe('自有資金的帳戶只有 0，拿不了 10。')
    expect(reasonOf(() => withdraw(g.k, g.state, { pool: 'own', amount: 0 }))).toContain('1 以上的整數')
    expect(reasonOf(() => withdraw(make().k, make().state, { pool: 'own', amount: 1 }))).toContain('還沒有頻道')
  })
})

// ===================================================================================================================
describe('贊助（MEDIA 4.2；V19）', () => {
  it('效果 sponsor：帶來一份贊助，倒數是 every_weeks；同一個勢力再來一份是換成新的', () => {
    const g = make({ open: true })
    effects(g, [{ ...SPONSOR_A, every_weeks: 2, plug_every: 3, plug_pay: 500, no_report: { faction: 'f_beta' }, tiers_off: ['adult'] }])
    expect(ch(g).sponsors).toHaveLength(1)
    expect(ch(g).sponsors[0]).toMatchObject({ faction: 'f_alpha', every_weeks: 2, amount: 3000, plug_every: 3, plug_pay: 500, no_report: { faction: 'f_beta' }, tiers_off: ['adult'], weeks_left_to_pay: 2, eps_since_plug: 0 })
    effects(g, [{ ...SPONSOR_A, amount: 5000 }])
    expect(ch(g).sponsors).toHaveLength(1)
    expect(ch(g).sponsors[0]).toMatchObject({ amount: 5000, every_weeks: 1, weeks_left_to_pay: 1 })
    expect(ch(g).sponsors[0]!.plug_every).toBeUndefined()
  })

  it('每週撥款 3,000 → 公帳 +3,000、額度 +600；每 2 週一次的第一週只倒數', () => {
    const g = make({ open: true })
    effects(g, [SPONSOR_A, { kind: 'sponsor', faction: 'f_beta', every_weeks: 2, amount: 1000 }])
    goTo(g, 8)
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 3000, quota: 600 })
    expect(poolOf(g, 'f_beta')).toEqual({ cred: 0, quota: 0 })
    expect(ch(g).sponsors.map((s) => s.weeks_left_to_pay)).toEqual([1, 1])
    goTo(g, 15)
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 6000, quota: 1200 })
    expect(poolOf(g, 'f_beta')).toEqual({ cred: 1000, quota: 200 })
    expect(weeklies(g).at(-1)!.narration!.results!.join()).toContain('貝塔的贊助撥來 1,000')
  })

  it('終止：那個勢力公帳剩的錢收回、額度歸零；贊助不見；錢不進主角的口袋；沒有的勢力被擋', () => {
    const g = make({ open: true, cred: 0 })
    effects(g, [SPONSOR_A, { ...SPONSOR_A, faction: 'f_beta' }])
    goTo(g, 8)
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 3000, quota: 600 })
    const r = g.commit(endSponsor(g.k, g.state, 'f_alpha'))[0]!
    expect(r.action).toBe('channel.sponsor_end')
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 0, quota: 0 })
    expect(ch(g).sponsors.map((s) => s.faction)).toEqual(['f_beta'])
    expect(poolOf(g, 'f_beta')).toEqual({ cred: 3000, quota: 600 })
    expect(g.state.money.cred).toBe(0)
    expect(reasonOf(() => endSponsor(g.k, g.state, 'f_alpha'))).toBe('這個勢力沒有在贊助你的頻道。')
  })

  it('沒有頻道時 sponsor、aired、channel_fund 整筆拿掉並提醒；格式不對整批不收', () => {
    const g = make()
    for (const e of [SPONSOR_A, { kind: 'aired', what: 'show' }, { kind: 'channel_fund', pool: 'own', amount: 100 }]) {
      const r = g.k.effects.resolve([e], effectCtx(g.k, g.state, { source: 'builtin' }))
      expect(r.errors).toEqual([])
      expect(r.changes).toEqual([])
      expect(r.clamps[0]!.notice).toBe('你還沒有頻道，這一筆沒有算。')
    }
    const bad = g.k.effects.resolve([{ ...SPONSOR_A, faction: 'nope' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(bad.errors.join()).toContain('查不到勢力 nope')
    expect(g.k.effects.resolve([{ ...SPONSOR_A, every_weeks: 0 }], effectCtx(g.k, g.state, { source: 'builtin' })).errors.join()).toContain('every_weeks')
    expect(g.k.effects.resolve([{ ...SPONSOR_A, amount: 1.5 }], effectCtx(g.k, g.state, { source: 'builtin' })).errors.join()).toContain('amount')
  })

  it('條件 has_sponsor：誰的、業配該掛了沒有（離上次掛的集數滿 plug_every）', () => {
    const g = make({ open: true })
    const ctx = (): never => ({ state: g.state, k: g.k }) as never
    expect(g.k.conditions.test({ kind: 'has_sponsor' }, ctx())).toBe(false)
    effects(g, [{ ...SPONSOR_A, plug_every: 2 }, { ...SPONSOR_A, faction: 'f_beta' }])
    expect(g.k.conditions.test({ kind: 'has_sponsor' }, ctx())).toBe(true)
    expect(g.k.conditions.test({ kind: 'has_sponsor', faction: 'f_beta' }, ctx())).toBe(true)
    expect(g.k.conditions.test({ kind: 'has_sponsor', plug_due: true }, ctx())).toBe(false)
    give(g, [{ op: 'channel.sponsor_set', faction: 'f_alpha', eps_since_plug: 2 }])
    expect(g.k.conditions.test({ kind: 'has_sponsor', plug_due: true }, ctx())).toBe(true)
    // 沒寫 plug_every 的贊助不要求掛業配
    expect(g.k.conditions.test({ kind: 'has_sponsor', faction: 'f_beta', plug_due: true }, ctx())).toBe(false)
    expect(g.k.conditions.explain({ kind: 'has_sponsor', faction: 'f_beta', plug_due: true }, ctx())).toContain('要有貝塔的金主，而且該掛它的業配了')
    const view = channelView(g.k, g.state) as Extract<ReturnType<typeof channelView>, { open: true }>
    expect(view.sponsors[0]).toMatchObject({ faction: 'f_alpha', plug: { every: 2, since_last: 2, due: true }, weeks_left: 1 })
    expect(view.sponsors[1]!.plug).toBeNull()
  })

  it('effect channel_fund：撥款進自有或勢力的公帳（勢力的額度跟著加）、罰款扣到 0 為止、公帳不能選現金', () => {
    const g = make({ open: true })
    effects(g, [{ kind: 'channel_fund', pool: 'own', amount: 300 }, { kind: 'channel_fund', pool: 'own', amount: 70, purse: 'cash' }, { kind: 'channel_fund', pool: 'f_alpha', amount: 1000 }])
    expect(ch(g).budget.own).toEqual({ cred: 300, cash: 70 })
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 1000, quota: 200 })
    effects(g, [{ kind: 'channel_fund', pool: 'own', amount: -1000 }, { kind: 'channel_fund', pool: 'own', amount: -500, purse: 'cash' }, { kind: 'channel_fund', pool: 'f_alpha', amount: -400 }])
    expect(ch(g).budget.own).toEqual({ cred: 0, cash: 0 })
    expect(poolOf(g, 'f_alpha')).toEqual({ cred: 600, quota: 200 })
    // 已經是 0 的再罰：整筆拿掉
    const none = g.k.effects.resolve([{ kind: 'channel_fund', pool: 'own', amount: -5 }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(none.changes).toEqual([])
    expect(g.k.effects.resolve([{ kind: 'channel_fund', pool: 'f_alpha', amount: 5, purse: 'cash' }], effectCtx(g.k, g.state, { source: 'builtin' })).errors.join()).toContain('只有帳戶')
    expect(g.k.effects.resolve([{ kind: 'channel_fund', pool: 'f_alpha', amount: 0 }], effectCtx(g.k, g.state, { source: 'builtin' })).errors.join()).toContain('不為 0')
  })
})

// ===================================================================================================================
describe('每週結算（MEDIA 4.8；V12、V13、V15、V16）', () => {
  it('流失：沒開過是 5%，開過節目是 2%（aired show）、開過直播也是 2%（aired live）', () => {
    const idle = make({ open: true })
    setMeter(idle, 'subs', 1000)
    goTo(idle, 8)
    expect(subsOf(idle)).toBe(950)

    const show = make({ open: true })
    setMeter(show, 'subs', 1000)
    effects(show, [{ kind: 'aired', what: 'show' }])
    expect(ch(show).week).toMatchObject({ episodes: 1, lives: 0 })
    goTo(show, 8)
    expect(subsOf(show)).toBe(980)
    expect(ch(show).week).toEqual({ episodes: 0, lives: 0, adult_reco: false })

    const live = make({ open: true })
    setMeter(live, 'subs', 1000)
    effects(live, [{ kind: 'aired', what: 'live' }])
    goTo(live, 8)
    expect(subsOf(live)).toBe(980)
  })

  it('推薦權重 +2 的那一週訂閱多 2%、結算之後變 +1；−2 的那一週多流失 2%、之後變 −1', () => {
    const base = make({ open: true })
    setMeter(base, 'subs', 1000)
    goTo(base, 8)
    const plain = subsOf(base)
    const up = make({ open: true })
    setMeter(up, 'subs', 1000)
    setMeter(up, 'reco', 2)
    goTo(up, 8)
    expect(subsOf(up) - plain).toBe(20)
    expect(recoOf(up)).toBe(1)
    const down = make({ open: true })
    setMeter(down, 'subs', 1000)
    setMeter(down, 'reco', -2)
    goTo(down, 8)
    expect(plain - subsOf(down)).toBe(20)
    expect(recoOf(down)).toBe(-1)
    // 再一週：+1 → 0，之後不動
    goTo(up, 15)
    expect(recoOf(up)).toBe(0)
    goTo(up, 22)
    expect(recoOf(up)).toBe(0)
  })

  it('一次跨過兩個週一結兩次（兩份報告，第二週照第一週結完的訂閱算）；第一週的計數只算在第一週', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 1000)
    effects(g, [{ kind: 'aired', what: 'show' }])
    goTo(g, 15)
    expect(weeklies(g)).toHaveLength(2)
    // 第一週 2%：1000 → 980；第二週一集都沒開 5%：980 → 931
    expect(subsOf(g)).toBe(931)
    expect(ch(g).week).toEqual({ episodes: 0, lives: 0, adult_reco: false })
  })

  it('報告是 downtime、action channel.weekly，帶觸發點 channel_week（這一週開了幾集、訂閱、公信力）', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 1000)
    setMeter(g, 'credibility', 64)
    effects(g, [{ kind: 'aired', what: 'show' }, { kind: 'aired', what: 'show' }, { kind: 'aired', what: 'live' }])
    goTo(g, 8)
    const r = weeklies(g)[0]!
    expect(r.kind).toBe('downtime')
    expect(r.triggers).toEqual([{ point: 'channel_week', where: { episodes: 2, lives: 1, subs: 980, credibility: 64 } }])
    expect(r.outcome.summary).toContain('訂閱 1,000 → 980')
    expect(r.narration!.results!.join()).toContain('流失了 20 位訂閱')
  })

  it('沒開頻道什麼都不做；開了之後只結開了之後的週一', () => {
    const g = make()
    goTo(g, 15)
    expect(weeklies(g)).toHaveLength(0)
    expect(readChannel(g.state).open).toBe(false)
    g.commit(openChannel(g.k, g.state, '晚開'))
    goTo(g, 16)
    expect(weeklies(g)).toHaveLength(0)
    goTo(g, 22)
    expect(weeklies(g)).toHaveLength(1)
  })

  it('人在委託副本裡跨過週一：先不結；出來之後的下一次時間往前走才結（把所有跨過的週一補結）', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 1000)
    give(g, [{ op: 'flag', key: 'in_run', value: true }])
    goTo(g, 15)
    expect(weeklies(g)).toHaveLength(0)
    expect(subsOf(g)).toBe(1000)
    give(g, [{ op: 'flag', key: 'in_run', value: false }])
    expect(weeklies(g)).toHaveLength(0)
    advance(g, 10)
    expect(weeklies(g)).toHaveLength(2)
    expect(subsOf(g)).toBe(1000 - 50 - 47)
    advance(g, 10)
    expect(weeklies(g)).toHaveLength(2)
  })

  it('只看 commission：潛入裡跨過週一照常結', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 1000)
    give(g, [{ op: 'flag', key: 'in_dive', value: true }])
    goTo(g, 8)
    expect(weeklies(g)).toHaveLength(1)
    expect(subsOf(g)).toBe(950)
  })

  it('訂閱很少時往 0 的方向取整：25 人沒開的那一週流失 1 人（25 × 5% = 1.25）、推薦權重 +3 多 0 人（25 × 3% = 0.75）', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 25)
    setMeter(g, 'reco', 3)
    goTo(g, 8)
    expect(subsOf(g)).toBe(24)
    const h = make({ open: true })
    setMeter(h, 'subs', 25)
    setMeter(h, 'reco', -3)
    goTo(h, 8)
    expect(subsOf(h)).toBe(24)
  })

  it('規則表蓋掉預設：流失、成長的百分比、門檻、新頻道的訂閱', () => {
    const pack: ContentPack = { id: 'ch_rule', content: { channel_rule: [{ id: 'default', churn: { active: 1, idle: 10 }, reco_growth: 5, start_subs: 250, level_at: [500, 5000] }] } as never }
    const g = make({ packs: [pack] })
    g.commit(openChannel(g.k, g.state, 'R'))
    expect(subsOf(g)).toBe(250)
    expect(channelRules(g.k)).toMatchObject({ churn: { active: 1, idle: 10 }, reco_growth: 5, level_at: [500, 5000], over_step: 500 })
    expect(channelLevel(g.k, g.state)).toBe(1)
    setMeter(g, 'subs', 500)
    expect(channelLevel(g.k, g.state)).toBe(2)
    setMeter(g, 'subs', 1000)
    goTo(g, 8)
    expect(subsOf(g)).toBe(900)
  })

  it('規則表的格式檢查：寫壞的欄位有原因，預設值沒有問題', () => {
    expect(ruleProblems({ ...DEFAULT_CHANNEL_RULES })).toEqual([])
    expect(ruleProblems({ churn: { active: 120 }, level_at: [10, 5], over_step: 0, quota_pct: -1, name_max: 'x', ai_subs: { pct: 'a' } })).toHaveLength(6)
  })
})

// ===================================================================================================================
describe('直播收播的接口（activity.end，kind live）', () => {
  const liveEnd = (g: G, result: Rec = {}) => {
    const end = endActivity(g.k, { state: g.state, kind: 'live', id: 'lv1', origin: { by: 'test' }, outcome: 'done', result })
    g.commit(attachActivityEnd(sys([...end.changes], 'live.end'), end))
  }

  it('這一週算開過、log 多一筆；訂閱與打賞不在這裡重算', () => {
    const g = make({ open: true })
    setMeter(g, 'subs', 1000)
    liveEnd(g, { mode: 'slot', heat: 12, subs: 72, tips: 96, tier: 2 })
    expect(ch(g).week).toMatchObject({ lives: 1, episodes: 0 })
    expect(ch(g).log).toHaveLength(1)
    expect(ch(g).log[0]).toMatchObject({ kind: 'live', subs: 72, tips: 96, heat: 12, tier: 2, note: '一場時段直播。' })
    expect(subsOf(g)).toBe(1000)
    expect(g.state.money).toEqual({ cred: 5000, cash: 2000 })
    // 這一週開過：流失 2%
    goTo(g, 8)
    expect(subsOf(g)).toBe(980)
  })

  it('to_channel: false 的（內場直播）不算開過、不記；沒頻道不記；別種活動不理', () => {
    const g = make({ open: true })
    liveEnd(g, { to_channel: false, subs: 5 })
    expect(ch(g).week.lives).toBe(0)
    expect(ch(g).log).toHaveLength(0)
    const none = make()
    liveEnd(none, {})
    expect(readChannel(none.state).log).toHaveLength(0)
    const end = endActivity(g.k, { state: g.state, kind: 'battle', id: 'b1', origin: { by: 'test' }, outcome: 'win', result: {} })
    expect(end.changes).toEqual([])
  })

  it('log 只留最近十筆（舊的先掉）；缺欄位的結果用 0 與預設的說明', () => {
    const g = make({ open: true })
    for (let i = 0; i < 12; i++) liveEnd(g, { subs: i })
    const log = ch(g).log
    expect(log).toHaveLength(10)
    expect(log.map((e) => e.subs)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(log[0]).toMatchObject({ tips: 0, note: '一場活動直播。' })
    expect(ch(g).week.lives).toBe(12)
    const v = channelView(g.k, g.state) as Extract<ReturnType<typeof channelView>, { open: true }>
    expect(v.recent[0]!.subs).toBe(11)
    expect(v.week).toEqual({ episodes: 0, lives: 12 })
  })
})

// ===================================================================================================================
describe('AI 的來源（EVENTS 2.4；0020 第十三節的量表表）', () => {
  const ai = (g: G, e: Rec) => g.k.effects.resolve([e], effectCtx(g.k, g.state, { source: 'ai' }))

  it('公信力 +9 被夾到 +5、−9 夾到 −5；推薦權重 +3 夾到 +1；內建的照寫', () => {
    const g = make({ open: true })
    expect(ai(g, { kind: 'credibility', amount: 9 }).changes).toEqual([{ op: 'meter', kind: 'credibility', key: '_', delta: 5 }])
    expect(ai(g, { kind: 'credibility', amount: -9 }).changes).toEqual([{ op: 'meter', kind: 'credibility', key: '_', delta: -5 }])
    expect(ai(g, { kind: 'reco', amount: 3 }).changes).toEqual([{ op: 'meter', kind: 'reco', key: '_', delta: 1 }])
    expect(ai(g, { kind: 'credibility', amount: 9 }).clamps[0]).toMatchObject({ from: 9, to: 5 })
    effects(g, [{ kind: 'credibility', amount: 9 }, { kind: 'reco', amount: 3 }])
    expect([credOf(g), recoOf(g)]).toEqual([59, 3])
  })

  it('訂閱：上限是現值的 2%（最少 20）：100 人 +50 → +20、1,000 人 +50 → +20、5,000 人 +300 → +100；往下也一樣；拆成幾筆合計也夾', () => {
    const g = make({ open: true })
    expect(ai(g, { kind: 'subs', amount: 50 }).changes).toEqual([{ op: 'meter', kind: 'subs', key: '_', delta: 20 }])
    setMeter(g, 'subs', 1000)
    expect(ai(g, { kind: 'subs', amount: 50 }).changes).toEqual([{ op: 'meter', kind: 'subs', key: '_', delta: 20 }])
    setMeter(g, 'subs', 5000)
    const big = ai(g, { kind: 'subs', amount: 300 })
    expect(big.changes).toEqual([{ op: 'meter', kind: 'subs', key: '_', delta: 100 }])
    expect(big.clamps[0]!.notice).toBe('一次最多讓訂閱增加 100 位，實際增加了 100 位。')
    expect(ai(g, { kind: 'subs', amount: -300 }).changes).toEqual([{ op: 'meter', kind: 'subs', key: '_', delta: -100 }])
    const split = g.k.effects.resolve([{ kind: 'subs', amount: 80 }, { kind: 'subs', amount: 80 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(split.changes).toEqual([{ op: 'meter', kind: 'subs', key: '_', delta: 80 }, { op: 'meter', kind: 'subs', key: '_', delta: 20 }])
    // 內建的不夾
    effects(g, [{ kind: 'subs', amount: 3000 }])
    expect(subsOf(g)).toBe(8000)
  })

  it('沒有頻道：AI 給訂閱、推薦權重整筆拿掉並說原因（公信力照常，輿論戰沒有頻道也用得到）；內建的照寫', () => {
    const g = make()
    const subs = ai(g, { kind: 'subs', amount: 30 })
    expect(subs.changes).toEqual([])
    expect(subs.clamps[0]!.notice).toBe('「訂閱」這一筆沒有算：還沒有開頻道。')
    expect(ai(g, { kind: 'reco', amount: 1 }).changes).toEqual([])
    expect(ai(g, { kind: 'credibility', amount: 3 }).changes).toEqual([{ op: 'meter', kind: 'credibility', key: '_', delta: 3 }])
    effects(g, [{ kind: 'subs', amount: 30 }])
    expect(subsOf(g)).toBe(30)
  })

  it('aired、channel_fund、sponsor 不在 AI 的封閉清單裡（AI 與玩家要的結果整批不收）；量表的三個在', () => {
    const g = make({ open: true })
    const aiKinds = g.k.effects.aiKinds()
    for (const kind of ['aired', 'channel_fund', 'sponsor']) {
      expect(aiKinds).not.toContain(kind)
      expect(g.k.effects.kinds()).toContain(kind)
    }
    expect(aiKinds).toEqual(expect.arrayContaining(['subs', 'credibility', 'reco']))
    for (const source of ['ai', 'player'] as const) {
      const r = g.k.effects.resolve([{ kind: 'channel_fund', pool: 'own', amount: 999 }], effectCtx(g.k, g.state, { source, clampAsked: false }))
      expect(r.errors.join()).toContain('不是 AI 與玩家要的結果可以用的效果')
    }
  })
})

// ===================================================================================================================
describe('只裝這個功能（沒有別的功能）', () => {
  it('不裝好感、敵對值、flow_tier、commission：開頻道、補貼、每週結算、拿錢全部照樣跑', () => {
    const { game: g } = makeGame({ features: [channelFeature], content: [METER_CONTENT], patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 1000, cash: 0 } } })
    g.commit(openChannel(g.k, g.state, '單機'))
    g.commit(fund(g.k, g.state, { purse: 'cred', amount: 500 }))
    goTo(g as unknown as G, 8)
    expect(weeklies(g as unknown as G)).toHaveLength(1)
    g.commit(withdraw(g.k, g.state, { pool: 'own', amount: 500 }))
    expect(g.state.money.cred).toBe(1000)
    expect(g.k.stats.hasStat('flow_tier')).toBe(false)
  })

  it('原始碼只 import 核心與自己的檔案（不 import 別的功能、不碰別的功能的 state.ext）', () => {
    const dir = join(fileURLToPath(new URL('../../src/features/channel', import.meta.url)))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/from '(\.[^']*)'/g)) expect(m[1], `${f}`).toMatch(/^(\.\.\/\.\.\/core|\.\/[a-z]+)$/)
      // 去掉註解之後，碰 ext 的只有 [EXT] 這一個鍵（自己的）；例外：角色的 ext.paths（路數與階數，0020 第十三節「共用的資料慣例」，只在 staff.ts 讀）
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const m of code.matchAll(/\.ext\??(\.[a-z_]+|\[[^\]]*\])/g)) expect(m[1], f).toBe(m[1] === '.paths' && f === 'staff.ts' ? '.paths' : '[EXT]')
    }
  })
})
