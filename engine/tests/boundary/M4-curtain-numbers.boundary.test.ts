// 邊界：簾後館的數字（場熱的門檻、打賞比例、成人場景換場熱、超回合、母帶外流機率、保證金與設備費、欠款上限）（M4 邊界，cpp-tester-boundary）。
// 規格：CYBERSPACE 8.8 節「場熱」「打賞」「打輸會怎樣」（落幕的順序、母帶）；LEWD_SYSTEM 3.4 節（補演的場景結算）；dev/adr/0019 第十二節。
// 預設的規則表（DEFAULT_CURTAIN_RULES）一個數字一個數字對規格，每個門檻測「差一」與「剛好」。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { ActionBlocked } from '../../src'
import {
  curtainOf, curtainRules, enterBlocks, fineOf, heatBand, curtainOvershoot as overshoot, replayBand, replayTips, sceneHeat, tabCap, tapeChance, tipsRatio,
} from '../../src/features/curtain'
import { CURTAIN_NIGHTS, curtainPrelude, makeCurtainGame } from '../../src/testkit'

const g0 = makeCurtainGame({ seed: 3 }).game
const rules = curtainRules(g0.k)

describe('打賞的比例：場熱 20 以下 0；20～39 ×0.1；40～59 ×0.2；60～79 ×0.35；80 以上 ×0.5（CYBERSPACE 8.8 節）', () => {
  const table: Array<[number, number]> = [[0, 0], [19, 0], [39, 0.1], [40, 0.2], [59, 0.2], [60, 0.35], [79, 0.35], [80, 0.5], [99, 0.5], [100, 0.5]]
  for (const [heat, ratio] of table) it(`場熱 ${heat} → ×${ratio}`, () => expect(tipsRatio(rules, heat)).toBe(ratio))
  it('門檻本身：39→40 與 59→60 與 79→80 各跳一段；19→20 在規格裡兩邊都寫（「20 以下 0」與「20～39 ×0.1」），現況 20 算 ×0.1', () => {
    expect(tipsRatio(rules, 39)).toBe(0.1)
    expect(tipsRatio(rules, 40)).toBe(0.2)
    expect(tipsRatio(rules, 59)).toBe(0.2)
    expect(tipsRatio(rules, 60)).toBe(0.35)
    expect(tipsRatio(rules, 79)).toBe(0.35)
    expect(tipsRatio(rules, 80)).toBe(0.5)
    expect(tipsRatio(rules, 20)).toBe(0.1)
  })
  it('性質：場熱越高比例不會越低；段數 0～4；比例在 0～0.5', () => {
    fc.assert(fc.property(fc.integer({ min: -50, max: 200 }), fc.integer({ min: 0, max: 50 }), (h, d) => {
      expect(tipsRatio(rules, h + d)).toBeGreaterThanOrEqual(tipsRatio(rules, h))
      const b = heatBand(rules, h)
      expect(b >= 0 && b <= 4).toBe(true)
      expect(tipsRatio(rules, h)).toBeLessThanOrEqual(0.5)
    }))
  })
})

