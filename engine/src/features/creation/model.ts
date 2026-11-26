// L6 功能 creation 的型別與數字：建角的草稿、每一步、規則（資料 creation_rule/default 蓋掉內建的預設）、給畫面的數字。
// 規格：CHARACTER 第 1、2.1、5.1、5.3、5.4、5.6 節；dev/adr/0019 第十一節與 P52～P55；dev/work/M4-creation-body.md。

import type { AttrId, CreationRuleEntry, GameState, Kernel, SkillId } from '../../core'

/** 建角的步驟（CHARACTER 第 1 節）：basics 第 1 步、origin 第 2 步、attrs 第 3 步、skills 第 4 步、lifepath 第 5 步、cyber 第 6 步、perks 第 7 步、abilities 第 8 步、gear 第 9 步。 */
export type CreationStep = 'basics' | 'origin' | 'attrs' | 'skills' | 'lifepath' | 'cyber' | 'perks' | 'abilities' | 'gear'

/** 生命軌跡的八張表（CHARACTER 第 3 節）：家人、那件事、朋友、仇人、舊情、想要的、性經歷、潛在性癖。 */
export const LIFEPATH_TABLES = ['family', 'incident', 'friend', 'enemy', 'ex', 'want', 'sex', 'kink'] as const
export type LifepathTable = (typeof LIFEPATH_TABLES)[number]
export interface CreationBlock { step: CreationStep; reason: string }

/** 私處的外觀（DATA 第 8 節的 look.private）：選的詞條加上自由輸入的一段。成人內容，受內容篩選「身體的私密描寫」控制。 */
export interface LookPrivate {
  options: string[]
  text: string
}

/** 外觀：鍵是部位，值是下拉選的詞條；private 是私處的外觀。 */
export interface CreationLook {
  private?: LookPrivate
  [part: string]: string | LookPrivate | undefined
}

export interface CreationDraft {
  name: string
  /** female、male、femboy、trans_f、futa（DATA 第 1 節的五個值；TS 只有男跨女一種，id 是 trans_f） */
  gender: string
  pronoun?: string
  age: number | string
  /** 外觀的下拉選的結果，原樣存。look.private（私處）在內容篩選關掉「身體的私密描寫」時不寫進角色 */
  look?: CreationLook
  /** 手動補充的外觀 */
  lookNote?: string
  background?: string
  /** 出身的 id */
  origin: string
  /** 好感給哪個勢力：勢力的 id（出身的 favor.choose_one 有兩個以上時要選） */
  originChoice?: { favor?: string }
  /** 第 6 步花掉的義體點數（舊的給法）。沒花完的每點換現金（CHARACTER 5.4 節）；沒給就不換（當成花完）。草稿有給選的東西（bridge、cyber）時以選的東西算出來的點數為準 */
  cyberSpent?: number
  /** 第 9 步花掉的裝備點數（舊的給法）。沒花完的每點換現金；沒給就不換。草稿有給選的東西（gear）時以選的東西算出來的點數為準 */
  gearSpent?: number
  /** 第 6 步選的橋：設計圖的 id；null 是明寫「沒有橋」；沒寫是還沒選（M4-creation-body；P53） */
  bridge?: string | null
  /** 第 6 步選的其他義體：設計圖的 id，部位是 arm、leg 的要給左右 */
  cyber?: Array<{ blueprint: string; side?: 'l' | 'r' }>
  /** 第 8 步學的技能，照學的順序（歷練點是存檔規則的 startXp；學完照順序裝進橋，容量滿為止，P54） */
  abilities?: string[]
  /** 第 9 步挑的裝備：物品、設計圖、甲板、構裝、SKIN 的 id 與數量（沒寫是 1） */
  gear?: Array<{ id: string; qty?: number }>
  /** 六個數字各分給哪一項 */
  attrPick: Partial<Record<AttrId, number>>
  /** 每一項的增減：正的花自由點數，負的是往下壓 */
  attrBonus: Partial<Record<AttrId, number>>
  /** 買的基本功等級（不含出身送的 +1） */
  skills: Record<SkillId, number>
  /** 買的特質與缺陷（不含出身特質） */
  perks: string[]
  /** 第 5 步：每張表選的條目（lifepath_entry 的 id）；'skip' 或沒寫是跳過（M4-creation-lifepath） */
  lifepath?: Partial<Record<LifepathTable, string>>
  /** 獸化的系（貓、狐、兔、犬……；建角外觀的句子用，沒寫是貓；M4 收尾修正批） */
  beastLine?: string
  /** 第 5 步：自己挑的潛在性癖，最多 2 個；latent 為真的標成「潛在」（建角時只記下來，第一次碰到時才揭開），否則直接是「有」 */
  kinks?: Array<{ tag: string; latent?: boolean }>
}

