// 基本功 5、6 級的請教與上課（CORE_RULES 7.2 節「基本功的規則」、7.5 節；NPC_SYSTEM 6.1 節的「請教」；dev/work/M4-training.md）。
// 升基本功（train.ts 的 skillUpDraft）到 5、6 級時會被擋（NEEDS_TEACHER）；這裡讓人上完課、立下「可以升這一級」的記號（actor.ext.abilities.lessons[基本功] 的 done ≥ need），skillUpDraft 看到記號就不擋。
//
// 兩個來源：
//   向人請教（from: { npc }）：那個人（角色）那一項要比學的人高、而且至少 skill_free_max + 1（5）級；他幾級就教到幾級。三種付法（pay）：
//     affinity  親密度（量表 affinity，鍵是他的 id）到 teach.affinity（40）以上，不收錢
//     tuition   付學費（teach.tuition：升到 5 級 1,500、6 級 5,000），第一個時段付清
//     favor     旗標 taught:<npc>:<skill> 立著（替他做過一件事；事件是內容，這裡只認旗標）
//     人要在那個人現在所在的地方：問條件 npc_here { npc }（features/npcs 註冊；沒有人註冊就不限）。
//   去機構上課（from: { facility }）：腳下的設施種類有這一項的 teach: [{ skill, price, slots, needs? }]；只教到 FACILITY_MAX（5）級；學費第一個時段付清；needs 的條件都成立才能上。
// 每升一級要上 teach.slots_per_level（2；機構是資料寫的 slots）個時段，一次一個時段（teach.slot_minutes，240 分鐘）；上到一半換老師（或換級）進度不留，重來。
// 名冊上的人（state.party 裡的角色）照同一條：opts.actor 指他；親密度、旗標都是主角的。
// 條件 can_teach { npc, skill? }：那個人有沒有哪一項（或指定的那一項）基本功比 ctx.actor（沒有是主角）高、而且是 5 級以上（只看等級，不看別的）。
// 報告 ability.lesson；不成立時回傳原因（給玩家看的完整句子，一次一條）；草稿函式丟 ActionBlocked。
// 不 import features/npcs：他在不在場問條件 npc_here；親密度用核心的 meterOf 讀量表 affinity；旗標讀 state.flags。

import type { ActorId, Change, Condition, ContentEntry, GameState, Kernel, ReportDraft, SkillEntry } from '../../core'
import { ActionBlocked, SKILL_MAX, formatAmount, isRecord, isSafeInt, meterOf } from '../../core'
import { abilitiesOf, reportOf } from './learn'
import { abilityRules } from './loadout'
import { skillUpCost } from './train'
import type { AbilityState, Lesson } from './types'
import { OWNER } from './types'

export const LESSON_ACTION = 'ability.lesson'
/** 機構最多教到幾級（CORE_RULES 7.5 節：機構不教 6 級） */
export const FACILITY_MAX = 5
const FACILITY_KIND = 'facility_type'
const AFFINITY = 'affinity'

export type TeachPay = 'affinity' | 'tuition' | 'favor'
export type TeachFrom = { npc: string } | { facility: string }
type Pool = 'cred' | 'cash'
const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }
const PAY_ORDER: readonly TeachPay[] = ['affinity', 'favor', 'tuition']

type TrainKernel = Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules' | 'activity' | 'meters'>

/** 設施種類多讀的 teach 一筆 */
export interface FacilityTeach {
  skill: string
  price: number
  slots: number
  needs?: Condition[]
}

/** 替他做過一件事的旗標 */
export const taughtFlag = (npc: string, skill: string): string => `taught:${npc}:${skill}`

const sameFrom = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b)
const skillName = (k: Pick<Kernel, 'content'>, skill: string): string => k.content.get<SkillEntry>('skill', skill)?.name ?? skill
const payPool = (money: GameState['money'], cost: number, want?: Pool): Pool | null => {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}
const flagOn = (state: GameState, key: string): boolean => {
  const v = state.flags[key]
  return v !== undefined && v !== false
}
const condCtx = (k: Pick<Kernel, 'stats' | 'timeRules'>, state: GameState, actor: ActorId) => ({ state, stats: k.stats, timeRules: k.timeRules, actor })

/** 這個人最低要幾級才教得動（skill_free_max + 1：預設 5）。 */
export const teachMin = (k: Pick<Kernel, 'content'>): number => abilityRules(k).skill_free_max + 1

