// 驗收測試：dev/work/M4-scene-seats.md（cpp-feature）。規格：LEWD_SYSTEM 3.2～3.5 節、第 9 節；DATA 3.1～3.4 節；AI_TASKS 3.6 節、4.2 節（scene_turn、scene_talk）；
// dev/adr/0019 第九節與 P31、P64；dev/adr/0016 G6、G11。
// 內容一律用測試自帶的最小假資料（沿用 M2-scene 測試的假體位與假對象，多幾個這一張要的技能與一個體位 pos_tent）。
//
// 這一張只改形狀：座位與配對取代寫死的兩個人，一對一的結果不變（現有的 M2-scene、M3-scene-sync 測試一個字不改全過）。
// 數字的約定（和 M2 一樣）：主角敏感度 50、安敏感度 100；感載上限 35、行動點上限 4。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Origin, Report } from '../../src'
import { ActionBlocked } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Dice, SceneEnv, SceneInput, SceneRaw } from '../../src/features/scene'
import { mergeBody, sceneAct, sceneFeature, sceneNext, sceneOptions, sceneRawOf, sceneView, setSceneMode, startProblems } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { METER_CONTENT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

// ---- 假內容 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const PACK: ContentPack = {
  id: 'seats_test',
  content: {
    night_skill: [
      {
        id: 'nt_hold', name: '牽著走', tag: 'tg_dom', tags: ['tg_dom'],
        scene: { ap: 2, my_part: ['hand_l', 'hand_r'], their_part: ['chest', 'back'], on_use: { their_load: '2d6', my_load: '1d6', fit: 4, initiative: 15 }, link: { their_load: '1d6', my_load: 0, fit: 1 }, match_bonus: 12 },
      },
      { id: 'nt_kiss', name: '慢慢靠近', scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 }, positions: ['pos_face'] } },
      // 觸手那一種：同一個部位可以再接一條
      { id: 'nt_tent', name: '纏上去', scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest', 'back', 'legs'], double: true, on_use: { fit: 1 }, link: { their_load: '1d6', fit: 0 } } },
      { id: 'nt_plain', name: '一般的接法', scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest', 'back', 'legs'], on_use: { fit: 1 }, link: { their_load: '1d6', fit: 0 } } },
      // 要有鑰匙卡才用得出來
      { id: 'nt_key', name: '用鑰匙卡', scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], needs: [{ kind: 'has_item', id: 'it_key' }], on_use: { fit: 1 } } },
      { id: 'nt_note', name: '照字條', scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], needs: [{ kind: 'has_item', id: 'it_key', text: '要先拿到那張卡。' }], on_use: { fit: 1 } } },
      // 條件的種類沒有人註冊
      { id: 'nt_moon', name: '看月相', scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], needs: [{ kind: 'moon_phase', phase: 'full' }], on_use: { fit: 1 } } },
      // 部位的敏感度：同樣兩骰的感載，接背與接胸
      { id: 'nt_chest', name: '按胸口', scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '2d6' } } },
      { id: 'nt_back', name: '按背', scene: { ap: 1, my_part: ['hand_l'], their_part: ['back'], on_use: { their_load: '2d6' } } },
      { id: 'nt_tail', name: '碰尾巴', scene: { ap: 1, my_part: ['hand_r'], their_part: ['tail'], on_use: { their_load: '2d6' } } },
    ],
    position: [
      {
        id: 'pos_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1.5 }, initiative_drift: 3, tag: 'tg_kiss', tags: [], unlocked_by: null,
        links: [
          { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] },
          { from: ['a', 'front'], to: ['b', 'front'] }, { from: ['a', 'hand_l'], to: ['b', 'back'] },
        ],
      },
      {
        id: 'pos_behind', name: '從後面', people: 2, roles, mult: { a: 1, b: 1.25 }, initiative_drift: 3, tags: [], unlocked_by: null,
        links: [{ from: ['a', 'front'], to: ['b', 'back'] }, { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'back'] }],
      },
      // 這一張的測試用：左手碰得到胸、背、腿足，右手碰得到尾
      {
        id: 'pos_tent', name: '並坐', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
        links: [
          { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_l'], to: ['b', 'back'] }, { from: ['a', 'hand_l'], to: ['b', 'legs'] },
          { from: ['a', 'hand_r'], to: ['b', 'tail'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] },
        ],
      },
    ],
    item: [
      { id: 'it_key', name: '鑰匙卡', desc: '一張測試用的卡。', category: 'tool', grade: 1, size: 0, legal: 'free' },
    ],
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
  features?: Feature[]
  seed?: number
}

const PC_SKILLS = ['nt_hold', 'nt_kiss', 'nt_tent', 'nt_plain', 'nt_key', 'nt_note', 'nt_moon', 'nt_chest', 'nt_back', 'nt_tail']

