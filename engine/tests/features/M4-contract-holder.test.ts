// 驗收測試：dev/work/M4-contract-holder.md（cpp-feature）。規格：LEWD_SYSTEM 7.2、7.3、7.5、7.8 節；EVENTS 4.5 節最後三條；NPC_SYSTEM 10.7 節；dev/adr/0019 第八節；dev/adr/0020 D5。
// 內容一律用測試自帶的最小假資料：兩個 NPC（阿晴、小滿）是角色、有橋；範圍 contract 與一件通知事件只在裝了導演的那幾條放。
// 親密度（affinity）、忠誠（loyalty）、roster_add、has_home 都是測試自己註冊的假貨（真的在 features/npcs、roster、rest）。
// 時間：測試從第 3 天 10:00 開始。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, Rng, effectCtx, toMinutes } from '../../src'
import { characterFeature } from '../../src/features/character'
import {
  DEFAULT_CONTRACT_RULES, adjustBlock, adjustDraft, boundView, contractFeature, contractOf, contractRules, heldIn, heldOf, heldPeople, holderContractView, holderEvents, releaseBlock, releaseDraft,
  scanAnswer, scanPerson, triggerBlock, triggerDraft,
} from '../../src/features/contract'
import { FEATURES } from '../../src/features'
import { directorFeature } from '../../src/features/director'
import { lewdFeature } from '../../src/features/lewd'
import { makeActor, makeGame } from '../../src/testkit'

type Rec = Record<string, any>
const DAY = 1440
afterEach(() => { vi.restoreAllMocks() })

// ---- 假資料 ----

const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 }
const npcActor = (id: string, name: string, over: Rec = {}) => makeActor({ id, name, role: 'npc', age: 26, ext: { bridge: { ...BRIDGE }, ...(over.ext ?? {}) }, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'ext')) })
const A = 'npc_a'
const B = 'npc_b'

const scopePack = (): ContentPack => ({
  id: 'holder_test',
  content: {
    event_scope: [{ id: 'contract', triggers: { order: 1, holder_order: 1, released: 1 }, priority: 2, lost: 'defer', daily_roll: { eden: 0.4, gang: 0.3, corp: 0.25, person: [0.15, 0.45] }, satisfaction_mult: [[0, 1.5], [30, 1], [70, 0.6]], queue_max: 3 }],
    event: [
      { id: 'ct_errand_note', scope: 'contract', triggers: ['holder_order'], where: { order: 'errand' }, blocking: false, category: 'favor', text: '他接下了差事。', effects: [{ kind: 'flag', key: 'ct_errand_seen', value: true }] },
      { id: 'ct_release_note', scope: 'contract', triggers: ['released'], blocking: false, category: 'favor', text: '他想一想自己要不要走。', effects: [{ kind: 'flag', key: 'ct_release_seen', value: true }] },
    ],
  } as unknown as ContentPack['content'],
})
const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {}
  patch(c)
  return { id: 'holder_test', content: c as unknown as ContentPack['content'] }
}

/** 假的親密度與忠誠（量表）、roster_add（記在旗標上）、has_home（旗標 has_home）。 */
const fakes = (o: { meters?: boolean; roster?: boolean; home?: boolean } = {}): Feature[] => {
  const out: Feature[] = []
  if (o.meters !== false) {
    out.push({
      id: 't_meters',
      install(k) {
        k.meters.define({ kind: 'affinity', owner: 't_meters', name: '親密度', min: -100, max: 100, start: 0, keyed: 'npc' })
        k.meters.define({ kind: 'loyalty', owner: 't_meters', name: '忠誠', min: 0, max: 100, start: 30, keyed: 'npc' })
      },
    })
  }
  if (o.roster !== false) {
    out.push({
      id: 't_roster',
      install(k) {
        k.effects.register<{ kind: string; who: string }>({
          kind: 'roster_add', owner: 't_roster',
          validate: (raw) => (typeof raw.who === 'string' ? [] : ['who 要是角色的 id']),
          toChanges: (e) => [{ op: 'flag', key: `roster_add:${e.who}`, value: true }],
          describe: (e) => `名冊候選：${e.who}`,
        })
      },
    })
  }
  if (o.home === true || o.home === false) {
    out.push({
      id: 't_home',
      install(k) {
        k.conditions.register({ kind: 'has_home', owner: 't_home', validate: () => [], test: (_c, { state }) => state.flags.has_home === true })
      },
    })
  }
  return out
}

