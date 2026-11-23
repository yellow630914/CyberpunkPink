// 驗收測試：dev/work/M2-scene.md（cpp-feature）。規格：LEWD_SYSTEM 第 3 節（3.5 節是完整的規則）、第 9 節；DATA 第 3 節、第 4 節 adult_scene；
// CORE_RULES 4.2 節；UI 第 10 節；dev/adr/0016 第一節、G6、G11。
// 內容一律用測試自帶的最小假資料：三個基本體位（面對面、從後面、並躺）與一個要學的體位（腿上）、三個假技能、兩件假道具、兩個角色。
// 擲骰：骰面從存檔的亂數導出（scene/<id>/<第幾步>）；要釘死骰面的用 SceneEnv.dice（一串固定的值）。
//
// 數字的約定（下面反覆用到）：主角敏感度 50（受到的感載 ×1.0）、對象敏感度 100（×1.25）；面對面：主角在上位（a，×1.0）、對象在 b（×1.5），所以對象受到的 = 骰 × 1.875、主角 = 骰 × 1.0。
// 感載上限 35、行動點上限 4（意志、反應、魅力都是 10；耐受 30）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Kernel, Origin } from '../../src'
import { ActionBlocked, ContentError, Rng, deriveRng } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { Dice, SceneInput, SceneState } from '../../src/features/scene'
import {
  DEFAULT_SCENE_RULES, sceneAct, sceneFeature, sceneInterrupt, sceneNext, sceneOf, sceneOptions, scenePreview, sceneSkip, sceneView, setSceneMode, startProblems,
} from '../../src/features/scene'
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

// ======================================================================
describe('開場', () => {
  it('開場的主動權：自己的馴化 10、對方 30、兩情相悅 → 55；俘虜再 +30', () => {
    const g = game()
    begin(g)
    expect(S(g).init).toBe(55)
    expect(S(g).fit).toBe(DEFAULT_SCENE_RULES.fit_start)
    const g2 = game()
    begin(g2, { with: ['npc_ann'], nature: 'captive' })
    expect(S(g2).init).toBe(85)
  })

  it('性質與身分的加減：被迫 −35、客人 +20、持約人 +20、工作的人與契約人 −20；工作沒寫身分就當工作的人（不算兩次）；夾在 0～100', () => {
    const init = (setup: Record<string, unknown>, ann = {}) => {
      const g = game(ann)
      begin(g, { with: ['npc_ann'], ...setup })
      return S(g).init
    }
    expect(init({ nature: 'forced' })).toBe(20)
    expect(init({ nature: 'trade', role: 'guest' })).toBe(75)
    expect(init({ nature: 'contract', role: 'holder' })).toBe(75)
    expect(init({ nature: 'contract', role: 'bound' })).toBe(35)
    expect(init({ nature: 'work', role: 'worker' })).toBe(35)
    expect(init({ nature: 'work' })).toBe(35)
    expect(init({ nature: 'captive', role: 'holder' })).toBe(100)
    expect(init({ nature: 'forced', role: 'bound' }, { ann: { ext: { bridge: { ...ANN_BRIDGE, docility: 0 } } } })).toBe(0)
  })

  it('開場：回合 1、輪到主角、雙方行動點從上限開始、契合 20、有目的才有進度；開始的報告 scene.start（adult、social）；沒有花時間', () => {
    const g = game()
    const t = g.state.time
    const [r] = begin(g, { ...SETUP, goal: 'info', place: '二樓的房間' })
    expect(r).toMatchObject({ action: 'scene.start', kind: 'social', adult: true })
    expect(S(g)).toMatchObject({ round: 1, turn: 'pc', step: 0, ap: { pc: 4, partner: 4 }, fit: 20, goal: 'info', goal_progress: 0, place: '二樓的房間', mode: 'simple' })
    expect(g.state.time).toEqual(t)
    const none = game()
    begin(none)
    expect(S(none).goal).toBeNull()
    expect(S(none).goal_progress).toBeNull()
  })

  it('起始的體位：沒寫就挑第一個基本的；寫了而且雙方都會就用它；寫了但對方不會（要學的）改挑基本的', () => {
    const g = game()
    begin(g)
    expect(S(g).position).toBe('pos_face')
    const g2 = game()
    begin(g2, { ...SETUP, start_position: 'pos_behind' })
    expect(S(g2).position).toBe('pos_behind')
    const g3 = game()
    begin(g3, { ...SETUP, start_position: 'pos_lap' }) // 主角會、安不會
    expect(S(g3).position).toBe('pos_face')
    const g4 = game({ annExt: { scene: { positions: ['pos_lap'], skills: [] } } })
    begin(g4, { ...SETUP, start_position: 'pos_lap' })
    expect(S(g4).position).toBe('pos_lap')
  })

  it('主動權在誰手上，誰拿上位：主角 55 拿 a；俘虜的場景（85）也是；被迫（20，在對方手上）主角在 b', () => {
    const g = game()
    begin(g)
    expect(S(g).roles).toEqual({ pc: 'a', partner: 'b' })
    const g2 = game()
    begin(g2, { ...SETUP, nature: 'forced' })
    expect(S(g2).roles).toEqual({ pc: 'b', partner: 'a' })
  })

  it('事件帶出來的設定是 DATA 第 4 節原樣：沒有 with，對象從 circles[0] 去掉主角取得；nature 收 captive；多餘的鍵（when、gate、start_position、tags）不礙事', () => {
    const g = game()
    begin(g, { when: 'always', gate: 'fixed', nature: 'captive', role: 'none', goal: 'none', circles: [['pc', 'npc_ann']], tags: ['tg_dom'] })
    expect(S(g)).toMatchObject({ partner: 'npc_ann', nature: 'captive', goal: null, tags: ['tg_dom'], touched: ['tg_dom'] })
    const g2 = game()
    begin(g2, { nature: 'mutual', circles: [['npc_ann', 'pc']] })
    expect(S(g2).partner).toBe('npc_ann')
  })

  it('開不成：一對一以外（with 兩個人、兩圈、一圈三個人）、沒有對象、對象不存在、對象是自己、性質或目的不合、已經有一場', () => {
    const g = game()
    const why = (setup: unknown): string => startProblems(g.k, g.state, setup).problems.join('')
    expect(why({ with: ['npc_ann', 'x'], nature: 'mutual' })).toMatch(/一對一/)
    expect(why({ circles: [['pc', 'npc_ann'], ['a', 'b']], nature: 'mutual' })).toMatch(/一對一.*不分圈/)
    expect(why({ circles: [['pc', 'npc_ann', 'x']], nature: 'mutual' })).toMatch(/剛好主角加一個人/)
    expect(why({ nature: 'mutual' })).toMatch(/with 或 circles/)
    expect(why({ with: ['nobody'], nature: 'mutual' })).toMatch(/找不到對象/)
    expect(why({ with: ['pc'], nature: 'mutual' })).toMatch(/不能是主角自己/)
    expect(why({ with: ['npc_ann'], nature: 'weird' })).toMatch(/性質/)
    expect(why({ with: ['npc_ann'], nature: 'mutual', goal: 'love' })).toMatch(/目的/)
    expect(why({ with: ['npc_ann'], nature: 'mutual', role: 'boss' })).toMatch(/身分/)
    expect(why('nope')).toMatch(/設定/)
    expect(startProblems(g.k, g.state, SETUP).problems).toEqual([])
    begin(g)
    expect(blocked(() => begin(g))).toMatch(/成人場景進行中|已經有一場/)
    expect(why(SETUP)).toMatch(/已經有一場/)
  })

  it('「主角非自願」關掉：forced 的場景開不起來並有原因；對象非自願關掉：captive；契約支配關掉：contract；別的性質不受影響；狀態沒有變', () => {
    const g = game({ contentOff: ['pc_unwilling', 'target_unwilling', 'contract_dom'] })
    const before = JSON.stringify(g.state.ext)
    expect(blocked(() => begin(g, { ...SETUP, nature: 'forced' }))).toMatch(/主角非自願.*內容篩選關掉/)
    expect(blocked(() => begin(g, { ...SETUP, nature: 'captive' }))).toMatch(/對象非自願/)
    expect(blocked(() => begin(g, { ...SETUP, nature: 'contract' }))).toMatch(/契約支配/)
    expect(JSON.stringify(g.state.ext)).toBe(before)
    expect(sceneOf(g.state)).toBeNull()
    begin(g, { ...SETUP, nature: 'trade' })
    expect(S(g).nature).toBe('trade')
  })

  it('內容篩選關掉的標籤：場景帶的 tags 裡濾掉，不算碰到', () => {
    const g = game({ contentOff: ['tg_dom'] })
    begin(g, { ...SETUP, tags: ['tg_dom', 'tg_kiss'] })
    expect(S(g).tags).toEqual(['tg_kiss'])
  })

  it('沒有人登記 scene 時，事件的 adult_scene 當成沒有（退路在 director；這裡只確認登記了活動）', () => {
    const g = game()
    expect(g.k.activity.get('scene')).toBeDefined()
    expect(g.k.activity.get('scene')!.order).toBe(20)
  })
})

