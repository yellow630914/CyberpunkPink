// 驗收測試：dev/work/M4-followups.md（cpp-feature）。規格：COMBAT_SYSTEM 8.3 節；NPC_SYSTEM 10.6 節；DOWNTIME 4.1a、4.2、5.2 節；FIXER 第 4 節；EVENTS 2.4 節；
// dev/adr/0019 各實作補記；使用者 2026-11-25 的裁決（打工 2/4/6/8 小時與累計時數升階、契約抗拒不疊沉溺的懲罰、刪掉「能不能接別人的指令」規矩）。
// 內容一律用測試自帶的最小假資料。五個功能各自的「那個功能沒裝」對照放在各段裡。
// 骰子：用 vi.spyOn(Rng.prototype, 'next') 固定每一次 next() 的值（只包住「建草稿」那一步，提交不受影響）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Actor, BattleSetup, ContentPack, Effect, Feature, Report, ReportDraft, SpecialMapEntry } from '../../src'
import { ContentError, Rng, effectCtx, toMinutes } from '../../src'
import { billsFeature, readBills, setBill } from '../../src/features/bills'
import { characterFeature } from '../../src/features/character'
import { contractFeature, contractOf, resistPlan } from '../../src/features/contract'
import { acceptDefeat, defeatFeature, defeatOf } from '../../src/features/defeat'
import { directorFeature, eventRunFeature } from '../../src/features/director'
import { AVATAR_TEXT_MAX, avatarBlock, avatarDraft, avatarOf, deckFeature } from '../../src/features/deck'
import { drugsFeature } from '../../src/features/drugs'
import { quickBlock } from '../../src/features/gear'
import { cyberOf, cyberwareFeature, kindOfBlueprint } from '../../src/features/cyberware'
import { lewdFeature } from '../../src/features/lewd'
import { malwareFeature, malwareOf } from '../../src/features/malware'
import { rentDraft, restFeature, sleepDraft } from '../../src/features/rest'
import { PC_SUNK_DONE, followsDownFlag, join, muster, readRoster, rosterFeature, sunkAwayFlag, weeklyDrafts as rosterWeekly } from '../../src/features/roster'
import { securityFeature } from '../../src/features/security'
import { sinkFeature } from '../../src/features/sink'
import { tuningFeature, tuningOf } from '../../src/features/tuning'
import { arrive, worldFeature } from '../../src/features/world'
import { jobStateOf, jobView, needProgress, readWork, shift, workFeature, workRules } from '../../src/features/work'
import { BATTLE_SETUPS, METER_CONTENT, TEST_COMBAT, enemyUnit, makeActor, makeGame, meterFeature, observed, playOut, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

afterEach(() => { vi.restoreAllMocks() })

/** 把每一次 next() 固定成 v，只包住 fn。 */
function withDice<T>(v: number, fn: () => T): T {
  const spy = vi.spyOn(Rng.prototype, 'next').mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

// ======================================================================
// 戰敗（features/defeat）：丙丁戊三組的效果、defeat.gear、hostility_floor 要寫 days、pinned
// ======================================================================

const cash = (amount: number): Effect & { amount: number } => ({ kind: 'cash', amount })
const opt = (id: string, text: string, o: Rec = {}): Rec => ({ id, text, outcomes: { any: [] }, ...o })
const df = (id: string, effects: Effect[], o: Rec = {}): Rec => ({
  id, name: id, kind: 'generic', factions: [], fails_commission: true,
  versions: { default: { text: `${id}：開頭。`, stages: [{ options: [opt('o1', '接受。', { outcomes: { any: effects } })] }] } }, ...o,
})

const part = (id: string, type: string, over: Rec = {}): Rec => ({ id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over })
const bp = (id: string, over: Rec = {}): Rec => ({ id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 1, legal: 'free', price: 500, require: [], optional: [], ...over })
const PARTS = [part('pt_lens', 'sensor', { price: 300 })]
const BLUEPRINTS = [bp('bp_eye', { name: '義眼', slot: 'eye', invasiveness: 'light', sink_cost: 2, require: [{ type: 'sensor' }] })]
const TUNINGS = [{ id: 'tn_calm', name: '穩壓', desc: '把橋的雜訊壓下去。', effects: [{ attr: 'resolve', amount: 4 }] }]
const MALWARES = [{
  id: 'fw_main', name: '螢火蟲', desc: '一小段會自己亮的程式。', pool: ['used', 'lace'],
  stages: { latent: { effects: [] }, active: { effects: [], trigger: 'mw_active', every_days: 3 }, spread: { effects: [] } },
}]

/** 每一組一件：丙（身體被改）、丁（污染）、戊（契約）；加上一件拿走義體又扣錢的，用來看存檔規則。 */
const EVENTS: Rec[] = [
  df('df_body', [{ kind: 'tuning', id: 'tn_calm', locked_by: 'hizakura', days: 3 } as Effect, { kind: 'cyber_take', slot: 'eye' } as Effect, cash(-300)], { factions: ['hizakura'] }),
  df('df_taint', [{ kind: 'malware', id: 'fw_main' } as Effect], { factions: ['nora'] }),
  df('df_contract', [{ kind: 'contract_sign', holder: 'eden', type: 'debt', debt: 1200 } as Effect], { factions: ['eden'] }),
  df('df_pinned', [{ kind: 'malware', pool: 'lace' } as Effect], { factions: [] }),
  df('df_generic', [], { default: true }),
]

const PACK = (events: Rec[] = EVENTS, patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'nora', name: '野良', short: '野良', class: 'street' }, { id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }],
    event_scope: [{ id: 'street', triggers: { enter_block: 1 } }],
    enemy: [
      { id: 'en_plain', name: '保全', faction: 'hizakura', kind: 'human' },
      { id: 'en_pink', name: '粉蕾絲', faction: 'nora', kind: 'lace', defeat: 'df_pinned' },
    ],
    part: structuredClone(PARTS), blueprint: structuredClone(BLUEPRINTS), tuning: structuredClone(TUNINGS), malware: structuredClone(MALWARES),
    defeat_event: structuredClone(events),
  }
  patch(c)
  return { id: 'followups_defeat', content: c as unknown as ContentPack['content'] }
}

const enemyStub: Feature = { id: 'enemy_stub', install: (k) => k.content.defineKind({ kind: 'enemy', owner: 'enemy_stub', validate: () => [] }) }
const armor: Feature = { id: 'armor_stub', install: (k) => k.stats.defineStat({ id: 'armor', owner: 'armor_stub', name: '護甲值', base: () => 0 }) }
/** 契約的內容種類 event_scope 要有 contract 這一筆（範圍）；沒有就不裝契約的事件。 */
const SCOPES = [{ id: 'street', triggers: { enter_block: 1 } }, { id: 'contract', triggers: { order: 1 }, priority: 2, daily_roll: { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }, satisfaction_mult: [[0, 1.5], [30, 1], [70, 0.6]], queue_max: 3, lost: 'defer' }]

const BASE_FEATURES = (): Feature[] => [characterFeature, defeatFeature, TEST_COMBAT, directorFeature, eventRunFeature, enemyStub, armor, worldFeature, lewdFeature]
const ALL_BODY = (): Feature[] => [...BASE_FEATURES(), cyberwareFeature, tuningFeature, malwareFeature, contractFeature]

