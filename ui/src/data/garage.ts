/**
 * 機甲與載具（ITEMS 第 14 節、CRAFTING 第 15 節）。載具在修車廠買；機甲在整備架或修車廠整備。
 * 價格照 14.3 節的公式：載具價 = 載具基準 × 牌子係數；二手 ×0.65。
 */
export interface VehicleDef {
  id: string; name: string; brand: string; kind: '機車' | '汽車' | '浮空車'; grade: 1 | 2 | 3; seats: string; cargo: number; cover: number; call: number
  leg: string; chase: string; trait: string; price: number; used?: number; upkeep: number; flying?: boolean
}
export const VEHICLES: VehicleDef[] = [
  { id: 'veh_street', name: '街車', brand: '無牌', kind: '機車', grade: 1, seats: '2', cargo: 2, cover: 30, call: 1, leg: '8 分鐘', chase: '+0', trait: '蜂巢與舊港滿街都是。好停，鑽得進巷子；被偷的機率也最高。', price: 3040, used: 1980, upkeep: 40 },
  { id: 'veh_yozakura', name: '夜櫻 II', brand: '緋櫻', kind: '機車', grade: 2, seats: '2', cargo: 2, cover: 35, call: 1, leg: '5 分鐘', chase: '+2', trait: '四缸的重機。授權鎖：沒解鎖的車只發得動登記的車主。騎著它進櫻町，表演與威嚇 +1。', price: 11250, upkeep: 40 },
  { id: 'veh_roar', name: '咆哮 II', brand: '鉻娘子改', kind: '機車', grade: 2, seats: '2', cargo: 1, cover: 40, call: 1, leg: '5 分鐘', chase: '+3', trait: '叫進場的那一回合可以撞敵方第 1 格的人；沒有義臂的人追逐的加值只有 +1。', price: 7500, upkeep: 40 },
  { id: 'veh_sedan', name: '二手轎車', brand: '無牌', kind: '汽車', grade: 1, seats: '4', cargo: 8, cover: 45, call: 2, leg: '10 分鐘', chase: '+0', trait: '什麼都普通，就是編隊的那一台。後車廂關起來，臨檢要開箱才看得到。', price: 12000, used: 7800, upkeep: 100 },
  { id: 'veh_mule', name: '騾子 II', brand: '星旗', kind: '汽車', grade: 2, seats: '2＋車斗 4', cargo: 16, cover: 60, call: 2, leg: '10 分鐘', chase: '+0', trait: '軍用皮卡，車斗載得下一具摺起來的機甲；沒有電子零件，駭不了。', price: 27000, upkeep: 100 },
  { id: 'veh_rover', name: '改裝車 II', brand: '無牌（野薔薇改）', kind: '汽車', grade: 2, seats: '4', cargo: 10, cover: 55, call: 2, leg: '9 分鐘', chase: '+1（鏽帶與荒地 +3）', trait: '暗格：載貨裡有 4 是暗格，臨檢與掃描找不到。開得出城。通常沒有登記。', price: 24000, upkeep: 100 },
  { id: 'veh_cloud', name: '雲梭 II', brand: '織女', kind: '浮空車', grade: 2, seats: '4', cargo: 6, cover: 40, call: 2, leg: '4 分鐘（任意兩個降落點）', chase: '+3（空中）', trait: '會飛：從一個降落點直接飛到另一個；不進舊港與鏽帶深處，下不了地下層。起降都記在航管上。', price: 108000, upkeep: 300, flying: true },
]
export const vehicleById = (id: string) => VEHICLES.find(v => v.id === id)

// ---- 機甲 ----
export interface MechWeapon { name: string; brand: string; grade: string; dmg: string; range: string; mag: string; price: number }
export const MECH_WEAPONS: MechWeapon[] = [
  { name: '雙聯輕機槍', brand: '星旗', grade: 'III', dmg: '4d6 物理', range: '3～6', mag: '4', price: 11520 },
  { name: '火箭莢艙', brand: '星旗', grade: 'III', dmg: '7d6 物理', range: '3～7', mag: '1', price: 11520 },
  { name: '舊式機槍', brand: '星旗', grade: 'II', dmg: '4d6 物理', range: '3～6', mag: '3', price: 3600 },
  { name: '衝鋒機砲', brand: '織女', grade: 'II', dmg: '3d6 物理', range: '2～5', mag: '3', price: 3600 },
  { name: '撞角', brand: '鉻娘子改', grade: 'II', dmg: '3d6 物理', range: '1', mag: '—', price: 4000 },
]
/** 板材：每塊 +3／+4／+5／+6（I～IV） */
export const PLATE_HP = [0, 3, 4, 5, 6]
/** 輔助槽的零件效果（CRAFTING 15.4 節）：同一種只算一件 */
export const AUX_PARTS: Record<string, string> = { 感測器: '機甲的武器命中 +1', 電源: '持續 +1 回合', 致動器: '啟動期間迴避 +1', 機械神經元: '回灌的比例 −5%' }
/** 每點耐久的修理費 = 等級基準 × 0.08 × 修理係數；每週的整備費 = 那一級每週的固定開銷 × 0.25 × 修理係數 */
export const REPAIR_PER_PT = [0, 12, 40, 130, 480, 1500]
export const UPKEEP_WEEK = [0, 60, 180, 600, 1950, 6250]
/** 同級精英生命 × 0.4 是連同板材的上限 */
export const MECH_CAP = [0, 44, 52, 66, 82, 100]
export const BACKLASH = [{ n: '淺', p: 10 }, { n: '標準', p: 20 }, { n: '深', p: 30 }, { n: '全', p: 50 }]

