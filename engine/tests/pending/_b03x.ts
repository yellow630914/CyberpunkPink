// B034～B038 共用（cpp-tester-boundary）：讀重現的 fixture、照路建效果的情境。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EffectCtx } from '../../src'
import { effectCtx } from '../../src'
import type { makeCityGame } from '../../src/testkit'

export type G = ReturnType<typeof makeCityGame>['game']
export type Route = 'builtin' | 'ai' | 'on' | 'off'

export const fixture = <T = Record<string, unknown>>(id: string): T & { player_input?: string } =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', `${id}.json`), 'utf8'))

export const ctxOf = (g: G, route: Route, playerInput = ''): EffectCtx =>
  route === 'builtin' || route === 'ai' ? effectCtx(g.k, g.state, { source: route }) : effectCtx(g.k, g.state, { source: 'player', clampAsked: route === 'on', playerInput })
