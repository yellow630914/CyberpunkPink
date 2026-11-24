// 驗收測試：dev/work/M3-scene-sync.md（cpp-feature）。規格：LEWD_SYSTEM 3.5 節（第五點「換檔」、受到的感載乘敏感度、同步檔位與體位的倍率）、第 1 節（敏感度的門檻）；
// CORE_RULES 第 5 節；dev/adr/0018 第二節與「實作補記：M3-core-battle」；dev/adr/0016 G6。
// 沿用 M2-scene 測試的假體位與假對象（主角、安 npc_ann）：面對面主角在上位（a，×1.0）、安在 b（×1.5）；主角敏感度 50（×1.0）、安 100（×1.25）；感載上限 35、行動點上限 4。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Origin } from '../../src'
import { ActionBlocked } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Dice, SceneInput, SceneState, SyncGear } from '../../src/features/scene'
import { sceneAct, sceneFeature, sceneNext, sceneOf, sceneOptions, sceneSkip, sceneView, setSceneMode } from '../../src/features/scene'
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
}

/** 主角（有「支配」，會牽著走與慢慢靠近，也學過「坐上來」所以會腿上）與安（npc_ann）。 */
const game = (o: Opts = {}) => gameWith(o).game
function gameWith(o: Opts = {}) {
  const content: ContentPack[] = [PACK, METER_CONTENT]
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

