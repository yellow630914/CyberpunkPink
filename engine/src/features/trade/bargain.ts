// L6 功能 trade 的殺價與行情的提示（TRADE 第 5 節、4.2～4.3；CORE_RULES 第 3 節；dev/work/M2-market.md）。
//
// 殺價是一個主動行動（kind: bargain，資料寫 owner: 'trade'，由這個功能在 ready 讀進來註冊）：
//   - 講價、撒嬌、施壓：先擲骰（Game.act；AI 開著時 judge 給成功程度，程式驗證、夾值），結果照表（大成功 ×0.8、成功 ×0.9、失敗不變、大失敗 ×1.1）
//   - 用人情：不擲，當成大成功；用掉一個店主或他後台勢力欠你的小人情（bargainByFavor）
//   結果是一個效果 { kind: 'bargain', shop, method, degree }：行動種類的參考範圍（hint）給它，AI 關著時照參考範圍，AI 開著時 reward 照參考範圍交；
//   效果只收表裡的四種結果，所以不管誰給的，倍率都在表的四個之內。
// 整車每間店每天一次：買的乘倍率、賣的除以倍率（quote 的 bargain 那一步），記到今天結束。
// 這個功能讀別人的東西只經由：meterOf（affinity、fame、hostility）、k.conditions（has_favor、tendency_tag；沒有人註冊就沒有那一種殺法）、k.content。
//
// 對外：bargainDc、bargainBlock、bargainOptions、bargainView、bargainInput、bargainByFavor、bargainOutcome、routesHint。

import type { ActionKindEntry, ActionInput, ActorId, Change, ContentEntry, Degree, Effect, EffectCtx, GameState, Kernel, ReportDraft, RollPart } from '../../core'
import { ActionBlocked, DEGREE_NAME, actionKindToDef, addMinutes, checkParts, clone, computeDegree, dcFor, meterOf } from '../../core'
import { shopBlock } from './checkout'
import type { BargainRec, ShopEntry } from './model'
import {
  OWNER, bargainToday, categoryName, clampMarket, isCargo, itemOf, marketOf, priced, round, shopEntry, shopTypeOf, tradeCategoryOf, tradeChange, tradeOf, tradeRules,
} from './model'

export const BARGAIN_KIND = 'bargain'
export const BARGAIN_EFFECT = 'bargain'

export type BargainMethod = 'haggle' | 'coax' | 'pressure' | 'favor'
export const BARGAIN_METHODS: Record<BargainMethod, { name: string; attr?: 'charm' | 'resolve'; skill?: string }> = {
  haggle: { name: '講價', attr: 'charm', skill: 'negotiate' },
  coax: { name: '撒嬌、放電', attr: 'charm', skill: 'seduce' },
  pressure: { name: '施壓', attr: 'resolve', skill: 'intimidate' },
  favor: { name: '用人情' },
}
export const METHOD_IDS = Object.keys(BARGAIN_METHODS) as BargainMethod[]
/** 要擲骰的殺法（效果只收這幾種：用人情不擲，由 bargainByFavor 自己做）。 */
const ROLLED: readonly BargainMethod[] = ['haggle', 'coax', 'pressure']
const DEGREES: readonly Degree[] = ['critical', 'success', 'fail', 'fumble']
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isMethod = (v: unknown): v is BargainMethod => (METHOD_IDS as readonly unknown[]).includes(v)

/** 交給 Game.act 的輸入：ActionInput 加上哪一間店、用什麼殺（多的欄位原樣留在 pending.input 裡）。 */
export interface BargainInput extends ActionInput {
  kind: 'bargain'
  shop: string
  method: BargainMethod
}

const nameOf = (k: Pick<Kernel, 'content'>, kind: string, id: string): string => {
  const e = k.content.get<ContentEntry & { name?: string; short?: string }>(kind, id)
  return (kind === 'faction' ? e?.short : undefined) ?? e?.name ?? id
}

// ---- 店的脾氣、DC ----

/** 店的脾氣（DC 修正）：沒寫是 0（一般的店）；null 是不能殺價（原廠直營）。店的種類查不到也是 null。 */
export function temperOf(k: Pick<Kernel, 'content'>, shop: ShopEntry): number | null {
  const type = shopTypeOf(k, shop)
  if (!type) return null
  return type.temper === undefined ? 0 : type.temper
}