/** 主角（會一串技能）與安（npc_ann）。 */
function game(o: Opts = {}): Game {
  const ann = makeActor({ id: 'npc_ann', name: '安', role: 'npc', ...o.ann, ext: { bridge: ANN_BRIDGE, ...o.annExt, ...(o.ann?.ext ?? {}) } })
  return makeGame({
    seed: o.seed,
    features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, ...(o.features ?? [])],
    content: [PACK, METER_CONTENT],
    pc: {
      ...o.pc,
      ext: { bridge: PC_BRIDGE, tendency: { axes: {}, points: {}, tags: { tg_dom: 'has' } }, scene: { skills: PC_SKILLS, positions: [] }, ...o.pcExt, ...(o.pc?.ext ?? {}) },
    },
    actors: [ann],
    patch: o.contentOff ? ({ rules: { contentOff: o.contentOff } } as unknown as Partial<GameState>) : undefined,
  }).game
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
const begin = (g: Game, setup: Record<string, unknown> = SETUP, origin: Origin = { by: 'test' }) => g.launch('scene', setup, origin)
const raw = (g: Game): SceneRaw => sceneRawOf(g.state)!
const act = (g: Game, input: SceneInput, env: SceneEnv = {}) => g.commit(sceneAct(g.k, g.state, input, env))
const next = (g: Game, env: SceneEnv = {}) => g.commit(sceneNext(g.k, g.state, env))
const partnerTurn = (g: Game): void => {
  for (let i = 0; i < 30 && sceneRawOf(g.state) && raw(g).turn !== raw(g).pc; i++) next(g)
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
/** 受到的感載：原始值 × (0.75 + 敏感度 ÷ 200) × 體位倍率，四捨五入。 */
const hit = (rawLoad: number, sens: number, pos: number): number => Math.round(rawLoad * (0.75 + sens / 200) * pos)
const talkParts = { my_part: 'mouth', their_part: 'mouth' }
const beatsOf = (r: Report, tag: string) => r.timeline.filter((b) => b.tag === tag)

// ======================================================================
describe('第二版的狀態：座位與配對', () => {
  it('開場：state.ext.scene 是第二版（v: 2、pair、meat）；座位第一個是主角；配對記主角對對方；角色的 id 取代舊的 pc／partner', () => {
    const g = game()
    begin(g)
    const s = g.state.ext.scene as unknown as SceneRaw
    expect(s).toMatchObject({ v: 2, kind: 'pair', layer: 'meat', pc: 'pc', turn: 'pc', round: 1, circles: [] })
    expect(s.seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(s.seats[0]).toMatchObject({ ap: 4, gear: 'standard', max_gear: 'standard', shifted: false, sink_gain: 0, climax: 0, received: 0, teased: false, restrained: false })
    expect(s.pairs).toEqual({ npc_ann: { fit: 20, init: 55, first: true } })
    expect(Object.keys(s.roles).sort()).toEqual(['npc_ann', 'pc'])
    expect(s.max_rounds).toBeUndefined()
    // 舊的寫死的兩格不在了
    for (const key of ['partner', 'ap', 'fit', 'init', 'gear', 'climax', 'first_person']) expect(Object.keys(s)).not.toContain(key)
  })

  it('連接與說話的紀錄用角色的 id：links 的 by、to、lines 的 who', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'talk', text: '你好', pick: talkParts })
    act(g, { kind: 'end_turn' })
    expect(raw(g).turn).toBe('npc_ann')
    partnerTurn(g)
    const s = raw(g)
    expect(s.links.length).toBeGreaterThan(0)
    for (const l of s.links) {
      expect(['pc', 'npc_ann']).toContain(l.by)
      expect(l.to).toBe(l.by === 'pc' ? 'npc_ann' : 'pc')
    }
    expect(new Set(s.lines.map((l) => l.who))).toEqual(new Set(['pc', 'npc_ann']))
  })

  it('sceneRawOf 回傳第二版原樣：seats、pairs、kind、layer 都在，人用角色的 id（turn、links、lines 不再有 pc／partner 的舊名字）', () => {
    const g = game()
    begin(g)
    const s = sceneRawOf(g.state)!
    expect(s).toMatchObject({ v: 2, kind: 'pair', layer: 'meat', turn: 'pc' })
    expect(s).not.toHaveProperty('partner')
    expect(s).not.toHaveProperty('fit')
    expect(s.seats.map((x) => [x.id, x.ap])).toEqual([['pc', 4], ['npc_ann', 4]])
    expect(s.pairs.npc_ann).toEqual({ fit: 20, init: 55, first: true })
    s.seats[1]!.ap = 1
    s.pairs.npc_ann!.fit = 33
    s.turn = 'npc_ann'
    expect(raw(g).seats[1]!.ap).toBe(1)
    expect(raw(g).pairs.npc_ann!.fit).toBe(33)
    expect(sceneRawOf(g.state)!.turn).toBe('npc_ann')
  })
})

