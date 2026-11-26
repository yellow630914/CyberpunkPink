// 驗收測試：dev/work/M4-night-resonance.md（cpp-feature）。NIGHT_LESSONS 二十五個共鳴（共通、關係、感官、身體、扮相各五個）每一個都有一筆資料與一條行為測試；
// 共鳴多的幾種鍵（per_round、link_bonus、keep_extra_links、once、opening、tease_flat、restrain_dice、load_cap、tease_exposure）；
// 學習條件的句型（性經歷裡的身體、外表的性別、量表的 key: 'any'、條件 avatar、只掛軸只認 id）；「對方……」改成技能在場景裡的 needs（條件 target）；buildActor 補 ext.body。
// 內容一律用測試自帶的最小假資料；別的功能（style、contract 條件、曝露度）用測試臨時註冊的替身。骰子一律是最小值（int: (a) => a）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, Kernel } from '../../src'
import { ContentError } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import { learnBlock, learnProblems, nightList, nightclassFeature } from '../../src/features/nightclass'
import { buildActor } from '../../src/features/npcs'
import type { SceneInput, SceneRaw } from '../../src/features/scene'
import { Play, sceneAct, sceneFeature, sceneOptions, sceneRawOf, scenePreview, startProblems } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { makeActor, makeGame } from '../../src/testkit'

