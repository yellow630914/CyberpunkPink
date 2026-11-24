// L6 功能 netcombat：內海的行動表（CYBERSPACE 6.3 節；圈與順序照 UI 第 5 節）。每一個都是 modes: ['net']。
//   內環  攻擊 net_attack、近戰 net_melee
//   中環  回填 net_refill、換構裝 net_swap、腳本 net_script
//   外環  打牆 net_hit_wall（N11）、監視 net_watch
//   （技能圈的工具構裝在 tools.ts，換檔在 sync.ts；釘住、拔線、投降是下一張工單）
// 只用核心的基本動作（run.attack、hurtCover、spend…）與唯讀的 BattleView；RAM 的花費由行動的 cost 交給核心扣，行動自己不扣。

import type { BattleActionDef, BattlePick, BattleRun, BattleTarget, BattleTargetOption, BattleUnit, BattleView, ItemEntry, Kernel } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, actionCost, distance, otherSide, unitTag, unitsOf, wielded } from '../../core'
import { JAM_NAME, JAM_SLOTS, MODES, OWNER, brokenOf, isJamSlot, isJammed, netcombatRules } from './model'

const isMelee = (w: { traits: string[] } | undefined): boolean => !!w?.traits.includes('melee')

/** 手上那一把武器構裝現在用不了的原因（沒有武器、被干擾停用、破損）：攻擊、近戰、打牆共用，一條一個條件。 */
function weaponBlocks(u: BattleUnit): string[] {
  const w = wielded(u)
  if (!w) return ['手上沒有武器構裝。']
  const out: string[] = []
  if (isJammed(u, 'weapon')) out.push('武器構裝被干擾停用了，這個回合不能攻擊。')
  if (brokenOf(u).includes(w.id)) out.push(`構裝「${w.name}」破損了，戰鬥結束前用不了。`)
  return out
}

/** 一次攻擊花的：行動點（武器自己寫的優先，沒有照規則表）與 RAM（武器的 pool.ram，沒寫 1）。 */
function weaponCost(u: BattleUnit, ap: number, ownAp = true): { ap: number; ram?: number } {
  const w = wielded(u)
  const ram = w ? (w.pool?.ram ?? 1) : 0
  return { ap: ownAp && w?.ap !== undefined ? w.ap : ap, ...(ram > 0 ? { ram } : {}) }
}

/** 攻擊與近戰共用的 AI 分數基準（現實的攻擊，ENEMIES 4.3 節）：命中率低於 35% 時 1，否則 2；打掩體裡的人，霰彈槍與重武器再 +0.5。 */
function attackScore(view: BattleView, u: BattleUnit, t: BattleUnit | null): number | null {
  const w = wielded(u)
  if (!t || !w) return null
  let score = view.hitChance(u, t) < 35 ? 1 : 2
  if (view.coverOf(t) === 2 && (w.class === 'shotgun' || w.class === 'heavy')) score += 0.5
  return score
}

/** 干擾的武器停用哪一類（pick.jam）：沒選（AI、監視）是武器。 */
function jamPick(input: { pick?: Record<string, unknown> }): string | undefined {
  const v = input.pick?.jam
  if (v === undefined) return undefined
  if (!isJamSlot(v)) throw new BattleBlocked([`沒有「${String(v)}」這一類構裝可以停用（可以選：${JAM_SLOTS.join('、')}）。`])
  return v
}

// ---- 攻擊與近戰 ----

