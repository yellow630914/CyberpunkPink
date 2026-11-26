// 驗收測試：dev/work/M2-bills.md（cpp-feature）。規格：FIXER 第 4 節；DOWNTIME 第 5 節；EVENTS 2.2、2.4 節；BALANCE 7.4 節；UI 3.10 節；dev/adr/0016 第六、七節與 G3。
// 內容一律用測試自帶的最小假資料：帳單的項目由測試自己掛在 bill.collect 上（替身 collectStub，內容是 box.lines）；敵對值是 security 的量表，
// 測試用 testkit 的 meterFeature 借一個；副本是 commission 的活動，測試用一個叫 commission 的替身活動（旗標 in_run 決定它在不在進行）。
// 名冊的薪水用真的 roster 功能接（weeklyPay → bill.collect、bill.settled → 忠誠 −8），同一份檔也驗 roster 回答 defeat.companions。
//
// 時間：測試從第 3 天 10:00 開始；第 7、14、21 天的 06:00 是週一（第 1、2、3 週）；週日 20:00 是第 6 天 20:00。
// 工單的「收入 200、三項各 150、帳戶 250」加起來剛好 450 全付得起，和「第三項沒付」對不上：這裡照「先加收入再逐項扣、錢不夠就停」的意思，
// 帳戶改 240（先變 440，付兩項剩 140，第三項 150 付不起）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Report, ReportDraft } from '../../src'
import { ActionBlocked, clone, effectCtx, meterOf, toMinutes } from '../../src'
import type { BillLine, SettledLine } from '../../src/features/bills'
import {
  DEFAULT_BILL_RULES, billPreview, billRules, billsFeature, currentLines, overdueWeeks, readBills, setBill,
} from '../../src/features/bills'
import { companionNames } from '../../src/features/defeat'
import { join, muster, rosterFeature, rosterRules, setPay } from '../../src/features/roster'
import { makeActor, makeGame, meterFeature, METER_CONTENT, observed, testMeter } from '../../src/testkit'

// ---- 替身 ----

type Rec = Record<string, unknown>
interface Box {
  lines: BillLine[]
  /** bill.settled 收到的每一次 */
  settled: Array<{ week: number; lines: SettledLine[] }>
  /** bill.collect 被問的每一次：週數與當時看到的帳戶 */
  asked: Array<{ week: number; cred: number }>
}

const collectStub = (box: Box): Feature => ({
  id: 'collect_stub',
  install(k) {
    k.hooks.on('bill.collect', 'collect_stub', ({ state, week }) => {
      box.asked.push({ week, cred: state.money.cred })
      return clone(box.lines)
    })
    k.hooks.on('bill.settled', 'collect_stub', ({ week, lines }) => {
      box.settled.push({ week, lines: clone(lines) })
    })
  },
})

/** 副本：旗標 in_run 在的時候進行中（放行 test. 開頭的行動，其餘擋掉，和白名單的做法一樣）。 */
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

const RUNNER = { paths: [{ path: 'p_gun', slot: 'main', tier: 2 }] }
const ROSTER_ACTORS = [
  makeActor({ id: 'r_ann', name: '安', role: 'npc', ext: RUNNER }),
  makeActor({ id: 'r_bob', name: '鮑', role: 'npc', ext: RUNNER }),
  makeActor({ id: 'c_bob', name: '街坊鮑勃', role: 'npc' }),
]

const content = (rule: Rec = {}): ContentPack => ({
  id: 'bills_test',
  content: { bill_rule: [{ id: 'default', debt_faction: 'f_alpha', debt_rate: 0.1, ...rule }] } as unknown as ContentPack['content'],
})

interface Opts {
  cred?: number
  cash?: number
  mult?: number
  rule?: Rec
  roster?: boolean
  commission?: boolean
  seed?: number
  lines?: BillLine[]
  packs?: ContentPack[]
}

const line = (id: string, amount: number, o: Partial<BillLine> = {}): BillLine => ({ id, owner: 'collect_stub', name: id, kind: 'due', amount, order: 1, pay: 'cred', ...o })
const income = (id: string, amount: number, o: Partial<BillLine> = {}): BillLine => line(id, amount, { kind: 'income', ...o })

const make = (o: Opts = {}) => {
  const box: Box = { lines: o.lines ?? [], settled: [], asked: [] }
  const features: Feature[] = [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), collectStub(box)]
  if (o.commission) features.push(COMMISSION_STUB)
  if (o.roster) features.push(rosterFeature)
  features.push(billsFeature)
  const { game } = makeGame({
    features, content: [METER_CONTENT, content(o.rule), ...(o.packs ?? [])], seed: o.seed ?? 7, actors: o.roster ? clone(ROSTER_ACTORS) : [],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: o.cred ?? 0, cash: o.cash ?? 0 } },
  })
  if (o.mult !== undefined) game.state.rules.billMult = o.mult
  return Object.assign(game, { box })
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const put = (g: G, changes: ReportDraft['changes']) => g.commit(draft(changes))
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const DAY = 1440
/** 走到某一天某個鐘點。 */
const goTo = (g: G, day: number, hour = 10, minute = 0) => advance(g, toMinutes({ day, hour, minute }) - toMinutes(g.state.time))
const settles = (g: G): Report[] => g.state.reports.filter((r) => r.action === 'bill.settle')
const cred = (g: G): number => g.state.money.cred
const cash = (g: G): number => g.state.money.cash
const beats = (r: Report) => (r.timeline ?? []).filter((b) => b.tag === 'bill.line').map((b) => b.data as Rec)
const give = (g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin') => {
  const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) put(g, r.changes)
  return r
}
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

// ---- 結算的時機 ----

