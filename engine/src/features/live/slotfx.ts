// L6 功能 live 的兩個效果（EVENTS 2.4 節；dev/adr/0020 第十三節、D9；dev/work/M5-live-slot.md「新的格式與鍵」）。
//   heat { amount }       直播的熱度 ±3：只在時段直播進行中收（其餘整筆拿掉並提醒）；加完夾在 0～這一場的上限（12；穩著播是 6）。
//                         M4 簾後館的場熱是量表 stage_heat，名字不撞；直播範圍的事件（live_mid）用它。
//   highlight { amount? } 一個亮點：熱度 +1～+3（預設 +1），直播開著就收（活動直播也收；時段直播夾在上限）。
// 兩個都給 AI 用（AI 一件事合計最多 ±3，超過的夾掉並提醒）；內建的事件照寫的算，最後仍夾在這一場的上限。
// 只動自己的 state.ext.live（變更 live.heat）；沒有任何入口給街頭信譽（V54）。

import type { Effect, EffectBudget, EffectStepCtx, Kernel } from '../../core'
import { isSafeInt } from '../../core'
import { OWNER, liveSession } from './model'

export const HEAT_EFFECT = 'heat'
export const HIGHLIGHT_EFFECT = 'highlight'
/** AI 一件事合計最多讓熱度變幾點 */
export const AI_HEAT_CAP = 3
const GROUP = 'live_heat'

interface HeatEffect extends Effect { amount: number }
interface HighlightEffect extends Effect { amount?: number }

const unknownFields = (raw: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

const NOT_SLOT_NOTE = '現在沒有在播時段直播，這一筆熱度沒有算。'
const NOT_LIVE_NOTE = '現在沒有在直播，這一筆亮點沒有算。'

/** 這一筆在現在的狀態下實際能加減多少（夾在 0～上限）；沒有這一場是 null。 */
function room(state: EffectStepCtx['state'], want: number, slotOnly: boolean): number | null {
  const s = liveSession(state)
  if (!s || (slotOnly && s.mode !== 'slot')) return null
  const top = s.cap ?? Infinity
  return want > 0 ? Math.min(want, Math.max(0, top - s.heat)) : Math.max(want, -s.heat)
}

function budgetOf<E extends Effect>(amount: number, ctx: EffectStepCtx, resize: (n: number) => E): EffectBudget<E> | null {
  if (ctx.level !== 'cap') return null
  return {
    group: GROUP, amount, min: -AI_HEAT_CAP, max: AI_HEAT_CAP, resize,
    notice: (to) => (to === 0 ? `一件事最多讓直播的熱度變 ${AI_HEAT_CAP} 點，這一筆沒有再算。` : `一件事最多讓直播的熱度變 ${AI_HEAT_CAP} 點，實際只算了 ${to > 0 ? '+' : '−'}${Math.abs(to)}。`),
  }
}

export function installSlotEffects(k: Kernel): void {
  k.effects.register<HeatEffect>({
    kind: HEAT_EFFECT, owner: OWNER,
    validate: (raw) => [...unknownFields(raw, ['amount']), ...(isSafeInt(raw.amount) && raw.amount !== 0 ? [] : ['amount 要是不為 0 的整數（正的加熱度、負的減）'])],
    budget: (e, ctx) => budgetOf(e.amount, ctx, (n) => ({ ...e, amount: n })),
    clamp(e, ctx) {
      const to = room(ctx.state, e.amount, true)
      if (to === null) return { effect: null, note: { from: e.amount, to: 0, notice: NOT_SLOT_NOTE } }
      if (to === e.amount) return { effect: e }
      const top = liveSession(ctx.state)?.cap
      return {
        effect: to === 0 ? null : { ...e, amount: to },
        note: { from: e.amount, to, ...(e.amount > 0 && top !== undefined ? { limit: top } : { limit: 0 }), notice: e.amount > 0 ? '這一場的熱度已經到上限了，多的沒有算。' : '這一場的熱度已經是 0，不會再往下。' },
      }
    },
    toChanges: (e) => [{ op: 'live.heat', delta: e.amount }],
    describe: (e) => `直播的熱度${e.amount > 0 ? '＋' : '－'}${Math.abs(e.amount)}`,
  })

  k.effects.register<HighlightEffect>({
    kind: HIGHLIGHT_EFFECT, owner: OWNER,
    validate: (raw) => [...unknownFields(raw, ['amount']), ...(raw.amount === undefined || (isSafeInt(raw.amount) && raw.amount >= 1 && raw.amount <= 3) ? [] : ['amount 要是 1～3 的整數（預設 1）'])],
    budget: (e, ctx) => budgetOf(e.amount ?? 1, ctx, (n) => ({ ...e, amount: n })),
    clamp(e, ctx) {
      const want = e.amount ?? 1
      const to = room(ctx.state, want, false)
      if (to === null) return { effect: null, note: { from: want, to: 0, notice: NOT_LIVE_NOTE } }
      if (to === want) return { effect: e }
      return { effect: to === 0 ? null : { ...e, amount: to }, note: { from: want, to, notice: '這一場的熱度已經到上限了，多的沒有算。' } }
    },
    toChanges: (e) => [{ op: 'live.heat', delta: e.amount ?? 1, highlight: true }],
    describe: (e) => `直播多了一個亮點，熱度＋${e.amount ?? 1}`,
  })
}