// ======================================================================
describe('讀舊的：沒有 v 的 pc／partner 一對一場景轉成第二版', () => {
  /** M2、M3 的舊形狀（和 dev 前的 SceneState 逐欄一樣），從第二版倒推。 */
  function toLegacy(s: SceneRaw, dropGearFields = false): Record<string, unknown> {
    const [a, b] = s.seats
    const w = (id: string): 'pc' | 'partner' => (id === s.pc ? 'pc' : 'partner')
    const pair = s.pairs[b!.id]!
    const old: Record<string, unknown> = {
      id: s.id, mode: s.mode, pc: s.pc, partner: b!.id, nature: s.nature, role: s.role, goal: s.goal, ...(s.place ? { place: s.place } : {}), tags: s.tags,
      round: s.round, turn: w(s.turn), step: s.step, ap: { pc: a!.ap, partner: b!.ap }, fit: pair.fit, init: pair.init, goal_progress: s.goal_progress, position: s.position,
      roles: { pc: s.roles[a!.id], partner: s.roles[b!.id] },
      links: s.links.map((l) => ({ id: l.id, by: w(l.by), kind: l.kind, source: l.source, name: l.name, mine: l.mine, theirs: l.theirs, link: l.link, round: l.round })),
      link_seq: s.link_seq, teased: { pc: a!.teased, partner: b!.teased }, restrained: { pc: a!.restrained, partner: b!.restrained },
      gear: { pc: a!.gear, partner: b!.gear }, max_gear: { pc: a!.max_gear, partner: b!.max_gear }, shifted: { pc: a!.shifted, partner: b!.shifted }, sink_gain: { pc: a!.sink_gain, partner: b!.sink_gain },
      turn_began: s.turn_began, climax: { pc: a!.climax, partner: b!.climax }, received: { pc: a!.received, partner: b!.received }, used_positions: s.used_positions, touched: s.touched,
      lines: s.lines.map((l) => ({ round: l.round, who: w(l.who), text: l.text })), first_person: pair.first, origin: s.origin,
    }
    if (dropGearFields) for (const k of ['gear', 'max_gear', 'shifted', 'sink_gain', 'turn_began']) delete old[k]
    return JSON.parse(JSON.stringify(old)) as Record<string, unknown>
  }

  /** 同一個種子、同樣的輸入走到一半的兩局：一局原樣，一局把場景換成舊形狀。 */
  const twin = (): [Game, Game] => {
    const make = (): Game => {
      const g = game({ seed: 11 })
      begin(g, { ...SETUP, goal: 'info' })
      act(g, { kind: 'talk', text: '你好', pick: talkParts })
      act(g, { kind: 'skill', id: 'nt_hold' })
      act(g, { kind: 'end_turn' })
      next(g)
      return g
    }
    return [make(), make()]
  }

  it('舊形狀放進存檔：sceneRawOf 回傳第二版（就地換掉 state.ext.scene），內容和原本的第二版逐欄相同', () => {
    const [ref, old] = twin()
    const before = JSON.parse(JSON.stringify(raw(ref))) as SceneRaw
    expect(before.v).toBe(2)
    old.state.ext.scene = toLegacy(raw(ref)) as never
    expect((old.state.ext.scene as Record<string, unknown>).v).toBeUndefined()
    const s = sceneRawOf(old.state)!
    expect(s.v).toBe(2)
    expect(s.seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(s.kind).toBe('pair')
    expect(s.layer).toBe('meat')
    expect((old.state.ext.scene as unknown as SceneRaw).v).toBe(2) // 就地換掉
    expect(JSON.parse(JSON.stringify(raw(old)))).toEqual(before)
  })

  it('接著 sceneAct、sceneNext 走到結束：每一份報告與最後的狀態和「全新開一場、走同樣的輸入」逐欄相同', () => {
    const [ref, old] = twin()
    old.state.ext.scene = toLegacy(raw(ref)) as never
    const run = (g: Game): unknown[] => {
      const out: unknown[] = []
      // 轉換時安的回合走到一半：先走完
      for (let i = 0; i < 30 && raw(g).turn !== raw(g).pc; i++) out.push(next(g))
      out.push(act(g, { kind: 'dominate' }))
      out.push(act(g, { kind: 'end_turn' }))
      for (let i = 0; i < 30 && sceneRawOf(g.state) && raw(g).turn !== raw(g).pc; i++) out.push(next(g))
      out.push(act(g, { kind: 'tease' }))
      out.push(act(g, { kind: 'stop' }))
      return out
    }
    const a = run(ref)
    const b = run(old)
    expect(b).toEqual(a)
    expect(JSON.stringify([old.state.actors, old.state.meters, old.state.rng])).toBe(JSON.stringify([ref.state.actors, ref.state.meters, ref.state.rng]))
    expect(sceneRawOf(old.state)).toBeNull()
  })

  it('舊存檔沒有檔位欄位（gear、max_gear、shifted、sink_gain、turn_began）時補成標準檔，接著照常做', () => {
    const [ref, old] = twin()
    old.state.ext.scene = toLegacy(raw(ref), true) as never
    const v = sceneView(old.k, old.state)!
    expect(v.seats[0]!.gear).toMatchObject({ now: 'standard', max: 'standard', shifted: false })
    expect(v.seats[1]!.gear).toMatchObject({ now: 'standard', max: 'standard' })
    for (let i = 0; i < 30 && raw(old).turn !== raw(old).pc; i++) next(old)
    act(old, { kind: 'talk', pick: talkParts })
    expect(sceneRawOf(old.state)!.seats[0]!.gear).toBe('standard')
  })

  it('壞掉的舊紀錄（只有 id）：sceneRawOf 不丟例外', () => {
    const g = game()
    g.state.ext.scene = { id: 'x' } as never
    expect(() => sceneRawOf(g.state)).not.toThrow()
    expect(sceneRawOf(g.state)!.v).toBe(2)
  })
})

// ======================================================================
describe('env.moves：外面給的一串行動', () => {
  /** 主角說一句話接上連接、把回合交給安（主動權在主角手上：安不能切換體位）。 */
  const toAnn = (g: Game): void => {
    begin(g)
    act(g, { kind: 'talk', text: '你好', pick: talkParts })
    act(g, { kind: 'end_turn' })
    expect(raw(g).turn).toBe('npc_ann')
  }

  it('三個行動、第二個不合規（沒有主動權卻切換體位）：第一個生效，後兩個沒有；報告的 data 有丟掉的數目與第一個的原因', () => {
    const g = game()
    toAnn(g)
    expect(raw(g).pairs.npc_ann!.init).toBeGreaterThanOrEqual(50)
    // 迎合讓主動權往主角那邊推：之後安還是沒有主動權
    const moves: SceneInput[] = [{ kind: 'yield' }, { kind: 'switch', position: 'pos_behind' }, { kind: 'dominate' }]
    const [r] = next(g, { dice: dice(4, 3, 3), moves: { npc_ann: moves } })
    expect(r!.action).toBe('scene.next')
    // 第一個（迎合）生效：1d6 = 4 打在主角身上、2d6 = 6 打在安自己身上，花 2 點
    const yielded = beatsOf(r!, 'yield')
    expect(yielded).toHaveLength(1)
    expect(yielded[0]!.data).toMatchObject({ target_load: hit(4, 50, 1), my_load: hit(6, 100, 1.5) })
    expect(beatsOf(r!, 'switch')).toHaveLength(0)
    expect(beatsOf(r!, 'dominate')).toHaveLength(0)
    expect(raw(g).position).toBe('pos_face')
    expect(raw(g).seats[1]!.ap).toBe(2)
    // 丟掉的數目與第一個的原因
    const dropped = beatsOf(r!, 'scene.dropped')
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.data).toMatchObject({ actor: 'npc_ann', dropped: 2, done: 1 })
    expect(String((dropped[0]!.data as { reason: string }).reason)).toMatch(/主動權不在對方手上/)
    // 還有行動點：回合還是安的，剩下的照規則走
    expect(raw(g).turn).toBe('npc_ann')
    expect(r!.outcome.summary).not.toMatch(/沒有照做/)
    // 剩下的行動點照規則走：下一次 sceneNext 沒給 moves
    const [r2] = next(g)
    expect(beatsOf(r2!, 'scene.dropped')).toHaveLength(0)
  })

  it('全部合規：照順序做完；行動點用完回合就結算、交回主角', () => {
    const g = game()
    toAnn(g)
    const [r] = next(g, { dice: dice(3, 3, 1, 2, 2, 1), moves: { npc_ann: [{ kind: 'dominate' }, { kind: 'tease' }, { kind: 'restrain' }] } })
    expect(beatsOf(r!, 'dominate')).toHaveLength(1)
    expect(beatsOf(r!, 'tease')).toHaveLength(1)
    expect(beatsOf(r!, 'restrain')).toHaveLength(1)
    expect(beatsOf(r!, 'scene.dropped')).toHaveLength(0)
    // 行動點剛好用完：回合結算，新的一回合輪到主角
    expect(raw(g)).toMatchObject({ round: 2, turn: 'pc' })
    expect(beatsOf(r!, 'round')).toHaveLength(1)
  })

  it('給 stop 被丟掉（場景由玩家結束）：一個都沒做成就照規則挑一個；場景還在', () => {
    const g = game()
    toAnn(g)
    const [r] = next(g, { moves: { npc_ann: [{ kind: 'stop' }, { kind: 'dominate' }] } })
    expect(beatsOf(r!, 'stop')).toHaveLength(0)
    const dropped = beatsOf(r!, 'scene.dropped')[0]!
    expect(dropped.data).toMatchObject({ dropped: 2, done: 0 })
    expect(String((dropped.data as { reason: string }).reason)).toMatch(/停下/)
    expect(sceneRawOf(g.state)).not.toBeNull()
    // 照規則挑了一個行動（有連接：主導、迎合、挑逗之一）
    expect(r!.timeline.some((b) => ['dominate', 'yield', 'tease', 'restrain'].includes(b.tag ?? ''))).toBe(true)
  })

  it('行動點不夠、格式不對、對象不在這一圈的行動都丟掉並說明原因', () => {
    const g = game()
    toAnn(g)
    const reason = (moves: unknown[]): string => {
      const h = game()
      toAnn(h)
      const [r] = next(h, { moves: { npc_ann: moves as SceneInput[] } })
      return String((beatsOf(r!, 'scene.dropped')[0]!.data as { reason: string }).reason)
    }
    expect(reason([{ kind: 'dance' }])).toMatch(/沒有「dance」這種行動/)
    expect(reason([{ kind: 'skill' }])).toMatch(/要指明是哪一個/)
    expect(reason([{ kind: 'dominate', target: 'someone' }])).toMatch(/這一圈裡沒有這個人/)
    expect(reason([{ kind: 'end_turn' }])).toMatch(/沒有這個行動/)
    expect(reason([{ kind: 'dominate' }, { kind: 'dominate' }, { kind: 'dominate' }])).toMatch(/行動點不夠/)
  })

  it('沒給 moves 就全照規則：和以前的 sceneNext 逐欄相同', () => {
    const a = game({ seed: 5 })
    const b = game({ seed: 5 })
    toAnn(a)
    toAnn(b)
    expect(next(a)).toEqual(next(b, { moves: {} }))
    expect(JSON.stringify(a.state.ext)).toBe(JSON.stringify(b.state.ext))
  })

  it('env.gears 與舊的 env.partner_gear 一樣收：回合開頭換到那一檔', () => {
    const a = game()
    toAnn(a)
    next(a, { gears: { npc_ann: 'shallow' } })
    expect(sceneRawOf(a.state)!.seats[1]!.gear).toBe('shallow')
    const b = game()
    toAnn(b)
    next(b, { partner_gear: 'shallow' })
    expect(sceneRawOf(b.state)!.seats[1]!.gear).toBe('shallow')
  })
})

