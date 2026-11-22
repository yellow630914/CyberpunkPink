// L5 戰鬥：戰場（mode）、數字、傷害類型與狀態。全部是資料驅動的：核心帶著照設計書寫的預設值，
// 資料（內容種類 battle_mode、damage_type、battle_status）載入之後以資料為準（和 effect_cap 同一個做法）。
//
// 現實與內海是同一套戰鬥（MIGRATION 第 5 節第 2 點；CYBERSPACE 第 6 節「不另外做一套」）：兩個戰場只差在這個檔的 BattleMode 的幾個欄位，
// 以及功能各自註冊的行動（射擊與換彈、攻擊與回填……）。dev/adr/0010。

import type { BattleStatus, DamageType, Grade, UnitRank } from '../types'
import { DAMAGE_TYPES, UNIT_RANKS } from '../types'
import type { ContentEntry, ContentRegistry } from '../content/registry'
import { isRecord } from '../util/sanitize'

/** 戰鬥的數字（COMBAT_SYSTEM 第 1～7 節；ENEMIES 1.5 節）。每一個戰場各一份，沒寫的用這裡的預設。 */
export interface BattleNumbers {
  /** 每回合回復的行動點（起始值；技能、義體、裝備可以提高）：3 */
  apRegen: number
  /** 被埋伏的一方第一回合從「上限 − 2」開始 */
  apAmbushed: number
  /** 一個人一個回合最多讓 AI 做幾步（ENEMIES 第 4 節） */
  aiMaxSteps: number
  /** 迴避的基礎：10 */
  evadeBase: number
  /** 超過迴避這麼多是要害：5 */
  critMargin: number
  /** 超出適用距離每一格的修正：−2 */
  rangeStep: number
  /** 長槍站在第 1 格的修正：−4 */
  longAtFront: number
  /** 瞄準過的射擊的命中加值：+3 */
  aimedHit: number
  /** 遮蔽給的迴避：[暴露, 半掩體, 掩體] */
  coverBonus: [number, number, number]
  /** 遮蔽每一級的耐久，照場景的等級 I～V */
  coverHp: { half: number[]; full: number[] }
  /** 沒有人站的那一格，遮蔽受到的傷害倍率：2 */
  emptyCoverMult: number
  /** 指定打遮蔽：倍率乘多少、至少多少（×2、至少 ×1） */
  aimCover: { mult: number; min: number }
  /** 黑暗：全場迴避 +2（有夜視的攻擊不算） */
  darkEvade: number
  /** 感載每回合自然消退 = decayBase ＋ mod(意志)（CORE_RULES 4.2 節）；最少 0 */
  decayBase: number
  /** 穿甲超過護甲的部分算不算額外的傷害。false：穿甲只抵銷護甲（BALANCE 的模擬照這個算）。dev/adr/0013 */
  pierceOverflow: boolean
  /** 位階的傷害倍率：敵人造成的生命傷害扣掉護甲之後乘（ENEMIES 1.5 節）。內海不用（都是 1） */
  rankDamage: Record<UnitRank, number>
  /** 制伏（內海是釘住）的 DC：base ＋ 目標的等級 × perGrade，精英與首領再加 */
  subdueDc: { base: number; perGrade: number; elite: number; boss: number }
  /** 脫離的 DC：base ＋ 敵方最高的等級 × perGrade */
  fleeDc: { base: number; perGrade: number }
}

export const DEFAULT_NUMBERS: BattleNumbers = {
  apRegen: 3,
  apAmbushed: -2,
  aiMaxSteps: 6,
  evadeBase: 10,
  critMargin: 5,
  rangeStep: -2,
  longAtFront: -4,
  aimedHit: 3,
  coverBonus: [0, 2, 4],
  coverHp: { half: [15, 15, 20, 25, 30], full: [30, 30, 40, 50, 60] },
  emptyCoverMult: 2,
  aimCover: { mult: 2, min: 1 },
  darkEvade: 2,
  decayBase: 2,
  pierceOverflow: false,
  rankDamage: { minion: 0.4, elite: 0.6, boss: 1 },
  subdueDc: { base: 10, perGrade: 2, elite: 2, boss: 4 },
  fleeDc: { base: 10, perGrade: 2 },
}

