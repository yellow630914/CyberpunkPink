// 白箱測試：L4 規則核心（檢定、存檔規則、衍生數值、效果、條件）。
// 補主套件沒有走到的分支與錯誤路徑。每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { ConditionCtx, EffectCtx, GameState } from '../../src/core'
import {
  ConditionRegistry, EffectRegistry, MONEY_CAP_BY_GRADE, Probe, askedMatches, attrMod, checkParts, computeDegree, createKernel, dcFor, makeCheck, moneyCap, rollCheck,
  sanitizeRules, snapToLadder, verdictOf,
} from '../../src/core'
import { makeState } from '../../src/testkit'

const effCtx = (k: ReturnType<typeof createKernel>, state: GameState, o: Partial<EffectCtx> = {}): EffectCtx => ({
  state, actor: 'pc', grade: 1, source: 'ai', clampAsked: true, content: k.content, ...o,
})
const condCtx = (k: ReturnType<typeof createKernel>, state: GameState, o: Partial<ConditionCtx> = {}): ConditionCtx => ({
  state, stats: k.stats, timeRules: k.timeRules, ...o,
})

describe('白箱 L4 檢定（CORE_RULES 第 3 節；dev/invariants.md 第 26、27 條）', () => {
  it('成功程度：自然 20 與自然 1 寫死，壓過合計', () => {
    expect(computeDegree(20, 0, 25)).toBe('critical')
    expect(computeDegree(1, 99, 10)).toBe('fumble')
    expect(computeDegree(10, 18, 13)).toBe('critical')
    expect(computeDegree(10, 8, 13)).toBe('fumble')
    expect(computeDegree(10, 13, 13)).toBe('success')
    expect(computeDegree(10, 12, 13)).toBe('fail')
  })

  it('主持人的走向：成功差距不到 3 是「是，但是」，3 以上是「是」', () => {
    expect(verdictOf('success', 2)).toBe('yes_but')
    expect(verdictOf('success', 3)).toBe('yes')
    expect(verdictOf('fail', -1)).toBe('no_but')
    expect(verdictOf('critical', 0)).toBe('yes_and')
    expect(verdictOf('fumble', 0)).toBe('no_and')
  })

  it('調整值：（屬性 − 10）÷ 2 無條件捨去（負數往下）', () => {
    expect(attrMod(9)).toBe(-1)
    expect(attrMod(1)).toBe(-5)
    expect(attrMod(24)).toBe(7)
  })

  it('DC 的階梯：一樣近時取低的；超出兩端靠到端點', () => {
    expect(snapToLadder(11.5)).toBe(10)
    expect(snapToLadder(14.5)).toBe(13)
    expect(snapToLadder(-5)).toBe(10)
    expect(snapToLadder(99)).toBe(25)
  })

  it('dcFor：寫成數字的 DC 也加難度的偏移（BALANCE 7.2）', () => {
    expect(dcFor(16, { dcOffset: -2 })).toBe(14)
    expect(dcFor('mythic', { dcOffset: 4 })).toBe(29)
  })

  it('makeCheck：值是 0 的加值不記；沒有屬性、基本功時不放欄位', () => {
    const c = makeCheck({ natural: 10, parts: [{ label: 'a', value: 0, source: 'attr' }, { label: 'b', value: 2, source: 'skill' }], dc: 13 })
    expect(c.parts).toEqual([{ label: 'b', value: 2, source: 'skill' }])
    expect(c.total).toBe(12)
    expect('attr' in c).toBe(false)
    expect('skill' in c).toBe(false)
  })

  it('rollCheck、checkParts：沒有那個角色丟錯', () => {
    const k = createKernel()
    const s = makeState()
    expect(() => rollCheck(k.stats, s, { actor: 'ghost', attr: 'body', dc: 13, purpose: 'x' })).toThrow(/沒有 ghost/)
    expect(() => checkParts(k.stats, s, 'ghost', { attr: 'body', tags: [] })).toThrow(/沒有 ghost/)
  })

  it('rollCheck：同一個狀態、用途、重擲次數骰面一樣；換重擲次數換骰（AI_TASKS 2.4；dev/invariants.md 第 5 條）', () => {
    const k = createKernel()
    const s = makeState()
    const roll = (reroll?: number) => rollCheck(k.stats, s, { actor: 'pc', attr: 'body', skill: 'negotiate', dc: 13, purpose: 'p', reroll, situation: [{ label: '情境', value: 1, source: 'situation' }] })
    expect(roll().natural).toBe(roll(0).natural)
    const naturals = new Set([0, 1, 2, 3, 4, 5].map((r) => roll(r).natural))
    expect(naturals.size).toBeGreaterThan(1)
    // 基本功是 0 級時那一項不記（值是 0）
    expect(roll().parts.map((p) => p.source)).toEqual(['situation'])
  })
})

