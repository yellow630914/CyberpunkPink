// 驗收測試：dev/work/M4-curtain-fall.md（cpp-feature）。features/curtain 的落幕：戰敗事件（種類 stage）、結算、補演（可以喊停）、之後的三條路、母帶。
// 也驗跟著做的 M4-followups：簾口與面談花的時間、netrun 的 setup.layer_counts、netrun.finish_request、netrun.foe_ref 與 enemy_pick 的 culture。
// 規格：CYBERSPACE 8.8 節「打輸會怎樣」（四步、母帶那一條）、「預定要寫的」、「和別的系統」、「篩選關掉時」；LEWD_SYSTEM 3.4、6.1 節；COMBAT_SYSTEM 8.3、8.4 節；dev/adr/0019 第十二節與 P59、P60。
// 內容是測試自帶的最小假資料：三個夜、兩種有敵人的文化、五件種類 stage 的戰敗事件（序幕那一件有它的 _plain 版本）；defeat、scene、director、netrun、enemies、deck、lewd、character 用真的；
// bills 用假掛點（直接問 bill.collect、跑 bill.settled）；豔名用 lewd 的量表、敵對值用測試的量表；戰鬥用 TEST_NET_COMBAT，要輸的測試把戰鬥直接結成 lose。
// 時間：測試從第 8 天 20:00 開始（第 7 天 06:00 是週一，所以是第 1 週的週二晚上）。

import { describe, expect, it, vi } from 'vitest'
import type { Change, ContentPack, Feature, Report } from '../../src'
import { ActionBlocked, effectCtx, gridHere, meterOf } from '../../src'
import { characterFeature } from '../../src/features/character'
import { deckFeature } from '../../src/features/deck'
import { acceptDefeat, defeatFeature, defeatOf } from '../../src/features/defeat'
import { directorFeature, eventRunFeature } from '../../src/features/director'
import { enemiesFeature } from '../../src/features/enemies'
import { lewdFeature } from '../../src/features/lewd'
import { logout as netrunLogout, netExt, netrunFeature, parseSetup, readRun, useNode } from '../../src/features/netrun'
import { sceneAct, sceneFeature, sceneRawOf } from '../../src/features/scene'
import {
  CURTAIN_DEFAULT_RULES, CURTAIN_FLAG_RAIDED, CURTAIN_HEAT, curtainFeature, featureOf, curtainOf, curtainRuleProblems, curtainRules, doorBlock, enterBlocks, enterDraft, fallEventFor, fallView,
  buybackDraft, callOffDraft, payTabDraft, replayDraft, settleBlock, settleDraft, tapeChance, tipsRatio, pathsOf, curtainView,
} from '../../src/features/curtain'
import { TEST_NET_COMBAT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

vi.setConfig({ testTimeout: 60_000 })

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const T0 = { day: 8, hour: 20, minute: 0 }

const SKILLS = [['perform', 'charm'], ['stealth', 'reflex'], ['investigate', 'intellect'], ['firearms', 'reflex'], ['negotiate', 'charm']].map(([id, attr]) => ({ id, name: id, attr, desc: `${id}。` }))
const TAGS = [{ id: 't_cos', name: '角色扮演', axis: 'costume' }, { id: 't_flow', name: '性別流動', axis: 'body' }, { id: 't_dom', name: '支配', axis: 'relation' }]
const NIGHTS: Rec[] = [
  { id: 'n_a', name: 'A之夜', faction: 'f_a', tags: ['t_cos'], culture: 'ca' },
  { id: 'n_b', name: 'B之夜', faction: 'f_b', tags: ['t_flow'], culture: 'cb' },
  { id: 'n_c', name: 'C之夜', faction: 'f_a', tags: ['t_dom'], culture: 'ca', needs_filter: 'contract_dom' },
]
const TASTE = ['t_cos', 't_flow', 't_dom']

const program = (id: string, rank: string, culture: string, o: Rec = {}): Rec => ({
  id, name: `${culture}的${rank}`, desc: '簾後館的演出者。', faction: 'none', rank, grades: [1, 5], kind: 'program', culture,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...o,
})
const ENEMIES: Rec[] = ['ca', 'cb'].flatMap((c) => ['minion', 'elite', 'boss'].map((r) => program(`${c}_${r}`, r, c)))
const deckEntry = (id: string): Rec => ({ id, name: id, desc: `${id}。`, grade: 2, slots: 3, firewall: 10, legal: 'free' })
const item = (id: string, name: string): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 0, legal: 'free' })
const WEAPON_CLASSES = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const ROLES = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const POSITIONS = [{
  id: 'pos_side', name: '並坐', people: 2, roles: ROLES, mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
  links: [{ from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }],
}]
const CHEST = { id: 'tb_chest', kind: 'chest', rows: [{ weight: 1, name: '票根箱', stubs: [3, 8] }] }
const ORDER = { id: 'tb_order', kind: 'order', rows: [{ weight: 1, name: '台詞', order: 'line' }] }
const PRIZE = { id: 'tb_prize', kind: 'prize', rows: [{ weight: 1, name: '正式版構裝', give: [{ kind: 'item', id: 'it_prize', qty: 1 }] }] }

/** 落幕的戰敗事件（種類 stage）：主線一場成人場景（gate fixed、nature work、goal please、layer net），對象由 cast 生成。 */
const stageEvent = (id: string, o: Rec = {}): Rec => ({
  id, name: id, kind: 'stage', factions: [], fails_commission: false, cast: [{ role: 'a' }],
  versions: {
    default: {
      text: `${id}：落幕。館方派了補演。`,
      stages: [{ options: [{ id: 'play', text: '上台。', outcomes: { any: [] }, adult_scene: { when: 'always', gate: 'fixed', nature: 'work', role: 'none', goal: 'please', layer: 'net', circles: [['$pc', '$a']] } }] }],
    },
  },
  ...o,
})
/** _plain 版本：後台的一段訓話與帳，沒有場景。 */
const plainEvent = (id: string): Rec => ({
  id, name: id, kind: 'stage', factions: [], fails_commission: false,
  versions: { default: { text: `${id}：後台的一段訓話與帳。`, stages: [{ options: [{ id: 'talk', text: '聽訓話。', outcomes: { any: [] } }] }] } },
})
const EVENTS: Rec[] = [
  stageEvent('df_stage_foyer', { tags: ['x_stage'], fallback: 'df_stage_foyer_plain' }), plainEvent('df_stage_foyer_plain'),
  stageEvent('df_stage_headliner'), plainEvent('df_stage_headliner_plain'),
  stageEvent('df_stage_backstage'), plainEvent('df_stage_backstage_plain'),
  stageEvent('df_stage_vip'), plainEvent('df_stage_vip_plain'),
  stageEvent('df_stage_encore'), plainEvent('df_stage_encore_plain'),
  { id: 'df_generic', name: '通用', kind: 'generic', factions: [], fails_commission: false, default: true, versions: { default: { text: '你輸了。', stages: [{ options: [{ id: 'ok', text: '好。', outcomes: { any: [] } }] }] } } },
]

const QUIET = { heat: { highlight: 0 }, feature_bonus: 1 }

interface Opts {
  seed?: number
  tier?: 'floor' | 'box' | 'vip'
  cash?: number
  rule?: Rec
  content?: Rec
  /** false：沒有回答 director.cast 的替身（找不到補演的對象） */
  cast?: boolean
  taste?: string[]
  contentOff?: string[]
  /** 簾口：站在這個設施上才能報名（沒寫是這一局沒有簾口這回事） */
  door?: boolean
  /** 存檔規則的戰敗事件要不要演（沒寫是 always） */
  view?: 'always' | 'skippable' | 'never'
}
type G = ReturnType<typeof setup>

