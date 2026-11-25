// 驗收測試：dev/work/M4-abilities-m4.md（cpp-feature）。技能在 M4 的部分：條件 ability 與日常技能（daily.kind）、技能給衍生數值的鍵（stats）、
// 夜課延伸的技能裝進橋（outside）、橋的三個數字（cap_discount／cap_flex／ram_discount）、花歷練點升基本功與洗點、容量變小時的提醒、
// 改造師樹的測試資料（日常標 daily.kind、戰地手術的現實欄 wound_treat／implant_install）。
// 規格：SKILLS 1.2、1.11 節；SKILL_TREES 改造師「預備與日常」；CORE_RULES 6.4、7.2 節；DATA 2、3.1 節；CYBERWARE 7.1 節；LEWD_SYSTEM 10 節；dev/adr/0019 第三、十節。
// 內容一律是測試自帶的假資料（改造師那一組用 tests/fixtures/skills）；別的功能（at_home、at_facility、委託副本、night_skill 這個內容種類）用測試臨時註冊的替身。
// 設計書與工單不一致的一處：工單寫 `daily?: string`，DATA 第 2 節寫 daily 是一個物件（既有的格式與白箱測試也要求物件或 null），所以種類寫在 daily.kind。

import { describe, expect, it } from 'vitest'
import type { BattleSetup, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, BattleRun, clone, createKernel, readyFeatures, setupBattle, toMinutes } from '../../src'
import {
  CAP_FLEX_STAT, DEFAULT_ABILITY_RULES, NEEDS_TEACHER, abilitiesFeature, abilitiesOf, abilityRules, capCostOf, capacityBlock, capacityOf, equipAbilities, learnBlock, learnedOutside,
  respecBlock, respecDraft, respecQuote, skillUpBlock, skillUpDraft,
} from '../../src/features/abilities'
import type { Capacity } from '../../src/features/abilities'
import { characterFeature } from '../../src/features/character'
import { combatFeature } from '../../src/features/combat'
import { cyberwareFeature } from '../../src/features/cyberware'
import { deckFeature } from '../../src/features/deck'
import { hackFeature } from '../../src/features/hack'
import { netcombatFeature } from '../../src/features/netcombat'
import { summonsFeature } from '../../src/features/summons'
import { lewdFeature } from '../../src/features/lewd'
import { medicalFeature } from '../../src/features/medical'
import { worldFeature } from '../../src/features/world'
import { fixDice, makeActor, makeGame, makeState } from '../../src/testkit'
import { MEDIC, medicM4 } from '../fixtures/skills'
import { TEST_STATUSES, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料
// ===================================================================================================================

const feature = (id: string, install: (k: Kernel) => void): Feature => ({ id, install })
const tree = (id: string, signature: string, category: string): Rec => ({ id, name: id, tree: `${id} 樹`, category, signature, domains: { meat: 'strong', net: 'strong', opinion: 'none' }, resonance: [] })
const sk = (id: string, path: string, category: string, kind: string, cap: number, more: Rec = {}): Rec => {
  const tier = (more.tier as number | undefined) ?? 1
  return { id, name: id, path, category, tier, layer: 'front', kind, cap, xp: tier * 20, cells: 1, text: `${id}。`, meat: null, net: null, opinion: null, after: path === 'surg' ? 'sk_scalpel' : 'sk_net_root', ...more }
}
const EVADE = { meat: { mods: [{ kind: 'evade', value: 1 }] } }

const ABILITIES: Rec[] = [
  // 手術刀樹：招牌帶 stats（沉溺成本的減免）；手術與解剖是日常（kind: 'daily'，完全不寫 meat、net、opinion）
  sk('sk_scalpel', 'surg', 'meat', 'passive', 3, { layer: 'signature', after: undefined, stats: [{ stat: 'surgery_sink_pct', per_tier: -5, min: -25 }], ...EVADE }),
  (() => { const a = sk('sk_surgery', 'surg', 'meat', 'daily', 1, { layer: 'back', daily: { kind: 'surgery', text: '自己動刀。' } }); delete a.meat; delete a.net; delete a.opinion; return a })(),
  sk('sk_dissect', 'surg', 'meat', 'daily', 1, { layer: 'back', daily: { kind: 'dissect', text: '戰後解剖。' } }),
  sk('sk_gauge', 'surg', 'meat', 'passive', 1, { stats: [{ stat: 'test_gauge', amount: 30, per_tier: -12, min: -25, max: 15 }], ...EVADE }),
  // 現實型的被動：佔 3、佔 1；一個佔 2 的主動（不吃被動的減免）
  sk('sk_pas3a', 'surg', 'meat', 'passive', 3, EVADE), sk('sk_pas3b', 'surg', 'meat', 'passive', 3, EVADE), sk('sk_pas3c', 'surg', 'meat', 'passive', 3, EVADE), sk('sk_pas3d', 'surg', 'meat', 'passive', 3, EVADE),
  sk('sk_pas1', 'surg', 'meat', 'passive', 1, EVADE),
  sk('sk_act2', 'surg', 'meat', 'active', 2, { use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'damage', amount: 1, type: 'physical' }] } }),
  // 內海型的主動：花 2 RAM、花 1 RAM
  sk('sk_net_root', 'net', 'net', 'passive', 1, { layer: 'signature', after: undefined }),
  sk('sk_net_zap2', 'net', 'net', 'active', 2, { use: { ap: 1, ram: 2 }, meat: { target: 'enemy', do: [{ op: 'damage', amount: 1, type: 'physical' }] } }),
  sk('sk_net_zap1', 'net', 'net', 'active', 1, { use: { ap: 1, ram: 1 }, meat: { target: 'enemy', do: [{ op: 'damage', amount: 1, type: 'physical' }] } }),
]
const IDS = (ids: string[]) => ids
const SIX = ['sk_scalpel', 'sk_surgery', 'sk_dissect', 'sk_pas3a', 'sk_pas3b', 'sk_pas1'] // 六個 1 階：這棵樹累計 120 點，開到 3 階

const NIGHT: Rec[] = [
  { id: 'nt_a', name: '牽著走', branch: 'relation', tier: 3, tag: '支配', tags: ['支配'], text: '你用一隻手扣住對方的後頸。', outside: { cap: 2, kind: 'passive', domain_scale: 'weak', ...EVADE } },
  { id: 'nt_b', name: '輕撫', branch: 'sense', tier: 1, tag: '感官', text: '指尖輕輕滑過。' },
  { id: 'nt_c', name: '別人的故事', branch: 'costume', tier: 2, tag: 'ntr', tags: ['ntr'], text: '一段故事。', outside: { cap: 1, kind: 'passive', ...EVADE } },
  { id: 'nt_d', name: '沒學過的', branch: 'common', tier: 1, tag: '共通', text: '沒學過。', outside: { cap: 1, kind: 'passive', ...EVADE } },
  { id: 'nt_big1', name: '很吃容量一', branch: 'body', tier: 5, tag: '身體', text: '很吃容量。', outside: { cap: 6, kind: 'passive', ...EVADE } },
  { id: 'nt_big2', name: '很吃容量二', branch: 'body', tier: 5, tag: '身體', text: '很吃容量。', outside: { cap: 6, kind: 'passive', ...EVADE } },
  { id: 'nt_act', name: '一個動作', branch: 'body', tier: 2, tag: '身體', text: '一個動作。', outside: { cap: 1, kind: 'active', use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'damage', amount: 1, type: 'physical' }] } } },
]

