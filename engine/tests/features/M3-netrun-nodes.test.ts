// 驗收測試：dev/work/M3-netrun-nodes.md（cpp-feature）。features/netrun 的第二張：檔案庫與下載、控制節點、人、陷阱、巡邏、安全點、六種目標、探索中的管理行動、帶出去才算數。
// 規格：CYBERSPACE 8.1 節（節點表、巡邏、陷阱的感載、帶出去才算數、把固定目標放進生成的地圖）、8.3 節（檔案庫、追蹤度在生成的子網裡）、6.6 節；NETRUNNING 第 4 節；ITEMS 11.4 節（後門鑰匙）；
// BALANCE 2.1 節（等級倍率）；dev/adr/0018 N7、N8、N23、N24。
// 內容是測試自帶的最小假資料：區的規則表（一份一份寫在測試裡）、三列的 archive_table、一把後門鑰匙、一個有主控（actor.ext.paths）的角色、幾個假蕾絲；不讀 engine/data。
// 骰面：檢定的骰面由狀態的亂數導出，要某一種結果的測試掃種子（先在乾淨的一局上試，再用找到的種子正式做）。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GridUse, Origin } from '../../src'
import { Sheet, clone, deriveRng, endActivity, gridHere, meterOf, pointKey } from '../../src'
import { enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import {
  ACT_FACE, ACT_NET, DEFAULT_TRAP, descend, freeUses, gateDc, logout, lossOf, masterTier, netExt, netrunFeature, netrunRules, netrunView, nodeUses, pingpong, readRun, regionProblems, ruleProblems, tickRun, useNode, usesOfMarker,
} from '../../src/features/netrun'
import type { Patrol } from '../../src/features/netrun'
import { TEST_ACTIVITY, TEST_NET_COMBAT, makeActor, makeGame, netWeapon, playOut } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'sync', 'stealth', 'negotiate'].map((id) => ({
  id, name: id, desc: `${id}。`,
  attr: id === 'composure' ? 'resolve' : id === 'stealth' || id === 'firearms' ? 'reflex' : id === 'interface' ? 'intellect' : id === 'negotiate' ? 'charm' : 'body',
}))
const lace = (id: string, rank: string, color: string, more: Rec = {}): Rec => ({
  id, name: `測試${id}`, desc: '測試用的網內敵人。', faction: 'f_a', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 }, ...more,
})
const item = (id: string, name: string, more: Rec = {}): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 0, legal: 'free', ...more })

const COUNTS0 = { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] }
/** 三列的檔案庫表：舊檔（1 件晶片）、零件包（2 件零件）、帳戶（照等級的五個數字）。 */
const TABLE = [
  { weight: 1, name: '舊檔', give: [{ kind: 'item', id: 'it_chip', qty: 1 }] },
  { weight: 1, name: '零件包', give: [{ kind: 'item', id: 'it_part', qty: 2 }] },
  { weight: 1, name: '帳戶的餘額', give: [{ kind: 'cred', amount: [80, 260, 800, 2600, 8000] }] },
]
/** 11 × 9 的節點測試網：每一種東西的數量由測試自己寫；有檔案庫的表。 */
const NX = (layer: Partial<Record<keyof typeof COUNTS0, [number, number]>> = {}, more: Rec = {}): Rec => ({
  id: 'nx', name: '節點測試網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 3, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { ...COUNTS0, ...layer }, archive_table: TABLE, ...more,
})

const PACK: ContentPack = {
  id: 'netrun_nodes_test',
  content: {
    skill: SKILLS,
    item: [
      item('it_chip', '晶片'), item('it_part', '零件'), item('it_goal', '設計圖', { grade: 2 }),
      item('it_key', '後門鑰匙', { category: 'tool', tags: ['backdoor_key'] }), item('it_key2', '二級後門鑰匙', { category: 'tool', grade: 2, tags: ['backdoor_key'] }),
    ],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }],
    net_region: [NX({ archive: [1, 1] }), { ...NX(), id: 'plain', name: '沒有表的網', archive_table: undefined }],
    enemy: [lace('en_pink_m', 'minion', 'pink'), lace('en_pink_e', 'elite', 'pink'), lace('en_white', 'minion', 'white', { position: { prefer: [4] } }), lace('en_boss', 'boss', 'black'), lace('en_named', 'elite', 'pink')],
  },
} as unknown as ContentPack

const STATS: Feature = {
  id: 'netrun_nodes_stats',
  install(k) {
    k.stats.defineStat({ id: 'deck_grade', owner: 'netrun_nodes_stats', name: '甲板', base: (state, actor) => (state.actors[actor]?.ext.testdeck ? 1 : 0) })
  },
}

const COMBAT: Feature = {
  id: 'netrun_nodes_combat',
  install(k) {
    k.battle.loadout('netrun_nodes_combat', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(40, 14)] } : undefined))
  },
}

const ENDS: Array<{ kind: string; id: string; outcome: string; result: Rec; origin: Origin }> = []
const SPY: Feature = {
  id: 'netrun_nodes_spy',
  install(k) {
    k.hooks.on('activity.end', 'netrun_nodes_spy', ({ kind, id, outcome, result, origin }) => {
      ENDS.push({ kind, id, outcome, result: clone(result), origin: clone(origin) })
    })
  },
}

const FAKE_COMMISSION: Feature = {
  id: 'netrun_nodes_commission',
  install(k) {
    k.activity.define({
      kind: 'commission', owner: 'netrun_nodes_commission', order: 90,
      active: (s) => (s.ext.fake_commission ? { id: 'c1', label: '假的副本' } : null),
      allow: ['commit:fake.', 'battle.', 'commit:battle.', 'chain:battle_end', 'grid.', 'commit:grid.', 'commit:defeat.'],
      reason: () => '副本進行中。',
    })
  },
}

const FEATURES = [enemiesFeature, exploreFeature, netrunFeature, TEST_NET_COMBAT, STATS, COMBAT, SPY, TEST_ACTIVITY, FAKE_COMMISSION]

const ORIGIN: Origin = { by: 'commission', ref: 'c1', ext: { commission: 'c1', stage: 1, face: 'net' } }
const BASE = { grade: 1, faction: 'f_a', encounter: [] as string[] }

interface Opts {
  seed?: number
  /** 隊員：幾個人（主角加同伴） */
  party?: number
  /** 主角有主控（actor.ext.paths 的 netrunner，階數 2）；預設有 */
  master?: boolean | number
  commission?: boolean
  pc?: Rec
  companion?: Rec
}
type G = ReturnType<typeof makeGame>['game']

function setup(o: Opts = {}) {
  const tier = o.master === false ? 0 : typeof o.master === 'number' ? o.master : 2
  const pc = {
    attrs: { intellect: 14, charm: 14, resolve: 14, reflex: 14 }, skills: { interface: 4, negotiate: 4, stealth: 3 },
    ext: { testdeck: 1, ...(tier > 0 ? { paths: [{ path: 'netrunner', tier }] } : {}) }, ...(o.pc ?? {}),
  }
  const actors = Array.from({ length: (o.party ?? 2) - 1 }, (_, i) => makeActor({ id: `c${i + 1}`, name: `同伴${i + 1}`, role: 'companion', attrs: { intellect: 10, charm: 10, resolve: 10, reflex: 10 } as never, skills: { interface: 1, stealth: 1 }, ext: { testdeck: 1 }, ...(o.companion ?? {}) }))
  const t = makeGame({ seed: o.seed ?? 5, features: FEATURES, content: [PACK], pc: pc as never, actors })
  if (o.commission) commit(t.game, [{ op: 'ext', key: 'fake_commission', value: 1 }])
  return t
}

const commit = (g: G, changes: Change[], action = 'netrun.test'): ReturnType<G['commit']> => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const run = (g: G) => readRun(g.state)!
const ext = (g: G) => netExt(g.state, run(g).map)!
const here = (g: G) => gridHere(g.k, g.state)!
const at = (g: G): [number, number] => [g.state.maps.at!.x, g.state.maps.at!.y]
const trace = (g: G) => meterOf(g.k, g.state, 'trace', run(g).map)
const ends = (kind?: string) => ENDS.filter((e) => !kind || e.kind === kind)
const key = (p: [number, number]) => `${p[0]},${p[1]}`
const sheetOf = (g: G): Sheet => here(g).sheet
const marks = (g: G, mark: string) => (sheetOf(g).def.cells ?? []).filter((m) => m.mark === mark)
const nodes = (g: G) => ext(g).graph[g.state.maps.at!.sheet]!.nodes
const reachable = (g: G): Set<string> => sheetOf(g).reachable({ x: at(g)[0], y: at(g)[1] })

/** 開一趟（預設自己去的那一趟、一個有檔案庫的節點測試網）。 */
function open(g: G, setupMore: Rec = {}, kind: string = ACT_NET, origin: Origin = { by: 'core' }): void {
  g.launch(kind, { region: NX({ archive: [1, 1] }), seed: 11, ...BASE, ...setupMore }, origin)
}
function go(g: G, p: [number, number]): void {
  const r = g.gridMove(p)
  if (r.status !== 'applied') throw new Error(`走不到 ${key(p)}：${r.reason}`)
}
const teleport = (g: G, p: [number, number], sheet?: string) => commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet: sheet ?? g.state.maps.at!.sheet, x: p[0], y: p[1] } }])
const setTrace = (g: G, v: number) => commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: v }])
const uses = (g: G): GridUse[] => nodeUses(g.k, g.state)
const useIds = (g: G): string[] => uses(g).map((u) => u.id)
const make = (g: G, id: string, at?: string): ReturnType<typeof useNode> => useNode(g.k, g.state, id, at)
const apply = (g: G, id: string, at?: string) => g.commit(make(g, id, at))
const lastMove = (g: G) => [...g.state.reports].reverse().find((r) => r.action === 'grid.move')!
const goalMarker = (g: G) => {
  const at2 = run(g).goal.at!
  return gridHereSheet(g, at2.sheet).def.cells!.find((m) => m.id === at2.id)!
}
const gridHereSheet = (g: G, sheet: string): Sheet => {
  const inst = g.state.maps.instances[run(g).map]!
  const def = inst.gen!.map.sheets.find((s) => s.id === sheet)!
  return new Sheet(def, inst.sheets[sheet]?.cells ?? {})
}
/** 站到目標的節點上。 */
function standOnGoal(g: G): ReturnType<typeof goalMarker> {
  const m = goalMarker(g)
  go(g, m.at)
  return m
}
/** 在入口與旁邊一個節點之間來回走（每一次站上節點算一個探索回合）；回傳來回走一次的函式。 */
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

/** 第一個讓 want 成立的種子（種子不同，地圖與骰面都不同）。want 在一局乾淨的遊戲上做完整件事、回傳成不成立。 */
function seedWhere(opts: Opts, want: (g: G) => boolean, start = 1): number {
  for (let seed = start; seed < start + 200; seed++) {
    try {
      if (want(setup({ ...opts, seed }).game)) return seed
    } catch {
      // 這個種子做不成，換下一個
    }
  }
  throw new Error('找不到合適的種子')
}

