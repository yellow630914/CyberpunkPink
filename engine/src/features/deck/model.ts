// L6 功能 deck：資料的型別、內容種類的格式檢查、角色身上的 ext.deck 怎麼讀與寫、規則表 deck_rule。
// 規格：CYBERSPACE 4.2、4.3 節；ITEMS 11.1、11.9 節；DATA 7.3、7.4 節；dev/adr/0018 第三節（甲板在 M3 是一件成品）。
// 內容種類：deck（成品格式，暫定）、construct（構裝）、skin（化身的穿著）、deck_rule（規則的數字）。
// actor.ext.deck 只經由核心的 actor.ext 變更寫；讀的時候壞掉的資料一律讀成沒有／空的，不丟錯。

import type { ContentEntry, GameState, Kernel } from '../../core'
import { LEGALITIES, MOD_KINDS, isRecord } from '../../core'

export const OWNER = 'deck'
export const EXT = 'deck'

export const DECK_KIND = 'deck'
export const CONSTRUCT_KIND = 'construct'
export const SKIN_KIND = 'skin'
export const RULE_KIND = 'deck_rule'
/** 快駭程式的內容種類由 features/hack 定義；這裡只認 id，沒有人定義這個種類時不收。 */
export const QUICKHACK_KIND = 'quickhack'
/** 腳本：帶這個標籤的道具（ITEMS 5.2 節）。 */
export const SCRIPT_TAG = 'script'

export const CONSTRUCT_CLASSES = ['weapon', 'defense', 'tool', 'hack', 'body', 'unique'] as const
export type ConstructClass = (typeof CONSTRUCT_CLASSES)[number]
/** 武器構裝的傷害類型寫法：干擾（jam）在戰鬥裡是神經加特性 jam（CYBERSPACE 6.5 節）。 */
export const WEAPON_TYPES = ['neural', 'pleasure', 'jam'] as const
export type ConstructWeaponType = (typeof WEAPON_TYPES)[number]
/** 工具構裝的目標（戰鬥行動的目標種類）。 */
export const TOOL_TARGETS = ['none', 'foe', 'ally', 'unit', 'self', 'foe_slot', 'ally_slot', 'overlay', 'node', 'mixed'] as const
export const SKIN_CUTS = ['female', 'male', 'femboy', 'neutral', 'custom'] as const

// ---- 內容的型別 ----

export interface DeckEntry extends ContentEntry {
  name: string
  desc: string
  /** 等級 1～4 */
  grade: number
  /** 構裝槽 */
  slots: number
  /** 防火牆（抵擋快駭與反駭的 DC） */
  firewall: number
  /** RAM 的加值：max 加在 ram_max、regen 加在 ram_regen */
  ram?: { max?: number; regen?: number }
  /** 散熱：潛入時每回合（戰鬥與探索）感載多消退幾點。是內海感載消退量（衍生數值 net_load_decay）的一個來源；內海的基礎消退是 0（M3 修正批） */
  cooling?: number
  brand?: string
  legal: string
  price?: number
}

export interface ModEntry {
  do?: Array<Record<string, unknown>>
  mods?: Partial<Record<string, number>>
}

export interface ConstructEntry extends ContentEntry {
  class: ConstructClass
  name: string
  desc?: string
  series?: string
  /** 等級 1～5（V 是具名，只從特殊任務來） */
  grade: number
  /** 佔幾個構裝槽（預設 1；構裝體 2） */
  slots?: number
  brand?: string
  legal: string
  price?: number
  // 武器
  archetype?: string
  type?: ConstructWeaponType
  ram?: number
  dice?: number | string
  range?: [number, number]
  cover_mult?: number
  traits?: string[]
  // 防護
  guard?: number
  // 工具
  ap?: number
  passive?: boolean
  target?: string
  do?: Array<Record<string, unknown>>
  mods?: Partial<Record<string, number>>
  // 駭入程式（M3-netadmin 讀）
  admin?: unknown
  // 共通
  advanced?: ModEntry | null
  ultimate?: ModEntry | null
  quirk?: unknown
}

export interface SkinEntry extends ContentEntry {
  name: string
}

// ---- 規則表 deck_rule ----

export interface GradeBonus {
  hit: number
  dice: number
}

export interface DeckRules {
  /** 構裝等級的加值（ITEMS 11.1 節）：鍵是等級 1～5 */
  grade_bonus: Record<number, GradeBonus>
  /** 腳本最多帶「甲板等級 ＋ 這個數」支（ITEMS 5.2 節） */
  script_extra: number
  /** 裝上或卸下一件構裝花幾分鐘（ITEMS 11.9 節） */
  swap_minutes: number
  /** 每回合 RAM 回復的基本值（NETRUNNING 第 1 節） */
  ram_regen: number
  /**
   * 構裝等級高過甲板時，是不是照甲板的等級算加值。ITEMS 11.9 節只寫了快駭程式「照甲板的等級跑」（由 features/hack 做），
   * 構裝沒有寫；M3 預設不夾（M3-deck 驗收：II 級甲板上的 III 級步槍照 III 級算），資料要夾就把它設成 true。
   */
  cap_construct_grade: boolean
}

