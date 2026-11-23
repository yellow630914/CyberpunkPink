// L6 功能 fixer 的召集（M2-fixer-pay 的第一拍）：進副本之前替輔助面請人的四種辦法、向中間人借人、退人。
// 規格：COMMISSIONS 6.1、6.5 節；NPC_SYSTEM 10.5 節（出場費）；FIXER 第 8 節（人情只記在主角名下）；dev/adr/0016 第三節；dev/work/M2-fixer-pay.md。
//
// 每個入口都是純函式：讀狀態、回傳報告草稿或畫面要的資料；不成立丟 ActionBlocked（原因是給玩家看的完整句子，一條一個條件）。
// 這個功能不 import 別的功能：出場費讀衍生數值 roster_fee（沒有人註冊當 0）、名冊讀條件 in_roster、人情讀條件 has_favor 與變更 favor.spend、效果 owed；
// 沒有人註冊的辦法就不列。付出去的東西記在手上那一件的 aux（cost），退人與撤退時才知道退什麼。

import type { Actor, Change, GameState, Kernel, ReportDraft } from '../../core'
import { ATTR_IDS, ActionBlocked, DEGREE_NAME, checkParts, clone, computeDegree, effectCtx, formatAmount, isRecord, meterOf, toMinutes } from '../../core'
import { fixerDraft as draft } from './board'
import type { AuxEntry, AuxFace, FavorSize, HireCost, HireWay, Job } from './model'
import { AUX_FACES, AUX_FACE_NAME, COMMISSION_ACTIVITY, FAVOR_SIZE_NAME, HIRE_NAME, HIRE_WAYS, attrOfSkill, auxList, fixerRules, gradeOf, jobOf, rollBest } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 請不動的狀況（NPC_SYSTEM 10.0；roster 的有空也是這四個）：共用的字彙。 */
const BUSY_CONDITIONS = ['busy', 'injured', 'lying_low', 'arrested'] as const
const BUSY_TEXT: Record<(typeof BUSY_CONDITIONS)[number], (name: string) => string> = {
  busy: (n) => `${n}現在有別的事在忙。`,
  injured: (n) => `${n}受傷了，這陣子請不動。`,
  lying_low: (n) => `${n}正在躲風頭。`,
  arrested: (n) => `${n}被關起來了。`,
}

function hasCondition(state: Pick<GameState, 'actors' | 'time'>, id: string, condition: string): boolean {
  const a = Object.hasOwn(state.actors, id) ? state.actors[id] : undefined
  if (!a) return false
  const now = toMinutes(state.time)
  return a.conditions.some((c) => c.id === condition && (c.until === undefined || c.until > now))
}

const nameOf = (state: Pick<GameState, 'actors'>, id: string): string => (Object.hasOwn(state.actors, id) ? state.actors[id]!.name : id)
const condCtx = (k: Kernel, state: GameState) => ({ state, stats: k.stats, timeRules: k.timeRules })

/** 這個人一件委託的出場費（衍生數值 roster_fee；沒有人註冊、不在狀態裡、拿分紅的是 0）。 */
export function feeOf(k: Pick<Kernel, 'stats'>, state: GameState, actor: string): number {
  if (!k.stats.hasStat('roster_fee') || !Object.hasOwn(state.actors, actor)) return 0
  return Math.max(0, Math.round(k.stats.stat(state, actor, 'roster_fee')))
}

const hasFavorKind = (k: Kernel): boolean => k.conditions.kinds().includes('has_favor') && !!k.changes.get('favor.spend')

/** 他欠你的人情裡，頂得了一個小人情的那一種（小的先用，沒有再用中的）。 */
function favorHeld(k: Kernel, state: GameState, who: string): FavorSize | null {
  if (!hasFavorKind(k)) return null
  for (const size of ['small', 'mid'] as const) if (k.conditions.test({ kind: 'has_favor', dir: 'owed_to_pc', who, size }, condCtx(k, state))) return size
  return null
}

