// L6 功能 trade 的購物車與結帳（TRADE 第 1 節「買與賣放進同一台購物車，一次結帳」、第 3.3 節、第 7 節、第 9 節、第 11 節；dev/work/M2-trade.md）。
// 改狀態的入口都是匯出一個純函式、回傳報告草稿：介面交給 Game.commit（或 commitNarrated）。任何一條不成立整車不結。

import type { Change, ContentEntry, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, formatAmount, isRecord } from '../../core'
import type { Pay, Quote, ShopEntry, ShopTypeEntry, TradeItem } from './model'
import {
  EXT, PAYS, PAY_NAME, hostilityOf, identityClass, itemOf, matches, plainCount, priced, quote, shopEntry, shopTypeOf, soldToday, stockOf, tradeOf, tradeRules, wornCount,
} from './model'

export interface CartLine {
  item: string
  qty: number
}
export interface Cart {
  buy?: CartLine[]
  sell?: CartLine[]
  /** 淨額照這一種錢結 */
  pay: Pay
}

const nameOfFaction = (k: Pick<Kernel, 'content'>, id: string): string => {
  const f = k.content.get<ContentEntry & { short?: string; name?: string }>('faction', id)
  return f?.short ?? f?.name ?? id
}
const itemName = (k: Pick<Kernel, 'content'>, id: string): string => itemOf(k, id)?.name ?? id

// ---- 做不成的原因（一條一句）----

/** 後台勢力敵對值太高、不做生意的那一句。 */
export function refuseReason(k: Pick<Kernel, 'content'>, shop: ShopEntry, at: number): string {
  return `這間店的後台勢力（${shop.backer ? nameOfFaction(k, shop.backer) : ''}）對你的敵對值已經到了 ${at} 以上，不做你的生意。`
}

/** 這間店現在做不做你的生意：後台勢力的敵對值到了門檻（預設 60）就不做。 */
export function shopBlock(k: Kernel, state: GameState, shop: string | ShopEntry): string | null {
  const entry = shopEntry(k, shop)
  if (!entry) return `沒有 ${String(shop)} 這間店。`
  if (!shopTypeOf(k, entry)) return `這間店的種類（${entry.type}）查不到。`
  const rules = tradeRules(k)
  return hostilityOf(k, state, entry) >= rules.hostility_refuse_at ? refuseReason(k, entry, rules.hostility_refuse_at) : null
}

/** 這間店收不收這種錢（TRADE 7、第 2 節的表）。 */
export function payBlock(k: Kernel, _state: GameState, shop: string | ShopEntry, pay: Pay): string | null {
  const entry = shopEntry(k, shop)
  const type = entry ? shopTypeOf(k, entry) : undefined
  if (!type) return '查不到這間店的種類。'
  if (pay === 'cash' && type.cash === false) return '這間店不收現金晶片，要用帳戶。'
  if (pay === 'cred' && type.cash === 'only') return '這間店只收現金晶片。'
  return null
}

/** 登記類的東西：一定要用帳戶（那就是掃橋），而且無籍的人買不到（這間店不掃登記類就不管）。 */
function registeredBlock(state: GameState, type: ShopTypeEntry, it: TradeItem, pay?: Pay): string | null {
  if (it.legal !== 'register' || type.scan_registered === false) return null
  if (identityClass(state) === 'unregistered') return `你是無籍，這間店不賣登記類的${it.name}給你。`
  if (pay === 'cash') return `登記類的${it.name}一定要用帳戶買（買的時候要掃橋）。`
  return null
}

/**
 * 買 qty 個這樣東西做不做得成：null 是做得成，否則是一句話的原因（一次只講一條）。
 * pay 沒給就不查和付款有關的條件（畫面列貨架時先問一次，選了錢之後再問一次）。
 */
export function buyBlock(k: Kernel, state: GameState, shop: string | ShopEntry, item: string, qty = 1, pay?: Pay): string | null {
  const entry = shopEntry(k, shop)
  if (!entry) return `沒有 ${String(shop)} 這間店。`
  const type = shopTypeOf(k, entry)
  if (!type) return `這間店的種類（${entry.type}）查不到。`
  const shut = shopBlock(k, state, entry)
  if (shut) return shut
  const it = itemOf(k, item)
  if (!it) return `沒有 ${item} 這樣東西。`
  if (!priced(it)) return `${it.name}沒有定價，店不賣。`
  const row = stockOf(k, state, entry).find((r) => r.item === item)
  if (!row) return `今天的清單上沒有${it.name}。`
  if (row.left <= 0) return `${it.name}今天賣完了，明天再來。`
  if (qty > row.left) return `${it.name}今天只剩 ${row.left} 個。`
  const reg = registeredBlock(state, type, it, pay)
  if (reg) return reg
  if (pay) return payBlock(k, state, entry, pay)
  return null
}

