// 地圖引擎的 M3 部分（工單 dev/work/M3-core-grid.md；dev/adr/0018 第五節、N1、N26；dev/adr/0012）：
// 地圖實例自己帶定義（生成的地圖）、網內的格子種類與「這張地圖是網內的」、視野照圖設定、存檔第 4 版。
// 現有的地圖與探索測試（grid.test.ts、grid-m2.test.ts、features 的 explore）原樣全過，這裡只加新的。
// 測試自帶最小的假資料：每一張地圖都是這個檔自己寫的定義，內容裡沒有它們。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Change, Feature, Game, SheetDef, SpecialMapEntry } from '../../src'
import { CELL_TRAITS, DEFAULT_LEGEND, MIGRATIONS, NET_LEGEND, NET_MAP_KINDS, SAVE_VERSION, Sheet, blankState, createKernel, createStateKernel, instanceDef, isNetMapKind, markersInLayout, openMap, packSave, sheetProblems, sightOf, specialMapProblems, unpackSave } from '../../src'
import { makeCommissionGame, makeGame, stateHash, walkTo } from '../../src/testkit'
import { chooseBranch, chooseFace, readRun } from '../../src/features/commission'

// ---- 測試用的網內地圖 ----

/** 一張網內的圖：圖例是 NET_LEGEND；標記的清單照版面自動列出（cells 要和版面一一對上）。 */
function netSheet(layout: string[], over: Partial<SheetDef> = {}): SheetDef {
  const base: SheetDef = { id: 'l1', name: '第一層', size: [layout[0]!.length, layout.length], layout, legend: NET_LEGEND, ...over }
  return { ...base, cells: markersInLayout(base).map((m) => ({ id: m.id, at: m.at, mark: m.mark, name: `節點 ${m.id}` })) }
}

function netMap(id: string, layout: string[], over: Partial<SheetDef> = {}, kind = 'subnet'): SpecialMapEntry {
  const sheet = netSheet(layout, over)
  return { id, kind, size: sheet.size, sheets: [sheet] }
}

// 11 × 9：十三種節點裡的大部分，都在入口走得到的地方
const BIG = [
  '###########',
  '#E.g.a.c.i#',
  '#.#######.#',
  '#.p.w.o..r#',
  '#.#######.#',
  '#.b.....f.#',
  '#.#######.#',
  '#.m.v.x.r.#',
  '###########',
]
const GEN = netMap('gen_subnet_a', BIG)

/** 一張網內的圖的格式檢查（網內的圖不要求遭遇點：和 specialMapProblems 對 NET_MAP_KINDS 的做法一樣）。 */
const problemsOf = (def: SheetDef): string[] => sheetProblems(def, [def.id], { minSpots: 0 })

const commit = (game: Game, changes: Change[], summary = '測試'): void => {
  game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary } })
}

/** 開一份生成的地圖並站進去；回傳實例的 id。 */
function openGen(game: Game, def: SpecialMapEntry, o: { seed?: number; by?: string; sheet?: string; at?: string | [number, number] } = {}): string {
  const r = openMap(game.k, game.state, def, { seed: 7, by: 'test', ...o })
  commit(game, r.changes, '開地圖')
  return r.id
}

const patchCell = (game: Game, key: string, kind: string): void => commit(game, [{ op: 'map.sheet', map: 'm1', sheet: 'l1', cells: { [key]: { kind } } }], `${key} 改成 ${kind}`)

