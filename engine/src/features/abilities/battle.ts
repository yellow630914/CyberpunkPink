// 把裝著的技能帶進現實戰鬥（dev/work/M1-abilities.md 第四節）：
// 單位上的資料（unit.ready）、主動技能變成行動（ready 裡照內容註冊）、掮客招牌的「指揮」與「叫人」、
// 被動與共鳴變成修正（花費的減免是 action_ap 的修正，次數在 action.done 記）、反應掛在攻擊之前（掩護射擊、小心後面！）。
// 不 import 別的功能：技能自己用 run.attack，不呼叫 features/combat 的行動。

import type { BattleActionDef, BattlePick, BattleRun, BattleTarget, BattleTargetOption, BattleUnit, BattleView, BattleWeapon, Kernel, RollPart, SkillId } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, WOUND_PARTS, coverAt, gradeDice, onField, otherSide, unitAt, unitsOf, wielded } from '../../core'
import { treeTierOf } from './learn'
import type { AbilityEntry, MeatDef, PathEntry, UnitAbilities } from './types'
import { OWNER } from './types'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---- 單位上的資料 ----

/** 這個單位裝著什麼、每棵樹開到幾階。沒有資料的單位是空的。 */
export function unitAbilities(u: BattleUnit): UnitAbilities {
  const d = u.ext.abilities
  if (!isRec(d)) return { equipped: [], tiers: {} }
  const tiers: Record<string, number> = {}
  if (isRec(d.tiers)) for (const [key, v] of Object.entries(d.tiers)) if (typeof v === 'number') tiers[key] = v
  return { equipped: Array.isArray(d.equipped) ? d.equipped.filter((x): x is string => typeof x === 'string') : [], tiers }
}

const hasAbility = (u: BattleUnit, id: string): boolean => unitAbilities(u).equipped.includes(id)
const tierIn = (u: BattleUnit, path: string): number => unitAbilities(u).tiers[path] ?? 1

/** 裝著的技能的內容（找不到的略過）。 */
function equippedOf(view: Pick<BattleView, 'k'>, u: BattleUnit): AbilityEntry[] {
  return unitAbilities(u).equipped.map((id) => view.k.content.get<AbilityEntry>('ability', id)).filter((a): a is AbilityEntry => !!a)
}

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

// ---- 行動的次數與條件 ----

/** 共同的條件：每場、第一回合、每回合。 */
function usageBlocks(view: BattleView, u: BattleUnit, ab: AbilityEntry): string[] {
  const use = ab.use
  const out: string[] = []
  if (use?.per_fight !== undefined && (u.uses[ab.id] ?? 0) >= use.per_fight) out.push('這一場已經用過了。')
  if (use?.first_round && view.battle.round !== 1) out.push('只能在第一回合用。')
  if (use?.per_turn !== undefined && (u.uses[`turn:${ab.id}`] ?? 0) >= use.per_turn) out.push('這一回合已經用過了。')
  return out
}

function bumpUses(u: BattleUnit, ab: AbilityEntry): void {
  if (ab.use?.per_fight !== undefined) u.uses[ab.id] = (u.uses[ab.id] ?? 0) + 1
  if (ab.use?.per_turn !== undefined) u.uses[`turn:${ab.id}`] = (u.uses[`turn:${ab.id}`] ?? 0) + 1
}

/** 手上是能射擊的槍（不是近戰、不是空手）。 */
const heldGun = (u: BattleUnit) => {
  const w = wielded(u)
  return w && !w.traits.includes('melee') ? w : undefined
}

/** attack 的條件：要拿著槍、彈匣夠。有 min_mag 時「彈匣空了」併進「彈匣裡要有幾格」那一條。 */
function attackBlocks(u: BattleUnit, atk: NonNullable<MeatDef['attack']>): string[] {
  const w = heldGun(u)
  if (!w) return ['要拿著槍才能用。']
  if (atk.min_mag !== undefined) return (w.mag?.now ?? 0) < atk.min_mag ? [`彈匣裡要有 ${atk.min_mag} 格以上才能連射。`] : []
  return w.mag && w.mag.now < 1 ? ['彈匣空了，要先換彈。'] : []
}

const TARGET_KIND = { enemy: 'foe', ally: 'ally', self: 'none', none: 'none', ally_slot: 'ally_slot', enemy_slot: 'foe_slot' } as const

