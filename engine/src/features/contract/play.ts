// L6 功能 contract 玩家主動做的事：照做或抗拒、走到了、做完、主動要求一條指令、還清、遮光紋。
// 都是「問的函式（回傳原因或 null）加做的函式（回傳報告草稿）」；不成立時草稿丟 ActionBlocked，原因是給玩家看的完整句子、一次只講一條。
//
//   chooseBlock／chooseDraft   收到的指令（sent）選照做（doing）或抗拒：定力檢定（resolve＋composure，帶標籤 resist_control）。成功 resisted、滿意 −5；失敗 forced；
//                              主角非自願（pc_unwilling）關掉時，被強制的只會是差事與工作，其餘種類失敗當成功。報告 contract.choose。
//   arriveBlock／arriveDraft   人在 place（沒有 place 在哪都算）而且那一條是 doing 或 forced：報告 contract.arrive，帶觸發點 order 與 where { order, holder, relation }，事件由導演挑。
//   completeBlock／completeDraft  事件做完（或沒有事件接手時，呼叫的人直接收尾）：done、滿意 +5（asked 的 +8）、照做 +1、每 3 次馴化 +1。報告 contract.done。
//   askOrderBlock／askOrderDraft  主動要求一條指令：直接是 doing、asked: true。報告 contract.order。
//   payoffQuote／payoffBlock／payoffDraft  還清：付 債 × mult（滿意 talk_at 以上可以先擲一次交涉，成功改成 talk_mult）；付清等於解約。報告 contract.pay。
//   coverMarkBlock／coverMarkDraft  遮或露出光紋（遮要背包裡有 mark_cover 標籤的東西）。報告 contract.cover。

import type { ActorId, ContentEntry, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, contentAllowed, formatAmount, rollCheck } from '../../core'
import { RESIST_ATTR, RESIST_SKILL, RESIST_TAGS, draftOf, passChance, pcName, resistPlan, rollBeat } from './draft'
import type { ResistPlan } from './draft'
import type { Contract, Order, OrderKind } from './model'
import {
  ARRIVE_ACTION, CHOOSE_ACTION, COVER_ACTION, DONE_ACTION, MARK_COVER_TAG, METER_KEY, ORDER_ACTION, ORDER_NAME, PAY_ACTION, SATISFACTION, activeCount, allowedKinds, contractRules,
  extChange, extOf, forceable, isOrderKind, meterNow, nowOf, pcOf, placeMatches, placeName, scopeData, trimRecords,
} from './model'
import { completePlan, endPlan, makeOrder, orderText } from './plans'

const POOL_NAME = { cred: '帳戶', cash: '現金' } as const
type Pool = keyof typeof POOL_NAME

const mineOf = (state: GameState): { pc: ActorId; contract: Contract } | string => {
  const pc = pcOf(state)
  const c = extOf(state).mine
  return !pc || !c ? '你身上沒有管理級的契約。' : { pc, contract: c }
}
const orderIn = (c: Contract, id: string): Order | undefined => c.queue.find((o) => o.id === id)
const dom = (state: GameState): boolean => contentAllowed(state.rules, 'contract_dom')

// ---- 照做或抗拒 ----

export interface ChooseOpts {
  order: string
  how: 'comply' | 'resist'
}

/** 現在選不了的原因（一條）；選得了是 null。 */
export function chooseBlock(k: Kernel, state: GameState, o: ChooseOpts): string | null {
  const m = mineOf(state)
  if (typeof m === 'string') return m
  const order = orderIn(m.contract, o.order)
  if (!order) return '找不到這一條指令。'
  if (order.state !== 'sent') return '這一條指令已經回應過了。'
  if (o.how !== 'comply' && o.how !== 'resist') return '要選照做或抗拒。'
  return k.activity.blockOf(state, `commit:${CHOOSE_ACTION}`)
}

