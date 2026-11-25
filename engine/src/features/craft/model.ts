// L6 功能 craft 的資料與純函式：規則表、內容的格式、狀態的形狀、誰做、做的地方。不碰登錄表（登記在 index.ts）。
// 規格：CRAFTING 第 3.4、4、6 節與 10.1 節；TRADE 3.4 節（組裝工錢、同人社團代工）；dev/adr/0019 第四節與 P16；dev/work/M4-craft.md。
//
// 內容種類：
//   craft_rule（規則表，overridable；id: default）：難度的數字、做一件的時間、四種人的工錢與脾氣、自己組裝要的住處等級（DEFAULT_CRAFT_RULES）
//   設施種類（world 的 facility_type）多讀 craft?: { by: 'shop' | 'doujin' | 'factory', brand? }：這裡有誰可以做；原廠（factory）只做自己牌子的全套
//   物品（類別 blueprint 的一件是授權書）多讀 teaches?: 設計圖的 id：用掉就學會
// 狀態 state.ext.craft = { known: string[] }：會做的設計圖的 id（設計圖不是實物，CRAFTING 第 3、11 節）。只經由報告裡的 ext 變更寫。

import type { ActorId, AttrId, BlueprintEntry, Change, ContentEntry, GameState, ItemEntry, Kernel } from '../../core'
import { ATTR_IDS, clone, isRecord, isSafeInt } from '../../core'

export const OWNER = 'craft'
export const EXT = 'craft'
export const RULE_KIND = 'craft_rule'
export const FACILITY_TYPE_KIND = 'facility_type'
export const ASSEMBLE_ACTION = 'craft.assemble'
export const LEARN_ACTION = 'craft.learn'
export const SALVAGE_ACTION = 'craft.salvage'
export const SWAP_ACTION = 'craft.swap'
/** 效果：學會一張設計圖（內建的來源才收，ai: false）。 */
export const BLUEPRINT_EFFECT = 'blueprint'

/** 誰來做：自己（主角或隊上的人）、店家（診所、槍店、裁縫）、同人社團、原廠。 */
export const MAKER_KINDS = ['self', 'shop', 'doujin', 'factory'] as const
export type MakerKind = (typeof MAKER_KINDS)[number]
export const MAKER_NAME: Record<MakerKind, string> = { self: '自己動手', shop: '店家代工', doujin: '同人社團代工', factory: '原廠' }
/** 設施種類的 craft.by 收哪幾種（自己不是設施）。 */
export const FACILITY_MAKERS = ['shop', 'doujin', 'factory'] as const
export type FacilityMaker = (typeof FACILITY_MAKERS)[number]
export const isMakerKind = (v: unknown): v is MakerKind => typeof v === 'string' && (MAKER_KINDS as readonly string[]).includes(v)

export type Pool = 'cred' | 'cash'

// ---- 規則（CRAFTING 10.1 節；TRADE 3.4 節；dev/adr/0019 P16） ----

export interface MakerRule {
  /** 工錢：設計圖等級 × 這個數字（自己動手是 0） */
  fee_per_grade: number
  /** true 是要擲技術檢定（自己動手）；false 是一定成功 */
  check: boolean
  /** 肯不肯做超規（高設計圖一級的零件） */
  overspec: boolean
  /** 會不會登記（店家的成品在登記上） */
  registers: boolean
  /** 只收原廠全套（設計圖與每個零件同一個牌子；設施寫了 brand 的話還要是那個牌子） */
  full_set_only: boolean
  /** 一定是精工 */
  fine: boolean
  /** 成品多一筆怪癖（pool 含 doujin 的 quirk，state 變 doujin）的機率 */
  quirk_chance: number
  /** 要不要自己會這張設計圖（店家與原廠有圖，不必；自己動手與同人照著組要自己有圖） */
  needs_known: boolean
}

