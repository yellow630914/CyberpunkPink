// 驗收測試：dev/work/M2-lewd.md（cpp-feature）。規格：LEWD_SYSTEM 第 1、1.1、5、9 節；CORE_RULES 4.2 節；DATA 第 8 節；dev/adr/0016 第三節、G10、G14。
// 內容一律用測試自帶的最小假資料：幾個傾向標籤（溺愛、窺視、戀物、扮相）與兩個區。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, Kernel, ReportDraft } from '../../src'
import { ContentError, attrMod, checkParts, contentAllowed, effectCtx, toMinutes } from '../../src'
import { characterFeature } from '../../src/features/character'
import { bridgeOf, hasTag, lewdFeature, tagStateOf, tendencyOf } from '../../src/features/lewd'
import { enemyUnit, makeGame, observed, TEST_COMBAT } from '../../src/testkit'

const PACK: ContentPack = {
  id: 'lewd_test',
  content: {
    tendency_tag: [
      { id: 'tg_smother', name: '溺愛', axis: 'relation' },
      { id: 'tg_dom', name: '支配', axis: 'relation' },
      { id: 'tg_voyeur', name: '窺視', axis: 'sense' },
      { id: 'tg_fetish', name: '戀物', axis: 'body' },
      { id: 'tg_goth', name: '哥德風', axis: 'costume' },
    ],
    district: [{ id: 'test', name: '測試區' }, { id: 'd2', name: '第二區' }],
  },
}

/** 區是別的功能的內容種類：測試自己定義（量表的鍵要查得到區）。 */
const DISTRICTS: Feature = { id: 'test_districts', install: (k: Kernel) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }

type G = ReturnType<typeof makeGame>['game']
const game = (o: { bridge?: Record<string, number> | null; features?: Feature[]; content?: ContentPack[]; resolve?: number; tolerance?: number } = {}): G =>
  makeGame({
    features: [DISTRICTS, lewdFeature, ...(o.features ?? [])], content: o.content ?? [PACK],
    pc: { attrs: o.resolve !== undefined ? { resolve: o.resolve } : {}, ext: o.bridge === undefined ? { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } : { bridge: o.bridge } },
  }).game

const draft = (changes: Change[], action = 'test.give'): ReportDraft => ({
  kind: 'event', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
type Source = 'builtin' | 'ai' | 'player'

/** 用效果給東西：走和事件一樣的路——效果登錄表解析、提交。 */
function give(g: G, effects: Array<Record<string, unknown>>, source: Source = 'builtin', extra: { actor?: string; clampAsked?: boolean; playerInput?: string } = {}) {
  const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source, ...extra }))
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes))
  return r
}
const bridge = (g: G, actor = 'pc') => g.state.actors[actor]!.ext.bridge as Record<string, number> | null
const test = (g: G, cond: Record<string, unknown>, actor?: string) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules, ...(actor ? { actor } : {}) })
const tend = (g: G, actor = 'pc') => tendencyOf(g.state, actor)
const setBridge = (g: G, value: Record<string, number> | null) => {
  g.state.actors.pc!.ext.bridge = value
}

