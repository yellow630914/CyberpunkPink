// 驗收測試：dev/work/M1b-skill-gunner-broker.md（cpp-feature）。槍手與掮客兩棵樹裡通則寫不出來的那幾樣機制：
// 戰鬥直覺（開戰分配、重分配、心流）、點放（alter 加 as_pick）、彈幕與火力牆（範圍的壓制）、壓制姿態（命中就壓制）、不准動喔（守著一格）、
// 叫人的加項（我有認識的人、派工網、人脈）、勸降與收買（branch 與 needs.any）、擋、大局、保釋與「被贖回」（戰敗的選項）、
// 以及這兩棵樹現在標 pending 的三十八個技能（除了增援，E13）都用假資料寫得出來、動得起來。
// 規格：SKILL_TREES「槍手：戰鬥直覺」「掮客：人面」兩節的「現實」欄；COMBAT_SYSTEM 第 5 節、8.3 節；dev/adr/0015 E1～E3、E7、E13。
// 內容一律是測試自帶的假資料（名字照設計書、數字照設計書），不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleInput, BattleSetup, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, BattleRun, battleAct, pickApplies, pickProblems, readyFeatures } from '../../src'
import { abilitiesFeature, defaultAlloc, fitAlloc } from '../../src/features/abilities'
import { combatFeature } from '../../src/features/combat'
import { chooseDefeatOption, defeatFeature, defeatOf, defeatOptions } from '../../src/features/defeat'
import { makeBattleGame, makeGame, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature]

// ===================================================================================================================
// 假資料：兩棵樹要現在標 pending 的技能，照設計書的現實欄寫成新的格式（id 和示意資料一樣，cpp-data 照這份改寫）
// ===================================================================================================================

const GUN_TREE = {
  id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_gunner_instinct', domains: { meat: 'strong', net: 'none', opinion: 'none' },
  resonance: [{ tier: 5, cells: 1, text: '戰鬥直覺可以分配的點數 +1。', effect: { mods: [{ kind: 'instinct_points', value: 1 }] } }],
}
const FIX_TREE = {
  id: 'fixer', name: '掮客', tree: '人面', category: 'meat', signature: 'sk_fixer_face', domains: { meat: 'strong', net: 'none', opinion: 'none' },
  resonance: [
    { tier: 2, cells: 1, text: '每場戰鬥第一次叫人不花行動點。', effect: { mods: [{ kind: 'action_ap', value: -1, tags: ['sk_fixer_face.call'], per_fight: 1 }] } },
    { tier: 3, cells: 1, text: '和你相鄰的隊友迴避 +1。', effect: { mods: [{ kind: 'evade', value: 1, who: 'adjacent' }] } },
  ],
}

const ab = (path: 'gunner' | 'fixer', id: string, tier: number, kind: string, more: Rec = {}): Rec => ({
  id, name: id, path, category: 'meat', tier, layer: 'front', kind, cap: 1, xp: tier * 20, cells: 1, after: path === 'gunner' ? 'sk_gunner_instinct' : 'sk_fixer_face',
  text: `${id}。`, net: null, opinion: null, meat: null, ...more,
})
const g = (id: string, tier: number, kind: string, more: Rec = {}): Rec => ab('gunner', id, tier, kind, more)
const f = (id: string, tier: number, kind: string, more: Rec = {}): Rec => ab('fixer', id, tier, kind, more)

/** 槍手：現在標 pending 的十九個（加上它們要用的招牌、要害射擊、連射控制）。 */
const GUNNER: Rec[] = [
  g('sk_gunner_instinct', 1, 'passive', { name: '戰鬥直覺', layer: 'signature', after: undefined, meat: { instinct: true } }),
  g('sk_gunner_aimed_shot', 1, 'active', { name: '要害射擊', use: { ap: 3 }, meat: { target: 'enemy', attack: { aimed: true } } }),
  g('sk_gunner_burst', 1, 'active', { name: '連射控制', use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', suppress: { dc: 'spent', skill: 'composure' } } } }),
  // 點放：連射時可以只花彈匣 2 格，傷害照 2 格算，壓制的 DC 照花掉 3 格算（16）
  g('sk_gunner_tap', 1, 'passive', { name: '點放', meat: { alter: [{ ability: 'sk_gunner_burst', as_pick: { key: 'tap', label: '點放：只花 2 格' }, set: { 'attack.spend': 2, 'attack.suppress.dc': 16 } }] } }),
  g('sk_gunner_suppress_stance', 2, 'stance', { name: '壓制姿態', use: { ap: 1 }, meat: { attack: { suppress: { auto: true, per_turn: 1 } } } }),
  g('sk_gunner_loadout_mastery', 2, 'passive', { name: '構裝精通', meat: { mods: [{ kind: 'action_ap', value: -1, tags: ['swap'], per_fight: 2 }] } }),
  g('sk_gunner_back_off', 2, 'active', { name: '走開啦', use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', cover_mult_min: 1 }, { op: 'shift', dir: 'push', n: 1, if: 'hit' }] } }),
  g('sk_gunner_pierce', 3, 'active', { name: '穿透', use: { ap: 2 }, meat: { target: 'enemy', do: [{ op: 'attack', cover_shift: 1, pierce: 1 }] } }),
  g('sk_gunner_run_and_gun', 3, 'active', {
    name: '跑位射擊', use: { ap: 2 },
    meat: { target: 'enemy', picks: [{ key: 'slot', label: '換到哪一格', kind: 'ally_slot' }], do: [{ op: 'move', who: 'self', to: 'adjacent' }, { op: 'cover_temp', who: 'self', levels: 1 }, { op: 'attack' }] },
  }),
  g('sk_gunner_deadline', 3, 'reaction', {
    name: '死線', use: { ap: 0, per_fight: 1 },
    meat: {
      trigger: { on: 'hp_half', who: 'self' },
      do: [
        { op: 'attack', who: 'attacker', hit: 2 },
        { op: 'buff', who: 'self', id: 'deadline', name: '死線', turns: 1, until: 'own_turn_end', mods: [{ kind: 'hit', value: 2, when: { wounded: true } }, { kind: 'save', value: 2, when: { wounded: true } }] },
      ],
    },
  }),
  g('sk_gunner_hunter_eye', 3, 'passive', { name: '獵眼', meat: { mods: [{ kind: 'hit', value: 1, tags: ['aimed'] }, { kind: 'crit_margin', to: 3, tags: ['aimed'] }] } }),
  g('sk_gunner_covering_retreat', 3, 'active', {
    name: '掩護撤退', use: { ap: 2 },
    meat: {
      target: 'enemy', picks: [{ key: 'mate', label: '讓誰換位', kind: 'ally', adjacent: true }, { key: 'slot', label: '換到哪一格', kind: 'ally_slot' }],
      do: [{ op: 'attack' }, { op: 'status', status: 'suppressed', if: 'hit' }, { op: 'move', who: 'pick:mate', to: 'adjacent' }],
    },
  }),
  g('sk_gunner_kill_rhythm', 4, 'passive', { name: '獵殺節奏', use: { ap: 0, per_turn: 1 }, meat: { trigger: { on: 'hit', who: 'foe_by_self', if: 'crit' }, react: { pierce: 1 }, do: [{ op: 'ap', who: 'self', amount: 1 }] } }),
  // 彈幕：開著時，連射的壓制同時打到目標相鄰一格上的人，兩個人的 DC 都 +2
  g('sk_gunner_barrage', 4, 'stance', { name: '彈幕', use: { ap: 1 }, meat: { alter: [{ ability: 'sk_gunner_burst', when: { stance: 'sk_gunner_barrage' }, set: { 'attack.suppress.area': 'adjacent', 'attack.suppress.dc_bonus': 2 } }] } }),
  g('sk_gunner_flow', 4, 'active', {
    name: '心流', use: { ap: 0, per_fight: 1 },
    meat: { do: [{ op: 'buff', who: 'self', id: 'flow', name: '心流', turns: 2, until: 'own_turn_end', mods: [{ kind: 'instinct_points', value: 2 }, { kind: 'instinct_cap', value: 2 }, { kind: 'instinct_free', value: 1 }] }] },
  }),
  g('sk_gunner_next_one', 4, 'active', {
    name: '下一個！', use: { ap: 2 },
    meat: { target: 'enemy', picks: [{ key: 'next', label: '下一個目標', kind: 'foe', required: false, apart: true }], do: [{ op: 'attack' }, { op: 'attack', who: 'pick:next', if: 'downed' }] },
  }),
  // 不准動喔：守著敵方的一格，站在那一格上的人第一次換位、補位或攻擊時，立刻朝他射一槍
  g('sk_gunner_dont_move', 4, 'active', { name: '不准動喔', use: { ap: 1 }, meat: { target: 'foe_slot', do: [{ op: 'ward', slot: 'target', until: 'own_turn_start', on: ['move', 'compact', 'attack'], do: [{ op: 'attack' }] }] } }),
  g('sk_gunner_one_shot', 5, 'active', {
    name: '一槍定局', use: { ap: 3, per_fight: 1 },
    meat: { target: 'enemy', when: { wield: ['rifle', 'sniper'] }, range: [5, 7], do: [{ op: 'attack', aimed: true, hit: 6, auto_crit: true, label: '一槍定局' }] },
  }),
  g('sk_gunner_fire_wall', 5, 'active', {
    name: '火力牆', use: { ap: 3, per_fight: 1 },
    meat: {
      target: 'enemy', attack: { spend: 'all', min_mag: 2, dice: 'spent_minus_1', free_mag: true, suppress: { dc: 'spent', skill: 'composure', area: 'row', dc_bonus: 2 } },
      do: [{ op: 'buff', who: 'allies', id: 'fire_wall', name: '火力牆', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 1 }] }],
    },
  }),
  g('sk_gunner_bullet_time', 5, 'active', {
    name: '子彈時間', use: { ap: 0, per_fight: 1 },
    meat: { do: [{ op: 'buff', who: 'self', id: 'bullet_time', name: '子彈時間', turns: 2, until: 'own_turn_end', mods: [{ kind: 'ap_regen', value: 2 }, { kind: 'aim_all', value: 1 }], on_end: [{ op: 'load', exact: true, amount: 10 }] }] },
  }),
  g('sk_gunner_gun_unity', 5, 'passive', { name: '人槍合一', meat: { mods: [{ kind: 'hit', value: 1 }, { kind: 'pierce', value: 1 }, { kind: 'crit_margin', to: 3 }] } }),
  g('sk_gunner_right_back', 5, 'reaction', { name: '還給你～', use: { ap: 1, per_turn: 1 }, meat: { trigger: { on: 'after', who: 'near', if: 'miss' }, do: [{ op: 'attack', who: 'attacker', hit: 2 }] } }),
]

/** 掮客：現在標 pending 的十九個（增援留 pending：E13）。 */
const FIXER: Rec[] = [
  f('sk_fixer_face', 1, 'passive', {
    name: '人面', layer: 'signature', after: undefined,
    meat: { give_ap: { max: 'one_plus_half_tier' }, call: { options: ['shot', 'cover_up', 'cover_down'], per_fight: 'half_tier_up', ap: 1 } },
  }),
  f('sk_fixer_im_here', 1, 'passive', { name: '有我在', meat: { mods: [{ kind: 'save', value: 2, who: 'adjacent', tags: ['resist:suppressed'] }] } }),
  f('sk_fixer_proxy', 1, 'active', { name: '代理', use: { ap: 1, cash: 'grade*100' }, meat: { target: 'ally', do: [{ op: 'mag', amount: 'full' }] } }),
  f('sk_fixer_talk_down', 2, 'active', {
    name: '勸降', use: { ap: 2 },
    meat: {
      target: 'enemy', needs: { no_rank: ['boss'], any: [{ wounded: true }, { afterglow: 1 }] },
      do: [
        { op: 'check', attr: 'charm', skill: 'negotiate', vs: { base: 10, per_grade: 2, elite: 2 } },
        { op: 'branch', if: 'ok', needs: { rank: ['minion'], wounded: true }, do: [{ op: 'out', how: 'surrendered' }], else: [{ op: 'status', status: 'dazed' }] },
      ],
    },
  }),
  f('sk_fixer_block', 2, 'reaction', { name: '擋', use: { meat: { favor: 'small', per_fight: 2 } }, meat: { trigger: { on: 'hit', who: 'ally', if: 'wound' }, react: { no_wound: true } } }),
  f('sk_fixer_black_market', 2, 'passive', { name: '黑市門路', meat: { on_start: [{ op: 'pick_random', key: 'mate', from: 'ally' }, { op: 'mag', who: 'pick:mate', amount: 1, over_cap: true }] } }),
  f('sk_fixer_bribe', 3, 'active', {
    name: '收買', use: { meat: { ap: 2, cash: 'grade*500', per_fight: 1 } },
    meat: { target: 'enemy', needs: { no_rank: ['boss'] }, do: [{ op: 'status', status: 'lose_turn' }] },
  }),
  // 保釋：隊友被制伏時，制伏解除；全隊倒下時，戰敗事件多一個「被贖回」（付等級×1,000 C$）
  f('sk_fixer_bail', 3, 'reaction', {
    name: '保釋', use: { ap: 0, favor: 'mid', per_fight: 1 },
    meat: { trigger: { on: 'out_before', who: 'ally' }, react: { prevent: { how: ['subdued'] } }, ransom: { cash: 'grade*1000' } },
  }),
  f('sk_fixer_hit_him', 3, 'active', {
    name: '打他打他！', use: { ap: 1 },
    meat: {
      target: 'enemy',
      do: [
        { op: 'status', status: 'marked', until: 'source_turn_start' },
        { op: 'buff', who: 'allies', id: 'hit_him', name: '打他打他！', turns: 1, until: 'source_turn_start', mods: [{ kind: 'damage_roll', value: '1d3', when: { other_status: 'marked' } }] },
      ],
    },
  }),
  f('sk_fixer_dispatch_net', 3, 'passive', { name: '派工網', meat: { mods: [{ kind: 'call_uses', value: 1 }] } }),
  f('sk_fixer_reinforce', 4, 'active', { name: '增援', use: { ap: 2, per_fight: 1 }, meat: { pending: true } }),
  f('sk_fixer_formation', 4, 'stance', { name: '布陣', use: { ap: 1 }, meat: { mods: [{ kind: 'evade', value: 1, who: 'allies' }] } }),
  f('sk_fixer_big_picture', 4, 'active', {
    name: '大局', use: { meat: { ap: 1 } },
    meat: { target: 'ally_or_self', picks: [{ key: 'with', label: '和誰對調', kind: 'ally', apart: true }], do: [{ op: 'order', with: 'with', act_next: true }] },
  }),
  f('sk_fixer_i_know_someone', 4, 'passive', {
    name: '我有認識的人',
    meat: { alter: [{ ability: 'sk_fixer_face', set: { 'call.options': ['shot', 'cover_up', 'cover_down', 'heal', 'vent'], 'call.heal': '2d6', 'call.vent': 8 } }] },
  }),
  f('sk_fixer_lets_talk', 4, 'active', {
    name: '有話好好說', use: { meat: { ap: 2 } },
    meat: {
      target: 'enemy', needs: { rank: ['elite', 'boss'] },
      do: [
        { op: 'check', attr: 'charm', skill: 'negotiate', vs: { base: 10, per_grade: 2, elite: 2, boss: 4 } },
        { op: 'status', if: 'ok', status: 'suppressed', until: 'own_turn_end' },
        { op: 'status', if: 'ok', status: 'marked', until: 'own_turn_end' },
      ],
    },
  }),
  f('sk_fixer_all_out', 5, 'active', {
    name: '總攻令', use: { meat: { ap: 2, per_fight: 1 } },
    meat: { do: [{ op: 'ap', who: 'allies', amount: 1 }, { op: 'buff', who: 'allies', id: 'all_out', name: '總攻令', turns: 1, until: 'own_turn_end', mods: [{ kind: 'hit', value: 1 }] }] },
  }),
  f('sk_fixer_hold_the_line', 5, 'active', {
    name: '護盤', use: { meat: { ap: 1, per_fight: 1 } },
    meat: {
      do: [
        { op: 'buff', who: 'allies', id: 'hold_the_line', name: '護盤', turns: 1, until: 'source_turn_start', mods: [{ kind: 'evade', value: 2 }, { kind: 'no_wound', value: 1 }] },
        { op: 'vent', who: 'allies', amount: 4 },
      ],
    },
  }),
  f('sk_fixer_city_owes_me', 5, 'active', {
    name: '全城欠我', use: { meat: { ap: 0, favor: 'big', per_commission: 1, first_round: true } },
    meat: {
      picks: [{ key: 'a', label: '第一個目標', kind: 'foe' }, { key: 'b', label: '第二個目標（兩個雜兵時）', kind: 'foe', required: false }, { key: 'who', label: '誰沒收到命令', kind: 'choice' }],
      choose: [
        { key: 'elite', label: '一名精英', do: [{ op: 'branch', who: 'pick:a', needs: { rank: ['elite'] }, do: [{ op: 'status', status: 'lose_turn' }] }] },
        {
          key: 'minions', label: '兩名雜兵',
          do: [
            { op: 'branch', who: 'pick:a', needs: { rank: ['minion'] }, do: [{ op: 'status', status: 'lose_turn' }] },
            { op: 'branch', who: 'pick:b', needs: { rank: ['minion'] }, do: [{ op: 'status', status: 'lose_turn' }] },
          ],
        },
      ],
    },
  }),
  f('sk_fixer_command', 5, 'stance', {
    name: '號令', use: { ap: 1 },
    meat: { mods: [{ kind: 'give_ap_cap', value: 1 }], on_give_ap: [{ op: 'buff', id: 'command', name: '號令', turns: 1, until: 'own_turn_end', mods: [{ kind: 'hit', value: 1 }, { kind: 'evade', value: 1 }] }] },
  }),
  f('sk_fixer_connections', 5, 'passive', { name: '人脈', meat: { mods: [{ kind: 'call_uses', value: 1 }, { kind: 'call_hit', value: 2 }] } }),
]

const ALL = [...GUNNER, ...FIXER]
const PENDING_38 = [
  'sk_gunner_tap', 'sk_gunner_suppress_stance', 'sk_gunner_loadout_mastery', 'sk_gunner_back_off', 'sk_gunner_pierce', 'sk_gunner_run_and_gun', 'sk_gunner_deadline', 'sk_gunner_hunter_eye',
  'sk_gunner_covering_retreat', 'sk_gunner_kill_rhythm', 'sk_gunner_barrage', 'sk_gunner_flow', 'sk_gunner_next_one', 'sk_gunner_dont_move', 'sk_gunner_one_shot', 'sk_gunner_fire_wall',
  'sk_gunner_bullet_time', 'sk_gunner_gun_unity', 'sk_gunner_right_back',
  'sk_fixer_im_here', 'sk_fixer_proxy', 'sk_fixer_talk_down', 'sk_fixer_block', 'sk_fixer_black_market', 'sk_fixer_bribe', 'sk_fixer_bail', 'sk_fixer_hit_him', 'sk_fixer_dispatch_net',
  'sk_fixer_reinforce', 'sk_fixer_formation', 'sk_fixer_big_picture', 'sk_fixer_i_know_someone', 'sk_fixer_lets_talk', 'sk_fixer_all_out', 'sk_fixer_hold_the_line', 'sk_fixer_city_owes_me',
  'sk_fixer_command', 'sk_fixer_connections',
]

const pack = (extra: Rec = {}): ContentPack => ({
  id: 'gb_test',
  content: {
    battle_status: [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }],
    path: [GUN_TREE, FIX_TREE], ability: ALL, ...extra,
  },
} as unknown as ContentPack)

/** 裝著這幾個技能；兩棵樹各開到幾階。 */
const equip = (ids: string[], tiers: { gunner?: number; fixer?: number } = {}): Rec => ({ abilities: { equipped: ids, tiers: { gunner: tiers.gunner ?? 3, fixer: tiers.fixer ?? 3 } } })
const quiet = { ap: { now: 0, max: 0, regen: 0 } }
const dice = (...v: number[]): number[] => [...v, ...Array(160).fill(1)]
const total = (parts: Array<{ value: number; source?: string }>): number => parts.reduce((s, p) => s + p.value, 0)
const mag = (n: number, max = n, kind = 'pistol', hit = 10) => ({ ...testWeapon(kind, hit), mag: { now: n, max } })

/** 我（a1，有角色）：裝著 ids、行動點很多。 */
const me = (ids: string[], o: Rec = {}, tiers: { gunner?: number; fixer?: number } = {}) => one({ actor: 'pc', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 }, ext: equip(ids, tiers), ...o } as never)
const idle = (o: Rec = {}) => foe('minion', { ap: { now: 0, max: 0, regen: 0 }, ...o } as never)

