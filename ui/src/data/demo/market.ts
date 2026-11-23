/**
 * 示意包的區行情（TRADE 4.2：類別行情；舊資料 shops.ts 的 trend 整理成區的 market）。
 * 值是倍率（1 是行情不動），鍵是貿易類別的 id（引擎 trade_rules 的 categories）。整份是資料，沒有規則。
 */
export const DISTRICT_MARKET: Record<string, Record<string, number>> = {
  hive: { food: 0.8, daily: 0.8, luxury: 1.3, electronics: 1.1 },
  oldport: { weapon: 0.8, ammo: 0.8, mech: 0.85, food: 1.2, medicine: 1.1 },
  ave42: { apparel: 0.8, material: 0.8, mech: 0.9, food: 1.1 },
}
