// 白箱：事件的 adult_scene.gate: ai 走 scene_gate 的接口（shell/ai/eventGate.ts）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：AI_TASKS 3.5 節（scene_gate）；DATA 第 4 節（adult_scene.gate）；LEWD_SYSTEM 3.1 節（進場）、第 9 節（內容篩選：關掉的性質不出現在清單）；
// dev/adr/0019 M4-core-scene-ai 補記（缺的接口 4）；GAME_DESIGN 第 3 節（AI 交的先驗再用，驗不過維持原樣）。
// 一局：makeBodyGame 加三位成年 NPC；報告草稿自己組。

import { describe, expect, it } from 'vitest'
import type { Launch, ReportDraft } from '../../src'
import { applyGate, eventGateInput, gateInput, hasAiGate } from '../../src/shell/ai/eventGate'
import { makeBodyGame, sceneCast } from '../../src/testkit'

const g = makeBodyGame({ actors: sceneCast('ann', 'bo', 'cy'), at: { block: 'tw_tower', marker: 'E1' } }).game
const { k, state } = g
const id = (n: string) => `npc_tw_${n}`
const draft = (launch: Launch[]): ReportDraft => ({ kind: 'event', action: 'event.test', location: {}, party: [], timeline: [], changes: [], outcome: { result: 'success', summary: '摘要一句。' }, launch })
const gateLaunch = (setup: Record<string, unknown> = {}): Launch => ({ kind: 'scene', setup: { gate: 'ai', with: [id('ann')], nature: 'mutual', ...setup } as never, origin: { by: 'test' } } as never)

describe('hasAiGate／eventGateInput', () => {
  it('只有 launch 的 scene 帶 gate: ai 才算；沒有 launch、別種活動、gate 是別的值都不算', () => {
    expect(hasAiGate(draft([gateLaunch()]))).toBe(true)
    expect(hasAiGate({ ...draft([]), launch: undefined })).toBe(false)
    expect(hasAiGate(draft([]))).toBe(false)
    expect(hasAiGate(draft([{ kind: 'dive', setup: { gate: 'ai' } } as never]))).toBe(false)
    expect(hasAiGate(draft([gateLaunch({ gate: 'fixed' })]))).toBe(false)
    expect(hasAiGate(draft([{ kind: 'scene', setup: 'x' } as never]))).toBe(false)
  })
  it('沒有要問的場景、或沒有主角：丟錯（呼叫的人要先 hasAiGate）', () => {
    expect(() => eventGateInput(k, state, draft([]))).toThrow(/沒有要問 scene_gate 的場景/)
    const noPc = { ...state, pc: null } as typeof state
    expect(() => eventGateInput(k, noPc, draft([gateLaunch()]))).toThrow()
  })
  it('寫了性質：fixed 帶性質、目的（none 不帶）、場所、with、circles；沒寫性質：沒有 fixed；forced 的事件 forced: true', () => {
    const a = eventGateInput(k, state, draft([gateLaunch({ role: 'top', goal: 'please', place: '塔下' })]))
    expect(a.fixed).toMatchObject({ nature: 'mutual', role: 'top', goal: 'please', place: '塔下', with: [id('ann')] })
    expect(a.trigger).toMatchObject({ action: '事件', degree: 'success', summary: '摘要一句。', place: '塔下' })
    expect(a.forced).toBe(false)
    const b = eventGateInput(k, state, draft([gateLaunch({ goal: 'none' })]))
    expect(b.fixed && 'goal' in b.fixed).toBe(false)
    const c = eventGateInput(k, state, draft([gateLaunch({ nature: undefined })]))
    expect(c.fixed).toBeUndefined()
    const d = eventGateInput(k, state, draft([gateLaunch({ nature: 'forced', circles: [['pc', id('ann'), id('bo')], [id('cy')]], with: undefined })]))
    expect(d.forced).toBe(true)
    expect(d.fixed?.circles).toEqual([['pc', id('ann'), id('bo')], [id('cy')]])
    expect(d.cast.map((x) => x.id)).toEqual([id('ann'), id('bo'), id('cy')])
  })
  it('在場的人：circles 展開並去重、去掉主角；查不到的角色（不在狀態裡）不列；with 不是陣列也不丟錯', () => {
    const a = eventGateInput(k, state, draft([gateLaunch({ with: [id('ann'), id('ann'), 'pc', 'npc_nobody'] })]))
    expect(a.cast.map((x) => x.id)).toEqual([id('ann')])
    const b = eventGateInput(k, state, draft([gateLaunch({ with: 'ann' })]))
    expect(b.cast).toEqual([])
    const c = eventGateInput(k, state, draft([gateLaunch({ with: undefined, circles: [['pc', 5, id('bo')], 'x'] })]))
    expect(c.cast.map((x) => x.id)).toEqual([id('bo')])
  })
})

