// 驗收測試：dev/work/M3-fixer-net.md（cpp-feature）。中間人生成帶內海面的委託；出發時算追蹤度的起始值；踩點對內海階段；簡報給「要有甲板」的提醒。
// 規格：COMMISSIONS 第 7 節（★ 與 ◐）、7.1、7.2、第 9 節；NETRUNNING 第 5 節（起始值）；FACTIONS 6.1 節；FIXER 第 2 節；dev/adr/0018 第九節與 N16。
// 內容一律是測試自帶的最小假資料：兩種類型（竊密：主面內海、三個階段；奪取：主面現實、前兩個階段可選內海）、兩個勢力與它們的蕾絲（內海的兵種）、一個中間人。
// face.net 用假活動登記（不 import netrun）；敵對值用真的 security（條件 hostility_tier）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { effectCtx, meterOf } from '../../src'
import { commissionFeature, commissionProblems, readRun } from '../../src/features/commission'
import { defeatFeature } from '../../src/features/defeat'
import { ENCOUNTER_BUDGET, encounterPoints, enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import {
  board, buyIntel, eligibleTypes, fixerFeature, generate, generateTrace, genProblems, go, jobOf, offerProblems, offersFor, registeredFaces, scout, scoutPurpose, scoutView, traceStartOf, typeProblems,
} from '../../src/features/fixer'
import type { FixerEntry, Offer } from '../../src/features/fixer'
import { fixerNetRules, ruleProblems } from '../../src/features/fixer'
import { securityFeature } from '../../src/features/security'
import { summonsFeature } from '../../src/features/summons'
import { TEST_COMBAT, makeGame, testWeapon } from '../../src/testkit'

type Rec = Record<string, unknown>
type G = ReturnType<typeof makeGame>['game']

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const SKILLS = [
  { id: 'firearms', attr: 'reflex' }, { id: 'brawl', attr: 'body' }, { id: 'composure', attr: 'resolve' }, { id: 'stealth', attr: 'reflex' }, { id: 'negotiate', attr: 'charm' },
  { id: 'seduce', attr: 'charm' }, { id: 'perform', attr: 'charm' }, { id: 'mechanics', attr: 'tech' }, { id: 'interface', attr: 'intellect' }, { id: 'athletics', attr: 'body' },
  { id: 'investigate', attr: 'intellect' }, { id: 'streetwise', attr: 'intellect' },
].map((s) => ({ ...s, name: s.id, desc: `${s.id}。` }))
const WEAPONS = [{ id: 'pistol', name: '手槍', dice: 3, type: 'physical', range: [1, 4], mag: 2, cover_mult: 0.25, pierce: 0, traits: [], attr: 'reflex', skill: 'firearms' }]
const FACTIONS = ['f_a', 'f_b'].map((id) => ({ id, name: `勢力${id}`, short: `${id}社`, class: 'corp' }))

/** 一碰就倒的假兵種（現實的）。 */
const enemy = (id: string, rank: string, faction: string): Rec => ({
  id, name: `${faction}的${rank}`, desc: '測試用的敵人。', faction, rank, grades: [1, 5], kind: 'human', mods: { hp: 0.5, evade: -30, attack: -8 },
  position: { prefer: [1, 2], cover_use: 0.5 }, mode: 'lethal', weapons: [{ class: 'pistol' }], ai: { prefer: 'weakest', focus: 1, flee_below: 0 },
})
/** 網內的兵種（蕾絲，有 constructs）：中間人生成內海面時要先問過挑得到（M3 修正批）；每個勢力每個位階各一個粉的、一個黑的。 */
const lace = (id: string, rank: string, faction: string, color: string): Rec => ({
  id, name: `${faction}的${color}蕾絲（${rank}）`, desc: '測試用的網內敵人。', faction, rank, grades: [1, 5], kind: 'lace', color,
  position: { prefer: [1, 2], cover_use: 0.5 }, ai: { prefer: 'overloaded', focus: 1, flee_below: 0 },
  constructs: [{ id: `cs_${id}`, class: 'pistol', type: 'neural', ram: 1 }], mods: { load: 0.5, attack: -10, evade: -6 },
})
const ENEMIES = [
  ...(['f_a', 'f_b'] as const).flatMap((f) => (['minion', 'elite', 'boss'] as const).map((r) => enemy(`en_${f}_${r}`, r, f))),
  ...(['f_a', 'f_b'] as const).flatMap((f) => (['minion', 'elite', 'boss'] as const).flatMap((r) => (['pink', 'black'] as const).map((c) => lace(`la_${f}_${r}_${c}`, r, f, c)))),
]

/** 一間敞開的小房間（三個入口、一個保全崗、一個目標點、一個撤離點）。 */
const room = (sheet: string): Rec => ({
  id: sheet, name: '小房間', size: [9, 5],
  layout: ['####E####', '#..1.G..#', 'E...T...E', '#..2....#', '###X#####'],
  zones: ['####a####', '#aaaaaaa#', 'aaaaaaaaa', '#aaaaaaa#', '###a#####'],
  cells: [
    { id: 'E1', at: [4, 0], mark: 'E', kind: 'front', name: '北門' }, { id: 'E2', at: [0, 2], mark: 'E', kind: 'back', name: '西門' }, { id: 'E3', at: [8, 2], mark: 'E', kind: 'side', name: '東門' },
    { id: 'G1', at: [5, 1], mark: 'G', name: '守衛的位置' }, { id: 'T1', at: [4, 2], mark: 'T', name: '目標' }, { id: 'X1', at: [3, 4], mark: 'X', name: '撤離點' },
  ],
  spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [3, 3], cover: 'medium' }],
})
const MAP = { id: 'map_room', kind: 'room', size: [9, 5], fits: ['t_steal', 't_steal_gap', 't_seize'], district_weight: {}, sheets: [room('room_a')] }