describe('橋參數：bridge 效果', () => {
  it('內建的照寫：敏感度 +10、耐受 −5；效果的結果一行一筆；報告的變更是 actor.ext', () => {
    const g = game()
    const r = give(g, [{ kind: 'bridge', param: 'sensitivity', amount: 10 }, { kind: 'bridge', param: 'tolerance', amount: -5 }])
    expect(bridge(g)).toEqual({ sensitivity: 40, tolerance: 25, craving: 30, docility: 30 })
    expect(r.lines).toEqual(['橋參數：敏感度 +10', '橋參數：耐受 −5'])
    expect(r.clamps).toEqual([])
  })

  it('內建的一件事給兩項各 +3：都收（AI 才有一項 +1 的限制）', () => {
    const g = game()
    give(g, [{ kind: 'bridge', param: 'craving', amount: 3 }, { kind: 'bridge', param: 'docility', amount: 3 }])
    expect(bridge(g)).toMatchObject({ craving: 33, docility: 33 })
  })

  it('AI 一件事給兩項各 +3：只留第一項 +1，並有提醒；另一項沒有動', () => {
    const g = game()
    const r = give(g, [{ kind: 'bridge', param: 'craving', amount: 3 }, { kind: 'bridge', param: 'docility', amount: 3 }], 'ai')
    expect(bridge(g)).toMatchObject({ craving: 31, docility: 30 })
    expect(r.effects).toEqual([{ kind: 'bridge', param: 'craving', amount: 1 }])
    expect(r.clamps).toHaveLength(2)
    expect(r.clamps.map((c) => c.notice).join('')).toMatch(/一件事最多只收一項橋參數/)
    expect(r.clamps.some((c) => c.path === 'effects[1]')).toBe(true)
  })

  it('AI 給同一項 +1 再 +1：合計只收 +1；AI 要往下扣最多 −1', () => {
    const g = game()
    give(g, [{ kind: 'bridge', param: 'craving', amount: 1 }, { kind: 'bridge', param: 'craving', amount: 1 }], 'ai')
    expect(bridge(g)!.craving).toBe(31)
    const r = give(g, [{ kind: 'bridge', param: 'tolerance', amount: -4 }], 'ai')
    expect(bridge(g)!.tolerance).toBe(29)
    expect(r.clamps).toHaveLength(1)
  })

  it('AI 剛好 +1 沒有提醒', () => {
    const g = game()
    const r = give(g, [{ kind: 'bridge', param: 'sensitivity', amount: 1 }], 'ai')
    expect(bridge(g)!.sensitivity).toBe(31)
    expect(r.clamps).toEqual([])
  })

  it('加到超過 100 夾住：實際只動到 100，結果寫的是實際的量；已經 100 的整筆拿掉；減到 0 同理', () => {
    const g = game({ bridge: { sensitivity: 98, tolerance: 100, craving: 3, docility: 30 } })
    const r = give(g, [{ kind: 'bridge', param: 'sensitivity', amount: 5 }, { kind: 'bridge', param: 'tolerance', amount: 7 }, { kind: 'bridge', param: 'craving', amount: -10 }])
    expect(bridge(g)).toEqual({ sensitivity: 100, tolerance: 100, craving: 0, docility: 30 })
    expect(r.effects).toEqual([{ kind: 'bridge', param: 'sensitivity', amount: 2 }, { kind: 'bridge', param: 'craving', amount: -3 }])
    expect(r.lines).toEqual(['橋參數：敏感度 +2', '橋參數：慾求 −3'])
  })

  it('同一批前面幾筆的結果算進後面（98 +1 +5：第二筆只剩 +1）', () => {
    const g = game({ bridge: { sensitivity: 98, tolerance: 30, craving: 30, docility: 30 } })
    const r = give(g, [{ kind: 'bridge', param: 'sensitivity', amount: 1 }, { kind: 'bridge', param: 'sensitivity', amount: 5 }])
    expect(bridge(g)!.sensitivity).toBe(100)
    expect(r.effects.map((e) => e.amount)).toEqual([1, 1])
  })

  it('格式：param 不是四項之一、amount 不是整數都不合格', () => {
    const g = game()
    const ctx = effectCtx(g.k, g.state, { source: 'builtin' })
    expect(g.k.effects.validate([{ kind: 'bridge', param: 'lust', amount: 1 }], ctx)[0]).toMatch(/param/)
    expect(g.k.effects.validate([{ kind: 'bridge', param: 'craving', amount: 1.5 }], ctx)[0]).toMatch(/amount/)
    expect(g.k.effects.validate([{ kind: 'bridge', param: 'craving', amount: 2 }], ctx)).toEqual([])
  })

  it('沒有橋的人（bridge: null）：效果落空並提醒、什麼都沒有改；has_bridge 不成立、bridge 條件不成立', () => {
    const g = game({ bridge: null })
    expect(bridge(g)).toBeNull()
    const r = give(g, [{ kind: 'bridge', param: 'craving', amount: 5 }])
    expect(r.effects).toEqual([])
    expect(r.changes).toEqual([])
    expect(r.clamps).toHaveLength(1)
    expect(r.clamps[0]!.notice).toMatch(/沒有橋/)
    expect(bridge(g)).toBeNull()
    expect(test(g, { kind: 'has_bridge' })).toBe(false)
    expect(test(g, { kind: 'bridge', param: 'craving', min: 0 })).toBe(false)
    expect(bridgeOf(g.k, g.state, 'pc')).toBeNull()
  })
})

