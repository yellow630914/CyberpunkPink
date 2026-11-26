// 邊界：成人場景六個 AI 任務與收尾兩個任務的回答格式（驗證與夾值），AI 交來什麼都不能把狀態弄壞（M4 邊界，cpp-tester-boundary）。
// 規格：AI_TASKS 3.5～3.8 節（場景的 gate、turn、talk、sex_record、sink、tendency 與收尾的 reward、relate）、第 1 節第 12 條（格式錯一律重試、不寫入）、
// LEWD_SYSTEM 3.1 節（進場）、3.5 節（一步最多 12 個行動、契合與目的的夾值）、第 7 節（沉溺的一場上限）；EVENTS 2.4（AI 的效果是封閉清單）。
// 做法：直接拿註冊在 game.tasks 的任務的 check，丟各種壞的、邊界的、惡意的回答；好的收、壞的一條一句話指出欄位、夾值有 clamps。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ClampNote } from '../../src'
import { MAX_MOVES, NOTE_LEN } from '../../src/features/scene'
import { TALK_FIT, TALK_GOAL, TURN_LINE_MAX, sceneRelateCheck, sceneRewardCheck, moveShape } from '../../src/shell/ai/sceneTasks'
import { makeBodyGame } from '../../src/testkit'

const g = makeBodyGame().game
const ctx = { settings: {} as never }
const check = (id: string, raw: unknown, input: unknown): { ok: true; value: any; clamps?: ClampNote[] } | { ok: false; errors: string[] } => g.tasks.get(id)!.check(raw, input as never, ctx as never) as never
const errs = (r: ReturnType<typeof check>): string[] => (r.ok ? [] : r.errors)

// ---- scene_gate ----

const GATE = {
  pc: { id: 'pc', name: '主角' },
  cast: [{ id: 'a', name: 'A', affinity: 0, tags: [] }, { id: 'b', name: 'B', affinity: 0, tags: [] }, { id: 'c', name: 'C', affinity: 0, tags: [] }, { id: 'd', name: 'D', affinity: 0, tags: [] }, { id: 'e', name: 'E', affinity: 0, tags: [] }, { id: 'f', name: 'F', affinity: 0, tags: [] }, { id: 'h', name: 'H', affinity: 0, tags: [] }, { id: 'i', name: 'I', affinity: 0, tags: [] }],
  trigger: { action: 'flirt', degree: 'success', summary: '成功' },
  natures: [{ id: 'mutual', name: '兩情相悅' }, { id: 'trade', name: '交易' }],
  goals: [{ id: 'please', name: '讓對方滿意' }],
  forced: false,
}

