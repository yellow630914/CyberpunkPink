// L5 戰鬥：把「誰上場」變成戰鬥裡的單位。開打（setup.ts）與戰鬥中叫人（run.callIn）走同一條路，所以放在這個檔：
// setup.ts 與 run.ts 都 import 它，兩邊才不會互相 import。
// 「誰上場」的來源是登錄表：核心有 actor（state.actors 裡的角色）與 unit（直接給整個單位）；敵人資料由敵人的功能註冊 enemy。

import type { ActorId, AttrId, BattleSide, BattleUnit, BattleWeapon, GameState, Grade } from '../types'
import { ATTR_IDS } from '../types'
import { attrMod } from '../rules/check'
import { clone } from '../util/clone'
import { clamp, isRecord } from '../util/sanitize'
import type { BattleKernel, BattleUnitInit, UnitSourceCtx } from './registry'
import type { BattleMode } from './rules'

/** 一筆「誰上場」：from 是來源（actor、unit、enemy……），其餘的欄位由那個來源解讀。 */
export interface UnitRef {
  from: string
  /** 指定站第幾格；沒寫照順序排（第 1 個站第 1 格）。戰鬥中叫來的人（run.callIn）不看這個：進場時站最後面的空格 */
  slot?: number
  /** 誰操縱；沒寫的話我方是玩家、敵方是 AI */
  control?: 'player' | 'ai'
  [field: string]: unknown
}

const statOr = (k: BattleKernel, state: GameState, actor: ActorId, id: string, fallback: number): number => (k.stats.hasStat(id) ? k.stats.stat(state, actor, id) : fallback)

/** 沒有帶武器的人：空手（格鬥，只能打近身）。 */
function unarmed(attrs: Record<AttrId, number>, skills: Record<string, number>): BattleWeapon {
  return {
    id: 'unarmed', name: '空手', class: 'melee', dice: 1, flat: Math.max(0, attrMod(attrs.body)), type: 'physical', range: [1, 1], pierce: 0,
    hit: attrMod(attrs.body) + (skills.brawl ?? 0), attr: 'body', skill: 'brawl', coverMult: 0, traits: ['melee'],
  }
}

/**
 * 把一個角色變成戰鬥裡的單位（COMBAT_SYSTEM 1.2、第 3 節；CORE_RULES 第 4 節）。
 * 上限讀衍生數值（角色的功能註冊的 max_hp、load_cap、ap_max、afterglow_cap、ram_max）；沒有人註冊時照設計書的公式算。
 * 武器、護甲、快取格來自裝備的功能（battle.loadout）；沒有武器：有生命這一條的戰場（現實）是空手，沒有生命這一條的（內海）就是沒有武器。
 * 護甲（防護）讀 mode.guardStat 那個衍生數值（現實 armor、內海 net_guard；沒有人註冊是 0）加 loadout 的 armor：穿著防彈衣進內海不算防護。
 */
