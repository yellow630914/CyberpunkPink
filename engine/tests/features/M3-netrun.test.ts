// 驗收測試：dev/work/M3-netrun.md（cpp-feature）。features/netrun：網內地圖上的一趟行程（活動 face.net 與 netrun，同一份實作）。
// 規格：CYBERSPACE 8.1 節（生成的規則、節點、密度表、休息點、探索不算脫離戰鬥）、8.3 節（追蹤度在生成的子網裡）、6.8、6.10 節；NETRUNNING 第 3～5 節；
// COMMISSIONS 2.3 節；UI 第 5 節；dev/adr/0018 第五～七、九、十節與 N2、N5、N6、N13、N15、N22、N24、N26。
// 內容是測試自帶的最小假資料：幾筆 net_region（小一點的密度）、兩個假蕾絲與一個白蕾絲（enemy_pick 挑得到）、TEST_NET_COMBAT 的攻擊；不讀 engine/data。
// 副本用「假的 commission 活動」代替（只為了確認 face.net.start 與 commit:netrun. 在委託副本裡放行）。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GridUse, Launch, Origin, ReportDraft } from '../../src'
import { ActionBlocked, Sheet, clone, effectCtx, endActivity, gridHere, meterOf, openMap } from '../../src'
import { enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import { usesAt } from '../../src/features/explore/uses'
import {
  ACT_FACE, ACT_NET, DEFAULT_REGIONS, NETRUN_ALLOW, descend, encounterAfter, gateDc, layerSpec, logout, netExt, netrunFeature, netrunRules, netrunView, nodeUses, readRun, regionOf, regionProblems, ruleProblems, useNode,
} from '../../src/features/netrun'
import { onBattleEnd, reinforceOf, sneakDraft } from '../../src/features/netrun/fight'
import { generateSheet, seedRand } from '../../src'
import { TEST_ACTIVITY, TEST_NET_COMBAT, makeActor, makeGame, netWeapon, playOut } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'sync', 'stealth'].map((id) => ({ id, name: id, attr: id === 'composure' ? 'resolve' : id === 'stealth' || id === 'firearms' ? 'reflex' : id === 'interface' ? 'intellect' : 'body', desc: `${id}。` }))
const lace = (id: string, rank: string, color: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的網內敵人。', faction: 'f_a', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...more,
})

/** 小一點的子網：9 × 7；自己去的那一趟一場遭遇、休息點一個；委託的階段只有那一場。這一份測的是本體，沒有陷阱（陷阱踩上去會停下來，第二張 M3-netrun-nodes 才測）。 */
const TINY = {
  id: 'tiny', name: '小子網', map_kind: 'subnet', size: [9, 7], carve: [16, 22], sight: 2, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { foe: [1, 1], patrol: [0, 0], archive: [0, 1], trap: [0, 0], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
  commission: { foe: [1, 1], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
}
/** 單向與會斷的鏈路都多（挖完再打通幾處讓路成環）。 */
const TWISTY = { ...TINY, id: 'twisty', name: '彎彎曲曲的網', size: [11, 9], carve: [30, 40], oneway: 1, fragile: 1, loops: 3, layer: { ...TINY.layer, foe: [0, 0] } }
/** 沒有壓力條的區。 */
const CALM = { ...TINY, id: 'calm', name: '平靜的網', pressure: 'none', safe: true }

const PACK: ContentPack = {
  id: 'netrun_test',
  content: {
    skill: SKILLS,
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }, { id: 'f_empty', name: '空公司', short: '空', class: 'corp' }],
    net_region: [TINY, CALM, TWISTY],
    enemy: [lace('en_pink_m', 'minion', 'pink'), lace('en_pink_e', 'elite', 'pink'), lace('en_white', 'minion', 'white', { position: { prefer: [4] } }), lace('en_boss', 'boss', 'black', { grades: [1, 5] })],
    special_map: [{
      id: 'map_real', kind: 'block', size: [5, 3],
      sheets: [{ id: 's', name: '街', size: [5, 3], layout: ['#####', '#E..#', '#####'], cells: [{ id: 'E1', at: [1, 1], mark: 'E', name: '入口' }] }],
    }],
  },
} as unknown as ContentPack

/** 測試自己的衍生數值：甲板等級（角色的 ext.testdeck）、追蹤度起始值的加減（ext.tstart）。 */
const STATS: Feature = {
  id: 'netrun_test_stats',
  install(k) {
    k.stats.defineStat({ id: 'deck_grade', owner: 'netrun_test_stats', name: '甲板', base: (state, actor) => (state.actors[actor]?.ext.testdeck ? 1 : 0) })
    k.stats.defineStat({ id: 'net_trace_start', owner: 'netrun_test_stats', name: '追蹤度的起始加減', base: (state, actor) => Number(state.actors[actor]?.ext.tstart ?? 0), min: -100, max: 100 })
  },
}

/** 內海的武器構裝（很強，讓程式代打一定贏）與一個「拔線」的行動（和 netcombat 的一樣：setOut 成 jacked_out）。 */
const COMBAT: Feature = {
  id: 'netrun_test_combat',
  install(k) {
    k.battle.loadout('netrun_test_combat', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(40, 14)] } : undefined))
    k.battle.action({
      id: 'test.net.jack', owner: 'netrun_test_combat', name: '拔線', desc: '自己登出。', group: 'system', icon: 'flee', modes: ['net'], target: 'none', order: 9,
      cost: () => ({ ap: 1 }),
      run: (run, u) => void run.setOut(u, 'jacked_out'),
    })
  },
}

/** 記下每一次 activity.end（kind、outcome、result、origin）。 */
const ENDS: Array<{ kind: string; id: string; outcome: string; result: Rec; origin: Origin }> = []
const SPY: Feature = {
  id: 'netrun_test_spy',
  install(k) {
    k.hooks.on('activity.end', 'netrun_test_spy', ({ kind, id, outcome, result, origin }) => {
      ENDS.push({ kind, id, outcome, result: clone(result), origin: clone(origin) })
    })
  },
}

/** 假的委託副本：state.ext.fake_commission 有值時進行中；放行什麼由 netrun 自己登記（k.activity.allow('commission', …)）。 */
const FAKE_COMMISSION: Feature = {
  id: 'netrun_test_commission',
  install(k) {
    k.activity.define({
      kind: 'commission', owner: 'netrun_test_commission', order: 90,
      active: (s) => (s.ext.fake_commission ? { id: 'c1', label: '假的副本' } : null),
      allow: ['commit:fake.', 'battle.', 'commit:battle.', 'chain:battle_end', 'grid.', 'commit:grid.', 'commit:defeat.'],
      reason: () => '副本進行中。',
    })
  },
}

/** 之後的區：回答 netrun.round（每個探索回合一個計數）與 netrun.close（記下怎麼結束的、加一句話）。 */
const HOOKS: Feature = {
  id: 'netrun_test_hooks',
  install(k) {
    k.hooks.on('netrun.round', 'netrun_test_hooks', ({ run }) => [{ op: 'counter', key: 'ticks', delta: 1 }, { op: 'counter', key: `round_${run.round}`, delta: 1 }])
    k.hooks.on('netrun.close', 'netrun_test_hooks', ({ outcome, run }) => ({ changes: [{ op: 'flag', key: 'closed', value: `${outcome}:${run.id}` }], lines: [`收尾（${outcome}）。`] }))
  },
}

const FEATURES = [enemiesFeature, exploreFeature, netrunFeature, TEST_NET_COMBAT, STATS, COMBAT, SPY, TEST_ACTIVITY, FAKE_COMMISSION]

const ORIGIN: Origin = { by: 'commission', ref: 'c1', ext: { commission: 'c1', stage: 1, face: 'net' } }
const SETUP = { region: 'tiny', grade: 1, faction: 'f_a', layer: 'staff', encounter: ['minion', 'minion', 'elite'], seed: 11, commission: 'c1', stage: 1, face: 'net' }

interface Opts {
  seed?: number
  /** 隊員：幾個人（主角加同伴）；每個人都有甲板 */
  party?: number
  deck?: boolean
  pc?: Rec
  more?: Feature[]
  commission?: boolean
}
type G = ReturnType<typeof makeGame>['game']

function setup(o: Opts = {}) {
  const pc = { ext: { ...(o.deck === false ? {} : { testdeck: 1 }) }, attrs: { resolve: 14 }, ...(o.pc ?? {}) }
  const actors = Array.from({ length: (o.party ?? 2) - 1 }, (_, i) => makeActor({ id: `c${i + 1}`, name: `同伴${i + 1}`, role: 'companion', ext: o.deck === false ? {} : { testdeck: 1 } }))
  const t = makeGame({ seed: o.seed ?? 5, features: [...FEATURES, ...(o.more ?? [])], content: [PACK], pc: pc as never, actors })
  if (o.commission) commit(t.game, [{ op: 'ext', key: 'fake_commission', value: 1 }])
  return t
}

