import { it } from 'vitest'
import { makeBattleGame, playOut, netAvatar } from '../../src/testkit'
import { enemiesFeature } from '../../src/features/enemies'
import { deckFeature } from '../../src/features/deck'
import { TEST_NET_COMBAT } from '../../src/testkit'
import { raw } from '../helpers/battle'
import { PACK } from './M3-lace.test'
it('probe', () => {
  for (const grade of [1, 3, 5] as const) {
    const setup = { mode: 'net', grade, cover: 'medium', allies: [0,1,2,3].map((i) => raw(netAvatar(i, grade))), foes: [{ from: 'enemy', id: 'en_gate' }, { from: 'enemy', id: 'en_gate' }], origin: {} } as never
    const t = makeBattleGame({ features: [enemiesFeature, deckFeature, TEST_NET_COMBAT], content: [PACK], seed: 9 + grade, battle: setup })
    const t0 = Date.now()
    try { const r = playOut(t.game, 3000); console.log(grade, r, Date.now() - t0) } catch (e) { console.log(grade, 'ERR', (e as Error).message, Date.now() - t0) }
  }
})
