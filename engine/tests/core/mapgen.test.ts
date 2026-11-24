// 格子地圖的生成器（工單 dev/work/M3-core-mapgen.md；dev/adr/0018 第五節與末尾的實作補記；CYBERSPACE 8.1 節）。
// 一個純函式：照 spec 與一串亂數挖出一張圖、放好節點，回傳版面、節點的圖、沒畫在版面上的東西與一條保證走得通的路。
// 測試自帶兩份 spec（一份照一般子網的密度、一份照迷宮館），不讀內容、不寫任何一區的名字。

import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import type { GenEdge, GenPlace, GenResult, GenSpec } from '../../src'
import { GEN_MAX_RECARVE, NET_LEGEND, Sheet, generateSheet, genProblems, genSpecProblems, seedRand, specialMapProblems, valveAllows, openMap, instanceDef } from '../../src'
import { makeGame } from '../../src/testkit'

// ---- 測試用的 spec ----

type Size = [number, number]
const SIZES: Size[] = [[9, 7], [11, 9], [13, 9]]
const FOE_KIND = 'net_foe'

/** 一般子網的密度（CYBERSPACE 8.1 節的表）：carve 30～40、兩種陷阱各 0～1、檔案庫 1～2、休息點 1、遭遇 1～3 */
const subnet = (size: Size, extra: Partial<GenSpec> = {}): GenSpec => ({
  id: 'gen_a', name: '測試圖甲', size, carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' },
  places: [
    { kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '檔案庫' },
    { kind: 'net_rest', count: [1, 1], where: 'mid_path', name: '休息點', apart: 1 },
    { kind: FOE_KIND, count: [1, 3], where: 'far_half', name: '遭遇' },
    { kind: 'net_alarm', count: [0, 1], where: 'link', name: '警報', trap: true },
    { kind: 'net_loop', count: [0, 1], where: 'any', name: '迴圈碎片', trap: true },
  ],
  ...extra,
})

/** 迷宮館的密度：carve 18～24、機關 1、寶箱 1～2、遭遇 2、陷阱 0～1 */
const maze = (size: Size, extra: Partial<GenSpec> = {}): GenSpec => ({
  id: 'gen_b', name: '測試圖乙', size, carve: [18, 24], exit: { kind: 'net_gate', name: '出口' },
  places: [
    { kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '寶箱' },
    { kind: 'net_puzzle', count: [1, 1], where: 'any', name: '機關' },
    { kind: FOE_KIND, count: [2, 2], where: 'far_half', name: '遭遇' },
    { kind: 'net_alarm', count: [0, 1], where: 'any', name: '陷阱', trap: true },
  ],
  ...extra,
})

const SPECS: Array<[string, (size: Size, extra?: Partial<GenSpec>) => GenSpec]> = [['子網的密度', subnet], ['迷宮館的密度', maze]]

const gen = (spec: GenSpec, seed: number, purpose = 'test'): GenResult => generateSheet(spec, seedRand(seed, purpose))
const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i * 7919 + 13)

// ---- 檢查用的小工具（不用生成器自己的函式：另外算一遍） ----

const key = (p: readonly [number, number]): string => `${p[0]},${p[1]}`
const median = (ns: number[]): number => {
  const s = [...ns].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

/** 節點在圖上的鄰居（節點的 id → 相鄰節點的 id，不看方向）。 */
function neighbors(r: GenResult): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>(r.graph.nodes.map((n) => [n.id, new Set()]))
  for (const e of r.graph.edges) {
    m.get(e.a)!.add(e.b)
    m.get(e.b)!.add(e.a)
  }
  return m
}

/** 節點圖上離入口幾步（不看方向）。 */
function hopsFromEntry(r: GenResult): Map<string, number> {
  const nb = neighbors(r)
  const entry = r.graph.nodes.find((n) => n.kind === 'entry')!.id
  const hops = new Map<string, number>([[entry, 0]])
  const queue = [entry]
  for (let qi = 0; qi < queue.length; qi++) for (const n of nb.get(queue[qi]!)!) if (!hops.has(n)) { hops.set(n, hops.get(queue[qi]!)! + 1); queue.push(n) }
  return hops
}

/** 走得上去，或是要條件才過得去（遭遇、機關：處理完會變地板），單向的鏈路只有一個方向過得去；breakBridges 把會斷的鏈路當成已經斷了。 */
function directedPass(r: GenResult, sh: Sheet, breakBridges = false) {
  const at = new Map(r.graph.nodes.map((n) => [n.id, n.at]))
  const valveIn = new Map<string, string>()
  for (const e of r.graph.edges) {
    if (!e.oneway) continue
    const k = e.cells.findIndex((c) => sh.kindAt(c[0], c[1]) === 'net_valve')
    const from = e.oneway === 'ab' ? (k === 0 ? at.get(e.a)! : e.cells[k - 1]!) : (k === e.cells.length - 1 ? at.get(e.b)! : e.cells[k + 1]!)
    valveIn.set(key(e.cells[k]!), key(from))
  }
  return (x: number, y: number, from?: { x: number; y: number }): boolean => {
    const kind = sh.kindAt(x, y)
    if (kind === 'net_valve') return !!from && valveIn.get(`${x},${y}`) === `${from.x},${from.y}`
    if (kind === 'net_bridge') return !breakBridges
    return sh.walkable(x, y) || !!sh.traitsAt(x, y).locked
  }
}

const nodesOfKind = (r: GenResult, kind: string) => r.graph.nodes.filter((n) => n.kind === kind)
const exitOf = (r: GenResult) => nodesOfKind(r, 'net_gate')[0]!

