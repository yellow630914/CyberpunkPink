// 驗收測試：dev/work/M4-contract.md（cpp-feature）。規格：LEWD_SYSTEM 第 7 節；LIFE 3.4 節；EVENTS 4.5 節；DOWNTIME 4.2 節；dev/adr/0019 第八節與 P27～P30。
// 內容一律用測試自帶的最小假資料：
//   contract_rule  只在要驗「資料蓋掉預設」時才放；其餘用內建的預設
//   event_scope    contract 那一筆（triggers 只有 order：指令的事件由導演挑）；只在裝了導演的那幾條放
//   faction        eden（驗 holder 寫成勢力 id）
// cyber_lock、hostility、at_home 用測試自己註冊的假貨（真的在 features/cyberware、security、rest）；commission 是一個替身活動（旗標 in_comm 開著就在副本裡）。
// 時間：測試從第 3 天 10:00 開始；第 7 天是週一（星期 = 天數 % 7，0 是週一）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentPack, Feature, ReportDraft } from '../../src'
import type { Order } from '../../src/features/contract'
import { ActionBlocked, ContentError, Rng, effectCtx, toMinutes } from '../../src'
import { characterFeature } from '../../src/features/character'
import {
  DEFAULT_CONTRACT_RULES, arriveBlock, arriveDraft, askOrderBlock, askOrderDraft, boundView, chooseBlock, chooseDraft, completeBlock, completeDraft, contractFeature, contractOf,
  contractRules, coverMarkBlock, coverMarkDraft, payoffBlock, payoffDraft, payoffQuote, resistQuote, scanAnswer,
} from '../../src/features/contract'
import { FEATURES } from '../../src/features'
import { directorFeature } from '../../src/features/director'
import { lewdFeature } from '../../src/features/lewd'
import { makeGame } from '../../src/testkit'

type Rec = Record<string, any>
const DAY = 1440
afterEach(() => { vi.restoreAllMocks() })

// ---- 假資料 ----

const EDEN: Rec = { kind: 'eden', name: '伊甸園', faction: 'eden' }
const WHITE: Rec = { kind: 'person', name: '白衣', npc: 'npc_white', place: { district: 'd_hive', block: 'b_street', facility: 'F1' } }
const HIVE = { district: 'd_hive', block: 'b_street' }

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    faction: [{ id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }],
    item: [{ id: 'it_collar', name: '遮標頸環', desc: '和膚色一樣的薄環貼著後頸。', category: 'accessory', grade: 1, size: 0, legal: 'free', tags: ['mark_cover'] }, { id: 'it_rock', name: '石頭', desc: '一顆石頭。', category: 'misc', grade: 1, size: 0, legal: 'free' }],
  }
  patch(c)
  return { id: 'contract_test', content: c as unknown as ContentPack['content'] }
}
const scopePack = (extra: Rec = {}): ContentPack => pack((c) => {
  c.event_scope = [{ id: 'contract', triggers: { order: 1 }, priority: 2, daily_roll: { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }, satisfaction_mult: [[0, 1.5], [30, 1.0], [70, 0.6]], queue_max: 3, lost: 'defer', ...extra }]
})

// ---- 假貨 ----

/** 假的 cyber_lock、hostility 效果（把被叫到的記在旗標上）、at_home 條件（旗標 home）、替身活動 commission（旗標 in_comm）。 */
const fakes = (o: { lock?: boolean; hostility?: boolean; home?: boolean; commission?: boolean } = {}): Feature[] => {
  const out: Feature[] = []
  if (o.lock !== false) {
    out.push({
      id: 't_lock',
      install(k) {
        k.effects.register<{ kind: string; on: boolean; hours?: number; why?: string }>({
          kind: 'cyber_lock', owner: 't_lock', ai: false,
          validate: (raw) => (typeof raw.on === 'boolean' ? [] : ['on 要是布林值']),
          toChanges: (e) => [{ op: 'flag', key: `locked:${e.hours}:${e.why}`, value: true }],
          describe: () => '鎖住了一件義體',
        })
      },
    })
  }
  if (o.hostility !== false) {
    out.push({
      id: 't_hostility',
      install(k) {
        k.effects.register<{ kind: string; key: string; amount: number }>({
          kind: 'hostility', owner: 't_hostility', ai: false,
          validate: (raw) => (typeof raw.key === 'string' && typeof raw.amount === 'number' ? [] : ['key、amount 要有']),
          toChanges: (e) => [{ op: 'flag', key: `hostility:${e.key}:${e.amount}`, value: true }],
          describe: () => '敵對值上升',
        })
      },
    })
  }
  if (o.home !== false) {
    out.push({
      id: 't_home',
      install(k) {
        k.conditions.register({ kind: 'at_home', owner: 't_home', validate: () => [], test: (_c, { state }) => state.flags.home === true })
      },
    })
  }
  if (o.commission !== false) {
    out.push({
      id: 't_commission',
      install(k) {
        k.activity.define({
          kind: 'commission', owner: 't_commission', order: 90,
          active: (s) => (s.flags.in_comm === true ? { id: 'cm1', label: '委託副本' } : null),
          allow: ['commit:test.'], reason: () => '委託副本進行中，先把它做完。',
        })
      },
    })
  }
  return out
}

interface Opts {
  pc?: Rec
  money?: { cred: number; cash: number }
  pack?: ContentPack
  features?: Feature[]
  fake?: { lock?: boolean; hostility?: boolean; home?: boolean; commission?: boolean }
  rules?: Record<string, any>
  seed?: number
  director?: boolean
}
const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 }
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: o.features ?? [characterFeature, lewdFeature, ...(o.director ? [directorFeature] : []), contractFeature, ...fakes(o.fake)],
    content: [o.pack ?? (o.director ? scopePack() : pack())], seed: o.seed ?? 7,
    pc: { hp: 40, skills: {}, ext: { bridge: { ...BRIDGE } }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 }, location: { district: 'test', block: 'empty_room' }, ...(o.rules ? { rules: o.rules as never } : {}) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const toTime = (g: G, day: number, hour: number, minute = 0) => advance(g, (day - 1) * DAY + hour * 60 + minute - toMinutes(g.state.time))
