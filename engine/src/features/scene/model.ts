// L6 功能 scene 的資料與純函式：內容種類、規則數字、場景狀態、讀角色身上的資料。不碰登錄表（登錄在 index.ts）。
// 規格：LEWD_SYSTEM 第 3 節（3.5 節是完整的規則）；DATA 第 3 節（3.1 夜課的 scene 欄位、3.2 體位、3.3 成人道具、3.4 部位）、第 4 節 adult_scene；
//       CORE_RULES 4.2 節；dev/adr/0016 G6、G11；dev/work/M2-scene.md。
// 不 import 別的功能：橋參數與傾向只認 DATA 第 8 節的格式（actor.ext.bridge、actor.ext.tendency），敏感度優先問 k.stats 的 bridge_sensitivity。
//
// M4-scene-seats：場景的狀態是第二版（SceneRaw，v: 2）：照角色的 id 記座位與配對，不再寫死「主角」與「對方」兩格。
// 存在 state.ext.scene 的就是第二版；讀到舊的（沒有 v：pc／partner 兩格的那一種）時就地轉成第二版。
// Who（'pc' | 'partner'）還留在這裡，只做一對一的舊名字：畫面資料（view.ts）與報告的舊鍵用；引擎內部一律用角色的 id。

import type { Actor, ActorId, Condition, ContentEntry, GameState, Kernel, Origin, SyncGear, TimelineBeat } from '../../core'
import { BASE_SCENE_PARTS, SYNC_GEARS, clone, isRecord, isSyncGear, syncCapOf, syncGearIndex } from '../../core'
import { applyDeep, isDeepTag, knowFor, nightFieldProblems, openingOf } from './night'

export const OWNER = 'scene'
/** state.ext 的鍵、活動的種類。 */
export const EXT = 'scene'
export const ACTIVITY = 'scene'

export const POSITION_KIND = 'position'
export const SKILL_KIND = 'night_skill'
export const RULE_KIND = 'scene_rule'

// ---- 名字與固定的清單 ----

export const NATURES = ['mutual', 'trade', 'work', 'contract', 'forced', 'captive', 'solo'] as const
export type Nature = (typeof NATURES)[number]
export const NATURE_NAME: Record<Nature, string> = { mutual: '兩情相悅', trade: '交易', work: '工作', contract: '契約', forced: '被迫', captive: '俘虜', solo: '獨自' }
/** 有對象的性質（單人的 solo 沒有對象，不用開場的主動權與對方的行動權重）。 */
export type PairNature = Exclude<Nature, 'solo'>
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
export const BASE_PARTS = BASE_SCENE_PARTS
export const PART_NAME: Record<string, string> = {
  mouth: '口', hand_l: '左手', hand_r: '右手', chest: '胸', front: '前', back: '後', legs: '腿足', toy: '道具', extra: '加裝', tail: '尾', tentacle: '觸手',
}
export const partName = (id: string): string => PART_NAME[id] ?? id
/** 說話可以用的自己的部位：口或手勢（LEWD_SYSTEM 3.5 節第五點）。 */
export const TALK_PARTS: readonly string[] = ['mouth', 'hand_l', 'hand_r']

/** 一對一的舊名字：'pc' 是第一個座位（主角），'partner' 是第二個。只給畫面資料與報告的舊鍵用；引擎內部用角色的 id。 */
export type Who = 'pc' | 'partner'
export const other = (w: Who): Who => (w === 'pc' ? 'partner' : 'pc')

export const KINDS = ['pair', 'group', 'solo'] as const
export type SceneKind = (typeof KINDS)[number]
export const LAYERS = ['meat', 'net'] as const
export type SceneLayer = (typeof LAYERS)[number]
/** 進行中就把沒寫 layer 的場景當成內海場景的活動（dive 潛入中、netrun 與 face.net 網內的行程；M4-scene-net）。 */
export const NET_ACTIVITIES = ['dive', 'netrun', 'face.net'] as const

/**
 * 這個人在這一層的性別（內海看化身那一份，現實看角色的）。內海只認格式：actor.ext.deck.avatar.gender 是五個性別值之一就用它，
 * 沒有這一欄（或不是五個值）照角色自己的；不 import deck。性別不在五個值裡（NPC 沒寫）回傳 undefined。
 */
export function genderIn(state: Pick<GameState, 'actors'>, actor: ActorId, layer: SceneLayer): string | undefined {
  const a = state.actors[actor]
  if (!a) return undefined
  if (layer === 'net') {
    const deck = a.ext.deck
    const av = isRecord(deck) && isRecord(deck.avatar) ? deck.avatar.gender : undefined
    if (typeof av === 'string' && Object.prototype.hasOwnProperty.call(GENDER_FILTER, av)) return av
  }
  return a.gender
}

/** 對象的性別對到的內容篩選標籤（LEWD_SYSTEM 第 9 節）：關掉時，這個性別的對象開不起場景。 */
export const GENDER_FILTER: Record<string, { tag: string; name: string }> = {
  male: { tag: 'male_partner', name: '男性對象' },
  female: { tag: 'female_partner', name: '女性對象' },
  femboy: { tag: 'femboy_partner', name: '男娘與偽娘對象' },
  trans_f: { tag: 'trans_partner', name: 'TS 對象' },
  futa: { tag: 'futa_partner', name: '扶他對象' },
}
/** NTR 的內容篩選：setup.tags 含它而它被關掉，場景開不起來。 */
export const NTR_FILTER = { tag: 'ntr', name: 'NTR' }