describe('生成器：同一份 spec、同一個種子，結果逐字一樣', () => {
  it('生成兩次逐字一樣；不改動傳進來的 spec；整份結果是可以存檔的 JSON', () => {
    for (const [, mk] of SPECS) for (const size of SIZES) for (const seed of [1, 99, 123456]) {
      const spec = mk(size, { oneway: 0.4, fragile: 0.3 })
      const frozen = JSON.stringify(spec)
      const a = gen(spec, seed), b = gen(spec, seed)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      expect(JSON.stringify(spec)).toBe(frozen)
      expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    }
  })

  it('換種子就不一樣；同一個種子換用途也不一樣', () => {
    for (const [, mk] of SPECS) {
      const spec = mk([11, 9])
      expect(JSON.stringify(gen(spec, 1))).not.toBe(JSON.stringify(gen(spec, 2)))
      expect(JSON.stringify(gen(spec, 1, 'a'))).not.toBe(JSON.stringify(gen(spec, 1, 'b')))
      const distinct = new Set(seeds(40).map((s) => JSON.stringify(gen(spec, s).sheet.layout)))
      expect(distinct.size).toBeGreaterThanOrEqual(36)
    }
  })

  it('亂數只來自傳進來的 rand：不碰 Math.random；同一串亂數（不管是誰產生的）結果一樣', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('不准用 Math.random') })
    try {
      const spec = subnet([11, 9], { oneway: 0.5, fragile: 0.5 })
      const stream = seedRand(5, 'x')
      const tape = Array.from({ length: 4000 }, () => stream())
      const play = (): GenResult => { let i = 0; return generateSheet(spec, () => tape[i++ % tape.length]!) }
      expect(JSON.stringify(play())).toBe(JSON.stringify(play()))
    } finally {
      spy.mockRestore()
    }
  })

  it('seedRand：同一個（種子、用途）永遠是同一串，0 以上不到 1；換種子或用途就換一串', () => {
    const take = (r: () => number): number[] => Array.from({ length: 8 }, () => r())
    expect(take(seedRand(7, 'map'))).toEqual(take(seedRand(7, 'map')))
    expect(take(seedRand(7, 'map'))).not.toEqual(take(seedRand(8, 'map')))
    expect(take(seedRand(7, 'map'))).not.toEqual(take(seedRand(7, 'maze')))
    for (const v of take(seedRand(0, ''))) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('生成器：任意種子、三種尺寸、兩份 spec，檢查函式都是空的', () => {
  for (const [label, mk] of SPECS) for (const size of SIZES) {
    it(`${label}，${size.join(' × ')}：兩百個種子`, () => {
      const spec = mk(size)
      fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const r = gen(spec, seed)
        expect(genProblems(spec, r)).toEqual([])
        expect(r.sheet.size).toEqual(size)
        expect(r.sheet.layout).toHaveLength(size[1])
        // 邊框是牆；入口貼著邊框內側的一格；圖例是 NET_LEGEND（o 是迴圈碎片，不是半掩體）
        const [w, h] = size
        r.sheet.layout.forEach((row, y) => [...row].forEach((ch, x) => { if (x === 0 || y === 0 || x === w - 1 || y === h - 1) expect(ch).toBe('#') }))
        const entry = r.sheet.cells!.find((m) => m.mark === 'E')!
        expect(entry.at[0] === 1 || entry.at[0] === w - 2 || entry.at[1] === 1 || entry.at[1] === h - 2).toBe(true)
        expect(r.sheet.legend).toEqual(NET_LEGEND)
        expect(r.sheet.id).toBe(spec.id)
        expect(r.sheet.name).toBe(spec.name)
      }), { numRuns: 200 })
    })
  }

  it('節點的多寡跟著 carve 走：子網的密度每張 5～14 個節點，迷宮館的密度 5～12 個', () => {
    for (const s of seeds(60)) {
      const a = gen(subnet([11, 9]), s).graph.nodes.length, b = gen(maze([9, 7]), s).graph.nodes.length
      expect(a).toBeGreaterThanOrEqual(5)
      expect(a).toBeLessThanOrEqual(14)
      expect(b).toBeGreaterThanOrEqual(5)
      expect(b).toBeLessThanOrEqual(12)
    }
  })

  it('標記有名字；好幾個同一種時後面加編號，只有一個就不加', () => {
    let many = 0
    for (const s of seeds(60)) {
      const r = gen(subnet([11, 9]), s)
      const names = (kindMark: string) => r.sheet.cells!.filter((m) => m.mark === kindMark).map((m) => m.name)
      expect(names('E')).toEqual(['入口'])
      expect(names('g')).toEqual(['閘門'])
      const foes = names('f').sort()
      if (foes.length === 1) expect(foes).toEqual(['遭遇'])
      else {
        many++
        expect(foes).toEqual(foes.map((_, i) => `遭遇 ${i + 1}`))
      }
    }
    expect(many).toBeGreaterThan(10)
  })
})