interface Opts {
  pack?: ContentPack
  features?: Feature[]
  fake?: Parameters<typeof fakes>[0]
  rules?: Record<string, any>
  director?: boolean
  actors?: ReturnType<typeof npcActor>[]
  pc?: Rec
  seed?: number
}
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: o.features ?? [characterFeature, lewdFeature, ...(o.director ? [directorFeature] : []), contractFeature, ...fakes(o.fake)],
    content: [o.pack ?? (o.director ? scopePack() : pack())], seed: o.seed ?? 7,
    pc: { hp: 40, skills: {}, ext: { bridge: { ...BRIDGE } }, ...(o.pc ?? {}) },
    actors: o.actors ?? [npcActor(A, '阿晴'), npcActor(B, '小滿')],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 20000, cash: 1000 }, location: { district: 'test', block: 'empty_room' }, ...(o.rules ? { rules: o.rules as never } : {}) },
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
const fx = (g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin', actor = 'pc') => {
  const ctx = effectCtx(g.k, g.state, { source, actor })
  const errors = g.k.effects.validate(effects as never, ctx)
  if (errors.length > 0) return { errors, changes: [] as ReportDraft['changes'], clamps: [] as any[], lines: [] as string[] }
  const res = g.k.effects.resolve(effects as never, ctx)
  if (res.errors.length === 0) g.commit(draft(res.changes, 'test.effect'))
  return { errors: res.errors, changes: res.changes, clamps: res.clamps, lines: res.lines }
}
const hold = (g: G, e: Rec = {}) => fx(g, [{ kind: 'contract_hold', npc: A, type: 'private', ...e }])
const held = (g: G, npc = A) => heldIn(g.state, npc)!
const aff = (g: G, v: number, npc = A) => g.commit(draft([{ op: 'meter', kind: 'affinity', key: npc, set: v }], 'test.aff'))
const loy = (g: G, npc = A) => g.state.meters.loyalty?.[npc] ?? 30
const affOf = (g: G, npc = A) => g.state.meters.affinity?.[npc] ?? 0
const docOf = (g: G, npc = A) => (g.state.actors[npc]!.ext.bridge as Rec).docility as number
const withDice = <T>(v: number, fn: () => T): T => {
  const spy = vi.spyOn(Rng.prototype, 'next')
  spy.mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
const NAT20 = 0.99
const NAT1 = 0
const flagOf = (g: G, key: string) => g.state.flags[key] === true
const snap = (g: G) => JSON.stringify(g.state)

// ---- 規則與格式 ----

describe('規則與格式', () => {
  it('持約人那一面的數字在規則表 holder：親密度 20 才不擲、抗命 −2／−5、關係 60／40、NTR 60、分帳預設 0.1；資料可以蓋掉；格式不對載入時被擋', () => {
    const g = make()
    expect(contractRules(g.k)).toEqual(DEFAULT_CONTRACT_RULES)
    expect(DEFAULT_CONTRACT_RULES.holder).toEqual({ resist_below: 20, refuse_affinity: -2, refuse_loyalty: -5, relation_min: 60, relation_revert: 40, ntr_affinity: 60, default_split: 0.1 })
    const g2 = make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', holder: { relation_min: 70, default_split: 0.2 } }] }) })
    expect(contractRules(g2.k).holder).toEqual({ ...DEFAULT_CONTRACT_RULES.holder, relation_min: 70, default_split: 0.2 })
    hold(g2)
    expect(held(g2).split).toBe(0.2)
    expect(() => make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', holder: { default_split: 2 } }] }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.contract_rule = [{ id: 'default', holder: { nothing: 1 } }] }) })).toThrow(/nothing/)
  })
})

// ---- contract_hold ----

describe('contract_hold', () => {
  it('held 有他、身分 bound（記下原本的）、假的 roster_add 被叫到、發 contract.hold；第二次落空', () => {
    const g = make({ actors: [npcActor(A, '阿晴', { ext: { identity: { class: 'member', extra: 1 } } }), npcActor(B, '小滿')] })
    const r = hold(g, { type: 'debt', debt: 6000, days: 30, orders: ['errand', 'work'], origin: '買下的債' })
    expect(r.errors).toEqual([])
    expect(heldOf(g.state)[A]).toMatchObject({
      id: 'h1', type: 'debt', debt: 6000, orders: ['errand', 'work'], relation: 'formal', home: 'own', split: 0.1, triggered: {}, origin: '買下的債', complied: 0, was_class: 'member', queue: [],
      mark: { covered: false }, until: now(g) + 30 * DAY,
    })
    expect(held(g).holder).toMatchObject({ kind: 'person', npc: 'pc', name: '測試主角' })
    expect(g.state.actors[A]!.ext.identity).toEqual({ class: 'bound', extra: 1 })
    expect(flagOf(g, `roster_add:${A}`)).toBe(true)
    const rep = reports(g, 'contract.hold')
    expect(rep).toHaveLength(1)
    expect(rep[0]!.outcome.summary).toMatch(/阿晴/)
    // 第二次：落空並提醒，什麼也沒變
    const again = hold(g, { type: 'work' })
    expect(again.errors).toEqual([])
    expect(again.changes).toEqual([])
    expect(again.clamps[0]!.notice).toMatch(/已經是他的持約人/)
    expect(held(g).type).toBe('debt')
    expect(reports(g, 'contract.hold')).toHaveLength(1)
    // 沒有人註冊 roster_add 也照樣成立
    const bare = make({ fake: { roster: false } })
    expect(hold(bare).errors).toEqual([])
    expect(heldIn(bare.state, A)).toBeTruthy()
  })

  it('格式與落空：AI 與玩家要的簽不了；債務契約要寫 debt；不是在場的角色或是主角自己落空並提醒；主角身上的契約不受影響', () => {
    const g = make()
    expect(fx(g, [{ kind: 'contract_hold', npc: A, type: 'private' }], 'ai').errors.join()).toBeTruthy()
    expect(fx(g, [{ kind: 'contract_hold', npc: A, type: 'debt' }]).errors.join()).toMatch(/debt/)
    expect(fx(g, [{ kind: 'contract_hold', npc: A, type: 'private', debt: 5 }]).errors.join()).toMatch(/debt/)
    expect(fx(g, [{ kind: 'contract_hold', npc: A, type: 'zzz' }]).errors.join()).toMatch(/type/)
    expect(fx(g, [{ kind: 'contract_hold', npc: A, type: 'private', nothing: 1 }]).errors.join()).toMatch(/nothing/)
    expect(fx(g, [{ kind: 'contract_hold', npc: A, type: 'private', orders: ['dance'] }]).errors.join()).toMatch(/orders/)
    const ghost = fx(g, [{ kind: 'contract_hold', npc: 'npc_ghost', type: 'private' }])
    expect(ghost.errors).toEqual([])
    expect(ghost.clamps[0]!.notice).toMatch(/找不到/)
    expect(fx(g, [{ kind: 'contract_hold', npc: 'pc', type: 'private' }]).clamps[0]!.notice).toMatch(/找不到/)
    expect(heldOf(g.state)).toEqual({})
    hold(g)
    fx(g, [{ kind: 'contract_sign', holder: { kind: 'person', name: '白衣' }, type: 'private' }])
    expect(contractOf(g.state)).toBeTruthy()
    expect(Object.keys(heldOf(g.state))).toEqual([A])
    expect(g.state.actors.pc!.ext.identity).toEqual({ class: 'bound' })
  })

  it('條件 contract 的 side: holder（可以加 npc、type）', () => {
    const g = make()
    const test = (c: Rec) => g.k.conditions.test({ kind: 'contract', ...c } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test({ side: 'holder' })).toBe(false)
    hold(g, { type: 'debt', debt: 100 })
    expect(test({ side: 'holder' })).toBe(true)
    expect(test({ side: 'holder', npc: A })).toBe(true)
    expect(test({ side: 'holder', npc: B })).toBe(false)
    expect(test({ side: 'holder', type: 'debt' })).toBe(true)
    expect(test({ side: 'holder', type: 'work' })).toBe(false)
    expect(test({ side: 'bound' })).toBe(false)
  })
})

// ---- holderEvents ----

describe('holderEvents：現在能對他做的事', () => {
  it('五種都列、各有名字；契約支配關掉時剩三種（差事、工作、談一談）；不是持有的人是空的', () => {
    const g = make()
    hold(g)
    const ev = holderEvents(g.k, g.state, A)
    expect(ev.map((e) => e.kind)).toEqual(['errand', 'modify', 'serve', 'work', 'talk'])
    expect(ev.every((e) => e.available && e.reason === null && e.name.length > 0)).toBe(true)
    expect(holderEvents(g.k, g.state, B)).toEqual([])
    const off = make({ rules: { contentOff: ['contract_dom'] } })
    hold(off)
    expect(holderEvents(off.k, off.state, A).map((e) => e.kind)).toEqual(['errand', 'work', 'talk'])
    expect(reasonOf(() => triggerDraft(off.k, off.state, { npc: A, kind: 'serve' }))).toMatch(/契約支配/)
  })

  it('同一個人同一種一天一次：觸發過之後今天灰掉（寫了原因）、別的種類與別的人不受影響、明天又可以', () => {
    const g = make()
    hold(g)
    hold(g, { npc: B })
    aff(g, 50)
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'errand' }))
    const ev = holderEvents(g.k, g.state, A)
    const errand = ev.find((e) => e.kind === 'errand')!
    expect(errand.available).toBe(false)
    expect(errand.reason).toMatch(/今天已經對阿晴做過/)
    expect(ev.filter((e) => e.kind !== 'errand').every((e) => e.available)).toBe(true)
    expect(holderEvents(g.k, g.state, B).find((e) => e.kind === 'errand')!.available).toBe(true)
    expect(reasonOf(() => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' }))).toMatch(/今天已經/)
    toTime(g, 4, 9)
    expect(holderEvents(g.k, g.state, A).find((e) => e.kind === 'errand')!.available).toBe(true)
    expect(triggerBlock(g.k, g.state, { npc: A, kind: 'errand' })).toBeNull()
  })

  it('紙上劃掉的種類照樣做得了，但標出「紙上劃掉了」、而且他會先擲；借出去的時候五種都灰掉並寫借給誰', () => {
    const g = make()
    hold(g, { orders: ['errand', 'work'] })
    aff(g, 50)
    const ev = holderEvents(g.k, g.state, A)
    expect(ev.find((e) => e.kind === 'errand')).toMatchObject({ crossed_out: false, available: true, resist: null })
    expect(ev.find((e) => e.kind === 'serve')).toMatchObject({ crossed_out: true, available: true })
    expect(ev.find((e) => e.kind === 'serve')!.resist).toMatchObject({ dc: 20 })
    expect(ev.find((e) => e.kind === 'talk')!.crossed_out).toBe(false)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { lend: { to: '老闆', hours: 5 } } }))
    const lent = holderEvents(g.k, g.state, A)
    expect(lent.every((e) => !e.available && /借給老闆/.test(e.reason!))).toBe(true)
  })
})

