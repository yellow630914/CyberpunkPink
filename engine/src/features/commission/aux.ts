// L6 功能 commission 的輔助面結算（COMMISSIONS 2.3 節的表、6.2～6.4 節；UI 7.4 節「輔助結算」；dev/work/M2-commission-aux.md）。
//
// 每個階段選好面的那一刻（commission.face 那一份報告），這個階段可選、玩家沒選、有人派去而且沒在休息的面各擲一次：
//   1d20 ＋ 那一面在場的人裡最高的相關基本功 ＋ 分量修正 ＋（人數 − 1）　對　10 ＋ 副本的等級 × 2
//   超過 5 以上（或自然 20）：拿到連動、壓力不漲；成功：拿到連動；失敗：壓力 +10（輿論面沒有壓力條，不加）；自然 1：出事（照失敗算，另外那個人受傷、那一面撤一個階段）。
// 派去的人來自 setup.aux（怎麼請到人是 fixer 的事）；分量修正讀角色的 ext.paths（DATA 第 8 節）與內容 path 的 domains；借來的人（setup.aux.borrowed）沒有分量修正。
// 純函式：回傳要併進選面那份報告的變更、時間軸的一拍與新的 Run；不碰登錄表、不 import 別的功能。

import type { Change, CheckRoll, ContentEntry, GameState, Kernel, TimelineBeat } from '../../core'
import { MINUTES_PER_DAY, clone, deriveRng, isRecord, makeCheck, toMinutes } from '../../core'
import type { AuxOutcome, AuxResult, AuxState, CommissionEntry, CommissionRules, Face, Run } from './model'
import { FACES, FACE_NAME, clamp, commissionRules, dcBaseOf, gradeOf } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** setup.aux 讀出來的樣子（壞掉的欄位當沒有；人數上限與重複在進副本時就擋了，這裡不再查）。 */
export interface AuxPeople {
  meat: string[]
  net: string[]
  opinion: string[]
  borrowed: string[]
}

export function auxPeople(raw: unknown): AuxPeople {
  const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(isText))] : [])
  const r = isRecord(raw) ? raw : {}
  return { meat: list(r.meat), net: list(r.net), opinion: list(r.opinion), borrowed: list(r.borrowed) }
}

// ---- 一個面的算式 ----

type Level = keyof CommissionRules['aux_bonus']

const LEVEL_OF: Record<string, Level> = { strong: 'strong', strong_support: 'strong', mid: 'mid', weak: 'weak', none: 'none' }

/** 這個人最強的一條路數在這個戰場的分量修正（沒有路數、路數查不到、格式不對都是 0）。 */
export function pathBonus(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, id: string, face: Face, rules: Pick<CommissionRules, 'aux_bonus'>): number {
  const raw = Object.hasOwn(state.actors, id) ? state.actors[id]!.ext.paths : undefined
  if (!Array.isArray(raw)) return 0
  let best = 0
  for (const row of raw) {
    if (!isRecord(row) || !isText(row.path)) continue
    const domains = k.content.get<ContentEntry & { domains?: unknown }>('path', row.path)?.domains
    const level = isRecord(domains) && typeof domains[face] === 'string' ? LEVEL_OF[domains[face] as string] : undefined
    if (level !== undefined) best = Math.max(best, rules.aux_bonus[level])
  }
  return best
}

interface Candidate {
  id: string
  skill: string
  level: number
  path: number
}

/** 這個人在這一面最高的相關基本功（同分取先列的）。 */
function bestSkill(state: Pick<GameState, 'actors'>, id: string, skills: string[]): { skill: string; level: number } {
  const a = state.actors[id]!
  let best = { skill: skills[0] ?? '', level: 0 }
  for (const s of skills) {
    const level = a.skills[s] ?? 0
    if (level > best.level) best = { skill: s, level }
  }
  return best
}

export interface AuxSum {
  face: Face
  /** 在場的人（state.actors 裡真的有的，照派的順序） */
  people: string[]
  roller: string
  skill: string
  bonus: { skill: number; path: number; crowd: number; total: number }
  dc: number
}

/**
 * 一個面的算式：在場的人裡最高的相關基本功（同級取分量修正高的、再取先列的）就是擲骰的人，分量修正也看他；借來的人沒有分量修正；人數 − 1 加進去。
 * 沒有人在場（沒派、或派的人不在 state.actors）回傳 null。
 */
