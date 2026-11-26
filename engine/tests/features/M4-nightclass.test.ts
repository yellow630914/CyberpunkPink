// 驗收測試：dev/work/M4-nightclass.md（cpp-feature）。規格：LEWD_SYSTEM 第 10 節；NIGHT_LESSONS 開頭的「寫法的約定」、共通的開階表與共鳴表、「補充規則」；DATA 3.1、3.2 節；
// dev/adr/0019 第十節與 P31、P32。
// 內容一律用測試自帶的最小假資料：八個夜課技能（共通 1、2 階各一、一個體位技能、掛 tg_dom 的 3 階一個帶 deep、帶 requires 三種的各一、一個帶 filters: ['ntr']）、兩筆共鳴、三個體位。

import { describe, expect, it } from 'vitest'
import type { ContentEntry, ContentPack, Feature, GameState, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import { computeTier, learnBlock, learnDraft, learnProblems, nightList, nightRules, nightTier, nightclassFeature } from '../../src/features/nightclass'
import type { SceneInput, SceneRaw } from '../../src/features/scene'
import { Play, knownPositions, knownSkills, sceneAct, sceneFeature, sceneNext, sceneRawOf, sceneView, scenePreview, startProblems } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { makeActor, makeGame } from '../../src/testkit'

// ---- 假內容 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const links = [
  { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['b', 'hand_l'], to: ['a', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['b', 'mouth'], to: ['a', 'mouth'] },
]
const HAND = { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 } }

const PACK: ContentPack = {
  id: 'night_test',
  content: {
    night_skill: [
      { id: 'nt_c1', name: '指腹游走', branch: 'common', tier: 1, tag: '共通', scene: HAND },
      { id: 'nt_c2', name: '換我在上面', branch: 'common', tier: 2, tag: '共通', scene: HAND },
      // 體位技能：開放 pos_kneel（沒有自己的 scene）
      { id: 'nt_pos', name: '跪姿', branch: 'common', tier: 2, tag: '共通' },
      // 掛 tg_dom 的 3 階：標籤「有」時契合 +4，「深」時照 deep 寫的 +7（連接持續的契合 1 → 3）
      {
        id: 'nt_dom3', name: '牽著走', branch: 'relation', tier: 3, tag: 'tg_dom', tags: ['tg_dom'],
        scene: { ap: 2, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '2d6', my_load: '1d6', fit: 4, initiative: 15 }, link: { their_load: '1d6', fit: 1 } },
        deep: { on_use: { fit: 7 }, link: { fit: 3 } },
      },
      // 帶 requires 三種的各一
      { id: 'nt_req_bridge', name: '再忍一下', branch: 'common', tier: 1, tag: '共通', requires: { bridge: { tolerance_min: 40, docility_max: 60 } }, scene: HAND },
      { id: 'nt_req_exp', name: '說悄悄話', branch: 'common', tier: 1, tag: '共通', requires: { experience: { partners: 3 } }, scene: HAND },
      { id: 'nt_req_cond', name: '用鑰匙卡', branch: 'common', tier: 1, tag: '共通', requires: { conditions: [{ kind: 'has_item', id: 'it_key', text: '要帶著鑰匙卡。' }] }, scene: HAND },
      // 跟著 NTR 的篩選
      { id: 'nt_ntr', name: '別人的故事', branch: 'sense', tier: 1, tag: 'relation', filters: ['ntr'], scene: HAND },
    ],
    position: [
      { id: 'pos_face', name: '面對面', people: 2, roles, mult: { a: 1, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: null, links },
      { id: 'pos_behind', name: '從後面', people: 2, roles, mult: { a: 1, b: 1.25 }, initiative_drift: 3, tags: [], unlocked_by: null, links },
      { id: 'pos_kneel', name: '跪姿', people: 2, roles, mult: { a: 1.25, b: 1 }, initiative_drift: 3, tags: [], unlocked_by: 'nt_pos', links },
    ],
    night_resonance: [
      // 共通 2 階：每場第一次切換體位不花行動點
      { id: 'rs_free', branch: 'common', tier: 2, name: '喘口氣', desc: '每場第一次切換體位不花行動點。', scene: { free_switch: 1 } },
      // 關係 2 階：自己高潮時主動權只掉 10（原本 15）
      { id: 'rs_climax', branch: 'relation', tier: 2, name: '穩得住', desc: '高潮時主動權只掉 10。', scene: { rules: { climax_init_self: 5 } } },
      // 感官 1 階：第一條有持續效果的連接契合多 +1、場景結束契合 +5、開場看得到對象最高的軸
      { id: 'rs_all', branch: 'sense', tier: 1, name: '全都要', scene: { first_link_fit: 1, end_fit: 5, reveal: 'axis' } },
    ],
    item: [{ id: 'it_key', name: '鑰匙卡', desc: '一張測試用的卡。', category: 'tool', grade: 1, size: 0, legal: 'free' }],
  },
}

const BRIDGE = { sensitivity: 50, tolerance: 30, craving: 30, docility: 10 }
type Game = ReturnType<typeof makeGame>['game']

interface Opts {
  pc?: ActorOverrides
  ann?: ActorOverrides
  contentOff?: string[]
  /** 只裝 scene、不裝 nightclass */
  noNight?: boolean
  insight?: number
  pack?: ContentPack
  features?: Feature[]
}

function game(o: Opts = {}): Game {
  const ann = makeActor({ id: 'npc_ann', name: '安', role: 'npc', ...o.ann, ext: { bridge: { ...BRIDGE, docility: 30 }, ...(o.ann?.ext ?? {}) } })
  const g = makeGame({
    features: [characterFeature, lewdFeature, sceneFeature, ...(o.noNight ? [] : [nightclassFeature]), ...(o.features ?? [])],
    content: [o.pack ?? PACK],
    pc: { ...o.pc, ext: { bridge: BRIDGE, ...(o.pc?.ext ?? {}) } },
    actors: [ann],
    patch: o.contentOff ? ({ rules: { contentOff: o.contentOff } } as unknown as Partial<GameState>) : undefined,
  }).game
  if (o.insight !== undefined) g.state.meters.insight = { _: o.insight }
  return g
}

