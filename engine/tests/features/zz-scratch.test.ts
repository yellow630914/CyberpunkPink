import { describe, expect, it } from 'vitest'
import { createKernel, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import { hackFeature } from '../../src/features/hack'
import { netcombatFeature } from '../../src/features/netcombat'
import { summonsFeature } from '../../src/features/summons'
import { NET_TREES, netPack } from '../fixtures/skills'

describe('scratch', () => {
  for (const [name, tree] of Object.entries(NET_TREES)) {
    it(`載入 ${name}`, () => {
      const k = createKernel([combatFeature, deckFeature, netcombatFeature, hackFeature, summonsFeature, abilitiesFeature])
      try {
        k.content.loadPack(netPack([tree]) as never)
        readyFeatures(k)
      } catch (e) {
        throw new Error(String((e as Error).message).slice(0, 4000))
      }
      expect(tree.abilities.length).toBe(27)
    })
  }
})
