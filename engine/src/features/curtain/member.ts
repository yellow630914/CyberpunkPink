// L6 功能 curtain 的入會：邀請函、面談、會員證、不收的人、會費（CYBERSPACE 8.8 節「怎麼進去」「能不能反覆去」；dev/adr/0019 P56）。
//
// 邀請函：效果 curtain_invite 設到三天後（效果在 index.ts）。誰給邀請函是內容（介紹人、試鏡、蚌殼市的老攤）。
// 面談：一次檢定（交涉或表演，DC 照席次）。要有沒過期的邀請函、距離上一次失敗滿七天、不在「不收的人」裡、街頭信譽夠。過了領會員證（從散座起；會員要升一席：
//   在目前的席次破關滿 upgrade_clears 次、信譽夠、再面談一次，這時不用邀請函；介紹人與月榜不檢查，P56、P57）。停權之後要重新面談：邀請函也要重來，從散座起。
// 會費：掛點 bill.collect 每週出一行；bill.settled 付了 paid_until 往後一週；連續 fee_grace_weeks 週沒付就停權。
// 掛點 bill.collect、bill.settled 是 features/bills 宣告的：這裡只認名字與格式，不 import。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, DEGREE_NAME, REP_TIERS, REP_TIER_NAME, clone, dcFor, meterOf, repTierOf, rollCheck } from '../../core'
import type { CurtainRules, InterviewSkill, MemberRecord, RunRecord, TierDef, TierId } from './model'
import {
  DAY_MINUTES, FEE_BILL_ID, INTERVIEW_ACTION, INTERVIEW_SKILLS, OWNER, curtainChange, curtainRules, mondayOf, nowOf, readCurtain, tierIndex, tierOf, weekIndexOf, weekMinutes,
} from './model'
import { featureOf, nightPool, runsTonight, weekOf } from './nights'

const repName = (tier: number): string => REP_TIER_NAME[REP_TIERS[Math.max(0, Math.min(REP_TIERS.length - 1, tier))]!]
const factionName = (k: Pick<Kernel, 'content'>, id: string): string => {
  const f = k.content.hasKind('faction') ? k.content.get('faction', id) : undefined
  return f ? String(f.short ?? f.name ?? id) : id
}

// ---- 門檻：橋、甲板、不收的人 ----

/** 這個人有橋嗎（用條件 has_bridge 問；沒有人註冊就當沒有）。 */
export function hasBridge(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, actor: string): boolean {
  if (!state.actors[actor] || !k.conditions.kinds().includes('has_bridge')) return false
  return k.conditions.test({ kind: 'has_bridge' }, { state, actor, stats: k.stats, timeRules: k.timeRules })
}

/** 這個人有自己的甲板嗎（衍生數值 deck_grade 大於 0；沒有人定義就當沒有）。 */
export function hasDeck(k: Pick<Kernel, 'stats'>, state: GameState, actor: string): boolean {
  return !!state.actors[actor] && k.stats.hasStat('deck_grade') && k.stats.stat(state, actor, 'deck_grade') > 0
}

/** 「不收的人」（CYBERSPACE 8.8 節）：沉溺 80 以上、溺感者、規則表列的勢力敵對值 40 以上、沒有橋、沒有甲板。一條一個原因，沒有是空的。 */
export function refuseReasons(k: Kernel, state: GameState, actor: string, rules: CurtainRules = curtainRules(k)): string[] {
  const a = state.actors[actor]
  if (!a) return ['找不到這個角色。']
  const p: string[] = []
  const who = actor === state.pc ? '你' : a.name
  if (a.sink >= rules.refuse.sink) p.push(a.sink >= 100 ? `館方不收溺感者：${who}的沉溺已經 ${a.sink}。` : `館方怕出事，不收沉溺 ${rules.refuse.sink} 以上的人：${who}現在 ${a.sink}。`)
  for (const f of rules.refuse.factions) {
    const v = meterOf(k, state, 'hostility', f)
    if (v >= rules.refuse.hostility) p.push(`${factionName(k, f)}對你的敵對值到了 ${v}（${rules.refuse.hostility} 以上館方不收）。`)
  }
  if (!hasBridge(k, state, actor)) p.push(`沒有橋的人進不了簾後館：${who}沒有橋。`)
  if (!hasDeck(k, state, actor)) p.push(`館方不租甲板：${who}要有自己的甲板。`)
  return p
}

