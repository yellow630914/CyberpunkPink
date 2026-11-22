// L6 功能 combat：攻擊類的行動（射擊、近戰、換彈、換武器、打遮蔽、監視）。COMBAT_SYSTEM 1.3 節與第 5 節。
// 只用核心的基本動作與唯讀的 BattleView；不碰 GameState。

import type { BattleActionDef, BattleUnit, BattleView, BattleWeapon } from '../../core'
import { BattleBlocked, coverAt, coverLevel, distance, otherSide, unitsOf, wielded } from '../../core'

const OWNER = 'combat'
const MODES = ['meat']

const isMelee = (w: BattleWeapon | undefined): boolean => !!w?.traits.includes('melee')
const magEmpty = (w: BattleWeapon): boolean => !!w.mag && w.mag.now <= 0

/** 射擊與近戰共用的 AI 分數基準（ENEMIES 4.3 節）：命中率低於 35% 時 1，否則 2；打掩體裡的人，霰彈槍與重武器再 +0.5。 */
function attackScore(view: BattleView, u: BattleUnit, t: BattleUnit | null): number | null {
  const w = wielded(u)
  if (!t || !w) return null
  let score = view.hitChance(u, t) < 35 ? 1 : 2
  if (coverLevel(coverAt(view.battle, t.side, t.slot)) === 2 && (w.class === 'shotgun' || w.class === 'heavy')) score += 0.5
  return score
}

const shoot: BattleActionDef = {
  id: 'shoot', owner: OWNER, name: '射擊', desc: '用手上的槍打一個敵人，每打一槍消耗彈匣一格；狙擊槍的一槍要花 3 點行動點。',
  group: 'attack', order: 1, target: 'foe', modes: MODES,
  cost: (_v, u) => ({ ap: wielded(u)?.ap ?? 2 }),
  blocks: (_v, u) => {
    const w = wielded(u)
    if (!w) return ['手上沒有武器。']
    if (isMelee(w)) return ['手上是近戰武器，不能射擊。']
    if (magEmpty(w)) return ['彈匣空了，要先換彈。']
    return []
  },
  targets: (view, u) => [
    ...unitsOf(view.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id }, blocks: [] as string[], hint: { chance: view.hitChance(u, t), distance: distance(u, t) } })),
    ...view.battle.overlays.filter((o) => o.side === otherSide(u.side) && !o.down).map((o) => ({ target: { overlay: o.id }, blocks: [] as string[] })),
  ],
  run: (run, u, target, input) => {
    if (!target) return
    const sweep = input.pick?.sweep === true
    if (sweep) {
      if ('overlay' in target) throw new BattleBlocked(['掃射只能打人，不能打和人重疊的東西。'])
      const w = wielded(u)!
      if (w.mag && w.mag.now < 2) throw new BattleBlocked(['掃射要彈匣裡有 2 格。'])
      if (!w.traits.includes('sweep')) throw new BattleBlocked(['這把武器不能掃射。'])
    }
    if ('overlay' in target) {
      const o = run.battle.overlays.find((x) => x.id === target.overlay)
      if (o) run.attackOverlay(u, o)
      return
    }
    if (!('unit' in target)) return
    const t = run.unit(target.unit)
    if (!sweep) {
      run.attack(u, t)
      return
    }
    run.attack(u, t, { spend: 2, label: '掃射', tags: ['sweep'] })
    // 不管有沒有打中，目標還在場上就要過定力豁免，沒過就被壓制
    if (!t.out && t.slot >= 1) {
      const s = run.save(t, 'resolve', 'composure', 14, '定力')
      if (!s.ok) run.applyStatus(t, 'suppressed', { by: u })
    }
  },
  auto: (run, u, t) => {
    const w = wielded(u)
    if (!w || isMelee(w) || magEmpty(w)) return false
    run.attack(u, t, { label: '監視射擊', tags: ['watch'] })
    return true
  },
  aiScore: attackScore,
}

const melee: BattleActionDef = {
  id: 'melee', owner: OWNER, name: '近戰攻擊', desc: '用手上的近戰武器打一個近身的敵人，雙方都要站在第 1 格。',
  group: 'attack', order: 2, target: 'foe', modes: MODES,
  cost: () => ({ ap: 2 }),
  blocks: (_v, u) => (isMelee(wielded(u)) ? [] : ['手上不是近戰武器。']),
  targets: (view, u) => unitsOf(view.battle, otherSide(u.side)).map((t) => ({
    target: { unit: t.id },
    blocks: distance(u, t) !== 1 ? ['近戰只能打近身（雙方的第 1 格）。'] : [],
    hint: { chance: view.hitChance(u, t), distance: distance(u, t) },
  })),
  run: (run, u, target) => {
    if (target && 'unit' in target) run.attack(u, run.unit(target.unit))
  },
  auto: (run, u, t) => {
    if (!isMelee(wielded(u)) || distance(u, t) !== 1) return false
    run.attack(u, t, { label: '監視攻擊', tags: ['watch'] })
    return true
  },
  aiScore: attackScore,
}

