// 驗收測試：dev/work/M4-scene-net.md（cpp-feature）。規格：LEWD_SYSTEM 3.1、3.4 節（網內也能開場景、場景可以發生在內海）；CYBERSPACE 4.1、4.3 節、第 10 節；
// CHARACTER 1.1 節（現實與內海兩份外觀）；DATA 3.4 節、7.4 節；CORE_RULES 4.2 節（內海的消退是 net_load_decay）；LURE_EVENTS 開頭（夢照內海的場景算）；
// dev/adr/0019 第九節與 P41、P42。
// 內容一律用測試自帶的最小假資料：三個技能（一個要 SKIN 風格）、一個體位、兩副甲板、三套 SKIN；dive、netrun、face.net 用替身活動（放行清單用真的那三張）。
//
// 數字的約定：主角敏感度 50、感載上限 35、行動點上限 4；內海每回合的感載消退是 net_load_decay（甲板的散熱 1），現實是 2 ＋ mod(意志)。

import { describe, expect, it } from 'vitest'
import type { Condition, ContentPack, Feature, GameState, Origin, ReportDraft } from '../../src'
import { ActionBlocked, attachActivityEnd, attrMod, clone, endActivity } from '../../src'
import { characterFeature } from '../../src/features/character'
import { cyberwareFeature } from '../../src/features/cyberware'
import { AVATAR_SAVES_MAX, atAccessPoint, avatarBlock, avatarDraft, avatarOf, deckFeature, equipDraft, skinBlock, skinDraft } from '../../src/features/deck'
import { DIVE_ALLOW } from '../../src/features/dive'
import { lewdFeature } from '../../src/features/lewd'
import { NETRUN_ALLOW } from '../../src/features/netrun'
import type { Dice, SceneInput, SceneRaw } from '../../src/features/scene'
import { Play, genderIn, sceneAct, sceneFeature, sceneOptions, sceneRawOf, startProblems } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { BATTLE_SETUPS, METER_CONTENT, TEST_COMBAT, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 假內容 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const skill = (id: string, name: string, scene: Rec) => ({ id, name, scene })
const PACK: ContentPack = {
  id: 'net_test',
  content: {
    night_skill: [
      skill('nt_plain', '輕輕碰', { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 0 } }),
      // 碰尾巴：對方要有尾這個部位
      skill('nt_tail', '碰尾巴', { ap: 1, my_part: ['hand_r'], their_part: ['tail'], on_use: { their_load: '1d6', fit: 2 } }),
      // 要穿著 maid 風格 2 以上的 SKIN（資料的事：寫 skin_style）
      skill('nt_maid', '女僕的服務', { ap: 1, my_part: ['hand_l'], their_part: ['chest'], needs: [{ kind: 'skin_style', tag: 'maid', min: 2, text: '要穿著女僕風格的 SKIN。' }], on_use: { their_load: '1d6', fit: 3 } }),
    ],
    position: [
      {
        id: 'pos_side', name: '並坐', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
        links: [
          { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'chest'] }, { from: ['a', 'hand_r'], to: ['b', 'tail'] },
          { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['a', 'hand_l'], to: ['b', 'ear'] },
        ],
      },
      {
        id: 'pos_tri', name: '三人並坐', people: 3, roles: [{ id: 'a', upper: true }, { id: 'b', upper: false }, { id: 'c', upper: false }], mult: { a: 1, b: 1, c: 1 }, initiative_drift: 0, tags: [], unlocked_by: null,
        links: [{ from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['a', 'mouth'], to: ['c', 'mouth'] }, { from: ['b', 'hand_r'], to: ['c', 'front'] }],
      },
    ],
    deck: [
      { id: 'dk_ii', name: '二級甲板', desc: '一副測試用的甲板。', grade: 2, slots: 4, firewall: 12, cooling: 1, legal: 'free' },
      { id: 'dk_cold', name: '沒有散熱的甲板', desc: '一副測試用的甲板。', grade: 1, slots: 2, firewall: 10, legal: 'free' },
    ],
    skin: [
      // 工單的寫法：style 是 { tag, value }
      { id: 'sk_maid', name: '家政課女僕服', style: { tag: 'maid', value: 2 }, exposure: 2, cut: 'female', adult: false },
      // DATA 7.4 節的寫法：style 是標籤、style_value 是值
      { id: 'sk_goth', name: '黑色蕾絲', style: 'gothic', style_value: 3, exposure: 1, cut: 'neutral', adult: false },
      // 空白 SKIN：曝露度寫 custom
      { id: 'sk_blank', name: '空白 SKIN', style: 'custom', style_value: 1, exposure: 'custom', cut: 'custom', adult: false },
    ],
    tendency_tag: [],
  },
} as unknown as ContentPack

const AFFINITY = testMeter({ kind: 'affinity', owner: 'test', name: '親密度', min: -100, max: 100, keyed: 'npc' })
const PC_BRIDGE = { sensitivity: 50, tolerance: 30, craving: 30, docility: 10 }
const ANN_BRIDGE = { sensitivity: 100, tolerance: 30, craving: 30, docility: 30 }

