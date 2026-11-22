// 邊界測試：AI_TASKS 2.5 節（驗證與夾值），連同它引用的 4.1 節（judge 的三條、reward 的依據）、5.3 節（自動重試）、
// 2.6 節（逾時與拒絕）與 EVENTS 2.4 節（上限）。cpp-tester-boundary 寫的；邊界表在這份測試的回報裡。
//
// 每一個數值都測：下限、下限−1、上限、上限+1、零、空、最大組合；「玩家要求的結果也夾值」開與關兩條路都走。
// 2026-11-21 定案之後照 EVENTS 2.4 節改寫：上限「每件」是一件事合計；錢的上限 AI 的看主角信譽那一階、內建的看區的等級；
// 格式的底線（數值不溢位、每一種物品一次最多 100 個、戰鬥外生命最少剩 1）設定關著也照擋。
// 2026-11-22 再定案：帳戶與現金各自有上限、分開夾；物品是「每一種」一次最多 100 個，總數不限（dev/adr/0007 第 2、4 項）。
// B001、B002 的回歸測試在 tests/fixtures/repro/（種子重播）與 fixed-bugs.boundary.test.ts。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ActionKindDef, AiRequest, EffectCtx, EffectSource, Feature, GameState, Grade, Kernel } from '../../src'
import {
  ADVERSARIAL_MODES, DC_WINDOW, ITEM_MAX_PER_KIND, MONEY_CAP_BY_GRADE, RETRY_DEFAULT, RETRY_MAX, askedMatches, clone, computeDegree, createKernel, effectCtx, effectLevel, inputOf, prepareAction,
  retriesFor, sanitizeAiSettings, sanitizeJudgment, sectionOf, shouldClamp, splitCovered,
} from '../../src'
import { characterFeature } from '../../src/features/character'
import { makeGame, makeState, observed } from '../../src/testkit'

// ---------------------------------------------------------------------------------------------
// 共用的設定

const BEG: ActionKindDef = {
  id: 'beg', owner: 'test', name: '乞討', attr: 'charm', skill: 'perform', dc: 'normal', minutes: 60, maxMinutes: 120, reportKind: 'action',
  hint: ({ degree, grade }) => (degree === 'critical' ? [{ kind: 'cash', amount: 40 * grade }] : degree === 'success' ? [{ kind: 'cash', amount: 20 * grade }] : []),
}
/** 急救：AI_TASKS 3.1 節的行動種類表，平常 10、最多 30 分鐘（上限不到一小時的種類） */
const FIRST_AID: ActionKindDef = { id: 'first_aid', owner: 'test', name: '急救', attr: 'tech', skill: 'medicine', dc: 'normal', minutes: 10, maxMinutes: 30, reportKind: 'action' }
const testFeature: Feature = { id: 'test_actions', install: (k) => { k.actions.register(BEG); k.actions.register(FIRST_AID) } }

const TEXT = '我跪下來求那個穿西裝的人，他心軟給了我一張金卡'
const ASKED = '給了我一張金卡'
const NOT_SAID = '玩家沒有說過的一句話'

function judgeKernel() {
  const k = createKernel([testFeature])
  k.strict = true
  const state = makeState({ pc: { attrs: { charm: 14, tech: 12 }, skills: { perform: 2, medicine: 1 } } })
  return { k, state }
}

function effectKernel(features: Feature[] = []) {
  const k = createKernel(features)
  k.strict = true
  return k
}
const ctxOf = (k: Kernel, state: GameState, over: Partial<EffectCtx> = {}): EffectCtx =>
  ({ state, actor: 'pc', grade: 1, source: 'ai', clampAsked: true, playerInput: TEXT, content: k.content, ...over })

/** 夾值的提醒是白話：不出現欄位名稱（英文的 id、路徑）與硬規則的編號 */
const PLAIN = (notice: string) => !/[A-Za-z_]{2,}|H\d+/.test(notice)

const SOURCES: EffectSource[] = ['builtin', 'ai', 'player']
const GRADES: Grade[] = [1, 2, 3, 4, 5]

// ---------------------------------------------------------------------------------------------
// 1. asked 的字串比對（AI_TASKS 2.5 節「怎麼分辨玩家明說的」）

describe('邊界 AI_TASKS 2.5：asked 對不對得上玩家的輸入', () => {
  it('空：asked 是空字串、只有空白、不是字串；玩家輸入是空的或沒有 → 一律對不上', () => {
    expect(askedMatches('', TEXT)).toBe(false)
    expect(askedMatches('   \n\t', TEXT)).toBe(false)
    expect(askedMatches(undefined, TEXT)).toBe(false)
    expect(askedMatches(null, TEXT)).toBe(false)
    expect(askedMatches(12, '12')).toBe(false)
    expect(askedMatches(['金卡'], TEXT)).toBe(false)
    expect(askedMatches('金卡', '')).toBe(false)
    expect(askedMatches('金卡', undefined)).toBe(false)
  })

  it('上限：asked 等於整段輸入對得上；多一個字（上限+1）就對不上；頭尾空白不算', () => {
    expect(askedMatches(TEXT, TEXT)).toBe(true)
    expect(askedMatches(`${TEXT}。`, TEXT)).toBe(false)
    expect(askedMatches(`  ${ASKED}  `, TEXT)).toBe(true)
    // 下限：一個字
    expect(askedMatches('卡', TEXT)).toBe(true)
    expect(askedMatches('龍', TEXT)).toBe(false)
  })

  it('性質：玩家輸入裡任何一段（去掉頭尾空白之後不是空的）都對得上；輸入裡沒有的字一定對不上', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), fc.nat(), fc.nat(), (input, a, b) => {
      const i = a % input.length
      const j = i + 1 + (b % (input.length - i))
      const piece = input.slice(i, j)
      return askedMatches(piece, input) === (piece.trim().length > 0)
    }))
    fc.assert(fc.property(fc.string({ maxLength: 40 }), (input) => !askedMatches(`${input}\u{1F409}不存在`, input.replace(/\u{1F409}/gu, ''))))
  })

  it('性質：誰要的決定夾不夾（真值表）。內建不夾、AI 一律夾、玩家的：開著一律夾，關著只有對得上的不夾', () => {
    fc.assert(fc.property(fc.constantFrom(...SOURCES), fc.boolean(), fc.constantFrom<string | undefined>(ASKED, NOT_SAID, '', undefined), fc.constantFrom<string | undefined>(TEXT, '', undefined), (source, clampAsked, asked, playerInput) => {
      const got = shouldClamp({ kind: 'cash', ...(asked !== undefined ? { asked } : {}) }, { source, clampAsked, playerInput })
      const want = source === 'builtin' ? false : source === 'ai' ? true : clampAsked ? true : !askedMatches(asked, playerInput)
      return got === want
    }))
  })
})

// ---------------------------------------------------------------------------------------------
// 2. judge 的三條（AI_TASKS 4.1 節）：DC 在參考值 ±3、時間在上限內、成功程度照骰值