/** 一個戰場（現實、內海）。 */
export interface BattleMode {
  id: string
  name: string
  /** 報告的 timeline 標哪一層 */
  layer: 'meat' | 'net'
  /** 這個戰場的單位有哪幾條軌：現實是生命與感載，內海只有感載 */
  tracks: Array<'hp' | 'load'>
  /** 過載之後（感載歸零、疊一層餘韻、還沒倒下）：lose_turn 失去下一個回合（現實）；flash 閃斷，一池資源歸零、不失去回合（內海） */
  overload: 'lose_turn' | 'flash'
  /** 閃斷歸零的是哪一池 */
  flashPool?: string
  /** 餘韻每一層：roll 是所有檢定（命中、迴避、豁免）的加減（現實全屬性 −2，就是 −1；內海 +1）；loadDealtPct 是自己造成的感載多幾 % */
  afterglow: { roll: number; loadDealtPct: number }
  /** 護甲（防護）擋不擋感載：現實不擋，內海的防護構裝直接減感載 */
  armorOnLoad: boolean
  /** 遮蔽三級的名字：[暴露, 半掩體, 掩體]；內海是防火牆節點 */
  coverNames: [string, string, string]
  /** 「遮蔽」這個字在這個戰場怎麼說 */
  coverWord: string
  numbers: BattleNumbers
}

/** 核心帶的兩個戰場（CORE_RULES 4.2 節的表；CYBERSPACE 6.1 節的對照表）。資料裡有 battle_mode 時以資料為準。 */
export const DEFAULT_MODES: Record<string, BattleMode> = {
  meat: {
    id: 'meat', name: '現實', layer: 'meat', tracks: ['hp', 'load'], overload: 'lose_turn',
    afterglow: { roll: -1, loadDealtPct: 10 }, armorOnLoad: false,
    coverNames: ['暴露', '半掩體', '掩體'], coverWord: '遮蔽', numbers: DEFAULT_NUMBERS,
  },
  net: {
    id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flashPool: 'ram',
    afterglow: { roll: 1, loadDealtPct: 10 }, armorOnLoad: true,
    coverNames: ['暴露', '半防火牆', '防火牆'], coverWord: '防火牆',
    numbers: { ...DEFAULT_NUMBERS, rankDamage: { minion: 1, elite: 1, boss: 1 } },
  },
}

/** 一種傷害怎麼算（COMBAT_SYSTEM 第 5 節的表）。 */
export interface DamageTypeRule {
  id: DamageType
  name: string
  /** 打哪一條 */
  track: 'hp' | 'load'
  /** 護甲算幾成：1 照扣、0.5 無視一半、0 不看 */
  armor: number
  /** 對沒有橋的目標無效 */
  needsBridge?: boolean
  /** 對帶著這個標籤的目標傷害乘多少（電磁對 machine ×2） */
  vs?: Record<string, number>
  /** 命中而且有傷害時給的狀態（熱能的燃燒、電磁的失效）：狀態的 id 與幾個回合 */
  onHit?: Array<{ status: string; turns: number }>
  /** 每次命中沉溺加多少（快感）。戰鬥結束時寫回角色 */
  sink?: number
}

export const DEFAULT_DAMAGE_TYPES: Record<DamageType, DamageTypeRule> = {
  physical: { id: 'physical', name: '物理', track: 'hp', armor: 1 },
  thermal: { id: 'thermal', name: '熱能', track: 'hp', armor: 0.5, onHit: [{ status: 'burning', turns: 2 }] },
  em: { id: 'em', name: '電磁', track: 'hp', armor: 0, vs: { machine: 2 }, onHit: [{ status: 'jammed', turns: 1 }] },
  neural: { id: 'neural', name: '神經', track: 'load', armor: 0, needsBridge: true },
  pleasure: { id: 'pleasure', name: '快感', track: 'load', armor: 0, needsBridge: true, sink: 1 },
}

/** 修正的種類：狀態、技能、義體用這些鍵加減戰鬥裡的數字。 */
export const MOD_KINDS = [
  /** 自己攻擊的命中 */ 'hit',
  /** 別人打他時攻擊者的命中（標記 +2） */ 'hit_against',
  /** 迴避 */ 'evade',
  /** 傷害骰的顆數 */ 'dice',
  /** 固定的傷害 */ 'damage',
  /** 穿甲 */ 'pierce',
  /** 護甲 */ 'armor',
  /** 要害的門檻（負的是更容易） */ 'crit_margin',
  /** 豁免與戰鬥裡的檢定 */ 'save',
  /** 先攻 */ 'initiative',
  /** 每回合回復的行動點 */ 'ap_regen',
  /** 自己造成的感載（百分比） */ 'load_dealt_pct',
  /** 自己受到的感載（百分比；同步檔位的 ×0.5 是 −50） */ 'load_taken_pct',
  /** 感載每回合的自然消退 */ 'decay',
  /** 換位花的行動點（負的是減免） */ 'move_ap',
] as const
export type ModKind = (typeof MOD_KINDS)[number]

