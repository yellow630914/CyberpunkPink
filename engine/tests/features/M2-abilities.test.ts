// 驗收測試：dev/work/M2-abilities-m2.md（cpp-feature）。M1 第二波留到 M2 的技能機制：增援（call_in 與 bench 選項）、夥伴的技能（G4）、
// 偽裝與被識破、面具 masked、讀人、情報網與每件委託的次數、換配置的地點與時間（G1）、人情池讀衍生數值與 favor.spend、歷練點的效果 xp。
// 別的功能（名冊的候補、npc_known、scout_reveal、at_home、at_facility、委託副本、人情）用測試臨時註冊的替身；內容一律是測試自帶的假資料，不讀 engine/data。
// 規格：SKILL_TREES 掮客「增援」「情報網」、名媛「入戲」「偽裝」「讀人」「我演得很像吧」「入骨」；SKILLS 1.11、1.7；CORE_RULES 6.4、7.1；UI 8.3；
// dev/adr/0015 E2、E3、E4、E13；dev/adr/0016 第五節、G1、G4、G10。

import { describe, expect, it } from 'vitest'
import type { Actor, BattleInput, BattleSetup, BattleState, BattleTarget, BattleUnit, ContentPack, Effect, Feature, GameState, Kernel } from '../../src'
import { BattleBlocked, BattleRun, SEGMENT_HOURS, advance, checkParts, clone, createKernel, effectCtx, performAction, readyFeatures, setupBattle, targetWeight, toMinutes } from '../../src'
import { abilitiesFeature, abilitiesOf, applyLoadout, companionAbilities, equipAbilities, loadoutBlock, prep, prepBlock, stance, xpShares } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { favorsFeature } from '../../src/features/favors'
import { fixDice, makeActor, makeBattleGame, makeGame, makeState } from '../../src/testkit'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATS = [combatFeature, abilitiesFeature]

// ===================================================================================================================
// 假資料：兩棵樹（tree、other），技能的 tier 照 SKILL_TREES（xp 是 tier × 20）
// ===================================================================================================================

const tree = (id: string, signature: string) => ({ id, name: id, tree: `${id} 樹`, category: 'social', signature, domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] as Rec[] })
const ab = (id: string, kind: string, more: Rec = {}, path = 'tree'): Rec => {
  const tier = (more.tier as number | undefined) ?? 1
  return { id, name: id, path, category: 'social', tier, layer: 'front', kind, cap: 1, xp: tier * 20, cells: 1, after: path === 'tree' ? 'sk_root' : 'sk_other_root', text: `${id}。`, net: null, opinion: null, meat: null, ...more }
}

const ABILITIES: Rec[] = [
  ab('sk_root', 'passive', { layer: 'signature', after: undefined }),
  ab('sk_other_root', 'passive', { layer: 'signature', after: undefined }, 'other'),
  // 增援：叫名冊上一名有空的人進來；四格全滿時改做 fallback（照叫人的選項支援；這裡用一筆傷害代替）
  ab('sk_reinforce', 'active', {
    tier: 4, use: { ap: 2, per_fight: 1 },
    meat: { target: 'none', picks: [{ key: 'bench', label: '叫誰', kind: 'bench' }], do: [{ op: 'call_in', key: 'bench', fallback: [{ op: 'damage', who: 'foes', amount: 5, type: 'physical' }] }] },
  }),
  // 叫人（掮客的招牌，這裡放在另一個技能上）：用來驗「增援不算叫人的次數」
  ab('sk_call', 'passive', { meat: { call: { options: ['cover_up'], per_fight: 'half_tier_up', ap: 1 } } }),
  // 夥伴的技能：每棵樹各階一個，加一個 pending 的
  ab('sk_c1', 'passive', { meat: { mods: [{ kind: 'evade', value: 1 }] } }),
  ab('sk_c2', 'passive', { tier: 2, meat: { mods: [{ kind: 'evade', value: 1 }] } }),
  ab('sk_c2_pending', 'passive', { tier: 2, meat: { pending: true } }),
  ab('sk_c3', 'passive', { tier: 3, meat: { mods: [{ kind: 'evade', value: 1 }] } }),
  ab('sk_o1', 'passive', { meat: { mods: [{ kind: 'evade', value: 1 }] } }, 'other'),
  ab('sk_o2', 'passive', { tier: 2, meat: { mods: [{ kind: 'evade', value: 1 }] } }, 'other'),
  // 名媛：入戲（面具）、偽裝（姿態，戰鬥外也開得了）、我演得很像吧與入骨（戰鬥外的修正）、誘惑攻擊
  ab('sk_in_char', 'passive', { cap: 3, meat: { mask: { rounds: 1 } } }),
  ab('sk_disguise', 'stance', {
    tier: 2, use: { ap: 1 },
    meat: {
      mods: [{ kind: 'hit', value: 2, when: { first_round: true, first_attack: true, not_spotted: true } }],
      out: { check: { tags: ['infiltrate'], skill: 'perform', value: 2 }, on_start: [{ op: 'buff', who: 'self', id: 'disguise_start', name: '偽裝開場', turns: 2, until: 'own_turn_end', mods: [{ kind: 'evade', value: 1 }] }] },
    },
  }),
  ab('sk_good_actor', 'passive', { tier: 2, meat: { out_mods: [{ tags: ['infiltrate'], value: 2 }] } }),
  ab('sk_deep_in_role', 'passive', { tier: 4, meat: { out_mods: [{ tags: ['infiltrate'], value: 4 }] } }),
  ab('sk_tease', 'active', { use: { ap: 2 }, meat: { tease: {} } }),
  // 讀人（預備，要選一個人）：npc_known 一筆；帶進下一場：對他的誘惑攻擊命中 +2；戰鬥外對他的誘惑與交涉檢定 +2
  ab('sk_read', 'prep', {
    use: { slot: 1 },
    prep: {
      slot: 1, scope: 'next_battle', target: 'person',
      effects: [{ kind: 'npc_known', npc: '$target', fact: '$tendency' }],
      meat: { mods: [{ kind: 'tease_hit', value: 2 }] },
      out_mods: [{ skill: 'seduce', value: 2 }, { skill: 'negotiate', value: 2 }],
    },
  }),
  // 情報網（預備，每件委託 1 次）：scout_reveal 一筆；原本帶進第一場戰鬥的先攻 +3 照舊
  ab('sk_intel', 'prep', {
    tier: 3, use: { per_commission: 1 },
    prep: { slot: 0, scope: 'next_battle', effects: [{ kind: 'scout_reveal', job: '$commission' }], meat: { mods: [{ kind: 'initiative', value: 3, who: 'allies' }] } },
  }),
  // 每件委託 1 次的主動技能（驗「每件委託」的次數用真的委託 id）
  ab('sk_once', 'active', { use: { ap: 1, per_commission: 1 }, meat: { target: 'enemy', do: [{ op: 'damage', amount: 1, type: 'physical' }] } }),
  // 花一個小人情的技能（人情池）
  ab('sk_owe', 'active', { use: { ap: 1, favor: 'small' }, meat: { target: 'self', do: [{ op: 'heal', who: 'self', amount: 1 }] } }),
]
const PACK = {
  id: 'm2_abilities',
  content: { battle_status: TEST_STATUSES, path: [tree('tree', 'sk_root'), tree('other', 'sk_other_root')], ability: ABILITIES },
} as unknown as ContentPack
const ALL_IDS = ABILITIES.map((a) => a.id as string)

// ===================================================================================================================
// 替身（別的功能）
// ===================================================================================================================

const feature = (id: string, install: (k: Kernel) => void): Feature => ({ id, install })
/** 名冊的候補（k.battle.bench）。 */
const BENCH = (entries: Array<{ id: string; name: string; blocks?: string[] }>): Feature =>
  feature('bench_stub', (k) => k.battle.bench('bench_stub', (_s, _b, side) => (side === 'ally' ? entries.map((e) => ({ id: e.id, name: e.name, blocks: e.blocks ?? [], ref: { from: 'actor' as const, id: e.id } })) : [])))
/** npc_known：把他的一件事記進旗標 known:<人>。 */
const NPC_KNOWN = feature('npc_stub', (k) =>
  k.effects.register<Effect>({
    kind: 'npc_known', owner: 'npc_stub',
    validate: (raw) => (typeof raw.npc === 'string' && typeof raw.fact === 'string' ? [] : ['npc 與 fact 要是字串']),
    toChanges: (e) => [{ op: 'flag', key: `known:${String(e.npc)}`, value: String(e.fact) }],
    describe: (e) => `記下了：${String(e.npc)} ${String(e.fact)}`,
  }))
/** scout_reveal：記在計數器 reveal:<委託>；手上沒有那件委託（旗標 job:<id> 不是 true）時格式不合。 */
const SCOUT = feature('scout_stub', (k) =>
  k.effects.register<Effect>({
    kind: 'scout_reveal', owner: 'scout_stub',
    validate: (raw, ctx) => (typeof raw.job !== 'string' ? ['job 要是手上委託的 id'] : ctx.state.flags[`job:${raw.job}`] === true ? [] : [`手上沒有進行中的 ${raw.job} 這件委託`]),
    toChanges: (e) => [{ op: 'counter', key: `reveal:${String(e.job)}`, delta: 1 }],
    describe: (e) => `踩點：揭開了 ${String(e.job)} 的一項未知`,
  }))