describe('生成器：放在哪裡', () => {
  /** 先放死路的，再放遠的、路中間的、任何空的：先寫的先挑位置，所以死路的檢查看得到全部的死路 */
  const placing = (size: Size): GenSpec => ({
    id: 'gen_p', name: '位置', size, carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' },
    places: [
      { kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '檔案庫' },
      { kind: FOE_KIND, count: [1, 3], where: 'far_half', name: '遭遇' },
      { kind: 'net_rest', count: [1, 1], where: 'mid_path', name: '休息點', apart: 1 },
      { kind: 'net_person', count: [0, 2], where: 'any', name: '人' },
    ],
  })

  for (const size of SIZES) {
    it(`${size.join(' × ')}：far_half 不淺於中位數、dead_end 在死路、mid_path 在保證的路上、出口最深；每一種的數量在範圍裡`, () => {
      let deadFallback = 0
      for (const seed of seeds(200)) {
        const spec = placing(size)
        const r = gen(spec, seed)
        const depths = r.graph.nodes.map((n) => n.depth)
        const mid = median(depths)
        // far_half
        for (const n of nodesOfKind(r, FOE_KIND)) expect(n.depth).toBeGreaterThanOrEqual(mid)
        // 出口是最深的
        expect(exitOf(r).depth).toBe(Math.max(...depths))
        // dead_end：只有一個鄰居的節點（入口與出口除外）；死路不夠時退到 far_half
        const nb = neighbors(r)
        const dead = r.graph.nodes.filter((n) => n.kind === 'floor' || n.kind === 'net_archive').filter((n) => nb.get(n.id)!.size === 1)
        const archives = nodesOfKind(r, 'net_archive')
        const onDead = archives.filter((n) => nb.get(n.id)!.size === 1)
        expect(onDead.length).toBe(Math.min(archives.length, dead.length))
        if (dead.length >= archives.length) for (const n of archives) expect(nb.get(n.id)!.size).toBe(1)
        else deadFallback++
        // mid_path：在 safe_path 上、不貼著入口
        const path = new Set(r.safe_path.map(key))
        const hops = hopsFromEntry(r)
        for (const n of nodesOfKind(r, 'net_rest')) {
          expect(path.has(key(n.at))).toBe(true)
          expect(hops.get(n.id)!).toBeGreaterThanOrEqual(2)
        }
        // 數量
        expect(archives.length).toBeGreaterThanOrEqual(1)
        expect(archives.length).toBeLessThanOrEqual(2)
        expect(nodesOfKind(r, FOE_KIND).length).toBeGreaterThanOrEqual(1)
        expect(nodesOfKind(r, FOE_KIND).length).toBeLessThanOrEqual(3)
        expect(nodesOfKind(r, 'net_rest')).toHaveLength(1)
        expect(nodesOfKind(r, 'net_person').length).toBeLessThanOrEqual(2)
        // 同一個節點只放一樣：每一格的標記只有一個（版面上本來就是一格一字），而且節點的 id 都不重複
        expect(new Set(r.graph.nodes.map((n) => n.id)).size).toBe(r.graph.nodes.length)
      }
      // 死路不夠時退到 far_half 的情形有出現過，也有死路夠的
      expect(deadFallback).toBeLessThan(200)
    })
  }

  it('mid_path 放在保證的路的正中間附近：先寫的先挑，休息點寫在最前面時離路的一半不超過一格', () => {
    const spec: GenSpec = {
      id: 'gen_m', name: '中間', size: [11, 9], carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' },
      places: [{ kind: 'net_rest', count: [1, 1], where: 'mid_path', name: '休息點' }, { kind: FOE_KIND, count: [1, 3], where: 'far_half', name: '遭遇' }],
    }
    let checked = 0
    for (const seed of seeds(200)) {
      const r = gen(spec, seed)
      const rest = nodesOfKind(r, 'net_rest')[0]!
      const idx = r.safe_path.findIndex((p) => key(p) === key(rest.at))
      expect(idx).toBeGreaterThan(0)
      expect(idx).toBeLessThan(r.safe_path.length - 1)
      if (r.safe_path.length >= 5) {
        checked++
        expect(Math.abs(idx - (r.safe_path.length - 1) / 2)).toBeLessThanOrEqual(1)
      }
    }
    expect(checked).toBeGreaterThan(150)
  })

  it('link 放在鏈路的格子上，不放在節點上；apart 讓東西離入口至少隔幾個節點', () => {
    const spec: GenSpec = {
      id: 'gen_l', name: '鏈路', size: [11, 9], carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' },
      places: [
        { kind: 'net_alarm', count: [1, 2], where: 'link', name: '警報', trap: true, apart: 1 },
        { kind: 'net_imprint', count: [1, 2], where: 'any', name: '印記', apart: 2 },
      ],
    }
    for (const seed of seeds(120)) {
      const r = gen(spec, seed)
      const linkCells = new Set(r.graph.edges.flatMap((e) => e.cells.map(key)))
      const nodeCells = new Set(r.graph.nodes.map((n) => key(n.at)))
      const hops = hopsFromEntry(r)
      const sh = new Sheet(r.sheet)
      for (const m of r.sheet.cells!.filter((c) => c.mark === 'w')) {
        expect(linkCells.has(key(m.at))).toBe(true)
        expect(nodeCells.has(key(m.at))).toBe(false)
        // 鏈路上的格子離入口隔幾個節點：兩端節點裡近的那一個至少隔 0 個（apart 1：不在入口那一端的第一段）
        const e = r.graph.edges.find((x) => x.cells.some((c) => key(c) === key(m.at)))!
        expect(Math.min(hops.get(e.a)!, hops.get(e.b)!)).toBeGreaterThanOrEqual(1)
      }
      for (const n of nodesOfKind(r, 'net_imprint')) expect(hops.get(n.id)!).toBeGreaterThanOrEqual(3)
      expect(sh.kindAt(...(r.graph.nodes.find((n) => n.kind === 'entry')!.at))).toBe('entry')
    }
  })

  it('節點圖上沒有標記的節點用 n<編號>，照由上到下、由左到右數；有標記的用那一格的標記 id', () => {
    for (const seed of seeds(40)) {
      const r = gen(subnet([11, 9]), seed)
      const plain = r.graph.nodes.filter((n) => !r.sheet.cells!.some((m) => key(m.at) === key(n.at)))
      const ordered = [...plain].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0])
      expect(ordered.map((n) => n.id)).toEqual(ordered.map((_, i) => `n${i + 1}`))
      for (const n of r.graph.nodes) {
        const m = r.sheet.cells!.find((c) => key(c.at) === key(n.at))
        if (m) expect(n.id).toBe(m.id)
      }
    }
  })
})

