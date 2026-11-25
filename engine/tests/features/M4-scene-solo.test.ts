// 驗收測試：dev/work/M4-scene-solo.md（cpp-feature）。規格：LEWD_SYSTEM 3.5 節第九點「單人」（單人姿勢五個、成人道具、節奏掉的時候、強制結束、評價與體悟、性經歷）；
// NIGHT_LESSONS 的「單人」欄（資料的 scene.solo）；dev/adr/0019 第九節與 P38～P40。
// 內容一律用測試自帶的最小假資料：三個技能（solo 各是 ok、audience、沒寫）、一個建立連接的道具（玩具）、一種藥（冷靜貼片）、一個假對象（安，只用來確認沒被動到）。
//
// 數字的約定：主角敏感度 50（感載倍率 1.0）、馴化 10；感載上限 35、餘韻上限 3、行動點上限 4（每回合回 3）。單人開場節奏 30、姿勢預設是張腿仰躺（倍率 1.0）。
// 加快：2 點、自己感載 2d6、節奏 +8；放慢：1 點、自己感載 −1d6、節奏 +3；節奏掉的時候：這一回合沒有連接 −3、自己高潮 −10；節奏 ≤ 10 且過了三回合：沒了興致。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Kernel, Origin } from '../../src'
import { ActionBlocked } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Dice, SceneEnv, SceneInput, SceneRaw } from '../../src/features/scene'
import { DEFAULT_SOLO_POSES, ruleProblems, sceneAct, sceneFeature, sceneInterrupt, sceneNext, sceneOptions, sceneRawOf, sceneRules, sceneSkip, sceneView, startProblems } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假內容 ----

const POSITIONS = [
  {
    id: 'pos_face', name: '面對面', people: 2, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }], mult: { a: 1, b: 1.5 }, initiative_drift: 3, tags: [], unlocked_by: null,
    links: [{ from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }],
  },
]
const skill = (id: string, name: string, scene: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, name, scene, ...extra })
const PACK = (withPositions: boolean): ContentPack => ({
  id: 'solo_test',
  content: {
    night_skill: [
      // solo: ok：手接自己的前；原本給對方的 1d6 算在自己身上，給自己的 2d6 不算
      skill('nt_ok', '慢慢摸', { ap: 1, my_part: ['hand_l', 'hand_r'], their_part: ['front', 'chest', 'back'], on_use: { their_load: '1d6', my_load: '2d6', fit: 3, initiative: 20 }, link: { their_load: '1d6', my_load: '1d6', fit: 2 }, solo: 'ok' }),
      // solo: audience：要有人在看
      skill('nt_aud', '給你看', { ap: 1, my_part: ['hand_r'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 1 }, solo: 'audience' }),
      // 沒寫 solo：技能預設不能用
      skill('nt_none', '貼貼', { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { fit: 1 }, link: {} }),
      // 帶標籤的技能（算第一次碰標籤）
      skill('nt_tag', '好舒服', { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 1 }, link: { their_load: '1d6' }, solo: 'ok' }, { tag: 'tg_dom' }),
      // 只能在指定姿勢用（單人姿勢的 id 也算數）
      skill('nt_pose', '跪著弄', { ap: 1, my_part: ['hand_l'], their_part: ['front'], positions: ['solo_kneel'], on_use: { their_load: '1d6', fit: 1 }, link: { their_load: '1d6' }, solo: 'ok' }),
      // 兩端都是後：跪姿碰得到、張腿仰躺碰不到
      skill('nt_back', '繞到後面', { ap: 1, my_part: ['hand_l', 'hand_r'], their_part: ['back'], on_use: { their_load: '1d6', fit: 1 }, link: { their_load: '1d6' }, solo: 'ok' }),
    ],
    position: withPositions ? POSITIONS : [],
    item: [
      {
        id: 'it_toy', name: '脈衝環', desc: '一個測試用的玩具。', category: 'tool', grade: 2, size: 0, legal: 'free',
        scene: { ap: 1, as_part: 'toy', their_part: ['front', 'chest', 'back'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 } },
      },
      { id: 'it_calm', name: '冷靜貼片', desc: '一個測試用的貼片。', category: 'consumable', grade: 1, size: 0, legal: 'free', consumable: true, scene: { ap: 1, on_use: { my_load: '-1d6' } } },
      // 道具也可以標成要有人在看或不能用
      { id: 'it_cam', name: '小攝影機', desc: '一個測試用的東西。', category: 'tool', grade: 1, size: 0, legal: 'free', scene: { ap: 1, on_use: { their_load: '1d6' }, solo: 'audience' } },
      { id: 'it_cuff', name: '雙人手銬', desc: '一個測試用的東西。', category: 'tool', grade: 1, size: 0, legal: 'free', scene: { ap: 1, as_part: 'toy', their_part: ['hand_l'], on_use: {}, link: {}, solo: 'no' } },
    ],
    skill: [{ id: 'sync', name: '同步', attr: 'resolve', desc: '撐住回灌。' }],
    tendency_tag: [{ id: 'tg_dom', name: '支配', axis: 'relation' }],
  },
})

const AFFINITY = testMeter({ kind: 'affinity', owner: 'test', name: '親密度', min: -100, max: 100, keyed: 'npc' })
const bridge = (sensitivity: number, docility: number) => ({ sensitivity, tolerance: 30, craving: 30, docility })

type Game = ReturnType<typeof makeGame>['game']

interface Opts {
  /** 內容裡有沒有一般的體位（單人用不到；沒有它單人照樣開得起來） */
  positions?: boolean
  tweak?: ActorOverrides
  rules?: Record<string, unknown>
  features?: Feature[]
  seed?: number
  skills?: string[]
  content?: ContentPack[]
}

function game(o: Opts = {}): Game {
  return makeGame({
    seed: o.seed,
    features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, ...(o.features ?? [])],
    content: [PACK(o.positions ?? true), METER_CONTENT, ...(o.rules ? [{ id: 'rules', content: { scene_rule: [{ id: 'default', ...o.rules }] } } as ContentPack] : []), ...(o.content ?? [])],
    pc: { ext: { bridge: bridge(50, 10), scene: { skills: o.skills ?? ['nt_ok', 'nt_aud', 'nt_none', 'nt_tag', 'nt_pose', 'nt_back'], positions: [] } }, ...o.tweak },
    actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc', ext: { bridge: bridge(100, 30), scene: { skills: [], positions: [] } } })],
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

const solo = (extra: Record<string, unknown> = {}) => ({ solo: true, mode: 'full' as const, ...extra })
const begin = (g: Game, s: Record<string, unknown> = solo(), origin: Origin = { by: 'test' }) => g.launch('scene', s, origin)
const alone = (o: Opts = {}, extra: Record<string, unknown> = {}): Game => {
  const g = game(o)
  begin(g, solo(extra))
  return g
}
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
const load = (g: Game): number => g.state.actors.pc!.load
const parts = (my_part: string, their_part: string) => ({ my_part, their_part })
const choiceOf = (g: Game, action: 'skill' | 'item' | 'switch', id: string) => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === action)!.choices!.find((c) => c.id === id)!
const actionOf = (g: Game, id: string) => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === id)!
/** 把一場單人演到結束，收集活動結束的結果 */
function collector(): { heard: Array<Record<string, unknown>>; feature: Feature } {
  const heard: Array<Record<string, unknown>> = []
  return {
    heard,
    feature: {
      id: 'caller',
      install(k: Kernel) {
        k.hooks.on('activity.end', 'caller', (p) => {
          if (p.kind === 'scene') heard.push(p.result as Record<string, unknown>)
        })
      },
    },
  }
}

