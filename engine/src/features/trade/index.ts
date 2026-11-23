// L6 功能：交易（商店、今天的清單、價格與拆解、購物車與結帳、兩種錢；TRADE 第 1、2、3（3.1～3.3）、7、9、11、12 節；LIFE 1.1 節；UI 3.8 節；
// dev/adr/0016 第三節；dev/work/M2-trade.md）。
//
// 每間店每天一張清單（亂數只看存檔種子、店、第幾天）；價格是一步一步的拆解；買與賣同一台購物車一次結；
// 買到的東西真的進引擎的背包。這一張不做：區與區的行情、貨物、收購遞減、殺價（M2-market，類別的行情那一步先是 1）；
// AI 的當日優惠、二手與同人與鑑定、服務（3.4）、以物易物、洗錢。
//
// 接上核心的地方：
//   內容  shop_type、shop、trade_rule（id: default，蓋掉內建的數字；格式見 model.ts）；多讀的欄位：item.price、item.trade_category、item.no_sell
//   讀的  meterOf：favor、hostility（後台勢力）、affinity（店主）；district.price_mult；actor.ext.identity；actor.ext.gear（身上穿著的不能賣，只認格式）
//   格子  usesOf：人站在對得到店的設施上，列「進店」（後台勢力不做你的生意時灰掉並寫原因）
//   狀態  state.ext.trade：今天每間店賣掉了幾個（只經由結帳報告裡的 ext 變更寫）
// 報告：trade.checkout（kind deal；帳戶與現金分開記）。
// 對外：stockOf、quote、shopView、checkout、planCheckout、buyBlock、sellBlock、payBlock、shopBlock、shopsAt。

import type { ContentEntry, Feature, GridUse, Kernel } from '../../core'
import { ContentError } from '../../core'
import { shopBlock } from './checkout'
import type { ShopEntry, ShopTypeEntry } from './model'
import { OWNER, RULE_KIND, SHOP_KIND, SHOP_TYPE_KIND, ruleProblems, shopProblems, shopTypeProblems } from './model'

export { buyBlock, checkout, payBlock, planCheckout, refuseReason, sellBlock, shopBlock } from './checkout'
export type { Cart, CartLine, CheckoutPlan, PricedLine } from './checkout'
export {
  DEFAULT_TRADE_RULES, PAY_NAME, candidatesOf, categoryMult, discountOf, favorDiscount, matches, plainCount, quote, round, soldToday, stockOf, tradeOf, tradeRules, wornCount,
} from './model'
export type { Discount, Pay, Quote, QuoteStep, ShopEntry, ShopTypeEntry, StockRow, TradeItem, TradeRules, TradeState } from './model'
export { shopView } from './view'
export type { SellRow, ShelfRow, ShopView } from './view'

/** 站在這一塊街區的這個設施標記上對得到哪幾間店（shop.block 與 shop.facility 都對得上）。 */
export function shopsAt(k: Pick<Kernel, 'content'>, block: string | undefined, marker: string): ShopEntry[] {
  if (!block) return []
  return k.content.list<ShopEntry>(SHOP_KIND).filter((s) => s.block === block && s.facility === marker)
}

export const tradeFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: ruleProblems })
    k.content.defineKind<ShopTypeEntry>({ kind: SHOP_TYPE_KIND, owner: OWNER, validate: shopTypeProblems })
    k.content.defineKind<ShopEntry>({
      kind: SHOP_KIND, owner: OWNER, validate: shopProblems,
      refs: (e) => [
        [SHOP_TYPE_KIND, e.type], ['district', e.district],
        ...(e.block !== undefined ? [['block', e.block] as [string, string]] : []),
        ...(e.owner !== undefined ? [['npc', e.owner] as [string, string]] : []),
        ...(e.backer !== undefined ? [['faction', e.backer] as [string, string]] : []),
        ...(e.fixed ?? []).map((i): [string, string] => ['item', i]),
      ],
    })

    // ---- 站在設施上：列「進店」 ----
    k.grid.usesOf(OWNER, (ctx, marker): GridUse[] =>
      shopsAt(ctx.k, ctx.state.location.block, marker.id).map((s) => ({ id: `trade.shop:${s.id}`, name: `進店：${s.name}`, block: shopBlock(ctx.k as Kernel, ctx.state, s) })))
  },

  ready(k: Kernel) {
    // 設施的標記要真的在那一塊街區上（block 是 world 的內容種類；沒有裝世界、查不到的不檢查：引用的檢查另外會講）
    const problems: string[] = []
    for (const s of k.content.list<ShopEntry>(SHOP_KIND)) {
      if (s.block === undefined) continue
      const b = k.content.get<ContentEntry & { district?: unknown; facilities?: Record<string, unknown> }>('block', s.block)
      if (!b) continue
      if (b.district !== undefined && b.district !== s.district) problems.push(`shop/${s.id}：district 是 ${s.district}，可是街區 ${s.block} 在 ${String(b.district)}`)
      if (s.facility !== undefined && !(b.facilities && s.facility in b.facilities)) problems.push(`shop/${s.id}：街區 ${s.block} 沒有 ${s.facility} 這個設施`)
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