describe('scene_gate 的回答（AI_TASKS 3.5 節；LEWD_SYSTEM 3.1 節）', () => {
  const ok = { enter: true, nature: 'mutual' }
  it('合格的收；理由超過 300 字只留前 300 字；不進場景的只要 enter: false', () => {
    expect(check('scene_gate', ok, GATE)).toMatchObject({ ok: true, value: { enter: true, nature: 'mutual', reason: '' } })
    const long = check('scene_gate', { ...ok, reason: `  ${'字'.repeat(400)}  ` }, GATE)
    expect(long.ok && long.value.reason.length).toBe(300)
    expect(check('scene_gate', { enter: false }, GATE)).toMatchObject({ ok: true, value: { enter: false, reason: '' } })
    // enter: false 時多餘的欄位（連壞掉的 nature）一律不看
    expect(check('scene_gate', { enter: false, nature: 12, circles: 'x' }, GATE).ok).toBe(true)
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['不是物件', 'enter', /\(root\)/],
    ['null', null, /\(root\)/],
    ['陣列', [], /\(root\)/],
    ['enter 不是布林', { enter: 'true' }, /enter：要是 true 或 false/],
    ['reason 不是字串', { enter: true, nature: 'mutual', reason: 5 }, /reason：要是一句話/],
    ['沒有 nature', { enter: true }, /nature：要是 <natures> 清單裡的一個/],
    ['nature 不在清單', { enter: true, nature: 'worship' }, /nature：要是 <natures>/],
    ['nature 是原型的鍵', { enter: true, nature: '__proto__' }, /nature：要是 <natures>/],
    ['情境不是被迫卻選被迫', { enter: true, nature: 'forced' }, /nature/],
    ['goal 不在清單', { ...ok, goal: 'nope' }, /goal：要是 <goals> 清單裡的一個/],
    ['circles 不是陣列', { ...ok, circles: 'a' }, /circles：要是一串圈/],
    ['circles 裡有不是陣列的圈', { ...ok, circles: ['pc', 'a'] }, /circles：要是一串圈/],
    ['circles 裡有不是字串的 id', { ...ok, circles: [['pc', 3]] }, /circles：要是一串圈/],
    ['有一圈是空的', { ...ok, circles: [['pc'], []] }, /每一圈要有一到 4 個人/],
    ['有一圈超過四個人', { ...ok, circles: [['pc', 'a', 'b', 'c', 'd']] }, /每一圈要有一到 4 個人/],
    ['同一個人在兩圈', { ...ok, circles: [['pc', 'a'], ['a', 'b']] }, /每個人只能在一圈裡/],
    ['圈裡有場外的人', { ...ok, circles: [['pc', 'zzz']] }, /只能用 <cast> 裡的人與主角/],
    ['主角不在任何一圈', { ...ok, circles: [['a', 'b']] }, /主角要在其中一圈裡/],
    ['一場超過 8 個人', { ...ok, circles: [['pc', 'a', 'b', 'c'], ['d', 'e', 'f', 'h'], ['i']] }, /一場最多 8 個人/],
  ]
  for (const [what, raw, re] of bad) {
    it(`${what}：不收，指出欄位`, () => {
      const r = check('scene_gate', raw, GATE)
      expect(r.ok).toBe(false)
      expect(errs(r).some((m) => re.test(m)), errs(r).join('|')).toBe(true)
    })
  }
  it('被迫的情境可以選被迫；goal 寫 none、空字串、null 都當沒有；9 個人剛好超過，8 個人剛好收', () => {
    expect(check('scene_gate', { enter: true, nature: 'forced' }, { ...GATE, forced: true, natures: [...GATE.natures, { id: 'forced', name: '被迫' }] }).ok).toBe(true)
    for (const goal of ['none', '', null]) expect(check('scene_gate', { ...ok, goal }, GATE)).toMatchObject({ ok: true, value: { enter: true } })
    const r = check('scene_gate', { ...ok, goal: 'none' }, GATE)
    expect(r.ok && 'goal' in r.value).toBe(false)
    expect(check('scene_gate', { ...ok, circles: [['pc', 'a', 'b', 'c'], ['d', 'e', 'f', 'h']] }, GATE).ok).toBe(true)
  })
  it('退路：沒有明寫的設定就不進；有就照它進（圈是複本）', () => {
    const t = g.tasks.get('scene_gate')!
    expect(t.fallback(GATE as never, ctx as never)).toMatchObject({ enter: false })
    const fixed = { nature: 'trade', goal: 'please', circles: [['pc', 'a']] }
    const out = t.fallback({ ...GATE, fixed } as never, ctx as never) as { circles: string[][] }
    expect(out).toMatchObject({ enter: true, nature: 'trade', goal: 'please' })
    out.circles[0]!.push('x')
    expect(fixed.circles[0]).toEqual(['pc', 'a'])
  })
})

// ---- scene_turn ----

describe('scene_turn 的回答：對方這一回合的行動（一步最多 12 個；一句話 60 字）', () => {
  const t = (raw: unknown) => check('scene_turn', raw, {})
  it('合格的收；空行動合格（功能照規則走）', () => {
    expect(t({ moves: [], line: '她笑了。' })).toMatchObject({ ok: true, value: { moves: [], line: '她笑了。' } })
  })
  it('剛好 12 個不夾，13 個夾到 12 並留下夾值的記號；後面的丟掉', () => {
    const mk = (n: number) => ({ moves: Array.from({ length: n }, (_, i) => ({ kind: 'tease', target: `t${i}` })), line: 'x' })
    const a = t(mk(MAX_MOVES))
    expect(a.ok && a.value.moves).toHaveLength(MAX_MOVES)
    expect(a.ok && a.clamps).toBeUndefined()
    const b = t(mk(MAX_MOVES + 1))
    expect(b.ok && b.value.moves).toHaveLength(MAX_MOVES)
    expect(b.ok && b.value.moves[MAX_MOVES - 1].target).toBe(`t${MAX_MOVES - 1}`)
    expect(b.ok && b.clamps?.[0]).toMatchObject({ path: 'moves', from: MAX_MOVES + 1, to: MAX_MOVES })
    const c = t(mk(10_000))
    expect(c.ok && c.value.moves).toHaveLength(MAX_MOVES)
  })
  it('一句話剛好 60 字不夾；61 字夾到 60；前後的空白先去掉', () => {
    expect(t({ moves: [], line: '字'.repeat(TURN_LINE_MAX) })).toMatchObject({ ok: true, value: { line: '字'.repeat(TURN_LINE_MAX) } })
    const r = t({ moves: [], line: `  ${'字'.repeat(TURN_LINE_MAX + 1)}  ` })
    expect(r.ok && r.value.line.length).toBe(TURN_LINE_MAX)
    expect(r.ok && r.clamps?.[0]).toMatchObject({ path: 'line', from: TURN_LINE_MAX + 1, to: TURN_LINE_MAX })
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['不是物件', 7, /\(root\)/],
    ['沒有 moves', { line: 'x' }, /moves：要是一串行動/],
    ['moves 是物件', { moves: {}, line: 'x' }, /moves：要是一串行動/],
    ['沒有 line', { moves: [] }, /line：要是一句動作或台詞/],
    ['line 是數字', { moves: [], line: 5 }, /line/],
    ['行動不是物件', { moves: ['tease'], line: 'x' }, /moves\[0\]：要是 \{ kind/],
    ['行動是 stop', { moves: [{ kind: 'stop' }], line: 'x' }, /moves\[0\]：不能選「停下」/],
    ['行動種類不在清單（換圈是主角才有的）', { moves: [{ kind: 'move_circle', circle: 'c1' }], line: 'x' }, /種類不在 <legal>/],
    ['行動種類是原型的鍵', { moves: [{ kind: 'constructor' }], line: 'x' }, /種類不在 <legal>/],
    ['skill 沒有 id', { moves: [{ kind: 'skill' }], line: 'x' }, /skill 要指明是哪一個/],
    ['item 的 id 是數字', { moves: [{ kind: 'item', id: 4 }], line: 'x' }, /item 要指明/],
    ['switch 沒有 position', { moves: [{ kind: 'switch' }], line: 'x' }, /switch 要指明/],
    ['gear 不認得', { moves: [{ kind: 'gear', gear: 'turbo' }], line: 'x' }, /gear 要是/],
    ['once 的 id 不認得', { moves: [{ kind: 'once', id: 'win' }], line: 'x' }, /once 要指明/],
    ['once 的 value 是 NaN', { moves: [{ kind: 'once', id: 'set_init', value: NaN }], line: 'x' }, /value 要是數字/],
    ['once 的 value 是字串', { moves: [{ kind: 'once', id: 'set_init', value: '70' }], line: 'x' }, /value 要是數字/],
    ['target 是空字串', { moves: [{ kind: 'tease', target: '' }], line: 'x' }, /target 要是角色的 id/],
    ['talk 的 text 是數字', { moves: [{ kind: 'talk', text: 9 }], line: 'x' }, /text 要是一句話/],
    ['pick 不是物件', { moves: [{ kind: 'tease', pick: 'hand' }], line: 'x' }, /pick 要是/],
    ['pick.my_part 是數字', { moves: [{ kind: 'tease', pick: { my_part: 3 } }], line: 'x' }, /pick 要是/],
  ]
  for (const [what, raw, re] of bad) {
    it(`${what}：整份不收，指出是第幾個行動`, () => {
      const r = t(raw)
      expect(r.ok).toBe(false)
      expect(errs(r).some((m) => re.test(m)), errs(r).join('|')).toBe(true)
    })
  }
  it('好壞混在一起：好的也不收（整份重來），每一個壞的各一句', () => {
    const r = t({ moves: [{ kind: 'tease' }, { kind: 'stop' }, { kind: 'skill' }, { kind: 'dominate' }], line: 'x' })
    expect(r.ok).toBe(false)
    expect(errs(r)).toHaveLength(2)
    expect(errs(r)[0]).toMatch(/moves\[1\]/)
    expect(errs(r)[1]).toMatch(/moves\[2\]/)
  })
  it('moveShape 只留行動的欄位：AI 偷塞的 ap、cost、__proto__、who 都不會帶進去；talk 的文字最多 200 字', () => {
    const r = moveShape({ kind: 'skill', id: 'nt_x', ap: 0, cost: -5, who: 'pc', __proto__: { polluted: 1 }, constructor: 'x', target: 'a', pick: { my_part: 'hand', their_part: 'back', zzz: 1 } })
    expect(r).toEqual({ move: { kind: 'skill', id: 'nt_x', target: 'a', pick: { my_part: 'hand', their_part: 'back' } } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const talk = moveShape({ kind: 'talk', text: '話'.repeat(500) }) as { move: { text: string } }
    expect(talk.move.text).toHaveLength(200)
  })
  it('退路是空行動加空的一句話（功能用自己的中性描述）', () => {
    expect(g.tasks.get('scene_turn')!.fallback({} as never, ctx as never)).toEqual({ moves: [], line: '' })
  })
})

// ---- scene_talk ----

describe('scene_talk 的回答：說話的判定（契合 −5～+10、目的 0～+20）', () => {
  const t = (raw: unknown) => check('scene_talk', raw, {})
  it('邊界：−5、+10、+20 剛好收，不留夾值的記號', () => {
    for (const fit of [TALK_FIT[0], 0, TALK_FIT[1]]) expect(t({ fit })).toMatchObject({ ok: true, value: { fit } })
    const r = t({ fit: 3, goal: TALK_GOAL[1] })
    expect(r.ok && r.clamps).toBeUndefined()
  })
  it('超過就夾，並留記號（路徑、原值、夾後的值）；小數四捨五入後才夾', () => {
    const a = t({ fit: 11 })
    expect(a.ok && a.value.fit).toBe(TALK_FIT[1])
    expect(a.ok && a.clamps?.[0]).toMatchObject({ path: 'scene_talk.fit', from: 11, to: TALK_FIT[1] })
    const b = t({ fit: -6 })
    expect(b.ok && b.value.fit).toBe(TALK_FIT[0])
    expect(t({ fit: 10.4 })).toMatchObject({ ok: true, value: { fit: 10 } })
    expect(t({ fit: 10.5 }).ok && (t({ fit: 10.5 }) as { clamps?: unknown }).clamps).toBeTruthy()
    const c = t({ fit: 0, goal: 21 })
    expect(c.ok && c.value.goal).toBe(TALK_GOAL[1])
    const d = t({ fit: 0, goal: -3 })
    expect(d.ok && d.value.goal).toBe(TALK_GOAL[0])
    expect(t({ fit: 0, goal: 0 })).toMatchObject({ ok: true, value: { goal: 0 } })
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['不是物件', 'fit', /\(root\)/],
    ['沒有 fit', {}, /fit：要是數字/],
    ['fit 是字串', { fit: '3' }, /fit：要是數字/],
    ['fit 是 NaN', { fit: NaN }, /fit：要是數字/],
    ['fit 是 Infinity', { fit: Infinity }, /fit：要是數字/],
    ['goal 是字串', { fit: 1, goal: 'x' }, /goal：要是數字/],
    ['agree 是字串', { fit: 1, agree: 'yes' }, /agree：要是 true 或 false/],
    ['reason 是數字', { fit: 1, reason: 4 }, /reason/],
  ]
  for (const [what, raw, re] of bad) {
    it(`${what}：不收`, () => {
      const r = t(raw)
      expect(r.ok).toBe(false)
      expect(errs(r).some((m) => re.test(m)), errs(r).join('|')).toBe(true)
    })
  }
  it('goal、agree 寫 null 當沒寫；退路是沒有結果（null）', () => {
    const r = t({ fit: 1, goal: null, agree: null })
    expect(r.ok && 'goal' in r.value).toBe(false)
    expect(r.ok && 'agree' in r.value).toBe(false)
    expect(g.tasks.get('scene_talk')!.fallback({} as never, ctx as never)).toBeNull()
  })
  it('性質：任何有限的 fit 與 goal，夾完一定在範圍裡；四捨五入後的整數', () => {
    fc.assert(fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }), fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }), (fit, goal) => {
      const r = t({ fit, goal })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.fit).toBeGreaterThanOrEqual(TALK_FIT[0])
      expect(r.value.fit).toBeLessThanOrEqual(TALK_FIT[1])
      expect(r.value.goal).toBeGreaterThanOrEqual(TALK_GOAL[0])
      expect(r.value.goal).toBeLessThanOrEqual(TALK_GOAL[1])
      expect(Number.isInteger(r.value.fit)).toBe(true)
    }), { numRuns: 200 })
  })
})

