// 白箱：features/tuning 的靜室（quiet.ts 的 plan）沒有走到的擋下（M4 白箱，cpp-tester-whitebox）。
// 規格：LEWD_SYSTEM 第 1 節「怎麼變」與第 6 節「調校診所」（靜室：付錢把一項橋參數往上或往下調，每週一次，往上調沉溺 +1）；dev/adr/0019 P48；dev/work/M4-tuning.md 第 6 點。
// 一局：makeBodyGame，站在診所街的調校診所（F4，帶 quiet_room）。

import { describe, expect, it } from 'vitest'
import { ActionBlocked } from '../../src'
import { quietBlock, quietDraft, quietProblems, quietQuote } from '../../src/features/tuning'
import { BODY_BLOCKS, makeActor, makeBodyGame, standAt } from '../../src/testkit'

const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const atQuiet = (o: Parameters<typeof makeBodyGame>[0] = {}) => {
  const g = makeBodyGame(o).game
  standAt(g, BODY_BLOCKS.clinics, 'F4')
  return g
}

describe('靜室的擋下（LEWD_SYSTEM 第 6 節「調校診所」的靜室）', () => {
  it('找不到角色：只回一句，報價是 null', () => {
    const g = atQuiet()
    expect(quietProblems(g.k, g.state, { actor: 'ghost', param: 'sensitivity', dir: 1 })).toEqual(['找不到這個角色。'])
    expect(quietQuote(g.k, g.state, { actor: 'ghost', param: 'sensitivity', dir: 1 })).toBeNull()
  })

  it('橋參數不是四項之一、方向不是 ±1：各一句，不往下算報價', () => {
    const g = atQuiet()
    expect(quietProblems(g.k, g.state, { param: 'lust' as never, dir: 1 })).toEqual(['沒有這一項橋參數。'])
    expect(quietQuote(g.k, g.state, { param: 'lust' as never, dir: 1 })).toBeNull()
    for (const dir of [0, 2, -2]) expect(quietProblems(g.k, g.state, { param: 'tolerance', dir: dir as never }), String(dir)).toEqual(['要往上或往下調，沒有第三種。'])
    expect(reasonOf(() => quietDraft(g.k, g.state, { param: 'tolerance', dir: 0 as never }))).toBe('要往上或往下調，沒有第三種。')
  })

  it('要調整的人不在隊上（局裡有這個人、沒有進隊）：擋下', () => {
    const g = atQuiet({ actors: [makeActor({ id: 'mate', name: '同伴', role: 'npc', ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } })] })
    expect(g.state.party).not.toContain('mate')
    expect(quietBlock(g.k, g.state, { actor: 'mate', param: 'sensitivity', dir: 1 })).toBe('要調整的人不在隊上。')
  })

  it('往下調：沉溺不加（sink 0）、報價的 delta 是 −5；做完時間 +2 小時、錢扣 500', () => {
    const g = atQuiet()
    const q = quietQuote(g.k, g.state, { param: 'craving', dir: -1 })!
    expect(q).toMatchObject({ from: 30, delta: -5, sink: 0, price: 500 })
    const sink = g.state.actors.pc!.sink
    const cred = g.state.money.cred
    const [r] = g.commit(quietDraft(g.k, g.state, { param: 'craving', dir: -1 }))
    expect(r!.action).toBe('tuning.quiet')
    expect(g.state.actors.pc!.sink).toBe(sink)
    expect(g.state.money.cred).toBe(cred - 500)
    expect((g.state.actors.pc!.ext.bridge as Record<string, number>).craving).toBe(25)
  })

  it('走出靜室（站到出口）：「這裡沒有靜室，調不了橋參數。」', () => {
    const g = atQuiet()
    standAt(g, BODY_BLOCKS.clinics, 'E1')
    expect(quietBlock(g.k, g.state, { param: 'sensitivity', dir: 1 })).toBe('這裡沒有靜室，調不了橋參數。')
  })
})
