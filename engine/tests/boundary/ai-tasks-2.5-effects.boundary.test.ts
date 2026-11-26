// 邊界測試：AI_TASKS 2.5 節（驗證與夾值）× EVENTS 2.4 節（效果的封閉清單與每件上限），M2 後段到 M4 加進來的效果。cpp-tester-boundary 寫的；邊界表在這份測試的回報裡。
//
// 已經有的不重寫：錢、判定、hp／load／sink／afterglow、物品（ai-tasks-2.5.boundary.test.ts）；六種量表（m2-meters-ai.boundary.test.ts）；
// 戰鬥的效果與 deck 的內建效果（features/M3-ai-net.boundary.test.ts）。這一份補：
//   - 封閉清單：每一個註冊過的種類（不只舉例的幾個），AI 與玩家要的結果（開、關、asked 對得上）都不收只給內建的那幾種
//   - 每件上限：insight、xp、owed、owed_to_pc、bridge、roster_add、bill（新項目與加減）、grace、satisfaction、meet、npc_known
//   - 「玩家要求的結果也夾值」開與關兩條路（關著時 asked 對得上的不夾、對不上的照 AI 的夾），內建的照寫的算
//   - 格式錯誤不論開關都擋（同一份輸入，三條路的「收不收」一樣）
//   - 內容資料的年齡底線（2026-11-25 定案：新的人、匯入與世界編輯器的人物，低於 18 一律擋下；不看開關）
//   - 整條自由行動的鏈：假的服務商送對抗性的回應（超出上限、不存在的 id、少欄位、壞掉的 JSON、拒絕、逾時、asked 對不上、少交 <covered>）
//
// 和規格對不上的五件寫成 bug 報告（dev/bugs/B034～B038），會失敗的測試在 tests/pending/，重現在 tests/pending/fixtures/；這一份只放現在成立的。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ActionKindDef, AiRequest, EffectCtx, Feature } from '../../src'
import { ADVERSARIAL_MODES, MIN_AGE, askedMatches, clone, effectCtx, inputOf, meterOf, sectionOf } from '../../src'
import { currentLines } from '../../src/features/bills/model'
import { CITY_PC, makeCityGame, makeWorldGame, observed } from '../../src/testkit'

// ---------------------------------------------------------------------------------------------
// 共用

const TEXT = '我拜託房東讓我晚點交租，順便說我想跟街坊小周多學一點'
const ASKED = '讓我晚點交租'
const NOT_SAID = '玩家沒有說過的一句話'
const NPC = 'npc_tw_friend'
const TAG = 'tg_tw_dom'

type G = ReturnType<typeof makeCityGame>['game']
/** 五條路：內建；AI 自己生成的；玩家要的而設定開著；設定關著、asked 對得上；設定關著、asked 對不上 */
type Route = 'builtin' | 'ai' | 'on' | 'off' | 'off_miss'
const ROUTES: Route[] = ['builtin', 'ai', 'on', 'off', 'off_miss']
/** 夾值的那幾條路（AI_TASKS 2.5 節的表：AI 自己生成的、設定開著時玩家要的、關著而 asked 對不上的） */
const CAPPED: Route[] = ['ai', 'on', 'off_miss']

const ctxOf = (g: G, route: Route): EffectCtx => {
  if (route === 'builtin' || route === 'ai') return effectCtx(g.k, g.state, { source: route })
  return effectCtx(g.k, g.state, { source: 'player', clampAsked: route === 'on', playerInput: TEXT })
}
/** 玩家要的那幾筆附上 asked：off 對得上，off_miss 對不上，其餘的路照樣附（開著時附了也照夾） */
const withAsked = (route: Route, fx: Record<string, unknown>): Record<string, unknown> =>
  route === 'builtin' || route === 'ai' ? fx : { ...fx, asked: route === 'off_miss' ? NOT_SAID : ASKED }

const resolve = (g: G, route: Route, fx: Array<Record<string, unknown>>) => g.k.effects.resolve(fx.map((e) => withAsked(route, e)), ctxOf(g, route))

/** 解析並提交（和事件一樣的路）。 */
function apply(g: G, route: Route, fx: Array<Record<string, unknown>>) {
  const r = resolve(g, route, fx)
  if (r.errors.length === 0 && r.changes.length > 0) {
    g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
  }
  return r
}

/** 夾值的提醒是白話：不出現欄位名稱（英文的 id、路徑）與硬規則的編號 */
const PLAIN = (notice: string) => !/[A-Za-z_]{2,}|H\d+/.test(notice)

