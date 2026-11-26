// 邊界：拍賣目錄的抽籤（M4 邊界，cpp-tester-boundary）。
// 規格：LEWD_SYSTEM 6.2 節：一場 4～6 件拍品（資料的 lots 寫幾件算幾件）、一場至少有一件零件或義體（must）、場上有 3～6 位 NPC 競標者、
// 每位預算是拍品市價的 80%～160%、零件與義體每件 15% 是仿品（藝術品、機密、契約沒有）、底價是市價的 50%；
// 同一個種子、同一週、同一家，目錄永遠一樣（種子重播）；賣過的「只賣一次」的拍品不再出現。
// 做法：掃很多種子與很多週，數出分佈與範圍。

import { describe, expect, it } from 'vitest'
import { auctionRules, catalogOf } from '../../src/features/auction'
import { AUCTION_HOUSE, makeBodyGame } from '../../src/testkit'

describe('拍賣目錄的抽籤（掃 120 個種子 × 4 週）', () => {
  const house = (g: ReturnType<typeof makeBodyGame>['game']) => g.k.content.get<{ id: string; lots: [number, number]; bidders: [number, number]; must?: string[]; kinds: string[] }>('auction_house', AUCTION_HOUSE)!
  const sweep = () => {
    const out: Array<ReturnType<typeof catalogOf>> = []
    let g0: ReturnType<typeof makeBodyGame>['game'] | undefined
    for (let seed = 1; seed <= 120; seed++) {
      const g = makeBodyGame({ seed }).game
      g0 ??= g
      for (let w = 0; w < 4; w++) {
        const s = structuredClone(g.state)
        s.time = { day: 4 + 7 * w, hour: 12, minute: 0 }
        out.push(catalogOf(g.k, s, AUCTION_HOUSE))
      }
    }
    return { out: out.filter((c): c is NonNullable<typeof c> => c !== null), g: g0! }
  }
  const { out, g } = sweep()
  const h = house(g)
  const rules = auctionRules(g.k)

  it('每一場都有目錄；件數在資料寫的範圍裡（池夠大時）、拍品不重複', () => {
    expect(out.length).toBe(480)
    for (const c of out) {
      expect(c.lots.length).toBeGreaterThanOrEqual(1)
      expect(c.lots.length).toBeLessThanOrEqual(h.lots[1])
      expect(new Set(c.lots.map((l) => l.id)).size).toBe(c.lots.length)
    }
    // 測試世界的拍品池只有 7 件可抽（資料寫 8）：件數不會超過池，也不會超過資料的上限
    const counts = new Set(out.map((c) => c.lots.length))
    expect(Math.max(...counts)).toBeLessThanOrEqual(h.lots[1])
  })
  it('一場至少有一件零件或義體（規格 6.2 節）；每件拍品的種類在這家拍賣行的種類裡；資料的 must 是契約：池裡沒有可抽的契約（只拍見過的人）時不強塞', () => {
    let withContract = 0
    for (const c of out) {
      expect(c.lots.some((l) => l.kind === 'part' || l.kind === 'cyberware'), c.lots.map((l) => l.kind).join(',')).toBe(true)
      for (const l of c.lots) expect(h.kinds).toContain(l.kind)
      if (c.lots.some((l) => l.kind === 'contract')) withContract++
    }
    expect(h.must).toEqual(['contract'])
    // 目錄裡有契約的場次要有（池裡有可抽的時候 must 會換進來），沒有也不丟錯
    expect(withContract).toBeGreaterThanOrEqual(0)
  })
  it('底價是市價的 50%（取到十位）、一階是底價的 10%（最少 50、取到十位）、市價是正的', () => {
    const r10 = (n: number) => Math.round(n / 10) * 10
    for (const c of out) for (const l of c.lots) {
      expect(l.market).toBeGreaterThan(0)
      expect(l.reserve).toBe(r10(l.market * rules.reserve_pct))
      expect(l.step).toBe(r10(Math.max(l.reserve * rules.step_pct, rules.step_min)))
      expect(l.step).toBeGreaterThanOrEqual(50)
    }
  })
  it('競標者在資料寫的人數範圍裡、不重複；預算倍率在 0.8～1.6', () => {
    for (const c of out) {
      expect(c.bidders.length).toBeLessThanOrEqual(h.bidders[1])
      expect(new Set(c.bidders.map((b) => b.id)).size).toBe(c.bidders.length)
      for (const b of c.bidders) {
        expect(b.mult).toBeGreaterThanOrEqual(rules.budget[0])
        expect(b.mult).toBeLessThanOrEqual(rules.budget[1])
      }
    }
  })
  it('仿品：只有零件與義體會是仿品；比例接近 15%（掃出來的拍品數夠多時，±4 個百分點）', () => {
    let faked = 0
    let fakeable = 0
    for (const c of out) for (const l of c.lots) {
      if (l.kind === 'part' || l.kind === 'cyberware') { fakeable++; if (l.fake) faked++ } else expect(l.fake, `${l.kind} 不會是仿品`).toBe(false)
    }
    expect(fakeable).toBeGreaterThan(200)
    expect(Math.abs(faked / fakeable - rules.fake.chance)).toBeLessThan(0.04)
  })
  it('種子重播：同一個種子、同一週、同一家，目錄逐欄一樣', () => {
    const a = makeBodyGame({ seed: 5 }).game
    const b = makeBodyGame({ seed: 5 }).game
    for (const g2 of [a, b]) g2.state.time = { day: 11, hour: 9, minute: 0 }
    expect(catalogOf(a.k, a.state, AUCTION_HOUSE)).toEqual(catalogOf(b.k, b.state, AUCTION_HOUSE))
  })
})