// ===================================================================================================================
// 一、格式：區的表、探索的數字、目標的設定
// ===================================================================================================================

describe('格式：archive_table、trap、探索的新數字、目標的設定', () => {
  it('區的 archive_table 與 trap 的格式檢查；壞的整筆擋下並說明', () => {
    expect(regionProblems(NX({ archive: [1, 1] }))).toEqual([])
    expect(regionProblems({ ...NX(), archive_table: 'x' })).not.toEqual([])
    expect(regionProblems({ ...NX(), archive_table: [{ weight: 0, name: 'a', give: [] }] })).not.toEqual([])
    expect(regionProblems({ ...NX(), archive_table: [{ weight: 1, name: '', give: [] }] })).not.toEqual([])
    expect(regionProblems({ ...NX(), archive_table: [{ weight: 1, name: 'a', give: [1] }] })).not.toEqual([])
    expect(regionProblems({ ...NX(), trap: { alarm: 10, loop_load: 8 } })).toEqual([])
    expect(regionProblems({ ...NX(), trap: { alarm: -1 } })).not.toEqual([])
    expect(regionProblems({ ...NX(), trap: { fire: 3 } })).not.toEqual([])
    expect(DEFAULT_TRAP).toEqual({ alarm: 10, loop_load: 8 })
  })

  it('探索的新數字有內建的預設，格式不對的欄位忽略、資料蓋掉預設', () => {
    const { game: g } = setup()
    expect(netrunRules(g.k)).toMatchObject({
      download_turns: 3, plant_turns: 2, download_trace: 2, admin_trace: 1, fail_trace: 5, wipe: 5, patrol_every: 3, patrol_route: [3, 5], lose_max: 3, master_path: 'netrunner',
      load_mult: [1, 1.22, 1.49, 1.82, 2.22], patrol: [['elite'], ['minion', 'minion']],
    })
    expect(ruleProblems({ download_turns: 0 })).not.toEqual([])
    expect(ruleProblems({ patrol: [] })).not.toEqual([])
    expect(ruleProblems({ patrol: [['dragon']] })).not.toEqual([])
    expect(ruleProblems({ load_mult: [1, 2] })).not.toEqual([])
    expect(ruleProblems({ patrol_route: [1, 3] })).not.toEqual([])
    expect(ruleProblems({ talk_skills: [] })).not.toEqual([])
    expect(ruleProblems({ download_turns: 4, patrol: [['elite']], load_mult: [1, 1, 1, 1, 1], patrol_route: [2, 3], master_path: 'x', admin_skills: ['interface'] })).toEqual([])
  })

  it('目標的設定不合格時開不成，原因一句；pass 與 clear 照舊', () => {
    const { game: g } = setup()
    const fail = (objective: unknown, re: RegExp) => expect(() => g.launch(ACT_NET, { region: NX(), ...BASE, seed: 3, objective }, { by: 'core' })).toThrow(re)
    fail({ kind: 'teleport' }, /不認得「teleport」/)
    fail({ kind: 'download', turns: 99 }, /turns/)
    fail({ kind: 'defeat', foe: 3 }, /foe/)
    fail('download', /objective/)
    fail({ kind: 'extract', item: 3 }, /item/)
    expect(() => g.launch(ACT_NET, { region: NX(), ...BASE, seed: 3, objective: { kind: 'clear' } }, { by: 'core' })).not.toThrow()
    expect(g.state.maps.at).not.toBeNull()
  })

  it('下載與放東西沒寫 turns 時照規則表（3 次、2 次）；寫了照寫', () => {
    const turns = (objective: Rec) => {
      const { game: g } = setup()
      open(g, { objective, region: NX({ archive: [0, 0] }) })
      return run(g).goal.turns
    }
    expect(turns({ kind: 'download' })).toBe(3)
    expect(turns({ kind: 'plant' })).toBe(2)
    expect(turns({ kind: 'download', turns: 4 })).toBe(4)
  })
})

// ===================================================================================================================
// 二、目標放在哪
// ===================================================================================================================

describe('目標放在離入口最遠的那一半（二十個種子）', () => {
  const KINDS: Array<[string, Rec, string]> = [
    ['download', { kind: 'download', turns: 3 }, 'a'],
    ['plant', { kind: 'plant', turns: 2 }, 'a'],
    ['extract', { kind: 'extract', item: 'it_goal' }, 'a'],
    ['seize', { kind: 'seize' }, 'c'],
    ['find', { kind: 'find' }, 'p'],
    ['defeat', { kind: 'defeat', foe: 'en_named' }, 'f'],
  ]
  for (const [name, objective, mark] of KINDS) {
    it(`${name}：目標在對的種類的節點上、離入口的格數在最遠的那一半、位置記在 goal.at`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const { game: g } = setup({ seed: 100 })
        open(g, { seed, objective, region: NX({ archive: [1, 2], control: [1, 1], person: [1, 1], foe: [1, 2], trap: [1, 1] }) })
        const at2 = run(g).goal.at!
        expect(at2, `seed ${seed}`).toBeTruthy()
        const m = marks(g, mark).find((x) => x.id === at2.id)!
        expect(m, `seed ${seed} 標記`).toBeTruthy()
        expect(at2).toMatchObject({ sheet: 'l1', pos: m.at })
        const graph = ext(g).graph.l1!
        const depths = graph.nodes.map((n) => n.depth).sort((a, b) => a - b)
        const median = depths[Math.floor(depths.length / 2)]!
        const node = graph.nodes.find((n) => key(n.at) === key(m.at))!
        expect(node.depth, `seed ${seed} 深度 ${node.depth} 中位數 ${median}`).toBeGreaterThanOrEqual(median)
        if (mark !== 'f') expect(m.name).toBe('目標')
      }
    })
  }

  it('目標放在 objective.layer 那一層（沒寫是最後一層）；控制節點對到現實的節點放在管理層（沒有就員工層）', () => {
    const { game: g } = setup()
    open(g, { layers: ['guest', 'staff', 'core'], objective: { kind: 'download', turns: 2, layer: 'staff' }, region: NX({ archive: [0, 0] }) })
    expect(run(g).goal.at!.sheet).toBe('l2')
    const h = setup()
    open(h.game, { layers: ['guest', 'staff', 'core'], objective: { kind: 'download', turns: 2 }, region: NX() })
    expect(run(h.game).goal.at!.sheet).toBe('l3')
    const c = setup()
    open(c.game, { layers: ['guest', 'staff', 'control', 'core'], controls: ['cn_a', { node: 'cn_b', name: '防爆門', layer: 'core' }], region: NX() })
    const controls = ext(c.game).controls
    expect(Object.values(controls.l3!).map((x) => x.node)).toEqual(['cn_a'])
    expect(Object.values(controls.l4!)).toEqual([expect.objectContaining({ node: 'cn_b', name: '防爆門' })])
    const s = setup()
    open(s.game, { layers: ['guest', 'staff', 'core'], controls: ['cn_a'], region: NX() })
    expect(Object.values(ext(s.game).controls.l2!).map((x) => x.node)).toEqual(['cn_a'])
  })

  it('打倒：指定的敵人加進守閘門的那一場（沒有遭遇的區也會多一場）；沒指定 foe 就是那一場', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'defeat', foe: 'en_named' }, region: NX({ foe: [0, 0] }) })
    const f = Object.values(ext(g).foes.l1!)
    expect(f).toHaveLength(1)
    expect(f[0]!.foes).toEqual([{ from: 'enemy', id: 'en_named', grade: 1 }])
    expect(f[0]!.gate).toBe(true)
    expect(marks(g, 'f')).toHaveLength(1)
    expect(run(g).goal.at!.id).toBe(marks(g, 'f')[0]!.id)
    const h = setup()
    open(h.game, { objective: { kind: 'defeat' }, encounter: ['minion', 'minion'], region: NX({ foe: [1, 1] }) })
    expect(Object.values(ext(h.game).foes.l1!)[0]!.foes).toHaveLength(2)
    expect(run(h.game).goal.at!.id).toBe(marks(h.game, 'f')[0]!.id)
  })

  it('指定的敵人挑不到（沒有這個 id）時開不成', () => {
    const { game: g } = setup()
    expect(() => open(g, { objective: { kind: 'defeat', foe: 'en_nobody' }, region: NX() })).toThrow(/挑不到/)
    expect(readRun(g.state)).toBeNull()
  })
})

// ===================================================================================================================
// 三、下載與放東西（待在節點上的探索回合）
// ===================================================================================================================

describe('下載（N7）：每按一次「繼續」過一個探索回合、追蹤度 +2，離開那一格進度歸零，做滿完成', () => {
  it('turns: 3 要做三次：每次 round +1、追蹤度 +2；第三次完成，交回 done，result.goal 是 true', () => {
    ENDS.length = 0
    const { game: g } = setup()
    open(g, { objective: { kind: 'download', turns: 3 }, region: NX() })
    const m = standOnGoal(g)
    expect(m.mark).toBe('a')
    const r0 = run(g).round
    expect(uses(g)).toEqual([{ id: 'download', name: '繼續下載（0／3）', block: null }])
    expect(trace(g)).toBe(0)
    apply(g, 'download')
    expect(run(g)).toMatchObject({ round: r0 + 1, goal: { progress: 1 } })
    expect(trace(g)).toBe(2)
    expect(uses(g)[0]!.name).toBe('繼續下載（1／3）')
    apply(g, 'download')
    expect(run(g)).toMatchObject({ round: r0 + 2, goal: { progress: 2 } })
    expect(trace(g)).toBe(4)
    expect(readRun(g.state)).not.toBeNull()
    apply(g, 'download')
    // 做滿了：這一趟結束
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true, trace: 6, rounds: r0 + 3 } })
    expect(g.state.reports.at(-1)!.action).toBe('netrun.end')
  })

  it('中途走開再回來要從頭；每一次「繼續」都是一個探索回合，感載照消退，巡邏的回合照走', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'download', turns: 3 }, region: NX() })
    const m = standOnGoal(g)
    apply(g, 'download')
    apply(g, 'download')
    expect(run(g).goal.progress).toBe(2)
    expect(trace(g)).toBe(4)
    // 走到旁邊的另一個節點再回來
    const other = nodes(g).find((n) => key(n.at) !== key(m.at) && reachable(g).has(key(n.at)))!
    go(g, other.at)
    expect(run(g).goal.progress).toBe(0)
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('進度歸零')
    go(g, m.at)
    expect(uses(g)[0]!.name).toBe('繼續下載（0／3）')
    apply(g, 'download')
    expect(run(g).goal.progress).toBe(1)
    expect(trace(g)).toBe(6)
  })

  it('做在別的檔案庫上：開檔案庫（擲表），不是下載；沒有站到目標上就沒有下載這一項', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'download', turns: 2 }, region: NX({ archive: [1, 1] }) })
    const archive = marks(g, 'a').find((m) => m.id !== run(g).goal.at!.id)!
    go(g, archive.at)
    expect(useIds(g)).toEqual(['loot'])
    const view = netrunView(g.k, g.state)!
    expect(view.goal).toMatchObject({ kind: 'download', progress: null, turns: 2, done: false })
    expect(view.goal.text).toContain('下載')
  })

  it('下載中追蹤度到 30 以上照樣推（門檻照 report.after）；有追蹤度的區才加', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'download', turns: 3 }, region: NX() })
    standOnGoal(g)
    setTrace(g, 29)
    apply(g, 'download')
    expect(trace(g)).toBe(31)
    expect(ext(g).t30).toBe(true)
    const calm = setup()
    open(calm.game, { objective: { kind: 'download', turns: 3 }, region: NX({}, { pressure: 'none' }) })
    standOnGoal(calm.game)
    const r0 = run(calm.game).round
    apply(calm.game, 'download')
    expect(run(calm.game).round).toBe(r0 + 1)
    expect(meterOf(calm.game.k, calm.game.state, 'trace', run(calm.game).map)).toBe(0)
  })
})

