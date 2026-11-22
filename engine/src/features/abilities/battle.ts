// 把裝著的技能帶進現實戰鬥（dev/work/M1-abilities.md 第四節）：
// 單位上的資料（unit.ready）、主動技能變成行動（ready 裡照內容註冊）、掮客招牌的「指揮」與「叫人」、
// 被動與共鳴變成修正、反應掛在攻擊之前（掩護射擊、小心後面！）。
// 不 import 別的功能：技能自己用 run.attack，不呼叫 features/combat 的行動。

import type { BattleActionDef, BattleRun, BattleTarget, BattleTargetOption, BattleUnit, BattleView, CheckRoll, Kernel, RollPart, SkillId } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, computeDegree, coverAt, gradeDice, onField, otherSide, unitAt, unitsOf, verdictOf, wielded } from '../../core'
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

// ---- 行動的花費、次數與條件 ----

/** 這個技能的行動點：use.ap；裝著的被動技能的 meat.cost.ability 指向它時改用那個。 */
function apOf(view: Pick<BattleView, 'k'>, u: BattleUnit, ab: AbilityEntry): number {
  const override = equippedOf(view, u).find((x) => x.meat?.cost?.ability === ab.id)?.meat?.cost
  return override ? override.ap : (ab.use?.ap ?? 1)
}

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

function skillAction(ab: AbilityEntry, order: number): BattleActionDef {
  const m = ab.meat!
  return {
    id: ab.id, owner: OWNER, name: ab.name, desc: ab.text, group: 'skill', modes: ['meat'],
    target: TARGET_KIND[m.target ?? 'none'], order,
    has: (_v, u) => hasAbility(u, ab.id),
    cost: (v, u) => ({ ap: apOf(v, u, ab) }),
    blocks: (v, u) => [...usageBlocks(v, u, ab), ...(m.attack ? attackBlocks(u, m.attack) : [])],
    targets: (v, u) => targetsOf(v, u, ab),
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
    id, owner: OWNER, name: '指揮', desc: '把自己的行動點讓給一名隊友，1 點換 1 點。', group: 'skill', modes: ['meat'], target: 'ally', order,
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

/** 叫人的支援射擊：d20 ＋ 4 ＋ 場景的等級 × 2 對目標的迴避；打中造成 3 ＋ 等級骰顆 d6 的物理傷害（暫定，dev/adr/0013 D12）。 */
function supportShot(run: BattleRun, u: BattleUnit, t: BattleUnit): { hit: boolean; roll: CheckRoll } {
  const bonus = 4 + run.battle.grade * 2
  const natural = run.d20()
  const total = natural + bonus
  const dc = run.evadeOf(t).total
  const hit = total >= dc
  const degree = computeDegree(natural, total, dc)
  const roll: CheckRoll = { dice: '1d20', natural, parts: [{ label: '叫人', value: bonus, source: 'skill' }], total, dc, degree, verdict: verdictOf(degree, total - dc), margin: total - dc }
  if (hit) run.damage(t, run.d6(3 + gradeDice(run.battle.grade)), 'physical', u)
  return { hit, roll }
}

function callAction(ab: AbilityEntry, order: number): BattleActionDef {
  const id = `${ab.id}.call`
  const call = ab.meat!.call!
  const times = (u: BattleUnit) => Math.ceil(tierIn(u, ab.path) / 2)
  return {
    id, owner: OWNER, name: '叫人', desc: '叫一個沒有上場的人出手一次：替我方一格補一級遮蔽、拆掉敵方一格的一級遮蔽，或支援射擊。', group: 'skill', modes: ['meat'], target: 'none', order,
    has: (_v, u) => hasAbility(u, ab.id),
    cost: () => ({ ap: call.ap }),
    blocks: (_v, u) => ((u.uses[id] ?? 0) >= times(u) ? [`這一場叫人的次數用完了（${times(u)} 次）。`] : []),
    run(run, u, _target, input) {
      const option = input.pick?.option
      const t = input.target
      const bad = new BattleBlocked(['叫人要選一件事：補遮蔽、拆遮蔽，或支援射擊。'])
      if (typeof option !== 'string' || !(call.options as string[]).includes(option) || !t) throw bad
      let text = ''
      let roll: CheckRoll | undefined
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
        const foe = run.unit(t.unit)
        if (foe.side === u.side || !onField(foe)) throw bad
        const r = supportShot(run, u, foe)
        roll = r.roll
        text = `${u.name}：叫人，支援射擊${r.hit ? '命中' : '沒打中'} ${foe.name}。`
      } else throw bad
      u.uses[id] = (u.uses[id] ?? 0) + 1
      run.say(text, 'support', { unit: u.id, option }, u, roll)
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
  // 單位剛組好：照開打那一刻填上裝著的技能與每棵樹的階；已經有資料的單位不動。填完之後做開場的效果（weapon_cost）
  k.battle.on('unit.ready', OWNER, ({ run, unit }) => {
    if (!isRec(unit.ext.abilities) && unit.actor) {
      const mine = run.state.actors[unit.actor]?.ext.abilities
      const r = isRec(mine) ? mine : {}
      const tiers: Record<string, number> = {}
      if (isRec(r.spent)) for (const [path, v] of Object.entries(r.spent)) if (typeof v === 'number') tiers[path] = treeTierOf(v)
      unit.ext.abilities = { equipped: Array.isArray(r.equipped) ? r.equipped.filter((x) => typeof x === 'string') : [], tiers } satisfies UnitAbilities
    }
    if (!isRec(unit.ext.abilities)) return
    for (const ab of equippedOf(run, unit)) {
      const wc = ab.meat?.weapon_cost
      if (wc) for (const w of unit.weapons) if (w.traits.includes(wc.trait)) w.ap = wc.ap
    }
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