describe('生成的地圖：定義存在實例裡，內容裡沒有它（N1）', () => {
  it('BIG 這張 11 × 9 的測試地圖本身合格；內容裡查不到它', () => {
    expect([...BIG.map((r) => r.length)]).toEqual(Array(9).fill(11))
    expect(problemsOf(GEN.sheets[0]!)).toEqual([])
    expect(specialMapProblems(GEN as unknown as Record<string, unknown>)).toEqual([])
    const { game } = makeGame()
    expect(game.k.content.get('special_map', 'gen_subnet_a')).toBeUndefined()
  })

  it('openMap 收整筆定義：gen 記進實例、def 是它的 id；gridView 與 gridMove 照它走', () => {
    const { game } = makeGame()
    const id = openGen(game, GEN, { seed: 12345, by: 'netrun' })
    expect(id).toBe('m1')
    const inst = game.state.maps.instances.m1!
    expect(inst.def).toBe('gen_subnet_a')
    expect(inst.gen).toEqual({ map: GEN, seed: 12345, by: 'netrun' })
    // 存進去的是一份拷貝：改手上的定義不影響實例
    expect(inst.gen!.map).not.toBe(GEN)
    expect(game.state.maps.at).toEqual({ map: 'm1', sheet: 'l1', x: 1, y: 1 })
    const v = game.gridView()!
    expect(v).toMatchObject({ map: 'm1', sheet: 'l1', name: '第一層', size: [11, 9], at: [1, 1], here: { marker: { id: 'E1', mark: 'E' } } })
    expect(v.moves).toMatchObject({ east: null, south: null, west: '那邊走不過去。', north: '那邊走不過去。' })
    expect(v.cells[1]![0]).toBe('wall') // 入口旁邊的牆
    expect(v.cells[8]![10]).toBeNull() // 還沒看到
    // 走到閘門（g1）：沒有人註冊節點的規則，只是站上去
    const r = game.gridMove([3, 1])
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.outcome.summary).toBe('走了 2 格。')
    expect(game.gridView()!.here.marker).toMatchObject({ id: 'g1', mark: 'g', name: '節點 g1' })
    expect(game.gridMove('south')).toMatchObject({ status: 'refused', reason: '那邊走不過去。' })
    // 沿著版面一路走到另一頭：入口 → 閘門 → 檔案庫 → 控制節點 → 印記
    expect(game.gridMove([9, 1]).status).toBe('applied')
    expect(game.gridView()!.here.marker).toMatchObject({ id: 'i1' })
    expect(game.state.maps.instances.m1!.sheets.l1!.seen[1]).toMatch(/^1{11}$/) // 走過的那一列全看過
  })

  it('def 是 id 時照舊查內容；實例沒有 gen 就是第 3 版以前的寫法', () => {
    const { game } = makeGame({ content: [{ id: 'maps', content: { special_map: [GEN] } }] })
    const r = openMap(game.k, game.state, 'gen_subnet_a')
    expect(r.changes[0]).toMatchObject({ op: 'map.open', instance: { id: 'm1', def: 'gen_subnet_a' } })
    expect((r.changes[0] as unknown as { instance: object }).instance).not.toHaveProperty('gen')
    commit(game, r.changes)
    expect(game.gridView()!.size).toEqual([11, 9])
    expect(() => openMap(game.k, game.state, 'no_such_map')).toThrow(/沒有 no_such_map 這張地圖/)
  })

  it('instanceDef：有 gen 用它自己的，沒有查內容；內容裡同 id 的另一筆不會蓋過它', () => {
    const other = netMap('gen_subnet_a', ['#####', '#E..#', '#####'])
    const { game } = makeGame({ content: [{ id: 'maps', content: { special_map: [other] } }] })
    openGen(game, GEN)
    const inst = game.state.maps.instances.m1!
    expect(instanceDef(game.k, inst)).toEqual(GEN)
    expect(game.gridView()!.size).toEqual([11, 9]) // 是 GEN，不是內容裡那筆 5 × 3 的
    // 沒有 gen 的實例才查內容
    const byId = openMap(game.k, game.state, 'gen_subnet_a', {})
    commit(game, byId.changes)
    expect(instanceDef(game.k, game.state.maps.instances.m2!)).toEqual(other)
    expect(game.gridView()!.size).toEqual([5, 3])
    // 沒有 gen、內容裡也沒有：丟錯
    expect(() => instanceDef(game.k, { id: 'm9', def: 'gone', sheets: {} })).toThrow(/沒有 gone 這張地圖/)
  })

  it('openMap 沒給 seed 與 by 時有預設（0、gen）；給了整筆定義但它不合格：丟錯、訊息寫出問題，狀態不變', () => {
    const { game } = makeGame()
    const r = openMap(game.k, game.state, GEN)
    expect((r.changes[0] as unknown as { instance: { gen: object } }).instance.gen).toMatchObject({ seed: 0, by: 'gen' })
    const before = stateHash(game.state)
    const bad = { ...GEN, sheets: [{ ...GEN.sheets[0]!, layout: BIG.slice(1) }] }
    expect(() => openMap(game.k, game.state, bad)).toThrow(/生成的地圖不合格：.*layout 要有 9 列/)
    expect(() => openMap(game.k, game.state, { ...GEN, id: 'Bad Id' })).toThrow(/id 的格式不對/)
    expect(stateHash(game.state)).toBe(before)
  })

  it('map.open 帶缺一列的定義被擋，狀態不變；id 對不上、種子不是安全整數、沒寫 by、gen 不是物件也一樣', () => {
    const { game } = makeGame()
    const before = stateHash(game.state)
    const open = (gen: unknown, def = 'gen_subnet_a'): Change[] => [{ op: 'map.open', instance: { id: 'm1', def, sheets: {}, gen } }]
    const tries: Array<[string, unknown, RegExp, string?]> = [
      ['缺一列', { map: { ...GEN, sheets: [{ ...GEN.sheets[0]!, layout: BIG.slice(1) }] }, seed: 1, by: 't' }, /生成的地圖不合格.*layout 要有 9 列/],
      ['列的長度不對', { map: { ...GEN, sheets: [{ ...GEN.sheets[0]!, layout: BIG.map((r, i) => (i === 3 ? r.slice(1) : r)) }] }, seed: 1, by: 't' }, /第 3 列的長度要是 11/],
      ['id 對不上 def', { map: GEN, seed: 1, by: 't' }, /gen\.map\.id（gen_subnet_a）要等於實例的 def（gen_other）/, 'gen_other'],
      ['種子是小數', { map: GEN, seed: 1.5, by: 't' }, /gen\.seed 要是安全整數/],
      ['種子大到失真', { map: GEN, seed: 2 ** 60, by: 't' }, /gen\.seed 要是安全整數/],
      ['沒寫 by', { map: GEN, seed: 1 }, /gen\.by 要是非空的字串/],
      ['by 是空白', { map: GEN, seed: 1, by: '  ' }, /gen\.by 要是非空的字串/],
      ['gen 不是物件', 'x', /gen 要是一個物件/],
      ['map 不是物件', { map: 7, seed: 1, by: 't' }, /gen\.map 要是地圖的定義/],
      ['沒有圖', { map: { ...GEN, sheets: [] }, seed: 1, by: 't' }, /sheets 要有至少一張圖/],
      ['標記和版面對不上', { map: { ...GEN, sheets: [{ ...GEN.sheets[0]!, cells: GEN.sheets[0]!.cells!.slice(1) }] }, seed: 1, by: 't' }, /沒有列在 cells 裡/],
    ]
    for (const [name, gen, re, def] of tries) {
      expect(() => commit(game, open(gen, def)), name).toThrow(re)
      expect(stateHash(game.state), name).toBe(before)
    }
    expect(game.state.maps).toEqual({ instances: {}, at: null, seq: 0 })
    // 合格的收得下
    commit(game, open({ map: GEN, seed: 1, by: 't' }))
    expect(game.state.maps.instances.m1!.gen!.map.id).toBe('gen_subnet_a')
  })

  it('變更記進紀錄時不留整份定義，只留種子與是誰生成的；狀態裡照舊有整份', () => {
    const { game } = makeGame()
    const r = openMap(game.k, game.state, GEN, { seed: 99, by: 'netrun' })
    game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: r.changes, outcome: { result: 'ok', summary: '開地圖' } })
    // 紀錄（state.reports）裡的是瘦身版；提交回傳的報告不管
    const logged = game.state.reports.at(-1)!.changes[0] as unknown as { op: string; instance: Record<string, unknown> }
    expect(logged).toMatchObject({ op: 'map.open', instance: { id: 'm1', def: 'gen_subnet_a', gen: { seed: 99, by: 'netrun' } } })
    expect(logged.instance.gen).not.toHaveProperty('map')
    expect(JSON.stringify(game.state.reports.at(-1)!.changes[0])).not.toContain('layout')
    expect(game.state.maps.instances.m1!.gen!.map).toEqual(GEN)
  })

  it('版面的檢查走內容登錄表的 special_map 種類（同一個函式）；只有 L3 的核心沒有這個種類，收不了 gen（不會漏檢）', () => {
    const k = createKernel()
    expect(k.content.hasKind('special_map')).toBe(true)
    expect(k.content.validate('special_map', [GEN])).toEqual([])
    const l3 = createStateKernel()
    expect(l3.content.hasKind('special_map')).toBe(false)
    const state = blankState(1)
    const withGen: Change[] = [{ op: 'map.open', instance: { id: 'm1', def: 'gen_subnet_a', sheets: {}, gen: { map: GEN, seed: 1, by: 't' } } }]
    expect(() => l3.changes.applyAll(state, withGen)).toThrow(/沒有地圖定義的檢查/)
    expect(state.maps.instances).toEqual({})
    // 沒有 gen 的實例，L3 照樣收（舊的寫法）
    l3.changes.applyAll(state, [{ op: 'map.open', instance: { id: 'm1', def: 'x', sheets: {} } }])
    expect(state.maps.instances.m1).toBeDefined()
  })
})