describe('結算的時機：每跨過一個週一 06:00 一次', () => {
  it('跨過週一結一次；同一週再過時間不重複；沒到週一不結', () => {
    const g = make({ cred: 1000, lines: [line('rent', 100)] })
    goTo(g, 6, 12)
    expect(settles(g)).toHaveLength(0)
    expect(cred(g)).toBe(1000)
    goTo(g, 7, 7)
    expect(settles(g)).toHaveLength(1)
    expect(cred(g)).toBe(900)
    advance(g, 3 * DAY)
    advance(g, 60)
    expect(settles(g)).toHaveLength(1)
    expect(cred(g)).toBe(900)
    expect(g.box.settled.map((s) => s.week)).toEqual([1])
  })

  it('剛好走到週一 06:00 的那一刻就結；從 06:00 站著出發不再結', () => {
    const g = make({ cred: 1000, lines: [line('rent', 100)] })
    goTo(g, 7, 6, 0)
    expect(settles(g)).toHaveLength(1)
    advance(g, 30)
    expect(settles(g)).toHaveLength(1)
  })

  it('一次睡過兩個週一：結兩次、兩份報告，第二週看到的是第一週結完之後的帳戶', () => {
    const g = make({ cred: 1000, lines: [line('rent', 400)] })
    goTo(g, 14, 10)
    const rs = settles(g)
    expect(rs).toHaveLength(2)
    expect(cred(g)).toBe(200)
    expect(g.box.settled.map((s) => s.week)).toEqual([1, 2])
    expect(g.box.asked.map((a) => [a.week, a.cred])).toEqual([[1, 1000], [2, 600]])
  })

  it('一次睡過三個週一，第三週付不起：前兩週付了、第三週欠，欠繳 1 週', () => {
    const g = make({ cred: 1000, lines: [line('rent', 400)] })
    goTo(g, 21, 10)
    expect(settles(g).map((r) => r.outcome.result)).toEqual(['paid', 'paid', 'short'])
    expect(cred(g)).toBe(200)
    expect(overdueWeeks(g.state)).toBe(1)
  })

  it('沒有任何項目：不出報告、不留狀態', () => {
    const g = make()
    goTo(g, 21, 10)
    expect(settles(g)).toHaveLength(0)
    expect(g.state.ext.bills).toBeUndefined()
  })

  it('沒裝帳單的功能時（只有名冊）時間照常往前走', () => {
    const { game } = makeGame({ features: [rosterFeature], content: [METER_CONTENT], patch: { time: { day: 3, hour: 10, minute: 0 } } })
    expect(() => game.commit(draft([{ op: 'time', minutes: 30 * DAY }], 'test.wait'))).not.toThrow()
  })
})

// ---- 收與付 ----

describe('收入先入帳、再照順序扣款，錢不夠就停', () => {
  it('收入 200、三項各 150、帳戶 240：先變 440，付前兩項，第三項沒付，欠繳 1 週；bill.settled 收到每一項各付了多少', () => {
    const g = make({ cred: 240, lines: [line('a', 150, { order: 1 }), line('b', 150, { order: 2 }), line('c', 150, { order: 3 }), income('job', 200)] })
    goTo(g, 8)
    expect(cred(g)).toBe(140)
    expect(overdueWeeks(g.state)).toBe(1)
    const [r] = settles(g)
    expect(r!.kind).toBe('downtime')
    expect(r!.outcome.result).toBe('short')
    expect(r!.changes[0]).toEqual({ op: 'cred', delta: 200 })
    expect(beats(r!).map((d) => [d.id, d.paid, d.unpaid])).toEqual([['job', 200, 0], ['a', 150, 0], ['b', 150, 0], ['c', 0, 150]])
    const got = g.box.settled[0]!.lines
    expect(got.filter((l) => l.kind === 'due').map((l) => [l.id, l.paid, l.unpaid])).toEqual([['a', 150, 0], ['b', 150, 0], ['c', 0, 150]])
    expect(got.find((l) => l.id === 'job')).toMatchObject({ kind: 'income', paid: 200, unpaid: 0 })
    expect(r!.triggers).toEqual([{ point: 'weekly', where: { overdue: 1 } }])
  })

  it('收入先入帳：帳戶本來付不起，收入進來之後付得起；都付清欠繳 0', () => {
    const g = make({ cred: 50, lines: [line('rent', 150), income('job', 200)] })
    goTo(g, 8)
    expect(cred(g)).toBe(100)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(settles(g)[0]!.outcome.result).toBe('paid')
    expect(settles(g)[0]!.triggers).toEqual([{ point: 'weekly', where: { overdue: 0 } }])
  })

  it('照 order 付，不是照收集的順序；同一個 order 照收集的順序', () => {
    const g = make({ cred: 250, lines: [line('late', 100, { order: 9 }), line('first', 100, { order: 2 }), line('tie_a', 100, { order: 4 }), line('tie_b', 100, { order: 4 })] })
    goTo(g, 8)
    expect(g.box.settled[0]!.lines.map((l) => l.id)).toEqual(['first', 'tie_a', 'tie_b', 'late'])
    expect(g.box.settled[0]!.lines.map((l) => l.paid)).toEqual([100, 100, 0, 0])
  })

  it('錢不夠就停在那一項：後面更便宜、付得起的同一種錢也算沒付', () => {
    const g = make({ cred: 300, lines: [line('big', 400, { order: 1 }), line('small', 10, { order: 2 })] })
    goTo(g, 8)
    expect(cred(g)).toBe(300)
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.paid, l.unpaid])).toEqual([['big', 0, 400], ['small', 0, 10]])
  })

  it('帳戶與現金各停各的：現金不夠不擋後面扣帳戶的項目', () => {
    const g = make({ cred: 500, cash: 10, lines: [line('cash_item', 100, { order: 8, pay: 'cash' }), line('later', 100, { order: 9 })] })
    goTo(g, 8)
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.paid, l.unpaid])).toEqual([['cash_item', 0, 100], ['later', 100, 0]])
    expect(cred(g)).toBe(400)
    expect(cash(g)).toBe(10)
  })

  it('金額是 0 的項目：付了 0、不算欠', () => {
    const g = make({ cred: 0, lines: [line('free', 0)] })
    goTo(g, 8)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(g.box.settled[0]!.lines[0]).toMatchObject({ paid: 0, unpaid: 0 })
  })

  it('收入進現金：pay 是 cash 的收入入現金', () => {
    const g = make({ lines: [income('tips', 70, { pay: 'cash' })] })
    goTo(g, 8)
    expect(cash(g)).toBe(70)
    expect(cred(g)).toBe(0)
  })

  it('報告通過不變式（變更套用之後等於實際的變化）', async () => {
    const g = make({ cred: 240, lines: [line('a', 150), line('b', 150), income('job', 200)] })
    const { violations } = await observed(g, () => { goTo(g, 15) })
    expect(violations).toEqual([])
    expect(settles(g)).toHaveLength(2)
  })

  it('回傳格式不對的項目：丟錯，訊息寫出是誰', () => {
    const g = make({ lines: [{ ...line('bad', 10), order: 11 }] })
    expect(() => goTo(g, 8)).toThrow(/collect_stub.*order/)
    const dup = make({ lines: [line('x', 10), line('x', 20)] })
    expect(() => goTo(dup, 8)).toThrow(/重複/)
  })
})