/** 一局城市情境（租了四號塔的單位：這一週有房租 100）；街坊小周用內建的 meet 先認識（有角色、名冊候選與記憶才有對象）。 */
function fresh(): G {
  const { game } = makeCityGame()
  const r = game.k.effects.resolve([{ kind: 'meet', npc: NPC }], effectCtx(game.k, game.state, { source: 'builtin' }))
  game.commit({ kind: 'event', action: 'event.test', location: clone(game.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
  return game
}

const xpOf = (g: G): number => ((g.state.actors.pc!.ext.abilities as { xp?: number } | undefined)?.xp ?? 0)
const bridgeOf = (g: G): Record<string, number> => g.state.actors.pc!.ext.bridge as Record<string, number>
const favorsOf = (g: G): { owed_to_pc: unknown[]; owed_by_pc: unknown[] } => {
  const f = g.state.ext.favors as { owed_to_pc?: unknown[]; owed_by_pc?: unknown[] } | undefined
  return { owed_to_pc: f?.owed_to_pc ?? [], owed_by_pc: f?.owed_by_pc ?? [] }
}
const candidatesOf = (g: G): Array<{ who: string }> => ((g.state.ext.roster as { candidates?: Array<{ who: string }> } | undefined)?.candidates ?? [])

// ---------------------------------------------------------------------------------------------
// 1. 封閉清單（EVENTS 2.4 節「這張表以外的效果」；AI_TASKS 2.5 節「效果的種類是引擎套用得了的」；dev/adr/0017 第 26 項、0019）

describe('邊界 EVENTS 2.4／AI_TASKS 2.5：封閉清單，每一個註冊過的種類', () => {
  const g = fresh()
  const kinds = g.k.effects.kinds()
  const aiKinds = new Set(g.k.effects.aiKinds())
  const builtinOnly = kinds.filter((x) => !aiKinds.has(x))

  it('aiKinds 是全部種類扣掉只給內建的；perk、scout_reveal 一定在只給內建的那一邊（規格點名）', () => {
    expect(kinds.length).toBeGreaterThan(0)
    expect([...aiKinds].every((x) => kinds.includes(x))).toBe(true)
    expect(builtinOnly).toEqual(expect.arrayContaining(['perk', 'scout_reveal', 'debt', 'bargain']))
    // 給 AI 的提示（reward 的 kinds）只列 aiKinds：只給內建的一個都不在裡面
    for (const x of builtinOnly) expect(aiKinds.has(x), x).toBe(false)
  })

  it('性質：只給內建的任何一種，AI 與玩家要的（開、關而且 asked 對得上、關而對不上）整批驗證不過，混一筆合法的現金也一樣；錯誤說「不是 AI 與玩家要的結果可以用的效果」', () => {
    fc.assert(fc.property(fc.constantFrom(...builtinOnly), fc.constantFrom<Route>('ai', 'on', 'off', 'off_miss'), fc.boolean(), (kind, route, mixed) => {
      const fx = [...(mixed ? [{ kind: 'cash', amount: 10 }] : []), { kind }]
      const r = resolve(g, route, fx)
      expect(r.changes).toEqual([])
      expect(r.errors.some((e) => e.includes('不是 AI 與玩家要的結果可以用的效果')), `${kind} ${route}`).toBe(true)
    }), { numRuns: 200, seed: 34 })
  })

  it('對照：同一批種類走內建的來源，不會因為封閉清單被擋（可能因為少欄位而有別的格式錯誤）', () => {
    for (const kind of builtinOnly) {
      const r = resolve(g, 'builtin', [{ kind }])
      expect(r.errors.some((e) => e.includes('不是 AI 與玩家要的結果可以用的效果')), kind).toBe(false)
    }
  })

  it('不存在的種類、kind 不是字串、整筆不是物件：五條路都是格式錯誤（夾值關著也擋）', () => {
    for (const route of ROUTES) {
      for (const bad of [{ kind: 'god_sword' }, { kind: 3 }, { kind: '' }]) expect(resolve(g, route, [bad]).errors, `${route} ${JSON.stringify(bad)}`).toHaveLength(1)
      expect(g.k.effects.resolve(['cash'], ctxOf(g, route)).errors, route).toHaveLength(1)
      expect(g.k.effects.resolve({ kind: 'cash', amount: 1 }, ctxOf(g, route)).errors, route).toHaveLength(1)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 格式錯誤不論開關都擋（AI_TASKS 2.5 節：「每一種情況都照擋的是格式錯誤」）

/** M2 後段到 M4 的效果，好的與壞的各幾份（壞的是格式錯誤：型別、範圍、少欄位、不存在的引用） */
const SAMPLES: Array<Record<string, unknown>> = [
  { kind: 'xp', amount: 3 }, { kind: 'xp', amount: -1 }, { kind: 'xp', amount: 1.5 }, { kind: 'xp' },
  { kind: 'insight', amount: 2 }, { kind: 'insight', amount: '2' }, { kind: 'insight', amount: Number.NaN },
  { kind: 'owed', who: NPC, size: 'small' }, { kind: 'owed', who: NPC, size: 'huge' }, { kind: 'owed', who: 'npc_ghost', size: 'small' }, { kind: 'owed_to_pc', who: NPC, size: 'mid' }, { kind: 'owed_to_pc', size: 'mid' },
  { kind: 'bridge', param: 'sensitivity', amount: 1 }, { kind: 'bridge', param: 'nope', amount: 1 }, { kind: 'bridge', param: 'craving', amount: 0.5 },
  { kind: 'tendency', tag: TAG }, { kind: 'tendency', tag: 'tg_nope' }, { kind: 'tendency', tag: TAG, to: 'shallow' },
  { kind: 'roster_add', who: NPC }, { kind: 'roster_add', who: 'pc' }, { kind: 'roster_add', who: NPC, source: 'nowhere' },
  { kind: 'bill', item: 'rent', amount: 10 }, { kind: 'bill', item: 'rent', amount: 10, weeks: 2 }, { kind: 'bill', name: '保護費', amount: 50, weeks: 4, pay: 'cash' },
  { kind: 'bill', name: '保護費', amount: 50, weeks: 0, pay: 'cash' }, { kind: 'bill', name: '保護費', amount: 50, weeks: 521, pay: 'cash' }, { kind: 'bill', name: '保護費', amount: 0, weeks: 1, pay: 'cash' }, { kind: 'bill', name: '保護費', amount: 50, weeks: 1, pay: 'gold' },
  { kind: 'grace', item: 'rent', days: 3 }, { kind: 'grace', item: 'rent', days: 0 }, { kind: 'grace', days: 3 },
  { kind: 'meet', npc: NPC }, { kind: 'meet' }, { kind: 'npc_known', npc: NPC, fact: 'bridge' }, { kind: 'npc_known', npc: NPC, fact: 'favorite_color' },
  { kind: 'memory', text: '一起在攤子前躲雨。', who: [NPC] }, { kind: 'memory', text: '' }, { kind: 'memory', text: '很長'.repeat(200) },
  { kind: 'satisfaction', amount: 2 }, { kind: 'satisfaction', amount: 2.5 },
]

describe('邊界 AI_TASKS 2.5：格式錯誤不論開關都擋', () => {
  it('性質：同一份輸入（1～4 筆、任意組合），AI、開、關而且 asked 對得上、關而對不上這四條路「收不收」一樣；有格式錯誤的整批沒有任何變更', () => {
    const g = fresh()
    fc.assert(fc.property(fc.array(fc.constantFrom(...SAMPLES), { minLength: 1, maxLength: 4 }), (fx) => {
      const results = (['ai', 'on', 'off', 'off_miss'] as Route[]).map((route) => resolve(g, route, fx))
      const failed = results.map((r) => r.errors.length > 0)
      expect(new Set(failed).size, JSON.stringify(fx)).toBe(1)
      for (const r of results) if (r.errors.length) expect(r.changes).toEqual([])
    }), { numRuns: 300, seed: 2511 })
  })

  it('最大組合（關、asked 對得上）：數量是安全整數的最大值時照收（只驗格式）；超過安全整數、無限、非數照擋', () => {
    const g = fresh()
    const big = Number.MAX_SAFE_INTEGER
    for (const kind of ['xp', 'insight']) {
      expect(resolve(g, 'off', [{ kind, amount: big }]).errors, kind).toEqual([])
      for (const bad of [big + 2, Number.POSITIVE_INFINITY, Number.NaN]) expect(resolve(g, 'off', [{ kind, amount: bad }]).errors, `${kind} ${bad}`).toHaveLength(1)
    }
    expect(resolve(g, 'off', [{ kind: 'grace', item: 'rent', days: big + 2 }]).errors).toHaveLength(1)
    expect(resolve(g, 'off', [{ kind: 'bill', name: '保護費', amount: big + 2, weeks: 1, pay: 'cash' }]).errors).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 每件上限：一種一種來（EVENTS 2.4 節的表；「每件」是一件事合計，拆成幾筆給也一樣）

describe('邊界 EVENTS 2.4：insight（體悟，AI 只能加不能扣：一件 0～+5）', () => {
  const at = (route: Route, amounts: number[], start = 3) => {
    const g = fresh()
    g.state.meters.insight = { _: start }
    const r = apply(g, route, amounts.map((amount) => ({ kind: 'insight', amount })))
    return { r, v: meterOf(g.k, g.state, 'insight') }
  }

  it('上限 5 剛好不夾；上限+1 夾在 5、留記號、提醒是白話；拆成 3+3 合計夾成 5', () => {
    for (const route of CAPPED) {
      expect(at(route, [5])).toMatchObject({ v: 8, r: { clamps: [] } })
      const over = at(route, [6])
      expect(over.v, route).toBe(8)
      expect(over.r.clamps[0], route).toMatchObject({ from: 6, to: 5 })
      expect(PLAIN(over.r.clamps[0]!.notice)).toBe(true)
      expect(at(route, [3, 3]).v, route).toBe(8)
    }
  })

  it('下限：AI 給 −1（下限−1）整筆拿掉並提醒，體悟不變；內建的照寫的扣（不受這條限制）', () => {
    for (const route of CAPPED) {
      const neg = at(route, [-1])
      expect(neg.v, route).toBe(3)
      expect(neg.r.changes, route).toEqual([])
      expect(neg.r.clamps, route).toHaveLength(1)
    }
    expect(at('builtin', [-1]).v).toBe(2)
    expect(at('builtin', [-9]).v).toBe(0)
  })

  it('關、asked 對得上：+6、+999 照給，不夾也不提醒；內建的一樣', () => {
    for (const route of ['off', 'builtin'] as const) {
      expect(at(route, [6]), route).toMatchObject({ v: 9, r: { clamps: [] } })
      expect(at(route, [999]).v, route).toBe(1002)
    }
  })

  it('零：五條路都不產生變更、不留一行、不算錯', () => {
    for (const route of ROUTES) expect(at(route, [0]).r, route).toMatchObject({ errors: [], changes: [], lines: [] })
  })
})

describe('邊界 CORE_RULES 7.1：xp（歷練點，AI 給的一件事最多 10 點；ADR 0017 第 26 項保留給 AI）', () => {
  it('10 剛好不夾；11 夾在 10；拆成 6+6 合計夾成 10；提醒是白話', () => {
    for (const route of CAPPED) {
      const g1 = fresh(); expect(apply(g1, route, [{ kind: 'xp', amount: 10 }]).clamps, route).toEqual([]); expect(xpOf(g1)).toBe(10)
      const g2 = fresh(); const r = apply(g2, route, [{ kind: 'xp', amount: 11 }]); expect(xpOf(g2), route).toBe(10); expect(r.clamps[0]).toMatchObject({ from: 11, to: 10 }); expect(PLAIN(r.clamps[0]!.notice)).toBe(true)
      const g3 = fresh(); apply(g3, route, [{ kind: 'xp', amount: 6 }, { kind: 'xp', amount: 6 }]); expect(xpOf(g3), route).toBe(10)
    }
  })

  it('關而且 asked 對得上、內建：50 照給；下限 −1 五條路都是格式錯誤', () => {
    for (const route of ['off', 'builtin'] as const) { const g = fresh(); expect(apply(g, route, [{ kind: 'xp', amount: 50 }]).clamps).toEqual([]); expect(xpOf(g), route).toBe(50) }
    const g = fresh()
    for (const route of ROUTES) expect(resolve(g, route, [{ kind: 'xp', amount: -1 }]).errors, route).toHaveLength(1)
  })
})

describe('邊界 EVENTS 2.4／FIXER 8：owed、owed_to_pc（一件事一個小或中人情）', () => {
  for (const kind of ['owed', 'owed_to_pc'] as const) {
    const dir = kind === 'owed' ? 'owed_by_pc' : 'owed_to_pc'
    it(`${kind}：一個不夾；小＋中兩個只收第一個並提醒；大人情整筆拿掉並提醒（AI 的三條路）`, () => {
      for (const route of CAPPED) {
        const g1 = fresh(); expect(apply(g1, route, [{ kind, who: NPC, size: 'mid' }]).clamps, route).toEqual([]); expect(favorsOf(g1)[dir]).toHaveLength(1)
        const g2 = fresh(); const two = apply(g2, route, [{ kind, who: NPC, size: 'small' }, { kind, who: NPC, size: 'mid' }])
        expect(favorsOf(g2)[dir], route).toHaveLength(1)
        expect(two.clamps, route).toHaveLength(1)
        expect(PLAIN(two.clamps[0]!.notice)).toBe(true)
        const g3 = fresh(); const big = apply(g3, route, [{ kind, who: NPC, size: 'big' }])
        expect(favorsOf(g3)[dir], route).toHaveLength(0)
        expect(big.clamps[0]!.to, route).toBeNull()
      }
    })
    it(`${kind}：關而且 asked 對得上、內建：兩個與大人情都照收`, () => {
      for (const route of ['off', 'builtin'] as const) {
        const g = fresh(); apply(g, route, [{ kind, who: NPC, size: 'small' }, { kind, who: NPC, size: 'big' }])
        expect(favorsOf(g)[dir], route).toHaveLength(2)
      }
    })
  }
})

describe('邊界 EVENTS 2.4／LEWD_SYSTEM 1：bridge（橋參數一件事一項 +1）', () => {
  it('+1 不夾；+2 夾成 +1；兩項各 +1 只收第一項；往下同樣最多 −1（AI 的三條路）', () => {
    for (const route of CAPPED) {
      const g1 = fresh(); expect(apply(g1, route, [{ kind: 'bridge', param: 'sensitivity', amount: 1 }]).clamps).toEqual([]); expect(bridgeOf(g1).sensitivity).toBe(31)
      const g2 = fresh(); const r2 = apply(g2, route, [{ kind: 'bridge', param: 'sensitivity', amount: 2 }]); expect(bridgeOf(g2).sensitivity, route).toBe(31); expect(r2.clamps[0]).toMatchObject({ from: 2, to: 1 })
      const g3 = fresh(); apply(g3, route, [{ kind: 'bridge', param: 'sensitivity', amount: 1 }, { kind: 'bridge', param: 'craving', amount: 1 }]); expect(bridgeOf(g3), route).toMatchObject({ sensitivity: 31, craving: 30 })
      const g4 = fresh(); apply(g4, route, [{ kind: 'bridge', param: 'docility', amount: -5 }]); expect(bridgeOf(g4).docility, route).toBe(29)
    }
  })

  it('範圍 0～100：上限 100 時 +1 整筆拿掉、不提醒（到頭是常態）；下限 0 時 −1 一樣；關而且 asked 對得上 +500 照給但落在 100', () => {
    for (const [v, amount] of [[100, 1], [0, -1]] as const) {
      const g = fresh(); g.state.actors.pc!.ext.bridge = { ...bridgeOf(g), tolerance: v }
      const r = apply(g, 'ai', [{ kind: 'bridge', param: 'tolerance', amount }])
      expect(bridgeOf(g).tolerance).toBe(v)
      expect(r).toMatchObject({ errors: [], changes: [], clamps: [] })
    }
    const g = fresh(); expect(apply(g, 'off', [{ kind: 'bridge', param: 'tolerance', amount: 500 }]).clamps).toEqual([]); expect(bridgeOf(g).tolerance).toBe(100)
  })
})

describe('邊界 EVENTS 2.4／NPC_SYSTEM 10.7：roster_add（一件事一位名冊候選）', () => {
  it('AI 的三條路：兩位只收第一位並提醒；關而且 asked 對得上、內建：兩位都收', () => {
    const second = (g: G): string => {
      const r = g.k.effects.resolve([{ kind: 'meet', npc: 'npc_tw_vendor' }], effectCtx(g.k, g.state, { source: 'builtin' }))
      if (r.changes.length) g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
      return g.state.actors.npc_tw_vendor ? 'npc_tw_vendor' : NPC
    }
    for (const route of ROUTES) {
      const g = fresh()
      const other = second(g)
      const r = apply(g, route, [{ kind: 'roster_add', who: NPC }, { kind: 'roster_add', who: other }])
      const want = other === NPC ? 1 : CAPPED.includes(route) ? 1 : 2
      expect(candidatesOf(g).length, route).toBe(want)
      if (CAPPED.includes(route) && other !== NPC) expect(PLAIN(r.clamps[0]!.notice)).toBe(true)
    }
  })

  it('主角自己、不認得的來源：五條路都是格式錯誤', () => {
    const g = fresh()
    for (const route of ROUTES) {
      expect(resolve(g, route, [{ kind: 'roster_add', who: 'pc' }]).errors, route).toHaveLength(1)
      expect(resolve(g, route, [{ kind: 'roster_add', who: NPC, source: 'nowhere' }]).errors, route).toHaveLength(1)
    }
  })
})

describe('邊界 EVENTS 2.4／DOWNTIME 5：bill 與 grace（AI 的三條路）', () => {
  it('加減一項：剛好一半（50）不夾；一半+1 夾回 50；−一半−1 夾回 −50；兩筆 30＋30 合計夾成 50；這一週沒有那一項整筆拿掉並提醒', () => {
    for (const route of CAPPED) {
      const g = fresh()
      expect(currentLines(g.k, g.state).find((l) => l.id === 'rent')!.raw).toBe(100)
      expect(resolve(g, route, [{ kind: 'bill', item: 'rent', amount: 50 }]).clamps, route).toEqual([])
      expect(resolve(g, route, [{ kind: 'bill', item: 'rent', amount: 51 }]).changes, route).toEqual([{ op: 'bills.tweak', item: 'rent', delta: 50 }])
      expect(resolve(g, route, [{ kind: 'bill', item: 'rent', amount: -51 }]).changes, route).toEqual([{ op: 'bills.tweak', item: 'rent', delta: -50 }])
      const two = resolve(g, route, [{ kind: 'bill', item: 'rent', amount: 30 }, { kind: 'bill', item: 'rent', amount: 30 }])
      expect(two.changes.reduce((s, c) => s + (c.delta as number), 0), route).toBe(50)
      const none = resolve(g, route, [{ kind: 'bill', item: 'no_such_bill', amount: 10 }])
      expect(none.changes, route).toEqual([])
      expect(PLAIN(none.clamps[0]!.notice) || none.clamps[0]!.notice.includes('no_such_bill'), route).toBe(true)
    }
  })

  it('新的項目：總額（每週金額 × 週數）照主角信譽那一階的錢的上限（I 級 120）；剛好 120 不夾、超過縮短週數、一期都超過的縮成 120 只收一期', () => {
    for (const route of CAPPED) {
      const g = fresh()
      expect(resolve(g, route, [{ kind: 'bill', name: '保護費', amount: 30, weeks: 4, pay: 'cash' }]).clamps, route).toEqual([])
      expect(resolve(g, route, [{ kind: 'bill', name: '保護費', amount: 30, weeks: 5, pay: 'cash' }]).changes[0], route).toMatchObject({ amount: 30, weeks: 4 })
      expect(resolve(g, route, [{ kind: 'bill', name: '保護費', amount: 121, weeks: 2, pay: 'cash' }]).changes[0], route).toMatchObject({ amount: 120, weeks: 1 })
    }
    for (const route of ['off', 'builtin'] as const) expect(resolve(fresh(), route, [{ kind: 'bill', name: '保護費', amount: 1000, weeks: 520, pay: 'cash' }]).changes[0], route).toMatchObject({ amount: 1000, weeks: 520 })
  })

  it('grace：7 天剛好不夾；8 天夾在 7、提醒是白話；0 天與負數是格式錯誤', () => {
    for (const route of CAPPED) {
      const g = fresh()
      expect(resolve(g, route, [{ kind: 'grace', item: 'rent', days: 7 }]).clamps, route).toEqual([])
      const r = resolve(g, route, [{ kind: 'grace', item: 'rent', days: 8 }])
      expect(r.clamps[0], route).toMatchObject({ from: 8, to: 7 })
      expect(PLAIN(r.clamps[0]!.notice)).toBe(true)
      for (const days of [0, -1]) expect(resolve(g, route, [{ kind: 'grace', item: 'rent', days }]).errors, `${route} ${days}`).toHaveLength(1)
    }
  })
})

describe('邊界 EVENTS 2.4／NPC_SYSTEM：meet、npc_known（沒有數字的上限；對象不合的整筆拿掉並提醒）', () => {
  it('五條路：查不到的人整筆拿掉並提醒（不算格式錯誤、不擋同一批的別筆）；npc_known 對不認識的人一樣；已經記過的事整筆拿掉、不提醒', () => {
    for (const route of ROUTES) {
      const g = fresh()
      const ghost = resolve(g, route, [{ kind: 'meet', npc: 'npc_ghost' }, { kind: 'cash', amount: 5 }])
      expect(ghost.errors, route).toEqual([])
      expect(ghost.changes.some((c) => JSON.stringify(c).includes('npc_ghost')), route).toBe(false)
      expect(ghost.clamps.map((c) => c.to), route).toEqual([null])
      const unknown = resolve(g, route, [{ kind: 'npc_known', npc: 'npc_ghost', fact: 'bridge' }])
      expect(unknown.changes, route).toEqual([])
      expect(unknown.clamps, route).toHaveLength(1)
      apply(g, route, [{ kind: 'npc_known', npc: NPC, fact: 'bridge' }])
      expect(resolve(g, route, [{ kind: 'npc_known', npc: NPC, fact: 'bridge' }]), route).toMatchObject({ changes: [], clamps: [] })
    }
  })
})

describe('邊界 EVENTS 2.4／LEWD_SYSTEM 7.4：satisfaction（持約人的滿意；dev/adr/0019：AI 與玩家要的一律不收）', () => {
  it('AI、開、關（asked 對得上或對不上）：整筆拿掉並提醒（不是格式錯誤）；內建的照寫的加', () => {
    for (const route of ['ai', 'on', 'off', 'off_miss'] as Route[]) {
      const g = fresh()
      const r = apply(g, route, [{ kind: 'satisfaction', amount: 3 }])
      expect(r.errors, route).toEqual([])
      expect(meterOf(g.k, g.state, 'satisfaction'), route).toBe(0)
      expect(r.clamps, route).toHaveLength(1)
      expect(PLAIN(r.clamps[0]!.notice)).toBe(true)
    }
    const g = fresh(); apply(g, 'builtin', [{ kind: 'satisfaction', amount: 3 }]); expect(meterOf(g.k, g.state, 'satisfaction')).toBe(3)
  })
})

// ---------------------------------------------------------------------------------------------
// 4. 性質：任意一批 M2 後段到 M4 的效果，AI 的三條路的每件上限都守得住；關而 asked 對得上的只擋格式

const POOL = fc.oneof(
  fc.record({ kind: fc.constant('xp'), amount: fc.integer({ min: 0, max: 40 }) }),
  fc.record({ kind: fc.constant('insight'), amount: fc.integer({ min: -10, max: 20 }) }),
  fc.record({ kind: fc.constantFrom('owed', 'owed_to_pc'), who: fc.constant(NPC), size: fc.constantFrom('small', 'mid', 'big') }),
  fc.record({ kind: fc.constant('bridge'), param: fc.constantFrom('sensitivity', 'tolerance', 'craving', 'docility'), amount: fc.integer({ min: -4, max: 4 }).filter((x) => x !== 0) }),
  fc.record({ kind: fc.constant('bill'), item: fc.constant('rent'), amount: fc.integer({ min: -200, max: 200 }).filter((x) => x !== 0) }),
  fc.record({ kind: fc.constant('bill'), name: fc.constant('保護費'), amount: fc.integer({ min: 1, max: 400 }), weeks: fc.integer({ min: 1, max: 10 }), pay: fc.constantFrom('cred', 'cash', 'either') }),
  fc.record({ kind: fc.constant('roster_add'), who: fc.constant(NPC) }),
)

function snapshot(g: G) {
  const bills = g.state.ext.bills as { tweaks?: Record<string, number>; extras?: Array<{ amount: number; weeks: number }> } | undefined
  return {
    xp: xpOf(g), insight: meterOf(g.k, g.state, 'insight'), bridge: { ...bridgeOf(g) },
    owed: favorsOf(g).owed_by_pc.length, owedToPc: favorsOf(g).owed_to_pc.length,
    tweak: bills?.tweaks?.rent ?? 0, extra: (bills?.extras ?? []).reduce((s, x) => s + x.amount * x.weeks, 0), candidates: candidatesOf(g).length,
  }
}

describe('邊界：性質（一件事合計）', () => {
  it('AI 的三條路：任意 1～6 筆、任意順序，xp ≤ 10、體悟 0～+5、兩個方向的人情各最多 1 個、橋參數往上與往下各最多 1 點、房租加減在 ±50、新項目總額 ≤ 120、候選最多 1 位；提交不會失敗、不變式成立', async () => {
    const samples = fc.sample(fc.tuple(fc.constantFrom(...CAPPED), fc.array(POOL, { minLength: 1, maxLength: 6 })), { numRuns: 60, seed: 3405 })
    for (const [route, fx] of samples) {
      const g = fresh()
      const before = snapshot(g)
      const { violations, result: r } = await observed(g, () => apply(g, route, fx as never))
      expect(r.errors, JSON.stringify(fx)).toEqual([])
      expect(violations).toEqual([])
      const after = snapshot(g)
      const ups = Object.keys(after.bridge).map((p) => after.bridge[p]! - before.bridge[p]!)
      expect(after.xp - before.xp).toBeLessThanOrEqual(10)
      expect(after.insight - before.insight).toBeGreaterThanOrEqual(0)
      expect(after.insight - before.insight).toBeLessThanOrEqual(5)
      // owed 與 owed_to_pc 是表上的兩列，各自一件事一個
      expect(after.owed - before.owed).toBeLessThanOrEqual(1)
      expect(after.owedToPc - before.owedToPc).toBeLessThanOrEqual(1)
      expect(ups.filter((d) => d > 0).reduce((s, d) => s + d, 0)).toBeLessThanOrEqual(1)
      expect(ups.filter((d) => d < 0).reduce((s, d) => s - d, 0)).toBeLessThanOrEqual(1)
      expect(Math.abs(after.tweak)).toBeLessThanOrEqual(50)
      expect(after.extra - before.extra).toBeLessThanOrEqual(120)
      expect(after.candidates - before.candidates).toBeLessThanOrEqual(1)
      for (const c of r.clamps) expect(PLAIN(c.notice), c.notice).toBe(true)
    }
  })

  it('關而且 asked 對得上：沒有上限（xp、體悟、人情、橋參數、新項目照寫的；橋參數只夾在 0～100）；和內建的結果一樣，只差在房租加減（B034）', () => {
    const pool = fc.array(POOL.filter((e) => !(e.kind === 'bill' && 'item' in e)), { minLength: 1, maxLength: 6 })
    fc.assert(fc.property(pool, (fx) => {
      const a = fresh(); const b = fresh()
      const ra = apply(a, 'off', fx as never); const rb = apply(b, 'builtin', fx as never)
      expect(ra.errors).toEqual(rb.errors)
      expect(snapshot(a)).toEqual(snapshot(b))
    }), { numRuns: 40, seed: 2025 })
  })
})

// ---------------------------------------------------------------------------------------------
// 5. 內容資料的年齡（AI_TASKS 2.5 節第二條，使用者 2026-11-25；不看開關）

describe('邊界 AI_TASKS 2.5：年齡低於 18 一律擋下', () => {
  const kid = (g: G, age: number, id = 'npc_tw_newface') => ({ ...clone(g.state.actors.pc!), id, name: '新面孔', role: 'npc', age })
  const add = (g: G, actor: unknown) => g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: [{ op: 'actor.add', actor }], outcome: { result: 'ok', summary: '測試' } } as never)

  it('提交：17（下限−1）、0、−1、17.5 擋，報告整份不收、狀態不動；18（下限）、200、安全整數的最大值收', () => {
    expect(MIN_AGE).toBe(18)
    for (const age of [17, 0, -1, 17.5]) {
      const g = fresh(); const before = clone(g.state)
      expect(() => add(g, kid(g, age)), String(age)).toThrow(/成年/)
      expect(g.state).toEqual(before)
    }
    for (const age of [18, 200, Number.MAX_SAFE_INTEGER]) { const g = fresh(); add(g, kid(g, age)); expect(g.state.actors.npc_tw_newface!.age).toBe(age) }
  })

  it('性質：任何整數年齡，提交收不收只看是不是 18 以上；「玩家要求的結果也夾值」開或關都一樣', () => {
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), fc.boolean(), (age, clampAsked) => {
      const { game: g } = makeCityGame({ ai: { ai: 1, clamp_asked: clampAsked ? 1 : 0 }, fake: true })
      let ok = true
      try { add(g, kid(g, age)) } catch { ok = false }
      expect(ok).toBe(age >= MIN_AGE)
    }), { numRuns: 60, seed: 1125 })
  })

  it('報告裡任何深度的 age（不只角色）低於 18 都整份不收；讀檔時存檔裡有 17 歲的人整筆不讀（不自動改成 18）', () => {
    const g = fresh()
    expect(() => g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試', extra: { who: { age: 17 } } } } as never)).toThrow(/18/)
    const raw = JSON.parse(g.save('manual', '2026-11-26T00:00:00Z', 't'))
    const actors = (raw.state ?? raw.file?.state).actors
    actors[NPC].age = 17
    const before = clone(g.state)
    expect(g.load(JSON.stringify(raw))).toMatch(/18/)
    expect(g.state).toEqual(before)
    actors[NPC].age = 18
    expect(g.load(JSON.stringify(raw))).toBeNull()
  })

  it('匯入的內容：npc 的 age 17 擋（整包不載）、18 收；年齡不是整數也擋', () => {
    const base = makeCityGame().game.k.content.list<{ id: string } & Record<string, unknown>>('npc').find((n) => n.id === NPC)!
    for (const [age, ok] of [[17, false], [18, true], [17.5, false], ['20', false]] as const) {
      const load = () => makeWorldGame({ content: [{ id: 'import', content: { npc: [{ ...clone(base), id: 'npc_tw_import', age } as never] } }] })
      if (ok) expect(load, String(age)).not.toThrow()
      else expect(load, String(age)).toThrow(/age/)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 6. 整條自由行動的鏈：假的服務商送對抗性的回應（AI_TASKS 2.5、2.6、4.1、5.3）

/** 一個測試自己的行動種類：參考範圍是歷練點 +2（成功）、+4（大成功）。 */
const PLEAD: ActionKindDef = {
  id: 'plead', owner: 'test', name: '求情', attr: 'charm', skill: 'negotiate', dc: 'easy', minutes: 60, maxMinutes: 120, reportKind: 'action',
  hint: ({ degree }) => (degree === 'critical' ? [{ kind: 'xp', amount: 4 }] : degree === 'success' ? [{ kind: 'xp', amount: 2 }] : []),
}
const pleadFeature: Feature = { id: 'test_plead', install: (k) => k.actions.register(PLEAD) }
const ACE = { ...CITY_PC, attrs: { charm: 20, body: 12 }, skills: { negotiate: 6 } }
const judgeOk = (over: Record<string, unknown> = {}) => (req: AiRequest) => {
  const i = inputOf<{ roll: { degree: string }; ref_dc: number }>(req)
  return { json: { degree: i.roll.degree, dc: i.ref_dc, reason: '房東嘆了口氣。', twist: '', minutes: 60, ...over } }
}
const city = (o: Parameters<typeof makeCityGame>[0] = {}) => {
  const t = makeCityGame({ features: [pleadFeature], pc: ACE, ...o })
  const r = t.game.k.effects.resolve([{ kind: 'meet', npc: NPC }], effectCtx(t.game.k, t.game.state, { source: 'builtin' }))
  t.game.commit({ kind: 'event', action: 'event.test', location: clone(t.game.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
  return t
}
const said = (more: Record<string, unknown>) => ({ from: { source: 'player', quote: ASKED }, ...more })
/** 一份超出每件上限的回報：歷練點 30、大人情、橋參數 +3、體悟 +9、兩位候選 */
const OVER = (asked?: string) => [
  { kind: 'xp', amount: 30 }, { kind: 'owed_to_pc', who: NPC, size: 'big' }, { kind: 'bridge', param: 'craving', amount: 3 }, { kind: 'insight', amount: 9 }, { kind: 'roster_add', who: NPC },
].map((e) => said(asked === undefined ? e : { ...e, asked }))

describe('邊界：整條自由行動的鏈 × M4 的效果 × 「玩家要求的結果也夾值」開與關', () => {
  it('開：超出上限的一份回報，每一樣都夾到上限，回報標「有夾值」、細節列原本與夾過的值、提醒是白話；寫正文收到夾過的值；不重試', async () => {
    const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: 1 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: OVER(ASKED) } }] } } })
    const { run, reports, status } = await g.act({ kind: 'plead', text: TEXT })
    expect(status).toBe('applied')
    expect(xpOf(g)).toBe(10)
    expect(favorsOf(g).owed_to_pc).toHaveLength(0)
    expect(bridgeOf(g).craving).toBe(31)
    expect(meterOf(g.k, g.state, 'insight')).toBe(5)
    expect(run.step('reward').marks).toContain('clamped')
    expect(run.step('reward').clamps!.map((c) => [c.from, c.to])).toEqual(expect.arrayContaining([[30, 10], [3, 1], [9, 5]]))
    for (const c of reports[0]!.clamps!) expect(PLAIN(c.notice), c.notice).toBe(true)
    const results = sectionOf(fake!.requestsFor('narrate')[0]!, 'results')!
    expect(results).toContain('+10')
    expect(results).not.toMatch(/\+30|\+9\b|\+3\b/)
    expect(fake!.requestsFor('reward')).toHaveLength(1)
  })

  it('關、asked 對得上：同一份照給（歷練點 30、大人情、橋參數 +3、體悟 +9），不留夾值的記號', async () => {
    const { game: g } = city({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: OVER(ASKED) } }] } } })
    const { run, reports } = await g.act({ kind: 'plead', text: TEXT })
    expect(xpOf(g)).toBe(30)
    expect(favorsOf(g).owed_to_pc).toHaveLength(1)
    expect(bridgeOf(g).craving).toBe(33)
    expect(meterOf(g.k, g.state, 'insight')).toBe(9)
    expect(run.step('reward').marks).toEqual([])
    expect(reports[0]!.clamps).toBeUndefined()
  })

  it('關、asked 對不上（或空白、或沒附）：當成 AI 自己生成的，和開著一模一樣；不算失敗、不重試', async () => {
    const want = async (clampAsked: number, asked?: string) => {
      const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: clampAsked }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: OVER(asked) } }] } } })
      const { run } = await g.act({ kind: 'plead', text: TEXT })
      expect(run.step('reward').status).toBe('done')
      expect(fake!.requestsFor('reward')).toHaveLength(1)
      return { xp: xpOf(g), bridge: bridgeOf(g), insight: meterOf(g.k, g.state, 'insight'), favors: favorsOf(g).owed_to_pc.length }
    }
    const on = await want(1, ASKED)
    for (const asked of [NOT_SAID, '   ', undefined]) {
      expect(askedMatches(asked, TEXT)).toBe(false)
      expect(await want(0, asked), String(asked)).toEqual(on)
    }
  })

  it('不存在的 id 與少欄位（傾向標籤查不到、橋參數名字錯、人情少了對象、新項目少了週數）：驗證不過算失敗，自動重試帶 <previous_error>（引用欄位的路徑、不帶原文）；都失敗後走退路，狀態只動參考範圍的退路', async () => {
    const bads = [
      { kind: 'tendency', tag: 'tg_nope' }, { kind: 'bridge', param: 'nope', amount: 1 }, { kind: 'owed', size: 'small' }, { kind: 'bill', name: '保護費', amount: 50, pay: 'cash' },
    ]
    for (const clampAsked of [1, 0]) {
      for (const bad of bads) {
        const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: clampAsked, retry: { reward: 1 } }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [said({ ...bad, asked: ASKED })] } }, { json: { items: [said({ ...bad, asked: ASKED })] } }] } } })
        const before = clone(g.state.actors.pc!.ext.bridge)
        const { result, violations } = await observed(g, () => g.act({ kind: 'plead', text: TEXT }))
        const reqs = fake!.requestsFor('reward')
        expect(reqs, JSON.stringify(bad)).toHaveLength(2)
        const prev = sectionOf(reqs[1]!, 'previous_error')!
        expect(prev, JSON.stringify(bad)).toMatch(/reward\.items\[0\]/)
        expect(prev).not.toContain('"from"')
        expect(result.run.step('reward').status, JSON.stringify(bad)).toBe('fallback')
        expect(violations).toEqual([])
        expect(g.state.actors.pc!.ext.bridge).toEqual(before)
        expect(xpOf(g)).toBeLessThanOrEqual(4)
      }
    }
  })

  for (const clampAsked of [1, 0]) {
    it(`${clampAsked ? '開' : '關'}：十種對抗模式（壞掉的 JSON、超出上限、不存在的 id、少欄位、多欄位、拒絕、逾時、串流中斷、asked 對不上、少交 <covered>）只打 reward：狀態在上限內、不變式成立、存讀一樣`, async () => {
      for (const mode of ADVERSARIAL_MODES) {
        const { game: g } = city({ ai: { ai: 1, clamp_asked: clampAsked }, idleTimeoutMs: 30, fake: { byTask: { judge: [judgeOk()] }, adversarial: { mode, tasks: ['reward'] } } })
        const { result, violations } = await observed(g, () => g.act({ kind: 'plead', text: TEXT }, { autoRules: true }))
        expect(violations, mode).toEqual([])
        expect(result.status, mode).toBe('applied')
        // 對抗模式交的 asked 都對不上玩家的輸入：關著也照夾；退路照參考範圍（最多大成功的 +4）
        expect(xpOf(g), mode).toBeLessThanOrEqual(10)
        expect(meterOf(g.k, g.state, 'insight'), mode).toBeLessThanOrEqual(5)
        for (const s of result.run.steps.filter((x) => x.kind === 'ai' && x.status !== 'skipped')) expect(['done', 'fallback'], `${mode} ${s.id}`).toContain(s.status)
        const saved = g.save('manual', 't')
        const before = clone(g.state)
        expect(g.load(saved), mode).toBeNull()
        expect(g.state, mode).toEqual(before)
      }
    })
  }

  it('拒絕（AI_TASKS 2.6）：retry = 3 也只送一次，這一步標成失敗、鏈停下來等玩家，狀態不動；按「用規則代替」走退路', async () => {
    const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: 0, retry: { reward: 3 } }, fake: { byTask: { judge: [judgeOk()] }, adversarial: { mode: 'refusal', tasks: ['reward'] } } })
    const before = clone(g.state)
    const { status, run } = await g.act({ kind: 'plead', text: TEXT })
    expect(fake!.requestsFor('reward')).toHaveLength(1)
    expect(status).not.toBe('applied')
    expect(run.step('reward').status).toBe('failed')
    expect(g.state.actors.pc).toEqual(before.actors.pc)
    expect(g.state.meters).toEqual(before.meters)
  })

  it('少交 <covered>：只標記號，不算失敗、不重試、不改結果（歷練點照夾過的值）', async () => {
    const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: 1 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [said({ kind: 'xp', amount: 30, asked: ASKED })] } }] }, adversarial: { mode: 'no_covered', tasks: ['narrate'] } } })
    const { run, status } = await g.act({ kind: 'plead', text: TEXT })
    expect(status).toBe('applied')
    expect(xpOf(g)).toBe(10)
    expect(run.step('text').status).toBe('done')
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
  })
})
