// L6 功能 scene 的資料與純函式：內容種類、規則數字、場景狀態、讀角色身上的資料。不碰登錄表（登錄在 index.ts）。
// 規格：LEWD_SYSTEM 第 3 節（3.5 節是完整的規則）；DATA 第 3 節（3.1 夜課的 scene 欄位、3.2 體位、3.3 成人道具、3.4 部位）、第 4 節 adult_scene；
//       CORE_RULES 4.2 節；dev/adr/0016 G6、G11；dev/work/M2-scene.md。
// 不 import 別的功能：橋參數與傾向只認 DATA 第 8 節的格式（actor.ext.bridge、actor.ext.tendency），敏感度優先問 k.stats 的 bridge_sensitivity。

import type { Actor, ActorId, ContentEntry, GameState, Kernel, Origin, SyncGear, TimelineBeat } from '../../core'
import { SYNC_GEARS, clone, isRecord, isSyncGear, syncCapOf, syncGearIndex } from '../../core'

export const OWNER = 'scene'
/** state.ext 的鍵、活動的種類。 */
export const EXT = 'scene'
export const ACTIVITY = 'scene'

export const POSITION_KIND = 'position'
export const SKILL_KIND = 'night_skill'
export const RULE_KIND = 'scene_rule'

// ---- 名字與固定的清單 ----

export const NATURES = ['mutual', 'trade', 'work', 'contract', 'forced', 'captive'] as const
export type Nature = (typeof NATURES)[number]
export const NATURE_NAME: Record<Nature, string> = { mutual: '兩情相悅', trade: '交易', work: '工作', contract: '契約', forced: '被迫', captive: '俘虜' }
export const isNature = (v: unknown): v is Nature => (NATURES as readonly unknown[]).includes(v)

export const ROLES = ['guest', 'worker', 'holder', 'bound', 'none'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_NAME: Record<Role, string> = { guest: '客人', worker: '工作的人', holder: '持約人', bound: '契約人', none: '沒有特別的身分' }
export const isRole = (v: unknown): v is Role => (ROLES as readonly unknown[]).includes(v)

export const GOALS = ['info', 'please', 'obey', 'stall', 'footage'] as const
export type Goal = (typeof GOALS)[number]
export const GOAL_NAME: Record<Goal, string> = { info: '套話', please: '取悅', obey: '讓對方聽話', stall: '拖住對方', footage: '拿素材' }
export const isGoal = (v: unknown): v is Goal => (GOALS as readonly unknown[]).includes(v)

/** 性質對應的內容篩選標籤（LEWD_SYSTEM 第 9 節、ENEMIES 6.1 節）：關掉時這一種場景開不起來。 */
export const NATURE_FILTER: Partial<Record<Nature, { tag: string; name: string }>> = {
  forced: { tag: 'pc_unwilling', name: '主角非自願' },
  captive: { tag: 'target_unwilling', name: '對象非自願' },
  contract: { tag: 'contract_dom', name: '契約支配' },
}

/** 場景的部位（LEWD_SYSTEM 3.5 節第四點；DATA 3.2、3.4）。「前」不分哪一種身體。 */
export const BASE_PARTS = ['mouth', 'hand_l', 'hand_r', 'chest', 'front', 'back', 'legs'] as const
export const PART_NAME: Record<string, string> = {
  mouth: '口', hand_l: '左手', hand_r: '右手', chest: '胸', front: '前', back: '後', legs: '腿足', toy: '道具', tail: '尾', tentacle: '觸手',
}
export const partName = (id: string): string => PART_NAME[id] ?? id
/** 說話可以用的自己的部位：口或手勢（LEWD_SYSTEM 3.5 節第五點）。 */
export const TALK_PARTS: readonly string[] = ['mouth', 'hand_l', 'hand_r']

export type Who = 'pc' | 'partner'
export const other = (w: Who): Who => (w === 'pc' ? 'partner' : 'pc')

/** 十種行動（LEWD_SYSTEM 3.5 節第五點；第十種「換檔」是 M3-scene-sync 加的）。end_turn 不是行動，是把回合交出去。 */
export const ACTIONS = ['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear', 'stop'] as const
export type ActionId = (typeof ACTIONS)[number]
export const ACTION_NAME: Record<ActionId | 'end_turn', string> = {
  dominate: '主導', yield: '迎合', tease: '挑逗', restrain: '克制', skill: '技能', talk: '說話', item: '道具', switch: '切換體位', gear: '換檔', stop: '停下', end_turn: '結束回合',
}

// ---- 骰子 ----

/** 一組骰：正負號、顆數、面數、固定值。my_load 與 their_load 寫成 "2d6"、"1d6" 或 0；負的是減輕（藥、冷靜貼片）。 */
export interface Die { sign: 1 | -1; n: number; sides: number; flat: number }
export const NO_DIE: Die = { sign: 1, n: 0, sides: 0, flat: 0 }
const DIE_RE = /^(-?)(\d*)d(\d+)$/

/** 沒寫是沒有；格式不對是 null。 */
export function parseDie(v: unknown): Die | null {
  if (v === undefined || v === null) return NO_DIE
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { sign: v < 0 ? -1 : 1, n: 0, sides: 0, flat: Math.abs(v) } : null
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, '')
  if (/^-?\d+$/.test(t)) return parseDie(Number(t))
  const m = DIE_RE.exec(t)
  if (!m) return null
  const n = m[2] === '' ? 1 : Number(m[2])
  const sides = Number(m[3])
  if (n < 1 || n > 20 || sides < 2 || sides > 100) return null
  return { sign: m[1] === '-' ? -1 : 1, n, sides, flat: 0 }
}

