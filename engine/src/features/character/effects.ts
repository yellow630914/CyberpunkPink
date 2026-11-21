// L6 角色：三條軌的效果 hp、load、sink（EVENTS 2.4 節）。落在 ctx.actor 身上，轉成核心的 actor.track 變更。

import type { Change, Effect, EffectCtx, EffectDef, Kernel } from '../../core'
import { OWNER } from './stats'

type TrackEffect = Effect & { amount: number }

const isNonZeroInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v !== 0

interface TrackSpec {
  kind: 'hp' | 'load' | 'sink'
  /** AI 自己給的時候的上限。回傳夾過的 amount（不用夾就回傳原值）與提醒 */
  limit(e: TrackEffect, ctx: EffectCtx, k: Kernel): { to: number; limit: number; notice: string }
  /** 轉成變更時的上下限：回傳實際要加減的量 */
  delta(amount: number, ctx: EffectCtx, k: Kernel): number
  describe(amount: number): string
}

const current = (ctx: EffectCtx, kind: TrackSpec['kind']): number => ctx.state.actors[ctx.actor]?.[kind] ?? 0

const SPECS: TrackSpec[] = [
  {
    kind: 'hp',
    // 不會讓人倒下：扣完最少剩 1；原本就只剩 1 以下時不能再扣
    limit: (e, ctx) => {
      const hp = current(ctx, 'hp')
      if (e.amount >= 0) return { to: e.amount, limit: 1, notice: '' }
      const to = Math.max(e.amount, Math.min(0, 1 - hp))
      return { to, limit: 1, notice: to === 0 ? '你已經只剩一口氣了，這一下不會再傷到你。' : '這一下本來會讓你倒下，實際只剩一口氣。' }
    },
    delta: (amount, ctx, k) => {
      const hp = current(ctx, 'hp')
      if (amount < 0) return -Math.min(-amount, hp)
      return Math.min(amount, Math.max(0, k.stats.stat(ctx.state, ctx.actor, 'max_hp') - hp))
    },
    describe: (n) => (n < 0 ? '生命：受了一點傷' : '生命：恢復了一些'),
  },
  {
    kind: 'load',
    // 不會讓人過載：加完最多到上限 − 1
    limit: (e, ctx, k) => {
      const room = Math.max(0, k.stats.stat(ctx.state, ctx.actor, 'load_cap') - 1 - current(ctx, 'load'))
      const to = e.amount > 0 ? Math.min(e.amount, room) : e.amount
      return { to, limit: current(ctx, 'load') + room, notice: to === 0 ? '你的感載已經繃到極限，這一下沒有再往上加。' : '這一下本來會讓你過載，實際只推到快撐不住的邊緣。' }
    },
    delta: (amount, ctx) => (amount < 0 ? -Math.min(-amount, current(ctx, 'load')) : amount),
    describe: (n) => (n > 0 ? '感載：往上衝了一截' : '感載：緩了下來'),
  },
  {
    kind: 'sink',
    limit: (e) => {
      const to = Math.max(-3, Math.min(3, e.amount))
      return { to, limit: 3, notice: to > 0 ? '一次只會往下陷一點點，實際沒有那麼多。' : '一次只能往回拉一點點，實際沒有那麼多。' }
    },
    delta: (amount, ctx) => (amount < 0 ? -Math.min(-amount, current(ctx, 'sink')) : amount),
    describe: (n) => (n > 0 ? '沉溺：往下陷了一點' : '沉溺：往回拉一點'),
  },
]

function toDef(spec: TrackSpec, k: Kernel): EffectDef<TrackEffect> {
  return {
    kind: spec.kind, owner: OWNER,
    validate: (raw) => (isNonZeroInt(raw.amount) ? [] : ['amount 要是不為 0 的整數']),
    clamp: (e, ctx) => {
      const r = spec.limit(e, ctx, k)
      if (r.to === e.amount) return { effect: e }
      return { effect: r.to === 0 ? null : { ...e, amount: r.to }, note: { from: e.amount, to: r.to, limit: r.limit, notice: r.notice } }
    },
    toChanges: (e, ctx): Change[] => {
      const delta = spec.delta(e.amount, ctx, k)
      return delta === 0 ? [] : [{ op: 'actor.track', id: ctx.actor, track: spec.kind, delta }]
    },
    describe: (e) => spec.describe(e.amount),
  }
}

export function installEffects(k: Kernel): void {
  for (const spec of SPECS) k.effects.register(toDef(spec, k))
}
