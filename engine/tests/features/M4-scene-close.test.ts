// 驗收測試：dev/work/M4-scene-close.md（cpp-feature）。規格：LEWD_SYSTEM 3.4 節、3.5 節第六點、1.1 節「怎麼長」；CORE_RULES 4.3 節「親密關係怎麼影響沉溺」；
// AI_TASKS 3.7、3.8 節、4.2 節（sex_record、sink、tendency 三列的驗證與退路）；dev/adr/0019 第九節與 P43、P44；dev/invariants.md 第 33 條。
// 內容一律用測試自帶的最小假資料：兩個兩人體位、一個三人體位、三個標籤（同一條軸兩個、另一條軸一個）、三個假對象（安、波、西）。
//
// 數字的約定：結算只看 stop 那一步；契合用 raw(g).pairs[…].fit 直接設（70 是合拍、90 是難忘）；機率用固定的骰面（bridge 25% → 擲 1 一定中；難忘的機率 25% → 擲 1 一定中）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, Report } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Closing, Dice, SceneInput, SceneRaw } from '../../src/features/scene'
import { sceneAct, sceneFeature, sceneInterrupt, sceneRawOf, sceneSkip } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假內容 ----

const abc = [{ id: 'a', upper: true }, { id: 'b', upper: false }, { id: 'c', upper: true }]
const POSITIONS = [
  {
    id: 'pos_face', name: '面對面', people: 2, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }], mult: { a: 1, b: 1.5 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }],
  },
  {
    id: 'pos_tri', name: '夾在中間', people: 3, roles: abc, mult: { a: 1, b: 1.5, c: 1 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [
      { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['c', 'chest'] }, { from: ['a', 'mouth'], to: ['c', 'mouth'] },
      { from: ['c', 'hand_l'], to: ['b', 'back'] }, { from: ['b', 'hand_r'], to: ['c', 'front'] },
    ],
  },
]
const PACK: ContentPack = {
  id: 'close_test',
  content: {
    night_skill: [{ id: 'nt_a', name: '搭手', tag: 'tg_a', scene: { ap: 1, my_part: ['hand_l', 'hand_r'], their_part: ['chest'], on_use: { fit: 1 }, link: {} } }],
    position: POSITIONS,
    item: [],
    tendency_tag: [
      { id: 'tg_a', name: '支配', axis: 'relation' }, { id: 'tg_b', name: '服從', axis: 'relation' }, { id: 'tg_c', name: '主導', axis: 'relation' },
      { id: 'tg_s', name: '親吻', axis: 'sense' },
    ],
  },
}

const AFFINITY = testMeter({ kind: 'affinity', owner: 'test', name: '親密度', min: -100, max: 100, keyed: 'npc' })
const bridge = { sensitivity: 50, tolerance: 30, craving: 30, docility: 10 }
const TENDENCY = (tags: Record<string, string>) => ({ axes: { relation: 0, sense: 0, body: 0, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags })

type Game = ReturnType<typeof makeGame>['game']

/** 發起的人（origin.by 是 test）在 activity.end 收到的結果：最近一場的。 */
let heard: Record<string, unknown> = {}
const listener: Feature = {
  id: 'close_listener',
  install: (k: Kernel) => {
    k.hooks.on('activity.end', 'close_listener', (p) => {
      if (p.kind === 'scene') heard = p.result as Record<string, unknown>
    })
  },
}
interface Opts {
  rules?: Record<string, unknown>
  features?: Feature[]
  pc?: ActorOverrides
  ann?: ActorOverrides
  contentOff?: string[]
  pcTags?: Record<string, string>
}

function game(o: Opts = {}): Game {
  const person = (id: string, name: string, extra: ActorOverrides = {}) => makeActor({ id, name, role: 'npc', gender: 'female', ...extra, ext: { bridge, scene: { skills: [], positions: [] }, ...(extra.ext ?? {}) } })
  return makeGame({
    features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, listener, ...(o.features ?? [])],
    content: [PACK, METER_CONTENT, ...(o.rules ? [{ id: 'rules', content: { scene_rule: [{ id: 'default', ...o.rules }] } } as ContentPack] : [])],
    pc: { ...o.pc, ext: { bridge, scene: { skills: ['nt_a'], positions: [] }, tendency: TENDENCY(o.pcTags ?? {}), ...(o.pc?.ext ?? {}) } },
    actors: [person('npc_ann', '安', o.ann), person('npc_bo', '波'), person('npc_cy', '西')],
    patch: o.contentOff ? ({ rules: { contentOff: o.contentOff } } as never) : undefined,
  }).game
}

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

