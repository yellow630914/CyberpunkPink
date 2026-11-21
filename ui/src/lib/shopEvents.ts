/**
 * 商店的事件（第四版）：TRADE 第 5 節的殺價、第 10 節的當日特別交易（AI 關著時用模板），
 * 與 EVENTS 3.1 節的 `enter_facility` 觸發點（走進店裡時導演擲一次）。純函式；畫面在 dialogs/ShopDialog.vue。
 */
import type { Rng } from './combat/rng'

// ---- 殺價（TRADE 第 5 節） ----
/** 店的脾氣 → DC 修正。原廠直營不能殺價（null） */
export const TEMPER_DC: Record<string, number | null> = { 原廠直營: null, 高檔: 3, 一般: 0, 好說話: 0, 冷淡: 0, 黑市: 1, 攤販: -1, 同人攤: -2 }
export type BargainWay = 'talk' | 'charm' | 'flaw' | 'press' | 'favor'
export const BARGAIN_WAYS: Array<{ id: BargainWay; name: string; check: string; note: string }> = [
  { id: 'talk', name: '講價', check: '魅力＋交涉', note: '—' },
  { id: 'charm', name: '撒嬌、放電', check: '魅力＋誘惑', note: '這一區的豔名 30 以上' },
  { id: 'flaw', name: '挑毛病', check: '智識＋街頭直覺', note: '只對二手件；DC −2' },
  { id: 'press', name: '施壓', check: '意志＋威嚇', note: '只在黑市與幫派的店；大失敗時後台勢力敵對值 +5' },
  { id: 'favor', name: '用人情', check: '不擲', note: '用掉店主欠你的一個小人情，當成大成功' },
]
/** DC = 13 − ⌊店主親密度 ÷ 25⌋ ＋ 店的脾氣（挑毛病再 −2） */
export function bargainDc(affinity: number, temper: string, way: BargainWay = 'talk'): number | null {
  const t = TEMPER_DC[temper]
  if (t === null) return null
  return 13 - Math.floor(Math.max(0, affinity) / 25) + (t ?? 0) - (way === 'flaw' ? 2 : 0)
}
export type BargainResult = '大成功' | '成功' | '失敗' | '大失敗'
/** 結果：大成功 ×0.8（親密度 +2）、成功 ×0.9、失敗不變、大失敗 ×1.1（親密度 −3） */
export const BARGAIN_MULT: Record<BargainResult, number> = { 大成功: 0.8, 成功: 0.9, 失敗: 1, 大失敗: 1.1 }
export const BARGAIN_AFFINITY: Record<BargainResult, number> = { 大成功: 2, 成功: 0, 失敗: 0, 大失敗: -3 }
export function bargainResult(die: number, mod: number, dc: number): BargainResult {
  if (die === 1) return '大失敗'
  if (die === 20 || die + mod >= dc + 5) return '大成功'
  return die + mod >= dc ? '成功' : '失敗'
}
/** 這一種殺法用得了嗎 */
export function bargainWayReason(way: BargainWay, o: { fame: number; usedOnly: boolean; blackOrGang: boolean; favors: number }): string | null {
  if (way === 'charm' && o.fame < 30) return '這一區的豔名要 30 以上。'
  if (way === 'flaw' && !o.usedOnly) return '只對二手件：車裡要買的都要是二手的。'
  if (way === 'press' && !o.blackOrGang) return '只在黑市與幫派的店。'
  if (way === 'favor' && o.favors < 1) return '店主沒有欠你人情。'
  return null
}

