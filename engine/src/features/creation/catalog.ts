// L6 功能 creation 的目錄、建議組合與外觀（M4 收尾修正批；使用者 2026-11-26 裁決 11；CHARACTER 5.4、5.7 節；NPC_SYSTEM 13.11 節的模板）。
//
// creation 不 import 別的功能：義體、裝備各自回答屬於自己的那一部分，經兩個掛點（和 creation.step 同一個做法）：
//   creation.catalog  第 6、9 步「買得到什麼」：每一件的名字、等級、價錢、點數、這個出身買得到嗎（block 寫原因）。cyberware 回答橋、其他義體與甲板，gear 回答物品與武器、護甲的設計圖。
//   creation.look     外觀裡推出來的三樣：外露的義體（cyberware：設計圖的 look.at）、獸化（設計圖的 look.beast）、風格與穿著（gear：出身白給的加上選的衣服、護甲、飾品）。
// creationCatalog：合起來、依等級與價錢排好、裝備照類別分四組。suggestedKit：出身的建議組合（origin.suggested），超過點數的照順序裁掉。creationLook：三樣的句子。
// 畫面不再自己留一份「買得到什麼的清單」、「建議組合」與外觀的推導規則。

import type { CreationRuleEntry, GameState, Kernel, OriginEntry } from '../../core'
import { isRecord } from '../../core'
import { cyberStepBlock, gearStepBlock } from './body'
import { creationLimits } from './model'
import type { CreationDraft, CreationLimits } from './model'

// ---- 目錄 ----

/** 目錄的一列。 */
export interface CatalogRow {
  id: string
  name: string
  desc: string
  grade: number
  brand: string
  price: number
  /** 在建角時花幾點（義體點數或裝備點數） */
  points: number
  /** 物品的類別，或 weapon、armor（設計圖）、cyberware、deck */
  category: string
  /** 部位（義體）、穿戴或攜帶的位置（武器、護甲） */
  slots?: string[]
  /** 現在選不得的原因（出身或勢力不對）；選得到是 null */
  block: string | null
}

export interface CatalogPayload {
  state: GameState
  draft: CreationDraft
  limits: CreationLimits
}

/** 一個功能對目錄的回答：橋、其他義體、裝備（含甲板）。 */
export interface CatalogAnswer {
  bridges?: CatalogRow[]
  cyber?: CatalogRow[]
  gear?: CatalogRow[]
}

/** 裝備目錄的四組（畫面照這個順序列）。 */
export const GEAR_GROUPS: ReadonlyArray<{ group: string; categories: readonly string[] }> = [
  { group: '武器', categories: ['weapon'] },
  { group: '護甲與服裝', categories: ['armor', 'clothing', 'accessory'] },
  { group: '工具與消耗品', categories: ['tool', 'consumable', 'ammo', 'misc'] },
  { group: '甲板、構裝與 SKIN', categories: ['deck', 'construct', 'skin'] },
]

export interface CreationCatalog {
  /** 第 6 步的橋 */
  bridges: CatalogRow[]
  /** 第 6 步的其他義體 */
  cyber: CatalogRow[]
  /** 第 9 步的裝備，照四組 */
  gear: Array<{ group: string; rows: CatalogRow[] }>
}

const byRow = (a: CatalogRow, b: CatalogRow): number => a.grade - b.grade || a.price - b.price || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** 建角買得到什麼：問各功能、合起來。沒有人回答的那一類是空的。 */
export function creationCatalog(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): CreationCatalog {
  const bridges: CatalogRow[] = []
  const cyber: CatalogRow[] = []
  const gear: CatalogRow[] = []
  for (const { result } of k.hooks.run('creation.catalog', { state, draft, limits: creationLimits(k, state) })) {
    const a = result as CatalogAnswer
    if (!isRecord(a)) continue
    if (Array.isArray(a.bridges)) bridges.push(...a.bridges)
    if (Array.isArray(a.cyber)) cyber.push(...a.cyber)
    if (Array.isArray(a.gear)) gear.push(...a.gear)
  }
  const groups = GEAR_GROUPS.map((g) => ({ group: g.group, rows: gear.filter((r) => g.categories.includes(r.category)).sort(byRow) }))
  const other = gear.filter((r) => !GEAR_GROUPS.some((g) => g.categories.includes(r.category))).sort(byRow)
  if (other.length > 0) groups.push({ group: '其他', rows: other })
  return { bridges: bridges.sort(byRow), cyber: cyber.sort(byRow), gear: groups.filter((g) => g.rows.length > 0) }
}

// ---- 建議組合 ----

export interface SuggestedKit {
  /** 出身有沒有寫建議組合 */
  has: boolean
  /** 建議的橋：設計圖 id；null 是不要橋；沒寫是 undefined（不動草稿的橋） */
  bridge: string | null | undefined
  cyber: Array<{ blueprint: string; side?: 'l' | 'r' }>
  gear: Array<{ id: string; qty?: number }>
  /** 超過點數或選不得（出身不對、查不到）而裁掉的 id，照裁掉的順序 */
  trimmed: string[]
}

/**
 * 出身的建議組合（origin.suggested）：把草稿換成建議的橋、義體、裝備，超過點數或擋住的照順序從後面裁掉（先裁裝備、再裁義體），
 * 直到第 6、9 步都不擋。出身沒寫建議（或查不到出身）has 是 false。不改傳進來的草稿。
 */