const PACK: ContentPack = {
  id: 'abilities_m4',
  content: {
    battle_status: TEST_STATUSES,
    skill: [{ id: 'firearms', name: '槍械', attr: 'reflex', desc: '槍械。' }, { id: 'brawl', name: '格鬥', attr: 'body', desc: '格鬥。' }],
    path: [tree('surg', 'sk_scalpel', 'meat'), tree('net', 'sk_net_root', 'net')],
    ability: ABILITIES,
  },
} as unknown as ContentPack
const NIGHT_PACK: ContentPack = { id: 'night_m4', content: { night_skill: NIGHT } } as unknown as ContentPack
const rulePack = (rule: Rec): ContentPack => ({ id: 'rule_m4', content: { ability_rule: [{ id: 'default', ...rule }] } }) as unknown as ContentPack

// ---- 替身（別的功能） ----

/** 衍生數值：手術刀的沉溺減免與一個測試用的（cyberware 與別的功能正式定義）。 */
const STATS = feature('stats_stub', (k) => {
  if (!k.stats.hasStat('surgery_sink_pct')) k.stats.defineStat({ id: 'surgery_sink_pct', owner: 'stats_stub', name: '手術的沉溺成本加減（%）', base: () => 0, min: -100, max: 100 })
  k.stats.defineStat({ id: 'test_gauge', owner: 'stats_stub', name: '測試用', base: () => 0, min: -100, max: 100 })
})
/** 橋的機能（cyberware 的義體 effects 之外的另一種寫法）：旗標是數字就給那個衍生數值。 */
const BRIDGE_STUB = feature('bridge_stub', (k) => {
  for (const id of ['cap_discount_meat', 'cap_flex', 'ram_discount_net']) {
    k.stats.addStatProvider(id, 'bridge_stub', (state) => (typeof state.flags[id] === 'number' ? [{ label: '橋的機能', value: state.flags[id] as number, source: 'cyber' }] : []))
  }
})
/** 夜課的內容種類（scene 定義；這裡只放最少的格式）。 */
const NIGHT_KIND = feature('night_kind_stub', (k) => k.content.defineKind({ kind: 'night_skill', owner: 'night_kind_stub', validate: () => [] }))
/** at_home（旗標 home）、at_facility（旗標 fac 是設施的種類；寫了 types 就要在其中）。 */
const PLACES = feature('places_stub', (k) => {
  k.conditions.register({ kind: 'at_home', owner: 'places_stub', validate: () => [], test: (_c, { state }) => state.flags.home === true })
  k.conditions.register<{ kind: string; types?: string[] }>({
    kind: 'at_facility', owner: 'places_stub', validate: () => [],
    test: (c, { state }) => (typeof state.flags.fac === 'string' ? (c.types ? c.types.includes(state.flags.fac) : true) : false),
  })
})
const COMMISSION = feature('commission_stub', (k) =>
  k.activity.define({ kind: 'commission', owner: 'commission_stub', order: 90, active: (s) => (s.flags.in_commission === true ? { id: 'cm', label: '委託副本' } : null), allow: [], reason: () => '委託副本進行中。' }))

const FEATS = [combatFeature, abilitiesFeature, BRIDGE_STUB, PLACES, COMMISSION]
/** 衍生數值的替身排在最後（cyberware 裝著時它自己定義 surgery_sink_pct）。 */
const withStats = (o: Opts): Feature[] => [...FEATS, ...(o.features ?? []), STATS]

// ---- 建一局 ----

/** 學會的技能 ids 對應的 spent（照每個技能的 xp 加到它那棵樹）。 */
const spentOf = (ids: string[]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const id of ids) {
    const a = ABILITIES.find((x) => x.id === id)
    if (a) out[a.path] = (out[a.path] ?? 0) + a.xp
  }
  return out
}
const BRIDGE8 = { capacity: { meat: 8, net: 8, social: 8, media: 8 } }
interface Opts {
  learned?: string[]
  equipped?: string[]
  xp?: number
  features?: Feature[]
  packs?: ContentPack[]
  flags?: Rec
  pc?: Rec
  money?: { cred: number; cash: number }
  scene?: Rec
  actors?: Rec[]
}
const make = (o: Opts = {}) => {
  const learned = o.learned ?? []
  const { game } = makeGame({
    features: withStats(o), content: [PACK, ...(o.packs ?? [])], seed: 7,
    pc: { skills: { firearms: 0, brawl: 3 }, ...(o.pc ?? {}), ext: { bridge: BRIDGE8, abilities: { xp: o.xp ?? 0, learned, equipped: o.equipped ?? [], spent: spentOf(learned) }, ...(o.scene ? { scene: o.scene } : {}), ...(o.pc?.ext ?? {}) } },
    ...(o.actors ? { actors: o.actors as never } : {}),
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: o.money ?? { cred: 5000, cash: 300 }, flags: { home: true, ...(o.flags ?? {}) } } as never,
  })
  return game
}
type G = ReturnType<typeof make>
const pc = (g: G) => g.state.actors.pc!
const stat = (g: G, id: string, who = 'pc') => g.k.stats.stat(g.state, who, id)
const cond = (g: G, c: Rec, ctx: Rec = {}) => g.k.conditions.test(c as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules, ...ctx })
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}
const draft = (changes: ReportDraft['changes'], action = 'test.step'): ReportDraft => ({
  kind: 'action', action, location: { district: 'test' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' },
})

// ---- 不經過提交的一場戰鬥（功能與內容都載好；單位用 actor 指到狀態裡的主角） ----

interface World { k: Kernel; state: GameState; battle: ReturnType<typeof setupBattle>['battle']; run(): BattleRun; ally(i: number): ReturnType<typeof one> & Rec }
function fight(o: Opts = {}): World {
  const k = createKernel(withStats(o))
  k.content.loadPack(PACK)
  for (const p of o.packs ?? []) k.content.loadPack(p)
  readyFeatures(k)
  const learned = o.learned ?? []
  const state = makeState({ pc: { ext: { abilities: { xp: 0, learned, equipped: o.equipped ?? [], spent: spentOf(learned) }, ...(o.scene ? { scene: o.scene } : {}) } }, patch: { flags: o.flags ?? {}, ...(o.scene ? {} : {}) } as never })
  const setup: BattleSetup = duel([one({ actor: 'pc', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 } } as never), one({ weapon: 'pistol' } as never, 2)], [foe('minion', { weapon: 'pistol' } as never)])
  const battle = clone(setupBattle(k, state, setup).battle)
  return { k, state, battle, run: () => fixDice(new BattleRun(k, state, battle), Array(80).fill(10)), ally: (i) => battle.units[`a${i}`] as never }
}
const evadeOf = (w: World, id = 'a1'): number => {
  const run = w.run()
  return run.mods('evade' as never, run.unit(id), undefined, undefined, []).filter((p) => p.source === 'skill').reduce((s, p) => s + p.value, 0)
}

// ===================================================================================================================
// 條件 ability 與 daily
// ===================================================================================================================