// ---- 假內容 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const links = [
  { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['b', 'hand_l'], to: ['a', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['b', 'mouth'], to: ['a', 'mouth'] },
  { from: ['a', 'tail'], to: ['b', 'chest'] }, { from: ['a', 'tail'], to: ['b', 'back'] },
]
const link = (their: string, fit: number) => ({ their_load: their, fit })
const SKILLS = [
  // 手、口、尾各一個有持續效果的技能（持續的契合都是 1）
  { id: 'nt_hand', name: '指腹游走', branch: 'common', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, link: link('1d6', 1) } },
  { id: 'nt_mouth', name: '咬耳朵', branch: 'common', tier: 1, scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], on_use: { their_load: '1d6', fit: 2 }, link: link('1d6', 1) } },
  { id: 'nt_tail', name: '尾巴纏上', branch: 'body', tier: 1, scene: { ap: 1, my_part: ['tail'], their_part: ['back'], on_use: { their_load: '1d6', fit: 2 }, link: link('1d6', 1) } },
  { id: 'nt_mouth_solo', name: '含住指尖', branch: 'common', tier: 1, scene: { ap: 1, my_part: ['mouth'], their_part: ['front'], on_use: { their_load: '1d6', fit: 2 }, link: link('1d6', 1), solo: 'ok' } },
  { id: 'nt_tail_solo', name: '尾巴自纏', branch: 'body', tier: 1, scene: { ap: 1, my_part: ['tail'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, link: link('1d6', 1), solo: 'ok' } },
  // 束縛：掛 tg_bind
  { id: 'nt_bind', name: '繩結', branch: 'relation', tier: 1, tag: 'tg_bind', tags: ['tg_bind'], scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, link: link('1d6', 1) } },
  // 「對方……」的 needs：對方有義體（條件 cyber 的替身）才用得出來；對方有固定的伴
  { id: 'nt_need_cyber', name: '摸摸手臂', branch: 'body', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, needs: [{ kind: 'target', of: { kind: 'cyber', slot: 'arm' } }] } },
  { id: 'nt_need_partnered', name: '別人的故事', branch: 'sense', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, needs: [{ kind: 'target', of: { kind: 'partnered' } }] } },
]
const POSITIONS = [{ id: 'pos_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: null, links }, { id: 'pos_behind', name: '從後面', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: null, links }]

/** 二十五個共鳴（NIGHT_LESSONS 每個分支的共鳴表）：一支一階各一筆，資料就是那張表的白話。 */
const RESONANCES = [
  // 共通
  { id: 'rc1', branch: 'common', tier: 1, name: '看得到軸', scene: { reveal: 'axis' } },
  { id: 'rc2', branch: 'common', tier: 2, name: '第一次切換免費', scene: { free_switch: 1 } },
  { id: 'rc3', branch: 'common', tier: 3, name: '高潮主動權只掉 10', scene: { rules: { climax_init_self: 5 } } },
  { id: 'rc4', branch: 'common', tier: 4, name: '第一條連接契合 +1', scene: { first_link_fit: 1 } },
  { id: 'rc5', branch: 'common', tier: 5, name: '結束契合 +5', scene: { end_fit: 5 } },
  // 關係
  { id: 'rr1', branch: 'relation', tier: 1, name: '開場主動權多 5', scene: { opening: { init: 5, if: 'nature' } } },
  { id: 'rr2', branch: 'relation', tier: 2, name: '束縛時主動權多推 3', scene: { per_round: [{ if: 'bind_link', tag: 'tg_bind', effect: { init: 3 } }] } },
  { id: 'rr3', branch: 'relation', tier: 3, name: '契約對象在場契合 +1', scene: { per_round: [{ if: 'contract_partner', effect: { fit: 1 } }] } },
  { id: 'rr4', branch: 'relation', tier: 4, name: '主動權極端時契合 +1', scene: { per_round: [{ if: 'init_extreme', effect: { fit: 1 } }] } },
  { id: 'rr5', branch: 'relation', tier: 5, name: '主動權直接設成 70 或 30', scene: { once: { kind: 'set_init', values: [70, 30] } } },
  // 感官
  { id: 'rs1', branch: 'sense', tier: 1, name: '挑逗多 1', scene: { tease_flat: 1 } },
  { id: 'rs2', branch: 'sense', tier: 2, name: '口的連接契合 +1', scene: { link_bonus: [{ part: 'mouth', fit: 1 }] } },
  { id: 'rs3', branch: 'sense', tier: 3, name: '有人在看感載 +1', scene: { per_round: [{ if: 'watched', effect: { load: { other: 1 } } }] } },
  { id: 'rs4', branch: 'sense', tier: 4, name: '克制再少 1d3', scene: { restrain_dice: '1d3' } },
  { id: 'rs5', branch: 'sense', tier: 5, name: '每回合第一次挑逗免費', scene: { once: { kind: 'free_tease' } } },
  // 身體
  { id: 'rb1', branch: 'body', tier: 1, name: '多出來的部位契合 +2', scene: { link_bonus: [{ extra_part: true, fit: 2, solo: true }] } },
  { id: 'rb2', branch: 'body', tier: 2, name: '感載上限 +4', scene: { load_cap: 4 } },
  { id: 'rb3', branch: 'body', tier: 3, name: '多出來的部位不重置', scene: { keep_extra_links: true } },
  { id: 'rb4', branch: 'body', tier: 4, name: '餘韻 15%', scene: { rules: { glow_bonus: 0.05 } } },
  { id: 'rb5', branch: 'body', tier: 5, name: '高潮不疊餘韻', scene: { once: { kind: 'no_glow' } } },
  // 扮相
  { id: 'rk1', branch: 'costume', tier: 1, name: '開場契合 +5', scene: { opening: { fit: 5, if: 'own_style' } } },
  { id: 'rk2', branch: 'costume', tier: 2, name: '風格一致契合 +1', scene: { per_round: [{ if: 'style_match', effect: { fit: 1 } }] } },
  { id: 'rk3', branch: 'costume', tier: 3, name: '脫換衣服免費', scene: { once: { kind: 'free_dress' } } },
  { id: 'rk4', branch: 'costume', tier: 4, name: '曝露度加成', scene: { tease_exposure: { per: 1, max: 3 } } },
  { id: 'rk5', branch: 'costume', tier: 5, name: '契合拉到 50', scene: { once: { kind: 'fit_floor', value: 50 } } },
]

const SOLO_POSES = [{ id: 'solo_spread', name: '張腿仰躺', reach: ['front', 'chest', 'mouth', 'legs', 'tail'], hand_only: [], mult: 1, link_pace: {} }]
const PACK: ContentPack = { id: 'night_res_test', content: { night_skill: SKILLS, position: POSITIONS, night_resonance: RESONANCES, solo_pose: SOLO_POSES } } as unknown as ContentPack

/** 別的功能的替身：風格（身上寫 wear 就是穿著那個風格）、曝露度、契約、義體。 */
const STUB: Feature = {
  id: 'night_res_stub',
  install(k: Kernel) {
    const who = (c: { actor?: string }, state: GameState) => state.actors[c.actor ?? state.pc ?? '']
    for (const kind of ['style', 'skin_style']) {
      k.conditions.register<{ kind: string; tag: string }>({ kind, owner: 'night_res_stub', validate: () => [], test: (c, ctx) => who(ctx, ctx.state)?.ext.wear === c.tag })
    }
    k.conditions.register<{ kind: string; side: string; npc?: string }>({
      kind: 'contract', owner: 'night_res_stub', validate: () => [], test: (c, { state }) => c.side === 'holder' && state.flags[`holds:${c.npc}`] === true,
    })
    k.conditions.register<{ kind: string; slot?: string }>({ kind: 'cyber', owner: 'night_res_stub', validate: () => [], test: (c, ctx) => who(ctx, ctx.state)?.ext.cyber_slot === c.slot })
    k.stats.defineStat({ id: 'exposure', owner: 'night_res_stub', name: '曝露度', base: (state, actor) => (typeof state.actors[actor]?.ext.expo === 'number' ? (state.actors[actor]!.ext.expo as number) : 0), max: 3 })
  },
}

const BRIDGE = { sensitivity: 50, tolerance: 30, craving: 30, docility: 10 }
type Game = ReturnType<typeof makeGame>['game']
interface Opts { pc?: ActorOverrides; ann?: ActorOverrides; pack?: ContentPack; flags?: Record<string, unknown>; features?: Feature[] }

function game(o: Opts = {}): Game {
  const ann = makeActor({ id: 'npc_ann', name: '安', role: 'npc', ...o.ann, ext: { bridge: { ...BRIDGE, docility: 30 }, ...(o.ann?.ext ?? {}) } })
  return makeGame({
    features: [characterFeature, lewdFeature, sceneFeature, nightclassFeature, STUB, ...(o.features ?? [])],
    content: [o.pack ?? PACK],
    pc: { ...o.pc, ext: { bridge: BRIDGE, ...(o.pc?.ext ?? {}) } },
    actors: [ann],
    ...(o.flags ? { patch: { flags: o.flags } as unknown as Partial<GameState> } : {}),
  }).game
}

/** 一個傾向軸的等級（關係、感官、身體、扮相）。 */
const axis = (name: string, level: number, more: Record<string, unknown> = {}): ActorOverrides => ({ ext: { tendency: { axes: { [name]: level }, points: {}, tags: more.tags ?? {} }, ...(more.ext as object | undefined ?? {}) } })
const times = (n: number) => ({ sex_record: { partners: 0, times: n, service_times: 0, people: {}, positions: [], tags: [] } })
const knows = (...skills: string[]) => ({ scene: { skills } })

const setup = { with: ['npc_ann'], nature: 'mutual' as const }
const begin = (g: Game, s: Record<string, unknown> = setup) => g.launch('scene', s, { by: 'test' })
const raw = (g: Game): SceneRaw => sceneRawOf(g.state)!
const dice = { int: (a: number) => a }
const act = (g: Game, input: SceneInput) => g.commit(sceneAct(g.k, g.state, input, { dice }))
const play = (g: Game): Play => new Play(g.k, g.state, raw(g), dice)
const ann = 'npc_ann'

/** 軸等級 n 的主角（含 ext 的其它東西）開一場：回傳遊戲。 */
const at = (branch: string, n: number, ext: Record<string, unknown> = {}, o: Opts = {}): Game => {
  const g = game({ ...o, pc: { ext: { ...axis(branch, n).ext, ...ext } } })
  begin(g)
  return g
}

// ======================================================================
describe('二十五個共鳴：每一個都有資料、每一個都有行為', () => {
  it('資料：二十五筆，每個分支各五階，格式全部過得了載入', () => {
    expect(RESONANCES).toHaveLength(25)
    for (const b of ['common', 'relation', 'sense', 'body', 'costume']) expect(RESONANCES.filter((r) => r.branch === b).map((r) => r.tier)).toEqual([1, 2, 3, 4, 5])
    expect(() => game()).not.toThrow()
  })

  describe('共通', () => {
    it('1 階：開場的摘要多給每個對象最高的那一條軸', () => {
      const g = game({ ann: axis('body', 3) })
      expect(startProblems(g.k, g.state, setup).summary!.reveal).toEqual([{ id: ann, name: '安', axis: { id: 'body', name: '身體', level: 3 } }])
    })

    it('2 階：每場第一次切換體位不花行動點，第二次照花；1 階的人（次數 0～7）沒有', () => {
      const g = game({ pc: { ext: times(8) } })
      begin(g)
      act(g, { kind: 'switch', position: 'pos_behind' })
      expect(raw(g).seats[0]!.ap).toBe(4)
      act(g, { kind: 'switch', position: 'pos_face' })
      expect(raw(g).seats[0]!.ap).toBe(3)
      const plain = game({ pc: { ext: times(7) } })
      begin(plain)
      act(plain, { kind: 'switch', position: 'pos_behind' })
      expect(raw(plain).seats[0]!.ap).toBe(3)
    })

    it('3 階：自己高潮時主動權只掉 10（原本 15）', () => {
      const run = (n: number): number => {
        const g = game({ pc: { ext: times(n) } })
        begin(g)
        const p = play(g)
        const start = p.s.pairs[ann]!.init
        p.climax('pc', 'pc')
        return p.s.pairs[ann]!.init - start
      }
      expect(run(20)).toBe(-10)
      expect(run(8)).toBe(-15)
    })

    it('4 階：這一場建立的第一條連接，持續的契合多 +1；第二條不多', () => {
      const run = (n: number): number[] => {
        const g = game({ pc: { ext: { ...times(n), ...knows('nt_hand', 'nt_mouth') } } })
        begin(g)
        act(g, { kind: 'skill', id: 'nt_hand' })
        act(g, { kind: 'skill', id: 'nt_mouth' })
        return raw(g).links.map((l) => l.link.fit)
      }
      expect(run(40)).toEqual([2, 1])
      expect(run(20)).toEqual([1, 1])
    })

    it('5 階：場景結束時主角和每個對象的契合各 +5', () => {
      const run = (n: number): number => {
        const g = game({ pc: { ext: times(n) } })
        begin(g)
        const before = raw(g).pairs[ann]!.fit
        g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))
        return Number(g.state.reports.at(-1)!.timeline.find((b) => b.tag === 'scene.end')!.text.match(/契合 (\d+)/)![1]) - before
      }
      expect(run(80)).toBe(5)
      expect(run(40)).toBe(0)
    })
  })

  describe('關係', () => {
    it('1 階：這一場的性質調整開場的主動權時你那一邊多 5；沒有調整（兩情相悅）時不加；對方有這個共鳴就是少 5', () => {
      const init = (a: ActorOverrides | undefined, nature: string, o: Opts = {}): number => {
        const g = game({ ...o, ...(a ? { pc: a } : {}) })
        begin(g, { with: [ann], nature })
        return raw(g).pairs[ann]!.init
      }
      expect(init(axis('relation', 1), 'forced')).toBe(init(undefined, 'forced') + 5)
      expect(init(axis('relation', 1), 'mutual')).toBe(init(undefined, 'mutual'))
      expect(init(undefined, 'forced', { ann: axis('relation', 1) })).toBe(init(undefined, 'forced') - 5)
    })

    it('2 階：有束縛的連接時，每回合主動權多推 3；不是束縛的連接沒有', () => {
      const gain = (skill: string, n = 2): number => {
        const g = game({ pc: { ext: { ...axis('relation', n).ext, ...knows(skill), tendency: { axes: { relation: n }, points: {}, tags: { tg_bind: 'has' } } } } })
        begin(g)
        act(g, { kind: 'skill', id: skill })
        const p = play(g)
        const before = p.s.pairs[ann]!.init
        p.settleRound()
        return p.s.pairs[ann]!.init - before
      }
      // 上位每回合 +3 是體位的，共鳴另外 +3
      expect(gain('nt_bind')).toBe(6)
      expect(gain('nt_hand')).toBe(3)
      expect(gain('nt_bind', 1)).toBe(3)
    })

    it('3 階：和你有契約的對象在場時，契合每回合 +1', () => {
      const fit = (flags: Record<string, unknown>, n = 3): number => {
        const g = game({ pc: axis('relation', n), flags })
        begin(g)
        const p = play(g)
        const before = p.s.pairs[ann]!.fit
        p.settleRound()
        return p.s.pairs[ann]!.fit - before
      }
      expect(fit({ [`holds:${ann}`]: true })).toBe(1)
      expect(fit({})).toBe(0)
      expect(fit({ [`holds:${ann}`]: true }, 2)).toBe(0)
    })

    it('4 階：主動權在 80 以上或 20 以下時，契合每回合 +1', () => {
      const fit = (init: number, n = 4): number => {
        const g = at('relation', n)
        const p = play(g)
        p.s.pairs[ann]!.init = init
        const before = p.s.pairs[ann]!.fit
        p.settleRound()
        return p.s.pairs[ann]!.fit - before
      }
      expect(fit(85)).toBe(1)
      expect(fit(20)).toBe(1)
      expect(fit(80)).toBe(1)
      expect(fit(60)).toBe(0)
      expect(fit(85, 3)).toBe(0)
    })

    it('5 階：每場一次，0 點行動點，把主動權直接設成 70 或 30', () => {
      const g = at('relation', 5)
      const ap = raw(g).seats[0]!.ap
      const onceChoices = sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'once')!.choices!
      expect(onceChoices.map((c) => c.id)).toEqual(['set_init:70', 'set_init:30'])
      // 選項自己帶要送出去的輸入（M4 收尾修正批；畫面不從選項 id 拆字串）
      expect(onceChoices.map((c) => c.input)).toEqual([{ kind: 'once', id: 'set_init', value: 70 }, { kind: 'once', id: 'set_init', value: 30 }])
      act(g, onceChoices[1]!.input)
      expect(raw(g).pairs[ann]!.init).toBe(30)
      expect(raw(g).seats[0]!.ap).toBe(ap)
      const again = (v: number) => play(g).blocks('pc', { kind: 'once', id: 'set_init', value: v })
      expect(again(70)).toEqual(['這一場已經用過了。'])
      const fresh = at('relation', 5)
      expect(play(fresh).blocks('pc', { kind: 'once', id: 'set_init', value: 60 })).toEqual(['要把主動權設成 70 或 30（value）。'])
      expect(play(at('relation', 4)).blocks('pc', { kind: 'once', id: 'set_init', value: 70 })).toEqual(['你還沒有這個夜課的功夫。'])
      act(fresh, { kind: 'once', id: 'set_init', value: 70 })
      expect(raw(fresh).pairs[ann]!.init).toBe(70)
    })
  })

  describe('感官', () => {
    const linked = (n: number): Game => {
      const g = at('sense', n, knows('nt_hand', 'nt_mouth'))
      act(g, { kind: 'skill', id: 'nt_hand' })
      return g
    }

    it('1 階：挑逗時對方的感載多 1（原始值）；預覽也算進去', () => {
      const tease = (n: number): number => {
        const p = play(linked(n))
        const before = p.load[ann]!
        p.perform('pc', { kind: 'tease' })
        return p.load[ann]! - before
      }
      expect(tease(1)).toBe(2)
      const none = linked(0)
      none.state.actors.pc!.ext.tendency = { axes: {}, points: {}, tags: {} }
      expect(tease(0)).toBe(1)
      expect(scenePreview(linked(1).k, linked(1).state, { kind: 'tease' })!.target_load!.dice).toBe('1d6+1')
    })

    it('2 階：你用口建立的連接，持續的契合 +1；用手的沒有', () => {
      const fits = (n: number): Record<string, number> => {
        const g = at('sense', n, knows('nt_hand', 'nt_mouth'))
        act(g, { kind: 'skill', id: 'nt_mouth' })
        act(g, { kind: 'skill', id: 'nt_hand' })
        return Object.fromEntries(raw(g).links.map((l) => [l.source, l.link.fit]))
      }
      expect(fits(2)).toEqual({ nt_mouth: 2, nt_hand: 1 })
      expect(fits(1)).toEqual({ nt_mouth: 1, nt_hand: 1 })
    })

    it('2 階（單人）：看的是對象，不生效', () => {
      const g = game({ pc: { ext: { ...axis('sense', 2).ext, ...knows('nt_mouth_solo') } } })
      begin(g, { solo: true })
      act(g, { kind: 'skill', id: 'nt_mouth_solo' })
      expect(raw(g).links[0]!.link.fit).toBe(1)
    })

    it('3 階：有人在看（直播、鏡頭）時，每回合對方的感載 +1；沒有人看就沒有', () => {
      const load = (watched: boolean, n = 3): number => {
        const g = at('sense', n)
        const p = play(g)
        p.s.audience = watched
        p.load[ann] = 10
        p.settleRound()
        return p.load[ann]!
      }
      expect(load(true)).toBe(load(false) + 1)
      expect(load(true, 2)).toBe(load(false, 2))
    })

    it('3 階（單人）：直播開著才生效，感載落在自己身上', () => {
      const load = (audience: boolean, n = 3): number => {
        const g = game({ pc: axis('sense', n) })
        begin(g, { solo: true, audience })
        const p = play(g)
        p.load.pc = 10
        p.settleRound()
        return p.load.pc!
      }
      expect(load(true)).toBe(load(false) + 1)
      expect(load(true, 2)).toBe(load(false, 2))
    })

    it('4 階：克制時自己的感載另外少 1d3；預覽的範圍也跟著', () => {
      const cut = (n: number): number => {
        const p = play(at('sense', n))
        p.load.pc = 10
        p.perform('pc', { kind: 'restrain' })
        return 10 - p.load.pc!
      }
      expect(cut(4)).toBe(cut(3) + 1)
      const g = at('sense', 4)
      expect(scenePreview(g.k, g.state, { kind: 'restrain' })!.my_load).toMatchObject({ dice: '−2−1d3', min: -5, max: -3 })
    })

    it('5 階：每回合第一次挑逗不花行動點；同一回合第二次照花；下一回合又免費', () => {
      const g = linked(5)
      const p = play(g)
      const ap = p.seat('pc').ap
      expect(scenePreview(g.k, g.state, { kind: 'tease' })!.ap).toBe(0)
      p.perform('pc', { kind: 'tease' })
      expect(p.seat('pc').ap).toBe(ap)
      expect(p.freeTease('pc')).toBe(false)
      p.perform('pc', { kind: 'tease' })
      expect(p.seat('pc').ap).toBe(ap - 1)
      p.settleRound()
      expect(p.freeTease('pc')).toBe(true)
      // 4 階沒有
      const q = play(linked(4))
      const before = q.seat('pc').ap
      q.perform('pc', { kind: 'tease' })
      expect(q.seat('pc').ap).toBe(before - 1)
    })
  })

  describe('身體', () => {
    const tail = { scene: { skills: ['nt_tail', 'nt_hand'], parts: ['tail'] } }

    it('1 階：用多出來的部位（尾、觸手、加裝）建立連接時持續的契合 +2；基本的部位沒有', () => {
      const fits = (n: number): Record<string, number> => {
        const g = at('body', n, tail)
        act(g, { kind: 'skill', id: 'nt_tail' })
        act(g, { kind: 'skill', id: 'nt_hand' })
        return Object.fromEntries(raw(g).links.map((l) => [l.source, l.link.fit]))
      }
      expect(fits(1)).toEqual({ nt_tail: 3, nt_hand: 1 })
      expect(fits(0)).toEqual({ nt_tail: 1, nt_hand: 1 })
    })

    it('1 階（單人）：同一個鍵，持續的是節奏（連接自己的部位）', () => {
      const fit = (n: number): number => {
        const g = game({ pc: { ext: { ...axis('body', n).ext, scene: { skills: ['nt_tail_solo'], parts: ['tail'] } } } })
        begin(g, { solo: true })
        act(g, { kind: 'skill', id: 'nt_tail_solo' })
        return raw(g).links[0]!.link.fit
      }
      expect(fit(1)).toBe(3)
      expect(fit(0)).toBe(1)
    })

    it('2 階：成人場景裡自己的感載上限 +4（走被動效果的來源 night，只在場景進行中算；M4-followups-2 第 11 項）', () => {
      const cap = (n: number): number => play(at('body', n)).loadMax.pc!
      expect(cap(2)).toBe(cap(1) + 4)
      // 場景進行中衍生數值 load_cap 帶著那一筆（來源 night）；Play 自己算的上限沒有算兩次（上面的 cap 就是）
      const stat = (n: number): number => { const g = at('body', n); return g.k.stats.stat(g.state, 'pc', 'load_cap') }
      expect(stat(2)).toBe(stat(1) + 4)
      const parts = (n: number) => { const g = at('body', n); return g.k.stats.statParts(g.state, 'pc', 'load_cap').filter((x) => x.source === 'night').map((x) => x.value) }
      expect(parts(2)).toEqual([4])
      expect(parts(1)).toEqual([])
      // 每個人各看各的
      const p = play(at('body', 2))
      expect(p.loadMax[ann]).toBe(play(at('body', 1)).loadMax[ann])
    })

    it('3 階（完整版）：切換體位時，用多出來的部位建立的連接不重置；基本部位的照舊重置', () => {
      const kept = (n: number): string[] => {
        const g = game({ pc: { ext: { ...axis('body', n).ext, ...tail } } })
        begin(g, { ...setup, mode: 'full' })
        act(g, { kind: 'skill', id: 'nt_tail', pick: { my_part: 'tail', their_part: 'back' } })
        act(g, { kind: 'skill', id: 'nt_hand', pick: { my_part: 'hand_l', their_part: 'chest' } })
        act(g, { kind: 'switch', position: 'pos_behind' })
        return raw(g).links.map((l) => l.source)
      }
      expect(kept(3)).toEqual(['nt_tail'])
      expect(kept(2)).toEqual([])
    })

    it('3 階（精簡版）：沒重置的那一條還是原本那一條（編號不變），基本部位的由程式重新接上，不會多出一條', () => {
      const ids = (n: number): Record<string, number> => {
        const g = game({ pc: { ext: { ...axis('body', n).ext, ...tail } } })
        begin(g, { ...setup, mode: 'simple' })
        act(g, { kind: 'skill', id: 'nt_tail' })
        act(g, { kind: 'skill', id: 'nt_hand' })
        const before = Object.fromEntries(raw(g).links.map((l) => [l.source, l.id]))
        act(g, { kind: 'switch', position: 'pos_behind' })
        const after = Object.fromEntries(raw(g).links.map((l) => [l.source, l.id]))
        expect(raw(g).links).toHaveLength(2)
        return { tail: after.nt_tail === before.nt_tail ? 1 : 0, hand: after.nt_hand === before.nt_hand ? 1 : 0 }
      }
      expect(ids(3)).toEqual({ tail: 1, hand: 0 })
      expect(ids(2)).toEqual({ tail: 0, hand: 0 })
    })

    it('4 階：餘韻每一層讓自己造成的感載與契合多 15%（原本 10%）', () => {
      const boost = (n: number): number => {
        const p = play(at('body', n))
        p.glow.pc = 2
        return p.boost('pc')
      }
      expect(boost(4)).toBeCloseTo(1.3)
      expect(boost(3)).toBeCloseTo(1.2)
    })

    it('5 階：每場一次，高潮時不疊餘韻（也不會因為疊滿而失神）；第二次高潮照疊', () => {
      const g = at('body', 5)
      const p = play(g)
      p.climax('pc', 'pc')
      expect(p.glow.pc).toBe(0)
      expect(p.seat('pc').climax).toBe(1)
      expect(p.usedOnce('pc', 'no_glow')).toBe(true)
      p.climax('pc', 'pc')
      expect(p.glow.pc).toBe(1)
      const full = play(at('body', 5))
      full.glow.pc = full.glowMax.pc!
      full.climax('pc', 'pc')
      expect(full.ended).toBeNull()
      full.climax('pc', 'pc')
      expect(full.ended).toBe('pc_out')
      const plain = play(at('body', 4))
      plain.climax('pc', 'pc')
      expect(plain.glow.pc).toBe(1)
    })

    it('單人也生效：高潮不疊餘韻、克制、感載上限', () => {
      const g = game({ pc: axis('body', 5) })
      begin(g, { solo: true })
      const p = play(g)
      expect(p.res.pc!.load_cap).toBe(4)
      p.climax('pc', 'pc')
      expect(p.glow.pc).toBe(0)
    })
  })

  describe('扮相', () => {
    const wearing = (tag: string | null, expo = 0) => ({ ext: { ...(tag ? { wear: tag } : {}), expo } })

    it('1 階：穿著自己「有」的風格時，開場的契合 +5（單人是節奏）；沒穿、穿的不是自己有的風格都沒有', () => {
      const fit = (wear: string | null, tags: Record<string, string> = { tg_maid: 'has' }): number => {
        const g = game({ pc: { ext: { ...axis('costume', 1, { tags }).ext, ...wearing(wear).ext } } })
        begin(g)
        return raw(g).pairs[ann]!.fit
      }
      expect(fit('tg_maid')).toBe(25)
      expect(fit(null)).toBe(20)
      expect(fit('tg_goth')).toBe(20)
      expect(fit('tg_maid', { tg_maid: 'latent' })).toBe(20)
      const solo = game({ pc: { ext: { ...axis('costume', 1, { tags: { tg_maid: 'has' } }).ext, ...wearing('tg_maid').ext } } })
      begin(solo, { solo: true })
      expect(raw(solo).pace).toBe(35)
    })

    it('2 階：對方的標籤和你這身服裝的風格一致時，契合每回合 +1', () => {
      const fit = (wear: string | null, n = 2): number => {
        const g = game({ pc: { ext: { ...axis('costume', n).ext, ...wearing(wear).ext } }, ann: axis('relation', 1, { tags: { tg_maid: 'has' } }) })
        begin(g)
        const p = play(g)
        const before = p.s.pairs[ann]!.fit
        p.settleRound()
        return p.s.pairs[ann]!.fit - before
      }
      expect(fit('tg_maid')).toBe(1)
      expect(fit('tg_goth')).toBe(0)
      expect(fit(null)).toBe(0)
      expect(fit('tg_maid', 1)).toBe(0)
    })

    it('3 階：每場一次，在場景裡脫下或換上一件衣服不花行動點；第二次照花（cost.dress）', () => {
      const g = at('costume', 3)
      const ap = raw(g).seats[0]!.ap
      expect(sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'dress')).toMatchObject({ ap: 0, blocks: [] })
      act(g, { kind: 'dress' })
      expect(raw(g).seats[0]!.ap).toBe(ap)
      expect(sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'dress')!.ap).toBe(1)
      act(g, { kind: 'dress' })
      expect(raw(g).seats[0]!.ap).toBe(ap - 1)
      const plain = at('costume', 2)
      expect(play(plain).blocks('pc', { kind: 'dress' })).toEqual(['這一場沒有脫換衣服的功夫。'])
      expect(sceneOptions(plain.k, plain.state)!.actions.some((a) => a.id === 'dress')).toBe(false)
    })

    it('3 階（單人）：生效', () => {
      const g = game({ pc: axis('costume', 3) })
      begin(g, { solo: true })
      const ap = raw(g).seats[0]!.ap
      act(g, { kind: 'dress' })
      expect(raw(g).seats[0]!.ap).toBe(ap)
    })

    it('4 階：曝露度每高 1，挑逗時對方的感載多 1（最多 +3）', () => {
      const tease = (expo: number, n = 4): number => {
        const g = game({ pc: { ext: { ...axis('costume', n).ext, ...knows('nt_hand'), expo } } })
        begin(g)
        act(g, { kind: 'skill', id: 'nt_hand' })
        const p = play(g)
        const before = p.load[ann]!
        p.perform('pc', { kind: 'tease' })
        return p.load[ann]! - before
      }
      expect([0, 1, 2, 3].map((e) => tease(e))).toEqual([1, 2, 3, 4])
      expect(tease(3, 3)).toBe(1)
    })

    it('5 階：每場一次，和一個對象的契合不到 50 的直接拉到 50；已經 50 以上的不能用', () => {
      const g = at('costume', 5)
      expect(raw(g).pairs[ann]!.fit).toBe(20)
      act(g, { kind: 'once', id: 'fit_floor' })
      expect(raw(g).pairs[ann]!.fit).toBe(50)
      expect(play(g).blocks('pc', { kind: 'once', id: 'fit_floor' })).toEqual(['這一場已經用過了。'])
      const high = at('costume', 5)
      high.state.ext.scene = { ...(high.state.ext.scene as object), pairs: { [ann]: { ...raw(high).pairs[ann]!, fit: 60 } } }
      expect(play(high).blocks('pc', { kind: 'once', id: 'fit_floor' })).toEqual(['你們的契合已經到 50 了，不用拉。'])
    })
  })
})