describe('bridgeOf：有效值、效力與所在的那一段', () => {
  const SOURCES: Feature = {
    id: 'test_sources',
    install(k: Kernel) {
      // 義體、藥物之後經衍生數值的 provider 加（這裡用狀態 flag 當開關）
      k.stats.addStatProvider('bridge_tolerance', 'test', (state) => (state.flags.boost ? [{ label: '義體', value: Number(state.flags.boost), source: 'gear' }] : []))
    },
  }
  const withBoost = (g: G, n: number) => {
    g.state.flags.boost = n
  }

  it('每 20 點一段：19 在第 0 段、20 在第 1 段、79 在第 3 段、80 與 100 在最後一段（第 4 段）', () => {
    const g = game()
    const bands = [0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map((v) => {
      setBridge(g, { sensitivity: v, tolerance: v, craving: v, docility: v })
      return bridgeOf(g.k, g.state, 'pc')!.craving.band
    })
    expect(bands).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
    setBridge(g, { sensitivity: 45, tolerance: 0, craving: 100, docility: 20 })
    const v = bridgeOf(g.k, g.state, 'pc')!
    expect(v.sensitivity).toMatchObject({ base: 45, value: 45, power: 45, band: 2, range: [40, 59] })
    expect(v.docility.band).toBe(1)
  })

  it('沒有來源時有效值就是基本值；有來源的人有效值是基本值加來源，超過 100 的部分效力遞減', () => {
    const g = game({ features: [SOURCES], bridge: { sensitivity: 30, tolerance: 90, craving: 30, docility: 30 } })
    expect(bridgeOf(g.k, g.state, 'pc')!.tolerance).toMatchObject({ base: 90, value: 90, power: 90 })
    withBoost(g, 30)
    const t = bridgeOf(g.k, g.state, 'pc')!.tolerance
    expect(t).toMatchObject({ base: 90, value: 120, band: 4 })
    expect(t.power).toBe(Math.round(100 + 80 * (1 - 100 / 120)))
    expect(t.power).toBeLessThan(120)
    expect(t.power).toBeGreaterThan(100)
  })

  it('來源合計最多 ±100：再怎麼堆有效值也不超過 200，效力不超過 180；來源可以把有效值壓到 0', () => {
    const g = game({ features: [SOURCES], bridge: { sensitivity: 30, tolerance: 100, craving: 30, docility: 30 } })
    withBoost(g, 500)
    const t = bridgeOf(g.k, g.state, 'pc')!.tolerance
    expect(t.value).toBe(200)
    expect(t.power).toBe(140)
    withBoost(g, -500)
    expect(bridgeOf(g.k, g.state, 'pc')!.tolerance).toMatchObject({ value: 0, power: 0, band: 0 })
  })

  it('沒有橋、沒有這個角色都是 null；bridge 條件看有效值、min 與 max 各一邊', () => {
    const g = game({ features: [SOURCES], bridge: { sensitivity: 30, tolerance: 50, craving: 30, docility: 30 } })
    expect(bridgeOf(g.k, g.state, 'nobody')).toBeNull()
    withBoost(g, 20)
    expect(test(g, { kind: 'bridge', param: 'tolerance', min: 70 })).toBe(true)
    expect(test(g, { kind: 'bridge', param: 'tolerance', min: 71 })).toBe(false)
    expect(test(g, { kind: 'bridge', param: 'tolerance', max: 69 })).toBe(false)
  })
})

describe('耐受：承受層數與感載上限', () => {
  const layers = (g: G) => g.k.stats.stat(g.state, 'pc', 'afterglow_cap')

  it('耐受 40、80 的人承受層數各是 4、5；39 與 0 是 3；100 是 5（每 40 點 +1）', () => {
    const g = game({ features: [characterFeature] })
    const out: number[] = []
    for (const t of [0, 39, 40, 79, 80, 100]) {
      setBridge(g, { sensitivity: 30, tolerance: t, craving: 30, docility: 30 })
      out.push(layers(g))
    }
    expect(out).toEqual([3, 3, 4, 4, 5, 5])
  })

  it('沒有橋的人維持基礎 3 層；衍生數值的組成裡看得到「耐受」這一項', () => {
    const g = game({ features: [characterFeature], bridge: null })
    expect(layers(g)).toBe(3)
    setBridge(g, { sensitivity: 30, tolerance: 85, craving: 30, docility: 30 })
    expect(g.k.stats.statParts(g.state, 'pc', 'afterglow_cap').map((p) => [p.label, p.value])).toEqual([['基礎', 3], ['耐受', 2]])
  })

  it('感載上限沒有被加兩次：和角色功能的公式一樣（20 + 耐受 ÷ 2 + mod(意志) × 3），也和沒裝這個功能時一樣', () => {
    for (const tol of [0, 40, 81, 100]) {
      for (const resolve of [4, 10, 16]) {
        const g = game({ features: [characterFeature], resolve, bridge: { sensitivity: 30, tolerance: tol, craving: 30, docility: 30 } })
        const expected = 20 + Math.floor(tol / 2) + attrMod(resolve) * 3
        expect(g.k.stats.stat(g.state, 'pc', 'load_cap')).toBe(expected)
        expect(g.k.stats.statParts(g.state, 'pc', 'load_cap').every((p) => p.source !== 'bridge')).toBe(true)
        // 對照組：同一個狀態，不裝這個功能
        const bare = makeGame({ features: [characterFeature], pc: { attrs: { resolve }, ext: { bridge: { sensitivity: 30, tolerance: tol, craving: 30, docility: 30 } } } }).game
        expect(bare.k.stats.stat(bare.state, 'pc', 'load_cap')).toBe(expected)
      }
    }
  })
})

describe('慾求：開戰時帶著感載（G14）', () => {
  /** 主角一個人對一個雜兵：開打之後看主角單位的感載。 */
  function fight(g: G): { now: number; max: number } | undefined {
    g.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'unit', unit: enemyUnit('minion', 1) as unknown as Record<string, unknown> }] })
    const u = Object.values(g.battle!.units).find((x) => x.actor === 'pc')!
    return u.load ? { now: u.load.now, max: u.load.max } : undefined
  }
  const fresh = (craving: number | null, o: { resolve?: number; tolerance?: number; load?: number } = {}): { now: number; max: number } | undefined => {
    const g = makeGame({
      features: [DISTRICTS, characterFeature, lewdFeature, TEST_COMBAT], content: [PACK],
      pc: { attrs: o.resolve !== undefined ? { resolve: o.resolve } : {}, load: o.load ?? 0, ext: { bridge: craving === null ? null : { sensitivity: 30, tolerance: o.tolerance ?? 0, craving, docility: 30 } } },
    }).game
    return fight(g)
  }

  it('慾求 60 的人開戰感載是 0；59 與 30 也是 0；慾求 80 的人是 5（（80 − 60）÷ 4）；慾求 100 是 10', () => {
    expect(fresh(60)!.now).toBe(0)
    expect(fresh(59)!.now).toBe(0)
    expect(fresh(30)!.now).toBe(0)
    expect(fresh(80)!.now).toBe(5)
    expect(fresh(64)!.now).toBe(1)
    expect(fresh(100)!.now).toBe(10)
  })

  it('不超過感載上限的一半：意志低、上限只有 11 的人，慾求 100 也只帶 5', () => {
    const u = fresh(100, { resolve: 4 })!
    expect(u.max).toBe(20 - 9)
    expect(u.now).toBe(Math.floor(u.max / 2))
    // 上限高的人（耐受 100：上限 70）慾求 100 照算 10
    expect(fresh(100, { tolerance: 100 })!.now).toBe(10)
  })

  it('已經帶著比這更多感載的人不動；沒有橋的人不帶', () => {
    expect(fresh(80, { load: 8 })!.now).toBe(8)
    expect(fresh(80, { load: 2 })!.now).toBe(5)
    expect(fresh(null)!.now).toBe(0)
  })
})