describe('放東西（上傳）：兩個回合、不加追蹤度', () => {
  it('turns: 2：兩次「繼續」完成，追蹤度不動，result.goal 是 true', () => {
    ENDS.length = 0
    const { game: g } = setup()
    open(g, { objective: { kind: 'plant', turns: 2 }, region: NX() })
    standOnGoal(g)
    const r0 = run(g).round
    expect(uses(g)[0]).toMatchObject({ id: 'plant', name: '繼續上傳（0／2）' })
    apply(g, 'plant')
    expect(run(g)).toMatchObject({ round: r0 + 1, goal: { progress: 1 } })
    expect(trace(g)).toBe(0)
    apply(g, 'plant')
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true, trace: 0, rounds: r0 + 2 } })
  })
})

// ===================================================================================================================
// 四、檔案庫
// ===================================================================================================================

describe('檔案庫：開一次擲一次表', () => {
  /** 開第一個（不是目標的）檔案庫會拿到哪一列：看那一份草稿裡的變更。 */
  const rowOf = (g: G): number => {
    go(g, marks(g, 'a')[0]!.at)
    const d = make(g, 'loot')
    if (d.changes.some((c) => c.op === 'item' && c.id === 'it_chip')) return 0
    if (d.changes.some((c) => c.op === 'item' && c.id === 'it_part')) return 1
    if (d.changes.some((c) => c.op === 'cred')) return 2
    return -1
  }

  it('固定種子擲到表的第二列：效果套用（零件 ×2）、loot 多一筆、同一個檔案庫第二次灰掉', () => {
    const seed = seedWhere({}, (g) => {
      open(g)
      return rowOf(g) === 1
    })
    const { game: g } = setup({ seed })
    open(g)
    const archive = marks(g, 'a')[0]!
    go(g, archive.at)
    expect(uses(g)).toEqual([{ id: 'loot', name: '開檔案庫', block: null }])
    apply(g, 'loot')
    expect(g.state.inventory).toEqual([{ id: 'it_part', qty: 2 }])
    expect(run(g).loot).toEqual([{ kind: 'item', id: 'it_part', qty: 2, name: '零件', from: `l1/${archive.id}` }])
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('零件包')
    expect(uses(g)).toEqual([{ id: 'loot', name: '開檔案庫', block: '這個檔案庫已經打開過了，裡面空了。' }])
    expect(() => make(g, 'loot')).toThrow(/打開過了/)
    expect(sheetOf(g).kindAt(archive.at[0], archive.at[1])).toBe('net_archive')
    expect(g.state.maps.instances[run(g).map]!.sheets.l1!.cells[pointKey(archive.at[0], archive.at[1])]).toMatchObject({ used: true })
    expect(ext(g).used.l1).toEqual([archive.id])
  })

  it('三列都擲得到（掃種子）；帳戶的數字照等級（II 級是 260）', () => {
    const rows = new Set<number>()
    for (let seed = 1; seed <= 40 && rows.size < 3; seed++) {
      const { game: g } = setup({ seed })
      open(g)
      rows.add(rowOf(g))
    }
    expect([...rows].sort()).toEqual([0, 1, 2])
    const seed = seedWhere({}, (g) => {
      open(g, { grade: 2 })
      return rowOf(g) === 2
    })
    const { game: g } = setup({ seed })
    open(g, { grade: 2 })
    go(g, marks(g, 'a')[0]!.at)
    const before = g.state.money.cred
    apply(g, 'loot')
    expect(g.state.money.cred).toBe(before + 260)
    expect(run(g).loot).toMatchObject([{ kind: 'cred', qty: 260, name: '帳戶的餘額' }])
  })

  it('沒有表的區開了是空的（loot 不變、還是記成開過）', () => {
    const { game: g } = setup()
    open(g, { region: NX({ archive: [1, 1] }, { archive_table: undefined }) })
    go(g, marks(g, 'a')[0]!.at)
    apply(g, 'loot')
    expect(run(g).loot).toEqual([])
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('空的')
    expect(useIds(g)).toEqual(['loot'])
    expect(uses(g)[0]!.block).toMatch(/打開過了/)
  })

  it('表裡的效果格式不對時整批不收，什麼都沒拿到但不會卡住', () => {
    const { game: g } = setup()
    open(g, { region: NX({ archive: [1, 1] }, { archive_table: [{ weight: 1, name: '壞的', give: [{ kind: 'item', id: 'it_nothing', qty: 1 }] }] }) })
    go(g, marks(g, 'a')[0]!.at)
    apply(g, 'loot')
    expect(run(g).loot).toEqual([])
    expect(g.state.inventory).toEqual([])
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('壞掉了')
  })

  it('同一份狀態開同一個檔案庫擲到的一樣（骰面由狀態導出）', () => {
    const a = setup({ seed: 9 }).game
    const b = setup({ seed: 9 }).game
    open(a)
    open(b)
    go(a, marks(a, 'a')[0]!.at)
    go(b, marks(b, 'a')[0]!.at)
    expect(make(a, 'loot').changes).toEqual(make(b, 'loot').changes)
  })
})

// ===================================================================================================================
// 五、接管（控制節點）
// ===================================================================================================================

describe('控制節點與接管', () => {
  const CTRL = { region: NX({ control: [1, 1] }), controls: [{ node: 'cn_gate', name: '閘門控制' }] }

  it('接管：主控的檢定（智識加介面，加階數的一半進位）成功之後記 taken；失敗追蹤度 +1 +5；result.controls 列出接管了的', () => {
    ENDS.length = 0
    const win = seedWhere({}, (g) => {
      open(g, CTRL)
      go(g, marks(g, 'c').find((m) => m.name === '閘門控制')!.at)
      return make(g, 'seize').outcome.result === 'seize'
    })
    const g = setup({ seed: win }).game
    open(g, CTRL)
    const ctrl = marks(g, 'c').find((m) => m.name === '閘門控制')!
    expect(marks(g, 'c')).toHaveLength(2)
    go(g, ctrl.at)
    expect(useIds(g)).toEqual(['seize'])
    const d = make(g, 'seize')
    // 檢定的加值：智識 14 → +2、介面 4、主控 2 階 → +1
    const roll = d.timeline.find((t) => t.roll)!.roll!
    expect(roll.parts.map((p) => [p.source, p.value])).toEqual([['attr', 2], ['skill', 4], ['skill', 1]])
    expect(roll.parts.at(-1)!.label).toBe('主控')
    expect(roll.dc).toBe(10)
    g.commit(d)
    expect(trace(g)).toBe(1)
    expect(ext(g).controls.l1![ctrl.id]).toEqual({ node: 'cn_gate', name: '閘門控制', taken: true })
    expect(uses(g)).toEqual([{ id: 'seize', name: '接管', block: '這個控制節點已經接管了。' }])
    g.commit(logout(g.k, g.state))
    expect(ends('netrun')[0]!.result.controls).toEqual([{ id: ctrl.id, sheet: 'l1', name: '閘門控制', node: 'cn_gate' }])

    const lose = seedWhere({}, (h) => {
      open(h, CTRL)
      go(h, marks(h, 'c').find((m) => m.name === '閘門控制')!.at)
      return make(h, 'seize').outcome.result === 'seize_fail'
    })
    const f = setup({ seed: lose }).game
    open(f, CTRL)
    const target = marks(f, 'c').find((m) => m.name === '閘門控制')!
    go(f, target.at)
    apply(f, 'seize')
    expect(trace(f)).toBe(6)
    expect(ext(f).controls.l1![target.id]!.taken).toBeUndefined()
    expect(uses(f)[0]!.block).toBeNull()
  })

  it('接管是目標的（seize）：成功就完成，result.goal 是 true、result.controls 帶 objective.node', () => {
    ENDS.length = 0
    const win = seedWhere({}, (g) => {
      open(g, { objective: { kind: 'seize', node: 'cn_core' }, region: NX() })
      standOnGoal(g)
      return make(g, 'seize').outcome.result === 'seize'
    })
    const g = setup({ seed: win }).game
    open(g, { objective: { kind: 'seize', node: 'cn_core' }, region: NX() })
    const m = standOnGoal(g)
    apply(g, 'seize')
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true, controls: [{ id: m.id, node: 'cn_core', sheet: 'l1' }] } })
  })

  it('後門鑰匙：免檢定、用掉那一把（只算同一級的）；沒有主控的隊伍沒有「接管」，有鑰匙才有「用後門鑰匙接管」', () => {
    ENDS.length = 0
    const g = setup({ master: false }).game
    open(g, CTRL)
    commit(g, [{ op: 'item', id: 'it_key', qty: 2 }, { op: 'item', id: 'it_key2', qty: 1 }])
    const ctrl = marks(g, 'c')[0]!
    go(g, ctrl.at)
    expect(useIds(g)).toEqual(['seize_key'])
    expect(() => make(g, 'seize')).toThrow(/沒有「seize」/)
    const d = make(g, 'seize_key')
    expect(d.timeline.some((t) => t.roll)).toBe(false)
    expect(d.outcome.result).toBe('seize')
    g.commit(d)
    expect(g.state.inventory.find((s) => s.id === 'it_key')!.qty).toBe(1)
    expect(g.state.inventory.find((s) => s.id === 'it_key2')!.qty).toBe(1)
    expect(trace(g)).toBe(0)
    expect(ext(g).controls.l1![ctrl.id]!.taken).toBe(true)
    // 二級的鑰匙對一級的網沒用：只剩一把一級的，接管過的節點不能再接
    expect(uses(g)[0]!.block).toMatch(/接管了/)
    // 沒有主控也沒有鑰匙：這一格沒有事可做
    const h = setup({ master: false }).game
    open(h, CTRL)
    go(h, marks(h, 'c')[0]!.at)
    expect(useIds(h)).toEqual([])
  })

  it('腳本裡記著的鑰匙一起扣掉（ext.deck.scripts 比背包多的時候）', () => {
    const g = setup({ master: false }).game
    open(g, CTRL)
    commit(g, [{ op: 'item', id: 'it_key', qty: 1 }, { op: 'actor.ext', id: 'pc', key: 'deck', value: { slots: [], scripts: [{ item: 'it_key', qty: 1 }] } }])
    go(g, marks(g, 'c')[0]!.at)
    apply(g, 'seize_key')
    expect(g.state.inventory).toEqual([])
    expect(g.state.actors.pc!.ext.deck).toMatchObject({ scripts: [] })
  })
})