describe('這張地圖是網內的（NET_MAP_KINDS）：不要求遭遇點（N6、0018 第五節）', () => {
  const noSpots = (kind: string): SpecialMapEntry => ({ id: 'x_map', kind, size: [3, 3], sheets: [{ id: 'a', name: 'A', size: [3, 3], layout: ['###', '#E#', '###'], cells: [{ id: 'E1', at: [1, 1], mark: 'E', name: '入口' }] }] })

  it('kind 是 subnet（與 maze、wreck、deep）的地圖沒有遭遇點合格；office_small 沒有遭遇點照舊不合格；街區的照舊', () => {
    expect([...NET_MAP_KINDS]).toEqual(['subnet', 'maze', 'wreck', 'deep'])
    for (const kind of NET_MAP_KINDS) {
      expect(isNetMapKind(kind), kind).toBe(true)
      expect(specialMapProblems(noSpots(kind) as unknown as Record<string, unknown>), kind).toEqual([])
    }
    expect(specialMapProblems(noSpots('office_small') as unknown as Record<string, unknown>).join('\n')).toMatch(/每一張至少要有 2 個遭遇點/)
    expect(specialMapProblems(noSpots('block') as unknown as Record<string, unknown>)).toEqual([])
    for (const kind of ['block', 'office_small', 'Subnet', '', undefined, 3]) expect(isNetMapKind(kind), String(kind)).toBe(false)
    // 進內容時一樣：kind 是 subnet 的載得進去
    const k = createKernel()
    expect(() => k.content.load('special_map', [noSpots('subnet')])).not.toThrow()
    expect(() => k.content.load('special_map', [{ ...noSpots('office_small'), id: 'x_map2' }])).toThrow(/遭遇點/)
  })

  it('入口照舊認 E 或連接格：沒有入口也沒有連接格的網內地圖不合格', () => {
    const noEntry: SpecialMapEntry = { id: 'x_map', kind: 'subnet', size: [3, 3], sheets: [{ id: 'a', name: 'A', size: [3, 3], layout: ['###', '#.#', '###'] }] }
    expect(specialMapProblems(noEntry as unknown as Record<string, unknown>).join('\n')).toMatch(/沒有入口也沒有連接格/)
  })
})