// ---- 不經過提交的場地（直接下基本動作；反應、修正、掛點用） ----

interface FieldOpts { allies?: unknown[]; foes?: unknown[]; cover?: { ally: number[]; foe: number[] }; more?: Partial<BattleSetup>; tiers?: { gunner?: number; fixer?: number } }
function field(ids: string[], o: FieldOpts = {}): Arena {
  return arena(
    duel(o.allies ?? [me(ids, {}, o.tiers), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], o.foes ?? [idle(), idle(), idle()], o.cover, o.more),
    FEATURES, (k: Kernel) => {
      k.content.loadPack(pack())
      readyFeatures(k)
    },
  )
}
const SRC = { kind: 'ability', id: 'sk_x', name: '測試技能' } as const
/** 照一個行動自己的 run 做一次（不經過核心的扣花費；要看花費的用遊戲）。 */
function perform(a: Arena, run: BattleRun, unitId: string, action: string, input: Rec = {}): void {
  const def = a.k.battle.getAction(action)
  if (!def) throw new Error(`沒有 ${action} 這個行動`)
  const u = a.battle.units[unitId]!
  def.run(run, u, (input.target as never) ?? null, { action, ...input } as BattleInput)
}
/** 現在 unit 這個數字的所有修正（照核心的問法）。 */
const modsOf = (a: Arena, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = [], other?: string) => {
  const run = a.run()
  return run.mods(kind, run.unit(id), other ? run.unit(other) : undefined, undefined, tags)
}
/** 這一步紀錄裡的每一個擲骰（命中、檢定）。 */
const rolls = (run: BattleRun) => run.beats.filter((b) => b.roll).map((b) => b.roll!)
const saves = (run: BattleRun) => rolls(run).filter((r) => r.skill === 'composure')
const attacksBy = (run: BattleRun, id: string): number => run.beats.filter((b) => ['hit', 'miss', 'crit'].includes(b.tag ?? '') && (b.data as Rec | undefined)?.attacker === id).length
const statusIds = (u: BattleUnit): string[] => u.statuses.map((s) => s.id).sort()
const unitBuffIds = (u: BattleUnit): string[] => (((u.ext.abilities as Rec | undefined)?.buffs ?? []) as Array<{ id: string }>).map((b) => b.id)

// ---- 經過提交的遊戲（花費、灰掉的原因、picks 的宣告） ----