const pack = (o: Opts = {}): ContentPack => ({
  id: 'curtain_fall_test',
  content: {
    skill: SKILLS, tendency_tag: TAGS, weapon_class: WEAPON_CLASSES, position: POSITIONS, skin: [],
    faction: [{ id: 'f_a', name: '甲', short: '甲', class: 'corp' }, { id: 'f_b', name: '乙', short: '乙', class: 'corp' }, { id: 'rouge', name: '胭脂堂', short: '胭脂堂', class: 'street' }],
    district: [{ id: 'd1', name: '一區', grade: 2, blocks: [] }, { id: 'd2', name: '二區', grade: 2, blocks: [] }],
    enemy: ENEMIES, deck: [deckEntry('dk_own')], item: [item('it_prize', '正式版構裝')],
    curtain_night: NIGHTS, curtain_table: [ORDER, CHEST, PRIZE], curtain_rule: [{ id: 'default', ...(o.rule ?? {}) }],
    defeat_event: EVENTS,
    ...(o.door ? { facility_type: [{ id: 'fac_door', name: '簾口', curtain_door: true }, { id: 'fac_bar', name: '酒館' }] } : {}),
    ...o.content,
  } as never,
})

/** 回答 director.cast 的替身：生成一個演出者。 */
const CAST: Feature = {
  id: 'curtain_test_cast',
  install(k) {
    k.hooks.on('director.cast', 'curtain_test_cast', ({ state, role }) => {
      const id = `tmp_${state.seq.uid + 1}_${role}`
      return { actor: id, changes: [{ op: 'actor.add', actor: makeActor({ id, name: '演出者', role: 'npc', gender: 'female', ext: { bridge: { ...BRIDGE } } }) } as Change] }
    })
  },
}

/** 假的設施條件 at_facility：看狀態的 flags.at_door（測試自己立）。 */
const AT_FACILITY: Feature = {
  id: 'curtain_test_facility',
  install(k) {
    k.conditions.register<{ kind: string; types?: string[] }>({ kind: 'at_facility', owner: 'curtain_test_facility', validate: () => [], test: (c, { state }) => (c.types ?? []).includes(state.flags.at_facility as string) })
  },
}

/** 地圖上的區（內容種類 district 由世界的功能定義；這裡只要有這個種類，豔名的鍵才查得到）。 */
const DISTRICT_KIND: Feature = {
  id: 'curtain_test_district',
  install: (k) => {
    k.content.defineKind({ kind: 'district', owner: 'curtain_test_district', validate: () => [] })
    k.content.defineKind({ kind: 'facility_type', owner: 'curtain_test_district', validate: () => [] })
  },
}

function setup(o: Opts = {}) {
  const ext = { bridge: { ...BRIDGE }, deck: { uid: 'D1', slots: [], scripts: [] } }
  const pc = { attrs: { intellect: 14, body: 12, resolve: 14, reflex: 14, charm: 16 }, skills: { perform: 4, stealth: 3, investigate: 2, firearms: 3, negotiate: 4 }, ext }
  const features: Feature[] = [
    characterFeature, lewdFeature, DISTRICT_KIND, meterFeature(testMeter({ kind: 'hostility', owner: 'test', name: '敵對值', keyed: 'faction' })), enemiesFeature, deckFeature, netrunFeature, sceneFeature,
    directorFeature, eventRunFeature, defeatFeature, TEST_NET_COMBAT, ...(o.cast === false ? [] : [CAST]), ...(o.door ? [AT_FACILITY] : []), curtainFeature,
  ]
  const { game } = makeGame({
    seed: o.seed ?? 5, features, content: [pack(o)], pc: pc as never,
    actors: [makeActor({ id: 'c1', name: '同伴1', role: 'companion', gender: 'female', attrs: { charm: 10, reflex: 12 }, ext })],
    patch: {
      time: T0, money: { cred: 0, cash: o.cash ?? 20000 }, inventory: [{ id: 'dk_own', qty: 1, data: { uid: 'D1' } }],
      rules: { defeatView: o.view ?? 'always', ...(o.contentOff ? { contentOff: o.contentOff } : {}) } as never,
    } as never,
  })
  const c = curtainOf(game.state)
  commit(game, [{ op: 'ext', key: 'curtain', value: { ...c, member: { tier: o.tier ?? 'floor', since: 0, paid_until: 10 ** 9, clears: 0 }, taste: o.taste ?? TASTE } as never }], 'curtain.test_member')
  return game
}

const commit = (g: Pick<G, 'commit'>, changes: Change[], action = 'netrun.test') => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const cur = (g: G) => curtainOf(g.state)
const run = (g: G) => cur(g).run!
const nrun = (g: G) => readRun(g.state)!
const net = (g: G) => netExt(g.state, nrun(g).map)!
const setHeat = (g: G, v: number) => commit(g, [{ op: 'meter', kind: CURTAIN_HEAT, key: nrun(g).map, set: v }])
const cash = (g: G) => g.state.money.cash
const reportsOf = (g: G, action: string): Report[] => g.state.reports.filter((r) => r.action === action)
const advance = (g: G, minutes: number) => commit(g, [{ op: 'time', minutes }], 'test.wait')
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

// ---- 走格子 ----
const sheetOf = (g: G) => gridHere(g.k, g.state)!.sheet
const teleport = (g: G, p: [number, number], sheet?: string): void => void commit(g, [{ op: 'map.at', to: { map: nrun(g).map, sheet: sheet ?? g.state.maps.at!.sheet, x: p[0], y: p[1] } }])
function neighbourOf(g: G, p: [number, number]): [number, number] {
  const sheet = sheetOf(g)
  const around = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [p[0] + dx, p[1] + dy] as [number, number]).filter(([x, y]) => sheet.inBounds(x, y))
  const pick = around.find(([x, y]) => sheet.walkable(x, y)) ?? around.find(([x, y]) => sheet.kindAt(x, y) !== 'wall')
  if (!pick) throw new Error('旁邊沒有可以站的格子')
  return pick
}
const plainId = (g: G, sheet = g.state.maps.at!.sheet): string => Object.entries(net(g).foes[sheet]!).find(([, f]) => !f.gate)![0]
const toLayer = (g: G, n: number): void => {
  const sheets = g.state.maps.instances[nrun(g).map]!.gen!.map.sheets
  const e = sheets[n]!.cells!.find((m) => m.mark === 'E')!
  commit(g, [{ op: 'ext', key: 'netrun', value: { ...nrun(g), layer: n } as never }])
  teleport(g, e.at, `l${n + 1}`)
}
const reachEnd = (g: G): void => void commit(g, [{ op: 'ext', key: 'netrun', value: { ...nrun(g), layer: nrun(g).layers.length - 1, goal: { ...nrun(g).goal, done: true } } as never }])

/** 報名並開一趟（真的 netrun）。 */
function entered(o: Opts = {}, enter: Rec = {}): G {
  const g = setup(o)
  g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: 'n_a', tier: o.tier, seed: 11, ...enter }))
  return g
}

/** 在這一層站在一場遭遇旁邊開戰、結成輸，戰敗的選擇出現（還沒接受）。 */
async function loseFight(g: G, layer = 0): Promise<void> {
  if (layer > 0) toLayer(g, layer)
  const foe = plainId(g)
  teleport(g, neighbourOf(g, sheetOf(g).marker(foe)!.at))
  g.commit(useNode(g.k, g.state, 'fight', foe))
  g.state.battle!.result = { outcome: 'lose', text: '全隊倒下。' }
  await g.finishBattle()
}

