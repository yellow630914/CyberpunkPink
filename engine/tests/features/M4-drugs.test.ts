// 驗收測試：dev/work/M4-drugs.md（cpp-feature）。規格：ITEMS 第 4 節（4.1 成癮與戒斷）；DOWNTIME 3.4、3.5 節；CYBERWARE 第 2 節；LIFE 第 6 節；CRAFTING 5.5 節；
// dev/adr/0019 第五節與 P13、P20、P65。
// 內容一律用測試自帶的最小假資料：四小時的檢定藥、一場戰鬥的命中藥（帶 upkeep_load 與 after）、高成癮的藥、鎮靜劑、要橋的藥、抑制劑、藥效過後有後續的藥、給行動點回復的藥。
// 每週帳單用測試自己叫的 bill.collect 與 bill.settled（沒有裝 bills）；沉溺的下限（sink_floor 在 character 定義）加一個 +12 的測試 provider 才看得出 −10。
// 時間：測試從某個週二 16:00 開始，下一個週一 06:00 是第 5 天又 14 小時以後（週一的消退看 row.last 在不在那個週一之前的七天裡）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, Condition, ContentPack, Feature, ReportDraft } from '../../src'
import { ActionBlocked, BattleRun, ContentError, Game, MINUTES_PER_DAY, checkParts, clone, currentUnit, effectCtx, fromMinutes, regenTotal, restDone, toMinutes, weeklyRule } from '../../src'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import {
  DEFAULT_DRUG_RULES, detoxBlock, detoxDraft, detoxQuote, drugDef, drugRules, drugView, drugsFeature, readDrugs, scaledWithdrawal, suppressantBlock, suppressantDraft, unitDrugs, useBlock, useDraft,
} from '../../src/features/drugs'
import { allFeatures } from '../../src/features'
import { CORE_PACK } from '../../data'
import { BATTLE_SETUPS, DRUG_GAPS, ITEMS_42_DRUGS, TEST_NET_COMBAT, enemyUnit, makeActor, makeGame, meterFeature, testMeter } from '../../src/testkit'

type Rec = Record<string, any>

// ---- 假資料 ----

const DAY = MINUTES_PER_DAY
const RULE = weeklyRule()
/** 開始的時間：第一個週一 06:00 之後一天又十小時（週二 16:00）。 */
const START = RULE.offset + DAY + 600
/** 下一個週一 06:00（從 START 算起）。 */
const MON1 = RULE.offset + RULE.every
const MON2 = MON1 + RULE.every

const HACK = (amount: number): Rec => ({ check: { skills: ['hack'] }, amount })
const item = (id: string, name: string, drug: Rec, over: Rec = {}): Rec => ({ id, name, desc: `${name}。`, category: 'drug', grade: 1, size: 0, legal: 'free', drug, ...over })
const USE_DRUG = { ap: 1, target: 'self', effects: [{ op: 'drug' }] }
const ITEMS: Rec[] = [
  // 四小時的檢定藥：成癮 20；戒斷 5 天、檢定 −2
  item('it_focus', '檢定藥', { duration: { minutes: 240 }, effects: [HACK(2)], addiction: { per_dose: 20, withdrawal: { days: 5, effects: [HACK(-2)] } } }),
  // 一場戰鬥的命中藥：命中 +1、每回合感載 +3、藥效過後一次灌 8 點感載；成癮 10
  item('it_stim', '命中藥', {
    duration: { battle: true }, effects: [{ mod: 'hit', amount: 1 }], side: [{ mod: 'evade', amount: -1 }], upkeep_load: 3, after: { instant: [{ kind: 'load', amount: 8 }] },
    addiction: { per_dose: 10, withdrawal: { days: 3, effects: [{ mod: 'hit', amount: -1 }] } },
  }, { use: USE_DRUG }),
  // 高成癮：一劑 45；戒斷 5 天、檢定 −4
  item('it_hard', '高成癮藥', { duration: { minutes: 60 }, effects: [HACK(1)], addiction: { per_dose: 45, withdrawal: { days: 5, effects: [HACK(-4)] } } }),
  // 鎮靜劑：生效一天；戒斷的懲罰減半
  item('it_calm', '鎮靜劑', { duration: { minutes: 1440 }, eases_withdrawal: true }),
  // 要橋的藥
  item('it_bridge', '要橋的藥', { duration: { minutes: 240 }, effects: [HACK(2)], needs_bridge: true, addiction: { per_dose: 6, withdrawal: { days: 3, effects: [HACK(-1)] } } }),
  item('it_supp', '抑制劑一週份', { suppressant: true }),
  // 藥效過後還有後續：60 分鐘、過後頭痛 120 分鐘（檢定 −1）、過後當下感載 +4
  item('it_after', '後勁藥', { duration: { minutes: 60 }, after: { minutes: 120, effects: [HACK(-1)], instant: [{ kind: 'load', amount: 4 }] } }),
  // 給行動點回復的藥（算在全身 +1 裡）
  item('it_regen', '回復藥', { duration: { battle: true }, effects: [{ mod: 'ap_regen', amount: 1 }] }, { use: USE_DRUG }),
  // 內海的消退：戰鬥中吃要自己改單位的 decay
  item('it_net', '散熱藥', { duration: { battle: true }, effects: [{ stat: 'net_load_decay', amount: 2 }, { mod: 'decay', amount: 2, layer: 'meat' }, { mod: 'hit', amount: 1, layer: 'net' }] }, { use: USE_DRUG }),
  // 吃了有沉溺的：instant 的效果
  item('it_sink', '沉溺藥', { duration: { minutes: 60 }, instant: [{ kind: 'sink', amount: 1 }] }),
]
const STATUS = (id: string, name: string, over: Rec = {}): Rec => ({ id, name, desc: `${name}。`, until: 'battle_end', kind: 'wound', ...over })
const STATUSES = [STATUS('limb_hurt', '肢體受創'), STATUS('dazed', '暈眩'), STATUS('bleeding', '流血'), STATUS('pump_jam', '斷藥')]

const pack = (patch: (c: Record<string, Rec[]>) => void = () => {}): ContentPack => {
  const c: Record<string, Rec[]> = {
    item: clone(ITEMS),
    battle_status: clone(STATUSES),
    facility_type: [
      { id: 'fac_clinic', name: '診所', clinic: { grade: 'clinic' } },
      { id: 'fac_free', name: '互助診所', detox: { free: true } },
      { id: 'fac_bar', name: '酒吧' },
    ],
  }
  patch(c)
  return { id: 'drugs_test', content: c as unknown as ContentPack['content'] }
}

const PARAMS = { sensitivity: 50, tolerance: 30, craving: 30, docility: 30 }

/** 測試的替身：沉溺的下限加 12（才看得出 −10）、看到的沉溺（sink 定義，基礎 50）、旗標 cyber_regen 在就多一個來源 cyber 的 ap_regen +1、主角快取格放命中藥與回復藥、條件 at_facility（旗標 here 是設施種類）。 */
const STUBS: Feature = {
  id: 'drug_stubs',
  install(k) {
    k.content.defineKind({ kind: 'facility_type', owner: 'drug_stubs', validate: () => [] })
    k.stats.addStatProvider('sink_floor', 'drug_stubs', () => [{ label: '測試義體', value: 12, source: 'cyber' }])
    k.stats.defineStat({ id: 'net_load_decay', owner: 'drug_stubs', name: '內海的感載消退', base: () => 0 })
    k.stats.defineStat({ id: 'sink_shown', owner: 'drug_stubs', name: '看到的沉溺', base: () => 50 })
    k.passives.register('drug_stubs', 'cyber', (state, actor) => (actor === 'pc' && state.flags.cyber_regen === true ? [{ mod: 'ap_regen', amount: 1, label: '測試義體' }] : []))
    k.battle.loadout('drug_stubs', (_state, actor, mode) => (actor === 'pc' && mode === 'meat' ? { quick: [{ item: 'it_stim', qty: 2 }, { item: 'it_regen', qty: 1 }] } : undefined))
    k.conditions.register<Condition & { types: string[] }>({ kind: 'at_facility', owner: 'drug_stubs', validate: () => [], test: (c, { state }) => c.types.includes(state.flags.here as string) })
  },
}
/** 測試的替身：條件 sunk 永遠成立（M4-sink 註冊的那個）。 */
const SUNK_YES: Feature = {
  id: 'sunk_yes',
  install(k) {
    k.conditions.register<Condition>({ kind: 'sunk', owner: 'sunk_yes', validate: () => [], test: () => true })
  },
}

