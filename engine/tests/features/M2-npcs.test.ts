// 驗收測試：dev/work/M2-npcs.md（cpp-feature）。規格：NPC_SYSTEM 第 1、2 節、3.1～3.3、4.1、4.4～4.7、第 5 節、第 7 節、第 12 節；DATA 第 8 節；dev/adr/0016 第三、七節。
// 內容一律用測試自帶的最小假資料（不碰 engine/data 的 109 位示意 NPC）：兩個區（蜂巢 d_hive 等級 1、鏽帶 d_rust 等級 4）、
// 兩個勢力、幾個傾向標籤與路數、名字池；固定 NPC 六位（行者安、街坊鮑勃、日班的、一天只會在一個街區的、星期五才出現的、職員診所）加一筆舊的 id 表。
// 區、街區、路數這幾種內容種類是別的功能的，測試用替身（STUBS）定義。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx, meterOf, segmentOf, weekdayOf } from '../../src'
import { directorFeature, eventRunFeature, chooseOption } from '../../src/features/director'
import { lewdFeature } from '../../src/features/lewd'
import {
  actorOf, affinityStage, genId, knownFacts, meetNpc, npcOf, npcsFeature, npcsHere, readNpcs, relationOf, stageNow, watchNpc, whereIs, DEFAULT_NPC_RULES,
} from '../../src/features/npcs'
import { makeGame, observed } from '../../src/testkit'

// ---- 替身與假資料 ----

/** 別的功能的內容種類：區（world）、街區（world）、路數（abilities）。 */
const STUBS: Feature = {
  id: 'test_stubs',
  install(k: Kernel) {
    for (const kind of ['district', 'block', 'path']) k.content.defineKind({ kind, owner: 'test', validate: () => [] })
  },
}

const SEGMENTS_DAY = ['morning', 'noon', 'afternoon']

const ANN = {
  id: 'npc_ann', name: '安', kind: 'runner', age: 30, gender: 'female', faction: 'f_alpha', guard: 15, wealth: 2,
  haunts: [{ district: 'd_hive', block: 'b_market' }],
  persona: { attrs: ['三無'], quadrants: ['獨來獨往'] },
  tendencies: { axes: { relation: 2, sense: 0, body: 0, costume: 1 }, tags: { tg_dom: 'has' } },
  bridge: { sensitivity: 40, tolerance: 30, craving: 20, docility: 10 }, sink: 12,
  paths: [{ path: 'p_gun', slot: 'main', tier: 3 }, { path: 'p_net', slot: 'sub', tier: 1 }],
  flags: ['no_steal'], attrs: { body: 12 }, skills: { sk_a: 3 },
}
const BOB = { id: 'npc_bob', name: '鮑勃', kind: 'citizen', age: 41, guard: 13, wealth: 1, haunts: [{ district: 'd_hive', block: 'b_market' }] }
const DAYSHIFT = { id: 'npc_day', name: '日班', kind: 'citizen', age: 28, haunts: [{ district: 'd_hive', block: 'b_market', time: SEGMENTS_DAY }] }
const SPLIT = { id: 'npc_split', name: '兩邊跑', kind: 'citizen', age: 33, haunts: [{ district: 'd_hive', block: 'b_market' }, { district: 'd_hive', block: 'b_tower' }] }
const FRIDAY = { id: 'npc_fri', name: '週五', kind: 'citizen', age: 36, haunts: [{ district: 'd_hive', block: 'b_tower', weekday: 4 }] }
const CLINIC = { id: 'npc_clinic', name: '診所醫生', kind: 'staff', age: 50, haunts: [{ district: 'd_hive', block: 'b_market', facility: 'fac_clinic' }] }
const STUB = { id: 'npc_stub', name: '舊的表' }

const GEN_HIVE = {
  id: 'ng_hive', district: 'd_hive', citizens: 6, runners: 4,
  occupations: [['攤販', 2], ['社畜', 1]], factions: [['none', 2], ['f_alpha', 3], ['f_beta', 1]], names: ['np_zh'],
  haunts: [{ block: 'b_market' }, { block: 'b_tower' }, { block: 'b_market', facility: 'fac_stall', kind: ['citizen'] }],
}
const GEN_RUST = { id: 'ng_rust', district: 'd_rust', citizens: 3, runners: 3, occupations: [['農工', 1]], factions: [['f_beta', 1]], names: [['np_en', 1], ['np_zh', 1]] }

type Rec = Record<string, unknown>
type Content = Record<string, Rec[]>

const baseContent = (): Content => structuredClone({
  faction: [{ id: 'f_alpha', name: '阿爾法公司', short: '阿爾法', class: 'corp' }, { id: 'f_beta', name: '貝塔幫', short: '貝塔', class: 'street' }],
  district: [{ id: 'd_hive', name: '蜂巢', grade: 1 }, { id: 'd_rust', name: '鏽帶', grade: 4 }],
  block: [
    { id: 'b_market', district: 'd_hive', name: '市場', facilities: { $1: { type: 'fac_clinic', name: '診所' } } },
    { id: 'b_tower', district: 'd_hive', name: '塔下', facilities: {} },
  ],
  path: [{ id: 'p_gun', name: '槍手' }, { id: 'p_net', name: '潛網者' }, { id: 'p_idol', name: '偶像' }],
  skill: ['sk_a', 'sk_b', 'sk_c', 'sk_d'].map((id) => ({ id, name: id, attr: 'body', desc: '一項基本功。' })),
  tendency_tag: [
    { id: 'tg_dom', name: '支配', axis: 'relation' }, { id: 'tg_voyeur', name: '窺視', axis: 'sense' },
    { id: 'tg_fetish', name: '戀物', axis: 'body' }, { id: 'tg_goth', name: '哥德風', axis: 'costume' },
  ],
  name_pool: [
    { id: 'np_zh', family: ['陸', '周', '王', '李', '張', '林', '黃', '吳'], given: ['守仁', '曉雯', '志明', '小芬', '大偉', '佳怡', '建國', '淑惠', '俊傑', '雅婷'] },
    { id: 'np_en', order: 'given_first', family: ['瑞德', '柯爾', '瓦爾加', '史密斯'], given: ['黛比', '薇薇安', '伊萊莎', '傑克'] },
  ],
  npc_gen: [GEN_HIVE, GEN_RUST],
  npc: [ANN, BOB, DAYSHIFT, SPLIT, FRIDAY, CLINIC, STUB],
  npc_rule: [{
    id: 'default',
    persona: { attrs: ['三無', '小惡魔', '嘴甜', '老派'], quadrants: [['愛熱鬧', '獨來獨往'], ['按部就班', '見機行事'], ['護短', '記仇']] },
    tendency: { culture: { f_alpha: 'tg_dom' } },
    bridge: { bridgeless: ['f_beta'] },
  }],
  event_scope: [{ id: 'street', triggers: { enter_block: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
}) as Content

interface Opts {
  seed?: number
  content?: (c: Content) => void
  contentOff?: string[]
  events?: Rec[]
  noEvents?: boolean
}
const make = (o: Opts = {}) => {
  const c = baseContent()
  if (o.events) c.event = o.events
  o.content?.(c)
  const pack: ContentPack = { id: 'npcs_test', content: c as unknown as ContentPack['content'] }
  return makeGame({
    features: [STUBS, directorFeature, eventRunFeature, lewdFeature, npcsFeature],
    content: [pack], seed: o.seed ?? 7,
    patch: { time: { day: 3, hour: 10, minute: 0 }, ...(o.contentOff ? { rules: { contentOff: o.contentOff } as never } : {}) },
  }).game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
/** 走進一區（和世界一樣，報告帶一筆 location 變更）。 */
const go = (g: G, district: string, block?: string, facility?: string) =>
  g.commit(draft([{ op: 'location', to: { district, ...(block ? { block } : {}), ...(facility ? { facility } : {}) } }], 'test.go'))
const at = (g: G, day: number, hour: number) => {
  g.state.time = { day, hour, minute: 0 }
}
const rosterOf = (g: G, district: string): string[] => readNpcs(g.state).rosters[district]?.ids ?? []
const genOf = (g: G) => readNpcs(g.state).gen
const give = (g: G, effects: Rec[], source: 'builtin' | 'ai' | 'player' = 'builtin') => {
  const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes, 'test.give'))
  return r
}
const test = (g: G, cond: Rec, actor?: string) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules, ...(actor ? { actor } : {}) })
const firstGen = (g: G, kind: string): string => Object.values(genOf(g)).find((n) => n.kind === kind)!.id
const hereIds = (g: G): string[] => npcsHere(g.k, g.state).map((n) => n.id)