export const isNoDie = (d: Die): boolean => d.n === 0 && d.flat === 0

/** 一組骰的文字（預覽與連接用）：2d6、−1d6、0。 */
export function dieText(d: Die): string {
  if (isNoDie(d)) return '0'
  const body = d.n > 0 ? `${d.n}d${d.sides}${d.flat ? `+${d.flat}` : ''}` : String(d.flat)
  return d.sign < 0 ? `−${body}` : body
}

export interface Dice {
  int(min: number, max: number): number
}

/** 擲一組骰（extra 是多出來的顆數，挑逗的下一個行動；沒有骰子的不加）。順序固定：一顆一顆照序擲。 */
export function rollDie(dice: Dice, d: Die, extra = 0): number {
  let total = d.flat
  const n = d.n > 0 ? d.n + extra : 0
  for (let i = 0; i < n; i++) total += dice.int(1, d.sides)
  return d.sign * total
}

/** 骰面的範圍與平均（預覽用）。 */
export function dieRange(d: Die, extra = 0): { min: number; max: number; avg: number } {
  const n = d.n > 0 ? d.n + extra : 0
  const a = d.flat + n
  const b = d.flat + n * d.sides
  const avg = d.flat + (n * (d.sides + 1)) / 2
  return d.sign < 0 ? { min: -b, max: -a, avg: -avg } : { min: a, max: b, avg }
}

// ---- 規則 ----

export interface RatingBand {
  min: number
  id: string
  name: string
  /** 親密度的變化（ADR G11：−1／+2／+5／+8） */
  affinity: number
  /** 體悟（LEWD_SYSTEM 3.5 節第六點的表） */
  insight: number
  /** 橋參數這一場有機會 +1 的機率（ADR G11：合拍 25%、難忘 50%） */
  bridge: number
}

export interface SceneRules {
  ap_regen: number
  fit_start: number
  init_base: number
  init_docility_div: number
  /** 性質與身分對開場主動權的加減（LEWD_SYSTEM 3.5 節第二點）；work 的 −20 由身分 worker 給，不重複算 */
  nature_init: Record<Nature, number>
  role_init: Record<Role, number>
  /** 受到的感載 = 原始值 ×（load_base + 敏感度 ÷ load_div） */
  load_base: number
  load_div: number
  /** 每一層餘韻讓自己造成的感載與契合增加的比例 */
  glow_bonus: number
  cost: { dominate: number; yield: number; tease: number; restrain: number; talk: number; switch: number }
  dominate: { their: number; mine: number; fit: number; init: number }
  yield: { their: number; mine: number; fit: number; init: number }
  tease: { their: number; mine: number; fit: number; init: number }
  /** 克制：自己的感載 −（base ＋ 意志調整值） */
  restrain_base: number
  climax_init_self: number
  climax_init_cause: number
  /** 體位沒寫 initiative_drift 時，上位的人每回合的主動權 */
  upper_drift: number
  talk_dc: number
  talk_fit: { critical: number; success: number; fail: number; fumble: number }
  talk_goal: { critical: number; success: number; fail: number; fumble: number }
  /** 換進一個體位時，有那個體位標籤的人每個人讓契合加這麼多 */
  position_tag_fit: number
  /** 技能沒寫 match_bonus 時，對方也有那個標籤的契合（LEWD_SYSTEM 3.5 節第五點：+12） */
  match_bonus: number
  /** 對方的感載達到上限的這個比例以上，他就想克制 */
  partner_restrain_at: number
  /** 對方的一步裡主導、迎合、挑逗的權重，照性質 */
  partner_weights: Record<Nature, { dominate: number; yield: number; tease: number }>
  /** 契合 ≤ quit_fit 而且過了 quit_rounds 回合：對方不玩了 */
  quit_fit: number
  quit_rounds: number
  bands: RatingBand[]
  /** 第一次和這個人、第一次的體位、第一次的標籤各加多少體悟 */
  first_bonus: number
  skip_mult: number
  /** 目的的進度到這裡算達成 */
  goal_done_at: number
  /** 拖住：每過一回合；取悅：對方每高潮一次 */
  goal_stall_per_round: number
  goal_please_per_climax: number
  /** 略過時算契合：基底 ＋ 共同的標籤數 × per_tag ＋（對方的敏感度 − 50）÷ sens_div ＋ 0～(spread − 1) 的亂數 */
  skip: { base: number; per_tag: number; sens_div: number; spread: number }
  /** 略過時目的的進度：min(cap, base ＋ 契合 ÷ 2) */
  skip_goal: { base: number; cap: number }
}