interface Opts {
  pc?: Rec
  inventory?: Rec[]
  pack?: ContentPack
  extra?: Feature[]
  money?: { cred: number; cash: number }
  flags?: Rec
}
const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: [characterFeature, combatFeature, drugsFeature, STUBS, ...(o.extra ?? [])], content: [o.pack ?? pack()], seed: 7,
    pc: { hp: 40, skills: { hack: 2 }, ext: { bridge: PARAMS }, ...(o.pc ?? {}) },
    actors: [makeActor({ id: 'mate', role: 'companion', name: '夥伴', hp: 30, ext: { bridge: PARAMS } })],
    patch: { time: fromMinutes(START), money: o.money ?? { cred: 5000, cash: 500 }, inventory: clone((o.inventory ?? [{ id: 'it_focus', qty: 5 }, { id: 'it_stim', qty: 5 }, { id: 'it_hard', qty: 5 }, { id: 'it_calm', qty: 5 }]) as never), flags: { ...(o.flags ?? {}) } },
  })
  return game
}
type G = ReturnType<typeof make>

const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
/** 一路走到某個總分鐘（比現在晚）。 */
const advanceTo = (g: G, minutes: number) => advance(g, minutes - now(g))
const now = (g: G) => toMinutes(g.state.time)
const eat = (g: G, id: string, actor = 'pc') => g.commit(useDraft(g.k, g.state, { actor, item: id }))
const ext = (g: G, actor = 'pc') => readDrugs(g.state, actor)
const qty = (g: G, id: string) => g.state.inventory.find((s) => s.id === id)?.qty ?? 0
const reports = (g: G, action: string) => g.state.reports.filter((r) => r.action === action)
/** 一個效果（戰鬥外）直接套到狀態上。 */
const fx = (g: G, effects: Rec[], source: 'builtin' | 'ai' = 'builtin') => {
  const res = g.k.effects.resolve(effects as never, effectCtx(g.k, g.state, { source }))
  expect(res.errors).toEqual([])
  g.commit(draft(res.changes, 'test.effect'))
}
/** 檢定的組成（hack 這項基本功）：每一筆的來源與值。 */
const hackParts = (g: G, actor = 'pc') => checkParts(g.k.stats, g.state, actor, { attr: 'tech', skill: 'hack', tags: [] }).map((p) => [p.source, p.value] as const)
const hackFrom = (g: G, source: string, actor = 'pc') => hackParts(g, actor).filter(([s]) => s === source).map(([, v]) => v)
const floor = (g: G) => g.k.stats.stat(g.state, 'pc', 'sink_floor')
const shown = (g: G) => g.k.stats.stat(g.state, 'pc', 'sink_shown')
/** 休息做完（核心的 rest.done 掛點；沒有裝 rest，所以測試自己組那份報告）。 */
const rest = (g: G, kind: 'breath' | 'sleep' | 'stage' = 'breath') => g.commit(draft([{ op: 'time', minutes: 60 }, ...restDone(g.k, g.state, kind)], 'test.rest'))

// ---- 戰鬥 ----

const foe = (o: Rec = {}) => ({ from: 'unit', unit: enemyUnit('minion', 1, { weapon: 'pistol', ap: { now: 0, max: 0, regen: 0 }, ...o }) as unknown as Rec })
const setup = (): BattleSetup => ({
  mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
  allies: ['pc', 'mate'].map((id) => ({ from: 'actor', id })), foes: [foe()] as never, origin: { escapable: true, place: '測試的巷子' },
})
const unit = (g: G, id: string) => g.battle!.units[id]!
const run = (g: G): BattleRun => new BattleRun(g.k, g.state, clone(g.battle!))
const hit = (g: G, id = 'a1') => run(g).mods('hit', unit(g, id)).map((p) => [p.source, p.value] as const)
const act = (g: G, input: Parameters<G['battleAct']>[0]) => {
  const r = g.battleAct(input)
  expect(r.reasons ?? []).toEqual([])
  expect(r.status).toBe('applied')
  return r
}
function toTurn(g: G, id: string): void {
  for (let i = 0; i < 80; i++) {
    const cur = currentUnit(g.battle!)
    if (!cur) throw new Error('戰鬥已經沒有輪到的人')
    if (cur.id === id) return
    const r = cur.control === 'player' ? g.battleAct({ action: 'end_turn' }) : g.battleNext({ anyone: true })
    expect(r.status).toBe('applied')
  }
  throw new Error(`輪不到 ${id}`)
}
const win = async (g: G) => {
  g.state.battle!.result = { outcome: 'win', text: '贏了。' }
  await g.finishBattle()
}
const eatInBattle = (g: G, id = 'it_stim') => act(g, { action: 'item', target: { unit: 'a1' }, pick: { item: id } })

// ===================================================================================================================

describe('戰鬥外吃一劑：藥效、不疊加、成癮', () => {
  it('吃檢定藥：物品少一個、檢定的組成多一筆（來源 drug）、成癮加 per_dose；四小時後沒有，藥效過了有一份報告', () => {
    const g = make()
    expect(hackFrom(g, 'drug')).toEqual([])
    eat(g, 'it_focus')
    expect(qty(g, 'it_focus')).toBe(4)
    expect(hackFrom(g, 'drug')).toEqual([2])
    expect(ext(g).addiction.it_focus).toMatchObject({ value: 20, last: START, used_week: true })
    expect(ext(g).active).toEqual([{ id: 'it_focus', until: START + 240 }])
    expect(reports(g, 'drug.use')).toHaveLength(1)
    advance(g, 239)
    expect(hackFrom(g, 'drug')).toEqual([2])
    expect(reports(g, 'drug.wear_off')).toHaveLength(0)
    advance(g, 2)
    expect(hackFrom(g, 'drug')).toEqual([])
    expect(ext(g).active).toEqual([])
    expect(reports(g, 'drug.wear_off')).toHaveLength(1)
    expect(reports(g, 'drug.wear_off')[0]!.outcome.result).toBe('worn_off')
    // 成癮的值留著
    expect(ext(g).addiction.it_focus!.value).toBe(20)
  })

  it('效果還在時再吃一劑：時間重算、沒有疊成兩筆（檢定只多一筆）、成癮加了兩次', () => {
    const g = make()
    eat(g, 'it_focus')
    advance(g, 100)
    eat(g, 'it_focus')
    expect(ext(g).active).toEqual([{ id: 'it_focus', until: START + 100 + 240 }])
    expect(hackFrom(g, 'drug')).toEqual([2])
    expect(ext(g).addiction.it_focus!.value).toBe(40)
    expect(qty(g, 'it_focus')).toBe(3)
    advance(g, 239)
    expect(hackFrom(g, 'drug')).toEqual([2])
    advance(g, 2)
    expect(hackFrom(g, 'drug')).toEqual([])
  })

  it('成癮最多 100；instant 的效果當下跑；藥效過後（after）的被動效果持續 minutes，instant 在時間到時跑', () => {
    const g = make({ inventory: [{ id: 'it_hard', qty: 5 }, { id: 'it_sink', qty: 2 }, { id: 'it_after', qty: 2 }] })
    eat(g, 'it_hard')
    eat(g, 'it_hard')
    eat(g, 'it_hard')
    expect(ext(g).addiction.it_hard!.value).toBe(100)
    eat(g, 'it_sink')
    expect(g.state.actors.pc!.sink).toBe(1)
    eat(g, 'it_after')
    const load0 = g.state.actors.pc!.load
    expect(hackFrom(g, 'drug')).toEqual([1])
    advance(g, 61)
    expect(g.state.actors.pc!.load).toBe(load0 + 4)
    // 頭痛：檢定 −1，持續到藥效結束後的 120 分鐘（從 until 算）
    expect(hackFrom(g, 'drug').sort()).toEqual([-1])
    expect(ext(g).pending).toEqual([{ at: START + 60 + 120, drug: 'it_after', kind: 'after' }])
    expect(drugView(g.k, g.state, 'pc')!.after.map((a) => [a.id, a.until])).toEqual([['it_after', START + 180]])
    advance(g, 59)
    expect(hackFrom(g, 'drug')).toEqual([-1])
    advance(g, 61)
    expect(hackFrom(g, 'drug')).toEqual([])
    expect(drugView(g.k, g.state, 'pc')!.after).toEqual([])
  })

  it('吃不了的原因：戰鬥中、不是藥、背包沒有、不在隊上、找不到人；useDraft 丟 ActionBlocked', () => {
    const g = make({ inventory: [{ id: 'it_focus', qty: 1 }] })
    expect(useBlock(g.k, g.state, { actor: 'pc', item: 'it_stim' })).toBe('背包裡沒有命中藥。')
    expect(useBlock(g.k, g.state, { actor: 'nobody', item: 'it_focus' })).toBe('找不到這個角色。')
    expect(useBlock(g.k, g.state, { actor: 'pc', item: 'nope' })).toBe('這不是藥。')
    expect(() => useDraft(g.k, g.state, { actor: 'pc', item: 'it_stim' })).toThrow(ActionBlocked)
    g.startBattle(setup())
    expect(useBlock(g.k, g.state, { actor: 'pc', item: 'it_focus' })).toBe('戰鬥中不能這樣吃藥，要用戰鬥裡的行動。')
    const other = make({ inventory: [{ id: 'it_focus', qty: 1 }] })
    other.state.party = ['pc']
    expect(useBlock(other.k, other.state, { actor: 'mate', item: 'it_focus' })).toBe('夥伴不在隊上。')
  })

  it('沒有橋的人吃要橋的藥：沒有效果、成癮照加；有橋的人照常有效果', () => {
    const inv = [{ id: 'it_bridge', qty: 3 }]
    const g = make({ inventory: inv, pc: { ext: { bridge: null } } })
    const r = useDraft(g.k, g.state, { actor: 'pc', item: 'it_bridge' })
    expect(r.outcome.result).toBe('no_effect')
    g.commit(r)
    expect(hackFrom(g, 'drug')).toEqual([])
    expect(ext(g).active).toEqual([])
    expect(ext(g).addiction.it_bridge!.value).toBe(6)
    expect(qty(g, 'it_bridge')).toBe(2)
    const ok = make({ inventory: inv })
    eat(ok, 'it_bridge')
    expect(hackFrom(ok, 'drug')).toEqual([2])
  })
})

