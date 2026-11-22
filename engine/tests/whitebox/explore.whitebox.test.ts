// 白箱測試：features/explore（走到保全崗就開打、撤離點、打贏之後清掉保全崗）。
// 補主套件沒有走到的分支：保全崗資料壞掉、遭遇點找不到或走不到、戰鬥結束時 origin.ext 壞掉、隊伍是空的、撤離點的錯誤。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, SpecialMapEntry } from '../../src'
import { exploreFeature, placeGuards } from '../../src/features/explore'
import { TEST_COMBAT, enemyUnit, makeGame, playOut, stateHash, testWeapon } from '../../src/testkit'

const sheet = (o: Record<string, unknown> = {}) => ({
  id: 'floor', name: '倉庫', size: [9, 5],
  layout: ['#########', 'E.1.+.2G#', '#...#...#', '#G..#..X#', '#########'],
  zones: ['#########', 'aaaaabbb#', '#aaa#bbb#', '#aaa#bbb#', '#########'],
  cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '側門' }, { id: 'G1', at: [7, 1], mark: 'G', name: '後倉的崗哨' }, { id: 'G2', at: [1, 3], mark: 'G', name: '前廳的角落' }, { id: 'X1', at: [7, 3], mark: 'X', name: '卸貨口' }],
  spots: [{ id: '!1', at: [2, 1], cover: 'sparse' }, { id: '!2', at: [6, 1], cover: 'dense', field: ['dark'] }],
  ...o,
})
const foe = () => ({ from: 'unit', unit: enemyUnit('minion', 1, { hp: { now: 1, max: 45 }, evade: -30 }) as unknown as Record<string, unknown> })
const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5)] })) } }
const setup = (s: unknown = sheet(), guards: unknown = { G1: { foes: [foe()] } }, party?: string[]) => {
  const pack: ContentPack = { id: 'x', content: { special_map: [{ id: 'map_w', kind: 'test', size: [9, 5], sheets: [s] } as unknown as SpecialMapEntry] } }
  const t = makeGame({ features: [exploreFeature, TEST_COMBAT, GEAR as never], content: [pack] })
  const id = t.game.enterMap('map_w')
  if (guards) t.game.commit({ kind: 'system', action: 'test.guards', location: {}, party: [], timeline: [], changes: placeGuards(t.game.state, id, guards as never), outcome: { result: 'ok', summary: '放保全。' } })
  if (party) t.game.state.party = party
  return { ...t, id }
}
const commit = (g: ReturnType<typeof setup>['game'], changes: Change[]) => g.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: 't' } })

describe('白箱 placeGuards 與保全崗的資料（dev/work/M1-explore.md）', () => {
  it('placeGuards：沒有這份實例丟錯；保留原本的 ext、複製進去（改原物件不影響狀態）', () => {
    const { game, id } = setup(sheet(), null)
    expect(() => placeGuards(game.state, 'm9', {})).toThrow(/沒有 m9 這份地圖/)
    commit(game, [{ op: 'map.ext', map: id, value: { quest: 'q1' } }])
    const guards = { G1: { foes: [foe()], faction: 'eden' } }
    const [change] = placeGuards(game.state, id, guards)
    expect(change).toMatchObject({ op: 'map.ext', value: { quest: 'q1', guards: { G1: { faction: 'eden' } } } })
    guards.G1.faction = 'changed'
    expect((change as unknown as { value: { guards: { G1: { faction: string } } } }).value.guards.G1.faction).toBe('eden')
  })

  it('保全崗的資料壞掉（guards 不是物件、這一格不是物件、foes 不是陣列）：當成沒放人，只是地板', () => {
    for (const bad of ['x', { G1: 'x' }, { G1: { foes: 'x' } }, { G1: null }]) {
      const { game } = setup(sheet(), null)
      commit(game, [{ op: 'map.ext', map: 'm1', value: { guards: bad } }])
      expect(game.gridMove([7, 1]).reports.map((r) => r.action), JSON.stringify(bad)).toEqual(['grid.move'])
      expect(game.battle).toBeNull()
    }
    const none = setup(sheet(), null)
    commit(none.game, [{ op: 'map.ext', map: 'm1', value: null }])
    expect(none.game.gridMove([7, 1]).reports.map((r) => r.action)).toEqual(['grid.move'])
  })
})

describe('白箱 用哪個遭遇點（SITES 12.5 節；COMMISSION_MAPS 1.3 節）', () => {
  it('遭遇點在上鎖的門後面（走路走不到）：距離是無限大，排在走得到的後面；都走不到時取 spots 裡前面的那一個', () => {
    const locked = (spots: Array<Record<string, unknown>>) => sheet({ layout: ['#########', 'E.1.%.2G#', '#...#...#', '#G..#..X#', '#########'].map((r) => r.replace('+', '%')), spots })
    const reach = setup(locked([{ id: '!1', at: [2, 1], cover: 'sparse' }, { id: '!2', at: [6, 1], cover: 'dense' }]))
    reach.game.state.maps.at = { map: 'm1', sheet: 'floor', x: 6, y: 1 }
    reach.game.gridMove('east')
    expect(reach.game.battle!.origin.ext).toMatchObject({ spot: '!2' })
    const none = setup(sheet({ layout: ['#########', 'E.1.2.%G#', '#...#.#.#', '#G..#.#X#', '#########'], zones: undefined, spots: [{ id: '!1', at: [2, 1], cover: 'sparse' }, { id: '!2', at: [4, 1], cover: 'dense' }] }))
    none.game.state.maps.at = { map: 'm1', sheet: 'floor', x: 6, y: 1 }
    none.game.gridMove('east')
    expect(none.game.battle!.origin.ext).toMatchObject({ guard: 'G1', spot: '!1' })
  })

  it('遭遇點的場地效果（field 的名字）變成 { 名字: true }；沒有寫就是空的', () => {
    const { game } = setup()
    game.gridMove([7, 1])
    expect(game.battle!.field).toEqual({ dark: true })
    expect(game.battle!.origin.ext).toMatchObject({ map: 'm1', sheet: 'floor', guard: 'G1', spot: '!2', at: [7, 1] })
    expect(game.battle!.origin).toMatchObject({ escapable: true, place: '後倉的崗哨' })
  })
})

