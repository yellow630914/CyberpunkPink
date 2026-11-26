// 白箱：features/sink 的治療與斷線靜修（therapy.ts、retreat.ts）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：DOWNTIME 3.3 節（心理治療每週最多一次、斷線靜修、沉溺 100 以上「靜修沒用」）；CORE_RULES 4.3 節；dev/adr/0019 第六節；M4-fix-engine（斷線靜修是進行中的活動）。
// 內容是測試自帶的最小假資料（和 tests/features/M4-sink.test.ts 同一套：一條街、四種設施）。會失敗的那一條（B032）在 tests/pending/B032-retreat-settles-when-sunk.test.ts。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, effectCtx, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import { restFeature } from '../../src/features/rest'
import { retreatOf, retreatStayBlock, retreatStayDraft, sinkFeature, therapyBlock, therapyDraft, therapyProblems, therapyQuote } from '../../src/features/sink'
import { arrive, worldFeature } from '../../src/features/world'
import { METER_CONTENT, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
} as never

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_counsel', name: '蜜腺療養院', therapy: { kind: 'counsel' } },
      { id: 'fac_retreat', name: '傳教所', therapy: { kind: 'retreat' } },
      { id: 'fac_counsel_free', name: '義診所', therapy: { kind: 'counsel', free: true } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '療養街', kind: 'block', map: 'm_street', exits: {}, facilities: {
      F1: { type: 'fac_counsel', name: '療養院' }, F2: { type: 'fac_retreat', name: '傳教所' }, F4: { type: 'fac_counsel_free', name: '義診所' },
    } }],
    sink_rule: [{ id: 'default', watchers: ['f_alpha', 'f_beta'] }],
  }
  patch(c)
  return { id: 'sink_wb', content: c as unknown as ContentPack['content'] }
}

const make = (o: { pc?: Rec; pack?: ContentPack; extra?: Feature[] } = {}) => {
  const meters = meterFeature(testMeter({ kind: 'hostility', owner: 'security', name: '敵對值', keyed: 'faction' }), testMeter({ kind: 'favor', owner: 'security', name: '好感', keyed: 'faction' }))
  const { game } = makeGame({
    features: [meters, characterFeature, worldFeature, restFeature, sinkFeature, ...(o.extra ?? [])], content: [METER_CONTENT, o.pack ?? pack()], seed: 7, pc: { hp: 40, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 20000, cash: 1000 } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const pc = (g: G) => g.state.actors.pc! as unknown as { sink: number; ext: { sink: { therapy_n?: number; therapy_week: number } } }
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const counselRule = (counsel: Rec) => pack((c) => { c.sink_rule = [{ id: 'default', watchers: ['f_alpha', 'f_beta'], therapy: { counsel } }] })

describe('心理治療每週的次數（DOWNTIME 3.3 節「每週最多一次」；規則表 therapy.counsel.per_week 可以蓋）', () => {
  it('per_week 2：同一週第二次照做、第三次擋下；次數記在 actor.ext.sink（therapy_week、therapy_n）', () => {
    const g = make({ pc: { sink: 40 }, pack: counselRule({ per_week: 2 }) })
    stand(g, 'F4')
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).ext.sink).toMatchObject({ therapy_n: 1 })
    expect(therapyBlock(g.k, g.state)).toBeNull()
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).ext.sink).toMatchObject({ therapy_n: 2 })
    expect(pc(g).sink).toBe(30)
    expect(therapyBlock(g.k, g.state)).toBe('這一週已經做過心理治療了，下個週一再來。')
    expect(reasonOf(() => therapyDraft(g.k, g.state))).toBe('這一週已經做過心理治療了，下個週一再來。')
  })

  it('預設一次：過了週一之後計數從 1 重新算（不是接著上一週的加）', () => {
    const g = make({ pc: { sink: 40 } })
    stand(g, 'F4')
    g.commit(therapyDraft(g.k, g.state))
    const week0 = pc(g).ext.sink.therapy_week
    expect(therapyBlock(g.k, g.state)).toMatch(/這一週已經/)
    // 第 3 天 14:00 → 第 7 天 06:00 之後是下一週
    g.commit(draft([{ op: 'time', minutes: toMinutes({ day: 7, hour: 7, minute: 0 }) - toMinutes(g.state.time) }], 'test.wait'))
    expect(therapyBlock(g.k, g.state)).toBeNull()
    g.commit(therapyDraft(g.k, g.state))
    expect(pc(g).ext.sink.therapy_week).toBe(week0 + 1)
    expect(pc(g).ext.sink.therapy_n).toBe(1)
  })
})