/** 十種行動（LEWD_SYSTEM 3.5 節第五點；第十種「換檔」是 M3-scene-sync 加的）。end_turn 不是行動，是把回合交出去。 */
export const ACTIONS = ['dominate', 'yield', 'tease', 'restrain', 'skill', 'talk', 'item', 'switch', 'gear', 'stop'] as const
/** 單人才有的兩種行動（M4-scene-solo；LEWD_SYSTEM 3.5 節第九點）：加快、放慢，取代主導與迎合。 */
export const SOLO_ACTIONS = ['faster', 'slower'] as const
/** 多人才有的兩種行動（M4-scene-circles）：換圈、把別圈的一個人叫過來。 */
export const CIRCLE_ACTIONS = ['move_circle', 'call'] as const
/** 共鳴給的兩種行動（M4-night-resonance）：once（每場一次的特殊動作：主動權直接設成 70／30、契合拉到 50）、dress（脫下或換上一件衣服；第一次不花行動點的共鳴）。沒有對應的共鳴就用不出來。 */
export const RESONANCE_ACTIONS = ['once', 'dress'] as const
export type ActionId = (typeof ACTIONS)[number] | (typeof CIRCLE_ACTIONS)[number] | (typeof SOLO_ACTIONS)[number] | (typeof RESONANCE_ACTIONS)[number]
export const ACTION_NAME: Record<ActionId | 'end_turn', string> = {
  once: '夜課的功夫', dress: '脫換衣服',
  dominate: '主導', yield: '迎合', tease: '挑逗', restrain: '克制', skill: '技能', talk: '說話', item: '道具', switch: '切換體位', gear: '換檔', stop: '停下', end_turn: '結束回合',
  move_circle: '換圈', call: '叫人過來', faster: '加快', slower: '放慢',
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
  nature_init: Record<PairNature, number>
  role_init: Record<Role, number>
  /** 受到的感載 = 原始值 ×（load_base + 敏感度 ÷ load_div） */
  load_base: number
  load_div: number
  /** 每一層餘韻讓自己造成的感載與契合增加的比例 */
  glow_bonus: number
  cost: { dominate: number; yield: number; tease: number; restrain: number; talk: number; switch: number; move_circle: number; call: number; faster: number; slower: number; dress: number }
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
  /** 對方的回合開始時，感載達到上限的這個比例以上，他退一檔（同步檔位；LEWD_SYSTEM 3.5 節第五點「換檔」） */
  partner_gear_down_at: number
  /** 全檔過載加的沉溺、AI 給的沉溺變化，一場結算時最多動這麼多（CORE_RULES 4.3 節：每場 −4～+4） */
  sink_cap: number
  /** 對方的一步裡主導、迎合、挑逗的權重，照性質 */
  partner_weights: Record<PairNature, { dominate: number; yield: number; tease: number }>
  /** 契合 ≤ quit_fit 而且過了 quit_rounds 回合：對方不玩了 */
  quit_fit: number
  quit_rounds: number
  bands: RatingBand[]
  /** 第一次和這個人、第一次的體位、第一次的標籤各加多少體悟 */
  first_bonus: number
  skip_mult: number
  /** 多人：連著不只一個人時，主導、迎合、挑逗對每個人少幾顆骰（最少 1 顆） */
  multi_dice_minus: number
  /** 別的圈（不展開）每回合怎麼算：契合起點、每回合加的骰、圈裡有共同的標籤再加多少、每個人感載加的骰 */
  other_circle: { fit_start: number; fit_die: string; tag_bonus: number; load_die: string }
  /**
   * 單人（M4-scene-solo；LEWD_SYSTEM 3.5 節第九點，數字暫定）：節奏 0～100 取代契合。
   * 加快、放慢：自己的感載（骰；放慢是負的）與節奏的變化；節奏掉的時候：這一回合沒有任何連接掉 idle_drop、自己高潮掉 climax_drop；
   * 節奏掉到 quit_pace 以下而且過了 quit_rounds 回合就沒了興致；體悟打 insight_mult 折（進位）。
   */
  solo: {
    pace_start: number
    faster: { load: string; pace: number }
    slower: { load: string; pace: number }
    idle_drop: number
    climax_drop: number
    quit_pace: number
    quit_rounds: number
    insight_mult: number
    /** 略過時的節奏 = base ＋ 0～(spread − 1) 的亂數 */
    skip: { base: number; spread: number }
  }
  /**
   * 結算（M4-scene-close）：沉溺的退路（AI 關著或沒給）：兩情相悅而且主角對對象的（平均）親密度到 anchor_affinity 以上是 anchor（往回拉），被迫是 forced，其餘 0；
   * deep_chance：評價最高一級時，碰到的標籤裡主角已經是「有」的變成「深」的機率；tendency_per_axis：一場每條軸最多記幾個標籤；
   * relate_range：每一級評價允許的親密度變化範圍 [最少, 最多]（AI 給的數字夾在裡面）。
   */
  sink: { anchor: number; forced: number; anchor_affinity: number }
  deep_chance: number
  tendency_per_axis: number
  relate_range: Record<string, [number, number]>
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
  cost: { dominate: 2, yield: 2, tease: 1, restrain: 1, talk: 1, switch: 1, move_circle: 2, call: 1, faster: 2, slower: 1, dress: 1 },
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
  partner_gear_down_at: 0.7,
  sink_cap: 4,
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
  multi_dice_minus: 1,
  other_circle: { fit_start: 20, fit_die: '1d6', tag_bonus: 2, load_die: '2d6' },
  solo: {
    pace_start: 30,
    faster: { load: '2d6', pace: 8 },
    slower: { load: '-1d6', pace: 3 },
    idle_drop: 3,
    climax_drop: 10,
    quit_pace: 10,
    quit_rounds: 3,
    insight_mult: 0.5,
    skip: { base: 35, spread: 21 },
  },
  sink: { anchor: -2, forced: 2, anchor_affinity: 60 },
  deep_chance: 0.25,
  tendency_per_axis: 1,
  relate_range: { poor: [-2, 0], fair: [0, 3], fit: [3, 6], unforgettable: [6, 10] },
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
    if (!Object.hasOwn(base, key) && path !== 'relate_range') {
      problems.push(`${at}：沒有這個規則`)
      continue
    }
    const b = base[key]
    const v = over[key]
    if (path === 'relate_range') {
      // 每一級評價的範圍 [最少, 最多]：整組換掉；也收新的一級（評價表被換掉時）
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x)) || (v[0] as number) > (v[1] as number)) problems.push(`${at} 要是兩個數字 [最少, 最多]`)
      else out[key] = [v[0], v[1]]
    } else if (Array.isArray(b)) {
      const rows = readBands(v, at, problems)
      if (rows) out[key] = rows
    } else if (isRecord(b)) {
      if (!isRecord(v)) problems.push(`${at} 要是物件`)
      else merge(b, v, out[key] as Record<string, unknown>, at, problems)
    } else if (typeof b === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) problems.push(`${at} 要是數字`)
      else out[key] = v
    } else if (typeof b === 'string') {
      if (typeof v !== 'string' || parseDie(v) === null || isNoDie(parseDie(v)!)) problems.push(`${at} 要是骰（例：2d6、1d6）`)
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
  /** 每個位置每回合的主動權（三、四人的體位用；沒寫的位置照 upper 與 initiative_drift） */
  drift?: Record<string, number>
  tag?: string
  tags?: string[]
  unlocked_by?: string | null
  text?: string
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

/** 體位的格式（DATA 3.2）：二到四人；roles 的位置數要等於 people；links 的兩端可以是任意兩個不同的位置；mult 每個位置一個；drift 選填。 */
export function positionProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  const people = isInt(e.people) && e.people >= 2 && e.people <= 4 ? e.people : 0
  if (!people) p.push('people 要是 2～4 的整數')
  const roleIds: string[] = []
  if (!Array.isArray(e.roles) || (people > 0 && e.roles.length !== people)) p.push(people > 0 ? `roles 要有${['', '', '兩', '三', '四'][people]}個位置：{ id, upper }（和 people 一樣多）` : 'roles 要是位置的陣列：{ id, upper }')
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
      if (roleIds.length === people && (!roleIds.includes(a[0]!) || !roleIds.includes(b[0]!))) p.push(`links[${i}] 的位置要是 roles 裡的 id`)
      else if (a[0] === b[0]) p.push(`links[${i}] 的兩端要在不同的位置`)
    })
  }
  if (!isRecord(e.mult)) p.push('mult 要是物件：每個位置受到的感載倍率')
  else for (const id of roleIds) if (typeof e.mult[id] !== 'number' || !(e.mult[id] > 0) || !Number.isFinite(e.mult[id])) p.push(`mult.${id} 要是大於 0 的數字`)
  if (e.initiative_drift !== undefined && !isInt(e.initiative_drift)) p.push('initiative_drift 要是整數')
  if (e.drift !== undefined) {
    if (!isRecord(e.drift)) p.push('drift 要是物件：位置 → 每回合的主動權（整數）')
    else for (const [role, n] of Object.entries(e.drift)) {
      if (!isInt(n)) p.push(`drift.${role} 要是整數`)
      else if (roleIds.length === people && !roleIds.includes(role)) p.push(`drift.${role} 要是 roles 裡的 id`)
    }
  }
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
  /** 要有的東西（DATA 3.1 的 needs）：用出去之前每一條都用 k.conditions 判斷，看的人是用的那個人 */
  needs: Condition[]
  /** 這個技能讓同一個部位再接一條（觸手；LEWD_SYSTEM 3.5 節第四點） */
  double: boolean
  /** 單人模式能不能用（M4-scene-solo 讀）：ok、audience、no；沒寫是 null（照用法推） */
  solo: 'ok' | 'audience' | 'no' | null
}

