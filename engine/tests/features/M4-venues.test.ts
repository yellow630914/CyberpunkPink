// 驗收測試：dev/work/M4-venues.md（cpp-feature）。規格：LEWD_SYSTEM 第 6 節（人偶館、感官擂台）、6.1 節（一班、錢怎麼分）；DOWNTIME 4.1 節半夢那一列與表下兩條、4.2 節；
// EVENTS 4.7 節「擂台的邀約」；CORE_RULES 4.2 節（過載）；dev/adr/0019 P62、P63。
// 內容一律用測試自帶的最小假資料：
//   工作  j_puppet（人偶館，照半夢的數字：戴晶片不擲時薪 30、清醒擲魅力＋誘惑對 14 時薪 18；戴晶片每 3 班馴化 +1、每 5 班沉溺 +1）、
//         j_cut（照琉璃宮：時薪 150、店家抽六成、租金 120）、j_formula（照第七棚：10 ＋ 敏感度÷5 ＋ 豔名÷5）
//   擂台  設施種類 fac_ring（arena: { grades: [1, 2], stake_max: 300 }）、擂台的武器類型 neural_melee（神經、近身）、對手是一個角色 foe
// 豔名、橋、沉溺用真的 lewdFeature 與 characterFeature；站上設施用真的 world；擂台的戰鬥用 testkit 的最小行動 TEST_COMBAT。
// 時間：測試從第 3 天 10:00 開始。

import { describe, expect, it } from 'vitest'
import type { Actor, ContentPack, Degree, Feature, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx, meterOf, toMinutes } from '../../src'
import { arenaFeature, arenaOptions, arenaView, arenaRules, enterBlock, enterDraft, enterProblems, enterQuote, oddsOf, readArena } from '../../src/features/arena'
import { characterFeature } from '../../src/features/character'
import { defeatFeature } from '../../src/features/defeat'
import { lewdFeature } from '../../src/features/lewd'
import { arrive, worldFeature } from '../../src/features/world'
import { checkPlan, hourlyWage, jobStateOf, jobView, modeCheck, readWork, shift, shiftBlock, workFeature } from '../../src/features/work'
import { FEATURES } from '../../src/features'
import { TEST_COMBAT, makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 共同的假資料 ----

const MAP: Rec = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '人偶館' }, { id: 'F2', at: [3, 1], mark: 'F', name: '旗艦店' }, { id: 'F3', at: [5, 1], mark: 'F', name: '攝影棚' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const SKILLS: Rec[] = ['brawl', 'firearms', 'seduce', 'composure'].map((id) => ({ id, name: id, desc: `${id}。`, attr: id === 'brawl' ? 'body' : id === 'firearms' ? 'reflex' : id === 'seduce' ? 'charm' : 'resolve' }))
const WEAPON_CLASSES: Rec[] = [
  { id: 'neural_melee', name: '電擊鞭', dice: 2, type: 'neural', range: [1, 2], cover_mult: 0, pierce: 0, traits: [], attr: 'body', skill: 'brawl' },
  { id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' },
]

const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
type G = ReturnType<typeof makeGame>['game']
const put = (g: G, changes: ReportDraft['changes']) => g.commit(draft(changes))
const stand = (g: G, block: string, marker: string) => { g.commit(arrive(g.k, g.state, block, marker)) }
const last = (g: G): Report => g.state.reports[g.state.reports.length - 1]!
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const BRIDGE = { sensitivity: 60, tolerance: 30, craving: 30, docility: 20 }

// ======================================================================
// 打工：人偶館的兩種模式、分帳、公式型時薪
// ======================================================================

const PUPPET = {
  id: 'j_puppet', name: '人偶館', facility: 'fac_puppet', pay: 'cred',
  modes: {
    chip: {
      name: '戴晶片', wage: 30, check: false, amnesia: true, tags: ['puppet_amnesia'],
      every: [{ hours: 6, effects: [{ kind: 'bridge', param: 'docility', amount: 1 }] }, { hours: 10, effects: [{ kind: 'sink', amount: 1 }] }],
    },
    awake: { name: '清醒', wage: 18, check: { attr: 'charm', skill: 'seduce', dc: 14 }, perks: [{ kind: 'cash', amount: 2 }] },
  },
  stages: [{ name: '新人', mult: 1 }, { name: '熟客', mult: 1.5, need: { hours: 160, affinity: 0 } }],
}
const CUT = { id: 'j_cut', name: '旗艦店', facility: 'fac_flag', wage: 150, cut: { house: 0.6, rent: 120 }, pay: 'cred', stages: [{ name: '一般樓層', mult: 1 }, { name: '會員層', mult: 1.5, need: { hours: 40, affinity: 0 } }] }
const FORMULA = {
  id: 'j_formula', name: '攝影棚', facility: 'fac_studio', pay: 'cred',
  wage_formula: { base: 10, add: [{ stat: 'bridge_sensitivity', div: 5 }, { meter: 'fame', div: 5 }] },
  stages: [{ name: '助理', mult: 1 }, { name: '攝影師', mult: 2, need: { hours: 40, affinity: 0 } }],
}

const workPack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP)],
    skill: structuredClone(SKILLS),
    facility_type: [{ id: 'fac_puppet', name: '人偶館' }, { id: 'fac_flag', name: '旗艦店' }, { id: 'fac_studio', name: '攝影棚' }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_hive'] }],
    block: [{
      id: 'b_hive', district: 'd_hive', name: '四號塔', kind: 'block', map: 'm_street', exits: {},
      facilities: { F1: { type: 'fac_puppet', name: '半夢' }, F2: { type: 'fac_flag', name: '琉璃宮' }, F3: { type: 'fac_studio', name: '第七棚' } },
    }],
    work_rule: [{ id: 'default', hours: [2, 4, 6, 8] }],
    job: [structuredClone(PUPPET), structuredClone(CUT), structuredClone(FORMULA)],
  }
  patch(c)
  return { id: 'venues_work', content: c as unknown as ContentPack['content'] }
}