interface PlayOpts { mates?: unknown[]; foes?: unknown[]; me?: Rec; cover?: { ally: number[]; foe: number[] }; more?: Partial<BattleSetup>; game?: Rec; tiers?: { gunner?: number; fixer?: number }; seed?: number }
function play(ids: string[], o: PlayOpts = {}) {
  return makeBattleGame({
    features: FEATURES, content: [pack()], seed: o.seed ?? 7, ...(o.game ?? {}),
    battle: duel([me(ids, o.me, o.tiers), ...(o.mates ?? [one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)])], o.foes ?? [idle(), idle()], o.cover, o.more),
  }).game
}
type G = ReturnType<typeof play>
const turnTo = (game: G, id: string): BattleUnit => {
  const b = game.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const opt = (game: G, id: string): BattleActionOption => game.battleOptions()!.actions.find((x) => x.id === id)!
const unit = (game: G, id: string): BattleUnit => game.state.battle!.units[id]!
const tryAct = (game: G, input: BattleInput): string[] | null => {
  try {
    battleAct(game.k, game.state, input)
    return null
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}
/** 宣告與行動本身對不對得上（和 M1-picks 同一套驗法）。 */
function mismatches(game: G, a: BattleActionOption): { bad: string[]; tried: number } {
  const bad: string[] = []
  let tried = 0
  if (a.blocks.length) return { bad, tried }
  const targets = a.target === 'none' ? [null] : a.targets.filter((t) => t.blocks.length === 0).map((t) => t.target)
  for (const target of targets) {
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
    const why = tryAct(game, input(base))
    if (why) bad.push(`${a.id} ${JSON.stringify(target)} ${JSON.stringify(base)}：照宣告選齊了，卻被擋下（${why.join(' ')}）`)
    for (const p of a.picks) {
      for (const o of p.options.filter((x) => pickApplies(x, target))) {
        tried += 1
        const r = tryAct(game, input({ ...base, [p.key]: o.value }))
        if (o.blocks.length === 0 && r) bad.push(`${a.id} ${p.key}=${String(o.value)}：宣告說選得了，卻被擋下（${r.join(' ')}）`)
        if (o.blocks.length > 0 && !r) bad.push(`${a.id} ${p.key}=${String(o.value)}：宣告說選不了（${o.blocks.join(' ')}），卻做成了`)
      }
      if (p.key in base) {
        const { [p.key]: _omit, ...rest } = base
        if (!tryAct(game, input(rest))) bad.push(`${a.id}：少選了「${p.label}」，卻做成了`)
      }
    }
  }
  return { bad, tried }
}

// =====================================================================================

describe('三十八個 pending 的技能：用假資料寫得出來、載得進來', () => {
  it('兩棵樹的假資料通過內容載入的所有檢查；增援（E13）照舊留 pending，其餘三十七個都有可以動的 meat', () => {
    const game = makeGame({ features: FEATURES, content: [pack()] }).game
    const abilities = game.k.content.list<{ id: string; meat: Rec | null }>('ability')
    expect(PENDING_38).toHaveLength(38)
    for (const id of PENDING_38) {
      const a = abilities.find((x) => x.id === id)
      expect(a, `${id} 要在假資料裡`).toBeDefined()
      if (id === 'sk_fixer_reinforce') expect(a!.meat).toEqual({ pending: true })
      else expect(a!.meat && !a!.meat.pending, `${id} 要寫成可以動的 meat`).toBe(true)
    }
  })

  it('格式寫錯、不認得的新鍵，載入時擋下而且訊息裡有那個字', () => {
    const load = (a: Rec) => () => makeGame({ features: FEATURES, content: [{ id: 'bad', content: { path: [GUN_TREE], ability: [GUNNER[0]!, a] } } as unknown as ContentPack] })
    const bad = (meat: Rec, kind = 'active') => g('sk_bad', 1, kind, { use: { ap: 1 }, meat })
    expect(load(bad({ target: 'enemy', attack: { suppress: { dc: 12, skill: 'composure', area: 'galaxy' } } }))).toThrow(/galaxy/)
    expect(load(bad({ target: 'enemy', attack: { suppress: { auto: true, dc: 12 } } }))).toThrow(/auto/)
    expect(load(bad({ target: 'enemy', attack: { spend: 2, free_mag: 'yes' } }))).toThrow(/free_mag/)
    expect(load(bad({ target: 'enemy', needs: { any: [{ wounded: true }] } }))).toThrow(/any/)
    expect(load(bad({ target: 'enemy', needs: { any: [{ wounded: true }, { any: [] }] } }))).toThrow(/any/)
    expect(load(bad({ target: 'enemy', do: [{ op: 'branch', needs: { rank: ['giant'] }, do: [{ op: 'out', how: 'fled' }] }] }))).toThrow(/needs\.rank/)
    expect(load(bad({ target: 'enemy', do: [{ op: 'branch', do: [{ op: 'out', how: 'fled' }] }] }))).toThrow(/needs、when/)
    expect(load(bad({ target: 'foe_slot', do: [{ op: 'ward', slot: 'self', do: [{ op: 'attack' }] }] }))).toThrow(/slot/)
    expect(load(bad({ target: 'foe_slot', do: [{ op: 'ward', slot: 'target', on: ['teleport'], do: [{ op: 'attack' }] }] }))).toThrow(/teleport/)
    expect(load(bad({ do: [{ op: 'cover_temp', levels: 0 }] }))).toThrow(/levels/)
    expect(load(bad({ mods: [{ kind: 'luck_points', value: 1 }] }, 'passive'))).toThrow(/luck_points/)
    expect(load(bad({ mods: [{ kind: 'call_uses', value: '1d6' }] }, 'passive'))).toThrow(/1d6/)
    expect(load(bad({ mods: [{ kind: 'damage_roll', value: '1d3' }] }, 'passive'))).not.toThrow()
    expect(load(bad({ ransom: { cash: '2d6' } }, 'reaction'))).toThrow(/2d6/)
    expect(load(bad({ ransom: {} }, 'reaction'))).toThrow(/ransom/)
    expect(load(bad({ on_start: [{ op: 'ghost_op' }] }, 'passive'))).toThrow(/ghost_op/)
    expect(load(bad({ call: { options: ['heal'], per_fight: 'half_tier_up', ap: 1 } }, 'passive'))).toThrow(/heal/)
    expect(load(bad({ trigger: { on: 'hit', who: 'self', if: 'miss' }, react: { negate: true } }, 'reaction'))).toThrow(/miss/)
    expect(load(bad({ picks: [{ key: 'k', label: 'k', kind: 'foe', adjacent: true }], do: [{ op: 'attack' }] }))).toThrow(/adjacent/)
    expect(load(bad({ picks: [{ key: 'k', label: 'k', kind: 'foe_slot', apart: true }], do: [{ op: 'attack' }] }))).toThrow(/apart/)
  })
})

// =====================================================================================

describe('戰鬥直覺：開戰分配、重分配、每項上限（SKILL_TREES 槍手 1 階）', () => {
  const instinctIds = ['sk_gunner_instinct']

  it('預設的分法（AI 與沒選的玩家）：平均分，多的給命中；每項不超過上限', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9].map((p) => Object.values(defaultAlloc(p, 3)))).toEqual([[0, 1, 0], [0, 2, 0], [1, 1, 1], [1, 2, 1], [1, 3, 1], [2, 2, 2], [2, 3, 2], [3, 3, 3]])
    expect(defaultAlloc(5, 2)).toEqual({ initiative: 2, hit: 2, evade: 1 })
    expect(fitAlloc({ initiative: 3, hit: 3, evade: 3 }, 4, 3)).toEqual({ initiative: 3, hit: 1, evade: 0 })
    expect(fitAlloc({ initiative: 9, hit: 0, evade: 0 }, 9, 3)).toEqual({ initiative: 3, hit: 0, evade: 0 })
  })

  it('2 階的人有 2 點：沒選就是隨機分（總共 2 點、每項不超過 3 點）；自己選的先攻、命中、迴避各多對的數字', () => {
    const plain = field(instinctIds, { tiers: { gunner: 2 } })
    const alloc = plain.ally(1).ext.instinct as Rec
    expect((alloc.initiative as number) + (alloc.hit as number) + (alloc.evade as number)).toBe(2)
    expect(modsOf(plain, 'hit', 'a1').reduce((n, p) => n + p.value, 0)).toBe(alloc.hit)
    expect(modsOf(plain, 'evade', 'a1').reduce((n, p) => n + p.value, 0)).toBe(alloc.evade)
    expect(modsOf(plain, 'initiative', 'a1').reduce((n, p) => n + p.value, 0)).toBe((alloc.initiative as number) * 3)
    // 只給有裝戰鬥直覺的人；隊友沒有
    expect(modsOf(plain, 'hit', 'a2')).toEqual([])

    const chosen = field(instinctIds, { tiers: { gunner: 2 }, allies: [me(instinctIds, { ext: { ...equip(instinctIds, { gunner: 2 }), instinct: { initiative: 1, hit: 0, evade: 1 } } }), one({ weapon: 'pistol' }, 2)] })
    expect(modsOf(chosen, 'initiative', 'a1').map((p) => [p.label, p.value])).toEqual([['戰鬥直覺', 3]])
    expect(modsOf(chosen, 'hit', 'a1')).toEqual([])
    expect(modsOf(chosen, 'evade', 'a1').map((p) => [p.label, p.value])).toEqual([['戰鬥直覺', 1]])
    // 命中與迴避真的算進這一擊的明細
    const run = chosen.run(dice(10, 1, 1, 1, 1, 1))
    expect(run.evadeOf(chosen.ally(1)).parts.find((p) => p.label === '戰鬥直覺')?.value).toBe(1)
  })

  it('開戰時先攻也吃到：每 1 點先攻 +3（擲先攻之前就定好了）', () => {
    const base = field([], { allies: [me([], {}), one({ weapon: 'pistol' }, 2)] })
    const withInstinct = field(instinctIds, { allies: [me(instinctIds, { ext: { ...equip(instinctIds, { gunner: 3 }), instinct: { initiative: 3, hit: 0, evade: 0 } } }), one({ weapon: 'pistol' }, 2)] })
    // 同一個種子、同一個骰：先攻差 9
    expect(withInstinct.ally(1).initiative - base.ally(1).initiative).toBe(9)
  })

  it('舊存檔裡角色的 preset 不再讀：開戰時一律是隨機分（總數是階數的點數、每項不超過 3 點）', () => {
    const game = makeGame({ features: FEATURES, content: [pack()], pc: { ext: { abilities: { xp: 0, learned: ['sk_gunner_instinct'], equipped: ['sk_gunner_instinct'], spent: { gunner: 120 }, preset: { instinct: { initiative: 0, hit: 1, evade: 2 } } } } } }).game
    game.startBattle(duel([one({ actor: 'pc', weapon: 'pistol' } as never)], [idle()]))
    const alloc = game.state.battle!.units.a1!.ext.instinct as Rec
    // 120 點歷練 = 3 階 = 3 點
    expect(Object.values(alloc).reduce((n: number, v) => n + (v as number), 0)).toBe(3)
    expect(Object.values(alloc).every((v) => (v as number) >= 0 && (v as number) <= 3)).toBe(true)
  })

  it('重分配：花 1 行動點、每回合一次（第二次灰掉，原因是完整的句子）；每一項最多 3 點；總數不能超過點數', () => {
    const game = play(instinctIds, { tiers: { gunner: 4 } })
    const a1 = turnTo(game, 'a1')
    const o = opt(game, 'sk_gunner_instinct.realloc')
    expect(o.cost).toEqual({ ap: 1 })
    expect(o.picks.map((p) => [p.key, p.label, p.required, p.options.map((x) => x.value)])).toEqual([
      ['initiative', '先攻', true, [0, 1, 2, 3]], ['hit', '命中', true, [0, 1, 2, 3]], ['evade', '迴避', true, [0, 1, 2, 3]],
    ])
    // 4 階 = 4 點：開戰時隨機分
    expect(Object.values(a1.ext.instinct as Rec).reduce((n: number, v) => n + (v as number), 0)).toBe(4)
    // 每一項最多 3 點，超過的選項根本沒有；硬送也擋下
    expect(tryAct(game, { action: 'sk_gunner_instinct.realloc', pick: { initiative: 4, hit: 0, evade: 0 } })?.[0]).toBe('先攻要是 0～3 點的整數（每一項最多 3 點）。')
    // 總數超過點數
    expect(tryAct(game, { action: 'sk_gunner_instinct.realloc', pick: { initiative: 3, hit: 3, evade: 0 } })).toEqual(['戰鬥直覺現在只有 4 點可以分，你分了 6 點。'])
    // 缺一項
    expect(tryAct(game, { action: 'sk_gunner_instinct.realloc', pick: { initiative: 1, hit: 1 } })).toEqual(['要選迴避要放幾點。'])
    // 宣告與行動對得上
    expect(mismatches(game, o).bad).toEqual([])
    // 成立：先攻 0、命中 3、迴避 1
    const r = game.battleAct({ action: 'sk_gunner_instinct.realloc', pick: { initiative: 0, hit: 3, evade: 1 } })
    expect(r.status).toBe('applied')
    expect(unit(game, 'a1').ext.instinct).toEqual({ initiative: 0, hit: 3, evade: 1 })
    expect(unit(game, 'a1').ap.now).toBe(a1.ap.max - 1)
    const run = new BattleRun(game.k, game.state, game.state.battle!)
    expect(run.mods('hit', unit(game, 'a1')).find((p) => p.label === '戰鬥直覺')?.value).toBe(3)
    // 這一回合第二次：灰掉
    expect(opt(game, 'sk_gunner_instinct.realloc').blocks).toEqual(['這一回合已經重分配過了。'])
    expect(tryAct(game, { action: 'sk_gunner_instinct.realloc', pick: { initiative: 1, hit: 1, evade: 1 } })).toEqual(['這一回合已經重分配過了。'])
  })

  it('共鳴 5（點數 +1）：5 階的人有 6 點；沒到 5 階的共鳴不算', () => {
    const five = field(instinctIds, { tiers: { gunner: 5 } })
    // 6 點隨機分（每項最多 3 點）
    const sum = (a: Arena) => Object.values(a.ally(1).ext.instinct as Rec).reduce((n: number, v) => n + (v as number), 0)
    expect(sum(five)).toBe(6)
    const four = field(instinctIds, { tiers: { gunner: 4 } })
    expect(sum(four)).toBe(4)
  })

  it('心流：三個回合點數 +2、每一項上限 5、重分配不花行動點（每回合還是一次）；結束之後夾回', () => {
    const game = play([...instinctIds, 'sk_gunner_flow'], { tiers: { gunner: 4 } })
    turnTo(game, 'a1')
    expect(game.battleAct({ action: 'sk_gunner_flow' }).status).toBe('applied')
    // 開戰時的分配不變（多出來的 2 點等玩家重分配才用）
    expect(Object.values(unit(game, 'a1').ext.instinct as Rec).reduce((n: number, v) => n + (v as number), 0)).toBe(4)
    const o = opt(game, 'sk_gunner_instinct.realloc')
    expect(o.cost).toEqual({ ap: 0 })
    expect(o.picks[0]!.options.map((x) => x.value)).toEqual([0, 1, 2, 3, 4, 5])
    const before = unit(game, 'a1').ap.now
    // 6 點、單項 5：0／5／1
    expect(game.battleAct({ action: 'sk_gunner_instinct.realloc', pick: { initiative: 0, hit: 5, evade: 1 } }).status).toBe('applied')
    expect(unit(game, 'a1').ap.now).toBe(before)
    expect(unit(game, 'a1').ext.instinct).toEqual({ initiative: 0, hit: 5, evade: 1 })
    expect(opt(game, 'sk_gunner_instinct.realloc').blocks).toEqual(['這一回合已經重分配過了。'])
    const run = new BattleRun(game.k, game.state, game.state.battle!)
    const a1 = unit(game, 'a1')
    expect(run.mods('hit', a1).find((p) => p.label === '戰鬥直覺')?.value).toBe(5)
    // 三個回合之後心流結束：上限回到 3、點數回到 4，分配夾回（命中 3、迴避 1）
    for (let i = 0; i < 3; i++) game.k.battle.emit('turn.end', { run, unit: a1 })
    expect(run.mods('hit', a1).find((p) => p.label === '戰鬥直覺')?.value).toBe(3)
    expect(run.mods('evade', a1).find((p) => p.label === '戰鬥直覺')?.value).toBe(1)
    expect(opt(game, 'sk_gunner_instinct.realloc').cost).toEqual({ ap: 1 })
  })

  it('不是現實戰鬥、沒裝戰鬥直覺的人：沒有分配也沒有重分配', () => {
    const none = play([])
    turnTo(none, 'a1')
    expect(opt(none, 'sk_gunner_instinct.realloc')).toBeUndefined()
    expect(unit(none, 'a1').ext.instinct).toBeUndefined()
  })
})

// =====================================================================================

