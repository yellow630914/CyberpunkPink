// 核心的地圖引擎（L5 core/grid）：版面的模型、尋路與視野、實例、走一步與標記的觸發。
// 規格：DATA 9.3 節；COMMISSION_MAPS 第 1 節（圖例、座標、編號）；SITES 12.1、12.2 節；COMBAT_SYSTEM 第 10 節；CODESCAN 2.2 節；dev/adr/0012。

import { describe, expect, it } from 'vitest'
import type { Feature, SheetDef, SpecialMapEntry } from '../../src'
import { CELL_TRAITS, DEFAULT_LEGEND, Sheet, closeMap, createKernel, markersInLayout, openMap, sheetProblems, specialMapProblems } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame, observed, stateHash } from '../../src/testkit'

// DATA 9.3 節的樣本：小辦公室（map_office_small），原樣照抄
const OFFICE: SheetDef = {
  id: 'office', name: '二樓的辦公室', size: [9, 9],
  layout: ['####=E###', '#TOT#..S#', '#.2.%G1.#', '#DC.#oOo#', '######+##', '#T&.#.GS#', 'E...%.O.#', '#X..#C.K#', '######E##'],
  zones: ['####bb###', '#ccc#bbb#', '#ccccbbb#', '#ccc#bbb#', '######a##', '#ddd#aaa#', 'dddddaaa#', '#ddd#aaa#', '######a##'],
  zone_names: { a: '接待區', b: '開放座位', c: '主管室', d: '茶水間與後門' },
  cells: [
    { id: 'E1', at: [5, 0], mark: 'E', kind: 'window', name: '二樓的窗' },
    { id: 'E2', at: [0, 6], mark: 'E', kind: 'back', name: '後門（茶水間旁的防火門）' },
    { id: 'E3', at: [6, 8], mark: 'E', kind: 'front', name: '正門' },
    { id: 'T1', at: [1, 1], mark: 'T', name: '牆上的保險櫃' }, { id: 'T2', at: [3, 1], mark: 'T', name: '主管室的辦公桌' }, { id: 'T3', at: [1, 5], mark: 'T', name: '茶水間後面的檔案間' },
    { id: 'D1', at: [1, 3], mark: 'D', name: '主管室的終端下方的網路孔' }, { id: '&1', at: [2, 5], mark: '&', name: '檔案間（人質放在這裡）' },
    { id: 'K1', at: [7, 7], mark: 'K', name: '接待區的員工外套掛架' }, { id: 'G1', at: [5, 2], mark: 'G', name: '主管室門口' }, { id: 'G2', at: [6, 5], mark: 'G', name: '接待櫃檯' },
    { id: 'X1', at: [1, 7], mark: 'X', name: '後門' }, { id: 'S1', at: [7, 1], mark: 'S', name: '開放座位的監視器' }, { id: 'S2', at: [7, 5], mark: 'S', name: '接待區的監視器' },
    { id: 'C1', at: [2, 3], mark: 'C', name: '後半的控制面板' }, { id: 'C2', at: [5, 7], mark: 'C', name: '前半的控制面板' },
  ],
  spots: [{ id: '!1', at: [6, 2], cover: 'dense' }, { id: '!2', at: [2, 2], cover: 'one_sided' }],
  controls: [{ id: 'C1', at: [2, 3], zones: ['c', 'd'], node: 'cn_back_half', devices: ['light', 'safe_lock'] }, { id: 'C2', at: [5, 7], zones: ['a', 'b'], node: 'cn_front_half', devices: ['door', 'camera'] }],
  patrols: [{ guard: 'G2', route: ['a', 'b', 'a', 'd'] }],
}
const MAP: SpecialMapEntry = { id: 'map_office_small', kind: 'office_small', size: [9, 9], max_maps: 1, sheets: [OFFICE] }