const raw = (g: Game): SceneRaw => sceneRawOf(g.state)!
const pcOf = (g: Game) => g.state.actors.pc!
const setup = (o: Record<string, unknown> = {}) => ({ with: ['npc_ann'], nature: 'mutual', mode: 'full', ...o })
/** 開一場、把每個對象的契合設成 fit */
function begin(g: Game, o: Record<string, unknown> = {}, fit = 70): void {
  g.launch('scene', setup(o), { by: 'test' })
  for (const id of Object.keys(raw(g).pairs)) raw(g).pairs[id]!.fit = fit
}
const aff = (g: Game, id: string, n: number): void => {
  g.state.meters.affinity = { ...(g.state.meters.affinity ?? {}), [id]: n }
}
const stop = (g: Game, closing?: Closing, d?: Dice): Report => g.commit(sceneAct(g.k, g.state, { kind: 'stop' } as SceneInput, { ...(closing ? { closing } : {}), ...(d ? { dice: d } : {}) }))[0]!
const result = (_r?: Report): Record<string, unknown> => heard
const sinkOf = (g: Game): number => pcOf(g).sink
const bridgeOf = (g: Game) => pcOf(g).ext.bridge as Record<string, number>
const sexOf = (g: Game, id = 'pc') => g.state.actors[id]!.ext.sex_record as Record<string, any>
const tagsOf = (g: Game, id = 'pc') => ((g.state.actors[id]!.ext.tendency as Record<string, any>).tags ?? {}) as Record<string, string>
const bridgeSum = (g: Game): number => Object.values(bridgeOf(g)).reduce((a, b) => a + b, 0)
const BRIDGE_SUM = Object.values(bridge).reduce((a, b) => a + b, 0)

