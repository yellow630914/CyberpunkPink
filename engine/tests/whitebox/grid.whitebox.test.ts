// 白箱測試：core/grid（地圖的模型、尋路與視野、開實例、走一步與標記的觸發）。
// 補主套件沒有走到的分支：格式檢查的每一條錯誤、尋路與視野的邊界、開實例的錯誤、走一段路時各種停下來的原因。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { Feature, GridEffect, SheetDef, SpecialMapEntry } from '../../src'
import { CELL_TRAITS, DEFAULT_LEGEND, GridBlocked, SIGHT, Sheet, closeMap, createKernel, gridHere, gridView, gridWalk, mapDef, markersInLayout, openMap, sheetProblems, specialMapProblems } from '../../src'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame, makeState, observed, stateHash } from '../../src/testkit'

/** 最小的合格圖：寬 7、高 3，一個入口、兩個遭遇點、一扇上鎖的門。 */
const SHEET = (o: Partial<SheetDef> = {}): SheetDef => ({
  id: 's1', name: '測試的一層', size: [7, 3],
  layout: ['#######', 'E.1%.2#', '#######'],
  cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '入口' }],
  spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [5, 1], cover: 'dense' }],
  ...o,
})
const MAP = (sheets: SheetDef[] = [SHEET()], o: Partial<SpecialMapEntry> = {}): SpecialMapEntry => ({ id: 'map_t', kind: 'test', size: [7, 3], sheets, ...o })
const content = (...maps: SpecialMapEntry[]) => [{ id: 'maps', content: { special_map: maps } }]
const commit = (game: ReturnType<typeof makeGame>['game'], changes: Parameters<typeof game.commit>[0]['changes']) =>
  game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: 't' } })

