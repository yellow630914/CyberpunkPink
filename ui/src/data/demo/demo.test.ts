import { describe, it, expect } from 'vitest'
import { FakeProvider, Game } from '@engine/src'
import { CORE_PACK } from '@engine/data'
import { allFeatures } from '@engine/src/features'
import { arrive, cityGraph, worldProblems, worldView } from '@engine/src/features/world'
import { transitView } from '@engine/src/features/transit'
import { demoPack, demoStartFeature } from '.'

/** 示意世界包能被引擎載入：內容的格式、引用、出口成對、車站在街區的設施上，都由引擎的檢查把關。 */
const make = () => new Game({ features: [...allFeatures(), demoStartFeature()], content: [CORE_PACK, demoPack()], fakeProvider: new FakeProvider() })

describe('示意世界包', () => {
  it('引擎載得進去，世界的整體檢查沒有問題', () => {
    const g = make()
    expect(worldProblems(g.k)).toEqual([])
  })
  it('八個區、每個區至少一塊街區，城市圖的走道成對', () => {
    const g = make()
    const c = cityGraph(g.k)
    expect(c.districts).toHaveLength(8)
    for (const d of c.districts) expect(d.blocks.length).toBeGreaterThan(0)
    expect(c.links.length).toBeGreaterThan(10)
  })
  it('開新局站在四號塔的晾衣場，右邊的設施與出口都有', () => {
    const g = make()
    g.newGame({ seed: 1 })
    const w = worldView(g.k, g.state)
    expect(w.district?.id).toBe('hive')
    expect(w.block?.name).toBe('四號塔')
    expect(w.facility?.name).toBe('屋頂的晾衣場')
    expect(w.exits.length).toBeGreaterThan(0)
    expect(w.facilities.length).toBeGreaterThan(5)
  })
  it('天井市場有車站，站上列出紅線與輕軌以外的線', () => {
    const g = make()
    const b = 'b_hive_1'
    g.newGame({ seed: 1 })
    g.commit(arrive(g.k, g.state, b))
    const st = worldView(g.k, g.state).facilities.find(f => f.type === 'fac_transit')!
    g.commit(arrive(g.k, g.state, b, st.marker))
    const t = transitView(g.k, g.state)
    expect(t.station?.lines.map(l => l.id)).toEqual(['line_red'])
  })
})