// ======================================================================
describe('開場', () => {
  it('solo: true 開得起來：seats 只有主角、pairs 是空的、kind 是 solo、節奏 30、沒有一般的體位（內容裡也沒有一般體位照樣開得起來）', () => {
    const g = alone({ positions: false })
    const s = raw(g)
    expect(s).toMatchObject({ v: 2, kind: 'solo', layer: 'meat', mode: 'full', nature: 'solo', pace: 30, circles: [], pairs: {}, roles: {}, audience: false, goal: null, goal_progress: null })
    expect(s.seats.map((x) => x.id)).toEqual(['pc'])
    expect(s.seats[0]!.ap).toBe(4)
    expect(s.links).toEqual([])
    // 沒有一般體位的 id；位置是單人姿勢的 id
    expect(s.position).toBe('solo_spread')
    expect(s.used_positions).toEqual(['solo_spread'])
    expect(s.turn).toBe('pc')
  })

  it('開場報告：一句中性的描述，沒有對方的欄位', () => {
    const g = game()
    const rs = begin(g)
    const r = rs.find((x) => x.action === 'scene.start')!
    expect(r.timeline[0]!.text).toMatch(/獨自進入了這一場/)
    expect(r.timeline[0]!.data).toMatchObject({ solo: true, nature: 'solo', position: 'solo_spread', audience: false })
    expect(r.timeline[0]!.data).not.toHaveProperty('with')
  })

  it('同時給 with 或 circles 被擋、原因是沒有對象；性質寫別的被擋；性質 solo 沒有 solo: true 也被擋；目的只收 footage', () => {
    const g = game()
    expect(startProblems(g.k, g.state, { solo: true, with: ['npc_ann'], nature: 'solo' }).problems.join('')).toMatch(/單人的場景沒有對象/)
    expect(() => begin(g, { solo: true, with: ['npc_ann'], mode: 'full' })).toThrow(/沒有對象/)
    expect(startProblems(g.k, g.state, { solo: true, circles: [['pc', 'npc_ann']] }).problems.join('')).toMatch(/沒有對象/)
    expect(startProblems(g.k, g.state, { solo: true, nature: 'mutual' }).problems.join('')).toMatch(/性質只能是 solo/)
    expect(startProblems(g.k, g.state, { with: ['npc_ann'], nature: 'solo' }).problems.join('')).toMatch(/solo: true/)
    expect(startProblems(g.k, g.state, { solo: true, goal: 'please' }).problems.join('')).toMatch(/footage/)
    expect(startProblems(g.k, g.state, { solo: true, goal: 'none' }).problems).toEqual([])
    expect(startProblems(g.k, g.state, { solo: true, goal: 'footage', nature: 'solo' }).problems).toEqual([])
    expect(startProblems(g.k, g.state, { solo: 'yes' }).problems.join('')).toMatch(/solo 要是/)
    expect(startProblems(g.k, g.state, { solo: true, audience: 1 }).problems.join('')).toMatch(/audience 要是/)
    expect(startProblems(g.k, g.state, { solo: true, max_rounds: 0 }).problems.join('')).toMatch(/max_rounds/)
    // 兩個人以上的場景照舊
    expect(startProblems(g.k, g.state, { with: ['npc_ann'], nature: 'mutual' }).problems).toEqual([])
  })

  it('開場摘要：kind 是 solo、沒有對象、性質是獨自、audience；內容篩選關掉的性質不影響單人；沒有橋的人照舊標準檔', () => {
    const g = game()
    g.state.rules.contentOff.push('pc_unwilling', 'male_partner')
    const r = startProblems(g.k, g.state, solo({ audience: true, tags: ['tg_dom'] }))
    expect(r.problems).toEqual([])
    expect(r.summary).toMatchObject({ kind: 'solo', with: [], nature: 'solo', nature_name: '獨自', audience: true, filters: [], goal: null })
    expect(r.summary!.tags).toEqual([{ id: 'tg_dom', name: '支配' }])
    // 設定的 tags 裡被關掉的不算
    g.state.rules.contentOff.push('tg_dom')
    expect(startProblems(g.k, g.state, solo({ tags: ['tg_dom'] })).summary!.tags).toEqual([])
    const h = alone({ tweak: { ext: { bridge: null, scene: { skills: [], positions: [] } } } })
    expect(raw(h).seats[0]).toMatchObject({ gear: 'standard', max_gear: 'standard' })
  })

  it('start_position 是單人姿勢的 id：查得到就用，查不到用第一個', () => {
    expect(raw(alone({}, { start_position: 'solo_side' })).position).toBe('solo_side')
    expect(raw(alone({}, { start_position: 'pos_face' })).position).toBe('solo_spread')
    expect(raw(alone({}, { start_position: 'pos_face' })).used_positions).toEqual(['solo_spread'])
  })

  it('已經有一場在進行時開不起來；活動只放行 commit:scene.', () => {
    const g = alone()
    expect(startProblems(g.k, g.state, solo()).problems.join('')).toMatch(/已經有一場/)
  })
})