/** 輸到被接受（場熱先設好）：回傳接受那一次提交的報告。 */
async function fallen(o: Opts = {}, at: { layer?: number; heat?: number } = {}): Promise<G> {
  const g = entered({ rule: QUIET, ...o })
  setHeat(g, at.heat ?? 80)
  await loseFight(g, at.layer ?? 0)
  g.commit(acceptDefeat(g.k, g.state))
  return g
}

const fall = (g: G) => cur(g).fall!
const FULL = Math.round(900 * 0.5)
const HALF = Math.round(FULL * 0.5)

// ===================================================================================================================
// 一、規則與格式
// ===================================================================================================================

describe('規則表 fall（CYBERSPACE 8.8 節「打輸會怎樣」）', () => {
  it('預設：打賞減半、補演的換算、沉溺 −2～+2、設備費一半、記帳 10% 上限兩倍、檔期四週每週一場館六你四、母帶 15% 加項上限 45%、買回兩倍', () => {
    const f = CURTAIN_DEFAULT_RULES.fall
    expect(f.tips_mult).toBe(0.5)
    expect(f.replay).toEqual({ bonus: 0.1, penalty: 0.1, good_min: 60, poor_below: 30 })
    expect(f.sink_range).toEqual([-2, 2])
    expect(f.fine_mult).toBe(0.5)
    expect(f.tab).toEqual({ weekly: 0.1, cap_mult: 2 })
    expect(f.gig).toMatchObject({ weeks: 4, shows_per_week: 1, split: 0.4, miss_hostility: 10 })
    expect(f.tape).toEqual({ base: 0.15, raided: 0.15, in_debt: 0.15, backstage: 0.1, cap: 0.45, fame: 5, buyback_mult: 2 })
    expect(Object.keys(f.events)).toEqual(['foyer', 'stage', 'backstage', 'vip', 'encore1', 'encore2'])
    expect(CURTAIN_DEFAULT_RULES.interview_minutes).toBe(60)
    expect(curtainRuleProblems(CURTAIN_DEFAULT_RULES as never)).toEqual([])
  })

  it('資料的 curtain_rule 蓋掉 fall 的數字；壞的欄位一條一句並忽略', () => {
    const g = setup({ rule: { fall: { tips_mult: 0.25, tab: { weekly: 0.2 }, events: { foyer: 'x' } } } })
    const f = curtainRules(g.k).fall
    expect(f.tips_mult).toBe(0.25)
    expect(f.tab).toEqual({ weekly: 0.2, cap_mult: 2 })
    expect(f.events.foyer).toBe('x')
    expect(f.events.stage).toBe('df_stage_headliner')
    expect(curtainRuleProblems({ fall: { tips_mult: -1 } })).not.toEqual([])
    expect(curtainRuleProblems({ fall: { sink_range: [3, 1] } })).not.toEqual([])
    expect(curtainRuleProblems({ fall: { gig: { split: 2 } } })).not.toEqual([])
    expect(curtainRuleProblems({ fall: { events: { foyer: 5 } } })).not.toEqual([])
    expect(curtainRuleProblems({ interview_minutes: -1 })).not.toEqual([])
    expect(() => setup({ rule: { fall: { tips_mult: -1 } } })).toThrow(/tips_mult/)
  })
})

// ===================================================================================================================
// 二、落幕：戰敗事件、結算
// ===================================================================================================================

describe('落幕（全隊倒下，戰敗被接受）', () => {
  it('開戰時這一場帶「輸在這一幕走哪一件戰敗事件」與 defeat_play；輸了之後選到的就是那一件（種類 stage）', async () => {
    const g = entered({ rule: QUIET })
    teleport(g, neighbourOf(g, sheetOf(g).marker(plainId(g))!.at))
    g.commit(useNode(g.k, g.state, 'fight', plainId(g)))
    expect(g.battle!.origin.ext).toMatchObject({ defeat_event: 'df_stage_foyer', defeat_play: true })
    g.state.battle!.result = { outcome: 'lose', text: '全隊倒下。' }
    await g.finishBattle()
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_stage_foyer', tier: 'origin', skipped: true, stage: 'played' })
    // 還在等三選一：這一趟還在、netrun 還沒收（熔斷只管不加沉溺、不扣線）
    expect(cur(g).run).toBeDefined()
    expect(nrun(g)).toBeDefined()
    expect(g.pendingDefeat).not.toBeNull()
  })

  it('輸在哪一幕走哪一件：序幕、第一幕、第二幕、終幕、加演各一件（規則表 fall.events）', () => {
    const g = entered({ rule: QUIET })
    const r = curtainRules(g.k)
    const pick = (act: number) => fallEventFor(g.k, g.state, r, run(g), act)
    expect([0, 1, 2, 3, 4, 5].map(pick)).toEqual(['df_stage_foyer', 'df_stage_headliner', 'df_stage_backstage', 'df_stage_vip', 'df_stage_encore', 'df_stage_encore'])
  })

  it('接受結果：fall.tips 是當時場熱那一段的一半、保證金沒有退、沉溺沒變、背包沒少東西、fall.stage 是 replay、這一趟收乾淨', async () => {
    const g = entered({ rule: QUIET })
    // 先在這一趟裡拿到一點東西（票根、獎品）：落幕不丟東西
    commit(g, [{ op: 'item', id: 'it_prize', qty: 1 }, { op: 'counter', key: 'curtain:stubs', delta: 7 }])
    setHeat(g, 80)
    const before = { cash: cash(g), inv: JSON.stringify(g.state.inventory), sink: g.state.actors.pc!.sink }
    await loseFight(g)
    expect(cash(g)).toBe(before.cash)
    const reports = g.commit(acceptDefeat(g.k, g.state))
    expect(reports.map((r) => r.action)).toEqual(expect.arrayContaining(['defeat.accept', 'curtain.fall']))
    expect(fall(g)).toMatchObject({ stage: 'replay', act: 0, heat: 80, tips: HALF, full: FULL, tier: 'floor', deposit: 300, event: 'df_stage_foyer' })
    expect(HALF).toBe(Math.round(900 * tipsRatio(curtainRules(g.k), 80) * 0.5))
    // 保證金沒收（沒有退）、打賞還沒付（等補演的結果）
    expect(cash(g)).toBe(before.cash)
    expect(g.state.actors.pc!.sink).toBe(before.sink)
    expect(JSON.stringify(g.state.inventory)).toBe(before.inv)
    expect(g.state.counters['curtain:stubs']).toBe(7)
    // 這一趟收乾淨：沒有結算（curtain.result）、netrun 收掉了、計數器歸零
    expect(cur(g).run).toBeUndefined()
    expect(readRun(g.state)).toBeNull()
    expect(reportsOf(g, 'curtain.result')).toHaveLength(0)
    expect(Object.entries(g.state.counters).filter(([k, v]) => k.startsWith('curtain:') && k !== 'curtain:stubs' && v !== 0)).toEqual([])
    expect(g.pendingDefeat).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
  })

  it('輸在第一幕：走第一幕那一件；主打的夜打賞 ×1.2 也算進去', async () => {
    const g = await fallen({ rule: { heat: { highlight: 0 } } }, { layer: 1 })
    expect(fall(g)).toMatchObject({ act: 1, event: 'df_stage_headliner', stage: 'replay' })
    const ratio = tipsRatio(curtainRules(g.k), 80)
    const feature = fall(g).night === featureOf(g.k, g.state)?.id
    expect(fall(g).full).toBe(Math.round(900 * ratio * (feature ? 1.2 : 1)))
    // 主打的夜（×1.2）：換成主打的夜再來一次
    const f2 = setup({ rule: { heat: { highlight: 0 } } })
    const night = featureOf(f2.k, f2.state)!.id
    f2.commit(enterDraft(f2.k, f2.state, { party: ['pc'], night, seed: 11 }))
    expect(run(f2).feature).toBe(true)
    setHeat(f2, 80)
    await loseFight(f2)
    f2.commit(acceptDefeat(f2.k, f2.state))
    expect(fall(f2).full).toBe(Math.round(900 * ratio * 1.2))
    expect(fall(f2).tips).toBe(Math.round(Math.round(900 * ratio * 1.2) * 0.5))
  })

  it('「重來這場戰鬥」之後 fall 不存在、這一趟還在那一場開打前', async () => {
    const g = entered({ rule: QUIET })
    setHeat(g, 80)
    await loseFight(g)
    const foe = plainId(g)
    expect(g.retryBattle()).toBeNull()
    expect(cur(g).fall).toBeUndefined()
    expect(cur(g).run).toBeDefined()
    expect(readRun(g.state)).toBeDefined()
    // 回到那一場開打之前再開打一次：還是第一回合、還沒分出結果，節點還沒處理過；等著的戰敗沒有了
    expect(g.battle!.round).toBe(1)
    expect(g.battle!.result).toBeUndefined()
    expect(g.pendingDefeat).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
    expect(net(g).foes.l1![foe]!.done).not.toBe(true)
    expect(cash(g)).toBe(20000 - 300)
  })

  it('提早落幕（場熱到 0）與全員拔線都不是戰敗：不產生 fall、不走這一張的任何一步', async () => {
    const early = entered({ rule: QUIET })
    setHeat(early, 0)
    expect(cur(early).fall).toBeUndefined()
    expect(reportsOf(early, 'curtain.fall')).toHaveLength(0)
    expect(reportsOf(early, 'curtain.result')).toHaveLength(1)
    const out = entered({ rule: QUIET })
    out.commit(netrunLogout(out.k, out.state))
    expect(cur(out).fall).toBeUndefined()
    expect(reportsOf(out, 'curtain.fall')).toHaveLength(0)
    expect(reportsOf(out, 'curtain.result')).toHaveLength(1)
  })

  it('沒有戰敗事件（沒有 stage 種類的事件可選）時走通用的那一件：落幕照算、沒有補演', async () => {
    const g = entered({ rule: { ...QUIET, fall: { events: { foyer: 'nope' }, plain: {} } }, view: 'never' })
    setHeat(g, 80)
    await loseFight(g)
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_generic', tier: 'generic' })
    g.commit(acceptDefeat(g.k, g.state))
    expect(fall(g)).toMatchObject({ stage: 'choose', tips: HALF })
    expect(fall(g).event).toBeUndefined()
  })
})