function targetsOf(view: BattleView, u: BattleUnit, ab: AbilityEntry): BattleTargetOption[] {
  const m = ab.meat!
  const atk = m.attack
  const needsUnit = !!(m.attack || m.apply)
  switch (m.target) {
    case 'enemy':
      return unitsOf(view.battle, otherSide(u.side)).map((t) => {
        const w = wielded(u)
        return {
          target: { unit: t.id }, blocks: [],
          ...(atk && w ? { hint: { hit: view.hitChance(u, t, w, { aimed: atk.aimed, hit: atk.hit, tags: ['skill'] }) } } : {}),
        }
      })
    case 'ally':
      return unitsOf(view.battle, u.side).filter((t) => t.id !== u.id).map((t) => ({ target: { unit: t.id }, blocks: [] }))
    case 'ally_slot':
    case 'enemy_slot': {
      const side = m.target === 'ally_slot' ? u.side : otherSide(u.side)
      return Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).map((slot) => ({ target: { side, slot }, blocks: needsUnit && !unitAt(view.battle, side, slot) ? ['那一格沒有人。'] : [] }))
    }
    default:
      return []
  }
}

function unitOfTarget(run: BattleRun, u: BattleUnit, ab: AbilityEntry, target: BattleTarget | null): BattleUnit | undefined {
  if (ab.meat?.target === 'self') return u
  if (!target) return undefined
  if ('unit' in target) return run.unit(target.unit)
  if ('slot' in target && 'side' in target) return unitAt(run.battle, target.side, target.slot)
  return undefined
}

/** 主動技能的 attack：照鍵組出 run.attack 的選項，打完之後的壓制。 */
function doAttack(run: BattleRun, u: BattleUnit, ab: AbilityEntry, target: BattleUnit, part: unknown): void {
  const atk = ab.meat!.attack!
  const w = wielded(u)
  // 花掉的格數：spend 'all' 是彈匣現在的全部，否則 1 格
  const spent = atk.spend === 'all' ? (w?.mag?.now ?? 1) : 1
  const result = run.attack(u, target, {
    aimed: atk.aimed, hit: atk.hit, label: ab.name, tags: ['skill'],
    ...(atk.spend === 'all' ? { spend: spent } : {}),
    ...(atk.dice === 'spent_minus_1' ? { dice: spent - 1 } : {}),
    ...(typeof part === 'string' ? { part } : {}),
  })
  const sup = atk.suppress
  if (sup && !result.aborted && !target.out && onField(target)) {
    const dc = sup.dc === 'spent' ? 10 + spent * 2 : sup.dc
    if (!run.save(target, 'resolve', sup.skill as SkillId, dc, '定力').ok) run.applyStatus(target, 'suppressed', { by: u })
  }
}

/** 換個位子嘛：選的隊友和另一名相鄰的隊友交換位置，不花他們的行動點。 */
function doSwap(run: BattleRun, u: BattleUnit, target: BattleUnit, withId: unknown): void {
  const mate = typeof withId === 'string' ? run.battle.units[withId] : undefined
  if (!mate || mate.id === u.id || mate.id === target.id || mate.side !== u.side || !onField(mate) || Math.abs(mate.slot - target.slot) !== 1) throw new BattleBlocked(['要選兩名相鄰的隊友。'])
  run.move(target, mate.slot)
}

/** 主動技能的圖示：瞄準過的一槍是準星（aim），把彈匣打光的是連射（burst），其餘是技能的晶片（skill）。 */
const iconOf = (m: MeatDef): string => (m.attack?.spend === 'all' ? 'burst' : m.attack?.aimed ? 'aim' : 'skill')

