// 驗收測試：dev/work/M0-actions.md（交給 cpp-feature）。
// 工單完成前這個檔會失敗（engine/src/features/actions 還不存在）。跑法：在 engine/ 跑 npx vitest run --config vitest.pending.config.ts M0-actions
// 完成後：git mv engine/tests/pending/M0-actions.test.ts engine/tests/features/M0-actions.test.ts，主套件要全過。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Kernel } from '../../src'
import { ActionBlocked, createKernel, fallbackJudgment, prepareAction, readyFeatures, rewardHint } from '../../src'
import { actionsFeature } from '../../src/features/actions'
import { makeGame, makeState } from '../../src/testkit'
import { MINI_PACK } from '../helpers/miniContent'

const ACTIONS = [
  {
    id: 'beg', name: '乞討', attr: 'charm', skill: 'perform', dc: 'easy', minutes: 60, max_minutes: 120, tags: ['social', 'street'],
    hint: { critical: [{ kind: 'cash', amount: 40 }], success: [{ kind: 'cash', amount: 20 }], narrow: [{ kind: 'cash', amount: 10 }] },
    hint_by_grade: { '3': { success: [{ kind: 'cash', amount: 200 }] } },
  },
  { id: 'pick_lock', name: '撬鎖', attr: 'tech', skill: 'mechanics', dc: 'hard', minutes: 10, max_minutes: 60, requires: { kind: 'has_item', id: 'it_lockpick' }, blocked_text: '你身上沒有開鎖的工具。' },
  { id: 'loiter', name: '閒晃', attr: 'intellect', dc: 'normal', minutes: 30, max_minutes: 30 },
]
const pack = (actions: unknown[] = ACTIONS): ContentPack => ({ id: 'actions', content: { action_kind: actions as never } })

function kernel(actions?: unknown[]): Kernel {
  const k = createKernel([actionsFeature])
  k.strict = true
  k.content.loadPack(MINI_PACK)
  k.content.loadPack(pack(actions))
  readyFeatures(k)
  return k
}
const judged = (k: Kernel, state: ReturnType<typeof makeState>, kind: string, degree: 'critical' | 'success' | 'fail' | 'fumble', margin: number) => {
  const p = prepareAction(k, state, { kind })
  const j = fallbackJudgment(p)
  return rewardHint(k, state, p, { ...j, degree, roll: { ...j.roll, degree, margin } })
}