const commit = (g: G, changes: Change[], action = 'netrun.test'): ReturnType<G['commit']> => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const launch = (g: G, kind: string = ACT_FACE, setup: Rec = SETUP, origin: Origin = ORIGIN) => g.launch(kind, setup, origin)
const run = (g: G) => readRun(g.state)!
const ext = (g: G) => netExt(g.state, run(g).map)!
const here = (g: G) => gridHere(g.k, g.state)!
const at = (g: G): [number, number] => [g.state.maps.at!.x, g.state.maps.at!.y]
const trace = (g: G) => meterOf(g.k, g.state, 'trace', run(g).map)
const ends = (kind?: string) => ENDS.filter((e) => !kind || e.kind === kind)

/** 第一個讓 want 成立的種子（種子不同，地圖與骰面都不同）。 */
function seedWhere(opts: Opts, want: (g: G) => boolean, start = 1): number {
  for (let seed = start; seed < start + 120; seed++) {
    try {
      if (want(setup({ ...opts, seed }).game)) return seed
    } catch {
      // 這個種子開不成，換下一個
    }
  }
  throw new Error('找不到合適的種子')
}

// ---- 看地圖 ----

const key = (p: [number, number]) => `${p[0]},${p[1]}`
/** 現在這一層的格子（套上改過的）。 */
const sheetOf = (g: G): Sheet => here(g).sheet
const markerOfKind = (g: G, mark: string) => (sheetOf(g).def.cells ?? []).filter((m) => m.mark === mark)
const nodes = (g: G) => ext(g).graph[g.state.maps.at!.sheet]!.nodes
const isNode = (g: G, p: [number, number]) => nodes(g).some((n) => key(n.at) === key(p))
/** 現在站的位置走得到的格子（不含上了鎖的）。 */
const reachable = (g: G): Set<string> => sheetOf(g).reachable({ x: at(g)[0], y: at(g)[1] })
/** 走到某一格：成功才回傳。 */
function go(g: G, p: [number, number]): void {
  const r = g.gridMove(p)
  if (r.status !== 'applied') throw new Error(`走不到 ${key(p)}：${r.reason}`)
}
/** 站在遭遇節點旁邊（走得到的那一側）。 */
function standByFoe(g: G): { foe: ReturnType<typeof markerOfKind>[number]; spot: [number, number] } {
  const foe = markerOfKind(g, 'f')[0]!
  const reach = reachable(g)
  const spot = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [foe.at[0] + dx, foe.at[1] + dy] as [number, number]).find((p) => reach.has(key(p)))
  if (!spot) throw new Error('走不到遭遇節點的旁邊')
  go(g, spot)
  return { foe, spot }
}
const draftOf = (g: G, id: string, markerId?: string): ReportDraft => useNode(g.k, g.state, id, markerId)
const uses = (g: G): GridUse[] => nodeUses(g.k, g.state)

// ===================================================================================================================
// 一、區的規則表與生成
// ===================================================================================================================

describe('區的規則表（net_region）與內建的一般子網', () => {
  it('內建的 subnet：11 × 9、挖 30～40 步、視野 2、有追蹤度；密度照 CYBERSPACE 8.1 節；委託的階段只有一場遭遇（N2）', () => {
    const r = DEFAULT_REGIONS.subnet!
    expect(r.size).toEqual([11, 9])
    expect(r.carve).toEqual([30, 40])
    expect(r.sight).toBe(2)
    expect(r.pressure).toBe('trace')
    expect(r.dc).toEqual([10, 13, 16, 19, 22])
    expect(r.layer).toMatchObject({ foe: [2, 3], patrol: [1, 1], archive: [1, 2], trap: [1, 2], rest: [1, 1] })
    expect(r.commission).toMatchObject({ foe: [1, 1], patrol: [1, 1], trap: [1, 2], rest: [1, 1] })
    expect(regionProblems(r as never)).toEqual([])
  })

  it('內建的 subnet 兩組密度各生成 40 個種子都成功；遭遇、休息點、出口的數量在範圍內', () => {
    const r = DEFAULT_REGIONS.subnet!
    for (const [section, label] of [[r.layer, '自己去挖'], [r.commission!, '委託']] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const spec = layerSpec(r, section, 'l1', '員工層', false, false)
        const res = generateSheet(spec, seedRand(seed, 'x'))
        const cells = res.sheet.cells ?? []
        const count = (mark: string) => cells.filter((m) => m.mark === mark).length
        expect(count('f'), `${label} ${seed} 遭遇`).toBeGreaterThanOrEqual(section.foe[0])
        expect(count('f')).toBeLessThanOrEqual(section.foe[1])
        expect(count('r'), `${label} ${seed} 休息點`).toBe(1)
        expect(count('g')).toBe(1)
        expect(res.sheet.sight).toBe(2)
      }
    }
  })

  it('格式檢查：壞的區整筆擋下並說明；資料蓋掉內建的 subnet', () => {
    expect(regionProblems({ ...TINY, size: [3, 3] })).not.toEqual([])
    expect(regionProblems({ ...TINY, pressure: 'x' })).not.toEqual([])
    expect(regionProblems({ ...TINY, dc: [10] })).not.toEqual([])
    expect(regionProblems({ ...TINY, layer: { ...TINY.layer, foe: [3, 1] } })).not.toEqual([])
    expect(regionProblems({ ...TINY, layer: { ...TINY.layer, dragon: [1, 1] } })).not.toEqual([])
    expect(regionProblems(TINY)).toEqual([])
    const { game: g } = setup()
    const tiny = regionOf(g.k, 'tiny')
    expect('region' in tiny && tiny.region.size).toEqual([9, 7])
    expect(regionOf(g.k, 'nope')).toMatchObject({ problem: expect.stringContaining('找不到') })
    expect(regionOf(g.k, { ...TINY, id: 'inline' })).toMatchObject({ region: { id: 'inline' } })
    expect(regionOf(g.k, { ...TINY, size: [1, 1] })).toMatchObject({ problem: expect.stringContaining('格式不對') })
  })

  it('探索的數字（netrun_rule）有內建的預設：基礎消退 0、門檻 30／60／90、倒數 3 個回合', () => {
    const { game: g } = setup()
    expect(netrunRules(g.k)).toMatchObject({ decay: 0, t1: 30, t2: 60, t3: 90, locate_rounds: 3, gate_t1_dc: 2 })
  })
})

// ===================================================================================================================
// 二、開始、放行清單
// ===================================================================================================================

describe('開始：委託的一段（face.net）', () => {
  it('開了一份 kind 是 subnet、有 gen 的地圖，人站在入口；狀態有這一趟', () => {
    const { game: g } = setup({ commission: true })
    const reports = launch(g)
    expect(reports[0]!.action).toBe('netrun.enter')
    const r = run(g)
    expect(r).toMatchObject({ kind: ACT_FACE, region: 'tiny', grade: 1, layer: 0, round: 0, goal: { kind: 'pass' }, loot: [], origin: ORIGIN })
    const inst = g.state.maps.instances[r.map]!
    expect(inst.gen?.map.kind).toBe('subnet')
    expect(inst.gen?.by).toBe('netrun')
    expect(inst.sheets).toBeDefined()
    expect(g.state.maps.at).toMatchObject({ map: r.map, sheet: 'l1' })
    const entry = markerOfKind(g, 'E')[0]!
    expect(at(g)).toEqual(entry.at)
    expect(netExt(g.state, r.map)).toMatchObject({ region: 'tiny', grade: 1, dc: 10, faction: 'f_a', rested: [] })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(expect.arrayContaining(['commission', 'face.net']))
    expect(ext(g).graph.l1!.nodes.length).toBeGreaterThan(3)
    expect(Object.keys(ext(g).safe_path)).toEqual(['l1'])
  })

  it('同一個 seed 開兩次版面一樣（兩局不同的世界種子也一樣）；不同的 seed 版面不一樣', () => {
    const layout = (worldSeed: number, seed: number) => {
      const { game: g } = setup({ seed: worldSeed, commission: true })
      launch(g, ACT_FACE, { ...SETUP, seed })
      return g.state.maps.instances[run(g).map]!.gen!.map.sheets[0]!.layout
    }
    expect(layout(1, 77)).toEqual(layout(2, 77))
    expect(layout(1, 77)).not.toEqual(layout(1, 78))
  })

  it('沒寫 seed 時由世界種子導出：同一個狀態開兩次一樣', () => {
    const open = () => {
      const { game: g } = setup({ seed: 9 })
      launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a' })
      return g.state.maps.instances[run(g).map]!.gen!.seed
    }
    expect(open()).toBe(open())
  })

  it('存檔再讀，接著走的結果一樣', () => {
    const { game: a } = setup({ commission: true })
    launch(a)
    const raw = a.save()
    const first = (g: G) => {
      const reach = [...reachable(g)].map((s) => s.split(',').map(Number) as [number, number]).filter((p) => isNode(g, p) && key(p) !== key(at(g)))
      const p = reach[reach.length - 1]!
      go(g, p)
      return { at: at(g), round: run(g).round, load: g.state.actors.pc!.load, maps: clone(g.state.maps), run: clone(run(g)) }
    }
    commit(a, [{ op: 'actor.track', id: 'pc', track: 'load', delta: 9 }])
    const raw2 = a.save()
    const { game: b } = setup({ seed: 123 })
    expect(b.load(raw2)).toBeNull()
    const ra = first(a)
    const rb = first(b)
    expect(rb).toEqual(ra)
    void raw
  })
})