describe('邊界 AI_TASKS 4.1／2.5：judge 的 DC、時間、成功程度', () => {
  it('DC：參考值 ±3 剛好在邊上不夾；±4（上限+1、下限−1）夾回 ±3，留記號、提醒是白話', () => {
    const { k, state } = judgeKernel()
    const p = prepareAction(k, state, { kind: 'beg', text: TEXT })
    expect(p.refDc).toBe(13)
    for (const off of [-3, -2, 0, 2, 3]) {
      const r = sanitizeJudgment(k, state, p, { degree: computeDegree(p.roll.natural, p.roll.total, p.refDc + off), dc: p.refDc + off }, { clampAsked: true })
      expect(r.judgment!.dc, `偏移 ${off}`).toBe(p.refDc + off)
      expect(r.clamps.filter((c) => c.path === 'judgment.dc'), `偏移 ${off}`).toEqual([])
    }
    for (const [off, to] of [[-4, -3], [4, 3], [-13, -3], [-1000, -3], [1e6, 3]] as const) {
      const r = sanitizeJudgment(k, state, p, { degree: 'success', dc: p.refDc + off }, { clampAsked: true })
      expect(r.judgment!.dc, `偏移 ${off}`).toBe(p.refDc + to)
      const c = r.clamps.find((x) => x.path === 'judgment.dc')!
      expect(c).toMatchObject({ from: p.refDc + off, to: p.refDc + to })
      expect(PLAIN(c.notice)).toBe(true)
    }
  })

  it('DC：零與負數也夾；小數先四捨五入再比（+3.4 不夾、+3.5 算成 +4 被夾）', () => {
    const { k, state } = judgeKernel()
    const p = prepareAction(k, state, { kind: 'beg', text: TEXT })
    expect(sanitizeJudgment(k, state, p, { degree: 'success', dc: 0 }, { clampAsked: true }).judgment!.dc).toBe(p.refDc - DC_WINDOW)
    expect(sanitizeJudgment(k, state, p, { degree: 'success', dc: -5 }, { clampAsked: true }).judgment!.dc).toBe(p.refDc - DC_WINDOW)
    expect(sanitizeJudgment(k, state, p, { degree: 'success', dc: p.refDc + 3.4 }, { clampAsked: true }).judgment!.dc).toBe(p.refDc + 3)
    const half = sanitizeJudgment(k, state, p, { degree: 'success', dc: p.refDc + 3.5 }, { clampAsked: true })
    expect(half.judgment!.dc).toBe(p.refDc + 3)
    expect(half.clamps.some((c) => c.path === 'judgment.dc')).toBe(true)
  })

  it('DC 與時間不是有限的數字是格式錯誤（不是夾值）：NaN、Infinity、字串', () => {
    const { k, state } = judgeKernel()
    const p = prepareAction(k, state, { kind: 'beg', text: TEXT })
    for (const bad of [Number.NaN, Infinity, -Infinity, '13', null]) {
      expect(sanitizeJudgment(k, state, p, { degree: 'success', dc: bad }, { clampAsked: true }).errors.length, String(bad)).toBeGreaterThan(0)
      expect(sanitizeJudgment(k, state, p, { degree: 'success', minutes: bad }, { clampAsked: false }).errors.length, String(bad)).toBeGreaterThan(0)
    }
  })

  it('時間：上限剛好不夾；上限+1 夾在上限；零可以；−1 是格式錯誤；沒給用平常的', () => {
    const { k, state } = judgeKernel()
    const p = prepareAction(k, state, { kind: 'beg', text: TEXT })
    const at = (minutes: unknown, clampAsked = true) => sanitizeJudgment(k, state, p, { degree: p.roll.degree, ...(minutes !== undefined ? { minutes } : {}) }, { clampAsked })
    expect(at(120).judgment!.minutes).toBe(120)
    expect(at(120).clamps).toEqual([])
    expect(at(121).judgment!.minutes).toBe(120)
    expect(at(121).clamps[0]).toMatchObject({ path: 'judgment.minutes', from: 121, to: 120, limit: 120 })
    expect(at(0).judgment!.minutes).toBe(0)
    expect(at(0).clamps).toEqual([])
    expect(at(-1).errors[0]).toMatch(/minutes/)
    expect(at(-1, false).errors[0]).toMatch(/minutes/)
    expect(at(undefined).judgment!.minutes).toBe(60)
    expect(at(120.4).judgment!.minutes).toBe(120)
    expect(at(120.5).judgment!.minutes).toBe(120)
  })

  it('性質（開）：不管 AI 交什麼、附不附 asked，DC 在參考值 ±3、時間在上限內、成功程度等於照骰值算的、骰面不變', () => {
    const { k, state } = judgeKernel()
    for (const kind of ['beg', 'first_aid']) {
      const p = prepareAction(k, state, { kind, text: TEXT })
      fc.assert(fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true }), fc.double({ min: 0, max: 1e9, noNaN: true }), fc.constantFrom('critical', 'success', 'fail', 'fumble'),
        fc.option(fc.constantFrom(ASKED, NOT_SAID, TEXT, ''), { nil: undefined }),
        (dc, minutes, degree, asked) => {
          const r = sanitizeJudgment(k, state, p, { degree, dc, minutes, ...(asked !== undefined ? { asked } : {}) }, { clampAsked: true })
          const j = r.judgment!
          return r.errors.length === 0 && Math.abs(j.dc - p.refDc) <= DC_WINDOW && j.minutes <= p.maxMinutes && j.degree === computeDegree(p.roll.natural, j.roll.total, j.dc) && j.roll.natural === p.roll.natural
        },
      ))
    }
  })

  it('性質（關）：附 asked 而且對得上的，三條都不夾、照 AI 給的；沒附或對不上的，和開著一模一樣', () => {
    const { k, state } = judgeKernel()
    const p = prepareAction(k, state, { kind: 'beg', text: TEXT })
    fc.assert(fc.property(
      fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 0, max: 100000 }), fc.constantFrom('critical', 'success', 'fail', 'fumble'),
      fc.option(fc.constantFrom(ASKED, NOT_SAID, ''), { nil: undefined }),
      (dc, minutes, degree, asked) => {
        const raw = { degree, dc, minutes, ...(asked !== undefined ? { asked } : {}) }
        const off = sanitizeJudgment(k, state, p, raw, { clampAsked: false })
        if (asked === ASKED) return off.clamps.length === 0 && off.judgment!.dc === dc && off.judgment!.minutes === minutes && off.judgment!.degree === degree
        const on = sanitizeJudgment(k, state, p, raw, { clampAsked: true })
        return JSON.stringify(off.judgment) === JSON.stringify(on.judgment) && JSON.stringify(off.clamps) === JSON.stringify(on.clamps)
      },
    ))
  })

  it('關著、asked 對得上：最大組合（DC 0、時間 0、成功程度和骰值相反）照給；格式錯誤照擋', () => {
    const { k, state } = judgeKernel()
    const p = prepareAction(k, state, { kind: 'beg', text: TEXT })
    const opposite = p.roll.degree === 'critical' || p.roll.degree === 'success' ? 'fumble' : 'critical'
    const r = sanitizeJudgment(k, state, p, { degree: opposite, dc: 0, minutes: 0, asked: ASKED }, { clampAsked: false })
    expect(r.clamps).toEqual([])
    expect(r.judgment).toMatchObject({ degree: opposite, dc: 0, minutes: 0, asked: ASKED })
    // 不論開關，封閉清單與格式照擋
    expect(sanitizeJudgment(k, state, p, { degree: 'legendary', asked: ASKED }, { clampAsked: false }).errors[0]).toMatch(/degree/)
    expect(sanitizeJudgment(k, state, p, { degree: 'success', attr: 'luck', asked: ASKED }, { clampAsked: false }).errors[0]).toMatch(/attr/)
    expect(sanitizeJudgment(k, state, p, { degree: 'success', asked: 42 }, { clampAsked: false }).errors[0]).toMatch(/asked/)
  })
})

// ---------------------------------------------------------------------------------------------
// 3. 回報的數值上限（EVENTS 2.4 節）：錢。AI 的照主角信譽那一階，內建的照區的等級；帳戶與現金加在一起算；一件事合計