/** 那個人（角色）能教這個學生哪幾項：他的等級要比學生高、而且至少 teachMin；沒有這個角色是空的。 */
export function teachableSkills(k: Pick<Kernel, 'content'>, state: GameState, student: ActorId, npc: string): string[] {
  const teacher = state.actors[npc]
  const me = state.actors[student]
  if (!teacher || !me || npc === student) return []
  const min = teachMin(k)
  return Object.entries(teacher.skills)
    .filter(([skill, level]) => k.content.has('skill', skill) && level >= min && level > (me.skills[skill] ?? 0))
    .map(([skill]) => skill)
    .sort()
}

// ---- 設施 ----

/** 腳下的設施種類裡，有這一項的 teach 的那一筆（沒有 facility_type 內容、沒有人註冊 at_facility 都是 null）。 */
function facilityHere(k: TrainKernel, state: GameState, actor: ActorId, skill: string, only?: string): { id: string; name: string; teach: FacilityTeach; open: boolean } | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_KIND)) return null
  for (const t of k.content.list<ContentEntry & { name?: unknown; teach?: unknown }>(FACILITY_KIND)) {
    if (only !== undefined && t.id !== only) continue
    if (!Array.isArray(t.teach)) continue
    const row = (t.teach as FacilityTeach[]).find((r) => r.skill === skill)
    if (!row) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, condCtx(k, state, actor))) continue
    // 營業時段（M4-followups-2 第 10 項）：站在那裡但現在沒開，還是回傳這一筆（open: false），上課那一步寫「現在沒有營業」
    const open = k.conditions.test({ kind: 'at_facility', types: [t.id], open: true }, condCtx(k, state, actor))
    return { id: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, teach: row, open }
  }
  return null
}

/** 設施種類的 teach 欄格式；載入之後 ready 時查（回傳問題清單）。 */
export function teachProblems(k: Pick<Kernel, 'content' | 'conditions'>): string[] {
  if (!k.content.hasKind(FACILITY_KIND)) return []
  const out: string[] = []
  for (const t of k.content.list<ContentEntry & { teach?: unknown }>(FACILITY_KIND)) {
    if (t.teach === undefined) continue
    const at = `${FACILITY_KIND}/${t.id}：teach`
    if (!Array.isArray(t.teach) || t.teach.length === 0) {
      out.push(`${at} 要是 [{ skill, price, slots, needs? }]（機構教的基本功，至少一項）`)
      continue
    }
    const seen = new Set<string>()
    t.teach.forEach((r: unknown, i: number) => {
      const here = `${at}[${i}]`
      if (!isRecord(r)) return void out.push(`${here} 要是物件`)
      for (const key of Object.keys(r)) if (!['skill', 'price', 'slots', 'needs'].includes(key)) out.push(`${here}.${key}：沒有這個欄位（可以寫：skill、price、slots、needs）`)
      if (typeof r.skill !== 'string' || !k.content.has('skill', r.skill)) out.push(`${here}.skill 要是基本功的 id（${String(r.skill)} 查不到）`)
      else if (seen.has(r.skill)) out.push(`${here}.skill：${r.skill} 寫了兩次`)
      else seen.add(r.skill)
      if (!(isSafeInt(r.price) && r.price >= 0)) out.push(`${here}.price 要是 0 以上的整數（學費）`)
      if (!(isSafeInt(r.slots) && r.slots >= 1)) out.push(`${here}.slots 要是 1 以上的整數（要上幾個時段）`)
      if (r.needs !== undefined) {
        if (!Array.isArray(r.needs)) out.push(`${here}.needs 要是條件的陣列`)
        else r.needs.forEach((c, j) => out.push(...k.conditions.validate(c, `${here}.needs[${j}]`)))
      }
    })
  }
  return out
}

// ---- 規劃 ----

export interface LessonOpts {
  skill: string
  from: TeachFrom
  /** 向人請教時怎麼付（只有第一個時段要付）；不寫就照 affinity、favor、tuition 的順序挑第一個行得通的。機構一律是學費 */
  pay?: TeachPay
  /** 學費從哪裡付；不寫先帳戶、不夠再現金 */
  pool?: Pool
  /** 上課的人（隊上的人）；不寫是主角 */
  actor?: ActorId
}

export interface TeachPayView {
  pay: TeachPay
  /** 學費（affinity 與 favor 是 0） */
  price: number
  ok: boolean
  /** 行不通的原因（給玩家看的完整句子）；行得通是 null */
  reason: string | null
}

