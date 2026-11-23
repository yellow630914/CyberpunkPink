// 探索功能的單元測試（dev/work/M1-explore.md）。驗收測試在 M1-explore.test.ts；這裡補它沒走到的分支：
// 沒放人的保全崗、輸了與脫離不清掉、同一區沒有遭遇點、整張圖都沒有遭遇點、placeGuards 與 useHere 的錯誤路徑。
// 我方用一個測試用的裝備提供者帶一把手槍（驗收測試的主角是空手，打不到第 2 格的敵人）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, SpecialMapEntry } from '../../src'
import { exploreFeature, placeGuards } from '../../src/features/explore'
import { TEST_COMBAT, enemyUnit, makeGame, playOut, testWeapon } from '../../src/testkit'

const sheet = (o: Record<string, unknown> = {}) => ({
  id: 'floor', name: '倉庫', size: [9, 5],
  layout: ['#########', 'E.1.+.2G#', '#...#...#', '#G..#..X#', '#########'],
  zones: ['#########', 'aaaaabbb#', '#ccc#bbb#', '#ccc#bbb#', '#########'],
  zone_names: { a: '前廳', b: '後倉', c: '前廳的角落' },
  cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '側門' }, { id: 'G1', at: [7, 1], mark: 'G', name: '後倉的崗哨' }, { id: 'G2', at: [1, 3], mark: 'G', name: '前廳的角落' }, { id: 'X1', at: [7, 3], mark: 'X', name: '卸貨口' }],
  spots: [{ id: '!1', at: [2, 1], cover: 'sparse' }, { id: '!2', at: [6, 1], cover: 'dense', field: ['dark'] }],
  ...o,
})
const mapOf = (s: unknown): SpecialMapEntry => ({ id: 'map_t_unit', kind: 'test', size: [9, 5], sheets: [s] } as unknown as SpecialMapEntry)
const foe = () => ({ from: 'unit', unit: enemyUnit('minion', 1, { hp: { now: 1, max: 45 }, evade: -30 }) as unknown as Record<string, unknown> })
const GEAR = { id: 'test_gear', install(k: { battle: { loadout(o: string, fn: () => unknown): void } }) { k.battle.loadout('test_gear', () => ({ weapons: [testWeapon('pistol', 5)] })) } }

function setup(s: unknown = sheet(), guards: Record<string, { foes: ReturnType<typeof foe>[]; faction?: string }> | null = { G1: { foes: [foe(), foe()] }, G2: { foes: [foe()] } }) {
  const pack: ContentPack = { id: 'explore_unit', content: { special_map: [mapOf(s)] } }
  const t = makeGame({ features: [exploreFeature, TEST_COMBAT, GEAR as never], content: [pack] })
  const id = t.game.enterMap('map_t_unit')
  if (guards) t.game.commit({ kind: 'system', action: 'test.guards', location: {}, party: [], timeline: [], changes: placeGuards(t.game.state, id, guards), outcome: { result: 'ok', summary: '放保全。' } })
  return { ...t, id }
}

describe('走進保全崗', () => {
  it('沒放人的保全崗只是一格地板', () => {
    const { game } = setup(sheet(), { G2: { foes: [foe()] } })
    const r = game.gridMove([7, 1])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(game.battle).toBeNull()
  })

  it('完全沒有 placeGuards 過：不開打', () => {
    const { game } = setup(sheet(), null)
    expect(game.gridMove([7, 1]).reports.map((x) => x.action)).toEqual(['grid.move'])
  })

  it('faction 沒寫就不放；寫了才放進 origin', () => {
    const { game } = setup()
    game.gridMove([7, 1])
    expect(game.battle!.origin).not.toHaveProperty('faction')
  })

  it('同一區沒有遭遇點：用整張圖走路最近的（不是 spots 裡排前面的）', () => {
    // 區塊 b 沒有遭遇點；a 的 !1 在 (2,1)、!2 在 (2,2)，從 G1(7,1) 走過去 !1 比較近；spots 把 !2 排前面
    const s = sheet({
      layout: ['#########', 'E.1.+..G#', '#.2.#...#', '#G..#..X#', '#########'],
      spots: [{ id: '!2', at: [2, 2], cover: 'dense' }, { id: '!1', at: [2, 1], cover: 'sparse' }],
    })
    const { game } = setup(s)
    game.gridMove([7, 1])
    expect(game.battle!.origin.ext).toMatchObject({ guard: 'G1', spot: '!1' })
  })

  it('同一區有好幾個遭遇點：走路最近的', () => {
    // b 區的 !2 在 (6,1)（離 G1 一步）、!1 在 (6,2)（兩步）；spots 把 !1 排前面
    const s = sheet({
      layout: ['#########', 'E...+.2G#', '#...#.1.#', '#G..#..X#', '#########'],
      spots: [{ id: '!1', at: [6, 2], cover: 'sparse' }, { id: '!2', at: [6, 1], cover: 'dense', field: ['dark'] }],
    })
    const { game } = setup(s)
    game.gridMove([7, 1])
    expect(game.battle!.origin.ext).toMatchObject({ spot: '!2' })
    expect(game.battle!.field).toMatchObject({ dark: true })
  })

  it('走路一樣近：取 spots 裡前面的', () => {
    // (7,2) 與 (6,1) 離 G1(7,1) 都是一步；!1 排前面
    const s = sheet({
      layout: ['#########', 'E...+.2G#', '#...#..1#', '#G..#..X#', '#########'],
      spots: [{ id: '!1', at: [7, 2], cover: 'sparse' }, { id: '!2', at: [6, 1], cover: 'dense' }],
    })
    const { game } = setup(s)
    game.gridMove([7, 1])
    expect(game.battle!.origin.ext).toMatchObject({ spot: '!1' })
  })
})