/** 測試的替身：三種網內的活動（放行清單用真的）、條件 at_home 與 at_facility（旗標）、設施種類、現實義體多出來的部位（只在現實層回答）、被強制結束的掛鉤。 */
const HELPER: Feature = {
  id: 'net_test_helper',
  install(k) {
    const owner = 'net_test_helper'
    const stand = (kind: string, order: number, allow: readonly string[]): void =>
      k.activity.define({ kind, owner, order, active: (s) => (s.flags[`t.${kind}`] ? { id: kind, label: kind } : null), allow: [...allow, 'commit:test.'], reason: () => `${kind} 進行中。` })
    stand('dive', 85, DIVE_ALLOW)
    stand('netrun', 50, NETRUN_ALLOW)
    stand('face.net', 50, NETRUN_ALLOW)
    k.conditions.register<Condition>({ kind: 'at_home', owner, validate: () => [], test: (_c, { state }) => state.flags['t.home'] === true })
    k.conditions.register<Condition & { types?: string[] }>({
      kind: 'at_facility', owner, validate: () => [],
      test: (c, { state }) => typeof state.flags['t.fac'] === 'string' && (c.types ?? []).includes(state.flags['t.fac']),
    })
    k.content.defineKind({ kind: 'facility_type', owner, validate: () => [] })
    // 現實的義體多出來的部位：只有主角、只在現實層回答
    k.hooks.on('scene.body', owner, ({ actor, layer }) => (layer === 'meat' && actor === 'pc' ? { parts: ['ear'] } : undefined))
    // t.force_end 寫了一種網內的活動：下一份報告套用之後那一種活動「被強制結束」（發 activity.end）
    k.hooks.on('report.after', owner, ({ state }): ReportDraft[] | void => {
      const kind = state.flags['t.force_end']
      if (typeof kind !== 'string') return
      const end = endActivity(k, { state, kind, id: kind, origin: { by: 'test' }, outcome: 'forced', result: {} })
      const d: ReportDraft = {
        kind: 'event', action: 'test.net_end', location: clone(state.location), party: [], timeline: [],
        changes: [{ op: 'flag', key: 't.force_end', value: null }, { op: 'flag', key: `t.${kind}`, value: null }, ...end.changes],
        outcome: { result: 'forced', summary: ['網內的行程被強制結束了。', ...end.lines].join('') },
      }
      return [attachActivityEnd(d, end)]
    })
  },
}
const FACILITY_PACK: ContentPack = { id: 'net_test_fac', content: { facility_type: [{ id: 'ft_pod', name: '潛艙店', dive: {} }, { id: 'ft_shop', name: '雜貨店' }] } } as unknown as ContentPack

type Game = ReturnType<typeof makeGame>['game']

interface Opts {
  /** 主角的化身（actor.ext.deck.avatar） */
  avatar?: Rec
  /** 沒有甲板（不裝） */
  noDeck?: boolean
  /** 裝哪一副（預設有散熱的 dk_ii） */
  deck?: string
  bridge?: unknown
  contentOff?: string[]
  pc?: ActorOverrides
  bobExt?: Rec
  annExt?: Rec
  features?: Feature[]
  packs?: ContentPack[]
  seed?: number
}

function make(o: Opts = {}): Game {
  const ann = makeActor({ id: 'npc_ann', name: '安', role: 'npc', gender: 'female', ext: { bridge: ANN_BRIDGE, ...o.annExt } })
  const bob = makeActor({ id: 'npc_bob', name: '鮑伯', role: 'npc', gender: 'male', ext: { bridge: ANN_BRIDGE, ...o.bobExt } })
  const game = makeGame({
    seed: o.seed,
    features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, deckFeature, HELPER, ...(o.features ?? [])],
    content: [PACK, FACILITY_PACK, METER_CONTENT, ...(o.packs ?? [])],
    pc: {
      ...o.pc,
      ext: {
        bridge: o.bridge === undefined ? PC_BRIDGE : o.bridge, scene: { skills: ['nt_plain', 'nt_tail', 'nt_maid'], positions: [] },
        ...(o.avatar ? { deck: { avatar: o.avatar } } : {}), ...(o.pc?.ext ?? {}),
      },
    },
    actors: [ann, bob],
    patch: {
      inventory: [{ id: 'dk_ii', qty: 1, data: { uid: 'D1' } }, { id: 'dk_cold', qty: 1, data: { uid: 'D2' } }, { id: 'sk_maid', qty: 1 }, { id: 'sk_goth', qty: 1 }, { id: 'sk_blank', qty: 1 }],
      ...(o.contentOff ? { rules: { contentOff: o.contentOff } } : {}),
    } as unknown as Partial<GameState>,
  }).game
  if (!o.noDeck) game.commit(equipDraft(game.k, game.state, 'pc', o.deck === 'dk_cold' ? 'D2' : 'D1'))
  return game
}

const SETUP = { with: ['npc_ann'], nature: 'mutual' as const, mode: 'full' as const }
const begin = (g: Game, setup: Rec = SETUP, origin: Origin = { by: 'test' }) => g.launch('scene', setup, origin)
const raw = (g: Game): SceneRaw => sceneRawOf(g.state)!
const flag = (g: Game, key: string, value: boolean | string | null): void => {
  if (value === null) delete g.state.flags[key]
  else g.state.flags[key] = value
}
const dice = (...values: number[]): Dice => {
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
const act = (g: Game, input: SceneInput, d?: Dice) => g.commit(sceneAct(g.k, g.state, input, d ? { dice: d } : {}))
const blocked = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionBlocked) return e.reason
    throw e
  }
  throw new Error('應該被擋下')
}
const partsOf = (g: Game, id = 'pc'): string[] => new Play(g.k, g.state, raw(g), dice()).partsOf(id)
const cond = (g: Game, c: Rec, actor?: string): boolean => g.k.conditions.test(c as never, { state: g.state, ...(actor ? { actor } : {}), stats: g.k.stats, timeRules: g.k.timeRules })
const stat = (g: Game, id: string): number => g.k.stats.stat(g.state, 'pc', id)
const wear = (g: Game, skin: string | null): void => void g.commit(skinDraft(g.k, g.state, 'pc', skin))
const skillOf = (g: Game, id: string) => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'skill')!.choices!.find((c) => c.id === id)!
/** 主角用一次輕輕碰（建立連接；骰面照存檔的種子）。 */
const touch = (g: Game) => act(g, { kind: 'skill', id: 'nt_plain', pick: { my_part: 'hand_l', their_part: 'chest' } })
/** 把一場演到結束，收集活動結束的結果。 */
const stop = (g: Game) => g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))