/** 可以用裝備點數買的類別（物品的 category，加上設計圖的 weapon、armor 與 construct、skin、deck 三種）。 */
export const DEFAULT_GEAR_KINDS = ['weapon', 'armor', 'clothing', 'tool', 'consumable', 'ammo', 'construct', 'skin', 'deck'] as const

/** creation_rule/default 沒有載入（或沒寫那一欄）時的預設值（CHARACTER 2.1、5.1、5.3、5.4 節）。 */
export const DEFAULT_RULE = {
  attr_array: [15, 14, 13, 12, 10, 8], attr_free: 2, attr_max: 18, attr_min: 4, perk_max: 8, flaw_max: 2, gear_points: 12,
  cyber_point_cash: 500, gear_point_cash: 250,
  /** 一件義體沒寫 creation_points 時：（成品價 × cyber_install_mult）÷ cyber_point_price 進位，最少 1 點 */
  cyber_point_price: 500, cyber_install_mult: 1.5,
  /** 一件裝備：目錄價 ÷ gear_point_price 進位，最少 1 點；只收到 gear_grade_max 級；類別要在 gear_kinds 裡 */
  gear_point_price: 250, gear_grade_max: 2, gear_kinds: [...DEFAULT_GEAR_KINDS] as string[],
}

export function rule(k: Pick<Kernel, 'content'>) {
  const r = k.content.get<CreationRuleEntry>('creation_rule', 'default')
  return {
    attr_array: r?.attr_array ?? DEFAULT_RULE.attr_array,
    attr_free: r?.attr_free ?? DEFAULT_RULE.attr_free,
    attr_max: r?.attr_max ?? DEFAULT_RULE.attr_max,
    attr_min: r?.attr_min ?? DEFAULT_RULE.attr_min,
    perk_max: r?.perk_max ?? DEFAULT_RULE.perk_max,
    flaw_max: r?.flaw_max ?? DEFAULT_RULE.flaw_max,
    gear_points: r?.gear_points ?? DEFAULT_RULE.gear_points,
    cyber_point_cash: r?.cyber_point_cash ?? DEFAULT_RULE.cyber_point_cash,
    gear_point_cash: r?.gear_point_cash ?? DEFAULT_RULE.gear_point_cash,
    cyber_point_price: r?.cyber_point_price ?? DEFAULT_RULE.cyber_point_price,
    cyber_install_mult: r?.cyber_install_mult ?? DEFAULT_RULE.cyber_install_mult,
    gear_point_price: r?.gear_point_price ?? DEFAULT_RULE.gear_point_price,
    gear_grade_max: r?.gear_grade_max ?? DEFAULT_RULE.gear_grade_max,
    gear_kinds: r?.gear_kinds ? [...r.gear_kinds] : [...DEFAULT_RULE.gear_kinds],
  }
}

/** 建角的數字（給畫面顯示與下拉選單用）。來源是資料（creation_rule/default）與這一局的存檔規則；畫面不自己留一份預設值。 */
export interface CreationLimits {
  attrArray: number[]
  attrFree: number
  attrMax: number
  attrMin: number
  skillPoints: number
  skillMax: number
  perkPoints: number
  perkMax: number
  flawMax: number
  /** 起始的錢（全部是現金，每個出身一樣） */
  startMoney: number
  cyberPoints: number
  gearPoints: number
  /** 沒花完的義體點數、裝備點數每點換多少現金 */
  cyberPointCash: number
  gearPointCash: number
  /** 一件義體沒寫 creation_points 時：（成品價 × cyberInstallMult）÷ cyberPointPrice 進位，最少 1 點 */
  cyberPointPrice: number
  cyberInstallMult: number
  /** 一件裝備：目錄價 ÷ gearPointPrice 進位，最少 1 點 */
  gearPointPrice: number
  /** 起始的裝備最高幾級 */
  gearGradeMax: number
  /** 可以用裝備點數買的類別 */
  gearKinds: string[]
}

export function creationLimits(k: Pick<Kernel, 'content'>, state: GameState): CreationLimits {
  const r = rule(k)
  return {
    attrArray: [...r.attr_array], attrFree: r.attr_free, attrMax: r.attr_max, attrMin: r.attr_min,
    skillPoints: state.rules.startSkillPoints, skillMax: state.rules.startSkillMax,
    perkPoints: state.rules.startPerkPoints, perkMax: r.perk_max, flawMax: r.flaw_max,
    startMoney: state.rules.startMoney, cyberPoints: state.rules.startCyberPoints, gearPoints: r.gear_points,
    cyberPointCash: r.cyber_point_cash, gearPointCash: r.gear_point_cash,
    cyberPointPrice: r.cyber_point_price, cyberInstallMult: r.cyber_install_mult,
    gearPointPrice: r.gear_point_price, gearGradeMax: r.gear_grade_max, gearKinds: [...r.gear_kinds],
  }
}
