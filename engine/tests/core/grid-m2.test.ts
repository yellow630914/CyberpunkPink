// M2 加在核心地圖引擎上的兩個小東西（M2-world 回報、總指揮追加；工單 dev/work/M2-core-shell.md 的補充）：
// 1. 格子的種類 facility（城市街區上的設施，標記 F；走得上去、看得穿）；
// 2. GridCtx 的 step（這一段路走到的第幾格，從 1 起算）與 last（是不是計畫的最後一格），「走到才發生」的事只在最後一格觸發。
// 規格：dev/adr/0012（格子地圖）、dev/adr/0016（M2 的接縫）；內容用測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { Feature, GridCtx, GridEffect, MarkerDef, SheetDef, SpecialMapEntry } from '../../src'
import { CELL_TRAITS, DEFAULT_LEGEND, Sheet, markersInLayout, sheetProblems, specialMapProblems } from '../../src'
import { makeGame } from '../../src/testkit'

// 一條街：入口 E 在最左邊，兩間設施 F1、F2 在路上，後面兩個遭遇點（每張圖至少要有 2 個）
const STREET: SheetDef = {
  id: 'street', name: '測試街', size: [9, 3],
  layout: ['#########', 'E.F.F.1.2', '#########'],
  cells: [
    { id: 'E1', at: [0, 1], mark: 'E', name: '街口' },
    { id: 'F1', at: [2, 1], mark: 'F', name: '雜貨店' },
    { id: 'F2', at: [4, 1], mark: 'F', name: '診所' },
  ],
  spots: [{ id: '!1', at: [6, 1], cover: 'medium' }, { id: '!2', at: [8, 1], cover: 'sparse' }],
}
const CITY: SpecialMapEntry = { id: 'map_street', kind: 'street', size: [9, 3], sheets: [STREET] }
const content = [{ id: 'maps', content: { special_map: [CITY] } }]

describe('格子的種類 facility（城市街區的設施）', () => {
  it('預設的圖例 F 對到 facility；走得上去、看得穿、標記是 F（和其他標記格一樣）', () => {
    expect(DEFAULT_LEGEND.F).toBe('facility')
    expect(CELL_TRAITS.facility).toEqual({ walk: true, see: true, mark: 'F' })
    const s = new Sheet(STREET)
    expect(s.kindAt(2, 1)).toBe('facility')
    expect(s.walkable(2, 1)).toBe(true)
    expect(s.traitsAt(2, 1).see).toBe(true)
    expect(s.markerAt(2, 1)).toMatchObject({ id: 'F1', name: '雜貨店' })
  })

  it('標記照「由上到下、由左到右」編號成 F1、F2；格式檢查：資料裡要列出每一個 F，位置要對得上', () => {
    expect(markersInLayout(STREET).filter((m) => m.mark === 'F').map((m) => [m.id, m.at])).toEqual([['F1', [2, 1]], ['F2', [4, 1]]])
    expect(sheetProblems(STREET)).toEqual([])
    expect(specialMapProblems(CITY as unknown as Record<string, unknown>)).toEqual([])
    const unlisted = structuredClone(STREET)
    unlisted.cells = unlisted.cells!.filter((m) => m.id !== 'F2')
    expect(sheetProblems(unlisted).join('\n')).toMatch(/F2（4,1）沒有列在 cells 裡/)
    const moved = structuredClone(STREET)
    moved.cells!.find((m) => m.id === 'F1')!.at = [3, 1]
    expect(sheetProblems(moved).join('\n')).toMatch(/F1 寫的位置或種類和版面不一樣/)
  })

  it('資料的 legend 可以把 F 改成別的種類（蓋過預設）；對到沒有的種類的整張圖不收', () => {
    const own = structuredClone(STREET)
    own.legend = { F: 'safe' }
    own.cells = own.cells!.map((m) => (m.mark === 'F' ? { ...m, mark: '$', id: m.id.replace('F', '$') } : m))
    expect(new Sheet(own).kindAt(2, 1)).toBe('safe')
    const unknown = structuredClone(STREET)
    unknown.legend = { F: 'no_such_kind' }
    expect(sheetProblems(unknown).join('\n')).toMatch(/圖例沒有的字元 "F"/)
  })

  it('站上設施：標記 F 的觸發點被叫到、畫面問這一格能做什麼拿得到那個標記', () => {
    const seen: string[] = []
    const shop: Feature = {
      id: 'shop',
      install(k) {
        k.grid.onMark('F', 'shop', (_ctx, marker) => { seen.push(marker.id) })
        k.grid.usesOf('shop', (_ctx, marker) => (marker.mark === 'F' ? [{ id: 'enter', name: `進去${marker.name}`, block: null }] : []))
      },
    }
    const { game } = makeGame({ content, features: [shop] })
    game.enterMap('map_street')
    expect(game.gridMove('east').status).toBe('applied')
    expect(game.gridMove('east').status).toBe('applied')
    expect(game.gridView()!.here).toMatchObject({ marker: { id: 'F1' }, uses: [{ id: 'enter', name: '進去雜貨店', block: null }] })
    expect(seen).toEqual(['F1'])
  })
})