describe('白箱 Sheet 的模型（DATA 9.3 節；COMMISSION_MAPS 1.1 節）', () => {
  it('圖例：資料可以自己加字元；沒見過的字元是牆；對到沒註冊的種類時性質照牆（不丟錯）', () => {
    const s = new Sheet(SHEET({ layout: ['#######', 'E.w~?.#', '#######'], legend: { w: 'water', '?': 'lava' as never } }))
    expect(s.kindAt(2, 1)).toBe('water')
    expect(s.kindAt(4, 1)).toBe('lava')
    expect(s.walkable(2, 1)).toBe(false)
    expect(s.walkable(4, 1)).toBe(false)
    expect(s.traitsAt(4, 1)).toEqual(CELL_TRAITS.wall)
    expect(new Sheet(SHEET({ layout: ['#######', 'E.Q...#', '#######'] })).kindAt(2, 1)).toBe('wall')
  })

  it('實例改過的格子（門開了）蓋在版面上；超出版面的座標一律是牆、不能走、看不到', () => {
    const s = new Sheet(SHEET(), { '3,1': { kind: 'door' } })
    expect(s.kindAt(3, 1)).toBe('door')
    expect(s.walkable(3, 1)).toBe(true)
    for (const [x, y] of [[-1, 0], [0, -1], [7, 1], [1, 3]] as const) {
      expect(s.inBounds(x, y)).toBe(false)
      expect(s.kindAt(x, y)).toBe('wall')
      expect(s.walkable(x, y)).toBe(false)
    }
  })

  it('zoneAt：只認小寫字母（大寫、#、空白都不是區塊）；沒有 zones 回 undefined', () => {
    const s = new Sheet(SHEET({ zones: ['#######', 'a B#..c', '#######'] }))
    expect(s.zoneAt(0, 1)).toBe('a')
    expect(s.zoneAt(2, 1)).toBeUndefined()
    expect(s.zoneAt(1, 1)).toBeUndefined()
    expect(s.zoneAt(6, 1)).toBe('c')
    expect(new Sheet(SHEET()).zoneAt(0, 1)).toBeUndefined()
  })

  it('marker、markerAt、spotAt、linkAt：查得到、查不到回 undefined', () => {
    const s = new Sheet(SHEET({ links: [{ at: [[1, 1], [4, 1]], to: 's2' }] }))
    expect(s.marker('E1')).toMatchObject({ name: '入口' })
    expect(s.marker('nope')).toBeUndefined()
    expect(s.markerAt(0, 1)).toBeDefined()
    expect(s.markerAt(1, 1)).toBeUndefined()
    expect(s.spotAt(2, 1)).toMatchObject({ id: '!1' })
    expect(s.spotAt(3, 1)).toBeUndefined()
    expect(s.linkAt(4, 1)).toMatchObject({ to: 's2' })
    expect(s.linkAt(5, 1)).toBeUndefined()
    const bare = new Sheet({ id: 'b', name: 'b', size: [2, 1], layout: ['.E'] })
    expect(bare.marker('E1')).toBeUndefined()
    expect(bare.spotAt(0, 0)).toBeUndefined()
    expect(bare.linkAt(0, 0)).toBeUndefined()
  })

  it('findPath：起點就是終點回傳只有起點；終點在版面外或走不上去回 null；走不到回 null；沿途的牆繞過去', () => {
    const s = new Sheet(SHEET({ layout: ['#######', 'E.#...#', '#######'] }))
    expect(s.findPath({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }])
    expect(s.findPath({ x: 1, y: 1 }, { x: 9, y: 1 })).toBeNull()
    expect(s.findPath({ x: 1, y: 1 }, { x: 2, y: 1 })).toBeNull()
    expect(s.findPath({ x: 1, y: 1 }, { x: 4, y: 1 })).toBeNull()
    const open = new Sheet(SHEET({ layout: ['.....', '.###.', '.....'], size: [5, 3] }))
    expect(open.findPath({ x: 0, y: 0 }, { x: 4, y: 2 })).toHaveLength(7)
    expect(open.findPath({ x: 0, y: 1 }, { x: 4, y: 1 })).toHaveLength(7)
  })

  it('reachable：預設走得上去的格子；pass 可以放行上鎖的門', () => {
    const s = new Sheet(SHEET())
    expect([...s.reachable({ x: 0, y: 1 })].sort()).toEqual(['0,1', '1,1', '2,1'])
    const all = s.reachable({ x: 0, y: 1 }, (x, y) => s.walkable(x, y) || !!s.traitsAt(x, y).locked)
    expect(all.size).toBe(6)
  })

  it('visibleFrom：半徑內、沿著看得穿的格子連得到；整張沒燈只剩腳下與相鄰（SITES 第 11 節）', () => {
    const s = new Sheet(SHEET({ layout: ['#######', 'E.....#', '#######'] }))
    const lit = s.visibleFrom({ x: 0, y: 1 }, SIGHT.lit)
    expect(lit.has('5,1')).toBe(true)
    expect(lit.has('6,1')).toBe(false) // 半徑 5
    const dark = s.visibleFrom({ x: 0, y: 1 }, SIGHT.dark)
    expect([...dark].sort()).toEqual(['0,0', '0,1', '0,2', '1,1'].sort())
    expect(SIGHT).toEqual({ lit: 5, dark: 1 })
  })

  it('markersInLayout：遭遇點的 id 是 !<字元>，其他標記照出現順序數；沒有標記的版面是空的', () => {
    expect(markersInLayout(SHEET()).map((m) => m.id)).toEqual(['E1', '!1', '!2'])
    expect(markersInLayout({ id: 'x', name: 'x', size: [2, 1], layout: ['..'] })).toEqual([])
    expect(markersInLayout({ id: 'x', name: 'x', size: [4, 1], layout: ['EE.T'] }).map((m) => m.id)).toEqual(['E1', 'E2', 'T1'])
  })

  it('預設圖例的每個字元都有性質；標記站的那一格走得上去', () => {
    for (const ch of Object.keys(DEFAULT_LEGEND)) expect(CELL_TRAITS[DEFAULT_LEGEND[ch]!], ch).toBeDefined()
    for (const [kind, t] of Object.entries(CELL_TRAITS)) if (t.mark) expect(t.walk, kind).toBe(true)
  })
})