describe('白箱 隊伍與開不起來的戰（不變式第 3、61 條）', () => {
  it('我方是隊伍裡的每一個人；隊伍是空的：整步不成立、人沒有站過去、沒有留下報告', () => {
    const empty = setup(sheet(), { G1: { foes: [foe()] } }, [])
    const before = stateHash(empty.game.state)
    const r = empty.game.gridMove([7, 1])
    expect(r.status).toBe('refused')
    expect(r.reason).toMatch(/這裡的戰鬥開不起來（雙方都要有人上場/)
    expect(stateHash(empty.game.state)).toBe(before)
    const two = setup(sheet(), { G1: { foes: [foe()] } }, ['pc', 'pc'])
    two.game.gridMove([7, 1])
    expect(Object.values(two.game.battle!.units).filter((u) => u.side === 'ally').length).toBe(2)
  })

  it('保全崗放了空的 foes：同樣整步不成立', () => {
    const { game } = setup(sheet(), { G1: { foes: [] } })
    const r = game.gridMove([7, 1])
    expect(r.status).toBe('refused')
    expect(r.reason).toMatch(/雙方都要有人上場/)
    expect(game.state.maps.at).toMatchObject({ x: 0, y: 1 })
  })
})

describe('白箱 戰鬥結束之後清掉保全崗（COMBAT_SYSTEM 第 10 節）', () => {
  const finish = async (game: ReturnType<typeof setup>['game'], outcome?: string) => {
    playOut(game)
    if (outcome) game.state.battle!.result = { outcome, text: 'x' }
    return game.finishBattle()
  }

  it('打贏：那一格記成 used；結束時 origin.ext 壞掉（不是字串的 guard、map 不見了、at 不是陣列、實例不在了）不清也不丟錯', async () => {
    const { game } = setup()
    game.gridMove([7, 1])
    await finish(game)
    expect(game.state.maps.instances.m1!.sheets.floor!.cells['7,1']).toMatchObject({ used: true })
    for (const bad of [{ guard: 5 }, { guard: 'G1', map: 5 }, { guard: 'G1', map: 'm1', sheet: 5 }, { guard: 'G1', map: 'm1', sheet: 'floor', at: 'x' }, { guard: 'G1', map: 'm9', sheet: 'floor', at: [7, 1] }]) {
      const t = setup()
      t.game.gridMove([7, 1])
      t.game.state.battle!.origin.ext = bad
      const r = await finish(t.game)
      expect(r.status, JSON.stringify(bad)).toBe('applied')
      expect(t.game.state.maps.instances.m1!.sheets.floor?.cells['7,1']?.used, JSON.stringify(bad)).toBeUndefined()
    }
  })

  it('沒有 origin.ext（不是從保全崗開打的戰鬥）：打贏也不動地圖', async () => {
    const t = setup()
    t.game.gridMove([7, 1])
    delete t.game.state.battle!.origin.ext
    const before = JSON.stringify(t.game.state.maps)
    await finish(t.game)
    expect(JSON.stringify(t.game.state.maps)).toBe(before)
  })

  it('脫離（不是勝利）：保全還在那一格，之後再走進去還會開打', async () => {
    const t = setup()
    t.game.gridMove([7, 1])
    await finish(t.game, 'fled')
    expect(t.game.state.maps.instances.m1!.sheets.floor?.cells['7,1']?.used).toBeUndefined()
  })
})

describe('白箱 撤離點（COMBAT_SYSTEM 第 10 節）', () => {
  it('只有撤離點（X）列出「離開」；useHere 錯的事、不在撤離點、不在地圖上都丟錯', () => {
    const { game } = setup(sheet(), null)
    expect(game.gridView()!.here.uses).toEqual([])
    expect(() => exploreFeature.useHere(game.k, game.state, 'leave')).toThrow(/這一格不是撤離點/)
    expect(() => exploreFeature.useHere(game.k, game.state, 'dance')).toThrow(/這一格沒有「dance」可以做/)
    game.gridMove([7, 3])
    expect(game.gridView()!.here.uses).toEqual([{ id: 'leave', name: '離開', block: null }])
    const draft = exploreFeature.useHere(game.k, game.state, 'leave')
    expect(draft).toMatchObject({ action: 'grid.leave', outcome: { result: 'left', summary: '你從卸貨口離開。' } })
    expect(draft.changes.map((c) => c.op)).toEqual(['map.at', 'map.close'])
    const away = makeGame({ features: [exploreFeature, TEST_COMBAT] }).game
    expect(() => exploreFeature.useHere(away.k, away.state, 'leave')).toThrow(/這一格不是撤離點/)
  })
})