// 串兩張的小圖：一樓有樓梯接到二樓
const TWO: SpecialMapEntry = {
  id: 'map_two', kind: 'test', size: [5, 3],
  sheets: [
    { id: 'f1', name: '一樓', size: [5, 3], layout: ['#####', 'E12.<', '#####'], cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '門' }], spots: [{ id: '!1', at: [1, 1], cover: 'medium' }, { id: '!2', at: [2, 1], cover: 'sparse' }], links: [{ at: [[4, 1]], to: 'f2' }] },
    { id: 'f2', name: '二樓', size: [5, 3], layout: ['#####', '>.%1G', '#2###'], cells: [{ id: 'G1', at: [4, 1], mark: 'G', name: '崗哨' }], spots: [{ id: '!1', at: [3, 1], cover: 'dense' }, { id: '!2', at: [1, 2], cover: 'dense' }], links: [{ at: [[0, 1]], to: 'f1' }] },
  ],
}

describe('版面的模型（DATA 9.3 節；COMMISSION_MAPS 第 1 節）', () => {
  it('預設的圖例：每個字元對到一種格子；標記站的那一格可以走；牆、擺設、窗、水不能走', () => {
    expect(Object.keys(DEFAULT_LEGEND).sort().join('')).toBe([...'#.,~+%=^<>HOo*$&ETDCGSKXF123456789'].sort().join(''))
    for (const kind of Object.values(DEFAULT_LEGEND)) expect(CELL_TRAITS[kind], kind).toBeDefined()
    const s = new Sheet(OFFICE)
    expect([s.w, s.h]).toEqual([9, 9])
    expect(s.kindAt(0, 0)).toBe('wall')
    expect(s.kindAt(5, 0)).toBe('entry')
    expect(s.walkable(5, 0)).toBe(true)
    expect(s.walkable(4, 0)).toBe(false) // 窗
    expect(s.walkable(2, 1)).toBe(false) // 掩體的擺設擋路
    expect(s.walkable(4, 2)).toBe(false) // 上鎖的門
    expect(s.traitsAt(4, 2).locked).toBe(true)
    expect(s.kindAt(99, 99)).toBe('wall')
    expect(s.zoneAt(1, 1)).toBe('c')
    expect(s.zoneAt(0, 0)).toBeUndefined()
    expect(s.markerAt(7, 7)).toMatchObject({ id: 'K1', name: '接待區的員工外套掛架' })
    expect(s.spotAt(6, 2)).toMatchObject({ id: '!1', cover: 'dense' })
  })

  it('標記照「由上到下、由左到右」編號；遭遇點是模板的編號', () => {
    const ids = markersInLayout(OFFICE).map((m) => m.id)
    expect(ids).toEqual(['E1', 'T1', 'T2', 'S1', '!2', 'G1', '!1', 'D1', 'C1', 'T3', '&1', 'G2', 'S2', 'E2', 'X1', 'C2', 'K1', 'E3'])
  })

  it('格式檢查：樣本合格；列的長度、沒見過的字元、標記對不上、走不到的格子、遭遇點不到兩個都擋下', () => {
    expect(sheetProblems(OFFICE)).toEqual([])
    expect(specialMapProblems(MAP as unknown as Record<string, unknown>)).toEqual([])
    expect(specialMapProblems(TWO as unknown as Record<string, unknown>)).toEqual([])
    const bad = (edit: (s: SheetDef) => void) => { const s = structuredClone(OFFICE); edit(s); return sheetProblems(s).join('\n') }
    expect(bad((s) => { s.layout[0] = '####=E##' })).toMatch(/第 0 列的長度要是 9/)
    expect(bad((s) => { s.layout[1] = '#TOT#..S?' })).toMatch(/圖例沒有的字元/)
    expect(bad((s) => { s.cells = s.cells!.filter((m) => m.id !== 'K1') })).toMatch(/K1（7,7）沒有列在 cells 裡/)
    expect(bad((s) => { s.cells!.find((m) => m.id === 'K1')!.at = [6, 7] })).toMatch(/K1 寫的位置或種類和版面不一樣/)
    expect(bad((s) => { s.spots = [s.spots![0]!] })).toMatch(/!2.*沒有列在 spots 裡/)
    // 把憑證點（7,7）四面封起來：從哪個入口都走不到
    expect(bad((s) => { s.layout[6] = 'E...%.O##'; s.layout[7] = '#X..#C#K#' })).toMatch(/7,7（credential）從入口走不到/)
    expect(bad((s) => { s.zones = s.zones!.slice(1) })).toMatch(/zones 要和 layout 一樣大/)
    expect(specialMapProblems({ id: 'x', kind: 'k', sheets: [] })).toEqual(['sheets 要有至少一張圖'])
    const k = createKernel()
    expect(() => k.content.load('special_map', [MAP, TWO])).not.toThrow()
    expect(() => k.content.load('special_map', [{ ...MAP, id: 'map_bad', sheets: [{ ...OFFICE, layout: OFFICE.layout.slice(1) }] }])).toThrow(/layout 要有 9 列/)
  })

  it('尋路與視野：四方向的最短路；牆與門擋視線，擋住的那一格本身看得到', () => {
    const s = new Sheet(OFFICE)
    const path = s.findPath({ x: 6, y: 8 }, { x: 7, y: 7 })!
    expect(path[0]).toEqual({ x: 6, y: 8 })
    expect(path.at(-1)).toEqual({ x: 7, y: 7 })
    expect(path).toHaveLength(3)
    // 主管室在上鎖的門（4,2）後面：從二樓的窗進來，門沒開就走不到；門放行了才走得到
    expect(s.findPath({ x: 5, y: 0 }, { x: 1, y: 1 })).toBeNull()
    expect(s.findPath({ x: 5, y: 0 }, { x: 1, y: 1 }, (x, y) => s.walkable(x, y) || !!s.traitsAt(x, y).locked)).toHaveLength(8)
    const seen = s.visibleFrom({ x: 6, y: 7 }, 5)
    expect(seen.has('7,7')).toBe(true)
    expect(seen.has('6,4')).toBe(true) // 通往開放座位的門：看得到門，看不到門後
    expect(seen.has('6,2')).toBe(false)
    expect(new Sheet(OFFICE, { '4,2': { kind: 'door' } }).walkable(4, 2)).toBe(true)
  })
})