// ===================================================================================================================
// 三、補演
// ===================================================================================================================

describe('補演（可以喊停）', () => {
  it('喊停：沒有場景、fall.tips 是 0、進到 choose、其他不再扣', async () => {
    const g = await fallen()
    const before = cash(g)
    const sink = g.state.actors.pc!.sink
    const reports = g.commit(callOffDraft(g.k, g.state))
    expect(reports[0]!.action).toBe('curtain.replay')
    expect(reports[0]!.outcome.result).toBe('called_off')
    expect(fall(g)).toMatchObject({ stage: 'choose', tips: 0, called_off: true })
    expect(sceneRawOf(g.state)).toBeNull()
    expect(cash(g)).toBe(before)
    expect(g.state.actors.pc!.sink).toBe(sink)
    expect(reasonOf(() => callOffDraft(g.k, g.state))).toMatch(/已經結束/)
  })

  it('不喊停：開一場 nature work、goal please、layer net 的場景，對象是 cast 生成的演出者；開演之後不能再喊停', async () => {
    const g = await fallen()
    const reports = g.commit(replayDraft(g.k, g.state))
    expect(reports[0]!.action).toBe('curtain.replay')
    const s = sceneRawOf(g.state)!
    expect(s).toMatchObject({ nature: 'work', goal: 'please', layer: 'net' })
    expect(s.origin).toMatchObject({ by: 'curtain', ref: fall(g).run })
    expect(Object.keys(s.pairs)[0]).toMatch(/^tmp_/)
    expect(fall(g)).toMatchObject({ stage: 'replay', started: true })
    expect(reasonOf(() => callOffDraft(g.k, g.state))).toMatch(/已經開演|停下/)
    expect(reasonOf(() => replayDraft(g.k, g.state))).toMatch(/已經開演|已經有一場/)
    // 補演還沒演完，不能選路也不能報名
    expect(settleBlock(g.k, g.state, 'pay')).toMatch(/補演還沒結束/)
  })

  it('以合拍結束：打賞補回來再多一成（整份的 1.1 倍），付出去；進到 choose', async () => {
    const g = await fallen()
    g.commit(replayDraft(g.k, g.state))
    const s = sceneRawOf(g.state)!
    const partner = Object.keys(s.pairs)[0]!
    s.pairs[partner]!.fit = 70
    const before = cash(g)
    g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))
    expect(sceneRawOf(g.state)).toBeNull()
    const want = Math.round(FULL * 1.1)
    expect(fall(g)).toMatchObject({ stage: 'choose', tips: want, replayed: { band: 'good', fit: 70, from: HALF, to: want } })
    expect(cash(g) - before).toBe(want)
    expect(cur(g).week!.tips).toBe(want)
    // 補演結束發 curtain.replay（只發一次）
    expect(reportsOf(g, 'curtain.replay').map((r) => r.outcome.result)).toEqual(['start', 'done'])
  })

  it('普通不補、不合再減一成', async () => {
    const mid = await fallen()
    mid.commit(replayDraft(mid.k, mid.state))
    const sm = sceneRawOf(mid.state)!
    sm.pairs[Object.keys(sm.pairs)[0]!]!.fit = 40
    const b1 = cash(mid)
    mid.commit(sceneAct(mid.k, mid.state, { kind: 'stop' }))
    expect(fall(mid)).toMatchObject({ stage: 'choose', tips: HALF, replayed: { band: 'fair' } })
    expect(cash(mid) - b1).toBe(HALF)
    const bad = await fallen()
    bad.commit(replayDraft(bad.k, bad.state))
    const sb = sceneRawOf(bad.state)!
    sb.pairs[Object.keys(sb.pairs)[0]!]!.fit = 10
    const b2 = cash(bad)
    bad.commit(sceneAct(bad.k, bad.state, { kind: 'stop' }))
    expect(fall(bad)).toMatchObject({ stage: 'choose', tips: HALF - Math.round(FULL * 0.1), replayed: { band: 'poor' } })
    expect(cash(bad) - b2).toBe(HALF - Math.round(FULL * 0.1))
  })

  it('這一場結算給沉溺 +4 時實際只 +2（補一筆拉回來）；給 −4 時實際只 −2', async () => {
    for (const [given, kept] of [[4, 2], [-4, -2], [1, 1]] as const) {
      const g = await fallen({ seed: 9 })
      commit(g, [{ op: 'actor.track', id: 'pc', track: 'sink', delta: 10 }])
      g.commit(replayDraft(g.k, g.state))
      const s = sceneRawOf(g.state)!
      s.pairs[Object.keys(s.pairs)[0]!]!.fit = 70
      g.commit(sceneAct(g.k, g.state, { kind: 'stop' }, { closing: { sink: { kind: 'other', amount: given } } }))
      expect(g.state.actors.pc!.sink - 10, `給 ${given}`).toBe(kept)
      expect(fall(g).replayed).toMatchObject({ sink: given, kept })
    }
  })

  it('篩選：版本全被篩掉時走 _plain（沒有場景，打賞照算、當場付）', async () => {
    const g = await fallen({ contentOff: ['x_stage'] })
    expect(fall(g)).toMatchObject({ stage: 'choose', tips: HALF })
    expect(fall(g).event).toBeUndefined()
    expect(sceneRawOf(g.state)).toBeNull()
    expect(cash(g)).toBe(20000 - 300 + HALF)
    expect(defeatOf(g.state)).toBeNull()
  })

  it('篩選：純舞台場次（口味單的題材不到三個）走 _plain；戰鬥帶的是 _plain 那一件', async () => {
    const g = entered({ rule: QUIET, taste: ['t_cos'] })
    expect(run(g).pure_stage).toBe(true)
    setHeat(g, 80)
    teleport(g, neighbourOf(g, sheetOf(g).marker(plainId(g))!.at))
    g.commit(useNode(g.k, g.state, 'fight', plainId(g)))
    expect(g.battle!.origin.ext).toMatchObject({ defeat_event: 'df_stage_foyer_plain' })
    g.state.battle!.result = { outcome: 'lose', text: '全隊倒下。' }
    await g.finishBattle()
    g.commit(acceptDefeat(g.k, g.state))
    expect(fall(g)).toMatchObject({ stage: 'choose', tips: HALF })
    expect(sceneRawOf(g.state)).toBeNull()
  })

  it('找不到對象（沒有人回答 director.cast）：沒有補演，減半的打賞當場付、直接進 choose', async () => {
    const g = await fallen({ cast: false })
    expect(fall(g)).toMatchObject({ stage: 'choose', tips: HALF })
    expect(cash(g)).toBe(20000 - 300 + HALF)
  })

  it('pc_unwilling 不影響：補演本來就能喊停，不標這個', async () => {
    const g = await fallen({ contentOff: ['pc_unwilling'] })
    expect(fall(g).stage).toBe('replay')
    expect(callOffDraft(g.k, g.state)).toBeDefined()
  })
})