describe('條件 ability：學會、裝著、日常；看誰', () => {
  it('學會但沒裝：{ id } 成立、{ id, equipped: true } 不成立；裝上之後都成立；沒學的都不成立', () => {
    const g = make({ learned: SIX, equipped: [] })
    expect(cond(g, { kind: 'ability', id: 'sk_pas1' })).toBe(true)
    expect(cond(g, { kind: 'ability', id: 'sk_pas1', equipped: true })).toBe(false)
    expect(cond(g, { kind: 'ability', id: 'sk_act2' })).toBe(false)
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_pas1']))
    expect(cond(g, { kind: 'ability', id: 'sk_pas1', equipped: true })).toBe(true)
    expect(cond(g, { kind: 'ability', id: 'sk_pas1' })).toBe(true)
  })

  it('{ daily: "surgery" } 只在裝著的時候成立（學會但沒裝不算）；別種日常、沒有這種日常的技能不算', () => {
    const g = make({ learned: SIX })
    expect(cond(g, { kind: 'ability', daily: 'surgery' })).toBe(false)
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_surgery']))
    expect(cond(g, { kind: 'ability', daily: 'surgery' })).toBe(true)
    expect(cond(g, { kind: 'ability', daily: 'dissect' })).toBe(false)
    expect(cond(g, { kind: 'ability', daily: 'workshop' })).toBe(false)
    // id 與 daily 一起寫：兩個都要成立
    expect(cond(g, { kind: 'ability', id: 'sk_surgery', daily: 'surgery' })).toBe(true)
    // 兩個條件各自成立（id 與 daily 不必是同一個技能）；只要有一邊不成立就不成立
    expect(cond(g, { kind: 'ability', id: 'sk_act2', daily: 'surgery' })).toBe(false)
    expect(cond(g, { kind: 'ability', id: 'sk_surgery', daily: 'dissect' })).toBe(false)
    // 組合條件、取反照常
    expect(cond(g, { kind: 'not', of: { kind: 'ability', daily: 'dissect' } })).toBe(true)
  })

  it('who 指到名冊上的人：看的是他，不是主角；ctx.actor 也一樣；沒有這個人是不成立', () => {
    const buddy = makeActor({ id: 'buddy', name: '夥伴', role: 'companion', ext: { abilities: { xp: 0, learned: ['sk_surgery'], equipped: ['sk_surgery'], spent: { surg: 20 } } } })
    const g = make({ learned: SIX, actors: [buddy] })
    expect(cond(g, { kind: 'ability', daily: 'surgery' })).toBe(false)
    expect(cond(g, { kind: 'ability', daily: 'surgery', who: 'buddy' })).toBe(true)
    expect(cond(g, { kind: 'ability', daily: 'surgery' }, { actor: 'buddy' })).toBe(true)
    // who 蓋過 ctx.actor
    expect(cond(g, { kind: 'ability', daily: 'surgery', who: 'pc' }, { actor: 'buddy' })).toBe(false)
    expect(cond(g, { kind: 'ability', daily: 'surgery', who: 'nobody' })).toBe(false)
  })

  it('夥伴（沒有自己的學習紀錄、有 ext.paths）：路數那棵樹階數以內的技能算學會也算裝著', () => {
    const mate = makeActor({ id: 'mate', name: '助手', role: 'companion', ext: { paths: [{ path: 'surg', tier: 1 }] } })
    const g = make({ actors: [mate] })
    expect(cond(g, { kind: 'ability', daily: 'surgery', who: 'mate' })).toBe(true)
    expect(cond(g, { kind: 'ability', id: 'sk_pas1', equipped: true, who: 'mate' })).toBe(true)
    expect(cond(g, { kind: 'ability', id: 'sk_net_zap2', who: 'mate' })).toBe(false)
  })

  it('格式：要寫 id 或 daily 其中一個、不認得的欄位、型別不對都被擋下', () => {
    const g = make()
    const bad = (c: Rec): string[] => g.k.conditions.validate(c)
    expect(bad({ kind: 'ability', id: 'sk_pas1' })).toEqual([])
    expect(bad({ kind: 'ability', daily: 'surgery', who: 'buddy', equipped: true })).toEqual([])
    expect(bad({ kind: 'ability' }).join('')).toMatch(/id.*daily/)
    expect(bad({ kind: 'ability', id: 'x', extra: 1 }).join('')).toMatch(/extra/)
    expect(bad({ kind: 'ability', id: 3 }).join('')).toMatch(/id/)
    expect(bad({ kind: 'ability', daily: '' }).join('')).toMatch(/daily/)
    expect(bad({ kind: 'ability', id: 'x', equipped: 'yes' }).join('')).toMatch(/equipped/)
  })
})

describe('日常技能的格式（daily.kind）', () => {
  const load = (patch: Rec, drop: string[] = []) => () => {
    const k = createKernel(FEATS)
    const extra = { ...sk('sk_x', 'surg', 'meat', 'daily', 1, { layer: 'back', ...patch }) }
    for (const key of drop) delete extra[key]
    k.content.loadPack({ id: 'bad', content: { ...PACK.content, ability: [...(PACK.content.ability as unknown[]), extra] } } as unknown as ContentPack)
    readyFeatures(k)
  }

  it('日常技能（kind 是 daily）可以完全不寫 meat、net、opinion；別種技能還是要寫', () => {
    expect(load({ daily: { kind: 'surgery' } }, ['meat', 'net', 'opinion'])).not.toThrow()
    expect(load({ kind: 'passive', daily: { kind: 'surgery' } }, ['meat'])).toThrow(/要有 meat/)
  })

  it('daily.kind 要是非空字串；daily 還是物件或 null', () => {
    expect(load({ daily: { kind: '' } })).toThrow(/daily\.kind/)
    expect(load({ daily: { kind: 3 } })).toThrow(/daily\.kind/)
    expect(load({ daily: 'surgery' })).toThrow(/daily 要是物件或 null/)
    expect(load({ daily: { text: '只有說明，沒有種類' } })).not.toThrow()
  })

  it('stats 的格式：每一筆要有 stat 與 amount 或 per_tier；數字、min 不超過 max、不認得的欄位', () => {
    expect(load({ stats: [{ stat: 'a', amount: 1 }, { stat: 'b', per_tier: -5, min: -25, max: 0 }] })).not.toThrow()
    expect(load({ stats: 'x' })).toThrow(/stats 要是/)
    expect(load({ stats: [{ amount: 1 }] })).toThrow(/stats\[0\]/)
    expect(load({ stats: [{ stat: 'a' }] })).toThrow(/amount 或 per_tier/)
    expect(load({ stats: [{ stat: 'a', amount: 'x' }] })).toThrow(/amount 要是數字/)
    expect(load({ stats: [{ stat: 'a', amount: 1, min: 3, max: 1 }] })).toThrow(/min 不能比 max 大/)
    expect(load({ stats: [{ stat: 'a', amount: 1, bogus: 1 }] })).toThrow(/bogus/)
  })

  it('裝著帶 daily.kind 是 dissect 的技能的人，進現實的戰鬥時單位有標籤 dissect；沒裝就沒有', () => {
    const on = fight({ learned: SIX, equipped: ['sk_dissect'] })
    expect(on.ally(1).tags).toContain('dissect')
    const off = fight({ learned: SIX, equipped: ['sk_surgery'] })
    expect(off.ally(1).tags).not.toContain('dissect')
    const none = fight({ learned: SIX })
    expect(none.ally(1).tags).not.toContain('dissect')
  })
})

// ===================================================================================================================
// stats：技能給衍生數值
// ===================================================================================================================