// ======================================================================
describe('九種行動：現在能不能做與原因', () => {
  it('沒有連接時主導、迎合、挑逗被擋並有原因；說話之後有一條連接，三種就能做', () => {
    const g = game()
    begin(g)
    for (const kind of ['dominate', 'yield', 'tease'] as const) expect(blocked(() => sceneAct(g.k, g.state, { kind }))).toBe('還沒有連接：先用技能、道具或說話建立一條。')
    const opts = sceneOptions(g.k, g.state)!
    for (const id of ['dominate', 'yield', 'tease']) expect(opts.actions.find((a) => a.id === id)!.blocks).toEqual(['還沒有連接：先用技能、道具或說話建立一條。'])
    talk(g)
    expect(S(g).links).toHaveLength(1)
    expect(S(g).links[0]).toMatchObject({ by: 'pc', kind: 'talk', mine: 'mouth', theirs: 'mouth' })
    for (const id of ['dominate', 'yield', 'tease']) expect(sceneOptions(g.k, g.state)!.actions.find((a) => a.id === id)!.blocks).toEqual([])
  })

  it('行動點不夠：要幾點、剩幾點；克制、說話不需要連接；停下 0 點', () => {
    const g = game()
    begin(g)
    talk(g) // 4 → 3
    S(g).ap.pc = 1
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'dominate' }))).toBe('行動點不夠：這個行動要 2 點，你只剩 1 點。')
    expect(sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'dominate')!.blocks).toEqual(['行動點不夠：這個行動要 2 點，你只剩 1 點。'])
    S(g).ap.pc = 0
    expect(sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'stop')!.blocks).toEqual([])
  })

  it('不是你的回合：每一種都擋（還沒輪到你）；輪到的時候 sceneNext 才能呼叫（還沒輪到對方）', () => {
    const g = game()
    begin(g)
    expect(blocked(() => sceneNext(g.k, g.state))).toBe('還沒輪到對方。')
    act(g, { kind: 'end_turn' })
    expect(S(g).turn).toBe('partner')
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'restrain' }))).toBe('還沒輪到你。')
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'stop' }))).toBe('還沒輪到你。')
    expect(sceneOptions(g.k, g.state)!.actions.every((a) => a.blocks.length > 0)).toBe(true)
  })

  it('格式不對的輸入被擋（沒有這種行動、技能沒給 id、換體位沒給 position）', () => {
    const g = game()
    begin(g)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'fly' } as never))).toMatch(/沒有「fly」這種行動/)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill' } as never))).toMatch(/要指明/)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'switch' } as never))).toMatch(/要指明/)
    expect(blocked(() => sceneAct(g.k, g.state, null as never))).toMatch(/要給一個行動/)
  })

  it('sceneOptions 一次列出九種行動，順序是主導、迎合、挑逗、克制、技能、說話、道具、切換體位、停下；花費照表', () => {
    const g = game()
    begin(g)
    const o = sceneOptions(g.k, g.state)!
    expect(o.actions.map((a) => [a.id, a.ap])).toEqual([['dominate', 2], ['yield', 2], ['tease', 1], ['restrain', 1], ['skill', 1], ['talk', 1], ['item', 0], ['switch', 1], ['stop', 0]])
    expect(o.ap).toEqual({ now: 4, max: 4 })
    expect(o.turn).toBe('pc')
    expect(o.actions.find((a) => a.id === 'item')!.blocks).toEqual(['你身上沒有在場景裡用得出來的東西。'])
  })

  it('說話要選的部位照戰鬥 picks 的樣子宣告（key、label、kind、required、options 附原因）：精簡版不用選、完整版要選', () => {
    const g = game()
    begin(g)
    const talkOpt = sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'talk')!
    expect(talkOpt.picks.map((p) => [p.key, p.kind, p.required])).toEqual([['my_part', 'choice', false], ['their_part', 'choice', false]])
    // 面對面：口接口、左手接胸、右手接胸、左手接後
    expect(talkOpt.picks[0]!.options.map((x) => [x.value, x.blocks.length === 0])).toEqual([['mouth', true], ['hand_l', true], ['hand_r', true]])
    expect(talkOpt.pairs.filter((x) => x.blocks.length === 0).map((x) => `${x.my_part}>${x.their_part}`)).toEqual(['mouth>mouth', 'hand_l>chest', 'hand_l>back', 'hand_r>chest'])
    const full = game()
    begin(full, { ...SETUP, mode: 'full' })
    const f = sceneOptions(full.k, full.state)!.actions.find((a) => a.id === 'talk')!
    expect(f.picks.every((p) => p.required)).toBe(true)
    expect(f.blocks).toEqual([]) // 能不能做看的是現在的狀況；選部位是另外的宣告
    expect(blocked(() => act(full, { kind: 'talk' }))).toBe('要選用你的哪個部位。要選接對方的哪個部位。')
  })
})

// ======================================================================
describe('主導、迎合、挑逗、克制（固定骰面驗數字）', () => {
  /** 已經說過話（口↔口連接）的場景：主角剩 3 點；契合 25（20 ＋ 說話成功 5）；主動權 55。 */
  const linked = (o: Opts = {}) => {
    const g = game(o)
    begin(g)
    talk(g)
    return g
  }

  it('說話：魅力加交涉或誘惑對 13；成功契合 +5、大成功 +10、失敗 −2、大失敗 −5；花 1 點；連接沒有持續的數值', () => {
    const fit = (n: number) => {
      const g = game()
      begin(g)
      talk(g, n)
      return [S(g).fit, S(g).ap.pc] as const
    }
    expect(fit(20)).toEqual([30, 3]) // 自然 20：大成功
    expect(fit(13)).toEqual([25, 3])
    expect(fit(9)).toEqual([18, 3])
    expect(fit(1)).toEqual([15, 3])
    const g = linked()
    expect(S(g).links[0]!.link).toEqual({ my_load: 0, their_load: 0, fit: 0 })
    expect(g.state.reports.at(-1)!.timeline.some((b) => b.roll?.dc === 13)).toBe(true)
  })

  it('說話有目的時推進：成功 +12、大成功 +20（一次最多 +20）；沒有目的就沒有進度', () => {
    const g = game()
    begin(g, { ...SETUP, goal: 'info' })
    talk(g, 13)
    expect(S(g).goal_progress).toBe(12)
    act(g, { kind: 'talk', pick: talkParts }, dice(20))
    expect(S(g).goal_progress).toBe(32)
  })

  it('主導：對方 +2d6、自己 +1d6（乘各自的敏感度與體位倍率）、契合 +2、主動權 +10、花 2 點', () => {
    const g = linked()
    act(g, { kind: 'dominate' }, dice(3, 4, 2))
    expect(ann(g).load).toBe(hit(7, 100, 1.5)) // 13
    expect(pc(g).load).toBe(hit(2, 50, 1))
    expect(ann(g).load).toBe(13)
    expect(S(g)).toMatchObject({ fit: 27, init: 65 })
    expect(S(g).ap.pc).toBe(1)
    const r = g.state.reports.at(-1)!
    expect(r.action).toBe('scene.act')
    expect(r.timeline[0]!.data).toMatchObject({ target_load: 13, my_load: 2, fit: 2, init: 10 })
  })

  it('迎合：對方 +1d6、自己 +2d6、契合 +8、主動權 −10、花 2 點', () => {
    const g = linked()
    act(g, { kind: 'yield' }, dice(5, 3, 6))
    expect(ann(g).load).toBe(hit(5, 100, 1.5))
    expect(pc(g).load).toBe(hit(9, 50, 1))
    expect(S(g)).toMatchObject({ fit: 33, init: 45 })
    expect(S(g).ap.pc).toBe(1)
  })

  it('挑逗：雙方各 +1d6、契合 +4、主動權 +5、花 1 點；下一個行動多 1 顆骰（只加在第一組有骰子的上）', () => {
    const g = linked()
    act(g, { kind: 'tease' }, dice(2, 3))
    expect(ann(g).load).toBe(hit(2, 100, 1.5))
    expect(pc(g).load).toBe(hit(3, 50, 1))
    expect(S(g)).toMatchObject({ fit: 29, init: 60, teased: { pc: true, partner: false } })
    expect(S(g).ap.pc).toBe(2)
    // 下一個行動：主導的對方骰是 3d6（多一顆），自己仍是 1d6
    act(g, { kind: 'dominate' }, dice(1, 1, 1, 4))
    expect(ann(g).load).toBe(hit(2, 100, 1.5) + hit(3, 100, 1.5))
    expect(pc(g).load).toBe(hit(3, 50, 1) + hit(4, 50, 1))
    expect(S(g).teased.pc).toBe(false)
  })

  it('克制：自己的感載 −（2＋意志調整值），花 1 點；連接不斷', () => {
    const g = linked()
    g.state.actors.pc!.load = 10
    act(g, { kind: 'restrain' })
    expect(pc(g).load).toBe(8)
    expect(S(g).links).toHaveLength(1)
    expect(S(g).restrained.pc).toBe(true)
    expect(S(g).ap.pc).toBe(2)
    // 意志 14（調整值 +2）：−4
    const g2 = game({ pc: { attrs: { resolve: 14 } } })
    begin(g2)
    g2.state.actors.pc!.load = 10
    act(g2, { kind: 'restrain' })
    expect(pc(g2).load).toBe(6)
  })

  it('每一層餘韻讓自己造成的感載與契合 +10%（主角帶著 2 層餘韻：對方的感載 ×1.2、契合 +2 變 +2.4 四捨五入）', () => {
    const g = game({ pc: { afterglow: 2 } })
    begin(g)
    talk(g) // 契合 +5 ×1.2 = 6
    expect(S(g).fit).toBe(26)
    act(g, { kind: 'dominate' }, dice(3, 4, 2))
    expect(ann(g).load).toBe(hit(7, 100, 1.5, 2))
    expect(pc(g).load).toBe(hit(2, 50, 1, 2))
    expect(S(g).fit).toBe(26 + Math.round(2 * 1.2))
  })

  it('行動點用完回合就交給對方；沒用完的可以用 end_turn 交出去，留到下回合', () => {
    const g = linked()
    act(g, { kind: 'dominate' }, dice(1, 1, 1)) // 剩 1
    expect(S(g).turn).toBe('pc')
    act(g, { kind: 'tease' }, dice(1, 1)) // 剩 0
    expect(S(g).turn).toBe('partner')
    const h = linked()
    act(h, { kind: 'end_turn' })
    expect(S(h)).toMatchObject({ turn: 'partner' })
    expect(S(h).ap.pc).toBe(3)
  })
})