// ---- 面談 ----

export interface InterviewOpts {
  tier: TierId
  skill: InterviewSkill
}

const isSkill = (v: unknown): v is InterviewSkill => (INTERVIEW_SKILLS as readonly unknown[]).includes(v)

/** 面談的門檻（和用哪一項基本功無關）：一條一個原因，沒有是空的。 */
export function interviewProblems(k: Kernel, state: GameState, tierId: string): string[] {
  const rules = curtainRules(k)
  const tier = tierOf(rules, tierId)
  if (!tier) return [`沒有「${tierId}」這個席次。`]
  if (!state.pc || !state.actors[state.pc]) return ['還沒有主角，沒有人可以面談。']
  const other = k.activity.blockOf(state, `commit:${INTERVIEW_ACTION}`)
  if (other) return [other]
  const cur = readCurtain(state)
  if (cur.run) return ['你正在簾後館裡，等這一趟結束再談。']
  const now = nowOf(state)
  const p: string[] = []
  const m = cur.member
  if (m && !m.suspended) {
    const mi = tierIndex(m.tier)
    const ti = tierIndex(tier.id)
    if (ti <= mi) return [`你已經是${tierOf(rules, m.tier)?.name ?? m.tier}的會員了。`]
    if (ti > mi + 1) p.push(`升席要一席一席升：你現在是${tierOf(rules, m.tier)?.name ?? m.tier}，下一席是${rules.tiers[mi + 1]?.name ?? '沒有了'}。`)
    if (m.clears < rules.upgrade_clears) p.push(`升席要在目前的席次破關 ${rules.upgrade_clears} 次（你現在 ${m.clears} 次）。`)
  } else {
    if (tier.id !== 'floor') p.push('第一次入會只能從散座起。')
    if (!cur.invite || cur.invite.until <= now) p.push(m?.suspended ? '會費逾期停權了：要重新面談，邀請函也要重來，而你手上沒有有效的邀請函。' : '你沒有有效的邀請函（邀請函三天有效）。')
  }
  if (cur.interview_at !== undefined) {
    const left = cur.interview_at + rules.interview_retry_days * DAY_MINUTES - now
    if (left > 0) p.push(`上一次面談沒過，還要等 ${Math.ceil(left / DAY_MINUTES)} 天才能再談。`)
  }
  p.push(...refuseReasons(k, state, state.pc, rules))
  const rep = repTierOf(meterOf(k, state, 'rep'))
  if (rep < tier.rep_min) p.push(`街頭信譽要到「${repName(tier.rep_min)}」才談得${tier.name}（你現在是「${repName(rep)}」）。`)
  return p
}

/** 現在面談不成立的原因（一條一個，包含用哪一項基本功）；能談是空的。 */
export function interviewBlocks(k: Kernel, state: GameState, o: InterviewOpts): string[] {
  const p = interviewProblems(k, state, o.tier)
  if (!isSkill(o.skill)) p.push(`面談只能擲交涉或表演（${INTERVIEW_SKILLS.join('、')}）。`)
  return p
}

/** 現在面談不成立的原因（句子）；能談是 null。 */
export function interviewBlock(k: Kernel, state: GameState, o: InterviewOpts): string | null {
  const p = interviewBlocks(k, state, o)
  return p.length ? p.join('') : null
}

const SKILL_ATTR: Record<InterviewSkill, string> = { negotiate: 'charm', perform: 'charm' }

