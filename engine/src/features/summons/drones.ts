// L6 功能 summons：無人機的共用部分（型別、常數、讀單位上的資料、放出、動一次、移動、守著）。
// index.ts 的行動與 ops.ts 的效果（drone.*）都用這裡的同一份，所以兩邊的數字、句子、錯誤一致。
// 一台無人機這一場的狀態記在操作者的 uses 裡：`drone:<索引>` 是 1（放出去了）或 2（被擊落了，這一場不能再放）；收回就清掉。
// 臨時放出來的（蜂群：不在 ext.summons.drones 裡）索引是 -1，不記 uses。

import type { AttackResult, BattleOverlay, BattleRun, BattleUnit, BattleView, BattleWeapon, DamageType } from '../../core'
import { BATTLE_SLOTS, BattleBlocked, attrMod, gradeDice, overlayAt, unitAt } from '../../core'

export const OWNER = 'summons'

/** 同步幾級連得住幾台；索引是同步的級數 0～6（COMBAT_SYSTEM 9.1 節） */
export const DRONE_CAP_BY_SYNC = [1, 1, 2, 2, 3, 3, 4]
/** 自己放的一台被擊落時，操作者受的感載（COMBAT_SYSTEM 9.1 節）；overlay_backlash 的修正加減在這上面 */
export const BACKLASH = 5
/** 無人機的生命與護甲，索引 0 是 I 級（ITEMS 3.2 節） */
export const DRONE_STATS = [{ hp: 14, armor: 1 }, { hp: 17, armor: 2 }, { hp: 20, armor: 3 }, { hp: 25, armor: 4 }]

export type DroneKind = 'attack' | 'shield' | 'scout' | 'medic' | 'jammer'
export interface DroneDef { kind: DroneKind; grade: 1 | 2 | 3 | 4; name?: string; item?: string }
export interface SummonsExt { drones?: DroneDef[]; vehicle?: { name: string; hp: [number, number] } }

export const KIND_NAME: Record<DroneKind, string> = { attack: '攻擊無人機', shield: '護盾無人機', scout: '偵察無人機', medic: '醫療無人機', jammer: '干擾無人機' }
export const isKind = (k: unknown): k is DroneKind => typeof k === 'string' && k in KIND_NAME
/** 支援型：放出的上限問 overlay_cap 時多帶一個 support 標籤（多工連結只給支援型） */
export const SUPPORT_KINDS: readonly string[] = ['shield', 'scout', 'medic']
/** 會開火的種類（攻擊、干擾；自己帶武器的也算）：drone.act 對一整組時只讓它們動 */
export const SHOOTER_KINDS: readonly string[] = ['attack', 'jammer']
/** 指揮時要另外選一個敵人的那幾型（攻擊、干擾、偵察）；醫療型照顧同一格的人，護盾型守著同一格的人。 */
export const NEEDS_FOE: readonly string[] = ['attack', 'jammer', 'scout']

// ---- 讀單位上的資料 ----

const summonsOf = (u: BattleUnit): SummonsExt | undefined => {
  const s = u.ext.summons
  return s && typeof s === 'object' ? (s as SummonsExt) : undefined
}
export const dronesOf = (u: BattleUnit): DroneDef[] => {
  const d = summonsOf(u)?.drones
  return Array.isArray(d) ? d : []
}
export const vehicleOf = (u: BattleUnit): SummonsExt['vehicle'] => {
  const v = summonsOf(u)?.vehicle
  return v && typeof v === 'object' ? v : undefined
}
export const gradeOf = (d: DroneDef): number => Math.min(4, Math.max(1, Math.round(Number(d.grade) || 1)))
export const syncOf = (u: BattleUnit): number => Math.min(6, Math.max(0, Math.floor(u.skills.sync ?? 0)))

/** 放出的種類帶的標籤：[種類]，支援型再加 support。 */
export const capTags = (kind: string): string[] => (SUPPORT_KINDS.includes(kind) ? [kind, 'support'] : [kind])
/** 同時連得住幾台：同步的級數查表，加上 overlay_cap 的修正（問的是操作者；tags 是這一台的種類，沒指定哪一台時不帶），最少 0。 */
export const capOf = (view: BattleView, u: BattleUnit, tags: string[] = []): number =>
  Math.max(0, DRONE_CAP_BY_SYNC[syncOf(u)]! + view.mods('overlay_cap', u, undefined, undefined, tags).reduce((n, p) => n + p.value, 0))