describe('治療的擋下與原因（DOWNTIME 3.3 節；therapy.ts 的 plan）', () => {
  it('沉溺已經在 0（沒有下限）：用不著治療；有下限、沉溺就在下限上：義體撐著的那一句', () => {
    const g = make({ pc: { sink: 0 } })
    stand(g, 'F4')
    expect(therapyBlock(g.k, g.state)).toBe('你現在很清明，用不著治療。')
    const h = make({ pc: { sink: 10 } })
    // 用 sink_floor 效果墊一個 10 的下限（內建的來源）
    const ctx = effectCtx(h.k, h.state, { source: 'builtin', actor: 'pc' })
    const res = h.k.effects.resolve([{ kind: 'sink_floor', amount: 10 }] as never, ctx)
    expect(res.errors).toEqual([])
    h.commit(draft(res.changes, 'test.fx'))
    stand(h, 'F4')
    expect(therapyBlock(h.k, h.state)).toBe('你已經浮在身上的義體撐著的最低處，治療幫不上忙。')
  })

  it('好感的勢力在內容裡查不到：載入時就擋下並指出是哪一種設施（不留到玩家走進去才發現）', () => {
    const bad = pack((c) => {
      c.facility_type!.push({ id: 'fac_retreat_ghost', name: '查不到勢力的傳教所', therapy: { kind: 'retreat', favor: { faction: 'f_ghost', min: 20 } } })
    })
    expect(() => make({ pack: bad })).toThrow(/fac_retreat_ghost：therapy.favor 的勢力 f_ghost 查不到/)
  })

  it('therapyProblems 不給選項也能叫（預設主角、腳下的那一種）；沒有主角的局回「還沒有主角」', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F1')
    expect(therapyProblems(g.k, g.state)).toEqual([])
    expect(therapyQuote(g.k, g.state)).toMatchObject({ kind: 'counsel', price: 1000, minutes: 240, amount: 5, pay: 'cred' })
    expect(therapyProblems(g.k, g.state, { actor: 'nobody' })).toEqual(['還沒有主角。'])
  })

  it('錢不夠、指定付現金也不夠：原因寫「現金付不起」；不指定寫「帳戶與現金」', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F1')
    g.commit(draft([{ op: 'cash', delta: -500 }], 'test.money'))
    expect(therapyBlock(g.k, g.state, { pay: 'cash' })).toBe('錢不夠：心理治療要 1,000，現金付不起。')
    expect(therapyBlock(g.k, g.state)).toBeNull()
    g.commit(draft([{ op: 'cred', delta: -20000 }], 'test.money'))
    expect(therapyBlock(g.k, g.state)).toMatch(/^錢不夠：心理治療要 1,000，帳戶與現金付不起。$/)
  })
})

describe('斷線靜修進行中（DOWNTIME 3.3 節；retreat.ts）', () => {
  it('進行中又開了別的活動（事件視窗之類）時，時間到了也先不結算；那件事做完才結算', () => {
    const g = make({ pc: { sink: 30 } })
    stand(g, 'F2')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    // 一份事件的報告把時間推過結束：手上沒有別的活動 → 接著結算
    const rs = g.commit(draft([{ op: 'time', minutes: 3 * 1440 }], 'event.test'))
    expect(rs.map((r) => r.action)).toEqual(['event.test', 'sink.retreat'])
    expect(retreatOf(g.state)).toBeNull()
    expect(pc(g).sink).toBe(24)
  })

  it('待不下去的原因：不在靜修；在靜修時沒有別的擋就是 null', () => {
    const g = make({ pc: { sink: 30 } })
    expect(retreatStayBlock(g.k, g.state)).toBe('你現在不在斷線靜修。')
    stand(g, 'F2')
    g.commit(therapyDraft(g.k, g.state, { kind: 'retreat' }))
    expect(retreatStayBlock(g.k, g.state)).toBeNull()
    // 最後一天只過剩下的：先用事件推掉 2 天 23 小時，剩 60 分鐘
    g.commit(draft([{ op: 'time', minutes: 3 * 1440 - 60 }], 'event.test'))
    const before = toMinutes(g.state.time)
    const rs = g.commit(retreatStayDraft(g.k, g.state))
    expect(toMinutes(g.state.time) - before).toBe(60)
    expect(rs.map((r) => r.outcome.result)).toEqual(['last_day', 'done'])
  })
})