// ======================================================================
describe('env.talk：說話的結果從外面來', () => {
  it('契合 +30：夾在 +10；−20：夾在 −5；不擲檢定（骰子一顆都沒有也行）', () => {
    const g = game()
    begin(g)
    const [r] = act(g, { kind: 'talk', text: '你好', pick: talkParts }, { dice: dice(), talk: { pc: { fit: 30 } } })
    expect(sceneRawOf(g.state)!.pairs.npc_ann!.fit).toBe(30)
    expect(beatsOf(r!, 'talk')[0]!.data).toMatchObject({ fit: 10, goal: 0, source: 'env' })
    expect(beatsOf(r!, 'talk')[0]!.roll).toBeUndefined()
    const h = game()
    begin(h)
    act(h, { kind: 'talk', pick: talkParts }, { dice: dice(), talk: { pc: { fit: -20 } } })
    expect(sceneRawOf(h.state)!.pairs.npc_ann!.fit).toBe(15)
  })

  it('沒給時照現有的檢定：自然 13 成功，契合 +5', () => {
    const g = game()
    begin(g)
    const [r] = act(g, { kind: 'talk', pick: talkParts }, { dice: dice(13) })
    expect(sceneRawOf(g.state)!.pairs.npc_ann!.fit).toBe(25)
    expect(beatsOf(r!, 'talk')[0]!.roll).toBeDefined()
  })

  it('目的的進度夾在 0～+20；沒給目的就不動；agree 記在報告上', () => {
    const g = game()
    begin(g, { ...SETUP, goal: 'info' })
    const [r] = act(g, { kind: 'talk', pick: talkParts }, { dice: dice(), talk: { pc: { fit: 2, goal: 99, agree: true } } })
    expect(sceneRawOf(g.state)!.goal_progress).toBe(20)
    expect(beatsOf(r!, 'talk')[0]!.data).toMatchObject({ goal: 20, agree: true })
    const h = game()
    begin(h, { ...SETUP, goal: 'info' })
    act(h, { kind: 'talk', pick: talkParts }, { dice: dice(), talk: { pc: { fit: 2, goal: -7 } } })
    expect(sceneRawOf(h.state)!.goal_progress).toBe(0)
    const n = game()
    begin(n)
    act(n, { kind: 'talk', pick: talkParts }, { dice: dice(), talk: { pc: { fit: 2, goal: 15 } } })
    expect(sceneRawOf(n.state)!.goal_progress).toBeNull()
  })
})