const makeWork = (o: { patch?: (c: Record<string, Rec[]>) => void; seed?: number; contentOff?: string[]; bridge?: Rec | null; features?: Feature[] } = {}): G => {
  const { game } = makeGame({
    features: o.features ?? [characterFeature, lewdFeature, worldFeature, workFeature],
    content: [workPack(o.patch)], seed: o.seed ?? 7,
    pc: { hp: 40, ext: { bridge: o.bridge === undefined ? { ...BRIDGE } : o.bridge }, skills: { seduce: 2 } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 100, cash: 100 }, ...(o.contentOff ? { rules: { contentOff: o.contentOff } as never } : {}) },
  })
  stand(game, 'b_hive', 'F1')
  return game
}

const work = (g: G, job: string, hours: number, mode?: string): Report[] => g.commit(shift(g.k, g.state, job, hours, mode))
const setJob = (g: G, id: string, js: Partial<ReturnType<typeof jobStateOf>>) => {
  const w = readWork(g.state)
  w.jobs[id] = { ...jobStateOf(g.state, id), ...js }
  put(g, [{ op: 'ext', key: 'work', value: w as unknown as Record<string, unknown> }])
}
const bridgeOf = (g: G): Rec => g.state.actors.pc!.ext.bridge as Rec

describe('人偶館：兩種模式（LEWD_SYSTEM 第 6 節；DOWNTIME 4.1 節半夢那一列）', () => {
  it('沒給 mode 被擋下、並列出可以選的兩種；選了沒有的也一樣', () => {
    const g = makeWork()
    const why = reasonOf(() => shift(g.k, g.state, 'j_puppet', 6))
    expect(why).toMatch(/戴晶片/)
    expect(why).toMatch(/清醒/)
    expect(shiftBlock(g.k, g.state, 'j_puppet', 6)).toBe(why)
    expect(reasonOf(() => shift(g.k, g.state, 'j_puppet', 6, 'nope'))).toMatch(/沒有「nope」這種做法.*戴晶片.*清醒/)
    // 沒有 modes 的工作不收 mode
    stand(g, 'b_hive', 'F2')
    expect(reasonOf(() => shift(g.k, g.state, 'j_cut', 6, 'chip'))).toMatch(/沒有分做法/)
  })

  it('戴晶片：不擲、時薪 30（6 小時 180），時間照過；報告的 outcome.amnesia 是 true、結果只有兩句', () => {
    const g = makeWork()
    const t0 = toMinutes(g.state.time)
    const [r] = work(g, 'j_puppet', 6, 'chip')
    expect(g.state.money.cred).toBe(100 + 180)
    expect(toMinutes(g.state.time) - t0).toBe(360)
    expect(r!.timeline.some((b) => b.roll)).toBe(false)
    expect((r!.outcome as Rec).amnesia).toBe(true)
    expect(r!.narration!.results).toHaveLength(2)
    expect(r!.outcome.summary).toBe(r!.narration!.results!.join(''))
    expect(r!.narration!.results![0]).toMatch(/180/)
    // 只有賺了多少與一句模糊的殘留：沒有過程、沒有附帶的句子
    expect(r!.timeline).toHaveLength(2)
    expect(r!.triggers![0]).toMatchObject({ point: 'work', where: { job: 'j_puppet', mode: 'chip', stage: '1' } })
    expect(jobStateOf(g.state, 'j_puppet')).toMatchObject({ shifts: 1, minutes: 360, modes: { chip: 360 } })
  })

  it('清醒：擲魅力＋誘惑對 14、時薪 18（6 小時：大成功 162、成功 108、失敗 54、大失敗 0），記得一切（沒有 amnesia）；附帶的效果照模式的', () => {
    const paid: Record<Degree, number> = { critical: 162, success: 108, fail: 54, fumble: 0 }
    const seen = new Set<Degree>()
    for (let seed = 1; seed <= 40; seed++) {
      const g = makeWork({ seed })
      const plan = checkPlan(g.k, g.state, g.state.actors ? (g.k.content.get('job', 'j_puppet') as never) : (undefined as never), (g.k.content.get('job', 'j_puppet') as Rec).modes.awake)!
      expect(plan).toMatchObject({ attr: 'charm', skill: 'seduce', dc: 14 })
      const before = { cred: g.state.money.cred, cash: g.state.money.cash }
      const [r] = work(g, 'j_puppet', 6, 'awake')
      const degree = r!.timeline.find((b) => b.roll)!.roll!.degree as Degree
      seen.add(degree)
      expect(r!.timeline.find((b) => b.roll)!.roll!.dc).toBe(14)
      expect(g.state.money.cred - before.cred).toBe(paid[degree])
      expect(g.state.money.cash - before.cash).toBe(2)
      expect((r!.outcome as Rec).amnesia).toBeUndefined()
      expect(r!.narration!.results![0]).toMatch(/清醒/)
      expect(r!.triggers![0]!.where).toMatchObject({ mode: 'awake' })
    }
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })

  it('puppet_amnesia 關掉：只列清醒，戴晶片被擋並只列清醒；清醒照做', () => {
    const g = makeWork({ contentOff: ['puppet_amnesia'] })
    const job = g.k.content.get('job', 'j_puppet') as never
    const v = jobView(g.k, g.state, job)
    expect(v.modes.map((m) => m.id)).toEqual(['awake'])
    const why = reasonOf(() => shift(g.k, g.state, 'j_puppet', 6, 'chip'))
    expect(why).toMatch(/清醒/)
    expect(why).not.toMatch(/戴晶片（chip）/)
    expect(() => work(g, 'j_puppet', 6, 'awake')).not.toThrow()
    // 兩種都關掉的工作（只有帶標籤的模式）：沒有可以選的做法
    const only = makeWork({ contentOff: ['puppet_amnesia'], patch: (c) => { delete (c.job![0] as Rec).modes.awake } })
    expect(modeCheck(only.state, only.k.content.get('job', 'j_puppet') as never, 'chip').block).toMatch(/現在沒有可以選的做法/)
  })

  it('每累計 6 小時馴化 +1、每 10 小時沉溺 +1（戴晶片的時數；清醒的班不算）；每一班的結果都只有兩句', () => {
    const g = makeWork()
    const docility: number[] = []
    const sink: number[] = []
    for (let i = 1; i <= 6; i++) {
      const [r] = work(g, 'j_puppet', 2, 'chip')
      docility.push(bridgeOf(g).docility)
      sink.push(g.state.actors.pc!.sink)
      expect(r!.narration!.results).toHaveLength(2)
      if (i === 3) work(g, 'j_puppet', 2, 'awake') // 清醒的班不記在戴晶片上
    }
    expect(docility).toEqual([20, 20, 21, 21, 21, 22])
    expect(sink).toEqual([0, 0, 0, 0, 1, 1])
    expect(jobStateOf(g.state, 'j_puppet')).toMatchObject({ shifts: 7, minutes: 840, modes: { chip: 720, awake: 120 } })
  })

  it('第 3 班那一份報告的變更裡有馴化 +1、第 5 班那一份有沉溺 +1，其他班沒有', () => {
    const g = makeWork()
    const touched = (r: Report) => ({ bridge: r.changes.some((c) => c.op === 'actor.ext' && (c as Rec).key === 'bridge'), sink: r.changes.some((c) => c.op === 'actor.track' && (c as Rec).track === 'sink') })
    const rows = [1, 2, 3, 4, 5].map(() => touched(work(g, 'j_puppet', 2, 'chip')[0]!))
    expect(rows.map((x) => x.bridge)).toEqual([false, false, true, false, false])
    expect(rows.map((x) => x.sink)).toEqual([false, false, false, false, true])
  })

  it('沒有橋的人做戴晶片：馴化落空、不丟錯，錢與班數照記（打工不擋人）', () => {
    const g = makeWork({ bridge: null })
    for (let i = 0; i < 3; i++) work(g, 'j_puppet', 2, 'chip')
    expect(g.state.money.cred).toBe(100 + 3 * 60)
    expect(jobStateOf(g.state, 'j_puppet').modes).toEqual({ chip: 360 })
  })

  it('階段的倍率照舊乘（模式的時薪 × 階段 1.5）', () => {
    const g = makeWork()
    setJob(g, 'j_puppet', { stage: 1, shifts: 20 })
    work(g, 'j_puppet', 6, 'chip')
    expect(g.state.money.cred).toBe(100 + Math.round(6 * 30 * 1.5))
    expect(last(g).triggers![0]!.where).toMatchObject({ stage: '2' })
  })

  it('jobView 列出每一種做法：時薪、檢定與成功率、amnesia、各自的累計時數與預計', () => {
    const g = makeWork()
    work(g, 'j_puppet', 2, 'chip')
    const v = jobView(g.k, g.state, g.k.content.get('job', 'j_puppet') as never)
    expect(v.modes.map((m) => [m.id, m.wage, m.amnesia, m.hours, m.check === null])).toEqual([['chip', 30, true, 2, true], ['awake', 18, false, 0, false]])
    expect(v.modes[1]!.check).toMatchObject({ attr: 'charm', skill: 'seduce', dc: 14 })
    expect(v.modes[0]!.options.find((o) => o.hours === 6)!.expected).toBe(180)
    expect(v.modes[1]!.options.find((o) => o.hours === 6)!.by_degree).toEqual({ critical: 162, success: 108, fail: 54, fumble: 0 })
    expect(v.last).toMatchObject({ mode: 'chip' })
  })
})