describe('點放：alter 加 as_pick——開了只花彈匣 2 格、壓制的 DC 是 16', () => {
  const burstGame = (ids: string[], o: PlayOpts = {}) => play(ids, { me: { weapons: [mag(5, 5, 'smg', 20)] }, foes: [idle({ hp: { now: 300, max: 300 } }), idle({ hp: { now: 300, max: 300 } })], ...o })

  it('沒開：花掉全部 5 格，壓制 DC = 10 + 5×2 = 20；開了：花 2 格（剩 3 格），DC 16', () => {
    const game = burstGame(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_tap'])
    turnTo(game, 'a1')
    const o = opt(game, 'sk_gunner_burst')
    expect(o.picks.find((p) => p.key === 'tap')).toMatchObject({ kind: 'toggle', required: false, label: '點放：只花 2 格' })
    expect(mismatches(game, o).bad).toEqual([])
    const plain = game.battleAct({ action: 'sk_gunner_burst', target: { unit: 'f1' } })
    expect(plain.status).toBe('applied')
    expect(unit(game, 'a1').weapons[0]!.mag!.now).toBe(0)
    expect(plain.reports[0]!.timeline.map((b) => b.roll).find((r) => r?.skill === 'composure')!.dc).toBe(20)

    const game2 = burstGame(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_tap'])
    turnTo(game2, 'a1')
    const tap = game2.battleAct({ action: 'sk_gunner_burst', target: { unit: 'f1' }, pick: { tap: true } })
    expect(tap.status).toBe('applied')
    expect(unit(game2, 'a1').weapons[0]!.mag!.now).toBe(3)
    expect(tap.reports[0]!.timeline.map((b) => b.roll).find((r) => r?.skill === 'composure')!.dc).toBe(16)
    // 傷害骰：花 2 格 = 多 1 顆（連射控制的 spent − 1）
    expect(tap.reports[0]!.timeline.some((b) => b.tag === 'hit' || b.tag === 'miss' || b.tag === 'crit')).toBe(true)
  })

  it('彈匣只剩 1 格時連射本來就灰掉；沒裝點放的人沒有這個選項', () => {
    const game = burstGame(['sk_gunner_instinct', 'sk_gunner_burst'], { me: { weapons: [mag(1, 5, 'smg')] } })
    turnTo(game, 'a1')
    expect(opt(game, 'sk_gunner_burst').blocks).toEqual(['彈匣裡要有 2 格以上才能連射。'])
    const plain = burstGame(['sk_gunner_instinct', 'sk_gunner_burst'])
    turnTo(plain, 'a1')
    expect(opt(plain, 'sk_gunner_burst').picks.some((p) => p.key === 'tap')).toBe(false)
  })
})

describe('彈幕與火力牆：範圍的壓制（attack.suppress.area、dc_bonus；COMBAT_SYSTEM 第 5 節）', () => {
  const smg = (n = 3) => ({ weapons: [mag(n, n, 'smg', 30)] })
  const foes3 = [idle({ hp: { now: 300, max: 300 } }), idle({ hp: { now: 300, max: 300 } }), idle({ hp: { now: 300, max: 300 } })]

  it('彈幕開著時連射：目標和相鄰一格上的人都要過檢定，兩個人的 DC 都 +2；沒開只有目標', () => {
    // 自然 1：全部沒過
    const off = field(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage'], { allies: [me(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage'], smg())], foes: foes3 })
    const r0 = off.run([15, ...Array(40).fill(3)])
    perform(off, r0, 'a1', 'sk_gunner_burst', { target: { unit: 'f1' } })
    expect(saves(r0).map((s) => s.dc)).toEqual([16])

    const on = field(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage'], { allies: [me(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage'], smg())], foes: foes3 })
    on.ally(1).stance = 'sk_gunner_barrage'
    const r1 = on.run([15, ...Array(40).fill(3)])
    perform(on, r1, 'a1', 'sk_gunner_burst', { target: { unit: 'f1' } })
    // 目標在第 1 格：相鄰只有第 2 格；第 3 格不受影響。DC = 10 + 3×2 + 2
    expect(saves(r1).map((s) => s.dc)).toEqual([18, 18])
    expect(statusIds(on.foe(1))).toEqual(['suppressed'])
    expect(statusIds(on.foe(2))).toEqual(['suppressed'])
    expect(statusIds(on.foe(3))).toEqual([])
    // 目標在中間：左右兩格都打到
    const mid = field(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage'], { allies: [me(['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage'], smg())], foes: foes3 })
    mid.ally(1).stance = 'sk_gunner_barrage'
    const rm = mid.run([15, ...Array(40).fill(3)])
    perform(mid, rm, 'a1', 'sk_gunner_burst', { target: { unit: 'f2' } })
    expect(saves(rm).map((s) => s.dc)).toEqual([18, 18, 18])
    expect([1, 2, 3].map((i) => statusIds(mid.foe(i)))).toEqual([['suppressed'], ['suppressed'], ['suppressed']])
  })

  it('壓制的檢定過了的人不被壓制；彈幕的選項只有姿態開著才算（關著的 alter 不生效）', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_barrage']
    // 目標的定力很高（一定過）、相鄰的沒有（一定沒過）：骰面全是 10
    const a = field(ids, { allies: [me(ids, smg())], foes: [idle({ hp: { now: 300, max: 300 }, skills: { composure: 50 } }), idle({ hp: { now: 300, max: 300 } }), idle({ hp: { now: 300, max: 300 } })] })
    a.ally(1).stance = 'sk_gunner_barrage'
    const run = a.run([15, ...Array(40).fill(10)])
    perform(a, run, 'a1', 'sk_gunner_burst', { target: { unit: 'f1' } })
    expect(saves(run)).toHaveLength(2)
    expect(statusIds(a.foe(1))).toEqual([])
    expect(statusIds(a.foe(2))).toEqual(['suppressed'])
    expect(statusIds(a.foe(3))).toEqual([])
  })

  it('火力牆：連射不花彈匣；敵方整排每一個人各自檢定（DC +2）；我方每一格迴避 +1 到我的下一回合開始', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_fire_wall']
    const a = field(ids, { allies: [me(ids, smg()), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], foes: [...foes3, idle({ hp: { now: 300, max: 300 } })] })
    const run = a.run([15, ...Array(40).fill(3)])
    perform(a, run, 'a1', 'sk_gunner_fire_wall', { target: { unit: 'f2' } })
    // 彈匣沒有少（花掉的 3 格照算在 DC 上：10 + 3×2 + 2 = 18）；四個敵人各一次檢定
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(3)
    expect(saves(run).map((s) => s.dc)).toEqual([18, 18, 18, 18])
    expect([1, 2, 3, 4].map((i) => statusIds(a.foe(i)))).toEqual([['suppressed'], ['suppressed'], ['suppressed'], ['suppressed']])
    // 我方每一格迴避 +1，到我的下一回合開始
    const wall = (i: number): number => total(modsOf(a, 'evade', `a${i}`).filter((p) => p.label === '火力牆'))
    expect([1, 2, 3].map(wall)).toEqual([1, 1, 1])
    a.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(wall(3)).toBe(1)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect([1, 2, 3].map(wall)).toEqual([0, 0, 0])
  })

  it('火力牆的花費與次數：3 行動點、每場 1 次；彈匣不到 2 格時灰掉（要連射）', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_fire_wall']
    const game = play(ids, { me: smg(), foes: foes3 })
    turnTo(game, 'a1')
    expect(opt(game, 'sk_gunner_fire_wall').cost).toEqual({ ap: 3 })
    expect(game.battleAct({ action: 'sk_gunner_fire_wall', target: { unit: 'f1' } }).status).toBe('applied')
    expect(unit(game, 'a1').weapons[0]!.mag!.now).toBe(3)
    expect(opt(game, 'sk_gunner_fire_wall').blocks).toEqual(['這一場已經用過了。'])
    const one1 = play(ids, { me: { weapons: [mag(1, 3, 'smg')] } })
    turnTo(one1, 'a1')
    expect(opt(one1, 'sk_gunner_fire_wall').blocks).toEqual(['彈匣裡要有 2 格以上才能連射。'])
  })
})

describe('壓制姿態：開著時每回合第一次射擊命中的目標直接被壓制，不必檢定', () => {
  const ids = ['sk_gunner_instinct', 'sk_gunner_suppress_stance']
  const mk = () => field(ids, { allies: [me(ids, { weapons: [mag(9, 9, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2)], foes: [idle({ hp: { now: 300, max: 300 } }), idle({ hp: { now: 300, max: 300 } })] })

  it('命中就壓制（沒有任何檢定）；同一回合第二次不再；下一回合又有；沒命中、沒開姿態都沒有', () => {
    const a = mk()
    a.ally(1).stance = 'sk_gunner_suppress_stance'
    const run = a.run(dice(15, 3, 3, 3, 1, 15, 3, 3, 3, 15, 3, 3, 3, 1, 1))
    run.attack(a.ally(1), a.foe(1))
    expect(statusIds(a.foe(1))).toEqual(['suppressed'])
    expect(saves(run)).toEqual([])
    // 同一回合打另一個人：沒有
    run.attack(a.ally(1), a.foe(2))
    expect(statusIds(a.foe(2))).toEqual([])
    // 下一回合（核心清掉 turn: 開頭的次數）
    for (const key of Object.keys(a.ally(1).uses)) if (key.startsWith('turn:')) delete a.ally(1).uses[key]
    run.attack(a.ally(1), a.foe(2))
    expect(statusIds(a.foe(2))).toEqual(['suppressed'])
    // 沒開姿態
    const off = mk()
    const r2 = off.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    r2.attack(off.ally(1), off.foe(1))
    expect(statusIds(off.foe(1))).toEqual([])
  })

  it('沒命中不壓制（姿態不消耗這一回合的次數）；姿態是一個行動（開關各 1 行動點）', () => {
    const a = mk()
    a.ally(1).stance = 'sk_gunner_suppress_stance'
    const run = a.run(dice(1, 1, 1, 1, 15, 3, 3, 3, 1, 1))
    run.attack(a.ally(1), a.foe(1))
    expect(statusIds(a.foe(1))).toEqual([])
    run.attack(a.ally(1), a.foe(1))
    expect(statusIds(a.foe(1))).toEqual(['suppressed'])
    const game = play(ids)
    turnTo(game, 'a1')
    expect(opt(game, 'sk_gunner_suppress_stance').cost).toEqual({ ap: 1 })
  })
})

// =====================================================================================

describe('不准動喔：守著敵方的一格（ward）', () => {
  const ids = ['sk_gunner_instinct', 'sk_gunner_dont_move']
  const tough = () => idle({ hp: { now: 300, max: 300 } })
  const mk = () => field(ids, { allies: [me(ids, { weapons: [mag(5, 5, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2)], foes: [tough(), tough(), tough()] })
  const place = (a: Arena, run: BattleRun, slot: number): void => perform(a, run, 'a1', 'sk_gunner_dont_move', { target: { side: 'foe', slot } })

  it('守著的那一格上的人換位時挨一槍（不花行動點、花彈匣）；第二次不挨', () => {
    const a = mk()
    const run = a.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 1, 1, 1, 1))
    place(a, run, 1)
    const ap = a.ally(1).ap.now
    run.move(a.foe(1), 2)
    expect(attacksBy(run, 'a1')).toBe(1)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(4)
    expect(a.ally(1).ap.now).toBe(ap)
    expect(a.foe(1).hp!.now).toBeLessThan(300)
    // 第二次（換回來）：不再挨
    run.move(a.foe(1), 1)
    expect(attacksBy(run, 'a1')).toBe(1)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(4)
  })

  it('站在那一格上的人攻擊時也挨一槍（他出手之前）；別的格上的人換位、攻擊都不挨', () => {
    const a = mk()
    a.foe(2).weapons = [mag(5, 5, 'pistol', 5)]
    const run = a.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 15, 3, 3, 3, 1, 1))
    place(a, run, 1)
    // 第 3 格換位、第 2 格攻擊：和守著的那一格無關
    run.move(a.foe(3), 2)
    run.attack(a.foe(2), a.ally(2))
    expect(attacksBy(run, 'a1')).toBe(0)
    // 守著的那一格的人攻擊
    run.attack(a.foe(1), a.ally(2))
    expect(attacksBy(run, 'a1')).toBe(1)
    // 守著用掉了：他再攻擊不會再挨
    run.attack(a.foe(1), a.ally(2))
    expect(attacksBy(run, 'a1')).toBe(1)
  })

  it('補位：那一格上的人因為前面的人倒下而往前補位時，也挨一槍（聽核心的 compacted 掛點：補位當下就射，不必等下一個動作）', () => {
    const a = mk()
    const run = a.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    place(a, run, 2)
    // 第 1 格的人倒下（遮蔽是暴露，後面的人補位到第 1 格）：setOut 一回來，那一槍已經射了
    run.setOut(a.foe(1), 'down', a.ally(2))
    expect(a.foe(2).slot).toBe(1)
    expect(attacksBy(run, 'a1')).toBe(1)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(4)
    expect(run.beats.some((b) => b.text.includes('補位了'))).toBe(true)
    // 之後的動作不會再補射一次（一格只管第一次）
    run.move(a.foe(3), 2)
    expect(attacksBy(run, 'a1')).toBe(1)
  })

  it('補位：只有「從守著那一格出去」的人算——別人補位經過那一格、或守著的那一格換了人上來都不算；補了兩格也是從原本的格算', () => {
    // 守著第 1 格：它的人倒下，後面的 f2 補位上來（他不是從第 1 格出去的）：不挨一槍；他之後在那一格換位才挨
    const a = mk()
    const run = a.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 1, 1, 1, 1))
    place(a, run, 1)
    run.setOut(a.foe(1), 'down', a.ally(2))
    expect(a.foe(2).slot).toBe(1)
    expect(attacksBy(run, 'a1')).toBe(0)
    run.move(a.foe(2), 2)
    expect(attacksBy(run, 'a1')).toBe(1)
    // 守著第 3 格、第 1 與第 2 格的人一起不在了（不經過 setOut）：f3 一次補到第 1 格，從第 3 格出去算補位
    const b = mk()
    const rb = b.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    place(b, rb, 3)
    b.foe(1).out = 'down'
    b.foe(2).out = 'down'
    rb.compact('foe')
    expect(b.foe(3).slot).toBe(1)
    expect(attacksBy(rb, 'a1')).toBe(1)
    // 守著第 2 格：第 3 格的人補位經過它、停在第 1 格，他不是從第 2 格出去的：不挨一槍
    const c = mk()
    const rc = c.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    place(c, rc, 2)
    c.foe(1).out = 'down'
    c.foe(2).out = 'down'
    rc.compact('foe')
    expect(c.foe(3).slot).toBe(1)
    expect(attacksBy(rc, 'a1')).toBe(0)
  })

  it('補位：on 沒寫 compact 的守著不管補位', () => {
    const a = field(ids, { allies: [me(ids, { weapons: [mag(5, 5, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2)], foes: [tough(), tough(), tough()] })
    const ward = (on: string[]) => ({ op: 'ward', slot: 'target', until: 'own_turn_start', on, do: [{ op: 'attack' }] })
    const run = a.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    run.effects([ward(['move'])], { user: a.ally(1), target: { side: 'foe', slot: 2 }, source: { kind: 'ability', id: 'sk_gunner_dont_move', name: '不准動喔' } })
    run.setOut(a.foe(1), 'down', a.ally(2))
    expect(a.foe(2).slot).toBe(1)
    expect(attacksBy(run, 'a1')).toBe(0)
  })

  it('到自己的下一回合開始就失效；守著的人倒下也失效；彈匣空了做不到就不算、繼續等', () => {
    const a = mk()
    const run = a.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 1, 1, 1, 1))
    place(a, run, 1)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    run.move(a.foe(1), 2)
    expect(attacksBy(run, 'a1')).toBe(0)

    const b = mk()
    const rb = b.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    place(b, rb, 1)
    rb.setOut(b.ally(1), 'down', b.foe(1))
    rb.move(b.foe(1), 2)
    expect(attacksBy(rb, 'a1')).toBe(0)

    const c = mk()
    const rc = c.run(dice(15, 3, 3, 3, 1, 1, 1, 1))
    place(c, rc, 1)
    c.ally(1).weapons[0]!.mag!.now = 0
    rc.move(c.foe(1), 2)
    expect(attacksBy(rc, 'a1')).toBe(0)
    // 換好彈匣之後，還在等：第 1 格現在站的是 f2，他這一次換位挨一槍
    c.ally(1).weapons[0]!.mag!.now = 5
    rc.move(c.foe(2), 2)
    expect(attacksBy(rc, 'a1')).toBe(1)
  })

  it('花 1 行動點、目標是敵方的一格（空格也可以守）；再用一次是改守另一格', () => {
    const game = play(ids)
    turnTo(game, 'a1')
    const o = opt(game, 'sk_gunner_dont_move')
    expect(o.cost).toEqual({ ap: 1 })
    expect(o.target).toBe('foe_slot')
    expect(game.battleAct({ action: 'sk_gunner_dont_move', target: { side: 'foe', slot: 1 } }).status).toBe('applied')
    expect(game.battleAct({ action: 'sk_gunner_dont_move', target: { side: 'foe', slot: 2 } }).status).toBe('applied')
    expect((unit(game, 'a1').ext.abilities as { wards: Array<{ slot: number }> }).wards.map((w) => w.slot)).toEqual([2])
  })
})

describe('下一個！與一槍定局', () => {
  it('下一個！：第一槍打倒了，立刻對選好的另一個敵人再射一槍（照常花彈匣）；第一槍沒打倒就沒有第二槍', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_next_one']
    const mk = (hp: number) => field(ids, { allies: [me(ids, { weapons: [mag(2, 2, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2)], foes: [idle({ hp: { now: hp, max: 300 } }), idle({ hp: { now: 300, max: 300 } })] })
    const a = mk(1)
    const r1 = a.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 1, 1))
    perform(a, r1, 'a1', 'sk_gunner_next_one', { target: { unit: 'f1' }, pick: { next: 'f2' } })
    expect(a.foe(1).out).toBe('down')
    expect(attacksBy(r1, 'a1')).toBe(2)
    expect(a.foe(2).hp!.now).toBeLessThan(300)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(0)
    // 沒打倒：只有一槍
    const b = mk(300)
    const r2 = b.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 1, 1))
    perform(b, r2, 'a1', 'sk_gunner_next_one', { target: { unit: 'f1' }, pick: { next: 'f2' } })
    expect(b.foe(1).out).toBeUndefined()
    expect(attacksBy(r2, 'a1')).toBe(1)
    expect(b.foe(2).hp!.now).toBe(300)
    // 打倒了、但沒有選下一個：只有一槍
    const c = mk(1)
    const r3 = c.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 1, 1))
    perform(c, r3, 'a1', 'sk_gunner_next_one', { target: { unit: 'f1' } })
    expect(attacksBy(r3, 'a1')).toBe(1)
  })

  it('下一個！的宣告與行動對得上（花 2 行動點；下一個目標不一定要選）', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_next_one']
    const game = play(ids, { me: { weapons: [mag(2, 2, 'pistol', 30)] } })
    turnTo(game, 'a1')
    const o = opt(game, 'sk_gunner_next_one')
    expect(o.cost).toEqual({ ap: 2 })
    expect(o.picks.map((p) => [p.key, p.required])).toEqual([['next', false]])
    expect(mismatches(game, o).bad).toEqual([])
    // 下一個目標不能就是第一槍的目標
    expect(tryAct(game, { action: 'sk_gunner_next_one', target: { unit: 'f1' }, pick: { next: 'f1' } })).toEqual([`下一個目標不能選${unit(game, 'f1').name}（和目標是同一個人）。`])
  })

  it('一槍定局：不到 5 的距離灰掉（原因是一句完整的話）；手上不是步槍或狙擊槍也灰掉；打得到時命中 +6、一定要害、部位由你選', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_one_shot']
    // 我站第 3 格（a3，步槍）：打第 1 格的敵人距離 3，打第 3 格的距離 5
    const build = (weapon: unknown) => makeBattleGame({
      features: FEATURES, content: [pack()], seed: 7,
      battle: duel([one({ weapon: 'pistol' }, 1), one({ weapon: 'pistol' }, 2), me(ids, { weapons: [weapon] })], [idle({ hp: { now: 300, max: 300 } }), idle(), idle({ hp: { now: 300, max: 300 } })]),
    }).game
    const game = build(mag(3, 3, 'rifle', 8))
    turnTo(game, 'a3')
    const o = opt(game, 'sk_gunner_one_shot')
    expect(o.blocks).toEqual([])
    expect(o.cost).toEqual({ ap: 3 })
    const blocksOf = (t: string): string[] => o.targets.find((x) => 'unit' in x.target && x.target.unit === t)!.blocks
    expect(blocksOf('f1')).toEqual(['目標要在距離 5～7 以內，現在距離 3。'])
    expect(blocksOf('f3')).toEqual([])
    expect(o.picks.map((p) => p.key)).toEqual(['part'])
    expect(tryAct(game, { action: 'sk_gunner_one_shot', target: { unit: 'f1' } })).toEqual(['目標要在距離 5～7 以內，現在距離 3。'])
    const r = game.battleAct({ action: 'sk_gunner_one_shot', target: { unit: 'f3' }, pick: { part: 'head' } })
    expect(r.status).toBe('applied')
    const roll = r.reports[0]!.timeline.find((b) => b.roll)!.roll!
    expect(roll.parts.find((p) => p.label === '一槍定局')?.value).toBe(6)
    expect(roll.parts.find((p) => p.label === '瞄準')?.value).toBe(3)
    // 每場 1 次
    expect(opt(game, 'sk_gunner_one_shot').blocks).toEqual(['這一場已經用過了。'])
    // 手槍：灰掉
    const pistol = build(mag(2, 2, 'pistol', 8))
    turnTo(pistol, 'a3')
    expect(opt(pistol, 'sk_gunner_one_shot').blocks).toEqual(['手上要拿著rifle或sniper類的武器才能用。'])
  })

  it('一槍定局：打中就是要害（自然骰夠的話一定是 crit），而且擲重創', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_one_shot']
    const a = field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'rifle', 8)], slot: 3 }), one({ weapon: 'pistol' }, 2)], foes: [idle({ hp: { now: 300, max: 300 }, rank: 'elite' }), idle(), idle({ hp: { now: 300, max: 300 }, rank: 'elite' })] })
    a.ally(1).slot = 3
    const run = a.run(dice(12, 3, 3, 3, 3, 3, 1, 1, 1))
    perform(a, run, 'a1', 'sk_gunner_one_shot', { target: { unit: 'f3' }, pick: { part: 'head' } })
    const tags = run.beats.map((b) => b.tag)
    expect(tags).toContain('crit')
    expect(tags).not.toContain('miss')
  })
})