// ======================================================================
describe('改化身：接入點、不花錢不花時間、只收三種部位、存與載', () => {
  it('在住處可以改：parts: [tail] 存得進 actor.ext.deck.avatar，不花錢、不花時間；沒有這一欄的人是空的', () => {
    const g = make()
    expect(avatarOf(g.state, 'pc')).toEqual({ parts: [], saved: [] })
    flag(g, 't.home', true)
    expect(atAccessPoint(g.k, g.state)).toBe(true)
    const cash = g.state.money.cash
    const t0 = JSON.stringify(g.state.time)
    const [r] = g.commit(avatarDraft(g.k, g.state, 'pc', { parts: ['tail'] }))
    expect(r!.action).toBe('deck.avatar')
    expect(avatarOf(g.state, 'pc')).toEqual({ parts: ['tail'], saved: [] })
    expect((g.state.actors.pc!.ext.deck as Rec).avatar).toEqual({ parts: ['tail'] })
    expect(g.state.money.cash).toBe(cash)
    expect(JSON.stringify(g.state.time)).toBe(t0)
    // 甲板的資料沒被弄壞：甲板還在、SKIN 與槽照舊
    expect((g.state.actors.pc!.ext.deck as Rec).uid).toBe('D1')
  })

  it('在街上被擋；腳下的設施種類有 dive 欄位就算接入點（沒有的雜貨店不算）；潛入中可以改', () => {
    const g = make()
    expect(atAccessPoint(g.k, g.state)).toBe(false)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: ['tail'] }))).toBe('要在接入點（潛艙店、據點，或你的住處）才能改化身。')
    flag(g, 't.fac', 'ft_shop')
    expect(avatarBlock(g.k, g.state, 'pc', { parts: ['tail'] })).toBe('要在接入點（潛艙店、據點，或你的住處）才能改化身。')
    flag(g, 't.fac', 'ft_pod')
    expect(avatarBlock(g.k, g.state, 'pc', { parts: ['tail'] })).toBeNull()
    flag(g, 't.fac', null)
    flag(g, 't.dive', true)
    expect(avatarBlock(g.k, g.state, 'pc', { parts: ['tail'] })).toBeNull()
    g.commit(avatarDraft(g.k, g.state, 'pc', { parts: ['tail'] }))
    expect(avatarOf(g.state, 'pc').parts).toEqual(['tail'])
    // 網內的行程裡不是接入點（活動自己擋）
    flag(g, 't.dive', null)
    flag(g, 't.netrun', true)
    expect(avatarBlock(g.k, g.state, 'pc', { parts: ['extra'] })).toBe('netrun 進行中。')
  })

  it('亂寫的部位、性別、詞條被擋；重複的部位收成一個；三種部位都收', () => {
    const g = make()
    flag(g, 't.home', true)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: ['wing'] }))).toMatch(/「wing」不行/)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: ['tail', 'hand_l'] }))).toMatch(/「hand_l」不行/)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: 'tail' as never }))).toMatch(/要寫成一串/)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { gender: 'robot' }))).toBe('性別要是 male、female、femboy、trans_f、futa 其中一個。')
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { body: { hair: 3 } as never }))).toBe('外觀的詞條要寫成 { 欄位: 文字 }。')
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', {}))).toBe('沒有要改的東西。')
    expect(blocked(() => avatarDraft(g.k, g.state, 'nobody', { parts: ['tail'] }))).toBe('沒有 nobody 這個角色。')
    g.commit(avatarDraft(g.k, g.state, 'pc', { parts: ['tail', 'tail', 'extra', 'tentacle'], gender: 'male', body: { 髮: '銀白色的長髮', 眼: '琥珀色' } }))
    expect(avatarOf(g.state, 'pc')).toEqual({ gender: 'male', body: { 髮: '銀白色的長髮', 眼: '琥珀色' }, parts: ['tail', 'extra', 'tentacle'], saved: [] })
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: ['tail', 'extra', 'tentacle'] }))).toBe('化身已經是這個樣子了。')
    // gender: null 回到照角色自己的
    g.commit(avatarDraft(g.k, g.state, 'pc', { gender: null, body: null }))
    expect(avatarOf(g.state, 'pc')).toEqual({ parts: ['tail', 'extra', 'tentacle'], saved: [] })
  })

  it('存一套、載回來一樣；同名蓋掉；最多五套；載入不能和別的選項一起；沒有那一套被擋', () => {
    const g = make()
    flag(g, 't.home', true)
    g.commit(avatarDraft(g.k, g.state, 'pc', { gender: 'male', parts: ['tail'], body: { 髮: '黑' }, save: '狐狸' }))
    const before = avatarOf(g.state, 'pc')
    expect(before.saved).toEqual([{ name: '狐狸', gender: 'male', body: { 髮: '黑' }, parts: ['tail'] }])
    g.commit(avatarDraft(g.k, g.state, 'pc', { gender: 'futa', parts: ['extra', 'tentacle'], body: { 髮: '白' } }))
    expect(avatarOf(g.state, 'pc')).toMatchObject({ gender: 'futa', parts: ['extra', 'tentacle'] })
    g.commit(avatarDraft(g.k, g.state, 'pc', { load: '狐狸' }))
    expect(avatarOf(g.state, 'pc')).toEqual(before)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { load: '貓' }))).toBe('沒有存著叫「貓」的那一套化身。')
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { load: '狐狸', parts: [] }))).toBe('載入一套化身時，不能同時改別的。')
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { load: '狐狸' }))).toBe('化身已經是這個樣子了。')
    // 同名蓋掉
    g.commit(avatarDraft(g.k, g.state, 'pc', { parts: ['extra'], save: '狐狸' }))
    expect(avatarOf(g.state, 'pc').saved).toEqual([{ name: '狐狸', gender: 'male', body: { 髮: '黑' }, parts: ['extra'] }])
    // 最多五套
    for (let i = 1; i < AVATAR_SAVES_MAX; i++) g.commit(avatarDraft(g.k, g.state, 'pc', { save: `第${i}套`, parts: ['extra'] }))
    expect(avatarOf(g.state, 'pc').saved).toHaveLength(AVATAR_SAVES_MAX)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { save: '第六套' }))).toBe(`最多存 ${AVATAR_SAVES_MAX} 套化身，要先蓋掉一套（用同樣的名字）。`)
    g.commit(avatarDraft(g.k, g.state, 'pc', { save: '第1套', parts: ['tail'] }))
    expect(avatarOf(g.state, 'pc').saved).toHaveLength(AVATAR_SAVES_MAX)
  })

  it('戰鬥中不能改化身（就算站在住處）', () => {
    const g = make({ features: [TEST_COMBAT] })
    flag(g, 't.home', true)
    g.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] } as never)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: ['tail'] }))).toBe('戰鬥中不能改化身。')
  })

  it('成人場景中不能改；存的資料壞掉讀成空的、不丟錯', () => {
    const g = make()
    flag(g, 't.home', true)
    begin(g)
    expect(blocked(() => avatarDraft(g.k, g.state, 'pc', { parts: ['tail'] }))).toBe('成人場景進行中不能改化身。')
    stop(g)
    expect(avatarBlock(g.k, g.state, 'pc', { parts: ['tail'] })).toBeNull()
    g.state.actors.pc!.ext.deck = { uid: 'D1', slots: [], avatar: { gender: 'robot', parts: ['wing', 'tail', 'tail'], body: { 髮: 5, 眼: '藍' }, saved: [{ name: 5 }, { name: 'ok', parts: 'x' }] } }
    expect(avatarOf(g.state, 'pc')).toEqual({ body: { 眼: '藍' }, parts: ['tail'], saved: [{ name: 'ok', parts: [] }] })
    g.state.actors.pc!.ext.deck = '壞掉'
    expect(avatarOf(g.state, 'pc')).toEqual({ parts: [], saved: [] })
  })
})

