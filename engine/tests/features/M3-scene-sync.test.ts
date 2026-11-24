// 驗收測試：dev/work/M3-scene-sync.md（cpp-feature）。規格：LEWD_SYSTEM 3.5 節（第五點「換檔」、受到的感載乘敏感度、同步檔位與體位的倍率）、第 1 節（敏感度的門檻）；
// CORE_RULES 第 5 節；dev/adr/0018 第二節與「實作補記：M3-core-battle」；dev/adr/0016 G6。
// 沿用 M2-scene 測試的假體位與假對象（主角、安 npc_ann）：面對面主角在上位（a，×1.0）、安在 b（×1.5）；主角敏感度 50（×1.0）、安 100（×1.25）；感載上限 35、行動點上限 4。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Origin } from '../../src'
import { ActionBlocked } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Dice, SceneInput, SceneState, SyncGear } from '../../src/features/scene'
import { sceneAct, sceneFeature, sceneNext, sceneOf, sceneOptions, sceneSkip, sceneView } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假內容 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const PACK: ContentPack = {
  id: 'scene_test',
  content: {
    night_skill: [
      {
        id: 'nt_hold', name: '牽著走', branch: 'relation', tier: 3, tag: 'tg_dom', tags: ['tg_dom'],
        scene: { ap: 2, my_part: ['hand_l', 'hand_r'], their_part: ['chest', 'back'], on_use: { their_load: '2d6', my_load: '1d6', fit: 4, initiative: 15 }, link: { their_load: '1d6', my_load: 0, fit: 1 }, match_bonus: 12 },
      },
      { id: 'nt_kiss', name: '慢慢靠近', scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 }, positions: ['pos_face'] } },
      { id: 'nt_lap', name: '坐上來', scene: { ap: 1, my_part: ['front'], their_part: ['front'], on_use: { fit: 1 } } },
    ],
    position: [
      {
        id: 'pos_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1.5 }, initiative_drift: 3, tag: 'tg_kiss', tags: [], unlocked_by: null, text: '兩個人面對面。',
        links: [
          { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] },
          { from: ['a', 'front'], to: ['b', 'front'] }, { from: ['a', 'hand_l'], to: ['b', 'back'] },
        ],
      },
      {
        id: 'pos_behind', name: '從後面', people: 2, roles, mult: { a: 1, b: 1.25 }, initiative_drift: 3, tags: [], unlocked_by: null,
        links: [
          { from: ['a', 'front'], to: ['b', 'back'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'back'] },
        ],
      },
      {
        id: 'pos_lie', name: '並躺', people: 2, roles: [{ id: 'a', upper: false }, { id: 'b', upper: false }], mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
        links: [{ from: ['a', 'hand_l'], to: ['b', 'hand_l'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }],
      },
      {
        id: 'pos_lap', name: '腿上', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: 'nt_lap',
        links: [{ from: ['a', 'front'], to: ['b', 'front'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }],
      },
    ],
    item: [
      {
        id: 'it_toy', name: '脈衝環', desc: '一個測試用的玩具。', category: 'tool', grade: 2, size: 0, legal: 'free',
        scene: { ap: 1, as_part: 'toy', their_part: ['front', 'chest'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 } },
      },
      { id: 'it_calm', name: '冷靜貼片', desc: '一個測試用的貼片。', category: 'consumable', grade: 1, size: 0, legal: 'free', consumable: true, scene: { ap: 1, on_use: { my_load: '-1d6' } } },
    ],
    skill: [{ id: 'sync', name: '同步', attr: 'resolve', desc: '撐住回灌。' }],
    tendency_tag: [{ id: 'tg_dom', name: '支配', axis: 'relation' }, { id: 'tg_kiss', name: '親吻', axis: 'sense' }],
  },
}

const AFFINITY = testMeter({ kind: 'affinity', owner: 'test', name: '親密度', min: -100, max: 100, keyed: 'npc' })
const PC_BRIDGE = { sensitivity: 50, tolerance: 30, craving: 30, docility: 10 }
const ANN_BRIDGE = { sensitivity: 100, tolerance: 30, craving: 30, docility: 30 }

type Game = ReturnType<typeof makeGame>['game']