// ======================================================================
describe('技能、道具與連接', () => {
  const learned = (o: Opts = {}) => {
    const g = game(o)
    begin(g)
    return g
  }

  it('技能建立連接並生效：用出去的那一下照 on_use；之後每回合自動生效一次（持續的數值照 link）', () => {
    const g = learned()
    // 牽著走：左手接對方的胸；2d6 [3,4] 對方、1d6 [2] 自己、契合 +4、主動權 +15
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(3, 4, 2))
    expect(S(g).links).toHaveLength(1)
    expect(S(g).links[0]).toMatchObject({ by: 'pc', kind: 'skill', source: 'nt_hold', mine: 'hand_l', theirs: 'chest', link: { their_load: '1d6', my_load: 0, fit: 1 } })
    expect(ann(g).load).toBe(hit(7, 100, 1.5))
    expect(pc(g).load).toBe(hit(2, 50, 1))
    expect(S(g)).toMatchObject({ fit: 24, init: 70 })
    expect(S(g).ap.pc).toBe(2)
    expect(S(g).touched).toContain('tg_dom')
    // 回合結算：連接生效一次（對方 +1d6 [4]、契合 +1），上位推主動權 +3，感載自然消退 2
    act(g, { kind: 'end_turn' })
    next(g, dice(1, 1, 1, 1, 1, 1, 1, 1)) // 對方的行動：沒有技能、有連接，加權抽（骰面全 1）
    expect(S(g).round).toBeGreaterThanOrEqual(1)
  })

  it('每回合自動生效一次：sceneNext 的結算（固定骰面、對方沒有行動點）', () => {
    const g = learned()
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(3, 4, 2))
    const loadAnn = ann(g).load
    const fit = S(g).fit
    const init = S(g).init
    act(g, { kind: 'end_turn' })
    S(g).ap.partner = 0
    next(g, dice(5)) // 連接：對方 1d6 = 5
    expect(ann(g).load).toBe(loadAnn + hit(5, 100, 1.5) - 2) // 自然消退 2 + 意志調整值 0
    expect(S(g).fit).toBe(fit + 1)
    expect(S(g).init).toBe(init + 3) // 主角在上位：+3
    expect(S(g)).toMatchObject({ round: 2, turn: 'pc' })
    expect(S(g).ap.pc).toBe(4) // 2 點留著 + 3 回復，上限 4
    expect(S(g).ap.partner).toBe(3)
  })

  it('同一個部位再用另一個技能，前一條斷掉；用另一個部位去接對象的同一個部位，也把那一條換掉；不相干的連接留著', () => {
    const g = learned()
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    expect(S(g).links.map((l) => l.source)).toEqual(['nt_hold'])
    // 同一個部位（左手）做說話：左手接對方的後背
    act(g, { kind: 'talk', pick: { my_part: 'hand_l', their_part: 'back' } }, dice(13))
    expect(S(g).links.map((l) => [l.source, l.mine, l.theirs])).toEqual([['talk', 'hand_l', 'back']])
    // 口接口（新的一條）；再用右手接對方的口？右手碰不到口 → 用右手接胸：不相干，兩條都在
    act(g, { kind: 'end_turn' })
    S(g).turn = 'pc'
    S(g).ap.pc = 4
    act(g, { kind: 'talk', pick: talkParts }, dice(13))
    expect(S(g).links.map((l) => [l.mine, l.theirs])).toEqual([['hand_l', 'back'], ['mouth', 'mouth']])
    // 右手接胸（新的）；然後左手改接胸（對象的胸被右手佔著 → 右手那一條被換掉；左手原本接後背的那一條也斷）
    act(g, { kind: 'talk', pick: { my_part: 'hand_r', their_part: 'chest' } }, dice(13))
    expect(S(g).links.map((l) => [l.mine, l.theirs])).toEqual([['hand_l', 'back'], ['mouth', 'mouth'], ['hand_r', 'chest']])
    S(g).ap.pc = 4
    act(g, { kind: 'talk', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(13))
    expect(S(g).links.map((l) => [l.mine, l.theirs])).toEqual([['mouth', 'mouth'], ['hand_l', 'chest']])
  })

  it('切換體位：全部的連接重置（精簡版再照新體位把能接的接回）；完整版重置之後是空的', () => {
    const g = game()
    begin(g, { ...SETUP, mode: 'full' })
    talk(g)
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    expect(S(g).links).toHaveLength(2)
    act(g, { kind: 'switch', position: 'pos_behind' })
    expect(S(g)).toMatchObject({ position: 'pos_behind', links: [] })
    expect(g.state.reports.at(-1)!.timeline[0]!.text).toMatch(/連接全部重來/)
  })

  it('精簡版切換體位之後，照新體位把剛才那幾條能接的接回：說話 口↔口 在從後面碰不到，改接別的能接的；牽著走照樣', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    act(g, { kind: 'talk' }, dice(13)) // 精簡版不給部位：引擎挑
    expect(S(g).links.map((l) => l.source)).toEqual(['nt_hold', 'talk'])
    const apBefore = S(g).ap.pc
    act(g, { kind: 'switch', position: 'pos_behind' })
    expect(S(g).ap.pc).toBe(apBefore - 1) // 接回不花行動點
    expect(S(g).links.map((l) => l.source)).toEqual(['nt_hold', 'talk'])
    expect(S(g).links.every((l) => g.k.content.require('position', 'pos_behind') && ['hand_l', 'hand_r', 'front', 'mouth'].includes(l.mine))).toBe(true)
    // 接回的連接帶著原本持續的數值，沒有再用出去一下（感載沒有多）
    expect(S(g).links[0]!.link).toEqual({ my_load: 0, their_load: '1d6', fit: 1 })
  })

  it('主動權在對方手上時換體位被擋；你不會的體位被擋；已經是這個體位被擋；體位的原因列在 sceneView.positions', () => {
    const g = game()
    begin(g)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'switch', position: 'pos_face' }))).toBe('已經是這個體位了。')
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'switch', position: 'nope' }))).toBe('沒有這個體位。')
    S(g).init = 40
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'switch', position: 'pos_behind' }))).toBe('主動權不在你手上：換不換體位由對方決定。')
    const v = sceneView(g.k, g.state)!
    expect(v.holder).toBe('partner')
    expect(v.positions.find((p) => p.id === 'pos_behind')!.blocks).toEqual(['主動權不在你手上：換不換體位由對方決定。'])
    // 主角學過坐上來所以會腿上；換掉主角的技能清單，就不會了
    S(g).init = 60
    act(g, { kind: 'switch', position: 'pos_lap' })
    expect(S(g).position).toBe('pos_lap')
    const h = game({ pcExt: { scene: { skills: [], positions: [] } } })
    begin(h)
    expect(blocked(() => sceneAct(h.k, h.state, { kind: 'switch', position: 'pos_lap' }))).toBe('你還不會「腿上」：要先學會開放它的夜課技能。')
  })

  it('體位碰不到的部位組合被擋：從後面口接口碰不到；技能寫了 positions 的只能在那個體位用', () => {
    const g = game()
    begin(g, { ...SETUP, start_position: 'pos_behind' })
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'talk', pick: talkParts }))).toBe('從後面碰不到：你的口接不到對方的口，換一個體位。')
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_kiss', pick: talkParts }))).toMatch(/要在面對面才用得出來，現在是從後面/)
    // 技能的部位不在清單裡
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'mouth', their_part: 'chest' } }))).toMatch(/用不了你的「口」：只能用左手、右手/)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'front' } }))).toMatch(/接不到對方的「前」：只能接胸、後/)
    // 從後面：左手接胸碰得到
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    expect(S(g).links[0]).toMatchObject({ mine: 'hand_l', theirs: 'chest' })
  })

  it('沒有那個標籤的技能被擋並有原因（對方也有那個標籤時契合 +12）', () => {
    const g = game({ pcExt: { tendency: { axes: {}, points: {}, tags: {} } } })
    begin(g)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }))).toBe('要有「支配」的標籤（或對應的調校、道具、服裝）才用得出來。')
    const h = game({ annExt: { tendency: { axes: {}, points: {}, tags: { tg_dom: 'deep' } } } })
    begin(h)
    act(h, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    expect(S(h).fit).toBe(20 + 4 + 12)
  })

  it('你還沒學會的技能、沒有這個技能被擋', () => {
    const g = game({ pcExt: { scene: { skills: ['nt_kiss'], positions: [] } } })
    begin(g)
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }))).toBe('你還沒有學會「牽著走」。')
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_nope', pick: { my_part: 'hand_l', their_part: 'chest' } }))).toBe('沒有這個技能。')
  })

  it('道具：身上要有；自己算一個部位（toy）接對方的前或胸；消耗品用掉就少一個；沒有部位的道具（藥）不建立連接', () => {
    const g = game()
    g.state.inventory.push({ id: 'it_toy', qty: 1 }, { id: 'it_calm', qty: 2 })
    begin(g)
    act(g, { kind: 'item', id: 'it_toy', pick: { my_part: 'toy', their_part: 'chest' } }, dice(4))
    expect(S(g).links[0]).toMatchObject({ kind: 'item', source: 'it_toy', mine: 'toy', theirs: 'chest' })
    expect(ann(g).load).toBe(hit(4, 100, 1.5))
    expect(S(g).fit).toBe(22)
    expect(g.state.inventory.find((x) => x.id === 'it_toy')!.qty).toBe(1) // 玩具不消耗
    pc(g).load = 9
    act(g, { kind: 'item', id: 'it_calm' }, dice(3))
    expect(pc(g).load).toBe(6) // −1d6
    expect(g.state.inventory.find((x) => x.id === 'it_calm')!.qty).toBe(1)
    expect(S(g).links).toHaveLength(1)
    const choices = sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'item')!.choices!
    expect(choices.map((c) => c.id)).toEqual(['it_toy', 'it_calm'])
    // 沒有道具
    const h = game()
    begin(h)
    expect(blocked(() => sceneAct(h.k, h.state, { kind: 'item', id: 'it_toy', pick: { my_part: 'toy', their_part: 'chest' } }))).toBe('你身上沒有「脈衝環」。')
    expect(blocked(() => sceneAct(h.k, h.state, { kind: 'item', id: 'nothing' }))).toBe('這件東西在場景裡用不出來。')
  })

  it('技能的選項：sceneOptions 列出每個技能的花費、原因、要選的部位與每一組合能不能接', () => {
    const g = game()
    begin(g)
    const skill = sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'skill')!
    expect(skill.choices!.map((c) => [c.id, c.ap, c.blocks])).toEqual([['nt_hold', 2, []], ['nt_kiss', 1, []]])
    const hold = skill.choices![0]!
    expect(hold.picks.map((p) => p.key)).toEqual(['my_part', 'their_part'])
    // 面對面：左手可以接胸與後，右手只能接胸
    expect(hold.pairs.filter((p) => p.blocks.length === 0).map((p) => `${p.my_part}>${p.their_part}`)).toEqual(['hand_l>chest', 'hand_l>back', 'hand_r>chest'])
    expect(hold.pairs.find((p) => p.my_part === 'hand_r' && p.their_part === 'back')!.blocks).toEqual(['面對面碰不到：你的右手接不到對方的後，換一個體位。'])
    expect(hold.preview).toMatchObject({ ap: 2, fit: 4, init: 15, link: true })
    expect(hold.preview.target_load).toMatchObject({ dice: '2d6', mult: 1.88, min: 4, max: 23 })
  })

  it('精簡版沒給部位由引擎挑：空著的優先；都佔著換掉最早建立的那一條', () => {
    const g = game()
    begin(g)
    // 牽著走：左手（接胸、後）、右手（接胸）。第一次：左手接胸（清單第一個能接的）
    act(g, { kind: 'skill', id: 'nt_hold' }, dice(1, 1, 1))
    expect(S(g).links.map((l) => [l.mine, l.theirs])).toEqual([['hand_l', 'chest']])
    act(g, { kind: 'end_turn' })
    S(g).turn = 'pc'
    S(g).ap.pc = 4
    // 第二次：左手與對方的胸都佔著；右手接胸 → 對方的胸被佔；左手接後 → 左手被佔。找得到兩端都空的嗎？右手接後碰不到。都佔著 → 換掉最早的那一條
    act(g, { kind: 'skill', id: 'nt_hold' }, dice(1, 1, 1))
    expect(S(g).links).toHaveLength(1)
    expect(S(g).links[0]!.id).toBe(2)
    // 用口：口接口，空著，不動左手那一條
    S(g).ap.pc = 4
    act(g, { kind: 'talk' }, dice(13))
    expect(S(g).links.map((l) => l.mine)).toContain('mouth')
    expect(S(g).links).toHaveLength(2)
  })

  it('有對應標籤的部位優先（actor.ext.scene.part_tags）：兩端都空時，挑標了這個技能的標籤的那一個', () => {
    const g = game({ pcExt: { scene: { skills: ['nt_hold'], positions: [], part_tags: { hand_r: ['tg_dom'] } } } })
    begin(g)
    act(g, { kind: 'skill', id: 'nt_hold' }, dice(1, 1, 1))
    expect(S(g).links[0]).toMatchObject({ mine: 'hand_r', theirs: 'chest' })
  })

  it('換進有標籤的體位：有那個標籤的人每個人契合 +2，並算碰到那個標籤', () => {
    const g = game({ pcExt: { tendency: { axes: {}, points: {}, tags: { tg_dom: 'has', tg_kiss: 'has' } } } })
    begin(g) // pos_face 的標籤是 tg_kiss：主角有 → +2
    expect(S(g).fit).toBe(22)
    expect(S(g).touched).toContain('tg_kiss')
    const h = game({ pcExt: { tendency: { axes: {}, points: {}, tags: { tg_dom: 'has', tg_kiss: 'has' } } }, annExt: { tendency: { axes: {}, points: {}, tags: { tg_kiss: 'has' } } } })
    begin(h)
    expect(S(h).fit).toBe(24)
  })
})