// ======================================================================
describe('SKIN 的風格與曝露度', () => {
  it('穿著一套 style: { tag: maid, value: 2 } 的 SKIN：skin_style 成立（min 到 2）、skin_exposure 等於資料、衍生數值照資料；沒穿是 0', () => {
    const g = make()
    expect(cond(g, { kind: 'skin_style', tag: 'maid' })).toBe(false)
    expect(cond(g, { kind: 'skin_exposure', max: 0 })).toBe(true)
    expect([stat(g, 'skin_exposure'), stat(g, 'skin_style_value')]).toEqual([0, 0])
    wear(g, 'sk_maid')
    expect(cond(g, { kind: 'skin_style', tag: 'maid' })).toBe(true)
    expect(cond(g, { kind: 'skin_style', tag: 'maid', min: 2 })).toBe(true)
    expect(cond(g, { kind: 'skin_style', tag: 'maid', min: 3 })).toBe(false)
    expect(cond(g, { kind: 'skin_style', tag: 'gothic' })).toBe(false)
    expect([stat(g, 'skin_exposure'), stat(g, 'skin_style_value')]).toEqual([2, 2])
    expect(cond(g, { kind: 'skin_exposure', min: 2, max: 2 })).toBe(true)
    expect(cond(g, { kind: 'skin_exposure', min: 3 })).toBe(false)
    expect(cond(g, { kind: 'skin_exposure', max: 1 })).toBe(false)
    wear(g, null)
    expect(cond(g, { kind: 'skin_style', tag: 'maid' })).toBe(false)
    expect([stat(g, 'skin_exposure'), stat(g, 'skin_style_value')]).toEqual([0, 0])
  })

  it('DATA 7.4 節的寫法（style 字串加 style_value）也讀；空白 SKIN 的 custom 曝露度是 0；不在背包裡的不算穿著', () => {
    const g = make()
    wear(g, 'sk_goth')
    expect(cond(g, { kind: 'skin_style', tag: 'gothic', min: 3 })).toBe(true)
    expect([stat(g, 'skin_exposure'), stat(g, 'skin_style_value')]).toEqual([1, 3])
    wear(g, 'sk_blank')
    expect(cond(g, { kind: 'skin_style', tag: 'custom' })).toBe(true)
    expect(stat(g, 'skin_exposure')).toBe(0)
    g.state.inventory = g.state.inventory.filter((s) => s.id !== 'sk_blank')
    expect(cond(g, { kind: 'skin_style', tag: 'custom' })).toBe(false)
  })

  it('條件看 ctx.actor（沒給是主角）；沒有這個人不成立；格式不對載入時擋下', () => {
    const g = make()
    wear(g, 'sk_maid')
    expect(cond(g, { kind: 'skin_style', tag: 'maid' }, 'npc_ann')).toBe(false)
    expect(cond(g, { kind: 'skin_style', tag: 'maid' }, 'nobody')).toBe(false)
    expect(g.k.conditions.validate({ kind: 'skin_style' })).toEqual([expect.stringContaining('tag')])
    expect(g.k.conditions.validate({ kind: 'skin_style', tag: 'maid', min: 0 })).toEqual([expect.stringContaining('min')])
    expect(g.k.conditions.validate({ kind: 'skin_style', tag: 'maid', min: 6 })).toEqual([expect.stringContaining('min')])
    expect(g.k.conditions.validate({ kind: 'skin_exposure', min: 4 })).toEqual([expect.stringContaining('min')])
    expect(g.k.conditions.validate({ kind: 'skin_exposure', min: 3, max: 1 })).toEqual([expect.stringContaining('min 不能大於 max')])
    expect(g.k.conditions.validate({ kind: 'skin_exposure', min: 1, max: 3 })).toEqual([])
    expect(g.k.conditions.validate({ kind: 'skin_style', tag: 'maid', min: 2 })).toEqual([])
  })

  it('SKIN 的格式：style 要是標籤或 { tag, value }，value 1～5；換 SKIN 的規則沒變（戰鬥外都行）', () => {
    const g = make()
    expect(skinBlock(g.k, g.state, 'pc', 'sk_maid')).toBeNull()
    expect(() => make({ packs: [{ id: 'bad', content: { skin: [{ id: 'sk_bad', name: 'x', style: { tag: 'maid', value: 9 } }] } } as unknown as ContentPack] })).toThrow(/style\.value 要是 1～5/)
    expect(() => make({ packs: [{ id: 'bad2', content: { skin: [{ id: 'sk_bad2', name: 'x', style: { value: 2 } }] } } as unknown as ContentPack] })).toThrow(/style\.tag/)
    expect(() => make({ packs: [{ id: 'bad3', content: { skin: [{ id: 'sk_bad3', name: 'x', style: 7 }] } } as unknown as ContentPack] })).toThrow(/style 要是字串/)
    expect(() => make({ packs: [{ id: 'ok', content: { skin: [{ id: 'sk_ok', name: 'x', style: 'maid', style_value: 4, exposure: 3 }] } } as unknown as ContentPack] })).not.toThrow()
  })
})