const record = (o: Record<string, unknown>) => ({ sex_record: { partners: 0, times: 0, service_times: 0, people: {}, positions: [], tags: [], ...o } })
const insight = (g: Game): number => (g.state.meters.insight?._ as number | undefined) ?? 0
const learned = (g: Game, who = 'pc'): string[] => ((g.state.actors[who]!.ext.scene as { skills?: string[] } | undefined)?.skills ?? [])
const positions = (g: Game, who = 'pc'): string[] => ((g.state.actors[who]!.ext.scene as { positions?: string[] } | undefined)?.positions ?? [])
const blockedBy = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ActionBlocked) return e.reason
    throw e
  }
  throw new Error('應該被擋下')
}
const learn = (g: Game, id: string, who = 'pc') => g.commit(learnDraft(g.k, g.state, who, id))
const ids = (g: Game, who = 'pc') => nightList(g.k, g.state, who).branches.flatMap((b) => b.skills.map((s) => s.id))
const draft = (changes: ReportDraft['changes'], action = 'test.fx'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

// ======================================================================
describe('開階：衍生數值 night_tier_*', () => {
  it('共通看性經歷：0 次是 1 階；8 次或 5 人是 2 階；20 次或 8 人、40 次或 12 人、80 次或 20 人是 3、4、5 階', () => {
    const t = (o: Record<string, unknown>): number => {
      const g = game({ pc: { ext: record(o) } })
      return g.k.stats.stat(g.state, 'pc', 'night_tier_common')
    }
    expect(t({ times: 0 })).toBe(1)
    expect(t({ times: 7, partners: 4 })).toBe(1)
    expect(t({ times: 8 })).toBe(2)
    expect(t({ partners: 5 })).toBe(2)
    expect(t({ times: 20 })).toBe(3)
    expect(t({ partners: 8 })).toBe(3)
    expect(t({ times: 40 })).toBe(4)
    expect(t({ partners: 12 })).toBe(4)
    expect(t({ times: 80 })).toBe(5)
    expect(t({ partners: 20 })).toBe(5)
    expect(t({ times: 999, partners: 99 })).toBe(5)
    // 對象的人數也看 people 裡有幾個人
    expect(t({ people: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((x) => [x, 1])) })).toBe(2)
  })

  it('單人的次數不算：只有 solo_times 的人還是 1 階', () => {
    const g = game({ pc: { ext: record({ solo_times: 500, solo_poses: ['solo_spread'] }) } })
    expect(g.k.stats.stat(g.state, 'pc', 'night_tier_common')).toBe(1)
  })

  it('其餘四支看那一條軸的等級：關係 3 級是關係 3 階；沒有傾向是 0；超過 5 夾在 5', () => {
    const g = game({ pc: { ext: { tendency: { axes: { relation: 3, sense: 1, body: 0, costume: 9 }, points: {}, tags: {} } } } })
    const t = (b: string): number => g.k.stats.stat(g.state, 'pc', `night_tier_${b}`)
    expect([t('relation'), t('sense'), t('body'), t('costume')]).toEqual([3, 1, 0, 5])
    expect(nightTier(g.k, g.state, 'pc', 'relation')).toBe(3)
  })

  it('五個衍生數值對一個生成的 NPC（沒有任何 ext）也算得出來', () => {
    const g = game({ ann: { ext: {} } })
    const gen = makeActor({ id: 'gen_42nd_0012', name: '米拉', role: 'npc' })
    g.state.actors[gen.id] = gen
    for (const b of ['common', 'relation', 'sense', 'body', 'costume']) expect(() => g.k.stats.stat(g.state, gen.id, `night_tier_${b}`)).not.toThrow()
    expect(g.k.stats.stat(g.state, gen.id, 'night_tier_common')).toBe(1)
    expect(g.k.stats.stat(g.state, gen.id, 'night_tier_body')).toBe(0)
  })

  it('規則 night_rule 可以蓋掉門檻與每階的體悟；格式不對載入時擋下', () => {
    expect(nightRules(game().k).common_gates).toEqual([[0, 0], [8, 5], [20, 8], [40, 12], [80, 20]])
    expect(nightRules(game().k).insight_per_tier).toBe(10)
    const over: ContentPack = { id: 'rule', content: { night_rule: [{ id: 'default', common_gates: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]], insight_per_tier: 5 }] } }
    const g = game({ pc: { ext: record({ times: 2 }) }, pack: PACK })
    const g2 = makeGame({ features: [characterFeature, lewdFeature, sceneFeature, nightclassFeature], content: [PACK, over], pc: { ext: { bridge: BRIDGE, ...record({ times: 2 }) } } }).game
    expect(nightTier(g2.k, g2.state, 'pc', 'common')).toBe(3)
    expect(nightRules(g2.k).insight_per_tier).toBe(5)
    expect(g.k.stats.stat(g.state, 'pc', 'night_tier_common')).toBe(1)
    const bad = (rule: Record<string, unknown>) => () => makeGame({ features: [characterFeature, sceneFeature, nightclassFeature], content: [{ id: 'bad', content: { night_rule: [{ id: 'default', ...rule }] } }] })
    expect(bad({ common_gates: [[0, 0]] })).toThrow(/common_gates/)
    expect(bad({ common_gates: [[0, 0], [8, 5], [4, 8], [40, 12], [80, 20]] })).toThrow(/一階比一階高/)
    expect(bad({ insight_per_tier: 0 })).toThrow(/insight_per_tier/)
    expect(bad({ axis_of: { common: 'body' } })).toThrow(/axis_of/)
    expect(bad({ whatever: 1 })).toThrow(/沒有這個規則/)
  })

  it('computeTier 是純函式：沒有角色是 0', () => {
    expect(computeTier(nightRules(game().k), undefined, 'common')).toBe(0)
  })
})

// ======================================================================
describe('nightList：看得到哪些', () => {
  const dom = (state: string | null): ActorOverrides => ({ ext: { tendency: { axes: { relation: 3 }, points: {}, tags: state ? { tg_dom: state } : {} } } })

  it('沒有 tg_dom 標籤的人看不到那一招；有的人（有或深）看得到；潛在不算', () => {
    expect(ids(game({ pc: dom(null) }))).not.toContain('nt_dom3')
    expect(ids(game({ pc: dom('latent') }))).not.toContain('nt_dom3')
    expect(ids(game({ pc: dom('has') }))).toContain('nt_dom3')
    expect(ids(game({ pc: dom('deep') }))).toContain('nt_dom3')
  })

  it('共通與只掛軸的技能不看標籤：沒有任何標籤也列出來', () => {
    const list = ids(game({ pc: dom(null) }))
    expect(list).toEqual(expect.arrayContaining(['nt_c1', 'nt_c2', 'nt_pos', 'nt_ntr']))
  })

  it('ntr 關掉時帶 filters: ["ntr"] 的那一招整個不列；開著時列', () => {
    expect(ids(game())).toContain('nt_ntr')
    expect(ids(game({ contentOff: ['ntr'] }))).not.toContain('nt_ntr')
    // 掛的標籤被關掉的也整個不列
    expect(ids(game({ pc: dom('has'), contentOff: ['tg_dom'] }))).not.toContain('nt_dom3')
  })

  it('每個分支開到幾階、每個技能的狀態與原因與要花多少', () => {
    const g = game({ pc: { ext: { ...record({ times: 8 }), ...dom('has').ext, bridge: { ...BRIDGE, tolerance: 20 } } }, insight: 25 })
    const view = nightList(g.k, g.state, 'pc')
    expect(view.insight).toBe(25)
    expect(view.branches.map((b) => [b.branch, b.tier])).toEqual([['common', 2], ['relation', 3], ['sense', 0], ['body', 0], ['costume', 0]])
    const by = (id: string) => view.branches.flatMap((b) => b.skills).find((s) => s.id === id)!
    expect(by('nt_c1')).toMatchObject({ status: 'learnable', cost: 10, reason: null, reasons: [] })
    expect(by('nt_c2')).toMatchObject({ status: 'learnable', cost: 20, tier: 2 })
    // 體悟不夠的是「條件不夠」：寫出差多少
    expect(by('nt_dom3')).toMatchObject({ status: 'unmet', cost: 30, tag: 'tg_dom' })
    expect(by('nt_dom3').reason).toMatch(/30 點體悟.*25 點/)
    expect(by('nt_req_bridge')).toMatchObject({ status: 'unmet' })
    expect(by('nt_req_bridge').reasons).toEqual(['耐受要有 40，你現在是 20。'])
    // 階還沒開
    expect(by('nt_ntr')).toMatchObject({ status: 'tier_closed', branch: 'sense' })
    expect(by('nt_ntr').reason).toBe('感官這一條要到 1 級才開 1 階（現在 0 級）。')
    expect(by('nt_pos').positions).toEqual(['pos_kneel'])
  })
})

