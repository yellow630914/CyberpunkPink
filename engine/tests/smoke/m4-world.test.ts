// 冒煙 M4・最小的假世界（dev/work/M4-smoke.md 驗收條件）：bodyWorld() 帶著全部功能載入沒有錯、什麼都沒被濾掉；逐一拿掉每一個功能，其餘照樣載得起來（worldFor 濾掉那個功能的內容種類與引用它的筆）。

import { describe, expect, it } from 'vitest'
import { FEATURES } from '../../src/features'
import { bodyContent, bodyWorld, makeBodyGame } from '../../src/testkit'

describe('冒煙 M4：最小的假世界 bodyWorld()', () => {
  it('帶著全部功能載入沒有錯；沒有任何一種內容種類或任何一筆被濾掉', () => {
    const t = makeBodyGame()
    expect(t.dropped).toEqual([])
    expect(t.droppedEntries).toEqual([])
  })

  it('每一種內容至少有幾筆：橋兩座、義體七件以上、零件十來個、診所三種加調校診所、藥三種、調校兩種、惡意韌體兩種、流竄 AI 與兩件蠱惑事件、夜課五個以上與體位、簾後館兩個夜、拍賣八件與四位競標者、生命軌跡每張表兩條', () => {
    const c = bodyContent()
    const n = (kind: string): number => (c[kind] ?? []).length
    const bps = (c.blueprint as Array<{ slot?: string; kind?: string }>)
    expect(bps.filter((b) => b.slot === 'bridge')).toHaveLength(2)
    expect(bps.filter((b) => b.kind === 'cyberware').length).toBeGreaterThanOrEqual(7)
    expect(n('part')).toBeGreaterThanOrEqual(10)
    expect((c.facility_type as Array<{ clinic?: unknown; tuning?: unknown }>).filter((f) => f.clinic).length).toBe(3)
    expect((c.facility_type as Array<{ tuning?: unknown }>).filter((f) => f.tuning).length).toBe(1)
    expect((c.item as Array<{ category?: string }>).filter((i) => i.category === 'drug')).toHaveLength(3)
    expect(n('tuning')).toBe(2)
    expect(n('malware')).toBe(2)
    expect(n('rogue_ai')).toBe(1)
    expect((c.event as Array<{ scope?: string }>).filter((e) => e.scope === 'rogue_ai')).toHaveLength(2)
    expect(n('night_skill')).toBeGreaterThanOrEqual(5)
    expect((c.position as Array<{ people?: number }>).some((p) => p.people === 3)).toBe(true)
    expect(n('curtain_night')).toBe(2)
    expect(n('auction_lot')).toBe(8)
    expect(n('auction_bidder')).toBe(4)
    expect(n('unreg_preset')).toBe(4)
    expect(n('auction_house')).toBe(1)
    const tables = new Set((c.lifepath_entry as Array<{ table: string }>).map((e) => e.table))
    expect([...tables].sort()).toEqual(['enemy', 'ex', 'family', 'friend', 'incident', 'kink', 'sex', 'want'])
    for (const t of tables) expect((c.lifepath_entry as Array<{ table: string }>).filter((e) => e.table === t).length, t).toBe(2)
  })

  it('bodyWorld() 每次給新的複本（改一份不動到下一份）', () => {
    const a = bodyWorld()
    a.content.faction!.length = 0
    expect(bodyWorld().content.faction!.length).toBeGreaterThan(0)
  })

  it.each(Object.keys(FEATURES))('拿掉功能 %s 之後其餘照樣載得起來', (id) => {
    // character 是基礎：資料的行動表（climb 的 hint 用 hp 效果）要它；拿掉它時不載資料的規則表（和 m2-world 一樣）
    const t = makeBodyGame({ without: [id], at: null, ...(id === 'character' ? { noRules: true } : {}) })
    expect(t.game.state.version).toBeGreaterThan(0)
    for (const kind of t.dropped) expect(typeof kind).toBe('string')
  })
})
