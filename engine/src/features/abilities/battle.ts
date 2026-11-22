// 把裝著的技能帶進現實戰鬥（dev/work/M1-abilities.md 第四節；dev/work/M1b-skill-format.md）：
// 單位上的資料（unit.ready）、主動技能與姿態變成行動（ready 裡照內容註冊）、掮客招牌的「指揮」與「叫人」、
// 被動與共鳴變成修正（mods.ts）、反應（reactions.ts）、花費的減免是 action_ap 的修正（次數在 action.done 記）。
// 不 import 別的功能：技能自己用 run.attack 與 run.effects，不呼叫 features/combat 的行動。

import type { BattleActionDef, BattleInput, BattlePick, BattlePickOption, BattleRun, BattleTarget, BattleTargetOption, BattleUnit, BattleView, BattleWeapon, Kernel, RollPart } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, WOUND_PARTS, coverAt, gradeDice, onField, otherSide, unitAt, unitsOf, wielded } from '../../core'
import { endChanges } from './end'
import { needsBlocks, rangeBlock, whenBlocks, heldGun } from './conditions'
import { applySet } from './format'
import { instinctAction, registerInstinct, setupInstinct } from './instinct'
import { treeTierOf } from './learn'
import { featureTotal } from './mods'
import { startOnStart } from './onstart'
import { ransomChanges, registerRansom } from './ransom'
import { startPrep, bringPrep } from './prep'
import { suppressAfter } from './suppress'
import { bumpUses, costOf, setupResources, spentRam, usageBlocks, useOf } from './use'
import type { AbilityEntry, AbilityState, MeatDef, PathEntry, UnitAbilities } from './types'
import { OWNER } from './types'
import { equippedOf, hasAbility, isRec, tierIn, unitAbilities } from './unitdata'

export { unitAbilities }

// ---- 花費的減免（meat.cost、meat.weapon_cost） ----
// 裝著的被動技能讓「指定的主動技能」（cost.ability）或「用帶某個特性的武器攻擊一次」（weapon_cost.trait）改成只花 N 點。
// 做成花費的修正（action_ap）：核心問一個行動要花多少時，帶著行動的 id、行動的標籤（weapon_attack：用手上的武器攻擊一次）、
// 手上那一把武器與行動自己算的原價；這裡回答差幾點。不改武器、也不改行動：射擊是哪個功能的哪個行動，這裡不用知道。
// 寫了 per_turn 的只有每個回合的前幾次：用掉幾次記在 uses['turn:<被動技能 id>.discount']（核心每個回合開始清掉 'turn:' 開頭的鍵），
// 在行動做完的掛點（action.done）加一。同一個技能的 cost 與 weapon_cost 共用這個計數（定點射：要害射擊與狙擊槍的一槍合起來每回合省一次）。
// 監視的自動射擊、反應、技能裡附帶的攻擊不是「花了行動點的行動」，不經過這兩個地方，所以不會用掉次數。

const discountKey = (ab: AbilityEntry): string => `turn:${ab.id}.discount`

interface Discount {
  /** 給減免的那個被動技能 */
  by: AbilityEntry
  /** 改成花這麼多 */
  ap: number
  /** 每回合幾次；沒寫是每一次都算 */
  perTurn?: number
}

/**
 * 這一個行動套得上的減免裡最划算的那一筆（改完之後最便宜的；同一個行動不會疊兩筆）。
 * tags 是核心問花費時帶的標籤（行動的 id 在裡面），weapon 是手上那一把，base 是行動自己算的原價。
 * 每回合型的：這回合的次數用完了、或沒有比原價便宜，就不算。
 */
function discountFor(view: Pick<BattleView, 'k'>, u: BattleUnit, tags: readonly string[], weapon: BattleWeapon | undefined, base: number | undefined): Discount | undefined {
  if (base === undefined) return undefined
  let best: Discount | undefined
  for (const by of equippedOf(view, u)) {
    const m = by.meat
    const c = m?.cost && tags.includes(m.cost.ability) ? m.cost
      : m?.weapon_cost && tags.includes('weapon_attack') && weapon?.traits.includes(m.weapon_cost.trait) ? m.weapon_cost
        : undefined
    if (!c) continue
    if (c.per_turn !== undefined && ((u.uses[discountKey(by)] ?? 0) >= c.per_turn || c.ap >= base)) continue
    if (!best || c.ap < best.ap) best = { by, ap: c.ap, ...(c.per_turn !== undefined ? { perTurn: c.per_turn } : {}) }
  }
  return best
}

// ---- 條件 ----

/** attack 的條件：要拿著槍、彈匣夠。有 min_mag 時「彈匣空了」併進「彈匣裡要有幾格」那一條。 */
function attackBlocks(u: BattleUnit, atk: NonNullable<MeatDef['attack']>): string[] {
  const w = heldGun(u)
  if (!w) return ['要拿著槍才能用。']
  if (atk.min_mag !== undefined) return (w.mag?.now ?? 0) < atk.min_mag ? [`彈匣裡要有 ${atk.min_mag} 格以上才能連射。`] : []
  // 花固定幾格（點放）：彈匣裡要有那麼多；不花彈匣的（火力牆）看有沒有彈
  if (typeof atk.spend === 'number' && !atk.free_mag) return w.mag && w.mag.now < atk.spend ? [`彈匣裡要有 ${atk.spend} 格以上才能用。`] : []
  return w.mag && w.mag.now < 1 ? ['彈匣空了，要先換彈。'] : []
}

