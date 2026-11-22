// 驗收測試：dev/work/M1-explore.md（cpp-feature）。工單做完之前照預期失敗（features/explore 還不存在）。
// 規格：COMBAT_SYSTEM 第 10 節（探索用格子，走到敵人那一格就開打）；SITES 12.5 節只用「用哪個遭遇點」那一列
//（監視器、巡邏、門鎖的檢定是 M2）；COMMISSION_MAPS 1.3、1.5 節（遭遇點的配置、G 是開場時保全站的位置）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, SpecialMapEntry } from '../../src'
import { exploreFeature, placeGuards } from '../../src/features/explore'
import { TEST_COMBAT, enemyUnit, makeGame, playOut } from '../../src/testkit'

const MAP: SpecialMapEntry = {
  id: 'map_t_explore', kind: 'test', size: [9, 5],
  sheets: [{
    id: 'floor', name: '倉庫', size: [9, 5],
    layout: ['#########', 'E.1.+.2G#', '#...#...#', '#G..#..X#', '#########'],
    zones: ['#########', 'aaaaabbb#', '#aaa#bbb#', '#aaa#bbb#', '#########'],
    zone_names: { a: '前廳', b: '後倉' },
    cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '側門' }, { id: 'G1', at: [7, 1], mark: 'G', name: '後倉的崗哨' }, { id: 'G2', at: [1, 3], mark: 'G', name: '前廳的角落' }, { id: 'X1', at: [7, 3], mark: 'X', name: '卸貨口' }],
    spots: [{ id: '!1', at: [2, 1], cover: 'sparse' }, { id: '!2', at: [6, 1], cover: 'dense', field: ['dark'] }],
  }],
}
const foe = (rank: 'minion' | 'elite' = 'minion', o = {}) => ({ from: 'unit', unit: enemyUnit(rank, 1, { hp: { now: 1, max: 45 }, evade: -30, ...o }) as unknown as Record<string, unknown> })
const PACK: ContentPack = { id: 'explore_test', content: { special_map: [MAP] } }
const setup = () => {
  const { game } = makeGame({ features: [exploreFeature, TEST_COMBAT], content: [PACK] })
  const id = game.enterMap('map_t_explore')
  // 發起的功能（之後是委託副本）把每個保全崗放誰寫在這份實例上
  game.commit({ kind: 'system', action: 'test.guards', location: {}, party: [], timeline: [], changes: placeGuards(game.state, id, { G1: { foes: [foe(), foe()], faction: 'hizakura' }, G2: { foes: [foe('elite')], faction: 'hizakura' } }), outcome: { result: 'ok', summary: '放保全。' } })
  return game
}

describe('走到敵人那一格就開打', () => {
  it('走進保全崗：這一步之後接著開戰；我方是隊伍裡的人；用保全崗所在區塊的遭遇點（遮蔽的配置與場地效果）', () => {
    const game = setup()
    const r = game.gridMove([7, 1])
    expect(r.status).toBe('applied')
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    const b = game.battle!
    expect(Object.values(b.units).filter((u) => u.side === 'ally').map((u) => u.actor)).toEqual(['pc'])
    expect(Object.values(b.units).filter((u) => u.side === 'foe')).toHaveLength(2)
    // G1 在區塊 b：用那一區的遭遇點 !2（密、黑暗）
    expect(b.cover.foe.map((c) => c.level)).toEqual([1, 1, 2, 2])
    expect(b.field).toMatchObject({ dark: true })
    expect(b.origin).toMatchObject({ escapable: true, place: '後倉的崗哨', faction: 'hizakura', ext: { map: 'm1', sheet: 'floor', guard: 'G1', spot: '!2' } })
  })

  it('打贏了：那個保全崗清掉，可以走過去；沒放人的保全崗只是一格地板', async () => {
    const game = setup()
    game.gridMove([7, 1])
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(game.state.maps.instances.m1!.sheets.floor!.cells['7,1']).toEqual({ used: true })
    expect(game.gridMove('west').status).toBe('applied')
    expect(game.gridMove('east').reports.map((x) => x.action)).toEqual(['grid.move'])
    expect(game.battle).toBeNull()
  })

  it('另一個保全崗用它自己那一區的遭遇點；那一區有好幾個時用走路最近的', () => {
    const game = setup()
    const r = game.gridMove([1, 3])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.battle!.cover.foe.map((c) => c.level)).toEqual([0, 0, 0, 1]) // 區塊 a 的 !1：稀
    expect(game.battle!.origin.ext).toMatchObject({ guard: 'G2', spot: '!1' })
    expect(game.battle!.field.dark).toBeUndefined()
  })

  it('站在撤離點：列出「離開」，做了就離開這張地圖、清掉這份實例', () => {
    const game = setup()
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: [{ op: 'map.at', to: { map: 'm1', sheet: 'floor', x: 7, y: 3 } }], outcome: { result: 'ok', summary: '站到卸貨口。' } })
    expect(game.gridView()!.here.uses).toEqual([{ id: 'leave', name: '離開', block: null }])
    const [r] = game.commit(exploreFeatureUse(game, 'leave'))
    expect(r!.action).toBe('grid.leave')
    expect(game.state.maps.at).toBeNull()
    expect(game.state.maps.instances).toEqual({})
  })
})

/** 做「這一格能做的事」：功能匯出的 useHere(k, state, id) 回傳一份報告草稿。 */
function exploreFeatureUse(game: ReturnType<typeof setup>, id: string) {
  // 寫成間接呼叫，這份測試只 import 一次功能的入口
  return (exploreFeature as unknown as { useHere(k: unknown, state: unknown, id: string): Parameters<typeof game.commit>[0] }).useHere(game.k, game.state, id)
}