interface DefeatOpts {
  features?: Feature[]
  pack?: ContentPack
  rules?: Record<string, unknown>
  faction?: string
  foes?: string[]
  /** 開打前身上先裝一件眼 */
  eye?: boolean
}
function arena(o: DefeatOpts = {}) {
  const pack = o.pack ?? PACK(EVENTS, (c) => { c.event_scope = structuredClone(SCOPES) })
  const { game } = makeGame({
    features: o.features ?? ALL_BODY(), content: [pack], seed: 2,
    pc: { gender: 'female', skills: { composure: 1 }, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } },
    patch: { money: { cred: 0, cash: 2000 }, rules: { defeatView: 'never', ...(o.rules ?? {}) } as never, time: { day: 3, hour: 10, minute: 0 } },
  })
  if (o.eye !== false && game.k.content.hasKind('blueprint')) {
    game.commit(draft([{ op: 'actor.ext', id: 'pc', key: 'cyber', value: { pieces: [{ uid: 'e1', bp: 'bp_eye', kind_of: 'blueprint', slot: 'eye', parts: { sensor: 'pt_lens' }, sink: 2, at: 0 }] } }], 'test.put'))
  }
  const base = BATTLE_SETUPS.hopeless()
  const setup: BattleSetup = {
    ...base,
    ...(o.foes ? { foes: o.foes.map((enemy) => ({ from: 'unit' as const, unit: enemyUnit('boss', 1, { enemy }) as unknown as Record<string, unknown> })) } : {}),
    origin: { ...(base.origin ?? { escapable: false }), ...(o.faction !== undefined ? { faction: o.faction } : {}) },
  }
  game.startBattle(setup)
  return game
}
type G = ReturnType<typeof arena>

/** 打到輸、結算、接受：回傳接受那一步的報告。 */
async function loseAndAccept(g: G): Promise<Report[]> {
  playOut(g)
  const { violations } = await observed(g, () => g.finishBattle())
  expect(violations).toEqual([])
  expect(defeatOf(g.state)).not.toBeNull()
  return g.commit(acceptDefeat(g.k, g.state))
}
const eyes = (g: G) => cyberOf(g.state, 'pc').filter((p) => p.slot === 'eye')

describe('戰敗：丙丁戊三組的事件效果真的落下', () => {
  it('丙（身體被改）：接受之後調校被強制裝上並上鎖、眼被拿走、錢照扣', async () => {
    const g = arena({ faction: 'hizakura' })
    expect(eyes(g)).toHaveLength(1)
    await loseAndAccept(g)
    expect(tuningOf(g.k, g.state, 'pc')).toMatchObject({ slots: ['tn_calm', null], locked: { tn_calm: { by: 'hizakura' } } })
    expect(eyes(g)).toHaveLength(0)
    expect(g.state.money.cash).toBe(1700)
    expect(defeatOf(g.state)).toBeNull()
  })

  it('丁（污染）：接受之後身上種下一段惡意韌體（潛伏）', async () => {
    const g = arena({ faction: 'nora' })
    expect(malwareOf(g.state, 'pc')).toHaveLength(0)
    await loseAndAccept(g)
    expect(malwareOf(g.state, 'pc').map((m) => [m.id, m.stage])).toEqual([['fw_main', 0]])
  })

  it('戊（契約）：接受之後簽下債務契約，債是事件寫的 1,200、債主是伊甸園', async () => {
    const g = arena({ faction: 'eden' })
    expect(contractOf(g.state)).toBeFalsy()
    await loseAndAccept(g)
    const mine = contractOf(g.state) as Rec
    expect(mine).toBeTruthy()
    expect(mine).toMatchObject({ type: 'debt', debt: 1200, holder: { kind: 'eden' } })
  })

  it('存檔規則「戰敗時拿走義體與裝備」關著：cyber_take 那一筆沒發生、同一件事件裡的錢照扣、調校照裝（不是拿走身體的東西）', async () => {
    const g = arena({ faction: 'hizakura', rules: { defeatTakeGear: false } })
    await loseAndAccept(g)
    expect(eyes(g)).toHaveLength(1)
    expect(g.state.money.cash).toBe(1700)
    expect(tuningOf(g.k, g.state, 'pc').slots).toContain('tn_calm')
  })

  it('對應的功能沒裝：那一筆效果在載入時被擋下，訊息指得出是哪一件事件、哪一種效果', () => {
    const message = (fn: () => unknown): string => {
      try {
        fn()
      } catch (e) {
        return (e as Error).message + ((e as ContentError).problems ?? []).join('\n')
      }
      throw new Error('應該載不進來')
    }
    const bare = (c: Record<string, Rec[]>) => { delete c.tuning; delete c.malware; c.event_scope = structuredClone(SCOPES) }
    // 沒裝調校：丙組擋下，指出事件與效果
    const noTuning = message(() => arena({ features: [...BASE_FEATURES(), cyberwareFeature, malwareFeature, contractFeature], pack: PACK(EVENTS, (c) => { delete c.tuning; c.event_scope = structuredClone(SCOPES) }), eye: false }))
    expect(noTuning).toContain('df_body')
    expect(noTuning).toContain('tuning')
    // 沒裝惡意韌體：丁組擋下
    expect(message(() => arena({ features: [...BASE_FEATURES(), cyberwareFeature, tuningFeature, contractFeature], pack: PACK(EVENTS, (c) => { delete c.malware; c.event_scope = structuredClone(SCOPES) }), eye: false }))).toContain('df_taint')
    // 沒裝契約：戊組擋下
    expect(message(() => arena({ features: [...BASE_FEATURES(), cyberwareFeature, tuningFeature, malwareFeature], eye: false }))).toContain('df_contract')
    // 沒裝義體：cyber_take 擋下
    expect(message(() => arena({ features: [...BASE_FEATURES(), tuningFeature, malwareFeature, contractFeature], pack: PACK(EVENTS, (c) => { c.event_scope = structuredClone(SCOPES) }), eye: false }))).toContain('cyber_take')
    void bare
  })
})

describe('戰敗：hostility_floor 一定要寫 days', () => {
  const floor = (days?: number): Effect => ({ kind: 'hostility_floor', key: 'netvigil', amount: 10, ...(days !== undefined ? { days } : {}) } as Effect)
  const load = (events: Rec[], scopes = false) => arena({
    features: [...BASE_FEATURES(), sinkFeature, securityFeature],
    pack: PACK(events, (c) => { delete c.tuning; delete c.malware; c.faction!.push({ id: 'netvigil', name: '貞網局', short: '貞網', class: 'corp' }); if (scopes) c.event_scope = structuredClone(SCOPES) }), eye: false,
  })

  it('沒寫 days 的戰敗事件整件載不進來，訊息指出事件的 id', () => {
    let message = ''
    try {
      load([df('df_floor', [floor()], { factions: [] }), df('df_generic', [], { default: true })])
    } catch (e) {
      message = (e as Error).message + ((e as ContentError).problems ?? []).join('\n')
    }
    expect(message).toContain('df_floor')
    expect(message).toMatch(/days/)
  })

  it('寫了 days 的載得進來（包在第二段的選項裡也一樣會查）；有效果的 days 是持續幾天', () => {
    expect(() => load([df('df_floor', [floor(7)], { factions: [] }), df('df_generic', [], { default: true })])).not.toThrow()
    const deep = df('df_deep', [], {
      factions: [],
      versions: { default: { text: 't', stages: [{ options: [opt('o1', 'a')] }, { options: [opt('o2', 'b', { outcomes: { any: [floor()] } })] }] } },
    })
    expect(() => load([deep, df('df_generic', [], { default: true })])).toThrow(/df_deep/)
  })

  it('範圍是 contract 的事件同一條：沒寫 days 載不進來，指出事件的 id；寫了就載得進來', () => {
    const ev = (days?: number): Rec => ({
      id: 'ev_contract_floor', scope: 'contract', triggers: ['order'], text: '回收員來了。',
      options: [opt('o1', '低頭。', { outcomes: { any: [floor(days)] } })],
    })
    const build = (days?: number) => makeGame({
      features: [...BASE_FEATURES(), sinkFeature, securityFeature],
      content: [{ id: 'contract_floor', content: { faction: [{ id: 'netvigil', name: '貞網局', short: '貞網', class: 'corp' }], event_scope: structuredClone(SCOPES), event: [ev(days)] } as unknown as ContentPack['content'] }],
    })
    expect(() => build()).toThrow(/ev_contract_floor/)
    expect(() => build(5)).not.toThrow()
    // 別的範圍不看這一條（一般事件的 +5 永久版不用寫 days）
    const street = { ...ev(), id: 'ev_street_floor', scope: 'street', triggers: ['enter_block'] }
    expect(() => makeGame({
      features: [...BASE_FEATURES(), sinkFeature, securityFeature],
      content: [{ id: 'street_floor', content: { faction: [{ id: 'netvigil', name: '貞網局', short: '貞網', class: 'corp' }], event_scope: structuredClone(SCOPES), event: [street] } as unknown as ContentPack['content'] }],
    })).not.toThrow()
  })
})

