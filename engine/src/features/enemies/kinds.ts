// 內容種類 enemy 與 encounter 的格式（ENEMIES 第 2 節與 13 節；dev/work/M1-enemies.md 第三節）。

import type { ContentRegistry, Kernel } from '../../core'
import { ATTR_IDS, DAMAGE_TYPES, UNIT_RANKS } from '../../core'
import { lootProblems, lootRefs } from './loot'

export const OWNER = 'enemies'
export const ENEMY_KINDS = ['human', 'unbridged', 'machine', 'vehicle', 'mech', 'mascot', 'lace', 'program'] as const
export const ENEMY_MODES = ['lethal', 'neural', 'capture'] as const
export const AI_PREFERS = ['weakest', 'overloaded', 'leader', 'nearest', 'netrunner', 'bridged'] as const
export const ENCOUNTER_KINDS = ['light', 'normal', 'heavy', 'boss'] as const
export const COVER_LAYOUT_IDS = ['dense', 'medium', 'sparse', 'one_sided'] as const
/** 沒有橋的種類：沒有感載這一條（ENEMIES 第 2 節的欄位表）。 */
export const UNBRIDGED_KINDS: readonly string[] = ['unbridged', 'machine', 'vehicle', 'mascot']

export interface EnemyWeapon {
  class: string
  name?: string
  type?: string
  traits?: string[]
  pierce?: number
  range?: [number, number]
  mag?: number
}
export interface EnemyMods {
  hp?: number
  load?: number
  armor?: number
  evade?: number
  attack?: number
  ap?: number
  layers?: number
  sensitivity?: number
}
export interface EnemyEntry {
  id: string
  name: string
  desc: string
  faction: string
  branch?: string
  rank: (typeof UNIT_RANKS)[number]
  grades: [number, number]
  kind: (typeof ENEMY_KINDS)[number]
  position: { prefer: number[]; cover_use?: number }
  mode: (typeof ENEMY_MODES)[number]
  weapons: EnemyWeapon[]
  ai: { prefer?: string; focus: number; flee_below: number; floor?: number; never_flee?: boolean; morale?: unknown }
  mods?: EnemyMods
  attrs?: Record<string, number>
  skills?: Record<string, number>
  quick?: Array<{ item: string; qty: number }>
  named?: boolean
  base?: string
  strength?: number
  defeat?: string
  adult?: string[] | null
  signature?: unknown[]
  /** 掉落（ENEMIES 第 7 節；格式見 loot.ts）：{ item, chance, qty?, top? } 或還沒轉的 { text } */
  loot?: unknown[]
  /** 照等級掉現金晶片；false 是企業的人（身上沒有現金）。預設 true */
  cash?: boolean
  traits?: string[]
  angel?: string
  [field: string]: unknown
}
export interface EncounterFoe {
  enemy: string
  grade?: number
  slot?: number
  strength?: number
}
export interface EncounterEntry {
  id: string
  name: string
  grade: number
  kind?: (typeof ENCOUNTER_KINDS)[number]
  cover: string
  foes: EncounterFoe[]
  escapable?: boolean
  faction?: string
  ambush?: 'ally' | 'foe'
  field?: Record<string, boolean | number | string>
  nodes?: Array<{ kind: string; name?: string }>
  [field: string]: unknown
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const oneOf = (list: readonly unknown[], v: unknown) => list.includes(v)

/** 有 base 的那一筆：先拿 base 的整筆，再用自己寫的欄位蓋上去（淺的合併）。 */
export function mergeBase(base: Record<string, unknown>, own: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...own }
}

/** 一筆敵人資料，base 一層一層展開之後的樣子。找不到或繞圈就丟錯。 */
export function resolveEnemy(content: ContentRegistry, id: string, seen: string[] = []): EnemyEntry {
  const e = content.get<EnemyEntry>('enemy', id)
  if (!e) throw new Error(`沒有 ${id} 這個敵人`)
  if (typeof e.base !== 'string') return e
  if (seen.includes(id) || seen.length > 8) throw new Error(`敵人 ${id} 的 base 繞圈了：${[...seen, id].join(' → ')}`)
  const base = resolveEnemy(content, e.base, [...seen, id])
  return mergeBase(base as Record<string, unknown>, e as Record<string, unknown>) as EnemyEntry
}

/**
 * 檢查一筆敵人。partial 是「有 base 但 base 現在還找不到」（同一批內容裡還沒載入）：這時只檢查寫了的欄位的格式，不檢查必填；
 * 必填留到 base 展開之後（resolveEnemy 之後的使用處）。
 */
