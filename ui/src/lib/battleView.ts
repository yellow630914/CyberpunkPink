import type { BattleActionOption, BattleOptions, BattleState, BattleUnit } from '@engine/src'
import { DEFAULT_MODES, DEFAULT_NUMBERS, coverHpFor } from '@engine/src'

/**
 * 把戰鬥狀態整理成畫面要的模型（純函式，不寫規則，COMBAT_SYSTEM 第 10 節）。
 * 能不能做、為什麼不能、命中率、花幾點、誰先動，一律讀 battleOptions 與 state.battle；這裡只排版。
 */

export interface SlotPos { side: 'ally' | 'foe'; slot: number; row: number; col: number }

/** 八格在畫面上的位置（row、col 從 1 起算，給 CSS grid 用）。桌面一列八格；手機敵上我下，兩排的第 1 格都在左邊。 */
export function slotLayout(mode: 'desktop' | 'mobile'): SlotPos[] {
  const slots = [1, 2, 3, 4]
  if (mode === 'desktop') {
    return [
      ...[4, 3, 2, 1].map((slot, i): SlotPos => ({ side: 'ally', slot, row: 1, col: 1 + i })),
      ...slots.map((slot, i): SlotPos => ({ side: 'foe', slot, row: 1, col: 5 + i })),
    ]
  }
  return [
    ...slots.map((slot): SlotPos => ({ side: 'foe', slot, row: 1, col: slot })),
    ...slots.map((slot): SlotPos => ({ side: 'ally', slot, row: 2, col: slot })),
  ]
}

export interface CellUnit {
  id: string
  name: string
  side: 'ally' | 'foe'
  rank: string
  hp?: { now: number; max: number }
  load?: { now: number; max: number }
  layers: number
  layersMax: number
  ap: { now: number; max: number }
  weapon: string
  mag?: { now: number; max: number }
  /** 狀態的名字（查得到內容就用名字，查不到用 id） */
  statuses: string[]
  out?: string
  control: 'player' | 'ai'
}
export interface BattleCell {
  side: 'ally' | 'foe'
  slot: number
  cover: { level: 0 | 1 | 2; name: string; hp: number; max: number; soft?: string }
  unit: CellUnit | null
  overlays: Array<{ id: string; name: string; kind: string; hp: { now: number; max: number } }>
}
export interface BattleViewModel {
  round: number
  cells: BattleCell[]
  order: Array<{ id: string; name: string; side: 'ally' | 'foe'; now: boolean; out?: string }>
  distances: Array<{ id: string; name: string; distance: number }>
  field: { dark: boolean }
  nodes: Array<{ id: string; name: string; taken: boolean; used: boolean }>
}

/** 查名字用（狀態的 id → 名字）；沒給就顯示 id。 */
export type NameOf = (kind: string, id: string) => string | undefined

function cellUnit(u: BattleUnit, nameOf?: NameOf): CellUnit {
  const w = u.weapons[u.wield]
  const out: CellUnit = {
    id: u.id, name: u.name, side: u.side, rank: u.rank, layers: u.layers, layersMax: u.layersMax,
    ap: { now: u.ap.now, max: u.ap.max }, weapon: w?.name ?? '', control: u.control,
    statuses: u.statuses.map((s) => nameOf?.('battle_status', s.id) ?? s.id),
  }
  if (u.hp) out.hp = { now: u.hp.now, max: u.hp.max }
  if (u.load) out.load = { now: u.load.now, max: u.load.max }
  if (w?.mag) out.mag = { now: w.mag.now, max: w.mag.max }
  if (u.out) out.out = u.out
  return out
}

export function battleView(battle: BattleState, options: BattleOptions, nameOf?: NameOf): BattleViewModel {
  const names = (DEFAULT_MODES[battle.mode] ?? DEFAULT_MODES.meat!).coverNames
  const onField = (u: BattleUnit): boolean => !u.out && u.slot > 0
  const cells: BattleCell[] = slotLayout('desktop').map(({ side, slot }) => {
    const c = battle.cover[side][slot - 1]!
    const level = c.level
    const unit = Object.values(battle.units).find((u) => u.side === side && u.slot === slot && onField(u))
    const max = level === 0 ? 0 : (c.max?.[level - 1] ?? coverHpFor(DEFAULT_NUMBERS, level, battle.grade))
    return {
      side, slot,
      cover: { level, name: names[level], hp: c.hp, max, ...(c.soft ? { soft: c.soft.kind } : {}) },
      unit: unit ? cellUnit(unit, nameOf) : null,
      overlays: battle.overlays.filter((o) => !o.down && o.side === side && o.slot === slot).map((o) => ({ id: o.id, name: o.name, kind: o.kind, hp: { now: o.hp.now, max: o.hp.max } })),
    }
  })
  const order = battle.order.map((id) => {
    const u = battle.units[id]!
    return { id, name: u.name, side: u.side, now: id === options.current, ...(u.out ? { out: u.out } : {}) }
  })
  const cur = options.current && options.waiting === 'player' ? battle.units[options.current] : undefined
  const distances = cur
    ? Object.values(battle.units).filter((u) => u.side !== cur.side && onField(u)).sort((a, b) => a.slot - b.slot)
      .map((u) => ({ id: u.id, name: u.name, distance: cur.slot + u.slot - 1 }))
    : []
  return {
    round: battle.round, cells, order, distances,
    field: { dark: battle.field.dark === true },
    nodes: battle.nodes.map((n) => ({ id: n.id, name: n.name, taken: n.taken, used: n.used })),
  }
}

export type RingGroup = 'skill' | 'attack' | 'supply' | 'tactic' | 'system'

/** 把行動照引擎給的分圈分成五組，組內保持引擎給的順序。system 是圓環外面那一列；hold 的要長按。 */
export function ringOf(options: BattleOptions): Record<RingGroup, BattleActionOption[]> {
  const out: Record<RingGroup, BattleActionOption[]> = { skill: [], attack: [], supply: [], tactic: [], system: [] }
  for (const a of options.actions) out[a.group].push(a)
  return out
}

/** 數字鍵 1～9 對到哪個行動：內環（攻擊）、中環（補充與切換）、外環（戰術）照順序，最多九個。 */
export function RING_KEYS(options: BattleOptions): string[] {
  const r = ringOf(options)
  return [...r.attack, ...r.supply, ...r.tactic].slice(0, 9).map((a) => a.id)
}

/**
 * 灰掉的原因：行動自己的 blocks 一條一行；沒有的話，每個目標都選不了時把目標的原因（去掉重複的）一條一行；能做回傳 null。
 * 引擎給幾條就寫幾條，不自己湊字。
 */
export function disabledReason(a: Pick<BattleActionOption, 'ok' | 'blocks' | 'targets'>): string | null {
  if (a.ok) return null
  if (a.blocks.length > 0) return a.blocks.join('\n')
  const all = [...new Set(a.targets.flatMap((t) => t.blocks))]
  return all.length > 0 ? all.join('\n') : null
}