const attack: BattleActionDef = {
  id: 'net_attack', owner: OWNER, name: '攻擊', desc: '用手上的武器構裝攻擊一個敵人，花 RAM；狙擊型的構裝一擊要花 3 點行動點。',
  group: 'attack', icon: 'shoot', tags: ['weapon_attack'], order: 1, target: 'foe', modes: MODES,
  cost: (view, u) => weaponCost(u, netcombatRules(view.k).ap.attack),
  blocks: (_v, u) => [...weaponBlocks(u), ...(isMelee(wielded(u)) ? ['手上是近戰構裝，要用近戰攻擊。'] : [])],
  targets: (view, u) => [
    ...unitsOf(view.battle, otherSide(u.side)).map((t) => ({ target: { unit: t.id } as BattleTarget, blocks: [] as string[], hint: { chance: view.hitChance(u, t), distance: distance(u, t) } })),
    ...view.battle.overlays.filter((o) => o.side === otherSide(u.side) && !o.down).map((o) => ({ target: { overlay: o.id } as BattleTarget, blocks: [] as string[] })),
  ],
  // 干擾的武器：命中時停用哪一類構裝（武器、防護、工具）由攻擊的人選
  picks: (_v, u): BattlePick[] => {
    if (!wielded(u)?.traits.includes('jam')) return []
    return [{ key: 'jam', label: '停用哪一類構裝', kind: 'choice', required: true, options: JAM_SLOTS.map((s) => ({ value: s, label: `${JAM_NAME[s]}構裝`, blocks: [] as string[] })) }]
  },
  run: (run, u, target, input) => {
    const why = [...weaponBlocks(u), ...(isMelee(wielded(u)) ? ['手上是近戰構裝，要用近戰攻擊。'] : [])]
    if (why.length) throw new BattleBlocked(why)
    if (!target) return
    const slot = jamPick(input)
    if ('overlay' in target) {
      const o = run.battle.overlays.find((x) => x.id === target.overlay)
      if (o) run.attackOverlay(u, o, { spend: 0 })
      return
    }
    if (!('unit' in target)) return
    const jam = wielded(u)!.traits.includes('jam')
    run.attack(u, run.unit(target.unit), { spend: 0, ...(jam && slot ? { tags: [`jam:${slot}`] } : {}) })
  },
  // 監視觸發：不花行動點，RAM 照扣；扣不起（或武器用不了）就繼續等
  auto: (run, u, t) => autoAttack(run, u, t, attack, false),
  aiScore: attackScore,
}

const melee: BattleActionDef = {
  id: 'net_melee', owner: OWNER, name: '近戰攻擊', desc: '用手上的近戰構裝打一個近身的敵人，雙方都要站在第 1 格；花 RAM。',
  group: 'attack', icon: 'melee', tags: ['weapon_attack'], order: 2, target: 'foe', modes: MODES,
  cost: (view, u) => weaponCost(u, netcombatRules(view.k).ap.melee, false),
  blocks: (_v, u) => [...weaponBlocks(u), ...(wielded(u) && !isMelee(wielded(u)) ? ['手上不是近戰構裝。'] : [])],
  targets: (view, u) => unitsOf(view.battle, otherSide(u.side)).map((t) => ({
    target: { unit: t.id } as BattleTarget,
    blocks: distance(u, t) !== 1 ? ['近戰只能打近身（雙方的第 1 格）。'] : [],
    hint: { chance: view.hitChance(u, t), distance: distance(u, t) },
  })),
  run: (run, u, target) => {
    const why = [...weaponBlocks(u), ...(wielded(u) && !isMelee(wielded(u)) ? ['手上不是近戰構裝。'] : [])]
    if (why.length) throw new BattleBlocked(why)
    if (!target || !('unit' in target)) return
    const jam = wielded(u)!.traits.includes('jam')
    run.attack(u, run.unit(target.unit), { spend: 0, ...(jam ? { tags: ['jam:weapon'] } : {}) })
  },
  auto: (run, u, t) => autoAttack(run, u, t, melee, true),
  aiScore: attackScore,
}

/** 監視觸發的那一擊：不花行動點，RAM 照常花；武器用不了、RAM 不夠、近戰打不到（不在近身）都不攻擊，監視留著。 */
function autoAttack(run: BattleRun, u: BattleUnit, t: BattleUnit, def: BattleActionDef, wantMelee: boolean): boolean {
  const w = wielded(u)
  if (!w || weaponBlocks(u).length || isMelee(w) !== wantMelee) return false
  if (wantMelee && distance(u, t) !== 1) return false
  const cost = actionCost(run, u, def)
  const ram = cost.ram ?? 0
  if (ram > 0 && (u.pools.ram?.now ?? 0) < ram) return false
  if (ram > 0) run.spend(u, { ram })
  const jam = w.traits.includes('jam')
  run.attack(u, t, { spend: 0, label: wantMelee ? '監視攻擊' : '監視射擊', tags: jam ? ['watch', 'jam:weapon'] : ['watch'] })
  return true
}