describe('邊界 EVENTS 2.4：錢的上限（一件事合計）', () => {
  const rich = () => makeState({ patch: { money: { cred: 1e6, cash: 1e6 } } })

  it('AI 的照主角信譽那一階（repGrade）、不看區的等級：每一階上限剛好不夾、上限+1 夾；負的一樣；零不產生變更也不留一行', () => {
    for (const rep of GRADES) {
      const cap = MONEY_CAP_BY_GRADE[rep]
      const k = effectKernel()
      for (const grade of GRADES) {
        const ctx = ctxOf(k, rich(), { grade, repGrade: rep })
        for (const kind of ['cash', 'cred'] as const) {
          expect(k.effects.resolve([{ kind, amount: cap }], ctx).clamps, `信譽 ${rep} 區 ${grade} ${kind} 上限`).toEqual([])
          expect(k.effects.resolve([{ kind, amount: -cap }], ctx).clamps, `${rep} ${kind} −上限`).toEqual([])
          const over = k.effects.resolve([{ kind, amount: cap + 1 }], ctx)
          expect(over.changes, `${rep} ${kind} 上限+1`).toEqual([{ op: kind, delta: cap }])
          expect(over.clamps[0]).toMatchObject({ from: cap + 1, to: cap, limit: cap })
          expect(PLAIN(over.clamps[0]!.notice)).toBe(true)
          const under = k.effects.resolve([{ kind, amount: -cap - 1 }], ctx)
          expect(under.changes, `${rep} ${kind} −上限−1`).toEqual([{ op: kind, delta: -cap }])
          expect(PLAIN(under.clamps[0]!.notice)).toBe(true)
          const zero = k.effects.resolve([{ kind, amount: 0 }], ctx)
          expect(zero).toMatchObject({ errors: [], changes: [], clamps: [], lines: [] })
        }
      }
    }
    // 沒給 repGrade（街頭信譽的功能還沒搬進來）當 I 級：無名
    const k = effectKernel()
    expect(k.effects.resolve([{ kind: 'cash', amount: 9999 }], ctxOf(k, rich(), { grade: 5 })).changes).toEqual([{ op: 'cash', delta: 120 }])
    expect(effectCtx(k, rich(), { source: 'ai' })).toMatchObject({ grade: 1, repGrade: 1 })
  })

  it('內建的事件：拿到的錢照區的等級夾（不看信譽）；付出去的價錢、罰款不算在內，照寫的扣', () => {
    const k = effectKernel()
    for (const grade of GRADES) {
      const cap = MONEY_CAP_BY_GRADE[grade]
      const ctx = ctxOf(k, rich(), { source: 'builtin', grade, repGrade: 5 })
      expect(k.effects.resolve([{ kind: 'cash', amount: cap }], ctx).clamps).toEqual([])
      expect(k.effects.resolve([{ kind: 'cash', amount: cap + 1 }], ctx).changes).toEqual([{ op: 'cash', delta: cap }])
      expect(k.effects.resolve([{ kind: 'cred', amount: -cap * 50 }], ctx)).toMatchObject({ changes: [{ op: 'cred', delta: -cap * 50 }], clamps: [] })
      // 拿到的合計才比上限；付出去的不拿來抵。帳戶與現金各算各的：現金拿滿了，帳戶照樣拿得到
      expect(k.effects.resolve([{ kind: 'cash', amount: cap }, { kind: 'cred', amount: 1 }, { kind: 'cash', amount: -500 }], ctx).changes).toEqual([{ op: 'cash', delta: cap }, { op: 'cred', delta: 1 }, { op: 'cash', delta: -500 }])
      expect(k.effects.resolve([{ kind: 'cash', amount: cap }, { kind: 'cash', amount: 1 }, { kind: 'cred', amount: cap + 5 }], ctx).changes).toEqual([{ op: 'cash', delta: cap }, { op: 'cred', delta: cap }])
    }
  })

  it('上限以資料為準：data/rules/effect_caps.json 改了，夾的地方跟著改', () => {
    const k = effectKernel()
    k.content.load('effect_cap', [{ id: 'money', by_grade: { 1: 50, 2: 360, 3: 1200, 4: 3900, 5: 12000 } }])
    const ctx = ctxOf(k, makeState())
    expect(k.effects.resolve([{ kind: 'cash', amount: 50 }], ctx).clamps).toEqual([])
    expect(k.effects.resolve([{ kind: 'cash', amount: 51 }], ctx).changes).toEqual([{ op: 'cash', delta: 50 }])
  })

  it('一件事合計（審查 E1）：拆成幾筆給也一樣；帳戶與現金各自有上限、分開算；超過的從最後幾筆往回扣', () => {
    const k = effectKernel()
    const ctx = ctxOf(k, rich())
    const three = k.effects.resolve([{ kind: 'cash', amount: 120 }, { kind: 'cash', amount: 120 }, { kind: 'cash', amount: 120 }], ctx)
    expect(three.changes).toEqual([{ op: 'cash', delta: 120 }])
    expect(three.lines).toEqual(['拿到：現金 120'])
    expect(three.clamps.map((c) => [c.path, c.from, c.to])).toEqual([['effects[1]', 120, 0], ['effects[2]', 120, 0]])
    for (const c of three.clamps) expect(PLAIN(c.notice)).toBe(true)
    // 帳戶與現金分開夾：各自 120 以內就都不夾；各自超過的各自扣
    expect(k.effects.resolve([{ kind: 'cash', amount: 100 }, { kind: 'cred', amount: 100 }], ctx)).toMatchObject({ changes: [{ op: 'cash', delta: 100 }, { op: 'cred', delta: 100 }], clamps: [] })
    expect(k.effects.resolve([{ kind: 'cash', amount: 100 }, { kind: 'cred', amount: 100 }, { kind: 'cred', amount: 100 }, { kind: 'cash', amount: 100 }], ctx).changes).toEqual([{ op: 'cash', delta: 100 }, { op: 'cred', delta: 100 }, { op: 'cred', delta: 20 }, { op: 'cash', delta: 20 }])
    // 有進有出：合計之後才比上限（+200、−100 合計 +100，不夾）
    expect(k.effects.resolve([{ kind: 'cash', amount: 200 }, { kind: 'cash', amount: -100 }], ctx)).toMatchObject({ changes: [{ op: 'cash', delta: 200 }, { op: 'cash', delta: -100 }], clamps: [] })
    // 合計超過時只扣同一個方向的那幾筆
    expect(k.effects.resolve([{ kind: 'cash', amount: 100 }, { kind: 'cash', amount: -50 }, { kind: 'cash', amount: 100 }], ctx).changes).toEqual([{ op: 'cash', delta: 100 }, { op: 'cash', delta: -50 }, { op: 'cash', delta: 70 }])
    expect(k.effects.resolve([{ kind: 'cash', amount: -100 }, { kind: 'cred', amount: -100 }], ctx)).toMatchObject({ changes: [{ op: 'cash', delta: -100 }, { op: 'cred', delta: -100 }], clamps: [] })
    expect(k.effects.resolve([{ kind: 'cash', amount: -100 }, { kind: 'cred', amount: -100 }, { kind: 'cred', amount: -100 }], ctx).changes).toEqual([{ op: 'cash', delta: -100 }, { op: 'cred', delta: -100 }, { op: 'cred', delta: -20 }])
  })

  it('扣不到的不能拿來抵（E1 的另一種繞法）：先扣一大筆（手上沒有那麼多）再給一大筆，實際的淨變化照樣不超過上限', () => {
    const k = effectKernel()
    const poor = () => makeState({ patch: { money: { cred: 0, cash: 30 } } })
    // 每一種錢各自的淨變化（帳戶與現金分開夾）
    const net = (list: unknown[], state = poor()) => {
      const r = k.effects.resolve(list, ctxOf(k, state))
      const after = clone(state)
      k.changes.applyAll(after, r.changes)
      return { cash: after.money.cash - state.money.cash, cred: after.money.cred - state.money.cred }
    }
    // 同一種錢裡：先扣一大筆（扣不到）再給一大筆，實際的淨變化照樣不超過上限
    expect(net([{ kind: 'cash', amount: -1000000 }, { kind: 'cash', amount: 1000120 }]).cash).toBeLessThanOrEqual(120)
    expect(net([{ kind: 'cred', amount: -5000 }, { kind: 'cred', amount: 5100 }])).toEqual({ cash: 0, cred: 120 })
    // 兩種錢各算各的：帳戶扣不到不影響現金的上限，現金照自己的 120 夾
    expect(net([{ kind: 'cred', amount: -5000 }, { kind: 'cash', amount: 5100 }])).toEqual({ cash: 120, cred: 0 })
    const mixed = net([{ kind: 'cred', amount: 300 }, { kind: 'cash', amount: 500 }, { kind: 'cash', amount: -1000 }])
    expect(mixed.cred).toBe(120)
    expect(Math.abs(mixed.cash)).toBeLessThanOrEqual(120)
    // 真的扣得到的可以抵：先付 30 再拿 150，淨 +120
    expect(net([{ kind: 'cash', amount: -30 }, { kind: 'cash', amount: 150 }])).toEqual({ cash: 120, cred: 0 })
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom('cash', 'cred'), fc.integer({ min: -3000, max: 3000 }).filter((n) => n !== 0)), { minLength: 1, maxLength: 8 }), fc.nat({ max: 400 }), fc.nat({ max: 400 }), (parts, cash, cred) => {
      const n = net(parts.map(([kind, amount]) => ({ kind, amount })), makeState({ patch: { money: { cred, cash } } }))
      return Math.abs(n.cash) <= 120 && Math.abs(n.cred) <= 120
    }))
  })

  it('性質（E1）：AI 給的錢不論怎麼拆，帳戶與現金各自一件事的淨變化不超過 ±上限；和各自合成一筆的結果一樣多', () => {
    const k = effectKernel()
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom('cash' as const, 'cred' as const), fc.integer({ min: 0, max: 5000 })), { minLength: 1, maxLength: 8 }), fc.constantFrom(...GRADES), fc.boolean(), (parts, rep, negative) => {
      const state = rich()
      const list = parts.map(([kind, n]) => ({ kind, amount: negative ? -n : n }))
      const r = k.effects.resolve(list, ctxOf(k, state, { repGrade: rep }))
      const after = clone(state)
      k.changes.applyAll(after, r.changes)
      const cap = MONEY_CAP_BY_GRADE[rep]
      const each = (['cash', 'cred'] as const).every((kind) => {
        const total = list.filter((e) => e.kind === kind).reduce((sum, e) => sum + e.amount, 0)
        return after.money[kind] - state.money[kind] === Math.max(-cap, Math.min(cap, total))
      })
      return r.errors.length === 0 && each && r.lines.length === r.effects.length
    }))
  })

  it('性質：每一種來源 × 開關 × asked，一筆錢的變更都照 2.5 節的表；不會讓錢變成負數；扣不到的那一段有提醒；提交不會失敗', () => {
    const k = effectKernel()
    fc.assert(fc.property(
      fc.integer({ min: -1e7, max: 1e7 }), fc.constantFrom(...GRADES), fc.constantFrom(...GRADES), fc.constantFrom(...SOURCES), fc.boolean(),
      fc.option(fc.constantFrom(ASKED, NOT_SAID), { nil: undefined }), fc.nat({ max: 20000 }), fc.constantFrom('cash' as const, 'cred' as const),
      (amount, grade, rep, source, clampAsked, asked, held, kind) => {
        const state = makeState({ patch: { money: { cred: held, cash: held } } })
        const ctx = ctxOf(k, state, { grade, repGrade: rep, source, clampAsked })
        const r = k.effects.resolve([{ kind, amount, ...(asked !== undefined ? { asked } : {}) }], ctx)
        const level = effectLevel({ kind, asked }, ctx)
        expect(level).toBe(source === 'builtin' ? 'builtin' : shouldClamp({ kind, asked }, ctx) ? 'cap' : 'floor')
        // 內建：只夾拿到的，照區；照上限：兩個方向都夾，照信譽；免夾：不夾
        const want = level === 'builtin' ? Math.min(amount, MONEY_CAP_BY_GRADE[grade]) : level === 'cap' ? Math.max(-MONEY_CAP_BY_GRADE[rep], Math.min(MONEY_CAP_BY_GRADE[rep], amount)) : amount
        const delta = want < 0 ? -Math.min(-want, held) : want
        const after = clone(state)
        k.changes.applyAll(after, r.changes)
        // 被夾（或付不出來）就有一則提醒；定案的那一行寫的是實際的數字
        const line = delta === 0 ? [] : [`${delta > 0 ? '拿到' : '失去'}：${kind === 'cash' ? '現金' : '帳戶'} ${Math.abs(delta).toLocaleString('en-US')}`]
        return r.errors.length === 0 && after.money[kind] === held + delta && after.money[kind] >= 0
          && r.clamps.length === (delta !== amount ? 1 : 0) && JSON.stringify(r.lines) === JSON.stringify(line)
      },
    ))
  })

  it('一份回報有好幾筆時：玩家明說要的那幾筆（關著、asked 對得上）不夾也不算進合計；其餘的合計後照上限夾', () => {
    const k = effectKernel()
    const ctx = ctxOf(k, makeState(), { source: 'player', clampAsked: false })
    const r = k.effects.resolve([{ kind: 'cash', amount: 5000, asked: ASKED }, { kind: 'cash', amount: 5000 }, { kind: 'cred', amount: 5000, asked: NOT_SAID }], ctx)
    // 現金那一筆沒附 asked、帳戶那一筆的 asked 對不上：都照上限夾，而且帳戶與現金各夾各的
    expect(r.changes).toEqual([{ op: 'cash', delta: 5000 }, { op: 'cash', delta: 120 }, { op: 'cred', delta: 120 }])
    expect(r.clamps.map((c) => [c.path, c.to])).toEqual([['effects[1]', 120], ['effects[2]', 120]])
    // 開著：三筆都算進合計
    const on = k.effects.resolve([{ kind: 'cash', amount: 5000, asked: ASKED }, { kind: 'cash', amount: 5000 }], { ...ctx, clampAsked: true })
    expect(on.changes).toEqual([{ op: 'cash', delta: 120 }])
  })

  it('格式的底線（B001）：數值不是安全整數是格式錯誤，設定關著、asked 對得上也照擋；加上去會溢位的也擋', () => {
    const k = effectKernel([characterFeature])
    const free: Partial<EffectCtx> = { source: 'player', clampAsked: false }
    for (const amount of [1e308, -1e308, 2 ** 53, Number.MAX_VALUE, Infinity, -Infinity, Number.NaN, 1.5]) {
      for (const kind of ['cash', 'cred', 'sink', 'hp', 'load', 'afterglow']) {
        const r = k.effects.resolve([{ kind, amount, asked: ASKED }], ctxOf(k, makeState(), free))
        expect(r.errors.length, `${kind} ${amount}`).toBeGreaterThan(0)
        expect(r.changes).toEqual([])
      }
    }
    // 每一筆都是安全整數，但加上手上有的會超出範圍：一樣是格式錯誤（不會到套用才丟錯）
    const near = makeState({ patch: { money: { cred: 0, cash: Number.MAX_SAFE_INTEGER - 10 } } })
    expect(k.effects.resolve([{ kind: 'cash', amount: 11, asked: ASKED }], ctxOf(k, near, free)).errors[0]).toMatch(/effects\[0\]/)
    expect(k.effects.resolve([{ kind: 'cash', amount: 6, asked: ASKED }, { kind: 'cash', amount: 6, asked: ASKED }], ctxOf(k, near, free)).errors[0]).toMatch(/effects\[1\]/)
    expect(k.effects.resolve([{ kind: 'cash', amount: 10, asked: ASKED }], ctxOf(k, near, free)).changes).toEqual([{ op: 'cash', delta: 10 }])
    // 最大的合法值照給
    expect(k.effects.resolve([{ kind: 'cash', amount: Number.MAX_SAFE_INTEGER, asked: ASKED }], ctxOf(k, makeState(), free)).changes).toEqual([{ op: 'cash', delta: Number.MAX_SAFE_INTEGER }])
  })
})