export const SOLO_VALUES = ['ok', 'audience', 'no'] as const

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
  // needs：一串條件。條件的種類是不是有人註冊不在這裡查（沒有人註冊的當作不成立，用的時候才說原因；dev/adr/0019 P31）
  let needs: Condition[] = []
  if (raw.needs !== undefined) {
    if (!Array.isArray(raw.needs) || !raw.needs.every((c) => isRecord(c) && isText(c.kind))) p.push('scene.needs 要是條件的陣列：{ kind, ... }')
    else needs = raw.needs as Condition[]
  }
  if (raw.double !== undefined && typeof raw.double !== 'boolean') p.push('scene.double 要是布林')
  if (raw.double === true && !hasLink) p.push('scene.double 要有部位才有連接')
  if (raw.solo !== undefined && !(SOLO_VALUES as readonly unknown[]).includes(raw.solo)) p.push(`scene.solo 要是 ${SOLO_VALUES.join('、')} 其中一個`)
  if (p.length > 0) return { problems: p }
  return {
    def: {
      ap: ap as number, my_part: myPart, their_part: theirPart, ...(asPart !== undefined ? { as_part: asPart } : {}),
      on_use: { my_load: use.my_load ?? NO_DIE, their_load: use.their_load ?? NO_DIE, fit: num(raw.on_use, 'scene.on_use', 'fit'), init: num(raw.on_use, 'scene.on_use', 'initiative') },
      link: link ? { my_load: link.my_load ?? NO_DIE, their_load: link.their_load ?? NO_DIE, fit: num(raw.link, 'scene.link', 'fit') } : null,
      positions, match_bonus: isInt(raw.match_bonus) ? raw.match_bonus : null,
      needs: needs.map((c) => clone(c)), double: raw.double === true, solo: (raw.solo as SceneDef['solo'] | undefined) ?? null,
    },
  }
}

export interface SkillEntry extends ContentEntry {
  name: string
  tag?: string
  tags?: string[]
  scene?: unknown
}

/** 夜課技能的格式：scene、tag、tags、name，加上 nightclass 讀的 insight、requires、filters、deep（night.ts；M4-nightclass），其餘欄位收下不看。 */
export function skillProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (e.tag !== undefined && !isText(e.tag)) p.push('tag 要是標籤的 id')
  if (e.tags !== undefined && !textList(e.tags)) p.push('tags 要是標籤的陣列')
  p.push(...nightFieldProblems(e))
  if (e.scene !== undefined) {
    const r = readSceneDef(e.scene, false)
    if ('problems' in r) p.push(...r.problems)
  }
  return p
}

/**
 * 一件東西（夜課技能或道具）在場景裡的定義；沒有、格式不對是 null。
 * 給了 actor（用的人），而且是掛在標籤上的技能、那個人的標籤是「深」、資料又有 deep：deep 寫的數字蓋掉 scene 裡對應的數字（M4-nightclass）。
 */