// ======================================================================
describe('內海的場景：什麼時候是內海、部位來自化身', () => {
  it('現實：沒有網內的活動時 layer 是 meat；現實義體多出來的部位在、化身的尾巴不在', () => {
    const g = make({ avatar: { gender: 'male', parts: ['tail'] } })
    begin(g)
    expect(raw(g).layer).toBe('meat')
    expect(partsOf(g)).toContain('ear')
    expect(partsOf(g)).not.toContain('tail')
    expect(g.state.reports.at(-1)!.timeline.every((b) => b.layer === 'meat')).toBe(true)
  })

  it('dive 進行中開一場沒寫 layer 的場景：layer 是 net；主角的部位有化身的 tail、沒有現實義體的 ear；每一拍標 net', () => {
    const g = make({ avatar: { gender: 'male', parts: ['tail'] } })
    flag(g, 't.dive', true)
    begin(g)
    expect(raw(g).layer).toBe('net')
    expect(partsOf(g)).toContain('tail')
    expect(partsOf(g)).not.toContain('ear')
    // 沒有化身的人（安）沒有多的部位
    expect(partsOf(g, 'npc_ann')).toEqual(['mouth', 'hand_l', 'hand_r', 'chest', 'front', 'back', 'legs'])
    const start = g.state.reports.at(-1)!
    expect(start.timeline.length).toBeGreaterThan(0)
    expect(start.timeline.every((b) => b.layer === 'net')).toBe(true)
    touch(g)
    expect(g.state.reports.at(-1)!.timeline.every((b) => b.layer === 'net')).toBe(true)
    // 摘要與畫面資料也標 net
    expect(sceneOptions(g.k, g.state)).toBeTruthy()
  })

  it('三種網內的活動（dive、netrun、face.net）進行中都放行 scene.start 與 commit:scene.，沒寫 layer 也是 net', () => {
    for (const kind of ['dive', 'netrun', 'face.net']) {
      const g = make({ avatar: { parts: ['tail'] } })
      flag(g, `t.${kind}`, true)
      expect(g.blockOf('scene.start')).toBeNull()
      expect(g.blockOf('commit:scene.act')).toBeNull()
      expect(g.blockOf('commit:scene.end')).toBeNull()
      begin(g)
      expect(raw(g).layer).toBe('net')
      expect(partsOf(g)).toContain('tail')
      touch(g)
      stop(g)
      expect(sceneRawOf(g.state)).toBeNull()
    }
  })

  it('明寫 layer: meat 就是現實（進行中的活動只決定沒寫時的預設）；layer 寫錯有原因；沒開網內的行程時明寫 layer: net 也開得起來（事件的夢）', () => {
    const g = make({ avatar: { parts: ['tail'] } })
    flag(g, 't.dive', true)
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'meat' }).summary).toMatchObject({ layer: 'meat' })
    expect(startProblems(g.k, g.state, SETUP).summary).toMatchObject({ layer: 'net' })
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'sky' }).problems).toEqual(['layer 要是 meat、net 其中一個。'])
    flag(g, 't.dive', null)
    expect(startProblems(g.k, g.state, SETUP).summary).toMatchObject({ layer: 'meat' })
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'net' }).summary).toMatchObject({ layer: 'net' })
    begin(g, { ...SETUP, layer: 'net' })
    expect(raw(g).layer).toBe('net')
    expect(partsOf(g)).toContain('tail')
  })

  it('單人與多人（完整版）的內海場景也開得起來，規則相同', () => {
    const g = make({ avatar: { parts: ['tentacle'] } })
    flag(g, 't.dive', true)
    begin(g, { solo: true, mode: 'full' })
    expect(raw(g)).toMatchObject({ layer: 'net', kind: 'solo' })
    expect(partsOf(g)).toContain('tentacle')
    stop(g)
    begin(g, { with: ['npc_ann', 'npc_bob'], nature: 'mutual', mode: 'full' })
    expect(raw(g)).toMatchObject({ layer: 'net', kind: 'group' })
    expect(raw(g).seats.map((s) => s.id)).toEqual(['pc', 'npc_ann', 'npc_bob'])
  })

  it('化身的部位：沒有敏感度的修正（P42）；化身的部位真的接得上（碰尾巴的技能在內海可用、在現實灰掉）', () => {
    const g = make({ avatar: { parts: ['tail'] }, annExt: { deck: { avatar: { parts: ['tail'] } } } })
    flag(g, 't.dive', true)
    begin(g)
    const p = new Play(g.k, g.state, raw(g), dice())
    expect(p.body.pc).toEqual({ parts: ['tail'], sensitivity: {}, tags: {} })
    expect(p.body.npc_ann).toEqual({ parts: ['tail'], sensitivity: {}, tags: {} })
    expect(partsOf(g, 'npc_ann')).toContain('tail')
    // 並坐的右手碰得到對方的尾（安的化身有尾）
    expect(skillOf(g, 'nt_tail').pairs.some((x) => x.my_part === 'hand_r' && x.their_part === 'tail' && x.blocks.length === 0)).toBe(true)
    stop(g)
    flag(g, 't.dive', null)
    begin(g)
    expect(partsOf(g, 'npc_ann')).not.toContain('tail')
    expect(skillOf(g, 'nt_tail').pairs.filter((x) => x.their_part === 'tail' && x.blocks.length === 0)).toEqual([])
  })
})