const now = (g: G) => toMinutes(g.state.time)
const reports = (g: G, action: string) => g.state.reports.filter((r) => r.action === action)
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
/** 一串效果直接套到狀態上。 */
const fx = (g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin', actor = 'pc') => {
  const ctx = effectCtx(g.k, g.state, { source, actor })
  const errors = g.k.effects.validate(effects as never, ctx)
  if (errors.length > 0) return { errors, changes: [] as ReportDraft['changes'], clamps: [] as any[], lines: [] as string[] }
  const res = g.k.effects.resolve(effects as never, ctx)
  if (res.errors.length === 0) g.commit(draft(res.changes, 'test.effect'))
  return { errors: res.errors, changes: res.changes, clamps: res.clamps, lines: res.lines }
}
const sign = (g: G, e: Rec = {}) => fx(g, [{ kind: 'contract_sign', holder: WHITE, type: 'private', report_weekday: 2, ...e }])
const order = (g: G, kind: string, e: Rec = {}) => fx(g, [{ kind: 'order', order_kind: kind, ...e }])
/** 第 n 條指令的 id（簽約花掉一個流水號，指令從 o2 起算）。 */
const O = (n: number): string => `o${n + 1}`
const mine = (g: G) => contractOf(g.state)!
function q(g: G): Order[]
function q(g: G, id: string): Order
function q(g: G, id?: string): Order | Order[] {
  return id ? mine(g).queue.find((o) => o.id === id)! : mine(g).queue
}
const sat = (g: G) => g.state.meters.satisfaction?._ ?? 0
const view = (g: G) => boundView(g.k, g.state)!
const withDice = <T>(v: number | number[], fn: () => T): T => {
  const spy = vi.spyOn(Rng.prototype, 'next')
  if (Array.isArray(v)) {
    for (const x of v.slice(0, -1)) spy.mockReturnValueOnce(x)
    spy.mockReturnValue(v[v.length - 1]!)
  } else spy.mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
// 骰面：自然骰 = 1 + floor(next × 20)
const NAT20 = 0.99
const NAT10 = 0.45
const NAT1 = 0
const setSat = (g: G, n: number) => g.commit(draft([{ op: 'meter', kind: 'satisfaction', key: '_', set: n }], 'test.sat'))
const goTo = (g: G, to: Rec) => g.commit(draft([{ op: 'location', to }], 'test.go'))
const flag = (g: G, key: string, value = true) => g.commit(draft([{ op: 'flag', key, value }], 'test.flag'))

// ---- 規則與格式 ----

describe('規則與格式', () => {
  it('預設的規則表照設計書：抗拒 12／4／÷10／沉溺 60 +2、80 +4／關係 −4；滿意 +5／+8／−5／−10；贖身 ×1.5、談到 ×1.2；資料可以蓋掉', () => {
    const g = make()
    expect(contractRules(g.k)).toEqual(DEFAULT_CONTRACT_RULES)
    expect(DEFAULT_CONTRACT_RULES.resist).toEqual({ base: 12, manage: 4, docility_div: 10, sink: { 60: 2, 80: 4 }, relation: -4 })
    expect(DEFAULT_CONTRACT_RULES.satisfaction).toMatchObject({ start: 50, comply: 5, asked: 8, resist: -5, overdue: -10 })
    expect(DEFAULT_CONTRACT_RULES.docility_every).toBe(3)
    expect(DEFAULT_CONTRACT_RULES.buyout).toEqual({ mult: 1.5, talk_at: 80, talk_dc: 16, talk_mult: 1.2 })
    expect(DEFAULT_CONTRACT_RULES.income_keep).toBe(0.1)
    expect(DEFAULT_CONTRACT_RULES.crossed_out_mult).toBe(0.5)
    expect(DEFAULT_CONTRACT_RULES.deadline_hours).toMatchObject({ errand: [24, 72], modify: 48, serve: [4, 12], lend: 24 })
    const g2 = make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', resist: { base: 10 }, docility_every: 5, overdue: { load: { weight: 0 } } }] }) })
    const r = contractRules(g2.k)
    expect(r.resist).toEqual({ ...DEFAULT_CONTRACT_RULES.resist, base: 10 })
    expect(r.docility_every).toBe(5)
    expect(r.overdue.load).toEqual({ weight: 0, share: 0.5 })
    expect(r.overdue.lock).toEqual(DEFAULT_CONTRACT_RULES.overdue.lock)
  })

  it('格式不對的資料載入時被擋', () => {
    const bad = (rule: Rec) => () => make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', ...rule }] }) })
    expect(bad({ kind_weights: { alien: { errand: 1 } } })).toThrow(/alien/)
    expect(bad({ kind_weights: { eden: { dance: 1 } } })).toThrow(/dance/)
    expect(bad({ deadline_hours: { errand: 'soon' } })).toThrow(/errand/)
    expect(bad({ resist: { base: 'x' } })).toThrow(/base/)
    expect(bad({ income_keep: 2 })).toThrow(/income_keep/)
    expect(bad({ buyout: { mult: -1 } })).toThrow(/mult/)
    expect(bad({ nothing: 1 })).toThrow(ContentError)
    expect(() => make()).not.toThrow()
  })

  it('範圍 contract 的資料（event_scope）蓋掉預設的頻率與倍率；沒有導演時用預設', () => {
    const g = make({ director: true, pack: scopePack({ daily_roll: { eden: 0.9, gang: 0.3, corp: 0.25, person: [0.2, 0.4] }, queue_max: 2 }) })
    sign(g, { holder: EDEN })
    expect(view(g).queue_max).toBe(2)
    expect(view(g).daily_chance).toBeCloseTo(0.9, 9)
    const plain = make()
    sign(plain, { holder: EDEN })
    expect(view(plain).queue_max).toBe(3)
    expect(view(plain).daily_chance).toBeCloseTo(0.4, 9)
  })
})

// ---- 簽與解 ----

describe('簽與解', () => {
  it('contract_sign：mine 建好、身分 bound、記下原本的身分、滿意 50；報告 contract.sign', () => {
    const g = make({ pc: { ext: { bridge: { ...BRIDGE }, identity: { class: 'member', extra: 1 } } } })
    const r = sign(g, { holder: WHITE, type: 'private', orders: ['serve', 'report'], relation: 'play', rules: [{ kind: 'curfew', value: 22 }], days: 10 })
    expect(r.errors).toEqual([])
    const c = mine(g)
    expect(c).toMatchObject({ id: 'c1', type: 'private', orders: ['serve', 'report'], relation: 'play', was_class: 'member', complied: 0, queue: [], mark: { covered: false }, report_weekday: 2 })
    expect(c.holder).toMatchObject({ kind: 'person', name: '白衣', npc: 'npc_white' })
    expect(c.until).toBe(now(g) + 10 * DAY)
    expect(g.state.actors.pc!.ext.identity).toEqual({ class: 'bound', extra: 1 })
    expect(sat(g)).toBe(50)
    const rep = reports(g, 'contract.sign')
    expect(rep).toHaveLength(1)
    expect(rep[0]!.outcome.summary).toMatch(/白衣/)
    expect(contractOf(g.state)?.holder.name).toBe('白衣')
  })

  it('holder 可以寫成勢力的 id：種類看勢力（eden 是伊甸園）、名字用勢力的名字；債務契約要寫 debt、每 30 天有月息的起點', () => {
    const g = make()
    expect(fx(g, [{ kind: 'contract_sign', holder: 'eden', type: 'debt' }]).errors.join()).toMatch(/debt/)
    expect(fx(g, [{ kind: 'contract_sign', holder: 'nobody', type: 'private' }]).errors.join()).toMatch(/nobody/)
    expect(fx(g, [{ kind: 'contract_sign', holder: 'eden', type: 'debt', debt: 10000 }]).errors).toEqual([])
    expect(mine(g).holder).toMatchObject({ kind: 'eden', faction: 'eden', name: '伊甸園' })
    expect(mine(g)).toMatchObject({ type: 'debt', debt: 10000, interest_at: now(g) + 30 * DAY })
    expect(mine(g).orders).toEqual(['errand', 'modify', 'serve', 'work', 'report', 'lend'])
  })

  it('已經有一份就落空並提醒；AI 與玩家要的簽不了；格式不對整批不收', () => {
    const g = make()
    sign(g)
    const again = sign(g, { holder: EDEN })
    expect(again.errors).toEqual([])
    expect(again.changes).toEqual([])
    expect(again.clamps[0]!.notice).toMatch(/已經有一份/)
    expect(mine(g).holder.name).toBe('白衣')
    for (const source of ['ai', 'player'] as const) {
      const ctx = effectCtx(g.k, g.state, { source: source as never, actor: 'pc' })
      expect(g.k.effects.validate([{ kind: 'contract_sign', holder: EDEN, type: 'private' }] as never, ctx).join()).toBeTruthy()
      expect(g.k.effects.validate([{ kind: 'order', order_kind: 'errand' }] as never, ctx).join()).toBeTruthy()
      expect(g.k.effects.validate([{ kind: 'contract_end', how: 'x' }] as never, ctx).join()).toBeTruthy()
    }
    const bad = (e: Rec) => fx(make(), [{ kind: 'contract_sign', holder: WHITE, type: 'private', ...e }]).errors.join()
    expect(bad({ type: 'slave' })).toMatch(/type/)
    expect(bad({ orders: ['dance'] })).toMatch(/orders/)
    expect(bad({ relation: 'enemy' })).toMatch(/relation/)
    expect(bad({ rules: [{ kind: 'zone' }] })).toMatch(/rules/)
    expect(bad({ days: 0 })).toMatch(/days/)
    expect(bad({ debt: 5 })).toMatch(/債務契約/)
    expect(bad({ extra: 1 })).toMatch(/extra/)
    expect(bad({ holder: { kind: 'alien', name: 'x' } })).toMatch(/holder/)
  })

  it('滿意的量表：AI 與玩家要的一律不收（只有內建的能動）', () => {
    const g = make()
    sign(g)
    for (const source of ['ai', 'player'] as const) {
      const ctx = effectCtx(g.k, g.state, { source: source as never, actor: 'pc', clampAsked: true } as never)
      const res = g.k.effects.resolve([{ kind: 'satisfaction', amount: 30 }] as never, ctx)
      expect(res.changes).toEqual([])
      expect(res.clamps.map((c) => c.notice).join()).toMatch(/滿意/)
    }
    expect(sat(g)).toBe(50)
    fx(g, [{ kind: 'satisfaction', amount: 10 }])
    expect(sat(g)).toBe(60)
  })

  it('contract_end：身分回到原本的、佇列清空、滿意歸零；報告 contract.end；沒有契約是落空', () => {
    const g = make({ pc: { ext: { bridge: { ...BRIDGE }, identity: { class: 'member' } } } })
    expect(fx(g, [{ kind: 'contract_end', how: 'released' }]).changes).toEqual([])
    sign(g)
    order(g, 'errand')
    order(g, 'work')
    expect(q(g)).toHaveLength(2)
    const r = fx(g, [{ kind: 'contract_end', how: 'released' }])
    expect(r.errors).toEqual([])
    expect(contractOf(g.state)).toBeNull()
    expect(g.state.actors.pc!.ext.identity).toEqual({ class: 'member' })
    expect(sat(g)).toBe(0)
    expect(reports(g, 'contract.end')).toHaveLength(1)
    expect(reports(g, 'contract.end')[0]!.outcome.summary).toMatch(/同意解除/)
    expect(fx(g, [{ kind: 'contract_end' }]).errors.join()).toMatch(/how/)
    // 可以再簽
    expect(sign(g, { holder: EDEN }).errors).toEqual([])
    expect(mine(g).id).not.toBe('c1')
    expect(mine(g).id).toMatch(/^c\d+$/)
  })

  it('條件 contract 在契約人這一邊也收 npc（M4-followups-2 第 11 項）：個人持約人是這個人才成立；勢力持約人沒有 npc，指定 npc 就不成立', () => {
    const g = make()
    const is = (cond: Rec) => g.k.conditions.test({ kind: 'contract', ...cond } as never, { state: g.state, actor: 'pc', stats: g.k.stats, timeRules: g.k.timeRules })
    expect(is({ side: 'bound', npc: 'npc_white' })).toBe(false)
    sign(g, { type: 'work' })
    expect(is({ side: 'bound', npc: 'npc_white' })).toBe(true)
    expect(is({ side: 'bound', npc: 'npc_other' })).toBe(false)
    expect(is({ side: 'bound', npc: 'npc_white', type: 'work', holder_kind: 'person' })).toBe(true)
    expect(is({ side: 'bound', npc: 'npc_white', type: 'debt' })).toBe(false)
    // 沒寫 npc 的照舊
    expect(is({ side: 'bound' })).toBe(true)
    fx(g, [{ kind: 'contract_end', how: 'cleared' }])
    expect(is({ side: 'bound', npc: 'npc_white' })).toBe(false)
    // 勢力持約人：沒有 npc，指定 npc 就不成立
    sign(g, { holder: EDEN, type: 'work' })
    expect(is({ side: 'bound' })).toBe(true)
    expect(is({ side: 'bound', npc: 'npc_white' })).toBe(false)
    // 格式：npc 要是字串
    expect(g.k.conditions.validate({ kind: 'contract', side: 'bound', npc: 3 } as never, 'c').join()).toContain('npc')
    expect(g.k.conditions.validate({ kind: 'contract', side: 'bound', npc: 'npc_white' } as never, 'c')).toEqual([])
  })

  it('期滿自動解約；rights 記讀取與限制級（重複的不記）；條件 contract 與 order_pending', () => {
    const g = make()
    const is = (cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, actor: 'pc', stats: g.k.stats, timeRules: g.k.timeRules })
    expect(is({ kind: 'contract', side: 'bound' })).toBe(false)
    sign(g, { type: 'work', days: 3 })
    expect(is({ kind: 'contract', side: 'bound' })).toBe(true)
    expect(is({ kind: 'contract', side: 'bound', type: 'work', holder_kind: 'person' })).toBe(true)
    expect(is({ kind: 'contract', side: 'bound', type: 'debt' })).toBe(false)
    expect(is({ kind: 'contract', side: 'holder' })).toBe(false)
    expect(is({ kind: 'order_pending' })).toBe(false)
    order(g, 'errand', { hours: 400 })
    expect(is({ kind: 'order_pending' })).toBe(true)
    expect(is({ kind: 'order_pending', order_kind: 'errand' })).toBe(true)
    expect(is({ kind: 'order_pending', order_kind: 'work' })).toBe(false)
    fx(g, [{ kind: 'bridge_right', holder: EDEN, level: 'read', source: 'loan' }])
    expect(fx(g, [{ kind: 'bridge_right', holder: EDEN, level: 'read', source: 'loan' }]).changes).toEqual([])
    fx(g, [{ kind: 'bridge_right', holder: 'eden', level: 'limit', source: 'loan' }])
    expect((g.state.ext as Rec).contract.rights.map((r: Rec) => [r.level, r.source])).toEqual([['read', 'loan'], ['limit', 'loan']])
    expect(fx(g, [{ kind: 'bridge_right', holder: EDEN, level: 'manage', source: 'x' }]).errors.join()).toMatch(/level/)
    toTime(g, 7, 12)
    expect(contractOf(g.state)).toBeNull()
    expect(reports(g, 'contract.end')[0]!.outcome.result).toBe('expired')
    expect((g.state.ext as Rec).contract.rights).toHaveLength(2)
  })
})