export function sceneDefOf(k: Pick<Kernel, 'content'>, kind: 'skill' | 'item', id: string, actor?: Actor): { name: string; def: SceneDef; tag: string | null; tags: string[]; consumable: boolean } | null {
  const e = k.content.get<ContentEntry & { name?: unknown; tag?: unknown; tags?: unknown; scene?: unknown; consumable?: unknown; deep?: unknown }>(kind === 'skill' ? SKILL_KIND : 'item', id)
  if (!e || e.scene === undefined) return null
  const r = readSceneDef(e.scene, kind === 'item')
  if ('problems' in r) return null
  const tag = isText(e.tag) ? e.tag : null
  const def = kind === 'skill' && actor && e.deep !== undefined && isDeepTag(actor, tag) ? applyDeep(r.def, e.deep) : r.def
  return {
    name: typeof e.name === 'string' ? e.name : id, def, tag, tags: textList(e.tags) ? e.tags : [], consumable: e.consumable === true,
  }
}

// ---- 場景狀態（state.ext.scene，第二版） ----

export type EndReason = 'stop' | 'partner_quit' | 'pc_out' | 'partner_out' | 'interrupted' | 'skip' | 'bored'
export const END_NAME: Record<EndReason, string> = {
  stop: '你停了下來', partner_quit: '對方不玩了', pc_out: '你失神了', partner_out: '對方失神了', interrupted: '被外面的事打斷了', skip: '略過', bored: '你沒了興致',
}

export interface LinkRec {
  id: number
  /** 誰建立的（角色的 id）、接的是誰（角色的 id） */
  by: ActorId
  to: ActorId
  kind: 'talk' | 'skill' | 'item'
  source: string
  name: string
  /** by 的部位、to 的部位 */
  mine: string
  theirs: string
  /** 每回合自動生效的數值（說話沒有：0、0、0） */
  link: { my_load: string | number; their_load: string | number; fit: number }
  round: number
  /** 觸手那一種：同一個部位可以再接一條（LEWD_SYSTEM 3.5 節第四點） */
  double?: true
}

export interface SceneLine { round: number; who: ActorId; text: string }

/** 這一圈的一個人（第一個是主角）：行動點、同步檔位、這一場的記號。 */
export interface Seat {
  id: ActorId
  ap: number
  /** 同步檔位（CORE_RULES 第 5 節）：現在的檔、這一場開過的最高檔、這個回合換過檔了沒有、過載累積的沉溺（結算時加） */
  gear: SyncGear
  max_gear: SyncGear
  shifted: boolean
  sink_gain: number
  /** 到了幾次、受到的感載總量 */
  climax: number
  received: number
  /** 挑逗：下一個行動多一顆骰；克制：這回合連接的自動效果對自己減半 */
  teased: boolean
  restrained: boolean
  /** 退出了這一圈（多人的回合讀它；一對一不會有） */
  out?: boolean
  /** 共鳴（M4-nightclass）：這一場已經用掉幾次不花行動點的切換體位；已經建立過第一條有持續效果的連接（只在有對應的共鳴時才寫） */
  free_used?: number
  first_link?: true
  /** 共鳴 once 用過了：每場一次的記 1；每回合一次的記用在第幾回合（只在用過時才寫） */
  once?: Record<string, number>
  /** 這個人用過幾次主導與迎合（結算橋參數落在哪一項要看；只在用過時才寫，舊存檔沒有） */
  dom_used?: number
  yield_used?: number
}

/** 主角對這一圈某個人的：契合 0～100、主動權 0～100（50 以上在主角手上）、第一次的記號（開始時主角的性經歷裡沒有這個人）。 */
export interface PairRec { fit: number; init: number; first: boolean }

/**
 * 別的圈（不展開；P35）：圈裡的人、一個契合、每個人的高潮次數、這一回合的一行字。
 * out 是這一圈裡失神退出的人（結算時還是這一圈的人）。
 */
export interface CircleRec { id: string; people: ActorId[]; fit: number; climax: Record<ActorId, number>; line: string; out?: ActorId[] }

/** 存在 state.ext.scene 的樣子。 */
export interface SceneRaw {
  v: 2
  id: string
  mode: 'full' | 'simple'
  kind: SceneKind
  layer: SceneLayer
  pc: ActorId
  nature: Nature
  role: Role
  goal: Goal | null
  place?: string
  /** 內容篩選之後還在的標籤：這一場一開始就算碰到 */
  tags: string[]
  round: number
  /** 現在輪到誰（角色的 id） */
  turn: ActorId
  /** 走到第幾步（每一份場景報告加一）：骰子的用途是 scene/<id>/<step> */
  step: number
  /** 主角這一圈的每個人，第一個是主角；一對一時對方就是 seats[1] */
  seats: Seat[]
  /** 主角對這一圈每個人（不含主角自己）各一份 */
  pairs: Record<ActorId, PairRec>
  /** 目的的進度；沒有目的是 null */
  goal_progress: number | null
  position: string
  /** 體位裡的位置：誰在哪個位置（角色的 id） */
  roles: Record<ActorId, string>
  links: LinkRec[]
  link_seq: number
  /** 這個回合 NPC 的開頭處理過了沒有（換檔） */
  turn_began: boolean
  used_positions: string[]
  touched: string[]
  lines: SceneLine[]
  origin: Origin
  /** 別的圈（多人）、單人的節奏（0～100，單人才有）、最多幾回合、單人時有沒有人在看（直播開著；M5 之前沒有人會給 true） */
  circles: CircleRec[]
  pace?: number
  max_rounds?: number
  audience?: boolean
  /** 內海的夢（流竄 AI 的夢，M4-scene-net）：沒有接入點、沒有甲板也開得起來；網內的行程結束時不跟著被打斷 */
  dream?: true
  /** 記憶被抹掉的場景（SceneSetup.amnesia）：結束時不寫性經歷、不長傾向、不加沉溺累計，報告的 outcome 多 amnesia: true */
  amnesia?: true
}