describe('分帳 cut（LEWD_SYSTEM 6.1 節）', () => {
  it('6 小時、時薪 150、house 0.6、rent 120：拿到 240（900 × 四成 − 120）', () => {
    const g = makeWork()
    stand(g, 'b_hive', 'F2')
    const [r] = work(g, 'j_cut', 6)
    expect(g.state.money.cred).toBe(100 + 240)
    expect(r!.narration!.results![0]).toMatch(/240/)
  })

  it('租金比收入高時拿 0、不倒貼（沒有錢的變更）', () => {
    const g = makeWork({ patch: (c) => { (c.job![1] as Rec).wage = 10 } })
    stand(g, 'b_hive', 'F2')
    const [r] = work(g, 'j_cut', 6)
    expect(g.state.money.cred).toBe(100)
    expect(r!.changes.some((c) => c.op === 'cred')).toBe(false)
    expect(r!.narration!.results![0]).toMatch(/一毛錢/)
  })

  it('沒有 rent 就只抽成；階段的倍率乘在分完之後（第二階段 240 × 1.5）', () => {
    const g = makeWork()
    stand(g, 'b_hive', 'F2')
    setJob(g, 'j_cut', { stage: 1, shifts: 5 })
    work(g, 'j_cut', 6)
    expect(g.state.money.cred).toBe(100 + 360)
    const noRent = makeWork({ patch: (c) => { delete (c.job![1] as Rec).cut.rent } })
    stand(noRent, 'b_hive', 'F2')
    work(noRent, 'j_cut', 6)
    expect(noRent.state.money.cred).toBe(100 + 360)
  })

  it('jobView 的預計也照分帳算', () => {
    const g = makeWork()
    stand(g, 'b_hive', 'F2')
    const v = jobView(g.k, g.state, g.k.content.get('job', 'j_cut') as never)
    expect(v.options.find((o) => o.hours === 6)!.expected).toBe(240)
    expect(v.options.find((o) => o.hours === 2)!.expected).toBe(180 * 0.4 > 120 ? Math.round(300 * 0.4 - 120) : 0)
  })
})