/** 對方的回合開始時，感載達到上限的這個比例以上，他退一檔（同步檔位；LEWD_SYSTEM 3.5 節第五點「換檔」）。 */
export const PARTNER_GEAR_DOWN_AT = 0.7
/** 全檔過載加的沉溺，一場結算時最多加這麼多（CORE_RULES 4.3 節：每場 −4～+4）。 */
export const SINK_CAP = 4

export const DEFAULT_SCENE_RULES: SceneRules = {
  ap_regen: 3,
  fit_start: 20,
  init_base: 50,
  init_docility_div: 4,
  nature_init: { mutual: 0, trade: 0, work: 0, contract: 0, forced: -35, captive: 30 },
  role_init: { guest: 20, holder: 20, worker: -20, bound: -20, none: 0 },
  load_base: 0.75,
  load_div: 200,
  glow_bonus: 0.1,
  cost: { dominate: 2, yield: 2, tease: 1, restrain: 1, talk: 1, switch: 1 },
  dominate: { their: 2, mine: 1, fit: 2, init: 10 },
  yield: { their: 1, mine: 2, fit: 8, init: -10 },
  tease: { their: 1, mine: 1, fit: 4, init: 5 },
  restrain_base: 2,
  climax_init_self: -15,
  climax_init_cause: 10,
  upper_drift: 3,
  talk_dc: 13,
  talk_fit: { critical: 10, success: 5, fail: -2, fumble: -5 },
  talk_goal: { critical: 20, success: 12, fail: 4, fumble: 0 },
  position_tag_fit: 2,
  match_bonus: 12,
  partner_restrain_at: 0.7,
  partner_weights: {
    mutual: { dominate: 3, yield: 3, tease: 2 },
    trade: { dominate: 2, yield: 4, tease: 2 },
    work: { dominate: 1, yield: 4, tease: 3 },
    contract: { dominate: 4, yield: 2, tease: 2 },
    forced: { dominate: 5, yield: 1, tease: 2 },
    captive: { dominate: 1, yield: 5, tease: 2 },
  },
  quit_fit: 10,
  quit_rounds: 3,
  bands: [
    { min: 85, id: 'unforgettable', name: '難忘', affinity: 8, insight: 20, bridge: 0.5 },
    { min: 60, id: 'fit', name: '合拍', affinity: 5, insight: 15, bridge: 0.25 },
    { min: 30, id: 'fair', name: '普通', affinity: 2, insight: 10, bridge: 0 },
    { min: 0, id: 'poor', name: '不合', affinity: -1, insight: 5, bridge: 0 },
  ],
  first_bonus: 5,
  skip_mult: 0.7,
  goal_done_at: 60,
  goal_stall_per_round: 8,
  goal_please_per_climax: 20,
  skip: { base: 35, per_tag: 15, sens_div: 2, spread: 21 },
  skip_goal: { base: 20, cap: 70 },
}

/** 評價表：每一段要有 min、id、name、affinity、insight、bridge，而且有一段從 0 起。 */
function readBands(v: unknown, at: string, problems: string[]): RatingBand[] | null {
  if (!Array.isArray(v) || v.length === 0) {
    problems.push(`${at} 要是非空的陣列`)
    return null
  }
  const rows: RatingBand[] = []
  v.forEach((b, i) => {
    if (!isRecord(b) || typeof b.id !== 'string' || typeof b.name !== 'string' || ![b.min, b.affinity, b.insight, b.bridge].every((x) => typeof x === 'number' && Number.isFinite(x))) {
      problems.push(`${at}[${i}] 要有 min、id、name、affinity、insight、bridge`)
    } else rows.push({ min: b.min as number, id: b.id, name: b.name, affinity: b.affinity as number, insight: b.insight as number, bridge: b.bridge as number })
  })
  if (rows.length !== v.length) return null
  if (!rows.some((r) => r.min <= 0)) {
    problems.push(`${at} 要有一段從 0 起`)
    return null
  }
  return rows.sort((x, y) => y.min - x.min)
}