// ======================================================================
describe('沉溺（P43）：AI 關著的退路與 env.closing.sink', () => {
  it('兩情相悅而且親密度 70：−2；沉溺 1 時只降到 0；sink_floor 5、沉溺 5 時不降', () => {
    const g = game({ pc: { sink: 10 } })
    begin(g)
    aff(g, 'npc_ann', 70)
    const r = stop(g)
    expect(sinkOf(g)).toBe(8)
    expect(result(r)).toMatchObject({ sink: -2, sink_kind: 'anchor' })
    expect(r.narration!.results!.join('')).toMatch(/沉溺：兩個人之間真的東西，-2/)

    const low = game({ pc: { sink: 1 } })
    begin(low)
    aff(low, 'npc_ann', 70)
    expect(result(stop(low))).toMatchObject({ sink: -1 })
    expect(sinkOf(low)).toBe(0)

    const floor = game({ pc: { sink: 5 } })
    floor.k.stats.addStatProvider('sink_floor', 'test', () => [{ label: '義體', value: 5, source: 'cyber' }])
    begin(floor)
    aff(floor, 'npc_ann', 70)
    const fr = stop(floor)
    expect(sinkOf(floor)).toBe(5)
    expect(result(fr)).toMatchObject({ sink: 0 })
    expect(fr.clamps!.some((c) => /浮不上來/.test(c.notice))).toBe(true)
  })

  it('親密度不到 60、兩情相悅以外：交易、工作、契約、俘虜 0；被迫 +2；單人 0', () => {
    const run = (o: Record<string, unknown>, a = 70) => {
      const g = game({ pc: { sink: 10 } })
      begin(g, o)
      aff(g, 'npc_ann', a)
      stop(g)
      return sinkOf(g) - 10
    }
    expect(run({}, 59)).toBe(0)
    expect(run({ nature: 'trade', role: 'guest' })).toBe(0)
    expect(run({ nature: 'work', role: 'worker' })).toBe(0)
    expect(run({ nature: 'contract', role: 'holder' })).toBe(0)
    expect(run({ nature: 'captive' })).toBe(0)
    expect(run({ nature: 'forced' })).toBe(2)
    const solo = game({ pc: { sink: 10 } })
    solo.launch('scene', { solo: true, nature: 'solo', mode: 'full' }, { by: 'test' })
    stop(solo)
    expect(sinkOf(solo)).toBe(10)
  })

  it('多人：親密度看對象的平均（70 與 40 平均 55：0；70 與 50 平均 60：−2）', () => {
    const run = (b: number) => {
      const g = game({ pc: { sink: 10 } })
      begin(g, { with: ['npc_ann', 'npc_bo'] })
      aff(g, 'npc_ann', 70)
      aff(g, 'npc_bo', b)
      stop(g)
      return sinkOf(g) - 10
    }
    expect(run(40)).toBe(0)
    expect(run(50)).toBe(-2)
  })

  it('env.closing.sink：給 +9 只算 +4；給 −9 只算 −4；給的數字取代退路', () => {
    const up = game({ pc: { sink: 10 } })
    begin(up)
    const r = stop(up, { sink: { kind: 'other', amount: 9 } })
    expect(sinkOf(up)).toBe(14)
    expect(r.clamps!.some((c) => c.path === 'closing.sink' && c.to === 4)).toBe(true)
    const down = game({ pc: { sink: 10 } })
    begin(down)
    stop(down, { sink: { kind: 'anchor', amount: -9 } })
    expect(sinkOf(down)).toBe(6)
    // 取代退路：兩情相悅 70 本來是 −2，給 0 就是 0
    const own = game({ pc: { sink: 10 } })
    begin(own)
    aff(own, 'npc_ann', 70)
    stop(own, { sink: { kind: 'other', amount: 0 } })
    expect(sinkOf(own)).toBe(10)
  })

  it("給 kind: 'forced' 而這一場是交易：不收、照退路（0）並留提醒；這一場真的是被迫就收", () => {
    const g = game({ pc: { sink: 10 } })
    begin(g, { nature: 'trade', role: 'guest' })
    const r = stop(g, { sink: { kind: 'forced', amount: 3 } })
    expect(sinkOf(g)).toBe(10)
    expect(r.clamps!.some((c) => c.path === 'closing.sink' && /不是被迫/.test(c.notice))).toBe(true)
    const f = game({ pc: { sink: 10 } })
    begin(f, { nature: 'forced' })
    stop(f, { sink: { kind: 'forced', amount: 3 } })
    expect(sinkOf(f)).toBe(13)
  })

  it('全檔過載累積的那一份加在上面，合計夾在 +4：過載累積 4 加上被迫的 +2 還是 +4；單獨過載照加', () => {
    const g = game({ pc: { sink: 10 } })
    begin(g, { nature: 'forced' })
    raw(g).seats[0]!.sink_gain = 4
    const r = stop(g)
    expect(sinkOf(g)).toBe(14)
    expect(result(r)).toMatchObject({ sink: 4 })
    expect(r.clamps!.some((c) => c.path === 'closing.sink' && c.from === 6 && c.to === 4)).toBe(true)
    // 沒有往上超過：交易的 0 加上過載的 2 是 +2；兩情相悅 −2 加上過載的 3 是 +1
    const t = game({ pc: { sink: 10 } })
    begin(t, { nature: 'trade', role: 'guest' })
    raw(t).seats[0]!.sink_gain = 2
    stop(t)
    expect(sinkOf(t)).toBe(12)
    const m = game({ pc: { sink: 10 } })
    begin(m)
    aff(m, 'npc_ann', 80)
    raw(m).seats[0]!.sink_gain = 3
    stop(m)
    expect(sinkOf(m)).toBe(11)
  })

  it('對象的過載累積照舊直接加在他身上（不吃規則退路）', () => {
    const g = game()
    begin(g, { nature: 'forced' })
    raw(g).seats[1]!.sink_gain = 3
    stop(g)
    expect(g.state.actors.npc_ann!.sink).toBe(3)
    expect(sinkOf(g)).toBe(2)
  })

  it('沒有人定義 sink 效果的一局（沒裝 character）：直接加減、不丟錯', () => {
    const g = makeGame({
      features: [lewdFeature, meterFeature(AFFINITY), sceneFeature, listener], content: [PACK, METER_CONTENT],
      pc: { ext: { bridge, scene: { skills: [], positions: [] } }, sink: 10 },
      actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc', ext: { bridge } })],
    }).game
    begin(g, { nature: 'forced' })
    expect(() => stop(g)).not.toThrow()
    expect(sinkOf(g)).toBe(12)
  })
})