// ======================================================================
describe('共鳴的格式（新的幾種鍵）', () => {
  const badPack = (scene: Record<string, unknown>) => () => game({ pack: { id: 'b', content: { night_resonance: [{ id: 'rs_b', branch: 'common', tier: 1, name: 'B', scene }] } } as unknown as ContentPack })

  it('per_round：if 要是五種之一、effect 要有 fit／init／load', () => {
    expect(badPack({ per_round: [{ if: 'watched', effect: { fit: 1 } }] })).not.toThrow()
    expect(badPack({ per_round: [{ if: ['bind_link', 'watched'], effect: { load: { self: -1, other: 2 } } }] })).not.toThrow()
    expect(badPack({ per_round: [{ if: 'nope', effect: { fit: 1 } }] })).toThrow(/不是條件/)
    expect(badPack({ per_round: [{ if: 'watched', effect: {} }] })).toThrow(/空的/)
    expect(badPack({ per_round: [{ if: 'watched', effect: { fit: 1.5 } }] })).toThrow(/整數/)
    expect(badPack({ per_round: [{ if: 'watched', effect: { load: { them: 1 } } }] })).toThrow(/self、other/)
    expect(badPack({ per_round: 'x' })).toThrow(/per_round/)
  })

  it('link_bonus、keep_extra_links、once、opening、tease_flat、restrain_dice、load_cap、tease_exposure', () => {
    expect(badPack({ link_bonus: [{ part: 'mouth', extra_part: true, fit: 1 }] })).toThrow(/part 或 extra_part 其中一個/)
    expect(badPack({ link_bonus: [{ fit: 1 }] })).toThrow(/part 或 extra_part/)
    expect(badPack({ link_bonus: [{ part: 'mouth' }] })).toThrow(/fit 要是整數/)
    expect(badPack({ link_bonus: [{ part: 'mouth', fit: 1, solo: false }] })).toThrow(/solo/)
    expect(badPack({ keep_extra_links: false })).toThrow(/keep_extra_links/)
    expect(badPack({ once: { kind: 'nope' } })).toThrow(/once.kind/)
    expect(badPack({ once: { kind: 'set_init' } })).toThrow(/values/)
    expect(badPack({ once: { kind: 'fit_floor', value: 0 } })).toThrow(/value/)
    expect(badPack({ once: { kind: 'free_tease', ap: -1 } })).toThrow(/ap/)
    expect(badPack({ opening: {} })).toThrow(/init 或 fit/)
    expect(badPack({ opening: { init: 5, if: 'weather' } })).toThrow(/opening.if/)
    expect(badPack({ tease_flat: 0 })).toThrow(/tease_flat/)
    expect(badPack({ restrain_dice: '3' })).toThrow(/restrain_dice/)
    expect(badPack({ load_cap: 0 })).toThrow(/load_cap/)
    expect(badPack({ tease_exposure: { per: 1 } })).toThrow(/tease_exposure/)
    expect(() => game({ pack: { id: 'x', content: { night_resonance: [{ id: 'x', branch: 'common', tier: 1, name: 'X', scene: { once: { kind: 'set_init', values: [70, 30] }, opening: { init: 5 }, tease_exposure: { per: 1, max: 3 } } }] } } as unknown as ContentPack })).not.toThrow()
    void ContentError
  })
})