/** 面談（報告 curtain.interview）：擲交涉或表演對席次的 DC。過了領會員證（或升席），邀請函用掉；沒過記下時間，七天內不能再談。 */
export function interviewDraft(k: Kernel, state: GameState, o: InterviewOpts): ReportDraft {
  const p = interviewBlocks(k, state, o)
  if (p.length) throw new ActionBlocked(p.join(''))
  const rules = curtainRules(k)
  const tier = tierOf(rules, o.tier)!
  const pc = state.pc!
  const cur = readCurtain(state)
  const now = nowOf(state)
  const attr = (k.content.hasKind('skill') ? (k.content.get('skill', o.skill)?.attr as string | undefined) : undefined) ?? SKILL_ATTR[o.skill]
  const dc = dcFor(tier.interview_dc, state.rules)
  const roll = rollCheck(k.stats, state, { actor: pc, attr: attr as never, skill: o.skill, dc, purpose: `${INTERVIEW_ACTION}/${tier.id}/${o.skill}`, tags: ['curtain', 'interview'] })
  const passed = roll.degree === 'critical' || roll.degree === 'success'
  const changes: Change[] = [{ op: 'rng', advance: 1 }]
  const up = !!cur.member && !cur.member.suspended
  const lines: string[] = []
  if (passed) {
    delete cur.interview_at
    delete cur.invite
    cur.member = up
      ? { ...cur.member!, tier: tier.id, clears: 0 }
      : { tier: tier.id, since: now, paid_until: mondayOf(k, weekIndexOf(k, now) + 1), clears: 0 }
    lines.push(up ? `面談過了：你升到了${tier.name}。` : `面談過了：你領到了簾後館的會員證，從${tier.name}坐起。`)
  } else {
    cur.interview_at = now
    lines.push(`面談沒過：${tier.name}的人沒有點頭。${rules.interview_retry_days} 天之後才能再談。`)
  }
  changes.push(curtainChange(cur))
  return {
    kind: 'action', action: INTERVIEW_ACTION, location: clone(state.location), actor: pc, party: [],
    timeline: [
      { layer: 'meat', actor: pc, text: lines[0]!, tag: INTERVIEW_ACTION, data: { tier: tier.id, skill: o.skill, passed, upgrade: up } },
      { layer: 'meat', actor: pc, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'curtain.roll', data: { degree: roll.degree } },
    ],
    changes, outcome: { result: passed ? (up ? 'upgraded' : 'joined') : 'failed', summary: lines.join('') }, narration: { results: lines },
  }
}

// ---- 會費（掛點 bill.collect、bill.settled） ----

interface SettledLine {
  id: string
  owner: string
  kind: string
  paid: number
  unpaid: number
  skipped?: true
}

/** 這個會員這一週的會費（沒有會員、停權了就沒有）。 */
export function feeLine(k: Kernel, state: GameState): { id: string; owner: string; name: string; kind: 'due'; amount: number; order: number; pay: 'cred' } | null {
  const m = readCurtain(state).member
  if (!m || m.suspended) return null
  const rules = curtainRules(k)
  const tier = tierOf(rules, m.tier)
  if (!tier || tier.fee_weekly <= 0) return null
  return { id: FEE_BILL_ID, owner: OWNER, name: `簾後館的會費（${tier.name}）`, kind: 'due', amount: tier.fee_weekly, order: rules.fee_order, pay: 'cred' }
}

/** 一週結算之後會費的後果：付了 paid_until 往後一週；沒付（含玩家停掉的）算逾期，連續 fee_grace_weeks 週就停權、邀請函作廢。回傳要套的變更。 */
export function feeSettled(k: Kernel, state: GameState, week: number, lines: readonly SettledLine[]): Change[] {
  const line = lines.find((l) => l.owner === OWNER && l.id === FEE_BILL_ID && l.kind === 'due')
  const cur = readCurtain(state)
  const m = cur.member
  if (!line || !m || m.suspended) return []
  const every = weekMinutes(k)
  const monday = mondayOf(k, week)
  const paid = line.unpaid <= 0 && line.skipped !== true
  if (paid) {
    m.paid_until = Math.max(m.paid_until, monday + every)
  } else {
    const late = Math.floor((monday + every - m.paid_until) / every)
    if (late >= curtainRules(k).fee_grace_weeks) {
      m.suspended = true
      delete cur.invite
    }
  }
  cur.member = m
  return [curtainChange(cur)]
}