describe('開始：自己潛進去的一趟（netrun）', () => {
  it('可以開多層：每層一張圖、同一份地圖實例；追蹤度的鍵是這份實例', () => {
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 2, faction: 'f_a', layers: ['guest', 'staff', 'core'], seed: 3, encounter: [] })
    const r = run(g)
    expect(r.layers).toEqual(['l1', 'l2', 'l3'])
    expect(r.goal.kind).toBe('clear')
    const inst = g.state.maps.instances[r.map]!
    expect(inst.gen!.map.sheets.map((s) => s.name)).toEqual(['訪客層', '員工層', '核心層'])
    expect(Object.keys(netExt(g.state, r.map)!.graph)).toEqual(['l1', 'l2', 'l3'])
    expect(netExt(g.state, r.map)!.dc).toBe(13)
    expect(g.state.meters.trace?.[r.map]).toBe(0)
  })

  it('擋下的情況各一句：已經有一趟在進行、沒有人有甲板、有人還在燒傷、沒有這一區的規則表、設定壞掉', () => {
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 1, encounter: [] })
    const second = () => g.k.activity.start(g.k, g.state, ACT_NET, { region: 'tiny', grade: 1 }, { by: 'core' })
    expect(second).toThrow(/已經有一趟/)

    const none = setup({ deck: false })
    expect(() => none.game.k.activity.start(none.game.k, none.game.state, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a' }, { by: 'core' })).toThrow(/沒有人有甲板/)

    const burnt = setup()
    commit(burnt.game, [{ op: 'actor.condition', id: 'pc', condition: 'net_burn', until: 60 * 24 * 40 }])
    expect(() => burnt.game.launch(ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a' })).toThrow(/燒傷/)
    // 過期的不算
    const old = setup()
    commit(old.game, [{ op: 'actor.condition', id: 'pc', condition: 'net_burn', until: 0 }])
    expect(() => old.game.launch(ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 2, encounter: [] })).not.toThrow()

    const lost = setup()
    expect(() => lost.game.launch(ACT_NET, { region: 'nope', grade: 1 })).toThrow(/找不到「nope」/)
    expect(() => lost.game.launch(ACT_NET, { region: 'tiny' })).toThrow(/等級/)
    expect(() => lost.game.launch(ACT_NET, { region: 'tiny', grade: 1, seed: 1.5 })).toThrow(/seed/)
    expect(lost.game.state.maps.at).toBeNull()
    expect(readRun(lost.game.state)).toBeNull()
  })

  it('沒有人定義 deck_grade 時（甲板的功能沒裝）不看甲板', () => {
    const t = makeGame({ features: [enemiesFeature, netrunFeature, TEST_NET_COMBAT], content: [PACK] })
    expect(() => t.game.launch(ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', encounter: [], seed: 4 })).not.toThrow()
  })

  it('開不成：enemy_pick 挑不到那個勢力的蕾絲時整步不成立，發起的那一份報告沒有套用', () => {
    const { game: g } = setup({ commission: true })
    const launchOf: Launch = { kind: ACT_FACE, setup: { ...SETUP, faction: 'f_empty' }, origin: ORIGIN }
    const bad: ReportDraft = { kind: 'system', action: 'fake.go', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'started', value: true }], outcome: { result: 'ok', summary: '出發' }, launch: [launchOf] }
    // 掛在 commission 活動底下：fake. 放行
    expect(() => g.commit(bad)).toThrow(ActionBlocked)
    expect(g.state.flags.started).toBeUndefined()
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    // 沒有勢力的蕾絲可以退到 none：這個內容裡沒有，所以 faction 不寫也開不成
    expect(() => g.launch(ACT_FACE, { ...SETUP, faction: undefined }, ORIGIN)).toThrow(/挑不到/)
    // 對照：挑得到的勢力
    expect(() => g.commit({ ...bad, changes: [{ op: 'flag', key: 'started', value: true }], launch: [{ ...launchOf, setup: SETUP }] })).not.toThrow()
    expect(g.state.flags.started).toBe(true)
    expect(readRun(g.state)).not.toBeNull()
  })
})

describe('放行清單', () => {
  it('netrun 進行中放行的只有那十三項（含成人場景的 scene.start 與 commit:scene.）：交易、休息、接委託這類報告被擋並有原因', () => {
    for (const kind of [ACT_NET, ACT_FACE]) {
      const { game: g } = setup()
      launch(g, kind, { ...SETUP, encounter: [] }, kind === ACT_FACE ? ORIGIN : { by: 'core' })
      expect(g.k.activity.get(kind)!.allow).toEqual([...NETRUN_ALLOW])
      expect(NETRUN_ALLOW).toHaveLength(13)
      for (const doing of NETRUN_ALLOW) expect(g.blockOf(doing), doing).toBeNull()
      for (const doing of ['commit:trade.checkout', 'commit:rest.sleep', 'commit:fixer.accept', 'commit:commission.enter', 'commit:work.start', 'trade.start', 'rest.start', 'netrun.start', 'face.net.start', 'rewind:stage']) {
        const reason = g.blockOf(doing)
        expect(typeof reason, doing).toBe('string')
        expect(reason!.length).toBeGreaterThan(8)
      }
    }
  })

  it('委託副本進行中：開 face.net 與這一趟自己的報告放行（k.activity.allow(commission, …)）；沒有這兩條時被副本擋下', () => {
    const { game: g } = setup({ commission: true })
    expect(g.blockOf('face.net.start')).toBeNull()
    expect(g.blockOf('commit:netrun.use')).toBeNull()
    // 對照：副本以外的前綴還是擋
    expect(g.blockOf('commit:trade.checkout')).toBe('副本進行中。')
    launch(g)
    expect(g.blockOf('commit:netrun.use')).toBeNull()
  })
})

// ===================================================================================================================
// 三、走路：探索回合
// ===================================================================================================================

describe('走路：站上節點算一個探索回合（N5）', () => {
  it('走到一個節點格 round +1；感載不消退（內海的基礎消退是 0）；餘韻不動；走在鏈路上不變', () => {
    // 找一個入口旁邊先經過鏈路格的種子
    const seed = seedWhere({ commission: true }, (g) => {
      launch(g, ACT_FACE, { ...SETUP, encounter: [] })
      const [x, y] = at(g)
      return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => sheetOf(g).walkable(x + dx, y + dy) && !isNode(g, [x + dx, y + dy]))
    })
    const { game: g } = setup({ seed, commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    commit(g, [{ op: 'actor.track', id: 'pc', track: 'load', delta: 12 }, { op: 'actor.track', id: 'pc', track: 'afterglow', delta: 2 }, { op: 'actor.track', id: 'c1', track: 'load', delta: 1 }])
    const [x, y] = at(g)
    const dir = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).find(([dx, dy]) => sheetOf(g).walkable(x + dx, y + dy) && !isNode(g, [x + dx, y + dy]))!
    // 一步走到鏈路格：什麼都不變
    go(g, [x + dir[0], y + dir[1]])
    expect(run(g).round).toBe(0)
    expect(g.state.actors.pc!.load).toBe(12)
    // 走到下一個節點（沿途的節點各算一個）
    const target = nodes(g).filter((n) => reachable(g).has(key(n.at)) && key(n.at) !== key([x, y])).sort((a, b) => a.depth - b.depth)[0]!
    const path = sheetOf(g).findPath({ x: at(g)[0], y: at(g)[1] }, { x: target.at[0], y: target.at[1] })!.slice(1)
    const expected = path.filter((p) => isNode(g, [p.x, p.y])).length
    go(g, target.at)
    expect(expected).toBeGreaterThan(0)
    expect(run(g).round).toBe(expected)
    // 內海的基礎消退是 0（使用者 2026-11-24）：意志 14 也不消退；同伴的 1 點還在
    expect(g.state.actors.pc!.load).toBe(12)
    expect(g.state.actors.c1!.load).toBe(1)
    expect(g.state.actors.pc!.afterglow).toBe(2)
  })

  it('同一個節點格站著不動不算：原地走一步（回到入口再出去）才又算一次', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    const n = nodes(g).filter((p) => reachable(g).has(key(p.at)) && key(p.at) !== key(at(g)))[0]!
    const entry = at(g)
    go(g, n.at)
    const r1 = run(g).round
    go(g, entry)
    expect(run(g).round).toBeGreaterThan(r1)
  })

  it('自己去的那一趟進每一層的第一步帶 enter_floor；委託的階段不帶', () => {
    const own = setup()
    launch(own.game, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 8, encounter: [], layers: ['staff', 'core'] })
    const step = (g: G) => {
      const n = nodes(g).filter((p) => reachable(g).has(key(p.at)) && key(p.at) !== key(at(g)))[0]!
      const before = g.state.reports.length
      go(g, n.at)
      return g.state.reports.slice(before).flatMap((r) => r.triggers ?? [])
    }
    const first = step(own.game)
    expect(first.map((t) => t.point)).toEqual(['enter_floor'])
    expect(first[0]!.where).toMatchObject({ layer: '員工層' })
    expect(step(own.game)).toEqual([])
    const face = setup({ commission: true })
    launch(face.game, ACT_FACE, { ...SETUP, encounter: [] })
    expect(step(face.game)).toEqual([])
  })

  it('現實的地圖上 netrun 的掛點不作用；在這張網內的地圖上 explore 的 uses 是空的', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    const before = clone(run(g))
    // 另外開一張現實的地圖站上去走一步
    const opened = openMap(g.k, g.state, 'map_real')
    commit(g, opened.changes)
    const r = g.gridMove('east')
    expect(r.status).toBe('applied')
    expect(run(g)).toEqual(before)
    expect(g.state.reports.at(-1)!.triggers ?? []).toEqual([])
    // explore 的 uses：現實的地圖照舊有，網內的地圖是空的
    const fake = { id: 'T1', at: [1, 1] as [number, number], mark: 'T', name: '東西' }
    const real = gridHere(g.k, g.state)!
    expect(usesAt(g.k, real, fake).length).toBeGreaterThan(0)
    commit(g, [{ op: 'map.at', to: { map: before.map, sheet: 'l1', x: 1, y: 1 } }])
    expect(usesAt(g.k, gridHere(g.k, g.state)!, fake)).toEqual([])
  })
})

