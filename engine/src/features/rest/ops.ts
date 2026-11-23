// L6 功能 rest 的入口：喘口氣、睡一覺、睡在哪（sleepOptions）、租與退租。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
// 規格：DOWNTIME 第 2 節、7.1、7.2 節；EVENTS 3.1 節；dev/adr/0016 第六節；dev/work/M2-rest-housing.md。

import type { Change, GameState, Kernel, ReportDraft, ReportTrigger, TimelineBeat } from '../../core'
import { ActionBlocked, attrMod, clone, formatAmount, restDone, toMinutes } from '../../core'
import type { HomeState, Pool, RestState } from './model'
import {
  EXT, POOL_NAME, hasCondition, homeOf, maxHpOf, payFor, readRest, rentPayOf, residenceEntry, residencePools, restRules, sleepFacilityAt, spanText, standingAt,
} from './model'

const writeRest = (r: RestState): Change => ({ op: 'ext', key: EXT, value: clone(r) as unknown as Record<string, unknown> })

/** 觸發點的 where：現在在哪一區哪一塊（有站在設施上就帶設施的標記）。 */
function whereOf(state: GameState): Record<string, string> {
  const { district, block, facility } = state.location
  return { ...(district ? { district } : {}), ...(block ? { block } : {}), ...(facility ? { facility } : {}) }
}

function draftOf(state: GameState, action: string, changes: Change[], result: string, summary: string, o: { beats?: TimelineBeat[]; triggers?: ReportTrigger[] } = {}): ReportDraft {
  const beats: TimelineBeat[] = o.beats ?? [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: summary, tag: action }]
  return {
    kind: 'downtime', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: beats, changes,
    outcome: { result, summary }, narration: { results: beats.map((b) => b.text) }, ...(o.triggers?.length ? { triggers: o.triggers } : {}),
  }
}

/** 隊上的人（有角色資料的）。 */
const partyOf = (state: GameState): string[] => [...new Set(state.party)].filter((id) => !!state.actors[id])

/** 活動（委託副本、戰鬥……）擋住時的原因；沒擋是 null。 */
const activityBlock = (k: Pick<Kernel, 'activity'>, state: GameState, action: string, draft?: ReportDraft): string | null => k.activity.blockOf(state, `commit:${action}`, draft)

/** 每個人的感載與餘韻歸零的變更。 */
function clearChanges(state: GameState, ids: string[]): Change[] {
  const out: Change[] = []
  for (const id of ids) {
    const a = state.actors[id]!
    if (a.load > 0) out.push({ op: 'actor.track', id, track: 'load', delta: -a.load })
    if (a.afterglow > 0) out.push({ op: 'actor.track', id, track: 'afterglow', delta: -a.afterglow })
  }
  return out
}

const hpChange = (id: string, delta: number): Change[] => (delta > 0 ? [{ op: 'actor.track', id, track: 'hp', delta }] : [])
const nameOf = (state: GameState, id: string): string => state.actors[id]?.name ?? id

/**
 * 回了生命值的那一句：寫成描寫，不帶數字（M2 修正批 13）。這些句子是「定案的結果」，AI 寫正文時照它們寫；
 * 句子裡帶「生命值 +3」，AI 照抄就違反硬規則 H4（機制的數字不寫進文字），整份正文被擋下、行動停在半路。
 * 數字留在報告的變更（hp）與這一拍的 data（{ id, hp }）。
 */
const healLine = (name: string, hp: number, kind: 'breath' | 'sleep', capped = false): string => {
  if (hp <= 0) return capped ? `${name}的傷口沒處理過，睡了一覺也沒有好轉。` : kind === 'sleep' ? `${name}本來就沒有什麼傷，睡得很安穩。` : `${name}的身上沒有什麼要緩的傷。`
  if (kind === 'breath') return `${name}的傷勢緩了一些。`
  return `${name}睡得很沉，傷勢好了不少${capped ? '，只是傷口沒處理過，最多只回到一半' : ''}。`
}

// ---- 喘口氣 ----

/** 現在能不能喘口氣；能是 null。 */
export function breathBlock(k: Kernel, state: GameState): string | null {
  if (!state.pc || !state.actors[state.pc]) return '還沒有主角。'
  return activityBlock(k, state, 'rest.breath')
}

/**
 * 喘口氣（60 分鐘）：隊上每個人感載歸零、餘韻全消；生命回 2 ＋ mod(體格)（最少 1），兩次睡一覺之間只有前兩次會回；發 rest.done（breath）；帶觸發點 rest。
 */