// ---- sex_record、sink、tendency ----

describe('sex_record 的回答（只能記在場的人；類型照這一場的性質）', () => {
  const input = { nature: 'mutual', people: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], log: [], firsts: { people: [], positions: [], tags: [] }, types: ['mutual', 'trade'] }
  const t = (raw: unknown) => check('sex_record', raw, input)
  it('合格的收（kind 可以不寫）；空陣列合格；note 剛好 NOTE_LEN 不夾、多一個字夾掉', () => {
    expect(t({ records: [{ with: 'a', note: '一起看海。' }, { with: 'b', kind: 'trade', note: '付了錢。' }] })).toMatchObject({ ok: true })
    expect(t({ records: [] })).toMatchObject({ ok: true, value: { records: [] } })
    const a = t({ records: [{ with: 'a', note: '字'.repeat(NOTE_LEN) }] })
    expect(a.ok && a.clamps).toBeUndefined()
    const b = t({ records: [{ with: 'a', note: ` ${'字'.repeat(NOTE_LEN + 5)}` }] })
    expect(b.ok && b.value.records[0].note).toHaveLength(NOTE_LEN)
    expect(b.ok && b.clamps?.[0]).toMatchObject({ path: 'records[0].note', to: NOTE_LEN })
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['沒有 records', {}, /records：要是一串紀錄/],
    ['records 不是陣列', { records: 'a' }, /records：要是一串紀錄/],
    ['項目不是物件', { records: [3] }, /records\[0\]：要是一個物件/],
    ['with 不在場', { records: [{ with: 'zzz', note: 'x' }] }, /records\[0\]\.with：只能是在場的人/],
    ['with 是主角自己（不在 people 裡）', { records: [{ with: 'pc', note: 'x' }] }, /\.with/],
    ['note 不是字串', { records: [{ with: 'a', note: 5 }] }, /records\[0\]\.note：要是一句話/],
    ['kind 不在類型裡', { records: [{ with: 'a', note: 'x', kind: 'forced' }] }, /records\[0\]\.kind/],
    ['kind 是數字', { records: [{ with: 'a', note: 'x', kind: 3 }] }, /records\[0\]\.kind/],
  ]
  for (const [what, raw, re] of bad) {
    it(`${what}：不收`, () => {
      const r = t(raw)
      expect(r.ok).toBe(false)
      expect(errs(r).some((m) => re.test(m)), errs(r).join('|')).toBe(true)
    })
  }
})