describe('十三種網內的格子', () => {
  // [種類, 圖例的字元, 走得上去, 標記的字母, 走不上去時預設的原因]
  const KINDS: Array<[string, string, boolean, string | undefined, string | undefined]> = [
    ['net_gate', 'g', true, 'g', undefined],
    ['net_archive', 'a', true, 'a', undefined],
    ['net_control', 'c', true, 'c', undefined],
    ['net_foe', 'f', false, 'f', '有東西守在這個節點上。'],
    ['net_person', 'p', true, 'p', undefined],
    ['net_alarm', 'w', true, 'w', undefined],
    ['net_loop', 'o', true, 'o', undefined],
    ['net_puzzle', 'm', false, 'm', '這裡有一道機關擋著。'],
    ['net_imprint', 'i', true, 'i', undefined],
    ['net_rest', 'r', true, 'r', undefined],
    ['net_safe', 'b', true, 'b', undefined],
    ['net_valve', 'v', false, undefined, '這條鏈路是單向的，從這一邊過不去。'],
    ['net_bridge', 'x', true, undefined, undefined],
  ]

  it('性質：看得穿；走不走得上去；標記的字母；locked 的只有遭遇、機關、單向鏈路三種；NET_LEGEND 每一種各一個字元', () => {
    expect(KINDS).toHaveLength(13)
    for (const [kind, ch, walk, mark, reason] of KINDS) {
      const t = CELL_TRAITS[kind]!
      expect(t, kind).toBeDefined()
      expect(t.see, kind).toBe(true)
      expect(t.walk, kind).toBe(walk)
      expect(t.mark, kind).toBe(mark)
      expect(!!t.locked, kind).toBe(!walk)
      expect(t.lockedReason, kind).toBe(reason)
      expect(NET_LEGEND[ch], kind).toBe(kind)
    }
    expect(Object.keys(NET_LEGEND).sort().join('')).toBe([...'#.Egacfpwomirbvx'].sort().join(''))
    expect(Object.values(NET_LEGEND).filter((k) => k.startsWith('net_'))).toHaveLength(13)
    // 現實的種類不受影響：上鎖的門是 locked、原因沒寫（預設「門鎖著。」）
    expect(CELL_TRAITS.door_locked).toEqual({ walk: false, see: false, locked: true })
  })

  it('網內的標記是小寫字母，和現實的大寫、符號都不撞', () => {
    const net = new Set(KINDS.flatMap(([, , , mark]) => (mark ? [mark] : [])))
    expect([...net].sort().join('')).toBe('abcfgimoprw'.split('').sort().join(''))
    for (const [kind, t] of Object.entries(CELL_TRAITS)) {
      if (!t.mark || kind.startsWith('net_')) continue
      expect(net.has(t.mark), `${kind} 的標記 ${t.mark}`).toBe(false)
    }
    // 圖例：o 在預設是半掩體、在網內是迴圈碎片；網內的圖帶 NET_LEGEND 才蓋得過去
    expect(DEFAULT_LEGEND.o).toBe('half_cover')
    expect(NET_LEGEND.o).toBe('net_loop')
    const plain: SheetDef = { id: 's', name: 's', size: [3, 1], layout: ['.o.'] }
    expect(new Sheet(plain).kindAt(1, 0)).toBe('half_cover')
    expect(new Sheet({ ...plain, legend: NET_LEGEND }).kindAt(1, 0)).toBe('net_loop')
  })

  it('markersInLayout 照字母編號：g1、a1……；大寫與小寫各自編、互不相干（C1 與 c1）', () => {
    const ids = (layout: string[]) => markersInLayout({ id: 's', name: 's', size: [layout[0]!.length, layout.length], layout, legend: NET_LEGEND }).map((m) => m.id)
    expect(ids(['#E.C.c#'])).toEqual(['E1', 'C1', 'c1'])
    expect(ids(['#E.CcCc#'])).toEqual(['E1', 'C1', 'c1', 'C2', 'c2'])
    expect(ids(['#E.g.a.c.i#', '#.p.w.o..r#', '#.b.f..m..#'])).toEqual(['E1', 'g1', 'a1', 'c1', 'i1', 'p1', 'w1', 'o1', 'r1', 'b1', 'f1', 'm1'])
    expect(ids(['#E.gg.aa#'])).toEqual(['E1', 'g1', 'g2', 'a1', 'a2'])
    // 沒有標記的兩種不編號
    expect(ids(['#E.v.x.#'])).toEqual(['E1'])
    // 同一張圖上有 C 也有 c：格式檢查要兩邊的標記都列在 cells 裡
    const both = netSheet(['#######', '#E.C.c#', '#.....#', '#######'])
    expect(both.cells!.map((m) => `${m.id}:${m.mark}`)).toEqual(['E1:E', 'C1:C', 'c1:c'])
    expect(problemsOf(both)).toEqual([])
    expect(problemsOf({ ...both, cells: both.cells!.filter((m) => m.id !== 'c1') }).join('\n')).toMatch(/c1（5,1）沒有列在 cells 裡/)
    const sheet = new Sheet(both)
    expect(sheet.kindAt(3, 1)).toBe('control')
    expect(sheet.kindAt(5, 1)).toBe('net_control')
  })

  for (const [kind, ch, walk, mark, reason] of KINDS) {
    it(`${kind}（${ch}）：${walk ? '走得上去' : '走不上去'}${mark ? `、標記 ${mark}1` : '、沒有標記'}${reason ? `、沒有人放行時「${reason}」` : ''}`, () => {
      const def = netMap('gen_one', ['#####', `#E${ch}.#`, '#####'])
      expect(problemsOf(def.sheets[0]!)).toEqual([])
      const sheet = new Sheet(def.sheets[0]!)
      expect(sheet.kindAt(2, 1)).toBe(kind)
      expect(sheet.walkable(2, 1)).toBe(walk)
      expect(sheet.markerAt(2, 1)?.id).toBe(mark ? `${mark}1` : undefined)
      const { game } = makeGame()
      openGen(game, def)
      const view = game.gridView()!
      expect(view.moves.east).toBe(walk ? null : reason)
      const r = game.gridMove('east')
      if (walk) {
        expect(r.status).toBe('applied')
        expect(game.state.maps.at).toMatchObject({ x: 2, y: 1 })
        expect(game.gridView()!.here.marker?.id).toBe(mark ? `${mark}1` : undefined)
        expect(game.gridMove('east').status).toBe('applied') // 過去之後是一般的地板
      } else {
        expect(r).toMatchObject({ status: 'refused', reason })
        expect(game.state.maps.at).toMatchObject({ x: 1, y: 1 })
      }
    })
  }

  it('locked 的三種：有人註冊放行規則就用他的原因與決定；放行規則拿到的 ctx.at 是現在站的那一格', () => {
    const seen: Array<[string, number, number, number, number]> = []
    const gate: Feature = {
      id: 'gate',
      install: (k) => {
        for (const kind of ['net_foe', 'net_puzzle', 'net_valve']) {
          k.grid.passRule(kind, 'gate', (ctx, x, y) => {
            seen.push([kind, ctx.at.x, ctx.at.y, x, y])
            return ctx.state.flags[`open_${kind}`] ? null : `${kind} 還關著。`
          })
        }
      },
    }
    for (const kind of ['net_foe', 'net_puzzle', 'net_valve']) {
      const ch = Object.entries(NET_LEGEND).find(([, v]) => v === kind)![0]
      const { game } = makeGame({ features: [gate] })
      openGen(game, netMap('gen_one', ['#####', `#E${ch}.#`, '#####']))
      expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: `${kind} 還關著。` })
      expect(game.gridView()!.moves.east).toBe(`${kind} 還關著。`)
      expect(seen.at(-1)).toEqual([kind, 1, 1, 2, 1]) // 站在 (1,1)，要走進 (2,1)
      commit(game, [{ op: 'flag', key: `open_${kind}`, value: true }])
      expect(game.gridMove('east').status).toBe('applied')
      expect(game.state.maps.at).toMatchObject({ x: 2, y: 1 })
    }
  })
})

