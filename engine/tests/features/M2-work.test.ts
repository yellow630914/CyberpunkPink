// 驗收測試：dev/work/M2-work.md（cpp-feature）。規格：DOWNTIME 第 4 節（4.1 的表只看欄位、4.1a 階段、4.2 結算）；EVENTS 3.1 節（work）、3.3 節打工那一列；
// AI_TASKS 3.13 節（程式的步驟）；LEWD_SYSTEM 第 9 節；UI 3.12 節；dev/adr/0016 第一、六節與 G15。
// 內容一律用測試自帶的最小假資料：一張街的地圖（三個設施標記）、一個區、一塊街區、三種設施；兩份假工作（兩階段的搬貨、三階段的夜班），另外幾份只測擋住的原因。
// 量表（親密度、豔名）用 testkit 的 meterFeature；站上設施用真的 world；升階的事件用真的事件視窗（director、eventRun）。
// 副本是 commission 的活動，測試用一個叫 commission 的替身活動（旗標 in_run 決定它在不在進行）。
//
// 擲骰：骰面從存檔的亂數導出。測試先在同一個種子上看骰面，再把 DC 設成想要的成功程度（forDegree）。
// 時間：測試從第 3 天 10:00 開始（週四上午）；週四的「深夜」是第 3 天 23:00 起。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Degree, Feature, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, meterOf, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { chooseOption, directorFeature, eventRunFeature, eventView, openEventOf } from '../../src/features/director'
import { arrive, worldFeature } from '../../src/features/world'
import {
  effectiveStage, jobStateOf, jobsHere, needProgress, promotionDue, readWork, shift, shiftBlock, workFeature, workRules,
} from '../../src/features/work'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '市場' }, { id: 'F2', at: [3, 1], mark: 'F', name: '夜店' }, { id: 'F3', at: [5, 1], mark: 'F', name: '診所' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const stages2 = (): Rec[] => [
  { name: '搬貨', mult: 1 },
  { name: '領班', mult: 1.5, need: { hours: 40, affinity: 20 }, perks: [{ kind: 'cash', amount: 3 }] },
]
const stages3 = (): Rec[] => [
  { name: '吧台', mult: 1 },
  { name: '包廂', mult: 1.5, need: { hours: 40, affinity: 20 }, adult: true, tags: ['x_mid'] },
  { name: '貴賓室', mult: 2.5, need: { hours: 96, affinity: 40, extra: { kind: 'fame', min: 10 } }, adult: true, tags: ['x_deep'] },
]

/** dc 是搬貨與夜班那一擲的難度：測試用 forDegree 調成想要的成功程度。 */
const jobs = (dc: number): Rec[] => [
  { id: 'j_porter', name: '搬貨', facility: 'fac_market', employer: 'npc_boss', check: { attr: 'body', dc }, wage: 10, pay: 'cash', stages: stages2() },
  { id: 'j_bar', name: '夜班', facility: 'fac_club', employer: 'npc_ann', check: { attr: 'charm', dc }, wage: 10, pay: 'cred', perks: [{ kind: 'fame', amount: 1 }], stages: stages3() },
  { id: 'j_stage', name: '舞台', facility: 'fac_club', employer: 'npc_ann', wage: 14, pay: 'cred', days: { weekday: [3], time: ['late'] }, stages: stages2() },
  { id: 'j_back', name: '診所助手', facility: 'b_hive/F3', wage: 9, pay: 'cash', stages: [{ name: '助手', mult: 1 }, { name: '主助手', mult: 1.5, need: { hours: 24, affinity: 0 } }] },
  { id: 'j_far', name: '鏽帶的活', facility: 'fac_market', district: 'd_rust', wage: 5, pay: 'cash', stages: [{ name: '一', mult: 1 }, { name: '二', mult: 2, need: { hours: 8, affinity: 0 } }] },
]

const base = (dc = 13, patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [{ id: 'fac_market', name: '天井市場' }, { id: 'fac_club', name: '過載' }, { id: 'fac_clinic', name: '診所' }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_hive'] }, { id: 'd_rust', name: '鏽帶', grade: 2, blocks: ['b_yard'] }],
    block: [
      { id: 'b_hive', district: 'd_hive', name: '四號塔', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_market', name: '市場' }, F2: { type: 'fac_club', name: '夜店' }, F3: { type: 'fac_clinic', name: '縫縫診所' } } },
      { id: 'b_yard', district: 'd_rust', name: '院子', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_market', name: '鏽帶市場' } } },
    ],
    npc: [{ id: 'npc_boss', name: '老闆' }],
    event_scope: [{ id: 'street', triggers: { work: 1 } }],
    job: jobs(dc),
  }
  patch(c)
  return { id: 'work_test', content: c as unknown as ContentPack['content'] }
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

interface Opts {
  dc?: number
  seed?: number
  /** 內容；dc 是搬貨與夜班那一擲的難度 */
  pack?: (dc: number) => ContentPack
  hours?: number
  extra?: Feature[]
  /** 不裝事件視窗（導演與執行器） */
  noEvents?: boolean
  noMeters?: boolean
  at?: [string, string]
  money?: { cred: number; cash: number }
  pc?: Rec
}

const variant = (patch: (c: Record<string, Rec[]>) => void) => (dc: number): ContentPack => base(dc, patch)

const make = (o: Opts = {}) => {
  const pack = (o.pack ?? ((dc) => base(dc)))(o.dc ?? 13)
  if (o.noEvents) {
    delete (pack.content as Record<string, unknown>).event_scope
  }
  const features: Feature[] = []
  if (!o.noMeters) {
    features.push(meterFeature(
      testMeter({ kind: 'affinity', owner: 'npcs', name: '親密度', keyed: 'npc', min: -100, max: 100 }),
      testMeter({ kind: 'fame', owner: 'lewd', name: '豔名', keyed: 'district' }),
    ))
  }
  features.push(worldFeature)
  if (!o.noEvents) features.push(directorFeature, eventRunFeature)
  features.push(workFeature, ...(o.extra ?? []))
  const { game } = makeGame({
    features, content: [METER_CONTENT, pack], seed: o.seed ?? 7,
    pc: { hp: 40, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 100, cash: 100 } },
  })
  game.commit(arrive(game.k, game.state, ...(o.at ?? ['b_hive', 'F1'])))
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const put = (g: G, changes: ReportDraft['changes']) => g.commit(draft(changes))
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const goTo = (g: G, day: number, hour = 10, minute = 0) => advance(g, toMinutes({ day, hour, minute }) - toMinutes(g.state.time))
const stand = (g: G, marker: string, block = 'b_hive') => { g.commit(arrive(g.k, g.state, block, marker)) }
const last = (g: G): Report => g.state.reports[g.state.reports.length - 1]!
const work = (g: G, job: string, hours = 8): Report[] => g.commit(shift(g.k, g.state, job, hours))
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const affinity = (g: G, who = 'npc_boss') => meterOf(g.k, g.state, 'affinity', who)
const setAffinity = (g: G, value: number, who = 'npc_boss') => put(g, [{ op: 'meter', kind: 'affinity', key: who, set: value }])
const fame = (g: G) => meterOf(g.k, g.state, 'fame', 'd_hive')
/** 直接記下一份工作做了幾班、在第幾階段（測試的起點不是一個行動，所以用 ext 變更放進去） */
const setJob = (g: G, id: string, js: Partial<ReturnType<typeof jobStateOf>>) => {
  const w = readWork(g.state)
  // 升階看累計時數：測試起點寫「做了幾班」時，一班照 8 小時記成分鐘
  w.jobs[id] = { ...jobStateOf(g.state, id), ...(js.shifts !== undefined && js.minutes === undefined ? { minutes: js.shifts * 480 } : {}), ...js }
  put(g, [{ op: 'ext', key: 'work', value: w as unknown as Record<string, unknown> }])
}
const rollOf = (d: ReportDraft) => d.timeline.find((b) => b.roll)?.roll

/**
 * 找一個骰面落在 6～15 之間的種子，再把 DC 設成想要的成功程度（大成功：合計 ≥ DC + 5；成功：合計 = DC；失敗：合計 = DC − 1；大失敗：合計 ≤ DC − 5）。
 * setup 是開場之前要做的事（例：換階段）；回傳的遊戲已經準備好，下一個 shift 就會是那個成功程度。
 */
function forDegree(want: Degree, o: Opts & { job?: string; setup?: (g: G) => void } = {}): G {
  const job = o.job ?? 'j_porter'
  for (let seed = 1; seed < 200; seed++) {
    const probe = make({ ...o, seed })
    o.setup?.(probe)
    const roll = rollOf(shift(probe.k, probe.state, job, o.hours ?? 8))!
    if (roll.natural < 6 || roll.natural > 15) continue
    const dc = { critical: roll.total - 5, success: roll.total, fail: roll.total + 1, fumble: roll.total + 5 }[want]
    const g = make({ ...o, seed, dc })
    o.setup?.(g)
    expect(rollOf(shift(g.k, g.state, job, o.hours ?? 8))!.degree).toBe(want)
    return g
  }
  throw new Error('找不到合適的種子')
}

// ---- 一班的報酬 ----

describe('一班的結算：時數 × 時薪 × 階段的倍率 × 成功程度', () => {
  it('8 小時、時薪 10、第一階段：成功 80、大成功 120、失敗 40、大失敗 0 而且雇主親密度 −3', () => {
    const paid: Record<Degree, number> = { critical: 120, success: 80, fail: 40, fumble: 0 }
    for (const d of ['critical', 'success', 'fail', 'fumble'] as const) {
      const g = forDegree(d, { setup: (x) => setAffinity(x, 10) })
      const before = g.state.money.cash
      const [r] = work(g, 'j_porter')
      expect(g.state.money.cash - before).toBe(paid[d])
      expect(r!.outcome.result).toBe(d)
      expect(affinity(g)).toBe(d === 'fumble' ? 7 : 10)
    }
  })

  it('第二階段倍率 1.5：同樣的一班是 120（時薪 10 × 8 × 1.5）；階段的附帶效果也生效（這一階 +3 現金）', () => {
    const g = forDegree('success', { setup: (x) => setJob(x, 'j_porter', { stage: 1, shifts: 5 }) })
    const before = g.state.money.cash
    work(g, 'j_porter')
    expect(g.state.money.cash - before).toBe(120 + 3)
    expect(last(g).triggers![0]!.where).toMatchObject({ stage: '2' })
  })

  it('2、4、6、8 小時照比例；時薪乘出來不是整數就四捨五入', () => {
    const g = forDegree('success')
    const before = g.state.money.cash
    const probe = shift(g.k, g.state, 'j_porter', 2)
    expect(rollOf(probe)!.degree).toBe('success') // 骰面和做幾小時無關
    g.commit(probe)
    expect(g.state.money.cash - before).toBe(20)
    const h = forDegree('success', { pack: variant((c) => { c.job![0]!.wage = 7; c.job![0]!.stages = [{ name: '搬貨', mult: 1 }, { name: '二', mult: 1.5, need: { hours: 40, affinity: 0 } }] }) })
    const b = h.state.money.cash
    h.commit(shift(h.k, h.state, 'j_porter', 4))
    expect(h.state.money.cash - b).toBe(28)
    setJob(h, 'j_porter', { stage: 1 })
    const c = h.state.money.cash
    h.commit(shift(h.k, h.state, 'j_porter', 2)) // 2 × 7 × 1.5 × 1 = 21
    expect(h.state.money.cash - c).toBe(21)
  })

  it('付的是工作寫的那一種錢：搬貨付現金、夜班付帳戶', () => {
    const g = forDegree('success')
    work(g, 'j_porter')
    expect(g.state.money).toEqual({ cred: 100, cash: 180 })
    const h = forDegree('success', { job: 'j_bar', at: ['b_hive', 'F2'] })
    work(h, 'j_bar')
    expect(h.state.money).toEqual({ cred: 180, cash: 100 })
  })

  it('時間多了 8 小時；報告是 downtime、action 是 work.shift，帶 work 觸發點（where：區、街區、設施的種類、工作、階段）', () => {
    const g = make()
    const t0 = toMinutes(g.state.time)
    const [r] = work(g, 'j_porter')
    expect(toMinutes(g.state.time) - t0).toBe(480)
    expect(r!.kind).toBe('downtime')
    expect(r!.action).toBe('work.shift')
    expect(r!.triggers).toEqual([{ point: 'work', where: { district: 'd_hive', block: 'b_hive', facility: 'fac_market', job: 'j_porter', stage: '1' } }])
    expect(r!.timeline.some((b) => b.roll)).toBe(true)
  })

  it('每做一班班數 +1；上一班的結果記下來（班次、成功程度、領了多少、做完的時間）', () => {
    const g = make()
    work(g, 'j_porter', 2)
    work(g, 'j_porter', 4)
    const js = jobStateOf(g.state, 'j_porter')
    expect(js.shifts).toBe(2)
    expect(js.last).toMatchObject({ hours: 4, stage: 1, pay: 'cash' })
    expect(js.last!.at).toBe(toMinutes(g.state.time))
  })

  it('沒有 check 的工作不擲（當成功）：不吃亂數，報酬照成功算', () => {
    const g = make({ at: ['b_hive', 'F3'] })
    const cursor = g.state.rng.cursor
    const [r] = work(g, 'j_back', 8)
    expect(g.state.rng.cursor).toBe(cursor)
    expect(r!.timeline.some((b) => b.roll)).toBe(false)
    expect(g.state.money.cash).toBe(100 + 72)
    expect(jobStateOf(g.state, 'j_back').last!.degree).toBeNull()
  })

  it('每一班的附帶效果生效：夜班每班這一區豔名 +1；沒有人定義豔名的一局，工作寫了豔名就在載入時擋下', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    expect(fame(g)).toBe(0)
    work(g, 'j_bar')
    work(g, 'j_bar', 2)
    expect(fame(g)).toBe(2)
    expect(() => make({ noMeters: true, at: ['b_hive', 'F2'] })).toThrow(ContentError)
  })

  it('沒有人定義親密度時（沒裝 npcs）大失敗不扣、其餘照常；升階條件的親密度當 0', () => {
    const g = forDegree('fumble', { noMeters: true, pack: (dc) => base(dc, (c) => { c.job = c.job!.filter((j) => j.id === 'j_back'); c.job![0]!.check = { attr: 'body', dc }; c.job![0]!.employer = 'npc_boss' }), job: 'j_back', at: ['b_hive', 'F3'] })
    expect(() => work(g, 'j_back')).not.toThrow()
    expect(g.state.money.cash).toBe(100)
    expect(jobStateOf(g.state, 'j_back').shifts).toBe(1)
  })

  it('同一個種子結果一樣（骰面與報告都一樣）；種子不同骰面就會不同', () => {
    const run = (seed: number) => {
      const g = make({ seed })
      const d = shift(g.k, g.state, 'j_porter', 8)
      return { natural: rollOf(d)!.natural, text: JSON.stringify(d) }
    }
    expect(run(5)).toEqual(run(5))
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => run(s).natural)).size).toBeGreaterThan(2)
  })

  it('規則可以用資料蓋掉：work_rule 改倍率與親密度的懲罰；格式不對在載入時擋下', () => {
    const rule = (r: Rec) => variant((c) => { c.work_rule = [{ id: 'default', ...r }] })
    const g = forDegree('success', { pack: rule({ degree_mult: { success: 2 }, hours: [3, 6] }), hours: 6 })
    expect(workRules(g.k).hours).toEqual([3, 6])
    const before = g.state.money.cash
    work(g, 'j_porter', 6)
    expect(g.state.money.cash - before).toBe(120)
    expect(reasonOf(() => shift(g.k, g.state, 'j_porter', 8))).toMatch(/3、6/)
    const f = forDegree('fumble', { pack: rule({ fumble_affinity: 5 }), setup: (x) => setAffinity(x, 10) })
    work(f, 'j_porter')
    expect(affinity(f)).toBe(5)
    expect(() => make({ pack: rule({ hours: [0] }) })).toThrow(ContentError)
    expect(() => make({ pack: rule({ degree_mult: { great: 1 } }) })).toThrow(ContentError)
  })
})

