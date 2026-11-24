// 戰鬥直覺（SKILL_TREES 槍手：戰鬥直覺；M1b-skill-gunner-broker）：開打時把「這棵樹的階數」點分到先攻、命中、迴避，
// 每 1 點是先攻 +3、命中 +1 或迴避 +1，每一項最多 3 點；戰鬥中每回合可以花 1 行動點重分配一次。
// 點數與上限可以被修正改：instinct_points（共鳴 5：+1；心流：+2）、instinct_cap（心流：+2）、instinct_free（心流：重分配不花行動點）。
// 分配記在 unit.ext.instinct（不放進 unit.ext.abilities：那一份只放裝著什麼與階數）；開打時的來源：單位自己帶的（測試、敵人）→
// 隨機（使用者 2026-11-23 定案：開打前要選的東西一律隨機，不做開打前選擇的介面）：把點數一點一點隨機放進還沒到上限的那幾項，
// 亂數是 deriveRng(state.rng, 'battle/<戰鬥>/<技能>/<單位>')，同一個種子同一個結果。戰鬥中仍可花 1 行動點重分配（玩家自己選）。只有現實戰鬥（內海的版本這一張不做）。

import type { BattleActionDef, BattleInput, BattlePick, BattleRun, BattleUnit, BattleView, Kernel } from '../../core'
import { BattleBlocked, deriveRng } from '../../core'
import { featureTotal } from './mods'
import type { AbilityEntry } from './types'
import { OWNER } from './types'
import { equippedOf, hasAbility, isRec, tierIn } from './unitdata'

export interface Alloc {
  initiative: number
  hit: number
  evade: number
}

/** 每 1 點換多少。 */
export const INSTINCT_STEP: Alloc = { initiative: 3, hit: 1, evade: 1 }
export const INSTINCT_KEYS = ['initiative', 'hit', 'evade'] as const
const KEY_LABEL: Record<(typeof INSTINCT_KEYS)[number], string> = { initiative: '先攻', hit: '命中', evade: '迴避' }
const BASE_CAP = 3

/** 這個人裝著的戰鬥直覺（有 meat.instinct 的那個技能）。 */
export const instinctOf = (view: Pick<BattleView, 'k'>, u: BattleUnit): AbilityEntry | undefined => equippedOf(view, u).find((a) => a.meat?.instinct === true && !a.meat.pending)

export const instinctPoints = (view: BattleView, u: BattleUnit, ab: AbilityEntry): number => Math.max(0, tierIn(u, ab.path) + featureTotal(view, u, 'instinct_points'))
export const instinctCap = (view: BattleView, u: BattleUnit): number => Math.max(0, BASE_CAP + featureTotal(view, u, 'instinct_cap'))

const sum = (a: Alloc): number => a.initiative + a.hit + a.evade

/** 預設的分法：平均分，多出來的給命中（命中放不下的再給先攻、迴避）。 */
export function defaultAlloc(points: number, cap: number): Alloc {
  const each = Math.min(cap, Math.floor(points / 3))
  const out: Alloc = { initiative: each, hit: each, evade: each }
  let left = points - each * 3
  for (const key of ['hit', 'initiative', 'evade'] as const) {
    const add = Math.min(left, cap - out[key])
    out[key] += add
    left -= add
  }
  return out
}

/** 開戰時的隨機分配：一點一點隨機放進還沒到上限的項；三項都滿了，剩下的點數就沒有地方放。 */
export function randomAlloc(rng: Pick<ReturnType<typeof deriveRng>, 'pick'>, points: number, cap: number): Alloc {
  const out: Alloc = { initiative: 0, hit: 0, evade: 0 }
  for (let i = 0; i < points; i++) {
    const open = INSTINCT_KEYS.filter((key) => out[key] < cap)
    if (!open.length) break
    out[rng.pick(open)] += 1
  }
  return out
}

/** 把一份分配夾進現在的上限與點數（每項不超過上限；總數超過就從迴避、命中、先攻依序減）。 */
export function fitAlloc(a: Alloc, points: number, cap: number): Alloc {
  const out: Alloc = { initiative: Math.min(cap, Math.max(0, a.initiative)), hit: Math.min(cap, Math.max(0, a.hit)), evade: Math.min(cap, Math.max(0, a.evade)) }
  for (const key of ['evade', 'hit', 'initiative'] as const) {
    const over = sum(out) - points
    if (over <= 0) break
    out[key] -= Math.min(over, out[key])
  }
  return out
}

const isAlloc = (v: unknown): v is Alloc => isRec(v) && INSTINCT_KEYS.every((key) => typeof v[key] === 'number' && Number.isInteger(v[key]) && (v[key] as number) >= 0)