describe('處理完的節點改成地板、走過就斷的鏈路改成牆（map.sheet 的 cells）', () => {
  // 沒有繞路：net_foe 擋在唯一的路上
  const CORRIDOR = ['#######', '#E.f..#', '#######']
  // 有繞路：從入口到 (5,1)，穿過 net_foe 4 步，繞一圈 8 步
  const RING = ['#######', '#E.f..#', '#.###.#', '#.....#', '#######']

  it('net_foe 擋在唯一的路上：走不到；改成 floor 之後走得過去', () => {
    const { game } = makeGame()
    openGen(game, netMap('gen_one', CORRIDOR))
    expect(game.gridMove([5, 1])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    expect(game.gridMove('east').status).toBe('applied')
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '有東西守在這個節點上。' })
    patchCell(game, '3,1', 'floor')
    expect(game.gridView()!.moves.east).toBeNull()
    expect(game.gridMove([5, 1]).status).toBe('applied')
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 1 })
  })

  it('net_foe 有繞路：尋路改前繞開（8 步），改成 floor 之後穿過它（4 步）', () => {
    const before = makeGame().game
    openGen(before, netMap('gen_one', RING))
    const r1 = before.gridMove([5, 1])
    expect(r1.status).toBe('applied')
    expect(r1.reports[0]!.outcome.summary).toBe('走了 8 格。')
    expect(before.state.maps.at).toMatchObject({ x: 5, y: 1 })

    const after = makeGame().game
    openGen(after, netMap('gen_one', RING))
    patchCell(after, '3,1', 'floor')
    const r2 = after.gridMove([5, 1])
    expect(r2.reports[0]!.outcome.summary).toBe('走了 4 格。')
    // 改過的格子記在實例上，定義沒動
    expect(after.state.maps.instances.m1!.sheets.l1!.cells).toEqual({ '3,1': { kind: 'floor' } })
    expect(after.state.maps.instances.m1!.gen!.map.sheets[0]!.layout[1]).toBe('#E.f..#')
    // 純模型：同樣的事，Sheet 加 patch
    const s0 = new Sheet(netSheet(RING))
    const locked = (x: number, y: number) => s0.walkable(x, y)
    expect(s0.findPath({ x: 1, y: 1 }, { x: 5, y: 1 }, locked)).toHaveLength(9)
    const s1 = new Sheet(netSheet(RING), { '3,1': { kind: 'floor' } })
    expect(s1.findPath({ x: 1, y: 1 }, { x: 5, y: 1 })).toHaveLength(5)
  })

  it('net_bridge 走得上去；改成 wall 之後走不過去', () => {
    const { game } = makeGame()
    openGen(game, netMap('gen_one', ['#######', '#E.x..#', '#######']))
    expect(game.gridMove('east').status).toBe('applied')
    expect(game.gridView()!.moves.east).toBeNull()
    patchCell(game, '3,1', 'wall')
    expect(game.gridView()!.moves.east).toBe('那邊走不過去。')
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '那邊走不過去。' })
    expect(game.gridMove([5, 1])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
  })

  it('上鎖的門沒有人註冊放行規則時，原因照舊是「門鎖著。」（沒寫 lockedReason 的種類）', () => {
    const { game } = makeGame()
    openGen(game, { id: 'gen_door', kind: 'subnet', size: [5, 3], sheets: [{ id: 'l1', name: '門', size: [5, 3], layout: ['#####', '#E%.#', '#####'], cells: [{ id: 'E1', at: [1, 1], mark: 'E', name: '入口' }] }] })
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '門鎖著。' })
  })
})