// ---- 回填、換構裝、腳本 ----

const ramRoom = (u: BattleUnit): number => (u.pools.ram ? u.pools.ram.max - u.pools.ram.now : 0)

const refill: BattleActionDef = {
  id: 'net_refill', owner: OWNER, name: '回填', desc: '把 RAM 補回 2 點（技能與構裝可以多補）；沒有彈匣，RAM 是內海的能量。',
  group: 'supply', icon: 'refill', order: 1, target: 'none', modes: MODES,
  cost: (view) => ({ ap: netcombatRules(view.k).ap.refill }),
  blocks: (_v, u) => (!u.pools.ram ? ['沒有 RAM 可以補。'] : ramRoom(u) <= 0 ? ['RAM 是滿的。'] : []),
  run: (run, u) => {
    const p = u.pools.ram
    if (!p) throw new BattleBlocked(['沒有 RAM 可以補。'])
    const want = Math.max(0, netcombatRules(run.k).refill + run.mods('refill', u).reduce((s, x) => s + x.value, 0))
    const got = Math.min(p.max - p.now, want)
    p.now += got
    run.say(`${u.name} 回填：RAM +${got}。`, 'support', { unit: u.id, ram: got }, u)
  },
  // RAM 不夠打一下的時候，回填的分數提高（和現實的換彈一樣：空了 3 分）
  aiScore: (view, u) => {
    const w = wielded(u)
    if (!u.pools.ram || !w) return null
    const need = (actionCost(view, u, attack).ram ?? 0)
    return u.pools.ram.now < need ? 3 : null
  },
}

const swap: BattleActionDef = {
  id: 'net_swap', owner: OWNER, name: '換構裝', desc: '把手上拿的武器構裝換成另一個；不指定的話換到下一個沒有破損的。',
  group: 'supply', icon: 'swap', order: 2, target: 'none', modes: MODES,
  cost: (view) => ({ ap: netcombatRules(view.k).ap.swap }),
  blocks: (_v, u) => (u.weapons.length < 2 ? ['只有一個武器構裝。'] : u.weapons.every((w, i) => i === u.wield || brokenOf(u).includes(w.id)) ? ['其他的武器構裝都破損了。'] : []),
  picks: (_v, u): BattlePick[] => (u.weapons.length < 2 ? [] : [{
    key: 'weapon', label: '換上哪一個', kind: 'choice', required: false,
    options: u.weapons.map((w, i) => ({ value: i, label: w.name, blocks: i === u.wield ? ['這一個已經拿在手上。'] : brokenOf(u).includes(w.id) ? ['這一個破損了，戰鬥結束前用不了。'] : [] })),
  }]),
  run: (run, u, _t, input) => {
    const broken = brokenOf(u)
    const want = input.pick?.weapon
    let to: number | undefined
    if (want !== undefined) {
      if (typeof want !== 'number' || !Number.isInteger(want) || want < 0 || want >= u.weapons.length || want === u.wield) throw new BattleBlocked(['沒有這個構裝。'])
      if (broken.includes(u.weapons[want]!.id)) throw new BattleBlocked(['這一個破損了，戰鬥結束前用不了。'])
      to = want
    } else {
      for (let i = 1; i < u.weapons.length; i++) {
        const at = (u.wield + i) % u.weapons.length
        if (!broken.includes(u.weapons[at]!.id)) {
          to = at
          break
        }
      }
    }
    if (to === undefined) throw new BattleBlocked(['其他的武器構裝都破損了。'])
    u.wield = to
    run.say(`${u.name} 換上構裝「${u.weapons[to]!.name}」。`, 'swap', { unit: u.id, weapon: u.weapons[to]!.class }, u)
  },
}

// 腳本：快取格裡帶進來的一次性程式（物品的 use）。做法同現實的使用道具：用掉一支、效果照 use.effects、對誰用看 use.target
type Script = { slot: { item: string; qty: number }; entry: ItemEntry & { use: NonNullable<ItemEntry['use']> } }

function scriptsOf(view: Pick<BattleView, 'k' | 'battle'>, u: BattleUnit): Script[] {
  const out: Script[] = []
  for (const slot of u.quick) {
    if (slot.qty <= 0) continue
    const entry = view.k.content.get<ItemEntry>('item', slot.item)
    if (!entry?.use) continue
    if (entry.use.modes && !entry.use.modes.includes(view.battle.mode)) continue
    out.push({ slot, entry: entry as Script['entry'] })
  }
  return out
}