// ---- 每天的指令 ----

describe('每天 08:00 的指令', () => {
  it('骰子固定成一定下：過一個 08:00 佇列多一條、有一份 contract.order；每條的期限照規則', () => {
    const g = make()
    sign(g, { holder: { ...WHITE, freq: 1 }, report_weekday: 6 })
    withDice(0, () => toTime(g, 4, 9))
    expect(q(g)).toHaveLength(1)
    const o = q(g)[0]!
    expect(o).toMatchObject({ state: 'sent', from: 'npc_white', issued: toMinutes({ day: 4, hour: 8, minute: 0 }) })
    expect(o.deadline).toBeGreaterThan(o.issued)
    expect(reports(g, 'contract.order')).toHaveLength(1)
    expect(reports(g, 'contract.order')[0]!.kind).toBe('downtime')
    // 骰子沒到就沒有
    const g2 = make()
    sign(g2, { holder: { ...WHITE, freq: 0.2 }, report_weekday: 6 })
    withDice(0.9, () => toTime(g2, 4, 9))
    expect(q(g2)).toHaveLength(0)
    expect(reports(g2, 'contract.order')).toHaveLength(0)
  })

  it('每一種的期限：差事 24～72、改造 48、侍奉 4～12、出借 24、回報到那一天結束、工作到下一個時段結束', () => {
    const g = make()
    sign(g, { holder: WHITE, report_weekday: 0 })
    const span = (kind: string) => { order(g, kind); const o = q(g).slice(-1)[0]!; return (o.deadline - o.issued) / 60 }
    const errand = span('errand')
    expect(errand).toBeGreaterThanOrEqual(24)
    expect(errand).toBeLessThanOrEqual(72)
    expect(span('modify')).toBe(48)
    const serve = span('serve')
    expect(serve).toBeGreaterThanOrEqual(4)
    expect(serve).toBeLessThanOrEqual(12)
    expect(span('lend')).toBe(24)
    // 第 3 天 10:00（上午，7～11）：報告到當天 24:00；工作到下一個時段（中午 11～15）結束 15:00
    const rep = q(g).find((o) => o.kind === 'report')
    expect(rep).toBeUndefined()
    order(g, 'report')
    const r = q(g).slice(-1)[0]!
    expect(r.deadline).toBe(3 * DAY)
    order(g, 'work')
    expect(q(g).slice(-1)[0]!.deadline).toBe(2 * DAY + 15 * 60)
    // hours 寫了就照它
    order(g, 'errand', { hours: 5 })
    expect(q(g).slice(-1)[0]!.deadline - q(g).slice(-1)[0]!.issued).toBe(300)
  })

  it('佇列三條時不再下', () => {
    const g = make()
    sign(g, { holder: { ...WHITE, freq: 1 }, report_weekday: 6 })
    for (let i = 0; i < 3; i++) order(g, 'errand', { hours: 400 })
    expect(view(g).daily_chance).toBe(0)
    withDice(0, () => toTime(g, 4, 9))
    expect(q(g)).toHaveLength(3)
    expect(reports(g, 'contract.order').filter((r) => r.outcome.result === 'sent')).toHaveLength(3)
    // 一條了結之後又會下
    const done = q(g)[0]!
    fx(g, [{ kind: 'order_done', order: done.id }])
    expect(done).toBeTruthy()
  })

  it('滿意低機率 ×1.5、中 ×1、高 ×0.6（基本頻率 0.5 看兩邊）', () => {
    const g = make()
    sign(g, { holder: { ...WHITE, freq: 0.5 }, report_weekday: 6 })
    setSat(g, 20)
    expect(view(g).daily_chance).toBeCloseTo(0.75, 9)
    setSat(g, 50)
    expect(view(g).daily_chance).toBeCloseTo(0.5, 9)
    setSat(g, 70)
    expect(view(g).daily_chance).toBeCloseTo(0.3, 9)
    // 真的擲：骰 0.6 在滿意 20（×1.5＝0.75）會下、在滿意 50（0.5）不會
    setSat(g, 20)
    withDice(0.6, () => toTime(g, 4, 9))
    expect(q(g)).toHaveLength(1)
    const g2 = make()
    sign(g2, { holder: { ...WHITE, freq: 0.5 }, report_weekday: 6 })
    withDice(0.6, () => toTime(g2, 4, 9))
    expect(q(g2)).toHaveLength(0)
  })

  it('各種持約人的基本頻率：伊甸園 40%、幫派 30%、企業 25%、個人取中間值 30%；holder.freq 優先', () => {
    const chance = (holder: Rec) => {
      const g = make()
      sign(g, { holder })
      return view(g).daily_chance
    }
    expect(chance({ kind: 'eden', name: 'e' })).toBeCloseTo(0.4, 9)
    expect(chance({ kind: 'gang', name: 'g' })).toBeCloseTo(0.3, 9)
    expect(chance({ kind: 'corp', name: 'c' })).toBeCloseTo(0.25, 9)
    expect(chance({ kind: 'person', name: 'p' })).toBeCloseTo(0.3, 9)
    expect(chance({ kind: 'person', name: 'p', freq: 0.45 })).toBeCloseTo(0.45, 9)
  })

  it('抽種類：契約支配關掉時只剩差事、工作、回報；戀人不抽出借；開著時各種都抽得到', () => {
    const seen = (rules: Rec | undefined, relation = 'formal') => {
      const kinds = new Set<string>()
      for (let v = 0; v < 1; v += 0.02) {
        const g = make(rules ? { rules } : {})
        sign(g, { holder: { ...WHITE, freq: 1 }, relation, report_weekday: 6 })
        withDice(v, () => toTime(g, 4, 9))
        for (const o of q(g)) kinds.add(o.kind)
      }
      return kinds
    }
    const all = seen(undefined)
    expect([...all].sort()).toEqual(['errand', 'lend', 'modify', 'report', 'serve', 'work'])
    expect([...seen({ contentOff: ['contract_dom'] })].sort()).toEqual(['errand', 'report', 'work'])
    expect(seen(undefined, 'lover').has('lend')).toBe(false)
    expect(seen(undefined, 'lover').has('serve')).toBe(true)
  })

  it('紙上沒勾的種類權重 ×0.5（還是抽得到）', () => {
    const count = (orders: string[]) => {
      let n = 0
      for (let v = 0; v < 1; v += 0.01) {
        const g = make()
        sign(g, { holder: { ...EDEN, freq: 1 }, orders, report_weekday: 6 })
        withDice(v, () => toTime(g, 4, 9))
        if (q(g)[0]?.kind === 'work') n++
      }
      return n
    }
    const ticked = count(['errand', 'modify', 'serve', 'work', 'report', 'lend'])
    const crossed = count(['errand', 'modify', 'serve', 'report', 'lend'])
    expect(crossed).toBeGreaterThan(0)
    expect(crossed).toBeLessThan(ticked)
  })

  it('每週在 report_weekday 那一天自動排一條 report（不擲）；已經有一條沒了結的不重複', () => {
    const g = make()
    toTime(g, 6, 10)
    sign(g, { holder: { ...WHITE, freq: 0 }, report_weekday: 0 })
    withDice(0.99, () => toTime(g, 7, 9))
    expect(q(g)).toHaveLength(1)
    expect(q(g)[0]).toMatchObject({ kind: 'report', state: 'sent', deadline: 7 * DAY, place: WHITE.place })
    expect(reports(g, 'contract.order')[0]!.outcome.result).toBe('weekly')
    withDice(0.99, () => toTime(g, 14, 9))
    expect(q(g).filter((o) => o.kind === 'report' && o.state === 'sent')).toHaveLength(1)
    // 沒勾回報的契約沒有每週的回報
    const g2 = make()
    toTime(g2, 6, 10)
    sign(g2, { holder: { ...WHITE, freq: 0 }, orders: ['errand'], report_weekday: 0 })
    withDice(0.99, () => toTime(g2, 7, 9))
    expect(q(g2)).toHaveLength(0)
  })

  it('事件塞進來的指令（效果 order）：寫通知；契約支配關掉時不收侍奉；沒有契約是落空；一次睡很久只補最近三天', () => {
    const g = make({ rules: { contentOff: ['contract_dom'] } })
    expect(order(g, 'errand').changes).toEqual([])
    sign(g)
    expect(order(g, 'serve').changes).toEqual([])
    expect(order(g, 'errand').errors).toEqual([])
    expect(reports(g, 'contract.order')).toHaveLength(1)
    expect(reports(g, 'contract.order')[0]!.outcome.summary).toMatch(/差事/)
    const g2 = make()
    sign(g2, { holder: { ...WHITE, freq: 1 }, report_weekday: 6 })
    for (let i = 0; i < 2; i++) order(g2, 'errand', { hours: 2000 })
    withDice(0, () => toTime(g2, 30, 9))
    expect(q(g2).length).toBe(3) // 佇列上限三條：只補到滿
  })
})

