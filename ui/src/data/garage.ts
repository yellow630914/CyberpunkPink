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
}
/** 假存檔：薔薇驛的車庫裡一具除役的星旗野馬 II（骨架 43，三個板槽、兩個武器掛點、一個輔助槽） */
export const START_MECH: MechState = {
  model: '野馬', brand: '星旗', grade: 2, base: 43, hp: 26, repairMult: 0.7, brandNote: '星旗 ×0.7：修得起，零件在蜂巢東側買得到',
  weapons: ['雙聯輕機槍', null], plates: [2, 0, 0], aux: ['感測器'], owedWeeks: 0, where: '薔薇驛的車庫', sync: 2,
}
export function mechMax(m: MechState) {
  const raw = m.base + m.plates.reduce((s, g) => s + PLATE_HP[g], 0)
  return Math.max(0, Math.min(MECH_CAP[m.grade], raw) - Math.min(15, m.owedWeeks * 5))
}
export function mechStatus(hp: number, max: number) { return hp <= 0 ? '損毀' : hp >= max ? '完好' : hp >= max / 2 ? '受損' : '重損' }
/** 修理的估價：送修（修車廠）照修理費 ×1、每 20 點 4 小時；自己修照 ×0.5、每 20 點 8 小時、機械 DC 10 ＋ 級 × 2 */
export function repairQuote(m: MechState, pts: number, self: boolean) {
  const per = Math.round(REPAIR_PER_PT[m.grade] * m.repairMult)
  const plates = Math.ceil(pts / 20)
  return { money: Math.round(per * pts * (self ? 0.5 : 1)), plates, hours: plates * (self ? 8 : 4), dc: 10 + m.grade * 2, per }
}