// ---------------------------------------------------------------------------------------------
// 4. 三條軌（EVENTS 2.4 節；AI_TASKS 2.5 節「不會讓人倒下或瀕死怎麼夾」）

describe('邊界 EVENTS 2.4／AI_TASKS 2.5：hp、load、sink', () => {
  const k = effectKernel([characterFeature])
  const at = (track: { hp?: number; load?: number; sink?: number }, raw: unknown[], over: Partial<EffectCtx> = {}) => {
    const state = makeState({ pc: { ...track } })
    const r = k.effects.resolve(raw, ctxOf(k, state, over))
    const after = clone(state)
    k.changes.applyAll(after, r.changes)
    return { r, pc: after.actors.pc! }
  }

  it('hp：扣完剛好剩 1 不夾；多扣 1 夾在剩 1；已經是 1 時整筆拿掉並提醒；加的不夾', () => {
    expect(at({ hp: 40 }, [{ kind: 'hp', amount: -38 }]).pc.hp).toBe(2)
    const exact = at({ hp: 40 }, [{ kind: 'hp', amount: -39 }])
    expect(exact.pc.hp).toBe(1)
    expect(exact.r.clamps).toEqual([])
    const over = at({ hp: 40 }, [{ kind: 'hp', amount: -40 }])
    expect(over.pc.hp).toBe(1)
    expect(over.r.clamps[0]).toMatchObject({ from: -40, to: -39 })
    expect(at({ hp: 40 }, [{ kind: 'hp', amount: -9999 }]).pc.hp).toBe(1)
    const edge = at({ hp: 1 }, [{ kind: 'hp', amount: -1 }])
    expect(edge.pc.hp).toBe(1)
    expect(edge.r.effects).toEqual([])
    expect(edge.r.lines).toEqual([])
    expect(edge.r.clamps).toHaveLength(1)
    expect(PLAIN(edge.r.clamps[0]!.notice)).toBe(true)
    expect(at({ hp: 2 }, [{ kind: 'hp', amount: -1 }]).r.clamps).toEqual([])
    expect(at({ hp: 10 }, [{ kind: 'hp', amount: 5 }]).r.clamps).toEqual([])
    expect(at({ hp: 1 }, [{ kind: 'hp', amount: 0 }]).r.errors[0]).toMatch(/amount/)
  })

  it('hp：戰鬥外最少剩 1 是格式的底線，關著而且 asked 對得上也照擋；內建的照寫的算（可以扣到 0）；事件標了 combat 就不擋', () => {
    const free = at({ hp: 5 }, [{ kind: 'hp', amount: -10, asked: ASKED }], { source: 'player', clampAsked: false })
    expect(free.pc.hp).toBe(1)
    expect(free.r.clamps).toHaveLength(1)
    expect(PLAIN(free.r.clamps[0]!.notice)).toBe(true)
    expect(at({ hp: 5 }, [{ kind: 'hp', amount: -10, asked: NOT_SAID }], { source: 'player', clampAsked: false }).pc.hp).toBe(1)
    expect(at({ hp: 5 }, [{ kind: 'hp', amount: -10, asked: ASKED }], { source: 'player', clampAsked: true }).pc.hp).toBe(1)
    expect(at({ hp: 5 }, [{ kind: 'hp', amount: -10 }], { source: 'builtin' })).toMatchObject({ pc: { hp: 0 }, r: { clamps: [] } })
    for (const over of [{ source: 'ai' as const }, { source: 'player' as const, clampAsked: false }]) {
      expect(at({ hp: 5 }, [{ kind: 'hp', amount: -10, asked: ASKED }], { ...over, combat: true }).pc.hp).toBe(0)
    }
  })

  it('一件事合計（審查 E1）：hp、load、sink 拆成幾筆給，結果和合成一筆一樣', () => {
    const cap = k.stats.stat(makeState(), 'pc', 'load_cap')
    // 審查的重現：hp 44 扣兩次 40
    const hp = at({ hp: 40 }, [{ kind: 'hp', amount: -30 }, { kind: 'hp', amount: -30 }])
    expect(hp.pc.hp).toBe(1)
    expect(hp.r.clamps.map((c) => [c.path, c.from, c.to])).toEqual([['effects[1]', -30, -9]])
    expect(at({ hp: 40 }, [{ kind: 'hp', amount: -39 }, { kind: 'hp', amount: -1 }, { kind: 'hp', amount: -1 }]).pc.hp).toBe(1)
    // 先補再扣：補血不超過上限，扣的照補完之後的量算
    expect(at({ hp: 30 }, [{ kind: 'hp', amount: 40 }, { kind: 'hp', amount: -60 }]).pc.hp).toBe(1)
    expect(at({ hp: 35 }, [{ kind: 'hp', amount: 10 }, { kind: 'hp', amount: 10 }]).pc.hp).toBe(40)
    const load = at({ load: 0 }, [{ kind: 'load', amount: 30 }, { kind: 'load', amount: 30 }])
    expect(load.pc.load).toBe(cap - 1)
    expect(load.r.effects).toHaveLength(1)
    expect(load.r.clamps).toHaveLength(2)
    const sink = at({ sink: 10 }, [{ kind: 'sink', amount: 3 }, { kind: 'sink', amount: 3 }])
    expect(sink.pc.sink).toBe(13)
    expect(sink.r.clamps.map((c) => [c.path, c.to])).toEqual([['effects[1]', 0]])
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: 2 }, { kind: 'sink', amount: 2 }]).pc.sink).toBe(13)
    // 有加有減：合計之後才比上限（+5、−1 合計 +4，扣到 +3）
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: 5 }, { kind: 'sink', amount: -1 }]).pc.sink).toBe(13)
    // 減的那一筆其實減不到（沉溺是 0）：實際的淨變化照樣不超過 3
    expect(at({ sink: 0 }, [{ kind: 'sink', amount: -5 }, { kind: 'sink', amount: 8 }]).pc.sink).toBe(3)
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: -2 }, { kind: 'sink', amount: -2 }]).pc.sink).toBe(7)
  })

  it('餘韻（定案）：AI 給的一件事最多 +1 層，加完最多到上限 − 1；已經在邊界時整筆拿掉並提醒；內建的照寫的（最多疊滿）', () => {
    const cap = k.stats.stat(makeState(), 'pc', 'afterglow_cap')
    expect(cap).toBe(3)
    const ag = (afterglow: number, raw: unknown[], over: Partial<EffectCtx> = {}) => {
      const state = makeState({ pc: { afterglow } })
      const r = k.effects.resolve(raw, ctxOf(k, state, over))
      const after = clone(state)
      k.changes.applyAll(after, r.changes)
      return { r, afterglow: after.actors.pc!.afterglow }
    }
    // 下限、上限−2、上限−1（邊界）、上限
    expect(ag(0, [{ kind: 'afterglow', amount: 1 }])).toMatchObject({ afterglow: 1, r: { clamps: [] } })
    expect(ag(1, [{ kind: 'afterglow', amount: 1 }])).toMatchObject({ afterglow: 2, r: { clamps: [] } })
    const edge = ag(cap - 1, [{ kind: 'afterglow', amount: 1 }])
    expect(edge.afterglow).toBe(cap - 1)
    expect(edge.r.effects).toEqual([])
    expect(edge.r.lines).toEqual([])
    expect(edge.r.clamps).toHaveLength(1)
    expect(PLAIN(edge.r.clamps[0]!.notice)).toBe(true)
    expect(ag(cap, [{ kind: 'afterglow', amount: 1 }]).afterglow).toBe(cap)
    // 一次最多 +1：+2、+99、拆成兩筆都只加一層
    for (const raw of [[{ kind: 'afterglow', amount: 2 }], [{ kind: 'afterglow', amount: 99 }], [{ kind: 'afterglow', amount: 1 }, { kind: 'afterglow', amount: 1 }]]) {
      const x = ag(0, raw)
      expect(x.afterglow).toBe(1)
      expect(x.r.clamps.length).toBeGreaterThan(0)
      for (const c of x.r.clamps) expect(PLAIN(c.notice)).toBe(true)
    }
    // 往下退的不受限制，不低於 0
    expect(ag(2, [{ kind: 'afterglow', amount: -5 }]).afterglow).toBe(0)
    // 零與不是整數的是格式錯誤
    expect(ag(0, [{ kind: 'afterglow', amount: 0 }]).r.errors[0]).toMatch(/amount/)
    // 開著時玩家要的照夾；關著而且 asked 對得上的不受「一次一層」限制，但不會超過承受層數
    expect(ag(0, [{ kind: 'afterglow', amount: 3, asked: ASKED }], { source: 'player', clampAsked: true }).afterglow).toBe(1)
    expect(ag(0, [{ kind: 'afterglow', amount: 9, asked: ASKED }], { source: 'player', clampAsked: false }).afterglow).toBe(cap)
    expect(ag(0, [{ kind: 'afterglow', amount: 2 }], { source: 'builtin' })).toMatchObject({ afterglow: 2, r: { clamps: [] } })
    expect(ag(1, [{ kind: 'afterglow', amount: 9 }], { source: 'builtin' }).afterglow).toBe(cap)
    // 事件標了 combat：AI 給的也可以疊滿
    expect(ag(0, [{ kind: 'afterglow', amount: 3 }], { combat: true }).afterglow).toBe(cap)
  })

  it('性質（E1）：AI 給的 hp、load、sink、afterglow 任意拆成幾筆、任意順序，hp 不會到 0、load 不會到上限、沉溺一件事最多動 3、餘韻最多 +1 而且不疊滿', () => {
    const one = fc.tuple(fc.constantFrom('hp', 'load', 'sink', 'afterglow'), fc.integer({ min: -60, max: 60 }).filter((n) => n !== 0))
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 19 }), fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 2 }),
      fc.array(one, { minLength: 1, maxLength: 10 }), fc.constantFrom<Partial<EffectCtx>>({ source: 'ai' }, { source: 'player', clampAsked: true }),
      (hp, load, sink, afterglow, parts, over) => {
        const state = makeState({ pc: { hp, load, sink, afterglow } })
        const r = k.effects.resolve(parts.map(([kind, amount]) => ({ kind, amount })), ctxOf(k, state, over))
        const after = clone(state)
        k.changes.applyAll(after, r.changes)
        const pc = after.actors.pc!
        return r.errors.length === 0 && pc.hp >= 1 && pc.hp <= 40 && pc.load <= 19 && pc.load >= 0 && Math.abs(pc.sink - sink) <= 3 && pc.sink >= 0
          && pc.afterglow <= Math.max(afterglow, Math.min(afterglow + 1, 2)) && pc.afterglow >= 0 && r.lines.length === r.effects.length
      },
    ))
  })

  it('load：加完剛好到上限 − 1 不夾；多 1 夾；已經在上限 − 1 時整筆拿掉；減的不夾', () => {
    const cap = k.stats.stat(makeState(), 'pc', 'load_cap')
    expect(cap).toBe(20)
    expect(at({ load: 0 }, [{ kind: 'load', amount: cap - 1 }]).r.clamps).toEqual([])
    const over = at({ load: 0 }, [{ kind: 'load', amount: cap }])
    expect(over.pc.load).toBe(cap - 1)
    expect(over.r.clamps[0]).toMatchObject({ from: cap, to: cap - 1 })
    const edge = at({ load: cap - 1 }, [{ kind: 'load', amount: 1 }])
    expect(edge.pc.load).toBe(cap - 1)
    expect(edge.r.effects).toEqual([])
    expect(PLAIN(edge.r.clamps[0]!.notice)).toBe(true)
    expect(at({ load: 5 }, [{ kind: 'load', amount: -99 }]).pc.load).toBe(0)
  })

  it('sink：±3 不夾、±4 夾在 ±3；零是格式錯誤', () => {
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: 3 }]).r.clamps).toEqual([])
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: -3 }]).r.clamps).toEqual([])
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: 4 }]).pc.sink).toBe(13)
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: -4 }]).pc.sink).toBe(7)
    for (const n of [4, -4]) expect(PLAIN(at({ sink: 10 }, [{ kind: 'sink', amount: n }]).r.clamps[0]!.notice)).toBe(true)
    expect(at({ sink: 10 }, [{ kind: 'sink', amount: 0 }]).r.errors[0]).toMatch(/amount/)
  })

  it('性質：AI 自己給的（或開著時玩家要的），hp 原本 ≥ 1 就留 ≥ 1；load 原本 ≤ 上限−1 就留 ≤ 上限−1；sink 一筆最多動 3；都不會低於 0', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 19 }), fc.integer({ min: 0, max: 50 }),
      fc.integer({ min: -500, max: 500 }).filter((n) => n !== 0), fc.integer({ min: -500, max: 500 }).filter((n) => n !== 0), fc.integer({ min: -500, max: 500 }).filter((n) => n !== 0),
      fc.constantFrom<Partial<EffectCtx>>({ source: 'ai' }, { source: 'player', clampAsked: true }, { source: 'player', clampAsked: false }),
      fc.option(fc.constantFrom(ASKED, NOT_SAID), { nil: undefined }),
      (hp, load, sink, dh, dl, ds, over, asked) => {
        const extra = asked !== undefined ? { asked } : {}
        const { r, pc } = at({ hp, load, sink }, [{ kind: 'hp', amount: dh, ...extra }, { kind: 'load', amount: dl, ...extra }, { kind: 'sink', amount: ds, ...extra }], over)
        if (r.errors.length) return false
        const free = over.source === 'player' && over.clampAsked === false && asked === ASKED
        if (free) return pc.hp >= 0 && pc.load >= 0 && pc.sink >= 0
        return pc.hp >= 1 && pc.load <= 19 && Math.abs(pc.sink - sink) <= 3 && pc.load >= 0 && pc.sink >= 0
      },
    ))
  })
})