export function suggestedKit(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): SuggestedKit {
  const origin = k.content.get<OriginEntry>('origin', draft.origin)
  const sg = origin?.suggested
  if (!origin || !sg) return { has: false, bridge: undefined, cyber: [], gear: [], trimmed: [] }
  const cyber = (sg.cyber ?? []).map((c) => ({ ...c }))
  const gear = (sg.gear ?? []).map((g) => ({ ...g }))
  const trimmed: string[] = []
  const test = (): boolean => {
    const d: CreationDraft = { ...draft, ...(sg.bridge !== undefined ? { bridge: sg.bridge } : {}), cyber, gear }
    return !cyberStepBlock(k, state, d) && !gearStepBlock(k, state, d)
  }
  while (!test() && (gear.length > 0 || cyber.length > 0)) {
    if (gear.length > 0) trimmed.push(gear.pop()!.id)
    else trimmed.push(cyber.pop()!.blueprint)
  }
  return { has: true, bridge: sg.bridge, cyber, gear, trimmed }
}

// ---- 外觀 ----

export interface LookPayload {
  state: GameState
  draft: CreationDraft
  /** 句子裡的「他」：代名詞（自訂的人稱用「你」） */
  he: string
  /** 內建的預設加上資料蓋掉的：牌子的外殼描寫與獸化的系 */
  texts: LookTexts
}

export interface LookTexts {
  brand_lines: Record<string, string>
  beast_lines: Record<string, { mood: string; move: string }>
}

export interface LookAnswer {
  /** 外露的義體 */
  cyber?: string[]
  /** 獸化 */
  beast?: string[]
  /** 穿著的風格：每個標籤的風格值，與一句穿著的描寫 */
  style?: { tags: Array<[string, number]>; line?: string }
}

/** 牌子的外殼描寫（建角外觀；NPC_SYSTEM 13.11 節）。 */
export const DEFAULT_BRAND_LINES: Record<string, string> = {
  織女: '白色的樹脂外殼，接縫裡透著一條細細的藍光',
  緋櫻: '櫻粉色的烤漆，關節旁邊印著一朵小小的櫻紋，表面亮得照得出人影',
  星旗: '橄欖綠的外殼，序號與財產編號都打在看得見的地方，漆掉了一半',
  蜜腺: '看起來是皮膚，摸起來比別處的皮膚涼一點，接縫是一圈淡粉色的疤',
  伊甸園: '仿真的皮膚做得比原生的還細，關節的地方蝕刻著一圈蕾絲的花紋',
  鉻娘子改: '鉻與液壓管全露在外面，焊痕沒有磨平，散熱孔一直在吐熱氣',
  同人: '外殼貼滿了貼紙，螺絲有三種顏色，看得出是好幾台東西拼起來的',
  二手: '上一任主人刻的字還在，有一塊外殼的顏色和其他地方不一樣',
}
/** 獸化的系的情緒與耳朵的動作（CULTURE 第 2 節）。 */
export const DEFAULT_BEAST_LINES: Record<string, { mood: string; move: string }> = {
  貓: { mood: '不高興', move: '往後貼平' }, 狐: { mood: '在想事情', move: '慢慢轉向一邊' }, 兔: { mood: '緊張', move: '豎得筆直' }, 犬: { mood: '高興', move: '往兩邊垮下來' },
}
/** 沒寫獸化的系時用貓。 */
export const DEFAULT_BEAST_LINE = '貓'

/** 現在生效的外觀文字：預設加上 creation_rule 的 look 蓋掉的。 */
export function lookTexts(k: Pick<Kernel, 'content'>): LookTexts {
  const r = k.content.get<CreationRuleEntry>('creation_rule', 'default')?.look
  return { brand_lines: { ...DEFAULT_BRAND_LINES, ...(r?.brand_lines ?? {}) }, beast_lines: { ...DEFAULT_BEAST_LINES, ...(r?.beast_lines ?? {}) } }
}

export interface DerivedLook {
  /** 外露的義體 */
  cyber: string[]
  /** 獸化 */
  beast: string[]
  style: { tags: Array<[string, number]>; main: string | null; line: string }
}

/** 外觀裡推出來的三樣：問各功能、合起來。沒有人回答的是空的。 */
export function creationLook(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft): DerivedLook {
  const he = draft.pronoun === undefined || draft.pronoun === '' || draft.pronoun === '自訂' ? '你' : draft.pronoun
  const cyber: string[] = []
  const beast: string[] = []
  const tags = new Map<string, number>()
  const lines: string[] = []
  for (const { result } of k.hooks.run('creation.look', { state, draft, he, texts: lookTexts(k) })) {
    const a = result as LookAnswer
    if (!isRecord(a)) continue
    if (Array.isArray(a.cyber)) cyber.push(...a.cyber.filter((x): x is string => typeof x === 'string'))
    if (Array.isArray(a.beast)) beast.push(...a.beast.filter((x): x is string => typeof x === 'string'))
    if (isRecord(a.style)) {
      for (const [t, n] of Array.isArray(a.style.tags) ? a.style.tags : []) if (typeof t === 'string' && typeof n === 'number') tags.set(t, (tags.get(t) ?? 0) + n)
      if (typeof a.style.line === 'string' && a.style.line) lines.push(a.style.line)
    }
  }
  const sorted = [...tags.entries()].sort((x, y) => y[1] - x[1])
  return { cyber, beast, style: { tags: sorted, main: sorted[0]?.[0] ?? null, line: lines.join('') } }
}

declare module '../../core' {
  interface HookMap {
    /** 建角第 6、9 步買得到什麼（M4 收尾修正批）：每個功能回答屬於自己的那一部分，creationCatalog 合起來。 */
    'creation.catalog': [CatalogPayload, CatalogAnswer | void]
    /** 建角外觀裡推出來的三樣（外露的義體、獸化、穿著的風格；M4 收尾修正批）：每個功能回答屬於自己的那一段，creationLook 合起來。 */
    'creation.look': [LookPayload, LookAnswer | void]
  }
}

