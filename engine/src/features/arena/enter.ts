// L6 功能 arena 的報名：這裡能不能打、對手與押注的報價、開一場現實戰場的一對一（LEWD_SYSTEM 第 6 節；dev/adr/0019 P62；dev/work/M4-venues.md 第 5 點）。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
//
// 開戰：我方只有主角、敵方一個人；雙方都用戰鬥設定裡直接給的單位（`from: 'unit'`），武器換成規則發的那一把神經武器、快取格與義體清單清空
// （不讀角色自己的裝備）；沒有掩體；`field.safe`（熔斷：倒下不走戰敗的三選一、不加餘韻疊滿的沉溺）；不能脫離（escapable: false）。
// 押的錢不在報名時扣：贏了加、輸了減，在戰鬥結束時（activity.end）結算（settle.ts）。

import type { BattleSetup, BattleUnitInit, GameState, Kernel, ReportDraft, TimelineBeat, WeaponClassEntry } from '../../core'
import { ActionBlocked, areaGrade, attrMod, clone, formatAmount, modeOf, unitFromActor, weaponFromClass } from '../../core'
import type { ArenaRules } from './model'
import { ENTER_ACTION, OWNER, arenaHere, arenaRules, isText, readArena } from './model'

export interface EnterOpts {
  /** 對手：敵人的 id，或角色的 id（state.actors 裡的人） */
  foe: string
  /** 押多少現金（0 是不押） */
  stake: number
  /** 場次的等級（設施的 grades 之一）；沒寫取最接近這一區等級的 */
  grade?: number
}

/** 一次報名的報價（畫面與草稿用同一份）。 */
export interface ArenaQuote {
  foe: { id: string; name: string; kind: 'actor' | 'enemy' }
  grade: number
  stake: number
  /** 贏了的賠率（照雙方感載上限的差） */
  odds: number
  /** 贏了拿到的錢（押的 × 賠率，無條件捨去） */
  payout: number
  /** 雙方的感載上限 */
  mine: { name: string; cap: number }
  theirs: { name: string; cap: number }
  fee: number
  /** 報名費從哪裡付；不收費是 null */
  pay: 'cred' | 'cash' | null
}

interface Plan {
  problems: string[]
  quote: ArenaQuote | null
  setup: BattleSetup | null
}

/** 賠率：base ＋ 每差 1 點感載上限加 per_cap_diff（對手比你高越多賠越多），夾在 min～max，取到小數兩位。 */
export function oddsOf(rules: ArenaRules, myCap: number, foeCap: number): number {
  const o = rules.odds
  const raw = o.base + o.per_cap_diff * (foeCap - myCap)
  return Math.round(Math.min(o.max, Math.max(o.min, raw)) * 100) / 100
}

const pcOf = (state: GameState): string | undefined => (state.pc && state.actors[state.pc] ? state.pc : undefined)

/** 沒有橋（actor.ext.bridge 是 null）的人沒有感載，上不了擂台。 */
const unbridged = (state: GameState, actor: string): boolean => state.actors[actor]?.ext.bridge === null

/** 這裡能不能報名（和對手、押多少無關）：全部的原因；能是空陣列。 */
function baseProblems(k: Kernel, state: GameState): string[] {
  const p: string[] = []
  const pc = pcOf(state)
  if (!pc) return ['還沒有主角。']
  if (state.battle) p.push('戰鬥中不能報名。')
  else {
    const act = k.activity.blockOf(state, `commit:${ENTER_ACTION}`)
    if (act) p.push(act)
  }
  if (!arenaHere(k, state)) p.push('這裡不是感官擂台。')
  if (unbridged(state, pc)) p.push('你沒有橋，沒有感載可以比，擂台不收你。')
  return p
}

/** 把一個單位改成擂台的樣子：只有發的那一把神經武器、沒有快取格與義體。 */
function arenaUnit(k: Kernel, init: BattleUnitInit, rules: ArenaRules): BattleUnitInit | string {
  const cls = k.content.get<WeaponClassEntry>('weapon_class', rules.weapon.class)
  if (!cls) return `擂台發的武器（${rules.weapon.class}）在內容裡找不到。`
  const weapon = weaponFromClass(k.content, cls.id, {
    id: 'arena', name: cls.name, type: rules.weapon.type, hit: attrMod(init.attrs[cls.attr]) + (init.skills[cls.skill] ?? 0),
  })
  weapon.dice = rules.weapon.dice
  delete weapon.mag
  delete weapon.far
  const unit: BattleUnitInit = { ...clone(init), weapons: [weapon], wield: 0, quick: [], cyber: 0 }
  delete unit.implants
  return unit
}

