import { describe, it, expect } from 'vitest'
import { OpinionWar, adj, CELLS, editPoints, fameLevel } from './opinion'
import { seeded, d6 } from './rng'

describe('輿論戰', () => {
  it('相鄰只有上下左右；萬華鏡在正中央，和四邊相鄰', () => {
    expect(adj(4).sort()).toEqual([1, 3, 5, 7])
    expect(adj(0).sort()).toEqual([1, 3])
    expect(CELLS[4]).toBe('萬華鏡')
  })
  it('防守：沒人的 2；對手的 3 − 風向（最少 0，OPINION 3.3 節）；對手搶你的 3 ＋ 風向', () => {
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_2' }, seeded(1))
    const empty = o.own.indexOf(0), foe = o.own.indexOf(2), mine = o.own.indexOf(1)
    expect(o.def(empty, 1)).toBe(2)
    o.w = 1
    expect(o.def(foe, 1)).toBe(2)
    expect(o.def(mine, 2)).toBe(4)
    o.w = 5
    expect(o.def(foe, 1)).toBe(0)
    o.w = -5
    expect(o.def(mine, 2)).toBe(0)
  })
  it('豔名：每 30 點一級、最多 2 級，只減看臉的三格（OPINION 4.3c 節）', () => {
    expect(fameLevel(29)).toBe(0); expect(fameLevel(31)).toBe(1); expect(fameLevel(95)).toBe(2)
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_2', fame: 60 }, seeded(1))
    o.own[1] = 0; o.own[3] = 0
    expect(o.def(1, 1)).toBe(0)
    expect(o.def(3, 1)).toBe(2)
    expect(o.def(1, 2)).toBe(2)
  })
  it('編輯點照 OPINION 4.3b 節：任何人 2，主播與偶像加階數的一半進位，名媛與掮客捨去，製作 +1', () => {
    expect(editPoints([])).toBe(2)
    expect(editPoints(['槍手 3', '掮客 2'])).toBe(3)
    expect(editPoints(['主播 3'])).toBe(4)
    expect(editPoints(['名媛 3'], true)).toBe(4)
  })
  it('萬華鏡從中央開場；其他對手從你的對面', () => {
    const k = new OpinionWar({ topic: 'scandal', foe: 'pr_kaleido' }, seeded(2))
    expect(k.own[4]).toBe(2)
    const g = new OpinionWar({ topic: 'scandal', foe: 'pr_2' }, seeded(2))
    const me = g.own.indexOf(1)
    expect(g.own[8 - me]).toBe(2)
  })
  it('開場 3 張再抽 2 張；編輯點照給的（沒給是 2）；出牌加聲量', () => {
    expect(new OpinionWar({ topic: 'scandal', foe: 'pr_1' }, seeded(5)).ap).toBe(2)
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_1', edit: 4 }, seeded(5))
    expect(o.hand).toHaveLength(5)
    expect(o.ap).toBe(4)
    const i = o.hand.findIndex(k => k === 'clip' || k === 'tape')
    if (i >= 0) { const va = o.va; o.play(i); expect(o.va).toBe(va + 2) }
  })
  it('潔絲第一回合先搶萬華鏡；III 級的料牌 +1', () => {
    const o = new OpinionWar({ topic: 'scandal', foe: 'pr_jess' }, seeded(3))
    o.endTurn()
    o.foeStep()
    expect(o.own[4]).toBe(2)
    expect(o.cardV({ n: '', t: 1, c: 1, d: '', v: 2 })).toBe(3)
  })
  it('六回合打得完，結果分四級', () => {
    for (const foe of ['pr_1', 'pr_2', 'pr_3', 'pr_kaleido', 'pr_hizakura', 'pr_jess']) {
      const o = new OpinionWar({ topic: 'idol', foe }, seeded(7))
      for (let g = 0; g < 200 && !o.end; g++) {
        for (let i = o.hand.length - 1; i >= 0; i--) if (!o.cardReason(i) && !o.mode) { o.play(i); if (o.mode) o.mode = null }
        if (!o.capReason()) { o.toggleCap(); o.pickCell(o.targets()[0]) }
        if (o.end) break
        o.endTurn()
        while (o.foeStep());
      }
      expect(o.end).not.toBeNull()
      expect(['大勝', '小勝', '平手', '敗']).toContain(o.end!.result)
    }
  })
})

describe('擲骰', () => {
  it('有種子的亂數可以重現', () => {
    const a = seeded(9), b = seeded(9)
    expect(d6(a, 10)).toBe(d6(b, 10))
  })
})