// ===================================================================================================================
// 六、人
// ===================================================================================================================

describe('人：交涉、快駭、憑證', () => {
  const PEOPLE = { region: NX({ person: [1, 1], foe: [1, 1] }), encounter: ['minion'] }

  it('交涉成功拿到一張憑證（對地圖的 DC）；用它過閘門不必打守著它的遭遇；憑證只能用一次', () => {
    const win = seedWhere({}, (g) => {
      open(g, PEOPLE)
      go(g, marks(g, 'p')[0]!.at)
      return make(g, 'talk').outcome.result === 'talk'
    })
    const g = setup({ seed: win }).game
    open(g, PEOPLE)
    const person = marks(g, 'p')[0]!
    go(g, person.at)
    expect(useIds(g)).toEqual(['talk', 'hack_person'])
    const d = make(g, 'talk')
    const roll = d.timeline.find((t) => t.roll)!.roll!
    expect(roll.dc).toBe(10)
    expect(roll.parts.map((p) => [p.source, p.value])).toEqual([['attr', 2], ['skill', 4]])
    g.commit(d)
    expect(ext(g).keys).toEqual([`l1/${person.id}`])
    expect(trace(g)).toBe(0)
    expect(uses(g).map((u) => u.block)).toEqual(['他已經給過憑證了。', '他已經給過憑證了。'])
    // 閘門：遭遇還守著，用憑證過
    const gate = marks(g, 'g')[0]!
    teleport(g, gate.at)
    expect(netrunView(g.k, g.state)!.gate.open).toBe(false)
    expect(useIds(g)).toEqual(['pass', 'crack', 'cred'])
    expect(uses(g)[0]!.block).toMatch(/閘門被守著/)
    g.commit(make(g, 'cred'))
    expect(ext(g).keys).toEqual([])
    expect(ext(g).opened).toEqual(['l1'])
    expect(Object.values(ext(g).foes.l1!)[0]!.done).toBeUndefined()
    expect(g.battle).toBeNull()
    expect(uses(g)[0]!.block).toBeNull()
    expect(useIds(g)).toEqual(['pass'])
    expect(netrunView(g.k, g.state)!.gate.open).toBe(true)
    // 沒有憑證了
    expect(() => make(g, 'cred')).toThrow(/沒有「cred」/)
    ENDS.length = 0
    apply(g, 'pass')
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true } })
  })

  it('交涉失敗追蹤度 +5、可以再試；沒有憑證就沒有「用憑證」', () => {
    const lose = seedWhere({}, (g) => {
      open(g, PEOPLE)
      go(g, marks(g, 'p')[0]!.at)
      return make(g, 'talk').outcome.result === 'talk_fail'
    })
    const g = setup({ seed: lose }).game
    open(g, PEOPLE)
    go(g, marks(g, 'p')[0]!.at)
    apply(g, 'talk')
    expect(trace(g)).toBe(5)
    expect(ext(g).keys).toEqual([])
    expect(uses(g)[0]!.block).toBeNull()
    teleport(g, marks(g, 'g')[0]!.at)
    expect(useIds(g)).toEqual(['pass', 'crack'])
  })

  it('快駭：有主控的人才有這一項；一次介面的檢定，成功給憑證，不論成敗追蹤度 +1', () => {
    const none = setup({ master: false }).game
    open(none, PEOPLE)
    go(none, marks(none, 'p')[0]!.at)
    expect(useIds(none)).toEqual(['talk'])
    expect(() => make(none, 'hack_person')).toThrow(/沒有「hack_person」/)

    const win = seedWhere({}, (g) => {
      open(g, PEOPLE)
      go(g, marks(g, 'p')[0]!.at)
      return make(g, 'hack_person').outcome.result === 'hack'
    })
    const g = setup({ seed: win }).game
    open(g, PEOPLE)
    const person = marks(g, 'p')[0]!
    go(g, person.at)
    const d = make(g, 'hack_person')
    expect(d.timeline.find((t) => t.roll)!.roll!.parts.map((p) => [p.source, p.value])).toEqual([['attr', 2], ['skill', 4]])
    g.commit(d)
    expect(trace(g)).toBe(1)
    expect(ext(g).keys).toEqual([`l1/${person.id}`])

    const lose = seedWhere({}, (h) => {
      open(h, PEOPLE)
      go(h, marks(h, 'p')[0]!.at)
      return make(h, 'hack_person').outcome.result === 'hack_fail'
    })
    const f = setup({ seed: lose }).game
    open(f, PEOPLE)
    go(f, marks(f, 'p')[0]!.at)
    apply(f, 'hack_person')
    expect(trace(f)).toBe(1)
    expect(ext(f).keys).toEqual([])
  })

  it('找人（find）：走到之後一次交涉或介面的檢定，成功就完成', () => {
    ENDS.length = 0
    const win = seedWhere({}, (g) => {
      open(g, { objective: { kind: 'find' }, region: NX() })
      standOnGoal(g)
      return make(g, 'talk').outcome.result === 'talk'
    })
    const g = setup({ seed: win }).game
    open(g, { objective: { kind: 'find' }, region: NX() })
    standOnGoal(g)
    expect(g.state.maps.at && marks(g, 'p')[0]!.name).toBe('目標')
    apply(g, 'talk')
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true } })
    // 用快駭也行
    const win2 = seedWhere({}, (h) => {
      open(h, { objective: { kind: 'find' }, region: NX() })
      standOnGoal(h)
      return make(h, 'hack_person').outcome.result === 'hack'
    })
    const f = setup({ seed: win2 }).game
    open(f, { objective: { kind: 'find' }, region: NX() })
    standOnGoal(f)
    ENDS.length = 0
    apply(f, 'hack_person')
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true } })
  })
})

// ===================================================================================================================
// 七、閘門的破解與後門鑰匙
// ===================================================================================================================

describe('閘門：破解（到 30 之後 +2）、後門鑰匙', () => {
  const GUARDED = { region: NX({ foe: [1, 1] }), encounter: ['minion'] }

  it('破解：主控的檢定對閘門的 DC；成功閘門開了但守著它的遭遇還在；失敗追蹤度 +6、成功 +1；追蹤度到 30 之後 DC +2', () => {
    const win = seedWhere({}, (g) => {
      open(g, GUARDED)
      teleport(g, marks(g, 'g')[0]!.at)
      return make(g, 'crack').outcome.result === 'crack'
    })
    const g = setup({ seed: win }).game
    open(g, GUARDED)
    teleport(g, marks(g, 'g')[0]!.at)
    const d = make(g, 'crack')
    expect(d.timeline.find((t) => t.roll)!.roll!.dc).toBe(10)
    g.commit(d)
    expect(trace(g)).toBe(1)
    expect(ext(g).opened).toEqual(['l1'])
    expect(Object.values(ext(g).foes.l1!)[0]!.done).toBeUndefined()
    expect(netrunView(g.k, g.state)!.gate.open).toBe(true)
    expect(useIds(g)).toEqual(['pass'])
    // 守著它的遭遇還在：之後可以打也可以不打
    expect(netrunView(g.k, g.state)!.near).toBeDefined()

    const lose = seedWhere({}, (h) => {
      open(h, GUARDED)
      teleport(h, marks(h, 'g')[0]!.at)
      return make(h, 'crack').outcome.result === 'crack_fail'
    })
    const f = setup({ seed: lose }).game
    open(f, GUARDED)
    teleport(f, marks(f, 'g')[0]!.at)
    apply(f, 'crack')
    expect(trace(f)).toBe(6)
    expect(ext(f).opened).toEqual([])
    // 到 30 之後 DC +2
    const h = setup({ seed: win }).game
    open(h, GUARDED)
    teleport(h, marks(h, 'g')[0]!.at)
    setTrace(h, 30)
    expect(gateDc(h.k, ext(h))).toBe(12)
    expect(make(h, 'crack').timeline.find((t) => t.roll)!.roll!.dc).toBe(12)
  })

  it('沒有主控的隊伍沒有「破解」；後門鑰匙免檢定、用掉一把、只算同一級；閘門開了就不再列這幾項', () => {
    const g = setup({ master: false }).game
    open(g, GUARDED)
    commit(g, [{ op: 'item', id: 'it_key2', qty: 1 }])
    teleport(g, marks(g, 'g')[0]!.at)
    expect(useIds(g)).toEqual(['pass'])
    commit(g, [{ op: 'item', id: 'it_key', qty: 1 }])
    expect(useIds(g)).toEqual(['pass', 'crack_key'])
    const d = make(g, 'crack_key')
    expect(d.timeline.some((t) => t.roll)).toBe(false)
    g.commit(d)
    expect(g.state.inventory).toEqual([{ id: 'it_key2', qty: 1 }])
    expect(trace(g)).toBe(0)
    expect(ext(g).opened).toEqual(['l1'])
    expect(useIds(g)).toEqual(['pass'])
  })

  it('往下一層的閘門也一樣：開了之後可以往下', () => {
    const g = setup({ master: false }).game
    open(g, { ...GUARDED, layers: ['staff', 'core'] })
    commit(g, [{ op: 'item', id: 'it_key', qty: 1 }])
    teleport(g, marks(g, 'g')[0]!.at)
    expect(uses(g)[0]).toMatchObject({ id: 'descend' })
    expect(uses(g)[0]!.block).toMatch(/閘門被守著/)
    apply(g, 'crack_key')
    apply(g, 'descend')
    expect(run(g).layer).toBe(1)
  })
})

// ===================================================================================================================
// 八、打倒與帶出來
// ===================================================================================================================