describe('戰鬥藥：一場戰鬥的藥、在戰鬥中吃', () => {
  it('開打前五分鐘吃：戰鬥中命中 +1（副作用 side 的迴避 −1 也算）、打完還撐著、喘口氣之後沒有，after 的感載有加', async () => {
    const g = make()
    eat(g, 'it_stim')
    advance(g, 5)
    g.startBattle(setup())
    expect(hit(g)).toContainEqual(['drug', 1])
    expect(run(g).mods('evade', unit(g, 'a1')).map((p) => [p.source, p.value])).toContainEqual(['drug', -1])
    // 隊友沒吃
    expect(hit(g, 'a2')).not.toContainEqual(['drug', 1])
    // 第一個自己的回合開始，每回合感載 +3
    toTurn(g, 'a1')
    expect(unit(g, 'a1').load!.now).toBe(3)
    await win(g)
    // 打完：藥效記成被這一場接住，撐到喘口氣
    expect(ext(g).active).toEqual([{ id: 'it_stim', until: START + 10, battle: true }])
    const load = g.state.actors.pc!.load
    rest(g)
    expect(ext(g).active).toEqual([])
    expect(g.state.actors.pc!.load).toBe(load + 8)
    expect(reports(g, 'drug.wear_off').filter((r) => r.outcome.summary.includes('藥效結束'))).toHaveLength(1)
    expect(ext(g).pending).toEqual([])
  })

  it('喘口氣的那一個小時裡另一種藥剛好過期：兩份報告各一件事，notice 不會被帶回來、報告不重複', async () => {
    const g = make({ inventory: [{ id: 'it_stim', qty: 2 }, { id: 'it_after', qty: 1 }] })
    eat(g, 'it_stim')
    g.startBattle(setup())
    await win(g)
    expect(ext(g).active[0]).toMatchObject({ id: 'it_stim', battle: true })
    eat(g, 'it_after')
    advance(g, 30)
    const before = reports(g, 'drug.wear_off').length
    rest(g)
    expect(ext(g).active).toEqual([])
    expect(ext(g).pending.filter((p) => p.kind === 'notice')).toEqual([])
    const texts = reports(g, 'drug.wear_off').slice(before).map((r) => r.outcome.summary)
    expect(texts).toHaveLength(2)
    expect(texts.filter((t) => t.includes('後勁藥的藥效過了'))).toHaveLength(1)
    expect(texts.filter((t) => t.includes('命中藥的藥效結束了'))).toHaveLength(1)
  })

  it('開打前二十分鐘吃：進戰鬥時已經沒了（時間到那一刻就跑了 after）', () => {
    const g = make()
    eat(g, 'it_stim')
    const load = g.state.actors.pc!.load
    advance(g, 20)
    expect(g.state.actors.pc!.load).toBe(load + 8)
    expect(reports(g, 'drug.wear_off')).toHaveLength(1)
    g.startBattle(setup())
    expect(hit(g)).not.toContainEqual(['drug', 1])
    expect(ext(g).active).toEqual([])
  })

  it('一場戰鬥的藥戰鬥外吃的最多撐 minutes（沒寫是規則表的 10 分鐘）；階段之間的喘口氣（stage）與睡一覺也結束它', () => {
    const g = make({ pack: pack((c) => { c.item![1]!.drug.duration = { battle: true, minutes: 30 } }) })
    eat(g, 'it_stim')
    expect(ext(g).active[0]!.until).toBe(START + 30)
    rest(g, 'stage')
    expect(ext(g).active).toEqual([])
    eat(g, 'it_stim')
    rest(g, 'sleep')
    expect(ext(g).active).toEqual([])
  })

  it('戰鬥中用道具吃：命中 +1、每回合感載加；打完成癮才加、instant 與時間才寫進角色；重來這場戰鬥之後成癮沒加、物品還在', async () => {
    const g = make()
    g.startBattle(setup())
    toTurn(g, 'a1')
    expect(hit(g)).not.toContainEqual(['drug', 1])
    eatInBattle(g)
    expect(hit(g)).toContainEqual(['drug', 1])
    expect(unitDrugs(unit(g, 'a1'))).toEqual({ taken: { it_stim: 1 } })
    // 戰鬥中不直接改角色的狀態
    expect(ext(g).addiction).toEqual({})
    expect(ext(g).active).toEqual([])
    expect(qty(g, 'it_stim')).toBe(5)
    // 下一個自己的回合：感載 +3
    act(g, { action: 'end_turn' })
    toTurn(g, 'a1')
    expect(unit(g, 'a1').load!.now).toBe(3)
    // 重來：什麼都沒發生
    expect(g.retryBattle()).toBeNull()
    expect(ext(g).addiction).toEqual({})
    expect(qty(g, 'it_stim')).toBe(5)
    expect(unit(g, 'a1').ext.drugs).toBeUndefined()
    // 這一次打完
    toTurn(g, 'a1')
    eatInBattle(g)
    await win(g)
    expect(ext(g).addiction.it_stim!.value).toBe(10)
    expect(ext(g).active).toEqual([{ id: 'it_stim', until: START + 10, battle: true }])
    // 隊友沒吃，什麼都沒有
    expect(ext(g, 'mate').addiction).toEqual({})
  })

  it('斷藥（狀態 pump_jam，M4-followups）：這一場吃的藥的修正暫停、每回合維持的感載也暫停；狀態一過又回來', () => {
    const g = make()
    g.startBattle(setup())
    toTurn(g, 'a1')
    eatInBattle(g)
    expect(hit(g)).toContainEqual(['drug', 1])
    const jam = { id: 'pump_jam', until: { at: 'battle_end' } } as never
    unit(g, 'a1').statuses.push(jam)
    expect(hit(g).filter(([s]) => s === 'drug')).toEqual([])
    // 斷藥中輪到自己的回合：維持的感載不加
    act(g, { action: 'end_turn' })
    toTurn(g, 'a1')
    expect(unit(g, 'a1').load!.now).toBe(0)
    unit(g, 'a1').statuses = unit(g, 'a1').statuses.filter((s) => s.id !== 'pump_jam')
    expect(hit(g)).toContainEqual(['drug', 1])
  })

  it('斷藥（M4-followups-2 第 1 項）：戰鬥外吃的藥經 k.passives 進戰鬥的那一份也暫停（核心的 passives 修正濾掉來源 drug）；別的來源不受影響；狀態一過又回來', () => {
    const g = make({ flags: { cyber_regen: true } })
    eat(g, 'it_stim')
    expect(ext(g).active.map((a) => a.id)).toEqual(['it_stim'])
    g.startBattle(setup())
    toTurn(g, 'a1')
    expect(hit(g)).toContainEqual(['drug', 1])
    // 戰鬥外吃的那一份是 k.passives 給的（這一場沒有吃，所以不是 features/drugs 自己掛的那個修正）
    expect(unitDrugs(unit(g, 'a1'))).toBeUndefined()
    const regen = (): number => run(g).mods('ap_regen', unit(g, 'a1')).filter((p) => p.source === 'cyber').reduce((n, p) => n + p.value, 0)
    unit(g, 'a1').statuses.push({ id: 'pump_jam', until: { at: 'battle_end' } } as never)
    expect(hit(g).filter(([s]) => s === 'drug')).toEqual([])
    // 其他來源（義體）照舊
    expect(regen()).toBe(1)
    unit(g, 'a1').statuses = unit(g, 'a1').statuses.filter((s) => s.id !== 'pump_jam')
    expect(hit(g)).toContainEqual(['drug', 1])
  })

  it('同一場吃兩劑：效果不疊加（命中只 +1）、成癮加兩次；戰鬥外已經生效的同一種藥，戰鬥中再吃不重複算', async () => {
    const g = make()
    g.startBattle(setup())
    toTurn(g, 'a1')
    eatInBattle(g)
    eatInBattle(g)
    expect(hit(g).filter(([s]) => s === 'drug')).toEqual([['drug', 1]])
    await win(g)
    expect(ext(g).addiction.it_stim!.value).toBe(20)
    // 戰鬥外先吃了（k.passives 已經算進去），戰鬥中再吃一劑：只算一次
    const h = make()
    eat(h, 'it_stim')
    h.startBattle(setup())
    toTurn(h, 'a1')
    eatInBattle(h)
    expect(hit(h).filter(([s]) => s === 'drug')).toEqual([['drug', 1]])
  })

  it('不是藥的物品（沒有 drug 欄位）用 op drug：被擋；沒有橋的單位吃要橋的藥沒有效果', () => {
    const g = make({ pack: pack((c) => { c.item!.push(item('it_x', '假藥', {}, { drug: undefined, use: { ap: 1, target: 'self', effects: [{ op: 'drug' }] } })) }) })
    expect(drugDef(g.k, 'it_x')).toBeNull()
    const nb = make({ pack: pack((c) => { c.item![1]!.drug.needs_bridge = true }), pc: { ext: { bridge: null } } })
    nb.startBattle(setup())
    toTurn(nb, 'a1')
    eatInBattle(nb)
    expect(hit(nb)).not.toContainEqual(['drug', 1])
  })

  it('兩種都給 ap_regen +1（一個來源 drug、一個來源 cyber）：合計只多 1；只有 drug 或只有 cyber 時各是 1', () => {
    const both = make({ inventory: [{ id: 'it_regen', qty: 2 }], flags: { cyber_regen: true } })
    eat(both, 'it_regen')
    both.startBattle(setup())
    const parts = run(both).mods('ap_regen', unit(both, 'a1'))
    expect(parts.map((p) => [p.source, p.value]).sort()).toEqual([['cyber', 1], ['drug', 1]])
    expect(regenTotal(parts)).toBe(1)
    // 戰鬥中吃的也一樣（來源是 drug，受上限管）
    const inb = make({ flags: { cyber_regen: true } })
    inb.startBattle(setup())
    toTurn(inb, 'a1')
    eatInBattle(inb, 'it_regen')
    const p2 = run(inb).mods('ap_regen', unit(inb, 'a1'))
    expect(p2.map((p) => p.source).sort()).toEqual(['cyber', 'drug'])
    expect(regenTotal(p2)).toBe(1)
  })

  it('內海的單位組成時只抄一次 net_load_decay：戰鬥中吃的藥要自己改單位的 decay（只有第一劑、只在內海）；現實的 decay 是修正，不動單位', () => {
    const game = make({ extra: [TEST_NET_COMBAT], inventory: [] })
    game.startBattle({ ...BATTLE_SETUPS.net(), allies: [{ from: 'actor', id: 'pc' }] })
    const u = Object.values(game.battle!.units).find((x) => x.side === 'ally')!
    expect(u.decay).toBe(0)
    const r = new BattleRun(game.k, game.state, clone(game.battle!))
    const user = r.unit(u.id)
    r.effects([{ op: 'drug', item: 'it_net' }], { user, target: { unit: user.id }, source: { kind: 'item', id: 'it_net', name: '散熱藥' } })
    expect(user.decay).toBe(2)
    // 第二劑不疊加
    r.effects([{ op: 'drug', item: 'it_net' }], { user, target: { unit: user.id }, source: { kind: 'item', id: 'it_net', name: '散熱藥' } })
    expect(user.decay).toBe(2)
    // 內海的修正：mod hit layer net 算、mod decay layer meat 不算
    expect(r.mods('hit', user).map((p) => [p.source, p.value])).toContainEqual(['drug', 1])
    expect(r.mods('decay', user).filter((p) => p.source === 'drug')).toEqual([])
    // 戰鬥外先吃了（k.passives 在開打時算進單位的 decay）：戰鬥中再吃不重複加
    const pre = make({ extra: [TEST_NET_COMBAT], inventory: [{ id: 'it_net', qty: 1 }] })
    eat(pre, 'it_net')
    pre.startBattle({ ...BATTLE_SETUPS.net(), allies: [{ from: 'actor', id: 'pc' }] })
    const pr = new BattleRun(pre.k, pre.state, clone(pre.battle!))
    const pu = pr.unit(Object.values(pre.battle!.units).find((x) => x.side === 'ally')!.id)
    expect(pu.decay).toBe(2)
    pr.effects([{ op: 'drug', item: 'it_net' }], { user: pu, target: { unit: pu.id }, source: { kind: 'item', id: 'it_net', name: '散熱藥' } })
    expect(pu.decay).toBe(2)
    // 現實：同一種藥的 mod decay 是修正（layer meat），單位沒有 decay 欄位、net 的 hit 不算
    const meat = make({ pack: pack(), inventory: [] })
    meat.startBattle(setup())
    const mr = run(meat)
    const mu = mr.unit('a1')
    mr.effects([{ op: 'drug', item: 'it_net' }], { user: mu, target: { unit: 'a1' }, source: { kind: 'item', id: 'it_net', name: '散熱藥' } })
    expect(mu.decay).toBeUndefined()
    expect(mr.mods('decay', mu).filter((p) => p.source === 'drug')).toEqual([{ label: '散熱藥', value: 2, source: 'drug' }])
    expect(mr.mods('hit', mu).filter((p) => p.source === 'drug')).toEqual([])
  })
})