export const DEFAULT_DECK_RULES: DeckRules = {
  grade_bonus: { 1: { hit: 0, dice: 0 }, 2: { hit: 1, dice: 0 }, 3: { hit: 1, dice: 1 }, 4: { hit: 2, dice: 2 }, 5: { hit: 2, dice: 2 } },
  script_extra: 1,
  swap_minutes: 1,
  ram_regen: 2,
  cap_construct_grade: true,
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function gradeBonusProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['grade_bonus 要是「等級 → { hit, dice }」']
  const p: string[] = []
  for (const [g, b] of Object.entries(v)) {
    if (!/^[1-5]$/.test(g)) p.push(`grade_bonus.${g}：等級只能是 1～5`)
    else if (!(isRecord(b) && isInt(b.hit) && isInt(b.dice) && b.dice >= 0)) p.push(`grade_bonus.${g} 要是 { hit: 整數, dice: 0 以上的整數 }`)
  }
  return p
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.grade_bonus !== undefined) p.push(...gradeBonusProblems(e.grade_bonus))
  for (const f of ['script_extra', 'swap_minutes', 'ram_regen'] as const) if (e[f] !== undefined && !(isInt(e[f]) && (e[f] as number) >= 0)) p.push(`${f} 要是 0 以上的整數`)
  if (e.cap_construct_grade !== undefined && typeof e.cap_construct_grade !== 'boolean') p.push('cap_construct_grade 要是布林值')
  return p
}

/** 規則的數字：資料（deck_rule/default）有寫、而且格式沒壞的欄位蓋掉內建的預設。 */
export function deckRules(k: Pick<Kernel, 'content'>): DeckRules {
  const out: DeckRules = { ...DEFAULT_DECK_RULES, grade_bonus: { ...DEFAULT_DECK_RULES.grade_bonus } }
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  if (e.grade_bonus !== undefined && !bad.has('grade_bonus')) {
    for (const [g, b] of Object.entries(e.grade_bonus as Record<string, GradeBonus>)) out.grade_bonus[Number(g)] = { hit: b.hit, dice: b.dice }
  }
  for (const f of ['script_extra', 'swap_minutes', 'ram_regen'] as const) if (e[f] !== undefined && !bad.has(f)) out[f] = e[f] as number
  if (e.cap_construct_grade !== undefined && !bad.has('cap_construct_grade')) out.cap_construct_grade = e.cap_construct_grade as boolean
  return out
}

/** 等級的加值：等級 5 以上用表上最高的那一級。 */
export function gradeBonus(rules: DeckRules, grade: number): GradeBonus {
  for (let g = Math.max(1, Math.min(5, Math.floor(grade))); g >= 1; g--) if (rules.grade_bonus[g]) return rules.grade_bonus[g]!
  return { hit: 0, dice: 0 }
}

// ---- 內容種類的格式檢查 ----

export function deckProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!isText(e.desc)) p.push('要有 desc（完整的句子）')
  if (!(isInt(e.grade) && e.grade >= 1 && e.grade <= 4)) p.push('grade 要是 1～4')
  if (!(isInt(e.slots) && e.slots >= 0 && e.slots <= 32)) p.push('slots（構裝槽）要是 0～32 的整數')
  if (!(isInt(e.firewall) && e.firewall >= 0)) p.push('firewall 要是 0 以上的整數')
  if (e.ram !== undefined) {
    if (!isRecord(e.ram)) p.push('ram 要是 { max?, regen? }')
    else for (const f of ['max', 'regen']) if (e.ram[f] !== undefined && !(isInt(e.ram[f]) && (e.ram[f] as number) >= 0)) p.push(`ram.${f} 要是 0 以上的整數`)
  }
  if (e.cooling !== undefined && !(isInt(e.cooling) && e.cooling >= 0)) p.push('cooling 要是 0 以上的整數')
  if (e.brand !== undefined && !isText(e.brand)) p.push('brand 要是字串')
  if (!(LEGALITIES as readonly unknown[]).includes(e.legal)) p.push(`legal 只能是 ${LEGALITIES.join('、')}`)
  if (e.price !== undefined && !(isInt(e.price) && e.price >= 0)) p.push('price 要是 0 以上的整數')
  return p
}

