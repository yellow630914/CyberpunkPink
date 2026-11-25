// 驗收測試：dev/work/M1b-skill-pilot.md（cpp-feature）。機師「編隊」這棵樹在現實、不用機甲的那一部分：
// features/summons 註冊的無人機效果（drone.act、deploy、move、repair、smoke、ram、guard、escort）、護盾型的守著、偵察型的 see_dark、
// 放出的上限與回灌的修正、臨時機；features/abilities 補的觸發對象（with_own_overlay、own_overlay、react.reach）；
// 以及這棵樹二十七個技能與共鳴用假資料寫得出來、動得起來（要機甲的留 pending，E12）。
// 規格：SKILL_TREES「機師：編隊」整節；COMBAT_SYSTEM 9.1 節、2.5 節；dev/adr/0015 第三節、E6、E12。
// 內容一律是測試自帶的假資料（名字與數字照設計書），不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleInput, BattleOverlay, BattleSetup, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, BattleRun, advance, battleAct, pickApplies, pickProblems, readyFeatures, toMinutes } from '../../src'
import { abilitiesFeature, prep, prepBlock } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { summonsFeature } from '../../src/features/summons'
import { makeBattleGame, makeGame, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature, summonsFeature]

// ===================================================================================================================
// 假資料：機師「編隊」整棵樹（id 照 sk_pilot_<英文名>；cpp-data 照這份改寫）。要機甲的留 pending（E12）。
// ===================================================================================================================

const TREE = {
  id: 'pilot', name: '機師', tree: '機師：編隊', category: 'meat', signature: 'sk_pilot_formation', domains: { meat: 'strong', net: 'weak', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '你的無人機耐久 +5。', effect: { mods: [{ kind: 'overlay_hp', value: 5 }] } },
    { tier: 2, cells: 1, text: '你的無人機護甲 +1。', effect: { mods: [{ kind: 'overlay_armor', value: 1 }] } },
    { tier: 3, cells: 1, text: '你的機甲的機體耐久 +5。（要機甲，M6）', effect: { pending: true } },
    { tier: 4, cells: 1, text: '你指揮無人機時，命中 +1。', effect: { mods: [{ kind: 'hit', value: 1, tags: ['drone'] }] } },
    { tier: 5, cells: 1, text: '你的無人機迴避 +1。', effect: { mods: [{ kind: 'overlay_evade', value: 1 }] } },
  ],
}

/** 技能的七個欄位之外都一樣：機師樹、現實型、前置照給。 */
const sk = (id: string, name: string, tier: number, layer: 'signature' | 'front' | 'back', kind: string, cap: number, more: Rec = {}): Rec => ({
  id, name, path: 'pilot', category: 'meat', tier, layer, kind, cap, xp: tier * 20, cells: 1, after: layer === 'signature' ? undefined : 'sk_pilot_formation', text: `${name}。`, net: null, opinion: null, meat: null, ...more,
})
const KINDS = ['attack', 'shield', 'scout', 'medic', 'jammer'] as const
/** pilot() 預設帶的五台，pick.drone 是它在這個順序裡的索引。 */
const NTH = { attack: 0, shield: 1, scout: 2, medic: 3, jammer: 4 } as const
const KIND_LABEL: Record<string, string> = { attack: '攻擊型', shield: '護盾型', scout: '偵察型', medic: '醫療型', jammer: '干擾型' }
/** 出擊：放出一台並立刻指揮一次。放哪一台是 kind 為 drone 的 pick（選單位上 ext.summons.drones 的第幾台：pick.drone），打誰是 pick.at。 */
const GOOD_KID_DO = [{ op: 'drone.deploy', drone: 'drone' }, { op: 'drone.act', which: 'target', at: 'pick:at', hit: 1 }]
const DRONE_PICK = { key: 'drone', label: '放出哪一台', kind: 'drone', required: true } as const
const AT = { key: 'at', label: '打誰', kind: 'foe', required: false } as const
const AT_REQUIRED = { key: 'at', label: '打誰', kind: 'foe', required: true } as const

const PILOT: Rec[] = [
  // ---- 1 階 ----
  sk('sk_pilot_formation', '編隊', 1, 'signature', 'passive', 3, { meat: { tags: ['drone_link'], mods: [{ kind: 'hit', value: 'half_tier_up', tags: ['drone'] }] } }),
  sk('sk_pilot_good_kid', '出擊', 1, 'front', 'active', 1, {
    use: { ap: 1, per_fight: 1 },
    meat: { target: 'ally_slot', picks: [AT, DRONE_PICK], do: GOOD_KID_DO },
  }),
  sk('sk_pilot_cover_flight', '掩護飛行', 1, 'front', 'reaction', 1, { use: { ap: 1, per_turn: 1 }, meat: { trigger: { on: 'attacked', who: 'with_own_overlay' }, react: { hit: -2 } } }),
  sk('sk_pilot_multitask', '多工連結', 1, 'front', 'passive', 2, { meat: { mods: [{ kind: 'overlay_cap', value: 1, tags: ['support'] }] } }),
  sk('sk_pilot_one_more', '再來一輪', 1, 'back', 'active', 1, {
    use: { ap: 2 },
    meat: { target: 'own_overlay', picks: [AT], do: [{ op: 'drone.act', which: 'target', at: 'pick:at' }, { op: 'drone.act', which: 'target', at: 'pick:at', hit: 1, ignore_used: true }] },
  }),
  sk('sk_pilot_accompany', '派駐', 1, 'back', 'active', 1, {
    use: { ap: 1 },
    meat: {
      target: 'own_overlay', picks: [{ key: 'to', label: '移到哪一格', kind: 'ally_slot', required: true }],
      do: [{ op: 'drone.move', to: 'to', any: true }, { op: 'buff', who: 'slot', id: 'accompany', name: '派駐', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 1 }] }],
    },
  }),
  // ---- 2 階 ----
  // 機甲那一半（兩件武器一起開火、命中都 −1）要 M6
  sk('sk_pilot_dual_fire', '雙聯火控', 2, 'front', 'active', 1, { use: { ap: 2 }, meat: { target: 'enemy', attack: {}, do: [{ op: 'drone.act', which: 'same_slot', at: 'target' }] } }),
  sk('sk_pilot_escort', '護航編隊', 2, 'front', 'stance', 1, { use: { ap: 1 }, meat: { do_on: [{ op: 'drone.escort', evade: 1, max: 2 }], do_off: [{ op: 'drone.escort', off: true }] } }),
  // 機甲的回灌 20% → 15% 那一半要 M6
  sk('sk_pilot_feedback_buffer', '回灌緩衝', 2, 'front', 'passive', 3, { meat: { mods: [{ kind: 'overlay_backlash', value: -3 }] } }),
  sk('sk_pilot_quick_repair', '就地維修', 2, 'back', 'active', 1, {
    use: { ap: 1 },
    meat: { target: 'own_overlay', picks: [{ key: 'to', label: '順便移到哪一格', kind: 'ally_slot', required: false }], do: [{ op: 'drone.repair', amount: 10 }, { op: 'drone.move', to: 'to' }] },
  }),
  // 機甲那一半（第 1 格才能用、機甲的武器近戰、遮蔽傷害加倍）要 M6
  sk('sk_pilot_ram_in', '撞過去！', 2, 'back', 'active', 1, { use: { ap: 2 }, meat: { target: 'own_overlay', picks: [{ key: 'at', label: '撞誰', kind: 'foe', required: true }], do: [{ op: 'drone.ram', who: 'pick:at', dice: '3d6', type: 'physical' }] } }),
  // ---- 3 階 ----
  // 機甲狀態下近戰傷害多一顆骰：寫成 when.hull（現在沒有機甲，永遠不算）
  sk('sk_pilot_assault', '突擊姿態', 3, 'front', 'stance', 2, { use: { ap: 1 }, meat: { mods: [{ kind: 'hit', value: 1 }, { kind: 'evade', value: -1 }, { kind: 'dice', value: 1, when: { hull: true, wield: 'melee' } }] } }),
  // 後面那一格的遮蔽高一級：寫不出來（沒有「自己後面那一格」這種落點、也沒有跟著姿態開關的遮蔽加成）；不能自己換位寫成狀態
  sk('sk_pilot_bastion', '堡壘姿態', 3, 'front', 'stance', 2, { use: { ap: 1 }, meat: { mods: [{ kind: 'armor', value: 1 }, { kind: 'cover_level', value: 1, who: 'behind' }], do_on: [{ op: 'status', status: 'rooted' }], do_off: [{ op: 'unstatus', status: 'rooted' }] } }),
  sk('sk_pilot_sync_dash', '同步衝刺', 3, 'front', 'active', 2, { use: { ap: 0, per_fight: 1 }, meat: { pending: true } }),
  sk('sk_pilot_saturation', '飽和攻擊', 3, 'back', 'active', 2, { use: { ap: 2, per_turn: 1 }, meat: { target: 'enemy', do: [{ op: 'drone.act', which: 'all', max: 3, at: 'target', hit: 1 }] } }),
  sk('sk_pilot_smoke_cover', '煙幕護航', 3, 'back', 'active', 2, { use: { ap: 1 }, meat: { target: 'own_overlay', do: [{ op: 'drone.smoke', rounds: 2 }] } }),
  sk('sk_pilot_neural_hardening', '神經硬化', 3, 'back', 'passive', 4, { meat: { pending: true } }),
  // ---- 4 階 ----
  sk('sk_pilot_remote_fire', '遠端火力', 4, 'front', 'active', 2, { use: { ap: 2, per_fight: 1 }, meat: { pending: true } }),
  sk('sk_pilot_intercept', '攔截', 4, 'front', 'reaction', 2, { use: { ap: 1, per_turn: 1 }, meat: { trigger: { on: 'attacked', who: 'with_own_overlay' }, react: { redirect: 'overlay', reach: 1 } } }),
  sk('sk_pilot_resonant_pilot', '共鳴駕駛', 4, 'front', 'passive', 5, { meat: { pending: true } }),
  sk('sk_pilot_precision', '精準導引', 4, 'back', 'active', 2, { use: { ap: 1 }, meat: { target: 'own_overlay', picks: [AT_REQUIRED], do: [{ op: 'drone.act', which: 'target', at: 'pick:at', hit: 2, pierce: 2 }] } }),
  // 機體耐久 +10 那一半要 M6
  sk('sk_pilot_overhaul', '整備', 4, 'back', 'prep', 2, { use: { slot: 1 }, prep: { slot: 1, scope: 'next_battle', meat: { mods: [{ kind: 'overlay_hp', value: 6 }, { kind: 'overlay_armor', value: 1 }] } } }),
  // ---- 5 階 ----
  sk('sk_pilot_swarm', '蜂群', 5, 'front', 'active', 3, {
    use: { ap: 3, per_fight: 1 },
    meat: {
      target: 'enemy',
      do: [
        { op: 'drone.deploy', kind: 'attack', turns: 3, over_cap: true, no_backlash: true },
        { op: 'drone.deploy', kind: 'attack', turns: 3, over_cap: true, no_backlash: true },
        { op: 'drone.act', which: 'all', at: 'target' },
      ],
    },
  }),
  sk('sk_pilot_dome', '穹頂', 5, 'front', 'active', 3, {
    use: { ap: 3, per_fight: 1 },
    meat: { target: 'none', do: [{ op: 'buff', who: 'allies', id: 'dome', name: '穹頂', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 2 }] }, { op: 'drone.guard', which: 'all' }] },
  }),
  sk('sk_pilot_valkyrie', '女武神', 5, 'front', 'active', 3, { use: { ap: 0, per_fight: 1 }, meat: { pending: true } }),
  // who: self：被打的那一台可能就在這一擊被擊落了（核心不對已經擊落的做效果），所以不落在它身上；「其餘的」是照 ctx.target 排除那一台
  sk('sk_pilot_defend_kids', '敢打我家孩子？', 5, 'back', 'reaction', 3, {
    use: { ap: 1, per_turn: 1 },
    meat: { trigger: { on: 'after', who: 'own_overlay' }, do: [{ op: 'drone.act', who: 'self', which: 'others', max: 2, at: 'attacker' }] },
  }),
  sk('sk_pilot_man_machine', '人機一體', 5, 'back', 'passive', 6, { meat: { pending: true } }),
]
const ID = (name: string) => `sk_pilot_${name}`
const PENDING = PILOT.filter((a) => (a.meat as Rec | null)?.pending).map((a) => a.id)

const PACK: ContentPack = {
  id: 'pilot_test',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'rooted', name: '固守', desc: '不能自己換位。', no_move: true, until: 'battle_end', kind: 'buff' }],
    path: [TREE],
    ability: PILOT,
  },
} as unknown as ContentPack

/** 同一組內容，技能換成這一串。 */
const withAbilities = (ability: Rec[]): ContentPack => ({ ...PACK, content: { ...PACK.content, ability } }) as unknown as ContentPack