describe('傾向：tendency 效果', () => {
  const tendency = (tag: string, to?: 'deep') => ({ kind: 'tendency', tag, ...(to ? { to } : {}) })

  it('沒有 → 有：標籤變成「有」，那一軸累積一點（還沒升級）；結果的一行寫「多了」', () => {
    const g = game()
    expect(tagStateOf(tend(g), 'tg_smother')).toBeNull()
    const r = give(g, [tendency('tg_smother')])
    const t = tend(g)
    expect(tagStateOf(t, 'tg_smother')).toBe('has')
    expect(t.points.relation).toBe(1)
    expect(t.axes).toEqual({ relation: 0, sense: 0, body: 0, costume: 0 })
    expect(r.lines).toEqual(['傾向：多了「溺愛」'])
  })

  it('潛在 → 有：第一次碰到直接變成有，而且那一軸多一點；一個標籤只揭開一次', () => {
    const g = game()
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_voyeur: 'latent' } }
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBe('latent')
    expect(test(g, { kind: 'tendency_tag', tag: 'tg_voyeur' })).toBe(false)
    const r = give(g, [tendency('tg_voyeur')])
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBe('has')
    expect(tend(g).points.sense).toBe(1)
    expect(r.lines).toEqual(['傾向：「窺視」被揭開了'])
    // 再碰一次：標籤不變、軸再累積一點（這是「做了對應的事」）
    give(g, [tendency('tg_voyeur')])
    expect(tend(g).points.sense).toBe(2)
  })

  it('點數到門檻（預設每級 10 點）軸升一級，點數歸零；升級的那一筆結果寫出升到幾級', () => {
    const g = game()
    for (let i = 0; i < 9; i++) give(g, [tendency('tg_fetish')])
    expect(tend(g).axes.body).toBe(0)
    expect(tend(g).points.body).toBe(9)
    const r = give(g, [tendency('tg_fetish')])
    expect(tend(g).axes.body).toBe(1)
    expect(tend(g).points.body).toBe(0)
    expect(r.lines).toEqual(['傾向：身體累積了一點（戀物），身體升到 1 級'])
    // 別的軸沒有動
    expect(tend(g).axes).toEqual({ relation: 0, sense: 0, body: 1, costume: 0 })
  })

  it('同一軸的不同標籤共用同一條軸的點數；軸最多 5 級，滿級之後再給整筆拿掉（沒有變更、沒有提醒）', () => {
    const g = game()
    for (let i = 0; i < 50; i++) give(g, [tendency(i % 2 ? 'tg_smother' : 'tg_dom')])
    expect(tend(g).axes.relation).toBe(5)
    expect(tend(g).points.relation).toBe(0)
    const r = give(g, [tendency('tg_smother')])
    expect(r.effects).toEqual([])
    expect(r.changes).toEqual([])
    expect(r.clamps).toEqual([])
    expect(tend(g).axes.relation).toBe(5)
    // 滿級的軸上，沒有的標籤照樣可以變成「有」（只是軸不再長）
    const g2 = game()
    g2.state.actors.pc!.ext.tendency = { axes: { relation: 5, sense: 0, body: 0, costume: 0 }, tags: {} }
    give(g2, [tendency('tg_smother')])
    expect(tagStateOf(tend(g2), 'tg_smother')).toBe('has')
    expect(tend(g2).axes.relation).toBe(5)
  })

  it('門檻是規則：lewd_rule/default 的 axis_threshold 蓋掉預設；axis_max 也可以改', () => {
    const rule: ContentPack = { id: 'rule', content: { lewd_rule: [{ id: 'default', axis_threshold: 2, axis_max: 2 }] } }
    const g = game({ content: [PACK, rule] })
    for (let i = 0; i < 4; i++) give(g, [tendency('tg_goth')])
    expect(tend(g).axes.costume).toBe(2)
    give(g, [tendency('tg_goth')])
    expect(tend(g).points.costume).toBe(0)
    expect(tend(g).axes.costume).toBe(2)
  })

  it('「深」：有 → 深只有寫了 to 的內建效果做得到；不累積點數；結果寫「變成了深」', () => {
    const g = game()
    give(g, [tendency('tg_dom')])
    const pts = tend(g).points.relation
    const r = give(g, [tendency('tg_dom', 'deep')])
    expect(tagStateOf(tend(g), 'tg_dom')).toBe('deep')
    expect(tend(g).points.relation).toBe(pts)
    expect(r.lines).toEqual(['傾向：「支配」變成了「深」'])
    // 深也算「有」：條件、hasTag 都成立；再給一般的累積不會把深變回有
    expect(hasTag(tend(g), 'tg_dom')).toBe(true)
    give(g, [tendency('tg_dom')])
    expect(tagStateOf(tend(g), 'tg_dom')).toBe('deep')
    // 已經是深：再寫 to 靜靜地拿掉
    expect(give(g, [tendency('tg_dom', 'deep')]).effects).toEqual([])
  })

  it('AI 給的、玩家要求的都不能把「有」變成「深」：整筆拿掉並提醒；標籤還是「有」', () => {
    const g = game()
    give(g, [tendency('tg_dom')])
    const ai = give(g, [tendency('tg_dom', 'deep')], 'ai')
    expect(ai.effects).toEqual([])
    expect(ai.clamps).toHaveLength(1)
    expect(ai.clamps[0]!.notice).toMatch(/只能由事件寫明/)
    const asked = give(g, [{ ...tendency('tg_dom', 'deep'), asked: '我想要更深' }], 'player', { clampAsked: false, playerInput: '我想要更深' })
    expect(asked.effects).toEqual([])
    expect(asked.clamps).toHaveLength(1)
    expect(tagStateOf(tend(g), 'tg_dom')).toBe('has')
  })

  it('沒有的、潛在的標籤不能直接變深（有提醒）；AI 給一般的 tendency 照收', () => {
    const g = game()
    const r = give(g, [tendency('tg_voyeur', 'deep')])
    expect(r.effects).toEqual([])
    expect(r.clamps[0]!.notice).toMatch(/還沒有「窺視」/)
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBeNull()
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_voyeur: 'latent' } }
    expect(give(g, [tendency('tg_voyeur', 'deep')]).effects).toEqual([])
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBe('latent')
    give(g, [tendency('tg_fetish')], 'ai')
    expect(tagStateOf(tend(g), 'tg_fetish')).toBe('has')
  })

  it('格式：tag 查不到、to 不是 deep 都不合格', () => {
    const g = game()
    const ctx = effectCtx(g.k, g.state, { source: 'builtin' })
    expect(g.k.effects.validate([{ kind: 'tendency', tag: 'tg_ghost' }], ctx)[0]).toMatch(/tg_ghost/)
    expect(g.k.effects.validate([{ kind: 'tendency' }], ctx)[0]).toMatch(/tag/)
    expect(g.k.effects.validate([{ kind: 'tendency', tag: 'tg_dom', to: 'has' }], ctx)[0]).toMatch(/to/)
  })

  it('沒有橋的人一樣有傾向（傾向和橋參數是兩組資料）', () => {
    const g = game({ bridge: null })
    give(g, [tendency('tg_goth')])
    expect(tagStateOf(tend(g), 'tg_goth')).toBe('has')
  })

  it('落在指定的人身上（夥伴）：不影響主角', () => {
    const g = game()
    g.commit(draft([{ op: 'actor.add', actor: { id: 'npc1', name: '夥伴', role: 'companion', age: 30, gender: 'male', attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, perks: [], hp: 30, load: 0, afterglow: 0, sink: 0, conditions: [], ext: {} } }]))
    give(g, [tendency('tg_smother')], 'builtin', { actor: 'npc1' })
    expect(tagStateOf(tend(g, 'npc1'), 'tg_smother')).toBe('has')
    expect(tagStateOf(tend(g), 'tg_smother')).toBeNull()
  })
})