// ---- 觸發 ----

describe('觸發事件與他的抗拒', () => {
  it('親密度 50 不擲：直接 contract.trigger，帶觸發點 holder_order 與 where；沒有骰子的變更；今天用過', () => {
    const g = make()
    hold(g)
    aff(g, 50)
    const cursor = JSON.stringify(g.state.rng)
    const d = triggerDraft(g.k, g.state, { npc: A, kind: 'serve' })
    expect(d.triggers).toEqual([{ point: 'holder_order', where: { order: 'serve', npc: A, relation: 'formal' } }])
    expect(d.changes.some((c) => c.op === 'rng')).toBe(false)
    g.commit(d)
    expect(reports(g, 'contract.trigger')).toHaveLength(1)
    expect(reports(g, 'contract.trigger')[0]!.triggers).toEqual([{ point: 'holder_order', where: { order: 'serve', npc: A, relation: 'formal' } }])
    expect(JSON.stringify(g.state.rng)).toBe(cursor)
    expect(held(g)).toMatchObject({ complied: 1, triggered: { serve: Math.floor(now(g) / DAY) } })
    expect(affOf(g)).toBe(50)
    expect(loy(g)).toBe(30)
  })

  it('親密度 10 時他先擲：固定骰子讓他成功 → contract.refuse、親密度 −2、忠誠 −5、沒有觸發點；這一次不成立但今天算用過', () => {
    const g = make()
    hold(g)
    aff(g, 10)
    const d = withDice(NAT20, () => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' }))
    expect(d.action).toBe('contract.refuse')
    expect(d.triggers).toBeUndefined()
    g.commit(d)
    expect(affOf(g)).toBe(8)
    expect(loy(g)).toBe(25)
    expect(reports(g, 'contract.trigger')).toHaveLength(0)
    expect(reports(g, 'contract.refuse')).toHaveLength(1)
    expect(held(g).complied).toBe(0)
    expect(held(g).triggered.errand).toBe(Math.floor(now(g) / DAY))
    expect(reasonOf(() => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' }))).toMatch(/今天已經/)
    // 失敗的那一邊：他沒頂住，照樣發觸發點，骰子往前一格
    const g2 = make()
    hold(g2)
    aff(g2, 10)
    const ok = withDice(NAT1, () => triggerDraft(g2.k, g2.state, { npc: A, kind: 'errand' }))
    expect(ok.action).toBe('contract.trigger')
    expect(ok.triggers).toHaveLength(1)
    expect(ok.changes.some((c) => c.op === 'rng')).toBe(true)
    expect(ok.timeline.some((b) => b.roll)).toBe(true)
    g2.commit(ok)
    expect(affOf(g2)).toBe(10)
    expect(held(g2).complied).toBe(1)
  })

  it('紙上劃掉的種類即使親密度夠高也要擲；親密度剛好 20 不擲；量表沒有人定義時當 0（會擲）、抗命成功不寫量表', () => {
    const g = make()
    hold(g, { orders: ['errand'] })
    aff(g, 80)
    expect(withDice(NAT20, () => triggerDraft(g.k, g.state, { npc: A, kind: 'serve' })).action).toBe('contract.refuse')
    expect(withDice(NAT20, () => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' })).action).toBe('contract.trigger')
    aff(g, 20)
    expect(withDice(NAT20, () => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' })).action).toBe('contract.trigger')
    aff(g, 19)
    expect(withDice(NAT20, () => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' })).action).toBe('contract.refuse')
    // 沒有量表
    const bare = make({ fake: { meters: false } })
    hold(bare)
    const d = withDice(NAT20, () => triggerDraft(bare.k, bare.state, { npc: A, kind: 'errand' }))
    expect(d.action).toBe('contract.refuse')
    expect(d.changes.filter((c) => c.op === 'meter')).toEqual([])
    expect(() => bare.commit(d)).not.toThrow()
  })

  it('抗拒的 DC 用他的馴化與主僕關係（夥伴、戀人 −4）、他的沉溺；成功率寫在 holderEvents', () => {
    const g = make({ actors: [npcActor(A, '阿晴', { ext: { bridge: { ...BRIDGE, docility: 70 } }, sink: 65 }), npcActor(B, '小滿')] })
    hold(g)
    aff(g, 10)
    // 12 + 4 + ⌊馴化 ÷ 10⌋ + 沉溺（65 → +2）
    const dc = (kind = 'errand') => holderEvents(g.k, g.state, A).find((e) => e.kind === kind)!.resist!.dc
    const base = 12 + 4 + Math.floor((g.k.stats.stat(g.state, A, 'bridge_docility') as number) / 10) + 2
    expect(dc()).toBe(base)
    aff(g, 70)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'partner' } }))
    aff(g, 10)
    expect(dc()).toBe(base - 4)
    expect(holderEvents(g.k, g.state, A).find((e) => e.kind === 'errand')!.resist!.chance).toBeGreaterThanOrEqual(0)
  })

  it('三次沒被抗命之後他的馴化 +1（一次一件，不同種類同一天也行）；被抗命的不算', () => {
    const g = make()
    hold(g)
    aff(g, 50)
    expect(docOf(g)).toBe(40)
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'errand' }))
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'work' }))
    expect(docOf(g)).toBe(40)
    const third = triggerDraft(g.k, g.state, { npc: A, kind: 'talk' })
    expect(third.outcome.summary).toMatch(/接得更順/)
    g.commit(third)
    expect(held(g).complied).toBe(3)
    expect(docOf(g)).toBe(41)
    toTime(g, 4, 9)
    aff(g, 10)
    g.commit(withDice(NAT20, () => triggerDraft(g.k, g.state, { npc: A, kind: 'errand' })))
    expect(held(g).complied).toBe(3)
    aff(g, 50)
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'work' }))
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'serve' }))
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'talk' }))
    expect(held(g).complied).toBe(6)
    expect(docOf(g)).toBe(42)
    // 沒有橋的人：次數照算，馴化落空
    const nb = make({ actors: [npcActor(A, '阿晴', { ext: { bridge: null } })] })
    hold(nb)
    aff(nb, 50)
    for (const kind of ['errand', 'work', 'talk'] as const) nb.commit(triggerDraft(nb.k, nb.state, { npc: A, kind }))
    expect(held(nb).complied).toBe(3)
    expect(nb.state.actors[A]!.ext.bridge).toBeNull()
  })

  it('不是持有的人、活動進行中（commit:contract.trigger 被擋）、非法的種類都被擋；導演從範圍 contract 挑事件', () => {
    const g = make({ director: true })
    hold(g)
    aff(g, 50)
    expect(triggerBlock(g.k, g.state, { npc: B, kind: 'errand' })).toMatch(/不是你持有/)
    expect(triggerBlock(g.k, g.state, { npc: A, kind: 'dance' as never })).toMatch(/選一種事/)
    expect(reasonOf(() => triggerDraft(g.k, g.state, { npc: 'npc_ghost', kind: 'errand' }))).toMatch(/不是你持有/)
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'talk' }))
    expect(flagOf(g, 'ct_errand_seen')).toBe(false)
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'errand' }))
    expect(flagOf(g, 'ct_errand_seen')).toBe(true)
  })
})