/**
 * 這一次實際用的 meat：別的裝著的技能的 alter 改在上面（路徑照那個技能 meat 裡的）。
 * 有 as_pick 的要玩家這一步開了那個選項（input.pick[key] 是 true）才算；沒給 input（問條件、問目標時）一律不算 as_pick 的。
 */
function effectiveMeat(view: Pick<BattleView, 'k'>, u: BattleUnit, ab: AbilityEntry, input?: BattleInput): MeatDef {
  const base = ab.meat!
  let m: Record<string, unknown> | undefined
  for (const other of equippedOf(view, u)) {
    for (const alt of other.meat?.alter ?? []) {
      if (alt.ability !== ab.id) continue
      if (alt.as_pick && input?.pick?.[alt.as_pick.key] !== true) continue
      if (alt.when && whenBlocks(view as BattleView, u, alt.when).length) continue
      m = applySet(m ?? (base as Record<string, unknown>), alt.set)
    }
  }
  return (m ?? base) as MeatDef
}

const TARGET_KIND = {
  enemy: 'foe', ally: 'ally', self: 'none', none: 'none', ally_slot: 'ally_slot', enemy_slot: 'foe_slot', foe_slot: 'foe_slot',
  ally_or_self: 'unit', near: 'unit', downed_near: 'unit', own_overlay: 'overlay', foe_overlay: 'overlay',
} as const

/** 目標是人的技能：現在可以選的候選（不看 needs 與距離）。 */
function candidates(view: BattleView, u: BattleUnit, m: MeatDef): BattleUnit[] {
  const b = view.battle
  switch (m.target) {
    case 'enemy': return unitsOf(b, otherSide(u.side))
    case 'ally': return unitsOf(b, u.side).filter((t) => t.id !== u.id)
    case 'ally_or_self':
    case 'near': return unitsOf(b, u.side)
    case 'downed_near': return Object.values(b.units).filter((t) => t.side === u.side && t.out === 'down' && t.id !== u.id && t.slot >= 1)
    default: return []
  }
}

const adjacentTo = (u: BattleUnit, t: BattleUnit): boolean => Math.abs(t.slot - u.slot) === 1

function targetsOf(view: BattleView, u: BattleUnit, m: MeatDef): BattleTargetOption[] {
  const atk = m.attack
  const needsUnit = !!(m.attack || m.apply)
  switch (m.target) {
    case 'enemy':
    case 'ally':
    case 'ally_or_self':
    case 'near':
    case 'downed_near': {
      return candidates(view, u, m).map((t) => {
        const blocks: string[] = []
        if (m.target === 'near' && t.id !== u.id && !adjacentTo(u, t)) blocks.push(`${t.name}不在相鄰的格子，只能對自己或相鄰的隊友用。`)
        if (m.target === 'downed_near' && !adjacentTo(u, t)) blocks.push(`${t.name}不在相鄰的格子，只能對相鄰倒下的隊友用。`)
        blocks.push(...needsBlocks(view, t, m.needs))
        const far = rangeBlock(u, t.slot, m.range)
        if (far) blocks.push(far)
        // 幾種用法挑一種：每一種對這個人的條件都不成立，這個人就選不了
        if (m.choose?.length && m.choose.every((c) => needsBlocks(view, t, c.needs).length > 0)) blocks.push(...new Set(m.choose.flatMap((c) => needsBlocks(view, t, c.needs))))
        const w = wielded(u)
        return {
          target: { unit: t.id }, blocks,
          ...(m.target === 'enemy' && atk && w ? { hint: { hit: view.hitChance(u, t, w, { aimed: atk.aimed, hit: atk.hit, tags: ['skill'] }) } } : {}),
        }
      })
    }
    case 'ally_slot':
    case 'enemy_slot':
    case 'foe_slot': {
      const side = m.target === 'ally_slot' ? u.side : otherSide(u.side)
      return Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).map((slot) => ({
        target: { side, slot },
        blocks: [...(needsUnit && !unitAt(view.battle, side, slot) ? ['那一格沒有人。'] : []), ...(rangeBlock(u, slot, m.range) ? [rangeBlock(u, slot, m.range)!] : [])],
      }))
    }
    case 'own_overlay':
    case 'foe_overlay': {
      const mine = m.target === 'own_overlay'
      return view.battle.overlays
        .filter((o) => !o.down && (mine ? o.side === u.side && o.owner === u.id : o.side !== u.side))
        .map((o) => ({ target: { overlay: o.id }, blocks: rangeBlock(u, o.slot, m.range) ? [rangeBlock(u, o.slot, m.range)!] : [] }))
    }
    default:
      return []
  }
}

function unitOfTarget(run: BattleRun, u: BattleUnit, m: MeatDef, target: BattleTarget | null): BattleUnit | undefined {
  if (m.target === 'self') return u
  if (!target) return undefined
  if ('unit' in target) return run.unit(target.unit)
  if ('slot' in target && 'side' in target) return unitAt(run.battle, target.side, target.slot)
  return undefined
}