// ---------------------------------------------------------------------------------------------
// 5. 格式錯誤與等級（AI_TASKS 2.5 節：「不論開關，格式錯誤一律擋」；物品的等級不超過這一區）

describe('邊界 AI_TASKS 2.5：格式錯誤不論開關都擋；等級照這一區', () => {
  const setup = () => {
    const k = effectKernel()
    const IT = (id: string, name: string, grade = 1) => ({ id, name, desc: `${name}。`, category: 'misc', grade, size: 1, legal: 'free' })
    k.content.load('item', [IT('it_g1', '菸'), IT('it_g1b', '糰糧'), IT('it_g2', '短刀', 2), IT('it_g5', '神劍', 5)])
    return k
  }

  it('每一種物品一次最多 100 個（格式的底線）：AI 交出的一件事裡同一種合計超過的扣掉，關著而且 asked 對得上也照擋；總數不限；內建的照寫的算', () => {
    const k = setup()
    const state = makeState()
    expect(ITEM_MAX_PER_KIND).toBe(100)
    const qty = (r: ReturnType<typeof k.effects.resolve>) => r.changes.reduce((n, c) => n + (c.qty as number), 0)
    for (const over of [{ source: 'ai' as const }, { source: 'player' as const, clampAsked: true }, { source: 'player' as const, clampAsked: false }]) {
      const ctx = ctxOf(k, state, over)
      expect(k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: 100, asked: ASKED }], ctx)).toMatchObject({ changes: [{ op: 'item', id: 'it_g1', qty: 100 }], clamps: [] })
      const one = k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: 101, asked: ASKED }], ctx)
      expect(qty(one)).toBe(100)
      expect(one.clamps[0]).toMatchObject({ from: 101, to: 100, limit: 100 })
      expect(one.clamps[0]!.notice).toMatch(/菸/)
      // 同一種拆成幾筆，合計一樣是 100
      const split = k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: 60, asked: ASKED }, { kind: 'item', id: 'it_g1', qty: 60, asked: ASKED }, { kind: 'item', id: 'it_g1', qty: 999999, asked: ASKED }], ctx)
      expect(qty(split)).toBe(100)
      expect(split.clamps.map((c) => c.to)).toEqual([40, 0])
      // 每一種各算各的：兩種各拿 100 個都照給（總數不限），第三筆同一種的才被扣掉
      const two = k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: 100, asked: ASKED }, { kind: 'item', id: 'it_g1b', qty: 100, asked: ASKED }, { kind: 'item', id: 'it_g1b', qty: 5, asked: ASKED }], ctx)
      expect(two.changes).toEqual([{ op: 'item', id: 'it_g1', qty: 100 }, { op: 'item', id: 'it_g1b', qty: 100 }])
      expect(two.clamps.map((c) => [c.path, c.to])).toEqual([['effects[2]', 0]])
      expect(two.clamps[0]!.notice).toMatch(/同一種/)
    }
    expect(qty(k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: 5000 }], ctxOf(k, state, { source: 'builtin' })))).toBe(5000)
    // 拿走的不算在內；數量大到失真是格式錯誤
    const full = makeState({ patch: { inventory: [{ id: 'it_g1', qty: 500 }] } })
    expect(qty(k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: -300 }], ctxOf(k, full)))).toBe(-300)
    expect(k.effects.resolve([{ kind: 'item', id: 'it_g1', qty: 1e308, asked: ASKED }], ctxOf(k, state, { source: 'player', clampAsked: false })).errors[0]).toMatch(/qty/)
  })

  it('物品：等級等於這一區不夾；高一級整筆拿掉並提醒；關著而且對得上的，V 級的神劍在 I 級區照給', () => {
    const k = setup()
    const state = makeState()
    for (const grade of GRADES) {
      const r = k.effects.resolve([{ kind: 'item', id: 'it_g2', qty: 1 }], ctxOf(k, state, { grade }))
      if (grade >= 2) expect(r.changes, `區 ${grade}`).toHaveLength(1)
      else {
        expect(r.changes).toEqual([])
        expect(r.clamps[0]!.to).toBeNull()
        expect(r.clamps[0]!.notice).toMatch(/短刀/)
      }
    }
    expect(k.effects.resolve([{ kind: 'item', id: 'it_g5', qty: 1, asked: ASKED }], ctxOf(k, state, { source: 'player', clampAsked: false })).changes).toEqual([{ op: 'item', id: 'it_g5', qty: 1 }])
    expect(k.effects.resolve([{ kind: 'item', id: 'it_g5', qty: 1, asked: ASKED }], ctxOf(k, state, { source: 'player', clampAsked: true })).changes).toEqual([])
  })

  it('性質：設定關著、asked 對得上，格式錯誤照樣讓整批不收（不存在的種類、不存在的 id、小數、零、ai: 以外的旗標）', () => {
    const k = setup()
    const state = makeState()
    const bads = [
      { kind: 'godsword', power: 9001 }, { kind: 'item', id: 'it_no_such_thing', qty: 1 }, { kind: 'item', id: 'it_g1', qty: 0 },
      { kind: 'cash', amount: 1.5 }, { kind: 'cash', amount: '9999' }, { kind: 'cash', amount: Infinity }, { kind: 'cash', amount: Number.NaN },
      { kind: 'flag', key: 'main_quest_done', value: true }, { kind: 'time', hours: -1 }, { kind: 'cash' }, {},
    ]
    fc.assert(fc.property(fc.constantFrom(...bads), fc.array(fc.integer({ min: 1, max: 100 }), { maxLength: 3 }), fc.boolean(), (bad, goods, clampAsked) => {
      const list = [...goods.map((n) => ({ kind: 'cash', amount: n, asked: ASKED })), { ...bad, asked: ASKED }]
      const r = k.effects.resolve(list, ctxOf(k, state, { source: 'player', clampAsked }))
      return r.errors.length > 0 && r.changes.length === 0 && r.effects.length === 0
    }))
  })

  it('空：一份空的回報合格、什麼都不改；不是陣列是格式錯誤', () => {
    const k = setup()
    const ctx = ctxOf(k, makeState())
    expect(k.effects.resolve([], ctx)).toMatchObject({ errors: [], changes: [], lines: [], clamps: [] })
    expect(k.effects.resolve(null, ctx).errors).toHaveLength(1)
    expect(k.effects.resolve({}, ctx).errors).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// 6. 整條鏈：假的服務商送對抗性的回應，開與關兩條路

const judgeOk = (over: Record<string, unknown> = {}) => (req: AiRequest) => {
  const i = inputOf<{ roll: { degree: string }; ref_dc: number }>(req)
  return { json: { degree: i.roll.degree, dc: i.ref_dc, reason: '那個穿西裝的人看了你一眼。', twist: '他連菸帶硬幣一起丟給你', minutes: 60, ...over } }
}
const ace = { attrs: { charm: 18 }, skills: { perform: 6 } }
const game = (o: Parameters<typeof makeGame>[0] = {}) => makeGame({ features: [testFeature], pc: ace, ...o })
const minutesOf = (s: GameState) => (s.time.day - 1) * 1440 + s.time.hour * 60 + s.time.minute

describe('邊界：整條自由行動的鏈 × 對抗模式 × 「玩家要求的結果也夾值」開與關', () => {
  for (const clampAsked of [1, 0]) {
    it(`${clampAsked ? '開' : '關'}：十種壞掉的回應，跑完的狀態都在上限內、不變式都成立、沒驗證過的東西進不了狀態`, async () => {
      for (const mode of ADVERSARIAL_MODES) {
        const { game: g } = game({ ai: { ai: 1, clamp_asked: clampAsked }, idleTimeoutMs: 30, fake: { adversarial: { mode } } })
        const start = minutesOf(g.state)
        const { result, violations } = await observed(g, () => g.act({ kind: 'beg', text: TEXT }, { autoRules: true }))
        expect(violations, mode).toEqual([])
        expect(result.status, mode).toBe('applied')
        // 對抗模式交的 asked 都對不上玩家的輸入：關著也照夾
        expect(g.state.money.cash, mode).toBeLessThanOrEqual(MONEY_CAP_BY_GRADE[1])
        expect(minutesOf(g.state) - start, mode).toBeLessThanOrEqual(BEG.maxMinutes)
        const roll = result.reports[0]!.timeline[0]!.roll!
        expect(Math.abs(roll.dc - 13), mode).toBeLessThanOrEqual(DC_WINDOW)
        expect(roll.degree, mode).toBe(computeDegree(roll.natural, roll.total, roll.dc))
        expect(g.state.inventory, mode).toEqual([])
        // 多出來的欄位只留在任務鏈細節的原始回應裡（AI_TASKS 5.4 節的回報要原文），不進狀態的其他地方
        const { chains: _chains, ...rest } = g.state
        expect(JSON.stringify(rest), mode).not.toContain('status_bar')
        expect(JSON.stringify(result.run.draft), mode).not.toContain('status_bar')
        // 每一個 AI 步驟不是完成就是用了退路（有夾值的照樣是完成）
        for (const s of result.run.steps.filter((x) => x.kind === 'ai' && x.status !== 'skipped')) expect(['done', 'fallback'], `${mode} ${s.id}`).toContain(s.status)
        // 存讀檔之後一模一樣
        const saved = g.save('manual', 't')
        const before = clone(g.state)
        expect(g.load(saved), mode).toBeNull()
        expect(g.state, mode).toEqual(before)
      }
    })
  }

  it('over_cap（開）：判定與回報都標「有夾值」，細節列出原本的值與夾過的值；寫正文收到夾過的值', async () => {
    const { game: g, fake } = game({ ai: { ai: 1 }, fake: { adversarial: { mode: 'over_cap', tasks: ['judge', 'reward'] } } })
    const { run, reports } = await g.act({ kind: 'beg', text: TEXT })
    expect(run.step('judge').marks).toContain('clamped')
    expect(run.step('judge').clamps!.map((c) => c.path).sort()).toEqual(['judgment.dc', 'judgment.minutes'].concat(run.step('judge').clamps!.some((c) => c.path === 'judgment.degree') ? ['judgment.degree'] : []).sort())
    expect(run.step('reward').clamps![0]).toMatchObject({ from: 99999999, to: 120 })
    expect(sectionOf(fake!.requestsFor('narrate')[0]!, 'results')).toBe('1. 拿到：現金 120')
    expect(JSON.stringify(fake!.requestsFor('narrate')[0])).not.toContain('99999999')
    for (const c of reports[0]!.clamps!) expect(PLAIN(c.notice), c.notice).toBe(true)
    // 夾值不算出錯：不自動重試
    expect(fake!.requestsFor('judge')).toHaveLength(1)
    expect(fake!.requestsFor('reward')).toHaveLength(1)
  })

  it('關、asked 對得上：判定的最大組合（DC 2、時間 9999、大成功）與回報 99,999,999 照給，不留夾值的記號', async () => {
    const { game: g } = game({
      ai: { ai: 1, clamp_asked: 0 },
      fake: { byTask: { judge: [judgeOk({ degree: 'critical', dc: 2, minutes: 9999, asked: '心軟給了我' })], reward: [{ json: { items: [{ kind: 'cash', amount: 99999999, asked: ASKED, from: { source: 'player', quote: ASKED } }] } }] } },
    })
    const start = minutesOf(g.state)
    const { run, reports } = await g.act({ kind: 'beg', text: TEXT })
    expect(run.step('judge').marks).toEqual([])
    expect(run.step('reward').marks).toEqual([])
    expect(reports[0]!.clamps).toBeUndefined()
    expect(reports[0]!.timeline[0]!.roll).toMatchObject({ dc: 2, degree: 'critical' })
    expect(minutesOf(g.state) - start).toBe(9999)
    expect(g.state.money.cash).toBe(99999999)
  })

  it('開、asked 對得上：照樣夾（附 asked 只讓任務鏈列看得到玩家要了什麼）', async () => {
    const { game: g, fake } = game({
      ai: { ai: 1, clamp_asked: 1 },
      fake: { byTask: { judge: [judgeOk({ dc: 2, minutes: 9999, asked: '心軟給了我' })], reward: [{ json: { items: [{ kind: 'cash', amount: 99999999, asked: ASKED, from: { source: 'player', quote: ASKED } }] } }] } },
    })
    const { run } = await g.act({ kind: 'beg', text: TEXT })
    expect(run.step('judge').clamps!.find((c) => c.path === 'judgment.dc')).toMatchObject({ from: 2, to: 10 })
    expect(g.state.money.cash).toBe(120)
    expect(fake!.requestsFor('reward')).toHaveLength(1)
  })

  it('asked 對不上玩家輸入（關）：當成 AI 自己生成的，照上限夾、報告卡提醒；不算失敗、不重試', async () => {
    const { game: g, fake } = game({ ai: { ai: 1, clamp_asked: 0 }, fake: { adversarial: { mode: 'asked_mismatch', tasks: ['judge', 'reward'] } } })
    const { run, reports } = await g.act({ kind: 'beg', text: TEXT })
    expect(run.step('judge').status).toBe('done')
    expect(run.step('judge').clamps!.find((c) => c.path === 'judgment.dc')).toMatchObject({ from: 2, to: 10 })
    expect(run.step('reward').status).toBe('done')
    expect(g.state.money.cash).toBeLessThanOrEqual(120)
    expect(reports[0]!.clamps!.length).toBeGreaterThan(0)
    expect(fake!.requests.length).toBe(3)
  })

  it('不存在的 id、少欄位：驗證不過算失敗，自動重試帶 <previous_error>（只帶錯誤、引用欄位的路徑）；都失敗後 reward 用退路', async () => {
    for (const mode of ['unknown_id', 'missing_field'] as const) {
      const { game: g, fake } = game({ ai: { ai: 1, clamp_asked: 0, retry: { reward: 1 } }, fake: { byTask: { judge: [judgeOk()] }, adversarial: { mode, tasks: ['reward'] } } })
      const { run } = await g.act({ kind: 'beg', text: TEXT })
      const reqs = fake!.requestsFor('reward')
      expect(reqs, mode).toHaveLength(2)
      const prev = sectionOf(reqs[1]!, 'previous_error')!
      expect(prev, mode).toMatch(/reward\.items\[\d\]/)
      expect(prev, mode).not.toContain('"from"')
      expect(run.step('reward').status, mode).toBe('fallback')
      expect(g.state.inventory, mode).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 7. 自動重試的次數（AI_TASKS 5.3 節：0～3，預設 1）、逾時與拒絕（2.6 節）

describe('邊界 AI_TASKS 5.3／2.6：自動重試的次數、逾時、拒絕', () => {
  it('設定：−1 收成 0、4 收成 3、小數四捨五入、不是數字的不收（用預設 1）；* 是其他任務的預設', () => {
    const s = sanitizeAiSettings({ retry: { judge: -1, reward: 4, narrate: 1.5, polish: 'x', relate: Number.NaN, '*': 2 } })
    expect(s.retry).toEqual({ judge: 0, reward: RETRY_MAX, narrate: 2, '*': 2 })
    expect(retriesFor(s, 'polish')).toBe(2)
    expect(retriesFor(sanitizeAiSettings({}), 'judge')).toBe(RETRY_DEFAULT)
    expect(RETRY_MAX).toBe(3)
  })

  for (const [retry, requests] of [[0, 1], [1, 2], [3, 4], [4, 4], [-1, 1]] as const) {
    it(`壞掉的 JSON、retry = ${retry}：判定送出 ${requests} 次，都失敗後停下來等玩家（狀態不變）`, async () => {
      const { game: g, fake } = game({ ai: { ai: 1, retry: { judge: retry } }, fake: { adversarial: { mode: 'bad_json', tasks: ['judge'] } } })
      const before = clone(g.state)
      const r = await g.act({ kind: 'beg', text: TEXT })
      expect(fake!.requestsFor('judge')).toHaveLength(requests)
      expect(r.status).toBe('paused')
      expect(r.run.step('judge').status).toBe('failed')
      expect(g.state.money).toEqual(before.money)
      expect(g.state.time).toEqual(before.time)
      // 第一次沒有 previous_error；之後每一次都有，而且不含上一次的原始回應
      fake!.requestsFor('judge').forEach((q, i) => {
        const prev = sectionOf(q, 'previous_error')
        if (i === 0) expect(prev).toBeNull()
        else {
          expect(prev).toMatch(/JSON/)
          expect(prev).not.toContain('少了結尾')
        }
      })
    })
  }

  it('拒絕：retry = 3 也只送一次，不換備用模型；判定與寫正文都一樣', async () => {
    for (const task of ['judge', 'narrate']) {
      const { game: g, fake } = game({ ai: { ai: 1, retry: { [task]: 3 } }, fake: { adversarial: { mode: 'refusal', tasks: [task] } } })
      const r = await g.act({ kind: 'beg', text: TEXT })
      expect(fake!.requestsFor(task), task).toHaveLength(1)
      expect(r.status, task).toBe('paused')
      expect(r.run.step(task === 'judge' ? 'judge' : 'text').error?.kind, task).toBe('refusal')
    }
  })

  it('逾時與串流中斷：會自動重試（retry = 2 → 送 3 次）；逾時的重試不帶 previous_error；reward 都失敗後用退路', async () => {
    for (const mode of ['timeout', 'stream_break'] as const) {
      const { game: g, fake } = game({ ai: { ai: 1, retry: { reward: 2 } }, idleTimeoutMs: 20, fake: { byTask: { judge: [judgeOk()] }, adversarial: { mode, tasks: ['reward'] } } })
      const r = await g.act({ kind: 'beg', text: TEXT })
      expect(fake!.requestsFor('reward'), mode).toHaveLength(3)
      expect(r.run.step('reward').status, mode).toBe('fallback')
      for (const q of fake!.requestsFor('reward')) expect(sectionOf(q, 'previous_error'), mode).toBeNull()
      expect(r.status, mode).toBe('applied')
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 8. 對照 <covered>（AI_TASKS 4.1 節 narrate；不變式 18）

describe('邊界 AI_TASKS 4.1：<covered> 的對照', () => {
  it('splitCovered：空、只有開頭標籤、超出範圍的編號、重複、不是數字', () => {
    expect(splitCovered('正文')).toEqual({ text: '正文', covered: null })
    expect(splitCovered('正文\n<covered></covered>')).toEqual({ text: '正文', covered: [] })
    expect(splitCovered('正文\n<covered>1,1,2')).toEqual({ text: '正文', covered: [1, 1, 2] })
    expect(splitCovered('正文\n<covered>0, 99, 一</covered>')).toEqual({ text: '正文', covered: [0, 99] })
  })

  const twoItems = { json: { items: [{ kind: 'cash', amount: 12, from: { source: 'degree' } }, { kind: 'cred', amount: 30, from: { source: 'degree' } }] } }
  const cases: Array<[string, string, number[]]> = [
    ['全寫到', '<covered>1,2</covered>', []],
    ['少一行', '<covered>1</covered>', [2]],
    ['沒有交', '', [1, 2]],
    ['空的', '<covered></covered>', [1, 2]],
    ['編號超出範圍（0、3）', '<covered>0,3</covered>', [1, 2]],
    ['重複', '<covered>2,2</covered>', [1]],
  ]
  for (const [name, tail, uncovered] of cases) {
    it(`${name}：沒寫到 = [${uncovered.join(',')}]；不算失敗、不自動重試、不改任何結果`, async () => {
      const { game: g, fake } = game({ ai: { ai: 1, retry: { narrate: 3 } }, fake: { byTask: { judge: [judgeOk()], reward: [twoItems], narrate: [{ text: `路人丟下東西。\n${tail}` }] } } })
      const { run, reports } = await g.act({ kind: 'beg', text: TEXT })
      expect(run.step('text').status).toBe('done')
      expect(run.step('text').marks).toEqual(uncovered.length ? ['uncovered'] : [])
      expect(fake!.requestsFor('narrate')).toHaveLength(1)
      expect(g.state.money).toEqual({ cash: 12, cred: 30 })
      expect(reports[0]!.narration!.results).toEqual(['拿到：現金 12', '拿到：帳戶 30'])
      expect(reports[0]!.narration!.uncovered ?? []).toEqual(uncovered)
      expect(reports[0]!.narration!.text).not.toMatch(/covered/)
    })
  }

  it('沒有結果的時候（<results> 是空的），沒交 <covered> 也不標記號', async () => {
    const { game: g } = game({ ai: { ai: 1 }, fake: { byTask: { judge: [judgeOk()], reward: [{ json: { items: [] } }], narrate: [{ text: '什麼都沒有發生。' }] } } })
    const { run } = await g.act({ kind: 'beg', text: TEXT })
    expect(run.step('text').marks).toEqual([])
  })

  it('手動重試一個「沒寫到」的寫正文：漏掉的那幾行帶進 <previous_error>；結果的步驟不重跑', async () => {
    const { game: g, fake } = game({ ai: { ai: 1 }, fake: { byTask: { judge: [judgeOk()], reward: [twoItems], narrate: [{ text: '只寫了一半。\n<covered>1</covered>' }] } } })
    await g.act({ kind: 'beg', text: TEXT })
    await g.retryStep('text')
    const reqs = fake!.requestsFor('narrate')
    expect(reqs).toHaveLength(2)
    expect(sectionOf(reqs[1]!, 'previous_error')).toMatch(/第 2 行/)
    expect(fake!.requestsFor('reward')).toHaveLength(1)
    expect(fake!.requestsFor('judge')).toHaveLength(1)
    expect(g.state.money).toEqual({ cash: 12, cred: 30 })
  })
})
