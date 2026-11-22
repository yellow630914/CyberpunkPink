// L6 功能 summons：無人機的效果（op）。dev/work/M1b-skill-pilot.md 第一節。
// 技能（features/abilities）、接管（features/hack）、招牌行動都只寫 [{ op: 'drone.…', ... }]，經由效果的登錄表叫無人機做事；
// 這個功能不 import 它們，它們也不 import 這裡。
//
//   drone.act      讓這幾台各做一次它的動作（不另外花指揮的行動點）
//   drone.deploy   放出一台（單位上的第幾台，或臨時的一台）
//   drone.move     移動選的那一台
//   drone.repair   回復耐久
//   drone.smoke    那一台掛的那一格變成打不破的半掩體
//   drone.ram      那一台撞上目標
//   drone.guard    那幾台替同一格的人擋下一次攻擊
//   drone.escort   （姿態用）開著時，和無人機同一格的隊友迴避加成；{ off: true } 收起
//
// 落點：這一台是誰——which: 'target'（預設）看 ctx.overlay、ctx.target 的那一台，目標是一格或一個人時就是那一格上操作者的一台。

import type { BattleEffectCtx, BattleOverlay, BattleUnit, Kernel } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, amount, amountProblems, isRecord, overlayAt } from '../../core'
import { KIND_NAME, OWNER, capBlock, dronesOf, driveOnce, guard, hang, heldBy, isDrone, isKind, isShooter, isStunned, moveTo, stateOf } from './drones'
import type { DroneDef, DroneKind } from './drones'

type Ctx = BattleEffectCtx
type Eff = Record<string, unknown>

// ---- 格式檢查（op、who、if 由核心查） ----

type Check = (v: unknown) => string | null
const F: Check = (v) => amountProblems(v)[0] ?? null
const B: Check = (v) => (typeof v === 'boolean' ? null : '要是 true 或 false')
const S: Check = (v) => (typeof v === 'string' && v.trim() ? null : '要是字串（不能是空的）')
const INT = (min: number): Check => (v) => (typeof v === 'number' && Number.isInteger(v) && v >= min ? null : `要是 ${min} 以上的整數`)
const oneOf = (list: readonly string[]): Check => (v) => (typeof v === 'string' && list.includes(v) ? null : `「${String(v)}」不在清單裡（可以寫：${list.join('、')}）`)
const GRADE: Check = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4 ? null : '要是 1～4 的整數（I～IV 級）')
const WHICH = ['target', 'same_slot', 'all', 'others'] as const
const GUARD_UNTIL = ['own_turn_start', 'battle_end'] as const
/** at：打誰。target（目標是敵人時就是他）、attacker（反應裡正在攻擊的人）、pick:<鍵>。 */
const AT: Check = (v) => (typeof v === 'string' && (v === 'target' || v === 'attacker' || (v.startsWith('pick:') && v.length > 5)) ? null : `「${String(v)}」不在清單裡（可以寫：target、attacker、pick:<鍵>）`)
const DROP: Check = (v) => (typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? null : '要是 pick 的鍵（英文字母、數字、底線）')

function schema(spec: Record<string, Check>, required: string[] = [], more?: (e: Eff) => string[]): (e: Eff) => string[] {
  return (e) => {
    const out: string[] = []
    for (const key of Object.keys(e)) {
      if (key === 'op' || key === 'who' || key === 'if') continue
      const check = spec[key]
      if (!check) {
        out.push(`不認得的欄位 ${key}（可以寫：${Object.keys(spec).join('、')}）`)
        continue
      }
      if (e[key] === undefined) continue
      const why = check(e[key])
      if (why) out.push(`${key}：${why}`)
    }
    for (const key of required) if (e[key] === undefined) out.push(`${key}：一定要寫`)
    if (more) out.push(...more(e))
    return out
  }
}

// ---- 落點 ----