// ======================================================================
describe('加快與放慢（取代主導與迎合）', () => {
  it('加快 2 點：自己感載 2d6、節奏 +8；放慢 1 點：自己感載 −1d6、節奏 +3（固定骰子）', () => {
    const g = alone()
    const r = act(g, { kind: 'faster' }, { dice: dice(3, 4) })[0]!
    expect(r.action).toBe('scene.act')
    expect(raw(g).seats[0]!.ap).toBe(2)
    expect(load(g)).toBe(7)
    expect(raw(g).pace).toBe(38)
    expect(r.timeline[0]!.data).toMatchObject({ my_load: 7, pace: 8 })
    expect(r.timeline[0]!.text).not.toMatch(/\d/)
    const r2 = act(g, { kind: 'slower' }, { dice: dice(5) })[0]!
    expect(raw(g).seats[0]!.ap).toBe(1)
    expect(load(g)).toBe(2)
    expect(raw(g).pace).toBe(41)
    expect(r2.timeline[0]!.data).toMatchObject({ my_load: -5, pace: 3 })
  })

  it('受到的感載照常乘敏感度與餘韻：敏感度 100 的主角加快 2d6（骰 3、4）受到 round(7 × 1.25)；餘韻一層節奏與感載各 +10%', () => {
    const g = alone({ tweak: { ext: { bridge: bridge(100, 10), scene: { skills: [], positions: [] } } } })
    act(g, { kind: 'faster' }, { dice: dice(3, 4) })
    expect(load(g)).toBe(Math.round(7 * 1.25))
    const h = alone()
    h.state.actors.pc!.afterglow = 1
    act(h, { kind: 'faster' }, { dice: dice(3, 4) })
    expect(load(h)).toBe(Math.round(7 * 1.1))
    expect(raw(h).pace).toBe(30 + Math.round(8 * 1.1))
  })

  it('沒有主導、迎合、挑逗、換圈、叫人，沒有主動權的任何欄位；送出去被擋並有原因', () => {
    const g = alone()
    expect(blocked(() => act(g, { kind: 'dominate' }))).toMatch(/單人沒有主導與迎合/)
    expect(blocked(() => act(g, { kind: 'yield' }))).toMatch(/單人沒有主導與迎合/)
    expect(blocked(() => act(g, { kind: 'tease' }))).toMatch(/沒有對象可以挑逗/)
    expect(blocked(() => act(g, { kind: 'move_circle', circle: 'c1' }))).toMatch(/沒有別的圈/)
    expect(blocked(() => act(g, { kind: 'call', who: 'npc_ann' }))).toMatch(/沒有別的圈/)
    expect(raw(g)).not.toHaveProperty('partner')
    expect(raw(g).pairs).toEqual({})
    expect(sceneOptions(g.k, g.state)!.actions.map((a) => a.id)).toEqual(['faster', 'slower', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear', 'stop'])
    // 一對一的場景沒有加快與放慢
    const h = game()
    begin(h, { with: ['npc_ann'], nature: 'mutual', mode: 'full' })
    expect(blocked(() => act(h, { kind: 'faster' }))).toMatch(/只有單人的場景才有加快與放慢/)
  })

  it('行動點不夠時加快被擋；克制照舊（感載 −（2＋意志調整值））', () => {
    const g = alone()
    raw(g).seats[0]!.ap = 1
    expect(blocked(() => act(g, { kind: 'faster' }))).toMatch(/行動點不夠/)
    raw(g).seats[0]!.ap = 4
    g.state.actors.pc!.load = 10
    const n = -actionOf(g, 'restrain').preview!.my_load!.min
    expect(n).toBeGreaterThanOrEqual(2)
    act(g, { kind: 'restrain' })
    expect(load(g)).toBe(10 - n)
    expect(raw(g).seats[0]!.restrained).toBe(true)
  })

  it('規則表的 solo 可以被資料蓋掉（加快的節奏 +20）；格式不對的回報問題', () => {
    const g = alone({ rules: { solo: { faster: { pace: 20, load: '1d6' } }, cost: { faster: 1 } } })
    act(g, { kind: 'faster' }, { dice: dice(2) })
    expect(raw(g).pace).toBe(50)
    expect(raw(g).seats[0]!.ap).toBe(3)
    expect(load(g)).toBe(2)
    expect(sceneRules(g.k).solo.insight_mult).toBe(0.5)
    expect(ruleProblems({ solo: { insight_mult: 'x' } })).toEqual(['solo.insight_mult 要是數字'])
    expect(ruleProblems({ solo: { faster: { load: 'x' } } }).join('')).toMatch(/solo\.faster\.load 要是骰/)
    expect(ruleProblems({ solo: { nothing: 1 } }).join('')).toMatch(/沒有這個規則/)
  })
})

// ======================================================================
describe('單人姿勢（五個）', () => {
  it('內建五個：張腿仰躺、跪姿、趴伏翹臀、跨坐抱枕、側躺；選項裡列得出來，原因是空的', () => {
    expect(DEFAULT_SOLO_POSES.map((x) => x.name)).toEqual(['張腿仰躺', '跪姿', '趴伏翹臀', '跨坐抱枕', '側躺'])
    const g = alone()
    const opt = actionOf(g, 'switch')
    expect(opt.choices!.map((c) => c.name)).toEqual(['張腿仰躺', '跪姿', '趴伏翹臀', '跨坐抱枕', '側躺'])
    expect(opt.ap).toBe(1)
    expect(sceneView(g.k, g.state)!.positions.map((x) => x.id)).toEqual(['solo_spread', 'solo_kneel', 'solo_prone', 'solo_straddle', 'solo_side'])
  })

  it('切換姿勢花 1 點、不用主動權、連接全部重置；換到現在這個姿勢被擋；沒有這個姿勢被擋；用過的姿勢記下來', () => {
    const g = alone()
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(3) })
    expect(raw(g).links).toHaveLength(1)
    const r = act(g, { kind: 'switch', position: 'solo_kneel' })[0]!
    expect(raw(g).position).toBe('solo_kneel')
    expect(raw(g).links).toEqual([])
    expect(raw(g).seats[0]!.ap).toBe(2)
    expect(r.timeline[0]!.text).toMatch(/換成跪姿/)
    expect(raw(g).used_positions).toEqual(['solo_spread', 'solo_kneel'])
    expect(blocked(() => act(g, { kind: 'switch', position: 'solo_kneel' }))).toMatch(/已經是這個姿勢/)
    expect(blocked(() => act(g, { kind: 'switch', position: 'pos_face' }))).toMatch(/沒有這個姿勢/)
    expect(blocked(() => act(g, { kind: 'switch', position: 'nope' }))).toMatch(/沒有這個姿勢/)
  })

  it('碰得到：張腿仰躺碰不到後；跪姿前後都碰得到、可以同時各接一條；趴伏翹臀的前要用手才碰得到', () => {
    const g = alone()
    // 張腿仰躺：手接後碰不到
    const back = choiceOf(g, 'skill', 'nt_back')
    expect(back.pairs.find((x) => x.my_part === 'hand_l' && x.their_part === 'back')!.blocks.join('')).toMatch(/碰不到/)
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_back', pick: parts('hand_l', 'back') }))).toMatch(/張腿仰躺碰不到/)
    // 跪姿：前後各接一條
    act(g, { kind: 'switch', position: 'solo_kneel' })
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(1) })
    act(g, { kind: 'skill', id: 'nt_back', pick: parts('hand_l', 'back') }, { dice: dice(1) })
    // 同一個部位同時只有一條：第二條用了左手，第一條（左手）被換掉
    expect(raw(g).links.map((l) => l.theirs)).toEqual(['back'])
    const h = alone({}, { start_position: 'solo_kneel' })
    act(h, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(1) })
    act(h, { kind: 'skill', id: 'nt_back', pick: parts('hand_r', 'back') }, { dice: dice(1) })
    expect(raw(h).links.map((l) => `${l.mine}→${l.theirs}`)).toEqual(['hand_l→front', 'hand_r→back'])
    // 趴伏翹臀：前要用手
    const p = alone({}, { start_position: 'solo_prone' })
    const front = choiceOf(p, 'skill', 'nt_ok')
    expect(front.pairs.find((x) => x.my_part === 'hand_l' && x.their_part === 'front')!.blocks).toEqual([])
    expect(front.pairs.find((x) => x.my_part === 'hand_l' && x.their_part === 'chest')!.blocks.join('')).toMatch(/碰不到/)
  })

  it('自己的部位不能接自己同一個部位；技能可以限定在某個姿勢（單人姿勢的 id 寫進 positions）', () => {
    const g = alone()
    expect(choiceOf(g, 'skill', 'nt_pose').blocks.join('')).toMatch(/跪姿才用得出來，現在是張腿仰躺/)
    act(g, { kind: 'switch', position: 'solo_kneel' })
    expect(choiceOf(g, 'skill', 'nt_pose').blocks).toEqual([])
  })

  it('每個姿勢的效果：趴伏翹臀感載倍率 1.1；張腿仰躺前有連接每回合節奏 +1；跨坐抱枕自己帶一條連接（不掉節奏、每回合 1d3 感載與節奏 +1）；跪姿每回合感載 +1；趴伏的後有連接節奏 +1', () => {
    // 倍率：趴伏 1.1（加快 7 → 7.7 → 8）
    const p = alone({}, { start_position: 'solo_prone' })
    act(p, { kind: 'faster' }, { dice: dice(3, 4) })
    expect(load(p)).toBe(Math.round(7 * 1.1))
    // 張腿仰躺：前的連接，每回合節奏 +1（連接的 fit 2 另算）
    const s = alone()
    act(s, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(1) })
    expect(raw(s).pace).toBe(33)
    act(s, { kind: 'end_turn' }, { dice: dice(1) })
    expect(raw(s).pace).toBe(33 + 2 + 1)
    // 趴伏翹臀：後的連接 +1
    act(p, { kind: 'skill', id: 'nt_back', pick: parts('hand_l', 'back') }, { dice: dice(1) })
    const before = raw(p).pace!
    act(p, { kind: 'end_turn' }, { dice: dice(1) })
    expect(raw(p).pace).toBe(before + 0 + 1)
    // 跪姿：每回合自己感載 +1（沒有連接，節奏 −3）
    const k = alone({}, { start_position: 'solo_kneel' })
    act(k, { kind: 'end_turn' })
    expect(load(k)).toBe(0)
    expect(raw(k).pace).toBe(27)
    expect(raw(k).round).toBe(2)
    // 跨坐抱枕：沒有任何連接也不掉節奏；每回合 1d3 感載與節奏 +1
    const c = alone({}, { start_position: 'solo_straddle' })
    act(c, { kind: 'end_turn' }, { dice: dice(2) })
    expect(raw(c).pace).toBe(31)
    expect(load(c)).toBe(0)
  })

  it('跨坐抱枕：自己的感載 +1d3 真的算進去（decay 之前）；跪姿 +1 也一樣', () => {
    const c = alone({}, { start_position: 'solo_straddle' })
    c.state.actors.pc!.load = 10
    act(c, { kind: 'end_turn' }, { dice: dice(3) })
    // 10 + 3 − 2（自然消退）
    expect(load(c)).toBe(11)
    const k = alone({}, { start_position: 'solo_kneel' })
    k.state.actors.pc!.load = 10
    act(k, { kind: 'end_turn' })
    expect(load(k)).toBe(9)
  })

  it('側躺：加快的感載減 1d6 的一半、放慢的節奏多 +1、節奏掉的時候少掉一半', () => {
    const g = alone({}, { start_position: 'solo_side' })
    // 加快：2d6 = 3＋4，再擲 1d6 = 5 → 減 floor(5 ÷ 2) = 2 → 5
    act(g, { kind: 'faster' }, { dice: dice(3, 4, 5) })
    expect(load(g)).toBe(5)
    expect(raw(g).pace).toBe(38)
    act(g, { kind: 'slower' }, { dice: dice(1) })
    expect(raw(g).pace).toBe(38 + 3 + 1)
    // 沒有連接：−3 的一半（四捨五入 2）；高潮 −10 的一半
    act(g, { kind: 'end_turn' })
    expect(raw(g).pace).toBe(42 - 2)
    g.state.actors.pc!.load = 33
    act(g, { kind: 'faster' }, { dice: dice(6, 6, 1) })
    expect(raw(g).seats[0]!.climax).toBe(1)
    // 高潮 −5；高潮疊了一層餘韻，加快的節奏照餘韻加成 round(8 × 1.1) = 9
    expect(raw(g).pace).toBe(40 - 5 + 9)
  })

  it('姿勢可以由資料換掉或多一個（solo_pose）；格式不對的載入就丟錯', () => {
    const extra: ContentPack = { id: 'poses', content: { solo_pose: [{ id: 'solo_spread', name: '大字形', reach: ['back'], hand_only: [], mult: 2, link_pace: {} }, { id: 'solo_new', name: '新姿勢', reach: ['front'], mult: 1 }] } }
    const g = alone({ content: [extra] })
    expect(sceneView(g.k, g.state)!.positions.map((x) => x.name)).toEqual(['大字形', '跪姿', '趴伏翹臀', '跨坐抱枕', '側躺', '新姿勢'])
    act(g, { kind: 'faster' }, { dice: dice(3, 4) })
    expect(load(g)).toBe(14)
    const bad: ContentPack = { id: 'bad', content: { solo_pose: [{ id: 'x', name: '壞的', reach: 'front', mult: 0 }] } }
    expect(() => game({ content: [bad] })).toThrow()
  })
})

