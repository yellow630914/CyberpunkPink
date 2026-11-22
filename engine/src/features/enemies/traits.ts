// 特徵（ENEMIES 第 5 節；dev/work/M1b-enemy-moves.md 第三節）：內容種類 enemy_trait 是規則表。
//   { id, name, desc, mods?, ai?, start?, tags?, roll? }
// 敵人一定帶著的（資料的 traits）加上開戰時擲的（有 roll 的特徵；dev/adr/0015 E10：每個符合 kinds 的敵人擲兩次、各 30%，首領各 50%，
// 擲中就照 weight 抽一個、不重複；遭遇寫 traits: false 就不擲）。
// mods 在單位組好時（unit.ready）算進單位；start 在開打時做一次（battle.start）；tags 加到單位上；ai.morale_dc 加在士氣的 DC 上。
// 查不到的特徵 id 當成純標籤（單位建好時已經放進 tags）。單位上的紀錄：unit.ext.enemies.traits（帶著的每一個特徵的 id）。

import type { BattleRun, BattleUnit, Kernel } from '../../core'
import { AI_PREFERS, ENEMY_KINDS, OWNER } from './kinds'
import type { EnemyEntry } from './kinds'
import { enemyData, isRec, peekEnemy } from './unitdata'

export interface TraitEntry {
  id: string
  name: string
  desc: string
  /** hp_pct 是生命的百分比加減（−40 是只剩六成）；其餘是加減；load_cap 是感載上限、layers_max 是承受層數、initiative 是先攻 */
  mods?: { hp_pct?: number; hit?: number; ap?: number; load_cap?: number; layers_max?: number; evade?: number; initiative?: number }
  /** 覆寫單位的 AI：flee_below（生命比例）、prefer、never_flee；morale_dc 加在士氣的 DC 上 */
  ai?: { flee_below?: number; prefer?: string; never_flee?: boolean; morale_dc?: number }
  /** 開打時做一次的效果（帶著餘韻：afterglow +1） */
  start?: Array<Record<string, unknown>>
  /** 加到單位上的標籤（契約人：contract） */
  tags?: string[]
  /** 開戰時擲得到：weight 是抽的權重，kinds 是哪些種類的敵人擲（['human']） */
  roll?: { weight: number; kinds: string[] }
  [field: string]: unknown
}

const MOD_KEYS = ['hp_pct', 'hit', 'ap', 'load_cap', 'layers_max', 'evade', 'initiative'] as const
const AI_KEYS = ['flee_below', 'prefer', 'never_flee', 'morale_dc'] as const

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function traitProblems(k: Pick<Kernel, 'battle'>, e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.desc)) p.push('要有 desc（效果的完整句子）')
  if (e.mods !== undefined) {
    if (!isRec(e.mods)) p.push('mods 要是物件')
    else {
      for (const [key, v] of Object.entries(e.mods)) {
        if (!(MOD_KEYS as readonly string[]).includes(key)) p.push(`mods.${key} 不是可以修正的鍵（只有 ${MOD_KEYS.join('、')}）`)
        else if (key === 'hp_pct') { if (!(isInt(v) && v > -100 && v <= 300)) p.push('mods.hp_pct 要是整數，大於 −100（生命的百分比加減，−40 是只剩六成）') }
        else if (!isInt(v)) p.push(`mods.${key} 要是整數（加減）`)
      }
    }
  }
  if (e.ai !== undefined) {
    if (!isRec(e.ai)) p.push('ai 要是物件')
    else {
      for (const [key, v] of Object.entries(e.ai)) {
        if (!(AI_KEYS as readonly string[]).includes(key)) p.push(`ai.${key} 不是可以用的鍵（只有 ${AI_KEYS.join('、')}）`)
        else if (key === 'flee_below') { if (!(isNum(v) && v >= 0 && v <= 1)) p.push('ai.flee_below 要是 0～1 的數字') }
        else if (key === 'prefer') { if (!(AI_PREFERS as readonly unknown[]).includes(v)) p.push(`ai.prefer 只能是 ${AI_PREFERS.join('、')}`) }
        else if (key === 'never_flee') { if (typeof v !== 'boolean') p.push('ai.never_flee 要是 true 或 false') }
        else if (!isInt(v)) p.push('ai.morale_dc 要是整數（加在士氣的 DC 上）')
      }
    }
  }
  if (e.start !== undefined) {
    if (!Array.isArray(e.start) || e.start.length === 0) p.push('start 要是效果的陣列（每一筆 { op, ... }）')
    else p.push(...k.battle.effectProblems(e.start).map((m) => `start：${m}`))
  }
  if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.length > 0 && e.tags.every(isText))) p.push('tags 要是標籤的陣列')
  if (e.roll !== undefined) {
    const r = e.roll
    if (!isRec(r)) p.push('roll 要是 { weight, kinds }')
    else {
      for (const key of Object.keys(r)) if (key !== 'weight' && key !== 'kinds') p.push(`roll.${key} 不是可以用的鍵（只有 weight、kinds）`)
      if (!(isNum(r.weight) && r.weight > 0)) p.push('roll.weight 要是大於 0 的數字（抽的權重）')
      if (!(Array.isArray(r.kinds) && r.kinds.length > 0 && r.kinds.every((x) => (ENEMY_KINDS as readonly unknown[]).includes(x)))) p.push(`roll.kinds 要是敵人種類的陣列，只能用 ${ENEMY_KINDS.join('、')}`)
    }
  }
  return p
}

