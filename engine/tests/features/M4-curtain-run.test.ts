// 驗收測試：dev/work/M4-curtain-run.md（cpp-feature）。features/curtain 的一趟：四幕的生成、場熱、每場遭遇擲文化、點單、賞箱、近道、條文、化妝室、結算、加演。
// 規格：CYBERSPACE 8.7 節、8.8 節（一趟的結構、和 8.1 節不一樣的地方、獎品表、敵人的文化開頭三條、獎勵）；8.2 節延長賽；dev/adr/0019 第十二節與 P57、P58。
// 內容是測試自帶的最小假資料：三個夜（兩種有敵人的文化、一種沒有敵人資料的）、各文化的雜兵／精英／首領、點單表（每個測試自己寫要的那一列）、賞箱表與獎品表；不讀 engine/data。
// netrun、enemies、scene、deck、lewd、character 用真的；戰鬥用 TEST_NET_COMBAT 加一把很強的攻擊構裝（一場一回合就結束）。
// 骰面：檢定與擲表的骰面由狀態的亂數導出，要某一種結果的測試掃種子（先在乾淨的一局上看骰面，再用找到的種子正式做）。
// 時間：測試從第 8 天 20:00 開始（第 7 天 06:00 是週一，所以是第 1 週的週二晚上）。
// 走完整趟的測試（結算、加演）有的直接把 netrun 的目標記成達成來模擬「走完終幕」，有一個真的一幕一幕打過去。

import { describe, expect, it, vi } from 'vitest'
import type { BattleState, Change, ContentPack, Feature, Report } from '../../src'
import { ActionBlocked, Sheet, deriveRng, gridHere, meterOf } from '../../src'
import { characterFeature } from '../../src/features/character'
import { deckFeature } from '../../src/features/deck'
import { enemiesFeature } from '../../src/features/enemies'
import { lewdFeature } from '../../src/features/lewd'
import { logout as netrunLogout, netExt, netrunFeature, readRun, useNode } from '../../src/features/netrun'
import { sceneAct, sceneFeature, sceneRawOf } from '../../src/features/scene'
import {
  CURTAIN_DEFAULT_RULES, CURTAIN_FLAG_SPONSOR, CURTAIN_HEAT, CURTAIN_STUBS, CURTAIN_USE_ACTION, cultureFor, curtainFeature, curtainOf, curtainRuleProblems, curtainRules, curtainTableProblems, curtainView,
  encoreBlocks, encoreDraft, enterDraft, featureOf, highlightHeat, highlightsOf, orderChoices, restDraft, sceneHeat, tipsRatio, useCurtain,
} from '../../src/features/curtain'
import { onBattleEnd } from '../../src/features/curtain/battle'
import { finishedByMind } from '../../src/features/curtain/orders'
import { TEST_NET_COMBAT, makeActor, makeGame, netWeapon, playOut } from '../../src/testkit'

type Rec = Record<string, any>

// 走完一整趟簾後館要打好幾場真的內海戰鬥；全套一起跑、機器忙的時候會慢好幾倍，預設的十秒不夠
vi.setConfig({ testTimeout: 60_000 })

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const T0 = { day: 8, hour: 20, minute: 0 }

const SKILLS = [['perform', 'charm'], ['stealth', 'reflex'], ['investigate', 'intellect'], ['firearms', 'reflex'], ['interface', 'intellect']].map(([id, attr]) => ({ id, name: id, attr, desc: `${id}。` }))
const TAGS = [{ id: 't_cos', name: '角色扮演', axis: 'costume' }, { id: 't_flow', name: '性別流動', axis: 'body' }, { id: 't_dom', name: '支配', axis: 'relation' }]
const NIGHTS: Rec[] = [
  { id: 'n_a', name: 'A之夜', faction: 'f_a', tags: ['t_cos'], culture: 'ca', prize: 'it_theme', style: 't_cos' },
  { id: 'n_b', name: 'B之夜', faction: 'f_b', tags: ['t_flow'], culture: 'cb', prize: 'it_theme' },
  { id: 'n_c', name: 'C之夜（沒有敵人資料的文化）', faction: 'f_a', tags: ['t_dom'], culture: 'cc' },
]
const TASTE = ['t_cos', 't_flow', 't_dom']

const program = (id: string, rank: string, culture: string, o: Rec = {}): Rec => ({
  id, name: `${culture}的${rank}`, desc: '簾後館的演出者。', faction: 'none', rank, grades: [1, 5], kind: 'program', culture,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...o,
})
const ENEMIES: Rec[] = ['ca', 'cb'].flatMap((c) => ['minion', 'elite', 'boss'].map((r) => program(`${c}_${r}`, r, c)))
const deckEntry = (id: string, o: Rec = {}): Rec => ({ id, name: id, desc: `${id}。`, grade: 2, slots: 3, firewall: 10, legal: 'free', ...o })
const item = (id: string, name: string): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 0, legal: 'free' })
const WEAPON_CLASSES = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const ROLES = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const POSITIONS = [{
  id: 'pos_side', name: '並坐', people: 2, roles: ROLES, mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
  links: [{ from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }],
}]
const SKINS = [{ id: 'sk_a', name: 'A風的演出服', style: { tag: 't_cos', value: 3 }, exposure: 1, cut: 'neutral', adult: false }]

/** 點單表：每一列是 { weight, name, order }。 */
const only = (kind: string, o: Rec = {}): Rec => ({ id: 'tb_order', kind: 'order', rows: [{ weight: 1, name: `點單${kind}`, order: kind, ...o }] })
const orders = (...rows: Rec[]): Rec => ({ id: 'tb_order', kind: 'order', rows })
const CHEST = { id: 'tb_chest', kind: 'chest', rows: [{ weight: 1, name: '票根箱', stubs: [3, 8] }] }
const PRIZE = { id: 'tb_prize', kind: 'prize', rows: [{ weight: 1, name: '正式版構裝', give: [{ kind: 'item', id: 'it_prize', qty: 1 }] }] }
/** 場熱的亮點不算（要驗別的場熱加減時關掉，免得真的打一場多出來的亮點干擾數字）。 */
const QUIET = { heat: { highlight: 0 } }
const dcRule = (n: number): Rec => ({ region: { dc: [n, n, n, n, n] } })

let WEAPON_TYPE = 'neural'

interface Opts {
  seed?: number
  /** 席次：預設散座 */
  tier?: 'floor' | 'box' | 'vip'
  companions?: number
  cash?: number
  rule?: Rec
  night?: string
  tables?: Rec[]
  features?: Feature[]
  content?: Rec
  /** false：沒有強武器，戰鬥不會自己結束 */
  weapon?: boolean
  contentOff?: string[]
  /** 加一個回答 director.cast 的替身（給合演的對象） */
  cast?: boolean
  /** 全隊穿著 t_cos 風格 3 的 SKIN */
  skin?: boolean
  taste?: string[]
  /** 不裝 features/deck、用甲板替身（沒有人註冊 skin_style 條件） */
  noSkinCondition?: boolean
  /** 武器的傷害類型 */
  weaponType?: string
}
type G = ReturnType<typeof setup>

const pack = (o: Opts = {}): ContentPack => ({
  id: 'curtain_run_test',
  content: {
    skill: SKILLS, tendency_tag: TAGS, weapon_class: WEAPON_CLASSES, position: POSITIONS, ...(o.noSkinCondition ? {} : { skin: SKINS }),
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'f_a', name: '甲', short: '甲', class: 'corp' }, { id: 'f_b', name: '乙', short: '乙', class: 'corp' }],
    enemy: ENEMIES, ...(o.noSkinCondition ? {} : { deck: [deckEntry('dk_own')] }), item: [item('it_prize', '正式版構裝'), item('it_theme', '主題獎品'), item('it_potion', '回復腳本')],
    curtain_night: NIGHTS,
    curtain_table: o.tables ?? [only('line'), CHEST, PRIZE],
    curtain_rule: [{ id: 'default', ...(o.rule ?? {}) }],
    ...o.content,
  } as never,
})

/** 內海的武器構裝（很強，讓戰鬥一回合就結束）與一個換檔的行動（守規矩的點單看得到）。 */
const COMBAT: Feature = {
  id: 'curtain_test_combat',
  install(k) {
    k.battle.loadout('curtain_test_combat', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(40, 14, { type: WEAPON_TYPE as never })] } : undefined))
    k.battle.action({
      id: 'test.curtain.shift', owner: 'curtain_test_combat', name: '換檔', desc: '換同步檔位。', group: 'system', icon: 'shift', modes: ['net'], target: 'none', order: 9,
      cost: () => ({ ap: 1 }),
      run: (run, u) => void run.say(`${u.name} 換到深檔。`, 'shift', { unit: u.id, from: 'standard', to: 'deep' }, u),
    })
  },
}

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

/** 不裝 features/deck 的局：甲板等級由這個替身給（沒有人註冊 skin_style 條件）。 */
const DECK_STUB: Feature = {
  id: 'curtain_test_deck',
  install(k) {
    k.stats.defineStat({ id: 'deck_grade', owner: 'curtain_test_deck', name: '甲板等級', base: () => 2 })
  },
}