describe('實例、走一步與標記的觸發（Game 的門面）', () => {
  const content = [{ id: 'maps', content: { special_map: [MAP, TWO] } }]

  it('開一份實例並站進去：預設站在第一個入口；看得到的格子記下來；同一個定義可以開好幾份；結束時清掉', () => {
    const { game } = makeGame({ content })
    const id = game.enterMap('map_office_small', { owner: 'cm_test', at: 'E3' })
    expect(id).toBe('m1')
    expect(game.state.maps.at).toEqual({ map: 'm1', sheet: 'office', x: 6, y: 8 })
    expect(game.state.maps.instances.m1).toMatchObject({ def: 'map_office_small', owner: 'cm_test' })
    const v = game.gridView()!
    expect(v).toMatchObject({ map: 'm1', sheet: 'office', name: '二樓的辦公室', at: [6, 8], here: { marker: { id: 'E3' }, zone: 'a' } })
    expect(v.cells[7]![6]).toBe('floor')
    expect(v.cells[1]![1]).toBeNull() // 主管室還沒看過
    expect(v.moves).toEqual({ east: '那邊走不過去。', west: '那邊走不過去。', south: '那邊沒有路。', north: null })
    const second = openMap(game.k, game.state, 'map_office_small')
    expect(second.id).toBe('m2')
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: second.changes, outcome: { result: 'ok', summary: '開第二份' } })
    expect(Object.keys(game.state.maps.instances)).toEqual(['m1', 'm2'])
    expect(game.state.maps.at!.map).toBe('m2')
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 0 })
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: closeMap(game.state, 'm2'), outcome: { result: 'ok', summary: '清掉' } })
    expect(game.state.maps.at).toBeNull()
    expect(Object.keys(game.state.maps.instances)).toEqual(['m1'])
    expect(() => game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: [{ op: 'map.at', to: { map: 'm9', sheet: 'x', x: 0, y: 0 } }], outcome: { result: 'ok', summary: '' } })).toThrow(/沒有 m9 這份地圖/)
    expect(() => openMap(game.k, game.state, 'map_nope')).toThrow(/沒有 map_nope 這張地圖/)
    expect(game.gridView()).toBeNull()
  })

  it('走一步：位置與看過的格子只經由提交改變；走不過去被擋下、附原因，狀態不變；上鎖的門要有功能放行', async () => {
    const unlock: Feature = { id: 'unlock', install: (k) => k.grid.passRule('door_locked', 'unlock', (ctx) => (ctx.state.flags.has_key ? null : '這扇門要員工憑證。')) }
    const { game } = makeGame({ content, features: [unlock] })
    game.enterMap('map_office_small', { at: 'E3' })
    const before = stateHash(game.state)
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '那邊走不過去。' })
    expect(stateHash(game.state)).toBe(before)
    const { result, violations } = await observed(game, () => game.gridMove('north'))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    expect(result.reports[0]).toMatchObject({ kind: 'action', action: 'grid.move', outcome: { result: 'moved' } })
    expect(game.state.maps.at).toMatchObject({ x: 6, y: 7 })
    // 走到目的地：照最短路
    expect(game.gridMove([5, 5]).status).toBe('applied')
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 5 })
    expect(game.gridMove([5, 6]).status).toBe('applied')
    expect(game.gridMove('west')).toMatchObject({ status: 'refused', reason: '這扇門要員工憑證。' })
    expect(game.gridMove([1, 7])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'has_key', value: true }], outcome: { result: 'ok', summary: '拿到憑證' } })
    expect(game.gridMove([1, 7]).status).toBe('applied')
    expect(game.gridView()!.here.marker).toMatchObject({ id: 'X1' })
    // 存檔再讀檔，位置與看過的格子都在
    const seen = game.state.maps.instances.m1!.sheets.office!.seen.join('')
    expect(game.load(game.save())).toBeNull()
    expect(game.state.maps.instances.m1!.sheets.office!.seen.join('')).toBe(seen)
    expect(seen).toMatch(/1/)
  })

  it('走到敵人那一格就開打（功能註冊的觸發）：這一步提交之後接著開戰；遮蔽照遭遇點的配置；戰鬥中不能走', () => {
    const guards: Feature = {
      id: 'guards',
      install: (k) => {
        k.grid.onMark('G', 'guards', (ctx, m) => ({ line: `撞上了${m.name}的保全。`, battle: { ...BATTLE_SETUPS.encounter(), cover: ctx.sheet.def.spots![0]!.cover, origin: { escapable: false, place: m.name, ext: { marker: m.id } } } }))
        k.grid.usesOf('guards', (_ctx, m) => (m.mark === 'G' ? [{ id: 'look', name: '看一眼', block: null }] : []))
      },
    }
    const { game } = makeGame({ content, features: [TEST_COMBAT, guards] })
    game.enterMap('map_two')
    // 一路走到樓梯：換到二樓，站在二樓接回一樓的那一格，這一段路到這裡為止
    const up = game.gridMove([4, 1])
    expect(up.status).toBe('applied')
    expect(game.state.maps.at).toEqual({ map: 'm1', sheet: 'f2', x: 0, y: 1 })
    expect(up.reports[0]!.outcome.summary).toMatch(/到了二樓/)
    expect(game.gridMove('east').status).toBe('applied')
    // 門鎖著、沒有人放行
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '門鎖著。' })
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: [{ op: 'map.sheet', map: 'm1', sheet: 'f2', cells: { '2,1': { kind: 'door' } } }], outcome: { result: 'ok', summary: '門開了' } })
    const fight = game.gridMove([4, 1])
    expect(fight.status).toBe('applied')
    expect(fight.reports.map((r) => r.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.state.maps.at).toMatchObject({ sheet: 'f2', x: 4, y: 1 })
    expect(game.battle).toMatchObject({ origin: { escapable: false, place: '崗哨', ext: { marker: 'G1' } } })
    expect(game.battle!.cover.foe.map((c) => c.level)).toEqual([1, 1, 2, 2]) // dense
    expect(game.gridMove('west')).toMatchObject({ status: 'refused', reason: '正在戰鬥，先把這一場打完。' })
  })
})