// ---- 倍率 ----

describe('帳單倍率（和難度無關）', () => {
  it('倍率 0.5：應付的減半、收入不變', () => {
    const g = make({ cred: 1000, mult: 0.5, lines: [line('rent', 200), line('sub', 101, { order: 2 }), income('job', 300)] })
    goTo(g, 8)
    // 收入 300 不乘；200 → 100；101 → 50.5 四捨五入 51
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.amount, l.paid])).toEqual([['job', 300, 300], ['rent', 100, 100], ['sub', 51, 51]])
    expect(cred(g)).toBe(1000 + 300 - 100 - 51)
  })

  it('倍率 1.5 與 2：多收', () => {
    const g = make({ cred: 1000, mult: 1.5, lines: [line('rent', 200)] })
    goTo(g, 8)
    expect(cred(g)).toBe(700)
    expect(billPreview(g.k, g.state).mult).toBe(1.5)
  })

  it('倍率 0：只有收入入帳，沒有任何扣款、不算欠', () => {
    const g = make({ cred: 0, mult: 0, lines: [line('rent', 200), income('job', 120)] })
    goTo(g, 8)
    expect(cred(g)).toBe(120)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(g.box.settled[0]!.lines.filter((l) => l.kind === 'due').every((l) => l.paid === 0 && l.unpaid === 0)).toBe(true)
  })

  it('倍率 0 讓欠繳歸零（本來欠著、改成 0 之後下一週清掉）', () => {
    const g = make({ cred: 0, lines: [line('rent', 200)] })
    goTo(g, 8)
    expect(overdueWeeks(g.state)).toBe(1)
    g.state.rules.billMult = 0
    goTo(g, 15)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(g.state.flags.bill_overdue).toBeUndefined()
  })
})

// ---- 玩家的設定 ----

describe('玩家的設定：用現金付、這一項不付了', () => {
  it('either 的項目預設扣帳戶；設了用現金之後扣現金', () => {
    const g = make({ cred: 500, cash: 300, lines: [line('rent', 120, { pay: 'either' })] })
    goTo(g, 8)
    expect([cred(g), cash(g)]).toEqual([380, 300])
    const [r] = g.commit(setBill(g.k, g.state, 'rent', { cash: true }))
    expect(r!.action).toBe('bill.set')
    expect(readBills(g.state).cash).toEqual(['rent'])
    goTo(g, 15)
    expect([cred(g), cash(g)]).toEqual([380, 180])
    g.commit(setBill(g.k, g.state, 'rent', { cash: false }))
    goTo(g, 22)
    expect([cred(g), cash(g)]).toEqual([260, 180])
  })

  it('用現金付不夠時是欠，不會改去扣帳戶', () => {
    const g = make({ cred: 500, cash: 50, lines: [line('rent', 120, { pay: 'either' })] })
    g.commit(setBill(g.k, g.state, 'rent', { cash: true }))
    goTo(g, 8)
    expect([cred(g), cash(g)]).toEqual([500, 50])
    expect(overdueWeeks(g.state)).toBe(1)
  })

  it('這一項不付了：不扣、不算欠、報告寫明；後面的項目照常', () => {
    const g = make({ cred: 100, lines: [line('angel', 80, { order: 6 }), line('rent', 100, { order: 1 })] })
    g.commit(setBill(g.k, g.state, 'angel', { stopped: true }))
    goTo(g, 8)
    expect(cred(g)).toBe(0)
    expect(overdueWeeks(g.state)).toBe(0)
    const angel = g.box.settled[0]!.lines.find((l) => l.id === 'angel')!
    expect(angel).toMatchObject({ paid: 0, unpaid: 0, skipped: true })
    expect(beats(settles(g)[0]!).find((d) => d.id === 'angel')).toMatchObject({ skipped: true })
    // 恢復之後照常付（付不起就是欠）
    g.commit(setBill(g.k, g.state, 'angel', { stopped: false }))
    goTo(g, 15)
    expect(overdueWeeks(g.state)).toBe(1)
  })

  it('不成立的設定：沒有這一項、收入、不收現金的項目、什麼都沒設；原因是完整的句子', () => {
    const g = make({ lines: [line('rent', 100), income('job', 10)] })
    expect(reasonOf(() => setBill(g.k, g.state, 'nope', { stopped: true }))).toBe('這一週沒有「nope」這一項帳單。')
    expect(reasonOf(() => setBill(g.k, g.state, 'job', { stopped: true }))).toBe('job是收入，沒有什麼好設的。')
    expect(reasonOf(() => setBill(g.k, g.state, 'rent', { cash: true }))).toBe('rent不收現金，只能扣帳戶。')
    expect(reasonOf(() => setBill(g.k, g.state, 'rent', {}))).toBe('要設用現金付，或這一項不付了。')
  })

  it('人在副本裡不能改設定（白名單沒有放行 bill.）', () => {
    const g = make({ commission: true, lines: [line('rent', 100)] })
    put(g, [{ op: 'flag', key: 'in_run', value: true }])
    expect(() => g.commit(setBill(g.k, g.state, 'rent', { stopped: true }))).toThrow(ActionBlocked)
  })
})

// ---- 欠繳與下坡 ----