describe('場熱的漲跌（CYBERSPACE 8.8 節的表）', () => {
  const h = rules.heat
  it('預設數字照規格：亮點 +2（每場上限 +10）、點單完成 +8、拒絕 −5、倒下 −10、超過標準回合每 3 回合 −2、每走 3 個探索回合 −1', () => {
    expect(h).toMatchObject({ highlight: 2, highlight_cap: 10, order_done: 8, order_refuse: -5, down: -10, over_per: 3, over_pen: -2, explore_per: 3, explore_pen: -1 })
  })
  it('贊助人現身 70、館方邀加演 90', () => {
    expect(h.sponsor).toBe(70)
    expect(h.encore).toBe(90)
  })
  it('成人場景結算換場熱：好 +10、普通 +5、不好 −5（契合 60 以上好、30 以上普通）', () => {
    expect(sceneHeat(rules, 100)).toBe(10)
    expect(sceneHeat(rules, 60)).toBe(10)
    expect(sceneHeat(rules, 59)).toBe(5)
    expect(sceneHeat(rules, 30)).toBe(5)
    expect(sceneHeat(rules, 29)).toBe(-5)
    expect(sceneHeat(rules, 0)).toBe(-5)
    expect(sceneHeat(rules, -40)).toBe(-5)
  })
  it('超過標準回合：每多 3 回合 −2（多 1、2 回合不扣；3 回合 −2；5 回合還是 −2；6 回合 −4）', () => {
    const o = (rounds: number) => { const r = overshoot(rules, rounds, 15); return { over: r.over, heat: r.heat + 0 } }
    expect(o(14)).toEqual({ over: 0, heat: 0 })
    expect(o(15)).toEqual({ over: 0, heat: 0 })
    expect(o(16).heat).toBe(0)
    expect(o(17).heat).toBe(0)
    expect(o(18)).toEqual({ over: 3, heat: -2 })
    expect(o(20).heat).toBe(-2)
    expect(o(21).heat).toBe(-4)
    expect(o(15 + 3 * 7).heat).toBe(-14)
  })
  it('性質：超過的回合數越多扣得越多（不會變成加）', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 100 }), (r, s) => {
      expect(overshoot(rules, r, s).heat).toBeLessThanOrEqual(0)
      expect(overshoot(rules, r + 1, s).heat).toBeLessThanOrEqual(overshoot(rules, r, s).heat)
    }))
  })
})

describe('落幕：打賞減半、補演的評價、設備費與違約金（CYBERSPACE 8.8 節「打輸會怎樣」）', () => {
  it('落幕時打賞減半（fall.tips_mult 0.5）；設備費與違約金是保證金的一半（四捨五入）', () => {
    expect(rules.fall.tips_mult).toBe(0.5)
    for (const t of rules.tiers) expect(fineOf(rules, t.deposit)).toBe(Math.round(t.deposit * 0.5))
    expect(fineOf(rules, 0)).toBe(0)
    expect(fineOf(rules, 301)).toBe(151)
  })
  it('補演的評價：契合 60 以上好、30 以上不到 60 普通、不到 30 不合（門檻剛好與差一）', () => {
    expect(replayBand(rules, 60)).toBe('good')
    expect(replayBand(rules, 59)).toBe('fair')
    expect(replayBand(rules, 30)).toBe('fair')
    expect(replayBand(rules, 29)).toBe('poor')
    expect(replayBand(rules, 100)).toBe('good')
    expect(replayBand(rules, -10)).toBe('poor')
  })
  it('好的場景把減掉的那一半補回來再加一成（整份 ×1.1）；普通不補；不合再減一成、最少 0', () => {
    expect(replayTips(rules, { full: 200, tips: 100 }, 'good')).toBe(220)
    expect(replayTips(rules, { full: 200, tips: 100 }, 'fair')).toBe(100)
    expect(replayTips(rules, { full: 200, tips: 100 }, 'poor')).toBe(80)
    expect(replayTips(rules, { full: 200, tips: 10 }, 'poor')).toBe(0)
    expect(replayTips(rules, { full: 0, tips: 0 }, 'good')).toBe(0)
  })
  it('性質：好 ≥ 普通 ≥ 不合；不合不會是負的；好的至少把減掉的補回來', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000 }), (full) => {
      const tips = Math.round(full * 0.5)
      const f = { full, tips }
      expect(replayTips(rules, f, 'good')).toBeGreaterThanOrEqual(replayTips(rules, f, 'fair'))
      expect(replayTips(rules, f, 'fair')).toBeGreaterThanOrEqual(replayTips(rules, f, 'poor'))
      expect(replayTips(rules, f, 'poor')).toBeGreaterThanOrEqual(0)
      expect(replayTips(rules, f, 'good')).toBeGreaterThanOrEqual(full)
    }))
  })
  it('補演的沉溺只動 −2～+2', () => {
    expect(rules.fall.sink_range).toEqual([-2, 2])
  })
})