/** 主動技能的 attack：照鍵組出 run.attack 的選項，打完之後的壓制（suppress.ts）。 */
function doAttack(run: BattleRun, u: BattleUnit, ab: AbilityEntry, m: MeatDef, target: BattleUnit, part: unknown): void {
  const atk = m.attack!
  const w = wielded(u)
  // 花掉的格數：spend 'all' 是彈匣現在的全部，數字是那麼多格，沒寫是 1 格；free_mag 的格數照算（傷害、壓制），只是不扣彈匣
  const spent = atk.spend === 'all' ? (w?.mag?.now ?? 1) : typeof atk.spend === 'number' ? atk.spend : 1
  const result = run.attack(u, target, {
    aimed: atk.aimed, hit: atk.hit, label: ab.name, tags: ['skill'],
    ...(atk.spend !== undefined ? { spend: atk.free_mag ? 0 : spent } : {}),
    ...(atk.dice === 'spent_minus_1' ? { dice: spent - 1 } : {}),
    ...(typeof part === 'string' ? { part } : {}),
  })
  if (atk.suppress && !atk.suppress.auto && !result.aborted) suppressAfter(run, u, target, atk.suppress, spent)
}

/** 換個位子嘛：選的隊友和另一名相鄰的隊友交換位置，不花他們的行動點。 */
function doSwap(run: BattleRun, u: BattleUnit, target: BattleUnit, withId: unknown): void {
  const mate = typeof withId === 'string' ? run.battle.units[withId] : undefined
  if (!mate || mate.id === u.id || mate.id === target.id || mate.side !== u.side || !onField(mate) || Math.abs(mate.slot - target.slot) !== 1) throw new BattleBlocked(['要選兩名相鄰的隊友。'])
  run.move(target, mate.slot)
}

/** 主動技能的圖示：瞄準過的一槍是準星（aim），把彈匣打光的是連射（burst），其餘是技能的晶片（skill）。 */
const iconOf = (m: MeatDef): string => (m.attack?.spend === 'all' ? 'burst' : m.attack?.aimed ? 'aim' : 'skill')

// ---- 目標以外要選的 ----

/**
 * 宣告的 pick 的選項：場上的人或格子。技能的目標是人的時候，選的人不能就是目標自己（「另一個敵人」「和誰對調」）：
 * 每個選項只對「不是它自己」的目標適用（for），宣告與行動才對得上。
 */
function declaredOptions(view: BattleView, u: BattleUnit, kind: 'foe' | 'ally' | 'ally_slot' | 'foe_slot', adjacent = false, targets: BattleUnit[] = []): BattlePickOption[] {
  const b = view.battle
  const apart = (t: BattleUnit): Pick<BattlePickOption, 'for'> => (targets.length ? { for: targets.filter((x) => x.id !== t.id).map((x): BattleTarget => ({ unit: x.id })) } : {})
  if (kind === 'foe') return unitsOf(b, otherSide(u.side)).map((t) => ({ value: t.id, label: t.name, blocks: [], at: { unit: t.id } as BattleTarget, ...apart(t) }))
  if (kind === 'ally') {
    return unitsOf(b, u.side).filter((t) => t.id !== u.id).map((t) => ({
      value: t.id, label: t.name, blocks: adjacent && !adjacentTo(u, t) ? [`${t.name}不在相鄰的格子，只能選和自己相鄰的隊友。`] : [], at: { unit: t.id } as BattleTarget, ...apart(t),
    }))
  }
  const side = kind === 'ally_slot' ? u.side : otherSide(u.side)
  return Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).map((slot) => ({ value: slot, label: `第 ${slot} 格`, blocks: [], at: { side, slot } as BattleTarget }))
}

/** 幾種用法挑一種：選項的條件（when）灰掉自己的原因；目標的條件（needs）只讓適用的目標看到這一項。 */
function chooseOptions(view: BattleView, u: BattleUnit, m: MeatDef): BattlePickOption[] {
  const units = candidates(view, u, m)
  return (m.choose ?? []).map((c) => ({
    value: c.key, label: c.label, blocks: whenBlocks(view, u, c.when),
    ...(c.needs ? { for: units.filter((t) => needsBlocks(view, t, c.needs).length === 0).map((t): BattleTarget => ({ unit: t.id })) } : {}),
  }))
}

/** 這個技能會打出瞄準過的一擊（attack.aimed，或 do 裡有 aimed 的 attack）：打出重創時部位由玩家選（pick.part）。 */
const wantsPart = (m: MeatDef): boolean => !!(m.attack?.aimed || m.do?.some((e) => e.op === 'attack' && e.aimed === true) || m.choose?.some((c) => c.do.some((e) => e.op === 'attack' && e.aimed === true)))

/** 技能的目標是人、選的也是人（foe、ally）時，選的不能是目標自己：回傳可以當目標的那些人（沒有這回事就是空的）。 */
function pickTargets(view: BattleView, u: BattleUnit, m: MeatDef, kind: string): BattleUnit[] {
  return (kind === 'foe' || kind === 'ally') && m.target && ['enemy', 'ally', 'ally_or_self', 'near', 'downed_near'].includes(m.target) ? candidates(view, u, m) : []
}

