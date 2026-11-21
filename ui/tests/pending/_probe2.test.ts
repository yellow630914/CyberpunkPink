import { beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from '../../src/stores/engine'
import { useGame } from '../../src/stores/game'
import { useSaves } from '../../src/stores/saves'
import { packBundle } from '../../src/lib/engineSave'
const mem = new Map<string, string>()
;(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => mem.delete(k) }
beforeEach(() => { mem.clear(); setActivePinia(createPinia()) })
it('probe load', () => {
  const s = useSaves(); const g = useGame(); const e = useEngine()
  const p = s.pack('手動')
  const b = JSON.parse(p.raw)
  g.advance(60)
  const before = JSON.stringify(e.state)
  for (const bad of [-1, 'x', 99999]) {
    const b2 = { ...b, legacy: { ...b.legacy, money: { acc: bad, cash: 3700, fav: 2 } } }
    let r: unknown
    try { r = s.loadRaw(JSON.stringify(b2)) } catch (x) { r = 'THROW ' + String(x) }
    console.log(bad, r, e.state.time, e.money, e.state.reports.length, e.canUndo, JSON.stringify(e.state) === before)
  }
})
