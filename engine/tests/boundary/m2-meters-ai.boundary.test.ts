// 邊界測試：M2 的量表 × AI 給的效果（EVENTS 2.4 節的上限表 × AI_TASKS 2.5 節的驗證與夾值）。cpp-tester-boundary 寫的；邊界表在這份測試的回報裡。
//
// 量表與它們在 EVENTS 2.4 節的「每件」上限：敵對值 ±10、好感 ±5（勢力）、親密度 ±8、忠誠 ±10（個人）、豔名 ±5（這一區）、街頭信譽 ±3。
// 範圍：敵對值、好感、忠誠、豔名、信譽 0～100；親密度 −100～100（dev/adr/0016 第三節的表；FACTIONS 第 5、6 節；NPC_SYSTEM 第 7 節、10.4 節）。
// 每一種都測：上限、上限+1、−上限、−上限−1、零、範圍的下限與下限−1、上限與上限+1、最大組合（拆成幾筆）；
// 「玩家要求的結果也夾值」開與關兩條路都走（關著時只有 asked 對得上的免夾，格式的底線照擋）。
// 整條自由行動的鏈用假的服務商送對抗性的回應：超出上限、不存在的勢力、少了 key、amount 不是整數、壞掉的 JSON、拒絕、逾時、asked 對不上。
//
// 已知和規格對不上、另外寫了照預期失敗的測試（engine/tests/pending/）：體悟的上限（B016）、警戒不在副本裡也收（B018）、忠誠給不在名冊上的人（B019）。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ActionKindDef, AiRequest, EffectCtx, Feature, GameState } from '../../src'
import { askedMatches, clone, effectCtx, inputOf, meterOf, sectionOf } from '../../src'
import { RUNNER, makeCityGame, makeCommissionGame, observed } from '../../src/testkit'

// ---------------------------------------------------------------------------------------------
// 共用

const TEXT = '我去野良的攤子幫忙，跟他們說我想變成自己人'
const ASKED = '想變成自己人'
const NOT_SAID = '玩家沒有說過的一句話'

type G = ReturnType<typeof makeCommissionGame>['game']

interface MeterRow {
  kind: string
  /** 寫在效果上的 key；不分對象的寫 undefined */
  key: string | undefined
  /** 量表記的鍵（不分對象的是 _） */
  at: string
  cap: number
  min: number
  max: number
  start: number
  spec: string
}

/** M2 的六種量表（EVENTS 2.4 節的上限表）。忠誠要是名冊上的人：用委託情境裡的行者。 */
const METERS: MeterRow[] = [
  { kind: 'hostility', key: 'f_gang', at: 'f_gang', cap: 10, min: 0, max: 100, start: 0, spec: 'EVENTS 2.4（±10）；FACTIONS 6' },
  { kind: 'favor', key: 'f_gang', at: 'f_gang', cap: 5, min: 0, max: 100, start: 10, spec: 'EVENTS 2.4（±5）；FACTIONS 5' },
  { kind: 'affinity', key: 'npc_tw_friend', at: 'npc_tw_friend', cap: 8, min: -100, max: 100, start: 0, spec: 'EVENTS 2.4（±8）；NPC_SYSTEM 7' },
  { kind: 'loyalty', key: RUNNER, at: RUNNER, cap: 10, min: 0, max: 100, start: 30, spec: 'EVENTS 2.4（±10）；NPC_SYSTEM 10.4' },
  { kind: 'fame', key: 'tw_hive', at: 'tw_hive', cap: 5, min: 0, max: 100, start: 0, spec: 'EVENTS 2.4（這一區 ±5）；LEWD_SYSTEM 5' },
  { kind: 'rep', key: undefined, at: '_', cap: 3, min: 0, max: 100, start: 0, spec: 'EVENTS 2.4（±3）；CORE_RULES 8' },
]

/** 一局委託情境（人在蜂巢的市場、名冊上有行者），只建一次的話各個測試會互相影響，所以每次都建新的。 */
const fresh = (): G => makeCommissionGame().game

const fx = (m: MeterRow, amount: unknown, more: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ kind: m.kind, ...(m.key !== undefined ? { key: m.key } : {}), amount, ...more })

const ctx = (g: G, source: EffectCtx['source'], clampAsked = true, playerInput = TEXT): EffectCtx =>
  effectCtx(g.k, g.state, { source, clampAsked, playerInput })

