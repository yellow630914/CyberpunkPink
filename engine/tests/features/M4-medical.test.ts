// 驗收測試：dev/work/M4-medical.md（cpp-feature）。規格：DOWNTIME 2.2 節（重傷限制）、3.1 節（治療的表）；COMBAT_SYSTEM 第 6 節（重創）；TRADE 3.4 節；
// SKILL_TREES 改造師「戰地手術」「全面翻修」與日常的「手術」；dev/adr/0013 D3；dev/adr/0019 第五節與 P46。
// 內容一律用測試自帶的最小假資料：三種診所與一間旅館、一個醫療包、重創的三種輕狀態。站上設施用真的 world；住處用測試的替身條件 at_home（旗標 home）；
// 自己動刀的條件 ability 由測試的替身註冊（沒裝就沒有自己動刀）。衍生數值 armor_body（gear 的那個）也是替身。
// 骰子：用 vi.spyOn(Rng.prototype, 'next') 固定每一次 next() 的值（只包住「建草稿」那一步，提交不受影響）。自然骰 = 1 + floor(next × 20)；d6 = 1 + floor(next × 6)；d4 = 1 + floor(next × 4)。
//
// 時間：測試從第 3 天 10:00 開始。診所單價：正規 8、無照 4、黑 5；生命值上限 40（體格 10）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, BattleBlocked, BattleRun, ContentError, Rng, clone, effectCtx, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { cyberOf, cyberwareFeature } from '../../src/features/cyberware'
import { productPrice } from '../../src'
import { medicalFeature, aidBlock, aidDraft, aidQuote, clinicBlock, clinicHealDraft, clinicQuote, medicalRules, medicalView, woundSurgeryBlock, woundSurgeryDraft, woundSurgeryProblems, woundSurgeryQuote, woundsOf } from '../../src/features/medical'
import { restFeature, sleepDraft } from '../../src/features/rest'
import { arrive, worldFeature } from '../../src/features/world'
import { BATTLE_SETUPS, TEST_NET_COMBAT, makeActor, makeBattleGame, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
} as never

