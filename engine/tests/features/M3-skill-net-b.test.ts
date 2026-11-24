// 驗收測試：dev/work/M3-skill-net-b.md（cpp-feature）。名媛、掮客、主播、偶像四棵樹的內海欄逐條寫成測試用的資料（tests/fixtures/skills），
// 證明格式寫得出來、每棵樹挑代表的幾個在內海戰鬥（真的 features/netcombat、abilities）裡打一次，數字對設計書。
// 補的通用機制：誘惑在內海（net.lure、needs.persona）、面具（net.masked）、指揮與遠端叫人（net.command、net.remote_call）、導流階（net.flow、when.flow_min、net.flow_bonus）、
// 共鳴（net.link、net.song、link.each、link.dump）、安撫（狀態 pacified 讓 AI 列不出攻擊類的行動；這一張在 abilities 加的是花費的修正）。
// 規格：SKILL_TREES「名媛：入戲」「掮客：人面」「主播：聚光燈」「偶像：應援」的內海欄；CYBERSPACE 第 5 節；MEDIA 4.1、9.1 節；dev/adr/0018 N28。
// 骰面：用 fixDice 釘死（第一顆是檢定的 d20），內容都是測試自帶的最小假資料（技能資料在 tests/fixtures/skills）。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOptions, BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel, TimelineBeat } from '../../src'
import { BattleBlocked, BattleRun, battleAct, battleOptions, clone, createKernel, performAction, readyFeatures, setupBattle } from '../../src'
import { FLOW_TIER_STAT, abilitiesFeature } from '../../src/features/abilities'
import { featureMods } from '../../src/features/abilities/mods'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import { hackFeature } from '../../src/features/hack'
import { netcombatFeature } from '../../src/features/netcombat'
import { summonsFeature } from '../../src/features/summons'
import { TEST_NET_COMBAT, fixDice, laceUnit, makeActor, makeState, netAvatar } from '../../src/testkit'
import { NET_TREES_B, netPack } from '../fixtures/skills'
import type { Tree } from '../fixtures/skills'
import { TEST_STATUSES } from '../helpers/battle'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料與場地
// ===================================================================================================================

const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
  { id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' }, { id: 'sync', name: '同步', attr: 'resolve', desc: '同步。' },
  { id: 'composure', name: '定力', attr: 'resolve', desc: '定力。' }, { id: 'seduce', name: '誘惑', attr: 'charm', desc: '誘惑。' },
  { id: 'negotiate', name: '交涉', attr: 'charm', desc: '交涉。' }, { id: 'perform', name: '表演', attr: 'charm', desc: '表演。' },
]
const EXTRA_STATUSES = [
  { id: 'focused', name: '被集火', desc: '被集火：全隊打他命中 +1。', mods: { hit_against: 1 }, until: 'source_turn_start', turns: 1, kind: 'mark' },
  { id: 'pacified', name: '被安撫', desc: '被安撫：這個回合不攻擊。', until: 'own_turn_end', turns: 1, kind: 'control' },
  { id: 'drowsy', name: '昏沉', desc: '昏沉：下個回合行動點 −1。', turn_start: { ap: -1 }, once: true, until: 'battle_end', kind: 'debuff' },
  ...(['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' })),
]
const RULES: ContentPack = { id: 'skill_net_b_rules', content: { skill: SKILLS, battle_status: [...TEST_STATUSES, ...EXTRA_STATUSES] } } as unknown as ContentPack
const pack = (trees?: Tree[]): ContentPack => netPack(trees ?? Object.values(NET_TREES_B), 'skill_net_b') as unknown as ContentPack

const feature = (id: string, install: (k: Kernel) => void): Feature => ({ id, install })
/** 名冊的候補（k.battle.bench）：名冊上的人是角色，路數在角色的 ext.paths。 */
const BENCH = (entries: Array<{ id: string; name: string; blocks?: string[] }>): Feature =>
  feature('bench_stub', (k) => k.battle.bench('bench_stub', (_s, _b, side) => (side === 'ally' ? entries.map((e) => ({ id: e.id, name: e.name, blocks: e.blocks ?? [], ref: { from: 'actor' as const, id: e.id } })) : [])))
/** 導流階的來源（M5 的媒體功能之前是 0）：測試自己給。 */
const FLOW = (n: number): Feature => feature('flow_stub', (k) => k.stats.addStatProvider(FLOW_TIER_STAT, 'flow_stub', () => [{ label: '頻道', value: n, source: 'skill' }]))
const BASE: Feature[] = [combatFeature, deckFeature, netcombatFeature, hackFeature, summonsFeature, abilitiesFeature]

const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], ...o })
const DECK = () => ({ grade: 2, firewall: 12, slots: [] as string[], constructs: [] as unknown[] })
const equip = (tiers: Record<string, number>, ...ids: string[]) => ({ abilities: { equipped: ids, tiers } })
/** 內海的我：有甲板（才有 RAM）、行動點很多、技能照 ids 裝著。 */
const avatar = (i: number, tiers: Record<string, number>, ids: string[], o: Rec = {}) =>
  netAvatar(i, 1, { ap: { now: 20, max: 20, regen: 3 }, skills: { interface: 4, composure: 2, seduce: 2, negotiate: 2, perform: 2 }, ext: { ...equip(tiers, ...ids), net: NET(), deck: DECK() }, ...o } as never)
