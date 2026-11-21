import { beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEngine } from '../../src/stores/engine'
import { useGame } from '../../src/stores/game'

const DRAFT = {
  name: '露', gender: 'female', age: 22, origin: 'hive', originChoice: { favor: '孤星連' },
  attrPick: { reflex: 15, charm: 14, intellect: 13, body: 12, resolve: 10, tech: 8 },
  attrBonus: { tech: -4, reflex: 3, resolve: 3 },
  skills: { streetwise: 3, negotiate: 3, perform: 2, stealth: 2 },
  perks: ['smooth_talker', 'tough'],
}
beforeEach(() => setActivePinia(createPinia()))

it('probe game', async () => {
  const g = useGame()
  const e = useEngine()
  console.log('init', e.state.time, e.money, e.canUndo, e.log.length)
  const ser = g.serialize()
  console.log('ser money', JSON.stringify(ser.money), 'day' in ser)
  try { g.money.cash = -5 } catch (err) { console.log('neg throws', String(err)) }
  console.log('after neg', e.money)
  e.setAi({ useAi: false })
  e.newGame({ seed: 7 }); e.createCharacter(DRAFT)
  await e.act({ kind: 'free', text: 'x' })
  for (let i = 0; i < 5; i++) g.money.cash -= 10
  console.log('undo', e.canUndo, e.money); e.undo(); console.log('after 1 undo', e.money, e.log.length); for(let i=0;i<5;i++) e.undo(); console.log('after 6 undos', e.money, e.log.length, e.canUndo)
  const s = g.takeSnapshot('入口', '入口')
  g.advance(120); g.money.cash -= 100
  console.log('before rb', e.state.time, e.money)
  g.rollback(s.id)
  console.log('after rb', e.state.time, e.money, e.log[0].prose)
})

it('probe busy', async () => {
  const e = useEngine()
  e.setAi({ useAi: true })
  e.newGame({ seed: 7 }); e.createCharacter(DRAFT)
  const p1 = e.act({ kind: 'free', text: 'a' })
  console.log('busy1', e.busy)
  const p2 = e.act({ kind: 'free', text: 'b' })
  const r2 = await p2.catch((x) => 'ERR ' + String(x))
  console.log('r2', r2, 'busy after p2', e.busy)
  const r1 = await p1
  console.log('r1', r1, e.busy)
  try { await e.retryStep('nope') } catch (x) { console.log('retry err', String(x)) }
})