// ===================================================================================================================
// 四、遭遇節點
// ===================================================================================================================

describe('遭遇節點（N6）', () => {
  it('走不上去、原因是完整的句子；站在旁邊 netrunView 列出開戰與潛行繞過', () => {
    const { game: g } = setup({ commission: true })
    launch(g)
    const { foe, spot } = standByFoe(g)
    const dir = foe.at[0] > spot[0] ? 'east' : foe.at[0] < spot[0] ? 'west' : foe.at[1] > spot[1] ? 'south' : 'north'
    const moved = g.gridMove(dir)
    expect(moved.status).toBe('refused')
    expect(moved.reason).toMatch(/守在.*走不上去.*開戰.*潛行繞過。$/)
    expect(g.gridView()!.moves[dir]).toBe(moved.reason)
    const view = netrunView(g.k, g.state)!
    expect(view.near).toHaveLength(1)
    expect(view.near[0]).toMatchObject({ id: foe.id, mark: 'f' })
    expect(view.near[0]!.uses.map((u) => u.id)).toEqual(['fight', 'sneak'])
    expect(view.near[0]!.uses.every((u) => u.block === null)).toBe(true)
    // 離開那一格就不列了
    const far = nodes(g).find((n) => key(n.at) !== key(spot) && reachable(g).has(key(n.at)) && Math.abs(n.at[0] - foe.at[0]) + Math.abs(n.at[1] - foe.at[1]) > 1)
    if (far) {
      go(g, far.at)
      expect(netrunView(g.k, g.state)!.near).toEqual([])
    }
  })

  it('遠處的遭遇節點、站在旁邊以外的位置：不能做，原因寫出來', () => {
    const { game: g } = setup({ commission: true })
    launch(g)
    const foe = markerOfKind(g, 'f')[0]!
    expect(() => useNode(g.k, g.state, 'fight', foe.id)).toThrow(/太遠了/)
    expect(() => useNode(g.k, g.state, 'fight')).toThrow(/這裡沒有「fight」可以做/)
    expect(() => useNode(g.k, g.state, 'fight', 'zz9')).toThrow(/沒有「zz9」/)
  })

  it('開戰：origin.ext 有 commission、stage、face 與 net（run、map、node、dc、reinforce），field.trace 等於量表；打贏之後節點是地板、量表等於戰鬥結束時的數字', async () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, defeat_event: 'de_x', employer: 'f_a', encounter: ['minion', 'minion'] })
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 12 }])
    const { foe } = standByFoe(g)
    const d = draftOf(g, 'fight', foe.id)
    expect(d.launch).toHaveLength(1)
    g.commit(d)
    const b = g.battle!
    expect(b).toBeTruthy()
    expect(b.mode).toBe('net')
    expect(b.field.trace).toBe(12)
    expect(b.origin.ext).toMatchObject({
      commission: 'c1', stage: 1, face: 'net', defeat_event: 'de_x', employer: 'f_a', by: 'netrun', ref: run(g).id,
      net: { run: run(g).id, map: run(g).map, sheet: 'l1', node: foe.id, region: 'tiny', dc: 10 },
    })
    const net = b.origin.ext!.net as Rec
    expect(net.reinforce).toMatchObject({ t30: { from: 'enemy_pick', rank: 'minion', color: 'white' }, t60: { from: 'enemy_pick', rank: 'elite' } })
    expect(net.locate_rounds).toBe(3)
    expect(Object.values(b.units).filter((u) => u.side === 'foe')).toHaveLength(2)
    expect(Object.values(b.units).filter((u) => u.side === 'ally').map((u) => u.actor)).toEqual(['pc', 'c1'])
    const out = playOut(g)
    expect(out.outcome).toBe('win')
    const fieldTrace = g.battle!.field.trace as number
    expect(fieldTrace).toBeGreaterThanOrEqual(12)
    await g.finishBattle()
    expect(g.battle).toBeNull()
    expect(sheetOf(g).kindAt(foe.at[0], foe.at[1])).toBe('floor')
    expect(trace(g)).toBe(Math.min(100, fieldTrace))
    expect(ext(g).foes.l1![foe.id]!.done).toBe(true)
    expect(run(g).peak).toBeGreaterThanOrEqual(fieldTrace)
    // 處理過的節點可以走上去（站上去也算一個探索回合）
    const rounds = run(g).round
    go(g, foe.at)
    expect(run(g).round).toBe(rounds + 1)
  })

  it('潛行繞過：全隊都過時不開戰、節點變地板；有人沒過就開戰而且對方有先攻的優勢（edge: foe）', () => {
    const win = seedWhere({ commission: true }, (g) => {
      launch(g)
      standByFoe(g)
      return draftOf(g, 'sneak', markerOfKind(g, 'f')[0]!.id).outcome.result === 'sneak'
    })
    const a = setup({ seed: win, commission: true }).game
    launch(a)
    const { foe } = standByFoe(a)
    const d = draftOf(a, 'sneak', foe.id)
    expect(d.launch).toBeUndefined()
    expect(d.timeline.filter((t) => t.tag === 'netrun.roll')).toHaveLength(2)
    a.commit(d)
    expect(a.battle).toBeNull()
    expect(sheetOf(a).kindAt(foe.at[0], foe.at[1])).toBe('floor')
    expect(ext(a).foes.l1![foe.id]!.done).toBe(true)

    const lose = seedWhere({ commission: true }, (g) => {
      launch(g)
      standByFoe(g)
      return draftOf(g, 'sneak', markerOfKind(g, 'f')[0]!.id).outcome.result === 'sneak_fail'
    })
    const b = setup({ seed: lose, commission: true }).game
    launch(b)
    const f2 = standByFoe(b).foe
    const d2 = draftOf(b, 'sneak', f2.id)
    expect(d2.launch).toHaveLength(1)
    expect((d2.launch![0]!.setup as Rec).edge).toBe('foe')
    b.commit(d2)
    expect(b.battle).toBeTruthy()
    expect(sheetOf(b).kindAt(f2.at[0], f2.at[1])).toBe('net_foe')
    expect(b.state.snapshots.find((s) => s.kind === 'battle')!.data!.setup).toMatchObject({ edge: 'foe' })
  })

  it('setup.stealth 時第一次繞過不擲（N24）；用過之後照擲', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, stealth: true })
    standByFoe(g)
    const foe = markerOfKind(g, 'f')[0]!
    const free = draftOf(g, 'sneak', foe.id)
    expect(free.outcome.result).toBe('sneak')
    expect(free.timeline.map((t) => t.tag)).toEqual(['netrun.sneak'])
    expect(free.timeline.some((t) => t.roll)).toBe(false)
    // 第一次做完（記成用掉了）之後，同一個節點的下一次擲骰
    const used = { ...run(g), stealth_used: true }
    const rolled = sneakDraft(g.k, g.state, used, ext(g), 'l1', foe)
    expect(rolled.timeline.filter((t) => t.roll)).toHaveLength(2)
    // 沒有 stealth 的那一趟本來就擲
    const plain = setup({ commission: true }).game
    launch(plain)
    standByFoe(plain)
    expect(draftOf(plain, 'sneak', markerOfKind(plain, 'f')[0]!.id).timeline.some((t) => t.roll)).toBe(true)
  })

  it('encounter: [雜兵, 雜兵, 精英]：加 fx.half 是兩個；加 fx.lace_down 精英變雜兵；fx.minus 再少幾個（至少留一個）；空的 encounter 沒有遭遇', () => {
    const foesOf = (fx: Rec, encounter: string[] = ['minion', 'minion', 'elite']) => {
      const { game: g } = setup({ commission: true })
      launch(g, ACT_FACE, { ...SETUP, encounter, fx })
      return Object.values(ext(g).foes.l1!).flatMap((f) => f.foes.map((u) => u.rank))
    }
    expect(foesOf({})).toEqual(['minion', 'minion', 'elite'])
    expect(foesOf({ half: true })).toEqual(['minion', 'minion'])
    expect(foesOf({ lace_down: true })).toEqual(['minion', 'minion', 'minion'])
    expect(foesOf({ half: true, minus: 1 })).toEqual(['minion'])
    expect(foesOf({ minus: 9 })).toEqual(['minion'])
    expect(foesOf({}, [])).toEqual([])
    expect(encounterAfter(['boss', 'elite', 'minion'], { lace_down: true })).toEqual(['elite', 'minion', 'minion'])
    // 空的 encounter：版面上沒有遭遇節點，閘門本來就開著
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    expect(markerOfKind(g, 'f')).toEqual([])
    expect(netrunView(g.k, g.state)!.gate.open).toBe(true)
  })

  it('每一個敵人是一筆 enemy_pick（勢力、等級、位階、seed、color 照 lace、layer）', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, lace: 'pink', encounter: ['minion', 'elite'] })
    const foes = Object.values(ext(g).foes.l1!).flatMap((f) => f.foes)
    expect(foes).toHaveLength(2)
    for (const f of foes) expect(f).toMatchObject({ from: 'enemy_pick', faction: 'f_a', grade: 1, color: 'pink', layer: 'staff' })
    expect(new Set(foes.map((f) => f.seed)).size).toBe(2)
  })
})