// ======================================================================
describe('技能與道具（單人：自己的部位接自己的部位）', () => {
  it('solo: ok 的技能建立一條自己接自己的連接；用出去那一下原本給對方的感載算在自己身上、給自己的那一份不算、契合算成節奏、主動權不算', () => {
    const g = alone()
    const r = act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(4) })[0]!
    expect(load(g)).toBe(4)
    expect(raw(g).pace).toBe(33)
    expect(raw(g).seats[0]!.ap).toBe(3)
    expect(raw(g).links).toHaveLength(1)
    expect(raw(g).links[0]).toMatchObject({ by: 'pc', to: 'pc', kind: 'skill', source: 'nt_ok', mine: 'hand_l', theirs: 'front', link: { my_load: 0, their_load: '1d6', fit: 2 } })
    expect(r.timeline[0]!.data).toMatchObject({ id: 'nt_ok', my_load: 4, pace: 3, my_part: 'hand_l', their_part: 'front' })
    expect(r.timeline[0]!.data).not.toHaveProperty('init')
    expect(r.timeline[0]!.text).toMatch(/接上自己的前/)
    expect(r.timeline[0]!.text).not.toMatch(/\d/)
  })

  it('下一回合自動生效在自己身上、節奏有加（連接的 fit 與張腿仰躺的前連接 +1）；連接的 my_load 不算', () => {
    const g = alone()
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(4) })
    // 結算：連接 1d6 = 5 → 感載 4 + 5 = 9；節奏 33 + 2（連接）+ 1（張腿仰躺的前）= 36；自然消退 −2
    const r = act(g, { kind: 'end_turn' }, { dice: dice(5) })[0]!
    expect(load(g)).toBe(7)
    expect(raw(g).pace).toBe(36)
    expect(raw(g).round).toBe(2)
    expect(raw(g).seats[0]!.ap).toBe(Math.min(4, 3 + 3))
    expect(r.timeline.some((b) => b.tag === 'round')).toBe(true)
  })

  it('精簡版：技能只選技能，部位由程式挑（姿勢碰得到的）；換姿勢之後自動接回', () => {
    const g = game()
    begin(g, { solo: true, mode: 'simple' })
    act(g, { kind: 'skill', id: 'nt_ok' }, { dice: dice(2) })
    expect(raw(g).links).toHaveLength(1)
    const first = raw(g).links[0]!
    expect(['hand_l', 'hand_r']).toContain(first.mine)
    act(g, { kind: 'switch', position: 'solo_side' })
    expect(raw(g).position).toBe('solo_side')
    expect(raw(g).links).toHaveLength(1)
    expect(raw(g).links[0]).toMatchObject({ by: 'pc', to: 'pc', source: 'nt_ok' })
  })

  it('沒寫 solo 的技能灰掉：這個要有對象。；audience 的在沒有觀眾時灰掉：這個要有人在看。；一對一的場景不受影響', () => {
    const g = alone()
    expect(choiceOf(g, 'skill', 'nt_none').blocks).toEqual(['這個要有對象。'])
    expect(choiceOf(g, 'skill', 'nt_aud').blocks).toEqual(['這個要有人在看。'])
    expect(choiceOf(g, 'skill', 'nt_ok').blocks).toEqual([])
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_none', pick: parts('mouth', 'mouth') }))).toBe('這個要有對象。')
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_aud', pick: parts('hand_r', 'chest') }))).toBe('這個要有人在看。')
    expect(raw(g).links).toEqual([])
    expect(raw(g).seats[0]!.ap).toBe(4)
    expect(actionOf(g, 'skill').blocks).toEqual([])
    // 一對一
    const h = game()
    begin(h, { with: ['npc_ann'], nature: 'mutual', mode: 'full' })
    expect(sceneOptions(h.k, h.state)!.actions.find((a) => a.id === 'skill')!.choices!.find((c) => c.id === 'nt_none')!.blocks.join('')).not.toMatch(/要有對象|要有人在看/)
  })

  it('audience: true 的場景用得出來要有人在看的技能與道具', () => {
    const g = alone({}, { audience: true })
    expect(raw(g).audience).toBe(true)
    expect(choiceOf(g, 'skill', 'nt_aud').blocks).toEqual([])
    act(g, { kind: 'skill', id: 'nt_aud', pick: parts('hand_r', 'chest') }, { dice: dice(3) })
    expect(raw(g).links[0]).toMatchObject({ source: 'nt_aud', mine: 'hand_r', theirs: 'chest' })
    expect(load(g)).toBe(3)
    g.state.inventory.push({ id: 'it_cam', qty: 1 })
    expect(choiceOf(g, 'item', 'it_cam').blocks).toEqual([])
    const h = alone()
    h.state.inventory.push({ id: 'it_cam', qty: 1 }, { id: 'it_cuff', qty: 1 })
    expect(choiceOf(h, 'item', 'it_cam').blocks).toEqual(['這個要有人在看。'])
    expect(choiceOf(h, 'item', 'it_cuff').blocks).toEqual(['這個要有對象。'])
  })

  it('沒學會的技能照舊說沒學會；查不到的技能說沒有這個技能', () => {
    const g = alone({ skills: ['nt_ok'] })
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_aud', pick: parts('hand_r', 'chest') }))).toMatch(/還沒有學會/)
    expect(blocked(() => act(g, { kind: 'skill', id: 'nope' }))).toMatch(/沒有這個技能/)
  })

  it('道具的連接可以用：脈衝環（as_part toy）接自己的前，沒寫 solo 的道具預設可以；玩具不消耗', () => {
    const g = alone()
    g.state.inventory.push({ id: 'it_toy', qty: 1 })
    expect(choiceOf(g, 'item', 'it_toy').blocks).toEqual([])
    act(g, { kind: 'item', id: 'it_toy', pick: parts('toy', 'front') }, { dice: dice(3) })
    expect(load(g)).toBe(3)
    expect(raw(g).pace).toBe(32)
    expect(raw(g).links[0]).toMatchObject({ by: 'pc', to: 'pc', kind: 'item', source: 'it_toy', mine: 'toy', theirs: 'front' })
    expect(g.state.inventory.find((x) => x.id === 'it_toy')!.qty).toBe(1)
    // 同一個部位只有一條：再接一條前會換掉
    act(g, { kind: 'item', id: 'it_toy', pick: parts('toy', 'front') }, { dice: dice(1) })
    expect(raw(g).links).toHaveLength(1)
    // 自己的手在張腿仰躺碰得到，道具也接得到後之外的部位；後碰不到
    expect(choiceOf(g, 'item', 'it_toy').pairs.find((x) => x.their_part === 'back')!.blocks.join('')).toMatch(/碰不到/)
  })

  it('藥照樣用：冷靜貼片減自己的感載、用掉一片；沒有身上的東西被擋', () => {
    const g = alone()
    g.state.inventory.push({ id: 'it_calm', qty: 2 })
    act(g, { kind: 'faster' }, { dice: dice(5, 6) })
    expect(load(g)).toBe(11)
    act(g, { kind: 'item', id: 'it_calm' }, { dice: dice(4) })
    expect(load(g)).toBe(7)
    expect(g.state.inventory.find((x) => x.id === 'it_calm')!.qty).toBe(1)
    expect(raw(g).links).toEqual([])
    expect(blocked(() => act(g, { kind: 'item', id: 'it_toy', pick: parts('toy', 'front') }))).toMatch(/你身上沒有/)
  })

  it('道具的自綁類（solo: no）灰掉；整場跑完之後行動點、連接的內容不外漏任何「對方」', () => {
    const g = alone()
    g.state.inventory.push({ id: 'it_cuff', qty: 1 })
    expect(blocked(() => act(g, { kind: 'item', id: 'it_cuff', pick: parts('toy', 'hand_l') }))).toBe('這個要有對象。')
    const v = sceneView(g.k, g.state)!
    expect(v.kind).toBe('solo')
    expect(v.pairs).toEqual({})
    expect(v.away).toEqual([])
  })

  it('帶標籤的技能：要有傾向標籤才用得出來；第一次碰標籤體悟加成', () => {
    const g = alone()
    expect(choiceOf(g, 'skill', 'nt_tag').blocks.join('')).toMatch(/要有「支配」的標籤/)
    g.state.actors.pc!.ext.tendency = { axes: {}, points: {}, tags: { tg_dom: 'has' } }
    expect(choiceOf(g, 'skill', 'nt_tag').blocks).toEqual([])
  })
})