// ===================================================================================================================
// 四、之後的三條路
// ===================================================================================================================

describe('之後的三條路（付清、記帳、簽檔期）', () => {
  const choose = async (o: Opts = {}): Promise<G> => {
    const g = await fallen(o)
    g.commit(callOffDraft(g.k, g.state))
    return g
  }
  const FINE = 150

  it('沒選路之前報名被擋；補演還沒結束也被擋', async () => {
    const g = await fallen()
    expect(enterBlocks(g.k, g.state, { party: ['pc'] }).join('')).toMatch(/補演還沒結束/)
    g.commit(callOffDraft(g.k, g.state))
    expect(enterBlocks(g.k, g.state, { party: ['pc'] }).join('')).toMatch(/先選一條路/)
    expect(reasonOf(() => enterDraft(g.k, g.state, { party: ['pc'] }))).toMatch(/先選一條路/)
    g.commit(settleDraft(g.k, g.state, { how: 'pay' }))
    expect(enterBlocks(g.k, g.state, { party: ['pc'] })).toEqual([])
  })

  it('fallView：現在在哪一步、三條路各自的數字與能不能選', async () => {
    const g = await fallen()
    const v = fallView(g.k, g.state)!
    expect(v).toMatchObject({ step: 'replay', tips: HALF, full: FULL, deposit: 300, fine: FINE, called_off: false })
    expect(v.replay).toMatchObject({ can_start: true, can_call_off: true, started: false })
    expect(v.paths).toEqual([])
    g.commit(callOffDraft(g.k, g.state))
    const c = fallView(g.k, g.state)!
    expect(c).toMatchObject({ step: 'choose', tips: 0, called_off: true })
    expect(c.paths.map((p) => [p.id, p.amount, p.can])).toEqual([['pay', FINE, true], ['tab', FINE, true], ['gig', 0, true]])
    expect(pathsOf(g.k, g.state)).toHaveLength(3)
    expect(fallView(setup().k, setup().state)).toBeNull()
  })

  it('付清：扣保證金的一半（設備費與違約金）；現金不夠不能選', async () => {
    const g = await choose()
    const before = cash(g)
    const r = g.commit(settleDraft(g.k, g.state, { how: 'pay' }))[0]!
    expect(r.action).toBe('curtain.settle')
    expect(before - cash(g)).toBe(FINE)
    expect(cur(g).fall).toBeUndefined()
    expect(cur(g).tab).toBeUndefined()
    expect(reasonOf(() => settleDraft(g.k, g.state, { how: 'pay' }))).toMatch(/沒有落幕/)
    const poor = await choose({ cash: 400 })
    commit(poor, [{ op: 'cash', delta: -(cash(poor) - 100) }])
    expect(settleBlock(poor.k, poor.state, 'pay')).toMatch(/現金不夠/)
    expect(reasonOf(() => settleDraft(poor.k, poor.state, { how: 'pay' }))).toMatch(/現金不夠/)
    expect(pathsOf(poor.k, poor.state).find((p) => p.id === 'pay')!.can).toBe(false)
  })

  it('記帳：欠著；bill.collect 每週出一行 10% 的利息；欠到兩倍時報名被擋；還清之後可以', async () => {
    const g = await choose()
    const before = cash(g)
    g.commit(settleDraft(g.k, g.state, { how: 'tab' }))
    expect(cash(g)).toBe(before)
    expect(cur(g).tab).toEqual({ owed: FINE, since: expect.any(Number) })
    const collect = (week: number) => g.k.hooks.run('bill.collect', { state: g.state, week } as never).flatMap((r) => r.result as Rec[])
    expect(collect(2).find((l) => l.id === 'curtain_tab')).toMatchObject({ owner: 'curtain', kind: 'due', amount: 15, pay: 'either' })
    // 欠到保證金的兩倍（600）：報名被擋；只是錢，不連到契約
    commit(g, [{ op: 'ext', key: 'curtain', value: { ...cur(g), tab: { owed: 600, since: 0 } } as never }])
    expect(enterBlocks(g.k, g.state, { party: ['pc'] }).join('')).toMatch(/上限/)
    expect(collect(2).find((l) => l.id === 'curtain_tab')!.amount).toBe(60)
    // 還一部分還是擋；還清之後可以
    g.commit(payTabDraft(g.k, g.state, { amount: 100 }))
    expect(cur(g).tab!.owed).toBe(500)
    expect(enterBlocks(g.k, g.state, { party: ['pc'] })).toEqual([])
    g.commit(payTabDraft(g.k, g.state))
    expect(cur(g).tab).toBeUndefined()
    expect(g.state.flags.contract_signed).toBeUndefined()
    expect(reasonOf(() => payTabDraft(g.k, g.state))).toMatch(/沒有欠/)
    expect(collect(2).find((l) => l.id === 'curtain_tab')).toBeUndefined()
  })

  it('簽檔期：contract_dom 關掉時不列；簽了之後這一趟的結算只拿四成（獎金與打賞，保證金退回不受影響）', async () => {
    const off = await choose({ contentOff: ['contract_dom'] })
    expect(pathsOf(off.k, off.state).map((p) => p.id)).toEqual(['pay', 'tab'])
    expect(settleBlock(off.k, off.state, 'gig')).toMatch(/篩選/)
    expect(reasonOf(() => settleDraft(off.k, off.state, { how: 'gig' }))).toMatch(/篩選/)

    const g = await choose()
    const before = cash(g)
    g.commit(settleDraft(g.k, g.state, { how: 'gig' }))
    expect(cash(g)).toBe(before)
    expect(cur(g).gig).toMatchObject({ missed: 0, checked: 0, shows: {} })
    expect(cur(g).gig!.until - cur(g).gig!.start).toBe(4 * 7 * 1440)
    // 簽著檔期不擋報名（反而每週要上）；這一場算這個星期上過一場
    g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: 'n_a', seed: 11 }))
    expect(cur(g).gig!.shows).toEqual({ '0': 1 })
    setHeat(g, 50)
    const start = cash(g)
    reachEnd(g)
    const r = reportsOf(g, 'curtain.result').at(-1)!.timeline[0]!.data as Rec
    expect(r).toMatchObject({ prize: 360, tips: Math.round(900 * 0.2 * 0.4), refund: 300 })
    expect(cash(g) - start).toBe(360 + Math.round(900 * 0.2 * 0.4) + 300)
    // 落幕的打賞也只拿四成
    const f = await fallen()
    f.commit(callOffDraft(f.k, f.state))
    f.commit(settleDraft(f.k, f.state, { how: 'gig' }))
    f.commit(enterDraft(f.k, f.state, { party: ['pc'], night: 'n_a', seed: 11 }))
    setHeat(f, 80)
    await loseFight(f)
    const c0 = cash(f)
    f.commit(acceptDefeat(f.k, f.state))
    f.commit(callOffDraft(f.k, f.state))
    expect(cash(f)).toBe(c0)
    const g2 = await fallen({ cast: false })
    g2.commit(settleDraft(g2.k, g2.state, { how: 'gig' }))
    g2.commit(enterDraft(g2.k, g2.state, { party: ['pc'], night: 'n_a', seed: 11 }))
    setHeat(g2, 80)
    await loseFight(g2)
    const c1 = cash(g2)
    g2.commit(acceptDefeat(g2.k, g2.state))
    expect(cash(g2) - c1).toBe(Math.round(HALF * 0.4))
  })

  it('檔期：哪一週沒上場 missed +1、勢力敵對值 +10；每週至少上一場的沒事；四週後 gig 沒了；簽著檔期時不能再簽', async () => {
    const g = await choose()
    g.commit(settleDraft(g.k, g.state, { how: 'gig' }))
    const hostility = (): number => meterOf(g.k, g.state, 'hostility', 'rouge')
    const week = 7 * 1440
    const show = (night: string, seed: number): void => {
      g.commit(enterDraft(g.k, g.state, { party: ['pc'], night, seed }))
      g.commit(netrunLogout(g.k, g.state))
    }
    // 第 1 週上了一場、第 2 週沒上、第 3 週上了、第 4 週沒上
    show('n_a', 11)
    advance(g, week)
    expect(cur(g).gig).toMatchObject({ checked: 1, missed: 0 })
    expect(hostility()).toBe(0)
    advance(g, week)
    expect(cur(g).gig).toMatchObject({ checked: 2, missed: 1 })
    expect(hostility()).toBe(10)
    expect(reportsOf(g, 'curtain.settle').some((r) => r.outcome.result === 'gig_week')).toBe(true)
    show('n_b', 12)
    expect(cur(g).gig!.shows).toEqual({ '0': 1, '2': 1 })
    advance(g, week)
    expect(cur(g).gig).toMatchObject({ checked: 3, missed: 1 })
    advance(g, week)
    // 四個星期過完：第 4 週沒上、到期自動結束
    expect(cur(g).gig).toBeUndefined()
    expect(hostility()).toBe(20)
    expect(reportsOf(g, 'curtain.settle').at(-1)!.outcome.result).toBe('gig_end')
  })

  it('簽著檔期時不能再簽第二份；到期之後又可以', async () => {
    const g = await fallen()
    g.commit(callOffDraft(g.k, g.state))
    g.commit(settleDraft(g.k, g.state, { how: 'gig' }))
    g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: 'n_a', seed: 11 }))
    setHeat(g, 80)
    await loseFight(g)
    g.commit(acceptDefeat(g.k, g.state))
    g.commit(callOffDraft(g.k, g.state))
    expect(settleBlock(g.k, g.state, 'gig')).toMatch(/已經簽著檔期/)
    expect(pathsOf(g.k, g.state).find((p) => p.id === 'gig')!.can).toBe(false)
    g.commit(settleDraft(g.k, g.state, { how: 'pay' }))
  })
})