/** 店主的親密度（沒有指定店主是 0）。 */
const affinityOf = (k: Pick<Kernel, 'meters'>, state: GameState, shop: ShopEntry): number => (shop.owner ? meterOf(k, state, 'affinity', shop.owner) : 0)

/**
 * 殺價的 DC（TRADE 第 5 節）：13 − ⌊店主親密度 ÷ 25⌋ ＋ 店的脾氣。不能殺價的店回傳 null。
 * 不含存檔難度的偏移（行動送出時才加；bargainOptions 回傳的 dc 已經加了）。
 */
export function bargainDc(k: Kernel, state: GameState, shop: string | ShopEntry): number | null {
  const entry = shopEntry(k, shop)
  if (!entry) return null
  const temper = temperOf(k, entry)
  if (temper === null) return null
  const rules = tradeRules(k)
  return rules.bargain_dc - Math.floor(affinityOf(k, state, entry) / rules.bargain_affinity_step) + temper
}

// ---- 每一種殺法的條件 ----

const hasCondition = (k: Kernel, kind: string): boolean => k.conditions.kinds().includes(kind)
const testCondition = (k: Kernel, state: GameState, cond: Record<string, unknown>, actor?: ActorId): boolean =>
  k.conditions.test(cond as never, { state, stats: k.stats, timeRules: k.timeRules, ...(actor ? { actor } : {}) })

/** 這一區的豔名（沒有人定義這張量表是 0）。 */
const fameOf = (k: Kernel, state: GameState, shop: ShopEntry): number => meterOf(k, state, 'fame', shop.district)

/** 後台勢力是幫派（class 是 street）才能施壓。 */
function isGangShop(k: Kernel, shop: ShopEntry): boolean {
  return !!shop.backer && k.content.get<ContentEntry & { class?: string }>('faction', shop.backer)?.class === 'street'
}

/** 店主和你合的傾向標籤（兩個人都有或深的第一個）；沒有人註冊傾向的條件、店主不是人、沒有合的都是 null。 */
function sharedTendency(k: Kernel, state: GameState, shop: ShopEntry): string | null {
  if (!shop.owner || !state.pc || !state.actors[shop.owner] || !hasCondition(k, 'tendency_tag') || !k.content.hasKind('tendency_tag')) return null
  for (const tag of k.content.list('tendency_tag')) {
    const cond = { kind: 'tendency_tag', tag: tag.id }
    if (testCondition(k, state, cond) && testCondition(k, state, cond, shop.owner)) return tag.id
  }
  return null
}

/** 用人情殺價用掉誰的小人情：店主優先，其次他的後台勢力。沒有人情的功能、或都沒有欠你的是 null。 */
function favorGiver(k: Kernel, state: GameState, shop: ShopEntry): string | null {
  if (!hasCondition(k, 'has_favor')) return null
  for (const who of [shop.owner, shop.backer]) {
    if (who && testCondition(k, state, { kind: 'has_favor', who, size: 'small', dir: 'owed_to_pc' })) return who
  }
  return null
}

/** 這一種殺法在這間店列不列（不成立的條件這裡不列，TRADE 第 5 節的表）：撒嬌要這一區豔名到門檻；施壓要後台是幫派；用人情要有人情的功能。 */
function listed(k: Kernel, state: GameState, shop: ShopEntry, method: BargainMethod): boolean {
  if (method === 'haggle') return true
  if (method === 'coax') return fameOf(k, state, shop) >= tradeRules(k).bargain_fame_min
  if (method === 'pressure') return isGangShop(k, shop)
  return hasCondition(k, 'has_favor')
}

/** 這間店現在能不能殺價（和用什麼殺無關）：一句話的原因；能殺是 null。 */
function shopLevelBlock(k: Kernel, state: GameState, shop: ShopEntry): string | null {
  const shut = shopBlock(k, state, shop)
  if (shut) return shut
  if (temperOf(k, shop) === null) return `${shop.name}不能殺價（原廠直營的店只談長期折扣）。`
  if (bargainToday(state, shop.id)) return `今天已經在${shop.name}殺過價了（整車每間店每天一次），明天再來。`
  return null
}