/** 照對手的 id 解出他的單位（角色優先；其餘走敵人的來源）。解不出回傳原因。 */
function foeInit(k: Kernel, state: GameState, foe: string, grade: number): { init: BattleUnitInit; kind: 'actor' | 'enemy' } | string {
  const mode = modeOf(k.content, 'meat')
  if (!mode) return '現實的戰場還沒有註冊，開不了擂台。'
  const a = state.actors[foe]
  if (a) {
    if (foe === state.pc) return '不能跟自己打。'
    if (unbridged(state, foe)) return `${a.name}沒有橋，沒有感載可以比。`
    try {
      const init = unitFromActor(k, state, foe, mode, grade as never)
      return { init: { ...init, control: 'ai' }, kind: 'actor' }
    } catch (e) {
      return `${a.name}上不了擂台（${(e as Error).message}）。`
    }
  }
  const source = k.battle.getUnitSource('enemy')
  if (!source) return `沒有「${foe}」這個對手（敵人的來源還沒有註冊）。`
  try {
    return { init: source({ from: 'enemy', id: foe, grade }, { k, state, side: 'foe', mode: 'meat', grade, allyCount: 1 }), kind: 'enemy' }
  } catch (e) {
    return `沒有「${foe}」這個對手（${(e as Error).message}）。`
  }
}

/** 報名費從哪裡付：先帳戶，不夠再用現金（扣掉押的之後還付得起）；付不起是 null。 */
function feePool(state: GameState, fee: number, stake: number): 'cred' | 'cash' | null {
  if (fee <= 0) return null
  if (state.money.cred >= fee) return 'cred'
  return state.money.cash - stake >= fee ? 'cash' : null
}

function plan(k: Kernel, state: GameState, o: EnterOpts): Plan {
  const problems = baseProblems(k, state)
  const pc = pcOf(state)
  const here = arenaHere(k, state)
  if (!pc) return { problems, quote: null, setup: null }
  const rules = arenaRules(k)

  // 押注
  const stake = o.stake
  if (!(Number.isInteger(stake) && stake >= 0)) problems.push('押的錢要是 0 以上的整數。')
  else {
    if (here?.facility.stake_max !== undefined && stake > here.facility.stake_max) problems.push(`${here.name}一場最多押 ${formatAmount(here.facility.stake_max)}。`)
    if (stake > state.money.cash) problems.push(`現金不夠：要押 ${formatAmount(stake)}，身上只有 ${formatAmount(state.money.cash)}。`)
  }
  const stakeOk = Number.isInteger(stake) && stake >= 0

  // 場次的等級
  const grades = here?.facility.grades ?? []
  let grade = areaGrade(k, state) as number
  if (o.grade !== undefined) {
    if (grades.length > 0 && !grades.includes(o.grade)) problems.push(`${here!.name}沒有第 ${o.grade} 級的場次，只有：${grades.join('、')}。`)
    grade = o.grade
  } else if (grades.length > 0) grade = grades.reduce((best, g) => (Math.abs(g - grade) < Math.abs(best - grade) ? g : best), grades[0]!)

  // 報名費
  const fee = rules.fee
  const pay = stakeOk ? feePool(state, fee, stake) : null
  if (fee > 0 && stakeOk && !pay) problems.push(`錢不夠：報名費要 ${formatAmount(fee)}，帳戶付不起，現金扣掉押的也付不起。`)

  // 對手
  if (!isText(o.foe)) {
    problems.push('要選一個對手。')
    return { problems, quote: null, setup: null }
  }
  const mode = modeOf(k.content, 'meat')
  if (!mode || !state.actors[pc]) return { problems: [...problems, '現實的戰場還沒有註冊，開不了擂台。'], quote: null, setup: null }
  const mineRaw = unbridged(state, pc) ? null : unitFromActor(k, state, pc, mode, grade as never)
  const foeRaw = foeInit(k, state, o.foe, grade)
  if (typeof foeRaw === 'string') return { problems: [...problems, foeRaw], quote: null, setup: null }
  if (!foeRaw.init.load) problems.push(`${foeRaw.init.name}沒有感載，打不起來。`)
  if (!mineRaw || problems.length > 0) return { problems, quote: null, setup: null }

  const mine = arenaUnit(k, mineRaw, rules)
  const theirs = arenaUnit(k, foeRaw.init, rules)
  if (typeof mine === 'string') return { problems: [...problems, mine], quote: null, setup: null }
  if (typeof theirs === 'string') return { problems: [...problems, theirs], quote: null, setup: null }
  const myCap = mine.load!.max
  const foeCap = theirs.load!.max
  const odds = oddsOf(rules, myCap, foeCap)
  const quote: ArenaQuote = {
    foe: { id: o.foe, name: theirs.name, kind: foeRaw.kind }, grade, stake, odds, payout: Math.floor(stake * odds),
    mine: { name: mine.name, cap: myCap }, theirs: { name: theirs.name, cap: foeCap }, fee, pay,
  }
  const setup: BattleSetup = {
    mode: 'meat', grade: grade as never, cover: { ally: [], foe: [] }, field: { safe: true },
    allies: [{ from: 'unit', unit: mine as unknown as Record<string, unknown>, slot: 1, control: 'player' }],
    foes: [{ from: 'unit', unit: theirs as unknown as Record<string, unknown>, slot: 1, control: 'ai' }],
    origin: { escapable: false, place: here!.name },
  }
  // 開戰的放行（別的活動擋住時）
  const startBlock = k.activity.blockOf(state, 'battle.start', undefined, { kind: 'battle', setup })
  if (startBlock) problems.push(startBlock)
  return { problems, quote: problems.length > 0 ? null : quote, setup }
}

