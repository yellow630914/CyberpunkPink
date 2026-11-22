import { it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { BATTLE_SETUPS } from '@engine/src/testkit'
import { useEngine } from './stores/engine'
it('x', () => {
  setActivePinia(createPinia())
  const e = useEngine(); e.newGame({ seed: 7 }); e.startBattle(BATTLE_SETUPS.encounter())
  const seen: Record<string, unknown> = {}
  for (let i = 0; i < 400 && e.battleOptions()!.waiting !== 'over'; i++) {
    const o = e.battleOptions()!
    const r = o.waiting === 'ai' ? e.battleNext() : e.battleAct({ action: 'shoot', target: o.actions.find(a=>a.id==='shoot')!.targets[0]?.target })
    const r2 = r.status === 'refused' ? e.battleNext({ anyone: true }) : r
    for (const rep of r2.reports) for (const b of rep.timeline) if (b.tag && !seen[b.tag]) seen[b.tag] = { text: b.text, data: b.data, actor: b.actor }
  }
  console.log(JSON.stringify(seen, null, 1))
  console.log(JSON.stringify(e.battleOptions()!.actions.map(a=>[a.id,a.group,a.target,a.ok])), JSON.stringify(e.battle!.units.a2?.quick), JSON.stringify(e.battle!.result))
})