function setup(o: Opts = {}) {
  WEAPON_TYPE = o.weaponType ?? 'neural'
  const ext = { bridge: { ...BRIDGE }, deck: { uid: 'D1', slots: [], scripts: [], ...(o.skin ? { skin: 'sk_a' } : {}) } }
  const pc = { attrs: { intellect: 14, body: 12, resolve: 14, reflex: 14, charm: 16 }, skills: { perform: 4, stealth: 3, investigate: 2, firearms: 3 }, ext }
  const actors = Array.from({ length: o.companions ?? 1 }, (_, i) => makeActor({ id: `c${i + 1}`, name: `同伴${i + 1}`, role: 'companion', gender: 'female', attrs: { charm: 10, reflex: 12 }, ext }))
  const base = [characterFeature, lewdFeature, enemiesFeature, o.noSkinCondition ? DECK_STUB : deckFeature, netrunFeature, sceneFeature, TEST_NET_COMBAT]
  const features = o.features ?? [...base, ...(o.weapon === false ? [] : [COMBAT]), ...(o.cast ? [CAST] : []), curtainFeature]
  const { game } = makeGame({
    seed: o.seed ?? 5, features, content: [pack(o)], pc: pc as never, actors,
    patch: {
      time: T0, money: { cred: 0, cash: o.cash ?? 20000 }, inventory: [...(o.noSkinCondition ? [] : [{ id: 'dk_own', qty: 1, data: { uid: 'D1' } }]), ...(o.skin ? [{ id: 'sk_a', qty: 1 }] : [])],
      rules: o.contentOff ? ({ contentOff: o.contentOff } as never) : undefined,
    } as never,
  })
  // 會員：直接記進狀態（面談與會費是 M4-curtain-entry 的事）
  const c = curtainOf(game.state)
  commit(game, [{ op: 'ext', key: 'curtain', value: { ...c, member: { tier: o.tier ?? 'floor', since: 0, paid_until: 10 ** 9, clears: 0 }, taste: o.taste ?? TASTE } as never }], 'curtain.test_member')
  return game
}

const commit = (g: Pick<G, 'commit'>, changes: Change[], action = 'netrun.test') => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const cur = (g: G) => curtainOf(g.state)
const run = (g: G) => cur(g).run!
const nrun = (g: G) => readRun(g.state)!
const net = (g: G) => netExt(g.state, nrun(g).map)!
const heat = (g: G) => meterOf(g.k, g.state, CURTAIN_HEAT, nrun(g).map)
const setHeat = (g: G, v: number) => commit(g, [{ op: 'meter', kind: CURTAIN_HEAT, key: nrun(g).map, set: v }])
const stubs = (g: G) => g.state.counters[CURTAIN_STUBS] ?? 0
const cash = (g: G) => g.state.money.cash
const sheetDefs = (g: G) => g.state.maps.instances[nrun(g).map]!.gen!.map.sheets
const sheetDef = (g: G, sheet?: string) => sheetDefs(g).find((s) => s.id === (sheet ?? g.state.maps.at!.sheet))!
const marks = (g: G, mark: string, sheet?: string) => (sheetDef(g, sheet).cells ?? []).filter((m) => m.mark === mark)
const party = (n: number): string[] => ['pc', ...Array.from({ length: n - 1 }, (_, i) => `c${i + 1}`)]
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const reportsOf = (g: G, action: string): Report[] => g.state.reports.filter((r) => r.action === action)
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

/** 報名並開一趟（真的 netrun）。 */
function entered(o: Opts = {}, enter: Rec = {}): G {
  const g = setup(o)
  g.commit(enterDraft(g.k, g.state, { party: party((o.companions ?? 1) + 1), night: o.night ?? 'n_a', tier: o.tier, seed: 11, ...enter }))
  return g
}

// ---- 走格子 ----

const key = (p: [number, number]) => `${p[0]},${p[1]}`
const sheetOf = (g: G): Sheet => gridHere(g.k, g.state)!.sheet
const teleport = (g: G, p: [number, number], sheet?: string): void => void commit(g, [{ op: 'map.at', to: { map: nrun(g).map, sheet: sheet ?? g.state.maps.at!.sheet, x: p[0], y: p[1] } }])
/** 鄰格：先找走得上去的；沒有就取不是牆的第一個（測試直接放過去）。 */
function neighbourOf(g: G, p: [number, number]): [number, number] {
  const sheet = sheetOf(g)
  const around = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [p[0] + dx, p[1] + dy] as [number, number]).filter(([x, y]) => sheet.inBounds(x, y))
  const pick = around.find(([x, y]) => sheet.walkable(x, y)) ?? around.find(([x, y]) => sheet.kindAt(x, y) !== 'wall')
  if (!pick) throw new Error(`${key(p)} 旁邊沒有可以站的格子`)
  return pick
}
const standNear = (g: G, p: [number, number]): void => teleport(g, neighbourOf(g, p))
const standOn = (g: G, id: string): void => teleport(g, sheetOf(g).marker(id)!.at)
const markerBy = (g: G, mark: string, i = 0) => marks(g, mark)[i]!
/** 這一層守閘門的那一場、不守閘門的那一場（ext.net.foes 的 gate）。 */
const guardId = (g: G, sheet = g.state.maps.at!.sheet): string => Object.entries(net(g).foes[sheet]!).find(([, f]) => f.gate)![0]
const plainId = (g: G, sheet = g.state.maps.at!.sheet): string => Object.entries(net(g).foes[sheet]!).find(([, f]) => !f.gate)![0]
/** 人放到第 n 幕（從 0 起算）的入口。 */
const toLayer = (g: G, n: number): void => teleport(g, marks(g, 'E', `l${n + 1}`)[0]!.at, `l${n + 1}`)

/** 站在遭遇節點旁邊開戰（不打）。 */
function startFight(g: G, foeId: string): void {
  standNear(g, sheetOf(g).marker(foeId)!.at)
  g.commit(useCurtain(g.k, g.state, 'fight', foeId))
}
/** 打到分出結果、結算；回傳結果。 */
async function finish(g: G): Promise<string> {
  const out = playOut(g, 300).outcome
  await g.finishBattle()
  return out
}
/** 站在遭遇節點旁邊開戰，打完（我方的強武器一回合結束）。 */
async function fight(g: G, foeId: string): Promise<string> {
  startFight(g, foeId)
  return finish(g)
}
/** 打完這一層、走到閘門、往下一層（最後一層是通過出口）。 */
async function clearLayer(g: G): Promise<void> {
  for (const foe of marks(g, 'f')) {
    if (sheetOf(g).kindAt(foe.at[0], foe.at[1]) !== 'net_foe') continue
    expect(await fight(g, foe.id)).toBe('win')
  }
  teleport(g, markerBy(g, 'g').at)
  g.commit(useNode(g.k, g.state, nrun(g).layer === nrun(g).layers.length - 1 ? 'pass' : 'descend'))
}
/** 不打這一層的遭遇，直接站上閘門往下一層（用 netrun 的 descend；守閘門的那一場記成處理過）。 */
function descendHack(g: G): void {
  const sheet = g.state.maps.at!.sheet
  const next = clone(net(g))
  for (const f of Object.values(next.foes[sheet]!)) f.done = true
  commit(g, [{ op: 'map.ext', map: nrun(g).map, value: { ...g.state.maps.instances[nrun(g).map]!.ext, net: next } as never }])
  teleport(g, markerBy(g, 'g').at)
  g.commit(useNode(g.k, g.state, 'descend'))
}
/** 模擬走完終幕：把 netrun 的目標記成達成（下一份報告套用之後 netrun 以 done 收掉這一趟）。 */
function reachEnd(g: G, layer = nrun(g).layers.length - 1): void {
  commit(g, [{ op: 'ext', key: 'netrun', value: { ...nrun(g), layer, goal: { ...nrun(g).goal, done: true } } as never }])
}
const resultOf = (g: G) => reportsOf(g, 'curtain.result').at(-1)!.timeline[0]!.data as Rec
/** 到一個點單的節點、看一下點單（擲）。 */
function offer(g: G): string {
  const p = markerBy(g, 'p')
  standOn(g, p.id)
  g.commit(useCurtain(g.k, g.state, 'order'))
  return p.id
}
const decide = (g: G, accept: boolean, o: Rec = {}) => g.commit(useCurtain(g.k, g.state, accept ? 'order:accept' : 'order:refuse', undefined, o))
/** 掃種子：做出一局、看完點單，骰面符合要求的那一個（回傳那一局，已經站在點單的節點上、點單已經擲出）。 */
function seeded(want: (g: G) => boolean, o: Opts, enter: Rec = {}): G {
  for (let seed = 1; seed <= 200; seed++) {
    const g = entered({ ...o, seed }, enter)
    offer(g)
    if (want(g)) return g
  }
  throw new Error('找不到合適的種子')
}
const lineNatural = (g: G): number => deriveRng(g.state.rng, `curtain/${run(g).id}/line/0/${run(g).offer!.node}`).int(1, 20)

// ===================================================================================================================
// 一、規則與格式
// ===================================================================================================================

