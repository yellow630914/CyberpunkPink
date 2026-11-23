// L6 功能：交易（商店、今天的清單、價格與拆解、購物車與結帳、兩種錢；TRADE 第 1、2、3（3.1～3.3）、7、9、11、12 節；LIFE 1.1 節；UI 3.8 節；
// dev/adr/0016 第三節；dev/work/M2-trade.md）。
//
// 每間店每天一張清單（亂數只看存檔種子、店、第幾天）；價格是一步一步的拆解；買與賣同一台購物車一次結；
// 買到的東西真的進引擎的背包。
// 區與區的行情、貨物、收購遞減、殺價（TRADE 3.2、4.1～4.3、第 5 節；dev/work/M2-market.md）：行情是區的資料 district.market、貿易類別沒寫的照物品推；
// 貨物收購 90%；同一間店同一個類別每多收一件 −3%（最多 −50%、每天回復 5 件）；殺價是主動行動 bargain（資料寫 owner: 'trade'）。
// 這個功能不做：AI 的當日優惠、二手與同人與鑑定、服務（3.4）、以物易物、黑市的進出與收贓、洗錢、區域狀態與長期折扣（倍率留一步是 1）、挑毛病（M2 沒有二手件）、殺價的出價。
//
// 接上核心的地方：
//   內容  shop_type、shop、trade_rule（id: default，蓋掉內建的數字；格式見 model.ts）；多讀的欄位：item.price、item.trade_category、item.cargo、item.no_sell、district.market；
//         action_kind 裡 owner 是 trade 的那一筆（bargain）
//   讀的  meterOf：favor、hostility（後台勢力）、affinity（店主）、fame（這一區）；k.conditions：has_favor、tendency_tag（沒有人註冊，那一種殺法就不列）；
//         district.price_mult；actor.ext.identity；actor.ext.gear（身上穿著的不能賣，只認格式）
//   效果  bargain：{ shop, method, degree }（殺價的結果，只收表裡的四種）
//   格子  usesOf：人站在對得到店的設施上，列「進店」（後台勢力不做你的生意時灰掉並寫原因）
//   狀態  state.ext.trade：今天每間店賣掉了幾個、收購遞減的累計件數、今天殺過價的倍率、被趕出去的店（只經由結帳與殺價的報告裡的 ext 變更寫）
// 報告：trade.checkout（kind deal；帳戶與現金分開記）；殺價是 bargain（kind action，走主動行動自己的報告）。
// 對外：stockOf、quote、shopView、checkout、planCheckout、buyBlock、sellBlock、payBlock、shopBlock、shopsAt；
//       tradeCategoryOf、marketMult、routesHint、bargainDc、bargainBlock、bargainView、bargainInput、bargainByFavor。

import type { ContentEntry, Feature, GridUse, Kernel } from '../../core'
import { ContentError, isRecord } from '../../core'
import { registerBargainEffect, registerBargainKind } from './bargain'
import { shopBlock } from './checkout'
import type { ShopEntry, ShopTypeEntry, TradeItem } from './model'
import { OWNER, RULE_KIND, SHOP_KIND, SHOP_TYPE_KIND, ruleProblems, shopProblems, shopTypeProblems, tradeRules } from './model'

export {
  BARGAIN_EFFECT, BARGAIN_KIND, BARGAIN_METHODS, METHOD_IDS, bargainBlock, bargainByFavor, bargainDc, bargainInput, bargainOutcome, bargainView, routesHint, temperOf,
} from './bargain'
export type { BargainInput, BargainMethod, BargainOption, BargainOutcome, BargainView, RouteRow, RoutesHint } from './bargain'
export { buyBlock, checkout, payBlock, planCheckout, refuseReason, sellBlock, sellPrices, shopBlock } from './checkout'
export type { Cart, CartLine, CheckoutPlan, PricedLine } from './checkout'
export {
  DEFAULT_TRADE_CATEGORIES, DEFAULT_TRADE_RULES, PAY_NAME, bargainToday, candidatesOf, categoryMult, categoryName, clampMarket, closedToday, decayMult, discountOf, favorDiscount,
  intakeCount, isCargo, marketMult, marketOf, matches, plainCount, quote, round, soldToday, stockOf, tradeCategoryOf, tradeOf, tradeRules, wornCount,
} from './model'
export type { BargainRec, Discount, Intake, Pay, Quote, QuoteOpts, QuoteStep, ShopEntry, ShopTypeEntry, StockRow, TradeItem, TradeRules, TradeState } from './model'
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
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })
    k.content.defineKind<ShopTypeEntry>({ kind: SHOP_TYPE_KIND, owner: OWNER, overridable: true, validate: shopTypeProblems })
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

    // ---- 殺價的結果（效果 bargain；行動種類 bargain 在 ready 照資料註冊）----
    registerBargainEffect(k)
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

    // 行情與貿易類別（M2-market）：區的 market 是 { 貿易類別: 倍率 }（倍率是正數；太大太小在報價時夾，不算錯）；物品寫的 trade_category 要查得到、cargo 是布林值
    const cats = tradeRules(k).categories
    for (const d of k.content.list<ContentEntry & { market?: unknown }>('district')) {
      if (d.market === undefined) continue
      if (!isRecord(d.market)) { problems.push(`district/${d.id}：market 要是 { 貿易類別: 倍率 }`); continue }
      for (const [cat, m] of Object.entries(d.market)) {
        if (!(cat in cats)) problems.push(`district/${d.id}：market 的 ${cat} 不是貿易類別（${Object.keys(cats).join('、')}）`)
        if (!(typeof m === 'number' && Number.isFinite(m) && m > 0)) problems.push(`district/${d.id}：market.${cat} 要是大於 0 的倍率`)
      }
    }
    for (const it of k.content.list<TradeItem>('item')) {
      if (it.trade_category !== undefined && !(typeof it.trade_category === 'string' && it.trade_category in cats)) problems.push(`item/${it.id}：trade_category ${String(it.trade_category)} 不是貿易類別（${Object.keys(cats).join('、')}）`)
      if (it.cargo !== undefined && typeof it.cargo !== 'boolean') problems.push(`item/${it.id}：cargo 要是 true 或 false`)
    }
    if (problems.length > 0) throw new ContentError(problems)

    // 資料裡 owner 是 trade 的行動種類（殺價）
    registerBargainKind(k)
  },
}