// ---- 這一面不成立的原因（和請的是誰無關）----

function faceBlocks(k: Kernel, state: GameState, job: Job, face: AuxFace): string[] {
  if (job.status !== 'active') return [`「${job.title}」已經${job.status === 'done' ? '做完' : '失敗'}了，沒有什麼好請人的。`]
  if (k.activity.active(state).some((a) => a.kind === COMMISSION_ACTIVITY)) return ['副本已經開始了，要在出發之前請人。']
  if (!(AUX_FACES as readonly string[]).includes(face)) return [`沒有「${String(face)}」這一面（只有 ${AUX_FACES.join('、')}）。`]
  if (!job.commission.stages.some((st) => isRecord(st.faces) && Object.hasOwn(st.faces, face))) return [`這件委託沒有${AUX_FACE_NAME[face]}面，派人去沒有用。`]
  const max = fixerRules(k).aux_max
  const n = job.aux[face]?.length ?? 0
  return n >= max ? [`${AUX_FACE_NAME[face]}面已經請了 ${n} 個人，每一面最多 ${max} 個。`] : []
}

/** 請這個人去這一面，現在不成立的所有原因（一條一個條件）；請得到是空的。 */
export function hireBlocks(k: Kernel, state: GameState, job: Job, face: AuxFace, actor: string): string[] {
  const p = faceBlocks(k, state, job, face)
  if (!state.pc) p.push('還沒有主角。')
  if (!isText(actor) || !Object.hasOwn(state.actors, actor)) return [...p, '查不到這個人。']
  const name = nameOf(state, actor)
  if (actor === state.pc) return [...p, '主角自己不用請。']
  if (state.party.includes(actor)) p.push(`${name}在你的隊上，隊上的人跟著你走，不用另外請。`)
  const there = auxList(job).find((e) => e.actor === actor)
  if (there) p.push(`${name}已經在這件委託裡了（派在${AUX_FACE_NAME[there.face]}面）。`)
  if (k.conditions.kinds().includes('in_roster') && !k.conditions.test({ kind: 'in_roster', who: actor }, condCtx(k, state))) p.push(`${name}不在你的名冊上。`)
  for (const c of BUSY_CONDITIONS) if (!(c === 'busy' && there) && hasCondition(state, actor, c)) p.push(BUSY_TEXT[c](name))
  return p
}

// ---- 四種辦法 ----

export interface HireOption {
  way: HireWay
  name: string
  /** 代價（給玩家看的完整句子） */
  cost: string
  /** 付出去的東西（照這一筆記進 aux 的 cost） */
  price: HireCost
  /** 成功率（百分比）；付錢、人情、忠誠夠高的不用擲，是 100 */
  chance: number
  /** 要擲的話：DC 與加值；不用擲是 null */
  roll: { dc: number; bonus: number; skill: string } | null
  /** 選不了的原因（第一個）；選得了是 null */
  block: string | null
}

/** 靠交情的 DC：20 − 親密度 ÷ 5（向下取整）。 */
export function bondDc(k: Kernel, state: GameState, actor: string): number {
  const r = fixerRules(k)
  return r.bond_dc_base - Math.floor(meterOf(k, state, 'affinity', actor) / r.bond_affinity_step)
}

/** 擲骰的用途（同一件委託、同一個人，骰面一定一樣；報告裡的 rng 變更讓下一次換一顆）。測試用它找骰面。 */
export const bondPurpose = (jobId: string, actor: string): string => `fixer/${jobId}/bond/${actor}`

function bondRoll(k: Kernel, state: GameState, actor: string): HireOption['roll'] & {} {
  const skill = 'negotiate'
  const dc = bondDc(k, state, actor)
  const bonus = checkParts(k.stats, state, state.pc!, { attr: attrOfSkill(k, skill), skill, tags: ['fixer', 'bond'] }).reduce((s, x) => s + x.value, 0)
  return { dc, bonus, skill }
}