/** 這一種殺法現在做不做得成：null 是可以，否則是一句話的原因（一次只講一條）。 */
export function bargainBlock(k: Kernel, state: GameState, shop: string | ShopEntry, method: string): string | null {
  const entry = shopEntry(k, shop)
  if (!entry) return `沒有 ${String(shop)} 這間店。`
  if (!isMethod(method)) return `不知道「${String(method)}」這種殺法。`
  const why = shopLevelBlock(k, state, entry)
  if (why) return why
  const rules = tradeRules(k)
  if (method === 'coax') {
    const fame = fameOf(k, state, entry)
    if (fame < rules.bargain_fame_min) return `你在${nameOf(k, 'district', entry.district)}的豔名只有 ${fame}，要到 ${rules.bargain_fame_min} 才用得了撒嬌、放電。`
  }
  if (method === 'pressure' && !isGangShop(k, entry)) return '只有後台是幫派的店才能施壓。'
  if (method === 'favor') {
    if (!hasCondition(k, 'has_favor')) return '現在沒有人情可以用。'
    if (!favorGiver(k, state, entry)) return '店主和他的後台勢力現在都沒有欠你的小人情。'
  }
  return null
}

// ---- 輸入、選項 ----

/** 照殺法組出交給 Game.act 的輸入：屬性與基本功、撒嬌的傾向加成。text 是玩家自己的描述（可以不寫）。 */
export function bargainInput(k: Kernel, state: GameState, shop: string | ShopEntry, method: BargainMethod, text?: string): BargainInput {
  const entry = shopEntry(k, shop)
  if (!entry) throw new Error(`沒有 ${String(shop)} 這間店`)
  const m = BARGAIN_METHODS[method]
  if (!m) throw new Error(`不知道「${String(method)}」這種殺法`)
  const situation: RollPart[] = []
  if (method === 'coax') {
    const tag = sharedTendency(k, state, entry)
    if (tag) situation.push({ label: '店主的傾向和你合', value: tradeRules(k).bargain_tendency_bonus, source: 'situation' })
  }
  return {
    kind: 'bargain', shop: entry.id, method, ...(m.attr ? { attr: m.attr } : {}), ...(m.skill ? { skill: m.skill } : {}),
    ...(text ? { text } : {}), ...(situation.length > 0 ? { situation } : {}),
  }
}

export interface BargainOption {
  method: BargainMethod
  name: string
  /** 要擲的才有：屬性、基本功、DC（已加存檔難度的偏移）、你的檢定加值與成功（含大成功）的機率；用人情不擲 */
  attr?: string
  skill?: string
  dc?: number
  modifier?: number
  chance?: number
  /** 這一種殺法現在做不做得成；可以是 null */
  block: string | null
}

export interface BargainView {
  /** 今天殺過的結果；沒殺過是 null */
  today: BargainRec | null
  /** 這間店現在不能殺價的原因（今天殺過了、被趕出來、不能殺價的店……）；能殺是 null */
  block: string | null
  /** DC（不含難度偏移）；不能殺價的店是 null */
  dc: number | null
  /** 列得出來的殺法（不成立的條件不列：沒有人情的功能就沒有用人情；豔名不夠就沒有撒嬌；不是幫派的店沒有施壓） */
  options: BargainOption[]
}

/** 這間店的殺價畫面：DC、今天的結果、每一種列得出來的殺法和它現在做不做得成。 */
export function bargainView(k: Kernel, state: GameState, shop: string | ShopEntry): BargainView {
  const entry = shopEntry(k, shop)
  if (!entry) throw new Error(`沒有 ${String(shop)} 這間店`)
  const base = bargainDc(k, state, entry)
  const options: BargainOption[] = []
  if (base !== null) {
    for (const method of METHOD_IDS) {
      if (!listed(k, state, entry, method)) continue
      const m = BARGAIN_METHODS[method]
      const o: BargainOption = { method, name: m.name, block: bargainBlock(k, state, entry, method) }
      if (m.attr && state.pc && state.actors[state.pc]) {
        const input = bargainInput(k, state, entry, method)
        const modifier = checkParts(k.stats, state, state.pc, { attr: m.attr, ...(m.skill ? { skill: m.skill } : {}), tags: k.actions.get(BARGAIN_KIND)?.tags ?? [] }, input.situation)
          .reduce((n, p) => n + p.value, 0)
        const dc = dcFor(base, state.rules)
        let wins = 0
        for (let d = 1; d <= 20; d++) if (['critical', 'success'].includes(computeDegree(d, d + modifier, dc))) wins++
        Object.assign(o, { attr: m.attr, ...(m.skill ? { skill: m.skill } : {}), dc, modifier, chance: wins / 20 })
      }
      options.push(o)
    }
  }
  return { today: bargainToday(state, entry.id), block: shopLevelBlock(k, state, entry), dc: base, options }
}