describe('stats 鍵：裝著時給衍生數值加減（手術刀的沉溺減免）', () => {
  it('手術刀（每階 −5%，最多 −25%）：樹開到 3 階是 −15；沒裝是 0；裝上、卸下跟著變', () => {
    const g = make({ learned: SIX, xp: 0 })
    expect(abilitiesOf(g.state, 'pc').spent.surg).toBe(120)
    expect(stat(g, 'surgery_sink_pct')).toBe(0)
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_scalpel']))
    expect(stat(g, 'surgery_sink_pct')).toBe(-15)
    const parts = g.k.stats.statParts(g.state, 'pc', 'surgery_sink_pct').filter((p) => p.source === 'skill')
    expect(parts.map((p) => [p.label, p.value])).toEqual([['sk_scalpel', -15]])
    g.commit(equipAbilities(g.k, g.state, 'pc', []))
    expect(stat(g, 'surgery_sink_pct')).toBe(0)
  })

  it('樹的階越高減越多，到 −25 為止：1 階 −5、5 階 −25', () => {
    const at = (spent: number) => {
      const g = make({ learned: ['sk_scalpel'], equipped: ['sk_scalpel'] })
      pc(g).ext.abilities = { ...(pc(g).ext.abilities as Rec), spent: { surg: spent } }
      return stat(g, 'surgery_sink_pct')
    }
    expect([at(0), at(40), at(120), at(240), at(400)]).toEqual([-5, -10, -15, -20, -25])
  })

  it('amount ＋ per_tier × 階，夾在 min～max（夾的是這一筆）：階 1 到 5 是 15、6、−6、−18、−25', () => {
    const at = (spent: number) => {
      const g = make({ learned: ['sk_gauge'], equipped: ['sk_gauge'] })
      pc(g).ext.abilities = { ...(pc(g).ext.abilities as Rec), spent: { surg: spent } }
      return stat(g, 'test_gauge')
    }
    expect([at(0), at(40), at(120), at(240), at(400)]).toEqual([15, 6, -6, -18, -25])
  })

  it('夥伴（沒有自己的學習紀錄）看路數那一列的階：他的技能算裝著，階數照 ext.paths', () => {
    const mate = makeActor({ id: 'mate', name: '助手', role: 'companion', ext: { paths: [{ path: 'surg', tier: 3 }] } })
    const g = make({ actors: [mate] })
    expect(stat(g, 'surgery_sink_pct', 'mate')).toBe(-15)
    expect(stat(g, 'surgery_sink_pct')).toBe(0)
  })
})

// ===================================================================================================================
// 夜課延伸的技能
// ===================================================================================================================

describe('夜課延伸的技能（outside）：night:<id>、社交類、佔 outside.cap', () => {
  const night = (o: Opts = {}) => make({ features: [NIGHT_KIND], packs: [NIGHT_PACK], scene: { skills: ['nt_a', 'nt_b', 'nt_c'] }, ...o })

  it('learnedOutside 只列學會的、有 outside 的、標籤沒被篩選關掉的；沒學的、沒有 outside 的不列', () => {
    const g = night()
    expect(learnedOutside(g.k, g.state, 'pc')).toEqual(['night:nt_a', 'night:nt_c'])
    g.state.rules.contentOff = ['ntr']
    expect(learnedOutside(g.k, g.state, 'pc')).toEqual(['night:nt_a'])
    g.state.rules.contentOff = ['支配']
    expect(learnedOutside(g.k, g.state, 'pc')).toEqual(['night:nt_c'])
  })

  it('可以用現有的裝卸入口裝進橋：佔社交 2 點；卸下之後不佔', () => {
    const g = night()
    g.commit(equipAbilities(g.k, g.state, 'pc', ['night:nt_a']))
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['night:nt_a'])
    expect(capacityOf(g.k, g.state, 'pc')).toMatchObject({ social: { used: 2, max: 8 }, meat: { used: 0 } })
    g.commit(equipAbilities(g.k, g.state, 'pc', []))
    expect(capacityOf(g.k, g.state, 'pc').social.used).toBe(0)
  })

  it('容量不夠就裝不上：兩個佔 6 的夜課（12）在社交 8 裝不下；一個佔 6 加一個佔 2 剛好 8', () => {
    const g = night({ scene: { skills: ['nt_a', 'nt_big1', 'nt_big2'] } })
    expect(() => equipAbilities(g.k, g.state, 'pc', ['night:nt_big1', 'night:nt_big2'])).toThrow('社交型的容量不夠（要 12，橋只有 8）。')
    g.commit(equipAbilities(g.k, g.state, 'pc', ['night:nt_big1', 'night:nt_a']))
    expect(capacityOf(g.k, g.state, 'pc').social).toEqual({ used: 8, max: 8 })
    // 其他類的容量不受影響
    expect(capacityOf(g.k, g.state, 'pc').meat.used).toBe(0)
  })

  it('沒學的、被篩選關掉的、不存在的、沒有 outside 的：裝不上並說原因', () => {
    const g = night()
    expect(() => equipAbilities(g.k, g.state, 'pc', ['night:nt_d'])).toThrow('還沒學會沒學過的。')
    expect(() => equipAbilities(g.k, g.state, 'pc', ['night:nt_b'])).toThrow('沒有這個技能。')
    expect(() => equipAbilities(g.k, g.state, 'pc', ['night:nt_zzz'])).toThrow('沒有這個技能。')
    g.state.rules.contentOff = ['ntr']
    expect(() => equipAbilities(g.k, g.state, 'pc', ['night:nt_c'])).toThrow('別人的故事現在用不了（內容篩選關掉了這個題材）。')
    // 夜課的技能不能用歷練點學
    expect(learnBlock(g.k, g.state, 'pc', 'night:nt_a')).toBe('夜課的技能要在夜課學，這裡只能裝上。')
  })

  it('裝著才生效：被動的修正在戰鬥裡算（evade +1）；卸下之後沒有；標籤被篩選關掉時已經裝著的也不生效', () => {
    const scene = { skills: ['nt_a', 'nt_b', 'nt_c'] }
    const on = fight({ features: [NIGHT_KIND], packs: [NIGHT_PACK], scene, equipped: ['night:nt_a'] })
    expect((on.ally(1).ext.abilities as Rec).equipped).toEqual(['night:nt_a'])
    expect(evadeOf(on)).toBe(1)
    const off = fight({ features: [NIGHT_KIND], packs: [NIGHT_PACK], scene, equipped: [] })
    expect(evadeOf(off)).toBe(0)
    const filtered = (() => {
      const k = createKernel([...FEATS, NIGHT_KIND])
      k.content.loadPack(PACK)
      k.content.loadPack(NIGHT_PACK)
      readyFeatures(k)
      const state = makeState({ pc: { ext: { abilities: { xp: 0, learned: [], equipped: ['night:nt_a'], spent: {} }, scene } }, patch: { rules: { contentOff: ['支配'] } } as never })
      const setup = duel([one({ actor: 'pc', weapon: 'pistol' } as never)], [foe('minion', { weapon: 'pistol' } as never)])
      const battle = clone(setupBattle(k, state, setup).battle)
      return { k, state, battle, run: () => new BattleRun(k, state, battle), ally: (i: number) => battle.units[`a${i}`] } as unknown as World
    })()
    expect((filtered.ally(1).ext.abilities as Rec).equipped).toEqual([])
    expect(evadeOf(filtered)).toBe(0)
  })

  it('主動的夜課延伸技能有自己的戰鬥行動 night:<id>；裝著才列', () => {
    const w = fight({ features: [NIGHT_KIND], packs: [NIGHT_PACK], scene: { skills: ['nt_act'] }, equipped: ['night:nt_act'] })
    const def = w.k.battle.getAction('night:nt_act')
    expect(def).toBeDefined()
    const run = w.run()
    expect(def!.has!(run, run.unit('a1'))).toBe(true)
    expect(def!.has!(run, run.unit('a2'))).toBe(false)
  })

  it('outside 的格式：cap 要 1～6、kind 在清單裡、domain_scale 只能是強度、不認得的欄位；沒有 cap 的載入時被擋', () => {
    const load = (outside: unknown) => () => {
      const k = createKernel([...FEATS, NIGHT_KIND])
      k.content.loadPack(PACK)
      k.content.loadPack({ id: 'n', content: { night_skill: [{ id: 'nt_bad', name: '壞的', tag: '共通', outside }] } } as unknown as ContentPack)
      readyFeatures(k)
    }
    expect(load({ cap: 2, kind: 'passive', domain_scale: 'weak', ...EVADE })).not.toThrow()
    expect(load({ kind: 'passive' })).toThrow(/night_skill\/nt_bad：outside\.cap/)
    expect(load({ cap: 9 })).toThrow(/outside\.cap/)
    expect(load({ cap: 1, kind: 'nope' })).toThrow(/outside\.kind/)
    expect(load({ cap: 1, domain_scale: 'huge' })).toThrow(/domain_scale/)
    expect(load({ cap: 1, bogus: 1 })).toThrow(/bogus/)
    expect(load({ cap: 1, meat: { mods: [{ kind: 'evade' }] } })).toThrow(/outside\.meat/)
    expect(load('x')).toThrow(/outside 要是物件/)
  })

  it('沒有人定義 night_skill 的 kernel：整段不作用（learnedOutside 是空的、night: 的 id 查不到）', () => {
    const g = make({ scene: { skills: ['nt_a'] } })
    expect(learnedOutside(g.k, g.state, 'pc')).toEqual([])
    expect(() => equipAbilities(g.k, g.state, 'pc', ['night:nt_a'])).toThrow('沒有這個技能。')
  })
})