describe('規則表與格式（CYBERSPACE 8.8 節）', () => {
  it('場熱、打賞、加演、文化、條文、近道的數字照設計書', () => {
    const r = CURTAIN_DEFAULT_RULES
    expect(r.acts).toEqual(['序幕・迎賓廳', '第一幕・舞台', '第二幕・後台', '終幕・貴賓席'])
    expect(r.act_defs.map((a) => [a.turns, a.boss ?? null, a.shortcut === true, a.prize_room === true])).toEqual([[12, null, false, false], [15, 'headliner', false, false], [15, 'director', true, false], [12, 'host', false, true]])
    expect(r.act_defs.map((a) => a.orders)).toEqual([[1, 1], [1, 1], [1, 1], [0, 0]])
    expect(r.heat).toMatchObject({ highlight: 2, highlight_cap: 10, order_done: 8, order_refuse: -5, down: -10, over_per: 3, over_pen: -2, explore_per: 3, explore_pen: -1, rest: 5, book: 10, sponsor: 70, encore: 90 })
    expect(r.heat.scene).toEqual([{ min: 60, delta: 10 }, { min: 30, delta: 5 }, { min: 0, delta: -5 }])
    expect(r.tips).toEqual([0, 0.1, 0.2, 0.35, 0.5])
    expect([r.stub_value, r.culture_own, r.feature_bonus]).toEqual([20, 0.6, 1.2])
    expect(r.encore).toMatchObject({ grades: [1, 2], prize: [2, 4] })
    expect(r.clause).toEqual({ tips_cut: 0.2, stubs: 5 })
    expect(r.shortcut).toMatchObject({ deposit_cut: 0.1, heat: -5 })
    expect(r.order_stubs).toEqual([3, 8])
    expect(curtainRuleProblems(r as never)).toEqual([])
  })

  it('打賞的比例：20 以下 0、20～39 0.1、40～59 0.2、60～79 0.35、80 以上 0.5', () => {
    const r = CURTAIN_DEFAULT_RULES
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map((h) => tipsRatio(r, h))).toEqual([0, 0, 0.1, 0.1, 0.2, 0.2, 0.35, 0.35, 0.5, 0.5])
  })

  it('成人場景結算換場熱：好 +10、普通 +5、不好 −5（照契合）', () => {
    const r = CURTAIN_DEFAULT_RULES
    expect([100, 85, 60, 59, 30, 29, 0].map((fit) => sceneHeat(r, fit))).toEqual([10, 10, 10, 5, 5, -5, -5])
  })

  it('資料的 curtain_rule 蓋掉預設；acts 可以寫名字也可以寫整筆；壞的欄位忽略並一條一句', () => {
    const g = setup({ rule: { heat: { order_done: 12 }, tips: [0, 0.5, 0.5, 0.5, 0.9], culture_own: 0.5, acts: ['甲', { id: 'x', name: '乙', encounters: [1, 1], orders: [0, 0], chests: [0, 0], turns: 5 }], clause: { stubs: 9 } } })
    const r = curtainRules(g.k)
    expect(r.heat.order_done).toBe(12)
    expect(r.heat.order_refuse).toBe(-5)
    expect(r.tips).toEqual([0, 0.5, 0.5, 0.5, 0.9])
    expect(r.culture_own).toBe(0.5)
    expect(r.acts).toEqual(['甲', '乙'])
    expect(r.act_defs[1]).toMatchObject({ id: 'x', turns: 5, orders: [0, 0] })
    expect(r.act_defs[0]).toMatchObject({ name: '甲', turns: 12 })
    expect(r.clause).toEqual({ tips_cut: 0.2, stubs: 9 })
    expect(curtainRuleProblems({ tips: [1, 2] })).not.toEqual([])
    expect(curtainRuleProblems({ heat: { over_per: 0 } })).not.toEqual([])
    expect(curtainRuleProblems({ acts: [{ id: 'x' }] })).not.toEqual([])
    expect(curtainRuleProblems({ culture_own: 2 })).not.toEqual([])
    expect(curtainRuleProblems({ checks: { line: [] } })).not.toEqual([])
    expect(curtainRuleProblems({ tables: { order: '' } })).not.toEqual([])
    // 格式不對的規則載入時就擋下（overridable 的規則表，內容檢查）
    expect(() => setup({ rule: { culture_own: 2 } })).toThrow(/culture_own/)
    expect(() => setup({ rule: { tips: [1, 2] } })).toThrow(/tips/)
  })

  it('curtain_table 的格式：點單表的列要有 order、賞箱表的列要有給什麼；壞的一條一句', () => {
    expect(curtainTableProblems(only('line') as never)).toEqual([])
    expect(curtainTableProblems(CHEST as never)).toEqual([])
    expect(curtainTableProblems(PRIZE as never)).toEqual([])
    expect(curtainTableProblems({ kind: 'lootbox', rows: [] })).not.toEqual([])
    expect(curtainTableProblems({ kind: 'order', rows: [{ weight: 1, order: 'dance' }] })).not.toEqual([])
    expect(curtainTableProblems({ kind: 'chest', rows: [{ weight: 1 }] })).not.toEqual([])
    expect(curtainTableProblems({ kind: 'chest', rows: [{ weight: 0, stubs: 1 }] })).not.toEqual([])
    expect(curtainTableProblems({ kind: 'chest', rows: [{ weight: 1, stubs: [5, 3] }] })).not.toEqual([])
    expect(() => setup({ tables: [{ id: 'bad', kind: 'order', rows: [{ weight: 1, order: 'dance' }] }] })).toThrow()
  })

  it('表裡的效果沒有人登記：載入時就報（ready 檢查）', () => {
    expect(() => setup({ tables: [only('line'), { id: 'tb_chest', kind: 'chest', rows: [{ weight: 1, give: [{ kind: 'no_such_effect' }] }] }] })).toThrow(/no_such_effect/)
  })
})

// ===================================================================================================================
// 二、生成：四幕
// ===================================================================================================================

describe('生成：四幕（CYBERSPACE 8.8 節「一趟的結構」「和 8.1 節不一樣的地方」）', () => {
  it('報名之後 netrun 開了簾後館的地圖（四層），stage 記下地圖，場熱起算 30', () => {
    const g = entered()
    expect(nrun(g)).toMatchObject({ region: 'curtain', layers: ['l1', 'l2', 'l3', 'l4'], layer: 0, origin: { by: 'curtain' } })
    expect(run(g)).toMatchObject({ map: nrun(g).map, act: 0, tips_mult: 1 })
    expect(heat(g)).toBe(30)
    expect(reportsOf(g, 'curtain.stage')).toHaveLength(1)
    expect(g.state.maps.instances[nrun(g).map]!.gen!.map.kind).toBe('maze')
    expect(g.state.maps.instances[nrun(g).map]!.gen!.map.size).toEqual([9, 7])
  })

  it('任何種子生成的四幕都合格：每一幕的遭遇、點單（終幕是獎品室）、賞箱、近道、條文的數量在範圍裡，節點 7～9；散座的終幕沒有首領「主持」、包廂與貴賓席有（20 個種子 × 三個席次）', () => {
    const defs = CURTAIN_DEFAULT_RULES.act_defs
    for (const tier of ['floor', 'box', 'vip'] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const g = entered({ seed, tier }, { seed, tier })
        const sheets = sheetDefs(g)
        expect(sheets).toHaveLength(4)
        sheets.forEach((sheet, i) => {
          const cells = sheet.cells ?? []
          const n = (mark: string): number => cells.filter((m) => m.mark === mark).length
          const d = defs[i]!
          const label = `${tier}/${seed}/第${i + 1}幕`
          expect(n('f'), `${label} 遭遇`).toBeGreaterThanOrEqual(d.encounters[0])
          expect(n('f'), `${label} 遭遇`).toBeLessThanOrEqual(d.encounters[1])
          // 點單在有點單的幕；終幕的 p 是獎品室
          expect(n('p'), `${label} 點單`).toBe(1)
          expect(d.orders[1] > 0 || d.prize_room === true).toBe(true)
          expect(n('a'), `${label} 賞箱`).toBeGreaterThanOrEqual(d.chests[0])
          expect(n('a'), `${label} 賞箱`).toBeLessThanOrEqual(d.chests[1])
          expect(n('b'), `${label} 近道的位置`).toBe(1)
          expect(n('c'), `${label} 條文`).toBeLessThanOrEqual(1)
          expect(n('r'), `${label} 休息點`).toBe(0)
          expect(n('E')).toBe(1)
          expect(n('g')).toBe(1)
          const markers = n('E') + n('g') + n('f') + n('p') + n('a') + n('b') + n('c')
          expect(markers, `${label} 節點`).toBeGreaterThanOrEqual(7)
          expect(markers, `${label} 節點`).toBeLessThanOrEqual(9)
        })
        // 守閘門的那一場：最後一層散座是精英的組合（沒有首領），其餘席次是首領戰
        const ranks = (sheet: string): string[] => Object.values(net(g).foes[sheet]!).find((f) => f.gate)!.foes.map((f) => String(f.rank))
        if (tier === 'floor') expect(ranks('l4')).toEqual(['elite', 'elite', 'minion'])
        else expect(ranks('l4')).toEqual(['boss', 'minion', 'minion', 'minion'])
        expect(ranks('l2')).toEqual(['elite', 'elite', 'minion'])
        expect(net(g).patrols).toEqual([])
        for (const sheet of Object.keys(net(g).graph)) expect(net(g).traps[sheet]).toEqual([])
      }
    }
  })

  it('這一區 netrun 收得下：沒有追蹤度、熔斷（safe）、自己處理的標記（handled）', () => {
    const g = entered()
    expect((g.state.maps.instances[nrun(g).map]!.ext!.net as Rec).region).toBe('curtain')
    expect(nrun(g).setup.region).toMatchObject({ id: 'curtain', pressure: 'none', safe: true, handled: ['a', 'b', 'c', 'f', 'p'], carve: [20, 28] })
    expect(meterOf(g.k, g.state, 'trace', nrun(g).map)).toBe(0)
  })
})

// ===================================================================================================================
// 三、場熱
// ===================================================================================================================