export interface TeachOption {
  skill: string
  name: string
  from: TeachFrom
  /** 老師（或機構）的名字 */
  fromName: string
  /** 這一堂課要升到幾級 */
  level: number
  /** 他最多教到幾級 */
  max: number
  /** 這一級一共要上幾個時段、已經上了幾個 */
  need: number
  done: number
  /** 一個時段幾分鐘 */
  minutes: number
  /** 上完之後升這一級要花的歷練點 */
  xp: number
  /** 這一堂已經上完了（可以去升級） */
  complete: boolean
  /** 幾種付法各自行不行（機構只有 tuition；已經付過的這一堂 price 是 0） */
  pays: TeachPayView[]
  ok: boolean
  reason: string | null
}

interface Plan {
  problems: string[]
  actor: ActorId
  skill: string
  from: TeachFrom
  fromName: string
  level: number
  max: number
  need: number
  done: number
  minutes: number
  /** 這個時段要付的學費（已經付過或不收是 0） */
  price: number
  pay?: TeachPay
  pools?: Pool
  pays: TeachPayView[]
  complete: boolean
  /** 這一堂本來就接著上（同老師、同一級） */
  continuing: boolean
}

function sameLesson(l: Lesson | undefined, level: number, from: TeachFrom): l is Lesson {
  return !!l && l.level === level && sameFrom(l.from, from)
}

