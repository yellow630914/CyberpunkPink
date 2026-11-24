// L6 功能 fixer 的第二、三拍：踩點、買情報、踩點的畫面資料；走到地點、帶著踩到的東西進副本。
// 規格：FIXER 第 2 節②（含「踩點的規則」整段）與③的開頭；COMMISSIONS 2.3 節「分支」、第 4 節；UI 7.2 節；dev/adr/0016 第一節；dev/work/M2-fixer.md。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, DEGREE_NAME, clone, formatAmount } from '../../core'
import { briefOf, fixerDraft as draft, revealedStages } from './board'
import type { BriefView } from './board'
import type { Cat, Job, ScoutEntry, ScoutMethod, UnknownItem } from './model'
import { auxSetup } from './hire'
import {
  CAT_NAME, COMMISSION_ACTIVITY, HOSTILITY_TIER_PURSUIT, HOSTILITY_TIER_TROUBLE, auxList, LOCKED_METHODS, SCOUT_METHODS, fixerRules, gradeOf, hiddenUnknowns, hostilityAtLeast, jobOf, methodOf, methodsFor, methodTargets, rollBest, scoutDc, scoutedOf, stageCount,
} from './model'

function needJob(state: GameState, id: string): Job {
  const job = jobOf(state, id)
  if (!job) throw new ActionBlocked(`手上沒有 ${id} 這件委託。`)
  if (job.status !== 'active') throw new ActionBlocked(`「${job.title}」已經${job.status === 'done' ? '做完' : '失敗'}了。`)
  return job
}

/** 擲骰的用途（同一件委託、同一次踩點，骰面一定一樣；報告裡的 rng 變更讓下一次換一顆）。測試用它找骰面。 */
export const scoutPurpose = (jobId: string, n: number): string => `fixer/${jobId}/scout/${n}`

// ---- 踩點 ----

/** 這一次踩點不成立的原因（第一個）；成立是 null。 */
export function scoutBlock(job: Job, m: ScoutMethod): string | null {
  const max = stageCount(job.commission)
  if (job.scouts >= max) return `這件委託最多踩 ${max} 次點（階段數），已經踩滿了。`
  if (methodTargets(job, m).length === 0) return `${m.name}現在沒有東西可以揭開（${m.cats.map((c) => CAT_NAME[c]).join('、')}這幾類都已經知道了，或這件委託沒有這幾類的未知）。`
  return null
}

/**
 * 踩點一次（FIXER 第 2 節「踩點的規則」）：選一種手段，擲它的基本功對 10 ＋ 等級 × 2（第 4 次起 +1），花一個時段（4 小時）。
 * 超過 5 以上揭開兩項（其中有「路」就是開出一條踩點開出來的路）、成功揭開一項、失敗沒有、自然 1 驚動目標：警戒（內海是追蹤度）的起始 +15。
 * 揭開哪一項由程式在那個手段揭得開的類裡照清單的順序挑。
 */