function chanceOf(roll: { dc: number; bonus: number }): number {
  let ok = 0
  for (let natural = 1; natural <= 20; natural++) {
    const d = computeDegree(natural, natural + roll.bonus, roll.dc)
    if (d === 'critical' || d === 'success') ok++
  }
  return ok * 5
}

/**
 * 替這一面請這個人的辦法：各自成不成立、代價、成功率（COMMISSIONS 6.5 節的表）。
 * 付錢（出場費；拿分紅的不收）、靠交情（擲交涉對 20 − 親密度 ÷ 5，忠誠 70 以上不用擲）一定列；
 * 用人情、欠人情要有人註冊人情的條件、變更與效果才列（人情的功能沒裝時只有那兩種）。
 */
export function hireOptions(k: Kernel, state: GameState, job: Job, face: AuxFace, actor: string): HireOption[] {
  const general = hireBlocks(k, state, job, face, actor)
  const out: HireOption[] = []
  const name = nameOf(state, actor)
  const rules = fixerRules(k)
  const first = (specific: string | null): string | null => general[0] ?? specific

  const fee = feeOf(k, state, actor)
  out.push({
    way: 'pay', name: HIRE_NAME.pay, price: fee > 0 ? { cash: fee } : {}, chance: 100, roll: null,
    cost: fee > 0 ? `付他的出場費 ${formatAmount(fee)} 現金。` : `${name}拿分紅，不收出場費；做完之後分一份。`,
    block: first(fee > state.money.cash ? `出場費要 ${formatAmount(fee)} 現金，你現在只有 ${formatAmount(state.money.cash)}。` : null),
  })

  if (hasFavorKind(k)) {
    const size = Object.hasOwn(state.actors, actor) ? favorHeld(k, state, actor) : null
    out.push({
      way: 'use_favor', name: HIRE_NAME.use_favor, price: size ? { favor: { kind: 'used', who: actor, size } } : {}, chance: 100, roll: null,
      cost: size ? `用掉${name}欠你的一個${FAVOR_SIZE_NAME[size]}人情；用掉的不會退。` : '用掉一個他欠你的小人情。',
      block: first(size ? null : `${name}沒有欠你人情，沒有可以用掉的。`),
    })
  }
  if (k.effects.has('owed')) {
    out.push({
      way: 'owe_favor', name: HIRE_NAME.owe_favor, price: { favor: { kind: 'owed', who: actor, size: 'small' } }, chance: 100, roll: null,
      cost: `${name}答應，但你欠他一個小人情。`, block: first(null),
    })
  }

  if (state.pc && Object.hasOwn(state.actors, actor)) {
    const loyalty = meterOf(k, state, 'loyalty', actor)
    const auto = loyalty >= rules.bond_loyalty
    const roll = auto ? null : bondRoll(k, state, actor)
    out.push({
      way: 'bond', name: HIRE_NAME.bond, price: {}, chance: roll ? chanceOf(roll) : 100, roll,
      cost: auto ? `${name}信得過你（忠誠 ${loyalty}），不用擲，也沒有代價。` : `擲交涉（魅力）對 DC ${roll!.dc}；失敗的話${name}這一件不肯，這個辦法不能再用。`,
      block: first(job.bond_failed.includes(actor) ? `你已經試過靠交情請${name}了，他這一件不肯，只能換別的辦法。` : null),
    })
  }
  return out
}

/** 借人的價錢：等級² × 200 的 1.5 倍（COMMISSIONS 6.5 節）。 */
export function borrowPrice(k: Kernel, job: Job): number {
  const r = fixerRules(k)
  const g = gradeOf(job.commission)
  return Math.round(g * g * r.borrow_base * r.borrow_mult)
}

