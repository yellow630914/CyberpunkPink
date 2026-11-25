// L6 角色：三條軌與餘韻的效果 hp、load、sink、afterglow（EVENTS 2.4 節；AI_TASKS 2.5 節）。落在 ctx.actor 身上，轉成核心的 actor.track 變更。
//
// 夾哪幾條看 ctx.level（核心算好的）與 ctx.combat（事件標了 combat 就不受「不會讓人倒下或瀕死」限制）：
//
// | 效果 | 內建（builtin） | 只擋格式的底線（floor） | 照上限（cap） |
// |---|---|---|---|
// | hp 扣 | 照寫的算（可以到 0） | 戰鬥外最少剩 1 | 戰鬥外最少剩 1 |
// | load 加 | 照寫的算 | 照寫的算 | 加完最多到感載上限 − 1 |
// | afterglow 加 | 最多疊到承受層數 | 最多疊到承受層數 | 一件事最多 +1 層，加完最多到承受層數 − 1 |
// | sink | 照寫的算 | 照寫的算 | 一件事合計 ±3 |
//
// 已經在邊界上時整筆拿掉並提醒。往回走的那一邊（補血不超過上限、其餘不低於 0）不論哪一級都照實際能動的量算，不另外提醒。
// ctx.state 是「這一批前面幾筆都套上去之後」的狀態，所以拆成幾筆給，結果和合成一筆一樣。

import type { Change, ClampNote, Effect, EffectBudget, EffectDef, EffectStepCtx, Kernel } from '../../core'
import { isSafeInt } from '../../core'
import { OWNER } from './stats'

type TrackEffect = Effect & { amount: number }
type TrackKind = 'hp' | 'load' | 'sink' | 'afterglow'
type Bound = { to: number; limit?: number; notice?: string }

interface TrackSpec {
  kind: TrackKind
  /** 一件事合計的上限（只在照上限夾的時候有） */
  budget?(e: TrackEffect, ctx: EffectStepCtx): Pick<EffectBudget, 'min' | 'max' | 'notice'> | null
  /** 照當下的狀態，這一筆實際可以是多少；有 notice 就是被夾了要提醒，沒有就是照實際能動的量、不提醒 */
  bound(amount: number, ctx: EffectStepCtx, k: Kernel): Bound
  describe(amount: number): string
}

const current = (ctx: EffectStepCtx, kind: TrackKind): number => ctx.state.actors[ctx.actor]?.[kind] ?? 0
/** 這一筆要不要受「不會讓人倒下或瀕死」限制 */
const guarded = (ctx: EffectStepCtx, levels: Array<EffectStepCtx['level']>): boolean => !ctx.combat && levels.includes(ctx.level)
/** 往回走的量不超過現在有的 */
const notBelowZero = (amount: number, now: number): Bound => ({ to: Math.max(amount, -now) })