// ---- 固定 NPC ----

describe('固定 NPC：內容載得進來、npcOf', () => {
  it('npcOf 把固定 NPC 讀成統一的形狀：身分類、年齡、勢力、警覺、財富、出沒表、橋、路數、旗標', () => {
    const g = make()
    const n = npcOf(g.k, g.state, 'npc_ann')!
    expect(n).toMatchObject({
      id: 'npc_ann', name: '安', kind: 'runner', source: 'fixed', age: 30, faction: 'f_alpha', guard: 15, wealth: 2, sink: 12, flags: ['no_steal'],
      home: { district: 'd_hive', block: 'b_market' }, haunts: [{ district: 'd_hive', block: 'b_market' }],
      bridge: { sensitivity: 40, tolerance: 30, craving: 20, docility: 10 },
      paths: [{ path: 'p_gun', slot: 'main', tier: 3 }, { path: 'p_net', slot: 'sub', tier: 1 }],
      tendencies: { axes: { relation: 2, costume: 1 }, tags: { tg_dom: 'has' } }, look: {},
    })
    expect(n.attrs.body).toBe(12)
    expect(n.attrs.tech).toBe(10)
    expect(npcOf(g.k, g.state, 'npc_nobody')).toBeUndefined()
  })

  it('回傳的是複製：改它不影響內容與狀態', () => {
    const g = make()
    const n = npcOf(g.k, g.state, 'npc_ann')!
    n.paths.pop()
    n.flags.push('x')
    expect(npcOf(g.k, g.state, 'npc_ann')!.paths).toHaveLength(2)
    expect(npcOf(g.k, g.state, 'npc_ann')!.flags).toEqual(['no_steal'])
  })

  it('舊的 id 表（只有 id 與名字）照收：街坊、25 歲、沒有橋、沒有出沒表', () => {
    const g = make()
    expect(npcOf(g.k, g.state, 'npc_stub')).toMatchObject({ kind: 'citizen', age: 25, bridge: null, haunts: [], paths: [], source: 'fixed' })
  })

  it('存檔裡的變動蓋掉內容（npcs.patch）；內容不變', () => {
    const g = make()
    g.commit(draft([{ op: 'npcs.patch', npc: 'npc_bob', patch: { wealth: 4, name: '鮑勃老闆' } }]))
    expect(npcOf(g.k, g.state, 'npc_bob')).toMatchObject({ wealth: 4, name: '鮑勃老闆' })
    expect(g.k.content.get('npc', 'npc_bob')!.name).toBe('鮑勃')
    expect(() => g.commit(draft([{ op: 'npcs.patch', npc: 'npc_bob', patch: { id: 'x' } }]))).toThrow(/不能改/)
    expect(() => g.commit(draft([{ op: 'npcs.patch', npc: 'npc_bob', patch: { age: 17 } }]))).toThrow(/18/)
  })

  it('他已經是角色之後，沉溺、橋參數、傾向、路數照角色身上現在的值', () => {
    const g = make()
    g.commit(draft(actorOf(g.k, g.state, 'npc_ann')))
    g.commit(draft([{ op: 'actor.ext', id: 'npc_ann', key: 'bridge', value: { sensitivity: 55, tolerance: 30, craving: 20, docility: 10 } }, { op: 'actor.track', id: 'npc_ann', track: 'sink', delta: 3 }]))
    const n = npcOf(g.k, g.state, 'npc_ann')!
    expect(n.bridge!.sensitivity).toBe(55)
    expect(n.sink).toBe(15)
  })
})

describe('載入時擋下不合格的固定 NPC', () => {
  const bad = (patch: (c: Content) => void) => () => make({ content: patch })
  const fixed = (c: Content, id: string): Rec => c.npc!.find((e) => e.id === id)!

  it('17 歲的被擋（所有 NPC 都是成年人）；18 歲可以', () => {
    expect(bad((c) => { fixed(c, 'npc_bob').age = 17 })).toThrow(ContentError)
    expect(bad((c) => { fixed(c, 'npc_bob').age = 17 })).toThrow(/18/)
    expect(bad((c) => { fixed(c, 'npc_bob').age = 18 })).not.toThrow()
  })

  it('行者沒有 paths 被擋；街坊與職員寫了 paths 被擋', () => {
    expect(bad((c) => { delete fixed(c, 'npc_ann').paths })).toThrow(/行者要有 paths/)
    expect(bad((c) => { fixed(c, 'npc_ann').paths = [] })).toThrow(ContentError)
    expect(bad((c) => { fixed(c, 'npc_bob').paths = [{ path: 'p_gun', slot: 'main', tier: 1 }] })).toThrow(/街坊沒有路數/)
    expect(bad((c) => { fixed(c, 'npc_clinic').paths = [{ path: 'p_gun', slot: 'main', tier: 1 }] })).toThrow(/職員沒有路數/)
  })

  it('行者的 paths 要有一條主職、同一個位置不重複、階數 1～5、路數查得到', () => {
    expect(bad((c) => { fixed(c, 'npc_ann').paths = [{ path: 'p_gun', slot: 'sub', tier: 1 }] })).toThrow(/主職/)
    expect(bad((c) => { fixed(c, 'npc_ann').paths = [{ path: 'p_gun', slot: 'main', tier: 3 }, { path: 'p_net', slot: 'main', tier: 1 }] })).toThrow(/重複/)
    expect(bad((c) => { fixed(c, 'npc_ann').paths = [{ path: 'p_gun', slot: 'main', tier: 6 }] })).toThrow(ContentError)
    expect(bad((c) => { fixed(c, 'npc_ann').paths = [{ path: 'p_nothing', slot: 'main', tier: 2 }] })).toThrow(/路數 p_nothing 不存在/)
  })

  it('kind、警覺、財富、出沒表、橋、勢力的格式', () => {
    expect(bad((c) => { delete fixed(c, 'npc_bob').kind })).toThrow(/kind/)
    expect(bad((c) => { fixed(c, 'npc_bob').kind = 'hero' })).toThrow(ContentError)
    expect(bad((c) => { fixed(c, 'npc_bob').guard = 11 })).toThrow(/警覺/)
    expect(bad((c) => { fixed(c, 'npc_bob').guard = 20 })).toThrow(ContentError)
    expect(bad((c) => { fixed(c, 'npc_bob').wealth = 6 })).toThrow(/財富/)
    expect(bad((c) => { fixed(c, 'npc_bob').haunts = [{ district: 'd_hive', time: 'midnight' }] })).toThrow(/time/)
    expect(bad((c) => { fixed(c, 'npc_bob').haunts = [{ district: 'd_hive', weekday: 7 }] })).toThrow(/weekday/)
    expect(bad((c) => { fixed(c, 'npc_bob').haunts = [{ district: 'd_nowhere' }] })).toThrow(/區 d_nowhere 不存在/)
    expect(bad((c) => { fixed(c, 'npc_ann').bridge = { sensitivity: 101, tolerance: 0, craving: 0, docility: 0 } })).toThrow(/bridge/)
    expect(bad((c) => { fixed(c, 'npc_ann').faction = 'f_none' })).toThrow(/勢力 f_none 不存在/)
    expect(bad((c) => { fixed(c, 'npc_ann').bridge = null })).not.toThrow()
  })

  it('npc_gen：每區只能一筆、名字池要查得到、人數是整數；名字池與規則的格式', () => {
    expect(bad((c) => { c.npc_gen!.push({ ...GEN_HIVE, id: 'ng_again' }) })).toThrow(/已經有一筆/)
    expect(bad((c) => { c.npc_gen![0]!.names = ['np_nowhere'] })).toThrow(/名字池 np_nowhere/)
    expect(bad((c) => { c.npc_gen![0]!.citizens = -1 })).toThrow(ContentError)
    expect(bad((c) => { c.name_pool![0]!.given = [] })).toThrow(ContentError)
    expect(bad((c) => { c.npc_rule![0]!.age = { min: 17 } })).toThrow(/18/)
    expect(bad((c) => { c.npc_rule![0]!.guard = [10, 19] })).toThrow(/12～19/)
  })
})