/** at_home（旗標 home）、at_facility（旗標 fac 是設施的種類；寫了 types 就要在其中）。 */
const PLACES = feature('places_stub', (k) => {
  k.conditions.register({ kind: 'at_home', owner: 'places_stub', validate: () => [], test: (_c, { state }) => state.flags.home === true })
  k.conditions.register<{ kind: string; types?: string[] }>({
    kind: 'at_facility', owner: 'places_stub', validate: () => [],
    test: (c, { state }) => (typeof state.flags.fac === 'string' ? (c.types ? c.types.includes(state.flags.fac) : true) : false),
  })
})
/** 委託副本進行中的替身活動（旗標 in_commission）。 */
const COMMISSION = feature('commission_stub', (k) =>
  k.activity.define({ kind: 'commission', owner: 'commission_stub', order: 90, active: (s) => (s.flags.in_commission === true ? { id: 'cm', label: '委託副本' } : null), allow: [], reason: () => '委託副本進行中。' }))
/** 織女 標準：哪裡都能換配置（衍生數值 loadout_anywhere，旗標 weaver）。 */
const WEAVER = feature('weaver_stub', (k) => k.stats.addStatProvider('loadout_anywhere', 'weaver_stub', (state) => (state.flags.weaver === true ? [{ label: '織女 標準', value: 1 }] : [])))
/** 名冊（in_roster，旗標 roster 是名單）與同行（in_tagalong，旗標 tagalong 是名單）。 */
const ROSTER = feature('roster_stub', (k) => {
  const has = (flag: string, who: unknown, state: GameState): boolean => Array.isArray(state.flags[flag]) && (state.flags[flag] as unknown as string[]).includes(String(who))
  k.conditions.register<{ kind: string; who: string }>({ kind: 'in_roster', owner: 'roster_stub', validate: () => [], test: (c, { state }) => has('roster', c.who, state) })
  k.conditions.register<{ kind: string; who: string }>({ kind: 'in_tagalong', owner: 'roster_stub', validate: () => [], test: (c, { state }) => has('tagalong', c.who, state) })
})
/** 人情（欠你的小人情）：衍生數值 favor_small 讀計數器 fs；favor.spend 把它減一。 */
const FAVOR_STUB = feature('favor_stub', (k) => {
  k.stats.defineStat({ id: 'favor_small', owner: 'favor_stub', name: '小人情', base: (s, a) => (a === s.pc ? (s.counters.fs ?? 0) : 0) })
  k.changes.register<{ op: string }>({
    op: 'favor.spend', owner: 'favor_stub',
    validate: (s) => ((s.counters.fs ?? 0) >= 1 ? [] : ['沒有小人情可以用掉']),
    apply: (s) => { s.counters.fs = (s.counters.fs ?? 0) - 1 },
  })
})

// ===================================================================================================================
// 場地
// ===================================================================================================================

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
const idle = (o: Rec = {}): unknown => foe('minion', { weapon: 'pistol', ...quiet, ...o } as never)
const abilitiesExt = (equipped: string[], extra: Rec = {}): Rec => ({ abilities: { xp: 0, learned: [...ALL_IDS], equipped, spent: { tree: 400, other: 400 }, ...extra } })
/** 我：角色 pc，技能從狀態裡的角色讀（單位剛組好時照裝著的填）。 */
const me = (o: Rec = {}): unknown => one({ actor: 'pc', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 }, ...o } as never)
const mates = (): unknown[] => [one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)]

interface World {
  k: Kernel
  state: GameState
  battle: BattleState
  run(dice?: number[]): BattleRun
  ally(i: number): BattleUnit
  foe(i: number): BattleUnit
}
interface WorldOpts {
  features?: Feature[]
  actors?: Actor[]
  /** 主角身上 ext.abilities 的欄位與裝著的技能 */
  equipped?: string[]
  prepared?: Rec[]
  stance?: string
  pcExt?: Rec
  patch?: Partial<GameState>
}
/** 不經過提交的一場戰鬥（功能與內容都載好）；角色（含主角）在狀態裡，單位用 actor 指過去。 */
function build(setup: BattleSetup, o: WorldOpts = {}): World {
  const k = createKernel([...FEATS, ...(o.features ?? [])])
  k.content.loadPack(PACK)
  readyFeatures(k)
  const ext = { ...abilitiesExt(o.equipped ?? [], { ...(o.prepared ? { prepared: o.prepared } : {}), ...(o.stance ? { stance: o.stance } : {}) }), ...(o.pcExt ?? {}) }
  const state = makeState({ pc: { ext }, actors: o.actors, patch: o.patch })
  const battle = clone(setupBattle(k, state, setup).battle)
  return {
    k, state, battle,
    run: (dice) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)),
    ally: (i) => battle.units[`a${i}`]!,
    foe: (i) => battle.units[`f${i}`]!,
  }
}
const fight = (o: WorldOpts & { allies?: unknown[]; foes?: unknown[]; more?: Partial<BattleSetup> } = {}): World =>
  build(duel(o.allies ?? [me(), ...mates()], o.foes ?? [idle(), idle()], undefined, o.more), o)