describe('技能與道具的補充', () => {
  it('精簡版道具沒給部位：自己算一個部位（toy）去接對方碰得到的第一個（面對面：前）', () => {
    const g = game()
    g.state.inventory.push({ id: 'it_toy', qty: 1 })
    begin(g)
    act(g, { kind: 'item', id: 'it_toy' }, dice(2))
    expect(S(g).links[0]).toMatchObject({ mine: 'toy', theirs: 'front' })
    // 完整版沒給部位要擋
    const f = game()
    f.state.inventory.push({ id: 'it_toy', qty: 1 })
    begin(f, { ...SETUP, mode: 'full' })
    expect(blocked(() => sceneAct(f.k, f.state, { kind: 'item', id: 'it_toy' }))).toBe('要選用你的哪個部位。要選接對方的哪個部位。')
  })

  it('對方也會用自己的技能（要有那個標籤、體位對得上）：沒有標籤的技能他用不了，改說話', () => {
    const tags = { tg_dom: 'has' }
    const g = game({ annExt: { scene: { skills: ['nt_hold'], positions: [] }, tendency: { axes: {}, points: {}, tags } } })
    begin(g, { ...SETUP, nature: 'forced' }) // 對方拿上位（面對面的手只有上位那一邊碰得到）
    act(g, { kind: 'end_turn' })
    next(g, dice(0, 1, 1, 1, 1, 1, 1)) // 挑技能（只有一個：0）、2d6、1d6
    expect(S(g).links.map((l) => [l.by, l.source])).toEqual([['partner', 'nt_hold']])
    const h = game({ annExt: { scene: { skills: ['nt_hold'], positions: [] } } }) // 沒有標籤
    begin(h, { ...SETUP, nature: 'forced' })
    act(h, { kind: 'end_turn' })
    next(h)
    expect(h.state.ext.scene && S(h).links.map((l) => [l.by, l.source])).toEqual([['partner', 'talk']])
  })

  it('並躺（沒有上位）：說話可以用手勢接手；體位的標籤與倍率照資料', () => {
    const g = game()
    begin(g, { ...SETUP, start_position: 'pos_lie' })
    act(g, { kind: 'talk', pick: { my_part: 'hand_l', their_part: 'hand_l' } }, dice(13))
    expect(S(g).links[0]).toMatchObject({ mine: 'hand_l', theirs: 'hand_l' })
    expect(S(g).roles).toEqual({ pc: 'a', partner: 'b' })
    expect(sceneView(g.k, g.state)!.position.upper).toBeNull()
    act(g, { kind: 'dominate' }, dice(2, 2, 1))
    expect(ann(g).load).toBe(hit(4, 100, 1)) // 並躺的倍率 ×1
  })

  it('開始與回合的報告：scene.start 用掉一個 uid；每一份場景報告都是 adult、kind social；結算回合多一拍 round', () => {
    const g = game()
    const uid = g.state.seq.uid
    const [start] = begin(g)
    expect(g.state.seq.uid).toBe(uid + 1)
    expect(S(g).id).toBe(`sc${uid + 1}`)
    expect(start!.timeline[0]).toMatchObject({ tag: 'scene.start', data: { with: 'npc_ann', nature: 'mutual', position: 'pos_face' } })
    act(g, { kind: 'end_turn' })
    S(g).ap.partner = 0
    const [r] = next(g)
    expect(r).toMatchObject({ kind: 'social', adult: true, action: 'scene.next' })
    expect(r!.timeline.some((b) => b.tag === 'round' && b.data?.round === 1)).toBe(true)
    expect(g.state.reports.filter((x) => x.action?.startsWith('scene.')).every((x) => x.adult === true && x.kind === 'social')).toBe(true)
  })
})

// ======================================================================
describe('感載、高潮與餘韻', () => {
  it('感載滿了：歸零、餘韻多一層、照樣可以行動、主動權 −15（自己造成的）', () => {
    const g = game({ pc: { load: 33 } })
    begin(g)
    talk(g)
    const init = S(g).init
    // 主導：對方 +2d6 [1,1]；自己 1d6 [5] → 33 + 5 = 38 ≥ 35 → 高潮
    act(g, { kind: 'dominate' }, dice(1, 1, 5))
    expect(pc(g).load).toBe(0)
    expect(pc(g).afterglow).toBe(1)
    expect(S(g).climax.pc).toBe(1)
    expect(S(g).init).toBe(init + 10 - 15)
    expect(S(g).turn).toBe('pc') // 不失去回合
    expect(S(g).ap.pc).toBe(1)
    act(g, { kind: 'tease' }, dice(1, 1)) // 還能行動
    expect(g.state.reports.at(-1)!.action).toBe('scene.act')
    expect(sceneOf(g.state)).not.toBeNull()
  })

  it('對方被你灌滿：他歸零、疊一層餘韻；你讓他高潮，主動權 +10，他自己高潮 −15（對你就是 +15）', () => {
    const g = game({ ann: { load: 30 } })
    begin(g)
    talk(g)
    const init = S(g).init
    act(g, { kind: 'dominate' }, dice(6, 6, 1)) // 12 × 1.875 = 22.5 → 23；30 + 23 ≥ 35
    expect(ann(g).load).toBe(0)
    expect(ann(g).afterglow).toBe(1)
    expect(S(g).init).toBe(Math.min(100, init + 15 + 10 + 10))
    expect(S(g).fit).toBe(25 + 2)
  })

  it('讓對方高潮的人也記到餘韻的增幅：一次高潮不會讓場景結束', () => {
    const g = game({ ann: { load: 34 } })
    begin(g)
    talk(g)
    act(g, { kind: 'dominate' }, dice(1, 1, 1))
    expect(ann(g).afterglow).toBe(1)
    expect(sceneOf(g.state)).not.toBeNull()
  })

  it('主角餘韻疊滿之後又高潮：強制結束（scene.end，原因 pc_out，記下來）；餘韻留在身上', () => {
    const g = game({ pc: { load: 33, afterglow: 3 } })
    begin(g)
    talk(g)
    const rs = act(g, { kind: 'dominate' }, dice(1, 1, 5))
    expect(rs[0]!.action).toBe('scene.end')
    expect(rs[0]!.outcome.result).toBe('pc_out')
    expect(sceneOf(g.state)).toBeNull()
    expect(pc(g).afterglow).toBe(3)
    expect(pc(g).load).toBe(0)
    expect(g.state.reports.at(-1)!.timeline.some((b) => b.text === '你失神了。')).toBe(true)
  })

  it('對方失神：他退出這一場，一對一就結束（partner_out）', () => {
    const g = game({ ann: { load: 34, afterglow: 3 } })
    begin(g)
    talk(g)
    const rs = act(g, { kind: 'dominate' }, dice(1, 1, 1))
    expect(rs[0]!.action).toBe('scene.end')
    expect(rs[0]!.outcome.result).toBe('partner_out')
  })

  it('契合 10 以下過了三回合：強制結束（對方不玩了）；第三回合以前、契合 11 都不結束', () => {
    const settle = (round: number, fit: number) => {
      const g = game()
      begin(g)
      act(g, { kind: 'end_turn' })
      S(g).round = round
      S(g).fit = fit
      S(g).ap.partner = 0
      const rs = next(g)
      return rs[0]!
    }
    expect(settle(3, 10)).toMatchObject({ action: 'scene.end', outcome: { result: 'partner_quit' } })
    expect(settle(5, 0)).toMatchObject({ action: 'scene.end', outcome: { result: 'partner_quit' } })
    expect(settle(2, 0).action).toBe('scene.next')
    expect(settle(3, 11).action).toBe('scene.next')
  })

  it('克制的那一方，這回合連接的自動效果減半', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'skill', id: 'nt_kiss', pick: talkParts }, dice(1, 1)) // 口↔口，持續：對方 +1d6
    act(g, { kind: 'restrain' }) // 主角克制不影響對方的；對方克制才減半
    S(g).restrained.partner = true
    S(g).turn = 'partner'
    S(g).ap.partner = 0
    const before = ann(g).load
    next(g, dice(6)) // 持續 1d6 = 6 → 減半 3 → ×1.875
    expect(ann(g).load).toBe(before + hit(3, 100, 1.5) - 2)
  })

  it('上位的人每回合主動權 +3（對方在上位：往下 3）；並躺沒有上位（initiative_drift 0）', () => {
    const g = game()
    begin(g, { ...SETUP, nature: 'forced' }) // 對方上位
    const init = S(g).init
    act(g, { kind: 'end_turn' })
    S(g).ap.partner = 0
    next(g)
    expect(S(g).init).toBe(init - 3)
    const h = game()
    begin(h, { ...SETUP, start_position: 'pos_lie' })
    const i = S(h).init
    act(h, { kind: 'end_turn' })
    S(h).ap.partner = 0
    next(h)
    expect(S(h).init).toBe(i)
  })

  it('感載每回合自然消退 2 ＋ 意志調整值（最低 0）；每一回合雙方回 3 點行動點，不超過上限', () => {
    const g = game({ ann: { load: 10 }, pc: { load: 1 } })
    begin(g)
    act(g, { kind: 'end_turn' })
    S(g).ap.partner = 0
    next(g)
    expect(ann(g).load).toBe(8)
    expect(pc(g).load).toBe(0)
    expect(S(g).ap).toEqual({ pc: 4, partner: 3 })
  })
})