export function scout(k: Kernel, state: GameState, jobId: string, method: string): ReportDraft {
  const job = needJob(state, jobId)
  const locked = LOCKED_METHODS.find((l) => l.id === method)
  if (locked) throw new ActionBlocked(`${locked.name}：${locked.block}`)
  const m = methodOf(method)
  if (!m) throw new ActionBlocked(`沒有 ${method} 這種踩點的手段。`)
  const block = scoutBlock(job, m)
  if (block) throw new ActionBlocked(block)
  const rules = fixerRules(k)
  const n = job.scouts + 1
  const grade = gradeOf(job.commission)
  const dc = scoutDc(rules, grade, n)
  const r = rollBest(k, state, m.skills, dc, scoutPurpose(job.id, n), ['fixer', 'scout', m.id])
  const degree = r.roll.degree
  const targets = methodTargets(job, m)
  const picked: UnknownItem[] = degree === 'critical' ? targets.slice(0, 2) : degree === 'success' ? targets.slice(0, 1) : []
  const entry: ScoutEntry = {
    n, method: m.id, skill: r.skill, natural: r.roll.natural, total: r.roll.total, dc, degree, revealed: picked.map((u) => u.id), day: state.time.day,
    ...(degree === 'fumble' ? (m.layer === 'net' ? { trace: rules.scout_alert } : { alert: rules.scout_alert }) : {}),
  }
  const lines: string[] = picked.map((u) => `揭開了（${CAT_NAME[u.cat]}）：${u.text}`)
  if (degree === 'critical' && picked.some((u) => u.cat === 'path')) lines.push('踩出了一條路：進去的時候多一條走法。')
  if (picked.length === 0 && degree !== 'fumble') lines.push('什麼都沒有查到。')
  if (degree === 'fumble') lines.push(m.layer === 'net' ? `你驚動了目標：進內海的時候，追蹤度的起始值 +${rules.scout_alert}。` : `你驚動了目標：進去的時候，警戒的起始值 +${rules.scout_alert}。`)
  const changes: Change[] = [
    { op: 'rng', advance: 1 },
    ...(rules.scout_minutes > 0 ? [{ op: 'time', minutes: rules.scout_minutes } as Change] : []),
    { op: 'fixer.scout', job: job.id, entry },
  ]
  return draft(state, 'fixer.scout', degree, `為「${job.title}」${m.name}（第 ${n} 次）：${DEGREE_NAME[degree]}。`, changes, {
    timeline: [{
      layer: m.layer, ...(state.pc ? { actor: state.pc } : {}), tag: 'fixer.scout', roll: r.roll, data: { skill: r.skill, dc, method: m.id, revealed: entry.revealed },
      text: `${m.name}（${k.stats.skillName(r.skill)}）：${DEGREE_NAME[degree]}（骰 ${r.roll.natural}，合計 ${r.roll.total}，對 DC ${dc}）`,
    }],
    narration: { results: lines },
  })
}

// ---- 買情報 ----

export type IntelWith = 'cash' | 'favor'
const FAVOR_SIZES = ['small', 'mid', 'big'] as const

export interface IntelOption {
  id: IntelWith
  name: string
  /** 價錢：現金是等級 × 300；人情是一個 */
  price: number
  cost: string
  block: string | null
}

/** 用哪一種人情付：中間人欠你的人情，小的先用（有人情的功能沒裝或沒有人情是 null）。 */
function favorToSpend(k: Kernel, state: GameState, job: Job): (typeof FAVOR_SIZES)[number] | null {
  if (!k.conditions.kinds().includes('has_favor')) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  return FAVOR_SIZES.find((size) => k.conditions.test({ kind: 'has_favor', dir: 'owed_to_pc', who: job.npc, size }, ctx)) ?? null
}

/** 買情報的付法（FIXER 第 2 節：價錢是委託等級 × 300，或用掉一個人情；人情要有人註冊 owed_to_pc 才列）。 */
export function intelOptions(k: Kernel, state: GameState, job: Job): IntelOption[] {
  const price = gradeOf(job.commission) * fixerRules(k).intel_per_grade
  const out: IntelOption[] = [{
    id: 'cash', name: '付現金', price, cost: `${formatAmount(price)} 現金。`,
    block: state.money.cash >= price ? null : `買這一項要 ${formatAmount(price)} 現金，你現在只有 ${formatAmount(state.money.cash)}。`,
  }]
  if (k.effects.has('owed_to_pc') && k.changes.get('favor.spend')) {
    const size = favorToSpend(k, state, job)
    out.push({ id: 'favor', name: '用掉一個人情', price: 1, cost: '用掉中間人欠你的一個人情。', block: size ? null : '中間人沒有欠你人情，沒有可以用掉的。' })
  }
  return out
}