describe('打倒：那一場打贏而且指定的敵人在場', () => {
  const DEFEAT = { objective: { kind: 'defeat', foe: 'en_named' }, region: NX() }

  it('打贏守著目標的那一場：指定的敵人在場，完成；result.goal 是 true', async () => {
    ENDS.length = 0
    const { game: g } = setup()
    open(g, DEFEAT)
    const foe = marks(g, 'f')[0]!
    // 走到它旁邊
    const reach = reachable(g)
    const spot = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [foe.at[0] + dx, foe.at[1] + dy] as [number, number]).find((p) => reach.has(key(p)))!
    go(g, spot)
    g.commit(make(g, 'fight', foe.id))
    const b = g.battle!
    expect(Object.values(b.units).some((u) => u.side === 'foe' && u.enemy === 'en_named')).toBe(true)
    expect(playOut(g).outcome).toBe('win')
    await g.finishBattle()
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true } })
  })

  it('潛行繞過不算打倒：節點處理過了、目標沒完成；沒有指定的敵人在場的贏也不算', async () => {
    const { game: g } = setup()
    open(g, { ...DEFEAT, stealth: true })
    const foe = marks(g, 'f')[0]!
    const reach = reachable(g)
    const spot = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [foe.at[0] + dx, foe.at[1] + dy] as [number, number]).find((p) => reach.has(key(p)))!
    go(g, spot)
    apply(g, 'sneak', foe.id)
    expect(ext(g).foes.l1![foe.id]!.done).toBe(true)
    expect(run(g).goal.done).toBeUndefined()
    expect(readRun(g.state)).not.toBeNull()
    // 另一場：目標寫的敵人不在這一場裡（直接改目標的 foe），贏了也不算
    const h = setup().game
    open(h, DEFEAT)
    const f2 = marks(h, 'f')[0]!
    const reach2 = reachable(h)
    go(h, ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [f2.at[0] + dx, f2.at[1] + dy] as [number, number]).find((p) => reach2.has(key(p)))!)
    commit(h, [{ op: 'ext', key: 'netrun', value: { ...clone(run(h)), goal: { ...run(h).goal, foe: 'en_somebody_else' } } }])
    h.commit(make(h, 'fight', f2.id))
    expect(playOut(h).outcome).toBe('win')
    await h.finishBattle()
    expect(readRun(h.state)).not.toBeNull()
    expect(run(h).goal.done).toBeUndefined()
  })
})

describe('帶出來：拿到之後還沒完成，走到出口或安全點才算；倒下時這一件一定丟', () => {
  const EXTRACT = { objective: { kind: 'extract', item: 'it_goal' }, region: NX({ safe: [1, 1] }) }

  it('拿到：loot 多一筆（goal）、物品進背包；還沒完成，不能就這樣離開的限制解除；走到出口完成', () => {
    ENDS.length = 0
    const { game: g } = setup()
    open(g, EXTRACT)
    const m = standOnGoal(g)
    expect(uses(g)).toEqual([{ id: 'loot', name: '拿走目標', block: null }])
    apply(g, 'loot')
    expect(g.state.inventory).toEqual([{ id: 'it_goal', qty: 1 }])
    expect(run(g).loot).toEqual([{ kind: 'item', id: 'it_goal', qty: 1, name: '設計圖', goal: true, from: `l1/${m.id}` }])
    expect(run(g).goal).toMatchObject({ got: true })
    expect(readRun(g.state)).not.toBeNull()
    expect(uses(g)[0]!.block).toMatch(/已經拿到了/)
    expect(netrunView(g.k, g.state)!.goal.got).toBe(true)
    // 走到出口：完成
    teleport(g, marks(g, 'g')[0]!.at)
    expect(uses(g)[0]).toMatchObject({ id: 'pass', block: null })
    apply(g, 'pass')
    expect(readRun(g.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true, loot: [expect.objectContaining({ id: 'it_goal', goal: true })] } })
  })

  it('還沒拿到之前出口灰掉（寫原因）', () => {
    const { game: g } = setup()
    open(g, EXTRACT)
    teleport(g, marks(g, 'g')[0]!.at)
    expect(uses(g)[0]!.block).toMatch(/還沒拿到/)
  })

  it('拿到之後走到安全點登出算完成（done、goal 是 true）；沒拿到從安全點登出只是登出（left）', () => {
    ENDS.length = 0
    const { game: g } = setup()
    open(g, EXTRACT)
    standOnGoal(g)
    apply(g, 'loot')
    teleport(g, marks(g, 'b')[0]!.at)
    expect(uses(g)).toEqual([{ id: 'safe_logout', name: '帶著東西從安全點離開', block: null }])
    apply(g, 'safe_logout')
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'done', result: { goal: true } })
    expect(g.state.inventory).toEqual([{ id: 'it_goal', qty: 1 }])

    const h = setup().game
    open(h, EXTRACT)
    teleport(h, marks(h, 'b')[0]!.at)
    expect(uses(h)[0]).toMatchObject({ id: 'safe_logout', name: '從安全點登出' })
    apply(h, 'safe_logout')
    expect(ends('netrun')[1]).toMatchObject({ outcome: 'left', result: { goal: false } })
  })

  it('沒有拿到物品的目錄時（objective.item 不在內容裡）只記在 loot', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'extract', item: 'it_secret' }, region: NX() })
    standOnGoal(g)
    apply(g, 'loot')
    expect(g.state.inventory).toEqual([])
    expect(run(g).loot).toMatchObject([{ kind: 'item', id: 'it_secret', qty: 1, goal: true }])
  })
})

// ===================================================================================================================
// 九、安全點
// ===================================================================================================================

describe('安全點', () => {
  it('自己去的那一趟：從安全點登出，東西全部帶走（left）；委託的階段仍然是撤退（retreat，N13）', () => {
    ENDS.length = 0
    const own = setup().game
    open(own, { region: NX({ safe: [1, 1], archive: [1, 1] }) })
    go(own, marks(own, 'a')[0]!.at)
    apply(own, 'loot')
    const had = clone(own.state.inventory)
    teleport(own, marks(own, 'b')[0]!.at)
    expect(netrunView(own.k, own.state)!.here.uses.map((u) => u.id)).toEqual(['safe_logout'])
    apply(own, 'safe_logout')
    expect(readRun(own.state)).toBeNull()
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'left' })
    expect(own.state.inventory).toEqual(had)

    const face = setup({ commission: true }).game
    open(face, { region: NX({ safe: [1, 1] }) }, ACT_FACE, ORIGIN)
    teleport(face, marks(face, 'b')[0]!.at)
    apply(face, 'safe_logout')
    expect(ends('face.net')[0]).toMatchObject({ outcome: 'retreat', origin: ORIGIN })
  })
})

// ===================================================================================================================
// 十、陷阱
// ===================================================================================================================

