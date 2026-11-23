// 邊界：人物互動的 DC 與送禮、讀橋的數字。
// 規格：NPC_SYSTEM 6.2（基準 DC = 警覺 − ⌊親密度 ÷ 20⌋ + 情境修正：勢力好感 60 以上 −1／20 以下 +1、敵對值 40 以上 +2）、6.3（送禮：價值先除以財富倍率 0 級 ×0.5……5 級 ×8；10 以上 +1、60 以上 +2、250 以上 +4、1,000 以上 +6）、
// 6.4（讀橋 DC = 10 + 防護階 × 3，防護階街坊 0、行者 1、職員 2、主管與保全 3；揭開 1 項、大成功 2 項）。
// 性質：任何親密度（−100～100）、好感與敵對值（0～100）：DC = 警覺 − ⌊親密度 ÷ 20⌋ + 修正，修正只看門檻；送禮的加成在每一個門檻與門檻 −1 落在對的級，價錢越高越多、財富越高越少；
// 財富超出 0～5 也不當機（夾在兩端）；讀橋揭開的項目不重複、不超過要的數量、不會揭開已經知道的。

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERACT_RULES, READ_CATEGORIES, difficulty, giftTier, revealFacts, shieldOf } from '../../src/features/npcs'
import { npcOf } from '../../src/features/npcs'
import { makeCityGame } from '../../src/testkit'

const R = DEFAULT_INTERACT_RULES

describe('邊界 NPC_SYSTEM 6.3：送禮的級距', () => {
  it('每一個門檻與門檻 −1（財富 1 級，倍率 ×1）：9→0、10→1、59→1、60→2、249→2、250→4、999→4、1000→6', () => {
    const at = (price: number) => giftTier(R, price, 1)
    expect([9, 10, 59, 60, 249, 250, 999, 1000].map(at)).toEqual([0, 1, 1, 2, 2, 4, 4, 6])
    expect(at(0)).toBe(0)
    expect(at(1_000_000)).toBe(6)
  })

  it('財富倍率：0 級 ×0.5（5 塊的東西算 10）、5 級 ×8（1000 塊的東西只算 125）；財富寫成 −1 或 99 夾在兩端、不當機', () => {
    expect(giftTier(R, 5, 0)).toBe(1)
    expect(giftTier(R, 4, 0)).toBe(0)
    expect(giftTier(R, 1000, 5)).toBe(2)
    expect(giftTier(R, 8000, 5)).toBe(6)
    expect(giftTier(R, 7999, 5)).toBe(4)
    expect(giftTier(R, 5, -1)).toBe(giftTier(R, 5, 0))
    expect(giftTier(R, 8000, 99)).toBe(giftTier(R, 8000, 5))
  })

  it('性質：價錢越高加成不減、財富越高加成不增、加成只會是 0、1、2、4、6', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 5 }), (a, b, w) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        expect(giftTier(R, hi, w)).toBeGreaterThanOrEqual(giftTier(R, lo, w))
        expect([0, 1, 2, 4, 6]).toContain(giftTier(R, a, w))
        if (w < 5) expect(giftTier(R, a, w + 1)).toBeLessThanOrEqual(giftTier(R, a, w))
      }),
      { numRuns: 300, seed: 61 },
    )
  })
})