const choiceKey = (m: MeatDef): string => m.picks?.find((p) => p.kind === 'choice')?.key ?? 'choice'

/**
 * 主動技能除了目標還要選的東西：瞄準過的一槍可以指定部位（pick.part）；換個位子嘛要選另一名相鄰的隊友（pick.with）；
 * meat.picks 宣告的；meat.choose 的用法（一個 choice）；別的技能的 alter 用 as_pick 多出來的開關。
 */
function picksOf(view: BattleView, u: BattleUnit, ab: AbilityEntry, m: MeatDef): BattlePick[] {
  const out: BattlePick[] = []
  if (wantsPart(m)) {
    // 瞄準過的射擊打出重創時，部位由攻擊者選（COMBAT_SYSTEM 第 6 節）；不選就照擲的
    out.push({ key: 'part', label: '瞄準哪個部位', kind: 'choice', required: false, options: WOUND_PARTS.map((p) => ({ value: p.id, label: p.name, blocks: [] })) })
  }
  if (m.free_move?.swap_adjacent_pair) {
    const mates = unitsOf(view.battle, u.side).filter((t) => t.id !== u.id)
    const options = mates
      .map((mate) => ({ mate, near: mates.filter((t) => t.id !== mate.id && Math.abs(t.slot - mate.slot) === 1).map((t): BattleTarget => ({ unit: t.id })) }))
      .filter((x) => x.near.length > 0)
      .map((x) => ({ value: x.mate.id, label: x.mate.name, blocks: [], at: { unit: x.mate.id } as BattleTarget, for: x.near }))
    out.push({ key: 'with', label: '和誰交換', kind: 'ally', required: true, options })
  }
  for (const d of m.picks ?? []) {
    if (d.kind === 'choice') out.push({ key: d.key, label: d.label, kind: 'choice', required: d.required ?? true, options: chooseOptions(view, u, m) })
    else out.push({ key: d.key, label: d.label, kind: d.kind, required: d.required ?? true, options: declaredOptions(view, u, d.kind, d.adjacent === true, d.apart ? pickTargets(view, u, m, d.kind) : []) })
  }
  if (m.choose?.length && !m.picks?.some((p) => p.kind === 'choice')) out.push({ key: 'choice', label: '用法', kind: 'choice', required: true, options: chooseOptions(view, u, m) })
  for (const other of equippedOf(view, u)) {
    for (const alt of other.meat?.alter ?? []) {
      if (alt.ability === ab.id && alt.as_pick) out.push({ key: alt.as_pick.key, label: alt.as_pick.label, kind: 'toggle', required: false, options: [{ value: true, label: alt.as_pick.label, blocks: [] }] })
    }
  }
  return out
}

/** 做的時候照宣告查：一定要選的有沒有選、選的在不在選項裡、選的用法條件成不成立。 */
function checkPicks(run: BattleRun, u: BattleUnit, m: MeatDef, input: BattleInput, target: BattleUnit | undefined): void {
  for (const d of m.picks ?? []) {
    const options = d.kind === 'choice' ? chooseOptions(run, u, m) : declaredOptions(run, u, d.kind, d.adjacent === true)
    const v = input.pick?.[d.key]
    if (d.apart && v !== undefined && target && v === target.id && pickTargets(run, u, m, d.kind).length) throw new BattleBlocked([`${d.label}不能選${target.name}（和目標是同一個人）。`])
    if (v === undefined) {
      if ((d.required ?? true) && options.length) throw new BattleBlocked([`要選${d.label}。`])
      continue
    }
    const picked = options.find((o) => o.value === v)
    if (!picked) throw new BattleBlocked([`${d.label}：沒有這個選項。`])
    if (picked.blocks.length) throw new BattleBlocked(picked.blocks)
  }
  if (m.choose?.length) {
    const key = choiceKey(m)
    const v = input.pick?.[key]
    const decl = m.picks?.find((p) => p.kind === 'choice')
    if (v === undefined) {
      if (decl?.required === false) return
      throw new BattleBlocked(['要選用法。'])
    }
    const entry = m.choose.find((c) => c.key === v)
    if (!entry) throw new BattleBlocked(['用法：沒有這個選項。'])
    const why = [...whenBlocks(run, u, entry.when), ...(target ? needsBlocks(run, target, entry.needs) : [])]
    if (why.length) throw new BattleBlocked(why)
  }
}

// ---- 行動 ----

