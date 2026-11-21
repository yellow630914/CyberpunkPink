import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { Change, GameState, ReportDraft } from '../../src/core'
import { CHAIN_FLOORS_KEPT, ChangeError, MAX_FOLLOW_UP_DEPTH, clone, commitReport, commitReportAll, countItem, createKernel, deepEqual, expectedAfterCommit, underageAt } from '../../src/core'
import { commitViolations, makeActor, makeState } from '../../src/testkit'

const draft = (changes: Change[], extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' }, ...extra,
})
const kernel = () => {
  const k = createKernel()
  k.strict = true
  return k
}

// 規格：GAME_DESIGN 第 3 節第 1、3 條；dev/invariants.md 第 1、2、15、16 條
describe('L3 提交報告', () => {
  it('報告補上 id 與時間；changes 套用之後就是狀態的變化', () => {
    const k = kernel()
    const state = makeState({ patch: { money: { cred: 100, cash: 50 } } })
    const before = clone(state)
    const report = commitReport(k, state, draft([{ op: 'cash', delta: -20 }, { op: 'cred', delta: 5 }, { op: 'time', minutes: 90 }, { op: 'flag', key: 'met', value: true }, { op: 'counter', key: 'n', delta: 2 }]))
    expect(report.id).toBe('r1')
    expect(report.time).toEqual({ start: { day: 1, hour: 8, minute: 0 }, end: { day: 1, hour: 9, minute: 30 } })
    expect(state.money).toEqual({ cred: 105, cash: 30 })
    expect(state.flags.met).toBe(true)
    expect(state.counters.n).toBe(2)
    expect(state.reports).toHaveLength(1)
    expect(deepEqual(state, expectedAfterCommit(k, before, report))).toBe(true)
  })

  it('有一筆不合法：整份不套，狀態完全不變', () => {
    const k = kernel()
    const state = makeState({ patch: { money: { cred: 0, cash: 10 } } })
    const before = clone(state)
    expect(() => commitReport(k, state, draft([{ op: 'cash', delta: 5 }, { op: 'cash', delta: -100 }]))).toThrow(ChangeError)
    expect(() => commitReport(k, state, draft([{ op: 'cash', delta: 5 }, { op: 'no_such_op' }]))).toThrow(/沒有 no_such_op 這種變更/)
    expect(() => commitReport(k, state, draft([{ op: 'time', minutes: -5 }]))).toThrow(/只往前走/)
    expect(() => commitReport(k, state, draft([{ op: 'actor.track', id: 'ghost', track: 'hp', delta: 1 }]))).toThrow(/沒有 ghost/)
    expect(state).toEqual(before)
  })

  it('後面的變更可以依賴前面的結果', () => {
    const k = kernel()
    const state = makeState()
    commitReport(k, state, draft([{ op: 'item', id: 'it_smoke', qty: 2 }, { op: 'item', id: 'it_smoke', qty: -1 }]))
    expect(countItem(state.inventory, 'it_smoke')).toBe(1)
    expect(() => commitReport(k, state, draft([{ op: 'item', id: 'it_smoke', qty: -2 }]))).toThrow(/不夠/)
  })

  it('所有角色 18 歲以上：低於 18 的角色寫不進去', () => {
    const k = kernel()
    const state = makeState()
    for (const age of [17, 0, -3, 17.5]) {
      expect(() => commitReport(k, state, draft([{ op: 'actor.add', actor: { ...makeActor({ id: 'npc_a', role: 'npc' }), age } }]))).toThrow(ChangeError)
    }
    commitReport(k, state, draft([{ op: 'actor.add', actor: makeActor({ id: 'npc_a', role: 'npc', age: 18 }) }]))
    expect(state.actors.npc_a?.age).toBe(18)
    expect(() => commitReport(k, state, draft([{ op: 'actor.add', actor: makeActor({ id: 'npc_a', role: 'npc' }) }]))).toThrow(/重複/)
    expect(underageAt({ a: [{ age: 17 }], b: { c: { age: 30 } } })).toEqual(['a[0].age'])
  })

  it('角色的變更：三條軌最低 0、基本功 0～6、特質與狀態、主角與隊伍', () => {
    const k = kernel()
    const state = makeState({ pc: { hp: 10, skills: { stealth: 5 } }, actors: [makeActor({ id: 'npc_b', role: 'npc' })] })
    commitReport(k, state, draft([
      { op: 'actor.track', id: 'pc', track: 'hp', delta: -99 }, { op: 'actor.track', id: 'pc', track: 'load', delta: 7 },
      { op: 'actor.skill', id: 'pc', skill: 'stealth', delta: 1 }, { op: 'actor.perk', id: 'pc', perk: 'talker' },
      { op: 'actor.condition', id: 'pc', condition: 'drunk', until: 600 }, { op: 'actor.ext', id: 'pc', key: 'origin', value: 'hive' },
      { op: 'party', id: 'npc_b' }, { op: 'ext', key: 'creation', value: { step: 2 } }, { op: 'location', to: { district: 'hive' } },
    ]))
    const pc = state.actors.pc!
    expect([pc.hp, pc.load, pc.skills.stealth]).toEqual([0, 7, 6])
    expect(pc.perks).toEqual(['talker'])
    expect(pc.conditions).toEqual([{ id: 'drunk', until: 600 }])
    expect(pc.ext.origin).toBe('hive')
    expect(state.party).toEqual(['pc', 'npc_b'])
    expect(state.ext.creation).toEqual({ step: 2 })
    expect(state.location).toEqual({ district: 'hive' })
    expect(() => commitReport(k, state, draft([{ op: 'actor.skill', id: 'pc', skill: 'stealth', delta: 1 }]))).toThrow(/0～6/)
    expect(() => commitReport(k, state, draft([{ op: 'actor.perk', id: 'pc', perk: 'talker' }]))).toThrow(/已經有/)
    expect(() => commitReport(k, state, draft([{ op: 'party', id: 'pc', remove: true }]))).toThrow(/主角不能離隊/)
    expect(() => commitReport(k, state, draft([{ op: 'actor.remove', id: 'pc' }]))).toThrow(/不能拿掉主角/)
    expect(() => commitReport(k, state, draft([{ op: 'pc', id: 'npc_b' }]))).toThrow(/role 要是 pc/)
    commitReport(k, state, draft([{ op: 'actor.perk', id: 'pc', perk: 'talker', remove: true }, { op: 'actor.condition', id: 'pc', condition: 'drunk', remove: true }, { op: 'actor.remove', id: 'npc_b' }, { op: 'flag', key: 'x', value: 1 }, { op: 'flag', key: 'x', value: null }]))
    expect(state.actors.pc!.perks).toEqual([])
    expect(state.actors.pc!.conditions).toEqual([])
    expect(state.party).toEqual(['pc'])
    expect('x' in state.flags).toBe(false)
  })

  it('性質：任意一串合法或不合法的變更，提交之後 changes 的套用等於狀態的變化；丟錯時狀態不變', () => {
    const change = fc.oneof(
      fc.record({ op: fc.constant('cash'), delta: fc.integer({ min: -300, max: 300 }) }),
      fc.record({ op: fc.constant('cred'), delta: fc.integer({ min: -300, max: 300 }) }),
      fc.record({ op: fc.constant('time'), minutes: fc.integer({ min: -10, max: 3000 }) }),
      fc.record({ op: fc.constant('item'), id: fc.constantFrom('it_a', 'it_b'), qty: fc.integer({ min: -3, max: 3 }) }),
      fc.record({ op: fc.constant('actor.track'), id: fc.constantFrom('pc', 'ghost'), track: fc.constantFrom('hp', 'load', 'sink', 'afterglow'), delta: fc.integer({ min: -30, max: 30 }) }),
      fc.record({ op: fc.constant('flag'), key: fc.constantFrom('a', 'b'), value: fc.oneof(fc.boolean(), fc.integer(), fc.constant(null)) }),
      fc.record({ op: fc.constant('counter'), key: fc.constantFrom('a', 'b'), delta: fc.integer({ min: -5, max: 5 }) }),
      fc.record({ op: fc.constant('rng'), advance: fc.integer({ min: 0, max: 2 }) }),
    ) as fc.Arbitrary<Change>
    fc.assert(fc.property(fc.array(fc.array(change, { maxLength: 5 }), { maxLength: 6 }), (batches) => {
      const k = kernel()
      const state = makeState({ patch: { money: { cred: 200, cash: 200 } } })
      for (const changes of batches) {
        const before = clone(state)
        try {
          const report = commitReport(k, state, draft(changes))
          if (!deepEqual(state, expectedAfterCommit(k, before, report))) return false
        } catch (e) {
          if (!(e instanceof ChangeError) || !deepEqual(state, before)) return false
        }
        if (state.money.cred < 0 || state.money.cash < 0 || state.actors.pc!.hp < 0) return false
      }
      return true
    }), { numRuns: 150 })
  })

  it('report.before 掛鉤可以替報告加變更；加的變更也算在報告裡', () => {
    const k = kernel()
    // 例：契約的收益歸屬——賺到的現金有一半不是自己的
    k.hooks.on('report.before', 'test', ({ draft: d }) => {
      const gain = d.changes.filter((c) => c.op === 'cash' && (c.delta as number) > 0).reduce((s, c) => s + (c.delta as number), 0)
      return gain ? [{ op: 'cash', delta: -Math.floor(gain / 2) }] : undefined
    })
    const state = makeState()
    k.probe.start()
    const report = commitReport(k, state, draft([{ op: 'cash', delta: 100 }]))
    expect(state.money.cash).toBe(50)
    expect(report.changes).toHaveLength(2)
    expect(commitViolations(k, k.probe.stop())).toEqual([])
  })

  it('report.after 與 time.passed 掛鉤回傳的報告接著提交；時間沒動就不呼叫 time.passed', () => {
    const k = kernel()
    const passed: number[] = []
    k.hooks.on('time.passed', 'test', ({ from, to }) => {
      passed.push(to.day - from.day)
      return to.day > from.day ? [draft([{ op: 'counter', key: 'days', delta: to.day - from.day }], { action: 'daily' })] : undefined
    })
    k.hooks.on('report.after', 'test', ({ report }) => (report.action === 'daily' ? [draft([{ op: 'flag', key: 'billed', value: true }], { action: 'bill' })] : undefined))
    const state = makeState()
    expect(commitReportAll(k, state, draft([{ op: 'cash', delta: 1 }]))).toHaveLength(1)
    expect(passed).toEqual([])
    const reports = commitReportAll(k, state, draft([{ op: 'time', minutes: 60 * 20 }]))
    expect(reports.map((r) => r.action)).toEqual(['test', 'daily', 'bill'])
    expect(state.counters.days).toBe(1)
    expect(state.flags.billed).toBe(true)
    expect(state.reports.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('掛鉤互相觸發個沒完會被擋下', () => {
    const k = kernel()
    k.hooks.on('report.after', 'loop', () => [draft([{ op: 'counter', key: 'n', delta: 1 }])])
    expect(() => commitReport(k, makeState(), draft([]))).toThrow(new RegExp(`超過 ${MAX_FOLLOW_UP_DEPTH} 層`))
  })

  it('嚴格模式：掛鉤直接改狀態會被抓到（狀態只經由提交報告改變）', () => {
    const k = kernel()
    k.hooks.on('report.after', 'cheat', ({ state }) => { (state as GameState).money.cash += 999 })
    expect(() => commitReport(k, makeState(), draft([]))).toThrow(/直接改了狀態/)
    const k2 = kernel()
    k2.hooks.on('report.before', 'cheat', ({ state }) => { (state as GameState).flags.sneaky = true })
    expect(() => commitReport(k2, makeState(), draft([]))).toThrow(/直接改了狀態/)
  })

  it('掛鉤照 order 跑；探針記下每一次呼叫與登錄表的註冊', () => {
    const k = kernel()
    k.probe.start()
    const order: string[] = []
    k.hooks.on('report.after', 'late', () => { order.push('late') }, 10)
    k.hooks.on('report.after', 'early', () => { order.push('early') }, -1)
    k.changes.register({ op: 'test.noop', owner: 'test', validate: () => [], apply: () => {} })
    commitReport(k, makeState(), draft([{ op: 'test.noop' }]))
    const events = k.probe.stop()
    expect(order).toEqual(['early', 'late'])
    expect(events.filter((e) => e.type === 'registry.register').map((e) => (e.data as { id: string }).id)).toEqual(['report.after', 'report.after', 'test.noop'])
    expect(events.filter((e) => e.type === 'hook.call').map((e) => (e.data as { owner: string }).owner)).toEqual(['early', 'late'])
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i))
    expect(k.probe.active).toBe(false)
    expect(() => k.changes.register({ op: 'cash', owner: 'x', validate: () => [], apply: () => {} })).toThrow(/重複註冊/)
  })

  it('任務鏈的細節只保留最近五樓（AI_TASKS 5.5 節）', () => {
    const k = kernel()
    const state = makeState()
    for (let floor = 1; floor <= 8; floor++) commitReport(k, state, draft([{ op: 'chain', slot: { id: `c${floor}`, floor, detail: { steps: [floor] } } }]))
    const kept = state.chains.filter((c) => !c.cleaned)
    expect(kept.map((c) => c.floor)).toEqual([4, 5, 6, 7, 8])
    expect(kept).toHaveLength(CHAIN_FLOORS_KEPT)
    expect(state.chains.filter((c) => c.cleaned).every((c) => c.detail === undefined)).toBe(true)
    expect(state.seq.chain).toBe(8)
  })
})
