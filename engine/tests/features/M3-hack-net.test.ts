// 驗收測試：dev/work/M3-hack-net.md（cpp-feature）。features/hack 的 M3 部分：快駭在內海照用並加追蹤度；
// 現實被發現時加那個勢力的敵對值（E9）；技能做的快駭同一條；敵方潛網者的主控階數讀 ext.net.admin。
// 規格：NETRUNNING 第 2、5 節；ITEMS 11.9 節「怎麼用」；CYBERSPACE 6.3 節最後一條；dev/adr/0018 第十一節與 N21；dev/adr/0015 E5、E9。
// 程式、單位、技能都是測試自帶的假資料；net.trace 與 hostility 用測試的替身（另外有一條用真的 netcombat 對一次）。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel } from '../../src'
import { BattleRun, clone, createKernel, endBattle, performAction, readyFeatures, setupBattle } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import { hackFeature, traceOfAction, treeTier } from '../../src/features/hack'
import { netcombatFeature } from '../../src/features/netcombat'
import { enemyUnit, fixDice, laceUnit, makeState, netAvatar, partyUnit } from '../../src/testkit'

type Rec = Record<string, unknown>

// ---- 假資料 ----

const prog = (id: string, cls: string, more: Rec = {}): Rec & { id: string } => ({ id, name: id, desc: `${id}。`, class: cls, grades: [1, 2, 3, 4], ram: 2, ap: 1, target: 'foe', do: [{ op: 'load', amount: 2, type: 'neural' }], ...more })
const PROGRAMS = [
  prog('p_fail', 'neural', { trace: 1 }),
  prog('p_stand', 'neural', { trace: 2 }),
  prog('p_down', 'neural', { trace: 4 }),
  prog('p_none', 'neural'),
  prog('p_zero', 'neural', { trace: 0 }),
  prog('p_mark', 'support', { ram: 1, trace: 5, do: [{ op: 'status', status: 'marked', until: 'source_turn_start' }] }),
  prog('p_vent', 'support', { ram: 1, trace: 5, target: 'ally', do: [{ op: 'vent', amount: 2 }] }),
  prog('p_self', 'support', { ram: 1, trace: 5, target: 'self', do: [{ op: 'vent', amount: 1 }] }),
]
const SLOTS = PROGRAMS.map((p) => p.id)

const STATUSES = [
  { id: 'marked', name: '標記', desc: '被標記：全隊打他命中 +2。', mods: { hit_against: 2 }, until: 'source_turn_start', turns: 1, kind: 'mark' },
]
const PACK: ContentPack = {
  id: 'hack_net_test',
  content: {
    skill: [{ id: 'interface', name: '介面', attr: 'intellect', desc: '快駭的介面。' }],
    battle_status: STATUSES,
    quickhack: PROGRAMS,
    // 技能資料（替身）：sk_zap 寫了 trace 3；sk_plain 沒寫；sk_other 寫了 5 但行動不帶 hack 標籤
    ability: [{ id: 'sk_zap', trace: 3 }, { id: 'sk_plain' }, { id: 'sk_other', trace: 5 }],
    district: [{ id: 'test', factions: ['gang', 'other'] }, { id: 'empty', factions: [] }],
    faction: [{ id: 'corp', name: '大企業', short: '企業', class: 'corp' }, { id: 'gang', name: '幫派', short: '幫派', class: 'street' }],
  },
} as unknown as ContentPack

/** 替身：效果 hostility（記成計數器 host:<勢力>）、戰鬥效果 net.trace（追蹤度加減）、技能的內容種類 ability 與三個技能做的行動。 */
const STUBS: Feature = {
  id: 'hack_net_stubs',
  install(k) {
    k.content.defineKind({ kind: 'ability', owner: 'hack_net_stubs', validate: () => [] })
    k.content.defineKind({ kind: 'district', owner: 'hack_net_stubs', validate: () => [] })
    k.effects.register<{ kind: string; key: string; amount: number }>({
      kind: 'hostility', owner: 'hack_net_stubs',
      validate: (e) => (typeof e.key === 'string' && Number.isSafeInteger(e.amount) ? [] : ['key 與 amount 要寫對']),
      toChanges: (e) => [{ op: 'counter', key: `host:${e.key}`, delta: e.amount }],
      describe: (e) => `敵對值 ${e.key} +${e.amount}`,
    })
    for (const [id, tags] of [['sk_zap', ['hack', 'hack:neural']], ['sk_plain', ['hack', 'hack:neural']], ['sk_other', ['skill']]] as const) {
      k.battle.action({
        id, owner: 'hack_net_stubs', name: id, desc: `${id}。`, group: 'skill', icon: 'hack', modes: ['meat', 'net'], tags: [...tags], target: 'foe',
        cost: () => ({ ap: 1 }),
        run(run, u, target) {
          run.effects([{ op: 'hack.check', class: 'neural', grade: 1, stop: true }, { op: 'load', amount: 3, type: 'neural' }], { user: u, target, source: { kind: 'ability', id, name: id }, pick: {}, n: {}, last: {} })
        },
      })
    }
  },
}
const NET_TRACE: Feature = {
  id: 'hack_net_trace_stub',
  install(k) {
    k.battle.effect('net.trace', 'hack_net_trace_stub', (ctx, e) => {
      const v = ctx.run.battle.field.trace
      if (typeof v !== 'number') return
      ctx.run.battle.field.trace = v + (e.amount as number)
      ctx.run.say(`追蹤度 +${e.amount as number}`, 'trace', { value: ctx.run.battle.field.trace })
    })
  },
}