describe('白箱 sheetProblems 的每一條錯誤（DATA 9.3 節的資料檢查；不變式第 55 條）', () => {
  const bad = (edit: (s: SheetDef) => void, siblings: string[] = []): string => {
    const s = structuredClone(SHEET())
    edit(s)
    return sheetProblems(s, siblings).join('\n')
  }

  it('合格的樣本沒有問題', () => {
    expect(sheetProblems(SHEET())).toEqual([])
  })

  it('沒有 id、不是物件：回「每一張圖要有 id」就停', () => {
    expect(sheetProblems(undefined as never)).toEqual(['每一張圖要有 id'])
    expect(sheetProblems({ ...SHEET(), id: '' })).toEqual(['每一張圖要有 id'])
    expect(sheetProblems({ ...SHEET(), id: 5 as never })).toEqual(['每一張圖要有 id'])
  })

  it.each([
    ['name 是空白', (s: SheetDef) => { s.name = '  ' }, /要有 name/],
    ['size 不是兩個正整數', (s: SheetDef) => { s.size = [7, 0] }, /size 要是 \[寬, 高\]/],
    ['size 缺一個', (s: SheetDef) => { s.size = [7] as never }, /size 要是 \[寬, 高\]/],
    ['size 不是整數', (s: SheetDef) => { s.size = [7.5, 3] }, /size 要是 \[寬, 高\]/],
    ['layout 列數不對', (s: SheetDef) => { s.layout = ['#######'] }, /layout 要有 3 列（拿到 1）/],
    ['layout 不是陣列', (s: SheetDef) => { s.layout = '#######' as never }, /layout 要有 3 列（拿到 不是陣列）/],
    ['layout 某一列不是字串', (s: SheetDef) => { s.layout[0] = 7 as never }, /layout 第 0 列的長度要是 7/],
    ['layout 某一列長度不對', (s: SheetDef) => { s.layout[2] = '######' }, /layout 第 2 列的長度要是 7/],
    ['layout 有圖例沒有的字元', (s: SheetDef) => { s.layout[0] = '###Z###' }, /圖例沒有的字元 "Z"/],
    ['zones 大小不對', (s: SheetDef) => { s.zones = ['#######'] }, /zones 要和 layout 一樣大/],
    ['zones 某一列不是字串', (s: SheetDef) => { s.zones = ['#######', 5 as never, '#######'] }, /zones 要和 layout 一樣大/],
  ])('%s', (_name, edit, re) => {
    expect(bad(edit)).toMatch(re)
  })

  it('標記：版面有而資料沒列、資料有而版面沒有、位置或種類不一樣；cells 沒有 name', () => {
    expect(bad((s) => { s.cells = [] })).toMatch(/E1（0,1）沒有列在 cells 裡/)
    expect(bad((s) => { s.cells!.push({ id: 'T1', at: [3, 1], mark: 'T', name: '多出來的' }) })).toMatch(/T1 列在資料裡，版面上卻沒有/)
    expect(bad((s) => { s.cells![0]!.mark = 'T' })).toMatch(/E1 寫的位置或種類和版面不一樣/)
    expect(bad((s) => { s.cells![0]!.name = ' ' })).toMatch(/E1 要有 name/)
    expect(bad((s) => { s.spots![0]!.at = [3, 1] })).toMatch(/!1 寫的位置或種類和版面不一樣/)
  })

  it('遭遇點不到兩個、links 接到不存在的圖、連接格走不上去、沒有入口也沒有連接格', () => {
    expect(bad((s) => { s.spots = [s.spots![0]!]; s.layout[1] = 'E.1%..#' })).toMatch(/至少要有 2 個遭遇點/)
    expect(bad((s) => { s.links = [{ at: [[1, 1]], to: 'nope' }] }, ['s1'])).toMatch(/links 接到不存在的圖 nope/)
    expect(bad((s) => { s.links = [{ at: [[0, 0]], to: 's1' }] }, ['s1'])).toMatch(/連接格 0,0 走不上去/)
    expect(bad((s) => { s.cells = []; s.layout[1] = '..1%.2#' })).toMatch(/沒有入口也沒有連接格，走不進來/)
    // 有連接格就算有入口
    expect(bad((s) => { s.cells = []; s.layout[1] = '..1%.2#'; s.links = [{ at: [[0, 1]], to: 's1' }] }, ['s1'])).toBe('')
  })

  it('走不到的地板：被牆圍起來的格子寫出座標與種類；上鎖的門當成過得去', () => {
    expect(bad((s) => { s.layout[1] = 'E.1#.2#'; s.spots = [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [5, 1], cover: 'dense' }] })).toMatch(/5,1（spot）從入口走不到/)
    expect(bad(() => {})).toBe('')
  })

  it('specialMapProblems：沒有 kind、sheets 不是陣列、id 重複、每一張的問題都收進來', () => {
    expect(specialMapProblems({ kind: '', sheets: [SHEET()] })).toContain('要有 kind（模板的種類）')
    expect(specialMapProblems({ kind: 'k', sheets: 'x' })).toEqual(['sheets 要有至少一張圖'])
    expect(specialMapProblems({ kind: 'k', sheets: [SHEET(), SHEET()] })).toContain('sheets 的 id 不能重複')
    expect(specialMapProblems({ kind: 'k', sheets: [SHEET({ name: '' })] }).join()).toMatch(/要有 name/)
    expect(specialMapProblems({ kind: 'k', sheets: [SHEET({ links: [{ at: [[1, 1]], to: 'zz' }] })] }).join()).toMatch(/links 接到不存在的圖 zz/)
  })

  it('special_map 內容種類：格式錯誤整批不收（不變式第 11 條）', () => {
    const k = createKernel()
    expect(() => k.content.load('special_map', [MAP([SHEET({ layout: ['#'] })])])).toThrow(/layout 要有 3 列/)
    expect(k.content.list('special_map')).toEqual([])
    k.content.load('special_map', [MAP()])
    expect(mapDef(k, 'map_t').id).toBe('map_t')
    expect(() => mapDef(k, 'nope')).toThrow(/沒有 nope 這張地圖/)
  })
})

