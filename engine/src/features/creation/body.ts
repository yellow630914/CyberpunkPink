// L6 功能 creation 的第 6、8、9 步（M4-creation-body；CHARACTER 第 1 節、2.1 節、5.4 節；dev/adr/0019 第十一節與 P52～P55）。
//
// creation 不 import 別的功能：義體、技能、裝備各自檢查屬於自己的那一部分，經掛點 creation.step 回答。這裡只管：
//   問掛點（askStep）、把大家的回答合起來、沒有任何人認得的選項是一條擋住的原因、點數的上限、沒花完的換多少現金、給畫面的總覽（creationSummary）。
// 草稿沒有給選的東西（bridge、cyber、abilities、gear 都沒寫）時，沒有人回答，行為和以前一樣（只看 cyberSpent、gearSpent）。

import type { Change, GameState, Kernel } from '../../core'
import { isRecord } from '../../core'
import type { CreationBlock, CreationDraft, CreationLimits } from './model'
import { creationLimits } from './model'

/** 掛點 creation.step 問的三步：cyber 第 6 步（橋與義體）、abilities 第 8 步（技能）、gear 第 9 步（裝備）。 */
export type BodyStep = 'cyber' | 'abilities' | 'gear'
export const BODY_STEPS: readonly BodyStep[] = ['cyber', 'abilities', 'gear']

/** 主角建好時身上已經有的一件東西（畫面在第 6 步與第 9 步的側欄列出來，免得重複挑）。 */
export interface OwnedItem {
  id: string
  name: string
  /** 物品的類別，或 weapon、armor（設計圖）、cyberware、deck、construct、skin */
  category: string
  /** 部位（義體）、穿戴或攜帶的位置（武器、護甲） */
  slots?: string[]
  qty: number
  /** kit：出身白給的；pick：這一份草稿選的 */
  from: 'kit' | 'pick'
}

export type CapacitySplit = Partial<Record<'meat' | 'net' | 'social' | 'media', number>>

/**
 * 一個功能對一步的回答。picks 是這一步的選項（cyber：橋（{ blueprint, bridge: true }）加其他義體；abilities：技能的 id；gear：{ id, qty }）；
 * took 是它認得的是 picks 裡第幾個。
 */
export interface StepAnswer {
  took: number[]
  /** 擋住的原因（給玩家看的完整句子，一條一個條件） */
  blocks?: string[]
  /** 這一步花了幾點（義體點數、裝備點數；技能是歷練點，由技能自己比上限） */
  points?: number
  /** 提交時接在放進主角的那一筆後面的變更；同一個角色同一個 actor.ext 鍵，後面的蓋掉前面的 */
  changes?: Change[]
  /** 放進主角時就寫在 actor.ext 的鍵（actor.ext 變更寫 null 是拿掉那一欄，寫不出「沒有橋」的 bridge: null） */
  ext?: Record<string, unknown>
  /** 這一步讓沉溺的起點多幾點（義體的沉溺成本合計） */
  sink?: number
  /** 橋的四類容量 */
  capacity?: CapacitySplit
  /** 身上已經有的 */
  owned?: OwnedItem[]
  /** 這一步要先讓玩家知道的事（例：沒有橋的後果） */
  notes?: string[]
}

export interface StepPayload {
  state: GameState
  draft: CreationDraft
  step: BodyStep
  picks: unknown[]
  limits: CreationLimits
}

declare module '../../core' {
  interface HookMap {
    /**
     * 建角的第 6、8、9 步（M4-creation-body）：把草稿交出去，每個功能檢查屬於自己的那一部分，回答擋住的原因、花了幾點、提交時要加的變更。
     * 好幾個功能回答時合起來；沒有任何人認得的選項是一條擋住的原因。state 是建角之前的狀態（還沒有主角），唯讀。
     */
    'creation.step': [StepPayload, StepAnswer | void]
  }
}

