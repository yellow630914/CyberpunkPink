// 花歷練點升基本功、洗點（CORE_RULES 7.2 節；dev/work/M4-abilities-m4.md）。
// 升基本功：升到 N 級花 N × ability_rule.skill_xp_per_level（10）點歷練點；直接升只到 skill_free_max（4）級，再上去要有人教（M4-training 接）；最高 6。不花遊戲時間。
//   名冊上的人（state.actors 裡的角色）照同一條：歷練點記在他自己的 ext.abilities.xp。報告 ability.skill_up。
// 洗點：要在調校診所（ability_rule.loadout_facility_types 的設施）、不在委託副本裡；洗掉一棵樹（或全部）學會的技能：退回那些歷練點、樹的累計跟著扣（累計不夠的階關起來）、
//   裝著的卸下、付每點 respec_price_per_xp（10）、時間過 respec_minutes（一天）。基本功不能退、夜課不在這裡洗。報告 ability.respec。
// 不成立時回傳原因（給玩家看的完整句子，一次一條）；草稿函式丟 ActionBlocked。

import type { ActorId, Change, GameState, Kernel, ReportDraft, SkillEntry } from '../../core'
import { ActionBlocked, SKILL_MAX, formatAmount } from '../../core'
import { abilitiesOf, reportOf } from './learn'
import { abilityRules, atTuningClinic, maskChanges } from './loadout'
import { abilityEntry } from './outside'
import type { AbilityState, PathEntry } from './types'

export const SKILL_UP_ACTION = 'ability.skill_up'
export const RESPEC_ACTION = 'ability.respec'
/** 5 級與 6 級要有人教的那一句（M4-training 的請教與上課把這一關打開：training.ts，上完的課立下記號就不擋） */
export const NEEDS_TEACHER = '5 級與 6 級要有人教。'

type Pool = 'cred' | 'cash'
const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }
type TrainKernel = Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules' | 'activity'>

const payPool = (money: GameState['money'], cost: number, want?: Pool): Pool | null => {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}

// ---- 升基本功 ----

/** 升到下一級要花幾點歷練點（目前 N 級升 N+1 級花 (N+1) × skill_xp_per_level）。 */
export const skillUpCost = (k: Pick<Kernel, 'content'>, level: number): number => (level + 1) * abilityRules(k).skill_xp_per_level

/** 現在升不升得了這一項基本功；升不了回傳第一個原因，升得了是 null。 */
export function skillUpBlock(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, skill: string): string | null {
  const a = state.actors[actor]
  if (!a) return '沒有這個角色。'
  if (!k.content.has('skill', skill)) return '沒有這項基本功。'
  const now = a.skills[skill] ?? 0
  const name = k.content.get<SkillEntry>('skill', skill)?.name ?? skill
  if (now >= SKILL_MAX) return `${name}已經練到最高的 ${SKILL_MAX} 級了。`
  const mine = abilitiesOf(state, actor)
  // 5、6 級：要有上完的課（M4-training 的 lessons：升到這一級的課，done ≥ need）
  if (now >= abilityRules(k).skill_free_max) {
    const lesson = mine.lessons?.[skill]
    if (!(lesson && lesson.level === now + 1 && lesson.done >= lesson.need)) return NEEDS_TEACHER
  }
  const cost = skillUpCost(k, now)
  const xp = mine.xp
  if (xp < cost) return `歷練點不夠（${name}升到 ${now + 1} 級要 ${cost} 點，現在 ${xp} 點）。`
  return null
}

/** 升一級基本功：花歷練點、基本功 +1。不能升就丟 ActionBlocked。 */
export function skillUpDraft(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, skill: string): ReportDraft {
  const why = skillUpBlock(k, state, actor, skill)
  if (why) throw new ActionBlocked(why)
  const mine = abilitiesOf(state, actor)
  const now = state.actors[actor]!.skills[skill] ?? 0
  const cost = skillUpCost(k, now)
  const name = k.content.get<SkillEntry>('skill', skill)?.name ?? skill
  const who = state.actors[actor]!.name
  const summary = `${who}的${name}升到了 ${now + 1} 級（花 ${cost} 點歷練點）。`
  // 升完把這一項的課拿掉（記號用過了）
  const { [skill]: _used, ...restLessons } = mine.lessons ?? {}
  const { lessons: _all, ...restMine } = mine
  const next: AbilityState = { ...restMine, xp: mine.xp - cost, ...(Object.keys(restLessons).length ? { lessons: restLessons } : {}) }
  const report = reportOf(state, actor, SKILL_UP_ACTION, next, summary, 'skill_up')
  report.changes.unshift({ op: 'actor.skill', id: actor, skill, delta: 1 } as Change)
  report.timeline = [{ layer: 'meat', actor, text: summary, tag: SKILL_UP_ACTION, data: { skill, from: now, to: now + 1, cost } }]
  return report
}

// ---- 洗點 ----

