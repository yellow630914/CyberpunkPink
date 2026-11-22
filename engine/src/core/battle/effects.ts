// L5 戰鬥：效果（dev/adr/0015 第一節）。道具、技能、招牌行動、武器的附帶效果、快駭都只寫 [{ op, ... }]，
// 核心只有三件事：登錄（registry.ts 的 effect）、解析「這一筆落在誰身上、要不要做」（run.effects）、數量的公式（amount）。
// 每個 op 做什麼由管那個領域的功能註冊；核心裡不註冊任何效果。
//
// 名字：ADR 寫的 EffectCtx、EffectSource 和 core/rules/effects.ts（報告的效果）已經有的型別同名，兩邊都從 core 匯出會衝突，
// 所以戰鬥的這一組都冠上 Battle：BattleEffectCtx、BattleEffectSource、BattleEffectOp、BattleEffectDef……

import type { BattleOverlay, BattleUnit } from '../types'
import { ATTR_IDS, BATTLE_SLOTS } from '../types'
import { attrMod } from '../rules/check'
import { isRecord } from '../util/sanitize'
import { otherSide, unitAt, unitsOf } from './field'
import type { BattleEffectCtx, BattleEffectInput, BattleEffectLast } from './registry'
import type { BattleRun } from './run'

// ---- who 與 if：封閉清單。不夠用時加在這裡，不在功能裡各自解析 ----

/** 這一筆落在誰身上。另外還有 pick:<鍵>（pick 裡那個單位）。 */
export const EFFECT_WHO = ['target', 'self', 'allies', 'others', 'adjacent', 'near', 'foes', 'foes_bridged', 'slot', 'area', 'attacker', 'victim'] as const
export type EffectWho = (typeof EFFECT_WHO)[number]
/** 這一筆要不要做（看 ctx.last 與回合數）。 */
export const EFFECT_IF = ['hit', 'miss', 'crit', 'downed', 'overloaded', 'ok', 'fail', 'first_round', 'not_first_round'] as const
export type EffectIf = (typeof EFFECT_IF)[number]

/** who 寫得對不對：對就回傳 null，不對回傳一句話（給資料作者看）。沒寫是 target。 */
export function whoProblem(who: unknown): string | null {
  if (who === undefined) return null
  if (typeof who !== 'string') return `who 要是字串（可以寫：${EFFECT_WHO.join('、')}、pick:<鍵>）`
  if ((EFFECT_WHO as readonly string[]).includes(who)) return null
  if (who.startsWith('pick:') && who.length > 5) return null
  return `who「${who}」不在清單裡（可以寫：${EFFECT_WHO.join('、')}、pick:<鍵>）`
}

export function ifProblem(cond: unknown): string | null {
  if (cond === undefined) return null
  if (typeof cond === 'string' && (EFFECT_IF as readonly string[]).includes(cond)) return null
  return `if「${String(cond)}」不在清單裡（可以寫：${EFFECT_IF.join('、')}）`
}

// ---- 數量的公式 ----

const NAMES = ['tier', 'half_tier_up', 'half_tier_down', 'grade', 'spent'] as const
type Name = (typeof NAMES)[number]
const isName = (s: string): s is Name => (NAMES as readonly string[]).includes(s)

type Base =
  | { t: 'int'; n: number }
  | { t: 'dice'; count: number | Name; sides: number }
  | { t: 'name'; name: Name }
  | { t: 'skill'; id: string }
  | { t: 'mod'; attr: string }
interface Term {
  base: Base
  mult: number
}

const GRAMMAR = '整數、NdM（骰數也可以是 tier、grade、spent 這些名字）、tier、half_tier_up、half_tier_down、grade、spent、skill:<基本功>、mod:<屬性>，每一項後面可以再接 *整數，項與項用 + 接起來'
const bad = (expr: string, why: string): Error => new Error(`公式「${expr}」${why}（文法：${GRAMMAR}）`)

function parseBase(expr: string, raw: string): Base {
  if (raw.startsWith('skill:')) {
    const id = raw.slice(6)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) throw bad(expr, `：「${raw}」的基本功 id 不對`)
    return { t: 'skill', id }
  }
  if (raw.startsWith('mod:')) {
    const attr = raw.slice(4)
    if (!(ATTR_IDS as readonly string[]).includes(attr)) throw bad(expr, `：「${raw}」不認得屬性 ${attr}（${ATTR_IDS.join('、')}）`)
    return { t: 'mod', attr }
  }
  const dice = /^(\d+|tier|grade|spent|half_tier_up|half_tier_down)d(\d+)$/.exec(raw)
  if (dice) {
    const count = /^\d+$/.test(dice[1]!) ? Number(dice[1]) : (dice[1] as Name)
    const sides = Number(dice[2])
    if (typeof count === 'number' && (count < 1 || count > 100)) throw bad(expr, `：「${raw}」骰數要在 1～100`)
    if (sides < 2 || sides > 1000) throw bad(expr, `：「${raw}」骰面要在 2～1000`)
    return { t: 'dice', count, sides }
  }
  if (isName(raw)) return { t: 'name', name: raw }
  if (/^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))) return { t: 'int', n: Number(raw) }
  throw bad(expr, `：不認得的項 ${raw === '' ? '（空的）' : raw}`)
}