/** 狀態什麼時候結束的幾種寫法（資料用）。 */
export const STATUS_UNTILS = ['own_turn_end', 'own_turn_start', 'source_turn_start', 'source_turn_end', 'battle_end'] as const
export type StatusUntil = (typeof STATUS_UNTILS)[number]

/** 一個戰鬥中的狀態（壓制、暈眩、流血、標記、失去回合……）：資料驅動，核心照這幾個欄位算。 */
export interface BattleStatusRule {
  id: string
  name: string
  desc: string
  /** 帶著的時候的加減，鍵是修正的種類 */
  mods?: Partial<Record<ModKind, number>>
  /** 不能換位（壓制） */
  noMove?: boolean
  /** 失去回合：輪到他時直接跳過，並拿掉這個狀態（過載、癱瘓） */
  loseTurn?: boolean
  /** 每個自己的回合開始時：行動點加減、生命加減（流血 −2）、擲幾顆骰扣生命（燃燒 1d6）、感載加減 */
  turnStart?: { ap?: number; hp?: number; hpDice?: number; load?: number }
  /** turnStart 只發生一次，發生完就拿掉（暈眩：下回合行動點 −2） */
  once?: boolean
  /** 預設什麼時候結束、幾個回合 */
  until: StatusUntil
  turns: number
  /** 種類：control（控制：首領有控制保護）、debuff、buff、wound（重創的輕的那一級）、mark */
  kind: 'control' | 'debuff' | 'buff' | 'wound' | 'mark'
  /** 什麼可以解掉它（first_aid 止血；cleanse 一律可以） */
  cleansedBy?: string[]
}

/** 核心一定有的狀態：過載之後的失去回合。其餘（壓制、暈眩、流血、標記、燃燒……）由資料給。 */
export const LOSE_TURN = 'lose_turn'
export const DEFAULT_STATUSES: Record<string, BattleStatusRule> = {
  [LOSE_TURN]: { id: LOSE_TURN, name: '失去回合', desc: '這個人動不了：輪到他的時候直接跳過。這段時間可以被制伏。', loseTurn: true, until: 'own_turn_start', turns: 1, kind: 'control' },
}