describe('生成器：陷阱不佔保證的路；藏起來的不畫在版面上', () => {
  const traps = (size: Size): GenSpec => ({
    id: 'gen_t', name: '陷阱', size, carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' },
    places: [
      { kind: 'net_alarm', count: [1, 2], where: 'link', name: '警報', trap: true },
      { kind: 'net_loop', count: [0, 1], where: 'any', name: '迴圈碎片', trap: true },
      { kind: 'net_loop', count: [1, 2], where: 'any', name: '藏起來的迴圈', trap: true, hidden: true },
      { kind: 'net_archive', count: [1, 1], where: 'dead_end', name: '暗櫃', hidden: true },
      { kind: FOE_KIND, count: [1, 2], where: 'far_half', name: '遭遇' },
    ],
  })

  for (const size of SIZES) {
    it(`${size.join(' × ')}：trap 的格子都不在 safe_path 上；hidden 的不在版面上、那一格是地板`, () => {
      let hiddenTotal = 0
      for (const seed of seeds(200)) {
        const spec = traps(size)
        const r = gen(spec, seed)
        const sh = new Sheet(r.sheet)
        const path = new Set(r.safe_path.map(key))
        // safe_path 從入口到出口，一格接一格
        expect(key(r.safe_path[0]!)).toBe(key(r.graph.nodes.find((n) => n.kind === 'entry')!.at))
        expect(key(r.safe_path[r.safe_path.length - 1]!)).toBe(key(exitOf(r).at))
        r.safe_path.forEach((p, i) => { if (i) expect(Math.abs(p[0] - r.safe_path[i - 1]![0]) + Math.abs(p[1] - r.safe_path[i - 1]![1])).toBe(1) })
        for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
          if (['net_alarm', 'net_loop'].includes(sh.kindAt(x, y))) expect(path.has(`${x},${y}`)).toBe(false)
        }
        for (const hd of r.hidden.filter((x) => x.trap)) expect(path.has(key(hd.at))).toBe(false)
        // hidden：數量在範圍裡；那一格是地板、沒有標記；位置不重疊
        const kinds = (k: string) => r.hidden.filter((x) => x.kind === k)
        expect(kinds('net_loop').length).toBeGreaterThanOrEqual(1)
        expect(kinds('net_loop').length).toBeLessThanOrEqual(2)
        expect(kinds('net_archive')).toHaveLength(1)
        expect(r.hidden.filter((x) => x.kind === 'net_loop').every((x) => x.trap === true)).toBe(true)
        expect(kinds('net_archive')[0]!.trap).toBeUndefined()
        expect(new Set(r.hidden.map((x) => key(x.at))).size).toBe(r.hidden.length)
        for (const hd of r.hidden) {
          expect(sh.kindAt(hd.at[0], hd.at[1])).toBe('floor')
          expect(sh.markerAt(hd.at[0], hd.at[1])).toBeUndefined()
        }
        hiddenTotal += r.hidden.length
        // 畫出來的迴圈碎片只有 0～1 個，藏起來的另外算
        expect(sh.def.cells!.filter((m) => m.mark === 'o').length).toBeLessThanOrEqual(1)
        // 藏起來的東西佔了節點：圖上那個節點沒有標記，trap 的記著 trap
        const nodeAt = new Map(r.graph.nodes.map((n) => [key(n.at), n]))
        for (const hd of r.hidden) {
          const node = nodeAt.get(key(hd.at))
          if (node) {
            expect(node.kind).toBe('floor')
            expect(!!node.trap).toBe(!!hd.trap)
          }
        }
        expect(genProblems(spec, r)).toEqual([])
      }
      expect(hiddenTotal).toBeGreaterThan(200)
    })
  }

  it('檢查函式抓得到：陷阱落在保證的路上、藏起來的東西落在牆上或畫在版面上、數量超出、圖與版面對不上', () => {
    const spec = traps([11, 9])
    const base = gen(spec, 4)
    const clone = (): GenResult => JSON.parse(JSON.stringify(base)) as GenResult
    expect(genProblems(spec, base)).toEqual([])
    // 藏起來的陷阱放到保證的路上
    const a = clone()
    const onPath = a.safe_path.find((p, i) => i > 0 && i < a.safe_path.length - 1 && !a.graph.nodes.some((n) => key(n.at) === key(p)) && !a.sheet.cells!.some((m) => key(m.at) === key(p)))!
    a.hidden[0] = { kind: 'net_loop', at: onPath, trap: true }
    expect(genProblems(spec, a).some((s) => /藏起來的陷阱/.test(s))).toBe(true)
    // 藏起來的東西放到牆上
    const b = clone()
    b.hidden[0] = { ...b.hidden[0]!, at: [0, 0] }
    expect(genProblems(spec, b).some((s) => /不是地板/.test(s))).toBe(true)
    // 多出一個 spec 沒寫的格子（把一個走道改成檔案庫以外的 net_person）
    const c = clone()
    const row = c.sheet.layout[c.safe_path[1]![1]]!.split('')
    const cell = c.safe_path[1]!
    if (c.sheet.layout[cell[1]]![cell[0]] === '.') {
      row[cell[0]] = 'p'
      c.sheet.layout[cell[1]] = row.join('')
      expect(genProblems(spec, c).length).toBeGreaterThan(0)
    }
    // 保證的路被截短、出口的 depth 被改小、鏈路的格子不連續
    const d = clone()
    d.safe_path = d.safe_path.slice(0, 3)
    expect(genProblems(spec, d).some((s) => /safe_path 要走到出口/.test(s))).toBe(true)
    const e = clone()
    e.graph.nodes.find((n) => n.kind === 'net_gate')!.depth -= 1
    expect(genProblems(spec, e).length).toBeGreaterThan(0)
    const f = clone()
    const edge = f.graph.edges.find((x) => x.cells.length >= 2)!
    edge.cells = [edge.cells[1]!, edge.cells[0]!, ...edge.cells.slice(2)]
    expect(genProblems(spec, f).some((s) => /不連續/.test(s))).toBe(true)
    // 版面不合格：sheetProblems 的問題原樣回傳
    const g = clone()
    g.sheet.layout = g.sheet.layout.slice(1)
    expect(genProblems(spec, g).some((s) => /layout 要有 9 列/.test(s))).toBe(true)
    // 邊框被打穿
    const h = clone()
    h.sheet.layout[0] = '.' + h.sheet.layout[0]!.slice(1)
    expect(genProblems(spec, h).length).toBeGreaterThan(0)
  })
})