describe('sink 的回答（一場最多動的點數照範圍夾；種類只能是這一場可以選的）', () => {
  const input = { nature: 'mutual', nature_name: '兩情相悅', kinds: ['anchor', 'other'], rule: { kind: 'anchor', amount: 1 }, range: [-2, 4], sink_now: 10, relations: [], log: [] }
  const t = (raw: unknown) => check('sink', raw, input)
  it('邊界：範圍的兩端剛好收；多 1 夾回來並留記號；小數四捨五入', () => {
    expect(t({ kind: 'anchor', amount: 4 })).toMatchObject({ ok: true, value: { amount: 4 } })
    expect(t({ kind: 'anchor', amount: -2 })).toMatchObject({ ok: true, value: { amount: -2 } })
    const a = t({ kind: 'anchor', amount: 5 })
    expect(a.ok && a.value.amount).toBe(4)
    expect(a.ok && a.clamps?.[0]).toMatchObject({ path: 'sink.amount', from: 5, to: 4, limit: 4 })
    const b = t({ kind: 'other', amount: -3 })
    expect(b.ok && b.value.amount).toBe(-2)
    expect(b.ok && b.clamps?.[0]).toMatchObject({ limit: -2 })
    expect(t({ kind: 'anchor', amount: 3.6 })).toMatchObject({ ok: true, value: { amount: 4 } })
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['不是物件', 1, /\(root\)/],
    ['kind 不在這一場的清單（這一場不是被迫的）', { kind: 'forced', amount: 1 }, /kind：要是 anchor、other/],
    ['kind 沒寫', { amount: 1 }, /kind：要是/],
    ['amount 是字串', { kind: 'anchor', amount: '2' }, /amount：要是數字/],
    ['amount 是 Infinity', { kind: 'anchor', amount: Infinity }, /amount：要是數字/],
    ['reason 是數字', { kind: 'anchor', amount: 1, reason: 1 }, /reason/],
  ]
  for (const [what, raw, re] of bad) {
    it(`${what}：不收`, () => {
      const r = t(raw)
      expect(r.ok).toBe(false)
      expect(errs(r).some((m) => re.test(m)), errs(r).join('|')).toBe(true)
    })
  }
  it('性質：任何有限的 amount，夾完一定在範圍裡', () => {
    fc.assert(fc.property(fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e12, max: 1e12 }), (amount) => {
      const r = t({ kind: 'anchor', amount })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.amount >= -2 && r.value.amount <= 4).toBe(true)
    }), { numRuns: 200 })
  })
})