/** 主動技能除了目標還要選的東西：瞄準過的一槍可以指定部位（pick.part）；換個位子嘛要選另一名相鄰的隊友（pick.with）。 */
function picksOf(view: BattleView, u: BattleUnit, ab: AbilityEntry): BattlePick[] {
  const m = ab.meat!
  const out: BattlePick[] = []
  if (m.attack?.aimed) {
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
  return out
}

function skillAction(ab: AbilityEntry, order: number): BattleActionDef {
  const m = ab.meat!
  return {
    id: ab.id, owner: OWNER, name: ab.name, desc: ab.text, group: 'skill', icon: iconOf(m), modes: ['meat'],
    target: TARGET_KIND[m.target ?? 'none'], order,
    has: (_v, u) => hasAbility(u, ab.id),
    // 技能自己的行動點；別的被動技能給的減免（meat.cost）是花費的修正，核心會加上去
    cost: () => ({ ap: ab.use?.ap ?? 1 }),
    blocks: (v, u) => [...usageBlocks(v, u, ab), ...(m.attack ? attackBlocks(u, m.attack) : [])],
    targets: (v, u) => targetsOf(v, u, ab),
    ...(m.attack?.aimed || m.free_move?.swap_adjacent_pair ? { picks: (v: BattleView, u: BattleUnit) => picksOf(v, u, ab) } : {}),
    run(run, u, target, input) {
      bumpUses(u, ab)
      run.say(`${u.name}：${ab.name}。`, 'skill', { unit: u.id, ability: ab.id }, u)
      const t = unitOfTarget(run, u, ab, target)
      if ((m.attack || m.apply || m.free_move) && !t) throw new BattleBlocked(['那一格沒有人。'])
      if (m.attack) doAttack(run, u, ab, t!, input.pick?.part)
      for (const a of m.apply ?? []) run.applyStatus(t!, a.status, { by: u, ...(a.until ? { until: a.until } : {}) })
      if (m.free_move?.swap_adjacent_pair) doSwap(run, u, t!, input.pick?.with)
    },
  }
}

// ---- 掮客的招牌：指揮與叫人 ----

function giveApAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.give_ap`
  const limit = (u: BattleUnit) => 1 + Math.floor(tierIn(u, ab.path) / 2)
  return {
    id, owner: OWNER, name: '指揮', desc: '把自己的行動點讓給一名隊友，1 點換 1 點。', group: 'skill', icon: 'skill', modes: ['meat'], target: 'ally', order,
    has: (_v, u) => hasAbility(u, ab.id),
    cost: () => ({ ap: 1 }),
    blocks: (_v, u) => ((u.uses[`turn:${id}`] ?? 0) >= limit(u) ? [`這一回合已經讓了 ${limit(u)} 點，不能再讓。`] : []),
    targets: (v, u) => unitsOf(v.battle, u.side).filter((t) => t.id !== u.id).map((t) => ({ target: { unit: t.id }, blocks: t.ap.now >= t.ap.max ? ['他的行動點已經滿了。'] : [] })),
    run(run, u, target) {
      if (!target || !('unit' in target)) return
      const t = run.unit(target.unit)
      u.uses[`turn:${id}`] = (u.uses[`turn:${id}`] ?? 0) + 1
      t.ap.now = Math.min(t.ap.max, t.ap.now + 1)
      run.say(`${u.name}：指揮，把 1 點行動點讓給 ${t.name}。`, 'skill', { unit: u.id, ability: ab.id, to: t.id }, u)
    },
  }
}

/**
 * 叫人的支援射擊：名冊上的人開一槍，走一般的攻擊（`run.attack`：自然 1／20、要害、傷到那一格的遮蔽、hit／miss／crit 的紀錄都和別的射擊一樣）。
 * 數字是 SKILL_TREES 人面的叫人的暫定值：命中加值 4 ＋ 場景的等級 × 2，傷害 3 ＋ 等級骰顆 d6 的物理傷害（dev/adr/0013 D12）。
 * 用一把臨時的武器：不扣距離（和無人機一樣）、不吃彈匣、打遮蔽的倍率照手槍（×0.25，同為 3d6 的基礎）。
 */
function supportWeapon(run: BattleRun): BattleWeapon {
  return {
    id: 'support', name: '支援', class: 'support', dice: 3 + gradeDice(run.battle.grade), flat: 0, type: 'physical', range: [1, 7], pierce: 0,
    hit: 4 + run.battle.grade * 2, attr: 'charm', skill: 'streetwise', coverMult: 0.25, traits: [],
  }
}

const CALL_NAME: Record<string, string> = { cover_up: '補遮蔽：替我方一格補一級遮蔽', cover_down: '拆遮蔽：拆掉敵方一格的一級遮蔽', shot: '支援射擊：朝一個敵人開一槍' }

function callAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.call`
  const call = ab.meat!.call!
  const times = (u: BattleUnit) => Math.ceil(tierIn(u, ab.path) / 2)
  const slots = (side: 'ally' | 'foe'): BattleTarget[] => Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ side, slot: i + 1 }))
  return {
    id, owner: OWNER, name: '叫人', desc: '叫一個沒有上場的人出手一次：替我方一格補一級遮蔽、拆掉敵方一格的一級遮蔽，或支援射擊。', group: 'skill', icon: 'skill', modes: ['meat'], order,
    // 目標有三種（我方的格、敵方的格、一個敵人），看選了哪一件事（pick.option）；列出來讓核心驗：不在這張表上的目標直接擋下
    target: 'mixed',
    targets: (v, u) => [
      ...(call.options.includes('cover_up') ? slots(u.side).map((target) => ({ target, blocks: [] as string[] })) : []),
      // 敵方的格只有拆遮蔽用得到：沒有遮蔽的格列出來、寫出原因
      ...(call.options.includes('cover_down') ? slots(otherSide(u.side)).map((target) => ({ target, blocks: 'slot' in target && coverAt(v.battle, target.side, target.slot).level < 1 ? ['這一格沒有遮蔽可以拆。'] : [] })) : []),
      ...(call.options.includes('shot') ? unitsOf(v.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id } as BattleTarget, blocks: [] as string[] })) : []),
    ],
    // 叫人做哪一件事（pick.option）：每一件事各自適用的目標寫在 for
    picks: (v, u): BattlePick[] => [{
      key: 'option', label: '叫人做什麼', kind: 'choice', required: true,
      options: call.options.map((o) => ({
        value: o, label: CALL_NAME[o] ?? o, blocks: [],
        for: o === 'cover_up' ? slots(u.side)
          : o === 'cover_down' ? slots(otherSide(u.side)).filter((t) => 'slot' in t && coverAt(v.battle, t.side, t.slot).level >= 1)
            : unitsOf(v.battle, otherSide(u.side)).map((t): BattleTarget => ({ unit: t.id })),
      })),
    }],
    has: (_v, u) => hasAbility(u, ab.id),
    cost: () => ({ ap: call.ap }),
    blocks: (_v, u) => ((u.uses[id] ?? 0) >= times(u) ? [`這一場叫人的次數用完了（${times(u)} 次）。`] : []),
    run(run, u, _target, input) {
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
        run.attack(u, foe, { weapon: supportWeapon(run), label: '射擊', spend: 0 })
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
    if (ab.kind === 'active' && m.target) k.battle.action(skillAction(ab, order))
    if (m.give_ap) k.battle.action(giveApAction(ab, order))
    if (m.call) k.battle.action(callAction(ab, order))
  })
}