// ---- 能不能做 ----

describe('能不能做：設施、日子與時段、區、活動', () => {
  it('不在那個設施上：被擋並寫出原因；站上對的設施就行（也可以指定某一間）', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    expect(reasonOf(() => shift(g.k, g.state, 'j_porter', 8))).toMatch(/天井市場/)
    expect(shiftBlock(g.k, g.state, 'j_porter', 8)).toMatch(/你現在不在那裡/)
    const before = JSON.stringify(g.state)
    expect(() => shift(g.k, g.state, 'j_porter', 8)).toThrow(ActionBlocked)
    expect(JSON.stringify(g.state)).toBe(before)
    stand(g, 'F1')
    expect(shiftBlock(g.k, g.state, 'j_porter', 8)).toBeNull()
    // 指定某一間：街區/標記
    expect(reasonOf(() => shift(g.k, g.state, 'j_back', 8))).toMatch(/縫縫診所/)
    stand(g, 'F3')
    expect(shiftBlock(g.k, g.state, 'j_back', 8)).toBeNull()
  })

  it('不在街上、不在設施上（沒有 location.facility）也不行', () => {
    const g = make()
    put(g, [{ op: 'location', to: { district: 'd_hive', block: 'b_hive' } }])
    expect(reasonOf(() => shift(g.k, g.state, 'j_porter', 8))).toMatch(/不在那裡/)
  })

  it('工作寫了區：同樣的設施種類在別的區不行', () => {
    const g = make()
    expect(reasonOf(() => shift(g.k, g.state, 'j_far', 8))).toMatch(/不在那裡/)
    stand(g, 'F1', 'b_yard')
    expect(shiftBlock(g.k, g.state, 'j_far', 8)).toBeNull()
  })

  it('不是那一天、不是那個時段的工作被擋並有原因（週四深夜才開）', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    expect(reasonOf(() => shift(g.k, g.state, 'j_stage', 4))).toMatch(/週四深夜/)
    goTo(g, 3, 23)
    expect(shiftBlock(g.k, g.state, 'j_stage', 4)).toBeNull()
    goTo(g, 4, 1) // 過了午夜還是週四的深夜
    expect(shiftBlock(g.k, g.state, 'j_stage', 4)).toBeNull()
    goTo(g, 4, 10)
    expect(reasonOf(() => shift(g.k, g.state, 'j_stage', 4))).toMatch(/只在週四深夜才開/)
    goTo(g, 4, 23)
    expect(shiftBlock(g.k, g.state, 'j_stage', 4)).toMatch(/只在週四深夜才開/) // 週五的深夜
  })

  it('有 commission 的替身活動進行時被擋', () => {
    const g = make({ extra: [COMMISSION_STUB] })
    put(g, [{ op: 'flag', key: 'in_run', value: true }])
    expect(reasonOf(() => shift(g.k, g.state, 'j_porter', 8))).toBe('委託副本進行中，先把它做完。')
    expect(g.blockOf('commit:work.shift')).toBe('委託副本進行中，先把它做完。')
    put(g, [{ op: 'flag', key: 'in_run', value: false }])
    expect(shiftBlock(g.k, g.state, 'j_porter', 8)).toBeNull()
  })

  it('一班只能做規則裡的幾小時；沒有這份工作、還沒有主角都擋下', () => {
    const g = make()
    for (const h of [0, 1, 3, 12]) expect(reasonOf(() => shift(g.k, g.state, 'j_porter', h))).toMatch(/2、4、6、8 小時/)
    expect(reasonOf(() => shift(g.k, g.state, 'j_none', 8))).toMatch(/沒有 j_none/)
    const nobody = make()
    delete (nobody.state as { pc?: string }).pc
    expect(reasonOf(() => shift(nobody.k, nobody.state, 'j_porter', 8))).toMatch(/還沒有主角/)
  })
})