// ===================================================================================================================
// 五、母帶
// ===================================================================================================================

describe('母帶（每次落幕擲一次外流）', () => {
  const sure = { ...QUIET, fall: { tape: { base: 1, cap: 1 } } }

  it('機率：基底 15%；欠款、第二幕、當週被臨檢各加；最高 45%（三項都成立是 0.45 不是 0.55）', () => {
    const g = setup()
    expect(tapeChance(g.k, g.state, { act: 0 })).toBe(0.15)
    expect(tapeChance(g.k, g.state, { act: 2 })).toBe(0.25)
    expect(tapeChance(g.k, g.state, { act: 0, indebted: true })).toBe(0.3)
    commit(g, [{ op: 'flag', key: CURTAIN_FLAG_RAIDED, value: true }])
    expect(tapeChance(g.k, g.state, { act: 0 })).toBe(0.3)
    expect(tapeChance(g.k, g.state, { act: 2, indebted: true })).toBe(0.45)
    commit(g, [{ op: 'ext', key: 'curtain', value: { ...cur(g), tab: { owed: 10, since: 0 } } as never }])
    expect(tapeChance(g.k, g.state, { act: 2 })).toBe(0.45)
  })

  it('把骰子固定成外流：旗標在、每一區的豔名 +5、tapes 記一筆 leaked', async () => {
    const g = await fallen({ rule: sure })
    const id = fall(g).run
    expect(g.state.flags[`curtain_tape:${id}`]).toBe(true)
    expect(meterOf(g.k, g.state, 'fame', 'd1')).toBe(5)
    expect(meterOf(g.k, g.state, 'fame', 'd2')).toBe(5)
    expect(cur(g).tapes).toEqual([{ id, leaked: true, price: 600 }])
    expect(reportsOf(g, 'curtain.fall').at(-1)!.narration!.results!.join('')).toMatch(/外流/)
  })

  it('沒有擲到外流：沒有旗標、沒有豔名、沒有母帶', async () => {
    const g = await fallen({ rule: { ...QUIET, fall: { tape: { base: 0, raided: 0, in_debt: 0, backstage: 0 } } } })
    expect(Object.keys(g.state.flags).filter((f) => f.startsWith('curtain_tape'))).toEqual([])
    expect(meterOf(g.k, g.state, 'fame', 'd1')).toBe(0)
    expect(cur(g).tapes).toEqual([])
  })

  it('blacktape 關掉時：照樣擲，結果是「館方保管」：沒有旗標、沒有豔名、tapes 有一筆可以買回', async () => {
    const g = await fallen({ rule: sure, contentOff: ['blacktape'] })
    const id = fall(g).run
    expect(g.state.flags[`curtain_tape:${id}`]).toBeUndefined()
    expect(meterOf(g.k, g.state, 'fame', 'd1')).toBe(0)
    expect(cur(g).tapes).toEqual([{ id, leaked: false, price: 600 }])
  })

  it('買回：付保證金的兩倍，那一筆標成 bought、旗標拿掉；錢不夠、已經買回、沒有這一支都被擋', async () => {
    const g = await fallen({ rule: sure })
    g.commit(callOffDraft(g.k, g.state))
    const id = fall(g).run
    const before = cash(g)
    const r = g.commit(buybackDraft(g.k, g.state, { tape: id }))[0]!
    expect(r.action).toBe('curtain.tape')
    expect(before - cash(g)).toBe(600)
    expect(cur(g).tapes[0]).toMatchObject({ id, bought: true })
    expect(g.state.flags[`curtain_tape:${id}`]).toBeUndefined()
    expect(reasonOf(() => buybackDraft(g.k, g.state, { tape: id }))).toMatch(/已經買回/)
    expect(reasonOf(() => buybackDraft(g.k, g.state, { tape: 'zzz' }))).toMatch(/沒有編號/)
    const poor = await fallen({ rule: sure, cash: 400 })
    commit(poor, [{ op: 'cash', delta: -(cash(poor) - 100) }])
    expect(reasonOf(() => buybackDraft(poor.k, poor.state, { tape: fall(poor).run }))).toMatch(/現金不夠/)
    // 館方保管的也買得回來
    const held = await fallen({ rule: sure, contentOff: ['blacktape'] })
    held.commit(buybackDraft(held.k, held.state, { tape: fall(held).run }))
    expect(cur(held).tapes[0]!.bought).toBe(true)
  })
})

