// L6 功能 tuning 給畫面的總覽（dev/work/M4-tuning.md 的 bridgeView）：四項橋參數的基本值、有效值、每個來源各加多少；調校槽；鎖。
// 衍生數值 bridge_<參數> 是 features/lewd 定義的；沒有橋或沒有人定義的人，params 是 null。

import type { ActorId, GameState, Kernel } from '../../core'
import type { BridgeParam, TuningFlag, TuningLock } from './model'
import { BRIDGE_PARAMS, FLAG_NAME, NEGATIVE_FLAGS, PARAM_NAME, entryOf, hasBridge, nameOfActor, paramStatId, readExt, requiresText, stableOf, tuningRules } from './model'
import { filteredOut, keyText } from './install'

export interface ParamSource {
  /** 被動效果的來源（cyber、drug、tuning……）或衍生數值 provider 給的 source */
  source: string
  /** 這個來源合計加多少（有正負） */
  amount: number
  /** 明細：給這一筆的名字與量 */
  parts: Array<{ label: string; amount: number }>
}

export interface ParamView {
  param: BridgeParam
  name: string
  /** 存在 ext.bridge 的基本值（0～100） */
  base: number
  /** 有效值：基本值加所有來源（0～200） */
  value: number
  /** 每個來源各加多少（不含基本值；沒有來源是空的） */
  sources: ParamSource[]
}

export interface SlotView {
  index: number
  /** 裝著的調校 id；空的是 null */
  id: string | null
  name?: string
  desc?: string
  /** requires 不成立：裝不穩，正的那幾筆不算 */
  unstable?: boolean
  /** 裝不穩的原因（要什麼） */
  unstable_why?: string
  lock?: { by: string; by_name: string; until?: number; text: string }
  /** 這一個調校現在生效的開關 */
  flags: Array<{ id: TuningFlag; name: string }>
}

export interface BridgeViewOfTuning {
  actor: ActorId
  has_bridge: boolean
  params: Record<BridgeParam, ParamView> | null
  slots: SlotView[]
  /** 上鎖的調校（id → 鎖） */
  locked: Record<string, TuningLock>
}

export function bridgeView(k: Kernel, state: GameState, actor: ActorId): BridgeViewOfTuning {
  const rules = tuningRules(k)
  const ext = readExt(state, actor, rules.slots)
  const bridge = hasBridge(k, state, actor)
  const slots: SlotView[] = ext.slots.map((id, index) => {
    if (id === null) return { index, id: null, flags: [] }
    const entry = entryOf(k, id)
    const lock = ext.locked[id]
    const view: SlotView = { index, id, flags: [] }
    if (entry) {
      view.name = entry.name
      view.desc = entry.desc
      const stable = stableOf(k, state, actor, entry)
      if (!stable) { view.unstable = true; view.unstable_why = requiresText(k, entry) }
      view.flags = (entry.flags ?? []).filter((f) => stable || NEGATIVE_FLAGS.includes(f)).map((f) => ({ id: f, name: FLAG_NAME[f] }))
    } else view.name = id
    if (lock) view.lock = { by: lock.by, by_name: nameOfActor(state, lock.by), ...(lock.until !== undefined ? { until: lock.until } : {}), text: keyText(state, lock) }
    return view
  })
  let params: Record<BridgeParam, ParamView> | null = null
  if (bridge && BRIDGE_PARAMS.every((p) => k.stats.hasStat(paramStatId(p)))) {
    params = {} as Record<BridgeParam, ParamView>
    for (const p of BRIDGE_PARAMS) {
      const id = paramStatId(p)
      const parts = k.stats.statParts(state, actor, id)
      const base = parts.find((x) => x.source === 'base')?.value ?? 0
      const bySource = new Map<string, ParamSource>()
      for (const part of parts) {
        if (part.source === 'base') continue
        const key = part.source ?? 'other'
        const row = bySource.get(key) ?? { source: key, amount: 0, parts: [] }
        row.amount += part.value
        row.parts.push({ label: part.label, amount: part.value })
        bySource.set(key, row)
      }
      params[p] = { param: p, name: PARAM_NAME[p], base, value: k.stats.stat(state, actor, id), sources: [...bySource.values()] }
    }
  }
  return { actor, has_bridge: bridge, params, slots, locked: ext.locked }
}

/** 這個人現在能看到、能裝的調校（內容篩選關掉的不列）。畫面的清單用。 */
export function tuningList(k: Kernel, state: GameState, actor: ActorId): Array<{ id: string; name: string; desc: string; price: number; installed: boolean; stable: boolean; why: string }> {
  if (!k.content.hasKind('tuning')) return []
  const rules = tuningRules(k)
  const have = readExt(state, actor, rules.slots).slots
  return k.content.list<import('./model').TuningEntry>('tuning')
    .filter((e) => !filteredOut(state, e))
    .map((e) => {
      const stable = stableOf(k, state, actor, e)
      return { id: e.id, name: e.name, desc: e.desc, price: e.price ?? rules.install.price, installed: have.includes(e.id), stable, why: stable ? '' : requiresText(k, e) }
    })
}
