// L6 功能 sink 的下限：變更 sink.ext（合併著寫 actor.ext.sink）與效果 sink_floor（暫時或永久的下限加減）。
//
// 效果 sink_floor { amount, days?, why? }：下限加 amount（可以是負的：抑制劑）；寫了 days 就是那麼多天之後回來，沒寫是永久的。
//   只有內建的來源能用（ai: false）：AI 生成的事件與玩家要的結果不能自己墊高或壓低下限。
//   給下限加了正值而沉溺不到新的下限時，同一份報告把沉溺補到新的下限（和裝義體一樣）；沉溺原本就比較高的不動，降下來的下限不動沉溺本身。
// 變更 sink.ext { id, patch?, floor_add?, prune? }：patch 是 { 鍵: 數字或 null }（null 拿掉）；floor_add 多一筆下限加減；prune 把已經過期的拿掉。
//   過期的在下一次寫的時候清掉（讀的時候本來就不算它）。

import type { Change, Effect, EffectCtx, EffectStepCtx, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { FloorMod } from './model'
import { EXT, EXT_OP, FLOOR_EFFECT, MAX_FLOOR_DAYS, MINUTES_PER_DAY, OWNER, liveMods, nowOf, readExt } from './model'

type ExtChange = Change & { id: string; patch?: Record<string, number | null>; floor_add?: FloorMod; prune?: boolean }
interface FloorEffect extends Effect { amount: number; days?: number; why?: string }

const PATCH_KEYS = ['therapy_week', 'therapy_n', 'carry_from', 'carry_paid']

export function registerFloor(k: Kernel): void {
  k.changes.register<ExtChange>({
    op: EXT_OP, owner: OWNER,
    validate(s, c) {
      const p: string[] = []
      if (typeof c.id !== 'string' || !s.actors[c.id]) p.push(`沒有 ${String(c.id)} 這個角色`)
      if (c.patch !== undefined) {
        if (!isRecord(c.patch)) p.push('patch 要是 { 鍵: 數字或 null }')
        else for (const [key, v] of Object.entries(c.patch)) {
          if (!PATCH_KEYS.includes(key)) p.push(`patch.${key}：只能寫 ${PATCH_KEYS.join('、')}`)
          else if (v !== null && !isSafeInt(v)) p.push(`patch.${key} 要是整數或 null`)
        }
      }
      if (c.floor_add !== undefined) {
        const f = c.floor_add
        if (!isRecord(f) || !isSafeInt(f.amount) || f.amount === 0) p.push('floor_add 要是 { amount（不為 0 的整數）, until?, why? }')
        else if ((f.until !== undefined && !isSafeInt(f.until)) || (f.why !== undefined && typeof f.why !== 'string')) p.push('floor_add 的 until 要是整數、why 要是文字')
      }
      return p
    },
    apply(s, c) {
      const a = s.actors[c.id]!
      const raw = isRecord(a.ext[EXT]) ? { ...(a.ext[EXT] as Record<string, unknown>) } : {}
      const ext = readExt(s, c.id)
      let mods = ext.floor_mods
      if (c.prune) mods = liveMods(ext, nowOf(s))
      if (c.floor_add) mods = [...mods, { amount: c.floor_add.amount, ...(c.floor_add.until !== undefined ? { until: c.floor_add.until } : {}), ...(c.floor_add.why ? { why: c.floor_add.why } : {}) }]
      const next: Record<string, unknown> = { ...raw, floor_mods: mods }
      for (const [key, v] of Object.entries(c.patch ?? {})) {
        if (v === null) delete next[key]
        else next[key] = v
      }
      if (mods.length === 0 && Object.keys(next).length === 1) delete a.ext[EXT]
      else a.ext[EXT] = next
    },
    describe: (c) => (c.floor_add ? '沉溺的下限變了' : null),
  })

  k.effects.register<FloorEffect>({
    kind: FLOOR_EFFECT, owner: OWNER, ai: false,
    validate(raw: Record<string, unknown>, _ctx: EffectCtx) {
      const p: string[] = []
      if (!isSafeInt(raw.amount) || raw.amount === 0 || Math.abs(raw.amount) > 1000) p.push('amount 要是不為 0、絕對值不超過 1000 的整數')
      if (raw.days !== undefined && !(isSafeInt(raw.days) && raw.days >= 1 && raw.days <= MAX_FLOOR_DAYS)) p.push(`days 要是 1～${MAX_FLOOR_DAYS} 的整數（持續幾天；不寫是永久的）`)
      if (raw.why !== undefined && !(typeof raw.why === 'string' && raw.why.trim())) p.push('why 要是一句話')
      return p
    },
    toChanges(e, ctx: EffectStepCtx): Change[] {
      const now = nowOf(ctx.state)
      const add: FloorMod = { amount: e.amount, ...(e.days !== undefined ? { until: now + e.days * MINUTES_PER_DAY } : {}), ...(e.why ? { why: e.why } : {}) }
      const out: Change[] = [{ op: EXT_OP, id: ctx.actor, floor_add: add, prune: true } as Change]
      if (e.amount > 0 && k.stats.hasStat('sink_floor')) {
        const floor = k.stats.stat(ctx.state, ctx.actor, 'sink_floor') + e.amount
        const lift = floor - (ctx.state.actors[ctx.actor]?.sink ?? 0)
        if (lift > 0) out.push({ op: 'actor.track', id: ctx.actor, track: 'sink', delta: lift })
      }
      return out
    },
    describe: (e) => (e.amount > 0 ? `沉溺的下限抬高了${e.days !== undefined ? '，過一陣子會回來' : ''}` : `沉溺的下限放低了${e.days !== undefined ? '，過一陣子會回來' : ''}`),
  })
}
