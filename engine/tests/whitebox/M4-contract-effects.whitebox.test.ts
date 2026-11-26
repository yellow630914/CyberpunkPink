// 白箱：features/contract 的效果與條件的格式檢查與夾值（effects.ts）沒有走到的分支（M4 白箱，cpp-tester-whitebox）。
// 規格：LEWD_SYSTEM 第 7 節（契約與橋權：7.1 橋權、契約的種類、指令、規矩、每週回報）；EVENTS 4.5 節（契約的事件）；dev/adr/0019 第八節；
// dev/work/M4-contract.md、M4-contract-holder.md；GAME_DESIGN 第 3 節（內容與 AI 交的結果先驗格式再寫入）。
// 一局：makeBodyGame（bodyWorld：勢力 f_tw_eden、契約人阿音 npc_tw_ayin）。效果用內建的來源驗（事件與建角開局走的同一條路）。

import { describe, expect, it } from 'vitest'
import { effectCtx } from '../../src'
import { HOLDER_NPC, applyEffects, makeActor, makeBodyGame } from '../../src/testkit'

const EDEN = { kind: 'eden', name: '樂園', faction: 'f_tw_eden', place: { district: 'tw_hive', block: 'tw_tower' } }
const game = () => makeBodyGame().game
const problems = (g: ReturnType<typeof game>, fx: Record<string, unknown>, actor = 'pc'): string[] => g.k.effects.validate([fx as never], effectCtx(g.k, g.state, { source: 'builtin', actor }))
const has = (list: string[], re: RegExp): boolean => list.some((x) => re.test(x))

describe('contract_sign 的格式（LEWD_SYSTEM 第 7 節：債務／工作／私人三種、指令、規矩、每週回報日）', () => {
  const ok = { kind: 'contract_sign', type: 'debt', debt: 1000, holder: EDEN }
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['debt 是負數', { debt: -1 }, /debt 要是 0 以上的整數/],
    ['debt 是小數', { debt: 10.5 }, /debt 要是 0 以上的整數/],
    ['工作契約寫了 debt', { type: 'work', debt: 100 }, /只有債務契約有 debt/],
    ['rules 不是陣列', { rules: { kind: 'zone' } }, /rules 要是 \{ kind, value \} 的陣列/],
    ['rules 的 kind 不認得', { rules: [{ kind: 'diet', value: 'x' }] }, /rules\[0\]\.kind 只能是/],
    ['rules 的 value 是物件', { rules: [{ kind: 'zone', value: { a: 1 } }] }, /rules\[0\]\.value 要是字串或數字/],
    ['report_weekday 是 7', { report_weekday: 7 }, /report_weekday 要是 0～6/],
    ['report_weekday 是 -1', { report_weekday: -1 }, /report_weekday 要是 0～6/],
    ['days 是 0', { days: 0 }, /days 要是 1～36500 的整數/],
    ['relation 不認得', { relation: 'boss' }, /relation 只能是/],
    ['orders 帶了不認得的指令', { orders: ['errand', 'kill'] }, /orders 要是指令種類的陣列/],
    ['多寫一個欄位', { color: 'red' }, /color：沒有這個欄位/],
  ]
  for (const [name, patch, re] of cases) {
    it(`${name}：擋下並寫出是哪一欄`, () => {
      const g = game()
      expect(problems(g, ok)).toEqual([])
      expect(has(problems(g, { ...ok, ...patch }), re), JSON.stringify(problems(g, { ...ok, ...patch }))).toBe(true)
    })
  }

  it('替別人簽：效果不算（夾值成 null）並提醒「只有你自己能簽成契約人」，狀態不動', () => {
    const g = game()
    g.state.actors.mate = makeActor({ id: 'mate', name: '同伴' })
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'mate' })
    expect(g.k.effects.validate([ok as never], ctx)).toEqual([])
    const res = g.k.effects.resolve([ok as never], ctx)
    expect(res.changes).toEqual([])
    expect(JSON.stringify(res)).toMatch(/只有你自己能簽成契約人/)
  })
})

describe('order、order_done 的格式（LEWD_SYSTEM 7.3 節：指令的種類與期限）', () => {
  it('order_kind 不認得、hours 是 0、超過 90 天、place 不是物件或多一欄：各一句', () => {
    const g = game()
    expect(applyEffects(g, [{ kind: 'contract_sign', type: 'debt', debt: 1000, holder: EDEN, orders: ['errand'] }]).errors).toEqual([])
    const base = { kind: 'order', order_kind: 'errand' }
    expect(has(problems(g, { ...base, order_kind: 'kill' }), /order_kind 只能是/)).toBe(true)
    expect(has(problems(g, { ...base, hours: 0 }), /hours 要是大於 0 的小時數/)).toBe(true)
    expect(has(problems(g, { ...base, hours: 24 * 90 + 1 }), /hours 要是大於 0 的小時數/)).toBe(true)
    expect(has(problems(g, { ...base, place: 'tw_hive' }), /place 要是 \{ district\?, block\?, facility\? \}/)).toBe(true)
    expect(has(problems(g, { ...base, place: { district: 3 } }), /place\.district 要是字串/)).toBe(true)
    expect(has(problems(g, { ...base, place: { street: 'x' } }), /place\.street：沒有這個欄位/)).toBe(true)
  })

  it('order_done：order_kind 不認得、order 不是字串；沒有進行中的指令時說明是「沒有進行中的指令可以收尾」', () => {
    const g = game()
    expect(has(problems(g, { kind: 'order_done', order_kind: 'kill' }), /order_kind 只能是/)).toBe(true)
    expect(has(problems(g, { kind: 'order_done', order: 5 }), /order 要是指令的 id/)).toBe(true)
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    const res = g.k.effects.resolve([{ kind: 'order_done' } as never], ctx)
    expect(res.changes).toEqual([])
  })
})