/** 賣 qty 個這樣東西做不做得成（TRADE 3.3、第 2 節的「收」）。 */
export function sellBlock(k: Kernel, state: GameState, shop: string | ShopEntry, item: string, qty = 1): string | null {
  const entry = shopEntry(k, shop)
  if (!entry) return `沒有 ${String(shop)} 這間店。`
  const type = shopTypeOf(k, entry)
  if (!type) return `這間店的種類（${entry.type}）查不到。`
  const shut = shopBlock(k, state, entry)
  if (shut) return shut
  const it = itemOf(k, item)
  if (!it) return `沒有 ${item} 這樣東西。`
  if (!priced(it)) return `${it.name}沒有定價，店不收。`
  if (it.no_sell === true) return `${it.name}不能賣。`
  if (!matches(it, type.buys)) return `這種店（${type.name}）不收${it.name}這一類的東西。`
  const plain = plainCount(state, item)
  const worn = wornCount(state, item)
  const total = state.inventory.reduce((n, s) => (s.id === item ? n + s.qty : n), 0)
  const have = plain - worn
  if (total === 0) return `背包裡沒有${it.name}。`
  if (plain === 0) return `${it.name}是有記號的那一件（組裝的成品或零件），現在還不能賣。`
  if (have <= 0) return `${it.name}正穿戴在身上，先脫下來才能賣。`
  if (qty > have) return `背包裡能賣的${it.name}只有 ${have} 個。`
  return null
}

// ---- 結帳 ----

export interface PricedLine {
  item: string
  name: string
  qty: number
  unit: number
  total: number
  quote: Quote
}

export interface CheckoutPlan {
  /** 不成立的每一條原因（空的就是結得了）；結帳丟的錯是第一條 */
  problems: string[]
  buy: PricedLine[]
  sell: PricedLine[]
  buyTotal: number
  sellTotal: number
  /** 買 − 賣：正的是要付、負的是收進來 */
  net: number
}

function merge(lines: CartLine[] | undefined, problems: string[]): CartLine[] {
  const by = new Map<string, number>()
  for (const l of lines ?? []) {
    if (!isRecord(l) || typeof l.item !== 'string' || !l.item) { problems.push('購物車裡有一列沒有寫是哪樣東西。'); continue }
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) { problems.push(`${l.item} 的數量要是 1 以上的整數。`); continue }
    by.set(l.item, (by.get(l.item) ?? 0) + l.qty)
  }
  return [...by].map(([item, qty]) => ({ item, qty }))
}

/** 這一車結不結得了：算出每一列的價錢、淨額與所有不成立的原因。不改任何東西。 */
export function planCheckout(k: Kernel, state: GameState, shop: string | ShopEntry, cart: Cart): CheckoutPlan {
  const entry = shopEntry(k, shop)
  const plan: CheckoutPlan = { problems: [], buy: [], sell: [], buyTotal: 0, sellTotal: 0, net: 0 }
  if (!entry) return { ...plan, problems: [`沒有 ${String(shop)} 這間店。`] }
  const shut = shopBlock(k, state, entry)
  if (shut) return { ...plan, problems: [shut] }
  if (!(PAYS as readonly unknown[]).includes(cart.pay)) plan.problems.push('要選一種錢來付：帳戶或現金晶片。')
  const buy = merge(cart.buy, plan.problems)
  const sell = merge(cart.sell, plan.problems)
  if (buy.length + sell.length === 0 && plan.problems.length === 0) plan.problems.push('購物車是空的。')
  for (const b of buy) if (sell.some((s) => s.item === b.item)) plan.problems.push(`${itemName(k, b.item)}不能在同一車裡又買又賣。`)
  const pay = PAYS.includes(cart.pay) ? cart.pay : undefined
  if (pay) {
    const why = payBlock(k, state, entry, pay)
    if (why && !(buy.length === 0 && sell.length === 0)) plan.problems.push(why)
  }

  for (const l of buy) {
    const why = buyBlock(k, state, entry, l.item, l.qty, pay)
    // 付款不收的那一句已經在上面講過一次
    if (why && !plan.problems.includes(why)) plan.problems.push(why)
    if (why || !pay) continue
    const q = quote(k, state, entry, l.item, 'buy')
    plan.buy.push({ item: l.item, name: itemName(k, l.item), qty: l.qty, unit: q.price, total: q.price * l.qty, quote: q })
  }
  for (const l of sell) {
    const why = sellBlock(k, state, entry, l.item, l.qty)
    if (why) { plan.problems.push(why); continue }
    const q = quote(k, state, entry, l.item, 'sell')
    plan.sell.push({ item: l.item, name: itemName(k, l.item), qty: l.qty, unit: q.price, total: q.price * l.qty, quote: q })
  }
  plan.buyTotal = plan.buy.reduce((n, l) => n + l.total, 0)
  plan.sellTotal = plan.sell.reduce((n, l) => n + l.total, 0)
  plan.net = plan.buyTotal - plan.sellTotal
  if (plan.problems.length === 0 && pay && plan.net > 0 && state.money[pay] < plan.net) {
    plan.problems.push(`${PAY_NAME[pay]}不夠：這一車要付 ${formatAmount(plan.net)}，你的${PAY_NAME[pay]}只有 ${formatAmount(state.money[pay])}。`)
  }
  return plan
}