// ---- 階段與升階 ----

describe('升階：做滿班數、雇主親密度到了、額外條件成立，雇主問一次', () => {
  /** 先把班數記到 4、親密度設好，下一班（第 5 班）就會是那一班 */
  const ready = (affinityValue: number, shifts = 4, o: Opts = {}) => {
    const g = forDegree('success', { ...o, setup: (x) => { setJob(x, 'j_porter', { shifts }); setAffinity(x, affinityValue) } })
    return g
  }
  const asked = (g: G) => openEventOf(g.state)

  it('第 5 班做完、雇主親密度 20：這一班的報告帶 launch 一件內嵌的事件，事件視窗開起來，有「升」與「留下」兩個選項', () => {
    const g = ready(20)
    const draftOf = shift(g.k, g.state, 'j_porter', 8)
    expect(draftOf.launch).toHaveLength(1)
    expect(draftOf.launch![0]).toMatchObject({ kind: 'event', origin: { by: 'work', ref: 'j_porter', ext: { job: 'j_porter', from: 0, to: 1 } } })
    g.commit(draftOf)
    expect(asked(g)).not.toBeNull()
    const view = eventView(g.k, g.state)!
    expect(view.options.map((o) => o.id)).toEqual(expect.arrayContaining(['promote', 'stay']))
    expect(jobStateOf(g.state, 'j_porter')).toMatchObject({ shifts: 5, stage: 0, asked: true })
  })

  it('選留下之後不再問：之後再做、條件還在也不問；階段不變', () => {
    const g = ready(20)
    work(g, 'j_porter')
    g.commit(chooseOption(g.k, g.state, 'stay'))
    expect(asked(g)).toBeNull()
    expect(jobStateOf(g.state, 'j_porter')).toMatchObject({ stage: 0, asked: true })
    for (let i = 0; i < 3; i++) {
      const d = shift(g.k, g.state, 'j_porter', 8)
      expect(d.launch).toBeUndefined()
      g.commit(d)
    }
    expect(asked(g)).toBeNull()
    expect(jobStateOf(g.state, 'j_porter').stage).toBe(0)
  })

  it('選升之後階段是 2：寫一份 work.promote，下一班的倍率是 1.5', () => {
    const g = ready(20)
    work(g, 'j_porter')
    const reports = g.commit(chooseOption(g.k, g.state, 'promote'))
    expect(jobStateOf(g.state, 'j_porter')).toMatchObject({ stage: 1, asked: false })
    expect(effectiveStage(g.state.rules, g.k.content.get('job', 'j_porter') as never, 1)).toBe(1)
    const promote = reports.find((r) => r.action === 'work.promote')!
    expect(promote.kind).toBe('downtime')
    expect(promote.outcome.summary).toMatch(/領班/)
    expect(readWork(g.state).announce).toBeNull()
    expect(g.state.reports.map((r) => r.action)).toEqual(expect.arrayContaining(['work.shift', 'event.open', 'event.close', 'work.promote']))
    const next = shift(g.k, g.state, 'j_porter', 8)
    expect(next.triggers![0]!.where).toMatchObject({ stage: '2' })
  })

  it('親密度不到不問；班數不到不問；額外條件不成立不問', () => {
    const lowAffinity = ready(19)
    expect(shift(lowAffinity.k, lowAffinity.state, 'j_porter', 8).launch).toBeUndefined()
    const fewShifts = ready(20, 3)
    expect(shift(fewShifts.k, fewShifts.state, 'j_porter', 8).launch).toBeUndefined()
    // 三階段的夜班：第三階段要豔名 10（這一班自己 +1 豔名也算進去）
    const bar = (fameNow: number) => forDegree('success', {
      job: 'j_bar', at: ['b_hive', 'F2'],
      setup: (x) => { setJob(x, 'j_bar', { stage: 1, shifts: 11 }); setAffinity(x, 40, 'npc_ann'); put(x, [{ op: 'meter', kind: 'fame', key: 'd_hive', set: fameNow }]) },
    })
    const low = bar(8)
    expect(shift(low.k, low.state, 'j_bar', 8).launch).toBeUndefined() // 8 + 1 = 9，還不到
    const enough = bar(9)
    expect(shift(enough.k, enough.state, 'j_bar', 8).launch).toHaveLength(1)
  })

  it('做完這一班才到條件也算：這一班大失敗扣了親密度、剛好掉到條件以下就不問', () => {
    const g = forDegree('fumble', { setup: (x) => { setJob(x, 'j_porter', { shifts: 4 }); setAffinity(x, 20) } })
    expect(shift(g.k, g.state, 'j_porter', 8).launch).toBeUndefined()
    const h = forDegree('fumble', { setup: (x) => { setJob(x, 'j_porter', { shifts: 4 }); setAffinity(x, 23) } })
    expect(shift(h.k, h.state, 'j_porter', 8).launch).toHaveLength(1)
  })

  it('三階段的工作：第二階段選升之後，做滿 12 班、親密度 40、豔名夠了才問第三階段；每一階各問一次', () => {
    const g = forDegree('success', { job: 'j_bar', at: ['b_hive', 'F2'], setup: (x) => { setJob(x, 'j_bar', { shifts: 4 }); setAffinity(x, 60, 'npc_ann') } })
    work(g, 'j_bar')
    expect(openEventOf(g.state)).not.toBeNull()
    g.commit(chooseOption(g.k, g.state, 'promote'))
    expect(jobStateOf(g.state, 'j_bar')).toMatchObject({ stage: 1, asked: false, shifts: 5 })
    put(g, [{ op: 'meter', kind: 'fame', key: 'd_hive', set: 20 }]) // 後面幾班就算大失敗扣 3，親密度也還在 40 以上
    setJob(g, 'j_bar', { shifts: 10 })
    const eleven = shift(g.k, g.state, 'j_bar', 8)
    expect(eleven.launch).toBeUndefined()
    g.commit(eleven)
    const twelve = shift(g.k, g.state, 'j_bar', 8)
    expect(twelve.launch).toHaveLength(1)
    expect(twelve.launch![0]!.origin!.ext).toMatchObject({ from: 1, to: 2 })
    g.commit(twelve)
    g.commit(chooseOption(g.k, g.state, 'promote'))
    expect(jobStateOf(g.state, 'j_bar').stage).toBe(2)
    expect(shift(g.k, g.state, 'j_bar', 8).triggers![0]!.where).toMatchObject({ stage: '3' })
  })

  it('三階段的工作第三階段的標籤被玩家關掉：做滿 12 班也不問；階段停在第二階段', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    g.state.rules.contentOff = ['x_deep']
    setJob(g, 'j_bar', { stage: 1, shifts: 11 })
    setAffinity(g, 100, 'npc_ann')
    put(g, [{ op: 'meter', kind: 'fame', key: 'd_hive', set: 50 }])
    for (let i = 0; i < 3; i++) {
      const d = shift(g.k, g.state, 'j_bar', 8)
      expect(d.launch).toBeUndefined()
      g.commit(d)
    }
    expect(jobStateOf(g.state, 'j_bar').shifts).toBe(14)
    expect(openEventOf(g.state)).toBeNull()
    // 把標籤打開，條件還在，就問了
    g.state.rules.contentOff = []
    expect(shift(g.k, g.state, 'j_bar', 8).launch).toHaveLength(1)
  })

  it('第二階段的標籤被關掉：第二、第三階段都不出現，這份工作就停在第一階段（班數與親密度再多也不問）', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    g.state.rules.contentOff = ['x_mid']
    setJob(g, 'j_bar', { shifts: 30 })
    setAffinity(g, 100, 'npc_ann')
    put(g, [{ op: 'meter', kind: 'fame', key: 'd_hive', set: 50 }])
    expect(shift(g.k, g.state, 'j_bar', 8).launch).toBeUndefined()
    // 已經升上去的人，標籤被關掉之後現在是前一階：報酬照第一階段
    setJob(g, 'j_bar', { stage: 2 })
    expect(shift(g.k, g.state, 'j_bar', 8).triggers![0]!.where).toMatchObject({ stage: '1' })
    expect(jobsHere(g.k, g.state).find((j) => j.id === 'j_bar')!.stages.map((s) => s.number)).toEqual([1])
  })

  it('沒有裝事件視窗：照常打工，不問也不記成問過（之後裝了再問）', () => {
    const g = ready(20, 4, { noEvents: true })
    const d = shift(g.k, g.state, 'j_porter', 8)
    expect(d.launch).toBeUndefined()
    g.commit(d)
    expect(jobStateOf(g.state, 'j_porter')).toMatchObject({ shifts: 5, asked: false })
  })

  it('事件開著時不能再打工（活動的白名單）；回應之前先把它處理完', () => {
    const g = ready(20)
    work(g, 'j_porter')
    expect(openEventOf(g.state)).not.toBeNull()
    expect(shiftBlock(g.k, g.state, 'j_porter', 8)).not.toBeNull()
  })

  it('promotionDue 與 needProgress：照現在的狀態算進度（班數、親密度、額外條件）', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    const job = g.k.content.get('job', 'j_bar') as never
    setAffinity(g, 25, 'npc_ann')
    setJob(g, 'j_bar', { shifts: 5 })
    expect(promotionDue(g.k, g.state, job, jobStateOf(g.state, 'j_bar'))).toBe(true)
    expect(needProgress(g.k, g.state, job, jobStateOf(g.state, 'j_bar'), 0)).toBeNull()
    expect(needProgress(g.k, g.state, job, jobStateOf(g.state, 'j_bar'), 2)).toEqual({
      hours: { have: 40, need: 96, ok: false }, affinity: { have: 25, need: 40, ok: false }, extra: false, met: false,
    })
  })
})