const SPECS: TrackSpec[] = [
  {
    kind: 'hp',
    bound: (amount, ctx, k) => {
      const hp = current(ctx, 'hp')
      if (amount > 0) return { to: Math.min(amount, Math.max(0, k.stats.stat(ctx.state, ctx.actor, 'max_hp') - hp)) }
      // 格式的底線：AI 交出的結果在戰鬥外不會讓人倒下，扣完最少剩 1；原本就只剩 1 以下時不能再扣（設定關著也照擋）
      if (!guarded(ctx, ['floor', 'cap'])) return notBelowZero(amount, hp)
      const to = Math.max(amount, Math.min(0, 1 - hp))
      return to === amount ? { to } : { to, limit: 1, notice: to === 0 ? '你已經只剩一口氣了，這一下不會再傷到你。' : '這一下本來會讓你倒下，實際只剩一口氣。' }
    },
    describe: (n) => (n < 0 ? '生命：受了一點傷' : '生命：恢復了一些'),
  },
  {
    kind: 'load',
    bound: (amount, ctx, k) => {
      const load = current(ctx, 'load')
      if (amount < 0) return notBelowZero(amount, load)
      // 不會讓人過載：加完最多到上限 − 1
      if (!guarded(ctx, ['cap'])) return { to: amount }
      const room = Math.max(0, k.stats.stat(ctx.state, ctx.actor, 'load_cap') - 1 - load)
      const to = Math.min(amount, room)
      return to === amount ? { to } : { to, limit: load + room, notice: to === 0 ? '你的感載已經繃到極限，這一下沒有再往上加。' : '這一下本來會讓你過載，實際只推到快撐不住的邊緣。' }
    },
    describe: (n) => (n > 0 ? '感載：往上衝了一截' : '感載：緩了下來'),
  },
  {
    kind: 'sink',
    budget: (e, ctx) => (ctx.level !== 'cap' ? null : {
      min: -3, max: 3,
      notice: (to) => (to === 0 ? (e.amount > 0 ? '這一次已經往下陷得夠多了，這一筆沒有再算。' : '這一次已經往回拉得夠多了，這一筆沒有再算。') : e.amount > 0 ? '一次只會往下陷一點點，實際沒有那麼多。' : '一次只能往回拉一點點，實際沒有那麼多。'),
    }),
    // 往下降（amount < 0）不低於 sink_floor（身上的義體讓你浮不上來）：max(amount, 下限 − 現在)；已經在下限上（或比它低）的整筆拿掉並提醒。
    // 下限是 0（沒有人加）時就是不低於 0，和以前一樣、不提醒；只降到一半被下限擋住的照實際能動的量算、不另外提醒
    bound: (amount, ctx, k) => {
      if (amount >= 0) return { to: amount }
      const now = current(ctx, 'sink')
      const floor = k.stats.stat(ctx.state, ctx.actor, 'sink_floor')
      if (floor <= 0) return notBelowZero(amount, now)
      const to = Math.min(0, Math.max(amount, floor - now))
      return to === 0 ? { to, limit: floor, notice: '身上的義體讓你浮不上來，這一筆沒有算。' } : { to }
    },
    describe: (n) => (n > 0 ? '沉溺：往下陷了一點' : '沉溺：往回拉一點'),
  },
  {
    kind: 'afterglow',
    // AI 給的一件事最多 +1 層
    budget: (_e, ctx) => (!guarded(ctx, ['cap']) ? null : {
      min: -Infinity, max: 1,
      notice: (to) => (to === 0 ? '餘韻一次最多疊一層，這一筆沒有再往上疊。' : '餘韻一次最多疊一層，實際只多了一層。'),
    }),
    bound: (amount, ctx, k) => {
      const now = current(ctx, 'afterglow')
      if (amount < 0) return notBelowZero(amount, now)
      const cap = k.stats.stat(ctx.state, ctx.actor, 'afterglow_cap')
      // 內建的可以疊滿，但不會超過承受層數
      if (!guarded(ctx, ['cap'])) return { to: Math.min(amount, Math.max(0, cap - now)) }
      // 不能疊滿：加完最多到上限 − 1
      const room = Math.max(0, cap - 1 - now)
      const to = Math.min(amount, room)
      return to === amount ? { to } : { to, limit: now + room, notice: to === 0 ? '你身上的餘韻已經快疊滿了，這一下沒有再往上疊。' : '這一下本來會讓餘韻疊滿，實際只疊到快滿的地方。' }
    },
    describe: (n) => (n > 0 ? '餘韻：又疊了一層上去' : '餘韻：退了下來'),
  },
]

function toDef(spec: TrackSpec, k: Kernel): EffectDef<TrackEffect> {
  return {
    kind: spec.kind, owner: OWNER,
    validate: (raw) => (isSafeInt(raw.amount) && raw.amount !== 0 ? [] : ['amount 要是不為 0 的整數（不能大到失真）']),
    budget: (e, ctx) => {
      const b = spec.budget?.(e, ctx)
      return b ? { ...b, group: `${spec.kind}:${ctx.actor}`, amount: e.amount, resize: (amount) => ({ ...e, amount }) } : null
    },
    clamp: (e, ctx) => {
      const r = spec.bound(e.amount, ctx, k)
      const effect = r.to === 0 ? null : r.to === e.amount ? e : { ...e, amount: r.to }
      const note: Omit<ClampNote, 'path'> | undefined = r.notice ? { from: e.amount, to: r.to, limit: r.limit, notice: r.notice } : undefined
      return note ? { effect, note } : { effect }
    },
    toChanges: (e, ctx): Change[] => [{ op: 'actor.track', id: ctx.actor, track: spec.kind, delta: e.amount }],
    describe: (e) => spec.describe(e.amount),
  }
}

export function installEffects(k: Kernel): void {
  for (const spec of SPECS) k.effects.register(toDef(spec, k))
}
