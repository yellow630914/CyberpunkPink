// 驗收測試：dev/work/M4-tuning.md（cpp-feature）。規格：LEWD_SYSTEM 第 1 節「怎麼變」、第 4 節、第 6 節「調校診所」；CYBERWARE 第 1 節；dev/adr/0019 第七節與 P48、P49、P65。
// 內容一律用測試自帶的最小假資料：四種調校（穩壓：定力 +4 與承受層數 −1；癮：requires 加 sink_weekly；耳語：scene.sensitivity；靜水：兩筆消退加點加 no_full_sync）與一個渴求式的 no_load_decay、
// 原型版的靜水（兩個數字都是 4）；兩間設施（調校診所、靜室）與一間旅館；一張街的地圖。
// 時間：測試從第 3 天 10:00 開始；第 7 天 06:00 是週一（第 1 週）；第 3～6 天是第 0 週。診所價：裝 300、拆 150、各 1 小時；靜室 500、2 小時。
// 戰鬥：直接組一場戰鬥（setupBattle ＋ BattleRun），每個單位的感載先放 10，跑一次 beginTurn 看消退了幾點（現實基礎是 2 ＋ mod(意志 10) = 2；內海是 0）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, BattleRun, ContentError, beginTurn, clone, effectCtx, setupBattle, syncCapOf, toMinutes } from '../../src'
import type { SpecialMapEntry } from '../../src'
import { characterFeature } from '../../src/features/character'
import { deckFeature } from '../../src/features/deck'
import { lewdFeature } from '../../src/features/lewd'
import {
  DEFAULT_TUNING_RULES, bridgeView, installBlock, installDraft, installQuote, quietBlock, quietDraft, quietQuote, removeBlock, removeDraft, tuningFeature, tuningList, tuningOf, tuningRules,
} from '../../src/features/tuning'
import { arrive, worldFeature } from '../../src/features/world'
import { enemyUnit, laceUnit, makeGame } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const MAP: SpecialMapEntry = {
  id: 'm_street', kind: 'street', size: [10, 5],
  sheets: [{
    id: 'street', name: '街', size: [10, 5],
    layout: ['##########', '#F.F.F.F.#', 'E.1....2.E', '#........#', '##########'],
    cells: [
      { id: 'F1', at: [1, 1], mark: 'F', name: '一號' }, { id: 'F2', at: [3, 1], mark: 'F', name: '二號' }, { id: 'F3', at: [5, 1], mark: 'F', name: '三號' }, { id: 'F4', at: [7, 1], mark: 'F', name: '四號' },
      { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [9, 2], mark: 'E', name: '東口' },
    ],
    spots: [{ id: '!1', at: [2, 2], cover: 'sparse' }, { id: '!2', at: [7, 2], cover: 'dense' }],
  }],
} as never

const TUNINGS: Rec[] = [
  { id: 'tn_calm', name: '穩壓', desc: '把橋的雜訊壓下去。', effects: [{ attr: 'resolve', amount: 4 }, { stat: 'afterglow_cap', amount: -1 }] },
  { id: 'tn_hook', name: '癮', desc: '橋會自己去找刺激。', requires: { axis: { body: 1 } }, flags: ['sink_weekly'], effects: [{ check: { skills: ['hack'] }, amount: 3 }, { attr: 'tech', amount: -1 }] },
  { id: 'tn_whisper', name: '耳語', desc: '皮膚比平常更清楚。', effects: [], scene: { sensitivity: { mouth: 4, chest: -2 } }, tags: ['tg_whisper'] },
  { id: 'tn_still', name: '靜水', desc: '每回合感載消退 +2。', effects: [{ stat: 'net_load_decay', amount: 2 }, { mod: 'decay', amount: 2, layer: 'meat' }], flags: ['no_full_sync'] },
  { id: 'tn_still_proto', name: '靜水（原型）', desc: '每回合感載消退 +4。', effects: [{ stat: 'net_load_decay', amount: 4 }, { mod: 'decay', amount: 4, layer: 'meat' }], flags: ['no_full_sync'] },
  { id: 'tn_crave', name: '渴求', desc: '感載不會自己退。', effects: [], flags: ['no_load_decay'] },
  { id: 'tn_tag', name: '專情', desc: '只對一種口味穩。', requires: { tag: 'tg_x' }, effects: [{ attr: 'charm', amount: 2 }, { attr: 'body', amount: -1 }] },
]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    special_map: [structuredClone(MAP) as unknown as Rec],
    facility_type: [
      { id: 'fac_tune', name: '調校診所', tuning: { install: true } },
      { id: 'fac_quiet', name: '靜室', tuning: { quiet_room: true } },
      { id: 'fac_hotel', name: '旅館', sleep: { rate: 0.6, cost: 0 } },
    ],
    district: [{ id: 'd_hive', name: '蜂巢', grade: 1, blocks: ['b_street'] }],
    block: [{ id: 'b_street', district: 'd_hive', name: '診所街', kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_tune', name: '調校診所' }, F2: { type: 'fac_quiet', name: '靜室' }, F3: { type: 'fac_hotel', name: '旅館' } } }],
    tendency_tag: [{ id: 'tg_x', name: '某種口味', axis: 'sense' }, { id: 'tg_whisper', name: '耳語', axis: 'sense' }],
    tuning: structuredClone(TUNINGS),
  }
  patch(c)
  return { id: 'tuning_test', content: c as unknown as ContentPack['content'] }
}