function modsProblems(v: unknown, at: string): string[] {
  if (!isRecord(v)) return [`${at} 要是 { 修正的種類: 數字 }`]
  const p: string[] = []
  for (const [key, n] of Object.entries(v)) {
    if (!(MOD_KINDS as readonly string[]).includes(key)) p.push(`${at}.${key}：只能是 ${MOD_KINDS.join('、')}`)
    else if (!isNum(n) || n === 0) p.push(`${at}.${key} 要是不為 0 的數字`)
  }
  return p
}

function doProblems(k: Pick<Kernel, 'battle'>, v: unknown, at: string): string[] {
  return k.battle.effectProblems(v).map((m) => `${at}：${m}`)
}

function tierProblems(k: Pick<Kernel, 'battle'>, v: unknown, at: string): string[] {
  if (v === null || v === undefined) return []
  if (!isRecord(v)) return [`${at} 要是 { do?, mods? }（或 null）`]
  const p: string[] = []
  for (const key of Object.keys(v)) if (key !== 'do' && key !== 'mods') p.push(`${at}.${key} 不是可以用的鍵（只有 do、mods）`)
  if (v.do !== undefined) p.push(...doProblems(k, v.do, `${at}.do`))
  if (v.mods !== undefined) p.push(...modsProblems(v.mods, `${at}.mods`))
  return p
}

const parseDice = (v: unknown): boolean => (isInt(v) && v >= 1) || (typeof v === 'string' && /^[1-9]\d*d6$/.test(v))
/** 骰數：整數，或「Nd6」的寫法（DATA 7.3 節的範例）。 */
export const diceOf = (v: unknown): number | undefined => (isInt(v) && v >= 1 ? v : typeof v === 'string' && /^[1-9]\d*d6$/.test(v) ? Number(v.slice(0, -2)) : undefined)

export function constructProblems(k: Pick<Kernel, 'battle'>, e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!(CONSTRUCT_CLASSES as readonly unknown[]).includes(e.class)) p.push(`class 只能是 ${CONSTRUCT_CLASSES.join('、')}`)
  if (!isText(e.name)) p.push('要有 name')
  if (e.series !== undefined && !isText(e.series)) p.push('series 要是字串')
  if (!(isInt(e.grade) && e.grade >= 1 && e.grade <= 5)) p.push('grade 要是 1～5')
  if (e.slots !== undefined && !(isInt(e.slots) && e.slots >= 1 && e.slots <= 4)) p.push('slots（佔幾個構裝槽）要是 1～4')
  if (e.brand !== undefined && !isText(e.brand)) p.push('brand 要是字串')
  if (!(LEGALITIES as readonly unknown[]).includes(e.legal)) p.push(`legal 只能是 ${LEGALITIES.join('、')}`)
  if (e.price !== undefined && !(isInt(e.price) && e.price >= 0)) p.push('price 要是 0 以上的整數')
  if (e.class === 'weapon') {
    if (!isText(e.archetype)) p.push('武器要寫 archetype（weapon_class 的 id）')
    if (!(WEAPON_TYPES as readonly unknown[]).includes(e.type)) p.push(`type 只能是 ${WEAPON_TYPES.join('、')}`)
    if (!(isInt(e.ram) && e.ram >= 0)) p.push('ram 要是 0 以上的整數（每次攻擊花幾點 RAM）')
    if (e.dice !== undefined && !parseDice(e.dice)) p.push('dice 要是 1 以上的整數，或「Nd6」')
    if (e.range !== undefined && !(Array.isArray(e.range) && e.range.length === 2 && e.range.every(isInt) && (e.range[0] as number) >= 1 && (e.range[0] as number) <= (e.range[1] as number) && (e.range[1] as number) <= 7)) p.push('range 要是 [近, 遠]，在 1～7 之間')
    if (e.cover_mult !== undefined && !(isNum(e.cover_mult) && e.cover_mult >= 0)) p.push('cover_mult 要是 0 以上的數字')
    if (e.traits !== undefined && !(Array.isArray(e.traits) && e.traits.every(isText))) p.push('traits 要是特性的字串陣列')
  }
  if (e.class === 'defense' && !(isInt(e.guard) && e.guard >= 0)) p.push('防護要寫 guard（0 以上的整數）')
  if (e.class === 'tool') {
    if (!(isInt(e.ap) && e.ap >= 0 && e.ap <= 4)) p.push('工具要寫 ap（0～4 的整數）')
    if (!(isInt(e.ram) && e.ram >= 0)) p.push('工具要寫 ram（0 以上的整數）')
    if (e.passive !== undefined && typeof e.passive !== 'boolean') p.push('passive 要是布林值')
    if (e.target !== undefined && !(TOOL_TARGETS as readonly unknown[]).includes(e.target)) p.push(`target 只能是 ${TOOL_TARGETS.join('、')}`)
  }
  if (e.do !== undefined) p.push(...doProblems(k, e.do, 'do'))
  if (e.mods !== undefined) p.push(...modsProblems(e.mods, 'mods'))
  p.push(...tierProblems(k, e.advanced, 'advanced'), ...tierProblems(k, e.ultimate, 'ultimate'))
  return p
}