// ======================================================================
describe('對方的一步（sceneNext）', () => {
  it('亂數是 scene/<id>/<第幾步>：同一個狀態、同一步，骰面一定一樣；每一份場景報告步數 +1', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'end_turn' })
    expect(S(g).step).toBe(1)
    const a = sceneNext(g.k, g.state)
    const b = sceneNext(g.k, g.state)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // 用的就是這個用途的亂數：沒有連接、沒有技能 → 說話，自然骰 = deriveRng(…).int(1, 20)
    const nat = deriveRng(g.state.rng, `scene/${S(g).id}/1`).int(1, 20)
    expect(a.timeline.find((x) => x.roll)!.roll!.natural).toBe(nat)
  })

  it('沒有連接：對方用自己的技能或說話建立一條；有技能就用技能', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'end_turn' })
    next(g)
    expect(S(g).links.map((l) => [l.by, l.source])).toEqual([['partner', 'talk']])
    const h = game({ annExt: { scene: { skills: ['nt_kiss'], positions: [] } } })
    begin(h)
    act(h, { kind: 'end_turn' })
    next(h)
    expect(S(h).links.map((l) => [l.by, l.source, l.mine, l.theirs])).toEqual([['partner', 'nt_kiss', 'mouth', 'mouth']])
  })

  it('有連接：照性質在主導、迎合、挑逗裡加權抽（俘虜幾乎只迎合、被迫幾乎只主導）；亂數固定時結果固定', () => {
    const choose = (nature: string, r: number) => {
      const g = game()
      begin(g, { ...SETUP, nature })
      talk(g)
      act(g, { kind: 'end_turn' })
      const rs = next(g, dice(r, 1, 1, 1, 1))
      return rs[0]!.timeline[0]!.tag
    }
    // 俘虜 { dominate 1, yield 5, tease 2 }：1 → 主導，2～6 → 迎合，7～8 → 挑逗
    expect(choose('captive', 1)).toBe('dominate')
    expect(choose('captive', 2)).toBe('yield')
    expect(choose('captive', 6)).toBe('yield')
    expect(choose('captive', 7)).toBe('tease')
    // 被迫 { 5, 1, 2 }：1～5 主導
    expect(choose('forced', 5)).toBe('dominate')
    expect(choose('forced', 6)).toBe('yield')
  })

  it('自己的感載高時克制（每回合一次）', () => {
    const g = game({ ann: { load: 26 } }) // 35 × 0.7 = 24.5
    begin(g)
    talk(g)
    act(g, { kind: 'end_turn' })
    const rs = next(g)
    expect(rs[0]!.timeline[0]!.tag).toBe('restrain')
    expect(ann(g).load).toBe(24)
    expect(S(g).restrained.partner).toBe(true)
    const again = next(g, dice(1, 1, 1, 1, 1))
    expect(again[0]!.timeline[0]!.tag).not.toBe('restrain')
  })

  it('主動權在他手上而且體位不利時換體位（換成他受到的倍率低、在上位的）；主動權在你手上時不換', () => {
    const g = game({ annExt: { scene: { skills: [], positions: [] } } })
    begin(g, { ...SETUP, nature: 'forced' }) // 主動權 20：在他手上；起始的體位面對面，他在 a（上位、×1.0）
    // 面對面他已經是最好的（×1.0、上位）→ 不換
    talk(g)
    act(g, { kind: 'end_turn' })
    S(g).ap.partner = 2
    const rs = next(g, dice(1, 1, 1, 1, 1))
    expect(rs[0]!.timeline[0]!.tag).not.toBe('switch')
    // 讓他在 b 位（×1.5、不在上位）：把角色換過來
    const h = game()
    begin(h, { ...SETUP, nature: 'forced' })
    S(h).roles = { pc: 'a', partner: 'b' }
    talk(h)
    act(h, { kind: 'end_turn' })
    S(h).init = 30
    S(h).ap.partner = 2
    next(h, dice(1, 1, 1, 1, 1))
    expect(S(h).position).not.toBe('pos_face') // 換了體位
    expect(S(h).roles.partner).toBe('a') // 他拿上位
    // 主動權在你手上：不換
    const i = game()
    begin(i)
    S(i).roles = { pc: 'a', partner: 'b' }
    talk(i)
    act(i, { kind: 'end_turn' })
    S(i).ap.partner = 2
    const r = next(i, dice(1, 1, 1, 1, 1))
    expect(r[0]!.timeline[0]!.tag).not.toBe('switch')
  })

  it('他的行動點用完才結算回合；他還有行動點就留在他的回合（一次一步）', () => {
    const g = game()
    begin(g)
    talk(g)
    act(g, { kind: 'end_turn' })
    expect(next(g, dice(1, 1, 1, 1, 1))[0]!.action).toBe('scene.next')
    expect(S(g)).toMatchObject({ turn: 'partner', round: 1 })
    S(g).ap.partner = 1
    next(g, dice(1, 1, 1, 1, 1, 1))
    expect(S(g)).toMatchObject({ turn: 'pc', round: 2 })
  })

  it('每一步只有一句中性的動作描述（state.ext.scene.lines；沒有數字與露骨的字）', () => {
    const g = game()
    begin(g)
    talk(g)
    act(g, { kind: 'dominate' }, dice(1, 1, 1))
    expect(S(g).lines.map((l) => l.text)).toEqual(['你對安說了幾句話。', '你掌握了節奏。'])
    for (const l of S(g).lines) expect(l.text).not.toMatch(/\d/)
  })
})