interface Opts {
  pc?: Rec
  money?: { cred: number; cash: number }
  pack?: ContentPack
  features?: Feature[]
  extra?: Feature[]
  rules?: Record<string, any>
}
const BRIDGE = { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 }
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: o.features ?? [characterFeature, worldFeature, lewdFeature, deckFeature, tuningFeature, ...(o.extra ?? [])], content: [o.pack ?? pack()], seed: 7,
    pc: { hp: 40, skills: { hack: 2 }, ext: { bridge: { ...BRIDGE } }, ...(o.pc ?? {}) },
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 20000, cash: 1000 }, ...(o.rules ? { rules: o.rules as never } : {}) },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const now = (g: G) => toMinutes(g.state.time)
const advanceTo = (g: G, minutes: number) => advance(g, minutes - now(g))
const stand = (g: G, at: string) => { g.commit(arrive(g.k, g.state, 'b_street', at)) }
const pc = (g: G) => g.state.actors.pc!
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
const put = (g: G, id: string, opts: Rec = {}) => g.commit(installDraft(g.k, g.state, { id, ...opts }))
/** 站到調校診所裝一個。 */
const fit = (g: G, ...ids: string[]) => { stand(g, 'F1'); for (const id of ids) put(g, id) }
/** 一串效果直接套到狀態上。 */
const fx = (g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin', actor = 'pc') => {
  const ctx = effectCtx(g.k, g.state, { source, actor })
  const errors = g.k.effects.validate(effects as never, ctx)
  if (errors.length > 0) return { errors, changes: [] as ReportDraft['changes'] }
  const res = g.k.effects.resolve(effects as never, ctx)
  if (res.errors.length === 0) g.commit(draft(res.changes, 'test.effect'))
  return { errors: res.errors, changes: res.changes, clamps: res.clamps }
}
const slots = (g: G) => tuningOf(g.k, g.state, 'pc').slots
const stat = (g: G, id: string) => g.k.stats.stat(g.state, 'pc', id)
const check = (g: G, skill: string) => g.k.stats.checkModifiers(g.state, 'pc', { attr: 'tech', skill, tags: [] }).reduce((s, p) => s + p.value, 0)
const bridgeBase = (g: G, p = 'sensitivity') => (pc(g).ext.bridge as Rec)[p] as number

// ---- 戰鬥的小工具（照 M4-core-passive 的做法）----

function battleOf(g: G, mode: 'meat' | 'net' = 'meat') {
  const setup: BattleSetup = {
    mode, grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
    allies: [{ from: 'actor', id: 'pc' }],
    foes: [{ from: 'unit', unit: (mode === 'net' ? laceUnit('minion', 1) : enemyUnit('minion', 1)) as unknown as Record<string, unknown> }],
  }
  const battle = clone(setupBattle(g.k, g.state, setup).battle)
  const run = new BattleRun(g.k, g.state, battle)
  return { run, pc: battle.units.a1 as BattleUnit }
}
/** 單位感載放 10、跑一次回合開始，回傳消退了幾點。 */
function decayed(g: G, mode: 'meat' | 'net'): number {
  const { run, pc: u } = battleOf(g, mode)
  u.load!.now = 10
  u.uses.turns = 1
  beginTurn(run, u)
  return 10 - u.load!.now
}

// ---- 規則與格式 ----

describe('規則與格式', () => {
  it('預設的規則表：兩槽、裝 300／拆 150（各一小時）、靜室 ±5／500／每週一次／沉溺 +1／兩小時；資料可以蓋掉', () => {
    const g = make()
    expect(tuningRules(g.k)).toEqual(DEFAULT_TUNING_RULES)
    expect(DEFAULT_TUNING_RULES).toMatchObject({ slots: 2, install: { price: 300, minutes: 60 }, remove: { price: 150, minutes: 60 }, quiet: { step: 5, price: 500, per_week: 1, sink_up: 1, minutes: 120 } })
    const g2 = make({ pack: pack((c) => { c.tuning_rule = [{ id: 'default', slots: 3, install: { price: 100 }, quiet: { step: 10 } }] }) })
    expect(tuningRules(g2.k)).toMatchObject({ slots: 3, install: { price: 100, minutes: 60 }, remove: { price: 150 }, quiet: { step: 10, price: 500 } })
  })

  it('資料寫 flags: [decay_double] 被格式檢查擋下；效果寫成不合格的被動效果、mod decay 沒寫 layer、requires 寫錯、設施的 tuning 寫錯也擋下', () => {
    expect(() => make({ pack: pack((c) => { c.tuning!.push({ id: 'tn_bad', name: '舊靜水', desc: '加倍。', effects: [], flags: ['decay_double'] }) }) })).toThrow(/decay_double/)
    expect(() => make({ pack: pack((c) => { c.tuning!.push({ id: 'tn_bad', name: '壞', desc: '壞。', effects: [{ mod: 'decay', amount: 2 }] }) }) })).toThrow(ContentError)
    expect(() => make({ pack: pack((c) => { c.tuning!.push({ id: 'tn_bad', name: '壞', desc: '壞。', effects: [], requires: { axis: { nope: 1 } } }) }) })).toThrow(/requires/)
    expect(() => make({ pack: pack((c) => { c.facility_type![0]!.tuning = { install: 'yes' } }) })).toThrow(/tuning\.install/)
  })

  it('靜水的兩筆寫法（stat net_load_decay、mod decay layer meat）與渴求的開關在格式檢查裡合格', () => {
    expect(() => make()).not.toThrow()
  })
})

// ---- 裝與拆 ----

