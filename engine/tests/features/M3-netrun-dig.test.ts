// 驗收測試：dev/work/M3-netrun-dig.md（cpp-feature）。features/netrun 的第三張：自己去挖的一般子網。
// 規格：CYBERSPACE 8.1 節（密度表、共通詞條、帶出去才算數）、8.3 節（兩種進去的方式、設施類型、每一層放什麼、追蹤度在生成的子網裡、詞條）；
// NETRUNNING 第 4 節（後門）、第 5 節（登出時留下的敵對值、起始值）；DATA 第 10 節；dev/adr/0018 第六節與 N1、N2、N16、N35。
// 內容是測試自帶的最小假資料：兩種設施類型（兩層、四層）、幾條詞條、一個勢力（f_a）的六種蕾絲、一張三列的檔案庫表；敵對值用真的 security（量表與條件 hostility_tier）。
// 骰面：由種子與用途導出；要某一種結果的測試掃種子。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Origin } from '../../src'
import { ActionBlocked, Sheet, clone, gridHere, meterOf, toMinutes } from '../../src'
import { deckFeature, deckOf, equipDraft } from '../../src/features/deck'
import { enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import {
  AFFIX_KEYS, ACT_FACE, ACT_NET, affixProblems, backdoorClears, combineFx, expireDraft, facilityProblems, freeUses, gateDc, keptOf, logout, netExt, netrunFeature, netrunRules, netrunView, readRun,
  regionProblems, ruleProblems, tickRun, useNode,
} from '../../src/features/netrun'
import { pickAdmin, rollPicked } from '../../src/features/netrun/checks'
import { securityFeature } from '../../src/features/security'
import { TEST_ACTIVITY, TEST_NET_COMBAT, makeActor, makeGame, netWeapon } from '../../src/testkit'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'sync', 'stealth', 'negotiate'].map((id) => ({
  id, name: id, desc: `${id}。`,
  attr: id === 'composure' ? 'resolve' : id === 'stealth' || id === 'firearms' ? 'reflex' : id === 'interface' ? 'intellect' : id === 'negotiate' ? 'charm' : 'body',
}))
const lace = (id: string, rank: string, color: string): Rec => ({
  id, name: `測試${id}`, desc: '測試用的網內敵人。', faction: 'f_a', rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [2, 3], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
})
const item = (id: string, name: string, more: Rec = {}): Rec => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 0, legal: 'free', ...more })

const TABLE = [
  { weight: 1, name: '舊檔', give: [{ kind: 'item', id: 'it_chip', qty: 1 }] },
  { weight: 1, name: '零件包', give: [{ kind: 'item', id: 'it_part', qty: 2 }] },
  { weight: 1, name: '帳戶的餘額', give: [{ kind: 'cred', amount: [80, 260, 800, 2600, 8000] }] },
]
/** 密度表照 CYBERSPACE 8.1 節的一般子網那一列（11 × 9、挖 30～40 步）；自己去挖每層檔案庫再多一個。 */
const DIGNET = {
  id: 'digtest', name: '挖的網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 3, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { foe: [2, 3], patrol: [1, 1], archive: [1, 2], trap: [1, 2], rest: [1, 1], safe: [0, 0], control: [0, 0], person: [0, 0] },
  archive_table: TABLE, affixes: [],
}

/** 位階的點數（ENEMIES 第 13 節）。 */
const POINTS_FOR_TEST = { minion: 1, elite: 2.5, boss: 5 }
const FAC_TWO = { id: 'fac_two', name: '倉儲', layers: ['staff', 'core'], controls: 0 }
const FAC_FOUR = { id: 'fac_four', name: '研發', layers: ['guest', 'staff', 'control', 'core'], controls: 1 }

/** 五條詞條（驗收條件）加幾條做別的測試用的。 */
const AFFIXES = [
  { id: 'a_foe_minus', name: '換班中', region: 'digtest', fx: { foe_minus: 1 } },
  { id: 'a_no_patrol', name: '寂靜的巡邏', fx: { no_patrol: true } },
  { id: 'a_marked', name: '有人留了記號', fx: { trap_marked: true } },
  { id: 'a_layer_plus', name: '多一層', fx: { layer_plus: 1 } },
  { id: 'a_trace10', name: '稽核週', fx: { trace_start: 10 } },
  { id: 'a_no_trap', name: '乾淨', fx: { trap_minus: 4 } },
  { id: 'a_gate', name: '系統更新', fx: { gate_dc: -2 } },
  { id: 'a_signal', name: '訊號不穩', fx: { check_mod: -1 } },
  { id: 'a_pink', name: '蕾絲全是粉的', fx: { all_pink: true } },
  { id: 'a_white', name: '稽核', fx: { white_plus: 1 } },
  { id: 'a_hot', name: '熱點', fx: { hot_spot: true } },
  { id: 'a_ambush', name: '寂靜', fx: { no_patrol: true, first_ambush: true } },
  { id: 'a_oneway', name: '單向的路', fx: { oneway: 1 } },
  { id: 'a_combo', name: '剛被翻過', fx: { foe_minus: 1, archive_minus: 1, trap_minus: 1 } },
]

const PACK: ContentPack = {
  id: 'netrun_dig_test',
  content: {
    skill: SKILLS,
    item: [item('it_chip', '晶片'), item('it_part', '零件')],
    battle_status: (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: '被干擾。', until: 'own_turn_end', turns: 1, kind: 'debuff' })),
    faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }],
    net_region: [DIGNET, { ...DIGNET, id: 'digrolled', name: '擲詞條的網', affixes: ['a_no_patrol', 'a_foe_minus'] }, { ...DIGNET, id: 'digtemper', name: '有脾氣的網', temper: { f_a: { gate_dc: -1 } } }],
    net_facility: [FAC_TWO, FAC_FOUR],
    net_affix: AFFIXES,
    enemy: [
      lace('en_pink_m', 'minion', 'pink'), lace('en_white_m', 'minion', 'white'), lace('en_pink_e', 'elite', 'pink'), lace('en_black_e', 'elite', 'black'),
      lace('en_pink_b', 'boss', 'pink'), lace('en_black_b', 'boss', 'black'),
    ],
  },
} as unknown as ContentPack

const STATS: Feature = {
  id: 'netrun_dig_stats',
  install(k) {
    k.stats.defineStat({ id: 'deck_grade', owner: 'netrun_dig_stats', name: '甲板', base: (state, actor) => (state.actors[actor]?.ext.testdeck ? 1 : 0) })
    // 內海的感載消退量（M3 修正批：基礎 0，甲板的散熱、技能、藥……加上去；真的 deck 的那一份在 M3-fix-review.test.ts）
    k.stats.defineStat({ id: 'net_load_decay', owner: 'netrun_dig_stats', name: '內海的感載消退', base: (state, actor) => Number(state.actors[actor]?.ext.cooling ?? 0) })
  },
}
const COMBAT: Feature = {
  id: 'netrun_dig_combat',
  install(k) {
    k.battle.loadout('netrun_dig_combat', (_s, _a, mode) => (mode === 'net' ? { weapons: [netWeapon(40, 14)] } : undefined))
  },
}
const ENDS: Array<{ kind: string; id: string; outcome: string; result: Rec; origin: Origin }> = []
const SPY: Feature = {
  id: 'netrun_dig_spy',
  install(k) {
    k.hooks.on('activity.end', 'netrun_dig_spy', ({ kind, id, outcome, result, origin }) => {
      ENDS.push({ kind, id, outcome, result: clone(result), origin: clone(origin) })
    })
  },
}