// ---- 場地 ----

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
/** 骰面：全是 15（d20 擲 15、d6 擲 15 也無妨：只看結構）；用完會丟錯。 */
const FIX = Array(400).fill(15)
const dice = (...v: number[]): number[] => [...v, ...Array(400).fill(1)]

interface PilotOpts { sync?: number; tier?: number; drones?: string[] | Rec[]; unit?: Rec }
/** 機師：裝著指定的技能、這棵樹開到 tier 階、帶著指定的無人機。 */
function pilot(ids: string[], o: PilotOpts = {}): unknown {
  const drones = (o.drones ?? [...KINDS]).map((d) => (typeof d === 'string' ? { kind: d, grade: 1 } : d))
  return one({
    actor: 'pc', weapon: 'pistol', skills: { sync: o.sync ?? 2, piloting: 3, firearms: 2 }, ap: { now: 30, max: 30, regen: 3 },
    ext: { summons: { drones, vehicle: { name: '小貨車', hp: [30, 60] } }, abilities: { equipped: ids, tiers: { pilot: o.tier ?? 3 } } }, ...o.unit,
  } as never)
}
const hitter = { weapons: [testWeapon('pistol', 30)], ...quiet }

interface WorldOpts extends PilotOpts {
  allies?: unknown[]
  foes?: unknown[]
  cover?: { ally: number[]; foe: number[] }
  more?: Partial<BattleSetup>
  prep?: (k: Kernel) => void
}
/** 不經過提交的場地：a1 是機師（裝著 ids），a2、a3 是隊友；敵人行動點 0、命中很高。 */
function world(ids: string[], o: WorldOpts = {}): Arena {
  return arena(
    duel(o.allies ?? [pilot(ids, o), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], o.foes ?? [foe('minion', hitter as never), foe('minion', quiet as never)], o.cover, o.more),
    FEATURES, (k) => {
      k.content.loadPack(PACK)
      o.prep?.(k)
      readyFeatures(k)
    },
  )
}
/** 一局已經開打的遊戲（走完整的 battleAct）。 */
function play(ids: string[], o: WorldOpts = {}, seed = 7) {
  return makeBattleGame({
    features: o.prep ? [...FEATURES, { id: 'probe', install: (k: Kernel) => o.prep!(k) }] : FEATURES, content: [PACK], seed,
    battle: duel(o.allies ?? [pilot(ids, o), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], o.foes ?? [foe('minion', quiet as never), foe('minion', quiet as never)], o.cover, o.more),
  }).game
}
type G = ReturnType<typeof play>

const turnTo = (g: G, id: string): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const opt = (g: G, id: string): BattleActionOption => g.battleOptions()!.actions.find((a) => a.id === id)!
const ovs = (g: G): BattleOverlay[] => g.state.battle!.overlays
const unit = (g: G, id: string): BattleUnit => g.state.battle!.units[id]!
const refused = (r: { status: string; reasons?: string[] }, ...reasons: string[]) => expect(r).toMatchObject({ status: 'refused', reasons })
const deploy = (g: G, drone: number, slot: number) => g.battleAct({ action: 'drone.deploy', target: { side: 'ally', slot }, pick: { drone } })
/** 這一步照現在的狀態成不成立（純算，不提交）；不成立回傳原因。 */
const tryAct = (g: G, input: BattleInput): string[] | null => {
  try {
    battleAct(g.k, g.state, input)
    return null
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}
/** 這一步的紀錄裡，每一次擲命中的檢定。 */
const rollsOf = (r: { reports: Array<{ timeline: Array<{ roll?: { skill?: string; parts: Array<{ label: string; value: number }>; total: number; dc: number } }> }> }) =>
  r.reports.flatMap((x) => x.timeline).filter((b) => b.roll).map((b) => b.roll!)
const partOf = (roll: { parts: Array<{ label: string; value: number }> }, label: string): number | undefined => roll.parts.find((p) => p.label === label)?.value

// ---- run 層（不經過提交） ----

const a1 = (a: Arena): BattleUnit => a.ally(1)
/** 在 a 上放一台（直接放，不走行動；owner 是 a1）。 */
function put(a: Arena, slot: number, kind = 'attack', ext: Rec = {}): BattleOverlay {
  return a.run().addOverlay({ side: 'ally', slot, owner: 'a1', kind, name: KIND_LABEL[kind] ?? kind, hp: { now: 14, max: 14 }, armor: 1, evade: 13, ext: { drone: -1, grade: 1, ...ext } })
}
/** 讓 a1 做一個行動（花費照核心的算法）；骰面釘死。 */
function cast(a: Arena, action: string, target: BattleTarget | null, o: { pick?: Rec; d?: number[]; user?: string } = {}): BattleRun {
  const run = a.run(o.d ?? FIX.slice())
  const def = a.k.battle.getAction(action)!
  expect(def, action).toBeDefined()
  const input: BattleInput = { action, ...(target ? { target } : {}), ...(o.pick ? { pick: o.pick } : {}) }
  const performer = run.unit(o.user ?? 'a1')
  // 走和玩家一樣的檢查：行動自己的條件、目標選不選得了
  const why = [...(def.blocks?.(run, performer) ?? []), ...(target ? (def.targets?.(run, performer) ?? []).find((t) => JSON.stringify(t.target) === JSON.stringify(target))?.blocks ?? ['這個目標不能選。'] : [])]
  if (why.length) throw new BattleBlocked(why)
  // 一個行動做完的掛點（reuse：performAction 會發 action.done）
  const spent = def.cost(run, performer, input)
  if (!run.canAfford(performer, spent)) throw new BattleBlocked(['行動點不夠。'])
  run.spend(performer, spent)
  def.run(run, performer, target, input)
  a.k.battle.emit('action.done', { run, unit: performer, action, tags: [action], target, input, cost: spent, base: spent })
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
const overlaysOf = (a: Arena): BattleOverlay[] => a.battle.overlays
/** 到下一個回合（輪過所有人）：到期的煙霧、臨時機都在這裡處理。 */
const nextRound = (a: Arena): void => {
  const r = a.battle.round
  for (let i = 0; i < 60 && a.battle.round === r; i++) advance(a.run(FIX.slice()))
}
/** 現在 g 這個人的某個數字的修正（照核心的問法）。 */
const gmods = (g: G, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = []) => {
  const run = new BattleRun(g.k, g.state, g.state.battle!)
  return run.mods(kind, run.unit(id), undefined, undefined, tags)
}
/** 這一步的紀錄裡，某個技能觸發了幾次。 */
const fired = (run: BattleRun, id: string): number => run.beats.filter((b) => b.tag === 'skill' && (b.data as Rec | undefined)?.ability === id).length
const hits = (run: BattleRun): Array<{ skill?: string; parts: Array<{ label: string; value: number }>; total: number; dc: number }> => run.beats.filter((b) => b.roll).map((b) => b.roll!) as never
const modParts = (a: Arena, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = []) => a.run().mods(kind, a.run().unit(id), undefined, undefined, tags)
const sum = (parts: Array<{ value: number }>): number => parts.reduce((s, p) => s + p.value, 0)

/** 宣告與行動本身對不對得上（和 M1-picks 同一套驗法）：回傳對不上的地方。 */
function mismatches(g: G, a: BattleActionOption): { bad: string[]; tried: number } {
  const bad: string[] = []
  let tried = 0
  if (a.blocks.length) return { bad, tried }
  const targets: Array<BattleTarget | null> = a.target === 'none' ? [null] : a.targets.filter((t) => t.blocks.length === 0).map((t) => t.target)
  for (const target of targets) {
    const at = JSON.stringify(target)
    const input = (pick: Rec): BattleInput => ({ action: a.id, ...(target ? { target } : {}), ...(Object.keys(pick).length ? { pick } : {}) })
    const base: Rec = {}
    let possible = true
    for (const p of a.picks) {
      const usable = p.options.filter((o) => pickApplies(o, target) && o.blocks.length === 0)
      if (p.required && p.options.some((o) => pickApplies(o, target))) {
        if (usable.length) base[p.key] = usable[0]!.value
        else possible = false
      }
    }
    if (!possible) continue
    tried += 1
    expect(pickProblems(a.picks, target, base)).toEqual([])
    const why = tryAct(g, input(base))
    if (why) bad.push(`${a.id} ${at} ${JSON.stringify(base)}：照宣告選齊了，卻被擋下（${why.join(' ')}）`)
    for (const p of a.picks) {
      if (p.key in base) {
        tried += 1
        const { [p.key]: _omit, ...rest } = base
        if (!tryAct(g, input(rest))) bad.push(`${a.id} ${at}：少選了「${p.label}」，卻做成了`)
      }
    }
  }
  return { bad, tried }
}

// ===================================================================================================================

describe('這棵樹的二十七個技能：載得進來、格式檢查全過；要機甲的留 pending', () => {
  it('二十七個技能全部載入；要機甲的六個是 pending（E12），其餘都有現實的寫法', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(PILOT).toHaveLength(27)
    expect(g.k.content.list('ability').length).toBe(27)
    expect(PENDING).toEqual(['sk_pilot_sync_dash', 'sk_pilot_neural_hardening', 'sk_pilot_remote_fire', 'sk_pilot_resonant_pilot', 'sk_pilot_valkyrie', 'sk_pilot_man_machine'].sort((x, y) => PILOT.findIndex((a) => a.id === x) - PILOT.findIndex((a) => a.id === y)))
    // pending 的不註冊成行動（沒有機甲，做不了）；其餘的主動技能與姿態都是行動
    const a = world(PILOT.map((x) => x.id as string))
    const actions = a.k.battle.actionsFor('meat').map((d) => d.id)
    for (const p of PILOT) {
      const m = p.meat as Rec
      if (p.kind === 'active' || p.kind === 'stance') expect(actions.includes(p.id as string), p.id as string).toBe(!m.pending)
    }
  })

  it('共鳴 3（機甲的機體耐久）是 pending，載得進來也不影響別的共鳴（耐久 +5、護甲 +1 照樣算）', () => {
    const dep = world([ID('formation')], { tier: 5 })
    cast(dep, 'drone.deploy', { side: 'ally', slot: 1 }, { pick: { drone: 0 } })
    expect(dep.battle.overlays[0]).toMatchObject({ hp: { now: 19, max: 19 }, armor: 2 })
  })

  it('格式檢查：drone.* 的欄位寫壞了，載入時擋下，訊息裡有那個字', () => {
    const load = (e: Rec) => () => makeGame({ features: FEATURES, content: [withAbilities([PILOT[0]!, sk('sk_pilot_x', 'x', 1, 'front', 'active', 1, { use: { ap: 1 }, meat: { target: 'own_overlay', do: [e] } })])] }) as unknown
    expect(load({ op: 'drone.act', which: 'target', at: 'target', hit: 1 })).not.toThrow()
    expect(load({ op: 'drone.act', which: 'everyone', at: 'target' })).toThrow(/everyone/)
    expect(load({ op: 'drone.act', which: 'all' })).toThrow(/一定要寫 at/)
    expect(load({ op: 'drone.act', at: 'nobody' })).toThrow(/nobody/)
    expect(load({ op: 'drone.act', speed: 3 })).toThrow(/speed/)
    expect(load({ op: 'drone.deploy' })).toThrow(/drone（pick 的鍵）與 kind/)
    expect(load({ op: 'drone.deploy', drone: 'a', kind: 'attack' })).toThrow(/只能寫一個/)
    expect(load({ op: 'drone.deploy', kind: 'tank' })).toThrow(/tank/)
    expect(load({ op: 'drone.deploy', kind: 'attack', turns: 0 })).toThrow(/turns/)
    expect(load({ op: 'drone.deploy', drone: 'a', grade: 2 })).toThrow(/grade 只有臨時機/)
    expect(load({ op: 'drone.move' })).toThrow(/to/)
    expect(load({ op: 'drone.repair', amount: 'lots' })).toThrow(/amount/)
    expect(load({ op: 'drone.smoke' })).toThrow(/rounds/)
    expect(load({ op: 'drone.guard', until: 'forever' })).toThrow(/forever/)
    expect(load({ op: 'drone.guard', which: 'others' })).toThrow(/others/)
    expect(load({ op: 'drone.ram', dice: '3d' })).toThrow(/dice/)
  })

  it('反應的格式：with_own_overlay、react.reach；reach 要和 redirect 一起寫、只能 0～3', () => {
    const load = (trigger: Rec, react?: Rec) => () => makeGame({ features: FEATURES, content: [withAbilities([PILOT[0]!, sk('sk_pilot_x', 'x', 1, 'front', 'reaction', 1, { use: { ap: 1 }, meat: { trigger, ...(react ? { react } : {}) } })])] }) as unknown
    expect(load({ on: 'attacked', who: 'with_own_overlay' }, { redirect: 'overlay', reach: 1 })).not.toThrow()
    expect(load({ on: 'after', who: 'own_overlay' })).toThrow(/react 或 do/)
    expect(load({ on: 'attacked', who: 'with_own_overlay' }, { redirect: 'overlay', reach: 4 })).toThrow(/reach/)
    expect(load({ on: 'attacked', who: 'with_own_overlay' }, { hit: -1, reach: 1 })).toThrow(/reach/)
    expect(load({ on: 'overload', who: 'with_own_overlay' }, { keep_turn: true })).toThrow(/with_own_overlay/)
    expect(load({ on: 'checked', who: 'own_overlay' }, { dc: 1 })).toThrow(/own_overlay/)
  })
})

// ===================================================================================================================

describe('共鳴 1、2、4、5 與「編隊」的階數加值（mods：overlay_hp、overlay_armor、overlay_evade、指揮的命中標籤 drone）', () => {
  const stats = (tier: number) => {
    const a = world([ID('formation')], { tier })
    cast(a, 'drone.deploy', { side: 'ally', slot: 1 }, { pick: { drone: 0 } })
    return { o: a.battle.overlays[0]!, base: a.run().n.evadeBase + 3, a }
  }

  it('放出來的那一台：耐久 +5（共鳴 1）、護甲 +1（共鳴 2）、迴避 +1（共鳴 5）；階數沒到的不算；共鳴 3 是 pending 不影響', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      const { o, base } = stats(tier)
      expect(o.hp, `${tier} 階的耐久`).toEqual({ now: 19, max: 19 })
      expect(o.armor, `${tier} 階的護甲`).toBe(tier >= 2 ? 2 : 1)
      expect(o.evade, `${tier} 階的迴避`).toBe(base + (tier >= 5 ? 1 : 0))
    }
  })

  it('沒有裝編隊（招牌）就沒有共鳴；不同等級的無人機各自加上去', () => {
    const a = world([], { tier: 5 })
    cast(a, 'drone.deploy', { side: 'ally', slot: 1 }, { pick: { drone: 0 } })
    expect(a.battle.overlays[0]).toMatchObject({ hp: { now: 14, max: 14 }, armor: 1 })
    const b = world([ID('formation')], { tier: 5, drones: [{ kind: 'attack', grade: 3 }] })
    cast(b, 'drone.deploy', { side: 'ally', slot: 1 }, { pick: { drone: 0 } })
    expect(b.battle.overlays[0]).toMatchObject({ hp: { now: 25, max: 25 }, armor: 4 })
  })

  it('指揮的命中（標籤 drone）：編隊加這棵樹階數的一半（無條件進位），共鳴 4 再 +1；不帶 drone 標籤的攻擊不吃', () => {
    const expected: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 }
    for (const tier of [1, 2, 3, 4, 5]) {
      const a = world([ID('formation')], { tier })
      expect(sum(modParts(a, 'hit', 'a1', ['drone'])), `${tier} 階`).toBe(expected[tier])
      expect(sum(modParts(a, 'hit', 'a1', []))).toBe(0)
      expect(sum(modParts(a, 'hit', 'a2', ['drone']))).toBe(0)
    }
  })

  it('指揮一台攻擊型時，命中的算式裡有這兩筆（編隊與共鳴各寫自己的名字）', () => {
    const a = world([ID('formation')], { tier: 4 })
    put(a, 1, 'attack')
    const run = cast(a, 'drone.command', { overlay: 'o1' }, { pick: { at: 'f1' } })
    const roll = hits(run)[0]!
    expect(roll.skill).toBe('piloting')
    expect(partOf(roll, '編隊')).toBe(2)
    expect(partOf(roll, '機師：編隊')).toBe(1)
    // 機師自己的一槍沒有
    const own = a.run(FIX.slice())
    own.attack(a1(a), a.foe(1))
    expect(partOf(hits(own)[0]!, '編隊')).toBeUndefined()
  })
})