describe('戰敗：內海的 pinned、polluted（事件格式不用改）', () => {
  it('贏的是粉蕾絲、資料寫 defeat 指到那一件：走到那一件，裡面帶 pool: lace 的 malware 落得下去', async () => {
    const g = arena({ foes: ['en_pink'], eye: false })
    playOut(g)
    await g.finishBattle()
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_pinned', tier: 'enemy' })
    g.commit(acceptDefeat(g.k, g.state))
    const rows = malwareOf(g.state, 'pc')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('fw_main')
  })
})

// ======================================================================
// 名冊（features/roster）：他的沉溺到 100、主角的沉溺到 100（NPC_SYSTEM 10.6 節）
// ======================================================================

const R_ATTRS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].map((id) => ({ id, name: id, desc: `${id}。` }))
const R_SKILLS = [{ id: 'investigate', name: '調查', attr: 'intellect', desc: '找。' }, { id: 'streetwise', name: '街頭直覺', attr: 'intellect', desc: '察覺。' }, { id: 'composure', name: '定力', attr: 'resolve', desc: '穩住。' }]
const R_METERS = meterFeature(testMeter({ kind: 'affinity', name: '親密度', min: -100, max: 100, keyed: 'npc' }))
/** 路數（abilities 的內容種類）：名冊的人用 ext.paths 認行者，查人面那棵樹要這個種類在。 */
const PATH_KIND: Feature = { id: 'path_stub', install: (k) => k.content.defineKind({ kind: 'path', owner: 'path_stub', validate: () => [] }) }
const pathsOf = (tier = 2): Rec => ({ paths: [{ path: 'p_gun', slot: 'main', tier }] })
const runner = (id: string, name: string, o: Partial<Actor> = {}): Actor => makeActor({ id, name, role: 'npc', ext: pathsOf(), ...o })
const rosterPack = (): ContentPack => ({ id: 'roster_followups', content: { attribute: structuredClone(R_ATTRS), skill: structuredClone(R_SKILLS), path: [{ id: 'p_gun', name: '槍手', tree: '戰鬥直覺' }] } as unknown as ContentPack['content'] })
/** 替身：別人看到的沉溺（旗標 shown 有值就是那個值）；藏沉溺的手段有幾種（旗標 hide）。 */
const SHOWN: Feature = {
  id: 'shown_stub',
  install(k) {
    k.stats.defineStat({ id: 'sink_shown', owner: 'shown_stub', name: '別人看到的沉溺', min: 0, base: (state, actor) => (typeof state.flags.shown === 'number' && actor === state.pc ? state.flags.shown : (state.actors[actor]?.sink ?? 0)) })
    k.hooks.on('scan.person', 'shown_stub', ({ state }) => (typeof state.flags.hide === 'number' ? ({ hide: state.flags.hide } as never) : undefined))
  },
}

interface RosterOpts {
  pcSink?: number
  actors?: Actor[]
  shown?: boolean
  flags?: Record<string, unknown>
  features?: Feature[]
}
function rosterGame(o: RosterOpts = {}) {
  const { game } = makeGame({
    features: o.features ?? [PATH_KIND, R_METERS, ...(o.shown === false ? [] : [SHOWN]), rosterFeature], content: [rosterPack()], seed: 7,
    pc: { attrs: { charm: 14 }, sink: o.pcSink ?? 0 } as never,
    actors: o.actors ?? [runner('r_ann', '安'), runner('r_bob', '鮑'), runner('r_cora', '柯拉')],
    patch: { time: { day: 3, hour: 10, minute: 0 }, flags: (o.flags ?? {}) as never },
  })
  return game
}
type RG = ReturnType<typeof rosterGame>
const put = (g: RG, changes: ReportDraft['changes']) => g.commit(draft(changes))
const advanceTo = (g: RG, day: number, hour = 6) => g.commit(draft([{ op: 'time', minutes: toMinutes({ day, hour, minute: 0 }) - toMinutes(g.state.time) }], 'test.wait'))
const setLoyalty = (g: RG, id: string, v: number) => put(g, [{ op: 'meter', kind: 'loyalty', key: id, set: v }])
const setAffinity = (g: RG, id: string, v: number) => put(g, [{ op: 'meter', kind: 'affinity', key: id, set: v }])
const setSink = (g: RG, id: string, sink: number) => put(g, [{ op: 'actor.track', id, track: 'sink', delta: sink - g.state.actors[id]!.sink }])
const memberIds = (g: RG) => Object.keys(readRoster(g.state).members).sort()
const roster = (g: RG, ...ids: string[]) => ids.forEach((id) => g.commit(join(g.k, g.state, id)))
/** 這一週召集過（隊伍或同行）：記下最近一次召集是現在。 */
const callThem = (g: RG, ...ids: string[]) => g.commit(muster(g.k, g.state, { party: [], tagalong: ids.slice(0, 2) }))
const leaves = (g: RG) => g.state.reports.filter((r) => r.action === 'roster.leave')
// 第 7 天 06:00 是週一（第 1 週）；第 14 天是下一個週一
const MON1 = 7
const MON2 = 14

describe('名冊：他的沉溺到 100，離開（原因 sunk）、立旗標 sunk_away', () => {
  it('每週結帳那一刻：沉溺 100 的成員不在名冊、旗標在；99 的還在；不在名冊上的人沒事', () => {
    const g = rosterGame()
    roster(g, 'r_ann', 'r_bob')
    setSink(g, 'r_ann', 100)
    setSink(g, 'r_bob', 99)
    setSink(g, 'r_cora', 100)
    expect(memberIds(g)).toEqual(['r_ann', 'r_bob'])
    advanceTo(g, MON1)
    expect(memberIds(g)).toEqual(['r_bob'])
    expect(g.state.flags[sunkAwayFlag('r_ann')]).toBe(true)
    expect(g.state.flags[sunkAwayFlag('r_bob')]).toBeUndefined()
    expect(leaves(g)).toHaveLength(1)
    expect(leaves(g)[0]!.outcome.result).toBe('sunk')
  })

  it('沉溺到了的人不再擲忠誠離開（只有一份離開的報告，原因是 sunk）；週一之前不發生', () => {
    const g = rosterGame()
    roster(g, 'r_ann')
    setLoyalty(g, 'r_ann', 5)
    setSink(g, 'r_ann', 120)
    advanceTo(g, MON1 - 1)
    expect(memberIds(g)).toEqual(['r_ann'])
    withDice(0.01, () => advanceTo(g, MON1))
    expect(leaves(g).map((r) => r.outcome.result)).toEqual(['sunk'])
  })

  it('離開的人也離開隊伍與同行', () => {
    const g = rosterGame()
    roster(g, 'r_ann')
    callThem(g, 'r_ann')
    setSink(g, 'r_ann', 100)
    advanceTo(g, MON1)
    expect(readRoster(g.state).tagalong).toEqual([])
    expect(g.state.party).not.toContain('r_ann')
  })
})