const FEATURES = [enemiesFeature, exploreFeature, netrunFeature, securityFeature, TEST_NET_COMBAT, STATS, COMBAT, SPY, TEST_ACTIVITY]
const ORIGIN: Origin = { by: 'dive', ref: 'site_a', ext: { dive: true, site: 'site_a' } }
/** 自己去挖：沒有蕾絲也沒有陷阱、巡邏的版（走路用）。 */
const CLEAR = ['a_no_patrol', 'a_no_trap']

interface Opts {
  seed?: number
  master?: boolean | number
  cooling?: number
}
type G = ReturnType<typeof makeGame>['game']

function setup(o: Opts = {}) {
  const tier = o.master === false ? 0 : typeof o.master === 'number' ? o.master : 2
  const pc = {
    attrs: { intellect: 14, charm: 14, resolve: 14, reflex: 14 }, skills: { interface: 4, negotiate: 4, stealth: 3 },
    ext: { testdeck: 1, ...(o.cooling ? { cooling: o.cooling } : {}), ...(tier > 0 ? { paths: [{ path: 'netrunner', tier }] } : {}) },
  }
  const c1 = makeActor({ id: 'c1', name: '同伴1', role: 'companion', attrs: { intellect: 10, charm: 10, resolve: 10, reflex: 10 } as never, skills: { interface: 1, stealth: 1 }, ext: { testdeck: 1 } })
  return makeGame({ seed: o.seed ?? 5, features: FEATURES, content: [PACK], pc: pc as never, actors: [c1] })
}

const commit = (g: G, changes: Change[], action = 'netrun.test'): ReturnType<G['commit']> => g.commit({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' } })
const run = (g: G) => readRun(g.state)!
const ext = (g: G) => netExt(g.state, run(g).map)!
const trace = (g: G) => meterOf(g.k, g.state, 'trace', run(g).map)
const hostility = (g: G) => meterOf(g.k, g.state, 'hostility', 'f_a')
const key = (p: [number, number]) => `${p[0]},${p[1]}`
const minutes = (g: G) => toMinutes(g.state.time)

/** 自己去挖一座：預設兩層的設施、一個 site、沒有詞條；setupMore 蓋掉。 */
function dig(g: G, more: Rec = {}): void {
  g.launch(ACT_NET, { region: 'digtest', entry: 'dig', site: 'site_a', facility: 'fac_two', grade: 1, faction: 'f_a', seed: 11, affixes: [], ...more }, ORIGIN)
}
/** 走路用的版：沒有遭遇、沒有巡邏、沒有陷阱。 */
const digClear = (g: G, more: Rec = {}): void => dig(g, { affixes: CLEAR, encounter: [], ...more })

/** 一張圖（版面套上改過的格子）。 */
const sheetById = (g: G, map: string, sheet: string): Sheet => {
  const inst = g.state.maps.instances[map]!
  return new Sheet(inst.gen!.map.sheets.find((s) => s.id === sheet)!, inst.sheets[sheet]?.cells ?? {})
}
const marks = (g: G, sheet: string, mark: string) => (g.state.maps.instances[run(g).map]!.gen!.map.sheets.find((s) => s.id === sheet)!.cells ?? []).filter((m) => m.mark === mark)
const currentSheet = (g: G): Sheet => gridHere(g.k, g.state)!.sheet
const goTo = (g: G, p: [number, number]): void => {
  const r = g.gridMove(p)
  if (r.status !== 'applied') throw new Error(`走不到 ${key(p)}：${r.reason}`)
}
/** 走到這一層的某一種標記（第一個）。 */
function walkToMark(g: G, mark: string): void {
  const m = currentSheet(g).def.cells!.find((x) => x.mark === mark)!
  goTo(g, m.at)
}
const apply = (g: G, id: string, at?: string) => g.commit(useNode(g.k, g.state, id, at))
/** 走到閘門、往下一層（閘門開著）。 */
function descendNow(g: G): void {
  walkToMark(g, 'g')
  apply(g, 'descend')
}
const setTrace = (g: G, v: number) => commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: v }])
const advance = (g: G, rounds: number) => {
  for (let i = 0; i < rounds; i++) commit(g, tickRun(g.k, g.state, run(g)), 'netrun.tick')
}
const ext2 = (g: G, map: string) => netExt(g.state, map)!
const lastEnd = () => ENDS.filter((e) => e.kind === 'netrun').at(-1)!

// ===================================================================================================================
// 一、格式
// ===================================================================================================================