// ===================================================================================================================
// 橋的三個數字
// ===================================================================================================================

describe('橋的三個數字：cap_discount_<類>、cap_flex、ram_discount_<類>', () => {
  it('abilities 定義這幾個衍生數值，基本是 0', () => {
    const g = make()
    for (const id of ['cap_discount_meat', 'cap_discount_net', 'cap_discount_social', 'cap_discount_media', 'ram_discount_meat', 'ram_discount_net', 'ram_discount_social', 'ram_discount_media', CAP_FLEX_STAT]) {
      expect(g.k.stats.hasStat(id), id).toBe(true)
      expect(stat(g, id), id).toBe(0)
    }
  })

  it('cap_discount_meat 是 1：佔 3 的現實被動只佔 2、佔 1 的還是 1；主動技能不吃這個減免；沒有減免時照舊', () => {
    const ids = ['sk_pas3a', 'sk_pas1', 'sk_act2']
    const plain = make({ learned: [...SIX, 'sk_act2'], equipped: ids })
    expect(capacityOf(plain.k, plain.state, 'pc').meat.used).toBe(6)
    const g = make({ learned: [...SIX, 'sk_act2'], equipped: ids, flags: { cap_discount_meat: 1 } })
    expect(capacityOf(g.k, g.state, 'pc').meat.used).toBe(3 - 1 + 1 + 2)
    expect(capCostOf({ kind: 'passive', cap: 3 }, 1)).toBe(2)
    expect(capCostOf({ kind: 'passive', cap: 1 }, 1)).toBe(1)
    expect(capCostOf({ kind: 'passive', cap: 3 }, 9)).toBe(1)
    expect(capCostOf({ kind: 'active', cap: 3 }, 1)).toBe(3)
    // 別的類不受影響
    expect(stat(g, 'cap_discount_net')).toBe(0)
  })

  it('cap_discount 讓原本裝不下的裝得下：四個佔 3 的現實被動（12）在橋 8 裝不下，減 1 之後是 8 剛好', () => {
    const four = ['sk_pas3a', 'sk_pas3b', 'sk_pas3c', 'sk_pas3d']
    const g = make({ learned: four, flags: {} })
    expect(() => equipAbilities(g.k, g.state, 'pc', four)).toThrow('現實型的容量不夠（要 12，橋只有 8）。')
    const h = make({ learned: four, flags: { cap_discount_meat: 1 } })
    h.commit(equipAbilities(h.k, h.state, 'pc', four))
    expect(capacityOf(h.k, h.state, 'pc').meat).toEqual({ used: 8, max: 8 })
  })

  it('cap_flex 是 3：現實超出 2、其餘沒超，算裝得下；超出 4 被擋並說明；沒有 cap_flex 時 capacityOf 沒有 flex 欄', () => {
    const four = ['sk_pas3a', 'sk_pas3b', 'sk_pas3c', 'sk_pas3d']
    const two = [...four.slice(0, 3), 'sk_pas1'] // 10
    expect(capacityOf(make({ learned: two, equipped: two }).k, make({ learned: two, equipped: two }).state, 'pc')).not.toHaveProperty('flex')
    const g = make({ learned: [...four, 'sk_pas1'], flags: { cap_flex: 3 } })
    expect(() => equipAbilities(g.k, g.state, 'pc', two)).not.toThrow()
    g.commit(equipAbilities(g.k, g.state, 'pc', two))
    expect(capacityOf(g.k, g.state, 'pc').flex).toEqual({ used: 2, max: 3 })
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 10, max: 8 })
    expect(() => equipAbilities(g.k, g.state, 'pc', four)).toThrow('現實型的容量不夠（要 12，橋只有 8）；四類之間最多只能挪用 3 點，現在超出 4 點。')
  })

  it('挪用是從其他類挪過來的：其他類沒有空著的容量時，cap_flex 也不能多裝（capacityBlock）', () => {
    const cap = (meatUsed: number, spareNet: number): Capacity => ({
      meat: { used: meatUsed, max: 8 }, net: { used: 8 - spareNet, max: 8 }, social: { used: 8, max: 8 }, media: { used: 8, max: 8 }, flex: { used: Math.max(0, meatUsed - 8), max: 3 },
    })
    expect(capacityBlock(cap(10, 4))).toBeNull()
    expect(capacityBlock(cap(10, 1))).toBe('現實型的容量不夠（要 10，橋只有 8）；四類之間最多只能挪用 1 點，現在超出 2 點。')
    expect(capacityBlock(cap(8, 0))).toBeNull()
  })

  it('ram_discount_net 是 1：內海型的主動技能 2 RAM 花 1、1 RAM 的還是 1；沒有減免時照寫；別類的主動技能不減', () => {
    const cost = (flags: Rec, id: string) => {
      const w = fight({ learned: ['sk_net_root', 'sk_net_zap2', 'sk_net_zap1', 'sk_act2'], equipped: ['sk_net_zap2', 'sk_net_zap1', 'sk_act2'], flags })
      const run = w.run()
      return w.k.battle.getAction(id)!.cost!(run, run.unit('a1')).ram
    }
    expect(cost({}, 'sk_net_zap2')).toBe(2)
    expect(cost({ ram_discount_net: 1 }, 'sk_net_zap2')).toBe(1)
    expect(cost({ ram_discount_net: 1 }, 'sk_net_zap1')).toBe(1)
    expect(cost({ ram_discount_net: 5 }, 'sk_net_zap2')).toBe(1)
    // 現實型的技能不吃內海類的減免（也沒有 RAM 花費）
    expect(cost({ ram_discount_net: 1 }, 'sk_act2')).toBeUndefined()
  })

  it('單位沒有角色（敵人）時沒有減免', () => {
    const w = fight({ learned: ['sk_net_root', 'sk_net_zap2'], equipped: ['sk_net_zap2'], flags: { ram_discount_net: 1 } })
    const run = w.run()
    const a2 = run.unit('a2')
    expect(a2.actor).toBeUndefined()
    expect(w.k.battle.getAction('sk_net_zap2')!.cost!(run, a2).ram).toBe(2)
  })
})