export function auxSum(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, def: CommissionEntry, face: Face, ids: string[], borrowed: string[] = [], rules?: CommissionRules): AuxSum | null {
  const r = rules ?? commissionRules(k)
  const people = [...new Set(ids)].filter((id) => Object.hasOwn(state.actors, id))
  if (people.length === 0) return null
  const skills = r.aux_skills[face]
  let best: Candidate | undefined
  for (const id of people) {
    const { skill, level } = bestSkill(state, id, skills)
    const path = borrowed.includes(id) ? 0 : pathBonus(k, state, id, face, r)
    if (!best || level > best.level || (level === best.level && path > best.path)) best = { id, skill, level, path }
  }
  const crowd = people.length - 1
  return {
    face, people, roller: best!.id, skill: best!.skill,
    bonus: { skill: best!.level, path: best!.path, crowd, total: best!.level + best!.path + crowd },
    dc: dcBaseOf(r, gradeOf(def.grade) ?? 1),
  }
}

/** 一顆骰面的結果：自然 1 出事（照失敗算）；大成功（超過 5 以上，或自然 20）與成功拿到連動；其餘失敗。 */
export function classify(roll: Pick<CheckRoll, 'natural' | 'degree'>): AuxOutcome {
  if (roll.natural === 1) return 'mishap'
  if (roll.degree === 'critical') return 'great'
  return roll.degree === 'success' ? 'success' : 'fail'
}

function checkOf(k: Pick<Kernel, 'stats'>, sum: AuxSum, natural: number): CheckRoll {
  return makeCheck({
    natural, dc: sum.dc, skill: sum.skill,
    parts: [
      { label: k.stats.skillName(sum.skill), value: sum.bonus.skill, source: 'skill' },
      { label: '路數', value: sum.bonus.path, source: 'path' },
      { label: '人手', value: sum.bonus.crowd, source: 'situation' },
    ],
  })
}

// ---- 成功率（召集的畫面先算） ----

export interface AuxChance extends AuxSum {
  /** 二十個骰面各落在哪一種（加起來是 20） */
  faces: Record<AuxOutcome, number>
  /** 拿到連動的機率（百分比，大成功加成功） */
  chance: number
  /** 出事的機率（自然 1，百分比） */
  mishap: number
}

/**
 * 派這些人去這一面，擲一次拿到連動的機會有多大。還沒進副本也能問（召集的畫面）：def 只用到等級，actors 是要派的人，borrowed 是其中向中間人借的。
 * 沒有人在場回傳 null。
 */
export function auxChance(k: Pick<Kernel, 'content' | 'stats'>, state: Pick<GameState, 'actors'>, def: CommissionEntry, face: Face, actors: string[], borrowed: string[] = []): AuxChance | null {
  const sum = auxSum(k, state, def, face, actors, borrowed)
  if (!sum) return null
  const faces: Record<AuxOutcome, number> = { great: 0, success: 0, fail: 0, mishap: 0 }
  for (let natural = 1; natural <= 20; natural++) faces[classify(checkOf(k, sum, natural))]++
  return { ...sum, faces, chance: (faces.great + faces.success) * 5, mishap: faces.mishap * 5 }
}

// ---- 這個階段的狀況 ----

/** 這一面這個階段在休息嗎（出事之後撤的階段）。 */
export const resting = (run: Pick<Run, 'aux'>, face: Face, stage: number): boolean => stage <= (run.aux?.rest[face] ?? 0)

/** 這個階段可選的面（照現實、內海、輿論的順序）。 */
export const openFaces = (run: Pick<Run, 'def'>, stage: number): Face[] => FACES.filter((f) => !!run.def.stages[stage - 1]?.faces[f])

/** 這個階段、這一面現在在場的人（派了、而且是真的角色）。 */
export const peopleAt = (state: Pick<GameState, 'actors'>, run: Pick<Run, 'setup'>, face: Face): string[] => auxPeople(run.setup.aux)[face].filter((id) => Object.hasOwn(state.actors, id))

// ---- 結算 ----

export interface AuxSettlement {
  /** 套上結算之後的 Run（連動、警戒、壓力、休息、紀錄） */
  run: Run
  /** 要接在 stage 快照後面、runChange 前面的變更：亂數往前、出事的人受傷 */
  changes: Change[]
  /** 每一個擲了的面一拍（標籤 aux，帶擲骰的明細） */
  timeline: TimelineBeat[]
  /** 給玩家看的句子（擲了的、還在休息的各一句） */
  lines: string[]
  results: AuxResult[]
}

const nameOf = (state: Pick<GameState, 'actors'>, id: string): string => state.actors[id]?.name ?? id

/** 受傷到什麼時候：已經有更久的（或沒有期限的）就不動。 */
function injure(state: GameState, id: string, days: number): Change[] {
  const until = toMinutes(state.time) + days * MINUTES_PER_DAY
  const had = state.actors[id]?.conditions.find((c) => c.id === 'injured')
  if (had && (had.until === undefined || had.until >= until)) return []
  return [{ op: 'actor.condition', id, condition: 'injured', until }]
}