describe('格式：設施類型、詞條、區的詞條表與脾氣、新的規則數字', () => {
  it('net_facility：要有名字與一到六個層；controls 0～4；壞的整筆擋下', () => {
    expect(facilityProblems(FAC_TWO)).toEqual([])
    expect(facilityProblems({ ...FAC_TWO, layers: [] })).not.toEqual([])
    expect(facilityProblems({ ...FAC_TWO, layers: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).not.toEqual([])
    expect(facilityProblems({ ...FAC_TWO, controls: 9 })).not.toEqual([])
    expect(facilityProblems({ ...FAC_TWO, airgap_at: 9 })).not.toEqual([])
    expect(facilityProblems({ name: '', layers: ['x'] })).not.toEqual([])
    const { game: g } = setup()
    expect(g.k.content.get('net_facility', 'fac_four')).toMatchObject({ layers: ['guest', 'staff', 'control', 'core'] })
  })

  it('net_affix：fx 只收封閉的十七個鍵（foe_plus…hot_spot），別的鍵、型別不對的整筆擋下', () => {
    expect(AFFIX_KEYS).toHaveLength(17)
    for (const a of AFFIXES) expect(affixProblems(a as never), a.id).toEqual([])
    expect(affixProblems({ name: 'x', fx: { dragon: 1 } })).not.toEqual([])
    expect(affixProblems({ name: 'x', fx: { no_patrol: 1 } })).not.toEqual([])
    expect(affixProblems({ name: 'x', fx: { foe_plus: -1 } })).not.toEqual([])
    expect(affixProblems({ name: 'x', fx: { oneway: 2 } })).not.toEqual([])
    expect(affixProblems({ name: 'x', fx: { gate_dc: 99 } })).not.toEqual([])
    expect(affixProblems({ name: 'x' })).not.toEqual([])
    expect(affixProblems({ fx: {} })).not.toEqual([])
  })

  it('合起來：數字相加、旗標有一條就算、單向取最高', () => {
    expect(combineFx([{ foe_minus: 1, gate_dc: -2, no_patrol: true, oneway: 0.5 }, { foe_minus: 2, gate_dc: 1, oneway: 0.25 }, undefined])).toEqual({ foe_minus: 3, gate_dc: -1, no_patrol: true, oneway: 0.5 })
  })

  it('net_region 多了 affixes 與 temper；壞的擋下', () => {
    expect(regionProblems(DIGNET as never)).toEqual([])
    expect(regionProblems({ ...DIGNET, affixes: [1] } as never)).not.toEqual([])
    expect(regionProblems({ ...DIGNET, temper: { f_a: { gate_dc: -1 } } } as never)).toEqual([])
    expect(regionProblems({ ...DIGNET, temper: { f_a: { dragon: 1 } } } as never)).not.toEqual([])
  })

  it('netrun_rule 多了 round_minutes、keep_days、revisit_trace…：預設照工單，格式檢查', () => {
    const { game: g } = setup()
    expect(netrunRules(g.k)).toMatchObject({ round_minutes: 5, keep_days: 7, revisit_trace: 0.5, located_foe_plus: 1, leave_hostility: 20, leave_hostility_max: 5, located_hostility: 5, backdoor_clear: 0.5, dig_archive_plus: 1 })
    expect(ruleProblems({ round_minutes: 500 })).not.toEqual([])
    expect(ruleProblems({ revisit_trace: 2 })).not.toEqual([])
    expect(ruleProblems({ revisit_trace: 0.25, keep_days: 3 })).toEqual([])
  })
})

// ===================================================================================================================
// 二、生成
// ===================================================================================================================

describe('生成：層數與名字照設施類型，每一層照密度表放東西', () => {
  it('兩層的設施生成兩張圖、四層的四張；層的名字與地圖實例的 owner、ext.net.dig 都對', () => {
    const { game: g } = setup()
    dig(g)
    const r = run(g)
    expect(r.layers).toEqual(['l1', 'l2'])
    expect(Object.keys(ext(g).graph)).toEqual(['l1', 'l2'])
    expect(g.state.maps.instances[r.map]!.owner).toBe('netrun:dig:site_a')
    expect(ext(g).dig).toMatchObject({ site: 'site_a', facility: 'fac_two', names: ['staff', 'core'], affixes: [], visits: 1 })
    expect(ext(g).backdoors).toEqual([])
    expect(g.state.maps.instances[r.map]!.gen!.map.sheets.map((s) => s.name)).toEqual(['員工層', '核心層'])
    expect(netrunView(g.k, g.state)!.dig).toMatchObject({ site: 'site_a', facility: 'fac_two', visits: 1, backdoors: [] })
    const { game: g4 } = setup()
    dig(g4, { facility: 'fac_four' })
    expect(run(g4).layers).toEqual(['l1', 'l2', 'l3', 'l4'])
    expect(g4.state.maps.instances[run(g4).map]!.gen!.map.sheets.map((s) => s.name)).toEqual(['訪客層', '員工層', '管理層', '核心層'])
  })

  it('每層的遭遇 2～3、檔案庫 2～3（密度表 1～2 加自己去挖多一個）、陷阱 1～2、休息點 1、巡邏 1、控制節點照設施；二十個種子；最後一層的最後一場是首領戰的預算', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { game: g } = setup({ seed })
      dig(g, { facility: 'fac_four', seed })
      const net = ext(g)
      expect(Object.keys(net.graph), `種子 ${seed}`).toHaveLength(4)
      Object.keys(net.graph).forEach((sheet, i) => {
        const foes = Object.values(net.foes[sheet]!)
        expect(foes.length, `${seed}/${sheet} 遭遇`).toBeGreaterThanOrEqual(2)
        expect(foes.length).toBeLessThanOrEqual(3)
        const archives = marks(g, sheet, 'a').length
        expect(archives, `${seed}/${sheet} 檔案庫`).toBeGreaterThanOrEqual(2)
        expect(archives).toBeLessThanOrEqual(3)
        expect(net.traps[sheet]!.length, `${seed}/${sheet} 陷阱`).toBeGreaterThanOrEqual(1)
        expect(net.traps[sheet]!.length).toBeLessThanOrEqual(2)
        expect(marks(g, sheet, 'r'), `${seed}/${sheet} 休息點`).toHaveLength(1)
        expect(marks(g, sheet, 'c'), `${seed}/${sheet} 控制節點`).toHaveLength(1)
        expect(net.patrols.filter((p) => p.sheet === sheet), `${seed}/${sheet} 巡邏`).toHaveLength(1)
        // 預算（ENEMIES 第 13 節）：一般 4 點、閘門前的層主 6 點、最後一層的最後一場 8 點
        const pts = (f: { foes: Array<Rec> }) => f.foes.reduce((s, u) => s + POINTS_FOR_TEST[u.rank as 'minion' | 'elite' | 'boss'], 0)
        const gate = foes.filter((f) => f.gate)
        expect(gate, `${seed}/${sheet} 守閘門的`).toHaveLength(1)
        expect(pts(gate[0]!)).toBe(i === 3 ? 8 : 6)
        for (const f of foes.filter((x) => !x.gate)) expect(pts(f)).toBe(4)
        if (i === 3) expect(gate[0]!.foes.map((u) => u.rank)).toEqual(['boss', 'minion', 'minion', 'minion'])
      })
    }
  })

  it('一般的遭遇每一隻都有勢力、等級、層的名字（單位來源 enemy_pick 挑得到）', () => {
    const { game: g } = setup()
    dig(g, { facility: 'fac_four' })
    const first = Object.values(ext(g).foes.l1!)[0]!
    expect(first.foes[0]).toMatchObject({ from: 'enemy_pick', faction: 'f_a', grade: 1, layer: 'guest' })
  })

  it('設施類型沒寫就擲（種子導出，同一個種子永遠同一種）；寫了查不到的擋下並說明', () => {
    const { game: a } = setup()
    dig(a, { facility: undefined, seed: 3 })
    const { game: b } = setup()
    dig(b, { facility: undefined, seed: 3 })
    expect(ext(a).dig!.facility).toBe(ext(b).dig!.facility)
    expect(['fac_two', 'fac_four']).toContain(ext(a).dig!.facility)
    const { game: c } = setup()
    expect(() => dig(c, { facility: 'nope' })).toThrow(/找不到設施類型/)
    expect(() => dig(c, { site: undefined })).toThrow(/site/)
    expect(() => dig(c, { affixes: ['nope'] })).toThrow(/找不到詞條/)
    expect(readRun(c.state)).toBeNull()
  })

  it('委託的階段（face.net）不收 entry: dig', () => {
    const { game: g } = setup()
    expect(() => g.launch(ACT_FACE, { region: 'digtest', entry: 'dig', site: 'x', facility: 'fac_two', grade: 1 }, { by: 'commission' })).toThrow()
  })
})

