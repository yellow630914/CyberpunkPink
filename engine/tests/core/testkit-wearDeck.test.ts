// testkit 的 wearDeck／unwearDeck（dev/adr/0019「實作補記：M4-cyber-deck」的 testkit 做法）。
// 兩種局：沒有人掛 deck.source（沒裝義體功能）走 equipDraft（來源 own）；有人掛（全部功能）直接放進腦部（來源 implant，不經手術）。

import { describe, expect, it } from 'vitest'
import { ActionBlocked, toMinutes } from '../../src'
import { cyberOf } from '../../src/features/cyberware'
import { IMPLANT_ONLY, deckOf, equipDraft } from '../../src/features/deck'
import { deckIsImplant, makeNetBattleGame, unwearDeck, wearDeck } from '../../src/testkit'

/** 不開打的一局，主角已經穿著 D1（makeNetBattleGame 的 equipParty 用 wearDeck）；背包再多一副 II 級的 D9。 */
const game = (without: string[] = []) => {
  const { game: g } = makeNetBattleGame({ noBattle: true, without })
  g.commit({ kind: 'system', action: 'test.set', location: {}, party: [], timeline: [], changes: [{ op: 'item', id: 'dk_tw_ii', qty: 1, data: { uid: 'D9' } }] as never, outcome: { result: 'ok', summary: 't' } })
  return g
}

describe('wearDeck：沒有義體功能的局走 deck.equip', () => {
  it('來源是 own、報告是 deck.equip、甲板還在背包裡；拿掉就是 equipDraft(null)', () => {
    const g = game(['cyberware'])
    expect(deckIsImplant(g.k)).toBe(false)
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ has: true, source: 'own', deck: 'dk_tw_ii', uid: 'D1' })
    const reports = g.commit(wearDeck(g.k, g.state, 'pc', 'D9'))
    expect(reports.map((r) => r.action)).toEqual(['deck.equip'])
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ source: 'own', uid: 'D9' })
    expect(g.state.inventory.some((s) => s.data?.uid === 'D1')).toBe(true)
    g.commit(unwearDeck(g.k, g.state, 'pc'))
    expect(deckOf(g.k, g.state, 'pc').has).toBe(false)
    expect(() => unwearDeck(g.k, g.state, 'pc')).toThrow(ActionBlocked)
  })
})

describe('wearDeck：有義體功能的局把甲板放進腦部', () => {
  it('equipDraft 被擋（IMPLANT_ONLY）；穿著的是腦部的一件 kind_of: deck、來源 implant、背包少一疊', () => {
    const g = game()
    expect(deckIsImplant(g.k)).toBe(true)
    expect(() => equipDraft(g.k, g.state, 'pc', 'D9')).toThrow(IMPLANT_ONLY)
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ has: true, source: 'implant', deck: 'dk_tw_ii', uid: 'D1', grade: 2, slotsTotal: 6, firewall: 12 })
    expect(cyberOf(g.state, 'pc')).toEqual([expect.objectContaining({ uid: 'D1', bp: 'dk_tw_ii', kind_of: 'deck', slot: 'brain' })])
    expect(g.state.inventory.some((s) => s.data?.uid === 'D1')).toBe(false)
    expect(g.state.reports.some((r) => r.action === 'test.wear_deck')).toBe(true)
  })

  it('不經手術：不花時間、不收費、不休養；沉溺是設定的成本（規則表 6），角色的沉溺補到下限', () => {
    const g = game()
    // 隊友一還沒有動過：他的 sink 是 equipParty 補到的下限
    const mate = 'a_tw_n1'
    const piece = cyberOf(g.state, mate)[0]!
    expect(piece).toMatchObject({ kind_of: 'deck', sink: 6 })
    expect(piece.ready_at).toBeUndefined()
    expect(g.k.stats.stat(g.state, mate, 'sink_floor')).toBe(6)
    expect(g.state.actors[mate]!.sink).toBeGreaterThanOrEqual(6)
    expect(g.state.actors[mate]!.conditions.some((c) => c.id === 'recovering')).toBe(false)
    // 再穿一次：時間與錢不動
    const before = { time: toMinutes(g.state.time), money: { ...g.state.money } }
    g.commit(wearDeck(g.k, g.state, mate, 'D9'))
    expect(toMinutes(g.state.time)).toBe(before.time)
    expect(g.state.money).toEqual(before.money)
  })

  it('換一副：腦裡原本那一副整副放回背包（只帶 uid），下限還是一副的成本；拿掉是放回背包、沒有甲板', () => {
    const g = game()
    g.commit(wearDeck(g.k, g.state, 'pc', 'D9'))
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ source: 'implant', uid: 'D9' })
    expect(cyberOf(g.state, 'pc').filter((p) => p.slot === 'brain')).toHaveLength(1)
    expect(g.state.inventory.find((s) => s.data?.uid === 'D1')).toMatchObject({ id: 'dk_tw_ii', qty: 1, data: { uid: 'D1' } })
    expect(g.k.stats.stat(g.state, 'pc', 'sink_floor')).toBe(6)
    g.commit(unwearDeck(g.k, g.state, 'pc'))
    expect(deckOf(g.k, g.state, 'pc')).toMatchObject({ has: false, source: null })
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(g.state.inventory.some((s) => s.data?.uid === 'D9')).toBe(true)
    expect(() => unwearDeck(g.k, g.state, 'pc')).toThrow(/腦裡沒有甲板/)
  })

  it('測試寫錯的時候丟 Error：背包裡沒有那一副、沒有這個角色', () => {
    const g = game()
    expect(() => wearDeck(g.k, g.state, 'pc', 'nope')).toThrow(/背包裡沒有編號 nope/)
    expect(() => wearDeck(g.k, g.state, 'ghost', 'D9')).toThrow(/沒有 ghost 這個角色/)
    expect(() => unwearDeck(g.k, g.state, 'ghost')).toThrow(/沒有 ghost 這個角色/)
  })
})
