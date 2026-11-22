// L4 規則核心：條件的登錄表（EVENTS 2.2 節的 requires）。條件全部是引擎的狀態，AI 不參與。
// 寫法只有一種：{ kind, ...欄位 }；組合用 all、any、not。功能註冊自己那塊狀態的條件（沉溺、敵對值、親密度……）。

import type { ActorId, AttrId, FlagValue, GameState, SegmentId, Weekday } from '../types'
import { ATTR_IDS, SEGMENT_IDS } from '../types'
import type { Probe } from '../state/probe'
import { isRecord } from '../util/sanitize'
import type { TimeRules } from '../util/time'
import { segmentOf, segmentWeekdayOf } from '../util/time'
import type { StatRegistry } from './stats'

export interface Condition {
  kind: string
  [field: string]: unknown
}

export interface ConditionCtx {
  state: GameState
  /** 看誰的屬性與基本功；沒給就是主角 */
  actor?: ActorId
  stats: StatRegistry
  timeRules: TimeRules
}

export interface ConditionDef<C extends Condition = Condition> {
  kind: string
  owner: string
  validate(raw: Record<string, unknown>): string[]
  test(cond: C, ctx: ConditionCtx): boolean
}

export class ConditionRegistry {
  private defs = new Map<string, ConditionDef>()

  constructor(private probe: Probe) {}

  register<C extends Condition>(def: ConditionDef<C>): void {
    if (this.defs.has(def.kind)) throw new Error(`條件種類重複註冊：${def.kind}（已經由 ${this.defs.get(def.kind)!.owner} 註冊）`)
    this.defs.set(def.kind, def as unknown as ConditionDef)
    this.probe.emit('core/rules/conditions', 'registry.register', { registry: 'conditions', id: def.kind, owner: def.owner })
  }

  kinds(): string[] {
    return [...this.defs.keys()]
  }

  /** 格式檢查（內容載入時用）。 */
  validate(raw: unknown, path = 'requires'): string[] {
    if (!isRecord(raw)) return [`${path}：要是一個物件`]
    if (raw.kind === 'all' || raw.kind === 'any') {
      if (!Array.isArray(raw.of)) return [`${path}.of：要是條件的陣列`]
      return raw.of.flatMap((c, i) => this.validate(c, `${path}.of[${i}]`))
    }
    if (raw.kind === 'not') return this.validate(raw.of, `${path}.of`)
    const def = typeof raw.kind === 'string' ? this.defs.get(raw.kind) : undefined
    if (!def) return [`${path}.kind：沒有 ${JSON.stringify(raw.kind)} 這種條件`]
    return def.validate(raw).map((p) => `${path}：${p}`)
  }

  test(cond: Condition | undefined | null, ctx: ConditionCtx): boolean {
    if (!cond) return true
    if (cond.kind === 'all') return (cond.of as Condition[]).every((c) => this.test(c, ctx))
    if (cond.kind === 'any') return (cond.of as Condition[]).some((c) => this.test(c, ctx))
    if (cond.kind === 'not') return !this.test(cond.of as Condition, ctx)
    const def = this.defs.get(cond.kind)
    if (!def) throw new Error(`沒有 ${cond.kind} 這種條件`)
    return def.test(cond, ctx)
  }
}

const inRange = (v: number, c: { min?: number; max?: number }) => (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max)
const rangeOk = (raw: Record<string, unknown>) => (['min', 'max'] as const).every((k) => raw[k] === undefined || typeof raw[k] === 'number')

export function registerCoreConditions(reg: ConditionRegistry): void {
  reg.register<Condition & { key: string; eq?: FlagValue }>({
    kind: 'flag', owner: 'core',
    validate: (raw) => (typeof raw.key === 'string' && raw.key ? [] : ['key 要是字串']),
    // 沒寫 eq：旗標存在而且不是 false
    test: (c, { state }) => (c.eq === undefined ? state.flags[c.key] !== undefined && state.flags[c.key] !== false : state.flags[c.key] === c.eq),
  })

  reg.register<Condition & { key: string; min?: number; max?: number }>({
    kind: 'counter', owner: 'core',
    validate: (raw) => (typeof raw.key === 'string' && rangeOk(raw) ? [] : ['要有 key；min、max 要是數字']),
    test: (c, { state }) => inRange(state.counters[c.key] ?? 0, c),
  })

  reg.register<Condition & { segment?: SegmentId[]; weekday?: Weekday[]; min_day?: number }>({
    kind: 'time', owner: 'core',
    validate: (raw) => [
      ...(raw.segment === undefined || (Array.isArray(raw.segment) && raw.segment.every((s) => (SEGMENT_IDS as readonly unknown[]).includes(s))) ? [] : [`segment 要是時段 id 的陣列（${SEGMENT_IDS.join('、')}）`]),
      ...(raw.weekday === undefined || (Array.isArray(raw.weekday) && raw.weekday.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) ? [] : ['weekday 要是 0～6 的陣列（0 是週一）']),
    ],
    // 星期照時段算：深夜跨過午夜的那一段算前一天（「週四深夜」到週五凌晨 3 點之前都成立；CORE_RULES 7.4 節）
    test: (c, { state, timeRules }) =>
      (!c.segment || c.segment.includes(segmentOf(state.time, timeRules))) && (!c.weekday || c.weekday.includes(segmentWeekdayOf(state.time, timeRules))) && (c.min_day === undefined || state.time.day >= c.min_day),
  })

  reg.register<Condition & { attr: AttrId; min?: number; max?: number }>({
    kind: 'attr', owner: 'core',
    validate: (raw) => ((ATTR_IDS as readonly unknown[]).includes(raw.attr) && rangeOk(raw) ? [] : [`attr 要是屬性的 id（${ATTR_IDS.join('、')}）；min、max 要是數字`]),
    test: (c, { state, actor, stats }) => {
      const id = actor ?? state.pc
      return !!id && !!state.actors[id] && inRange(stats.effectiveAttr(state, id, c.attr), c)
    },
  })

  reg.register<Condition & { skill: string; min?: number; max?: number }>({
    kind: 'skill', owner: 'core',
    validate: (raw) => (typeof raw.skill === 'string' && rangeOk(raw) ? [] : ['要有 skill；min、max 要是數字']),
    test: (c, { state, actor }) => {
      const a = state.actors[actor ?? state.pc ?? '']
      return !!a && inRange(a.skills[c.skill] ?? 0, c)
    },
  })

  reg.register<Condition & { wallet: 'cred' | 'cash' | 'total'; min?: number; max?: number }>({
    kind: 'money', owner: 'core',
    validate: (raw) => (['cred', 'cash', 'total'].includes(raw.wallet as string) && rangeOk(raw) ? [] : ['wallet 只能是 cred、cash、total；min、max 要是數字']),
    test: (c, { state }) => inRange(c.wallet === 'total' ? state.money.cred + state.money.cash : state.money[c.wallet], c),
  })

  reg.register<Condition & { id: string; min?: number }>({
    kind: 'has_item', owner: 'core',
    validate: (raw) => (typeof raw.id === 'string' ? [] : ['要有物品的 id']),
    test: (c, { state }) => state.inventory.reduce((n, s) => (s.id === c.id ? n + s.qty : n), 0) >= (c.min ?? 1),
  })
}
