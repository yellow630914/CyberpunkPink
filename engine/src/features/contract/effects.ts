// L6 功能 contract 的效果與條件（dev/work/M4-contract.md「新的格式與鍵」）。效果都只有內建的來源收（ai: false）：AI 與玩家要的簽不了契約、也塞不進指令。
//   效果 contract_sign  { holder, type, orders?, debt?, days?, relation?, rules?, report_weekday? }：簽。holder 寫成 { kind, name, faction?, npc?, place?, freq? }，或寫成勢力、人物的 id；
//                       債務契約要寫 debt。身上已經有管理級的契約、或不是主角：整筆落空並提醒。
//   效果 contract_end   { how }：解約（清掉 mine 與佇列、身分改回去、滿意歸零）。沒有契約是落空。
//   效果 order          { order_kind, place?, hours? }（工單寫 kind：效果自己的 kind 是效果的名字，所以指令的種類寫在 order_kind）：直接塞一條指令（事件用）；契約支配關掉時只收差事、工作、回報，戀人不收出借。沒有契約是落空。
//   效果 order_done     { order_kind?, order? }：把一條照做中或強制的指令收尾（和 completeDraft 同一套；事件做完之後用）。
//   效果 bridge_right   { holder, level: read／limit, source }：記一筆讀取或限制級的橋權（只有紀錄，掃橋時顯示）。
//   條件 contract       { side: bound／holder, type?, holder_kind? }：bound 是主角身上有管理級的契約；holder 是主角持有的（下一張）。
//   條件 order_pending  { order_kind? }（工單寫 kind?：條件自己的 kind 是條件的名字，所以指令的種類寫在 order_kind）：佇列裡有還沒了結的指令。

import type { Condition, ConditionCtx, Effect, EffectCtx, EffectStepCtx, Kernel } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import { completePlan, endPlan, pushOrderPlan, resolveHolder, signPlan } from './plans'
import type { ContractRule, ContractType, Holder, OrderKind, Place, Relation, RightLevel } from './model'
import {
  CONTRACT_CONDITION, END_EFFECT, HOLDER_KINDS, ORDER_DONE_EFFECT, ORDER_EFFECT, ORDER_KINDS, ORDER_NAME, OWNER, PENDING_CONDITION, RELATIONS, RIGHT_EFFECT, RIGHT_LEVELS,
  RULE_TYPES, SIGN_EFFECT, CONTRACT_TYPES, allowedKinds, deriveWeekday, extChange, extOf, isActive, isContractType, isOrderKind, isRelation, isRuleType, isText, nowOf, pcOf,
} from './model'

const unknownFields = (raw: Record<string, unknown>, allowed: readonly string[]): string[] =>
  Object.keys(raw).filter((f) => f !== 'kind' && f !== 'asked' && !allowed.includes(f)).map((f) => `${f}：沒有這個欄位（可以寫：${allowed.join('、')}）`)

const placeProblems = (v: unknown, at: string): string[] => {
  if (!isRecord(v)) return [`${at} 要是 { district?, block?, facility? }`]
  const p: string[] = []
  for (const f of ['district', 'block', 'facility']) if (v[f] !== undefined && !isText(v[f])) p.push(`${at}.${f} 要是字串`)
  for (const f of Object.keys(v)) if (!['district', 'block', 'facility'].includes(f)) p.push(`${at}.${f}：沒有這個欄位`)
  return p
}

interface SignEffect extends Effect {
  holder: unknown
  type: ContractType
  orders?: OrderKind[]
  debt?: number
  days?: number
  relation?: Relation
  rules?: ContractRule[]
  report_weekday?: number
}
interface EndEffect extends Effect { how: string }
interface OrderEffect extends Effect { order_kind: OrderKind; place?: Place; hours?: number }
interface DoneEffect extends Effect { order_kind?: OrderKind; order?: string }
interface RightEffect extends Effect { holder: unknown; level: RightLevel; source: string }
interface ContractCondition extends Condition { side: 'bound' | 'holder'; type?: ContractType; holder_kind?: Holder['kind'] }
interface PendingCondition extends Condition { order_kind?: OrderKind }