/** 規則資料（scene_rule/default）蓋掉內建的：只收和內建同一個形狀的鍵（寫錯的鍵回報問題）；評價表整份換。 */
function merge(base: Record<string, unknown>, over: Record<string, unknown>, out: Record<string, unknown>, path: string, problems: string[]): void {
  for (const key of Object.keys(over)) {
    if (path === '' && key === 'id') continue
    const at = path ? `${path}.${key}` : key
    if (!Object.hasOwn(base, key)) {
      problems.push(`${at}：沒有這個規則`)
      continue
    }
    const b = base[key]
    const v = over[key]
    if (Array.isArray(b)) {
      const rows = readBands(v, at, problems)
      if (rows) out[key] = rows
    } else if (isRecord(b)) {
      if (!isRecord(v)) problems.push(`${at} 要是物件`)
      else merge(b, v, out[key] as Record<string, unknown>, at, problems)
    } else if (typeof b === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) problems.push(`${at} 要是數字`)
      else out[key] = v
    }
  }
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const problems: string[] = []
  merge(DEFAULT_SCENE_RULES as unknown as Record<string, unknown>, e, clone(DEFAULT_SCENE_RULES) as unknown as Record<string, unknown>, '', problems)
  return problems
}

/** 現在生效的規則：資料 scene_rule/default 蓋掉內建的預設。 */
export function sceneRules(k: Pick<Kernel, 'content'>): SceneRules {
  const e = k.content.get(RULE_KIND, 'default')
  const out = clone(DEFAULT_SCENE_RULES)
  if (e) merge(DEFAULT_SCENE_RULES as unknown as Record<string, unknown>, e, out as unknown as Record<string, unknown>, '', [])
  return out
}

export function ratingOf(rules: Pick<SceneRules, 'bands'>, fit: number): RatingBand {
  return rules.bands.find((b) => fit >= b.min) ?? rules.bands[rules.bands.length - 1]!
}

// ---- 內容：體位、夜課技能、道具的 scene ----

export interface RoleDef { id: string; upper: boolean }
export interface PositionLink { from: [string, string]; to: [string, string] }
export interface PositionEntry extends ContentEntry {
  name: string
  people: number
  roles: RoleDef[]
  links: PositionLink[]
  mult: Record<string, number>
  initiative_drift?: number
  tag?: string
  tags?: string[]
  unlocked_by?: string | null
  text?: string
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

/** 體位的格式（DATA 3.2）。M2 只收 people: 2。 */
export function positionProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isInt(e.people) || e.people < 2 || e.people > 4) p.push('people 要是 2～4 的整數')
  else if (e.people !== 2) p.push('M2 的場景只收 people: 2（二到四人的體位等多人分圈）')
  const roleIds: string[] = []
  if (!Array.isArray(e.roles) || e.roles.length !== 2) p.push('roles 要有兩個位置：{ id, upper }')
  else {
    for (const r of e.roles) {
      if (!isRecord(r) || !isText(r.id) || typeof r.upper !== 'boolean') p.push('roles 的每一個位置要有 id 與 upper（布林）')
      else roleIds.push(r.id)
    }
    if (new Set(roleIds).size !== roleIds.length) p.push('roles 的 id 不能重複')
  }
  if (!Array.isArray(e.links) || e.links.length === 0) p.push('links 要是非空的陣列：{ from: [位置, 部位], to: [位置, 部位] }')
  else {
    e.links.forEach((l, i) => {
      const ends = isRecord(l) ? [l.from, l.to] : []
      const good = ends.length === 2 && ends.every((x) => Array.isArray(x) && x.length === 2 && isText(x[0]) && isText(x[1]))
      if (!good) return void p.push(`links[${i}] 要有 from 與 to，各是 [位置, 部位]`)
      const [a, b] = ends as [string[], string[]]
      if (roleIds.length === 2 && (!roleIds.includes(a[0]!) || !roleIds.includes(b[0]!))) p.push(`links[${i}] 的位置要是 roles 裡的 id`)
      else if (a[0] === b[0]) p.push(`links[${i}] 的兩端要在不同的位置`)
    })
  }
  if (!isRecord(e.mult)) p.push('mult 要是物件：每個位置受到的感載倍率')
  else for (const id of roleIds) if (typeof e.mult[id] !== 'number' || !(e.mult[id] > 0) || !Number.isFinite(e.mult[id])) p.push(`mult.${id} 要是大於 0 的數字`)
  if (e.initiative_drift !== undefined && !isInt(e.initiative_drift)) p.push('initiative_drift 要是整數')
  if (e.tag !== undefined && !isText(e.tag)) p.push('tag 要是標籤的 id')
  if (e.tags !== undefined && !textList(e.tags)) p.push('tags 要是標籤的陣列')
  if (e.unlocked_by !== undefined && e.unlocked_by !== null && !isText(e.unlocked_by)) p.push('unlocked_by 要是 null（基本體位）或夜課技能的 id')
  return p
}