export interface CraftRules {
  /** 難度：設計圖等級 I～V 的標準 DC */
  dc: number[]
  /** 牌子數每多一個 +這麼多（牌子數 − 1） */
  brand_step: number
  /** 機械接生體的接面每個 +這麼多 */
  seam_step: number
  /** 超規每件 +這麼多（只能超高一級） */
  overspec_step: number
  /** 組的是橋再 +這麼多 */
  bridge_step: number
  /** 做一件花的分鐘（一個時段） */
  minutes: number
  /** 自己組裝要在住處的話，住處的等級至少多少（條件 at_home 的 level_min；有工作台的據點是二級以上） */
  self_home_level: number
  /** 條件 ability（daily: 'workshop'）成立時檢定 +這麼多，超規的修正減半（無條件進位） */
  workshop_bonus: number
  /** 自己組裝的檢定用哪一項屬性與基本功：義體用義體學、武器與護甲用機械、全生體用醫療（CRAFTING 10.1 節） */
  attr: AttrId
  skills: { cyberware: string; mech: string; bio: string }
  makers: Record<MakerKind, MakerRule>
  /** 拆解：一個零件完好拆下來的機率 ＝ salvage_base ＋ 做的人那一項基本功 × salvage_per_skill，最多 salvage_max（CRAFTING 10.4 節；M4-craft-salvage） */
  salvage_base: number
  salvage_per_skill: number
  salvage_max: number
  /** 拆一件花的分鐘 */
  salvage_minutes: number
  /** 換一個零件花的分鐘（暫定：工單沒寫，照拆解的一個時段） */
  swap_minutes: number
  /** 店家換零件的工錢 ＝ 設計圖等級 × 店家的 fee_per_grade × 這個比例（暫定一半） */
  swap_shop_ratio: number
}

export const DEFAULT_CRAFT_RULES: CraftRules = {
  dc: [10, 13, 16, 19, 22],
  brand_step: 1, seam_step: 1, overspec_step: 3, bridge_step: 3,
  minutes: 240,
  self_home_level: 2,
  workshop_bonus: 2,
  attr: 'tech',
  skills: { cyberware: 'cyberware', mech: 'mechanics', bio: 'medicine' },
  makers: {
    self: { fee_per_grade: 0, check: true, overspec: true, registers: false, full_set_only: false, fine: false, quirk_chance: 0, needs_known: true },
    shop: { fee_per_grade: 100, check: false, overspec: false, registers: true, full_set_only: false, fine: false, quirk_chance: 0, needs_known: false },
    doujin: { fee_per_grade: 60, check: false, overspec: true, registers: false, full_set_only: false, fine: false, quirk_chance: 0.25, needs_known: true },
    // 原廠的工錢暫定（CRAFTING 沒寫數字；M4-craft 回報）
    factory: { fee_per_grade: 150, check: false, overspec: false, registers: true, full_set_only: true, fine: true, quirk_chance: 0, needs_known: false },
  },
  salvage_base: 0.7, salvage_per_skill: 0.05, salvage_max: 0.95, salvage_minutes: 60,
  swap_minutes: 60, swap_shop_ratio: 0.5,
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isNonNeg = (v: unknown, max = 1_000_000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max
const isRatio = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const BOOL_KEYS = ['check', 'overspec', 'registers', 'full_set_only', 'fine', 'needs_known'] as const

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.dc !== undefined && !(Array.isArray(e.dc) && e.dc.length === 5 && e.dc.every((n) => isSafeInt(n) && n >= 1 && n <= 40))) p.push('dc 要是五個整數（設計圖等級 I～V 的標準 DC）')
  for (const f of ['brand_step', 'seam_step', 'overspec_step', 'bridge_step', 'workshop_bonus'] as const) {
    if (e[f] !== undefined && !(isSafeInt(e[f]) && (e[f] as number) >= 0 && (e[f] as number) <= 20)) p.push(`${f} 要是 0～20 的整數`)
  }
  for (const f of ['salvage_base', 'salvage_per_skill', 'salvage_max'] as const) if (e[f] !== undefined && !isRatio(e[f])) p.push(`${f} 要是 0～1 的數字`)
  if (e.swap_shop_ratio !== undefined && !(typeof e.swap_shop_ratio === 'number' && Number.isFinite(e.swap_shop_ratio) && e.swap_shop_ratio >= 0 && e.swap_shop_ratio <= 10)) p.push('swap_shop_ratio 要是 0～10 的數字')
  for (const f of ['salvage_minutes', 'swap_minutes'] as const) if (e[f] !== undefined && !(isSafeInt(e[f]) && (e[f] as number) >= 0 && (e[f] as number) <= 10_080)) p.push(`${f} 要是 0～10080 的整數（分鐘）`)
  if (e.minutes !== undefined && !(isSafeInt(e.minutes) && e.minutes >= 0 && e.minutes <= 10_080)) p.push('minutes 要是 0～10080 的整數（分鐘）')
  if (e.self_home_level !== undefined && !(isSafeInt(e.self_home_level) && e.self_home_level >= 0 && e.self_home_level <= 3)) p.push('self_home_level 要是 0～3 的整數')
  if (e.attr !== undefined && !(ATTR_IDS as readonly unknown[]).includes(e.attr)) p.push(`attr 要是屬性的 id（${ATTR_IDS.join('、')}）`)
  if (e.skills !== undefined) {
    if (!isRecord(e.skills)) p.push('skills 要是 { cyberware, mech, bio }：每一項是基本功的 id')
    else for (const [key, v] of Object.entries(e.skills)) {
      if (!['cyberware', 'mech', 'bio'].includes(key)) p.push(`skills.${key}：只有 cyberware、mech、bio`)
      else if (!isText(v)) p.push(`skills.${key} 要是基本功的 id`)
    }
  }
  if (e.makers !== undefined) {
    if (!isRecord(e.makers)) p.push('makers 要是 { self、shop、doujin、factory: { fee_per_grade, … } }')
    else {
      for (const [kind, v] of Object.entries(e.makers)) {
        if (!isMakerKind(kind)) p.push(`makers.${kind}：只有 ${MAKER_KINDS.join('、')}`)
        else if (!isRecord(v)) p.push(`makers.${kind} 要是一個物件`)
        else {
          if (v.fee_per_grade !== undefined && !isNonNeg(v.fee_per_grade)) p.push(`makers.${kind}.fee_per_grade 要是 0 以上的數字（設計圖等級 × 這個數字）`)
          if (v.quirk_chance !== undefined && !isRatio(v.quirk_chance)) p.push(`makers.${kind}.quirk_chance 要是 0～1 的數字`)
          for (const f of BOOL_KEYS) if (v[f] !== undefined && typeof v[f] !== 'boolean') p.push(`makers.${kind}.${f} 要是 true 或 false`)
        }
      }
    }
  }
  return p
}