describe('白箱 openMap 與 closeMap（dev/adr/0012；不變式第 55 條）', () => {
  const k = () => {
    const kernel = createKernel()
    kernel.content.load('special_map', [MAP([SHEET(), SHEET({ id: 's2', name: '二層', layout: ['#######', '>.1.2.#', '#######'], cells: [], spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [4, 1], cover: 'sparse' }], links: [{ at: [[0, 1]], to: 's1' }] })])])
    return kernel
  }

  it('預設站在第一張圖的第一個入口；owner 與 ext 記下來；看得到的格子記下來', () => {
    const kernel = k()
    const state = makeState()
    const { id, changes } = openMap(kernel, state, 'map_t', { owner: 'cm_1', ext: { quest: 'q1' } })
    expect(id).toBe('m1')
    expect(changes[0]).toMatchObject({ op: 'map.open', instance: { id: 'm1', def: 'map_t', owner: 'cm_1', ext: { quest: 'q1' } } })
    expect(changes[2]).toEqual({ op: 'map.at', to: { map: 'm1', sheet: 's1', x: 0, y: 1 } })
    expect(changes[1]).toMatchObject({ op: 'map.sheet', sheet: 's1' })
    expect((changes[1] as unknown as { seen: string[] }).seen[1]!.startsWith('1111')).toBe(true)
  })

  it('指定標記的 id、座標、哪一張圖：站到那裡；標記不存在或站不上去丟錯', () => {
    const kernel = k()
    const state = makeState()
    expect(openMap(kernel, state, 'map_t', { at: 'E1' }).changes[2]).toMatchObject({ to: { x: 0, y: 1 } })
    expect(openMap(kernel, state, 'map_t', { at: [4, 1] }).changes[2]).toMatchObject({ to: { x: 4, y: 1 } })
    expect(openMap(kernel, state, 'map_t', { sheet: 's2' }).changes[2]).toMatchObject({ to: { sheet: 's2', x: 0, y: 1 } })
    expect(() => openMap(kernel, state, 'map_t', { at: 'Z9' })).toThrow(/s1 沒有 Z9 這個標記/)
    expect(() => openMap(kernel, state, 'map_t', { at: [0, 0] })).toThrow(/站不上去/)
    expect(() => openMap(kernel, state, 'map_t', { sheet: 'zz' })).toThrow(/地圖 map_t 沒有 zz 這一張圖/)
  })

  it('沒有入口標記：改站在第一個連接格；也沒有連接格就站不上去（-1,-1）丟錯', () => {
    const kernel = createKernel()
    kernel.content.load('special_map', [{ id: 'map_nolink', kind: 'k', size: [7, 3], sheets: [SHEET({ cells: [], layout: ['#######', '..1%.2#', '#######'], links: [{ at: [[0, 1]], to: 's1' }] })] }])
    expect(openMap(kernel, makeState(), 'map_nolink').changes[2]).toMatchObject({ to: { x: 0, y: 1 } })
    const noEntry = createKernel()
    noEntry.content.load('special_map', [{ id: 'map_nolink', kind: 'k', size: [7, 3], sheets: [SHEET({ cells: [], layout: ['#######', '..1%.2#', '#######'], links: [{ at: [[0, 1]], to: 's1' }] })] }])
    const state = makeState()
    ;(noEntry.content.get('special_map', 'map_nolink') as unknown as { sheets: SheetDef[] }).sheets[0]!.links = []
    expect(() => openMap(noEntry, state, 'map_nolink')).toThrow(/-1,-1 站不上去/)
  })

  it('closeMap：人還站在裡面時先離開格子地圖；站在別張圖的實例時只清掉它', () => {
    const state = makeState()
    state.maps.at = { map: 'm1', sheet: 's1', x: 0, y: 0 }
    expect(closeMap(state, 'm1')).toEqual([{ op: 'map.at', to: null }, { op: 'map.close', id: 'm1' }])
    expect(closeMap(state, 'm2')).toEqual([{ op: 'map.close', id: 'm2' }])
    state.maps.at = null
    expect(closeMap(state, 'm1')).toEqual([{ op: 'map.close', id: 'm1' }])
  })

  it('gridHere：不在地圖上是 null；指到不存在的實例也是 null；實例的圖沒有狀態時用空的', () => {
    const { game } = makeGame({ content: content(MAP()) })
    expect(gridHere(game.k, game.state)).toBeNull()
    expect(gridView(game.k, game.state)).toBeNull()
    game.enterMap('map_t')
    expect(gridHere(game.k, game.state)).toMatchObject({ at: { sheet: 's1' }, instance: { id: 'm1' } })
    const s = structuredClone(game.state)
    s.maps.at = { map: 'm9', sheet: 's1', x: 0, y: 1 }
    expect(gridHere(game.k, s)).toBeNull()
    delete s.maps.instances.m1!.sheets.s1
    s.maps.at = { map: 'm1', sheet: 's1', x: 0, y: 1 }
    expect(gridHere(game.k, s)!.sheetState).toEqual({ seen: [], cells: {}, movers: {} })
  })
})

