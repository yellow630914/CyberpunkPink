import { describe, expect, it } from 'vitest'
import { makeBodyGame, applyEffects, passTime, standAt } from '../../src/testkit'
import { rentDraft, sleepDraft } from '../../src/features/rest'
import { eventView, chooseOption } from '../../src/features/director'
import { lureView } from '../../src/features/lure'

describe('scratch', () => {
  it('lure', () => {
    const t = makeBodyGame({ pc: { skills: { composure: 3 }, ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 } } }, at: { block: 'tw_tower', marker: 'E1' } })
    const g = t.game
    g.commit(rentDraft(g.k, g.state, 'r_tw_unit'))
    standAt(g, 'tw_tower', 'F1')
    g.commit({ kind: 'system', action: 'test.sink', location: {}, party: [], timeline: [], changes: [{ op: 'actor.track', id: 'pc', track: 'sink', delta: 66 } as never], outcome: { result: 'ok', summary: 't' } })
    console.log('sink', g.state.actors.pc!.sink)
    const r = g.commit(sleepDraft(g.k, g.state))
    console.log(r.map((x) => x.action + ':' + x.outcome.summary + ':' + JSON.stringify(x.triggers ?? [])))
    const ev = eventView(g.k, g.state)
    console.log(JSON.stringify(ev)?.slice(0, 600))
    console.log(JSON.stringify(lureView(g.k, g.state)).slice(0, 600))
    expect(true).toBe(true)
  })
})