/** 這一筆落在哪一台：ctx.overlay（範圍打到的）、玩家選的那一台；目標是一格或一個人，就是那一格上操作者的一台。 */
function targetOverlay(ctx: Ctx): BattleOverlay | undefined {
  const { run, user } = ctx
  if (ctx.overlay) return ctx.overlay
  const t = ctx.target
  if (!t) return undefined
  if ('overlay' in t) return run.battle.overlays.find((x) => x.id === t.overlay)
  let slot: number | undefined
  if ('unit' in t) {
    const u = run.battle.units[t.unit]
    slot = u && u.side === user.side && u.slot >= 1 ? u.slot : undefined
  } else if ('slot' in t && t.side === user.side) slot = t.slot
  return slot === undefined ? undefined : run.battle.overlays.find((x) => !x.down && x.owner === user.id && x.side === user.side && x.slot === slot)
}

/** 做的人自己的一台（沒被擊落）；不是就丟一句完整的話。 */
function mine(ctx: Ctx): BattleOverlay {
  const o = targetOverlay(ctx)
  if (!o || o.owner !== ctx.user.id || o.down) throw new BattleBlocked(['沒有這一台無人機。'])
  return o
}

/** 打誰：target（目標是敵人，或這一筆落在敵人身上）、attacker（反應裡正在攻擊的人）、pick:<鍵>（pick 裡的單位 id 或 { unit }）。只收還在場上的敵人。 */
function foeFor(ctx: Ctx, at: unknown): BattleUnit | undefined {
  const { run, user } = ctx
  const where = typeof at === 'string' ? at : 'target'
  let u: BattleUnit | undefined
  if (where === 'target') u = ctx.unit ?? (ctx.target && 'unit' in ctx.target ? run.battle.units[ctx.target.unit] : undefined)
  else if (where === 'attacker') u = ctx.attacker
  else {
    const v = ctx.pick[where.slice(5)]
    const id = typeof v === 'string' ? v : isRecord(v) && typeof v.unit === 'string' ? v.unit : undefined
    u = id ? run.battle.units[id] : undefined
  }
  return u && !run.isStandIn(u) && u.side !== user.side && u.slot >= 1 && !u.out ? u : undefined
}

const num = (ctx: Ctx, v: unknown, fallback = 0): number => {
  if (v === undefined) return fallback
  try {
    const n = Math.round(amount(ctx, v as number | string))
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/** which 對應的一組：same_slot（和做的人同一格的）、all、others（除了被打的那一台）；只有會開火的動，沒動過的才動（ignore_used 例外）。 */
function setOf(ctx: Ctx, which: string, e: Eff): BattleOverlay[] {
  const { run, user } = ctx
  const held = heldBy(run, user)
  let pool: BattleOverlay[]
  if (which === 'same_slot') pool = held.filter((o) => o.slot === user.slot)
  else if (which === 'others') {
    // 被打的那一台：這一筆的目標；反應裡是被打的替身對應的那一台（被擊落的也要排除）
    const hit = targetOverlay(ctx) ?? (ctx.victim ? run.battle.overlays.find((x) => x.id === ctx.victim!.ext.overlay) : undefined)
    pool = held.filter((o) => o.id !== hit?.id)
  } else pool = held
  pool = pool.filter((o) => isShooter(o) && !isStunned(o))
  if (e.ignore_used !== true) pool = pool.filter((o) => !o.used)
  const max = e.max === undefined ? pool.length : Math.max(0, num(ctx, e.max, pool.length))
  return pool.slice(0, max)
}

// ---- drone.act ----

function actOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const which = typeof e.which === 'string' ? e.which : 'target'
  const foe = foeFor(ctx, e.at)
  const hit = num(ctx, e.hit)
  const pierce = num(ctx, e.pierce)
  let list: BattleOverlay[]
  if (which === 'target') {
    const o = mine(ctx)
    if (o.used && e.ignore_used !== true) throw new BattleBlocked(['這一台這一回合動過了。'])
    list = [o]
  } else {
    list = setOf(ctx, which, e)
    if (!foe) return
  }
  for (const o of list) {
    if (run.over || user.out) break
    if (which !== 'target' && (!foe || foe.out)) break
    const r = driveOnce(run, user, o, { ...(foe ? { foe } : {}), hit, pierce })
    if (r && !r.aborted) {
      ctx.last.hit = r.hit
      ctx.last.crit = r.crit
      ctx.last.downed = r.downed
      ctx.last.dealt = r.dealt
    }
    if (e.mark_used !== false) o.used = true
  }
}

// ---- drone.deploy ----

/** pick 的值（第幾台，或種類）換成單位上的索引：種類就取第一台還在手上的。 */
function indexOf(user: BattleUnit, v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string') return dronesOf(user).findIndex((d, i) => d.kind === v && stateOf(user, i) === 0)
  return undefined
}

/** 沒指定哪一格時挑一格空的：有人站的優先，離做的人近的優先。 */
function freeSlot(ctx: Ctx): number | undefined {
  const { run, user } = ctx
  const people = new Set(Object.values(run.battle.units).filter((u) => u.side === user.side && u.slot >= 1 && !u.out).map((u) => u.slot))
  return Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1)
    .filter((s) => !overlayAt(run.battle, user.side, s))
    .sort((a, b) => Number(!people.has(a)) - Number(!people.has(b)) || Math.abs(a - user.slot) - Math.abs(b - user.slot) || a - b)[0]
}

function deployOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const t = ctx.target
  const targetSlot = t && 'slot' in t && 'side' in t && t.side === user.side && Number.isInteger(t.slot) && t.slot >= 1 && t.slot <= BATTLE_SLOTS ? t.slot : undefined
  const overCap = e.over_cap === true
  const limits = {
    ...(typeof e.turns === 'number' ? { until: run.battle.round + e.turns - 1 } : {}),
    ...(overCap ? { overCap: true } : {}), ...(e.no_backlash === true ? { noBacklash: true } : {}),
  }
  if (typeof e.drone === 'string') {
    const idx = indexOf(user, ctx.pick[e.drone])
    const def: DroneDef | undefined = idx === undefined ? undefined : dronesOf(user)[idx]
    if (idx === undefined || !def || !isKind(def.kind) || stateOf(user, idx) !== 0) throw new BattleBlocked(['沒有這一台無人機。'])
    if (targetSlot === undefined) throw new BattleBlocked(['要選我方的一格。'])
    if (!overCap) {
      const why = capBlock(run, user, def.kind)
      if (why) throw new BattleBlocked([why])
    }
    hang(run, user, targetSlot, { idx, limits })
    return
  }
  const kind = e.kind as DroneKind
  const slot = targetSlot ?? freeSlot(ctx)
  if (slot === undefined) {
    run.say(`${user.name} 沒有空的格子可以放${KIND_NAME[kind]}。`, 'overlay', { kind, none: true }, user)
    return
  }
  if (!overCap) {
    const why = capBlock(run, user, kind)
    if (why) throw new BattleBlocked([why])
  }
  hang(run, user, slot, { kind, grade: num(ctx, e.grade, 1), limits })
}

// ---- 其餘 ----

function moveOp(ctx: Ctx, e: Eff): void {
  const o = mine(ctx)
  const to = ctx.pick[String(e.to)]
  // 沒選的就不動（修修就好：順便移到相鄰的一格，可以不選）
  if (to === undefined) return
  moveTo(ctx.run, ctx.user, o, to, e.any === true)
}

function repairOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const o = mine(ctx)
  const n = Math.max(0, num(ctx, e.amount))
  const got = Math.min(n, o.hp.max - o.hp.now)
  o.hp.now += got
  run.say(`${o.name}回復了 ${got} 點耐久（${o.hp.now}／${o.hp.max}）。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, repair: got }, user)
}

function smokeOp(ctx: Ctx, e: Eff): void {
  const o = mine(ctx)
  ctx.run.softCover(o.side, o.slot, 'smoke', typeof e.rounds === 'number' ? e.rounds : 2)
}

function ramOp(ctx: Ctx, e: Eff): void {
  const { run, user } = ctx
  const o = mine(ctx)
  const foe = ctx.unit && !run.isStandIn(ctx.unit) ? ctx.unit : undefined
  if (!foe || foe.side === user.side || foe.out) throw new BattleBlocked(['要選一個敵人。'])
  if (foe.slot !== 1) throw new BattleBlocked(['只能撞敵方第 1 格的人。'])
  const type = typeof e.type === 'string' ? (e.type as never) : ('physical' as never)
  const raw = Math.max(0, num(ctx, e.dice ?? '3d6'))
  run.say(`${o.name}朝${foe.name}撞了過去。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, target: foe.id, ram: true }, user)
  // 它被擊落（overlay.down：操作者的回灌照算，臨時機不灌），目標受一擊、被往後推一格
  run.dropOverlay(o)
  const d = run.damage(foe, raw, type, user)
  ctx.last.hit = true
  ctx.last.dealt = d.dealt
  ctx.last.downed = !!foe.out
  if (!foe.out) run.shift(foe, +1, user)
}

function guardOp(ctx: Ctx, e: Eff): void {
  const which = typeof e.which === 'string' ? e.which : 'target'
  const until = e.until === 'battle_end' ? 'battle_end' : 'own_turn_start'
  let list: BattleOverlay[]
  if (which === 'target') list = [mine(ctx)]
  else {
    const all = heldBy(ctx.run, ctx.user).filter(isDrone)
    const pool = which === 'same_slot' ? all.filter((o) => o.slot === ctx.user.slot) : all
    list = pool.slice(0, e.max === undefined ? pool.length : Math.max(0, num(ctx, e.max, pool.length)))
  }
  for (const o of list) guard(ctx.run, o, until)
}

function escortOp(ctx: Ctx, e: Eff): void {
  const u = ctx.user
  if (e.off === true) {
    delete u.uses['escort.evade']
    delete u.uses['escort.max']
    return
  }
  u.uses['escort.evade'] = num(ctx, e.evade, 1)
  u.uses['escort.max'] = Math.max(1, num(ctx, e.max, 2))
  ctx.run.say(`${u.name}的無人機排成護航編隊。`, 'skill', { unit: u.id, escort: true }, u)
}

export function registerOps(k: Kernel): void {
  k.battle.effect('drone.act', OWNER, actOp, {
    problems: schema({ which: oneOf(WHICH), max: F, at: AT, hit: F, pierce: F, mark_used: B, ignore_used: B }, [], (e) => {
      const which = e.which ?? 'target'
      return which !== 'target' && e.at === undefined ? [`which「${String(which)}」是一整組一起打，一定要寫 at（打誰）`] : []
    }),
  })
  k.battle.effect('drone.deploy', OWNER, deployOp, {
    problems: schema({ drone: DROP, kind: oneOf(Object.keys(KIND_NAME)), grade: GRADE, turns: INT(1), over_cap: B, no_backlash: B }, [], (e) => {
      const p: string[] = []
      if ((e.drone === undefined) === (e.kind === undefined)) p.push('drone（pick 的鍵）與 kind（臨時機的種類）要寫一個，只能寫一個')
      if (e.grade !== undefined && e.kind === undefined) p.push('grade 只有臨時機（kind）用')
      return p
    }),
  })
  k.battle.effect('drone.move', OWNER, moveOp, { problems: schema({ to: DROP, any: B }, ['to']) })
  k.battle.effect('drone.repair', OWNER, repairOp, { problems: schema({ amount: F }, ['amount']) })
  k.battle.effect('drone.smoke', OWNER, smokeOp, { problems: schema({ rounds: INT(1) }, ['rounds']) })
  k.battle.effect('drone.ram', OWNER, ramOp, { problems: schema({ dice: F, type: S }) })
  k.battle.effect('drone.guard', OWNER, guardOp, { problems: schema({ which: oneOf(WHICH.filter((w) => w !== 'others')), max: F, until: oneOf(GUARD_UNTIL) }) })
  k.battle.effect('drone.escort', OWNER, escortOp, { problems: schema({ evade: F, max: F, off: B }) })
}