const STATUS = (id: string, name: string, over: Rec = {}): Rec => ({ id, name, desc: `${name}。`, until: 'battle_end', kind: 'wound', ...over })
const STATUSES = [STATUS('limb_hurt', '肢體受創', { mods: { hit: -2 } }), STATUS('dazed', '暈眩'), STATUS('bleeding', '流血')]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_clinic', name: '診所', clinic: { grade: 'clinic' } },
      { id: 'fac_unlic', name: '無照診所', clinic: { grade: 'unlicensed' } },
      { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
      { id: 'fac_hotel', name: '旅館', sleep: { rate: 0.6, cost: 0 } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '正規診所' }, F2: { type: 'fac_unlic', name: '無照診所' }, F3: { type: 'fac_black', name: '黑診所' }, F4: { type: 'fac_hotel', name: '旅館' } } }],
    item: [
      { id: 'it_medkit', name: '醫療包', desc: '急救用的。', category: 'consumable', grade: 1, size: 1, legal: 'free', tags: ['medkit'] },
      { id: 'it_rock', name: '石頭', desc: '一顆石頭。', category: 'consumable', grade: 1, size: 1, legal: 'free' },
    ],
    battle_status: structuredClone(STATUSES),
  }
  patch(c)
  return { id: 'medical_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：衍生數值 armor_body（gear 的那個，基礎 3）、條件 at_home（旗標 home 在就是在家）。 */
const STUBS: Feature = {
  id: 'med_stubs',
  install(k) {
    k.stats.defineStat({ id: 'armor_body', owner: 'med_stubs', name: '身上那件護甲', base: () => 3 })
    k.conditions.register<Condition>({ kind: 'at_home', owner: 'med_stubs', validate: () => [], test: (_c, { state }) => state.flags.home === true })
  },
}
/** 測試的替身：條件 ability 永遠成立（abilities 註冊的那個；沒裝它就沒有自己動刀）。 */
const ABILITY_OK: Feature = {
  id: 'ability_ok',
  install(k) {
    k.conditions.register<Condition>({ kind: 'ability', owner: 'ability_ok', validate: () => [], test: () => true })
  },
}
/** 測試的替身：條件 ability 只有隊友 mate 成立。 */
const ABILITY_MATE: Feature = {
  id: 'ability_mate',
  install(k) {
    k.conditions.register<Condition>({ kind: 'ability', owner: 'ability_mate', validate: () => [], test: (_c, { actor }) => actor === 'mate' })
  },
}

interface Opts {
  pc?: Rec
  money?: { cred: number; cash: number }
  ability?: 'ok' | 'mate' | false
  /** 裝睡覺用的 rest（它自己註冊 at_home，所以不裝替身） */
  rest?: boolean
  inventory?: Rec[]
  pack?: ContentPack
  mate?: boolean
  extra?: Feature[]
}
const make = (o: Opts = {}) => {
  const features: Feature[] = [
    characterFeature, worldFeature, ...(o.rest ? [restFeature, { id: 'med_stubs2', install: (k: any) => k.stats.defineStat({ id: 'armor_body', owner: 'med_stubs2', name: '護甲', base: () => 3 }) } as Feature] : [STUBS]),
    medicalFeature, ...(o.ability === 'ok' ? [ABILITY_OK] : o.ability === 'mate' ? [ABILITY_MATE] : []), ...(o.extra ?? []),
  ]
  const { game } = makeGame({
    features, content: [o.pack ?? pack()], seed: 7, pc: { hp: 40, skills: { medicine: 2, athletics: 1 }, ...(o.pc ?? {}) },
    actors: o.mate ? [makeActor({ id: 'mate', role: 'companion', name: '夥伴', hp: 20 })] : [],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 }, inventory: structuredClone((o.inventory ?? []) as never) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const pc = (g: G) => g.state.actors.pc!
const now = (g: G) => toMinutes(g.state.time)
const has = (g: G, id: string, cond: string) => g.state.actors[id]!.conditions.some((c) => c.id === cond)
const condOf = (g: G, id: string, cond: string) => g.state.actors[id]!.conditions.find((c) => c.id === cond)
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const KIT = [{ id: 'it_medkit', qty: 1 }]
const aid = (g: G, o: Partial<{ by: string; target: string }> = {}) => aidDraft(g.k, g.state, { by: 'pc', target: 'pc', ...o })

/** 把每一次 next() 依序固定成 values（用完之後一直回最後一個），只包住 fn。 */
function withDice<T>(values: number | number[], fn: () => T): T {
  const list = Array.isArray(values) ? values : [values]
  const spy = vi.spyOn(Rng.prototype, 'next')
  list.forEach((v, i) => (i === list.length - 1 ? spy.mockReturnValue(v) : spy.mockReturnValueOnce(v)))
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
afterEach(() => { vi.restoreAllMocks() })

// ===================================================================================================================

describe('急救（DOWNTIME 3.1 節）', () => {
  it('報價：DC 13、技術 0 ＋ 醫療 2 = 加值 2；10 分鐘；沒有醫療包時沒有那一筆', () => {
    const g = make({ pc: { hp: 20 } })
    expect(aidBlock(g.k, g.state, { by: 'pc', target: 'pc' })).toBeNull()
    const q = aidQuote(g.k, g.state, { by: 'pc', target: 'pc' })!
    expect(q).toMatchObject({ dc: 13, minutes: 10, bonus: 2, kit: null, medicine: 2 })
    expect(q.parts.map((p) => p.label)).not.toContain('醫療包')
  })

  it('成功：回 1d6 ＋ 醫療等級（骰面 13、d6 = 4：回 6）、掛 treated 與 aided、時間 +10 分鐘', () => {
    const g = make({ pc: { hp: 20 } })
    const t0 = now(g)
    const d = withDice([0.6, 0.6], () => aid(g))
    expect(d.outcome.result).toBe('success')
    expect(d.timeline.find((b) => b.roll)!.roll).toMatchObject({ natural: 13, total: 15, dc: 13, degree: 'success' })
    expect(d.changes).toContainEqual({ op: 'rng', advance: 1 })
    g.commit(d)
    expect(pc(g).hp).toBe(26)
    expect(now(g) - t0).toBe(10)
    expect(has(g, 'pc', 'aided')).toBe(true)
    expect(condOf(g, 'pc', 'treated')!.until).toBe(t0 + 10 + 1440)
  })

  it('大成功：回兩倍（骰面 20、d6 = 6：(6 + 2) × 2 = 16）；不會補超過上限', () => {
    const g = make({ pc: { hp: 20 } })
    const d = withDice(0.99, () => aid(g))
    expect(d.outcome.result).toBe('critical')
    g.commit(d)
    expect(pc(g).hp).toBe(36)
    expect(has(g, 'pc', 'treated')).toBe(true)
    const h = make({ pc: { hp: 35 } })
    h.commit(withDice(0.99, () => aid(h)))
    expect(h.state.actors.pc!.hp).toBe(40)
  })

  it('失敗：只掛 aided，生命值不變、不算處理過', () => {
    const g = make({ pc: { hp: 20 } })
    const d = withDice(0.35, () => aid(g))
    expect(d.timeline.find((b) => b.roll)!.roll).toMatchObject({ natural: 8, total: 10, degree: 'fail' })
    g.commit(d)
    expect(pc(g).hp).toBe(20)
    expect(has(g, 'pc', 'aided')).toBe(true)
    expect(has(g, 'pc', 'treated')).toBe(false)
  })

  it('大失敗：−1d4 也掛 aided；生命值最少剩 1', () => {
    const g = make({ pc: { hp: 20 } })
    // 骰面 5（合計 7，差 6）是大失敗；d4 = 1 + floor(0.99 × 4) = 4
    const d = withDice([0.2, 0.99], () => aid(g))
    expect(d.outcome.result).toBe('fumble')
    g.commit(d)
    expect(pc(g).hp).toBe(16)
    expect(has(g, 'pc', 'aided')).toBe(true)
    expect(has(g, 'pc', 'treated')).toBe(false)
    const low = make({ pc: { hp: 3 } })
    low.commit(withDice([0.2, 0.99], () => aid(low)))
    expect(low.state.actors.pc!.hp).toBe(1)
    const one = make({ pc: { hp: 1 } })
    const dd = withDice([0.2, 0.99], () => aid(one))
    expect(dd.changes.some((c) => c.op === 'actor.track')).toBe(false)
    one.commit(dd)
    expect(one.state.actors.pc!.hp).toBe(1)
    expect(has(one, 'pc', 'aided')).toBe(true)
  })

  it('醫療包：檢定的組成多一筆 +2（不消耗）', () => {
    const g = make({ pc: { hp: 20 }, inventory: KIT })
    const q = aidQuote(g.k, g.state, { by: 'pc', target: 'pc' })!
    expect(q).toMatchObject({ bonus: 4, kit: 'it_medkit' })
    const d = withDice(0.6, () => aid(g))
    const roll = d.timeline.find((b) => b.roll)!.roll!
    expect(roll.parts).toContainEqual({ label: '醫療包', value: 2, source: 'situation' })
    expect(roll.total).toBe(13 + 4)
    g.commit(d)
    expect(g.state.inventory).toEqual([{ id: 'it_medkit', qty: 1 }])
    // 沒有帶 medkit 標籤的東西不算
    const other = make({ pc: { hp: 20 }, inventory: [{ id: 'it_rock', qty: 1 }] })
    expect(aidQuote(other.k, other.state, { by: 'pc', target: 'pc' })!.kit).toBeNull()
  })

  it('急救過的人第二次被擋並有原因；他再挨一下（生命往下）之後記號沒了、又可以急救', () => {
    const g = make({ pc: { hp: 20 } })
    g.commit(withDice(0.6, () => aid(g)))
    const why = aidBlock(g.k, g.state, { by: 'pc', target: 'pc' })!
    expect(why).toContain('已經急救過')
    expect(reasonOf(() => aid(g))).toBe(why)
    // 補血不算再受傷
    g.commit(draft([{ op: 'actor.track', id: 'pc', track: 'hp', delta: 2 }], 'test.heal'))
    expect(has(g, 'pc', 'aided')).toBe(true)
    // 挨一下
    const reports = g.commit(draft([{ op: 'actor.track', id: 'pc', track: 'hp', delta: -5 }], 'test.hurt'))
    expect(reports.map((r) => r.action)).toEqual(['test.hurt', 'medical.reinjured'])
    expect(has(g, 'pc', 'aided')).toBe(false)
    expect(has(g, 'pc', 'treated')).toBe(false)
    expect(aidBlock(g.k, g.state, { by: 'pc', target: 'pc' })).toBeNull()
  })

  it('別人受傷不動這個人的記號；沒有記號的人受傷不多接報告', () => {
    const g = make({ pc: { hp: 20 }, mate: true })
    g.commit(withDice(0.6, () => aid(g)))
    const r1 = g.commit(draft([{ op: 'actor.track', id: 'mate', track: 'hp', delta: -3 }], 'test.hurt'))
    expect(r1.map((r) => r.action)).toEqual(['test.hurt'])
    expect(has(g, 'pc', 'aided')).toBe(true)
    const r2 = g.commit(draft([{ op: 'actor.track', id: 'mate', track: 'hp', delta: -3 }], 'test.hurt'))
    expect(r2).toHaveLength(1)
  })

  it('大失敗扣的血不會把剛掛上的 aided 拿掉（medical 自己的報告不算再受傷）', () => {
    const g = make({ pc: { hp: 20 } })
    const reports = g.commit(withDice([0.2, 0.5], () => aid(g)))
    expect(reports.map((r) => r.action)).toEqual(['medical.aid'])
    expect(has(g, 'pc', 'aided')).toBe(true)
  })

  it('隊友可以替主角急救（用隊友的醫療等級）；不在隊上、生命值滿的、戰鬥中的、找不到人的都被擋', () => {
    const g = make({ pc: { hp: 20 }, mate: true })
    expect(aidQuote(g.k, g.state, { by: 'mate', target: 'pc' })).toMatchObject({ by: 'mate', medicine: 0 })
    expect(aidBlock(g.k, g.state, { by: 'mate', target: 'pc' })).toBeNull()
    g.commit(withDice(0.6, () => aid(g, { by: 'mate' })))
    expect(pc(g).hp).toBe(20 + 4)
    expect(has(g, 'pc', 'aided')).toBe(true)
    // 生命值是滿的
    const full = make()
    expect(aidBlock(full.k, full.state, { by: 'pc', target: 'pc' })).toBe('測試主角的生命值已經是滿的。')
    // 找不到人
    expect(aidBlock(g.k, g.state, { by: 'pc', target: 'nobody' })).toBe('找不到被急救的人。')
    expect(aidBlock(g.k, g.state, { by: 'nobody', target: 'pc' })).toBe('找不到動手的人。')
    // 不在隊上
    const stranger = make({ pc: { hp: 20 } })
    stranger.state.actors.npc = makeActor({ id: 'npc', role: 'npc', name: '路人', hp: 5 })
    expect(aidBlock(stranger.k, stranger.state, { by: 'pc', target: 'npc' })).toBe('被急救的人不在隊上。')
    // 戰鬥中
    const fight = makeBattleGame({ features: [characterFeature, worldFeature, combatFeature, medicalFeature], content: [pack()] }).game
    fight.state.actors.pc!.hp = 10
    expect(aidBlock(fight.k, fight.state, { by: 'pc', target: 'pc' })).toBe('戰鬥中不能這樣處理，要用戰鬥裡的行動。')
    expect(reasonOf(() => aidDraft(fight.k, fight.state, { by: 'pc', target: 'pc' }))).toContain('戰鬥中')
  })

  it('規則表可以蓋掉：DC、時間、醫療包的加值、標籤', () => {
    const g = make({ pc: { hp: 20 }, inventory: [{ id: 'it_rock', qty: 1 }], pack: pack((c) => { c.medical_rule = [{ id: 'default', aid: { dc: 15, minutes: 20, kit_bonus: 3, kit_tag: 'rock' } }]; c.item![1]!.tags = ['rock'] }) })
    expect(aidQuote(g.k, g.state, { by: 'pc', target: 'pc' })).toMatchObject({ dc: 15, minutes: 20, bonus: 5, kit: 'it_rock' })
  })
})

describe('診所治療（DOWNTIME 3.1 節；TRADE 3.4 節）', () => {
  it('正規診所：缺 14 點扣 112、時間 +2 小時、回滿、掛 treated', () => {
    const g = make({ pc: { hp: 26 } })
    stand(g, 'F1')
    const q = clinicQuote(g.k, g.state, { target: 'pc' })!
    expect(q).toMatchObject({ grade: 'clinic', price: 8, missing: 14, points: 14, full: true, cost: 112, minutes: 120, pay: 'cred' })
    expect(clinicBlock(g.k, g.state, { target: 'pc' })).toBeNull()
    const t0 = now(g)
    const d = clinicHealDraft(g.k, g.state, { target: 'pc' })
    expect(d.action).toBe('medical.heal')
    g.commit(d)
    expect(pc(g).hp).toBe(40)
    expect(g.state.money).toEqual({ cred: 20000 - 112, cash: 1000 })
    expect(now(g) - t0).toBe(120)
    expect(condOf(g, 'pc', 'treated')!.until).toBe(t0 + 120 + 1440)
  })

  it('無照診所每點 4（56）、黑診所每點 5（70）', () => {
    const a = make({ pc: { hp: 26 } })
    stand(a, 'F2')
    expect(clinicQuote(a.k, a.state, { target: 'pc' })).toMatchObject({ grade: 'unlicensed', cost: 56 })
    a.commit(clinicHealDraft(a.k, a.state, { target: 'pc' }))
    expect(a.state.money.cred).toBe(20000 - 56)
    const b = make({ pc: { hp: 26 } })
    stand(b, 'F3')
    expect(clinicQuote(b.k, b.state, { target: 'pc' })).toMatchObject({ grade: 'black', cost: 70, minutes: 120 })
    b.commit(clinicHealDraft(b.k, b.state, { target: 'pc' }))
    expect(b.state.money.cred).toBe(20000 - 70)
    expect(pc(b).hp).toBe(40)
  })

  it('時間每 10 點一小時、進位：缺 10 點 1 小時、缺 11 點 2 小時、缺 1 點 1 小時', () => {
    for (const [missing, minutes] of [[1, 60], [10, 60], [11, 120], [20, 120], [21, 180]] as const) {
      const g = make({ pc: { hp: 40 - missing } })
      stand(g, 'F1')
      expect(clinicQuote(g.k, g.state, { target: 'pc' })!.minutes, `缺 ${missing}`).toBe(minutes)
    }
  })

  it('錢不夠：治得起幾點就治幾點（只夠 5 點回 5 點、40 元、1 小時）；一點都治不起被擋', () => {
    const g = make({ pc: { hp: 26 }, money: { cred: 0, cash: 41 } })
    stand(g, 'F1')
    const q = clinicQuote(g.k, g.state, { target: 'pc' })!
    expect(q).toMatchObject({ points: 5, missing: 14, full: false, cost: 40, minutes: 60, pay: 'cash' })
    const d = clinicHealDraft(g.k, g.state, { target: 'pc' })
    expect(d.outcome.result).toBe('partial')
    g.commit(d)
    expect(pc(g).hp).toBe(31)
    expect(g.state.money).toEqual({ cred: 0, cash: 1 })
    expect(has(g, 'pc', 'treated')).toBe(true)
    // 剩 1 元：一點都治不起
    expect(clinicBlock(g.k, g.state, { target: 'pc' })).toContain('錢不夠')
    expect(reasonOf(() => clinicHealDraft(g.k, g.state, { target: 'pc' }))).toContain('錢不夠')
  })

  it('付哪一種錢：指定的就用指定的；沒指定先帳戶，帳戶付不起全部而現金可以時用現金', () => {
    const g = make({ pc: { hp: 26 }, money: { cred: 50, cash: 500 } })
    stand(g, 'F1')
    expect(clinicQuote(g.k, g.state, { target: 'pc' })).toMatchObject({ pay: 'cash', points: 14 })
    expect(clinicQuote(g.k, g.state, { target: 'pc', pay: 'cred' })).toMatchObject({ pay: 'cred', points: 6, cost: 48 })
    g.commit(clinicHealDraft(g.k, g.state, { target: 'pc', pay: 'cash' }))
    expect(g.state.money).toEqual({ cred: 50, cash: 500 - 112 })
  })

  it('不在診所、生命值滿的、戰鬥中的、不在隊上的都被擋；診所的價錢規則表可以蓋', () => {
    const g = make({ pc: { hp: 26 } })
    expect(clinicBlock(g.k, g.state, { target: 'pc' })).toBe('這裡沒有診所。')
    expect(clinicQuote(g.k, g.state, { target: 'pc' })).toBeNull()
    stand(g, 'F4')
    expect(clinicBlock(g.k, g.state, { target: 'pc' })).toBe('這裡沒有診所。')
    const full = make()
    stand(full, 'F1')
    expect(clinicBlock(full.k, full.state, { target: 'pc' })).toBe('測試主角的生命值已經是滿的。')
    const priced = make({ pc: { hp: 30 }, pack: pack((c) => { c.medical_rule = [{ id: 'default', heal_price: { clinic: 10 }, heal_minutes_per_10: 30 }] }) })
    stand(priced, 'F1')
    expect(clinicQuote(priced.k, priced.state, { target: 'pc' })).toMatchObject({ price: 10, cost: 100, minutes: 30 })
  })

  it('治療之後的睡一覺：傷口處理過，睡一覺回得過一半（重傷限制）；沒處理過最多回到一半', () => {
    // 生命 10／40：旅館回復率 60% = 24 點。沒處理過最多回到 20；處理過回到 34
    const a = make({ rest: true, pc: { hp: 10 } })
    stand(a, 'F4')
    const hurt = a.state.actors.pc!.hp
    expect(hurt).toBe(10)
    a.commit(sleepDraft(a.k, a.state))
    expect(pc(a).hp).toBe(20)

    const b = make({ rest: true, pc: { hp: 10 } })
    b.commit(withDice([0.6, 0.6], () => aid(b)))
    expect(pc(b).hp).toBe(16)
    stand(b, 'F4')
    b.commit(sleepDraft(b.k, b.state))
    expect(pc(b).hp).toBe(40)

    const c = make({ rest: true, pc: { hp: 10 } })
    stand(c, 'F1')
    c.commit(clinicHealDraft(c.k, c.state, { target: 'pc' }))
    expect(pc(c).hp).toBe(40)
    expect(has(c, 'pc', 'treated')).toBe(true)
  })
})

describe('重的重創在戰鬥外（P46）', () => {
  it('wound_torso：max_hp 少 5、armor_body 是 0；組成裡看得到來源 wound', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_torso' }] } })
    expect(g.k.stats.stat(g.state, 'pc', 'max_hp')).toBe(35)
    expect(g.k.stats.stat(g.state, 'pc', 'armor_body')).toBe(0)
    const parts = g.k.stats.statParts(g.state, 'pc', 'max_hp')
    expect(parts).toContainEqual({ label: '軀幹重創', value: -5, source: 'wound' })
    // 沒有這個狀況時回到原值
    const clean = make()
    expect(clean.k.stats.stat(clean.state, 'pc', 'max_hp')).toBe(40)
    expect(clean.k.stats.stat(clean.state, 'pc', 'armor_body')).toBe(3)
  })

  it('wound_limb：體格與反應的檢定（運動、格鬥、槍械……）多一筆 −4；別的基本功不受影響', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_limb' }] } })
    const parts = g.k.stats.checkModifiers(g.state, 'pc', { attr: 'body', skill: 'athletics', tags: [] })
    expect(parts).toContainEqual({ label: '肢體重創', value: -4, source: 'wound' })
    for (const skill of ['brawl', 'firearms', 'piloting', 'stealth', 'heavy']) {
      expect(g.k.stats.checkModifiers(g.state, 'pc', { attr: 'body', skill, tags: [] }).some((p) => p.source === 'wound'), skill).toBe(true)
    }
    expect(g.k.stats.checkModifiers(g.state, 'pc', { attr: 'tech', skill: 'medicine', tags: [] }).some((p) => p.source === 'wound')).toBe(false)
    // 急救的檢定不受影響
    expect(aidQuote(g.k, g.state, { by: 'pc', target: 'pc' })!.parts.some((p) => p.source === 'wound')).toBe(false)
  })

  it('wound_head：沒有數字（義體失效是 cyberware 讀狀況做的）；woundsOf 列出身上的重創', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_head' }, { id: 'wound_limb' }, { id: 'wound_torso', until: 10 }] } })
    expect(g.k.stats.checkModifiers(g.state, 'pc', { attr: 'body', skill: 'athletics', tags: [] }).filter((p) => p.source === 'wound')).toHaveLength(1)
    // 已經過期的狀況不算
    expect(woundsOf(g.state, 'pc')).toEqual(['limb', 'head'])
    expect(g.k.stats.stat(g.state, 'pc', 'max_hp')).toBe(40)
  })

  it('規則表可以蓋掉每一種的效果；格式不對的效果在載入時被擋', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_head' }] }, pack: pack((c) => { c.medical_rule = [{ id: 'default', wound_effects: { wound_head: [{ stat: 'max_hp', amount: -2, label: '頭部重創' }] } }] }) })
    expect(g.k.stats.stat(g.state, 'pc', 'max_hp')).toBe(38)
    expect(() => make({ pack: pack((c) => { c.medical_rule = [{ id: 'default', wound_effects: { wound_head: [{ stat: 'max_hp', amount: 0 }] } }] }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.medical_rule = [{ id: 'default', recovery_effects: [{ mod: 'no_such_mod', amount: 1 }] }] }) })).toThrow(ContentError)
  })
})