/** 買情報：不擲，指定一項未知，付錢或人情就直接揭開。不花時間，也不算踩點的次數。 */
export function buyIntel(k: Kernel, state: GameState, jobId: string, unknownId: string, pay: IntelWith = 'cash'): ReportDraft {
  const job = needJob(state, jobId)
  const u = job.unknowns.find((x) => x.id === unknownId)
  if (!u) throw new ActionBlocked(`這件委託沒有 ${unknownId} 這一項未知。`)
  if (job.revealed.includes(u.id)) throw new ActionBlocked('這一項已經知道了。')
  const option = intelOptions(k, state, job).find((o) => o.id === pay)
  if (!option) throw new ActionBlocked(pay === 'favor' ? '人情的功能沒有裝，不能用人情買情報。' : '買情報只能付現金或用人情。')
  if (option.block) throw new ActionBlocked(option.block)
  const changes: Change[] = []
  let paid: string
  if (pay === 'cash') {
    changes.push({ op: 'cash', delta: -option.price })
    paid = `付了 ${formatAmount(option.price)} 現金`
  } else {
    changes.push({ op: 'favor.spend', dir: 'owed_to_pc', who: job.npc, size: favorToSpend(k, state, job)! })
    paid = '用掉了一個人情'
  }
  changes.push({ op: 'fixer.reveal', job: job.id, ids: [u.id] })
  return draft(state, 'fixer.buy_intel', 'bought', `為「${job.title}」買了一項情報。`, changes, { narration: { results: [`${paid}。`, `揭開了（${CAT_NAME[u.cat]}）：${u.text}`] } })
}

// ---- 畫面資料 ----

export interface MethodRow {
  id: string
  name: string
  skills: string[]
  cats: Cat[]
  layer: 'meat' | 'net'
  /** 現在能不能用；不能用是原因 */
  block: string | null
  /** 這一次的 DC */
  dc: number
}

export interface UnknownRow {
  id: string
  cat: Cat
  cat_name: string
  revealed: boolean
  /** 揭開了才有內容；沒揭開是 null（畫面寫「？？？？」） */
  text: string | null
  /** 哪些手段揭得開（沒揭開的格子下面寫） */
  methods: string[]
}

export interface ScoutView {
  job: string
  /** 已經踩了幾次、最多幾次 */
  done: number
  max: number
  /** 下一次的 DC，與難度開始 +1 的是第幾次 */
  next_dc: number
  hard_from: number
  /** 一次花幾分鐘 */
  minutes: number
  unknowns: UnknownRow[]
  methods: MethodRow[]
  /** 灰掉的手段（進人偶館當班、派名冊的人去踩點） */
  locked: Array<{ id: string; name: string; block: string }>
  intel: IntelOption[]
  /** 上一次的結果 */
  last: ScoutEntry | null
  brief: BriefView
  alert_start: number
  trace_start: number
}

/** 踩點頁（UI 7.2 節）要的資料：未知清單、踩點的次數與難度、手段、上一次的結果、副本的樣子。 */
export function scoutView(k: Kernel, state: GameState, jobId: string): ScoutView {
  const job = jobOf(state, jobId)
  if (!job) throw new ActionBlocked(`手上沒有 ${jobId} 這件委託。`)
  const rules = fixerRules(k)
  const max = stageCount(job.commission)
  const grade = gradeOf(job.commission)
  const next = job.scouts + 1
  const dc = scoutDc(rules, grade, next)
  const active = job.status === 'active'
  return {
    job: job.id, done: job.scouts, max, next_dc: dc, hard_from: rules.scout_hard_from, minutes: rules.scout_minutes,
    unknowns: job.unknowns.map((u) => {
      const revealed = job.revealed.includes(u.id)
      return { id: u.id, cat: u.cat, cat_name: CAT_NAME[u.cat], revealed, text: revealed ? u.text : null, methods: methodsFor(u.cat).map((m) => m.id) }
    }),
    methods: SCOUT_METHODS.map((m) => ({
      id: m.id, name: m.name, skills: [...m.skills], cats: [...m.cats], layer: m.layer,
      block: active ? scoutBlock(job, m) : '這件委託已經結束了。', dc,
    })),
    locked: LOCKED_METHODS.map((l) => ({ ...l })),
    intel: active ? intelOptions(k, state, job) : [],
    last: job.log.at(-1) ? clone(job.log.at(-1)!) : null,
    brief: briefOf(k, job, revealedStages(job)),
    alert_start: job.alert_start, trace_start: job.trace_start,
  }
}