export function breathDraft(k: Kernel, state: GameState): ReportDraft {
  const block = breathBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const rules = restRules(k)
  const rest = readRest(state)
  const heals = rest.breaths < rules.breath_heals
  const ids = partyOf(state)
  const changes: Change[] = [{ op: 'time', minutes: rules.breath_minutes }, ...clearChanges(state, ids)]
  const gained: Array<{ id: string; hp: number }> = []
  if (heals) {
    for (const id of ids) {
      const a = state.actors[id]!
      const want = Math.max(rules.breath_hp_min, rules.breath_hp + attrMod(k.stats.effectiveAttr(state, id, 'body')))
      const hp = Math.max(0, Math.min(want, maxHpOf(k, state, id) - a.hp))
      if (hp > 0) {
        changes.push(...hpChange(id, hp))
        gained.push({ id, hp })
      }
    }
  }
  rest.breaths += 1
  changes.push(writeRest(rest))
  changes.push(...restDone(k, state, 'breath'))

  const lines = [
    '你坐下來喘了口氣，感載與餘韻都退了。',
    ...(heals ? gained.map((g) => healLine(nameOf(state, g.id), g.hp, 'breath')) : ['這一次沒有回復生命值：兩次睡一覺之間，喘口氣能回復的次數有限，已經用完了。']),
  ]
  const beats: TimelineBeat[] = lines.map((text, i) => ({ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: i === 0 ? 'rest.breath' : 'rest.heal', ...(i > 0 && heals ? { data: { ...gained[i - 1] } } : {}) }))
  return draftOf(state, 'rest.breath', changes, heals ? 'healed' : 'no_heal', lines.join(''), { beats, triggers: [{ point: 'rest', where: whereOf(state) }] })
}

// ---- 睡在哪 ----

export type SleepSpotId = 'home' | 'facility' | 'wild'

export interface SleepOption {
  id: SleepSpotId
  name: string
  /** 回復率：生命值上限的幾成 */
  rate: number
  cost: number
  /** 錢從哪裡付（不用錢或付不出來是 null） */
  pay: Pool | null
  /** 現在站的就是這裡：不指定睡處時睡的是它 */
  current: boolean
  /** 現在選不了的原因（給玩家看的完整句子）；能選是 null */
  block: string | null
}

