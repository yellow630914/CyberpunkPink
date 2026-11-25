// 驗收測試：dev/work/M4-cyber-lock.md（cpp-feature）。規格：CYBERWARE 第 1 節（光紋刺青）、第 5 節（授權鎖、二手貨）；CRAFTING 第 4 節、10.3 節；TRADE 3.4 節；DOWNTIME 3.1 節、第 5 節；
// dev/adr/0019 第三節「授權鎖」與 P11、P12、P45。
// 內容一律用測試自帶的最小假資料：訂閱的義眼（成品價 1,000）、義臂、全生體的獸耳、帶 scan_proof 的零件、橋、光紋刺青；三種診所用真的 world 的設施。
// bills、security、abilities、malware 都不裝：每週帳單用掛點 bill.collect／bill.settled 直接跑；敵對值是測試自己定義的量表；條件 ability 與效果 malware 是測試的替身。
// 骰子：用 vi.spyOn(Rng.prototype, 'next') 固定每一次 next() 的值（只包住「建草稿」那一步，提交不受影響）。
//
// 時間：測試從第 3 天 10:00 開始。成品價 ＝ 零件目錄價合計 × 1.2：義臂 1200、訂閱的義眼 1000。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ContentPack, Effect, Feature, ReportDraft } from '../../src'
import { ActionBlocked, Rng, UNREG_STACK_ID, effectCtx, meterOf, slotProblems, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import {
  crackBlock, crackDraft, crackQuote, cyberOf, cyberView, cyberwareFeature, installDraft, lockView, modifyBlock, modifyDraft, modifyQuote, payLockBlock, payLockDraft, removeBlock, removeDraft,
  repairBlock, repairDraft, repairQuote,
} from '../../src/features/cyberware'
import { arrive, worldFeature } from '../../src/features/world'
import { makeGame } from '../../src/testkit'

// ---- 假資料 ----

type Rec = Record<string, any>

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F...#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
}

const part = (id: string, type: string, over: Rec = {}): Rec => ({
  id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over,
})
const PARTS = [
  part('pt_plate', 'plate', { price: 400, stats: { armor: 2 } }),
  part('pt_plating', 'plate', { price: 250, stats: { armor: 3 } }),
  part('pt_act', 'actuator', { price: 300 }),
  part('pt_neuron', 'neuron', { price: 300 }),
  part('pt_neuron_cool', 'neuron', { price: 300, stats: { sink: -2 } }),
  part('pt_lens', 'sensor', { price: 500 }),
  part('pt_chip', 'chip', { price: 100 }),
  part('pt_chip2', 'chip', { price: 333 }),
  part('pt_bridge_chip', 'chip', { price: 1000 }),
  part('pt_ear', 'skin', { price: 500, material: 'bio' }),
  part('pt_ghost', 'plate', { price: 200, traits: ['scan_proof'] }),
  part('pt_ink', 'skin', { price: 200 }),
]

const bp = (id: string, over: Rec = {}): Rec => ({
  id, kind: 'cyberware', name: id, desc: '一件義體。', brand: 'hz', grade: 1, legal: 'register', price: 900, require: [], optional: [], ...over,
})
const BLUEPRINTS = [
  bp('bp_arm', {
    name: '義臂', slot: 'arm', invasiveness: 'invasive', sink_cost: 6, grade: 3, effects: [{ attr: 'body', amount: 1 }],
    require: [{ type: 'plate', material: 'mech' }, { type: 'actuator', material: 'mech' }, { type: 'neuron' }],
  }),
  // 訂閱的義眼：零件 500 + 333，成品價 round(833 × 1.2) = 1,000
  bp('bp_subeye', {
    name: '企業義眼', slot: 'eye', invasiveness: 'light', sink_cost: 3, grade: 2, lock: 'subscription', effects: [{ attr: 'reflex', amount: 1 }],
    require: [{ type: 'sensor' }, { type: 'chip' }],
  }),
  bp('bp_eye', { name: '義眼', slot: 'eye', invasiveness: 'light', sink_cost: 2, grade: 1, require: [{ type: 'sensor' }], effects: [{ attr: 'charm', amount: 1 }] }),
  bp('bp_ears', { name: '獸耳', slot: 'ear_throat', invasiveness: 'light', sink_cost: 4, grade: 1, needs_bridge: false, require: [{ type: 'skin', material: 'bio' }] }),
  bp('bp_ghost', { name: '隱形板', slot: 'torso', invasiveness: 'light', sink_cost: 1, grade: 1, needs_bridge: false, require: [{ type: 'plate' }] }),
  bp('bp_tattoo_gang', {
    name: '幫派光紋', slot: 'skin', invasiveness: 'surface', sink_cost: 0, grade: 1, needs_bridge: false, tattoo: { kind: 'gang', faction: 'f1' },
    require: [{ type: 'skin' }], effects: [{ attr: 'charm', amount: 1 }],
  }),
  bp('bp_tattoo_deco', { name: '裝飾光紋', slot: 'skin', invasiveness: 'surface', sink_cost: 0, grade: 1, needs_bridge: false, tattoo: { kind: 'deco' }, require: [{ type: 'skin' }] }),
  bp('bp_bridge', { name: '邊緣橋', slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, grade: 2, bridge: { tuning_slots: 2 }, require: [{ type: 'chip' }] }),
]
const QUIRKS = [
  { id: 'cx_echo', name: '殘響甲', desc: '前一個主人的感覺。', kind: 'echo', pool: ['used'] },
  { id: 'cx_echo2', name: '殘響乙', desc: '另一個主人的感覺。', kind: 'echo', pool: ['used'] },
  { id: 'cx_scar', name: '疤痕組織', desc: '縫合的地方留了疤。', kind: 'complication', pool: ['complication'] },
]
const ARM_PARTS = { plate: 'pt_plate', actuator: 'pt_act', neuron: 'pt_neuron' }
const EYE_PARTS = { sensor: 'pt_lens', chip: 'pt_chip2' }

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_clinic', name: '診所', clinic: { grade: 'clinic' } },
      { id: 'fac_unlic', name: '無照診所', clinic: { grade: 'unlicensed' } },
      { id: 'fac_black', name: '黑診所', clinic: { grade: 'black' } },
    ],
    faction: [{ id: 'f1', name: '第一企業', short: '一企', class: 'corp' }],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [
      { id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_clinic', name: '正規診所' }, F2: { type: 'fac_unlic', name: '無照診所' }, F3: { type: 'fac_black', name: '黑診所' } } },
    ],
    part: structuredClone(PARTS),
    blueprint: structuredClone(BLUEPRINTS),
    quirk: structuredClone(QUIRKS),
  }
  patch(c)
  return { id: 'cyber_lock_test', content: c as unknown as ContentPack['content'] }
}