// ---- 名單與生成 ----

describe('名單：第一次走進一區時建立', () => {
  it('人數對得上資料：固定 NPC 佔名額（街坊與行者各自算），職員不佔；其餘補生成的人', () => {
    const g = make()
    expect(rosterOf(g, 'd_hive')).toEqual([])
    go(g, 'd_hive', 'b_market')
    const ids = rosterOf(g, 'd_hive')
    const kinds = ids.map((id) => npcOf(g.k, g.state, id)!.kind)
    expect(kinds.filter((x) => x === 'citizen')).toHaveLength(6)
    expect(kinds.filter((x) => x === 'runner')).toHaveLength(4)
    expect(kinds.filter((x) => x === 'staff')).toHaveLength(1)
    // 固定的在前（照 id 排）：安、日班、鮑勃、兩邊跑、週五、診所；後面五個是生成的（2 個街坊、3 個行者）
    expect(ids.slice(0, 6)).toEqual(['npc_ann', 'npc_bob', 'npc_clinic', 'npc_day', 'npc_fri', 'npc_split'])
    const gens = ids.slice(6)
    expect(gens.map((id) => npcOf(g.k, g.state, id)!.kind)).toEqual(['citizen', 'citizen', 'runner', 'runner', 'runner'])
    expect(gens[0]).toBe(genId('d_hive', 1))
    expect(Object.keys(genOf(g))).toEqual(gens)
    expect(readNpcs(g.state).rosters.d_hive!.built).toBe(true)
  })

  it('建名單的變更寫在走進那一區的同一份報告裡（不另外多一份報告）', () => {
    const g = make()
    const [r] = go(g, 'd_hive', 'b_market')
    expect(r!.changes.map((c) => c.op)).toEqual(['location', 'npcs.roster'])
    expect(g.state.reports.filter((x) => x.changes.some((c) => c.op === 'npcs.roster'))).toHaveLength(1)
  })

  it('已經建過的不再建：離開再回來、同一區的別的報告，名單原封不動；沒有資料的區不建', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    const before = JSON.stringify(readNpcs(g.state))
    go(g, 'd_rust', 'b_yard')
    go(g, 'd_hive', 'b_tower')
    g.commit(draft([{ op: 'time', minutes: 5 }]))
    expect(JSON.stringify(readNpcs(g.state).rosters.d_hive)).toBe(JSON.stringify(JSON.parse(before).rosters.d_hive))
    expect(JSON.stringify(readNpcs(g.state).gen)).toContain('gen_d_rust_0001')
    go(g, 'test')
    expect(readNpcs(g.state).rosters.test).toBeUndefined()
  })

  it('每個生成的人都滿 18 歲（最多 75）、勢力來自那一區的表、名字來自池、名字不重複', () => {
    const g = make()
    go(g, 'd_hive')
    go(g, 'd_rust')
    const all = Object.values(genOf(g))
    expect(all).toHaveLength(5 + 6)
    for (const n of all) {
      expect(n.age).toBeGreaterThanOrEqual(18)
      expect(n.age).toBeLessThanOrEqual(75)
      expect(n.source).toBe('gen')
      expect(n.name.length).toBeGreaterThan(1)
      expect(n.guard).toBeGreaterThanOrEqual(12)
      expect(n.guard).toBeLessThanOrEqual(19)
      expect(n.wealth).toBeGreaterThanOrEqual(0)
      expect(n.wealth).toBeLessThanOrEqual(5)
      expect(n.look).toEqual({})
    }
    for (const n of all.filter((x) => x.home.district === 'd_hive')) expect([undefined, 'f_alpha', 'f_beta']).toContain(n.faction)
    for (const n of all.filter((x) => x.home.district === 'd_rust')) expect(n.faction).toBe('f_beta')
    const names = [...all.map((n) => n.name), ...['安', '鮑勃']]
    expect(new Set(names).size).toBe(names.length)
    // 鏽帶的池有一個「名在前加·」的（np_en）：名字格式不是姓名就是 名·姓
    for (const n of all.filter((x) => x.home.district === 'd_rust')) expect(/^[一-鿿]{2,4}$|^[一-鿿]+·[一-鿿]+$/.test(n.name)).toBe(true)
  })

  it('行者有一到三條路數（一個主職、位置不重複、路數不重複）；階數照這一區的難度；街坊沒有路數', () => {
    const g = make()
    go(g, 'd_hive')
    go(g, 'd_rust')
    for (const n of Object.values(genOf(g))) {
      if (n.kind !== 'runner') {
        expect(n.paths).toEqual([])
        continue
      }
      expect(n.paths.length).toBeGreaterThanOrEqual(1)
      expect(n.paths.length).toBeLessThanOrEqual(3)
      expect(n.paths.map((p) => p.slot)).toEqual(['main', 'sub', 'third'].slice(0, n.paths.length))
      expect(new Set(n.paths.map((p) => p.path)).size).toBe(n.paths.length)
      const main = n.paths[0]!.tier
      if (n.home.district === 'd_hive') expect(main).toBeLessThanOrEqual(2) // 低難度：主職 1～2
      else expect(main).toBeGreaterThanOrEqual(3) // 高難度：主職 3～4
      for (const p of n.paths) expect(p.tier).toBeGreaterThanOrEqual(1)
      for (const s of Object.values(n.skills)) expect(s).toBeLessThanOrEqual(Math.max(1, main))
    }
  })

  it('性格、傾向與橋：屬性 1～2 個、每個象限一項；傾向每條軸最多一個標籤；勢力關掉橋的人沒有橋與沉溺；有橋的在範圍內', () => {
    const g = make()
    go(g, 'd_hive')
    go(g, 'd_rust')
    for (const n of Object.values(genOf(g))) {
      expect(n.persona.attrs.length).toBeGreaterThanOrEqual(1)
      expect(n.persona.attrs.length).toBeLessThanOrEqual(2)
      expect(n.persona.quadrants).toHaveLength(3)
      const tags = Object.keys(n.tendencies.tags)
      expect(tags.length).toBeLessThanOrEqual(4)
      const axes = tags.map((t) => g.k.content.get('tendency_tag', t)!.axis)
      expect(new Set(axes).size).toBe(axes.length)
      for (const lv of Object.values(n.tendencies.axes)) expect([0, 1, 2, 3]).toContain(lv)
      if (n.faction === 'f_beta') {
        expect(n.bridge).toBeNull()
        expect(n.sink).toBe(0)
      } else if (n.bridge) {
        for (const v of Object.values(n.bridge)) {
          expect(v).toBeGreaterThanOrEqual(15)
          expect(v).toBeLessThanOrEqual(60)
        }
        expect(n.sink).toBeGreaterThanOrEqual(5)
        expect(n.sink).toBeLessThanOrEqual(20)
      }
    }
  })

  it('同一個種子兩次生成的人一模一樣；換種子不一樣；到的先後順序不影響每一區的人（種子加區的 id）', () => {
    const a = make({ seed: 11 })
    const b = make({ seed: 11 })
    const c = make({ seed: 12 })
    for (const g of [a, b, c]) {
      go(g, 'd_hive')
      go(g, 'd_rust')
    }
    expect(genOf(a)).toEqual(genOf(b))
    expect(rosterOf(a, 'd_hive')).toEqual(rosterOf(b, 'd_hive'))
    expect(JSON.stringify(genOf(a))).not.toBe(JSON.stringify(genOf(c)))
    const d = make({ seed: 11 })
    go(d, 'd_rust')
    go(d, 'd_hive')
    expect(genOf(d)).toEqual(genOf(a))
  })

  it('性別：預設五種都有；把某一種對象性別關掉，生成的名單裡就沒有那一種；全關了就不生成（只剩固定的）', () => {
    const everything = make({ seed: 3, content: (c) => { c.npc_gen![0]!.citizens = 40; c.npc_gen![0]!.runners = 40 } })
    go(everything, 'd_hive')
    const genders = new Set(Object.values(genOf(everything)).map((n) => n.gender))
    expect(genders).toEqual(new Set(['female', 'male', 'femboy', 'trans_f', 'futa']))

    const noMale = make({ seed: 3, contentOff: ['male_partner'], content: (c) => { c.npc_gen![0]!.citizens = 40; c.npc_gen![0]!.runners = 40 } })
    go(noMale, 'd_hive')
    const g2 = Object.values(genOf(noMale))
    expect(g2).toHaveLength(80 - 5)
    expect(g2.some((n) => n.gender === 'male')).toBe(false)
    expect(g2.some((n) => n.gender === 'female')).toBe(true)

    const onlyFuta = make({ contentOff: ['male_partner', 'female_partner', 'femboy_partner', 'trans_partner'] })
    go(onlyFuta, 'd_hive')
    expect(new Set(Object.values(genOf(onlyFuta)).map((n) => n.gender))).toEqual(new Set(['futa']))

    const none = make({ contentOff: ['male_partner', 'female_partner', 'femboy_partner', 'trans_partner', 'futa_partner'] })
    go(none, 'd_hive')
    expect(Object.keys(genOf(none))).toEqual([])
    expect(rosterOf(none, 'd_hive')).toHaveLength(6)
  })

  it('傾向標籤被內容篩選關掉的不抽', () => {
    const g = make({ seed: 5, contentOff: ['tg_dom', 'tg_voyeur'], content: (c) => { c.npc_gen![0]!.citizens = 40; c.npc_gen![0]!.runners = 40 } })
    go(g, 'd_hive')
    const tags = new Set(Object.values(genOf(g)).flatMap((n) => Object.keys(n.tendencies.tags)))
    expect(tags.has('tg_dom')).toBe(false)
    expect(tags.has('tg_voyeur')).toBe(false)
    expect(tags.has('tg_fetish') || tags.has('tg_goth')).toBe(true)
  })

  it('勢力的文化分支加權（npc_rule 的 culture）：f_alpha 的人在「關係」軸上抽到支配的比例，隨 culture_mult 變大', () => {
    const share = (mult: number) => {
      const g = make({
        seed: 9,
        content: (c) => {
          c.tendency_tag!.push({ id: 'tg_sub', name: '服從', axis: 'relation' })
          c.npc_gen![0]!.citizens = 150
          c.npc_gen![0]!.runners = 150
          c.npc_gen![0]!.factions = [['f_alpha', 1]]
          Object.assign(c.npc_rule![0]!.tendency as Rec, { culture_mult: mult, tag_chance: 1, states: { has: 1 } })
        },
      })
      go(g, 'd_hive')
      const tags = Object.values(genOf(g)).flatMap((n) => Object.keys(n.tendencies.tags)).filter((t) => t === 'tg_dom' || t === 'tg_sub')
      return tags.filter((t) => t === 'tg_dom').length / tags.length
    }
    expect(share(1)).toBeGreaterThan(0.35)
    expect(share(1)).toBeLessThan(0.65)
    expect(share(30)).toBeGreaterThan(0.9)
  })

  it('沒有 npc_gen 的區、只有固定 NPC 住在那裡：名單就是固定的人；npc_rule 蓋掉內建數字（名單的人數與年齡範圍）', () => {
    const g = make({ content: (c) => { c.npc_rule![0]!.age = { main: [60, 70], main_chance: 1, runner: [60, 70] }; c.npc_rule![0]!.wealth = [0, 0, 0, 0, 0, 1] } })
    go(g, 'd_hive')
    for (const n of Object.values(genOf(g))) {
      expect(n.age).toBeGreaterThanOrEqual(60)
      expect(n.age).toBeLessThanOrEqual(70)
      expect(n.wealth).toBe(5)
    }
    expect(DEFAULT_NPC_RULES.age.min).toBe(18)
  })
})