/** 這一條指令抗拒的 DC 與成功率（畫面用）；找不到是 null。 */
export function resistQuote(k: Kernel, state: GameState, orderId: string): (ResistPlan & { forceable: boolean }) | null {
  const m = mineOf(state)
  if (typeof m === 'string') return null
  const order = orderIn(m.contract, orderId)
  return order ? { ...resistPlan(k, state, m.pc, m.contract), forceable: forceable(order.kind, contentAllowed(state.rules, 'pc_unwilling')) } : null
}

export function chooseDraft(k: Kernel, state: GameState, o: ChooseOpts): ReportDraft {
  const why = chooseBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const { pc, contract: c } = mineOf(state) as { pc: ActorId; contract: Contract }
  const ext = extOf(state)
  const mine = ext.mine!
  const order = orderIn(mine, o.order)!
  const rules = contractRules(k)
  const who = c.holder.name
  const name = ORDER_NAME[order.kind]
  if (o.how === 'comply') {
    order.state = 'doing'
    return draftOf(state, 'action', CHOOSE_ACTION, [extChange(ext)], [`你收下了${who}的${name}，答應照做。`], 'comply')
  }
  const plan = resistPlan(k, state, pc, c)
  const roll = rollCheck(k.stats, state, { actor: pc, attr: RESIST_ATTR, skill: RESIST_SKILL, dc: plan.dc, purpose: `${CHOOSE_ACTION}/${order.id}`, tags: RESIST_TAGS })
  const passed = roll.degree === 'success' || roll.degree === 'critical'
  const unforced = !passed && !forceable(order.kind, contentAllowed(state.rules, 'pc_unwilling'))
  const beats = [rollBeat(pc, roll, 'contract.roll')]
  const changes = [{ op: 'rng', advance: 1 } as const]
  if (passed || unforced) {
    order.state = 'resisted'
    order.closed = nowOf(state)
    trimRecords(mine, rules.keep_records)
    const lines = [passed ? `你頂住了橋的拉扯，沒有照${who}的${name}去做。${who}知道你抗命了。` : `${who}的${name}沒能逼你照做。${who}知道你抗命了。`]
    return draftOf(state, 'action', CHOOSE_ACTION, [...changes, extChange(ext), { op: 'meter', kind: SATISFACTION, key: METER_KEY, delta: rules.satisfaction.resist }], lines, 'resisted', { beats })
  }
  order.state = 'forced'
  return draftOf(state, 'action', CHOOSE_ACTION, [...changes, extChange(ext)], [`你沒能頂住：橋不讓你拒絕，${who}的${name}變成了非做不可的事，要在期限之前做完。`], 'forced', { beats })
}

// ---- 走到了 ----

export interface OrderOpts {
  order: string
}

export function arriveBlock(k: Kernel, state: GameState, o: OrderOpts): string | null {
  const m = mineOf(state)
  if (typeof m === 'string') return m
  const order = orderIn(m.contract, o.order)
  if (!order) return '找不到這一條指令。'
  if (order.state !== 'doing' && order.state !== 'forced') return order.state === 'sent' ? '這一條指令你還沒回應：先選照做，再走過去。' : '這一條指令已經了結了。'
  if (order.arrived) return '你已經到過那裡了。'
  if (!placeMatches(k, state, order.place)) return `你還沒走到${placeName(k, order.place)}。`
  return k.activity.blockOf(state, `commit:${ARRIVE_ACTION}`)
}

export function arriveDraft(k: Kernel, state: GameState, o: OrderOpts): ReportDraft {
  const why = arriveBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const ext = extOf(state)
  const c = ext.mine!
  const order = orderIn(c, o.order)!
  order.arrived = true
  const line = `你到了${placeName(k, order.place)}，${c.holder.name}的${ORDER_NAME[order.kind]}等著你。`
  return draftOf(state, 'action', ARRIVE_ACTION, [extChange(ext)], [line], 'arrived', {
    triggers: [{ point: 'order', where: { order: order.kind, holder: c.holder.kind, relation: c.relation } }],
  })
}

// ---- 做完 ----