describe('重創的手術（DOWNTIME 3.1 節）', () => {
  it('診所：收 1200、狀況拿掉、掛休養三天；休養期間檢定 −2、三天後沒有', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_limb' }] } })
    stand(g, 'F1')
    expect(woundSurgeryQuote(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' })).toMatchObject({ fee: 1200, minutes: 60, recovery_minutes: 4320, pay: 'cred' })
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' })).toBeNull()
    const t0 = now(g)
    const d = woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' })
    expect(d.action).toBe('medical.surgery')
    g.commit(d)
    expect(g.state.money.cred).toBe(20000 - 1200)
    expect(has(g, 'pc', 'wound_limb')).toBe(false)
    expect(condOf(g, 'pc', 'wound_recovering')!.until).toBe(t0 + 60 + 4320)
    const ath = () => g.k.stats.checkModifiers(g.state, 'pc', { attr: 'body', skill: 'athletics', tags: [] }).filter((p) => p.source === 'wound')
    expect(ath()).toEqual([{ label: '手術後休養', value: -2, source: 'wound' }])
    advance(g, 4320 - 1)
    expect(ath()).toHaveLength(1)
    advance(g, 1)
    expect(ath()).toEqual([])
    expect(woundsOf(g.state, 'pc')).toEqual([])
  })

  it('軀幹的重創手術之後 max_hp 與 armor_body 回來；三種診所收一樣的價錢', () => {
    for (const at of ['F1', 'F2', 'F3']) {
      const g = make({ pc: { conditions: [{ id: 'wound_torso' }] } })
      stand(g, at)
      expect(g.k.stats.stat(g.state, 'pc', 'max_hp')).toBe(35)
      g.commit(woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'torso', via: 'clinic' }))
      expect(g.state.money.cred, at).toBe(20000 - 1200)
      expect(g.k.stats.stat(g.state, 'pc', 'max_hp')).toBe(40)
      expect(g.k.stats.stat(g.state, 'pc', 'armor_body')).toBe(3)
    }
  })

  it('擋下：沒有那一種重創、不在診所、錢不夠、不在隊上、戰鬥中；錢可以指定從現金付', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_limb' }] }, money: { cred: 100, cash: 1500 } })
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' })).toBe('這裡沒有診所。')
    stand(g, 'F1')
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'head', via: 'clinic' })).toBe('測試主角的頭沒有要動手術的重創。')
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic', pay: 'cred' })).toContain('錢不夠')
    expect(woundSurgeryQuote(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' })).toMatchObject({ pay: 'cash' })
    g.commit(woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic', pay: 'cash' }))
    expect(g.state.money).toEqual({ cred: 100, cash: 300 })
    expect(reasonOf(() => woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' }))).toContain('沒有要動手術的重創')
    expect(woundSurgeryBlock(g.k, g.state, { target: 'nobody', part: 'limb', via: 'clinic' })).toBe('找不到這個角色。')
    const fight = makeBattleGame({ features: [characterFeature, worldFeature, combatFeature, medicalFeature], content: [pack()] }).game
    fight.state.actors.pc!.conditions.push({ id: 'wound_limb' })
    expect(woundSurgeryBlock(fight.k, fight.state, { target: 'pc', part: 'limb', via: 'clinic' })).toBe('戰鬥中不能這樣處理，要用戰鬥裡的行動。')
  })

  it('又動了一次手術：休養取比較晚的結束時間', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_limb' }, { id: 'wound_torso' }] } })
    stand(g, 'F1')
    g.commit(woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'clinic' }))
    const first = condOf(g, 'pc', 'wound_recovering')!.until!
    g.commit(woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'torso', via: 'clinic' }))
    expect(condOf(g, 'pc', 'wound_recovering')!.until).toBe(first + 60)
  })
})