/** 現在生效的規則：資料 craft_rule/default 蓋掉內建的預設（格式不對的欄位忽略；makers 逐項逐欄蓋）。 */
export function craftRules(k: Pick<Kernel, 'content'>): CraftRules {
  const out = clone(DEFAULT_CRAFT_RULES)
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('dc')) out.dc = [...(e.dc as number[])]
  for (const f of ['brand_step', 'seam_step', 'overspec_step', 'bridge_step', 'minutes', 'self_home_level', 'workshop_bonus'] as const) if (ok(f)) out[f] = e[f] as number
  for (const f of ['salvage_base', 'salvage_per_skill', 'salvage_max', 'salvage_minutes', 'swap_minutes', 'swap_shop_ratio'] as const) if (ok(f)) out[f] = e[f] as number
  if (ok('attr')) out.attr = e.attr as AttrId
  if (ok('skills')) for (const [key, v] of Object.entries(e.skills as Record<string, unknown>)) if (key in out.skills && isText(v)) out.skills[key as keyof CraftRules['skills']] = v
  // makers 有一項格式不對就整個 makers 不收（bad 只看第一個字）：逐欄檢查，好的欄位照收
  if (isRecord(e.makers)) {
    for (const [kind, v] of Object.entries(e.makers)) {
      if (!isMakerKind(kind) || !isRecord(v)) continue
      const m = out.makers[kind]
      if (isNonNeg(v.fee_per_grade)) m.fee_per_grade = v.fee_per_grade
      if (isRatio(v.quirk_chance)) m.quirk_chance = v.quirk_chance
      for (const f of BOOL_KEYS) if (typeof v[f] === 'boolean') m[f] = v[f]
    }
  }
  return out
}