export function completeBlock(k: Kernel, state: GameState, o: OrderOpts): string | null {
  const m = mineOf(state)
  if (typeof m === 'string') return m
  const order = orderIn(m.contract, o.order)
  if (!order) return '找不到這一條指令。'
  if (order.state !== 'doing' && order.state !== 'forced') return order.state === 'sent' ? '這一條指令你還沒回應。' : '這一條指令已經了結了。'
  if (order.place && !order.arrived && !placeMatches(k, state, order.place)) return `你還沒走到${placeName(k, order.place)}。`
  return k.activity.blockOf(state, `commit:${DONE_ACTION}`)
}

export function completeDraft(k: Kernel, state: GameState, o: OrderOpts): ReportDraft {
  const why = completeBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const plan = completePlan(k, state, pcOf(state)!, o.order)!
  return draftOf(state, 'action', DONE_ACTION, plan.changes, plan.lines, plan.docility ? 'done_docile' : 'done')
}

// ---- 主動要求 ----

export interface AskOpts {
  kind: OrderKind
}

export function askOrderBlock(k: Kernel, state: GameState, o: AskOpts): string | null {
  const m = mineOf(state)
  if (typeof m === 'string') return m
  if (!isOrderKind(o.kind)) return '要選一種指令。'
  if (!allowedKinds(state, m.contract, dom(state)).includes(o.kind)) return `「${ORDER_NAME[o.kind]}」這一類的指令現在不會出現。`
  if (activeCount(m.contract) >= scopeData(k).queue_max) return `${m.contract.holder.name}手上你還有指令沒做完，等你做完再說。`
  return k.activity.blockOf(state, `commit:${ORDER_ACTION}`)
}

export function askOrderDraft(k: Kernel, state: GameState, o: AskOpts): ReportDraft {
  const why = askOrderBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const ext = extOf(state)
  const order = makeOrder(k, state, ext, { kind: o.kind, now: nowOf(state), asked: true, state: 'doing' })
  ext.mine!.queue.push(order)
  return draftOf(state, 'action', ORDER_ACTION, [extChange(ext)], [orderText(ext.mine!, order)], 'asked')
}

// ---- 還清 ----

export interface PayoffOpts {
  /** 先談價（要滿意 talk_at 以上） */
  talk?: boolean
  pay?: Pool
}

export interface PayoffQuote {
  debt: number
  price: number
  /** 談成的價（滿意不夠時沒有） */
  talk_price: number | null
  can_talk: boolean
  /** 交涉的 DC 與成功率 */
  talk_dc: number
  talk_chance: number
}

const NEGOTIATE = { attr: 'charm', skill: 'negotiate', tags: ['negotiate'] } as const

const payPool = (state: GameState, cost: number, want?: Pool): Pool | null => (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => state.money[p] >= cost) ?? null

export function payoffQuote(k: Kernel, state: GameState): PayoffQuote | null {
  const m = mineOf(state)
  if (typeof m === 'string' || m.contract.type !== 'debt') return null
  const rules = contractRules(k)
  const debt = m.contract.debt ?? 0
  const sat = meterNow(k, state)
  const can = sat >= rules.buyout.talk_at
  const dc = rules.buyout.talk_dc + state.rules.dcOffset
  return {
    debt, price: Math.round(debt * rules.buyout.mult), talk_price: can ? Math.round(debt * rules.buyout.talk_mult) : null, can_talk: can, talk_dc: dc,
    talk_chance: can ? passChance(talkParts(k, state, m.pc), dc) : 0,
  }
}

const talkParts = (k: Kernel, state: GameState, pc: ActorId) => checkParts(k.stats, state, pc, { attr: NEGOTIATE.attr, skill: NEGOTIATE.skill, tags: [...NEGOTIATE.tags] })

