// 別的功能把東西接進輿論戰的四個掛點、三張封閉清單與它們的格式檢查（M5-opinion-desk；dev/adr/0020 第五節、第十三節）。
//   opinion.moves     { state, war, desk } → OpMove[]      坐著的人有哪些主動的招（花編輯點）。每次問（畫面與用招都問），不存起來
//   opinion.passives  { state, war, desk } → OpPassive[]   被動、反應與修正。開戰時問一次、存在 war.passives（戰役中途不再問；問編輯台選項時 war 是 null）
//   opinion.open      { state, topic, foe, desk } → OpOpen[]   開場多出來的東西
//   opinion.check     { what, data } → string[]             一筆資料的格式問題（opinion 自己回答：abilities 在內容載入之後把每個技能的輿論欄交給它驗）
// 招與被動的效果是 opinion 自己的封閉清單（OP_EFFECTS、OP_MODS、OP_TRIGGERS），只改戰役的狀態，不進 k.effects。
// 回答的資料格式不對的那一筆在用到時略過並在紀錄裡提醒（不丟錯）：和 opinion.check 用同一套檢查。

import type { GameState, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import { parseWhen } from './when'
import type { War, WarFoe, WarTopic } from './model'
import { CELLS, isCell } from './model'

// ---- 格式 ----

/** 戰役的效果（封閉清單 OP_EFFECTS 裡的一種；欄位照種類，見 effectProblems）。 */
export type OpEffect = { kind: string; [field: string]: unknown }

export interface OpMove {
  id: string
  owner: string
  actor: string
  name: string
  /** 編輯點 */
  cost: number
  limit?: { per: 'turn' | 'war'; n: number }
  /** 條件（k.conditions 的格式；看用招的那個人） */
  need?: Record<string, unknown>
  effects: OpEffect[]
}

export interface OpMod {
  kind: string
  amount?: number
  /** 條件（和對手行動的 when 同一套文法，只是不能用 can_capture）：成立才算 */
  when?: string
  /** def_cell 的那一格 */
  cell?: string
  /** def_cell：只算這一場的第一次 */
  once?: boolean
  /** shield：抵銷哪一種（寫幾種就是幾種共用同一個次數） */
  what?: string | string[]
  n?: number
}

export interface OpReact {
  /** 觸發點（OP_TRIGGERS）；寫一串是任何一個都算 */
  on: string | string[]
  /** 從這回合沒用完的編輯點扣（玩家在結束回合時預留）；沒寫就自動發動 */
  cost?: number
  limit?: { per: 'turn' | 'war'; n: number }
  /** 這一回合有人記過這個旗標（效果 mark）才發動 */
  if_mark?: string
  when?: string
  effects: OpEffect[]
}

export interface OpPassive {
  id: string
  owner: string
  /** 這個人坐在編輯台才算；沒寫是整張編輯台的（編輯點加在第一個座位） */
  actor?: string
  name: string
  mods?: OpMod[]
  reacts?: OpReact[]
}

export interface OpOpen {
  owner: string
  voice?: number
  wind?: number
  /** 開場就佔著的格子（沒人的才佔） */
  cells?: string[]
  /** 開場手牌多幾張 */
  hand?: number
  /** 對手第一回合少幾點公關點 */
  foe_pr_first?: number
  /** 牌庫多放的牌（牌目錄的 id） */
  cards?: string[]
  /** 進開場紀錄的一句話 */
  line: string
}

declare module '../../core' {
  interface HookMap {
    /** 坐著的人有哪些主動的招（opinion 宣告並問；abilities 回答）。 */
    'opinion.moves': [{ state: GameState; war: War; desk: string[] }, OpMove[] | void]
    /** 被動、反應與修正（開戰時問一次存進 war.passives；問編輯台選項時 war 是 null）。 */
    'opinion.passives': [{ state: GameState; war: War | null; desk: string[] }, OpPassive[] | void]
    /** 開場多出來的東西（格子、聲量、風向、手牌、對手第一回合少幾點、加一張牌）。 */
    'opinion.open': [{ state: GameState; topic: WarTopic; foe: WarFoe; desk: string[] }, OpOpen[] | void]
    /** 一筆招、被動或開場的格式問題（opinion 回答；沒有問題是空陣列）。 */
    'opinion.check': [{ what: 'move' | 'passive' | 'open'; data: unknown }, string[] | void]
  }
}

// ---- 三張封閉清單 ----

export const OP_EFFECTS = [
  'voice', 'foe_voice', 'wind', 'draw', 'guard', 'capture_extra', 'def_mod', 'card_mod', 'ep', 'foe_pr', 'take', 'free_adjacency', 'negate', 'reverse', 'retake', 'link_voice', 'roll', 'mark', 'out',
] as const
export type OpEffectKind = (typeof OP_EFFECTS)[number]
/** 只能寫在反應裡的三種。 */
export const REACTION_ONLY = ['negate', 'reverse', 'retake'] as const

export const OP_MODS = [
  'ep', 'ep_cap', 'open_hand', 'open_voice', 'open_wind', 'fuel_first', 'fuel_first2', 'line_first', 'wind_first', 'cred_line_at', 'def_own', 'def_first_empty', 'def_cell', 'draw_extra', 'foe_release',
  'shield', 'forged_ok', 'free_army',
] as const
export type OpModKind = (typeof OP_MODS)[number]

export const OP_TRIGGERS = [
  'foe.release', 'foe.deny', 'foe.counter', 'foe.mute', 'foe.lawyer', 'foe.takedown', 'foe.capture', 'foe.capture_last', 'cell.lost', 'turn.start',
] as const
export type OpTrigger = (typeof OP_TRIGGERS)[number]

/** shield 抵銷得了的對手行動。 */
export const SHIELD_WHAT = ['lawyer', 'takedown', 'mute'] as const

/** 每一種修正的 amount 範圍（none 是不寫 amount）。 */
const MOD_AMOUNT: Record<OpModKind, [number, number] | 'none'> = {
  ep: [-3, 3], ep_cap: [0, 3], open_hand: [-3, 5], open_voice: [-5, 10], open_wind: [-5, 5], fuel_first: [-3, 5], fuel_first2: [-3, 5], line_first: [-3, 5], wind_first: [0, 5], cred_line_at: [1, 100],
  def_own: [-3, 3], def_first_empty: [0, 5], def_cell: [-3, 3], draw_extra: [1, 3], foe_release: [0, 5], shield: 'none', forged_ok: 'none', free_army: [0, 10],
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const intIn = (v: unknown, lo: number, hi: number): v is number => isSafeInt(v) && v >= lo && v <= hi
const list = (xs: readonly string[]): string => xs.join('、')

function whenProblem(v: unknown, at: string): string[] {
  if (typeof v !== 'string') return [`${at}.when 要是條件的字串`]
  const r = parseWhen(v)
  if (!r.ok) return [`${at}.when「${v}」寫錯了：${r.error}`]
  if (!r.when.always && r.when.terms.some((t) => t.v === 'can_capture')) return [`${at}.when「${v}」不能用 can_capture（只有對手的行動表能用）`]
  return []
}

const cellList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isCell)

function limitProblems(v: unknown, at: string): string[] {
  if (v === undefined) return []
  return isRecord(v) && (v.per === 'turn' || v.per === 'war') && intIn(v.n, 1, 9) ? [] : [`${at}.limit 要是 { per: turn 或 war, n: 1～9 }`]
}

/** 一筆效果的格式問題（reaction：是不是寫在反應裡，negate、reverse、retake 只能在反應裡）。深度最多兩層（roll 裡的 roll）。 */
export function effectProblems(e: unknown, at: string, o: { reaction: boolean; depth?: number } = { reaction: false }): string[] {
  if (!isRecord(e)) return [`${at} 要是 { kind, … }`]
  const kind = e.kind
  if (typeof kind !== 'string' || !(OP_EFFECTS as readonly string[]).includes(kind)) return [`${at}.kind「${String(kind)}」不在效果的封閉清單裡（可以用的：${list(OP_EFFECTS)}）`]
  const depth = o.depth ?? 0
  const p: string[] = []
  const need = (key: string, ok: boolean, text: string): void => { if (!ok) p.push(`${at}.${key} ${text}`) }
  if (!o.reaction && (REACTION_ONLY as readonly string[]).includes(kind)) p.push(`${at}.kind「${kind}」只能寫在反應（reacts）裡`)
  const sub = (v: unknown, key: string): void => {
    if (!Array.isArray(v)) return void p.push(`${at}.${key} 要是效果的陣列`)
    if (depth >= 2) return void p.push(`${at}.${key} 的效果疊太深了（roll 裡最多再放一層 roll）`)
    v.forEach((x, i) => p.push(...effectProblems(x, `${at}.${key}[${i}]`, { reaction: o.reaction, depth: depth + 1 })))
  }
  switch (kind) {
    case 'voice': case 'foe_voice': need('amount', intIn(e.amount, -10, 10), '要是 −10～10 的整數'); break
    case 'wind': need('amount', intIn(e.amount, -5, 5), '要是 −5～5 的整數'); break
    case 'draw':
      need('n', intIn(e.n, 1, 5), '要是 1～5 的整數')
      need('then_discard', e.then_discard === undefined || intIn(e.then_discard, 0, 5), '要是 0～5 的整數')
      break
    case 'guard':
      need('cells', e.cells === 'pick' || e.cells === 'all' || cellList(e.cells) || intIn(e.cells, 1, 9), `要是 'pick'、'all'、格子 id 的陣列（${list(CELLS)}）或 1～9 的整數`)
      need('rounds', e.rounds === undefined || intIn(e.rounds, 1, 6), '要是 1～6 的整數')
      break
    case 'capture_extra':
      need('n', intIn(e.n, 1, 3), '要是 1～3 的整數')
      need('def', e.def === undefined || intIn(e.def, -5, 5), '要是 −5～5 的整數')
      need('any', e.any === undefined || typeof e.any === 'boolean', '要是 true 或 false')
      break
    case 'def_mod':
      need('amount', intIn(e.amount, -5, 5) && e.amount !== 0, '要是 −5～5 的整數（不能是 0）')
      need('scope', e.scope === 'next' || e.scope === 'turn' || e.scope === 'war', "要是 'next'、'turn' 或 'war'")
      need('vs', e.vs === undefined || e.vs === 'empty' || e.vs === 'foe', "要是 'empty' 或 'foe'")
      need('cells', e.cells === undefined || cellList(e.cells), `要是格子 id 的陣列（${list(CELLS)}）`)
      need('first_each_turn', e.first_each_turn === undefined || typeof e.first_each_turn === 'boolean', '要是 true 或 false')
      break
    case 'card_mod':
      // 效果自己的種類欄就叫 kind，所以「改哪一種牌」的欄位叫 card（工單原本寫 kind，撞名）
      need('card', e.card === 'fuel' || e.card === 'line', "要是 'fuel' 或 'line'（改哪一種牌）")
      need('scope', e.scope === 'next' || e.scope === 'turn', "要是 'next' 或 'turn'")
      need('amount', e.amount === undefined || intIn(e.amount, -5, 5), '要是 −5～5 的整數')
      need('mult', e.mult === undefined || intIn(e.mult, 2, 4), '要是 2～4 的整數')
      need('cap', e.cap === undefined || intIn(e.cap, 1, 10), '要是 1～10 的整數（最多多出幾點）')
      if (e.amount === undefined && e.mult === undefined) p.push(`${at} 要寫 amount 或 mult`)
      break
    case 'ep':
      need('amount', intIn(e.amount, -3, 3) && e.amount !== 0, '要是 −3～3 的整數（不能是 0）')
      need('scope', e.scope === 'now' || e.scope === 'war', "要是 'now' 或 'war'")
      break
    case 'foe_pr':
      need('amount', intIn(e.amount, -6, 6) && e.amount !== 0, '要是 −6～6 的整數（不能是 0）')
      need('scope', e.scope === 'next', "要是 'next'")
      break
    case 'take':
      need('cells', cellList(e.cells), `要是格子 id 的陣列（${list(CELLS)}）`)
      need('if', e.if === 'empty' || e.if === 'any', "要是 'empty' 或 'any'")
      need('foe_def_zero', e.foe_def_zero === undefined || typeof e.foe_def_zero === 'boolean', '要是 true 或 false')
      break
    case 'free_adjacency': need('scope', e.scope === 'war', "要是 'war'"); break
    case 'link_voice': {
      need('amount', intIn(e.amount, 1, 10), '要是 1～10 的整數')
      const el = e.else
      if (!isRecord(el)) { p.push(`${at}.else 要是 { skill, dc, pass, fail }`); break }
      need('else.skill', isText(el.skill), '要是基本功的 id')
      need('else.dc', intIn(el.dc, 1, 40), '要是 1～40 的整數')
      for (const side of ['pass', 'fail'] as const) {
        const v = el[side]
        if (intIn(v, -10, 10)) continue
        if (Array.isArray(v)) sub(v, `else.${side}`)
        else p.push(`${at}.else.${side} 要是聲量的整數，或效果的陣列`)
      }
      break
    }
    case 'roll':
      need('skill', isText(e.skill), "要是基本功的 id，或 'd20'（純擲骰、不加任何基本功）")
      need('dc', intIn(e.dc, 1, 40), '要是 1～40 的整數')
      sub(e.pass, 'pass')
      sub(e.fail, 'fail')
      break
    case 'mark': need('key', isText(e.key), '要是旗標的名字'); break
    case 'out': need('effect', isRecord(e.effect) && isText(e.effect.kind), '要是一筆 k.effects 的效果 { kind, … }'); break
    default: break
  }
  return p
}

export function moveProblems(raw: unknown, k?: Pick<Kernel, 'conditions'>): string[] {
  if (!isRecord(raw)) return ['招要是 { id, owner, actor, name, cost, effects }']
  const p: string[] = []
  const who = isText(raw.name) ? `招「${raw.name}」` : isText(raw.id) ? `招「${raw.id}」` : '這一招'
  for (const f of ['id', 'owner', 'actor', 'name']) if (!isText(raw[f])) p.push(`${who}的 ${f} 要是字串`)
  if (!intIn(raw.cost, 0, 6)) p.push(`${who}的 cost 要是 0～6 的整數（編輯點）`)
  p.push(...limitProblems(raw.limit, who))
  if (raw.need !== undefined) {
    if (!isRecord(raw.need)) p.push(`${who}的 need 要是條件（物件）`)
    else if (k) p.push(...k.conditions.validate(raw.need, `${who}的 need`))
  }
  if (!Array.isArray(raw.effects) || raw.effects.length === 0) p.push(`${who}的 effects 要是效果的陣列（至少一筆）`)
  else raw.effects.forEach((e, i) => p.push(...effectProblems(e, `${who}的 effects[${i}]`)))
  return p
}

function modProblems(m: unknown, at: string): string[] {
  if (!isRecord(m)) return [`${at} 要是 { kind, amount? }`]
  const kind = m.kind
  if (typeof kind !== 'string' || !(OP_MODS as readonly string[]).includes(kind)) return [`${at}.kind「${String(kind)}」不在修正的封閉清單裡（可以用的：${list(OP_MODS)}）`]
  const p: string[] = []
  const spec = MOD_AMOUNT[kind as OpModKind]
  if (spec !== 'none' && !intIn(m.amount, spec[0], spec[1])) p.push(`${at}.amount 要是 ${spec[0]}～${spec[1]} 的整數`)
  if (spec === 'none' && m.amount !== undefined && !intIn(m.amount, -99, 99)) p.push(`${at}.amount 要是整數`)
  if (m.when !== undefined) p.push(...whenProblem(m.when, at))
  if (kind === 'def_cell') {
    if (!isCell(m.cell)) p.push(`${at}.cell 要是格子的 id（${list(CELLS)}）`)
    if (m.once !== undefined && typeof m.once !== 'boolean') p.push(`${at}.once 要是 true 或 false`)
  }
  if (kind === 'shield') {
    const what = Array.isArray(m.what) ? m.what : [m.what]
    if (what.length === 0 || !what.every((w) => (SHIELD_WHAT as readonly unknown[]).includes(w))) p.push(`${at}.what 要是 ${list(SHIELD_WHAT)}（或它們的陣列）`)
    if (!intIn(m.n, 1, 9)) p.push(`${at}.n 要是 1～9 的整數（每場抵銷幾次）`)
  }
  return p
}

function reactProblems(r: unknown, at: string): string[] {
  if (!isRecord(r)) return [`${at} 要是 { on, effects }`]
  const p: string[] = []
  const ons = Array.isArray(r.on) ? r.on : [r.on]
  const okOn = ons.length > 0 && ons.every((x) => (OP_TRIGGERS as readonly unknown[]).includes(x))
  if (!okOn) p.push(`${at}.on「${ons.map(String).join('、')}」不在觸發點的封閉清單裡（可以用的：${list(OP_TRIGGERS)}）`)
  if (r.cost !== undefined && !intIn(r.cost, 1, 6)) p.push(`${at}.cost 要是 1～6 的整數（編輯點；沒寫就是自動發動）`)
  p.push(...limitProblems(r.limit, at))
  if (r.if_mark !== undefined && !isText(r.if_mark)) p.push(`${at}.if_mark 要是旗標的名字`)
  if (r.when !== undefined) p.push(...whenProblem(r.when, at))
  if (!Array.isArray(r.effects) || r.effects.length === 0) return [...p, `${at}.effects 要是效果的陣列（至少一筆）`]
  const effects = r.effects as unknown[]
  effects.forEach((e, i) => p.push(...effectProblems(e, `${at}.effects[${i}]`, { reaction: true })))
  if (okOn) {
    const has = (kind: string): boolean => effects.some((e) => isRecord(e) && e.kind === kind)
    const onList = ons as string[]
    if (has('retake') && !onList.every((x) => x === 'cell.lost')) p.push(`${at}：retake 只能用在 cell.lost 的反應`)
    if (has('reverse') && !onList.every((x) => x === 'foe.deny' || x === 'foe.counter')) p.push(`${at}：reverse 只能用在 foe.deny、foe.counter 的反應`)
    if (has('negate') && onList.some((x) => x === 'cell.lost' || x === 'turn.start')) p.push(`${at}：negate 不能用在 cell.lost、turn.start 的反應（沒有哪一步可以讓它無效）`)
    if (r.cost !== undefined && onList.includes('turn.start')) p.push(`${at}：turn.start 的反應沒有「沒用完的編輯點」可以預留，不能寫 cost`)
  }
  return p
}

export function passiveProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['被動要是 { id, owner, name, mods?, reacts? }']
  const p: string[] = []
  const who = isText(raw.name) ? `被動「${raw.name}」` : isText(raw.id) ? `被動「${raw.id}」` : '這一筆被動'
  for (const f of ['id', 'owner', 'name']) if (!isText(raw[f])) p.push(`${who}的 ${f} 要是字串`)
  if (raw.actor !== undefined && !isText(raw.actor)) p.push(`${who}的 actor 要是角色 id`)
  if (raw.mods === undefined && raw.reacts === undefined) p.push(`${who}要寫 mods 或 reacts`)
  if (raw.mods !== undefined) {
    if (!Array.isArray(raw.mods)) p.push(`${who}的 mods 要是修正的陣列`)
    else raw.mods.forEach((m, i) => p.push(...modProblems(m, `${who}的 mods[${i}]`)))
  }
  if (raw.reacts !== undefined) {
    if (!Array.isArray(raw.reacts)) p.push(`${who}的 reacts 要是反應的陣列`)
    else raw.reacts.forEach((r, i) => p.push(...reactProblems(r, `${who}的 reacts[${i}]`)))
  }
  return p
}

