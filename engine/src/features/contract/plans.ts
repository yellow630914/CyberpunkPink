// L6 功能 contract 改契約的幾件基本動作：簽、解、塞一條指令、做完一條指令、查內建的效果。
// 效果（effects.ts）與主動的入口（play.ts）、隨時間發生的事（time.ts）共用；每一個都是純函式，回傳要套的變更與給玩家看的句子。

import type { ActorId, Change, Effect, GameState, Kernel } from '../../core'
import { MINUTES_PER_DAY, clone, effectCtx, toMinutes } from '../../core'
import type { Contract, ContractExt, ContractRule, ContractType, Holder, Order, OrderKind, OrderState, Place, Relation } from './model'
import {
  BOUND, DEBT_PERIOD_DAYS, METER_KEY, ORDER_NAME, SATISFACTION, TYPE_NAME, classOf, contractRules, deadlineMinutes, extChange, extOf, holderId, identityChange,
  nowOf, readHolder, trimRecords,
} from './model'

/** 效果的 holder 欄位：寫成物件，或寫成勢力、人的 id（帳單、戰敗事件那樣只知道債主是誰時用）。 */
export function resolveHolder(k: Pick<Kernel, 'content'>, state: GameState | undefined, raw: unknown): { holder?: Holder; problem?: string } {
  if (typeof raw === 'string') {
    if (k.content.hasKind('faction') && k.content.has('faction', raw)) {
      const f = k.content.get<{ id: string; name?: string; short?: string; class?: string }>('faction', raw)
      const kind = raw === 'eden' ? 'eden' : f?.class === 'street' ? 'gang' : 'corp'
      return { holder: { kind, faction: raw, name: f?.name ?? f?.short ?? raw } }
    }
    if (k.content.hasKind('npc') && k.content.has('npc', raw)) return { holder: { kind: 'person', npc: raw, name: k.content.get<{ id: string; name?: string }>('npc', raw)?.name ?? raw } }
    if (state?.actors[raw]) return { holder: { kind: 'person', npc: raw, name: state.actors[raw]!.name } }
    return { problem: `查不到持約人 ${raw}（要是勢力或人物的 id，或是 { kind, name, ... }）` }
  }
  const h = readHolder(raw)
  if (!h) return { problem: '要是 { kind: eden／gang／corp／person, name, faction?, npc?, place?, freq? }，或是勢力、人物的 id' }
  return { holder: h }
}

/** 內建的效果（來源 builtin）能不能用、會變成什麼。查不到、驗不過、結算不成都回 ok: false。 */
export function builtinFx(k: Kernel, state: GameState, actor: ActorId, fx: Effect[]): { ok: boolean; changes: Change[]; lines: string[] } {
  const none = { ok: false, changes: [] as Change[], lines: [] as string[] }
  if (fx.some((e) => !k.effects.has(e.kind))) return none
  const ctx = effectCtx(k, state, { source: 'builtin', actor })
  if (k.effects.validate(fx, ctx).length > 0) return none
  const res = k.effects.resolve(fx, ctx)
  return res.errors.length > 0 ? none : { ok: true, changes: res.changes, lines: res.lines }
}

// ---- 簽 ----

export interface SignInput {
  holder: Holder
  type: ContractType
  orders?: OrderKind[]
  debt?: number
  days?: number
  relation?: Relation
  rules?: ContractRule[]
  report_weekday?: number
  weekday: number
}

/** 簽：建立 mine、滿意從 start、身分改成 bound。已經有一份就是 null。 */
export function signPlan(k: Kernel, state: GameState, actor: ActorId, e: SignInput): { changes: Change[]; text: string; contract: Contract } | null {
  const ext = extOf(state)
  if (ext.mine) return null
  const rules = contractRules(k)
  const now = nowOf(state)
  const was = classOf(state, actor)
  const c: Contract = {
    id: `c${ext.seq + 1}`, holder: e.holder, type: e.type, orders: e.orders ? [...new Set(e.orders)] : ['errand', 'modify', 'serve', 'work', 'report', 'lend'],
    relation: e.relation ?? 'formal', rules: (e.rules ?? []).map((r) => ({ ...r })), queue: [], mark: { covered: false },
    was_class: was === BOUND ? 'citizen' : was, complied: 0, signed: now, report_weekday: e.report_weekday ?? e.weekday,
  }
  if (e.type === 'debt') {
    c.debt = e.debt ?? 0
    c.interest_at = now + DEBT_PERIOD_DAYS * MINUTES_PER_DAY
  }
  if (e.days !== undefined) c.until = now + e.days * MINUTES_PER_DAY
  if (!c.orders.includes('report')) delete c.report_weekday
  ext.mine = c
  ext.seq += 1
  const text = `你簽下了一份${TYPE_NAME[c.type]}，持約人是${c.holder.name}。後頸多了一段光紋，你的身分成了契約人。`
  ext.notes.push({ kind: 'sign', text })
  return {
    changes: [extChange(ext), identityChange(state, actor, BOUND), { op: 'meter', kind: SATISFACTION, key: METER_KEY, set: rules.satisfaction.start }],
    text, contract: c,
  }
}

