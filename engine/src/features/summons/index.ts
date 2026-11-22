// L6 功能 summons：機師的無人機（放出、指揮、移動、收回；攻擊、護盾、偵察、醫療、干擾五種）、把載具叫進來當掩體、
// 用拿下的控制節點改變戰場（關燈、放下防爆門）。COMBAT_SYSTEM 9.1、9.2、2.4、2.5 節；dev/work/M1-summons.md。
//
// 和人重疊的東西（無人機）、控制節點、場地效果與被擊落的接口都在核心（BattleOverlay、BattleNode、battle.field、overlay.down）；
// 這個功能只註冊行動、護盾型的被動修正與被擊落的後果。機甲在 M6，敵方的無人機與砲塔、接管砲塔不在這一批。
// 機師有哪些無人機與載具讀單位上的 ext.summons（裝備的功能之後會把它填上）；不 import 別的功能。
//
// 一台無人機這一場的狀態記在操作者的 uses 裡：`drone:<索引>` 是 1（放出去了）或 2（被擊落了，這一場不能再放）；收回就清掉。

import type { BattleActionDef, BattleInput, BattleOverlay, BattlePick, BattleTarget, BattleTargetOption, BattleUnit, BattleView, BattleWeapon, DamageType, Feature } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, attrMod, gradeDice, otherSide, overlayAt, unitAt, unitsOf } from '../../core'

const OWNER = 'summons'

/** 同步幾級連得住幾台；索引是同步的級數 0～6（COMBAT_SYSTEM 9.1 節） */
export const DRONE_CAP_BY_SYNC = [1, 1, 2, 2, 3, 3, 4]
/** 無人機的生命與護甲，索引 0 是 I 級（ITEMS 3.2 節） */
export const DRONE_STATS = [{ hp: 14, armor: 1 }, { hp: 17, armor: 2 }, { hp: 20, armor: 3 }, { hp: 25, armor: 4 }]

export type DroneKind = 'attack' | 'shield' | 'scout' | 'medic' | 'jammer'
export interface DroneDef { kind: DroneKind; grade: 1 | 2 | 3 | 4; name?: string; item?: string }
export interface SummonsExt { drones?: DroneDef[]; vehicle?: { name: string; hp: [number, number] } }

const KIND_NAME: Record<DroneKind, string> = { attack: '攻擊無人機', shield: '護盾無人機', scout: '偵察無人機', medic: '醫療無人機', jammer: '干擾無人機' }
const isKind = (k: unknown): k is DroneKind => typeof k === 'string' && k in KIND_NAME

// ---- 讀單位上的資料 ----

const summonsOf = (u: BattleUnit): SummonsExt | undefined => {
  const s = u.ext.summons
  return s && typeof s === 'object' ? (s as SummonsExt) : undefined
}
const dronesOf = (u: BattleUnit): DroneDef[] => {
  const d = summonsOf(u)?.drones
  return Array.isArray(d) ? d : []
}
const vehicleOf = (u: BattleUnit): SummonsExt['vehicle'] => {
  const v = summonsOf(u)?.vehicle
  return v && typeof v === 'object' ? v : undefined
}
const gradeOf = (d: DroneDef): number => Math.min(4, Math.max(1, Math.round(Number(d.grade) || 1)))
const syncOf = (u: BattleUnit): number => Math.min(6, Math.max(0, Math.floor(u.skills.sync ?? 0)))

/** 索引 i 的那一台這一場的狀態：0 在手上、1 放出去了、2 被擊落了。 */
const stateOf = (u: BattleUnit, i: number): number => u.uses[`drone:${i}`] ?? 0
const isDrone = (o: BattleOverlay): boolean => typeof o.ext?.drone === 'number'
/** 這個人場上沒被擊落的無人機。 */
const fielded = (view: BattleView, u: BattleUnit): BattleOverlay[] => view.battle.overlays.filter((o) => o.owner === u.id && isDrone(o) && !o.down)

const allySlots = (u: BattleUnit, blocksOf: (slot: number) => string[]): BattleTargetOption[] =>
  Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ target: { side: u.side, slot: i + 1 } as BattleTarget, blocks: blocksOf(i + 1) }))