describe('名冊：主角的沉溺到 100，看的是別人看到的沉溺', () => {
  it('真正 100、看到的 80、藏的手段 1：固定骰子沒看穿時沒有人離開、沒有旗標；看穿的那個人（忠誠 60）離開', () => {
    const g = rosterGame({ pcSink: 100, flags: { shown: 80, hide: 1 } })
    roster(g, 'r_ann', 'r_bob')
    setLoyalty(g, 'r_ann', 60)
    setLoyalty(g, 'r_bob', 60)
    callThem(g, 'r_ann', 'r_bob')
    // 骰面 1：1 ＋ 親密度加成 0 ＋ 技能 0 對 10 ＋ 意志 0 ＋ 定力 0 ＋ 隱藏 1 × 2 ＝ 12，沒有看穿
    withDice(0, () => advanceTo(g, MON1))
    expect(memberIds(g)).toEqual(['r_ann', 'r_bob'])
    expect(g.state.flags[PC_SUNK_DONE]).toBeUndefined()
    expect(leaves(g)).toHaveLength(0)
    // 下一週骰面 20：兩個人都看穿，忠誠 60 的都離開；只發生一次
    callThem(g, 'r_ann', 'r_bob')
    withDice(0.99, () => advanceTo(g, MON2))
    expect(memberIds(g)).toEqual([])
    expect(leaves(g).map((r) => r.outcome.result)).toEqual(['pc_sunk', 'pc_sunk'])
    expect(g.state.flags[PC_SUNK_DONE]).toBe(true)
  })

  it('只有看穿的人離開：骰面剛好差一點的人留下（每個人各擲一次，骰面不同）', () => {
    const g = rosterGame({ pcSink: 100, flags: { shown: 80, hide: 1 } })
    roster(g, 'r_ann', 'r_bob')
    setLoyalty(g, 'r_ann', 60)
    setLoyalty(g, 'r_bob', 60)
    // 安的調查高：1 ＋ 5 ＝ 6 加骰面；鮑什麼都沒有。DC 12。骰面固定 8：安 8 + 5 = 13 看穿、鮑 8 對 12 沒有
    g.state.actors.r_ann!.skills.investigate = 5
    callThem(g, 'r_ann', 'r_bob')
    withDice(0.35, () => advanceTo(g, MON1))
    expect(memberIds(g)).toEqual(['r_bob'])
    expect(g.state.flags[PC_SUNK_DONE]).toBe(true)
  })

  it('親密度每 20 點多 +1：親密度 40 的人骰面差 2 也看得穿；街頭直覺與調查取高的', () => {
    const g = rosterGame({ pcSink: 100, flags: { shown: 80, hide: 1 } })
    roster(g, 'r_ann', 'r_bob')
    setLoyalty(g, 'r_ann', 40)
    setLoyalty(g, 'r_bob', 40)
    setAffinity(g, 'r_ann', 40) // +2
    setAffinity(g, 'r_bob', 39) // +1
    g.state.actors.r_ann!.skills.streetwise = 0
    g.state.actors.r_bob!.skills.investigate = 0
    callThem(g, 'r_ann', 'r_bob')
    // 骰面 10（next 0.45）：安 10 + 2 = 12 對 12 過；鮑 10 + 1 = 11 不過
    withDice(0.45, () => advanceTo(g, MON1))
    expect(memberIds(g)).toEqual(['r_bob'])
  })

  it('主角沒有藏：忠誠 60 的離開、忠誠 80 的留下、親密度 85 而且自己沉溺 45 的有 follows_down 旗標（也留下）；第二週不再發生', () => {
    const g = rosterGame({ pcSink: 100, shown: false, actors: [runner('r_ann', '安'), runner('r_bob', '鮑'), runner('r_cora', '柯拉', { sink: 45 })] })
    roster(g, 'r_ann', 'r_bob', 'r_cora')
    setLoyalty(g, 'r_ann', 60)
    setLoyalty(g, 'r_bob', 80)
    setLoyalty(g, 'r_cora', 90)
    setAffinity(g, 'r_cora', 85)
    setAffinity(g, 'r_bob', 85) // 親密度夠、但他自己沉溺不到 40：只是留下
    g.commit(muster(g.k, g.state, { party: ['r_ann', 'r_bob'], tagalong: ['r_cora'] }))
    advanceTo(g, MON1)
    expect(memberIds(g)).toEqual(['r_bob', 'r_cora'])
    expect(leaves(g).map((r) => [r.outcome.result, r.changes.some((c) => c.op === 'roster.leave' && c.who === 'r_ann')])).toEqual([['pc_sunk', true]])
    expect(g.state.flags[followsDownFlag('r_cora')]).toBe(true)
    expect(g.state.flags[followsDownFlag('r_bob')]).toBeUndefined()
    expect(g.state.flags[followsDownFlag('r_ann')]).toBeUndefined()
    expect(g.state.flags[PC_SUNK_DONE]).toBe(true)
    // 第二週：忠誠掉到 10 的人也不再因為這件事離開（只發生一次）
    setLoyalty(g, 'r_bob', 70)
    g.commit(muster(g.k, g.state, { party: ['r_bob'], tagalong: [] }))
    advanceTo(g, MON2)
    expect(memberIds(g)).toEqual(['r_bob', 'r_cora'])
    expect(leaves(g)).toHaveLength(1)
  })

  it('這一週沒有同行過的人看不到：不離開、也不算他看見了；召集過的照樣反應', () => {
    const g = rosterGame({ shown: false })
    roster(g, 'r_ann', 'r_bob')
    setLoyalty(g, 'r_ann', 25)
    setLoyalty(g, 'r_bob', 25)
    advanceTo(g, MON1)
    // 第二週：主角沉溺到頂，只有安這一週被召集過；鮑上次被召集是進名冊那天，中間跨過兩個週一
    setSink(g, 'pc', 100)
    callThem(g, 'r_ann')
    advanceTo(g, MON2)
    expect(memberIds(g)).toEqual(['r_bob'])
    expect(leaves(g).map((r) => r.outcome.result)).toEqual(['pc_sunk'])
    expect(g.state.flags[PC_SUNK_DONE]).toBe(true)
  })

  it('主角的沉溺不到 100：什麼都不發生；沒有裝名冊的人沒事', () => {
    const g = rosterGame({ pcSink: 99, shown: false })
    roster(g, 'r_ann')
    setLoyalty(g, 'r_ann', 25)
    callThem(g, 'r_ann')
    advanceTo(g, MON1)
    expect(g.state.flags[PC_SUNK_DONE]).toBeUndefined()
    expect(leaves(g).map((r) => r.outcome.result)).not.toContain('pc_sunk')
  })

  it('weeklyDrafts 直接呼叫：沒有成員回空的', () => {
    const g = rosterGame({ pcSink: 100 })
    expect(rosterWeekly(g.k, g.state, { day: 3, hour: 10, minute: 0 }, { day: 7, hour: 7, minute: 0 })).toEqual([])
  })
})

// ======================================================================
// 帳單（features/bills）：付不出來的後果發效果 cyber_lock、contract_sign
// ======================================================================

interface BillBox { lines: Array<Rec>; calls: Rec[] }
/** 帳單項目的替身（一項 500 的帳，沒有錢就付不出來）加上兩個效果的替身：叫到就記一筆，並立一個旗標讓報告看得見。 */
function billStubs(box: BillBox, o: { lock?: boolean; sign?: boolean } = {}): Feature[] {
  const collect: Feature = {
    id: 'bill_collect_stub',
    install(k) {
      k.hooks.on('bill.collect', 'bill_collect_stub', () => structuredClone(box.lines) as never)
    },
  }
  const fakes: Feature = {
    id: 'bill_fx_stub',
    install(k) {
      if (o.lock !== false) {
        k.effects.register<Effect & Rec>({
          kind: 'cyber_lock', owner: 'bill_fx_stub', ai: false, validate: () => [],
          toChanges: (e) => { box.calls.push({ ...e }); return [{ op: 'flag', key: `locked_${e.on ? 'on' : 'off'}`, value: true }] },
          describe: (e) => (e.on ? '被鎖住' : '解開了'),
        })
      }
      if (o.sign !== false) {
        k.effects.register<Effect & Rec>({
          kind: 'contract_sign', owner: 'bill_fx_stub', ai: false, validate: () => [],
          toChanges: (e) => { box.calls.push({ ...e }); return [{ op: 'flag', key: 'signed_for_debt', value: e.debt as number }] },
          describe: () => '簽下了契約',
        })
      }
    },
  }
  return [collect, fakes]
}
function billGame(o: { cred?: number; lock?: boolean; sign?: boolean; rule?: Rec } = {}) {
  const box: BillBox = { lines: [{ id: 'rent', owner: 'bill_collect_stub', name: '房租', kind: 'due', amount: 500, order: 1, pay: 'cred' }], calls: [] }
  const { game } = makeGame({
    features: [meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), ...billStubs(box, o), billsFeature],
    content: [METER_CONTENT, { id: 'bills_followups', content: { bill_rule: [{ id: 'default', debt_faction: 'f_alpha', ...(o.rule ?? {}) }] } as unknown as ContentPack['content'] }], seed: 7,
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: o.cred ?? 0, cash: 0 } },
  })
  return Object.assign(game, { box })
}
type BG = ReturnType<typeof billGame>
const billWeek = (g: BG, n: number) => g.commit(draft([{ op: 'time', minutes: toMinutes({ day: 7 * n, hour: 7, minute: 0 }) - toMinutes(g.state.time) }], 'test.wait'))
const callsOf = (g: BG, kind?: string) => g.box.calls.filter((c) => kind === undefined || c.kind === kind)