// ===================================================================================================================
// 三、詞條
// ===================================================================================================================

describe('詞條：各驗一條', () => {
  const foeCount = (g: G, sheet: string) => Object.keys(ext(g).foes[sheet]!).length

  it('foe_minus：每一層少一場遭遇', () => {
    const { game: a } = setup()
    dig(a, { seed: 4 })
    const base = Object.keys(ext(a).graph).map((s) => foeCount(a, s))
    const { game: b } = setup()
    dig(b, { seed: 4, affixes: ['a_foe_minus'] })
    const less = Object.keys(ext(b).graph).map((s) => foeCount(b, s))
    expect(less.every((n) => n >= 1 && n <= 2)).toBe(true)
    expect(base.every((n) => n >= 2 && n <= 3)).toBe(true)
  })

  it('no_patrol：沒有巡邏；追蹤度到 30 也不會多出來', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_no_patrol'] })
    expect(ext(g).patrols).toEqual([])
    setTrace(g, 35)
    expect(ext(g).patrols).toEqual([])
    expect(ext(g).t30).toBe(true)
  })

  it('trap_marked：陷阱一開始就看得到（格子是警報節點或迴圈碎片，記成察覺過了）', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_marked'], facility: 'fac_four' })
    for (const [sheet, list] of Object.entries(ext(g).traps)) {
      expect(list.length).toBeGreaterThan(0)
      for (const t of list) {
        expect(t.found).toBe(true)
        expect(t.checked).toBe(true)
        expect(sheetById(g, run(g).map, sheet).kindAt(t.at[0], t.at[1])).toBe(t.kind)
      }
    }
    // 沒有這一條時看不到
    const { game: h } = setup()
    dig(h, { facility: 'fac_four' })
    for (const [sheet, list] of Object.entries(ext(h).traps)) for (const t of list) expect(sheetById(h, run(h).map, sheet).kindAt(t.at[0], t.at[1])).toBe('floor')
  })

  it('layer_plus：多一層（多的那一層名字照前一層，最後一層的檔案庫多擲一次）', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_layer_plus'] })
    expect(run(g).layers).toEqual(['l1', 'l2', 'l3'])
    expect(ext(g).dig!.names).toEqual(['staff', 'staff', 'core'])
    expect(Object.keys(ext(g).dig!.rolls)).toEqual(['l3'])
    expect(Object.keys(ext(g).dig!.rolls.l3!)).toHaveLength(marks(g, 'l3', 'a').length)
    expect(netrunView(g.k, g.state)!.layer.total).toBe(3)
  })

  it('trace_start: 10：從 10 起算（peak 也是 10）', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_trace10'] })
    expect(trace(g)).toBe(10)
    expect(run(g).peak).toBe(10)
  })

  it('gate_dc：系統更新讓閘門 DC −2（到 30 之後照樣加）；脾氣（temper）讓那家企業的子網閘門 DC −1', () => {
    const { game: a } = setup()
    dig(a, { affixes: ['a_gate'] })
    expect(gateDc(a.k, ext(a))).toBe(ext(a).dc - 2)
    setTrace(a, 35)
    expect(gateDc(a.k, ext(a))).toBe(ext(a).dc - 2 + 2)
    const { game: b } = setup()
    dig(b, { region: 'digtemper' })
    expect(ext(b).dig!.fx).toMatchObject({ gate_dc: -1 })
    expect(gateDc(b.k, ext(b))).toBe(ext(b).dc - 1)
  })

  it('check_mod：訊號不穩，主控的介面檢定差 1；拔線與別的檢定不受影響', () => {
    const total = (affixes: string[]): number => {
      const { game: g } = setup({ seed: 8 })
      dig(g, { seed: 9, affixes })
      const pick = pickAdmin(g.k, g.state)!
      return rollPicked(g.k, g.state, pick, 12, 'netrun/test/mod', ['netrun']).total
    }
    expect(total(['a_signal'])).toBe(total([]) - 1)
  })

  it('all_pink：所有的敵人（含白蕾絲）都挑粉的；white_plus：每一層多一隻白蕾絲（all_pink 時是粉的）', () => {
    const { game: a } = setup()
    dig(a, { affixes: ['a_pink'] })
    const refs = Object.values(ext(a).foes).flatMap((l) => Object.values(l).flatMap((f) => f.foes)).concat(ext(a).patrols.flatMap((p) => p.foes))
    expect(refs.length).toBeGreaterThan(4)
    expect(refs.every((u) => u.color === 'pink')).toBe(true)
    const { game: b } = setup()
    dig(b, { affixes: ['a_white'] })
    for (const sheet of ['l1', 'l2']) {
      const whites = Object.values(ext(b).foes[sheet]!).flatMap((f) => f.foes).filter((u) => u.color === 'white')
      expect(whites, sheet).toHaveLength(1)
      expect(whites[0]).toMatchObject({ rank: 'minion', from: 'enemy_pick' })
    }
    const { game: c } = setup()
    dig(c, { affixes: ['a_white', 'a_pink'] })
    expect(Object.values(ext(c).foes.l1!).flatMap((f) => f.foes).some((u) => u.color === 'white')).toBe(false)
  })

  it('hot_spot：一場遭遇的敵人等級 +1，那一場後面的檔案庫多擲一次（開檔案庫拿到兩份）', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_hot', 'a_no_patrol'], seed: 7 })
    const all = Object.values(ext(g).foes).flatMap((l) => Object.values(l)).flatMap((f) => f.foes)
    expect(all.filter((u) => u.grade === 2)).not.toHaveLength(0)
    expect(all.filter((u) => u.grade === 2).length).toBeLessThan(all.length)
    const [sheet, ids] = Object.entries(ext(g).dig!.rolls)[0]!
    expect(Object.values(ids)).toEqual([1])
    // 站上那個檔案庫開一次：兩份
    const marker = marks(g, sheet, 'a').find((m) => m.id === Object.keys(ids)[0])!
    commit(g, [{ op: 'map.at', to: { map: run(g).map, sheet, x: marker.at[0], y: marker.at[1] } }])
    const before = run(g).loot.length
    apply(g, 'loot')
    expect(run(g).loot.length).toBeGreaterThanOrEqual(before + 2)
  })

  it('first_ambush（寂靜）：第一場遭遇我方先手；潛行沒過的先攻仍在對方；巡邏不算', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_ambush', 'a_no_trap'], seed: 5 })
    const foe = marks(g, 'l1', 'f')[0]!
    const standNear = (): void => {
      const reach = currentSheet(g).reachable({ x: g.state.maps.at!.x, y: g.state.maps.at!.y })
      const spot = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [foe.at[0] + dx, foe.at[1] + dy] as [number, number]).find((p) => reach.has(key(p)))!
      goTo(g, spot)
    }
    standNear()
    const d = useNode(g.k, g.state, 'fight', foe.id)
    expect(d.launch![0]!.setup).toMatchObject({ edge: 'ally' })
    expect(((d.launch![0]!.origin!.ext as Rec).net as Rec).ambush).toBe(true)
    // 沒有這一條的：沒有 edge
    const { game: h } = setup()
    dig(h, { affixes: ['a_no_patrol', 'a_no_trap'], seed: 5 })
    const f2 = marks(h, 'l1', 'f')[0]!
    const reach = currentSheet(h).reachable({ x: h.state.maps.at!.x, y: h.state.maps.at!.y })
    goTo(h, ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).map(([dx, dy]) => [f2.at[0] + dx, f2.at[1] + dy] as [number, number]).find((p) => reach.has(key(p)))!)
    expect((useNode(h.k, h.state, 'fight', f2.id).launch![0]!.setup as Rec).edge).toBeUndefined()
  })

  it('oneway：單向的鏈路（有的種子放得出來）', () => {
    let found = false
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const { game: g } = setup({ seed })
      dig(g, { seed, affixes: ['a_oneway'] })
      found = Object.values(ext(g).graph).some((gr) => gr.edges.some((e) => e.oneway))
    }
    expect(found).toBe(true)
  })

  it('剛被翻過：遭遇、檔案庫、陷阱各少一個（組合）', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_combo'] })
    for (const sheet of ['l1', 'l2']) {
      expect(foeCount(g, sheet)).toBeLessThanOrEqual(2)
      expect(marks(g, sheet, 'a').length).toBeLessThanOrEqual(2)
      expect(ext(g).traps[sheet]!.length).toBeLessThanOrEqual(1)
    }
  })

  it('擲詞條：這一區的詞條表擲一次，III 級以上再擲一次共通詞條（沒有 region 的）；指定的詞條不擲', () => {
    const { game: a } = setup()
    dig(a, { region: 'digrolled', affixes: undefined, seed: 21 })
    expect(ext(a).dig!.affixes).toHaveLength(1)
    expect(['a_no_patrol', 'a_foe_minus']).toContain(ext(a).dig!.affixes[0])
    const { game: b } = setup()
    dig(b, { region: 'digrolled', affixes: undefined, grade: 3, seed: 21 })
    expect(ext(b).dig!.affixes).toHaveLength(2)
    expect(ext(b).dig!.affixes[0]).toBe(ext(a).dig!.affixes[0])
    expect(['a_foe_minus', 'a_no_patrol']).not.toContain(ext(b).dig!.affixes[1])
    const common = AFFIXES.filter((x) => !('region' in x)).map((x) => x.id)
    expect(common).toContain(ext(b).dig!.affixes[1])
    // 同一個種子、同一份狀態永遠一樣
    const { game: c } = setup()
    dig(c, { region: 'digrolled', affixes: undefined, grade: 3, seed: 21 })
    expect(ext(c).dig!.affixes).toEqual(ext(b).dig!.affixes)
  })
})