describe('成癮與戒斷', () => {
  it('吃到 45，七天不吃進入戒斷（懲罰生效、drug.wear_off 有一份報告）；戒斷期過完歸零', () => {
    const g = make()
    eat(g, 'it_hard')
    expect(ext(g).addiction.it_hard!.value).toBe(45)
    advance(g, 6 * DAY + 1380)
    expect(ext(g).withdrawal).toEqual({})
    expect(hackFrom(g, 'withdrawal')).toEqual([])
    advance(g, 60)
    expect(ext(g).withdrawal).toEqual({ it_hard: { until: START + 7 * DAY + 5 * DAY, heavy: false } })
    expect(hackFrom(g, 'withdrawal')).toEqual([-4])
    const wd = reports(g, 'drug.wear_off').filter((r) => r.outcome.result === 'withdrawal')
    expect(wd).toHaveLength(1)
    expect(wd[0]!.outcome.summary).toContain('戒斷')
    // 戒斷期（5 天）過完：成癮歸零、懲罰沒了
    advance(g, 5 * DAY)
    expect(ext(g).addiction).toEqual({})
    expect(ext(g).withdrawal).toEqual({})
    expect(hackFrom(g, 'withdrawal')).toEqual([])
    expect(reports(g, 'drug.wear_off').some((r) => r.outcome.result === 'recovered')).toBe(true)
  })

  it('一次睡很久（跨過戒斷開始與結束）：照時間順序算，成癮歸零，報告有兩件事', () => {
    const g = make()
    eat(g, 'it_hard')
    advance(g, 40 * DAY)
    expect(ext(g).addiction).toEqual({})
    expect(ext(g).withdrawal).toEqual({})
    const texts = reports(g, 'drug.wear_off').map((r) => r.outcome.summary).join('')
    expect(texts).toContain('進入')
    expect(texts).toContain('過完了')
  })

  it('重度（80 以上）三天就戒斷而且懲罰是兩倍；戒斷中再吃一劑，戒斷取消、計時重來', () => {
    const g = make()
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 85 }])
    expect(ext(g).addiction.it_hard!.value).toBe(85)
    advance(g, 3 * DAY - 1)
    expect(ext(g).withdrawal).toEqual({})
    advance(g, 1)
    expect(ext(g).withdrawal.it_hard).toEqual({ until: START + 3 * DAY + 5 * DAY, heavy: true })
    expect(hackFrom(g, 'withdrawal')).toEqual([-8])
    // 再吃一劑：懲罰消失（只剩藥效）、成癮 100、計時重來
    eat(g, 'it_hard')
    expect(ext(g).withdrawal).toEqual({})
    expect(hackFrom(g, 'withdrawal')).toEqual([])
    expect(ext(g).addiction.it_hard).toMatchObject({ value: 100, last: START + 3 * DAY })
    advance(g, 3 * DAY - 1)
    expect(ext(g).withdrawal).toEqual({})
    advance(g, 1)
    expect(ext(g).withdrawal.it_hard).toMatchObject({ heavy: true })
  })

  it('每週一，這一週沒用過的藥成癮 −10（這一週用過的不退）；一路退到 0 就整筆拿掉，每次有一份報告', () => {
    const g = make()
    eat(g, 'it_focus')
    expect(ext(g).addiction.it_focus!.value).toBe(20)
    // 第一個週一：這一週用過
    advanceTo(g, MON1 + 1)
    expect(ext(g).addiction.it_focus!.value).toBe(20)
    expect(reports(g, 'drug.wear_off').filter((r) => r.outcome.result === 'decay')).toHaveLength(0)
    // 之後每個週一沒用過：−10
    advanceTo(g, MON2 + 1)
    expect(ext(g).addiction.it_focus!.value).toBe(10)
    expect(reports(g, 'drug.wear_off').filter((r) => r.outcome.result === 'decay')).toHaveLength(1)
    // 吃一劑又算用過
    eat(g, 'it_focus')
    expect(ext(g).addiction.it_focus!.value).toBe(30)
    advanceTo(g, MON2 + RULE.every + 1)
    expect(ext(g).addiction.it_focus!.value).toBe(30)
    advanceTo(g, MON2 + 2 * RULE.every + 1)
    expect(ext(g).addiction.it_focus!.value).toBe(20)
    advanceTo(g, MON2 + 3 * RULE.every + 1)
    advanceTo(g, MON2 + 4 * RULE.every + 1)
    expect(ext(g).addiction).toEqual({})
  })

  it('鎮靜劑生效時戒斷的懲罰減半（無條件捨去、最少 1）；重度先 ×2 再減半', () => {
    const g = make()
    eat(g, 'it_hard')
    advance(g, 7 * DAY)
    expect(hackFrom(g, 'withdrawal')).toEqual([-4])
    eat(g, 'it_calm')
    expect(hackFrom(g, 'withdrawal')).toEqual([-2])
    // 鎮靜劑藥效過了就回到全額
    advance(g, 1441)
    expect(hackFrom(g, 'withdrawal')).toEqual([-4])
    // 直接看函式：最少 1、重度 ×2 再減半、沒有 amount 的原樣
    expect(scaledWithdrawal([HACK(-1), HACK(-3), { unit_tag: 'shaky' }] as never, false, true)).toEqual([HACK(-1), HACK(-1), { unit_tag: 'shaky' }])
    expect(scaledWithdrawal([HACK(-1), HACK(-3)] as never, true, true)).toEqual([HACK(-1), HACK(-3)])
    expect(scaledWithdrawal([HACK(-4)] as never, true, false)).toEqual([HACK(-8)])
  })

  it('條件 drug_active 與 addicted（預設依賴以上）', () => {
    const g = make()
    const ctx = { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules }
    const t = (c: Condition) => g.k.conditions.test(c, { ...ctx, state: g.state })
    expect(t({ kind: 'drug_active', id: 'it_focus' })).toBe(false)
    eat(g, 'it_focus')
    expect(t({ kind: 'drug_active', id: 'it_focus' })).toBe(true)
    expect(t({ kind: 'drug_active', id: 'it_stim' })).toBe(false)
    expect(t({ kind: 'addicted', id: 'it_focus' })).toBe(false)
    expect(t({ kind: 'addicted', id: 'it_focus', min: 20 })).toBe(true)
    eat(g, 'it_hard')
    expect(t({ kind: 'addicted', id: 'it_hard' })).toBe(true)
    expect(t({ kind: 'addicted' })).toBe(true)
    expect(g.k.conditions.validate({ kind: 'drug_active' })).not.toEqual([])
    expect(g.k.conditions.validate({ kind: 'addicted', min: 'x' })).not.toEqual([])
  })

  it('規則表可以蓋掉：依賴的門檻與天數、每週消退', () => {
    const g = make({ pack: pack((c) => { (c as Rec).drug_rule = [{ id: 'default', depend_at: 20, depend_days: 2, weekly_decay: 5 }] }) })
    expect(drugRules(g.k)).toMatchObject({ depend_at: 20, depend_days: 2, weekly_decay: 5, heavy_at: 80, detox: { amount: 40, days: 3, price: 600 } })
    eat(g, 'it_focus')
    advance(g, 2 * DAY)
    expect(ext(g).withdrawal.it_focus).toBeDefined()
    const d = make()
    expect(drugRules(d.k)).toEqual(DEFAULT_DRUG_RULES)
  })
})