describe('白箱 L4 存檔規則（BALANCE 7.1～7.4；CHARACTER 5.6）', () => {
  it('不是物件時全部用預設值', () => {
    expect(sanitizeRules('x')).toEqual(sanitizeRules({}))
    expect(sanitizeRules(null).difficulty).toBe('normal')
  })

  it('預設的難度 DC 偏移跟著難度走，忽略存檔裡寫的；自訂夾在 −4～+4', () => {
    expect(sanitizeRules({ difficulty: 'story', dcOffset: 4 }).dcOffset).toBe(-2)
    expect(sanitizeRules({ difficulty: 'legend' }).dcOffset).toBe(2)
    expect(sanitizeRules({ difficulty: 'custom', dcOffset: 9 }).dcOffset).toBe(4)
    expect(sanitizeRules({ difficulty: 'custom', dcOffset: -9 }).dcOffset).toBe(-4)
    expect(sanitizeRules({ difficulty: 'custom', dcOffset: 'x' }).dcOffset).toBe(0)
    expect(sanitizeRules({ difficulty: 'nightmare' }).difficulty).toBe('normal')
  })

  it('其他欄位：倍率夾值、點數不低於 0、單項上限 0～6', () => {
    const r = sanitizeRules({ billMult: 9, defeatMoneyLoss: -1, xpMult: 0.1, startXp: -5, startSkillPoints: -1, startSkillMax: 9, startPerkPoints: -2, startCyberPoints: -3, startMoney: -100, defeatView: 'sometimes', fastTravel: 'yes' })
    expect(r).toMatchObject({ billMult: 2, defeatMoneyLoss: 0, xpMult: 0.5, startXp: 0, startSkillPoints: 0, startSkillMax: 6, startPerkPoints: 0, startCyberPoints: 0, startMoney: 0, defeatView: 'always', fastTravel: true })
  })
})

describe('白箱 L4 有效屬性與衍生數值（CORE_RULES 第 1 節；dev/invariants.md 第 30 條）', () => {
  it('有效屬性夾在 1～24；加值是 0 的來源不列出', () => {
    const k = createKernel()
    k.stats.addAttrProvider('wb', (_s, _a, attr) => [{ label: 'x', value: attr === 'body' ? 99 : attr === 'tech' ? -99 : 0, source: 'gear' }])
    const s = makeState()
    expect(k.stats.effectiveAttr(s, 'pc', 'body')).toBe(24)
    expect(k.stats.effectiveAttr(s, 'pc', 'tech')).toBe(1)
    expect(k.stats.attrParts(s, 'pc', 'charm')).toEqual([])
    expect(() => k.stats.effectiveAttr(s, 'ghost', 'body')).toThrow(/沒有 ghost/)
  })

  it('衍生數值：重複定義丟錯；沒定義的丟錯；min、max 夾住，沒寫時下限 0；* 的來源每一個數值都問', () => {
    const k = createKernel()
    const s = makeState()
    k.stats.defineStat({ id: 'x', owner: 'a', name: 'X', base: () => 5.7, max: 6 })
    k.stats.defineStat({ id: 'y', owner: 'a', name: 'Y', base: () => -10 })
    expect(() => k.stats.defineStat({ id: 'x', owner: 'b', name: 'X', base: () => 0 })).toThrow(/已經由 a 註冊/)
    expect(() => k.stats.stat(s, 'pc', 'nope')).toThrow(/沒有 nope 這個衍生數值/)
    expect(() => k.stats.statParts(s, 'pc', 'nope')).toThrow(/沒有 nope 這個衍生數值/)
    expect(k.stats.stat(s, 'pc', 'y')).toBe(0)
    k.stats.addStatProvider('*', 'all', (_s, _a, stat) => [{ label: 'all', value: stat === 'x' ? 10 : 0, source: 'perk' }])
    expect(k.stats.stat(s, 'pc', 'x')).toBe(6)
    expect(k.stats.statParts(s, 'pc', 'y')).toEqual([{ label: '基礎', value: -10, source: 'base' }])
  })

  it('屬性與基本功的名字：有內容用內容的，沒有用預設的中文或 id', () => {
    const k = createKernel()
    expect(k.stats.attrName('charm')).toBe('魅力')
    expect(k.stats.skillName('negotiate')).toBe('negotiate')
  })
})