// ---- 照做或抗拒 ----

describe('照做或抗拒', () => {
  const setup = (o: Opts & { sign?: Rec; sink?: number; orderKind?: string } = {}) => {
    const g = make(o)
    sign(g, o.sign ?? {})
    if (o.sink !== undefined) g.state.actors.pc!.sink = o.sink
    order(g, o.orderKind ?? 'errand')
    return g
  }

  it('DC 照公式：馴化 40、管理級、沉溺 65、名實相符＝12＋4＋4＋2＝22；戀人與夥伴 −4＝18；沉溺 85 再加 4；沉溺不到 60 沒有懲罰', () => {
    const g = setup({ sink: 65, sign: { relation: 'formal' } })
    const dc = (gg: G) => resistQuote(gg.k, gg.state, O(1))!
    expect(dc(g).dc).toBe(22)
    expect(dc(g).breakdown).toEqual([{ label: '基本', value: 12 }, { label: '管理級', value: 4 }, { label: '馴化', value: 4 }, { label: '沉溺', value: 2 }])
    expect(dc(setup({ sink: 65, sign: { relation: 'lover' } })).dc).toBe(18)
    expect(dc(setup({ sink: 65, sign: { relation: 'partner' } })).dc).toBe(18)
    expect(dc(setup({ sink: 65, sign: { relation: 'play' } })).dc).toBe(22)
    expect(dc(setup({ sink: 85 })).dc).toBe(24)
    expect(dc(setup({ sink: 59 })).dc).toBe(20)
    expect(dc(setup({ sink: 0 })).dc).toBe(20)
    expect((g.state.actors.pc!.ext as Rec).bridge.docility).toBe(40)
    // 看得到的成功率：只有自然 20 過得了 DC 22
    expect(dc(g).chance).toBeCloseTo(0.05, 9)
    expect(v(g).queue[0]!.resist).toMatchObject({ dc: 22, forceable: true })
    // 難度的偏移跟著加
    const hard = setup({ sink: 65, rules: { difficulty: 'hard', dcOffset: 1 } })
    expect(dc(hard).dc).toBe(23)
  })

  const v = (g: G) => view(g)

  it('照做：sent → doing，沒有檢定、滿意不變；報告 contract.choose', () => {
    const g = setup()
    expect(chooseBlock(g.k, g.state, { order: O(1), how: 'comply' })).toBeNull()
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    expect(q(g, O(1)).state).toBe('doing')
    expect(sat(g)).toBe(50)
    expect(reports(g, 'contract.choose')[0]!.outcome.result).toBe('comply')
    expect(chooseBlock(g.k, g.state, { order: O(1), how: 'comply' })).toMatch(/回應過/)
    expect(reasonOf(() => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' }))).toMatch(/回應過/)
    expect(chooseBlock(g.k, g.state, { order: 'zz', how: 'comply' })).toMatch(/找不到/)
  })

  it('抗拒成功：resisted、滿意 −5、紀錄帶擲骰；抗拒失敗：forced（期限不變）；檢定帶標籤 resist_contract（不帶 resist_control）', () => {
    const g = setup({ sink: 65 })
    const tags: string[][] = []
    const stat = g.k.stats
    const orig = stat.checkModifiers.bind(stat)
    vi.spyOn(stat, 'checkModifiers').mockImplementation((s, a, ctx) => { tags.push([...ctx.tags]); return orig(s, a, ctx) })
    const deadline = q(g, O(1)).deadline
    const r = withDice(NAT20, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' }))
    expect(tags.flat()).toContain('resist_contract')
    expect(tags.flat()).not.toContain('resist_control')
    expect(r.timeline.some((t) => t.roll?.dc === 22)).toBe(true)
    g.commit(r)
    expect(q(g, O(1))).toMatchObject({ state: 'resisted', closed: now(g) })
    expect(sat(g)).toBe(45)
    order(g, 'errand')
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(2), how: 'resist' })))
    expect(q(g, O(2)).state).toBe('forced')
    expect(sat(g)).toBe(45)
    expect(q(g, O(1)).deadline).toBe(deadline)
    expect(reports(g, 'contract.choose').map((x) => x.outcome.result)).toEqual(['resisted', 'forced'])
    // 大失敗也是失敗
    order(g, 'work')
    g.commit(withDice(NAT1, () => chooseDraft(g.k, g.state, { order: O(3), how: 'resist' })))
    expect(q(g, O(3)).state).toBe('forced')
  })

  it('抗拒用的是定力：屬性 resolve、基本功 composure 的加值算進檢定', () => {
    const g = setup({ pc: { attrs: { resolve: 16 }, skills: { composure: 3 }, ext: { bridge: { ...BRIDGE } } } })
    const quote = resistQuote(g.k, g.state, O(1))!
    expect(quote.parts.map((p) => [p.source, p.value])).toEqual(expect.arrayContaining([['attr', 3], ['skill', 3]]))
    expect(quote.dc).toBe(20)
    // 加值 +6：自然 14 起過 DC 20
    expect(quote.chance).toBeCloseTo(0.35, 9)
  })

  it('主角非自願（pc_unwilling）關掉：侍奉抗拒失敗當成功，差事與工作照樣被強制', () => {
    const g = make({ rules: { contentOff: ['pc_unwilling'] } })
    sign(g)
    order(g, 'serve')
    order(g, 'errand')
    order(g, 'work')
    order(g, 'lend')
    expect(resistQuote(g.k, g.state, O(1))!.forceable).toBe(false)
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    expect(q(g, O(1)).state).toBe('resisted')
    expect(sat(g)).toBe(45)
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(2), how: 'resist' })))
    expect(q(g, O(2)).state).toBe('forced')
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(3), how: 'resist' })))
    expect(q(g, O(3)).state).toBe('forced')
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(4), how: 'resist' })))
    expect(q(g, O(4)).state).toBe('resisted')
    // 開著時侍奉失敗就是強制
    const g2 = make()
    sign(g2)
    order(g2, 'serve')
    g2.commit(withDice(NAT10, () => chooseDraft(g2.k, g2.state, { order: O(1), how: 'resist' })))
    expect(q(g2, O(1)).state).toBe('forced')
  })

  it('沒有契約不能選；委託副本裡照樣能回（使用者 2026-11-26 裁決 2：回一句話不用走動）', () => {
    const g = make()
    expect(chooseBlock(g.k, g.state, { order: O(1), how: 'comply' })).toMatch(/沒有管理級/)
    sign(g)
    order(g, 'errand')
    flag(g, 'in_comm')
    expect(chooseBlock(g.k, g.state, { order: O(1), how: 'comply' })).toBeNull()
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    expect(q(g, O(1)).state).toBe('doing')
  })

  it('任何活動裡都能回（allowEverywhere），戰鬥與等著選的戰敗除外；走到了、做完仍然要在活動外', () => {
    const g = make()
    sign(g)
    order(g, 'errand')
    flag(g, 'in_comm')
    expect(g.blockOf('commit:contract.choose')).toBeNull()
    expect(g.blockOf('commit:contract.arrive')).toMatch(/副本/)
    expect(g.blockOf('commit:contract.done')).toMatch(/副本/)
    // 之後才登記的活動也一樣放行
    g.k.activity.define({ kind: 'late_act', owner: 'test', order: 95, active: (s) => (s.flags.late === true ? { id: 'l1', label: '晚來的活動' } : null), allow: [], reason: () => '晚來的活動進行中。' })
    flag(g, 'late')
    expect(g.blockOf('commit:contract.choose')).toBeNull()
    // 核心的戰鬥與戰敗只收自己的事
    const battle = g.k.activity.get('battle')
    expect(battle).toBeTruthy()
    expect(battle!.allow).not.toContain('commit:contract.choose')
    expect(g.k.activity.get('defeat')!.allow).not.toContain('commit:contract.choose')
  })
})

// ---- 走到了與做完 ----