// ======================================================================
describe('學習', () => {
  it('體悟 10 學 1 階的：扣 10、ext.scene.skills 多一筆、報告 nightclass.learn', () => {
    const g = game({ insight: 10 })
    const r = learn(g, 'nt_c1')[0]!
    expect(insight(g)).toBe(0)
    expect(learned(g)).toEqual(['nt_c1'])
    expect(r.action).toBe('nightclass.learn')
    expect(r.timeline[0]!.text).toContain('指腹游走')
    expect(nightList(g.k, g.state, 'pc').branches[0]!.skills.find((s) => s.id === 'nt_c1')).toMatchObject({ status: 'learned', reason: null })
  })

  it('體悟不夠：被擋並寫出差多少；沒有扣、沒有學會', () => {
    const g = game({ insight: 9 })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_c1'))).toMatch(/10 點體悟.*9 點/)
    expect(learnBlock(g.k, g.state, 'pc', 'nt_c1')).toMatch(/體悟/)
    expect(insight(g)).toBe(9)
    expect(learned(g)).toEqual([])
  })

  it('階沒開：共通 2 階要 8 次或 5 人', () => {
    const g = game({ insight: 100 })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_c2'))).toBe('共通的 2 階還沒開：看性經歷的次數或對象的人數（現在開到 1 階）。')
    const g2 = game({ insight: 100, pc: { ext: record({ partners: 5 }) } })
    expect(learnBlock(g2.k, g2.state, 'pc', 'nt_c2')).toBeNull()
    expect(insight(game({ insight: 100, pc: { ext: record({ partners: 5 }) } }))).toBe(100)
    learn(g2, 'nt_c2')
    expect(insight(g2)).toBe(80)
  })

  it('階沒開（其餘分支）：關係 2 級學不了 3 階', () => {
    const g = game({ insight: 100, pc: { ext: { tendency: { axes: { relation: 2 }, points: {}, tags: { tg_dom: 'has' } } } } })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_dom3'))).toBe('關係這一條要到 3 級才開 3 階（現在 2 級）。')
  })

  it('耐受不到：requires.bridge 看有效值（衍生數值 bridge_tolerance，義體與藥加的算進去）；馴化上限也看', () => {
    const g = game({ insight: 100 })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_req_bridge'))).toBe('耐受要有 40，你現在是 30。')
    // 有效值：別人加了 provider 就算進去
    g.k.stats.addStatProvider('bridge_tolerance', 'test', () => [{ source: 'test', label: '義體', value: 10 }])
    expect(learnBlock(g.k, g.state, 'pc', 'nt_req_bridge')).toBeNull()
    const hi = game({ insight: 100, pc: { ext: { bridge: { ...BRIDGE, tolerance: 60, docility: 80 } } } })
    expect(blockedBy(() => learnDraft(hi.k, hi.state, 'pc', 'nt_req_bridge'))).toBe('馴化要在 60 以下，你現在是 80。')
    // 沒有橋
    const none = game({ insight: 100, pc: { ext: { bridge: null } } })
    expect(learnBlock(none.k, none.state, 'pc', 'nt_req_bridge')).toMatch(/耐受/)
  })

  it('對象人數不到：requires.experience.partners 3', () => {
    const g = game({ insight: 100 })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_req_exp'))).toBe('要和 3 個人有過，你現在是 0 個。')
    const ok = game({ insight: 100, pc: { ext: record({ partners: 3 }) } })
    expect(learnBlock(ok.k, ok.state, 'pc', 'nt_req_exp')).toBeNull()
  })

  it('條件不成立：requires.conditions 用 k.conditions；寫了 text 就用它', () => {
    const g = game({ insight: 100 })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_req_cond'))).toBe('要帶著鑰匙卡。')
    g.state.inventory.push({ id: 'it_key', qty: 1 })
    expect(learnBlock(g.k, g.state, 'pc', 'nt_req_cond')).toBeNull()
  })

  it('沒有人註冊的條件種類當作不成立，原因寫「這個條件現在還判斷不了。」；載入不擋', () => {
    const pack: ContentPack = { id: 'p', content: { night_skill: [{ id: 'nt_moon', name: '看月相', branch: 'common', tier: 1, requires: { conditions: [{ kind: 'moon_phase', phase: 'full' }] }, scene: HAND }] } }
    const g = game({ insight: 100, pack })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_moon'))).toBe('這個條件現在還判斷不了。')
  })

  it('學過的再學被擋', () => {
    const g = game({ insight: 100 })
    learn(g, 'nt_c1')
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_c1'))).toBe('已經學會了。')
    expect(insight(g)).toBe(90)
    expect(learnProblems(g.k, g.state, 'pc', 'nt_c1')).toEqual(['已經學會了。'])
  })

  it('看不到的技能學不了：標籤被篩選關掉、沒有那個標籤；沒有這個技能與這個角色也有原因', () => {
    const g = game({ insight: 100, contentOff: ['ntr'], pc: { ext: { tendency: { axes: { sense: 1 }, points: {}, tags: {} } } } })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_ntr'))).toBe('這個技能被你的內容篩選關掉了。')
    const none = game({ insight: 100, pc: { ext: { tendency: { axes: { relation: 3 }, points: {}, tags: {} } } } })
    expect(blockedBy(() => learnDraft(none.k, none.state, 'pc', 'nt_dom3'))).toBe('你還沒有這個技能掛的傾向標籤。')
    expect(learnProblems(none.k, none.state, 'pc', 'nt_nope')).toEqual(['沒有這個夜課技能。'])
    expect(learnProblems(none.k, none.state, 'ghost', 'nt_c1')).toEqual(['沒有這個角色。'])
  })

  it('每個擋住的原因各一句：階沒開時只回報階；其餘條件一條一個', () => {
    const g = game({ insight: 1 })
    const view = nightList(g.k, g.state, 'pc').branches[0]!.skills.find((s) => s.id === 'nt_req_bridge')!
    expect(view.status).toBe('unmet')
    expect(view.reasons).toEqual(['耐受要有 40，你現在是 30。', '要 10 點體悟，現在只有 1 點。體悟從成人場景與成人事件來，不能用歷練點換。'])
  })

  it('學了體位技能：ext.scene.positions 多了它開放的體位；原有的 ext.scene 其他欄位留著', () => {
    const g = game({ insight: 100, pc: { ext: { ...record({ partners: 5 }), scene: { skills: [], positions: ['pos_x'], parts: ['tail'] } } } })
    learn(g, 'nt_pos')
    expect(learned(g)).toEqual(['nt_pos'])
    expect(positions(g)).toEqual(['pos_x', 'pos_kneel'])
    expect((g.state.actors.pc!.ext.scene as { parts?: string[] }).parts).toEqual(['tail'])
    expect(g.state.reports.at(-1)!.timeline.map((b) => b.text).join('')).toContain('跪姿')
  })

  it('學了體位技能之後場景裡換得出來（和 sceneFeature 一起裝）；沒學的換不出來', () => {
    const g = game({ insight: 100, pc: { ext: record({ partners: 5 }) }, ann: { ext: { scene: { skills: [], positions: ['pos_kneel'] } } } })
    const setup = { with: ['npc_ann'], nature: 'mutual' as const }
    expect(knownPositions(g.k, g.state, 'pc').map((p) => p.id)).toEqual(['pos_face', 'pos_behind'])
    learn(g, 'nt_pos')
    expect(knownPositions(g.k, g.state, 'pc').map((p) => p.id)).toEqual(['pos_face', 'pos_behind', 'pos_kneel'])
    g.launch('scene', setup, { by: 'test' })
    expect(sceneView(g.k, g.state)!.positions.map((p) => p.id)).toContain('pos_kneel')
    g.commit(sceneAct(g.k, g.state, { kind: 'switch', position: 'pos_kneel' }))
    expect(sceneRawOf(g.state)!.position).toBe('pos_kneel')
    // 沒學的人切換被擋
    const g2 = game({ pc: { ext: record({ partners: 5 }) }, ann: { ext: { scene: { skills: [], positions: ['pos_kneel'] } } } })
    g2.launch('scene', setup, { by: 'test' })
    expect(blockedBy(() => sceneAct(g2.k, g2.state, { kind: 'switch', position: 'pos_kneel' }))).toMatch(/還不會/)
  })

  it('名冊上的人照同一條：看自己的性經歷與軸，花全隊共用的那一個體悟', () => {
    const g = game({ insight: 30, ann: { ext: record({ partners: 8 }) } })
    expect(nightTier(g.k, g.state, 'npc_ann', 'common')).toBe(3)
    learn(g, 'nt_c2', 'npc_ann')
    expect(learned(g, 'npc_ann')).toEqual(['nt_c2'])
    expect(learned(g)).toEqual([])
    expect(insight(g)).toBe(10)
    // 看的是他自己的軸：主角的條件不替他過
    expect(blockedBy(() => learnDraft(g.k, g.state, 'npc_ann', 'nt_req_bridge'))).toMatch(/耐受要有 40，你現在是 30/)
  })

  it('戰鬥中與成人場景進行中學不了', () => {
    const g = game({ insight: 100, ann: { ext: {} } })
    g.launch('scene', { with: ['npc_ann'], nature: 'mutual' }, { by: 'test' })
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_c1'))).toMatch(/成人場景/)
  })

  it('載入時 branch 與 tier 寫了卻不合格會擋下；沒寫的技能不列出來也不算錯', () => {
    const mk = (e: Record<string, unknown>) => () => game({ pack: { id: 'x', content: { night_skill: [{ id: 'nt_x', name: 'X', ...e }] } } })
    expect(mk({ branch: 'zzz' })).toThrow(ContentError)
    expect(mk({ branch: 'common', tier: 6 })).toThrow(/tier/)
    expect(mk({ branch: 'common', tier: 1, insight: 0 })).toThrow(/insight/)
    expect(mk({ requires: { bridge: { tolerance: 40 } } })).toThrow(/requires\.bridge/)
    expect(mk({ requires: { experience: { favorite: false } } })).toThrow(/favorite/)
    expect(mk({ requires: { conditions: [{ text: 'x' }] } })).toThrow(/conditions/)
    expect(mk({ filters: 'ntr' })).toThrow(/filters/)
    expect(mk({ deep: { on_use: { fit: 'x' } } })).toThrow(/deep\.on_use\.fit/)
    expect(mk({ deep: { link: { whatever: 1 } } })).toThrow(/deep\.link/)
    expect(mk({})).not.toThrow()
    expect(ids(game({ pack: { id: 'x', content: { night_skill: [{ id: 'nt_x', name: 'X' }] } } }))).toEqual([])
    // 自己的 insight 欄位：沒寫是階 × 10，寫了照寫的
    const g = game({ insight: 100, pack: { id: 'x', content: { night_skill: [{ id: 'nt_x', name: 'X', branch: 'common', tier: 1, insight: 3 }] } } })
    learn(g, 'nt_x')
    expect(insight(g)).toBe(97)
  })
})