describe('觸發點 work 接上導演', () => {
  const tips = variant((c) => {
    c.event = [
      { id: 'ev_tip', scope: 'street', triggers: ['work'], where: { job: 'j_porter', stage: '1' }, blocking: false, text: '客人塞了小費。', effects: [{ kind: 'cash', amount: 7 }] },
      { id: 'ev_tip2', scope: 'street', triggers: ['work'], where: { job: 'j_porter', stage: '2' }, blocking: false, text: '領班的小費。', effects: [{ kind: 'cash', amount: 70 }] },
    ]
  })

  it('每一班的 work 觸發點照 where 找到事件：工作與階段對得上的那一件放行', () => {
    const g = forDegree('success', { pack: tips })
    const before = g.state.money.cash
    work(g, 'j_porter')
    expect(g.state.money.cash - before).toBe(80 + 7) // 第一階段的小費事件
    // 第二階段的領班小費（換階段之後的那一班大失敗也好，錢至少有小費）
    setJob(g, 'j_porter', { stage: 1 })
    const h = g.state.money.cash
    work(g, 'j_porter')
    expect(g.state.money.cash - h).toBeGreaterThanOrEqual(70)
    expect(g.state.money.cash - h).not.toBe(7)
  })
})

// ---- 條件 job_stage ----