// ===================================================================================================================
// 四、追蹤度的起點
// ===================================================================================================================

describe('進去的起點：那家的敵對值分段、詞條、後門、再進去', () => {
  const setHostility = (g: G, n: number) => commit(g, [{ op: 'meter', kind: 'hostility', key: 'f_a', set: n }])

  it('N16：沒有敵對是 0；記名（20 以上）15；通緝（100）30', () => {
    const start = (h: number): number => {
      const { game: g } = setup()
      setHostility(g, h)
      dig(g)
      return trace(g)
    }
    expect(start(0)).toBe(0)
    expect(start(25)).toBe(15)
    expect(start(100)).toBe(30)
    // 詞條的起始值（稽核週：從 10 起算）和敵對值分段的起始值取最高的，不相加（N16、M3 審查建議 5）：記名 15 對 10 取 15；沒有敵對值時詞條的 10
    const { game: g } = setup()
    setHostility(g, 25)
    dig(g, { affixes: ['a_trace10'] })
    expect(trace(g)).toBe(15)
    const { game: h } = setup()
    dig(h, { affixes: ['a_trace10'] })
    expect(trace(h)).toBe(10)
  })

  it('沒有裝敵對值的功能（沒有條件 hostility_tier）：照 0 起算，不丟錯', () => {
    const t = makeGame({ seed: 5, features: [enemiesFeature, exploreFeature, netrunFeature, TEST_NET_COMBAT, STATS, COMBAT, SPY, TEST_ACTIVITY], content: [PACK], pc: { attrs: { intellect: 14 }, ext: { testdeck: 1 } } as never })
    dig(t.game)
    expect(trace(t.game)).toBe(0)
  })
})

// ===================================================================================================================
// 五、走完、時間、離開時的敵對值
// ===================================================================================================================

