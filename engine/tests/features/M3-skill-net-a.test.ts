// 驗收測試：dev/work/M3-skill-net-a.md（cpp-feature）。槍手、潛網者、改造師、機師四棵樹的內海欄逐條寫成測試用的資料（tests/fixtures/skills），
// 證明格式寫得出來、每棵樹挑代表的幾個在內海戰鬥（真的 features/netcombat、features/summons、features/hack）裡打一次，數字對設計書。
// 另外三件事：衍生數值 master_tier 與 netrun 的 masterTier、技能格式收 trace 鍵（兩欄）與快駭讀它、技能「超頻」的骰數公式。
// 規格：SKILL_TREES「槍手：戰鬥直覺」「潛網者：主控」「改造師：手術刀」「機師：編隊」的內海欄；CYBERSPACE 第 5、6.3～6.6 節；ITEMS 11.7 節；dev/adr/0018 N27、N33。
// 骰面：用 fixDice 釘死（第一顆是檢定的 d20），內容都是測試自帶的最小假資料（技能資料在 tests/fixtures/skills）。

import { describe, expect, it } from 'vitest'
import type { BattleInput, BattleOptions, BattleSetup, BattleUnit, ContentPack, Feature, GameState, Kernel, TimelineBeat } from '../../src'
import { BattleBlocked, BattleRun, advance, battleAct, battleOptions, beginTurn, clone, createKernel, performAction, readyFeatures, setupBattle } from '../../src'
import { MASTER_TIER_STAT, abilitiesFeature, allocOf, masterTierOf } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { deckFeature } from '../../src/features/deck'
import { enemiesFeature } from '../../src/features/enemies'
import { exploreFeature } from '../../src/features/explore'
import { hackFeature, traceOfAction } from '../../src/features/hack'
import { adminLeft, netcombatFeature } from '../../src/features/netcombat'
import { ACT_NET, masterTier, netExt, netrunFeature, readRun, useNode } from '../../src/features/netrun'
import { pickAdmin } from '../../src/features/netrun/checks'
import { summonsFeature } from '../../src/features/summons'
import { TEST_ACTIVITY, TEST_NET_COMBAT, fixDice, laceUnit, makeActor, makeGame, makeState, netAvatar, netWeapon } from '../../src/testkit'
import { NET_TREES, netPack } from '../fixtures/skills'
import type { Tree } from '../fixtures/skills'
import { TEST_STATUSES } from '../helpers/battle'

type Rec = Record<string, unknown>

// ===================================================================================================================
// 假資料與場地
// ===================================================================================================================

const SKILLS = [
  { id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' },
  { id: 'interface', name: '介面', attr: 'intellect', desc: '介面。' }, { id: 'sync', name: '同步', attr: 'resolve', desc: '同步。' },
  { id: 'composure', name: '定力', attr: 'resolve', desc: '定力。' },
]
const JAM_STATUSES = (['weapon', 'defense', 'tool'] as const).map((s) => ({ id: `jam_${s}`, name: `${s}構裝停用`, desc: `一類構裝（${s}）被干擾，停用一回合。`, until: 'own_turn_end', turns: 1, kind: 'debuff' }))
const RULES: ContentPack = { id: 'skill_net_a_rules', content: { skill: SKILLS, battle_status: [...TEST_STATUSES, ...JAM_STATUSES] } } as unknown as ContentPack
const pack = (trees?: Tree[]): ContentPack => netPack(trees) as unknown as ContentPack
const FEATURES: Feature[] = [combatFeature, deckFeature, netcombatFeature, hackFeature, summonsFeature, abilitiesFeature]

const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], ...o })
const DECK = () => ({ grade: 2, firewall: 12, slots: [] as string[], constructs: [] as unknown[] })
const equip = (tiers: Record<string, number>, ...ids: string[]) => ({ abilities: { equipped: ids, tiers } })
/** 內海的我：有甲板（才有 RAM）、行動點很多、技能照 ids 裝著。 */
const avatar = (i: number, tiers: Record<string, number>, ids: string[], o: Rec = {}) =>
  netAvatar(i, 1, { ap: { now: 20, max: 20, regen: 3 }, skills: { interface: 4, composure: 2 }, ext: { ...equip(tiers, ...ids), net: NET(), deck: DECK() }, ...o } as never)
const lace = (o: Rec = {}) => laceUnit('minion', 1, { evade: 0, ap: { now: 0, max: 0, regen: 0 }, ext: { net: NET(), deck: DECK() }, ...o } as never)
const elite = (o: Rec = {}) => laceUnit('elite', 1, { evade: 0, ap: { now: 0, max: 0, regen: 0 }, ext: { net: NET(), deck: DECK() }, ...o } as never)
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
/** 不經過提交的內海戰鬥：state.battle 就是 arena.battle，行動直接改它。 */
function arena(s: BattleSetup, o: { trees?: Tree[]; seed?: number } = {}): Arena {
  const k = createKernel(FEATURES)
  k.content.loadPack(RULES)
  k.content.loadPack(pack(o.trees))
  readyFeatures(k)
  const state = makeState()
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
}
const modsOf = (a: Arena, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = [], other?: BattleUnit): number => {
  const r = a.run()
  return r.mods(kind, r.unit(id), other, undefined, tags).reduce((s, p) => s + p.value, 0)
}
/** 記下每一次擲骰（顆數與面數），再照原本的骰面出。 */
function spyRolls(run: BattleRun): Array<[number, number]> {
  const seen: Array<[number, number]> = []
  const roll = run.roll.bind(run)
  run.roll = (count, sides) => {
    seen.push([count, sides])
    return roll(count, sides)
  }
  return seen
}
const statusIds = (u: BattleUnit): string[] => u.statuses.map((s) => s.id)
const buffIds = (u: BattleUnit): string[] => ((u.ext.abilities as Rec).buffs as Array<{ id: string }> | undefined ?? []).map((b) => b.id)

const ALL: Tree[] = Object.values(NET_TREES)
const IDS = (t: Tree): string[] => t.abilities.map((x) => x.id as string)

// ===================================================================================================================
// 一、四棵樹的資料全部載得進來
// ===================================================================================================================

describe('四棵樹的內海欄資料：格式檢查過、用到的效果都查得到', () => {
  it.each(Object.entries(NET_TREES))('%s：27 個技能與 5 個共鳴載得進來，對照表涵蓋每一個技能', (_name, tree) => {
    const k = createKernel(FEATURES)
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
    // 現實欄與輿論欄一律是 null（現實的資料在 M1b 的測試裡）
    for (const ab of tree.abilities) {
      expect(ab.meat, String(ab.id)).toBeNull()
      expect(ab.opinion, String(ab.id)).toBeNull()
    }
  })

  it('四棵樹放在同一份內容包裡也載得進來（id 不撞）；內海欄是「—」的 net 是 null，寫不出來的標 pending 並留原文', () => {
    const k = createKernel(FEATURES)
    k.content.loadPack(RULES)
    k.content.loadPack(pack(ALL))
    readyFeatures(k)
    expect(new Set(ALL.flatMap(IDS)).size).toBe(108)
    for (const t of ALL) {
      for (const n of t.notes) {
        const ab = t.abilities.find((x) => x.id === n.id)!
        if (n.text === '—') expect(ab.net, n.id).toBeNull()
        else if (n.status === 'none' || n.status === 'wait') expect(ab.net as Rec, n.id).toMatchObject({ pending: true })
        else expect(ab.net, n.id).not.toBeNull()
      }
    }
  })

  it('壞掉的內海欄照樣被擋（資料不是空殼）：不認得的效果、花全部 RAM 以外的 attack.spend、passive 以外的 net.action', () => {
    const load = (patch: Rec) => () => {
      const k = createKernel(FEATURES)
      k.content.loadPack(RULES)
      const t = clone(NET_TREES.gunner!)
      const i = t.abilities.findIndex((x) => x.id === 'sk_gunner_back_off')
      t.abilities[i] = { ...t.abilities[i], ...patch }
      k.content.loadPack(pack([t]))
    }
    expect(load({ net: { target: 'enemy', do: [{ op: 'ghost' }] } })).toThrow(/net\.do.*ghost/)
    expect(load({ net: { target: 'enemy', attack: { spend: 2 } } })).toThrow(/net\.attack\.spend 在內海沒有意義/)
    expect(load({ net: { target: 'enemy', action: true, do: [{ op: 'attack' }] } })).toThrow(/net\.action 只有被動/)
    expect(load({ use: { net: { ap: 1, weapon_ram: 1 } }, net: { target: 'enemy', do: [{ op: 'attack' }] } })).toThrow(/weapon_ram/)
    expect(load({ net: { target: 'enemy', trace: 0, do: [{ op: 'attack' }] } })).toThrow(/net\.trace/)
    expect(load({ net: { trigger: { on: 'overload', who: 'self' }, react: { flash: { ram: 'all' } } } })).toThrow(/flash\.ram/)
  })

  it('這一張新加的鍵：格式不對的擋下（instinct 的物件寫法、trigger.tag、react.damage、react.flash、suppress.first_round、花全部 RAM 才能寫的 attack 鍵）', () => {
    const load = (ab: Rec) => () => {
      const k = createKernel(FEATURES)
      k.content.loadPack(RULES)
      const t = clone(NET_TREES.gunner!)
      t.abilities.push({ id: 'sk_gunner_x', name: 'x', path: 'gunner', category: 'meat', tier: 1, layer: 'front', kind: 'active', cap: 1, xp: 20, cells: 1, after: 'sk_gunner_instinct', text: 'x。', meat: null, net: null, opinion: null, ...ab })
      k.content.loadPack(pack([t]))
    }
    const act = (net: Rec, use: Rec = { ap: 1 }) => ({ use: { net: use }, net: { target: 'enemy', ...net } })
    expect(load(act({ do: [{ op: 'attack' }] }))).not.toThrow()
    expect(load({ kind: 'passive', net: { instinct: { div: 0, only: ['hit'], fixed: true } } })).toThrow(/net\.instinct\.div/)
    expect(load({ kind: 'passive', net: { instinct: { div: 3, only: ['luck'], fixed: true } } })).toThrow(/net\.instinct\.only/)
    expect(load({ kind: 'passive', net: { instinct: { div: 3, only: ['hit'] } } })).toThrow(/net\.instinct\.fixed/)
    expect(load({ kind: 'passive', meat: { instinct: { div: 3, only: ['hit'], fixed: true } } })).toThrow(/meat\.instinct 的物件寫法是內海欄的/)
    expect(load({ kind: 'reaction', use: { net: { ap: 1 } }, net: { trigger: { on: 'overload', who: 'self', tag: 'overclock' }, react: { flash: { ram: 'half' } } } })).toThrow(/trigger\.tag 只有 attacked、hit、after/)
    expect(load({ kind: 'reaction', use: { net: { ap: 1 } }, net: { trigger: { on: 'attacked', who: 'self' }, react: { damage: 'not a formula!' } } })).toThrow(/react\.damage/)
    expect(load({ kind: 'reaction', use: { net: { ap: 1 } }, net: { trigger: { on: 'overload', who: 'self' }, react: { flash: {} } } })).toThrow(/flash 要寫 ram 或 end/)
    expect(load({ kind: 'reaction', use: { net: { ap: 1 } }, net: { trigger: { on: 'attacked', who: 'self' }, react: { flash: { ram: 'half' } } } })).toThrow(/react\.flash 不能用在 attacked/)
    expect(load(act({ attack: { suppress: { dc: 12, skill: 'composure', first_round: true } } }, { ap: 1, ram_all_min: 2 }))).toThrow(/suppress\.first_round 只有 auto 用/)
    // 花全部 RAM 的技能才能寫彈匣的花法與壓制；min_mag、free_mag 還是不行
    expect(load(act({ attack: { spend: 'all', dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } }, { ap: 1, ram_all_min: 2 }))).not.toThrow()
    expect(load(act({ attack: { spend: 'all', min_mag: 2 } }, { ap: 1, ram_all_min: 2 }))).toThrow(/net\.attack\.min_mag/)
    expect(load(act({ attack: { spend: 3 } }, { ap: 1, ram_all_min: 2 }))).toThrow(/net\.attack\.spend/)
    expect(load(act({ attack: { spend: 'all' } }))).toThrow(/net\.attack\.spend/)
    // 壓制姿態（auto）不花彈匣：不是花全部 RAM 的技能也行
    expect(load({ kind: 'stance', use: { net: { ap: 1 } }, net: { attack: { suppress: { auto: true, first_round: true } } } })).not.toThrow()
  })

  it('標 pending 的技能（構裝體、寫不出來的）裝得上、沒有效果、不出現在圓環上', () => {
    const ids = ['sk_pilot_formation', 'sk_pilot_assault', 'sk_pilot_valkyrie', 'sk_netrunner_master', 'sk_netrunner_puppet', 'sk_medic_pull_back', 'sk_medic_chief_surgeon']
    const a = arena(setup([avatar(1, { pilot: 5, netrunner: 5, medic: 5 }, ids)], [lace()]))
    turnTo(a, 'a1')
    const ring = ringIds(a)
    for (const id of ['sk_pilot_assault', 'sk_pilot_valkyrie', 'sk_netrunner_puppet', 'sk_medic_pull_back']) expect(ring, id).not.toContain(id)
    // 沒有效果：構裝體的被動沒有給修正、主控以外的 pending 沒有標籤
    expect(modsOf(a, 'hit', 'a1')).toBe(0)
    expect(modsOf(a, 'evade', 'a1')).toBe(0)
    // 沒有 pending 的部分照樣生效：編隊的標籤、主控的管理行動
    expect(a.a(1).tags).toContain('drone_link')
    expect(a.a(1).tags).toContain('admin')
  })
})

