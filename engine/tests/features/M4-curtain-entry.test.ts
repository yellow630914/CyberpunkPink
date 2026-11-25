// 驗收測試：dev/work/M4-curtain-entry.md（cpp-feature）。features/curtain：簾後館的第一段（邀請函、面談與會員證、三個席次、保證金與每週會費、口味單、檔期主題與每週主打、報名並開一趟）。
// 規格：CYBERSPACE 8.7 節（比較表與共通的規則）、8.8 節（怎麼進去、一趟的結構開頭到報名、檔期主題、能不能反覆去、篩選關掉時）；LEWD_SYSTEM 1.1、第 9 節；dev/adr/0019 第十二節與 P56、P57。
// 內容是測試自帶的最小假資料：兩個勢力、六個傾向標籤、三個夜（扮演、流轉、契約；契約之夜要 contract_dom 開著）、curtain_rule 的小表；不讀 engine/data。
// netrun 用測試的替身活動（只記下 setup 與 origin）；deck_grade 用測試的替身衍生數值；街頭信譽與敵對值用測試的量表；bills 用假掛點（直接問 bill.collect、跑 bill.settled）。
// 骰面：面談的檢定骰面由狀態的亂數導出，要某一種結果的測試掃種子（先在乾淨的一局上看骰面，再用找到的種子正式做）。
// 時間：測試從第 8 天 20:00 開始；第 7 天 06:00 是週一（第 1 週），所以這是第 1 週的週二晚上。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Effect, Feature, ReportDraft } from '../../src'
import { ActionBlocked, deriveRng, effectCtx, toMinutes } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import {
  CURTAIN_DEFAULT_RULES, CURTAIN_ENTER_ACTION, CURTAIN_FEE_BILL_ID, CURTAIN_INTERVIEW_ACTION, curtainFeature, curtainMondayOf, curtainOf, curtainRuleProblems, curtainRules, curtainWeekIndex,
  enterBlocks, enterDraft, enterQuote, featureOf, interviewBlock, interviewDraft, memberView, nightProblems, nights, tasteBlock, tasteDraft, tasteOptions,
} from '../../src/features/curtain'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料與替身
// ===================================================================================================================

const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const T0 = { day: 8, hour: 20, minute: 0 }
const DAY = 1440

const NIGHTS: Rec[] = [
  { id: 'n_cosplay', name: '扮演之夜', faction: 'f_alpha', tags: ['t_cos', 't_peep'], culture: 'kaleido' },
  { id: 'n_flow', name: '流轉之夜', faction: 'f_beta', tags: ['t_flow', 't_fur'], culture: 'honey' },
  { id: 'n_contract', name: '契約之夜', faction: 'f_alpha', tags: ['t_dom'], needs_filter: 'contract_dom', culture: 'eden' },
]
const TAGS: Rec[] = [
  { id: 't_cos', name: '角色扮演', axis: 'costume' }, { id: 't_dom', name: '支配', axis: 'relation' }, { id: 't_peep', name: '窺視', axis: 'sense' },
  { id: 't_fur', name: '獸', axis: 'body' }, { id: 't_flow', name: '性別流動', axis: 'body' }, { id: 't_mind', name: '妄想', axis: 'sense' },
]

const pack = (rule: Rec | null, nightList: Rec[] = NIGHTS): ContentPack => ({
  id: 'curtain_test',
  content: {
    skill: ['negotiate', 'perform'].map((id) => ({ id, name: id, attr: 'charm', desc: `${id}。` })),
    tendency_tag: TAGS,
    curtain_night: nightList,
    ...(rule ? { curtain_rule: [{ id: 'default', ...rule }] } : {}),
  } as never,
})

/** 測試的替身：衍生數值 deck_grade（角色 ext.dg）與活動 netrun（開始時把設定記在 state.ext.fake_net；沒有替身就是「沒裝 netrun」）。 */
const STUB: Feature = {
  id: 'curtain_stub',
  install(k) {
    k.stats.defineStat({ id: 'deck_grade', owner: 'curtain_stub', name: '甲板等級', base: (state, actor) => Number(state.actors[actor]?.ext.dg ?? 0) })
  },
}
const NETRUN: Feature = {
  id: 'curtain_fake_netrun',
  install(k) {
    k.activity.define({
      kind: 'netrun', owner: 'curtain_fake_netrun', order: 50, allow: [],
      active: (state) => (state.ext.fake_net ? { id: 'run1', label: '網內的一趟' } : null),
      reason: () => '正在網內的一趟裡。',
      start(_k, state, setup, origin) {
        return [{
          kind: 'netrun', action: 'netrun.fake_start', location: { ...state.location }, party: [], timeline: [],
          changes: [{ op: 'ext', key: 'fake_net', value: { setup, origin } as never }], outcome: { result: 'started', summary: '網內的一趟開始了。' },
        }]
      },
    })
  },
}

const METERS = meterFeature(
  testMeter({ kind: 'rep', owner: 'test', name: '街頭信譽', keyed: 'none' }),
  testMeter({ kind: 'hostility', owner: 'test', name: '敵對值', keyed: 'faction' }),
)

interface Opts {
  seed?: number
  /** 街頭信譽值（0：無名；35：有號；55：搶手） */
  rep?: number
  sink?: number
  /** 有橋、有甲板（預設都有） */
  bridge?: boolean
  deck?: boolean
  /** 同伴人數（每個都有橋與甲板） */
  companions?: number
  cash?: number
  rule?: Rec | null
  nights?: Rec[]
  contentOff?: string[]
  time?: { day: number; hour: number; minute: number }
  /** 弱的主角：面談擲不過（魅力 1、沒有基本功） */
  weak?: boolean
  netrun?: boolean
  extra?: Feature[]
}
type G = ReturnType<typeof setup>