// ======================================================================
describe('說話（對觀眾說）', () => {
  it('沒有觀眾時灰掉：沒有人在聽。；有觀眾時照現有的檢定，契合的變化算成節奏，不建立連接、不加目的的進度', () => {
    const g = alone()
    expect(actionOf(g, 'talk').blocks).toEqual(['沒有人在聽。'])
    expect(blocked(() => act(g, { kind: 'talk' }))).toBe('沒有人在聽。')
    const h = alone({}, { audience: true })
    expect(actionOf(h, 'talk').blocks).toEqual([])
    expect(actionOf(h, 'talk').picks).toEqual([])
    const r = act(h, { kind: 'talk', text: '大家好' }, { dice: dice(20) })[0]!
    // 擲出 20 是大成功：契合 +10 → 節奏 +10；沒有連接
    expect(raw(h).pace).toBe(40)
    expect(raw(h).links).toEqual([])
    expect(raw(h).seats[0]!.ap).toBe(3)
    expect(r.timeline[0]!.data).toMatchObject({ pace: 10, degree: 'critical' })
    expect(r.input).toBe('大家好')
    expect(r.timeline[0]!.text).not.toMatch(/\d/)
  })

  it('scene_talk 給的結果（env.talk）：節奏夾在 −5～+10', () => {
    const g = alone({}, { audience: true })
    act(g, { kind: 'talk' }, { talk: { fit: 30 } })
    expect(raw(g).pace).toBe(40)
    act(g, { kind: 'talk' }, { talk: { fit: -30 } })
    expect(raw(g).pace).toBe(35)
  })
})