describe('出擊：放出一台並立刻指揮一次，一共 1 點、那一次命中 +1、每場一次', () => {
  const ids = [ID('formation'), ID('good_kid')]
  const foes = () => [foe('boss', quiet as never), foe('minion', quiet as never)]

  it('1 行動點做完兩件事（放出＋指揮）；指揮的那一次命中 +1；那一台算已經指揮過', () => {
    const g = play(ids, { foes: foes() })
    turnTo(g, 'a1')
    const ap = unit(g, 'a1').ap.now
    const r = g.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: NTH.attack, at: 'f1' } })
    expect(r.status).toBe('applied')
    expect(unit(g, 'a1').ap.now).toBe(ap - 1)
    expect(ovs(g)).toHaveLength(1)
    expect(ovs(g)[0]).toMatchObject({ kind: 'attack', slot: 1, used: true })
    const rolls = rollsOf(r)
    expect(rolls).toHaveLength(1)
    expect(rolls[0]!.skill).toBe('piloting')
    expect(partOf(rolls[0]!, '無人機射擊')).toBe(1)
    expect(partOf(rolls[0]!, '編隊')).toBe(2)
    // 原本放出（1）加指揮（1）是 2 點
    const g2 = play([ID('formation')], { foes: foes() })
    turnTo(g2, 'a1')
    const ap2 = unit(g2, 'a1').ap.now
    deploy(g2, 0, 1)
    g2.battleAct({ action: 'drone.command', target: { overlay: ovs(g2)[0]!.id }, pick: { at: 'f1' } })
    expect(unit(g2, 'a1').ap.now).toBe(ap2 - 2)
  })

  it('每場一次：用過之後灰掉；每一種都放得出來（偵察型標記、醫療型替同一格的人急救、護盾型守著）', () => {
    const g = play(ids, { foes: foes() })
    turnTo(g, 'a1')
    g.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: NTH.attack, at: 'f1' } })
    turnTo(g, 'a1')
    expect(opt(g, ID('good_kid')).ok).toBe(false)
    expect(opt(g, ID('good_kid')).blocks).toHaveLength(1)
    // 分開的場地試其他種類
    const scout = play(ids, { foes: foes() })
    turnTo(scout, 'a1')
    scout.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: NTH.scout, at: 'f1' } })
    expect(unit(scout, 'f1').statuses.map((x) => x.id)).toContain('marked')
    const medic = play(ids, { foes: foes() })
    turnTo(medic, 'a1')
    unit(medic, 'a2').hp!.now = 10
    medic.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 2 }, pick: { drone: NTH.medic } })
    expect(unit(medic, 'a2').hp!.now).toBeGreaterThan(10)
    const shield = play(ids, { foes: foes() })
    turnTo(shield, 'a1')
    shield.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 2 }, pick: { drone: NTH.shield } })
    expect(ovs(shield)[0]).toMatchObject({ kind: 'shield', used: true, ext: { guard: 'own_turn_start' } })
  })

  it('攻擊型沒選敵人、選了手上沒有的那一台、選了已經放出去的、這一格已經掛著一台：整步不成立，不扣行動點、沒有放出', () => {
    const g = play(ids, { foes: foes(), drones: ['shield', 'medic'] })
    turnTo(g, 'a1')
    const ap = unit(g, 'a1').ap.now
    // 只帶兩台：第 3 台（索引 2）不在選項裡
    refused(g.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: 2, at: 'f1' } }), '放出哪一台：沒有這個選項。')
    const g2 = play(ids, { foes: foes() })
    turnTo(g2, 'a1')
    refused(g2.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: NTH.attack } }), '要選一個敵人。')
    expect(ovs(g2)).toHaveLength(0)
    expect(unit(g, 'a1').ap.now).toBe(ap)
    deploy(g2, NTH.shield, 1)
    turnTo(g2, 'a1')
    refused(g2.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: NTH.medic } }), '這一格已經掛著一台了。')
    // 放出去的那一台灰掉：選它被擋下，原因是一句完整的話
    refused(g2.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 3 }, pick: { drone: NTH.shield } }), '這一台已經放出去了。')
  })

  it('放出之前先看上限：連得住的台數滿了就放不出來（和一般的放出同一句）', () => {
    const g = play(ids, { foes: foes(), sync: 0 })
    turnTo(g, 'a1')
    deploy(g, 1, 3)
    turnTo(g, 'a1')
    refused(g.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: NTH.attack, at: 'f1' } }), '同步 0 級只連得住 1 台。')
  })
})

describe('掩護飛行：隊友那一格掛著你的一台時，打他的那一擊命中 −2；沒有掛著時不觸發、不扣行動點', () => {
  const ids = [ID('formation'), ID('cover_flight')]
  const attack = (a: Arena, at: number, d = dice(10)) => a.run(d).attack(a.foe(1), a.ally(at))

  it('同一格掛著：命中 −2、扣 1 行動點、記一拍', () => {
    const a = world(ids)
    put(a, 2, 'attack')
    const plain = world([])
    put(plain, 2, 'attack')
    const base = attack(plain, 2)
    const run = a.run(dice(10))
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r.total - base.total).toBe(-2)
    expect(fired(run, ID('cover_flight'))).toBe(1)
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    expect(a.ally(2).hp!.now).toBeLessThan(a.ally(2).hp!.max)
  })

  it('沒有掛著（掛在別格、相鄰一格不算：reach 預設 0）：不觸發、不扣行動點', () => {
    for (const slot of [3, 4, 1]) {
      const a = world(ids)
      put(a, slot, 'attack')
      const run = a.run(dice(10))
      const base = world([])
      put(base, slot, 'attack')
      expect(run.attack(a.foe(1), a.ally(2)).total, `掛在第 ${slot} 格`).toBe(attack(base, 2).total)
      expect(fired(run, ID('cover_flight'))).toBe(0)
      expect(a1(a).ap.now).toBe(a1(a).ap.max)
    }
    const none = world(ids)
    const r = none.run(dice(10))
    r.attack(none.foe(1), none.ally(2))
    expect(fired(r, ID('cover_flight'))).toBe(0)
  })

  it('機師自己那一格掛著自己的一台也算；被擊落的不算；每回合 1 次', () => {
    const a = world(ids)
    const o = put(a, 1, 'attack')
    const run = a.run(dice(10))
    run.attack(a.foe(1), a.ally(1))
    expect(fired(run, ID('cover_flight'))).toBe(1)
    const second = a.run(dice(10))
    second.attack(a.foe(1), a.ally(1))
    expect(fired(second, ID('cover_flight'))).toBe(0)
    const b = world(ids)
    put(b, 2, 'attack').down = true
    const rb = b.run(dice(10))
    rb.attack(b.foe(1), b.ally(2))
    expect(fired(rb, ID('cover_flight'))).toBe(0)
    expect(o.down).toBe(false)
  })

  it('別人的無人機不算：掛在隊友那一格、但操作者不是裝著掩護飛行的人', () => {
    const a = world(ids)
    a.run().addOverlay({ side: 'ally', slot: 3, owner: 'a2', kind: 'attack', name: '別人的', hp: { now: 14, max: 14 }, armor: 1, evade: 13, ext: { drone: -1, grade: 1 } })
    const run = a.run(dice(10))
    run.attack(a.foe(1), a.ally(3))
    expect(fired(run, ID('cover_flight'))).toBe(0)
  })

  it('敵人的攻擊才算（隊友誤傷、打無人機本身不觸發）', () => {
    const a = world(ids)
    const o = put(a, 2, 'attack')
    const run = a.run(dice(10, 1, 1, 1, 1))
    run.attackOverlay(a.foe(1), o)
    expect(fired(run, ID('cover_flight'))).toBe(0)
  })
})

