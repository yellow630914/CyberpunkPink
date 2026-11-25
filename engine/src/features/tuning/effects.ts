// L6 功能 tuning 的效果與條件（dev/work/M4-tuning.md「新的格式與鍵」與第 5 點）。
//   效果 tuning        { id, locked_by?, days? }：強制裝上（契約的「改造」指令、戰敗事件、惡意韌體用）；沒有空槽時擠掉沒上鎖的第一個；locked_by 寫了就上鎖（days 是鎖的期限，沒寫是永久）。
//                      只有內建的來源收（ai: false）。沒有橋、兩個槽都上了鎖而且這個不在其中：整筆落空並提醒。
//   效果 tuning_remove { id }：拿掉一個調校，無視鎖。只有內建的來源收。
//   條件 tuning        { id }：裝著（看 ctx.actor ?? 主角）。

import type { Condition, Effect, EffectStepCtx, Kernel } from '../../core'

import type { TuningExt } from './model'
import { KIND, MAX_LOCK_DAYS, MINUTES_PER_DAY, OWNER, TUNING_CONDITION, TUNING_EFFECT, TUNING_REMOVE_EFFECT, entryOf, hasBridge, installedIds, nameOfActor, nowOf, readExt, tuningRules } from './model'
import { extChange } from './install'

interface TuningEffect extends Effect { id: string; locked_by?: string; days?: number }
interface RemoveEffect extends Effect { id: string }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 強制裝上之後的記錄；落空是 null（沒有槽可用）。 */
function forced(k: Kernel, ctx: EffectStepCtx, e: TuningEffect): { ext: TuningExt; evicted: string | null; placed: boolean } | null {
  const ext = readExt(ctx.state, ctx.actor, tuningRules(k).slots)
  let evicted: string | null = null
  let placed = false
  if (!ext.slots.includes(e.id)) {
    let slot = ext.slots.indexOf(null)
    if (slot < 0) {
      slot = ext.slots.findIndex((s) => s !== null && !ext.locked[s])
      if (slot < 0) return null
      evicted = ext.slots[slot]!
    }
    ext.slots[slot] = e.id
    placed = true
  }
  if (e.locked_by !== undefined) {
    const until = e.days !== undefined ? nowOf(ctx.state) + Math.round(e.days * MINUTES_PER_DAY) : undefined
    ext.locked[e.id] = { by: e.locked_by, ...(until !== undefined ? { until } : {}) }
  }
  return { ext, evicted, placed }
}

export function installEffects(k: Kernel): void {
  k.effects.register<TuningEffect>({
    kind: TUNING_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p: string[] = []
      if (!isText(raw.id)) p.push('id 要是調校的 id')
      else if (!ctx.content.has(KIND, raw.id)) p.push(`id：查不到 ${raw.id} 這個調校`)
      if (raw.locked_by !== undefined && !isText(raw.locked_by)) p.push('locked_by 要是鑰匙在誰手上（角色的 id 或一個名字）')
      if (raw.days !== undefined) {
        if (raw.locked_by === undefined) p.push('days 要和 locked_by 一起寫（鎖的期限）')
        if (!(typeof raw.days === 'number' && Number.isFinite(raw.days) && raw.days > 0 && raw.days <= MAX_LOCK_DAYS)) p.push(`days 要是 0 到 ${MAX_LOCK_DAYS} 之間的天數`)
      }
      for (const f of Object.keys(raw)) if (!['kind', 'id', 'locked_by', 'days', 'asked'].includes(f)) p.push(`${f}：沒有這個欄位（可以寫：id、locked_by、days）`)
      return p
    },
    clamp(e, ctx) {
      const drop = (notice: string) => ({ effect: null, note: { from: e.id, to: null, limit: TUNING_EFFECT, notice } })
      if (!hasBridge(k, ctx.state, ctx.actor)) return drop('這個人沒有橋，調校沒有地方裝，所以沒有算。')
      const r = forced(k, ctx, e)
      if (!r) return drop('調校槽都上了鎖，擠不出位置，這一筆沒有算。')
      // 已經裝著、又沒有要上鎖：沒有事發生
      if (!r.placed && e.locked_by === undefined) return { effect: null }
      return { effect: e }
    },
    toChanges(e, ctx) {
      const r = forced(k, ctx, e)
      return r ? [extChange(ctx.actor, r.ext)] : []
    },
    describe(e, ctx) {
      const name = entryOf(k, e.id)?.name ?? e.id
      const who = e.locked_by !== undefined ? nameOfActor(ctx.state, e.locked_by) : ''
      return e.locked_by !== undefined ? `調校被裝了上去：${name}（鑰匙在${who}手上）` : `調校被裝了上去：${name}`
    },
  })

  k.effects.register<RemoveEffect>({
    kind: TUNING_REMOVE_EFFECT, owner: OWNER, ai: false,
    validate: (raw) => [...(isText(raw.id) ? [] : ['id 要是調校的 id']), ...Object.keys(raw).filter((f) => !['kind', 'id', 'asked'].includes(f)).map((f) => `${f}：沒有這個欄位（只有 id）`)],
    clamp(e, ctx) {
      const ext = readExt(ctx.state, ctx.actor, tuningRules(k).slots)
      return ext.slots.includes(e.id) ? { effect: e } : { effect: null }
    },
    toChanges(e, ctx) {
      const ext = readExt(ctx.state, ctx.actor, tuningRules(k).slots)
      ext.slots = ext.slots.map((s) => (s === e.id ? null : s))
      delete ext.locked[e.id]
      return [extChange(ctx.actor, ext)]
    },
    describe: (e) => `調校被拆掉了：${entryOf(k, e.id)?.name ?? e.id}`,
  })

  k.conditions.register<Condition & { id: string }>({
    kind: TUNING_CONDITION, owner: OWNER,
    validate: (raw) => (isText(raw.id) ? [] : ['id 要是調校的 id']),
    test(c, { state, actor }) {
      const who = actor ?? state.pc
      return !!who && !!state.actors[who] && installedIds(readExt(state, who, tuningRules(k).slots)).includes(c.id)
    },
  })
}