/** 一件技能或道具的 scene 欄位（DATA 3.1、3.3），整理成程式用的樣子。 */
export interface SceneDef {
  ap: number
  my_part: string[]
  their_part: string[]
  /** 道具自己算一個部位（脈衝環的 toy）：寫了它，my_part 就是它 */
  as_part?: string
  on_use: { my_load: Die; their_load: Die; fit: number; init: number }
  /** 連接持續的時候每回合生效的數值；沒寫就是沒有連接（只有 on_use） */
  link: { my_load: Die; their_load: Die; fit: number } | null
  positions: string[] | null
  match_bonus: number | null
}

/** scene 欄位的格式問題；回傳整理好的結果。道具可以沒有部位（藥）：只有 on_use，不建立連接。 */
export function readSceneDef(raw: unknown, item: boolean): { def: SceneDef } | { problems: string[] } {
  const p: string[] = []
  if (!isRecord(raw)) return { problems: ['scene 要是物件'] }
  const ap = raw.ap === undefined ? 1 : raw.ap
  if (!isInt(ap) || ap < 0 || ap > 5) p.push('scene.ap 要是 0～5 的整數')
  const list = (key: string): string[] => {
    const v = raw[key]
    if (v === undefined) return []
    if (!textList(v) || v.length === 0) {
      p.push(`scene.${key} 要是部位 id 的陣列（至少一個）`)
      return []
    }
    return v
  }
  const myPart = list('my_part')
  const theirPart = list('their_part')
  let asPart: string | undefined
  if (raw.as_part !== undefined) {
    if (!isText(raw.as_part)) p.push('scene.as_part 要是部位的 id')
    else asPart = raw.as_part
  }
  const hasLink = myPart.length > 0 || asPart !== undefined
  if (hasLink && theirPart.length === 0) p.push('scene 有自己的部位（my_part 或 as_part），就要寫 their_part')
  if (!hasLink && theirPart.length > 0) p.push('scene 寫了 their_part，就要有 my_part 或 as_part')
  if (!item && !hasLink) p.push('夜課技能的 scene 要寫 my_part 與 their_part')
  const dice = (src: unknown, where: string, keys: string[]): Record<string, Die> => {
    const out: Record<string, Die> = {}
    if (src === undefined) return out
    if (!isRecord(src)) {
      p.push(`${where} 要是物件`)
      return out
    }
    for (const key of keys) {
      const d = parseDie(src[key])
      if (!d) p.push(`${where}.${key} 要是骰（例：2d6、1d6、0）`)
      else out[key] = d
    }
    return out
  }
  const num = (src: unknown, where: string, key: string): number => {
    if (!isRecord(src) || src[key] === undefined) return 0
    if (!isInt(src[key])) {
      p.push(`${where}.${key} 要是整數`)
      return 0
    }
    return src[key] as number
  }
  const use = dice(raw.on_use, 'scene.on_use', ['my_load', 'their_load'])
  const link = raw.link === undefined ? null : dice(raw.link, 'scene.link', ['my_load', 'their_load'])
  if (raw.link !== undefined && !isRecord(raw.link)) p.push('scene.link 要是物件')
  if (raw.link !== undefined && !hasLink) p.push('scene.link 要有部位才有連接')
  let positions: string[] | null = null
  if (raw.positions !== undefined) {
    if (!textList(raw.positions)) p.push('scene.positions 要是體位 id 的陣列')
    else positions = raw.positions
  }
  if (raw.match_bonus !== undefined && !isInt(raw.match_bonus)) p.push('scene.match_bonus 要是整數')
  if (p.length > 0) return { problems: p }
  return {
    def: {
      ap: ap as number, my_part: myPart, their_part: theirPart, ...(asPart !== undefined ? { as_part: asPart } : {}),
      on_use: { my_load: use.my_load ?? NO_DIE, their_load: use.their_load ?? NO_DIE, fit: num(raw.on_use, 'scene.on_use', 'fit'), init: num(raw.on_use, 'scene.on_use', 'initiative') },
      link: link ? { my_load: link.my_load ?? NO_DIE, their_load: link.their_load ?? NO_DIE, fit: num(raw.link, 'scene.link', 'fit') } : null,
      positions, match_bonus: isInt(raw.match_bonus) ? raw.match_bonus : null,
    },
  }
}

