import { describe, expect, it } from 'vitest'
import { makeWorldGame, partyUnit, enemyUnit } from '../../src/testkit'
import { raw, one, foe } from '../helpers/battle'

describe('explore', () => {
  it('net opts', () => {
    const g = makeWorldGame({ noGear: true }).game
    g.startBattle({ mode: 'net', grade: 1, cover: 'medium', allies: [raw(one({ hp: undefined }))], foes: [raw(foe('minion', { hp: undefined }))] } as never)
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1'); b.units.a1!.ap.now = b.units.a1!.ap.max
    const o = g.battleOptions()!
    console.log(o.actions.map((a) => a.id), o.waiting)
  })
})