describe('走到了與做完', () => {
  const doing = (g: G, kind = 'serve', e: Rec = {}) => {
    order(g, kind, e)
    const id = q(g).slice(-1)[0]!.id
    g.commit(chooseDraft(g.k, g.state, { order: id, how: 'comply' }))
    return id
  }

  it('照做 → 走到 place → arriveDraft 的報告帶觸發點 order 與對的 where；不在那裡被擋；沒有 place 在哪都算', () => {
    const g = make()
    sign(g, { relation: 'play' })
    const id = doing(g, 'serve', { place: { ...HIVE } })
    expect(q(g, id).place).toEqual(HIVE)
    expect(arriveBlock(g.k, g.state, { order: id })).toMatch(/還沒走到/)
    expect(reasonOf(() => arriveDraft(g.k, g.state, { order: id }))).toMatch(/還沒走到/)
    goTo(g, { district: 'd_hive', block: 'b_street' })
    expect(arriveBlock(g.k, g.state, { order: id })).toBeNull()
    const r = arriveDraft(g.k, g.state, { order: id })
    expect(r.triggers).toEqual([{ point: 'order', where: { order: 'serve', holder: 'person', relation: 'play' } }])
    g.commit(r)
    expect(reports(g, 'contract.arrive')).toHaveLength(1)
    expect(reports(g, 'contract.arrive')[0]!.triggers).toEqual([{ point: 'order', where: { order: 'serve', holder: 'person', relation: 'play' } }])
    expect(q(g, id).arrived).toBe(true)
    expect(arriveBlock(g.k, g.state, { order: id })).toMatch(/到過/)
    // 沒有 place 的指令在哪都算
    const id2 = doing(g, 'errand')
    goTo(g, { district: 'elsewhere' })
    expect(arriveBlock(g.k, g.state, { order: id2 })).toBeNull()
    expect(arriveDraft(g.k, g.state, { order: id2 }).triggers![0]!.where).toEqual({ order: 'errand', holder: 'person', relation: 'play' })
  })

  it('設施的 place 比對標記的 id；還沒回應或已經了結的指令不能走到', () => {
    const g = make()
    sign(g)
    order(g, 'serve', { place: { district: 'd_hive', block: 'b_street', facility: 'F1' } })
    expect(arriveBlock(g.k, g.state, { order: O(1) })).toMatch(/還沒回應/)
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    goTo(g, { district: 'd_hive', block: 'b_street' })
    expect(arriveBlock(g.k, g.state, { order: O(1) })).toMatch(/還沒走到/)
    goTo(g, { district: 'd_hive', block: 'b_street', facility: 'F1' })
    expect(arriveBlock(g.k, g.state, { order: O(1) })).toBeNull()
    g.commit(completeDraft(g.k, g.state, { order: O(1) }))
    expect(arriveBlock(g.k, g.state, { order: O(1) })).toMatch(/了結/)
  })

  it('completeDraft：done、滿意 +5、照做 +1；紀錄只留最近十條；第三次照做馴化 +1', () => {
    const g = make()
    sign(g)
    expect((g.state.actors.pc!.ext as Rec).bridge.docility).toBe(40)
    const ids = [doing(g, 'errand'), doing(g, 'errand'), doing(g, 'errand')]
    g.commit(completeDraft(g.k, g.state, { order: ids[0]! }))
    expect(sat(g)).toBe(55)
    expect(mine(g).complied).toBe(1)
    expect(q(g, ids[0]!)).toMatchObject({ state: 'done', closed: now(g) })
    g.commit(completeDraft(g.k, g.state, { order: ids[1]! }))
    expect(sat(g)).toBe(60)
    expect((g.state.actors.pc!.ext as Rec).bridge.docility).toBe(40)
    const third = completeDraft(g.k, g.state, { order: ids[2]! })
    expect(third.outcome.result).toBe('done_docile')
    g.commit(third)
    expect((g.state.actors.pc!.ext as Rec).bridge.docility).toBe(41)
    expect(sat(g)).toBe(65)
    expect(reports(g, 'contract.done')).toHaveLength(3)
    // 紀錄最多十條
    for (let i = 0; i < 12; i++) g.commit(completeDraft(g.k, g.state, { order: doing(g, 'errand') }))
    expect(q(g).filter((o) => o.state === 'done')).toHaveLength(10)
    expect(mine(g).complied).toBe(15)
    expect((g.state.actors.pc!.ext as Rec).bridge.docility).toBe(45)
  })

  it('已經了結、還沒回應、沒走到的不能收尾；滿意上限 100；沒有橋的人不加馴化也不出錯', () => {
    const g = make()
    sign(g)
    order(g, 'serve', { place: { ...HIVE } })
    expect(completeBlock(g.k, g.state, { order: O(1) })).toMatch(/還沒回應/)
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    expect(completeBlock(g.k, g.state, { order: O(1) })).toMatch(/還沒走到/)
    goTo(g, { ...HIVE })
    expect(completeBlock(g.k, g.state, { order: O(1) })).toBeNull()
    setSat(g, 98)
    g.commit(completeDraft(g.k, g.state, { order: O(1) }))
    expect(sat(g)).toBe(100)
    expect(completeBlock(g.k, g.state, { order: O(1) })).toMatch(/了結/)
    expect(completeBlock(g.k, g.state, { order: 'zz' })).toMatch(/找不到/)
    const nb = make({ pc: { ext: { bridge: null } } })
    sign(nb)
    for (let i = 0; i < 3; i++) nb.commit(completeDraft(nb.k, nb.state, { order: doing(nb, 'errand') }))
    expect(mine(nb).complied).toBe(3)
    expect(nb.state.actors.pc!.ext.bridge).toBeNull()
  })

  it('主動要求（askOrderDraft）：直接 doing、asked: true；做完 +8；佇列滿了、這一類不出現時被擋', () => {
    const g = make()
    sign(g)
    expect(askOrderBlock(g.k, g.state, { kind: 'work' })).toBeNull()
    g.commit(askOrderDraft(g.k, g.state, { kind: 'work' }))
    expect(q(g, O(1))).toMatchObject({ kind: 'work', state: 'doing', asked: true })
    expect(reports(g, 'contract.order')[0]!.outcome.result).toBe('asked')
    g.commit(completeDraft(g.k, g.state, { order: O(1) }))
    expect(sat(g)).toBe(58)
    for (let i = 0; i < 3; i++) g.commit(askOrderDraft(g.k, g.state, { kind: 'errand' }))
    expect(askOrderBlock(g.k, g.state, { kind: 'errand' })).toMatch(/沒做完/)
    expect(reasonOf(() => askOrderDraft(g.k, g.state, { kind: 'errand' }))).toMatch(/沒做完/)
    const g2 = make({ rules: { contentOff: ['contract_dom'] } })
    sign(g2)
    expect(askOrderBlock(g2.k, g2.state, { kind: 'serve' })).toMatch(/不會出現/)
    expect(askOrderBlock(g2.k, g2.state, { kind: 'report' })).toBeNull()
    const g3 = make()
    sign(g3, { relation: 'lover' })
    expect(askOrderBlock(g3.k, g3.state, { kind: 'lend' })).toMatch(/不會出現/)
    expect(askOrderBlock(make().k, make().state, { kind: 'work' })).toMatch(/沒有管理級/)
  })

  it('事件的結果也能收尾：效果 order_done 做的事和 completeDraft 一樣', () => {
    const g = make()
    sign(g)
    expect(fx(g, [{ kind: 'order_done' }]).changes).toEqual([])
    const id = doing(g, 'errand')
    expect(fx(g, [{ kind: 'order_done', order_kind: 'work' }]).changes).toEqual([])
    expect(fx(g, [{ kind: 'order_done', order_kind: 'errand' }]).errors).toEqual([])
    expect(q(g, id).state).toBe('done')
    expect(sat(g)).toBe(55)
    expect(mine(g).complied).toBe(1)
  })
})

// ---- 逾期 ----