// ---- 調整 ----

describe('調整契約', () => {
  it('主僕關係：親密度 65 改成 partner 可以、45 被擋、改回名實相符不需要；掉到 35、過一個 08:00 自動退回 formal 並發 contract.adjust', () => {
    const g = make()
    hold(g)
    aff(g, 45)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { relation: 'partner' } })).toMatch(/親密度還不到 60/)
    expect(reasonOf(() => adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'partner' } }))).toMatch(/不能選「實為夥伴」/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { relation: 'formal' } })).toMatch(/已經是/)
    aff(g, 65)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { relation: 'partner' } })).toBeNull()
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'partner' } }))
    expect(held(g).relation).toBe('partner')
    expect(reports(g, 'contract.adjust')).toHaveLength(1)
    // 45：不退（40 以下才退）
    aff(g, 45)
    toTime(g, 5, 9)
    expect(held(g).relation).toBe('partner')
    // 35 → 過 08:00 退回
    aff(g, 35)
    toTime(g, 5, 11)
    expect(held(g).relation).toBe('partner')
    toTime(g, 6, 9)
    expect(held(g).relation).toBe('formal')
    const back = reports(g, 'contract.adjust').filter((r) => r.outcome.result === 'relation_reverted')
    expect(back).toHaveLength(1)
    expect(back[0]!.outcome.summary).toMatch(/退回/)
    // 名實相符之後不再發
    toTime(g, 8, 9)
    expect(reports(g, 'contract.adjust').filter((r) => r.outcome.result === 'relation_reverted')).toHaveLength(1)
  })

  it('出借：戀人時被擋；NTR 關掉而親密度 60 以上時被擋（59 可以）；契約支配關掉時被擋；借到時間自己回來（contract.adjust）；可以叫回來', () => {
    const g = make()
    hold(g)
    aff(g, 70)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'lover' } }))
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { lend: { to: '老闆' } } })).toMatch(/戀人/)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'formal' } }))
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { lend: { to: '老闆' } } })).toBeNull()
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { lend: { to: '' } } })).toMatch(/借給誰/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { lend: { to: '老闆', hours: 0 } } })).toMatch(/小時數/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { lend: null } })).toMatch(/沒有借給別人/)
    // 預設借 24 小時
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { lend: { to: '老闆' } } }))
    expect(held(g).lent).toEqual({ to: '老闆', until: now(g) + 24 * 60 })
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { lend: { to: '別人' } } })).toMatch(/已經借給老闆/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { relation: 'play' } })).toBeNull()
    advance(g, 23 * 60)
    expect(held(g).lent).toBeTruthy()
    advance(g, 2 * 60)
    expect(held(g).lent).toBeUndefined()
    expect(reports(g, 'contract.adjust').filter((r) => r.outcome.result === 'lent_back')).toHaveLength(1)
    // 叫回來
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { lend: { to: '老闆', hours: 5 } } }))
    expect(held(g).lent!.until).toBe(now(g) + 300)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { lend: null } }))
    expect(held(g).lent).toBeUndefined()
    // 借出去的時候不能改成戀人
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { lend: { to: '老闆' } } }))
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { relation: 'lover' } })).toMatch(/還借在老闆/)
    // NTR
    const n = make({ rules: { contentOff: ['ntr'] } })
    hold(n)
    aff(n, 59)
    expect(adjustBlock(n.k, n.state, { npc: A, patch: { lend: { to: '老闆' } } })).toBeNull()
    aff(n, 60)
    expect(adjustBlock(n.k, n.state, { npc: A, patch: { lend: { to: '老闆' } } })).toMatch(/NTR/)
    const open = make()
    hold(open)
    aff(open, 90)
    expect(adjustBlock(open.k, open.state, { npc: A, patch: { lend: { to: '老闆' } } })).toBeNull()
    // 契約支配
    const dom = make({ rules: { contentOff: ['contract_dom'] } })
    hold(dom)
    expect(adjustBlock(dom.k, dom.state, { npc: A, patch: { lend: { to: '老闆' } } })).toMatch(/契約支配/)
  })

  it('分帳：0～1 才收，1.5、−0.1、不是數字都被擋；寫了才改', () => {
    const g = make()
    hold(g)
    for (const bad of [1.5, -0.1, Number.NaN, '0.3' as never]) expect(adjustBlock(g.k, g.state, { npc: A, patch: { split: bad } })).toMatch(/0 到 1/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { split: 0.1 } })).toMatch(/已經是這樣/)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { split: 1 } }))
    expect(held(g).split).toBe(1)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { split: 0 } }))
    expect(held(g).split).toBe(0)
  })

  it('規矩：加與拿掉；種類與內容要對、不重複、拿掉的要存在', () => {
    const g = make()
    hold(g, { orders: ['errand'] })
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { rules_add: [{ kind: 'zone', value: 'd_banned' }, { kind: 'curfew', value: 22 }] } }))
    expect(held(g).rules).toEqual([{ kind: 'zone', value: 'd_banned' }, { kind: 'curfew', value: 22 }])
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { rules_add: [{ kind: 'zone', value: 'd_banned' }] } })).toMatch(/已經寫在/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { rules_add: [{ kind: 'dance', value: 'x' } as never] } })).toMatch(/種類/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { rules_add: [{ kind: 'zone', value: 5 }] } })).toMatch(/禁區/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { rules_add: [{ kind: 'dress', value: '' }] } })).toMatch(/內容/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { rules_add: [] } })).toMatch(/清單/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { rules_remove: [{ kind: 'dress', value: 'x' }] } })).toMatch(/沒有這一條/)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { rules_remove: [{ kind: 'zone', value: 'd_banned' }] } }))
    expect(held(g).rules).toEqual([{ kind: 'curfew', value: 22 }])
  })

  it('住處：據點要主角有住處（有人註冊 has_home 才檢查）；工作的安排：一句話、可以清掉', () => {
    const g = make({ fake: { home: true } })
    hold(g)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { home: 'own' } })).toMatch(/已經住在自己的地方/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { home: 'base' } })).toMatch(/還沒有住處/)
    g.commit(draft([{ op: 'flag', key: 'has_home', value: true }]))
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { home: 'base' } }))
    expect(held(g).home).toBe('base')
    expect(heldPeople(g.state)).toEqual([{ id: A, home: 'base' }])
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { home: 'base' } })).toMatch(/已經住在你的據點/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { home: 'sky' as never } })).toMatch(/住處只能是/)
    // 沒有人註冊 has_home：都可以
    const bare = make()
    hold(bare)
    expect(adjustBlock(bare.k, bare.state, { npc: A, patch: { home: 'base' } })).toBeNull()
    // 工作
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { job: null } })).toMatch(/沒有安排工作/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { job: '' } })).toMatch(/一句話/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { job: 'x'.repeat(61) } })).toMatch(/一句話/)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { job: '夜店櫃台' } }))
    expect(held(g).job).toBe('夜店櫃台')
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { job: '夜店櫃台' } })).toMatch(/已經是這樣/)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { job: null } }))
    expect(held(g).job).toBeUndefined()
  })

  it('整份調整一次寫好、其中一項被擋就整份不改；空的、不認得的項目、不是持有的人都被擋', () => {
    const g = make()
    hold(g)
    aff(g, 10)
    const before = snap(g)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { split: 0.5, relation: 'partner' } })).toMatch(/親密度/)
    expect(reasonOf(() => adjustDraft(g.k, g.state, { npc: A, patch: { split: 0.5, relation: 'partner' } }))).toMatch(/親密度/)
    expect(snap(g)).toBe(before)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: {} })).toMatch(/沒有要改/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { split: undefined } })).toMatch(/沒有要改/)
    expect(adjustBlock(g.k, g.state, { npc: A, patch: { debt: 0 } as never })).toMatch(/沒有「debt」/)
    expect(adjustBlock(g.k, g.state, { npc: B, patch: { split: 0.5 } })).toMatch(/不是你持有/)
    aff(g, 70)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { split: 0.5, relation: 'play', job: '跑腿', rules_add: [{ kind: 'dress', value: '制服' }], home: 'base' } }))
    expect(held(g)).toMatchObject({ split: 0.5, relation: 'play', job: '跑腿', home: 'base', rules: [{ kind: 'dress', value: '制服' }] })
    expect(reports(g, 'contract.adjust')).toHaveLength(1)
  })
})