describe('裝一個調校', () => {
  it('在調校診所：扣 300、時間 +1 小時、檢定與衍生數值照 effects；報告 tuning.install', () => {
    const g = make()
    stand(g, 'F1')
    const t0 = now(g)
    const cred0 = g.state.money.cred
    const q = installQuote(g.k, g.state, { id: 'tn_calm' })!
    expect(q).toMatchObject({ price: 300, minutes: 60, stable: true, facility: '調校診所', slot: 0 })
    const before = { resolve: g.k.stats.effectiveAttr(g.state, 'pc', 'resolve'), cap: stat(g, 'afterglow_cap') }
    put(g, 'tn_calm')
    expect(g.state.money.cred).toBe(cred0 - 300)
    expect(now(g) - t0).toBe(60)
    expect(slots(g)).toEqual(['tn_calm', null])
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'resolve')).toBe(before.resolve + 4)
    expect(stat(g, 'afterglow_cap')).toBe(before.cap - 1)
    expect(g.k.passives.of(g.state, 'pc').map((e) => [e.source, e.label])).toContainEqual(['tuning', '穩壓'])
    const r = reports(g, 'tuning.install')
    expect(r).toHaveLength(1)
    expect(r[0]!.outcome.result).toBe('stable')
    expect(r[0]!.outcome.summary).not.toMatch(/\d/)
  })

  it('兩槽都滿了，第三個被擋；同一個裝兩次被擋；用現金付也行', () => {
    const g = make()
    fit(g, 'tn_calm', 'tn_whisper')
    expect(slots(g)).toEqual(['tn_calm', 'tn_whisper'])
    expect(installBlock(g.k, g.state, { id: 'tn_still' })).toMatch(/調校槽都滿了/)
    expect(reasonOf(() => installDraft(g.k, g.state, { id: 'tn_still' }))).toMatch(/調校槽都滿了/)
    expect(installBlock(g.k, g.state, { id: 'tn_calm' })).toMatch(/已經裝著/)
    const h = make()
    stand(h, 'F1')
    put(h, 'tn_calm', { pay: 'cash' })
    expect(h.state.money.cash).toBe(1000 - 300)
    expect(h.state.money.cred).toBe(20000)
  })

  it('不在調校診所被擋（靜室、旅館、街上都不行）；沒有橋被擋；錢不夠被擋；找不到的調校被擋', () => {
    const g = make()
    expect(installBlock(g.k, g.state, { id: 'tn_calm' })).toMatch(/不是調校診所/)
    stand(g, 'F2')
    expect(installBlock(g.k, g.state, { id: 'tn_calm' })).toMatch(/不是調校診所/)
    stand(g, 'F3')
    expect(installBlock(g.k, g.state, { id: 'tn_calm' })).toMatch(/不是調校診所/)
    const nob = make({ pc: { ext: { bridge: null } } })
    stand(nob, 'F1')
    expect(installBlock(nob.k, nob.state, { id: 'tn_calm' })).toBe('沒有橋就沒有調校槽。')
    expect(reasonOf(() => installDraft(nob.k, nob.state, { id: 'tn_calm' }))).toBe('沒有橋就沒有調校槽。')
    const poor = make({ money: { cred: 100, cash: 100 } })
    stand(poor, 'F1')
    expect(installBlock(poor.k, poor.state, { id: 'tn_calm' })).toMatch(/錢不夠/)
    expect(installBlock(g.k, g.state, { id: 'tn_nope' })).toMatch(/找不到/)
  })

  it('沒有橋的人：拆與靜室也擋；沒有橋就沒有調校的被動效果', () => {
    const nob = make({ pc: { ext: { bridge: null } } })
    stand(nob, 'F1')
    expect(removeBlock(nob.k, nob.state, { id: 'tn_calm' })).toBe('沒有橋就沒有調校槽。')
    stand(nob, 'F2')
    expect(quietBlock(nob.k, nob.state, { param: 'sensitivity', dir: 1 })).toBe('沒有橋就沒有調校槽。')
    // 強制安裝也落空
    const r = fx(nob, [{ kind: 'tuning', id: 'tn_calm' }])
    expect(r.errors).toEqual([])
    expect(r.changes).toEqual([])
    expect(slots(nob)).toEqual([null, null])
  })

  it('被內容篩選關掉標籤的調校不列、也裝不上', () => {
    const g = make({ rules: { contentOff: ['tg_whisper'] } })
    stand(g, 'F1')
    expect(tuningList(g.k, g.state, 'pc').map((t) => t.id)).not.toContain('tn_whisper')
    expect(tuningList(g.k, g.state, 'pc').map((t) => t.id)).toContain('tn_calm')
    expect(installBlock(g.k, g.state, { id: 'tn_whisper' })).toMatch(/篩選/)
    const open = make()
    expect(tuningList(open.k, open.state, 'pc').map((t) => t.id)).toContain('tn_whisper')
  })
})

describe('requires 不成立：裝得上，正的那筆不算、負的照算', () => {
  it('癮：要身體軸 1 級；沒有就裝不穩（檢定 +3 不算、技術 −1 照算）；有了之後兩筆都算', () => {
    const g = make()
    stand(g, 'F1')
    const tech0 = g.k.stats.effectiveAttr(g.state, 'pc', 'tech')
    const q = installQuote(g.k, g.state, { id: 'tn_hook' })!
    expect(q.stable).toBe(false)
    expect(q.unstable_why).toMatch(/身體1 級以上/)
    put(g, 'tn_hook')
    expect(reports(g, 'tuning.install')[0]!.outcome.result).toBe('unstable')
    expect(slots(g)).toEqual(['tn_hook', null])
    expect(check(g, 'hack')).toBe(0)
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'tech')).toBe(tech0 - 1)
    const view = bridgeView(g.k, g.state, 'pc')
    expect(view.slots[0]).toMatchObject({ id: 'tn_hook', name: '癮', unstable: true })
    expect(view.slots[0]!.unstable_why).toMatch(/身體/)
    // 傾向長出來之後：穩了
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 1, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: {} }
    expect(check(g, 'hack')).toBe(3)
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'tech')).toBe(tech0 - 1)
    expect(bridgeView(g.k, g.state, 'pc').slots[0]!.unstable).toBeUndefined()
  })

  it('requires.tag：有那個傾向標籤才穩', () => {
    const g = make()
    fit(g, 'tn_tag')
    const charm0 = g.k.stats.effectiveAttr(g.state, 'pc', 'charm')
    const body = g.k.stats.effectiveAttr(g.state, 'pc', 'body')
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_x: 'latent' } }
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'charm')).toBe(charm0) // 潛在還不算：正的那筆沒有算
    g.state.actors.pc!.ext.tendency = { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: { tg_x: 'has' } }
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'charm')).toBe(charm0 + 2)
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'body')).toBe(body)
  })
})