describe('白箱 L4 效果的登錄表（EVENTS 2.4 封閉清單；AI_TASKS 2.5；dev/invariants.md 第 13、19、20、29 條）', () => {
  it('重複註冊丟錯；has、kinds', () => {
    const reg = new EffectRegistry(new Probe())
    reg.register({ kind: 'k', owner: 'a', validate: () => [], toChanges: () => [], describe: () => '' })
    expect(() => reg.register({ kind: 'k', owner: 'b', validate: () => [], toChanges: () => [], describe: () => '' })).toThrow(/已經由 a 註冊/)
    expect(reg.has('k')).toBe(true)
    expect(reg.kinds()).toEqual(['k'])
  })

  it('格式：不是陣列、不是物件、kind 不是字串、asked 不是字串，都是錯誤，changes 是空的', () => {
    const k = createKernel()
    const ctx = effCtx(k, makeState())
    expect(k.effects.resolve({ kind: 'cash' }, ctx).errors).toEqual(['effects：要是一個陣列'])
    expect(k.effects.validate([3], ctx)).toEqual(['effects[0]：要是一個物件'])
    expect(k.effects.validate([{ kind: 5 }], ctx)[0]).toMatch(/effects\[0\]\.kind：5 不在封閉清單裡/)
    expect(k.effects.validate([{ kind: 'cash', amount: 1, asked: 5 }], ctx)).toEqual(['effects[0].asked：要是玩家輸入裡的一段字'])
    const r = k.effects.resolve([{ kind: 'cash', amount: 1 }, { kind: 'cash', amount: 'x' }], ctx, 'reward')
    expect(r.errors).toEqual(['reward[1]：amount 要是整數'])
    expect(r.changes).toEqual([])
  })

  it('askedMatches：空白的 asked、沒有玩家輸入、不是字串都對不上；頭尾空白忽略', () => {
    expect(askedMatches('  ', '我要錢')).toBe(false)
    expect(askedMatches('錢', undefined)).toBe(false)
    expect(askedMatches(3, '3')).toBe(false)
    expect(askedMatches(' 要錢 ', '我要錢')).toBe(true)
  })

  it('錢：負的也夾在上限（−上限）；扣的錢不超過手上有的；提醒的兩種寫法', () => {
    const k = createKernel()
    const s = makeState({ patch: { money: { cred: 0, cash: 50 } } })
    const r = k.effects.resolve([{ kind: 'cash', amount: -500 }, { kind: 'cred', amount: 500 }], effCtx(k, s))
    expect(r.effects).toEqual([{ kind: 'cash', amount: -120 }, { kind: 'cred', amount: 120 }])
    expect(r.changes).toEqual([{ op: 'cash', delta: -50 }, { op: 'cred', delta: 120 }])
    expect(r.clamps.map((c) => c.notice)).toEqual(['這一區一次拿不走這麼多，實際少了 120 元。', '你要的比這一區給得起的多，實際拿到 120 元。'])
    expect(r.clamps[0]!.path).toBe('effects[0]')
  })

  it('錢：手上是 0 時扣錢不產生變更（delta 0 不記）', () => {
    const k = createKernel()
    const r = k.effects.resolve([{ kind: 'cred', amount: -10 }], effCtx(k, makeState()))
    expect(r.changes).toEqual([])
    expect(r.lines).toEqual(['失去：帳戶 10'])
  })

  it('錢的上限：沒有資料用內建的表；資料檔載入了就以資料為準；資料要寫滿五級（內容的格式檢查）', () => {
    const k = createKernel()
    expect(moneyCap({ content: k.content, grade: 3 })).toBe(MONEY_CAP_BY_GRADE[3])
    expect(() => k.content.loadPack({ id: 'caps', content: { effect_cap: [{ id: 'money', by_grade: { 1: 50 } }] } })).toThrow(/五個等級/)
    k.content.loadPack({ id: 'caps', content: { effect_cap: [{ id: 'money', by_grade: { 1: 50, 2: 60, 3: 70, 4: 80, 5: 90 } }] } })
    expect(moneyCap({ content: k.content, grade: 1 })).toBe(50)
    expect(moneyCap({ content: k.content, grade: 5 })).toBe(90)
  })

  it('time：hours 要是有限的 0 以上的數字；0 小時不產生變更；不另外夾（AI_TASKS 2.5）', () => {
    const k = createKernel()
    const ctx = effCtx(k, makeState())
    expect(k.effects.validate([{ kind: 'time', hours: -1 }], ctx)).toHaveLength(1)
    expect(k.effects.validate([{ kind: 'time', hours: 'x' }], ctx)).toHaveLength(1)
    expect(k.effects.resolve([{ kind: 'time', hours: 0 }], ctx).changes).toEqual([])
    expect(k.effects.resolve([{ kind: 'time', hours: 100 }], ctx).changes).toEqual([{ op: 'time', minutes: 6000 }])
  })

  it('flag：AI 與玩家要的旗標只能寫在 ai: 底下（EVENTS 2.2）；key、value 的格式', () => {
    const k = createKernel()
    const ctx = effCtx(k, makeState(), { source: 'player', clampAsked: false })
    expect(k.effects.validate([{ kind: 'flag', key: 'main_done', value: true }], ctx)[0]).toMatch(/ai: 開頭/)
    expect(k.effects.validate([{ kind: 'flag', key: '', value: true }], ctx)[0]).toMatch(/key 要是字串/)
    expect(k.effects.validate([{ kind: 'flag', key: 'ai:x', value: {} }], ctx)[0]).toMatch(/value 只能是/)
    const r = k.effects.resolve([{ kind: 'flag', key: 'ai:x', value: null }], ctx)
    expect(r.changes).toEqual([{ op: 'flag', key: 'ai:x', value: null }])
    expect(r.lines).toEqual(['記下：ai:x'])
  })

  it('item：目錄沒載入、不存在的、格式不對、拿走不夠，都是錯誤；等級超過這一區整筆拿掉（EVENTS 2.4 item）', () => {
    const k = createKernel()
    const s = makeState()
    expect(k.effects.validate([{ kind: 'item', id: 'it_a', qty: 1 }], effCtx(k, s))[0]).toMatch(/目錄還沒有載入/)
    k.content.defineKind({ kind: 'item', owner: 'wb', validate: () => [] })
    k.content.load('item', [{ id: 'it_a', name: '甲', grade: 1 }, { id: 'it_b', name: '乙', grade: 3 }, { id: 'it_c', name: '丙' }])
    expect(k.effects.validate([{ kind: 'item', id: 'Bad', qty: 1 }], effCtx(k, s))).toEqual(['effects[0]：id 的格式不對'])
    expect(k.effects.validate([{ kind: 'item', id: 'it_a', qty: 0 }], effCtx(k, s))).toEqual(['effects[0]：qty 要是不為 0 的整數'])
    expect(k.effects.validate([{ kind: 'item', id: 'it_z', qty: 1 }], effCtx(k, s))[0]).toMatch(/不存在的物品：it_z/)
    expect(k.effects.validate([{ kind: 'item', id: 'it_a', qty: -1 }], effCtx(k, s))[0]).toMatch(/不夠 1 個/)
    const r = k.effects.resolve([{ kind: 'item', id: 'it_b', qty: 1 }, { kind: 'item', id: 'it_c', qty: 2 }], effCtx(k, s))
    expect(r.effects).toEqual([{ kind: 'item', id: 'it_c', qty: 2 }])
    expect(r.clamps[0]).toMatchObject({ to: null, limit: 1, notice: '這一區拿不到乙這麼好的東西，所以這一樣沒有拿到。' })
    expect(r.lines).toEqual(['拿到：丙 ×2'])
    // 拿走（負數）不看等級
    const s2 = makeState({ patch: { inventory: [{ id: 'it_b', qty: 1 }] } })
    const r2 = k.effects.resolve([{ kind: 'item', id: 'it_b', qty: -1 }], effCtx(k, s2))
    expect(r2.lines).toEqual(['失去：乙'])
    expect(r2.clamps).toEqual([])
  })
})