interface Opts {
  pc?: ActorOverrides
  ann?: ActorOverrides
  pcExt?: Record<string, unknown>
  annExt?: Record<string, unknown>
  contentOff?: string[]
  rules?: Record<string, unknown>
  features?: Feature[]
  fake?: boolean
  seed?: number
  packs?: ContentPack[]
}

/** 主角（有「支配」，會牽著走與慢慢靠近，也學過「坐上來」所以會腿上）與安（npc_ann）。 */
const game = (o: Opts = {}) => gameWith(o).game
function gameWith(o: Opts = {}) {
  const content: ContentPack[] = [PACK, METER_CONTENT]
  if (o.packs) content.push(...o.packs)
  if (o.rules) content.push({ id: 'scene_rules', content: { scene_rule: [{ id: 'default', ...o.rules }] } })
  const ann = makeActor({ id: 'npc_ann', name: '安', role: 'npc', ...o.ann, ext: { bridge: ANN_BRIDGE, ...o.annExt, ...(o.ann?.ext ?? {}) } })
  return makeGame({
    seed: o.seed,
    features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, ...(o.features ?? [])],
    content,
    pc: {
      ...o.pc,
      ext: { bridge: PC_BRIDGE, tendency: { axes: {}, points: {}, tags: { tg_dom: 'has' } }, scene: { skills: ['nt_hold', 'nt_kiss'], positions: ['pos_lap'] }, ...o.pcExt, ...(o.pc?.ext ?? {}) },
    },
    actors: [ann],
    patch: o.contentOff ? ({ rules: { contentOff: o.contentOff } } as unknown as Partial<GameState>) : undefined,
    fake: o.fake ? true : undefined,
  })
}

/** 一串固定的骰面：每一顆都要落在範圍內，用完丟錯。 */
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

const SETUP = { with: ['npc_ann'], nature: 'mutual' as const }
const begin = (g: Game, setup: unknown = SETUP, origin: Origin = { by: 'test' }) => g.launch('scene', setup, origin)
const S = (g: Game): SceneState => sceneOf(g.state)!
const ann = (g: Game) => g.state.actors.npc_ann!
const pc = (g: Game) => g.state.actors.pc!
const act = (g: Game, input: SceneInput, d?: Dice) => g.commit(sceneAct(g.k, g.state, input, d ? { dice: d } : {}))
const next = (g: Game, d?: Dice) => g.commit(sceneNext(g.k, g.state, d ? { dice: d } : {}))
/** 對方的回合一步一步走完（交回主角，或場景結束）。 */
const partnerTurn = (g: Game): void => {
  for (let i = 0; i < 12 && sceneOf(g.state)?.turn === 'partner'; i++) next(g)
}
const blocked = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionBlocked) return e.reason
    throw e
  }
  throw new Error('應該被擋下')
}
/** 受到的感載：原始值 × (0.75 + 敏感度 ÷ 200) × 體位倍率 × (1 + 0.1 × 餘韻)，四捨五入。 */
const hit = (raw: number, sens: number, pos: number, glow = 0): number => Math.round(raw * (0.75 + sens / 200) * pos * (1 + 0.1 * glow))
/** 說話的骰：自然 13 剛好過 DC 13（成功，契合 +5）。 */
const TALK_OK = 13

const talkParts = { my_part: 'mouth', their_part: 'mouth' }
/** 主角說一句話，在面對面建立 口↔口 的連接（花 1 點）。 */
const talk = (g: Game, d = TALK_OK) => act(g, { kind: 'talk', text: '你好', pick: talkParts }, dice(d))


// ---- 這一批的幫手 ----

/** 同步 5 級、敏感度 70：全檔也開得了（敏感度 70 → 受到的感載 ×1.1）。 */
const FULL_PC = { pc: { skills: { sync: 5 } }, pcExt: { bridge: { ...PC_BRIDGE, sensitivity: 70 } } }
const gearOpt = (g: Game) => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'gear')!
const setGear = (g: Game, who: 'pc' | 'partner', gear: SyncGear): void => {
  S(g).gear[who] = gear
}
const tags = (r: { timeline: Array<{ tag?: string }> }): Array<string | undefined> => r.timeline.map((b) => b.tag)