describe('場熱（CYBERSPACE 8.8 節「場熱」；沒有直播，P57）', () => {
  it('起始 30；是量表 heat（AI 與玩家要的效果一律不收）', () => {
    const g = entered()
    expect(heat(g)).toBe(30)
    const def = g.k.meters.get(CURTAIN_HEAT)!
    expect(def).toMatchObject({ min: 0, max: 100, start: 30, keyed: 'map' })
    expect(def.accepts!(g.state, nrun(g).map)).toMatch(/場熱/)
  })

  const withReports = (g: G, reports: unknown[]) => ({ ...g.state, reports }) as never
  const beat = (tag: string, data: Rec) => ({ layer: 'net', text: tag, tag, data })
  const battle = (g: G, steps: string[], units: Rec = {}): Pick<BattleState, 'round' | 'origin' | 'units' | 'steps' | 'field'> => ({
    round: 3, steps, field: { safe: true },
    origin: { escapable: true, place: '測試', ext: { net: { map: nrun(g).map }, curtain: { run: run(g).id, act: 0, guard: false, last: false } } } as never,
    units: { a1: { side: 'ally' }, a2: { side: 'ally' }, f1: { side: 'foe' }, f2: { side: 'foe' }, f3: { side: 'foe' }, ...units } as never,
  })
  const crits = (n: number) => Array.from({ length: n }, () => beat('crit', { attacker: 'a1', target: 'f1' }))

  it('亮點：我方的要害、把對手打到過載、一回合打倒兩個各算一個；對方的要害不算；一回合打倒一個不算', () => {
    const g = entered()
    const reports = [{ id: 'r1', timeline: [
      beat('round', { round: 1 }), beat('crit', { attacker: 'a1', target: 'f1' }), beat('crit', { attacker: 'f1', target: 'a1' }),
      beat('overload', { target: 'f2' }), beat('overload', { target: 'a2' }), beat('down', { target: 'f1', side: 'foe' }),
      beat('round', { round: 2 }), beat('down', { target: 'f2', side: 'foe' }), beat('down', { target: 'f3', side: 'foe' }),
    ] }] as unknown as Report[]
    const h = highlightsOf(reports, battle(g, ['r1']))
    expect(h).toEqual({ crits: 1, overloads: 1, doubles: 1, total: 3 })
    expect(highlightHeat(CURTAIN_DEFAULT_RULES, h)).toBe(6)
  })

  it('一場戰鬥有三次要害只 +6、十次也只 +10（每場上限 +10）', () => {
    const g = entered()
    const run3 = onBattleEnd(g.k, withReports(g, [{ id: 'r1', timeline: crits(3) }]), battle(g, ['r1']), 'win')!
    expect(run3.changes.filter((c) => c.op === 'meter')).toEqual([{ op: 'meter', kind: 'heat', key: nrun(g).map, delta: 6 }])
    const run10 = onBattleEnd(g.k, withReports(g, [{ id: 'r1', timeline: crits(10) }]), battle(g, ['r1']), 'win')!
    expect(run10.changes.filter((c) => c.op === 'meter')).toEqual([{ op: 'meter', kind: 'heat', key: nrun(g).map, delta: 10 }])
  })

  it('倒下的人每個 −10（也算進這一趟倒下的人次）；亮點與倒下同時有就各算各的', () => {
    const g = entered()
    const lost = onBattleEnd(g.k, withReports(g, []), battle(g, [], { a1: { side: 'ally', out: 'down' }, a2: { side: 'ally', out: 'burnout' } }), 'lose')!
    expect(lost.changes.filter((c) => c.op === 'meter')).toEqual([{ op: 'meter', kind: 'heat', key: nrun(g).map, delta: -20 }])
    expect(lost.changes.find((c) => c.op === 'curtain.patch')).toMatchObject({ run: { inc: { downed: 2 } } })
    const both = onBattleEnd(g.k, withReports(g, [{ id: 'r1', timeline: crits(2) }]), battle(g, ['r1'], { a2: { side: 'ally', out: 'down' } }), 'win')!
    expect(both.changes.filter((c) => c.op === 'meter').map((c) => c.delta)).toEqual([4, -10])
  })

  it('真的打一場：這一幕的回合數記進計數器，場熱照亮點加、最多 +10', async () => {
    const g = entered()
    expect(await fight(g, guardId(g))).toBe('win')
    const gain = heat(g) - 30
    expect(gain).toBeGreaterThan(0)
    expect(gain).toBeLessThanOrEqual(10)
    expect(g.state.counters[`curtain:${run(g).id}:r0`]).toBeGreaterThanOrEqual(1)
    expect(g.battle).toBeNull()
  })

  it('每走 3 個探索回合場熱 −1：netrun.round 掛點（run.round 是 3 的倍數才扣）', () => {
    const g = entered()
    const hook = (round: number) => g.k.hooks.run('netrun.round', { state: g.state, run: { ...clone(nrun(g)), round } as never }).flatMap((h) => (h.result as Change[] | undefined) ?? [])
    expect(hook(1).filter((c) => c.op === 'meter')).toEqual([])
    expect(hook(2).filter((c) => c.op === 'meter')).toEqual([])
    expect(hook(3).filter((c) => c.op === 'meter')).toEqual([{ op: 'meter', kind: 'heat', key: nrun(g).map, delta: -1 }])
    expect(hook(6).filter((c) => c.op === 'meter')).toHaveLength(1)
    expect(hook(3).filter((c) => c.op === 'counter').map((c) => c.key)).toEqual([`curtain:${run(g).id}:r0`, `curtain:${run(g).id}:x0`])
  })

  it('超過標準回合的罰在離開那一幕時算（序幕標準 12 回合，多 6 回合每 3 回合 −2 共 −4）', () => {
    const g = entered({ rule: QUIET })
    commit(g, [{ op: 'counter', key: `curtain:${run(g).id}:r0`, delta: 18 }])
    const before = heat(g)
    descendHack(g)
    const rest = reportsOf(g, 'curtain.rest')
    expect(rest).toHaveLength(1)
    expect(rest[0]!.outcome.summary).toMatch(/超過標準回合 6 回合/)
    expect(heat(g)).toBe(before + 5 - 4)
    expect(run(g)).toMatchObject({ act: 1, over_turns: 6 })
  })

  it('場熱到 0：記成提早落幕（cut）；到過 70 贊助人現身、立旗標 curtain_sponsor、只立一次；到過 90 可以加演', () => {
    const g = entered()
    setHeat(g, 69)
    expect(run(g).sponsor).toBeUndefined()
    expect(g.state.flags[CURTAIN_FLAG_SPONSOR]).toBeUndefined()
    setHeat(g, 70)
    expect(run(g).sponsor).toBe(true)
    expect(g.state.flags[CURTAIN_FLAG_SPONSOR]).toBe(true)
    const count = () => reportsOf(g, 'curtain.stage').filter((r) => /贊助人現身/.test(r.outcome.summary)).length
    expect(count()).toBe(1)
    setHeat(g, 50)
    setHeat(g, 80)
    expect(count()).toBe(1)
    expect(run(g).encore_open).toBeUndefined()
    setHeat(g, 90)
    expect(run(g).encore_open).toBe(true)
    expect(curtainView(g.k, g.state)).toMatchObject({ sponsor: true, encore_open: true, cut: false })
    setHeat(g, 0)
    expect(run(g).cut).toBe(true)
    expect(curtainView(g.k, g.state)!.cut).toBe(true)
  })
})

// ===================================================================================================================
// 四、每場遭遇擲文化（P58）
// ===================================================================================================================

describe('每場遭遇擲文化（CYBERSPACE 8.8 節「敵人的文化」；P58）', () => {
  it('把機率固定在 0.5 用這一夜的、0.9 用別的夜的（別的夜的文化平均分）；沒有別的文化就是這一夜的', () => {
    const g = entered()
    const own = { culture: 'ca' }
    expect(cultureFor(g.k, g.state, own, 0)).toBe('ca')
    expect(cultureFor(g.k, g.state, own, 0.5)).toBe('ca')
    expect(cultureFor(g.k, g.state, own, 0.599)).toBe('ca')
    // 別的文化：cb、cc（照夜的 id 排），0.6～1 平分
    expect(cultureFor(g.k, g.state, own, 0.6)).toBe('cb')
    expect(cultureFor(g.k, g.state, own, 0.9)).toBe('cc')
    expect(cultureFor(g.k, g.state, own, 0.8)).toBe('cc')
    expect(cultureFor(g.k, g.state, own, 0.79)).toBe('cb')
    expect(cultureFor(g.k, g.state, own, 0.999)).toBe('cc')
    const one = setup({ content: { curtain_night: [NIGHTS[0]] } })
    expect(cultureFor(one.k, one.state, own, 0.99)).toBe('ca')
  })

  it('別的夜的文化全被內容篩選擋掉時，不會擲到它（B 與 C 兩夜的傾向全關）', () => {
    const g = setup({ contentOff: ['t_flow', 't_dom'] })
    expect(cultureFor(g.k, g.state, { culture: 'ca' }, 0.99)).toBe('ca')
  })

  it('真的開戰：擲到這一夜的文化就是這一夜的敵人；擲到別的夜的就是別的文化的敵人（掃種子）；守閘門的那一場永遠是這一夜的', async () => {
    const rollOf = (g: G, foe: string): number => deriveRng(g.state.rng, `curtain/culture/${run(g).id}/${g.state.maps.at!.sheet}/${foe}`).next()
    const foesOf = (g: G): string[] => Object.values(g.battle!.units).filter((u) => u.side === 'foe').map((u) => String((u as Rec).enemy))
    const seen = new Set<string>()
    for (let seed = 1; seed <= 80 && seen.size < 2; seed++) {
      const g = entered({ seed }, { seed: 11 })
      const foe = plainId(g)
      const roll = rollOf(g, foe)
      // 0.6～0.8 是 cb、0.8 以上是 cc（沒有敵人資料，會退回這一夜的）
      const want = roll < 0.6 ? 'ca' : roll < 0.8 ? 'cb' : null
      if (!want || seen.has(want)) continue
      startFight(g, foe)
      const kinds = foesOf(g)
      expect(kinds.length).toBeGreaterThan(0)
      expect(kinds.every((id) => id.startsWith(`${want}_`)), `${seed} ${roll} ${kinds.join()}`).toBe(true)
      seen.add(want)
      await finish(g)
    }
    expect([...seen].sort()).toEqual(['ca', 'cb'])
    // 守閘門的那一場：每個種子都是這一夜（ca）的
    for (let seed = 1; seed <= 12; seed++) {
      const g = entered({ seed }, { seed: 11 })
      startFight(g, guardId(g))
      const kinds = foesOf(g)
      expect(kinds.length).toBeGreaterThan(0)
      expect(kinds.every((id) => id.startsWith('ca_'))).toBe(true)
    }
  })

  it('擲到的文化沒有敵人資料時用這一夜的（P58）：只有 ca 的敵人時擲到 cb 也是 ca；這一夜的也沒有就開不了戰並寫原因', () => {
    let tried = 0
    for (let seed = 1; seed <= 40 && tried < 3; seed++) {
      const g = entered({ seed, content: { enemy: ENEMIES.filter((e) => e.culture === 'ca') } }, { seed: 11 })
      const foe = plainId(g)
      const roll = deriveRng(g.state.rng, `curtain/culture/${run(g).id}/l1/${foe}`).next()
      if (roll < 0.6) continue
      startFight(g, foe)
      expect(Object.values(g.battle!.units).filter((u) => u.side === 'foe').every((u) => String((u as Rec).enemy).startsWith('ca_'))).toBe(true)
      tried++
    }
    expect(tried).toBeGreaterThan(0)
    const none = entered({ night: 'n_c' })
    standNear(none, sheetOf(none).marker(guardId(none))!.at)
    expect(reasonOf(() => useCurtain(none.k, none.state, 'fight', guardId(none)))).toMatch(/挑不到敵人：文化「cc」/)
  })

  it('開戰是熔斷的場地（safe）、戰鬥的來源記著這一趟、文化與節點；敵人的等級是席次的等級', () => {
    const g = entered()
    startFight(g, guardId(g))
    expect(g.battle!.field.safe).toBe(true)
    expect(g.battle!.mode).toBe('net')
    expect(g.battle!.origin.ext).toMatchObject({ curtain: { run: run(g).id, guard: true, last: false, act: 0, culture: 'ca' }, net: { map: nrun(g).map, sheet: 'l1' } })
    expect(g.battle!.grade).toBe(2)
  })
})

