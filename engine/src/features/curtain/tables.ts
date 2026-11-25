// L6 功能 curtain 的三張表（內容種類 curtain_table）：點單表、賞箱表、獎品表（各一筆 d6 的表；CYBERSPACE 8.8 節）。
// 表是資料：列的權重、給什麼東西（構裝與 SKIN 的 id 寫在資料裡）都不在程式裡。骰面由狀態的亂數與用途導出，報告裡的 rng 變更讓下一次換一顆。

import type { Change, Effect, GameState, Grade, Kernel } from '../../core'
import { deriveRng, effectCtx, isRecord } from '../../core'
import type { CurtainRules, CurtainTable, NightEntry, TableRow } from './model'
import { STUBS, TABLE_KIND, isText } from './model'

type Cx = Pick<Kernel, 'content'>

/** 一種表：規則裡指定的 id，沒指定就是這一種裡 id 排最前面的那一張；沒有是 null。 */
export function tableOf(k: Cx, kind: CurtainTable['kind'], rules: Pick<CurtainRules, 'tables'>): CurtainTable | null {
  if (!k.content.hasKind(TABLE_KIND)) return null
  const want = rules.tables[kind]
  if (want) {
    const t = k.content.get(TABLE_KIND, want) as CurtainTable | undefined
    return t && t.kind === kind ? t : null
  }
  return k.content.list<CurtainTable>(TABLE_KIND).filter((t) => t.kind === kind).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null
}

/** 五個數字（照等級）的欄位換成這一級的那一個。 */
export function scaleByGrade(v: unknown, grade: number): unknown {
  if (Array.isArray(v) && v.length === 5 && v.every((n) => typeof n === 'number')) return v[grade - 1]
  if (Array.isArray(v)) return v.map((x) => scaleByGrade(x, grade))
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, scaleByGrade(x, grade)]))
  return v
}

/** 票根的計數器變更（0 不寫）。 */
export const stubChange = (n: number): Change[] => (n !== 0 ? [{ op: 'counter', key: STUBS, delta: n }] : [])

/** 現在的票根數。 */
export const stubsOf = (state: Pick<GameState, 'counters'>): number => {
  const v = state.counters[STUBS]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export interface Reward {
  changes: Change[]
  lines: string[]
  /** 給的票根（已經是變更；這裡留一份數字給報告用） */
  stubs: number
  /** 觀眾的紙條：下一個點單的票根 ×2 */
  double: boolean
  names: string[]
}

const emptyReward = (): Reward => ({ changes: [], lines: [], stubs: 0, double: false, names: [] })

/** 擲一列（照權重；purpose 決定骰面）。 */
export function rollRow(table: CurtainTable, state: GameState, purpose: string): TableRow {
  return deriveRng(state.rng, purpose).weighted(table.rows, (r) => r.weight)
}

/**
 * 擲賞箱表或獎品表一次：票根、效果（內建的來源，數字可以寫照等級的五個值）、再擲獎品表（賞箱的 prize 列，只往下一層）、觀眾的紙條、這一夜的主題獎品（獎品表的 theme 列）。
 * 壞掉的列（效果收不下）不給東西，寫一句。
 */
export function rewardOf(k: Kernel, state: GameState, rules: CurtainRules, kind: 'chest' | 'prize', o: { purpose: string; grade: number; night?: NightEntry }): Reward {
  const out = emptyReward()
  let table = tableOf(k, kind, rules)
  let purpose = o.purpose
  for (let depth = 0; depth < 2 && table; depth++) {
    const row = rollRow(table, state, purpose)
    const name = row.name ?? '東西'
    out.names.push(name)
    const parts: string[] = []
    if (row.stubs !== undefined) {
      const n = typeof row.stubs === 'number' ? row.stubs : deriveRng(state.rng, `${purpose}/stubs`).int(row.stubs[0], row.stubs[1])
      out.stubs += n
      parts.push(`票根 ${n} 枚`)
    }
    const give: Array<Record<string, unknown>> = [...(row.give ?? [])]
    if (row.theme === true) {
      const prize = o.night?.prize
      if (isText(prize)) give.push({ kind: 'item', id: prize, qty: 1 })
      else if (isRecord(prize)) give.push(prize as Record<string, unknown>)
    }
    if (give.length) {
      const res = k.effects.resolve(scaleByGrade(give, o.grade) as Effect[], effectCtx(k, state, { source: 'builtin', grade: o.grade as Grade }))
      if (res.errors.length) out.lines.push(`${name}：裡面的東西壞掉了，什麼都沒拿到。`)
      else {
        out.changes.push(...res.changes)
        parts.push(...res.lines)
      }
    }
    if (row.double === true) {
      out.double = true
      parts.push('觀眾的紙條：下一個點單的票根加倍')
    }
    out.lines.push(`${name}${parts.length ? `：${parts.join('；')}` : ''}。`)
    if (row.prize !== true) break
    table = tableOf(k, 'prize', rules)
    purpose = `${purpose}/prize`
  }
  out.changes.push(...stubChange(out.stubs))
  return out
}