/** 遭遇點的四種遮蔽配置（SITES 12.2 節；COMMISSION_MAPS 1.3 節）：每一方四格，索引 0 是第 1 格（最前面）。 */
export const COVER_LAYOUTS: Record<string, { ally: [number, number, number, number]; foe: [number, number, number, number] }> = {
  dense: { ally: [1, 1, 2, 2], foe: [1, 1, 2, 2] },
  medium: { ally: [0, 1, 1, 2], foe: [0, 1, 1, 2] },
  sparse: { ally: [0, 0, 0, 1], foe: [0, 0, 0, 1] },
  one_sided: { ally: [0, 0, 0, 1], foe: [2, 2, 1, 1] },
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// ---- 內容種類（資料的格式） ----

export interface BattleModeEntry extends ContentEntry {
  name: string
  layer: 'meat' | 'net'
  tracks: Array<'hp' | 'load'>
  overload: 'lose_turn' | 'flash'
  flash_pool?: string
  afterglow: { roll: number; load_dealt_pct: number }
  armor_on_load?: boolean
  cover_names: [string, string, string]
  cover_word: string
  /** 只寫和預設不同的數字；鍵和 BattleNumbers 一樣 */
  numbers?: Partial<BattleNumbers>
}

export interface DamageTypeEntry extends ContentEntry {
  name: string
  track: 'hp' | 'load'
  armor: number
  needs_bridge?: boolean
  vs?: Record<string, number>
  on_hit?: Array<{ status: string; turns: number }>
  sink?: number
}

export interface BattleStatusEntry extends ContentEntry {
  name: string
  desc: string
  mods?: Partial<Record<ModKind, number>>
  no_move?: boolean
  lose_turn?: boolean
  turn_start?: { ap?: number; hp?: number; hp_dice?: number; load?: number }
  once?: boolean
  until: StatusUntil
  turns?: number
  kind: BattleStatusRule['kind']
  cleansed_by?: string[]
}

export function registerBattleKinds(content: ContentRegistry): void {
  content.defineKind<BattleModeEntry>({
    kind: 'battle_mode', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name')
      if (e.layer !== 'meat' && e.layer !== 'net') p.push('layer 只能是 meat、net')
      if (!(Array.isArray(e.tracks) && e.tracks.length > 0 && e.tracks.every((t) => t === 'hp' || t === 'load'))) p.push('tracks 要是 hp、load 的陣列（至少一條）')
      if (e.overload !== 'lose_turn' && e.overload !== 'flash') p.push('overload 只能是 lose_turn、flash')
      if (e.overload === 'flash' && !isText(e.flash_pool)) p.push('overload 是 flash 時要寫 flash_pool（歸零的是哪一池）')
      if (!isRecord(e.afterglow) || !isNum(e.afterglow.roll) || !isNum(e.afterglow.load_dealt_pct)) p.push('afterglow 要有 roll 與 load_dealt_pct')
      if (!(Array.isArray(e.cover_names) && e.cover_names.length === 3 && e.cover_names.every(isText))) p.push('cover_names 要是三個名字（暴露、半掩體、掩體）')
      if (!isText(e.cover_word)) p.push('要有 cover_word')
      if (e.numbers !== undefined) {
        if (!isRecord(e.numbers)) p.push('numbers 要是一個物件')
        else for (const key of Object.keys(e.numbers)) if (!(key in DEFAULT_NUMBERS)) p.push(`numbers.${key}：沒有這個數字（可以寫的：${Object.keys(DEFAULT_NUMBERS).join('、')}）`)
      }
      return p
    },
  })

  content.defineKind<DamageTypeEntry>({
    kind: 'damage_type', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      if (!(DAMAGE_TYPES as readonly unknown[]).includes(e.id)) p.push(`id 只能是 ${DAMAGE_TYPES.join('、')}`)
      if (!isText(e.name)) p.push('要有 name')
      if (e.track !== 'hp' && e.track !== 'load') p.push('track 只能是 hp、load')
      if (!isNum(e.armor) || e.armor < 0 || e.armor > 1) p.push('armor 要是 0～1（護甲算幾成）')
      if (e.vs !== undefined && !(isRecord(e.vs) && Object.values(e.vs).every(isNum))) p.push('vs 要是「標籤 → 倍率」')
      if (e.on_hit !== undefined && !(Array.isArray(e.on_hit) && e.on_hit.every((x) => isRecord(x) && isText(x.status) && Number.isInteger(x.turns) && (x.turns as number) > 0))) p.push('on_hit 要是 { status, turns } 的陣列')
      if (e.sink !== undefined && !Number.isInteger(e.sink)) p.push('sink 要是整數')
      return p
    },
    refs: (e) => (e.on_hit ?? []).map((x) => ['battle_status', x.status]),
  })

  content.defineKind<BattleStatusEntry>({
    kind: 'battle_status', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name')
      if (!isText(e.desc)) p.push('要有 desc（完整的句子）')
      if (e.mods !== undefined) {
        if (!isRecord(e.mods)) p.push('mods 要是一個物件')
        else for (const [key, v] of Object.entries(e.mods)) {
          if (!(MOD_KINDS as readonly string[]).includes(key)) p.push(`mods.${key}：只能是 ${MOD_KINDS.join('、')}`)
          else if (!isNum(v) || v === 0) p.push(`mods.${key} 要是不為 0 的數字`)
        }
      }
      if (e.turn_start !== undefined && !(isRecord(e.turn_start) && Object.entries(e.turn_start).every(([key, v]) => ['ap', 'hp', 'hp_dice', 'load'].includes(key) && Number.isInteger(v)))) p.push('turn_start 只能寫 ap、hp、hp_dice、load，值是整數')
      if (!(STATUS_UNTILS as readonly unknown[]).includes(e.until)) p.push(`until 只能是 ${STATUS_UNTILS.join('、')}`)
      if (e.turns !== undefined && !(Number.isInteger(e.turns) && (e.turns as number) >= 1)) p.push('turns 要是 1 以上的整數')
      if (!['control', 'debuff', 'buff', 'wound', 'mark'].includes(e.kind as string)) p.push('kind 只能是 control、debuff、buff、wound、mark')
      for (const f of ['no_move', 'lose_turn', 'once'] as const) if (e[f] !== undefined && typeof e[f] !== 'boolean') p.push(`${f} 要是布林值`)
      return p
    },
  })
}