// ======================================================================
describe('橋參數那一點落在哪一項（P44）', () => {
  /** 合拍（70）、擲 1 一定中；seat 上先放好這一場的記號 */
  const run = (o: Record<string, unknown>, mark: (g: Game) => void = () => {}, fit = 70) => {
    const g = game()
    begin(g, o, fit)
    mark(g)
    const r = stop(g, undefined, dice(1))
    return { g, r }
  }
  const only = (g: Game, param: string): boolean => bridgeSum(g) === BRIDGE_SUM + 1 && bridgeOf(g)[param] === bridge[param as keyof typeof bridge] + 1

  it('開過深檔（以上）的是敏感度；全檔也是', () => {
    const deep = run({}, (g) => { raw(g).seats[0]!.max_gear = 'deep' })
    expect(only(deep.g, 'sensitivity')).toBe(true)
    expect(result(deep.r)).toMatchObject({ bridge_gain: 'sensitivity' })
    expect(only(run({}, (g) => { raw(g).seats[0]!.max_gear = 'full' }).g, 'sensitivity')).toBe(true)
  })
  it('高潮兩次以上的是耐受（深檔優先於它）', () => {
    expect(only(run({}, (g) => { raw(g).seats[0]!.climax = 2 }).g, 'tolerance')).toBe(true)
    expect(only(run({}, (g) => { raw(g).seats[0]!.climax = 1 }).g, 'craving')).toBe(true)
    expect(only(run({}, (g) => { raw(g).seats[0]!.climax = 3; raw(g).seats[0]!.max_gear = 'deep' }).g, 'sensitivity')).toBe(true)
  })
  it('工作或契約而且迎合比主導多是馴化；一樣多或兩情相悅不算', () => {
    const lean = (g: Game) => { raw(g).seats[0]!.yield_used = 3; raw(g).seats[0]!.dom_used = 1 }
    expect(only(run({ nature: 'work', role: 'worker' }, lean).g, 'docility')).toBe(true)
    expect(only(run({ nature: 'contract', role: 'bound' }, lean).g, 'docility')).toBe(true)
    expect(only(run({ nature: 'work', role: 'worker' }, (g) => { raw(g).seats[0]!.yield_used = 2; raw(g).seats[0]!.dom_used = 2 }).g, 'craving')).toBe(true)
    expect(only(run({}, lean).g, 'craving')).toBe(true)
    // 高潮兩次的優先於迎合
    expect(only(run({ nature: 'work', role: 'worker' }, (g) => { lean(g); raw(g).seats[0]!.climax = 2 }).g, 'tolerance')).toBe(true)
  })
  it('其餘是慾求；一場只有一項；機率沒中、普通與不合、略過都沒有；落在主角、不在對象身上', () => {
    const base = run({})
    expect(only(base.g, 'craving')).toBe(true)
    expect(g_ann(base.g).bridge).toEqual(bridge)
    const miss = game()
    begin(miss)
    stop(miss, undefined, dice(26))
    expect(bridgeOf(miss)).toEqual(bridge)
    expect(bridgeOf(run({}, () => {}, 40).g)).toEqual(bridge) // 普通：沒有擲（骰面只有一顆，擲了也沒中以外的錯）
    const sk = game()
    begin(sk)
    sk.commit(sceneSkip(sk.k, sk.state, { dice: dice(20) }))
    expect(bridgeOf(sk)).toEqual(bridge)
  })
  it('實際的變化是 result.bridge_gain：沒有橋的主角沒有地方落、不報', () => {
    const g = game({ pc: { ext: { bridge: null } } })
    begin(g)
    const r = stop(g, undefined, dice(1))
    expect(result(r).bridge_gain).toBeUndefined()
  })
})
const g_ann = (g: Game) => g.state.actors.npc_ann!.ext as Record<string, any>