// ======================================================================
describe('needs：技能與道具要有的條件', () => {
  const keyBlock = (g: Game, id: string): string[] => {
    const o = sceneOptions(g.k, g.state)!
    return o.actions.find((a) => a.id === 'skill')!.choices!.find((c) => c.id === id)!.blocks
  }

  it('沒有那件物品：灰掉並寫出原因（物品的名字）；用不出來；有的時候用得出來', () => {
    const g = game()
    begin(g)
    expect(keyBlock(g, 'nt_key')).toEqual(['要帶著「鑰匙卡」才用得出來。'])
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_key' }))).toMatch(/要帶著「鑰匙卡」/)
    g.state.inventory.push({ id: 'it_key', qty: 1 })
    expect(keyBlock(g, 'nt_key')).toEqual([])
    const [r] = act(g, { kind: 'skill', id: 'nt_key' })
    expect(r!.action).toBe('scene.act')
  })

  it('條件自己寫了 text 就用它', () => {
    const g = game()
    begin(g)
    expect(keyBlock(g, 'nt_note')).toEqual(['要先拿到那張卡。'])
  })

  it('條件的種類沒有人註冊：當作不成立，原因是「這個條件現在還判斷不了。」', () => {
    const g = game()
    begin(g)
    expect(keyBlock(g, 'nt_moon')).toEqual(['這個條件現在還判斷不了。'])
    expect(blocked(() => act(g, { kind: 'skill', id: 'nt_moon' }))).toBe('這個條件現在還判斷不了。')
  })

  it('needs 的格式不對：內容載入時擋下', () => {
    expect(() => makeGame({
      features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature],
      content: [METER_CONTENT, { id: 'bad', content: { night_skill: [{ id: 'nt_bad', name: '壞的', scene: { my_part: ['hand_l'], their_part: ['chest'], needs: 'has_item' } }] } }],
    })).toThrow()
  })
})

