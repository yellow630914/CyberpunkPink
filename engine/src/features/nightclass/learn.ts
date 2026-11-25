// L6 功能 nightclass 的學習：開階、看得到哪些、現在學不學得了、花體悟（LEWD_SYSTEM 10.1～10.3 節；NIGHT_LESSONS；dev/adr/0019 第十節、P31）。
//   開階    共通看性經歷（次數或對象的人數擇一，單人的次數不算）；其餘四支看那一條軸的等級（衍生數值 night_tier_<分支>）
//   看得到  標籤（tag、tags、filters）被內容篩選關掉的整個不列；掛在一個標籤上（不是共通、不是只掛軸）而這個人沒有的不列
//   學習    階開了、requires 都過（橋參數看有效值、experience、conditions 用 k.conditions；沒有人註冊的種類當作不成立：「這個條件現在還判斷不了。」）、體悟夠
//   學會    扣體悟、actor.ext.scene.skills 多一筆，技能開放的體位加進 actor.ext.scene.positions（變更 nightclass.learn）；名冊上的人照同一條（體悟是全隊共用的那一個量表）
// 不成立時回傳原因（給玩家看的完整句子，一條一個條件）；草稿函式丟 ActionBlocked。

import type { ActorId, Condition, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord, meterOf } from '../../core'
import type { Branch, NightSkill } from './model'
import {
  BRANCHES, BRANCH_NAME, INSIGHT_KEY, INSIGHT_METER, LEARN_ACTION, LEARN_OP, PARAM_NAME, TIER_STAT,
  computeTier, costOf, experienceOf, hiddenReason, learnedOf, nightRules, skillOf, skillsOf, unlockedPositions,
} from './model'

/** 一個分支開到幾階（0～5）：衍生數值 night_tier_<分支>（別的功能可以加 provider；沒有註冊時照規則算）。 */
export function nightTier(k: Pick<Kernel, 'stats' | 'content'>, state: GameState, actor: ActorId, branch: Branch): number {
  const a = state.actors[actor]
  if (!a) return 0
  return k.stats.hasStat(TIER_STAT(branch)) ? k.stats.stat(state, actor, TIER_STAT(branch)) : computeTier(nightRules(k), a, branch)
}

/** 現在有多少體悟（全隊共用的那一個量表）。 */
export const insightOf = (k: Pick<Kernel, 'meters'>, state: GameState): number => meterOf(k, state, INSIGHT_METER, INSIGHT_KEY)

type Ctx = Pick<Kernel, 'stats' | 'content' | 'conditions' | 'meters' | 'timeRules'>

/** 橋參數的有效值（衍生數值 bridge_<參數>；沒有人註冊時讀 actor.ext.bridge）；沒有橋是 null。 */
function bridgeValue(k: Pick<Kernel, 'stats'>, state: GameState, actor: ActorId, param: keyof typeof PARAM_NAME): number | null {
  const a = state.actors[actor]
  const raw = a && isRecord(a.ext.bridge) ? a.ext.bridge[param] : undefined
  if (!a || (typeof raw !== 'number' && !k.stats.hasStat(`bridge_${param}`))) return null
  if (k.stats.hasStat(`bridge_${param}`)) return k.stats.stat(state, actor, `bridge_${param}`)
  return Number.isFinite(raw) ? (raw as number) : null
}

/** 一個條件現在判斷得了嗎：種類有人註冊（all、any、not 看裡面）。 */
function judgeable(c: Condition, kinds: Set<string>): boolean {
  if (c.kind === 'all' || c.kind === 'any') return Array.isArray(c.of) && (c.of as Condition[]).every((x) => x && typeof x.kind === 'string' && judgeable(x, kinds))
  if (c.kind === 'not') return !!c.of && typeof (c.of as Condition).kind === 'string' && judgeable(c.of as Condition, kinds)
  return kinds.has(c.kind)
}

