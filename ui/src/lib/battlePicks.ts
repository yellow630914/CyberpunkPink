import type { BattleActionOption, BattleInput, BattleTarget } from '@engine/src'
import { pickApplies, pickProblems } from '@engine/src'

/**
 * 行動要玩家多選的東西（dev/adr/0014）：照引擎給的 picks 宣告整理成畫面要的模型。
 * 這裡只排版與接線：每個選項適不適用、還缺什麼，一律問引擎的 pickApplies、pickProblems，不自己判斷。
 */
export interface PickChoice { target: BattleTarget | null; pick: Record<string, unknown> }
export interface PickOptionView { value: string | number | boolean; label: string; reason: string | null; selected: boolean; at?: BattleTarget }
export interface PickView { key: string; label: string; kind: string; required: boolean; options: PickOptionView[] }
export interface PickFlow {
  picks: PickView[]
  targets: Array<{ target: BattleTarget; reason: string | null }>
  missing: string[]
  ready: boolean
  input: BattleInput
}

export function pickFlow(action: BattleActionOption, choice: PickChoice): PickFlow {
  const picks: PickView[] = []
  for (const p of action.picks) {
    const options = p.options.filter((o) => pickApplies(o, choice.target)).map((o): PickOptionView => ({
      value: o.value, label: o.label, reason: o.blocks.length ? o.blocks.join('\n') : null,
      selected: choice.pick[p.key] === o.value, ...(o.at ? { at: o.at } : {}),
    }))
    if (options.length) picks.push({ key: p.key, label: p.label, kind: p.kind, required: p.required, options })
  }

  // 已經選的選項帶 for 的話，不在 for 裡的目標用不上它
  const chosen = action.picks.flatMap((p) => p.options.filter((o) => o.for && choice.pick[p.key] === o.value))
  const targets = action.targets.map((t) => {
    if (t.blocks.length) return { target: t.target, reason: t.blocks.join('\n') }
    const miss = chosen.find((o) => !pickApplies(o, t.target))
    return { target: t.target, reason: miss ? `這個目標用不上選的「${miss.label}」。` : null }
  })

  const missing = [
    ...(action.target !== 'none' && !choice.target ? ['要選一個目標。'] : []),
    ...pickProblems(action.picks, choice.target, choice.pick),
  ]

  const pick: Record<string, unknown> = {}
  for (const p of action.picks) {
    const v = choice.pick[p.key]
    if (v === undefined || v === null || (p.kind === 'toggle' && v === false)) continue
    pick[p.key] = v
  }
  const input: BattleInput = {
    action: action.id,
    ...(choice.target ? { target: choice.target } : {}),
    ...(Object.keys(pick).length ? { pick } : {}),
  }
  return { picks, targets, missing, ready: missing.length === 0, input }
}