export function openProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['開場要是 { owner, line, … }']
  const p: string[] = []
  const who = isText(raw.owner) ? `開場（${raw.owner}）` : '這一筆開場'
  if (!isText(raw.owner)) p.push(`${who}的 owner 要是字串`)
  if (!isText(raw.line)) p.push(`${who}的 line 要是進開場紀錄的一句話`)
  if (raw.voice !== undefined && !intIn(raw.voice, 0, 10)) p.push(`${who}的 voice 要是 0～10 的整數`)
  if (raw.wind !== undefined && !intIn(raw.wind, -5, 5)) p.push(`${who}的 wind 要是 −5～5 的整數`)
  if (raw.cells !== undefined && !(Array.isArray(raw.cells) && raw.cells.length > 0 && raw.cells.every(isCell))) p.push(`${who}的 cells 要是格子 id 的陣列（${list(CELLS)}）`)
  if (raw.hand !== undefined && !intIn(raw.hand, 0, 5)) p.push(`${who}的 hand 要是 0～5 的整數`)
  if (raw.foe_pr_first !== undefined && !intIn(raw.foe_pr_first, 0, 6)) p.push(`${who}的 foe_pr_first 要是 0～6 的整數`)
  if (raw.cards !== undefined && !(Array.isArray(raw.cards) && raw.cards.length > 0 && raw.cards.every(isText))) p.push(`${who}的 cards 要是牌的 id 的陣列`)
  return p
}