// ======================================================================
describe('double：觸手的例外（LEWD_SYSTEM 3.5 節第四點）', () => {
  /** 並坐：左手碰得到胸、背、腿足；完整版，部位自己選。 */
  const tent = (): Game => {
    const g = game()
    begin(g, { ...SETUP, start_position: 'pos_tent', mode: 'full' })
    expect(raw(g).position).toBe('pos_tent')
    return g
  }
  const use = (g: Game, id: string, theirs: string) => act(g, { kind: 'skill', id, pick: { my_part: 'hand_l', their_part: theirs } })
  const linksOf = (g: Game) => raw(g).links.filter((l) => l.mine === 'hand_l').map((l) => [l.source, l.theirs])

  it('double 的技能：同一個部位同時有兩條連接；第三條換掉最早的一條（最多兩條）', () => {
    const g = tent()
    use(g, 'nt_tent', 'chest')
    use(g, 'nt_tent', 'back')
    expect(linksOf(g)).toEqual([['nt_tent', 'chest'], ['nt_tent', 'back']])
    expect(raw(g).links.every((l) => l.double === true)).toBe(true)
    use(g, 'nt_tent', 'legs')
    expect(linksOf(g)).toEqual([['nt_tent', 'back'], ['nt_tent', 'legs']])
  })

  it('一般的技能照舊：同一個部位只留最新的一條', () => {
    const g = tent()
    use(g, 'nt_plain', 'chest')
    use(g, 'nt_plain', 'back')
    expect(linksOf(g)).toEqual([['nt_plain', 'back']])
    expect(raw(g).links[0]!.double).toBeUndefined()
  })

  it('已經有一條 double 以外的連接，double 的技能接上來也不中斷它', () => {
    const g = tent()
    use(g, 'nt_plain', 'chest')
    use(g, 'nt_tent', 'back')
    expect(linksOf(g)).toEqual([['nt_plain', 'chest'], ['nt_tent', 'back']])
    // 對方的那個部位還是一個部位一條：double 的技能接對方被佔著的胸，把原本那一條換掉
    use(g, 'nt_tent', 'chest')
    expect(linksOf(g)).toEqual([['nt_tent', 'back'], ['nt_tent', 'chest']])
  })

  it('一般的技能接上來，把這個部位上的兩條 double 一起換掉', () => {
    const g = tent()
    use(g, 'nt_tent', 'chest')
    use(g, 'nt_tent', 'back')
    use(g, 'nt_plain', 'legs')
    expect(linksOf(g)).toEqual([['nt_plain', 'legs']])
  })

  it('精簡版由程式挑：double 的技能優先選自己還空著的、再選沒滿兩條的', () => {
    const g = game()
    begin(g, { ...SETUP, start_position: 'pos_tent', mode: 'simple' })
    act(g, { kind: 'skill', id: 'nt_tent' })
    act(g, { kind: 'skill', id: 'nt_tent' })
    const l = raw(g).links
    expect(l).toHaveLength(2)
    expect(new Set(l.map((x) => x.theirs)).size).toBe(2)
    expect(l.every((x) => x.mine === 'hand_l')).toBe(true)
  })
})

// ======================================================================
describe('scene.body：部位與部位的敏感度', () => {
  const body = (ans: (actor: string) => { parts?: string[]; sensitivity?: Record<string, number>; tags?: Record<string, string[]> } | undefined, owner = 'body_test'): Feature => ({
    id: owner,
    install(k) {
      k.hooks.on('scene.body', owner, ({ actor }) => ans(actor))
    },
  })
  const annBody = body((a) => (a === 'npc_ann' ? { parts: ['tail'], sensitivity: { back: 20 } } : undefined))
  const open = (g: Game) => begin(g, { ...SETUP, start_position: 'pos_tent', mode: 'full' })
  const skillOf = (g: Game, id: string) => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'skill')!.choices!.find((c) => c.id === id)!

  it('沒有人回答：沒有尾，這個技能灰掉並說對方沒有這個部位', () => {
    const g = game()
    open(g)
    const c = skillOf(g, 'nt_tail')
    expect(c.blocks.join('')).toMatch(/沒有這一項要用的部位/)
    expect(sceneView(g.k, g.state)!.seats[1]!.parts.map((p) => p.id)).not.toContain('tail')
  })

  it('對方多一個部位 tail：體位允許時可以被選、接得上；畫面的部位清單有它', () => {
    const g = game({ features: [annBody] })
    open(g)
    const c = skillOf(g, 'nt_tail')
    expect(c.blocks).toEqual([])
    expect(c.pairs.find((p) => p.their_part === 'tail')).toMatchObject({ my_part: 'hand_r', blocks: [] })
    expect(sceneView(g.k, g.state)!.seats[1]!.parts.map((p) => p.id)).toContain('tail')
    act(g, { kind: 'skill', id: 'nt_tail', pick: { my_part: 'hand_r', their_part: 'tail' } })
    expect(raw(g).links.map((l) => [l.mine, l.theirs])).toEqual([['hand_r', 'tail']])
  })

  it('back 的修正 +20：接他 back 的那一下，受到的感載比接 chest 的多（固定骰子）', () => {
    const run = (features: Feature[], id: string, theirs: string): number => {
      const g = game({ features })
      open(g)
      const [r] = act(g, { kind: 'skill', id, pick: { my_part: 'hand_l', their_part: theirs } }, { dice: dice(4, 4) })
      return (beatsOf(r!, 'skill')[0]!.data as { target_load: number }).target_load
    }
    // 2d6 = 8；並坐的倍率 1：敏感度 100 → ×1.25；back 修正 +20 → 敏感度 120 → ×1.35
    expect(run([annBody], 'nt_chest', 'chest')).toBe(hit(8, 100, 1))
    expect(run([annBody], 'nt_back', 'back')).toBe(hit(8, 120, 1))
    expect(run([annBody], 'nt_back', 'back')).toBeGreaterThan(run([annBody], 'nt_chest', 'chest'))
    // 沒有人回答時和以前一樣：接背與接胸一樣
    expect(run([], 'nt_back', 'back')).toBe(run([], 'nt_chest', 'chest'))
  })

  it('每回合連接自動生效的感載也看那一端的部位：連在 back 上的那一條，結算時受到的比沒有修正的多', () => {
    const settle = (features: Feature[]): number => {
      const g = game({ features })
      open(g)
      act(g, { kind: 'skill', id: 'nt_plain', pick: { my_part: 'hand_l', their_part: 'back' } })
      act(g, { kind: 'end_turn' })
      raw(g).seats[1]!.ap = 0 // 安沒有行動點：這一步直接結算回合
      next(g, { dice: dice(5) }) // 連接每回合 1d6 = 5
      return raw(g).seats[1]!.received
    }
    expect(settle([])).toBe(hit(5, 100, 1))
    expect(settle([annBody])).toBe(hit(5, 120, 1))
    expect(hit(5, 120, 1)).toBeGreaterThan(hit(5, 100, 1))
  })

  it('好幾個回答合起來：部位取聯集、修正相加、標籤取聯集；格式不對的略過', () => {
    expect(mergeBody([
      { parts: ['tail'], sensitivity: { back: 20 }, tags: { tail: ['a'] } },
      { parts: ['tail', 'tentacle'], sensitivity: { back: 5, chest: -3 }, tags: { tail: ['b'], back: ['c'] } },
      undefined, null, { parts: 'x' as never, sensitivity: { back: 'x' as never } },
    ])).toEqual({ parts: ['tail', 'tentacle'], sensitivity: { back: 25, chest: -3 }, tags: { tail: ['a', 'b'], back: ['c'] } })
    const f2 = body((a) => (a === 'npc_ann' ? { parts: ['tentacle'], sensitivity: { back: 10 } } : undefined), 'body_test2')
    const g = game({ features: [annBody, f2] })
    open(g)
    expect(sceneView(g.k, g.state)!.seats[1]!.parts.map((p) => p.id)).toEqual(expect.arrayContaining(['tail', 'tentacle']))
    const [r] = act(g, { kind: 'skill', id: 'nt_back', pick: { my_part: 'hand_l', their_part: 'back' } }, { dice: dice(4, 4) })
    expect((beatsOf(r!, 'skill')[0]!.data as { target_load: number }).target_load).toBe(hit(8, 130, 1))
  })

  it('部位的標籤：回答的 tags 讓精簡版挑部位時優先選有標籤的', () => {
    const tagged = body((a) => (a === 'npc_ann' ? { tags: { back: ['tg_dom'] } } : undefined))
    const g = game({ features: [tagged] })
    begin(g, { ...SETUP, start_position: 'pos_tent', mode: 'simple' })
    // nt_hold 的標籤是 tg_dom：胸與背都空著，有標籤的背優先
    act(g, { kind: 'skill', id: 'nt_hold' })
    expect(raw(g).links[0]!.theirs).toBe('back')
  })
})