/** 向中間人借一個人：照委託的等級生成一位只有基本功的行者，只能付錢，沒有分量修正。 */
export function borrowOption(k: Kernel, state: GameState, job: Job, face: AuxFace): HireOption {
  const price = borrowPrice(k, job)
  const general = faceBlocks(k, state, job, face)
  return {
    way: 'borrow', name: HIRE_NAME.borrow, price: { cash: price }, chance: 100, roll: null,
    cost: `向中間人借一位等級 ${gradeOf(job.commission)} 的行者，付 ${formatAmount(price)} 現金（出場費的 ${fixerRules(k).borrow_mult} 倍）；他只有基本功，沒有分量修正，做完就走。`,
    block: general[0] ?? (price > state.money.cash ? `借人要 ${formatAmount(price)} 現金，你現在只有 ${formatAmount(state.money.cash)}。` : null),
  }
}

// ---- 借來的人 ----

/** 借來的臨時角色：只有基本功（那一面相關的基本功，等級照委託的等級），沒有路數；之後在入帳或撤退時移除。 */
function lentActor(k: Kernel, state: GameState, job: Job, face: AuxFace, n: number): Actor {
  const safe = job.id.toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 40)
  let id = `lent_${safe}_${n}`
  for (let i = 1; Object.hasOwn(state.actors, id); i++) id = `lent_${safe}_${n}_${i}`
  const rule = k.content.get('commission_rule', 'default')
  const listed = isRecord(rule) && isRecord(rule.aux_skills) && Array.isArray(rule.aux_skills[face]) ? (rule.aux_skills[face] as unknown[]).filter(isText) : []
  const skills = listed.length > 0 ? listed : DEFAULT_LENT_SKILLS[face]
  const level = Math.min(6, gradeOf(job.commission))
  return {
    id, name: `借來的行者（${n}）`, role: 'npc', age: 25, perks: [], hp: 30, load: 0, afterglow: 0, sink: 0,
    attrs: Object.fromEntries(ATTR_IDS.map((a) => [a, 10])) as Actor['attrs'], skills: Object.fromEntries(skills.map((s) => [s, level])),
    conditions: [{ id: 'busy' }], ext: { lent: job.id },
  }
}
const DEFAULT_LENT_SKILLS: Record<AuxFace, string[]> = { meat: ['firearms', 'brawl', 'stealth', 'athletics'], net: ['interface'], opinion: ['perform', 'negotiate'] }

// ---- 請 ----

export interface HireInput {
  face: AuxFace
  way: HireWay
  /** 向中間人借人（way 是 borrow）時不用給 */
  actor?: string
}

function needJob(state: GameState, id: string): Job {
  const job = jobOf(state, id)
  if (!job) throw new ActionBlocked(`手上沒有 ${id} 這件委託。`)
  return job
}

/**
 * 請一個人（報告 fixer.hire）：付代價、記進手上那件委託的 aux、在他身上掛 busy。
 * 靠交情要擲骰：成功照常請到；失敗不丟錯（骰子已經擲了），報告記下這個人這一件不能再用這個辦法。
 * 借人（way: 'borrow'）生成臨時角色。成立不了丟 ActionBlocked（原因是第一條）。
 */