export interface RespecQuote {
  /** 洗掉的是哪一棵樹（沒寫是全部） */
  path?: string
  /** 洗掉的技能（照學會的順序） */
  abilities: string[]
  /** 退回的歷練點 */
  xp: number
  /** 每一棵樹退回多少（樹的累計跟著扣） */
  byPath: Record<string, number>
  /** 要付的錢 */
  price: number
  minutes: number
  /** 洗掉之後會卸下的技能（本來裝著的） */
  unequipped: string[]
}

/** 洗點的報價：洗哪些、退多少、付多少、卸下哪些。不檢查能不能洗（respecBlock 管）。 */
export function respecQuote(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, o: { path?: string } = {}): RespecQuote {
  const mine = abilitiesOf(state, actor)
  const rules = abilityRules(k)
  const abilities: string[] = []
  const byPath: Record<string, number> = {}
  for (const id of mine.learned) {
    const ab = abilityEntry(k, id)
    if (!ab || (o.path !== undefined && ab.path !== o.path)) continue
    abilities.push(id)
    byPath[ab.path] = (byPath[ab.path] ?? 0) + ab.xp
  }
  const xp = Object.values(byPath).reduce((n, v) => n + v, 0)
  return {
    ...(o.path !== undefined ? { path: o.path } : {}), abilities, xp, byPath, price: xp * rules.respec_price_per_xp, minutes: rules.respec_minutes,
    unequipped: mine.equipped.filter((id) => abilities.includes(id)),
  }
}

/** 現在洗不洗得了；洗不了回傳第一個原因，洗得了是 null。 */
export function respecBlock(k: TrainKernel, state: GameState, actor: ActorId, o: { path?: string; pay?: Pool } = {}): string | null {
  if (!state.actors[actor]) return '沒有這個角色。'
  if (o.path !== undefined && !k.content.has('path', o.path)) return '沒有這棵樹。'
  if (state.battle) return '戰鬥中不能洗點。'
  if (k.activity.active(state).some((a) => a.kind === 'commission')) return '進了委託副本就不能洗點，要回到調校診所才行。'
  // 條件 at_facility 沒有人註冊（沒有 world）時不限地點，和換配置一樣
  if (k.conditions.kinds().includes('at_facility') && !atTuningClinic(k, state, actor)) return '要在調校診所才能洗點。'
  const q = respecQuote(k, state, actor, o)
  if (q.abilities.length === 0) {
    const name = o.path !== undefined ? k.content.get<PathEntry>('path', o.path)?.name : undefined
    return name ? `${name}這棵樹還沒有學會任何技能，沒有可以洗的。` : '還沒有學會任何技能，沒有可以洗的。'
  }
  if (q.price > 0 && payPool(state.money, q.price, o.pay) === null) return `錢不夠：洗點要 C$${formatAmount(q.price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`
  return null
}

/**
 * 洗點：洗掉一棵樹（沒給 path 是全部）學會的技能。退回歷練點、樹的累計跟著扣、裝著的卸下、付錢、時間過一天。
 * 錢沒指定 pay 時先帳戶、不夠再現金。不能洗就丟 ActionBlocked。
 */
export function respecDraft(k: TrainKernel, state: GameState, actor: ActorId, o: { path?: string; pay?: Pool } = {}): ReportDraft {
  const why = respecBlock(k, state, actor, o)
  if (why) throw new ActionBlocked(why)
  const mine = abilitiesOf(state, actor)
  const q = respecQuote(k, state, actor, o)
  const spent = { ...mine.spent }
  for (const [path, v] of Object.entries(q.byPath)) {
    const left = (spent[path] ?? 0) - v
    if (left > 0) spent[path] = left
    else delete spent[path]
  }
  const learned = mine.learned.filter((id) => !q.abilities.includes(id))
  const equipped = mine.equipped.filter((id) => !q.abilities.includes(id))
  const { stance, ...rest } = mine
  const next: AbilityState = { ...rest, xp: mine.xp + q.xp, learned, equipped, spent, ...(stance !== undefined && equipped.includes(stance) ? { stance } : {}) }
  const pool = payPool(state.money, q.price, o.pay)!
  const treeName = o.path !== undefined ? k.content.get<PathEntry>('path', o.path)?.name ?? o.path : '所有的樹'
  const summary = `洗掉了${treeName}學會的 ${q.abilities.length} 個技能，退回 ${q.xp} 點歷練點${q.price > 0 ? `，付了 C$${formatAmount(q.price)}` : ''}；休養了一天。`
  const report = reportOf(state, actor, RESPEC_ACTION, next, summary, 'respec')
  report.changes = [
    { op: 'time', minutes: q.minutes } as Change,
    ...(q.price > 0 ? [{ op: pool, delta: -q.price } as Change] : []),
    ...report.changes,
    ...maskChanges(k, state, actor, mine.equipped, equipped),
  ]
  report.timeline = [{ layer: 'meat', actor, text: summary, tag: RESPEC_ACTION, data: { path: o.path ?? null, abilities: q.abilities, xp: q.xp, price: q.price, unequipped: q.unequipped } }]
  return report
}