function setup(o: Opts = {}) {
  const ext = (dg: boolean) => ({ ...(o.bridge === false ? {} : { bridge: { ...BRIDGE } }), ...(dg ? { dg: 2 } : {}) })
  const companions = Array.from({ length: o.companions ?? 0 }, (_, i) => makeActor({ id: `c${i + 1}`, name: `同伴${i + 1}`, role: 'companion', ext: ext(true) }))
  const { game } = makeGame({
    seed: o.seed ?? 3,
    features: [characterFeature, lewdFeature, STUB, METERS, ...(o.netrun === false ? [] : [NETRUN]), curtainFeature, ...(o.extra ?? [])],
    content: [METER_CONTENT, pack(o.rule === undefined ? null : o.rule, o.nights)],
    pc: o.weak ? { attrs: { charm: 1 }, sink: o.sink ?? 0, ext: ext(o.deck !== false) } : { attrs: { charm: 24 }, skills: { negotiate: 5, perform: 5 }, sink: o.sink ?? 0, ext: ext(o.deck !== false) },
    actors: companions,
    patch: { time: o.time ?? T0, money: { cred: 5000, cash: o.cash ?? 5000 }, rules: o.contentOff ? ({ contentOff: o.contentOff } as never) : undefined } as never,
  })
  if (o.rep) commit(game, [{ op: 'meter', kind: 'rep', key: '_', delta: o.rep }])
  return game
}

const draft = (changes: Change[], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const commit = (g: Pick<G, 'commit'>, changes: Change[], action = 'test.step') => g.commit(draft(changes, action))
const now = (g: G) => toMinutes(g.state.time)
const advance = (g: G, minutes: number) => commit(g, [{ op: 'time', minutes }], 'test.wait')
const advanceTo = (g: G, minutes: number) => advance(g, minutes - now(g))
const cur = (g: G) => curtainOf(g.state)
const cash = (g: G) => g.state.money.cash
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

/** 一串內建來源的效果直接套到狀態上。 */
function fx(g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin') {
  const ctx = effectCtx(g.k, g.state, { source, actor: 'pc' })
  const errors = g.k.effects.validate(effects as Effect[], ctx)
  if (errors.length > 0) return { errors }
  const res = g.k.effects.resolve(effects as Effect[], ctx)
  if (res.errors.length === 0) commit(g, res.changes, 'test.effect')
  return { errors: res.errors }
}
const invite = (g: G, days?: number) => fx(g, [{ kind: 'curtain_invite', ...(days ? { days } : {}) }])

/** 面談的骰面（同一個狀態、同一個用途，骰面一定一樣）。 */
const natural = (g: G, tier: string, skill: string): number => deriveRng(g.state.rng, `${CURTAIN_INTERVIEW_ACTION}/${tier}/${skill}`).int(1, 20)
/** 掃種子：做出一局、給了邀請函，骰面符合要求的那一個。 */
function seeded(want: (n: number) => boolean, o: Opts = {}, tier = 'floor', skill = 'negotiate'): G {
  for (let seed = 1; seed <= 400; seed++) {
    const g = setup({ ...o, seed })
    if (want(natural(g, tier, skill))) return g
  }
  throw new Error('找不到合適的種子')
}
/** 一個靠得住的會員：街頭信譽夠、過了面談（散座）。 */
function member(o: Opts = {}): G {
  const g = seeded((n) => n >= 3 && n <= 19, { rep: 40, ...o })
  invite(g)
  g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))
  expect(cur(g).member?.tier).toBe('floor')
  return g
}
/** 勾三個口味（三個夜都抽得到：扮演、流轉；契約之夜要 contract_dom 開著，預設開著）。 */
const TASTE3 = ['t_cos', 't_flow', 't_dom']
const setTaste = (g: G, tags: string[] = TASTE3) => g.commit(tasteDraft(g.k, g.state, tags))
/** 把「這一趟」清掉（替身 netrun 與簾後館的 run 都拿掉），模擬一趟打完。 */
const finish = (g: G) => {
  const c = cur(g)
  delete c.run
  commit(g, [{ op: 'ext', key: 'fake_net', value: null }, { op: 'ext', key: 'curtain', value: c as never }], 'curtain.test_finish')
}
const party = (n: number): string[] => ['pc', ...Array.from({ length: n - 1 }, (_, i) => `c${i + 1}`)]

// ===================================================================================================================
// 一、規則表與格式
// ===================================================================================================================

describe('規則表與格式（CYBERSPACE 8.8 節的表）', () => {
  it('三個席次的數字、邀請函與面談與會費的數字照設計書', () => {
    const r = CURTAIN_DEFAULT_RULES
    expect(r.tiers.map((t) => [t.id, t.grade, t.deposit, t.fee_weekly, t.prize, t.interview_dc])).toEqual([
      ['floor', 2, 300, 100, 900, 13], ['box', 3, 1000, 300, 3000, 16], ['vip', 4, 3300, 1000, 9800, 19],
    ])
    expect([r.invite_days, r.interview_retry_days, r.fee_grace_weeks, r.runs_per_night, r.companion_fee, r.taste_min, r.feature_bonus]).toEqual([3, 7, 2, 2, 100, 3, 1.2])
    expect(r.refuse).toEqual({ sink: 80, hostility: 40, factions: [] })
    expect(r.region).toMatchObject({ size: [9, 7], carve: [20, 28], pressure: 'none', safe: true })
    expect(r.acts).toHaveLength(4)
  })

  it('curtain_rule 的資料蓋掉預設，格式不對的欄位忽略；region 的 layer 各項個別蓋', () => {
    const g = setup({ rule: { invite_days: 5, refuse: { factions: ['f_alpha'] }, region: { carve: [1, 2], layer: { foe: [1, 1] } } } })
    const r = curtainRules(g.k)
    expect(r.invite_days).toBe(5)
    expect(r.tiers).toEqual(CURTAIN_DEFAULT_RULES.tiers)
    // 格式不對的資料載入時就被擋下
    expect(() => setup({ rule: { tiers: 'bad' } })).toThrow()
    expect(r.refuse).toEqual({ sink: 80, hostility: 40, factions: ['f_alpha'] })
    expect((r.region.layer as Rec).foe).toEqual([1, 1])
    expect((r.region.layer as Rec).archive).toEqual([1, 2])
    expect(r.region.carve).toEqual([1, 2])
    expect(curtainRuleProblems({ tiers: 'bad', invite_days: 0, refuse: [] })).toHaveLength(3)
  })

  it('一個夜的格式：要有名字、勢力、標籤與文化', () => {
    expect(nightProblems({ name: '夜', faction: 'f', tags: ['t'], culture: 'c' })).toEqual([])
    expect(nightProblems({ name: '', faction: '', tags: [], culture: '' })).toHaveLength(4)
  })
})