export interface SkillEntry extends ContentEntry {
  name: string
  tag?: string
  tags?: string[]
  scene?: unknown
}

/** 夜課技能的格式：M2 只用 scene、tag、tags、name，其餘欄位收下不看。 */
export function skillProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (e.tag !== undefined && !isText(e.tag)) p.push('tag 要是標籤的 id')
  if (e.tags !== undefined && !textList(e.tags)) p.push('tags 要是標籤的陣列')
  if (e.scene !== undefined) {
    const r = readSceneDef(e.scene, false)
    if ('problems' in r) p.push(...r.problems)
  }
  return p
}

/** 一件東西（夜課技能或道具）在場景裡的定義；沒有、格式不對是 null。 */
export function sceneDefOf(k: Pick<Kernel, 'content'>, kind: 'skill' | 'item', id: string): { name: string; def: SceneDef; tag: string | null; tags: string[]; consumable: boolean } | null {
  const e = k.content.get<ContentEntry & { name?: unknown; tag?: unknown; tags?: unknown; scene?: unknown; consumable?: unknown }>(kind === 'skill' ? SKILL_KIND : 'item', id)
  if (!e || e.scene === undefined) return null
  const r = readSceneDef(e.scene, kind === 'item')
  if ('problems' in r) return null
  return {
    name: typeof e.name === 'string' ? e.name : id, def: r.def, tag: isText(e.tag) ? e.tag : null, tags: textList(e.tags) ? e.tags : [], consumable: e.consumable === true,
  }
}

// ---- 場景狀態（state.ext.scene） ----

export type EndReason = 'stop' | 'partner_quit' | 'pc_out' | 'partner_out' | 'interrupted' | 'skip'
export const END_NAME: Record<EndReason, string> = {
  stop: '你停了下來', partner_quit: '對方不玩了', pc_out: '你失神了', partner_out: '對方失神了', interrupted: '被外面的事打斷了', skip: '略過',
}

export interface LinkRec {
  id: number
  /** 誰建立的 */
  by: Who
  kind: 'talk' | 'skill' | 'item'
  source: string
  name: string
  /** by 的部位、對方的部位 */
  mine: string
  theirs: string
  /** 每回合自動生效的數值（說話沒有：0、0、0） */
  link: { my_load: string | number; their_load: string | number; fit: number }
  round: number
}

export interface SceneLine { round: number; who: Who; text: string }

export interface SceneState {
  id: string
  mode: 'full' | 'simple'
  pc: ActorId
  partner: ActorId
  nature: Nature
  role: Role
  goal: Goal | null
  place?: string
  /** 內容篩選之後還在的標籤：這一場一開始就算碰到 */
  tags: string[]
  round: number
  turn: Who
  /** 走到第幾步（每一份場景報告加一）：骰子的用途是 scene/<id>/<step> */
  step: number
  ap: Record<Who, number>
  fit: number
  /** 主動權 0～100：50 以上在主角手上 */
  init: number
  /** 目的的進度；沒有目的是 null */
  goal_progress: number | null
  position: string
  /** 體位裡的位置：誰在哪個位置 */
  roles: Record<Who, string>
  links: LinkRec[]
  link_seq: number
  /** 挑逗：下一個行動多一顆骰 */
  teased: Record<Who, boolean>
  /** 克制：這回合連接的自動效果對自己減半 */
  restrained: Record<Who, boolean>
  /** 同步檔位（CORE_RULES 第 5 節）：現在的檔、這一場開過的最高檔、這個回合換過檔了沒有、過載累積的沉溺（結算時加）、對方這個回合的開頭處理過了沒有 */
  gear: Record<Who, SyncGear>
  max_gear: Record<Who, SyncGear>
  shifted: Record<Who, boolean>
  sink_gain: Record<Who, number>
  turn_began: boolean
  /** 到了幾次、受到的感載總量 */
  climax: Record<Who, number>
  received: Record<Who, number>
  used_positions: string[]
  touched: string[]
  lines: SceneLine[]
  /** 第一次的記號：開始時主角的性經歷裡沒有這個人 */
  first_person: boolean
  origin: Origin
}

export const MAX_LINES = 300

export function sceneOf(state: Pick<GameState, 'ext'>): SceneState | null {
  const v = state.ext[EXT]
  return isRecord(v) && typeof v.id === 'string' ? (v as unknown as SceneState) : null
}