/** 行動的目標要是我方的一格。 */
function slotOf(u: BattleUnit, target: BattleTarget | null): number {
  if (!target || !('slot' in target) || target.side !== u.side || !Number.isInteger(target.slot) || target.slot < 1 || target.slot > BATTLE_SLOTS) throw new BattleBlocked(['要選我方的一格。'])
  return target.slot
}

/** 行動的目標要是自己的一台沒被擊落的無人機。 */
function droneOf(run: BattleView & { battle: { overlays: BattleOverlay[] } }, u: BattleUnit, target: BattleTarget | null): BattleOverlay {
  const o = target && 'overlay' in target ? run.battle.overlays.find((x) => x.id === target.overlay) : undefined
  if (!o || o.owner !== u.id || !isDrone(o) || o.down) throw new BattleBlocked(['沒有這一台無人機。'])
  return o
}

/** 要選的敵人（pick.at）：還在場上的敵方單位。 */
function foeOf(view: BattleView, u: BattleUnit, input: BattleInput): BattleUnit {
  const id = input.pick?.at
  const t = typeof id === 'string' ? view.battle.units[id] : undefined
  if (!t || t.side !== otherSide(u.side) || t.slot < 1 || t.out) throw new BattleBlocked(['要選一個敵人。'])
  return t
}

const droneTargets = (view: BattleView, u: BattleUnit, spentCounts: boolean): BattleTargetOption[] =>
  fielded(view, u).map((o) => ({ target: { overlay: o.id }, blocks: spentCounts && o.used ? ['這一台這一回合動過了。'] : [] }))

/** 指揮時要另外選一個敵人的那幾型（攻擊、干擾、偵察）；醫療型照顧同一格的人，護盾型不用指揮。 */
const NEEDS_FOE: readonly string[] = ['attack', 'jammer', 'scout']
/** 這一台可以換到哪幾格：相鄰、沒有掛著別台的。宣告（picks）與行動本身（run）共用。 */
const moveSlots = (view: BattleView, o: BattleOverlay): number[] => [o.slot - 1, o.slot + 1].filter((s) => s >= 1 && s <= BATTLE_SLOTS && !overlayAt(view.battle, o.side, s))
const slotLabel = (slot: number): string => `第 ${slot} 格`

const COMMON = { owner: OWNER, group: 'skill' as const, modes: ['meat'], cost: () => ({ ap: 1 }) }
const hasDrones = (_v: BattleView, u: BattleUnit): boolean => dronesOf(u).length > 0

// ---- 無人機的四個行動 ----

const deploy: BattleActionDef = {
  ...COMMON, id: 'drone.deploy', name: '放出', icon: 'drone_deploy', order: 1, target: 'ally_slot',
  desc: '放出一台無人機，掛在我方的一格上：和那一格的人重疊，不佔格，永遠暴露。連得住幾台看同步。',
  has: hasDrones,
  // 放哪一台（pick.drone：這個人帶的第幾台）；放出去的、被擊落的照樣列出來，寫出原因
  picks: (_v, u): BattlePick[] => [{
    key: 'drone', label: '放出哪一台', kind: 'choice', required: true,
    options: dronesOf(u).map((d, i) => ({
      value: i, label: d.name ?? (isKind(d.kind) ? KIND_NAME[d.kind] : String(d.kind)),
      blocks: !isKind(d.kind) ? ['不認得這一台的種類。'] : stateOf(u, i) === 1 ? ['這一台已經放出去了。'] : stateOf(u, i) === 2 ? ['這一台被擊落了，這一場不能再放。'] : [],
    })),
  }],
  blocks: (view, u) => {
    const out: string[] = []
    const sync = syncOf(u), cap = DRONE_CAP_BY_SYNC[sync]!
    if (fielded(view, u).length >= cap) out.push(`同步 ${sync} 級只連得住 ${cap} 台。`)
    if (!dronesOf(u).some((_, i) => stateOf(u, i) === 0)) out.push('沒有可以放的無人機了。')
    return out
  },
  targets: (view, u) => allySlots(u, (slot) => (overlayAt(view.battle, u.side, slot) ? ['這一格已經掛著一台了。'] : [])),
  run: (run, u, target, input) => {
    const slot = slotOf(u, target)
    const idx = input.pick?.drone
    const def = typeof idx === 'number' && Number.isInteger(idx) ? dronesOf(u)[idx] : undefined
    if (!def || !isKind(def.kind) || stateOf(u, idx as number) !== 0) throw new BattleBlocked(['沒有這一台無人機。'])
    if (overlayAt(run.battle, u.side, slot)) throw new BattleBlocked(['這一格已經掛著一台了。'])
    const grade = gradeOf(def), stats = DRONE_STATS[grade - 1]!
    const overlay: BattleOverlay = {
      id: `o${(run.battle.seq += 1)}`, side: u.side, slot, owner: u.id, kind: def.kind, name: def.name ?? KIND_NAME[def.kind],
      hp: { now: stats.hp, max: stats.hp }, armor: stats.armor, evade: run.n.evadeBase + 3, used: false, down: false,
      ...(def.item ? { item: def.item } : {}), ext: { drone: idx as number, grade },
    }
    run.battle.overlays.push(overlay)
    u.uses[`drone:${idx}`] = 1
    run.say(`${u.name} 放出${overlay.name}，掛在第 ${slot} 格。`, 'overlay', { overlay: overlay.id, kind: overlay.kind, slot }, u)
  },
}