function parse(expr: string): Term[] {
  if (!expr.trim()) throw bad(expr, '：是空的')
  return expr.split('+').map((piece) => {
    const part = piece.trim()
    const star = part.split('*')
    if (star.length > 2) throw bad(expr, `：「${part}」只能乘一個整數`)
    let mult = 1
    if (star.length === 2) {
      const m = star[1]!.trim()
      if (!/^-?\d+$/.test(m) || !Number.isSafeInteger(Number(m))) throw bad(expr, `：「${part}」的 * 後面要是整數，不是 ${m === '' ? '空的' : m}`)
      mult = Number(m)
    }
    return { base: parseBase(expr, star[0]!.trim()), mult }
  })
}

/** 載入內容時檢查一個數量（數字或公式字串）：回傳每一個問題，空的就是合格。 */
export function amountProblems(expr: unknown): string[] {
  if (typeof expr === 'number') return Number.isFinite(expr) ? [] : ['數量要是有限的數字']
  if (typeof expr !== 'string') return ['數量要是數字，或是公式（字串）']
  try {
    parse(expr)
    return []
  } catch (e) {
    return [(e as Error).message]
  }
}

/**
 * 算一個數量。數字照原樣回傳；字串照公式：骰子用 run.roll（和戰鬥裡別的骰子同一串），
 * tier、grade、spent 看 ctx.n（grade 沒給用這場戰鬥的等級，tier 與 spent 沒給是 0），
 * skill、mod 看做的人（ctx.user）。公式不合格丟錯（載入時用 amountProblems 先擋）。
 */
export function amount(ctx: Pick<BattleEffectCtx, 'run' | 'user' | 'n'>, expr: number | string): number {
  if (typeof expr === 'number') return expr
  const terms = parse(expr)
  const named = (name: Name): number => {
    const tier = ctx.n.tier ?? 0
    switch (name) {
      case 'tier': return tier
      case 'half_tier_up': return Math.ceil(tier / 2)
      case 'half_tier_down': return Math.floor(tier / 2)
      case 'grade': return ctx.n.grade ?? ctx.run.battle.grade
      case 'spent': return ctx.n.spent ?? 0
    }
  }
  let total = 0
  for (const { base, mult } of terms) {
    let v: number
    if (base.t === 'int') v = base.n
    else if (base.t === 'name') v = named(base.name)
    else if (base.t === 'skill') v = ctx.user.skills[base.id] ?? 0
    else if (base.t === 'mod') v = attrMod(ctx.user.attrs[base.attr as keyof BattleUnit['attrs']] ?? 10)
    else {
      const count = typeof base.count === 'number' ? base.count : Math.max(0, named(base.count))
      v = count > 0 ? ctx.run.roll(count, base.sides).reduce((a, b) => a + b, 0) : 0
    }
    total += v * mult
  }
  return total
}

// ---- 照順序做一串效果 ----

interface Landing {
  unit?: BattleUnit
  overlay?: BattleOverlay
}