// ======================================================================
describe('max_rounds：限回合的場景', () => {
  it('max_rounds: 2：第一回合照常；第二回合結束時收掉，原因是被外面的事打斷', () => {
    const g = game()
    begin(g, { ...SETUP, max_rounds: 2 })
    expect(raw(g).max_rounds).toBe(2)
    act(g, { kind: 'end_turn' })
    partnerTurn(g)
    expect(raw(g)).toMatchObject({ round: 2, turn: 'pc' })
    act(g, { kind: 'end_turn' })
    const reports: Report[] = []
    for (let i = 0; i < 30 && sceneRawOf(g.state); i++) reports.push(...next(g))
    expect(sceneRawOf(g.state)).toBeNull()
    const end = reports[reports.length - 1]!
    expect(end.action).toBe('scene.end')
    expect(end.outcome.result).toBe('interrupted')
    expect(end.outcome.summary).toMatch(/被外面的事打斷了/)
    expect(end.timeline.some((b) => b.tag === 'interrupt')).toBe(true)
  })

  it('沒有 max_rounds 的場景不會被收掉；max_rounds 要是 1 以上的整數', () => {
    const g = game()
    begin(g)
    for (let i = 0; i < 2; i++) {
      act(g, { kind: 'end_turn' })
      partnerTurn(g)
    }
    expect(raw(g).round).toBe(3)
    for (const bad of [0, -1, 1.5, '2']) {
      const h = game()
      expect(startProblems(h.k, h.state, { ...SETUP, max_rounds: bad }).problems).toEqual(['max_rounds 要是 1 以上的整數。'])
    }
  })
})

// ======================================================================
describe('篩選：對象的性別與 NTR', () => {
  it('對象是 futa 而 futa_partner 被關掉：開不起來並有原因', () => {
    const g = game({ ann: { gender: 'futa' }, contentOff: ['futa_partner'] })
    const r = startProblems(g.k, g.state, SETUP)
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatch(/「扶他對象」被你的內容篩選關掉了/)
    expect(r.parsed).toBeUndefined()
    expect(blocked(() => begin(g))).toMatch(/扶他對象/)
    expect(sceneRawOf(g.state)).toBeNull()
  })

  it('五種性別各對一個標籤；關掉別的標籤不影響', () => {
    const cases: Array<[string, string]> = [['male', 'male_partner'], ['female', 'female_partner'], ['femboy', 'femboy_partner'], ['trans_f', 'trans_partner'], ['futa', 'futa_partner']]
    for (const [gender, tag] of cases) {
      const off = game({ ann: { gender }, contentOff: [tag] })
      expect(startProblems(off.k, off.state, SETUP).problems).toHaveLength(1)
      const others = game({ ann: { gender }, contentOff: cases.map((c) => c[1]).filter((t) => t !== tag) })
      expect(startProblems(others.k, others.state, SETUP).problems).toEqual([])
    }
  })

  it('setup.tags 含 ntr 而 ntr 被關掉：開不起來；開著就開得起來', () => {
    const off = game({ contentOff: ['ntr'] })
    const r = startProblems(off.k, off.state, { ...SETUP, tags: ['ntr'] })
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatch(/NTR/)
    expect(startProblems(off.k, off.state, SETUP).problems).toEqual([])
    const on = game()
    expect(startProblems(on.k, on.state, { ...SETUP, tags: ['ntr'] }).problems).toEqual([])
  })
})