// ---- 結果 ----

export interface BargainOutcome {
  /** 寫進狀態的紀錄 */
  rec: BargainRec
  changes: Change[]
  /** 一行白話 */
  line: string
}

/** 殺價結束時算「那一天」：行動做完之後的那一天（半夜殺價、做完跨日了，倍率算到新的一天）。 */
const endDay = (state: GameState, minutes: number): number => addMinutes(state.time, Math.max(0, minutes)).day

const mult = (x: number): string => String(Number(x.toFixed(4)))

/**
 * 殺價的結果（TRADE 第 5 節的表）：倍率與店主親密度的變化照 bargain_results；施壓大失敗改成被趕出去：後台勢力的敵對值 +5、今天不做你的生意（價錢不變）。
 * minutes 是這次行動花的時間，算「記到哪一天」用。只算出紀錄與變更，不檢查能不能殺（呼叫的人先問 bargainBlock）。
 */
export function bargainOutcome(k: Kernel, state: GameState, shop: string | ShopEntry, method: BargainMethod, degree: Degree, minutes = 0): BargainOutcome {
  const entry = shopEntry(k, shop)
  if (!entry) throw new Error(`沒有 ${String(shop)} 這間店`)
  const rules = tradeRules(k)
  const row = rules.bargain_results[degree]
  const kicked = method === 'pressure' && degree === 'fumble'
  const day = endDay(state, minutes)
  const rec: BargainRec = { day, mult: kicked ? 1 : row.mult, method, degree }
  const trade = tradeOf(state)
  trade.bargains[entry.id] = rec
  if (kicked) trade.closed[entry.id] = day
  const changes: Change[] = [tradeChange(state, trade, rules.decay_recover)]
  const parts: string[] = []
  const name = entry.name
  if (kicked) parts.push(`殺價大失敗：你在${name}施壓被趕了出去，今天這間店不做你的生意`)
  else if (rec.mult < 1) parts.push(`殺價${DEGREE_NAME[degree]}：${name}今天買東西的價錢 ×${mult(rec.mult)}、賣東西的價錢 ÷${mult(rec.mult)}`)
  else if (rec.mult > 1) parts.push(`殺價${DEGREE_NAME[degree]}：${name}今天買東西的價錢 ×${mult(rec.mult)}、賣東西的價錢 ÷${mult(rec.mult)}（反而被抬了價）`)
  else parts.push(`殺價沒有談成：${name}今天的價錢不變（今天不能再殺）`)
  if (row.affinity !== 0 && entry.owner && k.meters.has('affinity')) {
    changes.push({ op: 'meter', kind: 'affinity', key: entry.owner, delta: row.affinity })
    parts.push(`${nameOf(k, 'npc', entry.owner)}對你的親密度 ${row.affinity > 0 ? '+' : '−'}${Math.abs(row.affinity)}`)
  }
  if (kicked && entry.backer && rules.bargain_pressure_hostility !== 0 && k.meters.has('hostility')) {
    changes.push({ op: 'meter', kind: 'hostility', key: entry.backer, delta: rules.bargain_pressure_hostility })
    parts.push(`${nameOf(k, 'faction', entry.backer)}對你的敵對值 +${rules.bargain_pressure_hostility}`)
  }
  return { rec, changes, line: parts.join('，') }
}

interface BargainEffect extends Effect {
  shop: string
  method: BargainMethod
  degree: Degree
}

