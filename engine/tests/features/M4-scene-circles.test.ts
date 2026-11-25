// 驗收測試：dev/work/M4-scene-circles.md（cpp-feature）。規格：LEWD_SYSTEM 3.5 節第二、三、四、五、六、七、八點；NIGHT_LESSONS「體位一覽」（三人與四人的列當格式的例子）；
// DATA 3.2 節、第 4 節 adult_scene 的 circles；AI_TASKS 3.6 節（一回合的順序）；dev/adr/0019 第九節與 P33～P37。
// 內容一律用測試自帶的最小假資料：兩個兩人體位、兩個三人體位（一人在中間）、一個四人體位、四個假對象（安、波、西、迪）。
//
// 數字的約定（和 M4-scene-seats 一樣）：主角敏感度 50、馴化 10；安敏感度 100、馴化 30（開場主動權 55）；波敏感度 60、馴化 70（65）；
// 西敏感度 40、馴化 20（53）；迪敏感度 50、馴化 10（50）。感載上限 35、餘韻上限 3、行動點上限 4。
// 三人體位 pos_tri：a（上位）、b（中間，倍率 1.5）、c（上位）；主角先來拿 a，其餘照座位的順序：第一個對象是 b、第二個是 c。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, Origin, Report } from '../../src'
import { ActionBlocked } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Dice, SceneEnv, SceneInput, SceneRaw } from '../../src/features/scene'
import { ruleProblems, sceneAct, sceneFeature, sceneNext, sceneOptions, sceneRawOf, sceneRules, sceneSkip, sceneView, startProblems } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假內容 ----

const abc = [{ id: 'a', upper: true }, { id: 'b', upper: false }, { id: 'c', upper: true }]
const POSITIONS = [
  {
    id: 'pos_face', name: '面對面', people: 2, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }], mult: { a: 1, b: 1.5 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'hand_l'], to: ['b', 'back'] }],
  },
  {
    id: 'pos_behind', name: '從後面', people: 2, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }], mult: { a: 1, b: 1.25 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }],
  },
  // 夾在中間：b 在中間；a 與 c 對 b 都是上位
  {
    id: 'pos_tri', name: '夾在中間', people: 3, roles: abc, mult: { a: 1, b: 1.5, c: 1 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [
      { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['c', 'chest'] }, { from: ['a', 'mouth'], to: ['c', 'mouth'] },
      { from: ['c', 'hand_l'], to: ['b', 'back'] }, { from: ['c', 'front'], to: ['b', 'front'] }, { from: ['b', 'hand_r'], to: ['c', 'front'] }, { from: ['b', 'hand_l'], to: ['a', 'front'] },
    ],
  },
  // 另一個三人體位：位置各自有每回合的主動權（x +5、y −2、z 沒寫就是 0）
  {
    id: 'pos_tri2', name: '三人並坐', people: 3, roles: [{ id: 'x', upper: true }, { id: 'y', upper: false }, { id: 'z', upper: false }], mult: { x: 1, y: 1, z: 1 }, drift: { x: 5, y: -2 }, tags: [], unlocked_by: null,
    links: [{ from: ['x', 'hand_l'], to: ['y', 'chest'] }, { from: ['x', 'mouth'], to: ['z', 'mouth'] }, { from: ['y', 'hand_r'], to: ['z', 'front'] }],
  },
  // 四人：a 上位、b 在中間
  {
    id: 'pos_quad', name: '四人圍坐', people: 4, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }, { id: 'c', upper: false }, { id: 'd', upper: false }], mult: { a: 1, b: 1.5, c: 1, d: 1 },
    initiative_drift: 3, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['c', 'mouth'] }, { from: ['a', 'hand_r'], to: ['d', 'chest'] }, { from: ['b', 'hand_r'], to: ['c', 'front'] }, { from: ['c', 'hand_l'], to: ['d', 'back'] }],
  },
]
const skill = (id: string, name: string, scene: Record<string, unknown>) => ({ id, name, scene })
const PACK = (positions: string[]): ContentPack => ({
  id: 'circles_test',
  content: {
    night_skill: [
      skill('nt_a', '搭手', { ap: 1, my_part: ['hand_l', 'hand_r'], their_part: ['chest', 'back'], on_use: { fit: 1 }, link: {} }),
      skill('nt_b', '貼近', { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { fit: 1 }, link: {} }),
      skill('nt_hit', '用力一按', { ap: 1, my_part: ['hand_r'], their_part: ['chest'], on_use: { their_load: '1d6' }, link: {} }),
      skill('nt_reach', '伸手過去', { ap: 1, my_part: ['hand_r'], their_part: ['front'], on_use: { their_load: '2d6', fit: 3 }, link: { their_load: '1d6' } }),
    ],
    position: POSITIONS.filter((p) => positions.includes(p.id)),
    item: [],
    tendency_tag: [{ id: 'tg_dom', name: '支配', axis: 'relation' }],
  },
})
const ALL = POSITIONS.map((p) => p.id)

const AFFINITY = testMeter({ kind: 'affinity', owner: 'test', name: '親密度', min: -100, max: 100, keyed: 'npc' })
const bridge = (sensitivity: number, docility: number) => ({ sensitivity, tolerance: 30, craving: 30, docility })
const PEOPLE: Record<string, { name: string; sens: number; doc: number; skills: string[] }> = {
  npc_ann: { name: '安', sens: 100, doc: 30, skills: ['nt_reach'] },
  npc_bo: { name: '波', sens: 60, doc: 70, skills: [] },
  npc_cy: { name: '西', sens: 40, doc: 20, skills: [] },
  npc_di: { name: '迪', sens: 50, doc: 10, skills: [] },
}

type Game = ReturnType<typeof makeGame>['game']

interface Opts {
  /** 這一局的體位（預設全部） */
  positions?: string[]
  /** 某個人的額外設定 */
  tweak?: Record<string, ActorOverrides>
  /** 資料的規則表蓋掉內建的 */
  rules?: Record<string, unknown>
  features?: Feature[]
  seed?: number
  /** 對象裡有人帶傾向標籤（有共同標籤的圈契合多加） */
  tags?: Record<string, string[]>
}

function game(o: Opts = {}): Game {
  const npcs = Object.entries(PEOPLE).map(([id, d]) =>
    makeActor({
      id, name: d.name, role: 'npc', ...o.tweak?.[id],
      ext: {
        bridge: bridge(d.sens, d.doc), scene: { skills: d.skills, positions: [] },
        ...(o.tags?.[id] ? { tendency: { axes: {}, points: {}, tags: Object.fromEntries(o.tags[id]!.map((t) => [t, 'has'])) } } : {}),
        ...(o.tweak?.[id]?.ext ?? {}),
      },
    }))
  return makeGame({
    seed: o.seed,
    features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, ...(o.features ?? [])],
    content: [PACK(o.positions ?? ALL), METER_CONTENT, ...(o.rules ? [{ id: 'rules', content: { scene_rule: [{ id: 'default', ...o.rules }] } } as ContentPack] : [])],
    pc: { ext: { bridge: bridge(50, 10), scene: { skills: ['nt_a', 'nt_b', 'nt_hit', 'nt_reach'], positions: [] } }, ...o.tweak?.pc },
    actors: npcs,
  }).game
}

/** 一串固定的骰面：每一顆都要落在範圍內，用完丟錯（多一顆少一顆都抓得到）。 */
function dice(...values: number[]): Dice {
  const q = [...values]
  return {
    int(min, max) {
      if (q.length === 0) throw new Error('骰面用完了')
      const v = q.shift()!
      if (v < min || v > max) throw new Error(`骰面 ${v} 不在 ${min}～${max}`)
      return v
    },
  }
}