describe('帳單：付不出來的後果（DOWNTIME 5.2 節）發效果', () => {
  it('欠繳第 1 週：發 cyber_lock { on: true, why: debt }（不給選擇器，讓義體自己挑）；第 2、3 週不再發', () => {
    const g = billGame()
    billWeek(g, 1)
    expect(callsOf(g)).toEqual([{ kind: 'cyber_lock', on: true, why: 'debt' }])
    expect(g.state.flags.locked_on).toBe(true)
    expect(g.state.flags.bill_step).toBe('lock')
    billWeek(g, 2)
    billWeek(g, 3)
    expect(callsOf(g, 'cyber_lock')).toHaveLength(1)
  })

  it('補繳（這一週付清、之前有欠）：發 cyber_lock { on: false, why: debt }；本來就沒欠的週不發', () => {
    const g = billGame()
    billWeek(g, 1)
    g.commit(draft([{ op: 'cred', delta: 100000 }], 'test.money'))
    billWeek(g, 2)
    expect(callsOf(g, 'cyber_lock')).toEqual([{ kind: 'cyber_lock', on: true, why: 'debt' }, { kind: 'cyber_lock', on: false, why: 'debt' }])
    expect(g.state.flags.bill_overdue).toBeUndefined()
    billWeek(g, 3)
    expect(callsOf(g, 'cyber_lock')).toHaveLength(2)
    // 一開始就付得起：什麼都不發
    const ok = billGame({ cred: 100000 })
    billWeek(ok, 1)
    expect(callsOf(ok)).toEqual([])
  })

  it('欠繳第 4 週起：發 contract_sign { holder: 規則表的債主, type: debt, debt: 欠的總額 }；第 3 週併成債之後總額是債的本金', () => {
    const g = billGame()
    for (const n of [1, 2, 3]) billWeek(g, n)
    expect(callsOf(g, 'contract_sign')).toEqual([])
    expect(readBills(g.state).debts[0]!.principal).toBe(1500)
    billWeek(g, 4) // 第 4 週：債的本金 1500 ＋ 這一週沒付的（房租 500 加債息 75）
    expect(callsOf(g, 'contract_sign')).toEqual([{ kind: 'contract_sign', holder: 'f_alpha', type: 'debt', debt: 2075 }])
    expect(g.state.flags.signed_for_debt).toBe(2075)
    const owed = (): number => readBills(g.state).arrears + readBills(g.state).debts.reduce((n, d) => n + d.principal, 0)
    expect(owed()).toBe(2075)
    billWeek(g, 5)
    expect(callsOf(g, 'contract_sign').map((c) => c.debt)).toEqual([2075, owed()])
  })

  it('債主是規則表 bill_rule 的 debt_faction，沒寫是伊甸園', () => {
    const g = billGame({ rule: { debt_faction: undefined } })
    for (const n of [1, 2, 3, 4]) billWeek(g, n)
    expect(callsOf(g, 'contract_sign')[0]!.holder).toBe('eden')
  })

  it('兩個效果都沒註冊：行為和只立旗標一樣（旗標 bill_step 照走，沒有別的變更）', () => {
    const g = billGame({ lock: false, sign: false })
    const steps: unknown[] = []
    for (const n of [1, 2, 3, 4]) {
      billWeek(g, n)
      steps.push(g.state.flags.bill_step)
    }
    expect(steps).toEqual(['lock', 'collector', 'debt', 'contract'])
    expect(g.box.calls).toEqual([])
    expect(Object.keys(g.state.flags).filter((f) => f.startsWith('locked_') || f === 'signed_for_debt')).toEqual([])
  })

  it('只註冊一個也行：只有 cyber_lock 的時候第 4 週不簽', () => {
    const g = billGame({ sign: false })
    for (const n of [1, 2, 3, 4]) billWeek(g, n)
    expect(callsOf(g).map((c) => c.kind)).toEqual(['cyber_lock'])
  })
})

// ======================================================================
// 休息（features/rest）：睡診所的病床另外發 treated
// ======================================================================

const BED_MAP: SpecialMapEntry = {
  id: 'm_bed', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.....#', 'E.1....2.E', '#........#', '##########'],
    cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '診所' }, { id: 'F2', at: [3, 1], mark: 'F', name: '旅館' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' }],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
} as never
const bedPack = (): ContentPack => ({
  id: 'rest_followups',
  content: {
    special_map: [structuredClone(BED_MAP)],
    facility_type: [{ id: 'fac_clinic', name: '診所', sleep: { rate: 0.6, cost: 0, treated: true } }, { id: 'fac_hotel', name: '旅館', sleep: { rate: 0.6, cost: 0 } }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_bed', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '診所' }, F2: { type: 'fac_hotel', name: '旅館' } } }],
  } as unknown as ContentPack['content'],
})
/** 效果 treated 的替身：叫到就記一筆（誰、什麼來源），並掛上狀況。 */
function treatedStub(calls: string[]): Feature {
  return {
    id: 'treated_stub',
    install(k) {
      k.effects.register<Effect>({
        kind: 'treated', owner: 'treated_stub', ai: false, validate: () => [],
        toChanges: (_e, ctx) => { calls.push(ctx.actor); return [{ op: 'actor.condition', id: ctx.actor, condition: 'treated' }] },
        describe: () => '傷口處理過了',
      })
    },
  }
}
function bedGame(o: { stub?: boolean; calls?: string[]; hurt?: boolean } = {}) {
  const calls = o.calls ?? []
  const { game } = makeGame({
    features: [characterFeature, worldFeature, restFeature, ...(o.stub === false ? [] : [treatedStub(calls)])], content: [bedPack()], seed: 7,
    pc: { hp: o.hurt ? 10 : 40 } as never,
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 100, cash: 100 } },
  })
  return game
}
const stand = (g: ReturnType<typeof bedGame>, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }

describe('休息：睡在診所的病床另外發效果 treated', () => {
  it('睡診所的病床（sleep.treated）：每個人各發一次 treated，狀況掛上；睡旅館不發', () => {
    const calls: string[] = []
    const g = bedGame({ calls })
    stand(g, 'F1')
    g.commit(sleepDraft(g.k, g.state))
    expect(calls).toEqual(['pc'])
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'treated')).toBe(true)
    const h = bedGame({ calls })
    stand(h, 'F2')
    h.commit(sleepDraft(h.k, h.state))
    expect(calls).toEqual(['pc'])
    expect(h.state.actors.pc!.conditions.some((c) => c.id === 'treated')).toBe(false)
  })

  it('沒有人註冊 treated：照常睡（病床本來就不受重傷限制），不發效果、不出錯', () => {
    const g = bedGame({ stub: false, hurt: true })
    stand(g, 'F1')
    expect(() => g.commit(sleepDraft(g.k, g.state))).not.toThrow()
    expect(g.state.actors.pc!.hp).toBeGreaterThan(20) // 受傷低於一半，病床不限制回復到一半
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'treated')).toBe(false)
  })

  it('睡一覺清 net_broken、喘口氣不清：M3 白箱修正批已做，測試在 M3-fix-whitebox.test.ts「睡一覺清掉（隊上每個人）；喘口氣不清」', () => {
    expect(true).toBe(true)
  })
})