describe('內容篩選關掉的標籤', () => {
  it('被關掉的標籤不會長：tendency 效果整筆拿掉並提醒（寫出是哪個題材），傾向的紀錄沒有任何變化', () => {
    const g = game()
    g.state.rules.contentOff = ['tg_voyeur']
    expect(contentAllowed(g.state.rules, 'tg_voyeur')).toBe(false)
    const before = JSON.stringify(g.state.actors.pc!.ext.tendency ?? null)
    const r = give(g, [{ kind: 'tendency', tag: 'tg_voyeur' }, { kind: 'tendency', tag: 'tg_fetish' }])
    expect(r.effects).toEqual([{ kind: 'tendency', tag: 'tg_fetish' }])
    expect(r.clamps).toHaveLength(1)
    expect(r.clamps[0]!.path).toBe('effects[0]')
    expect(r.clamps[0]!.notice).toMatch(/窺視/)
    expect(r.clamps[0]!.notice).toMatch(/內容篩選/)
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBeNull()
    expect(tend(g).points.sense).toBe(0)
    expect(tagStateOf(tend(g), 'tg_fetish')).toBe('has')
    expect(before).not.toBe(JSON.stringify(g.state.actors.pc!.ext.tendency))
  })

  it('潛在的標籤被關掉：不會被揭開；「深」也不行（連內建的都不行）；AI 的也一樣', () => {
    const g = game()
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_voyeur: 'latent', tg_dom: 'has' } }
    g.state.rules.contentOff = ['tg_voyeur', 'tg_dom']
    for (const source of ['builtin', 'ai'] as const) {
      expect(give(g, [{ kind: 'tendency', tag: 'tg_voyeur' }], source).effects).toEqual([])
      expect(give(g, [{ kind: 'tendency', tag: 'tg_dom', to: 'deep' }], source).effects).toEqual([])
    }
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBe('latent')
    expect(tagStateOf(tend(g), 'tg_dom')).toBe('has')
    expect(tend(g).points.sense).toBe(0)
    // 篩選重新打開就又會長
    g.state.rules.contentOff = []
    give(g, [{ kind: 'tendency', tag: 'tg_voyeur' }])
    expect(tagStateOf(tend(g), 'tg_voyeur')).toBe('has')
  })
})