// ---- 查詢：資料優先，沒有就用核心的預設 ----

export function modeOf(content: ContentRegistry, id: string): BattleMode | undefined {
  const e = content.get<BattleModeEntry>('battle_mode', id)
  if (!e) return DEFAULT_MODES[id]
  const base = DEFAULT_MODES[id]?.numbers ?? DEFAULT_NUMBERS
  return {
    id: e.id, name: e.name, layer: e.layer, tracks: [...e.tracks], overload: e.overload, ...(e.flash_pool ? { flashPool: e.flash_pool } : {}),
    afterglow: { roll: e.afterglow.roll, loadDealtPct: e.afterglow.load_dealt_pct }, armorOnLoad: e.armor_on_load ?? false,
    coverNames: [...e.cover_names] as [string, string, string], coverWord: e.cover_word, numbers: { ...base, ...(e.numbers ?? {}) },
  }
}

export function damageTypeOf(content: ContentRegistry, id: DamageType): DamageTypeRule {
  const e = content.get<DamageTypeEntry>('damage_type', id)
  if (!e) return DEFAULT_DAMAGE_TYPES[id]
  return {
    id, name: e.name, track: e.track, armor: e.armor, ...(e.needs_bridge ? { needsBridge: true } : {}), ...(e.vs ? { vs: { ...e.vs } } : {}),
    ...(e.on_hit ? { onHit: e.on_hit.map((x) => ({ ...x })) } : {}), ...(e.sink ? { sink: e.sink } : {}),
  }
}

export function statusRuleOf(content: ContentRegistry, id: string): BattleStatusRule | undefined {
  const e = content.get<BattleStatusEntry>('battle_status', id)
  if (!e) return DEFAULT_STATUSES[id]
  const t = e.turn_start
  return {
    id: e.id, name: e.name, desc: e.desc, ...(e.mods ? { mods: { ...e.mods } } : {}), ...(e.no_move ? { noMove: true } : {}), ...(e.lose_turn ? { loseTurn: true } : {}),
    ...(t ? { turnStart: { ...(t.ap !== undefined ? { ap: t.ap } : {}), ...(t.hp !== undefined ? { hp: t.hp } : {}), ...(t.hp_dice !== undefined ? { hpDice: t.hp_dice } : {}), ...(t.load !== undefined ? { load: t.load } : {}) } } : {}),
    ...(e.once ? { once: true } : {}), until: e.until, turns: e.turns ?? 1, kind: e.kind, ...(e.cleansed_by ? { cleansedBy: [...e.cleansed_by] } : {}),
  }
}

/** 一個狀態這一筆的某一種修正：自己的 data 蓋掉資料的預設。 */
export function statusMod(rule: BattleStatusRule | undefined, status: BattleStatus, kind: ModKind): number {
  return status.data?.[kind] ?? rule?.mods?.[kind] ?? 0
}

/** 遮蔽某一級在這個等級的場景裡的耐久。 */
export function coverHpFor(n: BattleNumbers, level: 1 | 2, grade: Grade): number {
  const list = level === 2 ? n.coverHp.full : n.coverHp.half
  return list[Math.min(list.length, Math.max(1, grade)) - 1] ?? list[0]!
}

export const RANK_NAME: Record<UnitRank, string> = { minion: '雜兵', elite: '精英', boss: '首領' }
export { UNIT_RANKS }

// ---- 武器的類型（COMBAT_SYSTEM 第 5 節的表）：設計圖與敵人的武器都從這張表起算，內海的武器構裝沿用同樣的原型 ----

export interface WeaponClassEntry extends ContentEntry {
  name: string
  /** 基礎的傷害骰（顆數，d6） */
  dice: number
  /** 距離超過 beyond 時改用的骰數（霰彈槍：距離 1～2 是 5d6，3 以上 3d6） */
  far?: { beyond: number; dice: number }
  type: DamageType
  range: [number, number]
  /** 彈匣（格）；近戰、鞭、霧不寫 */
  mag?: number
  cover_mult: number
  pierce: number
  /** 特性：long、melee、push、pull、aimed、sweep、blast、heavy、silent、concealable…… */
  traits: string[]
  /** 命中用哪一組：槍械是 reflex ＋ firearms；近戰是 body ＋ brawl；重武器是 body ＋ heavy */
  attr: 'body' | 'reflex' | 'tech' | 'intellect' | 'resolve' | 'charm'
  skill: string
  /** 一槍花的行動點（狙擊槍 3）；沒寫照行動表 */
  ap?: number
}

