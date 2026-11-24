// L6 功能：特質。角色身上的特質與缺陷照資料變成檢定的修正與衍生數值的加減，並提供「給、拿掉特質」的效果與 has_perk 條件
// （CHARACTER 4.1、4.3、4.4、5.2、5.3 節）。不自己定義 max_hp 這些數值（那是角色功能的事），只加來源。
// 特質點的預算、取得特質的機會、自訂特質都不在這裡。

import type { CreationRuleEntry, Condition, Effect, Feature, PerkEntry, RollPart } from '../../core'

const OWNER = 'perks'
const DEFAULT_PERK_MAX = 8

type PerkEffect = Effect & { id: string; remove?: boolean }
type HasPerk = Condition & { perk: string }

/** 佔名額的特質：不是缺陷、分類也不是出身（CHARACTER 4.4 節）。 */
const counts = (p: PerkEntry): boolean => !p.flaw && p.category !== 'origin'

export const perksFeature: Feature = {
  id: OWNER,
  install(k) {
    k.stats.addCheckModifier(OWNER, (state, actor, ctx) => {
      const out: RollPart[] = []
      for (const id of state.actors[actor]?.perks ?? []) {
        const c = k.content.get<PerkEntry>('perk', id)?.checks
        if (!c) continue
        if (c.skills && (!ctx.skill || !c.skills.includes(ctx.skill))) continue
        if (c.tags && !c.tags.every((t) => ctx.tags.includes(t))) continue
        out.push({ label: k.content.get<PerkEntry>('perk', id)!.name, value: c.bonus, source: 'perk' })
      }
      return out
    })

    k.stats.addStatProvider('*', OWNER, (state, actor, stat) => {
      const out: RollPart[] = []
      for (const id of state.actors[actor]?.perks ?? []) {
        const p = k.content.get<PerkEntry>('perk', id)
        const v = p?.stats?.[stat]
        if (p && typeof v === 'number') out.push({ label: p.name, value: v, source: 'perk' })
      }
      return out
    })

    k.effects.register<PerkEffect>({
      // 特質不在 EVENTS 2.4 的 AI 效果表裡：AI 與玩家要的結果不能給（ai: false，dev/adr/0017 M2 最後一批的補記）；內建的事件資料照常能給
      kind: 'perk', owner: OWNER, ai: false,
      validate(raw, ctx) {
        const id = raw.id
        const perk = typeof id === 'string' ? ctx.content.get<PerkEntry>('perk', id) : undefined
        if (typeof id !== 'string' || !perk) return [`特質 ${String(id ?? '')} 不存在`]
        const has = ctx.state.actors[ctx.actor]?.perks ?? []
        if (raw.remove) return has.includes(id) ? [] : [`${ctx.actor} 沒有 ${perk.name} 這個特質`]
        if (has.includes(id)) return [`${ctx.actor} 已經有 ${perk.name} 了`]
        if (counts(perk)) {
          const max = ctx.content.get<CreationRuleEntry>('creation_rule', 'default')?.perk_max ?? DEFAULT_PERK_MAX
          const used = has.filter((x) => { const e = ctx.content.get<PerkEntry>('perk', x); return e !== undefined && counts(e) }).length
          if (used >= max) return [`特質最多 ${max} 個，要先放掉一個。`]
        }
        return []
      },
      toChanges: (e, ctx) => [{ op: 'actor.perk', id: ctx.actor, perk: e.id, ...(e.remove ? { remove: true } : {}) }],
      describe(e, ctx) {
        const p = ctx.content.get<PerkEntry>('perk', e.id)
        const name = p?.name ?? e.id
        return e.remove ? `放掉：${name}` : `${p?.flaw ? '染上' : '學會'}：${name}`
      },
    })

    k.conditions.register<HasPerk>({
      kind: 'has_perk', owner: OWNER,
      validate: (raw) => (typeof raw.perk === 'string' ? [] : ['要有 perk（特質的 id）']),
      test: (c, { state, actor }) => state.actors[actor ?? state.pc ?? '']?.perks.includes(c.perk) ?? false,
    })
  },
}