// ======================================================================
describe('回合與強制結束', () => {
  it('主角行動完就是連接的自動效果與下一回合：沒有輪到別人（sceneNext 被擋）；行動點用完自動結算並回行動點', () => {
    const g = alone()
    act(g, { kind: 'faster' }, { dice: dice(1, 1) })
    expect(blocked(() => next(g))).toMatch(/還沒輪到對方/)
    act(g, { kind: 'faster' }, { dice: dice(1, 1) })
    // 行動點用完：回合結算、第二回合，每個人回 3 點
    expect(raw(g).round).toBe(2)
    expect(raw(g).seats[0]!.ap).toBe(3)
    expect(raw(g).turn).toBe('pc')
  })

  it('節奏掉的時候：這一回合沒有任何連接，節奏 −3（有連接就不掉）；自己高潮，節奏 −10', () => {
    const g = alone()
    const r = act(g, { kind: 'end_turn' })[0]!
    expect(raw(g).pace).toBe(27)
    expect(r.timeline.some((b) => b.tag === 'pace')).toBe(true)
    // 有連接不掉
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'chest') }, { dice: dice(1) })
    const before = raw(g).pace!
    act(g, { kind: 'end_turn' }, { dice: dice(1) })
    expect(raw(g).pace).toBe(before + 2)
    // 高潮：加快讓感載滿了
    const h = alone()
    h.state.actors.pc!.load = 30
    act(h, { kind: 'faster' }, { dice: dice(6, 6) })
    expect(raw(h).seats[0]!.climax).toBe(1)
    expect(load(h)).toBe(0)
    // 高潮 −10，之後的加快節奏照新疊的一層餘韻算：round(8 × 1.1) = 9
    expect(raw(h).pace).toBe(30 - 10 + 9)
    expect(h.state.actors.pc!.afterglow).toBe(1)
  })

  it('餘韻疊滿之後又高潮：場景結束、原因是失神', () => {
    const g = alone()
    g.state.actors.pc!.afterglow = 3
    g.state.actors.pc!.load = 30
    const rs = act(g, { kind: 'faster' }, { dice: dice(6, 6, 50, 1) })
    const end = rs.find((r) => r.action === 'scene.end')!
    expect(end.outcome.result).toBe('pc_out')
    expect(end.timeline.some((b) => b.tag === 'out')).toBe(true)
    expect(sceneRawOf(g.state)).toBeNull()
    expect(g.state.actors.pc!.load).toBe(0)
  })

  it('節奏掉到 10 以下而且已經過了三回合：自己沒了興致（原因 bored）；三回合之前不會', () => {
    const g = alone()
    raw(g).pace = 5
    const r1 = act(g, { kind: 'end_turn' })
    expect(r1[0]!.action).toBe('scene.act')
    expect(raw(g).pace).toBe(2)
    act(g, { kind: 'end_turn' })
    const rs = act(g, { kind: 'end_turn' })
    const end = rs.find((r) => r.action === 'scene.end')!
    expect(end.outcome.result).toBe('bored')
    expect(end.timeline.some((b) => b.tag === 'quit')).toBe(true)
    expect(end.outcome.summary).toMatch(/你沒了興致/)
    // 節奏高的不會
    const h = alone()
    for (let i = 0; i < 3; i++) act(h, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(1) }), act(h, { kind: 'end_turn' }, { dice: dice(1) })
    expect(sceneRawOf(h.state)).not.toBeNull()
  })

  it('max_rounds：到了回合數就被打斷（原因 interrupted）；外面來的打斷照舊走結算', () => {
    const g = alone({}, { max_rounds: 2 })
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(1) })
    act(g, { kind: 'end_turn' }, { dice: dice(1) })
    expect(sceneRawOf(g.state)).not.toBeNull()
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(1) })
    const rs = act(g, { kind: 'end_turn' }, { dice: dice(1) })
    expect(rs.find((r) => r.action === 'scene.end')!.outcome.result).toBe('interrupted')
  })
})

// ======================================================================
describe('換檔（同步）', () => {
  it('換檔照舊：深檔受到的感載倍率生效（×1.5）；每回合一次；標準檔回來；不花行動點', () => {
    const g = alone({ tweak: { skills: { sync: 3 }, ext: { bridge: bridge(50, 10), scene: { skills: [], positions: [] } } } })
    const opt = actionOf(g, 'gear')
    expect(opt.choices!.map((c) => c.id)).toEqual(['shallow', 'standard', 'deep', 'full'])
    expect(opt.choices!.find((c) => c.id === 'deep')!.blocks).toEqual([])
    expect(opt.choices!.find((c) => c.id === 'full')!.blocks.join('')).toMatch(/同步要 5 級/)
    act(g, { kind: 'gear', gear: 'deep' })
    expect(raw(g).seats[0]!.gear).toBe('deep')
    expect(raw(g).seats[0]!.ap).toBe(4)
    act(g, { kind: 'faster' }, { dice: dice(3, 4) })
    expect(load(g)).toBe(Math.round(7 * 1.5))
    expect(blocked(() => act(g, { kind: 'gear', gear: 'standard' }))).toMatch(/換過檔/)
  })

  it('淺檔受到的感載 ×0.5（任何人都開得了）', () => {
    const g = alone()
    const shallow = actionOf(g, 'gear').choices!.find((c) => c.id === 'shallow')!
    expect(shallow.blocks).toEqual([])
    act(g, { kind: 'gear', gear: 'shallow' })
    act(g, { kind: 'faster' }, { dice: dice(3, 4) })
    expect(load(g)).toBe(Math.round(7 * 0.5))
  })
})