describe('公式型時薪 wage_formula（第七棚）', () => {
  const setFame = (g: G, n: number) => put(g, [{ op: 'meter', kind: 'fame', key: 'd_hive', set: n }])

  it('基底 10、敏感度 60 ÷ 5、豔名 20 ÷ 5：時薪 26（6 小時 156）', () => {
    const g = makeWork()
    stand(g, 'b_hive', 'F3')
    setFame(g, 20)
    expect(meterOf(g.k, g.state, 'fame', 'd_hive')).toBe(20)
    const job = g.k.content.get('job', 'j_formula') as never
    expect(hourlyWage(g.k, g.state, job)).toBe(26)
    work(g, 'j_formula', 6)
    expect(g.state.money.cred).toBe(100 + 156)
    expect(jobView(g.k, g.state, job).stages[0]!.wage).toBe(26)
  })

  it('無條件捨去（敏感度 63 ÷ 5 ＝ 12.6）；查不到的衍生數值與量表當 0', () => {
    const g = makeWork({ bridge: { ...BRIDGE, sensitivity: 63 } })
    stand(g, 'b_hive', 'F3')
    setFame(g, 20)
    expect(hourlyWage(g.k, g.state, g.k.content.get('job', 'j_formula') as never)).toBe(26)
    const odd = makeWork({ patch: (c) => { (c.job![2] as Rec).wage_formula.add.push({ stat: 'no_such_stat', div: 1 }, { meter: 'no_such_meter', div: 1 }) } })
    stand(odd, 'b_hive', 'F3')
    expect(hourlyWage(odd.k, odd.state, odd.k.content.get('job', 'j_formula') as never)).toBe(10 + 12 + 0)
  })

  it('沒有裝 lewd（沒有敏感度也沒有豔名）時就是基底', () => {
    const g = makeWork({ features: [characterFeature, worldFeature, workFeature], patch: (c) => { delete (c.job![0] as Rec).modes.chip.every } })
    stand(g, 'b_hive', 'F3')
    expect(hourlyWage(g.k, g.state, g.k.content.get('job', 'j_formula') as never)).toBe(10)
  })
})

describe('資料的格式檢查', () => {
  const bad = (patch: (c: Record<string, Rec[]>) => void) => () => makeWork({ patch })
  it('modes、cut、wage_formula 寫錯的地方載入時就說', () => {
    expect(bad((c) => { (c.job![0] as Rec).modes.chip.wage = -1 })).toThrow(ContentError)
    expect(bad((c) => { (c.job![0] as Rec).modes.chip.every = [{ hours: 0, effects: [] }] })).toThrow(/every\[0\]\.hours/)
    expect(bad((c) => { (c.job![0] as Rec).modes.awake.check = { attr: 'nope', dc: 14 } })).toThrow(/check\.attr/)
    expect(bad((c) => { (c.job![0] as Rec).modes = {} })).toThrow(/modes/)
    expect(bad((c) => { (c.job![1] as Rec).cut.house = 2 })).toThrow(/cut\.house/)
    expect(bad((c) => { (c.job![1] as Rec).cut.rent = -5 })).toThrow(/cut\.rent/)
    expect(bad((c) => { (c.job![2] as Rec).wage_formula.add = [{ stat: 'a', meter: 'b', div: 5 }] })).toThrow(/stat（衍生數值）與 meter（量表）要寫其中一個/)
    expect(bad((c) => { (c.job![2] as Rec).wage_formula.add = [{ stat: 'a', div: 0 }] })).toThrow(/div/)
    expect(bad((c) => { delete (c.job![1] as Rec).wage })).toThrow(/wage/)
  })

  it('every 或 perks 用到沒有人註冊的效果：ready 時說', () => {
    expect(bad((c) => { (c.job![0] as Rec).modes.chip.every = [{ hours: 6, effects: [{ kind: 'no_such_effect' }] }] })).toThrow(ContentError)
    expect(bad((c) => { (c.job![0] as Rec).modes.awake.perks = [{ kind: 'no_such_effect' }] })).toThrow(ContentError)
  })
})