describe('條件 job_stage', () => {
  const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('第幾階段（從 1 起算）：沒做過是第 1 階；升了就變；被內容篩選卡住的算前一階；沒有這份工作是不成立', () => {
    const g = make()
    expect(test(g, { kind: 'job_stage', job: 'j_porter', min: 1 })).toBe(true)
    expect(test(g, { kind: 'job_stage', job: 'j_porter', min: 2 })).toBe(false)
    setJob(g, 'j_porter', { stage: 1 })
    expect(test(g, { kind: 'job_stage', job: 'j_porter', min: 2 })).toBe(true)
    expect(test(g, { kind: 'job_stage', job: 'j_porter', max: 1 })).toBe(false)
    expect(test(g, { kind: 'job_stage', job: 'j_nope', min: 1 })).toBe(false)
    setJob(g, 'j_bar', { stage: 2 })
    expect(test(g, { kind: 'job_stage', job: 'j_bar', min: 3 })).toBe(true)
    g.state.rules.contentOff = ['x_deep']
    expect(test(g, { kind: 'job_stage', job: 'j_bar', min: 3 })).toBe(false)
    expect(test(g, { kind: 'job_stage', job: 'j_bar', min: 2 })).toBe(true)
  })

  it('格式：要寫 job 與 min 或 max（1～3）', () => {
    const g = make()
    for (const bad of [{ kind: 'job_stage' }, { kind: 'job_stage', job: 'j_bar' }, { kind: 'job_stage', job: 'j_bar', min: 0 }, { kind: 'job_stage', job: 'j_bar', min: 4 }, { kind: 'job_stage', min: 2 }]) {
      expect(g.k.conditions.validate(bad)).not.toEqual([])
    }
    expect(g.k.conditions.validate({ kind: 'job_stage', job: 'j_bar', min: 2, max: 3 })).toEqual([])
  })
})

