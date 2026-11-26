// L4 規則核心：條件的登錄表（EVENTS 2.2 節的 requires）。條件全部是引擎的狀態，AI 不參與。
// 寫法只有一種：{ kind, ...欄位 }；組合用 all、any、not。功能註冊自己那塊狀態的條件（沉溺、敵對值、親密度……）。

import type { ActorId, AttrId, FlagValue, GameState, SegmentId, Weekday } from '../types'
import { ATTR_IDS, SEGMENT_IDS } from '../types'
import type { ContentRegistry } from '../content/registry'
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
  /**
   * 說明句（M4 收尾修正批；使用者 2026-11-26：擋住的原因能寫成自然的句子）：這個條件「要什麼」，一句完整的話（不帶句點）。
   * 例：「回音的好感要在 20 以上」、「要有 3 件急救包」。條件不成立時畫面問 ConditionRegistry.explain，把它接成擋住的原因；
   * 沒寫就沒有說明（explain 回 null，呼叫的人退回自己的句子）。唯讀，不改狀態。
   */
  describe?(cond: C, ctx: ConditionCtx): string | null
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

  /**
   * 這個條件現在擋住的原因（一句自然的話）：成立回傳 null。
   * all 取第一個不成立的那一條；any 把每一條要什麼用「，或」接起來（都不成立才擋）；not 與沒有 describe 的種類回傳 null（呼叫的人退回自己的句子）。
   */
  explain(cond: Condition | undefined | null, ctx: ConditionCtx): string | null {
    if (!cond || this.test(cond, ctx)) return null
    if (cond.kind === 'all') {
      for (const c of cond.of as Condition[]) {
        if (!this.test(c, ctx)) return this.explain(c, ctx)
      }
      return null
    }
    if (cond.kind === 'any') {
      const parts = (cond.of as Condition[]).map((c) => this.explain(c, ctx))
      return parts.every((p): p is string => p !== null) && parts.length > 0 ? `${parts.join('，或')}` : null
    }
    if (cond.kind === 'not') return null
    const def = this.defs.get(cond.kind)
    return def?.describe ? def.describe(cond, ctx) : null
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

/** 「要在 min 以上」「要在 max 以下」「要在 min 到 max 之間」：條件說明句的尾巴（M4 收尾修正批；ConditionDef.describe）。 */
export const rangeText = (c: { min?: number; max?: number }): string =>
  c.min !== undefined && c.max !== undefined ? `要在 ${c.min} 到 ${c.max} 之間` : c.min !== undefined ? `要在 ${c.min} 以上` : c.max !== undefined ? `要在 ${c.max} 以下` : '要符合條件'
const rangeOk = (raw: Record<string, unknown>) => (['min', 'max'] as const).every((k) => raw[k] === undefined || typeof raw[k] === 'number')

export function registerCoreConditions(reg: ConditionRegistry, content?: Pick<ContentRegistry, 'get'>): void {
  reg.register<Condition & { key: string; eq?: FlagValue }>({
    kind: 'flag', owner: 'core',
    validate: (raw) => (typeof raw.key === 'string' && raw.key ? [] : ['key 要是字串']),
    // 沒寫 eq：旗標存在而且不是 false
    test: (c, { state }) => (c.eq === undefined ? state.flags[c.key] !== undefined && state.flags[c.key] !== false : state.flags[c.key] === c.eq),
    describe: (c) => (c.eq === undefined || c.eq === true ? `還沒有發生過「${c.key}」那件事` : `「${c.key}」要是 ${String(c.eq)}`),
  })

  reg.register<Condition & { key: string; min?: number; max?: number }>({
    kind: 'counter', owner: 'core',
    validate: (raw) => (typeof raw.key === 'string' && rangeOk(raw) ? [] : ['要有 key；min、max 要是數字']),
    test: (c, { state }) => inRange(state.counters[c.key] ?? 0, c),
    describe: (c) => `「${c.key}」的次數${rangeText(c)}`,
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
    describe: (c) => `${(content?.get('attribute', c.attr) as { name?: string } | undefined)?.name ?? c.attr}${rangeText(c)}`,
  })

  reg.register<Condition & { skill: string; min?: number; max?: number }>({
    kind: 'skill', owner: 'core',
    validate: (raw) => (typeof raw.skill === 'string' && rangeOk(raw) ? [] : ['要有 skill；min、max 要是數字']),
    test: (c, { state, actor }) => {
      const a = state.actors[actor ?? state.pc ?? '']
      return !!a && inRange(a.skills[c.skill] ?? 0, c)
    },
    describe: (c) => `${(content?.get('skill', c.skill) as { name?: string } | undefined)?.name ?? c.skill}${rangeText(c)}`,
  })

  reg.register<Condition & { wallet: 'cred' | 'cash' | 'total'; min?: number; max?: number }>({
    kind: 'money', owner: 'core',
    validate: (raw) => (['cred', 'cash', 'total'].includes(raw.wallet as string) && rangeOk(raw) ? [] : ['wallet 只能是 cred、cash、total；min、max 要是數字']),
    test: (c, { state }) => inRange(c.wallet === 'total' ? state.money.cred + state.money.cash : state.money[c.wallet], c),
    describe: (c) => `${c.wallet === 'cred' ? '帳戶' : c.wallet === 'cash' ? '現金' : '帳戶加現金'}${rangeText(c)}`,
  })

  // has_item：id（那一種東西）或 tag（物品或設計圖的 tags 裡有這個字的任何東西；M4-followups-2 第 11 項）；兩個都寫要兩個都對上。min 是件數（沒寫 1）
  reg.register<Condition & { id?: string; tag?: string; min?: number }>({
    kind: 'has_item', owner: 'core',
    validate: (raw) => [
      ...(raw.id === undefined && raw.tag === undefined ? ['要有物品的 id，或物品標籤 tag'] : []),
      ...(raw.id !== undefined && typeof raw.id !== 'string' ? ['id 要是物品的 id'] : []),
      ...(raw.tag !== undefined && !(typeof raw.tag === 'string' && raw.tag) ? ['tag 要是物品標籤'] : []),
    ],
    test: (c, { state }) => {
      const tagged = (id: string): boolean => {
        if (c.tag === undefined) return true
        for (const kind of ['item', 'blueprint'] as const) {
          const tags = (content?.get(kind, id) as { tags?: unknown } | undefined)?.tags
          if (Array.isArray(tags) && tags.includes(c.tag)) return true
        }
        return false
      }
      return state.inventory.reduce((n, s) => ((c.id === undefined || s.id === c.id) && tagged(s.id) ? n + s.qty : n), 0) >= (c.min ?? 1)
    },
    describe: (c) => {
      const what = c.id !== undefined ? ((content?.get('item', c.id) ?? content?.get('blueprint', c.id)) as { name?: string } | undefined)?.name ?? c.id : `帶「${c.tag}」標籤的東西`
      return `要有${c.min !== undefined && c.min > 1 ? ` ${c.min} 件` : ''}${what}`
    },
  })
}