// ===================================================================================================================
// 橋的機能（義體的 effects）也能給這三個數字：整合
// ===================================================================================================================

describe('橋的機能經義體的 effects 給三個數字（cyberware 的被動效果來源 cyber）', () => {
  const part = (id: string, type: string, over: Rec = {}): Rec => ({ id, name: id, type, material: 'mech', brand: 'hz', grade: 2, price: 100, legal: 'free', cells: 1, stats: {}, weight: 1, size: 1, state: 'new', ...over })
  const PARTS = [
    part('pt_chip', 'chip', { price: 1000, bridge: { capacity: 52 } }), part('pt_neuron', 'neuron', { price: 300 }),
    part('pt_sw', 'software', { price: 200, bridge: { split: { meat: 1, net: 1, social: 1, media: 1 } } }),
  ]
  const BP = [{
    id: 'bp_bridge_fx', kind: 'cyberware', name: '機能橋', desc: '一件義體。', brand: 'hz', grade: 2, legal: 'register', price: 900, require: [{ type: 'chip' }, { type: 'neuron' }, { type: 'software' }], optional: [],
    slot: 'bridge', invasiveness: 'invasive', sink_cost: 4, bridge: { tuning_slots: 2 },
    effects: [{ stat: 'cap_discount_meat', amount: 1 }, { stat: 'cap_flex', amount: 3 }, { stat: 'ram_discount_net', amount: 1 }],
  }]
  const g = make({
    features: [characterFeature, lewdFeature, cyberwareFeature], learned: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c', 'sk_pas3d'],
    packs: [{ id: 'cy', content: { part: PARTS, blueprint: BP } } as unknown as ContentPack], pc: { ext: { bridge: { sensitivity: 30, tolerance: 30, craving: 30, docility: 30 } } },
  })
  pc(g).ext.cyber = { pieces: [{ uid: 'b1', bp: 'bp_bridge_fx', slot: 'bridge', parts: { chip: 'pt_chip', neuron: 'pt_neuron', software: 'pt_sw' }, sink: 4, at: 0, registered: true }] }

  it('義體裝著時三個數字都有；容量讀 bridge_cap_<類>（13）；四個佔 3 的被動減 1 之後共 8 點', () => {
    expect([stat(g, 'cap_discount_meat'), stat(g, CAP_FLEX_STAT), stat(g, 'ram_discount_net')]).toEqual([1, 3, 1])
    expect(g.k.stats.statParts(g.state, 'pc', 'cap_flex').some((p) => p.source === 'cyber')).toBe(true)
    expect(capacityOf(g.k, g.state, 'pc').meat.max).toBe(13)
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_pas3a', 'sk_pas3b', 'sk_pas3c', 'sk_pas3d']))
    expect(capacityOf(g.k, g.state, 'pc').meat).toEqual({ used: 8, max: 13 })
  })
})

// ===================================================================================================================
// 容量變小的提醒
// ===================================================================================================================

describe('容量變小時由 abilities 自己提醒一句（不自動卸）', () => {
  const swap = (g: G, id = 'pc'): void => { g.commit(draft([{ op: 'actor.ext', id, key: 'cyber', value: { pieces: [] } }], 'cyber.bridge')) }
  const lastAction = (g: G): string => g.state.reports[g.state.reports.length - 1]!.action!

  it('義體那一邊動了（報告有 actor.ext.cyber）而裝著的技能超過容量：多一份 ability.capacity 的提醒，裝著的照舊留著', () => {
    const g = make({ learned: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c'], equipped: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c'] })
    const before = g.state.reports.length
    swap(g)
    expect(g.state.reports.length).toBe(before + 2)
    expect(lastAction(g)).toBe('ability.capacity')
    const note = g.state.reports[g.state.reports.length - 1]!
    expect(note.outcome.summary).toBe(`${pc(g).name}裝著的技能超過橋現在的容量（現實型要 9 點，橋只有 8 點）：不會自動卸下，超過的要自己整理。`)
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['sk_pas3a', 'sk_pas3b', 'sk_pas3c'])
  })

  it('沒超過、沒裝技能、報告沒動義體、cap_flex 吸收得了：都不提醒', () => {
    const ok = make({ learned: ['sk_pas3a'], equipped: ['sk_pas3a'] })
    let before = ok.state.reports.length
    swap(ok)
    expect(ok.state.reports.length).toBe(before + 1)
    const none = make()
    before = none.state.reports.length
    swap(none)
    expect(none.state.reports.length).toBe(before + 1)
    const over = make({ learned: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c'], equipped: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c'] })
    before = over.state.reports.length
    over.commit(draft([{ op: 'flag', key: 'x', value: true }]))
    expect(over.state.reports.length).toBe(before + 1)
    const flex = make({ learned: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c'], equipped: ['sk_pas3a', 'sk_pas3b', 'sk_pas3c'], flags: { cap_flex: 3 } })
    before = flex.state.reports.length
    swap(flex)
    expect(flex.state.reports.length).toBe(before + 1)
  })
})

// ===================================================================================================================
// 升基本功
// ===================================================================================================================