/** 一台臨時的武器：攻擊型是物理、干擾型是電磁；命中用操作者的反應與操縱（COMBAT_SYSTEM 9.1 節）。 */
function droneWeapon(u: BattleUnit, o: BattleOverlay, type: DamageType): BattleWeapon {
  const grade = Number(o.ext?.grade) || 1
  return {
    id: 'drone', name: o.name, class: 'drone', dice: 2 + gradeDice(grade), flat: 0, type, range: [1, 7], pierce: 0,
    hit: attrMod(u.attrs.reflex) + (u.skills.piloting ?? 0), attr: 'reflex', skill: 'piloting', coverMult: 0.25, traits: [],
  }
}

const command: BattleActionDef = {
  ...COMMON, id: 'drone.command', name: '指揮', icon: 'drone_command', order: 2, target: 'overlay',
  desc: '讓一台無人機做一次它的動作，命中用你的操縱。每台每回合一次。',
  has: hasDrones,
  // 護盾型不用指揮：照樣列出來，寫出原因（它是被動的）
  targets: (view, u) => fielded(view, u).map((o) => ({ target: { overlay: o.id }, blocks: o.kind === 'shield' ? ['護盾無人機不用指揮：它替同一格的人擋著。'] : o.used ? ['這一台這一回合動過了。'] : [] })),
  // 對誰（pick.at：敵人的單位 id）：攻擊、干擾、偵察型才要選；醫療型照顧同一格的人，不用選
  picks: (view, u): BattlePick[] => {
    const need: BattleTarget[] = fielded(view, u).filter((o) => NEEDS_FOE.includes(o.kind)).map((o) => ({ overlay: o.id }))
    if (!need.length) return []
    return [{ key: 'at', label: '對誰', kind: 'foe', required: true, options: unitsOf(view.battle, otherSide(u.side)).map((t) => ({ value: t.id, label: t.name, blocks: [], at: { unit: t.id }, for: need })) }]
  },
  run: (run, u, target, input) => {
    const o = droneOf(run, u, target)
    if (o.used) throw new BattleBlocked(['這一台這一回合動過了。'])
    switch (o.kind) {
      case 'attack':
      case 'jammer': {
        const foe = foeOf(run, u, input)
        run.attack(u, foe, { weapon: droneWeapon(u, o, o.kind === 'jammer' ? 'em' : 'physical'), spend: 0, label: '無人機射擊', tags: ['drone'] })
        break
      }
      case 'scout': {
        const foe = foeOf(run, u, input)
        run.say(`${o.name}標記了${foe.name}。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, target: foe.id }, u)
        run.applyStatus(foe, 'marked', { by: u, until: 'source_turn_start' })
        break
      }
      case 'medic': {
        const mate = unitAt(run.battle, o.side, o.slot)
        if (!mate) throw new BattleBlocked(['那一格沒有人。'])
        run.say(`${o.name}替${mate.name}急救。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, target: mate.id }, u)
        run.heal(mate, run.d6(2))
        run.cleanse(mate, 'first_aid')
        break
      }
      case 'shield':
        throw new BattleBlocked(['護盾無人機不用指揮：它替同一格的人擋著。'])
      default:
        throw new BattleBlocked(['這一台現在做不了事。'])
    }
    o.used = true
  },
}