// ---- 解約 ----

describe('解約', () => {
  it('releaseDraft：held 沒有他、身分改回原本的（citizen）、旗標 released:<npc>；stay: false 的那一份帶觸發點 released；stay: true 什麼都不發', () => {
    const g = make()
    hold(g)
    hold(g, { npc: B })
    expect(releaseBlock(g.k, g.state, { npc: A })).toBeNull()
    const d = releaseDraft(g.k, g.state, { npc: A, stay: false })
    expect(d.triggers).toEqual([{ point: 'released', where: { npc: A, relation: 'formal' } }])
    g.commit(d)
    expect(heldIn(g.state, A)).toBeUndefined()
    expect(Object.keys(heldOf(g.state))).toEqual([B])
    expect(g.state.actors[A]!.ext.identity).toEqual({ class: 'citizen' })
    expect(flagOf(g, `released:${A}`)).toBe(true)
    expect(reports(g, 'contract.release')[0]!.triggers).toEqual([{ point: 'released', where: { npc: A, relation: 'formal' } }])
    expect(reasonOf(() => releaseDraft(g.k, g.state, { npc: A }))).toMatch(/不是你持有/)
    // stay
    const s = releaseDraft(g.k, g.state, { npc: B, stay: true })
    expect(s.triggers).toBeUndefined()
    g.commit(s)
    expect(flagOf(g, `released:${B}`)).toBe(true)
    expect(g.state.actors[B]!.ext.identity).toEqual({ class: 'citizen' })
    expect(heldPeople(g.state)).toEqual([])
  })

  it('原本是 member 的解約之後改回 member；別人改過身分的不蓋回去；借出去的、關係不是名實相符的也照樣能解（永遠是選項）', () => {
    const g = make({ actors: [npcActor(A, '阿晴', { ext: { identity: { class: 'member' } } }), npcActor(B, '小滿')] })
    hold(g)
    aff(g, 70)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'play', lend: { to: '老闆' } } }))
    g.commit(releaseDraft(g.k, g.state, { npc: A, stay: true }))
    expect(g.state.actors[A]!.ext.identity).toEqual({ class: 'member' })
    hold(g, { npc: B })
    g.commit(draft([{ op: 'actor.ext', id: B, key: 'identity', value: { class: 'unregistered' } }]))
    g.commit(releaseDraft(g.k, g.state, { npc: B }))
    expect(g.state.actors[B]!.ext.identity).toEqual({ class: 'unregistered' })
  })

  it('效果 contract_release：跟 releaseDraft 一樣；之後的 report.after 發 contract.release（不 stay 時帶觸發點）；沒有持有是落空；AI 要的不收', () => {
    const g = make({ director: true })
    hold(g)
    expect(fx(g, [{ kind: 'contract_release', npc: A }], 'ai').errors.join()).toBeTruthy()
    expect(fx(g, [{ kind: 'contract_release', npc: A, stay: 'yes' }]).errors.join()).toMatch(/stay/)
    expect(fx(g, [{ kind: 'contract_release', npc: B }]).changes).toEqual([])
    const r = fx(g, [{ kind: 'contract_release', npc: A }])
    expect(r.errors).toEqual([])
    expect(heldIn(g.state, A)).toBeUndefined()
    expect(g.state.actors[A]!.ext.identity).toEqual({ class: 'citizen' })
    expect(flagOf(g, `released:${A}`)).toBe(true)
    const rep = reports(g, 'contract.release')
    expect(rep).toHaveLength(1)
    expect(rep[0]!.triggers).toEqual([{ point: 'released', where: { npc: A, relation: 'formal' } }])
    expect(flagOf(g, 'ct_release_seen')).toBe(true)
    expect(heldOf(g.state)).toEqual({})
    // stay: true：發報告、沒有觸發點
    hold(g, { npc: B })
    fx(g, [{ kind: 'contract_release', npc: B, stay: true }])
    const stay = reports(g, 'contract.release')
    expect(stay).toHaveLength(2)
    expect(stay[1]!.triggers).toBeUndefined()
  })
})