function plan(k: TrainKernel, state: GameState, o: LessonOpts): Plan {
  const actor = o.actor ?? state.pc ?? ''
  const rules = abilityRules(k).teach
  const base: Plan = {
    problems: [], actor, skill: o.skill, from: o.from, fromName: '', level: 0, max: 0, need: rules.slots_per_level, done: 0, minutes: rules.slot_minutes, price: 0, pays: [], complete: false, continuing: false,
  }
  const fail = (msg: string): Plan => ({ ...base, problems: [...base.problems, msg] })
  const me = state.actors[actor]
  if (!actor || !me) return fail('沒有這個角色。')
  if (!k.content.has('skill', o.skill)) return fail('沒有這項基本功。')
  const name = skillName(k, o.skill)
  const now = me.skills[o.skill] ?? 0
  base.level = now + 1
  if (state.battle) base.problems.push('戰鬥中不能上課。')
  const busy = k.activity.blockOf(state, `commit:${LESSON_ACTION}`)
  if (busy && !base.problems.includes(busy)) base.problems.push(busy)
  if (actor !== state.pc && !state.party.includes(actor)) base.problems.push(`${me.name}不在隊上。`)

  // 來源
  const free = abilityRules(k).skill_free_max
  let max = FACILITY_MAX
  let facilityRow: FacilityTeach | undefined
  let teacherId: string | undefined
  if ('npc' in o.from) {
    teacherId = o.from.npc
    const t = state.actors[teacherId]
    if (!t || teacherId === actor) return fail('查不到這位老師。')
    base.fromName = t.name
    max = t.skills[o.skill] ?? 0
    const min = teachMin(k)
    if (max < min) base.problems.push(`${t.name}的${name}只有 ${max} 級，不夠格教（要 ${min} 級以上）。`)
    else if (max <= now) base.problems.push(`${t.name}的${name}只有 ${max} 級，沒有更多可以教你了。`)
  } else {
    const row = facilityHere(k, state, actor, o.skill, o.from.facility)
    const type = k.content.has(FACILITY_KIND, o.from.facility) ? k.content.get<ContentEntry & { name?: unknown; teach?: FacilityTeach[] }>(FACILITY_KIND, o.from.facility) : undefined
    base.fromName = row?.name ?? (type && typeof type.name === 'string' ? type.name : o.from.facility)
    facilityRow = type && Array.isArray(type.teach) ? type.teach.find((r) => r.skill === o.skill) : undefined
    if (!facilityRow) return fail(`${base.fromName}沒有開${name}的課。`)
    base.need = facilityRow.slots
    if (!row) base.problems.push(`你不在${base.fromName}，要站在那裡才能上課。`)
    else if (!row.open) base.problems.push(`${base.fromName}現在沒有營業，要等開門的時段才能上課。`)
  }
  base.max = max

  // 等級
  if (now >= SKILL_MAX) base.problems.push(`${name}已經練到最高的 ${SKILL_MAX} 級了。`)
  else if (!('npc' in o.from) && now >= FACILITY_MAX) base.problems.push(`機構只教到 ${FACILITY_MAX} 級，${FACILITY_MAX + 1} 級要向人請教。`)
  else if (now < free) base.problems.push(`${name}還沒到 ${free} 級，可以直接花歷練點升，不用上課。`)

  const mine = abilitiesOf(state, actor)
  const current = mine.lessons?.[o.skill]
  const continuing = sameLesson(current, base.level, o.from)
  base.continuing = continuing
  base.done = continuing ? current!.done : 0
  if (continuing) base.need = current!.need
  base.complete = !!current && current.level === base.level && current.done >= current.need
  if (base.complete) base.problems.push(`${name}升到 ${base.level} 級的課已經上完了，可以花歷練點升級了。`)

  // 付法
  const price = facilityRow ? facilityRow.price : (rules.tuition[String(base.level)] ?? 0)
  const paidAlready = continuing && base.done > 0
  if ('facility' in o.from && facilityRow) {
    const needs = (facilityRow.needs ?? []).find((c) => !k.conditions.test(c, condCtx(k, state, actor)))
    if (needs) base.problems.push(`${base.fromName}的課要符合條件「${needs.kind}」才能上，現在還不符合。`)
    const pool = paidAlready || price <= 0 ? null : payPool(state.money, price, o.pool)
    const why = paidAlready || price <= 0 || pool ? null : `錢不夠：學費要 C$${formatAmount(price)}，${o.pool ? POOL_NAME[o.pool] : '帳戶與現金'}付不起。`
    base.pays = [{ pay: 'tuition', price: paidAlready ? 0 : price, ok: why === null, reason: why }]
    base.pay = 'tuition'
    if (why) base.problems.push(why)
    else if (!paidAlready && price > 0) { base.price = price; base.pools = pool! }
  } else {
    const npcId = teacherId!
    const here = k.conditions.kinds().includes('npc_here') ? k.conditions.test({ kind: 'npc_here', npc: npcId }, condCtx(k, state, actor)) : true
    if (!here) base.problems.push(`${base.fromName}不在這裡：要在他現在所在的地方才能上課。`)
    const viewOf = (pay: TeachPay): TeachPayView => {
      if (pay === 'affinity') {
        const have = k.meters.has(AFFINITY) ? meterOf(k, state, AFFINITY, npcId) : 0
        const ok = have >= rules.affinity
        return { pay, price: 0, ok, reason: ok ? null : `你和${base.fromName}的親密度還不到 ${rules.affinity}（現在 ${have}），他不會不收學費教你。` }
      }
      if (pay === 'favor') {
        const ok = flagOn(state, taughtFlag(npcId, o.skill))
        return { pay, price: 0, ok, reason: ok ? null : `你還沒替${base.fromName}做過一件事，他不會白教你。` }
      }
      const ok = price <= 0 || payPool(state.money, price, o.pool) !== null
      return { pay, price, ok, reason: ok ? null : `錢不夠：學費要 C$${formatAmount(price)}，${o.pool ? POOL_NAME[o.pool] : '帳戶與現金'}付不起。` }
    }
    base.pays = PAY_ORDER.map(viewOf)
    if (paidAlready) {
      base.pay = current!.pay
    } else {
      const chosen = o.pay !== undefined ? base.pays.find((p) => p.pay === o.pay) : base.pays.find((p) => p.ok)
      if (!chosen) base.problems.push(base.pays.find((p) => p.pay === 'tuition')!.reason ?? '不知道怎麼付。')
      else if (!chosen.ok) base.problems.push(chosen.reason!)
      else {
        base.pay = chosen.pay
        if (chosen.pay === 'tuition' && chosen.price > 0) { base.price = chosen.price; base.pools = payPool(state.money, chosen.price, o.pool)! }
      }
    }
  }
  if (base.problems.length > 1) base.problems = base.problems.filter((p, i, a) => a.indexOf(p) === i)
  return base
}

/** 現在上不上得了這一堂課；上不了回傳第一個原因，上得了是 null。 */
export function lessonBlock(k: TrainKernel, state: GameState, o: LessonOpts): string | null {
  return plan(k, state, o).problems[0] ?? null
}