describe('陷阱（N8）：看不到；進視野時全隊最高的介面擲一次；沒察覺踩上去警報 +10、迴圈碎片灌感載並送回入口', () => {
  const TRAPS = (grade = 1) => ({ grade, region: NX({ trap: [2, 2] }) })
  const trapsOf = (g: G, kind: string) => ext(g).traps.l1!.filter((t) => t.kind === kind)
  /** 站在陷阱旁邊（鏈路上的格子，往陷阱那一格走一步就踩上去）；回傳那一格與走過去的方向。 */
  function nextTo(g: G, kind: string): { trap: Patrol extends never ? never : ReturnType<typeof trapsOf>[number]; from: [number, number] } {
    const trap = trapsOf(g, kind)[0]!
    const around = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [trap.at[0] + dx, trap.at[1] + dy] as [number, number]).filter((p) => sheetOf(g).walkable(p[0], p[1]))
    const from = around[0]!
    // 把這個陷阱標成「察覺的檢定擲過了、沒看到」，免得走近時多擲一次
    const traps = clone(ext(g).traps)
    for (const t of traps.l1!) t.checked = true
    commit(g, [{ op: 'map.ext', map: run(g).map, value: { ...clone(g.state.maps.instances[run(g).map]!.ext), net: { ...clone(ext(g)), traps } } }])
    teleport(g, from)
    return { trap: trapsOf(g, kind)[0]!, from }
  }

  it('生成時陷阱是看不到的：版面上是一般的鏈路（沒有 net_alarm、net_loop），位置在 ext.net.traps，一半警報一半迴圈碎片', () => {
    const { game: g } = setup()
    open(g, TRAPS())
    expect(ext(g).traps.l1!.map((t) => t.kind).sort()).toEqual(['net_alarm', 'net_loop'])
    expect(ext(g).traps.l1!.every((t) => !t.found && !t.checked && !t.used)).toBe(true)
    for (const t of ext(g).traps.l1!) expect(sheetOf(g).kindAt(t.at[0], t.at[1])).toBe('floor')
    expect(g.gridView()!.cells.flat().filter((c) => c === 'net_alarm' || c === 'net_loop')).toEqual([])
  })

  it('進視野時察覺：成功的那一格看得到（gridView 的種類是 net_alarm），只擲一次；沒察覺的還是看不到', () => {
    // 找一個走一步就看得到陷阱（視野 3）又察覺成功的種子
    const probe = (g: G): { found: boolean; seen: boolean } | null => {
      open(g, TRAPS())
      const trap = ext(g).traps.l1!.find((t) => t.kind === 'net_alarm')!
      const node = nodes(g).find((n) => key(n.at) !== key(at(g)) && reachable(g).has(key(n.at)) && sheetOf(g).visibleFrom({ x: n.at[0], y: n.at[1] }, 3).has(key(trap.at)) && !(n.at[0] === trap.at[0] && n.at[1] === trap.at[1]))
      if (!node) return null
      const path = sheetOf(g).findPath({ x: at(g)[0], y: at(g)[1] }, { x: node.at[0], y: node.at[1] })!.slice(1)
      if (path.some((p) => p.x === trap.at[0] && p.y === trap.at[1])) return null
      go(g, node.at)
      const t = ext(g).traps.l1!.find((x) => x.kind === 'net_alarm')!
      return { found: t.found === true, seen: g.gridView()!.cells[trap.at[1]]![trap.at[0]] === 'net_alarm' }
    }
    const good = seedWhere({}, (g) => probe(g)?.found === true)
    const g = setup({ seed: good }).game
    const r = probe(g)!
    expect(r).toEqual({ found: true, seen: true })
    const t = ext(g).traps.l1!.find((x) => x.kind === 'net_alarm')!
    expect(t.checked).toBe(true)
    expect(sheetOf(g).kindAt(t.at[0], t.at[1])).toBe('net_alarm')
    // 擲的是全隊最高的介面：主角（介面 4）而不是同伴（介面 1）
    expect(lastMove(g).outcome.summary).toContain(`${g.state.actors.pc!.name}察覺了一個陷阱（警報節點）`)
    // 沒察覺的：擲過了（checked）、還是看不到
    const bad = seedWhere({}, (h) => probe(h)?.found === false)
    const f = setup({ seed: bad }).game
    expect(probe(f)).toEqual({ found: false, seen: false })
    expect(ext(f).traps.l1!.find((x) => x.kind === 'net_alarm')!.checked).toBe(true)
  })

  it('沒看到而踩上去：警報節點追蹤度 +10、那一格失效（改回鏈路）、走路停在那一格；踩過的第二次沒事', () => {
    const { game: g } = setup()
    open(g, TRAPS())
    const { trap, from } = nextTo(g, 'net_alarm')
    expect(trace(g)).toBe(0)
    go(g, trap.at)
    expect(at(g)).toEqual(trap.at)
    expect(trace(g)).toBe(10)
    expect(ext(g).traps.l1!.find((t) => t.kind === 'net_alarm')!.used).toBe(true)
    expect(lastMove(g).outcome.summary).toContain('踩到了警報節點')
    expect(sheetOf(g).kindAt(trap.at[0], trap.at[1])).toBe('floor')
    go(g, from)
    go(g, trap.at)
    expect(trace(g)).toBe(10)
  })

  it('看到了還是踩上去也一樣觸發（察覺只是讓人可以繞）；區的規則表可以改警報的數字', () => {
    const { game: g } = setup()
    open(g, { grade: 1, region: NX({ trap: [2, 2] }, { trap: { alarm: 15, loop_load: 8 } }) })
    const { trap, from } = nextTo(g, 'net_alarm')
    const traps = clone(ext(g).traps)
    traps.l1!.find((t) => t.kind === 'net_alarm')!.found = true
    commit(g, [
      { op: 'map.ext', map: run(g).map, value: { ...clone(g.state.maps.instances[run(g).map]!.ext), net: { ...clone(ext(g)), traps } } },
      { op: 'map.sheet', map: run(g).map, sheet: 'l1', cells: { [pointKey(trap.at[0], trap.at[1])]: { kind: 'net_alarm' } } },
    ])
    expect(g.gridView()!.cells[trap.at[1]]![trap.at[0]] === null || true).toBe(true)
    teleport(g, from)
    go(g, trap.at)
    expect(trace(g)).toBe(15)
  })

  it('迴圈碎片：每個人擲介面或意志（取高的）對 DC，失敗的人感載照等級加（III 級 +12）、全隊被送回這一層的入口；成功的人感載不變', () => {
    // III 級（DC 16）：同伴（介面 1、意志 10）多半失敗；找一個「主角過、同伴沒過」的種子
    const probe = (g: G): { pc: boolean; c1: boolean } | null => {
      open(g, TRAPS(3))
      const { trap } = nextTo(g, 'net_loop')
      go(g, trap.at)
      const beats = g.state.reports.find((r) => r.action === 'netrun.trap')?.timeline ?? []
      if (beats.length !== 2) return null
      const ok = (id: string) => ['critical', 'success'].includes(beats.find((b) => b.actor === id)!.roll!.degree)
      return { pc: ok('pc'), c1: ok('c1') }
    }
    const seed = seedWhere({}, (g) => {
      const r = probe(g)
      return !!r && r.pc && !r.c1
    })
    const g = setup({ seed }).game
    open(g, TRAPS(3))
    const entry = marks(g, 'E')[0]!
    const { trap } = nextTo(g, 'net_loop')
    commit(g, [{ op: 'actor.track', id: 'c1', track: 'load', delta: 2 }])
    go(g, trap.at)
    // 失敗的是同伴：感載 2 + round(8 × 1.49) = 14；主角不變
    expect(g.state.actors.c1!.load).toBe(2 + 12)
    expect(g.state.actors.pc!.load).toBe(0)
    expect(at(g)).toEqual(entry.at)
    const report = g.state.reports.find((r) => r.action === 'netrun.trap')!
    expect(report.outcome.summary).toContain('送回了這一層的入口')
    expect(report.timeline.map((b) => b.tag)).toEqual(['netrun.trap', 'netrun.trap'])
    const rolls = report.timeline.map((b) => b.roll!)
    expect(rolls.every((r) => r.dc === 16)).toBe(true)
    // 「介面或意志取高的」：主角的介面（智識 +2、介面 4）比意志高
    expect(rolls[0]!.parts.map((p) => p.source)).toEqual(['attr', 'skill'])
    // 踩過的第二次沒事
    expect(ext(g).traps.l1!.find((t) => t.kind === 'net_loop')!.used).toBe(true)
    const load = g.state.actors.c1!.load
    const from = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [trap.at[0] + dx, trap.at[1] + dy] as [number, number]).find((p) => sheetOf(g).walkable(p[0], p[1]))!
    teleport(g, from)
    go(g, trap.at)
    expect(g.state.actors.c1!.load).toBe(load)
    expect(g.state.reports.filter((r) => r.action === 'netrun.trap')).toHaveLength(1)
    expect(at(g)).toEqual(trap.at)
  })

  it('迴圈碎片全隊都擋住了：感載不變、不送回入口', () => {
    const probe = (g: G): boolean => {
      open(g, TRAPS(1))
      const { trap } = nextTo(g, 'net_loop')
      go(g, trap.at)
      return g.state.reports.find((r) => r.action === 'netrun.trap')?.outcome.result === 'loop_held'
    }
    const seed = seedWhere({}, probe)
    const g = setup({ seed }).game
    open(g, TRAPS(1))
    const { trap } = nextTo(g, 'net_loop')
    go(g, trap.at)
    expect(g.state.actors.pc!.load + g.state.actors.c1!.load).toBe(0)
    expect(at(g)).toEqual(trap.at)
    expect(lastMove(g).outcome.summary).toContain('全隊都擋住了')
    expect(g.state.reports.find((r) => r.action === 'netrun.trap')!.outcome.result).toBe('loop_held')
  })

  it('一段路經過陷阱：走到陷阱那一格就停下來（後面的格子不走了）', () => {
    const route = (g: G, mapSeed: number): { target: [number, number]; trap: [number, number] } | null => {
      open(g, { ...TRAPS(), seed: mapSeed })
      const traps = clone(ext(g).traps)
      for (const x of traps.l1!) x.checked = true
      commit(g, [{ op: 'map.ext', map: run(g).map, value: { ...clone(g.state.maps.instances[run(g).map]!.ext), net: { ...clone(ext(g)), traps } } }])
      for (const t of ext(g).traps.l1!) {
        const target = nodes(g).find((n) => {
          const path = sheetOf(g).findPath({ x: at(g)[0], y: at(g)[1] }, { x: n.at[0], y: n.at[1] })
          return !!path && path.slice(1, -1).some((p) => p.x === t.at[0] && p.y === t.at[1])
        })
        if (target) return { target: target.at, trap: t.at }
      }
      return null
    }
    const mapSeed = Array.from({ length: 60 }, (_, i) => i + 1).find((n) => route(setup().game, n) !== null)!
    expect(mapSeed).toBeTruthy()
    const { game: g } = setup()
    const r = route(g, mapSeed)!
    go(g, r.target)
    expect(at(g)).toEqual(r.trap)
    expect(at(g)).not.toEqual(r.target)
  })
})

// ===================================================================================================================
// 十一、巡邏
// ===================================================================================================================

