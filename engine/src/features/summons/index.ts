// L6 功能 summons：機師的無人機（放出、指揮、移動、收回；攻擊、護盾、偵察、醫療、干擾五種）、把載具叫進來當掩體、
// 用拿下的控制節點改變戰場（關燈、放下防爆門）。COMBAT_SYSTEM 9.1、9.2、2.4、2.5 節；dev/work/M1-summons.md。
//
// 和人重疊的東西（無人機）、控制節點、場地效果與被擊落的接口都在核心（BattleOverlay、BattleNode、battle.field、overlay.down）；
// 這個功能只註冊行動、護盾型的被動修正與被擊落的後果；以及一台怎麼動：沒有操作者的每一輪自己動（auto.ts：敵方的無人機與砲塔、自律之後的）、
// 被電磁打到停一回合、砲塔（不能移動）。把東西掛上去、會指揮的敵人在 features/enemies（M1b-enemy-units）。機甲在 M6。
// 機師有哪些無人機與載具讀單位上的 ext.summons（裝備的功能之後會把它填上）；不 import 別的功能。
//
// 內海（M3-summons-net）：放出、指揮、移動、收回各有一份內海的（id 是 net_guard_*，名字與說明換成「守衛程式」；行動的名字與說明是靜態的，所以另外註冊，做的事和現實的同一份）。
// 型號資料帶 net: true 的只在內海列；內海同時連得住 1 個（不看同步）加 overlay_cap；指揮開火花的 RAM 照型號的 ram。叫車與控制節點只有現實。
//
// 一台無人機這一場的狀態記在操作者的 uses 裡：`drone:<索引>` 是 1（放出去了）或 2（被擊落了，這一場不能再放）；收回就清掉。

import type { BattleActionDef, BattleInput, BattleOverlay, BattlePick, BattleTarget, BattleTargetOption, BattleUnit, BattleView, Feature } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, actionCost, otherSide, overlayAt, poolShort, unitsOf } from '../../core'
import type { Layer } from './drones'
import { DRONE_CAP_BY_SYNC, DRONE_STATS, NEEDS_FOE, NET_CAP_BASE, OWNER, STUN_BLOCK, capBlock, capSentence, driveOnce, fielded, hang, isDrone, isKind, isStunned, kindName, layerOf, modelsFor, moveSlots, moveTo, noneSentence, ramOfOverlay, stateOf, usedSentence, vehicleOf, widestCap } from './drones'
import { registerHooks } from './hooks'
import { registerOps } from './ops'
import type { DroneDef, DroneKind, SummonsExt } from './drones'

export { DRONE_CAP_BY_SYNC, DRONE_STATS, NET_CAP_BASE }
export type { DroneDef, DroneKind, SummonsExt }

const allySlots = (u: BattleUnit, blocksOf: (slot: number) => string[]): BattleTargetOption[] =>
  Array.from({ length: BATTLE_SLOTS }, (_, i) => ({ target: { side: u.side, slot: i + 1 } as BattleTarget, blocks: blocksOf(i + 1) }))

/** 行動的目標要是我方的一格。 */
function slotOf(u: BattleUnit, target: BattleTarget | null): number {
  if (!target || !('slot' in target) || target.side !== u.side || !Number.isInteger(target.slot) || target.slot < 1 || target.slot > BATTLE_SLOTS) throw new BattleBlocked(['要選我方的一格。'])
  return target.slot
}

/** 行動的目標要是自己的一台沒被擊落的無人機（內海：守衛程式）。 */
function droneOf(run: BattleView & { battle: { overlays: BattleOverlay[] } }, u: BattleUnit, target: BattleTarget | null): BattleOverlay {
  const o = target && 'overlay' in target ? run.battle.overlays.find((x) => x.id === target.overlay) : undefined
  if (!o || o.owner !== u.id || !isDrone(o) || o.down) throw new BattleBlocked([noneSentence(layerOf(run))])
  return o
}

/** 要選的敵人（pick.at）：還在場上的敵方單位。 */
function foeOf(view: BattleView, u: BattleUnit, input: { pick?: Record<string, unknown> }): BattleUnit {
  const id = input.pick?.at
  const t = typeof id === 'string' ? view.battle.units[id] : undefined
  if (!t || t.side !== otherSide(u.side) || t.slot < 1 || t.out) throw new BattleBlocked(['要選一個敵人。'])
  return t
}

const droneTargets = (view: BattleView, u: BattleUnit, spentCounts: boolean): BattleTargetOption[] =>
  fielded(view, u).map((o) => ({ target: { overlay: o.id }, blocks: spentCounts && o.used ? [usedSentence(layerOf(view))] : [] }))

