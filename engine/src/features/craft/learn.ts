// L6 craft 學會設計圖（CRAFTING 第 3.4、11 節：設計圖不是實物）。三個來源裡這一張做兩個：
//   買授權：物品（類別 blueprint）多讀 teaches（設計圖的 id）；用掉那一件就學會（learnDraft，報告 craft.learn）
//   效果 blueprint { id }：偷來的、任務給的（內建的來源才收，ai: false）
// 第三個來源（把一件成品完整拆解之後畫出來）是 M4-craft-salvage。
// 學會的存在 state.ext.craft.known；已經會的不重複記。

import type { BlueprintEntry, Change, Effect, GameState, ItemEntry, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone } from '../../core'
import type { LicenceItem } from './model'
import { BLUEPRINT_EFFECT, LEARN_ACTION, OWNER, craftOf, isKnown, knownChange } from './model'

export interface LearnOpts {
  /** 授權書的物品 id */
  item: string
  /** 授權書有實例資料時指名是哪一件（背包裡 data.uid）；沒寫的用沒有實例資料的那幾疊 */
  uid?: string
}

const bpName = (k: Pick<Kernel, 'content'>, id: string): string => k.content.get<BlueprintEntry>('blueprint', id)?.name ?? id

/** 用掉這張授權書現在行不行：全部的原因（一條一句）；行是空陣列。 */
export function learnProblems(k: Kernel, state: GameState, o: LearnOpts): string[] {
  const act = k.activity.blockOf(state, `commit:${LEARN_ACTION}`)
  const it = k.content.get<LicenceItem>('item', o.item)
  if (!it) return [...(act ? [act] : []), `沒有 ${o.item} 這樣東西。`]
  const p: string[] = act ? [act] : []
  const bp = typeof it.teaches === 'string' ? k.content.get('blueprint', it.teaches) : undefined
  if (typeof it.teaches !== 'string') p.push(`${it.name}不是設計圖的授權書。`)
  else if (!bp) p.push(`${it.name}寫的設計圖找不到。`)
  else if (isKnown(state, it.teaches)) p.push(`${bpName(k, it.teaches)}已經會做了。`)
  const have = o.uid !== undefined
    ? state.inventory.some((s) => s.id === o.item && s.data?.uid === o.uid && s.qty >= 1)
    : state.inventory.some((s) => s.id === o.item && !s.data && s.qty >= 1)
  if (!have) p.push(`背包裡沒有${it.name}${o.uid !== undefined ? `（${o.uid}）` : ''}。`)
  return p
}

export const learnBlock = (k: Kernel, state: GameState, o: LearnOpts): string | null => learnProblems(k, state, o)[0] ?? null

/** 用掉一張授權書學會它教的設計圖：授權書少一張、known 多一筆。不成立丟 ActionBlocked。報告 craft.learn。 */
export function learnDraft(k: Kernel, state: GameState, o: LearnOpts): ReportDraft {
  const problems = learnProblems(k, state, o)
  if (problems.length > 0) throw new ActionBlocked(problems[0]!)
  const it = k.content.get<LicenceItem>('item', o.item)!
  const id = it.teaches!
  const name = bpName(k, id)
  const text = `用掉了${it.name}，學會了${name}的組法。`
  const changes: Change[] = [{ op: 'item', id: o.item, qty: -1, ...(o.uid !== undefined ? { data: { uid: o.uid } } : {}) }, knownChange(state, [...craftOf(state).known, id])]
  return {
    kind: 'action', action: LEARN_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: LEARN_ACTION, data: { item: o.item, blueprint: id } }],
    changes, outcome: { result: 'learned', summary: text }, narration: { results: [text] },
  }
}

interface BlueprintEffect extends Effect {
  id: string
}

/** 效果 blueprint：學會一張設計圖（內建的來源才收）。已經會的什麼都不做。 */
export function installBlueprintEffect(k: Kernel): void {
  k.effects.register<BlueprintEffect>({
    kind: BLUEPRINT_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      if (typeof raw.id !== 'string' || !raw.id) return ['id 要是設計圖的 id']
      return ctx.content.has('blueprint', raw.id) ? [] : [`沒有 ${raw.id} 這張設計圖。`]
    },
    toChanges: (e, ctx) => (isKnown(ctx.state, e.id) ? [] : [knownChange(ctx.state, [...craftOf(ctx.state).known, e.id])]),
    describe: (e, ctx) => (isKnown(ctx.state, e.id) ? `本來就會：${bpName(k, e.id)}` : `學會了：${bpName(k, e.id)}`),
  })
}

/** 啟動時檢查：物品的 teaches 要查得到設計圖，而且只有類別 blueprint 的物品能寫。 */
export function licenceProblems(k: Pick<Kernel, 'content'>): string[] {
  const out: string[] = []
  for (const it of k.content.list<ItemEntry & { teaches?: unknown }>('item')) {
    if (it.teaches === undefined) continue
    if (typeof it.teaches !== 'string' || !it.teaches) out.push(`item/${it.id}：teaches 要是設計圖的 id`)
    else if (it.category !== 'blueprint') out.push(`item/${it.id}：只有類別 blueprint 的物品能寫 teaches`)
    else if (!k.content.has('blueprint', it.teaches)) out.push(`item/${it.id}：teaches 的設計圖 ${it.teaches} 查不到`)
  }
  return out
}
