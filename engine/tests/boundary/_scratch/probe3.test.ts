import { it } from 'vitest'
import { effectCtx } from '../../../src'
import { makeCityGame } from '../../../src/testkit'

it('probe zero', () => {
  const { game: g } = makeCityGame()
  const t = (fx: any[], source: any = 'ai', extra: any = {}) => { const r = g.k.effects.resolve(fx, effectCtx(g.k, g.state, { source, ...extra })); return JSON.stringify({ e: r.errors, ch: r.changes, l: r.lines, cl: r.clamps.map((c: any) => [c.from, c.to]) }) }
  console.log('zero', t([{ kind: 'favor', key: 'f_gang', amount: 0 }]))
  console.log('str', t([{ kind: 'favor', key: 'f_gang', amount: '5' }]))
  console.log('max', t([{ kind: 'favor', key: 'f_gang', amount: Number.MAX_SAFE_INTEGER, asked: '全部' }], 'player', { clampAsked: false, playerInput: '全部給我' }))
  console.log('max+1', t([{ kind: 'favor', key: 'f_gang', amount: Number.MAX_SAFE_INTEGER + 2, asked: '全部' }], 'player', { clampAsked: false, playerInput: '全部給我' }))
  console.log('insight max x2', t([{ kind: 'insight', amount: Number.MAX_SAFE_INTEGER, asked: '全部' }, { kind: 'insight', amount: Number.MAX_SAFE_INTEGER, asked: '全部' }], 'player', { clampAsked: false, playerInput: '全部給我' }))
  console.log('proto', t([{ kind: 'favor', key: '__proto__', amount: 1 }]))
  console.log('fame other district', t([{ kind: 'fame', key: 'tw_rust', amount: 9 }]))
  console.log('fame bad district', t([{ kind: 'fame', key: 'nowhere', amount: 1 }]))
  console.log('rep key x', t([{ kind: 'rep', key: 'x', amount: 1 }]))
  console.log('alert bad map', t([{ kind: 'alert', key: 'm999', amount: 1 }]))
})