// ---- 掛點與修正 ----

/** 反應：隊友被攻擊、擲命中之前（SKILL_TREES：掩護射擊、小心後面！）。 */
function react(run: BattleRun, attacker: BattleUnit, target: BattleUnit, opts: { evade?: number; hit?: number; tags?: string[] }): void {
  if (opts.tags?.includes('reaction') || attacker.side === target.side) return
  for (const mate of unitsOf(run.battle, target.side)) {
    if (mate.id === target.id) continue
    if (!onField(mate)) continue
    for (const ab of equippedOf(run, mate)) {
      const m = ab.meat
      if (!m?.trigger) continue
      if (attacker.out || target.out || run.over) return
      if (m.trigger === 'ally_attacked_adjacent' && Math.abs(mate.slot - target.slot) !== 1) continue
      const use = ab.use
      if (use?.per_turn !== undefined && (mate.uses[`turn:${ab.id}`] ?? 0) >= use.per_turn) continue
      if (use?.per_fight !== undefined && (mate.uses[ab.id] ?? 0) >= use.per_fight) continue
      const ap = use?.ap ?? 1
      if (!run.canAfford(mate, { ap })) continue
      if (m.attack) {
        const w = heldGun(mate)
        if (!w || (w.mag && w.mag.now < 1)) continue
      }
      run.spend(mate, { ap })
      bumpUses(mate, ab)
      run.say(`${mate.name}：${ab.name}。`, 'skill', { unit: mate.id, ability: ab.id, ally: target.id }, mate)
      if (m.evade) opts.evade = (opts.evade ?? 0) + m.evade
      if (m.attack) {
        const r = run.attack(mate, attacker, { label: ab.name, tags: ['reaction'] })
        if (r.hit && m.on_hit?.hit_against_ally) opts.hit = (opts.hit ?? 0) + m.on_hit.hit_against_ally
      }
    }
  }
}

export function registerBattle(k: Kernel): void {
  // 單位剛組好：照開打那一刻填上裝著的技能與每棵樹的階；已經有資料的單位不動
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (!isRec(unit.ext.abilities) && unit.actor) {
      const mine = run.state.actors[unit.actor]?.ext.abilities
      const r = isRec(mine) ? mine : {}
      const tiers: Record<string, number> = {}
      if (isRec(r.spent)) for (const [path, v] of Object.entries(r.spent)) if (typeof v === 'number') tiers[path] = treeTierOf(v)
      unit.ext.abilities = { equipped: Array.isArray(r.equipped) ? r.equipped.filter((x) => typeof x === 'string') : [], tiers } satisfies UnitAbilities
    }
  })

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

  k.battle.on('attack.before', OWNER, ({ run, attacker, target, opts }) => react(run, attacker, target, opts))
}
