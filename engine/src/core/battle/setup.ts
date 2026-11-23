// L5 戰鬥：開打。把「誰上場、在哪裡打、誰埋伏誰」組成一份戰鬥狀態：站位、遮蔽、先攻、第一回合的行動點。
// 「誰上場」的來源是登錄表：核心有 actor（state.actors 裡的角色）與 unit（直接給整個單位）；敵人資料由敵人的功能註冊 enemy。

import type { BattleCover, BattleNode, BattleOrigin, BattleSide, BattleState, BattleUnit, GameState, Grade } from '../types'
import { BATTLE_SLOTS } from '../types'
import { areaGrade } from '../rules/grades'
import { clone } from '../util/clone'
import { clamp } from '../util/sanitize'
import { otherSide, unitTag, unitsOf } from './field'
import type { BattleKernel, UnitSourceCtx } from './registry'
import type { BattleMode } from './rules'
import { COVER_LAYOUTS, coverHpFor, modeOf } from './rules'
import { BattleRun, initiativeOrder } from './run'
import { advance, beginTurn, startRound } from './turn'
import type { UnitRef } from './units'
import { buildUnit, resolveUnit } from './units'

// 「誰上場」怎麼解成單位在 units.ts（戰鬥中叫人也用它）；這裡原樣再匯出，外面一直是從這裡拿
export type { UnitRef } from './units'
export { unitFromActor } from './units'

export interface BattleSetup {
  /** 戰場；沒寫是 meat（現實） */
  mode?: string
  /** 場景的等級；沒寫用主角所在那一區的 */
  grade?: Grade
  /** 我方上場的人。超過四個的排在後方，有空格才補上來 */
  allies: UnitRef[]
  foes: UnitRef[]
  /** 八格的遮蔽：配置的名字（dense、medium、sparse、one_sided；SITES 12.2 節），或逐格寫（索引 0 是第 1 格；0 暴露、1 半掩體、2 掩體） */
  cover?: string | { ally: number[]; foe: number[] }
  /** 誰埋伏誰：埋伏的一方多一格掩體；被埋伏的一方遮蔽全部降一級、排列是亂的、第一回合行動點從上限 − 2 開始 */
  ambush?: BattleSide
  /**
   * 先攻的優勢（dev/adr/0016 第五節、G7；FIXER 第 2 節：守備沒揭開時敵人多一次先攻的機會）：那一方開場時每個上場的人，
   * 先攻擲兩次取高（每個人的兩顆連著擲，紀錄裡各記一拍、看得到兩顆骰）。只管開場上場的人；之後補位與叫來的人照一般的擲一次。沒寫就是雙方都擲一次
   */
  edge?: BattleSide
  /** 場地效果：dark 黑暗 */
  field?: Record<string, boolean | number | string>
  /** 控制節點 */
  nodes?: Array<{ kind: string; name?: string }>
  /** 打不破的遮蔽（人群、開場就有的煙霧） */
  soft?: Array<{ side: BattleSide; slot: number; kind: string; rounds?: number }>
  origin?: Partial<BattleOrigin>
}

function coverRow(levels: readonly number[], mode: BattleMode, grade: Grade): BattleCover[] {
  return Array.from({ length: BATTLE_SLOTS }, (_, i) => {
    const level = clamp(Math.floor(levels[i] ?? 0), 0, 2) as 0 | 1 | 2
    return { level, hp: level > 0 ? coverHpFor(mode.numbers, level as 1 | 2, grade) : 0 }
  })
}

/**
 * 開打：算出這場戰鬥的第一份狀態與開場的紀錄。不改 state；回傳的 run 裡有戰鬥狀態（run.battle）與每一拍（run.beats）。
 * 已經有一場在打、沒有人上場、戰場沒註冊，都丟錯。
 */