export function hire(k: Kernel, state: GameState, jobId: string, input: HireInput): ReportDraft {
  const job = needJob(state, jobId)
  if (!(HIRE_WAYS as readonly string[]).includes(input?.way)) throw new ActionBlocked(`請人的辦法只能是 ${HIRE_WAYS.join('、')}。`)
  if (!state.pc) throw new ActionBlocked('還沒有主角。')
  const face = input.face
  if (input.way === 'borrow') return borrow(k, state, job, face)
  const actor = input.actor
  if (!isText(actor)) throw new ActionBlocked('要說請誰。')
  const opt = hireOptions(k, state, job, face, actor).find((o) => o.way === input.way)
  if (!opt) throw new ActionBlocked(`「${HIRE_NAME[input.way]}」這種辦法現在沒有開放（人情的功能沒有裝，或這個人不能請）。`)
  if (opt.block) throw new ActionBlocked(opt.block)
  const name = nameOf(state, actor)
  const faceName = AUX_FACE_NAME[face]
  const changes: Change[] = []
  const lines: string[] = []
  const timeline: ReportDraft['timeline'] = []
  let cost: HireCost = {}

  if (opt.way === 'pay') {
    const fee = opt.price.cash ?? 0
    if (fee > 0) changes.push({ op: 'cash', delta: -fee })
    cost = fee > 0 ? { cash: fee } : {}
    lines.push(fee > 0 ? `你付了 ${name} 出場費 ${formatAmount(fee)} 現金。` : `${name}答應了：他拿分紅，做完之後分一份。`)
  } else if (opt.way === 'use_favor') {
    const f = opt.price.favor!
    changes.push({ op: 'favor.spend', dir: 'owed_to_pc', who: actor, size: f.size })
    cost = { favor: { ...f } }
    lines.push(`你用掉了${name}欠你的一個${FAVOR_SIZE_NAME[f.size]}人情，他答應了。`)
  } else if (opt.way === 'owe_favor') {
    const res = k.effects.resolve([{ kind: 'owed', who: actor, size: 'small' }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length > 0) throw new ActionBlocked(`欠人情記不下來：${res.errors.join('；')}`)
    changes.push(...res.changes)
    cost = { favor: { kind: 'owed', who: actor, size: 'small' } }
    lines.push(`${name}答應了，但你欠他一個小人情。`)
  } else if (opt.roll === null) {
    lines.push(`${name}信得過你，二話不說答應了。`)
  } else {
    const r = rollBest(k, state, [opt.roll.skill], opt.roll.dc, bondPurpose(job.id, actor), ['fixer', 'bond'])
    const degree = r.roll.degree
    timeline.push({
      layer: 'meat', actor: state.pc, tag: 'fixer.bond', roll: r.roll, data: { skill: r.skill, dc: opt.roll.dc, who: actor },
      text: `靠交情請${name}（${k.stats.skillName(r.skill)}）：${DEGREE_NAME[degree]}（骰 ${r.roll.natural}，合計 ${r.roll.total}，對 DC ${opt.roll.dc}）`,
    })
    if (degree !== 'critical' && degree !== 'success') {
      return draft(state, 'fixer.hire', 'bond_failed', `靠交情請${name}去${faceName}面：他不肯。`, [
        { op: 'rng', advance: 1 },
        { op: 'fixer.bond_fail', job: job.id, actor },
      ], { timeline, narration: { results: [`${name}搖了搖頭：這一件他不肯。靠交情的辦法不能再用在他身上了。`] } })
    }
    changes.push({ op: 'rng', advance: 1 })
    lines.push(`${name}看在交情的份上答應了。`)
  }

  const entry: AuxEntry = { actor, way: opt.way, cost }
  changes.push({ op: 'actor.condition', id: actor, condition: 'busy' }, { op: 'fixer.hire', job: job.id, face, entry })
  return draft(state, 'fixer.hire', 'hired', `請了${name}去${faceName}面（${HIRE_NAME[opt.way]}）。`, changes, { timeline, narration: { results: lines } })
}

function borrow(k: Kernel, state: GameState, job: Job, face: AuxFace): ReportDraft {
  const opt = borrowOption(k, state, job, face)
  if (opt.block) throw new ActionBlocked(opt.block)
  const price = opt.price.cash!
  const who = lentActor(k, state, job, face, job.borrow_n + 1)
  const entry: AuxEntry = { actor: who.id, way: 'borrow', cost: { cash: price } }
  return draft(state, 'fixer.hire', 'borrowed', `向中間人借了一個人去${AUX_FACE_NAME[face]}面。`, [
    { op: 'cash', delta: -price },
    { op: 'actor.add', actor: who },
    { op: 'fixer.hire', job: job.id, face, entry },
  ], { narration: { results: [`你付了 ${formatAmount(price)} 現金，中間人替你派了一位行者去${AUX_FACE_NAME[face]}面。`] } })
}

// ---- 退人 ----

/** 把一個請來的人退掉要套的變更：錢退、欠下的人情取消、用掉的人情不退；他身上的 busy 拿掉，借來的臨時角色移除。 */
export function unhireChanges(k: Kernel, state: GameState, job: Pick<Job, 'id'>, entry: AuxEntry): { changes: Change[]; lines: string[] } {
  const changes: Change[] = []
  const lines: string[] = []
  const name = nameOf(state, entry.actor)
  const cash = entry.cost.cash ?? 0
  if (cash > 0) {
    changes.push({ op: 'cash', delta: cash })
    lines.push(`${formatAmount(cash)} 現金退回來了。`)
  }
  const f = entry.cost.favor
  if (f?.kind === 'owed' && hasFavorKind(k) && k.conditions.test({ kind: 'has_favor', dir: 'owed_by_pc', who: f.who, size: f.size }, condCtx(k, state))) {
    changes.push({ op: 'favor.spend', dir: 'owed_by_pc', who: f.who, size: f.size })
    lines.push(`你欠${nameOf(state, f.who)}的那個人情取消了。`)
  }
  if (f?.kind === 'used') lines.push('用掉的人情不退。')
  if (Object.hasOwn(state.actors, entry.actor)) {
    if (entry.way === 'borrow') changes.push({ op: 'actor.remove', id: entry.actor })
    else if (hasCondition(state, entry.actor, 'busy')) changes.push({ op: 'actor.condition', id: entry.actor, condition: 'busy', remove: true })
  }
  changes.push({ op: 'fixer.unhire', job: job.id, actor: entry.actor })
  return { changes, lines: [`${name}不去了。`, ...lines] }
}

/** 出發之前把請的人退掉（報告 fixer.unhire）：錢退、用掉的人情不退。 */
export function unhire(k: Kernel, state: GameState, jobId: string, actor: string): ReportDraft {
  const job = needJob(state, jobId)
  if (job.status !== 'active') throw new ActionBlocked(`「${job.title}」已經${job.status === 'done' ? '做完' : '失敗'}了。`)
  if (k.activity.active(state).some((a) => a.kind === COMMISSION_ACTIVITY)) throw new ActionBlocked('副本已經開始了，出發之後不能退人。')
  const entry = auxList(job).find((e) => e.actor === actor)
  if (!entry) throw new ActionBlocked('這件委託沒有請這個人。')
  const out = unhireChanges(k, state, job, entry)
  return draft(state, 'fixer.unhire', 'unhired', `退掉了${nameOf(state, actor)}。`, out.changes, { narration: { results: out.lines } })
}

/** 撤退（狀態回到進副本之前）之後，這件委託請的人全部退掉：付出去的出場費回來、busy 拿掉、借來的人移除。 */
export function retreatRefund(k: Kernel, restored: GameState, jobId: string): { changes: Change[]; lines: string[] } {
  const job = jobOf(restored, jobId)
  if (!job || job.status !== 'active') return { changes: [], lines: [] }
  const changes: Change[] = []
  const lines: string[] = []
  for (const e of auxList(job)) {
    const out = unhireChanges(k, restored, job, e)
    changes.push(...out.changes)
    lines.push(...out.lines)
  }
  return { changes, lines: lines.length > 0 ? ['你撤退了，請來的人都不用去了。', ...lines] : [] }
}

/** 出發要併進副本 setup 的 aux：每一面的角色 id，加上哪些是借來的；沒請人是 null。 */
export function auxSetup(job: Pick<Job, 'aux'>): { meat?: string[]; net?: string[]; opinion?: string[]; borrowed?: string[] } | null {
  const out: { meat?: string[]; net?: string[]; opinion?: string[]; borrowed?: string[] } = {}
  const borrowed: string[] = []
  for (const face of AUX_FACES) {
    const list = job.aux[face] ?? []
    if (list.length === 0) continue
    out[face] = list.map((e) => e.actor)
    for (const e of list) if (e.way === 'borrow') borrowed.push(e.actor)
  }
  if (Object.keys(out).length === 0) return null
  if (borrowed.length > 0) out.borrowed = borrowed
  return clone(out)
}