export const MAX_LINES = 300

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 舊的（M2、M3：沒有 v，pc 與 partner 兩格）轉成第二版。形狀不對的地方補預設，不丟例外。 */
export function upgradeScene(old: Record<string, unknown>): SceneRaw {
  const pc = str(old.pc)
  const partner = str(old.partner)
  const rec = (k: string): Record<string, unknown> => (isRecord(old[k]) ? (old[k] as Record<string, unknown>) : {})
  const who = (v: unknown): string => (v === 'pc' ? pc : v === 'partner' ? partner : str(v))
  const ap = rec('ap'), gear = rec('gear'), maxGear = rec('max_gear'), shifted = rec('shifted'), sinkGain = rec('sink_gain'), climax = rec('climax'), received = rec('received'), teased = rec('teased'), restrained = rec('restrained')
  const seat = (w: 'pc' | 'partner', id: string): Seat => ({
    id, ap: num(ap[w]), gear: gear[w] as SyncGear, max_gear: maxGear[w] as SyncGear, shifted: shifted[w] === true, sink_gain: num(sinkGain[w]), climax: num(climax[w]),
    received: num(received[w]), teased: teased[w] === true, restrained: restrained[w] === true,
  })
  const roles = rec('roles')
  const links = Array.isArray(old.links) ? (old.links as unknown[]).filter(isRecord).map((l): LinkRec => {
    const by = who(l.by)
    const { double, ...rest } = l as Record<string, unknown>
    return { ...(rest as unknown as LinkRec), by, to: by === pc ? partner : pc, ...(double === true ? { double: true as const } : {}) }
  }) : []
  const lines = Array.isArray(old.lines) ? (old.lines as unknown[]).filter(isRecord).map((l): SceneLine => ({ round: num(l.round), who: who(l.who), text: str(l.text) })) : []
  const { partner: _p, ap: _a, gear: _g, max_gear: _mg, shifted: _sh, sink_gain: _sg, climax: _c, received: _r, teased: _t, restrained: _re, fit: _f, init: _i, first_person: _fp, ...keep } = old
  void [_p, _a, _g, _mg, _sh, _sg, _c, _r, _t, _re, _f, _i, _fp]
  return {
    ...(keep as unknown as SceneRaw), v: 2, kind: 'pair', layer: 'meat', pc,
    turn: who(old.turn), seats: [seat('pc', pc), seat('partner', partner)],
    pairs: { [partner]: { fit: num(old.fit), init: num(old.init, 50), first: old.first_person === true } },
    roles: { [pc]: str(roles.pc), [partner]: str(roles.partner) }, links, lines,
    tags: Array.isArray(old.tags) ? (old.tags as string[]) : [], used_positions: Array.isArray(old.used_positions) ? (old.used_positions as string[]) : [],
    touched: Array.isArray(old.touched) ? (old.touched as string[]) : [], link_seq: num(old.link_seq), turn_began: old.turn_began === true, circles: [],
  }
}

/**
 * 存在狀態裡的場景（第二版）；沒有場景是 null。讀到舊的就地轉成第二版（換掉 state.ext.scene）再回傳；狀態凍著、換不掉時回傳轉好的副本。
 * 只認得「有 id 的物件」，不另外驗形狀（引擎自己寫的）。
 */