const setup = (people: string[], extra: Record<string, unknown> = {}) => ({ with: people, nature: 'mutual' as const, mode: 'full' as const, ...extra })
const begin = (g: Game, s: Record<string, unknown>, origin: Origin = { by: 'test' }) => g.launch('scene', s, origin)
const raw = (g: Game): SceneRaw => sceneRawOf(g.state)!
const act = (g: Game, input: SceneInput, env: SceneEnv = {}) => g.commit(sceneAct(g.k, g.state, input, env))
const next = (g: Game, env: SceneEnv = {}) => g.commit(sceneNext(g.k, g.state, env))
const blocked = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionBlocked) return e.reason
    throw e
  }
  throw new Error('應該被擋下')
}
const seatOf = (g: Game, id: string) => raw(g).seats.find((x) => x.id === id)!
const linksOf = (g: Game, id: string) => raw(g).links.filter((l) => l.by === id || l.to === id)
/** 受到的感載：原始值 × (0.75 + 敏感度 ÷ 200) × 體位倍率，四捨五入。 */
const hit = (rawLoad: number, sens: number, pos: number): number => Math.round(rawLoad * (0.75 + sens / 200) * pos)
const parts = (my_part: string, their_part: string) => ({ my_part, their_part })
const beatsOf = (r: Report, tag: string) => r.timeline.filter((b) => b.tag === tag)
/** 三人一圈：主角、安、波（開場的主動權 55、65），用完整版 */
const trio = (o: Opts = {}, extra: Record<string, unknown> = {}): Game => {
  const g = game(o)
  begin(g, setup(['npc_ann', 'npc_bo'], extra))
  return g
}
/** 讓某個人這一輪不做事（行動點 0） */
const idle = (g: Game, ...ids: string[]): void => {
  for (const id of ids) seatOf(g, id).ap = 0
}