// ======================================================================
describe('沒有甲板、沒有橋；夢', () => {
  it('沒有甲板的人開不了內海的場景（寫明是甲板）；現實的場景照開', () => {
    const g = make({ noDeck: true })
    flag(g, 't.dive', true)
    expect(startProblems(g.k, g.state, SETUP).problems).toEqual(['你沒有甲板，進不了內海，開不起這一場。'])
    expect(blocked(() => begin(g))).toBe('你沒有甲板，進不了內海，開不起這一場。')
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'meat' }).problems).toEqual([])
    flag(g, 't.dive', null)
    expect(startProblems(g.k, g.state, SETUP).problems).toEqual([])
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'net' }).problems).toEqual(['你沒有甲板，進不了內海，開不起這一場。'])
  })

  it('沒有橋的人（ext.bridge 是 null）開不了內海的場景；甲板與橋都沒有時兩條原因各一句；夢也不行（沒有橋就沒有感載）', () => {
    const g = make({ bridge: null })
    flag(g, 't.dive', true)
    expect(startProblems(g.k, g.state, SETUP).problems).toEqual(['你沒有橋，感覺不到內海裡的一切，開不起這一場。'])
    const h = make({ bridge: null, noDeck: true })
    expect(startProblems(h.k, h.state, { ...SETUP, layer: 'net' }).problems).toEqual(['你沒有橋，感覺不到內海裡的一切，開不起這一場。', '你沒有甲板，進不了內海，開不起這一場。'])
    expect(startProblems(h.k, h.state, { ...SETUP, layer: 'net', dream: true }).problems).toEqual(['你沒有橋，感覺不到內海裡的一切，開不起這一場。'])
  })

  it('夢（layer: net 而且 dream: true）不需要甲板，也不需要任何網內的活動；dream 要明寫 layer: net', () => {
    const g = make({ noDeck: true, avatar: { parts: ['tail'] } })
    const r = startProblems(g.k, g.state, { ...SETUP, layer: 'net', dream: true })
    expect(r.problems).toEqual([])
    expect(r.summary).toMatchObject({ layer: 'net', dream: true })
    begin(g, { ...SETUP, layer: 'net', dream: true })
    expect(raw(g)).toMatchObject({ layer: 'net', dream: true })
    expect(partsOf(g)).toContain('tail')
    stop(g)
    expect(startProblems(g.k, g.state, { ...SETUP, dream: true }).problems).toEqual(["夢的場景要明寫 layer: 'net'。"])
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'meat', dream: true }).problems).toEqual(["夢的場景要明寫 layer: 'net'。"])
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'net', dream: 'yes' }).problems).toContain('dream 要是 true 或 false。')
    // 夢的單人場景
    begin(g, { solo: true, mode: 'full', layer: 'net', dream: true })
    expect(raw(g)).toMatchObject({ layer: 'net', kind: 'solo', dream: true })
  })
})

// ======================================================================
describe('性別：內海看化身的性別', () => {
  it('主角是 female、化身是 male：內海的摘要裡主角是 male、現實是 female；沒有化身的對象照角色自己的', () => {
    const g = make({ avatar: { gender: 'male', parts: [] } })
    expect(genderIn(g.state, 'pc', 'meat')).toBe('female')
    expect(genderIn(g.state, 'pc', 'net')).toBe('male')
    expect(genderIn(g.state, 'npc_ann', 'net')).toBe('female')
    expect(genderIn(g.state, 'nobody', 'net')).toBeUndefined()
    flag(g, 't.dive', true)
    expect(startProblems(g.k, g.state, SETUP).summary!.genders).toEqual({ pc: 'male', npc_ann: 'female' })
    // 現實的摘要沒有這個鍵（和以前逐欄相同）
    expect(startProblems(g.k, g.state, { ...SETUP, layer: 'meat' }).summary).not.toHaveProperty('genders')
  })

  it('化身的性別不是五個值之一：照角色自己的（不丟錯）', () => {
    const g = make({ avatar: { gender: 'robot' } })
    expect(genderIn(g.state, 'pc', 'net')).toBe('female')
    g.state.actors.pc!.ext.deck = 'x'
    expect(genderIn(g.state, 'pc', 'net')).toBe('female')
  })

  it('對象的性別篩選看化身：男性對象關掉時，現實的鮑伯（male）開不起來，他的化身是 female 的內海場景開得起來；反過來女性的對象有男性化身就被擋', () => {
    const bob = make({ contentOff: ['male_partner'], bobExt: { deck: { avatar: { gender: 'female' } } } })
    expect(startProblems(bob.k, bob.state, { with: ['npc_bob'], nature: 'mutual', mode: 'full' }).problems).toEqual(['「男性對象」被你的內容篩選關掉了，對象是這個性別的場景開不起來。'])
    expect(startProblems(bob.k, bob.state, { with: ['npc_bob'], nature: 'mutual', mode: 'full', layer: 'net' }).problems).toEqual([])
    flag(bob, 't.dive', true)
    expect(startProblems(bob.k, bob.state, { with: ['npc_bob'], nature: 'mutual', mode: 'full' }).problems).toEqual([])
    expect(startProblems(bob.k, bob.state, { with: ['npc_bob'], nature: 'mutual', mode: 'full' }).summary!.filters.map((f) => f.tag)).toEqual(['female_partner'])
    // 安（female）的化身是 male，男性對象關掉：內海開不起來、現實開得起來
    const ann = make({ contentOff: ['male_partner'], annExt: { deck: { avatar: { gender: 'male' } } } })
    expect(startProblems(ann.k, ann.state, SETUP).problems).toEqual([])
    expect(startProblems(ann.k, ann.state, { ...SETUP, layer: 'net' }).problems).toEqual(['「男性對象」被你的內容篩選關掉了，對象是這個性別的場景開不起來。'])
  })

  it('主角自己的性別（現實或化身）不拿來擋場景：男性對象關掉，化身是 male 的主角照開', () => {
    const g = make({ contentOff: ['male_partner'], avatar: { gender: 'male' } })
    flag(g, 't.dive', true)
    expect(startProblems(g.k, g.state, SETUP).problems).toEqual([])
  })
})