// ======================================================================
// 打工（features/work）：一班 2、4、6、8 小時；升階看累計時數；結算報告的形狀
// ======================================================================

const WORK_MAP = BED_MAP
const jobPack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(WORK_MAP) as unknown as Rec],
    facility_type: [{ id: 'fac_dock', name: '碼頭' }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '碼頭街', kind: 'block', map: 'm_bed', exits: {}, facilities: { F1: { type: 'fac_dock', name: '碼頭' } } }],
    job: [{
      id: 'j_dock', name: '搬貨', facility: 'fac_dock', wage: 10, pay: 'cash',
      stages: [{ name: '搬貨', mult: 1 }, { name: '領班', mult: 1.5, need: { hours: 30, affinity: 0 } }, { name: '工頭', mult: 2.5, need: { hours: 72, affinity: 0 } }],
    }],
  }
  patch(c)
  return { id: 'work_followups', content: c as unknown as ContentPack['content'] }
}
function workGame(patch?: (c: Record<string, Rec[]>) => void) {
  const { game } = makeGame({
    features: [characterFeature, worldFeature, workFeature], content: [jobPack(patch)], seed: 7,
    patch: { time: { day: 3, hour: 8, minute: 0 }, money: { cred: 100, cash: 100 } },
  })
  game.commit(arrive(game.k, game.state, 'b_street', 'F1'))
  return game
}
type WG = ReturnType<typeof workGame>
const shiftOf = (g: WG, hours: number) => g.commit(shift(g.k, g.state, 'j_dock', hours))
const job = (g: WG) => g.k.content.get('job', 'j_dock') as never

describe('打工：一班可選 2、4、6、8 小時（使用者 2026-11-25）', () => {
  it('規則表預設是 2、4、6、8；6 小時照比例（時薪 10 → 60）；其他的班長擋下並列出可以選的', () => {
    const g = workGame()
    expect(workRules(g.k).hours).toEqual([2, 4, 6, 8])
    const before = g.state.money.cash
    const [r] = shiftOf(g, 6)
    expect(r!.outcome.result).toBe('done')
    expect(g.state.money.cash - before).toBe(60)
    for (const h of [0, 1, 3, 5, 7, 9]) expect(() => shift(g.k, g.state, 'j_dock', h)).toThrow(/2、4、6、8 小時/)
  })

  it('jobView 的預計列出四個班長', () => {
    const g = workGame()
    expect(jobView(g.k, g.state, job(g)).options.map((o) => o.hours)).toEqual([2, 4, 6, 8])
  })
})

describe('打工：升階看累計時數，不看班數', () => {
  it('第二階段 30 小時：累計 28 小時不問、再做 2 小時剛好 30 才問；一班 8 小時做三班（24 小時）不問', () => {
    const g = workGame()
    for (let i = 0; i < 3; i++) shiftOf(g, 8)
    expect(jobStateOf(g.state, 'j_dock')).toMatchObject({ shifts: 3, minutes: 24 * 60 })
    expect(needProgress(g.k, g.state, job(g), jobStateOf(g.state, 'j_dock'), 1)).toMatchObject({ hours: { have: 24, need: 30, ok: false } })
    const four = shift(g.k, g.state, 'j_dock', 4)
    expect(four.launch).toBeUndefined() // 28 小時
    g.commit(four)
    expect(jobStateOf(g.state, 'j_dock')).toMatchObject({ minutes: 28 * 60, asked: false })
    expect(needProgress(g.k, g.state, job(g), jobStateOf(g.state, 'j_dock'), 1)!.hours.ok).toBe(false)
    g.commit(shift(g.k, g.state, 'j_dock', 2))
    expect(needProgress(g.k, g.state, job(g), jobStateOf(g.state, 'j_dock'), 1)).toMatchObject({ hours: { have: 30, need: 30, ok: true }, met: true })
  })

  it('用很短的班刷次數沒用：十五班 2 小時才剛好 30 小時；班數照記但不看', () => {
    const g = workGame()
    for (let i = 0; i < 14; i++) shiftOf(g, 2)
    expect(needProgress(g.k, g.state, job(g), jobStateOf(g.state, 'j_dock'), 1)!.hours).toMatchObject({ have: 28, ok: false })
    shiftOf(g, 2)
    expect(jobStateOf(g.state, 'j_dock')).toMatchObject({ shifts: 15, minutes: 1800 })
    expect(needProgress(g.k, g.state, job(g), jobStateOf(g.state, 'j_dock'), 1)!.hours.ok).toBe(true)
  })

  it('第三階段 72 小時；舊格式 need.shifts 載不進來並指出要改成 hours', () => {
    const g = workGame()
    const js = { shifts: 9, minutes: 71 * 60 }
    expect(needProgress(g.k, g.state, job(g), js, 2)!.hours).toMatchObject({ have: 71, need: 72, ok: false })
    expect(needProgress(g.k, g.state, job(g), { minutes: 72 * 60 }, 2)!.hours.ok).toBe(true)
    expect(() => workGame((c) => { (c.job![0] as Rec).stages[1].need = { shifts: 5, affinity: 0 } })).toThrow(/need\.shifts：改成 hours/)
  })
})

describe('打工：結算報告的形狀（契約人的收入歸屬靠它認；檔頭註解有寫）', () => {
  it('action 是 work.shift、kind 是 downtime；錢的那一筆變更是 { op: 工作寫的錢, delta: 領到的 }；時間一筆、work 的 ext 一筆', () => {
    const g = workGame()
    const [r] = shiftOf(g, 4)
    expect(r!.action).toBe('work.shift')
    expect(r!.kind).toBe('downtime')
    expect(r!.actor).toBe('pc')
    const money = r!.changes.filter((c) => c.op === 'cash' || c.op === 'cred')
    expect(money).toEqual([{ op: 'cash', delta: 40 }])
    expect(r!.changes.filter((c) => c.op === 'time')).toEqual([{ op: 'time', minutes: 240 }])
    expect(r!.changes.filter((c) => c.op === 'ext' && (c as Rec).key === 'work')).toHaveLength(1)
    expect(r!.timeline[0]!.data).toMatchObject({ job: 'j_dock', stage: 1, hours: 4, degree: null, amount: 40, pay: 'cash' })
  })

  it('領 0 元的班（時薪 0）沒有錢的那一筆；錢的種類跟著工作寫的（cred）', () => {
    const g = workGame((c) => { (c.job![0] as Rec).wage = 0 })
    const [r] = shiftOf(g, 2)
    expect(r!.changes.some((c) => c.op === 'cash' || c.op === 'cred')).toBe(false)
    const h = workGame((c) => { (c.job![0] as Rec).pay = 'cred' })
    const [r2] = shiftOf(h, 2)
    expect(r2!.changes.filter((c) => c.op === 'cred' || c.op === 'cash')).toEqual([{ op: 'cred', delta: 20 }])
    expect(readWork(h.state).jobs.j_dock).toBeTruthy()
  })
})

// ======================================================================
// 契約：抗拒不疊沉溺的懲罰（resist_contract）、規矩沒有 person
// ======================================================================