export const beat = (actor: ActorId | undefined, text: string, tag?: string, data?: Record<string, unknown>): TimelineBeat => ({
  layer: 'meat', ...(actor ? { actor } : {}), text, ...(tag ? { tag } : {}), ...(data ? { data } : {}),
})

// ---- 讀角色身上的資料 ----

const FALLBACK_BRIDGE = 50

function bridgeValue(k: Pick<Kernel, 'stats'>, state: GameState, id: ActorId, param: 'sensitivity' | 'docility'): number {
  const a = state.actors[id]
  const raw = a && isRecord(a.ext.bridge) ? a.ext.bridge[param] : undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return FALLBACK_BRIDGE
  const stat = `bridge_${param}`
  return k.stats.hasStat(stat) ? k.stats.stat(state, id, stat) : raw
}

/** 敏感度（有效值：橋參數的衍生數值，沒有人註冊時讀 ext.bridge；沒有橋是 50，和戰鬥一樣）。 */
export const sensitivityOf = (k: Pick<Kernel, 'stats'>, state: GameState, id: ActorId): number => bridgeValue(k, state, id, 'sensitivity')
/** 馴化（同上）。 */
export const docilityOf = (k: Pick<Kernel, 'stats'>, state: GameState, id: ActorId): number => bridgeValue(k, state, id, 'docility')

/** 衍生數值，沒有人註冊就照設計書的公式。 */
export function statOr(k: Pick<Kernel, 'stats'>, state: GameState, id: ActorId, stat: string, fallback: number): number {
  return k.stats.hasStat(stat) ? k.stats.stat(state, id, stat) : fallback
}

/** 這個人有沒有這個傾向標籤（有或深；DATA 第 8 節 tendency.tags 的格式）。 */
export function hasTendencyTag(actor: Actor | undefined, tag: string): boolean {
  const t = actor && isRecord(actor.ext.tendency) && isRecord(actor.ext.tendency.tags) ? actor.ext.tendency.tags[tag] : undefined
  return t === 'has' || t === 'deep'
}

/** actor.ext.scene：誰會什麼。 */
export interface KnowRec { positions: string[]; skills: string[]; parts: string[]; part_tags: Record<string, string[]> }
export function knowOf(actor: Actor | undefined): KnowRec {
  const r = actor?.ext[EXT]
  const list = (v: unknown): string[] => (textList(v) ? v : [])
  const tags: Record<string, string[]> = {}
  if (isRecord(r) && isRecord(r.part_tags)) for (const [part, v] of Object.entries(r.part_tags)) if (textList(v)) tags[part] = v
  return isRecord(r) ? { positions: list(r.positions), skills: list(r.skills), parts: list(r.parts), part_tags: tags } : { positions: [], skills: [], parts: [], part_tags: {} }
}

/** 場景裡這個人有哪些部位：基本的七個加改造多出來的（actor.ext.scene.parts）。 */
export const partsOf = (actor: Actor | undefined): string[] => [...new Set([...BASE_PARTS, ...knowOf(actor).parts])]

/** 內容篩選：這些標籤有沒有被關掉。 */
export const filteredOut = (state: Pick<GameState, 'rules'>, tags: Array<string | null | undefined>): string | null =>
  tags.find((t): t is string => !!t && state.rules.contentOff.includes(t)) ?? null

/** 這個人會的體位：基本的（unlocked_by: null）每個人都會，加 actor.ext.scene.positions。只收兩個人的、內容篩選沒關掉的。 */
export function knownPositions(k: Pick<Kernel, 'content'>, state: GameState, id: ActorId): PositionEntry[] {
  const learned = knowOf(state.actors[id]).positions
  return k.content
    .list<PositionEntry>(POSITION_KIND)
    .filter((p) => p.people === 2 && ((p.unlocked_by ?? null) === null || learned.includes(p.id)))
    .filter((p) => !filteredOut(state, [p.tag, ...(p.tags ?? [])]))
}

/** 這個人會的夜課技能（有 scene 欄位、內容篩選沒關掉的）。 */
export function knownSkills(k: Pick<Kernel, 'content'>, state: GameState, id: ActorId): string[] {
  return knowOf(state.actors[id]).skills.filter((s) => {
    const d = sceneDefOf(k, 'skill', s)
    return !!d && !filteredOut(state, [d.tag, ...d.tags])
  })
}

// ---- 性經歷（actor.ext.sex_record；DATA 第 8 節） ----