// ===================================================================================================================
// 二、邀請函、面談與會員證
// ===================================================================================================================

describe('邀請函與面談（CYBERSPACE 8.8 節「怎麼進去」）', () => {
  it('沒有邀請函被擋；效果給了之後可以；過了三天又被擋', () => {
    const g = seeded((n) => n >= 3 && n <= 19, { rep: 40 })
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })).toContain('邀請函')
    expect(reasonOf(() => interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))).toContain('邀請函')
    expect(invite(g).errors).toEqual([])
    expect(cur(g).invite?.until).toBe(now(g) + 3 * DAY)
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })).toBeNull()
    advance(g, 3 * DAY + 1)
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })).toContain('邀請函')
    expect(memberView(g.k, g.state).invite).toBeNull()
  })

  it('邀請函的天數可以寫（days）；只有內建的來源收：AI 給的被擋', () => {
    const g = setup()
    invite(g, 5)
    expect(cur(g).invite?.until).toBe(now(g) + 5 * DAY)
    expect(memberView(g.k, g.state).invite).toMatchObject({ daysLeft: 5 })
    const ai = fx(g, [{ kind: 'curtain_invite' }], 'ai')
    expect(ai.errors.length).toBeGreaterThan(0)
    expect(fx(g, [{ kind: 'curtain_invite', days: 0 }]).errors.length).toBeGreaterThan(0)
    expect(fx(g, [{ kind: 'curtain_invite', who: 'x' }]).errors.length).toBeGreaterThan(0)
  })

  it('過了：領會員證，從散座起；邀請函用掉、會費繳到下一個週一、破關次數從 0 起', () => {
    const g = seeded((n) => n >= 3 && n <= 19, { rep: 40 })
    invite(g)
    const t0 = now(g)
    const r = g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))[0]!
    expect(r.action).toBe(CURTAIN_INTERVIEW_ACTION)
    expect(r.outcome.result).toBe('joined')
    expect(r.timeline.some((b) => b.roll)).toBe(true)
    // 面談花一個小時（interview_minutes）；會員證的時間記的是面談開始那一刻
    expect(now(g)).toBe(t0 + 60)
    expect(cur(g).member).toEqual({ tier: 'floor', since: t0, paid_until: curtainMondayOf(g.k, curtainWeekIndex(g.k, t0) + 1), clears: 0 })
    expect(cur(g).invite).toBeUndefined()
    expect(cur(g).interview_at).toBeUndefined()
    // 擲交涉與表演都可以；已經是會員就不能再談同一席
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'perform' })).toContain('已經是')
  })

  it('面談花的時間可以用規則表改（interview_minutes）', () => {
    const g = seeded((n) => n >= 3 && n <= 19, { rep: 40, rule: { interview_minutes: 15 } })
    invite(g)
    const t0 = now(g)
    g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))
    expect(now(g)).toBe(t0 + 15)
    expect(cur(g).member?.since).toBe(t0)
  })

  it('面談失敗：記下時間，七天內再談被擋；滿七天（新的邀請函）又可以', () => {
    const g = seeded((n) => n <= 10, { weak: true, rep: 40 })
    invite(g)
    const t0 = now(g)
    const r = g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))[0]!
    expect(r.outcome.result).toBe('failed')
    expect(cur(g).member).toBeUndefined()
    expect(cur(g).interview_at).toBe(t0)
    expect(now(g)).toBe(t0 + 60)
    invite(g)
    const why = interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })!
    expect(why).toContain('7 天')
    expect(memberView(g.k, g.state).retryDays).toBe(7)
    advance(g, 6 * DAY)
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })).toContain('1 天')
    advance(g, DAY)
    invite(g)
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })).toBeNull()
  })

  it('不收的人：沉溺 85、沒有甲板、沒有橋、街頭信譽不夠、規則表列的勢力敵對 40 以上，各被擋並寫原因', () => {
    const base = { rep: 40 }
    const blockOf = (g: G) => interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })
    const ok = setup(base)
    invite(ok)
    expect(blockOf(ok)).toBeNull()

    const sunk = setup({ ...base, sink: 85 })
    invite(sunk)
    expect(blockOf(sunk)).toContain('沉溺')
    const sunken = setup({ ...base, sink: 100 })
    invite(sunken)
    expect(blockOf(sunken)).toContain('溺感者')
    const edge = setup({ ...base, sink: 79 })
    invite(edge)
    expect(blockOf(edge)).toBeNull()

    const nodeck = setup({ ...base, deck: false })
    invite(nodeck)
    expect(blockOf(nodeck)).toContain('甲板')
    const nobridge = setup({ ...base, bridge: false })
    invite(nobridge)
    expect(blockOf(nobridge)).toContain('橋')

    const poor = setup({ rep: 10 })
    invite(poor)
    expect(blockOf(poor)).toContain('街頭信譽')
    expect(blockOf(poor)).toContain('有號')

    // 勢力的清單是規則表（預設是空的）：寫了之後敵對 40 以上才不收
    const hostile = setup({ ...base, rule: { refuse: { factions: ['f_alpha'] } } })
    invite(hostile)
    commit(hostile, [{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 39 }])
    expect(blockOf(hostile)).toBeNull()
    commit(hostile, [{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 1 }])
    expect(blockOf(hostile)).toContain('敵對值')
    const unlisted = setup(base)
    invite(unlisted)
    commit(unlisted, [{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 80 }])
    expect(blockOf(unlisted)).toBeNull()
  })

  it('第一次入會只能從散座起；面談只能擲交涉或表演；戰鬥外才談', () => {
    const g = setup({ rep: 90 })
    invite(g)
    expect(interviewBlock(g.k, g.state, { tier: 'box', skill: 'negotiate' })).toContain('散座')
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'seduce' as never })).toContain('交涉或表演')
    expect(interviewBlock(g.k, g.state, { tier: 'nope' as never, skill: 'negotiate' })).toContain('沒有')
  })

  it('升席：目前的席次破關滿五次、信譽夠、再面談一次（不用邀請函，也不查介紹人）', () => {
    const g = seeded((n) => n >= 3 && n <= 19, { rep: 60 }, 'box')
    // 先用同一顆骰子之外的條件入會：散座的骰面也要過
    invite(g)
    for (let i = 0; i < 4; i++) {
      if (cur(g).member) break
      g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: i % 2 ? 'perform' : 'negotiate' }))
      if (!cur(g).member) { advance(g, 7 * DAY); invite(g) }
    }
    expect(cur(g).member?.tier).toBe('floor')
    expect(interviewBlock(g.k, g.state, { tier: 'box', skill: 'negotiate' })).toContain('破關 5 次')
    expect(interviewBlock(g.k, g.state, { tier: 'vip', skill: 'negotiate' })).toContain('一席一席')
    const c = cur(g)
    c.member!.clears = 5
    commit(g, [{ op: 'ext', key: 'curtain', value: c as never }])
    const view = memberView(g.k, g.state)
    expect(view.tiers.find((t) => t.id === 'box')).toMatchObject({ canInterview: true, blocks: [] })
    expect(view.tiers.find((t) => t.id === 'vip')?.canInterview).toBe(false)
    expect(view.tiers.find((t) => t.id === 'floor')?.current).toBe(true)
    // 擲到什麼看骰面：過了就是包廂、破關次數歸零；沒過就是失敗並記下時間
    const r = g.commit(interviewDraft(g.k, g.state, { tier: 'box', skill: 'negotiate' }))[0]!
    if (r.outcome.result === 'upgraded') expect(cur(g).member).toMatchObject({ tier: 'box', clears: 0 })
    else expect(cur(g).member).toMatchObject({ tier: 'floor', clears: 5 })
  })

  it('升席的信譽不夠時寫原因（搶手才進得了包廂）', () => {
    const g = member({ rep: 40 })
    const c = cur(g)
    c.member!.clears = 5
    commit(g, [{ op: 'ext', key: 'curtain', value: c as never }])
    const box = memberView(g.k, g.state).tiers.find((t) => t.id === 'box')!
    expect(box.canInterview).toBe(false)
    expect(box.blocks.join('')).toContain('搶手')
  })
})

