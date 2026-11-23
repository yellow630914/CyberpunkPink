import { it } from 'vitest'
import { effectCtx, meterOf } from '../../../src'
import { makeCityGame, makeWorldGame } from '../../../src/testkit'

it('probe', () => {
  const { game: g } = makeCityGame()
  const s = g.state
  console.log('loc', JSON.stringify(s.location), 'at', JSON.stringify(s.maps.at), 'pc', s.pc)
  console.log('kinds', g.k.meters.kinds().map((d: any) => `${d.kind}:${JSON.stringify(d.cap)}:${d.min}..${d.max}`).join(' | '))
  const tryFx = (fx: any[], source: any, extra: any = {}) => {
    const r = g.k.effects.resolve(fx, effectCtx(g.k, g.state, { source, ...extra }))
    return JSON.stringify({ e: r.errors, ch: r.changes, cl: r.clamps.map((c: any) => [c.from, c.to, c.notice]) })
  }
  console.log('insight ai 30', tryFx([{ kind: 'insight', amount: 30 }], 'ai'))
  console.log('alert ai 5 in city', tryFx([{ kind: 'alert', amount: 5 }], 'ai'))
  console.log('favor nokey', tryFx([{ kind: 'favor', amount: 3 }], 'ai'))
  console.log('favor bad id', tryFx([{ kind: 'favor', key: 'f_nobody', amount: 3 }], 'ai'))
  console.log('floor ai', tryFx([{ kind: 'hostility_floor', key: 'f_gang', amount: 5 }], 'ai'))
  console.log('hostility player off asked', tryFx([{ kind: 'hostility', key: 'f_gang', amount: 90, asked: '狠狠' }], 'player', { clampAsked: false, playerInput: '我要狠狠惹他們' }))
  console.log('hostility player off noasked', tryFx([{ kind: 'hostility', key: 'f_gang', amount: 90 }], 'player', { clampAsked: false, playerInput: '我要狠狠惹他們' }))
  console.log('loyalty npc not member', tryFx([{ kind: 'loyalty', key: 'npc_tw_friend', amount: 5 }], 'ai'))
  console.log('affinity', tryFx([{ kind: 'affinity', key: 'npc_tw_friend', amount: 50 }], 'ai'))
  console.log('rep', tryFx([{ kind: 'rep', amount: 50 }], 'ai'))
  console.log('fame', tryFx([{ kind: 'fame', amount: 50 }], 'ai'))
  console.log('effects kinds', g.k.effects.kinds().join(','))
})