describe('GridCtx 的 step 與 last', () => {
  interface Hit { where: string; x: number; step: number; last: boolean }
  /** 記下每一個掛點看到的 step、last；stopAt 是要在哪一格的進格掛點叫它停下來。 */
  const recorder = (hits: Hit[], o: { stopAt?: number } = {}): Feature => ({
    id: 'recorder',
    install(k) {
      const note = (where: string, ctx: GridCtx) => hits.push({ where, x: ctx.at.x, step: ctx.step, last: ctx.last })
      k.grid.onEnter('recorder', (ctx): GridEffect | void => {
        note('enter', ctx)
        if (o.stopAt === ctx.at.x) return { stop: true }
      })
      k.grid.onMark('F', 'recorder', (ctx, _m: MarkerDef) => { note('facility', ctx) })
    },
  })
  const walk = (features: Feature[]) => {
    const { game } = makeGame({ content, features })
    game.enterMap('map_street')
    return game
  }

  it('走一個目的地：路上每一格的 step 是 1、2、3……；只有計畫的最後一格 last 是 true', () => {
    const hits: Hit[] = []
    const game = walk([recorder(hits)])
    expect(game.gridMove([5, 1]).status).toBe('applied')
    const enters = hits.filter((h) => h.where === 'enter')
    expect(enters.map((h) => [h.x, h.step, h.last])).toEqual([[1, 1, false], [2, 2, false], [3, 3, false], [4, 4, false], [5, 5, true]])
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 1 })
  })

  it('路過設施不算到了：走過 F1、F2 去更遠的地方，設施的觸發點看到的 last 都是 false；停在設施上那一格才是 true', () => {
    const hits: Hit[] = []
    const game = walk([recorder(hits)])
    game.gridMove([5, 1])
    expect(hits.filter((h) => h.where === 'facility')).toEqual([{ where: 'facility', x: 2, step: 2, last: false }, { where: 'facility', x: 4, step: 4, last: false }])
    hits.length = 0
    // 退回 F2 再走到 F1：每一段路的 step 都重新從 1 數
    game.gridMove([4, 1])
    expect(hits.filter((h) => h.where === 'facility')).toEqual([{ where: 'facility', x: 4, step: 1, last: true }])
    hits.length = 0
    game.gridMove([2, 1])
    expect(hits.filter((h) => h.where === 'facility')).toEqual([{ where: 'facility', x: 2, step: 2, last: true }])
  })

  it('一個方向：step 是 1、last 一定是 true', () => {
    const hits: Hit[] = []
    const game = walk([recorder(hits)])
    game.gridMove('east')
    expect(hits).toEqual([{ where: 'enter', x: 1, step: 1, last: true }])
  })

  it('被停下來的那一格：step 照實記，沒走到終點所以 last 是 false；後面的格子不走、不叫掛點', () => {
    const hits: Hit[] = []
    const game = walk([recorder(hits, { stopAt: 3 })])
    expect(game.gridMove([8, 1]).status).toBe('applied')
    expect(game.state.maps.at).toMatchObject({ x: 3, y: 1 })
    expect(hits.filter((h) => h.where === 'enter').map((h) => [h.x, h.step, h.last])).toEqual([[1, 1, false], [2, 2, false], [3, 3, false]])
    // 停在設施上（F1 在 x = 2）時：沒走到終點，設施看到的 last 是 false（走的人要再下一次指令才算到）
    hits.length = 0
    const again = walk([recorder(hits, { stopAt: 2 })])
    again.gridMove([8, 1])
    expect(hits.filter((h) => h.where === 'facility')).toEqual([{ where: 'facility', x: 2, step: 2, last: false }])
  })

  it('不是在走路的時候（畫面問這一格能做什麼、問過不過得去）：step 是 0、last 是 true', () => {
    const seen: Array<{ where: string; step: number; last: boolean }> = []
    const probe: Feature = {
      id: 'probe',
      install(k) {
        k.grid.usesOf('probe', (ctx) => { seen.push({ where: 'uses', step: ctx.step, last: ctx.last }); return [] })
        k.grid.passRule('door_locked', 'probe', (ctx) => { seen.push({ where: 'pass', step: ctx.step, last: ctx.last }); return null })
      },
    }
    const locked: SpecialMapEntry = { ...CITY, id: 'map_locked', sheets: [{ ...STREET, layout: ['#########', 'E.F.%.1.2', '#########'], cells: STREET.cells!.filter((m) => m.id !== 'F2') }] }
    const { game } = makeGame({ content: [{ id: 'maps', content: { special_map: [locked] } }], features: [probe] })
    game.enterMap('map_locked')
    game.gridMove([3, 1])
    // 站在上鎖的門旁邊：畫面問四個方向過不過得去 → 問到門的規則
    seen.length = 0
    game.gridView()
    expect(seen.map((s) => s.where)).toContain('pass')
    for (const s of seen) expect(s, s.where).toMatchObject({ step: 0, last: true })
    // 站在設施上：畫面問這一格能做什麼 → 問到列事情的函式
    game.gridMove([2, 1])
    seen.length = 0
    game.gridView()
    expect(seen.map((s) => s.where)).toContain('uses')
    for (const s of seen) expect(s, s.where).toMatchObject({ step: 0, last: true })
    game.gridMove([3, 1])
    // 找路時問過不過得去（目的地在上鎖的門後面）也不是在走：step 是 0
    seen.length = 0
    game.gridMove([5, 1])
    expect(seen.filter((s) => s.where === 'pass').every((s) => s.step === 0 && s.last)).toBe(true)
  })
})