// ===================================================================================================================
// 五、追蹤度的起點
// ===================================================================================================================

describe('追蹤度的起點', () => {
  it('setup.trace 加 fx.trace_start 加全隊的 net_trace_start：20、−15、−15 → −10', () => {
    const { game: g } = setup({ commission: true })
    commit(g, [{ op: 'actor.ext', id: 'pc', key: 'tstart', value: -10 }, { op: 'actor.ext', id: 'c1', key: 'tstart', value: -5 }])
    launch(g, ACT_FACE, { ...SETUP, encounter: [], trace: 20, fx: { trace_start: -15 } })
    expect(trace(g)).toBe(-10)
    expect(g.state.reports.find((r) => r.action === 'netrun.enter')!.outcome.summary).toContain('-10')
  })

  it('什麼都沒給就是 0；夾在 −30～100；沒有壓力條的區沒有追蹤度', () => {
    const a = setup({ commission: true }).game
    launch(a, ACT_FACE, { ...SETUP, encounter: [] })
    expect(trace(a)).toBe(0)
    const b = setup({ commission: true }).game
    launch(b, ACT_FACE, { ...SETUP, encounter: [], trace: -80 })
    expect(trace(b)).toBe(-30)
    const c = setup({ commission: true }).game
    launch(c, ACT_FACE, { ...SETUP, region: 'calm', encounter: [], trace: 40 })
    expect(c.state.meters.trace?.[run(c).map]).toBeUndefined()
    expect(netrunView(c.k, c.state)!.trace).toMatchObject({ value: null, stage: null })
  })
})

// ===================================================================================================================
// 六、閘門、結束、多層、休息點
// ===================================================================================================================

const gateCell = (g: G): [number, number] => markerOfKind(g, 'g')[0]!.at

describe('閘門與結束', () => {
  it('遭遇沒處理時「通過」灰掉並有原因；打贏之後通過，交回 done；result.trace 是離開時的值，地圖關了、狀態清了', async () => {
    ENDS.length = 0
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: ['minion'] })
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 7 }])
    const gate = markerOfKind(g, 'g')[0]!
    expect(gate.name).toBe('出口')
    // 走到閘門旁（路被遭遇擋著就走到能走到的最近的地方）；用 netrunView 看閘門的狀態：先處理遭遇
    const { foe } = standByFoe(g)
    expect(netrunView(g.k, g.state)!.gate).toEqual({ open: false, last: true })
    // 直接站到閘門上（測試把人放過去），用途上灰掉
    commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: 'l1', x: gate.at[0], y: gate.at[1] } }])
    const u = uses(g)
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ id: 'pass', name: '通過出口' })
    expect(u[0]!.block).toMatch(/閘門被守著/)
    expect(() => useNode(g.k, g.state, 'pass')).toThrow(/閘門被守著/)
    // 打贏守閘門的那一場
    commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: 'l1', x: at(g)[0], y: at(g)[1] } }])
    const g2 = setup({ commission: true }).game
    launch(g2, ACT_FACE, { ...SETUP, encounter: ['minion'] })
    commit(g2, [{ op: 'meter', kind: 'trace', key: run(g2).map, set: 7 }])
    standByFoe(g2)
    g2.commit(draftOf(g2, 'fight', markerOfKind(g2, 'f')[0]!.id))
    playOut(g2)
    await g2.finishBattle()
    const finalTrace = trace(g2)
    expect(ext(g2).foes.l1![foe.id]!.done).toBe(true)
    const gate2 = gateCell(g2)
    go(g2, gate2)
    expect(uses(g2)[0]!.block).toBeNull()
    expect(netrunView(g2.k, g2.state)!.gate).toEqual({ open: true, last: true })
    const map = run(g2).map
    const id = run(g2).id
    const rounds = run(g2).round
    ENDS.length = 0
    const reports = g2.commit(useNode(g2.k, g2.state, 'pass'))
    expect(reports.map((r) => r.action)).toEqual(['netrun.use', 'netrun.end'])
    expect(readRun(g2.state)).toBeNull()
    expect(g2.state.maps.instances[map]).toBeUndefined()
    expect(g2.state.maps.at).toBeNull()
    expect(g2.k.activity.active(g2.state).map((a) => a.kind)).toEqual(['commission'])
    expect(ends('face.net')).toHaveLength(1)
    expect(ends('face.net')[0]).toMatchObject({ id, outcome: 'done', origin: ORIGIN, result: { trace: finalTrace, rounds, layer: 1, layers: 1, loot: [] } })
    expect(ends('face.net')[0]!.result.peak).toBeGreaterThanOrEqual(finalTrace)
    expect(ends('face.net')[0]!.result.located).toBeUndefined()
    expect(g2.state.reports.at(-1)!.outcome.result).toBe('done')
  })

  it('fx.gate_open：守著閘門的遭遇不用處理也開著', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: ['minion'], fx: { gate_open: true } })
    expect(netrunView(g.k, g.state)!.gate.open).toBe(true)
    commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: 'l1', x: gateCell(g)[0], y: gateCell(g)[1] } }])
    expect(uses(g)[0]!.block).toBeNull()
  })

  it('兩層的 netrun：descend 到第二層、追蹤度不歸零；第二層的閘門通過之後交回 done', () => {
    ENDS.length = 0
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 21, layers: ['guest', 'staff'], encounter: [] })
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 17 }])
    expect(netrunView(g.k, g.state)!.layer).toMatchObject({ index: 1, total: 2, name: '訪客層' })
    go(g, gateCell(g))
    expect(uses(g)[0]).toMatchObject({ id: 'descend', name: '往下一層', block: null })
    // 閘門上不能「通過」（還有下一層）
    const reports = g.commit(useNode(g.k, g.state, 'descend'))
    expect(reports[0]!.action).toBe('netrun.descend')
    expect(run(g).layer).toBe(1)
    expect(g.state.maps.at).toMatchObject({ sheet: 'l2' })
    expect(at(g)).toEqual(markerOfKind(g, 'E')[0]!.at)
    expect(trace(g)).toBe(17)
    expect(netrunView(g.k, g.state)!.layer).toMatchObject({ index: 2, total: 2, name: '員工層' })
    expect(netrunView(g.k, g.state)!.here.marker).toMatchObject({ mark: 'E' })
    // 還沒走到閘門不能再往下
    expect(() => descend(g.k, g.state)).toThrow(/閘門上/)
    go(g, gateCell(g))
    expect(uses(g)[0]).toMatchObject({ id: 'pass', name: '通過出口' })
    expect(() => descend(g.k, g.state)).toThrow(/最後一層/)
    g.commit(useNode(g.k, g.state, 'pass'))
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')).toHaveLength(1)
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { trace: 17, layer: 2, layers: 2 } })
    expect(g.state.maps.at).toBeNull()
  })

  it('目標不是通過／走完時，最後一層的閘門不能就這樣離開（這一張只收下別的目標）', () => {
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 21, encounter: [], objective: { kind: 'download', turns: 3 } })
    expect(run(g).goal).toMatchObject({ kind: 'download', turns: 3 })
    go(g, gateCell(g))
    expect(uses(g)[0]!.block).toMatch(/download/)
  })
})