describe('條件：bridge、has_bridge、tendency_tag、tendency_axis', () => {
  it('has_bridge：有橋成立、null 與沒有這一欄都不成立；看 ctx.actor（沒給是主角）', () => {
    const g = game()
    expect(test(g, { kind: 'has_bridge' })).toBe(true)
    setBridge(g, null)
    expect(test(g, { kind: 'has_bridge' })).toBe(false)
    delete g.state.actors.pc!.ext.bridge
    expect(test(g, { kind: 'has_bridge' })).toBe(false)
    expect(test(g, { kind: 'has_bridge' }, 'nobody')).toBe(false)
  })

  it('bridge：min、max、兩邊都寫；剛好等於邊界成立；超出不成立', () => {
    const g = game({ bridge: { sensitivity: 55, tolerance: 30, craving: 30, docility: 30 } })
    expect(test(g, { kind: 'bridge', param: 'sensitivity', min: 55 })).toBe(true)
    expect(test(g, { kind: 'bridge', param: 'sensitivity', min: 56 })).toBe(false)
    expect(test(g, { kind: 'bridge', param: 'sensitivity', max: 55 })).toBe(true)
    expect(test(g, { kind: 'bridge', param: 'sensitivity', max: 54 })).toBe(false)
    expect(test(g, { kind: 'bridge', param: 'sensitivity', min: 50, max: 60 })).toBe(true)
    expect(test(g, { kind: 'bridge', param: 'tolerance', min: 50, max: 60 })).toBe(false)
    expect(test(g, { kind: 'bridge', param: 'docility' })).toBe(true)
  })

  it('tendency_tag：預設「有或深」；state 可以指定 latent、has（只有）、deep、none', () => {
    const g = game()
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_voyeur: 'latent', tg_smother: 'has', tg_dom: 'deep' } }
    const c = (tag: string, state?: string) => test(g, { kind: 'tendency_tag', tag, ...(state ? { state } : {}) })
    expect([c('tg_voyeur'), c('tg_smother'), c('tg_dom'), c('tg_fetish')]).toEqual([false, true, true, false])
    expect([c('tg_voyeur', 'latent'), c('tg_smother', 'latent')]).toEqual([true, false])
    expect([c('tg_smother', 'has'), c('tg_dom', 'has')]).toEqual([true, false])
    expect([c('tg_dom', 'deep'), c('tg_smother', 'deep')]).toEqual([true, false])
    expect([c('tg_fetish', 'none'), c('tg_dom', 'none')]).toEqual([true, false])
  })

  it('tendency_axis：看軸的等級（不是點數）；min、max', () => {
    const g = game()
    g.state.actors.pc!.ext.tendency = { axes: { relation: 3, sense: 0, body: 1, costume: 5 }, points: { relation: 9, sense: 0, body: 0, costume: 0 }, tags: {} }
    expect(test(g, { kind: 'tendency_axis', axis: 'relation', min: 3 })).toBe(true)
    expect(test(g, { kind: 'tendency_axis', axis: 'relation', min: 4 })).toBe(false)
    expect(test(g, { kind: 'tendency_axis', axis: 'sense', max: 0 })).toBe(true)
    expect(test(g, { kind: 'tendency_axis', axis: 'costume', min: 5, max: 5 })).toBe(true)
    expect(test(g, { kind: 'tendency_axis', axis: 'body', min: 2 })).toBe(false)
  })

  it('格式：不合格的條件在內容載入時（k.conditions.validate）擋下', () => {
    const g = game()
    const v = (c: unknown) => g.k.conditions.validate(c)
    expect(v({ kind: 'bridge', param: 'lust' })).not.toEqual([])
    expect(v({ kind: 'bridge', param: 'craving', min: '3' })).not.toEqual([])
    expect(v({ kind: 'tendency_axis', axis: 'mind' })).not.toEqual([])
    expect(v({ kind: 'tendency_tag' })).not.toEqual([])
    expect(v({ kind: 'tendency_tag', tag: 'tg_dom', state: 'maybe' })).not.toEqual([])
    expect(v({ kind: 'has_bridge' })).toEqual([])
    expect(v({ kind: 'all', of: [{ kind: 'bridge', param: 'craving', min: 1 }, { kind: 'tendency_tag', tag: 'tg_dom' }, { kind: 'tendency_axis', axis: 'body', min: 1 }] })).toEqual([])
  })
})