// ---- 場地 ----

const raw = (u: unknown) => ({ from: 'unit', unit: u as Rec })
const RICH = { ap: { now: 40, max: 40, regen: 3 }, pools: { ram: { now: 60, max: 60, regen: 2 } } }
const deckOf = (o: Rec = {}) => ({ grade: 3, firewall: 12, slots: SLOTS, ...o })
const EXT = { deck: deckOf(), abilities: { equipped: [], tiers: { netrunner: 2 } } }
const hacker = (o: Rec = {}) => partyUnit(0, 1, { tags: ['quickhack'], attrs: { body: 10, reflex: 15, tech: 10, intellect: 14, resolve: 12, charm: 10 }, skills: { interface: 3 }, ...RICH, ext: EXT, ...o } as never)
const netHacker = (o: Rec = {}) => netAvatar(0, 1, { tags: ['netrunner', 'quickhack'], attrs: { body: 10, reflex: 15, tech: 10, intellect: 14, resolve: 12, charm: 10 }, skills: { interface: 3 }, ...RICH, ext: EXT, ...o } as never)
const still = (o: Rec = {}) => enemyUnit('minion', 1, { ap: { now: 0, max: 0, regen: 0 }, ...o } as never)

const meatSetup = (more: Partial<BattleSetup> = {}, allies: unknown[] = [hacker(), partyUnit(1, 1)], foes: unknown[] = [still(), still()]): BattleSetup => ({
  mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map(raw), foes: foes.map(raw), origin: { escapable: true, faction: 'corp' }, ...more,
}) as BattleSetup
const netSetup = (more: Partial<BattleSetup> = {}, allies: unknown[] = [netHacker()], foes: unknown[] = [laceUnit('minion', 1), laceUnit('minion', 1)]): BattleSetup => ({
  mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map(raw), foes: foes.map(raw), origin: { escapable: true }, ...more,
}) as BattleSetup

interface Arena {
  k: Kernel
  state: GameState
  battle: ReturnType<typeof setupBattle>['battle']
  run(dice?: number[]): BattleRun
}
const WIN = [20, ...Array(60).fill(1)]
const LOSE = [1, ...Array(60).fill(1)]

function arena(s: BattleSetup, features: Feature[] = [combatFeature, hackFeature, STUBS], more: { district?: string | null } = {}): Arena {
  const k = createKernel(features)
  // 沒有人定義的內容種類（沒裝 ability、district）就不載那一批
  k.content.loadPack({ ...PACK, content: Object.fromEntries(Object.entries(PACK.content).filter(([kind]) => k.content.hasKind(kind))) } as ContentPack)
  readyFeatures(k)
  const state = makeState()
  if (more.district === null) delete state.location.district
  else if (more.district) state.location.district = more.district
  const battle = clone(setupBattle(k, state, s).battle)
  state.battle = battle
  return { k, state, battle, run: (dice) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)) }
}

/** 輪到 who 用 action 打 target；dice 是這一次的骰面。 */
function use(a: Arena, who: string, action: string, target: string | null, dice: number[] = WIN): BattleRun {
  const run = a.run(dice)
  const u = run.unit(who)
  u.ap.now = Math.max(u.ap.now, 10)
  performAction(run, u, a.k.battle.getAction(action)!, target ? { unit: target } : null, { action })
  return run
}
const hostilityOf = (a: Arena, faction: string): { counter: number; lines: string[]; summary: string } => {
  a.battle.result = { outcome: 'win', text: '贏了。' } as never
  const end = endBattle(a.k, a.state)
  const after = clone(a.state)
  a.k.changes.applyAll(after, end.changes)
  return { counter: after.counters[`host:${faction}`] ?? 0, lines: end.narration?.results ?? [], summary: end.outcome.summary }
}