// ======================================================================
describe('學習條件的句型', () => {
  const pack = (skill: Record<string, unknown>): ContentPack => ({ id: 'p', content: { night_skill: [{ id: 'nt_x', name: 'X', branch: 'common', tier: 1, ...skill }] } } as unknown as ContentPack)
  const rec = (o: Record<string, unknown>) => ({ sex_record: { partners: 0, times: 0, service_times: 0, people: {}, positions: [], tags: [], ...o } })
  const why = (g: Game): string[] => learnProblems(g.k, g.state, 'pc', 'nt_x')
  const g1 = (req: Record<string, unknown>, ext: Record<string, unknown> = {}, o: Opts = {}): Game => {
    const g = game({ pack: pack({ requires: req }), pc: { ext }, ...o })
    g.state.meters.insight = { _: 99 }
    return g
  }

  it('性經歷裡有三種以上不同的身體（sex_record.looks 的 body）：沒有紀錄就當不成立', () => {
    const looks = (n: number) => rec({ looks: Object.fromEntries(['masc', 'fem', 'andro', 'masc'].slice(0, n).map((b, i) => [`p${i}`, { body: b }])) })
    expect(why(g1({ experience: { bodies: 3 } }, looks(2)))).toEqual(['要和 3 種不同身體的人有過，你現在是 2 種。'])
    expect(why(g1({ experience: { bodies: 3 } }, looks(3)))).toEqual([])
    expect(why(g1({ experience: { bodies: 3 } }, looks(4)))).toEqual([])
    expect(why(g1({ experience: { bodies: 3 } }, rec({})))).toEqual(['要和 3 種不同身體的人有過，你現在是 0 種。'])
  })

  it('性經歷裡有身體和外表的性別不同的對象（looks 的 body 與 look_gender）', () => {
    const mismatch = (look: Record<string, string>) => rec({ looks: { p1: look } })
    const need = { experience: { look_mismatch: true } }
    expect(why(g1(need, mismatch({ body: 'masc', look_gender: 'male' })))).toEqual(['要和身體與外表的性別不同的人有過。'])
    expect(why(g1(need, mismatch({ body: 'fem', look_gender: 'female' })))).toEqual(['要和身體與外表的性別不同的人有過。'])
    expect(why(g1(need, mismatch({ body: 'masc', look_gender: 'femboy' })))).toEqual([])
    expect(why(g1(need, mismatch({ body: 'masc', look_gender: 'female' })))).toEqual([])
    expect(why(g1(need, mismatch({ body: 'masc' })))).toEqual(['要和身體與外表的性別不同的人有過。'])
    expect(why(g1(need, rec({})))).toEqual(['要和身體與外表的性別不同的人有過。'])
  })

  it('豔名在任一區 20 以上（量表條件的 key: any）：有一區到了就成立', () => {
    const fame = (v: number): Game => {
      const g = game({
        pack: { id: 'p', content: { district: [{ id: 'd1', name: '一區' }, { id: 'd2', name: '二區' }], night_skill: [{ id: 'nt_x', name: 'X', branch: 'common', tier: 1, requires: { conditions: [{ kind: 'fame', key: 'any', min: 20, text: '豔名要在任一區到 20。' }] } }] } } as unknown as ContentPack,
        features: [{ id: 'fame_stub', install(k: Kernel) { k.content.defineKind({ kind: 'district', owner: 'fame_stub', validate: () => [] }) } }],
      })
      g.state.meters.insight = { _: 99 }
      if (v > 0) g.state.meters.fame = { d2: v }
      return g
    }
    expect(why(fame(0))).toEqual(['豔名要在任一區到 20。'])
    expect(why(fame(19))).toEqual(['豔名要在任一區到 20。'])
    expect(why(fame(20))).toEqual([])
  })

  it('條件 avatar：讀化身的部位與所在層（內海化身多出的觸手、在內海用化身）', () => {
    const avatar = (parts: string[]) => ({ deck: { avatar: { parts } } })
    const part = { conditions: [{ kind: 'avatar', part: 'tentacle', text: '要有內海化身多出來的觸手。' }] }
    expect(why(g1(part, avatar(['tail'])))).toEqual(['要有內海化身多出來的觸手。'])
    expect(why(g1(part, avatar(['tail', 'tentacle'])))).toEqual([])
    expect(why(g1(part, {}))).toEqual(['要有內海化身多出來的觸手。'])
    const inNet = { conditions: [{ kind: 'avatar', layer: 'net', text: '要在內海用化身。' }] }
    const net = (active: boolean): Game => {
      const g = g1(inNet, avatar([]), { features: [{ id: 'net_stub', install(k: Kernel) { k.activity.define({ kind: 'dive', owner: 'net_stub', order: 5, active: () => (active ? { id: 'dv', label: '潛入' } : null), allow: [''], reason: () => '' }) } }] })
      return g
    }
    expect(why(net(false))).toEqual(['要在內海用化身。'])
    expect(why(net(true))).toEqual([])
    expect(g1({ conditions: [{ kind: 'avatar', layer: 'meat' }] }, avatar([])).k.conditions.validate({ kind: 'avatar', layer: 'sky' })).toEqual(['requires：layer 要是 \'net\' 或 \'meat\''])
  })

  it('只掛軸的技能：tag 是軸的 id 或 common 時不要求標籤；中文名不再算只掛軸', () => {
    const p = (tag: string): ContentPack => ({ id: 'p', content: { night_skill: [{ id: 'nt_ax', name: '看我穿這樣', branch: 'costume', tier: 1, tag }, { id: 'nt_cm', name: '共通', branch: 'sense', tier: 1, tag: 'common' }] } } as unknown as ContentPack)
    const listed = (tag: string): string[] => {
      const g = game({ pack: p(tag), pc: axis('costume', 1) })
      return nightList(g.k, g.state, 'pc').branches.flatMap((b) => b.skills.map((s) => s.id))
    }
    expect(listed('costume')).toEqual(['nt_cm', 'nt_ax'])
    expect(listed('common')).toContain('nt_ax')
    expect(listed('扮相')).not.toContain('nt_ax')
    expect(listed('扮相')).toContain('nt_cm')
    void learnBlock
  })
})