describe('抑制劑（P20）：每週帳單的一項', () => {
  /** 這一週的帳單：問 bill.collect，付了或沒付，把 bill.settled 回傳的變更提交。 */
  const settle = (g: G, monday: number, paid: boolean): string[] => {
    const week = Math.floor((monday - RULE.offset) / RULE.every) + 1
    const got = g.k.hooks.run('bill.collect' as never, { state: g.state, week } as never) as Array<{ result: Rec[] }>
    const lines = got.flatMap((x) => x.result).filter((l) => l.owner === 'drugs')
    const settled = lines.map((l) => ({ ...l, paid: paid ? l.amount : 0, unpaid: paid ? 0 : l.amount }))
    const res = g.k.hooks.run('bill.settled' as never, { state: g.state, week, lines: settled } as never) as Array<{ result: ReportDraft['changes'] }>
    const changes = res.flatMap((x) => x.result)
    if (changes.length > 0) g.commit(draft(changes, 'test.settle'))
    return lines.map((l) => `${l.id}:${l.amount}:${l.order}:${l.pay}`)
  }
  const weeklyOn = (g: G) => g.commit(suppressantDraft(g.k, g.state, { weekly: true }))

  it('開著而且付了：sink_floor −10、看到的沉溺 −20（到下一個週一）；沒開就不出帳單', () => {
    const g = make()
    expect(settle(g, MON1, true)).toEqual([])
    weeklyOn(g)
    expect(floor(g)).toBe(12)
    advanceTo(g, MON1)
    expect(settle(g, MON1, true)).toEqual(['drug.suppressant:80:3:cred'])
    expect(ext(g).suppressant).toMatchObject({ until: MON2, weekly: true })
    expect(floor(g)).toBe(2)
    expect(shown(g)).toBe(30)
    advanceTo(g, MON2 - 1)
    expect(floor(g)).toBe(2)
    // 下一週繼續付：一直接上
    advanceTo(g, MON2)
    settle(g, MON2, true)
    expect(floor(g)).toBe(2)
    expect(ext(g).suppressant!.until).toBe(MON2 + RULE.every)
    // 關掉
    g.commit(suppressantDraft(g.k, g.state, { weekly: false }))
    expect(ext(g).suppressant!.weekly).toBeUndefined()
    expect(settle(g, MON2 + RULE.every, true)).toEqual([])
  })

  it('下一週沒付：sink_floor +15、持續兩週，之後回到原樣；反彈期間再付，−10 照給、反彈照跑完', () => {
    const g = make()
    weeklyOn(g)
    advanceTo(g, MON1)
    settle(g, MON1, true)
    advanceTo(g, MON2)
    settle(g, MON2, false)
    expect(ext(g).suppressant).toMatchObject({ rebound_until: MON2 + 14 * DAY })
    expect(floor(g)).toBe(12 + 15)
    expect(shown(g)).toBe(50)
    advanceTo(g, MON2 + 7 * DAY)
    // 第三週付了：−10 照給，反彈照跑完
    settle(g, MON2 + 7 * DAY, true)
    expect(floor(g)).toBe(12 - 10 + 15)
    advanceTo(g, MON2 + 14 * DAY - 1)
    expect(floor(g)).toBe(12 - 10 + 15)
    // 兩週到了：反彈和這一週份的藥效一起結束；再付一次下限才又壓下去
    advanceTo(g, MON2 + 14 * DAY)
    expect(floor(g)).toBe(12)
    settle(g, MON2 + 14 * DAY, true)
    expect(floor(g)).toBe(12 - 10)
    // 上一週沒有吃（沒付又沒有蓋到）就沒有反彈
    const h = make()
    weeklyOn(h)
    advanceTo(h, MON1)
    settle(h, MON1, false)
    expect(ext(h).suppressant!.rebound_until).toBeUndefined()
    expect(floor(h)).toBe(12)
  })

  it('吃一劑抑制劑（suppressant: true 的物品）等於付了這一週；不走成癮', () => {
    const g = make({ inventory: [{ id: 'it_supp', qty: 2 }] })
    eat(g, 'it_supp')
    expect(ext(g).suppressant).toMatchObject({ until: MON1 })
    expect(ext(g).addiction).toEqual({})
    expect(floor(g)).toBe(2)
    advanceTo(g, MON1)
    expect(floor(g)).toBe(12)
    // 開關：戰鬥中不行；改了才會有帳單
    expect(suppressantBlock(g.k, g.state, { weekly: true })).toBeNull()
    g.startBattle(setup())
    expect(suppressantBlock(g.k, g.state, { weekly: true })).toBe('戰鬥中不能改帳單的設定。')
    expect(() => suppressantDraft(g.k, g.state, { weekly: true })).toThrow(ActionBlocked)
  })

  it('溺感者（條件 sunk 成立）兩個都沒有；沒有人註冊 sunk 就當作不成立', () => {
    const g = make({ extra: [SUNK_YES], inventory: [{ id: 'it_supp', qty: 2 }] })
    eat(g, 'it_supp')
    expect(ext(g).suppressant!.until).toBe(MON1)
    expect(floor(g)).toBe(12)
    expect(shown(g)).toBe(50)
    // 反彈也沒有
    weeklyOn(g)
    advanceTo(g, MON1)
    settle(g, MON1, true)
    advanceTo(g, MON2)
    settle(g, MON2, false)
    expect(ext(g).suppressant!.rebound_until).toBeDefined()
    expect(floor(g)).toBe(12)
    // 對照：沒有 sunk 的人有
    const h = make({ inventory: [{ id: 'it_supp', qty: 2 }] })
    eat(h, 'it_supp')
    expect(floor(h)).toBe(2)
    expect(shown(h)).toBe(30)
  })

  it('價錢、幅度、天數都在規則表（drug_rule.suppressant）', () => {
    const g = make({ pack: pack((c) => { (c as Rec).drug_rule = [{ id: 'default', suppressant: { floor: -5, shown: -10, rebound: 8, rebound_days: 7, price: 120 } }] }) })
    weeklyOn(g)
    advanceTo(g, MON1)
    expect(settle(g, MON1, true)).toEqual(['drug.suppressant:120:3:cred'])
    expect(floor(g)).toBe(7)
    expect(shown(g)).toBe(40)
    advanceTo(g, MON2)
    settle(g, MON2, false)
    expect(floor(g)).toBe(20)
    advanceTo(g, MON2 + 7 * DAY)
    expect(floor(g)).toBe(12)
  })
})