describe('豔名：量表與「被認出來」（G10）', () => {
  const setFame = (g: G, district: string, value: number) => g.commit(draft([{ op: 'meter', kind: 'fame', key: district, set: value }]))
  const parts = (g: G, tags: string[], actor = 'pc') => checkParts(g.k.stats, g.state, actor, { attr: 'charm', tags }).filter((p) => p.source === 'fame')
  const mask = (g: G, extra: { until?: number; remove?: boolean } = {}) => g.commit(draft([{ op: 'actor.condition', id: 'pc', condition: 'masked', ...extra }]))

  it('fame 是照區記的 0～100 的量表：效果與條件自動有；AI 一件事最多 ±5', () => {
    const g = game()
    expect(g.k.meters.get('fame')).toMatchObject({ keyed: 'district', min: 0, max: 100, start: 0, cap: { down: 5, up: 5 } })
    give(g, [{ kind: 'fame', amount: 60 }])
    expect(g.state.meters.fame).toEqual({ test: 60 })
    expect(test(g, { kind: 'fame', min: 60 })).toBe(true)
    expect(test(g, { kind: 'fame', min: 61 })).toBe(false)
    give(g, [{ kind: 'fame', amount: 8 }], 'ai')
    expect(g.state.meters.fame!.test).toBe(65)
    give(g, [{ kind: 'fame', key: 'd2', amount: 99 }])
    expect(g.state.meters.fame).toEqual({ test: 65, d2: 99 })
    give(g, [{ kind: 'fame', amount: 70 }])
    expect(g.state.meters.fame!.test).toBe(100)
  })

  it('豔名 50 的區裡，帶 infiltrate 標籤的檢定多一筆 −2；別的檢定沒有', () => {
    const g = game()
    setFame(g, 'test', 50)
    expect(parts(g, ['infiltrate'])).toEqual([{ label: '被認出來', value: -2, source: 'fame' }])
    expect(parts(g, ['social'])).toEqual([])
    expect(parts(g, [])).toEqual([])
    expect(parts(g, ['social', 'infiltrate'])).toHaveLength(1)
    // 總分也少 2
    const a = checkParts(g.k.stats, g.state, 'pc', { attr: 'charm', tags: ['infiltrate'] }).reduce((s, p) => s + p.value, 0)
    const b = checkParts(g.k.stats, g.state, 'pc', { attr: 'charm', tags: ['social'] }).reduce((s, p) => s + p.value, 0)
    expect(b - a).toBe(2)
  })

  it('每 25 點 −1：24 沒有、25 是 −1、74 是 −2、75 是 −3、100 是 −4', () => {
    const g = game()
    const out: number[] = []
    for (const f of [0, 24, 25, 49, 50, 74, 75, 100]) {
      setFame(g, 'test', f)
      out.push(parts(g, ['infiltrate'])[0]?.value ?? 0)
    }
    expect(out).toEqual([0, 0, -1, -1, -2, -2, -3, -4])
  })

  it('只看現在這一區：別的區的豔名不算；搬到另一區就換成那一區的', () => {
    const g = game()
    setFame(g, 'd2', 80)
    expect(parts(g, ['infiltrate'])).toEqual([])
    g.commit({ ...draft([{ op: 'location', to: { district: 'd2', block: 'b', scene: 's' } }]), location: { district: 'd2' } })
    expect(parts(g, ['infiltrate'])[0]?.value).toBe(-3)
  })

  it('身上有 masked（戴著人格面具）時沒有這一筆；拿掉面具又有；已經到期的面具不算', () => {
    const g = game()
    setFame(g, 'test', 50)
    mask(g)
    expect(parts(g, ['infiltrate'])).toEqual([])
    mask(g, { remove: true })
    expect(parts(g, ['infiltrate'])).toHaveLength(1)
    mask(g, { until: toMinutes(g.state.time) + 60 })
    expect(parts(g, ['infiltrate'])).toEqual([])
    mask(g, { until: toMinutes(g.state.time) - 1 })
    expect(parts(g, ['infiltrate'])).toHaveLength(1)
  })

  it('只算主角的臉：夥伴的檢定沒有這一筆', () => {
    const g = game()
    g.commit(draft([{ op: 'actor.add', actor: { id: 'npc1', name: '夥伴', role: 'companion', age: 30, gender: 'male', attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, perks: [], hp: 30, load: 0, afterglow: 0, sink: 0, conditions: [], ext: {} } }]))
    setFame(g, 'test', 80)
    expect(parts(g, ['infiltrate'], 'npc1')).toEqual([])
    expect(parts(g, ['infiltrate'])).toHaveLength(1)
  })

  it('規則可以蓋：fame_step 改成 10 的區，豔名 50 是 −5', () => {
    const rule: ContentPack = { id: 'rule', content: { lewd_rule: [{ id: 'default', fame_step: 10 }] } }
    const g = game({ content: [PACK, rule] })
    setFame(g, 'test', 50)
    expect(parts(g, ['infiltrate'])[0]?.value).toBe(-5)
  })
})

describe('開新局與讀檔：主角沒有 bridge 就補', () => {
  const pcDraft = (ext: Record<string, unknown>): ReportDraft => ({
    kind: 'system', action: 'creation.commit', location: {}, party: [], timeline: [], outcome: { result: 'created', summary: '建角' },
    changes: [{ op: 'actor.add', actor: { id: 'pc', name: '新主角', role: 'pc', age: 25, gender: 'female', attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, perks: [], hp: 30, load: 0, afterglow: 0, sink: 0, conditions: [], ext } }, { op: 'pc', id: 'pc' }],
  })
  const newGameWith = (ext: Record<string, unknown>, content: ContentPack[] = [PACK]): G => {
    const { game: g } = makeGame({ features: [DISTRICTS, lewdFeature], content, pc: false })
    g.newGame({ seed: 5, setup: () => pcDraft(ext) })
    return g
  }

  it('開新局建出來的主角沒有 bridge：補預設（四項各 30）', () => {
    const g = newGameWith({})
    expect(bridge(g)).toEqual({ sensitivity: 30, tolerance: 30, craving: 30, docility: 30 })
    expect(test(g, { kind: 'has_bridge' })).toBe(true)
  })

  it('建角給了橋就用建角的值，不蓋掉；建角明寫沒有橋（null）就是沒有橋', () => {
    expect(bridge(newGameWith({ bridge: { sensitivity: 55, tolerance: 20, craving: 10, docility: 80 } }))).toEqual({ sensitivity: 55, tolerance: 20, craving: 10, docility: 80 })
    expect(bridge(newGameWith({ bridge: null }))).toBeNull()
  })

  it('預設值是規則：lewd_rule/default 的 default_bridge 蓋掉 30', () => {
    const g = newGameWith({}, [PACK, { id: 'rule', content: { lewd_rule: [{ id: 'default', default_bridge: 45 }] } }])
    expect(bridge(g)).toEqual({ sensitivity: 45, tolerance: 45, craving: 45, docility: 45 })
  })

  it('其他人（夥伴、之後的 NPC）新增時不補：他們有沒有橋由資料決定', () => {
    const g = game()
    g.commit(draft([{ op: 'actor.add', actor: { id: 'npc1', name: '路人', role: 'npc', age: 30, gender: 'male', attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 10, charm: 10 }, skills: {}, perks: [], hp: 30, load: 0, afterglow: 0, sink: 0, conditions: [], ext: {} } }]))
    expect(g.state.actors.npc1!.ext.bridge).toBeUndefined()
  })

  it('save.loaded：讀進來的舊存檔，主角沒有 bridge 欄位就補（提交一份 save.repair 報告）；null 的不動；有值的不動', () => {
    const g = game()
    delete g.state.actors.pc!.ext.bridge
    const raw = g.save('manual', '1')
    const g2 = game()
    expect(g2.load(raw)).toBeNull()
    expect(bridge(g2)).toEqual({ sensitivity: 30, tolerance: 30, craving: 30, docility: 30 })
    expect(g2.state.reports.at(-1)!.action).toBe('save.repair')

    const g3 = game({ bridge: null })
    const g4 = game()
    expect(g4.load(g3.save('manual', '1'))).toBeNull()
    expect(bridge(g4)).toBeNull()
    expect(g4.state.reports.at(-1)!.action).not.toBe('save.repair')

    const g5 = game({ bridge: { sensitivity: 77, tolerance: 1, craving: 2, docility: 3 } })
    const g6 = game()
    g6.load(g5.save('manual', '1'))
    expect(bridge(g6)).toEqual({ sensitivity: 77, tolerance: 1, craving: 2, docility: 3 })
  })
})