// ---- 隨時間 ----

describe('隨時間', () => {
  it('期滿（days）自動解約：contract.release、身分改回、旗標在、帶觸發點 released', () => {
    const g = make()
    hold(g, { days: 2 })
    advance(g, DAY)
    expect(heldIn(g.state, A)).toBeTruthy()
    advance(g, DAY + 5)
    expect(heldIn(g.state, A)).toBeUndefined()
    expect(g.state.actors[A]!.ext.identity).toEqual({ class: 'citizen' })
    expect(flagOf(g, `released:${A}`)).toBe(true)
    const rep = reports(g, 'contract.release')
    expect(rep).toHaveLength(1)
    expect(rep[0]!.outcome.result).toBe('expired')
    expect(rep[0]!.triggers).toEqual([{ point: 'released', where: { npc: A, relation: 'formal' } }])
  })

  it('兩個方向同時有：主角身上有契約、又持有別人，時間過去兩邊各算各的（指令照擲、持約那一面不被蓋掉）', () => {
    const g = make({ director: true })
    fx(g, [{ kind: 'contract_sign', holder: { kind: 'eden', name: '伊甸園', freq: 1 }, type: 'private', report_weekday: 6 }])
    hold(g, { days: 5 })
    aff(g, 70)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'partner', split: 0.3 } }))
    aff(g, 30)
    toTime(g, 6, 12)
    // 持約那一面：關係退回（過了 08:00，親密度 30）
    expect(held(g).relation).toBe('formal')
    expect(held(g).split).toBe(0.3)
    // 契約人那一面：每天都下指令（頻率 100%，佇列 3 條上限）
    expect(contractOf(g.state)!.queue.length).toBeGreaterThan(0)
    expect(boundView(g.k, g.state)).toBeTruthy()
    // 持約滿期（5 天）：解約，契約人那一面不動
    toTime(g, 9, 12)
    expect(heldIn(g.state, A)).toBeUndefined()
    expect(contractOf(g.state)).toBeTruthy()
    expect(g.state.actors.pc!.ext.identity).toEqual({ class: 'bound' })
  })
})