/** 登記效果 bargain（install 時呼叫）。 */
export function registerBargainEffect(k: Kernel): void {
  k.effects.register<BargainEffect>({
    kind: BARGAIN_EFFECT, owner: OWNER,
    validate: (raw, ctx) => [
      ...(isText(raw.shop) ? (ctx.content.has('shop', raw.shop) ? [] : [`shop：查不到 ${raw.shop} 這間店`]) : ['shop 要是商店的 id']),
      ...((ROLLED as readonly unknown[]).includes(raw.method) ? [] : [`method 要是 ${ROLLED.join('、')} 其中一個（用人情不擲，不走這個效果）`]),
      ...((DEGREES as readonly unknown[]).includes(raw.degree) ? [] : [`degree 要是 ${DEGREES.join('、')} 其中一個`]),
    ],
    // 這間店現在不能殺（今天殺過了、被趕出來、不能殺價的店、這種殺法的條件不成立）：整筆拿掉，不管誰給的
    clamp(e, ctx) {
      const why = bargainBlock(k, ctx.state, e.shop, e.method)
      return why ? { effect: null, note: { from: e.degree, to: null, limit: 'bargain', notice: `${why}所以這次殺價的結果沒有算。` } } : { effect: e }
    },
    toChanges: (e, ctx) => bargainOutcome(k, ctx.state, e.shop, e.method, e.degree, ctx.action?.minutes ?? 0).changes,
    describe: (e, ctx: EffectCtx) => bargainOutcome(k, ctx.state, e.shop, e.method, e.degree, ctx.action?.minutes ?? 0).line,
  })
}

/** ready 時把資料裡 owner 是 trade 的行動種類註冊成核心的定義：目前只有 bargain；資料沒有這一筆就沒有殺價；寫了別的 id 當成資料錯誤。 */
export function registerBargainKind(k: Kernel): void {
  const entries = k.content.list<ActionKindEntry>('action_kind').filter((e) => e.owner === OWNER)
  const strays = entries.filter((e) => e.id !== BARGAIN_KIND)
  if (strays.length > 0) throw new Error(`action_kind 寫了 owner: '${OWNER}'，但交易只認 ${BARGAIN_KIND}：${strays.map((e) => e.id).join('、')}`)
  const entry = entries.find((e) => e.id === BARGAIN_KIND)
  if (!entry) return
  const def = actionKindToDef(entry, k, OWNER)
  const dataBlock = def.block
  const asInput = (input: ActionInput): Partial<BargainInput> => input as Partial<BargainInput>
  def.dc = (state, input) => {
    const i = asInput(input)
    return (typeof i.shop === 'string' ? bargainDc(k, state, i.shop) : null) ?? tradeRules(k).bargain_dc
  }
  def.block = (state, input) => {
    const why = dataBlock?.(state, input)
    if (why) return why
    const i = asInput(input)
    if (typeof i.shop !== 'string' || !i.shop) return '要先選一間店。'
    if (!isMethod(i.method)) return '要先選一種殺法。'
    if (!(ROLLED as readonly unknown[]).includes(i.method)) return `${BARGAIN_METHODS[i.method].name}不用擲骰，不走行動（交給 bargainByFavor）。`
    return bargainBlock(k, state, i.shop, i.method)
  }
  def.hint = ({ input, degree }) => {
    const i = asInput(input)
    return typeof i.shop === 'string' && isMethod(i.method) && (ROLLED as readonly unknown[]).includes(i.method) ? [{ kind: BARGAIN_EFFECT, shop: i.shop, method: i.method, degree }] : []
  }
  k.actions.register(def)
}

/**
 * 用人情殺價（不擲，當成大成功）：用掉一個店主或他後台勢力欠你的小人情（店主優先）。回傳報告草稿（action 是 bargain），交給 Game.commit。
 * 做不成丟 ActionBlocked，原因是 bargainBlock 的那一句。花的時間照資料裡 bargain 那一筆的 minutes（沒有就是 15 分鐘）。
 */