describe('存檔往返：數字不變', () => {
  it('橋參數、傾向（含點數與潛在、深）、每區的豔名存檔再讀回來一模一樣；讀完不多出修復的報告', () => {
    const g = game()
    give(g, [{ kind: 'bridge', param: 'sensitivity', amount: 12 }, { kind: 'bridge', param: 'craving', amount: -7 }])
    g.state.actors.pc!.ext.tendency = { axes: { relation: 2, sense: 0, body: 0, costume: 0 }, points: { relation: 4, sense: 0, body: 0, costume: 0 }, tags: { tg_voyeur: 'latent' } }
    for (let i = 0; i < 12; i++) give(g, [{ kind: 'tendency', tag: 'tg_goth' }])
    give(g, [{ kind: 'tendency', tag: 'tg_smother' }])
    give(g, [{ kind: 'tendency', tag: 'tg_smother', to: 'deep' }])
    give(g, [{ kind: 'fame', amount: 40 }, { kind: 'fame', key: 'd2', amount: 12 }])
    const raw = g.save('manual', '1')
    const g2 = game()
    expect(g2.load(raw)).toBeNull()
    expect(g2.state.actors.pc!.ext).toEqual(g.state.actors.pc!.ext)
    expect(g2.state.meters).toEqual(g.state.meters)
    expect(bridge(g2)).toEqual({ sensitivity: 42, tolerance: 30, craving: 23, docility: 30 })
    expect(tend(g2)).toEqual(tend(g))
    expect(tagStateOf(tend(g2), 'tg_voyeur')).toBe('latent')
    expect(tagStateOf(tend(g2), 'tg_smother')).toBe('deep')
    expect(tend(g2).axes.costume).toBe(1)
    expect(g2.state.meters.fame).toEqual({ test: 40, d2: 12 })
    expect(g2.state.reports.length).toBe(g.state.reports.length)
  })
})

describe('不變式與內容', () => {
  it('每一份報告的變更都套得上去：觀察著做完一串效果，沒有違反不變式（strict）', async () => {
    const g = game()
    const { violations } = await observed(g, () => {
      give(g, [{ kind: 'bridge', param: 'craving', amount: 9 }, { kind: 'tendency', tag: 'tg_smother' }, { kind: 'fame', amount: 5 }])
      give(g, [{ kind: 'bridge', param: 'docility', amount: 99 }, { kind: 'tendency', tag: 'tg_smother', to: 'deep' }])
    })
    expect(violations).toEqual([])
  })

  it('內容格式：tendency_tag 的 axis 要是四條軸之一、要有名字；lewd_rule 的數字要是正整數', () => {
    const g = game()
    expect(() => g.k.content.load('tendency_tag', [{ id: 'tg_bad', name: '壞的', axis: 'mind' }])).toThrow(ContentError)
    expect(() => g.k.content.load('tendency_tag', [{ id: 'tg_bad2', axis: 'body' }])).toThrow(ContentError)
    expect(() => g.k.content.load('lewd_rule', [{ id: 'default', axis_threshold: 0 }])).toThrow(ContentError)
    expect(() => g.k.content.load('lewd_rule', [{ id: 'default', default_bridge: 101 }])).toThrow(ContentError)
    expect(() => g.k.content.load('lewd_rule', [{ id: 'default', fame_step: 'x' }])).toThrow(ContentError)
  })

  it('沒有 tendency 這一欄、或欄位壞掉的角色：讀成空的傾向，不丟錯', () => {
    const g = game()
    g.state.actors.pc!.ext.tendency = { axes: { relation: 99, sense: 'x' }, tags: { tg_dom: 'strong', tg_smother: 'has' }, points: null }
    const t = tend(g)
    expect(t.axes).toEqual({ relation: 5, sense: 0, body: 0, costume: 0 })
    expect(t.tags).toEqual({ tg_smother: 'has' })
    delete g.state.actors.pc!.ext.tendency
    expect(tend(g).axes).toEqual({ relation: 0, sense: 0, body: 0, costume: 0 })
  })
})