// ===================================================================================================================
// 五、點單
// ===================================================================================================================

describe('點單（CYBERSPACE 8.8 節「點單」；d6）', () => {
  it('走到節點才擲：站在點單的節點上才有「看點單」；擲出來之後接受或拒絕；orderChoices 列出選項與說明', () => {
    const g = entered({ tables: [only('rules'), CHEST, PRIZE], rule: QUIET })
    const p = markerBy(g, 'p')
    expect(reasonOf(() => useCurtain(g.k, g.state, 'order', p.id))).toMatch(/站在上面/)
    expect(orderChoices(g.k, g.state)).toBeNull()
    standOn(g, p.id)
    const r = g.commit(useCurtain(g.k, g.state, 'order'))[0]!
    expect(r.action).toBe(CURTAIN_USE_ACTION)
    expect(r.outcome.result).toBe('offer')
    expect(run(g).offer).toMatchObject({ node: p.id, act: 0, kind: 'rules' })
    const c = orderChoices(g.k, g.state)!
    expect(c.choices.map((x) => x.id)).toEqual(['order:accept', 'order:refuse'])
    expect(c.text).toMatch(/不能超頻、不能換檔/)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'order'))).toMatch(/已經擲過/)
    expect(curtainView(g.k, g.state)!.offer).toMatchObject({ kind: 'rules' })
    expect(curtainView(g.k, g.state)!.near.find((n) => n.marker.id === p.id)!.uses.map((u) => u.id)).toEqual(['order:accept', 'order:refuse'])
  })

  it('拒絕：場熱 −5、點單記成拒絕、節點處理過了', () => {
    const g = entered({ tables: [only('rules'), CHEST, PRIZE], rule: QUIET })
    const p = offer(g)
    decide(g, false)
    expect(heat(g)).toBe(25)
    expect(run(g).orders).toEqual([{ kind: 'rules', name: '點單rules', state: 'refused', act: 0, node: p }])
    expect(run(g).offer).toBeUndefined()
    expect(reasonOf(() => useCurtain(g.k, g.state, 'order'))).toMatch(/處理過了/)
  })

  it('一、換裝：全隊穿主題風格（t_cos 值 2 以上）打完下一場才算完成；沒穿對算沒完成（當拒絕）', async () => {
    const ok = entered({ tables: [only('skin'), CHEST, PRIZE], rule: QUIET, skin: true })
    offer(ok)
    expect(run(ok).offer).toMatchObject({ kind: 'skin', style: 't_cos' })
    decide(ok, true)
    expect(run(ok).pending).toMatchObject({ kind: 'skin', order: 0 })
    await fight(ok, plainId(ok))
    expect(run(ok).orders![0]).toMatchObject({ state: 'done' })
    expect(heat(ok)).toBe(38)
    expect(stubs(ok)).toBeGreaterThanOrEqual(3)
    expect(stubs(ok)).toBeLessThanOrEqual(8)
    expect(run(ok).pending).toBeUndefined()

    const bad = entered({ tables: [only('skin'), CHEST, PRIZE], rule: QUIET })
    offer(bad)
    decide(bad, true)
    startFight(bad, plainId(bad))
    expect(bad.battle!.origin.ext!.curtain).toMatchObject({ skin_ok: false })
    await finish(bad)
    expect(run(bad).orders![0]).toMatchObject({ state: 'refused' })
    expect(heat(bad)).toBe(25)
    expect(stubs(bad)).toBe(0)
  })

  it('沒有人註冊 skin_style 條件（沒有裝 features/deck）時，換裝的點單重擲', () => {
    const g = entered({ noSkinCondition: true, tables: [orders({ weight: 1, name: '換裝', order: 'skin' }, { weight: 1, name: '台詞', order: 'line' }), CHEST, PRIZE] })
    offer(g)
    expect(run(g).offer).toMatchObject({ kind: 'line' })
  })

  it('二、守規矩：下一場不能超頻、不能換檔；沒換檔算完成；換了檔算沒完成', async () => {
    const ok = entered({ tables: [only('rules'), CHEST, PRIZE], rule: QUIET })
    offer(ok)
    decide(ok, true)
    expect(await fight(ok, plainId(ok))).toBe('win')
    expect(run(ok).orders![0]!.state).toBe('done')
    expect(heat(ok)).toBe(38)

    const bad = entered({ tables: [only('rules'), CHEST, PRIZE], rule: QUIET })
    offer(bad)
    decide(bad, true)
    startFight(bad, plainId(bad))
    // 輪到我方時換檔
    for (let i = 0; i < 20 && bad.battle && !bad.battle.result; i++) {
      const u = bad.battle.units[bad.battle.order[bad.battle.turn]!]!
      if (u.side === 'ally') {
        expect(bad.battleAct({ action: 'test.curtain.shift' }).status).toBe('applied')
        break
      }
      bad.battleNext()
    }
    await finish(bad)
    expect(run(bad).orders![0]!.state).toBe('refused')
    expect(heat(bad)).toBe(25)
  })

  it('三、指定的收尾：最後一個敵人被神經或快感傷害打倒算完成；被別種傷害打倒算沒完成', async () => {
    for (const type of ['neural', 'pleasure']) {
      const ok = entered({ tables: [only('finish'), CHEST, PRIZE], rule: QUIET, weaponType: type })
      offer(ok)
      decide(ok, true)
      expect(await fight(ok, plainId(ok))).toBe('win')
      expect(ok.state.reports.some((r) => r.action === 'battle.end')).toBe(true)
      expect(run(ok).orders![0]!.state, type).toBe('done')
      expect(heat(ok)).toBe(38)
    }
    // 沒有敵人被打倒、或最後一擊是別種傷害：不算（內海的武器只有神經與快感，別種傷害用單元測）
    expect(finishedByMind({ field: { curtain_finish: 'neural' } })).toBe(true)
    expect(finishedByMind({ field: { curtain_finish: 'pleasure' } })).toBe(true)
    expect(finishedByMind({ field: { curtain_finish: 'thermal' } })).toBe(false)
    expect(finishedByMind({ field: { curtain_finish: 'physical' } })).toBe(false)
    expect(finishedByMind({ field: {} })).toBe(false)
  })

  it('四、合演：開一場 layer 是 net、nature 是 work、goal 是 please 的場景（對象是 director.cast 生成的演出者）；場景以合拍結束之後場熱 +10', () => {
    const g = entered({ tables: [only('duet'), CHEST, PRIZE], rule: QUIET, cast: true })
    offer(g)
    expect(run(g).offer).toMatchObject({ kind: 'duet' })
    decide(g, true)
    const s = sceneRawOf(g.state)!
    expect(s).toMatchObject({ layer: 'net', nature: 'work', goal: 'please' })
    expect(s.origin).toMatchObject({ by: 'curtain', ref: run(g).id })
    expect(g.k.activity.active(g.state).map((a) => a.kind).sort()).toEqual(['netrun', 'scene'])
    expect(run(g).orders![0]).toMatchObject({ kind: 'duet', state: 'open' })
    const partner = Object.keys(s.pairs)[0]!
    expect(partner).toMatch(/^tmp_/)
    // 契合 70：合拍（60 以上）
    s.pairs[partner]!.fit = 70
    g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))
    expect(sceneRawOf(g.state)).toBeNull()
    expect(heat(g)).toBe(40)
    expect(run(g).orders![0]!.state).toBe('done')
    expect(stubs(g)).toBeGreaterThanOrEqual(3)
  })

  it('合演：普通 +5、不合 −5（沒有票根）；同行的人可以當對象（with）', () => {
    for (const [fit, want, got] of [[40, 35, true], [10, 25, false]] as const) {
      const g = entered({ tables: [only('duet'), CHEST, PRIZE], rule: QUIET })
      offer(g)
      decide(g, true, { with: 'c1' })
      const s = sceneRawOf(g.state)!
      expect(Object.keys(s.pairs)).toEqual(['c1'])
      s.pairs.c1!.fit = fit
      g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))
      expect(heat(g)).toBe(want)
      expect(stubs(g) > 0).toBe(got)
    }
  })

  it('合演：沒有人回答 director.cast 也沒有同行的人時，這一格重擲；有同行的人就用同行的人；純舞台場次換成表演檢定', () => {
    const solo = entered({ companions: 0, tables: [orders({ weight: 1, name: '合演', order: 'duet' }, { weight: 1, name: '台詞', order: 'line' }), CHEST, PRIZE] })
    offer(solo)
    expect(run(solo).offer!.kind).toBe('line')
    const mate = entered({ tables: [only('duet'), CHEST, PRIZE] })
    offer(mate)
    expect(run(mate).offer!.kind).toBe('duet')
    expect(orderChoices(mate.k, mate.state)!.partners).toEqual([{ id: 'c1', name: '同伴1' }])
    const pure = entered({ taste: ['t_cos'], cast: true, tables: [only('duet'), CHEST, PRIZE] })
    expect(run(pure).pure_stage).toBe(true)
    offer(pure)
    expect(run(pure).offer).toMatchObject({ kind: 'line' })
    expect(run(pure).offer!.name).toMatch(/純舞台/)
    expect(sceneRawOf(pure.state)).toBeNull()
  })

  it('五、台詞：表演檢定成功 +8；大成功再 +4（合計 +12）；失敗當拒絕 −5', () => {
    const mk = (want: (n: number) => boolean) => seeded((g) => want(lineNatural(g)), { tables: [only('line'), CHEST, PRIZE], rule: { ...QUIET, ...dcRule(12) } })
    // 台詞的檢定：魅力 16（+3）、表演 4 → 加值 +7，DC 12；自然 15 以上是大成功（總和比 DC 高 10）
    const crit = mk((n) => n >= 15 && n < 20)
    decide(crit, true)
    expect(run(crit).orders![0]!.state).toBe('done')
    expect(heat(crit)).toBe(42)
    expect(stubs(crit)).toBeGreaterThanOrEqual(3)
    const win = mk((n) => n >= 6 && n <= 14)
    decide(win, true)
    expect(heat(win)).toBe(38)
    const fail = mk((n) => n >= 2 && n <= 4)
    decide(fail, true)
    expect(run(fail).orders![0]!.state).toBe('refused')
    expect(heat(fail)).toBe(25)
    const nat20 = mk((n) => n === 20)
    decide(nat20, true)
    expect(heat(nat20)).toBe(42)
  })

  it('六、返場：沒有直播，重擲（只剩別的列）', () => {
    for (let i = 0; i < 6; i++) {
      const h = entered({ seed: i + 1, tables: [orders({ weight: 5, name: '返場', order: 'encore' }, { weight: 1, name: '台詞', order: 'line' }), CHEST, PRIZE] })
      offer(h)
      expect(run(h).offer!.kind).toBe('line')
    }
  })

  it('每一種點單的 d6 表：六列各一種（返場重擲）', () => {
    const six = orders(
      { weight: 1, name: '換裝', order: 'skin' }, { weight: 1, name: '守規矩', order: 'rules' }, { weight: 1, name: '收尾', order: 'finish' },
      { weight: 1, name: '合演', order: 'duet' }, { weight: 1, name: '台詞', order: 'line' }, { weight: 1, name: '返場', order: 'encore' },
    )
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const g = entered({ seed, tables: [six, CHEST, PRIZE], cast: true })
      offer(g)
      seen.add(run(g).offer!.kind)
    }
    expect([...seen].sort()).toEqual(['duet', 'finish', 'line', 'rules', 'skin'])
  })

  it('賞箱的「觀眾的紙條」讓下一個完成的點單票根加倍', () => {
    const g = seeded((x) => lineNatural(x) >= 4, {
      rule: { ...QUIET, ...dcRule(1) },
      tables: [only('line'), { id: 'tb_chest', kind: 'chest', rows: [{ weight: 1, name: '觀眾的紙條', double: true }] }, PRIZE],
    })
    // 先開賞箱（賞箱不擲骰：不影響點單的骰面種子之外的東西；點單已經擲出）
    standOn(g, markerBy(g, 'a').id)
    g.commit(useCurtain(g.k, g.state, 'chest'))
    expect(run(g).double).toBe(true)
    standOn(g, markerBy(g, 'p').id)
    const base = deriveRng(g.state.rng, `curtain/${run(g).id}/order_stubs/0`).int(3, 8)
    decide(g, true)
    expect(run(g).orders![0]!.state).toBe('done')
    expect(stubs(g)).toBe(base * 2 + stubsFromChest(g))
    expect(run(g).double).toBeUndefined()
  })
})