describe('戒斷療程', () => {
  const at = (g: G, here: string) => { g.state.flags.here = here }

  it('成癮 60 變 20、時間 +3 天、扣 600（帳戶）；成癮的值留 20，不會因此歸零', () => {
    const g = make()
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 60 }])
    at(g, 'fac_clinic')
    const t0 = now(g)
    const q = detoxQuote(g.k, g.state, { actor: 'pc', drug: 'it_hard' })!
    expect(q).toMatchObject({ value: 60, after: 20, price: 600, minutes: 3 * DAY, free: false, pay: 'cred', place: '診所' })
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: 'it_hard' }))
    expect(ext(g).addiction.it_hard!.value).toBe(20)
    expect(now(g)).toBe(t0 + 3 * DAY)
    expect(g.state.money).toEqual({ cred: 4400, cash: 500 })
    expect(reports(g, 'drug.detox')).toHaveLength(1)
  })

  it('療程的價錢乘這一區的物價倍率（drug_rule.detox.district_price，預設乘；M4 收尾修正批）：倍率 2 時 600 變 1,200；關掉照舊；免費的設施不收；格式不對載入時擋下', () => {
    const DISTRICT: Feature = { id: 'district_stub', install: (k) => k.content.defineKind({ kind: 'district', owner: 'district_stub', validate: () => [] }) }
    const priced = (mult: number, detox?: Rec) => {
      const g = make({
        extra: [DISTRICT],
        pack: pack((c) => { (c as Rec).district = [{ id: 'd_x', name: '某區', price_mult: mult }]; if (detox) (c as Rec).drug_rule = [{ id: 'default', detox }] }),
      })
      g.state.location = { district: 'd_x' }
      fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 60 }])
      at(g, 'fac_clinic')
      return g
    }
    const g = priced(2)
    expect(detoxQuote(g.k, g.state, { actor: 'pc', drug: 'it_hard' })).toMatchObject({ price: 1200 })
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: 'it_hard' }))
    expect(g.state.money.cred).toBe(5000 - 1200)
    const off = priced(2, { district_price: false })
    expect(detoxQuote(off.k, off.state, { actor: 'pc', drug: 'it_hard' })).toMatchObject({ price: 600 })
    expect(detoxQuote(priced(1).k, priced(1).state, { actor: 'pc', drug: 'it_hard' })).toMatchObject({ price: 600 })
    const free = priced(3)
    at(free, 'fac_free')
    expect(detoxQuote(free.k, free.state, { actor: 'pc', drug: 'it_hard' })).toMatchObject({ price: 0, free: true })
    expect(() => priced(1, { district_price: 'x' })).toThrow(/district_price/)
  })

  it('療程把成癮降到 0 就整筆拿掉（戒斷也結束）；設施種類寫 detox: { free: true } 的不收錢', () => {
    const g = make()
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 30 }])
    at(g, 'fac_free')
    expect(detoxQuote(g.k, g.state, { actor: 'pc', drug: 'it_hard' })).toMatchObject({ price: 0, free: true, pay: null })
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: 'it_hard' }))
    expect(ext(g).addiction).toEqual({})
    expect(g.state.money).toEqual({ cred: 5000, cash: 500 })
  })

  it('蜜糖會的互助診所（M4-followups-2 第 7 項）：detox.favor 的勢力好感到了 min 才免費，差一點照收；沒有好感量表的當 0；格式不對載入時擋下', () => {
    const honey = pack((c) => {
      c.faction = [{ id: 'f_honey', name: '蜜糖會', short: '蜜糖', class: 'street' }]
      c.facility_type!.push({ id: 'fac_mutual', name: '互助診所', detox: { favor: { faction: 'f_honey', min: 30 } } })
    })
    const g = make({ pack: honey, extra: [meterFeature(testMeter({ kind: 'favor', keyed: 'faction', name: '好感' }))] })
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 60 }])
    at(g, 'fac_mutual')
    const q = () => detoxQuote(g.k, g.state, { actor: 'pc', drug: 'it_hard' })!
    expect(q()).toMatchObject({ free: false, price: 600, place: '互助診所' })
    g.commit(draft([{ op: 'meter', kind: 'favor', key: 'f_honey', set: 29 }]))
    expect(q()).toMatchObject({ free: false, price: 600 })
    g.commit(draft([{ op: 'meter', kind: 'favor', key: 'f_honey', set: 30 }]))
    expect(q()).toMatchObject({ free: true, price: 0, pay: null })
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: 'it_hard' }))
    expect(g.state.money).toEqual({ cred: 5000, cash: 500 })
    // 沒有好感量表（勢力的功能沒裝）：當 0，不免費
    const bare = make({ pack: honey })
    fx(bare, [{ kind: 'addiction', id: 'it_hard', amount: 60 }])
    at(bare, 'fac_mutual')
    expect(detoxQuote(bare.k, bare.state, { actor: 'pc', drug: 'it_hard' })).toMatchObject({ free: false, price: 600 })
    // 格式與引用
    const bad = (detox: Rec) => () => make({ pack: pack((c) => { c.facility_type!.push({ id: 'fac_x', name: 'X', detox }) }) })
    expect(bad({ favor: { faction: 'f_honey', min: 130 } })).toThrow(ContentError)
    expect(bad({ favor: { faction: 'f_nobody', min: 30 } })).toThrow(/detox\.favor/)
    expect(bad({ extra: true })).toThrow(ContentError)
  })

  it('做不了的原因：沒有診所、沒有成癮、錢不夠、戰鬥中；指定現金就從現金扣', () => {
    const g = make({ money: { cred: 100, cash: 700 } })
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 60 }])
    expect(detoxBlock(g.k, g.state, { actor: 'pc', drug: 'it_hard' })).toBe('這裡沒有提供戒斷療程的診所。')
    at(g, 'fac_bar')
    expect(detoxBlock(g.k, g.state, { actor: 'pc', drug: 'it_hard' })).toBe('這裡沒有提供戒斷療程的診所。')
    at(g, 'fac_clinic')
    expect(detoxBlock(g.k, g.state, { actor: 'pc', drug: 'it_focus' })).toBe('測試主角沒有檢定藥的成癮。')
    // 帳戶不夠、現金夠：先帳戶再現金
    expect(detoxQuote(g.k, g.state, { actor: 'pc', drug: 'it_hard' })!.pay).toBe('cash')
    expect(detoxBlock(g.k, g.state, { actor: 'pc', drug: 'it_hard', pay: 'cred' })).toMatch(/錢不夠/)
    g.commit(detoxDraft(g.k, g.state, { actor: 'pc', drug: 'it_hard' }))
    expect(g.state.money).toEqual({ cred: 100, cash: 100 })
    const poor = make({ money: { cred: 10, cash: 10 } })
    fx(poor, [{ kind: 'addiction', id: 'it_hard', amount: 60 }])
    at(poor, 'fac_clinic')
    expect(detoxBlock(poor.k, poor.state, { actor: 'pc', drug: 'it_hard' })).toMatch(/錢不夠/)
    expect(() => detoxDraft(poor.k, poor.state, { actor: 'pc', drug: 'it_hard' })).toThrow(ActionBlocked)
    at(poor, 'fac_clinic')
    poor.startBattle(setup())
    expect(detoxBlock(poor.k, poor.state, { actor: 'pc', drug: 'it_hard' })).toBe('戰鬥中不能做戒斷療程。')
  })
})