export interface SleepOpts {
  /** 睡哪：不寫就是現在站的地方（自己的住處、有 sleep 的設施，都不是就露宿） */
  spot?: SleepSpotId
  /** 花的錢從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

/** 睡一覺本身現在能不能做（和睡在哪無關）：活動擋住、距上次太近。 */
export function sleepBlock(k: Kernel, state: GameState): string | null {
  if (!state.pc || !state.actors[state.pc]) return '還沒有主角。'
  const act = activityBlock(k, state, 'rest.sleep')
  if (act) return act
  const rest = readRest(state)
  const gap = restRules(k).sleep_gap_hours * 60
  if (rest.lastSleep !== null && gap > 0) {
    const since = toMinutes(state.time) - rest.lastSleep
    if (since < gap) return `距上次睡一覺才過了 ${spanText(since)}，至少要隔 ${spanText(gap)}（還要等 ${spanText(gap - since)}）；累了的話先喘口氣。`
  }
  return null
}

/** 現在能選的睡處（含灰掉的，帶原因）：自己的住處、站著的那一間有 sleep 的設施、露宿（永遠有）。 */
export function sleepOptions(k: Kernel, state: GameState): SleepOption[] {
  const rules = restRules(k)
  const general = sleepBlock(k, state)
  const out: SleepOption[] = []
  const h = homeOf(k, state)
  const fac = sleepFacilityAt(k, state)
  const atHome = !!h && standingAt(state, h.residence)
  const here: SleepSpotId = atHome ? 'home' : fac ? 'facility' : 'wild'

  if (h) {
    const specific = !atHome ? `你不在自己的住處（${h.residence.name}）。` : h.home.locked ? `${h.residence.name}的門鎖被換掉了，房租付清才開。` : null
    out.push({ id: 'home', name: h.residence.name, rate: rules.home_rates[String(h.residence.level)] ?? 0, cost: 0, pay: null, current: here === 'home', block: general ?? specific })
  }
  if (fac) {
    const pay = payFor(state.money, fac.sleep.cost)
    const specific = pay === null ? `睡一晚要 ${formatAmount(fac.sleep.cost)}，帳戶有 ${formatAmount(state.money.cred)}、現金有 ${formatAmount(state.money.cash)}，都不夠。` : null
    out.push({ id: 'facility', name: fac.name, rate: fac.sleep.rate, cost: fac.sleep.cost, pay: fac.sleep.cost > 0 ? pay : null, current: here === 'facility', block: general ?? specific })
  }
  out.push({ id: 'wild', name: '露宿', rate: rules.wild_rate, cost: 0, pay: null, current: here === 'wild', block: general })
  return out
}

// ---- 睡一覺 ----

/**
 * 睡一覺（480 分鐘）：距上次至少 16 小時，不到給原因；感載、餘韻歸零；生命回「上限 × 睡處的回復率」；
 * 生命低於一半而且身上沒有 treated 的人最多回到一半；發 rest.done（sleep）；帶觸發點 rest，露宿另帶 sleep_out，在自己的住處另帶 home。
 */
export function sleepDraft(k: Kernel, state: GameState, opts: SleepOpts = {}): ReportDraft {
  const options = sleepOptions(k, state)
  const id = opts.spot ?? options.find((o) => o.current)!.id
  const spot = options.find((o) => o.id === id)
  if (!spot) throw new ActionBlocked(id === 'facility' ? '你不在有床位的地方。' : '現在沒有這個睡處可以選。')
  if (spot.block) throw new ActionBlocked(spot.block)

  const rules = restRules(k)
  const pool = spot.cost > 0 ? payFor(state.money, spot.cost, opts.pay) : null
  if (spot.cost > 0 && pool === null) throw new ActionBlocked(`${POOL_NAME[opts.pay ?? 'cred']}不夠付一晚的 ${formatAmount(spot.cost)}。`)

  const ids = partyOf(state)
  const changes: Change[] = []
  if (pool && spot.cost > 0) changes.push({ op: pool, delta: -spot.cost })
  changes.push({ op: 'time', minutes: rules.sleep_minutes }, ...clearChanges(state, ids))

  const lines: string[] = []
  const gained: Array<{ id: string; hp: number; capped: boolean }> = []
  for (const who of ids) {
    const a = state.actors[who]!
    const max = maxHpOf(k, state, who)
    let target = Math.min(max, a.hp + Math.floor(Math.round(max * spot.rate * 1e6) / 1e6))
    let capped = false
    // 重傷限制：低於一半、傷口沒處理過，最多回到一半
    if (a.hp < max * rules.hurt_ratio && !hasCondition(state, who, 'treated')) {
      const cap = Math.ceil(max * rules.hurt_ratio)
      if (target > cap) {
        target = Math.max(a.hp, cap)
        capped = true
      }
    }
    const hp = Math.max(0, target - a.hp)
    changes.push(...hpChange(who, hp))
    gained.push({ id: who, hp, capped })
  }

  const end = toMinutes(state.time) + rules.sleep_minutes
  const rest = readRest(state)
  rest.lastSleep = end
  rest.breaths = 0
  changes.push(writeRest(rest))
  changes.push(...restDone(k, state, 'sleep'))

  lines.push(`你在${spot.name}睡了一覺（${spanText(rules.sleep_minutes)}），感載與餘韻都退了。${pool && spot.cost > 0 ? `付了 ${formatAmount(spot.cost)}（${POOL_NAME[pool]}）。` : ''}`)
  for (const g of gained) lines.push(healLine(nameOf(state, g.id), g.hp, 'sleep', g.capped))
  const beats: TimelineBeat[] = lines.map((text, i) => ({
    layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: i === 0 ? 'rest.sleep' : 'rest.heal',
    ...(i === 0 ? { data: { spot: spot.id, rate: spot.rate, cost: spot.cost } } : { data: { ...gained[i - 1] } }),
  }))

  const where = whereOf(state)
  const triggers: ReportTrigger[] = [{ point: 'rest', where }]
  if (spot.id === 'wild') triggers.push({ point: 'sleep_out', where })
  if (spot.id === 'home') triggers.push({ point: 'home', where })
  return draftOf(state, 'rest.sleep', changes, spot.id, lines.join(''), { beats, triggers })
}

// ---- 租與退租 ----

export interface RentOpts {
  pay?: Pool
}

/** 租這一間現在行不行；行是 null。 */
export function rentBlock(k: Kernel, state: GameState, id: string, opts: RentOpts = {}): string | null {
  const r = residenceEntry(k, id)
  if (!r) return `沒有 ${id} 這個住處。`
  const act = activityBlock(k, state, 'home.rent')
  if (act) return act
  const cur = homeOf(k, state)
  if (cur) return cur.residence.id === id ? `你已經租著${r.name}了。` : `你已經有一個家了（${cur.residence.name}），要換先退租。`
  const deposit = r.rent * restRules(k).deposit_weeks
  const pools = residencePools(r)
  if (opts.pay && !pools.includes(opts.pay)) return `${r.name}${opts.pay === 'cash' ? '不收現金' : '只收現金'}。`
  if (deposit > 0 && payFor(state.money, deposit, opts.pay, pools) === null) {
    return `押金要 ${formatAmount(deposit)}（兩週房租），${pools.map((p) => `${POOL_NAME[p]}有 ${formatAmount(state.money[p])}`).join('、')}，不夠。`
  }
  return null
}

/** 租一個地方：付押金（兩週房租；收現金的住處照它收的錢付），同時只有一個家。 */
export function rentDraft(k: Kernel, state: GameState, id: string, opts: RentOpts = {}): ReportDraft {
  const block = rentBlock(k, state, id, opts)
  if (block) throw new ActionBlocked(block)
  const r = residenceEntry(k, id)!
  const deposit = r.rent * restRules(k).deposit_weeks
  const pool = payFor(state.money, deposit, opts.pay, residencePools(r)) ?? residencePools(r)[0]!
  const rest = readRest(state)
  rest.home = { id, deposit, pool, arrears: 0, locked: false }
  const changes: Change[] = [...(deposit > 0 ? [{ op: pool, delta: -deposit } as Change] : []), writeRest(rest)]
  const text = `你租下了${r.name}，每週房租 ${formatAmount(r.rent)}${deposit > 0 ? `，先付了押金 ${formatAmount(deposit)}（${POOL_NAME[pool]}）` : ''}。`
  return draftOf(state, 'home.rent', changes, 'rented', text, { beats: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: 'home.rent', data: { residence: id, deposit, pool } }] })
}