describe('自己或隊友動刀（SKILL_TREES 日常「手術」）', () => {
  const wounded = { conditions: [{ id: 'wound_limb' }] }

  it('沒有人註冊條件 ability 時不列：自己動刀被擋、view 說沒有', () => {
    const g = make({ pc: wounded })
    g.state.flags.home = true
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })).toBe('現在還不能自己動刀。')
    expect(medicalView(g.k, g.state).self_listed).toBe(false)
    expect(medicalView(g.k, g.state).members[0]!.wounds[0]!.options.map((o) => o.via)).toEqual(['clinic'])
  })

  it('註冊之後在住處：不扣錢、時間 +240 分鐘、狀況拿掉、掛休養；效果和診所相同', () => {
    const g = make({ pc: wounded, ability: 'ok' })
    g.state.flags.home = true
    const q = woundSurgeryQuote(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })!
    expect(q).toMatchObject({ fee: 0, minutes: 240, pay: null })
    expect(medicalView(g.k, g.state).self_listed).toBe(true)
    const t0 = now(g)
    g.commit(woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' }))
    expect(g.state.money).toEqual({ cred: 20000, cash: 1000 })
    expect(now(g) - t0).toBe(240)
    expect(has(g, 'pc', 'wound_limb')).toBe(false)
    expect(condOf(g, 'pc', 'wound_recovering')!.until).toBe(t0 + 240 + 4320)
  })

  it('要在住處或診所；診所裡自己動刀也行（不收錢）', () => {
    const g = make({ pc: wounded, ability: 'ok' })
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })).toBe('自己動刀要在住處或診所。')
    stand(g, 'F3')
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })).toBeNull()
    g.commit(woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' }))
    expect(g.state.money.cred).toBe(20000)
  })

  it('動刀的人要通過條件：隊友 mate 會、主角不會；隊友替主角動刀', () => {
    const g = make({ pc: wounded, ability: 'mate', mate: true })
    g.state.flags.home = true
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })).toBe('動刀的人還沒有學會手術這項技能。')
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self', by: 'mate' })).toBeNull()
    const d = woundSurgeryDraft(g.k, g.state, { target: 'pc', part: 'limb', via: 'self', by: 'mate' })
    expect(d.actor).toBe('mate')
    expect(d.outcome.summary).toContain('夥伴替測試主角動刀')
    g.commit(d)
    expect(has(g, 'pc', 'wound_limb')).toBe(false)
  })

  it('不在隊上或找不到的人不能動刀', () => {
    const g = make({ pc: wounded, ability: 'ok' })
    g.state.flags.home = true
    g.state.actors.npc = makeActor({ id: 'npc', role: 'npc', name: '路人' })
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self', by: 'npc' })).toBe('動刀的人不在隊上。')
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self', by: 'nobody' })).toBe('找不到動刀的人。')
  })

  it('規則表可以改自己動刀的條件與時間', () => {
    const g = make({ pc: wounded, pack: pack((c) => { c.medical_rule = [{ id: 'default', self_requires: [{ kind: 'at_home' }], self_minutes: 120 }] }) })
    g.state.flags.home = true
    expect(woundSurgeryQuote(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })).toMatchObject({ minutes: 120, fee: 0 })
    expect(woundSurgeryBlock(g.k, g.state, { target: 'pc', part: 'limb', via: 'self' })).toBeNull()
  })
})