describe('多工連結：同步 0 的人第二台只放得出支援型；攻擊型被擋，原因是一句完整的話', () => {
  const SENTENCE = '同步 0 級連得住 1 台，已經放滿了；多出來的那一台只能是護盾型、偵察型或醫療型。'

  it('沒有多工連結：第二台放不出來（整個放出灰掉）', () => {
    const g = play([ID('formation')], { sync: 0 })
    turnTo(g, 'a1')
    expect(deploy(g, 0, 1).status).toBe('applied')
    turnTo(g, 'a1')
    expect(opt(g, 'drone.deploy').blocks).toEqual(['同步 0 級只連得住 1 台。'])
    refused(deploy(g, 1, 2), '同步 0 級只連得住 1 台。')
  })

  it('有多工連結：第二台只能是支援型（護盾、偵察、醫療）；攻擊型與干擾型被擋、宣告也灰掉，原因寫得出來', () => {
    const g = play([ID('formation'), ID('multitask')], { sync: 0 })
    turnTo(g, 'a1')
    expect(deploy(g, 0, 1).status).toBe('applied')
    turnTo(g, 'a1')
    expect(opt(g, 'drone.deploy').blocks).toEqual([])
    const blocks = opt(g, 'drone.deploy').picks[0]!.options.map((o) => o.blocks)
    expect(blocks).toEqual([['這一台已經放出去了。'], [], [], [], [SENTENCE]])
    refused(deploy(g, 4, 2), SENTENCE)
    expect(mismatches(g, opt(g, 'drone.deploy')).bad).toEqual([])
    expect(deploy(g, 3, 2).status).toBe('applied')
    expect(ovs(g).map((o) => o.kind)).toEqual(['attack', 'medic'])
    // 兩台放滿了：一般的「只連得住 2 台」
    turnTo(g, 'a1')
    expect(opt(g, 'drone.deploy').blocks).toEqual(['同步 0 級只連得住 2 台。'])
  })

  it('第一台就放支援型：第二台還是只能是支援型；兩台支援型之後放滿', () => {
    const g = play([ID('formation'), ID('multitask')], { sync: 0 })
    turnTo(g, 'a1')
    expect(deploy(g, 1, 1).status).toBe('applied')
    turnTo(g, 'a1')
    refused(deploy(g, 0, 2), SENTENCE)
    expect(deploy(g, 2, 2).status).toBe('applied')
    turnTo(g, 'a1')
    refused(deploy(g, 3, 3), '同步 0 級只連得住 2 台。')
  })

  it('overlay_cap 的標籤：[種類]，支援型多一個 support（問的是操作者）', () => {
    const seen: string[][] = []
    const g = play([], { sync: 2, prep: (k) => k.battle.modifier('probe', (q) => (q.kind === 'overlay_cap' ? (seen.push([...q.tags]), []) : [])) })
    turnTo(g, 'a1')
    opt(g, 'drone.deploy')
    deploy(g, 3, 1)
    expect(seen.some((t) => t.join() === 'medic,support')).toBe(true)
    deploy(g, 0, 2)
    expect(seen.some((t) => t.join() === 'attack')).toBe(true)
  })
})

describe('再來一輪、飽和攻擊：多動一次、一整組各打一次，之後不能再指揮', () => {
  const bossFoes = () => [foe('boss', { ...quiet, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]

  it('再來一輪：同一台一回合動兩次、一共 2 行動點，第二次命中 +1；之後這一台算動過了', () => {
    const g = play([ID('formation'), ID('one_more')], { foes: bossFoes() })
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    const id = ovs(g)[0]!.id
    const ap = unit(g, 'a1').ap.now
    const r = g.battleAct({ action: ID('one_more'), target: { overlay: id }, pick: { at: 'f1' } })
    expect(r.status).toBe('applied')
    expect(unit(g, 'a1').ap.now).toBe(ap - 2)
    const rolls = rollsOf(r)
    expect(rolls.map((x) => x.skill)).toEqual(['piloting', 'piloting'])
    expect(partOf(rolls[0]!, '無人機射擊')).toBeUndefined()
    expect(partOf(rolls[1]!, '無人機射擊')).toBe(1)
    expect(ovs(g)[0]!.used).toBe(true)
    turnTo(g, 'a1')
    refused(g.battleAct({ action: 'drone.command', target: { overlay: id }, pick: { at: 'f1' } }), '這一台這一回合動過了。')
    // 動過了的那一台，再來一輪也不行（原本每台每回合一次，這一招是多一次，不是第三次）
    turnTo(g, 'a1')
    refused(g.battleAct({ action: ID('one_more'), target: { overlay: id }, pick: { at: 'f1' } }), '這一台這一回合動過了。')
  })

  it('再來一輪：沒選敵人（攻擊型）整步不成立；醫療型兩次都急救', () => {
    const g = play([ID('formation'), ID('one_more')], { foes: bossFoes() })
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    const ap = unit(g, 'a1').ap.now
    refused(g.battleAct({ action: ID('one_more'), target: { overlay: ovs(g)[0]!.id } }), '要選一個敵人。')
    expect(unit(g, 'a1').ap.now).toBe(ap)
    expect(ovs(g)[0]!.used).toBe(false)
    const m = play([ID('formation'), ID('one_more')], { foes: bossFoes() })
    turnTo(m, 'a1')
    deploy(m, 3, 2)
    unit(m, 'a2').hp!.now = 5
    expect(m.battleAct({ action: ID('one_more'), target: { overlay: ovs(m)[0]!.id } }).status).toBe('applied')
    expect(unit(m, 'a2').hp!.now).toBeGreaterThan(5 + 1)
  })

  it('飽和攻擊：最多三台各打同一個目標一次、每一下命中 +1、不另外花指揮的行動點；這幾台之後不能再指揮；每回合 1 次', () => {
    const g = play([ID('formation'), ID('saturation')], { foes: bossFoes(), sync: 6, drones: ['attack', 'attack', 'attack', 'attack'] })
    turnTo(g, 'a1')
    for (let i = 0; i < 4; i++) {
      unit(g, 'a1').ap.now = 6
      expect(deploy(g, i, i + 1).status).toBe('applied')
    }
    turnTo(g, 'a1')
    const ap = unit(g, 'a1').ap.now
    const r = g.battleAct({ action: ID('saturation'), target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    expect(unit(g, 'a1').ap.now).toBe(ap - 2)
    const rolls = rollsOf(r)
    expect(rolls).toHaveLength(3)
    for (const roll of rolls) {
      expect(roll.skill).toBe('piloting')
      expect(partOf(roll, '無人機射擊')).toBe(1)
    }
    expect(ovs(g).map((o) => o.used)).toEqual([true, true, true, false])
    // 打過的不能再指揮；沒打的那一台還可以
    refused(g.battleAct({ action: 'drone.command', target: { overlay: ovs(g)[0]!.id }, pick: { at: 'f1' } }), '這一台這一回合動過了。')
    expect(g.battleAct({ action: 'drone.command', target: { overlay: ovs(g)[3]!.id }, pick: { at: 'f1' } }).status).toBe('applied')
    // 每回合 1 次
    expect(opt(g, ID('saturation')).ok).toBe(false)
    expect(opt(g, ID('saturation')).blocks).toHaveLength(1)
  })

  it('飽和攻擊：動過的不再動、不是射擊型的不動（護盾、偵察、醫療不開火）；目標倒下就停', () => {
    const g = play([ID('formation'), ID('saturation')], { foes: bossFoes(), sync: 6, drones: ['attack', 'shield', 'attack', 'medic'] })
    turnTo(g, 'a1')
    for (let i = 0; i < 4; i++) {
      unit(g, 'a1').ap.now = 6
      deploy(g, i, i + 1)
    }
    turnTo(g, 'a1')
    // 第 1 台已經指揮過了
    g.battleAct({ action: 'drone.command', target: { overlay: ovs(g)[0]!.id }, pick: { at: 'f1' } })
    const r = g.battleAct({ action: ID('saturation'), target: { unit: 'f1' } })
    expect(rollsOf(r)).toHaveLength(1)
    expect(ovs(g).map((o) => o.used)).toEqual([true, false, true, false])
    // 目標一擊就倒：後面的不再打
    const w = world([ID('formation'), ID('saturation')], { foes: [foe('minion', { ...quiet, hp: { now: 1, max: 1 } } as never), foe('minion', quiet as never)], sync: 6 })
    put(w, 1, 'attack')
    put(w, 2, 'attack')
    put(w, 3, 'attack')
    const run = cast(w, ID('saturation'), { unit: 'f1' }, { d: dice(15, 3, 3, 3, 3) })
    expect(hits(run)).toHaveLength(1)
    expect(w.foe(1).out).toBe('down')
    expect(overlaysOf(w).map((o) => o.used)).toEqual([true, false, false])
  })
})

describe('雙聯火控：自己射擊一次、同格的那一台跟著打同一個目標（不另外花指揮的行動點）', () => {
  const ids = [ID('formation'), ID('dual_fire')]
  const bossFoes = () => [foe('boss', { ...quiet, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]

  it('同格的那一台跟著打：兩次檢定（機師的槍、無人機的）；那一台算已經指揮過；別格的不動', () => {
    const g = play(ids, { foes: bossFoes(), sync: 4, drones: ['attack', 'attack'] })
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    unit(g, 'a1').ap.now = 6
    deploy(g, 1, 2)
    turnTo(g, 'a1')
    const ap = unit(g, 'a1').ap.now
    const r = g.battleAct({ action: ID('dual_fire'), target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    expect(unit(g, 'a1').ap.now).toBe(ap - 2)
    expect(rollsOf(r).map((x) => x.skill)).toEqual(['firearms', 'piloting'])
    expect(ovs(g).map((o) => o.used)).toEqual([true, false])
  })

  it('同格沒有無人機：只有自己一槍；同格的是護盾型：不開火（護盾型沒有射擊）', () => {
    const g = play(ids, { foes: bossFoes(), drones: ['attack'] })
    turnTo(g, 'a1')
    deploy(g, 0, 3)
    turnTo(g, 'a1')
    expect(rollsOf(g.battleAct({ action: ID('dual_fire'), target: { unit: 'f1' } })).map((x) => x.skill)).toEqual(['firearms'])
    expect(ovs(g)[0]!.used).toBe(false)
    const s = play(ids, { foes: bossFoes(), drones: ['shield'] })
    turnTo(s, 'a1')
    deploy(s, 0, 1)
    turnTo(s, 'a1')
    expect(rollsOf(s.battleAct({ action: ID('dual_fire'), target: { unit: 'f1' } })).map((x) => x.skill)).toEqual(['firearms'])
  })

  it('自己的一槍就打倒了目標：那一台不再補一槍、也不算動過', () => {
    const w = world(ids, { foes: [foe('minion', { ...quiet, hp: { now: 1, max: 1 } } as never), foe('minion', quiet as never)] })
    put(w, 1, 'attack')
    const run = cast(w, ID('dual_fire'), { unit: 'f1' }, { d: dice(15, 3, 3, 3, 3) })
    expect(hits(run)).toHaveLength(1)
    expect(overlaysOf(w)[0]!.used).toBe(false)
  })

  it('宣告與行動對得上（沒有另外要選的東西）', () => {
    const g = play(ids, { foes: bossFoes(), drones: ['attack'] })
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    turnTo(g, 'a1')
    const m = mismatches(g, opt(g, ID('dual_fire')))
    expect(m.bad).toEqual([])
    expect(m.tried).toBeGreaterThan(0)
  })
})

describe('護航編隊（姿態）、就地維修、煙幕護航、派駐', () => {
  it('護航編隊：開著時和無人機同一格的人迴避 +1，最多兩格受惠；關掉就沒有；開關各 1 行動點', () => {
    const g = play([ID('formation'), ID('escort')], { sync: 6, drones: ['attack', 'scout', 'medic', 'jammer'], allies: undefined })
    turnTo(g, 'a1')
    for (let i = 0; i < 3; i++) {
      unit(g, 'a1').ap.now = 6
      deploy(g, i, i + 1)
    }
    turnTo(g, 'a1')
    const evade = (id: string) => sum(gmods(g, 'evade', id).filter((p) => p.label === '護航編隊'))
    expect([evade('a1'), evade('a2'), evade('a3')]).toEqual([0, 0, 0])
    const ap = unit(g, 'a1').ap.now
    expect(g.battleAct({ action: ID('escort') }).status).toBe('applied')
    expect(unit(g, 'a1').ap.now).toBe(ap - 1)
    expect([evade('a1'), evade('a2'), evade('a3')]).toEqual([1, 1, 0])
    // 無人機移到別格，受惠的格跟著走（還是前面兩格）
    g.battleAct({ action: 'drone.move', target: { overlay: ovs(g)[2]!.id }, pick: { slot: 4 } })
    expect([evade('a1'), evade('a2'), evade('a3')]).toEqual([1, 1, 0])
    expect(g.battleAct({ action: ID('escort') }).status).toBe('applied')
    expect([evade('a1'), evade('a2'), evade('a3')]).toEqual([0, 0, 0])
    expect(unit(g, 'a1').uses['escort.evade']).toBeUndefined()
  })

  it('護航編隊：四台無人機也只有兩格受惠；沒掛無人機的格沒有', () => {
    const g = play([ID('formation'), ID('escort')], { sync: 6, drones: ['attack', 'scout', 'medic', 'jammer'], allies: [pilot([ID('formation'), ID('escort')], { sync: 6, drones: ['attack', 'scout', 'medic', 'jammer'] }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3), one({ weapon: 'pistol' }, 4)] })
    turnTo(g, 'a1')
    for (let i = 0; i < 4; i++) {
      unit(g, 'a1').ap.now = 6
      deploy(g, i, i + 1)
    }
    turnTo(g, 'a1')
    g.battleAct({ action: ID('escort') })
    const evade = (id: string) => sum(gmods(g, 'evade', id).filter((p) => p.label === '護航編隊'))
    expect(['a1', 'a2', 'a3', 'a4'].map(evade)).toEqual([1, 1, 0, 0])
  })

  it('就地維修：回復 10 點耐久（不超過上限），可以順便移到相鄰的一格；被擊落的選不了', () => {
    const a = world([ID('formation'), ID('quick_repair')])
    const o = put(a, 2, 'attack', { drone: -1 })
    o.hp.now = 3
    const run = cast(a, ID('quick_repair'), { overlay: o.id })
    // 耐久上限 19（編隊的共鳴 1 加了 5）：3 + 10
    expect(o.hp.now).toBe(13)
    expect(o.slot).toBe(2)
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    expect(run.beats.some((b) => b.text.includes('回復了 10 點耐久'))).toBe(true)
    cast(a, ID('quick_repair'), { overlay: o.id }, { pick: { to: 3 } })
    expect(o.hp.now).toBe(19)
    expect(o.slot).toBe(3)
    // 不是相鄰的格、掛著別台的格：整步不成立，耐久也沒回
    o.hp.now = 3
    expect(reasonOf(() => cast(a, ID('quick_repair'), { overlay: o.id }, { pick: { to: 2 } }))).toEqual([])
    expect(o.slot).toBe(2)
    o.hp.now = 3
    expect(reasonOf(() => cast(a, ID('quick_repair'), { overlay: o.id }, { pick: { to: 4 } }))).toEqual(['只能換到相鄰、沒有掛著別台的格。'])
    put(a, 3, 'attack')
    expect(reasonOf(() => cast(a, ID('quick_repair'), { overlay: o.id }, { pick: { to: 3 } }))).toEqual(['只能換到相鄰、沒有掛著別台的格。'])
    o.down = true
    expect(reasonOf(() => cast(a, ID('quick_repair'), { overlay: o.id }))).toEqual(['這個目標不能選。'])
  })

  it('就地維修：換不過去時整步不成立（走完整的提交：耐久沒回、行動點沒扣）', () => {
    const g = play([ID('formation'), ID('quick_repair')])
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    ovs(g)[0]!.hp.now = 3
    turnTo(g, 'a1')
    const ap = unit(g, 'a1').ap.now
    refused(g.battleAct({ action: ID('quick_repair'), target: { overlay: ovs(g)[0]!.id }, pick: { to: 4 } }), '只能換到相鄰、沒有掛著別台的格。')
    expect([ovs(g)[0]!.hp.now, unit(g, 'a1').ap.now]).toEqual([3, ap])
    expect(g.battleAct({ action: ID('quick_repair'), target: { overlay: ovs(g)[0]!.id }, pick: { to: 2 } }).status).toBe('applied')
    expect([ovs(g)[0]!.hp.now, ovs(g)[0]!.slot]).toEqual([13, 2])
  })

  it('煙幕護航：那一台掛的那一格變成打不破的半掩體，持續 2 回合；本來就是掩體的格子在煙散掉之前也不會低於半掩體', () => {
    const a = world([ID('formation'), ID('smoke_cover')], { cover: { ally: [0, 2, 0, 0], foe: [0, 0, 0, 0] } })
    const o1 = put(a, 1, 'attack')
    const o2 = put(a, 2, 'attack')
    cast(a, ID('smoke_cover'), { overlay: o1.id })
    cast(a, ID('smoke_cover'), { overlay: o2.id })
    const round = a.battle.round
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 0, soft: { kind: 'smoke', until: round + 1 } })
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 2, soft: { kind: 'smoke' } })
    const run = a.run()
    expect(run.evadeOf(a.ally(1)).cover).toBeGreaterThan(0)
    // 怎麼打都不會壞
    run.hurtCover('ally', 1, 999)
    run.hurtCover('ally', 2, 999)
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 0 })
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 2 })
    expect(a.run().evadeOf(a.ally(1)).cover).toBeGreaterThan(0)
    // 第 2 個回合結束時散掉
    nextRound(a)
    expect(a.battle.cover.ally[0]!.soft).toBeDefined()
    nextRound(a)
    expect(a.battle.cover.ally[0]!.soft).toBeUndefined()
    expect(a.battle.cover.ally[1]!.soft).toBeUndefined()
    expect(a.battle.cover.ally[1]!.level).toBe(2)
  })

  it('派駐：把一台移到我方任何一格（不必相鄰），到你的下一個回合開始前，那一格的人迴避 +1', () => {
    const a = world([ID('formation'), ID('accompany')])
    const o = put(a, 1, 'attack')
    const evade = (id: string) => sum(modParts(a, 'evade', id).filter((p) => p.label === '派駐'))
    cast(a, ID('accompany'), { overlay: o.id }, { pick: { to: 3 } })
    expect(o.slot).toBe(3)
    expect([evade('a1'), evade('a2'), evade('a3')]).toEqual([0, 0, 1])
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    // 掛著別台的格、原本那一格：不行
    put(a, 2, 'scout')
    expect(reasonOf(() => cast(a, ID('accompany'), { overlay: o.id }, { pick: { to: 2 } }))).toEqual(['要選一個沒有掛著別台的格。'])
    expect(reasonOf(() => cast(a, ID('accompany'), { overlay: o.id }, { pick: { to: 3 } }))).toEqual(['要選一個沒有掛著別台的格。'])
    // 空格也行（那一格沒有人，沒有人吃加成）
    cast(a, ID('accompany'), { overlay: o.id }, { pick: { to: 4 } })
    expect(o.slot).toBe(4)
    // 機師的下一個回合開始：加成結束
    a.k.battle.emit('turn.start', { run: a.run(), unit: a1(a) })
    expect([evade('a1'), evade('a2'), evade('a3')]).toEqual([0, 0, 0])
  })

  it('這幾個技能的宣告與行動對得上（要選的格、要選的敵人）；派駐要選的格是否掛著別台，只有做的時候才知道（上一條）', () => {
    const g = play([ID('formation'), ID('quick_repair'), ID('smoke_cover'), ID('accompany'), ID('ram_in'), ID('precision')], { foes: [foe('boss', { ...quiet, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)] })
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    unit(g, 'a1').ap.now = 6
    deploy(g, 2, 2)
    turnTo(g, 'a1')
    for (const id of ['quick_repair', 'smoke_cover', 'precision']) {
      const m = mismatches(g, opt(g, ID(id)))
      expect(m.bad, id).toEqual([])
      expect(m.tried, id).toBeGreaterThan(0)
    }
  })
})

describe('撞過去！沒有機甲的那一半：那一台沒了、操作者感載照加、目標受 3d6 物理傷害並被往後推一格', () => {
  it('那一台被擊落（回灌 5 點）、目標受傷、被推到第 2 格', () => {
    const a = world([ID('formation'), ID('ram_in')], { foes: [foe('boss', quiet as never), foe('minion', quiet as never)] })
    const o = put(a, 2, 'attack')
    const hp = a.foe(1).hp!.now
    const run = cast(a, ID('ram_in'), { overlay: o.id }, { pick: { at: 'f1' }, d: dice(4, 4, 4) })
    expect(o.down).toBe(true)
    expect(a1(a).load!.now).toBe(5)
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 2)
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
    expect(a.foe(1).slot).toBe(2)
    expect(a.foe(2).slot).toBe(1)
    expect(run.beats.some((b) => b.text.includes('撞了過去'))).toBe(true)
    // 3d6：三顆骰各 4，扣護甲之後的傷害
    expect(run.beats.find((b) => b.tag === 'damage' && (b.data as Rec).target === 'f1')).toBeDefined()
  })

  it('回灌緩衝讓被擊落只 +2；打的不是第 1 格的人整步不成立（那一台還在）', () => {
    const a = world([ID('formation'), ID('ram_in'), ID('feedback_buffer')], { foes: [foe('boss', quiet as never), foe('minion', quiet as never)] })
    const o = put(a, 2, 'attack')
    expect(reasonOf(() => cast(a, ID('ram_in'), { overlay: o.id }, { pick: { at: 'f2' } }))).toEqual(['只能撞敵方第 1 格的人。'])
    expect(o.down).toBe(false)
    expect(a1(a).load!.now).toBe(0)
    cast(a, ID('ram_in'), { overlay: o.id }, { pick: { at: 'f1' } })
    expect(a1(a).load!.now).toBe(2)
  })

  it('目標被撞倒：不再往後推；臨時機（蜂群）撞上去不灌感載', () => {
    const a = world([ID('formation'), ID('ram_in')], { foes: [foe('minion', { ...quiet, hp: { now: 1, max: 1 } } as never), foe('minion', quiet as never)] })
    const o = put(a, 2, 'attack', { noBacklash: true })
    cast(a, ID('ram_in'), { overlay: o.id }, { pick: { at: 'f1' }, d: dice(6, 6, 6) })
    expect(a.foe(1).out).toBe('down')
    expect(a1(a).load!.now).toBe(0)
  })
})