describe('白箱 gridView（UI 1.1；COMMISSION_MAPS 1）', () => {
  it('看過的格子給種類、沒看過的是 null；整張沒燈只看得到相鄰', () => {
    const { game } = makeGame({ content: content(MAP([SHEET({ dark: true, layout: ['#######', 'E.1%.2#', '#######'] })])) })
    game.enterMap('map_t')
    const v = game.gridView()!
    expect(v.cells[1]!.slice(0, 4)).toEqual(['entry', 'floor', null, null])
    expect(v.size).toEqual([7, 3])
    expect(v.here.marker).toMatchObject({ id: 'E1' })
  })

  it('四個方向：走得過去 null、牆「那邊走不過去」、版面外「那邊沒有路」、上鎖的門 — 沒人註冊是「門鎖著。」，有人註冊取第一個原因，有一個放行就過', () => {
    const lockOnly: Feature = { id: 'l', install: (k) => { k.grid.passRule('door_locked', 'l', () => '要憑證。') } }
    const both: Feature = { id: 'b', install: (k) => { k.grid.passRule('door_locked', 'b1', () => null); k.grid.passRule('door_locked', 'b2', () => '要憑證。') } }
    const emptyReason: Feature = { id: 'e', install: (k) => { k.grid.passRule('door_locked', 'e', () => '') } }
    const at = (features: Feature[]) => {
      const { game } = makeGame({ content: content(MAP()), features })
      game.enterMap('map_t', { at: [2, 1] })
      return game.gridView()!.moves
    }
    expect(at([])).toEqual({ east: '門鎖著。', west: null, south: '那邊走不過去。', north: '那邊走不過去。' })
    expect(at([lockOnly]).east).toBe('要憑證。')
    expect(at([both]).east).toBeNull()
    expect(at([emptyReason]).east).toBe('門鎖著。')
    const { game } = makeGame({ content: content(MAP()) })
    game.enterMap('map_t')
    expect(game.gridView()!.moves.west).toBe('那邊沒有路。')
  })

  it('站在標記上：列出那一格能做的事（登錄表的 uses）；沒有標記就是空的', () => {
    const f: Feature = { id: 'u', install: (k) => k.grid.usesOf('u', (_c, m) => (m.mark === 'E' ? [{ id: 'leave', name: '離開', block: null }] : [])) }
    const { game } = makeGame({ content: content(MAP()), features: [f] })
    game.enterMap('map_t')
    expect(game.gridView()!.here.uses).toEqual([{ id: 'leave', name: '離開', block: null }])
    game.gridMove('east')
    expect(game.gridView()!.here).toEqual({ marker: null, uses: [] })
  })
})