describe('升基本功（CORE_RULES 7.2 節）：升到 N 級花 N × 10 點歷練點；直接升到 4 級；5、6 級要有人教', () => {
  it('0 升 1 花 10、3 升 4 花 40；花的是這個人的歷練點、基本功 +1；不花時間', () => {
    const g = make({ xp: 100 })
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBeNull()
    const t0 = toMinutes(g.state.time)
    const r = skillUpDraft(g.k, g.state, 'pc', 'firearms')
    expect(r.action).toBe('ability.skill_up')
    g.commit(r)
    expect(pc(g).skills.firearms).toBe(1)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(90)
    expect(toMinutes(g.state.time)).toBe(t0)
    // 格鬥 3 升 4 花 40
    g.commit(skillUpDraft(g.k, g.state, 'pc', 'brawl'))
    expect(pc(g).skills.brawl).toBe(4)
    expect(abilitiesOf(g.state, 'pc').xp).toBe(50)
    // 其他的歷練點資料（學會的、裝著的、樹的累計）不動
    expect(abilitiesOf(g.state, 'pc')).toMatchObject({ learned: [], equipped: [], spent: {} })
  })

  it('歷練點不夠被擋（句子寫出要多少、現在多少）；沒有的基本功與沒有的角色也一樣', () => {
    const g = make({ xp: 35 })
    expect(skillUpBlock(g.k, g.state, 'pc', 'brawl')).toBe('歷練點不夠（格鬥升到 4 級要 40 點，現在 35 點）。')
    expect(reasonOf(() => skillUpDraft(g.k, g.state, 'pc', 'brawl'))).toBe('歷練點不夠（格鬥升到 4 級要 40 點，現在 35 點）。')
    expect(skillUpBlock(g.k, g.state, 'pc', 'nope')).toBe('沒有這項基本功。')
    expect(skillUpBlock(g.k, g.state, 'nobody', 'firearms')).toBe('沒有這個角色。')
  })

  it('4 升 5 被擋並是那一句（歷練點再多也一樣）；5 升 6 也是；6 級是最高', () => {
    const g = make({ xp: 999, pc: { skills: { firearms: 4, brawl: 5 } } })
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe('5 級與 6 級要有人教。')
    expect(NEEDS_TEACHER).toBe('5 級與 6 級要有人教。')
    expect(reasonOf(() => skillUpDraft(g.k, g.state, 'pc', 'firearms'))).toBe('5 級與 6 級要有人教。')
    expect(skillUpBlock(g.k, g.state, 'pc', 'brawl')).toBe('5 級與 6 級要有人教。')
    const top = make({ xp: 999, pc: { skills: { firearms: 6 } } })
    expect(skillUpBlock(top.k, top.state, 'pc', 'firearms')).toBe('槍械已經練到最高的 6 級了。')
  })

  it('名冊上的人照同一條：花他自己的歷練點', () => {
    const buddy = makeActor({ id: 'buddy', name: '夥伴', role: 'companion', skills: { firearms: 1 }, ext: { abilities: { xp: 25, learned: [], equipped: [], spent: {} } } })
    const g = make({ xp: 0, actors: [buddy] })
    g.commit(skillUpDraft(g.k, g.state, 'buddy', 'firearms'))
    expect(g.state.actors.buddy!.skills.firearms).toBe(2)
    expect(abilitiesOf(g.state, 'buddy').xp).toBe(5)
    expect(skillUpBlock(g.k, g.state, 'buddy', 'firearms')).toBe('歷練點不夠（槍械升到 3 級要 30 點，現在 5 點）。')
    expect(abilitiesOf(g.state, 'pc').xp).toBe(0)
  })

  it('規則：skill_xp_per_level、skill_free_max 可以被 ability_rule 蓋掉（預設 10 與 4）', () => {
    expect(DEFAULT_ABILITY_RULES).toMatchObject({ skill_xp_per_level: 10, skill_free_max: 4, respec_price_per_xp: 10, respec_minutes: 1440 })
    const g = make({ xp: 200, packs: [rulePack({ skill_xp_per_level: 20, skill_free_max: 5 })], pc: { skills: { firearms: 4 } } })
    expect(abilityRules(g.k)).toMatchObject({ skill_xp_per_level: 20, skill_free_max: 5 })
    g.commit(skillUpDraft(g.k, g.state, 'pc', 'firearms'))
    expect(abilitiesOf(g.state, 'pc').xp).toBe(100)
    expect(skillUpBlock(g.k, g.state, 'pc', 'firearms')).toBe('5 級與 6 級要有人教。')
  })

  it('規則的格式：數字不合格的 ability_rule 載入時被擋', () => {
    const bad = (rule: Rec) => () => make({ packs: [rulePack(rule)] })
    expect(bad({ skill_xp_per_level: 0 })).toThrow(/skill_xp_per_level/)
    expect(bad({ skill_free_max: 7 })).toThrow(/skill_free_max/)
    expect(bad({ respec_price_per_xp: -1 })).toThrow(/respec_price_per_xp/)
    expect(bad({ respec_minutes: 1.5 })).toThrow(/respec_minutes/)
  })
})

// ===================================================================================================================
// 洗點
// ===================================================================================================================

describe('洗點（CORE_RULES 7.2 節）：在調校診所、退回歷練點、付每點 10、休養一天', () => {
  const clinic = (o: Opts = {}) => make({ learned: SIX, equipped: ['sk_scalpel', 'sk_pas1'], flags: { fac: 'tuning_clinic' }, ...o })

  it('洗掉一棵花了 120 點的樹：歷練點 +120、扣 1,200、時間 +1 天、那棵樹的階回到 1、裝著的卸下；基本功不動', () => {
    const g = clinic()
    const q = respecQuote(g.k, g.state, 'pc', { path: 'surg' })
    expect(q).toMatchObject({ path: 'surg', xp: 120, price: 1200, minutes: 1440, byPath: { surg: 120 } })
    expect(q.abilities).toEqual(SIX)
    expect(q.unequipped).toEqual(['sk_scalpel', 'sk_pas1'])
    expect(respecBlock(g.k, g.state, 'pc', { path: 'surg' })).toBeNull()
    const t0 = toMinutes(g.state.time)
    const r = respecDraft(g.k, g.state, 'pc', { path: 'surg' })
    expect(r.action).toBe('ability.respec')
    g.commit(r)
    const mine = abilitiesOf(g.state, 'pc')
    expect(mine).toMatchObject({ xp: 120, learned: [], equipped: [], spent: {} })
    expect(g.state.money).toEqual({ cred: 5000 - 1200, cash: 300 })
    expect(toMinutes(g.state.time)).toBe(t0 + 1440)
    expect(g.state.actors.pc!.skills).toMatchObject({ brawl: 3, firearms: 0 })
    // 樹的階回到 1：手術刀（stats）不再算
    expect(stat(g, 'surgery_sink_pct')).toBe(0)
    expect(abilitiesOf(g.state, 'pc').spent.surg ?? 0).toBe(0)
  })

  it('只洗一棵樹：另一棵的技能、累計、裝著的留下；沒給 path 是全部', () => {
    const learned = [...SIX, 'sk_net_root', 'sk_net_zap1']
    const g = clinic({ learned, equipped: ['sk_scalpel', 'sk_net_zap1'] })
    expect(abilitiesOf(g.state, 'pc').spent).toEqual({ surg: 120, net: 40 })
    g.commit(respecDraft(g.k, g.state, 'pc', { path: 'net' }))
    expect(abilitiesOf(g.state, 'pc')).toMatchObject({ xp: 40, learned: SIX, equipped: ['sk_scalpel'], spent: { surg: 120 } })
    expect(g.state.money.cred).toBe(5000 - 400)
    const all = clinic({ learned, equipped: ['sk_scalpel', 'sk_net_zap1'] })
    expect(respecQuote(all.k, all.state, 'pc')).toMatchObject({ xp: 160, price: 1600 })
    all.commit(respecDraft(all.k, all.state, 'pc'))
    expect(abilitiesOf(all.state, 'pc')).toMatchObject({ xp: 160, learned: [], equipped: [], spent: {} })
  })

  it('累計比學會的多出來的部分（不是技能花的）留著：樹的累計只扣退回的那些', () => {
    const g = clinic()
    pc(g).ext.abilities = { ...(pc(g).ext.abilities as Rec), spent: { surg: 130 } }
    g.commit(respecDraft(g.k, g.state, 'pc', { path: 'surg' }))
    expect(abilitiesOf(g.state, 'pc').spent).toEqual({ surg: 10 })
  })

  it('開著的姿態被洗掉也一起關；錢可以指定用現金；價錢看這次洗掉多少點數（每點 C$10，規則可蓋）', () => {
    const g = clinic({ money: { cred: 0, cash: 5000 } })
    g.commit(respecDraft(g.k, g.state, 'pc', { path: 'surg' }))
    expect(g.state.money).toEqual({ cred: 0, cash: 3800 })
    const cheap = clinic({ packs: [rulePack({ respec_price_per_xp: 5, respec_minutes: 60 })] })
    const t0 = toMinutes(cheap.state.time)
    cheap.commit(respecDraft(cheap.k, cheap.state, 'pc', { path: 'surg', pay: 'cred' }))
    expect(cheap.state.money.cred).toBe(5000 - 600)
    expect(toMinutes(cheap.state.time)).toBe(t0 + 60)
  })

  it('不在調校診所被擋；在別種設施也被擋；在診所以外的地方草稿丟 ActionBlocked', () => {
    const g = make({ learned: SIX })
    expect(respecBlock(g.k, g.state, 'pc', { path: 'surg' })).toBe('要在調校診所才能洗點。')
    expect(reasonOf(() => respecDraft(g.k, g.state, 'pc', { path: 'surg' }))).toBe('要在調校診所才能洗點。')
    g.state.flags.fac = 'bar'
    expect(respecBlock(g.k, g.state, 'pc')).toBe('要在調校診所才能洗點。')
    g.state.flags.fac = 'tuning_clinic'
    expect(respecBlock(g.k, g.state, 'pc')).toBeNull()
  })

  it('進了委託副本、戰鬥中被擋；沒學任何技能（或那棵樹沒學）沒有可以洗的；沒有這棵樹；錢不夠', () => {
    const inside = clinic({ flags: { fac: 'tuning_clinic', in_commission: true } })
    expect(respecBlock(inside.k, inside.state, 'pc')).toMatch(/委託副本/)
    const fighting = clinic()
    fighting.state.battle = {} as never
    expect(respecBlock(fighting.k, fighting.state, 'pc')).toBe('戰鬥中不能洗點。')
    const none = clinic({ learned: [], equipped: [] })
    expect(respecBlock(none.k, none.state, 'pc')).toBe('還沒有學會任何技能，沒有可以洗的。')
    expect(respecBlock(clinic().k, clinic().state, 'pc', { path: 'net' })).toBe('net這棵樹還沒有學會任何技能，沒有可以洗的。')
    expect(respecBlock(clinic().k, clinic().state, 'pc', { path: 'nope' })).toBe('沒有這棵樹。')
    expect(respecBlock(clinic().k, clinic().state, 'nobody')).toBe('沒有這個角色。')
    const poor = clinic({ money: { cred: 500, cash: 600 } })
    expect(respecBlock(poor.k, poor.state, 'pc', { path: 'surg' })).toBe('錢不夠：洗點要 C$1,200，帳戶與現金付不起。')
    expect(respecBlock(poor.k, poor.state, 'pc', { path: 'surg', pay: 'cash' })).toBe('錢不夠：洗點要 C$1,200，現金付不起。')
  })

  it('夜課延伸的技能不在洗點裡：裝著的夜課留著', () => {
    const g = clinic({ features: [NIGHT_KIND], packs: [NIGHT_PACK], scene: { skills: ['nt_a'] }, equipped: ['sk_pas1', 'night:nt_a'] })
    g.commit(respecDraft(g.k, g.state, 'pc', { path: 'surg' }))
    expect(abilitiesOf(g.state, 'pc').equipped).toEqual(['night:nt_a'])
  })

  it('被洗掉的技能之後要重學（花歷練點）；樹的階也是從頭算', () => {
    const g = clinic()
    g.commit(respecDraft(g.k, g.state, 'pc', { path: 'surg' }))
    expect(learnBlock(g.k, g.state, 'pc', 'sk_pas3a')).toBe('要先學會sk_scalpel。')
    expect(learnBlock(g.k, g.state, 'pc', 'sk_scalpel')).toBeNull()
  })
})