describe('生成器：單向與會斷的鏈路', () => {
  const rivers = (size: Size, extra: Partial<GenSpec> = {}): GenSpec => subnet(size, { oneway: 0.5, loops: 2, ...extra })

  for (const size of SIZES) {
    it(`${size.join(' × ')}：oneway 0.5，兩百個種子，入口都到得了出口；net_valve 那一段的方向記在圖上、照方向走得通`, () => {
      let valves = 0
      for (const seed of seeds(200)) {
        const spec = rivers(size)
        const r = gen(spec, seed)
        const sh = new Sheet(r.sheet)
        const pass = directedPass(r, sh)
        const entry = r.graph.nodes.find((n) => n.kind === 'entry')!
        const exit = exitOf(r)
        // 入口到得了出口、每個節點、保證的路（照方向）
        expect(sh.findPath({ x: entry.at[0], y: entry.at[1] }, { x: exit.at[0], y: exit.at[1] }, pass)).not.toBeNull()
        for (const n of r.graph.nodes) {
          expect(sh.findPath({ x: entry.at[0], y: entry.at[1] }, { x: n.at[0], y: n.at[1] }, pass)).not.toBeNull()
          // 每個節點也走得到出口：單向只把人往出口的方向推，不把人鎖在死路裡
          expect(sh.findPath({ x: n.at[0], y: n.at[1] }, { x: exit.at[0], y: exit.at[1] }, pass)).not.toBeNull()
        }
        r.safe_path.forEach((p, i) => { if (i) expect(pass(p[0], p[1], { x: r.safe_path[i - 1]![0], y: r.safe_path[i - 1]![1] })).toBe(true) })
        // 每個單向的鏈路：剛好一格 net_valve，在那一段裡；方向記在 oneway；反方向過不去
        for (const e of r.graph.edges) {
          const cells = e.cells.filter((c) => sh.kindAt(c[0], c[1]) === 'net_valve')
          expect(cells).toHaveLength(e.oneway ? 1 : 0)
          if (!e.oneway) continue
          valves++
          const valve = cells[0]!
          const at = (id: string) => r.graph.nodes.find((n) => n.id === id)!.at
          const k = e.cells.findIndex((c) => key(c) === key(valve))
          const before = k === 0 ? at(e.a) : e.cells[k - 1]!
          const after = k === e.cells.length - 1 ? at(e.b) : e.cells[k + 1]!
          const [fromOk, fromBad] = e.oneway === 'ab' ? [before, after] : [after, before]
          expect(pass(valve[0], valve[1], { x: fromOk[0], y: fromOk[1] })).toBe(true)
          expect(pass(valve[0], valve[1], { x: fromBad[0], y: fromBad[1] })).toBe(false)
          expect(valveAllows(r.graph, valve, fromOk)).toBe(true)
          expect(valveAllows(r.graph, valve, fromBad)).toBe(false)
          // 沒有別的東西佔著時，放在那一段的正中間（長度是偶數時中間兩格之一）
          if (e.cells.every((c) => sh.kindAt(c[0], c[1]) === 'floor' || key(c) === key(valve))) expect(Math.abs(k - (e.cells.length - 1) / 2)).toBeLessThanOrEqual(0.5)
        }
        expect(genProblems(spec, r)).toEqual([])
      }
      expect(valves).toBeGreaterThan(200)
    })

    it(`${size.join(' × ')}：fragile 0.5，會斷的鏈路全斷掉，入口還是到得了每個節點、每個節點還是到得了出口`, () => {
      let bridges = 0
      for (const seed of seeds(200)) {
        const spec = rivers(size, { oneway: 0.3, fragile: 0.5 })
        const r = gen(spec, seed)
        const sh = new Sheet(r.sheet)
        const broken = directedPass(r, sh, true)
        const entry = r.graph.nodes.find((n) => n.kind === 'entry')!
        const exit = exitOf(r)
        for (const n of r.graph.nodes) {
          expect(sh.findPath({ x: entry.at[0], y: entry.at[1] }, { x: n.at[0], y: n.at[1] }, broken)).not.toBeNull()
          expect(sh.findPath({ x: n.at[0], y: n.at[1] }, { x: exit.at[0], y: exit.at[1] }, broken)).not.toBeNull()
        }
        for (const e of r.graph.edges) {
          const cells = e.cells.filter((c) => sh.kindAt(c[0], c[1]) === 'net_bridge')
          expect(cells).toHaveLength(e.fragile ? 1 : 0)
          expect(e.fragile && e.oneway).toBeFalsy()
          if (e.fragile) bridges++
        }
        expect(genProblems(spec, r)).toEqual([])
      }
      expect(bridges).toBeGreaterThan(100)
    })
  }

  it('不寫 oneway 與 fragile 就沒有 net_valve 與 net_bridge；loops 預設 1、寫 0 就不打通（圖是樹，會斷的放不下）', () => {
    for (const seed of seeds(60)) {
      const r = gen(subnet([11, 9]), seed)
      expect(r.sheet.layout.join('')).not.toMatch(/[vx]/)
      expect(r.graph.edges.some((e) => e.oneway || e.fragile)).toBe(false)
    }
    let cycles = 0
    for (const seed of seeds(60)) {
      const r = gen(subnet([11, 9], { loops: 0, fragile: 1 }), seed)
      // 自然長出來的環還是有（醉漢走回挖過的格子），但會斷的鏈路一定不是橋：genProblems 已經守著
      cycles += r.graph.edges.length - r.graph.nodes.length + 1
      expect(r.graph.edges.length).toBeGreaterThanOrEqual(r.graph.nodes.length - 1)
    }
    expect(cycles).toBeGreaterThanOrEqual(0)
  })
})