// ---- 面板 ----

describe('面板：holderContractView、heldPeople、掃橋', () => {
  it('契約那一頁：橋權的級別、來歷、剩下的債、他的橋參數、傾向、馴化、親密度與忠誠、規矩、住處、工作、分帳、關係、能調哪些', () => {
    const g = make({ fake: { home: true }, actors: [npcActor(A, '阿晴', { sink: 12, ext: { bridge: { ...BRIDGE }, tendency: { axes: { relation: 2 }, tags: { tg_sub: 'has', bad: 3 } } } }), npcActor(B, '小滿')] })
    expect(holderContractView(g.k, g.state, A)).toBeNull()
    hold(g, { type: 'debt', debt: 8000, origin: '拍賣會上買下的債', orders: ['errand', 'serve', 'work'] })
    aff(g, 65)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { rules_add: [{ kind: 'curfew', value: 22 }], job: '洗碗', split: 0.2 } }))
    const v = holderContractView(g.k, g.state, A)!
    expect(v).toMatchObject({
      npc: A, name: '阿晴', level: 'manage', type: 'debt', type_name: '債務契約', origin: '拍賣會上買下的債', debt: 8000, bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 40 },
      tendency: { axes: { relation: 2 }, tags: { tg_sub: 'has' } }, docility: 40, complied: 0, sink: 12, affinity: 65, loyalty: 30, rules: [{ kind: 'curfew', value: 22 }], home: 'own', home_name: '他自己的住處',
      job: '洗碗', split: 0.2, relation: 'formal', relation_name: '名實相符', lent: null, mark: { covered: false },
    })
    expect(v.tendency!.tags).not.toHaveProperty('bad')
    expect(v.orders.map((o) => [o.kind, o.ticked])).toEqual([['errand', true], ['modify', false], ['serve', true], ['work', true], ['report', false], ['lend', false]])
    expect(v.events.map((e) => e.kind)).toEqual(['errand', 'modify', 'serve', 'work', 'talk'])
    expect(v.adjust.map((a) => a.key)).toEqual(['rules', 'home', 'job', 'split', 'relation', 'lend', 'release'])
    const rel = v.adjust.find((a) => a.key === 'relation')!
    expect(rel.options!.find((o) => o.value === 'partner')!.blocked).toBeNull()
    expect(rel.options!.find((o) => o.value === 'formal')!.blocked).toMatch(/已經是/)
    // 親密度掉下來之後：能調哪些寫著原因
    aff(g, 30)
    const low = holderContractView(g.k, g.state, A)!
    expect(low.adjust.find((a) => a.key === 'relation')!.options!.find((o) => o.value === 'partner')!.blocked).toMatch(/還不到 60/)
    expect(low.adjust.find((a) => a.key === 'home')!.options!.find((o) => o.value === 'base')!.blocked).toMatch(/住處/)
    // 借出去之後：出借那一項是值，不是原因
    aff(g, 50)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { lend: { to: '老闆' } } }))
    expect(holderContractView(g.k, g.state, A)!.lent).toMatchObject({ to: '老闆' })
    // 沒有橋、沒有傾向的人
    const nb = make({ actors: [npcActor(A, '阿晴', { ext: { bridge: null } })] })
    hold(nb)
    expect(holderContractView(nb.k, nb.state, A)).toMatchObject({ bridge: null, tendency: null, docility: 0 })
  })

  it('面板的兩個函式跑過之後狀態一個字都沒變（深比較）；也不擲骰', () => {
    const g = make({ director: true })
    hold(g, { type: 'debt', debt: 100, orders: ['errand'] })
    hold(g, { npc: B })
    aff(g, 10)
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'talk' }))
    const before = snap(g)
    const rng = JSON.stringify(g.state.rng)
    const spy = vi.spyOn(Rng.prototype, 'next')
    for (const npc of [A, B, 'npc_ghost']) {
      holderContractView(g.k, g.state, npc)
      holderEvents(g.k, g.state, npc)
      triggerBlock(g.k, g.state, { npc, kind: 'serve' })
      adjustBlock(g.k, g.state, { npc, patch: { split: 0.5 } })
      releaseBlock(g.k, g.state, { npc })
    }
    heldPeople(g.state)
    heldOf(g.state)
    scanAnswer(g.state, A)
    scanPerson(g.state, A)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(snap(g)).toBe(before)
    expect(JSON.stringify(g.state.rng)).toBe(rng)
    // 回傳的是複製：改它不會動狀態
    heldOf(g.state)[A]!.split = 0.9
    holderContractView(g.k, g.state, A)!.rules.push({ kind: 'zone', value: 'x' })
    expect(snap(g)).toBe(before)
  })

  it('heldPeople 回傳他的 id 與 home（給 M5）；沒有持約的是空陣列', () => {
    const g = make()
    expect(heldPeople(g.state)).toEqual([])
    hold(g, { npc: B })
    hold(g)
    expect(heldPeople(g.state)).toEqual([{ id: A, home: 'own' }, { id: B, home: 'own' }])
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { home: 'base' } }))
    expect(heldPeople(g.state)).toEqual([{ id: A, home: 'base' }, { id: B, home: 'own' }])
  })

  it('scanAnswer：主角是契約人時 class 是 bound、有持約人的名字與 manage；光紋遮著時 covered 是 true；被掃的是主角持有的人時回答他的（持約人是主角）', () => {
    const g = make()
    expect(scanAnswer(g.state, 'pc')).toBeUndefined()
    expect(scanAnswer(g.state, A)).toBeUndefined()
    g.commit(draft([{ op: 'item', id: 'it_collar', qty: 1 }]))
    fx(g, [{ kind: 'contract_sign', holder: { kind: 'person', name: '白衣' }, type: 'private' }])
    expect(scanAnswer(g.state, 'pc')!.contract).toMatchObject({ class: 'bound', holder: '白衣', level: 'manage', marked: true, covered: false })
    hold(g)
    expect(scanAnswer(g.state, A)!.contract).toMatchObject({ class: 'bound', holder: '測試主角', level: 'manage', marked: true, covered: false })
    expect(scanAnswer(g.state, A)!.contract.rights).toEqual([expect.objectContaining({ level: 'manage', holder: expect.objectContaining({ name: '測試主角' }) })])
    expect(scanAnswer(g.state, B)).toBeUndefined()
    expect(scanPerson(g.state, A)).toEqual({ contract: { class: 'bound', holder: '測試主角', level: 'manage', covered: false } })
    // 主角自己的光紋遮起來（直接改狀態：遮光紋的入口在 M4-contract）
    const ext = JSON.parse(JSON.stringify(g.state.ext.contract))
    ext.mine.mark.covered = true
    ext.held[A].mark.covered = true
    g.commit(draft([{ op: 'ext', key: 'contract', value: ext }]))
    expect(scanAnswer(g.state, 'pc')!.contract).toMatchObject({ class: 'bound', marked: false, covered: true })
    expect(scanAnswer(g.state, A)!.contract).toMatchObject({ marked: false, covered: true })
    expect(scanPerson(g.state, A)).toEqual({ contract: { class: 'bound', holder: '測試主角', level: 'manage', covered: true } })
  })

  it('掛點 scan.person：問的時候契約回答 { contract, rights }（主角的讀取與限制級進 rights）；沒有契約什麼都不回答', () => {
    const g = make()
    const ask = (actor: string) => (g.k.hooks as any).run('scan.person', { state: g.state, actor, strength: 2 }).filter((r: any) => r.owner === 'contract')
    expect(ask('pc')).toEqual([])
    fx(g, [{ kind: 'bridge_right', holder: { kind: 'eden', name: '伊甸園' }, level: 'limit', source: 'loan' }])
    expect(ask('pc')[0].result).toEqual({ rights: [{ holder: '伊甸園', level: 'limit' }] })
    fx(g, [{ kind: 'contract_sign', holder: { kind: 'person', name: '白衣' }, type: 'private' }])
    expect(ask('pc')[0].result).toEqual({ contract: { class: 'bound', holder: '白衣', level: 'manage', covered: false }, rights: [{ holder: '伊甸園', level: 'limit' }] })
    hold(g)
    expect(ask(A)[0].result).toEqual({ contract: { class: 'bound', holder: '測試主角', level: 'manage', covered: false } })
    expect(ask(B)).toEqual([])
  })
})

