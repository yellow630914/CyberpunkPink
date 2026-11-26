// 戰役的後果（OPINION 第 9 節；dev/adr/0020 第五節、V41）：結算時算出一串效果，一次交給 k.effects（來源算內建的），沒有人註冊的種類略過、不擋結算。
//   結果的那一列（規則表 opinion_rule.after）：目標勢力的聲望（量表 standing；守方的議題加在被保護的那一方）與敵對值、訂閱（現有的百分之幾）、公信力。
//   佔著的格子另給（opinion_rule.cells）：主流三格各訂閱 +2%；同人圈與應援圈各人氣 +1、打賞（分數 × 50，進現金）；街頭三格合計公信力 +1。認輸、收買、被找上門不算「結算」，不給這一份。
//   議題資料的 on_end（結果 → 效果）；戰役裡存著的 out（戰役外的效果）：'$foe_faction' 換成對手的勢力、'$pc' 換成主角。
// 只有 solo（自己發起、事件開的）給結果那一列與格子的加成；委託副本裡（face）的後果由那一面的結果表管（M5-opinion-face）；on_end 與 out 兩種都套。
// 區域狀態、人的處境、之後的委託是內容（用 on_end 寫效果），這裡不做。任何一筆都不給街頭信譽（V54）。

import type { Change } from '../../core'
import { effectCtx, isRecord, meterOf } from '../../core'
import { cellsOwnedBy } from './board'
import type { OpEffect } from './hooks'
import { CELL_NAME } from './model'
import type { Cell, War } from './model'
import type { Run } from './run'

type Fx = { kind: string; [field: string]: unknown }

export interface AfterResult {
  changes: Change[]
  lines: string[]
  /** 結算的效果（k.effects 解完之後） */
  effects: unknown[]
  /** 沒有人註冊或格式不合、略過的效果種類 */
  skipped: string[]
}

const MAIN_CELLS: Cell[] = ['sakura', 'kaleido', 'nightingale']
const CIRCLE_CELLS: Cell[] = ['doujin', 'fanclub']
const STREET_CELLS: Cell[] = ['wall', 'whisper', 'relay']

/** 目標勢力：攻方的議題是對手的勢力；守方的議題（滅火、洗白）是被保護的那一方（議題涉及的第一個勢力）。 */
export function standingFaction(w: War): string | undefined {
  return w.topic.side === 'defend' ? w.topic.involves.factions[0] : (w.foe.faction ?? w.topic.involves.factions[0])
}

/** 把效果裡的代號換掉；換不出來的（對手沒有勢力）回 null，整筆略過。 */
function substitute(e: unknown, foe: string | undefined, pc: string | undefined): Fx | null {
  let ok = true
  const walk = (v: unknown): unknown => {
    if (v === '$foe_faction') { if (foe === undefined) ok = false; return foe }
    if (v === '$pc') { if (pc === undefined) ok = false; return pc }
    if (Array.isArray(v)) return v.map(walk)
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  const out = walk(e)
  return ok && isRecord(out) && typeof out.kind === 'string' ? (out as Fx) : null
}

/** 這一場結束時要給的後果：變更、給玩家看的句子、結算的效果。 */
export function consequences(run: Run): AfterResult {
  const { k, state, w } = run
  const r = w.result!
  const rules = run.rules
  const list: Fx[] = []
  const lines: string[] = []
  const subs = k.meters.has('subs') ? meterOf(k, state, 'subs') : 0
  const pct = (p: number): number => Math.floor((subs * p) / 100)
  const changes: Change[] = []

  if (w.mode === 'solo') {
    const t = rules.after[r.outcome]
    const faction = standingFaction(w)
    if (t.standing && faction) list.push({ kind: 'standing', key: faction, amount: w.topic.side === 'defend' ? -t.standing : t.standing })
    if (t.hostility && w.foe.faction) list.push({ kind: 'hostility', key: w.foe.faction, amount: t.hostility })
    if (t.subs_pct && pct(t.subs_pct) !== 0) list.push({ kind: 'subs', amount: pct(t.subs_pct) })
    if (t.cred) list.push({ kind: 'credibility', amount: t.cred })
    // 佔著的格子另給（認輸、收買、被找上門不算）
    if (r.by === 'rounds' || r.by === 'wipe') {
      const mine = cellsOwnedBy(w, 'you')
      const main = mine.filter((c) => MAIN_CELLS.includes(c)).length
      if (main > 0 && pct(rules.cells.main_subs_pct * main) !== 0) list.push({ kind: 'subs', amount: pct(rules.cells.main_subs_pct * main) })
      const circle = mine.filter((c) => CIRCLE_CELLS.includes(c))
      if (circle.length > 0) {
        const def = k.meters.get('popularity')
        if (state.pc && rules.cells.circle_pop > 0) list.push({ kind: 'popularity', ...(def?.keyed === 'npc' ? { key: state.pc } : {}), amount: rules.cells.circle_pop * circle.length })
        const tips = circle.reduce((s, c) => s + (w.topic.scores[c] + (w.bonus[c] ?? 0)) * rules.cells.circle_tip, 0)
        if (tips > 0) {
          changes.push({ op: 'cash', delta: tips })
          lines.push(`${circle.map((c) => `「${CELL_NAME[c]}」`).join('、')}的粉絲打賞了 C$${tips.toLocaleString('en-US')}`)
        }
      }
      if (mine.some((c) => STREET_CELLS.includes(c)) && rules.cells.street_cred) list.push({ kind: 'credibility', amount: rules.cells.street_cred })
    }
  }
  // 議題資料寫的後果（內容用）、戰役裡存著的戰役外的效果
  for (const e of (w.topic.on_end?.[r.outcome] ?? []) as OpEffect[]) {
    const x = substitute(e, w.foe.faction, state.pc ?? undefined)
    if (x) list.push(x)
  }
  const skipped: string[] = []
  for (const e of w.out) {
    const x = substitute(e, w.foe.faction, state.pc ?? undefined)
    if (x) list.push(x)
    else skipped.push(String((e as { kind?: unknown }).kind ?? '?'))
  }

  // 沒有人註冊的、格式驗不過的略過，不擋結算
  const ctx = effectCtx(k, state, { source: 'builtin' })
  const ok = list.filter((e) => {
    const good = k.effects.has(e.kind) && k.effects.validate([e], ctx).length === 0
    if (!good) skipped.push(e.kind)
    return good
  })
  let effects: unknown[] = []
  if (ok.length > 0) {
    const res = k.effects.resolve(ok, ctx)
    if (res.errors.length === 0) {
      changes.push(...res.changes)
      lines.push(...res.lines)
      effects = res.effects
    } else skipped.push(...ok.map((e) => e.kind))
  }
  return { changes, lines, effects, skipped: [...new Set(skipped)] }
}