// ======================================================================
describe('「對方……」的條件：技能在場景裡的 needs（條件 target）', () => {
  const run = (skill: string, ann: ActorOverrides = {}, pc: Record<string, unknown> = {}) => {
    const g = game({ pc: { ext: { ...knows(skill), ...pc } }, ann })
    begin(g)
    return { g, blocks: play(g).blocks('pc', { kind: 'skill', id: skill }) }
  }

  it('對方有義體（內層的條件看對方）才用得出來；用的人自己有也不算', () => {
    expect(run('nt_need_cyber').blocks).toEqual(['對方還沒有滿足需要的條件（cyber）。'])
    expect(run('nt_need_cyber', {}, { cyber_slot: 'arm' }).blocks).toEqual(['對方還沒有滿足需要的條件（cyber）。'])
    expect(run('nt_need_cyber', { ext: { cyber_slot: 'arm' } }).blocks).toEqual([])
  })

  it('對方有固定的伴：最喜歡的人不是你、或是契約人；最喜歡的人就是你不算', () => {
    const fav = (id: string) => ({ ext: { sex_record: { favorite: id } } })
    expect(run('nt_need_partnered').blocks).toEqual(['對方還沒有滿足需要的條件（partnered）。'])
    expect(run('nt_need_partnered', fav('someone')).blocks).toEqual([])
    expect(run('nt_need_partnered', fav('pc')).blocks).toEqual(['對方還沒有滿足需要的條件（partnered）。'])
    expect(run('nt_need_partnered', { ext: { identity: { class: 'bound' } } }).blocks).toEqual([])
  })

  it('條件自己的 text 照用；內層的條件種類沒有人註冊，說判斷不了', () => {
    const pack: ContentPack = { id: 'p', content: { night_skill: [
      { id: 'nt_t', name: 'T', branch: 'common', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { fit: 1 }, needs: [{ kind: 'target', text: '對方要有義體手臂。', of: { kind: 'cyber', slot: 'arm' } }] } },
      { id: 'nt_u', name: 'U', branch: 'common', tier: 1, scene: { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { fit: 1 }, needs: [{ kind: 'target', of: { kind: 'nobody_registered' } }] } },
    ], position: POSITIONS } } as unknown as ContentPack
    const g = game({ pack, pc: { ext: knows('nt_t', 'nt_u') } })
    begin(g)
    expect(play(g).blocks('pc', { kind: 'skill', id: 'nt_t' })).toEqual(['對方要有義體手臂。'])
    expect(play(g).blocks('pc', { kind: 'skill', id: 'nt_u' })).toEqual(['這個條件現在還判斷不了。'])
  })

  it('單人沒有對象：包著 target 的 needs 一律不成立', () => {
    const g = game({ pc: { ext: { ...knows('nt_need_cyber'), cyber_slot: 'arm' } } })
    begin(g, { solo: true })
    expect(play(g).blocks('pc', { kind: 'skill', id: 'nt_need_cyber' }).join('')).toContain('這個要有對象。')
  })
})

// ======================================================================
describe('npcs：buildActor 補 ext.body', () => {
  it('固定 NPC 的 body 抄進角色的 ext.body（場景結算記進 looks 用）；沒有寫就沒有這一欄', () => {
    const g = game()
    const base = { id: 'npc_x', name: 'X', kind: 'citizen', source: 'fixed', age: 30, guard: 12, wealth: 1, home: { district: 'd' }, haunts: [], persona: { attrs: [], quadrants: [] }, tendencies: { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: {} }, bridge: null, sink: 0, paths: [], flags: [], attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, look: {} }
    expect(buildActor(g.k, { ...base, body: 'andro', gender: 'femboy' } as never).ext.body).toBe('andro')
    expect('body' in buildActor(g.k, base as never).ext).toBe(false)
  })
})