/** 直接放一個值（不經報告）：測「已經在邊界上」用。 */
const put = (g: G, m: MeterRow, v: number): void => { g.state.meters[m.kind] = { ...g.state.meters[m.kind], [m.at]: v } }
const read = (g: G, m: MeterRow): number => meterOf(g.k, g.state, m.kind, m.key)

/** 解析並提交（和事件一樣的路）；回傳解析的結果。 */
function apply(g: G, effects: unknown[], c: EffectCtx) {
  const r = g.k.effects.resolve(effects, c)
  if (r.errors.length === 0 && r.changes.length > 0) {
    g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '測試' } })
  }
  return r
}

/** 夾值的提醒是白話：不出現欄位名稱（英文的 id、路徑）與硬規則的編號。 */
const PLAIN = (notice: string) => !/[A-Za-z_]{2,}|H\d+/.test(notice)
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---------------------------------------------------------------------------------------------
// 1. 每一種量表的上限（EVENTS 2.4 節）：AI 給的

describe('邊界 EVENTS 2.4：M2 量表的每件上限（AI 給的）', () => {
  for (const m of METERS) {
    describe(`${m.kind}（${m.spec}）`, () => {
      it(`起始值 ${m.start}；上限 ±${m.cap} 剛好不夾；±${m.cap + 1} 夾回 ±${m.cap}，留記號、提醒是白話`, () => {
        const mid = Math.round((m.min + m.max) / 2)
        for (const [amount, want, clamped] of [[m.cap, m.cap, false], [m.cap + 1, m.cap, true], [-m.cap, -m.cap, false], [-m.cap - 1, -m.cap, true], [1, 1, false], [-1, -1, false]] as const) {
          const g = fresh()
          expect(read(g, m), '起始值').toBe(m.start)
          put(g, m, mid)
          const r = apply(g, [fx(m, amount)], ctx(g, 'ai'))
          expect(r.errors, `${amount}`).toEqual([])
          expect(read(g, m) - mid, `${amount}`).toBe(want)
          expect(r.clamps.length > 0, `${amount} 有沒有夾值的記號`).toBe(clamped)
          for (const c of r.clamps) {
            expect(c).toMatchObject({ from: amount, to: want })
            expect(PLAIN(c.notice), c.notice).toBe(true)
          }
        }
      })

      it('零：不產生變更、不留一行、不算錯；空的一批也一樣', () => {
        const g = fresh()
        const before = clone(g.state)
        expect(g.k.effects.resolve([fx(m, 0)], ctx(g, 'ai'))).toMatchObject({ errors: [], changes: [], lines: [], clamps: [] })
        expect(g.k.effects.resolve([], ctx(g, 'ai'))).toMatchObject({ errors: [], changes: [], lines: [], clamps: [] })
        expect(g.state).toEqual(before)
      })

      it(`範圍 ${m.min}～${m.max}：已經在上限時加的整筆拿掉、不提醒（到頭是常態）；在下限時減的一樣；上限−1 加 ${m.cap} 只動 1`, () => {
        for (const [at, amount, want] of [[m.max, m.cap, 0], [m.min, -m.cap, 0], [m.max - 1, m.cap, 1], [m.min + 1, -m.cap, -1]] as const) {
          const g = fresh()
          put(g, m, at)
          const r = apply(g, [fx(m, amount)], ctx(g, 'ai'))
          expect(r.errors).toEqual([])
          expect(read(g, m) - at, `從 ${at} 給 ${amount}`).toBe(want)
          expect(r.clamps, `從 ${at} 給 ${amount}`).toEqual([])
          if (want === 0) expect(r.changes).toEqual([])
        }
      })

      it('內建的照寫的算（不受上限管），只夾在範圍：下限−1、上限+1 都落回範圍', () => {
        const g = fresh()
        apply(g, [fx(m, m.max - m.min + 50)], ctx(g, 'builtin'))
        expect(read(g, m)).toBe(m.max)
        apply(g, [fx(m, -(m.max - m.min) - 50)], ctx(g, 'builtin'))
        expect(read(g, m)).toBe(m.min)
        apply(g, [fx(m, m.cap * 3)], ctx(g, 'builtin'))
        expect(read(g, m)).toBe(m.min + m.cap * 3)
      })

      it('性質（開／AI）：任意拆成 1～6 筆、任意起始值，這一件事的淨變化不超過 ±上限，結果在範圍內；提交不會失敗', () => {
        fc.assert(fc.property(
          fc.integer({ min: m.min, max: m.max }),
          fc.array(fc.integer({ min: -3 * m.cap, max: 3 * m.cap }).filter((x) => x !== 0), { minLength: 1, maxLength: 6 }),
          fc.constantFrom<EffectCtx['source']>('ai', 'player'),
          (start, amounts, source) => {
            const g = fresh()
            put(g, m, start)
            const r = apply(g, amounts.map((a) => fx(m, a, source === 'player' ? { asked: ASKED } : {})), ctx(g, source, true))
            const end = read(g, m)
            return r.errors.length === 0 && end >= m.min && end <= m.max && Math.abs(end - start) <= m.cap
          },
        ), { numRuns: 40 })
      })

      it('性質（內建；關著而且 asked 對得上）：一筆一筆照寫的加，每一筆之後夾在範圍內，沒有上限；兩條路結果一樣', () => {
        fc.assert(fc.property(
          fc.integer({ min: m.min, max: m.max }),
          fc.array(fc.integer({ min: -60, max: 60 }).filter((x) => x !== 0), { minLength: 1, maxLength: 6 }),
          (start, amounts) => {
            let want = start
            for (const a of amounts) want = clampTo(want + a, m.min, m.max)
            const b = fresh()
            put(b, m, start)
            apply(b, amounts.map((a) => fx(m, a)), ctx(b, 'builtin'))
            const p = fresh()
            put(p, m, start)
            const r = apply(p, amounts.map((a) => fx(m, a, { asked: ASKED })), ctx(p, 'player', false))
            return read(b, m) === want && read(p, m) === want && r.clamps.length === 0
          },
        ), { numRuns: 40 })
      })

      it('性質（關，沒附 asked 或對不上）：和開著一模一樣（當成 AI 自己生成的）', () => {
        fc.assert(fc.property(
          fc.integer({ min: m.min, max: m.max }),
          fc.array(fc.integer({ min: -3 * m.cap, max: 3 * m.cap }).filter((x) => x !== 0), { minLength: 1, maxLength: 4 }),
          fc.constantFrom<string | undefined>(undefined, NOT_SAID, '', '   '),
          (start, amounts, asked) => {
            const on = fresh()
            put(on, m, start)
            const a = apply(on, amounts.map((x) => fx(m, x)), ctx(on, 'player', true))
            const off = fresh()
            put(off, m, start)
            const b = apply(off, amounts.map((x) => fx(m, x, asked !== undefined ? { asked } : {})), ctx(off, 'player', false))
            return read(on, m) === read(off, m) && JSON.stringify(a.changes) === JSON.stringify(b.changes) && a.clamps.length === b.clamps.length
          },
        ), { numRuns: 30 })
      })

      it('格式的底線（關、asked 對得上也照擋）：小數、字串、非數、無限、超過安全整數都是格式錯誤，整批不收', () => {
        for (const bad of [2.5, '5', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2, null, undefined, true]) {
          const g = fresh()
          const before = clone(g.state)
          const r = apply(g, [fx(m, bad, { asked: ASKED }), fx(m, 1, { asked: ASKED })], ctx(g, 'player', false))
          expect(r.errors.length, String(bad)).toBeGreaterThan(0)
          expect(r.changes, String(bad)).toEqual([])
          expect(g.state, String(bad)).toEqual(before)
        }
      })

      it('最大組合（關、asked 對得上）：安全整數的最大值照給，只夾在範圍內（不溢位）', () => {
        const g = fresh()
        const r = apply(g, [fx(m, Number.MAX_SAFE_INTEGER, { asked: ASKED }), fx(m, Number.MAX_SAFE_INTEGER, { asked: ASKED })], ctx(g, 'player', false))
        expect(r.errors).toEqual([])
        expect(r.clamps).toEqual([])
        expect(read(g, m)).toBe(m.max)
        apply(g, [fx(m, -Number.MAX_SAFE_INTEGER, { asked: ASKED })], ctx(g, 'player', false))
        expect(read(g, m)).toBe(m.min)
      })
    })
  }

  it('分對象的量表沒寫 key、key 查不到、key 是 __proto__：格式錯誤；不分對象的寫了別的 key 也是（不管開關）', () => {
    const g = fresh()
    for (const clampAsked of [true, false]) {
      const c = ctx(g, 'player', clampAsked)
      expect(g.k.effects.resolve([{ kind: 'favor', amount: 3, asked: ASKED }], c).errors.join('')).toMatch(/key 要寫明/)
      expect(g.k.effects.resolve([{ kind: 'hostility', key: 'f_nobody', amount: 3, asked: ASKED }], c).errors.join('')).toMatch(/查不到 f_nobody/)
      expect(g.k.effects.resolve([{ kind: 'affinity', key: 'npc_nobody', amount: 3, asked: ASKED }], c).errors.join('')).toMatch(/npc_nobody/)
      expect(g.k.effects.resolve([{ kind: 'fame', key: 'nowhere', amount: 3, asked: ASKED }], c).errors.join('')).toMatch(/查不到 nowhere/)
      expect(g.k.effects.resolve([{ kind: 'favor', key: '__proto__', amount: 3, asked: ASKED }], c).errors.join('')).toMatch(/key/)
      expect(g.k.effects.resolve([{ kind: 'rep', key: 'f_gang', amount: 1, asked: ASKED }], c).errors.join('')).toMatch(/key 只能是 _/)
    }
  })

  it('每個勢力、每個人各記各的：同一件事給兩個勢力各 +5，兩個都進去；同一個勢力兩筆 +5 合計夾成 +5', () => {
    const g = fresh()
    const r = apply(g, [{ kind: 'favor', key: 'f_gang', amount: 5 }, { kind: 'favor', key: 'f_corp', amount: 5 }, { kind: 'favor', key: 'f_gang', amount: 5 }], ctx(g, 'ai'))
    expect(meterOf(g.k, g.state, 'favor', 'f_gang')).toBe(15)
    expect(meterOf(g.k, g.state, 'favor', 'f_corp')).toBe(15)
    expect(r.clamps).toHaveLength(1)
    expect(r.clamps[0]!.notice).toMatch(/好感/)
  })

  it('扣不到的不能拿來抵：好感 2 的時候 AI 先 −5（實際 −2）再 +5，淨變化不超過 +5 也不低於 −5，結果在 0～100', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), fc.array(fc.integer({ min: -20, max: 20 }).filter((x) => x !== 0), { minLength: 2, maxLength: 6 }), (start, amounts) => {
      const g = fresh()
      put(g, METERS[1]!, start)
      apply(g, amounts.map((a) => ({ kind: 'favor', key: 'f_gang', amount: a })), ctx(g, 'ai'))
      const end = meterOf(g.k, g.state, 'favor', 'f_gang')
      return end >= 0 && end <= 100 && end - start <= 5 && end - start >= -5
    }), { numRuns: 60 })
  })

  it('敵對值的下限：AI 往下給，最多降到下限（30）；關著而且 asked 對得上也降不到下限以下（下限是範圍，不是上限）', () => {
    for (const [source, clampAsked] of [['ai', true], ['player', false]] as const) {
      const g = fresh()
      g.commit({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes: [{ op: 'meter', kind: 'hostility_floor', key: 'f_gang', set: 30 }, { op: 'meter', kind: 'hostility', key: 'f_gang', set: 35 }], outcome: { result: 'ok', summary: '測試' } })
      apply(g, [{ kind: 'hostility', key: 'f_gang', amount: -10, asked: ASKED }], ctx(g, source, clampAsked))
      expect(meterOf(g.k, g.state, 'hostility', 'f_gang'), source).toBe(30)
      apply(g, [{ kind: 'hostility', key: 'f_gang', amount: -1, asked: ASKED }], ctx(g, source, clampAsked))
      expect(meterOf(g.k, g.state, 'hostility', 'f_gang'), source).toBe(30)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 2. 整條自由行動的鏈：假的服務商送對抗性的回應（AI_TASKS 2.5、4.1、5.3、2.6）

/** 一個測試自己的行動種類：參考範圍是好感 +2（成功）、+4（大成功）。退路沒有自己的規則表：照參考範圍的一半（AI 的來源）。 */
const SCHMOOZE: ActionKindDef = {
  id: 'schmooze', owner: 'test', name: '攀交情', attr: 'charm', skill: 'negotiate', dc: 'easy', minutes: 60, maxMinutes: 120, reportKind: 'action',
  hint: ({ degree }) => (degree === 'critical' ? [{ kind: 'favor', key: 'f_gang', amount: 4 }] : degree === 'success' ? [{ kind: 'favor', key: 'f_gang', amount: 2 }] : []),
}
const schmoozeFeature: Feature = { id: 'test_schmooze', install: (k) => k.actions.register(SCHMOOZE) }

const judgeOk = (over: Record<string, unknown> = {}) => (req: AiRequest) => {
  const i = inputOf<{ roll: { degree: string }; ref_dc: number }>(req)
  return { json: { degree: i.roll.degree, dc: i.ref_dc, reason: '野良的人看了你一眼。', twist: '他們把你的名字記下來了', minutes: 60, ...over } }
}
const ACE = { attrs: { charm: 20, body: 12 }, skills: { negotiate: 6 }, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } }
const city = (o: Parameters<typeof makeCityGame>[0] = {}) => makeCityGame({ features: [schmoozeFeature], pc: ACE, ...o })
const item = (more: Record<string, unknown>) => ({ from: { source: 'player', quote: ASKED }, ...more })
const favorOf = (s: GameState, k: ReturnType<typeof city>['game']['k'], f = 'f_gang') => meterOf(k, s, 'favor', f)

describe('邊界：自由行動的鏈 × 量表的效果 × 「玩家要求的結果也夾值」開與關', () => {
  it('開：玩家要了好感 +30（asked 對得上）→ 只拿 +5，回報標「有夾值」、細節列原本與夾過的值；寫正文收到夾過的值', async () => {
    const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: 1 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [item({ kind: 'favor', key: 'f_gang', amount: 30, asked: ASKED })] } }] } } })
    const { run, reports, status } = await g.act({ kind: 'schmooze', text: TEXT })
    expect(status).toBe('applied')
    expect(favorOf(g.state, g.k)).toBe(15)
    expect(run.step('reward').marks).toContain('clamped')
    expect(run.step('reward').clamps![0]).toMatchObject({ from: 30, to: 5 })
    for (const c of reports[0]!.clamps!) expect(PLAIN(c.notice), c.notice).toBe(true)
    const results = sectionOf(fake!.requestsFor('narrate')[0]!, 'results')!
    expect(results).toContain('+5')
    expect(results).not.toContain('30')
    // 夾值不算出錯：不重試
    expect(fake!.requestsFor('reward')).toHaveLength(1)
  })

  it('關、asked 對得上：好感 +30 照給（40），不留夾值的記號；+500 也照給但落在範圍（100），不提醒', async () => {
    for (const [amount, want] of [[30, 40], [500, 100]] as const) {
      const { game: g } = city({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [item({ kind: 'favor', key: 'f_gang', amount, asked: ASKED })] } }] } } })
      const { run, reports } = await g.act({ kind: 'schmooze', text: TEXT })
      expect(favorOf(g.state, g.k), `${amount}`).toBe(want)
      expect(run.step('reward').marks, `${amount}`).toEqual([])
      expect(reports[0]!.clamps, `${amount}`).toBeUndefined()
    }
  })

  it('關、asked 對不上（或空白、或沒附）：當成 AI 自己生成的，照 ±5 夾、提醒；不算失敗、不重試', async () => {
    for (const asked of [NOT_SAID, '  ', undefined]) {
      expect(askedMatches(asked, TEXT)).toBe(false)
      const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [item({ kind: 'favor', key: 'f_gang', amount: 30, ...(asked !== undefined ? { asked } : {}) })] } }] } } })
      const { run } = await g.act({ kind: 'schmooze', text: TEXT })
      expect(favorOf(g.state, g.k), String(asked)).toBe(15)
      expect(run.step('reward').status).toBe('done')
      expect(run.step('reward').marks).toContain('clamped')
      expect(fake!.requestsFor('reward')).toHaveLength(1)
    }
  })

  it('一份回報裡混著：玩家明說要的（關、對得上）不夾也不算進合計，其餘的同一個勢力合計照 ±5 夾', async () => {
    const items = [
      item({ kind: 'favor', key: 'f_gang', amount: 20, asked: ASKED }),
      { kind: 'favor', key: 'f_gang', amount: 4, from: { source: 'degree' } },
      { kind: 'favor', key: 'f_gang', amount: 4, from: { source: 'degree' } },
      { kind: 'hostility', key: 'f_corp', amount: 25, from: { source: 'degree' } },
    ]
    const { game: g } = city({ ai: { ai: 1, clamp_asked: 0 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items } }] } } })
    await g.act({ kind: 'schmooze', text: TEXT })
    expect(favorOf(g.state, g.k)).toBe(10 + 20 + 5)
    expect(meterOf(g.k, g.state, 'hostility', 'f_corp')).toBe(10)
  })

  it('不存在的勢力、少了 key、amount 是小數或字串：驗證不過算失敗，自動重試帶 <previous_error>（引用欄位的路徑）；都失敗後走退路（參考範圍的一半）', async () => {
    const bads = [
      { kind: 'favor', key: 'f_nobody', amount: 3 },
      { kind: 'favor', amount: 3 },
      { kind: 'favor', key: 'f_gang', amount: 2.5 },
      { kind: 'favor', key: 'f_gang', amount: '3' },
      { kind: 'loyalty', key: 'npc_nobody', amount: 3 },
    ]
    for (const bad of bads) {
      for (const clampAsked of [1, 0]) {
        const reply = { json: { items: [item({ ...bad, asked: ASKED })] } }
        const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: clampAsked, retry: { reward: 1 } }, fake: { byTask: { judge: [judgeOk({ degree: 'success' })], reward: [reply, reply] } } })
        const before = favorOf(g.state, g.k)
        const { run, status } = await g.act({ kind: 'schmooze', text: TEXT })
        const label = `${JSON.stringify(bad)} 開關 ${clampAsked}`
        expect(status, label).toBe('applied')
        const reqs = fake!.requestsFor('reward')
        expect(reqs, label).toHaveLength(2)
        expect(sectionOf(reqs[1]!, 'previous_error'), label).toMatch(/reward\.items\[0\]/)
        expect(run.step('reward').status, label).toBe('fallback')
        // 退路：參考範圍（成功：好感 +2）的一半 = +1；判定的成功程度照骰值，強主角幾乎一定成功，這裡只確認沒有超過參考範圍
        const gained = favorOf(g.state, g.k) - before
        expect(gained, label).toBeGreaterThanOrEqual(0)
        expect(gained, label).toBeLessThanOrEqual(2)
      }
    }
  })

  it('依據對不上（H14）：from.quote 不在玩家的輸入裡 → 驗證不過、重試；asked 對得上也一樣', async () => {
    const reply = { json: { items: [{ kind: 'favor', key: 'f_gang', amount: 3, asked: ASKED, from: { source: 'player', quote: NOT_SAID } }] } }
    const { game: g, fake } = city({ ai: { ai: 1, clamp_asked: 0, retry: { reward: 1 } }, fake: { byTask: { judge: [judgeOk()], reward: [reply, reply] } } })
    const { run } = await g.act({ kind: 'schmooze', text: TEXT })
    expect(fake!.requestsFor('reward')).toHaveLength(2)
    expect(sectionOf(fake!.requestsFor('reward')[1]!, 'previous_error')).toMatch(/H14/)
    expect(run.step('reward').status).toBe('fallback')
  })

  it('壞掉的 JSON、逾時、串流中斷：自動重試，都失敗後回報走退路，量表只動參考範圍的一半以內；不變式成立', async () => {
    const cases: Array<[string, object]> = [
      ['bad_json', { text: '{"items": [{"kind": "favor", "key": "f_gang", "amount": 99' }],
      ['timeout', { hang: true }],
      ['stream_break', { text: '{"items": []}', breakAfter: 5 }],
    ]
    for (const [name, reply] of cases) {
      const { game: g, fake } = city({ ai: { ai: 1, retry: { reward: 1 } }, idleTimeoutMs: 30, fake: { byTask: { judge: [judgeOk()], reward: [reply, reply] } } })
      const before = favorOf(g.state, g.k)
      const { result, violations } = await observed(g, () => g.act({ kind: 'schmooze', text: TEXT }))
      expect(violations, name).toEqual([])
      expect(result.status, name).toBe('applied')
      expect(fake!.requestsFor('reward'), name).toHaveLength(2)
      expect(result.run.step('reward').status, name).toBe('fallback')
      expect(favorOf(g.state, g.k) - before, name).toBeLessThanOrEqual(2)
    }
  })

  it('拒絕（AI_TASKS 2.6）：不自動重試（retry = 3 也只送一次），這一步標成失敗、鏈停下來等玩家，量表不動；按「用規則代替」才走退路', async () => {
    const { game: g, fake } = city({ ai: { ai: 1, retry: { reward: 3 } }, fake: { byTask: { judge: [judgeOk()], reward: [{ refusal: true }, { refusal: true }] } } })
    const before = clone(g.state.meters)
    const { status } = await g.act({ kind: 'schmooze', text: TEXT })
    expect(status).toBe('paused')
    expect(fake!.requestsFor('reward')).toHaveLength(1)
    expect(g.state.meters).toEqual(before)
    const { game: h, fake: hf } = city({ ai: { ai: 1, retry: { reward: 3 } }, fake: { byTask: { judge: [judgeOk()], reward: [{ refusal: true }] } } })
    const auto = await h.act({ kind: 'schmooze', text: TEXT }, { autoRules: true })
    expect(auto.status).toBe('applied')
    expect(hf!.requestsFor('reward')).toHaveLength(1)
    expect(auto.run.step('reward').status).toBe('fallback')
    expect(favorOf(h.state, h.k) - 10).toBeLessThanOrEqual(2)
  })

  it('少交 <covered>：只標記號，不算失敗、不重試、不改結果（好感照夾過的值）', async () => {
    const { game: g, fake } = city({
      ai: { ai: 1, retry: { narrate: 3 } },
      fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [item({ kind: 'favor', key: 'f_gang', amount: 30 })] } }], narrate: [{ text: '野良的人拍了拍你的肩膀。' }] } },
    })
    const { run, reports } = await g.act({ kind: 'schmooze', text: TEXT })
    expect(fake!.requestsFor('narrate')).toHaveLength(1)
    expect(run.step('text').status).toBe('done')
    expect(run.step('text').marks).toEqual(['uncovered'])
    expect(reports[0]!.narration!.uncovered).toEqual([1])
    expect(favorOf(g.state, g.k)).toBe(15)
  })

  it('性質：AI 任意交（1～5 筆好感與敵對值、任意量、asked 對或不對），開著時每個勢力的淨變化不超過 ±5／±10；關著時只有對得上的超過；不變式都成立、存讀檔一樣', async () => {
    const effect = fc.record({
      kind: fc.constantFrom('favor', 'hostility'),
      key: fc.constantFrom('f_gang', 'f_corp'),
      amount: fc.integer({ min: -200, max: 200 }).filter((x) => x !== 0),
      asked: fc.constantFrom<string | undefined>(ASKED, NOT_SAID, undefined),
    })
    await fc.assert(fc.asyncProperty(fc.array(effect, { minLength: 1, maxLength: 5 }), fc.constantFrom(0, 1), async (list, clampAsked) => {
      const items = list.map(({ asked, ...e }) => ({ ...e, ...(asked !== undefined ? { asked } : {}), from: asked === ASKED ? { source: 'player', quote: ASKED } : { source: 'degree' } }))
      const { game: g } = city({ ai: { ai: 1, clamp_asked: clampAsked }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items } }] } } })
      const before = clone(g.state.meters)
      const { result, violations } = await observed(g, () => g.act({ kind: 'schmooze', text: TEXT }))
      if (violations.length > 0 || result.status !== 'applied') return false
      for (const kind of ['favor', 'hostility'] as const) {
        const cap = kind === 'favor' ? 5 : 10
        const start = kind === 'favor' ? 10 : 0
        for (const key of ['f_gang', 'f_corp']) {
          const end = meterOf(g.k, g.state, kind, key)
          const from = before[kind]?.[key] ?? start
          if (end < 0 || end > 100) return false
          const exempt = clampAsked === 0 && list.some((e) => e.kind === kind && e.key === key && e.asked === ASKED)
          if (!exempt && Math.abs(end - from) > cap) return false
        }
      }
      const saved = g.save('manual', 't')
      const snap = clone(g.state)
      return g.load(saved) === null && JSON.stringify(g.state) === JSON.stringify(snap)
    }), { numRuns: 25 })
  }, 60000)
})