// ---- 這裡能做的工作 ----

describe('jobsHere 與格子上的「打工」', () => {
  it('這個位置能做的工作：只列設施對上的；每一份有階段、下一階的條件與進度、預計的錢與成功率、不能做的原因', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    setAffinity(g, 12, 'npc_ann')
    setJob(g, 'j_bar', { shifts: 3 })
    const list = jobsHere(g.k, g.state)
    expect(list.map((j) => j.id).sort()).toEqual(['j_bar', 'j_stage'])
    const bar = list.find((j) => j.id === 'j_bar')!
    expect(bar).toMatchObject({ name: '夜班', facility: '過載', pay: 'cred', shifts: 3, stage: 1, asked: false, block: null })
    expect(bar.employer).toEqual({ id: 'npc_ann', name: '安', affinity: 12 })
    expect(bar.stages.map((s) => [s.number, s.name, s.wage, s.adult, s.current, s.reached])).toEqual([
      [1, '吧台', 10, false, true, true], [2, '包廂', 15, true, false, false], [3, '貴賓室', 25, true, false, false],
    ])
    expect(bar.next).toMatchObject({ number: 2, name: '包廂', need: { hours: { have: 24, need: 40, ok: false }, affinity: { have: 12, need: 20, ok: false }, extra: null, met: false } })
    expect(bar.stages[2]!.need!.extra).toBe(false)
    expect(bar.options.map((o) => [o.hours, o.expected, o.by_degree])).toEqual([
      [2, 20, { critical: 30, success: 20, fail: 10, fumble: 0 }],
      [4, 40, { critical: 60, success: 40, fail: 20, fumble: 0 }],
      [6, 60, { critical: 90, success: 60, fail: 30, fumble: 0 }],
      [8, 80, { critical: 120, success: 80, fail: 40, fumble: 0 }],
    ])
    expect(toMinutes(bar.options[3]!.to) - toMinutes(bar.options[3]!.from)).toBe(480)
    expect(bar.check).toMatchObject({ attr: 'charm', dc: 13 })
    const chances = bar.check!.chances
    expect(Object.values(chances).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    expect(chances.critical).toBeGreaterThan(0)
    // 現在不能做的原因
    const stage = list.find((j) => j.id === 'j_stage')!
    expect(stage.block).toMatch(/週四深夜/)
    expect(stage.check).toBeNull()
    // 站在沒有工作的設施上沒有
    stand(g, 'F1')
    expect(jobsHere(g.k, g.state).map((j) => j.id)).toEqual(['j_porter'])
  })

  it('預計的成功率與真的擲出來的結果對得上：200 個種子擲出來的成功程度比例，和算出來的成功率差不多', () => {
    const g = make()
    const chances = jobsHere(g.k, g.state)[0]!.check!.chances
    const tally: Record<string, number> = { critical: 0, success: 0, fail: 0, fumble: 0 }
    for (let seed = 1; seed <= 200; seed++) {
      const x = make({ seed })
      tally[rollOf(shift(x.k, x.state, 'j_porter', 8))!.degree]!++
    }
    for (const d of ['critical', 'success', 'fail', 'fumble'] as const) expect(Math.abs(tally[d]! / 200 - chances[d])).toBeLessThan(0.1)
    // 體格 10、沒有基本功、DC 13：骰 18 以上（含自然 20）大成功、13～17 成功、9～12 失敗、8 以下（含自然 1）大失敗
    expect(chances.critical).toBeCloseTo(3 / 20, 10)
    expect(chances.success).toBeCloseTo(5 / 20, 10)
    expect(chances.fail).toBeCloseTo(4 / 20, 10)
    expect(chances.fumble).toBeCloseTo(8 / 20, 10)
  })

  it('站上對的設施：usesOf 列「打工」；全部都現在不能做時灰掉並寫原因；別的格子沒有', () => {
    const g = make()
    expect(g.gridView()!.here.uses).toContainEqual({ id: 'work.shift', name: '打工', block: null })
    stand(g, 'F2')
    expect(g.gridView()!.here.uses).toContainEqual({ id: 'work.shift', name: '打工', block: null }) // 夜班現在能做
    // 只剩週四深夜的舞台的設施：灰掉
    const only = make({ at: ['b_hive', 'F2'], pack: variant((c) => { c.job = c.job!.filter((j) => j.id === 'j_stage') }) })
    const use = only.gridView()!.here.uses.find((u) => u.id === 'work.shift')!
    expect(use.block).toMatch(/週四深夜/)
    // 沒有工作的設施：什麼都不列
    const none = make({ at: ['b_hive', 'F3'], pack: variant((c) => { c.job = c.job!.filter((j) => j.id === 'j_stage') }) })
    expect(none.gridView()!.here.uses.map((u) => u.id)).not.toContain('work.shift')
  })

  it('被內容篩選關掉的階段不顯示', () => {
    const g = make({ at: ['b_hive', 'F2'] })
    g.state.rules.contentOff = ['x_deep']
    expect(jobsHere(g.k, g.state).find((j) => j.id === 'j_bar')!.stages.map((s) => s.number)).toEqual([1, 2])
    expect(jobsHere(g.k, g.state).find((j) => j.id === 'j_bar')!.next!.number).toBe(2)
  })
})