// ===================================================================================================================
// 三、會費
// ===================================================================================================================

describe('每週會費（掛點 bill.collect、bill.settled）', () => {
  const collect = (g: G, week: number) => g.k.hooks.run('bill.collect', { state: g.state, week } as never).flatMap((r) => r.result as Rec[])
  const settle = (g: G, week: number, line: Rec) => {
    const out = g.k.hooks.run('bill.settled', { state: g.state, week, lines: [line] } as never).flatMap((r) => r.result as Change[])
    if (out.length) commit(g, out, 'bill.settle')
    return out
  }
  const lineOf = (paid: boolean, o: Rec = {}) => ({ id: CURTAIN_FEE_BILL_ID, owner: 'curtain', name: '會費', kind: 'due', amount: 100, order: 6, pay: 'cred', paid: paid ? 100 : 0, unpaid: paid ? 0 : 100, ...o })

  it('bill.collect 每週出一行：那個席次的會費；不是會員沒有', () => {
    const none = setup()
    expect(collect(none, 2)).toEqual([])
    const g = member()
    const lines = collect(g, 2)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ id: CURTAIN_FEE_BILL_ID, owner: 'curtain', kind: 'due', amount: 100, order: 6, pay: 'cred' })
  })

  it('付了：paid_until 往後一週', () => {
    const g = member()
    const week = curtainWeekIndex(g.k, now(g)) + 1
    expect(cur(g).member!.paid_until).toBe(curtainMondayOf(g.k, week))
    settle(g, week, lineOf(true))
    expect(cur(g).member!.paid_until).toBe(curtainMondayOf(g.k, week + 1))
    expect(cur(g).member!.suspended).toBeUndefined()
    expect(memberView(g.k, g.state).member?.paid_until).toBe(curtainMondayOf(g.k, week + 1))
  })

  it('兩週沒付之後停權（邀請函也作廢）：報名被擋、要重新面談', () => {
    const g = member()
    setTaste(g)
    const week = curtainWeekIndex(g.k, now(g)) + 1
    settle(g, week, lineOf(false))
    expect(cur(g).member!.suspended).toBeUndefined()
    invite(g)
    settle(g, week + 1, lineOf(false))
    expect(cur(g).member!.suspended).toBe(true)
    expect(cur(g).invite).toBeUndefined()
    expect(collect(g, week + 2)).toEqual([])
    expect(enterBlocks(g.k, g.state, { party: ['pc'] }).join('')).toContain('停權')
    expect(memberView(g.k, g.state).member?.suspended).toBe(true)
    // 重新面談：邀請函要重來
    expect(interviewBlock(g.k, g.state, { tier: 'floor', skill: 'negotiate' })).toContain('邀請函')
  })

  it('停掉的帳單（skipped）算沒付；中間付了就重新數', () => {
    const g = member()
    const week = curtainWeekIndex(g.k, now(g)) + 1
    settle(g, week, lineOf(false, { skipped: true }))
    settle(g, week + 1, lineOf(true))
    expect(cur(g).member!.suspended).toBeUndefined()
    expect(cur(g).member!.paid_until).toBe(curtainMondayOf(g.k, week + 2))
    // paid_until 只在付了的時候往後，沒付的那一週不動：再連續兩週沒付就停權
    settle(g, week + 2, lineOf(false))
    expect(cur(g).member!.suspended).toBeUndefined()
    settle(g, week + 3, lineOf(false))
    expect(cur(g).member!.suspended).toBe(true)
  })

  it('別人的帳單項目與沒有會員時不動狀態', () => {
    const g = member()
    expect(settle(g, 3, { id: 'rent', owner: 'rest', kind: 'due', paid: 0, unpaid: 10 })).toEqual([])
    const n = setup()
    expect(settle(n, 3, lineOf(false))).toEqual([])
  })
})

