// L6 功能 security：掃橋讀「這個人」的規則數字（M4-security-m4）。規格：LIFE 2.1 節、3.1 節；NPCS 8.3 節；dev/adr/0019 P20、P21；dev/work/M4-plan.md 第 16 題。
// 和內建的 SecurityRules 放在同一筆資料 security_rule/default，但分開讀（不動 DEFAULT_SECURITY_RULES 的形狀），
// 資料檔最後由 M4-data-rules 補；沒寫的欄位照這裡的預設。只 import 核心。

import { isRecord } from '../../core'

/** 掃橋可以讀這個人的哪三樣。 */
export const PERSON_READS = ['cyber', 'sink', 'contract'] as const
export type PersonRead = (typeof PERSON_READS)[number]
export const isPersonRead = (v: unknown): v is PersonRead => (PERSON_READS as readonly unknown[]).includes(v)

export interface PersonRules {
  /** 勢力 → 那個勢力的點讀哪幾樣（內容匯入時填鎮溺隊、貞網局、伊甸園讀沉溺）；沒寫的勢力只讀義體 */
  readers: Record<string, PersonRead[]>
  /** 讀到的沉溺到這裡才有事（LIFE 2.1 節；暫定 60） */
  sink_notice: number
  /** 讀到的沉溺到這裡：這次過不了，只剩掉頭（CORE_RULES 4.3 節：溺感者 100） */
  sink_stop: number
  /** 讀到的沉溺在 sink_notice 以上：那個勢力的敵對值加這麼多 */
  sink_hostility: number
  /** 看穿藏著的沉溺（P21）：d20 ＋ 強度 × per_strength 對 base ＋ mod(意志) ＋ 定力 ＋ 手段 × per_hide */
  sink_see: { per_strength: number; base: number; per_hide: number }
  /** 義體的罰金：沒登記的登記類、沒有執照的許可類 */
  cyber_fine: { register: number; permit: number }
  /** 違禁的義體鎖幾小時 */
  cyber_lock_hours: number
  /** 義體的敵對值：沒登記的登記類、沒有執照的許可類、違禁 */
  cyber_hostility: { register: number; permit: number; banned: number }
}

export const DEFAULT_PERSON_RULES: PersonRules = {
  readers: {},
  sink_notice: 60, sink_stop: 100, sink_hostility: 3,
  sink_see: { per_strength: 3, base: 10, per_hide: 2 },
  cyber_fine: { register: 200, permit: 800 },
  cyber_lock_hours: 24,
  cyber_hostility: { register: 2, permit: 5, banned: 10 },
}

const int = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min
type Group = Record<string, number>
const GROUPS: Array<[keyof PersonRules, string[], number]> = [
  ['sink_see', ['per_strength', 'base', 'per_hide'], 0], ['cyber_fine', ['register', 'permit'], 0], ['cyber_hostility', ['register', 'permit', 'banned'], 0],
]

/** 格式問題（security_rule 的 validate 會呼叫）：每一格都選填。 */
export function personRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of ['sink_notice', 'sink_stop', 'sink_hostility', 'cyber_lock_hours'] as const) if (e[key] !== undefined && !int(e[key], key === 'cyber_lock_hours' ? 1 : 0)) p.push(`${key} 要是 ${key === 'cyber_lock_hours' ? 1 : 0} 以上的整數`)
  for (const [key, fields, min] of GROUPS) {
    const v = e[key]
    if (v === undefined) continue
    if (!isRecord(v)) { p.push(`${key} 要是 { ${fields.join(', ')} }`); continue }
    for (const f of Object.keys(v)) if (!fields.includes(f)) p.push(`${key}.${f} 不是這一組的欄位（${fields.join('、')}）`)
    for (const f of fields) if (v[f] !== undefined && !int(v[f], f === 'base' ? 1 : min)) p.push(`${key}.${f} 要是 ${f === 'base' ? 1 : min} 以上的整數`)
  }
  if (e.readers !== undefined) {
    if (!isRecord(e.readers)) p.push('readers 要是 { 勢力的 id: [cyber、sink、contract] }')
    else for (const [f, list] of Object.entries(e.readers)) if (!Array.isArray(list) || !list.every(isPersonRead)) p.push(`readers.${f} 要是 ${PERSON_READS.join('、')} 的陣列`)
  }
  if (int(e.sink_notice, 0) && int(e.sink_stop, 0) && e.sink_stop < e.sink_notice) p.push('sink_stop 不能比 sink_notice 小')
  return p
}

/** 現在生效的規則：資料 security_rule/default 蓋掉預設；不合格式的欄位用預設。 */
export function personRulesFrom(e: Record<string, unknown> | undefined): PersonRules {
  const out: PersonRules = {
    ...DEFAULT_PERSON_RULES, readers: {}, sink_see: { ...DEFAULT_PERSON_RULES.sink_see },
    cyber_fine: { ...DEFAULT_PERSON_RULES.cyber_fine }, cyber_hostility: { ...DEFAULT_PERSON_RULES.cyber_hostility },
  }
  if (!e) return out
  for (const key of ['sink_notice', 'sink_stop', 'sink_hostility'] as const) if (int(e[key], 0)) out[key] = e[key] as number
  if (int(e.cyber_lock_hours, 1)) out.cyber_lock_hours = e.cyber_lock_hours as number
  for (const [key, fields] of GROUPS) {
    const v = e[key]
    if (!isRecord(v)) continue
    const dst = out[key] as unknown as Group
    for (const f of fields) if (int(v[f], f === 'base' ? 1 : 0)) dst[f] = v[f] as number
  }
  if (isRecord(e.readers)) for (const [f, list] of Object.entries(e.readers)) if (Array.isArray(list) && list.every(isPersonRead)) out.readers[f] = [...new Set(list)]
  return out
}