describe('連三週沒付清：第三週併成債、債主敵對值 +10；之後每週有利息；付清歸零', () => {
  const setup = () => make({ cred: 0, lines: [line('a', 100, { order: 1 }), line('b', 200, { order: 2 })] })

  it('第 1、2 週：欠繳週數累計、旗標與觸發點，沒有債', () => {
    const g = setup()
    goTo(g, 8)
    expect(overdueWeeks(g.state)).toBe(1)
    expect(g.state.flags).toMatchObject({ bill_overdue: 1, bill_step: 'lock' })
    expect(settles(g)[0]!.triggers).toEqual([{ point: 'weekly', where: { overdue: 1 } }])
    goTo(g, 15)
    expect(overdueWeeks(g.state)).toBe(2)
    expect(g.state.flags).toMatchObject({ bill_overdue: 2, bill_step: 'collector' })
    expect(readBills(g.state).debts).toEqual([])
    expect(readBills(g.state).arrears).toBe(600)
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(0)
  })

  it('第 3 週：所有欠款併成一筆債（債主是規則寫的勢力）、敵對值 +10、報告寫出來', () => {
    const g = setup()
    goTo(g, 22)
    expect(overdueWeeks(g.state)).toBe(3)
    expect(readBills(g.state).debts).toEqual([{ id: 'd1', to: 'f_alpha', principal: 900, rate: 0.1, pay: 'cred' }])
    expect(readBills(g.state).arrears).toBe(0)
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(10)
    expect(g.state.flags.bill_step).toBe('debt')
    const third = settles(g)[2]!
    expect(third.outcome.summary).toContain('併成了一筆 900 的債')
    expect(third.outcome.summary).toContain('阿爾法公司')
    expect(third.changes).toContainEqual({ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 10 })
  })

  it('第 4 週起：每週多一個利息的項目（order 5、扣債主指定的那種錢）；第 4 週只留旗標與觸發點', () => {
    const g = setup()
    goTo(g, 22)
    goTo(g, 29)
    expect(overdueWeeks(g.state)).toBe(4)
    expect(g.state.flags.bill_step).toBe('contract')
    expect(readBills(g.state).debts).toHaveLength(1)
    expect(meterOf(g.k, g.state, 'hostility', 'f_alpha')).toBe(10)
    const interest = g.box.settled[3]!.lines.find((l) => l.id === 'debt:d1')!
    expect(interest).toMatchObject({ name: '阿爾法公司的債息', order: 5, amount: 90, pay: 'cred', unpaid: 90 })
    // 順序：a(1)、b(2)、利息(5)
    expect(g.box.settled[3]!.lines.map((l) => l.id)).toEqual(['a', 'b', 'debt:d1'])
  })

  it('付清之後欠繳歸零、旗標拿掉；利息照樣每週收（債還在）', () => {
    const g = setup()
    goTo(g, 22)
    put(g, [{ op: 'cred', delta: 1000 }])
    goTo(g, 29)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(g.state.flags.bill_overdue).toBeUndefined()
    expect(g.state.flags.bill_step).toBeUndefined()
    expect(cred(g)).toBe(1000 - 100 - 200 - 90)
    expect(readBills(g.state).arrears).toBe(0)
    goTo(g, 36)
    expect(g.box.settled[4]!.lines.some((l) => l.id === 'debt:d1' && l.paid === 90)).toBe(true)
  })

  it('間隔付清：中間有一週付清，欠繳歸零重新數，不會第三週就併債', () => {
    const g = setup()
    goTo(g, 8)
    goTo(g, 15)
    put(g, [{ op: 'cred', delta: 300 }])
    goTo(g, 22)
    expect(overdueWeeks(g.state)).toBe(0)
    goTo(g, 29)
    goTo(g, 36)
    expect(overdueWeeks(g.state)).toBe(2)
    // 中間補清那一週，之前累積的欠款（600）沒補齊：併成一筆債（B039；使用者 2026-11-26），欠繳重新數、不會第三週又併一筆
    expect(readBills(g.state).debts).toHaveLength(1)
    expect(readBills(g.state).debts[0]).toMatchObject({ id: 'd1', principal: 600 })
  })

  it('規則可以蓋：債主、利率、第幾週併債、敵對值加多少、利息付現金', () => {
    const g = make({
      cred: 0, rule: { debt_week: 2, debt_faction: 'f_beta', debt_rates: { f_beta: 0.2 }, debt_pay: { f_beta: 'cash' }, debt_hostility: 7 },
      lines: [line('a', 100)],
    })
    goTo(g, 15)
    expect(readBills(g.state).debts).toEqual([{ id: 'd1', to: 'f_beta', principal: 200, rate: 0.2, pay: 'cash' }])
    expect(meterOf(g.k, g.state, 'hostility', 'f_beta')).toBe(7)
    goTo(g, 22)
    expect(g.box.settled[2]!.lines.find((l) => l.id === 'debt:d1')).toMatchObject({ pay: 'cash', amount: 40 })
  })

  it('沒有人定義敵對值（沒裝 security）：照樣併債，只是沒有敵對值的變更，不丟錯', () => {
    const box: Box = { lines: [line('a', 100)], settled: [], asked: [] }
    const { game } = makeGame({ features: [collectStub(box), billsFeature], content: [METER_CONTENT, content()], patch: { time: { day: 3, hour: 10, minute: 0 } } })
    expect(() => game.commit(draft([{ op: 'time', minutes: 20 * DAY }], 'test.wait'))).not.toThrow()
    expect(readBills(game.state).debts).toHaveLength(1)
    expect(game.state.meters.hostility).toBeUndefined()
  })

  it('規則：沒寫的欄位用內建的預設；資料裡的格式錯誤在載入時就擋下', () => {
    const g = make({ rule: { debt_week: 5 } })
    expect(billRules(g.k)).toEqual({ ...DEFAULT_BILL_RULES, debt_faction: 'f_alpha', debt_rate: 0.1, debt_week: 5 })
    for (const bad of [{ debt_week: 0 }, { debt_rate: 'x' }, { debt_pay: { a: 'gold' } }, { interest_order: 11 }, { debt_faction: '' }]) {
      expect(() => make({ rule: bad }), JSON.stringify(bad)).toThrow(/bill_rule\/default/)
    }
  })

  it('條件 bill_overdue：欠繳週數不少於 min（預設 1）', () => {
    const g = setup()
    expect(test(g, { kind: 'bill_overdue' })).toBe(false)
    goTo(g, 8)
    expect(test(g, { kind: 'bill_overdue' })).toBe(true)
    expect(test(g, { kind: 'bill_overdue', min: 2 })).toBe(false)
    goTo(g, 15)
    expect(test(g, { kind: 'bill_overdue', min: 2 })).toBe(true)
    expect(g.k.conditions.validate({ kind: 'bill_overdue', min: 0 }, 'c').length).toBeGreaterThan(0)
  })
})

// ---- 效果 ----