// ---- 內容的格式 ----

describe('內容的格式：載入時擋下', () => {
  const bad = (patch: (j: Rec) => void) => () => make({ pack: variant((c) => patch(c.job![0]!)) })

  it('階段要兩個或三個；第一個沒有 need，其餘都要有；時薪、付哪種錢、檢定、日子的格式', () => {
    expect(bad((j) => { j.stages = [j.stages[0]] })).toThrow(ContentError)
    expect(bad((j) => { j.stages = [...stages3(), { name: '四', mult: 3, need: { hours: 160, affinity: 50 } }] })).toThrow(ContentError)
    expect(bad((j) => { j.stages[0].need = { shifts: 1, affinity: 0 } })).toThrow(ContentError)
    expect(bad((j) => { delete j.stages[1].need })).toThrow(ContentError)
    expect(bad((j) => { j.stages[1].need.hours = 0 })).toThrow(ContentError)
    expect(bad((j) => { j.wage = -1 })).toThrow(ContentError)
    expect(bad((j) => { j.pay = 'gold' })).toThrow(ContentError)
    expect(bad((j) => { j.check = { attr: 'luck', dc: 10 } })).toThrow(ContentError)
    expect(bad((j) => { j.check = { attr: 'body', dc: 99 } })).toThrow(ContentError)
    expect(bad((j) => { j.days = { weekday: [7] } })).toThrow(ContentError)
    expect(bad((j) => { j.days = { time: ['evening'] } })).toThrow(ContentError)
    expect(bad((j) => { j.stages[1].mult = 0 })).toThrow(ContentError)
  })

  it('指到不存在的東西：雇主、設施、街區、區、效果的種類、額外條件的種類；沒有雇主的工作不能要親密度', () => {
    expect(bad((j) => { j.employer = 'npc_ghost' })).toThrow(/npc_ghost/)
    expect(bad((j) => { j.facility = 'fac_ghost' })).toThrow(ContentError)
    expect(bad((j) => { j.facility = 'b_nowhere/F1' })).toThrow(ContentError)
    expect(bad((j) => { j.facility = 'b_hive/F9' })).toThrow(ContentError)
    expect(bad((j) => { j.district = 'd_ghost' })).toThrow(ContentError)
    expect(bad((j) => { j.perks = [{ kind: 'no_such_effect', amount: 1 }] })).toThrow(ContentError)
    expect(bad((j) => { j.stages[1].perks = [{ kind: 'no_such_effect', amount: 1 }] })).toThrow(ContentError)
    expect(bad((j) => { j.stages[1].need.extra = { kind: 'no_such_condition' } })).toThrow(ContentError)
    expect(bad((j) => { delete j.employer })).toThrow(ContentError)
    expect(() => make()).not.toThrow()
  })

  it('額外條件可以寫一個或一串', () => {
    const g = make({ pack: variant((c) => { c.job![0]!.stages[1].need.extra = [{ kind: 'flag', key: 'a', value: true }, { kind: 'fame', min: 1 }] }) })
    const job = g.k.content.get('job', 'j_porter') as never
    expect(needProgress(g.k, g.state, job, { minutes: 5 * 480 }, 1)!.extra).toBe(false)
  })
})