describe('拆一個調校', () => {
  it('扣 150、時間 +1 小時、效果消失；沒裝的被擋', () => {
    const g = make()
    fit(g, 'tn_calm')
    const cred = g.state.money.cred
    const t0 = now(g)
    const base = g.k.stats.effectiveAttr(g.state, 'pc', 'resolve') - 4
    expect(removeBlock(g.k, g.state, { id: 'tn_whisper' })).toMatch(/沒有裝/)
    g.commit(removeDraft(g.k, g.state, { id: 'tn_calm' }))
    expect(g.state.money.cred).toBe(cred - 150)
    expect(now(g) - t0).toBe(60)
    expect(slots(g)).toEqual([null, null])
    expect(g.k.stats.effectiveAttr(g.state, 'pc', 'resolve')).toBe(base)
    expect(reports(g, 'tuning.remove')).toHaveLength(1)
    stand(g, 'F3')
    expect(removeBlock(g.k, g.state, { id: 'tn_calm' })).toMatch(/不是調校診所/)
  })

  it('上鎖的拆不了並寫出鑰匙在誰手上；過了 until 的鎖自己失效', () => {
    const g = make()
    stand(g, 'F1')
    fx(g, [{ kind: 'tuning', id: 'tn_calm', locked_by: 'pc', days: 2 }])
    g.state.actors.pc!.name = '小粉'
    fx(g, [{ kind: 'tuning', id: 'tn_calm', locked_by: 'pc', days: 2 }])
    expect(removeBlock(g.k, g.state, { id: 'tn_calm' })).toBe('這個調校的鑰匙在小粉手上。')
    expect(reasonOf(() => removeDraft(g.k, g.state, { id: 'tn_calm' }))).toBe('這個調校的鑰匙在小粉手上。')
    expect(bridgeView(g.k, g.state, 'pc').slots[0]!.lock).toMatchObject({ by: 'pc', by_name: '小粉', text: '這個調校的鑰匙在小粉手上。' })
    expect(Object.keys(tuningOf(g.k, g.state, 'pc').locked)).toEqual(['tn_calm'])
    advance(g, 2 * 1440 + 10)
    stand(g, 'F1')
    expect(removeBlock(g.k, g.state, { id: 'tn_calm' })).toBeNull()
    expect(Object.keys(tuningOf(g.k, g.state, 'pc').locked)).toEqual([])
    g.commit(removeDraft(g.k, g.state, { id: 'tn_calm' }))
    expect(slots(g)).toEqual([null, null])
  })

  it('永久的鎖（沒寫 days）不會過期；鑰匙在不在名單上的人（一個名字）手上也照寫', () => {
    const g = make()
    stand(g, 'F1')
    fx(g, [{ kind: 'tuning', id: 'tn_calm', locked_by: '緋櫻的人事部' }])
    advance(g, 100 * 1440)
    stand(g, 'F1')
    expect(removeBlock(g.k, g.state, { id: 'tn_calm' })).toBe('這個調校的鑰匙在緋櫻的人事部手上。')
  })
})