describe('逾期', () => {
  const only = (rest: Rec) => ({ overdue: { lock: { weight: 0 }, load: { weight: 0 }, expose: { weight: 0 }, ...rest } })
  const lockOnly = () => pack((c) => { c.contract_rule = [{ id: 'default', ...only({ lock: { weight: 1 } }) }] })

  it('forced 的過期之後：overdue、滿意 −10、叫到假的 cyber_lock（只有它有權重）帶 hours 24', () => {
    const g = make({ pack: lockOnly() })
    sign(g)
    order(g, 'errand', { hours: 10 })
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    expect(q(g, O(1)).state).toBe('forced')
    advance(g, 9 * 60)
    expect(q(g, O(1)).state).toBe('forced')
    expect(reports(g, 'contract.overdue')).toHaveLength(0)
    advance(g, 2 * 60)
    expect(q(g, O(1))).toMatchObject({ state: 'overdue', closed: now(g) })
    expect(q(g, O(1)).lapsed).toBeUndefined()
    expect(sat(g)).toBe(40)
    expect(g.state.flags['locked:24:contract']).toBe(true)
    const rep = reports(g, 'contract.overdue')
    expect(rep).toHaveLength(1)
    expect(rep[0]!.outcome.result).toBe('overdue_lock')
  })

  it('三種處置各自叫得到：感載加到上限的一半、持約人那一方的敵對值 +10（沒有勢力的持約人沒有這一種）', () => {
    const run = (rule: Rec, holder: Rec) => {
      const g = make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', ...only(rule) }] }) })
      sign(g, { holder })
      order(g, 'errand', { hours: 1 })
      g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
      advance(g, 120)
      return g
    }
    const load = run({ load: { weight: 1 } }, WHITE)
    const cap = load.k.stats.stat(load.state, 'pc', 'load_cap')
    expect(load.state.actors.pc!.load).toBe(Math.ceil(cap / 2))
    expect(reports(load, 'contract.overdue')[0]!.outcome.result).toBe('overdue_load')
    const expose = run({ expose: { weight: 1 } }, EDEN)
    expect(expose.state.flags['hostility:eden:10']).toBe(true)
    expect(reports(expose, 'contract.overdue')[0]!.outcome.result).toBe('overdue_expose')
    // 個人持約人沒有勢力：報位置不能用，查不到的那一種重抽（沒有別的可抽就只有滿意）
    const none = run({ expose: { weight: 1 } }, WHITE)
    expect(reports(none, 'contract.overdue')[0]!.outcome.result).toBe('overdue')
    expect(sat(none)).toBe(40)
  })

  it('查不到效果的那一種重抽：沒有 cyber_lock 時只抽得到剩下的', () => {
    const g = make({ fake: { lock: false }, pack: pack((c) => { c.contract_rule = [{ id: 'default', overdue: { load: { weight: 1 }, expose: { weight: 0 } } }] }) })
    sign(g)
    order(g, 'errand', { hours: 1 })
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    advance(g, 120)
    expect(reports(g, 'contract.overdue')[0]!.outcome.result).toBe('overdue_load')
    expect(Object.keys(g.state.flags).some((f) => f.startsWith('locked'))).toBe(false)
    // 一個效果都查不到（沒有 hostility、沒有 cyber_lock、感載已經夠高）：只有滿意
    const g2 = make({ fake: { lock: false, hostility: false } })
    sign(g2, { holder: EDEN })
    g2.state.actors.pc!.load = g2.k.stats.stat(g2.state, 'pc', 'load_cap') - 1
    order(g2, 'errand', { hours: 1 })
    g2.commit(withDice(NAT10, () => chooseDraft(g2.k, g2.state, { order: O(1), how: 'resist' })))
    advance(g2, 120)
    expect(reports(g2, 'contract.overdue')[0]!.outcome.result).toBe('overdue')
    expect(sat(g2)).toBe(40)
  })

  it('sent、doing 的過期只是作廢：state overdue、lapsed、滿意 −5、沒有處置', () => {
    const g = make({ pack: lockOnly() })
    sign(g)
    order(g, 'errand', { hours: 1 })
    order(g, 'work', { hours: 1 })
    g.commit(chooseDraft(g.k, g.state, { order: O(2), how: 'comply' }))
    advance(g, 120)
    expect(q(g, O(1))).toMatchObject({ state: 'overdue', lapsed: true })
    expect(q(g, O(2))).toMatchObject({ state: 'overdue', lapsed: true })
    expect(sat(g)).toBe(40)
    expect(Object.keys(g.state.flags).some((f) => f.startsWith('locked'))).toBe(false)
    expect(reports(g, 'contract.overdue').map((r) => r.outcome.result)).toEqual(['lapsed', 'lapsed'])
  })

  it('逾期的報告帶指令的編號與種類；boundView 的佇列帶 closed 與處置（畫面不用比對正文）', () => {
    const g = make({ pack: lockOnly() })
    sign(g)
    order(g, 'errand', { hours: 10 })
    order(g, 'work', { hours: 1 })
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    advance(g, 120)
    // 第二條（sent）作廢；第一條（forced）還沒到期
    const lapsed = reports(g, 'contract.overdue')[0]!
    expect(lapsed.timeline[0]!.data).toMatchObject({ order: O(2), kind: 'work' })
    expect(view(g).queue.find((o) => o.id === O(2))).toMatchObject({ state: 'overdue', closed: expect.any(Number), outcome: { result: 'lapsed', text: expect.stringMatching(/作廢/) } })
    advance(g, 10 * 60)
    const forced = reports(g, 'contract.overdue')[1]!
    expect(forced.timeline[0]!.data).toMatchObject({ order: O(1), kind: 'errand', penalty: 'overdue_lock' })
    const row = view(g).queue.find((o) => o.id === O(1))!
    expect(row.state).toBe('overdue')
    expect(row.closed).toBeTypeOf('number')
    expect(row.outcome).toMatchObject({ result: 'overdue_lock' })
    expect(row.outcome!.text).toMatch(/鎖住/)
    // 還沒了結的沒有 closed、outcome
    order(g, 'serve', { hours: 40 })
    const live = view(g).queue.find((o) => o.id === O(3))!
    expect(live.closed).toBeUndefined()
    expect(live.outcome).toBeUndefined()
  })

  it('任何活動裡期限都暫停：潛入、簾後館的一趟、拍賣、成人場景……（不只委託副本）；活動結束之後才繼續算', () => {
    const g = make({ pack: lockOnly() })
    g.k.activity.define({ kind: 'dive', owner: 'test', order: 85, active: (s) => (s.flags.in_dive === true ? { id: 'd1', label: '潛入中' } : null), allow: ['commit:test.'], reason: () => '潛入中。' })
    sign(g, { holder: { ...WHITE, freq: 0 }, report_weekday: 6 })
    order(g, 'errand', { hours: 48 })
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    const before = q(g, O(1)).deadline
    flag(g, 'in_dive')
    advance(g, 100 * 60)
    expect(q(g, O(1)).deadline).toBe(before + 100 * 60)
    expect(q(g, O(1)).state).toBe('forced')
    // 潛入裡照樣回得了話
    order(g, 'work', { hours: 20 })
    g.commit(chooseDraft(g.k, g.state, { order: O(2), how: 'comply' }))
    expect(q(g, O(2)).state).toBe('doing')
    flag(g, 'in_dive', false)
    advance(g, 100 * 60)
    expect(q(g, O(1)).state).toBe('overdue')
  })

  it('委託副本進行中不計時：副本裡過 100 小時，期限沒有少；出來之後才繼續算', () => {
    const g = make({ pack: lockOnly() })
    sign(g, { holder: { ...WHITE, freq: 0 }, report_weekday: 6 })
    order(g, 'errand', { hours: 48 })
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    const before = q(g, O(1)).deadline
    flag(g, 'in_comm')
    advance(g, 100 * 60)
    expect(q(g, O(1)).deadline).toBe(before + 100 * 60)
    expect(q(g, O(1)).state).toBe('forced')
    expect(reports(g, 'contract.pause').length).toBeGreaterThan(0)
    expect(reports(g, 'contract.pause')[0]!.kind).toBe('system')
    expect(sat(g)).toBe(50)
    // 副本裡每天 08:00 擲出來的指令也不會一出生就逾期
    advance(g, 100 * 60)
    expect(q(g, O(1)).deadline).toBe(before + 200 * 60)
    flag(g, 'in_comm', false)
    const left = q(g, O(1)).deadline - now(g)
    advance(g, left - 1)
    expect(q(g, O(1)).state).toBe('forced')
    advance(g, 2)
    expect(q(g, O(1)).state).toBe('overdue')
  })
})

// ---- 收入歸屬 ----

describe('收入歸屬', () => {
  const settle = (g: G, delta = 200, action = 'work.settle', op = 'cash') => g.commit(draft([{ op, delta }], action))

  it('work 指令進行中：打完一班（work.settle 給 200 現金）實際只進 20、債少 180、這一條自動算照做（滿意 +5、照做 +1）；之後的班照拿；沒有指令時照拿', () => {
    const g = make({ money: { cred: 0, cash: 1000 } })
    sign(g, { holder: EDEN, type: 'debt', debt: 1000 })
    settle(g)
    expect(g.state.money.cash).toBe(1200)
    expect(mine(g).debt).toBe(1000)
    order(g, 'work', { hours: 100 })
    settle(g)
    expect(g.state.money.cash).toBe(1400) // 還沒答應照做，照拿
    expect(q(g, O(1)).state).toBe('sent')
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    const sat0 = sat(g)
    settle(g)
    expect(g.state.money.cash).toBe(1420)
    expect(mine(g).debt).toBe(820)
    // 這一班就是照做：done、滿意 +5、照做次數 +1
    expect(q(g, O(1)).state).toBe('done')
    expect(sat(g)).toBe(sat0 + 5)
    expect(mine(g).complied).toBe(1)
    const last = g.state.reports.filter((r) => r.action === 'work.settle').slice(-1)[0]!
    expect(last.outcome.summary).toMatch(/抵了債/)
    expect(last.outcome.summary).toMatch(/算你照做了/)
    expect(last.narration?.results?.some((l) => /抵了債/.test(l))).toBe(true)
    expect(last.changes).toEqual([{ op: 'cash', delta: 200 }, { op: 'cash', delta: -180 }, expect.objectContaining({ op: 'ext', key: 'contract' }), { op: 'meter', kind: 'satisfaction', key: expect.anything(), delta: 5 }])
    // 抽成只算那一班：之後的班照拿
    settle(g)
    expect(g.state.money.cash).toBe(1620)
    expect(mine(g).debt).toBe(820)
  })

  it('一班的期限：打完那一班就過了期限的不算（不抽成、不自動照做）；一次只收期限最近的那一條', () => {
    const g = make({ money: { cred: 0, cash: 1000 } })
    sign(g, { holder: WHITE, type: 'work' })
    order(g, 'work', { hours: 1 })
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    // 一班八個小時，期限只剩一小時：打完時已經過了期限
    g.commit(draft([{ op: 'time', minutes: 8 * 60 }, { op: 'cash', delta: 100 }], 'work.shift'))
    expect(g.state.money.cash).toBe(1100)
    expect(q(g, O(1)).state).not.toBe('done')
    // 兩條工作：一班只收期限近的那一條
    const g2 = make({ money: { cred: 0, cash: 1000 } })
    sign(g2, { holder: WHITE, type: 'work' })
    order(g2, 'work', { hours: 50 })
    order(g2, 'work', { hours: 20 })
    g2.commit(chooseDraft(g2.k, g2.state, { order: O(1), how: 'comply' }))
    g2.commit(chooseDraft(g2.k, g2.state, { order: O(2), how: 'comply' }))
    settle(g2, 100, 'work.shift')
    expect(q(g2, O(2)).state).toBe('done')
    expect(q(g2, O(1)).state).toBe('doing')
    expect(g2.state.money.cash).toBe(1010)
    settle(g2, 100, 'work.shift')
    expect(q(g2, O(1)).state).toBe('done')
    expect(g2.state.money.cash).toBe(1020)
    settle(g2, 100, 'work.shift')
    expect(g2.state.money.cash).toBe(1120)
  })

  it('真的打工的結算報告 work.shift 也一樣；強制的 work 也算；其他種類的報告與其他種類的指令不動；升職不算一班', () => {
    const g = make({ money: { cred: 0, cash: 1000 } })
    sign(g, { holder: WHITE, type: 'work' })
    order(g, 'errand')
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    settle(g, 100, 'work.shift')
    expect(g.state.money.cash).toBe(1100)
    order(g, 'work', { hours: 100 })
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(2), how: 'resist' })))
    expect(q(g, O(2)).state).toBe('forced')
    settle(g, 100, 'work.promote')
    expect(g.state.money.cash).toBe(1200)
    expect(q(g, O(2)).state).toBe('forced')
    settle(g, 100, 'work.shift')
    expect(g.state.money.cash).toBe(1210)
    expect(q(g, O(2)).state).toBe('done')
    expect(mine(g).debt).toBeUndefined()
    expect(g.state.reports.filter((r) => r.action === 'work.shift').slice(-1)[0]!.outcome.summary).toMatch(/歸了持約人/)
    settle(g, 100, 'trade.sell')
    expect(g.state.money.cash).toBe(1310)
    // 那一條做完了：之後的班（不論帳戶或現金）照拿
    settle(g, 100, 'work.shift', 'cred')
    expect(g.state.money.cred).toBe(100)
  })

  it('掛點 report.before 回傳 { changes, lines }：核心把句子接到報告的結果與摘要，掛點沒有改草稿', () => {
    const g = make({ money: { cred: 0, cash: 1000 } })
    sign(g, { holder: WHITE, type: 'work' })
    order(g, 'work', { hours: 100 })
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    const d = draft([{ op: 'cash', delta: 100 }], 'work.shift')
    const before = JSON.stringify(d)
    const answer = g.k.hooks.run('report.before', { state: g.state, draft: d }).map((h) => h.result)
    expect(JSON.stringify(d)).toBe(before)
    expect(answer.some((a) => !Array.isArray(a) && a.lines!.length > 0)).toBe(true)
    const r = g.commit(d)[0]!
    expect(r.narration?.results?.length).toBeGreaterThan(0)
    expect(r.outcome.summary).toMatch(/歸了持約人/)
  })

  it('債務契約收入還完債：契約解除（contract.end）；沒有錢進帳的報告不動', () => {
    const g = make({ money: { cred: 0, cash: 0 } })
    sign(g, { holder: EDEN, type: 'debt', debt: 150 })
    order(g, 'work', { hours: 100 })
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    g.commit(draft([{ op: 'time', minutes: 60 }], 'work.shift'))
    expect(mine(g).debt).toBe(150)
    expect(q(g, O(1)).state).toBe('doing')
    settle(g, 200)
    expect(g.state.money.cash).toBe(20)
    expect(contractOf(g.state)).toBeNull()
    expect(reports(g, 'contract.end')).toHaveLength(1)
    expect((g.state.actors.pc!.ext as Rec).identity.class).toBe('citizen')
  })
})

