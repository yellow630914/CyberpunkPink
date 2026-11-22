// L6 功能 combat：攻擊類的行動（射擊、近戰、換彈、換武器、打遮蔽、監視）。COMBAT_SYSTEM 1.3 節與第 5 節。
// 只用核心的基本動作與唯讀的 BattleView；不碰 GameState。

import type { BattleActionDef, BattlePick, BattleTarget, BattleUnit, BattleView, BattleWeapon } from '../../core'
import { BattleBlocked, distance, otherSide, unitsOf, wielded } from '../../core'
import type { AmmoItem } from './fx'

const OWNER = 'combat'
const MODES = ['meat']

const isMelee = (w: BattleWeapon | undefined): boolean => !!w?.traits.includes('melee')
const magEmpty = (w: BattleWeapon): boolean => !!w.mag && w.mag.now <= 0

/** 射擊與近戰共用的 AI 分數基準（ENEMIES 4.3 節）：命中率低於 35% 時 1，否則 2；打掩體裡的人，霰彈槍與重武器再 +0.5。 */
function attackScore(view: BattleView, u: BattleUnit, t: BattleUnit | null): number | null {
  const w = wielded(u)
  if (!t || !w) return null
  let score = view.hitChance(u, t) < 35 ? 1 : 2
  if (view.coverOf(t) === 2 && (w.class === 'shotgun' || w.class === 'heavy')) score += 0.5
  return score
}

/** 掃射做不到的原因（輕機槍才有；COMBAT_SYSTEM 第 5 節）：宣告（picks）與行動本身（run）共用。 */
const sweepBlocks = (w: BattleWeapon | undefined): string[] => (!w?.traits.includes('sweep') ? ['這把武器不能掃射。'] : w.mag && w.mag.now < 2 ? ['掃射要彈匣裡有 2 格。'] : [])