/** 會費逾期幾週（還沒停權的）：會費繳到的那個週一到下一個還沒付的週一之間，過了幾個週一。 */
export function overdueWeeks(k: Kernel, state: GameState, m: MemberRecord): number {
  const now = nowOf(state)
  return now < m.paid_until ? 0 : Math.floor((now - m.paid_until) / weekMinutes(k)) + 1
}

// ---- 給畫面的 ----

export interface TierView {
  id: TierId
  name: string
  grade: number
  deposit: number
  fee_weekly: number
  prize: number
  /** 街頭信譽要到的階（序號與名字） */
  rep_min: number
  rep_name: string
  interview_dc: number
  /** 你現在的席次 */
  current: boolean
  /** 現在能不能去面談（新入會是散座；升席是下一席）與不能的原因 */
  canInterview: boolean
  /** 這個席次的面談現在不成立的原因；也就是「能不能升與為什麼」 */
  blocks: string[]
}

export interface MemberView {
  /** 邀請函：到什麼時候為止；沒有或過期是 null */
  invite: { until: number; daysLeft: number } | null
  member: { tier: TierId; name: string; grade: number; since: number; clears: number; suspended: boolean; fee_weekly: number; paid_until: number; overdue: number } | null
  /** 面談失敗之後還要等幾天（沒有是 0） */
  retryDays: number
  /** 這一週的主打 */
  feature: { id: string; name: string } | null
  /** 口味單（還開著的標籤） */
  taste: string[]
  pure_stage: boolean
  /** 這一週這個席次抽得到的夜有幾個 */
  nights: number
  /** 今晚已經報了幾場、還能報幾場 */
  runsTonight: number
  runsLeft: number
  /** 這一週的打賞 */
  tips: number
  tiers: TierView[]
  /** 現在正在簾後館裡的這一趟 */
  run: RunRecord | null
}

/** 會員的全貌：邀請函、席次、會費繳到哪、這一週的主打、今晚還能報幾場、每個席次能不能升與原因。純函式，不改狀態。 */
export function memberView(k: Kernel, state: GameState): MemberView {
  const rules = curtainRules(k)
  const cur = readCurtain(state)
  const now = nowOf(state)
  const m = cur.member
  const tier = m ? tierOf(rules, m.tier) : undefined
  const pool = nightPool(k, state, rules)
  const feature = featureOf(k, state)
  const tonight = runsTonight(k, state)
  const retryLeft = cur.interview_at !== undefined ? cur.interview_at + rules.interview_retry_days * DAY_MINUTES - now : 0
  const active = !!m && !m.suspended
  return {
    invite: cur.invite && cur.invite.until > now ? { until: cur.invite.until, daysLeft: Math.ceil((cur.invite.until - now) / DAY_MINUTES) } : null,
    member: m && tier ? { tier: m.tier, name: tier.name, grade: tier.grade, since: m.since, clears: m.clears, suspended: m.suspended === true, fee_weekly: tier.fee_weekly, paid_until: m.paid_until, overdue: overdueWeeks(k, state, m) } : null,
    retryDays: retryLeft > 0 ? Math.ceil(retryLeft / DAY_MINUTES) : 0,
    feature: feature ? { id: feature.id, name: feature.name } : null,
    taste: pool.taste, pure_stage: pool.pure_stage, nights: pool.rows.length,
    runsTonight: tonight, runsLeft: Math.max(0, rules.runs_per_night - tonight), tips: weekOf(k, state).tips,
    tiers: rules.tiers.map((t: TierDef): TierView => {
      const blocks = interviewProblems(k, state, t.id)
      return {
        id: t.id, name: t.name, grade: t.grade, deposit: t.deposit, fee_weekly: t.fee_weekly, prize: t.prize, rep_min: t.rep_min, rep_name: repName(t.rep_min), interview_dc: t.interview_dc,
        current: active && m!.tier === t.id, canInterview: blocks.length === 0, blocks,
      }
    }),
    run: cur.run ? clone(cur.run) : null,
  }
}