// ===================================================================================================================
// 六、M4-followups：簾口、面談的時間、layer_counts、finish_request、foe_ref 與 enemy_pick 的 culture
// ===================================================================================================================

describe('簾口與面談花的時間（M4-curtain-entry 回報）', () => {
  it('報名要站在簾口（設施種類的欄位 curtain_door）；這一局沒有簾口這回事就沒有這條限制', () => {
    const none = setup()
    expect(doorBlock(none.k, none.state)).toBeNull()
    const g = setup({ door: true })
    expect(doorBlock(g.k, g.state)).toMatch(/簾口/)
    expect(enterBlocks(g.k, g.state, { party: ['pc'] }).join('')).toMatch(/要站在簾口/)
    expect(reasonOf(() => enterDraft(g.k, g.state, { party: ['pc'], night: 'n_a' }))).toMatch(/要站在簾口/)
    commit(g, [{ op: 'flag', key: 'at_facility', value: 'fac_bar' }])
    expect(doorBlock(g.k, g.state)).toMatch(/簾口/)
    commit(g, [{ op: 'flag', key: 'at_facility', value: 'fac_door' }])
    expect(doorBlock(g.k, g.state)).toBeNull()
    expect(enterBlocks(g.k, g.state, { party: ['pc'] })).toEqual([])
  })

  it('面談花的時間在規則表（interview_minutes，預設 60 分鐘）；真的走一次面談見 M4-curtain-entry.test.ts', () => {
    expect(curtainRules(setup().k).interview_minutes).toBe(60)
    expect(curtainRules(setup({ rule: { interview_minutes: 15 } }).k).interview_minutes).toBe(15)
    expect(curtainRules(setup({ rule: { interview_minutes: 0 } }).k).interview_minutes).toBe(0)
    expect(() => setup({ rule: { interview_minutes: -5 } })).toThrow(/interview_minutes/)
  })
})

describe('netrun：setup.layer_counts（每一層一份）', () => {
  it('每一幕自己的數量：第二幕有近道的位置、別的幕沒有；終幕不多放賞箱；遭遇數照每一幕', () => {
    const g = entered()
    const sheets = g.state.maps.instances[nrun(g).map]!.gen!.map.sheets
    const n = (i: number, mark: string): number => (sheets[i]!.cells ?? []).filter((m) => m.mark === mark).length
    expect([0, 1, 2, 3].map((i) => n(i, 'b'))).toEqual([0, 0, 1, 0])
    expect(n(3, 'a')).toBe(0)
    expect(n(3, 'p')).toBe(1)
    expect([0, 1, 2, 3].map((i) => n(i, 'f'))).toEqual([2, 2, expect.any(Number), 2])
  })

  it('格式：每一份是 { foe, archive, ... } 各 [最少, 最多]；不合格的一條一句', () => {
    expect(parseSetup({ grade: 1, layer_counts: [{ foe: [1, 2] }, {}] }).problems).toEqual([])
    expect(parseSetup({ grade: 1, layer_counts: 'x' }).problems.join('')).toMatch(/layer_counts/)
    expect(parseSetup({ grade: 1, layer_counts: [{ foe: [3, 1] }] }).problems.join('')).toMatch(/layer_counts\[0\]\.foe/)
    expect(parseSetup({ grade: 1, layer_counts: [{ nope: [1, 1] }] }).problems.join('')).toMatch(/nope/)
    expect(parseSetup({ grade: 1, layer_counts: [{ foe: [2, 2] }] }).parsed.layerCounts).toEqual([{ foe: [2, 2] }])
  })
})

describe('netrun：netrun.finish_request（別的功能要求以 done 收掉這一趟）', () => {
  it('回答 true 的功能，這一趟在下一次報告套用之後以 done 收場；沒有人回答什麼都不發生', () => {
    const g = entered({ rule: QUIET })
    // 沒有人回答 true：一份不相干的報告之後還在
    commit(g, [{ op: 'counter', key: 'x', delta: 1 }])
    expect(nrun(g)).toBeDefined()
    // 簾後館在場熱到 0 時回答 true：自動收場，不必走出去或登出
    setHeat(g, 0)
    expect(readRun(g.state)).toBeNull()
    expect(reportsOf(g, 'netrun.end')).toHaveLength(1)
    expect(g.k.hooks.run('netrun.finish_request', { state: g.state, run: {} as never })).toEqual([])
  })
})

describe('netrun.foe_ref 與 enemy_pick 的 culture（簾後館拿掉自己的 curtain_pick）', () => {
  it('遭遇的敵人用 enemy_pick 帶 culture 與這一幕的等級；沒有 curtain_pick 這個單位來源了', () => {
    const g = entered({ rule: QUIET })
    expect(g.k.battle.getUnitSource('curtain_pick')).toBeUndefined()
    expect(g.k.battle.getUnitSource('enemy_pick')).toBeDefined()
    for (const sheet of Object.keys(net(g).foes)) for (const f of Object.values(net(g).foes[sheet]!)) for (const r of f.foes) expect(r).toMatchObject({ from: 'enemy_pick', faction: 'none', grade: 2, culture: expect.stringMatching(/^c[ab]$/) })
  })

  it('enemy_pick 的 culture：只挑那個文化的兵種（不看勢力）；那個文化沒有兵種丟錯寫出文化', () => {
    const g = setup()
    const source = g.k.battle.getUnitSource('enemy_pick')!
    const ctx = { k: g.k, state: g.state, side: 'foe', mode: 'net', grade: 2 as never, allyCount: 1 } as never
    for (const culture of ['ca', 'cb']) for (let i = 0; i < 5; i++) expect((source({ from: 'enemy_pick', faction: 'zzz', grade: 2, rank: 'elite', culture, seed: `s${i}` }, ctx) as Rec).enemy).toBe(`${culture}_elite`)
    expect(() => source({ from: 'enemy_pick', faction: 'none', grade: 2, rank: 'elite', culture: 'cc', seed: 's' }, ctx)).toThrow(/文化 cc/)
    expect(() => source({ from: 'enemy_pick', faction: 'none', grade: 2, rank: 'elite', culture: '', seed: 's' }, ctx)).toThrow(/culture/)
  })
})