const move: BattleActionDef = {
  ...COMMON, id: 'drone.move', name: '移動', icon: 'drone_move', order: 3, target: 'overlay',
  desc: '把一台無人機換到相鄰的格；那一格不能已經掛著別台。',
  has: hasDrones,
  targets: (view, u) => fielded(view, u).map((o) => ({ target: { overlay: o.id }, blocks: moveSlots(view, o).length ? [] : ['相鄰的格都掛著別台了。'] })),
  // 換到哪一格（pick.slot）：每一格只對「換得過去的那幾台」適用
  picks: (view, u): BattlePick[] => {
    const drones = fielded(view, u)
    const options = Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1)
      .map((slot) => ({ slot, from: drones.filter((o) => moveSlots(view, o).includes(slot)).map((o): BattleTarget => ({ overlay: o.id })) }))
      .filter((x) => x.from.length > 0)
      .map((x) => ({ value: x.slot, label: slotLabel(x.slot), blocks: [], at: { side: u.side, slot: x.slot } as BattleTarget, for: x.from }))
    return options.length ? [{ key: 'slot', label: '換到哪一格', kind: 'ally_slot', required: true, options }] : []
  },
  run: (run, u, target, input) => {
    const o = droneOf(run, u, target)
    const to = input.pick?.slot
    if (typeof to !== 'number' || !moveSlots(run, o).includes(to)) {
      throw new BattleBlocked(['只能換到相鄰、沒有掛著別台的格。'])
    }
    const from = o.slot
    o.slot = to
    run.say(`${o.name}從第 ${from} 格換到第 ${to} 格。`, 'overlay', { overlay: o.id, kind: o.kind, from, slot: to }, u)
  },
}