// ===================================================================================================================
// 四、口味單
// ===================================================================================================================

describe('口味單（CYBERSPACE 8.8 節；LEWD_SYSTEM 1.1、第 9 節）', () => {
  it('選項是查得到的傾向標籤，照軸排；被篩選關掉的不列、也勾不上', () => {
    const g = setup({ contentOff: ['t_dom'] })
    const opts = tasteOptions(g.k, g.state)
    expect(opts.map((o) => o.id)).not.toContain('t_dom')
    expect(opts).toHaveLength(5)
    expect(opts.map((o) => o.axis)).toEqual(['sense', 'sense', 'body', 'body', 'costume'])
    expect(tasteBlock(g.k, g.state, ['t_dom'])).toContain('t_dom')
    expect(reasonOf(() => tasteDraft(g.k, g.state, ['t_dom']))).toContain('內容篩選')
    expect(reasonOf(() => tasteDraft(g.k, g.state, ['t_nope']))).toContain('沒有')
  })

  it('勾了三個之後 nights 只列有交集的夜；隨時可以改；清單與狀態都是報告寫的', () => {
    const g = setup()
    const r = g.commit(tasteDraft(g.k, g.state, ['t_cos', 't_peep', 't_mind']))[0]!
    expect(r.action).toBe('curtain.taste')
    expect(cur(g).taste).toEqual(['t_cos', 't_peep', 't_mind'])
    expect(nights(g.k, g.state).map((n) => n.id)).toEqual(['n_cosplay'])
    expect(nights(g.k, g.state)[0]!.matched).toEqual(['t_cos', 't_peep'])
    setTaste(g, ['t_cos', 't_flow', 't_mind'])
    expect(nights(g.k, g.state).map((n) => n.id)).toEqual(['n_cosplay', 'n_flow'])
    expect(tasteOptions(g.k, g.state).filter((o) => o.on).map((o) => o.id).sort()).toEqual(['t_cos', 't_flow', 't_mind'])
    setTaste(g, [])
    expect(cur(g).taste).toEqual([])
  })

  it('契約之夜在 contract_dom 關掉時不列；這個夜的標籤全被關掉時也不列', () => {
    const on = setup()
    setTaste(on, ['t_dom', 't_cos', 't_flow'])
    expect(nights(on.k, on.state).map((n) => n.id)).toContain('n_contract')
    const off = setup({ contentOff: ['contract_dom'] })
    setTaste(off, ['t_dom', 't_cos', 't_flow'])
    expect(nights(off.k, off.state).map((n) => n.id)).toEqual(['n_cosplay', 'n_flow'])
    const tagsOff = setup({ contentOff: ['t_cos', 't_peep'] })
    setTaste(tagsOff, ['t_dom', 't_flow', 't_mind'])
    expect(nights(tagsOff.k, tagsOff.state).map((n) => n.id)).toEqual(['n_contract', 'n_flow'])
    // 標籤只關掉一部分的夜還在（只剩沒關掉的那個有交集）
    const some = setup({ contentOff: ['t_cos'] })
    setTaste(some, ['t_peep', 't_flow', 't_mind'])
    expect(nights(some.k, some.state).map((n) => n.id)).toEqual(['n_cosplay', 'n_flow'])
  })

  it('口味單只剩兩個開著的標籤時 pure_stage 是 true（三個以上不是）；關掉的標籤不算', () => {
    const g = setup()
    expect(memberView(g.k, g.state).pure_stage).toBe(true)
    setTaste(g, ['t_cos', 't_flow'])
    expect(memberView(g.k, g.state).pure_stage).toBe(true)
    setTaste(g, TASTE3)
    expect(memberView(g.k, g.state).pure_stage).toBe(false)
    const filtered = setup({ contentOff: ['t_dom'] })
    cur(filtered)
    commit(filtered, [{ op: 'ext', key: 'curtain', value: { taste: TASTE3 } as never }])
    expect(memberView(filtered.k, filtered.state).taste).toEqual(['t_cos', 't_flow'])
    expect(memberView(filtered.k, filtered.state).pure_stage).toBe(true)
  })

  it('純舞台場次：有交集的夜照樣優先；一個交集都沒有時，抽得到的是所有沒被篩選擋掉的夜', () => {
    const g = setup()
    setTaste(g, ['t_mind'])
    expect(memberView(g.k, g.state).pure_stage).toBe(true)
    expect(nights(g.k, g.state).map((n) => n.id)).toEqual(['n_contract', 'n_cosplay', 'n_flow'])
    setTaste(g, ['t_cos'])
    expect(nights(g.k, g.state).map((n) => n.id)).toEqual(['n_cosplay'])
  })
})