/** 賞箱表只給紙條，沒有票根。 */
const stubsFromChest = (_g: G): number => 0

// ===================================================================================================================
// 六、賞箱、獎品室、條文、近道
// ===================================================================================================================

describe('賞箱、條文、近道、獎品室', () => {
  it('賞箱：站在上面開，擲賞箱表（票根 3～8 枚）；開過的不能再開；沒站在上面開不了', () => {
    const g = entered()
    const a = markerBy(g, 'a')
    expect(reasonOf(() => useCurtain(g.k, g.state, 'chest', a.id))).toMatch(/站在上面/)
    standOn(g, a.id)
    const r = g.commit(useCurtain(g.k, g.state, 'chest'))[0]!
    expect(r.outcome.result).toBe('chest')
    expect(stubs(g)).toBeGreaterThanOrEqual(3)
    expect(stubs(g)).toBeLessThanOrEqual(8)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'chest'))).toMatch(/已經打開過/)
  })

  it('賞箱：再擲一次獎品表（給東西）；沒有表時開不了', () => {
    const g = entered({ tables: [only('line'), { id: 'tb_chest', kind: 'chest', rows: [{ weight: 1, name: '神祕的箱子', prize: true }] }, PRIZE] })
    standOn(g, markerBy(g, 'a').id)
    g.commit(useCurtain(g.k, g.state, 'chest'))
    expect(g.state.inventory.find((s) => s.id === 'it_prize')!.qty).toBe(1)
    const none = entered({ tables: [only('line')] })
    standOn(none, markerBy(none, 'a').id)
    expect(reasonOf(() => useCurtain(none.k, none.state, 'chest'))).toMatch(/還沒有準備賞箱/)
  })

  it('獎品室（終幕的 p）：擲獎品表一次；其他幕的 p 是點單、沒有獎品室', () => {
    const g = entered()
    toLayer(g, 3)
    const p = markerBy(g, 'p')
    standOn(g, p.id)
    expect(curtainView(g.k, g.state)!.near.find((n) => n.marker.id === p.id)!.uses.map((u) => u.id)).toEqual(['prize'])
    g.commit(useCurtain(g.k, g.state, 'prize'))
    expect(g.state.inventory.find((s) => s.id === 'it_prize')!.qty).toBe(1)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'prize'))).toMatch(/領過了/)
    const first = entered()
    standOn(first, markerBy(first, 'p').id)
    expect(reasonOf(() => useCurtain(first.k, first.state, 'prize'))).toMatch(/這裡沒有「prize」/)
  })

  it('獎品表的主題獎品（theme 列）給這一夜的 prize', () => {
    const g = entered({ tables: [only('line'), CHEST, { id: 'tb_prize', kind: 'prize', rows: [{ weight: 1, name: '主題獎品', theme: true }] }] })
    toLayer(g, 3)
    standOn(g, markerBy(g, 'p').id)
    g.commit(useCurtain(g.k, g.state, 'prize'))
    expect(g.state.inventory.find((s) => s.id === 'it_theme')!.qty).toBe(1)
  })

  it('條文：意志或調查看穿了直接過（沒簽）；沒看穿就簽了，打賞少兩成（tips_mult 0.8）、票根 +5；也可以直接簽', () => {
    // DC 1：只有自然 1（大失敗）才會沒看穿；掃種子找看穿的那一局
    let read: G | null = null
    for (let seed = 1; seed <= 40 && !read; seed++) {
      const g = entered({ seed, rule: dcRule(1) })
      standOn(g, markerBy(g, 'c').id)
      const r = g.commit(useCurtain(g.k, g.state, 'clause'))[0]!
      if (r.outcome.result === 'clause_read') read = g
    }
    expect(read).toBeTruthy()
    expect(run(read!).tips_mult).toBe(1)
    expect(run(read!).signed).toBeUndefined()
    expect(stubs(read!)).toBe(0)
    // DC 40：只有自然 20 才看得穿；掃種子找沒看穿的那一局
    let signed: G | null = null
    for (let seed = 1; seed <= 40 && !signed; seed++) {
      const g = entered({ seed, rule: dcRule(40) })
      standOn(g, markerBy(g, 'c').id)
      const r = g.commit(useCurtain(g.k, g.state, 'clause'))[0]!
      if (r.outcome.result === 'clause_signed') signed = g
    }
    expect(signed).toBeTruthy()
    expect(run(signed!)).toMatchObject({ tips_mult: 0.8, signed: true })
    expect(stubs(signed!)).toBe(5)
    const direct = entered()
    standOn(direct, markerBy(direct, 'c').id)
    direct.commit(useCurtain(direct.k, direct.state, 'clause:sign'))
    expect(run(direct)).toMatchObject({ tips_mult: 0.8, signed: true })
    expect(stubs(direct)).toBe(5)
    expect(reasonOf(() => useCurtain(direct.k, direct.state, 'clause:sign'))).toMatch(/處理過了/)
  })

  it('近道（只有第二幕後台有）：過了跳過一場遭遇（那一格變地板、不是守閘門的）；失敗保證金扣一成、場熱 −5、不打架', () => {
    let win: G | null = null
    for (let seed = 1; seed <= 40 && !win; seed++) {
      const g = entered({ seed, rule: { ...QUIET, ...dcRule(1) } })
      toLayer(g, 2)
      standOn(g, markerBy(g, 'b').id)
      if (curtainView(g.k, g.state)!.near.find((n) => n.role === 'shortcut')!.uses[0]!.id !== 'shortcut') continue
      const skipped = plainId(g)
      const r = g.commit(useCurtain(g.k, g.state, 'shortcut'))[0]!
      if (r.outcome.result !== 'shortcut') continue
      expect(sheetOf(g).kindAt(...sheetOf(g).marker(skipped)!.at)).toBe('floor')
      expect(sheetOf(g).kindAt(...sheetOf(g).marker(guardId(g))!.at)).toBe('net_foe')
      expect(heat(g)).toBe(30)
      expect(run(g).docked).toBeUndefined()
      win = g
    }
    expect(win).toBeTruthy()
    let fail: G | null = null
    for (let seed = 1; seed <= 40 && !fail; seed++) {
      const g = entered({ seed, rule: { ...QUIET, ...dcRule(40) } })
      toLayer(g, 2)
      standOn(g, markerBy(g, 'b').id)
      const r = g.commit(useCurtain(g.k, g.state, 'shortcut'))[0]!
      if (r.outcome.result === 'shortcut_fail') fail = g
    }
    expect(fail).toBeTruthy()
    expect(run(fail!).docked).toBe(30)
    expect(heat(fail!)).toBe(25)
    expect(fail!.battle).toBeNull()
    expect(sheetOf(fail!).kindAt(...sheetOf(fail!).marker(plainId(fail!))!.at)).toBe('net_foe')
    expect(reasonOf(() => useCurtain(fail!.k, fail!.state, 'shortcut'))).toMatch(/走過了/)
  })

  it('近道：員工風格的 SKIN 偽裝檢定 +4；別的幕的近道位置什麼都沒有', () => {
    const g = entered({ skin: true, rule: { ...QUIET, ...dcRule(1), shortcut: { staff_style: 't_cos' } } })
    toLayer(g, 2)
    standOn(g, markerBy(g, 'b').id)
    const r = g.commit(useCurtain(g.k, g.state, 'shortcut'))[0]!
    const roll = r.timeline.find((b) => b.roll)!.roll!
    expect(roll.parts.find((p) => p.label === '員工的偽裝')!.value).toBe(4)
    const first = entered()
    standOn(first, markerBy(first, 'b').id)
    expect(reasonOf(() => useCurtain(first.k, first.state, 'shortcut'))).toMatch(/這裡沒有/)
  })
})