const reload: BattleActionDef = {
  id: 'reload', owner: OWNER, name: '換彈', desc: '把手上這把武器的彈匣補滿。',
  group: 'supply', order: 1, target: 'none', modes: MODES,
  cost: () => ({ ap: 1 }),
  blocks: (_v, u) => {
    const w = wielded(u)
    return !w?.mag ? ['這把武器不用換彈。'] : w.mag.now >= w.mag.max ? ['彈匣是滿的。'] : []
  },
  run: (run, u) => {
    const w = wielded(u)
    if (!w?.mag) return
    w.mag.now = w.mag.max
    run.say(`${u.name} 換彈。`, 'reload', { unit: u.id }, u)
  },
  aiScore: (_v, u) => {
    const w = wielded(u)
    return !w?.mag ? null : w.mag.now === 0 ? 3 : w.mag.now === 1 && w.mag.max > 1 ? 1 : null
  },
}

const swap: BattleActionDef = {
  id: 'swap', owner: OWNER, name: '換武器', desc: '把手上的武器換成另一把；不指定的話換到下一把。',
  group: 'supply', order: 2, target: 'none', modes: MODES,
  cost: () => ({ ap: 1 }),
  blocks: (_v, u) => (u.weapons.length < 2 ? ['只有一把武器。'] : []),
  run: (run, u, _t, input) => {
    const want = input.pick?.weapon
    let to = (u.wield + 1) % u.weapons.length
    if (want !== undefined) {
      if (typeof want !== 'number' || !Number.isInteger(want) || want < 0 || want >= u.weapons.length || want === u.wield) throw new BattleBlocked(['沒有這把武器。'])
      to = want
    }
    u.wield = to
    run.say(`${u.name} 換上${u.weapons[to]!.name}。`, 'swap', { unit: u.id, weapon: u.weapons[to]!.class }, u)
  },
}

const hitCover: BattleActionDef = {
  id: 'hit_cover', owner: OWNER, name: '打遮蔽', desc: '不打人，把子彈打在敵人身前的遮蔽上，把它打壞；每一次花彈匣一格。',
  group: 'tactic', order: 2, target: 'foe_slot', modes: MODES,
  cost: () => ({ ap: 2 }),
  blocks: (_v, u) => {
    const w = wielded(u)
    if (!w) return ['手上沒有武器。']
    if (isMelee(w)) return ['近戰武器打不了遮蔽。']
    if (magEmpty(w)) return ['彈匣空了，要先換彈。']
    return []
  },
  targets: (view, u) => view.battle.cover[otherSide(u.side)]
    .map((c, i) => ({ c, slot: i + 1 }))
    .filter(({ c }) => c.level > 0 && !c.soft)
    .map(({ slot }) => ({ target: { side: otherSide(u.side), slot }, blocks: [] as string[] })),
  run: (run, u, target) => {
    const w = wielded(u)
    if (!w || !target || !('slot' in target)) return
    if (w.mag) w.mag.now = Math.max(0, w.mag.now - 1)
    const rolled = run.d6(w.dice)
    run.hurtCover(target.side, target.slot, rolled * Math.max(1, w.coverMult * 2), u)
  },
}

const watch: BattleActionDef = {
  id: 'watch', owner: OWNER, name: '監視', desc: '到你的下一回合開始前，第一次有敵人站上暴露的格子，就自動朝他攻擊一次。',
  group: 'tactic', order: 3, target: 'none', modes: MODES,
  cost: () => ({ ap: 2 }),
  blocks: (_v, u) => (u.watch ? ['已經在監視了。'] : []),
  run: (run, u) => {
    u.watch = { action: isMelee(wielded(u)) ? 'melee' : 'shoot' }
    run.say(`${u.name} 進入監視：敵人一站上暴露的格子就攻擊。`, 'watch', { unit: u.id }, u)
  },
  aiScore: (view, u) => {
    if (!wielded(u)) return null
    const foes = unitsOf(view.battle, otherSide(u.side))
    return foes.length > 0 && foes.every((t) => view.hitChance(u, t) < 35) ? 1.5 : null
  },
}

export const ATTACK_ACTIONS: BattleActionDef[] = [shoot, melee, reload, swap, hitCover, watch]