// ---- 今天在哪 ----

describe('npcsHere：這個位置、時段、星期對得上出沒表的人', () => {
  it('白天只在的人白天在、晚上不在；沒寫時段的一直在', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    at(g, 4, 9)
    expect(hereIds(g)).toContain('npc_day')
    expect(hereIds(g)).toContain('npc_bob')
    at(g, 4, 21)
    expect(hereIds(g)).not.toContain('npc_day')
    expect(hereIds(g)).toContain('npc_bob')
    expect(whereIs(g.k, g.state, 'npc_day')).toBeNull()
  })

  it('同一個時刻只在一個街區；同一天不同時段還是同一個街區；隔天重算（兩個街區都會輪到）', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    const placeAt = (day: number, hour: number): string | null => {
      at(g, day, hour)
      return whereIs(g.k, g.state, 'npc_split')?.block ?? null
    }
    const seen = new Set<string | null>()
    for (let day = 1; day <= 30; day++) {
      const hours = [4, 8, 12, 16, 20].map((h) => placeAt(day, h))
      expect(new Set(hours).size).toBe(1) // 同一天都一樣
      seen.add(hours[0]!)
      // 在市場的那天市場看得到他、塔下看不到；反過來也一樣
      at(g, day, 12)
      g.state.location = { district: 'd_hive', block: 'b_market' }
      const inMarket = hereIds(g).includes('npc_split')
      g.state.location = { district: 'd_hive', block: 'b_tower' }
      const inTower = hereIds(g).includes('npc_split')
      expect([inMarket, inTower].filter(Boolean)).toHaveLength(1)
    }
    expect(seen).toEqual(new Set(['b_market', 'b_tower']))
    // 重新算一次結果不變（不存檔，靠固定亂數）
    expect(placeAt(5, 12)).toBe(placeAt(5, 12))
  })

  it('星期的出沒：只有星期五在塔下的人，別的日子不在', () => {
    const g = make()
    go(g, 'd_hive', 'b_tower')
    const days = Array.from({ length: 14 }, (_, i) => i + 1)
    for (const day of days) {
      at(g, day, 12)
      expect(hereIds(g).includes('npc_fri')).toBe(weekdayOf(g.state.time, g.k.timeRules) === 4)
    }
  })

  it('設施：職員只在站著那間設施時出現（標記或種類都對得上）；在街上的人在設施裡看不到', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    at(g, 4, 9)
    expect(hereIds(g)).not.toContain('npc_clinic')
    g.state.location = { district: 'd_hive', block: 'b_market', facility: '$1' }
    expect(hereIds(g)).toContain('npc_clinic')
    expect(hereIds(g)).not.toContain('npc_bob')
    g.state.location = { district: 'd_hive', block: 'b_tower', facility: '$1' }
    expect(hereIds(g)).not.toContain('npc_clinic')
  })

  it('別的區看不到；名單還沒建的區是空的；被捕、躲風頭、在忙的人不照出沒表', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    at(g, 4, 9)
    g.state.location = { district: 'd_rust', block: 'b_yard' }
    expect(hereIds(g).filter((id) => id.startsWith('npc_'))).toEqual([])
    g.state.location = { district: 'd_hive', block: 'b_market' }
    expect(hereIds(g)).toContain('npc_bob')
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    g.commit(draft([{ op: 'actor.condition', id: 'npc_bob', condition: 'arrested' }]))
    expect(hereIds(g)).not.toContain('npc_bob')
    expect(whereIs(g.k, g.state, 'npc_bob')).toBeNull()
    g.commit(draft([{ op: 'actor.condition', id: 'npc_bob', condition: 'arrested', remove: true }]))
    expect(hereIds(g)).toContain('npc_bob')
  })

  it('生成的人的出沒表來自 npc_gen 的模板（這一區的街區）；時段是 whereIs 用的那個', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    for (const n of Object.values(genOf(g))) {
      expect(n.haunts.length).toBeGreaterThanOrEqual(1)
      for (const h of n.haunts) {
        expect(h.district).toBe('d_hive')
        expect(['b_market', 'b_tower']).toContain(h.block)
      }
    }
    at(g, 4, 9)
    expect(segmentOf(g.state.time, g.k.timeRules)).toBe('morning')
  })
})