describe('效果 drug、addiction（給事件）', () => {
  it('效果 drug 讓人進入藥效、成癮照加，而物品沒少；AI 給的被擋', () => {
    const g = make()
    fx(g, [{ kind: 'drug', id: 'it_focus' }])
    expect(qty(g, 'it_focus')).toBe(5)
    expect(hackFrom(g, 'drug')).toEqual([2])
    expect(ext(g).addiction.it_focus!.value).toBe(20)
    const ctx = effectCtx(g.k, g.state, { source: 'ai' })
    expect(g.k.effects.validate([{ kind: 'drug', id: 'it_focus' }] as never, ctx)).not.toEqual([])
    expect(g.k.effects.validate([{ kind: 'addiction', id: 'it_focus', amount: 5 }] as never, ctx)).not.toEqual([])
    expect(g.k.effects.aiKinds()).not.toContain('drug')
    expect(g.k.effects.aiKinds()).not.toContain('addiction')
    // 格式：不是藥、不會成癮的藥、amount 為 0
    const ok = effectCtx(g.k, g.state, { source: 'builtin' })
    expect(g.k.effects.validate([{ kind: 'drug', id: 'it_nope' }] as never, ok)).not.toEqual([])
    expect(g.k.effects.validate([{ kind: 'addiction', id: 'it_calm', amount: 5 }] as never, ok)).not.toEqual([])
    expect(g.k.effects.validate([{ kind: 'addiction', id: 'it_hard', amount: 0 }] as never, ok)).not.toEqual([])
  })

  it('效果 addiction：加減、夾在 0～100；減到 0 整筆拿掉；對別人用（actor）', () => {
    const g = make()
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: 70 }, { kind: 'addiction', id: 'it_hard', amount: 70 }])
    expect(ext(g).addiction.it_hard!.value).toBe(100)
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: -30 }])
    expect(ext(g).addiction.it_hard!.value).toBe(70)
    fx(g, [{ kind: 'addiction', id: 'it_hard', amount: -100 }])
    expect(ext(g).addiction).toEqual({})
  })

  it('instant 也能寫在 after 裡；instant 裡不能再寫 drug（吃一劑裡面又吃一劑會繞圈）', () => {
    expect(() => make({ pack: pack((c) => { c.item![0]!.drug.instant = [{ kind: 'drug', id: 'it_focus' }] }) })).toThrow(/instant 裡不能再寫 drug/)
  })
})

describe('存檔、回到快照、內容的格式', () => {
  it('存檔再讀：actor.ext.drugs 跟著走（藥效、成癮、戒斷、後續、抑制劑）', () => {
    const g = make({ inventory: [{ id: 'it_hard', qty: 3 }, { id: 'it_supp', qty: 1 }, { id: 'it_after', qty: 1 }] })
    eat(g, 'it_hard')
    eat(g, 'it_supp')
    eat(g, 'it_after')
    advance(g, 7 * DAY)
    expect(ext(g).withdrawal.it_hard).toBeDefined()
    const before = clone(g.state.actors.pc!.ext.drugs)
    const copy = make({ inventory: [] })
    expect(copy.load(g.save())).toBeNull()
    expect(copy.state.actors.pc!.ext.drugs).toEqual(before)
    expect(hackFrom(copy, 'withdrawal')).toEqual([-4])
    expect(floor(copy)).toBe(12)
  })

  it('回到快照：藥、成癮與戒斷跟著回去', () => {
    const g = make()
    g.commit({ ...draft([{ op: 'snapshot.take', kind: 'drug_test', label: '吃藥之前' }, { op: 'time', minutes: 1 }], 'test.snap') })
    eat(g, 'it_hard')
    advance(g, 7 * DAY)
    expect(ext(g).withdrawal.it_hard).toBeDefined()
    expect(g.rewindToKind('drug_test', '回到吃藥之前。')).toBeNull()
    expect(ext(g).addiction).toEqual({})
    expect(ext(g).withdrawal).toEqual({})
    expect(ext(g).active).toEqual([])
    expect(hackFrom(g, 'withdrawal')).toEqual([])
  })

  it('壞掉的 actor.ext.drugs（讀檔修復）：缺的與壞的欄位補成空的，不會丟錯', () => {
    const g = make()
    g.state.actors.pc!.ext.drugs = { active: [{ id: 5 }, { id: 'it_focus', until: 'x' }, { id: 'it_focus', until: START + 10 }], addiction: { it_hard: { value: 'x' }, it_focus: { value: 30, last: START } }, withdrawal: 3, pending: [{ at: 1, drug: 'x', kind: 'zzz' }], suppressant: 'x' }
    expect(ext(g)).toEqual({ active: [{ id: 'it_focus', until: START + 10 }], addiction: { it_focus: { value: 30, last: START, used_week: false } }, withdrawal: {}, pending: [] })
    expect(hackFrom(g, 'drug')).toEqual([2])
    advance(g, 20)
    expect(hackFrom(g, 'drug')).toEqual([])
  })

  it('drugView：生效中、成癮與戒斷的進度、抑制劑、背包裡的藥能不能吃', () => {
    const g = make()
    eat(g, 'it_focus')
    eat(g, 'it_hard')
    const v = drugView(g.k, g.state, 'pc')!
    expect(v.active.map((a) => [a.id, a.left])).toEqual([['it_focus', 240], ['it_hard', 60]])
    const hard = v.addiction.find((a) => a.id === 'it_hard')!
    expect(hard).toMatchObject({ value: 45, stage: 'dependent', withdrawal: null })
    expect(hard.until_withdrawal).toBe(7 * DAY)
    expect(v.addiction.find((a) => a.id === 'it_focus')).toMatchObject({ stage: 'none', until_withdrawal: null })
    expect(v.usable.find((u) => u.item === 'it_stim')).toMatchObject({ qty: 5, block: null })
    expect(v.suppressant).toMatchObject({ weekly: false, active: false, price: 80 })
    expect(v.detox_here).toBeNull()
    expect(drugView(g.k, g.state, 'nobody')).toBeNull()
  })

  it('內容的格式：欄位寫錯在載入時擋下（每一條以 item/<id>： 開頭）；給回復寫成 stat 也擋（會繞過全身 +1）；detox 格式', () => {
    const bad = (patch: (c: Record<string, Rec[]>) => void): string => {
      try {
        make({ pack: pack(patch) })
      } catch (e) {
        expect(e).toBeInstanceOf(ContentError)
        return (e as ContentError).message
      }
      return ''
    }
    expect(bad((c) => { c.item![0]!.drug.duration = { minutes: 0 } })).toMatch(/item\/it_focus：drug\.duration\.minutes/)
    expect(bad((c) => { c.item![0]!.drug.duration = {} })).toMatch(/item\/it_focus：drug\.duration 要寫 minutes/)
    expect(bad((c) => { c.item![0]!.drug.zzz = 1 })).toMatch(/item\/it_focus：drug\.zzz/)
    expect(bad((c) => { c.item![0]!.drug.effects = [{ stat: 'ram_regen', amount: 1 }] })).toMatch(/item\/it_focus：drug\.effects\[0\]\.stat.*mod: 'ram_regen'/)
    expect(bad((c) => { c.item![0]!.drug.effects = [{ mod: 'nope', amount: 1 }] })).toMatch(/drug\.effects\[0\]\.mod/)
    expect(bad((c) => { c.item![0]!.drug.addiction = { per_dose: 5 } })).toMatch(/drug\.addiction\.withdrawal/)
    expect(bad((c) => { c.item![0]!.drug.addiction.withdrawal.days = 0 })).toMatch(/withdrawal\.days/)
    expect(bad((c) => { c.item![0]!.drug.after = { effects: [HACK(-1)] } })).toMatch(/drug\.after\.effects 要搭配/)
    expect(bad((c) => { c.item![0]!.drug.instant = [{ kind: 'no_such_effect' }] })).toMatch(/drug\.instant/)
    expect(bad((c) => { c.item![0]!.drug.needs_bridge = 'yes' })).toMatch(/needs_bridge 要是 true 或 false/)
    expect(bad((c) => { c.facility_type![1]!.detox = { free: 'yes' } })).toMatch(/facility_type\/fac_free：detox/)
    expect(bad((c) => { (c as Rec).drug_rule = [{ id: 'default', depend_at: 'x' }] })).toMatch(/depend_at/)
    // 對的不擋
    expect(bad(() => {})).toBe('')
    // 沒有 drug 欄位的物品不管
    expect(bad((c) => { c.item!.push({ id: 'it_plain', name: '糖', desc: '糖。', category: 'consumable', grade: 1, size: 0, legal: 'free' }) })).toBe('')
  })
})