describe('母帶外流的機率：基底 15%、當週被臨檢 +15%、帳上有欠款 +15%、第二幕輸 +10%、最高 45%', () => {
  const st = (flags: Record<string, boolean> = {}) => ({ ...g0.state, flags: { ...g0.state.flags, ...flags } })
  const cases: Array<[string, { act: number; indebted: boolean; raided: boolean }, number]> = [
    ['什麼都沒有', { act: 0, indebted: false, raided: false }, 0.15],
    ['第二幕輸', { act: 2, indebted: false, raided: false }, 0.25],
    ['第一幕輸', { act: 1, indebted: false, raided: false }, 0.15],
    ['有欠款', { act: 0, indebted: true, raided: false }, 0.3],
    ['被臨檢', { act: 0, indebted: false, raided: true }, 0.3],
    ['臨檢加欠款', { act: 0, indebted: true, raided: true }, 0.45],
    ['臨檢加欠款加第二幕：封頂 45%', { act: 2, indebted: true, raided: true }, 0.45],
    ['欠款加第二幕', { act: 2, indebted: true, raided: false }, 0.4],
  ]
  for (const [name, o, p] of cases) {
    it(`${name} → ${p}`, () => expect(tapeChance(g0.k, st(o.raided ? { curtain_raided: true } : {}), { act: o.act, indebted: o.indebted })).toBe(p))
  }
  it('性質：任何組合都在 0.15～0.45 之間；加條件不會變低', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 6 }), fc.boolean(), fc.boolean(), (act, indebted, raided) => {
      const p = tapeChance(g0.k, st(raided ? { curtain_raided: true } : {}), { act, indebted })
      expect(p).toBeGreaterThanOrEqual(0.15)
      expect(p).toBeLessThanOrEqual(0.45)
      expect(tapeChance(g0.k, st(raided ? { curtain_raided: true } : {}), { act, indebted: true })).toBeGreaterThanOrEqual(p)
    }))
  })
  it('買回的價錢是保證金的兩倍', () => expect(rules.fall.tape.buyback_mult).toBe(2))
})

describe('記帳的欠款上限：保證金的兩倍，欠到上限就不能再報名（CYBERSPACE 8.8 節）', () => {
  const setup = (owed: number) => {
    const g = makeCurtainGame({ seed: 3 }).game
    curtainPrelude(g)
    const cur = g.state.ext.curtain as { tab?: { owed: number; since: number } }
    cur.tab = { owed, since: 0 }
    return g
  }
  const floor = rules.tiers.find((t) => t.id === 'floor')!
  const cap = tabCap(rules, floor)
  it('上限是散座保證金的兩倍', () => expect(cap).toBe(floor.deposit * 2))
  it('欠到上限 − 1 還能報名；欠到上限就被擋，原因提到上限', () => {
    const a = setup(cap - 1)
    expect(enterBlocks(a.k, a.state, { party: ['pc'], night: CURTAIN_NIGHTS.b })).toEqual([])
    const b = setup(cap)
    const why = enterBlocks(b.k, b.state, { party: ['pc'], night: CURTAIN_NIGHTS.b })
    expect(why.join('')).toMatch(/已經到了上限/)
    const c = setup(cap + 500)
    expect(enterBlocks(c.k, c.state, { party: ['pc'], night: CURTAIN_NIGHTS.b }).join('')).toMatch(/已經到了上限/)
  })
  it('還清一部分（欠款降到上限以下）又能報名', () => {
    const a = setup(cap)
    ;(a.state.ext.curtain as { tab: { owed: number } }).tab.owed = cap - 1
    expect(enterBlocks(a.k, a.state, { party: ['pc'], night: CURTAIN_NIGHTS.b })).toEqual([])
    void curtainOf
  })
  void ActionBlocked
})