// ---- 還清 ----

describe('還清', () => {
  const debtor = (o: Opts & { debt?: number; sat?: number } = {}) => {
    const g = make({ money: { cred: 15000, cash: 0 }, ...o })
    sign(g, { holder: EDEN, type: 'debt', debt: o.debt ?? 10000 })
    if (o.sat !== undefined) setSat(g, o.sat)
    return g
  }

  it('債 10,000 付 15,000 解約：錢扣掉、身分回去、佇列清空；一份 contract.pay（不再多一份 contract.end）', () => {
    const g = debtor()
    order(g, 'errand')
    expect(payoffQuote(g.k, g.state)).toMatchObject({ debt: 10000, price: 15000, talk_price: null, can_talk: false })
    expect(view(g).payoff!.price).toBe(15000)
    expect(payoffBlock(g.k, g.state)).toBeNull()
    g.commit(payoffDraft(g.k, g.state))
    expect(g.state.money.cred).toBe(0)
    expect(contractOf(g.state)).toBeNull()
    expect((g.state.actors.pc!.ext as Rec).identity.class).toBe('citizen')
    expect(sat(g)).toBe(0)
    expect(reports(g, 'contract.pay')).toHaveLength(1)
    expect(reports(g, 'contract.pay')[0]!.outcome.result).toBe('paid')
    expect(reports(g, 'contract.end')).toHaveLength(0)
  })

  it('滿意 85、交涉成功付 12,000；交涉失敗付原價；滿意不到 80 談不了', () => {
    const g = debtor({ sat: 85 })
    expect(payoffQuote(g.k, g.state)).toMatchObject({ price: 15000, talk_price: 12000, can_talk: true })
    g.commit(withDice(NAT20, () => payoffDraft(g.k, g.state, { talk: true })))
    expect(g.state.money.cred).toBe(3000)
    expect(contractOf(g.state)).toBeNull()
    expect(reports(g, 'contract.pay')[0]!.outcome.result).toBe('paid_talked')
    const f = debtor({ sat: 85 })
    f.commit(withDice(NAT1, () => payoffDraft(f.k, f.state, { talk: true })))
    expect(f.state.money.cred).toBe(0)
    expect(contractOf(f.state)).toBeNull()
    expect(reports(f, 'contract.pay')[0]!.outcome.result).toBe('paid')
    const low = debtor({ sat: 79 })
    expect(payoffBlock(low.k, low.state, { talk: true })).toMatch(/談不了價/)
    expect(reasonOf(() => payoffDraft(low.k, low.state, { talk: true }))).toMatch(/談不了價/)
  })

  it('錢不夠被擋；交涉沒談成又付不起原價：只有交涉、契約還在、骰子往前', () => {
    const poor = debtor({ money: { cred: 14999, cash: 0 } })
    expect(payoffBlock(poor.k, poor.state)).toMatch(/錢不夠/)
    expect(reasonOf(() => payoffDraft(poor.k, poor.state))).toMatch(/錢不夠/)
    expect(poor.state.money.cred).toBe(14999)
    const talk = debtor({ money: { cred: 12000, cash: 0 }, sat: 90 })
    expect(payoffBlock(talk.k, talk.state, { talk: true })).toBeNull()
    expect(payoffBlock(talk.k, talk.state)).toMatch(/錢不夠/)
    const cursor = talk.state.rng.cursor
    talk.commit(withDice(NAT1, () => payoffDraft(talk.k, talk.state, { talk: true })))
    expect(contractOf(talk.state)).not.toBeNull()
    expect(talk.state.money.cred).toBe(12000)
    expect(talk.state.rng.cursor).toBe(cursor + 1)
    expect(reports(talk, 'contract.pay')[0]!.outcome.result).toBe('talk_failed')
    // 用現金付、指定錢包
    const cash = debtor({ money: { cred: 100, cash: 15000 } })
    cash.commit(payoffDraft(cash.k, cash.state))
    expect(cash.state.money).toEqual({ cred: 100, cash: 0 })
    const pick = debtor({ money: { cred: 15000, cash: 15000 } })
    expect(payoffBlock(pick.k, pick.state, { pay: 'cash' })).toBeNull()
    pick.commit(payoffDraft(pick.k, pick.state, { pay: 'cash' }))
    expect(pick.state.money).toEqual({ cred: 15000, cash: 0 })
  })

  it('不是債務契約、沒有契約都沒有還清可言', () => {
    const g = make()
    expect(payoffBlock(g.k, g.state)).toMatch(/沒有管理級/)
    expect(payoffQuote(g.k, g.state)).toBeNull()
    sign(g, { type: 'private' })
    expect(payoffBlock(g.k, g.state)).toMatch(/沒有欠債/)
    expect(payoffQuote(g.k, g.state)).toBeNull()
    expect(view(g).payoff).toBeNull()
  })

  it('債每 30 天加月息 2%（四捨五入）；一次睡很久補到該補的期數；不是債務契約不加', () => {
    const g = debtor()
    toTime(g, 3 + 29, 10)
    expect(mine(g).debt).toBe(10000)
    toTime(g, 3 + 30, 10)
    expect(mine(g).debt).toBe(10200)
    expect(mine(g).interest_at).toBe(toMinutes({ day: 3 + 60, hour: 10, minute: 0 }))
    expect(reports(g, 'contract.pay')[0]!.outcome.result).toBe('interest')
    toTime(g, 3 + 120, 10)
    expect(mine(g).debt).toBe(Math.round(Math.round(Math.round(10200 * 1.02) * 1.02) * 1.02))
    const p = make()
    sign(p, { type: 'private' })
    toTime(p, 200, 10)
    expect(mine(p).debt).toBeUndefined()
  })
})

// ---- 規矩 ----

describe('規矩：禁區與宵禁', () => {
  it('走進禁區的報告之後有 contract.rule、滿意 −5；已經在裡面、走到別處都不算', () => {
    const g = make()
    sign(g, { rules: [{ kind: 'zone', value: 'd_banned' }, { kind: 'dress', value: 'collar' }] })
    goTo(g, { district: 'd_safe' })
    expect(reports(g, 'contract.rule')).toHaveLength(0)
    goTo(g, { district: 'd_banned' })
    expect(reports(g, 'contract.rule')).toHaveLength(1)
    expect(reports(g, 'contract.rule')[0]!.outcome.result).toBe('zone')
    expect(sat(g)).toBe(45)
    // 一份報告 location 欄位是之前的位置：移到禁區裡的另一個街區不再記一次
    g.commit({ ...draft([{ op: 'location', to: { district: 'd_banned', block: 'b_x' } }], 'test.go'), location: { district: 'd_banned' } })
    expect(reports(g, 'contract.rule')).toHaveLength(1)
    goTo(g, { district: 'd_safe' })
    goTo(g, { district: 'd_banned', block: 'b_inner' })
    expect(reports(g, 'contract.rule')).toHaveLength(2)
    expect(sat(g)).toBe(40)
    // 值寫街區 id 也行；dress 只記錄
    const b = make()
    sign(b, { rules: [{ kind: 'zone', value: 'b_banned' }, { kind: 'dress', value: '制服' }] })
    goTo(b, { district: 'd1', block: 'b_banned' })
    expect(reports(b, 'contract.rule')).toHaveLength(1)
    // 沒有契約、解約之後不查
    const c = make()
    goTo(c, { district: 'd_banned' })
    expect(reports(c, 'contract.rule')).toHaveLength(0)
    fx(b, [{ kind: 'contract_end', how: 'released' }])
    goTo(b, { district: 'x' })
    goTo(b, { district: 'd1', block: 'b_banned' })
    expect(reports(b, 'contract.rule')).toHaveLength(1)
  })

  it('宵禁：每天 05:00 查人在不在住處（條件 at_home）；在家沒事、不在記一次違規；沒有人註冊條件就不查', () => {
    const g = make()
    sign(g, { rules: [{ kind: 'curfew', value: 22 }] })
    toTime(g, 3, 23)
    toTime(g, 4, 6)
    expect(reports(g, 'contract.rule')).toHaveLength(1)
    expect(reports(g, 'contract.rule')[0]!.outcome.result).toBe('curfew')
    expect(sat(g)).toBe(45)
    flag(g, 'home')
    toTime(g, 5, 6)
    expect(reports(g, 'contract.rule')).toHaveLength(1)
    flag(g, 'home', false)
    toTime(g, 7, 6)
    expect(reports(g, 'contract.rule').length).toBe(3) // 第 6、7 天各一次（一次跨過兩個 05:00）
    expect(sat(g)).toBe(35)
    const none = make({ fake: { home: false } })
    sign(none, { rules: [{ kind: 'curfew', value: 22 }] })
    toTime(none, 6, 6)
    expect(reports(none, 'contract.rule')).toHaveLength(0)
    expect(sat(none)).toBe(50)
    // 沒有宵禁的規矩不查
    const free = make()
    sign(free)
    toTime(free, 6, 6)
    expect(reports(free, 'contract.rule')).toHaveLength(0)
  })
})