describe('戰地手術處理重創：戰鬥的效果 op wound_treat', () => {
  const FIELD: Feature = {
    id: 'field_stub',
    install(k) {
      k.battle.action({
        id: 'test.treat', owner: 'field_stub', name: '戰地手術', desc: '處理相鄰隊友的重創。', group: 'skill', target: 'ally', modes: ['meat'],
        cost: () => ({ ap: 1 }),
        targets: (view, u) => Object.values(view.battle.units).filter((t) => t.side === u.side).map((t) => ({ target: { unit: t.id }, blocks: [] })),
        run: (run, u, target) => { run.effects([{ op: 'wound_treat' }], { user: u, target, source: { kind: 'ability', id: 'test.treat', name: '戰地手術' } }) },
      })
    },
  }
  const fight = () => makeBattleGame({ features: [characterFeature, worldFeature, combatFeature, medicalFeature, FIELD], content: [pack()], battle: BATTLE_SETUPS.encounter(1) }).game
  const runOf = (g: ReturnType<typeof fight>) => new BattleRun(g.k, g.state, clone(g.battle!))
  const hurt = (r: BattleRun, id: string, part: string, times: number) => {
    for (let i = 0; i < times; i++) r.k.battle.emit('wound', { run: r, attacker: r.unit('f1'), target: r.unit(id), aimed: true, part })
  }
  const treat = (r: BattleRun, id: string, e: Rec = {}) => r.effects([{ op: 'wound_treat', ...e }], { user: r.unit('a1'), target: { unit: id }, source: { kind: 'ability', id: 'test.treat', name: '戰地手術' } })

  it('輕的肢體重創直接解除、重的軀幹重創降成輕的（生命值上限加回來、流血還在）', () => {
    const g = fight()
    const r = runOf(g)
    const u = r.unit('a2')
    const max0 = u.hp!.max
    hurt(r, 'a2', 'limb', 1)
    hurt(r, 'a2', 'torso', 2)
    expect(u.wounds).toEqual({ limb: 1, torso: 2 })
    expect(u.hp!.max).toBe(max0 - 5)
    expect(u.statuses.map((s) => s.id)).toContain('limb_hurt')
    treat(r, 'a2')
    expect(u.wounds).toEqual({ torso: 1 })
    expect(u.hp!.max).toBe(max0)
    expect(u.statuses.map((s) => s.id)).not.toContain('limb_hurt')
    expect(u.statuses.map((s) => s.id)).toContain('bleeding')
    // 再來一次：輕的也解除
    treat(r, 'a2')
    expect(u.wounds).toEqual({})
    expect(u.statuses.map((s) => s.id)).not.toContain('bleeding')
  })

  it('all: true 全部清掉（重的肢體也直接沒有）', () => {
    const g = fight()
    const r = runOf(g)
    const u = r.unit('a3')
    const max0 = u.hp!.max
    hurt(r, 'a3', 'limb', 2)
    hurt(r, 'a3', 'torso', 2)
    hurt(r, 'a3', 'head', 1)
    expect(u.wounds).toEqual({ limb: 2, torso: 2, head: 1 })
    treat(r, 'a3', { all: true })
    expect(u.wounds).toEqual({})
    expect(u.hp!.max).toBe(max0)
    expect(u.statuses.map((s) => s.id).filter((id) => ['limb_hurt', 'dazed', 'bleeding'].includes(id))).toEqual([])
  })

  it('沒有重創的人什麼也不發生；一個戰鬥行動裡跑完整條（目標是隊友）', () => {
    const g = fight()
    const r = runOf(g)
    treat(r, 'a2')
    expect(r.unit('a2').wounds).toEqual({})
    expect(r.beats.some((b) => b.text.includes('傷處理好了'))).toBe(false)
    hurt(r, 'a4', 'torso', 1)
    treat(r, 'a4')
    expect(r.beats.filter((b) => b.text.includes('傷處理好了'))).toHaveLength(1)
    expect(g.k.battle.getAction('test.treat')).toBeDefined()
  })

  it('內海的戰場用不出來', () => {
    const net = makeBattleGame({ features: [characterFeature, worldFeature, TEST_NET_COMBAT, medicalFeature], content: [pack()], battle: 'net' }).game
    const r = new BattleRun(net.k, net.state, clone(net.battle!))
    expect(() => r.effects([{ op: 'wound_treat' }], { user: r.unit('a1'), target: { unit: 'a2' }, source: { kind: 'ability', id: 'x', name: 'x' } })).toThrow(BattleBlocked)
  })

  it('格式：不認得的欄位與 all 的型別被擋', () => {
    const g = fight()
    const def = g.k.battle.getEffect('wound_treat')!
    expect(def.problems!({ op: 'wound_treat', all: true })).toEqual([])
    expect(def.problems!({ op: 'wound_treat', who: 'target', if: [] })).toEqual([])
    // part 現在收了（combat 的 wound 轉呼叫這一套；M4-followups-2 第 5 項）：寫對的部位合格、寫錯的被擋
    expect(def.problems!({ op: 'wound_treat', part: 'limb' })).toEqual([])
    expect(def.problems!({ op: 'wound_treat', part: 'tail' }).join()).toContain('part')
    expect(def.problems!({ op: 'wound_treat', mode: 'x' }).join()).toContain('mode')
    expect(def.problems!({ op: 'wound_treat', all: 'yes' }).join()).toContain('all')
  })
})