// =====================================================================================

describe('叫人的加項：我有認識的人（alter）、派工網、人脈（mods）、共鳴 2', () => {
  const face = 'sk_fixer_face'
  const ids = (...more: string[]) => [face, ...more]

  it('我有認識的人：叫人多兩個選項（替隊友回復 2d6 生命、替隊友排 8 點感載）；沒裝就沒有', () => {
    const game = play(ids('sk_fixer_i_know_someone'), { tiers: { fixer: 4 } })
    turnTo(game, 'a1')
    const o = opt(game, 'sk_fixer_face.call')
    expect(o.picks[0]!.options.map((x) => x.value)).toEqual(['shot', 'cover_up', 'cover_down', 'heal', 'vent'])
    const none = play(ids(), { tiers: { fixer: 4 } })
    turnTo(none, 'a1')
    expect(opt(none, 'sk_fixer_face.call').picks[0]!.options.map((x) => x.value)).toEqual(['shot', 'cover_up', 'cover_down'])
    // 宣告與行動對得上（目標：隊友、敵人、我方的格、敵方的格）
    expect(mismatches(game, o).bad).toEqual([])
  })

  it('回復：2d6 生命；排感載：8 點；各算一次叫人；對自己、沒有橋的隊友、敵人用不了', () => {
    const game = play(ids('sk_fixer_i_know_someone'), { tiers: { fixer: 4 }, mates: [one({ weapon: 'pistol', hp: { now: 10, max: 46 }, load: { now: 20, max: 38 } } as never, 2), one({ weapon: 'pistol', load: undefined } as never, 3)] })
    const ap = turnTo(game, 'a1').ap.now
    const heal = game.battleAct({ action: 'sk_fixer_face.call', target: { unit: 'a2' }, pick: { option: 'heal' } })
    expect(heal.status).toBe('applied')
    const hp = unit(game, 'a2').hp!.now
    expect(hp).toBeGreaterThanOrEqual(12)
    expect(hp).toBeLessThanOrEqual(22)
    // 共鳴 2：每場第一次叫人不花行動點
    expect(unit(game, 'a1').ap.now).toBe(ap)
    expect(unit(game, 'a1').uses['sk_fixer_face.call']).toBe(1)
    const vent = game.battleAct({ action: 'sk_fixer_face.call', target: { unit: 'a2' }, pick: { option: 'vent' } })
    expect(vent.status).toBe('applied')
    expect(unit(game, 'a2').load!.now).toBe(12)
    // 這一場叫人的次數：4 階 = ceil(4/2) = 2 次，用完了
    expect(opt(game, 'sk_fixer_face.call').blocks).toEqual(['這一場叫人的次數用完了（2 次）。'])
    // 沒有橋的隊友沒有感載可以排
    expect(tryAct(game, { action: 'sk_fixer_face.call', target: { unit: 'a3' }, pick: { option: 'vent' } })?.length).toBeGreaterThan(0)
    // 對自己、對敵人
    expect(tryAct(game, { action: 'sk_fixer_face.call', target: { unit: 'a1' }, pick: { option: 'heal' } })?.length).toBeGreaterThan(0)
    expect(tryAct(game, { action: 'sk_fixer_face.call', target: { unit: 'f1' }, pick: { option: 'heal' } })?.length).toBeGreaterThan(0)
  })

  it('派工網與人脈：每場叫人的次數 +1（各加一次）；人脈再讓支援射擊命中 +2', () => {
    const base = play(ids(), { tiers: { fixer: 3 } })
    turnTo(base, 'a1')
    // 3 階：ceil(3/2) = 2 次
    unit(base, 'a1').uses['sk_fixer_face.call'] = 2
    expect(opt(base, 'sk_fixer_face.call').blocks).toEqual(['這一場叫人的次數用完了（2 次）。'])
    const net = play(ids('sk_fixer_dispatch_net'), { tiers: { fixer: 3 } })
    turnTo(net, 'a1')
    unit(net, 'a1').uses['sk_fixer_face.call'] = 2
    expect(opt(net, 'sk_fixer_face.call').blocks).toEqual([])
    unit(net, 'a1').uses['sk_fixer_face.call'] = 3
    expect(opt(net, 'sk_fixer_face.call').blocks).toEqual(['這一場叫人的次數用完了（3 次）。'])
    const both = play(ids('sk_fixer_dispatch_net', 'sk_fixer_connections'), { tiers: { fixer: 3 } })
    turnTo(both, 'a1')
    unit(both, 'a1').uses['sk_fixer_face.call'] = 3
    expect(opt(both, 'sk_fixer_face.call').blocks).toEqual([])
    unit(both, 'a1').uses['sk_fixer_face.call'] = 4
    expect(opt(both, 'sk_fixer_face.call').blocks).toEqual(['這一場叫人的次數用完了（4 次）。'])

    // 支援射擊的命中：4 + 場景等級 × 2（1 級 = 6）；人脈 +2
    const hitOf = (game: G): number => {
      turnTo(game, 'a1')
      const r = game.battleAct({ action: 'sk_fixer_face.call', target: { unit: 'f1' }, pick: { option: 'shot' } })
      expect(r.status).toBe('applied')
      return r.reports[0]!.timeline.find((b) => b.roll)!.roll!.parts.find((p) => p.label === '支援')!.value
    }
    expect(hitOf(play(ids(), { tiers: { fixer: 3 } }))).toBe(6)
    expect(hitOf(play(ids('sk_fixer_connections'), { tiers: { fixer: 3 } }))).toBe(8)
  })

  it('共鳴 2：每場戰鬥第一次叫人不花行動點（action_ap 的修正，次數在 action.done 記）', () => {
    const game = play(ids(), { tiers: { fixer: 3 } })
    turnTo(game, 'a1')
    expect(opt(game, 'sk_fixer_face.call').cost).toEqual({ ap: 0 })
    expect(game.battleAct({ action: 'sk_fixer_face.call', target: { side: 'ally', slot: 1 }, pick: { option: 'cover_up' } }).status).toBe('applied')
    expect(opt(game, 'sk_fixer_face.call').cost).toEqual({ ap: 1 })
    // 1 階：共鳴還沒到
    const low = play(ids(), { tiers: { fixer: 1 } })
    turnTo(low, 'a1')
    expect(opt(low, 'sk_fixer_face.call').cost).toEqual({ ap: 1 })
  })

  it('共鳴 3：和你相鄰的隊友迴避 +1', () => {
    const a = field(ids(), { tiers: { fixer: 3 } })
    expect([1, 2, 3].map((i) => total(modsOf(a, 'evade', `a${i}`)))).toEqual([0, 1, 0])
  })
})

// =====================================================================================