export function skinProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (e.style !== undefined && !isText(e.style)) p.push('style 要是字串')
  if (e.style_value !== undefined && !(isInt(e.style_value) && e.style_value >= 1 && e.style_value <= 5)) p.push('style_value 要是 1～5')
  if (e.exposure !== undefined && e.exposure !== 'custom' && !(isInt(e.exposure) && e.exposure >= 0 && e.exposure <= 3)) p.push('exposure 要是 0～3（空白 SKIN 寫 custom）')
  if (e.cut !== undefined && !(SKIN_CUTS as readonly unknown[]).includes(e.cut)) p.push(`cut 只能是 ${SKIN_CUTS.join('、')}`)
  if (e.adult !== undefined && typeof e.adult !== 'boolean') p.push('adult 要是布林值')
  if (e.forms !== undefined && !(Array.isArray(e.forms) && e.forms.every((f) => isRecord(f) && isText(f.id) && isText(f.name)))) p.push('forms 要是 { id, name } 的陣列')
  if (e.real_twin !== undefined && !(Array.isArray(e.real_twin) && e.real_twin.every(isText))) p.push('real_twin 要是字串的陣列')
  if (e.price !== undefined && e.price !== null && !(isInt(e.price) && e.price >= 0)) p.push('price 要是 0 以上的整數，或 null（不賣）')
  return p
}

// ---- actor.ext.deck ----

export interface ScriptEntry {
  item: string
  qty: number
}

/** 角色身上的甲板資料（整理過的樣子）。 */
export interface DeckExt {
  /** 背包裡那一副甲板的 data.uid */
  uid?: string
  /** 租來的甲板（蓋過自己的） */
  rental?: { deck: string }
  /** 裝在構裝槽裡的東西（構裝與快駭程式，照槽的順序） */
  slots: string[]
  skin?: string
  scripts: ScriptEntry[]
}

/** 把存檔裡的東西整理成 DeckExt：壞掉的欄位直接丟掉（slots 不是陣列就是空的），同一件裝兩次只留第一次。 */
export function readExt(raw: unknown): DeckExt {
  const out: DeckExt = { slots: [], scripts: [] }
  if (!isRecord(raw)) return out
  if (isText(raw.uid)) out.uid = raw.uid
  if (isRecord(raw.rental) && isText(raw.rental.deck)) out.rental = { deck: raw.rental.deck }
  if (Array.isArray(raw.slots)) for (const s of raw.slots) if (isText(s) && !out.slots.includes(s)) out.slots.push(s)
  if (isText(raw.skin)) out.skin = raw.skin
  if (Array.isArray(raw.scripts)) {
    for (const s of raw.scripts) if (isRecord(s) && isText(s.item) && Number.isSafeInteger(s.qty) && (s.qty as number) >= 1) out.scripts.push({ item: s.item, qty: s.qty as number })
  }
  return out
}

/** 角色現在的 ext.deck（整理過）。沒有這個角色是空的。 */
export const extOf = (state: GameState, actor: string): DeckExt => readExt(state.actors[actor]?.ext[EXT])

/**
 * 要寫回 actor.ext.deck 的值：照角色現在的原始資料，蓋上 patch 寫了的欄位（值是 null 就是拿掉）。
 * 原始資料裡不認得的鍵原樣留著（之後的功能加的欄位，例如 skins）。
 */
export function extValue(state: GameState, actor: string, patch: { uid?: string | null; rental?: { deck: string } | null; slots?: string[]; skin?: string | null; scripts?: ScriptEntry[] }): Record<string, unknown> {
  const raw = state.actors[actor]?.ext[EXT]
  const cur = readExt(raw)
  const base: Record<string, unknown> = isRecord(raw) ? { ...raw } : {}
  const next: DeckExt = {
    ...(cur.uid !== undefined ? { uid: cur.uid } : {}), ...(cur.rental ? { rental: cur.rental } : {}), slots: cur.slots,
    ...(cur.skin !== undefined ? { skin: cur.skin } : {}), scripts: cur.scripts,
  }
  if (patch.uid !== undefined) patch.uid === null ? delete next.uid : (next.uid = patch.uid)
  if (patch.rental !== undefined) patch.rental === null ? delete next.rental : (next.rental = patch.rental)
  if (patch.slots !== undefined) next.slots = patch.slots
  if (patch.skin !== undefined) patch.skin === null ? delete next.skin : (next.skin = patch.skin)
  if (patch.scripts !== undefined) next.scripts = patch.scripts
  for (const key of ['uid', 'rental', 'skin']) delete base[key]
  return { ...base, ...next, slots: [...next.slots], scripts: next.scripts.map((s) => ({ ...s })) }
}