describe('效果 wound_heal 與 treated：只有內建的來源能用', () => {
  const resolve = (g: G, raw: unknown, source: 'builtin' | 'ai' | 'player') => g.k.effects.resolve(raw, effectCtx(g.k, g.state, { source }))

  it('wound_heal：把那一種重創拿掉；沒寫部位是全部；身上沒有的落空並說明', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_limb' }, { id: 'wound_torso' }, { id: 'wound_head' }] } })
    const one = resolve(g, [{ kind: 'wound_heal', part: 'limb' }], 'builtin')
    expect(one.errors).toEqual([])
    expect(one.changes).toEqual([{ op: 'actor.condition', id: 'pc', condition: 'wound_limb', remove: true }])
    expect(one.lines).toEqual(['重創處理好了：肢體'])
    g.commit(draft(one.changes, 'test.effect'))
    expect(woundsOf(g.state, 'pc')).toEqual(['head', 'torso'])
    const all = resolve(g, [{ kind: 'wound_heal' }], 'builtin')
    g.commit(draft(all.changes, 'test.effect'))
    expect(woundsOf(g.state, 'pc')).toEqual([])
    const none = resolve(g, [{ kind: 'wound_heal', part: 'limb' }], 'builtin')
    expect(none.changes).toEqual([])
    expect(none.clamps[0]!.notice).toContain('身上沒有')
  })

  it('treated：掛上傷口處理過，期限是 treated_minutes（預設一天）', () => {
    const g = make()
    const r = resolve(g, [{ kind: 'treated' }], 'builtin')
    expect(r.errors).toEqual([])
    g.commit(draft(r.changes, 'test.effect'))
    expect(condOf(g, 'pc', 'treated')!.until).toBe(now(g) + 1440)
    const rule = make({ pack: pack((c) => { c.medical_rule = [{ id: 'default', treated_minutes: 600 }] }) })
    rule.commit(draft(resolve(rule, [{ kind: 'treated' }], 'builtin').changes, 'test.effect'))
    expect(condOf(rule, 'pc', 'treated')!.until).toBe(now(rule) + 600)
  })

  it('AI 給的、玩家要的都被擋（封閉清單）；格式錯的 part 被擋', () => {
    const g = make({ pc: { conditions: [{ id: 'wound_limb' }] } })
    for (const source of ['ai', 'player'] as const) {
      for (const e of [{ kind: 'wound_heal' }, { kind: 'treated' }]) {
        const r = resolve(g, [e], source)
        expect(r.errors.length, `${source} ${e.kind}`).toBeGreaterThan(0)
        expect(r.changes).toEqual([])
      }
    }
    expect(g.k.effects.aiKinds()).not.toContain('wound_heal')
    expect(g.k.effects.aiKinds()).not.toContain('treated')
    expect(resolve(g, [{ kind: 'wound_heal', part: 'bridge' }], 'builtin').errors.length).toBeGreaterThan(0)
  })
})