// ---- 一、內海 ----

describe('內海：快駭程式照用，追蹤度加程式的 trace（不論成敗）', () => {
  it('圓環上有裝著的程式（modes 有 net）；目標是敵方的蕾絲（算有橋）與敵方掛著的東西', () => {
    const a = arena(netSetup(), [combatFeature, hackFeature, STUBS, NET_TRACE])
    const run = a.run()
    const ids = a.k.battle.actionsFor('net').filter((d) => !d.has || d.has(run, run.unit('a1'))).map((d) => d.id)
    for (const p of SLOTS) expect(ids).toContain(`hack.${p}`)
    expect(a.k.battle.getAction('hack.p_fail')!.modes).toEqual(['meat', 'net'])
    const targets = a.k.battle.getAction('hack.p_stand')!.targets!(run, run.unit('a1'))
    expect(targets.map((t) => t.target)).toEqual([{ unit: 'f1' }, { unit: 'f2' }])
    expect(targets.every((t) => t.blocks.length === 0)).toBe(true)
  })

  it('行動點與 RAM 照程式自己的資料：一般類 1 點加 RAM 2；支援類 0 點', () => {
    const a = arena(netSetup(), [combatFeature, hackFeature, STUBS, NET_TRACE])
    const run = a.run()
    const u = run.unit('a1')
    expect(a.k.battle.getAction('hack.p_stand')!.cost(run, u)).toEqual({ ap: 1, ram: 2 })
    expect(a.k.battle.getAction('hack.p_mark')!.cost(run, u)).toEqual({ ap: 0, ram: 1 })
    const ap = u.ap.now
    const ram = u.pools.ram!.now
    use(a, 'a1', 'hack.p_stand', 'f1')
    expect(u.ap.now).toBe(Math.max(ap, 10) - 1)
    expect(u.pools.ram!.now).toBe(ram - 2)
  })

  it('成功用一次追蹤度 +trace；失敗也加；沒寫 trace（或寫 0）的程式不加', () => {
    const a = arena(netSetup(), [combatFeature, hackFeature, STUBS, NET_TRACE])
    a.battle.field.trace = 20
    use(a, 'a1', 'hack.p_stand', 'f1', WIN)
    expect(a.battle.field.trace).toBe(22)
    use(a, 'a1', 'hack.p_down', 'f1', LOSE)
    expect(a.battle.field.trace).toBe(26)
    use(a, 'a1', 'hack.p_none', 'f1', WIN)
    use(a, 'a1', 'hack.p_zero', 'f1', WIN)
    expect(a.battle.field.trace).toBe(26)
  })

  it('支援類（0 點行動點、不必檢定）也加；用在隊友或自己身上一樣加', () => {
    const a = arena(netSetup({}, [netHacker(), netAvatar(1, 1)]), [combatFeature, hackFeature, STUBS, NET_TRACE])
    a.battle.field.trace = 0
    use(a, 'a1', 'hack.p_mark', 'f1')
    expect(a.battle.field.trace).toBe(5)
    a.battle.units.a1!.uses = {}
    use(a, 'a1', 'hack.p_self', null)
    expect(a.battle.field.trace).toBe(10)
  })

  it('沒有 battle.field.trace 的場地：不變、不丟錯', () => {
    const a = arena(netSetup(), [combatFeature, hackFeature, STUBS, NET_TRACE])
    expect(a.battle.field.trace).toBeUndefined()
    use(a, 'a1', 'hack.p_stand', 'f1')
    expect(a.battle.field.trace).toBeUndefined()
  })

  it('沒有人註冊 net.trace：不加（追蹤度原封不動）、不丟錯', () => {
    const a = arena(netSetup())
    a.battle.field.trace = 20
    use(a, 'a1', 'hack.p_stand', 'f1')
    expect(a.battle.field.trace).toBe(20)
  })

  it('敵方（蕾絲的潛網者）用快駭不加我方的追蹤度', () => {
    const a = arena(netSetup({}, [netHacker({ ext: { ...EXT, deck: deckOf({ slots: [] }) } })], [laceUnit('elite', 1, { tags: ['lace', 'quickhack'], ext: { deck: deckOf() } } as never), laceUnit('minion', 1)]), [combatFeature, hackFeature, STUBS, NET_TRACE])
    a.battle.field.trace = 20
    const ram = a.battle.units.f1!.pools.ram!.now
    use(a, 'f1', 'hack.p_stand', 'a1')
    expect(a.battle.units.f1!.pools.ram!.now).toBe(ram - 2) // 真的跑了
    expect(a.battle.field.trace).toBe(20)
  })

  it('內海不記敵對值：結束時沒有敵對值的變更', () => {
    const a = arena(netSetup({ origin: { escapable: true, faction: 'corp' } } as never), [combatFeature, hackFeature, STUBS, NET_TRACE])
    a.battle.field.trace = 20
    use(a, 'a1', 'hack.p_fail', 'f1', LOSE)
    expect(hostilityOf(a, 'corp').counter).toBe(0)
  })

  it('用真的 netcombat：net.trace 加上去，紀錄有一拍 trace、帶新的值與做的人', () => {
    const a = arena(netSetup(), [combatFeature, deckFeature, netcombatFeature, hackFeature, STUBS])
    a.battle.field.trace = 20
    const run = use(a, 'a1', 'hack.p_stand', 'f1')
    expect(a.battle.field.trace).toBe(22)
    expect(run.beats.filter((b) => b.tag === 'trace').map((b) => b.data)).toEqual([expect.objectContaining({ value: 22, amount: 2, by: 'a1' })])
  })
})