export function bargainByFavor(k: Kernel, state: GameState, shop: string | ShopEntry): ReportDraft {
  const entry = shopEntry(k, shop)
  if (!entry) throw new ActionBlocked(`沒有 ${String(shop)} 這間店。`)
  const why = bargainBlock(k, state, entry, 'favor')
  if (why) throw new ActionBlocked(why)
  const who = favorGiver(k, state, entry)!
  const minutes = k.actions.get(BARGAIN_KIND)?.minutes ?? 15
  const out = bargainOutcome(k, state, entry, 'favor', 'critical', minutes)
  const changes: Change[] = [{ op: 'favor.spend', dir: 'owed_to_pc', who, size: 'small' }, ...out.changes, ...(minutes > 0 ? [{ op: 'time', minutes } as Change] : [])]
  const lines = [`用掉${nameOf(k, entry.owner === who ? 'npc' : 'faction', who)}欠你的一個小人情`, out.line]
  const summary = `在${entry.name}用人情殺價：${out.line}。`
  return {
    kind: 'action', action: BARGAIN_KIND, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: `用人情殺價：${entry.name}。`, tag: 'bargain' }],
    changes, outcome: { result: 'critical', summary }, narration: { results: lines },
  }
}

// ---- 價差的提示（TRADE 4.3） ----

export interface RouteRow {
  district: string
  name: string
  /** 這一區這個貿易類別的行情倍率（夾過；沒寫是 1） */
  market: number
  /** 便宜（行情低於 1）、貴（高於 1）、一般 */
  verdict: 'cheap' | 'dear' | 'even'
  /** 在這一區、店家倍率 1、沒有折扣與加價時：買一個要多少、賣一個能拿多少（沒有收購遞減） */
  buy: number
  sell: number
}

export interface RoutesHint {
  item: string
  /** 貿易類別（id 與名字）與是不是貨物 */
  category: string
  categoryName: string
  cargo: boolean
  /** 每一區，行情由低到高（一樣高的照區的 id） */
  rows: RouteRow[]
  cheap: string[]
  dear: string[]
  /** 最便宜的買處與最好的賣處，以及中間的差價（賣價 − 買價；負的是搬了就虧：一般的東西收購只有 40%） */
  best: { buy: { district: string; price: number }; sell: { district: string; price: number }; margin: number } | null
}

/**
 * 這樣東西在哪幾區便宜、哪幾區貴（給介面的價差提示）：照每一區的行情算的參考價，不含店家倍率、折扣、敵對值加價與收購遞減。
 * 沒有定價的東西丟錯。
 */
export function routesHint(k: Kernel, _state: GameState, item: string): RoutesHint {
  const it = itemOf(k, item)
  if (!priced(it)) throw new Error(`${item} 沒有定價`)
  const rules = tradeRules(k)
  const category = tradeCategoryOf(k, it)
  const cargo = isCargo(it)
  const ratio = cargo ? rules.cargo_ratio : rules.buy_ratio
  const rows: RouteRow[] = k.content.list<ContentEntry & { name?: string; price_mult?: unknown }>('district').map((d): RouteRow => {
    const area = typeof d.price_mult === 'number' && Number.isFinite(d.price_mult) && d.price_mult > 0 ? d.price_mult : 1
    const raw = marketOf(k, d.id)[category]
    const market = raw === undefined ? 1 : clampMarket(rules, raw)
    return {
      district: d.id, name: d.name ?? d.id, market, verdict: market < 1 ? 'cheap' : market > 1 ? 'dear' : 'even',
      buy: round(round(it.price * area) * market), sell: round(round(round(it.price * ratio) * (1 + (area - 1) * rules.sell_area_slope)) * market),
    }
  }).sort((a, b) => a.market - b.market || (a.district < b.district ? -1 : a.district > b.district ? 1 : 0))
  const buy = rows.reduce<RouteRow | null>((m, r) => (m === null || r.buy < m.buy ? r : m), null)
  const sell = rows.reduce<RouteRow | null>((m, r) => (m === null || r.sell > m.sell ? r : m), null)
  return {
    item, category, categoryName: categoryName(k, category), cargo, rows,
    cheap: rows.filter((r) => r.verdict === 'cheap').map((r) => r.district), dear: rows.filter((r) => r.verdict === 'dear').map((r) => r.district),
    best: buy && sell ? { buy: { district: buy.district, price: buy.buy }, sell: { district: sell.district, price: sell.sell }, margin: sell.sell - buy.buy } : null,
  }
}