// ======================================================================
describe('換檔：第十種行動', () => {
  it('行動的清單有十種，換檔在切換體位之後、停下之前；花 0 點；選項列四檔', () => {
    const g = game()
    begin(g)
    const o = sceneOptions(g.k, g.state)!
    expect(o.actions).toHaveLength(10)
    expect(o.actions.map((a) => a.id)).toEqual(['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear', 'stop'])
    const gear = gearOpt(g)
    expect(gear).toMatchObject({ name: '換檔', ap: 0, blocks: [] })
    expect(gear.choices!.map((c) => [c.id, c.name, c.ap])).toEqual([['shallow', '淺檔', 0], ['standard', '標準檔', 0], ['deep', '深檔', 0], ['full', '全檔', 0]])
  })

  it('起始是標準；沒有同步的等級與夠高的敏感度時只能換淺、標準：深與全灰掉並寫出缺哪個條件', () => {
    const g = game()
    begin(g)
    expect(S(g).gear).toEqual({ pc: 'standard', partner: 'standard' })
    const c = Object.fromEntries(gearOpt(g).choices!.map((x) => [x.id, x.blocks]))
    expect(c.shallow).toEqual([])
    expect(c.standard).toEqual(['已經是標準檔了。'])
    expect(c.deep).toEqual(['同步要 3 級才能開深檔（現在 0 級）。'])
    expect(c.full).toEqual(['同步要 5 級才能開全檔（現在 0 級）。', '敏感度要 70 才能開全檔（現在 50）。'])
  })

  it('同步 3 級、敏感度 40 的主角開得了深檔；全檔灰掉並寫出缺的是同步 5 級與敏感度 70', () => {
    const g = game({ pc: { skills: { sync: 3 } }, pcExt: { bridge: { ...PC_BRIDGE, sensitivity: 40 } } })
    begin(g)
    const c = Object.fromEntries(gearOpt(g).choices!.map((x) => [x.id, x.blocks]))
    expect(c.deep).toEqual([])
    expect(c.full).toEqual(['同步要 5 級才能開全檔（現在 3 級）。', '敏感度要 70 才能開全檔（現在 40）。'])
    const v = sceneView(g.k, g.state)!
    expect(v.people.pc.gear).toMatchObject({ now: 'standard', name: '標準檔', cap: 'deep', cap_name: '深檔', check: 0, load_pct: 100, shifted: false, max: 'standard' })
    expect(v.people.pc.gear.gears.map((x) => [x.id, x.blocks.length])).toEqual([['shallow', 0], ['standard', 0], ['deep', 0], ['full', 2]])
    // 開不了的直接被擋，原因一樣
    expect(blocked(() => act(g, { kind: 'gear', gear: 'full' }))).toBe('同步要 5 級才能開全檔（現在 3 級）。敏感度要 70 才能開全檔（現在 40）。')
    act(g, { kind: 'gear', gear: 'deep' })
    expect(S(g).gear.pc).toBe('deep')
  })

  it('換檔花 0 點、不交出回合；一回合第二次被擋並有原因；下一回合又可以換', () => {
    const g = game(FULL_PC)
    begin(g)
    const [r] = act(g, { kind: 'gear', gear: 'deep' })
    expect(r).toMatchObject({ action: 'scene.act', adult: true })
    expect(tags(r!)).toEqual(['gear'])
    expect(r!.timeline[0]!.data).toMatchObject({ from: 'standard', to: 'deep' })
    expect(S(g)).toMatchObject({ turn: 'pc', ap: { pc: 4, partner: 4 } })
    expect(S(g).shifted.pc).toBe(true)
    expect(blocked(() => act(g, { kind: 'gear', gear: 'full' }))).toBe('這個回合已經換過檔了。')
    expect(gearOpt(g).blocks).toEqual(['這個回合已經換過檔了。'])
    expect(S(g).gear.pc).toBe('deep')
    expect(sceneView(g.k, g.state)!.people.pc.gear.shifted).toBe(true)
    // 下一回合
    act(g, { kind: 'end_turn' })
    partnerTurn(g)
    expect(S(g)).toMatchObject({ round: 2, turn: 'pc' })
    expect(S(g).shifted.pc).toBe(false)
    act(g, { kind: 'gear', gear: 'full' })
    expect(S(g).gear.pc).toBe('full')
  })

  it('已經是這一檔、不在自己的回合、沒有這一檔：被擋並有原因', () => {
    const g = game()
    begin(g)
    expect(blocked(() => act(g, { kind: 'gear', gear: 'standard' }))).toBe('已經是標準檔了。')
    expect(blocked(() => act(g, { kind: 'gear', gear: 'ultra' as never }))).toMatch(/要指明換到哪一檔/)
    expect(blocked(() => act(g, { kind: 'gear' } as never))).toMatch(/要指明換到哪一檔/)
    act(g, { kind: 'end_turn' })
    expect(blocked(() => act(g, { kind: 'gear', gear: 'shallow' }))).toBe('還沒輪到你。')
    expect(gearOpt(g).blocks).toEqual(['還沒輪到你。'])
  })

  it('上限不到標準的人起始是淺（資料把標準檔的敏感度門檻調到 60）；之後條件寫在原因裡', () => {
    const packs: ContentPack[] = [{ id: 'sync_hi', content: { sync_rule: [{ id: 'default', gears: { standard: { name: '標準', check: 0, load_pct: 100, need_skill: 0, need_sensitivity: 60 } } }] } }]
    const g = game({ packs })
    begin(g)
    expect(S(g).gear).toEqual({ pc: 'shallow', partner: 'standard' }) // 安的敏感度 100，夠
    expect(S(g).max_gear.pc).toBe('shallow')
    const c = Object.fromEntries(gearOpt(g).choices!.map((x) => [x.id, x.blocks]))
    expect(c.shallow).toEqual(['已經是淺檔了。'])
    expect(c.standard).toEqual(['敏感度要 60 才能開標準檔（現在 50）。'])
  })

  it('沉溺 60 以上上限多一級、衍生數值 sync_cap_bonus：照核心的 syncCapOf', () => {
    const g = game({ pc: { skills: { sync: 3 }, sink: 60 }, pcExt: { bridge: { ...PC_BRIDGE, sensitivity: 70 } } })
    begin(g)
    expect(sceneView(g.k, g.state)!.people.pc.gear.cap).toBe('full')
    expect(gearOpt(g).choices!.find((c) => c.id === 'full')!.blocks).toEqual([])
  })
})