export function unitFromActor(k: BattleKernel, state: GameState, actorId: ActorId, mode: BattleMode, grade: Grade): BattleUnitInit {
  const a = state.actors[actorId]
  if (!a) throw new Error(`沒有 ${actorId} 這個角色`)
  const attrs = Object.fromEntries(ATTR_IDS.map((id) => [id, k.stats.effectiveAttr(state, actorId, id)])) as Record<AttrId, number>
  const mod = (id: AttrId) => attrMod(attrs[id])
  const n = mode.numbers
  const lo = k.battle.loadoutOf(state, actorId, mode.id)
  const bridge = isRecord(a.ext.bridge) ? a.ext.bridge : {}
  const sensitivity = typeof bridge.sensitivity === 'number' ? bridge.sensitivity : 50
  const tolerance = typeof bridge.tolerance === 'number' ? bridge.tolerance : 0
  const hpMax = statOr(k, state, actorId, 'max_hp', 20 + attrs.body * 2)
  const loadMax = statOr(k, state, actorId, 'load_cap', 20 + Math.floor(tolerance / 2) + mod('resolve') * 3)
  const apMax = statOr(k, state, actorId, 'ap_max', 4 + Math.floor((mod('reflex') + mod('charm')) / 2))
  const ramMax = statOr(k, state, actorId, 'ram_max', Math.max(4, 4 + mod('intellect')))
  // 內海沒有空手：沒有生命那一條的戰場，沒給武器的人手上就是空的（核心裡用到「手上那一把」的地方都接受沒有武器）
  const weapons = lo.weapons.length ? clone(lo.weapons) : mode.tracks.includes('hp') ? [unarmed(attrs, a.skills)] : []
  const guard = mode.guardStat ? statOr(k, state, actorId, mode.guardStat, 0) : 0
  return {
    name: a.name, actor: actorId, control: 'player', grade, rank: 'elite',
    attrs, skills: { ...a.skills },
    ...(mode.tracks.includes('hp') ? { hp: { now: clamp(a.hp, 0, hpMax), max: hpMax } } : {}),
    armor: guard + lo.armor,
    load: { now: clamp(a.load, 0, Math.max(0, loadMax - 1)), max: Math.max(1, loadMax) },
    layers: a.afterglow, layersMax: statOr(k, state, actorId, 'afterglow_cap', 3), sensitivity, sink: 0,
    // 身上的義體數：義體的功能（M4）註冊 cyber_count 之前都是 0
    ...(k.stats.hasStat('cyber_count') ? { cyber: Math.max(0, Math.floor(k.stats.stat(state, actorId, 'cyber_count'))) } : {}),
    // 身上裝著的義體（義體的功能經 loadout 給）：失效與超頻從這裡挑
    ...(lo.implants?.length ? { implants: clone(lo.implants) } : {}),
    ap: { now: apMax, max: apMax, regen: n.apRegen },
    pools: { ram: { now: ramMax, max: ramMax, regen: statOr(k, state, actorId, 'ram_regen', 2) } },
    weapons, wield: 0,
    evade: statOr(k, state, actorId, 'evade', n.evadeBase + mod('reflex')) + lo.evade,
    initBonus: mod('reflex'),
    statuses: [], dmgMult: { hp: 1, load: 1 }, tags: [...new Set(lo.tags)], quick: clone(lo.quick), uses: {}, wounds: {}, ext: {},
  }
}

/** 照來源把一筆 ref 解成單位（還沒有 id、站位、先攻）。來源查不到丟錯。開打與 run.callIn 共用。 */
export function resolveUnit(k: BattleKernel, state: GameState, ref: UnitRef, ctx: UnitSourceCtx, mode: BattleMode): BattleUnitInit {
  if (ref.from === 'actor') {
    if (typeof ref.id !== 'string') throw new Error('actor 要寫 id（角色的 id）')
    return unitFromActor(k, state, ref.id, mode, ctx.grade as Grade)
  }
  if (ref.from === 'unit') {
    if (!isRecord(ref.unit)) throw new Error('unit 要給整個單位')
    return clone(ref.unit) as unknown as BattleUnitInit
  }
  const source = k.battle.getUnitSource(ref.from)
  if (!source) throw new Error(`沒有 ${ref.from} 這種單位的來源（還沒有功能註冊它）`)
  return source(ref, ctx)
}

/** 把解好的單位放進戰鬥：補上 id、哪一方、站位、先攻（還沒擲，0）與誰操縱；義體清單有、件數沒寫時用件數（dev/adr/0015 第三節）。 */
export function buildUnit(init: BattleUnitInit, ref: UnitRef, id: string, side: BattleSide, slot: number): BattleUnit {
  const u: BattleUnit = { ...init, id, side, slot, initiative: 0, control: ref.control ?? (side === 'ally' ? init.control : 'ai') }
  // cyber 沒寫、但有義體清單時，用件數（敵人 AI 的 bridged 偏好看 cyber；dev/adr/0015 第三節）
  if (u.cyber === undefined && u.implants) u.cyber = u.implants.length
  return u
}