describe('白箱 L4 條件（EVENTS 2.2 節）', () => {
  it('重複註冊丟錯；沒註冊的種類 test 時丟錯；cond 是空的算通過', () => {
    const reg = new ConditionRegistry(new Probe())
    reg.register({ kind: 'x', owner: 'a', validate: () => [], test: () => true })
    expect(() => reg.register({ kind: 'x', owner: 'b', validate: () => [], test: () => true })).toThrow(/已經由 a 註冊/)
    const k = createKernel()
    const ctx = condCtx(k, makeState())
    expect(() => k.conditions.test({ kind: 'nope' }, ctx)).toThrow(/沒有 nope 這種條件/)
    expect(k.conditions.test(null, ctx)).toBe(true)
    expect(k.conditions.test(undefined, ctx)).toBe(true)
  })

  it('all、any、not 的格式與組合；空的 all 是真、空的 any 是假', () => {
    const k = createKernel()
    expect(k.conditions.validate('x')).toEqual(['requires：要是一個物件'])
    expect(k.conditions.validate({ kind: 'all', of: 'x' })).toEqual(['requires.of：要是條件的陣列'])
    expect(k.conditions.validate({ kind: 'any', of: [{ kind: 'nope' }] })).toEqual(['requires.of[0].kind：沒有 "nope" 這種條件'])
    expect(k.conditions.validate({ kind: 'not', of: { kind: 'flag' } })).toEqual(['requires.of：key 要是字串'])
    expect(k.conditions.validate({ kind: 7 })).toEqual(['requires.kind：沒有 7 這種條件'])
    const ctx = condCtx(k, makeState({ patch: { flags: { a: true } } }))
    expect(k.conditions.test({ kind: 'all', of: [] }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'any', of: [] }, ctx)).toBe(false)
    expect(k.conditions.test({ kind: 'not', of: { kind: 'flag', key: 'a' } }, ctx)).toBe(false)
    expect(k.conditions.test({ kind: 'any', of: [{ kind: 'flag', key: 'b' }, { kind: 'flag', key: 'a' }] }, ctx)).toBe(true)
  })

  it('flag：沒寫 eq 時存在而且不是 false；寫了 eq 要相等', () => {
    const k = createKernel()
    const ctx = condCtx(k, makeState({ patch: { flags: { off: false, n: 0, s: 'x' } } }))
    expect(k.conditions.test({ kind: 'flag', key: 'off' }, ctx)).toBe(false)
    expect(k.conditions.test({ kind: 'flag', key: 'n' }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'flag', key: 'missing' }, ctx)).toBe(false)
    expect(k.conditions.test({ kind: 'flag', key: 'off', eq: false }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'flag', key: 's', eq: 'y' }, ctx)).toBe(false)
  })

  it('counter：沒有的計數器算 0；min、max 要是數字', () => {
    const k = createKernel()
    expect(k.conditions.validate({ kind: 'counter', key: 'n', min: '1' })).toHaveLength(1)
    expect(k.conditions.validate({ kind: 'counter', key: 3 })).toHaveLength(1)
    const ctx = condCtx(k, makeState({ patch: { counters: { n: 5 } } }))
    expect(k.conditions.test({ kind: 'counter', key: 'zero', max: 0 }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'counter', key: 'n', min: 6 }, ctx)).toBe(false)
    expect(k.conditions.test({ kind: 'counter', key: 'n', min: 5, max: 5 }, ctx)).toBe(true)
  })

  it('time：segment 與 weekday 的格式；min_day', () => {
    const k = createKernel()
    expect(k.conditions.validate({ kind: 'time', segment: ['midnight'] })[0]).toMatch(/segment 要是時段 id/)
    expect(k.conditions.validate({ kind: 'time', segment: 'morning' })[0]).toMatch(/segment/)
    expect(k.conditions.validate({ kind: 'time', weekday: [7] })[0]).toMatch(/weekday/)
    expect(k.conditions.validate({ kind: 'time', weekday: 1 })[0]).toMatch(/weekday/)
    expect(k.conditions.validate({ kind: 'time' })).toEqual([])
    const ctx = condCtx(k, makeState({ patch: { time: { day: 3, hour: 8, minute: 0 } } }))
    expect(k.conditions.test({ kind: 'time', min_day: 3 }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'time', min_day: 4 }, ctx)).toBe(false)
  })

  it('attr、skill：看 ctx.actor，沒給看主角；沒有主角或角色不存在時是假', () => {
    const k = createKernel()
    expect(k.conditions.validate({ kind: 'attr', attr: 'luck' })).toHaveLength(1)
    expect(k.conditions.validate({ kind: 'skill', skill: 3 })).toHaveLength(1)
    expect(k.conditions.validate({ kind: 'skill', skill: 'a', max: 'x' })).toHaveLength(1)
    const noPc = condCtx(k, makeState({ pc: false }))
    expect(k.conditions.test({ kind: 'attr', attr: 'body', min: 1 }, noPc)).toBe(false)
    expect(k.conditions.test({ kind: 'skill', skill: 'a', max: 6 }, noPc)).toBe(false)
    const s = makeState({ pc: { skills: { a: 2 } } })
    expect(k.conditions.test({ kind: 'attr', attr: 'body', min: 1 }, condCtx(k, s, { actor: 'ghost' }))).toBe(false)
    expect(k.conditions.test({ kind: 'skill', skill: 'a', min: 2 }, condCtx(k, s))).toBe(true)
    expect(k.conditions.test({ kind: 'skill', skill: 'b', max: 0 }, condCtx(k, s))).toBe(true)
  })

  it('money：wallet 只能是 cred、cash、total；total 是兩種相加', () => {
    const k = createKernel()
    expect(k.conditions.validate({ kind: 'money', wallet: 'bank' })).toHaveLength(1)
    const ctx = condCtx(k, makeState({ patch: { money: { cred: 30, cash: 20 } } }))
    expect(k.conditions.test({ kind: 'money', wallet: 'total', min: 50 }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'money', wallet: 'cash', min: 21 }, ctx)).toBe(false)
  })

  it('has_item：要有物品的 id；min 沒寫是 1，各疊相加', () => {
    const k = createKernel()
    expect(k.conditions.validate({ kind: 'has_item' })).toHaveLength(1)
    const ctx = condCtx(k, makeState({ patch: { inventory: [{ id: 'a', qty: 1 }, { id: 'a', qty: 2, data: { x: 1 } }] } }))
    expect(k.conditions.test({ kind: 'has_item', id: 'a' }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'has_item', id: 'a', min: 3 }, ctx)).toBe(true)
    expect(k.conditions.test({ kind: 'has_item', id: 'a', min: 4 }, ctx)).toBe(false)
    expect(k.conditions.test({ kind: 'has_item', id: 'b' }, ctx)).toBe(false)
  })
})