// ======================================================================
describe('檔位的效果', () => {
  /** 主角用迎合讓自己受到 2d6（dice 1, 3, 4：對方 1d6 = 2、自己 2d6 = 7 → 原始 7），回傳主角身上的感載。 */
  const selfLoad = (gear: SyncGear): number => {
    const g = game()
    begin(g)
    talk(g)
    setGear(g, 'pc', gear)
    act(g, { kind: 'yield' }, dice(2, 3, 4))
    return pc(g).load
  }

  it('同一份感載在淺、標準、深、全檔受到的是 ×0.5、×1、×1.5、×2.5（其餘倍率相同）', () => {
    const base = hit(7, 50, 1) // 7
    expect(base).toBe(7)
    expect(selfLoad('shallow')).toBe(Math.round(base * 0.5))
    expect(selfLoad('standard')).toBe(base)
    expect(selfLoad('deep')).toBe(Math.round(7 * 1.5))
    expect(selfLoad('full')).toBe(Math.round(7 * 2.5))
    expect([selfLoad('shallow'), selfLoad('standard'), selfLoad('deep'), selfLoad('full')]).toEqual([4, 7, 11, 18])
  })

  it('預覽與連接的每回合數值也乘檔位的倍率；對方的檔位只管他自己受到的', () => {
    const g = game()
    begin(g)
    talk(g)
    const mult = (gear: SyncGear, who: 'pc' | 'partner') => {
      setGear(g, who, gear)
      return sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'dominate')!.preview!
    }
    expect(mult('standard', 'pc').my_load!.mult).toBe(1)
    expect(mult('full', 'pc').my_load!.mult).toBe(2.5)
    expect(mult('full', 'pc').target_load!.mult).toBe(1.88) // 對方還是標準：1.25 × 1.5
    setGear(g, 'pc', 'standard')
    expect(mult('deep', 'partner').target_load!.mult).toBe(2.81) // 1.25 × 1.5 × 1.5
    expect(mult('deep', 'partner').my_load!.mult).toBe(1)
  })

  it('全檔每回合多回 1 點行動點；其他檔不多', () => {
    const run = (gear: SyncGear): number => {
      const g = game(FULL_PC)
      begin(g)
      if (gear !== 'standard') act(g, { kind: 'gear', gear })
      // 把四點都用掉：說話、挑逗（固定骰 1）、克制、說話
      talk(g)
      act(g, { kind: 'tease' }, dice(1, 1))
      act(g, { kind: 'restrain' })
      act(g, { kind: 'talk', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(TALK_OK))
      expect(S(g)).toMatchObject({ turn: 'partner', ap: { pc: 0 } })
      partnerTurn(g)
      expect(S(g)).toMatchObject({ round: 2, turn: 'pc' })
      return S(g).ap.pc
    }
    expect(run('standard')).toBe(3)
    expect(run('deep')).toBe(3)
    expect(run('full')).toBe(4)
  })

  it('全檔過載時沉溺 +2（結算時加在主角身上）；深檔過載不加', () => {
    const run = (gear: SyncGear): { sink: number; climaxed: number } => {
      const g = game({ ...FULL_PC, pc: { ...FULL_PC.pc, load: 30 } })
      begin(g)
      talk(g)
      setGear(g, 'pc', gear)
      act(g, { kind: 'dominate' }, dice(1, 1, 6)) // 自己 1d6 = 6：深 6 × 1.1 × 1.5 = 10、全 6 × 1.1 × 2.5 = 17，都超過 35 − 30
      const climaxed = S(g).climax.pc
      expect(S(g).sink_gain.pc).toBe(gear === 'full' ? 2 : 0)
      const [r] = act(g, { kind: 'stop' })
      expect(sceneOf(g.state)).toBeNull()
      expect(r!.narration!.results!.some((x) => x.includes('沉溺 +2'))).toBe(gear === 'full')
      return { sink: pc(g).sink, climaxed }
    }
    expect(run('deep')).toEqual({ sink: 0, climaxed: 1 })
    expect(run('full')).toEqual({ sink: 2, climaxed: 1 })
  })

  it('過載累積的沉溺一場最多加 4（SINK_CAP）', () => {
    const g = game(FULL_PC)
    begin(g)
    S(g).sink_gain.pc = 10
    act(g, { kind: 'stop' })
    expect(pc(g).sink).toBe(4)
  })

  it('自己擲的檢定照那一檔的 check：說話的檢定多一項來源 sync（深 +2、淺 −2、標準沒有）', () => {
    const roll = (gear: SyncGear) => {
      const g = game()
      begin(g)
      setGear(g, 'pc', gear)
      const [r] = talk(g)
      const parts = r!.timeline[0]!.roll!.parts
      return { sync: parts.find((x) => x.source === 'sync'), total: r!.timeline[0]!.roll!.total }
    }
    const std = roll('standard')
    expect(std.sync).toBeUndefined()
    expect(roll('deep').sync).toMatchObject({ label: '深檔', value: 2 })
    expect(roll('shallow').sync).toMatchObject({ label: '淺檔', value: -2 })
    expect(roll('full').sync).toMatchObject({ value: 4 })
    expect(roll('deep').total - std.total).toBe(2)
  })

  it('資料的 sync_rule 蓋掉預設：把深檔的感載改成 200%，場景跟著變', () => {
    const packs: ContentPack[] = [{ id: 'sync_deep', content: { sync_rule: [{ id: 'default', gears: { deep: { name: '深', check: 2, load_pct: 200, need_skill: 3, need_sensitivity: 40 } } }] } }]
    const g = game({ packs })
    begin(g)
    talk(g)
    setGear(g, 'pc', 'deep')
    act(g, { kind: 'yield' }, dice(2, 3, 4))
    expect(pc(g).load).toBe(14)
  })
})