function resolveWho(run: BattleRun, who: string, base: Omit<BattleEffectCtx, 'unit' | 'overlay'>): Landing[] {
  const b = run.battle
  const { user, target } = base
  const mine = (): BattleUnit[] => unitsOf(b, user.side)
  /** 目標落在哪一方的哪一格（人、一格、掛著的東西都有一格；節點沒有） */
  const cell = (): { side: 'ally' | 'foe'; slot: number } | null => {
    if (!target) return null
    if ('unit' in target) {
      const u = b.units[target.unit]
      return u ? { side: u.side, slot: u.slot } : null
    }
    if ('overlay' in target) {
      const o = b.overlays.find((x) => x.id === target.overlay)
      return o ? { side: o.side, slot: o.slot } : null
    }
    if ('slot' in target) return { side: target.side, slot: target.slot }
    return null
  }
  const people = (list: BattleUnit[]): Landing[] => list.map((unit) => ({ unit }))
  const adjacent = (): BattleUnit[] => (user.slot >= 1 ? mine().filter((u) => u.id !== user.id && Math.abs(u.slot - user.slot) === 1) : [])
  switch (who) {
    case 'target':
      if (!target) return [{}]
      if ('unit' in target) return [{ unit: run.unit(target.unit) }]
      if ('overlay' in target) {
        const overlay = b.overlays.find((x) => x.id === target.overlay)
        return [overlay ? { overlay } : {}]
      }
      return [{}]
    case 'self': return [{ unit: user }]
    case 'allies': return people(mine())
    case 'others': return people(mine().filter((u) => u.id !== user.id))
    case 'adjacent': return people(adjacent())
    case 'near': return [{ unit: user }, ...people(adjacent())]
    case 'foes': return people(unitsOf(b, otherSide(user.side)))
    case 'foes_bridged': return people(unitsOf(b, otherSide(user.side)).filter((u) => !!u.load))
    case 'slot': {
      const c = cell()
      const u = c ? unitAt(b, c.side, c.slot) : undefined
      return u ? [{ unit: u }] : []
    }
    case 'area': {
      const c = cell()
      if (!c) return []
      const slots = [c.slot]
      const also = base.pick.also
      if (typeof also === 'number' && Number.isInteger(also) && also >= 1 && also <= BATTLE_SLOTS && also !== c.slot) slots.push(also)
      const out: Landing[] = []
      for (const s of slots) {
        const u = unitAt(b, c.side, s)
        if (u) out.push({ unit: u })
      }
      for (const s of slots) for (const overlay of b.overlays) if (overlay.side === c.side && overlay.slot === s && !overlay.down) out.push({ overlay })
      return out
    }
    case 'attacker':
    case 'victim': {
      const u = who === 'attacker' ? base.attacker : base.victim
      if (!u) throw new Error(`who 寫 ${who}，但這一步沒有帶${who === 'attacker' ? '攻擊的人' : '被打的人'}（只有反應裡才有）`)
      return [{ unit: u }]
    }
    default: {
      // pick:<鍵>：pick 裡放的是單位 id（或 { unit }）；沒選就跳過這一筆
      const v = base.pick[who.slice(5)]
      const id = typeof v === 'string' ? v : isRecord(v) && typeof v.unit === 'string' ? v.unit : undefined
      if (!id) return []
      if (b.units[id]) return [{ unit: b.units[id]! }]
      const overlay = b.overlays.find((x) => x.id === id)
      return overlay ? [{ overlay }] : []
    }
  }
}

function holds(cond: string | undefined, last: BattleEffectLast, round: number): boolean {
  switch (cond) {
    case undefined: return true
    case 'hit': return last.hit === true
    case 'miss': return last.hit === false
    case 'crit': return last.crit === true
    case 'downed': return last.downed === true
    case 'overloaded': return last.overloaded === true
    case 'ok': return last.ok === true
    case 'fail': return last.ok === false
    case 'first_round': return round === 1
    case 'not_first_round': return round !== 1
    default: return false
  }
}

/**
 * 照順序做一串效果（run.effects 就是它）。每一筆：查 op（沒有丟錯）→ 解析 who 與 if（不在清單裡丟錯）→ if 不成立就跳過 →
 * 落在好幾個人身上就各呼叫一次（area 先人後掛著的東西）。ctx.last 是同一個物件，在整串效果之間傳下去：攻擊與檢定的 op 把結果寫進去，
 * 下一筆的 if 看它；某一筆把 last.stop 設成 true，這一筆做完之後的效果都不做。回傳最後的 last。
 */
export function runEffects(run: BattleRun, list: readonly Record<string, unknown>[], input: BattleEffectInput): BattleEffectLast {
  const last = input.last ?? {}
  const base: Omit<BattleEffectCtx, 'unit' | 'overlay'> = {
    run, user: input.user, target: input.target ?? null, source: input.source, pick: input.pick ?? {}, n: input.n ?? {}, last,
    ...(input.source.kind === 'item' ? { item: input.source.id } : {}),
    ...(input.attacker ? { attacker: input.attacker } : {}), ...(input.victim ? { victim: input.victim } : {}),
  }
  for (const e of list) {
    const op = typeof e?.op === 'string' ? e.op : ''
    const def = op ? run.k.battle.getEffect(op) : undefined
    if (!def) throw new Error(`不認得的效果 ${op || String(e?.op)}（還沒有功能註冊它）`)
    const w = whoProblem(e.who)
    if (w) throw new Error(`效果 ${op}：${w}`)
    const c = ifProblem(e.if)
    if (c) throw new Error(`效果 ${op}：${c}`)
    if (!holds(e.if as string | undefined, last, run.battle.round)) continue
    for (const landing of resolveWho(run, typeof e.who === 'string' ? e.who : 'target', base)) {
      // 掛著的東西可能被前面幾次擊落：已經擊落的不再做
      if (landing.overlay?.down) continue
      def.fn({ ...base, ...landing }, e)
      if (last.stop) return last
    }
  }
  return last
}