// ======================================================================
describe('傾向：照這一場碰到的標籤加（每條軸一個）', () => {
  it('同一條軸的三個標籤只記第一個；另一條軸的照記', () => {
    const g = game()
    begin(g, { tags: ['tg_a', 'tg_b', 'tg_c', 'tg_s'] })
    const r = stop(g)
    expect(result(r).tendency).toEqual(['tg_a', 'tg_s'])
    expect(Object.keys(tagsOf(g)).sort()).toEqual(['tg_a', 'tg_s'])
    expect(result(r).touched).toEqual(['tg_a', 'tg_b', 'tg_c', 'tg_s'])
  })
  it('tendency_per_axis 改成 2：同一條軸記兩個', () => {
    const g = game({ rules: { tendency_per_axis: 2 } })
    begin(g, { tags: ['tg_a', 'tg_b', 'tg_c'] })
    expect(result(stop(g)).tendency).toEqual(['tg_a', 'tg_b'])
  })
  it('env.closing.tendency 只收是碰到的子集；給了一個沒碰到的被丟掉並留提醒；給的順序不改碰到的順序', () => {
    const g = game()
    begin(g, { tags: ['tg_a', 'tg_b', 'tg_s'] })
    const r = stop(g, { tendency: ['tg_s', 'tg_c', 'tg_b'] })
    // 篩出來的是 tg_b（relation）與 tg_s（sense）；tg_c 沒碰到
    expect(result(r).tendency).toEqual(['tg_b', 'tg_s'])
    expect(r.clamps!.some((c) => c.path === 'closing.tendency' && c.from === 'tg_c')).toBe(true)
    expect(tagsOf(g).tg_a).toBeUndefined()
  })
  it('被內容篩選關掉的不記，下一個同軸的補上；closing 點名關掉的留提醒', () => {
    const g = game({ contentOff: ['tg_a'] })
    begin(g, { tags: ['tg_a', 'tg_b'] })
    const r = stop(g, { tendency: ['tg_a', 'tg_b'] })
    expect(result(r).tendency).toEqual(['tg_b'])
    expect(result(r).touched).toEqual(['tg_b'])
    expect(r.clamps!.some((c) => c.path === 'closing.tendency' && c.from === 'tg_a')).toBe(true)
    expect(tagsOf(g).tg_a).toBeUndefined()
  })
  it('用過的技能的標籤也算碰到的（照碰到的順序）', () => {
    const g = game({ pcTags: { tg_a: 'has' } })
    begin(g, { tags: ['tg_s'] })
    g.commit(sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_a', pick: { my_part: 'hand_l', their_part: 'chest' } } as SceneInput, { dice: dice(1, 1, 1, 1, 1) }))
    // 技能用完行動點可能交給對方：直接結束
    const r = g.commit(sceneInterrupt(g.k, g.state))[0]!
    expect(result(r).touched).toEqual(['tg_s', 'tg_a'])
    expect(result(r).tendency).toEqual(['tg_s', 'tg_a'])
  })
})

// ======================================================================
describe('「難忘」讓有的標籤變深', () => {
  const run = (fit: number, tags: Record<string, string>, rolls: number[], o: Record<string, unknown> = { tags: ['tg_a', 'tg_s'] }) => {
    const g = game({ pcTags: tags })
    begin(g, o, fit)
    const r = stop(g, undefined, dice(...rolls))
    return { g, r }
  }
  it('只有一個「有」的標籤：它變成「深」', () => {
    const { g, r } = run(90, { tg_a: 'has' }, [1, 1])
    expect(tagsOf(g).tg_a).toBe('deep')
    expect(result(r)).toMatchObject({ deep: 'tg_a' })
  })
  it('兩個都是「有」：只變一個（挑的亂數 0 是第一個、1 是第二個）', () => {
    const first = run(90, { tg_a: 'has', tg_s: 'has' }, [1, 1, 0])
    expect(tagsOf(first.g).tg_a).toBe('deep')
    expect(tagsOf(first.g).tg_s).toBe('has')
    const second = run(90, { tg_a: 'has', tg_s: 'has' }, [1, 1, 1])
    expect(tagsOf(second.g).tg_a).toBe('has')
    expect(tagsOf(second.g).tg_s).toBe('deep')
  })
  it('機率沒中（26 以上）、不是難忘（合拍）、標籤只是潛伏或根本沒有、略過：都不會', () => {
    expect(tagsOf(run(90, { tg_a: 'has' }, [1, 26]).g).tg_a).toBe('has')
    expect(tagsOf(run(70, { tg_a: 'has' }, [1]).g).tg_a).toBe('has')
    expect(tagsOf(run(90, { tg_a: 'latent' }, [1]).g).tg_a).not.toBe('deep') // 潛伏的這一場只被揭開，不跳級
    expect(tagsOf(run(90, {}, [1]).g).tg_a).not.toBe('deep')
    const sk = game({ pcTags: { tg_a: 'has' } })
    begin(sk, { tags: ['tg_a'] })
    sk.commit(sceneSkip(sk.k, sk.state, { dice: dice(20) }))
    expect(tagsOf(sk).tg_a).toBe('has')
  })
  it('已經是「深」的不再動；被篩選關掉的標籤不變深；closing.tendency 沒收的不變深', () => {
    expect(tagsOf(run(90, { tg_a: 'deep' }, [1, 1]).g).tg_a).toBe('deep')
    const off = game({ pcTags: { tg_a: 'has' }, contentOff: ['tg_a'] })
    begin(off, { tags: ['tg_a'] }, 90)
    stop(off, undefined, dice(1))
    expect(tagsOf(off).tg_a).toBe('has')
    const g = game({ pcTags: { tg_a: 'has', tg_s: 'has' } })
    begin(g, { tags: ['tg_a', 'tg_s'] }, 90)
    stop(g, { tendency: ['tg_s'] }, dice(1, 1))
    expect(tagsOf(g).tg_a).toBe('has')
    expect(tagsOf(g).tg_s).toBe('deep')
  })
  it('deep_chance 改成 1：不用擲也一定中的那一擲仍落在範圍內（擲 100 也中）', () => {
    const g = game({ pcTags: { tg_a: 'has' }, rules: { deep_chance: 1 } })
    begin(g, { tags: ['tg_a'] }, 90)
    stop(g, undefined, dice(1, 100))
    expect(tagsOf(g).tg_a).toBe('deep')
  })
})

// ======================================================================
describe('性經歷', () => {
  it('kinds 記這一場性質的次數；兩個對象各一筆；每個人各有一份', () => {
    const g = game()
    begin(g, { with: ['npc_ann', 'npc_bo'], nature: 'trade', role: 'guest' })
    stop(g)
    expect(sexOf(g).kinds).toEqual({ trade: 1 })
    expect(sexOf(g).people).toEqual({ npc_ann: 1, npc_bo: 1 })
    expect(sexOf(g).partners).toBe(2)
    expect(sexOf(g, 'npc_ann').kinds).toEqual({ trade: 1 })
    expect(sexOf(g, 'npc_ann').people).toMatchObject({ pc: 1, npc_bo: 1 })
    // 再來一場別的性質：各自的次數加
    begin(g, { nature: 'mutual' })
    stop(g)
    expect(sexOf(g).kinds).toEqual({ trade: 1, mutual: 1 })
  })
  it('partners 取較大值：建角給的起始對象人數不被第一場蓋成 1', () => {
    const g = game({ pc: { ext: { bridge, scene: { skills: [], positions: [] }, sex_record: { partners: 5, times: 0, service_times: 0, people: {}, positions: [], tags: [] } } } })
    begin(g)
    stop(g)
    expect(sexOf(g).partners).toBe(5)
    expect(sexOf(g).people).toEqual({ npc_ann: 1 })
    expect(sexOf(g).times).toBe(1)
  })
  it('favorite：次數多的那個人；一樣多取主角親密度高的；查不到量表只看次數', () => {
    const g = game({ pc: { ext: { bridge, scene: { skills: [], positions: [] }, sex_record: { partners: 2, times: 5, service_times: 0, people: { npc_ann: 3, npc_bo: 2 }, positions: [], tags: [] } } } })
    begin(g, { with: ['npc_bo'] })
    stop(g)
    expect(sexOf(g).people).toEqual({ npc_ann: 3, npc_bo: 3 })
    expect(sexOf(g).favorite).toBe('npc_ann') // 一樣多、沒有量表的差：先出現的
    const t = game({ pc: { ext: { bridge, scene: { skills: [], positions: [] }, sex_record: { partners: 2, times: 5, service_times: 0, people: { npc_ann: 3, npc_bo: 2 }, positions: [], tags: [] } } } })
    begin(t, { with: ['npc_bo'] })
    aff(t, 'npc_ann', 10)
    aff(t, 'npc_bo', 40)
    stop(t)
    expect(sexOf(t).favorite).toBe('npc_bo')
    const m = game()
    begin(m, { with: ['npc_ann', 'npc_bo'] })
    stop(m)
    expect(sexOf(m).favorite).toBe('npc_ann')
    // 次數多的不看親密度
    const more = game({ pc: { ext: { bridge, scene: { skills: [], positions: [] }, sex_record: { partners: 2, times: 6, service_times: 0, people: { npc_ann: 5, npc_bo: 1 }, positions: [], tags: [] } } } })
    begin(more, { with: ['npc_bo'] })
    aff(more, 'npc_bo', 90)
    stop(more)
    expect(sexOf(more).favorite).toBe('npc_ann')
  })
  it('env.closing.sex_record 的一句話存進 notes，只收在場的人；太長截短；類型以場景為準；最多留 20 筆', () => {
    const g = game()
    begin(g)
    const r = stop(g, {
      sex_record: [
        { with: 'npc_ann', note: '他笑得很安靜。', kind: 'mutual' },
        { with: 'npc_zzz', note: '不在場的人' },
        { with: 'npc_bo', note: '不在場（波沒有來）' },
      ],
    })
    expect(sexOf(g).notes).toEqual({ npc_ann: '他笑得很安靜。' })
    expect(r.clamps!.filter((c) => c.path.startsWith('closing.sex_record')).length).toBe(2)
    // 類型寫得不一樣：照場景、留提醒
    const k = game()
    begin(k, { nature: 'trade', role: 'guest' })
    const kr = stop(k, { sex_record: [{ with: 'npc_ann', kind: 'mutual' }] })
    expect(kr.clamps!.some((c) => /性質是交易/.test(c.notice))).toBe(true)
    expect(sexOf(k).kinds).toEqual({ trade: 1 })
    // 太長
    const long = game()
    begin(long)
    stop(long, { sex_record: [{ with: 'npc_ann', note: '長'.repeat(200) }] })
    expect(sexOf(long).notes.npc_ann).toHaveLength(80)
    // 最多 20 筆：舊的先丟
    const old: Record<string, string> = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`old_${i}`, `舊的 ${i}`]))
    const cap = game({ pc: { ext: { bridge, scene: { skills: [], positions: [] }, sex_record: { partners: 20, times: 20, service_times: 0, people: {}, positions: [], tags: [], notes: old } } } })
    begin(cap)
    stop(cap, { sex_record: [{ with: 'npc_ann', note: '新的' }] })
    expect(Object.keys(sexOf(cap).notes)).toHaveLength(20)
    expect(sexOf(cap).notes.npc_ann).toBe('新的')
    expect(sexOf(cap).notes.old_0).toBeUndefined()
    expect(sexOf(cap).notes.old_1).toBe('舊的 1')
  })
  it('每個對象的身體與外表的性別也記下（夜課的學習條件讀）：身體來自角色的 ext.body，沒有就只記性別', () => {
    const g = game({ ann: { gender: 'femboy', ext: { body: 'andro' } } })
    begin(g, { with: ['npc_ann', 'npc_bo'] })
    stop(g)
    expect(sexOf(g).looks).toEqual({ npc_ann: { body: 'andro', look_gender: 'femboy' }, npc_bo: { look_gender: 'female' } })
    // 對象那一邊記的是主角
    expect(sexOf(g, 'npc_ann').looks.pc).toEqual({ look_gender: 'female' })
  })
  it('單人：性經歷只加 solo_times，不加 kinds、對象與次數', () => {
    const g = game()
    g.launch('scene', { solo: true, nature: 'solo', mode: 'full' }, { by: 'test' })
    stop(g)
    expect(sexOf(g).solo_times).toBe(1)
    expect(sexOf(g).kinds).toBeUndefined()
    expect(sexOf(g).times).toBe(0)
  })
})

