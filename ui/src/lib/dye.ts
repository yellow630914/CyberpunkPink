/**
 * 染色（EQUIPMENT 第 9 節、DATA 7.7 節）：武器、衣服、護甲、飾品、SKIN 都可以染兩個顏色：主色調與副色調。
 * 純外觀，不改任何數值；顏色寫進外觀描述，AI 的正文會提到（NPC_SYSTEM 4.3 節）。
 * 值是色票 id（`dye_*`）或 #RRGGBB。沒有染過的用目錄上的預設顏色（照牌子的外觀）。
 */
export interface Dye { primary: string; secondary: string }
export interface Swatch { id: string; name: string; hex: string }

export const PALETTE: Swatch[] = [
  { id: 'dye_black', name: '黑', hex: '#1A1520' },
  { id: 'dye_gray', name: '鐵灰', hex: '#6E6878' },
  { id: 'dye_white', name: '白', hex: '#F3EEF5' },
  { id: 'dye_chrome', name: '鉻銀', hex: '#C8CDD6' },
  { id: 'dye_pink', name: '霓虹粉', hex: '#F06AA0' },
  { id: 'dye_sakura', name: '櫻粉', hex: '#F7B6C8' },
  { id: 'dye_red', name: '正紅', hex: '#D8344A' },
  { id: 'dye_orange', name: '橘', hex: '#F08A3C' },
  { id: 'dye_gold', name: '金', hex: '#F2C14E' },
  { id: 'dye_khaki', name: '卡其', hex: '#B59B6A' },
  { id: 'dye_olive', name: '橄欖綠', hex: '#6B7A3A' },
  { id: 'dye_mint', name: '薄荷', hex: '#45D6C5' },
  { id: 'dye_blue', name: '霓虹藍', hex: '#3B8FD9' },
  { id: 'dye_navy', name: '深藍', hex: '#24315E' },
  { id: 'dye_violet', name: '紫', hex: '#8A6FE0' },
  { id: 'dye_wine', name: '酒紅', hex: '#6E2140' },
]
const BY_ID = new Map(PALETTE.map(s => [s.id, s]))
const HEX = /^#[0-9a-fA-F]{6}$/

/** 這個值能不能當顏色：色票 id 或 #RRGGBB。 */
export function isColor(v: unknown): v is string { return typeof v === 'string' && (BY_ID.has(v) || HEX.test(v)) }
/** 顏色的 #RRGGBB（大寫）。不認得的值退回鐵灰。 */
export function hexOf(v: string): string { return (BY_ID.get(v)?.hex ?? (HEX.test(v) ? v : '#6E6878')).toUpperCase() }
/** 顏色的名字：色票用色票的名字；自訂的找最接近的色票，寫「偏某某的自訂色」。 */
export function colorName(v: string): string {
  const s = BY_ID.get(v)
  if (s) return s.name
  if (!HEX.test(v)) return '鐵灰'
  return `偏${nearest(v).name}的自訂色`
}
function rgb(h: string) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
export function nearest(hex: string): Swatch {
  const [r, g, b] = rgb(hex)
  let best = PALETTE[0], d = Infinity
  for (const s of PALETTE) { const [r2, g2, b2] = rgb(s.hex); const e = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; if (e < d) { d = e; best = s } }
  return best
}

/** 目錄上的預設顏色：物品自己寫的 colors，沒寫就照牌子的外觀（NPC_SYSTEM 13.11 節）。 */
const BRAND_DEFAULT: Record<string, Dye> = {
  織女: { primary: 'dye_white', secondary: 'dye_blue' },
  緋櫻: { primary: 'dye_sakura', secondary: 'dye_white' },
  星旗: { primary: 'dye_olive', secondary: 'dye_black' },
  蜜腺: { primary: 'dye_sakura', secondary: 'dye_wine' },
  伊甸園: { primary: 'dye_white', secondary: 'dye_gold' },
  鉻娘子改: { primary: 'dye_chrome', secondary: 'dye_red' },
  同人: { primary: 'dye_pink', secondary: 'dye_black' },
  萬華鏡: { primary: 'dye_violet', secondary: 'dye_chrome' },
  夜鶯: { primary: 'dye_navy', secondary: 'dye_mint' },
}
export function defaultDye(item: { brand?: string; colors?: [string, string] }): Dye {
  if (item.colors && isColor(item.colors[0]) && isColor(item.colors[1])) return { primary: item.colors[0], secondary: item.colors[1] }
  return BRAND_DEFAULT[item.brand ?? ''] ?? { primary: 'dye_gray', secondary: 'dye_black' }
}
/** 現在的顏色：染過的用染的，沒染過的用預設。 */
export function currentDye(item: { brand?: string; colors?: [string, string] }, dyed?: Dye | null): Dye { return dyed ?? defaultDye(item) }

/** 可以染的種類：武器、衣服、護甲、飾品、SKIN（義體與消耗品不行；義體的外觀在診所換烤漆，不在這裡）。 */
export const DYEABLE_KINDS = new Set(['weapon', 'clothing', 'armor', 'accessory', 'underwear', 'skin'])
export function dyeable(item: { kind: string; net?: { cls: string } }): boolean {
  return DYEABLE_KINDS.has(item.kind) || item.net?.cls === 'SKIN'
}

/**
 * 價錢（EQUIPMENT 第 9 節）：服飾店與修車廠代染每個顏色 C$20；在家用工作台自己染，每個顏色一份染料 C$5；
 * 內海的 SKIN 在自己的化身編輯裡染，不要錢。換回預設的顏色不要錢。
 */
export type DyeWhere = 'shop' | 'home' | 'net'
export const DYE_PRICE: Record<DyeWhere, number> = { shop: 20, home: 5, net: 0 }
export function dyeCost(before: Dye, after: Dye, def: Dye, where: DyeWhere): number {
  let n = 0
  if (after.primary !== before.primary && after.primary !== def.primary) n++
  if (after.secondary !== before.secondary && after.secondary !== def.secondary) n++
  return n * DYE_PRICE[where]
}

/** 寫進外觀描述的一句（PROMPTS 的 actor 摘要）：「霓虹粉的巷口機能夾克，黑色的滾邊」。 */
export function dyePhrase(name: string, d: Dye): string {
  const p = colorName(d.primary), s = colorName(d.secondary)
  return p === s ? `${p}的${name}` : `${p}的${name}，${s}的滾邊與配件`
}

/** 存檔裡的染色表：key 是「uid:背包那一疊的 uid」、「slot:穿著的格子」或「skin:內海的 SKIN」。讀進來時丟掉格式不對的。 */
export function sanitizeDyes(raw: unknown): Record<string, Dye> {
  const out: Record<string, Dye> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = v as Partial<Dye> | null
    if (/^(uid|slot|skin):/.test(k) && d && isColor(d.primary) && isColor(d.secondary)) out[k] = { primary: d.primary, secondary: d.secondary }
  }
  return out
}