// ---- 不變式與交界 ----

describe('交界', () => {
  it('commitNarrated 照樣走（AI 關著就等於 commit）：一班的報告與 commit 一模一樣', async () => {
    const a = make({ seed: 9 })
    const b = make({ seed: 9 })
    a.commit(shift(a.k, a.state, 'j_porter', 4))
    const r = await b.commitNarrated(shift(b.k, b.state, 'j_porter', 4), { mode: 'work' })
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => x.action)).toContain('work.shift')
    expect(b.state.money).toEqual(a.state.money)
    expect(jobStateOf(b.state, 'j_porter').shifts).toBe(1)
    expect(toMinutes(b.state.time)).toBe(toMinutes(a.state.time))
  })

  it('存檔的狀態讀得回來：state.ext.work 形狀不對的部分當成空的，不丟錯', () => {
    const g = make()
    g.state.ext.work = { jobs: { j_porter: { shifts: 'x', stage: -3, last: { degree: 'great' } }, j_bar: 7 }, announce: 'oops' }
    expect(jobStateOf(g.state, 'j_porter')).toEqual({ shifts: 0, minutes: 0, stage: 0, asked: false, last: null })
    expect(jobStateOf(g.state, 'j_bar')).toEqual({ shifts: 0, minutes: 0, stage: 0, asked: false, last: null })
    expect(readWork(g.state).announce).toBeNull()
    delete g.state.ext.work
    expect(readWork(g.state)).toEqual({ jobs: {}, announce: null })
  })

  it('一班的變更要整份套得上去：親密度、豔名、錢、時間、班數同一份報告', () => {
    const g = forDegree('fumble', { at: ['b_hive', 'F2'], job: 'j_bar', setup: (x) => setAffinity(x, 5, 'npc_ann') })
    const [r] = work(g, 'j_bar')
    expect(r!.changes.map((c) => c.op)).toEqual(expect.arrayContaining(['time', 'meter', 'ext', 'rng']))
    expect(affinity(g, 'npc_ann')).toBe(2)
    expect(fame(g)).toBe(1)
    expect(g.state.money.cred).toBe(100) // 大失敗沒有錢
  })

  it('makeActor 的主角屬性影響成功率：體格高的人搬貨的加值比較大', () => {
    const weak = make({ pc: { attrs: { body: 8 } } })
    const strong = make({ pc: { attrs: { body: 16 } } })
    const bonus = (g: G) => jobsHere(g.k, g.state)[0]!.check!.bonus
    expect(bonus(strong) - bonus(weak)).toBe(4)
    expect(makeActor({}).attrs.body).toBe(10)
  })
})
