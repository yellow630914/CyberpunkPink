// 白箱測試：features/netrun/patrol.ts（巡邏：路線、來回走、相鄰判斷）。全是純函式，用手寫的小圖與生成器產的圖。
// 規格：CYBERSPACE 8.1 節「節點」表的巡邏、「巡邏可以躲」；dev/adr/0018 N6、N24。
// 補主套件沒有走到的分支：圖太小挑不出路線、起點離入口不到 2 步時退而求其次、從隊伍的位置挑最遠的起點、路線長度的下限、打贏的巡邏不再動、擦身而過的記號在下一步清掉。

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { generateSheet, seedRand } from '../../src'
import type { GenResult } from '../../src'
import type { NetExt, Patrol } from '../../src/features/netrun/model'
import { DEFAULT_RULES } from '../../src/features/netrun/model'
import { adjacency, hopsFrom, makePatrol, moverChanges, nearPatrols, nextPatrolId, nodePos, patrolAt, patrolRanks, pickRoute, pingpong, stepPatrols } from '../../src/features/netrun/patrol'

type Graph = GenResult['graph']
const node = (id: string, x: number, kind = 'floor', depth = 0) => ({ id, at: [x, 1] as [number, number], kind, depth })
const edge = (a: string, b: string) => ({ a, b, cells: [] as Array<[number, number]> })
/** 入口 E — n1 — n2 — n3 — n4 排成一條線。 */
const LINE: Graph = { nodes: [node('E', 1, 'entry'), node('n1', 2), node('n2', 3), node('n3', 4), node('n4', 5)], edges: [edge('E', 'n1'), edge('n1', 'n2'), edge('n2', 'n3'), edge('n3', 'n4')] }
const rand = (seq: number[]) => { let i = 0; return () => seq[i++ % seq.length]! }

describe('白箱 patrol：來回走（pingpong）與鄰居表', () => {
  it('路線長 1 以下永遠在 0；長 3：0 1 2 1 0 1 2…；負的步數也照週期；週期是 2×(長−1)', () => {
    expect([0, 1, 5].map((s) => pingpong(s, 1))).toEqual([0, 0, 0])
    expect([0, 1, 2].map((s) => pingpong(s, 0))).toEqual([0, 0, 0])
    expect(Array.from({ length: 9 }, (_, s) => pingpong(s, 3))).toEqual([0, 1, 2, 1, 0, 1, 2, 1, 0])
    expect([-1, -2, -3, -4].map((s) => pingpong(s, 3))).toEqual([1, 2, 1, 0])
    fc.assert(fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: -200, max: 200 }), (len, step) => {
      const p = pingpong(step, len)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(len)
      expect(pingpong(step + 2 * (len - 1), len)).toBe(p)
      expect(Math.abs(pingpong(step + 1, len) - p)).toBe(1)
    }), { numRuns: 100 })
  })

  it('adjacency：鏈路不分單向，兩邊都記，同一對不重複；沒有鏈路的節點是空的；hopsFrom：節點圖上的步數，走不到的不在表裡', () => {
    const g: Graph = { nodes: [node('a', 1), node('b', 2), node('c', 3), node('z', 9)], edges: [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), { ...edge('c', 'b'), oneway: 'ab' }] }
    const adj = adjacency(g)
    expect(adj.get('a')).toEqual(['b'])
    expect(adj.get('b')).toEqual(['a', 'c'])
    expect(adj.get('z')).toEqual([])
    expect([...hopsFrom(g, 'a')]).toEqual([['a', 0], ['b', 1], ['c', 2]])
    expect(hopsFrom(g, 'z').size).toBe(1)
  })
})