export function sceneRawOf(state: Pick<GameState, 'ext'>): SceneRaw | null {
  const v = state.ext[EXT]
  if (!isRecord(v) || typeof v.id !== 'string') return null
  if (v.v === 2) return v as unknown as SceneRaw
  const up = upgradeScene(v)
  try {
    state.ext[EXT] = up
  } catch {
    /* 凍著的狀態：用副本 */
  }
  return up
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

/**
 * 掛點 scene.body 的一個回答（義體、調校、化身……）：多出來的部位、各部位對敏感度的修正（加在人的敏感度上，P64）、各部位身上的標籤。
 * 好幾個回答合起來：部位取聯集、修正相加、標籤取聯集。
 */
export interface BodyAnswer {
  parts?: string[]
  sensitivity?: Record<string, number>
  tags?: Record<string, string[]>
}
export interface BodyRec { parts: string[]; sensitivity: Record<string, number>; tags: Record<string, string[]> }

declare module '../../core' {
  interface HookMap {
    /**
     * 成人場景問一個人的身體（掛點由 features/scene 宣告；義體、調校、內海的化身回答）：回傳多出來的部位、各部位的敏感度修正、各部位的標籤。
     * state 是現在的遊戲狀態，actor 是被問的人，layer 是這一場在現實（meat）還是內海（net）。沒有人回答時，部位只有基本的七個加 actor.ext.scene.parts。
     */
    'scene.body': [{ state: GameState; actor: ActorId; layer: 'meat' | 'net' }, BodyAnswer | void]
  }
}

/** 把好幾個回答合成一份（格式不對的欄位略過）。 */
export function mergeBody(answers: ReadonlyArray<BodyAnswer | null | undefined>): BodyRec {
  const out: BodyRec = { parts: [], sensitivity: {}, tags: {} }
  for (const a of answers) {
    if (!isRecord(a)) continue
    if (textList(a.parts)) for (const x of a.parts) if (!out.parts.includes(x)) out.parts.push(x)
    if (isRecord(a.sensitivity)) for (const [part, n] of Object.entries(a.sensitivity)) if (typeof n === 'number' && Number.isFinite(n)) out.sensitivity[part] = (out.sensitivity[part] ?? 0) + n
    if (isRecord(a.tags)) for (const [part, list] of Object.entries(a.tags)) if (textList(list)) out.tags[part] = [...new Set([...(out.tags[part] ?? []), ...list])]
  }
  return out
}

/** 問一個人的身體（所有回答合起來）。 */
export function bodyOf(k: Pick<Kernel, 'hooks'>, state: GameState, actor: ActorId, layer: SceneLayer): BodyRec {
  return mergeBody(k.hooks.run('scene.body', { state, actor, layer }).map((h) => h.result as BodyAnswer))
}

/** 內容篩選：這些標籤有沒有被關掉。 */
export const filteredOut = (state: Pick<GameState, 'rules'>, tags: Array<string | null | undefined>): string | null =>
  tags.find((t): t is string => !!t && state.rules.contentOff.includes(t)) ?? null

/** 這個人會的體位：基本的（unlocked_by: null）每個人都會，加 actor.ext.scene.positions。只收這個人數的（預設兩個人）、內容篩選沒關掉的。 */
export function knownPositions(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: ActorId, people = 2): PositionEntry[] {
  const learned = knowFor(k, state, id).positions
  return k.content
    .list<PositionEntry>(POSITION_KIND)
    .filter((p) => p.people === people && ((p.unlocked_by ?? null) === null || learned.includes(p.id)))
    .filter((p) => !filteredOut(state, [p.tag, ...(p.tags ?? [])]))
}

/** 這幾個人都會的體位（人數就是 ids 的個數）：基本的在前，照內容的順序。 */
export function knownAll(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, ids: readonly ActorId[]): PositionEntry[] {
  if (ids.length < 2 || ids.length > 4) return []
  const sets = ids.map((id) => new Set(knownPositions(k, state, id, ids.length).map((x) => x.id)))
  const list = knownPositions(k, state, ids[0]!, ids.length).filter((x) => sets.every((st) => st.has(x.id)))
  return [...list.filter((x) => (x.unlocked_by ?? null) === null), ...list.filter((x) => (x.unlocked_by ?? null) !== null)]
}

// ---- 單人姿勢（M4-scene-solo；LEWD_SYSTEM 3.5 節第九點「單人姿勢五個」，效果傾向暫定） ----

export const SOLO_POSE_KIND = 'solo_pose'
const HANDS: readonly string[] = ['hand_l', 'hand_r']

/**
 * 單人姿勢：只在單人模式用，一般的體位與體位技能在單人都不能用。每個人都會，不用學。
 * reach：不必用手就碰得到的部位（雙手本來就碰得到）；hand_only：要用一隻手（或道具）才碰得到。兩邊都沒列的部位在這個姿勢碰不到。
 * mult：受到的感載倍率；link_pace：這個部位有連接時，每回合節奏加多少（連接的哪一端是它都算）；
 * upkeep：每回合固定的（load 是自己的感載、pace 是節奏、link 是它算不算一條連接，給「沒有連接節奏就掉」那條規則看）；
 * faster_cut：加快時自己的感載減這顆骰的一半；slower_pace：放慢時節奏多加；drop_half：節奏掉的時候少掉一半；
 * no_dice_minus：只是記著設計書的「連接不用減骰」，單人沒有連著好幾個人的減骰，所以沒有效果（內建的跪姿已經不用它，改用 both_links）。
 * both_links：列的每一個部位這一回合都有連接（連接的哪一端是它都算）時，自己的感載另外加這顆骰（LEWD 3.5 節第九點：跪姿前後兩條連接都在，+1d4；使用者 2026-11-25）。
 */
export interface SoloPose {
  id: string
  name: string
  reach: string[]
  hand_only: string[]
  mult: number
  link_pace: Record<string, number>
  upkeep?: { load?: string | number; pace?: number; link?: boolean }
  faster_cut?: string
  slower_pace?: number
  drop_half?: boolean
  no_dice_minus?: boolean
  both_links?: { parts: string[]; load: string }
}

/** 內建的五個姿勢；資料（solo_pose 種類）寫同一個 id 就整筆換掉，寫新的 id 就多一個。 */
export const DEFAULT_SOLO_POSES: readonly SoloPose[] = [
  { id: 'solo_spread', name: '張腿仰躺', reach: ['front', 'chest', 'mouth', 'legs'], hand_only: [], mult: 1, link_pace: { front: 1 } },
  { id: 'solo_kneel', name: '跪姿', reach: ['front', 'back', 'chest', 'mouth'], hand_only: [], mult: 1, link_pace: {}, upkeep: { load: 1 }, both_links: { parts: ['front', 'back'], load: '1d4' } },
  { id: 'solo_prone', name: '趴伏翹臀', reach: ['back', 'legs'], hand_only: ['front'], mult: 1.1, link_pace: { back: 1 } },
  { id: 'solo_straddle', name: '跨坐抱枕', reach: ['front', 'legs', 'chest'], hand_only: ['back'], mult: 1, link_pace: {}, upkeep: { load: '1d3', pace: 1, link: true } },
  { id: 'solo_side', name: '側躺', reach: ['front', 'back', 'chest', 'mouth'], hand_only: [], mult: 1, link_pace: {}, faster_cut: '1d6', slower_pace: 1, drop_half: true },
]

const isNumberLike = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)

/** 單人姿勢的格式（資料的 solo_pose 種類）。 */
export function soloPoseProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!textList(e.reach)) p.push('reach 要是部位 id 的陣列')
  if (e.hand_only !== undefined && !textList(e.hand_only)) p.push('hand_only 要是部位 id 的陣列')
  if (!(typeof e.mult === 'number' && e.mult > 0 && Number.isFinite(e.mult))) p.push('mult 要是大於 0 的數字')
  if (e.link_pace !== undefined && (!isRecord(e.link_pace) || !Object.values(e.link_pace).every(isNumberLike))) p.push('link_pace 要是 部位 → 數字 的物件')
  if (e.upkeep !== undefined) {
    const u = e.upkeep
    if (!isRecord(u)) p.push('upkeep 要是物件：{ load?, pace?, link? }')
    else {
      if (u.load !== undefined && parseDie(u.load) === null) p.push('upkeep.load 要是骰（例：1d3）或整數')
      if (u.pace !== undefined && !isNumberLike(u.pace)) p.push('upkeep.pace 要是數字')
      if (u.link !== undefined && typeof u.link !== 'boolean') p.push('upkeep.link 要是布林')
    }
  }
  if (e.both_links !== undefined) {
    const b = e.both_links
    if (!isRecord(b)) p.push('both_links 要是 { parts, load }')
    else {
      if (!textList(b.parts) || b.parts.length === 0) p.push('both_links.parts 要是部位 id 的非空陣列')
      if (parseDie(b.load) === null || isNoDie(parseDie(b.load)!)) p.push('both_links.load 要是骰（例：1d4）')
    }
  }
  if (e.faster_cut !== undefined && (parseDie(e.faster_cut) === null || isNoDie(parseDie(e.faster_cut)!))) p.push('faster_cut 要是骰（例：1d6）')
  if (e.slower_pace !== undefined && !isNumberLike(e.slower_pace)) p.push('slower_pace 要是數字')
  return p
}