describe('邊界 NPC_SYSTEM 6.2：基準 DC', () => {
  const t = makeCityGame({ seed: 7 })
  const { game } = t
  const k = game.k
  const npc = npcOf(k, game.state, 'npc_tw_vendor')!

  it('性質：DC = 警覺 − ⌊親密度 ÷ 20⌋ + 好感修正（≥60：−1、≤20：+1）+ 敵對值修正（≥40：+2）；每一條來源列出來、加起來等於 DC', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (aff, favor, hostility) => {
        const s = structuredClone(game.state)
        const meters = (s as unknown as { meters: Record<string, Record<string, number>> }).meters
        meters.affinity = { npc_tw_vendor: aff }
        meters.favor = { f_corp: favor }
        meters.hostility = { f_corp: hostility }
        const { dc, mods } = difficulty(k, s, 'npc_chat', npc, undefined)
        const favorMod = favor >= 60 ? -1 : favor <= 20 ? 1 : 0
        const hostMod = hostility >= 40 ? 2 : 0
        const want = npc.guard - Math.floor(aff / 20) + favorMod + hostMod
        // 沒裝好感、敵對值的量表時那一條不算；這一局裝了全部功能，所以兩條都在
        expect(dc).toBe(want)
        expect(mods.reduce((a, m) => a + m.value, 0)).toBe(dc)
        expect(mods.every((m) => m.value !== 0 || m.label.includes('警覺'))).toBe(true)
      }),
      { numRuns: 300, seed: 62 },
    )
  })

  it('門檻：親密度 −1 讓 DC +1（⌊−1 ÷ 20⌋ = −1）、−20 +1、−21 +2、19 → 0、20 → −1、39 → −1、40 → −2；好感 59 沒有、60 −1；敵對值 39 沒有、40 +2', () => {
    const dcAt = (aff: number, favor = 40, hostility = 0) => {
      const s = structuredClone(game.state)
      const m = (s as unknown as { meters: Record<string, Record<string, number>> }).meters
      m.affinity = { npc_tw_vendor: aff }
      m.favor = { f_corp: favor }
      m.hostility = { f_corp: hostility }
      return difficulty(k, s, 'npc_chat', npc, undefined).dc
    }
    const g = npc.guard
    expect([-21, -20, -1, 0, 19, 20, 39, 40].map((a) => dcAt(a) - g)).toEqual([2, 1, 1, 0, 0, -1, -1, -2])
    expect(dcAt(0, 59) - g).toBe(0)
    expect(dcAt(0, 60) - g).toBe(-1)
    expect(dcAt(0, 21) - g).toBe(0)
    expect(dcAt(0, 20) - g).toBe(1)
    expect(dcAt(0, 40, 39) - g).toBe(0)
    expect(dcAt(0, 40, 40) - g).toBe(2)
  })

  it('讀橋：DC = 10 + 防護階 × 3：街坊 0 → 10、行者 1 → 13、職員 2 → 16、帶 manager 或 guard 旗標 3 → 19；旗標 shield:N 優先', () => {
    const base = { ...npc, flags: [] as string[] }
    const dc = (n: typeof npc) => difficulty(k, game.state, 'npc_read_bridge', n, undefined).dc
    expect(dc({ ...base, kind: 'citizen' })).toBe(10)
    expect(dc({ ...base, kind: 'runner' })).toBe(13)
    expect(dc({ ...base, kind: 'staff' })).toBe(16)
    expect(dc({ ...base, kind: 'staff', flags: ['manager'] })).toBe(19)
    expect(dc({ ...base, kind: 'citizen', flags: ['guard'] })).toBe(19)
    expect(dc({ ...base, kind: 'staff', flags: ['shield:0'] })).toBe(10)
    expect(dc({ ...base, kind: 'citizen', flags: ['shield:4'] })).toBe(22)
    expect(shieldOf(R, { ...base, kind: 'runner', flags: ['manager'] })).toBe(3)
  })
})

describe('邊界 NPC_SYSTEM 6.4：讀橋揭開的項目', () => {
  it('性質：要幾項就最多幾項（0、1、2、很多）、不重複、先選的類別排前面；已經知道的不再揭開；全部知道了就是空的', () => {
    const t = makeCityGame({ seed: 7 })
    const npc = npcOf(t.game.k, t.game.state, 'npc_tw_vendor')!
    for (const category of READ_CATEGORIES) {
      for (const count of [0, 1, 2, 5, 50]) {
        const facts = revealFacts(t.game.state, npc, category, count)
        expect(facts.length).toBeLessThanOrEqual(count)
        expect(new Set(facts).size).toBe(facts.length)
      }
    }
    // 全部揭開之後再讀：沒有東西可揭
    const all = revealFacts(t.game.state, npc, 'tendency', 100)
    const s = structuredClone(t.game.state)
    const rel = (s.ext.npcs as { rel: Record<string, { known?: string[] }> }).rel
    rel.npc_tw_vendor = { ...(rel.npc_tw_vendor ?? {}), known: all } as never
    expect(revealFacts(s, npc, 'tendency', 100).filter((f) => all.includes(f))).toEqual([])
  })
})