/** 測試的替身：armor、條件 at_home（旗標 home）、量表 hostility（照勢力分開記）。 */
const STUBS: Feature = {
  id: 'lock_stubs',
  install(k) {
    k.stats.defineStat({ id: 'armor', owner: 'lock_stubs', name: '護甲值', base: () => 0 })
    k.conditions.register<Condition>({ kind: 'at_home', owner: 'lock_stubs', validate: () => [], test: (_c, { state }) => state.flags.home === true })
    k.meters.define({ kind: 'hostility', owner: 'lock_stubs', name: '敵對值', min: 0, max: 100, start: 0, keyed: 'faction' })
  },
}
/** 條件 ability：手術（daily: 'surgery'）一律成立；解鎖匠（daily: 'unlock'）看旗標 unlocker。沒裝就沒有自己動刀、也沒有解鎖匠。 */
const ABILITY: Feature = {
  id: 'ability_stub',
  install(k) {
    k.conditions.register<Condition & { daily?: string }>({
      kind: 'ability', owner: 'ability_stub', validate: () => [], test: (c, { state }) => (c.daily === 'unlock' ? state.flags.unlocker === true : true),
    })
  },
}
/** 效果 malware 的替身（M4-malware 的格式：{ pool, piece }）：叫到一次記一筆。 */
function malwareStub(calls: Rec[]): Feature {
  return {
    id: 'malware_stub',
    install(k) {
      k.effects.register<Effect>({
        kind: 'malware', owner: 'malware_stub', ai: false, validate: () => [], toChanges: (e) => { calls.push(e); return [] }, describe: () => '種下了',
      })
    },
  }
}

interface Opts {
  ability?: boolean
  pack?: ContentPack
  money?: { cred: number; cash: number }
  extra?: Feature[]
}
const make = (o: Opts = {}) => {
  const features: Feature[] = [characterFeature, worldFeature, STUBS, cyberwareFeature, ...(o.ability ? [ABILITY] : []), ...(o.extra ?? [])]
  const { game } = makeGame({
    features, content: [o.pack ?? pack()], seed: 7, pc: { hp: 40, skills: { cyberware: 2 } },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const now = (g: G) => toMinutes(g.state.time)
const last = (g: G) => g.state.reports[g.state.reports.length - 1]!
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const attr = (g: G, a: 'body' | 'reflex' | 'charm') => g.k.stats.effectiveAttr(g.state, 'pc', a)
const armor = (g: G) => g.k.stats.stat(g.state, 'pc', 'armor')
const floor = (g: G) => g.k.stats.stat(g.state, 'pc', 'sink_floor')
const hostility = (g: G) => meterOf(g.k, g.state, 'hostility', 'f1')
const test = (g: G, cond: Rec) => g.k.conditions.test(cond as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
const give = (g: G, id: string, parts: Rec, uid: string, extra: Rec = {}) => { g.state.inventory.push({ id, qty: 1, data: { uid, parts, ...extra } }) }
/** 直接把身上的義體寫成這幾件（一件的預設值：已經好了、沒有鎖） */
const piece = (uid: string, bpId: string, slot: string, over: Rec = {}): Rec => ({ uid, bp: bpId, kind_of: 'blueprint', slot, parts: {}, sink: 3, at: 0, ...over })
const put = (g: G, pieces: Rec[]) => { g.commit(draft([{ op: 'actor.ext', id: 'pc', key: 'cyber', value: { pieces } }], 'test.put')) }
const rawPieces = (g: G): Rec[] => (g.state.actors.pc!.ext.cyber as Rec).pieces
const hooks = (g: G) => g.k.hooks as unknown as { run(name: string, payload: unknown): Array<{ owner: string; result: any }> }
const SUB_LOCK = { kind: 'subscription', holder: 'f1' }
const subEye = (over: Rec = {}): Rec => piece('s1', 'bp_subeye', 'eye', { parts: EYE_PARTS, lock: { ...SUB_LOCK }, ...over })

/** 內建來源的效果：解出變更（報告草稿的內容），一批一批套。 */
const fx = (g: G, effects: Rec[], source: 'builtin' | 'ai' | 'player' = 'builtin') => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
const applyFx = (g: G, effects: Rec[]) => {
  const res = fx(g, effects)
  expect(res.errors).toEqual([])
  g.commit(draft(res.changes, 'test.fx'))
  return res
}

/** 把每一次 next() 固定成 v，只包住 fn。 */
function withDice<T>(v: number, fn: () => T): T {
  const spy = vi.spyOn(Rng.prototype, 'next').mockReturnValue(v)
  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}
afterEach(() => { vi.restoreAllMocks() })

// 骰面：自然骰 = 1 + floor(next × 20)；技能 2、屬性調整 0
const NAT20 = 0.99
const NAT12 = 0.55 // 合計 14：對 DC 16 失敗（差 2）、對 DC 13 成功
const NAT10 = 0.45 // 合計 12：對 DC 13 失敗（差 1）
const NAT1 = 0

// ---- 訂閱 ----

describe('訂閱：每週帳單與鎖', () => {
  it('bill.collect 出一行：名字加「訂閱」、30（成品價 1,000 的 3%）、order 2、帳戶；沒有訂閱的件不出', () => {
    const g = make()
    put(g, [subEye(), piece('e2', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' } })])
    const lines = hooks(g).run('bill.collect', { state: g.state, week: 1 }).filter((r) => r.owner === 'cyberware').flatMap((r) => r.result)
    expect(lines).toEqual([{ id: 'cyber_sub.s1', owner: 'cyberware', name: '企業義眼訂閱', kind: 'due', amount: 30, order: 2, pay: 'cred' }])
  })

  it('lock.weekly 寫了照寫的；沒有訂閱的人（買斷、契約）沒有帳單', () => {
    const g = make()
    put(g, [subEye({ lock: { kind: 'subscription', weekly: 77 } }), piece('c1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, lock: { kind: 'contract', holder: 'f1' } })])
    const lines = hooks(g).run('bill.collect', { state: g.state, week: 1 }).flatMap((r) => r.result)
    expect(lines.map((l: Rec) => [l.id, l.amount])).toEqual([['cyber_sub.s1', 77]])
  })

  it('沒付成（unpaid 30）之後鎖住：效果沒有、sink_floor 沒變、拆被擋；欠的記進 owed', () => {
    const g = make()
    put(g, [subEye()])
    expect(attr(g, 'reflex')).toBe(11)
    const base = floor(g)
    expect(base).toBe(3)
    const lines = hooks(g).run('bill.collect', { state: g.state, week: 1 }).flatMap((r) => r.result).map((l: Rec) => ({ ...l, paid: 0, unpaid: 30 }))
    const changes = hooks(g).run('bill.settled', { state: g.state, week: 1, lines }).flatMap((r) => r.result)
    g.commit(draft(changes, 'test.settle'))
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ off: { why: 'lock' }, lock: { kind: 'subscription', owed: 30 } })
    expect(attr(g, 'reflex')).toBe(10)
    expect(floor(g)).toBe(base)
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 's1', via: 'clinic' })).toBe('有授權鎖，要先解鎖。')
    expect(cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'eye')!.pieces[0]).toMatchObject({ status: 'off', off: { why: 'lock' }, lock: { kind: 'subscription', owed: 30 } })
    expect(lockView(g.k, g.state, 'pc')).toEqual([{ uid: 's1', bp: 'bp_subeye', name: '企業義眼', slot: 'eye', kind: 'subscription', holder: 'f1', weekly: 30, owed: 30, locked: true }])
  })

  it('payLockDraft 付 30 之後解開、錢扣了、欠款歸零；沒欠款的不能補繳；錢不夠被擋', () => {
    const g = make()
    put(g, [subEye({ off: { why: 'lock' }, lock: { ...SUB_LOCK, owed: 30 } })])
    expect(attr(g, 'reflex')).toBe(10)
    const poor = make({ money: { cred: 10, cash: 10 } })
    put(poor, [subEye({ off: { why: 'lock' }, lock: { ...SUB_LOCK, owed: 30 } })])
    expect(payLockBlock(poor.k, poor.state, { actor: 'pc', uid: 's1' })).toContain('錢不夠')
    g.commit(payLockDraft(g.k, g.state, { actor: 'pc', uid: 's1' }))
    expect(g.state.money.cred).toBe(20000 - 30)
    expect(attr(g, 'reflex')).toBe(11)
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ lock: { kind: 'subscription', owed: 0 } })
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    expect(last(g)).toMatchObject({ action: 'cyber.pay', outcome: { result: 'paid' } })
    expect(payLockBlock(g.k, g.state, { actor: 'pc', uid: 's1' })).toContain('沒有欠款')
    expect(payLockBlock(g.k, g.state, { actor: 'pc', uid: 'nope' })).toBe('身上沒有這一件義體。')
  })

  it('付了而且 owed 是 0 的解開；付了但還有舊欠款的繼續鎖；skipped 的不動它', () => {
    const g = make()
    put(g, [subEye({ off: { why: 'lock' }, lock: { ...SUB_LOCK, owed: 0 } })])
    const paid = (over: Rec) => hooks(g).run('bill.settled', { state: g.state, week: 1, lines: [{ id: 'cyber_sub.s1', owner: 'cyberware', name: 'x', kind: 'due', amount: 30, order: 2, pay: 'cred', paid: 30, unpaid: 0, ...over }] }).flatMap((r) => r.result)
    g.commit(draft(paid({ skipped: true }), 'test.settle'))
    expect(cyberOf(g.state, 'pc')[0]!.off).toEqual({ why: 'lock' })
    g.commit(draft(paid({}), 'test.settle'))
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    const h = make()
    put(h, [subEye({ off: { why: 'lock' }, lock: { ...SUB_LOCK, owed: 30 } })])
    const changes = hooks(h).run('bill.settled', { state: h.state, week: 2, lines: [{ id: 'cyber_sub.s1', owner: 'cyberware', name: 'x', kind: 'due', amount: 30, order: 2, pay: 'cred', paid: 30, unpaid: 0 }] }).flatMap((r) => r.result)
    expect(changes).toEqual([])
    expect(cyberOf(h.state, 'pc')[0]!.off).toEqual({ why: 'lock' })
  })

  it('連續欠兩週：owed 累加、已經鎖住的不重複鎖', () => {
    const g = make()
    put(g, [subEye()])
    for (let week = 1; week <= 2; week++) {
      const lines = hooks(g).run('bill.collect', { state: g.state, week }).flatMap((r) => r.result).map((l: Rec) => ({ ...l, paid: 0, unpaid: l.amount }))
      g.commit(draft(hooks(g).run('bill.settled', { state: g.state, week, lines }).flatMap((r) => r.result), 'test.settle'))
    }
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ off: { why: 'lock' }, lock: { owed: 60 } })
  })

  it('規則表 subscription_rate 蓋掉預設', () => {
    const g = make({ pack: pack((c) => { c.cyber_rule = [{ id: 'default', subscription_rate: 0.1 }] }) })
    put(g, [subEye()])
    expect(hooks(g).run('bill.collect', { state: g.state, week: 1 }).flatMap((r) => r.result)[0].amount).toBe(100)
  })
})