/** 讓 a1（或指定的人）做一個行動：走和玩家一樣的路（performAction：花費與 action.done 都一樣）；條件、目標、選項照行動自己宣告的查。 */
function cast(a: World, action: string, target: BattleTarget | null, o: { pick?: Rec; user?: string; run?: BattleRun } = {}): BattleRun {
  const run = o.run ?? a.run(Array(80).fill(10))
  const def = a.k.battle.getAction(action)
  expect(def, action).toBeDefined()
  const performer = run.unit(o.user ?? 'a1')
  const input: BattleInput = { action, ...(target ? { target } : {}), ...(o.pick ? { pick: o.pick } : {}) }
  const why = [...(def!.blocks?.(run, performer) ?? []), ...(target ? ((def!.targets?.(run, performer) ?? []).find((t) => JSON.stringify(t.target) === JSON.stringify(target))?.blocks ?? ['這個目標不能選。']) : [])]
  if (why.length) throw new BattleBlocked(why)
  for (const p of def!.picks?.(run, performer) ?? []) {
    const chosen = p.options.find((x) => x.value === o.pick?.[p.key])
    if (chosen?.blocks.length) throw new BattleBlocked(chosen.blocks)
  }
  performAction(run, performer, def!, target, input)
  return run
}
const reasonOf = (f: () => unknown): string[] => {
  try {
    f()
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
  return []
}
const toRound = (a: World, n: number): void => {
  const r = a.run()
  for (let guard = 0; guard < 200 && a.battle.round < n && !r.over; guard++) advance(r)
}
const modTotal = (a: World, kind: string, id: string, tags: string[] = [], other?: string): number => {
  const run = a.run()
  return run.mods(kind as never, run.unit(id), other ? run.unit(other) : undefined, undefined, tags).filter((p) => p.source === 'skill').reduce((s, p) => s + p.value, 0)
}
/** 一局經過提交的遊戲（Game）當成 World 用（問修正）：戰鬥讀現在的。 */
const worldOf = (g: { k: Kernel; state: GameState }): World => ({
  k: g.k, state: g.state, get battle() { return g.state.battle! },
  run: (dice) => (dice ? fixDice(new BattleRun(g.k, g.state, g.state.battle!), dice) : new BattleRun(g.k, g.state, g.state.battle!)),
  ally: (i) => g.state.battle!.units[`a${i}`]!,
  foe: (i) => g.state.battle!.units[`f${i}`]!,
})
const options = (a: World, action: string, user = 'a1') => {
  const run = a.run()
  const def = a.k.battle.getAction(action)!
  const u = run.unit(user)
  return { blocks: def.blocks?.(run, u) ?? [], picks: def.picks?.(run, u) ?? [] }
}

// ===================================================================================================================
// 1. 增援
// ===================================================================================================================

describe('增援：call_in 叫 pick[bench] 選的候補；沒有空格改做 fallback；不算叫人的次數', () => {
  const buddy = makeActor({ id: 'buddy', name: '夥伴', role: 'npc', attrs: { charm: 20 } as never })
  const hurt = makeActor({ id: 'hurt', name: '傷患', role: 'npc' })
  const BENCHED = BENCH([{ id: 'buddy', name: '夥伴' }, { id: 'hurt', name: '傷患', blocks: ['傷患受傷了，叫不來。'] }])
  const world = (o: WorldOpts & { allies?: unknown[] } = {}) => fight({ equipped: ['sk_reinforce', 'sk_call'], features: [BENCHED], actors: [buddy, hurt], ...o })

  it('有空格：下一輪開頭他站上來，照他自己的資料（名字與屬性），由玩家操縱；叫來的當下還在後方', () => {
    const a = world()
    const run = cast(a, 'sk_reinforce', null, { pick: { bench: 'buddy' } })
    expect(a.battle.called).toHaveLength(1)
    const u = a.battle.units[a.battle.called![0]!]!
    expect([u.actor, u.name, u.side, u.slot, u.attrs.charm]).toEqual(['buddy', '夥伴', 'ally', 0, 20])
    expect(run.beats.some((b) => b.tag === 'call_in')).toBe(true)
    toRound(a, 2)
    expect(u.slot).toBe(4)
    expect(u.control).toBe('player')
    expect(a.battle.called).toBeUndefined()
    expect(a.battle.order).toContain(u.id)
  })

  it('兩種情況（叫進來、四格全滿改做 fallback）都不算叫人的次數：叫人自己的次數沒動、叫人的行動照樣可以用', () => {
    const a = world()
    cast(a, 'sk_reinforce', null, { pick: { bench: 'buddy' } })
    expect(a.ally(1).uses['sk_call.call']).toBeUndefined()
    expect(options(a, 'sk_call.call').blocks).toEqual([])

    const full = world({ allies: [me(), ...mates(), one({ weapon: 'pistol' }, 4)] })
    const hp = full.foe(1).hp!.now
    cast(full, 'sk_reinforce', null, { pick: { bench: 'buddy' } })
    expect(full.ally(1).uses['sk_call.call']).toBeUndefined()
    expect(options(full, 'sk_call.call').blocks).toEqual([])
    // 這一場的次數（每場 1）照樣記
    expect(options(full, 'sk_reinforce').blocks).toEqual(['這一場已經用過了。'])
    expect(full.foe(1).hp!.now).toBeLessThan(hp)
  })

  it('四格全滿：不叫人、改做 fallback（每個敵人吃一筆傷害）；候補沒有進場', () => {
    const a = world({ allies: [me(), ...mates(), one({ weapon: 'pistol' }, 4)] })
    const before = [a.foe(1).hp!.now, a.foe(2).hp!.now]
    const run = cast(a, 'sk_reinforce', null, { pick: { bench: 'buddy' } })
    expect(a.battle.called).toBeUndefined()
    expect(Object.values(a.battle.units).some((u) => u.actor === 'buddy')).toBe(false)
    expect([a.foe(1).hp!.now, a.foe(2).hp!.now].map((hp, i) => hp < before[i]!)).toEqual([true, true])
    expect(run.beats.some((b) => b.tag === 'skill' && b.data?.call_in === 'full')).toBe(true)
  })

  it('候補是空的：行動灰掉並寫原因；候補都叫不來也灰掉；有人叫得來就亮起來', () => {
    const none = fight({ equipped: ['sk_reinforce'], features: [BENCH([])] })
    expect(options(none, 'sk_reinforce').blocks).toEqual(['名冊上沒有可以叫來的人。'])
    const busy = fight({ equipped: ['sk_reinforce'], features: [BENCH([{ id: 'hurt', name: '傷患', blocks: ['傷患受傷了，叫不來。'] }])], actors: [hurt] })
    expect(options(busy, 'sk_reinforce').blocks.join('')).toMatch(/都叫不來/)
    const ok = world()
    expect(options(ok, 'sk_reinforce').blocks).toEqual([])
    // 沒有人登記候補（名冊沒裝）：同樣灰掉
    expect(options(fight({ equipped: ['sk_reinforce'] }), 'sk_reinforce').blocks).toEqual(['名冊上沒有可以叫來的人。'])
  })

  it('選項來自 view.bench：沒空的列著並帶原因；選叫不了的或不在名單上的被擋下，什麼都沒動', () => {
    const a = world()
    const pick = options(a, 'sk_reinforce').picks.find((p) => p.key === 'bench')!
    expect(pick).toMatchObject({ kind: 'choice', required: true })
    expect(pick.options).toEqual([{ value: 'buddy', label: '夥伴', blocks: [] }, { value: 'hurt', label: '傷患', blocks: ['傷患受傷了，叫不來。'] }])
    // 擋下的步在 Game 裡是整步不成立（不留任何變化）；這裡直接做在同一場上，所以每一種各開一場
    expect(reasonOf(() => cast(world(), 'sk_reinforce', null, { pick: { bench: 'hurt' } }))).toEqual(['傷患受傷了，叫不來。'])
    expect(reasonOf(() => cast(world(), 'sk_reinforce', null, { pick: { bench: 'nobody' } }))).toEqual(['叫誰：沒有這個選項。'])
    expect(reasonOf(() => cast(world(), 'sk_reinforce', null))).toEqual(['要選叫誰。'])
    expect(a.battle.called).toBeUndefined()
  })

  it('整步走 Game：選了之後提交，下一輪（結束這個回合之後）他站上來；沒選整步不成立', () => {
    const made = makeBattleGame({
      features: [...FEATS, BENCHED], content: [PACK], seed: 7, actors: [buddy, hurt], pc: { ext: abilitiesExt(['sk_reinforce']) },
      battle: duel([me(), ...mates()], [idle(), idle()]),
    }).game
    const b = made.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = 20
    b.units.a1!.control = 'player'
    const opt = made.battleOptions()!.actions.find((x) => x.id === 'sk_reinforce')!
    expect(opt.ok).toBe(true)
    expect(opt.picks[0]!.options.map((o) => o.value)).toEqual(['buddy', 'hurt'])
    expect(made.battleAct({ action: 'sk_reinforce', pick: { bench: 'hurt' } }).status).toBe('refused')
    expect(made.battleAct({ action: 'sk_reinforce' }).status).toBe('refused')
    expect(made.battleAct({ action: 'sk_reinforce', pick: { bench: 'buddy' } }).status).toBe('applied')
    expect(made.state.battle!.called).toHaveLength(1)
  })

  it('格式：bench 是合格的 pick；call_in 的 fallback 要是效果的陣列、不認得的欄位擋下', () => {
    const load = (meat: Rec) => () => makeGame({ features: FEATS, content: [{ id: 'bad', content: { battle_status: TEST_STATUSES, path: [tree('tree', 'sk_root')], ability: [ab('sk_root', 'passive', { layer: 'signature', after: undefined }), ab('sk_x', 'active', { use: { ap: 1 }, meat })] } } as unknown as ContentPack] })
    expect(load({ target: 'none', picks: [{ key: 'bench', label: '叫誰', kind: 'bench' }], do: [{ op: 'call_in', key: 'bench' }] })).not.toThrow()
    expect(load({ target: 'none', do: [{ op: 'call_in', fallback: [] }] })).toThrow(/fallback/)
    expect(load({ target: 'none', do: [{ op: 'call_in', fallback: [{ op: 'nothing' }] }] })).toThrow(/nothing/)
    expect(load({ target: 'none', do: [{ op: 'call_in', who: 'self', speed: 1 }] })).toThrow(/speed/)
  })
})

// ===================================================================================================================
// 2. 夥伴的技能（G4）
// ===================================================================================================================

describe('夥伴的技能（G4）：有 ext.paths、沒有自己的學習紀錄的角色，每條路數那棵樹、階數以內、不是 pending 的技能都算裝著', () => {
  const paths = [{ path: 'tree', slot: 'main', tier: 2 }, { path: 'other', slot: 'sub', tier: 1 }]
  const mate = (ext: Rec) => makeActor({ id: 'mate', name: '夥伴', role: 'companion', ext })
  const withMate = (ext: Rec) => fight({ actors: [mate(ext)], allies: [me(), one({ actor: 'mate', weapon: 'pistol' }, 2)] })

  it('上場時帶著那棵樹階數以內的技能（兩條路數各算各的）；pending 的、比階數高的沒有；樹階就是那一列的階數', () => {
    const a = withMate({ paths })
    const d = a.ally(2).ext.abilities as { equipped: string[]; tiers: Record<string, number> }
    const ids = new Set(d.equipped)
    for (const id of ['sk_root', 'sk_c1', 'sk_c2', 'sk_disguise', 'sk_good_actor', 'sk_other_root', 'sk_o1']) expect(ids.has(id), id).toBe(true)
    for (const id of ['sk_c2_pending', 'sk_c3', 'sk_o2', 'sk_reinforce', 'sk_deep_in_role']) expect(ids.has(id), id).toBe(false)
    expect(d.tiers).toEqual({ tree: 2, other: 1 })
    // 不看橋的容量：他沒有橋（容量 0）也一樣
    expect(a.state.actors.mate!.ext.bridge).toBeUndefined()
  })

  it('直接問：companionAbilities 給的清單與上面一樣；沒有 ext.paths、或有自己的學習紀錄的人不是夥伴（回傳 undefined）', () => {
    const a = withMate({ paths })
    expect(companionAbilities(a.k, a.state, 'mate')!.equipped).toEqual(expect.arrayContaining(['sk_root', 'sk_c1', 'sk_c2', 'sk_other_root', 'sk_o1']))
    expect(companionAbilities(a.k, a.state, 'pc')).toBeUndefined()
    const b = withMate({})
    expect(companionAbilities(b.k, b.state, 'mate')).toBeUndefined()
    expect((b.ally(2).ext.abilities as { equipped: string[] }).equipped).toEqual([])
    const own = withMate({ paths, abilities: { xp: 0, learned: ['sk_c1'], equipped: ['sk_c1'], spent: { tree: 0 } } })
    expect(companionAbilities(own.k, own.state, 'mate')).toBeUndefined()
    expect((own.ally(2).ext.abilities as { equipped: string[] }).equipped).toEqual(['sk_c1'])
  })

  it('壞掉的列略過、同一條路數取最高的階、階數夾在 1～5', () => {
    const a = withMate({ paths: [{ path: 'tree', tier: 1 }, { path: 'tree', tier: 3 }, { path: 'other' }, { tier: 2 }, 'x', { path: 'other', tier: 99 }] })
    const d = a.ally(2).ext.abilities as { equipped: string[]; tiers: Record<string, number> }
    expect(d.tiers).toEqual({ tree: 3, other: 5 })
    expect(d.equipped).toEqual(expect.arrayContaining(['sk_c3', 'sk_o2']))
  })

  it('裝著的被動真的生效（有效果的樹階以內的被動給修正）：夥伴的迴避多了 sk_c1 與 sk_c2 各 +1', () => {
    const a = withMate({ paths })
    expect(modTotal(a, 'evade', 'a2')).toBe(2 + 1)
    expect(modTotal(a, 'evade', 'a1')).toBe(0)
  })

  it('用叫來的方式上場（增援）也一樣：叫來的夥伴帶著自己的技能', () => {
    const a = fight({ actors: [mate({ paths })], features: [BENCH([{ id: 'mate', name: '夥伴' }])], equipped: ['sk_reinforce'] })
    cast(a, 'sk_reinforce', null, { pick: { bench: 'mate' } })
    const u = a.battle.units[a.battle.called![0]!]!
    expect((u.ext.abilities as { equipped: string[] }).equipped).toEqual(expect.arrayContaining(['sk_c1', 'sk_c2']))
  })
})

// ===================================================================================================================
// 3. 偽裝、被識破、入戲的面具
// ===================================================================================================================

describe('偽裝與被識破（戰鬥外開、帶進戰鬥）', () => {
  const game = (o: { equipped?: string[]; features?: Feature[]; patch?: Partial<GameState> } = {}) =>
    makeGame({
      features: [...FEATS, ...(o.features ?? [])], content: [PACK], patch: o.patch,
      pc: { ext: { bridge: { capacity: { meat: 20, net: 8, social: 20, media: 8 } }, ...abilitiesExt(o.equipped ?? ['sk_root', 'sk_disguise', 'sk_good_actor', 'sk_deep_in_role', 'sk_in_char']) } },
    }).game
  const perform = (g: ReturnType<typeof game>, tags: string[] = ['infiltrate'], skill = 'perform') => checkParts(g.k.stats, g.state, 'pc', { attr: 'charm', skill, tags })
  const part = (parts: Array<{ label: string; value: number }>, label: string) => parts.filter((p) => p.label === label).map((p) => p.value)

  it('戰鬥外開著偽裝：帶 infiltrate 標籤的表演檢定明細多一條 +2；沒帶標籤、別的基本功、關掉之後都沒有', () => {
    const g = game({ equipped: ['sk_root', 'sk_disguise'] })
    expect(part(perform(g), 'sk_disguise')).toEqual([])
    const on = stance(g.k, g.state, 'pc', 'sk_disguise')
    expect(on.action).toBe('ability.stance')
    expect(on.changes.some((c) => c.op === 'time')).toBe(false)
    g.commit(on)
    expect(abilitiesOf(g.state, 'pc').stance).toBe('sk_disguise')
    expect(part(perform(g), 'sk_disguise')).toEqual([2])
    expect(part(perform(g, []), 'sk_disguise')).toEqual([])
    expect(part(perform(g, ['infiltrate'], 'seduce'), 'sk_disguise')).toEqual([])
    // 再按一次就是關掉
    g.commit(stance(g.k, g.state, 'pc', 'sk_disguise'))
    expect(abilitiesOf(g.state, 'pc').stance).toBeUndefined()
    expect(part(perform(g), 'sk_disguise')).toEqual([])
  })

  it('不能開的：沒裝著、不是姿態、沒有 meat.out（只能在戰鬥裡開）、戰鬥中', () => {
    const g = game({ equipped: ['sk_root'] })
    expect(() => stance(g.k, g.state, 'pc', 'sk_disguise')).toThrow('要先裝上sk_disguise。')
    expect(() => stance(g.k, g.state, 'pc', 'sk_call')).toThrow('sk_call不是姿態。')
    expect(() => stance(g.k, g.state, 'pc', 'nobody')).toThrow('沒有這個技能。')
    const h = makeGame({
      features: FEATS, content: [{ id: 'p', content: { battle_status: TEST_STATUSES, path: [tree('tree', 'sk_root')], ability: [ab('sk_root', 'passive', { layer: 'signature', after: undefined }), ab('sk_pose', 'stance', { use: { ap: 1 }, meat: { mods: [{ kind: 'evade', value: 1 }] } })] } } as unknown as ContentPack],
      pc: { ext: { abilities: { xp: 0, learned: ['sk_root', 'sk_pose'], equipped: ['sk_pose'], spent: {} } } },
    }).game
    expect(() => stance(h.k, h.state, 'pc', 'sk_pose')).toThrow('sk_pose只能在戰鬥裡開。')
    // 戰鬥中用戰鬥裡的行動開關
    const fighting = makeBattleGame({ features: FEATS, content: [PACK], pc: { ext: abilitiesExt(['sk_disguise']) }, battle: duel([me(), ...mates()], [idle()]) }).game
    expect(() => stance(fighting.k, fighting.state, 'pc', 'sk_disguise')).toThrow('戰鬥中的姿態用戰鬥裡的行動開關。')
  })

  it('我演得很像吧、入骨是被動的戰鬥外修正：infiltrate +2、+4（裝著才有；兩個都裝就都在明細裡）', () => {
    const g = game({ equipped: ['sk_root', 'sk_good_actor'] })
    expect(part(perform(g), 'sk_good_actor')).toEqual([2])
    expect(part(perform(g), 'sk_deep_in_role')).toEqual([])
    const both = game({ equipped: ['sk_good_actor', 'sk_deep_in_role'] })
    expect([part(perform(both), 'sk_good_actor'), part(perform(both), 'sk_deep_in_role')]).toEqual([[2], [4]])
    const none = game({ equipped: [] })
    expect(perform(none).map((p) => p.label)).not.toContain('sk_good_actor')
    // 戰鬥裡不問（戰鬥內的檢定由戰鬥的修正管）
    const fighting = makeBattleGame({ features: FEATS, content: [PACK], pc: { ext: abilitiesExt(['sk_good_actor']) }, battle: duel([me(), ...mates()], [idle()]) }).game
    expect(part(checkParts(fighting.k.stats, fighting.state, 'pc', { attr: 'charm', skill: 'perform', tags: ['infiltrate'] }), 'sk_good_actor')).toEqual([])
  })

  it('開打還開著、沒被識破：第一回合的第一次攻擊命中 +2，第二次沒有；開打時 meat.out.on_start 做一次；戰鬥外開著的姿態帶進單位', () => {
    const a = fight({ equipped: ['sk_disguise'], stance: 'sk_disguise' })
    expect(a.ally(1).stance).toBe('sk_disguise')
    // 開打時 meat.out.on_start 做過了（帶進來的記號用掉就拿掉）
    expect((a.ally(1).ext.abilities as { buffs?: Array<{ id: string }>; carried?: string }).buffs?.map((b) => b.id)).toEqual(['disguise_start'])
    expect((a.ally(1).ext.abilities as { carried?: string }).carried).toBeUndefined()
    expect(modTotal(a, 'hit', 'a1')).toBe(2)
    a.run(Array(40).fill(12)).attack(a.ally(1), a.foe(1))
    expect(modTotal(a, 'hit', 'a1')).toBe(0)
    // 沒開姿態的人沒有；開著但已經沒裝著（換配置卸掉了）也沒有
    const off = fight({ equipped: ['sk_disguise'] })
    expect(off.ally(1).stance).toBeUndefined()
    expect(modTotal(off, 'hit', 'a1')).toBe(0)
    const gone = fight({ equipped: [], stance: 'sk_disguise' })
    expect(gone.ally(1).stance).toBeUndefined()
    // 戰鬥中自己開（1 點）照舊有效
    const inFight = fight({ equipped: ['sk_disguise'] })
    cast(inFight, 'sk_disguise', null)
    expect(inFight.ally(1).stance).toBe('sk_disguise')
    expect(modTotal(inFight, 'hit', 'a1')).toBe(2)
  })

  it('開打時 meat.out.on_start 做一次（battle.start）：偽裝開場的 buff 掛在她身上', () => {
    const made = makeBattleGame({
      features: FEATS, content: [PACK], pc: { ext: abilitiesExt(['sk_disguise'], { stance: 'sk_disguise' }) },
      battle: duel([me(), ...mates()], [idle(), idle()]),
    }).game
    const u = made.state.battle!.units.a1!
    expect(u.stance).toBe('sk_disguise')
    expect((u.ext.abilities as { buffs?: Array<{ id: string }> }).buffs?.map((b) => b.id)).toEqual(['disguise_start'])
    expect((u.ext.abilities as { carried?: string }).carried).toBeUndefined()
  })

  it('被識破（origin.ext.pre.spotted 是 true）：偽裝的第一次攻擊 +2 這一場沒有，但還是開著；spotted 不是 true（沒寫、false）都照常', () => {
    const spotted = fight({ equipped: ['sk_disguise'], stance: 'sk_disguise', more: { origin: { ext: { pre: { spotted: true } } } } })
    expect(spotted.ally(1).stance).toBe('sk_disguise')
    expect(modTotal(spotted, 'hit', 'a1')).toBe(0)
    for (const pre of [{ spotted: false }, {}, { disguise: 'staff' }]) {
      const a = fight({ equipped: ['sk_disguise'], stance: 'sk_disguise', more: { origin: { ext: { pre } } } })
      expect(modTotal(a, 'hit', 'a1'), JSON.stringify(pre)).toBe(2)
    }
    // 這一場被識破不影響下一場（記在開戰設定上，不記在角色身上）
    expect(abilitiesOf(spotted.state, 'pc').stance).toBe('sk_disguise')
  })

  it('入戲的「第一回合不被當成目標」：被識破的這一場不生效；第二回合本來就沒有', () => {
    const w = (pre?: Rec) => fight({ equipped: ['sk_in_char'], ...(pre ? { more: { origin: { ext: { pre } } } } : {}) })
    const weight = (a: World, target = 'a1') => targetWeight(a.run(), a.battle.units.f1!, a.battle.units[target]!)
    expect(weight(w())).toBe(0)
    expect(weight(w({ spotted: true }))).toBeGreaterThan(0)
    expect(weight(w({ spotted: false }))).toBe(0)
    const late = w()
    late.battle.round = 2
    expect(weight(late)).toBeGreaterThan(0)
  })

  it('讀人以外的鍵不影響：not_spotted 寫在 mods 的 when 之外會被格式檢查擋下（只有 mods 的 when 用）', () => {
    const load = (meat: Rec, kind = 'active') => () => makeGame({ features: FEATS, content: [{ id: 'bad', content: { battle_status: TEST_STATUSES, path: [tree('tree', 'sk_root')], ability: [ab('sk_root', 'passive', { layer: 'signature', after: undefined }), ab('sk_x', kind, { use: { ap: 1 }, meat })] } } as unknown as ContentPack] })
    expect(load({ target: 'enemy', when: { not_spotted: true }, do: [{ op: 'damage', amount: 1, type: 'physical' }] })).toThrow(/not_spotted/)
    expect(load({ out: { check: { tags: ['infiltrate'], value: 2 } } }, 'active')).toThrow(/meat\.out/)
    expect(load({ out: { check: { value: 2 } } }, 'stance')).toThrow(/tags 與 skill 至少要寫一個/)
    expect(load({ out_mods: [{ tags: ['infiltrate'], value: 2 }] }, 'active')).toThrow(/meat\.out_mods/)
    expect(load({ out_mods: [{ tags: ['infiltrate'], value: 0 }] }, 'passive')).toThrow(/value/)
    expect(load({ out_mods: [{ tags: ['infiltrate'], value: 2 }] }, 'passive')).not.toThrow()
  })
})

describe('面具與豔名：裝著入戲，身上掛著 masked；卸下來就拿掉（裝卸的報告帶那一筆變更）', () => {
  const game = (extra: Rec = {}, patch?: Partial<GameState>) =>
    makeGame({
      features: FEATS, content: [PACK], patch,
      pc: { ext: { bridge: { capacity: { meat: 20, net: 8, social: 20, media: 8 } }, ...abilitiesExt([], extra) } },
    }).game
  const masked = (g: ReturnType<typeof game>): boolean => g.state.actors.pc!.conditions.some((c) => c.id === 'masked')

  it('逐一裝卸（equipAbilities）：裝上有，卸下沒有；報告裡帶 actor.condition', () => {
    const g = game()
    const on = equipAbilities(g.k, g.state, 'pc', ['sk_in_char', 'sk_c1'])
    expect(on.changes).toContainEqual({ op: 'actor.condition', id: 'pc', condition: 'masked' })
    g.commit(on)
    expect(masked(g)).toBe(true)
    // 換成別的組合（還有面具）：不重複加
    const same = equipAbilities(g.k, g.state, 'pc', ['sk_in_char'])
    expect(same.changes.filter((c) => c.op === 'actor.condition')).toEqual([])
    g.commit(same)
    const off = equipAbilities(g.k, g.state, 'pc', ['sk_c1'])
    expect(off.changes).toContainEqual({ op: 'actor.condition', id: 'pc', condition: 'masked', remove: true })
    g.commit(off)
    expect(masked(g)).toBe(false)
  })

  it('一次換成一整組（applyLoadout）也一樣', () => {
    const g = game()
    g.commit(applyLoadout(g.k, g.state, 'pc', ['sk_in_char']))
    expect(masked(g)).toBe(true)
    g.commit(applyLoadout(g.k, g.state, 'pc', []))
    expect(masked(g)).toBe(false)
  })

  it('沒有帶面具的技能的人，卸下別的東西不會動他身上別的來源的 masked；沒有 masked 也不會出現 remove', () => {
    const g = game({}, undefined)
    g.state.actors.pc!.conditions.push({ id: 'masked' })
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_c1']))
    expect(masked(g)).toBe(true)
    const h = game()
    expect(equipAbilities(h.k, h.state, 'pc', ['sk_c1']).changes.filter((c) => c.op === 'actor.condition')).toEqual([])
  })

  it('豔名「被認出來」（lewd 的檢定修正）看 masked：戴著面具的人不吃那一條（對照：這裡只確定 masked 掛得上、拿得掉）', () => {
    const g = game()
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_in_char']))
    expect(g.state.actors.pc!.conditions).toEqual([{ id: 'masked' }])
  })
})

// ===================================================================================================================
// 4. 讀人
// ===================================================================================================================

describe('讀人：預備時選一個人，npc_known 收到他；帶進下一場：對他的誘惑攻擊命中 +2；戰鬥外對他的誘惑與交涉檢定 +2', () => {
  const npc1 = makeActor({ id: 'npc1', name: '路人甲', role: 'npc', ext: { tendency: { axes: {}, tags: { zz_lace: 'latent', t_costume: 'has', a_gaze: 'deep' } } } })
  const npc2 = makeActor({ id: 'npc2', name: '路人乙', role: 'npc' })
  const game = () =>
    makeGame({
      features: [...FEATS, NPC_KNOWN], content: [PACK], actors: [npc1, npc2],
      pc: { ext: { bridge: { capacity: { meat: 20, net: 8, social: 20, media: 8 } }, ...abilitiesExt(['sk_read']) } },
    }).game
  const parts = (g: ReturnType<typeof game>, skill: string, target?: string) => checkParts(g.k.stats, g.state, 'pc', { attr: 'charm', skill, tags: [], ...(target ? { target } : {}) })

  it('預備花一個時段；npc_known 的替身收到那個人與他傾向裡的一個標籤（有／深的優先於潛在的）；預備記著選的人', () => {
    const g = game()
    const t0 = toMinutes(g.state.time)
    const r = prep(g.k, g.state, 'pc', 'sk_read', { target: 'npc1' })
    expect(r.action).toBe('ability.prep')
    expect(r.changes).toContainEqual({ op: 'time', minutes: SEGMENT_HOURS * 60 })
    g.commit(r)
    expect(toMinutes(g.state.time)).toBe(t0 + SEGMENT_HOURS * 60)
    expect(['tendency:t_costume', 'tendency:a_gaze']).toContain(g.state.flags['known:npc1'])
    expect(r.narration?.results?.[0]).toMatch(/路人甲|npc1/)
    expect(abilitiesOf(g.state, 'pc').prepared).toEqual([{ id: 'sk_read', scope: 'next_battle', target: 'npc1' }])
  })

  it('讀不到傾向的人：記 tendency:none；沒有選人、選自己被擋下並有原因', () => {
    const g = game()
    g.commit(prep(g.k, g.state, 'pc', 'sk_read', { target: 'npc2' }))
    expect(g.state.flags['known:npc2']).toBe('tendency:none')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_read')).toBe('sk_read要先選一個人。')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_read', { target: '' })).toBe('sk_read要先選一個人。')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_read', { target: 'pc' })).toBe('sk_read要選別人，不能選自己。')
    expect(() => prep(g.k, g.state, 'pc', 'sk_read')).toThrow('要先選一個人')
  })

  it('沒有人註冊 npc_known（npcs 沒裝）：效果那一筆略過，預備照樣成立', () => {
    const g = makeGame({ features: FEATS, content: [PACK], actors: [npc1], pc: { ext: abilitiesExt(['sk_read']) } }).game
    const r = prep(g.k, g.state, 'pc', 'sk_read', { target: 'npc1' })
    expect(r.changes.map((c) => c.op)).toEqual(['time', 'actor.ext'])
    g.commit(r)
    expect(abilitiesOf(g.state, 'pc').prepared?.[0]?.target).toBe('npc1')
  })

  it('下一場：對他（單位的角色，或 ext.npc 對得上）的誘惑攻擊命中 +2，對別人沒有；別的修正種類不受影響', () => {
    const prepared = [{ id: 'sk_read', scope: 'next_battle', target: 'npc1' }]
    const viaExt = fight({ equipped: ['sk_tease'], prepared, actors: [npc1], foes: [idle({ ext: { npc: 'npc1' } }), idle({ ext: { npc: 'npc2' } })] })
    expect(modTotal(viaExt, 'tease_hit', 'a1', ['tease'], 'f1')).toBe(2)
    expect(modTotal(viaExt, 'tease_hit', 'a1', ['tease'], 'f2')).toBe(0)
    expect(modTotal(viaExt, 'hit', 'a1', [], 'f1')).toBe(0)
    const viaActor = fight({ equipped: ['sk_tease'], prepared, actors: [npc1, npc2], foes: [idle({ actor: 'npc2' }), idle({ actor: 'npc1' })] })
    expect(modTotal(viaActor, 'tease_hit', 'a1', ['tease'], 'f2')).toBe(2)
    expect(modTotal(viaActor, 'tease_hit', 'a1', ['tease'], 'f1')).toBe(0)
    // 沒有選人（問修正時沒有對手）：沒有
    expect(modTotal(viaExt, 'tease_hit', 'a1', ['tease'])).toBe(0)
  })

  it('真的做一次誘惑攻擊：檢定的明細對他有「sk_read」+2，對別人沒有', () => {
    const prepared = [{ id: 'sk_read', scope: 'next_battle', target: 'npc1' }]
    const a = fight({ equipped: ['sk_tease'], prepared, actors: [npc1], foes: [idle({ ext: { npc: 'npc1' } }), idle({ ext: { npc: 'npc2' } })] })
    const labelsOf = (run: BattleRun): string[] => run.beats.flatMap((b) => b.roll?.parts.filter((p) => p.label === 'sk_read').map((p) => `${p.label}${p.value}`) ?? [])
    expect(labelsOf(cast(a, 'sk_tease', { unit: 'f1' }))).toEqual(['sk_read2'])
    const b = fight({ equipped: ['sk_tease'], prepared, actors: [npc1], foes: [idle({ ext: { npc: 'npc1' } }), idle({ ext: { npc: 'npc2' } })] })
    expect(labelsOf(cast(b, 'sk_tease', { unit: 'f2' }))).toEqual([])
  })

  it('戰鬥外：對他的誘惑與交涉檢定 +2（別的基本功、別的人沒有）；這一場打完、預備用掉之後也沒有了', async () => {
    const g = game()
    g.commit(prep(g.k, g.state, 'pc', 'sk_read', { target: 'npc1' }))
    expect([parts(g, 'seduce', 'npc1'), parts(g, 'negotiate', 'npc1')].map((p) => p.filter((x) => x.label === 'sk_read').map((x) => x.value))).toEqual([[2], [2]])
    expect(parts(g, 'seduce', 'npc2').filter((x) => x.label === 'sk_read')).toEqual([])
    expect(parts(g, 'firearms', 'npc1').filter((x) => x.label === 'sk_read')).toEqual([])
    expect(parts(g, 'seduce').filter((x) => x.label === 'sk_read')).toEqual([])
    // 預備用掉：帶進一場現實戰鬥（對他的誘惑攻擊 +2）、打完之後預備清掉，戰鬥外也沒有了
    g.startBattle(duel([me(), ...mates()], [idle({ ext: { npc: 'npc1' } })]))
    expect(modTotal(worldOf(g), 'tease_hit', 'a1', ['tease'], 'f1')).toBe(2)
    // 戰鬥裡不問戰鬥外的修正
    expect(parts(g, 'seduce', 'npc1').filter((x) => x.label === 'sk_read')).toEqual([])
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    await g.finishBattle()
    expect(abilitiesOf(g.state, 'pc').prepared).toBeUndefined()
    expect(parts(g, 'seduce', 'npc1').filter((x) => x.label === 'sk_read')).toEqual([])
  })
})