describe('gateInput：可選的性質與目的依內容篩選刪過', () => {
  it('篩選關掉「主角非自願」：性質清單裡沒有被迫；全開時有', () => {
    const base = gateInput(k, state, { cast: [id('ann')], trigger: { action: 'x', degree: 'success', summary: '' }, forced: false })
    expect(base.natures.map((n) => n.id)).toContain('forced')
    const off = { ...state, rules: { ...state.rules, contentOff: [...state.rules.contentOff, 'pc_unwilling'] } }
    const filtered = gateInput(k, off, { cast: [id('ann')], trigger: { action: 'x', degree: 'success', summary: '' }, forced: false })
    expect(filtered.natures.map((n) => n.id)).not.toContain('forced')
    expect(filtered.goals.length).toBeGreaterThan(0)
  })
})

describe('applyGate：把 scene_gate 的答案換進報告的 launch', () => {
  it('沒有答案（AI 沒交、走了退路）：launch 一個字不動（回 null）', () => {
    expect(applyGate(k, state, draft([gateLaunch()]), undefined)).toEqual({ launch: null })
  })
  it('AI 說不進：拿掉那一筆（別的 launch 留著）；理由當備註；說進但沒有性質也拿掉', () => {
    const other = { kind: 'dive', setup: { site: 'x' }, origin: { by: 'test' } } as never
    const r = applyGate(k, state, draft([other, gateLaunch()]), { enter: false, reason: '現在不適合。' })
    expect(r.launch).toEqual([other])
    expect(r.note).toBe('現在不適合。')
    expect(applyGate(k, state, draft([gateLaunch()]), { enter: true, reason: 'x' }).launch).toEqual([])
  })
  it('AI 說進：性質、目的、分圈換進設定，gate 改成 fixed、其餘的鍵原樣；不是 gate: ai 的 launch 原樣', () => {
    const fixedScene = { kind: 'scene', setup: { gate: 'fixed', with: [id('bo')], nature: 'work' }, origin: { by: 'test' } } as never
    const r = applyGate(k, state, draft([fixedScene, gateLaunch({ place: '塔下' })]), { enter: true, nature: 'trade', goal: 'please', reason: '好。' })
    expect(r.launch).toHaveLength(2)
    expect(r.launch![0]).toEqual(fixedScene)
    expect(r.launch![1]!.setup).toMatchObject({ gate: 'fixed', nature: 'trade', goal: 'please', place: '塔下', with: [id('ann')] })
    expect(r.note).toBeUndefined()
  })
  it('換進去的設定過不了 startProblems（例：分圈裡有場外的人）：維持原樣，只把 gate 改成 fixed（走照寫的）', () => {
    const r = applyGate(k, state, draft([gateLaunch({ nature: 'mutual', with: undefined, circles: [['pc', id('ann')]] })]), { enter: true, nature: 'trade', circles: [['pc', 'npc_nobody']], reason: 'x' })
    expect(r.launch![0]!.setup).toMatchObject({ gate: 'fixed', nature: 'mutual', circles: [['pc', id('ann')]] })
    // 對照：with 與 circles 都給時 with 優先、circles 不看（所以場外的人不會被擋；這是 startProblems 的優先順序，不是 applyGate 的事）
  })
  it('原本的 launch 陣列不被改：回傳的是複本', () => {
    const l = gateLaunch()
    const d = draft([l])
    applyGate(k, state, d, { enter: true, nature: 'trade', reason: 'x' })
    expect((d.launch![0]!.setup as Record<string, unknown>).gate).toBe('ai')
  })
})