/**
 * 結算這個階段的輔助面：run 是玩家剛選好面的樣子（run.face 是玩家選的那一面，run.stage 是這個階段）。
 * 沒有任何一面要擲（只有一個面可選、沒派人、都在休息）回傳 null，報告什麼都不多。
 */
export function settleAux(k: Kernel, state: GameState, run: Run): AuxSettlement | null {
  const n = run.stage
  const rules = commissionRules(k)
  const people = auxPeople(run.setup.aux)
  const aux: AuxState = run.aux ? clone(run.aux) : { pressure: {}, rest: {}, log: [] }
  const next: Run = { ...run, links: [...run.links] }
  const changes: Change[] = []
  const timeline: TimelineBeat[] = []
  const lines: string[] = []
  const results: AuxResult[] = []
  let rolls = 0

  for (const face of openFaces(run, n)) {
    if (face === run.face) continue
    const sum = auxSum(k, state, run.def, face, people[face], people.borrowed, rules)
    if (!sum) continue
    if (resting(run, face, n)) {
      lines.push(`${FACE_NAME[face]}面的人上一次出了事，這個階段還在休息，不擲。`)
      continue
    }
    rolls++
    const natural = deriveRng(state.rng, `commission/${run.def.id}/${n}/aux/${face}`).int(1, 20)
    const roll = checkOf(k, sum, natural)
    const outcome = classify(roll)
    const result: AuxResult = { stage: n, face, people: sum.people, roller: sum.roller, skill: sum.skill, bonus: { skill: sum.bonus.skill, path: sum.bonus.path, crowd: sum.bonus.crowd }, roll, outcome }
    const notes: string[] = []

    if (outcome === 'great' || outcome === 'success') {
      const gives = run.def.stages[n - 1]?.faces[face]?.gives
      if (gives === undefined) notes.push('這一面這個階段沒有連動可拿。')
      else if (next.links.some((l) => l.id === gives)) notes.push(`連動「${run.def.links[gives]?.name ?? gives}」已經有了。`)
      else {
        next.links.push({ id: gives, from: n, face, aux: true })
        result.link = gives
        notes.push(`拿到連動「${run.def.links[gives]?.name ?? gives}」。`)
      }
      if (outcome === 'great') notes.push('贏得漂亮，壓力沒有漲。')
    } else {
      // 失敗與出事：壓力 +10（輿論面沒有壓力條）
      if (face !== 'opinion' && rules.aux_pressure > 0) {
        if (face === 'meat') {
          const before = next.alert
          next.alert = clamp(before + rules.aux_pressure, 0, 100)
          next.peak = Math.max(next.peak, next.alert)
          result.pressure = next.alert - before
        } else {
          const before = aux.pressure[face] ?? 0
          const after = clamp(before + rules.aux_pressure, 0, 100)
          aux.pressure[face] = after
          result.pressure = after - before
        }
        notes.push(face === 'meat' ? `警戒 +${result.pressure}。` : `壓力 +${result.pressure}。`)
      } else notes.push('沒拿到連動。')
    }
    if (outcome === 'mishap') {
      const who = sum.roller
      changes.push(...injure(state, who, rules.aux_injured_days))
      result.injured = who
      if (rules.aux_rest > 0) {
        result.rest_until = n + rules.aux_rest
        aux.rest[face] = n + rules.aux_rest
      }
      notes.push(`出事了：${nameOf(state, who)}受傷（${rules.aux_injured_days} 天）${rules.aux_rest > 0 ? `，這一面撤一個階段，第 ${n + rules.aux_rest} 階段不擲` : ''}。`)
    }

    const parts = `骰 ${roll.natural} ＋ ${k.stats.skillName(sum.skill)} ${sum.bonus.skill} ＋ 路數 ${sum.bonus.path} ＋ 人手 ${sum.bonus.crowd} ＝ ${roll.total}，對 ${roll.dc}`
    const text = `輔助・${FACE_NAME[face]}面（${sum.people.map((id) => nameOf(state, id)).join('、')}）：${parts}。${notes.join('')}`
    timeline.push({
      layer: face === 'net' ? 'net' : 'meat', actor: sum.roller, tag: 'aux', roll, text,
      data: { face, stage: n, outcome, people: sum.people, roller: sum.roller, skill: sum.skill, bonus: { ...sum.bonus }, dc: sum.dc, ...(result.link ? { link: result.link } : {}), ...(result.pressure ? { pressure: result.pressure } : {}), ...(result.injured ? { injured: result.injured, rest_until: result.rest_until ?? null } : {}) },
    })
    lines.push(text)
    results.push(result)
  }

  if (rolls === 0 && lines.length === 0) return null
  if (rolls > 0) changes.unshift({ op: 'rng', advance: rolls })
  aux.log = [...aux.log, ...results]
  if (rolls > 0 || run.aux) next.aux = aux
  return { run: next, changes, timeline, lines, results }
}