// ===================================================================================================================
// 二、槍手
// ===================================================================================================================

describe('槍手：戰鬥直覺的內海版', () => {
  it('4 階分 2 點、只在命中與迴避；沒有先攻、沒有重分配的行動；點數不夠上限的整場不變', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = arena(setup([avatar(1, { gunner: 4 }, ['sk_gunner_instinct'])], [lace()]), { trees: [NET_TREES.gunner!] })
      a.state.rng = { seed, cursor: 0 } as never
      // 每個種子各自分配一次（分配記在單位上，開打時定下來）：換種子要重開
      const b = arena(setup([avatar(1, { gunner: 4 }, ['sk_gunner_instinct'])], [lace()]), { trees: [NET_TREES.gunner!] })
      b.state.rng = a.state.rng
      const got = allocOf(a.run(), a.a(1))!
      expect(got.points).toBe(2)
      expect(got.alloc.initiative).toBe(0)
      expect(got.alloc.hit + got.alloc.evade).toBe(2)
      // 修正：命中 +1／迴避 +1 照點數
      expect(modsOf(a, 'hit', 'a1')).toBe(got.alloc.hit)
      expect(modsOf(a, 'evade', 'a1')).toBe(got.alloc.evade)
      // 先攻只剩共鳴 1 的 +3（戰鬥直覺的分配沒有先攻）
      expect(modsOf(a, 'initiative', 'a1')).toBe(3)
    }
    const a = arena(setup([avatar(1, { gunner: 4 }, ['sk_gunner_instinct'])], [lace()]), { trees: [NET_TREES.gunner!] })
    turnTo(a, 'a1')
    expect(ringIds(a).some((id) => id.includes('realloc'))).toBe(false)
    const before = clone(a.a(1).ext.instinct)
    doAct(a, 'a1', { action: 'net_refill' })
    expect(a.a(1).ext.instinct).toEqual(before)
  })

  it('點數是階數 ÷ 3 進位：1～3 階 1 點、4～6 階 2 點；每一項最多 3 點；共鳴 5（點數 +1）內海也算', () => {
    const points = (tier: number) => {
      const a = arena(setup([avatar(1, { gunner: tier }, ['sk_gunner_instinct'])], [lace()]), { trees: [NET_TREES.gunner!] })
      return allocOf(a.run(), a.a(1))!.points
    }
    // 5 階：階數 ÷ 3 進位是 2，共鳴 5（戰鬥直覺的點數 +1）不分戰場，內海也算：3
    expect([1, 2, 3, 4, 5].map(points)).toEqual([1, 1, 1, 2, 3])
    // 分出去的總數等於點數、每一項不超過 3、沒有先攻
    const a = arena(setup([avatar(1, { gunner: 5 }, ['sk_gunner_instinct'])], [lace()]), { trees: [NET_TREES.gunner!] })
    const alloc = allocOf(a.run(), a.a(1))!.alloc
    expect(alloc.hit + alloc.evade).toBe(3)
    expect(alloc.initiative).toBe(0)
    expect(Math.max(alloc.hit, alloc.evade)).toBeLessThanOrEqual(3)
  })

  it('心流：三回合戰鬥直覺的點數 +1，多的一點隨機放進命中或迴避（記在單位上），到期之後拿掉；整場不能重分配', () => {
    const a = arena(setup([avatar(1, { gunner: 4 }, ['sk_gunner_instinct', 'sk_gunner_flow'])], [lace()]), { trees: [NET_TREES.gunner!] })
    turnTo(a, 'a1')
    const before = allocOf(a.run(), a.a(1))!
    expect(before.points).toBe(2)
    doAct(a, 'a1', { action: 'sk_gunner_flow' })
    expect(buffIds(a.a(1))).toEqual(['flow'])
    const during = allocOf(a.run(), a.a(1))!
    expect(during.points).toBe(3)
    expect(during.alloc.hit + during.alloc.evade).toBe(3)
    expect(during.alloc.initiative).toBe(0)
    // 原本分到的不會被拿走（只多放一點）
    expect(during.alloc.hit).toBeGreaterThanOrEqual(before.alloc.hit)
    expect(during.alloc.evade).toBeGreaterThanOrEqual(before.alloc.evade)
    // 每場一次
    expect(opt(a, 'sk_gunner_flow')!.ok).toBe(false)
    expect(opt(a, 'sk_gunner_flow')!.blocks.join('')).toMatch(/用過了/)
  })
})