/** 還沒揭開、買得了的未知（給畫面列「買情報」的選項）。 */
export const buyable = (job: Job): UnknownItem[] => hiddenUnknowns(job)

// ---- 出發 ----

/** 出發不成立的原因（第一個）；成立是 null。有人註冊條件 in_block 而且委託寫了入口的街區時，要人在那一塊街區。 */
export function goBlock(k: Kernel, state: GameState, job: Job): string | null {
  if (job.status !== 'active') return `「${job.title}」已經${job.status === 'done' ? '做完' : '失敗'}了。`
  if (!state.pc) return '還沒有主角，出發不了。'
  const block = job.commission.block
  if (typeof block === 'string' && block && k.conditions.kinds().includes('in_block')) {
    const here = k.conditions.test({ kind: 'in_block', blocks: [block] }, { state, stats: k.stats, timeRules: k.timeRules })
    if (!here) return `要先走到委託的地點（${String(k.content.get('block', block)?.name ?? block)}）才能出發。`
  }
  const gone = auxList(job).find((e) => !Object.hasOwn(state.actors, e.actor))
  if (gone) return `你請的人（${gone.actor}）已經不在了，先把他退掉。`
  return null
}

/** 詞條讓警戒一開始就比較高：生成的副本帶 alert_start 欄位（gen.ts），沒寫是 0。 */
const startBonus = (c: Record<string, unknown>): number => (typeof c.alert_start === 'number' && Number.isSafeInteger(c.alert_start) && c.alert_start > 0 ? c.alert_start : 0)

/**
 * 出發（FIXER 第 2 節③的開頭）：這份報告開一場副本（launch commission），帶著這件委託的副本、踩到的東西（scouted）、警戒的起始值與談好的條件（terms）。
 * 請了人（hire）的話，aux 也併進 setup（每一面的角色 id、哪些是借來的）。origin 是 { by: 'fixer', ref: 這件委託的 id }。出發只記一個「出發過了」（fixer.depart；放棄的信譽看它）：撤退時狀態回到出發之後、進副本之前，委託還在手上，踩過的點與這個記號都還在。
 */
export function go(k: Kernel, state: GameState, jobId: string): ReportDraft {
  const job = needJob(state, jobId)
  const block = goBlock(k, state, job)
  if (block) throw new ActionBlocked(block)
  const s = scoutedOf(job)
  const aux = auxSetup(job)
  // 目標勢力對你的敵對值（FACTIONS 6.1 節）：找麻煩 → 遭遇預算 +1；追捕 → 警戒起始 +20（高的段包含低的段）。出發的這一刻看，副本裡再漲不算
  const rules = fixerRules(k)
  const target = typeof job.commission.target_faction === 'string' && job.commission.target_faction !== 'none' ? job.commission.target_faction : null
  const troubled = target !== null && hostilityAtLeast(k, state, target, HOSTILITY_TIER_TROUBLE)
  const pursued = target !== null && hostilityAtLeast(k, state, target, HOSTILITY_TIER_PURSUIT)
  const plus = troubled ? rules.hostile_budget : 0
  const setup = {
    // 警戒的起始值：踩點驚動的加上詞條帶的（生成的副本的 alert_start 欄位）、追捕的加成
    def: clone(job.commission), scouted: s.scouted, alert_start: Math.min(100, s.alert_start + startBonus(job.commission) + (pursued ? rules.hostile_alert : 0)), terms: clone(job.terms),
    ...(plus > 0 ? { encounter_plus: plus } : {}),
    ...(s.trace_start > 0 ? { trace_start: s.trace_start } : {}),
    ...(aux ? { aux } : {}),
  }
  const warn = pursued ? '對方正在追捕你，警戒一開始就比平常高。' : troubled ? '對方在找你麻煩，守備比平常多。' : null
  return draft(state, 'fixer.go', 'go', `出發去做「${job.title}」。`, [{ op: 'fixer.depart', id: job.id }], {
    launch: [{ kind: COMMISSION_ACTIVITY, setup, origin: { by: 'fixer', ref: job.id } }],
    narration: { results: [`你帶著這件委託出發了：${job.title}。`, ...(warn ? [warn] : [])] },
  })
}