// ---- 會做的設計圖 ----

export interface CraftState {
  known: string[]
}

/** 讀 state.ext.craft：known 不是字串的陣列、有重複的都整理掉，不丟錯。 */
export function craftOf(state: Pick<GameState, 'ext'>): CraftState {
  const raw = state.ext[EXT]
  const known: string[] = []
  if (isRecord(raw) && Array.isArray(raw.known)) for (const id of raw.known) if (isText(id) && !known.includes(id)) known.push(id)
  return { known }
}

/** 這張設計圖主角（隊伍）會不會做。 */
export const isKnown = (state: Pick<GameState, 'ext'>, id: string): boolean => craftOf(state).known.includes(id)

/** 寫回會做的設計圖的那一筆變更（保留 ext.craft 裡別人的鍵）。 */
export function knownChange(state: Pick<GameState, 'ext'>, known: string[]): Change {
  const raw = state.ext[EXT]
  return { op: 'ext', key: EXT, value: { ...(isRecord(raw) ? clone(raw) : {}), known: [...new Set(known)] } }
}

/** 會做的設計圖（內容查得到的，照學會的順序）。 */
export function knownBlueprints(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'ext'>): BlueprintEntry[] {
  return craftOf(state).known.flatMap((id) => {
    const bp = k.content.get<BlueprintEntry>('blueprint', id)
    return bp ? [bp] : []
  })
}

// ---- 授權書 ----

/** 物品（類別 blueprint）多讀的 teaches。 */
export interface LicenceItem extends ItemEntry {
  teaches?: string
}

// ---- 這裡有誰可以做 ----

export interface CraftFacility {
  by: FacilityMaker
  brand?: string
}
type FacilityTypeEntry = ContentEntry & { name?: unknown; craft?: unknown }

export function facilityCraftProblems(c: unknown): string[] {
  if (!isRecord(c)) return ['craft 要是 { by: shop | doujin | factory, brand? }']
  const p: string[] = []
  if (!(FACILITY_MAKERS as readonly unknown[]).includes(c.by)) p.push(`craft.by 只能是 ${FACILITY_MAKERS.join('、')}`)
  if (c.brand !== undefined && !isText(c.brand)) p.push('craft.brand 要是牌子的 id')
  if (c.by === 'factory' && c.brand === undefined) p.push('原廠（factory）要寫 brand：它只做自己牌子的全套')
  return p
}

/** 現在站的設施有沒有帶 craft（用條件 at_facility 問；沒有人登記就沒有）。 */
export function craftHere(k: Kernel, state: GameState): (CraftFacility & { type: string; name: string }) | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    if (!isRecord(t.craft) || facilityCraftProblems(t.craft).length > 0) continue
    if (k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) {
      return { type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, by: t.craft.by as FacilityMaker, ...(isText(t.craft.brand) ? { brand: t.craft.brand } : {}) }
    }
  }
  return null
}

/** 有工作台的地方：帶 craft 的設施，或住處（條件 at_home，等級至少 self_home_level）。 */
export function workbenchHere(k: Kernel, state: GameState, rules: CraftRules = craftRules(k)): boolean {
  if (craftHere(k, state)) return true
  return k.conditions.kinds().includes('at_home') && k.conditions.test({ kind: 'at_home', level_min: rules.self_home_level }, { state, stats: k.stats, timeRules: k.timeRules })
}

/** 自己組裝的地方：住處（條件 at_home，等級至少 self_home_level）或帶 craft 的設施。 */
export function selfPlaceBlock(k: Kernel, state: GameState, rules: CraftRules = craftRules(k)): string | null {
  return workbenchHere(k, state, rules) ? null : '自己組裝要在有工作台的住處（二級以上）或有工作台的店面。'
}

/** 組裝的人是主角或隊上的人嗎。 */
export const inParty = (state: GameState, who: ActorId): boolean => !!state.actors[who] && (who === state.pc || state.party.includes(who))

export const nameOf = (state: GameState, id: ActorId): string => state.actors[id]?.name ?? id