function skillAction(ab: AbilityEntry, order: number): BattleActionDef {
  const m0 = ab.meat!
  const hasPicks = (v: Pick<BattleView, 'k'>, u: BattleUnit): boolean => !!(wantsPart(m0) || m0.free_move?.swap_adjacent_pair || m0.picks || m0.choose || equippedOf(v, u).some((o) => o.meat?.alter?.some((a) => a.ability === ab.id && a.as_pick)))
  return {
    id: ab.id, owner: OWNER, name: ab.name, desc: ab.text, group: 'skill', icon: iconOf(m0), modes: ['meat'],
    target: TARGET_KIND[m0.target ?? 'none'], order,
    has: (_v, u) => hasAbility(u, ab.id),
    // 技能自己的消耗（行動點、RAM、現金、人情）；別的被動技能給的減免（meat.cost）是花費的修正，核心會加上去
    cost: (v, u) => costOf(v, u, ab),
    blocks: (v, u) => {
      const m = effectiveMeat(v, u, ab)
      return [...usageBlocks(v, u, ab), ...whenBlocks(v, u, m.when), ...(m.attack ? attackBlocks(u, m.attack) : [])]
    },
    targets: (v, u) => targetsOf(v, u, effectiveMeat(v, u, ab)),
    picks: (v, u) => (hasPicks(v, u) ? picksOf(v, u, ab, effectiveMeat(v, u, ab)) : []),
    run(run, u, target, input) {
      bumpUses(u, ab)
      run.say(`${u.name}：${ab.name}。`, 'skill', { unit: u.id, ability: ab.id }, u)
      const m = effectiveMeat(run, u, ab, input)
      const t = unitOfTarget(run, u, m, target)
      if ((m.attack || m.apply || m.free_move) && !t) throw new BattleBlocked(['那一格沒有人。'])
      checkPicks(run, u, m, input, t)
      if (m.attack) doAttack(run, u, ab, m, t!, input.pick?.part)
      for (const a of m.apply ?? []) run.applyStatus(t!, a.status, { by: u, ...(a.until ? { until: a.until } : {}) })
      if (m.free_move?.swap_adjacent_pair) doSwap(run, u, t!, input.pick?.with)
      // 效果清單：do，再加選的那一種用法的 do；同一個 last 傳下去（打倒了再…）
      const use = useOf(ab)
      const base = {
        user: u, target: m.target === 'self' ? { unit: u.id } : target, source: { kind: 'ability' as const, id: ab.id, name: ab.name }, pick: input.pick ?? {},
        n: { tier: tierIn(u, ab.path), ...(use.ram_all_min !== undefined ? { spent: spentRam(u) } : {}) }, last: {},
      }
      if (m.do?.length) run.effects(m.do, base)
      const entry = m.choose?.find((c) => c.key === input.pick?.[choiceKey(m)])
      if (entry) run.effects(entry.do, base)
    },
  }
}

/** 姿態：開、關、換都花 use.ap；同時只能開一個（開另一個時前一個關掉）；開著的記在 unit.stance。 */
function stanceAction(ab: AbilityEntry, order: number): BattleActionDef {
  const m = ab.meat!
  const run1 = (run: BattleRun, u: BattleUnit, list: Array<Record<string, unknown>> | undefined, of: AbilityEntry): void => {
    if (list?.length) run.effects(list, { user: u, target: { unit: u.id }, source: { kind: 'ability', id: of.id, name: of.name }, n: { tier: tierIn(u, of.path) } })
  }
  return {
    id: ab.id, owner: OWNER, name: ab.name, desc: ab.text, group: 'skill', icon: 'skill', modes: ['meat'], target: 'none', order,
    has: (_v, u) => hasAbility(u, ab.id),
    cost: (v, u) => costOf(v, u, ab),
    // 關掉自己開著的不看條件；開的時候才看次數與條件
    blocks: (v, u) => (u.stance === ab.id ? [] : [...usageBlocks(v, u, ab), ...whenBlocks(v, u, m.when)]),
    run(run, u) {
      if (u.stance === ab.id) {
        delete u.stance
        run.say(`${u.name}：收起${ab.name}。`, 'skill', { unit: u.id, ability: ab.id, stance: 'off' }, u)
        run1(run, u, m.do_off, ab)
        return
      }
      const prev = u.stance ? run.k.content.get<AbilityEntry>('ability', u.stance) : undefined
      if (prev) {
        run.say(`${u.name}：收起${prev.name}。`, 'skill', { unit: u.id, ability: prev.id, stance: 'off' }, u)
        run1(run, u, prev.meat?.do_off, prev)
      }
      bumpUses(u, ab)
      u.stance = ab.id
      run.say(`${u.name}：進入${ab.name}。`, 'skill', { unit: u.id, ability: ab.id, stance: 'on' }, u)
      run1(run, u, m.do_on, ab)
    },
  }
}

// ---- 掮客的招牌：指揮與叫人 ----

function giveApAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.give_ap`
  // 每回合最多讓幾點：1 ＋ 人面階數的一半（無條件捨去）＋ 修正（號令：+1）
  const limit = (v: BattleView, u: BattleUnit) => 1 + Math.floor(tierIn(u, ab.path) / 2) + featureTotal(v, u, 'give_ap_cap')
  return {
    id, owner: OWNER, name: '指揮', desc: '把自己的行動點讓給一名隊友，1 點換 1 點。', group: 'skill', icon: 'skill', modes: ['meat'], target: 'ally', order,
    has: (_v, u) => hasAbility(u, ab.id),
    cost: () => ({ ap: 1 }),
    blocks: (v, u) => ((u.uses[`turn:${id}`] ?? 0) >= limit(v, u) ? [`這一回合已經讓了 ${limit(v, u)} 點，不能再讓。`] : []),
    targets: (v, u) => unitsOf(v.battle, u.side).filter((t) => t.id !== u.id).map((t) => ({ target: { unit: t.id }, blocks: t.ap.now >= t.ap.max ? ['他的行動點已經滿了。'] : [] })),
    run(run, u, target) {
      if (!target || !('unit' in target)) return
      const t = run.unit(target.unit)
      u.uses[`turn:${id}`] = (u.uses[`turn:${id}`] ?? 0) + 1
      t.ap.now = Math.min(t.ap.max, t.ap.now + 1)
      run.say(`${u.name}：指揮，把 1 點行動點讓給 ${t.name}。`, 'skill', { unit: u.id, ability: ab.id, to: t.id }, u)
      // 開著的姿態有 on_give_ap（號令）：拿到行動點的人多一段修正
      const stance = u.stance ? run.k.content.get<AbilityEntry>('ability', u.stance) : undefined
      const list = stance?.meat?.on_give_ap
      if (stance && list?.length) run.effects(list, { user: u, target: { unit: t.id }, source: { kind: 'ability', id: stance.id, name: stance.name }, n: { tier: tierIn(u, stance.path) } })
    },
  }
}

/**
 * 叫人的支援射擊：名冊上的人開一槍，走一般的攻擊（`run.attack`：自然 1／20、要害、傷到那一格的遮蔽、hit／miss／crit 的紀錄都和別的射擊一樣）。
 * 數字是 SKILL_TREES 人面的叫人的暫定值：命中加值 4 ＋ 場景的等級 × 2，傷害 3 ＋ 等級骰顆 d6 的物理傷害（dev/adr/0013 D12）。
 * 命中再加修正 call_hit（人脈：+2）。
 * 用一把臨時的武器：不扣距離（和無人機一樣）、不吃彈匣、打遮蔽的倍率照手槍（×0.25，同為 3d6 的基礎）。
 */
function supportWeapon(run: BattleRun, u: BattleUnit): BattleWeapon {
  return {
    id: 'support', name: '支援', class: 'support', dice: 3 + gradeDice(run.battle.grade), flat: 0, type: 'physical', range: [1, 7], pierce: 0,
    hit: 4 + run.battle.grade * 2 + featureTotal(run, u, 'call_hit'), attr: 'charm', skill: 'streetwise', coverMult: 0.25, traits: [],
  }
}

const CALL_NAME: Record<string, string> = {
  cover_up: '補遮蔽：替我方一格補一級遮蔽', cover_down: '拆遮蔽：拆掉敵方一格的一級遮蔽', shot: '支援射擊：朝一個敵人開一槍',
  heal: '回復：替一名隊友回復生命', vent: '排感載：替一名隊友排掉感載',
}

function callAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.call`
  // 叫人的選項與數字可以被別的技能改（我有認識的人：alter 多兩個選項）；每場次數吃修正 call_uses（派工網、人脈）
  const callOf = (v: Pick<BattleView, 'k'>, u: BattleUnit, input?: BattleInput) => effectiveMeat(v, u, ab, input).call ?? ab.meat!.call!
  const times = (v: BattleView, u: BattleUnit) => Math.max(0, Math.ceil(tierIn(u, ab.path) / 2) + featureTotal(v, u, 'call_uses'))
  const slots = (side: 'ally' | 'foe'): BattleTarget[] => Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ side, slot: i + 1 }))
  const mates = (v: BattleView, u: BattleUnit): BattleUnit[] => unitsOf(v.battle, u.side).filter((t) => t.id !== u.id)
  return {
    id, owner: OWNER, name: '叫人', desc: '叫一個沒有上場的人出手一次：替我方一格補一級遮蔽、拆掉敵方一格的一級遮蔽，或支援射擊。', group: 'skill', icon: 'skill', modes: ['meat'], order,
    // 目標有三種（我方的格、敵方的格、一個敵人或隊友），看選了哪一件事（pick.option）；列出來讓核心驗：不在這張表上的目標直接擋下
    target: 'mixed',
    targets: (v, u) => {
      const call = callOf(v, u)
      return [
        ...(call.options.includes('cover_up') ? slots(u.side).map((target) => ({ target, blocks: [] as string[] })) : []),
        // 敵方的格只有拆遮蔽用得到：沒有遮蔽的格列出來、寫出原因
        ...(call.options.includes('cover_down') ? slots(otherSide(u.side)).map((target) => ({ target, blocks: 'slot' in target && coverAt(v.battle, target.side, target.slot).level < 1 ? ['這一格沒有遮蔽可以拆。'] : [] })) : []),
        ...(call.options.includes('shot') ? unitsOf(v.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id } as BattleTarget, blocks: [] as string[] })) : []),
        ...(call.options.includes('heal') || call.options.includes('vent') ? mates(v, u).map((t) => ({ target: { unit: t.id } as BattleTarget, blocks: [] as string[] })) : []),
      ]
    },
    // 叫人做哪一件事（pick.option）：每一件事各自適用的目標寫在 for
    picks: (v, u): BattlePick[] => [{
      key: 'option', label: '叫人做什麼', kind: 'choice', required: true,
      options: callOf(v, u).options.map((o) => ({
        value: o, label: CALL_NAME[o] ?? o, blocks: [],
        for: o === 'cover_up' ? slots(u.side)
          : o === 'cover_down' ? slots(otherSide(u.side)).filter((t) => 'slot' in t && coverAt(v.battle, t.side, t.slot).level >= 1)
            : o === 'heal' ? mates(v, u).map((t): BattleTarget => ({ unit: t.id }))
              : o === 'vent' ? mates(v, u).filter((t) => !!t.load).map((t): BattleTarget => ({ unit: t.id }))
                : unitsOf(v.battle, otherSide(u.side)).map((t): BattleTarget => ({ unit: t.id })),
      })),
    }],
    has: (_v, u) => hasAbility(u, ab.id),
    cost: (_v, u) => ({ ap: callOf(_v, u).ap }),
    blocks: (v, u) => ((u.uses[id] ?? 0) >= times(v, u) ? [`這一場叫人的次數用完了（${times(v, u)} 次）。`] : []),
    run(run, u, _target, input) {
      const call = callOf(run, u, input)
      const option = input.pick?.option
      const t = input.target
      const bad = new BattleBlocked(['叫人要選一件事：補遮蔽、拆遮蔽，或支援射擊。'])
      if (typeof option !== 'string' || !(call.options as string[]).includes(option) || !t) throw bad
      let text = ''
      if (option === 'cover_up') {
        if (!('side' in t) || t.side !== u.side || t.slot < 1 || t.slot > BATTLE_SLOTS) throw bad
        run.raiseCover(t.side, t.slot, 1)
        text = `${u.name}：叫人，替我方第 ${t.slot} 格補了一級遮蔽。`
      } else if (option === 'cover_down') {
        if (!('side' in t) || t.side === u.side || t.slot < 1 || t.slot > BATTLE_SLOTS || coverAt(run.battle, t.side, t.slot).level < 1) throw bad
        run.lowerCover(t.side, t.slot, 1, u)
        text = `${u.name}：叫人，拆掉敵方第 ${t.slot} 格的一級遮蔽。`
      } else if (option === 'shot') {
        if (!('unit' in t)) throw bad
        const foe = run.battle.units[t.unit]
        if (!foe || foe.side === u.side || !onField(foe)) throw bad
        // 先記下這一次叫人，再開槍：命中與否、要害與遮蔽的紀錄由攻擊自己寫（hit／miss／crit，帶檢定的擲骰）
        u.uses[id] = (u.uses[id] ?? 0) + 1
        run.say(`${u.name}：叫人，支援射擊 ${foe.name}。`, 'support', { unit: u.id, option, target: foe.id }, u)
        run.attack(u, foe, { weapon: supportWeapon(run, u), label: '射擊', spend: 0 })
        return
      } else if (option === 'heal' || option === 'vent') {
        // 認識的醫生、藥商：替一名隊友回復生命或排感載（數字在這個技能的 call.heal、call.vent）
        if (!('unit' in t)) throw bad
        const mate = run.battle.units[t.unit]
        if (!mate || mate.side !== u.side || mate.id === u.id || !onField(mate)) throw bad
        if (option === 'vent' && !mate.load) throw new BattleBlocked([`${mate.name}沒有橋，沒有感載可以排。`])
        u.uses[id] = (u.uses[id] ?? 0) + 1
        run.say(`${u.name}：叫人，替 ${mate.name} ${option === 'heal' ? '回復生命' : '排掉感載'}。`, 'support', { unit: u.id, option, target: mate.id }, u)
        run.effects([{ op: option, amount: call[option]! }], { user: u, target: { unit: mate.id }, source: { kind: 'ability', id: ab.id, name: '叫人' }, n: { tier: tierIn(u, ab.path) } })
        return
      } else throw bad
      u.uses[id] = (u.uses[id] ?? 0) + 1
      run.say(text, 'support', { unit: u.id, option }, u)
    },
  }
}