describe('效果 bill、grace、debt', () => {
  it('bill：AI 給的加到超過那一項金額的一半時被夾（連同這一週已經加的），減免也一樣；夾值有白話提醒；內建的照寫的算（EVENTS 2.4；B034）', () => {
    const builtin = make({ cred: 1000, lines: [line('rent', 150)] })
    const free = give(builtin, [{ kind: 'bill', item: 'rent', amount: 100 }])
    expect(free.effects).toEqual([{ kind: 'bill', item: 'rent', amount: 100 }])
    expect(free.clamps).toEqual([])
    const g = make({ cred: 1000, lines: [line('rent', 150)] })
    const r = give(g, [{ kind: 'bill', item: 'rent', amount: 100 }], 'ai')
    expect(r.effects).toEqual([{ kind: 'bill', item: 'rent', amount: 75 }])
    expect(r.clamps).toHaveLength(1)
    expect(r.clamps[0]!.notice).toContain('一半')
    expect(readBills(g.state).tweaks).toEqual({ rent: 75 })
    // 已經加滿，再加整筆拿掉
    const again = give(g, [{ kind: 'bill', item: 'rent', amount: 10 }], 'ai')
    expect(again.effects).toEqual([])
    expect(readBills(g.state).tweaks).toEqual({ rent: 75 })
    // 減免從 +75 走到 −75 最多 150
    const cut = give(g, [{ kind: 'bill', item: 'rent', amount: -500 }], 'ai')
    expect(cut.effects).toEqual([{ kind: 'bill', item: 'rent', amount: -150 }])
    expect(readBills(g.state).tweaks).toEqual({ rent: -75 })
  })

  it('bill：這一週的加減進結算（乘倍率之前），結算後清掉；沒有這一項、收入整筆拿掉', () => {
    const g = make({ cred: 1000, mult: 2, lines: [line('rent', 100), income('job', 10)] })
    give(g, [{ kind: 'bill', item: 'rent', amount: 30 }])
    expect(give(g, [{ kind: 'bill', item: 'nope', amount: 5 }]).effects).toEqual([])
    expect(give(g, [{ kind: 'bill', item: 'job', amount: 5 }]).effects).toEqual([])
    goTo(g, 8)
    expect(g.box.settled[0]!.lines.find((l) => l.id === 'rent')).toMatchObject({ amount: 260, paid: 260 })
    expect(readBills(g.state).tweaks).toEqual({})
    goTo(g, 15)
    expect(g.box.settled[1]!.lines.find((l) => l.id === 'rent')).toMatchObject({ amount: 200 })
  })

  it('bill：AI 給的減免可以把一項減到一半、預覽看得到', () => {
    const g = make({ cred: 1000, lines: [line('rent', 100)] })
    give(g, [{ kind: 'bill', item: 'rent', amount: -80 }], 'ai')
    expect(billPreview(g.k, g.state).lines.find((l) => l.id === 'rent')!.amount).toBe(50)
  })

  it('bill（新的項目）：照週數出現幾週就沒了；順序是第 7 項；扣的錢照 pay', () => {
    const g = make({ cred: 1000, cash: 500, lines: [line('rent', 100)] })
    give(g, [{ kind: 'bill', name: '保護費', amount: 50, weeks: 2, pay: 'cash' }])
    expect(readBills(g.state).extras).toEqual([{ id: 'x1', name: '保護費', amount: 50, weeks: 2, pay: 'cash' }])
    goTo(g, 8)
    goTo(g, 15)
    goTo(g, 22)
    const ids = g.box.settled.map((s) => s.lines.map((l) => l.id))
    expect(ids).toEqual([['rent', 'x1'], ['rent', 'x1'], ['rent']])
    expect(g.box.settled[0]!.lines[1]).toMatchObject({ name: '保護費', order: 7, pay: 'cash', paid: 50 })
    expect(cash(g)).toBe(400)
    expect(readBills(g.state).extras).toEqual([])
  })

  it('bill：格式錯誤整批不收（兩種寫法不能混、新項目要有名字與週數）', () => {
    const g = make({ lines: [line('rent', 100)] })
    const bad = (e: Rec): number => g.k.effects.resolve([e], effectCtx(g.k, g.state, { source: 'builtin' })).errors.length
    expect(bad({ kind: 'bill', item: 'rent', amount: 1.5 })).toBeGreaterThan(0)
    expect(bad({ kind: 'bill', item: 'rent', amount: 5, name: '混' })).toBeGreaterThan(0)
    expect(bad({ kind: 'bill', name: '保護費', amount: 50, weeks: 0, pay: 'cash' })).toBeGreaterThan(0)
    expect(bad({ kind: 'bill', name: '保護費', amount: 50, weeks: 2, pay: 'gold' })).toBeGreaterThan(0)
    expect(bad({ kind: 'bill', name: '', amount: 50, weeks: 2, pay: 'cash' })).toBeGreaterThan(0)
    expect(bad({ kind: 'bill', amount: 5 })).toBeGreaterThan(0)
  })

  it('grace：寬限的那一項這週不算欠（也不擋後面）；過期之後照常；AI 給的最多 7 天、內建的照寫的算（B034）', () => {
    const g = make({ cred: 100, lines: [line('rent', 150, { order: 1 }), line('sub', 60, { order: 2 })] })
    goTo(g, 6, 12)
    const r = give(g, [{ kind: 'grace', item: 'rent', days: 30 }], 'ai')
    expect(r.effects).toEqual([{ kind: 'grace', item: 'rent', days: 7 }])
    expect(r.clamps[0]!.notice).toContain('7')
    expect(readBills(g.state).grace).toEqual({ rent: toMinutes({ day: 13, hour: 12, minute: 0 }) })
    goTo(g, 7, 7)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.paid, l.unpaid, l.skipped ?? false])).toEqual([['rent', 0, 0, true], ['sub', 60, 0, false]])
    expect(cred(g)).toBe(40)
    // 第 13 天 12:00 到期：第 14 天的結算照常，欠了
    goTo(g, 14, 7)
    expect(g.box.settled[1]!.lines.find((l) => l.id === 'rent')).toMatchObject({ unpaid: 150 })
    expect(overdueWeeks(g.state)).toBe(1)
    expect(readBills(g.state).grace).toEqual({})
  })

  it('grace：只有付不起的那一項被寬限時，沒有別的欠就不累計', () => {
    const g = make({ cred: 0, lines: [line('rent', 150)] })
    give(g, [{ kind: 'grace', item: 'rent', days: 5 }])
    goTo(g, 7, 7)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(g.state.flags.bill_overdue).toBeUndefined()
  })

  it('debt：加一筆債，利息是第 5 項；債主要是內容裡的勢力；利息付哪種錢看規則', () => {
    const g = make({ cred: 1000, cash: 500, rule: { debt_pay: { f_beta: 'cash' } }, lines: [line('rent', 100)] })
    give(g, [{ kind: 'debt', to: 'f_beta', amount: 500, rate: 0.1 }])
    expect(readBills(g.state).debts).toEqual([{ id: 'd1', to: 'f_beta', principal: 500, rate: 0.1, pay: 'cash' }])
    goTo(g, 8)
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.order, l.pay, l.paid])).toEqual([['rent', 1, 'cred', 100], ['debt:d1', 5, 'cash', 50]])
    expect(cash(g)).toBe(450)
    const bad = (e: Rec): number => g.k.effects.resolve([e], effectCtx(g.k, g.state, { source: 'builtin' })).errors.length
    expect(bad({ kind: 'debt', to: 'nobody', amount: 5, rate: 0.1 })).toBeGreaterThan(0)
    expect(bad({ kind: 'debt', to: 'f_beta', amount: 0, rate: 0.1 })).toBeGreaterThan(0)
    expect(bad({ kind: 'debt', to: 'f_beta', amount: 5, rate: 2 })).toBeGreaterThan(0)
  })
})