const cellsOf = (side: 'ally' | 'foe'): BattleTarget[] => Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ side, slot: i + 1 }))

/**
 * 這支腳本和這個目標對不對得上：applies 是這一種目標它用得上（自己用的對自己、隊友用的對我方的人、對敵人用的對敵方的人、放在格子上的對那一方的格子）；
 * why 是用得上、但現在行不通的原因（隊友要相鄰、敵人要在距離裡）。
 */
function scriptAim(view: BattleView, u: BattleUnit, s: Script, t: BattleTarget): { applies: boolean; why: string | null } {
  const use = s.entry.use
  if ('unit' in t) {
    const x = view.battle.units[t.unit]
    if (!x) return { applies: false, why: null }
    if (x.side === u.side) {
      if (use.target === 'self') return { applies: x.id === u.id, why: null }
      if (use.target !== 'ally') return { applies: false, why: null }
      return { applies: true, why: x.id !== u.id && Math.abs(x.slot - u.slot) > 1 ? '要相鄰才用得到。' : null }
    }
    if (use.target !== 'foe') return { applies: false, why: null }
    if (use.range) {
      const d = distance(u, x)
      if (d < use.range[0] || d > use.range[1]) return { applies: true, why: `這支腳本只用得到距離 ${use.range[0] === use.range[1] ? use.range[0] : `${use.range[0]}～${use.range[1]}`} 的敵人，這個人的距離是 ${d}。` }
    }
    return { applies: true, why: null }
  }
  if ('slot' in t) {
    const mine = t.side === u.side
    return { applies: use.target === 'foe_slot' ? !mine : (use.target === 'ally_slot' || use.target === 'slot') && mine, why: null }
  }
  return { applies: false, why: null }
}

const script: BattleActionDef = {
  id: 'net_script', owner: OWNER, name: '腳本', desc: '從甲板帶來的腳本裡跑一支：一次性的程式，用在自己、相鄰的隊友、一個敵人或一格上，跑完就沒了；不花 RAM。',
  group: 'supply', icon: 'script', order: 3, target: 'unit', modes: MODES,
  cost: (view) => ({ ap: netcombatRules(view.k).ap.script }),
  blocks: (view, u) => [
    ...(scriptsOf(view, u).length ? [] : ['甲板裡沒有帶腳本。']),
    ...(isJammed(u, 'tool') ? ['工具被干擾停用了，腳本也跑不了。'] : []),
  ],
  // 跑哪一支（pick.item）：只有一種時可以不選
  picks: (view, u): BattlePick[] => {
    const list = scriptsOf(view, u)
    if (!list.length) return []
    return [{
      key: 'item', label: '跑哪一支腳本', kind: 'choice', required: list.length > 1,
      options: list.map((x) => ({ value: x.slot.item, label: `${x.entry.name} ×${x.slot.qty}`, blocks: [] as string[], hint: { qty: x.slot.qty, target: x.entry.use.target } })),
    }]
  },
  targets: (view, u) => {
    const list = scriptsOf(view, u)
    const cand: BattleTarget[] = [
      ...unitsOf(view.battle, u.side).map((t) => ({ unit: t.id })),
      ...unitsOf(view.battle, otherSide(u.side)).map((t) => ({ unit: t.id })),
      ...cellsOf(u.side), ...cellsOf(otherSide(u.side)),
    ]
    const out: BattleTargetOption[] = []
    for (const t of cand) {
      // 每一支各自看這個目標行不行：沒有一支用得上的目標不列；有一支行就行；用得上但都行不通，灰掉、寫出原因
      const asks = list.map((s) => scriptAim(view, u, s, t)).filter((x) => x.applies)
      if (!asks.length) continue
      out.push({ target: t, blocks: asks.some((x) => x.why === null) ? [] : [...new Set(asks.map((x) => x.why!))] })
    }
    return out
  },
  run: (run, u, target, input) => {
    if (isJammed(u, 'tool')) throw new BattleBlocked(['工具被干擾停用了，腳本也跑不了。'])
    const list = scriptsOf(run, u)
    let id = input.pick?.item
    if (id === undefined) {
      if (list.length !== 1) throw new BattleBlocked(['要選跑哪一支腳本。'])
      id = list[0]!.slot.item
    }
    const found = list.find((x) => x.slot.item === id)
    if (!found) throw new BattleBlocked(['甲板裡沒有這支腳本。'])
    if (!target) throw new BattleBlocked(['要選一個目標。'])
    const aim = scriptAim(run, u, found, target)
    if (!aim.applies) throw new BattleBlocked([`${found.entry.name}不是這樣用的。`])
    if (aim.why) throw new BattleBlocked([aim.why])
    const unit = 'unit' in target ? run.unit(target.unit) : undefined
    run.say(`${u.name} 跑${found.entry.name}${unit && unit.id !== u.id ? `，用在${unitTag(unit)}身上` : ''}。`, 'item', { unit: u.id, item: found.slot.item, target }, u)
    run.effects(found.entry.use.effects, { user: u, target, source: { kind: 'item', id: found.slot.item, name: found.entry.name }, pick: input.pick ?? {} })
    found.slot.qty -= 1
    if (found.slot.qty <= 0) u.quick = u.quick.filter((q) => q.qty > 0)
  },
}