// ---- 問掛點 ----

export interface Asked<T> {
  items: T[]
  /** 資料格式不對、略過的那幾筆（一句話一條，給紀錄提醒） */
  skipped: string[]
}

function collect<T>(raws: unknown[], check: (x: unknown) => string[], keep: (x: T) => boolean): Asked<T> {
  const items: T[] = []
  const skipped: string[] = []
  for (const raw of raws) {
    const problems = check(raw)
    if (problems.length > 0) skipped.push(`${problems[0]}（這一筆略過了）`)
    else if (keep(raw as T)) items.push(raw as T)
  }
  return { items, skipped }
}

const flat = (answers: Array<{ result: unknown }>): unknown[] => answers.flatMap((a) => (Array.isArray(a.result) ? (a.result as unknown[]) : []))

export function askMoves(k: Kernel, state: GameState, war: War, desk: string[]): Asked<OpMove> {
  return collect<OpMove>(flat(k.hooks.run('opinion.moves', { state, war, desk })), (m) => moveProblems(m, k), (m) => desk.includes(m.actor))
}

export function askPassives(k: Kernel, state: GameState, war: War | null, desk: string[]): Asked<OpPassive> {
  return collect<OpPassive>(flat(k.hooks.run('opinion.passives', { state, war, desk })), passiveProblems, (p) => p.actor === undefined || desk.includes(p.actor))
}

export function askOpen(k: Kernel, state: GameState, topic: WarTopic, foe: WarFoe, desk: string[]): Asked<OpOpen> {
  return collect<OpOpen>(flat(k.hooks.run('opinion.open', { state, topic, foe, desk })), openProblems, () => true)
}

/** opinion.check 的回答：opinion 自己驗（abilities 在內容載入之後把每個技能的輿論欄交過來）。 */
export function answerCheck(k: Pick<Kernel, 'conditions'>, what: 'move' | 'passive' | 'open', data: unknown): string[] {
  return what === 'move' ? moveProblems(data, k) : what === 'passive' ? passiveProblems(data) : openProblems(data)
}