describe('強制安裝與拿掉（效果 tuning、tuning_remove）', () => {
  it('兩槽都滿時擠掉沒上鎖的第一個、自己是上鎖的；擠不出位置時整筆落空並提醒', () => {
    const g = make()
    fit(g, 'tn_calm', 'tn_whisper')
    const r = fx(g, [{ kind: 'tuning', id: 'tn_still', locked_by: 'boss' }])
    expect(r.errors).toEqual([])
    expect(slots(g)).toEqual(['tn_still', 'tn_whisper'])
    expect(tuningOf(g.k, g.state, 'pc').locked.tn_still).toEqual({ by: 'boss' })
    // 沒有付錢、沒有花時間
    expect(g.state.money.cred).toBe(20000 - 600)
    // 第二個：擠掉沒上鎖的那個（耳語）
    fx(g, [{ kind: 'tuning', id: 'tn_crave', locked_by: 'boss' }])
    expect(slots(g)).toEqual(['tn_still', 'tn_crave'])
    // 兩個都上鎖：落空
    const r3 = fx(g, [{ kind: 'tuning', id: 'tn_calm' }])
    expect(r3.changes).toEqual([])
    expect(r3.clamps!.map((c) => c.notice).join('')).toMatch(/上了鎖/)
    expect(slots(g)).toEqual(['tn_still', 'tn_crave'])
  })

  it('有空槽就放進第一個空槽；已經裝著而沒有要上鎖是沒事；已經裝著再給鎖是補上鎖', () => {
    const g = make()
    fx(g, [{ kind: 'tuning', id: 'tn_calm' }])
    expect(slots(g)).toEqual(['tn_calm', null])
    expect(fx(g, [{ kind: 'tuning', id: 'tn_calm' }]).changes).toEqual([])
    fx(g, [{ kind: 'tuning', id: 'tn_calm', locked_by: 'boss', days: 1 }])
    expect(slots(g)).toEqual(['tn_calm', null])
    expect(tuningOf(g.k, g.state, 'pc').locked.tn_calm!.until).toBe(now(g) + 1440)
  })

  it('tuning_remove 無視鎖；沒裝的落空', () => {
    const g = make()
    fx(g, [{ kind: 'tuning', id: 'tn_calm', locked_by: 'boss' }])
    expect(fx(g, [{ kind: 'tuning_remove', id: 'tn_whisper' }]).changes).toEqual([])
    fx(g, [{ kind: 'tuning_remove', id: 'tn_calm' }])
    expect(slots(g)).toEqual([null, null])
    expect(tuningOf(g.k, g.state, 'pc').locked).toEqual({})
  })

  it('AI 給的與玩家要的被擋（只有內建的來源收）；格式錯誤擋下；條件 tuning 看有沒有裝著', () => {
    const g = make()
    for (const e of [{ kind: 'tuning', id: 'tn_calm' }, { kind: 'tuning_remove', id: 'tn_calm' }]) {
      const ctx = effectCtx(g.k, g.state, { source: 'ai', actor: 'pc' })
      expect(g.k.effects.validate([e] as never, ctx).length).toBeGreaterThan(0)
    }
    const ctx = effectCtx(g.k, g.state, { source: 'builtin', actor: 'pc' })
    expect(g.k.effects.validate([{ kind: 'tuning', id: 'tn_nope' }] as never, ctx).join('')).toMatch(/查不到/)
    expect(g.k.effects.validate([{ kind: 'tuning', id: 'tn_calm', days: 3 }] as never, ctx).join('')).toMatch(/locked_by/)
    expect(g.k.effects.validate([{ kind: 'tuning', id: 'tn_calm', locked_by: 'x', days: -1 }] as never, ctx).length).toBeGreaterThan(0)
    expect(g.k.effects.validate([{ kind: 'tuning', id: 'tn_calm', what: 1 }] as never, ctx).join('')).toMatch(/沒有這個欄位/)
    const c = { kind: 'tuning', id: 'tn_calm' }
    const test = () => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test()).toBe(false)
    fx(g, [{ kind: 'tuning', id: 'tn_calm' }])
    expect(test()).toBe(true)
    expect(g.k.conditions.validate({ kind: 'tuning' } as never, 'c').length).toBeGreaterThan(0)
  })
})

// ---- 開關與效果 ----

describe('sink_weekly：每週一沉溺 +1', () => {
  it('裝著的人過一個週一沉溺 +1（裝不穩也算，反面的）；沒裝的不加；拆掉就不加了', () => {
    const g = make()
    fit(g, 'tn_hook')
    const sink0 = pc(g).sink
    advanceTo(g, toMinutes({ day: 7, hour: 7, minute: 0 }))
    expect(pc(g).sink).toBe(sink0 + 1)
    expect(reports(g, 'tuning.week')).toHaveLength(1)
    expect(reports(g, 'tuning.week')[0]!.outcome.summary).not.toMatch(/\d/)
    advanceTo(g, toMinutes({ day: 14, hour: 7, minute: 0 }))
    expect(pc(g).sink).toBe(sink0 + 2)
    const h = make()
    fit(h, 'tn_calm')
    advanceTo(h, toMinutes({ day: 7, hour: 7, minute: 0 }))
    expect(pc(h).sink).toBe(0)
  })

  it('一次跨好幾週各算一次（最多最近三次）', () => {
    const g = make()
    fit(g, 'tn_hook')
    const sink0 = pc(g).sink
    advanceTo(g, toMinutes({ day: 7 + 7 * 5, hour: 7, minute: 0 }))
    expect(pc(g).sink).toBe(sink0 + 3)
  })
})

describe('靜水（P65）：感載消退 +N，現實與內海都有效', () => {
  it('現實的戰鬥每回合比沒裝多消退 2 點；內海的戰鬥每回合消退 2 點（不是 4）；net_load_decay 多 2；開不了全檔；拆掉之後回來', () => {
    const g = make({ pc: { skills: { hack: 2, sync: 5 }, ext: { bridge: { sensitivity: 80, tolerance: 30, craving: 30, docility: 30 } } } })
    expect(decayed(g, 'meat')).toBe(2)
    expect(decayed(g, 'net')).toBe(0)
    expect(stat(g, 'net_load_decay')).toBe(0)
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('full')
    fit(g, 'tn_still')
    expect(decayed(g, 'meat')).toBe(4)
    expect(decayed(g, 'net')).toBe(2)
    const { pc: u } = battleOf(g, 'net')
    expect(u.decay).toBe(2)
    expect(stat(g, 'net_load_decay')).toBe(2)
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('deep')
    // 內海的修正不會多算一遍：mod decay 是 layer meat
    const net = battleOf(g, 'net')
    expect(net.run.mods('decay', net.pc).filter((p) => p.source === 'tuning')).toEqual([])
    g.commit(removeDraft(g.k, g.state, { id: 'tn_still' }))
    expect(decayed(g, 'meat')).toBe(2)
    expect(decayed(g, 'net')).toBe(0)
    expect(stat(g, 'net_load_decay')).toBe(0)
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('full')
  })

  it('原型版（兩個數字都是 4）：現實多消退 4、內海消退 4、net_load_decay 多 4', () => {
    const g = make()
    fit(g, 'tn_still_proto')
    expect(decayed(g, 'meat')).toBe(6)
    expect(decayed(g, 'net')).toBe(4)
    expect(stat(g, 'net_load_decay')).toBe(4)
  })

  it('裝著 deck 時：甲板散熱與靜水疊在 net_load_decay 上；沒有甲板散熱時是 2', () => {
    const g = make()
    fit(g, 'tn_still')
    expect(g.k.stats.statParts(g.state, 'pc', 'net_load_decay').filter((p) => p.source === 'tuning')).toEqual([{ label: '靜水', value: 2, source: 'tuning' }])
  })
})