// ======================================================================
describe('startProblems 的開場摘要（確認框用）', () => {
  it('誰、性質、身分、目的、會碰到的標籤；內容篩選關掉的標籤不在裡面', () => {
    const g = game({ ann: { gender: 'futa' }, contentOff: ['pc_unwilling'] })
    const r = startProblems(g.k, g.state, { with: ['npc_ann'], nature: 'work', goal: 'please', place: '二樓的房間', tags: ['tg_dom', 'tg_kiss', 'pc_unwilling', 'ntr'], max_rounds: 6 })
    expect(r.problems).toEqual([])
    expect(r.summary).toEqual({
      kind: 'pair', layer: 'meat', mode: 'simple', pc: { id: 'pc', name: '測試主角' }, with: [{ id: 'npc_ann', name: '安' }],
      nature: 'work', nature_name: '工作', role: 'worker', role_name: '工作的人', goal: { id: 'please', name: '取悅' }, place: '二樓的房間',
      tags: [{ id: 'tg_dom', name: '支配' }, { id: 'tg_kiss', name: '親吻' }, { id: 'ntr', name: 'ntr' }],
      filters: [{ tag: 'futa_partner', name: '扶他對象' }, { tag: 'ntr', name: 'NTR' }], max_rounds: 6,
    })
  })

  it('沒有目的、沒有地點、沒寫身分：goal 是 null，身分是「沒有特別的身分」；開不成的時候沒有摘要', () => {
    const g = game()
    const r = startProblems(g.k, g.state, SETUP)
    expect(r.summary).toMatchObject({ goal: null, role: 'none', role_name: '沒有特別的身分', tags: [], with: [{ id: 'npc_ann', name: '安' }] })
    expect(r.summary).not.toHaveProperty('place')
    expect(startProblems(g.k, g.state, { with: ['nobody'], nature: 'mutual' }).summary).toBeUndefined()
  })

  it('內海的場景要有甲板（這一局沒有裝 deck，所以開不起來；開得起來的情形見 M4-scene-net）；layer 寫錯有原因', () => {
    const g = game()
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'net' }).problems).toEqual(['你沒有甲板，進不了內海，開不起這一場。'])
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'sky' }).problems).toEqual(['layer 要是 meat、net 其中一個。'])
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'meat' }).problems).toEqual([])
  })
})

// ======================================================================
describe('target：對誰', () => {
  it('一對一時沒給就是對方；給對方的 id 一樣；給別人或自己被擋下', () => {
    const g = game()
    begin(g)
    expect(blocked(() => act(g, { kind: 'talk', pick: talkParts, target: 'pc' }))).toBe('這一圈裡沒有這個人。')
    expect(blocked(() => act(g, { kind: 'talk', pick: talkParts, target: 'npc_zed' }))).toBe('這一圈裡沒有這個人。')
    expect(() => act(g, { kind: 'talk', pick: talkParts, target: 'npc_ann' })).not.toThrow()
    expect(raw(g).links[0]).toMatchObject({ by: 'pc', to: 'npc_ann' })
    expect(blocked(() => act(g, { kind: 'dominate', target: '' as never }))).toMatch(/target/)
  })
})

// ======================================================================
describe('sceneView 一對一', () => {
  it('原本的欄位（fit、init、links、lines……）照舊（people 拿掉了，用 seats）；多 seats、pairs、circles、kind、layer；position.mult 與 roles、lines 的 who 用角色 id', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'talk', pick: talkParts }, { dice: dice(13) })
    const v = sceneView(g.k, g.state)!
    expect(v.seats[1]!).toMatchObject({ id: 'npc_ann', name: '安', sensitivity: 100, upper: false })
    expect(v.seats[0]!.id).toBe('pc')
    expect(v.turn).toBe('pc')
    expect(v.fit).toBe(25)
    expect(v.init).toBe(55)
    expect(v.holder).toBe('pc')
    expect(v.links.map((l) => [l.by, l.mine_name, l.theirs_name])).toEqual([['pc', '口', '口']])
    expect(v.lines.map((l) => l.who)).toEqual(['pc'])
    expect(v.position.roles).toEqual({ pc: 'a', npc_ann: 'b' })
    expect(v.kind).toBe('pair')
    expect(v.layer).toBe('meat')
    expect(v.seats.map((x) => x.id)).toEqual(['pc', 'npc_ann'])
    expect(v.pairs).toEqual({ npc_ann: { fit: 25, init: 55, first: true, rating: { id: 'poor', name: '不合' }, holder: 'pc' } })
    expect(v.circles).toEqual([])
    // 輪到安之後 turn 是舊名字 partner
    act(g, { kind: 'end_turn' })
    expect(sceneView(g.k, g.state)!.turn).toBe('partner')
    expect(sceneOptions(g.k, g.state)!.turn).toBe('partner')
  })

  it('行動、預覽、選項的數字和座位改造之前一樣（受到的感載、行動點、同步檔位）', () => {
    const g = game()
    begin(g, { ...SETUP, mode: 'full' })
    const o = sceneOptions(g.k, g.state)!
    expect(o.ap).toEqual({ now: 4, max: 4 })
    expect(o.actions.map((a) => a.id)).toEqual(['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear', 'stop'])
    setSceneMode(g.k, 'simple')
    expect(sceneRawOf(g.state)!.mode).toBe('full')
  })
})