const shoot: BattleActionDef = {
  id: 'shoot', owner: OWNER, name: '射擊', desc: '用手上的槍打一個敵人，每打一槍消耗彈匣一格；狙擊槍的一槍要花 3 點行動點。',
  group: 'attack', icon: 'shoot', tags: ['weapon_attack'], order: 1, target: 'foe', modes: MODES,
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
  // 掃射（pick.sweep）：手上的武器能掃射才列出來；只能打人
  picks: (view, u): BattlePick[] => {
    const w = wielded(u)
    if (!w?.traits.includes('sweep')) return []
    const people: BattleTarget[] = unitsOf(view.battle, otherSide(u.side)).map((t) => ({ unit: t.id }))
    return [{ key: 'sweep', label: '掃射', kind: 'toggle', required: false, options: [{ value: true, label: '掃射：花彈匣 2 格；不管有沒有打中，目標要過定力豁免，沒過就被壓制', blocks: sweepBlocks(w), for: people }] }]
  },
  run: (run, u, target, input) => {
    if (!target) return
    const sweep = input.pick?.sweep === true
    if (sweep) {
      if ('overlay' in target) throw new BattleBlocked(['掃射只能打人，不能打和人重疊的東西。'])
      const why = sweepBlocks(wielded(u))
      if (why.length) throw new BattleBlocked(why)
    }
    // 卡彈與炸膛（fx.on_use）、武器的附帶效果與特殊彈的欄位都在核心的 attack.before 掛點裡（打人與打掛著的東西一樣）
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
    const r = run.attack(u, t, { spend: 2, label: '掃射', tags: ['sweep'] })
    // 卡彈或炸膛：這一擊沒有打出去，也就沒有壓制
    if (r.cancelled !== undefined) return
    // 不管有沒有打中，目標還在場上就要過定力豁免，沒過就被壓制
    if (!t.out && t.slot >= 1) {
      const s = run.save(t, 'resolve', 'composure', 14, '定力', [], ['resist:suppressed'])
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
  group: 'attack', icon: 'melee', tags: ['weapon_attack'], order: 2, target: 'foe', modes: MODES,
  cost: () => ({ ap: 2 }),
  blocks: (_v, u) => (isMelee(wielded(u)) ? [] : ['手上不是近戰武器。']),
  targets: (view, u) => unitsOf(view.battle, otherSide(u.side)).map((t) => ({
    target: { unit: t.id },
    blocks: distance(u, t) !== 1 ? ['近戰只能打近身（雙方的第 1 格）。'] : [],
    hint: { chance: view.hitChance(u, t), distance: distance(u, t) },
  })),
  run: (run, u, target) => {
    if (!target || !('unit' in target)) return
    run.attack(u, run.unit(target.unit))
  },
  auto: (run, u, t) => {
    if (!isMelee(wielded(u)) || distance(u, t) !== 1) return false
    run.attack(u, t, { label: '監視攻擊', tags: ['watch'] })
    return true
  },
  aiScore: attackScore,
}

/** 快取格裡裝得進這把武器的特殊彈（物品有 ammo 欄位、fits 包含這把的類型、數量大於 0）。 */
function fittingAmmo(view: Pick<BattleView, 'k'>, u: BattleUnit, w: BattleWeapon): Array<{ id: string; qty: number; item: AmmoItem }> {
  const out = []
  for (const q of u.quick) {
    if (q.qty <= 0) continue
    const item = view.k.content.get<AmmoItem>('item', q.item)
    if (item?.ammo?.fits.includes(w.class)) out.push({ id: q.item, qty: q.qty, item })
  }
  return out
}

const reload: BattleActionDef = {
  id: 'reload', owner: OWNER, name: '換彈', desc: '把手上這把武器的彈匣補滿；可以選快取格裡的一匣特殊彈，沒選就裝普通彈。',
  group: 'supply', icon: 'reload', order: 1, target: 'none', modes: MODES,
  cost: () => ({ ap: 1 }),
  blocks: (view, u) => {
    const w = wielded(u)
    if (!w?.mag) return ['這把武器不用換彈。']
    // 彈匣是滿的：裝著特殊彈（可以換回普通彈）或快取格裡有合用的特殊彈（可以換彈種）時還是可以換
    return w.mag.now >= w.mag.max && !w.ammo && fittingAmmo(view, u, w).length === 0 ? ['彈匣是滿的。'] : []
  },
  // 裝哪一種彈（pick.ammo）：快取格裡 fits 包含手上這一把的類型的彈才列；可以不選（裝普通彈）
  picks: (view, u): BattlePick[] => {
    const w = wielded(u)
    if (!w?.mag) return []
    const list = fittingAmmo(view, u, w)
    if (!list.length) return []
    return [{
      key: 'ammo', label: '裝哪一種彈', kind: 'choice', required: false,
      options: list.map((x) => ({
        value: x.id, label: `${x.item.name} ×${x.qty}`,
        blocks: w.ammo === x.id && w.mag!.now >= w.mag!.max ? ['彈匣裡已經是這種彈，而且是滿的。'] : [],
        hint: { qty: x.qty },
      })),
    }]
  },
  run: (run, u, _t, input) => {
    const w = wielded(u)
    if (!w?.mag) return
    const want = input.pick?.ammo
    if (want === undefined) {
      if (w.mag.now >= w.mag.max && !w.ammo) throw new BattleBlocked(['彈匣是滿的。'])
      // 沒選：裝普通彈，原本裝著的特殊彈剩下的格數作廢
      w.mag.now = w.mag.max
      delete w.ammo
      run.say(`${u.name} 換彈。`, 'reload', { unit: u.id }, u)
      return
    }
    const found = typeof want === 'string' ? fittingAmmo(run, u, w).find((x) => x.id === want) : undefined
    if (!found) throw new BattleBlocked(['快取格裡沒有裝得進這把武器的這種彈。'])
    if (w.ammo === found.id && w.mag.now >= w.mag.max) throw new BattleBlocked(['彈匣裡已經是這種彈，而且是滿的。'])
    // 用掉一件，彈匣裝滿；原本裝著的特殊彈剩下的格數作廢
    const slot = u.quick.find((q) => q.item === found.id)!
    slot.qty -= 1
    if (slot.qty <= 0) u.quick = u.quick.filter((q) => q.qty > 0)
    w.mag.now = w.mag.max
    w.ammo = found.id
    run.say(`${u.name} 換彈，裝上${found.item.name}。`, 'reload', { unit: u.id, ammo: found.id }, u)
  },
  aiScore: (_v, u) => {
    const w = wielded(u)
    return !w?.mag ? null : w.mag.now === 0 ? 3 : w.mag.now === 1 && w.mag.max > 1 ? 1 : null
  },
}

const swap: BattleActionDef = {
  id: 'swap', owner: OWNER, name: '換武器', desc: '把手上的武器換成另一把；不指定的話換到下一把。',
  group: 'supply', icon: 'swap', order: 2, target: 'none', modes: MODES,
  cost: () => ({ ap: 1 }),
  blocks: (_v, u) => (u.weapons.length < 2 ? ['只有一把武器。'] : []),
  // 換上哪一把（pick.weapon：武器的位置）；不選就換到下一把
  picks: (_v, u): BattlePick[] => (u.weapons.length < 2 ? [] : [{
    key: 'weapon', label: '換上哪一把', kind: 'choice', required: false,
    options: u.weapons.map((w, i) => ({ value: i, label: w.name, blocks: i === u.wield ? ['這一把已經拿在手上。'] : [] })),
  }]),
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
  group: 'tactic', icon: 'cover', order: 2, target: 'foe_slot', modes: MODES,
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
  group: 'tactic', icon: 'watch', order: 3, target: 'none', modes: MODES,
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