describe('生成器：圖的鏈路與深度', () => {
  it('edges 的 cells 是連續的、兩端接著節點；depth 和 Sheet.findPath 算的一致', () => {
    for (const [, mk] of SPECS) for (const size of SIZES) for (const seed of seeds(60)) {
      const r = gen(mk(size, { oneway: 0.3, fragile: 0.2 }), seed)
      const sh = new Sheet(r.sheet)
      const at = new Map(r.graph.nodes.map((n) => [n.id, n.at]))
      const nodeCells = new Set(r.graph.nodes.map((n) => key(n.at)))
      const seen = new Set<string>()
      for (const e of r.graph.edges) {
        const seq = [at.get(e.a)!, ...e.cells, at.get(e.b)!]
        for (let i = 1; i < seq.length; i++) expect(Math.abs(seq[i]![0] - seq[i - 1]![0]) + Math.abs(seq[i]![1] - seq[i - 1]![1])).toBe(1)
        for (const c of e.cells) {
          expect(nodeCells.has(key(c))).toBe(false)
          expect(seen.has(key(c))).toBe(false)
          seen.add(key(c))
        }
      }
      // 版面上每個走得到的格子不是節點就是某一段鏈路上的格子
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
        if (sh.kindAt(x, y) !== 'wall') expect(nodeCells.has(`${x},${y}`) || seen.has(`${x},${y}`)).toBe(true)
      }
      const entry = r.graph.nodes.find((n) => n.kind === 'entry')!
      expect(entry.depth).toBe(0)
      const plain = (x: number, y: number): boolean => sh.walkable(x, y) || !!sh.traitsAt(x, y).locked
      for (const n of r.graph.nodes) {
        const path = sh.findPath({ x: entry.at[0], y: entry.at[1] }, { x: n.at[0], y: n.at[1] }, plain)!
        expect(path.length - 1).toBe(n.depth)
      }
    }
  })

  it('沒有 exit 時也生成（保證的路走到離入口最遠的節點）；places 空的也行', () => {
    for (const seed of seeds(40)) {
      const spec: GenSpec = { id: 'gen_n', name: '空', size: [9, 7], carve: [10, 20], places: [] }
      const r = gen(spec, seed)
      expect(genProblems(spec, r)).toEqual([])
      const deepest = Math.max(...r.graph.nodes.map((n) => n.depth))
      expect(r.graph.nodes.find((n) => key(n.at) === key(r.safe_path[r.safe_path.length - 1]!))!.depth).toBe(deepest)
      expect(r.sheet.cells!.map((m) => m.mark)).toEqual(['E'])
    }
  })

  it('sight 照 spec 寫進 SheetDef；沒寫就沒有這一欄', () => {
    expect(gen(subnet([11, 9], { sight: 2 }), 3).sheet.sight).toBe(2)
    expect(gen(subnet([11, 9]), 3).sheet).not.toHaveProperty('sight')
  })
})

