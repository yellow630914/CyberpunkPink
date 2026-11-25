// 驗收測試：dev/work/M4-security-m4.md（cpp-feature）。規格：LIFE 2.1 節、3.1 節、3.2 節（只看罰金與義體鎖定）；NPCS 8.3 節「隱藏沉溺」；EQUIPMENT 6.3、6.4 節；
// LEWD_SYSTEM 7.1 節「掃橋看得到契約」；dev/adr/0019 第十四節的 scan.person 與 P21；dev/work/M4-plan.md 第 16 題。
// 內容一律用測試自帶的最小假資料。scan.person 的回答、sink_shown、cyber_lock 都用測試裡的替身（不 import cyberware、sink、contract）。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Effect, Feature, GameState, Origin, Report } from '../../src'
import { ActionBlocked, ContentError, deriveRng, meterOf } from '../../src'
import { chooseOption, directorFeature, eventRunFeature, eventView, openEventOf } from '../../src/features/director'
import { DEFAULT_PERSON_RULES, personRulesFrom, scanView, securityFeature } from '../../src/features/security'
import type { PersonAnswer, ScanSetup } from '../../src/features/security'
import { makeGame, observed } from '../../src/testkit'

type Rec = Record<string, unknown>
const SKILLS = [{ id: 'perform', name: '表演', attr: 'charm', desc: '演一個你不是的人。' }]
const FACTIONS = [
  { id: 'f_alpha', name: '阿爾法公司', short: '阿爾法', class: 'corp', bribe: true },
  { id: 'f_beta', name: '貝塔幫', short: '貝塔', class: 'street', bribe: false },
]
const DISTRICTS = [{ id: 'test', name: '測試區' }]
const item = (id: string, more: Rec = {}) => ({ id, name: id, desc: `${id}。`, category: 'misc', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS = [
  item('it_fake2', { name: '淺層假身分', grade: 2, tags: ['fake_id'], legal: 'banned' }),
  item('it_licence', { name: '義體執照', tags: ['license'], size: 0 }),
  item('it_gun', { name: '改裝手槍', legal: 'banned' }),
]
const PACK: ContentPack = { id: 'security_m4_test', content: { skill: SKILLS, faction: FACTIONS, district: DISTRICTS, item: ITEMS } as unknown as ContentPack['content'] }
const DISTRICT_KIND: Feature = { id: 'test_districts', install: (k) => k.content.defineKind({ kind: 'district', owner: 'test', validate: () => [] }) }

// ---- 替身 ----

let stubN = 0
/** 回答 scan.person 的替身（可以掛好幾個，回答會合起來）。 */
const answers = (a: PersonAnswer | ((strength: number) => PersonAnswer)): Feature => {
  const id = `person_stub_${stubN++}`
  return { id, install: (k) => k.hooks.on('scan.person', id, ({ strength }) => (typeof a === 'function' ? a(strength) : a)) }
}
/** 衍生數值 sink_shown 的替身：固定回傳 shown。 */
const shown = (n: number): Feature => ({ id: 'sink_stub', install: (k) => k.stats.defineStat({ id: 'sink_shown', owner: 'sink_stub', name: '別人看到的沉溺', base: () => n, min: 0 }) })
/** cyber_lock 的假效果：記下被叫到的參數，變更是一面旗標。 */
const lockSpy = (calls: Rec[]): Feature => ({
  id: 'lock_spy',
  install: (k) => k.effects.register<Effect & Rec>({
    kind: 'cyber_lock', owner: 'lock_spy', ai: false, validate: () => [],
    toChanges: (e) => { calls.push({ ...e }); return [{ op: 'flag', key: `locked_${String(e.uid)}`, value: true }] },
    describe: () => '鎖住了一件義體。',
  }),
})
const GUN_INV = [{ id: 'it_gun', qty: 1 }]
const carryingGun: Feature = { id: 'carry_gun', install: (k) => k.hooks.on('scan.carried', 'carry_gun', () => [{ item: 'it_gun', name: '改裝手槍', legal: 'banned' }]) }

interface Heard { origin: Origin; outcome: string; result: Rec }
const caller = (log: Heard[]): Feature => ({
  id: 'caller',
  install: (k) => k.hooks.on('activity.end', 'caller', (p) => {
    if (p.kind !== 'scan' || p.origin.by !== 'caller') return
    log.push({ origin: p.origin, outcome: p.outcome, result: p.result })
  }),
})

const cyberItem = (uid: string, legal: string, registered = false, name = `義體${uid}`) => ({ uid, name, legal, registered })
const withCyber = (items: ReturnType<typeof cyberItem>[], count = items.length): PersonAnswer => ({ cyber: { count, items } })

interface Opts { features?: Feature[]; rule?: Rec; seed?: number; sink?: number; window?: boolean; patch?: Partial<GameState> }
const rulePack = (rule: Rec): ContentPack => ({ id: 'security_m4_rule', content: { security_rule: [{ id: 'default', ...rule }] } as unknown as ContentPack['content'] })
const make = (o: Opts = {}) => {
  const log: Heard[] = []
  const g = makeGame({
    features: [DISTRICT_KIND, ...(o.window === false ? [] : [directorFeature, eventRunFeature]), securityFeature, caller(log), ...(o.features ?? [])],
    content: [PACK, ...(o.rule ? [rulePack(o.rule)] : [])], seed: o.seed ?? 7,
    pc: { skills: { perform: 1 }, ...(o.sink !== undefined ? { sink: o.sink } : {}) } as never,
    patch: { money: { cred: 0, cash: 5000 }, time: { day: 3, hour: 10, minute: 0 }, ...o.patch },
  }).game
  return { g, log }
}
type G = ReturnType<typeof make>['g']

const gate = (o: Partial<ScanSetup> = {}): ScanSetup => ({ point: 'gate_a', name: '企業大門', strength: 2, faction: 'f_alpha', ...o })
const scan = (g: G, setup: ScanSetup = gate()): Report[] => g.launch('scan', setup, { by: 'caller', ref: 'gate1', ext: { n: 1 } })
const choose = (g: G, id: string): Report[] => g.commit(chooseOption(g.k, g.state, id))
const hostility = (g: G, f = 'f_alpha'): number => meterOf(g.k, g.state, 'hostility', f)
const cash = (g: G): number => g.state.money.cash
const personOf = (log: Heard[]): Rec => log[0]!.result.person as Rec
/** 看穿了沒有：事件開著（敵對值要加）就看掃橋的框，否則看結果。 */
const sawThrough = (w: { g: G; log: Heard[] }): unknown => (openEventOf(w.g.state) ? scanView(w.g.k, w.g.state)!.person!.sink!.saw_through : personOf(w.log).saw_through)
const ids = (g: G): string[] => eventView(g.k, g.state)!.options.map((o) => o.id)

// 看穿那一擲：d20 ＋ 強度 × 3 對 base ＋ mod(意志) ＋ 定力 ＋ hide × 2。pc 預設的屬性都是 10、定力 0，所以 DC ＝ base ＋ hide × 2。
const ALWAYS_SEE = { sink_see: { base: 1 } }
const NEVER_SEE = { sink_see: { base: 99 } }

// ===================================================================================================================
describe('沒有人回答 scan.person：流程和以前一樣', () => {
  it('義體不問、結果沒有 person、四步的第四步還是原本那一句；現有的 M2-security 測試不改（另外跑）', () => {
    const { g, log } = make({ features: [carryingGun], patch: { inventory: GUN_INV } })
    scan(g)
    choose(g, 'proceed')
    expect(Object.keys(log[0]!.result).sort()).toEqual(['how', 'passed'])
    const v = make({ features: [carryingGun], patch: { inventory: GUN_INV } })
    scan(v.g)
    expect(scanView(v.g.k, v.g.state)!.person).toBeUndefined()
    expect(scanView(v.g.k, v.g.state)!.steps[3]!.note).toMatch(/還沒有開放/)
  })

  it('讀沉溺的點、但沒有人註冊 sink_shown：沒有沉溺可讀，什麼都不發生', () => {
    const { g, log } = make({ sink: 90 })
    scan(g, gate({ reads: ['sink'] }))
    expect(openEventOf(g.state)).toBeNull()
    expect(log[0]!.result).toEqual({ passed: true, how: 'clear' })
  })
})

// ===================================================================================================================
describe('義體（LIFE 3.1 節）', () => {
  it('強度 2、一件沒登記的登記類：罰 200（現金）、敵對值 +2、照常過；掃橋的框列出每一件', () => {
    const { g, log } = make({ features: [answers(withCyber([cyberItem('c1', 'register', false, '登記義眼'), cyberItem('c2', 'free', false, '自由義肢')]))] })
    scan(g)
    expect(ids(g)).toEqual(['proceed', 'turn_back'])
    const v = scanView(g.k, g.state)!
    expect(v.person!.cyber).toMatchObject({ count: 2, detailed: true })
    expect(v.person!.cyber!.items.map((i) => [i.name, i.verdict])).toEqual([['登記義眼', 'register'], ['自由義肢', 'ok']])
    expect(eventView(g.k, g.state)!.options[0]!.text).toContain('義體要罰 200 元')
    choose(g, 'proceed')
    expect(cash(g)).toBe(4800)
    expect(hostility(g)).toBe(2)
    expect(log[0]!.result).toMatchObject({ passed: true, how: 'proceed' })
    expect(personOf(log)).toMatchObject({ cyber_count: 2, cyber_found: [{ name: '登記義眼', legal: 'register' }, { name: '自由義肢', legal: 'free' }] })
  })

  it('登記過的登記類、自由類：沒事，不跳事件、直接過', () => {
    const { g, log } = make({ features: [answers(withCyber([cyberItem('c1', 'register', true), cyberItem('c2', 'free')]))] })
    scan(g)
    expect(openEventOf(g.state)).toBeNull()
    expect(log[0]!.result).toMatchObject({ passed: true, how: 'clear' })
    expect([cash(g), hostility(g)]).toEqual([5000, 0])
  })

  it('許可類：沒有執照罰 800、敵對值 +5；有執照放行', () => {
    const run = (inv: Array<{ id: string; qty: number }>) => {
      const w = make({ features: [answers(withCyber([cyberItem('c1', 'permit')]))], patch: { inventory: inv } })
      scan(w.g)
      if (openEventOf(w.g.state)) choose(w.g, 'proceed')
      return w
    }
    const none = run([])
    expect([cash(none.g), hostility(none.g), none.log[0]!.result.passed]).toEqual([4200, 5, true])
    const licensed = run([{ id: 'it_licence', qty: 1 }])
    expect([cash(licensed.g), hostility(licensed.g), licensed.log[0]!.result.passed]).toEqual([5000, 0, true])
  })

  it('違禁：那一件被鎖 24 小時（cyber_lock 帶 uid 與 hours）、敵對值 +10、這次沒過（how: cyber_banned）；不罰錢', () => {
    const calls: Rec[] = []
    const { g, log } = make({ features: [lockSpy(calls), answers(withCyber([cyberItem('c1', 'banned', false, '地下增幅器'), cyberItem('c2', 'banned')]))] })
    scan(g)
    choose(g, 'proceed')
    expect(calls.map((c) => [c.uid, c.hours, c.on])).toEqual([['c1', 24, true], ['c2', 24, true]])
    expect(g.state.flags.locked_c1).toBe(true)
    expect(hostility(g)).toBe(10)
    expect(cash(g)).toBe(5000)
    expect(log[0]!.result).toMatchObject({ passed: false, how: 'cyber_banned' })
  })

  it('查不到 cyber_lock 這個效果：只加敵對值、這次一樣沒過', () => {
    const { g, log } = make({ features: [answers(withCyber([cyberItem('c1', 'banned')]))] })
    scan(g)
    choose(g, 'proceed')
    expect(hostility(g)).toBe(10)
    expect(log[0]!.result).toMatchObject({ passed: false, how: 'cyber_banned' })
  })

  it('強度 1：只讀得到件數，沒有處罰、沒有逐件', () => {
    const { g, log } = make({ features: [answers(withCyber([cyberItem('c1', 'banned'), cyberItem('c2', 'register')]))] })
    scan(g, gate({ strength: 1 }))
    expect(openEventOf(g.state)).toBeNull()
    expect([cash(g), hostility(g)]).toEqual([5000, 0])
    expect(log[0]!.result).toEqual({ passed: true, how: 'clear', person: { cyber_found: [], cyber_count: 2 } })
  })

  it('罰金從現金扣、不夠扣到 0（剩下的不追）；敵對值照加', () => {
    const { g } = make({ features: [answers(withCyber([cyberItem('c1', 'permit')]))], patch: { money: { cred: 999, cash: 300 } } })
    scan(g)
    choose(g, 'proceed')
    expect([cash(g), g.state.money.cred, hostility(g)]).toEqual([0, 999, 5])
    const none = make({ features: [answers(withCyber([cyberItem('c1', 'permit')]))], patch: { money: { cred: 0, cash: 0 } } })
    scan(none.g)
    choose(none.g, 'proceed')
    expect([cash(none.g), hostility(none.g)]).toEqual([0, 5])
  })

  it('好幾件：罰金合起來、敵對值取最重的一件（一次掃橋算一次事）；和身上的東西的敵對值加在一起', () => {
    const { g } = make({ features: [answers(withCyber([cyberItem('c1', 'register'), cyberItem('c2', 'permit'), cyberItem('c3', 'register')])), carryingGun], patch: { inventory: GUN_INV } })
    scan(g)
    choose(g, 'proceed')
    expect(cash(g)).toBe(5000 - 200 - 800 - 200)
    // 身上的違禁武器 +10（一次），義體取最重的 permit +5
    expect(hostility(g)).toBe(15)
  })

  it('假身分蓋不掉義體：用假身分過，沒登記的一樣罰、違禁的一樣被鎖', () => {
    const calls: Rec[] = []
    const { g, log } = make({ features: [lockSpy(calls), answers(withCyber([cyberItem('c1', 'banned'), cyberItem('c2', 'register')]))], patch: { inventory: [{ id: 'it_fake2', qty: 1 }] } })
    scan(g)
    expect(ids(g)).toEqual(['proceed', 'fake', 'turn_back'])
    choose(g, 'fake')
    expect(calls.map((c) => c.uid)).toEqual(['c1'])
    expect(cash(g)).toBe(4800)
    expect(log[0]!.result).toMatchObject({ passed: false, how: 'cyber_banned' })
    expect(g.state.inventory.find((s) => s.id === 'it_fake2')?.qty).toBe(1)
  })

  it('選掉頭：什麼都沒扣、沒有 person 這一格', () => {
    const calls: Rec[] = []
    const { g, log } = make({ features: [lockSpy(calls), answers(withCyber([cyberItem('c1', 'banned')]))] })
    scan(g)
    choose(g, 'turn_back')
    expect([calls.length, cash(g), hostility(g)]).toEqual([0, 5000, 0])
    expect(log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
  })

  it('沒有事件視窗：當成照常過，直接結算', () => {
    const calls: Rec[] = []
    const { g, log } = make({ window: false, features: [lockSpy(calls), answers(withCyber([cyberItem('c1', 'banned'), cyberItem('c2', 'register')]))] })
    scan(g)
    expect(calls.map((c) => c.uid)).toEqual(['c1'])
    expect([cash(g), hostility(g)]).toEqual([4800, 10 + 0])
    expect(log[0]!.result).toMatchObject({ passed: false, how: 'cyber_banned' })
  })

  it('掛點回答的格式不對：略過', () => {
    const bad: Feature = { id: 'bad_person', install: (k) => k.hooks.on('scan.person', 'bad_person', () => ({ cyber: { count: 'x', items: [{ name: '沒有編號' }, null, cyberItem('ok', 'cursed')] }, hide: -3, rights: 'x' }) as never) }
    const { g, log } = make({ features: [bad] })
    scan(g)
    expect(log[0]!.result).toMatchObject({ passed: true, person: { cyber_found: [{ name: '義體ok', legal: 'free' }] } })
  })
})

// ===================================================================================================================
describe('沉溺與看穿（P21、NPCS 8.3 節）', () => {
  const sinkGate = (o: Partial<ScanSetup> = {}) => gate({ reads: ['sink'], ...o })

  it('reads 沒有 sink 的點不讀沉溺（預設只讀義體）', () => {
    const { g, log } = make({ sink: 90, features: [shown(90)] })
    scan(g)
    expect(openEventOf(g.state)).toBeNull()
    expect(log[0]!.result).toEqual({ passed: true, how: 'clear' })
  })

  it('沒有藏：讀到的就是真正的；60 以上敵對值 +3、照常過；59 沒事；不擲骰', () => {
    const at = (n: number) => {
      const w = make({ sink: n, features: [shown(n)] })
      const cursor = w.g.state.rng.cursor
      scan(w.g, sinkGate())
      if (openEventOf(w.g.state)) choose(w.g, 'proceed')
      return { ...w, cursor }
    }
    const hot = at(60)
    expect([hostility(hot.g), hot.log[0]!.result.passed]).toEqual([3, true])
    expect(personOf(hot.log)).toMatchObject({ sink_seen: 60 })
    expect(personOf(hot.log).saw_through).toBeUndefined()
    expect(hot.g.state.rng.cursor).toBe(hot.cursor)
    const cool = at(59)
    expect([hostility(cool.g), cool.log[0]!.result]).toEqual([0, { passed: true, how: 'clear', person: { cyber_found: [], sink_seen: 59 } }])
  })

  it('真正 70、看到 50、手段 1 種：看穿 → 敵對值 +3、saw_through 是 true、讀到的是 70', () => {
    const { g, log } = make({ sink: 70, rule: ALWAYS_SEE, features: [shown(50), answers({ hide: 1 })] })
    scan(g, sinkGate())
    expect(scanView(g.k, g.state)!.person!.sink).toMatchObject({ read: 70, notice: true, saw_through: true })
    choose(g, 'proceed')
    expect(hostility(g)).toBe(3)
    expect(log[0]!.result).toMatchObject({ passed: true, how: 'proceed' })
    expect(personOf(log)).toMatchObject({ sink_seen: 70, saw_through: true })
  })

  it('沒看穿：讀到 50、沒事（不跳事件、saw_through 是 false）', () => {
    const { g, log } = make({ sink: 70, rule: NEVER_SEE, features: [shown(50), answers({ hide: 1 })] })
    scan(g, sinkGate())
    expect(openEventOf(g.state)).toBeNull()
    expect(hostility(g)).toBe(0)
    expect(log[0]!.result).toMatchObject({ passed: true, how: 'clear', person: { sink_seen: 50, saw_through: false } })
  })

  it('真正 105 而且看穿：這次沒過，只剩掉頭（照常過與假身分都鎖著，有原因）', () => {
    const { g, log } = make({ sink: 105, rule: ALWAYS_SEE, features: [shown(60), answers({ hide: 2 })], patch: { inventory: [{ id: 'it_fake2', qty: 1 }] } })
    scan(g, sinkGate())
    expect(ids(g)).toEqual(['proceed', 'fake', 'turn_back'])
    const v = scanView(g.k, g.state)!
    expect(v.options.map((o) => [o.id, o.locked !== null])).toEqual([['proceed', true], ['fake', true], ['turn_back', false]])
    expect(v.options[0]!.locked).toMatch(/只有掉頭走得通/)
    expect(v.steps[3]).toMatchObject({ id: 'bridge', state: 'attention' })
    expect(() => choose(g, 'proceed')).toThrow(ActionBlocked)
    expect(() => choose(g, 'fake')).toThrow(ActionBlocked)
    choose(g, 'turn_back')
    expect(log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
    expect(hostility(g)).toBe(0)
  })

  it('真正 105、沒看穿（讀到 60）：只是讀到 60，+3、照常過', () => {
    const { g, log } = make({ sink: 105, rule: NEVER_SEE, features: [shown(60), answers({ hide: 2 })] })
    scan(g, sinkGate())
    choose(g, 'proceed')
    expect(hostility(g)).toBe(3)
    expect(log[0]!.result).toMatchObject({ passed: true, person: { sink_seen: 60, saw_through: false } })
  })

  it('沒有事件視窗、沉溺過了線：當成掉頭', () => {
    const { g, log } = make({ window: false, sink: 105, features: [shown(105)] })
    scan(g, sinkGate())
    expect(log[0]!.result).toEqual({ passed: false, how: 'turned_back' })
  })

  it('檢定的難度：10 ＋ mod(意志) ＋ 定力 ＋ 手段 × 2；強度 × 3 加在骰面上；每一項都照公式', () => {
    // 同一個種子上骰面固定：先用「一定看穿」讀出骰面，再算臨界的 base
    const probe = make({ sink: 70, rule: ALWAYS_SEE, features: [shown(50)] })
    scan(probe.g, sinkGate({ strength: 2 }))
    // 骰面從開始掃橋時的亂數狀態（游標 0）與點的 id 導出
    const natural = deriveRng({ seed: probe.g.state.rng.seed, cursor: 0 }, 'scan_see/gate_a').int(1, 20)
    expect(natural).toBeGreaterThanOrEqual(1)
    const total = natural + 2 * 3
    // 手段 hide、意志 resolve、定力 composure 讓 DC 剛好等於 total（過）或 total + 1（不過）
    const run = (base: number, hide: number, resolve: number, composure: number) => {
      const w = make({ sink: 70, rule: { sink_see: { base } }, features: [shown(50), answers({ hide })] })
      w.g.state.actors.pc!.attrs.resolve = resolve
      w.g.state.actors.pc!.skills.composure = composure
      scan(w.g, sinkGate({ strength: 2 }))
      return sawThrough(w)
    }
    // resolve 14 → mod +2；composure 3；hide 2 → +4；DC = base + 2 + 3 + 4 = base + 9
    expect(run(total - 9, 2, 14, 3)).toBe(true)
    expect(run(total - 8, 2, 14, 3)).toBe(false)
    // 沒有手段、屬性 10、定力 0：DC = base
    expect(run(total, 0, 10, 0)).toBe(true)
    expect(run(total + 1, 0, 10, 0)).toBe(false)
    // 強度 3：骰面加 9
    const hard = make({ sink: 70, rule: { sink_see: { base: natural + 9 } }, features: [shown(50)] })
    scan(hard.g, sinkGate({ strength: 3 }))
    expect(sawThrough(hard)).toBe(true)
    const softer = make({ sink: 70, rule: { sink_see: { base: natural + 9 } }, features: [shown(50)] })
    scan(softer.g, sinkGate({ strength: 2 }))
    expect(sawThrough(softer)).toBe(false)
  })

  it('好幾個回答的手段合起來算（每種 2 點）', () => {
    const natural = deriveRng({ seed: make().g.state.rng.seed, cursor: 0 }, 'scan_see/gate_a').int(1, 20)
    // 強度 3：骰面 + 9；base = natural + 5：手段 1 種 DC = natural + 7（過）；兩個回答共 3 種 DC = natural + 11（不過）
    const calc = (hides: number[]) => {
      const w = make({ sink: 70, rule: { sink_see: { base: natural + 5 } }, features: [shown(50), ...hides.map((h) => answers({ hide: h }))] })
      scan(w.g, sinkGate({ strength: 3 }))
      return sawThrough(w)
    }
    expect(calc([1])).toBe(true)
    expect(calc([1, 2])).toBe(false)
    expect(calc([])).toBe(true)
  })

  it('同一個種子：骰面與結果一樣；擲了看穿的那一擲讓亂數游標往前 1；存檔再讀照樣', () => {
    const play = (seed: number) => {
      const w = make({ seed, sink: 70, features: [shown(50), answers({ hide: 1 })] })
      scan(w.g, sinkGate({ point: 'gate_s', strength: 3 }))
      return { w, see: w.g.state.rng.cursor }
    }
    const a = play(11)
    const b = play(11)
    expect(JSON.stringify(a.w.log)).toBe(JSON.stringify(b.w.log))
    expect(a.see).toBe(1)
    // 沒有藏就不擲、游標不動
    const plain = make({ sink: 70, features: [shown(70)] })
    scan(plain.g, sinkGate())
    expect(plain.g.state.rng.cursor).toBe(0)
  })

  it('事件開著時存檔再讀：看穿的結果、框、選項都不變（骰面記在狀態裡）', () => {
    const features = () => [shown(50), answers({ hide: 1 })]
    const w = make({ sink: 70, rule: ALWAYS_SEE, features: features() })
    scan(w.g, sinkGate())
    const raw = w.g.save()
    const h = make({ sink: 70, rule: ALWAYS_SEE, features: features() })
    expect(h.g.load(raw)).toBeNull()
    expect(scanView(h.g.k, h.g.state)).toEqual(scanView(w.g.k, w.g.state))
    choose(h.g, 'proceed')
    expect(personOf(h.log)).toMatchObject({ sink_seen: 70, saw_through: true })
    expect(h.g.state.ext.security_scan).toBeUndefined()
  })
})

// ===================================================================================================================
describe('契約（LEWD_SYSTEM 7.1 節）', () => {
  const bound = (covered: boolean): PersonAnswer => ({ contract: { class: 'bound', holder: '伊甸園', level: 'manage', covered } })
  const cread = { reads: ['contract' as const] }

  it('covered 而強度 1：結果裡沒有契約；強度 2 有（原樣）', () => {
    const one = make({ features: [answers(bound(true))] })
    scan(one.g, gate({ ...cread, strength: 1 }))
    expect(one.log[0]!.result).toEqual({ passed: true, how: 'clear' })
    const two = make({ features: [answers(bound(true))] })
    scan(two.g, gate({ ...cread, strength: 2 }))
    expect(personOf(two.log).contract).toEqual({ class: 'bound', holder: '伊甸園', level: 'manage', covered: true })
  })

  it('沒蓋住的契約強度 1 就看得到；rights 一起放進結果', () => {
    const { g, log } = make({ features: [answers({ ...bound(false), rights: [{ holder: '義體行', level: 'limit' }] })] })
    scan(g, gate({ ...cread, strength: 1 }))
    expect(personOf(log)).toMatchObject({ contract: { holder: '伊甸園', covered: false }, rights: [{ holder: '義體行', level: 'limit' }] })
    // 契約只是顯示：不跳事件、不扣東西
    expect(openEventOf(g.state)).toBeNull()
    expect([cash(g), hostility(g)]).toEqual([5000, 0])
  })

  it('reads 沒有 contract 的點不讀契約', () => {
    const { g, log } = make({ features: [answers(bound(false))] })
    scan(g, gate({ strength: 2 }))
    expect(log[0]!.result).toEqual({ passed: true, how: 'clear' })
  })

  it('假身分蓋得掉契約（不進結果），蓋不掉義體', () => {
    const w = make({ features: [answers({ ...bound(false), ...withCyber([cyberItem('c1', 'register')]) })], patch: { inventory: [{ id: 'it_fake2', qty: 1 }] } })
    scan(w.g, gate({ reads: ['cyber', 'contract'] }))
    expect(scanView(w.g.k, w.g.state)!.person!.contract).toBeDefined()
    choose(w.g, 'fake')
    expect(personOf(w.log).contract).toBeUndefined()
    expect(personOf(w.log).cyber_count).toBe(1)
    expect(cash(w.g)).toBe(4800)
    const plain = make({ features: [answers({ ...bound(false), ...withCyber([cyberItem('c1', 'register')]) })] })
    scan(plain.g, gate({ reads: ['cyber', 'contract'] }))
    choose(plain.g, 'proceed')
    expect(personOf(plain.log).contract).toMatchObject({ holder: '伊甸園' })
  })

  it('契約人的身分進得去哪裡：照現有的 rankOf（bound ＝ 市民）', () => {
    const { g, log } = make({ features: [answers(bound(false))] })
    g.state.actors.pc!.ext.identity = { class: 'bound' }
    scan(g, gate({ ...cread, need_class: 'member' }))
    expect(eventView(g.k, g.state)!.options[0]!.locked).toMatch(/社員/)
    choose(g, 'turn_back')
    expect(log[0]!.result.passed).toBe(false)
  })
})

// ===================================================================================================================
describe('讀哪幾樣：設定與規則表的 readers', () => {
  it('規則表寫某個勢力讀 sink：那個勢力的點沒寫 reads 也讀；別的勢力不讀', () => {
    const rule = { readers: { f_alpha: ['sink', 'cyber'] } }
    const a = make({ sink: 80, rule, features: [shown(80)] })
    scan(a.g)
    choose(a.g, 'proceed')
    expect(personOf(a.log)).toMatchObject({ sink_seen: 80 })
    expect(hostility(a.g)).toBe(3)
    const b = make({ sink: 80, rule, features: [shown(80)] })
    scan(b.g, gate({ faction: 'f_beta' }))
    expect(b.log[0]!.result).toEqual({ passed: true, how: 'clear' })
  })

  it('設定的 reads 優先於規則表', () => {
    const w = make({ sink: 80, rule: { readers: { f_alpha: ['sink'] } }, features: [shown(80)] })
    scan(w.g, gate({ reads: ['cyber'] }))
    expect(w.log[0]!.result).toEqual({ passed: true, how: 'clear' })
  })

  it('沒寫 reads、勢力也不在規則表：只讀義體', () => {
    const w = make({ sink: 80, features: [shown(80), answers({ ...withCyber([cyberItem('c1', 'register')]), contract: { class: 'bound', holder: 'x', level: 'manage', covered: false } })] })
    scan(w.g)
    choose(w.g, 'proceed')
    expect(personOf(w.log)).toEqual({ cyber_found: [{ name: '義體c1', legal: 'register' }], cyber_count: 1 })
  })

  it('沒有勢力的點：讀義體（罰金照扣），沒有敵對值可加', () => {
    const w = make({ features: [answers(withCyber([cyberItem('c1', 'register')]))] })
    scan(w.g, gate({ faction: undefined }))
    choose(w.g, 'proceed')
    expect(cash(w.g)).toBe(4800)
    expect(Object.keys(w.g.state.meters.hostility ?? {})).toEqual([])
  })

  it('掃橋設定的 reads 格式不對：擋下並有一句話', () => {
    const { g } = make()
    expect(() => scan(g, gate({ reads: ['bridge'] as never }))).toThrow(ActionBlocked)
    expect(() => scan(g, gate({ reads: 'sink' as never }))).toThrow(/reads/)
  })
})

// ===================================================================================================================
describe('掃橋的框與事件的說明（一樣一句）', () => {
  it('scanView 的 person 有三樣讀到什麼；第四步寫沉溺與契約；事件的正文也列', () => {
    const calls: Rec[] = []
    const { g } = make({
      sink: 70, rule: ALWAYS_SEE,
      features: [lockSpy(calls), shown(50), answers({ ...withCyber([cyberItem('c1', 'register', false, '登記義眼')]), contract: { class: 'bound', holder: '伊甸園', level: 'manage', covered: false }, rights: [{ holder: '義體行', level: 'read' }], hide: 1 })],
    })
    scan(g, gate({ reads: ['cyber', 'sink', 'contract'] }))
    const v = scanView(g.k, g.state)!
    expect(v.person!.reads).toEqual(['cyber', 'sink', 'contract'])
    expect(v.person!.sentences).toHaveLength(4)
    expect(v.person!.sentences[0]).toContain('登記義眼（沒登記）')
    expect(v.person!.sentences[1]).toContain('沉溺是 70')
    expect(v.person!.sentences[2]).toContain('伊甸園')
    expect(v.steps[3]).toMatchObject({ id: 'bridge', state: 'attention' })
    expect(v.steps[3]!.note).toContain('沉溺是 70')
    expect(v.steps[3]!.note).toContain('伊甸園')
    const text = eventView(g.k, g.state)!.text
    for (const s of v.person!.sentences) expect(text).toContain(s)
    expect(eventView(g.k, g.state)!.options[0]!.text).toMatch(/義體要罰 200 元.*讀到的沉溺會被記上一筆.*敵對值會上升/)
  })

  it('這個點只讀義體、又有人回答：第四步說「不讀沉溺與契約」', () => {
    const { g } = make({ features: [answers(withCyber([cyberItem('c1', 'register')]))] })
    scan(g)
    expect(scanView(g.k, g.state)!.steps[3]).toMatchObject({ state: 'na', note: '這個點只讀義體，不讀沉溺與契約。' })
  })

  it('讀沉溺與契約的點、什麼都沒讀到：第四步是「沒有發現什麼」', () => {
    const { g } = make({ features: [carryingGun] })
    scan(g, gate({ reads: ['sink', 'contract'] }))
    expect(scanView(g.k, g.state)!.steps[3]).toMatchObject({ state: 'pass', note: '掃描器讀了沉溺與契約，沒有發現什麼。' })
  })
})

// ===================================================================================================================
describe('規則與存檔', () => {
  it('預設：沉溺 60 才有事、看穿 3／10／2、罰金 200／800、鎖 24 小時、敵對值 2／5／10', () => {
    expect(DEFAULT_PERSON_RULES).toMatchObject({ sink_notice: 60, sink_see: { per_strength: 3, base: 10, per_hide: 2 }, cyber_fine: { register: 200, permit: 800 }, cyber_lock_hours: 24, cyber_hostility: { register: 2, permit: 5, banned: 10 } })
    expect(DEFAULT_PERSON_RULES.readers).toEqual({})
  })

  it('資料可以蓋掉：罰金、鎖的小時、敵對值、sink_notice', () => {
    const calls: Rec[] = []
    const { g } = make({
      rule: { cyber_fine: { register: 50 }, cyber_lock_hours: 6, cyber_hostility: { banned: 20 } },
      features: [lockSpy(calls), answers(withCyber([cyberItem('c1', 'banned'), cyberItem('c2', 'register')]))],
    })
    scan(g)
    choose(g, 'proceed')
    expect(calls[0]!.hours).toBe(6)
    expect(cash(g)).toBe(4950)
    expect(hostility(g)).toBe(20)
    const rules = personRulesFrom({ sink_notice: 40, readers: { f_alpha: ['sink'] } })
    expect([rules.sink_notice, rules.readers.f_alpha, rules.sink_stop]).toEqual([40, ['sink'], 100])
  })

  it('規則的格式不對：載入時擋下', () => {
    expect(() => make({ rule: { sink_see: { base: 0 } } })).toThrow(ContentError)
    expect(() => make({ rule: { cyber_fine: { risky: 1 } } })).toThrow(ContentError)
    expect(() => make({ rule: { readers: { f_alpha: ['bridge'] } } })).toThrow(ContentError)
    expect(() => make({ rule: { sink_notice: 80, sink_stop: 50 } })).toThrow(ContentError)
    expect(() => make({ rule: { cyber_lock_hours: 0 } })).toThrow(ContentError)
  })

  it('區的倍率照常算在義體與沉溺的敵對值上', () => {
    const w = make({ features: [answers(withCyber([cyberItem('c1', 'permit')]))] })
    scan(w.g)
    choose(w.g, 'proceed')
    expect(hostility(w.g)).toBe(5)
  })

  it('回退：選完之後回到掃橋之前，罰金與敵對值都回來', () => {
    const { g } = make({ features: [answers(withCyber([cyberItem('c1', 'register')]))] })
    scan(g)
    choose(g, 'proceed')
    expect([cash(g), hostility(g)]).toEqual([4800, 2])
    expect(g.undoSteps(1)).toBe(true)
    expect([cash(g), hostility(g)]).toEqual([5000, 0])
    expect(openEventOf(g.state)).not.toBeNull()
  })

  it('報告的紀錄不變式成立（義體、沉溺、契約都讀的一次掃橋）', async () => {
    const calls: Rec[] = []
    const { g } = make({ sink: 70, rule: ALWAYS_SEE, features: [lockSpy(calls), shown(50), answers({ ...withCyber([cyberItem('c1', 'banned'), cyberItem('c2', 'register')]), hide: 1 })] })
    const { violations } = await observed(g, () => {
      scan(g, gate({ reads: ['cyber', 'sink', 'contract'] }))
      choose(g, 'proceed')
    })
    expect(violations).toEqual([])
  })
})