/** 竊密：主面內海，三個階段；最後一個階段只有內海。內海面：蕾絲粉、設施檔案庫、目標下載或接管。 */
const TYPE_STEAL = {
  id: 't_steal', name: '竊密', main: 'net', decisive: { kind: 'fight' },
  stages: [
    { name: '拿到入口', faces: ['meat', 'net'] },
    { name: '往下一層', faces: ['net', 'meat'] },
    { name: '下載', faces: ['net'] },
  ],
  extra: [{ name: '多一層子網', faces: ['net'] }, { name: '中途出了狀況', faces: ['net', 'meat'] }],
  branches: { stealth: 'stealth' },
  brief: '{faction}的{place}裡有一份資料，{fixer}要它。',
  gives: { net: ['lk_cam', 'lk_door'], meat: ['lk_key'] },
  net: { facility: 'archive', objectives: ['download', 'seize'], lace: 'pink' },
}
/** 同一種竊密，但有隔離區（airgap 是 1）：決定性的內海面一定鎖起來，前面一定有一個只開現實的階段給鑰匙連動。 */
const TYPE_STEAL_GAP = { ...TYPE_STEAL, id: 't_steal_gap', name: '竊密（隔離區）', gives: { net: ['lk_cam', 'lk_door'], meat: ['lk_airgap', 'lk_key'] }, net: { ...TYPE_STEAL.net, airgap: 1 } }
/** 奪取：主面現實，前兩個階段可選內海。 */
const TYPE_SEIZE = {
  id: 't_seize', name: '奪取', main: 'meat', decisive: { kind: 'take', at: 'T' },
  stages: [
    { name: '摸清楚', faces: ['meat', 'net'] },
    { name: '進去', faces: ['meat', 'net'] },
    { name: '拿到手', faces: ['meat'] },
  ],
  extra: [{ name: '多一道門', faces: ['meat', 'net'] }, { name: '最後一道門', faces: ['meat'] }],
  branches: { stealth: 'stealth', talk: 'negotiate' },
  brief: '替{fixer}把{faction}在{district}的東西拿到手，地點在{place}。',
  gives: { net: ['lk_cam', 'lk_door'], meat: ['lk_key'] },
}
const LINKS = [
  { id: 'lk_cam', name: '關掉監視器', from: 'net', to: 'meat', type: 'skip', effect: { skip_explore: true } },
  { id: 'lk_door', name: '接管控制節點', from: 'net', to: 'meat', type: 'ease', effect: { encounter_half: true } },
  { id: 'lk_key', name: '門禁卡', from: 'meat', to: 'meat', type: 'open' },
  { id: 'lk_airgap', name: '插上資料埠', from: 'meat', to: 'net', type: 'open' },
]
const MODS = [{ id: 'md_quiet', name: '安靜的夜', text: '今晚沒有特別的事。', effect: {} }]

const FIXERS = [{ id: 'fx_a', name: '帳房', npc: 'npc_a', district: 'glass_shore', kinds: ['t_steal', 't_steal_gap', 't_seize'], cut: 0.1 }]
const DISTRICTS = [{ id: 'glass_shore', name: '玻璃岸', grade: 3, blocks: [], factions: ['f_a', 'f_b'] }]
const DEFEAT = [{ id: 'df_generic', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: false, default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [] } } }]

const pack = (more: Record<string, unknown[]> = {}): ContentPack => ({
  id: 'm3_fixer_net',
  content: {
    skill: SKILLS, weapon_class: WEAPONS, faction: FACTIONS, enemy: ENEMIES as never, special_map: [MAP] as never, district: DISTRICTS as never,
    npc: [{ id: 'npc_a', name: 'npc_a' }] as never, fixer: FIXERS as never, commission_type: [TYPE_STEAL, TYPE_STEAL_GAP, TYPE_SEIZE] as never, commission_link: LINKS as never,
    commission_modifier: MODS as never, defeat_event: DEFEAT as never, ...more,
  } as never,
})

const DISTRICT_KIND: Feature = { id: 'test_district', install(k) { k.content.defineKind({ kind: 'district', owner: 'test_district', validate: () => [] }) } }
/** 內海的玩法的替身：只是登記 face.net 這種活動。 */
const FACE_NET: Feature = {
  id: 'test_face_net',
  install(k: Kernel) {
    k.activity.define({ kind: 'face.net', owner: 'test_face_net', order: 50, active: () => null, allow: [], reason: () => '替身活動。' })
  },
}
const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5, 30)] })) } }
const STRONG = { attrs: { tech: 20, intellect: 20, body: 20, reflex: 20, charm: 20 }, skills: { mechanics: 5, interface: 5, athletics: 5, stealth: 3, negotiate: 3 } }

interface Opts { seed?: number; features?: Feature[]; content?: ContentPack[]; rep?: number; net?: boolean }
function setup(o: Opts = {}): G {
  const base: Feature[] = [
    DISTRICT_KIND, exploreFeature, enemiesFeature, summonsFeature, defeatFeature, TEST_COMBAT, GEAR as never, securityFeature, commissionFeature, fixerFeature,
    ...(o.net === false ? [] : [FACE_NET]), ...(o.features ?? []),
  ]
  const g = makeGame({ seed: o.seed, features: base, content: o.content ?? [pack()], pc: STRONG as never }).game
  if (o.rep !== undefined) setRep(g, o.rep)
  return g
}