const END_TEXT: Record<string, string> = {
  payoff: '債務還清了，契約解除。',
  paid_off: '債務還清了，契約解除。',
  expired: '契約期滿，自動解除。',
  released: '持約人同意解除這份契約。',
}

/** 解約：清掉 mine 與佇列、身分改回去、滿意歸零。沒有契約就是 null。silent：不記「解約」的通知（自己已經有一份報告交代了，例：還清）。 */
export function endPlan(state: GameState, actor: ActorId, how: string, opts: { base?: ContractExt; silent?: boolean } = {}): { changes: Change[]; text: string } | null {
  const ext = opts.base ?? extOf(state)
  const c = ext.mine
  if (!c) return null
  ext.mine = null
  const text = END_TEXT[how] ?? '這份契約解除了。'
  if (!opts.silent) ext.notes.push({ kind: 'end', text, result: how })
  const changes: Change[] = [extChange(ext), { op: 'meter', kind: SATISFACTION, key: METER_KEY, set: 0 }]
  if (classOf(state, actor) === BOUND) changes.push(identityChange(state, actor, c.was_class === BOUND ? 'citizen' : c.was_class))
  return { changes, text }
}

// ---- 指令 ----

export interface MakeOrder {
  kind: OrderKind
  now: number
  place?: Place
  hours?: number
  asked?: boolean
  state?: OrderState
}

/** 照契約與規則做出一條指令（還沒放進佇列；ext.seq 往前一格）。place 沒寫時：侍奉與回報是持約人的所在，其餘不指定。 */
export function makeOrder(k: Kernel, state: GameState, ext: ContractExt, o: MakeOrder): Order {
  const c = ext.mine!
  ext.seq += 1
  const id = `o${ext.seq}`
  const place = o.place ?? (o.kind === 'serve' || o.kind === 'report' ? c.holder.place : undefined)
  return {
    id, kind: o.kind, from: holderId(c.holder), ...(place ? { place: clone(place) } : {}), issued: o.now,
    deadline: o.now + deadlineMinutes(k, state, o.kind, o.now, id, o.hours), state: o.state ?? 'sent', ...(o.asked ? { asked: true as const } : {}),
  }
}

export const orderText = (c: Contract, o: Order): string =>
  o.asked ? `你向${c.holder.name}要了一條${ORDER_NAME[o.kind]}的指令。` : `${c.holder.name}的耳語送來了一條指令：${ORDER_NAME[o.kind]}。`

/** 把一條指令放進佇列並記一則通知（事件塞進來的指令用；每天下的與主動要的另外發報告）。 */
export function pushOrderPlan(k: Kernel, state: GameState, o: MakeOrder): { changes: Change[]; order: Order; text: string } | null {
  const ext = extOf(state)
  if (!ext.mine) return null
  const order = makeOrder(k, state, ext, o)
  ext.mine.queue.push(order)
  const text = orderText(ext.mine, order)
  ext.notes.push({ kind: 'order', text, order: order.id })
  return { changes: [extChange(ext)], order, text }
}

// ---- 做完 ----

/** 做完一條指令（doing 或 forced 的）：done、滿意加、照做次數 +1、每 docility_every 次馴化 +1、紀錄只留最近幾條。找不到或還沒開始是 null。 */
export function completePlan(k: Kernel, state: GameState, actor: ActorId, orderId: string, base?: ContractExt): { changes: Change[]; lines: string[]; order: Order; docility: boolean } | null {
  const ext = base ?? extOf(state)
  const c = ext.mine
  const o = c?.queue.find((x) => x.id === orderId)
  if (!c || !o || !(o.state === 'doing' || o.state === 'forced')) return null
  const rules = contractRules(k)
  o.state = 'done'
  o.closed = nowOf(state)
  c.complied += 1
  trimRecords(c, rules.keep_records)
  const delta = o.asked ? rules.satisfaction.asked : rules.satisfaction.comply
  const changes: Change[] = [extChange(ext), { op: 'meter', kind: SATISFACTION, key: METER_KEY, delta }]
  const lines = [`你做完了${c.holder.name}交代的${ORDER_NAME[o.kind]}，${c.holder.name}的滿意往上了一點。`]
  let docility = false
  if (c.complied % rules.docility_every === 0) {
    const fx = builtinFx(k, state, actor, [{ kind: 'bridge', param: 'docility', amount: 1 }])
    if (fx.ok && fx.changes.length > 0) {
      docility = true
      changes.push(...fx.changes)
      lines.push('照做的次數多了，橋把「照做」接得更順了。')
    }
  }
  return { changes, lines, order: o, docility }
}

/** 一條指令距離期限還有幾分鐘（過了是負的）。 */
export const minutesLeft = (state: GameState, o: Pick<Order, 'deadline'>): number => o.deadline - toMinutes(state.time)