describe('勸降、有話好好說、收買（parley：check 加 status／out；branch 與 needs.any 補的寫法）', () => {
  const talk = ['sk_fixer_face', 'sk_fixer_talk_down']
  const mk = (foes: unknown[], ids = talk) => field(ids, { allies: [me(ids, {}), one({ weapon: 'pistol' }, 2)], foes })
  const blocks = (a: Arena, action: string, id: string): string[] => a.k.battle.getAction(action)!.targets!(a.run(), a.ally(1)).find((t) => 'unit' in t.target && t.target.unit === id)!.blocks
  const wounded = (rank: 'minion' | 'elite' | 'boss' = 'minion', o: Rec = {}) => foe(rank, { ...quiet, hp: { now: 10, max: 100 }, ...o } as never)

  it('勸降：對沒有重傷也沒有餘韻的敵人灰掉（一句完整的話）；重傷或疊著餘韻的可以；首領選不了', () => {
    const a = mk([foe('minion', quiet as never), wounded('minion'), foe('minion', { ...quiet, layers: 1 } as never), wounded('boss')])
    expect(blocks(a, 'sk_fixer_talk_down', 'f1')).toEqual(['保全要是重傷（生命低於一半）才能用；或是保全要疊著 1 層以上的餘韻才能用（現在 0 層）。'])
    expect(blocks(a, 'sk_fixer_talk_down', 'f2')).toEqual([])
    expect(blocks(a, 'sk_fixer_talk_down', 'f3')).toEqual([])
    expect(blocks(a, 'sk_fixer_talk_down', 'f4')).toEqual(['不能對首領用（課長是首領）。'])
  })

  it('勸降：對重傷的雜兵成功是投降、退出這場戰鬥；對精英成功是暈眩；失敗什麼都沒有（DC = 10 + 等級×2，精英再 +2）', () => {
    const a = mk([wounded('minion'), wounded('elite')])
    const win = a.run(dice(20, 20))
    perform(a, win, 'a1', 'sk_fixer_talk_down', { target: { unit: 'f1' } })
    expect(a.foe(1).out).toBe('surrendered')
    expect(rolls(win)[0]!.dc).toBe(12)
    perform(a, win, 'a1', 'sk_fixer_talk_down', { target: { unit: 'f2' } })
    expect(a.foe(2).out).toBeUndefined()
    expect(statusIds(a.foe(2))).toEqual(['dazed'])
    expect(rolls(win)[1]!.dc).toBe(14)
    // 失敗
    const b = mk([wounded('minion'), wounded('elite')])
    const lose = b.run(dice(1, 1))
    perform(b, lose, 'a1', 'sk_fixer_talk_down', { target: { unit: 'f1' } })
    perform(b, lose, 'a1', 'sk_fixer_talk_down', { target: { unit: 'f2' } })
    expect([b.foe(1).out, statusIds(b.foe(1)), statusIds(b.foe(2))]).toEqual([undefined, [], []])
    // 疊著餘韻的雜兵（沒有重傷）：成功是暈眩，不是投降
    const c = mk([foe('minion', { ...quiet, layers: 1 } as never)])
    perform(c, c.run(dice(20)), 'a1', 'sk_fixer_talk_down', { target: { unit: 'f1' } })
    expect([c.foe(1).out, statusIds(c.foe(1))]).toEqual([undefined, ['dazed']])
  })

  it('有話好好說：對精英或首領，DC = 10 + 等級×2（精英 +2、首領 +4）；成功是壓制並標記到他的下一回合結束；雜兵選不了', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_lets_talk']
    const a = mk([foe('minion', quiet as never), foe('elite', quiet as never), foe('boss', quiet as never)], ids)
    expect(blocks(a, 'sk_fixer_lets_talk', 'f1')).toEqual(['只能對精英或首領用（保全是雜兵）。'])
    expect(blocks(a, 'sk_fixer_lets_talk', 'f2')).toEqual([])
    const run = a.run(dice(20, 20))
    perform(a, run, 'a1', 'sk_fixer_lets_talk', { target: { unit: 'f2' } })
    perform(a, run, 'a1', 'sk_fixer_lets_talk', { target: { unit: 'f3' } })
    expect(rolls(run).map((r) => r.dc)).toEqual([14, 16])
    expect(statusIds(a.foe(2))).toEqual(['marked', 'suppressed'])
    expect(statusIds(a.foe(3))).toEqual(['marked', 'suppressed'])
    // 到他的下一回合結束
    expect(a.foe(2).statuses.map((s) => s.until)).toEqual([{ at: 'turn_end', of: 'f2', turns: 1 }, { at: 'turn_end', of: 'f2', turns: 1 }])
  })

  it('收買：2 行動點加等級×500 C$、每場 1 次；雜兵或精英失去下一回合；首領選不了；現金不夠灰掉', async () => {
    const ids = ['sk_fixer_face', 'sk_fixer_bribe']
    const game = play(ids, { game: { patch: { money: { cred: 0, cash: 800 } } }, foes: [foe('minion', quiet as never), foe('elite', quiet as never), foe('boss', quiet as never)] })
    turnTo(game, 'a1')
    const o = opt(game, 'sk_fixer_bribe')
    expect(o.cost).toEqual({ ap: 2, cash: 500 })
    expect(o.blocks).toEqual([])
    const t = (id: string) => o.targets.find((x) => 'unit' in x.target && x.target.unit === id)!.blocks
    expect(t('f1')).toEqual([])
    expect(t('f3')).toEqual(['不能對首領用（課長是首領）。'])
    expect(game.battleAct({ action: 'sk_fixer_bribe', target: { unit: 'f2' } }).status).toBe('applied')
    expect(statusIds(unit(game, 'f2'))).toEqual(['lose_turn'])
    expect(unit(game, 'a1').pools.cash!.now).toBe(300)
    // 每場 1 次；現金也不夠了
    expect(opt(game, 'sk_fixer_bribe').blocks).toEqual(expect.arrayContaining(['這一場已經用過了。']))
    // 現金不夠（300 < 500）
    const poor = play(ids, { game: { patch: { money: { cred: 0, cash: 300 } } } })
    turnTo(poor, 'a1')
    expect(opt(poor, 'sk_fixer_bribe').blocks).toEqual(['現金不夠（要 500，現在 300）。'])
    // 宣告與行動對得上
    const rich = play(ids, { game: { patch: { money: { cred: 0, cash: 800 } } } })
    turnTo(rich, 'a1')
    expect(mismatches(rich, opt(rich, 'sk_fixer_bribe')).bad).toEqual([])
    // 打完結算：扣了 500（用掉的錢寫回戰鬥結束的報告）
    rich.battleAct({ action: 'sk_fixer_bribe', target: { unit: 'f1' } })
    rich.state.battle!.result = { outcome: 'win', text: '測試用。' }
    return rich.finishBattle().then((end) => {
      expect(end.reports[0]!.changes.filter((c) => c.op === 'cash')).toEqual([{ op: 'cash', delta: -500 }])
      expect(rich.state.money.cash).toBe(300)
    })
  })

  it('branch 的 needs 看這一筆落在的人、when 看做的人；沒寫 else 就什麼都不做', () => {
    const a = mk([wounded('minion'), foe('elite', quiet as never)])
    const run = a.run()
    const use = { user: a.ally(1), source: SRC }
    run.effects([{ op: 'branch', who: 'foes', needs: { rank: ['minion'] }, do: [{ op: 'status', status: 'dazed' }] }], use)
    expect([statusIds(a.foe(1)), statusIds(a.foe(2))]).toEqual([['dazed'], []])
    run.effects([{ op: 'branch', who: 'foes', needs: { rank: ['boss'] }, do: [{ op: 'status', status: 'frozen' }], else: [{ op: 'status', status: 'marked' }] }], use)
    expect([statusIds(a.foe(1)), statusIds(a.foe(2))]).toEqual([['dazed', 'marked'], ['marked']])
    // when：做的人自己的條件（這裡要站第 3 格，我站第 1 格）
    run.effects([{ op: 'branch', who: 'foes', when: { slot: 3 }, do: [{ op: 'status', status: 'jammed' }] }], use)
    expect(statusIds(a.foe(1))).toEqual(['dazed', 'marked'])
  })
})

describe('擋、保釋、大局、全城欠我、黑市門路', () => {
  it('擋：隊友要被重創時觸發，那一擊變成一般的命中，小人情少一個；沒有人情不觸發；每場 2 次', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_block']
    const hitter = { weapons: [testWeapon('pistol', 30)], ...quiet }
    const mk = (favor: number) => {
      const a = field(ids, { foes: [foe('minion', hitter as never), foe('minion', quiet as never)] })
      a.ally(1).pools.favor_small = { now: favor, max: favor, regen: 0 }
      return a
    }
    const a = mk(2)
    const run = a.run(dice(20, 1, 1, 1, 1, 1, 1, 1))
    expect(run.attack(a.foe(1), a.ally(2)).wound).toBe(false)
    expect(a.ally(1).pools.favor_small!.now).toBe(1)
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max)
    // 沒有重創的一擊：不觸發
    const none = mk(2)
    none.run(dice(10, 1, 1, 1, 1, 1)).attack(none.foe(1), none.ally(2))
    expect(none.ally(1).pools.favor_small!.now).toBe(2)
    // 沒有人情：不觸發，重創照舊
    const broke = mk(0)
    expect(broke.run(dice(20, 1, 1, 1, 1, 1, 1, 1)).attack(broke.foe(1), broke.ally(2)).wound).toBe(true)
    // 每場 2 次：第三次不觸發（同一場、各一個新的骰序）
    const three = mk(5)
    const wounds = [1, 2, 3].map(() => three.run(dice(20, 1, 1, 1, 1, 1, 1, 1)).attack(three.foe(1), three.ally(2)).wound)
    expect(wounds).toEqual([false, false, true])
    expect(three.ally(1).pools.favor_small!.now).toBe(3)
  })

  it('擋的花費：不花行動點、只花小人情（每場 2 次）', () => {
    const game = play(['sk_fixer_face', 'sk_fixer_block'])
    expect(unit(game, 'a1').pools.favor_small).toEqual({ now: 0, max: 0, regen: 0 })
  })

  it('大局：把我方兩個人的順位對調；被換到前面、這一輪還沒動過的人接著動並拿回 1 點行動點（E7）', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_big_picture']
    const game = play(ids)
    // 順序：現在輪到我（a1），a2、a3 都還沒動：把 a2 和 a3 對調，a3 被換到前面，馬上接在我後面動
    game.state.battle!.order = ['a1', 'f1', 'a2', 'f2', 'a3']
    turnTo(game, 'a1')
    const o = opt(game, 'sk_fixer_big_picture')
    expect(o.cost).toEqual({ ap: 1 })
    expect(mismatches(game, o).bad).toEqual([])
    unit(game, 'a3').ap.now = 1
    unit(game, 'a2').ap.now = 1
    const r = game.battleAct({ action: 'sk_fixer_big_picture', target: { unit: 'a2' }, pick: { with: 'a3' } })
    expect(r.status).toBe('applied')
    const after = game.state.battle!
    expect(after.order[after.turn]).toBe('a1')
    expect(after.order[after.turn + 1]).toBe('a3')
    expect(after.order.indexOf('a2')).toBeGreaterThan(after.order.indexOf('a3'))
    expect(unit(game, 'a3').ap.now).toBe(2)
    expect(unit(game, 'a2').ap.now).toBe(1)
  })

  it('大局：一個動過、一個沒動過的人對調時，原本沒動過、被換到前面的人接著動並拿回 1 點行動點；動過的被換到後面（E7）', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_big_picture']
    const game = play(ids)
    // 順序：a2 動過了、現在輪到我（a1）、a3 還沒動：把 a2 和 a3 對調，a3 被換到前面（第 0 位），它對調之前還沒動過，所以接在我後面動
    game.state.battle!.order = ['a2', 'f1', 'a1', 'f2', 'a3']
    turnTo(game, 'a1')
    unit(game, 'a3').ap.now = 1
    const r = game.battleAct({ action: 'sk_fixer_big_picture', target: { unit: 'a2' }, pick: { with: 'a3' } })
    expect(r.status).toBe('applied')
    const after = game.state.battle!
    expect(after.order[after.turn]).toBe('a1')
    expect(after.order[after.turn + 1]).toBe('a3')
    expect(after.order.indexOf('a2')).toBeGreaterThan(after.order.indexOf('a3'))
    expect([...after.order].sort()).toEqual(['a1', 'a2', 'a3', 'f1', 'f2'])
    expect(unit(game, 'a3').ap.now).toBe(2)
    // 反過來（a3 動過、a2 沒動過；目標與 with 對調著選）：一樣是沒動過的那個接著動
    const g2 = play(ids)
    g2.state.battle!.order = ['a3', 'f1', 'a1', 'f2', 'a2']
    turnTo(g2, 'a1')
    expect(g2.battleAct({ action: 'sk_fixer_big_picture', target: { unit: 'a3' }, pick: { with: 'a2' } }).status).toBe('applied')
    const b2 = g2.state.battle!
    expect(b2.order[b2.turn + 1]).toBe('a2')
  })

  it('大局：被換到前面的人這一輪已經動過了，只換順位、拿回 1 點，不會接著動', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_big_picture']
    const game = play(ids)
    // 順序：a2、a3 都動過了，現在輪到我（a1）
    game.state.battle!.order = ['a2', 'f1', 'a3', 'f2', 'a1']
    turnTo(game, 'a1')
    unit(game, 'a2').ap.now = 1
    expect(game.battleAct({ action: 'sk_fixer_big_picture', target: { unit: 'a2' }, pick: { with: 'a3' } }).status).toBe('applied')
    const after = game.state.battle!
    expect(after.order).toEqual(['a3', 'f1', 'a2', 'f2', 'a1'])
    expect(after.order[after.turn]).toBe('a1')
    expect(unit(game, 'a3').ap.now).toBe(unit(game, 'a3').ap.max === 1 ? 1 : Math.min(unit(game, 'a3').ap.max, unit(game, 'a3').ap.now))
    expect(unit(game, 'a2').ap.now).toBe(1)
  })

  it('大局：選同一個人當對調的另一個選項時，宣告就不給（選項只對「不是自己」的目標適用）', () => {
    const game = play(['sk_fixer_face', 'sk_fixer_big_picture'])
    turnTo(game, 'a1')
    const o = opt(game, 'sk_fixer_big_picture')
    const withPick = o.picks.find((p) => p.key === 'with')!
    expect(withPick.options.filter((x) => pickApplies(x, { unit: 'a2' })).map((x) => x.value)).toEqual(['a3'])
    expect(tryAct(game, { action: 'sk_fixer_big_picture', target: { unit: 'a2' }, pick: { with: 'a2' } })).toEqual(['和誰對調不能選奈奈（和目標是同一個人）。'.replace('奈奈', unit(game, 'a2').name)])
  })

  it('保釋：隊友被制伏時觸發，制伏解除、他留在原來那一格；花 1 個中人情；每場 1 次', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_bail']
    const a = field(ids)
    a.ally(1).pools.favor_mid = { now: 1, max: 1, regen: 0 }
    const run = a.run()
    const slot = a.ally(2).slot
    expect(run.setOut(a.ally(2), 'subdued', a.foe(1))).toBe(false)
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(2).slot).toBe(slot)
    expect(a.ally(1).pools.favor_mid!.now).toBe(0)
    // 沒有人情了：這一次被制伏
    expect(run.setOut(a.ally(3), 'subdued', a.foe(1))).toBe(true)
    // 倒下（不是被制伏）不擋
    const b = field(ids)
    b.ally(1).pools.favor_mid = { now: 1, max: 1, regen: 0 }
    b.run().damage(b.ally(2), 999, 'physical', b.foe(1))
    expect(b.ally(2).out).toBe('down')
  })

  it('全城欠我：開戰時用，不花行動點、花 1 個大人情、每件委託 1 次；敵方一名精英或兩名雜兵失去第一回合', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_city_owes_me']
    const mk = (foes: unknown[]) => field(ids, { foes })
    const a = mk([foe('minion', quiet as never), foe('minion', quiet as never), foe('elite', quiet as never)])
    const run = a.run()
    perform(a, run, 'a1', 'sk_fixer_city_owes_me', { pick: { a: 'f1', b: 'f2', who: 'minions' } })
    expect([1, 2, 3].map((i) => statusIds(a.foe(i)))).toEqual([['lose_turn'], ['lose_turn'], []])
    // 一名精英：選精英
    const b = mk([foe('minion', quiet as never), foe('minion', quiet as never), foe('elite', quiet as never)])
    perform(b, b.run(), 'a1', 'sk_fixer_city_owes_me', { pick: { a: 'f3', who: 'elite' } })
    expect([1, 2, 3].map((i) => statusIds(b.foe(i)))).toEqual([[], [], ['lose_turn']])
    // 選「精英」卻點了雜兵、或選「兩名雜兵」卻點了精英：那一筆不算（落在不對的位階上沒有效果）
    const c = mk([foe('minion', quiet as never), foe('minion', quiet as never), foe('elite', quiet as never)])
    perform(c, c.run(), 'a1', 'sk_fixer_city_owes_me', { pick: { a: 'f1', b: 'f3', who: 'minions' } })
    expect([1, 2, 3].map((i) => statusIds(c.foe(i)))).toEqual([['lose_turn'], [], []])
    // 花費與次數
    const game = play(ids)
    turnTo(game, 'a1')
    unit(game, 'a1').pools.favor_big = { now: 1, max: 1, regen: 0 }
    const o = opt(game, 'sk_fixer_city_owes_me')
    expect(o.cost).toEqual({ ap: 0, favor_big: 1 })
    expect(game.battleAct({ action: 'sk_fixer_city_owes_me', pick: { a: 'f1', who: 'minions' } }).status).toBe('applied')
    expect(unit(game, 'a1').uses['commission:sk_fixer_city_owes_me']).toBe(1)
    // 第二回合起不能用（只能在第一回合）
    game.state.battle!.round = 2
    expect(opt(game, 'sk_fixer_city_owes_me').blocks.join('')).toContain('只能在第一回合用')
  })

  it('黑市門路：開戰時，隨機一名隊友彈匣多一格，可以超過容量；自己不算，沒有隊友就沒有效果', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_black_market']
    const owner = { pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { fixer: 120 } } } } }
    const start = (mates: number) => {
      const game = makeGame({ features: FEATURES, content: [pack()], ...owner }).game
      game.startBattle(duel([one({ actor: 'pc', weapon: 'pistol' } as never), ...Array.from({ length: mates }, (_, i) => one({ weapon: 'pistol' } as never, i + 2))], [idle()]))
      return game
    }
    const mags = (game: ReturnType<typeof start>) => ['a1', 'a2', 'a3'].map((id) => game.state.battle!.units[id]?.weapons[0]!.mag?.now)
    const g = start(2)
    // 兩個隊友裡有一個 3 格，另一個和自己照舊
    expect(mags(g)[0]).toBe(2)
    expect(mags(g).filter((n) => n === 3)).toHaveLength(1)
    // 沒有隊友：沒有效果
    expect(mags(start(0))[0]).toBe(2)
  })
})