function enemyProblems(e: Record<string, unknown>, partial: boolean): string[] {
  const p: string[] = []
  const need = (key: string, ok: (v: unknown) => boolean, msg: string) => {
    if (e[key] === undefined) { if (!partial) p.push(`要有 ${key}（${msg}）`); return }
    if (!ok(e[key])) p.push(`${key} ${msg}`)
  }
  const opt = (key: string, ok: (v: unknown) => boolean, msg: string) => { if (e[key] !== undefined && !ok(e[key])) p.push(`${key} ${msg}`) }

  need('name', isText, '要是名字')
  need('desc', isText, '要是外觀的完整句子')
  need('faction', isText, '要是勢力的 id，沒有勢力寫 none')
  opt('branch', (v) => typeof v === 'string', '要是字串')
  need('rank', (v) => oneOf(UNIT_RANKS, v), `只能是 ${UNIT_RANKS.join('、')}`)
  need('grades', (v) => Array.isArray(v) && v.length === 2 && v.every(isInt) && v[0]! >= 1 && v[1]! <= 5 && v[0]! <= v[1]!, '要是 [最低, 最高]，1～5，最低不超過最高')
  need('kind', (v) => oneOf(ENEMY_KINDS, v), `只能是 ${ENEMY_KINDS.join('、')}`)
  need('mode', (v) => oneOf(ENEMY_MODES, v), `只能是 ${ENEMY_MODES.join('、')}`)

  need('position', (v) => isRec(v), '要是 { prefer, cover_use? }')
  if (isRec(e.position)) {
    const pos = e.position
    if (!(Array.isArray(pos.prefer) && pos.prefer.length >= 1 && pos.prefer.every((s) => isInt(s) && s >= 1 && s <= 4))) p.push('position.prefer 要是至少一個 1～4 的整數')
    if (pos.cover_use !== undefined && !(isNum(pos.cover_use) && pos.cover_use >= 0 && pos.cover_use <= 1)) p.push('position.cover_use 要是 0～1 的數字')
  }

  need('weapons', (v) => Array.isArray(v), '要是武器的陣列（可以是空的：沒有武器的單位不攻擊，戰鬥裡手上沒有武器）')
  if (Array.isArray(e.weapons)) {
    e.weapons.forEach((w, i) => {
      const at = `weapons[${i}]`
      if (!isRec(w)) return void p.push(`${at} 要是物件`)
      if (!isText(w.class)) p.push(`${at}.class 要是武器類型的 id`)
      if (w.name !== undefined && !isText(w.name)) p.push(`${at}.name 要是名字`)
      if (w.type !== undefined && !oneOf(DAMAGE_TYPES, w.type)) p.push(`${at}.type 只能是 ${DAMAGE_TYPES.join('、')}`)
      if (w.traits !== undefined && !isTextList(w.traits)) p.push(`${at}.traits 要是字串的陣列`)
      if (w.pierce !== undefined && !(isInt(w.pierce) && w.pierce >= 0)) p.push(`${at}.pierce 要是 0 以上的整數（這一把最後的穿甲）`)
      if (w.range !== undefined && !(Array.isArray(w.range) && w.range.length === 2 && w.range.every(isInt) && w.range[0]! >= 1 && w.range[0]! <= w.range[1]! && w.range[1]! <= 7)) p.push(`${at}.range 要是 [近, 遠]，在 1～7 之間`)
      if (w.mag !== undefined && !(isInt(w.mag) && w.mag >= 1 && w.mag <= 4)) p.push(`${at}.mag 要是 1～4（格）`)
    })
  }

  need('ai', (v) => isRec(v), '要是 { prefer, focus, flee_below, … }')
  if (isRec(e.ai)) {
    const ai = e.ai
    if (ai.prefer !== undefined && !oneOf(AI_PREFERS, ai.prefer)) p.push(`ai.prefer 只能是 ${AI_PREFERS.join('、')}`)
    if (!isNum(ai.focus)) p.push('ai.focus 要是數字')
    if (!(isNum(ai.flee_below) && ai.flee_below >= 0 && ai.flee_below <= 1)) p.push('ai.flee_below 要是 0～1 的數字')
    if (ai.floor !== undefined && !isNum(ai.floor)) p.push('ai.floor 要是數字')
    if (ai.never_flee !== undefined && typeof ai.never_flee !== 'boolean') p.push('ai.never_flee 要是 true 或 false')
  }

  if (e.mods !== undefined) {
    if (!isRec(e.mods)) p.push('mods 要是物件')
    else {
      for (const [k, v] of Object.entries(e.mods)) {
        if (k === 'hp' || k === 'load') { if (!(isNum(v) && v >= 0.5 && v <= 1.5)) p.push(`mods.${k} 要是 0.5～1.5 的倍數`) }
        else if (k === 'armor' || k === 'evade' || k === 'attack' || k === 'ap' || k === 'layers') { if (!isInt(v)) p.push(`mods.${k} 要是整數（加減）`) }
        else if (k === 'sensitivity') { if (!(isNum(v) && v >= 0 && v <= 100)) p.push('mods.sensitivity 要是 0～100') }
        else p.push(`mods.${k} 不是可以修正的鍵（只有 hp、load、armor、evade、attack、ap、layers、sensitivity）`)
      }
    }
  }
  const numMap = (key: string, keys?: readonly string[]) => {
    if (e[key] === undefined) return
    if (!isRec(e[key])) return void p.push(`${key} 要是物件`)
    for (const [k, v] of Object.entries(e[key] as Record<string, unknown>)) {
      if (keys && !keys.includes(k)) p.push(`${key}.${k} 不是屬性的 id`)
      else if (!isNum(v)) p.push(`${key}.${k} 要是數字`)
    }
  }
  numMap('attrs', ATTR_IDS)
  numMap('skills')
  if (e.quick !== undefined) {
    if (!(Array.isArray(e.quick) && e.quick.every((q) => isRec(q) && isText(q.item) && isInt(q.qty) && q.qty >= 1))) p.push('quick 要是 [{ item, qty }]，qty 是 1 以上的整數')
  }
  opt('named', (v) => typeof v === 'boolean', '要是 true 或 false')
  opt('base', isText, '要是制式兵種的 id')
  opt('strength', (v) => isNum(v) && v > 0 && v <= 2, '（強度係數）要是 0 到 2 之間的數字')
  opt('defeat', (v) => typeof v === 'string', '要是字串')
  opt('adult', (v) => v === null || isTextList(v), '要是字串的陣列或 null')
  opt('signature', Array.isArray, '要是陣列')
  p.push(...lootProblems(e))
  opt('traits', isTextList, '要是字串的陣列')
  opt('angel', (v) => typeof v === 'string', '要是字串')
  return p
}