/** 一步問完、合起來的結果。 */
export interface StepResult {
  step: BodyStep
  picks: unknown[]
  /** 有沒有任何功能回答（沒有人回答：這一步沒有人管，照舊） */
  answered: boolean
  blocks: string[]
  /** 花了幾點；沒有人給點數是 undefined */
  points: number | undefined
  changes: Change[]
  ext: Record<string, unknown>
  sink: number
  capacity: CapacitySplit | undefined
  owned: OwnedItem[]
  notes: string[]
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 這一步的選項。 */
export function picksOf(draft: Pick<CreationDraft, 'bridge' | 'cyber' | 'abilities' | 'gear'>, step: BodyStep): unknown[] {
  if (step === 'cyber') return [...(typeof draft.bridge === 'string' ? [{ blueprint: draft.bridge, bridge: true }] : []), ...(Array.isArray(draft.cyber) ? draft.cyber : [])]
  if (step === 'abilities') return Array.isArray(draft.abilities) ? [...draft.abilities] : []
  return Array.isArray(draft.gear) ? [...draft.gear] : []
}

/** 選項的名字（沒有功能認得時寫進原因）。 */
function pickName(pick: unknown): string {
  if (typeof pick === 'string') return pick
  if (isRecord(pick)) {
    if (typeof pick.blueprint === 'string') return pick.blueprint
    if (typeof pick.id === 'string') return pick.id
  }
  return '（格式不對的選項）'
}

/** 後面的 actor.ext 蓋掉前面同一個角色同一個鍵的（義體的功能在第 6 步與第 9 步各寫一份身上的義體，後寫的是完整的那一份）。 */
export function dedupeExt(changes: Change[]): Change[] {
  const last = new Map<string, number>()
  changes.forEach((c, i) => {
    const t = c as { op: string; id?: unknown; key?: unknown }
    if (t.op === 'actor.ext') last.set(`${String(t.id)}/${String(t.key)}`, i)
  })
  return changes.filter((c, i) => {
    const t = c as { op: string; id?: unknown; key?: unknown }
    return t.op !== 'actor.ext' || last.get(`${String(t.id)}/${String(t.key)}`) === i
  })
}

/** 問掛點 creation.step：每個功能回答它認得的，合起來。沒有人認得的選項是一條擋住的原因。草稿可以只填一部分（算現金時只有 cyberSpent、gearSpent）。 */
export function askStep(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft, step: BodyStep): StepResult {
  const picks = picksOf(draft, step)
  const out: StepResult = { step, picks, answered: false, blocks: [], points: undefined, changes: [], ext: {}, sink: 0, capacity: undefined, owned: [], notes: [] }
  const took = new Set<number>()
  const answers = k.hooks.run('creation.step', { state, draft, step, picks, limits: creationLimits(k, state) })
  for (const { result } of answers) {
    const a = result as StepAnswer
    if (!isRecord(a) || !Array.isArray(a.took)) continue
    out.answered = true
    for (const i of a.took) if (isInt(i) && i >= 0 && i < picks.length) took.add(i)
    if (Array.isArray(a.blocks)) out.blocks.push(...a.blocks.filter((b): b is string => typeof b === 'string' && b.length > 0))
    if (typeof a.points === 'number' && Number.isFinite(a.points)) out.points = (out.points ?? 0) + a.points
    if (Array.isArray(a.changes)) out.changes.push(...a.changes)
    if (isRecord(a.ext)) Object.assign(out.ext, a.ext)
    if (typeof a.sink === 'number' && Number.isFinite(a.sink)) out.sink += a.sink
    if (isRecord(a.capacity)) out.capacity = { ...(out.capacity ?? {}), ...a.capacity }
    if (Array.isArray(a.owned)) out.owned.push(...a.owned)
    if (Array.isArray(a.notes)) out.notes.push(...a.notes.filter((n): n is string => typeof n === 'string' && n.length > 0))
  }
  picks.forEach((p, i) => {
    if (!took.has(i)) out.blocks.push(`沒有功能認得這一件：${pickName(p)}。`)
  })
  out.changes = dedupeExt(out.changes)
  return out
}

// ---- 每一步擋不擋 ----

function overBlock(what: string, spent: number, total: number): string | null {
  return spent > total ? `${what}點數超過了 ${spent - total} 點（選了 ${spent} 點，只有 ${total} 點）。` : null
}

/** 舊的給法：花掉的點數寫在草稿上。 */
function spentBlock(spent: number | undefined, total: number, what: string): string | null {
  if (spent === undefined) return null
  if (!isInt(spent) || spent < 0) return `花掉的${what}點數要是 0 以上的整數。`
  return spent > total ? `${what}點數只有 ${total} 點。` : null
}

/** 第 6 步（橋與義體）：各功能回答的原因，然後是點數超過；沒有功能回答點數時照舊看 cyberSpent。null 是沒問題。 */
export function cyberStepBlock(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): CreationBlock | null {
  const r = askStep(k, state, draft, 'cyber')
  const reason = r.blocks[0] ?? (r.points !== undefined ? overBlock('義體', r.points, state.rules.startCyberPoints) : spentBlock(draft.cyberSpent, state.rules.startCyberPoints, '義體'))
  return reason ? { step: 'cyber', reason } : null
}

/** 第 8 步（技能）：各功能回答的原因（歷練點、階、前置由技能自己比）。 */
export function abilitiesStepBlock(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): CreationBlock | null {
  const reason = askStep(k, state, draft, 'abilities').blocks[0]
  return reason ? { step: 'abilities', reason } : null
}

/** 第 9 步（裝備）：各功能回答的原因，然後是點數超過；沒有功能回答點數時照舊看 gearSpent。 */
export function gearStepBlock(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): CreationBlock | null {
  const r = askStep(k, state, draft, 'gear')
  const total = creationLimits(k, state).gearPoints
  const reason = r.blocks[0] ?? (r.points !== undefined ? overBlock('裝備', r.points, total) : spentBlock(draft.gearSpent, total, '裝備'))
  return reason ? { step: 'gear', reason } : null
}

// ---- 錢 ----

/** 花了幾點：選的東西算出來的優先，沒有就用草稿上寫的（舊的給法）；兩邊都沒有是 undefined（不換錢）。 */
export function pointsSpent(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): { cyber: number | undefined; gear: number | undefined } {
  return {
    cyber: askStep(k, state, draft, 'cyber').points ?? draft.cyberSpent,
    gear: askStep(k, state, draft, 'gear').points ?? draft.gearSpent,
  }
}

/** 沒花完的點數換多少現金：沒有花了幾點的那一項不換。 */
export function leftoverCash(limits: CreationLimits, state: GameState, spent: { cyber: number | undefined; gear: number | undefined }): { base: number; cyber: number; gear: number; total: number } {
  const left = (n: number | undefined, total: number) => (n !== undefined && isInt(n) ? Math.max(0, total - Math.max(0, n)) : 0)
  const base = state.rules.startMoney
  const cyber = left(spent.cyber, state.rules.startCyberPoints) * limits.cyberPointCash
  const gear = left(spent.gear, limits.gearPoints) * limits.gearPointCash
  return { base, cyber, gear, total: base + cyber + gear }
}

// ---- 總覽 ----

export interface PointSummary {
  /** 花了幾點 */
  spent: number
  /** 剩幾點（超過是負的） */
  left: number
  total: number
  /** 沒花完的換多少現金（還沒有選的東西、也沒寫花了幾點時是 0） */
  cash: number
}

export interface CreationSummary {
  cyber: PointSummary
  gear: PointSummary
  /** 歷練點（第 8 步）：沒有點數換現金 */
  xp: { spent: number; left: number; total: number }
  money: { base: number; cyber: number; gear: number; total: number }
  /** 沉溺的起點（選的義體的沉溺成本合計；下限也是這個數字） */
  sink: number
  /** 橋的四類容量（沒有橋或還沒選是 0） */
  capacity: { meat: number; net: number; social: number; media: number }
  /** 主角建好時身上已經有的（出身白給的、這一份草稿已選的義體與裝備） */
  owned: OwnedItem[]
  /** 每一步的提醒 */
  notes: Record<BodyStep, string[]>
  /** 每一步擋住的原因（全部，不只第一條） */
  blocks: Record<BodyStep, string[]>
}

/** 第 6、8、9 步給畫面的總覽：三種點數各花了多少、剩多少、換多少現金、沉溺的起點、四類容量、身上已經有的、每一步的提醒。 */
export function creationSummary(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): CreationSummary {
  const limits = creationLimits(k, state)
  const c = askStep(k, state, draft, 'cyber')
  const a = askStep(k, state, draft, 'abilities')
  const g = askStep(k, state, draft, 'gear')
  const spent = { cyber: c.points ?? draft.cyberSpent, gear: g.points ?? draft.gearSpent }
  const money = leftoverCash(limits, state, spent)
  const cyberTotal = state.rules.startCyberPoints
  const xpSpent = a.points ?? 0
  const xpTotal = state.rules.startXp
  const cap = c.capacity ?? {}
  return {
    cyber: { spent: spent.cyber ?? 0, left: cyberTotal - (spent.cyber ?? 0), total: cyberTotal, cash: money.cyber },
    gear: { spent: spent.gear ?? 0, left: limits.gearPoints - (spent.gear ?? 0), total: limits.gearPoints, cash: money.gear },
    xp: { spent: xpSpent, left: xpTotal - xpSpent, total: xpTotal },
    money,
    sink: c.sink + g.sink,
    capacity: { meat: cap.meat ?? 0, net: cap.net ?? 0, social: cap.social ?? 0, media: cap.media ?? 0 },
    owned: [...c.owned, ...g.owned],
    notes: { cyber: c.notes, abilities: a.notes, gear: g.notes },
    blocks: { cyber: c.blocks, abilities: a.blocks, gear: g.blocks },
  }
}
