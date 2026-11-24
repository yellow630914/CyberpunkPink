import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from '../../src/stores/engine'
import { DEMO_NET_OFFER } from '../../src/data/demo/commission'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: 'lonestar' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
describe('probe', () => {
  it('demo dive', async () => {
    setActivePinia(createPinia())
    const e = useEngine()
    expect(e.newGame({ seed: 11, draft: DRAFT as never })).toEqual([])
    const shop = e.state.reports.length
    const k = (e as any)
    const blk = e.world.entry<any>('shop', 'divepod')!
    expect((await e.world.arrive(blk.block, blk.facility)).status).toBe('applied')
    console.log(JSON.stringify(e.world.grid()!.here.uses))
    console.log(JSON.stringify(e.dive.options()))
    const r = await e.dive.enter()
    console.log(r)
    console.log(JSON.stringify(e.dive.view()))
    console.log(JSON.stringify(e.maze.brackets()))
    const g = await e.dive.go('site_dig_lonestar')
    console.log(g, JSON.stringify(e.net.view()?.dig), e.net.view()?.layer)
    console.log(await e.net.logout())
    console.log(JSON.stringify(e.dive.lastEnd()), JSON.stringify(e.dive.kept('dig_lonestar_1')))
    const m = await e.maze.enter('rookie')
    console.log(m, JSON.stringify(e.maze.view()))
  })
})