// ---- 關係 ----

describe('關係：meet 之後才有條目；親密度只經由量表', () => {
  it('meet 之後有條目：親密度是 0、階段是「生」、見面的時間與地點自動記；之前沒有條目、條件不成立', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    const id = firstGen(g, 'citizen')
    expect(relationOf(g.state, id)).toBeUndefined()
    expect(test(g, { kind: 'knows', npc: id })).toBe(false)
    expect(test(g, { kind: 'affinity_stage', npc: id, min: 'stranger' })).toBe(false)
    expect(stageNow(g.k, g.state, id)).toBeNull()

    const [r] = g.commit(meetNpc(g.k, g.state, id))
    expect(r!.action).toBe('npc.meet')
    expect(r!.kind).toBe('social')
    const rel = relationOf(g.state, id)!
    expect(rel).toMatchObject({ known: [], watch: false, relation: '', first: { day: 3, hour: 10, minute: 0 }, at: { district: 'd_hive', block: 'b_market' } })
    expect(rel.last).toEqual(rel.first)
    expect(meterOf(g.k, g.state, 'affinity', id)).toBe(0)
    expect(stageNow(g.k, g.state, id)).toMatchObject({ id: 'stranger', name: '生' })
    expect(test(g, { kind: 'knows', npc: id })).toBe(true)
    expect(test(g, { kind: 'affinity_stage', npc: id, min: 'stranger' })).toBe(true)
    // 認識的人變成角色（親密度的量表要查得到人）
    expect(g.state.actors[id]).toMatchObject({ role: 'npc', name: genOf(g)[id]!.name })
  })

  it('量表 +30 之後階段是「熟」；affinity_stage 條件跟著成立（min、max、第幾段）', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    expect(test(g, { kind: 'affinity_stage', npc: 'npc_bob', min: 'familiar' })).toBe(false)
    give(g, [{ kind: 'affinity', key: 'npc_bob', amount: 30 }])
    expect(meterOf(g.k, g.state, 'affinity', 'npc_bob')).toBe(30)
    expect(stageNow(g.k, g.state, 'npc_bob')).toMatchObject({ id: 'familiar', name: '熟', index: 3 })
    expect(test(g, { kind: 'affinity_stage', npc: 'npc_bob', min: 'familiar' })).toBe(true)
    expect(test(g, { kind: 'affinity_stage', npc: 'npc_bob', min: 3 })).toBe(true)
    expect(test(g, { kind: 'affinity_stage', npc: 'npc_bob', min: 'close' })).toBe(false)
    expect(test(g, { kind: 'affinity_stage', npc: 'npc_bob', max: 'stranger' })).toBe(false)
    expect(test(g, { kind: 'affinity_stage', min: 'familiar' }, 'npc_bob')).toBe(true) // 沒寫 npc 就看 ctx.actor
    // 同名的量表條件核心自動有
    expect(test(g, { kind: 'affinity', key: 'npc_bob', min: 30 })).toBe(true)
  })

  it('七段的界線：−100～−50 仇、−49～−20 嫌、−19～19 生、20～39 熟、40～59 交心、60～79 親近、80～100 羈絆', () => {
    const cases: Array<[number, string]> = [
      [-100, '仇'], [-50, '仇'], [-49, '嫌'], [-20, '嫌'], [-19, '生'], [0, '生'], [19, '生'], [20, '熟'], [39, '熟'], [40, '交心'], [59, '交心'], [60, '親近'], [79, '親近'], [80, '羈絆'], [100, '羈絆'],
    ]
    for (const [v, name] of cases) expect(affinityStage(v).name, String(v)).toBe(name)
    expect(affinityStage(-50).id).toBe('foe')
    expect(affinityStage(100).index).toBe(6)
  })

  it('親密度的範圍與 AI 的上限：−100～100；AI 一件事最多 ±8', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    give(g, [{ kind: 'affinity', key: 'npc_bob', amount: 500 }])
    expect(meterOf(g.k, g.state, 'affinity', 'npc_bob')).toBe(100)
    give(g, [{ kind: 'affinity', key: 'npc_bob', amount: -500 }])
    expect(meterOf(g.k, g.state, 'affinity', 'npc_bob')).toBe(-100)
    give(g, [{ kind: 'affinity', key: 'npc_bob', amount: 30 }], 'ai')
    expect(meterOf(g.k, g.state, 'affinity', 'npc_bob')).toBe(-92)
  })

  it('還沒 meet 的生成人沒有量表可以動（角色還不存在）；固定 NPC 在內容裡，量表照寫得動但沒有條目', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    const id = firstGen(g, 'citizen')
    expect(() => give(g, [{ kind: 'affinity', key: id, amount: 5 }])).toThrow()
    give(g, [{ kind: 'affinity', key: 'npc_ann', amount: 5 }])
    expect(knownFacts(g.state, 'npc_ann')).toEqual([])
    expect(test(g, { kind: 'knows', npc: 'npc_ann' })).toBe(false)
    expect(test(g, { kind: 'affinity_stage', npc: 'npc_ann', min: 'stranger' })).toBe(false)
  })

  it('再見一次：第一次見面不變、最後一次見面更新；不能認識自己或查不到的人（ActionBlocked，狀態不動）', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    g.commit(draft([{ op: 'time', minutes: 200 }]))
    const [r] = g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    expect(r!.outcome.result).toBe('seen')
    const rel = relationOf(g.state, 'npc_bob')!
    expect(rel.first).toEqual({ day: 3, hour: 10, minute: 0 })
    expect(rel.last).toEqual({ day: 3, hour: 13, minute: 20 })
    const before = JSON.stringify(g.state)
    expect(() => meetNpc(g.k, g.state, 'pc')).toThrow(ActionBlocked)
    expect(() => meetNpc(g.k, g.state, 'npc_nobody')).toThrow(/查不到/)
    expect(JSON.stringify(g.state)).toBe(before)
  })

  it('關注與一句話：watchNpc 要先認識；npcs.relation 改那一句', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    expect(() => watchNpc(g.k, g.state, 'npc_bob')).toThrow(/還不認識/)
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    const [r] = g.commit(watchNpc(g.k, g.state, 'npc_bob'))
    expect(r!.action).toBe('npc.watch')
    expect(relationOf(g.state, 'npc_bob')!.watch).toBe(true)
    g.commit(watchNpc(g.k, g.state, 'npc_bob', false))
    expect(relationOf(g.state, 'npc_bob')!.watch).toBe(false)
    g.commit(draft([{ op: 'npcs.relation', npc: 'npc_bob', text: '上次替你擋了一槍。' }]))
    expect(relationOf(g.state, 'npc_bob')!.relation).toBe('上次替你擋了一槍。')
    expect(() => g.commit(draft([{ op: 'npcs.relation', npc: 'npc_ann', text: 'x' }]))).toThrow(/還不認識/)
  })

  it('效果 meet：和 meetNpc 一樣建條目；已經認識的只更新最後一次；查不到的人整筆拿掉並提醒；結果一行', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    const r = give(g, [{ kind: 'meet', npc: 'npc_bob' }])
    expect(r.lines).toEqual(['認識了：鮑勃'])
    expect(test(g, { kind: 'knows', npc: 'npc_bob' })).toBe(true)
    const again = give(g, [{ kind: 'meet', npc: 'npc_bob' }])
    expect(again.lines).toEqual(['又見到了：鮑勃'])
    const lost = give(g, [{ kind: 'meet', npc: 'npc_nobody' }])
    expect(lost.effects).toEqual([])
    expect(lost.clamps[0]!.notice).toMatch(/查不到/)
    expect(() => give(g, [{ kind: 'meet' }])).toThrow(/npc/)
  })
})