describe('no_load_decay（渴求的反面）：現實的戰場把自然消退抵掉，內海不動', () => {
  it('現實的戰鬥感載不自然消退；有靜水的 +2 照算（只抵掉基礎）；內海不受影響（本來就是 0）', () => {
    const g = make()
    expect(decayed(g, 'meat')).toBe(2)
    fit(g, 'tn_crave')
    expect(decayed(g, 'meat')).toBe(0)
    expect(decayed(g, 'net')).toBe(0)
    const m = battleOf(g, 'meat')
    expect(m.run.mods('decay', m.pc).filter((p) => p.source === 'tuning')).toEqual([{ label: '感載不自然消退', value: -2, source: 'tuning' }])
    // 再裝靜水：基礎抵掉、+2 還在
    put(g, 'tn_still')
    expect(decayed(g, 'meat')).toBe(2)
    expect(decayed(g, 'net')).toBe(2)
  })

  it('其餘三個開關只存不做：sink_resist、afterglow_double、hp_to_load 裝上之後不改任何數字，總覽照列', () => {
    const g = make({ pack: pack((c) => { c.tuning!.push({ id: 'tn_store', name: '只存', desc: '只存。', effects: [], flags: ['sink_resist', 'afterglow_double', 'hp_to_load'] }) }) })
    const before = [stat(g, 'afterglow_cap'), decayed(g, 'meat'), pc(g).sink]
    fit(g, 'tn_store')
    expect([stat(g, 'afterglow_cap'), decayed(g, 'meat'), pc(g).sink]).toEqual(before)
    expect(bridgeView(g.k, g.state, 'pc').slots[0]!.flags.map((f) => f.id)).toEqual(['sink_resist', 'afterglow_double', 'hp_to_load'])
  })
})

describe('scene.body', () => {
  const body = (g: G, layer = 'meat') => (g.k.hooks.run as any)('scene.body', { state: g.state, actor: 'pc', layer }).map((h: any) => h.result).filter(Boolean)

  it('裝著的調校的 scene.sensitivity 回答給場景（只在現實層）；拆掉就沒有', () => {
    const g = make()
    expect(g.k.hooks.owners('scene.body' as never)).toContain('tuning')
    expect(body(g)).toEqual([])
    fit(g, 'tn_whisper')
    expect(body(g)).toEqual([{ sensitivity: { mouth: 4, chest: -2 } }])
    expect(body(g, 'net')).toEqual([])
    g.commit(removeDraft(g.k, g.state, { id: 'tn_whisper' }))
    expect(body(g)).toEqual([])
  })
})

// ---- 靜室 ----

describe('靜室', () => {
  it('敏感度 30 調到 35：扣 500、時間 +2 小時、沉溺 +1；報告 tuning.quiet', () => {
    const g = make()
    stand(g, 'F2')
    const cred = g.state.money.cred
    const t0 = now(g)
    const q = quietQuote(g.k, g.state, { param: 'sensitivity', dir: 1 })!
    expect(q).toMatchObject({ from: 30, delta: 5, price: 500, minutes: 120, sink: 1 })
    g.commit(quietDraft(g.k, g.state, { param: 'sensitivity', dir: 1 }))
    expect(bridgeBase(g)).toBe(35)
    expect(g.state.money.cred).toBe(cred - 500)
    expect(now(g) - t0).toBe(120)
    expect(pc(g).sink).toBe(1)
    expect(stat(g, 'bridge_sensitivity')).toBe(35)
    const r = reports(g, 'tuning.quiet')
    expect(r).toHaveLength(1)
    expect(r[0]!.outcome.summary).not.toMatch(/\d/)
  })

  it('往下調沉溺不變；同一週第二次被擋、過了週一又可以；不在靜室、錢不夠被擋', () => {
    const g = make()
    expect(quietBlock(g.k, g.state, { param: 'craving', dir: -1 })).toMatch(/沒有靜室/)
    stand(g, 'F1')
    expect(quietBlock(g.k, g.state, { param: 'craving', dir: -1 })).toMatch(/沒有靜室/)
    stand(g, 'F2')
    g.commit(quietDraft(g.k, g.state, { param: 'craving', dir: -1 }))
    expect(bridgeBase(g, 'craving')).toBe(25)
    expect(pc(g).sink).toBe(0)
    expect(quietBlock(g.k, g.state, { param: 'tolerance', dir: 1 })).toMatch(/這一週已經/)
    expect(reasonOf(() => quietDraft(g.k, g.state, { param: 'tolerance', dir: 1 }))).toMatch(/這一週已經/)
    advanceTo(g, toMinutes({ day: 7, hour: 7, minute: 0 }))
    stand(g, 'F2')
    expect(quietBlock(g.k, g.state, { param: 'tolerance', dir: 1 })).toBeNull()
    const poor = make({ money: { cred: 100, cash: 100 } })
    stand(poor, 'F2')
    expect(quietBlock(poor.k, poor.state, { param: 'tolerance', dir: 1 })).toMatch(/錢不夠/)
  })

  it('已經 100 的往上被擋、0 的往下被擋；接近 100 的照 bridge 效果的夾法只調到 100', () => {
    const g = make({ pc: { ext: { bridge: { sensitivity: 100, tolerance: 98, craving: 0, docility: 30 } } } })
    stand(g, 'F2')
    expect(quietBlock(g.k, g.state, { param: 'sensitivity', dir: 1 })).toMatch(/已經是 100/)
    expect(quietBlock(g.k, g.state, { param: 'craving', dir: -1 })).toMatch(/已經是 0/)
    expect(quietQuote(g.k, g.state, { param: 'tolerance', dir: 1 })).toMatchObject({ from: 98, delta: 2 })
    g.commit(quietDraft(g.k, g.state, { param: 'tolerance', dir: 1 }))
    expect(bridgeBase(g, 'tolerance')).toBe(100)
  })

  it('調的是基本值：有效值裡其他來源加的量不影響上限判斷（基本 95 加 +10 的來源，往上仍可調到 100）', () => {
    const g = make({ pc: { ext: { bridge: { sensitivity: 95, tolerance: 30, craving: 30, docility: 30 } } }, extra: [{ id: 't_src', install: (k: any) => k.passives.register('t', 'cyber', () => [{ stat: 'bridge_sensitivity', amount: 10 }]) } as Feature] })
    stand(g, 'F2')
    expect(stat(g, 'bridge_sensitivity')).toBe(105)
    g.commit(quietDraft(g.k, g.state, { param: 'sensitivity', dir: 1 }))
    expect(bridgeBase(g)).toBe(100)
    expect(stat(g, 'bridge_sensitivity')).toBe(110)
  })
})