/** 內容載入之後：照內容註冊行動。 */
export function registerActions(k: Kernel): void {
  k.content.list<AbilityEntry>('ability').forEach((ab, order) => {
    const m = ab.meat
    if (!m || m.pending) return
    if (ab.kind === 'active' && (m.target || m.do || m.choose)) k.battle.action(skillAction(ab, order))
    if (ab.kind === 'stance') k.battle.action(stanceAction(ab, order))
    if (m.give_ap) k.battle.action(giveApAction(ab, order))
    if (m.call) k.battle.action(callAction(ab, order))
    if (m.instinct) k.battle.action(instinctAction(ab, order))
  })
}

// ---- 掛點與修正 ----

/** 一個資源池加減上限與每回合回復：池有就加（現在的也跟著加，不超過上限）；沒有而且是加上限就新開一個。 */
function bumpPool(unit: BattleUnit, id: string, d: { max?: number; regen?: number }): void {
  const max = d.max ?? 0
  const regen = d.regen ?? 0
  const pool = unit.pools[id]
  if (pool) {
    pool.max = Math.max(0, pool.max + max)
    pool.now = Math.min(pool.max, Math.max(0, pool.now + max))
    pool.regen = Math.max(0, pool.regen + regen)
  } else if (max > 0) unit.pools[id] = { now: max, max, regen: Math.max(0, regen) }
}

/**
 * 裝著的被動技能給的標籤（meat.tags）與池的加減（meat.pool），以及共鳴給的池（effect.pool）與感載上限（effect.load_max）：開打時一次。
 * 共鳴：這棵樹的階數到了 N，tier <= N 的共鳴都生效（要裝著這棵樹的招牌才算，和其他共鳴一樣）。
 */