const slotLabel = (slot: number): string => `第 ${slot} 格`

const COMMON = { owner: OWNER, group: 'skill' as const, cost: () => ({ ap: 1 }) }

/** 這個戰場有沒有可以放的型號（內海只數帶 net: true 的，現實只數沒帶的）。 */
const hasModels = (view: BattleView, u: BattleUnit): boolean => modelsFor(view, u).length > 0

/** 這一種現在放不放得下：整個動作放不下時由動作本身擋（blocks），這裡只管「這一種放不下、別種還放得下」。 */
function kindBlock(view: BattleView, u: BattleUnit, kind: string): string[] {
  if (fielded(view, u).filter((o) => !o.ext?.overCap).length >= widestCap(view, u)) return []
  const why = capBlock(view, u, kind)
  return why ? [why] : []
}

/** 指揮這一台要花的：1 點行動點；內海的型號寫了 ram 就再花那麼多 RAM（目標選了才知道是哪一台）。 */
function commandCost(view: BattleView, _u: BattleUnit, input?: BattleInput): { ap: number; ram?: number } {
  const t = input?.target
  const o = t && 'overlay' in t ? view.battle.overlays.find((x) => x.id === t.overlay) : undefined
  const ram = ramOfOverlay(view, o)
  return ram > 0 ? { ap: 1, ram } : { ap: 1 }
}

/**
 * 放出、指揮、移動、收回：現實（drone.*）與內海（net_guard_*）各一份。做的事相同，差在 modes、名字與說明、列哪些型號、內海的句子與 RAM。
 * 行動的名字與說明是靜態的，所以內海另外註冊（id 用 net_ 開頭，和 features/netcombat 的行動表同一個慣例）。
 */
