// L6 功能 drugs 的戒斷療程（DOWNTIME 3.5 節「診所的戒斷療程」；dev/work/M4-drugs.md 第 6 點）。
// 腳下的設施有 clinic（和 medical、cyberware 讀同一欄 facility_type.clinic）或設施種類的 detox: { free?: true }：
// 那一種藥的成癮值 −amount（預設 40）、時間過 days 天（預設 3）、收 price（預設 600；free 的設施不收）。
// 價錢還沒有乘區的倍率（和 medical 一樣；TRADE 第 3 節說服務的價錢也乘，等一起處理）。
// 免費：detox.free: true（一律免費）、或 detox.favor: { faction, min }（這個勢力對主角的好感 min 以上才免費，沒到照收；蜜糖會的互助診所：好感 30 以上，M4-followups-2 第 7 項）。

import type { ActorId, Change, ContentEntry, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, clone, formatAmount, formatDuration, isRecord, meterOf } from '../../core'
import { DAY, DETOX_ACTION, FACILITY_TYPE_KIND, drugDef, drugRules, readDrugs, writeDrugs } from './model'

type Pool = 'cred' | 'cash'
const POOL_NAME: Record<Pool, string> = { cred: '帳戶', cash: '現金' }

export interface DetoxOpts {
  /** 做療程的人（隊上的人） */
  actor: ActorId
  /** 哪一種藥的成癮 */
  drug: string
  /** 從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

export interface DetoxQuote {
  actor: ActorId
  drug: string
  name: string
  /** 設施的名字 */
  place: string
  free: boolean
  /** 成癮值現在多少、療程之後多少 */
  value: number
  after: number
  price: number
  minutes: number
  /** 錢從哪裡付；不收錢是 null */
  pay: Pool | null
}

type FacilityType = ContentEntry & { name?: unknown; clinic?: unknown; detox?: unknown }

/** 現在站的設施提供戒斷療程嗎（用條件 at_facility 問；沒有人註冊就沒有）。 */
export function detoxHere(k: Kernel, state: GameState): { name: string; free: boolean; favor?: { faction: string; min: number; have: number } } | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityType>(FACILITY_TYPE_KIND)) {
    if (t.clinic === undefined && t.detox === undefined) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) continue
    const d = isRecord(t.detox) ? t.detox : undefined
    // 好感的條件：k.meters 沒有 favor 這個量表（勢力的功能沒裝）就當好感 0，不免費
    const f = d && isRecord(d.favor) && typeof d.favor.faction === 'string' && typeof d.favor.min === 'number' ? { faction: d.favor.faction, min: d.favor.min } : undefined
    const favor = f ? { ...f, have: k.meters.has('favor') ? meterOf(k, state, 'favor', f.faction) : 0 } : undefined
    const free = d?.free === true || (favor !== undefined && favor.have >= favor.min)
    return { name: typeof t.name === 'string' && t.name ? t.name : t.id, free, ...(favor ? { favor } : {}) }
  }
  return null
}

const payPool = (money: GameState['money'], cost: number, want?: Pool): Pool | null => {
  if (cost <= 0) return null
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}

interface Plan {
  problems: string[]
  quote: DetoxQuote | null
}

function plan(k: Kernel, state: GameState, o: DetoxOpts): Plan {
  const a = state.actors[o.actor]
  if (!a) return { problems: ['找不到這個角色。'], quote: null }
  const def = drugDef(k, o.drug)
  if (!def) return { problems: ['這不是藥。'], quote: null }
  const problems: string[] = []
  if (state.battle) problems.push('戰鬥中不能做戒斷療程。')
  const act = k.activity.blockOf(state, `commit:${DETOX_ACTION}`)
  if (act && !problems.includes(act)) problems.push(act)
  if (!state.party.includes(o.actor)) problems.push(`${a.name}不在隊上。`)
  const here = detoxHere(k, state)
  if (!here) problems.push('這裡沒有提供戒斷療程的診所。')
  const row = readDrugs(state, o.actor).addiction[o.drug]
  if (!row || row.value <= 0) problems.push(`${a.name}沒有${def.name}的成癮。`)
  const rules = drugRules(k).detox
  const free = here?.free === true
  const price = free ? 0 : rules.price
  const pay = payPool(state.money, price, o.pay)
  if (here && price > 0 && pay === null) problems.push(`錢不夠：戒斷療程要 ${formatAmount(price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`)
  const value = row?.value ?? 0
  const quote: DetoxQuote = {
    actor: o.actor, drug: o.drug, name: def.name, place: here?.name ?? '', free, value, after: Math.max(0, value - rules.amount), price, minutes: rules.days * DAY, pay,
  }
  return { problems, quote }
}

export const detoxProblems = (k: Kernel, state: GameState, o: DetoxOpts): string[] => plan(k, state, o).problems
export const detoxBlock = (k: Kernel, state: GameState, o: DetoxOpts): string | null => plan(k, state, o).problems[0] ?? null
/** 這一次療程的報價；人或藥不存在是 null。 */
export const detoxQuote = (k: Kernel, state: GameState, o: DetoxOpts): DetoxQuote | null => plan(k, state, o).quote

/**
 * 戒斷療程。不成立丟 ActionBlocked。寫進狀態：扣錢、時間加 days 天、那一種藥的成癮值 −amount（到 0 就整筆拿掉，戒斷也結束）。報告 drug.detox。
 */
export function detoxDraft(k: Kernel, state: GameState, o: DetoxOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0 || !p.quote) throw new ActionBlocked(p.problems[0] ?? '現在做不了療程。')
  const q = p.quote
  const who = state.actors[o.actor]!
  const d = readDrugs(state, o.actor)
  if (q.after <= 0) {
    delete d.addiction[o.drug]
    delete d.withdrawal[o.drug]
  } else d.addiction[o.drug] = { ...d.addiction[o.drug]!, value: q.after }
  const changes: Change[] = []
  if (q.price > 0 && q.pay) changes.push({ op: q.pay, delta: -q.price })
  changes.push({ op: 'time', minutes: q.minutes }, writeDrugs(o.actor, d))
  const lines = [`${who.name}在${q.place}做了${formatDuration(q.minutes)}的戒斷療程，${q.name}的成癮從 ${q.value} 降到 ${q.after}${q.price > 0 ? `，花了 ${formatAmount(q.price)}` : '，沒有收錢'}。`]
  const beats: TimelineBeat[] = lines.map((text) => ({
    layer: 'meat', actor: o.actor, text, tag: DETOX_ACTION, data: { actor: o.actor, drug: o.drug, from: q.value, to: q.after, price: q.price, minutes: q.minutes, pay: q.pay },
  }))
  return {
    kind: 'action', action: DETOX_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result: q.after <= 0 ? 'cleared' : 'reduced', summary: lines.join('') }, narration: { results: lines },
  }
}