// ======================================================================
describe('結束與結算', () => {
  /** 一個把契合定在 fit 的場景，直接按停下。 */
  const finish = (fit: number, o: Opts = {}, setup: Record<string, unknown> = {}, heard?: unknown[]) => {
    const g = game({
      ...o,
      features: [
        ...(heard
          ? [{
              id: 'caller',
              install: (k: Kernel) => {
                k.hooks.on('activity.end', 'caller', (p) => {
                  if (p.kind !== 'scene' || p.origin.by !== 'caller') return
                  heard.push({ outcome: p.outcome, result: p.result, origin: p.origin })
                  return { lines: ['發起的人收到了場景的結果'] }
                })
              },
            } as Feature]
          : []),
        ...(o.features ?? []),
      ],
    })
    begin(g, { ...SETUP, ...setup }, { by: 'caller', ref: 'job1' })
    S(g).fit = fit
    const rs = act(g, { kind: 'stop' })
    return { g, rs, report: rs[0]! }
  }
  const seen = { sex_record: { partners: 1, times: 1, people: { npc_ann: 1 }, positions: ['pos_face'], tags: ['tg_kiss'] } }

  it('停下：契合 62 → 合拍、體悟 15、親密度 +5、餘韻留在角色身上、雙方的性經歷各多一次、activity.end 帶著評價與目的有沒有達成', () => {
    const heard: unknown[] = []
    // 主角已經和這個人有過（沒有「第一次」的加成）、用過面對面、碰過親吻
    const { g, report } = finish(62, { pcExt: seen, pc: { afterglow: 1, load: 5 }, ann: { afterglow: 2 } }, { goal: 'info' }, heard)
    expect(report).toMatchObject({ action: 'scene.end', kind: 'social', adult: true, actor: 'pc' })
    expect(report.outcome.result).toBe('stop')
    expect(sceneOf(g.state)).toBeNull()
    expect(g.state.meters.insight!._).toBe(15)
    expect(g.state.meters.affinity!.npc_ann).toBe(5)
    expect(pc(g).afterglow).toBe(1)
    expect(ann(g).afterglow).toBe(2)
    expect(pc(g).load).toBe(0)
    const rec = (id: string) => g.state.actors[id]!.ext.sex_record as { times: number; partners: number; people: Record<string, number>; positions: string[] }
    expect(rec('pc').times).toBe(2)
    expect(rec('pc').people.npc_ann).toBe(2)
    expect(rec('npc_ann').times).toBe(1)
    expect(rec('npc_ann').people.pc).toBe(1)
    expect(heard).toEqual([{ outcome: 'stop', result: { with: 'npc_ann', fit: 62, rating: '合拍', goal: 'info', goal_done: false, reason: 'stop' }, origin: { by: 'caller', ref: 'job1' } }])
    expect(report.narration!.results).toEqual(expect.arrayContaining(['契合 62：合拍。', '體悟 +15。', '發起的人收到了場景的結果']))
  })

  it('第一次和這個人再 +5；第一次用的體位與碰到的標籤各 +5（起始的體位算用過）', () => {
    const { g } = finish(62)
    // 第一次和這個人 +5、第一次用面對面 +5（沒有標籤）
    expect(g.state.meters.insight!._).toBe(15 + 5 + 5)
    const h = game({ pcExt: { tendency: { axes: {}, points: {}, tags: { tg_dom: 'has', tg_kiss: 'has' } } } })
    begin(h)
    S(h).fit = 62
    act(h, { kind: 'stop' })
    // 面對面的標籤 tg_kiss 主角有：碰到了 → 第一次碰「親吻」+5
    expect(h.state.meters.insight!._).toBe(15 + 5 + 5 + 5)
  })

  it('評價四級：0～29 不合（體悟 5、親密度 −1）、30～59 普通（10、+2）、60～84 合拍（15、+5）、85 以上難忘（20、+8）；邊界', () => {
    const at = (fit: number) => {
      const { g, report } = finish(fit, { pcExt: seen })
      return [report.narration!.results![1], g.state.meters.insight?._ ?? 0, g.state.meters.affinity?.npc_ann ?? 0]
    }
    expect(at(29)).toEqual(['契合 29：不合。', 5, -1])
    expect(at(30)).toEqual(['契合 30：普通。', 10, 2])
    expect(at(59)).toEqual(['契合 59：普通。', 10, 2])
    expect(at(60)).toEqual(['契合 60：合拍。', 15, 5])
    expect(at(84)).toEqual(['契合 84：合拍。', 15, 5])
    expect(at(85)).toEqual(['契合 85：難忘。', 20, 8])
    expect(at(100)).toEqual(['契合 100：難忘。', 20, 8])
  })

  it('親密度：不合 −1；沒有人定義 affinity 的一局整筆略過（不丟錯）', () => {
    const { g } = finish(10, { pcExt: seen })
    expect(g.state.meters.affinity!.npc_ann).toBe(-1)
    const bare = makeGame({
      features: [characterFeature, lewdFeature, sceneFeature], content: [PACK],
      pc: { ext: { bridge: PC_BRIDGE, scene: { skills: [], positions: [] } } }, actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc', ext: { bridge: ANN_BRIDGE } })],
    }).game
    begin(bare)
    S(bare).fit = 70
    expect(() => act(bare, { kind: 'stop' })).not.toThrow()
    expect(bare.state.meters.affinity).toBeUndefined()
    expect(bare.state.meters.insight!._).toBe(15 + 5 + 5)
  })

  it('橋參數：合拍 25%、難忘 50% 的機會讓一項 +1（挑這一場受到最多感載的那一方的敏感度或耐受）；普通與不合沒有；略過沒有', () => {
    // 骰：先擲機率（1～100），再擲 sensitivity／tolerance（0／1）。安的敏感度改成 60，才看得出 +1
    const run = (fit: number, rolls: number[], received: { pc: number; partner: number }) => {
      const g = game({ pcExt: seen, annExt: { bridge: { ...ANN_BRIDGE, sensitivity: 60 } } })
      begin(g)
      S(g).fit = fit
      S(g).received = received
      g.commit(sceneAct(g.k, g.state, { kind: 'stop' }, { dice: dice(...rolls) }))
      return { pc: pc(g).ext.bridge as Record<string, number>, ann: ann(g).ext.bridge as Record<string, number> }
    }
    expect(run(70, [25, 0], { pc: 1, partner: 9 }).ann.sensitivity).toBe(61) // 對方受到最多：他的敏感度
    expect(run(70, [25, 1], { pc: 1, partner: 9 }).ann.tolerance).toBe(31)
    expect(run(70, [26, 1], { pc: 1, partner: 9 }).ann.tolerance).toBe(30) // 合拍只有 25%
    expect(run(70, [25, 0], { pc: 9, partner: 1 }).pc.sensitivity).toBe(51) // 主角受到最多：主角的
    expect(run(90, [50, 1], { pc: 9, partner: 1 }).pc.tolerance).toBe(31) // 難忘 50%
    expect(run(90, [51, 1], { pc: 9, partner: 1 }).pc.tolerance).toBe(30)
    // 普通沒有這一擲
    expect(run(40, [1, 1], { pc: 9, partner: 1 })).toEqual({ pc: PC_BRIDGE, ann: { ...ANN_BRIDGE, sensitivity: 60 } })
    // 略過沒有
    const g = game({ pcExt: seen, annExt: { bridge: { ...ANN_BRIDGE, sensitivity: 60 } } })
    begin(g)
    g.commit(sceneSkip(g.k, g.state, { dice: dice(20) })) // 契合 35 + 5 + 20 = 60：合拍，但略過不給橋參數
    expect((ann(g).ext.bridge as Record<string, number>).sensitivity).toBe(60)
  })

  it('傾向：碰到的標籤各給一個 tendency（沒有人定義的標籤略過）；內容篩選關掉的標籤不給', () => {
    const g = game({ pcExt: { ...seen, tendency: { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_dom: 'has' } } } })
    begin(g)
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    S(g).fit = 40
    act(g, { kind: 'stop' })
    const t = pc(g).ext.tendency as { points: Record<string, number> }
    expect(t.points.relation).toBe(1) // 支配（relation 軸）累積一點
    // 篩選關掉
    const h = game({ contentOff: ['tg_dom'], pcExt: { ...seen, tendency: { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_dom: 'has' } } } })
    begin(h, { ...SETUP, tags: ['tg_dom'] })
    S(h).fit = 40
    act(h, { kind: 'stop' })
    expect((h.state.actors.pc!.ext.tendency as { points: Record<string, number> }).points.relation).toBe(0)
  })

  it('目的達成與否：進度 ≥ 60 才算；activity.end 的 goal_done', () => {
    const done = (progress: number): unknown => {
      const h: Array<{ result: Record<string, unknown> }> = []
      const g = game({
        pcExt: seen,
        features: [{ id: 'caller', install: (k: Kernel) => { k.hooks.on('activity.end', 'caller', (p) => { if (p.kind === 'scene') h.push({ result: p.result }) }) } }],
      })
      begin(g, { ...SETUP, goal: 'please' }, { by: 'caller' })
      S(g).goal_progress = progress
      act(g, { kind: 'stop' })
      return h[0]!.result.goal_done
    }
    expect(done(59)).toBe(false)
    expect(done(60)).toBe(true)
    // 取悅：對方每高潮一次 +20；拖住：每過一回合 +8
    const g = game({ ann: { load: 34 } })
    begin(g, { ...SETUP, goal: 'please' })
    talk(g)
    act(g, { kind: 'dominate' }, dice(1, 1, 1))
    expect(S(g).goal_progress).toBe(12 + 20)
    const s = game()
    begin(s, { ...SETUP, goal: 'stall' })
    act(s, { kind: 'end_turn' })
    S(s).ap.partner = 0
    next(s)
    expect(S(s).goal_progress).toBe(8)
  })

  it('結束的報告在紀錄裡有整場的一句一句（給 AI 寫整場的正文）、結果一行一筆（narration.results）；kind social、adult', () => {
    const g = game()
    begin(g)
    talk(g)
    act(g, { kind: 'dominate' }, dice(1, 1, 1))
    const [r] = act(g, { kind: 'stop' })
    expect(r!.timeline.map((b) => b.text)).toEqual(expect.arrayContaining(['你對安說了幾句話。', '你掌握了節奏。', '你停了下來。']))
    expect(r!.timeline.at(-1)!.tag).toBe('scene.end')
    expect(r!.narration!.results!.length).toBeGreaterThanOrEqual(4)
  })

  it('結束之後完整的正文走 commitNarrated（成人路由）：請求帶 adult、AI 看得到結算的結果；AI 關著就是原樣提交', async () => {
    const { game: g, fake } = gameWith({ fake: true })
    begin(g)
    talk(g)
    const draft = sceneAct(g.k, g.state, { kind: 'stop' })
    expect(g.blockOf(`commit:${draft.action}`, draft)).toBeNull() // 場景進行中放行自己的結束報告
    const r = await g.commitNarrated(draft, { mode: 'new' })
    expect(r.status).toBe('applied')
    expect(sceneOf(g.state)).toBeNull()
    const asked = fake!.requestsFor('narrate')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.adult).toBe(true)
    expect(asked[0]!.messages[0]!.content).toContain('契合 25：不合。')
    const off = game()
    begin(off)
    const plain = await off.commitNarrated(sceneAct(off.k, off.state, { kind: 'stop' }), { mode: 'new' })
    expect(plain.status).toBe('applied')
  })

  it('略過：直接有結果、體悟是七折（沒有行動、沒有用過的體位）；還沒開始操作才能略過', () => {
    const g = game({ pcExt: seen })
    begin(g)
    const rs = g.commit(sceneSkip(g.k, g.state, { dice: dice(0) }))
    expect(rs[0]).toMatchObject({ action: 'scene.end', outcome: { result: 'skip' } })
    // 契合 = 35 + 共同標籤 0 + 對方敏感度 100 → (100 − 50) ÷ 2 = 25 + 亂數 0 = 60 → 合拍 15 分，七折 = 10.5 → 11
    expect(rs[0]!.narration!.results![1]).toBe('契合 60：合拍。')
    expect(g.state.meters.insight!._).toBe(Math.round(15 * 0.7))
    expect(sceneOf(g.state)).toBeNull()
    // 第一次和這個人 +5、體位沒有用（略過）：(15 + 5) × 0.7 = 14
    const h = game()
    begin(h)
    h.commit(sceneSkip(h.k, h.state, { dice: dice(0) }))
    expect(h.state.meters.insight!._).toBe(14)
    // 性經歷照樣記一筆；沒有橋參數的變化
    expect((h.state.actors.pc!.ext.sex_record as { times: number }).times).toBe(1)
    // 已經做了行動就不能略過
    const i = game()
    begin(i)
    talk(i)
    expect(blocked(() => sceneSkip(i.k, i.state))).toMatch(/只能按「停下」/)
  })

  it('略過時共同的標籤讓契合更高（每一個 +15）；目的的進度照契合算', () => {
    const tags = { tg_dom: 'has', tg_kiss: 'has' }
    const g = game({ pcExt: { ...seen, tendency: { axes: {}, points: {}, tags } }, annExt: { tendency: { axes: {}, points: {}, tags } } })
    begin(g, { ...SETUP, goal: 'obey' })
    const rs = g.commit(sceneSkip(g.k, g.state, { dice: dice(0) }))
    expect(rs[0]!.narration!.results![1]).toBe('契合 90：難忘。') // 35 + 30 + 25
    expect(rs[0]!.narration!.results!.join('')).toMatch(/目的「讓對方聽話」：達成了/) // 20 + 45 = 65 ≥ 60 → 70 封頂
  })

  it('被外面打斷：留一個入口，照現在的樣子結算（interrupted）', () => {
    const g = game({ pcExt: seen })
    begin(g)
    talk(g)
    const rs = g.commit(sceneInterrupt(g.k, g.state))
    expect(rs[0]).toMatchObject({ action: 'scene.end', outcome: { result: 'interrupted' } })
    expect(sceneOf(g.state)).toBeNull()
  })

  it('活動結束時發起的人可以要求回到快照（rewind）：和場景的結束同一步', () => {
    const g = game({
      features: [{ id: 'caller', install: (k: Kernel) => { k.hooks.on('activity.end', 'caller', (p) => (p.kind === 'scene' && p.origin.by === 'caller' ? { rewind: { kind: 'entry', summary: '你退了出來。' } } : undefined)) } }],
    })
    g.commit({ kind: 'system', action: 'test.snap', location: {}, party: [], timeline: [], changes: [{ op: 'snapshot.take', kind: 'entry', label: '進入之前' }], outcome: { result: 'ok', summary: '存了快照。' } })
    begin(g, SETUP, { by: 'caller' })
    S(g).fit = 70
    const rs = act(g, { kind: 'stop' })
    expect(rs.at(-1)!.action).toBe('rewind')
    expect(sceneOf(g.state)).toBeNull()
  })
})

