// L6 功能 security 的掃橋第四樣：讀這個人身上的義體、沉溺與契約（LIFE 2.1 節、3.1 節；NPCS 8.3 節「隱藏沉溺」；EQUIPMENT 6.3、6.4 節；
// LEWD_SYSTEM 7.1 節；dev/adr/0019 第十四節的 scan.person 與 P21；dev/work/M4-security-m4.md、M4-plan.md 第 16 題）。
//
// 掛點 scan.person（這個功能宣告；義體、契約各自回答，沒有人回答就當作沒有）：[{ state, actor, strength }, PersonAnswer | void]。
// 沉溺不經掛點讀：衍生數值 sink_shown（沒有人註冊就當沒有沉溺可讀）與角色的 sink；藏沉溺的手段有幾種（hide）由別的功能經 scan.person 報。
// 這裡只算「讀到什麼、要付什麼」，不碰登錄表以外的東西；結算（扣罰金、鎖義體、敵對值）由 scan.ts 照 applyPerson 的草稿併進報告。
//
// 義體（強度 1 只讀得到件數；2 以上逐件）：free 沒事；register 而沒登記 → 罰金、敵對值；permit 沒執照 → 罰金、敵對值；banned → 鎖那一件、敵對值、這次沒過。
// 沉溺：讀到的是 sink_shown；和真正的不一樣（有藏）時擲一次看穿（d20 ＋ 強度 × 3 對 10 ＋ mod(意志) ＋ 定力 ＋ hide × 2）；看穿了用真正的值。
//   讀到的值 ≥ sink_notice：敵對值 +3、照常過；≥ sink_stop：這次過不了，只剩掉頭。
// 契約：回答原樣放進結果（顯示用）；covered 而強度不到 2 當作沒看到；假身分蓋得掉契約、蓋不掉義體與沉溺。
// 骰面：掃橋一開始從狀態導出（deriveRng），記在 state.ext.security_scan.see；事件開著時每一次重算都讀同一顆。

import type { Change, ContentEntry, GameState, Kernel } from '../../core'
import { attrMod, deriveRng, effectCtx, isRecord } from '../../core'
import { RULE_KIND, hasLicense } from './model'
import type { ScanSetup } from './model'
import { personRulesFrom } from './personRules'
import type { PersonRead, PersonRules } from './personRules'

export const SINK_STAT = 'sink_shown'
export const LOCK_EFFECT = 'cyber_lock'
const SEE_ATTR = 'resolve'
const SEE_SKILL = 'composure'

// ---- 掛點 ----

export interface PersonAnswer {
  cyber?: { count: number; items: Array<{ uid: string; name: string; legal: string; registered: boolean }> }
  contract?: { class: 'bound'; holder: string; level: string; covered: boolean }
  rights?: Array<{ holder: string; level: string }>
  /** 藏沉溺的手段有幾種（藥、調校、面具各算一種；誰有誰報） */
  hide?: number
}

declare module '../../core' {
  interface HookMap {
    /** 掃橋時問：讀這個人身上的義體（件數與逐件）、契約（橋權在誰手上）、藏沉溺的手段有幾種。每個鍵選填；好幾個回答合起來；沒有人回答就當作沒有。 */
    'scan.person': [{ state: GameState; actor: string; strength: number }, PersonAnswer | void]
  }
}

const LEGALS = ['free', 'register', 'permit', 'banned'] as const
type Legal = (typeof LEGALS)[number]
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0

interface Merged {
  cyber: Array<{ uid: string; name: string; legal: Legal; registered: boolean }>
  cyberCount: number
  contract?: { class: 'bound'; holder: string; level: string; covered: boolean }
  rights: Array<{ holder: string; level: string }>
  hide: number
}

