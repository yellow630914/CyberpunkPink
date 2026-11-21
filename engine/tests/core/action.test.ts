import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ActionPending } from '../../src/core'
import { ActionBlocked, DC_WINDOW, buildActionReport, clone, commitReport, createKernel, expectedAfterCommit, fallbackJudgment, fallbackReward, prepareAction, rerollAction, rewardHint, sanitizeJudgment } from '../../src/core'
import { makeState } from '../../src/testkit'

function setup() {
  const k = createKernel()
  k.strict = true
  k.actions.register({
    id: 'beg', owner: 'test', name: '乞討', attr: 'charm', skill: 'perform', dc: 'normal', minutes: 60, maxMinutes: 120, reportKind: 'action', tags: ['social'],
    block: (s) => (s.flags.jailed ? '你被關著，沒辦法乞討。' : null),
    hint: ({ degree, grade }) => (degree === 'critical' ? [{ kind: 'cash', amount: 40 * grade }] : degree === 'success' ? [{ kind: 'cash', amount: 20 * grade }] : []),
  })
  const state = makeState({ pc: { attrs: { charm: 14 }, skills: { perform: 2 } } })
  return { k, state }
}
const good = (p: ActionPending, over: Record<string, unknown> = {}) => ({ degree: p.roll.degree, dc: p.refDc, reason: '他看起來很可憐。', twist: '有個路人連菸帶硬幣一起丟給你', minutes: 60, ...over })