// ===================================================================================================================
// 改造師樹的測試資料
// ===================================================================================================================

describe('改造師樹的測試資料（tests/fixtures/skills）：日常標 daily.kind、手術刀有 stats、戰地手術的現實欄用 wound_treat 與 implant_install', () => {
  const pack = (abilities: Rec[]): ContentPack => ({ id: 'medic_m4', content: { battle_status: TEST_STATUSES, path: [MEDIC.path], ability: abilities } }) as unknown as ContentPack
  const load = (features: Feature[], abilities: Rec[] = medicM4()) => () => {
    const k = createKernel(features)
    k.content.loadPack(pack(abilities))
    readyFeatures(k)
    return k
  }
  // 改造師樹的內海欄用到 net.fix、net.jam（netcombat），所以整組內海的功能都裝；義體的功能要排在甲板前面
  const NET = [combatFeature, deckFeature, netcombatFeature, hackFeature, summonsFeature, abilitiesFeature]
  const without = (f: Feature): Feature[] => [characterFeature, worldFeature, ...[cyberwareFeature, medicalFeature].filter((x) => x !== f), ...NET]
  const FULL = [characterFeature, worldFeature, cyberwareFeature, medicalFeature, ...NET]

  it('日常的四個（手術、解剖、工坊、解鎖匠）標上 daily.kind；手術刀的 stats 是每階 −5%、最多 −25%', () => {
    const kinds = Object.fromEntries(MEDIC.abilities.filter((a) => (a.daily as Rec | undefined)?.kind).map((a) => [a.id, (a.daily as Rec).kind]))
    expect(kinds).toEqual({ sk_medic_surgery: 'surgery', sk_medic_dissection: 'dissect', sk_medic_workshop: 'workshop', sk_medic_locksmith: 'unlock' })
    expect(MEDIC.abilities.find((a) => a.id === 'sk_medic_scalpel')!.stats).toEqual([{ stat: 'surgery_sink_pct', per_tier: -5, min: -25 }])
  })

  it('和 cyberwareFeature、medicalFeature 一起裝時載得進來：戰地手術有現實欄，兩個選項各用 wound_treat、implant_install', () => {
    const k = load(FULL)()
    expect(k.battle.effectProblems([{ op: 'wound_treat' }])).toEqual([])
    expect(k.battle.effectProblems([{ op: 'implant_install' }])).toEqual([])
    const fs = k.content.get<Rec & { id: string }>('ability', 'sk_medic_field_surgery')!
    expect(fs.meat.choose.map((c: Rec) => [c.key, c.do[0].op])).toEqual([['wound', 'wound_treat'], ['implant', 'implant_install']])
    expect(k.content.checkRefs()).toEqual([])
  })

  it('醫療或義體的功能沒裝：戰地手術的現實欄載入時被擋，訊息指得出是哪一個效果', () => {
    expect(load(without(medicalFeature))).toThrow(/wound_treat/)
    expect(load(without(cyberwareFeature))).toThrow(/implant_install/)
    // 原本的資料（現實欄是 null）兩個功能都不裝也載得進來
    expect(load(NET, clone(MEDIC.abilities) as Rec[])).not.toThrow()
  })

  it('裝著日常技能：條件 ability 問得到（解鎖匠 unlock、手術 surgery、解剖 dissect、工坊 workshop）', () => {
    const ids = ['sk_medic_surgery', 'sk_medic_dissection', 'sk_medic_workshop', 'sk_medic_locksmith']
    const { game: g } = makeGame({
      features: FULL, content: [pack(medicM4())], seed: 7,
      pc: { ext: { bridge: BRIDGE8, abilities: { xp: 0, learned: ids, equipped: ids, spent: { medic: 400 } } } },
    })
    const test = (daily: string) => g.k.conditions.test({ kind: 'ability', daily } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(['surgery', 'dissect', 'workshop', 'unlock', 'other'].map(test)).toEqual([true, true, true, true, false])
    // 解剖與工坊是日常（不寫現實欄也載得進來）；裝著解剖的人進戰鬥有標籤 dissect
    expect(IDS(ids)).toHaveLength(4)
  })
})