// ======================================================================
describe('結算', () => {
  const record = (g: Game) => g.state.actors.pc!.ext.sex_record as Record<string, unknown> | undefined

  it('按停下：評價照節奏、體悟是那一級的一半（進位）、主角對任何人的親密度沒有變、solo_times +1、性經歷的次數與對象人數沒變、沉溺沒變', () => {
    const c = collector()
    const g = alone({ features: [c.feature] })
    g.state.actors.pc!.ext.sex_record = { partners: 2, times: 5, service_times: 1, people: { npc_ann: 3, npc_bo: 2 }, positions: [], tags: [], solo_poses: ['solo_spread'] }
    g.state.meters.affinity = { npc_ann: 40 }
    const sinkBefore = g.state.actors.pc!.sink
    raw(g).pace = 65
    const rs = act(g, { kind: 'stop' })
    const end = rs[0]!
    expect(end.action).toBe('scene.end')
    expect(end.outcome.result).toBe('stop')
    // 合拍（60～84）體悟 15 → 八（進位）；這個姿勢以前用過、沒有碰到標籤
    expect(g.state.meters.insight!._).toBe(8)
    expect(g.state.meters.affinity!.npc_ann).toBe(40)
    expect(end.changes.some((x) => x.op === 'meter' && (x as { kind?: string }).kind === 'affinity')).toBe(false)
    expect(record(g)).toMatchObject({ times: 5, partners: 2, service_times: 1, people: { npc_ann: 3, npc_bo: 2 }, solo_times: 1, solo_poses: ['solo_spread'] })
    expect(g.state.actors.pc!.sink).toBe(sinkBefore)
    expect(g.state.actors.npc_ann!.ext.sex_record).toBeUndefined()
    expect(sceneRawOf(g.state)).toBeNull()
    expect(c.heard[0]).toMatchObject({ solo: true, pace: 65, rating: '合拍', reason: 'stop', goal_done: false, audience: false })
    expect(c.heard[0]).not.toHaveProperty('with')
    expect(c.heard[0]).not.toHaveProperty('fit')
    expect(end.narration!.results!.join('')).toMatch(/節奏 65：合拍/)
    expect(end.narration!.results!.join('')).toMatch(/體悟 \+8/)
  })

  it('評價用同一張表：節奏 10 不合 5→3、40 普通 10→5、90 難忘 20→10；第一次用某個姿勢、第一次碰某個標籤照加（不打折）；solo_times 累加', () => {
    const run = (pace: number, setup: (g: Game) => void = () => {}) => {
      const g = alone()
      setup(g)
      raw(g).pace = pace
      act(g, { kind: 'stop' })
      return g
    }
    expect(run(10).state.meters.insight!._).toBe(3 + 5)
    expect(run(40, (g) => { g.state.actors.pc!.ext.sex_record = { partners: 0, times: 0, service_times: 0, people: {}, positions: [], tags: [], solo_poses: ['solo_spread'] } }).state.meters.insight!._).toBe(5)
    expect(run(90, (g) => { g.state.actors.pc!.ext.sex_record = { partners: 0, times: 0, service_times: 0, people: {}, positions: [], tags: [], solo_poses: ['solo_spread'] } }).state.meters.insight!._).toBe(10)
    // 第一次用姿勢：開場的姿勢算一次，換過去的也算
    const g = alone()
    act(g, { kind: 'switch', position: 'solo_kneel' })
    raw(g).pace = 40
    act(g, { kind: 'stop' })
    expect(g.state.meters.insight!._).toBe(5 + 5 + 5)
    expect(record(g)!.solo_poses).toEqual(['solo_spread', 'solo_kneel'])
    // 第二場：用過了就不再加
    begin(g)
    expect(raw(g).used_positions).toEqual(['solo_spread'])
    raw(g).pace = 40
    act(g, { kind: 'stop' })
    expect(g.state.meters.insight!._).toBe(15 + 5)
    expect(record(g)!.solo_times).toBe(2)
    expect(record(g)!.times).toBe(0)
  })

  it('第一次碰某個標籤：體悟 +5、傾向照碰到的標籤加、記進性經歷的標籤；沒有「第一次和這個人」', () => {
    const g = alone({}, { tags: ['tg_dom'] })
    g.state.actors.pc!.ext.sex_record = { partners: 0, times: 0, service_times: 0, people: {}, positions: [], tags: [], solo_poses: ['solo_spread'] }
    raw(g).pace = 40
    const end = act(g, { kind: 'stop' })[0]!
    expect(g.state.meters.insight!._).toBe(5 + 5)
    expect(end.narration!.results!.join('')).toMatch(/第一次碰「支配」/)
    expect(end.narration!.results!.join('')).not.toMatch(/第一次和這個人/)
    expect(record(g)!.tags).toEqual(['tg_dom'])
    // 再來一場：標籤用過了
    begin(g, solo({ tags: ['tg_dom'] }))
    raw(g).pace = 40
    act(g, { kind: 'stop' })
    expect(g.state.meters.insight!._).toBe(10 + 5)
  })

  it('橋參數那一點照評價的機率落在主角自己：合拍 25%、難忘 50%（只擲機率；哪一項看這一場，沒有特別的是慾求）；普通沒有；略過沒有', () => {
    const run = (pace: number, rolls: number[]) => {
      const g = alone()
      raw(g).pace = pace
      act(g, { kind: 'stop' }, { dice: dice(...rolls) })
      return g.state.actors.pc!.ext.bridge as Record<string, number>
    }
    expect(run(65, [25]).craving).toBe(31)
    expect(run(65, [26])).toEqual(bridge(50, 10))
    expect(run(90, [50]).craving).toBe(31)
    expect(run(90, [51])).toEqual(bridge(50, 10))
    expect(run(40, [1])).toEqual(bridge(50, 10))
    const g = alone()
    g.commit(sceneSkip(g.k, g.state, { dice: dice(20) }))
    expect(g.state.actors.pc!.ext.bridge).toEqual(bridge(50, 10))
  })

  it('沉溺的規則退路是 0；全檔過載累積的那一份照舊在結算時加', () => {
    const g = alone()
    raw(g).seats[0]!.sink_gain = 3
    const rs = act(g, { kind: 'stop' })
    expect(rs[0]!.changes.filter((c) => c.op === 'actor.track' && (c as { track?: string }).track === 'sink')).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 3 }])
    const h = alone()
    const rs2 = act(h, { kind: 'stop' })
    expect(rs2[0]!.changes.some((c) => c.op === 'actor.track' && (c as { track?: string }).track === 'sink')).toBe(false)
  })

  it('餘韻帶著走、感載歸零', () => {
    const g = alone()
    act(g, { kind: 'faster' }, { dice: dice(3, 4) })
    g.state.actors.pc!.afterglow = 2
    raw(g).pace = 40
    // 場景裡的餘韻由報告帶出去：結束時 afterglow 不變、感載歸零
    act(g, { kind: 'stop' })
    expect(load(g)).toBe(0)
    expect(g.state.actors.pc!.afterglow).toBe(2)
  })

  it('goal: footage：節奏到過 goal_done_at 算達成（70 → true；節奏低 → false；達成之後掉下來也算）', () => {
    const c = collector()
    const g = alone({ features: [c.feature] }, { goal: 'footage' })
    expect(raw(g).goal).toBe('footage')
    expect(raw(g).goal_progress).toBe(0)
    raw(g).pace = 70
    act(g, { kind: 'stop' })
    expect(c.heard[0]).toMatchObject({ goal: 'footage', goal_done: true })
    const rs = collector()
    const h = alone({ features: [rs.feature] }, { goal: 'footage' })
    act(h, { kind: 'stop' })
    expect(rs.heard[0]).toMatchObject({ goal: 'footage', goal_done: false })
    // 過程中到過 60，後面掉下來
    const t = collector()
    const m = alone({ features: [t.feature] }, { goal: 'footage' })
    act(m, { kind: 'faster' }, { dice: dice(1, 1) })
    raw(m).pace = 61
    act(m, { kind: 'faster' }, { dice: dice(1, 1) })
    expect(raw(m).goal_progress).toBeGreaterThanOrEqual(60)
    raw(m).pace = 20
    act(m, { kind: 'stop' })
    expect(t.heard[0]).toMatchObject({ goal_done: true })
    expect(sceneView(g.k, g.state)).toBeNull()
  })

  it('沒有目的的場景 goal_done 是 false；結果的記號：solo、pace、rating、audience、goal_done', () => {
    const c = collector()
    const g = alone({ features: [c.feature] }, { audience: true })
    raw(g).pace = 90
    act(g, { kind: 'stop' })
    expect(c.heard[0]).toMatchObject({ solo: true, pace: 90, rating: '難忘', audience: true, goal: null, goal_done: false, reason: 'stop' })
  })

  it('略過：節奏＝基底 35 加亂數 0～20（沒有對象的幾項不算），體悟再打七折；不給用過的姿勢；不給橋參數', () => {
    const c = collector()
    const g = alone({ features: [c.feature] }, { goal: 'footage' })
    g.state.actors.pc!.ext.sex_record = { partners: 0, times: 0, service_times: 0, people: {}, positions: [], tags: [], solo_poses: [] }
    const r = sceneSkip(g.k, g.state, { dice: dice(10) })
    const end = g.commit(r)[0]!
    expect(end.outcome.result).toBe('skip')
    // 節奏 45：普通 10 → 5；略過不算用過的姿勢；七折 round(3.5) = 4
    expect(c.heard[0]).toMatchObject({ solo: true, pace: 45, rating: '普通', reason: 'skip', goal_done: false })
    expect(g.state.meters.insight!._).toBe(Math.round(5 * 0.7))
    expect(record(g)!.solo_poses).toEqual([])
    expect(record(g)!.solo_times).toBe(1)
    // 已經開始的場景不能略過
    const h = alone()
    act(h, { kind: 'end_turn' })
    expect(() => sceneSkip(h.k, h.state)).toThrow(/只能按「停下」/)
  })

  it('略過拿素材：節奏到了 goal_done_at 算達成（節奏 60 以上）', () => {
    const c = collector()
    const g = alone({ features: [c.feature] }, { goal: 'footage' })
    g.commit(sceneSkip(g.k, g.state, { dice: dice(20) }))
    expect(c.heard[0]).toMatchObject({ pace: 55, goal_done: false })
    const c2 = collector()
    const h = alone({ features: [c2.feature], rules: { solo: { skip: { base: 60 } } } }, { goal: 'footage' })
    h.commit(sceneSkip(h.k, h.state, { dice: dice(1) }))
    expect(c2.heard[0]).toMatchObject({ pace: 61, goal_done: true })
  })

  it('被外面打斷也走單人的結算', () => {
    const c = collector()
    const g = alone({ features: [c.feature] })
    raw(g).pace = 65
    g.commit(sceneActInterrupt(g))
    expect(c.heard[0]).toMatchObject({ solo: true, pace: 65, reason: 'interrupted' })
  })
})

const sceneActInterrupt = (g: Game) => sceneInterrupt(g.k, g.state)