// ===================================================================================================================
// 五、檔期主題與每週主打
// ===================================================================================================================

describe('每週主打（CYBERSPACE 8.8 節「檔期主題」）', () => {
  it('同一週每次問都是同一個（不看口味單、不隨亂數游標變）；跨週會重擲', () => {
    const g = setup()
    const first = featureOf(g.k, g.state)!
    expect(NIGHTS.map((n) => n.id)).toContain(first.id)
    setTaste(g, ['t_mind'])
    commit(g, [{ op: 'rng', advance: 3 }])
    expect(featureOf(g.k, g.state)!.id).toBe(first.id)
    expect(memberView(g.k, g.state).feature).toEqual({ id: first.id, name: first.name })
    advance(g, 2 * DAY)
    expect(featureOf(g.k, g.state)!.id).toBe(first.id)
    // 跨週：每一週各自擲；十二週之內不會永遠是同一個
    const seen = new Set<string>()
    for (let w = 0; w < 12; w++) {
      const f = featureOf(g.k, g.state)!.id
      expect(featureOf(g.k, g.state)!.id).toBe(f)
      seen.add(f)
      advanceTo(g, curtainMondayOf(g.k, curtainWeekIndex(g.k, now(g)) + 1) + 60)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('被篩選整個擋掉的夜不會是主打；沒有夜可以挑是 null', () => {
    const g = setup({ contentOff: ['contract_dom', 't_cos', 't_peep'] })
    for (let w = 0; w < 6; w++) {
      expect(featureOf(g.k, g.state)!.id).toBe('n_flow')
      advance(g, 7 * DAY)
    }
    const none = setup({ nights: [] })
    expect(featureOf(none.k, none.state)).toBeNull()
    expect(memberView(none.k, none.state).feature).toBeNull()
  })
})

// ===================================================================================================================
// 六、報名並開一趟
// ===================================================================================================================

describe('報名並開一趟（CYBERSPACE 8.8 節「一趟的結構」）', () => {
  const entered = (o: Opts = {}, enter: Partial<Parameters<typeof enterDraft>[2]> = {}): G => {
    const g = member({ companions: 3, ...o })
    setTaste(g)
    g.commit(enterDraft(g.k, g.state, { party: party(2), ...enter }))
    return g
  }

  it('扣保證金 300 與同伴券（II 級一位 200）；報告的 launch 是 netrun，setup.region.safe 是 true，origin.ext.curtain 有夜與席次', () => {
    const g = member({ companions: 3 })
    setTaste(g)
    const before = cash(g)
    expect(enterQuote(g.k, g.state, { party: party(2) })).toMatchObject({ deposit: 300, companionFee: 200, total: 500 })
    expect(enterBlocks(g.k, g.state, { party: party(2) })).toEqual([])
    const r = g.commit(enterDraft(g.k, g.state, { party: party(2), night: 'n_flow' }))[0]!
    expect(r.action).toBe(CURTAIN_ENTER_ACTION)
    expect(before - cash(g)).toBe(500)
    expect(r.launch).toHaveLength(1)
    const l = r.launch![0]!
    expect(l.kind).toBe('netrun')
    expect((l.setup as Rec).region).toMatchObject({ safe: true, pressure: 'none', id: 'curtain', size: [9, 7], carve: [20, 28] })
    expect(l.setup).toMatchObject({ grade: 2, faction: 'none', layers: CURTAIN_DEFAULT_RULES.acts, party: ['pc', 'c1'] })
    expect((l.origin as Rec).by).toBe('curtain')
    expect((l.origin as Rec).ext.curtain).toMatchObject({ night: 'n_flow', tier: 'floor', pure_stage: false })
    // 替身活動真的開了，設定與起源原樣交給它
    expect((g.state.ext.fake_net as Rec).setup.region.safe).toBe(true)
    expect((g.state.ext.fake_net as Rec).origin.ext.curtain.night).toBe('n_flow')
    const run = cur(g).run!
    expect(run).toMatchObject({ night: 'n_flow', tier: 'floor', grade: 2, deposit: 300, party: ['pc', 'c1'], companions: ['c1'], pure_stage: false })
    expect(cur(g).week!.runs[String(g.state.time.day)]).toBe(1)
    expect(memberView(g.k, g.state).run?.id).toBe(run.id)
  })

  it('一個人報名只付保證金；同伴 III 級以上的券乘等級', () => {
    const g = member({ companions: 3 })
    setTaste(g)
    expect(enterQuote(g.k, g.state, { party: party(1) })).toMatchObject({ total: 300, companions: [] })
    const big = setup({ companions: 1, rule: { tiers: [
      { id: 'floor', name: '散座', grade: 2, rep_min: 2, deposit: 300, fee_weekly: 100, prize: 900, interview_dc: 13 },
      { id: 'box', name: '包廂', grade: 3, rep_min: 3, deposit: 1000, fee_weekly: 300, prize: 3000, interview_dc: 16 },
      { id: 'vip', name: '貴賓席', grade: 4, rep_min: 4, deposit: 3300, fee_weekly: 1000, prize: 9800, interview_dc: 19 },
    ] } })
    const c = cur(big)
    c.member = { tier: 'box', since: 0, paid_until: 999999, clears: 0 }
    commit(big, [{ op: 'ext', key: 'curtain', value: c as never }])
    expect(enterQuote(big.k, big.state, { party: ['pc', 'c1'] })).toMatchObject({ deposit: 1000, companionFee: 300, total: 1300 })
    expect(enterQuote(big.k, big.state, { party: ['pc', 'c1'], tier: 'floor' })).toMatchObject({ deposit: 300, companionFee: 200, total: 500 })
  })

  it('選夜：給了就要在抽得到的清單裡；沒給就擲；選到主打記 feature: true', () => {
    const g = member({ companions: 3 })
    setTaste(g, ['t_cos', 't_peep', 't_mind'])
    // 清單只有扮演之夜
    expect(enterBlocks(g.k, g.state, { party: party(2), night: 'n_flow' }).join('')).toContain('不在你抽得到的夜裡')
    expect(reasonOf(() => enterDraft(g.k, g.state, { party: party(2), night: 'n_contract' }))).toContain('扮演之夜')
    expect(enterBlocks(g.k, g.state, { party: party(2), night: 'n_nope' }).join('')).toContain('n_nope')
    const r = g.commit(enterDraft(g.k, g.state, { party: party(2) }))[0]!
    expect((r.launch![0]!.origin as Rec).ext.curtain.night).toBe('n_cosplay')
    // 主打：把主打設成清單裡的那個夜，選到它就是 feature
    const feature = featureOf(g.k, g.state)!.id
    const h = member({ companions: 3 })
    setTaste(h, ['t_cos', 't_peep', 't_mind', 't_flow', 't_fur', 't_dom'])
    const pick = nights(h.k, h.state).find((n) => n.feature)!
    expect(pick.id).toBe(feature)
    const hr = h.commit(enterDraft(h.k, h.state, { party: party(2), night: pick.id }))[0]!
    expect((hr.launch![0]!.origin as Rec).ext.curtain.feature).toBe(true)
    expect(cur(h).run!.feature).toBe(true)
    finish(h)
    const other = nights(h.k, h.state).find((n) => !n.feature)!
    const hr2 = h.commit(enterDraft(h.k, h.state, { party: party(2), night: other.id }))[0]!
    expect((hr2.launch![0]!.origin as Rec).ext.curtain.feature).toBe(false)
  })

  it('純舞台場次記在這一趟：口味單不到三個題材', () => {
    const g = member({ companions: 3 })
    setTaste(g, ['t_cos'])
    const r = g.commit(enterDraft(g.k, g.state, { party: party(1) }))[0]!
    expect((r.launch![0]!.origin as Rec).ext.curtain.pure_stage).toBe(true)
    expect(cur(g).run!.pure_stage).toBe(true)
  })

  it('同一個夜一天之內擲到兩次就重擲：同一晚的第二場不是同一個夜', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = member({ companions: 3, seed })
      setTaste(g)
      g.commit(enterDraft(g.k, g.state, { party: party(1) }))
      const first = cur(g).run!.night
      finish(g)
      g.commit(enterDraft(g.k, g.state, { party: party(1) }))
      expect(cur(g).run!.night).not.toBe(first)
    }
  })

  it('一晚最多兩場：同一晚第三場被擋；過了凌晨三點算新的一晚', () => {
    const g = member({ companions: 3 })
    setTaste(g)
    for (let i = 0; i < 2; i++) {
      g.commit(enterDraft(g.k, g.state, { party: party(1) }))
      expect(memberView(g.k, g.state).runsTonight).toBe(i + 1)
      finish(g)
    }
    expect(memberView(g.k, g.state).runsLeft).toBe(0)
    expect(enterBlocks(g.k, g.state, { party: party(1) }).join('')).toContain('一晚最多 2 場')
    expect(reasonOf(() => enterDraft(g.k, g.state, { party: party(1) }))).toContain('今晚')
    // 午夜過了還算同一晚；清晨三點之後是新的一晚
    advance(g, 4 * 60 + 30)
    expect(g.state.time).toMatchObject({ day: 9, hour: 1, minute: 30 })
    expect(memberView(g.k, g.state).runsLeft).toBe(0)
    advance(g, 3 * 60)
    expect(memberView(g.k, g.state).runsLeft).toBe(2)
    expect(enterBlocks(g.k, g.state, { party: party(1) })).toEqual([])
  })

  it('隊伍：五個人被擋；沒有會員本人被擋；同伴沒有甲板、沒有橋、不在隊上都被擋；現金不夠被擋', () => {
    const g = member({ companions: 4 })
    setTaste(g)
    expect(enterBlocks(g.k, g.state, { party: party(5) }).join('')).toContain('最多 4 個人')
    expect(reasonOf(() => enterDraft(g.k, g.state, { party: party(5) }))).toContain('最多 4 個人')
    expect(enterBlocks(g.k, g.state, { party: [] }).join('')).toContain('至少要有你自己')
    expect(enterBlocks(g.k, g.state, { party: ['c1'] }).join('')).toContain('會員本人')
    expect(enterBlocks(g.k, g.state, { party: party(4) })).toEqual([])
    expect(enterBlocks(g.k, g.state, { party: ['pc', 'ghost'] }).join('')).toContain('ghost')

    commit(g, [{ op: 'actor.ext', id: 'c1', key: 'dg', value: 0 }])
    expect(enterBlocks(g.k, g.state, { party: party(2) }).join('')).toContain('同伴1沒有自己的甲板')
    commit(g, [{ op: 'actor.ext', id: 'c1', key: 'dg', value: 2 }, { op: 'actor.ext', id: 'c1', key: 'bridge', value: null }])
    expect(enterBlocks(g.k, g.state, { party: party(2) }).join('')).toContain('同伴1沒有橋')
    commit(g, [{ op: 'actor.ext', id: 'c1', key: 'bridge', value: { ...BRIDGE } }, { op: 'party', id: 'c1', remove: true }])
    expect(enterBlocks(g.k, g.state, { party: party(2) }).join('')).toContain('同伴1不在你的隊上')
    commit(g, [{ op: 'party', id: 'c1' }])

    const poor = member({ companions: 1, cash: 5000 })
    setTaste(poor)
    commit(poor, [{ op: 'cash', delta: -(cash(poor) - 499) }])
    expect(enterBlocks(poor.k, poor.state, { party: party(2) }).join('')).toContain('現金不夠')
    commit(poor, [{ op: 'cash', delta: 1 }])
    expect(enterBlocks(poor.k, poor.state, { party: party(2) })).toEqual([])
  })

  it('不是會員、已經報了名、網內的一趟進行中、口味單沒有夜：各被擋並說明', () => {
    const none = setup({ companions: 1 })
    expect(enterBlocks(none.k, none.state, { party: ['pc'] }).join('')).toContain('不是簾後館的會員')
    const g = entered({ companions: 3 })
    expect(enterBlocks(g.k, g.state, { party: party(1) }).join('')).toContain('已經報了名')
    // 簾後館自己的報告在網內的一趟進行中放行，別的功能沒登記的不放行
    expect(g.k.activity.blockOf(g.state, 'commit:curtain.taste')).toBeNull()
    expect(g.k.activity.blockOf(g.state, 'commit:other.thing')).not.toBeNull()
    const empty = member({ companions: 1, contentOff: ['contract_dom', 't_cos', 't_peep', 't_flow', 't_fur'] })
    expect(enterBlocks(empty.k, empty.state, { party: ['pc'] }).join('')).toContain('沒有抽得到的夜')
  })

  it('沒有人登記活動 netrun（沒裝網內的行程）時：enterDraft 擋下並說明；面談與口味單照常', () => {
    const g = member({ netrun: false })
    setTaste(g)
    expect(enterBlocks(g.k, g.state, { party: ['pc'] })).toEqual(['簾後館現在沒有開放。'])
    expect(reasonOf(() => enterDraft(g.k, g.state, { party: ['pc'] }))).toContain('沒有開放')
    expect(memberView(g.k, g.state).member?.tier).toBe('floor')
  })

  it('開不起來整步不成立：錢與狀態都不動', () => {
    const FAIL: Feature = { id: 'curtain_fail_netrun', install(k) {
      k.activity.define({ kind: 'netrun', owner: 'curtain_fail_netrun', order: 50, allow: [], active: () => null, reason: () => '', start: () => { throw new ActionBlocked('這一區生成不出來。') } })
    } }
    const g = seeded((n) => n >= 3 && n <= 19, { rep: 40, netrun: false, extra: [FAIL] })
    invite(g)
    g.commit(interviewDraft(g.k, g.state, { tier: 'floor', skill: 'negotiate' }))
    setTaste(g)
    const before = cash(g)
    expect(() => g.commit(enterDraft(g.k, g.state, { party: ['pc'] }))).toThrow(ActionBlocked)
    expect(cash(g)).toBe(before)
    expect(cur(g).run).toBeUndefined()
  })
})

// ===================================================================================================================
// 七、條件、讀取與唯讀
// ===================================================================================================================

describe('條件 curtain_member 與唯讀的函式', () => {
  const test = (g: G, tier?: string) => g.k.conditions.test({ kind: 'curtain_member', ...(tier ? { tier } : {}) } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('curtain_member { tier: box } 對散座不成立；不寫 tier 只問有沒有會員證；停權的不算', () => {
    const none = setup()
    expect(test(none)).toBe(false)
    const g = member()
    expect(test(g)).toBe(true)
    expect(test(g, 'floor')).toBe(true)
    expect(test(g, 'box')).toBe(false)
    const c = cur(g)
    c.member!.tier = 'vip'
    commit(g, [{ op: 'ext', key: 'curtain', value: c as never }])
    expect(test(g, 'box')).toBe(true)
    expect(test(g, 'vip')).toBe(true)
    c.member!.suspended = true
    commit(g, [{ op: 'ext', key: 'curtain', value: c as never }])
    expect(test(g)).toBe(false)
    expect(g.k.conditions.validate({ kind: 'curtain_member', tier: 'nope' }, 'x').length).toBeGreaterThan(0)
  })

  it('memberView、nights、enterBlocks、enterQuote、interviewBlock 跑過之後狀態一個字都沒變、骰面不動', () => {
    const g = member({ companions: 1 })
    setTaste(g)
    const snap = JSON.stringify(g.state)
    memberView(g.k, g.state)
    nights(g.k, g.state)
    enterBlocks(g.k, g.state, { party: party(2) })
    enterQuote(g.k, g.state, { party: party(2) })
    interviewBlock(g.k, g.state, { tier: 'box', skill: 'perform' })
    tasteOptions(g.k, g.state)
    featureOf(g.k, g.state)
    expect(JSON.stringify(g.state)).toBe(snap)
  })

  it('讀到的 state.ext.curtain 形狀不對的部分當成沒有', () => {
    const g = setup()
    commit(g, [{ op: 'ext', key: 'curtain', value: { member: { tier: 'gold' }, taste: [1, 'a', 'a'], invite: { until: 'x' }, week: 3 } as never }])
    expect(cur(g)).toEqual({ taste: ['a'], tapes: [] })
    expect(memberView(g.k, g.state).member).toBeNull()
  })
})