export function registerKinds(k: Pick<Kernel, 'content'>): void {
  k.content.defineKind<EnemyEntry>({
    kind: 'enemy', owner: OWNER,
    validate(e) {
      if (typeof e.base === 'string') {
        // base 找得到就合併之後完整檢查；找不到（同一批裡還沒載入）只檢查寫了的欄位
        let merged: EnemyEntry | undefined
        try { if (k.content.has('enemy', e.base)) merged = mergeBase(resolveEnemy(k.content, e.base) as Record<string, unknown>, e) as EnemyEntry } catch { merged = undefined }
        return enemyProblems(merged ?? e, !merged)
      }
      return enemyProblems(e, false)
    },
    refs: (e) => [
      ...(e.faction && e.faction !== 'none' ? [['faction', e.faction] as [string, string]] : []),
      ...(Array.isArray(e.weapons) ? e.weapons.map((w) => ['weapon_class', w.class] as [string, string]) : []),
      ...(e.base ? [['enemy', e.base] as [string, string]] : []),
      ...(Array.isArray(e.quick) ? e.quick.map((q) => ['item', q.item] as [string, string]) : []),
      ...lootRefs(k.content, e),
    ],
  })

  k.content.defineKind<EncounterEntry>({
    kind: 'encounter', owner: OWNER,
    validate(e) {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name（地點或場合）')
      if (!(isInt(e.grade) && e.grade >= 1 && e.grade <= 5)) p.push('grade 要是 1～5 的整數')
      if (e.kind !== undefined && !oneOf(ENCOUNTER_KINDS, e.kind)) p.push(`kind 只能是 ${ENCOUNTER_KINDS.join('、')}`)
      if (!oneOf(COVER_LAYOUT_IDS, e.cover)) p.push(`cover 只能是 ${COVER_LAYOUT_IDS.join('、')}`)
      if (!(Array.isArray(e.foes) && e.foes.length >= 1)) p.push('foes 要有至少一筆')
      else {
        e.foes.forEach((f, i) => {
          const at = `foes[${i}]`
          if (!isRec(f)) return void p.push(`${at} 要是物件`)
          if (!isText(f.enemy)) p.push(`${at}.enemy 要是敵人的 id`)
          if (f.grade !== undefined && !(isInt(f.grade) && f.grade >= 1 && f.grade <= 5)) p.push(`${at}.grade 要是 1～5 的整數`)
          if (f.slot !== undefined && !(isInt(f.slot) && f.slot >= 1 && f.slot <= 4)) p.push(`${at}.slot 要是 1～4 的整數`)
          if (f.strength !== undefined && !(isNum(f.strength) && f.strength > 0 && f.strength <= 2)) p.push(`${at}.strength 要是 0 到 2 之間的數字`)
        })
      }
      if (e.escapable !== undefined && typeof e.escapable !== 'boolean') p.push('escapable 要是 true 或 false')
      if (e.faction !== undefined && !isText(e.faction)) p.push('faction 要是勢力的 id')
      if (e.ambush !== undefined && e.ambush !== 'ally' && e.ambush !== 'foe') p.push('ambush 只能是 ally 或 foe')
      if (e.field !== undefined && !(isRec(e.field) && Object.values(e.field).every((v) => ['boolean', 'number', 'string'].includes(typeof v)))) p.push('field 要是 { 名字: 布林、數字或字串 }')
      if (e.nodes !== undefined && !(Array.isArray(e.nodes) && e.nodes.every((n) => isRec(n) && isText(n.kind) && (n.name === undefined || isText(n.name))))) p.push('nodes 要是 [{ kind, name? }]')
      return p
    },
    refs: (e) => [
      ...(Array.isArray(e.foes) ? e.foes.map((f) => ['enemy', f.enemy] as [string, string]) : []),
      ...(e.faction && e.faction !== 'none' ? [['faction', e.faction] as [string, string]] : []),
    ],
  })
}