export function setupBattle(k: BattleKernel, state: GameState, setup: BattleSetup): BattleRun {
  if (state.battle) throw new Error('已經有一場戰鬥在進行。')
  const modeId = setup.mode ?? 'meat'
  const mode = modeOf(k.content, modeId)
  if (!mode) throw new Error(`沒有 ${modeId} 這個戰場`)
  if (!setup.allies.length || !setup.foes.length) throw new Error('雙方都要有人上場。')
  if (setup.edge !== undefined && setup.edge !== 'ally' && setup.edge !== 'foe') throw new Error(`edge 只能是 ally 或 foe，不是 ${String(setup.edge)}`)
  const grade = setup.grade ?? areaGrade(k, state)
  const n = mode.numbers

  const layout = typeof setup.cover === 'string' ? COVER_LAYOUTS[setup.cover] : setup.cover
  if (typeof setup.cover === 'string' && !layout) throw new Error(`沒有 ${setup.cover} 這種遮蔽的配置`)
  const levels = { ally: [...(layout?.ally ?? COVER_LAYOUTS.medium!.ally)], foe: [...(layout?.foe ?? COVER_LAYOUTS.medium!.foe)] }
  // 「一邊倒」是守方（敵人）佔好位置；我方埋伏時對調（SITES 12.2 節、COMMISSION_MAPS 1.3 節），再照埋伏調一級（B011）
  if (setup.cover === 'one_sided' && setup.ambush === 'ally') [levels.ally, levels.foe] = [levels.foe, levels.ally]
  if (setup.ambush) {
    // 埋伏的一方多一格掩體（最前面那一格不是掩體的升成掩體）；被埋伏的一方全部降一級
    const lead = levels[setup.ambush]
    const i = lead.findIndex((l) => l < 2)
    if (i >= 0) lead[i] = 2
    const caught = otherSide(setup.ambush)
    levels[caught] = levels[caught].map((l) => Math.max(0, l - 1))
  }

  const battle: BattleState = {
    id: `b${state.seq.uid + 1}`, mode: modeId, grade, round: 1, order: [], turn: 0, units: {},
    reserve: { ally: [], foe: [] },
    cover: { ally: coverRow(levels.ally, mode, grade), foe: coverRow(levels.foe, mode, grade) },
    overlays: [], nodes: (setup.nodes ?? []).map((x, i): BattleNode => ({ id: `n${i + 1}`, kind: x.kind, name: x.name ?? x.kind, taken: false, used: false })),
    field: { ...(setup.field ?? {}) }, rolls: 0, seq: 0, aiSteps: 0, steps: [],
    origin: { escapable: true, ...(setup.ambush ? { ambush: setup.ambush } : {}), ...clone(setup.origin ?? {}) },
  }

  for (const side of ['ally', 'foe'] as const) {
    const refs = side === 'ally' ? setup.allies : setup.foes
    const ctx: UnitSourceCtx = { k, state, side, mode: modeId, grade, allyCount: setup.allies.length }
    const taken = new Set<number>()
    refs.forEach((ref, i) => {
      const init = resolveUnit(k, state, ref, ctx, mode)
      const id = `${side === 'ally' ? 'a' : 'f'}${i + 1}`
      let slot = 0
      if (taken.size < BATTLE_SLOTS) {
        slot = typeof ref.slot === 'number' && ref.slot >= 1 && ref.slot <= BATTLE_SLOTS && !taken.has(ref.slot) ? ref.slot : [1, 2, 3, 4].find((s) => !taken.has(s))!
        taken.add(slot)
      } else battle.reserve[side].push(id)
      battle.units[id] = buildUnit(init, ref, id, side, slot)
    })
  }

  // 開打時每一方的人數（上場的加上在後方等的）：士氣的分母，之後的增援不改它（ENEMIES 4.4 節）
  const all = Object.values(battle.units)
  battle.origin.headcount = { ally: all.filter((u) => u.side === 'ally').length, foe: all.filter((u) => u.side === 'foe').length }

  const run = new BattleRun(k, state, battle)
  for (const s of setup.soft ?? []) run.softCover(s.side, s.slot, s.kind, s.rounds)
  // 每個單位剛組好：功能把自己的資料掛上去（在擲先攻之前，先攻的修正才讀得到）
  for (const u of Object.values(battle.units)) k.battle.emit('unit.ready', { run, unit: u })
  run.beats.length = 0
  if (setup.ambush) {
    // 被埋伏的一方排列是亂的，第一回合從「上限 − 2」開始
    const caught = unitsOf(battle, otherSide(setup.ambush))
    const slots = caught.map((u) => u.slot)
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(run.rand() * (i + 1))
      const tmp = slots[i]!
      slots[i] = slots[j]!
      slots[j] = tmp
    }
    caught.forEach((u, i) => {
      u.slot = slots[i]!
      u.ap.now = Math.max(0, u.ap.max + n.apAmbushed)
    })
  }
  // 先攻 = 1d20 ＋ mod(反應) ＋ 加值；由高到低，一樣高時我方先、再照站位
  const fielded = Object.values(battle.units).filter((u) => u.slot >= 1)
  // edge 的那一方：兩顆連著擲、取高（記下來，等「戰鬥開始」那一拍之後再寫進紀錄）
  const edgeRolls: Array<{ unit: BattleUnit; dice: [number, number] }> = []
  for (const u of fielded) {
    let natural: number
    if (setup.edge === u.side) {
      const dice: [number, number] = [run.d20(), run.d20()]
      edgeRolls.push({ unit: u, dice })
      natural = Math.max(...dice)
    } else natural = run.d20()
    u.initiative = natural + u.initBonus + run.mods('initiative', u).reduce((s, p) => s + p.value, 0)
  }
  battle.order = fielded.sort(initiativeOrder).map((u) => u.id)

  const place = battle.origin.place ? `（${battle.origin.place}）` : ''
  run.say(`戰鬥開始${place}。${setup.ambush ? (setup.ambush === 'ally' ? '我方埋伏：敵人的遮蔽降一級、排列被打亂。' : '被埋伏了：我方的遮蔽降一級、排列被打亂，第一回合的行動點少 2 點。') : ''}`, 'battle.start', { battle: battle.id, mode: modeId, ...(setup.ambush ? { ambush: setup.ambush } : {}) })
  if (battle.origin.capture?.length) run.say(`條件：要活的。${battle.origin.capture.map((id) => battle.units[id]?.name ?? id).join('、')}要制伏，不能打倒。`, undefined, { capture: battle.origin.capture })
  for (const { unit: u, dice } of edgeRolls) run.say(`${unitTag(u)} 佔了先機：先攻擲兩顆取高（${dice[0]}、${dice[1]}），取 ${Math.max(...dice)}，先攻 ${u.initiative}。`, undefined, { unit: u.id, edge: u.side, dice, initiative: u.initiative })
  k.battle.emit('battle.start', { run })
  run.say(`—— 第 1 回合 ——`, 'round', { round: 1 })
  startRound(run)
  if (run.over) return run
  // 輪到第一個能動的人（先攻最高的人開場就失去回合時，往下輪）
  const first = battle.units[battle.order[0] ?? '']
  if (first && !first.out && first.slot >= 1 && beginTurn(run, first)) run.settle()
  else advance(run)
  return run
}