describe('npc_known：已知的事', () => {
  it('記進去的事查得到；同一件不重複；不同的事各記一筆', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    const r1 = give(g, [{ kind: 'npc_known', npc: 'npc_bob', fact: 'tendency:tg_voyeur' }, { kind: 'npc_known', npc: 'npc_bob', fact: 'bridge' }])
    expect(r1.lines).toEqual(['記下了：鮑勃的傾向「窺視」', '記下了：鮑勃的橋參數'])
    expect(knownFacts(g.state, 'npc_bob')).toEqual(['tendency:tg_voyeur', 'bridge'])
    const r2 = give(g, [{ kind: 'npc_known', npc: 'npc_bob', fact: 'tendency:tg_voyeur' }])
    expect(r2.effects).toEqual([])
    expect(r2.clamps).toEqual([])
    give(g, [{ kind: 'npc_known', npc: 'npc_bob', fact: 'secret:欠債' }, { kind: 'npc_known', npc: 'npc_bob', fact: 'secret:欠債' }, { kind: 'npc_known', npc: 'npc_bob', fact: 'contract' }])
    expect(knownFacts(g.state, 'npc_bob')).toEqual(['tendency:tg_voyeur', 'bridge', 'secret:欠債', 'contract'])
  })

  it('還不認識的人記不進去（整筆拿掉並提醒）；寫法不對是格式錯誤', () => {
    const g = make()
    go(g, 'd_hive', 'b_market')
    const r = give(g, [{ kind: 'npc_known', npc: 'npc_bob', fact: 'bridge' }])
    expect(r.effects).toEqual([])
    expect(r.clamps[0]!.notice).toMatch(/還不認識/)
    for (const fact of ['gossip', 'tendency:', 'secret:', 7, undefined]) {
      expect(() => give(g, [{ kind: 'npc_known', npc: 'npc_bob', fact }])).toThrow(/fact/)
    }
    expect(() => g.commit(draft([{ op: 'npcs.known', npc: 'npc_bob', fact: 'bridge' }]))).toThrow(/還不認識/)
  })
})

// ---- 變成角色 ----

describe('actorOf：把人變成 state.actors 裡的角色', () => {
  it('行者變成角色之後有路數與橋參數、屬性、基本功、傾向；再呼叫一次沒有新的變更', () => {
    const g = make()
    const changes = actorOf(g.k, g.state, 'npc_ann')
    expect(changes).toHaveLength(1)
    expect(changes[0]!.op).toBe('actor.add')
    g.commit(draft(changes))
    const a = g.state.actors.npc_ann!
    expect(a).toMatchObject({ id: 'npc_ann', name: '安', role: 'npc', age: 30, gender: 'female', sink: 12, skills: { sk_a: 3 } })
    expect(a.attrs.body).toBe(12)
    expect(a.hp).toBe(20 + 12 * 2)
    expect(a.ext.paths).toEqual([{ path: 'p_gun', slot: 'main', tier: 3 }, { path: 'p_net', slot: 'sub', tier: 1 }])
    expect(a.ext.bridge).toEqual({ sensitivity: 40, tolerance: 30, craving: 20, docility: 10 })
    expect(a.ext.tendency).toMatchObject({ axes: { relation: 2, costume: 1 }, tags: { tg_dom: 'has' } })
    expect(actorOf(g.k, g.state, 'npc_ann')).toEqual([])
  })

  it('生成的行者也一樣；街坊沒有 ext.paths；沒有橋的人 ext.bridge 是 null（lewd 當成沒有橋）', () => {
    const g = make({ seed: 2 })
    go(g, 'd_hive')
    go(g, 'd_rust')
    const runner = firstGen(g, 'runner')
    const citizen = firstGen(g, 'citizen')
    const bridgeless = Object.values(genOf(g)).find((n) => n.bridge === null)!
    g.commit(draft([...actorOf(g.k, g.state, runner), ...actorOf(g.k, g.state, citizen), ...actorOf(g.k, g.state, bridgeless.id)].filter((c, i, all) => all.findIndex((x) => (x.actor as { id: string }).id === (c.actor as { id: string }).id) === i)))
    expect(g.state.actors[runner]!.ext.paths).toEqual(genOf(g)[runner]!.paths)
    expect((g.state.actors[runner]!.ext.paths as unknown[]).length).toBeGreaterThanOrEqual(1)
    expect(g.state.actors[citizen]!.ext.paths).toBeUndefined()
    expect(g.state.actors[bridgeless.id]!.ext.bridge).toBeNull()
    expect(g.state.actors[runner]!.age).toBeGreaterThanOrEqual(18)
  })

  it('身體（body）：npcs 的 buildActor 一手寫進 ext.body（夜課的學習條件從這裡讀）；沒寫身體的人沒有這個鍵；用 npcs.patch 改了身體之後再變角色寫的是新的（M4-followups-2 第 7 項）', () => {
    const g = make({ content: (c) => { (c.npc as Rec[]).find((n) => n.id === 'npc_ann')!.body = 'fem' } })
    g.commit(draft([...actorOf(g.k, g.state, 'npc_ann'), ...actorOf(g.k, g.state, 'npc_bob')]))
    expect(g.state.actors.npc_ann!.ext.body).toBe('fem')
    expect(Object.hasOwn(g.state.actors.npc_bob!.ext, 'body')).toBe(false)
    // 格式：不是三種之一載入時擋下
    expect(() => make({ content: (c) => { (c.npc as Rec[])[0]!.body = 'xyz' } })).toThrow(/body 要是 masc、fem、andro/)
    // 還不是角色的人先用 npcs.patch 改身體，變成角色時帶著新的
    const h = make()
    h.commit(draft([{ op: 'npcs.patch', npc: 'npc_bob', patch: { body: 'andro' } }]))
    h.commit(draft(actorOf(h.k, h.state, 'npc_bob')))
    expect(h.state.actors.npc_bob!.ext.body).toBe('andro')
  })

  it('查不到的人丟錯（呼叫的人的錯）；17 歲的角色核心擋下', () => {
    const g = make()
    expect(() => actorOf(g.k, g.state, 'npc_nobody')).toThrow(/查不到/)
    expect(() => g.commit(draft([{ op: 'npcs.gen', npc: { ...npcOf(g.k, g.state, 'npc_ann')!, id: 'gen_x', age: 17 } }]))).toThrow(/18/)
  })
})

// ---- director.cast ----