describe('休息點', () => {
  it('每一層一次：感載歸零、餘韻清空，第二次灰掉；算一個探索回合；追蹤度不漲', () => {
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 5, encounter: [], layers: ['staff', 'core'] })
    commit(g, [
      { op: 'actor.track', id: 'pc', track: 'load', delta: 30 }, { op: 'actor.track', id: 'pc', track: 'afterglow', delta: 2 }, { op: 'actor.track', id: 'c1', track: 'load', delta: 5 },
      { op: 'meter', kind: 'trace', key: run(g).map, set: 20 },
    ])
    const rest = markerOfKind(g, 'r')[0]!
    go(g, rest.at)
    const before = run(g).round
    expect(uses(g)).toEqual([{ id: 'rest', name: '短休', block: null }])
    g.commit(useNode(g.k, g.state, 'rest'))
    expect(g.state.actors.pc).toMatchObject({ load: 0, afterglow: 0 })
    expect(g.state.actors.c1!.load).toBe(0)
    expect(run(g).round).toBe(before + 1)
    expect(trace(g)).toBe(20)
    expect(ext(g).rested).toEqual(['l1'])
    expect(uses(g)[0]!.block).toBe('這一層的休息點已經用過了。')
    expect(() => useNode(g.k, g.state, 'rest')).toThrow(/用過了/)
    expect(netrunView(g.k, g.state)!.rested).toBe(true)
    // 下一層的休息點是另一個
    go(g, gateCell(g))
    g.commit(useNode(g.k, g.state, 'descend'))
    go(g, markerOfKind(g, 'r')[0]!.at)
    expect(uses(g)[0]!.block).toBeNull()
  })
})

// ===================================================================================================================
// 七、追蹤度的門檻
// ===================================================================================================================

describe('追蹤度的門檻（探索中；每個只觸發一次）', () => {
  const setTrace = (g: G, v: number) => commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: v }])
  const pressures = (g: G) => g.state.reports.filter((r) => r.action === 'netrun.pressure')
  /** 在入口與旁邊一個節點之間來回走（每一次站上節點算一個探索回合）。 */
  function shuttle(g: G): () => void {
    const entry = at(g)
    const net = ext(g).graph.l1!
    const me = net.nodes.find((n) => key(n.at) === key(entry))!
    const edge = net.edges.find((e) => (e.a === me.id || e.b === me.id) && !e.oneway && !e.fragile)!
    const nb = net.nodes.find((n) => n.id === (edge.a === me.id ? edge.b : edge.a))!
    let toNode = true
    return () => {
      go(g, toNode ? nb.at : entry)
      toNode = !toNode
    }
  }

  it('到 30 記 t30（閘門 DC +2）；到 60 多一份 netrun.pressure，帶 pressure 觸發點與 setup.where，只發一次', () => {
    const { game: g } = setup({ commission: true })
    const where = { type: 'steal', face: 'net', faction: 'f_a' }
    launch(g, ACT_FACE, { ...SETUP, encounter: [], where })
    expect(ext(g).t30).toBeUndefined()
    setTrace(g, 35)
    expect(ext(g).t30).toBe(true)
    expect(ext(g).t60).toBeUndefined()
    expect(pressures(g)).toHaveLength(0)
    setTrace(g, 63)
    expect(pressures(g)).toHaveLength(1)
    expect(pressures(g)[0]!.triggers).toEqual([{ point: 'pressure', where }])
    expect(ext(g).t60).toBe(true)
    setTrace(g, 70)
    setTrace(g, 20)
    setTrace(g, 65)
    expect(pressures(g)).toHaveLength(1)
    expect(run(g).peak).toBe(70)
  })

  it('一次推過 30 與 60（AI 的效果 +20 一件事的上限）：兩個旗標都記、pressure 只發一份', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [], trace: 28 })
    setTrace(g, 64)
    expect(ext(g).t30).toBe(true)
    expect(pressures(g)).toHaveLength(1)
  })

  it('推過 90：三個探索回合之後交回 located（result.located）；倒數中降到 85 就取消', () => {
    ENDS.length = 0
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [], trace: 10 })
    const step = shuttle(g)
    setTrace(g, 95)
    expect(run(g).located).toBe(3)
    expect(netrunView(g.k, g.state)!.trace).toMatchObject({ value: 95, stage: 'located', located: 3 })
    step()
    expect(run(g).located).toBe(2)
    setTrace(g, 85)
    expect(run(g).located).toBeUndefined()
    expect(netrunView(g.k, g.state)!.trace.stage).toBe('alert')
    step()
    expect(readRun(g.state)).not.toBeNull()
    // 再被定位：三個回合到了就結束
    setTrace(g, 92)
    expect(run(g).located).toBe(3)
    const id = run(g).id
    const map = run(g).map
    step()
    step()
    expect(readRun(g.state)).not.toBeNull()
    step()
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.instances[map]).toBeUndefined()
    expect(ends('face.net')).toHaveLength(1)
    expect(ends('face.net')[0]).toMatchObject({ id, outcome: 'located', result: { located: true, trace: 92 } })
    expect(g.state.reports.at(-1)!.action).toBe('netrun.located')
  })

  it('自己去的那一趟被定位也一樣：交回 located', () => {
    ENDS.length = 0
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 6, encounter: [], trace: 91 })
    expect(run(g).located).toBe(3)
    const step = shuttle(g)
    step(); step(); step()
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'located' })
  })

  it('AI 給 trace 效果：一趟進行中收、夾在 ±20；不在網內時整筆拿掉並提醒；連動 trace_half 讓上升減半', () => {
    const { game: g } = setup({ commission: true })
    const ai = (gg: G, amount: number) => gg.k.effects.resolve([{ kind: 'trace', amount }], effectCtx(gg.k, gg.state, { source: 'ai' }))
    // 不在網內：整筆拿掉（不在任何地圖上、或站在現實的地圖上都是）
    expect(ai(g, 5).changes).toEqual([])
    commit(g, openMap(g.k, g.state, 'map_real').changes)
    const off = ai(g, 5)
    expect(off.changes).toEqual([])
    expect(JSON.stringify(off)).toContain('追蹤度只在潛進網內的一趟裡有')
    commit(g, [{ op: 'map.at', to: null }])
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    const on = ai(g, 5)
    expect(on.errors).toEqual([])
    expect(on.changes).toEqual([{ op: 'meter', kind: 'trace', key: run(g).map, delta: 5 }])
    const big = ai(g, 35)
    expect(big.changes).toEqual([{ op: 'meter', kind: 'trace', key: run(g).map, delta: 20 }])
    expect(big.clamps[0]).toMatchObject({ from: 35, to: 20 })
    expect(ai(g, -50).changes).toEqual([{ op: 'meter', kind: 'trace', key: run(g).map, delta: -20 }])
    const half = setup({ commission: true }).game
    launch(half, ACT_FACE, { ...SETUP, encounter: [], fx: { trace_half: true } })
    expect(ai(half, 10).changes).toEqual([{ op: 'meter', kind: 'trace', key: run(half).map, delta: 5 }])
    expect(ai(half, -10).changes).toEqual([{ op: 'meter', kind: 'trace', key: run(half).map, delta: -10 }])
  })
})

// ===================================================================================================================
// 八、登出、全員拔線、戰敗被接受
// ===================================================================================================================

describe('登出', () => {
  it('探索中登出：face.net 交回 retreat，netrun 交回 left；東西都帶走；畫面有「會回到進副本之前」', () => {
    ENDS.length = 0
    const face = setup({ commission: true }).game
    launch(face, ACT_FACE, { ...SETUP, encounter: [] })
    expect(netrunView(face.k, face.state)!.logout).toEqual({ block: null, note: expect.stringContaining('回到進副本之前') })
    face.commit(logout(face.k, face.state))
    expect(readRun(face.state)).toBeNull()
    expect(face.state.maps.at).toBeNull()
    expect(ends('face.net')[0]).toMatchObject({ outcome: 'retreat', origin: ORIGIN })
    expect(face.state.reports.at(-1)!.action).toBe('netrun.logout')

    const own = setup().game
    launch(own, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 5, encounter: [] })
    expect(netrunView(own.k, own.state)!.logout).toEqual({ block: null, note: null })
    own.commit(logout(own.k, own.state))
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'left', result: { trace: 0, rounds: 0, loot: [] } })
  })

  it('戰鬥中不能用登出（要用拔線）', () => {
    const { game: g } = setup({ commission: true })
    launch(g)
    standByFoe(g)
    g.commit(draftOf(g, 'fight', markerOfKind(g, 'f')[0]!.id))
    expect(netrunView(g.k, g.state)!.logout.block).toMatch(/拔線/)
    expect(() => logout(g.k, g.state)).toThrow(/拔線/)
  })

  for (const [kind, outcome] of [[ACT_FACE, 'retreat'], [ACT_NET, 'left']] as const) {
    it(`戰鬥裡全員拔線（每個人 setOut 成 jacked_out）：${kind} 交回 ${outcome}，地圖關了、狀態清了；戰鬥不是戰敗`, async () => {
      ENDS.length = 0
      const { game: g } = setup({ commission: kind === ACT_FACE })
      launch(g, kind, { ...SETUP, encounter: ['minion'] }, kind === ACT_FACE ? ORIGIN : { by: 'core' })
      standByFoe(g)
      const map = run(g).map
      g.commit(draftOf(g, 'fight', markerOfKind(g, 'f')[0]!.id))
      for (let i = 0; i < 40 && g.battle && !g.battle.result; i++) {
        const cur = g.battle.units[g.battle.order[g.battle.turn]!]!
        if (cur.side === 'ally') expect(g.battleAct({ action: 'test.net.jack' }).status).toBe('applied')
        else g.battleNext()
      }
      expect(g.battle!.result!.outcome).toBe('jack_out')
      await g.finishBattle()
      expect(readRun(g.state)).toBeNull()
      expect(g.state.maps.instances[map]).toBeUndefined()
      expect(g.state.maps.at).toBeNull()
      expect(ends(kind)).toHaveLength(1)
      expect(ends(kind)[0]).toMatchObject({ outcome })
      expect(g.pendingDefeat).toBeNull()
      expect(ends('battle')[0]!.outcome).toBe('jack_out')
    })
  }
})