/** 這個人現在的分配（已經夾進現在的上限與點數）；沒有裝戰鬥直覺、不是現實戰鬥是 null。 */
export function allocOf(view: BattleView, u: BattleUnit): { ab: AbilityEntry; alloc: Alloc; points: number; cap: number } | null {
  if (view.mode.layer !== 'meat') return null
  const ab = instinctOf(view, u)
  if (!ab) return null
  const points = instinctPoints(view, u, ab)
  const cap = instinctCap(view, u)
  const stored = u.ext.instinct
  return { ab, points, cap, alloc: fitAlloc(isAlloc(stored) ? stored : defaultAlloc(points, cap), points, cap) }
}

/** 單位剛組好：定下開打時的分配（記在單位上）。 */
export function setupInstinct(run: BattleRun, u: BattleUnit): void {
  if (run.mode.layer !== 'meat') return
  const ab = instinctOf(run, u)
  if (!ab) return
  if (isAlloc(u.ext.instinct)) return
  u.ext.instinct = randomAlloc(deriveRng(run.state.rng, `battle/${run.battle.id}/${ab.id}/${u.id}`), instinctPoints(run, u, ab), instinctCap(run, u))
}

// ---- 重分配 ----

const reallocKey = (id: string): string => `turn:${id}.realloc`

function picksOf(view: BattleView, u: BattleUnit): BattlePick[] {
  const a = allocOf(view, u)
  if (!a) return []
  return INSTINCT_KEYS.map((key) => ({
    key, label: KEY_LABEL[key], kind: 'choice' as const, required: true,
    options: Array.from({ length: a.cap + 1 }, (_, v) => ({
      value: v, label: `${v} 點`, blocks: v > a.points ? [`戰鬥直覺現在只有 ${a.points} 點可以分，不能把 ${v} 點全放在${KEY_LABEL[key]}。`] : [],
    })),
  }))
}

export function instinctAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.realloc`
  return {
    id, owner: OWNER, name: '重分配', desc: '重新分配戰鬥直覺的點數：先攻、命中、迴避各放幾點。每回合一次。', group: 'skill', icon: 'skill', modes: ['meat'], target: 'none', order,
    has: (_v, u) => hasAbility(u, ab.id) && !!instinctOf(_v, u),
    cost: (v, u) => ({ ap: featureTotal(v, u, 'instinct_free') > 0 ? 0 : 1 }),
    blocks: (_v, u) => ((u.uses[reallocKey(id)] ?? 0) >= 1 ? ['這一回合已經重分配過了。'] : []),
    picks: (v, u) => picksOf(v, u),
    run(run: BattleRun, u: BattleUnit, _target, input: BattleInput) {
      const a = allocOf(run, u)
      if (!a) throw new BattleBlocked(['現在沒有可以分配的戰鬥直覺。'])
      const next: Alloc = { initiative: 0, hit: 0, evade: 0 }
      for (const key of INSTINCT_KEYS) {
        const v = input.pick?.[key]
        if (v === undefined) throw new BattleBlocked([`要選${KEY_LABEL[key]}要放幾點。`])
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > a.cap) throw new BattleBlocked([`${KEY_LABEL[key]}要是 0～${a.cap} 點的整數（每一項最多 ${a.cap} 點）。`])
        next[key] = v
      }
      if (sum(next) > a.points) throw new BattleBlocked([`戰鬥直覺現在只有 ${a.points} 點可以分，你分了 ${sum(next)} 點。`])
      u.uses[reallocKey(id)] = (u.uses[reallocKey(id)] ?? 0) + 1
      u.ext.instinct = next
      run.say(`${u.name}：重分配戰鬥直覺，先攻 ${next.initiative} 點、命中 ${next.hit} 點、迴避 ${next.evade} 點。`, 'skill', { unit: u.id, ability: ab.id, alloc: next }, u)
    },
  }
}

/** 先攻、命中、迴避的修正：每點先攻 +3、命中 +1、迴避 +1（明細的名字是技能的名字）。 */
export function registerInstinct(k: Kernel): void {
  k.battle.modifier(OWNER, (q) => {
    if (q.kind !== 'initiative' && q.kind !== 'hit' && q.kind !== 'evade') return []
    if (q.view.battle.units[q.unit.id] !== q.unit) return []
    const a = allocOf(q.view, q.unit)
    if (!a) return []
    const value = a.alloc[q.kind] * INSTINCT_STEP[q.kind]
    return value ? [{ label: a.ab.name, value, source: 'skill' }] : []
  })
}