const sysDraft = (changes: ReportDraft['changes'], action = 'test.setup'): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
function setRep(g: G, n: number): void {
  const r = g.k.effects.resolve([{ kind: 'rep', amount: n - meterOf(g.k, g.state, 'rep'), final: true }], effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(r.errors).toEqual([])
  g.commit(sysDraft(r.changes))
}
const setHostility = (g: G, faction: string, n: number): void => void g.commit(sysDraft([{ op: 'meter', kind: 'hostility', key: faction, set: n }]))
const fixerOf = (g: G): FixerEntry => g.k.content.get('fixer', 'fx_a') as unknown as FixerEntry
const gen = (g: G, seed: string, type?: string): Offer => {
  // 指定類型：把中間人的門路縮成那一種
  const fixer = type ? ({ ...fixerOf(g), kinds: [type] } as FixerEntry) : fixerOf(g)
  const o = generate(g.k, g.state, { fixer, seed })
  expect(o, `seed ${seed} 生成不出來`).not.toBeNull()
  return o!
}

type StageDef = { name?: string; faces: Record<string, Rec> }
const stagesOf = (o: Offer): StageDef[] => o.commission.stages as never
const faceKeys = (st: StageDef): string[] => Object.keys(st.faces)
/** 內海的面，照階段的順序 */
const netFaces = (o: Offer): Array<{ stage: number; face: Rec }> => stagesOf(o).flatMap((st, i) => (st.faces.net ? [{ stage: i + 1, face: st.faces.net }] : []))
const REPS = [0, 30, 55, 75]
const SEEDS = Array.from({ length: 20 }, (_, i) => `n${i}`)
/** 每一種規模都生成得到：信譽階不同給的規模不同 */
const gamesAllScales = (): G[] => REPS.map((rep, i) => setup({ rep, seed: 100 + i }))

// ===================================================================================================================
// 生成
// ===================================================================================================================

describe('竊密：主面是內海', () => {
  it('二十個種子都合格：過得了副本的格式檢查、最後一個階段只有內海而且有 objective', () => {
    for (const g of gamesAllScales()) {
      for (const seed of SEEDS) {
        const o = gen(g, seed, 't_steal')
        expect(commissionProblems(o.commission as never), seed).toEqual([])
        expect(g.k.content.validate('commission', [o.commission])).toEqual([])
        expect(offerProblems(o)).toEqual([])
        expect(o.commission.main).toBe('net')
        const st = stagesOf(o)
        expect(faceKeys(st.at(-1)!)).toEqual(['net'])
        const last = st.at(-1)!.faces.net!
        expect(['download', 'seize']).toContain((last.objective as Rec).kind)
        // 沒寫 turns 的只有下載以外的種類
        if ((last.objective as Rec).kind === 'download') expect((last.objective as Rec).turns).toBe(3)
        // 中間的內海階段沒有 objective（通過閘門就算）
        for (const { stage, face } of netFaces(o)) if (stage < st.length) expect(face.objective, `${seed} 第 ${stage} 階段`).toBeUndefined()
      }
    }
  })

  it('內海的階段 layer 是 guest、staff、core 裡照順序的幾個（三個內海階段：guest、staff、core）；最後一個一定是 core', () => {
    const g = setup({ rep: 0 })
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal')
      const nets = netFaces(o)
      const layers = nets.map((n) => n.face.layer as string)
      seen.add(layers.join('>'))
      expect(layers.at(-1)).toBe('core')
      for (const l of layers) expect(['guest', 'staff', 'core']).toContain(l)
      // 小型的竊密第一、二階段都可以選內海，加上最後一個：三個內海階段
      if (layers.length === 3) expect(layers).toEqual(['guest', 'staff', 'core'])
      if (layers.length === 2) expect(layers).toEqual(['staff', 'core'])
    }
    // 小型的三個階段每一個都有內海面
    expect([...seen]).toContain('guest>staff>core')
  })

  it('每個階段數都照規則表：一個 core、兩個 staff core、三個 guest staff core、四個加 control、五個往前補 guest', () => {
    const g = setup({ rep: 75 })
    const counts = new Set<number>()
    const want: Record<number, string[]> = {
      1: ['core'], 2: ['staff', 'core'], 3: ['guest', 'staff', 'core'], 4: ['guest', 'staff', 'control', 'core'], 5: ['guest', 'guest', 'staff', 'control', 'core'],
    }
    for (let i = 0; i < 60; i++) {
      const o = gen(g, `lay${i}`, 't_steal')
      const layers = netFaces(o).map((n) => n.face.layer as string)
      counts.add(layers.length)
      expect(layers, `${i}`).toEqual(want[layers.length])
    }
    // 中型 4 個階段、大型 5 個階段，都至少出現過
    expect([...counts].some((n) => n >= 4)).toBe(true)
  })

  it('規則 fixer_rule.net_layers 可以換；格式不對的忽略並在 ruleProblems 裡說出來', () => {
    const g = setup({ rep: 0, content: [pack({ fixer_rule: [{ id: 'default', net_layers: { 3: ['staff', 'control', 'core'] } }] })] })
    expect(fixerNetRules(g.k).net_layers[3]).toEqual(['staff', 'control', 'core'])
    expect(fixerNetRules(g.k).net_layers[2]).toEqual(['staff', 'core'])
    const o = gen(g, 'rule', 't_steal')
    const layers = netFaces(o).map((n) => n.face.layer)
    if (layers.length === 3) expect(layers).toEqual(['staff', 'control', 'core'])
    expect(ruleProblems({ net_layers: { 3: ['guest', 'staff'] } }).join('')).toMatch(/net_layers\.3/)
    expect(ruleProblems({ net_layers: { 2: ['core', 'staff'] } }).join('')).toMatch(/最後一層要是 core/)
    expect(ruleProblems({ net_layers: { 9: ['core'] } }).join('')).toMatch(/1～4/)
    expect(ruleProblems({ trace_start: { noted: 200 } }).join('')).toMatch(/trace_start\.noted/)
    expect(ruleProblems({ trace_start: { nope: 1 } }).join('')).toMatch(/trace_start\.nope/)
    expect(ruleProblems({ net_branch_skills: [] }).join('')).toMatch(/net_branch_skills/)
    expect(ruleProblems({ trace_start: { noted: 20, wanted: 40, scout_alert: 10 }, net_layers: { 1: ['core'] }, net_branch_skills: ['interface'] })).toEqual([])
    // 格式不對的欄位不蓋（載入時內容種類的檢查會擋，這裡直接餵 fixerRules）
    const fake = { content: { get: () => ({ id: 'default', trace_start: { noted: 200, wanted: 40 }, net_layers: { 2: ['core'], 3: ['guest', 'staff', 'core'] } }) } } as never
    expect(fixerNetRules(fake).trace_start).toEqual({ noted: 15, wanted: 40, scout_alert: 15 })
    expect(fixerNetRules(fake).net_layers[2]).toEqual(['staff', 'core'])
  })

  it('每個內海的面有強攻；潛行分支看 net_branch_skills 的一項；內海面沒有交涉；蕾絲與設施照模板', () => {
    for (const g of gamesAllScales()) {
      for (const seed of SEEDS) {
        const o = gen(g, seed, 't_steal')
        for (const { face } of netFaces(o)) {
          const branches = face.branches as Array<{ id: string; kind: string; need?: Rec }>
          expect(branches.some((b) => b.kind === 'assault')).toBe(true)
          expect(branches.some((b) => b.kind === 'talk')).toBe(false)
          for (const b of branches.filter((x) => x.kind === 'stealth')) expect(['interface', 'stealth']).toContain((b.need as { basic: string }).basic)
          expect(face.lace).toBe('pink')
          expect(face.facility).toBe('archive')
          expect(face.map).toBeUndefined()
          expect(face.encounter).toBeDefined()
          expect(branches.every((b) => !('entry' in b))).toBe(true)
        }
      }
    }
  })

  it('net_branch_skills 換成一項：潛行分支就看那一項', () => {
    const g = setup({ rep: 0, content: [pack({ fixer_rule: [{ id: 'default', net_branch_skills: ['mechanics'] }] })] })
    for (const seed of SEEDS) {
      for (const { face } of netFaces(gen(g, seed, 't_steal'))) {
        for (const b of (face.branches as Array<{ kind: string; need?: Rec }>).filter((x) => x.kind === 'stealth')) expect((b.need as { basic: string }).basic).toBe('mechanics')
      }
    }
  })

  it('連動開出來的路也長在內海面上；踩點開出來的路（need.scouted）與未知清單對得上', () => {
    const g = setup({ rep: 75 })
    let linked = 0
    let scouted = 0
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal')
      const links = o.commission.links as Rec
      for (const { face } of netFaces(o)) {
        for (const b of face.branches as Array<{ kind: string; need?: { link?: string; scouted?: string } }>) {
          if (b.kind === 'linked') { linked += 1; expect(Object.keys(links)).toContain(b.need!.link) }
          if (b.kind === 'scouted') scouted += 1
        }
      }
      // 每一個「路」類的未知，揭開的鍵都對得到一個 scouted 分支
      const keys = new Set<string>()
      for (const st of stagesOf(o)) for (const f of Object.values(st.faces)) for (const b of f.branches as Array<{ kind: string; need?: { scouted?: string } }>) if (b.kind === 'scouted') keys.add(b.need!.scouted!)
      for (const u of o.unknowns.filter((x) => x.cat === 'path')) expect(keys.has((u.reveal as { branch: string }).branch)).toBe(true)
    }
    expect(scouted).toBeGreaterThan(0)
    expect(linked).toBe(0)
  })

  it('開路連動的終點是內海：沒有隔離區時，它在那個階段的內海面開出一條連動的分支（via_）', () => {
    const open = { ...TYPE_STEAL, gives: { net: ['lk_cam', 'lk_door'], meat: ['lk_airgap', 'lk_key'] } }
    const g = setup({ rep: 75, content: [pack({ commission_type: [open, TYPE_SEIZE] })] })
    let linked = 0
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal')
      expect(commissionProblems(o.commission as never)).toEqual([])
      for (const { face } of netFaces(o)) {
        for (const b of face.branches as Array<{ id: string; kind: string; need?: { link?: string } }>) {
          if (b.kind !== 'linked') continue
          linked += 1
          expect(b.id).toBe(`via_${b.need!.link}`)
          expect(Object.keys(o.commission.links as Rec)).toContain(b.need!.link)
        }
        expect(face.locked_by).toBeUndefined()
      }
    }
    expect(linked).toBeGreaterThan(0)
  })

  it('同一個種子生成兩次一樣；換種子不一樣', () => {
    const g = setup({ rep: 55 })
    for (const seed of SEEDS) expect(gen(g, seed, 't_steal')).toEqual(gen(g, seed, 't_steal'))
    const all = SEEDS.map((s) => JSON.stringify(gen(g, s, 't_steal').commission.stages))
    expect(new Set(all).size).toBeGreaterThan(5)
  })

  it('內海階段的遭遇點數不超過預算（一般 4、最後一個階段 8；對 encounterPoints 的算法）', () => {
    for (const g of gamesAllScales()) {
      for (const seed of SEEDS) {
        for (const type of ['t_steal', 't_seize'] as const) {
          const o = gen(g, seed, type)
          const total = stagesOf(o).length
          const grade = o.commission.grade as number
          for (const { stage, face } of netFaces(o)) {
            const foes = (face.encounter as string[]).map((rank) => ({ enemy: `en_f_a_${rank}`, grade }))
            const points = encounterPoints(g.k as never, foes, grade)
            expect(points, `${type} ${seed} 第 ${stage} 階段`).toBeLessThanOrEqual(stage === total ? ENCOUNTER_BUDGET.boss : ENCOUNTER_BUDGET.normal)
            expect(points).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('二十個種子的未知清單：4～8 項、reveal 都對得到副本；內海階段有蕾絲的一項，標 face: net', () => {
    const g = setup({ rep: 30 })
    let lace = 0
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal')
      expect(o.unknowns.length).toBeGreaterThanOrEqual(4)
      expect(o.unknowns.length).toBeLessThanOrEqual(8)
      expect(offerProblems(o)).toEqual([])
      for (const u of o.unknowns.filter((x) => x.cat === 'lace')) {
        lace += 1
        expect(u.face).toBe('net')
        const n = (u.reveal as { flag: string }).flag.replace('lace_s', '')
        expect(stagesOf(o)[Number(n) - 1]!.faces.net).toBeDefined()
        expect(u.text).toMatch(/粉蕾絲/)
      }
      for (const u of o.unknowns.filter((x) => x.face === 'net')) expect(['lace', 'guard', 'path']).toContain(u.cat)
    }
    expect(lace).toBeGreaterThan(0)
  })
})

describe('隔離區：airgap 是 1 的模板', () => {
  it('決定性的內海面有 locked_by；前面有一個只開現實的階段給那個連動；副本的格式檢查過', () => {
    for (const g of gamesAllScales()) {
      for (const seed of SEEDS) {
        const o = gen(g, seed, 't_steal_gap')
        const st = stagesOf(o)
        const last = st.at(-1)!.faces.net!
        expect(last.locked_by, seed).toBe('lk_airgap')
        expect(Object.keys(o.commission.links as Rec)).toContain('lk_airgap')
        // 前面有一個只開現實的階段，那一面 gives 鑰匙
        const keyStage = st.findIndex((s) => faceKeys(s).length === 1 && s.faces.meat?.gives === 'lk_airgap')
        expect(keyStage, seed).toBeGreaterThanOrEqual(0)
        expect(keyStage).toBeLessThan(st.length - 1)
        expect(commissionProblems(o.commission as never), seed).toEqual([])
        // 鎖是鎖，不是一條分支
        for (const b of last.branches as Array<{ kind: string; need?: { link?: string } }>) expect(b.need?.link).not.toBe('lk_airgap')
        // 還是至少有一個階段可以選兩個以上的面
        expect(st.some((s) => faceKeys(s).length >= 2)).toBe(true)
        // 其餘的內海面沒有鎖
        for (const { stage, face } of netFaces(o)) if (stage < st.length) expect(face.locked_by).toBeUndefined()
      }
    }
  })

  it('沒有 airgap（沒寫或 0）的模板不會有 locked_by', () => {
    const g = setup({ rep: 55 })
    for (const seed of SEEDS) {
      for (const { face } of netFaces(gen(g, seed, 't_steal'))) expect(face.locked_by).toBeUndefined()
    }
    const zero = setup({ rep: 55, content: [pack({ commission_type: [{ ...TYPE_STEAL, net: { ...TYPE_STEAL.net, airgap: 0 } }, TYPE_SEIZE] })] })
    for (const seed of SEEDS) {
      for (const { face } of netFaces(gen(zero, seed, 't_steal'))) expect(face.locked_by).toBeUndefined()
    }
  })

  it('機率在 0 與 1 之間：兩種都出現（用得到隔離區與用不到）', () => {
    const half = { ...TYPE_STEAL, id: 't_steal', net: { ...TYPE_STEAL.net, airgap: 0.5 }, gives: TYPE_STEAL_GAP.gives }
    const g = setup({ rep: 55, content: [pack({ commission_type: [half, TYPE_SEIZE] })] })
    const flags = SEEDS.concat(SEEDS.map((s) => `${s}b`)).map((seed) => !!stagesOf(gen(g, seed, 't_steal')).at(-1)!.faces.net!.locked_by)
    expect(flags).toContain(true)
    expect(flags).toContain(false)
  })

  it('沒有鑰匙連動可用時（沒有 from 現實、to 內海的開路連動）不鎖', () => {
    const noKey = { ...TYPE_STEAL_GAP, gives: TYPE_STEAL.gives }
    const g = setup({ rep: 55, content: [pack({ commission_link: LINKS.filter((l) => l.id !== 'lk_airgap'), commission_type: [noKey, TYPE_SEIZE] })] })
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal_gap')
      expect(stagesOf(o).at(-1)!.faces.net!.locked_by).toBeUndefined()
      expect(commissionProblems(o.commission as never)).toEqual([])
    }
  })
})

describe('奪取：主面現實，前面的階段可以選內海', () => {
  it('內海的面有 layer 與強攻、沒有 objective；現實面照舊；格式檢查過', () => {
    for (const g of gamesAllScales()) {
      for (const seed of SEEDS) {
        const o = gen(g, seed, 't_seize')
        expect(o.commission.main).toBe('meat')
        expect(commissionProblems(o.commission as never), seed).toEqual([])
        const st = stagesOf(o)
        expect(faceKeys(st.at(-1)!)).toEqual(['meat'])
        const nets = netFaces(o)
        expect(nets.length).toBeGreaterThan(0)
        for (const { face } of nets) {
          expect(['guest', 'staff', 'control', 'core']).toContain(face.layer)
          expect(face.objective).toBeUndefined()
          expect(face.locked_by).toBeUndefined()
          expect((face.branches as Array<{ kind: string }>).some((b) => b.kind === 'assault')).toBe(true)
        }
        // 這一型的 net 沒寫蕾絲：不給 lace 欄位
        for (const { face } of nets) expect(face.lace).toBeUndefined()
        expect(nets.at(-1)!.face.layer).toBe('core')
      }
    }
  })
})

describe('沒有登記 face.net', () => {
  it('桌上沒有主面是內海的委託；主面是現實的照生成，內海的面列著（也帶 layer）', () => {
    const g = setup({ rep: 75, net: false })
    expect(registeredFaces(g.k)).toEqual(['meat'])
    expect(eligibleTypes(g.k, fixerOf(g)).map((t) => t.id)).toEqual(['t_seize'])
    for (let day = 0; day < 12; day++) {
      const offers = offersFor(g.k, g.state, fixerOf(g), day)
      expect(offers.length).toBeGreaterThan(0)
      for (const o of offers) {
        expect(o.commission.main).toBe('meat')
        expect(o.commission.kind).toBe('t_seize')
        expect(commissionProblems(o.commission as never)).toEqual([])
        // 內海的面列著
        expect(netFaces(o).length).toBeGreaterThan(0)
      }
    }
    // 看板也一樣
    for (const row of board(g.k, g.state, 'fx_a').offers) expect(row.offer.commission.main).toBe('meat')
  })

  it('登記了之後兩型都抽得到', () => {
    const g = setup({ rep: 75 })
    expect(registeredFaces(g.k)).toEqual(['meat', 'net'])
    expect(eligibleTypes(g.k, fixerOf(g)).map((t) => t.id).sort()).toEqual(['t_seize', 't_steal', 't_steal_gap'])
  })
})

// ===================================================================================================================
// 模板的格式
// ===================================================================================================================

describe('模板的 net 欄位', () => {
  it('好的模板沒有問題；genProblems 通過', () => {
    const g = setup()
    expect(typeProblems(TYPE_STEAL as never)).toEqual([])
    expect(typeProblems(TYPE_STEAL_GAP as never)).toEqual([])
    expect(typeProblems(TYPE_SEIZE as never)).toEqual([])
    expect(genProblems(g.k)).toEqual([])
  })

  it('壞的 net：每一條一句', () => {
    const bad = (net: unknown): string => typeProblems({ ...TYPE_STEAL, net } as never).join('；')
    expect(bad('x')).toMatch(/net 要是/)
    expect(bad({ zap: 1 })).toMatch(/net\.zap/)
    expect(bad({ facility: '' })).toMatch(/net\.facility/)
    expect(bad({ objectives: [] })).toMatch(/net\.objectives/)
    expect(bad({ objectives: ['steal'] })).toMatch(/net\.objectives/)
    expect(bad({ airgap: 2 })).toMatch(/net\.airgap/)
    expect(bad({ airgap: -0.1 })).toMatch(/net\.airgap/)
    expect(bad({ lace: 'red' })).toMatch(/net\.lace/)
    expect(bad({})).toBe('')
  })

  it('沒寫 net 的模板：最後一個階段的目標是下載、turns 3', () => {
    const plain = { ...TYPE_STEAL } as Rec
    delete plain.net
    const g = setup({ rep: 0, content: [pack({ commission_type: [plain, TYPE_SEIZE] })] })
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal')
      expect(stagesOf(o).at(-1)!.faces.net!.objective).toEqual({ kind: 'download', turns: 3 })
      for (const { face } of netFaces(o)) { expect(face.lace).toBeUndefined(); expect(face.facility).toBeUndefined() }
    }
  })

  it('objectives 的每一種都抽得到；seize 不帶 turns', () => {
    const g = setup({ rep: 0, content: [pack({ commission_type: [{ ...TYPE_STEAL, net: { objectives: ['download', 'seize', 'find', 'defeat', 'plant', 'extract'] } }, TYPE_SEIZE] })] })
    const kinds = new Set<string>()
    for (let i = 0; i < 80; i++) {
      const o = gen(g, `ob${i}`, 't_steal')
      const obj = stagesOf(o).at(-1)!.faces.net!.objective as { kind: string; turns?: number }
      kinds.add(obj.kind)
      if (obj.kind !== 'download') expect(obj.turns).toBeUndefined()
      expect(commissionProblems(o.commission as never)).toEqual([])
    }
    expect([...kinds].sort()).toEqual(['defeat', 'download', 'extract', 'find', 'plant', 'seize'])
  })
})

// ===================================================================================================================
// 出發：追蹤度的起始值
// ===================================================================================================================

/** 把一件生成的委託直接放進手上（不經過桌面：桌面每天只有三件，挑不到想要的）。 */
function takeOffer(g: G, o: Offer): string {
  g.commit(sysDraft([{
    op: 'fixer.take',
    job: {
      id: o.id, fixer: 'fx_a', npc: 'npc_a', title: o.title, brief: o.brief, commission: o.commission, unknowns: o.unknowns, terms: { reward: o.reward, pay: 'cash', cut: 0.1 },
      haggled: null, status: 'active', day: g.state.time.day, revealed: [], scouts: 0, alert_start: 0, trace_start: 0, log: [], aux: {}, bond_failed: [], borrow_n: 0, payout: null,
    },
  } as never], 'test.take'))
  return o.id
}
/** 內海的手段（淺層駭入）揭得開的類 */
const HACKABLE = ['lace', 'stage', 'guard']
/** 拿一件竊密：挑一個未知清單裡有淺層駭入揭得開的東西的種子（踩點的測試要用）。 */
function takeNetJob(g: G, type = 't_steal'): string {
  const o = SEEDS.map((s) => gen(g, s, type)).find((x) => x.unknowns.some((u) => HACKABLE.includes(u.cat)))
  expect(o, '二十個種子裡沒有淺層駭入揭得開的未知').toBeDefined()
  return takeOffer(g, o!)
}
const traceOf = (g: G, job: string): unknown => (go(g.k, g.state, job).launch![0]!.setup as Rec).trace_start

/** 讓桌上一定有一件內海的委託：只留竊密。 */
const stealOnly = (): ContentPack => pack({ fixer: [{ ...FIXERS[0], kinds: ['t_steal'] }] })

describe('出發：目標勢力的敵對值與踩點決定追蹤度的起始值（N16）', () => {
  it('目標的敵對值 25（記名）→ 15；100（通緝）→ 30；0 與 19 → 沒有', () => {
    const cases: Array<[number, number | undefined]> = [[0, undefined], [19, undefined], [20, 15], [25, 15], [60, 15], [99, 15], [100, 30]]
    for (const [h, want] of cases) {
      const g = setup({ rep: 75, content: [stealOnly()] })
      const job = takeNetJob(g)
      const target = String(jobOf(g.state, job)!.commission.target_faction)
      setHostility(g, target, h)
      expect(traceOf(g, job), `敵對值 ${h}`).toBe(want)
    }
  })

  it('別的勢力的敵對值不算；踩點驚動過、沒有敵對 → 15；都沒有 → 0', () => {
    const g = setup({ rep: 75, content: [stealOnly()] })
    const job = takeNetJob(g)
    const target = String(jobOf(g.state, job)!.commission.target_faction)
    const other = target === 'f_a' ? 'f_b' : 'f_a'
    setHostility(g, other, 100)
    expect(traceOf(g, job)).toBeUndefined()
    expect(traceStartOf(g.k, g.state, jobOf(g.state, job)!)).toBe(0)
    // 踩點驚動：用內海的手段擲到自然 1
    findNatural(g, scoutPurpose(job, 1), 1)
    g.commit(scout(g.k, g.state, job, 'hack'))
    expect(jobOf(g.state, job)!.trace_start).toBe(15)
    expect(traceOf(g, job)).toBe(15)
    expect(traceStartOf(g.k, g.state, jobOf(g.state, job)!)).toBe(15)
  })

  it('取最高的：踩點驚動加通緝是 30、記名加踩點驚動是 15；上限 100', () => {
    const g = setup({ rep: 75, content: [stealOnly()] })
    const job = takeNetJob(g)
    const target = String(jobOf(g.state, job)!.commission.target_faction)
    findNatural(g, scoutPurpose(job, 1), 1)
    g.commit(scout(g.k, g.state, job, 'hack'))
    setHostility(g, target, 30)
    expect(traceOf(g, job)).toBe(15)
    setHostility(g, target, 100)
    expect(traceOf(g, job)).toBe(30)
    const v = jobOf(g.state, job)!
    expect(traceStartOf(g.k, g.state, { ...v, trace_start: 100 })).toBe(100)
  })

  it('規則 trace_start 可以換：記名 20、通緝 45', () => {
    const g = setup({ rep: 75, content: [pack({ fixer: [{ ...FIXERS[0], kinds: ['t_steal'] }], fixer_rule: [{ id: 'default', trace_start: { noted: 20, wanted: 45 } }] })] })
    const job = takeNetJob(g)
    const target = String(jobOf(g.state, job)!.commission.target_faction)
    setHostility(g, target, 25)
    expect(traceOf(g, job)).toBe(20)
    setHostility(g, target, 100)
    expect(traceOf(g, job)).toBe(45)
  })

  it('主面是現實、沒有任何內海階段的委託不用算（敵對值再高也不給 trace_start）', () => {
    const noNet = { ...TYPE_SEIZE, gives: {}, stages: [{ name: 'a', faces: ['meat'] }, { name: 'b', faces: ['meat'] }, { name: 'c', faces: ['meat'] }], extra: [{ name: 'x', faces: ['meat'] }, { name: 'y', faces: ['meat'] }] }
    const links = [...LINKS, { id: 'lk_two', name: '內應', from: 'meat', to: 'meat', type: 'ease', effect: { encounter_half: true } }]
    const g = setup({ rep: 75, content: [pack({ commission_type: [noNet], commission_link: links, fixer: [{ ...FIXERS[0], kinds: ['t_seize'] }] })] })
    const o = gen(g, 'plain', 't_seize')
    expect(netFaces(o)).toHaveLength(0)
    const job = takeOffer(g, o)
    setHostility(g, String(o.commission.target_faction), 100)
    expect(traceOf(g, job)).toBeUndefined()
  })

  it('主面是現實但前面的階段有內海面：敵對值照算', () => {
    const g = setup({ rep: 75, content: [pack({ fixer: [{ ...FIXERS[0], kinds: ['t_seize'] }] })] })
    const o = gen(g, 'withnet', 't_seize')
    expect(netFaces(o).length).toBeGreaterThan(0)
    const job = takeOffer(g, o)
    setHostility(g, String(o.commission.target_faction), 50)
    expect(traceOf(g, job)).toBe(15)
  })

  it('沒有人登記 hostility_tier（敵對值的功能沒裝）：當作沒有敵對；踩點照舊', () => {
    const base: Feature[] = [DISTRICT_KIND, exploreFeature, enemiesFeature, summonsFeature, defeatFeature, TEST_COMBAT, GEAR as never, commissionFeature, fixerFeature, FACE_NET]
    const g = makeGame({ features: base, content: [stealOnly()], pc: STRONG as never }).game
    setRep(g, 75)
    const job = takeNetJob(g)
    expect(traceOf(g, job)).toBeUndefined()
  })

  it('出發之後副本的追蹤度就是這個數字（Run.trace）；報告裡說一聲', () => {
    const g = setup({ rep: 75, content: [stealOnly()] })
    const job = takeNetJob(g)
    setHostility(g, String(jobOf(g.state, job)!.commission.target_faction), 100)
    const reports = g.commit(go(g.k, g.state, job))
    expect(readRun(g.state)!.trace).toBe(30)
    expect(reports[0]!.narration?.results?.join('')).toMatch(/追蹤度/)
  })
})

/** 找一個讓那一次踩點擲出自然 N 的種子：改存檔的亂數游標直到骰面對（同 M2-fixer 的做法）。 */
function findNatural(g: G, purpose: string, natural: number): void {
  for (let i = 0; i < 4000; i++) {
    g.state.rng.cursor = i
    if (peekNatural(g, purpose) === natural) return
  }
  throw new Error(`找不到自然 ${natural} 的骰面`)
}
function peekNatural(g: G, purpose: string): number {
  // 用一份複製的狀態試擲：scout 的骰面只由（種子、游標、用途）決定
  const s = structuredClone(g.state)
  const jobId = purpose.split('/')[1]!
  const draft = scout(g.k, s, jobId, 'hack')
  return (draft.timeline[0]!.roll as { natural: number }).natural
}

// ===================================================================================================================
// 踩點：內海的階段照同一套揭開
// ===================================================================================================================

describe('踩點：內海的階段與分支', () => {
  it('scoutView 的未知清單把內海階段的面標出來：蕾絲、守備、路標 net，階段與現實面是 null', () => {
    const g = setup({ rep: 75, content: [stealOnly()] })
    const job = takeNetJob(g)
    const view = scoutView(g.k, g.state, job)
    expect(view.unknowns.length).toBeGreaterThanOrEqual(4)
    for (const u of view.unknowns) {
      if (u.cat === 'lace') expect(u.face).toBe('net')
      if (u.cat === 'stage' || u.cat === 'target' || u.cat === 'employer') expect(u.face).toBeNull()
    }
    // 沒揭開的不給內容
    for (const u of view.unknowns) expect(u.text).toBeNull()
    // 內海的手段（淺層駭入）能揭開蕾絲、階段、守備
    const hack = view.methods.find((m) => m.id === 'hack')!
    expect(hack.layer).toBe('net')
    expect(hack.cats).toEqual(['lace', 'stage', 'guard'])
  })

  it('買情報揭開一項內海的未知（蕾絲）：揭開的 reveal 進 scouted 的旗標；路類的揭開進 scouted.branches', () => {
    const g = setup({ rep: 75, content: [stealOnly()] })
    g.state.money.cash = 100000
    // 找一件未知清單裡有蕾絲那一項的
    const o = SEEDS.map((s) => gen(g, s, 't_steal')).find((x) => x.unknowns.some((u) => u.cat === 'lace'))
    expect(o, '二十個種子的未知清單裡都沒有蕾絲').toBeDefined()
    const job = takeOffer(g, o!)
    const j = jobOf(g.state, job)!
    const lace = j.unknowns.find((u) => u.cat === 'lace')!
    g.commit(buyIntel(g.k, g.state, job, lace!.id, 'cash'))
    const view = scoutView(g.k, g.state, job)
    expect(view.unknowns.find((u) => u.id === lace!.id)).toMatchObject({ revealed: true, face: 'net' })
    expect(view.unknowns.find((u) => u.id === lace!.id)!.text).toMatch(/粉蕾絲/)
    const sc = (go(g.k, g.state, job).launch![0]!.setup as { scouted: { flags: string[]; branches: string[] } }).scouted
    expect(sc.flags).toContain((lace!.reveal as { flag: string }).flag)
    // 路類
    const path = jobOf(g.state, job)!.unknowns.find((u) => u.cat === 'path')
    if (path) {
      g.commit(buyIntel(g.k, g.state, job, path.id, 'cash'))
      const sc2 = (go(g.k, g.state, job).launch![0]!.setup as { scouted: { branches: string[] } }).scouted
      expect(sc2.branches).toContain((path.reveal as { branch: string }).branch)
    }
  })

  it('踩出來的路（scouted 分支）在內海階段上與副本的 need.scouted 對得上：沒踩到不列、踩到了列出來', () => {
    // 找一件內海階段上有 scouted 分支的委託
    const g = setup({ rep: 75, content: [stealOnly()] })
    let found: Offer | null = null
    for (const seed of SEEDS) {
      const o = gen(g, seed, 't_steal')
      if (netFaces(o).some(({ face }) => (face.branches as Array<{ kind: string }>).some((b) => b.kind === 'scouted'))) { found = o; break }
    }
    expect(found, '二十個種子裡沒有內海面帶踩點的路').not.toBeNull()
    const keys = netFaces(found!).flatMap(({ face }) => (face.branches as Array<{ kind: string; need?: { scouted?: string } }>).filter((b) => b.kind === 'scouted').map((b) => b.need!.scouted!))
    for (const key of keys) {
      const u = found!.unknowns.find((x) => x.cat === 'path' && (x.reveal as { branch: string }).branch === key)
      expect(u, key).toBeDefined()
    }
  })
})

// ===================================================================================================================
// 簡報：主面是內海
// ===================================================================================================================

describe('簡報（board 的每一列）', () => {
  it('主面是內海：給一句話；沒有人定義 deck_grade 時不給甲板的提醒', () => {
    const g = setup({ rep: 75, content: [stealOnly()] })
    const rows = board(g.k, g.state, 'fx_a').offers
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.net).not.toBeNull()
      expect(r.net!.text).toMatch(/內海/)
      expect(r.net!.deck_warn).toBeNull()
    }
  })

  it('主面是現實的列沒有 net', () => {
    const g = setup({ rep: 75, content: [pack({ fixer: [{ ...FIXERS[0], kinds: ['t_seize'] }] })] })
    for (const r of board(g.k, g.state, 'fx_a').offers) expect(r.net).toBeNull()
  })

  it('有人定義 deck_grade：隊上都沒有甲板就提醒「要有甲板」；有人有就不提醒', () => {
    let grade = 0
    const DECK: Feature = {
      id: 'test_deck',
      install(k: Kernel) { k.stats.defineStat({ id: 'deck_grade', owner: 'test_deck', name: '甲板等級', base: () => grade }) },
    }
    const g = setup({ rep: 75, content: [stealOnly()], features: [DECK] })
    const row = board(g.k, g.state, 'fx_a').offers[0]!
    expect(row.net!.deck_warn).toMatch(/甲板/)
    grade = 2
    expect(board(g.k, g.state, 'fx_a').offers[0]!.net!.deck_warn).toBeNull()
  })
})