// ======================================================================
describe('對方的檔位（走規則、不呼叫 AI）', () => {
  it('生成的 NPC 沒有同步的等級：上限只到標準，沒有人去換就一直是標準', () => {
    const g = game()
    begin(g)
    const v = sceneView(g.k, g.state)!
    expect(v.people.partner.gear).toMatchObject({ now: 'standard', cap: 'standard' })
    expect(v.people.partner.gear.gears.find((x) => x.id === 'deep')!.blocks).toEqual(['同步要 3 級才能開深檔（現在 0 級）。'])
  })

  it('對方感載七成以上時他的回合開始退一檔；之後維持，同一個回合不再退', () => {
    const g = game({ ann: { load: 26 } }) // 35 × 0.7 = 24.5
    begin(g)
    talk(g)
    act(g, { kind: 'end_turn' })
    const [r] = next(g)
    expect(tags(r!)[0]).toBe('gear')
    expect(r!.timeline[0]!.data).toMatchObject({ from: 'standard', to: 'shallow' })
    expect(S(g).gear.partner).toBe('shallow')
    expect(S(g).shifted.partner).toBe(true)
    expect(S(g).max_gear.partner).toBe('standard')
    const [again] = next(g, dice(1, 1, 1, 1, 1))
    expect(tags(again!)).not.toContain('gear')
    expect(S(g).gear.partner).toBe('shallow')
  })

  it('七成以下維持；已經是淺檔不再退', () => {
    const g = game({ ann: { load: 10 } })
    begin(g)
    talk(g)
    act(g, { kind: 'end_turn' })
    next(g)
    expect(S(g).gear.partner).toBe('standard')
    const h = game({ ann: { load: 30 } })
    begin(h)
    talk(h)
    setGear(h, 'partner', 'shallow')
    act(h, { kind: 'end_turn' })
    const [r] = next(h)
    expect(tags(r!)).not.toContain('gear')
    expect(S(h).gear.partner).toBe('shallow')
  })

  it('scene_turn 的接口：env.partner_gear 給了而且合規就照給的；超過他的上限的當沒給', () => {
    const g = game({ annExt: { bridge: { ...ANN_BRIDGE } }, ann: { skills: { sync: 3 } } })
    begin(g)
    expect(S(g).gear.partner).toBe('standard')
    talk(g)
    act(g, { kind: 'end_turn' })
    const [r] = g.commit(sceneNext(g.k, g.state, { partner_gear: 'deep' }))
    expect(tags(r!)[0]).toBe('gear')
    expect(S(g).gear.partner).toBe('deep')
    expect(S(g).max_gear.partner).toBe('deep')
    const h = game()
    begin(h)
    talk(h)
    act(h, { kind: 'end_turn' })
    const [r2] = h.commit(sceneNext(h.k, h.state, { partner_gear: 'full' }))
    expect(tags(r2!)).not.toContain('gear')
    expect(S(h).gear.partner).toBe('standard')
  })
})