function applyPassives(run: BattleRun, unit: BattleUnit): void {
  for (const ab of equippedOf(run, unit)) {
    const m = ab.meat
    if (!m || m.pending) continue
    for (const t of m.tags ?? []) if (!unit.tags.includes(t)) unit.tags.push(t)
    for (const [id, d] of Object.entries(m.pool ?? {})) bumpPool(unit, id, d)
  }
  const d = unitAbilities(unit)
  if (!d.equipped.length) return
  for (const p of run.k.content.list<PathEntry>('path')) {
    if (!d.equipped.includes(p.signature)) continue
    const tier = d.tiers[p.id] ?? 1
    for (const r of p.resonance) {
      const f = r.effect
      if (!f || r.tier > tier) continue
      for (const [id, pool] of Object.entries(f.pool ?? {})) bumpPool(unit, id, pool)
      if (f.load_max && unit.load) unit.load.max = Math.max(1, unit.load.max + f.load_max)
    }
  }
}

export function registerBattle(k: Kernel): void {
  registerInstinct(k)
  // 單位剛組好：照開打那一刻填上裝著的技能與每棵樹的階；已經有資料的單位不動
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (!isRec(unit.ext.abilities) && unit.actor) {
      const mine = run.state.actors[unit.actor]?.ext.abilities
      const r = isRec(mine) ? mine : {}
      const tiers: Record<string, number> = {}
      if (isRec(r.spent)) for (const [path, v] of Object.entries(r.spent)) if (typeof v === 'number') tiers[path] = treeTierOf(v)
      const preset = isRec(r.preset) ? (r.preset as NonNullable<AbilityState['preset']>) : undefined
      unit.ext.abilities = { equipped: Array.isArray(r.equipped) ? r.equipped.filter((x) => typeof x === 'string') : [], tiers, ...(preset?.picks ? { picks: { ...preset.picks } } : {}) } satisfies UnitAbilities
    }
    applyPassives(run, unit)
    setupResources(run, unit)
    bringPrep(run, unit)
    // 戰鬥直覺：開打時的分配（在擲先攻之前，先攻的修正才讀得到）
    setupInstinct(run, unit)
  })

  // 開打：預備帶進來的 do 做一次；裝著的技能的開戰效果（on_start）做一次
  k.battle.on('battle.start', OWNER, ({ run }) => {
    startPrep(run)
    startOnStart(run)
  })

  // 戰鬥結束：現金與人情的差額、每件委託的次數、用掉的預備
  k.battle.onEnd(OWNER, ({ k: bk, state, battle, outcome }) => {
    // 輸了而且隊上有人裝著保釋：記下「被贖回」的贖金（戰敗的功能經 defeat.options 問）
    const changes = [...endChanges(state, battle), ...ransomChanges(bk, state, battle, outcome)]
    return changes.length ? { changes } : undefined
  })
  registerRansom(k)

  // 花費的減免：指定的主動技能、用帶某個特性的武器攻擊一次（見上面「花費的減免」）
  k.battle.modifier(OWNER, (q) => {
    if (q.kind !== 'action_ap') return []
    const d = discountFor(q.view, q.unit, q.tags, q.weapon, q.base)
    return d ? [{ label: d.by.name, value: d.ap - q.base!, source: 'skill' }] : []
  })

  // 一個花了行動點的行動做完：這一次算的是每回合型的減免，就用掉一次。
  // 這時候次數還沒加，照同樣的條件再問一次，拿到的就是扣行動點時用的那一筆
  k.battle.on('action.done', OWNER, ({ run, unit, tags, weapon, base }) => {
    const d = discountFor(run, unit, tags, weapon, base.ap)
    if (d?.perTurn !== undefined) unit.uses[discountKey(d.by)] = (unit.uses[discountKey(d.by)] ?? 0) + 1
  })

  // 共鳴：這棵樹的階數到了 N，tier <= N 的共鳴都生效（要裝著這棵樹的招牌才算）
  k.battle.modifier(OWNER, (q) => {
    if (q.kind !== 'initiative' && q.kind !== 'move_ap') return []
    const d = unitAbilities(q.unit)
    if (!d.equipped.length) return []
    const out: RollPart[] = []
    for (const p of k.content.list<PathEntry>('path')) {
      if (!d.equipped.includes(p.signature)) continue
      const tier = d.tiers[p.id] ?? 1
      for (const r of p.resonance) {
        const f = r.effect
        if (!f || r.tier > tier) continue
        if (q.kind === 'initiative' && typeof f.initiative === 'number') out.push({ label: p.tree, value: f.initiative, source: 'skill' })
        if (q.kind === 'move_ap' && f.free_move && (q.unit.uses.free_move ?? 0) < f.free_move.per_fight) out.push({ label: p.tree, value: -1, source: 'skill' })
      }
    }
    return out
  })

  // 自己換位用掉了「每場第一次換位不花行動點」
  k.battle.on('moved', OWNER, ({ run, unit, by }) => {
    if (by === 'action' && run.current()?.id === unit.id) unit.uses.free_move = (unit.uses.free_move ?? 0) + 1
  })

}