export function registerWeaponClassKind(content: ContentRegistry): void {
  content.defineKind<WeaponClassEntry>({
    kind: 'weapon_class', owner: 'core',
    validate: (e) => {
      const p: string[] = []
      const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
      if (!isText(e.name)) p.push('要有 name')
      if (!int(e.dice) || e.dice < 1) p.push('dice 要是 1 以上的整數（幾顆 d6）')
      if (e.far !== undefined && !(isRecord(e.far) && int(e.far.beyond) && int(e.far.dice))) p.push('far 要有 beyond 與 dice')
      if (!(DAMAGE_TYPES as readonly unknown[]).includes(e.type)) p.push(`type 只能是 ${DAMAGE_TYPES.join('、')}`)
      if (!(Array.isArray(e.range) && e.range.length === 2 && e.range.every(int) && e.range[0]! >= 1 && e.range[0]! <= e.range[1]! && e.range[1]! <= 7)) p.push('range 要是 [近, 遠]，在 1～7 之間')
      if (e.mag !== undefined && !(int(e.mag) && e.mag >= 1 && e.mag <= 4)) p.push('mag 要是 1～4（格）')
      if (!isNum(e.cover_mult) || e.cover_mult < 0) p.push('cover_mult 要是 0 以上的數字')
      if (!int(e.pierce) || e.pierce < 0) p.push('pierce 要是 0 以上的整數')
      if (!(Array.isArray(e.traits) && e.traits.every(isText))) p.push('traits 要是特性的陣列')
      if (!['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].includes(e.attr as string)) p.push('attr 要是屬性的 id')
      if (!isText(e.skill)) p.push('要有 skill（基本功的 id）')
      if (e.ap !== undefined && !(int(e.ap) && e.ap >= 1 && e.ap <= 4)) p.push('ap 要是 1～4')
      return p
    },
    refs: (e) => [['skill', e.skill]],
  })
}

export interface WeaponBuild {
  /** 這場戰鬥裡的 id；沒寫用類型的 id */
  id?: string
  name?: string
  /** 命中的合計加值 */
  hit: number
  /** 槍管的等級骰（III +1、IV +2、V +3），或其他多出來的骰 */
  extraDice?: number
  flat?: number
  pierce?: number
  type?: DamageType
  range?: [number, number]
  mag?: number
  traits?: string[]
  item?: string
}

/** 槍管的等級骰（COMBAT_SYSTEM 第 5 節；BALANCE 2.1 節）：決定傷害的零件是 III 級 +1 顆、IV 級 +2 顆、V 級 +3 顆。敵我共用。 */
export const GRADE_DICE: readonly number[] = [0, 0, 1, 2, 3]
export function gradeDice(grade: number): number {
  return GRADE_DICE[Math.min(5, Math.max(1, Math.floor(grade))) - 1]!
}

/** 從武器的類型（COMBAT_SYSTEM 第 5 節的表）組出一把戰鬥裡的武器。設計圖加零件、敵人的資料都從這裡起算。 */
export function weaponFromClass(content: ContentRegistry, classId: string, b: WeaponBuild): import('../types').BattleWeapon {
  const c = content.get<WeaponClassEntry>('weapon_class', classId)
  if (!c) throw new Error(`沒有 ${classId} 這種武器的類型`)
  const extra = b.extraDice ?? 0
  const mag = b.mag ?? c.mag
  return {
    id: b.id ?? c.id, name: b.name ?? c.name, class: c.id, dice: c.dice + extra, ...(c.far ? { far: { beyond: c.far.beyond, dice: c.far.dice + extra } } : {}),
    flat: b.flat ?? 0, type: b.type ?? c.type, range: [...(b.range ?? c.range)] as [number, number], pierce: c.pierce + (b.pierce ?? 0), hit: b.hit,
    attr: c.attr, skill: c.skill, ...(mag ? { mag: { now: mag, max: mag } } : {}), coverMult: c.cover_mult,
    traits: [...new Set([...c.traits, ...(b.traits ?? [])])], ...(c.ap ? { ap: c.ap } : {}), ...(b.item ? { item: b.item } : {}),
  }
}