// =====================================================================================

describe('被贖回：保釋的戰敗選項（features/defeat 的 defeat.options 掛點）', () => {
  const DEFEAT_PACK = {
    id: 'defeat_gb',
    content: {
      faction: [{ id: 'nora', name: '野良', short: '野良', class: 'street' }],
      defeat_event: [{ id: 'df_generic', name: '醒在巷子裡', kind: 'generic', factions: [], fails_commission: true, default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [{ kind: 'cash', amount: -300 }] } } }],
    },
  } as unknown as ContentPack
  const ids = ['sk_fixer_face', 'sk_fixer_bail']

  /** 一場打輸的戰鬥（全隊倒下）結算完，停在戰敗事件的等待裡。 */
  async function lost(o: { cash?: number; equipped?: string[]; grade?: 1 | 2 | 3; outcome?: string } = {}) {
    const game = makeBattleGame({
      features: [defeatFeature, combatFeature, abilitiesFeature], content: [pack(), DEFEAT_PACK], seed: 2, patch: { money: { cred: 0, cash: o.cash ?? 5000 } },
      battle: duel([me(o.equipped ?? ids)], [idle()], undefined, { grade: o.grade ?? 1 }),
    }).game
    game.state.battle!.result = { outcome: o.outcome ?? 'lose', text: '全隊倒下。' }
    await game.finishBattle()
    return game
  }

  it('裝著保釋的人在隊上、全隊倒下：戰敗事件多一個「被贖回」，付等級×1,000 C$；選了扣對的金額、不進戰敗事件的內容', async () => {
    const game = await lost({ cash: 5000, grade: 2 })
    expect(defeatOf(game.state)).toMatchObject({ outcome: 'lose', event: 'df_generic' })
    const [option] = defeatOptions(game.k, game.state)
    expect(defeatOptions(game.k, game.state)).toHaveLength(1)
    expect(option).toMatchObject({ id: 'ransom', name: '被贖回', blocks: [] })
    expect(option!.desc).toContain('2000')
    const draft = chooseDefeatOption(game.k, game.state, 'ransom')
    const [report] = game.commit(draft)
    expect(report).toMatchObject({ kind: 'event', action: 'defeat.option', outcome: { result: 'ransom' } })
    // 等級 2 = 2,000；事件本來要扣的 300 沒有扣（跳過事件的內容）
    expect(game.state.money.cash).toBe(3000)
    expect(defeatOf(game.state)).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.state.ext.ransom).toBeUndefined()
    expect(report!.outcome.summary).toMatch(/贖回/)
    expect(report!.outcome.summary).toMatch(/委託/)
  })

  it('錢不夠時這個選項灰掉（原因是一句完整的話），選不了；選別的選項（接受結果）照舊', async () => {
    const game = await lost({ cash: 500, grade: 1 })
    const [option] = defeatOptions(game.k, game.state)
    expect(option!.blocks).toEqual(['現金不夠（要 1000，現在 500）。'])
    expect(() => chooseDefeatOption(game.k, game.state, 'ransom')).toThrow('現金不夠（要 1000，現在 500）。')
    expect(game.state.money.cash).toBe(500)
    expect(defeatOf(game.state)).not.toBeNull()
  })

  it('隊上沒有人裝著保釋、或是投降（不是全隊倒下）：沒有這個選項；沒有等待中的戰敗也沒有', async () => {
    expect(defeatOptions((await lost({ equipped: ['sk_fixer_face'] })).k, (await lost({ equipped: ['sk_fixer_face'] })).state)).toEqual([])
    const surrender = await lost({ outcome: 'surrender' })
    expect(defeatOptions(surrender.k, surrender.state)).toEqual([])
    const fresh = makeGame({ features: [defeatFeature, combatFeature, abilitiesFeature], content: [pack(), DEFEAT_PACK] }).game
    expect(defeatOptions(fresh.k, fresh.state)).toEqual([])
    expect(() => chooseDefeatOption(fresh.k, fresh.state, 'ransom')).toThrow('沒有等待中的戰敗。')
    const game = await lost()
    expect(() => chooseDefeatOption(game.k, game.state, 'nothing')).toThrow(/沒有「nothing」這個選項/)
  })

  it('贏了的戰鬥不留贖金的記錄；上一場留下的，下一場結束時清掉', async () => {
    const game = await lost()
    expect(game.state.ext.ransom).toMatchObject({ cost: 1000 })
    game.commit(chooseDefeatOption(game.k, game.state, 'ransom'))
    game.startBattle(duel([me(ids)], [idle()]))
    game.state.battle!.result = { outcome: 'win', text: '贏了。' }
    await game.finishBattle()
    expect(game.state.ext.ransom).toBeUndefined()
  })
})

// =====================================================================================