describe('打工和契約一起裝：收入歸屬照舊（九成被拿走）', () => {
  it('債務契約、照做中的工作指令：戴晶片那一班的 180 只進 18、債少 162，結果多一句（amnesia 的兩句之外）；契約不看模式', async () => {
    const { chooseDraft, contractFeature, contractOf } = await import('../../src/features/contract')
    const g = makeWork({
      features: [characterFeature, lewdFeature, worldFeature, workFeature, contractFeature],
      patch: (c) => { c.faction = [{ id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }] },
    })
    const fx = (effects: Rec[]) => {
      const res = g.k.effects.resolve(effects as never, effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' }))
      expect(res.errors).toEqual([])
      g.commit(draft(res.changes, 'test.effect'))
    }
    fx([{ kind: 'contract_sign', holder: { kind: 'eden', name: '伊甸園', faction: 'eden' }, type: 'debt', debt: 1000, report_weekday: 2 }])
    fx([{ kind: 'order', order_kind: 'work', hours: 100 }])
    g.commit(chooseDraft(g.k, g.state, { order: 'o2', how: 'comply' }))
    const before = g.state.money.cred
    const [r] = work(g, 'j_puppet', 6, 'chip')
    expect(g.state.money.cred - before).toBe(18)
    expect(contractOf(g.state)!.debt).toBe(1000 - 162)
    expect((r!.outcome as Rec).amnesia).toBe(true)
    expect(r!.narration!.results![0]).toMatch(/180/)
    expect(r!.narration!.results!.slice(-1)[0]).toMatch(/抵了債/)
  })
})

// ======================================================================
// 感官擂台
// ======================================================================

const FOE_BRIDGE = { sensitivity: 50, tolerance: 0, craving: 0, docility: 0 }

const foeActor = (o: Omit<Partial<Actor>, 'attrs'> & { attrs?: Partial<Actor['attrs']> } = {}): Actor =>
  makeActor({ id: 'foe', name: '井裡的選手', role: 'npc', age: 28, gender: 'male', ext: { bridge: { ...FOE_BRIDGE } }, ...o })

const arenaPack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP)],
    skill: structuredClone(SKILLS),
    weapon_class: structuredClone(WEAPON_CLASSES),
    facility_type: [{ id: 'fac_ring', name: '感官擂台', arena: { grades: [1, 2], stake_max: 300 } }, { id: 'fac_shop', name: '商店' }],
    district: [{ id: 'd_well', name: '井', grade: 2, blocks: ['b_ring'] }],
    block: [{
      id: 'b_ring', district: 'd_well', name: '井', kind: 'block', map: 'm_street', exits: {},
      facilities: { F1: { type: 'fac_ring', name: '井' }, F2: { type: 'fac_shop', name: '攤子' } },
    }],
  }
  patch(c)
  return { id: 'venues_arena', content: c as unknown as ContentPack['content'] }
}

/** 主角裝備：一把手槍與快取格（擂台不讀，雙方的武器都換成擂台發的那一把）。 */
const loadoutFeature: Feature = {
  id: 'test_loadout',
  install(k) {
    k.battle.loadout('test_loadout', (_s, actor) => (actor === 'pc'
      ? { weapons: [{ id: 'mine', name: '自己的手槍', class: 'pistol', dice: 9, flat: 0, type: 'physical', range: [1, 4], pierce: 0, hit: 5, attr: 'reflex', skill: 'firearms', coverMult: 0, traits: [] }], quick: [{ item: 'i_x', qty: 2 }], armor: 3 }
      : undefined))
  },
}

interface ArenaOpts {
  patch?: (c: Record<string, Rec[]>) => void
  pc?: Rec
  foe?: Actor | null
  money?: { cred: number; cash: number }
  features?: Feature[]
  seed?: number
  at?: [string, string]
}

const makeArena = (o: ArenaOpts = {}): G => {
  const { game } = makeGame({
    features: o.features ?? [characterFeature, lewdFeature, worldFeature, TEST_COMBAT, loadoutFeature, arenaFeature],
    content: [arenaPack(o.patch)], seed: o.seed ?? 7,
    pc: { hp: 40, ext: { bridge: { ...BRIDGE } }, ...(o.pc ?? {}) },
    actors: o.foe === null ? [] : [o.foe ?? foeActor()],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 100, cash: 500 } },
  })
  stand(game, ...(o.at ?? (['b_ring', 'F1'] as [string, string])))
  return game
}

const ENTER = { foe: 'foe', stake: 100 }

/** 打到分出結果：玩家的回合不出手（只結束回合），讓對手一直打；讓主角出手的是 playOut。 */
function passive(g: G, maxSteps = 400): string {
  for (let i = 0; i < maxSteps; i++) {
    if (!g.battle || g.battle.result) break
    const opt = g.battleOptions()!
    const cur = opt.current ? g.battle.units[opt.current]! : null
    const r = cur?.control === 'player' ? g.battleAct({ action: 'end_turn' }) : g.battleNext()
    if (r.status !== 'applied') throw new Error(`一步沒有成立：${(r.reasons ?? []).join(' ')}`)
  }
  if (!g.battle?.result) throw new Error('還沒分出結果')
  return g.battle.result.outcome
}
/** 雙方都由程式代打。 */
function auto(g: G, maxSteps = 400): string {
  for (let i = 0; i < maxSteps; i++) {
    if (!g.battle || g.battle.result) break
    const r = g.battleNext({ anyone: true })
    if (r.status !== 'applied') throw new Error(`一步沒有成立：${(r.reasons ?? []).join(' ')}`)
  }
  if (!g.battle?.result) throw new Error('還沒分出結果')
  return g.battle.result.outcome
}