// ======================================================================
describe('技能的 needs：要 SKIN 風格的寫 skin_style', () => {
  it('穿著 maid 風格 2 的 SKIN：技能在內海用得出來；沒穿或風格不夠就灰掉並寫出那一句；風格夠但標籤不對也灰掉', () => {
    const g = make()
    flag(g, 't.dive', true)
    begin(g)
    expect(skillOf(g, 'nt_maid').blocks).toEqual(['要穿著女僕風格的 SKIN。'])
    stop(g)
    flag(g, 't.dive', null)
    wear(g, 'sk_maid')
    flag(g, 't.dive', true)
    begin(g)
    expect(skillOf(g, 'nt_maid').blocks).toEqual([])
    expect(() => act(g, { kind: 'skill', id: 'nt_maid', pick: { my_part: 'hand_l', their_part: 'chest' } })).not.toThrow()
    stop(g)
    flag(g, 't.dive', null)
    wear(g, 'sk_goth')
    flag(g, 't.dive', true)
    begin(g)
    expect(skillOf(g, 'nt_maid').blocks).toEqual(['要穿著女僕風格的 SKIN。'])
  })
})

// ======================================================================
describe('結算：感載歸零、餘韻留著、體悟照給、result.layer', () => {
  /** 打一輪再停下：主角用輕輕碰（固定骰面）。 */
  function playNet(g: Game): void {
    begin(g)
    touch(g)
  }

  it('內海的一場結束：result.layer 是 net；主角的感載歸零、餘韻留著（回到現實還在）、體悟照給；現實的一場 result.layer 是 meat', () => {
    const heard: Rec[] = []
    const watcher: Feature = { id: 'net_test_watch', install(k) { k.hooks.on('activity.end', 'net_test_watch', (p) => { if (p.kind === 'scene') heard.push(p.result as Rec) }) } }
    const g = make({ features: [watcher], pc: { afterglow: 2 } })
    flag(g, 't.dive', true)
    playNet(g)
    expect(raw(g).layer).toBe('net')
    g.state.actors.pc!.load = 12
    g.state.actors.pc!.afterglow = 2
    stop(g)
    expect(sceneRawOf(g.state)).toBeNull()
    expect(heard[0]).toMatchObject({ layer: 'net', reason: 'stop' })
    const pc = g.state.actors.pc!
    expect(pc.load).toBe(0)
    // 餘韻留著：回到現實（沒有網內的活動了）也還在
    flag(g, 't.dive', null)
    expect(pc.afterglow).toBe(2)
    expect(g.state.meters.insight!._).toBeGreaterThan(0)
    const last = g.state.reports.at(-1)!
    expect(last.action).toBe('scene.end')
    expect(last.timeline.every((b) => b.layer === 'net')).toBe(true)
    // 現實的同一場
    const h = make({ features: [watcher] })
    begin(h)
    stop(h)
    expect(heard[1]).toMatchObject({ reason: 'stop' })
    expect(heard[1]).not.toHaveProperty('layer')
    expect(h.state.reports.at(-1)!.timeline.every((b) => b.layer === 'meat')).toBe(true)
  })

  it('單人與多人的結算也帶 layer', () => {
    const heard: Rec[] = []
    const watcher: Feature = { id: 'net_test_watch', install(k) { k.hooks.on('activity.end', 'net_test_watch', (p) => { if (p.kind === 'scene') heard.push(p.result as Rec) }) } }
    const g = make({ features: [watcher] })
    flag(g, 't.dive', true)
    begin(g, { solo: true, mode: 'full' })
    stop(g)
    begin(g, { with: ['npc_ann', 'npc_bob'], nature: 'mutual', mode: 'full' })
    stop(g)
    expect(heard.map((r) => r.layer)).toEqual(['net', 'net'])
    expect(heard[0]).toMatchObject({ solo: true })
  })

  it('每回合的感載消退：內海是 net_load_decay（有散熱的甲板 1，沒有散熱的 0，沒有 mod(意志)）；現實是 2 ＋ mod(意志)', () => {
    const roundEnd = (g: Game): number => {
      g.state.actors.pc!.load = 10
      const p = new Play(g.k, g.state, raw(g), dice())
      p.settleRound()
      return p.load.pc!
    }
    const warm = make()
    flag(warm, 't.dive', true)
    begin(warm)
    expect(stat(warm, 'net_load_decay')).toBe(1)
    expect(roundEnd(warm)).toBe(9)
    const cold = make({ deck: 'dk_cold' })
    flag(cold, 't.dive', true)
    begin(cold)
    expect(stat(cold, 'net_load_decay')).toBe(0)
    expect(roundEnd(cold)).toBe(10)
    const meat = make()
    begin(meat)
    const mod = attrMod(meat.k.stats.effectiveAttr(meat.state, 'pc', 'resolve'))
    expect(roundEnd(meat)).toBe(10 - Math.max(0, 2 + mod))
    // 沒有人定義 net_load_decay（沒裝 deck）：內海不消退
    const bare = makeGame({
      features: [characterFeature, lewdFeature, meterFeature(AFFINITY), sceneFeature, HELPER], content: [{ id: 'bare', content: { night_skill: [], position: PACK.content.position } } as unknown as ContentPack, FACILITY_PACK, METER_CONTENT],
      pc: { ext: { bridge: PC_BRIDGE, scene: { skills: [], positions: [] } } }, actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc', ext: { bridge: ANN_BRIDGE } })],
    }).game
    begin(bare, { ...SETUP, layer: 'net', dream: true })
    expect(bare.k.stats.hasStat('net_load_decay')).toBe(false)
    expect(roundEnd(bare)).toBe(10)
  })
})