// ---- 總覽 ----

describe('bridgeView', () => {
  it('列出基本值、每個來源各加多少與有效值；調校槽與鎖', () => {
    const src: Feature = { id: 't_src', install: (k: any) => k.passives.register('t', 'cyber', () => [{ stat: 'bridge_sensitivity', amount: 10, label: '測試橋' }]) }
    const g = make({ extra: [src], pack: pack((c) => { c.tuning!.push({ id: 'tn_up', name: '提感', desc: '敏感度 +6。', effects: [{ stat: 'bridge_sensitivity', amount: 6 }] }) }) })
    fit(g, 'tn_up')
    fx(g, [{ kind: 'tuning', id: 'tn_calm', locked_by: 'boss' }])
    const v = bridgeView(g.k, g.state, 'pc')
    expect(v.has_bridge).toBe(true)
    const s = v.params!.sensitivity
    expect(s).toMatchObject({ name: '敏感度', base: 30, value: 46 })
    expect(s.sources.map((x) => [x.source, x.amount]).sort()).toEqual([['cyber', 10], ['tuning', 6]])
    expect(s.sources.find((x) => x.source === 'tuning')!.parts).toEqual([{ label: '提感', amount: 6 }])
    expect(v.params!.tolerance).toMatchObject({ base: 30, value: 30, sources: [] })
    expect(v.slots.map((x) => x.id)).toEqual(['tn_up', 'tn_calm'])
    expect(v.slots[1]!.lock).toMatchObject({ by: 'boss' })
    expect(Object.keys(v.locked)).toEqual(['tn_calm'])
  })

  it('沒有橋：params 是 null、槽是空的', () => {
    const g = make({ pc: { ext: { bridge: null } } })
    const v = bridgeView(g.k, g.state, 'pc')
    expect(v).toMatchObject({ has_bridge: false, params: null })
    expect(v.slots.every((s) => s.id === null)).toBe(true)
  })
})

// ---- 換橋 ----

describe('換橋之後調校要重裝（cyber.bridge）', () => {
  it('沒上鎖的調校被清掉、上鎖的還在；接一份 tuning.remove 說明', () => {
    const g = make()
    fit(g, 'tn_calm', 'tn_whisper')
    fx(g, [{ kind: 'tuning', id: 'tn_still', locked_by: 'boss' }])
    expect(slots(g)).toEqual(['tn_still', 'tn_whisper'])
    const removes = reports(g, 'tuning.remove').length
    g.commit({ ...draft([], 'cyber.bridge'), actor: 'pc' })
    expect(slots(g)).toEqual(['tn_still', null])
    expect(tuningOf(g.k, g.state, 'pc').locked.tn_still).toBeDefined()
    const rs = reports(g, 'tuning.remove')
    expect(rs).toHaveLength(removes + 1)
    expect(rs[rs.length - 1]!.outcome.result).toBe('bridge_changed')
    // 沒有調校可清時不出報告
    g.commit({ ...draft([], 'cyber.bridge'), actor: 'pc' })
    expect(reports(g, 'tuning.remove')).toHaveLength(removes + 1)
  })

  it('別的報告不動調校', () => {
    const g = make()
    fit(g, 'tn_calm')
    g.commit({ ...draft([], 'cyber.install'), actor: 'pc' })
    expect(slots(g)).toEqual(['tn_calm', null])
  })
})

describe('沒有安裝 lewd 與別的功能也跑得起來', () => {
  it('只裝 character、world、tuning：內容載入得了；沒有橋的條件所以什麼都裝不上、不出錯', () => {
    const g = make({ features: [characterFeature, worldFeature, tuningFeature], pack: pack((c) => { delete c.tendency_tag }) })
    stand(g, 'F1')
    expect(installBlock(g.k, g.state, { id: 'tn_calm' })).toBe('沒有橋就沒有調校槽。')
    expect(bridgeView(g.k, g.state, 'pc')).toMatchObject({ has_bridge: false, params: null })
    expect(g.k.passives.of(g.state, 'pc').filter((e) => e.source === 'tuning')).toEqual([])
  })
})

// ---- M4-core-gaps：開關接上核心（第 8、10、11、12、13 項） ----