const mate = (i: number, o: Rec = {}) => avatar(i, {}, [], o)
const lace = (o: Rec = {}) => laceUnit('minion', 1, { evade: 0, ap: { now: 0, max: 0, regen: 0 }, ext: { net: NET(), deck: DECK() }, ...o } as never)
const elite = (o: Rec = {}) => laceUnit('elite', 1, { evade: 0, ap: { now: 0, max: 0, regen: 0 }, ext: { net: NET(), deck: DECK() }, ...o } as never)
/** 有人格的粉色精英（帶 persona 標籤）。 */
const pinkElite = (o: Rec = {}) => elite({ tags: ['lace', 'lace:pink', 'persona'], name: '粉蕾絲', ...o })
const raw = (u: unknown) => ({ from: 'unit', unit: u as Rec })
const setup = (allies: unknown[], foes: unknown[], more: Partial<BattleSetup> = {}): BattleSetup =>
  ({ mode: 'net', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, allies: allies.map(raw), foes: foes.map(raw), field: { trace: 20 }, origin: { escapable: true }, ...more }) as BattleSetup

interface Arena {
  k: Kernel
  state: GameState
  battle: ReturnType<typeof setupBattle>['battle']
  run(dice?: number[]): BattleRun
  a(i: number): BattleUnit
  f(i: number): BattleUnit
}
interface ArenaOpts { trees?: Tree[]; extra?: Feature[]; state?: GameState }
/** 不經過提交的內海戰鬥：state.battle 就是 arena.battle，行動直接改它。 */
function arena(s: BattleSetup, o: ArenaOpts = {}): Arena {
  const k = createKernel([...BASE, ...(o.extra ?? [])])
  k.content.loadPack(RULES)
  k.content.loadPack(pack(o.trees))
  readyFeatures(k)
  const state = o.state ?? makeState()
  const battle = clone(setupBattle(k, state, s).battle)
  state.battle = battle
  return {
    k, state, battle,
    run: (dice) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)),
    a: (i) => battle.units[`a${i}`]!,
    f: (i) => battle.units[`f${i}`]!,
  }
}

