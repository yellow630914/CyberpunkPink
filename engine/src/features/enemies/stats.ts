// 把一筆敵人資料變成單位的數字：目標表 × 兵種的修正 × 難度 × 強度係數（ENEMIES 1.5、第 13 節；ENEMY_ROSTER 開頭；BALANCE 7.2）。
// dev/work/M1-enemies.md 第四、五節。

import type { BattleSetup, BattleUnitInit, BattleWeapon, ContentRegistry, GameState, Grade, UnitRank, UnitRef, WeaponClassEntry } from '../../core'
import { ATTR_IDS, areaGrade, attrMod, enemyCoefFor, gradeDice, weaponFromClass } from '../../core'
import type { Kernel } from '../../core'
import { ENEMY_CURVE } from './curve'
import type { EncounterEntry, EncounterFoe, EnemyEntry } from './kinds'
import { UNBRIDGED_KINDS, resolveEnemy } from './kinds'

type Cx = Pick<Kernel, 'content'>

export interface EnemyStats {
  grade: Grade
  rank: UnitRank
  hp: number
  /** 沒有橋的沒有感載這一條 */
  load?: number
  armor: number
  evade: number
  attack: number
  ap: number
  layers: number
  sensitivity: number
  dmgMult: { hp: number; load: number }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const asGrade = (n: number) => clamp(Math.floor(n), 1, 5) as Grade

/** 沒寫等級時用場景的等級，夾在這個兵種的 grades 範圍裡（兵種不出現的等級照最近的那一級，不擋）。 */
export function gradeIn(e: EnemyEntry, sceneGrade: number): Grade {
  return asGrade(clamp(Math.floor(sceneGrade), e.grades[0], e.grades[1]))
}

/** 強度係數（雜兵一律 1；我方 4 人以上照資料或具名的 ×1.3；少於 4 人是對決的修正，各自的生命與傷害倍數）。 */
function strengthOf(e: EnemyEntry, allies: number, override?: number): { hp: number; dmg: number } {
  if (e.rank === 'minion') return { hp: 1, dmg: 1 }
  if (allies >= 4) {
    const s = override ?? e.strength ?? (e.named ? 1.3 : 1)
    return { hp: s, dmg: s }
  }
  // 對決（ENEMIES 第 13 節）：不看具名的係數，也不看遭遇自己指定的
  if (e.rank === 'elite') return allies <= 1 ? { hp: 0.8, dmg: 0.8 } : { hp: 1, dmg: 1 }
  if (allies <= 1) return { hp: 0.35, dmg: 0.5 }
  if (allies === 2) return { hp: 0.8, dmg: 0.8 }
  return { hp: 1, dmg: 1 }
}

function statsOf(state: GameState, e: EnemyEntry, grade: Grade, allies: number, override?: number): EnemyStats {
  const g = grade - 1
  const m = e.mods ?? {}
  const c = enemyCoefFor(state.rules, grade, e.rank === 'boss')
  const s = strengthOf(e, allies, override)
  const bridged = !UNBRIDGED_KINDS.includes(e.kind)
  return {
    grade, rank: e.rank,
    hp: Math.round(ENEMY_CURVE.hp[e.rank][g]! * (m.hp ?? 1) * c.hp * s.hp),
    ...(bridged ? { load: Math.round(ENEMY_CURVE.load[e.rank][g]! * (m.load ?? 1) * c.load) } : {}),
    armor: ENEMY_CURVE.armor[g]! + (m.armor ?? 0),
    evade: ENEMY_CURVE.evade[g]! + (m.evade ?? 0),
    attack: ENEMY_CURVE.attack[g]! + (m.attack ?? 0),
    ap: ENEMY_CURVE.ap[e.rank] + (e.rank !== 'minion' && grade >= 4 ? 1 : 0) + (m.ap ?? 0),
    layers: Math.max(1, ENEMY_CURVE.layers[e.rank] + (m.layers ?? 0)),
    sensitivity: m.sensitivity ?? 50,
    dmgMult: { hp: ENEMY_CURVE.rankDamage[e.rank] * c.dmg * s.dmg, load: c.dmg * s.dmg },
  }
}

/** 一個兵種在這個等級、這個人數、這個強度下的數字。找不到敵人就丟錯。 */
export function enemyStats(k: Cx, state: GameState, id: string, o: { grade?: number; allies?: number; strength?: number } = {}): EnemyStats {
  const e = resolveEnemy(k.content, id)
  const grade = o.grade !== undefined ? asGrade(o.grade) : gradeIn(e, areaGradeOf(k, state))
  return statsOf(state, e, grade, o.allies ?? 4, o.strength)
}

// enemyStats 只需要內容；場景的等級要用核心的區等級（沒有等級可問時是 I 級）
function areaGradeOf(k: Cx, state: GameState): number {
  try { return areaGrade(k as unknown as Parameters<typeof areaGrade>[0], state) } catch { return 1 }
}

function buildWeapons(content: ContentRegistry, e: EnemyEntry, grade: Grade, attack: number): BattleWeapon[] {
  return e.weapons.map((w) => {
    const cls = content.get<WeaponClassEntry>('weapon_class', w.class)
    if (!cls) throw new Error(`沒有 ${w.class} 這種武器的類型`)
    const type = (w.type ?? cls.type) as string
    // 打感載的神經武器：打法是 capture 或 neural 的敵人，雜兵 4d6、精英 6d6、首領 11d6，再加同一條等級骰
    const hitsLoad = (type === 'neural' || type === 'pleasure') && (e.mode === 'capture' || e.mode === 'neural')
    const extraDice = hitsLoad ? ENEMY_CURVE.captureDice[e.rank] + gradeDice(grade) - cls.dice : gradeDice(grade)
    return weaponFromClass(content, w.class, {
      hit: attack, extraDice,
      ...(w.name !== undefined ? { name: w.name } : {}), ...(w.type !== undefined ? { type: w.type as BattleWeapon['type'] } : {}),
      ...(w.traits !== undefined ? { traits: w.traits } : {}),
      // 資料寫的是這一把最後的穿甲；weaponFromClass 的 pierce 是加在類型的穿甲上的
      pierce: w.pierce !== undefined ? w.pierce - cls.pierce : 0,
      ...(w.range !== undefined ? { range: w.range } : {}), ...(w.mag !== undefined ? { mag: w.mag } : {}),
    })
  })
}

/** 「誰上場」的 enemy 來源：ref 是 { from: 'enemy', id, grade?, strength?, name? }。 */
export function enemyUnit(k: Cx, state: GameState, ref: Record<string, unknown>, ctx: { grade: number; allyCount: number }): BattleUnitInit {
  const id = typeof ref.id === 'string' ? ref.id : ''
  const e = resolveEnemy(k.content, id)
  const grade = typeof ref.grade === 'number' ? asGrade(ref.grade) : gradeIn(e, ctx.grade)
  const st = statsOf(state, e, grade, ctx.allyCount, typeof ref.strength === 'number' ? ref.strength : undefined)
  const attrs = Object.fromEntries(ATTR_IDS.map((a) => [a, e.attrs?.[a] ?? 10])) as BattleUnitInit['attrs']
  const bridged = st.load !== undefined
  const tags = [...new Set<string>([e.kind, ...(bridged ? [] : ['unbridged']), ...(e.traits ?? [])])]
  return {
    name: typeof ref.name === 'string' ? ref.name : e.name, enemy: id, control: 'ai', grade, rank: e.rank,
    attrs, skills: e.skills ? { ...e.skills } : { composure: e.rank === 'minion' ? 0 : 2 },
    hp: { now: st.hp, max: st.hp }, armor: st.armor,
    ...(bridged ? { load: { now: 0, max: st.load! } } : {}),
    layers: 0, layersMax: st.layers, sensitivity: st.sensitivity, sink: 0,
    ap: { now: st.ap, max: st.ap, regen: 3 }, pools: {},
    weapons: buildWeapons(k.content, e, grade, st.attack), wield: 0,
    evade: st.evade, initBonus: attrMod(attrs.reflex), statuses: [], dmgMult: st.dmgMult, tags,
    quick: e.quick ? e.quick.map((q) => ({ ...q })) : e.mode === 'capture' ? [{ item: 'it_zip_tie', qty: 2 }] : [],
    uses: {}, wounds: {}, ext: {},
    ai: {
      focus: e.ai.focus, floor: e.ai.floor ?? 1, ...(e.ai.prefer !== undefined ? { prefer: e.ai.prefer } : {}), mode: e.mode, fleeBelow: e.ai.flee_below,
      ...(e.ai.never_flee !== undefined ? { neverFlee: e.ai.never_flee } : {}),
      prefer_slots: [...e.position.prefer], coverUse: e.position.cover_use ?? 0.5,
    },
  }
}

// ---- 遭遇 ----

const RANK_ORDER: Record<string, number> = { minion: 0, elite: 1, boss: 2 }

/** 遭遇的點數：每個敵人 points[rank]；高一級以上 ×1.75；強度係數（雜兵不乘）也乘上去。 */
export function encounterPoints(k: Cx, foes: EncounterFoe[], grade: number): number {
  let total = 0
  for (const f of foes) {
    const e = resolveEnemy(k.content, f.enemy)
    const fg = f.grade !== undefined ? f.grade : gradeIn(e, grade)
    const s = e.rank === 'minion' ? 1 : f.strength ?? e.strength ?? (e.named ? 1.3 : 1)
    total += ENEMY_CURVE.points[e.rank] * (fg >= grade + 1 ? 1.75 : 1) * s
  }
  return total
}

/** 照遭遇的資料組出開打的設定。找不到就丟錯。 */
export function setupFromEncounter(k: Cx, _state: GameState, encounterId: string, o: { allies: UnitRef[] }): BattleSetup {
  const enc = k.content.get<EncounterEntry>('encounter', encounterId)
  if (!enc) throw new Error(`沒有 ${encounterId} 這個遭遇`)
  // 沒寫勢力時用位階最高的那個敵人的（一樣高取前面的；none 就不寫）
  let faction = enc.faction
  if (faction === undefined) {
    let best: EnemyEntry | undefined
    for (const f of enc.foes) {
      const e = resolveEnemy(k.content, f.enemy)
      if (!best || RANK_ORDER[e.rank]! > RANK_ORDER[best.rank]!) best = e
    }
    faction = best?.faction
  }
  const foes = enc.foes.map((f): UnitRef => ({
    from: 'enemy', id: f.enemy,
    ...(f.grade !== undefined ? { grade: f.grade } : {}), ...(f.slot !== undefined ? { slot: f.slot } : {}), ...(f.strength !== undefined ? { strength: f.strength } : {}),
  }))
  return {
    mode: 'meat', grade: enc.grade as Grade, cover: enc.cover, allies: o.allies, foes,
    origin: { encounter: encounterId, escapable: enc.escapable ?? true, place: enc.name, ...(faction && faction !== 'none' ? { faction } : {}) },
    ...(enc.ambush ? { ambush: enc.ambush } : {}), ...(enc.field ? { field: enc.field } : {}), ...(enc.nodes ? { nodes: enc.nodes } : {}),
  }
}