/**
 * 結帳（TRADE 第 1 節）：買與賣一次結，淨額（買 − 賣）照選的那一種錢，另一種錢不動；買到的進背包、賣掉的從背包拿走、今天賣掉的數量記進 state.ext.trade。
 * 用帳戶買違禁品，後台勢力的敵對值當場加（TRADE 7；有人定義敵對值這張量表才加）。任何一條不成立整車不結：丟 ActionBlocked，原因是第一條。
 * 報告 trade.checkout（kind deal）：帳戶與現金的變更分開記。
 */
export function checkout(k: Kernel, state: GameState, shop: string | ShopEntry, cart: Cart): ReportDraft {
  const plan = planCheckout(k, state, shop, cart)
  if (plan.problems.length > 0) throw new ActionBlocked(plan.problems[0]!)
  const entry = shopEntry(k, shop)!
  const rules = tradeRules(k)
  const pay = cart.pay
  const changes: Change[] = []
  for (const l of plan.sell) changes.push({ op: 'item', id: l.item, qty: -l.qty })
  for (const l of plan.buy) changes.push({ op: 'item', id: l.item, qty: l.qty })
  if (plan.net !== 0) changes.push({ op: pay, delta: -plan.net })

  // 今天賣掉的數量：其他天的紀錄順手清掉（清單每天重抽，用不到了）
  const day = state.time.day
  const shops: Record<string, { day: number; sold: Record<string, number> }> = {}
  for (const [id, v] of Object.entries(tradeOf(state).shops)) if (v.day === day) shops[id] = { day: v.day, sold: { ...v.sold } }
  const sold = { ...soldToday(state, entry.id) }
  for (const l of plan.buy) sold[l.item] = (sold[l.item] ?? 0) + l.qty
  if (plan.buy.length > 0) shops[entry.id] = { day, sold }
  changes.push({ op: 'ext', key: EXT, value: Object.keys(shops).length > 0 ? { shops } : null })

  const timeline: ReportDraft['timeline'] = []
  const text: string[] = []
  const lines: string[] = []
  if (plan.buy.length > 0) {
    text.push(`買了${plan.buy.map((l) => `${l.name} ×${l.qty}`).join('、')}`)
    for (const l of plan.buy) lines.push(`買 ${l.name} ×${l.qty}：${formatAmount(l.unit)} × ${l.qty} = ${formatAmount(l.total)}`)
  }
  if (plan.sell.length > 0) {
    text.push(`賣了${plan.sell.map((l) => `${l.name} ×${l.qty}`).join('、')}`)
    for (const l of plan.sell) lines.push(`賣 ${l.name} ×${l.qty}：${formatAmount(l.unit)} × ${l.qty} = ${formatAmount(l.total)}`)
  }
  const money = plan.net > 0 ? `付了 ${formatAmount(plan.net)}（${PAY_NAME[pay]}）` : plan.net < 0 ? `收進 ${formatAmount(-plan.net)}（${PAY_NAME[pay]}）` : '帳面剛好打平'
  lines.push(`淨額：${money}`)

  // 用帳戶買違禁品：後台勢力當場加敵對值（每一種加 dirty_hostility 點）
  const dirty = pay === 'cred' ? plan.buy.filter((l) => itemOf(k, l.item)?.legal === 'banned') : []
  if (dirty.length > 0 && entry.backer && rules.dirty_hostility > 0 && k.meters.has('hostility')) {
    const delta = rules.dirty_hostility * dirty.length
    changes.push({ op: 'meter', kind: 'hostility', key: entry.backer, delta })
    lines.push(`用帳戶買了違禁品，${nameOfFaction(k, entry.backer)}對你的敵對值 +${delta}`)
  }

  const summary = `在${entry.name}${text.join('，')}；${money}。`
  timeline.push({
    layer: 'meat' as const, ...(state.pc ? { actor: state.pc } : {}), text: summary, tag: 'trade.checkout',
    data: {
      shop: entry.id, pay, net: plan.net,
      buy: plan.buy.map((l) => ({ item: l.item, qty: l.qty, unit: l.unit })), sell: plan.sell.map((l) => ({ item: l.item, qty: l.qty, unit: l.unit })),
    },
  })
  return {
    kind: 'deal', action: 'trade.checkout', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline, changes, outcome: { result: 'deal', summary }, narration: { results: lines },
  }
}