/** 索引 i 的那一台這一場的狀態：0 在手上、1 放出去了、2 被擊落了。 */
export const stateOf = (u: BattleUnit, i: number): number => u.uses[`drone:${i}`] ?? 0
export const isDrone = (o: BattleOverlay): boolean => typeof o.ext?.drone === 'number'
/** 這個人場上沒被擊落的無人機。 */
export const fielded = (view: BattleView, u: BattleUnit): BattleOverlay[] => view.battle.overlays.filter((o) => o.owner === u.id && isDrone(o) && !o.down)
/** 這個人的所有掛著的東西（接管來的也算；沒被擊落的），照格排。 */
export const heldBy = (view: BattleView, u: BattleUnit): BattleOverlay[] =>
  view.battle.overlays.filter((o) => o.owner === u.id && o.side === u.side && !o.down).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))
/** 算進同步上限的：不是「不算進上限」的臨時機。 */
export const countsAgainstCap = (o: BattleOverlay): boolean => !o.ext?.overCap

/** 這一台會不會開火：攻擊、干擾型，或自己帶著武器（接管來的砲塔）。 */
export const isShooter = (o: BattleOverlay): boolean => SHOOTER_KINDS.includes(o.kind) || !!o.weapon

// ---- 放出 ----

/** 放出之前看上限：放不下回傳一句完整的話，放得下回傳 null。 */
export function capBlock(view: BattleView, u: BattleUnit, kind: string): string | null {
  const n = fielded(view, u).filter(countsAgainstCap).length
  const cap = capOf(view, u, capTags(kind))
  if (n < cap) return null
  const sync = syncOf(u)
  // 多工連結多出來的那一台只給支援型：這一台不是支援型、而支援型還放得下
  const support = capOf(view, u, ['support'])
  if (!SUPPORT_KINDS.includes(kind) && support > cap && n < support) return `同步 ${sync} 級連得住 ${cap} 台，已經放滿了；多出來的那一台只能是護盾型、偵察型或醫療型。`
  return `同步 ${sync} 級只連得住 ${cap} 台。`
}
/** 放出的上限（所有種類裡最寬的那一個）：動作本身放不下任何一台時才擋，這時候的句子用它。 */
export function widestCap(view: BattleView, u: BattleUnit): number {
  return Math.max(...(Object.keys(KIND_NAME) as DroneKind[]).map((kind) => capOf(view, u, capTags(kind))))
}

/** 掛上一台（照單位上的第 idx 台，或臨時的一台）：核心發 id、查每格一台、問操作者的耐久護甲迴避的修正、記一拍。 */
export function hang(run: BattleRun, u: BattleUnit, slot: number, o: { idx?: number; kind?: DroneKind; grade?: number; name?: string; item?: string; limits?: { until?: number; overCap?: boolean; noBacklash?: boolean } }): BattleOverlay {
  const idx = o.idx ?? -1
  const def = o.idx !== undefined ? dronesOf(u)[o.idx] : undefined
  const kind = def?.kind ?? o.kind
  if (!kind || !isKind(kind)) throw new BattleBlocked(['沒有這一台無人機。'])
  const grade = def ? gradeOf(def) : Math.min(4, Math.max(1, Math.round(o.grade ?? 1)))
  const stats = DRONE_STATS[grade - 1]!
  const name = def?.name ?? o.name ?? KIND_NAME[kind]
  const item = def?.item ?? o.item
  const ext: Record<string, unknown> = { drone: idx, grade }
  // 時限（turns：到期自己收回）、不算進上限、被擊落不灌感載（蜂群的臨時機）
  if (o.limits?.until !== undefined) ext.until = o.limits.until
  if (o.limits?.overCap) ext.overCap = true
  if (o.limits?.noBacklash) ext.noBacklash = true
  const overlay = run.addOverlay({
    side: u.side, slot, owner: u.id, kind, name,
    hp: { now: stats.hp, max: stats.hp }, armor: stats.armor, evade: run.n.evadeBase + 3,
    ...(item ? { item } : {}), ext,
  })
  if (idx >= 0) u.uses[`drone:${idx}`] = 1
  return overlay
}

// ---- 動一次 ----

/** 一台臨時的武器：攻擊型是物理、干擾型是電磁；命中用操作者的反應與操縱（COMBAT_SYSTEM 9.1 節）。 */
export function droneWeapon(u: BattleUnit, o: BattleOverlay, type: DamageType): BattleWeapon {
  const grade = Number(o.ext?.grade) || 1
  return {
    id: 'drone', name: o.name, class: 'drone', dice: 2 + gradeDice(grade), flat: 0, type, range: [1, 7], pierce: 0,
    hit: attrMod(u.attrs.reflex) + (u.skills.piloting ?? 0), attr: 'reflex', skill: 'piloting', coverMult: 0.25, traits: [],
  }
}

