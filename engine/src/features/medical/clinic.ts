// L6 功能 medical 的診所治療（DOWNTIME 3.1 節；TRADE 3.4 節；dev/work/M4-medical.md 第 3 點）。
// 腳下的設施有 clinic（和 cyberware 讀同一欄 facility_type.clinic.grade）：回到滿；錢＝缺的點數 × 那一種診所的單價；時間＝每 10 點一小時（進位）；掛 treated。
// 錢不夠時治得起幾點就治幾點（至少 1 點才成立）。價錢還沒有乘區的倍率（TRADE 第 3 節說服務的價錢也乘；這一張先不乘）。

import type { ActorId, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, formatAmount, formatDuration } from '../../core'
import { clinicHere, outOfBattleBlock, payPool, reportOf } from './common'
import type { ClinicGrade, Pool } from './model'
import { CLINIC_NAME, POOL_NAME, TREATED, maxHpOf, medicalRules, nowOf } from './model'

export const HEAL_ACTION = 'medical.heal'

export interface ClinicOpts {
  /** 被治療的人 */
  target: ActorId
  /** 從哪裡付；不寫先看哪一種付得起全部，再看哪一種付得起比較多 */
  pay?: Pool
}

/** 一次診所治療的報價（畫面與草稿用同一份）。 */
export interface ClinicQuote {
  target: ActorId
  /** 這間診所的種類與名字 */
  grade: ClinicGrade
  name: string
  /** 每點生命值的價錢 */
  price: number
  /** 缺多少點（上限 − 現在） */
  missing: number
  /** 這一次實際治幾點（錢不夠時比 missing 少；一點都治不起是 0） */
  points: number
  /** 治得起全部嗎 */
  full: boolean
  cost: number
  minutes: number
  /** 錢從哪裡付；沒有要付的（0 點）是 null */
  pay: Pool | null
}

interface ClinicPlan {
  problems: string[]
  quote: ClinicQuote | null
}

/** 付 pool 這一種錢，最多治幾點。 */
const affordable = (money: GameState['money'], pool: Pool, price: number, missing: number): number => (price <= 0 ? missing : Math.min(missing, Math.floor(money[pool] / price)))

function planClinic(k: Kernel, state: GameState, o: ClinicOpts): ClinicPlan {
  if (!state.actors[o.target]) return { problems: ['找不到這個角色。'], quote: null }
  const rules = medicalRules(k)
  const problems: string[] = []
  const out = outOfBattleBlock(k, state, HEAL_ACTION)
  if (out) problems.push(out)
  const here = clinicHere(k, state)
  if (!here) return { problems: [...problems, '這裡沒有診所。'], quote: null }
  if (!state.party.includes(o.target)) problems.push('要治療的人不在隊上。')
  const t = state.actors[o.target]!
  const missing = Math.max(0, maxHpOf(k, state, o.target) - t.hp)
  if (missing === 0) problems.push(`${t.name}的生命值已經是滿的。`)
  const price = rules.heal_price[here.grade]
  // 付哪一種錢：指定的就用指定的；沒指定先找付得起全部的（帳戶優先），都付不起就挑治得起比較多的（一樣多取帳戶）
  const pools: Pool[] = o.pay ? [o.pay] : ['cred', 'cash']
  const whole = pools.find((p) => affordable(state.money, p, price, missing) >= missing)
  const pool = whole ?? pools.reduce((best, p) => (affordable(state.money, p, price, missing) > affordable(state.money, best, price, missing) ? p : best), pools[0]!)
  const points = missing === 0 ? 0 : affordable(state.money, pool, price, missing)
  if (missing > 0 && points < 1) problems.push(`錢不夠：${here.name}治一點生命值要 ${formatAmount(price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`)
  const cost = points * price
  const quote: ClinicQuote = {
    target: o.target, grade: here.grade, name: here.name, price, missing, points, full: points >= missing, cost,
    minutes: Math.ceil(points / 10) * rules.heal_minutes_per_10, pay: cost > 0 ? payPool(state.money, cost, pool) : null,
  }
  return { problems, quote }
}

/** 診所治療現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const clinicProblems = (k: Kernel, state: GameState, o: ClinicOpts): string[] => planClinic(k, state, o).problems
/** 診所治療現在行不行：第一條原因；行是 null。 */
export const clinicBlock = (k: Kernel, state: GameState, o: ClinicOpts): string | null => planClinic(k, state, o).problems[0] ?? null
/** 這一次治療的報價；人不存在或這裡沒有診所是 null。 */
export const clinicQuote = (k: Kernel, state: GameState, o: ClinicOpts): ClinicQuote | null => planClinic(k, state, o).quote

/**
 * 在診所治療。不成立丟 ActionBlocked。
 * 寫進狀態：扣錢、時間加 minutes、生命值補 points 點、掛 treated（until 是治完之後 treated_minutes）。報告 medical.heal。
 */
export function clinicHealDraft(k: Kernel, state: GameState, o: ClinicOpts): ReportDraft {
  const plan = planClinic(k, state, o)
  if (plan.problems.length > 0 || !plan.quote) throw new ActionBlocked(plan.problems[0] ?? '現在治療不了。')
  const q = plan.quote
  const rules = medicalRules(k)
  const patient = state.actors[o.target]!
  const changes: Change[] = []
  if (q.cost > 0) changes.push({ op: q.pay!, delta: -q.cost })
  changes.push(
    { op: 'time', minutes: q.minutes },
    { op: 'actor.track', id: o.target, track: 'hp', delta: q.points },
    { op: 'actor.condition', id: o.target, condition: TREATED, until: nowOf(state) + q.minutes + rules.treated_minutes },
  )
  const lines = [`${patient.name}在${CLINIC_NAME[q.grade]}（${q.name}）治療，生命值回了 ${q.points} 點${q.full ? '，回到滿了' : ''}，花了 ${formatAmount(q.cost)} 與 ${formatDuration(q.minutes)}。`]
  if (!q.full) lines.push(`錢只夠治 ${q.points} 點，還缺 ${q.missing - q.points} 點。`)
  lines.push('傷口算處理過了。')
  const data = { target: o.target, grade: q.grade, points: q.points, missing: q.missing, cost: q.cost, minutes: q.minutes, pay: q.pay }
  return reportOf(state, HEAL_ACTION, o.target, o.target, changes, lines, q.full ? 'full' : 'partial', data)
}