function droneActions(layer: Layer): BattleActionDef[] {
  const net = layer === 'net'
  const id = (name: string): string => (net ? `net_guard_${name}` : `drone.${name}`)
  const thing = net ? '守衛程式' : '無人機'
  const modes = [layer]

  const deploy: BattleActionDef = {
    ...COMMON, id: id('deploy'), name: '放出', icon: 'drone_deploy', order: 1, target: 'ally_slot', modes,
    desc: net
      ? '放出一個守衛程式，掛在我方的一格上：和那一格的人重疊，不佔格，永遠暴露。內海裡同時只連得住一個，不看同步。'
      : '放出一台無人機，掛在我方的一格上：和那一格的人重疊，不佔格，永遠暴露。連得住幾台看同步。',
    has: hasModels,
    // 放哪一個型號（pick.drone：這個人帶的第幾個，索引照全部型號數）；這個戰場列不出來的型號（內海只列 net: true、現實只列沒帶的）不出現；放出去的、被擊落的照樣列出來，寫出原因。
    // 多工連結多出來的一台只給支援型：攻擊型、干擾型放不下時，那一項灰掉、寫出原因
    picks: (view, u): BattlePick[] => [{
      key: 'drone', label: net ? '放出哪一個' : '放出哪一台', kind: 'choice', required: true,
      options: modelsFor(view, u).map(({ def: d, idx: i }) => ({
        value: i, label: d.name ?? (isKind(d.kind) ? kindName(layer, d.kind) : String(d.kind)),
        blocks: !isKind(d.kind) ? ['不認得這一台的種類。'] : stateOf(u, i) === 1 ? [net ? '這個守衛程式已經放出去了。' : '這一台已經放出去了。'] : stateOf(u, i) === 2 ? [net ? '這個守衛程式被擊落了，這一場不能再放。' : '這一台被擊落了，這一場不能再放。'] : kindBlock(view, u, d.kind),
      })),
    }],
    blocks: (view, u) => {
      const out: string[] = []
      const cap = widestCap(view, u)
      if (fielded(view, u).filter((o) => !o.ext?.overCap).length >= cap) out.push(capSentence(view, u, cap))
      if (!modelsFor(view, u).some(({ idx }) => stateOf(u, idx) === 0)) out.push(`沒有可以放的${thing}了。`)
      return out
    },
    targets: (view, u) => allySlots(u, (slot) => (overlayAt(view.battle, u.side, slot) ? ['這一格已經掛著一台了。'] : [])),
    run: (run, u, target, input) => {
      const slot = slotOf(u, target)
      const idx = input.pick?.drone
      const def = typeof idx === 'number' && Number.isInteger(idx) ? modelsFor(run, u).find((m) => m.idx === idx)?.def : undefined
      if (!def || !isKind(def.kind) || stateOf(u, idx as number) !== 0) throw new BattleBlocked([noneSentence(layer)])
      const why = capBlock(run, u, def.kind)
      if (why) throw new BattleBlocked([why])
      // 掛上去交給核心：每格一台（這一格已經掛著一台了）、耐久與護甲與迴避問操作者的修正（overlay_hp、overlay_armor、overlay_evade）、記一拍
      hang(run, u, slot, { idx: idx as number })
    },
  }

  const command: BattleActionDef = {
    ...COMMON, id: id('command'), name: '指揮', icon: 'drone_command', order: 2, target: 'overlay', modes,
    desc: net
      ? '讓一個守衛程式做一次它的動作，命中用你的操縱：攻擊與干擾型開火（神經傷害，型號寫了 RAM 就花 RAM）、偵察型標記、醫療型替同一格的人排掉感載、護盾型替同一格的人擋下一次攻擊（到你的下一回合開始）。每個每回合一次。'
      : '讓一台無人機做一次它的動作，命中用你的操縱：攻擊與干擾型開火、偵察型標記、醫療型急救、護盾型替同一格的人擋下一次攻擊（到你的下一回合開始）。每台每回合一次。',
    has: hasModels,
    cost: commandCost,
    targets: (view, u) => fielded(view, u).map((o) => {
      const blocks = o.used ? [usedSentence(layer)] : isStunned(o) ? [STUN_BLOCK] : []
      // RAM 要看是哪一台才知道（花費與別人的減免都算進去）：不夠的那一台灰掉
      const ram = actionCost(view, u, command, { action: command.id, target: { overlay: o.id } }).ram ?? 0
      const have = u.pools.ram?.now ?? 0
      if (ram > have) blocks.push(poolShort('ram', ram, have))
      return { target: { overlay: o.id }, blocks }
    }),
    // 對誰（pick.at：敵人的單位 id）：攻擊、干擾、偵察型才要選；醫療型照顧同一格的人、護盾型守著同一格的人，不用選
    picks: (view, u): BattlePick[] => {
      const need: BattleTarget[] = fielded(view, u).filter((o) => NEEDS_FOE.includes(o.kind)).map((o) => ({ overlay: o.id }))
      if (!need.length) return []
      return [{ key: 'at', label: '對誰', kind: 'foe', required: true, options: unitsOf(view.battle, otherSide(u.side)).map((t) => ({ value: t.id, label: t.name, blocks: [], at: { unit: t.id }, for: need })) }]
    },
    run: (run, u, target, input) => {
      const o = droneOf(run, u, target)
      if (o.used) throw new BattleBlocked([usedSentence(layer)])
      driveOnce(run, u, o, NEEDS_FOE.includes(o.kind) ? { foe: foeOf(run, u, input) } : {})
      o.used = true
    },
  }

  const move: BattleActionDef = {
    ...COMMON, id: id('move'), name: '移動', icon: 'drone_move', order: 3, target: 'overlay', modes,
    desc: net ? '把一個守衛程式換到相鄰的格；那一格不能已經掛著別個。' : '把一台無人機換到相鄰的格；那一格不能已經掛著別台。',
    has: hasModels,
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
    run: (run, u, target, input) => moveTo(run, u, droneOf(run, u, target), input.pick?.slot),
  }

  const recall: BattleActionDef = {
    ...COMMON, id: id('recall'), name: '收回', icon: 'drone_recall', order: 4, target: 'overlay', modes,
    desc: net ? '把一個守衛程式收回來，之後可以再放出。' : '把一台無人機收回來，之後可以再放出。',
    has: hasModels,
    targets: (view, u) => droneTargets(view, u, false),
    run: (run, u, target) => {
      const o = droneOf(run, u, target)
      run.battle.overlays = run.battle.overlays.filter((x) => x.id !== o.id)
      // 臨時放出來的（蜂群）索引是 -1，沒有「在手上」的狀態可以清
      if ((o.ext!.drone as number) >= 0) delete u.uses[`drone:${o.ext!.drone as number}`]
      run.say(`${u.name} 收回${o.name}。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, recalled: true }, u)
    },
  }

  return [deploy, command, move, recall]
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
  id: 'node.use', owner: OWNER, name: '控制節點', group: 'tactic', icon: 'node', modes: ['meat'], order: 9, target: 'node',
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
    for (const def of [...droneActions('meat'), ...droneActions('net'), vehicleCall, nodeUse]) k.battle.action(def)
    // 效果：技能、接管、招牌行動叫無人機做事（drone.act、deploy、move、repair、smoke、ram、guard、escort）
    registerOps(k)
    // 被動的修正與掛點：護盾型的迴避、偵察型的 see_dark、護航編隊、守著、臨時機到期、被擊落的回灌
    registerHooks(k)
  },
}