export function payoffBlock(k: Kernel, state: GameState, o: PayoffOpts = {}): string | null {
  const m = mineOf(state)
  if (typeof m === 'string') return m
  const q = payoffQuote(k, state)
  if (!q || m.contract.type !== 'debt') return '這份契約沒有欠債可以還清。'
  if (q.debt <= 0) return '這份契約已經沒有欠債了。'
  if (o.talk && !q.can_talk) return `${m.contract.holder.name}對你的滿意還不夠，談不了價。`
  const need = o.talk ? q.talk_price! : q.price
  if (payPool(state, need, o.pay) === null) return `錢不夠：還清要 C$${formatAmount(need)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`
  return k.activity.blockOf(state, `commit:${PAY_ACTION}`)
}

export function payoffDraft(k: Kernel, state: GameState, o: PayoffOpts = {}): ReportDraft {
  const why = payoffBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const { pc, contract: c } = mineOf(state) as { pc: ActorId; contract: Contract }
  const q = payoffQuote(k, state)!
  const lines: string[] = []
  const changes: ReportDraft['changes'] = []
  const beats = []
  let price = q.price
  let talked: 'won' | 'lost' | null = null
  if (o.talk) {
    const roll = rollCheck(k.stats, state, { actor: pc, attr: NEGOTIATE.attr, skill: NEGOTIATE.skill, tags: [...NEGOTIATE.tags], dc: q.talk_dc, purpose: `${PAY_ACTION}/talk/${c.id}` })
    beats.push(rollBeat(pc, roll, 'contract.roll'))
    changes.push({ op: 'rng', advance: 1 })
    talked = roll.degree === 'success' || roll.degree === 'critical' ? 'won' : 'lost'
    lines.push(talked === 'won' ? `你和${c.holder.name}談了一輪（${DEGREE_NAME[roll.degree]}），談到了一個比較低的價。` : `你和${c.holder.name}談了一輪，沒有談出更好的價。`)
    if (talked === 'won') price = q.talk_price!
  }
  const pool = payPool(state, price, o.pay)
  if (pool === null) {
    // 交涉沒談成，原價又付不起：這一輪只有交涉（骰子已經往前，下一次再談會換一顆）
    lines.push(`原價 C$${formatAmount(price)}，你付不起。`)
    return draftOf(state, 'action', PAY_ACTION, changes, lines, 'talk_failed', { beats })
  }
  const end = endPlan(state, pc, 'payoff', { silent: true })!
  changes.push({ op: pool, delta: -price }, ...end.changes)
  lines.push(`你付清了 C$${formatAmount(price)}（${POOL_NAME[pool]}），契約解除，${c.holder.name}不再是你的持約人。`)
  return draftOf(state, 'action', PAY_ACTION, changes, lines, talked === 'won' ? 'paid_talked' : 'paid', { beats })
}

// ---- 光紋 ----

export interface CoverOpts {
  covered: boolean
}

const hasCover = (k: Kernel, state: GameState): boolean =>
  state.inventory.some((s) => s.qty > 0 && (k.content.get<ContentEntry & { tags?: unknown }>('item', s.id)?.tags as string[] | undefined)?.includes(MARK_COVER_TAG))

export function coverMarkBlock(k: Kernel, state: GameState, o: CoverOpts): string | null {
  const m = mineOf(state)
  if (typeof m === 'string') return m
  if (m.contract.mark.covered === o.covered) return o.covered ? '光紋已經遮著了。' : '光紋本來就露著。'
  if (o.covered && !hasCover(k, state)) return '你身上沒有能遮光紋的東西（遮標頸環、遮瑕貼之類）。'
  return k.activity.blockOf(state, `commit:${COVER_ACTION}`)
}

export function coverMarkDraft(k: Kernel, state: GameState, o: CoverOpts): ReportDraft {
  const why = coverMarkBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const ext = extOf(state)
  ext.mine!.mark.covered = o.covered
  const line = o.covered ? `${pcName(state)}把後頸的光紋遮了起來。契約上寫著不准遮，要是被看出來，不會有好下場。` : `${pcName(state)}把後頸的光紋露了出來。`
  return draftOf(state, 'action', COVER_ACTION, [extChange(ext)], [line], o.covered ? 'covered' : 'shown')
}