describe('擂台：能不能報名', () => {
  it('在擂台上、有橋、有對手：能報名；arenaOptions 列出規矩與戰績', () => {
    const g = makeArena()
    const o = arenaOptions(g.k, g.state)
    expect(o).toMatchObject({ open: true, blocks: [], name: '感官擂台', grades: [1, 2], stake_max: 300, wins: 0, losses: 0 })
    expect(o.rules.weapon).toMatchObject({ class: 'neural_melee', type: 'neural' })
    expect(o.cap).toBeGreaterThan(0)
    expect(enterBlock(g.k, g.state, ENTER)).toBeNull()
  })

  it('不在擂台的設施被擋（一條完整的句子）', () => {
    const g = makeArena({ at: ['b_ring', 'F2'] })
    expect(arenaOptions(g.k, g.state)).toMatchObject({ open: false, name: null })
    expect(enterBlock(g.k, g.state, ENTER)).toBe('這裡不是感官擂台。')
    expect(reasonOf(() => enterDraft(g.k, g.state, ENTER))).toBe('這裡不是感官擂台。')
  })

  it('沒有橋（沒有感載）被擋', () => {
    const g = makeArena({ pc: { ext: { bridge: null } } })
    expect(enterBlock(g.k, g.state, ENTER)).toMatch(/沒有橋/)
    expect(arenaOptions(g.k, g.state)).toMatchObject({ open: false, cap: null })
  })

  it('押的超過現金被擋；超過 stake_max 被擋；不押（0）可以；負數與小數被擋', () => {
    const g = makeArena({ money: { cred: 5000, cash: 200 } })
    expect(enterBlock(g.k, g.state, { foe: 'foe', stake: 201 })).toMatch(/現金不夠.*\$?.*200/)
    expect(enterBlock(g.k, g.state, { foe: 'foe', stake: 301 })).toMatch(/最多押/)
    expect(enterBlock(g.k, g.state, { foe: 'foe', stake: 0 })).toBeNull()
    expect(enterBlock(g.k, g.state, { foe: 'foe', stake: 200 })).toBeNull()
    expect(enterBlock(g.k, g.state, { foe: 'foe', stake: -1 })).toMatch(/0 以上的整數/)
    expect(enterBlock(g.k, g.state, { foe: 'foe', stake: 1.5 })).toMatch(/0 以上的整數/)
    // 帳戶有再多也不能拿來押
    const rich = makeArena({ money: { cred: 99999, cash: 50 } })
    expect(enterBlock(rich.k, rich.state, ENTER)).toMatch(/現金不夠/)
  })

  it('對手：沒給、查不到、是自己、沒有橋都被擋，原因一條一句', () => {
    const g = makeArena()
    expect(enterBlock(g.k, g.state, { foe: '', stake: 0 })).toMatch(/選一個對手/)
    expect(enterBlock(g.k, g.state, { foe: 'nobody', stake: 0 })).toMatch(/沒有「nobody」這個對手/)
    expect(enterBlock(g.k, g.state, { foe: 'pc', stake: 0 })).toMatch(/不能跟自己打/)
    const noBridge = makeArena({ foe: foeActor({ ext: { bridge: null } }) })
    expect(enterBlock(noBridge.k, noBridge.state, ENTER)).toMatch(/沒有橋/)
  })

  it('場次的等級：預設取最接近這一區的；寫了不在清單裡的被擋', () => {
    const g = makeArena()
    expect(enterQuote(g.k, g.state, ENTER)!.grade).toBe(2)
    expect(enterQuote(g.k, g.state, { ...ENTER, grade: 1 })!.grade).toBe(1)
    expect(enterBlock(g.k, g.state, { ...ENTER, grade: 4 })).toMatch(/沒有第 4 級的場次，只有：1、2/)
  })

  it('已經在戰鬥中、或別的活動擋住時不能報名', () => {
    const g = makeArena()
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(g.battle).not.toBeNull()
    expect(enterBlock(g.k, g.state, ENTER)).toMatch(/戰鬥中/)
    expect(enterProblems(g.k, g.state, ENTER).length).toBeGreaterThan(0)
  })

  it('報名費：先扣帳戶、帳戶不夠用現金（扣掉押的之後還付得起）；都付不起被擋', () => {
    const fee = (c: Record<string, Rec[]>) => { c.arena_rule = [{ id: 'default', fee: 40 }] }
    const g = makeArena({ patch: fee })
    expect(arenaRules(g.k).fee).toBe(40)
    expect(enterQuote(g.k, g.state, ENTER)).toMatchObject({ fee: 40, pay: 'cred' })
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(g.state.money).toMatchObject({ cred: 60, cash: 500 })
    const poor = makeArena({ patch: fee, money: { cred: 10, cash: 140 } })
    expect(enterQuote(poor.k, poor.state, ENTER)).toMatchObject({ pay: 'cash' })
    expect(enterBlock(poor.k, poor.state, { foe: 'foe', stake: 100 })).toBeNull()
    expect(enterBlock(poor.k, poor.state, { foe: 'foe', stake: 101 })).toMatch(/報名費要 .*40/)
  })
})