describe('M0-actions：行動種類由資料驅動（AI_TASKS 3.1 節；CORE_RULES 第 3 節）', () => {
  it('功能的 id 是 actions', () => {
    expect(actionsFeature.id).toBe('actions')
  })

  it('內容載入之後，每一筆 action_kind 都註冊成行動種類；核心內建的 free 還在', () => {
    const k = kernel()
    expect(k.actions.list().map((a) => a.id).sort()).toEqual(['beg', 'free', 'loiter', 'pick_lock'])
    const beg = k.actions.get('beg')!
    expect(beg).toMatchObject({ owner: 'actions', name: '乞討', attr: 'charm', skill: 'perform', dc: 'easy', minutes: 60, maxMinutes: 120, reportKind: 'action', tags: ['social', 'street'] })
    expect(k.actions.get('loiter')!.skill).toBeUndefined()
  })

  it('參考 DC 照檔位、加上難度的偏移', () => {
    const k = kernel()
    expect(prepareAction(k, makeState(), { kind: 'beg' }).refDc).toBe(10)
    expect(prepareAction(k, makeState({ patch: { inventory: [{ id: 'it_lockpick', qty: 1 }] } }), { kind: 'pick_lock' }).refDc).toBe(16)
    const hard = makeState()
    hard.rules.dcOffset = 2
    expect(prepareAction(k, hard, { kind: 'beg' }).refDc).toBe(12)
  })

  it('有 requires 的行動：條件不成立時擋下，原因是 blocked_text', () => {
    const k = kernel()
    expect(() => prepareAction(k, makeState(), { kind: 'pick_lock' })).toThrow(ActionBlocked)
    expect(() => prepareAction(k, makeState(), { kind: 'pick_lock' })).toThrow('你身上沒有開鎖的工具。')
    expect(() => prepareAction(k, makeState({ patch: { inventory: [{ id: 'it_lockpick', qty: 1 }] } }), { kind: 'pick_lock' })).not.toThrow()
  })

  it('參考範圍照成功程度：大成功、成功、差距不到 3 的成功、失敗各一份', () => {
    const k = kernel()
    const s = makeState()
    expect(judged(k, s, 'beg', 'critical', 9)).toEqual([{ kind: 'cash', amount: 40 }])
    expect(judged(k, s, 'beg', 'success', 4)).toEqual([{ kind: 'cash', amount: 20 }])
    expect(judged(k, s, 'beg', 'success', 3)).toEqual([{ kind: 'cash', amount: 20 }])
    expect(judged(k, s, 'beg', 'success', 2)).toEqual([{ kind: 'cash', amount: 10 }])
    expect(judged(k, s, 'beg', 'fail', -2)).toEqual([])
    expect(judged(k, s, 'beg', 'fumble', -9)).toEqual([])
    // 沒有寫 hint 的行動：什麼都不給
    expect(judged(k, s, 'loiter', 'critical', 9)).toEqual([])
  })

  it('沒有另外寫 narrow 的那一級：差距不到 3 的成功用 success 那一份', () => {
    const k = kernel([{ ...ACTIONS[0], hint: { success: [{ kind: 'cash', amount: 20 }] }, hint_by_grade: undefined }])
    expect(judged(k, makeState(), 'beg', 'success', 1)).toEqual([{ kind: 'cash', amount: 20 }])
  })

  it('參考範圍照這一區的等級：用「不超過這一區等級、最近的那一級」的表', () => {
    const k = kernel()
    k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] })
    k.content.load('district', [{ id: 'd1', grade: 1 }, { id: 'd2', grade: 2 }, { id: 'd3', grade: 3 }, { id: 'd5', grade: 5 }])
    const at = (district: string) => makeState({ patch: { location: { district } } })
    expect(judged(k, at('d1'), 'beg', 'success', 5)).toEqual([{ kind: 'cash', amount: 20 }])
    expect(judged(k, at('d2'), 'beg', 'success', 5)).toEqual([{ kind: 'cash', amount: 20 }])
    expect(judged(k, at('d3'), 'beg', 'success', 5)).toEqual([{ kind: 'cash', amount: 200 }])
    expect(judged(k, at('d5'), 'beg', 'success', 5)).toEqual([{ kind: 'cash', amount: 200 }])
    // 那一級的表沒有寫這個成功程度：不給（不往別的等級找）
    expect(judged(k, at('d3'), 'beg', 'critical', 9)).toEqual([])
    // III 級的表沒有 narrow：用它自己的 success
    expect(judged(k, at('d3'), 'beg', 'success', 1)).toEqual([{ kind: 'cash', amount: 200 }])
  })

  it('回傳的參考範圍是複製的：改它不會改到內容', () => {
    const k = kernel()
    const hint = judged(k, makeState(), 'beg', 'critical', 9)
    hint[0]!.amount = 999999
    expect(judged(k, makeState(), 'beg', 'critical', 9)).toEqual([{ kind: 'cash', amount: 40 }])
  })

  it('格式錯誤在內容載入之後就擋下：和核心的行動撞名、條件的種類不存在、參考範圍裡有清單以外的效果、引用不存在的基本功', () => {
    expect(() => kernel([{ ...ACTIONS[2], id: 'free' }])).toThrow(/free/)
    expect(() => kernel([{ ...ACTIONS[1], requires: { kind: 'moon_phase' } }])).toThrow(/moon_phase/)
    expect(() => kernel([{ ...ACTIONS[0], hint: { success: [{ kind: 'summon_dragon', amount: 1 }] } }])).toThrow(/summon_dragon/)
    expect(() => kernel([{ ...ACTIONS[0], hint: { success: [{ kind: 'cash', amount: 'lots' }] } }])).toThrow()
    expect(() => kernel([{ ...ACTIONS[0], skill: 'juggling' }])).toThrow(/juggling/)
  })

  it('整條鏈：AI 關閉時乞討成功拿到參考範圍的一半', async () => {
    const { game } = makeGame({ features: [actionsFeature], content: [MINI_PACK, pack()], pc: { attrs: { charm: 18 }, skills: { perform: 6 } } })
    const r = await game.act({ kind: 'beg', text: '我坐在天井市場的門口' })
    expect(r.status).toBe('applied')
    const degree = r.reports[0]!.outcome.result
    const narrow = degree === 'success' && r.reports[0]!.timeline[0]!.roll!.margin < 3
    expect(game.state.money.cash).toBe(degree === 'critical' ? 20 : degree === 'success' ? (narrow ? 5 : 10) : 0)
    expect(r.reports[0]!.outcome.summary).toContain('乞討')
    expect(game.state.time).toEqual({ day: 1, hour: 9, minute: 0 })
  })
})