// ===================================================================================================================
// 5. 情報網與每件委託的次數
// ===================================================================================================================

describe('情報網：prep.effects 給一筆 scout_reveal；每件委託 1 次（照輸入的 commission 記）；原本帶進第一場戰鬥的效果照舊', () => {
  const game = (features: Feature[] = [SCOUT], flags: Rec = { 'job:c1': true, 'job:c2': true }, equipped = ['sk_intel']) =>
    makeGame({
      features: [...FEATS, ...features], content: [PACK], patch: { flags: flags as never },
      pc: { ext: { bridge: { capacity: { meat: 20, net: 8, social: 20, media: 8 } }, ...abilitiesExt(equipped) } },
    }).game

  it('不花時段也不擲骰：scout_reveal 的替身收到那件委託；次數記在角色身上；預備記下來', () => {
    const g = game()
    const t0 = toMinutes(g.state.time)
    const r = prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' })
    expect(r.changes.some((c) => c.op === 'time')).toBe(false)
    expect(r.changes).toContainEqual({ op: 'counter', key: 'reveal:c1', delta: 1 })
    g.commit(r)
    expect(toMinutes(g.state.time)).toBe(t0)
    expect(g.state.counters['reveal:c1']).toBe(1)
    expect(abilitiesOf(g.state, 'pc')).toMatchObject({ commission: { c1: { sk_intel: 1 } }, prepared: [{ id: 'sk_intel', scope: 'next_battle' }] })
  })

  it('同一件委託第二次被擋（有原因）；另一件可以；沒給委託被擋（有原因）', () => {
    const g = game()
    g.commit(prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' }))
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' })).toBe('這件委託的次數用完了（每件委託 1 次）。')
    expect(() => prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' })).toThrow('這件委託的次數用完了')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel', { commission: 'c2' })).toBeNull()
    g.commit(prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c2' }))
    expect(g.state.counters['reveal:c1']).toBe(1)
    expect(g.state.counters['reveal:c2']).toBe(1)
    expect(abilitiesOf(g.state, 'pc').commission).toEqual({ c1: { sk_intel: 1 }, c2: { sk_intel: 1 } })
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel')).toBe('sk_intel每件委託只能用 1 次，要先指定是哪一件委託。')
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel', { commission: '' })).toMatch(/指定是哪一件委託/)
  })

  it('scout_reveal 自己的格式不合（手上沒有那件委託）：整個預備被擋，原因就是它的訊息，次數沒動', () => {
    const g = game([SCOUT], {})
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel', { commission: 'ghost' })).toBe('手上沒有進行中的 ghost 這件委託')
    expect(() => prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'ghost' })).toThrow('手上沒有進行中的 ghost 這件委託')
    expect(abilitiesOf(g.state, 'pc').commission).toBeUndefined()
  })

  it('沒有人註冊 scout_reveal（fixer 沒裝）：略過那一筆，預備與次數照常', () => {
    const g = game([])
    const r = prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' })
    expect(r.changes.map((c) => c.op)).toEqual(['actor.ext'])
    g.commit(r)
    expect(abilitiesOf(g.state, 'pc').commission).toEqual({ c1: { sk_intel: 1 } })
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' })).toBe('這件委託的次數用完了（每件委託 1 次）。')
  })

  it('原本帶進第一場戰鬥的效果照舊：全隊先攻 +3；打完之後預備用掉（不影響每件委託的次數）', async () => {
    const g = game()
    g.commit(prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' }))
    g.startBattle(duel([me(), ...mates()], [idle(), idle()], undefined, { origin: { ext: { by: 'commission', ref: 'c1', commission: 'c1', stage: 1, face: 'meat' } } }))
    const w = worldOf(g)
    expect(modTotal(w, 'initiative', 'a1')).toBe(3)
    expect(modTotal(w, 'initiative', 'a2')).toBe(3)
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    await g.finishBattle()
    expect(abilitiesOf(g.state, 'pc').prepared).toBeUndefined()
    expect(abilitiesOf(g.state, 'pc').commission).toEqual({ c1: { sk_intel: 1 } })
  })

  it('每件委託的次數用真的委託 id（origin.ext.commission，委託副本開戰的設定）：戰鬥裡的次數與預備的次數記在同一個鍵下；換一件又可以', async () => {
    const g = game([SCOUT], { 'job:c1': true }, ['sk_intel', 'sk_once'])
    // 委託副本開戰的設定：Launch 的 origin（by 是 commission、ref 與 ext.commission 是委託的 id；features/commission/run.ts）進戰鬥之後，那幾個鍵都在 origin.ext 裡
    const origin = (id: string) => ({ ext: { by: 'commission', ref: id, commission: id, stage: 1, face: 'meat' } })
    const finish = async () => {
      g.state.battle!.result = { outcome: 'win', text: '測試用。' }
      await g.finishBattle()
    }
    g.commit(prep(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' }))
    g.startBattle(duel([me()], [idle()], undefined, { origin: origin('c1') }))
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = 20
    b.units.a1!.control = 'player'
    expect(g.battleAct({ action: 'sk_once', target: { unit: 'f1' } }).status).toBe('applied')
    b.units.a1!.ap.now = 20
    expect(g.battleOptions()!.actions.find((x) => x.id === 'sk_once')!.blocks).toEqual(['這件委託的次數用完了（每件委託 1 次）。'])
    await finish()
    // 戰鬥裡的次數與預備的次數記在同一個鍵（c1）下
    expect(abilitiesOf(g.state, 'pc').commission).toEqual({ c1: { sk_intel: 1, sk_once: 1 } })
    // 同一件委託的下一場：一開打就用不了；換一件委託就可以
    g.startBattle(duel([me()], [idle()], undefined, { origin: origin('c1') }))
    expect(g.state.battle!.units.a1!.uses['commission:sk_once']).toBe(1)
    await finish()
    g.startBattle(duel([me()], [idle()], undefined, { origin: origin('c2') }))
    expect(g.state.battle!.units.a1!.uses['commission:sk_once']).toBeUndefined()
    await finish()
    // 預備的次數也是同一份：c1 的情報網用過了
    expect(prepBlock(g.k, g.state, 'pc', 'sk_intel', { commission: 'c1' })).toBe('這件委託的次數用完了（每件委託 1 次）。')
  })
})

// ===================================================================================================================
// 6. 換配置
// ===================================================================================================================

describe('換配置（G1）：一整組一次換、時間 +30 分鐘；在住處或調校診所；委託副本裡不能換；織女 標準哪裡都能換（副本以外）', () => {
  const game = (features: Feature[] = [], flags: Rec = {}, rules?: Rec) =>
    makeGame({
      features: [...FEATS, ...features],
      content: [rules ? ({ id: 'rules', content: { ability_rule: [{ id: 'default', ...rules }] } } as unknown as ContentPack) : { id: 'none', content: {} } as unknown as ContentPack, PACK],
      patch: { flags: flags as never },
      pc: { ext: { bridge: { capacity: { meat: 20, net: 8, social: 20, media: 8 } }, ...abilitiesExt([]) } },
    }).game

  it('時間 +30 分鐘（衍生數值 loadout_minutes）；報告 ability.loadout、一次換成整組；裝著的更新', () => {
    const g = game()
    expect(g.k.stats.stat(g.state, 'pc', 'loadout_minutes')).toBe(30)
    const t0 = toMinutes(g.state.time)
    const r = applyLoadout(g.k, g.state, 'pc', ['sk_root', 'sk_c1', 'sk_c1'])
    expect(r.action).toBe('ability.loadout')
    expect(r.changes).toContainEqual({ op: 'time', minutes: 30 })
    g.commit(r)
    expect(toMinutes(g.state.time)).toBe(t0 + 30)
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['sk_root', 'sk_c1'])
    // 逐一裝卸的入口（equipAbilities）不另外花時間：時間在套用那一次
    const e = equipAbilities(g.k, g.state, 'pc', ['sk_root'])
    expect(e.action).toBe('ability.equip')
    expect(e.changes.some((c) => c.op === 'time')).toBe(false)
  })

  it('規則的內容種類 ability_rule 蓋掉 30 分鐘；沒有學的、裝不下的、和現在一樣的都被擋下', () => {
    const g = game([], {}, { loadout_minutes: 60 })
    expect(applyLoadout(g.k, g.state, 'pc', ['sk_root']).changes).toContainEqual({ op: 'time', minutes: 60 })
    const h = game()
    expect(() => applyLoadout(h.k, h.state, 'pc', ['sk_nobody'])).toThrow(/還沒學會/)
    expect(() => applyLoadout(h.k, h.state, 'pc', ['sk_root', 'sk_in_char', 'sk_good_actor', 'sk_deep_in_role', 'sk_c1', 'sk_c2', 'sk_c3', 'sk_call', 'sk_disguise', 'sk_o1', 'sk_o2', 'sk_other_root', 'sk_reinforce', 'sk_read', 'sk_intel', 'sk_once', 'sk_owe', 'sk_tease', 'sk_c2_pending'])).toThrow(/容量不夠/)
    h.commit(applyLoadout(h.k, h.state, 'pc', ['sk_root']))
    expect(() => applyLoadout(h.k, h.state, 'pc', ['sk_root'])).toThrow('這一組和現在裝著的一樣，不用換。')
  })

  it('沒有人註冊 at_home 與 at_facility：不限地點（M1 的行為）', () => {
    const g = game()
    expect(loadoutBlock(g.k, g.state, 'pc')).toBeNull()
  })

  it('有 at_home、at_facility：不在家、也不在調校診所被擋並寫原因；一次換與逐一裝卸都一樣', () => {
    const g = game([PLACES])
    const why = '要在自己的住處或調校診所才能換技能配置。'
    expect(loadoutBlock(g.k, g.state, 'pc')).toBe(why)
    expect(() => applyLoadout(g.k, g.state, 'pc', ['sk_root'])).toThrow(why)
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_root'])).toThrow(why)
    // 在別種設施（酒吧）不算
    g.state.flags.fac = 'bar'
    expect(loadoutBlock(g.k, g.state, 'pc')).toBe(why)
  })

  it('在自己的住處、或調校診所（設施種類照規則 loadout_facility_types，預設 tuning_clinic）都可以', () => {
    const home = game([PLACES], { home: true })
    expect(loadoutBlock(home.k, home.state, 'pc')).toBeNull()
    expect(() => applyLoadout(home.k, home.state, 'pc', ['sk_root'])).not.toThrow()
    const clinic = game([PLACES], { fac: 'tuning_clinic' })
    expect(loadoutBlock(clinic.k, clinic.state, 'pc')).toBeNull()
    const custom = game([PLACES], { fac: 'fac_clinic' }, { loadout_facility_types: ['fac_clinic'] })
    expect(loadoutBlock(custom.k, custom.state, 'pc')).toBeNull()
    // 空的清單：任何設施都算
    const any = game([PLACES], { fac: 'bar' }, { loadout_facility_types: [] })
    expect(loadoutBlock(any.k, any.state, 'pc')).toBeNull()
  })

  it('只有其中一種條件有人註冊：原因只講那一種', () => {
    const onlyHome = game([feature('home_only', (k) => k.conditions.register({ kind: 'at_home', owner: 'home_only', validate: () => [], test: () => false }))])
    expect(loadoutBlock(onlyHome.k, onlyHome.state, 'pc')).toBe('要在自己的住處才能換技能配置。')
    const onlyFac = game([feature('fac_only', (k) => k.conditions.register({ kind: 'at_facility', owner: 'fac_only', validate: () => [], test: () => false }))])
    expect(loadoutBlock(onlyFac.k, onlyFac.state, 'pc')).toBe('要在調校診所才能換技能配置。')
  })

  it('有 commission 的替身活動進行時被擋（即使在家）；織女 標準（loadout_anywhere）委託副本以外哪裡都能換', () => {
    const inside = game([PLACES, COMMISSION], { home: true, in_commission: true })
    expect(loadoutBlock(inside.k, inside.state, 'pc')).toBe('進了委託副本就不能換技能配置，要回到據點或調校診所才行。')
    expect(() => applyLoadout(inside.k, inside.state, 'pc', ['sk_root'])).toThrow(/委託副本/)
    const weaver = game([PLACES, WEAVER], { weaver: true })
    expect(loadoutBlock(weaver.k, weaver.state, 'pc')).toBeNull()
    const weaverInside = game([PLACES, WEAVER, COMMISSION], { weaver: true, in_commission: true })
    expect(loadoutBlock(weaverInside.k, weaverInside.state, 'pc')).toMatch(/委託副本/)
    // 不是織女 標準的人在外面還是被擋
    expect(loadoutBlock(game([PLACES, WEAVER]).k, game([PLACES, WEAVER]).state, 'pc')).toMatch(/住處或調校診所/)
  })

  it('經過 Game：委託副本進行中，ability.loadout 這份報告被活動的放行清單擋下（沒登記放行）', () => {
    const g = game([COMMISSION], { in_commission: true })
    expect(g.blockOf('commit:ability.loadout')).toBe('委託副本進行中。')
  })
})

// ===================================================================================================================
// 7. 人情池
// ===================================================================================================================

describe('人情池：開打時三個池的數字讀衍生數值（favor_*）；結束時用掉幾個發幾筆 favor.spend（有人註冊才發）', () => {
  const pcWith = (fs: number) => ({ counters: { fs } as Record<string, number> })
  const buddy = makeActor({ id: 'buddy', name: '夥伴', role: 'companion' })
  const duo = (): unknown[] => [me(), one({ actor: 'buddy', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 } } as never, 2)]
  const owner = (features: Feature[], fs: number, equipped = ['sk_owe']) =>
    makeBattleGame({
      features: [...FEATS, ...features], content: [PACK], seed: 7, patch: pcWith(fs) as never, actors: [buddy],
      pc: { ext: abilitiesExt(equipped) }, battle: duel(duo(), [idle(), idle()]),
    }).game
  const turnTo = (g: ReturnType<typeof owner>, id: string): BattleUnit => {
    const b = g.state.battle!
    b.turn = b.order.indexOf(id)
    const u = b.units[id]!
    u.ap.now = u.ap.max
    u.control = 'player'
    return u
  }
  const finish = async (g: ReturnType<typeof owner>) => {
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    return (await g.finishBattle()).reports[0]!
  }

  it('衍生數值給 2 個小人情時池是 2（隊友也一樣）；用掉一個，結束的報告裡有一筆 favor.spend', async () => {
    const g = owner([FAVOR_STUB], 2)
    expect(g.state.battle!.units.a1!.pools.favor_small).toEqual({ now: 2, max: 2, regen: 0 })
    expect(g.state.battle!.units.a2!.pools.favor_small!.now).toBe(2)
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'sk_owe', target: undefined as never }).status).toBe('applied')
    const end = await finish(g)
    expect(end.changes.filter((c) => c.op === 'favor.spend')).toEqual([{ op: 'favor.spend', dir: 'owed_to_pc', size: 'small' }])
    expect(g.state.counters.fs).toBe(1)
  })

  it('用掉兩個就兩筆；沒用就沒有這一筆；用掉的不超過現在實際還有的個數', async () => {
    const g = owner([FAVOR_STUB], 2)
    turnTo(g, 'a1')
    g.battleAct({ action: 'sk_owe' })
    turnTo(g, 'a1')
    g.battleAct({ action: 'sk_owe' })
    const end = await finish(g)
    expect(end.changes.filter((c) => c.op === 'favor.spend')).toHaveLength(2)
    expect(g.state.counters.fs).toBe(0)
    const idleGame = owner([FAVOR_STUB], 2)
    expect((await finish(idleGame)).changes.some((c) => c.op === 'favor.spend')).toBe(false)
  })

  it('池是 0 時行動灰掉並寫原因；沒有人註冊 favor_*（人情沒裝）池就是 0', () => {
    const g = owner([FAVOR_STUB], 0)
    turnTo(g, 'a1')
    const o = g.battleOptions()!.actions.find((a) => a.id === 'sk_owe')!
    expect([o.ok, o.cost]).toEqual([false, { ap: 1, favor_small: 1 }])
    expect(o.blocks.join('')).toMatch(/要 1.*現在 0/)
    const bare = owner([], 5)
    expect(bare.state.battle!.units.a1!.pools.favor_small).toEqual({ now: 0, max: 0, regen: 0 })
  })

  it('沒有人註冊 favor.spend：不發那一筆（池照樣用掉，只是沒有地方記）', async () => {
    const stat = feature('stat_only', (k) => k.stats.defineStat({ id: 'favor_small', owner: 'stat_only', name: '小人情', base: (s, a) => (a === s.pc ? 2 : 0) }))
    const g = owner([stat], 0)
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'sk_owe' }).status).toBe('applied')
    const end = await finish(g)
    expect(end.changes.some((c) => c.op === 'favor.spend')).toBe(false)
  })

  it('舊的 actor.ext.favors 格式不再讀：寫在角色身上的人情沒有池；結束時也不寫回', async () => {
    const g = makeBattleGame({
      features: [...FEATS, FAVOR_STUB], content: [PACK], patch: pcWith(0) as never,
      pc: { ext: { ...abilitiesExt(['sk_owe']), favors: { small: 3, mid: 3, big: 3 } } }, battle: duel([me(), ...mates()], [idle()]),
    }).game
    expect(g.state.battle!.units.a1!.pools.favor_small!.now).toBe(0)
    const end = await finish(g as never)
    expect(end.changes.some((c) => c.op === 'actor.ext' && c.key === 'favors')).toBe(false)
    expect(g.state.actors.pc!.ext.favors).toEqual({ small: 3, mid: 3, big: 3 })
  })

  it('真的人情功能（state.ext.favors）：池讀它的衍生數值；用掉一個之後清單少一筆（最早記下的那一筆）', async () => {
    const entry = (id: string, size: string) => ({ id, who: 'someone', size, at: { day: 1, hour: 8, minute: 0 } })
    const g = makeBattleGame({
      features: [...FEATS, favorsFeature], content: [PACK], seed: 7, actors: [buddy],
      patch: { ext: { favors: { owed_to_pc: [entry('fv_1', 'small'), entry('fv_2', 'mid'), entry('fv_3', 'small')], owed_by_pc: [entry('fv_4', 'small')], seq: 4 } } } as never,
      pc: { ext: abilitiesExt(['sk_owe']) }, battle: duel(duo(), [idle()]),
    }).game
    const pools = (id: string) => ['favor_small', 'favor_mid', 'favor_big'].map((p) => g.state.battle!.units[id]!.pools[p]!.now)
    expect(pools('a1')).toEqual([2, 1, 0])
    expect(pools('a2')).toEqual([2, 1, 0])
    turnTo(g as never, 'a1')
    g.battleAct({ action: 'sk_owe' })
    await finish(g as never)
    expect((g.state.ext.favors as { owed_to_pc: Array<{ id: string }>; owed_by_pc: unknown[] }).owed_to_pc.map((f) => f.id)).toEqual(['fv_2', 'fv_3'])
    expect((g.state.ext.favors as { owed_by_pc: unknown[] }).owed_by_pc).toHaveLength(1)
  })
})