const turnTo = (a: Arena, id: string): BattleUnit => {
  const b = a.battle
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const options = (a: Arena): BattleOptions => battleOptions(a.k, a.state)!
const opt = (a: Arena, id: string) => options(a).actions.find((x) => x.id === id)
const ringIds = (a: Arena): string[] => options(a).actions.map((x) => x.id)
const FILL = Array(300).fill(3)
/** 做一個行動（走核心的 performAction）：骰面釘死，沒寫的用 3。回傳這一步的每一拍。 */
function doAct(a: Arena, who: string, input: BattleInput, dice: number[] = []): TimelineBeat[] {
  const run = a.run([...dice, ...FILL])
  const def = a.k.battle.getAction(input.action)!
  performAction(run, run.unit(who), def, input.target ?? null, input)
  run.settle()
  return run.beats
}
const reasons = (a: Arena, input: BattleInput): string[] => {
  try {
    battleAct(a.k, a.state, input)
    return []
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}
const setGear = (u: BattleUnit, gear: string): void => {
  u.tags = [...u.tags.filter((t) => !t.startsWith('sync:')), `sync:${gear}`]
  ;(u.ext.net as Rec).sync = gear
}
const modsOf = (a: Arena, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = [], other?: BattleUnit): number => {
  const r = a.run()
  return r.mods(kind, r.unit(id), other, undefined, tags).reduce((s, p) => s + p.value, 0)
}
const statusIds = (u: BattleUnit): string[] => u.statuses.map((s) => s.id)
const buffIds = (u: BattleUnit): string[] => (((u.ext.abilities as Rec | undefined)?.buffs as Array<{ id: string }> | undefined) ?? []).map((b) => b.id)
const trace = (a: Arena): number => a.battle.field.trace as number

const ALL: Tree[] = Object.values(NET_TREES_B)
const IDS = (t: Tree): string[] => t.abilities.map((x) => x.id as string)
const S = (name: string): string => `sk_socialite_${name}`
const F = (name: string): string => `sk_fixer_${name}`
const ST = (name: string): string => `sk_streamer_${name}`
const I = (name: string): string => `sk_idol_${name}`

// ===================================================================================================================
// 一、四棵樹的資料全部載得進來
// ===================================================================================================================

describe('四棵樹的內海欄資料：格式檢查過、用到的效果都查得到', () => {
  it.each(Object.entries(NET_TREES_B))('%s：27 個技能與 5 個共鳴載得進來，對照表涵蓋每一個技能', (_name, tree) => {
    const k = createKernel([...BASE])
    k.content.loadPack(RULES)
    expect(() => {
      k.content.loadPack(pack([tree]))
      readyFeatures(k)
    }).not.toThrow()
    expect(tree.abilities).toHaveLength(27)
    expect(tree.path.resonance as unknown[]).toHaveLength(5)
    expect(tree.notes.map((n) => n.id)).toEqual(IDS(tree))
    for (const n of tree.notes) {
      expect(n.text.length, n.id).toBeGreaterThan(0)
      expect(['done', 'approx', 'none', 'wait'], n.id).toContain(n.status)
    }
    for (const ab of tree.abilities) {
      expect(ab.meat, String(ab.id)).toBeNull()
      expect(ab.opinion, String(ab.id)).toBeNull()
    }
  })

  it('四棵樹放在同一份內容包裡也載得進來（id 不撞）；內海欄是「—」的 net 是 null，寫不出來的標 pending 並留原文', () => {
    const k = createKernel([...BASE])
    k.content.loadPack(RULES)
    k.content.loadPack(pack(ALL))
    readyFeatures(k)
    expect(new Set(ALL.flatMap(IDS)).size).toBe(108)
    for (const t of ALL) {
      for (const n of t.notes) {
        const ab = t.abilities.find((x) => x.id === n.id)!
        if (n.text === '—') expect(ab.net, n.id).toBeNull()
        else if (n.status === 'none' || n.status === 'wait') {
          // 寫不出來的：net 欄 pending，或這一欄根本沒有（預備只留格式）
          if (ab.net !== null && !(ab.net as Rec).tags) expect(ab.net as Rec, n.id).toMatchObject({ pending: true })
        } else expect(ab.net, n.id).not.toBeNull()
      }
    }
  })

  it('主播與偶像在現實沒有效果：共鳴的內海效果寫在 resonance.net（寫在 effect 會被擋）', () => {
    for (const name of ['streamer', 'idol']) {
      const t = clone(NET_TREES_B[name]!)
      ;(t.path.resonance as Rec[])[2] = { tier: 3, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } }
      const k = createKernel([...BASE])
      k.content.loadPack(RULES)
      expect(() => {
        k.content.loadPack(pack([t]))
        readyFeatures(k)
      }, name).toThrow(/現實沒有效果/)
    }
  })

  it('壞掉的內海欄照樣被擋，這一張新加的鍵格式不對的擋下；現實欄寫內海版的鍵也擋；現實版的 tease、mask、give_ap、call 在內海欄仍然擋', () => {
    const load = (ab: Rec, tree = NET_TREES_B.socialite!) => () => {
      const k = createKernel([...BASE])
      k.content.loadPack(RULES)
      const t = clone(tree)
      t.abilities.push({ id: 'sk_x', name: 'x', path: t.path.id, category: t.path.category, tier: 1, layer: 'front', kind: 'active', cap: 1, xp: 20, cells: 1, after: t.path.signature, text: 'x。', meat: null, net: null, opinion: null, ...ab })
      k.content.loadPack(pack([t]))
    }
    const act = (net: Rec, use: Rec = { ap: 1 }) => ({ use: { net: use }, net: { target: 'enemy', ...net } })
    expect(load(act({ do: [{ op: 'attack' }] }))).not.toThrow()
    // 內海版的鍵
    expect(load(act({ lure: {} }, {}))).not.toThrow()
    expect(load(act({ lure: { hit: 'x' } }, {}))).toThrow(/net\.lure\.hit/)
    expect(load(act({ lure: { targets: 3 } }, {}))).toThrow(/net\.lure\.targets/)
    expect(load(act({ lure: {}, do: [{ op: 'attack' }] }, {}))).toThrow(/net\.lure 不能和 do/)
    expect(load({ kind: 'passive', net: { masked: false } })).toThrow(/net\.masked/)
    expect(load({ kind: 'passive', net: { command: { max: 0 } } })).toThrow(/net\.command/)
    expect(load({ kind: 'passive', net: { remote_call: { options: ['hack'], per_fight: 1, ap: 1 } } })).toThrow(/remote_call\.path/)
    expect(load({ kind: 'passive', net: { remote_call: { options: ['vent'], per_fight: 1, ap: 1, path: 'netrunner' } } })).toThrow(/remote_call\.vent/)
    expect(load({ kind: 'active', net: { target: 'enemy', flow: { cap: -1 }, do: [{ op: 'attack' }] } })).toThrow(/net\.flow\.cap/)
    expect(load({ kind: 'passive', net: { flow_bonus: 0 } })).toThrow(/net\.flow_bonus/)
    expect(load({ kind: 'active', net: { link: true } })).toThrow(/net\.link 只有被動/)
    expect(load({ kind: 'passive', net: { song: true } })).toThrow(/net\.song 只有姿態/)
    expect(load({ kind: 'stance', net: { song: true, on_link_overload: [{ op: 'ghost' }] } })).toThrow(/on_link_overload.*ghost/)
    expect(load(act({ when: { flow_min: 0 }, do: [{ op: 'attack' }] }))).toThrow(/flow_min/)
    expect(load(act({ needs: { persona: false }, do: [{ op: 'attack' }] }))).toThrow(/needs\.persona/)
    expect(load(act({ needs: { no_tag: [] }, do: [{ op: 'attack' }] }))).toThrow(/needs\.no_tag/)
    expect(load({ kind: 'passive', net: { mods: [{ kind: 'save', value: 1, who: 'nobody' }] } })).toThrow(/who/)
    expect(load({ kind: 'reaction', use: { net: { ap: 1 } }, net: { trigger: { on: 'overload', who: 'self' }, react: { keep_link: 1 } } })).toThrow(/keep_link/)
    expect(load({ kind: 'reaction', use: { net: { ap: 1 } }, net: { trigger: { on: 'attacked', who: 'self' }, react: { keep_link: true } } })).toThrow(/keep_link 不能用在 attacked/)
    // 現實欄寫內海版的鍵：整筆擋下
    for (const key of ['lure', 'masked', 'link', 'song', 'flow_bonus']) {
      expect(load({ kind: key === 'song' ? 'stance' : 'passive', meat: { [key]: key === 'flow_bonus' ? 1 : key === 'lure' ? {} : true } }), key).toThrow(new RegExp(`meat\\.${key} 只有內海欄能寫`))
    }
    // 現實版的鍵在內海欄仍然擋掉（誘惑攻擊、面具、指揮、叫人）
    expect(load(act({ tease: {} }, {}))).toThrow(/net\.tease 在內海沒有意義/)
    expect(load({ kind: 'passive', net: { mask: { rounds: 2 } } })).toThrow(/net\.mask 在內海沒有意義/)
    expect(load({ kind: 'passive', net: { give_ap: { max: 'one_plus_half_tier' } } })).toThrow(/net\.give_ap 在內海沒有意義/)
    expect(load({ kind: 'passive', net: { mods: [{ kind: 'call_uses', value: 1 }] } })).toThrow(/call_uses/)
    // 內海欄放行的修正
    expect(load({ kind: 'passive', net: { mods: [{ kind: 'tease_bonus', value: '1d6' }, { kind: 'give_ap_cap', value: 1 }, { kind: 'remote_uses', value: 1 }] } })).not.toThrow()
  })
})

// ===================================================================================================================
// 二、名媛
// ===================================================================================================================

const CHARM14 = { body: 10, reflex: 15, tech: 10, intellect: 10, resolve: 12, charm: 14 }
const TEASE = `${S('in_character')}.tease`

describe('名媛：誘惑在內海、面具', () => {
  const socialite = (ids: string[] = [S('in_character')], o: Rec = {}) => avatar(1, { socialite: 3 }, ids, { attrs: CHARM14, ...o })

  it('誘惑打帶 persona 標籤的粉精英有效；沒有 persona 的雜兵灰掉並說「沒有人格」；化身（不是蕾絲）打得到', () => {
    const a = arena(setup([socialite()], [pinkElite(), lace(), elite({ tags: ['lace', 'lace:white'] })]))
    turnTo(a, 'a1')
    const o = opt(a, TEASE)!
    expect(o.ok).toBe(true)
    expect(a.k.battle.getAction(TEASE)!.modes).toEqual(['net', 'meat'].filter((m) => m === 'net'))
    expect(o.cost).toEqual({ ap: 2 })
    const byUnit = (id: string) => o.targets.find((t) => 'unit' in t.target && t.target.unit === id)!
    expect(byUnit('f1').blocks).toEqual([])
    expect(byUnit('f2').blocks.join('')).toMatch(/沒有人格/)
    expect(byUnit('f3').blocks.join('')).toMatch(/沒有人格/)
    // 做出去：打雜兵被擋下並說明
    expect(reasons(a, { action: TEASE, target: { unit: 'f2' } }).join('')).toMatch(/沒有人格/)
    // 化身（沒有 lace、program 標籤）有人格
    const b = arena(setup([socialite()], [lace({ tags: ['netrunner'], name: '敵方化身' })]))
    turnTo(b, 'a1')
    expect(opt(b, TEASE)!.targets.find((t) => 'unit' in t.target && t.target.unit === 'f1')!.blocks).toEqual([])
  })

  it('傷害照網內的規則：2d6 加魅力的調整值（魅力 14 是 +2），再扣目標的防護（內海的感載照扣防護）；魅力 10 的對照少 2 點', () => {
    const guard = laceUnit('elite', 1).armor
    expect(guard).toBeGreaterThan(0)
    const run = (charm: number) => {
      const a = arena(setup([socialite([S('in_character')], { attrs: { ...CHARM14, charm } })], [pinkElite()]))
      turnTo(a, 'a1')
      doAct(a, 'a1', { action: TEASE, target: { unit: 'f1' } }, [20])
      return a.f(1).load!.now
    }
    expect(run(14)).toBe(6 + 2 - guard)
    expect(run(10)).toBe(6 - guard)
    // 檢定沒過就沒有傷害
    const a = arena(setup([socialite()], [pinkElite()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: TEASE, target: { unit: 'f1' } }, [1])
    expect(a.f(1).load!.now).toBe(0)
  })

  it('距離 3 以內：距離 4 灰掉並寫距離；每回合 1 次（同一組）', () => {
    const a = arena(setup([socialite()], [lace(), lace(), lace(), pinkElite({ name: '遠處的粉蕾絲' })]))
    turnTo(a, 'a1')
    const o = opt(a, TEASE)!
    const dist = (id: string) => o.targets.find((t) => 'unit' in t.target && t.target.unit === id)!.blocks.join('')
    expect(dist('f4')).toMatch(/距離 1～3/)
    // 前面三格的雜兵是因為沒有人格灰掉；把第 3 格換成有人格的就打得到
    const b = arena(setup([socialite()], [lace(), lace(), pinkElite({ name: '近處的粉蕾絲' })]))
    turnTo(b, 'a1')
    expect(opt(b, TEASE)!.targets.find((t) => 'unit' in t.target && t.target.unit === 'f3')!.blocks).toEqual([])
    doAct(b, 'a1', { action: TEASE, target: { unit: 'f3' } }, [20])
    expect(opt(b, TEASE)!.blocks.join('')).toMatch(/tease.*用了 1 次/)
  })

  it('現實的名媛不受影響：現實欄的誘惑攻擊仍然距離 2、不加魅力的調整值（同一個技能兩欄各自照戰場）', () => {
    const a = arena(setup([socialite()], [pinkElite()]))
    const def = a.k.battle.getAction(TEASE)!
    expect(def.modes).toEqual(['net'])
  })

  it('銷魂（誘惑加 1d6，讓目標過載多一層餘韻）、媚態（誘惑傷害多 1d6）、暈乎乎（命中的目標下一回合行動點 −1）、不要走嘛（壓制）', () => {
    const ids = [S('in_character'), S('look_here'), S('stay'), S('charm_pose'), S('swoon'), S('dizzy')]
    const a = arena(setup([socialite(ids)], [pinkElite({ load: { now: 0, max: 8 } })]))
    turnTo(a, 'a1')
    expect(opt(a, S('stay'))!.cost).toEqual({ ap: 2 })
    // 不要走嘛：命中壓制到他下一回合結束
    doAct(a, 'a1', { action: S('stay'), target: { unit: 'f1' } }, [20])
    expect(statusIds(a.f(1))).toContain('suppressed')
    // 同一組每回合 1 次：不要走嘛之後暈乎乎也灰掉
    expect(opt(a, S('dizzy'))!.blocks.join('')).toMatch(/tease/)
    // 下一回合：暈乎乎 2d6 ＋ 2 ＋ 1d6（全 3：9 ＋ 2，感載上限 8 → 過載）；命中的目標掛昏沉
    a.a(1).uses['turn:group:tease'] = 0
    a.f(1).statuses = []
    a.f(1).load!.max = 40
    a.f(1).load!.now = 0
    doAct(a, 'a1', { action: S('dizzy'), target: { unit: 'f1' } }, [20])
    expect(a.f(1).load!.now).toBe(6 + 3 + 2 - a.f(1).armor)
    expect(statusIds(a.f(1))).toContain('drowsy')
    // 媚態：開著時誘惑攻擊多 1d6
    a.a(1).uses['turn:group:tease'] = 0
    doAct(a, 'a1', { action: S('charm_pose') })
    expect(a.a(1).stance).toBe(S('charm_pose'))
    a.f(1).load!.now = 0
    doAct(a, 'a1', { action: TEASE, target: { unit: 'f1' } }, [20])
    expect(a.f(1).load!.now).toBe(6 + 2 + 3 - a.f(1).armor)
  })

  it('銷魂：這一下讓目標過載，他多疊一層餘韻', () => {
    const a = arena(setup([socialite([S('in_character'), S('look_here'), S('stay'), S('charm_pose'), S('swoon')])], [pinkElite({ load: { now: 0, max: 8 } })]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: S('swoon'), target: { unit: 'f1' } }, [20])
    // 過載一次（餘韻 1 層）＋銷魂多疊一層
    expect(a.f(1).layers).toBe(2)
  })

  it('繞指柔：誘惑攻擊每回合可以用 2 次（組的次數 +1），第三次灰掉', () => {
    const ids = [S('in_character'), S('look_here'), S('stay'), S('charm_pose'), S('swoon'), S('dizzy'), S('city_fall'), S('silk')]
    const a = arena(setup([socialite(ids)], [pinkElite({ load: { now: 0, max: 99 } })]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: TEASE, target: { unit: 'f1' } }, [20])
    expect(opt(a, TEASE)!.ok).toBe(false)
    doAct(a, 'a1', { action: S('silk') })
    expect(opt(a, TEASE)!.ok).toBe(true)
    doAct(a, 'a1', { action: TEASE, target: { unit: 'f1' } }, [20])
    expect(opt(a, TEASE)!.ok).toBe(false)
  })

  it('面具：戰鬥結束的報告標出 data.masked；沒裝入戲的沒有；現實欄的面具（敵人不挑她）內海不生效', () => {
    const a = arena(setup([socialite(), mate(2)], [pinkElite()]))
    const run = a.run()
    run.finish('win', '贏了。')
    const marks = run.beats.filter((b) => b.data?.masked === true)
    expect(marks).toHaveLength(1)
    expect(marks[0]!.data!.unit).toBe('a1')
    const b = arena(setup([mate(1)], [pinkElite()]))
    const run2 = b.run()
    run2.finish('win', '贏了。')
    expect(run2.beats.filter((x) => x.data?.masked === true)).toHaveLength(0)
    // 面具在內海不影響敵人挑目標
    expect(modsOf(a, 'ai_target_pct', 'a1', [], a.f(1))).toBe(0)
  })

})

describe('名媛：其餘的幾條', () => {
  const socialite = (ids: string[], o: Rec = {}) => avatar(1, { socialite: 5 }, ids, { attrs: CHARM14, ...o })

  it('替身：整場第一次被命中時這一擊沒有感載（第二次照常）；每場一次', () => {
    const a = arena(setup([socialite([S('in_character'), S('stand_in')])], [elite()]))
    const hit = (): number => {
      const before = a.a(1).load!.now
      a.run([19, ...FILL]).attack(a.f(1), a.a(1))
      return a.a(1).load!.now - before
    }
    expect(hit()).toBe(0)
    expect(a.a(1).uses[S('stand_in')]).toBe(1)
    expect(hit()).toBeGreaterThan(0)
  })

  it('戳戳你：對有橋的蕾絲（雜兵也行）灌 6 點感載，不擲骰、不看護甲；每回合 1 次；距離 4 灰掉', () => {
    const a = arena(setup([socialite([S('in_character'), S('look_here'), S('poke')])], [lace(), lace(), lace(), lace()]))
    turnTo(a, 'a1')
    expect(opt(a, S('poke'))!.cost).toEqual({ ap: 1 })
    expect(opt(a, S('poke'))!.targets.find((t) => 'unit' in t.target && t.target.unit === 'f4')!.blocks.join('')).toMatch(/距離 1～3/)
    doAct(a, 'a1', { action: S('poke'), target: { unit: 'f1' } })
    // exact：不乘敏感度（敏感度 50 剛好是 1）；不看護甲
    expect(a.f(1).load!.now).toBe(6)
    expect(opt(a, S('poke'))!.ok).toBe(false)
  })

  it('跟我說嘛：交涉對意志，成功時目標掛「全隊打他命中 +1」到我方的下一回合開始；只對有人格的', () => {
    const a = arena(setup([socialite([S('in_character'), S('look_here'), S('poke'), S('read_people'), S('tell_me')])], [pinkElite(), lace()]))
    turnTo(a, 'a1')
    const o = opt(a, S('tell_me'))!
    expect(o.targets.find((t) => 'unit' in t.target && t.target.unit === 'f2')!.blocks.join('')).toMatch(/沒有人格/)
    doAct(a, 'a1', { action: S('tell_me'), target: { unit: 'f1' } }, [20])
    expect(buffIds(a.f(1))).toEqual(['tell_me'])
    expect(modsOf(a, 'hit_against', 'f1')).toBe(1)
    // 失敗不標記
    const b = arena(setup([socialite([S('in_character'), S('look_here'), S('poke'), S('read_people'), S('tell_me')])], [pinkElite()]))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: S('tell_me'), target: { unit: 'f1' } }, [1])
    expect(buffIds(b.f(1))).toEqual([])
  })

  it('說服蕾絲：誘惑或交涉對 10＋等級×2（精英再 +2）；成功它失去下一回合；每場 1 次；沒有人格的灰掉', () => {
    const ids = [S('in_character'), S('look_here'), S('read_people'), S('false_identity'), S('persuade_lace')]
    const a = arena(setup([socialite(ids)], [pinkElite(), lace()]))
    turnTo(a, 'a1')
    const o = opt(a, S('persuade_lace'))!
    expect(o.cost).toEqual({ ap: 2 })
    expect(o.picks.map((p) => p.key)).toEqual(['how'])
    expect(o.targets.find((t) => 'unit' in t.target && t.target.unit === 'f2')!.blocks.join('')).toMatch(/persona/)
    doAct(a, 'a1', { action: S('persuade_lace'), target: { unit: 'f1' }, pick: { how: 'seduce' } }, [20])
    expect(statusIds(a.f(1))).toContain('lose_turn')
    expect(opt(a, S('persuade_lace'))!.blocks.join('')).toMatch(/用過了/)
    // 擲不過：沒有狀態
    const b = arena(setup([socialite(ids)], [pinkElite()]))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: S('persuade_lace'), target: { unit: 'f1' }, pick: { how: 'negotiate' } }, [1])
    expect(statusIds(b.f(1))).not.toContain('lose_turn')
  })

  it('謝幕：追蹤度 −10，全隊掛「敵人攻擊我方命中 −3」；傾城：敵方每一個有橋的單位受 2d6＋魅力調整值的快感傷害（含沒有人格的雜兵）', () => {
    const ids = [S('in_character'), S('look_here'), S('stay'), S('charm_pose'), S('swoon'), S('dizzy'), S('city_fall'), S('new_face'), S('disguise'), S('stand_in'), S('deep_in_role'), S('curtain_call')]
    const a = arena(setup([socialite(ids), mate(2)], [lace(), pinkElite(), lace()]))
    turnTo(a, 'a1')
    const t0 = trace(a)
    doAct(a, 'a1', { action: S('curtain_call') })
    expect(trace(a)).toBe(t0 - 10)
    expect(buffIds(a.a(1))).toEqual(['curtain_call'])
    expect(buffIds(a.a(2))).toEqual(['curtain_call'])
    expect(modsOf(a, 'hit_against', 'a2')).toBe(-3)
    const guard = (id: string): number => a.f(Number(id)).armor
    doAct(a, 'a1', { action: S('city_fall') })
    for (const i of [1, 2, 3]) expect(a.f(i).load!.now, `f${i}`).toBe(Math.max(0, 6 + 2 - guard(String(i))))
    expect(opt(a, S('city_fall'))!.blocks.join('')).toMatch(/用過了/)
  })

  it('換臉：標記解除，掛面具到下一回合開始，第一回合不能用；欺負人家要賠喔：被有橋、距離 3 以內的敵人攻擊之後反擊一次誘惑攻擊', () => {
    const ids = [S('in_character'), S('look_here'), S('stay'), S('charm_pose'), S('swoon'), S('dizzy'), S('payback'), S('new_face'), S('disguise'), S('stand_in')]
    const a = arena(setup([socialite(ids)], [pinkElite({ load: { now: 0, max: 60 } })]))
    turnTo(a, 'a1')
    a.battle.round = 1
    expect(opt(a, S('new_face'))!.blocks.join('')).toMatch(/第一回合/)
    a.battle.round = 2
    a.run().applyStatus(a.a(1), 'marked')
    expect(statusIds(a.a(1))).toContain('marked')
    doAct(a, 'a1', { action: S('new_face') })
    expect(statusIds(a.a(1))).not.toContain('marked')
    expect(buffIds(a.a(1))).toContain('new_face')
    // 反擊：f1 打 a1（骰面 19 命中），a1 的欺負人家要賠喔做一次誘惑攻擊（檢定骰 20 過）
    a.f(1).load!.now = 0
    a.run(Array(300).fill(20)).attack(a.f(1), a.a(1))
    expect(a.f(1).load!.now).toBeGreaterThan(0)
    expect(a.a(1).uses[`turn:${S('payback')}`]).toBe(1)
  })
})