/** 學習條件裡的每一條沒過的原因（階以外的：橋參數、性經歷、條件）；一條一句。 */
function requireBlocks(k: Ctx, state: GameState, actor: ActorId, s: NightSkill): string[] {
  const out: string[] = []
  const a = state.actors[actor]!
  for (const r of s.requires.bridge) {
    const have = bridgeValue(k, state, actor, r.param)
    const name = PARAM_NAME[r.param]
    if (have === null) out.push(`要看${name}，可是你現在沒有橋。`)
    else if (r.bound === 'min' && have < r.value) out.push(`${name}要有 ${r.value}，你現在是 ${have}。`)
    else if (r.bound === 'max' && have > r.value) out.push(`${name}要在 ${r.value} 以下，你現在是 ${have}。`)
  }
  const x = experienceOf(a)
  const need = s.requires.experience
  if (need.times !== undefined && x.times < need.times) out.push(`性經歷要 ${need.times} 次，你現在是 ${x.times} 次。`)
  if (need.partners !== undefined && x.partners < need.partners) out.push(`要和 ${need.partners} 個人有過，你現在是 ${x.partners} 個。`)
  if (need.service_times !== undefined && x.service_times < need.service_times) out.push(`做過的服務要有 ${need.service_times} 次，你現在是 ${x.service_times} 次。`)
  if (need.favorite && !x.favorite) out.push('要有一個最喜歡的人。')
  if (s.requires.conditions.length > 0) {
    const kinds = new Set(k.conditions.kinds())
    for (const c of s.requires.conditions) {
      if (!judgeable(c, kinds)) {
        out.push('這個條件現在還判斷不了。')
        continue
      }
      let ok = false
      try {
        ok = k.conditions.test(c, { state, actor, stats: k.stats, timeRules: k.timeRules })
      } catch {
        out.push('這個條件現在還判斷不了。')
        continue
      }
      if (!ok) out.push(typeof c.text === 'string' && c.text.trim() ? c.text : `還沒有滿足需要的條件（${c.kind}）。`)
    }
  }
  return out
}

/** 階沒開的那一句。 */
function tierBlock(s: NightSkill, open: number): string {
  return s.branch === 'common'
    ? `共通的 ${s.tier} 階還沒開：看性經歷的次數或對象的人數（現在開到 ${open} 階）。`
    : `${BRANCH_NAME[s.branch]}這一條要到 ${s.tier} 級才開 ${s.tier} 階（現在 ${open} 級）。`
}

export type LearnStatus = 'learned' | 'learnable' | 'tier_closed' | 'unmet'

export interface LearnView {
  id: string
  name: string
  branch: Branch
  tier: number
  /** 要花的體悟 */
  cost: number
  /** 掛的標籤（沒有是 null） */
  tag: string | null
  /** learned 學會了；learnable 現在能學；tier_closed 階還沒開；unmet 條件不夠（橋參數、性經歷、條件或體悟不夠） */
  status: LearnStatus
  /** 現在不能學的第一個原因（能學、學會了是 null） */
  reason: string | null
  /** 現在不能學的每一個原因（一條一句） */
  reasons: string[]
  /** 這個技能開放的體位（id） */
  positions: string[]
}

export interface BranchView {
  branch: Branch
  name: string
  /** 這個分支開到幾階 */
  tier: number
  skills: LearnView[]
}

export interface NightListView {
  actor: ActorId
  /** 現在的體悟（全隊共用） */
  insight: number
  branches: BranchView[]
}

/** 一個技能對這個人的狀態與原因（技能要查得到；看不到的另外有原因）。 */
function viewOf(k: Ctx, state: GameState, actor: ActorId, s: NightSkill, tiers: Record<Branch, number>, insight: number): LearnView {
  const rules = nightRules(k)
  const cost = costOf(rules, s)
  const base = { id: s.id, name: s.name, branch: s.branch, tier: s.tier, cost, tag: s.tag, positions: unlockedPositions(k, s.id) }
  if (learnedOf(state.actors[actor]).includes(s.id)) return { ...base, status: 'learned', reason: null, reasons: [] }
  if (s.tier > tiers[s.branch]) {
    const why = tierBlock(s, tiers[s.branch])
    return { ...base, status: 'tier_closed', reason: why, reasons: [why] }
  }
  const reasons = requireBlocks(k, state, actor, s)
  if (insight < cost) reasons.push(`要 ${cost} 點體悟，現在只有 ${insight} 點。體悟從成人場景與成人事件來，不能用歷練點換。`)
  return reasons.length > 0 ? { ...base, status: 'unmet', reason: reasons[0]!, reasons } : { ...base, status: 'learnable', reason: null, reasons: [] }
}