describe('契約：發起的抗拒帶 resist_contract，沉溺分段的 resist_control −2 不套', () => {
  it('同一個人、沉溺 60（迷醉）：契約抗拒的檢定加值沒有 −2，另一個帶 resist_control 的檢定有', () => {
    const { game: g } = makeGame({
      features: [characterFeature, sinkFeature, contractFeature], content: [{ id: 'resist_followups', content: { skill: [{ id: 'composure', name: '定力', attr: 'resolve', desc: '穩住。' }] } as unknown as ContentPack['content'] }], seed: 7,
      pc: { sink: 65, skills: { composure: 2 } } as never,
      patch: { time: { day: 3, hour: 10, minute: 0 } },
    })
    const sum = (parts: Array<{ value: number }>) => parts.reduce((n, p) => n + p.value, 0)
    const contract = { id: 'c1', holder: { kind: 'eden', name: '伊甸園' }, type: 'work', relation: 'play', orders: [], rules: [], signed: 0, debt: 0, satisfaction: 50, queue: [] } as never
    const plan = resistPlan(g.k, g.state, 'pc', contract)
    const plain = g.k.passives.checkParts(g.state, 'pc', { skill: 'composure', tags: [] })
    const controlled = g.k.passives.checkParts(g.state, 'pc', { skill: 'composure', tags: ['resist_control'] })
    expect(sum(controlled)).toBe(sum(plain) - 2)
    expect(sum(plan.parts.filter((p) => p.source !== 'skill' && p.source !== 'attr'))).toBe(sum(plain.filter((p) => p.source !== 'skill' && p.source !== 'attr')))
    // 沉溺的 DC 加值（EVENTS 4.5）照舊：沉溺 65 的契約抗拒 DC 比沉溺 0 的高
    const calm = makeGame({ features: [characterFeature, sinkFeature, contractFeature], content: [{ id: 'resist_followups2', content: { skill: [{ id: 'composure', name: '定力', attr: 'resolve', desc: '穩住。' }] } as unknown as ContentPack['content'] }], seed: 7, pc: { sink: 0, skills: { composure: 2 } } as never }).game
    expect(plan.dc).toBeGreaterThan(resistPlan(calm.k, calm.state, 'pc', contract).dc)
  })

  it('規矩的種類只有 zone、curfew、dress：person 載不進、調整被擋', () => {
    const { game: g } = makeGame({ features: [characterFeature, contractFeature], content: [], seed: 7 })
    const res = g.k.effects.resolve([{ kind: 'contract_sign', holder: { kind: 'person', name: '白衣' }, type: 'private', rules: [{ kind: 'person', value: 'npc_x' }] }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(res.errors.join('')).toMatch(/rules\[0\]\.kind 只能是 zone、curfew、dress/)
  })
})

// ======================================================================
// 義體（features/cyberware）：cyber_lock 不寫選擇器、帳單停掉的訂閱、快取格與義體的種類；掃橋的藏沉溺手段
// ======================================================================

const CY_PARTS = [...PARTS, part('pt_plate', 'plate', { price: 400, stats: { armor: 2 } }), part('pt_act', 'actuator', { price: 300 }), part('pt_neuron', 'neuron', { price: 300 }), part('pt_chip', 'chip', { price: 1000 })]
const CY_BP = [
  ...BLUEPRINTS,
  bp('bp_arm', { name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 3, require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }], size: 2 }),
  bp('bp_big', { name: '大件', slot: 'torso', invasiveness: 'invasive', sink_cost: 6, require: [{ type: 'plate' }], size: 3 }),
  bp('bp_bridge', { name: '邊緣橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, grade: 2, bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }] }),
  bp('bp_subeye', { name: '企業義眼', slot: 'eye', invasiveness: 'light', sink_cost: 3, lock: 'subscription', require: [{ type: 'sensor' }] }),
]
const rawPiece = (uid: string, bpId: string, slot: string, over: Rec = {}): Rec => ({ uid, bp: bpId, kind_of: 'blueprint', slot, parts: {}, sink: 3, at: 0, ...over })
const cyPack = (): ContentPack => ({ id: 'cy_followups', content: { part: structuredClone(CY_PARTS), blueprint: structuredClone(CY_BP), faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }] } as unknown as ContentPack['content'] })
function cyGame(extra: Feature[] = [], money = { cred: 0, cash: 0 }) {
  const box: BillBox = { lines: [{ id: 'rent', owner: 'bill_collect_stub', name: '房租', kind: 'due', amount: 500, order: 1, pay: 'cred' }], calls: [] }
  const { game } = makeGame({
    features: [characterFeature, worldFeature, armor, cyberwareFeature, meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' })), ...billStubs(box, { lock: false, sign: false }), billsFeature, ...extra],
    content: [METER_CONTENT, cyPack(), { id: 'cy_bills', content: { bill_rule: [{ id: 'default', debt_faction: 'hizakura' }] } as unknown as ContentPack['content'] }], seed: 7,
    patch: { time: { day: 3, hour: 10, minute: 0 }, money },
  })
  return Object.assign(game, { box })
}
type CG = ReturnType<typeof cyGame>
const putPieces = (g: CG, pieces: Rec[]) => g.commit(draft([{ op: 'actor.ext', id: 'pc', key: 'cyber', value: { pieces } }], 'test.put'))
const rawOf = (g: CG): Rec[] => (g.state.actors.pc!.ext.cyber as Rec).pieces
const offOf = (g: CG): Record<string, string | undefined> => Object.fromEntries(rawOf(g).map((p) => [p.uid, p.off?.why]))
const fxApply = (g: CG, effects: Rec[]) => {
  const res = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(res.errors).toEqual([])
  g.commit(draft(res.changes, 'test.fx'))
  return res
}
const cyWeek = (g: CG, n: number) => g.commit(draft([{ op: 'time', minutes: toMinutes({ day: 7 * n, hour: 7, minute: 0 }) - toMinutes(g.state.time) }], 'test.wait'))

describe('義體：cyber_lock 可以不寫選擇器（帳單與契約的鎖）', () => {
  it('on: true 鎖照槽順序第一件非橋、還沒停著的；再鎖一次鎖下一件；橋永遠不鎖', () => {
    const g = cyGame()
    putPieces(g, [rawPiece('b1', 'bp_bridge', 'bridge', { parts: { chip: 'pt_chip' } }), rawPiece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' } }), rawPiece('a1', 'bp_arm', 'arm_l', { parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron' } })])
    const first = fxApply(g, [{ kind: 'cyber_lock', on: true, why: 'debt' }])
    expect(first.lines.join('')).toMatch(/被鎖住/)
    const locked = Object.entries(offOf(g)).filter(([, why]) => why === 'debt').map(([uid]) => uid)
    expect(locked).toHaveLength(1)
    expect(locked).not.toContain('b1')
    fxApply(g, [{ kind: 'cyber_lock', on: true, why: 'debt' }])
    expect(Object.values(offOf(g)).filter((why) => why === 'debt')).toHaveLength(2)
    // 只剩橋：沒有東西可以鎖
    expect(fxApply(g, [{ kind: 'cyber_lock', on: true, why: 'debt' }]).lines).toEqual(['身上沒有符合的義體可以鎖。'])
    expect(offOf(g).b1).toBeUndefined()
  })

  it('on: false 解開所有因為同一個 why 停著的；壞掉的與別的原因的不動；寫了選擇器的照舊', () => {
    const g = cyGame()
    putPieces(g, [
      rawPiece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, off: { why: 'debt' } }),
      rawPiece('a1', 'bp_arm', 'arm_l', { parts: { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron' }, off: { why: 'debt' } }),
      rawPiece('e2', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, off: { why: 'broken' } }),
      rawPiece('e3', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, off: { why: 'contract' } }),
    ])
    fxApply(g, [{ kind: 'cyber_lock', on: false, why: 'debt' }])
    expect(offOf(g)).toEqual({ e1: undefined, a1: undefined, e2: 'broken', e3: 'contract' })
    fxApply(g, [{ kind: 'cyber_lock', uid: 'e2', on: true, why: 'broken' }])
    expect(offOf(g).e2).toBe('broken')
  })

  it('cyber_take 與 cyber_unlock 仍然至少要寫一個選擇器', () => {
    const g = cyGame()
    for (const kind of ['cyber_take', 'cyber_unlock']) {
      const res = g.k.effects.resolve([{ kind }], effectCtx(g.k, g.state, { source: 'builtin' }))
      expect(res.errors.join('')).toContain('至少要寫一個')
    }
  })

  it('接上帳單（真的 cyberware）：欠繳第 1 週鎖一件、補繳之後解開；兩邊用同一個 why', () => {
    const g = cyGame()
    putPieces(g, [rawPiece('b1', 'bp_bridge', 'bridge', { parts: { chip: 'pt_chip' } }), rawPiece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' } })])
    cyWeek(g, 1)
    expect(offOf(g)).toEqual({ b1: undefined, e1: 'debt' })
    g.commit(draft([{ op: 'cred', delta: 10000 }], 'test.money'))
    cyWeek(g, 2)
    expect(offOf(g)).toEqual({ b1: undefined, e1: undefined })
  })
})