describe('戰鬥結束', () => {
  it('打贏了才清掉；清掉之後再走進去不開打', async () => {
    const { game } = setup()
    game.gridMove([7, 1])
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(game.state.maps.instances.m1!.sheets.floor!.cells['7,1']).toEqual({ used: true })
    expect(game.state.maps.instances.m1!.sheets.floor!.cells['1,3']).toBeUndefined()
    game.gridMove('west')
    expect(game.gridMove('east').reports.map((x) => x.action)).toEqual(['grid.move'])
  })

  it('輸了：保全還在那一格（沒有 used）', async () => {
    // 我方一個人、敵方兩個強的：直接讓 AI 打到輸
    const strong = () => ({ from: 'unit', unit: enemyUnit('boss', 5) as unknown as Record<string, unknown> })
    const { game } = setup(sheet(), { G1: { foes: [strong(), strong(), strong()] } })
    game.gridMove([7, 1])
    const out = playOut(game).outcome
    expect(out).toBe('lose')
    await game.finishBattle()
    expect(game.state.maps.instances.m1?.sheets.floor?.cells['7,1']?.used).toBeUndefined()
  })
})

describe('撤離點與錯誤路徑', () => {
  const stand = (game: ReturnType<typeof setup>['game'], x: number, y: number) =>
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: [{ op: 'map.at', to: { map: 'm1', sheet: 'floor', x, y } }], outcome: { result: 'ok', summary: '站過去。' } })

  it('只有撤離點列出「離開」；其他標記沒有', () => {
    const { game } = setup()
    stand(game, 1, 3)
    expect(game.gridView()!.here.uses).toEqual([])
    stand(game, 0, 1)
    expect(game.gridView()!.here.uses).toEqual([])
    stand(game, 7, 3)
    expect(game.gridView()!.here.uses).toEqual([{ id: 'leave', name: '離開', block: null }])
  })

  it('離開：報告的摘要帶撤離點的名字，結果是 left', () => {
    const { game } = setup()
    const k = game.k
    stand(game, 7, 3)
    const draft = exploreFeature.useHere(k as never, game.state, 'leave')
    expect(draft.outcome).toEqual({ result: 'left', summary: '你從卸貨口離開。' })
  })

  it('不在撤離點、不在地圖上、不認得的事：丟錯', () => {
    const { game } = setup()
    const k = game.k
    expect(() => exploreFeature.useHere(k as never, game.state, 'leave')).toThrow() // 站在入口
    expect(() => exploreFeature.useHere(k as never, game.state, 'steal')).toThrow()
    stand(game, 7, 3)
    game.commit(exploreFeature.useHere(k as never, game.state, 'leave'))
    expect(() => exploreFeature.useHere(k as never, game.state, 'leave')).toThrow() // 已經不在地圖上
  })

  it('placeGuards：沒有這份實例丟錯；保留實例原本的 ext', () => {
    const { game, id } = setup(sheet(), null)
    expect(() => placeGuards(game.state, 'm99', {})).toThrow()
    game.commit({ kind: 'system', action: 't', location: {}, party: [], timeline: [], changes: [{ op: 'map.ext', map: id, value: { phase: 2 } }], outcome: { result: 'ok', summary: 'x' } })
    const [c] = placeGuards(game.state, id, { G1: { foes: [] } })
    expect(c).toMatchObject({ op: 'map.ext', map: id, value: { phase: 2, guards: { G1: { foes: [] } } } })
  })
})