describe('槍手：瞄準過的攻擊、超頻、死線與只在第一回合的幾個', () => {
  const gunner = (ids: string[], o: Rec = {}) => avatar(1, { gunner: 3 }, ids, o)

  it('要害射擊：3 行動點加武器構裝的 1 點 RAM；命中比普通的攻擊多 3；打出要害時目標破損（精英以上）', () => {
    const a = arena(setup([gunner(['sk_gunner_aimed_shot'])], [elite({ evade: 8 })]))
    turnTo(a, 'a1')
    const o = opt(a, 'sk_gunner_aimed_shot')!
    expect(o.cost).toEqual({ ap: 3, ram: 1 })
    expect(a.k.battle.getAction('sk_gunner_aimed_shot')!.modes).toEqual(['net'])
    // 命中率：比普通的攻擊多 3
    const view = a.run()
    const w = a.a(1).weapons[0]!
    const plain = view.hitChance(a.a(1), a.f(1), w, {})
    const aimed = view.hitChance(a.a(1), a.f(1), w, { aimed: true })
    expect(aimed - plain).toBeGreaterThan(0)
    expect(view.hitParts(a.a(1), a.f(1), w, { aimed: true }).find((p) => p.source === 'aim')!.value).toBe(a.run().n.aimedHit)
    // 沒有部位可以選（部位是現實的重創）
    expect(o.picks.map((p) => p.key)).not.toContain('part')
    // 自然 20、打得中的要害：精英破損（傷害骰少一顆，或構裝破損）；RAM 扣 1
    const ram = a.a(1).pools.ram!.now
    const beats = doAct(a, 'a1', { action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } }, [20])
    expect(a.a(1).pools.ram!.now).toBe(ram - 1)
    expect(a.a(1).ap.now).toBe(a.a(1).ap.max - 3)
    expect(beats.some((b) => b.tag === 'crit' || b.tag === 'hit')).toBe(true)
    expect(beats.filter((b) => b.tag === 'break')).toHaveLength(1)
    expect((a.f(1).ext.net as Rec).dice_loss ?? (a.f(1).ext.net as Rec).broken).toBeTruthy()
  })

  it('定點射：每場 1 次，要害射擊只花 2 行動點（第二次回到 3）', () => {
    const a = arena(setup([gunner(['sk_gunner_aimed_shot', 'sk_gunner_point_shot'])], [elite()]))
    turnTo(a, 'a1')
    expect(opt(a, 'sk_gunner_aimed_shot')!.cost).toEqual({ ap: 2, ram: 1 })
    doAct(a, 'a1', { action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } }, [15])
    expect(a.a(1).ap.now).toBe(a.a(1).ap.max - 2)
    a.a(1).ap.now = a.a(1).ap.max
    expect(opt(a, 'sk_gunner_aimed_shot')!.cost).toEqual({ ap: 3, ram: 1 })
  })

  it('連射控制：花掉手上全部的 RAM（至少 2），傷害骰多（花掉的 RAM − 1）顆，自帶壓制（定力對 10＋花掉的 RAM×2）', () => {
    const base = (() => {
      const a = arena(setup([gunner(['sk_gunner_burst'])], [lace()]))
      return a.a(1).weapons[0]!.dice
    })()
    for (const ram of [2, 4, 5]) {
      const a = arena(setup([gunner(['sk_gunner_burst'], { pools: { ram: { now: ram, max: 6, regen: 2 } } })], [lace()]))
      turnTo(a, 'a1')
      expect(opt(a, 'sk_gunner_burst')!.cost).toEqual({ ap: 3, ram })
      const run = a.run([15, ...FILL])
      const seen = spyRolls(run)
      performAction(run, run.unit('a1'), a.k.battle.getAction('sk_gunner_burst')!, { unit: 'f1' }, { action: 'sk_gunner_burst', target: { unit: 'f1' } })
      expect(a.a(1).pools.ram!.now).toBe(0)
      // 傷害骰：武器原本的顆數加（花掉的 RAM − 1）顆，打出要害再多一顆（命中 15 對迴避 0 是要害）
      const d6 = seen.filter(([, sides]) => sides === 6).reduce((s, [n]) => s + n, 0)
      const crit = run.beats.some((b) => b.tag === 'crit') ? 1 : 0
      expect(d6, `RAM ${ram}`).toBe(base + (ram - 1) + crit)
      // 壓制：DC 是 10＋花掉的 RAM×2；骰面 3 加上定力的修正不到，壓制上身
      expect(statusIds(a.f(1))).toContain('suppressed')
    }
  })

  it('連射控制：RAM 不到 2 灰掉；淺檔灰掉並寫「淺檔」「超頻」；火力牆（每場 1 次）壓制同時打到相鄰的一格', () => {
    const a = arena(setup([gunner(['sk_gunner_burst', 'sk_gunner_fire_wall', 'sk_gunner_barrage'], { pools: { ram: { now: 1, max: 6, regen: 2 } } })], [lace(), lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'sk_gunner_burst')!.ok).toBe(false)
    expect(opt(a, 'sk_gunner_burst')!.blocks.join('')).toMatch(/2 點以上的 RAM/)
    a.a(1).pools.ram!.now = 4
    expect(opt(a, 'sk_gunner_burst')!.ok).toBe(true)
    setGear(a.a(1), 'shallow')
    const o = opt(a, 'sk_gunner_burst')!
    expect(o.ok).toBe(false)
    expect(o.blocks.join('')).toMatch(/淺檔.*超頻/)
    expect(reasons(a, { action: 'sk_gunner_burst', target: { unit: 'f1' } }).join('')).toMatch(/淺檔/)
    expect(opt(a, 'sk_gunner_fire_wall')!.blocks.join('')).toMatch(/淺檔.*超頻/)
    setGear(a.a(1), 'standard')
    // 火力牆：目標 f1 和相鄰的 f2 都要檢定（骰面 3：都被壓制）
    doAct(a, 'a1', { action: 'sk_gunner_fire_wall', target: { unit: 'f1' } }, [15])
    expect(statusIds(a.f(1))).toContain('suppressed')
    expect(statusIds(a.f(2))).toContain('suppressed')
    // 每場一次
    a.a(1).pools.ram!.now = 4
    expect(opt(a, 'sk_gunner_fire_wall')!.blocks.join('')).toMatch(/用過了/)
  })

  it('彈幕開著：超頻自帶壓制的 DC +1（DC 剛好卡在定力檢定上的那一格：沒開彈幕會過、開了不過）', () => {
    // 對方定力檢定：d20 ＋ mod(意志) ＋ 定力。雜兵 composure 0、意志 10（mod 0）：骰 16 對 DC 18 不過；對 DC 17（RAM 3.5）沒有這種事，換 RAM 3：DC 16，骰 16 過
    const run = (barrage: boolean) => {
      const ids = ['sk_gunner_burst', ...(barrage ? ['sk_gunner_barrage'] : [])]
      const a = arena(setup([gunner(ids, { pools: { ram: { now: 3, max: 6, regen: 2 } } })], [lace()]))
      turnTo(a, 'a1')
      if (barrage) doAct(a, 'a1', { action: 'sk_gunner_barrage' })
      turnTo(a, 'a1')
      a.a(1).pools.ram!.now = 3
      // 命中 15；傷害骰（顆數不定）全用 3；最後一顆 d20 是定力檢定 16：先把前面的骰面補齊
      const seenRun = a.run([15, ...Array(40).fill(3)])
      const dice: number[] = []
      const rollBase = seenRun.roll.bind(seenRun)
      seenRun.roll = (count, sides) => {
        const v = rollBase(count, sides)
        // 定力檢定是第二次的 d20：把它換成 16
        if (sides === 20 && dice.length > 0) return [16]
        if (sides === 20) dice.push(1)
        return v
      }
      performAction(seenRun, seenRun.unit('a1'), a.k.battle.getAction('sk_gunner_burst')!, { unit: 'f1' }, { action: 'sk_gunner_burst', target: { unit: 'f1' } })
      return statusIds(a.f(1)).includes('suppressed')
    }
    expect(run(false)).toBe(false)
    expect(run(true)).toBe(true)
  })

  it('死線：第一次過載閃斷只讓 RAM 減半（進位），第二次照常歸零；閃斷的狀態還在', () => {
    const a = arena(setup([gunner(['sk_gunner_deadline'], { pools: { ram: { now: 5, max: 6, regen: 2 } } })], [lace()]))
    const run = a.run()
    run.overload(a.a(1))
    expect(a.a(1).pools.ram!.now).toBe(3)
    expect(statusIds(a.a(1))).toContain('flash')
    expect(a.a(1).uses.sk_gunner_deadline).toBe(1)
    a.a(1).pools.ram!.now = 5
    a.run().overload(a.a(1))
    expect(a.a(1).pools.ram!.now).toBe(0)
    // 沒裝死線的對照：第一次就歸零
    const b = arena(setup([gunner([], { pools: { ram: { now: 5, max: 6, regen: 2 } } })], [lace()]))
    b.run().overload(b.a(1))
    expect(b.a(1).pools.ram!.now).toBe(0)
  })

  it('看我的！：只在第一回合、每場 1 次；第一次攻擊命中 +1（打完之後沒有了）', () => {
    const a = arena(setup([gunner(['sk_gunner_watch_me'])], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_gunner_watch_me' })
    expect(buffIds(a.a(1))).toEqual(['watch_me'])
    expect(modsOf(a, 'hit', 'a1')).toBe(1)
    expect(opt(a, 'sk_gunner_watch_me')!.blocks.join('')).toMatch(/用過了/)
    doAct(a, 'a1', { action: 'net_attack', target: { unit: 'f1' } }, [15])
    expect(modsOf(a, 'hit', 'a1')).toBe(0)
    // 第二回合不能用
    const b = arena(setup([gunner(['sk_gunner_watch_me'])], [lace()]))
    b.battle.round = 2
    turnTo(b, 'a1')
    expect(opt(b, 'sk_gunner_watch_me')!.blocks.join('')).toMatch(/第一回合/)
  })

  it('壓制姿態：只在第一回合，第一次攻擊命中的目標直接得到壓制；第二回合起不會', () => {
    const a = arena(setup([gunner(['sk_gunner_suppress_stance'])], [lace(), lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_gunner_suppress_stance' })
    expect(a.a(1).stance).toBe('sk_gunner_suppress_stance')
    doAct(a, 'a1', { action: 'net_attack', target: { unit: 'f1' } }, [15])
    expect(statusIds(a.f(1))).toContain('suppressed')
    a.battle.round = 2
    a.a(1).uses = {}
    doAct(a, 'a1', { action: 'net_attack', target: { unit: 'f2' } }, [15])
    expect(statusIds(a.f(2))).not.toContain('suppressed')
  })

  it('點放：每場第一次超頻之後回 1 RAM；獵殺節奏：打出要害回 1 RAM，每場最多 2 次', () => {
    const a = arena(setup([gunner(['sk_gunner_burst', 'sk_gunner_tap'], { pools: { ram: { now: 4, max: 8, regen: 2 } } })], [lace(), lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_gunner_burst', target: { unit: 'f1' } }, [15])
    expect(a.a(1).pools.ram!.now).toBe(1)
    expect(a.a(1).uses.sk_gunner_tap).toBe(1)
    // 第二次超頻不再回
    a.a(1).pools.ram!.now = 4
    a.a(1).ap.now = 20
    doAct(a, 'a1', { action: 'sk_gunner_burst', target: { unit: 'f2' } }, [15])
    expect(a.a(1).pools.ram!.now).toBe(0)
    // 普通攻擊不算超頻：不回
    const b = arena(setup([gunner(['sk_gunner_tap'], { pools: { ram: { now: 4, max: 8, regen: 2 } } })], [lace()]))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'net_attack', target: { unit: 'f1' } }, [15])
    expect(b.a(1).pools.ram!.now).toBe(3)
    // 獵殺節奏：精英被打出要害（瞄準的 + 自然 20）
    const c = arena(setup([gunner(['sk_gunner_aimed_shot', 'sk_gunner_kill_rhythm'], { pools: { ram: { now: 3, max: 8, regen: 2 } } })], [elite()]))
    turnTo(c, 'a1')
    doAct(c, 'a1', { action: 'sk_gunner_aimed_shot', target: { unit: 'f1' } }, [20])
    expect(c.a(1).pools.ram!.now).toBe(3)
  })

  it('構裝精通：每場 1 次換構裝不花行動點；穿透、跑位射擊、走開啦的每場一次照常', () => {
    const a = arena(setup([gunner(['sk_gunner_loadout_mastery', 'sk_gunner_pierce', 'sk_gunner_back_off'])], [lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'net_swap')?.cost?.ap ?? 0).toBe(0)
    doAct(a, 'a1', { action: 'sk_gunner_pierce', target: { unit: 'f1' } }, [15])
    expect(opt(a, 'sk_gunner_pierce')!.blocks.join('')).toMatch(/用過了/)
    expect(opt(a, 'sk_gunner_pierce')!.cost).toEqual({ ap: 2, ram: 1 })
    doAct(a, 'a1', { action: 'sk_gunner_back_off', target: { unit: 'f1' } }, [15])
    expect(opt(a, 'sk_gunner_back_off')!.blocks.join('')).toMatch(/用過了/)
  })
})

// ===================================================================================================================
// 三、潛網者
// ===================================================================================================================

const NR_ALL = IDS(NET_TREES.netrunner!)
describe('潛網者：主控 3 階', () => {
  const master = (ids: string[] = ['sk_netrunner_master'], o: Rec = {}, tier = 3) => avatar(1, { netrunner: tier }, ids, o)

  it('管理行動每回合 3 次、RAM 上限 +3、每回合回復 +1、回填回 3、管理行動的檢定 +2、標籤 admin', () => {
    const plain = arena(setup([avatar(1, { netrunner: 3 }, [])], [lace()]))
    const a = arena(setup([master()], [lace()]))
    const p = plain.a(1).pools.ram!
    const m = a.a(1).pools.ram!
    // 招牌的 +3，加上共鳴 3 階的 +1（共鳴不分戰場）
    expect(m.max).toBe(p.max + 3 + 1)
    expect(m.regen).toBe(p.regen + 1)
    expect(a.a(1).tags).toContain('admin')
    expect(plain.a(1).tags).not.toContain('admin')
    expect((a.a(1).ext.net as Rec).admin).toBe(3)
    expect(adminLeft(a.run(), a.a(1))).toBe(3)
    // 管理行動的檢定 +⌈3÷2⌉ = 2（只有帶 admin 標籤的檢定），再加共鳴 1 階的介面檢定 +2
    expect(modsOf(a, 'save', 'a1', ['admin'])).toBe(2 + 2)
    expect(modsOf(a, 'save', 'a1', [])).toBe(0)
    // 回填：基本 2 點，主控 +1 是 3 點
    turnTo(a, 'a1')
    m.now = 1
    doAct(a, 'a1', { action: 'net_refill' })
    expect(m.now).toBe(4)
    // 階數看樹：1 階 1 次、5 階 5 次，檢定加值 1 與 3（加共鳴 1 階的 +2）
    for (const [tier, uses, bonus] of [[1, 1, 1], [2, 2, 1], [4, 4, 2], [5, 5, 3]] as const) {
      const b = arena(setup([master(['sk_netrunner_master'], {}, tier)], [lace()]))
      expect(adminLeft(b.run(), b.a(1)), `${tier} 階`).toBe(uses)
      expect(modsOf(b, 'save', 'a1', ['admin']), `${tier} 階`).toBe(bonus + 2)
    }
  })

  it('每回合三次管理行動：做了三次之後第四次灰掉（寫出「3 次」）；下一回合又有；擦痕跡的檢定吃主控的加值', () => {
    const a = arena(setup([master()], [lace()]))
    turnTo(a, 'a1')
    for (let i = 0; i < 3; i++) doAct(a, 'a1', { action: 'adm_wipe' }, [20])
    expect(a.a(1).uses['turn:admin']).toBe(3)
    expect(opt(a, 'adm_wipe')!.blocks.join('')).toContain('3 次')
    beginTurn(a.run(), a.a(1))
    expect(opt(a, 'adm_wipe')!.blocks).toEqual([])
    // 檢定：智識 0＋介面 2＋主控 2＋共鳴 2 對 DC 10：骰 4 剛好過（4+2+2+2=10），骰 3 差一點
    const roll = (natural: number) => {
      const b = arena(setup([master(['sk_netrunner_master'], { skills: { interface: 2, composure: 2 } })], [lace()]), { seed: 1 })
      turnTo(b, 'a1')
      const beats = doAct(b, 'a1', { action: 'adm_wipe' }, [natural])
      return beats.find((x) => x.tag === 'admin' && (x.data as Rec).admin === 'wipe')!.data as Rec
    }
    expect(roll(4).ok).toBe(true)
    expect(roll(3).ok).toBe(false)
  })

  it('淺檔：專屬構裝整欄不生效（沒有 admin 標籤的管理行動、RAM 加值都沒有）；換回標準檔都回來', () => {
    const a = arena(setup([master()], [lace()]))
    turnTo(a, 'a1')
    setGear(a.a(1), 'shallow')
    // 只剩共鳴 1 階的 +2（共鳴不是專屬構裝）
    expect(modsOf(a, 'save', 'a1', ['admin'])).toBe(2)
    expect(modsOf(a, 'refill', 'a1')).toBe(0)
    setGear(a.a(1), 'standard')
    expect(modsOf(a, 'save', 'a1', ['admin'])).toBe(4)
    expect(modsOf(a, 'refill', 'a1')).toBe(1)
  })

  it('構裝槽 +2（招牌佔一個）、頻寬再 +1；net_trace_start 與 sync_cap_bonus 照舊', () => {
    const owner = (...ids: string[]) => ({ pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { netrunner: 120 } } } } })
    const g = (...ids: string[]) => makeGame({ features: FEATURES, content: [RULES, pack([NET_TREES.netrunner!])], ...owner(...ids) } as never).game
    const none = g()
    const base = none.k.stats.stat(none.state, 'pc', 'deck_slots')
    const m = g('sk_netrunner_master')
    expect(m.k.stats.stat(m.state, 'pc', 'deck_slots')).toBe(base + 2)
    expect(m.k.stats.stat(m.state, 'pc', 'deck_slots_reserved')).toBe(1)
    const b = g('sk_netrunner_master', 'sk_netrunner_bandwidth')
    expect(b.k.stats.stat(b.state, 'pc', 'deck_slots')).toBe(base + 3)
    expect(b.k.stats.stat(b.state, 'pc', MASTER_TIER_STAT)).toBe(3)
  })
})

describe('潛網者：破冰、迴圈、靜默、逆流、多工、黑冰與其他', () => {
  const master = (ids: string[], o: Rec = {}, tier = 3) => avatar(1, { netrunner: tier }, ['sk_netrunner_master', ...ids], o)

  it('破冰：攻擊無視 2 點防護（同樣的骰面，感載比普通攻擊多 2）；花 1 行動點 2 RAM 的設計書數字是 2 行動點 2 RAM', () => {
    const run = (action: string) => {
      const a = arena(setup([master(['sk_netrunner_break_ice'])], [lace({ armor: 3 })]))
      turnTo(a, 'a1')
      if (action === 'sk_netrunner_break_ice') expect(opt(a, action)!.cost).toEqual({ ap: 2, ram: 2 })
      doAct(a, 'a1', { action, target: { unit: 'f1' } }, [15])
      return a.f(1).load!.now
    }
    expect(run('sk_netrunner_break_ice') - run('net_attack')).toBe(2)
  })

  it('迴圈：快駭（神經）檢定過了就掛持續型，三回合每回合開始 2d6 感載，之後結束；同一個目標只掛一個', () => {
    const a = arena(setup([master(['sk_netrunner_loop'])], [lace({ load: { now: 0, max: 100 } })]))
    turnTo(a, 'a1')
    expect(opt(a, 'sk_netrunner_loop')!.cost).toEqual({ ap: 2, ram: 3 })
    doAct(a, 'a1', { action: 'sk_netrunner_loop', target: { unit: 'f1' } }, [20])
    expect((a.f(1).ext.hack as Rec).dot).toMatchObject({ amount: '2d6', turns: 3 })
    const before = a.f(1).load!.now
    for (let i = 1; i <= 3; i++) {
      a.k.battle.emit('turn.start', { run: a.run([4, 4]), unit: a.f(1), lost: false } as never)
      expect(a.f(1).load!.now, `第 ${i} 回合`).toBe(before + 8 * i)
    }
    expect((a.f(1).ext.hack as Rec).dot).toBeUndefined()
    a.k.battle.emit('turn.start', { run: a.run([4, 4]), unit: a.f(1), lost: false } as never)
    expect(a.f(1).load!.now).toBe(before + 24)
  })

  it('靜默：開著時每回合追蹤度從 +3 改成 +1，管理行動不加追蹤度（檢定失敗照加 +5）', () => {
    const a = arena(setup([master(['sk_netrunner_silence'])], [lace()]))
    turnTo(a, 'a1')
    const round2 = (x: Arena) => {
      x.battle.round = 2
      x.k.battle.emit('round.start', { run: x.run(), round: 2 } as never)
    }
    // 沒開：+3
    round2(a)
    expect(a.battle.field.trace).toBe(23)
    // 管理行動 +1
    doAct(a, 'a1', { action: 'adm_wipe' }, [20])
    expect(a.battle.field.trace).toBe(23 + 1 - 5)
    // 開了：每回合 +1、管理行動 +0（成功的擦痕跡只剩 −5）
    doAct(a, 'a1', { action: 'sk_netrunner_silence' })
    expect(modsOf(a, 'trace_round', 'a1')).toBe(-2)
    expect(modsOf(a, 'trace_admin', 'a1')).toBe(-1)
    a.battle.field.trace = 20
    round2(a)
    expect(a.battle.field.trace).toBe(21)
    a.battle.field.trace = 40
    doAct(a, 'a1', { action: 'adm_wipe' }, [20])
    expect(a.battle.field.trace).toBe(35)
    // 檢定失敗照加 +5（再加管理行動的 0）
    doAct(a, 'a1', { action: 'adm_wipe' }, [1])
    expect(a.battle.field.trace).toBe(40)
  })

  it('逆流：過載時不閃斷，RAM 反而回滿；每場 1 次（第二次照常閃斷）', () => {
    const a = arena(setup([master(['sk_netrunner_backflow'], { pools: { ram: { now: 2, max: 6, regen: 2 } } })], [lace()]))
    a.run().overload(a.a(1))
    expect(a.a(1).pools.ram!.now).toBe(a.a(1).pools.ram!.max)
    expect(statusIds(a.a(1))).not.toContain('flash')
    a.run().overload(a.a(1))
    expect(a.a(1).pools.ram!.now).toBe(0)
    expect(statusIds(a.a(1))).toContain('flash')
  })

  it('多工：管理行動的次數 +1（4 次）；每回合第一個管理行動的 RAM −1（最低 1）', () => {
    const a = arena(setup([master(['sk_netrunner_multitask'])], [lace()]))
    turnTo(a, 'a1')
    expect(adminLeft(a.run(), a.a(1))).toBe(4)
    // 造牆本來 2 RAM：第一個 1，第二個回到 2；擦痕跡本來 1 RAM：最低 1
    expect(opt(a, 'adm_wall')!.cost).toEqual({ ap: 0, ram: 1 })
    expect(opt(a, 'adm_wipe')!.cost).toEqual({ ap: 0, ram: 1 })
    doAct(a, 'a1', { action: 'adm_wall', target: { side: 'ally', slot: 1 } }, [20])
    expect(opt(a, 'adm_wall')!.cost).toEqual({ ap: 0, ram: 2 })
    // 根權限：管理行動的 RAM 一律 −1（造牆 2→1）、檢定 +2（再疊上主控的 +2）
    const r = arena(setup([master(['sk_netrunner_root'])], [lace()]))
    turnTo(r, 'a1')
    expect(opt(r, 'adm_wall')!.cost).toEqual({ ap: 0, ram: 1 })
    expect(modsOf(r, 'save', 'a1', ['admin'])).toBe(6)
  })

  it('黑冰：花掉全部的 RAM（至少 5），傷害骰多（花掉的 RAM − 1）顆；每場 1 次；這一擊讓目標過載就失去下一個回合、閃斷持續兩回合', () => {
    const base = arena(setup([master([])], [lace()])).a(1).weapons[0]!.dice
    const a = arena(setup([master(['sk_netrunner_black_ice'], { pools: { ram: { now: 8, max: 8, regen: 3 } } })], [lace({ load: { now: 0, max: 100 } })]))
    turnTo(a, 'a1')
    const ram = a.a(1).pools.ram!.now
    expect(ram).toBeGreaterThanOrEqual(5)
    expect(opt(a, 'sk_netrunner_black_ice')!.cost).toEqual({ ap: 2, ram })
    const run = a.run([15, ...FILL])
    const seen = spyRolls(run)
    performAction(run, run.unit('a1'), a.k.battle.getAction('sk_netrunner_black_ice')!, { unit: 'f1' }, { action: 'sk_netrunner_black_ice', target: { unit: 'f1' } })
    const crit = run.beats.some((b) => b.tag === 'crit') ? 1 : 0
    expect(seen.filter(([, s]) => s === 6).reduce((n, [c]) => n + c, 0)).toBe(base + (ram - 1) + crit)
    expect(a.a(1).pools.ram!.now).toBe(0)
    expect(statusIds(a.f(1))).not.toContain('flash')
    a.a(1).pools.ram!.now = ram
    expect(opt(a, 'sk_netrunner_black_ice')!.blocks.join('')).toMatch(/用過了/)
    // 過載的那一擊：感載上限很小的蕾絲被打到過載
    const b = arena(setup([master(['sk_netrunner_black_ice'], { pools: { ram: { now: 8, max: 8, regen: 3 } } })], [lace({ load: { now: 0, max: 5 }, layersMax: 4 })]))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'sk_netrunner_black_ice', target: { unit: 'f1' } }, [15])
    expect(statusIds(b.f(1))).toContain('lose_turn')
    expect(b.f(1).statuses.find((s) => s.id === 'flash')).toBeTruthy()
  })

  it('我不在家喔：1 次管理行動加 1 RAM，檢定過了追蹤度 −10（再加管理行動的 +1）；失敗只有 +1', () => {
    const a = arena(setup([master(['sk_netrunner_not_home'])], [lace()]))
    turnTo(a, 'a1')
    const o = opt(a, 'sk_netrunner_not_home')!
    expect(o.cost).toEqual({ ap: 0, ram: 1 })
    a.battle.field.trace = 40
    doAct(a, 'a1', { action: 'sk_netrunner_not_home' }, [20])
    expect(a.battle.field.trace).toBe(31)
    expect(a.a(1).uses['turn:admin']).toBe(1)
    doAct(a, 'a1', { action: 'sk_netrunner_not_home' }, [1])
    expect(a.battle.field.trace).toBe(32)
  })

  it('接管：1 次管理行動加 3 RAM，檢定過了守衛程式 3 回合是我方的', () => {
    const guard = { side: 'foe', slot: 2, kind: 'attack', name: '看門犬', hp: { now: 14, max: 14 }, armor: 1, evade: 0, weapon: netWeapon(10, 3), auto: true, autonomous: true }
    const a = arena(setup([master(['sk_netrunner_seize'])], [lace()]))
    a.battle.overlays.push({ id: 'o1', used: false, down: false, ...guard } as never)
    turnTo(a, 'a1')
    expect(opt(a, 'sk_netrunner_seize')!.cost).toEqual({ ap: 0, ram: 3 })
    doAct(a, 'a1', { action: 'sk_netrunner_seize', target: { overlay: 'o1' } }, [20])
    const o = a.battle.overlays.find((x) => x.id === 'o1')!
    expect(o.side).toBe('ally')
    expect((o.ext!.hack as Rec).taken).toMatchObject({ mode: 'takeover', by: 'a1', left: 3 })
  })

  it('偷看是不行的喔：被攻擊時這一下的感載 −4（花 1 RAM，每回合 1 次）', () => {
    const hit = (ids: string[]) => {
      const a = arena(setup([master(ids)], [lace()]))
      const run = a.run([15, ...FILL])
      run.attack(a.f(1), a.a(1), {})
      return a.a(1).load!.now
    }
    const plain = hit([])
    const guarded = hit(['sk_netrunner_no_peeking'])
    expect(plain - guarded).toBe(4)
  })

  it('不讓你帶走：隊友即將被釘住時自動失敗，動手的人受到反擊；每場 1 次', () => {
    const a = arena(setup([master(['sk_netrunner_not_taking']), avatar(2, {}, [])], [lace()]))
    const run = a.run([5, 5, ...FILL])
    const before = a.f(1).load!.now
    expect(run.setOut(a.a(2), 'pinned', a.f(1))).toBe(false)
    expect(a.a(2).out).toBeUndefined()
    expect(a.f(1).load!.now).toBeGreaterThan(before)
    expect(a.a(1).pools.ram!.now).toBe(a.a(1).pools.ram!.max - 1)
    // 第二次擋不下
    expect(a.run().setOut(a.a(2), 'pinned', a.f(1))).toBe(true)
  })

  it('深潛：同步檔位上限 +1、換檔每回合兩次；備份、管理員的管理行動各花 1 次', () => {
    const a = arena(setup([master(['sk_netrunner_deep_dive', 'sk_netrunner_backup', 'sk_netrunner_sysadmin'], { pools: { ram: { now: 8, max: 8, regen: 3 } } })], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_netrunner_deep_dive' })
    expect(modsOf(a, 'sync_cap', 'a1')).toBe(1)
    expect(modsOf(a, 'sync_shifts', 'a1')).toBe(1)
    // 備份：全隊排 8 點感載
    a.a(1).load!.now = 12
    doAct(a, 'a1', { action: 'sk_netrunner_backup' })
    expect(a.a(1).load!.now).toBe(4)
    expect(a.a(1).uses['turn:admin']).toBe(1)
    // 管理員：花全部的 RAM（至少 6）、追蹤度 −20
    a.battle.field.trace = 50
    turnTo(a, 'a1')
    a.a(1).pools.ram!.now = 8
    doAct(a, 'a1', { action: 'sk_netrunner_sysadmin' })
    expect(a.battle.field.trace).toBe(31)
    expect(a.a(1).pools.ram!.now).toBe(0)
  })

  it('這一棵樹的標籤、姿態與被動：過熱選干擾的類別、盯～閃斷時再 +1、謝謝招待回 RAM、群播整排少 1 點行動點', () => {
    const a = arena(setup([master(['sk_netrunner_overheat', 'sk_netrunner_stare', 'sk_netrunner_thanks', 'sk_netrunner_broadcast'])], [lace(), lace()]))
    turnTo(a, 'a1')
    // 過熱：命中時停用的是玩家選的那一類
    doAct(a, 'a1', { action: 'sk_netrunner_overheat', target: { unit: 'f1' }, pick: { jam: 'defense' } }, [15])
    expect(statusIds(a.f(1))).toEqual(expect.arrayContaining(['jam_defense']))
    expect(statusIds(a.f(1))).not.toContain('jam_weapon')
    // 盯～：+1，目標在閃斷時 +2
    expect(modsOf(a, 'hit', 'a1', [], a.f(1))).toBe(1)
    a.run().applyStatus(a.f(1), 'flash', { quiet: true })
    expect(modsOf(a, 'hit', 'a1', [], a.f(1))).toBe(2)
    // 謝謝招待：我方的攻擊讓目標過載時回 2 RAM，每回合一次
    a.a(1).pools.ram!.now = 1
    a.run().overload(a.f(2), a.a(1))
    expect(a.a(1).pools.ram!.now).toBe(3)
    a.run().overload(a.f(2), a.a(1))
    expect(a.a(1).pools.ram!.now).toBe(3)
    // 群播：整排各受 4 點感載、下一回合少 1 點行動點
    const b = arena(setup([master(['sk_netrunner_broadcast'])], [lace(), lace()]))
    turnTo(b, 'a1')
    const l1 = b.f(1).load!.now
    doAct(b, 'a1', { action: 'sk_netrunner_broadcast' })
    expect(b.f(1).load!.now).toBe(l1 + 4)
    expect(b.f(2).load!.now).toBe(l1 + 4)
    expect(modsOf(b, 'ap_regen', 'f1')).toBe(-1)
    expect(modsOf(b, 'ap_regen', 'f2')).toBe(-1)
  })

  it('寫不出來的幾個（傀儡、看錯人囉）標了 pending：圓環上沒有；後門是預備（內海：追蹤度從 −15 起算）', () => {
    const a = arena(setup([master(['sk_netrunner_puppet', 'sk_netrunner_wrong_person'])], [lace()]))
    turnTo(a, 'a1')
    expect(ringIds(a)).not.toContain('sk_netrunner_puppet')
    expect(ringIds(a)).not.toContain('sk_netrunner_wrong_person')
    const backdoor = NET_TREES.netrunner!.abilities.find((x) => x.id === 'sk_netrunner_backdoor')!
    expect(backdoor.prep).toMatchObject({ scope: 'commission', net: { trace_start: -15 } })
    expect(NR_ALL).toHaveLength(27)
  })
})

describe('潛網者的路數 id 和 features/hack、features/netrun 對過', () => {
  it('技能資料的路數 id 是 netrunner：hack 的 DEFAULT_TREE、netrun 規則表的 master_path 預設都是它', async () => {
    const { DEFAULT_TREE } = await import('../../src/features/hack/deck')
    const { DEFAULT_RULES } = await import('../../src/features/netrun/model')
    expect(NET_TREES.netrunner!.path.id).toBe('netrunner')
    expect(DEFAULT_TREE).toBe('netrunner')
    expect(DEFAULT_RULES.master_path).toBe('netrunner')
  })
})

// ===================================================================================================================
// 四、改造師
// ===================================================================================================================

describe('改造師：除錯（招牌）與每場一次的小招', () => {
  const medic = (ids: string[], o: Rec = {}) => avatar(1, { medic: 3 }, ['sk_medic_scalpel', ...ids], o)
  const mate = (o: Rec = {}) => avatar(2, {}, [], { load: { now: 10, max: 40 }, ...o })
  const melee = (hit = 40) => ({ weapons: [netWeapon(hit, 4, { traits: ['melee'], name: '近戰構裝', class: 'blade' })], wield: 0 })

  it('除錯：被動的招牌在內海多一個行動（1 行動點、每場一次）：替隊友排 4 點感載，或修好他一個破損的構裝槽', () => {
    const a = arena(setup([medic([]), mate({ ext: { net: NET({ broken: ['cs_a', 'cs_b'] }), deck: DECK() } })], [lace()]))
    turnTo(a, 'a1')
    expect(a.k.battle.getAction('sk_medic_scalpel')!.modes).toEqual(['net'])
    const o = opt(a, 'sk_medic_scalpel')!
    expect(o.cost).toEqual({ ap: 1 })
    expect(o.picks.map((p) => p.key)).toEqual(['choice'])
    // 修好一個破損的槽（最近破損的那一個）
    doAct(a, 'a1', { action: 'sk_medic_scalpel', target: { unit: 'a2' }, pick: { choice: 'fix' } })
    expect((a.a(2).ext.net as Rec).broken).toEqual(['cs_a'])
    // 每場一次
    expect(opt(a, 'sk_medic_scalpel')!.ok).toBe(false)
    expect(opt(a, 'sk_medic_scalpel')!.blocks.join('')).toMatch(/用過了/)
    // 排感載
    const b = arena(setup([medic([]), mate()], [lace()]))
    turnTo(b, 'a1')
    const was = b.a(2).load!.now
    expect(was).toBeGreaterThanOrEqual(4)
    doAct(b, 'a1', { action: 'sk_medic_scalpel', target: { unit: 'a2' }, pick: { choice: 'vent' } })
    expect(b.a(2).load!.now).toBe(was - 4)
  })

  it('縫合手：除錯多排 2 點；名醫：除錯每場可以用兩次（第三次還是不行）', () => {
    const a = arena(setup([medic(['sk_medic_suture', 'sk_medic_famed_doctor']), mate()], [lace()]))
    turnTo(a, 'a1')
    a.a(2).load!.now = 10
    doAct(a, 'a1', { action: 'sk_medic_scalpel', target: { unit: 'a2' }, pick: { choice: 'vent' } })
    expect(a.a(2).load!.now).toBe(4)
    expect(opt(a, 'sk_medic_scalpel')!.ok).toBe(true)
    doAct(a, 'a1', { action: 'sk_medic_scalpel', target: { unit: 'a2' }, pick: { choice: 'vent' } })
    expect(a.a(2).load!.now).toBe(0)
    expect(opt(a, 'sk_medic_scalpel')!.ok).toBe(false)
    expect(a.a(1).uses.sk_medic_scalpel).toBe(2)
  })

  it('隊上有他（解剖）時 dissect 標籤在，沒有就沒有', () => {
    const a = arena(setup([medic(['sk_medic_dissection']), mate()], [lace()]))
    expect(a.a(1).tags).toContain('dissect')
    expect(a.a(2).tags).not.toContain('dissect')
    const b = arena(setup([medic([]), mate()], [lace()]))
    expect(b.a(1).tags).not.toContain('dissect')
  })

  it('拆解、卸下：近身的構裝攻擊命中時，目標一類構裝停用（玩家選）；手上不是近戰構裝灰掉；每場一次', () => {
    const a = arena(setup([medic(['sk_medic_dismantle', 'sk_medic_take_off'], melee())], [lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'sk_medic_dismantle')!.cost).toEqual({ ap: 2, ram: 1 })
    doAct(a, 'a1', { action: 'sk_medic_dismantle', target: { unit: 'f1' }, pick: { jam: 'tool' } }, [15])
    expect(statusIds(a.f(1))).toContain('jam_tool')
    expect(opt(a, 'sk_medic_dismantle')!.blocks.join('')).toMatch(/用過了/)
    // 卸下：兩回合
    doAct(a, 'a1', { action: 'sk_medic_take_off', target: { unit: 'f1' }, pick: { jam: 'weapon' } }, [15])
    expect(a.f(1).statuses.find((x) => x.id === 'jam_weapon')).toBeTruthy()
    // 不是近戰構裝
    const b = arena(setup([medic(['sk_medic_dismantle'])], [lace()]))
    turnTo(b, 'a1')
    expect(opt(b, 'sk_medic_dismantle')!.blocks.join('')).toMatch(/melee/)
  })

  it('短路暈眩、拆光兩個構裝、找縫無視 1 點防護；第一回合的拆拆好好玩與解鎖匠命中各 +1', () => {
    const a = arena(setup([medic(['sk_medic_short_circuit', 'sk_medic_strip_all'], melee())], [lace(), lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_medic_short_circuit', target: { unit: 'f1' } }, [15])
    expect(statusIds(a.f(1))).toContain('dazed')
    doAct(a, 'a1', { action: 'sk_medic_strip_all', target: { unit: 'f1' }, pick: { jam: 'weapon_tool' } }, [15])
    expect(statusIds(a.f(1))).toEqual(expect.arrayContaining(['jam_weapon', 'jam_tool']))
    const gap = (ids: string[]) => {
      const x = arena(setup([medic(ids, melee())], [lace({ armor: 3 })]))
      turnTo(x, 'a1')
      doAct(x, 'a1', { action: ids[0] === 'sk_medic_find_gap' ? 'sk_medic_find_gap' : 'net_melee', target: { unit: 'f1' } }, [15])
      return x.f(1).load!.now
    }
    expect(gap(['sk_medic_find_gap']) - gap(['sk_medic_dismantle_fun'])).toBe(1)
    const c = arena(setup([medic(['sk_medic_dismantle_fun', 'sk_medic_locksmith'], melee())], [lace()]))
    expect(modsOf(c, 'hit', 'a1')).toBe(2)
    c.battle.round = 2
    expect(modsOf(c, 'hit', 'a1')).toBe(0)
  })

  it('排好隊喔（自己與相鄰兩格各排 4）、呼呼不燙了（消一層餘韻）、戰場急救（解除干擾）、全面翻修（排 8 並消一層餘韻）、戰地手術（修好所有破損）', () => {
    const a = arena(setup([medic(['sk_medic_line_up', 'sk_medic_cool_down', 'sk_medic_first_aid', 'sk_medic_overhaul', 'sk_medic_field_surgery'], { load: { now: 12, max: 40 } }), mate({ load: { now: 12, max: 40 } }), avatar(3, {}, [], { load: { now: 12, max: 40 } })], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_medic_line_up' })
    expect([a.a(1), a.a(2), a.a(3)].map((u) => u.load!.now)).toEqual([8, 8, 12])
    a.a(2).layers = 2
    doAct(a, 'a1', { action: 'sk_medic_cool_down', target: { unit: 'a2' } })
    expect(a.a(2).layers).toBe(1)
    a.run().applyStatus(a.a(2), 'jam_weapon', { quiet: true })
    a.run().applyStatus(a.a(2), 'jam_tool', { quiet: true })
    doAct(a, 'a1', { action: 'sk_medic_first_aid', target: { unit: 'a2' } })
    expect(statusIds(a.a(2))).not.toEqual(expect.arrayContaining(['jam_weapon']))
    expect(statusIds(a.a(2)).filter((x) => x.startsWith('jam_'))).toEqual([])
    doAct(a, 'a1', { action: 'sk_medic_overhaul', target: { unit: 'a2' } })
    expect(a.a(2).load!.now).toBe(0)
    expect(a.a(2).layers).toBe(0)
    ;(a.a(2).ext.net as Rec).broken = ['x', 'y', 'z']
    doAct(a, 'a1', { action: 'sk_medic_field_surgery', target: { unit: 'a2' } })
    expect((a.a(2).ext.net as Rec).broken).toEqual([])
  })

  it('急凍：隊友過載時他的 RAM 不歸零、也不閃斷；每場 1 次；還不准睡、拉回來、極限超頻、主刀寫不出來（pending）', () => {
    const a = arena(setup([medic(['sk_medic_flash_freeze']), mate({ pools: { ram: { now: 4, max: 6, regen: 2 } } })], [lace()]))
    a.run().overload(a.a(2))
    expect(a.a(2).pools.ram!.now).toBe(4)
    expect(statusIds(a.a(2))).not.toContain('flash')
    expect(a.a(1).uses.sk_medic_flash_freeze).toBe(1)
    a.a(2).layers = 0
    a.run().overload(a.a(2))
    expect(a.a(2).pools.ram!.now).toBe(0)
    const b = arena(setup([medic(['sk_medic_not_sleep_yet', 'sk_medic_pull_back', 'sk_medic_extreme_overclock', 'sk_medic_chief_surgeon'])], [lace()]))
    turnTo(b, 'a1')
    for (const id of ['sk_medic_not_sleep_yet', 'sk_medic_pull_back', 'sk_medic_extreme_overclock', 'sk_medic_chief_surgeon']) expect(ringIds(b), id).not.toContain(id)
  })
})

// ===================================================================================================================
// 五、機師
// ===================================================================================================================

describe('機師：守衛程式', () => {
  const GUARD_ATK = { kind: 'attack', grade: 1, net: true, name: '看門犬' }
  const GUARD_SHIELD = { kind: 'shield', grade: 1, net: true, name: '鏡盾' }
  const pilot = (ids: string[], o: Rec = {}) =>
    avatar(1, { pilot: 3 }, ['sk_pilot_formation', ...ids], { ext: { ...equip({ pilot: 3 }, 'sk_pilot_formation', ...ids), net: NET(), deck: DECK(), summons: { drones: [GUARD_ATK, GUARD_SHIELD] } }, skills: { piloting: 8, interface: 4 }, ...o })
  const deploy = (a: Arena, idx: number, slot: number): string[] => reasons(a, { action: 'net_guard_deploy', target: { side: 'ally', slot }, pick: { drone: idx } })

  it('編隊：內海叫得出一個守衛程式（標籤 drone_link），第二個被擋（同時只連得住 1 個，不看同步）', () => {
    const a = arena(setup([pilot([])], [lace()]))
    expect(a.a(1).tags).toContain('drone_link')
    turnTo(a, 'a1')
    expect(deploy(a, 0, 1)).toEqual([])
    // battleAct 只回傳草稿：把它做出來
    doAct(a, 'a1', { action: 'net_guard_deploy', target: { side: 'ally', slot: 1 }, pick: { drone: 0 } })
    expect(a.battle.overlays).toHaveLength(1)
    expect(a.battle.overlays[0]).toMatchObject({ owner: 'a1', kind: 'attack', name: '看門犬' })
    const second = reasons(a, { action: 'net_guard_deploy', target: { side: 'ally', slot: 2 }, pick: { drone: 1 } })
    expect(second.join('')).toMatch(/只連得住 1 個守衛程式/)
    expect(() => doAct(a, 'a1', { action: 'net_guard_deploy', target: { side: 'ally', slot: 2 }, pick: { drone: 1 } })).toThrow(BattleBlocked)
    expect(a.battle.overlays).toHaveLength(1)
  })

  it('蜂群：每場 1 次多叫出一個臨時的守衛程式（不算進上限、2 回合）；穹頂：我方每一格迴避 +1', () => {
    const a = arena(setup([pilot(['sk_pilot_swarm', 'sk_pilot_dome']), avatar(2, {}, [])], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'net_guard_deploy', target: { side: 'ally', slot: 1 }, pick: { drone: 0 } })
    expect(opt(a, 'sk_pilot_swarm')!.cost).toEqual({ ap: 3 })
    doAct(a, 'a1', { action: 'sk_pilot_swarm' })
    expect(a.battle.overlays).toHaveLength(2)
    expect(opt(a, 'sk_pilot_swarm')!.blocks.join('')).toMatch(/用過了/)
    doAct(a, 'a1', { action: 'sk_pilot_dome' })
    expect(modsOf(a, 'evade', 'a1')).toBe(1)
    expect(modsOf(a, 'evade', 'a2')).toBe(1)
  })

  it('掩護飛行、攔截：守衛程式掛在同一格時，隊友被攻擊命中 −1；或改打守衛程式；各每場 1 次', () => {
    const a = arena(setup([pilot(['sk_pilot_cover_flight', 'sk_pilot_intercept'])], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'net_guard_deploy', target: { side: 'ally', slot: 1 }, pick: { drone: 1 } })
    const run = a.run([15, ...FILL])
    const plain = a.run().hitChance(a.f(1), a.a(1), a.f(1).weapons[0]!, {})
    run.attack(a.f(1), a.a(1), {})
    // 兩個反應都在同一次攻擊上觸發（掩護飛行的命中 −1；攔截把這一擊改打守衛程式）：隊友沒有受到感載，守衛程式掉了耐久
    expect(a.a(1).load!.now).toBe(0)
    expect(a.battle.overlays[0]!.hp.now).toBeLessThan(a.battle.overlays[0]!.hp.max)
    expect(a.a(1).uses.sk_pilot_cover_flight).toBe(1)
    expect(a.a(1).uses.sk_pilot_intercept).toBe(1)
    expect(plain).toBeGreaterThan(0)
  })

  it('構裝體的技能（突擊姿態、堡壘姿態、同步衝刺、女武神……）標了 pending（等 M6）：圓環上沒有、沒有修正', () => {
    const ids = ['sk_pilot_assault', 'sk_pilot_bastion', 'sk_pilot_sync_dash', 'sk_pilot_valkyrie', 'sk_pilot_neural_hardening', 'sk_pilot_feedback_buffer', 'sk_pilot_ram_in', 'sk_pilot_resonant_pilot', 'sk_pilot_man_machine']
    const a = arena(setup([pilot(ids)], [lace()]))
    turnTo(a, 'a1')
    for (const id of ids) expect(ringIds(a), id).not.toContain(id)
    expect(modsOf(a, 'hit', 'a1')).toBe(0)
    const t = NET_TREES.pilot!
    expect(t.notes.filter((n) => n.status === 'wait').map((n) => n.id).sort()).toEqual([...ids].sort())
  })
})

// ===================================================================================================================
// 六、主控的樹階：衍生數值 master_tier 與 features/netrun 的 masterTier
// ===================================================================================================================

describe('master_tier：主角與夥伴的主控階數（abilities 提供，netrun 讀）', () => {
  const MASTER_ONLY: ContentPack = netPack([{ ...NET_TREES.netrunner!, abilities: NET_TREES.netrunner!.abilities.filter((x) => x.id === 'sk_netrunner_master') }]) as unknown as ContentPack
  const NODE_SKILLS = ['firearms', 'brawl', 'composure', 'interface', 'sync', 'stealth', 'negotiate'].map((id) => ({
    id, name: id, desc: `${id}。`, attr: id === 'composure' ? 'resolve' : id === 'stealth' || id === 'firearms' ? 'reflex' : id === 'interface' ? 'intellect' : id === 'negotiate' ? 'charm' : 'body',
  }))
  const REGION = {
    id: 'ms', name: '主控測試網', map_kind: 'subnet', size: [11, 9], carve: [30, 40], sight: 3, pressure: 'trace', cover: 'medium', dc: [10, 13, 16, 19, 22],
    layer: { foe: [0, 0], patrol: [0, 0], archive: [0, 0], trap: [0, 0], rest: [0, 0], safe: [0, 0], control: [0, 0], person: [0, 0] },
  }
  const NODE_PACK: ContentPack = {
    id: 'ms_pack', content: { skill: NODE_SKILLS, net_region: [REGION], faction: [{ id: 'f_a', name: '甲公司', short: '甲', class: 'corp' }], battle_status: JAM_STATUSES },
  } as unknown as ContentPack
  const STATS: Feature = { id: 'ms_stats', install: (k) => k.stats.defineStat({ id: 'deck_grade', owner: 'ms_stats', name: '甲板', base: () => 1 }) }
  const NODE_FEATURES = [enemiesFeature, exploreFeature, netrunFeature, abilitiesFeature, TEST_NET_COMBAT, STATS, TEST_ACTIVITY]
  const record = (spent: number, equipped = true): Rec => ({ abilities: { xp: 0, learned: ['sk_netrunner_master'], equipped: equipped ? ['sk_netrunner_master'] : [], spent: { netrunner: spent } } })
  const game = (ext: Rec, o: Rec = {}) =>
    makeGame({ seed: 5, features: NODE_FEATURES, content: [NODE_PACK, MASTER_ONLY], pc: { attrs: { intellect: 14, charm: 14, resolve: 14, reflex: 14 }, skills: { interface: 4, negotiate: 4, stealth: 3 }, ext }, ...o } as never).game
  type G = ReturnType<typeof game>

  it('主角學了主控而且裝著：樹階看那一棵樹累計花的歷練點（0 是 1 階、40 是 2 階、120 是 3 階、240 是 4 階、400 是 5 階）；沒裝著或沒學就是 0', () => {
    const tier = (g: G) => g.k.stats.stat(g.state, 'pc', MASTER_TIER_STAT)
    expect([0, 40, 120, 240, 400].map((xp) => tier(game(record(xp))))).toEqual([1, 2, 3, 4, 5])
    expect(masterTier(game(record(120)).k, game(record(120)).state, 'pc')).toBe(3)
    const unequipped = game(record(120, false))
    expect(tier(unequipped)).toBe(0)
    expect(masterTier(unequipped.k, unequipped.state, 'pc')).toBe(0)
    const none = game({})
    expect(tier(none)).toBe(0)
    expect(masterTier(none.k, none.state, 'pc')).toBe(0)
    expect(masterTierOf(none.k, none.state, 'nobody')).toBe(0)
  })

  it('夥伴（沒有自己的學習紀錄、有 ext.paths）看路數那一列的階數；ext.paths 沒有技能的功能時照舊讀；兩邊取高的', () => {
    const g = game(record(120), { actors: [makeActor({ id: 'c1', name: '同伴', role: 'companion', ext: { paths: [{ path: 'netrunner', tier: 4 }, { path: 'gunner', tier: 5 }] } })] })
    expect(g.k.stats.stat(g.state, 'c1', MASTER_TIER_STAT)).toBe(4)
    expect(masterTier(g.k, g.state, 'c1')).toBe(4)
    expect(masterTier(g.k, g.state, 'pc')).toBe(3)
    // 主角自己有學習紀錄、又寫了 ext.paths：取高的
    const both = game({ ...record(40), paths: [{ path: 'netrunner', tier: 3 }] })
    expect(masterTier(both.k, both.state, 'pc')).toBe(3)
    // 沒有裝技能的功能：照舊只讀 ext.paths
    const bare = makeGame({ seed: 5, features: [enemiesFeature, exploreFeature, netrunFeature, TEST_NET_COMBAT, STATS, TEST_ACTIVITY], content: [NODE_PACK], pc: { ext: { paths: [{ path: 'netrunner', tier: 2 }] } } } as never).game
    expect(bare.k.stats.hasStat(MASTER_TIER_STAT)).toBe(false)
    expect(masterTier(bare.k, bare.state, 'pc')).toBe(2)
  })

  it('主角學了主控：接管與擦痕跡的檢定加值是 ⌈樹階÷2⌉（1→1、2→1、3→2、4→2、5→3）', () => {
    const bonus = (xp: number) => {
      const g = game(record(xp))
      return pickAdmin(g.k, g.state)!.situation.find((p) => p.label === '主控')!.value
    }
    expect([0, 40, 120, 240, 400].map(bonus)).toEqual([1, 1, 2, 2, 3])
    // 沒有主控的隊伍沒有管理行動的人選
    const none = game({})
    expect(pickAdmin(none.k, none.state)).toBeNull()
  })

  it('主角學了主控：探索中擦痕跡一層最多做「樹階」次（3 階 3 次，第 4 次灰掉）', () => {
    const g = game(record(120))
    g.launch(ACT_NET, { region: REGION, seed: 11, grade: 1, faction: 'f_a', encounter: [] }, { by: 'core' })
    expect(readRun(g.state)).toBeTruthy()
    for (let i = 0; i < 3; i++) g.commit(useNode(g.k, g.state, 'wipe'))
    expect(netExt(g.state, readRun(g.state)!.map)!.wiped).toEqual({ l1: 3 })
    expect(() => useNode(g.k, g.state, 'wipe')).toThrow(/最多擦 3 次/)
  })
})

// ===================================================================================================================
// 七、技能格式收 trace 鍵（兩欄）、use.weapon_ram 與其他新鍵
// ===================================================================================================================

describe('trace 鍵：技能做的快駭讀得到追蹤度（內海每用一次加，兩欄各寫各的）', () => {
  const FAKE: Rec[] = [
    { id: 'sk_t_root', name: '根', path: 'tt', category: 'net', tier: 1, layer: 'signature', kind: 'passive', cap: 1, xp: 20, cells: 0, text: '根。', meat: null, net: null, opinion: null },
    ...['sk_t_zap', 'sk_t_plain', 'sk_t_meat_only'].map((id) => ({
      id, name: id, path: 'tt', category: 'net', tier: 1, layer: 'front', kind: 'active', cap: 1, xp: 20, cells: 1, after: 'sk_t_root', text: `${id}。`, opinion: null,
      use: { ap: 1 },
      meat: id === 'sk_t_meat_only' ? { target: 'enemy', action_tags: ['hack'], trace: 6, do: [{ op: 'load', amount: 1 }] } : null,
      net: id === 'sk_t_meat_only' ? null : { target: 'enemy', action_tags: ['hack'], ...(id === 'sk_t_zap' ? { trace: 3 } : {}), do: [{ op: 'load', amount: 1 }] },
    })),
  ]
  const TREE_T = { id: 'tt', name: '假樹', tree: '假樹', category: 'net', signature: 'sk_t_root', domains: { meat: 'strong', net: 'strong', opinion: 'none' }, resonance: [] }
  const tpack = { id: 'trace_test', content: { path: [TREE_T], ability: FAKE } } as unknown as ContentPack
  const mk = () => {
    const k = createKernel(FEATURES)
    k.content.loadPack(RULES)
    k.content.loadPack(tpack)
    readyFeatures(k)
    const state = makeState()
    const battle = clone(setupBattle(k, state, setup([avatar(1, { tt: 1 }, ['sk_t_zap', 'sk_t_plain'])], [lace()])).battle)
    state.battle = battle
    return { k, state, battle }
  }

  it('net.trace 3 的技能用一次追蹤度 +3；沒寫的不加；traceOfAction 看那一層的那一欄', () => {
    const { k, state, battle } = mk()
    battle.units.a1!.control = 'player'
    expect(traceOfAction(k, 'sk_t_zap', 'net')).toBe(3)
    expect(traceOfAction(k, 'sk_t_zap', 'meat')).toBe(0)
    expect(traceOfAction(k, 'sk_t_meat_only', 'meat')).toBe(6)
    expect(traceOfAction(k, 'sk_t_meat_only', 'net')).toBe(0)
    expect(traceOfAction(k, 'sk_t_plain', 'net')).toBe(0)
    const run = fixDice(new BattleRun(k, state, battle), Array(50).fill(3))
    const def = k.battle.getAction('sk_t_zap')!
    performAction(run, run.unit('a1'), def, { unit: 'f1' }, { action: 'sk_t_zap', target: { unit: 'f1' } })
    expect(battle.field.trace).toBe(23)
    performAction(run, run.unit('a1'), k.battle.getAction('sk_t_plain')!, { unit: 'f1' }, { action: 'sk_t_plain', target: { unit: 'f1' } })
    expect(battle.field.trace).toBe(23)
  })

  it('格式：trace 要是 1 以上的整數；兩欄都收', () => {
    const load = (patch: Rec) => () => {
      const k = createKernel(FEATURES)
      k.content.loadPack(RULES)
      k.content.loadPack({ id: 'x', content: { path: [TREE_T], ability: [FAKE[0], { ...FAKE[1], ...patch }] } } as unknown as ContentPack)
    }
    expect(load({ net: { target: 'enemy', trace: 2, do: [{ op: 'load', amount: 1 }] }, meat: { target: 'enemy', trace: 4, do: [{ op: 'load', amount: 1 }] } })).not.toThrow()
    expect(load({ net: { target: 'enemy', trace: 0, do: [{ op: 'load', amount: 1 }] } })).toThrow(/net\.trace/)
    expect(load({ meat: { target: 'enemy', trace: 1.5, do: [{ op: 'load', amount: 1 }] } })).toThrow(/meat\.trace/)
  })
})

describe('管理行動的消耗走真的 net.admin_spend（n 與 amount 一起帶）', () => {
  it('技能花 1 次管理行動：真的 netcombat 的 net.admin_spend 載得進來（它認 n）、用一次記一次；次數不夠灰掉', () => {
    const a = arena(setup([avatar(1, { netrunner: 1 }, ['sk_netrunner_master', 'sk_netrunner_not_home'])], [lace()]))
    turnTo(a, 'a1')
    expect(adminLeft(a.run(), a.a(1))).toBe(1)
    doAct(a, 'a1', { action: 'sk_netrunner_not_home' }, [20])
    expect(a.a(1).uses['turn:admin']).toBe(1)
    expect(opt(a, 'sk_netrunner_not_home')!.blocks.join('')).toMatch(/只剩 0 次/)
    expect(reasons(a, { action: 'sk_netrunner_not_home' }).join('')).toMatch(/0 次/)
  })
})

describe('整場打得完（AI 代打）：裝著四棵樹技能的內海戰鬥不會卡住', () => {
  it('四個人各帶一棵樹的技能對四隻蕾絲，AI 打到分出結果', () => {
    const a = arena(setup([
      avatar(1, { gunner: 3 }, ['sk_gunner_instinct', 'sk_gunner_aimed_shot', 'sk_gunner_burst']),
      avatar(2, { netrunner: 3 }, ['sk_netrunner_master', 'sk_netrunner_loop', 'sk_netrunner_stare']),
      avatar(3, { medic: 3 }, ['sk_medic_scalpel', 'sk_medic_dissection']),
      avatar(4, { pilot: 3 }, ['sk_pilot_formation', 'sk_pilot_cover_flight']),
    ], [lace({ ap: { now: 2, max: 2, regen: 2 } }), lace({ ap: { now: 2, max: 2, regen: 2 } }), lace({ ap: { now: 2, max: 2, regen: 2 } }), lace({ ap: { now: 2, max: 2, regen: 2 } })]))
    const run = a.run()
    for (let i = 0; i < 400 && !a.battle.result; i++) advance(run)
    expect(a.battle.result).toBeTruthy()
  })
})

// ===================================================================================================================
// 八、其餘的幾個（每一個各打一次：確認資料不是空殼）
// ===================================================================================================================

describe('槍手與潛網者：其餘每場一次、只在第一回合的小招', () => {
  const gunner = (ids: string[], o: Rec = {}, i = 1) => avatar(i, { gunner: 3 }, ids, o)
  const master = (ids: string[], o: Rec = {}) => avatar(1, { netrunner: 3 }, ['sk_netrunner_master', ...ids], o)

  it('就是你了（第一回合，敵人被全隊打命中 +1）、子彈時間（下一回合行動點回復 +1）、人槍合一（命中 +1）、獵眼（第一次瞄準過的攻擊命中 +1）', () => {
    const a = arena(setup([gunner(['sk_gunner_thats_you', 'sk_gunner_bullet_time', 'sk_gunner_gun_unity', 'sk_gunner_hunter_eye'])], [lace()]))
    turnTo(a, 'a1')
    doAct(a, 'a1', { action: 'sk_gunner_thats_you', target: { unit: 'f1' } })
    expect(modsOf(a, 'hit_against', 'f1', [], a.a(1))).toBe(1)
    doAct(a, 'a1', { action: 'sk_gunner_bullet_time' })
    expect(modsOf(a, 'ap_regen', 'a1')).toBe(1)
    expect(modsOf(a, 'hit', 'a1')).toBe(1)
    expect(modsOf(a, 'hit', 'a1', ['aimed'])).toBe(2)
    // 打過一次之後獵眼不算
    a.a(1).uses.attacks_made = 1
    expect(modsOf(a, 'hit', 'a1', ['aimed'])).toBe(1)
    // 第二回合不能用（就是你了只能第一回合）
    const b = arena(setup([gunner(['sk_gunner_thats_you'])], [lace()]))
    b.battle.round = 2
    turnTo(b, 'a1')
    expect(opt(b, 'sk_gunner_thats_you')!.blocks.join('')).toMatch(/第一回合/)
  })

  it('下一個！：攻擊讓目標倒下時，再扣 1 RAM 立刻攻擊另一個敵人；目標沒倒下就不再打', () => {
    const near = { load: { now: 19, max: 20 }, layers: 1, layersMax: 1 }
    const a = arena(setup([gunner(['sk_gunner_next_one'])], [lace(near), lace()]))
    turnTo(a, 'a1')
    expect(opt(a, 'sk_gunner_next_one')!.cost).toEqual({ ap: 2, ram: 1 })
    const ram = a.a(1).pools.ram!.now
    const l2 = a.f(2).load!.now
    doAct(a, 'a1', { action: 'sk_gunner_next_one', target: { unit: 'f1' }, pick: { next: 'f2' } }, [15, 6, 6, 6, 6, 6, 15])
    expect(a.f(1).out).toBeTruthy()
    expect(a.a(1).pools.ram!.now).toBe(ram - 2)
    expect(a.f(2).load!.now).toBeGreaterThan(l2)
    // 沒倒下：不扣第二次 RAM
    const b = arena(setup([gunner(['sk_gunner_next_one'])], [lace(), lace()]))
    turnTo(b, 'a1')
    const r2 = b.a(1).pools.ram!.now
    doAct(b, 'a1', { action: 'sk_gunner_next_one', target: { unit: 'f1' }, pick: { next: 'f2' } }, [15])
    expect(b.a(1).pools.ram!.now).toBe(r2 - 1)
    expect(b.f(2).load!.now).toBe(0)
  })

  it('還給你～：沒打中自己或相鄰的隊友時，花 1 行動點與 1 RAM 朝那個敵人攻擊一次；每場 1 次', () => {
    const a = arena(setup([gunner(['sk_gunner_right_back'])], [lace()]))
    const ram = a.a(1).pools.ram!.now
    const run = a.run([1, 15, ...FILL])
    run.attack(a.f(1), a.a(1), {})
    expect(a.f(1).load!.now).toBeGreaterThan(0)
    expect(a.a(1).pools.ram!.now).toBe(ram - 1)
    expect(a.a(1).uses.sk_gunner_right_back).toBe(1)
    a.f(1).load!.now = 0
    a.a(1).ap.now = a.a(1).ap.max
    const again = a.run([1, 15, ...FILL])
    again.attack(a.f(1), a.a(1), {})
    expect(a.f(1).load!.now).toBe(0)
  })

  it('掩護射擊：相鄰的隊友被攻擊時，那次攻擊的命中 −1（每場 1 次）；掩護撤退、跑位射擊：換位', () => {
    const a = arena(setup([gunner(['sk_gunner_cover_fire']), gunner([], {}, 2), gunner([], {}, 3)], [lace()]))
    const run = a.run([15, ...FILL])
    run.attack(a.f(1), a.a(2), {})
    expect(a.a(1).uses.sk_gunner_cover_fire).toBe(1)
    expect(a.a(1).ap.now).toBe(a.a(1).ap.max - 2)
    const roll = run.beats.find((b) => b.roll)!.roll!
    expect(roll.parts.some((p) => p.value === -1 && p.source === 'skill')).toBe(true)
    // 第二次不再觸發
    const again = a.run([15, ...FILL])
    again.attack(a.f(1), a.a(2), {})
    expect(a.a(1).uses.sk_gunner_cover_fire).toBe(1)
    // 掩護撤退：讓相鄰的隊友換到另一格（和那一格的人對調）
    const b = arena(setup([gunner(['sk_gunner_covering_retreat']), gunner([], {}, 2), gunner([], {}, 3)], [lace()]))
    turnTo(b, 'a1')
    doAct(b, 'a1', { action: 'sk_gunner_covering_retreat', pick: { mate: 'a2', slot: 3 } })
    expect([b.a(2).slot, b.a(3).slot]).toEqual([3, 2])
    // 跑位射擊：自己換到相鄰的格再攻擊
    const c = arena(setup([gunner(['sk_gunner_run_and_gun']), gunner([], {}, 2)], [lace()]))
    turnTo(c, 'a1')
    doAct(c, 'a1', { action: 'sk_gunner_run_and_gun', target: { unit: 'f1' }, pick: { slot: 2 } }, [15])
    expect(c.a(1).slot).toBe(2)
    expect(c.f(1).load!.now).toBeGreaterThan(0)
  })

  it('灌頂：4d6 感載，目標帶著閃斷時再 +1d6；改寫地形（拆牆一次兩格）與封鎖（敵方整排遮蔽降一級）', () => {
    const a = arena(setup([master(['sk_netrunner_inject'])], [lace({ load: { now: 0, max: 100 } })]))
    turnTo(a, 'a1')
    expect(opt(a, 'sk_netrunner_inject')!.cost).toEqual({ ap: 2, ram: 4 })
    doAct(a, 'a1', { action: 'sk_netrunner_inject', target: { unit: 'f1' } }, [20, 5, 5, 5, 5])
    expect(a.f(1).load!.now).toBe(20)
    a.f(1).load!.now = 0
    a.run().applyStatus(a.f(1), 'flash', { quiet: true })
    a.a(1).ap.now = 20
    a.a(1).pools.ram!.now = 8
    doAct(a, 'a1', { action: 'sk_netrunner_inject', target: { unit: 'f1' } }, [20, 5, 5, 5, 5, 5])
    expect(a.f(1).load!.now).toBe(25)
    // 拆牆：目標那一格與玩家選的另一格各降一級（檢定過了）
    const c = arena(setup([master(['sk_netrunner_rewrite_terrain'])], [lace(), lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 2, 2, 0] } }))
    turnTo(c, 'a1')
    expect(opt(c, 'sk_netrunner_rewrite_terrain')!.cost).toEqual({ ap: 0, ram: 2 })
    doAct(c, 'a1', { action: 'sk_netrunner_rewrite_terrain', target: { side: 'foe', slot: 1 }, pick: { also: 2 } }, [20])
    expect(c.battle.cover.foe.map((x) => x.level)).toEqual([1, 1, 2, 0])
    // 封鎖：每場一次，敵方每一格降一級
    const d = arena(setup([master(['sk_netrunner_lockdown'])], [lace(), lace()], { cover: { ally: [0, 0, 0, 0], foe: [2, 2, 1, 0] } }))
    turnTo(d, 'a1')
    doAct(d, 'a1', { action: 'sk_netrunner_lockdown' }, [20])
    expect(d.battle.cover.foe.map((x) => x.level).slice(0, 2)).toEqual([1, 1])
    expect(opt(d, 'sk_netrunner_lockdown')!.blocks.join('')).toMatch(/用過了/)
  })
})