describe('白箱 patrol：挑路線（pickRoute）', () => {
  it('圖上只有入口：挑不出（null）；入口以外只有一個節點（離入口 1 步）：退到「所有非入口的節點」當起點，路線只有 1 個節點時比下限短、也算挑不出夠長的，回傳 null', () => {
    const only: Graph = { nodes: [node('E', 1, 'entry')], edges: [] }
    expect(pickRoute(only, rand([0]), [3, 5])).toBeNull()
    const two: Graph = { nodes: [node('E', 1, 'entry'), node('n1', 2)], edges: [edge('E', 'n1')] }
    expect(pickRoute(two, rand([0]), [3, 5])).toBeNull()
  })

  it('起點離入口至少 2 步：線形的圖上起點只會是 n2、n3、n4；路線是簡單路徑、不經過入口、長度在範圍內', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = rand(Array.from({ length: 50 }, (_, i) => ((seed + 1) * (i + 3) * 0.6180339) % 1))
      const route = pickRoute(LINE, r, [3, 4])!
      expect(route).not.toBeNull()
      expect(['n2', 'n3', 'n4']).toContain(route[0])
      expect(new Set(route).size).toBe(route.length)
      expect(route).not.toContain('E')
      expect(route.length).toBeGreaterThanOrEqual(3)
      expect(route.length).toBeLessThanOrEqual(4)
      for (let i = 1; i < route.length; i++) expect(adjacency(LINE).get(route[i - 1]!)).toContain(route[i])
    }
  })

  it('挑不出夠長的退而求其次：想要 5 個節點但圖只有 3 個非入口的連著 → 回傳最長的那條（至少 2 個）；兩個都挑不到就是 null', () => {
    const short: Graph = { nodes: [node('E', 1, 'entry'), node('n1', 2), node('n2', 3), node('n3', 4)], edges: [edge('E', 'n1'), edge('n1', 'n2'), edge('n2', 'n3')] }
    const route = pickRoute(short, rand([0]), [5, 6])
    expect(route === null || (route.length >= 2 && route.length < 5)).toBe(true)
    const split: Graph = { nodes: [node('E', 1, 'entry'), node('n1', 2), node('n2', 3), node('n3', 4)], edges: [edge('E', 'n1')] }
    expect(pickRoute(split, rand([0]), [3, 4])).toBeNull()
  })

  it('給了隊伍現在的節點：起點挑離它最遠的前三個之一（追蹤度到 30 時多出來的那一隊離人遠遠的）；離 n2 的步數是 n4 2、n3 1、n2 0（n1 離入口只有 1 步，不在起點的候選裡）', () => {
    const start = (v: number) => pickRoute(LINE, rand([v]), [2, 3], 'n2')![0]
    expect([start(0), start(0.5), start(0.99)]).toEqual(['n4', 'n3', 'n2'])
  })

  it('性質：生成器產的圖，路線一律是簡單路徑、不含入口、相鄰的節點在圖上真的相連、長度在 patrol_route 的範圍內（或退而求其次的 ≥ 2）', () => {
    const spec = { id: 'p', name: 'p', size: [11, 9] as [number, number], carve: [30, 40] as [number, number], exit: { kind: 'net_gate', name: '閘門' }, places: [{ kind: 'net_archive', count: [1, 2] as [number, number], where: 'dead_end' as const, name: '檔案庫' }] }
    fc.assert(fc.property(fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 0, max: 10_000 }), (seed, rs) => {
      let r: GenResult
      try { r = generateSheet(spec, seedRand(seed, 'patrol')) } catch { return }
      const route = pickRoute(r.graph, seedRand(rs, 'route'), DEFAULT_RULES.patrol_route)
      if (!route) return
      const adj = adjacency(r.graph)
      const entry = r.graph.nodes.find((n) => n.kind === 'entry')!.id
      expect(route).not.toContain(entry)
      expect(new Set(route).size).toBe(route.length)
      expect(route.length).toBeGreaterThanOrEqual(2)
      expect(route.length).toBeLessThanOrEqual(DEFAULT_RULES.patrol_route[1])
      for (let i = 1; i < route.length; i++) expect(adj.get(route[i - 1]!)).toContain(route[i])
    }), { numRuns: 40 })
  })
})