describe('擂台：開打', () => {
  it('開打之後雙方手上只有擂台發的那一把神經武器、沒有快取格；我方只有主角、敵方一個人；沒有掩體；不能脫離', () => {
    const g = makeArena()
    const quote = enterQuote(g.k, g.state, ENTER)!
    const reports = g.commit(enterDraft(g.k, g.state, ENTER))
    expect(reports[0]!.action).toBe('arena.enter')
    const b = g.battle!
    expect(b.mode).toBe('meat')
    const units = Object.values(b.units)
    expect(units.map((u) => u.side).sort()).toEqual(['ally', 'foe'])
    for (const u of units) {
      expect(u.weapons).toHaveLength(1)
      expect(u.weapons[0]).toMatchObject({ id: 'arena', class: 'neural_melee', type: 'neural', dice: 3 })
      expect(u.weapons[0]!.mag).toBeUndefined()
      expect(u.quick).toEqual([])
      expect(u.implants).toBeUndefined()
    }
    // 自己的手槍與快取格沒有帶進來（loadoutFeature 給了，擂台不讀）
    expect(b.units.a1!.actor).toBe('pc')
    expect(b.units.f1!.actor).toBe('foe')
    expect([...b.cover.ally, ...b.cover.foe].every((c) => c.level === 0)).toBe(true)
    expect(b.field.safe).toBe(true)
    expect(b.origin.escapable).toBe(false)
    expect(b.origin.place).toBe('感官擂台')
    expect(b.origin.ext).toMatchObject({ by: 'arena', arena: { stake: 100, foe: '井裡的選手' } })
    expect((b.origin.ext!.arena as Rec).odds).toBe(quote.odds)
  })

  it('押的錢報名時不動（結算才加減）', () => {
    const g = makeArena()
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(g.state.money).toMatchObject({ cred: 100, cash: 500 })
  })

  it('賠率照雙方感載上限的差：對手越高賠越多，夾在 min～max；規則可以蓋掉', () => {
    const rules = arenaRules(makeArena().k)
    expect(rules.odds).toEqual({ base: 1, per_cap_diff: 0.02, min: 0.5, max: 3 })
    expect(oddsOf(rules, 30, 30)).toBe(1)
    expect(oddsOf(rules, 30, 40)).toBe(1.2)
    expect(oddsOf(rules, 40, 30)).toBe(0.8)
    expect(oddsOf(rules, 100, 20)).toBe(0.5)
    expect(oddsOf(rules, 20, 200)).toBe(3)
    const g = makeArena({ foe: foeActor({ attrs: { resolve: 16 } }) })
    const q = enterQuote(g.k, g.state, ENTER)!
    expect(q.theirs.cap).toBeGreaterThan(0)
    expect(q.odds).toBe(oddsOf(rules, q.mine.cap, q.theirs.cap))
    expect(q.payout).toBe(Math.floor(100 * q.odds))
    const wide = makeArena({ patch: (c) => { c.arena_rule = [{ id: 'default', odds: { base: 2, per_cap_diff: 0, min: 0.5, max: 3 } }] } })
    expect(enterQuote(wide.k, wide.state, ENTER)!.odds).toBe(2)
  })

  it('規則的武器可以換（dice、類型）；類型不存在時報名被擋', () => {
    const g = makeArena({ patch: (c) => { c.arena_rule = [{ id: 'default', weapon: { class: 'neural_melee', dice: 5, type: 'neural' } }] } })
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(g.battle!.units.a1!.weapons[0]!.dice).toBe(5)
    const missing = makeArena({ patch: (c) => { c.arena_rule = [{ id: 'default', weapon: { class: 'no_such_class' } }] } })
    expect(enterBlock(missing.k, missing.state, ENTER)).toMatch(/no_such_class.*找不到/)
  })

  it('arenaView：呼叫的人給對手的清單，每一個有報價或不能的原因', () => {
    const g = makeArena()
    const v = arenaView(g.k, g.state, { foes: ['foe', 'nobody'], stake: 50 })
    expect(v.options.open).toBe(true)
    expect(v.rows[0]).toMatchObject({ foe: 'foe', block: null })
    expect(v.rows[0]!.quote).toMatchObject({ stake: 50 })
    expect(v.rows[1]!.block).toMatch(/沒有「nobody」/)
    expect(v.rows[1]!.quote).toBeNull()
    expect(arenaView(g.k, g.state).rows).toEqual([])
  })
})