// ---- 光紋與掃橋 ----

describe('光紋與掃橋', () => {
  it('coverMarkDraft：要背包裡有 mark_cover 的東西才遮；露出來不用；狀態一樣時被擋', () => {
    const g = make()
    sign(g)
    expect(coverMarkBlock(g.k, g.state, { covered: true })).toMatch(/沒有能遮/)
    expect(coverMarkBlock(g.k, g.state, { covered: false })).toMatch(/本來就露著/)
    g.commit(draft([{ op: 'item', id: 'it_rock', qty: 1 }], 'test.item'))
    expect(coverMarkBlock(g.k, g.state, { covered: true })).toMatch(/沒有能遮/)
    g.commit(draft([{ op: 'item', id: 'it_collar', qty: 1 }], 'test.item'))
    expect(coverMarkBlock(g.k, g.state, { covered: true })).toBeNull()
    g.commit(coverMarkDraft(g.k, g.state, { covered: true }))
    expect(mine(g).mark.covered).toBe(true)
    expect(coverMarkBlock(g.k, g.state, { covered: true })).toMatch(/已經遮著/)
    expect(reasonOf(() => coverMarkDraft(g.k, g.state, { covered: true }))).toMatch(/已經遮著/)
    g.commit(coverMarkDraft(g.k, g.state, { covered: false }))
    expect(mine(g).mark.covered).toBe(false)
    expect(coverMarkBlock(make().k, make().state, { covered: true })).toMatch(/沒有管理級/)
  })

  it('scanAnswer：管理級的契約加記著的讀取與限制級；光紋遮著 marked 是 false；沒有任何契約是 undefined；只回答主角', () => {
    const g = make()
    expect(scanAnswer(g.state, 'pc')).toBeUndefined()
    fx(g, [{ kind: 'bridge_right', holder: EDEN, level: 'read', source: 'loan' }])
    expect(scanAnswer(g.state, 'pc')).toEqual({ contract: { rights: [{ level: 'read', holder: expect.objectContaining({ name: '伊甸園' }), source: 'loan' }], marked: false, covered: false } })
    sign(g)
    const a = scanAnswer(g.state, 'pc')!.contract
    expect(a.rights.map((r) => r.level)).toEqual(['manage', 'read'])
    expect(a).toMatchObject({ marked: true, covered: false })
    g.commit(draft([{ op: 'item', id: 'it_collar', qty: 1 }], 'test.item'))
    g.commit(coverMarkDraft(g.k, g.state, { covered: true }))
    expect(scanAnswer(g.state, 'pc')!.contract).toMatchObject({ marked: false, covered: true })
    expect(scanAnswer(g.state, 'someone')).toBeUndefined()
  })
})

// ---- 面板 ----

describe('boundView', () => {
  it('契約寫了什麼、規矩、滿意、馴化、還欠多少、佇列每一條的期限與逾期會怎樣、抗拒的 DC 與成功率、還清的價錢', () => {
    const g = make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', overdue: { load: { weight: 0 }, expose: { weight: 0 } } }] }) })
    expect(boundView(g.k, g.state)).toBeNull()
    sign(g, { holder: EDEN, type: 'debt', debt: 8000, orders: ['errand', 'work', 'report'], rules: [{ kind: 'zone', value: 'd_banned' }], relation: 'partner' })
    order(g, 'errand', { hours: 30 })
    order(g, 'work', { hours: 5 })
    g.commit(chooseDraft(g.k, g.state, { order: O(2), how: 'comply' }))
    g.commit(withDice(NAT10, () => chooseDraft(g.k, g.state, { order: O(1), how: 'resist' })))
    const vw = view(g)
    expect(vw).toMatchObject({ id: 'c1', type: 'debt', type_name: '債務契約', relation: 'partner', relation_name: '實為夥伴', satisfaction: 50, docility: 40, debt: 8000, complied: 0, queue_max: 3 })
    expect(vw.orders.map((o) => [o.kind, o.ticked])).toEqual([['errand', true], ['modify', false], ['serve', false], ['work', true], ['report', true], ['lend', false]])
    expect(vw.rules).toEqual([{ kind: 'zone', value: 'd_banned' }])
    expect(vw.payoff).toMatchObject({ debt: 8000, price: 12000 })
    const [forced, doingOrder] = vw.queue
    expect(forced).toMatchObject({ state: 'forced', state_name: '強制', minutes_left: 30 * 60, on_overdue: ['鎖住一件義體'] })
    expect(doingOrder).toMatchObject({ state: 'doing', minutes_left: 5 * 60, on_overdue: ['作廢，滿意下降'] })
    order(g, 'errand')
    const sent = view(g).queue[2]!
    expect(sent.resist).toMatchObject({ dc: 16 + 0, forceable: true })
    expect(sent.resist!.chance).toBeGreaterThan(0)
    expect(sent.on_overdue).toEqual(['作廢，滿意下降'])
  })
})

describe('boundView 的走過去（goto）', () => {
  it('指定了地方、還沒了結也沒到過的指令帶 goto（district、block、名字、人是不是已經站在那裡）；到了、了結、沒有指定地方的沒有', () => {
    const g = make()
    sign(g)
    order(g, 'errand', { place: { district: 'test', block: 'far_block' } })
    order(g, 'work')
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    const row = (id: string) => view(g).queue.find((o) => o.id === id)!
    expect(row(O(1)).goto).toMatchObject({ district: 'test', block: 'far_block', here: false })
    expect(typeof row(O(1)).goto!.name).toBe('string')
    expect(row(O(2)).goto).toBeUndefined()
    // 站到那裡：here 變 true，到了之後（arrive）就沒有了
    g.commit(draft([{ op: 'location', to: { district: 'test', block: 'far_block' } }], 'test.walk'))
    expect(row(O(1)).goto!.here).toBe(true)
    g.commit(arriveDraft(g.k, g.state, { order: O(1) }))
    expect(row(O(1)).goto).toBeUndefined()
  })
})

// ---- 快照、存檔與裝進整組功能 ----

describe('快照、存檔與整組功能', () => {
  it('回到快照（撤退）：佇列與滿意跟著回去；存檔再讀一樣', () => {
    const g = make()
    sign(g)
    g.commit(draft([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'test.entry'))
    order(g, 'errand')
    order(g, 'work')
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    g.commit(completeDraft(g.k, g.state, { order: O(1) }))
    expect(sat(g)).toBe(55)
    expect(q(g)).toHaveLength(2)
    const again = make()
    again.load(g.save())
    expect(contractOf(again.state)).toEqual(contractOf(g.state))
    expect(again.state.meters.satisfaction).toEqual(g.state.meters.satisfaction)
    expect(again.state.actors.pc!.ext.identity).toEqual({ class: 'bound' })
    expect(g.rewindToKind('entry', '你撤退了。')).toBeNull()
    expect(q(g)).toEqual([])
    expect(sat(g)).toBe(50)
    expect(mine(g).complied).toBe(0)
    expect(mine(g).holder.name).toBe('白衣')
  })

  it('壞掉的存檔欄位當沒有：不丟錯', () => {
    const g = make()
    g.commit(draft([{ op: 'ext', key: 'contract', value: { mine: { id: 'c9', nope: true }, rights: 'x', notes: [{ kind: 'zzz' }] } }], 'test.bad'))
    expect(contractOf(g.state)).toBeNull()
    expect(boundView(g.k, g.state)).toBeNull()
    expect(() => advance(g, 3 * DAY)).not.toThrow()
    expect(sign(g).errors).toEqual([])
  })

  it('裝在整組功能裡也一樣（FEATURES）：簽、下指令、抗拒、做完', () => {
    const { game: g } = makeGame({ features: Object.values(FEATURES), content: [pack()], seed: 7, pc: { hp: 40, ext: { bridge: { ...BRIDGE } } }, patch: { time: { day: 3, hour: 10, minute: 0 } } })
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    const effects = [{ kind: 'contract_sign', holder: WHITE, type: 'private', report_weekday: 6 }, { kind: 'order', order_kind: 'errand' }]
    expect(g.k.effects.validate(effects as never, ctx)).toEqual([])
    const res = g.k.effects.resolve(effects as never, ctx)
    expect(res.errors).toEqual([])
    g.commit(draft(res.changes, 'test.effect'))
    expect(contractOf(g.state)?.queue).toHaveLength(1)
    g.commit(chooseDraft(g.k, g.state, { order: O(1), how: 'comply' }))
    g.commit(completeDraft(g.k, g.state, { order: O(1) }))
    expect(g.state.meters.satisfaction?._).toBe(55)
  })
})