function readPose(e: Record<string, unknown>): SoloPose {
  return {
    id: String(e.id), name: String(e.name), reach: textList(e.reach) ? [...e.reach] : [], hand_only: textList(e.hand_only) ? [...e.hand_only] : [], mult: e.mult as number,
    link_pace: isRecord(e.link_pace) ? { ...(e.link_pace as Record<string, number>) } : {},
    ...(isRecord(e.upkeep) ? { upkeep: clone(e.upkeep) as NonNullable<SoloPose['upkeep']> } : {}),
    ...(typeof e.faster_cut === 'string' ? { faster_cut: e.faster_cut } : {}), ...(typeof e.slower_pace === 'number' ? { slower_pace: e.slower_pace } : {}),
    ...(e.drop_half === true ? { drop_half: true } : {}), ...(e.no_dice_minus === true ? { no_dice_minus: true } : {}),
    ...(isRecord(e.both_links) && textList(e.both_links.parts) && typeof e.both_links.load === 'string' ? { both_links: { parts: [...e.both_links.parts], load: e.both_links.load } } : {}),
  }
}

/** 現在有哪些單人姿勢：內建的五個，資料寫了同一個 id 的換掉、寫了新 id 的接在後面；內容篩選關掉的標籤不影響姿勢。 */
export function soloPoses(k: Pick<Kernel, 'content'>): SoloPose[] {
  const out = new Map<string, SoloPose>(DEFAULT_SOLO_POSES.map((x) => [x.id, clone(x)]))
  for (const e of k.content.list(SOLO_POSE_KIND)) out.set(e.id, readPose(e as Record<string, unknown>))
  return [...out.values()]
}

export const soloPoseOf = (k: Pick<Kernel, 'content'>, id: string): SoloPose | undefined => soloPoses(k).find((x) => x.id === id)

/** 這個姿勢碰不碰得到「my 這個部位接 theirs 這個部位」（自己接自己；道具 asPart 算自己拿在手上的東西）。同一個部位不能接自己。 */
export function poseReaches(pose: SoloPose, mine: string, theirs: string, asPart?: string): boolean {
  if (mine === theirs) return false
  const handed = HANDS.includes(mine) || asPart === mine
  const source = handed || pose.reach.includes(mine)
  const target = HANDS.includes(theirs) || pose.reach.includes(theirs) || (handed && pose.hand_only.includes(theirs))
  return source && target
}

/** 這個姿勢上這個部位能不能碰到（畫面把部位分成碰得到與碰不到用）。 */
export const poseHasPart = (pose: SoloPose, part: string): boolean => HANDS.includes(part) || pose.reach.includes(part) || pose.hand_only.includes(part)