// ===================================================================================================================
// 8. 歷練點的效果 xp
// ===================================================================================================================

describe('歷練點的效果 xp（委託結算用這個名字發）：主角與一起出門的夥伴各拿一份，留在家的拿三成（CORE_RULES 7.1）', () => {
  const along = makeActor({ id: 'along', name: '同行者', role: 'companion' })
  const home = makeActor({ id: 'home', name: '留守者', role: 'npc' })
  const tagalong = makeActor({ id: 'tag', name: '跟班', role: 'npc' })
  const stranger = makeActor({ id: 'stranger', name: '路人', role: 'npc' })
  const game = (features: Feature[] = [ROSTER], flags: Rec = { roster: ['along', 'home', 'tag'], tagalong: ['tag'] }) =>
    makeGame({ features: [...FEATS, ...features], content: [PACK], actors: [along, home, tagalong, stranger], patch: { flags: flags as never }, pc: { ext: abilitiesExt([], { xp: 10 }) } }).game
  const resolve = (g: ReturnType<typeof game>, amount: number, source: 'builtin' | 'ai' = 'builtin') => g.k.effects.resolve([{ kind: 'xp', amount }], effectCtx(g.k as never, g.state, { source }))
  const xpOf = (g: ReturnType<typeof game>, id: string): number => abilitiesOf(g.state, id).xp

  it('同行（在隊上）的夥伴拿完整一份；同行名單上的也是；留在家的名冊成員拿三成；不在名冊上的人沒有', () => {
    const g = game()
    const r = resolve(g, 20)
    expect(r.errors).toEqual([])
    for (const c of r.changes) g.commit({ kind: 'system', location: {}, party: [], timeline: [], changes: [c], outcome: { result: 'ok', summary: '測試。' } })
    expect([xpOf(g, 'pc'), xpOf(g, 'along'), xpOf(g, 'tag'), xpOf(g, 'home'), xpOf(g, 'stranger')]).toEqual([30, 20, 20, 6, 0])
    expect(r.lines).toEqual(['歷練點 +20；同行者 +20、留守者（留在家） +6、跟班 +20'])
  })

  it('三成四捨五入（35 → 11）；0 點什麼都不做；歷練倍率是呼叫的人先乘好的（這裡收一份的量）', () => {
    const g = game()
    expect(xpShares(g.k, g.state, 'pc', 35).map((s) => [s.id, s.share, s.who])).toEqual([['pc', 35, 'self'], ['along', 35, 'along'], ['home', 11, 'home'], ['tag', 35, 'along']])
    expect(resolve(g, 0).changes).toEqual([])
  })

  it('留在家的比例是規則（ability_rule.xp_home_share）：改成 0.5', () => {
    const g = makeGame({
      features: [...FEATS, ROSTER], content: [{ id: 'r', content: { ability_rule: [{ id: 'default', xp_home_share: 0.5 }] } } as unknown as ContentPack, PACK],
      actors: [home], patch: { flags: { roster: ['home'] } as never }, pc: { ext: abilitiesExt([]) },
    }).game
    expect(xpShares(g.k, g.state, 'pc', 20).find((s) => s.id === 'home')!.share).toBe(10)
  })

  it('名冊沒裝（沒有 in_roster）：沒有留在家的；沒有 in_tagalong：同行名單上的不算同行（等名冊註冊）；隊上的夥伴照樣拿', () => {
    const g = game([], {})
    expect(xpShares(g.k, g.state, 'pc', 20).map((s) => [s.id, s.share])).toEqual([['pc', 20], ['along', 20]])
    const noTag = game([feature('roster_only', (k) => k.conditions.register<{ kind: string; who: string }>({ kind: 'in_roster', owner: 'roster_only', validate: () => [], test: (c, { state }) => (state.flags.roster as unknown as string[]).includes(c.who) }))])
    expect(xpShares(noTag.k, noTag.state, 'pc', 20).map((s) => [s.id, s.share])).toEqual([['pc', 20], ['along', 20], ['home', 6], ['tag', 6]])
  })

  it('格式：amount 要是 0 以上的整數；AI 給的一件事最多 10 點（內建的照寫）', () => {
    const g = game()
    expect(resolve(g, -3).errors[0]).toMatch(/amount/)
    expect(resolve(g, 2.5).errors[0]).toMatch(/amount/)
    expect(resolve(g, 25, 'ai').lines[0]).toBe('歷練點 +10；同行者 +10、留守者（留在家） +3、跟班 +10')
    expect(resolve(g, 25, 'ai').clamps).toHaveLength(1)
    expect(resolve(g, 25).clamps).toHaveLength(0)
  })

  it('xp 是登記好的效果種類（委託結算看 k.effects.has 才發）', () => {
    expect(game([]).k.effects.has('xp')).toBe(true)
  })
})