describe('director.cast：固定 NPC、認識的人、新生成的人', () => {
  const opt = (id: string, text: string, effects: Rec[] = []): Rec => ({ id, text, outcomes: { any: effects } })
  const castEvent = (id: string, cast: Rec[]): Rec => ({
    id, scope: 'street', triggers: ['enter_block'], text: '有人在等你。', cast,
    options: [opt('meet', '搭話。', [{ kind: 'meet', npc: '$a' }]), opt('leave', '走開。')],
  })
  const open = (g: G, event: string) => g.launch('event', { event }, { by: 'caller', ref: 'x1' })
  const pick = (g: G, id: string) => g.commit(chooseOption(g.k, g.state, id))
  const withEvents = (...events: Rec[]) => {
    const g = make({ events })
    go(g, 'd_hive', 'b_market')
    return g
  }
  const castOf = (g: G, role = 'a'): string => (g.state.ext.director as { open: { cast: Record<string, string> } }).open.cast[role]!

  it('指定的固定 NPC：回答他的 id、先套他變成角色的變更；開完事件他還在（固定的人不清掉）', () => {
    const g = withEvents(castEvent('ev_fixed', [{ role: 'a', npc: 'npc_ann' }]))
    expect(g.state.actors.npc_ann).toBeUndefined()
    open(g, 'ev_fixed')
    expect(castOf(g)).toBe('npc_ann')
    expect(g.state.actors.npc_ann).toMatchObject({ name: '安', role: 'npc' })
    expect(g.state.actors.npc_ann!.ext.paths).toBeDefined()
    expect(g.state.actors.npc_ann!.ext.event_temp).toBeUndefined()
    pick(g, 'leave')
    expect(g.state.actors.npc_ann).toBeDefined()
  })

  it('指定的人查不到：交給導演用臨時角色', () => {
    const g = withEvents(castEvent('ev_nobody', [{ role: 'a', npc: 'npc_nobody' }]))
    open(g, 'ev_nobody')
    expect(castOf(g)).toMatch(/^tmp_\d+_a$/)
    expect(g.state.actors[castOf(g)]!.ext.event_temp).toBe(true)
    expect(npcOf(g.k, g.state, castOf(g))).toBeUndefined()
  })

  it('主角認識的人（照條件挑）：只挑認識的；段、身分類、勢力、區、requires 都是條件；沒有人合格就交給導演', () => {
    const g = withEvents(
      castEvent('ev_known', [{ role: 'a', known: {} }]),
      castEvent('ev_close', [{ role: 'a', known: { stage: 'familiar' } }]),
      castEvent('ev_runner', [{ role: 'a', known: { kind: 'runner' } }]),
      castEvent('ev_rich', [{ role: 'a', known: { requires: { kind: 'affinity', key: 'npc_bob', min: 20 } } }]),
    )
    // 一個人都不認識：導演的臨時角色
    open(g, 'ev_known')
    const first = castOf(g)
    expect(first).toMatch(/^tmp_/)
    pick(g, 'leave')
    expect(g.state.actors[first]).toBeUndefined()
    give(g, [{ kind: 'meet', npc: 'npc_bob' }, { kind: 'meet', npc: 'npc_ann' }])
    give(g, [{ kind: 'affinity', key: 'npc_bob', amount: 25 }])

    open(g, 'ev_known')
    expect(['npc_bob', 'npc_ann']).toContain(castOf(g))
    pick(g, 'leave')
    open(g, 'ev_close')
    expect(castOf(g)).toBe('npc_bob') // 只有鮑勃到了「熟」
    pick(g, 'leave')
    open(g, 'ev_runner')
    expect(castOf(g)).toBe('npc_ann')
    pick(g, 'leave')
    open(g, 'ev_rich')
    expect(['npc_bob', 'npc_ann']).toContain(castOf(g)) // 條件對每個候選人各測一次（requires 本身看 npc_bob，所以都成立）
    pick(g, 'leave')
    // 沒有人合格：臨時角色
    give(g, [{ kind: 'affinity', key: 'npc_bob', amount: -25 }])
    open(g, 'ev_close')
    expect(castOf(g)).toMatch(/^tmp_/)
  })

  it('照當下的區新生成的人：臨時角色 tmp_<n>_<代號>、ext.event_temp、有一筆生成的資料（這一區的勢力、名字池的名字）；同一個狀態結果一樣', () => {
    const g = withEvents(castEvent('ev_gen', [{ role: 'a', gen: { kind: 'runner' } }, { role: 'b', gen: { kind: 'citizen' } }]))
    const uid = g.state.seq.uid
    open(g, 'ev_gen')
    const [a, b] = [castOf(g, 'a'), castOf(g, 'b')]
    expect(a).toBe(`tmp_${uid + 1}_a`)
    expect(b).toBe(`tmp_${uid + 1}_b`)
    expect(g.state.actors[a]).toMatchObject({ role: 'npc', ext: { event_temp: true } })
    const na = npcOf(g.k, g.state, a)!
    expect(na).toMatchObject({ kind: 'runner', source: 'gen', home: { district: 'd_hive' } })
    expect(na.paths.length).toBeGreaterThanOrEqual(1)
    expect(g.state.actors[a]!.ext.paths).toEqual(na.paths)
    expect(g.state.actors[a]!.name).toBe(na.name)
    expect(na.age).toBeGreaterThanOrEqual(18)
    expect(npcOf(g.k, g.state, b)!.kind).toBe('citizen')
    expect(na.name).not.toBe(npcOf(g.k, g.state, b)!.name)
    // 沒有進名單
    expect(rosterOf(g, 'd_hive')).not.toContain(a)

    const h = withEvents(castEvent('ev_gen', [{ role: 'a', gen: { kind: 'runner' } }, { role: 'b', gen: { kind: 'citizen' } }]))
    open(h, 'ev_gen')
    expect(npcOf(h.k, h.state, a)).toEqual(na)
  })

  it('新生成的人事件結束後：有條目的留在名單上（升格），沒有的清掉（角色與資料都不留）', () => {
    const kept = withEvents(castEvent('ev_gen', [{ role: 'a', gen: { kind: 'runner' } }]))
    const rosterBefore = rosterOf(kept, 'd_hive').length
    open(kept, 'ev_gen')
    const a = castOf(kept)
    pick(kept, 'meet')
    expect(kept.state.ext.director && (kept.state.ext.director as { open?: unknown }).open).toBeFalsy()
    expect(kept.state.actors[a]).toBeDefined()
    expect(kept.state.actors[a]!.ext.event_temp).toBeUndefined()
    expect(rosterOf(kept, 'd_hive')).toContain(a)
    expect(rosterOf(kept, 'd_hive')).toHaveLength(rosterBefore + 1)
    expect(relationOf(kept.state, a)).toBeDefined()
    expect(npcOf(kept.k, kept.state, a)).toMatchObject({ id: a, source: 'gen', kind: 'runner' })

    const dropped = withEvents(castEvent('ev_gen', [{ role: 'a', gen: { kind: 'runner' } }]))
    open(dropped, 'ev_gen')
    const b = castOf(dropped)
    expect(dropped.state.actors[b]).toBeDefined()
    pick(dropped, 'leave')
    expect(dropped.state.actors[b]).toBeUndefined()
    expect(npcOf(dropped.k, dropped.state, b)).toBeUndefined()
    expect(rosterOf(dropped, 'd_hive')).not.toContain(b)
    expect(rosterOf(dropped, 'd_hive')).toHaveLength(rosterBefore)
    expect(Object.keys(genOf(dropped))).not.toContain(b)
  })

  it('升格的人之後照生成的人用：親密度可以動、能被認識的人挑中、出現在這一區的 npcsHere 之外不影響別人', () => {
    const g = withEvents(castEvent('ev_gen', [{ role: 'a', gen: { kind: 'citizen' } }]), castEvent('ev_again', [{ role: 'a', known: {} }]))
    open(g, 'ev_gen')
    const a = castOf(g)
    pick(g, 'meet')
    give(g, [{ kind: 'affinity', key: a, amount: 30 }])
    expect(test(g, { kind: 'affinity_stage', npc: a, min: 'familiar' })).toBe(true)
    open(g, 'ev_again')
    expect(castOf(g)).toBe(a)
  })

  it('沒有資料的臨時角色（導演自己做的）被認識時：照現在這一區補一筆資料、升格進名單；沒有被認識的清掉', () => {
    const met = withEvents(castEvent('ev_plain', [{ role: 'a' }]))
    open(met, 'ev_plain')
    const a = castOf(met)
    expect(npcOf(met.k, met.state, a)).toBeUndefined()
    const name = met.state.actors[a]!.name
    pick(met, 'meet')
    expect(met.state.actors[a]!.ext.event_temp).toBeUndefined()
    expect(npcOf(met.k, met.state, a)).toMatchObject({ id: a, name, kind: 'citizen', home: { district: 'd_hive' } })
    expect(rosterOf(met, 'd_hive')).toContain(a)
    expect(relationOf(met.state, a)).toBeDefined()

    const left = withEvents(castEvent('ev_plain', [{ role: 'a' }]))
    open(left, 'ev_plain')
    const b = castOf(left)
    pick(left, 'leave')
    expect(left.state.actors[b]).toBeUndefined()
  })

  it('事件裡最後一個選項才 meet（同一份報告）也算有條目：不會先被清掉', () => {
    const g = withEvents({
      id: 'ev_two', scope: 'street', triggers: ['enter_block'], text: '兩段。', cast: [{ role: 'a', gen: {} }],
      stages: [{ text: '第一段。', options: [opt('next', '繼續。')] }, { text: '第二段。', options: [opt('meet', '搭話。', [{ kind: 'meet', npc: '$a' }, { kind: 'affinity', key: '$a', amount: 10 }])] }],
    })
    open(g, 'ev_two')
    const a = castOf(g)
    pick(g, 'next')
    expect(g.state.actors[a]).toBeDefined()
    pick(g, 'meet')
    expect(g.state.actors[a]).toBeDefined()
    expect(meterOf(g.k, g.state, 'affinity', a)).toBe(10)
    expect(rosterOf(g, 'd_hive')).toContain(a)
  })
})