export function registerTraitKind(k: Pick<Kernel, 'content' | 'battle'>): void {
  k.content.defineKind<TraitEntry>({ kind: 'enemy_trait', owner: OWNER, validate: (e) => traitProblems(k, e) })
}

const traitOf = (run: Pick<BattleRun, 'k'>, id: string): TraitEntry | undefined => run.k.content.get<TraitEntry>('enemy_trait', id)

/** 這場開戰要不要擲特徵：遭遇寫 traits: false 就不擲。 */
const rollsOn = (run: BattleRun): boolean => run.battle.origin.ext?.traits !== false

/**
 * 開戰時擲的特徵：符合這個敵人種類的特徵（有 roll、還沒帶著）擲兩次，每次 30%（首領 50%），擲中就照 weight 抽一個、不重複。
 * 沒有任何特徵可以擲的時候不動亂數（沒有特徵內容的遊戲，骰面的順序和以前一樣）。
 */
function rollTraits(run: BattleRun, u: BattleUnit, e: EnemyEntry, carried: readonly string[]): string[] {
  if (!rollsOn(run)) return []
  const pool = run.k.content.list<TraitEntry>('enemy_trait').filter((t) => t.roll?.kinds.includes(e.kind) && !carried.includes(t.id))
  if (!pool.length) return []
  const chance = u.rank === 'boss' ? 0.5 : 0.3
  const got: TraitEntry[] = []
  for (let i = 0; i < 2; i++) {
    if (run.rand() >= chance) continue
    const t = run.pick(pool.filter((x) => !got.includes(x)), (x) => x.roll!.weight)
    if (t) got.push(t)
  }
  return got.map((t) => t.id)
}

/** 把一個特徵的 mods、ai、tags 算進單位。 */
function applyTrait(u: BattleUnit, t: TraitEntry): void {
  const m = t.mods ?? {}
  if (m.hp_pct !== undefined && u.hp) {
    const f = 1 + m.hp_pct / 100
    u.hp.max = Math.max(1, Math.round(u.hp.max * f))
    u.hp.now = Math.min(u.hp.max, Math.max(1, Math.round(u.hp.now * f)))
  }
  if (m.hit) for (const w of u.weapons) w.hit += m.hit
  if (m.ap) {
    u.ap.max = Math.max(1, u.ap.max + m.ap)
    u.ap.now = Math.min(u.ap.max, Math.max(0, u.ap.now + m.ap))
  }
  if (m.load_cap && u.load) u.load.max = Math.max(1, u.load.max + m.load_cap)
  if (m.layers_max) u.layersMax = Math.max(1, u.layersMax + m.layers_max)
  if (m.evade) u.evade += m.evade
  if (m.initiative) u.initBonus += m.initiative
  for (const tag of t.tags ?? []) if (!u.tags.includes(tag)) u.tags.push(tag)
  if (t.ai && u.ai) {
    if (t.ai.flee_below !== undefined) u.ai.fleeBelow = t.ai.flee_below
    if (t.ai.prefer !== undefined) u.ai.prefer = t.ai.prefer
    if (t.ai.never_flee !== undefined) u.ai.neverFlee = t.ai.never_flee
  }
  if (t.ai?.morale_dc) {
    const d = enemyData(u)
    d.moraleDc = (typeof d.moraleDc === 'number' ? d.moraleDc : 0) + t.ai.morale_dc
  }
}

/**
 * 單位剛組好（unit.ready）：一定帶著的加上開戰時擲的特徵，照順序算進單位。沒有 enemy_trait 內容、
 * 也沒有一定帶著的特徵時什麼都不動。每個單位只做一次。
 */
export function applyTraits(run: BattleRun, u: BattleUnit): void {
  if (!u.enemy || !run.k.content.has('enemy', u.enemy)) return
  // 沒有任何特徵的內容：特徵的 id 只是標籤（單位組好時已經放進 tags），什麼都不用算、也不動亂數
  if (!run.k.content.list('enemy_trait').length) return
  const was = peekEnemy(u)
  if (was.traitsDone) return
  const e = run.k.content.require<EnemyEntry>('enemy', u.enemy)
  const carried = Array.isArray(was.traits) ? was.traits.filter((x): x is string => typeof x === 'string') : []
  const rolled = rollTraits(run, u, e, carried)
  const all = [...carried, ...rolled]
  const d = enemyData(u)
  d.traitsDone = true
  d.traits = all
  if (rolled.length) d.rolled = rolled
  for (const id of all) {
    if (!u.tags.includes(id)) u.tags.push(id)
    const t = traitOf(run, id)
    if (t) applyTrait(u, t)
  }
}

/** 開打時：每個單位帶著的特徵的 start 做一次（帶著餘韻：afterglow +1）。 */
export function runTraitStart(run: BattleRun): void {
  for (const u of Object.values(run.battle.units)) {
    const ids = peekEnemy(u).traits
    for (const id of Array.isArray(ids) ? ids : []) {
      const t = typeof id === 'string' ? traitOf(run, id) : undefined
      if (!t?.start?.length) continue
      run.say(`${u.name}：${t.name}。`, 'trait', { unit: u.id, trait: t.id, start: true }, u)
      run.effects(t.start, { user: u, target: { unit: u.id }, source: { kind: 'field', id: t.id, name: t.name }, n: {} })
    }
  }
}

/** 士氣檢定的 DC 加成（特徵的 ai.morale_dc 加起來）。 */
export const moraleDcBonus = (u: BattleUnit): number => {
  const v = peekEnemy(u).moraleDc
  return typeof v === 'number' ? v : 0
}