// ======================================================================
describe('場景進行中擋住別的事；性經歷；重播', () => {
  it('場景進行中走地圖、交易被擋下；自己的報告放行；結束之後不擋', () => {
    const g = game()
    expect(g.blockOf('grid.move')).toBeNull()
    begin(g)
    expect(g.blockOf('grid.move')).toMatch(/成人場景進行中/)
    expect(g.blockOf('commit:trade.checkout')).toMatch(/成人場景進行中/)
    expect(g.blockOf('chain:free_action')).toMatch(/成人場景進行中/)
    expect(g.blockOf('scene.start')).toMatch(/已經有一場成人場景在進行/)
    expect(g.blockOf('commit:scene.act')).toBeNull()
    expect(g.blockOf('commit:scene.end')).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['scene'])
    S(g).fit = 70
    act(g, { kind: 'stop' })
    expect(g.blockOf('grid.move')).toBeNull()
    expect(g.blockOf('commit:trade.checkout')).toBeNull()
    expect(g.k.activity.active(g.state)).toEqual([])
  })

  it('回到快照之後性經歷還在（其餘的場景結果回去）', () => {
    const g = game()
    g.commit({ kind: 'system', action: 'test.snap', location: {}, party: [], timeline: [], changes: [{ op: 'snapshot.take', kind: 'entry', label: '進入之前' }], outcome: { result: 'ok', summary: '存了快照。' } })
    begin(g)
    S(g).fit = 70
    act(g, { kind: 'stop' })
    expect(g.state.meters.insight!._).toBeGreaterThan(0)
    expect((pc(g).ext.sex_record as { times: number }).times).toBe(1)
    expect(g.rewindToKind('entry', '你退回去了。')).toBeNull()
    expect(g.state.meters.insight).toBeUndefined()
    expect((pc(g).ext.sex_record as { times: number; people: Record<string, number> }).times).toBe(1)
    expect((pc(g).ext.sex_record as { people: Record<string, number> }).people.npc_ann).toBe(1)
    expect((ann(g).ext.sex_record as { times: number }).times).toBe(1)
    expect(pc(g).afterglow).toBe(0)
  })

  /** 一段固定的行動序列（精簡版：不給部位）。 */
  const script = (g: Game) => {
    act(g, { kind: 'talk' })
    act(g, { kind: 'skill', id: 'nt_hold' })
    act(g, { kind: 'end_turn' })
    partnerTurn(g)
    act(g, { kind: 'dominate' })
  }

  it('同一個種子、同樣的行動序列，整場一樣；不同的種子不一樣', () => {
    const run = (seed: number) => {
      const g = game({ seed })
      begin(g)
      script(g)
      return JSON.stringify([g.state.ext.scene, g.state.actors.pc, g.state.actors.npc_ann])
    }
    expect(run(7)).toBe(run(7))
    expect(run(7)).not.toBe(run(8))
  })

  it('進行中存檔再讀，接著做結果相同', () => {
    const a = game()
    begin(a)
    act(a, { kind: 'talk' })
    act(a, { kind: 'skill', id: 'nt_hold' })
    const raw = a.save()
    const b = game()
    expect(b.load(raw)).toBeNull()
    expect(sceneOf(b.state)).toEqual(sceneOf(a.state))
    for (const g of [a, b]) {
      act(g, { kind: 'end_turn' })
      partnerTurn(g)
      act(g, { kind: 'dominate' })
    }
    expect(JSON.stringify(b.state.ext.scene)).toBe(JSON.stringify(a.state.ext.scene))
    expect(JSON.stringify(b.state.actors)).toBe(JSON.stringify(a.state.actors))
  })

  it('完整版與精簡版共用同一套規則與數值：同一個種子、同樣的行動序列，完整版手動選到和自動接一樣的部位時結果相同', () => {
    // 精簡版：不給部位，記下引擎每一步挑的部位
    const simple = game()
    begin(simple, { ...SETUP, mode: 'simple' })
    const picks: Array<{ my_part: string; their_part: string } | undefined> = []
    const last = (g: Game) => {
      const l = S(g).links.at(-1)!
      return { my_part: l.mine, their_part: l.theirs }
    }
    act(simple, { kind: 'talk' })
    picks.push(last(simple))
    act(simple, { kind: 'skill', id: 'nt_hold' })
    picks.push(last(simple))
    act(simple, { kind: 'end_turn' })
    partnerTurn(simple)
    act(simple, { kind: 'dominate' })
    act(simple, { kind: 'skill', id: 'nt_kiss' })
    picks.push(last(simple))
    act(simple, { kind: 'tease' })
    // 完整版：同樣的序列，部位手動選成一樣的
    const full = game()
    begin(full, { ...SETUP, mode: 'full' })
    expect(S(full).mode).toBe('full')
    act(full, { kind: 'talk', pick: picks[0] })
    act(full, { kind: 'skill', id: 'nt_hold', pick: picks[1] })
    act(full, { kind: 'end_turn' })
    partnerTurn(full)
    act(full, { kind: 'dominate' })
    act(full, { kind: 'skill', id: 'nt_kiss', pick: picks[2] })
    act(full, { kind: 'tease' })
    const strip = (g: Game) => {
      const s = clone(S(g)) as unknown as Record<string, unknown>
      delete s.mode
      return JSON.stringify([s, g.state.actors, g.state.rng])
    }
    expect(strip(full)).toBe(strip(simple))
    // 結束之後的結算也一樣（體悟、親密度、性經歷）
    for (const g of [simple, full]) {
      partnerTurn(g)
      act(g, { kind: 'stop' })
    }
    expect(JSON.stringify([full.state.meters, full.state.actors])).toBe(JSON.stringify([simple.state.meters, simple.state.actors]))
    expect(picks.every((p) => p !== undefined)).toBe(true)
  })

  it('設定 scene_mode：預設 simple；setSceneMode 之後下一場生效，進行中的不變；setup.mode 可以蓋掉', () => {
    const g = game()
    begin(g)
    expect(S(g).mode).toBe('simple')
    setSceneMode(g.k, 'full')
    expect(S(g).mode).toBe('simple') // 進行中的不變
    S(g).fit = 70
    act(g, { kind: 'stop' })
    begin(g)
    expect(S(g).mode).toBe('full')
    S(g).fit = 70
    act(g, { kind: 'stop' })
    begin(g, { ...SETUP, mode: 'simple' })
    expect(S(g).mode).toBe('simple')
    expect(() => setSceneMode(g.k, 'weird' as never)).toThrow(/scene_mode/)
  })
})

describe('內容篩選與性質', () => {
  it('標籤被關掉的技能與體位不出現（sceneOptions 沒有、也不能用）', () => {
    const g = game({ contentOff: ['tg_dom'] })
    begin(g)
    const skill = sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'skill')!
    expect(skill.choices!.map((c) => c.id)).toEqual(['nt_kiss'])
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }))).toBe('你還沒有學會「牽著走」。')
    const h = game({ contentOff: ['tg_kiss'] }) // 面對面的標籤：這個體位也跟著不出現
    begin(h)
    expect(S(h).position).toBe('pos_behind')
    expect(sceneView(h.k, h.state)!.positions.map((x) => x.id)).toEqual(['pos_behind', 'pos_lie', 'pos_lap'])
  })

  it('沒有人登記 tendency 與 bridge 的一局：結算照樣做得成（略過那兩種效果）', () => {
    const g = makeGame({
      features: [characterFeature, sceneFeature], content: [{ id: 'p', content: { position: PACK.content.position!, night_skill: PACK.content.night_skill! } }],
      pc: { ext: { scene: { skills: [], positions: [] } } }, actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc' })],
    }).game
    begin(g)
    S(g).fit = 90
    expect(() => act(g, { kind: 'stop' })).not.toThrow()
    expect(g.state.meters.insight!._).toBeGreaterThan(0)
  })
})

describe('隨機走一整場：每一步之後的不變式', () => {
  // 逾時的根因（M2 審查應修 6）：這條走六十個種子、兩千多步，每一步是一次嚴格模式的提交：核心在每一組掛鉤前後把整份狀態複製一份再逐欄比對
  // （檢查掛鉤有沒有偷改狀態），單步約三毫秒，合計八秒多；單獨跑貼著預設的十秒，全量跑（一百多個檔案同時搶機器）就超過。
  // 步數與種子數是這條性質測試的價值所在，不縮小；改成這一條自己的逾時（六十秒），不動全域的 testTimeout。
  it('六十個種子、兩種模式：只丟 ActionBlocked 以外的錯就算失敗；感載、行動點、契合、主動權、連接的部位都在範圍內；結束之後場景乾淨', { timeout: 60_000 }, () => {
    let steps = 0
    for (let seed = 1; seed <= 60; seed++) {
      const g = game({ seed, ann: { load: seed % 7 }, annExt: { scene: { skills: ['nt_kiss'], positions: [] } } })
      g.state.inventory.push({ id: 'it_toy', qty: 1 }, { id: 'it_calm', qty: 3 })
      begin(g, { ...SETUP, mode: seed % 2 ? 'full' : 'simple', nature: (['mutual', 'trade', 'forced', 'captive', 'work', 'contract'] as const)[seed % 6], goal: seed % 3 === 0 ? 'info' : 'none' })
      const rng = new Rng(seed * 7919)
      const sane = () => {
        const s = sceneOf(g.state)
        if (!s) return
        for (const w of ['pc', 'partner'] as const) {
          const a = g.state.actors[w === 'pc' ? s.pc : s.partner]!
          expect(a.load).toBeGreaterThanOrEqual(0)
          expect(a.load).toBeLessThan(40)
          expect(a.afterglow).toBeLessThanOrEqual(3)
          expect(s.ap[w]).toBeGreaterThanOrEqual(0)
          expect(s.ap[w]).toBeLessThanOrEqual(5)
        }
        expect(s.fit).toBeGreaterThanOrEqual(0)
        expect(s.fit).toBeLessThanOrEqual(100)
        expect(s.init).toBeGreaterThanOrEqual(0)
        expect(s.init).toBeLessThanOrEqual(100)
        const used = new Set<string>()
        for (const l of s.links) {
          const by = `${l.by}:${l.mine}`
          const to = `${l.by === 'pc' ? 'partner' : 'pc'}:${l.theirs}`
          expect(used.has(by) || used.has(to)).toBe(false)
          used.add(by)
          used.add(to)
        }
      }
      for (let i = 0; i < 90 && sceneOf(g.state); i++) {
        steps += 1
        const s = sceneOf(g.state)!
        if (s.turn === 'partner') {
          next(g)
        } else {
          const o = sceneOptions(g.k, g.state)!
          const ok: SceneInput[] = [{ kind: 'end_turn' }]
          for (const a of o.actions) {
            if (a.id === 'stop') {
              if (rng.chance(0.03)) ok.push({ kind: 'stop' })
              continue
            }
            if (a.choices) {
              for (const c of a.choices) {
                if (c.blocks.length > 0) continue
                if (a.id === 'switch') ok.push({ kind: 'switch', position: c.id })
                else {
                  const pair = c.pairs.find((x) => x.blocks.length === 0)
                  ok.push({ kind: a.id as 'skill' | 'item', id: c.id, ...(pair ? { pick: { my_part: pair.my_part, their_part: pair.their_part } } : {}) })
                }
              }
              continue
            }
            if (a.blocks.length > 0) continue
            if (a.id === 'talk') {
              const pair = a.pairs.find((x) => x.blocks.length === 0)!
              ok.push({ kind: 'talk', pick: { my_part: pair.my_part, their_part: pair.their_part } })
            } else ok.push({ kind: a.id } as SceneInput)
          }
          act(g, rng.pick(ok))
        }
        sane()
      }
      partnerTurn(g) // 回合在對方手上時 stop 會被擋：先走完對方的回合
      if (sceneOf(g.state)) act(g, { kind: 'stop' })
      expect(sceneOf(g.state)).toBeNull()
      expect(ann(g).load).toBe(0)
      expect(pc(g).load).toBe(0)
      expect((pc(g).ext.sex_record as { times: number }).times).toBe(1)
      expect((ann(g).ext.sex_record as { times: number }).times).toBe(1)
      expect(g.state.meters.insight!._).toBeGreaterThanOrEqual(5)
    }
    expect(steps).toBeGreaterThan(500)
  })
})

