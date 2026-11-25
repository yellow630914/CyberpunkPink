// 白箱測試：features/dive 的去處（when 條件、need 的三種）與 features/maze 的報名擋法（已報名、別的行程進行中）。
// 規格：CYBERSPACE 2.2、2.3 節（接入點、誰能進）、8.2 節（報名）；dev/adr/0018 第八節；不變式第 162、170、172 條。
// 補主套件沒有走到的分支：去處的 when 不成立就不列、不存在與 when 不成立同一句、need 三種的原因、已經報了名與已經有一趟網內的行程時再報名的擋法。

import { describe, expect, it } from 'vitest'
import type { ContentPack } from '../../src'
import { clone } from '../../src'
import { goBlock, go as diveGo, readDive, sites } from '../../src/features/dive'
import { enterBlocks } from '../../src/features/maze'
import { diveIn, makeDiveGame, mazeSignUp, refitForRookie } from '../../src/testkit'

type G = ReturnType<typeof makeDiveGame>['game']
const SETUP = { entry: 'dig', site: 'tw_site_c', region: 'tw_subnet', grade: 1, faction: 'f_gang', facility: 'nf_tw_office', encounter: ['minion'] }
const site = (id: string, o: Record<string, unknown>) => ({ id, name: id, kind: 'netrun', need: 'any', desc: `${id}。`, setup: SETUP, ...o })
const PACK: ContentPack = {
  id: 'wb_sites',
  content: { net_site: [site('ns_wb_when', { when: { kind: 'flag', key: 'wb_unlocked' } }), site('ns_wb_deck', { need: 'deck' }), site('ns_wb_rental', { need: 'rental' })] } as never,
}
// 潛入中只放行一部分的 doing：用「事件」這一類的報告提交測試用的變更
const sys = (g: G, changes: unknown[]) => g.commit({ kind: 'event', action: 'event.test', location: clone(g.state.location), party: [], timeline: [], changes: changes as never, outcome: { result: 'ok', summary: 't' } })

describe('白箱 dive：去處的條件（CYBERSPACE 2.3 節「誰能進」；net_site 的 when、need）', () => {
  it('when 不成立的去處不列、硬問 goBlock 和「不存在」同一句；條件成立（旗標設了）才列、才去得了', () => {
    const { game: g } = makeDiveGame({ content: [PACK] as never })
    diveIn(g)
    expect(sites(g.k, g.state).map((s) => s.id)).not.toContain('ns_wb_when')
    expect(goBlock(g.k, g.state, 'ns_wb_when')).toBe('沒有這個地方，或現在不在你去得了的地方裡。')
    expect(goBlock(g.k, g.state, 'ns_nope')).toBe('沒有這個地方，或現在不在你去得了的地方裡。')
    sys(g, [{ op: 'flag', key: 'wb_unlocked', value: true }])
    expect(sites(g.k, g.state).map((s) => s.id)).toContain('ns_wb_when')
    expect(goBlock(g.k, g.state, 'ns_wb_when')).toBeNull()
    expect(() => diveGo(g.k, g.state, 'ns_wb_when')).not.toThrow()
  })

  it('need：自己的甲板什麼去處都去得了；租來的甲板去不了 need: deck（寫「租來的甲板不行」），need: rental 與 any 行', () => {
    const own = makeDiveGame({ content: [PACK] as never }).game
    diveIn(own)
    expect(readDive(own.state)!.deck).toBe('own')
    expect(['ns_wb_deck', 'ns_wb_rental', 'ns_tw_guest'].map((id) => goBlock(own.k, own.state, id))).toEqual([null, null, null])
    const rented = makeDiveGame({ content: [PACK] as never, noDeck: true }).game
    diveIn(rented)
    expect(readDive(rented.state)!.deck).toBe('rental')
    const row = (id: string) => sites(rented.k, rented.state).find((s) => s.id === id)!
    expect(row('ns_wb_deck').block).toBe('這裡只有自己的甲板進得去：租來的甲板不行。')
    expect(row('ns_wb_rental').block).toBeNull()
    expect(row('ns_tw_guest').block).toBeNull()
  })
})

describe('白箱 maze：報名的擋法（CYBERSPACE 8.2 節；不變式第 172 條）', () => {
  function ready(): G {
    const { game } = makeDiveGame()
    refitForRookie(game)
    diveIn(game)
    return game
  }

  it('已經報了名：再報擋「你已經報了名，先把這一趟做完」；狀態沒動', () => {
    const g = ready()
    mazeSignUp(g, 'rookie', 3)
    const before = clone(g.state)
    expect(enterBlocks(g.k, g.state, 'rookie')).toContain('你已經報了名，先把這一趟做完。')
    expect(g.state).toEqual(before)
  })

  it('別的網內的行程（自己去挖的子網）進行中：報名擋「已經有一趟網內的行程在進行」', () => {
    const g = ready()
    g.commit(diveGo(g.k, g.state, 'ns_tw_dig'))
    expect(enterBlocks(g.k, g.state, 'rookie').join('；')).toMatch(/已經有一趟網內的行程在進行|你已經報了名/)
  })
})