// ======================================================================
describe('畫面資料（sceneView、sceneOptions、預覽）', () => {
  it('sceneView：kind 是 solo、沒有 partner、pairs 是空的、有 pace 與 audience；位置是姿勢；fit 與評價讀節奏', () => {
    const g = alone({}, { audience: true })
    const v = sceneView(g.k, g.state)!
    expect(v).toMatchObject({ kind: 'solo', layer: 'meat', pace: 30, audience: true, pairs: {}, away: [], circles: [], init: 50, holder: 'pc', fit: 30, rating: { id: 'fair', name: '普通' }, nature: 'solo', nature_name: '獨自' })
    expect(Object.keys(v.people)).toEqual(['pc'])
    expect(v.seats.map((x) => x.id)).toEqual(['pc'])
    expect(v.position).toMatchObject({ id: 'solo_spread', name: '張腿仰躺', upper: null })
    expect(Object.keys(v.position.mult)).toEqual(['pc'])
    expect(v.decider).toBe('pc')
    // 部位：張腿仰躺碰得到前、胸、口、腿足，碰不到後
    const reach = Object.fromEntries(v.seats[0]!.parts.map((x) => [x.id, x.reach]))
    expect(reach).toMatchObject({ front: true, chest: true, mouth: true, legs: true, back: false, hand_l: true })
    // 一對一的場景沒有 pace
    const h = game()
    begin(h, { with: ['npc_ann'], nature: 'mutual', mode: 'full' })
    expect(sceneView(h.k, h.state)).not.toHaveProperty('pace')
  })

  it('sceneView 連著的部位與每回合的數字（落在自己身上）；選中的行動有原因與預覽', () => {
    const g = alone()
    act(g, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { dice: dice(4) })
    const v = sceneView(g.k, g.state, { kind: 'faster' })!
    expect(v.links).toHaveLength(1)
    expect(v.links[0]).toMatchObject({ by_id: 'pc', to_id: 'pc', mine: 'hand_l', theirs: 'front', per_round: { target_load: '1d6', my_load: '0', fit: 2, target_avg: 3.5, my_avg: 0 } })
    expect(v.seats[0]!.parts.find((x) => x.id === 'front')!.linked).toBe(true)
    expect(v.seats[0]!.parts.find((x) => x.id === 'hand_l')!.linked).toBe(true)
    expect(v.effects).toMatchObject({ count: 1, fit: 2 })
    expect(v.selected!.blocks).toEqual([])
    expect(v.selected!.preview).toMatchObject({ ap: 2, target_load: null, my_load: { dice: '2d6', mult: 1, min: 2, max: 12, avg: 7 }, fit: 8, init: 0 })
  })

  it('預覽：放慢是負的感載與節奏 +3；技能的預覽是落在自己身上的感載與節奏；說話的節奏範圍；沒有對方', () => {
    const g = alone()
    const slow = actionOf(g, 'slower')
    expect(slow.preview).toMatchObject({ ap: 1, target_load: null, my_load: { dice: '−1d6', min: -6, max: -1 }, fit: 3 })
    const ok = choiceOf(g, 'skill', 'nt_ok')
    expect(ok.preview).toMatchObject({ ap: 1, target_load: null, my_load: { dice: '1d6' }, fit: 3, init: 0, link: true, per_round: { target_load: null, fit: 2 } })
    const talk = actionOf(g, 'talk')
    expect(talk.preview).toMatchObject({ ap: 1, fit: -5, fit_max: 10 })
    expect(sceneOptions(g.k, g.state)!.targets).toEqual([])
    expect(actionOf(g, 'stop').preview).toBeNull()
  })

  it('完整版技能的部位選項寫的是「接自己的哪個部位」；精簡版不用選', () => {
    const g = alone()
    const ok = choiceOf(g, 'skill', 'nt_ok')
    expect(ok.picks.map((x) => x.label)).toEqual(['用你的哪個部位', '接自己的哪個部位'])
    expect(ok.picks.every((x) => x.required)).toBe(true)
    const h = game()
    begin(h, { solo: true, mode: 'simple' })
    expect(choiceOf(h, 'skill', 'nt_ok').picks.every((x) => !x.required)).toBe(true)
  })
})

// ======================================================================
describe('和一對一、多人的場景並存', () => {
  it('一對一的場景照舊：沒有 pace、pairs 有對象、體位照舊；一場結束之後可以接著開單人', () => {
    const g = game()
    begin(g, { with: ['npc_ann'], nature: 'mutual', mode: 'full' })
    expect(raw(g)).toMatchObject({ kind: 'pair', position: 'pos_face' })
    expect(raw(g).pace).toBeUndefined()
    expect(Object.keys(raw(g).pairs)).toEqual(['npc_ann'])
    act(g, { kind: 'stop' })
    expect(sceneRawOf(g.state)).toBeNull()
    begin(g)
    expect(raw(g).kind).toBe('solo')
  })

  it('舊的一對一存檔照舊讀得進來（沒有 pace、audience 欄位）', () => {
    const g = game()
    begin(g, { with: ['npc_ann'], nature: 'mutual', mode: 'full' })
    const s = raw(g)
    expect('audience' in s).toBe(false)
    expect(blocked(() => act(g, { kind: 'faster' }))).toMatch(/只有單人/)
  })
})

// ======================================================================
describe('整場跑得完（固定種子、隨機走）', () => {
  it('隨機走一整場（加快、放慢、技能、道具、換姿勢、換檔、克制、結束回合）：每一步的報告都合法，到強制結束或我們按停下為止，感載不超過上限', () => {
    for (const seed of [1, 7, 42]) {
      const g = game({ seed })
      begin(g, solo({ goal: 'footage', audience: seed % 2 === 1 }))
      g.state.inventory.push({ id: 'it_toy', qty: 1 }, { id: 'it_calm', qty: 5 })
      const inputs: SceneInput[] = [
        { kind: 'faster' }, { kind: 'slower' }, { kind: 'restrain' }, { kind: 'end_turn' },
        { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { kind: 'skill', id: 'nt_ok', pick: parts('hand_r', 'chest') }, { kind: 'item', id: 'it_toy', pick: parts('toy', 'front') },
        { kind: 'item', id: 'it_calm' }, { kind: 'switch', position: 'solo_kneel' }, { kind: 'switch', position: 'solo_side' }, { kind: 'talk' }, { kind: 'gear', gear: 'shallow' },
      ]
      let guard = 0
      let ended = false
      while (sceneRawOf(g.state) && guard++ < 400) {
        const input = inputs[(guard * 7 + seed) % inputs.length]!
        let rs
        try {
          rs = act(g, input)
        } catch (e) {
          if (e instanceof ActionBlocked) {
            rs = act(g, { kind: 'end_turn' })
          } else throw e
        }
        for (const r of rs) {
          if (r.action === 'scene.end') ended = true
        }
        const s = sceneRawOf(g.state)
        if (s) {
          expect(s.kind).toBe('solo')
          expect(s.pace).toBeGreaterThanOrEqual(0)
          expect(s.pace).toBeLessThanOrEqual(100)
          expect(s.seats).toHaveLength(1)
          expect(s.pairs).toEqual({})
          expect(g.state.actors.pc!.load).toBeLessThan(35)
        }
        if (guard === 60 && s) {
          act(g, { kind: 'stop' })
          ended = true
        }
      }
      expect(ended).toBe(true)
      expect(sceneRawOf(g.state)).toBeNull()
    }
  })

  it('同一個種子、同樣的行動序列，結果一樣（重播）', () => {
    const play = (): string => {
      const g = game({ seed: 99 })
      begin(g, solo())
      for (const input of [{ kind: 'faster' }, { kind: 'skill', id: 'nt_ok', pick: parts('hand_l', 'front') }, { kind: 'end_turn' }, { kind: 'slower' }, { kind: 'stop' }] as SceneInput[]) act(g, input)
      return JSON.stringify([g.state.meters, g.state.actors.pc!.ext.sex_record, g.state.actors.pc!.load, g.state.actors.pc!.afterglow])
    }
    expect(play()).toBe(play())
  })
})

void POSITIONS