describe('資料與總覽', () => {
  it('設施的 clinic 欄位寫錯在載入時被擋', () => {
    expect(() => make({ pack: pack((c) => { c.facility_type![0] = { id: 'fac_clinic', name: '診所', clinic: { grade: 'vip' } } }) })).toThrow(ContentError)
  })

  it('規則表寫壞的欄位忽略、其餘照常（載入時就被擋）', () => {
    expect(() => make({ pack: pack((c) => { c.medical_rule = [{ id: 'default', heal_price: { clinic: -1 } }] }) })).toThrow()
    expect(() => make({ pack: pack((c) => { c.medical_rule = [{ id: 'default', wound_price: 1.5 }] }) })).toThrow()
    const g = make({ pack: pack((c) => { c.medical_rule = [{ id: 'default', wound_price: 900 }] }) })
    expect(medicalRules(g.k).wound_price).toBe(900)
    expect(medicalRules(g.k).heal_price).toEqual({ clinic: 8, unlicensed: 4, black: 5 })
  })

  it('medicalView：每個隊員的生命值、狀況、能不能急救與治療、每一種重創的手術選項', () => {
    const g = make({ pc: { hp: 30, conditions: [{ id: 'wound_limb' }] }, mate: true })
    stand(g, 'F1')
    const v = medicalView(g.k, g.state)
    expect(v.clinic).toEqual({ name: '診所', grade: 'clinic' })
    expect(v.members.map((m) => m.id)).toEqual(['pc', 'mate'])
    const [a, b] = v.members
    expect(a).toMatchObject({ hp: 30, max_hp: 40, treated: false, aided: false, recovering_until: null })
    expect(a!.aid.block).toBeNull()
    expect(a!.heal.quote).toMatchObject({ missing: 10, cost: 80 })
    expect(a!.wounds).toHaveLength(1)
    expect(a!.wounds[0]).toMatchObject({ part: 'limb', name: '肢體' })
    expect(a!.wounds[0]!.options[0]).toMatchObject({ via: 'clinic', block: null, quote: { fee: 1200 } })
    expect(b).toMatchObject({ hp: 20, wounds: [] })
    g.commit(clinicHealDraft(g.k, g.state, { target: 'pc' }))
    expect(medicalView(g.k, g.state).members[0]).toMatchObject({ treated: true, hp: 40 })
    expect(medicalView(g.k, g.state).members[0]!.heal.block).toBe('測試主角的生命值已經是滿的。')
  })

  it('讀檔重擲不變：同一個狀態、同一個用途，急救的骰面一樣', () => {
    const g = make({ pc: { hp: 20 } })
    const a = aid(g)
    const b = aid(g)
    expect(b.timeline.find((x) => x.roll)!.roll).toEqual(a.timeline.find((x) => x.roll)!.roll)
    expect(b.changes).toEqual(a.changes)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// M4-followups-2 第 5 項：combat 的 wound 轉呼叫 medical 的同一套；重創手術多「換義肢」
// ---------------------------------------------------------------------------------------------------------------------

describe('M4-followups-2 第 5 項：戰鬥裡的 wound 與 wound_treat 是同一套', () => {
  const woundPack = (): ContentPack => pack()
  const setHurt = (g: ReturnType<typeof makeBattleGame>['game']) => {
    const a1 = g.battle!.units.a1!
    a1.wounds = { limb: 2, head: 1 }
    a1.statuses.push({ id: 'limb_hurt', until: { at: 'battle_end' } } as never)
    return a1
  }

  it('裝了醫療：combat 的 wound（mode: treat）轉呼叫 wound_treat；結果和直接用 wound_treat 一模一樣（重的降成輕的、輕的解除）；part 只處理那一個部位', () => {
    const viaWound = makeBattleGame({ features: [characterFeature, worldFeature, combatFeature, medicalFeature], content: [woundPack()] }).game
    const viaTreat = makeBattleGame({ features: [characterFeature, worldFeature, combatFeature, medicalFeature], content: [woundPack()] }).game
    setHurt(viaWound)
    setHurt(viaTreat)
    const spy = vi.spyOn(viaWound.k.battle.getEffect('wound_treat')!, 'fn')
    const a = new BattleRun(viaWound.k, viaWound.state, clone(viaWound.battle!))
    const b = new BattleRun(viaTreat.k, viaTreat.state, clone(viaTreat.battle!))
    a.effects([{ op: 'wound', mode: 'treat', who: 'self' }], { user: a.battle.units.a1!, source: { kind: 'item', id: 'x', name: 'x' } })
    b.effects([{ op: 'wound_treat', who: 'self' }], { user: b.battle.units.a1!, source: { kind: 'item', id: 'x', name: 'x' } })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(a.battle.units.a1!.wounds).toEqual(b.battle.units.a1!.wounds)
    expect(a.battle.units.a1!.wounds).toEqual({ limb: 1 })
    expect(a.battle.units.a1!.statuses.map((x) => x.id)).toEqual(b.battle.units.a1!.statuses.map((x) => x.id))
    // part 只處理那一個部位；clear 全部清掉
    const c = new BattleRun(viaWound.k, viaWound.state, clone(viaWound.battle!))
    c.effects([{ op: 'wound', mode: 'treat', who: 'self', part: 'head' }], { user: c.battle.units.a1!, source: { kind: 'item', id: 'x', name: 'x' } })
    expect(c.battle.units.a1!.wounds).toEqual({ limb: 2 })
    c.effects([{ op: 'wound', mode: 'clear', who: 'self' }], { user: c.battle.units.a1!, source: { kind: 'item', id: 'x', name: 'x' } })
    expect(c.battle.units.a1!.wounds).toEqual({})
  })

  it('沒裝醫療：combat 照自己的做法（沒有 wound_treat 這個 op，也一樣能治）', () => {
    const g = makeBattleGame({ features: [characterFeature, worldFeature, combatFeature], content: [woundPack()] }).game
    expect(g.k.battle.getEffect('wound_treat')).toBeUndefined()
    setHurt(g)
    const r = new BattleRun(g.k, g.state, clone(g.battle!))
    r.effects([{ op: 'wound', mode: 'treat', who: 'self' }], { user: r.battle.units.a1!, source: { kind: 'item', id: 'x', name: 'x' } })
    expect(r.battle.units.a1!.wounds).toEqual({ limb: 1 })
  })
})

describe('M4-followups-2 第 5 項：重創手術的「換義肢」（TRADE 3.4 節；接 cyberware 的 cyber_install）', () => {
  const armPack = (): ContentPack => pack((c) => {
    c.part = [{ id: 'pt_limb', name: '義肢骨架', type: 'limb', material: 'mech', brand: 'hz', grade: 1, price: 700, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new' }]
    c.blueprint = [
      { id: 'bp_arm', kind: 'cyberware', name: '義臂', desc: '一條義臂。', brand: 'hz', grade: 1, legal: 'free', price: 500, require: [{ type: 'limb' }], optional: [], stock: { limb: 'pt_limb' }, slot: 'arm', invasiveness: 'light', sink_cost: 3, needs_bridge: false },
      { id: 'bp_eye', kind: 'cyberware', name: '義眼', desc: '一顆義眼。', brand: 'hz', grade: 1, legal: 'free', price: 300, require: [{ type: 'limb' }], optional: [], stock: { limb: 'pt_limb' }, slot: 'eye', invasiveness: 'light', sink_cost: 1, needs_bridge: false },
    ]
  })
  const hurt = (o: Opts = {}) => make({ pc: { conditions: [{ id: 'wound_limb' }] }, extra: [cyberwareFeature], pack: armPack(), ...o })
  const opts = (replace: { blueprint: string; side?: 'l' | 'r' } = { blueprint: 'bp_arm', side: 'l' }) => ({ target: 'pc', part: 'limb' as const, via: 'clinic' as const, replace })

  it('肢體的重創在診所換義肢：付的是義肢的成品價（取代手術費）、重創拿掉、義肢裝在左臂、沒有休養；報價帶著義肢是哪一件', () => {
    const g = hurt()
    stand(g, 'F1')
    const price = productPrice(g.k.content, 'bp_arm', { uid: '', parts: {} })
    expect(price).toBeGreaterThan(0)
    const q = woundSurgeryQuote(g.k, g.state, opts())!
    expect(q).toMatchObject({ fee: price, recovery_minutes: 0, replace: { blueprint: 'bp_arm', name: '義臂', price } })
    expect(woundSurgeryBlock(g.k, g.state, opts())).toBeNull()
    g.commit(woundSurgeryDraft(g.k, g.state, opts()))
    expect(g.state.money.cred).toBe(20000 - price)
    expect(has(g, 'pc', 'wound_limb')).toBe(false)
    expect(has(g, 'pc', 'wound_recovering')).toBe(false)
    expect(cyberOf(g.state, 'pc').map((p) => [p.bp, p.slot])).toEqual([['bp_arm', 'arm_l']])
    expect(g.state.reports.at(-1)!.narration!.results!.join('')).toContain('直接換上義臂')
    // 對照：沒有 replace 還是 1200 的接回手術，沒有義體
    const plain = hurt()
    stand(plain, 'F1')
    plain.commit(woundSurgeryDraft(plain.k, plain.state, { target: 'pc', part: 'limb', via: 'clinic' }))
    expect(plain.state.money.cred).toBe(20000 - 1200)
    expect(cyberOf(plain.state, 'pc')).toEqual([])
  })

  it('擋下：不是肢體的重創、自己動刀、不是肢體的義體、錢不夠；沒有裝 cyberware 這一項整個做不了', () => {
    const g = hurt()
    stand(g, 'F1')
    expect(woundSurgeryProblems(g.k, g.state, { ...opts(), part: 'head' }).join('')).toContain('只有肢體的重創可以換義肢')
    expect(woundSurgeryBlock(g.k, g.state, { ...opts(), via: 'self' })).toContain('義肢要在診所裝')
    expect(woundSurgeryBlock(g.k, g.state, opts({ blueprint: 'bp_eye' }))).toContain('不是肢體的義體')
    expect(woundSurgeryBlock(g.k, g.state, opts({ blueprint: 'bp_none' }))).toContain('找不到這件義肢')
    const poor = hurt({ money: { cred: 10, cash: 10 } })
    stand(poor, 'F1')
    expect(woundSurgeryBlock(poor.k, poor.state, opts())).toContain('錢不夠')
    const bare = make({ pc: { conditions: [{ id: 'wound_limb' }] }, pack: armPack() })
    stand(bare, 'F1')
    expect(woundSurgeryBlock(bare.k, bare.state, opts())).toContain('這裡裝不了義肢')
  })

  it('槽已經滿了：試裝落空，原因在 problems 裡，不會收了錢卻沒裝上', () => {
    const g = hurt()
    stand(g, 'F1')
    const arm = (uid: string, slot: string) => ({ uid, bp: 'bp_arm', slot, parts: { limb: 'pt_limb' }, sink: 3, at: 0, registered: true })
    ;(pc(g).ext as Rec).cyber = { pieces: [arm('a1', 'arm_l'), arm('a2', 'arm_l'), arm('a3', 'arm_r'), arm('a4', 'arm_r')] }
    expect(woundSurgeryBlock(g.k, g.state, opts())).toMatch(/槽已經滿了/)
    expect(() => woundSurgeryDraft(g.k, g.state, opts())).toThrow(ActionBlocked)
  })
})