// ---- 破解 ----

describe('破解授權鎖', () => {
  const locked = (): Rec => subEye({ off: { why: 'lock' }, lock: { ...SUB_LOCK, owed: 30 } })

  it('報價：DC ＝ 設計圖等級 II 的 13 ＋ 3 = 16；沒有鎖的、身上沒有的、動刀的人不在隊上都被擋', () => {
    const g = make()
    put(g, [locked(), piece('e2', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' } })])
    expect(crackQuote(g.k, g.state, { actor: 'pc', uid: 's1' })).toMatchObject({ dc: 16, bonus: 2, unlocker: false, faction: 'f1', minutes: 60 })
    expect(crackBlock(g.k, g.state, { actor: 'pc', uid: 'e2' })).toBe('義眼沒有授權鎖可以破解。')
    expect(crackBlock(g.k, g.state, { actor: 'pc', uid: 'zz' })).toBe('身上沒有這一件義體。')
    expect(crackBlock(g.k, g.state, { actor: 'pc', uid: 's1', by: 'ghost' })).toBe('找不到動刀的人。')
    expect(crackBlock(g.k, g.state, { actor: 'pc', uid: 's1' })).toBeNull()
  })

  it('成功：lock 與 off 都沒了、效果回來、時間照花；大成功一樣', () => {
    const g = make()
    put(g, [locked()])
    const t0 = now(g)
    g.commit(withDice(NAT20, () => crackDraft(g.k, g.state, { actor: 'pc', uid: 's1' })))
    expect(cyberOf(g.state, 'pc')[0]!.lock).toBeUndefined()
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    expect(attr(g, 'reflex')).toBe(11)
    expect(now(g) - t0).toBe(60)
    expect(hostility(g)).toBe(0)
    expect(last(g)).toMatchObject({ action: 'cyber.crack', outcome: { result: 'cracked' } })
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
  })

  it('失敗：鎖還在、假量表多 5（勢力的鎖）；holder 不是勢力只寫一句', () => {
    const g = make()
    put(g, [locked()])
    g.commit(withDice(NAT12, () => crackDraft(g.k, g.state, { actor: 'pc', uid: 's1' })))
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ lock: { kind: 'subscription' }, off: { why: 'lock' } })
    expect(hostility(g)).toBe(5)
    expect(last(g)).toMatchObject({ outcome: { result: 'failed' } })
    const h = make()
    put(h, [subEye({ off: { why: 'lock' }, lock: { kind: 'subscription', holder: 'npc_boss', owed: 30 } })])
    h.commit(withDice(NAT12, () => crackDraft(h.k, h.state, { actor: 'pc', uid: 's1' })))
    expect(hostility(h)).toBe(0)
    expect(last(h).narration?.results?.join('')).toContain('回報')
  })

  it('沒有量表的局：失敗只寫一句、不出錯', () => {
    const bare: Feature = { id: 'x', install() {} }
    const { game } = makeGame({ features: [characterFeature, worldFeature, cyberwareFeature, bare], content: [pack()], seed: 7, pc: { hp: 40, skills: { cyberware: 2 } } })
    game.commit(draft([{ op: 'actor.ext', id: 'pc', key: 'cyber', value: { pieces: [locked()] } }], 'test.put'))
    game.commit(withDice(NAT12, () => crackDraft(game.k, game.state, { actor: 'pc', uid: 's1' })))
    expect(last(game).narration?.results?.join('')).toContain('回報')
  })

  it('大失敗：那一件壞掉（off.why 是 broken）、鎖還在、敵對值 +5', () => {
    const g = make()
    put(g, [locked()])
    g.commit(withDice(NAT1, () => crackDraft(g.k, g.state, { actor: 'pc', uid: 's1' })))
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ off: { why: 'broken' }, lock: { kind: 'subscription' } })
    expect(hostility(g)).toBe(5)
    expect(last(g)).toMatchObject({ outcome: { result: 'broken' } })
  })

  it('註冊了條件 ability 之後：解鎖匠檢定 +2、失敗不加敵對值（大失敗還是壞）；不是解鎖匠照舊', () => {
    const g = make({ ability: true })
    put(g, [locked()])
    expect(crackQuote(g.k, g.state, { actor: 'pc', uid: 's1' })).toMatchObject({ unlocker: false, bonus: 2 })
    g.commit(withDice(NAT12, () => crackDraft(g.k, g.state, { actor: 'pc', uid: 's1' })))
    expect(hostility(g)).toBe(5)
    g.state.flags.unlocker = true
    expect(crackQuote(g.k, g.state, { actor: 'pc', uid: 's1' })).toMatchObject({ unlocker: true, bonus: 4 })
    expect(crackQuote(g.k, g.state, { actor: 'pc', uid: 's1' })!.faction).toBeUndefined()
    // 骰 12 ＋ 4 ＝ 16 剛好成功
    g.commit(withDice(NAT12, () => crackDraft(g.k, g.state, { actor: 'pc', uid: 's1' })))
    expect(cyberOf(g.state, 'pc')[0]!.lock).toBeUndefined()
    const h = make({ ability: true })
    h.state.flags.unlocker = true
    put(h, [locked()])
    h.commit(withDice(NAT10, () => crackDraft(h.k, h.state, { actor: 'pc', uid: 's1' })))
    expect(hostility(h)).toBe(0)
    expect(cyberOf(h.state, 'pc')[0]!.off).toEqual({ why: 'lock' })
    const f = make({ ability: true })
    f.state.flags.unlocker = true
    put(f, [locked()])
    f.commit(withDice(NAT1, () => crackDraft(f.k, f.state, { actor: 'pc', uid: 's1' })))
    expect(hostility(f)).toBe(0)
    expect(cyberOf(f.state, 'pc')[0]!.off).toEqual({ why: 'broken' })
  })

  it('規則表 crack_dc_bonus 與 crack_hostility 蓋掉預設', () => {
    const g = make({ pack: pack((c) => { c.cyber_rule = [{ id: 'default', crack_dc_bonus: 0, crack_hostility: 9 }] }) })
    put(g, [locked()])
    expect(crackQuote(g.k, g.state, { actor: 'pc', uid: 's1' })!.dc).toBe(13)
    g.commit(withDice(NAT10, () => crackDraft(g.k, g.state, { actor: 'pc', uid: 's1' })))
    expect(hostility(g)).toBe(9)
  })
})