describe('tendency 的回答（只能是這一場碰到的標籤；重複的去掉）', () => {
  const input = { touched: [{ id: 'tg_a', name: 'A', axis: 'relation' }, { id: 'tg_b', name: 'B', axis: 'body' }], log: [] }
  const t = (raw: unknown, i: unknown = input) => check('tendency', raw, i)
  it('合格的收並去重；空陣列合格', () => {
    expect(t({ tags: ['tg_a', 'tg_a', 'tg_b'] })).toMatchObject({ ok: true, value: { tags: ['tg_a', 'tg_b'] } })
    expect(t({ tags: [] })).toMatchObject({ ok: true, value: { tags: [] } })
  })
  it('壞的：不是物件、tags 不是陣列、有非字串、標籤不在清單（每個壞的各一句）、這一場沒列任何標籤', () => {
    expect(t('x').ok).toBe(false)
    expect(t({ tags: 'tg_a' }).ok).toBe(false)
    expect(t({ tags: ['tg_a', 5] }).ok).toBe(false)
    const r = t({ tags: ['tg_a', 'nope', 'zzz'] })
    expect(errs(r)).toHaveLength(2)
    expect(errs(r)[0]).toMatch(/tags\[1\]：不在 <touched>/)
    expect(errs(t({ tags: ['x'] }, { touched: [], log: [] }))[0]).toMatch(/這一場沒有列出任何標籤/)
  })
})

