import { it } from 'vitest'
import { generateSheet, seedRand } from '../../src'
import { layerSpec, regionOf } from '../../src/features/netrun'
import { DEFAULT_REGION } from '../../src/features/maze/model'
import { makeGame } from '../../src/testkit'

it('probe', () => {
  const { game: g } = makeGame({ seed: 1 })
  for (const carve of [[18, 24], [14, 18], [12, 16], [10, 14], [8, 12]] as const) {
    for (const loops of [undefined, 0, 1]) {
      const reg = { ...DEFAULT_REGION, carve, ...(loops !== undefined ? { loops } : {}) }
      const found = regionOf(g.k, reg)
      if ('problem' in found) throw new Error(found.problem)
      const counts: number[] = []
      let fail = 0
      for (let seed = 1; seed <= 300; seed++) {
        try {
          const spec = layerSpec(found.region, found.region.layer, 'l1', 'x', false, false)
          const res = generateSheet(spec, seedRand(seed, 'p'))
          counts.push(res.graph.nodes.length)
        } catch { fail++ }
      }
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length
      const hist: Record<number, number> = {}
      for (const c of counts) hist[c] = (hist[c] ?? 0) + 1
      console.log(`carve ${carve} loops ${loops}: avg ${avg.toFixed(2)} min ${Math.min(...counts)} max ${Math.max(...counts)} fail ${fail} hist ${JSON.stringify(hist)}`)
    }
  }
})