// ======================================================================
describe('關係', () => {
  it('env.closing.relate 給 +20、評價是合拍：只加 6；給 −9 的合拍只降到 3；沒給的照固定值（合拍 +5）', () => {
    const g = game()
    begin(g)
    const r = stop(g, { relate: { npc_ann: 20 } })
    expect(g.state.meters.affinity!.npc_ann).toBe(6)
    expect(r.clamps!.some((c) => c.path === 'closing.relate.npc_ann' && c.from === 20 && c.to === 6)).toBe(true)
    expect((result(r).pairs ?? {}) as object).toEqual({})
    const low = game()
    begin(low)
    stop(low, { relate: { npc_ann: -9 } })
    expect(low.state.meters.affinity!.npc_ann).toBe(3)
    const none = game()
    begin(none)
    stop(none)
    expect(none.state.meters.affinity!.npc_ann).toBe(5)
  })
  it('每一級有自己的範圍：不合 [−2, 0]、普通 [0, 3]、難忘 [6, 10]；範圍裡的數字照收', () => {
    const run = (fit: number, n: number) => {
      const g = game()
      begin(g, {}, fit)
      stop(g, { relate: { npc_ann: n } }, dice(1, 26))
      return g.state.meters.affinity?.npc_ann ?? 0
    }
    expect(run(10, -9)).toBe(-2)
    expect(run(10, 5)).toBe(0)
    expect(run(40, 9)).toBe(3)
    expect(run(40, 1)).toBe(1)
    expect(run(90, 1)).toBe(6)
    expect(run(90, 99)).toBe(10)
    expect(run(90, 7)).toBe(7)
  })
  it('多人：每個對象各自的評價與範圍；不是對象的人給的數字丟掉並留提醒', () => {
    const g = game()
    begin(g, { with: ['npc_ann', 'npc_bo'] })
    raw(g).pairs.npc_ann!.fit = 70 // 合拍
    raw(g).pairs.npc_bo!.fit = 10 // 不合
    const r = stop(g, { relate: { npc_ann: 99, npc_bo: 99, npc_cy: 4 } })
    expect(g.state.meters.affinity!.npc_ann).toBe(6)
    expect(g.state.meters.affinity?.npc_bo ?? 0).toBe(0)
    expect(g.state.meters.affinity?.npc_cy).toBeUndefined()
    expect(r.clamps!.some((c) => c.path === 'closing.relate.npc_cy')).toBe(true)
  })
  it('rules 蓋掉 relate_range：合拍改成 [0, 2]', () => {
    const g = game({ rules: { relate_range: { fit: [0, 2] } } })
    begin(g)
    stop(g, { relate: { npc_ann: 20 } })
    expect(g.state.meters.affinity!.npc_ann).toBe(2)
  })
})