// ---- 收尾：reward 與 relate ----

describe('收尾的 reward：每一筆要有依據，再過效果登錄表（AI 的來源）', () => {
  const state = g.state
  const input = (lines: string[] = ['這一段是私下的時間。', '兩人一起吃了宵夜。']) => ({ scene: { lines } as never, state, hint: [] })
  const run = (raw: unknown, lines?: string[], asked = false) => sceneRewardCheck(g.k, raw, input(lines) as never, asked)
  it('空的 items 合格；source: settle 不需要引句；source: log 的引句要出現在摘要裡（去掉前後空白）', () => {
    expect(run({ items: [] }).ok).toBe(true)
    expect(run({ items: [{ kind: 'cash', amount: 5, from: { source: 'settle' } }] }).ok).toBe(true)
    expect(run({ items: [{ kind: 'cash', amount: 5, from: { source: 'log', quote: '  一起吃了宵夜 ' } }] }).ok).toBe(true)
  })
  const bad: Array<[string, unknown, RegExp]> = [
    ['不是物件', 'x', /reward\.items：要是一個陣列/],
    ['items 不是陣列', { items: {} }, /reward\.items/],
    ['項目不是物件', { items: [1] }, /reward\.items\[0\]：要是一個物件/],
    ['沒有依據', { items: [{ kind: 'cash', amount: 5 }] }, /\.from：每一筆都要有依據/],
    ['依據的 source 不是字串', { items: [{ kind: 'cash', amount: 5, from: { source: 3 } }] }, /\.from：每一筆都要有依據/],
    ['source 不認得', { items: [{ kind: 'cash', amount: 5, from: { source: 'dream' } }] }, /from\.source：只能是 settle 或 log/],
    ['log 沒有引句', { items: [{ kind: 'cash', amount: 5, from: { source: 'log' } }] }, /from\.quote：依據的那段字沒有出現/],
    ['引句是空白', { items: [{ kind: 'cash', amount: 5, from: { source: 'log', quote: '   ' } }] }, /from\.quote/],
    ['引句不在摘要裡', { items: [{ kind: 'cash', amount: 5, from: { source: 'log', quote: '她送了我一把劍' } }] }, /from\.quote/],
  ]
  for (const [what, raw, re] of bad) {
    it(`${what}：不收`, () => {
      const r = run(raw)
      expect(r.ok).toBe(false)
      expect(errs(r as never).some((m) => re.test(m)), errs(r as never).join('|')).toBe(true)
    })
  }
  it('有依據也過不了封閉清單：AI 不能用的效果（ai: false）與不存在的種類，整份不收', () => {
    const aiOff = g.k.effects.kinds().filter((kind) => !g.k.effects.aiKinds().includes(kind))
    expect(aiOff.length).toBeGreaterThan(5)
    for (const kind of aiOff) {
      const r = run({ items: [{ kind, from: { source: 'settle' } }] })
      expect(r.ok, kind).toBe(false)
    }
    expect(run({ items: [{ kind: 'no_such_effect', from: { source: 'settle' } }] }).ok).toBe(false)
  })
  it('依據的欄位 from 不會被當成效果的欄位帶進去（效果只剩原本的欄位）', () => {
    const r = run({ items: [{ kind: 'cash', amount: 5, from: { source: 'settle' } }] })
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r.ok ? r.value.changes : [])).not.toMatch(/settle|from/)
  })
})