// ===================================================================================================================
// 七、化妝室與包場
// ===================================================================================================================

describe('化妝室（層與層之間）與包場', () => {
  it('往下一幕之後自動進化妝室：感載歸零、餘韻全消、場熱 +5；沒有贊助人時沒有包場的選項', () => {
    const g = entered({ rule: QUIET })
    commit(g, [{ op: 'actor.track', id: 'pc', track: 'load', delta: 9 }, { op: 'actor.track', id: 'c1', track: 'afterglow', delta: 2 }])
    expect(g.state.actors.pc!.load).toBe(9)
    descendHack(g)
    expect(g.state.maps.at!.sheet).toBe('l2')
    expect(reportsOf(g, 'curtain.rest')).toHaveLength(1)
    expect(g.state.actors.pc!.load).toBe(0)
    expect(g.state.actors.c1!.afterglow).toBe(0)
    expect(heat(g)).toBe(35)
    expect(run(g)).toMatchObject({ act: 1 })
    expect(run(g).room).toMatchObject({ act: 1, x: 0 })
    expect(curtainView(g.k, g.state)!.free).toEqual([])
    expect(reasonOf(() => restDraft(g.k, g.state, { book: true }))).toMatch(/沒有贊助人/)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'book'))).toMatch(/沒有贊助人/)
  })

  it('贊助人在場時可以選包場：花一個探索回合、票根 +10、場熱 +10、之後這一趟的打賞 −1 成；一幕一次；回合過了就沒有', () => {
    const g = entered({ rule: QUIET })
    descendHack(g)
    setHeat(g, 70)
    expect(run(g).sponsor).toBe(true)
    expect(curtainView(g.k, g.state)!.free).toEqual([{ id: 'book', name: '包場', block: null }])
    const r = g.commit(restDraft(g.k, g.state, { book: true }))[0]!
    expect(r.action).toBe(CURTAIN_USE_ACTION)
    expect(stubs(g)).toBe(10)
    expect(heat(g)).toBe(80)
    expect(run(g)).toMatchObject({ tips_mult: 0.9, booked: [1] })
    expect(run(g).room).toBeUndefined()
    expect(g.state.counters[`curtain:${run(g).id}:x1`]).toBe(1)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'book'))).toMatch(/剛進化妝室/)
    // 回合過了就關：另一個局，先過一個探索回合再選
    const h = entered({ rule: QUIET })
    descendHack(h)
    setHeat(h, 70)
    commit(h, [{ op: 'counter', key: `curtain:${run(h).id}:x1`, delta: 1 }])
    expect(reasonOf(() => useCurtain(h.k, h.state, 'book'))).toMatch(/剛進化妝室/)
  })
})

// ===================================================================================================================
// 八、結算
// ===================================================================================================================

describe('結算（CYBERSPACE 8.8 節「打賞」「打輸會怎樣」開頭）', () => {
  it('包廂、場熱 65、主打的夜：獎金 3,000 ＋ 打賞 3,000 × 0.35 × 1.2、保證金退回、clears +1、這一週的打賞累加', () => {
    const g = setup({ tier: 'box', rule: QUIET })
    const feature = featureOf(g.k, g.state)!.id
    g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: feature, seed: 11 }))
    expect(run(g)).toMatchObject({ tier: 'box', feature: true, deposit: 1000 })
    setHeat(g, 65)
    const before = cash(g)
    reachEnd(g)
    expect(cash(g) - before).toBe(3000 + 1260 + 1000)
    expect(resultOf(g)).toMatchObject({ outcome: 'done', heat: 65, prize: 3000, tips: 1260, tips_ratio: 0.35, refund: 1000 })
    expect(cur(g).member!.clears).toBe(1)
    expect(cur(g).week!.tips).toBe(1260)
    expect(cur(g).run).toBeUndefined()
    expect(nrun(g)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    expect(reportsOf(g, 'curtain.result')).toHaveLength(1)
    // 倒下的人不加沉溺（熔斷）、票根留著
    expect(g.state.actors.pc!.sink).toBe(0)
  })

  it('條文簽了之後打賞少兩成（900 × 0.35 × 0.8）', () => {
    const g = entered({ rule: QUIET })
    standOn(g, markerBy(g, 'c').id)
    g.commit(useCurtain(g.k, g.state, 'clause:sign'))
    expect(run(g).feature).toBe(false)
    setHeat(g, 65)
    reachEnd(g)
    expect(resultOf(g)).toMatchObject({ prize: 900, tips: 252, tips_ratio: 0.35, stubs: 5 })
  })

  it('近道失敗被扣的保證金從退回的錢裡少掉；場熱不到 20 沒有打賞', () => {
    const g = entered({ rule: QUIET })
    commit(g, [{ op: 'curtain.patch', run: { inc: { docked: 30 } } } as never])
    setHeat(g, 10)
    const before = cash(g)
    reachEnd(g)
    expect(resultOf(g)).toMatchObject({ prize: 900, tips: 0, refund: 270 })
    expect(cash(g) - before).toBe(900 + 270)
  })

  it('提早落幕（場熱到 0）：不算戰敗，保證金退回、票根留著、沒有破關獎金、沒有打賞、不算破關', () => {
    const g = entered({ rule: QUIET })
    standOn(g, markerBy(g, 'a').id)
    g.commit(useCurtain(g.k, g.state, 'chest'))
    const gained = stubs(g)
    setHeat(g, 0)
    expect(run(g).cut).toBe(true)
    // 觀眾散場後點單與賞箱都不能再做
    standOn(g, markerBy(g, 'p').id)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'order'))).toMatch(/散場/)
    const before = cash(g)
    g.commit(netrunLogout(g.k, g.state))
    expect(cash(g) - before).toBe(300)
    expect(resultOf(g)).toMatchObject({ early: true, prize: 0, tips: 0, refund: 300, stubs: gained })
    expect(cur(g).member!.clears).toBe(0)
    expect(stubs(g)).toBe(gained)
    expect(cur(g).run).toBeUndefined()
    expect(g.pendingDefeat).toBeNull()
  })

  it('全員拔線（登出）：保證金退一半、票根留著、沒有獎金與打賞', () => {
    const g = entered({ rule: QUIET })
    standOn(g, markerBy(g, 'a').id)
    g.commit(useCurtain(g.k, g.state, 'chest'))
    const gained = stubs(g)
    setHeat(g, 80)
    const before = cash(g)
    g.commit(netrunLogout(g.k, g.state))
    expect(cash(g) - before).toBe(150)
    expect(resultOf(g)).toMatchObject({ outcome: 'left', prize: 0, tips: 0, refund: 150, forfeited: 150, stubs: gained })
    expect(cur(g).member!.clears).toBe(0)
    expect(cur(g).week?.tips ?? 0).toBe(0)
  })

  it('全隊倒下（defeat）：只記下輸在哪一幕、當時的場熱，這一趟的紀錄留給下一張（沒有結算、沒有發錢）', () => {
    const g = entered({ rule: QUIET })
    toLayer(g, 1)
    setHeat(g, 44)
    const before = cash(g)
    commit(g, [{ op: 'ext', key: 'netrun', value: { ...nrun(g), layer: 1, over: 'defeat' } as never }])
    expect(cur(g).run).toMatchObject({ lost: { act: 1, heat: 44 } })
    expect(cur(g).run!.over).toBeUndefined()
    expect(cash(g)).toBe(before)
    expect(reportsOf(g, 'curtain.result')).toHaveLength(0)
    expect(nrun(g)).toBeNull()
  })

  it('結果記著：第幾幕、場熱、打賞；結算後計數器歸零', () => {
    const g = entered({ rule: QUIET })
    commit(g, [{ op: 'counter', key: `curtain:${run(g).id}:r0`, delta: 5 }])
    setHeat(g, 82)
    reachEnd(g, 3)
    expect(resultOf(g)).toMatchObject({ act: 3, heat: 82, tips_ratio: 0.5, tips: 450, prize: 900 })
    expect(Object.entries(g.state.counters).filter(([k, v]) => k.startsWith('curtain:') && k !== CURTAIN_STUBS && v !== 0)).toEqual([])
  })
})

