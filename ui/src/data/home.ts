import type { FurnitureDef, HomeLayout, PlacedFurniture } from '../lib/home'

/**
 * 家具（docs/systems/DOWNTIME.md 7.5、7.7 節）。佔地是這一版定的：床 1×2、雙人床 2×2、沙發 2×1……
 * icon 用第 2 層的通用圖標，之後換成家具自己的圖。
 */
export const FURNITURE: Record<string, FurnitureDef> = Object.fromEntries(([
  { id: 'mattress', name: '折疊床墊', w: 1, h: 2, comfort: 0, style: '工裝', beds: 1, funcs: ['bed'], price: 40, icon: 'ic-fac_hotel' },
  { id: 'capsule', name: '膠囊床艙', w: 1, h: 2, comfort: 1, style: '霓虹龐克', beds: 1, funcs: ['bed'], price: 300, icon: 'ic-fac_hotel' },
  { id: 'double_bed', name: '雙人床', w: 2, h: 2, comfort: 2, beds: 2, funcs: ['bed'], price: 600, icon: 'ic-fac_hotel' },
  { id: 'sofa', name: '沙發', w: 2, h: 1, comfort: 2, funcs: ['seat'], price: 500, icon: 'ic-fac_bar' },
  { id: 'plant_real', name: '植物（真的）', w: 1, h: 1, comfort: 2, funcs: ['decor'], price: 200, icon: 'ic-fac_shrine' },
  { id: 'neon', name: '霓虹招牌', w: 1, h: 1, comfort: 1, style: '霓虹龐克', funcs: ['decor'], price: 120, icon: 'ic-fac_gacha' },
  { id: 'kitchen', name: '廚房組', w: 2, h: 1, comfort: 1, funcs: ['kitchen'], price: 800, icon: 'ic-fac_food' },
  { id: 'workbench', name: '機械工作台', w: 2, h: 1, comfort: 0, style: '工裝', funcs: ['workbench'], price: 3000, icon: 'ic-tool' },
  { id: 'surgery', name: '手術椅', w: 1, h: 2, comfort: 0, funcs: ['surgery', 'workbench'], price: 6000, icon: 'ic-fac_clinic' },
  { id: 'mechrack', name: '整備架', w: 3, h: 2, comfort: 0, style: '工裝', funcs: ['mechrack', 'workbench'], onlyIn: 'garage', price: 12000, icon: 'ic-fac_garage' },
  { id: 'netpod', name: '接入艙', w: 1, h: 2, comfort: 1, funcs: ['netpod'], price: 4000, icon: 'ic-fac_netcafe' },
  { id: 'stream_desk', name: '直播桌', w: 2, h: 1, comfort: 0, funcs: ['stream'], price: 1500, icon: 'ic-footage' },
  { id: 'box', name: '置物箱', w: 1, h: 1, comfort: 0, storage: 12, funcs: ['storage'], price: 40, icon: 'ic-cargo' },
  { id: 'wardrobe', name: '衣櫃', w: 2, h: 1, comfort: 1, storage: 20, funcs: ['storage'], price: 180, icon: 'ic-slot_coat' },
  { id: 'locker', name: '鐵皮櫃', w: 1, h: 1, comfort: 0, storage: 30, funcs: ['storage'], price: 400, icon: 'ic-cargo' },
  { id: 'shelf', name: '倉庫貨架', w: 2, h: 1, comfort: 0, storage: 50, funcs: ['storage'], onlyIn: 'storeroom', price: 600, icon: 'ic-cargo' },
  { id: 'safe', name: '保險箱', w: 1, h: 1, comfort: 0, storage: 6, funcs: ['safe'], price: 1500, icon: 'ic-cargo' },
  { id: 'shower', name: '淋浴間', w: 1, h: 1, comfort: 0, funcs: ['shower'], price: 0, icon: 'ic-fac_hotel', fixed: true },
] as FurnitureDef[]).map(f => [f.id, f]))

/** 每一級的地圖大小（DOWNTIME 7.4 節的表）。三級是樓上加一樓的店面，兩張圖。 */
export const HOME_TIER_SIZE: Record<number, string> = { 0: '7 × 5', 1: '11 × 8', 2: '15 × 10', 3: '樓上 15 × 10＋店面 15 × 10' }

/**
 * 四號塔的單位（DOWNTIME 7.2 節：蜂巢、1→2、週租 150）。
 * 升到二級時地圖往右、往下長，原本的房間與家具位置不動。
 */
export const TOWER4_LAYOUTS: Record<1 | 2, HomeLayout> = {
  1: {
    tier: 1,
    rows: [
      '###########',
      '#MMMMMMMMM#',
      '#MMMMMMMMM#',
      '#MMMMMMMMM#',
      '#MMMMMMMMM#',
      '#MMMMMM#+##',
      '#MMMMMM#BB#',
      '###E#######',
    ],
    rooms: { M: { name: '主室', cap: 6 }, B: { name: '浴廁', cap: 2, fixedUse: '浴廁' } },
  },
  2: {
    tier: 2,
    rows: [
      '###############',
      '#MMMMMMMMM#CCC#',
      '#MMMMMMMMM#CCC#',
      '#MMMMMMMMM+CCC#',
      '#MMMMMMMMM#CCC#',
      '#MMMMMM#+##+###',
      '#MMMMMM#BB#DDD#',
      '#MMMMMM####DDD#',
      '#MMMMMMMMM+DDD#',
      '###E###########',
    ],
    rooms: { M: { name: '主室', cap: 6 }, B: { name: '浴廁', cap: 2, fixedUse: '浴廁' }, C: { name: '第三間', cap: 6 }, D: { name: '第四間', cap: 6 } },
  },
}