// ---- 存檔 ----

describe('存檔往返', () => {
  it('名單、關係條目、生成的人、固定 NPC 的變動都在；讀回來 npcOf 一樣、接著再 meet 照常', () => {
    const g = make({ seed: 21 })
    go(g, 'd_hive', 'b_market')
    go(g, 'd_rust')
    const gid = firstGen(g, 'runner')
    g.commit(meetNpc(g.k, g.state, gid))
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    give(g, [{ kind: 'affinity', key: gid, amount: 45 }, { kind: 'npc_known', npc: gid, fact: 'bridge' }, { kind: 'npc_known', npc: 'npc_bob', fact: 'secret:欠債' }])
    g.commit(watchNpc(g.k, g.state, 'npc_bob'))
    g.commit(draft([{ op: 'npcs.patch', npc: 'npc_bob', patch: { wealth: 3 } }]))

    const raw = g.save()
    const g2 = make({ seed: 21 })
    expect(g2.load(raw)).toBeNull()
    expect(readNpcs(g2.state)).toEqual(readNpcs(g.state))
    expect(Object.keys(genOf(g2))).toHaveLength(Object.keys(genOf(g)).length)
    expect(npcOf(g2.k, g2.state, gid)).toEqual(npcOf(g.k, g.state, gid))
    expect(npcOf(g2.k, g2.state, 'npc_bob')!.wealth).toBe(3)
    expect(relationOf(g2.state, gid)).toEqual(relationOf(g.state, gid))
    expect(knownFacts(g2.state, 'npc_bob')).toEqual(['secret:欠債'])
    expect(stageNow(g2.k, g2.state, gid)).toMatchObject({ id: 'close' })
    expect(rosterOf(g2, 'd_rust')).toEqual(rosterOf(g, 'd_rust'))
    // 讀回來之後再走進一區：名單不會重建
    const before = JSON.stringify(readNpcs(g2.state).rosters)
    go(g2, 'd_hive', 'b_tower')
    expect(JSON.stringify(readNpcs(g2.state).rosters)).toBe(before)
  })
})

describe('報告與不變式', () => {
  it('走進一區、認識、記事、關注的每一份報告：changes 套用之後等於實際的狀態變化（提交的不變式）', async () => {
    const g = make({ seed: 4 })
    const { violations } = await observed(g, async () => {
      go(g, 'd_hive', 'b_market')
      const id = firstGen(g, 'runner')
      g.commit(meetNpc(g.k, g.state, id))
      give(g, [{ kind: 'affinity', key: id, amount: 12 }, { kind: 'npc_known', npc: id, fact: 'tendency:tg_dom' }])
      g.commit(watchNpc(g.k, g.state, id))
      go(g, 'd_rust')
    })
    expect(violations).toEqual([])
  })
})

// ---- 外觀詞條的條件 look（M4-followups-2 第 11 項） ----

describe('條件 look { field, value, who? }', () => {
  it('主角讀建角寫的 ext.profile.look；欄位是陣列就看包含；沒有這個欄位、詞條不同、不認得的人都不成立；who 指定別人', () => {
    const g = make()
    g.state.actors.pc!.ext.profile = { look: { hair: ['長髮', '黑色'], eyes: '琥珀' } }
    expect(test(g, { kind: 'look', field: 'hair', value: '長髮' })).toBe(true)
    expect(test(g, { kind: 'look', field: 'hair', value: '短髮' })).toBe(false)
    expect(test(g, { kind: 'look', field: 'eyes', value: '琥珀' })).toBe(true)
    expect(test(g, { kind: 'look', field: 'eyes', value: '藍' })).toBe(false)
    expect(test(g, { kind: 'look', field: 'skin', value: '白' })).toBe(false)
    expect(test(g, { kind: 'look', field: 'hair', value: '長髮', who: 'npc_nobody' })).toBe(false)
    // 沒有 who 時看這一次條件問的那個人（actor）
    g.commit(draft(actorOf(g.k, g.state, 'npc_ann')))
    expect(test(g, { kind: 'look', field: 'hair', value: '長髮' }, 'npc_ann')).toBe(false)
    g.state.actors.npc_ann!.ext.profile = { look: { hair: ['紅髮'] } }
    expect(test(g, { kind: 'look', field: 'hair', value: '紅髮' }, 'npc_ann')).toBe(true)
    expect(test(g, { kind: 'look', field: 'hair', value: '紅髮', who: 'npc_ann' })).toBe(true)
    expect(test(g, { kind: 'look', field: 'hair', value: '長髮', who: 'npc_ann' })).toBe(false)
  })

  it('具名人（還不是角色）讀他自己的 look（用 npcs.patch 寫）；格式：field 與 value 都要有', () => {
    const g = make()
    g.commit(draft([{ op: 'npcs.patch', npc: 'npc_bob', patch: { look: { hair: '禿頭' } } }]))
    expect(test(g, { kind: 'look', field: 'hair', value: '禿頭', who: 'npc_bob' })).toBe(true)
    expect(test(g, { kind: 'look', field: 'hair', value: '長髮', who: 'npc_bob' })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'look', field: 'hair' } as never, 'c').join()).toContain('value')
    expect(g.k.conditions.validate({ kind: 'look', value: 'x' } as never, 'c').join()).toContain('field')
    expect(g.k.conditions.validate({ kind: 'look', field: 'hair', value: 'x', who: 3 } as never, 'c').join()).toContain('who')
    expect(g.k.conditions.validate({ kind: 'look', field: 'hair', value: 'x' } as never, 'c')).toEqual([])
  })
})