describe('攔截、穹頂、回灌緩衝：那一擊改打無人機（照它的迴避與護甲）、第一次攻擊被擋、被擊落只 +2', () => {
  const bigFoes = () => [foe('boss', { ...hitter, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]
  const strike = (a: Arena, target: BattleUnit, d = dice(10, 4, 4, 4, 4, 4, 4)) => a.run(d).attack(a.foe(1), target)

  it('攔截：隊友被攻擊時，同一格或相鄰一格的一台無人機擋到前面，改打它：照無人機的迴避與護甲算，隊友不受傷；每回合 1 次', () => {
    const a = world([ID('formation'), ID('intercept')], { foes: bigFoes() })
    const d = put(a, 1, 'attack')
    const hp = a.ally(2).hp!.now
    const run = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    const r = run.attack(a.foe(1), a.ally(2))
    expect(r).toMatchObject({ redirected: true, hit: true, evade: 13 })
    expect(a.ally(2).hp!.now).toBe(hp)
    expect(d.hp.now).toBe(d.hp.max - r.dealt)
    expect(r.dealt).toBeGreaterThan(0)
    expect(fired(run, ID('intercept'))).toBe(1)
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    // 每回合 1 次：第二次不擋
    const second = strike(a, a.ally(2))
    expect(second.redirected).toBeUndefined()
    expect(a.ally(2).hp!.now).toBeLessThan(hp)
  })

  it('攔截：兩格以外的無人機擋不到；同一格的優先（掩護飛行只擋同一格，攔截可以放寬到相鄰）', () => {
    const a = world([ID('formation'), ID('intercept')], { foes: bigFoes() })
    put(a, 4, 'attack')
    expect(strike(a, a.ally(2)).redirected).toBeUndefined()
    expect(a1(a).ap.now).toBe(a1(a).ap.max)
    const b = world([ID('formation'), ID('intercept')], { foes: bigFoes() })
    const near = put(b, 1, 'attack')
    const same = put(b, 2, 'scout')
    strike(b, b.ally(2))
    expect(same.hp.now).toBeLessThan(same.hp.max)
    expect(near.hp.now).toBe(near.hp.max)
  })

  it('攔截：隊友是被誤傷、或打的是無人機本身時不觸發', () => {
    const a = world([ID('formation'), ID('intercept')], { foes: bigFoes() })
    const d = put(a, 1, 'attack')
    const run = a.run(dice(10, 4, 4, 4, 4, 4))
    run.attackOverlay(a.foe(1), d)
    expect(fired(run, ID('intercept'))).toBe(0)
  })

  it('穹頂：我方每一格迴避 +2；每一台無人機替同一格的人擋下第一次攻擊（那一下改打無人機）；到你的下一個回合開始前', () => {
    const a = world([ID('formation'), ID('dome')], { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    const d2 = put(a, 2, 'scout')
    const evade = (id: string) => sum(modParts(a, 'evade', id).filter((p) => p.label === '穹頂'))
    cast(a, ID('dome'), null)
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 3)
    expect(['a1', 'a2', 'a3'].map(evade)).toEqual([2, 2, 2])
    expect([d1.ext!.guard, d2.ext!.guard]).toEqual(['own_turn_start', 'own_turn_start'])
    // 打第 2 格的人：改打第 2 格的無人機（用掉了它的守著）；第二次照常打人；第 1 格的人還有一台守著
    const hp2 = a.ally(2).hp!.now
    expect(strike(a, a.ally(2)).redirected).toBe(true)
    expect(a.ally(2).hp!.now).toBe(hp2)
    expect(d2.ext!.guard).toBeUndefined()
    expect(strike(a, a.ally(2)).redirected).toBeUndefined()
    expect(a.ally(2).hp!.now).toBeLessThan(hp2)
    expect(strike(a, a.ally(1)).redirected).toBe(true)
    expect(strike(a, a.ally(1)).redirected).toBeUndefined()
    // 沒有無人機的第 3 格：沒有人擋
    expect(strike(a, a.ally(3)).redirected).toBeUndefined()
    // 每場 1 次
    expect(reasonOf(() => cast(a, ID('dome'), null)).length).toBe(1)
    // 機師的下一個回合開始：迴避加成結束
    a.k.battle.emit('turn.start', { run: a.run(), unit: a1(a) })
    expect(['a1', 'a2', 'a3'].map(evade)).toEqual([0, 0, 0])
  })

  it('穹頂的守著：到機師的下一個回合開始就結束（沒用掉的）', () => {
    const a = world([ID('formation'), ID('dome')], { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    cast(a, ID('dome'), null)
    expect(d1.ext!.guard).toBe('own_turn_start')
    a.k.battle.emit('turn.start', { run: a.run(), unit: a.ally(2) })
    expect(d1.ext!.guard).toBe('own_turn_start')
    a.k.battle.emit('turn.start', { run: a.run(), unit: a1(a) })
    expect(d1.ext!.guard).toBeUndefined()
    expect(strike(a, a.ally(1)).redirected).toBeUndefined()
  })

  it('回灌緩衝：無人機被擊落時操作者的感載只 +2（原本 +5）；被擊落的這一場不能再放', () => {
    const kill = (ids: string[]) => {
      const a = world(ids, { foes: bigFoes() })
      const d = put(a, 1, 'attack', { drone: 0 })
      a.run().damageOverlay(d, 999, 'physical', a.foe(1))
      return { a, d }
    }
    expect(a1(kill([ID('formation')]).a).load!.now).toBe(5)
    const { a, d } = kill([ID('formation'), ID('feedback_buffer')])
    expect(d.down).toBe(true)
    expect(a1(a).load!.now).toBe(2)
    expect(a1(a).uses['drone:0']).toBe(2)
  })
})

describe('護盾型被指揮之後替同一格的人擋一次；偵察型同一格的人在黑暗裡打人沒有被扣', () => {
  const bigFoes = () => [foe('boss', { ...hitter, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]

  it('護盾型指揮：到操作者的下一個回合開始，同一格的人被攻擊時那一擊改打它，只擋一次、只擋同一格；算動過、1 行動點', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const sh = put(a, 2, 'shield')
    cast(a, 'drone.command', { overlay: sh.id })
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    expect(sh).toMatchObject({ used: true, ext: { guard: 'own_turn_start' } })
    const hp = a.ally(2).hp!.now
    expect(a.run(dice(10, 4, 4, 4, 4, 4)).attack(a.foe(1), a.ally(3)).redirected).toBeUndefined()
    const r = a.run(dice(10, 4, 4, 4, 4, 4)).attack(a.foe(1), a.ally(2))
    expect(r).toMatchObject({ redirected: true, hit: true })
    expect(a.ally(2).hp!.now).toBe(hp)
    expect(sh.ext!.guard).toBeUndefined()
    expect(a.run(dice(10, 4, 4, 4, 4, 4)).attack(a.foe(1), a.ally(2)).redirected).toBeUndefined()
  })

  it('護盾型守著的結束：操作者的下一個回合開始；沒被擊落以前它自己的迴避 +2 照舊', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const sh = put(a, 2, 'shield')
    cast(a, 'drone.command', { overlay: sh.id })
    a.k.battle.emit('turn.start', { run: a.run(), unit: a1(a) })
    expect(sh.ext!.guard).toBeUndefined()
    expect(a.run(dice(10, 4, 4, 4, 4, 4)).attack(a.foe(1), a.ally(2)).redirected).toBeUndefined()
    expect(sum(modParts(a, 'evade', 'a2').filter((p) => p.label === '護盾無人機'))).toBe(2)
  })

  it('已經有人設了擋槍（反應先設了 redirect）：守著不搶；那一台挨了一擊，守著就算用掉了', () => {
    const a = world([ID('formation'), ID('intercept')], { foes: bigFoes() })
    const mine = put(a, 1, 'attack')
    const sh = put(a, 2, 'shield')
    cast(a, 'drone.command', { overlay: sh.id })
    const r = a.run(dice(10, 4, 4, 4, 4, 4)).attack(a.foe(1), a.ally(2))
    expect(r.redirected).toBe(true)
    // 攔截挑同一格的優先（護盾型在第 2 格），所以擋的是護盾型；這一台已經挨了一擊，守著也算用掉了
    expect(sh.hp.now).toBeLessThan(sh.hp.max)
    expect(mine.hp.now).toBe(mine.hp.max)
    expect(sh.ext!.guard).toBeUndefined()
    expect(a.run(dice(10, 4, 4, 4, 4, 4)).attack(a.foe(1), a.ally(2)).redirected).toBeUndefined()
  })

  it('偵察型：和它同一格的人 see_dark（不吃黑暗）；別格的人、偵察型被擊落之後不行；打人的命中不吃黑暗的迴避', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    a.battle.field.dark = true
    const scout = put(a, 2, 'scout')
    const run = a.run()
    expect([run.seesDark(a.ally(1)), run.seesDark(a.ally(2)), run.seesDark(a.ally(3))]).toEqual([false, true, false])
    expect(modParts(a, 'see_dark', 'a2').map((p) => p.label)).toEqual(['偵察無人機'])
    const dark = (u: BattleUnit) => run.evadeOf(a.foe(1), u).parts.some((p) => p.label === '黑暗')
    expect([dark(a.ally(1)), dark(a.ally(2)), dark(a.ally(3))]).toEqual([true, false, true])
    scout.down = true
    expect(a.run().seesDark(a.ally(2))).toBe(false)
  })

  it('偵察型在敵方的格上不給我方的人 see_dark（要同一方）', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    a.battle.field.dark = true
    a.run().addOverlay({ side: 'foe', slot: 2, kind: 'scout', name: '敵方偵察機', hp: { now: 5, max: 5 }, armor: 0, evade: 0 })
    expect(a.run().seesDark(a.ally(2))).toBe(false)
    expect(a.run().seesDark(a.foe(2))).toBe(true)
  })
})

describe('蜂群：多放兩台臨時的攻擊型、不算進上限、三回合後自己消失、被擊落不加感載', () => {
  const bigFoes = () => [foe('boss', { ...quiet, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]

  it('3 行動點：放出兩台額外的攻擊型（沒指定格就掛在有人站的空格），接著所有的無人機各射擊一次', () => {
    const a = world([ID('formation'), ID('swarm')], { foes: bigFoes() })
    const mine = put(a, 1, 'attack', { drone: 0 })
    a.battle.units.a1!.uses['drone:0'] = 1
    const round = a.battle.round
    const run = cast(a, ID('swarm'), { unit: 'f1' })
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 3)
    expect(overlaysOf(a).map((o) => [o.kind, o.slot])).toEqual([['attack', 1], ['attack', 2], ['attack', 3]])
    const [t1, t2] = overlaysOf(a).slice(1)
    for (const t of [t1!, t2!]) expect(t.ext).toMatchObject({ overCap: true, noBacklash: true, until: round + 2, grade: 1 })
    expect(hits(run).map((x) => x.skill)).toEqual(['piloting', 'piloting', 'piloting'])
    expect(overlaysOf(a).map((o) => o.used)).toEqual([true, true, true])
    expect(mine.used).toBe(true)
    // 每場 1 次
    expect(reasonOf(() => cast(a, ID('swarm'), { unit: 'f1' })).length).toBe(1)
  })

  it('不算進同步的上限：臨時機在場時，同步 2 的人照樣放得出第二台；沒空格就少放', () => {
    const g = play([ID('formation'), ID('swarm')], { sync: 2, foes: bigFoes() })
    turnTo(g, 'a1')
    deploy(g, 0, 1)
    turnTo(g, 'a1')
    g.battleAct({ action: ID('swarm'), target: { unit: 'f1' } })
    expect(ovs(g)).toHaveLength(3)
    turnTo(g, 'a1')
    expect(opt(g, 'drone.deploy').blocks).toEqual([])
    expect(deploy(g, 1, 4).status).toBe('applied')
    // 滿了：同步 2 級連得住 2 台（臨時機不算）
    turnTo(g, 'a1')
    expect(opt(g, 'drone.deploy').blocks).toContain('同步 2 級只連得住 2 台。')
    // 四格都掛滿時蜂群放不出新的（記一拍，不丟錯），其餘照做
    const w = world([ID('formation'), ID('swarm')], { foes: bigFoes() })
    for (const slot of [1, 2, 3, 4]) put(w, slot, 'attack')
    const run = cast(w, ID('swarm'), { unit: 'f1' })
    expect(overlaysOf(w)).toHaveLength(4)
    expect(run.beats.filter((b) => b.text.includes('沒有空的格子')).length).toBe(2)
  })

  it('持續 3 回合：第三個回合結束之後的下一輪開頭自己收回（不是被擊落：沒有回灌）', () => {
    const a = world([ID('formation'), ID('swarm')], { foes: bigFoes() })
    cast(a, ID('swarm'), { unit: 'f1' })
    expect(overlaysOf(a)).toHaveLength(2)
    nextRound(a)
    nextRound(a)
    expect(overlaysOf(a)).toHaveLength(2)
    const before = a1(a).load!.now
    // 同一個 run 輪完這一輪：收回的那兩拍（expired: true）要在這個 run 的紀錄裡，而且不是被擊落（沒有 overlay.down）
    const run = a.run(FIX.slice())
    const round = a.battle.round
    for (let i = 0; i < 60 && a.battle.round === round; i++) advance(run)
    expect(overlaysOf(a)).toHaveLength(0)
    expect(a1(a).load!.now).toBe(before)
    expect(run.beats.filter((b) => (b.data as Rec | undefined)?.expired === true)).toHaveLength(2)
    expect(run.beats.some((b) => b.tag === 'overlay.down')).toBe(false)
  })

  it('臨時機被擊落：不加感載；放出來的正式的一台被擊落照加', () => {
    const a = world([ID('formation'), ID('swarm')], { foes: bigFoes() })
    const mine = put(a, 1, 'attack', { drone: 0 })
    cast(a, ID('swarm'), { unit: 'f1' })
    const temp = overlaysOf(a)[1]!
    a.run().damageOverlay(temp, 999, 'physical', a.foe(1))
    expect(temp.down).toBe(true)
    expect(a1(a).load!.now).toBe(0)
    a.run().damageOverlay(mine, 999, 'physical', a.foe(1))
    expect(a1(a).load!.now).toBe(5)
  })

  it('收回臨時機（drone.recall）也行，不會動到單位上的第 N 台', () => {
    const g = play([ID('formation'), ID('swarm')], { foes: bigFoes() })
    turnTo(g, 'a1')
    deploy(g, 0, 4)
    turnTo(g, 'a1')
    g.battleAct({ action: ID('swarm'), target: { unit: 'f1' } })
    const temp = ovs(g).find((o) => o.ext!.until !== undefined)!
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'drone.recall', target: { overlay: temp.id } }).status).toBe('applied')
    expect(unit(g, 'a1').uses['drone:0']).toBe(1)
    expect(unit(g, 'a1').uses['drone:-1']).toBeUndefined()
  })
})

describe('敢打我家孩子？：敵人攻擊你的一台無人機之後，其餘的無人機各朝他射擊一次（最多兩下），不另外花指揮的行動點', () => {
  const ids = [ID('formation'), ID('defend_kids')]
  const bigFoes = () => [foe('boss', { ...hitter, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]
  const shots = (run: BattleRun) => hits(run).filter((x) => x.skill === 'piloting')

  it('其餘的無人機最多兩台各射擊一次、打的是那個攻擊的人；被打的那一台不射；1 行動點；每回合 1 次', () => {
    const a = world(ids, { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    const d2 = put(a, 2, 'attack')
    const d3 = put(a, 3, 'attack')
    const d4 = put(a, 4, 'jammer')
    const run = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    run.attackOverlay(a.foe(1), d1)
    expect(fired(run, ID('defend_kids'))).toBe(1)
    expect(shots(run)).toHaveLength(2)
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    expect([d1.used, d2.used, d3.used, d4.used]).toEqual([false, true, true, false])
    expect(run.beats.filter((b) => b.roll && (b.data as Rec | undefined)?.target === 'f1').length).toBe(2)
    // 每回合 1 次
    const second = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    second.attackOverlay(a.foe(1), d1)
    expect(fired(second, ID('defend_kids'))).toBe(0)
    expect(shots(second)).toHaveLength(0)
  })

  it('被打的那一台被擊落了也照樣反擊（其餘的各射擊一次）；沒有其餘的無人機就不觸發、不扣行動點', () => {
    const a = world(ids, { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    put(a, 2, 'attack')
    const run = a.run(FIX.slice())
    run.attackOverlay(a.foe(1), d1)
    expect(d1.down).toBe(true)
    expect(fired(run, ID('defend_kids'))).toBe(1)
    expect(shots(run)).toHaveLength(1)
    const lone = world(ids, { foes: bigFoes() })
    const only = put(lone, 1, 'attack')
    const r2 = lone.run(dice(10, 4, 4, 4, 4))
    r2.attackOverlay(lone.foe(1), only)
    expect(shots(r2)).toHaveLength(0)
  })

  it('別人的無人機被打、機師自己被打都不觸發', () => {
    const a = world(ids, { foes: bigFoes() })
    put(a, 1, 'attack')
    put(a, 2, 'attack')
    const theirs = a.run().addOverlay({ side: 'ally', slot: 3, owner: 'a2', kind: 'attack', name: '別人的', hp: { now: 14, max: 14 }, armor: 1, evade: 13, ext: { drone: -1, grade: 1 } })
    const run = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    run.attackOverlay(a.foe(1), theirs)
    run.attack(a.foe(1), a.ally(1))
    expect(fired(run, ID('defend_kids'))).toBe(0)
  })

  it('攔截替人擋下的那一擊也算（改打的那一擊不發 attack.after，另外接 attack.redirected）', () => {
    const a = world([...ids, ID('intercept')], { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    put(a, 3, 'attack')
    put(a, 4, 'attack')
    const run = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    expect(run.attack(a.foe(1), a.ally(2)).redirected).toBe(true)
    expect(d1.hp.now).toBeLessThan(d1.hp.max)
    expect(fired(run, ID('intercept'))).toBe(1)
    expect(fired(run, ID('defend_kids'))).toBe(1)
    expect(shots(run)).toHaveLength(2)
  })

  it('攻擊的是砲塔或沒有操作者的無人機（替身）：不觸發，不花行動點、不用掉每回合的次數（M1b-review-features E5）；敵人的人打還是照常觸發', () => {
    const a = world(ids, { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    const d2 = put(a, 2, 'attack')
    const turret = a.run().addOverlay({ side: 'foe', slot: 1, kind: 'turret', name: '砲塔', hp: { now: 14, max: 14 }, armor: 1, evade: 10, weapon: { ...testWeapon('pistol', 30), mag: { now: 9, max: 9 } }, auto: true, ext: {} })
    const ap = a1(a).ap.now
    const run = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    run.overlayAttack(turret, run.standIn(d1))
    expect(d1.hp.now).toBeLessThan(d1.hp.max)
    expect(fired(run, ID('defend_kids'))).toBe(0)
    expect(shots(run)).toHaveLength(0)
    expect(a1(a).ap.now).toBe(ap)
    expect(a1(a).uses[`turn:${ID('defend_kids')}`]).toBeUndefined()
    expect(d2.used).toBe(false)
    // 同一回合接著是敵人的人打：次數還在，照常反擊
    const second = a.run(dice(10, 4, 4, 4, 4, 4, 4))
    second.attackOverlay(a.foe(1), d1)
    expect(fired(second, ID('defend_kids'))).toBe(1)
    expect(shots(second)).toHaveLength(1)
  })

  it('反應自己的射擊不再觸發反應（不會連鎖）', () => {
    const a = world([...ids, ID('cover_flight')], { foes: bigFoes() })
    const d1 = put(a, 1, 'attack')
    put(a, 2, 'attack')
    put(a, 3, 'attack')
    const run = a.run(FIX.slice())
    run.attackOverlay(a.foe(1), d1)
    expect(fired(run, ID('defend_kids'))).toBe(1)
    expect(fired(run, ID('cover_flight'))).toBe(0)
  })
})

describe('整備（預備）：下一場每一台耐久 +6、護甲 +1', () => {
  const owner = { pc: { ext: { abilities: { xp: 0, learned: [ID('formation'), ID('overhaul')], equipped: [ID('overhaul')], spent: { pilot: 40 } } } } }
  const battleOf = (): BattleSetup => ({
    mode: 'meat', grade: 1, cover: { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] },
    allies: [{ from: 'unit', unit: one({ actor: 'pc', weapon: 'pistol', skills: { sync: 2, piloting: 3 }, ext: { summons: { drones: [{ kind: 'attack', grade: 1 }, { kind: 'shield', grade: 2 }] } } } as never) as never }],
    foes: [{ from: 'unit', unit: foe('minion', quiet as never) as never }],
  })

  it('預備花一個時段；下一場放出的每一台耐久 +6、護甲 +1；再下一場沒有', async () => {
    const g = makeGame({ features: FEATURES, content: [PACK], ...owner }).game
    expect(prepBlock(g.k, g.state, 'pc', ID('overhaul'))).toBeNull()
    const before = toMinutes(g.state.time)
    g.commit(prep(g.k, g.state, 'pc', ID('overhaul')))
    expect(toMinutes(g.state.time) - before).toBe(240)
    g.startBattle(battleOf())
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = b.units.a1!.ap.max
    b.units.a1!.control = 'player'
    deploy(g, 0, 1)
    deploy(g, 1, 2)
    expect(ovs(g).map((o) => [o.kind, o.hp.max, o.armor])).toEqual([['attack', 20, 2], ['shield', 23, 3]])
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    await g.finishBattle()
    g.startBattle(battleOf())
    const c = g.state.battle!
    c.turn = c.order.indexOf('a1')
    c.units.a1!.ap.now = c.units.a1!.ap.max
    c.units.a1!.control = 'player'
    deploy(g, 0, 1)
    expect(ovs(g).map((o) => [o.kind, o.hp.max, o.armor])).toEqual([['attack', 14, 1]])
  })
})

describe('突擊姿態、堡壘姿態：現實能寫的那一半（機甲那一半是 when.hull，沒有機甲就不算）', () => {
  it('突擊姿態：開著時你和你的無人機命中 +1、迴避 −1；機甲狀態下近戰多一顆骰（沒有機甲不算）', () => {
    const a = world([ID('formation'), ID('assault')], { unit: { weapon: 'knife' } })
    const hit = () => sum(modParts(a, 'hit', 'a1', ['drone']).filter((p) => p.label === '突擊姿態'))
    expect([hit(), sum(modParts(a, 'evade', 'a1').filter((p) => p.label === '突擊姿態'))]).toEqual([0, 0])
    const run = cast(a, ID('assault'), null)
    expect(a1(a).stance).toBe(ID('assault'))
    expect(a1(a).ap.now).toBe(a1(a).ap.max - 1)
    expect(run.beats.some((b) => b.text.includes('進入'))).toBe(true)
    expect([hit(), sum(modParts(a, 'evade', 'a1').filter((p) => p.label === '突擊姿態'))]).toEqual([1, -1])
    expect(sum(modParts(a, 'dice', 'a1'))).toBe(0)
    a1(a).hull = { id: 'h', name: '機甲', hp: { now: 40, max: 40 }, armor: 2, backlash: 0.2 }
    expect(sum(modParts(a, 'dice', 'a1'))).toBe(1)
    // 開著時指揮無人機攻擊，算式裡有 +1
    delete a1(a).hull
    put(a, 1, 'attack')
    const r = cast(a, 'drone.command', { overlay: 'o1' }, { pick: { at: 'f1' } })
    expect(hits(r)[0]!.parts.some((p) => p.label === '突擊姿態' && p.value === 1)).toBe(true)
  })

  it('堡壘姿態：護甲 +1、不能自己換位（被推、被拉照算）、後面那一格的遮蔽高一級（最高到掩體）；關掉就恢復，換了位後面的人跟著換', () => {
    const a = world([ID('formation'), ID('bastion')], { cover: { ally: [0, 0, 1, 2], foe: [0, 0, 0, 0] } })
    const armor = () => sum(modParts(a, 'armor', 'a1').filter((p) => p.label === '堡壘姿態'))
    const cover = () => [1, 2, 3].map((i) => a.run().coverOf(a.ally(i)))
    // 後面那一格：a2（第 2 格，那一格本身是暴露）、a3（第 3 格，半掩體）
    expect(cover()).toEqual([0, 0, 1])
    cast(a, ID('bastion'), null)
    expect(armor()).toBe(1)
    expect(a.run().cannotMove(a1(a))).toBe(true)
    // 後面那一格（第 2 格）高一級：暴露變半掩體；別人不變；那一格本身的遮蔽沒有動
    expect(cover()).toEqual([0, 1, 1])
    expect(a.battle.cover.ally.map((c) => c.level)).toEqual([0, 0, 1, 2])
    // 被推照算：a1 被推到第 2 格，a2 換到第 1 格，後面那一格變成第 3 格（半掩體升成掩體）
    expect(a.run().shift(a1(a), +1)).toBe(true)
    expect(a1(a).slot).toBe(2)
    expect(cover()).toEqual([0, 0, 2])
    // 關掉就恢復
    cast(a, ID('bastion'), null)
    expect(a1(a).stance).toBeUndefined()
    expect(armor()).toBe(0)
    expect(a.run().cannotMove(a1(a))).toBe(false)
    expect(cover()).toEqual([0, 0, 1])
  })

  it('堡壘姿態的遮蔽：最高到掩體；沒有人站的格子不算（後面沒有人就沒有東西可加）；加上去的打不破', () => {
    const a = world([ID('formation'), ID('bastion')], { cover: { ally: [0, 2, 0, 0], foe: [0, 0, 0, 0] } })
    cast(a, ID('bastion'), null)
    expect(a.run().coverOf(a.ally(2))).toBe(2)
    const b = world([ID('formation'), ID('bastion')])
    cast(b, ID('bastion'), null)
    expect(b.run().coverOf(b.ally(2))).toBe(1)
    // 後面那一格的人倒下了：沒有人站在那裡，不加
    b.ally(2).out = 'down'
    expect(b.run().coverOf(b.ally(2))).toBe(0)
    b.ally(2).out = undefined
    const run = b.run()
    run.hurtCover('ally', 2, 99, b.foe(1))
    expect(run.beats.some((x) => x.tag === 'cover.hit')).toBe(false)
    expect(run.coverOf(b.ally(2))).toBe(1)
  })
})

describe('要機甲的：when.hull 的行動列得出來但灰掉；整個都要機甲的留 pending（E12）', () => {
  const probe = [
    sk('sk_probe_dash', '同步衝刺（探針）', 3, 'front', 'active', 2, { use: { ap: 0, per_fight: 1 }, meat: { target: 'none', when: { hull: true }, do: [{ op: 'ap', who: 'self', amount: 2, over_cap: true }] } }),
    sk('sk_probe_harden', '神經硬化（探針）', 3, 'back', 'passive', 4, { meat: { mods: [{ kind: 'armor', value: 2, when: { hull: true } }] } }),
  ]
  const pack2 = withAbilities([...PILOT, ...probe])
  const mk = () => makeBattleGame({ features: FEATURES, content: [pack2], seed: 7, battle: duel([pilot([ID('formation'), 'sk_probe_dash', 'sk_probe_harden']), one({ weapon: 'pistol' }, 2)], [foe('minion', quiet as never)]) }).game

  it('沒有機甲：行動列得出來、灰掉，原因是一句完整的話；有機甲就能用；被動的 when.hull 同理', () => {
    const g = mk()
    turnTo(g, 'a1')
    expect(opt(g, 'sk_probe_dash')).toMatchObject({ ok: false, blocks: ['要在機甲狀態才能用。'] })
    refused(g.battleAct({ action: 'sk_probe_dash' }), '要在機甲狀態才能用。')
    expect(sum(gmods(g, 'armor', 'a1').filter((p) => p.label === '神經硬化（探針）'))).toBe(0)
    unit(g, 'a1').hull = { id: 'h', name: '機甲', hp: { now: 40, max: 40 }, armor: 0, backlash: 0.2 }
    expect(opt(g, 'sk_probe_dash')).toMatchObject({ ok: true, blocks: [] })
    expect(sum(gmods(g, 'armor', 'a1').filter((p) => p.label === '神經硬化（探針）'))).toBe(2)
    const ap = unit(g, 'a1').ap.now
    expect(g.battleAct({ action: 'sk_probe_dash' }).status).toBe('applied')
    expect(unit(g, 'a1').ap.now).toBe(ap + 2)
  })

  it('整個都要機甲的六個（同步衝刺、神經硬化、遠端火力、共鳴駕駛、女武神、人機一體）留 pending：不註冊成行動、不給修正；共鳴 3 同理', () => {
    const a = world(PILOT.map((x) => x.id as string))
    const defs = a.k.battle.actionsFor('meat').map((d) => d.id)
    for (const name of ['sync_dash', 'remote_fire', 'valkyrie']) expect(defs).not.toContain(ID(name))
    expect(PENDING.sort()).toEqual(['sk_pilot_man_machine', 'sk_pilot_neural_hardening', 'sk_pilot_remote_fire', 'sk_pilot_resonant_pilot', 'sk_pilot_sync_dash', 'sk_pilot_valkyrie'])
    // pending 的就只有 { pending: true }（M6 補機甲的效果時才寫）：被動沒有任何修正、主動不是行動
    for (const id of PENDING) expect((PILOT.find((x) => x.id === id)!.meat as Rec), id as string).toEqual({ pending: true })
    expect((TREE.resonance[2] as Rec).effect).toEqual({ pending: true })
  })
})

describe('效果本身的邊角（run.effects 直接叫）', () => {
  const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const
  const fx = (a: Arena, list: Rec[], o: { target?: BattleTarget | null; pick?: Rec; user?: string; d?: number[] } = {}) => {
    const run = a.run(o.d ?? FIX.slice())
    run.effects(list, { user: run.unit(o.user ?? 'a1'), target: o.target ?? null, source: SRC, pick: o.pick ?? {}, n: { tier: 3 } })
    return run
  }
  const bigFoes = () => [foe('boss', { ...quiet, hp: { now: 500, max: 500 } } as never), foe('minion', quiet as never)]

  it('own_overlay 的目標：技能把選的那一台交給效果（ctx.target 是 { overlay }），who 預設落在它身上', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const o = put(a, 2, 'attack')
    o.hp.now = 4
    let seen: unknown
    a.k.battle.effect('probe.seen', 'test', (ctx) => void (seen = { target: ctx.target, overlay: ctx.overlay?.id }))
    fx(a, [{ op: 'probe.seen' }], { target: { overlay: o.id } })
    expect(seen).toEqual({ target: { overlay: o.id }, overlay: o.id })
  })

  it('drone.act 的「這一台」：選的那一台、或目標是一格／一個人時那一格上自己的一台；別人的、被擊落的不行', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const mine = put(a, 2, 'attack')
    const list = [{ op: 'drone.act', which: 'target', at: 'pick:at' }]
    expect(hits(fx(a, list, { target: { side: 'ally', slot: 2 }, pick: { at: 'f1' } }))).toHaveLength(1)
    expect(mine.used).toBe(true)
    mine.used = false
    expect(hits(fx(a, list, { target: { unit: 'a2' }, pick: { at: 'f1' } }))).toHaveLength(1)
    mine.used = false
    const theirs = a.run().addOverlay({ side: 'ally', slot: 3, owner: 'a2', kind: 'attack', name: '別人的', hp: { now: 14, max: 14 }, armor: 1, evade: 13, ext: { drone: -1, grade: 1 } })
    expect(reasonOf(() => fx(a, list, { target: { overlay: theirs.id }, pick: { at: 'f1' } }))).toEqual(['沒有這一台無人機。'])
    expect(reasonOf(() => fx(a, list, { target: { side: 'ally', slot: 4 }, pick: { at: 'f1' } }))).toEqual(['沒有這一台無人機。'])
    // 被擊落的：核心不對已經擊落的做效果（落在它身上的整筆跳過），技能的目標裡也列不出它
    mine.down = true
    mine.used = false
    expect(hits(fx(a, list, { target: { overlay: mine.id }, pick: { at: 'f1' } }))).toHaveLength(0)
    expect(mine.used).toBe(false)
  })

  it('drone.act 的 mark_used: false：動完不算動過；ignore_used：動過的也能再動；打的人選不到（我方、已倒下）就整步不成立', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const o = put(a, 1, 'attack')
    fx(a, [{ op: 'drone.act', which: 'target', at: 'pick:at', mark_used: false }], { target: { overlay: o.id }, pick: { at: 'f1' } })
    expect(o.used).toBe(false)
    o.used = true
    fx(a, [{ op: 'drone.act', which: 'target', at: 'pick:at', ignore_used: true }], { target: { overlay: o.id }, pick: { at: 'f1' } })
    expect(o.used).toBe(true)
    expect(reasonOf(() => fx(a, [{ op: 'drone.act', which: 'target', at: 'pick:at', ignore_used: true }], { target: { overlay: o.id }, pick: { at: 'a2' } }))).toEqual(['要選一個敵人。'])
    expect(reasonOf(() => fx(a, [{ op: 'drone.act', which: 'target', at: 'pick:at', ignore_used: true }], { target: { overlay: o.id } }))).toEqual(['要選一個敵人。'])
  })

  it('drone.act 的 same_slot、all、others：只有會開火的、沒動過的動；max 夾得住；all 沒給敵人就什麼都不做', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    put(a, 1, 'attack')
    put(a, 2, 'jammer')
    put(a, 3, 'medic')
    put(a, 4, 'attack').used = true
    expect(hits(fx(a, [{ op: 'drone.act', which: 'all', at: 'pick:at' }], { pick: { at: 'f1' } })).map((x) => x.skill)).toEqual(['piloting', 'piloting'])
    const b = world([ID('formation')], { foes: bigFoes() })
    put(b, 1, 'attack')
    put(b, 2, 'attack')
    put(b, 3, 'attack')
    expect(hits(fx(b, [{ op: 'drone.act', which: 'all', max: 2, at: 'pick:at' }], { pick: { at: 'f1' } }))).toHaveLength(2)
    expect(hits(fx(b, [{ op: 'drone.act', which: 'all', at: 'pick:at' }]))).toHaveLength(0)
    // same_slot：和做的人同一格（第 1 格）的
    const c = world([ID('formation')], { foes: bigFoes() })
    put(c, 1, 'attack')
    put(c, 2, 'attack')
    expect(hits(fx(c, [{ op: 'drone.act', which: 'same_slot', at: 'pick:at' }], { pick: { at: 'f1' } }))).toHaveLength(1)
    expect(overlaysOf(c).map((o) => o.used)).toEqual([true, false])
  })

  it('drone.act 的 at: target 要是敵人：目標是自己人的時候選不到，整步不成立', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const o = put(a, 1, 'attack')
    expect(reasonOf(() => fx(a, [{ op: 'drone.act', which: 'target', at: 'target' }], { target: { overlay: o.id } }))).toEqual(['要選一個敵人。'])
    expect(hits(fx(a, [{ op: 'drone.act', which: 'all', at: 'target' }], { target: { unit: 'f1' } }))).toHaveLength(1)
  })

  it('drone.deploy 的 drone：pick 的值可以是第幾台，或種類（取第一台還在手上的）；沒有、已經放出去、不認得都是「沒有這一台無人機。」', () => {
    const a = world([ID('formation')], { sync: 6, drones: ['attack', 'shield', 'attack'] })
    const at = { target: { side: 'ally', slot: 1 } as BattleTarget }
    fx(a, [{ op: 'drone.deploy', drone: 'k' }], { ...at, pick: { k: 'attack' } })
    expect(overlaysOf(a).map((o) => [o.kind, o.ext!.drone])).toEqual([['attack', 0]])
    fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 2 }, pick: { k: 'attack' } })
    expect(overlaysOf(a).map((o) => o.ext!.drone)).toEqual([0, 2])
    expect(reasonOf(() => fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 3 }, pick: { k: 'attack' } }))).toEqual(['沒有這一台無人機。'])
    expect(reasonOf(() => fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 3 }, pick: { k: 'medic' } }))).toEqual(['沒有這一台無人機。'])
    expect(reasonOf(() => fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 3 }, pick: { k: 1 } }))).toEqual([])
    expect(reasonOf(() => fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 4 }, pick: { k: 1 } }))).toEqual(['沒有這一台無人機。'])
    expect(reasonOf(() => fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: null, pick: { k: 'shield' } }))).toEqual(['沒有這一台無人機。'])
    const b = world([ID('formation')], { sync: 6 })
    expect(reasonOf(() => fx(b, [{ op: 'drone.deploy', drone: 'k' }], { target: null, pick: { k: 'attack' } }))).toEqual(['要選我方的一格。'])
    expect(reasonOf(() => fx(b, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'foe', slot: 1 }, pick: { k: 'attack' } }))).toEqual(['要選我方的一格。'])
  })

  it('drone.deploy 的 over_cap 讓放出的台數不受上限，turns 讓正式的一台也有時限（到期收回、回到手上）', () => {
    const a = world([ID('formation')], { sync: 0 })
    fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 1 }, pick: { k: 0 } })
    expect(reasonOf(() => fx(a, [{ op: 'drone.deploy', drone: 'k' }], { target: { side: 'ally', slot: 2 }, pick: { k: 1 } }))).toEqual(['同步 0 級只連得住 1 台。'])
    fx(a, [{ op: 'drone.deploy', drone: 'k', over_cap: true, turns: 1 }], { target: { side: 'ally', slot: 2 }, pick: { k: 1 } })
    expect(overlaysOf(a)).toHaveLength(2)
    nextRound(a)
    expect(overlaysOf(a)).toHaveLength(1)
    expect(a1(a).uses['drone:1']).toBeUndefined()
  })

  it('drone.guard 的 until: battle_end：不隨機師的回合開始結束；which: all 對每一台、same_slot 只對和機師同一格的', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const o1 = put(a, 1, 'attack')
    const o2 = put(a, 2, 'attack')
    fx(a, [{ op: 'drone.guard', which: 'same_slot', until: 'battle_end' }])
    expect([o1.ext!.guard, o2.ext!.guard]).toEqual(['battle_end', undefined])
    a.k.battle.emit('turn.start', { run: a.run(), unit: a1(a) })
    expect(o1.ext!.guard).toBe('battle_end')
    fx(a, [{ op: 'drone.guard', which: 'all', max: 1 }])
    expect([o1.ext!.guard, o2.ext!.guard]).toEqual(['own_turn_start', undefined])
  })

  it('drone.repair 對被擊落的不行；drone.smoke 照寫的回合數；drone.escort 收起來時清掉', () => {
    const a = world([ID('formation')])
    const o = put(a, 1, 'attack')
    o.down = true
    o.hp.now = 0
    fx(a, [{ op: 'drone.repair', amount: 5 }], { target: { overlay: o.id } })
    expect(o.hp.now).toBe(0)
    // 目標是一格、那一格上自己的一台已經被擊落：找不到，整步不成立
    expect(reasonOf(() => fx(a, [{ op: 'drone.repair', amount: 5 }], { target: { side: 'ally', slot: 1 } }))).toEqual(['沒有這一台無人機。'])
    const live = put(a, 2, 'attack')
    fx(a, [{ op: 'drone.smoke', rounds: 3 }], { target: { overlay: live.id } })
    expect(a.battle.cover.ally[1]!.soft).toEqual({ kind: 'smoke', until: a.battle.round + 2 })
    fx(a, [{ op: 'drone.escort', evade: 2, max: 1 }])
    expect(a1(a).uses).toMatchObject({ 'escort.evade': 2, 'escort.max': 1 })
    fx(a, [{ op: 'drone.escort', off: true }])
    expect(a1(a).uses['escort.evade']).toBeUndefined()
  })

  it('撞過去的 drone.ram：目標要是敵人；倒下的目標不能撞；dice 與 type 可以換', () => {
    const a = world([ID('formation')], { foes: bigFoes() })
    const o = put(a, 2, 'attack')
    expect(reasonOf(() => fx(a, [{ op: 'drone.ram', who: 'pick:at' }], { target: { overlay: o.id }, pick: { at: 'a2' } }))).toEqual(['要選一個敵人。'])
    const hp = a.foe(1).hp!.now
    fx(a, [{ op: 'drone.ram', who: 'pick:at', dice: '1d6+10', type: 'em' }], { target: { overlay: o.id }, pick: { at: 'f1' }, d: dice(3) })
    expect(o.down).toBe(true)
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
  })

  it('declaration：出擊的「放哪一台」是 drone 這種 pick：選項就是單位上 ext.summons.drones 的每一台（值是第幾台，名字用 name，沒有就是種類）；放出去、被擊落的灰掉', () => {
    const g = play([ID('formation'), ID('good_kid')], { drones: [{ kind: 'shield', grade: 1, name: '小盾' }, { kind: 'attack', grade: 1 }] })
    turnTo(g, 'a1')
    const picks = opt(g, ID('good_kid')).picks
    expect(picks.map((p) => [p.key, p.kind, p.required])).toEqual([['at', 'foe', false], ['drone', 'choice', true]])
    expect(picks[1]!.options.map((o) => [o.value, o.label, o.blocks])).toEqual([[0, '小盾', []], [1, 'attack', []]])
    expect(pickProblems(picks, { side: 'ally', slot: 1 }, { drone: 0 })).toEqual([])
    expect(tryAct(g, { action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: {} })).toEqual(['要選放出哪一台。'])
    expect(tryAct(g, { action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: 5 } })).toEqual(['放出哪一台：沒有這個選項。'])
    expect(tryAct(g, { action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: 0 } })).toBeNull()
    // 這一場放出去的、被擊落的：灰掉（狀態記在操作者的 uses['drone:<索引>']）
    g.battleAct({ action: ID('good_kid'), target: { side: 'ally', slot: 1 }, pick: { drone: 0 } })
    unit(g, 'a1').uses['drone:1'] = 2
    turnTo(g, 'a1')
    expect(opt(g, ID('good_kid')).picks[1]!.options.map((o) => o.blocks)).toEqual([['這一台已經放出去了。'], ['這一台被擊落了，這一場不能再放。']])
  })

  it('drone 這種 pick 的格式：只有 kind 是 drone 才收；沒有帶無人機的人，選項是空的（行動本身灰掉）', () => {
    const g = play([ID('formation'), ID('good_kid')], { drones: [] })
    turnTo(g, 'a1')
    expect(opt(g, ID('good_kid')).picks[1]!.options).toEqual([])
  })
})