// ---- 二、現實 ----

describe('現實：不加追蹤度；被發現時那個勢力的敵對值照 trace 加（E9）', () => {
  it('兩次失敗與成功打在最後還站著的、另一次成功打在最後被制伏的：加前兩次的 trace，第三次不算', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'hack.p_fail', 'f1', LOSE) // 失敗：當場算 1
    use(a, 'a1', 'hack.p_stand', 'f1', WIN) // 成功、f1 最後還站著：2
    use(a, 'a1', 'hack.p_down', 'f2', WIN) // 成功、f2 最後被制伏：不算
    a.battle.units.f2!.out = 'subdued'
    expect(a.battle.field.trace).toBeUndefined()
    const r = hostilityOf(a, 'corp')
    expect(r.counter).toBe(1 + 2)
  })

  it('成功打到的人最後倒下、逃走、被帶走都不算；還站著才算', () => {
    for (const [out, want] of [[undefined, 2], ['down', 0], ['fled', 0], ['subdued', 0], ['removed', 0]] as const) {
      const a = arena(meatSetup())
      use(a, 'a1', 'hack.p_stand', 'f1', WIN)
      if (out) a.battle.units.f1!.out = out
      expect(hostilityOf(a, 'corp').counter, String(out)).toBe(want)
    }
  })

  it('同一個人被成功駭了兩次：兩次的 trace 都算（還站著）；失敗的就算那個人後來倒下也照算', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'hack.p_stand', 'f1', WIN)
    use(a, 'a1', 'hack.p_stand', 'f1', WIN)
    use(a, 'a1', 'hack.p_down', 'f2', LOSE)
    a.battle.units.f2!.out = 'down'
    expect(hostilityOf(a, 'corp').counter).toBe(2 + 2 + 4)
  })

  it('對自己人用的支援類（隊友、自己）不算；支援類標記敵人、那人還站著就算', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'hack.p_vent', 'a2')
    a.battle.units.a1!.uses = {}
    use(a, 'a1', 'hack.p_self', null)
    expect(hostilityOf(a, 'corp').counter).toBe(0)
    const b = arena(meatSetup())
    use(b, 'a1', 'hack.p_mark', 'f1')
    expect(hostilityOf(b, 'corp').counter).toBe(5)
  })

  it('沒寫 trace（0）的程式什麼都不記；失敗也不給敵對值、報告沒有那一句', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'hack.p_none', 'f1', LOSE)
    use(a, 'a1', 'hack.p_zero', 'f1', WIN)
    const r = hostilityOf(a, 'corp')
    expect(r.counter).toBe(0)
    expect(r.lines.filter((l) => l.includes('認出'))).toEqual([])
  })

  it('結束的報告多一句給玩家看的話（寫出勢力的名字，不帶數字）', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'hack.p_down', 'f1', LOSE)
    const r = hostilityOf(a, 'corp')
    const line = r.lines.find((l) => l.includes('認出'))!
    expect(line).toContain('大企業')
    expect(line).not.toMatch(/\d/)
    expect(r.summary).toContain('認出')
  })

  it('勢力：origin.faction 沒寫就是所在那一區資料的第一個勢力', () => {
    const a = arena(meatSetup({ origin: { escapable: true } } as never), undefined, { district: 'test' })
    use(a, 'a1', 'hack.p_down', 'f1', LOSE)
    const r = hostilityOf(a, 'gang')
    expect(r.counter).toBe(4)
    expect(r.lines.find((l) => l.includes('認出'))).toContain('幫派')
  })

  it('找不到勢力（沒寫、區沒有勢力、查不到區、不在任何區、寫 none）：戰鬥照常結束、不給敵對值、不丟錯', () => {
    const cases: Array<[Partial<BattleSetup>, string | null | undefined]> = [
      [{ origin: { escapable: true } } as never, 'empty'],
      [{ origin: { escapable: true } } as never, 'nowhere'],
      [{ origin: { escapable: true } } as never, null],
      [{ origin: { escapable: true, faction: 'none' } } as never, 'test'],
    ]
    for (const [setup, district] of cases) {
      const a = arena(meatSetup(setup), undefined, { district })
      use(a, 'a1', 'hack.p_down', 'f1', LOSE)
      a.battle.result = { outcome: 'win', text: '贏了。' } as never
      const end = endBattle(a.k, a.state)
      expect(end.changes.some((c) => c.op === 'counter' && String((c as unknown as { key: string }).key).startsWith('host:'))).toBe(false)
      expect((end.narration?.results ?? []).some((l) => l.includes('認出'))).toBe(false)
    }
  })

  it('沒有人註冊 hostility：戰鬥照常結束、不丟錯、沒有那一句', () => {
    // 只有內容種類、沒有 hostility 效果的版本
    const PARTIAL: Feature = {
      id: 'hack_net_partial',
      install(k) {
        k.content.defineKind({ kind: 'ability', owner: 'hack_net_partial', validate: () => [] })
        k.content.defineKind({ kind: 'district', owner: 'hack_net_partial', validate: () => [] })
      },
    }
    const a = arena(meatSetup(), [combatFeature, hackFeature, PARTIAL])
    expect(a.k.effects.has('hostility')).toBe(false)
    use(a, 'a1', 'hack.p_down', 'f1', LOSE)
    a.battle.result = { outcome: 'win', text: '贏了。' } as never
    const end = endBattle(a.k, a.state)
    expect(end.outcome.result).toBe('win')
    expect((end.narration?.results ?? []).some((l) => l.includes('認出'))).toBe(false)
  })

  it('打輸的戰鬥也一樣結算；檢定失敗的敵對值照給', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'hack.p_down', 'f1', LOSE)
    a.battle.result = { outcome: 'lose', text: '輸了。' } as never
    const end = endBattle(a.k, a.state)
    const after = clone(a.state)
    a.k.changes.applyAll(after, end.changes)
    expect(after.counters['host:corp']).toBe(4)
  })

  it('敵方對我方用快駭（敵方潛網者）不記敵對值', () => {
    const a = arena(meatSetup({}, [hacker({ ext: { ...EXT, deck: deckOf({ slots: [] }) } }), partyUnit(1, 1)], [still({ tags: ['quickhack'], ext: { deck: deckOf() }, pools: RICH.pools }), still()]))
    use(a, 'f1', 'hack.p_down', 'a1', LOSE)
    use(a, 'f1', 'hack.p_stand', 'a2', WIN)
    expect(hostilityOf(a, 'corp').counter).toBe(0)
  })
})

