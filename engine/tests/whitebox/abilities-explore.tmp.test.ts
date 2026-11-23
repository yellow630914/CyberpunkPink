import { describe, expect, it } from 'vitest'
import type { ContentPack, Kernel } from '../../src'
import { advance, beginTurn, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const STATUSES = [...TEST_STATUSES, { id: 'guarded', name: '戒備', desc: '到他的下一回合開始。', until: 'own_turn_start', turns: 1, kind: 'buff' }]
const pack: ContentPack = { id: 'x', content: { battle_status: STATUSES } } as unknown as ContentPack
const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const
const gun = () => ({ ...testWeapon('pistol', 10), mag: { now: 5, max: 5 } })

describe('explore', () => {
  it('lost turn', () => {
    const a = arena(duel([one({ weapons: [gun()], wield: 0, ap: { now: 9, max: 9, regen: 3 } } as never)], [foe('minion', { hp: { now: 300, max: 300 } } as never)], { ally: [1, 0, 0, 0], foe: [0, 0, 0, 0] }), [combatFeature, abilitiesFeature], (k: Kernel) => {
      k.content.loadPack(pack)
      readyFeatures(k)
    })
    const run = a.run(Array(200).fill(1))
    const me = a.ally(1)
    run.effects([{ op: 'ward', slot: 'target', do: [{ op: 'attack' }] }], { user: me, target: { side: 'foe', slot: 1 }, source: SRC })
    run.effects([{ op: 'buff', id: 'b', mods: [{ kind: 'hit', value: 1 }], until: 'own_turn_start', turns: 1 }], { user: me, target: { unit: me.id }, source: SRC })
    run.effects([{ op: 'cover_temp', levels: 1 }], { user: me, target: { unit: me.id }, source: SRC })
    run.applyStatus(me, 'guarded', { by: me })
    run.applyStatus(me, 'frozen', { by: a.foe(1) })
    me.watch = { action: 'watch' }
    console.log('before', JSON.stringify(me.ext.abilities), a.battle.cover.ally[0], me.statuses.map((s) => s.id))
    const ok = beginTurn(run, me)
    console.log('after', ok, JSON.stringify(me.ext.abilities), a.battle.cover.ally[0], me.statuses.map((s) => s.id), me.watch)
    expect(ok).toBe(false)
  })
})