// ======================================================================
describe('sceneView：畫面要的全部', () => {
  it('每個人的條、部位哪些連著與碰得到、體位與換得到的、每條連接、目的、契合與主動權', () => {
    const g = game()
    begin(g, { ...SETUP, goal: 'info', place: '二樓' })
    act(g, { kind: 'talk', pick: talkParts }, dice(13))
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(3, 4, 2))
    const v = sceneView(g.k, g.state, { kind: 'dominate' })!
    expect(v).toMatchObject({ round: 1, turn: 'pc', nature: 'mutual', place: '二樓', fit: 29, init: 70, holder: 'pc', fit_marks: [30, 60, 85] })
    expect(v.rating).toEqual({ id: 'poor', name: '不合' })
    expect(v.goal).toEqual({ id: 'info', name: '套話', progress: 12, done_at: 60, done: false })
    expect(v.position).toMatchObject({ id: 'pos_face', name: '面對面', upper: 'pc', mult: { pc: 1, partner: 1.5 }, roles: { pc: 'a', partner: 'b' } })
    expect(v.people.pc).toMatchObject({ name: '測試主角', load: { now: 2, max: 35 }, glow: { now: 0, max: 3 }, ap: { now: 1, max: 4 }, sensitivity: 50, upper: true, climax: 0 })
    expect(v.people.partner).toMatchObject({ id: 'npc_ann', name: '安', load: { now: 13, max: 35 }, sensitivity: 100, upper: false, tags: [] })
    const part = (w: 'pc' | 'partner', id: string) => v.people[w].parts.find((p) => p.id === id)!
    expect(part('pc', 'mouth')).toMatchObject({ linked: true, link: 1, reach: true })
    expect(part('pc', 'hand_r')).toMatchObject({ linked: false, reach: true })
    expect(part('pc', 'hand_l')).toMatchObject({ linked: true, link: 2, reach: true })
    expect(part('pc', 'legs')).toMatchObject({ linked: false, reach: false }) // 面對面碰不到腿足
    expect(part('partner', 'chest')).toMatchObject({ linked: true, link: 2 })
    expect(v.links.map((l) => [l.id, l.by, l.name, l.mine_name, l.theirs_name, l.fresh])).toEqual([[1, 'pc', '說話', '口', '口', true], [2, 'pc', '牽著走', '左手', '胸', true]])
    expect(v.links[1]!.per_round).toMatchObject({ target_load: '1d6', my_load: '0', fit: 1 })
    expect(v.effects.count).toBe(2)
    expect(v.positions.map((p) => p.id)).toEqual(['pos_face', 'pos_behind', 'pos_lie', 'pos_lap'])
    expect(v.selected!.blocks).toEqual(['行動點不夠：這個行動要 2 點，你只剩 1 點。'])
    expect(v.selected!.preview).toMatchObject({ ap: 2, fit: 2, init: 10, link: false })
    expect(v.selected!.preview.target_load).toMatchObject({ dice: '2d6', mult: 1.88, min: 4, max: 23 })
    expect(v.selected!.preview.my_load).toMatchObject({ dice: '1d6', mult: 1, min: 1, max: 6 })
    expect(scenePreview(g.k, g.state, { kind: 'tease' })).toMatchObject({ ap: 1, fit: 4, init: 5 })
    expect(v.lines.map((l) => l.who)).toEqual(['pc', 'pc'])
  })

  it('沒有場景：sceneView、sceneOptions、scenePreview 都是 null', () => {
    const g = game()
    expect(sceneView(g.k, g.state)).toBeNull()
    expect(sceneOptions(g.k, g.state)).toBeNull()
    expect(scenePreview(g.k, g.state, { kind: 'tease' })).toBeNull()
    expect(blocked(() => sceneAct(g.k, g.state, { kind: 'stop' }))).toBe('現在沒有進行中的成人場景。')
  })

  it('精簡版畫面只要「現在有幾條持續效果與大概的數值」：effects.count 與每回合的平均（已乘上倍率）', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'skill', id: 'nt_hold', pick: { my_part: 'hand_l', their_part: 'chest' } }, dice(1, 1, 1))
    const v = sceneView(g.k, g.state)!
    expect(v.effects).toEqual({ count: 1, target_load: Math.round(3.5 * 1.875 * 10) / 10, my_load: 0, fit: 1 })
  })
})

// ======================================================================
describe('內容與規則的格式', () => {
  const bad = (kind: string, entries: unknown[]) => {
    try {
      makeGame({ features: [characterFeature, sceneFeature], content: [{ id: 'x', content: { [kind]: entries } } as ContentPack] })
    } catch (e) {
      if (e instanceof ContentError) return e.problems.join('\n')
      throw e
    }
    return ''
  }
  const pos = (over: Record<string, unknown>) => ({ ...(PACK.content.position![0] as Record<string, unknown>), id: 'p_x', ...over })

  it('體位：M2 只收 people: 2；位置要兩個、links 的位置要對得上、倍率要大於 0、unlocked_by 要查得到技能', () => {
    expect(bad('position', [pos({ people: 3 })])).toMatch(/M2 的場景只收 people: 2/)
    expect(bad('position', [pos({ people: 1 })])).toMatch(/people 要是 2～4/)
    expect(bad('position', [pos({ roles: [{ id: 'a', upper: true }] })])).toMatch(/roles 要有兩個位置/)
    expect(bad('position', [pos({ links: [{ from: ['a', 'mouth'], to: ['c', 'mouth'] }] })])).toMatch(/要是 roles 裡的 id/)
    expect(bad('position', [pos({ links: [{ from: ['a', 'mouth'], to: ['a', 'hand_l'] }] })])).toMatch(/不同的位置/)
    expect(bad('position', [pos({ links: [] })])).toMatch(/links 要是非空/)
    expect(bad('position', [pos({ mult: { a: 1, b: 0 } })])).toMatch(/mult.b/)
    expect(bad('position', [pos({ unlocked_by: 7 })])).toMatch(/unlocked_by/)
    expect(bad('position', [pos({ name: '' })])).toMatch(/name/)
    expect(() => makeGame({ features: [characterFeature, sceneFeature], content: [{ id: 'x', content: { position: [pos({ unlocked_by: 'nt_missing' })] } }] })).toThrow(/nt_missing|引用/)
  })

  it('夜課技能：只看 scene、tag、tags、name，其餘欄位收下不看；scene 的格式要對', () => {
    expect(bad('night_skill', [{ id: 'nt_a', name: 'A', branch: 'zzz', tier: 99, whatever: true }])).toBe('')
    expect(bad('night_skill', [{ id: 'nt_a', name: 'A', scene: { ap: 1, my_part: ['hand_l'] } }])).toMatch(/their_part/)
    expect(bad('night_skill', [{ id: 'nt_a', name: 'A', scene: { ap: 9, my_part: ['hand_l'], their_part: ['chest'] } }])).toMatch(/ap 要是 0～5/)
    expect(bad('night_skill', [{ id: 'nt_a', name: 'A', scene: { my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: 'lots' } } }])).toMatch(/their_load 要是骰/)
    expect(bad('night_skill', [{ id: 'nt_a', name: 'A', scene: { my_part: [], their_part: ['chest'] } }])).toMatch(/至少一個/)
    expect(bad('night_skill', [{ id: 'nt_a', name: 'A', scene: { as_part: 'toy', their_part: ['chest'] } }])).toBe('')
    expect(bad('night_skill', [{ id: 'nt_a', name: '' }])).toMatch(/name/)
  })

  it('道具的 scene 欄位在載入之後查（ready）：格式不對、positions 查不到都擋下', () => {
    const item = (scene: unknown) => ({ id: 'it_x', name: 'X', desc: '測試。', category: 'tool', grade: 1, size: 0, legal: 'free', scene })
    const build = (scene: unknown) => makeGame({ features: [characterFeature, lewdFeature, sceneFeature], content: [PACK, { id: 'y', content: { item: [item(scene)] } }] })
    expect(() => build({ ap: 1, as_part: 'toy', their_part: ['front'] })).not.toThrow()
    expect(() => build({ ap: 1, their_part: ['front'] })).toThrow(/it_x.*my_part 或 as_part/)
    expect(() => build({ ap: 1, as_part: 'toy', their_part: ['front'], positions: ['pos_nope'] })).toThrow(/查不到體位 pos_nope/)
    expect(() => build({ ap: 1, on_use: { my_load: 'x' } })).toThrow(/my_load/)
  })

  it('規則的數字：scene_rule/default 蓋掉內建的；寫錯的鍵與型別被擋；評價表整份換', () => {
    const g = game({ rules: { fit_start: 40, talk_dc: 8, dominate: { fit: 6 }, bands: [{ min: 0, id: 'all', name: '全部', affinity: 1, insight: 7, bridge: 0 }] } })
    begin(g)
    expect(S(g).fit).toBe(40)
    talk(g, 8) // DC 8：自然 8 剛好成功
    expect(S(g).fit).toBe(45)
    act(g, { kind: 'dominate' }, dice(1, 1, 1))
    expect(S(g).fit).toBe(51)
    act(g, { kind: 'stop' })
    expect(g.state.meters.insight!._).toBe(7 + 5 + 5)
    expect(bad('scene_rule', [{ id: 'default', fit_starts: 1 }])).toMatch(/fit_starts：沒有這個規則/)
    expect(bad('scene_rule', [{ id: 'default', fit_start: 'a' }])).toMatch(/fit_start 要是數字/)
    expect(bad('scene_rule', [{ id: 'default', dominate: 3 }])).toMatch(/dominate 要是物件/)
    expect(bad('scene_rule', [{ id: 'default', bands: [{ min: 10, id: 'a', name: 'A', affinity: 0, insight: 1, bridge: 0 }] }])).toMatch(/從 0 起/)
    expect(bad('scene_rule', [{ id: 'default', bands: [] }])).toMatch(/非空的陣列/)
    expect(bad('scene_rule', [{ id: 'default', bands: [{ min: 0 }] }])).toMatch(/要有 min/)
    expect(bad('scene_rule', [{ id: 'default', fit_start: 30, nature_init: { forced: -10 } }])).toBe('')
  })
})

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