// ---- 三、技能做的快駭 ----

describe('技能做的快駭（帶 hack 標籤的行動）：action.done 看標籤，trace 讀技能資料', () => {
  it('traceOfAction：自己的程式讀 quickhack、技能讀 ability 的 trace；沒寫是 0；不是正數也是 0', () => {
    const a = arena(meatSetup())
    expect(traceOfAction(a.k, 'hack.p_down')).toBe(4)
    expect(traceOfAction(a.k, 'sk_zap')).toBe(3)
    expect(traceOfAction(a.k, 'sk_plain')).toBe(0)
    expect(traceOfAction(a.k, 'hack.p_none')).toBe(0)
    expect(traceOfAction(a.k, 'nothing')).toBe(0)
  })

  it('現實：技能做的快駭失敗當場算、成功記在還站著的人身上；沒寫 trace 的和不帶 hack 標籤的不算', () => {
    const a = arena(meatSetup())
    use(a, 'a1', 'sk_zap', 'f1', LOSE) // 失敗：3
    use(a, 'a1', 'sk_zap', 'f1', WIN) // 成功、f1 還站著：3
    use(a, 'a1', 'sk_zap', 'f2', WIN) // 成功、f2 被制伏：不算
    use(a, 'a1', 'sk_plain', 'f1', LOSE) // 沒寫 trace
    use(a, 'a1', 'sk_other', 'f1', LOSE) // 不帶 hack 標籤
    a.battle.units.f2!.out = 'subdued'
    expect(hostilityOf(a, 'corp').counter).toBe(6)
  })

  it('內海：技能做的快駭追蹤度 +trace（不論成敗）；不帶 hack 標籤的不加', () => {
    const a = arena(netSetup(), [combatFeature, hackFeature, STUBS, NET_TRACE])
    a.battle.field.trace = 10
    use(a, 'a1', 'sk_zap', 'f1', WIN)
    use(a, 'a1', 'sk_zap', 'f1', LOSE)
    expect(a.battle.field.trace).toBe(16)
    use(a, 'a1', 'sk_other', 'f1', WIN)
    use(a, 'a1', 'sk_plain', 'f1', WIN)
    expect(a.battle.field.trace).toBe(16)
  })

  it('沒有人註冊 ability 這種內容：技能的 trace 是 0，不丟錯', () => {
    const a = arena(meatSetup(), [combatFeature, hackFeature])
    expect(a.k.content.hasKind('ability')).toBe(false)
    expect(traceOfAction(a.k, 'sk_zap')).toBe(0)
  })
})