/** 現在能不能退租；能是 null。 */
export function leaveBlock(k: Kernel, state: GameState): string | null {
  if (!homeOf(k, state)) return '你現在沒有租任何住處。'
  return activityBlock(k, state, 'home.leave')
}

/** 退租：押金退回去（用什麼錢付的就退什麼錢）。 */
export function leaveDraft(k: Kernel, state: GameState): ReportDraft {
  const block = leaveBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const { home, residence } = homeOf(k, state)!
  const rest = readRest(state)
  rest.home = null
  const changes: Change[] = [...(home.deposit > 0 ? [{ op: home.pool, delta: home.deposit } as Change] : []), writeRest(rest)]
  const text = `你退租了${residence.name}${home.deposit > 0 ? `，拿回押金 ${formatAmount(home.deposit)}（${POOL_NAME[home.pool]}）` : ''}。`
  return draftOf(state, 'home.leave', changes, 'left', text, { beats: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: 'home.leave', data: { residence: residence.id, refund: home.deposit, pool: home.pool } }] })
}

// ---- 每週帳單（bill.collect、bill.settled 的處理；掛在 index.ts） ----

export const RENT_ID = 'rent'

/** 帳單裡的房租這一項；沒有家或不用付租就沒有。 */
export function rentLine(k: Kernel, state: GameState): { id: string; owner: string; name: string; kind: 'due'; amount: number; order: number; pay: 'cred' | 'cash' | 'either' } | null {
  const h = homeOf(k, state)
  if (!h || h.residence.rent <= 0) return null
  return { id: RENT_ID, owner: 'rest', name: `${h.residence.name}的房租`, kind: 'due', amount: h.residence.rent, order: restRules(k).rent_order, pay: rentPayOf(h.residence) }
}

/** 一週結算之後房租的後果：沒付成就累計欠繳週數，欠到 lock_weeks 週門鎖被換掉；付清（這一週付成了）歸零、門鎖開。回傳要套的變更。 */
export function rentSettled(k: Kernel, state: GameState, line: { paid: number; unpaid: number; skipped?: true } | undefined): Change[] {
  const h = homeOf(k, state)
  if (!h || !line || line.skipped) return []
  const rest = readRest(state)
  const home: HomeState = rest.home!
  if (line.unpaid > 0) {
    home.arrears += 1
    home.locked = home.arrears >= restRules(k).lock_weeks
  } else if (home.arrears === 0 && !home.locked) return []
  else {
    home.arrears = 0
    home.locked = false
  }
  return [writeRest(rest)]
}