// ---- 存檔與整組功能 ----

describe('存檔、回退與整組功能', () => {
  it('存檔再讀一樣；壞掉的 held 欄位當沒有或用預設，不丟錯；撤退（快照）之後持約那一面跟著回去', () => {
    const g = make()
    hold(g)
    aff(g, 70)
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { relation: 'partner', home: 'base', job: '洗碗', rules_add: [{ kind: 'zone', value: 'd_x' }] } }))
    g.commit(draft([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'test.entry'))
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { split: 0.9 } }))
    const again = make()
    again.load(g.save())
    expect(heldOf(again.state)).toEqual(heldOf(g.state))
    expect(again.state.actors[A]!.ext.identity).toEqual({ class: 'bound' })
    expect(g.rewindToKind('entry', '你撤退了。')).toBeNull()
    expect(held(g).split).toBe(0.1)
    expect(held(g)).toMatchObject({ relation: 'partner', job: '洗碗', home: 'base' })
    // 壞掉的欄位
    const bad = make()
    bad.commit(draft([{ op: 'ext', key: 'contract', value: { held: { [A]: { id: 'h1', holder: { kind: 'person', name: '主角' }, type: 'private', signed: 0, home: 'moon', split: 7, triggered: { errand: 'x', zzz: 1, talk: 3 }, lent: { to: 5 }, job: 3 }, [B]: { nope: true }, junk: 5 } } }], 'test.bad'))
    expect(Object.keys(heldOf(bad.state))).toEqual([A])
    expect(held(bad)).toMatchObject({ home: 'own', split: 0.1, triggered: { talk: 3 }, origin: '' })
    expect(held(bad).lent).toBeUndefined()
    expect(held(bad).job).toBeUndefined()
    expect(() => advance(bad, 3 * DAY)).not.toThrow()
    expect(holderContractView(bad.k, bad.state, A)).toBeTruthy()
  })

  it('裝在整組功能裡也一樣（FEATURES）：真的 roster_add、觸發、調整、解約', () => {
    const { game: g } = makeGame({
      features: Object.values(FEATURES), content: [pack()], seed: 7, pc: { hp: 40, ext: { bridge: { ...BRIDGE } } }, actors: [npcActor(A, '阿晴')],
      patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 20000, cash: 1000 } },
    })
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    const effects = [{ kind: 'contract_hold', npc: A, type: 'private', origin: '託付' }]
    expect(g.k.effects.validate(effects as never, ctx)).toEqual([])
    const res = g.k.effects.resolve(effects as never, ctx)
    expect(res.errors).toEqual([])
    g.commit(draft(res.changes, 'test.effect'))
    expect(heldIn(g.state, A)).toBeTruthy()
    expect(JSON.stringify(g.state.ext)).toContain('npc_a')
    expect(g.state.ext.roster).toBeTruthy()
    g.commit(triggerDraft(g.k, g.state, { npc: A, kind: 'talk' }))
    expect(holderContractView(g.k, g.state, A)).toBeTruthy()
    g.commit(adjustDraft(g.k, g.state, { npc: A, patch: { split: 0.3 } }))
    g.commit(releaseDraft(g.k, g.state, { npc: A, stay: true }))
    expect(heldPeople(g.state)).toEqual([])
  })
})