const recall: BattleActionDef = {
  ...COMMON, id: 'drone.recall', name: '收回', icon: 'drone_recall', order: 4, target: 'overlay',
  desc: '把一台無人機收回來，之後可以再放出。',
  has: hasDrones,
  targets: (view, u) => droneTargets(view, u, false),
  run: (run, u, target) => {
    const o = droneOf(run, u, target)
    run.battle.overlays = run.battle.overlays.filter((x) => x.id !== o.id)
    delete u.uses[`drone:${o.ext!.drone as number}`]
    run.say(`${u.name} 收回${o.name}。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, recalled: true }, u)
  },
}

// ---- 載具 ----

const vehicleCall: BattleActionDef = {
  id: 'vehicle.call', owner: OWNER, name: '叫車', group: 'skill', icon: 'vehicle', modes: ['meat'], order: 5, target: 'ally_slot',
  desc: '把載具叫進來，開進我方的一格：那一格變成掩體，耐久比一般的高。被打爛了就是暴露。每場一次。',
  cost: () => ({ ap: 2 }),
  has: (_v, u) => !!vehicleOf(u),
  blocks: (_v, u) => (u.uses['vehicle.call'] ? ['這一場已經把車叫進來了。'] : []),
  targets: (_view, u) => allySlots(u, () => []),
  run: (run, u, target) => {
    const slot = slotOf(u, target)
    const v = vehicleOf(u)
    if (!v) throw new BattleBlocked(['沒有載具可以叫。'])
    const hp = Array.isArray(v.hp) && v.hp.length === 2 && v.hp.every((n) => Number.isFinite(n) && n > 0) ? ([v.hp[0], v.hp[1]] as [number, number]) : undefined
    run.raiseCover(u.side, slot, 2, hp)
    u.uses['vehicle.call'] = 1
    run.say(`${u.name} 把${v.name}叫進來，停在第 ${slot} 格。`, 'overlay', { vehicle: v.name, slot }, u)
  },
}

// ---- 控制節點 ----

const nodeUse: BattleActionDef = {
  id: 'node.use', owner: OWNER, name: '控制節點', group: 'tactic', icon: 'node', order: 9, target: 'node',
  desc: '用一個已經拿下的控制節點改變戰場：關燈（場地變成黑暗）、放下防爆門（替一格造出掩體）。',
  cost: () => ({ ap: 1 }),
  has: (view) => view.battle.nodes.length > 0,
  blocks: (view) => (view.battle.nodes.some((n) => n.taken) ? [] : ['還沒有拿下任何控制節點。']),
  targets: (view) => view.battle.nodes.map((n) => ({ target: { node: n.id }, blocks: !n.taken ? ['這個節點還沒有拿下。'] : n.used ? ['這個節點已經用掉了。'] : [] })),
  // 防爆門放在哪一格（pick.slot）：只有目標是防爆門的節點時才要選；關燈不用
  picks: (view, u): BattlePick[] => {
    const doors: BattleTarget[] = view.battle.nodes.filter((n) => n.kind === 'door').map((n) => ({ node: n.id }))
    if (!doors.length) return []
    return [{
      key: 'slot', label: '放在哪一格', kind: 'ally_slot', required: true,
      options: Array.from({ length: BATTLE_SLOTS }, (_, i) => i + 1).map((slot) => ({ value: slot, label: slotLabel(slot), blocks: [], at: { side: u.side, slot } as BattleTarget, for: doors })),
    }]
  },
  run: (run, u, target, input) => {
    const n = target && 'node' in target ? run.battle.nodes.find((x) => x.id === target.node) : undefined
    if (!n) throw new BattleBlocked(['沒有這個節點。'])
    if (!n.taken) throw new BattleBlocked(['這個節點還沒有拿下。'])
    if (n.used) throw new BattleBlocked(['這個節點已經用掉了。'])
    if (n.kind === 'light') {
      const dark = !!run.battle.field.dark
      if (dark) delete run.battle.field.dark
      else run.battle.field.dark = true
      run.say(`${u.name} 用${n.name}${dark ? '把燈打開了，黑暗解除。' : '關了燈，全場陷入黑暗：迴避 +2。'}`, 'field', { node: n.id, field: 'dark', on: !dark }, u)
    } else if (n.kind === 'door') {
      const slot = input.pick?.slot
      if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > BATTLE_SLOTS) throw new BattleBlocked(['要選放在哪一格。'])
      run.say(`${u.name} 用${n.name}放下防爆門，擋在第 ${slot} 格。`, 'node', { node: n.id, kind: n.kind, slot }, u)
      run.raiseCover(u.side, slot, 2)
      n.used = true
    } else {
      throw new BattleBlocked(['這個節點現在用不了。'])
    }
  },
}

export const summonsFeature: Feature = {
  id: OWNER,
  install(k) {
    for (const def of [deploy, command, move, recall, vehicleCall, nodeUse]) k.battle.action(def)
    // 護盾型：同一格的人迴避 +2（COMBAT_SYSTEM 9.1 節）
    k.battle.modifier(OWNER, (q) => {
      if (q.kind !== 'evade' || q.unit.slot < 1) return []
      const shielded = q.view.battle.overlays.some((o) => o.kind === 'shield' && !o.down && o.side === q.unit.side && o.slot === q.unit.slot)
      return shielded ? [{ label: '護盾無人機', value: 2, source: 'overlay' }] : []
    })
    // 被擊落：操作者感載 +5，這一場不能再放
    k.battle.on('overlay.down', OWNER, ({ run, overlay, by }) => {
      if (!isDrone(overlay)) return
      const owner = run.battle.units[overlay.owner]
      if (!owner) return
      owner.uses[`drone:${overlay.ext!.drone as number}`] = 2
      if (!owner.out && owner.slot > 0) run.addLoad(owner, 5, by, { exact: true, label: '無人機被擊落' })
    })

  },
}