export const START_FURNITURE: PlacedFurniture[] = [
  { uid: 'f1', def: 'mattress', x: 1, y: 1, rot: 0 },
  { uid: 'f2', def: 'wardrobe', x: 3, y: 1, rot: 0 },
  { uid: 'f3', def: 'sofa', x: 2, y: 5, rot: 0 },
  { uid: 'f4', def: 'safe', x: 9, y: 1, rot: 0 },
  { uid: 'f5', def: 'stream_desk', x: 7, y: 3, rot: 0 },
  { uid: 'f6', def: 'shower', x: 9, y: 6, rot: 0 },
]

/** 背包裡的家具物品 → 家具定義 */
export const FURNITURE_ITEM: Record<string, string> = { fu_plant: 'plant_real', fu_workbench: 'workbench', fu_box: 'box', fu_neon: 'neon', fu_doublebed: 'double_bed', fu_netpod: 'netpod' }

/** 三級據點的一樓：店面的前場（F，家具位 8）與後場（K，6）（DOWNTIME 7.1、7.11 節）。樓上沿用二級的版面。 */
export const SHOP_FLOOR_LAYOUT: HomeLayout = {
  tier: 3,
  rows: [
    '###############',
    '#FFFFFFFFF#KKK#',
    '#FFFFFFFFF#KKK#',
    '#FFFFFFFFF+KKK#',
    '#FFFFFFFFF#KKK#',
    '#FFFFFFFFF#KKK#',
    '#FFFFFFFFF#KKK#',
    '#FFFFFFFFF+KKK#',
    '#FFFFFFFFF#KKK#',
    '#######E#######',
  ],
  rooms: { F: { name: '前場', cap: 8, fixedUse: '店面・前場' }, K: { name: '後場', cap: 6, fixedUse: '店面・後場' } },
}

/** 住處（DOWNTIME 7.2 節）。家只有一個；安全屋最多兩處，只能睡、存東西、躲。每一處都付房租。 */
export interface Residence { id: string; name: string; district: string; tiers: [number, number]; rent: number; buy: number | null; cash: string; hide: number; note: string; layout?: boolean }
export const RESIDENCES: Residence[] = [
  { id: 'tower4', name: '四號塔的單位', district: '蜂巢', tiers: [1, 2], rent: 150, buy: 9000, cash: '樓長收', hide: 1, note: '起點；鄰里', layout: true },
  { id: 'loft', name: '高樓層的打通戶', district: '蜂巢', tiers: [2, 3], rent: 450, buy: 27000, cash: '樓長收', hide: 1, note: '一樓可以頂一間天井市場的店面', layout: true },
  { id: 'shack', name: '屋頂村的鐵皮屋', district: '蜂巢', tiers: [1, 2], rent: 90, buy: null, cash: '只收現金', hide: 2, note: '違建；野良好感 20 以上才租得到' },
  { id: 'container', name: '貨櫃屋', district: '舊港', tiers: [1, 2], rent: 120, buy: 7000, cash: '只收現金', hide: 3, note: '拆體客事件 +；有一間放得下機甲' },
  { id: 'bunker', name: '防空室', district: '地下層', tiers: [2, 2], rent: 300, buy: null, cash: '現金、人情', hide: 5, note: '自帶獨立電源；沒有天使急救' },
  { id: 'rosegarage', name: '薔薇驛的車庫', district: '鏽帶', tiers: [2, 3], rent: 300, buy: 18000, cash: '只收現金', hide: 3, note: '店面只能開工坊；有一間放得下機甲' },
]

/** 店面的五種（DOWNTIME 7.11 節） */
export const SHOP_KINDS = [
  { id: '酒吧', fit: 600, deco: 8000, check: '交涉', perk: '每週一則傳聞；30% 有人欠你一個小人情；派工可以多派一個人' },
  { id: '診所', fit: 900, deco: 15000, check: '醫療（店長醫療 3 以上）', perk: '自己與名冊的治療、手術 −30%；沒有執照就是黑診所' },
  { id: '小型人偶館', fit: 1500, deco: 20000, check: '交涉或誘惑', perk: '踩點的「進人偶館當班」更容易；伊甸園敵對值每週 +2', adult: true },
  { id: '轉播站', fit: 200, deco: 10000, check: '表演', perk: '棚內設備每類放兩件；頻道的據點' },
  { id: '同人工坊', fit: 500, deco: 6000, check: '機械', perk: '接組裝與訂做的委託；每週六同人夜市有攤位' },
] as const
export type ShopKind = typeof SHOP_KINDS[number]['id']