// ======================================================================
describe('結算：這一場開過的最高檔位', () => {
  it('scene.end 的最後一拍與 activity.end 的結果帶 max_gear（深過又退回標準，記的是深）', () => {
    const g = game({ ...FULL_PC })
    begin(g)
    act(g, { kind: 'gear', gear: 'deep' })
    act(g, { kind: 'end_turn' })
    partnerTurn(g)
    act(g, { kind: 'gear', gear: 'standard' })
    expect(S(g)).toMatchObject({ gear: { pc: 'standard' }, max_gear: { pc: 'deep', partner: 'standard' } })
    const [r] = act(g, { kind: 'stop' })
    expect(r!.action).toBe('scene.end')
    const last = r!.timeline[r!.timeline.length - 1]!
    expect(last.data).toMatchObject({ reason: 'stop', max_gear: { pc: 'deep', partner: 'standard' } })
  })

  it('略過：最高檔位是起始的標準', () => {
    const g = game()
    begin(g)
    const [r] = g.commit(sceneSkip(g.k, g.state))
    expect(r!.timeline[r!.timeline.length - 1]!.data).toMatchObject({ reason: 'skip', max_gear: { pc: 'standard', partner: 'standard' } })
  })
})

// ======================================================================
describe('沒有人換檔時和原來一樣', () => {
  /** 一套固定的行動（精簡版）：每一步之後的場景狀態、角色的感載與結算；做不到的行動（行動點不夠這類）略過。 */
  const playthrough = (o: Opts): string[] => {
    const g = game({ ...o, seed: 7 })
    begin(g, { ...SETUP, mode: 'simple' })
    const out: string[] = []
    const snap = () => out.push(JSON.stringify([sceneOf(g.state), pc(g).load, ann(g).load, pc(g).afterglow, ann(g).afterglow]))
    const script: SceneInput[] = [
      { kind: 'talk', pick: talkParts }, { kind: 'dominate' }, { kind: 'skill', id: 'nt_hold' }, { kind: 'end_turn' }, { kind: 'yield' }, { kind: 'tease' }, { kind: 'restrain' }, { kind: 'dominate' },
      { kind: 'end_turn' }, { kind: 'tease' }, { kind: 'yield' }, { kind: 'end_turn' }, { kind: 'dominate' }, { kind: 'tease' }, { kind: 'end_turn' },
    ]
    for (const input of script) {
      for (let i = 0; i < 12 && sceneOf(g.state)?.turn === 'partner'; i++) {
        next(g)
        snap()
      }
      if (!sceneOf(g.state)) break
      try {
        act(g, input)
      } catch (e) {
        if (!(e instanceof ActionBlocked)) throw e
        out.push(`blocked:${e.reason}`)
        continue
      }
      snap()
    }
    for (let i = 0; i < 12 && sceneOf(g.state)?.turn === 'partner'; i++) next(g)
    if (sceneOf(g.state)) {
      const [r] = act(g, { kind: 'stop' })
      out.push(JSON.stringify([r!.timeline, r!.changes, r!.narration]))
    }
    out.push(JSON.stringify(g.state))
    return out
  }

  it('精簡版走完一整場：主角開得了深檔但沒有換，逐步、逐欄和標準檔的主角相同（只差角色身上的同步等級）', () => {
    const plain = playthrough({})
    const able = playthrough({ pc: { skills: { sync: 3 } } })
    expect(plain.length).toBeGreaterThan(12)
    const noSkills = (x: string): string => x.replace(/,?"skills":\{("sync":3)?\}/g, '')
    expect(able.map(noSkills)).toEqual(plain.map(noSkills))
    // 每一步的場景裡檔位都是標準、沒有換過、沒有累積沉溺
    const first = JSON.parse(plain[1]!)[0] as SceneState
    expect(first).toMatchObject({ gear: { pc: 'standard', partner: 'standard' }, max_gear: { pc: 'standard', partner: 'standard' }, shifted: { pc: false, partner: false }, sink_gain: { pc: 0, partner: 0 } })
  })

  it('同一個種子、同樣的行動序列、兩次跑出來逐欄相同（亂數沒有被換檔多吃）', () => {
    expect(playthrough({})).toEqual(playthrough({}))
  })
})