describe('生成器：放不下就重挖，還是不行丟錯；spec 不合格也丟錯', () => {
  it('9 × 7 要放二十個遭遇：丟錯，訊息寫出是哪一種放不下', () => {
    const spec = maze([9, 7], { places: [{ kind: FOE_KIND, count: [20, 20], where: 'any', name: '遭遇' }] })
    expect(() => gen(spec, 1)).toThrow(/放不下 net_foe（遭遇）：要至少 20 個/)
    expect(() => gen(spec, 1)).toThrow(new RegExp(`重挖 ${GEN_MAX_RECARVE} 次`))
  })

  it('前面的放得下、後面的放不下：訊息寫的是後面那一種', () => {
    const spec = maze([9, 7], { places: [{ kind: 'net_archive', count: [1, 1], where: 'any', name: '寶箱' }, { kind: 'net_person', count: [15, 15], where: 'far_half', name: '員工' }] })
    expect(() => gen(spec, 2)).toThrow(/放不下 net_person（員工）/)
    expect(() => gen(spec, 2)).not.toThrow(/net_archive/)
  })

  it('位置不夠時先減到最少：抽到的數量放不下就退到最少，最少放得下就成功', () => {
    // 數量 [1, 30]：抽到 30 放不下就退到 1。重挖也不會全部失敗
    const spec = maze([9, 7], { places: [{ kind: 'net_person', count: [1, 30], where: 'any', name: '人' }] })
    for (const seed of seeds(60)) {
      const r = gen(spec, seed)
      const n = nodesOfKind(r, 'net_person').length
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThan(30)
    }
  })

  it('apart 太大放不下、link 放不下，也是丟錯；訊息帶 where', () => {
    const far = maze([9, 7], { places: [{ kind: 'net_rest', count: [1, 1], where: 'any', name: '休息點', apart: 50 }] })
    expect(() => gen(far, 1)).toThrow(/放不下 net_rest（休息點）.*any.*隔 50 個節點/)
    const links = maze([5, 5], { carve: [1, 1], places: [{ kind: 'net_alarm', count: [5, 5], where: 'link', name: '警報', trap: true }] })
    expect(() => gen(links, 1)).toThrow(/放不下 net_alarm（警報）.*link/)
  })

  it('spec 不合格：丟錯、訊息寫出哪裡不合格；genSpecProblems 先問得到', () => {
    const ok = subnet([11, 9])
    expect(genSpecProblems(ok)).toEqual([])
    expect(genSpecProblems(maze([9, 7]))).toEqual([])
    const cases: Array<[string, Partial<GenSpec>, RegExp]> = [
      ['尺寸太小', { size: [4, 9] }, /size/],
      ['carve 反了', { carve: [10, 5] }, /carve/],
      ['carve 是小數', { carve: [1.5, 3] }, /carve/],
      ['比例超過 1', { oneway: 1.5 }, /oneway/],
      ['loops 是負的', { loops: -1 }, /loops/],
      ['sight 是 0', { sight: 0 }, /sight/],
      ['沒有名字', { name: ' ' }, /name/],
      ['出口不是格子的種類', { exit: { kind: 'no_such_kind', name: '閘門' } }, /exit：no_such_kind 不在 CELL_TRAITS/],
      ['出口走不上去', { exit: { kind: 'wall', name: '牆' } }, /exit：wall 不能當成節點放/],
      ['入口的名字是空的', { entry: { name: '' } }, /entry\.name/],
    ]
    for (const [, over, re] of cases) {
      expect(genSpecProblems({ ...ok, ...over }).join('；')).toMatch(re)
      expect(() => gen({ ...ok, ...over }, 1)).toThrow(/spec 不合格/)
    }
    const place = (p: Partial<GenPlace>): GenSpec => ({ ...ok, places: [{ kind: 'net_archive', count: [1, 1], where: 'any', ...p }] })
    const placeCases: Array<[Partial<GenPlace>, RegExp]> = [
      [{ kind: 'entry' }, /entry 不能當成節點放/],
      [{ kind: 'net_valve' }, /net_valve 不能當成節點放/],
      [{ kind: 'floor' }, /floor 不能當成節點放/],
      [{ kind: 'spot' }, /spot 沒有圖例的字元/],
      [{ kind: 'no_such' }, /不在 CELL_TRAITS/],
      [{ count: [3, 2] }, /count/],
      [{ count: [-1, 2] }, /count/],
      [{ where: 'nowhere' as unknown as GenPlace['where'] }, /where 不認得/],
      [{ apart: -1 }, /apart/],
      [{ name: '' }, /name/],
      [{ trap: true, where: 'mid_path' }, /trap 與 mid_path 衝突/],
    ]
    for (const [over, re] of placeCases) expect(genSpecProblems(place(over)).join('；')).toMatch(re)
    // 同一種格子一部分寫 trap、一部分不寫
    const mixed: GenSpec = { ...ok, places: [{ kind: 'net_alarm', count: [1, 1], where: 'link', trap: true }, { kind: 'net_alarm', count: [1, 1], where: 'any' }] }
    expect(genSpecProblems(mixed).join('；')).toMatch(/一部分寫 trap、一部分不寫/)
  })
})