describe('白箱 gridWalk：走一段路（COMBAT_SYSTEM 10；SITES 12.5；不變式第 3、56 條）', () => {
  const game = (features: Feature[] = [], maps: SpecialMapEntry[] = [MAP()]) => {
    const g = makeGame({ content: content(...maps), features: [TEST_COMBAT, ...features] }).game
    return g
  }

  it('不在地圖上、在戰鬥中：GridBlocked 寫出原因', () => {
    const g = game()
    expect(() => gridWalk(g.k, g.state, 'east')).toThrow(GridBlocked)
    expect(() => gridWalk(g.k, g.state, 'east')).toThrow(/現在不在格子地圖上/)
    expect(g.gridMove('east')).toMatchObject({ status: 'refused', reason: '現在不在格子地圖上。' })
    g.enterMap('map_t')
    g.startBattle(BATTLE_SETUPS.encounter())
    expect(g.gridMove('east')).toMatchObject({ status: 'refused', reason: '正在戰鬥，先把這一場打完。' })
    expect(() => g.enterMap('map_t')).toThrow(/正在戰鬥/)
  })

  it('走到目的地：照最短路；走到原地也算（0 格）；目的地是牆、版面外：走不到那裡', () => {
    const g = game()
    g.enterMap('map_t')
    const here = stateHash(g.state)
    expect(g.gridMove([9, 9])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    expect(g.gridMove([0, 0])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    expect(stateHash(g.state)).toBe(here)
    const r = g.gridMove([0, 1])
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.outcome.summary).toBe('走了 0 格。')
  })

  it('每走進一格都呼叫進格的掛點：stop 讓這一段路到這一格為止；line 接在摘要後面；changes 併進這一步', () => {
    const f: Feature = {
      id: 'trap',
      install: (k) => k.grid.onEnter('trap', (ctx): GridEffect | void => {
        if (ctx.at.x === 1) return { line: '踩到絆線。', stop: true, changes: [{ op: 'flag', key: 'tripped', value: true }] }
      }),
    }
    const g = game([f])
    g.enterMap('map_t')
    const r = g.gridMove([2, 1])
    expect(g.state.maps.at).toMatchObject({ x: 1, y: 1 })
    expect(g.state.flags.tripped).toBe(true)
    expect(r.reports[0]!.outcome.summary).toBe('走了 1 格。踩到絆線。')
    const none: Feature = { id: 'quiet', install: (k) => k.grid.onEnter('quiet', () => undefined) }
    const g2 = game([none])
    g2.enterMap('map_t')
    g2.gridMove([2, 1])
    expect(g2.state.maps.at).toMatchObject({ x: 2, y: 1 })
  })

  it('進格的掛點給了 followUps 或 battle：這一段路也到這一格為止；battle 只取第一個', () => {
    const second = BATTLE_SETUPS.encounter()
    const f: Feature = {
      id: 'ambush',
      install: (k) => {
        k.grid.onEnter('a', (ctx): GridEffect | void => {
          if (ctx.at.x === 1) return { followUps: [{ kind: 'system', action: 'event.note', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'saw', value: true }], outcome: { result: 'ok', summary: '看到了。' } }] }
        })
        k.grid.onEnter('b', (ctx): GridEffect | void => {
          if (ctx.at.x === 2) return { battle: second }
        })
      },
    }
    const g = game([f])
    g.enterMap('map_t')
    const r = g.gridMove([2, 1])
    expect(g.state.maps.at).toMatchObject({ x: 1, y: 1 })
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'event.note'])
    expect(g.state.flags.saw).toBe(true)
    const r2 = g.gridMove([2, 1])
    expect(r2.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(g.state.maps.at).toMatchObject({ x: 2, y: 1 })
    expect(g.battle).not.toBeNull()
  })

  it('遭遇點的標記：沒有註冊 ! 的觸發就當沒事；那一格已經 used 就不再觸發', () => {
    const fired: string[] = []
    const f: Feature = { id: 'spots', install: (k) => k.grid.onMark('!', 'spots', (_c, m) => { fired.push(m.id) }) }
    const g = game([f])
    g.enterMap('map_t', { at: [1, 1] })
    g.gridMove('east')
    expect(fired).toEqual(['!1'])
    commit(g, [{ op: 'map.sheet', map: 'm1', sheet: 's1', cells: { '2,1': { used: true } } }])
    g.gridMove('west')
    g.gridMove('east')
    expect(fired).toEqual(['!1'])
    const g2 = game()
    g2.enterMap('map_t', { at: [1, 1] })
    expect(g2.gridMove('east').status).toBe('applied')
  })

  it('標記觸發：資料裡寫的標記（E、T…）與遭遇點都問登錄表；觸發可以回 stop', () => {
    const f: Feature = { id: 'm', install: (k) => k.grid.onMark('E', 'm', (_c, m) => ({ line: `回到${m.name}。` })) }
    const g = game([f])
    g.enterMap('map_t', { at: [2, 1] })
    const r = g.gridMove([0, 1])
    expect(r.reports[0]!.outcome.summary).toBe('走了 2 格。回到入口。')
  })

  it('連接格換圖：站在那一張接回的連接格（沒寫 land）或 land 指定的格；落點站不上去丟錯；落點格也觸發標記', () => {
    const two = (land?: [number, number], f2: Partial<SheetDef> = {}): SpecialMapEntry => MAP([
      SHEET({ layout: ['#######', 'E.1.2<#', '#######'], spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [4, 1], cover: 'sparse' }], links: [{ at: [[5, 1]], to: 's2', ...(land ? { land } : {}) }] }),
      SHEET({ id: 's2', name: '二層', layout: ['#######', '>.1.2G#', '#######'], cells: [{ id: 'G1', at: [5, 1], mark: 'G', name: '崗哨' }], spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [4, 1], cover: 'sparse' }], links: [{ at: [[0, 1]], to: 's1' }], ...f2 }),
    ])
    const g = game([], [two()])
    g.enterMap('map_t')
    expect(g.gridMove([5, 1]).reports[0]!.outcome.summary).toBe('走了 5 格。到了二層。')
    expect(g.state.maps.at).toEqual({ map: 'm1', sheet: 's2', x: 0, y: 1 })
    expect(g.state.maps.instances.m1!.sheets.s2!.seen[1]!.startsWith('1')).toBe(true)
    const g2 = game([], [two([4, 1])])
    g2.enterMap('map_t')
    g2.gridMove([5, 1])
    expect(g2.state.maps.at).toMatchObject({ sheet: 's2', x: 4, y: 1 })
    const g3 = game([], [two([6, 1])])
    g3.enterMap('map_t')
    const before = stateHash(g3.state)
    expect(() => g3.gridMove([5, 1])).toThrow(/s1 接到 s2 的連接格站不上去/)
    expect(stateHash(g3.state)).toBe(before)
  })

  it('用掉的格子不再觸發；上鎖的門：走一格被擋、用目的地找路時繞不過去；放行之後走得過去', () => {
    const open: Feature = { id: 'o', install: (k) => k.grid.passRule('door_locked', 'o', (ctx) => (ctx.state.flags.key ? null : '鎖著。')) }
    const g = game([open])
    g.enterMap('map_t', { at: [2, 1] })
    expect(g.gridMove('east')).toMatchObject({ status: 'refused', reason: '鎖著。' })
    expect(g.gridMove([5, 1])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    commit(g, [{ op: 'flag', key: 'key', value: true }])
    expect(g.gridMove([5, 1]).status).toBe('applied')
    expect(g.state.maps.at).toMatchObject({ x: 5, y: 1 })
  })

  it('走一段路只看到哪裡就記哪裡：看過的格子併進 seen，不抹掉之前看過的', () => {
    const g = game()
    g.enterMap('map_t')
    const first = g.state.maps.instances.m1!.sheets.s1!.seen.join('')
    g.gridMove('east')
    const second = g.state.maps.instances.m1!.sheets.s1!.seen.join('')
    expect([...second].filter((c) => c === '1').length).toBeGreaterThanOrEqual([...first].filter((c) => c === '1').length)
  })

  it('任何一步都經過提交：不變式沒有違規（走路、換圖）', async () => {
    const g = game()
    g.enterMap('map_t')
    const { result, violations } = await observed(g, () => g.gridMove([2, 1]))
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
  })

  it('遭遇點寫壞了（不存在的敵人）：整步不成立，人沒有站過去、沒有留下報告，原因寫出來（不變式第 61 條）', () => {
    const f: Feature = { id: 'bad', install: (k) => k.grid.onMark('!', 'bad', () => ({ battle: { ...BATTLE_SETUPS.encounter(), foes: [{ from: 'enemy', id: 'ghost' }] } })) }
    const g = game([f])
    g.enterMap('map_t', { at: [1, 1] })
    const before = stateHash(g.state)
    const r = g.gridMove('east')
    expect(r.status).toBe('refused')
    expect(r.reason).toMatch(/這裡的戰鬥開不起來（沒有 enemy 這種單位的來源/)
    expect(stateHash(g.state)).toBe(before)
    expect(g.state.maps.at).toMatchObject({ x: 1, y: 1 })
  })

  it('進格的掛點丟了程式的錯誤（不是 GridBlocked、沒有開打）：往外丟、狀態不變', () => {
    const f: Feature = { id: 'boom', install: (k) => k.grid.onEnter('boom', () => { throw new Error('壞掉了') }) }
    const g = game([f])
    g.enterMap('map_t')
    const before = stateHash(g.state)
    expect(() => g.gridMove('east')).toThrow(/壞掉了/)
    expect(stateHash(g.state)).toBe(before)
  })
})