describe('義體的訂閱：玩家停掉的鎖住那一件（不算欠）、寬限不動', () => {
  const SUB = { kind: 'subscription', holder: 'hizakura', weekly: 30 }
  it('停掉：鎖住、owed 不加；恢復付費付清之後解開', () => {
    const g = cyGame([], { cred: 5000, cash: 0 })
    g.box.lines = []
    putPieces(g, [rawPiece('s1', 'bp_subeye', 'eye', { parts: { sensor: 'pt_lens' }, lock: { ...SUB } })])
    g.commit(setBill(g.k, g.state, 'cyber_sub.s1', { stopped: true }))
    cyWeek(g, 1)
    expect(offOf(g).s1).toBe('lock')
    expect((rawOf(g)[0]!.lock as Rec).owed ?? 0).toBe(0)
    g.commit(setBill(g.k, g.state, 'cyber_sub.s1', { stopped: false }))
    cyWeek(g, 2)
    expect(offOf(g).s1).toBeUndefined()
    expect(g.state.money.cred).toBe(5000 - 30)
  })

  it('寬限中：不動它', () => {
    const g = cyGame([], { cred: 5000, cash: 0 })
    g.box.lines = []
    putPieces(g, [rawPiece('s1', 'bp_subeye', 'eye', { parts: { sensor: 'pt_lens' }, lock: { ...SUB } })])
    g.commit(draft([{ op: 'bills.grace', item: 'cyber_sub.s1', until: toMinutes({ day: 30, hour: 0, minute: 0 }) }], 'test.grace'))
    cyWeek(g, 1)
    expect(offOf(g).s1).toBeUndefined()
  })
})

describe('快取格與義體的種類', () => {
  it('大小 2 以下的義體成品放得進快取格；橋、大件、不存在的、飾品不行（原因還是同一句）', () => {
    const g = cyGame()
    const block = (id: string) => quickBlock(g.k, id)
    expect(block('bp_arm')).toBeNull()
    expect(block('bp_eye')).toBeNull()
    for (const id of ['bp_bridge', 'bp_big', 'bp_none']) expect(block(id), id).toMatch(/不能放進快取格/)
  })

  it('失效與超頻的種類：手臂與腿都是 limb（規則表的 off_limb），其餘照部位，甲板是 deck，implant_kind 優先', () => {
    expect(kindOfBlueprint({ slot: 'arm' })).toBe('limb')
    expect(kindOfBlueprint({ slot: 'leg' })).toBe('limb')
    expect(kindOfBlueprint({ slot: 'eye' })).toBe('eye')
    expect(kindOfBlueprint({ slot: 'brain', deck: {} as never })).toBe('deck')
    expect(kindOfBlueprint({ slot: 'arm', implant_kind: 'smartgun' })).toBe('smartgun')
    expect(kindOfBlueprint({})).toBe('generic')
  })
})

describe('掃橋：藏沉溺的手段（scan.person 的 hide）與義體的執照', () => {
  const ask = (g: ReturnType<typeof makeGame>['game'], owner: string) => (g.k.hooks as unknown as { run(n: string, p: unknown): Array<{ owner: string; result: unknown }> })
    .run('scan.person', { state: g.state, actor: 'pc', strength: 2 }).filter((r) => r.owner === owner)

  it('抑制劑生效中：drugs 回答 { hide: 1 }；沒有就不回答', () => {
    const { game: g } = makeGame({ features: [characterFeature, drugsFeature], content: [{ id: 'drug_none', content: {} as never }], seed: 7, patch: { time: { day: 3, hour: 10, minute: 0 } } })
    expect(ask(g, 'drugs')).toEqual([])
    g.commit(draft([{ op: 'actor.ext', id: 'pc', key: 'drugs', value: { active: [], addiction: {}, withdrawal: {}, pending: [], suppressant: { until: toMinutes(g.state.time) + 1440 } } }], 'test.put'))
    expect(ask(g, 'drugs')).toEqual([{ owner: 'drugs', result: { hide: 1 } }])
  })

  it('裝著壓低 sink_shown 的調校：tuning 回答 { hide: 1 }；沒有就不回答', () => {
    const shownStat: Feature = { id: 'shown_stat', install: (k) => k.stats.defineStat({ id: 'sink_shown', owner: 'shown_stat', name: '別人看到的沉溺', min: 0, base: (state, actor) => state.actors[actor]?.sink ?? 0 }) }
    const { game: g } = makeGame({
      features: [characterFeature, lewdFeature, shownStat, tuningFeature],
      content: [{ id: 'tn_cool', content: { tuning: [{ id: 'tn_cool', name: '冰后', desc: '看起來很穩。', effects: [{ stat: 'sink_shown', amount: -20 }] }] } as unknown as ContentPack['content'] }], seed: 7,
      pc: { ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } } as never,
      patch: { time: { day: 3, hour: 10, minute: 0 } },
    })
    expect(ask(g, 'tuning')).toEqual([])
    const res = g.k.effects.resolve([{ kind: 'tuning', id: 'tn_cool' }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(res.errors).toEqual([])
    g.commit(draft(res.changes, 'test.fx'))
    expect(ask(g, 'tuning')).toEqual([{ owner: 'tuning', result: { hide: 1 } }])
  })
})

// ======================================================================
// 使用者新增的輸入欄：化身的外觀描述（CYBERSPACE 4；使用者 2026-11-25）
// ======================================================================

describe('化身的外觀描述 actor.ext.avatar.text', () => {
  const homePack = (): ContentPack => {
    const p = bedPack()
    ;(p.content as unknown as Rec).residence = [{ id: 'r_home', name: '住處', district: 'd_hive', block: 'b_street', facility: 'F2', level: 1, rent: 0, start: true }]
    return p
  }
  const avatarGame = () => {
    const { game } = makeGame({ features: [characterFeature, worldFeature, restFeature, deckFeature], content: [homePack()], seed: 7, patch: { time: { day: 3, hour: 10, minute: 0 } } })
    game.commit(arrive(game.k, game.state, 'b_street', 'F2'))
    game.commit(rentDraft(game.k, game.state, 'r_home'))
    return game
  }
  const textOf = (g: ReturnType<typeof avatarGame>): unknown => (avatarOf(g.state, 'pc') as { text?: string }).text

  it('在住處可以寫（最多 200 字，原樣存：標點、空白、不雅的字都不動）；清空是 null；存成一套時跟著存', () => {
    const g = avatarGame()
    expect(textOf(g)).toBeUndefined()
    const mine = '  銀色的短髮，眼睛是壞掉的霓虹。\n  （我自己寫的，不改）'
    g.commit(avatarDraft(g.k, g.state, 'pc', { text: mine }))
    expect(textOf(g)).toBe(mine)
    g.commit(avatarDraft(g.k, g.state, 'pc', { save: '日常' }))
    expect(avatarOf(g.state, 'pc').saved[0]).toMatchObject({ name: '日常', text: mine })
    g.commit(avatarDraft(g.k, g.state, 'pc', { text: null }))
    expect(textOf(g)).toBeUndefined()
    g.commit(avatarDraft(g.k, g.state, 'pc', { load: '日常' }))
    expect(textOf(g)).toBe(mine)
  })

  it('剛好 200 字可以、201 字擋下並說最多幾字；不是文字擋下', () => {
    const g = avatarGame()
    g.commit(avatarDraft(g.k, g.state, 'pc', { text: 'x'.repeat(200) }))
    expect((textOf(g) as string).length).toBe(200)
    expect(avatarBlock(g.k, g.state, 'pc', { text: 'y'.repeat(201) })).toBe(`外觀描述太長了（最多 ${AVATAR_TEXT_MAX} 字）。`)
    expect(avatarBlock(g.k, g.state, 'pc', { text: 5 as never })).toBe('外觀描述要寫成一段文字。')
  })
})
