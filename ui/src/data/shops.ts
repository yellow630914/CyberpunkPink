import type { Shop } from './types'

/** 商店（docs/systems/TRADE.md 第 2～4 節）。trend 是那一區的行情（4.2 節）。 */
export const SHOPS: Record<string, Shop> = {
  alian: {
    id: 'alian', name: '阿蓮雜貨', type: '雜貨店・天井市場', district: 'hive',
    keeper: '阿蓮', keeperAffinity: 41, backer: '互助會', temper: '好說話',
    shopMult: 1, acceptsAccount: true, acceptsCash: true, scansRegistered: false,
    trend: { 食物: -0.2, 日用: -0.2, 奢侈品: 0.3, 電子: 0.1 }, discount: 0.1,
    stock: [
      { def: 'it_cdfc0b', qty: 4, special: true },
      { def: 'it_964af0', qty: 20 },
      { def: 'it_d6d1e2', qty: 10 },
      { def: 'it_5e3de4', qty: 3 },
      { def: 'it_57e531', qty: 6 },
      { def: 'it_39841b', qty: 5 },
      { def: 'it_d2d2de', qty: 1 },
      { def: 'fu_box', qty: 4 },
      { def: 'fu_neon', qty: 1 },
    ],
  },
  gunshop: {
    id: 'gunshop', name: '回火', type: '槍店・熔爐', district: 'oldport',
    keeper: '老鐵', keeperAffinity: 24, backer: '鉻娘子', temper: '一般',
    shopMult: 1, acceptsAccount: true, acceptsCash: true, scansRegistered: true,
    trend: { 武器: -0.2, 彈藥: -0.2, 機械義體與零件: -0.15, 食物: 0.2, 藥: 0.1 }, discount: 0.05,
    stock: [
      { def: 'it_c7dbe5', qty: 1, special: true },
      { def: 'it_6fa4e8', qty: 2 },
      { def: 'it_7c9988', qty: 1 },
      { def: 'it_e60505', qty: 2 },
      { def: 'it_f0db7d', qty: 3 },
      { def: 'it_7d6ad2', qty: 1 },
      { def: 'it_c27d44', qty: 3 },
      { def: 'it_2ea9f1', qty: 3 },
      { def: 'it_85d0d4', qty: 5, condition: '二手' },
      { def: 'it_19e4c0', qty: 5, condition: '二手' },
      { def: 'it_9da44a', qty: 6 },
      { def: 'it_3b3851', qty: 4 },
    ],
  },
  cybershop: {
    id: 'cybershop', name: '義體零件行', type: '義體店・刀巷', district: 'ave42',
    keeper: '店員', keeperAffinity: 0, backer: '蜜糖會', temper: '冷淡',
    shopMult: 1, acceptsAccount: true, acceptsCash: true, scansRegistered: true,
    trend: { 護甲與服裝: -0.2, 素材與帶子: -0.2, 機械義體與零件: -0.1, 食物: 0.1 }, discount: 0,
    stock: [
      { def: 'it_590ea7', qty: 1, special: true },
      { def: 'it_5a441e', qty: 1 },
      { def: 'it_c66e94', qty: 1 },
      { def: 'it_7bda7b', qty: 2, condition: '二手' },
      { def: 'it_7057c2', qty: 2 },
      { def: 'it_b86505', qty: 8 },
      { def: 'it_1ace6d', qty: 2 },
    ],
  },
}