// ---- 四、主控的樹階 ----

describe('treeTier：敵方潛網者先讀 ext.net.admin', () => {
  const unit = (o: Rec): BattleUnit => ({ tags: [], ext: {}, grade: 1, ...o }) as unknown as BattleUnit
  it('敵方單位 ext.net.admin 是 3、等級 5：3', () => {
    expect(treeTier(unit({ enemy: 'x', grade: 5, ext: { net: { admin: 3 } } }))).toBe(3)
  })
  it('沒有 admin：退回單位的等級；admin 不合理（0、不是數字）也退回；夾在 1～5', () => {
    expect(treeTier(unit({ enemy: 'x', grade: 4 }))).toBe(4)
    expect(treeTier(unit({ enemy: 'x', grade: 4, ext: { net: {} } }))).toBe(4)
    expect(treeTier(unit({ enemy: 'x', grade: 4, ext: { net: { admin: 0 } } }))).toBe(4)
    expect(treeTier(unit({ enemy: 'x', grade: 4, ext: { net: { admin: 'a' } } }))).toBe(4)
    expect(treeTier(unit({ enemy: 'x', grade: 4, ext: { net: { admin: 9 } } }))).toBe(5)
    expect(treeTier(unit({ enemy: 'x', grade: 9 }))).toBe(5)
  })
  it('不是敵人的單位不讀 admin（照舊讀技能樹，沒有就是 1）；有技能樹的照技能樹', () => {
    expect(treeTier(unit({ ext: { net: { admin: 4 } } }))).toBe(1)
    expect(treeTier(unit({ ext: { abilities: { tiers: { netrunner: 3 } } } }))).toBe(3)
    expect(treeTier(unit({ enemy: 'x', grade: 5, ext: { net: { admin: 4 }, abilities: { tiers: { netrunner: 2 } } } }))).toBe(2)
  })
  it('樹階決定能跑的等級：admin 3 的蕾絲潛網者甲板 IV 級跑 III 級', () => {
    const a = arena(netSetup({}, [netHacker()], [laceUnit('elite', 5, { tags: ['lace', 'quickhack'], ext: { deck: deckOf({ grade: 4 }), net: { admin: 3 } } } as never), laceUnit('minion', 1)]))
    const run = a.run()
    const f1 = run.unit('f1')
    f1.enemy = 'x'
    expect(treeTier(f1)).toBe(3)
  })
})

// ---- 五、資料 ----

describe('quickhack 的 trace 欄位', () => {
  it('0 以上的整數收下；負數、小數、字串不收', () => {
    const a = arena(meatSetup())
    const problems = (trace: unknown) => a.k.content.validate('quickhack', [prog('x', 'neural', { trace })])
    expect(problems(0)).toEqual([])
    expect(problems(5)).toEqual([])
    expect(problems(-1).join('')).toContain('trace')
    expect(problems(1.5).join('')).toContain('trace')
    expect(problems('3').join('')).toContain('trace')
  })
})
