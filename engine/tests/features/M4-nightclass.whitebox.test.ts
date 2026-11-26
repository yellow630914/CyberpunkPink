// 白箱：features/nightclass 的學習條件（learn.ts 的 requireBlocks、learnBlock、learnDraft）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：LEWD_SYSTEM 第 10 節（夜課）、第 1 節（沒有橋的人沒有四項橋參數）；NIGHT_LESSONS「寫法的約定」（學習條件：橋參數、性經歷、條件）；DATA 3.1、3.2 節；dev/adr/0019 第十節。
// 內容和 tests/features/M4-nightclass.test.ts 同一套最小假資料，多三個技能：性經歷三種條件一起的、條件沒寫原因的、只看馴化上限的。
// 會失敗的那一條（B033：沒有橋的人的橋參數讀成 0）在 tests/pending/B033-night-bridge-req-without-bridge.test.ts。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, GameState, ReportDraft } from '../../src'
import { ActionBlocked } from '../../src'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import { learnBlock, learnDraft, learnProblems, nightclassFeature } from '../../src/features/nightclass'
import { sceneFeature } from '../../src/features/scene'
import type { ActorOverrides } from '../../src/testkit'
import { makeActor, makeGame } from '../../src/testkit'

// ---- 假內容 ----

const roles = [{ id: 'a', upper: true }, { id: 'b', upper: false }]
const links = [
  { from: ['a', 'hand_l'], to: ['b', 'chest'] }, { from: ['b', 'hand_l'], to: ['a', 'chest'] }, { from: ['a', 'mouth'], to: ['b', 'mouth'] }, { from: ['b', 'mouth'], to: ['a', 'mouth'] },
]
const HAND = { ap: 1, my_part: ['hand_l'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 } }

const PACK: ContentPack = {
  id: 'night_wb',
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
      { id: 'nt_req_x', name: '老練', branch: 'common', tier: 1, tag: '共通', requires: { experience: { times: 3, service_times: 2, favorite: true } }, scene: HAND },
      { id: 'nt_req_cond2', name: '沒寫原因', branch: 'common', tier: 1, tag: '共通', requires: { conditions: [{ kind: 'has_item', id: 'it_key' }] }, scene: HAND },
      { id: 'nt_req_docile', name: '別太聽話', branch: 'common', tier: 1, tag: '共通', requires: { bridge: { docility_max: 60 } }, scene: HAND },
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
const draft = (changes: ReportDraft['changes'], action = 'test.fx'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

// ======================================================================
describe('性經歷的條件（NIGHT_LESSONS「寫法的約定」requires.experience：次數、服務次數、最喜歡的人）', () => {
  it('三種都沒到：一條一句、照順序；三種都到了就沒有原因', () => {
    const g = game({ insight: 50 })
    expect(learnProblems(g.k, g.state, 'pc', 'nt_req_x')).toEqual(['性經歷要 3 次，你現在是 0 次。', '做過的服務要有 2 次，你現在是 0 次。', '要有一個最喜歡的人。'])
    const ok = game({ insight: 50, pc: { ext: { ...record({ times: 3, service_times: 2, favorite: 'npc_ann' }) } } })
    expect(learnProblems(ok.k, ok.state, 'pc', 'nt_req_x')).toEqual([])
    learn(ok, 'nt_req_x')
    expect(learned(ok)).toContain('nt_req_x')
  })

  it('差一點（2 次、1 次服務、最喜歡的人是空字串）：三條照樣列', () => {
    const g = game({ insight: 50, pc: { ext: { ...record({ times: 2, service_times: 1, favorite: '' }) } } })
    expect(learnProblems(g.k, g.state, 'pc', 'nt_req_x')).toEqual(['性經歷要 3 次，你現在是 2 次。', '做過的服務要有 2 次，你現在是 1 次。', '要有一個最喜歡的人。'])
  })
})

describe('條件的原因（requires.conditions）', () => {
  it('條件沒寫 text：原因是「還沒有滿足需要的條件（種類）。」；帶著東西之後過', () => {
    const g = game({ insight: 50 })
    expect(learnProblems(g.k, g.state, 'pc', 'nt_req_cond2')).toEqual(['還沒有滿足需要的條件（has_item）。'])
    g.commit(draft([{ op: 'item', id: 'it_key', qty: 1 }]))
    expect(learnProblems(g.k, g.state, 'pc', 'nt_req_cond2')).toEqual([])
  })
})

describe('學不了的時候（learnBlock）', () => {
  it('不存在的技能、已經學會：各一句；learnDraft 丟的是第一條', () => {
    const g = game({ insight: 50 })
    expect(learnBlock(g.k, g.state, 'pc', 'nt_nope')).toBe('沒有這個夜課技能。')
    learn(g, 'nt_c1')
    expect(learnBlock(g.k, g.state, 'pc', 'nt_c1')).toBe('已經學會了。')
    expect(blockedBy(() => learnDraft(g.k, g.state, 'pc', 'nt_c1'))).toBe('已經學會了。')
  })

  it('戰鬥中學不了：「戰鬥中學不了夜課。」（不問別的條件）', () => {
    const g = game({ insight: 50 })
    const fake = { ...g.state, battle: {} } as unknown as GameState
    expect(learnBlock(g.k, fake, 'pc', 'nt_nope')).toBe('戰鬥中學不了夜課。')
  })

  it('學會體位技能：報告多一行「多會了「跪姿」」，positions 加上 pos_kneel', () => {
    const g = game({ insight: 50, pc: { ext: { ...record({ times: 8 }) } } })
    const [r] = learn(g, 'nt_pos')
    expect(r!.timeline.map((b) => b.text).join('')).toMatch(/多會了「跪姿」/)
    expect(positions(g)).toContain('pos_kneel')
  })
})