describe('M4-core-gaps：開關接上核心', () => {
  const EXTRA = (c: Record<string, Rec[]>) => {
    c.tuning!.push(
      { id: 'tn_pain', name: '痛覺轉譯', desc: '把一部分傷害換成感載。', effects: [], flags: ['hp_to_load'] },
      { id: 'tn_resist', name: '抗沉', desc: '往下陷得慢一點。', effects: [], flags: ['sink_resist'] },
      { id: 'tn_double', name: '餘韻加倍', desc: '餘韻的正面效果加倍。', effects: [], flags: ['afterglow_double'] },
      { id: 'tn_hunger', name: '渴求', desc: '感載越高檢定越高。', effects: [{ check: { attrs: ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'] }, per: { track: 'load', every: 10, amount: 1 } }], flags: ['no_load_decay'] },
      { id: 'tn_pain_tag', name: '裝不穩的痛覺轉譯', desc: '要有某種口味才穩。', requires: { tag: 'tg_x' }, effects: [], flags: ['hp_to_load', 'sink_resist'] },
    )
  }
  const mk = (o: Opts = {}) => make({ ...o, pack: pack(EXTRA) })

  it('第 10 項 no_full_sync：給的是核心的衍生數值 sync_cap_max −1（最高到深檔），不再借 sync_cap_bonus；拆掉就回到全檔', () => {
    const g = mk({ pc: { skills: { sync: 6, hack: 2 }, ext: { bridge: { ...BRIDGE, sensitivity: 100 } } } })
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('full')
    fit(g, 'tn_still')
    expect(stat(g, 'sync_cap_max')).toBe(2)
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('deep')
    const own = g.k.passives.of(g.state, 'pc').filter((e) => e.source === 'tuning' && 'stat' in e)
    expect(own.some((e) => 'stat' in e && e.stat === 'sync_cap_max' && e.amount === -1)).toBe(true)
    expect(own.some((e) => 'stat' in e && e.stat === 'sync_cap_bonus')).toBe(false)
    expect(g.k.stats.hasStat('sync_cap_bonus')).toBe(false)
    g.commit(removeDraft(g.k, g.state, { id: 'tn_still' }))
    expect(syncCapOf(g.k, g.state, 'pc')).toBe('full')
  })

  it('第 11 項 hp_to_load：裝著痛覺轉譯，受到 10 點生命傷害變成生命 −8、感載 +2；沒裝照舊；沒有橋的單位不轉', () => {
    const hurt = (g: G) => {
      const { run, pc: u } = battleOf(g)
      u.armor = 0
      u.sensitivity = 100
      const hp = u.hp!.now
      run.damage(u, 10, 'physical')
      return { hp: hp - u.hp!.now, load: u.load!.now }
    }
    expect(hurt(mk())).toEqual({ hp: 10, load: 0 })
    const g = mk()
    fit(g, 'tn_pain')
    expect(hurt(g)).toEqual({ hp: 8, load: 2 })
    // 規則表可以改成 50%
    const h = make({ pack: pack((c) => { EXTRA(c); c.tuning_rule = [{ id: 'default', hp_to_load_pct: 50 }] }) })
    fit(h, 'tn_pain')
    expect(hurt(h)).toEqual({ hp: 5, load: 5 })
    // 裝不穩的（requires 不成立）正面的開關不算
    const u = mk()
    fit(u, 'tn_pain_tag')
    expect(hurt(u)).toEqual({ hp: 10, load: 0 })
  })

  it('第 13 項 sink_resist：戰鬥裡 gainSink 與角色的 sink 效果往上加的每次少 1（最少 1）；往下降不受影響；沒裝照舊', () => {
    const g = mk({ pc: { sink: 10, skills: { hack: 2 }, ext: { bridge: { ...BRIDGE } } } })
    const gain = (x: G) => battleOf(x).run.gainSink(battleOf(x).pc, 3)
    expect(gain(g)).toBe(3)
    expect(fx(g, [{ kind: 'sink', amount: 3 }]).changes).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 3 }])
    fit(g, 'tn_resist')
    const { run, pc: u } = battleOf(g)
    expect(u.tags).toContain('sink_resist')
    expect(run.gainSink(u, 3)).toBe(2)
    expect(run.gainSink(u, 1)).toBe(1)
    expect(fx(g, [{ kind: 'sink', amount: 3 }]).changes).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: 2 }])
    expect(fx(g, [{ kind: 'sink', amount: -2 }]).changes).toEqual([{ op: 'actor.track', id: 'pc', track: 'sink', delta: -2 }])
  })

  it('第 8 項 afterglow_double：裝著的人帶標籤；內海的餘韻每層 +1 變 +2；現實的 −1 不加倍', () => {
    const g = mk()
    const mod = (x: G, mode: 'meat' | 'net') => {
      const { run, pc: u } = battleOf(x, mode)
      u.layers = 2
      return run.mods('hit', u).filter((p) => p.source === 'afterglow').reduce((s, p) => s + p.value, 0)
    }
    expect([mod(g, 'net'), mod(g, 'meat')]).toEqual([2, -2])
    fit(g, 'tn_double')
    expect(battleOf(g).pc.tags).toContain('afterglow_double')
    expect([mod(g, 'net'), mod(g, 'meat')]).toEqual([4, -2])
  })

  it('第 12 項 渴求：每 10 點感載檢定 +1（戰鬥外讀角色的感載；戰鬥裡讀單位當下的感載）', () => {
    const g = mk({ pc: { load: 25, skills: { hack: 2 }, ext: { bridge: { ...BRIDGE } } } })
    fit(g, 'tn_hunger')
    expect(check(g, 'hack')).toBe(2)
    const { run, pc: u } = battleOf(g)
    expect(run.k.passives.of(g.state, 'pc').filter((e) => 'check' in e).map((e) => (e as { amount: number }).amount)).toEqual([2])
    u.load!.now = 41
    expect(run.k.passives.modParts(g.state, 'pc', 'hit', { layer: 'meat', tracks: { load: u.load!.now } })).toEqual([])
    g.state.actors.pc!.load = 0
    expect(check(g, 'hack')).toBe(0)
  })
})