describe('收尾的 relate：好感的變化夾在那個人的評價給的範圍', () => {
  const input = { scene: { lines: [] } as never, cast: [{ id: 'a', name: 'A', fit: 70, rating: '合拍', range: [-1, 3] as [number, number] }, { id: 'b', name: 'B', fit: 10, rating: '生疏', range: [0, 1] as [number, number] }] }
  const t = (raw: unknown) => sceneRelateCheck(raw, input)
  it('邊界：範圍兩端剛好收；多 1 夾回來並留記號；不在 cast 的人不收', () => {
    expect(t({ items: [{ id: 'a', amount: 3 }, { id: 'b', amount: 0 }] })).toMatchObject({ ok: true, value: { affinity: { a: 3, b: 0 } } })
    const r = t({ items: [{ id: 'a', amount: 4 }, { id: 'b', amount: -5 }] })
    expect(r.ok && r.value.affinity).toEqual({ a: 3, b: 0 })
    expect(r.ok && r.clamps?.map((c) => c.path)).toEqual(['relate.a', 'relate.b'])
    expect(t({ items: [{ id: 'pc', amount: 1 }] }).ok).toBe(false)
  })
  it('壞的：items 不是陣列、項目不是物件、amount 不是有限數字', () => {
    expect(t({}).ok).toBe(false)
    expect(t({ items: [5] }).ok).toBe(false)
    expect(errs(t({ items: [{ id: 'a', amount: NaN }] }) as never)[0]).toMatch(/amount：要是數字/)
    expect(errs(t({ items: [{ id: 'a', amount: '1' }] }) as never)[0]).toMatch(/amount/)
  })
  it('同一個人寫兩次，後面的蓋掉前面的（不會加起來）', () => {
    const r = t({ items: [{ id: 'a', amount: 2 }, { id: 'a', amount: 1 }] })
    expect(r.ok && r.value.affinity.a).toBe(1)
  })
})
