import { it } from 'vitest'
import { generateSheet, genProblems, seedRand, GEN_MAX_RECARVE } from '../../src'
import type { GenSpec } from '../../src'

const subnet = (size: [number, number], extra: Partial<GenSpec> = {}): GenSpec => ({
  id: 'g_sub', name: '測試子網', size, carve: [30, 40], exit: { kind: 'net_gate', name: '閘門' },
  places: [
    { kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '檔案庫' },
    { kind: 'net_rest', count: [1, 1], where: 'mid_path', name: '休息點', apart: 1 },
    { kind: 'net_foe', count: [1, 3], where: 'far_half', name: '遭遇' },
    { kind: 'net_alarm', count: [0, 1], where: 'link', name: '警報', trap: true },
    { kind: 'net_loop', count: [0, 1], where: 'any', name: '迴圈碎片', trap: true },
  ], ...extra,
})
const maze = (size: [number, number], extra: Partial<GenSpec> = {}): GenSpec => ({
  id: 'g_maze', name: '測試迷宮', size, carve: [18, 24], exit: { kind: 'net_gate', name: '出口' },
  places: [
    { kind: 'net_archive', count: [1, 2], where: 'dead_end', name: '寶箱' },
    { kind: 'net_puzzle', count: [1, 1], where: 'any', name: '機關' },
    { kind: 'net_foe', count: [2, 2], where: 'far_half', name: '遭遇' },
    { kind: 'net_alarm', count: [0, 1], where: 'any', name: '陷阱', trap: true },
  ], ...extra,
})

it('stats', () => {
  for (const [label, mk] of [['subnet', subnet], ['maze', maze]] as const) for (const size of [[9, 7], [11, 9], [13, 9]] as Array<[number, number]>) {
    let cyc = 0, hasCyc = 0, fails = 0, nodes = 0, edges = 0, valves = 0, bridges = 0, tot = 0
    const t0 = performance.now()
    const msgs = new Map<string, number>()
    for (let seed = 0; seed < 300; seed++) {
      const spec = mk(size, { oneway: 0.5, fragile: 0.3 })
      try {
        const r = generateSheet(spec, seedRand(seed, 'x'))
        nodes += r.graph.nodes.length; edges += r.graph.edges.length
        valves += r.graph.edges.filter((e) => e.oneway).length; cyc += r.graph.edges.length - r.graph.nodes.length + 1; hasCyc += r.graph.edges.length - r.graph.nodes.length + 1 > 0 ? 1 : 0
        bridges += r.graph.edges.filter((e) => e.fragile).length
        tot++
        if (genProblems(spec, r).length) fails++
      } catch (e) { fails++; const m = String((e as Error).message).slice(0, 120); msgs.set(m, (msgs.get(m) ?? 0) + 1) }
    }
    console.log(label, size.join('x'), 'fails', fails, 'avg nodes', (nodes / tot).toFixed(1), 'edges', (edges / tot).toFixed(1), 'valves', (valves / tot).toFixed(2), 'bridges', (bridges / tot).toFixed(2), 'cyc', (cyc / tot).toFixed(2), 'hasCyc', (hasCyc / tot).toFixed(2), 'ms/gen', ((performance.now() - t0) / 300).toFixed(2), [...msgs])
  }
})
it('print one', () => {
  const r = generateSheet(subnet([11, 9], { oneway: 0.5, fragile: 0.3 }), seedRand(5, 'x'))
  console.log(r.sheet.layout.join('\n'))
  console.log(JSON.stringify(r.graph.nodes.map((n) => `${n.id}:${n.kind}:${n.depth}`)))
  console.log(JSON.stringify(r.graph.edges.map((e) => `${e.a}-${e.b}:${e.cells.length}${e.oneway ?? ''}${e.fragile ? 'F' : ''}`)))
})