describe('走完兩層從出口離開：done、東西都在、時間照探索回合加、敵對值照離開時的追蹤度加', () => {
  it('走完兩層：done、帶出去的東西都在、時間 = 探索回合 × 5 分鐘、敵對值 = ceil(追蹤度 / 20)；地圖留著、人不在地圖上', () => {
    const { game: g } = setup()
    ENDS.length = 0
    digClear(g)
    const t0 = minutes(g)
    // 第一層：開一個檔案庫、走到閘門
    const a = currentSheet(g).def.cells!.find((m) => m.mark === 'a')!
    goTo(g, a.at)
    apply(g, 'loot')
    expect(run(g).loot.length).toBeGreaterThan(0)
    descendNow(g)
    expect(run(g).layer).toBe(1)
    setTrace(g, 45)
    walkToMark(g, 'g')
    const loot = clone(run(g).loot)
    const map = run(g).map
    g.commit(useNode(g.k, g.state, 'pass'))
    // 結束
    const end = lastEnd()
    expect(end.outcome).toBe('done')
    expect(end.result).toMatchObject({ goal: true, trace: 45, site: 'site_a', kept: true, hostility: { faction: 'f_a', delta: 3 } })
    expect(end.result.loot).toEqual(loot)
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    // 東西都在（item 與 cred 的增加是檔案庫給的，沒有被丟）
    for (const l of loot) if (l.kind === 'item') expect(g.state.inventory.find((s) => s.id === l.id)?.qty).toBeGreaterThanOrEqual(l.qty)
    // 時間：探索回合 × 5 分鐘
    expect(minutes(g) - t0).toBe((end.result.rounds as number) * 5)
    expect(end.result.rounds).toBeGreaterThan(0)
    // 敵對值：45 → 3
    expect(hostility(g)).toBe(3)
    // 地圖留著，left 記下離開時的樣子
    const kept = keptOf(g.state, 'site_a')!
    expect(kept.id).toBe(map)
    expect(netExt(g.state, map)!.left).toEqual({ at: minutes(g), trace: 45 })
  })

  it('敵對值最多加 5（追蹤度 100 也一樣）；追蹤度 0 不加', () => {
    const { game: g } = setup()
    digClear(g)
    setTrace(g, 80)
    commit(g, [{ op: 'meter', kind: 'trace', key: run(g).map, set: 80 }])
    g.commit(logout(g.k, g.state))
    expect(hostility(g)).toBe(4)
    const { game: h } = setup()
    digClear(h)
    h.commit(logout(h.k, h.state))
    expect(hostility(h)).toBe(0)
    const { game: i } = setup()
    digClear(i)
    setTrace(i, 89)
    i.commit(logout(i.k, i.state))
    expect(hostility(i)).toBe(5)
  })

  it('時間：委託的階段（face.net）不算；自己去的那一趟每個探索回合 5 分鐘（規則表可以改）；戰鬥不另外算', () => {
    const { game: g } = setup()
    digClear(g)
    const t0 = minutes(g)
    advance(g, 3)
    expect(run(g).round).toBe(3)
    expect(minutes(g) - t0).toBe(15)
    const t = makeGame({
      seed: 5, features: FEATURES, pc: { attrs: { intellect: 14, resolve: 14 }, ext: { testdeck: 1 } } as never,
      content: [PACK, { id: 'rule', content: { netrun_rule: [{ id: 'default', round_minutes: 2 }] } } as never],
    })
    digClear(t.game)
    const t1 = minutes(t.game)
    advance(t.game, 3)
    expect(minutes(t.game) - t1).toBe(6)
  })

  it('內海的基礎消退是 0：探索回合的感載不消退；衍生數值 net_load_decay（甲板的散熱、技能、藥……）有多少，每個探索回合就消退多少', () => {
    const load = (cooling: number): number => {
      const { game: g } = setup({ cooling })
      digClear(g)
      commit(g, [{ op: 'actor.track', id: 'pc', track: 'load', delta: 12 }])
      advance(g, 1)
      return g.state.actors.pc!.load
    }
    expect(load(0)).toBe(12)
    expect(load(3)).toBe(9)
  })

  it('deck 定義衍生數值 deck_cooling：讀甲板的 cooling，沒有甲板是 0', () => {
    const deckPack = {
      id: 'deck_cool', content: {
        skill: [{ id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' }],
        deck: [{ id: 'dk_c', name: '冷卻甲板', desc: '有冷卻。', grade: 2, slots: 4, firewall: 12, legal: 'free', cooling: 3 }, { id: 'dk_n', name: '普通甲板', desc: '沒有冷卻。', grade: 1, slots: 2, firewall: 10, legal: 'free' }],
      },
    } as unknown as ContentPack
    const t = makeGame({ seed: 5, features: [deckFeature], content: [deckPack], pc: { attrs: { intellect: 12 } } as never, patch: { inventory: [{ id: 'dk_c', qty: 1, data: { uid: 'D1' } }, { id: 'dk_n', qty: 1, data: { uid: 'D2' } }] as never } })
    const g = t.game
    expect(g.k.stats.hasStat('deck_cooling')).toBe(true)
    expect(g.k.stats.stat(g.state, 'pc', 'deck_cooling')).toBe(0)
    g.commit(equipDraft(g.k, g.state, 'pc', 'D1'))
    expect(deckOf(g.k, g.state, 'pc').has).toBe(true)
    expect(g.k.stats.stat(g.state, 'pc', 'deck_cooling')).toBe(3)
    g.commit(equipDraft(g.k, g.state, 'pc', 'D2'))
    expect(g.k.stats.stat(g.state, 'pc', 'deck_cooling')).toBe(0)
  })
})

// ===================================================================================================================
// 六、再進去
// ===================================================================================================================

describe('中途登出再進同一座：版面、處理過的節點一樣，追蹤度是上次的一半；過了八天是新的', () => {
  it('七天內：同一份地圖實例、版面一樣、拿過的檔案庫與處理過的節點照舊、追蹤度從上次的一半起算；巡邏回到起點', () => {
    const { game: g } = setup()
    dig(g, { encounter: [], affixes: ['a_no_trap'], seed: 6 })
    const map = run(g).map
    const layout = clone(g.state.maps.instances[map]!.gen!.map)
    const a = currentSheet(g).def.cells!.find((m) => m.mark === 'a')!
    goTo(g, a.at)
    apply(g, 'loot')
    const usedBefore = clone(ext(g).used)
    expect(usedBefore.l1).toContain(a.id)
    // 巡邏走了幾步
    advance(g, 4)
    expect(ext(g).patrols[0]!.step).toBeGreaterThan(0)
    setTrace(g, 41)
    g.commit(logout(g.k, g.state))
    expect(readRun(g.state)).toBeNull()
    const left = netExt(g.state, map)!.left!
    expect(left.trace).toBe(41)
    // 三天後再進去
    commit(g, [{ op: 'time', minutes: 3 * 1440 }])
    expect(keptOf(g.state, 'site_a')!.id).toBe(map)
    dig(g, { encounter: [], affixes: ['a_no_trap'], seed: 999 })
    expect(run(g).map).toBe(map)
    expect(g.state.maps.instances[map]!.gen!.map).toEqual(layout)
    expect(ext(g).used).toEqual(usedBefore)
    expect(trace(g)).toBe(20)
    expect(run(g).round).toBe(0)
    expect(ext(g).dig!.visits).toBe(2)
    expect(ext(g).left).toBeUndefined()
    expect(ext(g).patrols.every((p) => p.step === 0 && p.at === p.route[0])).toBe(true)
    // 站在第一層的入口
    expect(g.state.maps.at).toMatchObject({ map, sheet: 'l1' })
    expect(g.state.maps.at!.x).toBe(marks(g, 'l1', 'E')[0]!.at[0])
    // 拿過的檔案庫第二次灰掉
    goTo(g, a.at)
    expect(() => useNode(g.k, g.state, 'loot')).toThrow(/已經打開過/)
    expect(g.state.maps.seq).toBe(1)
  })

  it('追蹤度：敵對值分段的起始值與上次的一半取高的', () => {
    const { game: g } = setup()
    digClear(g)
    setTrace(g, 10)
    g.commit(logout(g.k, g.state))
    commit(g, [{ op: 'meter', kind: 'hostility', key: 'f_a', set: 25 }])
    digClear(g)
    expect(trace(g)).toBe(15)
  })

  it('剛好七天還算同一張；過了八天是新的一張（舊的被清掉，在 time.passed）', () => {
    const { game: a } = setup()
    digClear(a)
    const m0 = run(a).map
    a.commit(logout(a.k, a.state))
    commit(a, [{ op: 'time', minutes: 7 * 1440 }])
    expect(keptOf(a.state, 'site_a')?.id).toBe(m0)
    digClear(a)
    expect(run(a).map).toBe(m0)

    const { game: b } = setup()
    digClear(b, { seed: 12 })
    const old = run(b).map
    const oldLayout = clone(b.state.maps.instances[old]!.gen!.map)
    setTrace(b, 40)
    b.commit(logout(b.k, b.state))
    commit(b, [{ op: 'time', minutes: 8 * 1440 }])
    expect(b.state.maps.instances[old]).toBeUndefined()
    expect(b.state.reports.some((r) => r.action === 'netrun.expire')).toBe(true)
    digClear(b, { seed: 13 })
    expect(run(b).map).not.toBe(old)
    expect(b.state.maps.instances[run(b).map]!.gen!.map).not.toEqual(oldLayout)
    expect(trace(b)).toBe(0)
    expect(ext(b).dig!.visits).toBe(1)
  })

  it('掛點沒來得及清的過期的（時間不是用 time 變更過去的）：下次進去時在同一份報告裡清掉、生成新的', () => {
    const { game: g } = setup()
    digClear(g, { seed: 12 })
    const old = run(g).map
    g.commit(logout(g.k, g.state))
    const net = clone(ext2(g, old))
    net.left = { at: 0, trace: 0 }
    commit(g, [{ op: 'time', minutes: 9 * 1440 }])
    // 時間過了之後掛點已經清掉了；再造一份過期的留著：手動把一個新的 left.at 寫舊
    digClear(g, { seed: 14 })
    const mid = run(g).map
    g.commit(logout(g.k, g.state))
    commit(g, [{ op: 'map.ext', map: mid, value: { net: { ...clone(ext2(g, mid)), left: { at: 0, trace: 5 } } } }])
    expect(keptOf(g.state, 'site_a')?.id).toBe(mid)
    digClear(g, { seed: 15 })
    expect(run(g).map).not.toBe(mid)
    expect(g.state.maps.instances[mid]).toBeUndefined()
    expect(trace(g)).toBe(0)
  })

  it('人還在裡面的、站在上面的不清；不是自己去挖的地圖不清', () => {
    const { game: g } = setup()
    digClear(g)
    commit(g, [{ op: 'time', minutes: 30 * 1440 }])
    expect(readRun(g.state)).not.toBeNull()
    expect(g.state.maps.instances[run(g).map]).toBeDefined()
    expect(expireDraft(g.k, g.state, minutes(g))).toBeUndefined()
  })

  it('不同的 site 是不同的地圖；同一個 site 同一時間只有一份', () => {
    const { game: g } = setup()
    digClear(g, { site: 's1' })
    const m1 = run(g).map
    g.commit(logout(g.k, g.state))
    digClear(g, { site: 's2' })
    expect(run(g).map).not.toBe(m1)
    g.commit(logout(g.k, g.state))
    expect(keptOf(g.state, 's1')!.id).toBe(m1)
    expect(Object.values(g.state.maps.instances).filter((m) => m.owner === 'netrun:dig:s1')).toHaveLength(1)
    digClear(g, { site: 's1' })
    expect(run(g).map).toBe(m1)
  })
})

// ===================================================================================================================
// 七、後門
// ===================================================================================================================

describe('後門：留在這一層，下次從那一層直接進來，追蹤度 0', () => {
  it('有主控的人花一個探索回合留後門；一層一個；沒有主控的隊伍沒有這一項；委託的階段沒有', () => {
    const { game: g } = setup()
    digClear(g)
    expect(freeUses(g.k, g.state).map((u) => u.id)).toContain('backdoor')
    const t0 = minutes(g)
    apply(g, 'backdoor')
    expect(ext(g).backdoors).toEqual(['l1'])
    expect(run(g).round).toBe(1)
    expect(minutes(g) - t0).toBe(5)
    expect(freeUses(g.k, g.state).find((u) => u.id === 'backdoor')!.block).toMatch(/已經留過/)
    expect(() => useNode(g.k, g.state, 'backdoor')).toThrow(/已經留過/)
    expect(netrunView(g.k, g.state)!.dig!.backdoors).toEqual(['員工層'])
    const { game: h } = setup({ master: false })
    digClear(h)
    expect(freeUses(h.k, h.state).map((u) => u.id)).not.toContain('backdoor')
    expect(() => useNode(h.k, h.state, 'backdoor')).toThrow(/主控/)
  })

  it('留在第二層的後門：從那一層進來，站在那一層的入口，追蹤度 0（不管上次離開時多高、敵對值多高）', () => {
    const { game: g } = setup()
    digClear(g)
    descendNow(g)
    apply(g, 'backdoor')
    expect(ext(g).backdoors).toEqual(['l2'])
    setTrace(g, 70)
    g.commit(logout(g.k, g.state))
    expect(netExt(g.state, keptOf(g.state, 'site_a')!.id)!.left!.trace).toBe(70)
    commit(g, [{ op: 'meter', kind: 'hostility', key: 'f_a', set: 100 }])
    digClear(g, { from_backdoor: 'l2' })
    expect(run(g).layer).toBe(1)
    expect(g.state.maps.at).toMatchObject({ sheet: 'l2' })
    expect([g.state.maps.at!.x, g.state.maps.at!.y]).toEqual(marks(g, 'l2', 'E')[0]!.at)
    expect(trace(g)).toBe(0)
    expect(ext(g).backdoors).toEqual(['l2'])
    expect(run(g).setup.from_backdoor).toBe('l2')
  })

  it('沒有留後門的那一層不能從那裡進來；從後門進來的條件要有原因', () => {
    const { game: g } = setup()
    digClear(g)
    g.commit(logout(g.k, g.state))
    expect(() => digClear(g, { from_backdoor: 'l2' })).toThrow(ActionBlocked)
    expect(() => digClear(g, { from_backdoor: 'l9' })).toThrow(/後門/)
    expect(readRun(g.state)).toBeNull()
  })
})

// ===================================================================================================================
// 八、被定位
// ===================================================================================================================

describe('被定位：後門照固定的骰面被清掉、再進去每一場遭遇多一個雜兵、敵對值多 5', () => {
  /** 掃一個種子：l1 的後門會被清掉、l2 的不會（骰面由種子、層與第幾次進去固定）。地圖實例是這一局的第一張，id 是 m1。 */
  function seedFor(clearL1: boolean, clearL2: boolean): number {
    for (let seed = 1; seed < 400; seed++) {
      if (backdoorClears(seed, 'm1', 'l1', 1, 0.5) === clearL1 && backdoorClears(seed, 'm1', 'l2', 1, 0.5) === clearL2) return seed
    }
    throw new Error('找不到種子')
  }

  it('追蹤度到 90、三個探索回合後被定位：結束是 located；後門清掉的與留下的各照骰面；敵對值 = 5（追蹤度）+ 5；left 記 located', () => {
    const seed = seedFor(true, false)
    const { game: g } = setup()
    ENDS.length = 0
    digClear(g, { seed })
    apply(g, 'backdoor')
    descendNow(g)
    apply(g, 'backdoor')
    expect(ext(g).backdoors).toEqual(['l1', 'l2'])
    const map = run(g).map
    expect(map).toBe('m1')
    setTrace(g, 90)
    expect(run(g).located).toBe(3)
    advance(g, 3)
    expect(readRun(g.state)).toBeNull()
    const end = lastEnd()
    expect(end.outcome).toBe('located')
    expect(end.result).toMatchObject({ located: true, site: 'site_a', hostility: { faction: 'f_a', delta: 10 }, cleared: 1, backdoors: 1 })
    expect(netExt(g.state, map)!.backdoors).toEqual(['l2'])
    expect(netExt(g.state, map)!.left).toMatchObject({ located: true, trace: 90 })
    expect(hostility(g)).toBe(10)
    // 沒有被定位、追蹤度 89 的離開只有 5
    const { game: h } = setup()
    digClear(h)
    setTrace(h, 89)
    h.commit(logout(h.k, h.state))
    expect(hostility(h)).toBe(5)
  })

  it('再進去：每一場還沒處理的遭遇多一個雜兵，只多一次；被定位過的追蹤度從一半（45）起算', () => {
    const { game: g } = setup()
    dig(g, { seed: 31, affixes: ['a_no_patrol', 'a_no_trap'] })
    const counts = (): number[] => Object.values(ext(g).foes).flatMap((l) => Object.values(l).map((f) => f.foes.length))
    const before = counts()
    setTrace(g, 90)
    advance(g, 3)
    expect(lastEnd().outcome).toBe('located')
    dig(g, { seed: 31, affixes: ['a_no_patrol', 'a_no_trap'] })
    const after = counts()
    expect(after).toEqual(before.map((n) => n + 1))
    expect(trace(g)).toBe(45)
    expect(ext(g).dig!.located_plus).toBe(true)
    // 再正常離開再進去：不再多
    g.commit(logout(g.k, g.state))
    dig(g, { seed: 31, affixes: ['a_no_patrol', 'a_no_trap'] })
    expect(counts()).toEqual(after)
  })

  it('戰敗被接受的離開也留著地圖、記 left（不算被定位時不清後門、不加那 5）', () => {
    const { game: g } = setup()
    dig(g, { affixes: ['a_no_patrol', 'a_no_trap'], seed: 40 })
    apply(g, 'backdoor')
    const map = run(g).map
    setTrace(g, 40)
    // 戰敗被接受：直接送 activity.end（defeat、accept），帶 origin.ext.net.run
    const r = run(g)
    const hooks = g.k.hooks.run('activity.end', { state: g.state, kind: 'defeat', id: 'd1', origin: { by: 'netrun', ref: r.id, ext: { net: { run: r.id } } }, outcome: 'accept', result: { net: true } })
    expect(hooks.length).toBeGreaterThan(0)
    const changes = hooks.flatMap((h) => (isObj(h.result) && Array.isArray((h.result as Rec).changes) ? ((h.result as Rec).changes as Change[]) : []))
    commit(g, changes, 'netrun.defeat_test')
    expect(readRun(g.state)).toBeNull()
    expect(g.state.maps.at).toBeNull()
    expect(netExt(g.state, map)!.left).toEqual({ at: minutes(g), trace: 40 })
    expect(netExt(g.state, map)!.backdoors).toEqual(['l1'])
    expect(hostility(g)).toBe(2)
  })
})

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null

// ===================================================================================================================
// 九、存檔
// ===================================================================================================================

describe('留著三座子網的存檔讀回來一樣', () => {
  it('三座各在不同的狀態（處理過的節點、後門、被定位）：存檔、讀檔，地圖與 ext.net 一樣；接著再進去的結果一樣；存檔的大小', () => {
    const { game: a } = setup()
    // 第一座：兩層，開了檔案庫、留了後門
    digClear(a, { site: 's1', seed: 51 })
    goTo(a, currentSheet(a).def.cells!.find((m) => m.mark === 'a')!.at)
    apply(a, 'loot')
    apply(a, 'backdoor')
    setTrace(a, 30)
    a.commit(logout(a.k, a.state))
    // 第二座：四層
    digClear(a, { site: 's2', seed: 52, facility: 'fac_four' })
    descendNow(a)
    a.commit(logout(a.k, a.state))
    // 第三座：被定位
    dig(a, { site: 's3', seed: 53, affixes: ['a_no_patrol', 'a_no_trap'] })
    setTrace(a, 90)
    advance(a, 3)
    expect(Object.values(a.state.maps.instances).filter((m) => m.owner?.startsWith('netrun:dig:'))).toHaveLength(3)
    const raw = a.save()
    // 回報用的數字：留著三座子網（兩層、四層、兩層）的存檔大小；比沒有留著的那一份大多少
    const maps = JSON.stringify(a.state.maps).length
    process.stderr.write(`[M3-netrun-dig] 存檔 ${raw.length} 字元（${(raw.length / 1024).toFixed(1)} KB），其中 state.maps ${maps} 字元（${(maps / 1024).toFixed(1)} KB）\n`)
    expect(raw.length).toBeLessThan(400 * 1024)
    const { game: b } = setup({ seed: 123 })
    expect(b.load(raw)).toBeNull()
    expect(b.state.maps).toEqual(a.state.maps)
    for (const site of ['s1', 's2', 's3']) {
      expect(netExt(b.state, keptOf(b.state, site)!.id)).toEqual(netExt(a.state, keptOf(a.state, site)!.id))
    }
    // 接著再進去 s1、s3：結果一樣
    const next = (g: G) => {
      digClear(g, { site: 's1', seed: 7 })
      const one = { map: run(g).map, trace: trace(g), at: clone(g.state.maps.at), used: clone(ext(g).used), backdoors: clone(ext(g).backdoors) }
      g.commit(logout(g.k, g.state))
      dig(g, { site: 's3', seed: 7, affixes: ['a_no_patrol', 'a_no_trap'] })
      const three = { map: run(g).map, trace: trace(g), foes: clone(ext(g).foes) }
      return { one, three }
    }
    expect(next(b)).toEqual(next(a))
  })

  it('舊的存檔（沒有 backdoors、dig 的）也讀得出來：補空的；沒有 dig 的圖不當成留著的', () => {
    const { game: g } = setup()
    digClear(g)
    const map = run(g).map
    const net = clone(g.state.maps.instances[map]!.ext!.net) as Rec
    delete net.backdoors
    delete net.dig
    commit(g, [{ op: 'map.ext', map, value: { net } }])
    expect(ext(g).backdoors).toEqual([])
    expect(netrunView(g.k, g.state)!.dig).toBeNull()
  })
})

// ===================================================================================================================
// 十、相容
// ===================================================================================================================

describe('不是自己去挖的行為不變', () => {
  it('沒有 entry 的 netrun：結束照舊關掉地圖、不留著、不加敵對值、時間照新的規則（自己的那一趟每個探索回合 5 分鐘）', () => {
    const { game: g } = setup()
    g.launch(ACT_NET, { region: 'digtest', grade: 1, faction: 'f_a', layer: 'staff', seed: 3, encounter: [] }, { by: 'core' })
    const map = run(g).map
    setTrace(g, 60)
    g.commit(logout(g.k, g.state))
    expect(g.state.maps.instances[map]).toBeUndefined()
    expect(hostility(g)).toBe(0)
    expect(keptOf(g.state, 'site_a')).toBeUndefined()
  })
})
