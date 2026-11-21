// L6 角色：條件 wounded 與 track（EVENTS 2.2 節）。看誰：ctx.actor ?? ctx.state.pc。

import type { Condition, ConditionCtx, Kernel } from '../../core'
import { isWounded, OWNER } from './stats'

const TRACKS = ['hp', 'load', 'sink', 'afterglow'] as const
type Track = (typeof TRACKS)[number]

const whose = (ctx: ConditionCtx) => ctx.actor ?? ctx.state.pc

export function installConditions(k: Kernel): void {
  k.conditions.register({
    kind: 'wounded', owner: OWNER,
    validate: () => [],
    test: (_c, ctx) => {
      const id = whose(ctx)
      return !!id && isWounded(ctx.stats, ctx.state, id)
    },
  })

  k.conditions.register<Condition & { track: Track; min?: number; max?: number }>({
    kind: 'track', owner: OWNER,
    validate: (raw) => [
      ...((TRACKS as readonly unknown[]).includes(raw.track) ? [] : [`track 要是 ${TRACKS.join('、')} 其中一個`]),
      ...(['min', 'max'] as const).filter((f) => raw[f] !== undefined && typeof raw[f] !== 'number').map((f) => `${f} 要是數字`),
    ],
    test: (c, ctx) => {
      const id = whose(ctx)
      const a = id ? ctx.state.actors[id] : undefined
      if (!a) return false
      const v = a[c.track]
      return (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)
    },
  })
}
