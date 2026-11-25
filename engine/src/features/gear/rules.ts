// L6 裝備：規則表 gear_rule（overridable，id: default）。重量與負重、風格一致的加成、曝露度的兩個定值、染色的價錢與時間。
// 數字照 dev/work/M4-gear-m4.md：沒寫的欄位用 DEFAULT_GEAR_RULES（暫定值，平衡的 session 之後看）；格式不對的欄位忽略。

import type { ContentEntry, Kernel } from '../../core'
import { clone, isSafeInt } from '../../core'

export const RULE_KIND = 'gear_rule'

export interface GearRules {
  /** 負重的基礎（暫定 6） */
  carry_base: number
  /** 負重每一點體格加多少（暫定 1：負重上限 ＝ carry_base ＋ 體格 × carry_per_body） */
  carry_per_body: number
  /** 超重時的迴避加減（EQUIPMENT 第 7 節：−2） */
  over_evade: number
  /** 超重時帶 stealth 標籤的檢定加減（EQUIPMENT 第 7 節：迴避與隱匿下降，−2） */
  over_stealth: number
  /** 超重時換位多花幾點行動點（+1） */
  over_move_ap: number
  /** 風格一致要看得到幾件有風格的（EQUIPMENT 第 5 節：四件以上） */
  unified_min: number
  /** 風格一致時風格值多幾點（暫定 2） */
  unified_bonus: number
  /** 只看得到內衣時曝露度至少多少（ElondiaRPG lewd.json 的 underwear_visible） */
  underwear_visible: number
  /** 什麼都沒穿的曝露度（ElondiaRPG 的 naked） */
  naked: number
  /** 店家代染：每改一個顏色多少現金（EQUIPMENT 第 9 節） */
  dye_shop_price: number
  /** 店家代染要等幾分鐘 */
  dye_shop_minutes: number
  /** 自己染要幾分鐘 */
  dye_self_minutes: number
}

export const DEFAULT_GEAR_RULES: GearRules = {
  carry_base: 6, carry_per_body: 1, over_evade: -2, over_stealth: -2, over_move_ap: 1,
  unified_min: 4, unified_bonus: 2, underwear_visible: 2, naked: 3,
  dye_shop_price: 20, dye_shop_minutes: 10, dye_self_minutes: 10,
}

/** 每個欄位合格的條件：[最小, 最大, 要不要整數]。 */
const SPECS: Record<keyof GearRules, readonly [number, number, boolean]> = {
  carry_base: [0, 1000, false], carry_per_body: [0, 100, false],
  over_evade: [-20, 0, true], over_stealth: [-20, 0, true], over_move_ap: [0, 10, true],
  unified_min: [1, 10, true], unified_bonus: [0, 20, true], underwear_visible: [0, 3, true], naked: [0, 3, true],
  dye_shop_price: [0, 100000, true], dye_shop_minutes: [0, 1440, true], dye_self_minutes: [0, 1440, true],
}
const KEYS = Object.keys(SPECS) as Array<keyof GearRules>

const fits = (key: keyof GearRules, v: unknown): v is number => {
  const [lo, hi, int] = SPECS[key]
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || isSafeInt(v))
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of KEYS) {
    if (e[key] === undefined || fits(key, e[key])) continue
    const [lo, hi, int] = SPECS[key]
    p.push(`${key} 要是 ${lo}～${hi} 的${int ? '整數' : '數字'}`)
  }
  return p
}

/** 現在生效的規則：資料 gear_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function gearRules(k: Pick<Kernel, 'content'>): GearRules {
  const out = clone(DEFAULT_GEAR_RULES)
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  for (const key of KEYS) if (fits(key, e[key])) out[key] = e[key]
  return out
}