export function installEffects(k: Kernel): void {
  // ---- contract_sign ----
  k.effects.register<SignEffect>({
    kind: SIGN_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx: EffectCtx) {
      const p: string[] = []
      const r = resolveHolder(k, ctx.state, raw.holder)
      if (r.problem) p.push(`holder：${r.problem}`)
      if (!isContractType(raw.type)) p.push(`type 只能是 ${CONTRACT_TYPES.join('、')}`)
      if (raw.orders !== undefined && !(Array.isArray(raw.orders) && raw.orders.every(isOrderKind))) p.push(`orders 要是指令種類的陣列（${ORDER_KINDS.join('、')}）`)
      if (raw.debt !== undefined && !(isSafeInt(raw.debt) && raw.debt >= 0)) p.push('debt 要是 0 以上的整數')
      if (raw.type === 'debt' && !(isSafeInt(raw.debt) && raw.debt > 0)) p.push('債務契約要寫 debt（大於 0 的整數）')
      if (raw.type !== 'debt' && raw.debt !== undefined) p.push('只有債務契約有 debt')
      if (raw.days !== undefined && !(isSafeInt(raw.days) && raw.days >= 1 && raw.days <= 36500)) p.push('days 要是 1～36500 的整數')
      if (raw.relation !== undefined && !isRelation(raw.relation)) p.push(`relation 只能是 ${RELATIONS.join('、')}`)
      if (raw.rules !== undefined) {
        if (!Array.isArray(raw.rules)) p.push('rules 要是 { kind, value } 的陣列')
        else raw.rules.forEach((x, i) => {
          if (!isRecord(x) || !isRuleType(x.kind)) p.push(`rules[${i}].kind 只能是 ${RULE_TYPES.join('、')}`)
          else if (!(isText(x.value) || (typeof x.value === 'number' && Number.isFinite(x.value)))) p.push(`rules[${i}].value 要是字串或數字`)
        })
      }
      if (raw.report_weekday !== undefined && !(isSafeInt(raw.report_weekday) && raw.report_weekday >= 0 && raw.report_weekday <= 6)) p.push('report_weekday 要是 0～6（0 是週一）')
      return [...p, ...unknownFields(raw, ['holder', 'type', 'orders', 'debt', 'days', 'relation', 'rules', 'report_weekday'])]
    },
    clamp(e, ctx: EffectStepCtx) {
      if (ctx.actor !== pcOf(ctx.state)) return { effect: null, note: { from: e.type, to: null, notice: '只有你自己能簽成契約人，這一筆沒有算。' } }
      if (extOf(ctx.state).mine) return { effect: null, note: { from: e.type, to: null, notice: '你身上已經有一份管理級的契約了，這一份沒有簽成。' } }
      return { effect: e }
    },
    toChanges: (e, ctx) => signPlan(k, ctx.state, ctx.actor, { ...e, holder: resolveHolder(k, ctx.state, e.holder).holder!, weekday: deriveWeekday(ctx.state) })?.changes ?? [],
    describe: (e, ctx) => signPlan(k, ctx.state, ctx.actor, { ...e, holder: resolveHolder(k, ctx.state, e.holder).holder!, weekday: deriveWeekday(ctx.state) })?.text ?? '什麼也沒有簽。',
  })

  // ---- contract_end ----
  k.effects.register<EndEffect>({
    kind: END_EFFECT, owner: OWNER, ai: false,
    validate: (raw) => [...(isText(raw.how) && raw.how.length <= 40 ? [] : ['how 要是一句短的代號（例：payoff、expired、released）']), ...unknownFields(raw, ['how'])],
    clamp: (e, ctx) => (extOf(ctx.state).mine && ctx.actor === pcOf(ctx.state) ? { effect: e } : { effect: null }),
    toChanges: (e, ctx) => endPlan(ctx.state, ctx.actor, e.how)?.changes ?? [],
    describe: (e, ctx) => endPlan(ctx.state, ctx.actor, e.how)?.text ?? '身上沒有契約可以解。',
  })

  // ---- order ----
  const orderProblem = (ctx: EffectStepCtx, kind: OrderKind): string | null => {
    const c = extOf(ctx.state).mine
    if (!c) return '你身上沒有管理級的契約，沒有人能下指令。'
    if (!allowedKinds(ctx.state, c, !ctx.state.rules.contentOff.includes('contract_dom')).includes(kind)) return `「${ORDER_NAME[kind]}」這一類的指令現在不會出現。`
    return null
  }
  k.effects.register<OrderEffect>({
    kind: ORDER_EFFECT, owner: OWNER, ai: false,
    validate(raw) {
      const p: string[] = []
      if (!isOrderKind(raw.order_kind)) p.push(`order_kind 只能是 ${ORDER_KINDS.join('、')}`)
      if (raw.place !== undefined) p.push(...placeProblems(raw.place, 'place'))
      if (raw.hours !== undefined && !(typeof raw.hours === 'number' && Number.isFinite(raw.hours) && raw.hours > 0 && raw.hours <= 24 * 90)) p.push('hours 要是大於 0 的小時數')
      return [...p, ...unknownFields(raw, ['order_kind', 'place', 'hours'])]
    },
    clamp: (e, ctx) => (orderProblem(ctx, e.order_kind) ? { effect: null } : { effect: e }),
    toChanges: (e, ctx) => pushOrderPlan(k, ctx.state, { kind: e.order_kind, now: nowOf(ctx.state), ...(e.place ? { place: e.place } : {}), ...(e.hours !== undefined ? { hours: e.hours } : {}) })?.changes ?? [],
    describe: (e, ctx) => pushOrderPlan(k, ctx.state, { kind: e.order_kind, now: nowOf(ctx.state), ...(e.place ? { place: e.place } : {}), ...(e.hours !== undefined ? { hours: e.hours } : {}) })?.text ?? '沒有人下指令。',
  })

  // ---- order_done ----
  const doneTarget = (ctx: EffectStepCtx, e: DoneEffect) => {
    const c = extOf(ctx.state).mine
    return c?.queue.filter((o) => (o.state === 'doing' || o.state === 'forced') && (e.order === undefined || o.id === e.order) && (e.order_kind === undefined || o.kind === e.order_kind)).sort((a, b) => a.issued - b.issued)[0]
  }
  k.effects.register<DoneEffect>({
    kind: ORDER_DONE_EFFECT, owner: OWNER, ai: false,
    validate(raw) {
      const p: string[] = []
      if (raw.order_kind !== undefined && !isOrderKind(raw.order_kind)) p.push(`order_kind 只能是 ${ORDER_KINDS.join('、')}`)
      if (raw.order !== undefined && !isText(raw.order)) p.push('order 要是指令的 id')
      return [...p, ...unknownFields(raw, ['order_kind', 'order'])]
    },
    clamp: (e, ctx) => (doneTarget(ctx, e) ? { effect: e } : { effect: null }),
    toChanges: (e, ctx) => {
      const t = doneTarget(ctx, e)
      return t ? (completePlan(k, ctx.state, ctx.actor, t.id)?.changes ?? []) : []
    },
    describe: (e, ctx) => {
      const t = doneTarget(ctx, e)
      return t ? (completePlan(k, ctx.state, ctx.actor, t.id)?.lines[0] ?? '') : '沒有進行中的指令可以收尾。'
    },
  })

  // ---- bridge_right ----
  k.effects.register<RightEffect>({
    kind: RIGHT_EFFECT, owner: OWNER, ai: false,
    validate(raw, ctx) {
      const p: string[] = []
      const r = resolveHolder(k, ctx.state, raw.holder)
      if (r.problem) p.push(`holder：${r.problem}`)
      if (!(RIGHT_LEVELS as readonly unknown[]).includes(raw.level)) p.push(`level 只能是 ${RIGHT_LEVELS.join('、')}（管理級是契約，用 ${SIGN_EFFECT}）`)
      if (!(isText(raw.source) && raw.source.length <= 40)) p.push('source 要是一句短的代號（例：loan、insurance、subscription）')
      return [...p, ...unknownFields(raw, ['holder', 'level', 'source'])]
    },
    clamp(e, ctx) {
      const h = resolveHolder(k, ctx.state, e.holder).holder
      if (!h) return { effect: null }
      const dup = extOf(ctx.state).rights.some((r) => r.level === e.level && r.source === e.source && r.holder.kind === h.kind && r.holder.name === h.name)
      return { effect: dup ? null : e }
    },
    toChanges(e, ctx) {
      const ext = extOf(ctx.state)
      ext.rights.push({ holder: resolveHolder(k, ctx.state, e.holder).holder!, level: e.level, source: e.source })
      return [extChange(ext)]
    },
    describe: (e, ctx) => `${resolveHolder(k, ctx.state, e.holder).holder?.name ?? '有人'}拿到了你的${e.level === 'read' ? '讀取' : '限制'}級橋權。`,
  })

  // ---- 條件 ----
  k.conditions.register<ContractCondition>({
    kind: CONTRACT_CONDITION, owner: OWNER,
    validate(raw) {
      const p: string[] = []
      if (raw.side !== 'bound' && raw.side !== 'holder') p.push("side 只能是 'bound'（主角是契約人）或 'holder'（主角是持約人）")
      if (raw.type !== undefined && !isContractType(raw.type)) p.push(`type 只能是 ${CONTRACT_TYPES.join('、')}`)
      if (raw.holder_kind !== undefined && !(HOLDER_KINDS as readonly unknown[]).includes(raw.holder_kind)) p.push(`holder_kind 只能是 ${HOLDER_KINDS.join('、')}`)
      return p
    },
    test(c, { state }: ConditionCtx) {
      const ext = extOf(state)
      if (c.side === 'bound') {
        const m = ext.mine
        return !!m && (c.type === undefined || m.type === c.type) && (c.holder_kind === undefined || m.holder.kind === c.holder_kind)
      }
      return Object.values(ext.held).some((h) => isRecord(h) && (c.type === undefined || h.type === c.type) && (c.holder_kind === undefined || h.holder_kind === c.holder_kind))
    },
  })

  k.conditions.register<PendingCondition>({
    kind: PENDING_CONDITION, owner: OWNER,
    validate: (raw) => (raw.order_kind === undefined || isOrderKind(raw.order_kind) ? [] : [`order_kind 只能是 ${ORDER_KINDS.join('、')}`]),
    test: (c, { state }: ConditionCtx) => !!extOf(state).mine?.queue.some((o) => isActive(o) && (c.order_kind === undefined || o.kind === c.order_kind)),
  })
}