describe('白箱 patrol：生成、走動與位置', () => {
  const fx = {} as never
  it('makePatrol：路線挑不出是 null；挑得出：起點在路線第 0 個、step 0、敵人是 enemy_pick 的單位來源（種子逐隻不同、帶顏色與層名）；沒寫勢力是 none 且不帶 faction 欄位', () => {
    expect(makePatrol({ id: 'pt1', sheet: 'l1', graph: { nodes: [node('E', 1, 'entry')], edges: [] }, rand: rand([0]), grade: 1, fx, layerName: '員工層', rules: DEFAULT_RULES, seed: 's' })).toBeNull()
    const p = makePatrol({ id: 'pt1', sheet: 'l1', graph: LINE, rand: rand([0.1, 0.9, 0.3]), grade: 2, fx, color: 'pink', layerName: '員工層', rules: DEFAULT_RULES, seed: 's' })!
    expect(p).toMatchObject({ id: 'pt1', sheet: 'l1', step: 0 })
    expect(p.at).toBe(p.route[0])
    expect(p).not.toHaveProperty('faction')
    expect(p.foes.length).toBeGreaterThanOrEqual(1)
    p.foes.forEach((f, n) => expect(f).toMatchObject({ from: 'enemy_pick', faction: 'none', grade: 2, color: 'pink', layer: '員工層', seed: `s/${n}` }))
    const q = makePatrol({ id: 'pt2', sheet: 'l1', graph: LINE, rand: rand([0.2]), grade: 1, fx, faction: 'f_a', layerName: 'x', rules: DEFAULT_RULES, seed: 't' })!
    expect(q.faction).toBe('f_a')
    expect(q.foes.every((f) => (f as unknown as { faction: string }).faction === 'f_a')).toBe(true)
  })

  it('patrolRanks：規則表 patrol 的每一組（一個精英或兩個雜兵）都挑得到；表是空的退成兩個雜兵；連動的 minus／half 照 encounterAfter 減', () => {
    expect(patrolRanks(DEFAULT_RULES, rand([0]), fx)).toEqual(['elite'])
    expect(patrolRanks(DEFAULT_RULES, rand([0.99]), fx)).toEqual(['minion', 'minion'])
    expect(patrolRanks({ ...DEFAULT_RULES, patrol: [] }, rand([0.5]), fx)).toEqual(['minion', 'minion'])
    expect(patrolRanks({ ...DEFAULT_RULES, patrol: [['minion', 'minion', 'minion', 'minion']] }, rand([0]), { half: true } as never)).toHaveLength(2)
  })

  const patrol = (o: Partial<Patrol> = {}): Patrol => ({ id: 'pt1', sheet: 'l1', route: ['n1', 'n2', 'n3'], foes: [], at: 'n1', step: 0, ...o })
  const net = (patrols: Patrol[]): NetExt => ({ graph: { l1: LINE, l2: LINE }, patrols } as never)

  it('stepPatrols：只動這一層、還活著的；每走一步清掉擦身而過的記號；打贏的（gone）不動；回傳有動的', () => {
    const a = patrol({ calm: true } as never)
    const b = patrol({ id: 'pt2', sheet: 'l2' })
    const c = patrol({ id: 'pt3', gone: true })
    const n = net([a, b, c])
    const moved = stepPatrols(n, 'l1')
    expect(moved.map((p) => p.id)).toEqual(['pt1'])
    expect(a).toMatchObject({ step: 1, at: 'n2' })
    expect(a).not.toHaveProperty('calm')
    expect(b.step).toBe(0)
    expect(c.step).toBe(0)
    stepPatrols(n, 'l1')
    stepPatrols(n, 'l1')
    expect(a.at).toBe('n2') // 來回：n1 n2 n3 n2
    expect(patrolAt(a)).toBe('n2')
    expect(patrolAt({ route: ['n1', 'n2', 'n3'], step: 2 })).toBe('n3')
  })

  it('nodePos：圖上有的回傳格子、沒有的 undefined；moverChanges：每一層一筆 map.sheet、打贏的帶 gone、不在圖上的巡邏略過', () => {
    const n = net([])
    expect(nodePos(n, 'l1', 'n2')).toEqual([3, 1])
    expect(nodePos(n, 'l1', 'zz')).toBeUndefined()
    expect(nodePos(n, 'nope', 'n2')).toBeUndefined()
    const out = moverChanges({ map: 'm1' }, n, [patrol(), patrol({ id: 'pt2', sheet: 'l2', at: 'n3', step: 2, gone: true }), patrol({ id: 'pt3', at: 'zz' })]) as unknown as Array<{ sheet: string; movers: Record<string, unknown> }>
    expect(out.map((c) => c.sheet)).toEqual(['l1', 'l2'])
    expect(out[0]!.movers).toEqual({ pt1: { at: [2, 1], leg: 0 } })
    expect(out[1]!.movers).toEqual({ pt2: { at: [4, 1], leg: 2, gone: true } })
  })

  it('nearPatrols：同一個節點或相鄰的節點算近、打贏的不算、別層的不算、這一層沒有圖是空的；nextPatrolId：打贏的也算一個，編號不重複', () => {
    const a = patrol({ at: 'n2' })
    const n = net([a, patrol({ id: 'pt2', at: 'n2', gone: true }), patrol({ id: 'pt3', sheet: 'l2', at: 'n2' })])
    expect(nearPatrols(n, 'l1', 'n2').map((p) => p.id)).toEqual(['pt1'])
    expect(nearPatrols(n, 'l1', 'n1').map((p) => p.id)).toEqual(['pt1'])
    expect(nearPatrols(n, 'l1', 'n4')).toEqual([])
    expect(nearPatrols(n, 'nope', 'n2')).toEqual([])
    expect(nextPatrolId(n)).toBe('pt4')
    expect(nextPatrolId(net([]))).toBe('pt1')
  })
})