// ======================================================================
describe('env.closing 的驗證與沒給的時候', () => {
  it('格式不合的整筆丟掉並留提醒，其餘照規則算；不丟錯', () => {
    const g = game({ pc: { sink: 10 } })
    begin(g)
    const r = stop(g, { sink: { kind: 'nope', amount: 'x' }, tendency: 'tg_a', sex_record: 5, relate: [] } as never)
    expect(sinkOf(g)).toBe(10)
    expect(r.clamps!.map((c) => c.path)).toEqual(expect.arrayContaining(['closing.sink', 'closing.tendency', 'closing.sex_record', 'closing.relate']))
    expect(g.state.meters.affinity!.npc_ann).toBe(5)
  })
  it('強制結束與略過也讀 closing（打斷）；沒給 closing 時 result 只多了沉溺、碰到的與傾向', () => {
    const g = game({ pc: { sink: 10 } })
    begin(g, { nature: 'forced' })
    const r = g.commit(sceneInterrupt(g.k, g.state, { closing: { sink: { kind: 'forced', amount: 1 } } }))[0]!
    expect(sinkOf(g)).toBe(11)
    expect(result(r)).toMatchObject({ reason: 'interrupted', sink: 1, sink_kind: 'forced' })
    const h = game()
    begin(h)
    expect(Object.keys(result(stop(h))).sort()).toEqual(['circles', 'goal', 'goal_done', 'max_gear', 'rating', 'reason', 'sink', 'sink_kind', 'tendency', 'touched', 'with', 'fit'].filter((k) => k !== 'circles').sort())
  })
  it('單人也讀 closing：沉溺、傾向；關係的數字沒有對象、丟掉', () => {
    const g = game({ pc: { sink: 10 } })
    g.launch('scene', { solo: true, nature: 'solo', mode: 'full', tags: ['tg_a', 'tg_b'] }, { by: 'test' })
    const r = stop(g, { sink: { kind: 'other', amount: 3 }, relate: { npc_ann: 5 } })
    expect(sinkOf(g)).toBe(13)
    expect(result(r)).toMatchObject({ solo: true, sink: 3, tendency: ['tg_a'] })
    expect(g.state.meters.affinity?.npc_ann).toBeUndefined()
    expect(r.clamps!.some((c) => c.path === 'closing.relate.npc_ann')).toBe(true)
  })
})