describe('bridge_right、contract_hold、contract_release 的格式（LEWD_SYSTEM 7.1 節橋權、7.6 節持約人）', () => {
  it('bridge_right：source 太長或不是字串擋下', () => {
    const g = game()
    const base = { kind: 'bridge_right', holder: EDEN, level: 'read', source: 'loan' }
    expect(problems(g, base)).toEqual([])
    expect(has(problems(g, { ...base, source: 'x'.repeat(41) }), /source 要是一句短的代號/)).toBe(true)
    expect(has(problems(g, { ...base, source: 3 }), /source 要是一句短的代號/)).toBe(true)
  })

  it('contract_hold：npc 不是字串、debt 負數、days 超過 36500、origin 太長，各一句；替別人持有：不算並提醒', () => {
    const g = game()
    const base = { kind: 'contract_hold', npc: HOLDER_NPC, type: 'private' }
    expect(problems(g, base)).toEqual([])
    expect(has(problems(g, { ...base, npc: 7 }), /npc 要是角色的 id/)).toBe(true)
    expect(has(problems(g, { ...base, type: 'debt', debt: -5 }), /debt 要是 0 以上的整數/)).toBe(true)
    expect(has(problems(g, { ...base, days: 36501 }), /days 要是 1～36500 的整數/)).toBe(true)
    expect(has(problems(g, { ...base, origin: '很'.repeat(200) }), /origin 要是一句話/)).toBe(true)
    g.state.actors.mate = makeActor({ id: 'mate', name: '同伴' })
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'mate' })
    const res = g.k.effects.resolve([base as never], ctx)
    expect(res.changes).toEqual([])
    expect(JSON.stringify(res)).toMatch(/只有你自己能成為持約人/)
  })

  it('contract_release：npc 不是字串擋下；他不是你持有契約的人：什麼都不動', () => {
    const g = game()
    expect(has(problems(g, { kind: 'contract_release', npc: 1 }), /npc 要是角色的 id/)).toBe(true)
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    const res = g.k.effects.resolve([{ kind: 'contract_release', npc: HOLDER_NPC } as never], ctx)
    expect(res.changes).toEqual([])
  })
})

describe('條件 contract、order_pending 的格式與判斷', () => {
  const cond = (g: ReturnType<typeof game>, c: Record<string, unknown>) => g.k.conditions.validate(c as never)
  const test = (g: ReturnType<typeof game>, c: Record<string, unknown>) => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('side 只能是 bound 或 holder；type、holder_kind 不認得；order_pending 的 order_kind 不認得', () => {
    const g = game()
    expect(has(cond(g, { kind: 'contract', side: 'x' }), /side 只能是/)).toBe(true)
    expect(has(cond(g, { kind: 'contract', side: 'bound', type: 'slave' }), /type 只能是/)).toBe(true)
    expect(has(cond(g, { kind: 'contract', side: 'holder', holder_kind: 'god' }), /holder_kind 只能是/)).toBe(true)
    expect(has(cond(g, { kind: 'order_pending', order_kind: 'kill' }), /order_kind 只能是/)).toBe(true)
  })

  it('持約人那一邊：阿音還不是角色時 contract_hold 落空（格式過、什麼都不寫）；是角色之後持有，type: private 成立、type: debt 不成立、npc 指別人不成立', () => {
    const g = game()
    expect(test(g, { kind: 'contract', side: 'holder' })).toBe(false)
    expect(applyEffects(g, [{ kind: 'contract_hold', npc: HOLDER_NPC, type: 'private' }]).reports[0]!.changes).toEqual([])
    expect(test(g, { kind: 'contract', side: 'holder' })).toBe(false)
    const h = makeBodyGame({ actors: [makeActor({ id: HOLDER_NPC, name: '阿音', role: 'npc' })] }).game
    expect(applyEffects(h, [{ kind: 'contract_hold', npc: HOLDER_NPC, type: 'private' }]).errors).toEqual([])
    const g2 = h
    expect(test(g2, { kind: 'contract', side: 'holder' })).toBe(true)
    expect(test(g2, { kind: 'contract', side: 'holder', type: 'private', npc: HOLDER_NPC })).toBe(true)
    expect(test(g2, { kind: 'contract', side: 'holder', type: 'debt' })).toBe(false)
    expect(test(g2, { kind: 'contract', side: 'holder', npc: 'npc_someone' })).toBe(false)
  })
})