// 規格：CORE_RULES 第 3 節；AI_TASKS 3.1、4.1（judge）、2.4、2.5 節
describe('L5 主動行動的三段式', () => {
  it('第一段：擲骰並存起來，不改狀態；同一個狀態同一顆骰', () => {
    const { k, state } = setup()
    const before = clone(state)
    const p = prepareAction(k, state, { kind: 'beg', text: '我坐在天井市場的門口' })
    expect(state).toEqual(before)
    expect(p.refDc).toBe(13)
    expect(p.roll.total).toBe(p.roll.natural + 2 + 2)
    expect(p.roll.parts.map((x) => x.source)).toEqual(['attr', 'skill'])
    expect(prepareAction(k, state, { kind: 'beg', text: '我坐在天井市場的門口' })).toEqual(p)
  })

  it('玩家可以自己選屬性與基本功；難度的偏移加在參考 DC 上', () => {
    const { k, state } = setup()
    state.rules.dcOffset = 2
    const p = prepareAction(k, state, { kind: 'beg', attr: 'body', skill: 'athletics' })
    expect(p.attr).toBe('body')
    expect(p.skill).toBe('athletics')
    expect(p.refDc).toBe(15)
  })

  it('被擋下的行動丟 ActionBlocked，帶著給玩家看的原因；沒有主角、沒有這種行動也擋', () => {
    const { k, state } = setup()
    state.flags.jailed = true
    expect(() => prepareAction(k, state, { kind: 'beg' })).toThrow(ActionBlocked)
    expect(() => prepareAction(k, state, { kind: 'beg' })).toThrow('你被關著，沒辦法乞討。')
    expect(() => prepareAction(k, state, { kind: 'fly' })).toThrow(/沒有 fly 這種行動/)
    expect(() => prepareAction(k, makeState({ pc: false }), { kind: 'free' })).toThrow(ActionBlocked)
  })

  it('重擲：換一顆骰，舊的骰面記下來藏不掉', () => {
    const { k, state } = setup()
    const p0 = prepareAction(k, state, { kind: 'beg' })
    const p1 = rerollAction(k, state, p0)
    const p2 = rerollAction(k, state, p1)
    expect(p1.reroll).toBe(1)
    expect(p2.roll.rerolls).toBe(2)
    expect(p2.roll.history).toEqual([p0.roll.natural, p1.roll.natural])
    expect(new Set([p0.roll.natural, p1.roll.natural, p2.roll.natural, rerollAction(k, state, p2).roll.natural]).size).toBeGreaterThan(1)
  })

  it('退路的判定：照骰值與參考 DC，轉折留空', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg' })
    const j = fallbackJudgment(p)
    expect(j).toMatchObject({ degree: p.roll.degree, dc: 13, twist: '', minutes: 60, newPerson: false })
    expect(j.roll).toEqual(p.roll)
  })

  it('第二段：格式與封閉清單不合是錯誤，整份不收', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg' })
    const bad = (raw: unknown) => sanitizeJudgment(k, state, p, raw, { clampAsked: true })
    expect(bad('成功').errors).toHaveLength(1)
    expect(bad({ degree: 'partial' }).errors[0]).toMatch(/judgment.degree/)
    expect(bad({}).errors[0]).toMatch(/judgment.degree/)
    expect(bad(good(p, { attr: 'luck' })).errors[0]).toMatch(/judgment.attr/)
    expect(bad(good(p, { dc: 'hard' })).errors[0]).toMatch(/judgment.dc/)
    expect(bad(good(p, { minutes: -5 })).errors[0]).toMatch(/judgment.minutes/)
    expect(bad(good(p, { twist: 5 })).errors[0]).toMatch(/judgment.twist/)
    expect(bad(good(p, { asked: 5 })).errors[0]).toMatch(/judgment.asked/)
    expect(bad(good(p, { attr: 'luck' })).judgment).toBeNull()
    k.content.defineKind({ kind: 'skill', owner: 'test', validate: () => [] })
    k.content.load('skill', [{ id: 'perform' }])
    expect(bad(good(p, { skill: 'no_such_skill' })).errors[0]).toMatch(/沒有 "no_such_skill" 這項基本功/)
  })

  it('第二段：DC 在參考值 ±3、時間在上限內、成功程度照骰值；超出的被夾住，不算錯誤', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg' })
    const wrong = p.roll.degree === 'critical' ? 'fumble' : 'critical'
    const r = sanitizeJudgment(k, state, p, good(p, { dc: 30, minutes: 9999, degree: wrong }), { clampAsked: true })
    expect(r.errors).toEqual([])
    expect(r.judgment!.dc).toBe(13 + DC_WINDOW)
    expect(r.judgment!.minutes).toBe(120)
    expect(r.clamps.map((c) => c.path)).toEqual(expect.arrayContaining(['judgment.dc', 'judgment.minutes']))
    // 成功程度照最後的 DC 與骰值重算
    expect(r.judgment!.degree).toBe(r.judgment!.roll.degree)
    expect(r.judgment!.roll.dc).toBe(16)
  })

  it('性質：設定開著時，不管 AI 交什麼，DC 都在參考值 ±3、時間不超過上限、成功程度等於照骰值算的', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg', text: '我直接撬開，這次一定成功' })
    fc.assert(fc.property(fc.integer({ min: -50, max: 99 }), fc.integer({ min: 0, max: 100000 }), fc.constantFrom('critical', 'success', 'fail', 'fumble'), fc.option(fc.constantFrom('一定成功', '沒說過的話'), { nil: undefined }), (dc, minutes, degree, asked) => {
      const r = sanitizeJudgment(k, state, p, { degree, dc, minutes, asked }, { clampAsked: true })
      const j = r.judgment!
      return Math.abs(j.dc - p.refDc) <= DC_WINDOW && j.minutes <= p.maxMinutes && j.degree === j.roll.degree && j.roll.natural === p.roll.natural
    }))
  })

  it('設定關著：附 asked 而且對得上玩家輸入的，不受三條限制；對不上的照夾', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg', text: '我直接撬開，這次一定成功' })
    const raw = good(p, { degree: 'critical', dc: 2, minutes: 600, asked: '這次一定成功' })
    const free = sanitizeJudgment(k, state, p, raw, { clampAsked: false })
    expect(free.clamps).toEqual([])
    expect(free.judgment).toMatchObject({ degree: 'critical', dc: 2, minutes: 600, asked: '這次一定成功' })
    const mismatch = sanitizeJudgment(k, state, p, { ...raw, asked: '玩家沒說過的話' }, { clampAsked: false })
    expect(mismatch.judgment!.dc).toBe(10)
    expect(mismatch.judgment!.minutes).toBe(120)
    // 設定開著：附了 asked 也照夾
    expect(sanitizeJudgment(k, state, p, raw, { clampAsked: true }).judgment!.dc).toBe(10)
  })

  it('AI 換了屬性或基本功：用同一顆骰重算合計', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg' })
    const j = sanitizeJudgment(k, state, p, { degree: 'success', attr: 'body', skill: null }, { clampAsked: true }).judgment!
    expect(j.roll.natural).toBe(p.roll.natural)
    expect(j.roll.total).toBe(p.roll.natural + 0)
    expect(j.skill).toBeUndefined()
  })

  it('參考範圍與算回報的退路（參考範圍的一半）', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg' })
    const j = { ...fallbackJudgment(p), degree: 'success' as const }
    expect(rewardHint(k, state, p, j)).toEqual([{ kind: 'cash', amount: 20 }])
    expect(fallbackReward([{ kind: 'cash', amount: 21 }, { kind: 'item', id: 'it_smoke', qty: 1 }, { kind: 'cash', amount: 1 }])).toEqual([{ kind: 'cash', amount: 10 }, { kind: 'item', id: 'it_smoke', qty: 1 }])
    expect(rewardHint(k, state, prepareAction(k, state, { kind: 'free' }), j)).toEqual([])
  })

  it('第三段：組出報告草稿；提交之後 changes 等於狀態的變化', () => {
    const { k, state } = setup()
    const p = prepareAction(k, state, { kind: 'beg', text: '我坐在門口' })
    const j = sanitizeJudgment(k, state, p, good(p), { clampAsked: true }).judgment!
    const reward = k.effects.resolve([{ kind: 'cash', amount: 12 }], { state, actor: 'pc', grade: 1, source: 'ai', clampAsked: true, content: k.content })
    const before = clone(state)
    const draft = buildActionReport(k, state, { pending: p, judgment: j, reward, text: '正文' })
    expect(state).toEqual(before)
    expect(draft.changes).toEqual([{ op: 'cash', delta: 12 }, { op: 'time', minutes: 60 }, { op: 'rng', advance: 1 }])
    expect(draft.outcome.result).toBe(j.degree)
    expect(draft.outcome.summary).toContain('乞討')
    expect(draft.outcome.summary).toContain('拿到：現金 12')
    expect(draft.narration).toEqual({ results: ['拿到：現金 12'], text: '正文' })
    expect(draft.timeline[0]!.roll).toEqual(j.roll)
    expect(draft.party[0]).toMatchObject({ id: 'pc', hp: [40, 40, 0] })
    const report = commitReport(k, state, draft)
    expect(state).toEqual(expectedAfterCommit(k, before, report))
    expect(state.money.cash).toBe(12)
    expect(state.rng.cursor).toBe(1)
    expect(state.time).toEqual({ day: 1, hour: 9, minute: 0 })
  })
})