/**
 * 夜課列表：每個分支開到幾階、這個人看得到的每個技能（標籤被內容篩選關掉的、掛在他沒有的標籤上的整個不列）。
 * 技能照內容的順序，分支與階分組。沒有這個角色回傳空的。
 */
export function nightList(k: Ctx, state: GameState, actor: ActorId): NightListView {
  const a = state.actors[actor]
  const tiers = Object.fromEntries(BRANCHES.map((b) => [b, nightTier(k, state, actor, b)])) as Record<Branch, number>
  const insight = insightOf(k, state)
  const all = a ? skillsOf(k).filter((s) => hiddenReason(state.rules.contentOff, a, s) === null) : []
  return {
    actor, insight,
    branches: BRANCHES.map((branch) => ({
      branch, name: BRANCH_NAME[branch], tier: tiers[branch],
      skills: all.filter((s) => s.branch === branch).sort((x, y) => x.tier - y.tier).map((s) => viewOf(k, state, actor, s, tiers, insight)),
    })),
  }
}

/** 現在學不學得了這個技能：每個擋住的原因一句（空的就是學得了）。 */
export function learnProblems(k: Ctx, state: GameState, actor: ActorId, id: string): string[] {
  const a = state.actors[actor]
  if (!a) return ['沒有這個角色。']
  const s = skillOf(k, id)
  if (!s) return ['沒有這個夜課技能。']
  const hidden = hiddenReason(state.rules.contentOff, a, s)
  if (hidden !== null) return [hidden]
  const tiers = Object.fromEntries(BRANCHES.map((b) => [b, nightTier(k, state, actor, b)])) as Record<Branch, number>
  const view = viewOf(k, state, actor, s, tiers, insightOf(k, state))
  return view.status === 'learned' ? ['已經學會了。'] : view.reasons
}

/** 現在學不學得了：學得了是 null，否則是第一個原因（一次一條）。戰鬥中、成人場景進行中學不了。 */
export function learnBlock(k: Ctx & Pick<Kernel, 'activity'>, state: GameState, actor: ActorId, id: string): string | null {
  if (state.battle) return '戰鬥中學不了夜課。'
  const act = k.activity.blockOf(state, `commit:${LEARN_ACTION}`)
  if (act) return act
  return learnProblems(k, state, actor, id)[0] ?? null
}

/** 學一個夜課技能：扣體悟、記進 actor.ext.scene.skills，技能開放的體位一起加進 positions。不成立丟 ActionBlocked（原因是 learnBlock 的第一條）。報告 nightclass.learn。 */
export function learnDraft(k: Ctx & Pick<Kernel, 'activity'>, state: GameState, actor: ActorId, id: string): ReportDraft {
  const why = learnBlock(k, state, actor, id)
  if (why) throw new ActionBlocked(why)
  const a = state.actors[actor]!
  const s = skillOf(k, id)!
  const cost = costOf(nightRules(k), s)
  const positions = unlockedPositions(k, id)
  const who = a.name
  const summary = `${who}學會了夜課「${s.name}」（花 ${cost} 點體悟）。`
  const lines = [summary]
  if (positions.length > 0) {
    const names = positions.map((p) => (k.content.get('position', p)?.name as string | undefined) ?? p)
    lines.push(`${who}多會了${names.map((n) => `「${n}」`).join('、')}。`)
  }
  return {
    kind: 'action', action: LEARN_ACTION, location: clone(state.location), actor, party: [],
    timeline: lines.map((text, i) => ({ layer: 'meat' as const, actor, text, tag: i === 0 ? LEARN_ACTION : 'nightclass.position', ...(i === 0 ? { data: { skill: id, cost, branch: s.branch, tier: s.tier, positions } } : {}) })),
    changes: [
      { op: 'meter', kind: INSIGHT_METER, key: INSIGHT_KEY, delta: -cost },
      { op: LEARN_OP, id: actor, skill: id, positions },
    ],
    outcome: { result: 'learned', summary }, narration: { results: lines }, adult: true,
  }
}