describe('單向的鏈路：放行規則看從哪一邊來（net_valve）', () => {
  const fromWest: Feature = { id: 'valve', install: (k) => k.grid.passRule('net_valve', 'valve', (ctx, x) => (ctx.at.x < x ? null : '這條鏈路只能從西邊過。')) }
  const fromEast: Feature = { id: 'valve', install: (k) => k.grid.passRule('net_valve', 'valve', (ctx, x) => (ctx.at.x > x ? null : '這條鏈路只能從東邊過。')) }

  it('從西邊來才放行：從西邊過得去、從東邊被擋；畫面上四個方向的原因跟著現在站的那一格', () => {
    const { game } = makeGame({ features: [fromWest] })
    openGen(game, netMap('gen_one', ['#######', '#E.v..#', '#######']))
    expect(game.gridMove('east').status).toBe('applied')
    expect(game.gridView()!.moves.east).toBeNull() // 站在 (2,1)，要走進 (3,1)
    expect(game.gridMove([5, 1]).status).toBe('applied') // 穿過單向的那一格
    expect(game.state.maps.at).toMatchObject({ x: 5, y: 1 })
    expect(game.gridMove('west').status).toBe('applied') // (4,1)
    expect(game.gridView()!.moves.west).toBe('這條鏈路只能從西邊過。')
    expect(game.gridMove('west')).toMatchObject({ status: 'refused', reason: '這條鏈路只能從西邊過。' })
    expect(game.gridMove([1, 1])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
  })

  it('沒有人註冊放行規則：兩邊都過不去，原因是預設的句子', () => {
    const { game } = makeGame()
    openGen(game, netMap('gen_one', ['#######', '#E.v..#', '#######']))
    game.gridMove('east')
    expect(game.gridMove('east')).toMatchObject({ status: 'refused', reason: '這條鏈路是單向的，從這一邊過不去。' })
    expect(game.gridMove([5, 1])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
  })

  // 入口在西邊，要去的格子在單向鏈路的西邊，但路得繞一圈、從東邊走進鏈路：尋路要用「從哪一格走進來」問放行規則，不是用起點
  const U = ['#######', '#E...##', '####.##', '#.v..##', '#######']

  it('尋路每一格都用它的前一格問：從東邊走進鏈路的路徑被擋（就算起點在西邊）', () => {
    const { game } = makeGame({ features: [fromWest] })
    openGen(game, netMap('gen_one', U))
    expect(game.gridMove([1, 3])).toMatchObject({ status: 'refused', reason: '走不到那裡。' })
    expect(game.state.maps.at).toMatchObject({ x: 1, y: 1 })
  })

  it('只能從東邊過的規則：同一張圖，這條路就通了（繞一圈、8 步）', () => {
    const { game } = makeGame({ features: [fromEast] })
    openGen(game, netMap('gen_one', U))
    const r = game.gridMove([1, 3])
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.outcome.summary).toBe('走了 8 格。')
    expect(game.state.maps.at).toMatchObject({ x: 1, y: 3 })
  })

  it('Sheet.findPath 的 pass 第三個參數是前一格；沒給 from 的舊寫法照舊', () => {
    const s = new Sheet(netSheet(U))
    const calls: string[] = []
    const path = s.findPath({ x: 1, y: 1 }, { x: 4, y: 1 }, (x, y, from) => {
      calls.push(`${from?.x},${from?.y}->${x},${y}`)
      return s.walkable(x, y)
    })
    expect(path).toHaveLength(4)
    expect(calls[0]).toBe('1,1->2,1')
    expect(calls.every((c) => !c.startsWith('undefined'))).toBe(true)
    // 起點就是終點：問一次，from 是它自己
    let got: unknown
    expect(s.findPath({ x: 1, y: 1 }, { x: 1, y: 1 }, (_x, _y, from) => { got = from; return true })).toEqual([{ x: 1, y: 1 }])
    expect(got).toEqual({ x: 1, y: 1 })
    expect(s.findPath({ x: 1, y: 1 }, { x: 1, y: 1 }, () => false)).toBeNull()
    // 兩個參數的舊寫法
    expect(s.findPath({ x: 1, y: 1 }, { x: 4, y: 3 })).toHaveLength(6)
    expect(s.reachable({ x: 1, y: 1 }).has('4,3')).toBe(true)
    expect(s.reachable({ x: 1, y: 1 }, (x, y, from) => s.walkable(x, y) && !!from && from.x <= 3).has('4,1')).toBe(true)
  })
})

describe('視野照這一張圖的 sight（N26）', () => {
  const ROOM = Array.from({ length: 9 }, (_, y) => (y === 0 || y === 8 ? '#########' : y === 4 ? '#...E...#' : '#.......#'))
  const count = (game: Game): number => game.state.maps.instances.m1!.sheets.l1!.seen.join('').split('1').length - 1

  it('sightOf：有寫用它；沒寫照舊（平常 5、沒有燈 1）；寫了就蓋掉沒有燈', () => {
    const base = netSheet(ROOM)
    expect(sightOf(base)).toBe(5)
    expect(sightOf({ ...base, dark: true })).toBe(1)
    expect(sightOf({ ...base, sight: 2 })).toBe(2)
    expect(sightOf({ ...base, sight: 9 })).toBe(9)
    expect(sightOf({ ...base, dark: true, sight: 3 })).toBe(3)
  })

  it('sight: 2 的圖只揭開兩格以內；沒寫的圖照舊（5 格）', () => {
    const near = makeGame().game
    openGen(near, netMap('gen_room', ROOM, { sight: 2 }))
    // 開放的地板：曼哈頓距離 2 以內的 13 格（九、十二：四方向算步數，沒有牆擋）
    expect(count(near)).toBe(13)
    const seen = near.state.maps.instances.m1!.sheets.l1!.seen
    expect(seen[4]![2]).toBe('1') // (2,4)：距離 2
    expect(seen[4]![1]).toBe('0') // (1,4)：距離 3
    expect(seen[2]![4]).toBe('1')
    expect(seen[1]![4]).toBe('0')
    // 走一步：新的位置也只揭開兩格
    near.gridMove('east')
    expect(near.state.maps.instances.m1!.sheets.l1!.seen[4]![7]).toBe('1') // (7,4) 離新位置 (5,4) 兩格
    expect(near.state.maps.instances.m1!.sheets.l1!.seen[4]![8]).toBe('0')

    const usual = makeGame().game
    openGen(usual, netMap('gen_room', ROOM))
    expect(count(usual)).toBe(new Sheet(netSheet(ROOM)).visibleFrom({ x: 4, y: 4 }, 5).size)
    expect(count(usual)).toBeGreaterThan(13)
    const dark = makeGame().game
    openGen(dark, netMap('gen_room', ROOM, { dark: true }))
    expect(count(dark)).toBe(5) // 腳下加四個相鄰的格
    const darkSight = makeGame().game
    openGen(darkSight, netMap('gen_room', ROOM, { dark: true, sight: 3 }))
    expect(count(darkSight)).toBe(25) // 三格以內
  })

  it('格式檢查：sight 要是 1～9 的整數', () => {
    const ok = (sight: unknown) => problemsOf({ ...netSheet(ROOM), sight } as SheetDef)
    expect(ok(undefined)).toEqual([])
    expect(ok(1)).toEqual([])
    expect(ok(9)).toEqual([])
    for (const bad of [0, 10, -1, 2.5, '2', null, NaN]) expect(ok(bad).join('\n'), String(bad)).toMatch(/sight（視野的半徑）要是 1～9 的整數/)
    expect(() => makeGame().game.k.content.load('special_map', [{ ...netMap('gen_room', ROOM), sheets: [{ ...netSheet(ROOM), sight: 0 }] }])).toThrow(/sight/)
  })
})

describe('存檔第 4 版（N1）', () => {
  it('SAVE_VERSION 是 4；遷移表有「第 3 版升第 4 版」一步，什麼都不補', () => {
    expect(SAVE_VERSION).toBe(4)
    const step = MIGRATIONS.find((m) => m.from === 3)!
    expect(step.note).toMatch(/gen/)
    const probe = { a: 1, maps: { instances: {}, at: null, seq: 0 } }
    expect(step.run(probe)).toEqual(probe)
  })

  it('帶 gen 的存檔往返之後狀態一模一樣；接著走的結果和沒有中斷的一樣', () => {
    const play = (game: Game, resume?: (g: Game) => void): string => {
      openGen(game, GEN, { seed: 4242, by: 'test' })
      expect(game.gridMove([3, 1]).status).toBe('applied')
      resume?.(game)
      expect(game.gridMove([9, 1]).status).toBe('applied')
      expect(game.gridMove([9, 5]).status).toBe('applied')
      patchCell(game, '8,5', 'floor')
      expect(game.gridMove([3, 5]).status).toBe('applied') // 穿過改成地板的遭遇節點
      return stateHash(game.state)
    }
    const straight = play(makeGame().game)
    let saved = ''
    const resumed = play(makeGame().game, (g) => {
      const before = stateHash(g.state)
      saved = g.save('manual', 'now')
      const file = JSON.parse(saved) as { version: number; state: { maps: { instances: Record<string, { gen: { seed: number; by: string; map: { id: string } } }> } } }
      expect(file.version).toBe(4)
      expect(file.state.maps.instances.m1!.gen).toMatchObject({ seed: 4242, by: 'test', map: { id: 'gen_subnet_a' } })
      const again = unpackSave(saved)
      expect(again.ok && again.file.state).toEqual(g.state)
      expect(g.load(saved)).toBeNull()
      expect(stateHash(g.state)).toBe(before)
      expect(g.state.maps.instances.m1!.gen!.map).toEqual(GEN)
    })
    expect(resumed).toBe(straight)
    // 另一個全新的 Game 讀進來也能接著走（定義在存檔裡，內容裡沒有它）
    const fresh = makeGame().game
    expect(fresh.load(saved)).toBeNull()
    expect(fresh.gridView()).toMatchObject({ map: 'm1', size: [11, 9], at: [3, 1] })
    expect(fresh.gridMove([9, 1]).status).toBe('applied')
  })

  it('讀檔時驗證 gen：定義壞了、id 對不上、種子不是安全整數、沒寫 by 都讀不進來，錯誤寫出是哪一份實例；沒有 gen 的實例照樣合法', () => {
    const { game } = makeGame({ content: [{ id: 'maps', content: { special_map: [netMap('gen_plain', ['#####', '#E..#', '#####'])] } }] })
    openGen(game, GEN)
    const plain = openMap(game.k, game.state, 'gen_plain')
    commit(game, plain.changes)
    const text = game.save('manual', 'now')
    expect(unpackSave(text).ok).toBe(true)
    const broken = (edit: (gen: Record<string, any>) => void): ReturnType<typeof unpackSave> => {
      const file = JSON.parse(text)
      edit(file.state.maps.instances.m1.gen)
      return unpackSave(JSON.stringify(file))
    }
    const err = (r: ReturnType<typeof unpackSave>): string => (r.ok ? '' : r.error)
    expect(err(broken((g) => { g.map.sheets[0].layout.pop() }))).toMatch(/存檔壞了.*maps\.instances\.m1：.*layout 要有 9 列/)
    expect(err(broken((g) => { g.map.id = 'gen_other' }))).toMatch(/gen\.map\.id（gen_other）要等於實例的 def/)
    expect(err(broken((g) => { g.seed = 0.5 }))).toMatch(/gen\.seed 要是安全整數/)
    expect(err(broken((g) => { delete g.by }))).toMatch(/gen\.by/)
    expect(err(broken((g) => { g.map.sheets[0].layout[1] = '#E.g.a.c.i?' }))).toMatch(/圖例沒有的字元/)
    // 整個 gen 不是物件
    const file = JSON.parse(text)
    file.state.maps.instances.m1.gen = 5
    expect(err(unpackSave(JSON.stringify(file)))).toMatch(/gen 要是一個物件/)
    // 沒有 gen 的實例（m2）一直是合法的
    const onlyPlain = JSON.parse(text)
    delete onlyPlain.state.maps.instances.m1
    onlyPlain.state.maps.at = { map: 'm2', sheet: 'l1', x: 1, y: 1 }
    expect(unpackSave(JSON.stringify(onlyPlain)).ok).toBe(true)
  })

  it('快照（snapshot.take）裡帶著生成的地圖；回到快照之後它還在，位置也回到那時候', () => {
    const { game } = makeGame()
    openGen(game, GEN, { seed: 31, by: 'test' })
    expect(game.gridMove([3, 1]).status).toBe('applied')
    // 存一份快照：snapshot.take 要放在報告的第一筆變更
    commit(game, [{ op: 'snapshot.take', kind: 'test_gen', label: '站在閘門' }], '留一份快照')
    const slot = game.state.snapshots.find((s) => s.kind === 'test_gen')!
    const inSnapshot = JSON.parse(slot.raw) as { version: number; state: { maps: { at: unknown; instances: Record<string, { gen: { seed: number; map: { id: string; sheets: Array<{ layout: string[] }> } } }> } } }
    expect(inSnapshot.version).toBe(4)
    expect(inSnapshot.state.maps.instances.m1!.gen).toMatchObject({ seed: 31, map: { id: 'gen_subnet_a' } })
    expect(inSnapshot.state.maps.instances.m1!.gen.map.sheets[0]!.layout).toEqual(BIG)
    expect(inSnapshot.state.maps.at).toEqual({ map: 'm1', sheet: 'l1', x: 3, y: 1 })
    expect(unpackSave(slot.raw).ok).toBe(true)
    // 之後走遠、改格子、再把整張圖關掉
    expect(game.gridMove([9, 1]).status).toBe('applied')
    patchCell(game, '8,5', 'floor')
    commit(game, [{ op: 'map.at', to: null }, { op: 'map.close', id: 'm1' }], '離開')
    expect(game.state.maps.instances).toEqual({})
    // 回到快照：地圖與定義都回來了、站在閘門；之後的紀錄留著並標成被收回
    expect(game.rewindToKind('test_gen', '回到閘門。')).toBeNull()
    expect(game.state.maps.instances.m1!.gen).toEqual({ map: GEN, seed: 31, by: 'test' })
    expect(game.state.maps.at).toEqual({ map: 'm1', sheet: 'l1', x: 3, y: 1 })
    expect(game.state.maps.instances.m1!.sheets.l1!.cells).toEqual({})
    expect(game.gridView()).toMatchObject({ size: [11, 9], at: [3, 1], here: { marker: { id: 'g1' } } })
    expect(game.gridMove([9, 1]).status).toBe('applied')
  })
})

describe('第 3 版的舊檔（tests/fixtures/saves/v3-m2.json）', () => {
  // 從第 3 版的主幹存的：一件委託進行中（接案、出發、選了現實面與潛行分支）——地圖實例 m2 屬於這件委託、站在入口、還沒有保全看到；
  // 裡面有兩份快照：進入副本前（entry）、這個階段開始時（stage）。快照的文字也是第 3 版的存檔。
  const text = (): string => readFileSync(new URL('../fixtures/saves/v3-m2.json', import.meta.url), 'utf8')

  it('讀得進來：升到第 4 版、其餘原樣；實例沒有 gen（舊的寫法是合法的）', () => {
    const old = JSON.parse(text()) as { version: number; state: Record<string, any> }
    expect(old.version).toBe(3)
    expect(old.state.version).toBe(3)
    expect(Object.keys(old.state.maps.instances).sort()).toEqual(['m1', 'm2'])
    expect(old.state.snapshots.map((s: { kind: string }) => s.kind)).toEqual(['entry', 'stage'])
    const r = unpackSave(text())
    expect(r).toMatchObject({ ok: true, fromVersion: 3, file: { version: 4 } })
    if (!r.ok) return
    const s = r.file.state
    expect(s.version).toBe(4)
    for (const k of Object.keys(old.state)) if (k !== 'version') expect(s[k as keyof typeof s], k).toEqual(old.state[k])
    for (const inst of Object.values(s.maps.instances)) expect(inst).not.toHaveProperty('gen')
    // 讀進來的那一份存得下去、再讀回來一模一樣
    const again = unpackSave(packSave(s, r.file.meta))
    expect(again.ok && again.file.state).toEqual(s)
    expect(packSave(s, r.file.meta)).toContain('"version":4')
  })

  it('Game 讀得進來、接著玩：站在入口、走到目標、這個階段做完（時間照走）', () => {
    const { game } = makeCommissionGame()
    expect(game.load(text())).toBeNull()
    expect(game.state.version).toBe(4)
    expect(readRun(game.state)).toMatchObject({ stage: 1, step: 'play' })
    expect(game.gridView()).toMatchObject({ map: 'm2', sheet: 'room', at: [4, 0] })
    expect(game.state.maps.instances.m2).toMatchObject({ def: 'tw_room', owner: 'cm_fx_tw_broker__3__0' })
    // 潛行的分支：走到保全崗那一格，這個階段做完（沒有戰鬥），城裡過了兩個小時
    const reports = walkTo(game, 'G1')
    expect(reports.map((r) => r.action)).toEqual(['grid.move', 'commission.milestone'])
    expect(readRun(game.state)).toMatchObject({ stage: 2, step: 'face' })
    expect(game.state.maps.at).toBeNull() // 階段做完，這一份地圖收掉
    expect(game.state.version).toBe(4)
    // 做完的狀態存下去再讀回來：還是第 4 版、一模一樣
    const again = unpackSave(game.save('manual', 'now'))
    expect(again.ok && again.file.state).toEqual(game.state)
  })

  it('階段快照（第 3 版的文字）回得去：回去之後是第 4 版的狀態、選面之前；再選一次面與分支，地圖照常開起來', () => {
    const { game } = makeCommissionGame()
    expect(game.load(text())).toBeNull()
    const slot = game.state.snapshots.find((x) => x.kind === 'stage')!
    expect((JSON.parse(slot.raw) as { version: number }).version).toBe(3)
    expect(game.rewindTo(slot.id, { summary: '回到階段開始。' })).toBeNull() // 副本進行中 rewindToKind 被活動擋下；委託自己的回退走帶 rewind 的報告，這裡直接回到那份快照
    expect(game.state.version).toBe(4)
    expect(readRun(game.state)).toMatchObject({ stage: 1, step: 'face' })
    expect(game.state.maps.instances.m2).toBeUndefined()
    expect(game.state.maps.at).toMatchObject({ map: 'm1', sheet: 'street' }) // 選面之前還站在城裡的街上，副本的地圖還沒開
    expect(game.state.reports.some((r) => r.retracted)).toBe(true)
    game.commit(chooseFace(game.k, game.state, 'meat'))
    game.commit(chooseBranch(game.k, game.state, 'stealth'))
    expect(game.gridView()).toMatchObject({ sheet: 'room', at: [4, 0] })
    // 新開的地圖是內容裡的定義，不帶 gen
    expect(Object.values(game.state.maps.instances).filter((m) => m.owner === 'cm_fx_tw_broker__3__0').every((m) => m.gen === undefined)).toBe(true)
  })
})