// ---- ITEMS 4.2 節的藥（示意資料：寫得出來的寫成資料，寫不出來的列在 DRUG_GAPS；M4-followups-2 第 7 項） ----

describe('ITEMS 4.2 節的藥目錄（testkit 的示意資料）', () => {
  const CAT: ContentPack = { id: 'items42', content: { item: clone(ITEMS_42_DRUGS) } } as unknown as ContentPack
  const full = () => new Game({ features: allFeatures(), content: [CORE_PACK, CAT], strict: true, ai: { ai: 0 } })
  const real = () => makeGame({
    features: allFeatures(), content: [CORE_PACK, CAT], seed: 7,
    patch: { time: fromMinutes(START), inventory: ITEMS_42_DRUGS.map((d) => ({ id: d.id, qty: 3 })) as never },
  }).game
  const stat = (g: ReturnType<typeof real>, id: string, actor = 'pc') => g.k.stats.stat(g.state, actor, id)
  const mod = (g: ReturnType<typeof real>, kind: string): number => g.k.passives.modParts(g.state, 'pc', kind).reduce((n, p) => n + p.value, 0)
  const bonus = (g: ReturnType<typeof real>, o: { attr?: string; skill?: string; tags?: string[] }) => checkParts(g.k.stats, g.state, 'pc', { ...o, tags: o.tags ?? [] } as never).reduce((n, p) => n + p.value, 0)

  it('目錄的每一種都載得進正式的功能與資料（嚴格模式、參照都對得上）；id 不重複、價錢照表、都是藥', () => {
    const g = full()
    expect(g.k.content.checkRefs()).toEqual([])
    const ids = ITEMS_42_DRUGS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(25)
    for (const id of ids) expect(g.k.content.get('item', id), id).toMatchObject({ category: 'drug' })
    const price = (id: string): number => (ITEMS_42_DRUGS.find((d) => d.id === id) as Rec).price
    expect([price('drug_cotton'), price('drug_calm'), price('drug_focus'), price('drug_armadillo'), price('drug_m7'), price('drug_allegro'), price('drug_yae')]).toEqual([30, 30, 90, 100, 290, 1200, 1800])
    // 每一種都有成癮（戒斷的天數與份量）；只有鎮靜劑多一個 eases_withdrawal
    for (const d of ITEMS_42_DRUGS) expect((d.drug as Rec).addiction.withdrawal.days, d.id).toBeGreaterThan(0)
    expect(ITEMS_42_DRUGS.filter((d) => (d.drug as Rec).eases_withdrawal).map((d) => d.id)).toEqual(['drug_calm'])
  })

  it('寫不出來的藥效都列在 DRUG_GAPS（連同原因）：每一筆有 drug、effect、why；drug 是目錄裡的藥或整種寫不出來的藥', () => {
    expect(DRUG_GAPS.length).toBeGreaterThan(5)
    const ids = new Set(ITEMS_42_DRUGS.map((d) => d.id))
    for (const gap of DRUG_GAPS) {
      expect(gap.effect.length, gap.drug).toBeGreaterThan(3)
      expect(gap.why.length, gap.drug).toBeGreaterThan(1)
      expect(ids.has(gap.drug) || gap.drug.startsWith('it_'), gap.drug).toBe(true)
    }
    // 整種寫不出來的：不在目錄裡
    for (const id of ['it_listen', 'it_lotus', 'it_allnight']) expect(ids.has(id)).toBe(false)
  })

  it('吃下去有效果：提神錠（黑咖）先攻 +3；鎮靜劑（靜）定力 +2、先攻 −3、表演與誘惑 −2；犰狳 耐受 +20、慾求 +10；成癮是下一週的戒斷', () => {
    const g = real()
    expect(mod(g, 'initiative')).toBe(0)
    g.commit(useDraft(g.k, g.state, { actor: 'pc', item: 'drug_coffee' }))
    expect(mod(g, 'initiative')).toBe(3)
    const h = real()
    h.commit(useDraft(h.k, h.state, { actor: 'pc', item: 'drug_calm' }))
    expect(bonus(h, { attr: 'resolve', skill: 'composure' })).toBe(bonus(real(), { attr: 'resolve', skill: 'composure' }) + 2)
    expect(mod(h, 'initiative')).toBe(-3)
    expect(bonus(h, { attr: 'charm', skill: 'perform' })).toBe(bonus(real(), { attr: 'charm', skill: 'perform' }) - 2)
    const a = real()
    const before = { tolerance: stat(a, 'bridge_tolerance'), craving: stat(a, 'bridge_craving') }
    a.commit(useDraft(a.k, a.state, { actor: 'pc', item: 'drug_armadillo' }))
    expect(stat(a, 'bridge_tolerance') - before.tolerance).toBe(20)
    expect(stat(a, 'bridge_craving') - before.craving).toBe(10)
  })

  it('感知類（甜水）是 perception 標籤的檢定加成：調查與街頭直覺都帶；專注劑（白板）介面 +2、機械與義體學 +2；沉溺 +3 走暫時的下限', () => {
    const g = real()
    const plain = real()
    g.commit(useDraft(g.k, g.state, { actor: 'pc', item: 'drug_sweet' }))
    expect(bonus(g, { attr: 'intellect', skill: 'investigate', tags: ['perception'] })).toBe(bonus(plain, { attr: 'intellect', skill: 'investigate', tags: ['perception'] }) + 2)
    expect(bonus(g, { attr: 'intellect', skill: 'streetwise', tags: ['perception'] })).toBe(bonus(plain, { attr: 'intellect', skill: 'streetwise', tags: ['perception'] }) + 2)
    // 沒帶標籤的別種檢定不吃
    expect(bonus(g, { attr: 'intellect', skill: 'hack' })).toBe(bonus(plain, { attr: 'intellect', skill: 'hack' }))
    const f = real()
    const floor0 = f.k.stats.stat(f.state, 'pc', 'sink_floor')
    f.commit(useDraft(f.k, f.state, { actor: 'pc', item: 'drug_focus' }))
    expect(bonus(f, { attr: 'intellect', skill: 'interface' })).toBe(bonus(plain, { attr: 'intellect', skill: 'interface' }) + 2)
    expect(f.k.stats.stat(f.state, 'pc', 'sink_floor')).toBe(floor0 + 3)
  })

  it('一場戰鬥的藥（M7）：命中 +1、迴避 +1、感載上限 −4；跟著成癮', () => {
    const g = real()
    g.commit(useDraft(g.k, g.state, { actor: 'pc', item: 'drug_m7' }))
    const cap0 = stat(real(), 'load_cap')
    expect(stat(g, 'load_cap')).toBe(cap0 - 4)
    expect(mod(g, 'hit')).toBe(1)
    expect(mod(g, 'evade')).toBe(1)
    expect(readDrugs(g.state, 'pc').addiction.drug_m7!.value).toBe(20)
  })
})