/** 上一個時段的課：花時間、（第一個時段）付學費、進度 +1；上完最後一個時段就立下可以升級的記號。不能上就丟 ActionBlocked。 */
export function lessonDraft(k: TrainKernel, state: GameState, o: LessonOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0) throw new ActionBlocked(p.problems[0]!)
  const mine = abilitiesOf(state, p.actor)
  const done = p.done + 1
  const lesson: Lesson = { level: p.level, done, need: p.need, from: { ...p.from }, ...(p.pay !== undefined && 'npc' in p.from ? { pay: p.pay } : {}) }
  const next: AbilityState = { ...mine, lessons: { ...(mine.lessons ?? {}), [p.skill]: lesson } }
  const name = skillName(k, p.skill)
  const who = state.actors[p.actor]!.name
  const finished = done >= p.need
  const summary = finished
    ? `${who}跟${p.fromName}上完了${name}的最後一堂課（${done}／${p.need}），可以花 ${skillUpCost(k, p.level - 1)} 點歷練點升到 ${p.level} 級了。`
    : `${who}跟${p.fromName}上了一個時段的${name}課（${done}／${p.need}）。`
  const report = reportOf(state, p.actor, LESSON_ACTION, next, summary, finished ? 'complete' : 'lesson')
  report.changes = [
    { op: 'time', minutes: p.minutes } as Change,
    ...(p.price > 0 && p.pools ? [{ op: p.pools, delta: -p.price } as Change] : []),
    ...report.changes,
  ]
  report.timeline = [{
    layer: 'meat', actor: p.actor, text: summary, tag: LESSON_ACTION,
    data: { skill: p.skill, level: p.level, done, need: p.need, from: { ...p.from }, pay: p.pay ?? null, price: p.price, minutes: p.minutes },
  }]
  return report
}

// ---- 能學哪幾項 ----

/**
 * 能跟這個人（npc）或這個設施種類（facility）學哪幾項：每一項學到幾級、要上幾個時段、三種付法各自行不行與原因。
 * 什麼都沒給是腳下的設施種類教的那幾項。老師比學生低或一樣、機構已經教不動的（學生 5 級以上）不列；還沒到 4 級的、不在場的照樣列（原因寫在 reason）。
 */
export function teachOptions(k: TrainKernel, state: GameState, o: { npc?: string; facility?: string; actor?: ActorId } = {}): TeachOption[] {
  const actor = o.actor ?? state.pc
  const me = state.actors[actor ?? '']
  if (!actor || !me) return []
  const rules = abilityRules(k).teach
  const rows: Array<{ skill: string; from: TeachFrom }> = []
  if (o.npc !== undefined) {
    for (const skill of teachableSkills(k, state, actor, o.npc)) rows.push({ skill, from: { npc: o.npc } })
  } else {
    const types = o.facility !== undefined ? [o.facility] : k.content.hasKind(FACILITY_KIND) ? k.content.list(FACILITY_KIND).map((t) => t.id) : []
    for (const id of types) {
      const t = k.content.get<ContentEntry & { teach?: FacilityTeach[] }>(FACILITY_KIND, id)
      for (const r of Array.isArray(t?.teach) ? t!.teach : []) {
        if ((me.skills[r.skill] ?? 0) >= FACILITY_MAX) continue
        if (o.facility === undefined && !facilityHere(k, state, actor, r.skill, id)) continue
        rows.push({ skill: r.skill, from: { facility: id } })
      }
    }
  }
  return rows.map(({ skill, from }) => {
    const p = plan(k, state, { skill, from, actor })
    return {
      skill, name: skillName(k, skill), from, fromName: p.fromName, level: p.level, max: p.max, need: p.need, done: p.done, minutes: rules.slot_minutes,
      xp: skillUpCost(k, p.level - 1), complete: p.complete, pays: p.pays, ok: p.problems.length === 0, reason: p.problems[0] ?? null,
    }
  })
}

// ---- 條件與格式 ----

export function registerTraining(k: Kernel): void {
  k.conditions.register<Condition & { npc?: string; skill?: string }>({
    kind: 'can_teach', owner: OWNER,
    validate: (raw) => {
      const p: string[] = []
      for (const key of Object.keys(raw)) if (!['kind', 'npc', 'skill'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫：npc、skill）`)
      if (typeof raw.npc !== 'string' || !raw.npc.trim()) p.push('npc 要是人的 id')
      if (raw.skill !== undefined && (typeof raw.skill !== 'string' || !raw.skill.trim())) p.push('skill 要是基本功的 id')
      return p
    },
    test(c, ctx) {
      const student = ctx.actor ?? ctx.state.pc
      if (!student || !c.npc) return false
      const list = teachableSkills(k, ctx.state, student, c.npc)
      return c.skill === undefined ? list.length > 0 : list.includes(c.skill)
    },
  })
}

/** 啟動檢查：設施種類的 teach 欄格式。 */
export function checkTeach(k: Pick<Kernel, 'content' | 'conditions'>): void {
  const problems = teachProblems(k)
  if (problems.length) throw new Error(`設施種類的 teach 檢查沒過（${problems.length} 個）：\n${problems.slice(0, 20).join('\n')}`)
}