function ask(k: Kernel, state: GameState, actor: string, strength: number): Merged {
  const out: Merged = { cyber: [], cyberCount: 0, rights: [], hide: 0 }
  for (const { result: a } of k.hooks.run('scan.person', { state, actor, strength })) {
    if (!isRecord(a)) continue
    const c = a.cyber
    if (isRecord(c) && Array.isArray(c.items)) {
      let n = 0
      for (const i of c.items) {
        if (!isRecord(i) || !text(i.uid)) continue
        out.cyber.push({ uid: i.uid, name: text(i.name) ? i.name : i.uid, legal: (LEGALS as readonly unknown[]).includes(i.legal) ? (i.legal as Legal) : 'free', registered: i.registered === true })
        n += 1
      }
      out.cyberCount += typeof c.count === 'number' && Number.isFinite(c.count) && c.count >= n ? Math.floor(c.count) : n
    }
    const k2 = a.contract
    if (!out.contract && isRecord(k2) && k2.class === 'bound' && text(k2.holder)) out.contract = { class: 'bound', holder: k2.holder, level: text(k2.level) ? k2.level : 'manage', covered: k2.covered === true }
    if (Array.isArray(a.rights)) for (const r of a.rights) if (isRecord(r) && text(r.holder)) out.rights.push({ holder: r.holder, level: text(r.level) ? r.level : 'read' })
    if (typeof a.hide === 'number' && Number.isFinite(a.hide) && a.hide > 0) out.hide += Math.floor(a.hide)
  }
  return out
}

// ---- 這一次讀到的全貌（純函式，唯讀） ----

export type CyberVerdict = 'ok' | 'register' | 'permit' | 'banned'

export interface CyberRead {
  uid: string
  name: string
  legal: Legal
  registered: boolean
  verdict: CyberVerdict
  fine: number
  hostility: number
  /** 違禁：這一件會被鎖 */
  lock: boolean
  note: string
}

export interface SinkRead {
  /** 真正的沉溺、別人看到的沉溺 */
  real: number
  shown: number
  /** 這一次掃描器讀到的（沒看穿是 shown，看穿了是 real） */
  read: number
  hide: number
  /** 擲看穿的結果；沒有藏（shown 不低於 real）就沒有 */
  roll?: { natural: number; bonus: number; total: number; dc: number; seen: boolean }
  notice: boolean
  stop: boolean
}

export interface PersonPlan {
  reads: PersonRead[]
  cyber?: { count: number; detailed: boolean; items: CyberRead[] }
  sink?: SinkRead
  contract?: { class: 'bound'; holder: string; level: string; covered: boolean }
  rights?: Array<{ holder: string; level: string }>
  /** 義體的罰金合計 */
  fine: number
  /** 義體（取最重的一件）加沉溺的敵對值 */
  hostility: number
  banned: CyberRead[]
  /** 沉溺過了線：只剩掉頭，這是給玩家看的原因 */
  stop: string | null
  /** 有處罰或擋路的：要跳事件讓玩家選；只有讀到什麼（顯示用）的不用 */
  needsEvent: boolean
  /** 讀到什麼，一樣一句（有讀才有）；sentences 是照義體、沉溺、契約、權利的順序排好的 */
  say: { cyber?: string; sink?: string; contract?: string; rights?: string }
  sentences: string[]
  rules: PersonRules
}

