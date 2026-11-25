// L6 功能 deck：SKIN 的風格與曝露度（M4-scene-net；CYBERSPACE 4.3 節、DATA 7.4 節、LEWD_SYSTEM 第 2 節）。
// SKIN 只給兩樣東西：風格（一個標籤加一個 1～5 的值）與曝露度（0～3），不給護甲、不給數值。穿著的那一套＝ ext.skin 指的、背包裡有、內容查得到的那一套；
// 沒穿就是沒有風格、曝露度 0。衍生數值 skin_exposure、skin_style_value，條件 skin_style { tag, min? }、skin_exposure { min?, max? }。
// 現實穿什麼、帶什麼進內海都不算，反過來也是：這裡只讀化身穿的 SKIN，不讀 features/gear 的衣服。

import type { Condition, ConditionCtx, GameState, Kernel } from '../../core'
import { countItem } from '../../core'
import type { SkinEntry } from './model'
import { OWNER, SKIN_KIND, extOf } from './model'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 一套 SKIN 的風格（標籤加值）；沒寫風格的是 null。DATA 7.4 節的 style 字串加 style_value，或 { tag, value }。 */
export function skinStyleOf(e: SkinEntry): { tag: string; value: number } | null {
  const s = e.style
  if (typeof s === 'string' && s.trim()) return { tag: s, value: isInt(e.style_value) && e.style_value >= 1 && e.style_value <= 5 ? e.style_value : 1 }
  if (s && typeof s === 'object' && typeof s.tag === 'string' && s.tag.trim() && isInt(s.value)) return { tag: s.tag, value: Math.max(0, Math.min(5, s.value)) }
  return null
}

/** 一套 SKIN 的曝露度（0～3；custom 與沒寫是 0）。 */
export const skinExposureOf = (e: SkinEntry): number => (isInt(e.exposure) ? Math.max(0, Math.min(3, e.exposure)) : 0)

/** 這個人穿著的那一套 SKIN：ext.skin 指的、背包裡有、內容查得到才算。沒穿是 null。 */
export function wornSkin(k: Pick<Kernel, 'content'>, state: GameState, actor: string): { id: string; entry: SkinEntry } | null {
  const id = extOf(state, actor).skin
  if (id === undefined || countItem(state.inventory, id) < 1) return null
  const entry = k.content.get<SkinEntry>(SKIN_KIND, id)
  return entry ? { id, entry } : null
}

/** 穿著的 SKIN 在這個標籤上的風格值（沒穿、標籤不同是 0）。 */
export function skinStyleValue(k: Pick<Kernel, 'content'>, state: GameState, actor: string, tag?: string): number {
  const w = wornSkin(k, state, actor)
  const st = w ? skinStyleOf(w.entry) : null
  return st && (tag === undefined || st.tag === tag) ? st.value : 0
}

export function installSkinLook(k: Kernel): void {
  k.stats.defineStat({ id: 'skin_exposure', owner: OWNER, name: '化身的曝露度', base: (state, actor) => { const w = wornSkin(k, state, actor); return w ? skinExposureOf(w.entry) : 0 }, min: 0, max: 3 })
  k.stats.defineStat({ id: 'skin_style_value', owner: OWNER, name: '化身的風格值', base: (state, actor) => skinStyleValue(k, state, actor), min: 0 })

  const who = (state: GameState, ctx: ConditionCtx): string | null => {
    const id = ctx.actor ?? state.pc
    return id && state.actors[id] ? id : null
  }
  k.conditions.register<Condition & { tag: string; min?: number }>({
    kind: 'skin_style', owner: OWNER,
    validate(raw) {
      const p: string[] = []
      if (typeof raw.tag !== 'string' || !raw.tag.trim()) p.push('要有 tag（風格標籤）')
      if (raw.min !== undefined && !(isInt(raw.min) && raw.min >= 1 && raw.min <= 5)) p.push('min 要是 1～5 的整數')
      return p
    },
    test(c, ctx: ConditionCtx) {
      const id = who(ctx.state, ctx)
      return id !== null && skinStyleValue(k, ctx.state, id, c.tag) >= (c.min ?? 1)
    },
  })
  k.conditions.register<Condition & { min?: number; max?: number }>({
    kind: 'skin_exposure', owner: OWNER,
    validate(raw) {
      const p: string[] = []
      const level = (v: unknown): boolean => isInt(v) && v >= 0 && v <= 3
      for (const f of ['min', 'max'] as const) if (raw[f] !== undefined && !level(raw[f])) p.push(`${f} 要是 0～3 的整數`)
      if (level(raw.min) && level(raw.max) && (raw.min as number) > (raw.max as number)) p.push('min 不能大於 max')
      return p
    },
    test(c, ctx: ConditionCtx) {
      const id = who(ctx.state, ctx)
      if (id === null) return false
      const w = wornSkin(k, ctx.state, id)
      const v = w ? skinExposureOf(w.entry) : 0
      return (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)
    },
  })
}