// ---- 人在副本裡（G3） ----

describe('人在副本裡跨過週一：先記成到期，出來之後的下一次 time.passed 才結', () => {
  const inRun = (g: G, on: boolean) => put(g, [{ op: 'flag', key: 'in_run', value: on ? true : null }])

  it('副本進行中跨過週一：不結（一份 bill.due 的記錄）；活動結束後過一分鐘就結，只結一次', () => {
    const g = make({ commission: true, cred: 1000, lines: [line('rent', 100)] })
    goTo(g, 6, 12)
    inRun(g, true)
    goTo(g, 7, 12)
    expect(settles(g)).toHaveLength(0)
    expect(cred(g)).toBe(1000)
    expect(g.state.reports.filter((r) => r.action === 'bill.due')).toHaveLength(1)
    expect(readBills(g.state).due).toEqual([toMinutes({ day: 7, hour: 6, minute: 0 })])
    // 還在副本裡再過時間：還是不結，也不重複記
    advance(g, 60)
    expect(settles(g)).toHaveLength(0)
    expect(g.state.reports.filter((r) => r.action === 'bill.due')).toHaveLength(1)
    // 出來
    inRun(g, false)
    expect(settles(g)).toHaveLength(0)
    advance(g, 1)
    expect(settles(g)).toHaveLength(1)
    expect(cred(g)).toBe(900)
    expect(g.box.settled.map((s) => s.week)).toEqual([1])
    expect(readBills(g.state).due).toEqual([])
    advance(g, 60)
    expect(settles(g)).toHaveLength(1)
  })

  it('副本裡跨過兩個週一：出來之後一週一週結兩次', () => {
    const g = make({ commission: true, cred: 1000, lines: [line('rent', 100)] })
    inRun(g, true)
    goTo(g, 15, 12)
    expect(settles(g)).toHaveLength(0)
    expect(readBills(g.state).due).toHaveLength(2)
    inRun(g, false)
    advance(g, 1)
    expect(g.box.settled.map((s) => s.week)).toEqual([1, 2])
    expect(cred(g)).toBe(800)
  })

  it('預覽在副本裡：看得到「已經到期、還沒結」的那一週', () => {
    const g = make({ commission: true, cred: 1000, lines: [line('rent', 100)] })
    inRun(g, true)
    goTo(g, 8)
    const p = billPreview(g.k, g.state)
    expect(p.deferred).toBe(true)
    expect(p.week).toBe(1)
  })

  it('撤退回到副本入口的快照：到期的記錄跟著回去', () => {
    const g = make({ commission: true, cred: 1000, lines: [line('rent', 100)] })
    const raw = g.save('snapshot')
    inRun(g, true)
    goTo(g, 8)
    expect(readBills(g.state).due).toHaveLength(1)
    expect(g.rewind(raw, { summary: '你撤退了。' })).toBeNull()
    expect(readBills(g.state).due).toEqual([])
    expect(g.state.time).toEqual({ day: 3, hour: 10, minute: 0 })
  })
})

// ---- 預覽與提醒 ----