// ---- 當日特別交易（TRADE 第 10 節；AI 關著時用模板） ----
export interface Deal { id: string; title: string; desc: string; price: number; pay: 'cash' | 'acc'; item?: string; qty?: number; affinity?: number; rumor?: string; flavor?: boolean; stock: number }
/** 驗證（TRADE 10 節）：價格下限是內容價值的 80%；店主親密度單筆 ±3；氣氛交易不帶隱藏的效果 */
export function validateDeal(d: Deal, value: number): { ok: boolean; price: number; notes: string[] } {
  const notes: string[] = []
  let price = d.price
  if (!d.flavor && price < Math.round(value * 0.8)) { price = Math.round(value * 0.8); notes.push(`價格太低，拉回內容價值的 80%：${price}`) }
  if (d.affinity !== undefined && Math.abs(d.affinity) > 3) notes.push('店主親密度單筆最多 ±3')
  if (d.flavor && (d.item || d.rumor)) notes.push('氣氛交易不能帶物品或傳聞')
  return { ok: !notes.some(n => n.includes('最多') || n.includes('不能')), price, notes }
}
export const SHOP_DEALS: Record<string, Deal[]> = {
  alian: [
    { id: 'd_ration', title: '臨期的糰糧一箱，八折', desc: '阿蓮說明天就過期了，今天吃完沒問題。', price: 40, pay: 'cash', item: 'it_964af0', qty: 10, stock: 1 },
    { id: 'd_tea', title: '陪阿蓮收攤', desc: '幫她把貨架推進去，她請你一碗麵。', price: 0, pay: 'cash', affinity: 1, flavor: true, stock: 1 },
    { id: 'd_rumor', title: '買一則傳聞', desc: '九號塔的封鎖線昨晚有人進去過。', price: 80, pay: 'cash', rumor: '九號塔的封鎖線昨晚有人進去過，出來的人身上有藍鯨的標籤。', stock: 1 },
  ],
  gunshop: [
    { id: 'd_barrel', title: '今天到了一批星旗的二手槍管', desc: '老鐵挑了一支還能用的，算你便宜。', price: 380, pay: 'cash', item: 'it_7eb6ee', qty: 1, stock: 1 },
    { id: 'd_range', title: '試射場的空檔', desc: '後面的靶場今天沒人，打一匣不收錢。', price: 0, pay: 'cash', affinity: 1, flavor: true, stock: 1 },
  ],
  cybershop: [
    { id: 'd_chip', title: '同人社團寄賣的晶片，有怪癖', desc: '便宜，但裝上去之前最好先讓人看過。', price: 200, pay: 'cash', item: 'it_7f887b', qty: 1, stock: 1 },
  ],
}

// ---- 走進店裡的事件（EVENTS 3.1 節的 enter_facility） ----
export interface ShopEventOpt { id: string; name: string; check?: { skill: string; dc: number }; win: string; lose?: string; affinity?: number; price?: number; hostility?: number }
export interface ShopEvent { id: string; shops: string[] | 'any'; text: string; opts: ShopEventOpt[] }
export const SHOP_EVENTS: ShopEvent[] = [
  { id: 'se_protection', shops: ['alian'], text: '兩個收保護費的人靠在櫃檯上，阿蓮的臉色很難看。', opts: [
    { id: 'help', name: '出面說話', check: { skill: '交涉', dc: 13 }, win: '他們罵了兩句走了。阿蓮把一包菸塞給你。', lose: '他們記住了你的臉。', affinity: 3, hostility: 1 },
    { id: 'pay', name: '替她付這週的', price: 100, win: '你把錢放在櫃檯上，他們拿了就走。', affinity: 2 },
    { id: 'leave', name: '不關你的事', win: '你挑完東西就走。阿蓮沒有看你。', affinity: -1 },
  ] },
  { id: 'se_thief', shops: 'any', text: '一個戴著兜帽的年輕人把一包東西塞進外套，往門口走。', opts: [
    { id: 'stop', name: '攔住他', check: { skill: '運動', dc: 13 }, win: '你在門口攔下他。店主多看了你一眼。', lose: '他從你腋下鑽了出去。', affinity: 2 },
    { id: 'look', name: '當作沒看到', win: '門口的鈴響了一下。', affinity: 0 },
  ] },
  { id: 'se_blackout', shops: 'any', text: '整條街跳電了。店主點了一盞蠟燭，說今天架上的東西隨便算。', opts: [
    { id: 'shop', name: '趁黑挑東西', win: '這一趟買的東西照九折算（特別交易也一樣）。', price: -1 },
  ] },
  { id: 'se_consign', shops: ['gunshop', 'cybershop'], text: '一個熟客想寄賣一件東西，店主問你要不要先看。', opts: [
    { id: 'look', name: '先看看', check: { skill: '街頭直覺', dc: 13 }, win: '你看出那件東西是乾淨的，店主讓你先挑。', lose: '你看不出名堂。', affinity: 1 },
    { id: 'pass', name: '不看', win: '店主把它收進櫃子裡。' },
  ] },
]
/** 走進店裡：導演擲一次（25%）；同一間店同一天只擲一次（用天數與店名當種子） */
export function rollShopEvent(shopId: string, rng: Rng, chance = 0.25): ShopEvent | null {
  if (rng() >= chance) return null
  const pool = SHOP_EVENTS.filter(e => e.shops === 'any' || e.shops.includes(shopId))
  return pool.length ? pool[Math.floor(rng() * pool.length)] : null
}
/** 一間店一天的種子（同一天再進去是同一件事） */
export function shopDaySeed(shopId: string, day: number) { let h = day * 131; for (const c of shopId) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h || 1 }