describe('curtainView 與 fallView 的邊角', () => {
  it('curtainView 在落幕之後是 null（這一趟收乾淨了）；fallView 才有東西', async () => {
    const g = await fallen()
    expect(curtainView(g.k, g.state)).toBeNull()
    expect(fallView(g.k, g.state)).not.toBeNull()
  })
})

// ===================================================================================================================
// 事件用的三個效果（M4-followups-2 第 9 項；CYBERSPACE 8.8 節「預定要寫的」df_stage_vip）
// ===================================================================================================================

describe('效果 curtain_gig、curtain_patron、curtain_lead（只有內建的來源能用）', () => {
  const fx = (g: G, effects: Rec[], source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve(effects as never, effectCtx(g.k, g.state, { source }))
  const apply = (g: G, effects: Rec[]) => {
    const res = fx(g, effects)
    expect(res.errors).toEqual([])
    g.commit({ kind: 'action', action: 'test.fx', location: {}, party: [], timeline: [], changes: res.changes, outcome: { result: 'ok', summary: '測試' } })
    return res
  }
  const flag = (g: G, key: string) => g.state.flags[key]

  it('curtain_gig：從事件直接簽四週的檔期（和落幕後選「簽檔期」同一條路）；weeks 可以改成 1～12；沒有檔期就沒有 gig 欄位', () => {
    const g = setup()
    expect(cur(g).gig).toBeUndefined()
    const res = apply(g, [{ kind: 'curtain_gig' }])
    expect(res.lines.join('')).toContain('4 週')
    expect(cur(g).gig).toMatchObject({ missed: 0, checked: 0, shows: {} })
    expect(cur(g).gig!.until - cur(g).gig!.start).toBe(4 * 7 * 1440)
    const h = setup()
    apply(h, [{ kind: 'curtain_gig', weeks: 2 }])
    expect(cur(h).gig!.until - cur(h).gig!.start).toBe(2 * 7 * 1440)
    // 簽著之後上場要照檔期算（沿用既有規則）：報名一場算這個星期上過一場
    g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: 'n_a', seed: 11 }))
    expect(cur(g).gig!.shows).toEqual({ '0': 1 })
  })

  it('curtain_gig：已經簽著落空並寫原因（不丟錯、沒有變更）；contract_dom 被篩選關掉也落空；格式不對在載入時擋下', () => {
    const g = setup()
    apply(g, [{ kind: 'curtain_gig' }])
    const again = fx(g, [{ kind: 'curtain_gig', weeks: 8 }])
    expect(again.errors).toEqual([])
    expect(again.changes).toEqual([])
    expect(again.lines.join('')).toContain('已經簽著檔期')
    const off = setup({ contentOff: ['contract_dom'] })
    const blocked = fx(off, [{ kind: 'curtain_gig' }])
    expect(blocked.changes).toEqual([])
    expect(blocked.lines.join('')).toContain('篩選')
    expect(cur(off).gig).toBeUndefined()
    expect(fx(g, [{ kind: 'curtain_gig', weeks: 0 }]).errors.join()).toContain('weeks')
    expect(fx(g, [{ kind: 'curtain_gig', weeks: 13 }]).errors.join()).toContain('weeks')
    expect(fx(g, [{ kind: 'curtain_gig', nothing: 1 }]).errors.join()).toContain('nothing')
  })

  it('curtain_gig：AI 與玩家要的簽不了；落幕等著選路的那一筆（fall）簽了就算選過了：拿掉，之後不再收設備費與違約金', async () => {
    const g = setup()
    expect(fx(g, [{ kind: 'curtain_gig' }], 'ai').errors.join()).toBeTruthy()
    expect(fx(g, [{ kind: 'curtain_gig' }], 'player').errors.join()).toBeTruthy()
    const f = await fallen()
    expect(cur(f).fall).toBeTruthy()
    apply(f, [{ kind: 'curtain_gig' }])
    expect(cur(f).fall).toBeFalsy()
    expect(cur(f).gig).toBeTruthy()
    expect(fallView(f.k, f.state)).toBeNull()
  })

  it('curtain_lead 只給一條線頭（旗標 curtain_lead:<贊助人>）；curtain_patron 給名片：線頭加親密度 +10（沒寫 affinity），有人註冊 affinity 才加', () => {
    const g = setup()
    apply(g, [{ kind: 'curtain_lead', patron: 'npc_vip' }])
    expect(flag(g, 'curtain_lead:npc_vip')).toBe(true)
    // 沒有人註冊 affinity：名片只給線頭
    const res = apply(g, [{ kind: 'curtain_patron', npc: 'npc_vip2' }])
    expect(flag(g, 'curtain_lead:npc_vip2')).toBe(true)
    expect(res.lines.join('')).toContain('好感 +10')
    // 有 affinity：親密度也加
    const calls: Rec[] = []
    const withAffinity = makeGame({
      seed: 5, features: [characterFeature, lewdFeature, DISTRICT_KIND, curtainFeature, {
        id: 'aff_stub', install: (k) => k.effects.register<{ kind: string; key: string; amount: number }>({
          kind: 'affinity', owner: 'aff_stub', ai: false, validate: () => [],
          toChanges: (e) => { calls.push({ ...e }); return [{ op: 'flag', key: `aff:${e.key}`, value: e.amount }] }, describe: () => '親密度',
        }),
      }], content: [{ id: 'bare', content: {} } as unknown as ContentPack],
    }).game
    const h = withAffinity as unknown as G
    apply(h, [{ kind: 'curtain_patron', npc: 'npc_vip', affinity: 15 }])
    expect(calls).toEqual([{ kind: 'affinity', key: 'npc_vip', amount: 15 }])
    expect(flag(h, 'aff:npc_vip')).toBe(15)
    expect(flag(h, 'curtain_lead:npc_vip')).toBe(true)
    apply(h, [{ kind: 'curtain_patron', npc: 'npc_vip3' }])
    expect(calls.at(-1)).toEqual({ kind: 'affinity', key: 'npc_vip3', amount: 10 })
  })

  it('格式：curtain_patron 要有 npc、affinity 是 1～30 的整數；curtain_lead 要有 patron；都不收別的欄位；AI 要不到', () => {
    const g = setup()
    expect(fx(g, [{ kind: 'curtain_patron' }]).errors.join()).toContain('npc')
    expect(fx(g, [{ kind: 'curtain_patron', npc: 'x', affinity: 0 }]).errors.join()).toContain('affinity')
    expect(fx(g, [{ kind: 'curtain_patron', npc: 'x', affinity: 31 }]).errors.join()).toContain('affinity')
    expect(fx(g, [{ kind: 'curtain_patron', npc: 'x', more: 1 }]).errors.join()).toContain('more')
    expect(fx(g, [{ kind: 'curtain_lead' }]).errors.join()).toContain('patron')
    expect(fx(g, [{ kind: 'curtain_lead', patron: 'x', more: 1 }]).errors.join()).toContain('more')
    expect(fx(g, [{ kind: 'curtain_patron', npc: 'x' }], 'ai').errors.join()).toBeTruthy()
    expect(fx(g, [{ kind: 'curtain_lead', patron: 'x' }], 'ai').errors.join()).toBeTruthy()
  })
})