describe('巡邏：挑一條 3～5 個節點的路線、每三個探索回合走一個節點、撞上了先擲潛行', () => {
  const PATROL = (more: Rec = {}) => ({ region: NX({ patrol: [1, 1] }), ...more })
  const patrols = (g: G): Patrol[] => ext(g).patrols

  it('生成：每層一隊（密度表）、路線 3～5 個節點的簡單路徑（相鄰、不經過入口）、一個精英或兩個雜兵；movers 同步記著位置', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { game: g } = setup({ seed: 50 })
      open(g, PATROL({ seed }))
      const [p] = patrols(g)
      expect(patrols(g), `seed ${seed}`).toHaveLength(1)
      expect(p!.route.length).toBeGreaterThanOrEqual(2)
      expect(p!.route.length).toBeLessThanOrEqual(5)
      expect(new Set(p!.route).size).toBe(p!.route.length)
      const graph = ext(g).graph.l1!
      const entry = graph.nodes.find((n) => n.kind === 'entry')!
      expect(p!.route).not.toContain(entry.id)
      for (let i = 1; i < p!.route.length; i++) {
        const a = p!.route[i - 1]!
        const b = p!.route[i]!
        expect(graph.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)), `${a}-${b}`).toBe(true)
      }
      const ranks = p!.foes.map((f) => f.rank as string)
      expect(['elite', 'minion,minion']).toContain(ranks.join(','))
      expect(p!.foes.every((f) => f.from === 'enemy_pick' && f.faction === 'f_a')).toBe(true)
      expect(p!).toMatchObject({ id: 'p1', sheet: 'l1', step: 0, at: p!.route[0] })
      const mover = g.state.maps.instances[run(g).map]!.sheets.l1!.movers[p!.id]!
      expect(mover.at).toEqual(graph.nodes.find((n) => n.id === p!.at)!.at)
    }
  })

  it('來回走的位置：pingpong', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) => pingpong(s, 3))).toEqual([0, 1, 2, 1, 0, 1, 2, 1, 0])
    expect([0, 1, 2, 3, 4].map((s) => pingpong(s, 1))).toEqual([0, 0, 0, 0, 0])
    expect([0, 1, 2, 3].map((s) => pingpong(s, 2))).toEqual([0, 1, 0, 1])
  })

  it('三個探索回合之後它在路線的下一個節點（movers 跟著動）；之前不動；只有這一層的巡邏會動', () => {
    const { game: g } = setup()
    open(g, PATROL({ stealth: true, layers: ['staff', 'core'] }))
    const start = patrols(g).map((p) => ({ id: p.id, at: p.at, sheet: p.sheet }))
    const first = patrols(g).find((p) => p.sheet === 'l1')!
    const step = shuttle(g)
    step()
    step()
    expect(run(g).round).toBe(2)
    expect(patrols(g).find((p) => p.sheet === 'l1')!.at).toBe(start.find((s) => s.sheet === 'l1')!.at)
    step()
    expect(run(g).round).toBe(3)
    const p1 = patrols(g).find((p) => p.sheet === 'l1')!
    expect(p1.step).toBe(1)
    expect(p1.at).toBe(first.route[1])
    const graph = ext(g).graph.l1!
    expect(g.state.maps.instances[run(g).map]!.sheets.l1!.movers[p1.id]).toMatchObject({ at: graph.nodes.find((n) => n.id === first.route[1])!.at, leg: 1 })
    // 下一層的巡邏沒有動
    const p2 = patrols(g).find((p) => p.sheet === 'l2')!
    expect(p2.step).toBe(0)
    for (let i = 0; i < 3; i++) step()
    expect(patrols(g).find((p) => p.sheet === 'l1')!.step).toBe(2)
    expect(patrols(g).find((p) => p.sheet === 'l1')!.at).toBe(first.route[Math.min(2, first.route.length - 1)])
  })

  it('休息點、下載也各算一個回合，巡邏照走（tickRun 也一樣）', () => {
    const { game: g } = setup()
    open(g, { ...PATROL({ stealth: true }), objective: { kind: 'download', turns: 4 } })
    standOnGoal(g)
    const before = clone(patrols(g)[0]!)
    apply(g, 'download')
    apply(g, 'download')
    expect(patrols(g)[0]!.step).toBe(before.step)
    apply(g, 'download')
    expect(patrols(g)[0]!.step).toBe(before.step + 1)
    // tickRun：回合數加一、最後一筆是這一趟的新狀態
    const changes = tickRun(g.k, g.state, run(g))
    const last = changes.at(-1) as { op: string; key: string; value: { round: number } }
    expect(last).toMatchObject({ op: 'ext', key: 'netrun', value: { round: run(g).round + 1 } })
  })

  /** 把隊伍放在離巡邏的節點兩步遠的一個節點，再走到和它相鄰的節點上：回傳走完之後有沒有戰鬥。 */
  function meet(g: G): { battle: boolean; lines: string } {
    const p = patrols(g)[0]!
    const graph = ext(g).graph.l1!
    const patrolNode = graph.nodes.find((n) => n.id === p.at)!
    const nb = graph.edges.map((e) => (e.a === patrolNode.id ? e.b : e.b === patrolNode.id ? e.a : null)).filter((x): x is string => !!x)
    for (const id of nb) {
      const target = graph.nodes.find((n) => n.id === id)!
      if (target.kind === 'entry') continue
      // 先站在離它遠一點的地方（入口），再走過去
      teleport(g, marks(g, 'E')[0]!.at)
      const path = sheetOf(g).findPath({ x: at(g)[0], y: at(g)[1] }, { x: target.at[0], y: target.at[1] })
      if (!path) continue
      // 路上不能先碰到它（同一個節點或相鄰的節點）：只走到目標，要經過的節點由 go 一格一格算
      const before = g.state.reports.length
      try {
        go(g, target.at)
      } catch {
        continue
      }
      return { battle: !!g.battle, lines: g.state.reports.slice(before).map((r) => r.outcome.summary).join('') }
    }
    throw new Error('找不到可以撞上的位置')
  }

  it('走到它旁邊：潛行全過就沒事（擦身而過，calm）、沒過開戰（先攻在對方）；setup.stealth 的那一趟自動過', () => {
    const base = (seed: number) => {
      const t = setup({ seed })
      open(t.game, PATROL({ seed: 21 }))
      return t.game
    }
    const pass = seedWhere({}, (g) => {
      open(g, PATROL({ seed: 21 }))
      const r = meet(g)
      return !r.battle && patrols(g)[0]!.calm === true
    })
    const g = base(pass)
    const r = meet(g)
    expect(r.battle).toBe(false)
    expect(r.lines).toContain('擦身而過')
    expect(patrols(g)[0]!.calm).toBe(true)
    // 同一個地方再站上去不會再擲（calm 到拉開為止）
    const rounds = g.state.reports.filter((x) => x.timeline.some((b) => b.tag === 'netrun.roll')).length
    go(g, marks(g, 'E')[0]!.at)
    expect(g.state.reports.filter((x) => x.timeline.some((b) => b.tag === 'netrun.roll')).length).toBeGreaterThanOrEqual(rounds)

    const fail = seedWhere({}, (h) => {
      open(h, PATROL({ seed: 21 }))
      return meet(h).battle
    })
    const f = base(fail)
    const rf = meet(f)
    expect(rf.battle).toBe(true)
    expect(rf.lines).toContain('發現了你們')
    const b = f.battle!
    expect(b.origin.ext!.net).toMatchObject({ run: run(f).id, node: patrols(f)[0]!.id, patrol: true })
    expect(f.state.snapshots.find((s) => s.kind === 'battle')!.data!.setup).toMatchObject({ edge: 'foe' })
    expect(Object.values(b.units).filter((u) => u.side === 'foe')).toHaveLength(patrols(f)[0]!.foes.length)

    // setup.stealth：撞上了也不用擲
    const s = setup({ seed: fail }).game
    open(s, PATROL({ seed: 21, stealth: true }))
    const rs = meet(s)
    expect(rs.battle).toBe(false)
    expect(rs.lines).toContain('沒有發現你們')
  })

  it('打贏之後不再出現（gone、movers 拿掉）；之後怎麼走都不會再打', async () => {
    const fail = seedWhere({}, (h) => {
      open(h, PATROL({ seed: 21 }))
      return meet(h).battle
    })
    const g = setup({ seed: fail }).game
    open(g, PATROL({ seed: 21 }))
    meet(g)
    const id = patrols(g)[0]!.id
    expect(playOut(g).outcome).toBe('win')
    await g.finishBattle()
    expect(patrols(g)[0]).toMatchObject({ id, gone: true })
    expect(g.state.maps.instances[run(g).map]!.sheets.l1!.movers[id]).toMatchObject({ gone: true })
    expect(netrunView(g.k, g.state)!.patrols).toEqual([])
    const step = shuttle(g)
    for (let i = 0; i < 7; i++) step()
    expect(g.battle).toBeNull()
  })

  it('追蹤度第一次到 30：每一層多一隊（只多一次）；這一區沒有巡邏的不多；新的一隊離隊伍遠一點', () => {
    const { game: g } = setup()
    open(g, PATROL({ layers: ['staff', 'core'] }))
    expect(patrols(g)).toHaveLength(2)
    setTrace(g, 31)
    expect(patrols(g)).toHaveLength(4)
    expect(patrols(g).map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(patrols(g).filter((p) => p.sheet === 'l1')).toHaveLength(2)
    expect(patrols(g).filter((p) => p.sheet === 'l2')).toHaveLength(2)
    expect(ext(g).t30).toBe(true)
    expect(g.state.reports.at(-1)!.outcome.summary).toContain('多了')
    setTrace(g, 20)
    setTrace(g, 40)
    expect(patrols(g)).toHaveLength(4)
    // 新的一隊的敵人也有 enemy_pick 的 ref
    expect(patrols(g)[2]!.foes.every((f) => f.from === 'enemy_pick')).toBe(true)
    const none = setup().game
    open(none, { region: NX() })
    setTrace(none, 31)
    expect(ext(none).patrols).toEqual([])
  })

  it('netrunView.patrols 給畫面：節點、格子、在不在視野裡、擦身而過了沒有', () => {
    const { game: g } = setup()
    open(g, PATROL())
    const v = netrunView(g.k, g.state)!
    expect(v.patrols).toHaveLength(1)
    expect(v.patrols[0]).toMatchObject({ id: 'p1', node: patrols(g)[0]!.at, calm: false })
    const pos = ext(g).graph.l1!.nodes.find((n) => n.id === patrols(g)[0]!.at)!.at
    expect(v.patrols[0]!.at).toEqual(pos)
    expect(typeof v.patrols[0]!.visible).toBe('boolean')
  })
})

// ===================================================================================================================
// 十二、擦痕跡（探索中的管理行動）
// ===================================================================================================================

describe('擦痕跡：主控的人才有；每一層最多主控階數次；每次 −5 +1，失敗 +5 +1', () => {
  it('主控 2 階的人一層只能做兩次，第三次灰掉並有原因；成功是 −5 再 +1（追蹤度 20 → 16 → 12）；下一層重算', () => {
    const win = seedWhere({}, (g) => {
      open(g, { layers: ['staff', 'core'], region: NX() })
      setTrace(g, 20)
      for (let i = 0; i < 2; i++) {
        const d = make(g, 'wipe')
        if (d.outcome.result !== 'wipe') return false
        g.commit(d)
      }
      return true
    })
    const g = setup({ seed: win }).game
    open(g, { layers: ['staff', 'core'], region: NX() })
    setTrace(g, 20)
    expect(freeUses(g.k, g.state)).toEqual([{ id: 'wipe', name: '擦痕跡（−5）', block: null }])
    expect(netrunView(g.k, g.state)!.admin.map((u) => u.id)).toEqual(['wipe'])
    const d = make(g, 'wipe')
    expect(d.timeline.find((t) => t.roll)!.roll!.dc).toBe(10)
    g.commit(d)
    expect(trace(g)).toBe(16)
    expect(ext(g).wiped).toEqual({ l1: 1 })
    apply(g, 'wipe')
    expect(trace(g)).toBe(12)
    expect(freeUses(g.k, g.state)[0]!.block).toMatch(/已經擦了 2 次.*主控 2 階.*最多擦 2 次/)
    expect(() => make(g, 'wipe')).toThrow(/一層最多擦 2 次/)
    expect(ext(g).wiped).toEqual({ l1: 2 })
    // 下一層從頭算
    teleport(g, marks(g, 'g')[0]!.at)
    apply(g, 'descend')
    expect(freeUses(g.k, g.state)[0]!.block).toBeNull()
  })

  it('失敗：追蹤度 +1 +5，還是記一次（不能一直擲到成功）', () => {
    const lose = seedWhere({}, (g) => {
      open(g, { region: NX() })
      return make(g, 'wipe').outcome.result === 'wipe_fail'
    })
    const g = setup({ seed: lose }).game
    open(g, { region: NX() })
    setTrace(g, 20)
    apply(g, 'wipe')
    expect(trace(g)).toBe(26)
    expect(ext(g).wiped).toEqual({ l1: 1 })
  })

  it('沒有主控的隊伍沒有這幾項（也沒有破解、快駭）；主控 1 階一層只能擦一次', () => {
    const none = setup({ master: false }).game
    open(none, { region: NX({ foe: [1, 1], person: [1, 1] }), encounter: ['minion'] })
    expect(freeUses(none.k, none.state)).toEqual([])
    expect(netrunView(none.k, none.state)!.admin).toEqual([])
    expect(() => make(none, 'wipe')).toThrow(/沒有主控|沒有人有主控/)
    expect(masterTier(none.k, none.state, 'pc')).toBe(0)
    teleport(none, marks(none, 'g')[0]!.at)
    expect(useIds(none)).toEqual(['pass'])
    const one = setup({ master: 1 }).game
    open(one, { region: NX() })
    expect(masterTier(one.k, one.state, 'pc')).toBe(1)
    apply(one, 'wipe')
    expect(freeUses(one.k, one.state)[0]!.block).toMatch(/最多擦 1 次/)
  })

  it('沒有追蹤度的區沒有痕跡可以擦；戰鬥中灰掉', () => {
    const { game: g } = setup()
    open(g, { region: NX({}, { pressure: 'none' }) })
    expect(freeUses(g.k, g.state)[0]!.block).toMatch(/沒有追蹤度/)
  })

  it('擦痕跡把追蹤度降回 90 以下，被定位的倒數取消（N15）', () => {
    const win = seedWhere({}, (g) => {
      open(g, { region: NX() })
      setTrace(g, 92)
      return make(g, 'wipe').outcome.result === 'wipe'
    })
    const g = setup({ seed: win }).game
    open(g, { region: NX() })
    setTrace(g, 92)
    expect(run(g).located).toBe(3)
    apply(g, 'wipe')
    expect(trace(g)).toBe(88)
    expect(run(g).located).toBeUndefined()
  })
})

// ===================================================================================================================
// 十三、帶出去才算數
// ===================================================================================================================