describe('預覽 billPreview 與週日晚上的提醒', () => {
  it('預覽的數字和實際結算一樣：每一項付了多少、欠多少、會停在哪、錢差多少', () => {
    const g = make({ cred: 240, mult: 1, lines: [line('a', 150, { order: 1 }), line('b', 150, { order: 2 }), line('c', 150, { order: 3 }), income('job', 200)] })
    const p = billPreview(g.k, g.state)
    expect(p.week).toBe(1)
    expect(p.at).toEqual({ day: 7, hour: 6, minute: 0 })
    expect(p.deferred).toBe(false)
    expect(p.stopsAt).toBe('c')
    expect(p.money.cred).toEqual({ have: 240, income: 200, due: 450, short: 10, unpaid: 150, enough: false })
    expect(p.money.cash).toEqual({ have: 0, income: 0, due: 0, short: 0, unpaid: 0, enough: true })
    expect(p.overdue).toBe(0)
    expect(p.slope).toBe(0)
    expect(p.slopeIfShort).toBe(1)
    expect(p.step).toBe('lock')
    goTo(g, 8)
    const real = g.box.settled[0]!.lines
    expect(p.lines.map((l) => [l.id, l.amount, l.paid, l.unpaid, l.skipped ?? false])).toEqual(real.map((l) => [l.id, l.amount, l.paid, l.unpaid, l.skipped ?? false]))
  })

  it('預覽：付得起沒有下一格；欠著時現在在下坡的哪一格、再欠會走到哪一格', () => {
    const g = make({ cred: 1000, lines: [line('rent', 100)] })
    const ok = billPreview(g.k, g.state)
    expect([ok.stopsAt, ok.slopeIfShort, ok.step]).toEqual([null, null, null])
    const poor = make({ cred: 0, lines: [line('rent', 100)] })
    goTo(poor, 8)
    goTo(poor, 15)
    const p = billPreview(poor.k, poor.state)
    expect([p.overdue, p.slope, p.slopeIfShort, p.step]).toEqual([2, 2, 3, 'debt'])
    goTo(poor, 22)
    goTo(poor, 29)
    goTo(poor, 36)
    const deep = billPreview(poor.k, poor.state)
    expect([deep.overdue, deep.slope, deep.slopeIfShort, deep.step]).toEqual([5, 4, 4, 'contract'])
  })

  it('預覽看得到玩家的設定與加減，不改狀態', () => {
    const g = make({ cred: 1000, cash: 0, lines: [line('rent', 100, { pay: 'either' }), line('sub', 40, { order: 2 })] })
    g.commit(setBill(g.k, g.state, 'rent', { cash: true }))
    g.commit(setBill(g.k, g.state, 'sub', { stopped: true }))
    const before = JSON.stringify(g.state)
    const p = billPreview(g.k, g.state)
    expect(p.lines.find((l) => l.id === 'rent')).toMatchObject({ pool: 'cash', unpaid: 100 })
    expect(p.lines.find((l) => l.id === 'sub')).toMatchObject({ skipped: true })
    expect(p.money.cash.short).toBe(100)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('currentLines：目前所有的項目（含收入、臨時項目、債的利息）', () => {
    const g = make({ cred: 1000, lines: [line('rent', 100), income('job', 5)] })
    give(g, [{ kind: 'bill', name: '分期', amount: 30, weeks: 3, pay: 'cred' }, { kind: 'debt', to: 'f_alpha', amount: 200, rate: 0.1 }])
    expect(currentLines(g.k, g.state).map((l) => l.id)).toEqual(['job', 'rent', 'debt:d2', 'x1'])
    expect(currentLines(g.k, g.state).map((l) => l.id).sort()).toEqual(['debt:d2', 'job', 'rent', 'x1'])
  })

  it('週日 20:00 出一份 bill.notice（不擋、沒有變更）：明天要付多少、帳戶夠不夠；同一個週日只出一次', () => {
    const g = make({ cred: 240, lines: [line('a', 150, { order: 1 }), line('b', 150, { order: 2 })] })
    goTo(g, 6, 19)
    expect(g.state.reports.filter((r) => r.action === 'bill.notice')).toHaveLength(0)
    goTo(g, 6, 21)
    const notices = g.state.reports.filter((r) => r.action === 'bill.notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]!.changes).toEqual([])
    expect(notices[0]!.kind).toBe('downtime')
    expect(notices[0]!.outcome.summary).toContain('a 150')
    expect(notices[0]!.outcome.summary).toContain('帳戶不夠，差 60')
    expect(notices[0]!.outcome.summary).toContain('b')
    advance(g, 120)
    expect(g.state.reports.filter((r) => r.action === 'bill.notice')).toHaveLength(1)
    expect(settles(g)).toHaveLength(0)
  })

  it('夠付的週日提醒說付得起；一次睡過週日與週一：只有結算、沒有提醒；沒有要付的項目不出提醒', () => {
    const g = make({ cred: 1000, lines: [line('a', 150)] })
    goTo(g, 6, 21)
    expect(g.state.reports.find((r) => r.action === 'bill.notice')!.outcome.summary).toContain('付得起')
    const skip = make({ cred: 1000, lines: [line('a', 150)] })
    goTo(skip, 7, 12)
    expect(skip.state.reports.filter((r) => r.action === 'bill.notice')).toHaveLength(0)
    expect(settles(skip)).toHaveLength(1)
    const none = make({ cred: 1000 })
    goTo(none, 6, 21)
    expect(none.state.reports.filter((r) => r.action === 'bill.notice')).toHaveLength(0)
  })

  it('人在副本裡經過週日晚上：不出提醒', () => {
    const g = make({ commission: true, cred: 1000, lines: [line('a', 150)] })
    put(g, [{ op: 'flag', key: 'in_run', value: true }])
    goTo(g, 6, 21)
    expect(g.state.reports.filter((r) => r.action === 'bill.notice')).toHaveLength(0)
  })
})

// ---- 名冊的薪水 ----

describe('名冊的薪水：weeklyPay 接上 bill.collect（order 8、付現金），沒付成的人忠誠 −8', () => {
  const hire = (g: G, id: string, weekly: number) => g.commit(join(g.k, g.state, id, { weekly }))
  const loyalty = (g: G, id: string) => meterOf(g.k, g.state, 'loyalty', id)

  it('薪水是現金、order 8；付了忠誠不變', () => {
    const g = make({ roster: true, cash: 1000, cred: 0 })
    hire(g, 'r_ann', 500)
    hire(g, 'r_bob', 300)
    expect(loyalty(g, 'r_ann')).toBe(30)
    goTo(g, 8)
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.owner, l.name, l.order, l.pay, l.paid, l.unpaid])).toEqual([
      ['salary:r_ann', 'roster', '安的週薪', 8, 'cash', 500, 0], ['salary:r_bob', 'roster', '鮑的週薪', 8, 'cash', 300, 0],
    ])
    expect(cash(g)).toBe(200)
    expect(loyalty(g, 'r_ann')).toBe(30)
    expect(loyalty(g, 'r_bob')).toBe(30)
    expect(overdueWeeks(g.state)).toBe(0)
  })

  it('現金不夠：沒付成的那個人忠誠 −8，付成的不變；欠繳 1 週', () => {
    const g = make({ roster: true, cash: 600, cred: 0 })
    hire(g, 'r_ann', 500)
    hire(g, 'r_bob', 300)
    goTo(g, 8)
    expect(g.box.settled[0]!.lines.map((l) => [l.id, l.paid, l.unpaid])).toEqual([['salary:r_ann', 500, 0], ['salary:r_bob', 0, 300]])
    expect(loyalty(g, 'r_ann')).toBe(30)
    expect(loyalty(g, 'r_bob')).toBe(22)
    expect(overdueWeeks(g.state)).toBe(1)
    expect(settles(g)[0]!.changes).toContainEqual({ op: 'meter', kind: 'loyalty', key: 'r_bob', delta: -8 })
  })

  it('連續沒付：每一週都 −8；忠誠不會低過 0', () => {
    const g = make({ roster: true, cash: 0, cred: 0 })
    hire(g, 'r_ann', 500)
    put(g, [{ op: 'meter', kind: 'loyalty', key: 'r_ann', set: 10 }])
    goTo(g, 8)
    expect(loyalty(g, 'r_ann')).toBe(2)
    goTo(g, 15)
    expect(loyalty(g, 'r_ann')).toBe(0)
  })

  it('拿分紅的、沒設週薪的不在帳單上；停掉的薪水不付也不扣忠誠', () => {
    const g = make({ roster: true, cash: 0, cred: 0 })
    g.commit(join(g.k, g.state, 'r_ann', { fixed: true }))
    hire(g, 'r_bob', 300)
    expect(billPreview(g.k, g.state).lines.map((l) => l.id)).toEqual(['salary:r_bob'])
    g.commit(setBill(g.k, g.state, 'salary:r_bob', { stopped: true }))
    goTo(g, 8)
    expect(loyalty(g, 'r_bob')).toBe(30)
    expect(overdueWeeks(g.state)).toBe(0)
    // 改成分紅就不在帳單上
    g.commit(setBill(g.k, g.state, 'salary:r_bob', { stopped: false }))
    g.commit(setPay(g.state, 'r_bob', { pay: 'share' }))
    expect(billPreview(g.k, g.state).lines).toEqual([])
  })

  it('角色被拿掉的成員不收薪水（也不會因為查不到人讓結算丟錯）', () => {
    const g = make({ roster: true, cash: 1000, cred: 0 })
    hire(g, 'r_ann', 500)
    put(g, [{ op: 'actor.remove', id: 'r_ann' }])
    expect(() => goTo(g, 8)).not.toThrow()
    expect(settles(g)).toHaveLength(0)
  })

  it('規則 unpaid_delta 可以蓋（資料 roster_rule）', () => {
    const rule: ContentPack = { id: 'rr', content: { roster_rule: [{ id: 'default', unpaid_delta: -3 }] } as unknown as ContentPack['content'] }
    const g = make({ roster: true, cash: 0, packs: [rule] })
    expect(rosterRules(g.k).unpaid_delta).toBe(-3)
    hire(g, 'r_ann', 100)
    goTo(g, 8)
    expect(loyalty(g, 'r_ann')).toBe(27)
  })

  it('沒付成的是別人的項目（不是名冊的）：忠誠不動；現金薪水沒付成不擋扣帳戶的項目', () => {
    const g = make({ roster: true, cash: 0, cred: 1000, lines: [line('rent', 100, { order: 9 })] })
    hire(g, 'r_ann', 500)
    goTo(g, 8)
    expect(cred(g)).toBe(900)
    expect(loyalty(g, 'r_ann')).toBe(22)
  })

  it('沒付成的是別人的項目：名冊的人忠誠不動', () => {
    const g = make({ roster: true, cash: 1000, cred: 0, lines: [line('rent', 500)] })
    hire(g, 'r_ann', 100)
    goTo(g, 8)
    expect(overdueWeeks(g.state)).toBe(1)
    expect(loyalty(g, 'r_ann')).toBe(30)
  })
})

