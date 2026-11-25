// L6 功能 medical 共用的小函式：腳下的診所、自己動刀列不列、戰鬥與活動的擋法、付錢。

import type { ActorId, Condition, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { clone, formatAmount } from '../../core'
import type { ClinicGrade, MedicalRules, Pool } from './model'
import { CLINIC_GRADES, FACILITY_TYPE_KIND, POOL_NAME } from './model'

type FacilityTypeEntry = { id: string; name?: unknown; clinic?: unknown }

/** 現在站的設施是哪一種診所（用條件 at_facility 問；沒有人註冊就沒有診所）。 */
export function clinicHere(k: Kernel, state: GameState): { type: string; name: string; grade: ClinicGrade } | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    const grade = (t.clinic as { grade?: unknown } | undefined)?.grade
    if (!(CLINIC_GRADES as readonly unknown[]).includes(grade)) continue
    if (k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) return { type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, grade: grade as ClinicGrade }
  }
  return null
}

/** 一串條件裡用到的條件種類（含 all、any、not 裡面的）。 */
function conditionKinds(c: unknown, out: Set<string> = new Set()): Set<string> {
  if (c && typeof c === 'object') {
    const kind = (c as { kind?: unknown }).kind
    if (typeof kind === 'string') {
      if (kind === 'all' || kind === 'any') for (const x of ((c as { of?: unknown[] }).of ?? [])) conditionKinds(x, out)
      else if (kind === 'not') conditionKinds((c as { of?: unknown }).of, out)
      else out.add(kind)
    }
  }
  return out
}

/** 自己動刀這一項列不列：self_requires 用到的條件種類都有人註冊（沒有 abilities，條件 ability 不存在，就沒有自己動刀）。 */
export function selfListed(k: Kernel, rules: MedicalRules): boolean {
  const known = new Set(k.conditions.kinds())
  return rules.self_requires.every((c) => [...conditionKinds(c)].every((kind) => known.has(kind)))
}

/** 動刀的人通過 self_requires 嗎；沒過的寫一句。 */
export function selfConditionProblem(k: Kernel, state: GameState, by: ActorId, rules: MedicalRules): string | null {
  const ctx = { state, actor: by, stats: k.stats, timeRules: k.timeRules }
  for (const c of rules.self_requires as Condition[]) {
    if (!k.conditions.test(c, ctx)) return c.kind === 'ability' ? '動刀的人還沒有學會手術這項技能。' : '動刀的人不符合自己動刀的條件。'
  }
  return null
}

/** 人在住處或診所嗎（自己動刀的地方）。住處用條件 at_home 問，沒有人註冊就沒有住處。 */
export function atHomeOrClinic(k: Kernel, state: GameState): boolean {
  if (clinicHere(k, state)) return true
  if (!k.conditions.kinds().includes('at_home')) return false
  return k.conditions.test({ kind: 'at_home' }, { state, stats: k.stats, timeRules: k.timeRules })
}

/** 戰鬥中與別的活動擋住時的原因（戰鬥外的治療都先過這一關）；行是 null。 */
export function outOfBattleBlock(k: Kernel, state: GameState, action: string): string | null {
  if (state.battle) return '戰鬥中不能這樣處理，要用戰鬥裡的行動。'
  return k.activity.blockOf(state, `commit:${action}`)
}

/** 付一筆錢用哪一種：指定的就用指定的（不夠回 null）；沒指定先帳戶、不夠再現金。 */
export function payPool(money: GameState['money'], cost: number, want?: Pool): Pool | null {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}

export const moneyProblem = (state: GameState, fee: number, pay: Pool | undefined, what: string): string | null =>
  fee > 0 && payPool(state.money, fee, pay) === null ? `錢不夠：${what}要 ${formatAmount(fee)}，${pay ? POOL_NAME[pay] : '帳戶與現金'}付不起。` : null

/** 報告草稿的共同骨架：一個動作、一串句子（第一句是主句，其餘是補充）。 */
export function reportOf(state: GameState, action: string, actor: ActorId, target: ActorId, changes: ReportDraft['changes'], lines: string[], result: string, data: Record<string, unknown>, extra: TimelineBeat[] = []): ReportDraft {
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: target, text: lines[0]!, tag: action, data }, ...extra]
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: target, text, tag: 'medical.note' })
  return {
    kind: 'action', action, location: clone(state.location), actor, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}