// ======================================================================
describe('共鳴（scene 讀 night_tier_*）', () => {
  const setup = { with: ['npc_ann'], nature: 'mutual' as const }
  const begin = (g: Game) => g.launch('scene', setup, { by: 'test' })
  const raw = (g: Game): SceneRaw => sceneRawOf(g.state)!
  const act = (g: Game, input: SceneInput) => g.commit(sceneAct(g.k, g.state, input))

  it('共通開到 2 階的人，這一場第一次切換體位不花行動點、第二次照花（1 點）', () => {
    const g = game({ pc: { ext: record({ times: 8 }) } })
    begin(g)
    expect(raw(g).seats[0]!.ap).toBe(4)
    act(g, { kind: 'switch', position: 'pos_behind' })
    expect(raw(g).seats[0]!.ap).toBe(4)
    expect(raw(g).position).toBe('pos_behind')
    act(g, { kind: 'switch', position: 'pos_face' })
    expect(raw(g).seats[0]!.ap).toBe(3)
    expect(scenePreview(g.k, g.state, { kind: 'switch', position: 'pos_behind' })!.ap).toBe(1)
  })

  it('預覽與選單：還有免費的那一次時行動點是 0', () => {
    const g = game({ pc: { ext: record({ times: 8 }) } })
    begin(g)
    expect(scenePreview(g.k, g.state, { kind: 'switch', position: 'pos_behind' })!.ap).toBe(0)
  })

  it('共通只有 1 階的人切換照花；只裝 scene 不裝 nightclass 也是', () => {
    const g = game()
    begin(g)
    act(g, { kind: 'switch', position: 'pos_behind' })
    expect(raw(g).seats[0]!.ap).toBe(3)
    const bare = game({ noNight: true, pc: { ext: record({ times: 99 }) } })
    begin(bare)
    act(bare, { kind: 'switch', position: 'pos_behind' })
    expect(raw(bare).seats[0]!.ap).toBe(3)
  })

  it('另一筆把 climax_init_self 改成 −10：生效在他身上、不在對方身上', () => {
    const g = game({ pc: { ext: { tendency: { axes: { relation: 2 }, points: {}, tags: {} } } } })
    begin(g)
    const p = new Play(g.k, g.state, raw(g), { int: (a) => a })
    expect(p.rulesFor('pc').climax_init_self).toBe(-10)
    expect(p.rulesFor('npc_ann').climax_init_self).toBe(-15)
    const start = p.s.pairs.npc_ann!.init
    p.climax('pc', 'pc')
    expect(p.s.pairs.npc_ann!.init).toBe(start - 10)
    const q = new Play(g.k, g.state, raw(g), { int: (a) => a })
    q.climax('npc_ann', 'pc')
    // 對方高潮：主動權往主角這邊 +15，讓他高潮的主角 +10
    expect(q.s.pairs.npc_ann!.init).toBe(start + 15 + 10)
    // 沒有共鳴的場景是原本的數字
    const plain = game()
    begin(plain)
    const r = new Play(plain.k, plain.state, raw(plain), { int: (a) => a })
    expect(r.rulesFor('pc').climax_init_self).toBe(-15)
    expect(r.rulesFor('pc')).toBe(r.rules)
  })

  it('行動點的花費跟著共鳴的 rules 走，最少 0；每個人只看自己的', () => {
    const pack: ContentPack = { ...PACK, content: { ...PACK.content, night_resonance: [{ id: 'rs_cost', branch: 'common', tier: 1, name: '省力', scene: { rules: { 'cost.tease': -5, 'cost.dominate': 1, 'dominate.fit': 3, glow_bonus: 0.05 } } }] } }
    const g = game({ pack })
    begin(g)
    const p = new Play(g.k, g.state, raw(g), { int: (a) => a })
    expect(p.rulesFor('pc').cost.tease).toBe(0)
    expect(p.rulesFor('pc').cost.dominate).toBe(3)
    expect(p.rulesFor('npc_ann').cost.dominate).toBe(3)
    expect(p.rules.cost.dominate).toBe(2)
    // 餘韻每一層讓自己造成的感載與契合多 15%（原本 10%）：每個人各算各的
    p.glow.pc = 2
    expect(p.boost('pc')).toBeCloseTo(1.3)
    expect(p.rules.glow_bonus).toBe(0.1)
    // 資料裡寫了不是「這個人自己用」的規則數字或不存在的路徑：載入時擋下
    const bad = (rules: Record<string, unknown>) => () => game({ pack: { id: 'b', content: { night_resonance: [{ id: 'rs_b', branch: 'common', tier: 1, name: 'B', scene: { rules } }] } } })
    expect(bad({ load_base: 1 })).toThrow(/不是這個人自己用的規則數字/)
    expect(bad({ climax_init_self: 'x' })).toThrow(/要是數字/)
    expect(bad({ nope: 1 })).toThrow(ContentError)
  })

  it('共鳴的格式：branch、tier、name、scene 的五種鍵', () => {
    const bad = (e: Record<string, unknown>) => () => game({ pack: { id: 'b', content: { night_resonance: [{ id: 'rs_b', branch: 'common', tier: 1, name: 'B', scene: {}, ...e }] } } })
    expect(bad({})).not.toThrow()
    expect(bad({ branch: 'zzz' })).toThrow(/branch/)
    expect(bad({ tier: 0 })).toThrow(/tier/)
    expect(bad({ name: '' })).toThrow(/name/)
    expect(bad({ scene: { free_switch: 0 } })).toThrow(/free_switch/)
    expect(bad({ scene: { reveal: 'body' } })).toThrow(/reveal/)
    expect(bad({ scene: { whatever: 1 } })).toThrow(/只能寫/)
    expect(bad({ scene: 'x' })).toThrow(/scene/)
  })

  it('first_link_fit：這個人這一場建立的第一條有持續效果的連接契合多 +1，第二條不多；說話的連接不算', () => {
    const pack: ContentPack = {
      ...PACK,
      content: {
        ...PACK.content,
        night_skill: [
          ...(PACK.content.night_skill as ContentEntry[]),
          { id: 'nt_l1', name: '連一', branch: 'common', tier: 1, scene: { ...HAND, link: { their_load: '1d6', fit: 1 } } },
          { id: 'nt_l2', name: '連二', branch: 'common', tier: 1, scene: { ap: 1, my_part: ['mouth'], their_part: ['mouth'], link: { their_load: '1d6', fit: 1 } } },
        ],
      },
    }
    const ext = { tendency: { axes: { sense: 1 }, points: {}, tags: {} }, scene: { skills: ['nt_l1', 'nt_l2'] } }
    const h = game({ pack, pc: { ext } })
    begin(h)
    act(h, { kind: 'talk', pick: { my_part: 'hand_l', their_part: 'chest' } })
    expect(raw(h).links.find((l) => l.kind === 'talk')!.link.fit).toBe(0)
    act(h, { kind: 'skill', id: 'nt_l1', pick: { my_part: 'hand_l', their_part: 'chest' } })
    expect(raw(h).links.find((l) => l.source === 'nt_l1')!.link.fit).toBe(2)
    act(h, { kind: 'skill', id: 'nt_l2' })
    expect(raw(h).links.find((l) => l.source === 'nt_l2')!.link.fit).toBe(1)
    // 沒有這個共鳴的人：照 scene 寫的
    const plain = game({ pack, pc: { ext: { scene: { skills: ['nt_l1'] } } } })
    begin(plain)
    act(plain, { kind: 'skill', id: 'nt_l1' })
    expect(raw(plain).links.find((l) => l.source === 'nt_l1')!.link.fit).toBe(1)
  })

  it('end_fit：場景結束時主角和每個對象的契合各 +5；沒有這個共鳴時不加', () => {
    const run = (ext: Record<string, unknown>) => {
      const g = game({ pc: { ext } })
      begin(g)
      const before = raw(g).pairs.npc_ann!.fit
      g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))
      const result = g.state.reports.at(-1)!.outcome.result
      return { before, report: g.state.reports.at(-1)!, result }
    }
    const withIt = run({ tendency: { axes: { sense: 1 }, points: {}, tags: {} } })
    const without = run({})
    const scene = (r: typeof withIt) => r.report.timeline.find((b) => b.tag === 'resonance')
    expect(scene(withIt)?.data).toEqual({ end_fit: 5 })
    expect(scene(without)).toBeUndefined()
    // 結果的契合：開場 20，加 5 之後評價
    const endFit = (r: typeof withIt) => (r.report.timeline.find((b) => b.tag === 'scene.end')!.text.match(/契合 (\d+)/) ?? [])[1]
    expect(endFit(withIt)).toBe('25')
    expect(endFit(without)).toBe('20')
  })

  it('reveal：開場的摘要多給每個對象最高的那一條軸（等級 0 的不給）', () => {
    const g = game({ pc: { ext: { tendency: { axes: { sense: 1 }, points: {}, tags: {} } } }, ann: { ext: { tendency: { axes: { relation: 1, body: 3 }, points: {}, tags: { tg_dom: 'has' } } } } })
    const r = startProblems(g.k, g.state, setup)
    expect(r.summary!.reveal).toEqual([{ id: 'npc_ann', name: '安', axis: { id: 'body', name: '身體', level: 3 } }])
    const none = game({ ann: { ext: {} } })
    expect(startProblems(none.k, none.state, setup).summary!.reveal).toBeUndefined()
    const blank = game({ pc: { ext: { tendency: { axes: { sense: 1 }, points: {}, tags: {} } } }, ann: { ext: {} } })
    expect(startProblems(blank.k, blank.state, setup).summary!.reveal).toEqual([{ id: 'npc_ann', name: '安' }])
  })

  it('單人的場景裡跟對象有關的四種鍵不生效，rules 照常', () => {
    const g = game({ pc: { ext: { ...record({ times: 8 }), tendency: { axes: { sense: 1, relation: 2 }, points: {}, tags: {} } } } })
    g.launch('scene', { solo: true }, { by: 'test' })
    const p = new Play(g.k, g.state, raw(g), { int: (a) => a })
    expect(p.res.pc!.free_switch).toBe(0)
    expect(p.res.pc!.first_link_fit).toBe(0)
    expect(p.res.pc!.end_fit).toBe(0)
    expect(p.res.pc!.reveal).toEqual([])
    expect(p.res.pc!.rules).toEqual({ climax_init_self: 5 })
    expect(p.freeSwitch('pc')).toBe(false)
    // 單人換姿勢照花 1 點
    g.commit(sceneAct(g.k, g.state, { kind: 'switch', position: p.poses[1]!.id }))
    expect(raw(g).seats[0]!.ap).toBe(3)
    expect(startProblems(game().k, game().state, { solo: true }).summary!.reveal).toBeUndefined()
  })
})