describe('擂台：勝負與結算', () => {
  /** 對手只差一點就過載（感載 19／20）；主角感載上限遠比他高。 */
  const winner = (o: ArenaOpts = {}) => makeArena({ foe: foeActor({ load: 19 }), pc: { attrs: { resolve: 20 } }, ...o })

  it('把對手打到過載：戰鬥結束、有 arena.result、錢是押的 × 賠率；戰績與這一區的豔名 +1', async () => {
    const g = winner()
    const quote = enterQuote(g.k, g.state, ENTER)!
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(auto(g)).toBe('win')
    expect(g.battle!.field.arena).toBe('won')
    const end = await g.finishBattle()
    expect(end.status).not.toBe('refused')
    expect(g.battle).toBeNull()
    expect(g.state.money.cash).toBe(500 + Math.floor(100 * quote.odds))
    const res = g.state.reports.find((r) => r.action === 'arena.result')!
    expect(res).toBeDefined()
    expect(res.triggers).toEqual([{ point: 'arena_result', where: { won: 'true', district: 'd_well' } }])
    expect(res.outcome.result).toBe('won')
    expect(readArena(g.state)).toEqual({ wins: 1, losses: 0, announce: null })
    expect(meterOf(g.k, g.state, 'fame', 'd_well')).toBe(1)
    expect(g.pendingDefeat).toBeNull()
    // 對手過載了：他身上多一層餘韻（寫回角色）
    expect(g.state.actors.foe!.afterglow).toBe(1)
  })

  it('主角先過載：錢沒了（押的）、沒有進等著選的戰敗、身上多一層餘韻；arena.result 帶 won: false', async () => {
    const g = makeArena({ pc: { load: 19 }, foe: foeActor({ attrs: { resolve: 24 } }) })
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(passive(g)).toBe('lose')
    expect(g.battle!.field.arena).toBe('lost')
    await g.finishBattle()
    expect(g.battle).toBeNull()
    expect(g.pendingDefeat).toBeNull()
    expect(g.state.snapshots.some((s) => s.kind === 'battle')).toBe(false)
    expect(g.state.money.cash).toBe(400)
    expect(g.state.actors.pc!.afterglow).toBe(1)
    const res = g.state.reports.find((r) => r.action === 'arena.result')!
    expect(res.triggers).toEqual([{ point: 'arena_result', where: { won: 'false', district: 'd_well' } }])
    expect(res.outcome.result).toBe('lost')
    expect(readArena(g.state)).toMatchObject({ wins: 0, losses: 1 })
    // 輸了照樣可以做別的事（沒有卡在戰敗的三選一）
    expect(() => advance(g, 10)).not.toThrow()
  })

  it('裝了 defeat 也一樣不走戰敗的三選一（field.safe）；沒裝 defeat 也乾淨（自己丟快照）', async () => {
    for (const features of [
      [characterFeature, lewdFeature, worldFeature, TEST_COMBAT, defeatFeature, arenaFeature],
      [characterFeature, lewdFeature, worldFeature, TEST_COMBAT, arenaFeature],
    ]) {
      const g = makeArena({ features, pc: { load: 19 }, foe: foeActor({ attrs: { resolve: 24 } }) })
      g.commit(enterDraft(g.k, g.state, ENTER))
      expect(passive(g)).toBe('lose')
      await g.finishBattle()
      expect(g.pendingDefeat).toBeNull()
      expect(g.state.ext.defeat ?? null).toBeNull()
      expect(g.state.money.cash).toBe(400)
    }
  })

  it('不押（0）：贏了沒有錢的變更，照樣有戰績與 arena.result', async () => {
    const g = winner()
    g.commit(enterDraft(g.k, g.state, { foe: 'foe', stake: 0 }))
    auto(g)
    await g.finishBattle()
    expect(g.state.money.cash).toBe(500)
    expect(g.state.reports.find((r) => r.action === 'arena.result')!.triggers![0]!.where).toMatchObject({ won: 'true' })
  })

  it('輸了的時候現金比押的少（戰鬥中花掉了）：最多扣到 0，不倒欠', async () => {
    const g = makeArena({ pc: { load: 19 }, foe: foeActor({ attrs: { resolve: 24 } }) })
    g.commit(enterDraft(g.k, g.state, ENTER))
    g.state.money.cash = 30 // 戰鬥中花掉了（直接改狀態：戰鬥中不收別的報告）
    passive(g)
    await g.finishBattle()
    expect(g.state.money.cash).toBe(0)
  })

  it('餘韻已經疊滿再過載（昏過去）：照輸贏算，同一條路', async () => {
    const g = makeArena({ pc: { load: 19, afterglow: 3 }, foe: foeActor({ attrs: { resolve: 24 } }) })
    g.commit(enterDraft(g.k, g.state, ENTER))
    expect(passive(g)).toBe('lose')
    expect(g.battle!.field.arena).toBe('lost')
    await g.finishBattle()
    expect(g.pendingDefeat).toBeNull()
    expect(g.state.money.cash).toBe(400)
    // 熔斷的場地：昏過去不加沉溺（sink +2）
    expect(g.state.actors.pc!.sink).toBe(0)
  })

  it('沒有豔名的量表（沒裝 lewd）也照跑：只是不加豔名', async () => {
    const features = [characterFeature, worldFeature, TEST_COMBAT, arenaFeature]
    const g = makeArena({ features, foe: foeActor({ load: 19, ext: {} }), pc: { attrs: { resolve: 20 }, ext: {} } })
    g.commit(enterDraft(g.k, g.state, ENTER))
    auto(g)
    await g.finishBattle()
    expect(g.state.reports.some((r) => r.action === 'arena.result')).toBe(true)
  })

  it('arena.result 的觸發點讓事件接得上：where.won 是字串 true／false（事件資料的 where 只收字串）', async () => {
    const g = winner()
    g.commit(enterDraft(g.k, g.state, ENTER))
    auto(g)
    await g.finishBattle()
    const t = g.state.reports.find((r) => r.action === 'arena.result')!.triggers![0]!
    expect(typeof (t.where as Rec).won).toBe('string')
  })
})

describe('整組功能與存檔', () => {
  it('裝在整組功能（FEATURES）裡：arena 在表上、報名與規則可以用', () => {
    expect(FEATURES.arena).toBe(arenaFeature)
    const { game } = makeGame({ features: Object.values(FEATURES), content: [arenaPack()], seed: 7, pc: { ext: { bridge: { ...BRIDGE } } }, actors: [foeActor()], patch: { money: { cred: 0, cash: 500 } } })
    stand(game, 'b_ring', 'F1')
    expect(arenaOptions(game.k, game.state).open).toBe(true)
    expect(enterQuote(game.k, game.state, ENTER)).not.toBeNull()
  })

  it('設施種類的 arena 欄位寫錯：載入時說（grades、stake_max）', () => {
    expect(() => makeArena({ patch: (c) => { (c.facility_type![0] as Rec).arena = { grades: [] } } })).toThrow(/arena\.grades/)
    expect(() => makeArena({ patch: (c) => { (c.facility_type![0] as Rec).arena = { grades: [9] } } })).toThrow(ContentError)
    expect(() => makeArena({ patch: (c) => { (c.facility_type![0] as Rec).arena = { grades: [1], stake_max: -1 } } })).toThrow(/stake_max/)
    expect(() => makeArena({ patch: (c) => { c.arena_rule = [{ id: 'default', weapon: { type: 'physical' } }] } })).toThrow(/neural/)
    expect(() => makeArena({ patch: (c) => { c.arena_rule = [{ id: 'default', odds: { min: 5, max: 2 } }] } })).toThrow(/odds/)
  })

  it('state.ext.arena 壞掉的部分當空的、不丟錯', () => {
    const g = makeArena()
    g.state.ext.arena = { wins: 'x', losses: -3, announce: { won: 1 } }
    expect(readArena(g.state)).toEqual({ wins: 0, losses: 0, announce: null })
    g.state.ext.arena = 7
    expect(readArena(g.state)).toEqual({ wins: 0, losses: 0, announce: null })
  })
})