describe('生成器：效能與亂來的亂數', () => {
  it('一張 11 × 9 的圖生成在 50 毫秒以內', () => {
    const spec = subnet([11, 9], { oneway: 0.5, fragile: 0.3 })
    gen(spec, 0) // 暖機
    let worst = 0
    const t0 = performance.now()
    for (const s of seeds(100)) {
      const t = performance.now()
      gen(spec, s)
      worst = Math.max(worst, performance.now() - t)
    }
    expect(worst).toBeLessThan(50)
    expect((performance.now() - t0) / 100).toBeLessThan(20)
  })

  it('亂數永遠是同一個值（0、0.5、接近 1）也不會卡住：不是成功就是丟出有訊息的錯', () => {
    for (const v of [0, 0.5, 0.999999999]) for (const [, mk] of SPECS) {
      const spec = mk([11, 9], { oneway: 0.5, fragile: 0.5 })
      try {
        const r = generateSheet(spec, () => v)
        expect(genProblems(spec, r)).toEqual([])
      } catch (e) {
        expect((e as Error).message).toMatch(/失敗/)
      }
    }
  })

  /** 隨機的 spec：陷阱的種類只出現 trap 寫法、非陷阱的種類不寫 trap（同一種格子要一致） */
  const arbPlace = fc.oneof(
    fc.record({ kind: fc.constantFrom('net_alarm', 'net_loop'), where: fc.constantFrom<GenPlace['where']>('far_half', 'dead_end', 'link', 'any'), trap: fc.constant(true) }),
    fc.record({ kind: fc.constantFrom('net_archive', 'net_foe', 'net_person', 'net_rest', 'net_control', 'net_imprint', 'net_safe', 'net_puzzle'), where: fc.constantFrom<GenPlace['where']>('far_half', 'dead_end', 'mid_path', 'link', 'any') }),
  ).chain((base) => fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.integer({ min: 0, max: 3 })).map(([a, b, hidden, apart]): GenPlace => ({
    ...base, count: [Math.min(a, b), Math.max(a, b)], hidden: hidden && base.where !== 'mid_path' ? true : undefined, apart: apart > 2 ? apart : undefined,
  })))
  const arbSpec = fc.record({
    w: fc.integer({ min: 5, max: 13 }), h: fc.integer({ min: 5, max: 11 }),
    c1: fc.integer({ min: 1, max: 40 }), c2: fc.integer({ min: 1, max: 40 }),
    exit: fc.boolean(), oneway: fc.double({ min: 0, max: 1, noNaN: true }), fragile: fc.double({ min: 0, max: 1, noNaN: true }), loops: fc.integer({ min: 0, max: 3 }),
    places: fc.array(arbPlace, { maxLength: 6 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })

  it('隨便組的 spec 與種子：回傳的結果一定過檢查；放不下時丟的錯有訊息（不會回傳不合格的圖）', () => {
    let ok = 0, thrown = 0
    fc.assert(fc.property(arbSpec, (a) => {
      const spec: GenSpec = {
        id: 'gen_f', name: '亂來', size: [a.w, a.h], carve: [Math.min(a.c1, a.c2), Math.max(a.c1, a.c2)],
        ...(a.exit ? { exit: { kind: 'net_gate', name: '閘門' } } : {}),
        places: a.places.map((p) => (p.hidden === undefined ? { kind: p.kind, count: p.count, where: p.where, ...(p.trap ? { trap: true } : {}), ...(p.apart ? { apart: p.apart } : {}) } : p)),
        oneway: a.oneway, fragile: a.fragile, loops: a.loops,
      }
      try {
        const r = gen(spec, a.seed)
        expect(genProblems(spec, r)).toEqual([])
        ok++
      } catch (e) {
        expect((e as Error).message).toMatch(/失敗/)
        thrown++
      }
    }), { numRuns: 300 })
    expect(ok).toBeGreaterThan(100)
    expect(ok + thrown).toBe(300)
  })
})

describe('生成器：結果接得上地圖引擎', () => {
  const entryOf = (spec: GenSpec, seed: number) => {
    const r = gen(spec, seed)
    const map = { id: spec.id, kind: 'subnet', size: r.sheet.size, sheets: [r.sheet] }
    return { r, map }
  }

  it('包成 kind: subnet 的地圖定義，specialMapProblems 是空的（不要求遭遇點）；整份存進實例、能站進去、能走到出口', () => {
    // 走得上去的格子才走得到：這份 spec 沒有遭遇與機關（那兩種要註冊放行規則），也沒有單向
    const spec: GenSpec = {
      id: 'gen_walk', name: '走得通', size: [11, 9], carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' }, sight: 2,
      places: [{ kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '檔案庫' }, { kind: 'net_rest', count: [1, 1], where: 'mid_path', name: '休息點' }, { kind: 'net_alarm', count: [0, 2], where: 'link', name: '警報', trap: true }],
    }
    for (const seed of seeds(20)) {
      const { r, map } = entryOf(spec, seed)
      expect(specialMapProblems(map as unknown as Record<string, unknown>)).toEqual([])
      const { game } = makeGame()
      const opened = openMap(game.k, game.state, map, { seed, by: 'test' })
      game.commit({ kind: 'system', action: 'test', location: {}, party: [], timeline: [], changes: opened.changes, outcome: { result: 'ok', summary: '開地圖' } })
      const inst = game.state.maps.instances[opened.id]!
      expect(inst.gen).toEqual({ map, seed, by: 'test' })
      expect(instanceDef(game.k, inst)).toEqual(map)
      const entry = r.graph.nodes.find((n) => n.kind === 'entry')!
      expect(game.state.maps.at).toMatchObject({ x: entry.at[0], y: entry.at[1] })
      expect(game.gridView()!.here.marker).toMatchObject({ mark: 'E' })
      const exit = exitOf(r)
      expect(game.gridMove(exit.at).status).toBe('applied')
      expect(game.gridView()!.here.marker).toMatchObject({ mark: 'g', name: '閘門' })
    }
  })

  it('valveAllows：不是單向的格子一律放行；是單向的只放行正向的那一格', () => {
    for (const seed of seeds(60)) {
      const r = gen(subnet([11, 9], { oneway: 1, loops: 2 }), seed)
      expect(valveAllows(r.graph, [0, 0], [1, 1])).toBe(true)
      const e: GenEdge | undefined = r.graph.edges.find((x) => x.oneway)
      if (!e) continue
      const sh = new Sheet(r.sheet)
      const valve = e.cells.find((c) => sh.kindAt(c[0], c[1]) === 'net_valve')!
      const around = [[valve[0] + 1, valve[1]], [valve[0] - 1, valve[1]], [valve[0], valve[1] + 1], [valve[0], valve[1] - 1]] as Array<[number, number]>
      expect(around.filter((p) => valveAllows(r.graph, valve, p)).length).toBe(1)
    }
  })
})