// ======================================================================
describe('開場：三人一圈、分圈', () => {
  it('三個人的一圈開得起來：pairs 有兩份、各自的主動權照各自的馴化算；位置照順序分；kind 是 group', () => {
    const g = trio()
    const s = raw(g)
    expect(s).toMatchObject({ v: 2, kind: 'group', layer: 'meat', mode: 'full', position: 'pos_tri', circles: [] })
    expect(s.seats.map((x) => x.id)).toEqual(['pc', 'npc_ann', 'npc_bo'])
    expect(s.pairs).toEqual({ npc_ann: { fit: 20, init: 55, first: true }, npc_bo: { fit: 20, init: 65, first: true } })
    expect(s.roles).toEqual({ pc: 'a', npc_ann: 'b', npc_bo: 'c' })
    expect(s.seats.every((x) => x.ap === 4)).toBe(true)
  })

  it('沒有三人體位的資料時開不起來並有原因；有三人體位但不是每個人都會也一樣', () => {
    const g = game({ positions: ['pos_face', 'pos_behind'] })
    const why = startProblems(g.k, g.state, setup(['npc_ann', 'npc_bo'])).problems.join('')
    expect(why).toMatch(/沒有這 3 個人都會的 3 人體位/)
    expect(() => begin(g, setup(['npc_ann', 'npc_bo']))).toThrow(/3 人體位/)
    // 三人的體位要靠技能開放，沒有人會
    const h = game()
    const locked = { ...(h.k.content.get('position', 'pos_tri') as Record<string, unknown>) }
    expect(locked).toBeTruthy()
    const g2 = game({ positions: ['pos_face', 'pos_quad'] })
    expect(startProblems(g2.k, g2.state, setup(['npc_ann', 'npc_bo'])).problems.join('')).toMatch(/3 人體位/)
    // 兩個人照舊開得起來
    expect(startProblems(g2.k, g2.state, setup(['npc_ann'])).problems).toEqual([])
  })

  it('start_position 寫了而且全圈都會就用它；四個人的一圈用四人體位', () => {
    const g = trio({}, { start_position: 'pos_tri2' })
    expect(raw(g).position).toBe('pos_tri2')
    expect(raw(g).roles).toEqual({ pc: 'x', npc_ann: 'y', npc_bo: 'z' })
    const h = game()
    begin(h, setup(['npc_ann', 'npc_bo', 'npc_cy']))
    expect(raw(h).position).toBe('pos_quad')
    expect(raw(h).roles).toEqual({ pc: 'a', npc_ann: 'b', npc_bo: 'c', npc_cy: 'd' })
    expect(Object.keys(raw(h).pairs)).toEqual(['npc_ann', 'npc_bo', 'npc_cy'])
  })

  it('circles：主角那一圈展開、別的圈收成不展開的圈（id c1、c2……；契合 20、每個人高潮 0 次）；主角不在任何一圈時第一圈就是主角的', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy'], ['npc_di']], nature: 'mutual', mode: 'full' })
    expect(raw(g).kind).toBe('group')
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(raw(g).circles).toEqual([
      { id: 'c1', people: ['npc_bo', 'npc_cy'], fit: 20, climax: { npc_bo: 0, npc_cy: 0 }, line: '' },
      { id: 'c2', people: ['npc_di'], fit: 20, climax: { npc_di: 0 }, line: '' },
    ])
    const h = game()
    begin(h, { circles: [['npc_ann'], ['npc_bo', 'npc_cy']], nature: 'mutual', mode: 'full' })
    expect(raw(h).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(raw(h).circles.map((c) => c.people)).toEqual([['npc_bo', 'npc_cy']])
    // 主角在第二圈：第二圈是主角這一圈
    const i = game()
    begin(i, { circles: [['npc_bo', 'npc_cy'], ['pc', 'npc_ann']], nature: 'mutual', mode: 'full' })
    expect(raw(i).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(raw(i).circles.map((c) => c.people)).toEqual([['npc_bo', 'npc_cy']])
  })

  it('開不成：一圈超過四個人、同一個人在兩圈、超過八個人、對象不在場、主角這一圈沒有別人', () => {
    const g = game()
    const why = (s: Record<string, unknown>): string => startProblems(g.k, g.state, { nature: 'mutual', mode: 'full', ...s }).problems.join('')
    expect(why({ with: ['npc_ann', 'npc_bo', 'npc_cy', 'npc_di'] })).toMatch(/一到三個對象/)
    expect(why({ circles: [['pc', 'npc_ann', 'npc_bo', 'npc_cy', 'npc_di']] })).toMatch(/一到三個對象/)
    expect(why({ circles: [['pc', 'npc_ann'], ['npc_ann', 'npc_bo']] })).toMatch(/同一個人只能在一圈裡/)
    expect(why({ with: ['npc_ann', 'npc_ann'] })).toMatch(/同一個人只能在一圈裡/)
    expect(why({ circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy', 'npc_di', 'x', 'y']] })).toMatch(/別的圈每圈要有一到四個人/)
    expect(why({ circles: [['pc', 'npc_ann'], ['npc_bo', 'ghost']] })).toMatch(/找不到對象（ghost）/)
    expect(why({ circles: [['pc']] })).toMatch(/一到三個對象/)
    const ids = Array.from({ length: 8 }, (_, i) => `x${i}`)
    expect(why({ circles: [['pc', 'npc_ann'], ids] })).toMatch(/別的圈每圈要有一到四個人/)
    expect(why({ circles: [['pc', 'npc_ann'], ids.slice(0, 4), ids.slice(4)] })).toMatch(/一場最多 8 個人/)
  })

  it('開場的摘要：多人時 with 是主角這一圈展開的人，circles 是不展開的圈；一對一沒有 circles 這個鍵', () => {
    const g = game()
    const r = startProblems(g.k, g.state, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    expect(r.problems).toEqual([])
    expect(r.summary).toMatchObject({ kind: 'group', mode: 'full', with: [{ id: 'npc_ann', name: '安' }, { id: 'npc_bo', name: '波' }], circles: [[{ id: 'npc_cy', name: '西' }, { id: 'npc_di', name: '迪' }]] })
    const one = startProblems(g.k, g.state, { with: ['npc_ann'], nature: 'mutual', mode: 'full' })
    expect(one.summary).toMatchObject({ kind: 'pair' })
    expect(one.summary).not.toHaveProperty('circles')
  })
})

// ======================================================================
describe('作用在誰身上：連著的每個人、少一顆骰', () => {
  it('主角用一個技能接上甲、再用另一個部位接上乙：主導對兩個人各生效一次，每個人的骰數少 1；只連著一個人時不少', () => {
    const g = trio()
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    act(g, { kind: 'skill', id: 'nt_b', target: 'npc_bo', pick: parts('mouth', 'mouth') })
    expect(raw(g).links.map((l) => [l.by, l.to, l.mine, l.theirs])).toEqual([['pc', 'npc_ann', 'hand_l', 'chest'], ['pc', 'npc_bo', 'mouth', 'mouth']])
    const fit0 = [raw(g).pairs.npc_ann!.fit, raw(g).pairs.npc_bo!.fit]
    // 主導：對方 2d6、自己 1d6，連著兩個人所以每個人是 1d6 與 1d6（最少 1 顆）：一共四顆，先安（3、4），再波（5、6）
    const [r] = act(g, { kind: 'dominate' }, { dice: dice(3, 4, 5, 6) })
    expect(r!.action).toBe('scene.act')
    expect(seatOf(g, 'npc_ann').received).toBe(hit(3, 100, 1.5))
    expect(seatOf(g, 'npc_bo').received).toBe(hit(5, 60, 1))
    expect(seatOf(g, 'pc').received).toBe(hit(4, 50, 1) + hit(6, 50, 1))
    // 契合 +2 與主動權 +10 對每個人各一次
    expect(raw(g).pairs.npc_ann!.fit).toBe(fit0[0]! + 2)
    expect(raw(g).pairs.npc_bo!.fit).toBe(fit0[1]! + 2)
    expect(raw(g).pairs.npc_ann!.init).toBe(65)
    expect(raw(g).pairs.npc_bo!.init).toBe(75)
    const line = beatsOf(r!, 'dominate')[0]!
    expect(Object.keys((line.data as { targets: Record<string, unknown> }).targets)).toEqual(['npc_ann', 'npc_bo'])
    // 兩點行動點用完：回合交給第一個還在的別人
    expect(raw(g).turn).toBe('npc_ann')

    // 只連著一個人：照舊 2d6 與 1d6，一共三顆
    const h = trio()
    act(h, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    act(h, { kind: 'dominate' }, { dice: dice(1, 2, 3) })
    expect(seatOf(h, 'npc_ann').received).toBe(hit(3, 100, 1.5))
    expect(seatOf(h, 'pc').received).toBe(hit(3, 50, 1))
    expect(raw(h).pairs.npc_bo!.fit).toBe(20)
  })

  it('挑逗、迎合一樣：連著兩個人時每個人的骰數少 1；給 target 只作用在那一個人（骰數不少）；target 沒有連著被擋', () => {
    const g = trio()
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    act(g, { kind: 'skill', id: 'nt_b', target: 'npc_bo', pick: parts('mouth', 'mouth') })
    // 迎合：對方 1d6、自己 2d6 → 每個人 1d6、1d6
    // 只迎合波：一個對象，照舊 1d6 與 2d6
    const before = seatOf(g, 'npc_ann').received
    act(g, { kind: 'yield', target: 'npc_bo' }, { dice: dice(2, 3, 4) })
    expect(seatOf(g, 'npc_ann').received).toBe(before)
    expect(seatOf(g, 'npc_bo').received).toBe(hit(2, 60, 1))
    const h = trio()
    expect(blocked(() => act(h, { kind: 'tease' }))).toMatch(/還沒有連接/)
    act(h, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    expect(blocked(() => act(h, { kind: 'tease', target: 'npc_bo' }))).toMatch(/和波還沒有連接/)
  })

  it('技能、道具、說話：好幾個人的完整版要給 target；給了不在這一圈的人被擋；沒給時 sceneOptions 的預覽照預設的對象', () => {
    const g = trio()
    expect(blocked(() => act(g, { kind: 'talk', pick: parts('mouth', 'mouth') }))).toMatch(/要選對象/)
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_a', pick: parts('hand_l', 'chest') }))).toMatch(/要選對象/)
    expect(blocked(() => act(g, { kind: 'talk', target: 'npc_cy', pick: parts('mouth', 'mouth') }))).toBe('這一圈裡沒有這個人。')
    expect(blocked(() => act(g, { kind: 'talk', target: 'pc', pick: parts('mouth', 'mouth') }))).toBe('這一圈裡沒有這個人。')
    const o = sceneOptions(g.k, g.state)!
    expect(o.targets).toEqual([{ id: 'npc_ann', name: '安' }, { id: 'npc_bo', name: '波' }])
    // 問「能不能」的時候不缺對象
    expect(o.actions.find((a) => a.id === 'talk')!.blocks).toEqual([])
    // 說話給對象：連接建在那個人身上
    act(g, { kind: 'talk', target: 'npc_bo', pick: parts('mouth', 'mouth') }, { dice: dice(20) })
    expect(raw(g).links.map((l) => [l.kind, l.by, l.to])).toEqual([['talk', 'pc', 'npc_bo']])
    // 契合只記主角對那個人：波的那一份變了，安的沒有
    expect(raw(g).pairs.npc_bo!.fit).toBeGreaterThan(20)
    expect(raw(g).pairs.npc_ann!.fit).toBe(20)
  })

  it('同一個部位接另一個人會把原本那條中斷（一個部位同時只能有一條）', () => {
    const g = trio()
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_r', 'chest') })
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_bo', pick: parts('hand_r', 'chest') })
    expect(raw(g).links.map((l) => [l.mine, l.to])).toEqual([['hand_r', 'npc_bo']])
  })
})

// ======================================================================
describe('別人對別人：只算感載與高潮，不算契合與主動權（P33）', () => {
  it('甲對乙的行動（env.moves 指定）：乙的感載加了、主角對甲與對乙的契合與主動權都沒變', () => {
    const g = trio()
    act(g, { kind: 'end_turn' })
    expect(raw(g).turn).toBe('npc_ann')
    idle(g, 'npc_bo')
    seatOf(g, 'npc_ann').ap = 1
    const before = structuredClone(raw(g).pairs)
    // 安（b）的右手伸向波（c）的前：on_use 2d6（3、4），連接每回合 1d6（5）：一共三顆，多一顆少一顆都會錯
    const [r] = next(g, { dice: dice(3, 4, 5), moves: { npc_ann: [{ kind: 'skill', id: 'nt_reach', target: 'npc_bo' }] } })
    expect(r!.action).toBe('scene.next')
    expect(seatOf(g, 'npc_bo').received).toBe(hit(7, 60, 1) + hit(5, 60, 1))
    expect(raw(g).links.map((l) => [l.by, l.to, l.mine, l.theirs])).toEqual([['npc_ann', 'npc_bo', 'hand_r', 'front']])
    // 主角對安與對波的契合、主動權：安對波的行動沒有碰它們（只有體位的上位推主動權）
    expect(raw(g).pairs.npc_ann!.fit).toBe(before.npc_ann!.fit)
    expect(raw(g).pairs.npc_bo!.fit).toBe(before.npc_bo!.fit)
    // 主動權只有體位的上位推：主角（a）+3 對每個人，波（c）也是上位：主角對波的那一份 −3
    expect(raw(g).pairs.npc_ann!.init).toBe(before.npc_ann!.init + 3)
    expect(raw(g).pairs.npc_bo!.init).toBe(before.npc_bo!.init)
    // 一整輪走完：新的一回合、輪到主角
    expect(raw(g).round).toBe(2)
    expect(raw(g).turn).toBe('pc')
  })

  it('NPC 沒給 target：技能寫的部位接得上的人裡挑契合最低的（安的「伸手過去」只接得到波，不接主角）', () => {
    const g = trio()
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_bo')
    seatOf(g, 'npc_ann').ap = 1
    next(g)
    expect(raw(g).links.map((l) => [l.by, l.to, l.source])).toEqual([['npc_ann', 'npc_bo', 'nt_reach']])
  })

  it('一輪裡由程式控制的每個人照座位的順序各走完自己的回合：安先、波後；後一個人看得到前一個人的結果', () => {
    const g = trio()
    act(g, { kind: 'end_turn' })
    const [r] = next(g)
    const acts = ['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear']
    const who = r!.timeline.filter((b) => b.actor && b.actor !== 'pc' && acts.includes(b.tag ?? '')).map((b) => b.actor)
    expect(who.length).toBeGreaterThan(0)
    expect(who.indexOf('npc_bo')).toBeGreaterThan(who.lastIndexOf('npc_ann'))
    expect(beatsOf(r!, 'round')).toHaveLength(1)
    expect(raw(g).round).toBe(2)
    // 每個人都在自己的行動點範圍內做事
    for (const s of raw(g).seats) expect(s.ap).toBeLessThanOrEqual(4)
  })
})

// ======================================================================
describe('體位由誰決定（P34）', () => {
  it('主角對甲 60、對乙 40：主角切換體位被擋並有原因；乙可以換；都 50 以上時主角可以', () => {
    const g = trio()
    raw(g).pairs.npc_ann!.init = 60
    raw(g).pairs.npc_bo!.init = 40
    const why = blocked(() => act(g, { kind: 'switch', position: 'pos_tri2' }))
    expect(why).toMatch(/主動權不在你手上/)
    expect(why).toMatch(/波/)
    // 乙（波）在自己的回合換：只有他的行動點 1，換完就沒了
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann')
    seatOf(g, 'npc_bo').ap = 1
    const [r] = next(g, { moves: { npc_bo: [{ kind: 'switch', position: 'pos_tri2' }] } })
    expect(beatsOf(r!, 'switch')).toHaveLength(1)
    expect(raw(g).position).toBe('pos_tri2')
    // 決定的人拿上位：波是 x，其餘照座位的順序
    expect(raw(g).roles).toEqual({ npc_bo: 'x', pc: 'y', npc_ann: 'z' })

    // 都在 50 以上：主角可以；連接全部重置、花 1 點行動點
    const h = trio()
    raw(h).pairs.npc_ann!.init = 60
    raw(h).pairs.npc_bo!.init = 50
    act(h, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    const ap = seatOf(h, 'pc').ap
    act(h, { kind: 'switch', position: 'pos_tri2' })
    expect(raw(h).position).toBe('pos_tri2')
    expect(raw(h).links).toEqual([])
    expect(seatOf(h, 'pc').ap).toBe(ap - 1)
    expect(raw(h).roles).toEqual({ pc: 'x', npc_ann: 'y', npc_bo: 'z' })
  })

  it('換體位要換成這一圈人數的體位：兩人的體位在三人的一圈換不進去', () => {
    const g = trio()
    expect(blocked(() => act(g, { kind: 'switch', position: 'pos_face' }))).toMatch(/要 2 個人，這一圈現在是 3 個人/)
    const o = sceneView(g.k, g.state)!
    expect(o.positions.map((x) => x.id)).toEqual(['pos_tri', 'pos_tri2'])
    expect(o.decider).toBe('pc')
  })

  it('位置每回合的主動權：drift 寫了的照它（x +5、y −2）、沒寫的位置是 0；沒寫 drift 的上位照 initiative_drift', () => {
    const g = trio({}, { start_position: 'pos_tri2' })
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann', 'npc_bo')
    next(g)
    // 主角（x）+5 對每個人；安（y）−2：主角對安的主動權再 +2；波（z）0
    expect(raw(g).pairs.npc_ann!.init).toBe(55 + 5 + 2)
    expect(raw(g).pairs.npc_bo!.init).toBe(65 + 5)
    const h = trio()
    act(h, { kind: 'end_turn' })
    idle(h, 'npc_ann', 'npc_bo')
    next(h)
    // pos_tri：a（主角）與 c（波）是上位，各 +3：主角對每個人 +3；波的 +3 是他那一邊：主角對波的主動權 −3
    expect(raw(h).pairs.npc_ann!.init).toBe(55 + 3)
    expect(raw(h).pairs.npc_bo!.init).toBe(65 + 3 - 3)
  })
})

// ======================================================================
describe('失神：退出、連接斷掉、人數對不上時自動換體位（工單第 6 點）', () => {
  it('乙失神：乙的連接沒了、場景繼續、體位換成兩人的；甲也失神之後場景結束；主角失神照舊結束整場', () => {
    const g = trio()
    act(g, { kind: 'skill', id: 'nt_b', target: 'npc_bo', pick: parts('mouth', 'mouth') })
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    expect(raw(g).links).toHaveLength(2)
    // 波只差一點就高潮、餘韻已滿：這一按讓他失神
    g.state.actors.npc_bo!.load = 34
    g.state.actors.npc_bo!.afterglow = 3
    const [r] = act(g, { kind: 'skill', id: 'nt_hit', target: 'npc_bo', pick: parts('hand_r', 'chest') }, { dice: dice(6) })
    expect(r!.action).toBe('scene.act')
    expect(beatsOf(r!, 'out')).toHaveLength(1)
    const s = raw(g)
    expect(seatOf(g, 'npc_bo').out).toBe(true)
    expect(linksOf(g, 'npc_bo')).toEqual([])
    expect(s.links).toEqual([])
    expect(s.position).toBe('pos_face')
    expect(s.roles).toEqual({ pc: 'a', npc_ann: 'b' })
    expect(s.seats.map((x) => x.id)).toEqual(['pc', 'npc_ann', 'npc_bo'])
    // 剩下的兩個人繼續：兩人的連接照兩人的規則
    seatOf(g, 'pc').ap = 4
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    expect(raw(g).links.map((l) => l.to)).toEqual(['npc_ann'])
    // 安也失神：這一圈沒有別人了、也沒有別的圈可去：場景結束
    g.state.actors.npc_ann!.load = 34
    g.state.actors.npc_ann!.afterglow = 3
    const rs = act(g, { kind: 'skill', id: 'nt_hit', target: 'npc_ann', pick: parts('hand_r', 'chest') }, { dice: dice(6) })
    expect(rs[0]!.action).toBe('scene.end')
    expect(rs[0]!.outcome.result).toBe('partner_out')
    expect(sceneRawOf(g.state)).toBeNull()

    // 主角失神：不管圈裡還有誰都結束整場
    const h = trio()
    act(h, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    h.state.actors.pc!.load = 34
    h.state.actors.pc!.afterglow = 3
    const hs = act(h, { kind: 'dominate' }, { dice: dice(1, 1, 6) })
    expect(hs[0]!.action).toBe('scene.end')
    expect(sceneRawOf(h.state)).toBeNull()
  })

  it('四個人的一圈有人失神：換成三人的體位；失神的人這一輪不再行動', () => {
    const g = game()
    begin(g, setup(['npc_ann', 'npc_bo', 'npc_cy']))
    expect(raw(g).position).toBe('pos_quad')
    g.state.actors.npc_cy!.load = 34
    g.state.actors.npc_cy!.afterglow = 3
    act(g, { kind: 'skill', id: 'nt_hit', target: 'npc_cy', pick: parts('hand_r', 'chest') }, { dice: dice(6) })
    // pos_quad 的 a.hand_r 接 d（西）的胸
    expect(raw(g).seats.map((x) => !!x.out)).toEqual([false, false, false, true])
    expect(raw(g).position).toBe('pos_tri')
    expect(raw(g).roles).toEqual({ pc: 'a', npc_ann: 'b', npc_bo: 'c' })
  })

  it('這一圈只剩主角一個人、但有別的圈可以去：場景繼續（結束回合直接做結算）；沒有別的圈就結束', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo']], nature: 'mutual', mode: 'full' })
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    g.state.actors.npc_ann!.load = 34
    g.state.actors.npc_ann!.afterglow = 3
    const [r] = act(g, { kind: 'skill', id: 'nt_hit', target: 'npc_ann', pick: parts('hand_r', 'chest') }, { dice: dice(6) })
    expect(r!.action).toBe('scene.act')
    expect(sceneRawOf(g.state)).not.toBeNull()
    expect(raw(g).roles).toEqual({ pc: 'a' })
    // 沒有人可以做事：只剩換圈、叫人、結束回合、停下
    expect(blocked(() => act(g, { kind: 'dominate' }))).toMatch(/還沒有連接/)
    const round = raw(g).round
    const [e] = act(g, { kind: 'end_turn' })
    expect(e!.action).toBe('scene.act')
    expect(raw(g).round).toBe(round + 1)
    expect(raw(g).turn).toBe('pc')
    // 去波那一圈
    act(g, { kind: 'move_circle', circle: 'c1' })
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_bo'])
    expect(raw(g).circles.map((c) => [c.people, c.out])).toEqual([[[], ['npc_ann']]])
  })

  it('「對方不玩了」：和這一圈每個人的契合都在門檻以下、而且過了三回合；有一個人在門檻以上就不算', () => {
    const quit = (fits: [number, number]): ReturnType<typeof next> => {
      const g = trio()
      raw(g).round = 3
      raw(g).pairs.npc_ann!.fit = fits[0]
      raw(g).pairs.npc_bo!.fit = fits[1]
      act(g, { kind: 'end_turn' })
      idle(g, 'npc_ann', 'npc_bo')
      return next(g)
    }
    const a = quit([10, 5])
    expect(a[0]!.action).toBe('scene.end')
    expect(a[0]!.outcome.result).toBe('partner_quit')
    const b = quit([10, 30])
    expect(b[0]!.action).toBe('scene.next')
  })
})

// ======================================================================
describe('分圈：別的圈每回合一行字（P35）、換圈（P36）、叫人過來', () => {
  it('兩圈（主角加甲；乙加丙）：每回合乙丙那一圈的契合與感載有變、有一行字、高潮照算', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy']], nature: 'mutual', mode: 'full' })
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann')
    // 契合 +1d6（4）；波 2d6（3、5）、西 2d6（2、6）
    const [r] = next(g, { dice: dice(4, 3, 5, 2, 6) })
    const c = raw(g).circles[0]!
    expect(c.fit).toBe(24)
    expect(c.line).toBe('波和西那一邊還在慢慢熟悉。')
    expect(beatsOf(r!, 'circle').map((b) => b.text)).toEqual(['波和西那一邊還在慢慢熟悉。'])
    expect(g.state.actors.npc_bo!.load).toBe(hit(8, 60, 1))
    expect(g.state.actors.npc_cy!.load).toBe(hit(8, 40, 1))
    // 契合到 30、60 之後的說法
    raw(g).circles[0]!.fit = 40
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann')
    next(g, { dice: dice(1, 1, 1, 1, 1) })
    expect(raw(g).circles[0]!.line).toBe('波和西那一邊越來越熱絡。')
    raw(g).circles[0]!.fit = 70
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann')
    next(g, { dice: dice(1, 1, 1, 1, 1) })
    expect(raw(g).circles[0]!.line).toBe('波和西那一邊已經難分難捨。')
  })

  it('別的圈：圈裡的人有共同的標籤契合再 +2；高潮疊餘韻、疊滿之後又高潮就失神退出；一個人的圈沒有字', () => {
    const g = game({ tags: { npc_bo: ['tg_dom'], npc_cy: ['tg_dom'] } })
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy'], ['npc_di']], nature: 'mutual', mode: 'full' })
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann')
    // 波的感載差一點滿、餘韻 1：這一輪高潮一次（餘韻 2、次數 1）；西不動
    g.state.actors.npc_bo!.load = 34
    g.state.actors.npc_bo!.afterglow = 1
    next(g, { dice: dice(5, 6, 6, 1, 1) })
    const c = raw(g).circles[0]!
    expect(c.fit).toBe(20 + 5 + 2)
    expect(c.climax).toEqual({ npc_bo: 1, npc_cy: 0 })
    expect(g.state.actors.npc_bo!.afterglow).toBe(2)
    expect(raw(g).circles[1]!.line).toBe('')
    // 餘韻已滿又高潮：失神退出
    g.state.actors.npc_bo!.load = 34
    g.state.actors.npc_bo!.afterglow = 3
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_ann')
    next(g, { dice: dice(1, 6, 6, 1, 1) })
    const d = raw(g).circles[0]!
    expect(d.people).toEqual(['npc_cy'])
    expect(d.out).toEqual(['npc_bo'])
    expect(d.line).toBe('')
  })

  it('換圈花 2 行動點、連接全部重置、原本的甲變成不展開的圈（契合取他們對主角契合的平均）；乙丙展開、主角對他們從 20 起', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy']], nature: 'mutual', mode: 'full' })
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    expect(raw(g).links).toHaveLength(1)
    const ap = seatOf(g, 'pc').ap
    const [r] = act(g, { kind: 'move_circle', circle: 'c1' })
    expect(r!.action).toBe('scene.act')
    expect(seatOf(g, 'pc').ap).toBe(ap - 2)
    const s = raw(g)
    expect(s.links).toEqual([])
    expect(s.seats.map((x) => x.id)).toEqual(['pc', 'npc_bo', 'npc_cy'])
    expect(s.circles).toEqual([{ id: 'c2', people: ['npc_ann'], fit: 21, climax: { npc_ann: 0 }, line: '' }])
    expect(s.position).toBe('pos_tri')
    expect(s.pairs.npc_bo).toEqual({ fit: 20, init: 65, first: true })
    expect(s.pairs.npc_cy).toEqual({ fit: 20, init: 53, first: true })
    // 安那一對的紀錄還在（結算用），現在不在這一圈
    expect(s.pairs.npc_ann!.fit).toBe(21)
    expect(sceneView(g.k, g.state)!.away).toEqual(['npc_ann'])
    // 換回去：安從 20 起
    seatOf(g, 'pc').ap = 4
    act(g, { kind: 'move_circle', circle: 'c2' })
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(raw(g).pairs.npc_ann).toEqual({ fit: 20, init: 55, first: true })
    expect(raw(g).circles.map((c) => c.people)).toEqual([['npc_bo', 'npc_cy']])
  })

  it('換圈的條件：行動點不夠、沒有這一圈、那一圈加上主角超過四個人、沒有共同的體位、精簡版都有原因', () => {
    const g = game()
    // 不在場的人：開不起來
    expect(startProblems(g.k, g.state, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy', 'npc_di', 'x1']], nature: 'mutual', mode: 'full' }).problems.join('')).toMatch(/x1/)
    const h = game()
    begin(h, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    expect(blocked(() => act(h, { kind: 'move_circle', circle: 'c9' }))).toMatch(/沒有這一圈/)
    // 三個人那一圈加主角正好四個人：換得過去
    seatOf(h, 'pc').ap = 1
    expect(blocked(() => act(h, { kind: 'move_circle', circle: 'c1' }))).toMatch(/行動點不夠/)
    seatOf(h, 'pc').ap = 4
    act(h, { kind: 'move_circle', circle: 'c1' })
    expect(raw(h).position).toBe('pos_quad')
    // 沒有三人體位的一局：換不過去
    const i = game({ positions: ['pos_face', 'pos_behind', 'pos_tri'] })
    begin(i, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    expect(blocked(() => act(i, { kind: 'move_circle', circle: 'c1' }))).toMatch(/沒有共同會的 4 人體位/)
    // 精簡版
    const j = game()
    begin(j, { circles: [['pc', 'npc_ann'], ['npc_bo']], nature: 'mutual', mode: 'simple' })
    expect(blocked(() => act(j, { kind: 'move_circle', circle: 'c1' }))).toMatch(/精簡版不分圈/)
    expect(blocked(() => act(j, { kind: 'call', who: 'npc_bo' }))).toMatch(/精簡版不分圈/)
  })

  it('把丙叫過來（主角對這一圈每個人的主動權都在 50 以上）直接成功：丙在主角這一圈、花 1 行動點、連接重置、體位換成三人的；第五個人進不來', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    act(g, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    const ap = seatOf(g, 'pc').ap
    act(g, { kind: 'call', who: 'npc_bo' })
    expect(seatOf(g, 'pc').ap).toBe(ap - 1)
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann', 'npc_bo'])
    expect(raw(g).circles[0]!.people).toEqual(['npc_cy', 'npc_di'])
    expect(raw(g).links).toEqual([])
    expect(raw(g).position).toBe('pos_tri')
    expect(raw(g).pairs.npc_bo).toEqual({ fit: 20, init: 65, first: true })
    // 第四個人：換成四人的體位
    act(g, { kind: 'call', who: 'npc_cy' })
    expect(raw(g).seats).toHaveLength(4)
    expect(raw(g).position).toBe('pos_quad')
    expect(raw(g).circles[0]!.people).toEqual(['npc_di'])
    // 第五個人：進不來
    expect(blocked(() => act(g, { kind: 'call', who: 'npc_di' }))).toMatch(/已經滿了/)
    expect(blocked(() => act(g, { kind: 'call', who: 'npc_ann' }))).toMatch(/別的圈裡沒有這個人/)
  })

  it('主動權不夠：擲一次說話的檢定（有 scene_talk 的結果就看它的 agree）；失敗了花行動點、沒有人過來；成功了就過來', () => {
    const mk = (): Game => {
      const g = game()
      begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo']], nature: 'mutual', mode: 'full' })
      raw(g).pairs.npc_ann!.init = 40
      return g
    }
    const g = mk()
    const ap = seatOf(g, 'pc').ap
    const [r] = act(g, { kind: 'call', who: 'npc_bo' }, { talk: { pc: { fit: 0, agree: false } } })
    expect(seatOf(g, 'pc').ap).toBe(ap - 1)
    expect(raw(g).seats).toHaveLength(2)
    expect(beatsOf(r!, 'call')[0]!.data).toMatchObject({ who: 'npc_bo', ok: false })
    act(g, { kind: 'call', who: 'npc_bo' }, { talk: { pc: { fit: 0, agree: true } } })
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann', 'npc_bo'])
    // 沒有 scene_talk 的結果：擲說話的檢定（自然 1 失敗、自然 20 成功）
    const h = mk()
    const [f] = act(h, { kind: 'call', who: 'npc_bo' }, { dice: dice(1) })
    expect(raw(h).seats).toHaveLength(2)
    expect(f!.timeline.some((b) => b.tag === 'call' && b.roll)).toBe(true)
    const i = mk()
    act(i, { kind: 'call', who: 'npc_bo' }, { dice: dice(20) })
    expect(raw(i).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann', 'npc_bo'])
  })

  it('NPC 不能換圈與叫人（env.moves 裡這樣寫會被丟掉）；輸入的格式要對', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy']], nature: 'mutual', mode: 'full' })
    act(g, { kind: 'end_turn' })
    idle(g, 'npc_bo')
    const [r] = next(g, { moves: { npc_ann: [{ kind: 'move_circle', circle: 'c1' }] } })
    expect(beatsOf(r!, 'scene.dropped')[0]!.data).toMatchObject({ actor: 'npc_ann', done: 0 })
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann', 'npc_bo'])
    expect(blocked(() => act(g, { kind: 'move_circle' } as unknown as SceneInput))).toMatch(/哪一圈/)
    expect(blocked(() => act(g, { kind: 'call' } as unknown as SceneInput))).toMatch(/叫誰/)
  })
})

// ======================================================================
describe('結算：每個對象各自評價、體悟只給一次、每個人的性經歷各記一筆', () => {
  it('result.pairs 每個對象一份、fit 是平均；親密度各自評價；體悟只給一次；每個人的性經歷次數各 +1、主角的對象人數 +2', () => {
    const heard: Array<{ result: Record<string, unknown> }> = []
    const hook: Feature = {
      id: 'caller',
      install: (k: Kernel) => {
        k.hooks.on('activity.end', 'caller', (p) => {
          if (p.kind === 'scene') heard.push({ result: p.result as Record<string, unknown> })
        })
      },
    }
    const g = game({ features: [hook] })
    begin(g, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    raw(g).pairs.npc_ann!.fit = 62
    raw(g).pairs.npc_bo!.fit = 10
    const rs = act(g, { kind: 'stop' })
    const report = rs[0]!
    expect(report.action).toBe('scene.end')
    // 平均 36：普通（體悟 10）；第一次和這個人 +5（兩個人都是第一次，只加一次）、第一次用夾在中間 +5
    expect(g.state.meters.insight!._).toBe(10 + 5 + 5)
    expect(report.changes.filter((c) => c.op === 'meter' && (c as { kind?: string }).kind === 'insight')).toHaveLength(1)
    // 每個對象各自的評價：安 62 合拍 +5、波 10 不合 −1
    expect(g.state.meters.affinity!.npc_ann).toBe(5)
    expect(g.state.meters.affinity!.npc_bo).toBe(-1)
    const res = heard[0]!.result
    expect(res).toMatchObject({ with: 'npc_ann', fit: 36, rating: '普通', reason: 'stop' })
    expect(res.pairs).toEqual({
      npc_ann: { fit: 62, rating: '合拍', rating_id: 'fit', affinity: 5 },
      npc_bo: { fit: 10, rating: '不合', rating_id: 'poor', affinity: -1 },
    })
    expect(res.circles).toEqual([{ id: 'c1', people: ['npc_cy', 'npc_di'], fit: 20, rating: '不合', climax: { npc_cy: 0, npc_di: 0 } }])
    const rec = (id: string) => g.state.actors[id]!.ext.sex_record as { times: number; partners: number; people: Record<string, number> }
    expect(rec('pc')).toMatchObject({ times: 1, partners: 2, people: { npc_ann: 1, npc_bo: 1 } })
    expect(rec('npc_ann')).toMatchObject({ times: 1, partners: 2, people: { pc: 1, npc_bo: 1 } })
    expect(rec('npc_bo')).toMatchObject({ times: 1, partners: 2, people: { pc: 1, npc_ann: 1 } })
    // 別的圈的人彼此也各記一筆
    expect(rec('npc_cy')).toMatchObject({ times: 1, partners: 1, people: { npc_di: 1 } })
    expect(rec('npc_di')).toMatchObject({ times: 1, partners: 1, people: { npc_cy: 1 } })
    expect(report.narration!.results).toEqual(expect.arrayContaining(['契合 36：普通。', '和安：契合 62，合拍。', '和波：契合 10，不合。']))
    // 感載歸零、場景拿掉
    expect(sceneRawOf(g.state)).toBeNull()
    for (const id of ['npc_ann', 'npc_bo', 'npc_cy', 'npc_di']) expect(g.state.actors[id]!.load).toBe(0)
  })

  it('換過圈之後離開的人也算對象：他們對主角的契合與評價、性經歷都在；一對一的結果沒有 pairs 與 circles 這兩個鍵', () => {
    const heard: Array<Record<string, unknown>> = []
    const hook: Feature = {
      id: 'caller',
      install: (k: Kernel) => {
        k.hooks.on('activity.end', 'caller', (p) => {
          if (p.kind === 'scene') heard.push(p.result as Record<string, unknown>)
        })
      },
    }
    const g = game({ features: [hook] })
    begin(g, { circles: [['pc', 'npc_ann'], ['npc_bo', 'npc_cy']], nature: 'mutual', mode: 'full' })
    raw(g).pairs.npc_ann!.fit = 50
    act(g, { kind: 'move_circle', circle: 'c1' })
    raw(g).pairs.npc_bo!.fit = 70
    raw(g).pairs.npc_cy!.fit = 90
    act(g, { kind: 'stop' })
    expect(heard[0]).toMatchObject({ with: 'npc_ann', fit: 70, rating: '合拍' })
    expect(Object.keys(heard[0]!.pairs as object)).toEqual(['npc_ann', 'npc_bo', 'npc_cy'])
    expect((heard[0]!.circles as Array<{ people: string[] }>).map((c) => c.people)).toEqual([['npc_ann']])
    const rec = g.state.actors.pc!.ext.sex_record as { partners: number; times: number }
    expect(rec).toMatchObject({ times: 1, partners: 3 })

    const h = game({ features: [hook] })
    begin(h, setup(['npc_ann'], { mode: 'full' }))
    act(h, { kind: 'stop' })
    expect(heard[1]).not.toHaveProperty('pairs')
    expect(heard[1]).not.toHaveProperty('circles')
  })

  it('略過：多人的場景照每一對的數值各算一次（每個對象與每一圈）', () => {
    const g = trio()
    // 略過沒有骰面：用導出的亂數；結果落在規則的範圍內
    const r = sceneRules(g.k).skip
    const rs = g.commit(sceneSkip(g.k, g.state))
    expect(rs[0]!.action).toBe('scene.end')
    expect(rs[0]!.outcome.result).toBe('skip')
    const pairs = (rs[0]!.timeline.find((b) => b.tag === 'scene.end')!.data as { pairs: Record<string, { fit: number }> }).pairs
    // 安的敏感度 100：+25；波 60：+5；亂數 0～20
    expect(pairs.npc_ann!.fit).toBeGreaterThanOrEqual(r.base + 25)
    expect(pairs.npc_ann!.fit).toBeLessThanOrEqual(r.base + 25 + r.spread - 1)
    expect(pairs.npc_bo!.fit).toBeGreaterThanOrEqual(r.base + 5)
    expect(pairs.npc_bo!.fit).toBeLessThanOrEqual(r.base + 5 + r.spread - 1)
  })
})

// ======================================================================
describe('精簡版（P37）：多人的設定只展開主角與第一圈的第一個人，其餘收成不展開的圈', () => {
  it('with 三個人：展開第一個、其餘兩個收成一圈；circles 多圈：主角這一圈剩下的人收成 c1、別的圈接在後面', () => {
    const g = game()
    begin(g, { with: ['npc_ann', 'npc_bo', 'npc_cy'], nature: 'mutual', mode: 'simple' })
    expect(raw(g)).toMatchObject({ kind: 'pair', mode: 'simple' })
    expect(raw(g).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(raw(g).circles.map((c) => [c.id, c.people])).toEqual([['c1', ['npc_bo', 'npc_cy']]])
    expect(raw(g).position).toBe('pos_face')
    expect(Object.keys(raw(g).pairs)).toEqual(['npc_ann'])

    const h = game()
    const sum = startProblems(h.k, h.state, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy', 'npc_di']], nature: 'mutual', mode: 'simple' }).summary!
    begin(h, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy', 'npc_di']], nature: 'mutual', mode: 'simple' })
    expect(raw(h).seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(raw(h).circles.map((c) => [c.id, c.people])).toEqual([['c1', ['npc_bo']], ['c2', ['npc_cy', 'npc_di']]])
    // 摘要：展開一個，另一個在不展開的圈
    expect(sum.kind).toBe('pair')
    expect(sum.with).toEqual([{ id: 'npc_ann', name: '安' }])
    expect(sum.circles).toEqual([[{ id: 'npc_bo', name: '波' }], [{ id: 'npc_cy', name: '西' }, { id: 'npc_di', name: '迪' }]])
    // 三人以上的體位不列（換不進去，也不出現在選項裡）
    const v = sceneView(h.k, h.state)!
    expect(v.positions.every((x) => ['pos_face', 'pos_behind'].includes(x.id))).toBe(true)
    expect(sceneOptions(h.k, h.state)!.actions.map((a) => a.id)).not.toContain('move_circle')
  })

  it('精簡版一對一仍是一次一步；旁邊的圈每回合照樣算一次、結算也帶進去；精簡版自動挑的部位照舊', () => {
    const g = game()
    begin(g, { with: ['npc_ann', 'npc_bo'], nature: 'mutual', mode: 'simple' })
    act(g, { kind: 'skill', id: 'nt_a' })
    expect(raw(g).links).toHaveLength(1)
    const pcAp = seatOf(g, 'pc').ap
    expect(pcAp).toBe(3)
    // 對方一步一步走到回合結束；旁邊只有波一個人：沒有字
    for (let i = 0; i < 12 && raw(g).turn !== 'pc' || (i < 12 && raw(g).round === 1); i++) {
      if (raw(g).turn === 'pc') act(g, { kind: 'end_turn' })
      else next(g)
    }
    expect(raw(g).round).toBeGreaterThan(1)
    expect(raw(g).circles[0]!.line).toBe('')
    const rs = act(g, { kind: 'stop' })
    const rec = (id: string) => g.state.actors[id]!.ext.sex_record as { times: number } | undefined
    expect(rec('pc')!.times).toBe(1)
    expect(rec('npc_ann')!.times).toBe(1)
    // 旁邊的圈只有一個人：沒有人和他一起，不記性經歷
    expect(rec('npc_bo')).toBeUndefined()
    expect(rs[0]!.action).toBe('scene.end')
  })
})

// ======================================================================
describe('規則與資料的格式', () => {
  it('scene_rule 多 cost.move_circle（2）、cost.call（1）、multi_dice_minus（1）、other_circle；資料可以蓋掉', () => {
    const g = game()
    expect(sceneRules(g.k)).toMatchObject({
      cost: { move_circle: 2, call: 1 }, multi_dice_minus: 1, other_circle: { fit_start: 20, fit_die: '1d6', tag_bonus: 2, load_die: '2d6' },
    })
    const h = game({ rules: { cost: { move_circle: 3 }, multi_dice_minus: 0, other_circle: { fit_die: '2d6', tag_bonus: 5 } } })
    expect(sceneRules(h.k)).toMatchObject({ cost: { move_circle: 3, call: 1 }, multi_dice_minus: 0, other_circle: { fit_start: 20, fit_die: '2d6', tag_bonus: 5, load_die: '2d6' } })
    begin(h, { circles: [['pc', 'npc_ann'], ['npc_bo']], nature: 'mutual', mode: 'full' })
    const ap = seatOf(h, 'pc').ap
    act(h, { kind: 'move_circle', circle: 'c1' })
    expect(seatOf(h, 'pc').ap).toBe(ap - 3)
    // multi_dice_minus 是 0：連著兩個人也不少骰
    const i = game({ rules: { multi_dice_minus: 0 } })
    begin(i, setup(['npc_ann', 'npc_bo']))
    act(i, { kind: 'skill', id: 'nt_a', target: 'npc_ann', pick: parts('hand_l', 'chest') })
    act(i, { kind: 'skill', id: 'nt_b', target: 'npc_bo', pick: parts('mouth', 'mouth') })
    act(i, { kind: 'dominate' }, { dice: dice(1, 2, 3, 1, 2, 3) })
    expect(seatOf(i, 'npc_ann').received).toBe(hit(3, 100, 1.5))
    expect(seatOf(i, 'npc_bo').received).toBe(hit(3, 60, 1))
  })

  it('規則的格式：骰要寫對、數字要是數字、沒有這個規則要說', () => {
    expect(ruleProblems({ id: 'default', other_circle: { fit_die: 'lots' } }).join('')).toMatch(/other_circle\.fit_die 要是骰/)
    expect(ruleProblems({ id: 'default', other_circle: { load_die: 0 } }).join('')).toMatch(/other_circle\.load_die/)
    expect(ruleProblems({ id: 'default', cost: { call: 'x' } }).join('')).toMatch(/cost\.call 要是數字/)
    expect(ruleProblems({ id: 'default', other_circle: { nothing: 1 } }).join('')).toMatch(/沒有這個規則/)
    expect(ruleProblems({ id: 'default', multi_dice_minus: 2, other_circle: { fit_die: '3d6' } })).toEqual([])
  })

  it('體位的格式：三、四人的位置數要和 people 一樣多；links 兩端是不同的位置；drift 的位置要查得到、值要是整數', () => {
    const base = POSITIONS.find((p) => p.id === 'pos_tri')!
    const check = (over: Record<string, unknown>): string => {
      try {
        makeGame({ features: [characterFeature, sceneFeature], content: [{ id: 'x', content: { position: [{ ...base, id: 'p_x', ...over }] } } as ContentPack] })
      } catch (e) {
        return String((e as { problems?: string[] }).problems?.join('\n') ?? e)
      }
      return ''
    }
    expect(check({})).toBe('')
    expect(check({ roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }] })).toMatch(/roles 要有三個位置/)
    expect(check({ people: 5 })).toMatch(/people 要是 2～4/)
    expect(check({ links: [{ from: ['a', 'mouth'], to: ['c', 'mouth'] }, { from: ['a', 'hand_l'], to: ['a', 'chest'] }] })).toMatch(/不同的位置/)
    expect(check({ links: [{ from: ['a', 'mouth'], to: ['z', 'mouth'] }] })).toMatch(/要是 roles 裡的 id/)
    expect(check({ mult: { a: 1, b: 1.5 } })).toMatch(/mult\.c/)
    expect(check({ drift: { a: 3, b: -1 } })).toBe('')
    expect(check({ drift: { a: 1.5 } })).toMatch(/drift\.a 要是整數/)
    expect(check({ drift: { q: 1 } })).toMatch(/drift\.q 要是 roles 裡的 id/)
    expect(check({ drift: [1] })).toMatch(/drift/)
  })
})

// ======================================================================
describe('畫面資料：sceneView 與 sceneOptions 的多人欄位', () => {
  it('seats 是三個人（含退出的、out 標記）、pairs 每個對象一份、decider、targets；有別的圈時多列「換圈」與「叫人過來」', () => {
    const g = game()
    begin(g, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    const v = sceneView(g.k, g.state)!
    expect(v.kind).toBe('group')
    expect(v.seats.map((x) => [x.id, x.out])).toEqual([['pc', false], ['npc_ann', false], ['npc_bo', false]])
    expect(Object.keys(v.pairs)).toEqual(['npc_ann', 'npc_bo'])
    expect(v.circles).toHaveLength(1)
    expect(v.decider).toBe('pc')
    expect(v.away).toEqual([])
    expect(v.seats[1]!.id).toBe('npc_ann')
    const o = sceneOptions(g.k, g.state)!
    expect(o.targets.map((t) => t.id)).toEqual(['npc_ann', 'npc_bo'])
    const move = o.actions.find((a) => a.id === 'move_circle')!
    expect(move.ap).toBe(2)
    expect(move.choices!.map((c) => [c.id, c.name, c.blocks])).toEqual([['c1', '西、迪', []]])
    const call = o.actions.find((a) => a.id === 'call')!
    expect(call.choices!.map((c) => [c.id, c.name])).toEqual([['npc_cy', '西'], ['npc_di', '迪']])
    // 沒有別的圈：不列
    const h = trio()
    expect(sceneOptions(h.k, h.state)!.actions.map((a) => a.id)).not.toContain('call')
  })
})

// ======================================================================
describe('整場跑得完：照規則自己走，每一步都不丟錯、感載在範圍內；同一個種子同樣的結果', () => {
  const play = (seed: number): { rounds: number; ended: string; log: string } => {
    const g = game({ seed })
    begin(g, { circles: [['pc', 'npc_ann', 'npc_bo'], ['npc_cy', 'npc_di']], nature: 'mutual', mode: 'full' })
    const log: string[] = []
    let ended = ''
    for (let i = 0; i < 400 && sceneRawOf(g.state); i++) {
      const s = raw(g)
      let rs: Report[]
      if (s.turn === s.pc) {
        // 主角：有連接就主導；沒有就找一個還在的人接上
        const others = s.seats.filter((x) => x.id !== s.pc && !x.out).map((x) => x.id)
        const tries: SceneInput[] = [
          ...(s.links.length > 0 ? [{ kind: 'dominate' } as SceneInput] : []),
          { kind: 'skill', id: 'nt_a', target: others[i % Math.max(1, others.length)] ?? 'x', pick: parts('hand_l', 'chest') },
          { kind: 'skill', id: 'nt_a', target: others[i % Math.max(1, others.length)] ?? 'x', pick: parts('hand_r', 'chest') },
          { kind: 'end_turn' },
        ]
        if (s.round >= 8 || others.length === 0) rs = act(g, { kind: 'stop' })
        else {
          let done: Report[] | null = null
          for (const t of tries) {
            try {
              done = act(g, t)
              break
            } catch (e) {
              if (!(e instanceof ActionBlocked)) throw e
            }
          }
          rs = done!
        }
      } else rs = next(g)
      for (const r of rs) log.push(`${r.action}:${r.timeline.map((b) => b.text).join('|')}`)
      const last = rs[0]!
      if (last.action === 'scene.end') ended = last.outcome.result as string
      if (sceneRawOf(g.state)) {
        const t = raw(g)
        for (const seat of t.seats) expect(g.state.actors[seat.id]!.load).toBeGreaterThanOrEqual(0)
        for (const c of t.circles) for (const id of c.people) expect(g.state.actors[id]!.load).toBeLessThan(35)
        // 還在這一圈的人都有位置
        for (const seat of t.seats) if (!seat.out && t.seats.filter((x) => !x.out).length > 1) expect(t.roles[seat.id]).toBeTruthy()
      }
    }
    return { rounds: log.length, ended, log: log.join('\n') }
  }

  it('兩個種子各跑一場：結束的原因是合法的、跑兩遍一模一樣', () => {
    for (const seed of [11, 23]) {
      const a = play(seed)
      expect(['stop', 'partner_quit', 'pc_out', 'partner_out', 'interrupted']).toContain(a.ended)
      const b = play(seed)
      expect(b).toEqual(a)
    }
  })
})