// ===================================================================================================================
// 九、加演
// ===================================================================================================================

describe('加演（第 5、6 幕；CYBERSPACE 8.8 節、8.2 節延長賽）', () => {
  it('場熱沒到過 90 也沒有點單：不列加演', () => {
    const g = entered({ rule: QUIET })
    setHeat(g, 80)
    reachEnd(g)
    expect(cur(g).encore).toBeUndefined()
    expect(encoreBlocks(g.k, g.state)[0]).toMatch(/沒有加演的邀請/)
    expect(() => encoreDraft(g.k, g.state)).toThrow(ActionBlocked)
  })

  it('場熱到過 90 才列；進了第 5 幕敵人的等級高一級；獎金 ×4（走完第 6 幕）、保證金不加，場熱接著上一趟', async () => {
    const g = entered({ rule: QUIET })
    setHeat(g, 95)
    reachEnd(g)
    expect(cur(g).encore).toMatchObject({ night: 'n_a', tier: 'floor', grade: 2, heat: 95 })
    expect(resultOf(g)).toMatchObject({ outcome: 'done', prize: 900, tips: 450 })
    expect(encoreBlocks(g.k, g.state)).toEqual([])
    const before = cash(g)
    const reports = g.commit(encoreDraft(g.k, g.state, { seed: 21 }))
    expect(reports.map((r) => r.action)).toEqual(['curtain.encore', 'netrun.enter', 'curtain.stage'])
    expect(cash(g)).toBe(before)
    expect(nrun(g)).toMatchObject({ layers: ['l1', 'l2'], layer: 0, region: 'curtain', grade: 2 })
    expect(run(g)).toMatchObject({ encore: 1, deposit: 0, act: 4 })
    expect(cur(g).encore).toBeUndefined()
    expect(heat(g)).toBe(95)
    expect(curtainView(g.k, g.state)).toMatchObject({ encore: true, act: { number: 1, total: 2, name: '加演・第五幕' } })
    // 第 5 幕：敵人的等級高一級
    startFight(g, plainId(g))
    expect(g.battle!.grade).toBe(3)
    expect(g.battle!.origin.ext).toMatchObject({ curtain: { act: 4 } })
    await finish(g)
    // 走完加演：獎金 ×4（最後一層）、沒有保證金退回
    setHeat(g, 50)
    const mid = cash(g)
    reachEnd(g)
    expect(resultOf(g)).toMatchObject({ outcome: 'done', encore: 1, prize: 3600, tips: 720, refund: 0 })
    expect(cash(g) - mid).toBe(3600 + 720)
    expect(cur(g).member!.clears).toBe(1)
    expect(cur(g).encore).toBeUndefined()
  })

  it('第 6 幕敵人高兩級；加演的第一幕走完就登出拿 ×2 的獎金（沒有打賞）', async () => {
    const g = entered({ rule: QUIET })
    setHeat(g, 91)
    reachEnd(g)
    g.commit(encoreDraft(g.k, g.state, { seed: 21 }))
    toLayer(g, 1)
    startFight(g, plainId(g))
    expect(g.battle!.grade).toBe(4)
    await finish(g)
    const before = cash(g)
    commit(g, [{ op: 'ext', key: 'netrun', value: { ...nrun(g), layer: 1 } as never }])
    g.commit(netrunLogout(g.k, g.state))
    expect(resultOf(g)).toMatchObject({ outcome: 'left', encore: 1, prize: 1800, tips: 0, refund: 0 })
    expect(cash(g) - before).toBe(1800)
  })

  it('這一趟的點單全部接受而且完成也可以加演（場熱沒到 90）；有拒絕的不行', () => {
    const ok = seeded((x) => lineNatural(x) >= 4, { rule: { ...QUIET, ...dcRule(1) } })
    decide(ok, true)
    expect(run(ok).orders![0]!.state).toBe('done')
    setHeat(ok, 50)
    reachEnd(ok)
    expect(cur(ok).encore).toMatchObject({ heat: 50 })
    const no = entered({ rule: QUIET })
    offer(no)
    decide(no, false)
    setHeat(no, 50)
    reachEnd(no)
    expect(cur(no).encore).toBeUndefined()
  })

  it('報名新的一趟之後，上一趟留下的加演資格作廢', () => {
    const g = entered({ rule: QUIET })
    setHeat(g, 95)
    reachEnd(g)
    expect(cur(g).encore).toBeTruthy()
    g.commit(enterDraft(g.k, g.state, { party: ['pc'], night: 'n_b', seed: 12 }))
    expect(cur(g).encore).toBeUndefined()
  })
})

// ===================================================================================================================
// 十、整趟走一遍
// ===================================================================================================================

describe('整趟走一遍：四幕、三次化妝室、結算', () => {
  it('真的一幕一幕打過去（散座）：往下一幕進化妝室、最後通過出口；結算發錢、發 curtain.result、收乾淨', async () => {
    const g = entered({ rule: QUIET })
    const start = cash(g)
    for (let layer = 0; layer < 4; layer++) {
      expect(nrun(g).layer).toBe(layer)
      expect(curtainView(g.k, g.state)!.act).toMatchObject({ number: layer + 1, total: 4 })
      await clearLayer(g)
      if (layer < 3) expect(reportsOf(g, 'curtain.rest')).toHaveLength(layer + 1)
    }
    expect(nrun(g)).toBeNull()
    expect(cur(g).run).toBeUndefined()
    const r = resultOf(g)
    expect(r).toMatchObject({ outcome: 'done', prize: 900, act: 3 })
    expect(cash(g) - start).toBe(900 + r.tips + 300)
    expect(cur(g).member!.clears).toBe(1)
    expect(Object.entries(g.state.counters).filter(([k, v]) => k.startsWith('curtain:') && k !== CURTAIN_STUBS && v !== 0)).toEqual([])
  })

  it('首領（最後一層守閘門的那一場）打贏之後保證擲一次獎品表', async () => {
    const g = entered({ rule: QUIET })
    toLayer(g, 3)
    startFight(g, guardId(g))
    expect(g.battle!.origin.ext).toMatchObject({ curtain: { guard: true, last: true, act: 3 } })
    await finish(g)
    expect(g.state.inventory.find((s) => s.id === 'it_prize')?.qty).toBe(1)
  })

  it('curtainView：第幾幕、場熱與三段的說明、這一幕用了幾回合、點單、票根、贊助人在不在', () => {
    const g = entered({ rule: QUIET })
    const v = curtainView(g.k, g.state)!
    expect(v).toMatchObject({ tier: 'floor', night: { id: 'n_a', culture: 'ca' }, act: { number: 1, name: '序幕・迎賓廳', total: 4, standard: 12, used: 0, boss: null }, encore: false, sponsor: false, cut: false, stubs: 0, stub_value: 20 })
    expect(v.heat).toMatchObject({ value: 30, ratio: 0.1, sponsor_at: 70, encore_at: 90 })
    expect(v.heat.bands.map((b) => [b.from, b.ratio, b.here])).toEqual([[0, 0, false], [20, 0.1, true], [40, 0.2, false], [60, 0.35, false], [80, 0.5, false]])
    expect(curtainView(setup().k, setup().state)).toBeNull()
    const f = markerBy(g, 'f')
    standNear(g, f.at)
    expect(curtainView(g.k, g.state)!.near.find((n) => n.marker.id === f.id)!.uses.map((u) => u.id)).toEqual(['fight'])
  })

  it('開戰要站在遭遇旁邊、守著的才算；打過的不能再開；沒有的節點寫原因', () => {
    const g = entered()
    const f = markerBy(g, 'f')
    expect(reasonOf(() => useCurtain(g.k, g.state, 'fight', f.id))).toMatch(/太遠|旁邊/)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'fight', 'nope'))).toMatch(/沒有「nope」/)
    standOn(g, markerBy(g, 'a').id)
    expect(reasonOf(() => useCurtain(g.k, g.state, 'fight'))).toMatch(/沒有「fight」/)
  })
})