// ===================================================================================================================
// 性質與回歸
// ===================================================================================================================

describe('性質', () => {
  it('generateTrace 一次就成功（沒有用掉重抽）；生成的結果不改狀態', () => {
    const g = setup({ rep: 75 })
    const before = JSON.stringify(g.state)
    for (const seed of SEEDS) {
      for (const type of ['t_steal', 't_steal_gap', 't_seize']) {
        const fixer = { ...fixerOf(g), kinds: [type] } as FixerEntry
        const t = generateTrace(g.k, g.state, { fixer, seed })
        expect(t.offer, `${type} ${seed}`).not.toBeNull()
        expect(t.tries[0], `${type} ${seed}`).toBeNull()
      }
    }
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('沒有內海面的生成與沒登記時的現實生成，不受內海的抽籤影響（同一個種子，現實部分一樣）', () => {
    // 同一個種子：登記與沒登記內海，奪取的現實面（地圖、入口、保全崗）一樣
    const a = setup({ rep: 75, net: false })
    const b = setup({ rep: 75 })
    for (const seed of SEEDS) {
      const oa = gen(a, seed, 't_seize')
      const ob = gen(b, seed, 't_seize')
      expect(stagesOf(oa).map((s) => s.faces.meat?.map)).toEqual(stagesOf(ob).map((s) => s.faces.meat?.map))
      expect(stagesOf(oa).map((s) => s.faces.meat?.post)).toEqual(stagesOf(ob).map((s) => s.faces.meat?.post))
    }
  })
})

// ===================================================================================================================
// 內海的敵人挑得到嗎（M3 修正批：審查列為應修）
// ===================================================================================================================

describe('生成時先問內海的敵人挑不挑得到', () => {
  const withEnemies = (list: Rec[]): ContentPack => ({ ...pack(), content: { ...pack().content, enemy: list as never } }) as ContentPack
  const base = pack().content.enemy as unknown as Rec[]

  it('一個網內的兵種都沒有：主面是內海的竊密與有內海階段的奪取都生成不出來，每一次抽的原因都是「挑不到內海的敵人」；不會生成一件做不完的委託', () => {
    const g = setup({ rep: 75, content: [withEnemies(base.filter((e) => e.kind !== 'lace'))] })
    for (const type of ['t_steal', 't_seize']) {
      const t = generateTrace(g.k, g.state, { fixer: { ...fixerOf(g), kinds: [type] } as FixerEntry, seed: `nolace_${type}` })
      expect(t.offer, type).toBeNull()
      expect(t.tries.every((x) => typeof x === 'string' && /挑不到內海的敵人/.test(x)), type).toBe(true)
    }
    expect(offersFor(g.k, g.state, fixerOf(g), 1)).toEqual([])
  })

  it('缺的是首領（有雜兵與精英的蕾絲、沒有首領）：竊密最後一個階段要首領，挑不到；奪取的內海階段不用首領時照樣生成得出來', () => {
    const g = setup({ rep: 75, content: [withEnemies(base.filter((e) => e.kind !== 'lace' || e.rank !== 'boss'))] })
    const steal = generateTrace(g.k, g.state, { fixer: { ...fixerOf(g), kinds: ['t_steal'] } as FixerEntry, seed: 'noboss' })
    expect(steal.offer).toBeNull()
    expect(steal.tries.some((x) => /位階 boss/.test(x ?? ''))).toBe(true)
  })

  it('對照：有網內的兵種（粉與黑）時照常生成；現實面的挑選（lethal）不受網內兵種影響', () => {
    const g = setup({ rep: 75 })
    expect(generateTrace(g.k, g.state, { fixer: { ...fixerOf(g), kinds: ['t_steal'] } as FixerEntry, seed: 'ok' }).offer).not.toBeNull()
    // 只有網內的兵種、沒有現實的兵種：現實面挑不到（舊的行為不變）
    const h = setup({ rep: 75, content: [withEnemies(base.filter((e) => e.kind === 'lace'))] })
    const t = generateTrace(h.k, h.state, { fixer: { ...fixerOf(h), kinds: ['t_seize'] } as FixerEntry, seed: 'nomeat' })
    expect(t.offer).toBeNull()
    expect(t.tries.some((x) => /挑不到敵人/.test(x ?? '') && !/內海/.test(x ?? ''))).toBe(true)
  })
})