// ======================================================================
describe('網內的行程被強制結束：場景跟著被打斷並結算', () => {
  const FORCE = (g: Game, kind: string): void => void ((g.state.flags as Record<string, unknown>)['t.force_end'] = kind)

  it.each(['dive', 'netrun', 'face.net'])('替身的 %s 被強制結束：進行中的內海場景被打斷並結算（感載歸零、餘韻留著、體悟照給），報告的句子裡有「被外面的事打斷了」', (kind) => {
    const heard: Rec[] = []
    const watcher: Feature = { id: 'net_test_watch', install(k) { k.hooks.on('activity.end', 'net_test_watch', (p) => { if (p.kind === 'scene') heard.push({ ...(p.result as Rec), outcome: p.outcome }) }) } }
    const g = make({ features: [watcher] })
    flag(g, `t.${kind}`, true)
    begin(g)
    g.state.actors.pc!.load = 7
    g.state.actors.pc!.afterglow = 1
    FORCE(g, kind)
    touch(g)
    expect(sceneRawOf(g.state)).toBeNull()
    expect(g.state.flags[`t.${kind}`]).toBeUndefined()
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ layer: 'net', reason: 'interrupted', outcome: 'interrupted' })
    expect(g.state.actors.pc!.load).toBe(0)
    expect(g.state.actors.pc!.afterglow).toBeGreaterThanOrEqual(1)
    expect(g.state.meters.insight!._).toBeGreaterThan(0)
    const forced = g.state.reports.find((r) => r.action === 'test.net_end')!
    expect(forced).toBeTruthy()
    expect(forced.outcome.summary).toContain('強制結束')
    expect(forced.outcome.summary).toContain('被外面的事打斷了')
  })

  it('夢不跟著被打斷；現實的場景（layer: meat）也不被網內的行程結束帶走', () => {
    const g = make({ noDeck: true })
    begin(g, { ...SETUP, layer: 'net', dream: true })
    FORCE(g, 'dive')
    touch(g)
    expect(sceneRawOf(g.state)).not.toBeNull()
    expect(g.state.flags['t.force_end']).toBeUndefined()
    stop(g)
    const h = make()
    begin(h)
    FORCE(h, 'netrun')
    touch(h)
    expect(sceneRawOf(h.state)).not.toBeNull()
  })

  it('別種活動結束（不是 dive、netrun、face.net）不打斷內海場景', () => {
    const g = make()
    flag(g, 't.dive', true)
    begin(g)
    FORCE(g, 'toy')
    touch(g)
    expect(sceneRawOf(g.state)).not.toBeNull()
  })
})

// ======================================================================
describe('兩邊不串：義體（cyberware）的 scene.body 只在現實層、化身的只在內海層', () => {
  const EAR = { id: 'bp_ears', kind: 'cyberware', name: '獸耳', desc: '一件義體。', brand: 'hz', grade: 1, legal: 'free', price: 900, require: [], optional: [], slot: 'ear_throat', invasiveness: 'light', sink_cost: 4, needs_bridge: false, scene_parts: { adds: ['ear'], sensitivity: { ear: 15 } } }
  const pack: ContentPack = { id: 'net_test_cyber', content: { blueprint: [EAR] } } as unknown as ContentPack
  const piece = { uid: 'e1', bp: 'bp_ears', slot: 'ear_throat', parts: {}, sink: 4, at: 0 }

  /** 真的 cyberware：身上有獸耳（現實的部位 ear）、化身開了尾巴；沒有橋的限制用不到：夢的場景不需要甲板。 */
  function both(): Game {
    const g = make({ features: [cyberwareFeature], packs: [pack], noDeck: true, avatar: { parts: ['tail'] } })
    g.state.actors.pc!.ext.cyber = { pieces: [piece] }
    return g
  }

  it('現實的場景：有義體的 ear（還有它的敏感度修正），沒有化身的 tail；內海的場景：有化身的 tail，沒有義體的 ear、沒有敏感度的修正', () => {
    const g = both()
    begin(g)
    expect(raw(g).layer).toBe('meat')
    const meat = new Play(g.k, g.state, raw(g), dice())
    expect(meat.body.pc!.parts).toEqual(['ear'])
    expect(meat.body.pc!.sensitivity).toMatchObject({ ear: 15 })
    expect(partsOf(g)).toContain('ear')
    expect(partsOf(g)).not.toContain('tail')
    stop(g)
    begin(g, { ...SETUP, layer: 'net', dream: true })
    const net = new Play(g.k, g.state, raw(g), dice())
    expect(net.body.pc).toEqual({ parts: ['tail'], sensitivity: {}, tags: {} })
    expect(partsOf(g)).toContain('tail')
    expect(partsOf(g)).not.toContain('ear')
  })
})
