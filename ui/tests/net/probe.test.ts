import { it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { netBattleView } from '@engine/src/features/netcombat'
import { useEngine } from '../../src/stores/engine'
it('probe', () => {
  setActivePinia(createPinia())
  const e = useEngine()
  e.newGame({ seed: 7 })
  e.startBattle(BATTLE_SETUPS.net())
  const o = e.battleOptions()!
  console.log(JSON.stringify({ cur: o.current, w: o.waiting, acts: o.actions.map(a => [a.id, a.group, a.icon, a.ok, a.cost, a.blocks, a.name]) }, null, 0))
  console.log(JSON.stringify(e.battleMode()))
  const g = (e as any)
  console.log(Object.keys(g).filter(k => /game|kernel/.test(k)))
  console.log(JSON.stringify(Object.values(e.battle!.units).map(u => [u.id, u.name, u.tags, u.ext])).slice(0, 1500))
})