describe('名冊回答 defeat.companions：這一趟召集時排的同行', () => {
  const ask = (g: G) => g.k.hooks.run('defeat.companions', { state: g.state, pending: { event: 'x' } as never }).flatMap((r) => r.result)

  it('沒召集過：沒有同行的人（沒有人回答）', () => {
    const g = make({ roster: true })
    g.commit(join(g.k, g.state, 'r_ann'))
    expect(ask(g)).toEqual([])
  })

  it('召集時排成同行的名冊成員，戰敗時跟著被處置；隊上的人不在裡面；名冊外的街坊（同行誰都可以排）不回答', () => {
    const g = make({ roster: true })
    g.commit(join(g.k, g.state, 'r_ann'))
    g.commit(join(g.k, g.state, 'r_bob'))
    g.commit(muster(g.k, g.state, { party: ['r_ann'], tagalong: ['r_bob', 'c_bob'] }))
    expect(ask(g)).toEqual(['r_bob'])
    // 戰敗的那一邊（defeat 的 companionNames）拿到的就是名字
    expect(companionNames(g.k, g.state, { event: 'x' } as never)).toEqual(['鮑'])
    expect(g.state.party).toEqual(['pc', 'r_ann'])
  })

  it('重新召集之後以最新的為準；成員離開、角色被拿掉的人不在裡面', () => {
    const g = make({ roster: true })
    g.commit(join(g.k, g.state, 'r_ann'))
    g.commit(join(g.k, g.state, 'r_bob'))
    g.commit(muster(g.k, g.state, { party: [], tagalong: ['r_ann', 'r_bob'] }))
    expect(ask(g)).toEqual(['r_ann', 'r_bob'])
    put(g, [{ op: 'actor.remove', id: 'r_ann' }])
    expect(ask(g)).toEqual(['r_bob'])
    g.commit(muster(g.k, g.state, { party: ['r_bob'], tagalong: [] }))
    expect(ask(g)).toEqual([])
  })

  it('沒裝名冊：沒有人回答，不丟錯', () => {
    const g = make()
    expect(ask(g)).toEqual([])
  })
})

// ---- 存檔與重播 ----

describe('存檔與重播', () => {
  const scenario = (g: G) => {
    give(g, [{ kind: 'bill', name: '保護費', amount: 40, weeks: 3, pay: 'cred' }, { kind: 'debt', to: 'f_beta', amount: 300, rate: 0.1 }])
    g.commit(setBill(g.k, g.state, 'rent', { stopped: true }))
  }
  const base = (): Opts => ({ cred: 500, lines: [line('rent', 120), line('sub', 60, { order: 3 }), income('job', 30)] })

  it('中途存檔讀檔：之後的結果一模一樣（欠繳、債、臨時項目、設定）', () => {
    const a = make(base())
    scenario(a)
    goTo(a, 8)
    const raw = a.save()
    const b = make(base())
    expect(b.load(raw)).toBeNull()
    expect(readBills(b.state)).toEqual(readBills(a.state))
    goTo(a, 30)
    goTo(b, 30)
    expect(JSON.stringify([readBills(b.state), b.state.money, b.state.meters, b.state.flags])).toBe(JSON.stringify([readBills(a.state), a.state.money, a.state.meters, a.state.flags]))
    expect(b.box.settled.map((s) => s.week)).toEqual(a.box.settled.slice(1).map((s) => s.week))
  })

  it('同一個種子、同一串輸入：兩局的結果一模一樣', () => {
    const run = () => {
      const g = make(base())
      scenario(g)
      goTo(g, 40)
      return JSON.stringify([readBills(g.state), g.state.money, g.state.meters, g.state.reports.map((r) => r.outcome.summary)])
    }
    expect(run()).toBe(run())
  })

  it('回退一步（undo）：帳單結算整份收回，金額與欠繳都回去', () => {
    const g = make({ cred: 100, lines: [line('rent', 150)] })
    goTo(g, 8)
    expect(overdueWeeks(g.state)).toBe(1)
    expect(g.undoSteps(1)).toBe(true)
    expect(overdueWeeks(g.state)).toBe(0)
    expect(settles(g)).toHaveLength(0)
    expect(g.state.time).toEqual({ day: 3, hour: 10, minute: 0 })
  })

  it('ext.bills 形狀壞掉：當成空的，不丟錯', () => {
    const g = make({ cred: 100, lines: [line('rent', 50)] })
    g.state.ext.bills = { overdue: 'x', cash: 5, tweaks: { a: 'b' }, extras: [{ nope: 1 }, null], debts: 'y', due: ['z', -1, 3] }
    expect(readBills(g.state)).toEqual({ overdue: 0, arrears: 0, cash: [], stopped: [], tweaks: {}, grace: {}, extras: [], debts: [], due: [3], seq: 0 })
    expect(() => goTo(g, 8)).not.toThrow()
  })
})