describe('其餘的技能只用通則：寫得出來、動得起來', () => {
  const tough = (o: Rec = {}) => idle({ hp: { now: 300, max: 300 }, ...o })
  const hitterFoe = { weapons: [testWeapon('pistol', 30)], hp: { now: 300, max: 300 }, ...quiet }

  it('走開啦：射擊一次，命中的話把目標往後推一格；遮蔽的倍率至少算 ×1', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_back_off']
    const a = field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'pistol', 30)] })], foes: [tough(), tough()], cover: { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] } })
    const coverBefore = a.battle.cover.foe[0]!.hp
    const run = a.run(dice(15, 3, 3, 3, 1, 1))
    perform(a, run, 'a1', 'sk_gunner_back_off', { target: { unit: 'f1' } })
    expect(a.foe(1).slot).toBe(2)
    expect(a.foe(2).slot).toBe(1)
    // 手槍本來打遮蔽的倍率 ×0.25；至少 ×1 = 傷害骰的總和整個打在遮蔽上
    expect(coverBefore - a.battle.cover.foe[0]!.hp).toBeGreaterThanOrEqual(9)
  })

  it('穿透：把目標那一格的遮蔽當成低一級來算，穿甲 +1', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_pierce']
    const mk = (cover: number) => field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'pistol', 30)] })], foes: [tough(), tough()], cover: { ally: [0, 0, 0, 0], foe: [cover, 0, 0, 0] } })
    const a = mk(2)
    const run = a.run(dice(15, 3, 3, 3, 1, 1))
    perform(a, run, 'a1', 'sk_gunner_pierce', { target: { unit: 'f1' } })
    // 掩體（+4 之類）當成半掩體：迴避比同一格掩體時低
    const plain = a.run(dice(15, 3, 3, 3, 1, 1))
    const normal = plain.attack(a.ally(1), a.foe(1))
    const piercing = rolls(run)[0]!
    expect(piercing.dc).toBeLessThan(normal.evade)
  })

  it('跑位射擊：換位一次再射擊一次（2 行動點）；換到的那一格遮蔽高一級（最高到掩體），到下一回合開始就拿回去', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_run_and_gun']
    const a = field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2)], foes: [tough(), tough()], cover: { ally: [0, 1, 2, 0], foe: [0, 0, 0, 0] } })
    const run = a.run(dice(15, 3, 3, 3, 1, 1))
    expect(a.ally(1).slot).toBe(1)
    perform(a, run, 'a1', 'sk_gunner_run_and_gun', { target: { unit: 'f1' }, pick: { slot: 2 } })
    expect(a.ally(1).slot).toBe(2)
    expect(attacksBy(run, 'a1')).toBe(1)
    expect(a.battle.cover.ally[1]!.level).toBe(2)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(a.battle.cover.ally[1]!.level).toBe(1)
    // 已經是掩體的那一格：沒有升，到期也不會被拿掉
    const b = field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2)], foes: [tough(), tough()], cover: { ally: [0, 2, 0, 0], foe: [0, 0, 0, 0] } })
    const rb = b.run(dice(15, 3, 3, 3, 1, 1))
    perform(b, rb, 'a1', 'sk_gunner_run_and_gun', { target: { unit: 'f1' }, pick: { slot: 2 } })
    b.k.battle.emit('turn.start', { run: rb, unit: b.ally(1) })
    expect(b.battle.cover.ally[1]!.level).toBe(2)
    // 花費與宣告
    const game = play(ids, { me: { weapons: [mag(3, 3, 'pistol', 30)] } })
    turnTo(game, 'a1')
    const o = opt(game, 'sk_gunner_run_and_gun')
    expect(o.cost).toEqual({ ap: 2 })
    expect(o.picks.map((p) => p.key)).toEqual(['slot'])
  })

  it('死線：第一次進入重傷時立刻朝打傷他的人射擊一次（不花行動點、命中 +2）；到下一回合結束前重傷的 −2 不算；每場 1 次', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_deadline']
    const a = field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'pistol', 10)] }), one({ weapon: 'pistol' }, 2)], foes: [foe('minion', hitterFoe as never), tough()] })
    a.ally(1).hp!.now = 23
    const ap = a.ally(1).ap.now
    const run = a.run(dice(10, 3, 3, 3, 15, 3, 3, 3, 1, 1, 1, 1))
    run.attack(a.foe(1), a.ally(1))
    expect(a.ally(1).hp!.now).toBeLessThan(23)
    expect(attacksBy(run, 'a1')).toBe(1)
    expect(a.ally(1).ap.now).toBe(ap)
    expect(a.foe(1).hp!.now).toBeLessThan(300)
    // 重傷的 −2 不算：命中與檢定各 +2（只在重傷時）
    expect(total(modsOf(a, 'hit', 'a1').filter((p) => p.label === '死線'))).toBe(2)
    expect(total(modsOf(a, 'save', 'a1').filter((p) => p.label === '死線'))).toBe(2)
    expect(total(modsOf(a, 'hit', 'a1').filter((p) => p.source === 'condition'))).toBe(-2)
    a.ally(1).hp!.now = 40
    expect(modsOf(a, 'hit', 'a1').filter((p) => p.label === '死線')).toEqual([])
    // 下一回合結束
    a.ally(1).hp!.now = 10
    a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(modsOf(a, 'hit', 'a1').filter((p) => p.label === '死線')).toEqual([])
    // 每場 1 次
    expect(a.ally(1).uses.sk_gunner_deadline).toBe(1)
  })

  it('獵眼：瞄準過的射擊命中 +1（3 變 4）、超過迴避 3 以上就算要害；沒瞄準的不算', () => {
    const a = field(['sk_gunner_hunter_eye'])
    expect(total(modsOf(a, 'hit', 'a1', ['aimed']))).toBe(1)
    expect(total(modsOf(a, 'hit', 'a1', []))).toBe(0)
    // 要害的門檻從 5 變 3（修正是和核心預設的差）
    expect(modsOf(a, 'crit_margin', 'a1', ['aimed']).map((p) => p.value)).toEqual([3 - a.run().n.critMargin])
    expect(modsOf(a, 'crit_margin', 'a1', [])).toEqual([])
  })

  it('人槍合一：命中 +1、穿甲 +1、超過迴避 3 以上就算要害', () => {
    const a = field(['sk_gunner_gun_unity'])
    expect(total(modsOf(a, 'hit', 'a1'))).toBe(1)
    expect(total(modsOf(a, 'pierce', 'a1'))).toBe(1)
    expect(modsOf(a, 'crit_margin', 'a1').map((p) => p.value)).toEqual([3 - a.run().n.critMargin])
  })

  it('構裝精通：每場 2 次換武器不花行動點', () => {
    const game = play(['sk_gunner_instinct', 'sk_gunner_loadout_mastery'], { me: { weapons: [testWeapon('pistol', 5), testWeapon('smg', 5), testWeapon('knife', 5)] } })
    const spent = (): number => {
      turnTo(game, 'a1').ap.now = 10
      expect(game.battleAct({ action: 'swap' }).status).toBe('applied')
      return 10 - unit(game, 'a1').ap.now
    }
    expect([spent(), spent(), spent()]).toEqual([0, 0, 1])
  })

  it('掩護撤退：射擊一次，命中的話目標被壓制；讓一名和你相鄰的隊友換位（不花他的行動點）；不相鄰的隊友選不了', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_covering_retreat']
    const mk = () => field(ids, { allies: [me(ids, { weapons: [mag(3, 3, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], foes: [tough(), tough()] })
    const a = mk()
    const run = a.run(dice(15, 3, 3, 3, 1, 1))
    const mateAp = a.ally(2).ap.now
    perform(a, run, 'a1', 'sk_gunner_covering_retreat', { target: { unit: 'f1' }, pick: { mate: 'a2', slot: 3 } })
    expect(statusIds(a.foe(1))).toEqual(['suppressed'])
    expect([a.ally(2).slot, a.ally(3).slot]).toEqual([3, 2])
    expect(a.ally(2).ap.now).toBe(mateAp)
    // 宣告：第 3 格的隊友和我不相鄰，選項灰掉
    const game = play(ids, { me: { weapons: [mag(3, 3, 'pistol', 30)] } })
    turnTo(game, 'a1')
    const o = opt(game, 'sk_gunner_covering_retreat')
    expect(o.picks.find((p) => p.key === 'mate')!.options.map((x) => [x.value, x.blocks.length > 0])).toEqual([['a2', false], ['a3', true]])
    // 換到哪一格要和隊友相鄰（宣告只列四格，不相鄰的由行動擋下）；其餘的宣告與行動對得上
    expect(mismatches(game, o).bad.filter((x) => !x.includes('slot='))).toEqual([])
    expect(tryAct(game, { action: 'sk_gunner_covering_retreat', target: { unit: 'f1' }, pick: { mate: 'a2', slot: 4 } })).toEqual(['只能換到相鄰的格。'])
  })

  it('獵殺節奏：每回合第一次打出要害時，退還 1 點行動點，而且那一擊穿甲 +1；第二次要害沒有', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_kill_rhythm']
    const mk = () => field(ids, { allies: [me(ids, { weapons: [mag(9, 9, 'pistol', 0)], ap: { now: 10, max: 20, regen: 3 } }), one({ weapon: 'pistol' }, 2)], foes: [tough(), tough()] })
    const a = mk()
    // 自然 20 的命中是要害（也有重創）：先擲 20，再傷害骰
    const run = a.run(dice(20, 3, 3, 3, 3, 3, 1, 20, 3, 3, 3, 3, 3, 1, 1, 1))
    const hp = a.foe(1).hp!.now
    run.attack(a.ally(1), a.foe(1))
    expect(a.ally(1).ap.now).toBe(11)
    const first = hp - a.foe(1).hp!.now
    run.attack(a.ally(1), a.foe(2))
    expect(a.ally(1).ap.now).toBe(11)
    expect(first).toBeGreaterThan(0)
    // 沒有打出要害：沒有
    const b = mk()
    b.run(dice(12, 3, 3, 3, 1, 1)).attack(b.ally(1), b.foe(1))
    expect(b.ally(1).ap.now).toBe(10)
    // 穿甲 +1：同一個骰、有沒有這個技能，造成的傷害差一點護甲
    const plain = field(['sk_gunner_instinct'], { allies: [me(['sk_gunner_instinct'], { weapons: [mag(9, 9, 'pistol', 0)] }), one({ weapon: 'pistol' }, 2)], foes: [tough({ armor: 3 }), tough()] })
    const withIt = field(ids, { allies: [me(ids, { weapons: [mag(9, 9, 'pistol', 0)] }), one({ weapon: 'pistol' }, 2)], foes: [tough({ armor: 3 }), tough()] })
    plain.run(dice(20, 3, 3, 3, 3, 3, 1, 1)).attack(plain.ally(1), plain.foe(1))
    withIt.run(dice(20, 3, 3, 3, 3, 3, 1, 1)).attack(withIt.ally(1), withIt.foe(1))
    expect(300 - withIt.foe(1).hp!.now).toBeGreaterThan(300 - plain.foe(1).hp!.now)
  })

  it('子彈時間：兩個回合每回合回復的行動點 +2、每一次射擊都算瞄準過的；結束時感載 +10', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_bullet_time']
    const game = play(ids, { me: { weapons: [mag(5, 5, 'pistol', 30)] } })
    turnTo(game, 'a1')
    expect(opt(game, 'sk_gunner_bullet_time').cost).toEqual({ ap: 0 })
    expect(game.battleAct({ action: 'sk_gunner_bullet_time' }).status).toBe('applied')
    const run = new BattleRun(game.k, game.state, game.state.battle!)
    const a1 = unit(game, 'a1')
    expect(total(run.mods('ap_regen', a1))).toBe(2)
    // 普通射擊也算瞄準（命中 +3）
    const r = game.battleAct({ action: 'shoot', target: { unit: 'f1' } })
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.timeline.find((b) => b.roll)!.roll!.parts.find((p) => p.label === '瞄準')?.value).toBe(3)
    for (let i = 0; i < 3; i++) game.k.battle.emit('turn.end', { run, unit: a1 })
    expect(total(run.mods('ap_regen', a1))).toBe(0)
    expect(a1.load!.now).toBe(10)
  })

  it('還給你～：敵人的攻擊沒有打中你或相鄰的隊友時，立刻朝他射擊（命中 +2、花彈匣）；打中了、離得遠的隊友都不觸發；每回合 1 次', () => {
    const ids = ['sk_gunner_instinct', 'sk_gunner_right_back']
    const mk = () => field(ids, { allies: [me(ids, { weapons: [mag(5, 5, 'pistol', 30)] }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], foes: [foe('minion', hitterFoe as never), tough()] })
    const a = mk()
    const run = a.run(dice(1, 1, 1, 1, 15, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1))
    run.attack(a.foe(1), a.ally(2))
    expect(attacksBy(run, 'a1')).toBe(1)
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(4)
    expect(a.ally(1).ap.now).toBe(19)
    // 同一回合第二次：不觸發
    run.attack(a.foe(1), a.ally(2))
    expect(attacksBy(run, 'a1')).toBe(1)
    // 打中了：不觸發；離得遠（第 3 格）的隊友：不觸發
    const b = mk()
    const rb = b.run(dice(15, 3, 3, 3, 1, 1, 1, 1, 1))
    rb.attack(b.foe(1), b.ally(2))
    expect(attacksBy(rb, 'a1')).toBe(0)
    const c = mk()
    const rc = c.run(dice(1, 1, 1, 1, 1, 1, 1, 1, 1))
    rc.attack(c.foe(1), c.ally(3))
    expect(attacksBy(rc, 'a1')).toBe(0)
    // 沒打中我自己：也觸發
    const d = mk()
    const rd = d.run(dice(1, 1, 1, 1, 15, 3, 3, 3, 1, 1, 1, 1))
    rd.attack(d.foe(1), d.ally(1))
    expect(attacksBy(rd, 'a1')).toBe(1)
  })

  it('有我在：和你相鄰的隊友抵抗壓制的定力檢定 +2；別的檢定、不相鄰的隊友沒有', () => {
    const a = field(['sk_fixer_face', 'sk_fixer_im_here'])
    expect(total(modsOf(a, 'save', 'a2', ['resist:suppressed']))).toBe(2)
    expect(total(modsOf(a, 'save', 'a3', ['resist:suppressed']))).toBe(0)
    expect(total(modsOf(a, 'save', 'a2', ['hack']))).toBe(0)
    expect(total(modsOf(a, 'save', 'a1', ['resist:suppressed']))).toBe(0)
  })

  it('代理：花等級×100 C$，一名隊友的彈匣補滿，不花他的行動點', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_proxy']
    const game = play(ids, { game: { patch: { money: { cred: 0, cash: 1000 } } }, mates: [one({ weapon: 'pistol', weapons: [mag(0, 2)] } as never, 2)] })
    turnTo(game, 'a1')
    const o = opt(game, 'sk_fixer_proxy')
    expect(o.cost).toEqual({ ap: 1, cash: 100 })
    const ap = unit(game, 'a2').ap.now
    expect(game.battleAct({ action: 'sk_fixer_proxy', target: { unit: 'a2' } }).status).toBe('applied')
    expect(unit(game, 'a2').weapons[0]!.mag!.now).toBe(2)
    expect(unit(game, 'a2').ap.now).toBe(ap)
    expect(unit(game, 'a1').pools.cash!.now).toBe(900)
  })

  it('打他打他！：指定一個敵人，到你的下一回合為止全隊打他命中 +2、傷害多 1d3；別的敵人沒有', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_hit_him']
    const mk = () => field(ids, { foes: [tough({ armor: 0 }), tough({ armor: 0 })] })
    const a = mk()
    const run = a.run(dice(1, 1, 1, 1, 1))
    perform(a, run, 'a1', 'sk_fixer_hit_him', { target: { unit: 'f1' } })
    expect(statusIds(a.foe(1))).toEqual(['marked'])
    expect(total(modsOf(a, 'hit_against', 'f1'))).toBe(2)
    // 傷害多 1d3 看下一個測試；這裡看被指定的人有命中的明細
    const marked = a
    // 沒被指定的敵人沒有這個加成
    expect(modsOf(marked, 'hit_against', 'f2')).toEqual([])
    // 全隊都有這一段修正；到我的下一回合開始：結束
    expect([1, 2, 3].map((i) => unitBuffIds(marked.ally(i)))).toEqual([['hit_him'], ['hit_him'], ['hit_him']])
    marked.k.battle.emit('turn.start', { run: marked.run(), unit: marked.ally(1) })
    expect([1, 2, 3].map((i) => unitBuffIds(marked.ally(i)))).toEqual([[], [], []])
  })

  it('打他打他！的 1d3：只在打中被標記的敵人時擲一次，加進這一擊的傷害', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_hit_him']
    const mk = () => field(ids, { allies: [me(ids), one({ weapon: 'pistol', weapons: [{ ...testWeapon('pistol', 30), flat: 0 }] } as never, 2)], foes: [tough({ armor: 0 }), tough({ armor: 0 })] })
    const dmg = (marked: boolean, d3: number): number => {
      const a = mk()
      if (marked) perform(a, a.run(dice(1)), 'a1', 'sk_fixer_hit_him', { target: { unit: 'f1' } })
      const run = a.run(marked ? dice(15, d3, 3, 3, 3, 1, 1) : dice(15, 3, 3, 3, 1, 1))
      const before = a.foe(1).hp!.now
      run.attack(a.ally(2), a.foe(1))
      return before - a.foe(1).hp!.now
    }
    // 沒標記 = 3 顆骰各 3 = 9；標記 + 1d3：多 d3
    const base = dmg(false, 0)
    expect(dmg(true, 1) - base).toBe(1)
    expect(dmg(true, 3) - base).toBe(3)
  })

  it('布陣：開著時你的每一名隊友迴避 +1（關著沒有）；總攻令：每名隊友多回 1 點行動點、命中 +1', () => {
    const f1 = field(['sk_fixer_face', 'sk_fixer_formation'], { tiers: { fixer: 2 } })
    expect([1, 2, 3].map((i) => total(modsOf(f1, 'evade', `a${i}`)))).toEqual([0, 0, 0])
    f1.ally(1).stance = 'sk_fixer_formation'
    expect([1, 2, 3].map((i) => total(modsOf(f1, 'evade', `a${i}`)))).toEqual([1, 1, 1])

    const ids = ['sk_fixer_face', 'sk_fixer_all_out']
    const a = field(ids, { tiers: { fixer: 2 }, allies: [me(ids), one({ weapon: 'pistol', ap: { now: 2, max: 5, regen: 3 } } as never, 2), one({ weapon: 'pistol', ap: { now: 5, max: 5, regen: 3 } } as never, 3)] })
    perform(a, a.run(), 'a1', 'sk_fixer_all_out')
    expect([a.ally(1).ap.now, a.ally(2).ap.now, a.ally(3).ap.now]).toEqual([20, 3, 5])
    expect([1, 2, 3].map((i) => total(modsOf(a, 'hit', `a${i}`)))).toEqual([1, 1, 1])
    // 花費：2 行動點、每場 1 次
    const game = play(ids)
    turnTo(game, 'a1')
    expect(opt(game, 'sk_fixer_all_out').cost).toEqual({ ap: 2 })
    expect(game.battleAct({ action: 'sk_fixer_all_out' }).status).toBe('applied')
    expect(opt(game, 'sk_fixer_all_out').blocks).toEqual(['這一場已經用過了。'])
  })

  it('護盤：到你的下一回合開始前你和隊友迴避 +2、打在你們身上的重創改成一般的命中；每名隊友排 4 點感載', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_hold_the_line']
    const hitter = { weapons: [testWeapon('pistol', 30)], ...quiet }
    const a = field(ids, { allies: [me(ids, {}, { fixer: 2 }), one({ weapon: 'pistol', load: { now: 20, max: 38 } } as never, 2), one({ weapon: 'pistol', load: { now: 2, max: 38 } } as never, 3)], foes: [foe('minion', hitter as never), idle()] })
    a.ally(1).load!.now = 10
    perform(a, a.run(), 'a1', 'sk_fixer_hold_the_line')
    expect([1, 2, 3].map((i) => total(modsOf(a, 'evade', `a${i}`)))).toEqual([2, 2, 2])
    expect([a.ally(1).load!.now, a.ally(2).load!.now, a.ally(3).load!.now]).toEqual([6, 16, 0])
    // 自然 20（本來會重創）：改成一般的命中
    const r = a.run(dice(20, 1, 1, 1, 1, 1, 1, 1))
    expect(r.attack(a.foe(1), a.ally(2)).wound).toBe(false)
    // 到我的下一回合開始：結束
    a.k.battle.emit('turn.start', { run: r, unit: a.ally(1) })
    expect([1, 2, 3].map((i) => total(modsOf(a, 'evade', `a${i}`)))).toEqual([0, 0, 0])
    expect(a.run(dice(20, 1, 1, 1, 1, 1, 1, 1)).attack(a.foe(1), a.ally(2)).wound).toBe(true)
  })

  it('號令：開著時指揮每回合能讓的行動點上限 +1；拿到你行動點的隊友這一回合命中 +1、迴避 +1', () => {
    const ids = ['sk_fixer_face', 'sk_fixer_command']
    const game = play(ids, { tiers: { fixer: 2 }, mates: [one({ weapon: 'pistol', ap: { now: 1, max: 5, regen: 3 } } as never, 2), one({ weapon: 'pistol', ap: { now: 1, max: 5, regen: 3 } } as never, 3)] })
    const a1 = turnTo(game, 'a1')
    // 2 階：1 + 1 = 2 點；沒開號令時第 3 次灰掉
    const give = (to: string) => game.battleAct({ action: 'sk_fixer_face.give_ap', target: { unit: to } })
    expect(give('a2').status).toBe('applied')
    expect(give('a3').status).toBe('applied')
    expect(opt(game, 'sk_fixer_face.give_ap').blocks).toEqual(['這一回合已經讓了 2 點，不能再讓。'])
    expect(total(new BattleRun(game.k, game.state, game.state.battle!).mods('hit', unit(game, 'a2')))).toBe(0)
    // 開著號令：上限 3，拿到行動點的人命中 +1、迴避 +1
    const game2 = play(ids, { tiers: { fixer: 2 }, mates: [one({ weapon: 'pistol', ap: { now: 1, max: 5, regen: 3 } } as never, 2), one({ weapon: 'pistol', ap: { now: 1, max: 5, regen: 3 } } as never, 3)] })
    turnTo(game2, 'a1')
    expect(game2.battleAct({ action: 'sk_fixer_command' }).status).toBe('applied')
    const give2 = (to: string) => game2.battleAct({ action: 'sk_fixer_face.give_ap', target: { unit: to } })
    expect(give2('a2').status).toBe('applied')
    const run2 = new BattleRun(game2.k, game2.state, game2.state.battle!)
    expect([total(run2.mods('hit', unit(game2, 'a2'))), total(run2.mods('evade', unit(game2, 'a2')))]).toEqual([1, 1])
    expect([total(run2.mods('hit', unit(game2, 'a3'))), total(run2.mods('evade', unit(game2, 'a3')))]).toEqual([0, 0])
    expect(give2('a3').status).toBe('applied')
    unit(game2, 'a3').ap.now = 1
    expect(give2('a3').status).toBe('applied')
    expect(opt(game2, 'sk_fixer_face.give_ap').blocks).toEqual(['這一回合已經讓了 3 點，不能再讓。'])
    void a1
  })
})

describe('分層與不動核心', () => {
  it('技能功能不 import 別的功能（分層檢查另外有測試守，這裡確認戰敗選項走掛點）', () => {
    const game = makeGame({ features: [defeatFeature, combatFeature, abilitiesFeature], content: [pack()] }).game
    expect(game.k.hooks.owners('defeat.options')).toEqual(['abilities'])
  })
})