describe('戰敗被接受', () => {
  it('打輸、接受（測試自己發 kind: defeat 的 activity.end）：地圖關了、狀態清了，沒有多發 face.net 的 activity.end', () => {
    ENDS.length = 0
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: ['minion'] })
    standByFoe(g)
    g.commit(draftOf(g, 'fight', markerOfKind(g, 'f')[0]!.id))
    const link = g.battle!.origin.ext!.net as Rec
    const map = run(g).map
    ENDS.length = 0
    // 戰敗的流程接受結果時發的 activity.end（origin 是那一場戰鬥的 origin）
    const origin: Origin = { by: 'netrun', ref: run(g).id, ext: { commission: 'c1', stage: 1, net: link } }
    const end = endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b1', origin, outcome: 'accept', result: {} })
    expect(end.changes.length).toBeGreaterThan(0)
    // 先把戰鬥收掉（測試不走完整的戰敗流程）
    commit(g, [{ op: 'battle', state: null, fold: true }], 'battle.abort')
    commit(g, [{ op: 'snapshot.drop', kind: 'battle' }, ...end.changes], 'defeat.accept')
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.instances[map]).toBeUndefined()
    expect(g.state.maps.at).toBeNull()
    expect(ends('face.net')).toEqual([])
  })

  it('不是這一趟的戰鬥打輸、接受：這一趟不動', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    const end = endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b9', origin: { by: 'core', ext: { net: { run: 'someone_else' } } }, outcome: 'accept', result: {} })
    expect(end.changes).toEqual([])
    expect(endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b9', origin: { by: 'core' }, outcome: 'accept', result: {} }).changes).toEqual([])
    expect(endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b9', origin: { by: 'netrun', ext: { net: { run: run(g).id } } }, outcome: 'reject', result: {} }).changes).toEqual([])
  })
})

// ===================================================================================================================
// 九、戰鬥結束的處理（直接餵戰鬥的狀態）
// ===================================================================================================================

describe('戰鬥結束（k.battle.onEnd 只認 origin.ext.net.run 是這一趟的）', () => {
  function fake(g: G, extra: Rec = {}, units: Rec = {}) {
    const net = ext(g)
    const foe = markerOfKind(g, 'f')[0]!
    return {
      foe,
      battle: {
        field: { trace: 41 }, units: { a1: { side: 'ally', ext: {} }, ...units },
        origin: { escapable: true, ext: { net: { run: run(g).id, map: run(g).map, sheet: 'l1', node: foe.id, ...extra } } },
      } as never,
      net,
    }
  }
  const changesOf = (r: ReturnType<typeof onBattleEnd>) => r?.changes ?? []
  const runAfter = (r: ReturnType<typeof onBattleEnd>) => (changesOf(r).find((c) => c.op === 'ext') as unknown as { value: Rec }).value

  it('贏了：節點改成地板並記 used、追蹤度寫回量表；被釘住的隊友自動拆釘子多算一個探索回合（N22）', () => {
    const { game: g } = setup({ commission: true })
    launch(g)
    const { battle, foe } = fake(g)
    const r = onBattleEnd(g.k, g.state, battle, 'win')!
    expect(changesOf(r)).toEqual(expect.arrayContaining([
      { op: 'meter', kind: 'trace', key: run(g).map, set: 41 },
      { op: 'map.sheet', map: run(g).map, sheet: 'l1', cells: { [key(foe.at)]: { kind: 'floor', used: true } } },
    ]))
    expect(runAfter(r)).toMatchObject({ round: 0, peak: 41 })
    const pinned = fake(g, {}, { a2: { side: 'ally', ext: { net: { unpinned: true } } } })
    const r2 = onBattleEnd(g.k, g.state, pinned.battle, 'win')!
    expect(runAfter(r2)).toMatchObject({ round: 1 })
    // 輸了、投降：什麼都不動節點（戰敗的流程接手），追蹤度照寫回
    for (const o of ['lose', 'surrender']) {
      const rr = onBattleEnd(g.k, g.state, fake(g).battle, o)!
      expect(changesOf(rr).some((c) => c.op === 'map.sheet')).toBe(false)
      expect(runAfter(rr).over).toBeUndefined()
    }
  })

  it('破解全隊脫身（fled）也算過了；jack_out 記成要收尾（委託是 retreat、自己去的是 left）', () => {
    const { game: g } = setup({ commission: true })
    launch(g)
    expect(changesOf(onBattleEnd(g.k, g.state, fake(g).battle, 'fled')).some((c) => c.op === 'map.sheet')).toBe(true)
    expect(runAfter(onBattleEnd(g.k, g.state, fake(g).battle, 'jack_out'))).toMatchObject({ over: 'retreat' })
    const own = setup().game
    launch(own, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 5 })
    expect(runAfter(onBattleEnd(own.k, own.state, fake(own).battle, 'jack_out'))).toMatchObject({ over: 'left' })
  })

  it('不是這一趟的戰鬥、或沒有這一趟：什麼都不做；沒有追蹤度的場地（沒有 field.trace）不寫量表', () => {
    const { game: g } = setup({ commission: true })
    launch(g)
    const other = fake(g, { run: 'zzz' })
    other.battle = { ...(other.battle as object), origin: { escapable: true, ext: { net: { run: 'zzz', map: run(g).map } } } } as never
    expect(onBattleEnd(g.k, g.state, other.battle, 'win')).toBeUndefined()
    expect(onBattleEnd(g.k, g.state, { field: {}, units: {}, origin: { escapable: true } } as never, 'win')).toBeUndefined()
    const noTrace = fake(g)
    ;(noTrace.battle as never as { field: Rec }).field = {}
    expect(changesOf(onBattleEnd(g.k, g.state, noTrace.battle, 'win')).some((c) => c.op === 'meter')).toBe(false)
    const idle = setup().game
    expect(onBattleEnd(idle.k, idle.state, fake(g).battle, 'win')).toBeUndefined()
  })

  it('沒有壓力條的區：戰鬥的場地沒有 trace、帶 safe', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, region: 'calm', encounter: ['minion'] })
    standByFoe(g)
    g.commit(draftOf(g, 'fight', markerOfKind(g, 'f')[0]!.id))
    expect(g.battle!.field.trace).toBeUndefined()
    expect(g.battle!.field.safe).toBe(true)
  })
})

describe('netrunView', () => {
  it('區、層、追蹤度與門檻、探索回合、目標、站的這一格、登出', () => {
    const { game: g } = setup({ commission: true })
    expect(netrunView(g.k, g.state)).toBeNull()
    launch(g, ACT_FACE, { ...SETUP, encounter: [], trace: 33 })
    const v = netrunView(g.k, g.state)!
    expect(v).toMatchObject({
      kind: 'face.net', region: { id: 'tiny', name: '小子網' }, grade: 1, round: 0,
      layer: { index: 1, total: 1, name: '員工層' }, trace: { value: 33, peak: 33, marks: [30, 60, 90], stage: 'suspect', located: null },
      goal: { kind: 'pass', done: false }, gate: { open: true, last: true }, rested: false, near: [],
    })
    expect(v.goal.text).toContain('閘門')
    expect(v.here.marker).toMatchObject({ mark: 'E' })
    expect(v.here.uses).toEqual([])
    // 站在休息點：列出短休
    go(g, markerOfKind(g, 'r')[0]!.at)
    expect(netrunView(g.k, g.state)!.here.uses.map((u) => u.id)).toEqual(['rest'])
    expect(g.gridView()!.here.uses.map((u) => u.id)).toEqual(['rest'])
  })
})

// ===================================================================================================================
// 十、鏈路、掛點、規則表、起點
// ===================================================================================================================

const DIR_OF: Record<string, 'east' | 'west' | 'south' | 'north'> = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }
const dirTo = (from: [number, number], to: [number, number]) => DIR_OF[`${to[0] - from[0]},${to[1] - from[1]}`]!
const teleport = (g: G, p: [number, number]) => commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: g.state.maps.at!.sheet, x: p[0], y: p[1] } }])