// ======================================================================
describe('「深」', () => {
  const setup = { with: ['npc_ann'], nature: 'mutual' as const }
  const tag = (st: string): ActorOverrides => ({ ext: { tendency: { axes: { relation: 3 }, points: {}, tags: { tg_dom: st } }, scene: { skills: ['nt_dom3'], positions: [] } } })
  const preview = (st: string) => {
    const g = game({ pc: tag(st) })
    g.launch('scene', setup, { by: 'test' })
    return scenePreview(g.k, g.state, { kind: 'skill', id: 'nt_dom3' })!
  }

  it('同一招：標籤是「有」時契合 +4，是「深」時照 deep 寫的 +7（預覽與實際用出去都是）', () => {
    expect(preview('has').fit).toBe(4)
    expect(preview('deep').fit).toBe(7)
    expect(preview('has').per_round!.fit).toBe(1)
    expect(preview('deep').per_round!.fit).toBe(3)
    const fitAfter = (st: string): number => {
      const g = game({ pc: tag(st) })
      g.launch('scene', setup, { by: 'test' })
      const before = sceneRawOf(g.state)!.pairs.npc_ann!.fit
      g.commit(sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_dom3' }, { dice: { int: (a) => a } }))
      return sceneRawOf(g.state)!.pairs.npc_ann!.fit - before
    }
    expect(fitAfter('has')).toBe(4)
    expect(fitAfter('deep')).toBe(7)
    // deep 沒寫的數字照 scene 的：感載的骰不變
    expect(preview('deep').target_load!.dice).toBe(preview('has').target_load!.dice)
  })

  it('連接持續的契合也照 deep：建立的連接記的是蓋過的數字', () => {
    const run = (st: string) => {
      const g = game({ pc: tag(st) })
      g.launch('scene', setup, { by: 'test' })
      g.commit(sceneAct(g.k, g.state, { kind: 'skill', id: 'nt_dom3' }, { dice: { int: (a) => a } }))
      return sceneRawOf(g.state)!.links.find((l) => l.source === 'nt_dom3')!.link.fit
    }
    expect(run('has')).toBe(1)
    expect(run('deep')).toBe(3)
  })

  it('沒有 deep 的技能、不掛標籤的技能不受影響', () => {
    const g = game({ pc: { ext: { tendency: { axes: {}, points: {}, tags: { tg_dom: 'deep' } }, scene: { skills: ['nt_c1'] } } } })
    g.launch('scene', setup, { by: 'test' })
    expect(scenePreview(g.k, g.state, { kind: 'skill', id: 'nt_c1' })!.fit).toBe(2)
  })
})

// ======================================================================
describe('NPC 會哪些夜課（P32）', () => {
  const setup = { with: ['npc_ann'], nature: 'mutual' as const }
  const annExt = (extra: Record<string, unknown> = {}): ActorOverrides => ({
    ext: { ...record({ times: 8 }), tendency: { axes: { relation: 3 }, points: {}, tags: { tg_dom: 'has' } }, ...extra },
  })
  const knownOf = (g: Game, who = 'npc_ann') => sceneView(g.k, g.state)!.seats.find((x) => x.id === who)!.known!

  it('沒寫 skills 的對象：場景開始當下推，sceneView 看得到他會哪些；每個分支開到的每一階各一個、掛的標籤他要有', () => {
    const g = game({ ann: annExt() })
    g.launch('scene', setup, { by: 'test' })
    const known = knownOf(g)
    // 共通 1、2 階各一個、關係 3 階一個（關係 1、2 階沒有技能）
    expect(known.skills).toHaveLength(3)
    const by = (id: string) => (PACK.content.night_skill as Array<{ id: string; branch: string; tier: number }>).find((s) => s.id === id)!
    const picked = known.skills.map(by)
    expect(picked.filter((s) => s.branch === 'common' && s.tier === 1)).toHaveLength(1)
    expect(picked.filter((s) => s.branch === 'common' && s.tier === 2)).toHaveLength(1)
    expect(picked.filter((s) => s.branch === 'relation' && s.tier === 3).map((s) => s.id)).toEqual(['nt_dom3'])
    // 沒有 tg_dom 標籤的人推不出關係 3 階那一招
    const noTag = game({ ann: { ext: { ...record({ times: 8 }), tendency: { axes: { relation: 3 }, points: {}, tags: {} } } } })
    noTag.launch('scene', setup, { by: 'test' })
    expect(knownOf(noTag).skills).not.toContain('nt_dom3')
    // 主角自己不推：沒學就是沒有
    expect(knownOf(g, 'pc').skills).toEqual([])
  })

  it('體位是基本的加上這些技能開放的', () => {
    // 共通 2 階的人只有一個候選時抽中體位技能：把其他的 2 階技能拿掉
    const pack: ContentPack = { ...PACK, content: { ...PACK.content, night_skill: (PACK.content.night_skill as ContentEntry[]).filter((s) => s.id !== 'nt_c2') } }
    const g = game({ pack, ann: annExt() })
    g.launch('scene', setup, { by: 'test' })
    expect(knownOf(g).positions).toEqual(['pos_face', 'pos_behind', 'pos_kneel'])
    // 體位技能沒有自己的 scene，不算他會用的技能；體位照樣開放
    expect(knownSkills(g.k, g.state, 'npc_ann')).not.toContain('nt_pos')
    expect(knownPositions(g.k, g.state, 'npc_ann').map((p) => p.id)).toEqual(['pos_face', 'pos_behind', 'pos_kneel'])
    // 沒有抽到體位技能的人只有基本的（共通 1 階沒有體位技能）
    const low = game({ ann: { ext: record({ times: 0 }) } })
    expect(knownPositions(low.k, low.state, 'npc_ann').map((p) => p.id)).toEqual(['pos_face', 'pos_behind'])
  })

  it('同一個人開兩場推出來的一樣；換一個人（id 不同）可以不一樣', () => {
    const g = game({ ann: annExt() })
    g.launch('scene', setup, { by: 'test' })
    const first = knownOf(g)
    g.commit(sceneAct(g.k, g.state, { kind: 'stop' }))
    g.launch('scene', setup, { by: 'test' })
    expect(knownOf(g)).toEqual(first)
    // 另一個局、另一顆種子：只看他的 id
    const other = makeGame({ seed: 777, features: [characterFeature, lewdFeature, sceneFeature, nightclassFeature], content: [PACK], pc: { ext: { bridge: BRIDGE } }, actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc', ...annExt() })] }).game
    other.launch('scene', setup, { by: 'test' })
    expect(knownOf(other)).toEqual(first)
  })

  it('對象會用推出來的技能（輪到他的時候用得出來）', () => {
    const g = game({ ann: annExt() })
    g.launch('scene', setup, { by: 'test' })
    const known = knownOf(g).skills
    g.commit(sceneAct(g.k, g.state, { kind: 'end_turn' }))
    for (let i = 0; i < 10 && sceneRawOf(g.state) && sceneRawOf(g.state)!.turn !== 'pc'; i++) g.commit(sceneNext(g.k, g.state))
    const used = g.state.reports.flatMap((r) => r.timeline).filter((b) => b.actor === 'npc_ann' && (b.tag === 'skill' || b.tag === 'talk')).map((b) => (b.data as { id?: string } | undefined)?.id)
    expect(used.some((id) => id !== undefined && known.includes(id))).toBe(true)
  })

  it('寫死的照寫的：寫了 skills 的對象不推（寫空陣列就是什麼都不會）', () => {
    const g = game({ ann: annExt({ scene: { skills: ['nt_c1'], positions: [] } }) })
    g.launch('scene', setup, { by: 'test' })
    expect(knownOf(g).skills).toEqual(['nt_c1'])
    const empty = game({ ann: annExt({ scene: { skills: [], positions: [] } }) })
    empty.launch('scene', setup, { by: 'test' })
    expect(knownOf(empty).skills).toEqual([])
    expect(knownOf(empty).positions).toEqual(['pos_face', 'pos_behind'])
  })

  it('內容篩選關掉的技能推不出來；只裝 scene 不裝 nightclass 時對象什麼都不推', () => {
    const g = game({ ann: annExt(), contentOff: ['tg_dom'] })
    g.launch('scene', setup, { by: 'test' })
    expect(knownOf(g).skills).not.toContain('nt_dom3')
    const bare = game({ noNight: true, ann: annExt() })
    bare.launch('scene', setup, { by: 'test' })
    expect(knownOf(bare).skills).toEqual([])
  })
})

// ======================================================================
describe('效果 night_skill', () => {
  const fx = (g: Game, source: 'builtin' | 'ai') => {
    const list = [{ kind: 'night_skill', id: 'nt_pos' }]
    const ctx = effectCtx(g.k, g.state, { source, actor: 'pc' })
    return { errors: g.k.effects.validate(list, ctx), ctx, list }
  }

  it('直接學會而且不扣體悟、不看條件（耐受不夠、階沒開都照樣會）；開放的體位一起加', () => {
    const g = game({ insight: 7 })
    const { errors, ctx, list } = fx(g, 'builtin')
    expect(errors).toEqual([])
    const res = g.k.effects.resolve(list, ctx)
    expect(res.errors).toEqual([])
    expect(res.lines[0]).toContain('學會了夜課「跪姿」')
    g.commit(draft(res.changes))
    expect(learned(g)).toEqual(['nt_pos'])
    expect(positions(g)).toEqual(['pos_kneel'])
    expect(insight(g)).toBe(7)
    // 學過的再教一次：沒有變更、不重複
    const again = g.k.effects.resolve(list, effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' }))
    expect(again.changes).toEqual([])
    g.commit(draft(again.changes))
    expect(learned(g)).toEqual(['nt_pos'])
  })

  it('同一批教兩次也不重複', () => {
    const g = game()
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    const res = g.k.effects.resolve([{ kind: 'night_skill', id: 'nt_c1' }, { kind: 'night_skill', id: 'nt_c1' }], ctx)
    g.commit(draft(res.changes))
    expect(learned(g)).toEqual(['nt_c1'])
  })

  it('AI 給的被擋；查不到的技能格式不合', () => {
    const g = game()
    expect(fx(g, 'ai').errors.length).toBeGreaterThan(0)
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    expect(g.k.effects.validate([{ kind: 'night_skill', id: 'nt_nope' }], ctx)[0]).toMatch(/查不到/)
    expect(g.k.effects.validate([{ kind: 'night_skill' }], ctx)[0]).toMatch(/id/)
  })

  it('落在別人身上（ctx.actor）：名冊上的人也一樣', () => {
    const g = game()
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'npc_ann' })
    const res = g.k.effects.resolve([{ kind: 'night_skill', id: 'nt_c1' }], ctx)
    g.commit(draft(res.changes))
    expect(learned(g, 'npc_ann')).toEqual(['nt_c1'])
    expect(learned(g)).toEqual([])
  })
})

// ======================================================================
describe('條件 night_skill 與 night_tier', () => {
  it('night_skill：學會了才成立；看 ctx.actor，沒給是主角', () => {
    const g = game({ insight: 10 })
    const test = (c: Record<string, unknown>, actor?: string) => g.k.conditions.test(c as never, { state: g.state, ...(actor ? { actor } : {}), stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test({ kind: 'night_skill', id: 'nt_c1' })).toBe(false)
    learn(g, 'nt_c1')
    expect(test({ kind: 'night_skill', id: 'nt_c1' })).toBe(true)
    expect(test({ kind: 'night_skill', id: 'nt_c1' }, 'npc_ann')).toBe(false)
  })

  it('night_tier：分支開到幾階；格式不對載入時擋下', () => {
    const g = game({ pc: { ext: { ...record({ times: 20 }), tendency: { axes: { body: 2 }, points: {}, tags: {} } } } })
    const test = (c: Record<string, unknown>) => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test({ kind: 'night_tier', branch: 'common', min: 3 })).toBe(true)
    expect(test({ kind: 'night_tier', branch: 'common', min: 4 })).toBe(false)
    expect(test({ kind: 'night_tier', branch: 'body', min: 2 })).toBe(true)
    expect(test({ kind: 'night_tier', branch: 'costume', min: 1 })).toBe(false)
    expect(g.k.conditions.validate({ kind: 'night_tier', branch: 'zzz', min: 1 })[0]).toMatch(/branch/)
    expect(g.k.conditions.validate({ kind: 'night_tier', branch: 'body', min: 9 })[0]).toMatch(/min/)
    expect(g.k.conditions.validate({ kind: 'night_skill' })[0]).toMatch(/id/)
  })
})

// ======================================================================
describe('只裝 scene 不裝 nightclass', () => {
  it('夜課的資料照樣載入、場景照常開；night_tier_* 不存在、共鳴不生效', () => {
    const g = game({ noNight: true, pc: { ext: record({ times: 99 }) } })
    expect(g.k.stats.hasStat('night_tier_common')).toBe(false)
    g.launch('scene', { with: ['npc_ann'], nature: 'mutual' }, { by: 'test' })
    const p = new Play(g.k, g.state, sceneRawOf(g.state)!, { int: (a) => a })
    expect(p.res.pc!.ids).toEqual([])
    expect(p.rulesFor('pc')).toBe(p.rules)
  })

  it('scene 的格式檢查收 nightclass 的欄位（沒有 nightclass 也擋下壞的 requires）', () => {
    const mk = (e: Record<string, unknown>) => () => game({ noNight: true, pack: { id: 'x', content: { night_skill: [{ id: 'nt_x', name: 'X', ...e }] } } })
    expect(mk({ requires: { bridge: { tolerance: 40 } } })).toThrow(/requires\.bridge/)
    expect(mk({ branch: 'zzz', tier: 99 })).not.toThrow()
  })
})

// ======================================================================
describe('夜課列表給畫面的三樣：開階的依據（basis）、掛在沒有的標籤上而不列的數量（hidden）、標籤是「深」（deep）（M4-fix-2；UI 8.4 節）', () => {
  const tend = (axes: Record<string, number>, tags: Record<string, string> = {}): ActorOverrides => ({ ext: { tendency: { axes, points: {}, tags } } })
  const branch = (g: Game, id: string) => nightList(g.k, g.state, 'pc').branches.find((b) => b.branch === id)!

  it('共通：依據是性經歷（次數與對象的人數）；每一階寫門檻（第 1 階不限）、開了的標 open', () => {
    const g = game({ pc: { ext: { ...record({ times: 12, partners: 4 }) } } })
    const b = branch(g, 'common')
    expect(b.tier).toBe(2)
    expect(b.basis).toMatchObject({ kind: 'experience', times: 12, partners: 4, text: '性經歷：12 次、和 4 個人有過' })
    expect(b.basis.tiers).toEqual([
      { tier: 1, need: '不限', open: true }, { tier: 2, need: '次數 8，或對象 5 人', open: true }, { tier: 3, need: '次數 20，或對象 8 人', open: false },
      { tier: 4, need: '次數 40，或對象 12 人', open: false }, { tier: 5, need: '次數 80，或對象 20 人', open: false },
    ])
  })

  it('其餘四支：依據是那一條軸的等級；每一階寫「<軸>軸 N 級」；開階的數字和 tier 一致（軸 3 級開到 3 階）', () => {
    const g = game({ pc: tend({ relation: 3, sense: 1, body: 0, costume: 9 }) })
    const rel = branch(g, 'relation')
    expect(rel.basis).toMatchObject({ kind: 'axis', axis: 'relation', axis_name: '關係', level: 3, text: '關係軸 3 級' })
    expect(rel.basis.tiers.map((t) => [t.tier, t.need, t.open])).toEqual([[1, '關係軸 1 級', true], [2, '關係軸 2 級', true], [3, '關係軸 3 級', true], [4, '關係軸 4 級', false], [5, '關係軸 5 級', false]])
    for (const b of nightList(g.k, g.state, 'pc').branches) expect(b.basis.tiers.filter((t) => t.open)).toHaveLength(b.tier)
    // 軸的等級超過 5 時開階最多到 5（和 tier 一樣）；0 級一階都沒開
    expect(branch(g, 'costume').basis).toMatchObject({ level: 9, text: '扮相軸 9 級' })
    expect(branch(g, 'costume').tier).toBe(5)
    expect(branch(g, 'body').basis.tiers.every((t) => !t.open)).toBe(true)
  })

  it('沒有這個角色：每一支都是空的依據（不丟錯）', () => {
    const g = game()
    const v = nightList(g.k, g.state, 'nobody')
    expect(v.branches.every((b) => b.hidden === 0 && b.skills.length === 0 && b.basis.tiers.every((t) => !t.open))).toBe(true)
  })

  it('hidden：掛在這個人沒有的標籤上而不列的技能數；被內容篩選關掉的整個不出現，也不算進這個數字；有了標籤就不再算', () => {
    const none = game({ pc: tend({ relation: 3 }) })
    expect(ids(none)).not.toContain('nt_dom3')
    expect(branch(none, 'relation').hidden).toBe(1)
    expect(branch(none, 'common').hidden).toBe(0)
    // 潛在不算有
    expect(branch(game({ pc: tend({ relation: 3 }, { tg_dom: 'latent' }) }), 'relation').hidden).toBe(1)
    const has = game({ pc: tend({ relation: 3 }, { tg_dom: 'has' }) })
    expect(ids(has)).toContain('nt_dom3')
    expect(branch(has, 'relation').hidden).toBe(0)
    // 篩選關掉：整個不出現，也不算進「N 個掛在你沒有的標籤上」
    const off = game({ pc: tend({ relation: 3 }), contentOff: ['tg_dom'] })
    expect(ids(off)).not.toContain('nt_dom3')
    expect(branch(off, 'relation').hidden).toBe(0)
    // 「只掛軸」的技能（nt_ntr 掛 relation 這條軸、跟 ntr 的篩選）不算標籤的限制：關掉 ntr 時整個不出現，開著時列出
    expect(branch(game({ pc: tend({ sense: 1 }) }), 'sense').hidden).toBe(0)
  })

  it('deep：掛在標籤上而那個標籤是「深」的技能才是 true；有、潛在、共通與只掛軸的都是 false；內容有沒有寫 deep 數字不影響這一欄', () => {
    const deepOf = (g: Game, id: string) => nightList(g.k, g.state, 'pc').branches.flatMap((b) => b.skills).find((s) => s.id === id)!.deep
    expect(deepOf(game({ pc: tend({ relation: 3 }, { tg_dom: 'deep' }) }), 'nt_dom3')).toBe(true)
    expect(deepOf(game({ pc: tend({ relation: 3 }, { tg_dom: 'has' }) }), 'nt_dom3')).toBe(false)
    const g = game({ pc: tend({ relation: 3, sense: 1 }, { tg_dom: 'deep' }) })
    expect(deepOf(g, 'nt_c1')).toBe(false)
    expect(deepOf(g, 'nt_ntr')).toBe(false)
  })
})