export const personRulesOf = (k: Pick<Kernel, 'content'>): PersonRules => personRulesFrom(k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default'))

/** 這個點讀哪幾樣：設定寫的、勢力在規則表 readers 的、再沒有就只讀義體。 */
export function readsOf(rules: PersonRules, setup: Pick<ScanSetup, 'reads' | 'faction'>): PersonRead[] {
  if (setup.reads) return setup.reads
  return (setup.faction !== undefined ? rules.readers[setup.faction] : undefined) ?? ['cyber']
}

/** 掃橋一開始的骰面：從狀態導出（同一個狀態、同一個點，一定一樣）。 */
export const seeNatural = (state: GameState, point: string): number => deriveRng(state.rng, `scan_see/${point}`).int(1, 20)

function judge(k: Kernel, state: GameState, c: Merged['cyber'][number], rules: PersonRules): CyberRead {
  const base = { uid: c.uid, name: c.name, legal: c.legal, registered: c.registered }
  if (c.legal === 'banned') return { ...base, verdict: 'banned', fine: 0, hostility: rules.cyber_hostility.banned, lock: true, note: `違禁，會被鎖住 ${rules.cyber_lock_hours} 小時。` }
  if (c.legal === 'permit' && !hasLicense(k, state, c.name)) return { ...base, verdict: 'permit', fine: rules.cyber_fine.permit, hostility: rules.cyber_hostility.permit, lock: false, note: `許可類，你沒有執照，罰 ${rules.cyber_fine.permit} 元。` }
  if (c.legal === 'register' && !c.registered) return { ...base, verdict: 'register', fine: rules.cyber_fine.register, hostility: rules.cyber_hostility.register, lock: false, note: `登記類，你沒有登記，罰 ${rules.cyber_fine.register} 元。` }
  return { ...base, verdict: 'ok', fine: 0, hostility: 0, lock: false, note: c.legal === 'free' ? '自由，放行。' : c.legal === 'permit' ? '許可類，你有執照。' : '登記類，已登記，放行。' }
}

/**
 * 讀這個人。強度 0、沒有主角、這個點什麼都不讀、或什麼都沒讀到時回傳 null（流程和以前完全一樣）。
 * natural 是看穿那一擲的骰面（掃橋一開始導出的）。
 */
export function planPerson(k: Kernel, state: GameState, actor: string | null, setup: ScanSetup, natural: number): PersonPlan | null {
  if (setup.strength < 1 || !actor || !state.actors[actor]) return null
  const rules = personRulesOf(k)
  const reads = readsOf(rules, setup)
  if (reads.length === 0) return null
  const m = ask(k, state, actor, setup.strength)
  const detailed = setup.strength >= 2
  const say: PersonPlan['say'] = {}
  const plan: PersonPlan = { reads, fine: 0, hostility: 0, banned: [], stop: null, needsEvent: false, say, sentences: [], rules }

  if (reads.includes('cyber') && (m.cyberCount > 0 || m.cyber.length > 0)) {
    const items = detailed ? m.cyber.map((c) => judge(k, state, c, rules)) : []
    plan.cyber = { count: Math.max(m.cyberCount, m.cyber.length), detailed, items }
    plan.fine = items.reduce((n, i) => n + i.fine, 0)
    plan.hostility += Math.max(0, ...items.map((i) => i.hostility))
    plan.banned = items.filter((i) => i.lock)
    const bad = items.filter((i) => i.verdict !== 'ok')
    say.cyber = (!detailed
      ? `掃描器讀到你身上有 ${plan.cyber.count} 件義體。`
      : `掃描器逐件讀了你身上的 ${items.length} 件義體：${items.map((i) => (i.verdict === 'ok' ? i.name : `${i.name}（${i.verdict === 'banned' ? '違禁' : i.verdict === 'permit' ? '沒有執照' : '沒登記'}）`)).join('、')}${bad.length === 0 ? '，沒有問題' : ''}。`)
  }

  if (reads.includes('sink') && k.stats.hasStat(SINK_STAT)) {
    const real = state.actors[actor]!.sink ?? 0
    const shown = k.stats.stat(state, actor, SINK_STAT)
    const sink: SinkRead = { real, shown, read: shown, hide: m.hide, notice: false, stop: false }
    if (shown < real) {
      const bonus = setup.strength * rules.sink_see.per_strength
      const dc = rules.sink_see.base + attrMod(k.stats.effectiveAttr(state, actor, SEE_ATTR)) + (state.actors[actor]!.skills[SEE_SKILL] ?? 0) + m.hide * rules.sink_see.per_hide
      const total = natural + bonus
      const seen = total >= dc
      sink.roll = { natural, bonus, total, dc, seen }
      if (seen) sink.read = real
    }
    sink.stop = sink.read >= rules.sink_stop
    sink.notice = sink.read >= rules.sink_notice && !sink.stop
    if (sink.notice) plan.hostility += rules.sink_hostility
    if (sink.stop) plan.stop = '你的沉溺已經過了線，這裡的掃描器一律攔你，只有掉頭走得通。'
    plan.sink = sink
    say.sink = (`掃描器讀到的沉溺是 ${sink.read}${sink.roll?.seen ? '（藏的被看穿了）' : ''}${sink.stop ? '，過了線，不讓你過' : sink.notice ? '，它的人會記上一筆' : ''}。`)
  }

  if (reads.includes('contract')) {
    if (m.contract && !(m.contract.covered && setup.strength < 2)) plan.contract = { ...m.contract }
    if (m.rights.length > 0) plan.rights = m.rights.map((r) => ({ ...r }))
    if (plan.contract) say.contract = `你的橋 ID 上掛著契約人的記號，持約人是${plan.contract.holder}。`
    if (plan.rights) say.rights = `你的橋 ID 上另外有 ${plan.rights.length} 筆被人讀取或限制的權利。`
  }

  if (!plan.cyber && !plan.sink && !plan.contract && !plan.rights) return null
  plan.sentences = [say.cyber, say.sink, say.contract, say.rights].filter((x): x is string => x !== undefined)
  plan.needsEvent = plan.fine > 0 || plan.hostility > 0 || plan.banned.length > 0 || plan.stop !== null
  return plan
}

// ---- 結算 ----

export interface PersonOutcome {
  changes: Change[]
  lines: string[]
}

const joinNames = (list: Array<{ name: string }>): string => list.map((c) => c.name).join('、')

/**
 * 玩家走完（照常過或用假身分）之後這個人要付的：罰金（從現金扣，不夠扣到 0，剩下的不追）、違禁的義體鎖住（查不到效果就只有敵對值）。
 * 敵對值由 scan.ts 和身上的東西的那一份合在一起加。
 */
export function applyPerson(k: Kernel, state: GameState, plan: PersonPlan): PersonOutcome {
  const changes: Change[] = []
  const lines: string[] = []
  const ctx = effectCtx(k, state, { source: 'builtin' })
  if (plan.banned.length > 0) {
    lines.push(`掃描器讀出你身上違禁的義體：${joinNames(plan.banned)}${k.effects.has(LOCK_EFFECT) ? `，被鎖住 ${plan.rules.cyber_lock_hours} 小時` : ''}`)
    if (k.effects.has(LOCK_EFFECT)) {
      const res = k.effects.resolve(plan.banned.map((c) => ({ kind: LOCK_EFFECT, uid: c.uid, on: true, hours: plan.rules.cyber_lock_hours })), ctx)
      if (res.errors.length === 0) changes.push(...res.changes)
    }
  }
  if (plan.fine > 0) {
    const owed = plan.cyber!.items.filter((i) => i.fine > 0)
    const paid = Math.min(plan.fine, state.money.cash)
    lines.push(`${joinNames(owed)}被罰了 ${plan.fine} 元${paid < plan.fine ? `，你身上的現金只有 ${paid} 元，只扣了 ${paid} 元` : ''}`)
    if (paid > 0) changes.push({ op: 'cash', delta: -paid })
  }
  return { changes, lines }
}

// ---- 給結果與畫面 ----

/** 掃橋的結果（activity.end 的 result.person）：用假身分蓋掉契約，蓋不掉義體與沉溺。 */
export function personResult(plan: PersonPlan, via: 'proceed' | 'fake'): Record<string, unknown> {
  return {
    cyber_found: plan.cyber?.detailed ? plan.cyber.items.map((i) => ({ name: i.name, legal: i.legal })) : [],
    ...(plan.cyber ? { cyber_count: plan.cyber.count } : {}),
    ...(plan.sink ? { sink_seen: plan.sink.read } : {}),
    ...(plan.sink?.roll ? { saw_through: plan.sink.roll.seen } : {}),
    ...(via === 'proceed' && plan.contract ? { contract: { ...plan.contract } } : {}),
    ...(via === 'proceed' && plan.rights ? { rights: plan.rights.map((r) => ({ ...r })) } : {}),
  }
}

export interface PersonView {
  /** 這個點讀哪幾樣 */
  reads: PersonRead[]
  cyber?: { count: number; detailed: boolean; items: Array<{ name: string; legal: string; registered: boolean; verdict: CyberVerdict; note: string }> }
  sink?: { read: number; notice: boolean; stop: boolean; saw_through?: boolean; dc?: number }
  contract?: { class: 'bound'; holder: string; level: string; covered: boolean }
  rights?: Array<{ holder: string; level: string }>
  /** 一樣一句 */
  sentences: string[]
}

export function personView(plan: PersonPlan): PersonView {
  return {
    reads: [...plan.reads],
    ...(plan.cyber ? { cyber: { count: plan.cyber.count, detailed: plan.cyber.detailed, items: plan.cyber.items.map((i) => ({ name: i.name, legal: i.legal, registered: i.registered, verdict: i.verdict, note: i.note })) } } : {}),
    ...(plan.sink ? { sink: { read: plan.sink.read, notice: plan.sink.notice, stop: plan.sink.stop, ...(plan.sink.roll ? { saw_through: plan.sink.roll.seen, dc: plan.sink.roll.dc } : {}) } } : {}),
    ...(plan.contract ? { contract: { ...plan.contract } } : {}),
    ...(plan.rights ? { rights: plan.rights.map((r) => ({ ...r })) } : {}),
    sentences: [...plan.sentences],
  }
}
