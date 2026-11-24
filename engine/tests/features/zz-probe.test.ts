import { it } from 'vitest'
import { makeBattleGame, netAvatar } from '../../src/testkit'
import { enemiesFeature } from '../../src/features/enemies'
import { deckFeature } from '../../src/features/deck'
import { TEST_NET_COMBAT } from '../../src/testkit'
import { raw } from '../helpers/battle'
import { PACK } from './M3-lace.test'
import { writeFileSync } from 'node:fs'
it('probe', () => {
  const grade = 1
  const setup = { mode: 'net', grade, cover: 'medium', allies: [0,1,2,3].map((i) => raw(netAvatar(i, grade))), foes: [{ from: 'enemy', id: 'en_gate' }, { from: 'enemy', id: 'en_gate' }], origin: {} } as never
  const t = makeBattleGame({ features: [enemiesFeature, deckFeature, TEST_NET_COMBAT], content: [PACK], seed: 9 + grade, battle: setup })
  let log = ''
  for (let i = 0; i < 400 && !t.game.battle?.result; i++) {
    const b = t.game.battle!
    log += `${i} r${b.round} turn ${b.order[b.turn]} ${JSON.stringify(Object.values(b.units).map((u) => [u.id, u.load?.now, u.pools.ram?.now, u.ap.now, u.out]))}\n`
    writeFileSync('/tmp/claude-0/-home-user-CyberpunkPink/59ded358-0440-5225-ba4d-18b6cdad343b/scratchpad/probe.log', log)
    t.game.battleNext({ anyone: true })
  }
})