describe('鏈路：單向與走過就斷', () => {
  /** 單向、會斷的鏈路都多的圖：找第一個有 want 的種子。 */
  function twisty(want: (g: G) => boolean): G {
    for (let seed = 1; seed <= 80; seed++) {
      const g = setup({ seed }).game
      launch(g, ACT_NET, { region: 'twisty', grade: 1, faction: 'f_a', seed, layers: ['staff'] })
      if (want(g)) return g
    }
    throw new Error('找不到合適的種子')
  }
  const edges = (g: G) => ext(g).graph.l1!.edges
  const kindAtCell = (g: G, p: [number, number]) => sheetOf(g).kindAt(p[0], p[1])

  it('單向的鏈路：從對的那一邊過得去，從另一邊過不去（原因寫出來）', () => {
    const g = twisty((x) => edges(x).some((e) => e.oneway))
    const e = edges(g).find((x) => x.oneway)!
    const valve = e.cells.find((c) => kindAtCell(g, c) === 'net_valve')!
    const i = e.cells.indexOf(valve)
    const nodeAt = (id: string) => ext(g).graph.l1!.nodes.find((n) => n.id === id)!.at
    const before: [number, number] = i === 0 ? nodeAt(e.a) : e.cells[i - 1]!
    const after: [number, number] = i === e.cells.length - 1 ? nodeAt(e.b) : e.cells[i + 1]!
    const [good, bad] = e.oneway === 'ab' ? [before, after] : [after, before]
    teleport(g, good)
    expect(g.gridView()!.moves[dirTo(good, valve)]).toBeNull()
    teleport(g, bad)
    expect(g.gridView()!.moves[dirTo(bad, valve)]).toBe('這條鏈路是單向的，從這一邊過不去。')
    const r = g.gridMove(dirTo(bad, valve))
    expect(r).toMatchObject({ status: 'refused', reason: '這條鏈路是單向的，從這一邊過不去。' })
  })

  it('走過一次就斷的鏈路：走過之後那一格變成牆，回不去', () => {
    const g = twisty((x) => edges(x).some((e) => e.fragile))
    const e = edges(g).find((x) => x.fragile)!
    const bridge = e.cells.find((c) => kindAtCell(g, c) === 'net_bridge')!
    const i = e.cells.indexOf(bridge)
    const nodeAt = (id: string) => ext(g).graph.l1!.nodes.find((n) => n.id === id)!.at
    const before: [number, number] = i === 0 ? nodeAt(e.a) : e.cells[i - 1]!
    teleport(g, before)
    const r = g.gridMove(dirTo(before, bridge))
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.outcome.summary).toContain('鏈路斷了')
    expect(kindAtCell(g, bridge)).toBe('wall')
    expect(g.gridMove(dirTo(bridge, before)).status).toBe('applied')
    expect(g.gridMove(dirTo(before, bridge))).toMatchObject({ status: 'refused' })
  })
})

describe('掛點與規則表', () => {
  it('netrun.round 每個探索回合問一次（走路、休息）；netrun.close 在結束時問、變更與句子併進結束的報告（登出、通過、戰敗被接受各自帶 outcome）', () => {
    ENDS.length = 0
    const { game: g } = setup({ more: [HOOKS] })
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 5, encounter: [] })
    const n = nodes(g).filter((p) => reachable(g).has(key(p.at)) && key(p.at) !== key(at(g)))[0]!
    const path = sheetOf(g).findPath({ x: at(g)[0], y: at(g)[1] }, { x: n.at[0], y: n.at[1] })!.slice(1)
    const ticks = path.filter((p) => isNode(g, [p.x, p.y])).length
    go(g, n.at)
    expect(g.state.counters.ticks).toBe(ticks)
    expect(g.state.counters[`round_${ticks}`]).toBe(1)
    go(g, markerOfKind(g, 'r')[0]!.at)
    const before = g.state.counters.ticks!
    g.commit(useNode(g.k, g.state, 'rest'))
    expect(g.state.counters.ticks).toBe(before + 1)
    const id = run(g).id
    g.commit(logout(g.k, g.state))
    expect(g.state.flags.closed).toBe(`left:${id}`)
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('收尾（left）。')

    const lost = setup({ commission: true, more: [HOOKS] }).game
    launch(lost, ACT_FACE, { ...SETUP, encounter: [] })
    const rid = run(lost).id
    const end = endActivity(lost.k, { state: lost.state, kind: 'defeat', id: 'b1', origin: { by: 'netrun', ext: { net: { run: rid } } }, outcome: 'accept', result: {} })
    commit(lost, end.changes, 'defeat.accept')
    expect(lost.state.flags.closed).toBe(`defeat:${rid}`)
    expect(readRun(lost.state)).toBeNull()
  })

  it('netrun_rule 蓋掉內建的數字（格式不對的欄位忽略）：門檻、倒數、消退', () => {
    const t = makeGame({
      features: [...FEATURES], pc: { ext: { testdeck: 1 }, attrs: { resolve: 10 } } as never,
      content: [PACK, { id: 'rules', content: { netrun_rule: [{ id: 'default', t1: 10, t2: 20, locate_rounds: 2, decay: 5 }] } } as unknown as ContentPack],
    })
    const g = t.game
    expect(netrunRules(g.k)).toMatchObject({ t1: 10, t2: 20, t3: 90, locate_rounds: 2, decay: 5 })
    expect(ruleProblems({ t3: 'x', decay: 99, encounter: { plain: ['dragon'] }, sneak_skills: [] }).length).toBe(4)
    expect(ruleProblems({ t1: 10 })).toEqual([])
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 5, encounter: [] })
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 12 }])
    expect(ext(g).t30).toBe(true)
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 95 }])
    expect(run(g).located).toBe(2)
    expect(gateDc(g.k, ext(g))).toBe(12)
    expect(netrunView(g.k, g.state)!.trace.marks).toEqual([10, 20, 90])
  })

  it('閘門的 DC：地圖的 DC，追蹤度到過 30 之後 +2', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, grade: 3, encounter: [] })
    expect(gateDc(g.k, ext(g))).toBe(16)
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 31 }])
    expect(gateDc(g.k, ext(g))).toBe(18)
  })

  it('增援：30 是一隻白蕾絲、60 是一個精英；挑不到的不給', () => {
    const { game: g } = setup({ commission: true })
    launch(g, ACT_FACE, { ...SETUP, encounter: [] })
    expect(Object.keys(reinforceOf(g.k, g.state, run(g)))).toEqual(['t30', 't60'])
    expect(reinforceOf(g.k, g.state, { ...run(g), faction: 'f_empty' })).toEqual({})
  })
})

describe('起點與層', () => {
  it('fx.near_core、fx.skip：入口改放在閘門前一個節點（離閘門只隔一段鏈路）', () => {
    for (const fx of [{ near_core: true }, { skip: true }]) {
      const { game: g } = setup({ commission: true })
      launch(g, ACT_FACE, { ...SETUP, encounter: [], fx })
      const gate = nodes(g).find((n) => key(n.at) === key(gateCell(g)))!
      const me = nodes(g).find((n) => key(n.at) === key(at(g)))!
      expect(key(at(g))).not.toBe(key(markerOfKind(g, 'E')[0]!.at))
      expect(me).toBeTruthy()
      expect(ext(g).graph.l1!.edges.some((e) => [e.a, e.b].includes(gate.id) && [e.a, e.b].includes(me.id))).toBe(true)
      expect(g.state.reports.find((r) => r.action === 'netrun.enter')!.outcome.summary).toContain('直接到了閘門前面')
    }
  })

  it('自己去的那一趟：下一層的第一步也帶 enter_floor（名字是那一層的）', () => {
    const { game: g } = setup()
    launch(g, ACT_NET, { region: 'tiny', grade: 1, faction: 'f_a', seed: 21, layers: ['guest', 'staff'], encounter: [] })
    go(g, gateCell(g))
    g.commit(useNode(g.k, g.state, 'descend'))
    const n = nodes(g).filter((p) => reachable(g).has(key(p.at)) && key(p.at) !== key(at(g)))[0]!
    const before = g.state.reports.length
    go(g, n.at)
    const triggers = g.state.reports.slice(before).flatMap((r) => r.triggers ?? [])
    expect(triggers).toEqual([{ point: 'enter_floor', where: expect.objectContaining({ layer: '員工層' }) }])
    expect(run(g).entered).toEqual(['l1', 'l2'])
  })

  it('整筆給的區（別的功能自己帶規則來開一趟）：用它自己的規則；格式壞的擋下', () => {
    const { game: g } = setup()
    launch(g, ACT_NET, { region: { ...TINY, id: 'my_maze', name: '自己的區', size: [9, 7] }, grade: 1, faction: 'f_a', seed: 5, encounter: [] })
    expect(run(g).region).toBe('my_maze')
    expect(netrunView(g.k, g.state)!.region).toEqual({ id: 'my_maze', name: '自己的區' })
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 5 }])
    expect(trace(g)).toBe(5)
    const bad = setup().game
    expect(() => bad.launch(ACT_NET, { region: { ...TINY, size: 3 }, grade: 1 })).toThrow(/格式不對/)
  })
})