export interface SexRecord {
  /** 對象的人數、次數、做過幾次服務（交易與工作）、第一次 */
  partners: number
  times: number
  service_times: number
  first?: { with: string; note: string }
  /** 和每個人幾次、用過哪些體位、碰過哪些標籤（算「第一次」用） */
  people: Record<string, number>
  positions: string[]
  tags: string[]
  [more: string]: unknown
}

export function sexRecordOf(actor: Actor | undefined): SexRecord {
  const r = actor?.ext.sex_record
  const o = isRecord(r) ? r : {}
  const people: Record<string, number> = {}
  if (isRecord(o.people)) for (const [id, n] of Object.entries(o.people)) if (typeof n === 'number' && n > 0) people[id] = Math.floor(n)
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)
  return {
    ...clone(o), partners: Math.max(num(o.partners), Object.keys(people).length), times: num(o.times), service_times: num(o.service_times), people,
    positions: textList(o.positions) ? [...o.positions] : [], tags: textList(o.tags) ? [...o.tags] : [],
  }
}

/** 一場之後這個人的性經歷：加一次、這個對象、用過的體位與碰過的標籤；交易與工作算一次服務；第一次只記一回。 */
export function recordScene(rec: SexRecord, o: { partner: string; partnerName: string; service: boolean; positions: string[]; tags: string[] }): SexRecord {
  const next = clone(rec)
  next.times += 1
  if (o.service) next.service_times += 1
  next.people[o.partner] = (next.people[o.partner] ?? 0) + 1
  next.partners = Object.keys(next.people).length
  if (!next.first && rec.times === 0) next.first = { with: o.partnerName, note: '' }
  for (const p of o.positions) if (!next.positions.includes(p)) next.positions.push(p)
  for (const t of o.tags) if (!next.tags.includes(t)) next.tags.push(t)
  return next
}

// ---- 模式（設定 scene_mode）：外殼的設定，不跟著存檔 ----

export type SceneMode = 'full' | 'simple'
export const isMode = (v: unknown): v is SceneMode => v === 'full' || v === 'simple'
const MODES = new WeakMap<object, SceneMode>()

/** 設定裡的「成人場景：完整／精簡」（預設精簡）。介面在設定改了就呼叫它；下一場開始時生效，進行中的不變。 */
export function setSceneMode(k: object, mode: SceneMode): void {
  if (!isMode(mode)) throw new Error(`scene_mode 只能是 full 或 simple（拿到 ${String(mode)}）`)
  MODES.set(k, mode)
}
export const sceneModeOf = (k: object): SceneMode => MODES.get(k) ?? 'simple'

/** 這個人所有有或深的傾向標籤（略過時算共同的標籤）。 */
export function tendencyTagIds(actor: Actor | undefined): string[] {
  const t = actor && isRecord(actor.ext.tendency) && isRecord(actor.ext.tendency.tags) ? actor.ext.tendency.tags : {}
  return Object.keys(t).filter((id) => hasTendencyTag(actor, id))
}

// ---- 同步檔位（核心的 rules/sync.ts 是表；這裡只管場景裡的落點） ----

/** 起始的檔位：標準；上限不到標準的人是淺（LEWD_SYSTEM 3.5 節第一點、CORE_RULES 第 5 節）。 */
export function startGear(cap: SyncGear): SyncGear {
  return syncGearIndex(cap) >= syncGearIndex('standard') ? 'standard' : 'shallow'
}

/** 舊存檔（沒有檔位欄位的場景）補成標準檔，並確保欄位齊全。 */
export function normalizeGear(s: SceneState, cap: Record<Who, SyncGear>): void {
  const both = <T>(f: (w: Who) => T): Record<Who, T> => ({ pc: f('pc'), partner: f('partner') })
  const gear = both((w) => (isSyncGear(s.gear?.[w]) ? s.gear[w] : startGear(cap[w])))
  s.gear = gear
  s.max_gear = both((w) => (isSyncGear(s.max_gear?.[w]) && syncGearIndex(s.max_gear[w]) >= syncGearIndex(gear[w]) ? s.max_gear[w] : gear[w]))
  s.shifted = both((w) => s.shifted?.[w] === true)
  s.sink_gain = both((w) => (typeof s.sink_gain?.[w] === 'number' ? s.sink_gain[w] : 0))
  s.turn_began = s.turn_began === true
}

export { SYNC_GEARS }
export type { SyncGear }
export const gearIndexOf = syncGearIndex

/** 這個人的同步上限（核心的 syncCapOf：同步等級與敏感度；生成的 NPC 沒有同步的等級當 0 級，只到標準）。 */
export const gearCapOf = (k: Pick<Kernel, 'stats' | 'content'>, state: GameState, id: ActorId): SyncGear => syncCapOf(k, state, id)