/** 開場的主動權：50 ＋（對方的馴化 − 自己的馴化）÷ 4，再照性質與身分調整（LEWD_SYSTEM 3.5 節第二點）。多人時主角對每個人各算一次。 */
export function openingInit(k: Kernel, state: GameState, o: { pc: string; partner: string; nature: Nature; role: Role; layer?: SceneLayer }): number {
  const r = sceneRules(k)
  // 性質是工作而沒寫身分，主角就是工作的人；work 的 −20 由身分給，不算兩次
  const role: Role = o.role === 'none' && o.nature === 'work' ? 'worker' : o.role
  const natureAdj = (r.nature_init[o.nature as PairNature] ?? 0) + r.role_init[role]
  // 共鳴 opening（夜課）：主角那一邊多、對方有共鳴的少（照這一場的性質與身分有沒有調整、穿著的風格）
  const layer = o.layer ?? 'meat'
  const bonus = openingOf(k, state, o.pc, { adjusted: natureAdj !== 0, layer, solo: false }).init - openingOf(k, state, o.partner, { adjusted: natureAdj !== 0, layer, solo: false }).init
  const v = r.init_base + (docilityOf(k, state, o.partner) - docilityOf(k, state, o.pc)) / r.init_docility_div + natureAdj + bonus
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** 開場的契合：fit_start 加上這一對任何一邊的共鳴 opening.fit（主角與對象；單人用 openingPace）。 */
export function openingFit(k: Kernel, state: GameState, o: { pc: string; partner: string; nature: Nature; role: Role; layer?: SceneLayer }): number {
  const r = sceneRules(k)
  const role: Role = o.role === 'none' && o.nature === 'work' ? 'worker' : o.role
  const adjusted = (r.nature_init[o.nature as PairNature] ?? 0) + r.role_init[role] !== 0
  const layer = o.layer ?? 'meat'
  return Math.max(0, Math.min(100, r.fit_start + openingOf(k, state, o.pc, { adjusted, layer, solo: false }).fit + openingOf(k, state, o.partner, { adjusted, layer, solo: false }).fit))
}

/** 單人開場的節奏：pace_start 加共鳴 opening.fit（單人的契合讀成節奏）。 */
export function openingPace(k: Kernel, state: GameState, o: { pc: string; layer?: SceneLayer }): number {
  return Math.max(0, Math.min(100, sceneRules(k).solo.pace_start + openingOf(k, state, o.pc, { adjusted: false, layer: o.layer ?? 'meat', solo: true }).fit))
}

/** 這個人會的夜課技能（有 scene 欄位、內容篩選沒關掉的）；對方沒寫 skills 時是推出來的（night.ts 的 npcKnow，P32）。 */
export function knownSkills(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, id: ActorId): string[] {
  return knowFor(k, state, id).skills.filter((s) => {
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
  /** 每種性質各幾次（M4-scene-close；單人的不算）、次數最多的那個人、對每個人的一句話（最多 NOTES_MAX 筆）、每個對象的身體與外表的性別（夜課的學習條件讀） */
  kinds?: Record<string, number>
  favorite?: string
  notes?: Record<string, string>
  looks?: Record<string, PartnerLook>
  [more: string]: unknown
}

/** 對象的身體（masc、fem、andro；角色身上有 ext.body 才有）與外表的性別（角色的 gender）。 */
export interface PartnerLook { body?: string; look_gender?: string }

/** 一句話最多留幾筆、每句最長幾字。 */
export const NOTES_MAX = 20
export const NOTE_LEN = 80

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

/** 一場之後這個人的性經歷：加一次、這個對象、用過的體位與碰過的標籤；交易與工作算一次服務；第一次只記一回。對象的人數取較大值（建角給的起始人數不被蓋掉）。 */
export function recordScene(rec: SexRecord, o: { partner: string; partnerName: string; service: boolean; positions: string[]; tags: string[]; nature?: string; look?: PartnerLook }): SexRecord {
  const next = clone(rec)
  next.times += 1
  if (o.service) next.service_times += 1
  next.people[o.partner] = (next.people[o.partner] ?? 0) + 1
  next.partners = Math.max(rec.partners, Object.keys(next.people).length)
  if (!next.first && rec.times === 0) next.first = { with: o.partnerName, note: '' }
  for (const p of o.positions) if (!next.positions.includes(p)) next.positions.push(p)
  for (const t of o.tags) if (!next.tags.includes(t)) next.tags.push(t)
  if (o.nature) {
    const kinds = isRecord(next.kinds) ? (next.kinds as Record<string, number>) : {}
    kinds[o.nature] = (typeof kinds[o.nature] === 'number' ? kinds[o.nature]! : 0) + 1
    next.kinds = kinds
  }
  if (o.look && Object.keys(o.look).length > 0) next.looks = { ...(isRecord(next.looks) ? (next.looks as Record<string, PartnerLook>) : {}), [o.partner]: o.look }
  return next
}

/** 次數最多的那個人；一樣多取 tie 給的值高的；再一樣取原本的最愛、再一樣取先出現的。沒有人是 undefined。 */
export function favoriteOf(rec: Pick<SexRecord, 'people' | 'favorite'>, tie?: (id: string) => number): string | undefined {
  let best: string | undefined
  for (const id of Object.keys(rec.people)) {
    if (best === undefined) { best = id; continue }
    const d = rec.people[id]! - rec.people[best]!
    if (d > 0) best = id
    else if (d === 0) {
      const t = (tie?.(id) ?? 0) - (tie?.(best) ?? 0)
      if (t > 0 || (t === 0 && id === rec.favorite)) best = id
    }
  }
  return best
}

/**
 * 多人的一場：次數加一次，每個對象各記一筆（對象的人數照實加，取較大值）；補這一場性質的次數、每個對象的身體與外表的性別；重新算最喜歡的人；
 * notes 是這一場給的一句話（對象 id → 一句；呼叫的人先驗過），最多留 NOTES_MAX 筆（舊的先丟）。
 */
export function recordSceneWith(
  rec: SexRecord,
  o: { partners: Array<{ id: string; name: string; look?: PartnerLook }>; service: boolean; positions: string[]; tags: string[]; nature?: string; notes?: Record<string, string>; tie?: (id: string) => number },
): SexRecord {
  const [first, ...rest] = o.partners
  const next = first ? recordScene(rec, { partner: first.id, partnerName: first.name, service: o.service, positions: o.positions, tags: o.tags, nature: o.nature, look: first.look }) : clone(rec)
  for (const x of rest) {
    next.people[x.id] = (next.people[x.id] ?? 0) + 1
    if (x.look && Object.keys(x.look).length > 0) next.looks = { ...(isRecord(next.looks) ? (next.looks as Record<string, PartnerLook>) : {}), [x.id]: x.look }
  }
  next.partners = Math.max(rec.partners, Object.keys(next.people).length)
  const fav = favoriteOf({ people: next.people, favorite: typeof rec.favorite === 'string' ? rec.favorite : undefined }, o.tie)
  if (fav !== undefined) next.favorite = fav
  if (o.notes && Object.keys(o.notes).length > 0) {
    const notes: Record<string, string> = isRecord(next.notes) ? { ...(next.notes as Record<string, string>) } : {}
    for (const [id, text] of Object.entries(o.notes)) {
      delete notes[id]
      notes[id] = text
    }
    const keys = Object.keys(notes)
    for (const id of keys.slice(0, Math.max(0, keys.length - NOTES_MAX))) delete notes[id]
    next.notes = notes
  }
  return next
}

/** 這個人單人用過哪些姿勢（算「第一次用某個姿勢」）。 */
export const soloPosesSeen = (rec: SexRecord): string[] => (textList(rec.solo_poses) ? rec.solo_poses : [])

/**
 * 單人的一場之後的性經歷（LEWD_SYSTEM 3.5 節第九點）：只加 solo_times、用過的姿勢與碰過的標籤；
 * 次數（times）、對象的人數（partners、people）、服務次數、第一次都不動，所以不能靠它開共通分支的階。
 */
export function recordSolo(rec: SexRecord, o: { poses: string[]; tags: string[] }): SexRecord {
  const next = clone(rec)
  next.solo_times = (typeof rec.solo_times === 'number' && Number.isFinite(rec.solo_times) ? Math.max(0, Math.floor(rec.solo_times)) : 0) + 1
  const seen = soloPosesSeen(rec)
  next.solo_poses = [...seen, ...o.poses.filter((x) => !seen.includes(x))]
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

/** 舊存檔（座位上沒有檔位欄位的場景）補成標準檔，並確保每個座位的欄位齊全。 */
export function normalizeSeats(s: SceneRaw, cap: Record<ActorId, SyncGear>): void {
  for (const seat of s.seats) {
    const c = cap[seat.id] ?? 'standard'
    seat.gear = isSyncGear(seat.gear) ? seat.gear : startGear(c)
    seat.max_gear = isSyncGear(seat.max_gear) && syncGearIndex(seat.max_gear) >= syncGearIndex(seat.gear) ? seat.max_gear : seat.gear
    seat.shifted = seat.shifted === true
    seat.sink_gain = typeof seat.sink_gain === 'number' ? seat.sink_gain : 0
    seat.ap = typeof seat.ap === 'number' ? seat.ap : 0
    seat.climax = typeof seat.climax === 'number' ? seat.climax : 0
    seat.received = typeof seat.received === 'number' ? seat.received : 0
    seat.teased = seat.teased === true
    seat.restrained = seat.restrained === true
  }
  s.turn_began = s.turn_began === true
}

export { SYNC_GEARS }
export type { SyncGear }
export const gearIndexOf = syncGearIndex

/** 這個人的同步上限（核心的 syncCapOf：同步等級與敏感度；生成的 NPC 沒有同步的等級當 0 級，只到標準）。 */
export const gearCapOf = (k: Pick<Kernel, 'stats' | 'content'>, state: GameState, id: ActorId): SyncGear => syncCapOf(k, state, id)