// ======================================================================
describe('畫面資料', () => {
  it('sceneView：每個人的檔位、上限、這一場的最高檔與四檔各自的原因；舊存檔沒有檔位欄位時補成標準', () => {
    const g = game(FULL_PC)
    begin(g)
    act(g, { kind: 'gear', gear: 'full' })
    const v = sceneView(g.k, g.state)!
    expect(v.people.pc.gear).toMatchObject({ now: 'full', name: '全檔', cap: 'full', check: 4, load_pct: 250, shifted: true, max: 'full' })
    expect(v.people.pc.gear.gears.find((x) => x.id === 'full')).toMatchObject({ name: '全檔', current: true, check: 4, load_pct: 250, ap_regen: 1, sink_on_overload: 2, blocks: [] })
    expect(v.people.partner.gear).toMatchObject({ now: 'standard', cap: 'standard', shifted: false })
    // 舊存檔
    const old = S(g) as unknown as Record<string, unknown>
    for (const k of ['gear', 'max_gear', 'shifted', 'sink_gain', 'turn_began']) delete old[k]
    const w = sceneView(g.k, g.state)!
    expect(w.people.pc.gear).toMatchObject({ now: 'standard', max: 'standard', shifted: false })
    expect(() => act(g, { kind: 'dominate' })).toThrow(ActionBlocked) // 還沒有連接，照常被擋，不是壞掉
    act(g, { kind: 'gear', gear: 'deep' })
    expect(S(g).gear.pc).toBe('deep')
  })

  it('換檔的預覽：那一檔的檢定加減、感載倍率、行動點與沉溺', () => {
    const g = game(FULL_PC)
    begin(g)
    const full = gearOpt(g).choices!.find((c) => c.id === 'full')!
    expect(full.preview.gear).toEqual({ id: 'full', name: '全檔', check: 4, load_pct: 250, ap_regen: 1, sink_on_overload: 2 })
    expect(full.preview.ap).toBe(0)
  })
})