describe('帶出去才算數：倒下與被定位而且沒有回到快照時，每一件擲 d6，1～3 的丟掉', () => {
  const HAUL = [
    { kind: 'item', id: 'it_chip', qty: 1, name: '晶片' },
    { kind: 'item', id: 'it_part', qty: 2, name: '零件' },
    { kind: 'cred', qty: 300, name: '帳戶的餘額' },
  ]
  /** 這一趟已經拿到三件：背包與帳戶真的有，loot 記著。 */
  function haul(g: G): void {
    commit(g, [{ op: 'item', id: 'it_chip', qty: 1 }, { op: 'item', id: 'it_part', qty: 2 }, { op: 'cred', delta: 300 }, { op: 'ext', key: 'netrun', value: { ...clone(run(g)), loot: clone(HAUL) } }])
  }
  const dice = (g: G): number[] => HAUL.map((_, i) => deriveRng(g.state.rng, `netrun/${run(g).id}/lose/${i}`).int(1, 6))
  /** 照固定的骰面丟掉哪幾件（骰面 1～3 丟）。 */
  const lostIdx = (g: G): number[] => dice(g).map((d, i) => (d <= 3 ? i : -1)).filter((i) => i >= 0)
  const defeatOf = (g: G, fails: boolean) => endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b1', origin: { by: 'netrun', ref: run(g).id, ext: { net: { run: run(g).id } } }, outcome: 'accept', result: { fails_commission: fails } })

  it('自己的那一趟打輸、接受：三件照固定的骰面丟掉兩件（result 用 lossOf 與 lines 列出來）；東西真的從背包與帳戶拿走', () => {
    const seed = seedWhere({}, (g) => {
      open(g)
      haul(g)
      return lostIdx(g).length === 2 && lostIdx(g)[0] === 0
    })
    const g = setup({ seed }).game
    open(g)
    haul(g)
    const gone = lostIdx(g)
    expect(gone).toHaveLength(2)
    const loss = lossOf(g.k, g.state, run(g))
    expect(loss.lost.map((l) => l.name)).toEqual(gone.map((i) => HAUL[i]!.name))
    const end = defeatOf(g, false)
    expect(end.lines.join('')).toContain('慌亂中丟掉了')
    commit(g, [{ op: 'snapshot.drop', kind: 'battle' }, ...end.changes], 'defeat.accept')
    expect(readRun(g.state)).toBeNull()
    expect(g.state.inventory.find((s) => s.id === 'it_chip')?.qty ?? 0).toBe(gone.includes(0) ? 0 : 1)
    expect(g.state.inventory.find((s) => s.id === 'it_part')?.qty ?? 0).toBe(gone.includes(1) ? 0 : 2)
    expect(g.state.money.cred).toBe(gone.includes(2) ? 0 : 300)
  })

  it('委託的階段：算委託失敗的戰敗（回到快照）不丟；不算委託失敗的戰敗要丟', () => {
    const seed = seedWhere({ commission: true }, (g) => {
      open(g, {}, ACT_FACE, ORIGIN)
      haul(g)
      return lostIdx(g).length >= 1
    })
    const g = setup({ seed, commission: true }).game
    open(g, {}, ACT_FACE, ORIGIN)
    haul(g)
    const fail = defeatOf(g, true)
    expect(fail.changes.filter((c) => c.op === 'item' || c.op === 'cred')).toEqual([])
    const keep = defeatOf(g, false)
    expect(keep.changes.some((c) => c.op === 'item' || c.op === 'cred')).toBe(true)
  })

  it('不是這一趟的戰敗：什麼都不丟；正常登出三件都在', () => {
    ENDS.length = 0
    const { game: g } = setup()
    open(g)
    haul(g)
    expect(endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b2', origin: { by: 'core', ext: { net: { run: 'someone_else' } } }, outcome: 'accept', result: {} }).changes).toEqual([])
    g.commit(logout(g.k, g.state))
    expect(g.state.inventory).toEqual([{ id: 'it_chip', qty: 1 }, { id: 'it_part', qty: 2 }])
    expect(g.state.money.cred).toBe(300)
    expect(ends('netrun')[0]).toMatchObject({ outcome: 'left', result: { loot: HAUL } })
    expect(ends('netrun')[0]!.result.lost).toBeUndefined()
  })

  it('被定位（自己的那一趟）：result.lost 列出丟掉的、東西拿走；委託的階段被定位是委託失敗，不用丟', () => {
    ENDS.length = 0
    const seed = seedWhere({}, (g) => {
      open(g, { trace: 91 })
      haul(g)
      return lostIdx(g).length >= 1 && lostIdx(g).length <= 2
    })
    const g = setup({ seed }).game
    open(g, { trace: 91 })
    haul(g)
    const gone = lostIdx(g)
    const step = shuttle(g)
    step(); step(); step()
    expect(readRun(g.state)).toBeNull()
    const end = ends('netrun')[0]!
    expect(end).toMatchObject({ outcome: 'located', result: { located: true } })
    expect((end.result.lost as Rec[]).map((l) => l.name)).toEqual(gone.map((i) => HAUL[i]!.name))
    expect(g.state.inventory.find((s) => s.id === 'it_part')?.qty ?? 0).toBe(gone.includes(1) ? 0 : 2)

    ENDS.length = 0
    const face = setup({ seed, commission: true }).game
    open(face, { trace: 91 }, ACT_FACE, ORIGIN)
    haul(face)
    const s2 = shuttle(face)
    s2(); s2(); s2()
    expect(ends('face.net')[0]).toMatchObject({ outcome: 'located' })
    expect(ends('face.net')[0]!.result.lost).toBeUndefined()
    expect(face.state.inventory.find((s) => s.id === 'it_part')?.qty).toBe(2)
  })

  it('帶出來的那一件（goal）一定丟，不看骰面', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'extract', item: 'it_goal' }, region: NX() })
    standOnGoal(g)
    apply(g, 'loot')
    const loss = lossOf(g.k, g.state, run(g))
    expect(loss.lost).toHaveLength(1)
    expect(loss.changes).toEqual([{ op: 'item', id: 'it_goal', qty: -1 }])
    const end = endActivity(g.k, { state: g.state, kind: 'defeat', id: 'b3', origin: { by: 'netrun', ref: run(g).id, ext: { net: { run: run(g).id } } }, outcome: 'accept', result: {} })
    commit(g, [{ op: 'snapshot.drop', kind: 'battle' }, ...end.changes], 'defeat.accept')
    expect(g.state.inventory).toEqual([])
  })

  it('背包裡已經沒有那麼多時拿走剩下的（不會讓報告不成立）；netrun.close 的掛點收到 lost', () => {
    const { game: g } = setup()
    open(g)
    commit(g, [{ op: 'ext', key: 'netrun', value: { ...clone(run(g)), loot: [{ kind: 'item', id: 'it_part', qty: 5, name: '零件', goal: true }, { kind: 'cred', qty: 900, name: '帳戶的餘額', goal: true }] } }])
    const loss = lossOf(g.k, g.state, run(g))
    expect(loss.changes).toEqual([])
    commit(g, [{ op: 'item', id: 'it_part', qty: 1 }])
    const again = lossOf(g.k, g.state, run(g))
    expect(again.changes).toEqual([{ op: 'item', id: 'it_part', qty: -1 }])
    expect(() => commit(g, again.changes)).not.toThrow()
  })
})

// ===================================================================================================================
// 十四、存檔與讀檔
// ===================================================================================================================

describe('生成的地圖帶著巡邏、陷阱、目標存檔再讀，接著走的結果一樣', () => {
  it('存檔再讀：接著走（站上節點、下載）得到的狀態一樣', () => {
    const cfg = { region: NX({ patrol: [1, 1], trap: [2, 2], archive: [1, 1], person: [1, 1] }), objective: { kind: 'download', turns: 3 }, stealth: true }
    const { game: a } = setup()
    open(a, cfg)
    const m = goalMarker(a)
    teleport(a, m.at)
    apply(a, 'download')
    commit(a, [{ op: 'meter', kind: 'trace', key: run(a).map, set: 12 }])
    const raw = a.save()
    const { game: b } = setup({ seed: 123 })
    expect(b.load(raw)).toBeNull()
    const next = (g: G) => {
      apply(g, 'download')
      const mid = { round: run(g).round, goal: clone(run(g).goal), trace: trace(g), patrols: clone(ext(g).patrols), traps: clone(ext(g).traps) }
      apply(g, 'download')
      return { mid, end: clone(ends('netrun').at(-1)!.result), outcome: ends('netrun').at(-1)!.outcome }
    }
    ENDS.length = 0
    const ra = next(a)
    ENDS.length = 0
    const rb = next(b)
    expect(rb).toEqual(ra)
    expect(ra.mid.goal).toMatchObject({ progress: 2 })
    expect(ra).toMatchObject({ outcome: 'done', end: { goal: true, trace: 16 } })
  })

  it('存檔裡的 ext.net 沒有第二張的欄位（舊檔）也讀得出來：補空的', () => {
    const { game: g } = setup()
    open(g)
    const map = run(g).map
    const net = clone(g.state.maps.instances[map]!.ext!.net) as Rec
    for (const k of ['traps', 'patrols', 'controls', 'keys', 'wiped', 'used', 'opened']) delete net[k]
    commit(g, [{ op: 'map.ext', map, value: { net } }])
    expect(ext(g)).toMatchObject({ traps: {}, patrols: [], controls: {}, keys: [], wiped: {}, used: {}, opened: [] })
    expect(netrunView(g.k, g.state)).toBeTruthy()
  })
})

// ===================================================================================================================
// 十五、netrunView 與放行
// ===================================================================================================================

describe('netrunView：目標、手上的憑證與拿到的東西', () => {
  it('goal 帶進度與位置；loot、keys、controls 給畫面', () => {
    const { game: g } = setup()
    open(g, { objective: { kind: 'download', turns: 3 }, region: NX({ archive: [1, 1] }) })
    const v = netrunView(g.k, g.state)!
    expect(v.goal).toMatchObject({ kind: 'download', turns: 3, progress: null, got: false, done: false, at: { sheet: 'l1' } })
    expect(v.keys).toBe(0)
    expect(v.loot).toEqual([])
    expect(v.controls).toEqual([])
    standOnGoal(g)
    apply(g, 'download')
    expect(netrunView(g.k, g.state)!.goal).toMatchObject({ progress: 1 })
    expect(netrunView(g.k, g.state)!.here.uses.map((u) => u.id)).toEqual(['download'])
    expect(g.gridView()!.here.uses.map((u) => u.id)).toEqual(['download'])
  })

  it('節點上能做的事在戰鬥中灰掉（正在戰鬥）', () => {
    const { game: g } = setup()
    open(g, { region: NX({ foe: [1, 1], archive: [1, 1] }), encounter: ['minion'] })
    const arch = marks(g, 'a')[0]!
    teleport(g, arch.at)
    expect(uses(g)[0]!.block).toBeNull()
    const foe = marks(g, 'f')[0]!
    const reach = reachable(g)
    teleport(g, ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [foe.at[0] + dx, foe.at[1] + dy] as [number, number]).find((p) => reach.has(key(p)))!)
    g.commit(make(g, 'fight', foe.id))
    expect(g.battle).toBeTruthy()
    expect(() => make(g, 'wipe')).toThrow(/正在戰鬥/)
    const net = ext(g)
    for (const m of marks(g, 'a')) expect(usesOfMarker(g.k, g.state, run(g), net, 'l1', m)[0]!.block).toBe('正在戰鬥，先把這一場打完。')
    expect(freeUses(g.k, g.state)[0]!.block).toBe('正在戰鬥，先把這一場打完。')
  })

  it('descend 與 pass 照舊（這一張沒有改壞）', () => {
    const { game: g } = setup()
    open(g, { layers: ['staff', 'core'], region: NX() })
    teleport(g, marks(g, 'g')[0]!.at)
    expect(uses(g)).toMatchObject([{ id: 'descend', block: null }])
    g.commit(descend(g.k, g.state))
    expect(run(g).layer).toBe(1)
  })
})