// ---- 四個效果 ----

describe('四個效果', () => {
  it('cyber_install：直接多一件（沒有扣錢、沒有 recovering、沉溺補到下限）；零件沒寫用 stock', () => {
    const g = make({ pack: pack((c) => { c.blueprint!.find((b) => b.id === 'bp_eye')!.stock = { sensor: 'pt_lens' } }) })
    const money = { ...g.state.money }
    const t0 = now(g)
    const res = applyFx(g, [{ kind: 'cyber_install', blueprint: 'bp_eye' }])
    expect(res.lines).toEqual(['裝上了：義眼（眼）'])
    const [p] = cyberOf(g.state, 'pc')
    expect(p).toMatchObject({ bp: 'bp_eye', slot: 'eye', sink: 2, parts: { sensor: 'pt_lens' }, state: 'new' })
    expect(p!.ready_at).toBeUndefined()
    expect(g.state.money).toEqual(money)
    expect(now(g)).toBe(t0)
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'recovering')).toBe(false)
    expect(floor(g)).toBe(2)
    expect(g.state.actors.pc!.sink).toBe(2)
    expect(attr(g, 'charm')).toBe(11)
  })

  it('cyber_install：帶 lock 與 quirks；臂不指左右先放左邊（兩槽）再放右邊；槽滿時落空並有提醒', () => {
    const g = make()
    const res = applyFx(g, [
      { kind: 'cyber_install', blueprint: 'bp_arm', parts: ARM_PARTS, lock: { kind: 'contract', holder: 'f1' }, quirks: ['cx_scar'] },
      { kind: 'cyber_install', blueprint: 'bp_arm', parts: ARM_PARTS },
      { kind: 'cyber_install', blueprint: 'bp_arm', parts: ARM_PARTS },
      { kind: 'cyber_install', blueprint: 'bp_eye', parts: { sensor: 'pt_lens' } },
      { kind: 'cyber_install', blueprint: 'bp_eye', parts: { sensor: 'pt_lens' } },
      { kind: 'cyber_install', blueprint: 'bp_eye', parts: { sensor: 'pt_lens' } },
    ])
    const ps = cyberOf(g.state, 'pc')
    expect(ps.map((p) => p.slot)).toEqual(['arm_l', 'arm_l', 'arm_r', 'eye', 'eye'])
    expect(ps[0]).toMatchObject({ lock: { kind: 'contract', holder: 'f1', owed: 0 }, quirks: ['cx_scar'] })
    expect(new Set(ps.map((p) => p.uid)).size).toBe(5)
    expect(res.lines[5]).toBe('眼的槽已經滿了，義眼沒有裝上。')
    // 撞了 uid 的東西不會有：流水號用掉
    expect(g.state.seq.uid).toBeGreaterThanOrEqual(5)
  })

  it('cyber_install 的格式：不是義體、橋、不存在的零件、槽對不上、壞的 lock 都被擋', () => {
    const g = make()
    const errs = (e: Rec) => fx(g, [e]).errors.join('；')
    expect(errs({ kind: 'cyber_install', blueprint: 'nope' })).toContain('沒有 nope 這張設計圖')
    expect(errs({ kind: 'cyber_install', blueprint: 'bp_bridge' })).toContain('換橋是另一種手術')
    expect(errs({ kind: 'cyber_install', blueprint: 'bp_eye', parts: { sensor: 'pt_nope' } })).toContain('找不到這個零件')
    expect(errs({ kind: 'cyber_install', blueprint: 'bp_eye', parts: { sensor: 'pt_plate' } })).toContain('這個槽要的是')
    expect(errs({ kind: 'cyber_install', blueprint: 'bp_eye', slot: 'torso' })).toContain('slot 對不上設計圖的部位')
    expect(errs({ kind: 'cyber_install', blueprint: 'bp_eye', lock: { kind: 'free' } })).toContain('lock.kind')
    expect(errs({ kind: 'cyber_install', blueprint: 'bp_eye', quirks: ['nope'] })).toContain('沒有 nope 這個 quirk')
  })

  it('cyber_take：預設整件消失（沉溺不動、下限降）；to: bag 回到背包；多件符合拿照槽順序的第一件；橋拿不走', () => {
    const g = make()
    put(g, [piece('b1', 'bp_bridge', 'bridge', { parts: { chip: 'pt_bridge_chip' }, sink: 4 }), piece('a1', 'bp_arm', 'arm_r', { parts: ARM_PARTS, sink: 5 }), piece('a2', 'bp_arm', 'arm_l', { parts: ARM_PARTS, sink: 5 }), piece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, sink: 2 })])
    g.state.actors.pc!.sink = 12
    expect(floor(g)).toBe(4 + 5 + 5 + 2)
    const res = applyFx(g, [{ kind: 'cyber_take', slot: 'arm' }])
    expect(res.lines).toEqual(['被拿走：義臂'])
    // arm_l 的 a2 在 arm_r 的 a1 前面（照槽順序）
    expect(cyberOf(g.state, 'pc').map((p) => p.uid)).toEqual(['b1', 'a1', 'e1'])
    expect(g.state.inventory.some((s) => s.id === 'bp_arm')).toBe(false)
    expect(g.state.actors.pc!.sink).toBe(12)
    expect(floor(g)).toBe(4 + 5 + 2)
    // 橋拿不走
    expect(fx(g, [{ kind: 'cyber_take', slot: 'bridge' }]).lines).toEqual(['身上沒有符合的義體可以拿走。'])
    applyFx(g, [{ kind: 'cyber_take', uid: 'a1', to: 'bag' }])
    const bag = g.state.inventory.find((s) => s.id === 'bp_arm')!
    expect(bag.data).toMatchObject({ uid: 'a1', state: 'used', parts: ARM_PARTS })
    expect(cyberOf(g.state, 'pc').map((p) => p.uid)).toEqual(['b1', 'e1'])
  })

  it('cyber_take to bag：全生體的拆下來就死了，背包裡沒有東西', () => {
    const g = make()
    put(g, [piece('r1', 'bp_ears', 'ear_throat', { parts: { skin: 'pt_ear' }, sink: 4 })])
    applyFx(g, [{ kind: 'cyber_take', uid: 'r1', to: 'bag' }])
    expect(cyberOf(g.state, 'pc')).toEqual([])
    expect(g.state.inventory.some((s) => s.id === 'bp_ears')).toBe(false)
  })

  it('cyber_lock：鎖住（效果停、成本照算）、解開；帶 hours: 24 的一天後自己解開，下一次寫入時清掉', () => {
    const g = make()
    put(g, [piece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, sink: 2 }), piece('e2', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, sink: 2 })])
    expect(attr(g, 'charm')).toBe(12)
    applyFx(g, [{ kind: 'cyber_lock', uid: 'e1', on: true, hours: 24 }])
    expect(rawPieces(g)[0]!.off).toEqual({ why: 'lock', until: now(g) + 1440 })
    expect(attr(g, 'charm')).toBe(11)
    expect(floor(g)).toBe(4)
    expect(removeBlock(g.k, g.state, { actor: 'pc', uid: 'e1', via: 'clinic' })).toBe('有授權鎖，要先解鎖。')
    advance(g, 1439)
    expect(attr(g, 'charm')).toBe(11)
    advance(g, 1)
    expect(attr(g, 'charm')).toBe(12)
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    expect(rawPieces(g)[0]!.off).toBeDefined() // 還沒寫過
    applyFx(g, [{ kind: 'cyber_lock', uid: 'e2', on: true }])
    expect(rawPieces(g)[0]!.off).toBeUndefined() // 寫 pieces 時順手清掉
    expect(rawPieces(g)[1]!.off).toEqual({ why: 'lock' })
    applyFx(g, [{ kind: 'cyber_lock', slot: 'eye', on: false }])
    expect(rawPieces(g).every((p) => p.off === undefined)).toBe(true)
  })

  it('cyber_lock：壞掉的不被蓋掉；on: false 只解同一個原因的', () => {
    const g = make()
    put(g, [piece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' }, off: { why: 'broken' } })])
    expect(fx(g, [{ kind: 'cyber_lock', uid: 'e1', on: true }]).lines).toEqual(['身上沒有符合的義體可以鎖。'])
    expect(fx(g, [{ kind: 'cyber_lock', uid: 'e1', on: false }]).lines).toEqual(['身上沒有符合的鎖可以解開。'])
    applyFx(g, [{ kind: 'cyber_lock', uid: 'e1', on: false, why: 'broken' }])
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
  })

  it('cyber_unlock：把 lock 整個拿掉（含被鎖住的 off）；沒有鎖的沒事', () => {
    const g = make()
    put(g, [subEye({ off: { why: 'lock' }, lock: { ...SUB_LOCK, owed: 30 } }), piece('e2', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' } })])
    const res = applyFx(g, [{ kind: 'cyber_unlock', slot: 'eye' }])
    expect(res.lines).toEqual(['授權鎖拿掉了：企業義眼'])
    expect(cyberOf(g.state, 'pc')[0]!.lock).toBeUndefined()
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    expect(attr(g, 'reflex')).toBe(11)
    expect(fx(g, [{ kind: 'cyber_unlock', uid: 'e2' }]).lines).toEqual(['身上沒有符合的授權鎖。'])
  })

  it('格式：沒寫選擇器、on 不是布林、hours 不合格都擋下', () => {
    const g = make()
    const errs = (e: Rec) => fx(g, [e]).errors.join('；')
    expect(errs({ kind: 'cyber_take' })).toContain('至少要寫一個')
    expect(errs({ kind: 'cyber_take', uid: 'x', to: 'sell' })).toContain('to 只能是')
    expect(errs({ kind: 'cyber_lock', uid: 'x' })).toContain('on 要是布林值')
    expect(errs({ kind: 'cyber_lock', uid: 'x', on: true, hours: 0 })).toContain('hours')
    expect(errs({ kind: 'cyber_unlock' })).toContain('至少要寫一個')
    expect(errs({ kind: 'cyber_unlock', slot: 'tail' })).toContain('slot')
  })

  it('AI 與玩家要的這四種一律被擋；內建的來源可以', () => {
    const g = make()
    const all: Rec[] = [
      { kind: 'cyber_install', blueprint: 'bp_eye', parts: { sensor: 'pt_lens' } }, { kind: 'cyber_take', slot: 'eye' }, { kind: 'cyber_lock', slot: 'eye', on: true }, { kind: 'cyber_unlock', slot: 'eye' },
    ]
    for (const e of all) {
      expect(fx(g, [e], 'ai').errors.length, `ai ${e.kind}`).toBeGreaterThan(0)
      expect(fx(g, [e], 'player').errors.length, `player ${e.kind}`).toBeGreaterThan(0)
      expect(fx(g, [e], 'builtin').errors, `builtin ${e.kind}`).toEqual([])
    }
  })
})

// ---- 二手 ----

describe('二手的義體：殘響與惡意韌體', () => {
  const standInstall = (g: G, over: Rec = {}) => {
    stand(g, 'F1')
    give(g, 'bp_arm', ARM_PARTS, 'a1', { state: 'used', ...over })
    g.commit(installDraft(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic' }))
  }

  it('二手的義臂裝上之後多一筆 echo；全新的沒有；已經帶著 echo 的不再加', () => {
    const g = make()
    standInstall(g)
    const quirks = cyberOf(g.state, 'pc')[0]!.quirks!
    expect(quirks).toHaveLength(1)
    expect(['cx_echo', 'cx_echo2']).toContain(quirks[0])
    expect(last(g).narration?.results?.join('')).toContain('殘響')
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
    const fresh = make()
    stand(fresh, 'F1')
    give(fresh, 'bp_arm', ARM_PARTS, 'a1')
    fresh.commit(installDraft(fresh.k, fresh.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic' }))
    expect(cyberOf(fresh.state, 'pc')[0]!.quirks).toBeUndefined()
    const has = make()
    standInstall(has, { quirks: ['cx_echo2'] })
    expect(cyberOf(has.state, 'pc')[0]!.quirks).toEqual(['cx_echo2'])
  })

  it('同一個 uid 拆下來再裝回去還是那一筆（不論骰子與時間怎麼走）', () => {
    const g = make()
    standInstall(g)
    const first = cyberOf(g.state, 'pc')[0]!.quirks!
    advance(g, 3000)
    g.commit(removeDraft(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' }))
    expect(g.state.inventory.find((s) => s.data?.uid === 'a1')!.data!.quirks).toEqual(first)
    g.commit(installDraft(g.k, g.state, { actor: 'pc', uid: 'a1', side: 'r', via: 'clinic' }))
    expect(cyberOf(g.state, 'pc')[0]!.quirks).toEqual(first)
    // 換一個 uid 的別件二手貨，不一定是同一筆但一樣只有一筆
    give(g, 'bp_arm', ARM_PARTS, 'a9', { state: 'used' })
    g.commit(installDraft(g.k, g.state, { actor: 'pc', uid: 'a9', side: 'l', via: 'clinic' }))
    expect(cyberOf(g.state, 'pc').find((p) => p.uid === 'a9')!.quirks).toHaveLength(1)
  })

  it('沒有 echo 類的 quirk 可抽時什麼也不加', () => {
    const g = make({ pack: pack((c) => { c.quirk = c.quirk!.filter((q) => q.kind !== 'echo') }) })
    standInstall(g)
    expect(cyberOf(g.state, 'pc')[0]!.quirks).toBeUndefined()
  })

  it('效果 malware 有人註冊、機率 1：被叫到一次，帶 pool: used 與那一件的 uid；機率 0 不叫', () => {
    const calls: Rec[] = []
    const g = make({ extra: [malwareStub(calls)], pack: pack((c) => { c.cyber_rule = [{ id: 'default', used_malware: 1 }] }) })
    standInstall(g)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ kind: 'malware', pool: 'used', piece: 'a1' })
    const none: Rec[] = []
    const h = make({ extra: [malwareStub(none)], pack: pack((c) => { c.cyber_rule = [{ id: 'default', used_malware: 0 }] }) })
    standInstall(h)
    expect(none).toHaveLength(0)
    // 全新的件不叫
    const fresh: Rec[] = []
    const f = make({ extra: [malwareStub(fresh)], pack: pack((c) => { c.cyber_rule = [{ id: 'default', used_malware: 1 }] }) })
    stand(f, 'F1')
    give(f, 'bp_arm', ARM_PARTS, 'a1')
    f.commit(installDraft(f.k, f.state, { actor: 'pc', uid: 'a1', side: 'l', via: 'clinic' }))
    expect(fresh).toHaveLength(0)
  })

  it('沒有人註冊 malware：二手的照常裝上、沒有錯', () => {
    const g = make({ pack: pack((c) => { c.cyber_rule = [{ id: 'default', used_malware: 1 }] }) })
    standInstall(g)
    expect(cyberOf(g.state, 'pc')).toHaveLength(1)
  })
})

// ---- 掛點：戰敗與掃橋 ----

describe('掛點 defeat.gear 與 scan.person', () => {
  it('defeat.gear 對三種效果是 true，對別的不回答', () => {
    const g = make()
    const ask = (kind: string) => hooks(g).run('defeat.gear', { effect: { kind } }).filter((r) => r.owner === 'cyberware').map((r) => r.result)
    for (const kind of ['cyber_install', 'cyber_take', 'cyber_lock']) expect(ask(kind), kind).toEqual([true])
    for (const kind of ['cyber_unlock', 'gear_take', 'cash']) expect(ask(kind), kind).toEqual([])
  })

  it('scan.person 回答 { cyber: { count, items } }：不列全生體的、scan_proof 的、橋；列名字、合法性、登記', () => {
    const g = make()
    put(g, [
      piece('b1', 'bp_bridge', 'bridge', { parts: { chip: 'pt_bridge_chip' } }),
      subEye({ registered: true }),
      piece('a1', 'bp_arm', 'arm_l', { parts: ARM_PARTS }),
      piece('r1', 'bp_ears', 'ear_throat', { parts: { skin: 'pt_ear' } }),
      piece('g1', 'bp_ghost', 'torso', { parts: { plate: 'pt_ghost' } }),
    ])
    const answer = hooks(g).run('scan.person', { state: g.state, actor: 'pc', strength: 2 }).filter((r) => r.owner === 'cyberware')[0]!.result
    expect(answer).toEqual({
      cyber: {
        count: 2,
        items: [{ uid: 's1', name: '企業義眼', legal: 'register', registered: true, item: 'bp_subeye' }, { uid: 'a1', name: '義臂', legal: 'register', registered: false, item: 'bp_arm' }],
      },
    })
    const bare = make()
    expect(hooks(bare).run('scan.person', { state: bare.state, actor: 'pc', strength: 2 }).filter((r) => r.owner === 'cyberware')).toEqual([])
  })

  it('被鎖住的義體掃橋照樣讀得到；沒有人問掃橋的局不會壞', () => {
    const g = make()
    put(g, [subEye({ off: { why: 'lock' } })])
    expect(hooks(g).run('scan.person', { state: g.state, actor: 'pc', strength: 1 })[0]!.result.cyber.count).toBe(1)
  })
})

// ---- 光紋刺青 ----

describe('光紋刺青（P45）：條件 cyber 的 tattoo 與 faction', () => {
  it('tattoo: gang 與 faction: f1 對上才成立；單寫一個鍵也行', () => {
    const g = make()
    put(g, [piece('t1', 'bp_tattoo_gang', 'skin', { parts: { skin: 'pt_ink' }, sink: 0 }), piece('t2', 'bp_tattoo_deco', 'skin', { parts: { skin: 'pt_ink' }, sink: 0 })])
    expect(test(g, { kind: 'cyber', tattoo: 'gang', faction: 'f1' })).toBe(true)
    expect(test(g, { kind: 'cyber', tattoo: 'gang', faction: 'f2' })).toBe(false)
    expect(test(g, { kind: 'cyber', tattoo: 'deco' })).toBe(true)
    expect(test(g, { kind: 'cyber', tattoo: 'deco', faction: 'f1' })).toBe(false)
    expect(test(g, { kind: 'cyber', faction: 'f1' })).toBe(true)
    expect(test(g, { kind: 'cyber', tattoo: 'gang', min: 2 })).toBe(false)
    const none = make()
    expect(test(none, { kind: 'cyber', tattoo: 'gang' })).toBe(false)
    put(none, [piece('e1', 'bp_eye', 'eye', { parts: { sensor: 'pt_lens' } })])
    expect(test(none, { kind: 'cyber', tattoo: 'deco' })).toBe(false)
  })

  it('條件的格式：tattoo 只能是 deco 或 gang', () => {
    const g = make()
    expect(g.k.conditions.validate({ kind: 'cyber', tattoo: 'neon' } as never)).toEqual([expect.stringContaining('tattoo 只能是')])
    expect(g.k.conditions.validate({ kind: 'cyber', tattoo: 'gang', faction: 'f1' } as never)).toEqual([])
  })

  it('cyberView 標示刺青的種類與勢力；有 lock 的標 lock', () => {
    const g = make()
    put(g, [piece('t1', 'bp_tattoo_gang', 'skin', { parts: { skin: 'pt_ink' }, sink: 0, lock: { kind: 'contract', holder: 'f1' } })])
    const v = cyberView(g.k, g.state, 'pc').parts.find((p) => p.id === 'skin')!.pieces[0]!
    expect(v).toMatchObject({ tattoo: { kind: 'gang', faction: 'f1' }, lock: { kind: 'contract', holder: 'f1', owed: 0 } })
  })
})

// ---- 修理 ----

describe('修理壞掉的義體', () => {
  const broken = (over: Rec = {}): Rec => piece('a1', 'bp_arm', 'arm_l', { parts: ARM_PARTS, sink: 5, off: { why: 'broken' }, ...over })

  it('診所扣成品價的兩成（1200 → 240）、時間 +60，那一件恢復生效；沒壞的與不在診所被擋', () => {
    const g = make()
    put(g, [broken()])
    expect(armor(g)).toBe(0)
    expect(repairBlock(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' })).toBe('這裡沒有正規診所。')
    stand(g, 'F1')
    expect(repairQuote(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' })).toMatchObject({ price: 1200, fee: 240, minutes: 60, pay: 'cred' })
    const t0 = now(g)
    g.commit(repairDraft(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' }))
    expect(g.state.money.cred).toBe(20000 - 240)
    expect(now(g) - t0).toBe(60)
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    expect(armor(g)).toBe(2)
    expect(last(g)).toMatchObject({ action: 'cyber.repair', outcome: { result: 'repaired' } })
    expect(repairBlock(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' })).toBe('義臂沒有壞。')
    // 無照診所也收兩成
    const h = make()
    put(h, [broken()])
    stand(h, 'F2')
    expect(repairQuote(h.k, h.state, { actor: 'pc', uid: 'a1', via: 'unlicensed' })!.fee).toBe(240)
  })

  it('自己修：要在住處（旗標 home）或診所；成功修好、不收錢', () => {
    const g = make()
    put(g, [broken()])
    expect(repairBlock(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'self' })).toBe('自己修要在有工作台的住處（二級以上）或診所。')
    g.state.flags.home = true
    const t0 = now(g)
    g.commit(withDice(NAT12, () => repairDraft(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'self' })))
    expect(g.state.money.cred).toBe(20000)
    expect(now(g) - t0).toBe(60)
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
    expect(armor(g)).toBe(2)
  })

  it('自己修失敗：還是壞的、時間照過', () => {
    const g = make()
    put(g, [broken()])
    g.state.flags.home = true
    const t0 = now(g)
    g.commit(withDice(NAT10, () => repairDraft(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'self' })))
    expect(cyberOf(g.state, 'pc')[0]!.off).toEqual({ why: 'broken' })
    expect(now(g) - t0).toBe(60)
    expect(armor(g)).toBe(0)
    expect(last(g)).toMatchObject({ outcome: { result: 'failed' } })
    // 還能再試（新的骰面）
    g.commit(withDice(NAT20, () => repairDraft(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'self' })))
    expect(cyberOf(g.state, 'pc')[0]!.off).toBeUndefined()
  })

  it('訂閱還欠著錢的修好之後仍然鎖住（不能靠修理繞過補繳）', () => {
    const g = make()
    put(g, [subEye({ off: { why: 'broken' }, lock: { ...SUB_LOCK, owed: 30 } })])
    stand(g, 'F1')
    g.commit(repairDraft(g.k, g.state, { actor: 'pc', uid: 's1', via: 'clinic' }))
    expect(cyberOf(g.state, 'pc')[0]!.off).toEqual({ why: 'lock' })
    expect(attr(g, 'reflex')).toBe(10)
    g.commit(payLockDraft(g.k, g.state, { actor: 'pc', uid: 's1' }))
    expect(attr(g, 'reflex')).toBe(11)
  })

  it('錢不夠被擋；規則表 repair_fee 蓋掉預設', () => {
    const g = make({ money: { cred: 100, cash: 100 } })
    put(g, [broken()])
    stand(g, 'F1')
    expect(reasonOf(() => repairDraft(g.k, g.state, { actor: 'pc', uid: 'a1', via: 'clinic' }))).toContain('錢不夠')
    const h = make({ pack: pack((c) => { c.cyber_rule = [{ id: 'default', repair_fee: 0.5 }] }) })
    put(h, [broken()])
    stand(h, 'F1')
    expect(repairQuote(h.k, h.state, { actor: 'pc', uid: 'a1', via: 'clinic' })!.fee).toBe(600)
  })
})

// ---- 小手術 ----

describe('小手術：換身上一件義體的零件', () => {
  const arm = (over: Rec = {}): Rec => piece('a1', 'bp_arm', 'arm_l', { parts: { ...ARM_PARTS }, sink: 6, ...over })
  const mod = (_g: G, o: Rec = {}) => ({ actor: 'pc', uid: 'a1', type: 'plate', part: 'pt_plating', via: 'clinic' as const, ...o })
  const gift = (g: G, id: string, qty = 1) => { g.state.inventory.push({ id, qty }) }

  it('把板材換成護甲高 1 的那一塊：armor 多 1、舊的那一塊在背包（二手）、手術費是新零件目錄價的五成', () => {
    const g = make()
    put(g, [arm()])
    gift(g, 'pt_plating')
    expect(armor(g)).toBe(2)
    stand(g, 'F1')
    expect(modifyQuote(g.k, g.state, mod(g))).toMatchObject({ fee: 125, minutes: 60, old: { id: 'pt_plate' }, next: { id: 'pt_plating' }, recovery_minutes: 0, pay: 'cred' })
    const t0 = now(g)
    g.commit(modifyDraft(g.k, g.state, mod(g)))
    expect(armor(g)).toBe(3)
    expect(g.state.money.cred).toBe(20000 - 125)
    expect(now(g) - t0).toBe(60)
    expect(cyberOf(g.state, 'pc')[0]!.parts.plate).toBe('pt_plating')
    expect(g.state.inventory.some((s) => s.id === 'pt_plating')).toBe(false)
    const old = g.state.inventory.find((s) => s.id === 'pt_plate')!
    expect(old.data).toMatchObject({ state: 'used' })
    expect(typeof old.data!.uid).toBe('string')
    // 沒有另外休養
    expect(cyberOf(g.state, 'pc')[0]!.ready_at).toBeUndefined()
    expect(g.state.actors.pc!.conditions.some((c) => c.id === 'recovering')).toBe(false)
    expect(last(g)).toMatchObject({ action: 'cyber.modify', outcome: { result: 'modified' } })
    expect(last(g).narration?.results?.join('')).not.toMatch(/\d/)
  })

  it('類型不對的零件被擋，原因就是 slotProblems 那一句', () => {
    const g = make()
    put(g, [arm()])
    gift(g, 'pt_lens')
    stand(g, 'F1')
    const expected = slotProblems(g.k.content, 'bp_arm', 'plate', 'pt_lens').problems[0]!
    expect(expected).toContain('這個槽要的是')
    expect(modifyBlock(g.k, g.state, mod(g, { part: 'pt_lens' }))).toBe(expected)
    expect(reasonOf(() => modifyDraft(g.k, g.state, mod(g, { part: 'pt_lens' })))).toBe(expected)
    // 背包裡沒有的、沒有的槽、身上沒有的件、不在診所
    expect(modifyBlock(g.k, g.state, mod(g, { part: 'pt_nope' }))).toContain('背包裡沒有可以拿來換的零件')
    expect(modifyBlock(g.k, g.state, mod(g, { type: 'barrel' }))).toContain('沒有')
    expect(modifyBlock(g.k, g.state, mod(g, { uid: 'zz' }))).toBe('身上沒有這一件義體。')
    stand(g, 'F2')
    expect(modifyBlock(g.k, g.state, mod(g, { part: 'pt_lens' }))).toBe(expected)
    expect(modifyBlock(g.k, g.state, mod(g, { part: 'pt_plating' }))).toContain('背包裡沒有')
  })

  it('換成 stats.sink −2 的神經元：這一件的成本少 2、sink_floor 少 2、沉溺本身不動', () => {
    const g = make()
    put(g, [arm({ sink: 6 })])
    gift(g, 'pt_neuron_cool')
    g.state.actors.pc!.sink = 9
    stand(g, 'F2')
    expect(floor(g)).toBe(6)
    expect(modifyQuote(g.k, g.state, mod(g, { type: 'neuron', part: 'pt_neuron_cool', via: 'unlicensed' }))).toMatchObject({ sink_before: 6, sink_after: 4, fee: 90 })
    g.commit(modifyDraft(g.k, g.state, mod(g, { type: 'neuron', part: 'pt_neuron_cool', via: 'unlicensed' })))
    expect(floor(g)).toBe(4)
    expect(cyberOf(g.state, 'pc')[0]!.sink).toBe(4)
    expect(g.state.actors.pc!.sink).toBe(9)
  })

  it('換上更重的零件：成本和下限變高，沉溺不到的補上', () => {
    const g = make({ pack: pack((c) => { c.part!.push(part('pt_neuron_hot', 'neuron', { price: 300, stats: { sink: 3 } })) }) })
    put(g, [arm({ sink: 6 })])
    gift(g, 'pt_neuron_hot')
    g.state.actors.pc!.sink = 6
    stand(g, 'F2')
    g.commit(modifyDraft(g.k, g.state, mod(g, { type: 'neuron', part: 'pt_neuron_hot', via: 'unlicensed' })))
    expect(floor(g)).toBe(9)
    expect(g.state.actors.pc!.sink).toBe(9)
  })

  it('無照診所收三成、黑診所四成；骰 0.1 留下併發症', () => {
    const g = make()
    put(g, [arm()])
    gift(g, 'pt_plating')
    stand(g, 'F3')
    expect(modifyQuote(g.k, g.state, mod(g, { via: 'black' }))!.fee).toBe(100)
    const d = withDice(0.1, () => modifyDraft(g.k, g.state, mod(g, { via: 'black' })))
    g.commit(d)
    expect(cyberOf(g.state, 'pc')[0]!.quirks).toEqual(['cx_scar'])
    expect(last(g)).toMatchObject({ outcome: { result: 'complication' } })
    const h = make()
    put(h, [arm()])
    gift(h, 'pt_plating')
    stand(h, 'F3')
    h.commit(withDice(0.9, () => modifyDraft(h.k, h.state, mod(h, { via: 'black' }))))
    expect(cyberOf(h.state, 'pc')[0]!.quirks).toBeUndefined()
  })

  it('自己動刀：要有 ability 與住處；大失敗沒換成（新的還在背包、沉溺 +1）；失敗留併發症', () => {
    const g = make({ ability: true })
    put(g, [arm()])
    gift(g, 'pt_plating')
    expect(modifyBlock(g.k, g.state, mod(g, { via: 'self' }))).toBe('自己動刀要在住處或診所。')
    g.state.flags.home = true
    expect(modifyQuote(g.k, g.state, mod(g, { via: 'self' }))).toMatchObject({ fee: 0, self: { dc: 16 } })
    const t0 = now(g)
    g.commit(withDice(NAT1, () => modifyDraft(g.k, g.state, mod(g, { via: 'self' }))))
    expect(cyberOf(g.state, 'pc')[0]!.parts.plate).toBe('pt_plate')
    expect(g.state.inventory.some((s) => s.id === 'pt_plating')).toBe(true)
    expect(g.state.actors.pc!.sink).toBe(1)
    expect(now(g) - t0).toBe(60)
    expect(last(g)).toMatchObject({ outcome: { result: 'botched' } })
    g.commit(withDice(NAT12, () => modifyDraft(g.k, g.state, mod(g, { via: 'self' }))))
    expect(cyberOf(g.state, 'pc')[0]).toMatchObject({ parts: { plate: 'pt_plating' }, quirks: ['cx_scar'] })
    const h = make({ ability: true })
    h.state.flags.home = true
    expect(modifyBlock(h.k, h.state, mod(h, { via: 'self' }))).toBe('身上沒有這一件義體。')
    const none = make()
    none.state.flags.home = true
    put(none, [arm()])
    gift(none, 'pt_plating')
    expect(modifyBlock(none.k, none.state, mod(none, { via: 'self' }))).toBe('現在還不能自己動刀。')
  })

  it('有授權鎖的義體要先解鎖；成品甲板沒有零件可以換', () => {
    const g = make()
    put(g, [arm({ lock: { kind: 'contract', holder: 'f1' } })])
    gift(g, 'pt_plating')
    stand(g, 'F1')
    expect(modifyBlock(g.k, g.state, mod(g))).toBe('有授權鎖的義體要先解鎖。')
  })

  it('內嵌的零件：換下來的那一整筆回背包（不改內容）；換上去的內嵌零件整筆放進義體', () => {
    const inline = (uid: string, over: Rec = {}): Rec => ({ ...part('x', 'plate', { price: 150, stats: { armor: 5 }, ...over }), unreg: true, uid, desc: '一塊來路不明的板子。' })
    const g = make()
    put(g, [arm({ parts: { ...ARM_PARTS, plate: inline('u1', { stats: { armor: 4 } }) } })])
    expect(armor(g)).toBe(4)
    gift(g, 'pt_plating')
    stand(g, 'F1')
    g.commit(modifyDraft(g.k, g.state, mod(g)))
    const back = g.state.inventory.find((s) => s.id === UNREG_STACK_ID)!
    expect(back.data).toMatchObject({ uid: 'u1', part: { uid: 'u1', unreg: true, stats: { armor: 4 } } })
    expect(armor(g)).toBe(3)
    // 反過來：背包裡的內嵌零件換上去
    g.state.inventory.push({ id: UNREG_STACK_ID, qty: 1, data: { uid: 'u2', part: inline('u2') } })
    g.commit(modifyDraft(g.k, g.state, mod(g, { part: 'u2' })))
    expect((cyberOf(g.state, 'pc')[0]!.parts.plate as Rec).uid).toBe('u2')
    expect(armor(g)).toBe(5)
    expect(g.state.inventory.some((s) => s.data?.uid === 'u2')).toBe(false)
    expect(g.state.inventory.some((s) => s.id === 'pt_plating' && s.data?.state === 'used')).toBe(true)
  })

  it('橋的零件走換橋的費用與休養：費用乘 bridge_fee_mult、休養 bridge_recovery_minutes', () => {
    const g = make()
    put(g, [piece('b1', 'bp_bridge', 'bridge', { parts: { chip: 'pt_bridge_chip' }, sink: 4 })])
    gift(g, 'pt_chip')
    stand(g, 'F1')
    const q = modifyQuote(g.k, g.state, { actor: 'pc', uid: 'b1', type: 'chip', part: 'pt_chip', via: 'clinic' })!
    expect(q).toMatchObject({ fee: 100, recovery_minutes: 4320 })
    g.commit(modifyDraft(g.k, g.state, { actor: 'pc', uid: 'b1', type: 'chip', part: 'pt_chip', via: 'clinic' }))
    expect(g.state.money.cred).toBe(20000 - 100)
    expect(cyberOf(g.state, 'pc')[0]!.ready_at).toBe(now(g) + 4320)
    expect(g.state.actors.pc!.conditions.find((c) => c.id === 'recovering')).toEqual({ id: 'recovering', until: now(g) + 4320 })
  })

  it('錢不夠被擋', () => {
    const g = make({ money: { cred: 50, cash: 50 } })
    put(g, [arm()])
    gift(g, 'pt_plating')
    stand(g, 'F1')
    expect(reasonOf(() => modifyDraft(g.k, g.state, mod(g)))).toContain('錢不夠')
  })
})