export interface MechState {
  model: string; brand: string; grade: number; base: number; hp: number; repairMult: number; brandNote: string
  weapons: Array<string | null>; plates: number[]; aux: Array<string | null>; owedWeeks: number; where: string; sync: number
  /** 第四版：損毀或剛買的骨架要大修一次才能啟動；機甲用的零件與殘件；被打爛、開不走的車 */
  needsOverhaul?: boolean
  parts?: Record<string, number>
  salvage?: number
  wrecked?: string[]
}
/** 野馬的骨架（ITEMS 14.2 節）：機體 43／54／68、骨架價 5,040／6,480／8,280 */
export const MUSTANG_FRAME: Record<number, { base: number; price: number }> = { 2: { base: 43, price: 5040 }, 3: { base: 54, price: 6480 }, 4: { base: 68, price: 8280 } }
export const OVERHAUL_PARTS = ['致動器', '電源', '機械神經元'] as const
/**
 * 大修（CRAFTING 15.3 節）：損毀的機甲與剛買來的骨架。錢是修滿的修理費 × 2（自己修減半）；
 * 致動器、電源、機械神經元各一件（一件機甲殘件抵兩件）；修滿要的板材另外照算；修車廠 3 天、自己修 7 天。
 */
export function overhaulQuote(m: MechState, self: boolean) {
  const full = repairQuote(m, mechMax(m), self)
  const have = m.parts ?? {}
  const missing = OVERHAUL_PARTS.filter(p => !(have[p] > 0))
  const salvageNeed = Math.ceil(missing.length / 2)
  return { money: full.money * 2, plates: full.plates, days: self ? 7 : 3, dc: full.dc, missing, salvageNeed, enoughParts: salvageNeed <= (m.salvage ?? 0) }
}
/** 升級骨架（15.4 節）：同系列往上一級；下一級的骨架價 × 3；板材、致動器、電源各一件；修車廠 3 天；要對應的同步 */
export function upgradeQuote(m: MechState) {
  const next = MUSTANG_FRAME[m.grade + 1]
  if (!next) return null
  return { grade: m.grade + 1, money: next.price * 3, parts: ['板材', '致動器', '電源'], days: 3, sync: m.grade + 1, base: next.base }
}
/** 載具被打爛（15.6 節）：拖車 200；修理費目錄價的 15%，修車廠一天；自己修半價、兩天，機械 DC 10 ＋ 級 × 2 */
export function carRepairQuote(v: { price: number; grade: number }, self: boolean) {
  return { tow: 200, money: Math.round(v.price * 0.15 * (self ? 0.5 : 1)), days: self ? 2 : 1, dc: 10 + v.grade * 2 }
}
/** 假存檔：薔薇驛的車庫裡一具除役的星旗野馬 II（骨架 43，三個板槽、兩個武器掛點、一個輔助槽） */
export const START_MECH: MechState = {
  model: '野馬', brand: '星旗', grade: 2, base: 43, hp: 26, repairMult: 0.7, brandNote: '星旗 ×0.7：修得起，零件在蜂巢東側買得到',
  weapons: ['雙聯輕機槍', null], plates: [2, 0, 0], aux: ['感測器'], owedWeeks: 0, where: '薔薇驛的車庫', sync: 2,
  needsOverhaul: false, parts: { 板材: 3, 致動器: 1, 電源: 1, 機械神經元: 0 }, salvage: 1, wrecked: ['veh_street'],
}
export function mechMax(m: MechState) {
  const raw = m.base + m.plates.reduce((s, g) => s + PLATE_HP[g], 0)
  return Math.max(0, Math.min(MECH_CAP[m.grade], raw) - Math.min(15, m.owedWeeks * 5))
}
export function mechStatus(hp: number, max: number) { return hp <= 0 ? '損毀' : hp >= max ? '完好' : hp >= max / 2 ? '受損' : '重損' }
/** 大修做完：耐久修滿、零件扣掉（缺的用殘件抵） */
export function applyOverhaul(m: MechState) {
  const q = overhaulQuote(m, false)
  const parts = m.parts ?? (m.parts = {})
  for (const p of OVERHAUL_PARTS) if (parts[p] > 0) parts[p]--
  m.salvage = Math.max(0, (m.salvage ?? 0) - q.salvageNeed)
  parts['板材'] = Math.max(0, (parts['板材'] ?? 0) - q.plates)
  m.needsOverhaul = false
  m.hp = mechMax(m)
}
/** 升級做完：級 +1、骨架換成下一級、要的同步 +1、耐久修滿；零件扣掉 */
export function applyUpgrade(m: MechState) {
  const q = upgradeQuote(m)
  if (!q) return
  const parts = m.parts ?? (m.parts = {})
  for (const p of q.parts) parts[p] = Math.max(0, (parts[p] ?? 0) - 1)
  m.grade = q.grade; m.base = q.base; m.sync = q.sync
  m.hp = mechMax(m)
}
/** 修理的估價：送修（修車廠）照修理費 ×1、每 20 點 4 小時；自己修照 ×0.5、每 20 點 8 小時、機械 DC 10 ＋ 級 × 2 */
export function repairQuote(m: MechState, pts: number, self: boolean) {
  const per = Math.round(REPAIR_PER_PT[m.grade] * m.repairMult)
  const plates = Math.ceil(pts / 20)
  return { money: Math.round(per * pts * (self ? 0.5 : 1)), plates, hours: plates * (self ? 8 : 4), dc: 10 + m.grade * 2, per }
}