// ---- 打牆、監視 ----

const wallBlocks = (u: BattleUnit): string[] => [...weaponBlocks(u), ...(isMelee(wielded(u)) ? ['近戰構裝打不了防火牆。'] : [])]

const hitWall: BattleActionDef = {
  id: 'net_hit_wall', owner: OWNER, name: '打牆', desc: '不打人，把攻擊打在敵人身前的防火牆節點上，把它打壞；花武器構裝的 RAM。干擾的武器打牆的倍率再 ×2。',
  group: 'tactic', icon: 'cover', order: 2, target: 'foe_slot', modes: MODES,
  cost: (view, u) => weaponCost(u, netcombatRules(view.k).ap.wall, false),
  blocks: (_v, u) => wallBlocks(u),
  targets: (view, u) => view.battle.cover[otherSide(u.side)]
    .map((c, i) => ({ c, slot: i + 1 }))
    .filter(({ c }) => c.level > 0 && !c.soft)
    .map(({ slot }) => ({ target: { side: otherSide(u.side), slot } as BattleTarget, blocks: [] as string[] })),
  run: (run, u, target) => {
    const why = wallBlocks(u)
    if (why.length) throw new BattleBlocked(why)
    const w = wielded(u)!
    if (!target || !('slot' in target)) return
    const rolled = run.d6(w.dice)
    const mult = Math.max(1, w.coverMult * 2) * (w.traits.includes('jam') ? netcombatRules(run.k).jam_wall_mult : 1)
    run.hurtCover(target.side, target.slot, rolled * mult, u)
  },
}

const watch: BattleActionDef = {
  id: 'net_watch', owner: OWNER, name: '監視', desc: '到你的下一回合開始前，第一次有敵人站上暴露的格子（防火牆被打成暴露也算），就自動攻擊他一次，不另花行動點，RAM 照常花。',
  group: 'tactic', icon: 'watch', order: 3, target: 'none', modes: MODES,
  cost: (view) => ({ ap: netcombatRules(view.k).ap.watch }),
  blocks: (_v, u) => [...(u.watch ? ['已經在監視了。'] : []), ...(wielded(u) ? [] : ['手上沒有武器構裝，沒有東西可以監視。'])],
  run: (run, u) => {
    u.watch = { action: isMelee(wielded(u)) ? melee.id : attack.id }
    run.say(`${u.name} 進入監視：敵人一站上暴露的格子就攻擊。`, 'watch', { unit: u.id }, u)
  },
  aiScore: (view, u) => {
    if (!wielded(u)) return null
    const foes = unitsOf(view.battle, otherSide(u.side))
    return foes.length > 0 && foes.every((t) => view.hitChance(u, t) < 35) ? 1.5 : null
  },
}

export const NET_ACTIONS: BattleActionDef[] = [attack, melee, refill, swap, script, hitWall, watch]

export function installActions(k: Kernel): void {
  for (const def of NET_ACTIONS) k.battle.action(def)
}