// ---- 對外 ----

/** 這裡能不能報名（不看對手與押多少）：第一條原因；能是 null。 */
export const arenaBlock = (k: Kernel, state: GameState): string | null => baseProblems(k, state)[0] ?? null

export interface ArenaOptions {
  /** 這裡現在能不能報名 */
  open: boolean
  /** 不能的原因（一條一句）；能是空的 */
  blocks: string[]
  /** 這個擂台的名字（不在擂台是 null） */
  name: string | null
  grades: number[]
  stake_max: number | null
  /** 擂台發的武器與賠率、報名費（規則） */
  rules: ArenaRules
  /** 你的感載上限（沒有橋是 null） */
  cap: number | null
  wins: number
  losses: number
}

/** 這裡能不能打、擂台的規矩、你的戰績。對手的清單由呼叫的人給（arenaView）。 */
export function arenaOptions(k: Kernel, state: GameState): ArenaOptions {
  const blocks = baseProblems(k, state)
  const here = arenaHere(k, state)
  const pc = pcOf(state)
  const mode = modeOf(k.content, 'meat')
  const rec = readArena(state)
  let cap: number | null = null
  if (pc && mode && !unbridged(state, pc)) {
    try {
      cap = unitFromActor(k, state, pc, mode, areaGrade(k, state)).load?.max ?? null
    } catch {
      cap = null
    }
  }
  return {
    open: blocks.length === 0, blocks, name: here?.name ?? null, grades: here ? [...here.facility.grades] : [], stake_max: here?.facility.stake_max ?? null,
    rules: arenaRules(k), cap, wins: rec.wins, losses: rec.losses,
  }
}

/** 這一次報名現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const enterProblems = (k: Kernel, state: GameState, o: EnterOpts): string[] => plan(k, state, o).problems
/** 這一次報名現在行不行：第一條原因；行是 null。 */
export const enterBlock = (k: Kernel, state: GameState, o: EnterOpts): string | null => plan(k, state, o).problems[0] ?? null
/** 這一次報名的報價（賠率、贏了拿多少、雙方的感載上限）；現在不行是 null。 */
export const enterQuote = (k: Kernel, state: GameState, o: EnterOpts): ArenaQuote | null => plan(k, state, o).quote

/**
 * 報名：報告 arena.enter，帶 launch 開一場現實戰場的一對一（origin 是 { by: 'arena', ext: { arena: { stake, odds, grade, foe } } }）。
 * 報名費現在扣；押的錢在戰鬥結束時結算。不成立丟 ActionBlocked。
 */
export function enterDraft(k: Kernel, state: GameState, o: EnterOpts): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0 || !p.quote || !p.setup) throw new ActionBlocked(p.problems[0] ?? '現在不能報名。')
  const q = p.quote
  const here = arenaHere(k, state)!
  const pc = state.pc!
  const changes: ReportDraft['changes'] = []
  if (q.pay && q.fee > 0) changes.push({ op: q.pay, delta: -q.fee })
  const text = `你在${here.name}報了名，對手是${q.foe.name}${q.stake > 0 ? `，押了 ${formatAmount(q.stake)}` : ''}。`
  const beats: TimelineBeat[] = [{ layer: 'meat', actor: pc, text, tag: ENTER_ACTION, data: { foe: q.foe.id, stake: q.stake, odds: q.odds, grade: q.grade, fee: q.fee } }]
  return {
    kind: 'action', action: ENTER_ACTION, location: clone(state.location), actor: pc, party: [], timeline: beats, changes,
    outcome: { result: 'enter', summary: text }, narration: { results: [text] },
    launch: [{
      kind: 'battle', setup: p.setup,
      origin: { by: OWNER, ref: here.type, ext: { arena: { stake: q.stake, odds: q.odds, grade: q.grade, foe: q.foe.name } } },
    }],
  }
}

export interface ArenaRow {
  foe: string
  /** 現在不能報名的原因（一條一句）；能是 null */
  block: string | null
  quote: ArenaQuote | null
}

export interface ArenaView {
  options: ArenaOptions
  /** 呼叫的人給的每個對手：報價與不能的原因 */
  rows: ArenaRow[]
}

/** 畫面的資料：這裡的擂台、你的戰績、給的每個對手各自的報價（押 stake，沒給是 0）。純函式。 */
export function arenaView(k: Kernel, state: GameState, o: { foes?: string[]; stake?: number; grade?: number } = {}): ArenaView {
  return {
    options: arenaOptions(k, state),
    rows: (o.foes ?? []).map((foe) => {
      const p = plan(k, state, { foe, stake: o.stake ?? 0, ...(o.grade !== undefined ? { grade: o.grade } : {}) })
      return { foe, block: p.problems[0] ?? null, quote: p.quote }
    }),
  }
}