/** 守著：下一次以同一格的人為目標的攻擊改打這一台（until：操作者的下一個回合開始，或整場）。 */
export function guard(run: BattleRun, o: BattleOverlay, until: 'own_turn_start' | 'battle_end'): void {
  o.ext = { ...o.ext, guard: until }
  run.say(`${o.name}擋在第 ${o.slot} 格的前面，準備替同一格的人擋下一次攻擊。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, guard: until })
}

export interface DriveOpts {
  /** 打誰（攻擊、干擾、偵察型要） */
  foe?: BattleUnit
  hit?: number
  pierce?: number
  /** 護盾型指揮時守到什麼時候（預設操作者的下一個回合開始） */
  until?: 'own_turn_start' | 'battle_end'
}

/**
 * 讓一台照它的種類動一次（不看、也不改 used：由呼叫的人管）。攻擊、干擾：打 foe（自己帶武器的照它自己的武器）；
 * 偵察：標記 foe；醫療：替同一格的人急救；護盾：守著同一格的人。回傳這一次攻擊的結果（沒有攻擊就是 undefined）。
 */
export function driveOnce(run: BattleRun, u: BattleUnit, o: BattleOverlay, a: DriveOpts = {}): AttackResult | undefined {
  const foeOf = (): BattleUnit => {
    const t = a.foe
    if (!t || t.side === u.side || t.slot < 1 || t.out) throw new BattleBlocked(['要選一個敵人。'])
    return t
  }
  const extra = { ...(a.hit ? { hit: a.hit } : {}), ...(a.pierce ? { pierce: a.pierce } : {}) }
  if (o.weapon) return run.overlayAttack(o, foeOf(), { spend: 0, label: '射擊', tags: ['drone'], ...extra })
  switch (o.kind) {
    case 'attack':
    case 'jammer':
      return run.attack(u, foeOf(), { weapon: droneWeapon(u, o, o.kind === 'jammer' ? 'em' : 'physical'), spend: 0, label: '無人機射擊', tags: ['drone'], ...extra })
    case 'scout': {
      const foe = foeOf()
      run.say(`${o.name}標記了${foe.name}。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, target: foe.id }, u)
      run.applyStatus(foe, 'marked', { by: u, until: 'source_turn_start' })
      return undefined
    }
    case 'medic': {
      const mate = unitAt(run.battle, o.side, o.slot)
      if (!mate) throw new BattleBlocked(['那一格沒有人。'])
      run.say(`${o.name}替${mate.name}急救。`, 'overlay', { overlay: o.id, kind: o.kind, slot: o.slot, target: mate.id }, u)
      run.heal(mate, run.d6(2))
      run.cleanse(mate, 'first_aid')
      return undefined
    }
    case 'shield':
      guard(run, o, a.until ?? 'own_turn_start')
      return undefined
    default:
      throw new BattleBlocked(['這一台現在做不了事。'])
  }
}

// ---- 移動 ----

/** 這一台可以換到哪幾格：相鄰、沒有掛著別台的。宣告（picks）與行動本身（run）共用。 */
export const moveSlots = (view: BattleView, o: BattleOverlay): number[] => [o.slot - 1, o.slot + 1].filter((s) => s >= 1 && s <= BATTLE_SLOTS && !overlayAt(view.battle, o.side, s))

/** 把一台換到另一格（any：不必相鄰，只要那一格沒有別台）。不合丟 BattleBlocked。 */
export function moveTo(run: BattleRun, u: BattleUnit, o: BattleOverlay, to: unknown, any = false): void {
  if (typeof to !== 'number' || !Number.isInteger(to) || to < 1 || to > BATTLE_SLOTS || (any ? to === o.slot || !!overlayAt(run.battle, o.side, to) : !moveSlots(run, o).includes(to))) {
    throw new BattleBlocked([any ? '要選一個沒有掛著別台的格。' : '只能換到相鄰、沒有掛著別台的格。'])
  }
  const from = o.slot
  o.slot = to
  run.say(`${o.name}從第 ${from} 格換到第 ${to} 格。`, 'overlay', { overlay: o.id, kind: o.kind, from, slot: to }, u)
}