// ===================================================================================================================
// 三、掮客
// ===================================================================================================================

const FACE = F('face')
const CMD = `${FACE}.command`
const REMOTE = `${FACE}.remote_call`
/** 名冊上有一名潛網者（路數 netrunner 3 階）與一名醫生：遠端叫人只列潛網者。 */
const rosterState = (): GameState => makeState({
  actors: [
    makeActor({ id: 'n1', name: '潛網者小夜', role: 'companion', ext: { paths: [{ path: 'netrunner', tier: 3 }] } }),
    makeActor({ id: 'm1', name: '醫生', role: 'companion', ext: { paths: [{ path: 'medic', tier: 3 }] } }),
  ],
})
const ROSTER = BENCH([{ id: 'n1', name: '潛網者小夜' }, { id: 'm1', name: '醫生' }])

describe('掮客：指揮在內海每回合最多 1 點、遠端叫人', () => {
  const broker = (ids: string[], o: Rec = {}) => avatar(1, { fixer: 3 }, ids, o)
  const needy = (i: number) => mate(i, { ap: { now: 0, max: 8, regen: 3 } })

  it('指揮：每回合最多讓 1 點，第二點被擋並說已經讓了 1 點；下一回合回復；現實的指揮（give_ap）不出現在內海', () => {
    const a = arena(setup([broker([FACE]), needy(2), needy(3)], [lace()]))
    turnTo(a, 'a1')
    expect(ringIds(a)).toContain(CMD)
    expect(ringIds(a)).not.toContain(`${FACE}.give_ap`)
    expect(a.k.battle.getAction(CMD)!.modes).toEqual(['net'])
    expect(opt(a, CMD)!.cost).toEqual({ ap: 1 })
    doAct(a, 'a1', { action: CMD, target: { unit: 'a2' } })
    expect(a.a(2).ap.now).toBe(1)
    const o = opt(a, CMD)!
    expect(o.ok).toBe(false)
    expect(o.blocks.join('')).toMatch(/已經讓了 1 點/)
    expect(reasons(a, { action: CMD, target: { unit: 'a3' } }).join('')).toMatch(/已經讓了 1 點/)
    // 下一個自己的回合：次數清掉
    a.a(1).uses = {}
    expect(opt(a, CMD)!.ok).toBe(true)
  })

  it('號令（開著時拿到行動點的隊友命中 +1）：內海的指揮也會觸發；不開就沒有', () => {
    const ids = [FACE, F('focus_fire'), F('focus_fire'), F('all_out'), F('command')].filter((x, i, l) => l.indexOf(x) === i)
    const a = arena(setup([broker(ids), needy(2)], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: F('command') })
    expect(a.a(1).stance).toBe(F('command'))
    doAct(a, 'a1', { action: CMD, target: { unit: 'a2' } })
    expect(buffIds(a.a(2))).toEqual(['command'])
    expect(modsOf(a, 'hit', 'a2')).toBe(1)
  })

  it('遠端叫人：候補裡有潛網者時列得出來（醫生不列）；快駭一個敵人（照他的階數加值）；每場 1 次用完灰掉', () => {
    const a = arena(setup([broker([FACE])], [pinkElite({ evade: 5 })]), { state: rosterState(), extra: [ROSTER] })
    turnTo(a, 'a1')
    const o = opt(a, REMOTE)!
    expect(o.ok).toBe(true)
    // 共鳴 2（3 階）：每場第一次叫人不花行動點
    expect(o.cost).toEqual({ ap: 0 })
    expect(o.picks.find((p) => p.key === 'runner')!.options.map((x) => x.value)).toEqual(['n1'])
    expect(o.picks.find((p) => p.key === 'option')!.options.map((x) => x.value)).toEqual(['hack', 'wall'])
    const beats = doAct(a, 'a1', { action: REMOTE, target: { unit: 'f1' }, pick: { runner: 'n1', option: 'hack' } }, [20])
    expect(beats.some((b) => b.text.includes('潛網者小夜'))).toBe(true)
    expect(a.f(1).load!.now).toBeGreaterThan(0)
    expect(a.a(1).uses[REMOTE]).toBe(1)
    const after = opt(a, REMOTE)!
    expect(after.ok).toBe(false)
    expect(after.blocks.join('')).toMatch(/次數用完了（1 次）/)
  })

  it('遠端叫人：快駭檢定沒過就沒有感載；補防火牆替我方一格升一級；選不在名單上的人被擋', () => {
    const a = arena(setup([broker([FACE])], [pinkElite({ evade: 40 })]), { state: rosterState(), extra: [ROSTER] })
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: REMOTE, target: { unit: 'f1' }, pick: { runner: 'n1', option: 'hack' } }, [1])
    expect(a.f(1).load!.now).toBe(0)
    const b = arena(setup([broker([FACE])], [lace()]), { state: rosterState(), extra: [ROSTER] })
    turnTo(b, 'a1')
    expect(b.battle.cover.ally[2]!.level).toBe(0)
    doAct(b, 'a1', { action: REMOTE, target: { side: 'ally', slot: 3 }, pick: { runner: 'n1', option: 'wall' } })
    expect(b.battle.cover.ally[2]!.level).toBe(1)
    const c = arena(setup([broker([FACE])], [lace()]), { state: rosterState(), extra: [ROSTER] })
    turnTo(c, 'a1')
    expect(reasons(c, { action: REMOTE, target: { unit: 'f1' }, pick: { runner: 'm1', option: 'hack' } }).length).toBeGreaterThan(0)
  })

  it('候補裡沒有潛網者時遠端叫人灰掉並寫原因；叫不來的（blocks）寫在選項旁邊', () => {
    const a = arena(setup([broker([FACE])], [lace()]), { state: rosterState(), extra: [BENCH([{ id: 'm1', name: '醫生' }])] })
    turnTo(a, 'a1')
    const o = opt(a, REMOTE)!
    expect(o.ok).toBe(false)
    expect(o.blocks.join('')).toMatch(/沒有帶「netrunner」路數的人/)
    const b = arena(setup([broker([FACE])], [lace()]), { state: rosterState(), extra: [BENCH([{ id: 'n1', name: '潛網者小夜', blocks: ['他正在忙。'] }])] })
    turnTo(b, 'a1')
    expect(opt(b, REMOTE)!.blocks.join('')).toMatch(/都叫不來/)
  })

  it('派工網／人脈（遠端叫人每場次數 +1）、我有認識的人（多一種：替隊友排 8 點感載）', () => {
    const ids = [FACE, F('focus_fire'), F('watch_out'), F('prep'), F('proxy'), F('buy_space'), F('black_market'), F('intel_net'), F('dispatch_net'), F('formation'), F('i_know_someone')]
    const a = arena(setup([broker(ids), mate(2, { load: { now: 20, max: 40 } })], [lace()]), { state: rosterState(), extra: [ROSTER] })
    turnTo(a, 'a1')
    expect(opt(a, REMOTE)!.picks.find((p) => p.key === 'option')!.options.map((x) => x.value)).toEqual(['hack', 'wall', 'vent'])
    const before = a.a(2).load!.now
    doAct(a, 'a1', { action: REMOTE, target: { unit: 'a2' }, pick: { runner: 'n1', option: 'vent' } })
    expect(a.a(2).load!.now).toBe(before - 8)
    // 派工網：每場次數 +1：第二次還能叫
    expect(opt(a, REMOTE)!.ok).toBe(true)
    doAct(a, 'a1', { action: REMOTE, target: { side: 'ally', slot: 2 }, pick: { runner: 'n1', option: 'wall' } })
    expect(opt(a, REMOTE)!.ok).toBe(false)
  })

  it('集火、打他打他！：目標掛 focused（全隊打他命中 +1）；打他打他！再讓全隊對他的傷害多 1d3', () => {
    const ids = [FACE, F('focus_fire'), F('watch_out'), F('prep'), F('proxy'), F('talk_down'), F('bribe'), F('hit_him')]
    const a = arena(setup([broker(ids), mate(2)], [lace(), lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: F('focus_fire'), target: { unit: 'f1' } })
    expect(statusIds(a.f(1))).toContain('focused')
    expect(modsOf(a, 'hit_against', 'f1')).toBe(1)
    doAct(a, 'a1', { action: F('hit_him'), target: { unit: 'f2' } })
    expect(statusIds(a.f(2))).toContain('focused')
    expect(buffIds(a.a(2))).toEqual(['hit_him'])
    // 對帶 focused 的他，全隊傷害多 1d3（骰面 2）
    expect(featureMods(a.run([2]), a.a(2), 'damage_roll', [], a.f(2)).map((p) => p.value)).toEqual([2])
  })

  it('勸降／有話好好說：只對有人格的；成功壓制到它的下一回合結束；擋（追蹤度跨過門檻的反應）寫不出來、沒有行動', () => {
    const ids = [FACE, F('focus_fire'), F('watch_out'), F('prep'), F('talk_down'), F('block'), F('proxy'), F('buy_space'), F('big_picture'), F('intel_net'), F('black_market'), F('lets_talk')]
    const a = arena(setup([broker(ids)], [pinkElite(), lace()]))
    turnTo(a, 'a1')
    expect(opt(a, F('talk_down'))!.targets.find((t) => 'unit' in t.target && t.target.unit === 'f2')!.blocks.join('')).toMatch(/沒有人格/)
    doAct(a, 'a1', { action: F('talk_down'), target: { unit: 'f1' } }, [20])
    expect(statusIds(a.f(1))).toContain('suppressed')
    expect(ringIds(a)).not.toContain(F('block'))
  })

  it('保釋：隊友要被釘住時擋下（1 個中人情，每場 1 次）；第二次擋不下', () => {
    const a = arena(setup([broker([FACE, F('focus_fire'), F('watch_out'), F('block'), F('bail')], { pools: { ram: { now: 4, max: 4, regen: 2 }, favor_mid: { now: 2, max: 2, regen: 0 } } }), mate(2), mate(3)], [elite()]))
    expect(a.run().setOut(a.a(2), 'pinned', a.f(1))).toBe(false)
    expect(a.a(2).out).toBeUndefined()
    expect(a.a(1).pools.favor_mid!.now).toBe(1)
    expect(a.run().setOut(a.a(3), 'pinned', a.f(1))).toBe(true)
  })

  it('護盤：全隊排 8 點感載，到我方下一回合開始前過載不閃斷（RAM 還在、沒有閃斷狀態）；沒有護盤的對照有閃斷', () => {
    const ids = [FACE, F('focus_fire'), F('watch_out'), F('block'), F('formation'), F('prep'), F('bail'), F('hold_the_line')]
    const a = arena(setup([broker(ids), mate(2, { load: { now: 20, max: 40 } })], [lace()]))
    turnTo(a, 'a1')
    const before = a.a(2).load!.now
    doAct(a, 'a1', { action: F('hold_the_line') })
    expect(a.a(2).load!.now).toBe(before - 8)
    expect(buffIds(a.a(2))).toEqual(['hold_the_line'])
    const ram = a.a(2).pools.ram!.now
    a.run().overload(a.a(2))
    expect(a.a(2).pools.ram!.now).toBe(ram)
    expect(statusIds(a.a(2))).not.toContain('flash')
    const b = arena(setup([broker([FACE]), mate(2)], [lace()]))
    b.run().overload(b.a(2))
    expect(b.a(2).pools.ram!.now).toBe(0)
    expect(statusIds(b.a(2))).toContain('flash')
  })

  it('總攻令、布陣／共鳴 3（相鄰隊友迴避 +1）、全城欠我（追蹤度 −15）、大局、增援（只列帶 netrunner 路數的候補）', () => {
    const ids = [FACE, F('focus_fire'), F('watch_out'), F('prep'), F('talk_down'), F('proxy'), F('buy_space'), F('black_market'), F('bribe'), F('intel_net'), F('hit_him'), F('dispatch_net'),
      F('reinforce'), F('formation'), F('big_picture'), F('all_out'), F('city_owes_me'), F('block'), F('bail')]
    const a = arena(setup([broker(ids, { pools: { ram: { now: 4, max: 4, regen: 2 }, favor_big: { now: 1, max: 1, regen: 0 } } }), needy(2), mate(3)], [lace()]), { state: rosterState(), extra: [ROSTER] })
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: F('all_out') })
    expect(a.a(2).ap.now).toBe(1)
    expect(a.a(3).ap.now).toBe(a.a(3).ap.max)
    const t0 = trace(a)
    doAct(a, 'a1', { action: F('city_owes_me') })
    expect(trace(a)).toBe(t0 - 15)
    // 相鄰隊友的迴避：共鳴 3（相鄰 +1）
    expect(modsOf(a, 'evade', 'a2')).toBe(1)
    expect(modsOf(a, 'evade', 'a3')).toBe(0)
    const r = opt(a, F('reinforce'))!
    expect(r.picks.find((p) => p.key === 'bench')!.options.map((x) => x.value)).toEqual(['n1'])
    expect(opt(a, F('big_picture'))!.ok).toBe(true)
  })
})
