// 驗收測試：dev/work/M1b-skill-medic.md（cpp-feature）。改造師「手術刀」這棵樹在現實的機制：用醫療道具的減免與治療加值、
// 拆解與超頻（義體失效、超頻）、拉回來、擋下倒下與過載的後果、處理重創、卸下（被拆下的義體記在 unit.ext.implants_gone）；
// 以及這棵樹二十七個技能與共鳴用假資料寫得出來、動得起來（日常的手術、解剖、工坊是 M4；替他裝上一件義體是 E13）。
// 規格：SKILL_TREES「改造師：手術刀」整節；COMBAT_SYSTEM 第 6 節、第 11 節；ITEMS 5.2 節；dev/adr/0015 第二、三節、E13；dev/adr/0013 B5。
// 內容一律是測試自帶的假資料（名字與數字照設計書），不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleInput, BattleSetup, BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { BattleBlocked, BattleRun, LOSE_TURN, advance, battleAct, beginTurn, performAction, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { unitBuffs } from '../../src/features/abilities/unitdata'
import { combatFeature } from '../../src/features/combat'
import { makeBattleGame, makeGame, observed, playOut, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature]

// ===================================================================================================================
// 假資料：改造師「手術刀」整棵樹（id 照 sk_medic_<英文名>；cpp-data 照這份改寫）。
// ===================================================================================================================

const TREE = {
  id: 'medic', name: '改造師', tree: '改造師：手術刀', category: 'meat', signature: 'sk_medic_scalpel', domains: { meat: 'strong', net: 'weak', opinion: 'none' },
  resonance: [
    { tier: 1, cells: 1, text: '你用的醫療道具效果多 4 點：回的生命值多 4，或排掉的感載多 4。', effect: { mods: [{ kind: 'heal_dealt', value: 4, tags: ['medical'] }, { kind: 'vent_dealt', value: 4, tags: ['medical'] }] } },
    { tier: 2, cells: 1, text: '每場戰鬥你第一次換位不花行動點。', effect: { free_move: { per_fight: 1 } } },
    // 戰鬥裡沒有醫療檢定（急救不擲骰；醫療檢定是日常 M4）：寫成帶 medicine 標籤的檢定加值，等那邊的檢定帶上標籤就生效
    { tier: 3, cells: 1, text: '醫療檢定 +2。', effect: { mods: [{ kind: 'save', value: 2, tags: ['medicine'] }] } },
    { tier: 4, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } },
    { tier: 5, cells: 1, text: '生命上限 +5。', effect: { hp_max: 5 } },
  ],
}

/** 技能的七個欄位之外都一樣：改造師樹、現實型、前置照給。 */
const sk = (id: string, name: string, tier: number, layer: 'signature' | 'front' | 'back', kind: string, cap: number, after: string | undefined, more: Rec = {}): Rec => ({
  id, name, path: 'medic', category: 'meat', tier, layer, kind, cap, xp: tier * 20, cells: 1, ...(layer === 'signature' ? {} : { after }), text: `${name}。`, net: null, opinion: null, meat: null, ...more,
})
const ID = (name: string): string => `sk_medic_${name}`

/** 義體學對目標的迴避（拆解、卸下、拆光、手手拿開共用的那一次檢定）。 */
const DISMANTLE_CHECK = { op: 'check', attr: 'tech', skill: 'cyberware', vs: 'evade', tags: ['dismantle'], label: '拆解', stop: true }
/** 用義體學打一次近戰（找縫、短路）。 */
const CYBER_AS = { attr: 'tech', skill: 'cyberware' }
/** 全面翻修的「至少回到上限的一半」：還是重傷（低於一半）就一步一步回，到不是重傷為止（設計書說至少回到一半；這是近似，見回報）。 */
const UP_TO_HALF = [8, 8, 8, 4, 2, 1, 1].map((amount) => ({ op: 'branch', needs: { wounded: true }, do: [{ op: 'heal', amount }] }))
const MEDIC: Rec[] = [
  // ---- 1 階 ----
  // 用快取格的醫療道具急救只花 1 點（對象自己或相鄰），回的生命多樹階；對有義體的目標打近戰可以用義體學代替格鬥（差是負的就不加）
  sk(ID('scalpel'), '手術刀', 1, 'signature', 'passive', 3, undefined, {
    meat: {
      mods: [
        { kind: 'action_ap', to: 1, tags: ['item:medical'], when: { target_near: true } },
        { kind: 'heal_dealt', value: 'tier', tags: ['medical'], when: { target_near: true } },
        { kind: 'hit', value: 'mod:tech+skill:cyberware+mod:body*-1+skill:brawl*-1', min: 0, when: { wield: 'melee', other_cyber: true } },
      ],
    },
  }),
  sk(ID('first_aid'), '戰場急救', 1, 'front', 'active', 1, ID('scalpel'), {
    use: { ap: 1, per_turn: 1 },
    meat: { target: 'near', action_tags: ['heal'], do: [{ op: 'heal', amount: '2d6+skill:medicine' }, { op: 'cleanse', by: 'first_aid' }] },
  }),
  sk(ID('dismantle'), '拆解', 1, 'front', 'active', 1, ID('scalpel'), {
    use: { ap: 2 },
    meat: { target: 'enemy', range: [1, 1], needs: { cyber: true }, do: [DISMANTLE_CHECK, { op: 'implant', mode: 'off', if: 'ok' }] },
  }),
  sk(ID('cool_down'), '呼呼不燙了', 1, 'front', 'active', 1, ID('scalpel'), {
    use: { ap: 1, per_turn: 1 },
    meat: {
      target: 'near',
      choose: [
        { key: 'vent', label: '排 8 點感載', needs: { bridged: true }, do: [{ op: 'vent', amount: 8 }] },
        { key: 'afterglow', label: '消一層餘韻', needs: { afterglow: 1 }, do: [{ op: 'afterglow', amount: -1 }] },
      ],
    },
  }),
  sk(ID('suture'), '縫合手', 1, 'back', 'passive', 2, ID('first_aid'), { meat: { mods: [{ kind: 'heal_dealt', value: 4 }] } }),
  // 自己或相鄰的隊友第一次進入重傷：回 2d6、止血，到他下一回合結束前不吃重傷的 −2（重傷還在的時候命中與檢定各 +2）
  sk(ID('painless'), '不痛不痛', 1, 'back', 'reaction', 1, ID('first_aid'), {
    use: { ap: 0, per_fight: 1 },
    meat: {
      trigger: { on: 'hp_half', who: 'near' },
      do: [
        { op: 'heal', amount: '2d6' }, { op: 'cleanse', by: 'first_aid' },
        { op: 'buff', id: 'painless', name: '不痛不痛', turns: 1, until: 'own_turn_end', mods: [{ kind: 'hit', value: 2, when: { wounded: true } }, { kind: 'save', value: 2, when: { wounded: true } }] },
      ],
    },
  }),
  sk(ID('surgery'), '手術', 1, 'back', 'daily', 1, ID('dismantle'), { use: { slot: 1 }, daily: { text: '自己動刀安裝、拆卸、修理義體（M4）。' } }),
  // ---- 2 階 ----
  // 一件義體超頻到他下一回合結束；超頻結束時那名隊友感載 +4（buff 的 on_end）。義肢、智慧槍的「下一次攻擊命中 +2」用掉的算法見 features/abilities/mods.ts
  sk(ID('overclock'), '超頻', 2, 'front', 'active', 1, ID('cool_down'), {
    use: { ap: 1, per_turn: 1 },
    meat: {
      target: 'near', needs: { cyber: true },
      do: [
        // 狀態：給自己時核心自己從下一個回合結束算起（own_turn_end 的規則，run.skipsOwnTurnEnd），不必多算一回合
        { op: 'implant', mode: 'boost' },
        // buff 的計時同狀態：給自己時從下一個回合結束算起（UnitBuff.skip）
        { op: 'buff', if: 'ok', id: 'overclock', name: '超頻', turns: 1, until: 'own_turn_end', on_end: [{ op: 'load', amount: 4, exact: true }] },
      ],
    },
  }),
  sk(ID('pull_back'), '拉回來', 2, 'front', 'active', 1, ID('first_aid'), {
    use: { ap: 2, per_fight: 1 },
    meat: { target: 'downed_near', do: [{ op: 'revive', hp: '2d6+skill:medicine' }] },
  }),
  sk(ID('find_gap'), '找縫', 2, 'front', 'active', 1, ID('dismantle'), {
    use: { ap: 2 },
    meat: {
      target: 'enemy', range: [1, 1], when: { wield: 'melee' },
      do: [{ op: 'branch', needs: { implant_off: true }, do: [{ op: 'attack', as: CYBER_AS, pierce: 4, tags: ['dismantle'] }], else: [{ op: 'attack', as: CYBER_AS, pierce: 2, tags: ['dismantle'] }] }],
    },
  }),
  // 拆解、找縫、卸下、短路、拆光的命中 +1（帶 dismantle 標籤的攻擊與檢定）；你動手制伏時格鬥檢定 +1
  sk(ID('dismantle_fun'), '拆拆好好玩', 2, 'back', 'passive', 3, ID('find_gap'), {
    meat: { mods: [{ kind: 'hit', value: 1, tags: ['dismantle'] }, { kind: 'save', value: 1, tags: ['dismantle'] }, { kind: 'save', value: 1, tags: ['subdue'] }] },
  }),
  // 開著時，每回合第一次對相鄰隊友用急救（道具）或戰場急救不花行動點
  sk(ID('rounds'), '巡房', 2, 'back', 'stance', 1, ID('pull_back'), {
    use: { ap: 1 },
    meat: { mods: [{ kind: 'action_ap', to: 0, tags: ['other'], tags_any: ['heal', 'item:medical'], per_turn: 1, when: { target_near: true } }] },
  }),
  // ---- 3 階 ----
  sk(ID('take_off'), '卸下', 3, 'front', 'active', 2, ID('find_gap'), {
    use: { ap: 3, per_fight: 1 },
    meat: { target: 'enemy', range: [1, 1], needs: { cyber: true }, do: [DISMANTLE_CHECK, { op: 'implant', mode: 'off', take: true, if: 'ok' }] },
  }),
  // 排好隊喔治療的都是隊友：action_tags 多帶 other，名醫的「治療隊友」才認得
  sk(ID('line_up'), '排好隊喔', 3, 'front', 'active', 2, ID('rounds'), {
    use: { ap: 2 },
    meat: { target: 'none', action_tags: ['heal', 'other'], do: [{ op: 'heal', who: 'near', amount: '2d6+skill:medicine' }] },
  }),
  sk(ID('flash_freeze'), '急凍', 3, 'front', 'reaction', 2, ID('overclock'), {
    use: { ap: 1, per_fight: 1 },
    meat: { trigger: { on: 'overload', who: 'ally' }, react: { keep_turn: true } },
  }),
  sk(ID('dissection'), '解剖', 3, 'back', 'daily', 2, ID('take_off'), { use: { slot: 1 }, daily: { text: '戰後從倒下的敵人身上拆下義體或零件（M4）。' } }),
  // 對有義體的敵人近戰命中 +1；拆解、找縫、卸下打契約義體時命中再 +2
  sk(ID('locksmith'), '解鎖匠', 3, 'back', 'passive', 4, ID('take_off'), {
    meat: {
      mods: [
        { kind: 'hit', value: 1, when: { wield: 'melee', other_cyber: true } },
        { kind: 'hit', value: 2, tags: ['dismantle'], when: { other_contract: true } },
        { kind: 'save', value: 2, tags: ['dismantle'], when: { other_contract: true } },
      ],
    },
  }),
  // ---- 4 階 ----
  sk(ID('short_circuit'), '短路', 4, 'front', 'active', 2, ID('take_off'), {
    use: { ap: 2 },
    meat: {
      target: 'enemy', range: [1, 1], when: { wield: 'melee' },
      do: [{ op: 'attack', as: CYBER_AS, type: 'em', tags: ['dismantle'] }, { op: 'branch', if: 'hit', needs: { cyber: true }, do: [{ op: 'status', status: 'dazed' }] }],
    },
  }),
  // 處理一個重創（選哪個部位）並回 2d6。「替他裝上快取格裡的一件義體」要義體系統（E13、M4），沒有寫
  sk(ID('field_surgery'), '戰地手術', 4, 'front', 'active', 2, ID('line_up'), {
    use: { ap: 3 },
    meat: {
      target: 'near', action_tags: ['heal'],
      choose: [
        { key: 'limb', label: '肢體', do: [{ op: 'wound', mode: 'treat', part: 'limb' }] },
        { key: 'head', label: '頭', do: [{ op: 'wound', mode: 'treat', part: 'head' }] },
        { key: 'torso', label: '軀幹', do: [{ op: 'wound', mode: 'treat', part: 'torso' }] },
        { key: 'bridge', label: '橋', do: [{ op: 'wound', mode: 'treat', part: 'bridge' }] },
      ],
      do: [{ op: 'heal', amount: '2d6' }],
    },
  }),
  sk(ID('not_sleep_yet'), '還不准睡', 4, 'front', 'reaction', 2, ID('flash_freeze'), {
    use: { ap: 1, per_fight: 1 },
    meat: { trigger: { on: 'out_before', who: 'ally' }, react: { prevent: { how: ['down', 'burnout'] } } },
  }),
  // 回復多 4 點；相鄰一格的隊友受到重創時，重的那一級改成輕的（wound_grade −1，落在被打的人身上）
  sk(ID('chief_surgeon'), '主刀', 4, 'back', 'passive', 5, ID('field_surgery'), { meat: { mods: [{ kind: 'heal_dealt', value: 4 }, { kind: 'wound_grade', value: -1, who: 'adjacent' }] } }),
  sk(ID('workshop'), '工坊', 4, 'back', 'daily', 2, ID('short_circuit'), { use: { slot: 1 }, daily: { text: '組裝義體、武器、護甲時檢定 +2（M4）。' } }),
  // ---- 5 階 ----
  sk(ID('strip_all'), '拆光', 5, 'front', 'active', 3, ID('short_circuit'), {
    use: { ap: 3, per_fight: 1 },
    meat: {
      target: 'enemy', range: [1, 1], needs: { cyber: true },
      do: [DISMANTLE_CHECK, { op: 'status', status: LOSE_TURN, if: 'ok' }, { op: 'implant', mode: 'off', take: true, if: 'ok' }, { op: 'implant', mode: 'off', take: true, if: 'ok' }],
    },
  }),
  // 生命至少回到上限的一半（近似：見 UP_TO_HALF）；清掉所有重創；消兩層餘韻。已經不是重傷的再回 2d6
  sk(ID('overhaul'), '全面翻修', 5, 'front', 'active', 3, ID('field_surgery'), {
    use: { ap: 2, per_fight: 1 },
    meat: {
      target: 'near', action_tags: ['heal'],
      do: [
        { op: 'branch', needs: { wounded: true }, do: UP_TO_HALF, else: [{ op: 'heal', amount: '2d6' }] },
        { op: 'wound', mode: 'clear' }, { op: 'afterglow', amount: -2 },
      ],
    },
  }),
  // 全身的義體超頻 3 回合：每回合回復的行動點 +1、命中 +1，結束時一層餘韻（只用 buff，不給 boost_ 狀態：狀態的 +2 會和這裡的 +1 疊成 +3）
  sk(ID('extreme_overclock'), '極限超頻', 5, 'front', 'active', 3, ID('not_sleep_yet'), {
    use: { ap: 1, per_fight: 1 },
    meat: {
      target: 'near',
      do: [{ op: 'buff', id: 'extreme', name: '極限超頻', turns: 3, until: 'own_turn_end', mods: [{ kind: 'ap_regen', value: 1 }, { kind: 'hit', value: 1 }], on_end: [{ op: 'afterglow', amount: 1 }] }],
    },
  }),
  // 回復多 4 點；每回合第一次治療隊友（急救、戰場急救、排好隊喔、戰地手術）退還 1 點行動點
  sk(ID('famed_doctor'), '名醫', 5, 'back', 'passive', 6, ID('overhaul'), {
    meat: { mods: [{ kind: 'heal_dealt', value: 4 }, { kind: 'action_ap', value: -1, tags: ['other'], tags_any: ['heal', 'item:medical'], per_turn: 1 }] },
  }),
  sk(ID('hands_off'), '手手拿開', 5, 'back', 'reaction', 3, ID('strip_all'), {
    use: { ap: 1, per_turn: 1 },
    meat: {
      trigger: { on: 'after', who: 'near', if: 'melee' },
      do: [
        { ...DISMANTLE_CHECK, who: 'attacker', stop: false },
        { op: 'implant', who: 'attacker', mode: 'off', turns: 2, if: 'ok' },
        { op: 'shift', who: 'attacker', dir: 'push', n: 1, if: 'ok' },
      ],
    },
  }),
]
const DAILY = [ID('surgery'), ID('dissection'), ID('workshop')]
const ALL = MEDIC.map((a) => a.id as string)

const ITEM = (id: string, more: Rec): Rec => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
const ITEMS = [
  ITEM('it_gel', { name: '急救凝膠', tags: ['medical'], use: { target: 'ally', ap: 1, ap_other: 2, effects: [{ op: 'heal', amount: 8 }, { op: 'cleanse', by: 'first_aid' }] } }),
  ITEM('it_coolant', { name: '冷卻劑', tags: ['medical'], use: { target: 'ally', ap: 1, ap_other: 2, effects: [{ op: 'afterglow', amount: -1 }, { op: 'vent', amount: 4 }] } }),
  // 沒有 medical 標籤的回復道具：吃不到手術刀的減免與加值
  ITEM('it_ration', { name: '營養棒', tags: ['food'], use: { target: 'ally', ap: 1, ap_other: 2, effects: [{ op: 'heal', amount: 8 }] } }),
]

const PACK: ContentPack = {
  id: 'medic_test',
  content: {
    battle_status: [
      ...TEST_STATUSES,
      { id: 'limb_hurt', name: '肢體受創', desc: '肢體受到重創的輕的那一級：命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' },
      { id: 'off_limb', name: '義肢失效', desc: '義肢失效：攻擊 −2。', mods: { hit: -2 }, until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'off_eye', name: '義眼失效', desc: '義眼失效：命中 −2。', mods: { hit: -2 }, until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'off_generic', name: '義體失效', desc: '一件義體失效。', until: 'own_turn_end', turns: 1, kind: 'debuff' },
      { id: 'boost_limb', name: '義肢超頻', desc: '義肢超頻：命中 +2。', mods: { hit: 2 }, until: 'own_turn_end', turns: 1, kind: 'buff' },
      { id: 'boost_subdermal', name: '皮下裝甲超頻', desc: '皮下裝甲超頻：護甲 +2。', mods: { armor: 2 }, until: 'own_turn_end', turns: 1, kind: 'buff' },
      { id: 'boost_generic', name: '義體超頻', desc: '一件義體超頻。', until: 'own_turn_end', turns: 1, kind: 'buff' },
    ],
    item: ITEMS,
    path: [TREE],
    ability: MEDIC,
  },
} as unknown as ContentPack

/** 同一組內容，技能換成這一串。 */
const withAbilities = (ability: Rec[]): ContentPack => ({ ...PACK, content: { ...PACK.content, ability } }) as unknown as ContentPack

// ---- 場地 ----

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]): number[] => [...v, ...Array(400).fill(1)]
const ATTRS = { body: 10, reflex: 15, tech: 14, intellect: 10, resolve: 12, charm: 10 }
const IMPLANTS = [{ kind: 'limb', name: '義肢' }, { kind: 'eye', name: '義眼' }, { kind: 'subdermal', name: '皮下裝甲' }]

interface MedicOpts { tier?: number; weapon?: string; unit?: Rec; items?: Array<{ item: string; qty: number }> }
/** 改造師：裝著指定的技能、這棵樹開到 tier 階、手上拿刀、快取格裡有急救凝膠與冷卻劑。 */
function medic(ids: string[], o: MedicOpts = {}): unknown {
  return one({
    actor: 'pc', weapon: o.weapon ?? 'knife', attrs: ATTRS, skills: { medicine: 3, cyberware: 3, brawl: 2, firearms: 2, composure: 1, athletics: 1 }, ap: { now: 20, max: 20, regen: 3 },
    quick: o.items ?? [{ item: 'it_gel', qty: 3 }, { item: 'it_coolant', qty: 3 }, { item: 'it_ration', qty: 3 }], ext: { abilities: { equipped: ids, tiers: { medic: o.tier ?? 3 } } }, ...o.unit,
  } as never)
}
/** 有義體的敵人：不動（行動點 0），拿刀站第 1 格。 */
const cyborg = (o: Rec = {}): unknown => foe('minion', { weapon: 'knife', implants: IMPLANTS, ...quiet, ...o } as never)
const plain = (o: Rec = {}): unknown => foe('minion', { weapon: 'knife', ...quiet, ...o } as never)

interface WorldOpts extends MedicOpts {
  allies?: unknown[]
  foes?: unknown[]
  cover?: { ally: number[]; foe: number[] }
  more?: Partial<BattleSetup>
  pack?: ContentPack
  prep?: (k: Kernel) => void
}
const mates = (): unknown[] => [one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)]
/** 不經過提交的場地：a1 是改造師（裝著 ids），a2、a3 是隊友；f1 是有義體的敵人，f2 沒有。 */
function world(ids: string[], o: WorldOpts = {}): Arena {
  return arena(duel(o.allies ?? [medic(ids, o), ...mates()], o.foes ?? [cyborg(), plain()], o.cover, o.more), FEATURES, (k) => {
    k.content.loadPack(o.pack ?? PACK)
    o.prep?.(k)
    readyFeatures(k)
  })
}
/** 一局已經開打的遊戲（走完整的 battleAct）。 */
function play(ids: string[], o: WorldOpts = {}, seed = 7) {
  return makeBattleGame({
    features: FEATURES, content: [o.pack ?? PACK], seed,
    battle: duel(o.allies ?? [medic(ids, o), ...mates()], o.foes ?? [cyborg(), plain()], o.cover, o.more),
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
const unit = (g: G, id: string): BattleUnit => g.state.battle!.units[id]!
const tryAct = (g: G, input: BattleInput): string[] | null => {
  try {
    battleAct(g.k, g.state, input)
    return null
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
}
/** 讓 a1（或指定的人）做一個行動，走和玩家一樣的路（performAction：花費的修正與 action.done 都一樣）；骰面釘死。條件、目標選不選得了照行動自己宣告的查。 */
function cast(a: Arena, action: string, target: BattleTarget | null, o: { pick?: Rec; d?: number[]; user?: string } = {}): BattleRun {
  const run = a.run(o.d ?? dice())
  const def = a.k.battle.getAction(action)!
  expect(def, action).toBeDefined()
  const performer = run.unit(o.user ?? 'a1')
  const input: BattleInput = { action, ...(target ? { target } : {}), ...(o.pick ? { pick: o.pick } : {}) }
  const why = [...(def.blocks?.(run, performer) ?? []), ...(target ? ((def.targets?.(run, performer) ?? []).find((t) => JSON.stringify(t.target) === JSON.stringify(target))?.blocks ?? ['這個目標不能選。']) : [])]
  if (why.length) throw new BattleBlocked(why)
  performAction(run, performer, def, target, input)
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
const u = (id: string): BattleTarget => ({ unit: id })
const sum = (parts: Array<{ value: number }>): number => parts.reduce((s, p) => s + p.value, 0)
const modTotal = (a: Arena, kind: Parameters<BattleRun['mods']>[0], id: string, tags: string[] = [], other?: string): number => {
  const run = a.run()
  return sum(run.mods(kind, run.unit(id), other ? run.unit(other) : undefined, undefined, tags).filter((p) => p.source === 'skill'))
}
/** 這一步的紀錄裡，某個技能觸發了幾次。 */
const fired = (run: BattleRun, id: string): number => run.beats.filter((b) => b.tag === 'skill' && (b.data as Rec | undefined)?.ability === id).length
const textOf = (run: BattleRun): string => run.beats.map((b) => b.text).join('\n')

// ===================================================================================================================

describe('這棵樹的二十七個技能：載得進來、格式檢查全過；日常是 M4', () => {
  it('二十七個技能與共鳴五階全部載入；三個日常（手術、解剖、工坊）沒有現實效果，其餘都有現實的寫法（沒有 pending）', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(MEDIC).toHaveLength(27)
    expect(g.k.content.list('ability')).toHaveLength(27)
    expect(g.k.content.checkRefs()).toEqual([])
    const daily = MEDIC.filter((a) => a.kind === 'daily').map((a) => a.id)
    expect(daily).toEqual(DAILY)
    for (const a of MEDIC) {
      if (daily.includes(a.id)) expect(a.meat, a.id as string).toBeNull()
      else expect((a.meat as Rec | null)?.pending, a.id as string).toBeUndefined()
    }
    // 每個技能的種類：主動 13（含招牌以外的前層）、被動 6（含招牌）、反應 4、姿態 1、日常 3
    const count = (kind: string) => MEDIC.filter((a) => a.kind === kind).length
    expect([count('active'), count('passive'), count('reaction'), count('stance'), count('daily')]).toEqual([13, 6, 4, 1, 3])
    expect(g.k.content.get<{ id: string; resonance: unknown[] }>('path', 'medic')!.resonance).toHaveLength(5)
  })

  it('格式檢查擋下寫壞的新鍵：to 只能用在 crit_margin、action_ap；tags_any、min、action_tags、implant_off、other_contract、target_near 的型別；implant 的 take', () => {
    const load = (meat: Rec | null, mods?: Rec[]) => () =>
      makeGame({
        features: FEATURES,
        content: [withAbilities([
          MEDIC[0]!,
          sk('sk_bad', '壞的', 1, 'front', mods ? 'passive' : 'active', 1, ID('scalpel'), { meat: mods ? { mods } : meat, use: { ap: 1 } }),
        ])],
      })
    expect(load(null, [{ kind: 'hit', to: 1 }])).toThrow(/to 只有 crit_margin/)
    expect(load(null, [{ kind: 'action_ap', to: -1 }])).toThrow(/to 要是 0 以上的整數/)
    expect(load(null, [{ kind: 'action_ap', to: 1, value: -1 }])).toThrow(/value 與 to 只能寫一個/)
    expect(load(null, [{ kind: 'action_ap', to: 1, tags_any: [] }])).toThrow(/tags_any/)
    expect(load(null, [{ kind: 'hit', value: 1, min: 'x' }])).toThrow(/min 要是數字/)
    expect(load(null, [{ kind: 'hit', value: 1, when: { target_near: false } }])).toThrow(/target_near 只能是 true/)
    expect(load(null, [{ kind: 'hit', value: 1, when: { other_contract: 1 } }])).toThrow(/other_contract 只能是 true/)
    expect(load({ target: 'enemy', action_tags: [] })).toThrow(/action_tags/)
    expect(load({ target: 'enemy', needs: { implant_off: false }, do: [{ op: 'heal', amount: 1 }] })).toThrow(/implant_off 只能是 true/)
    expect(load({ target: 'enemy', do: [{ op: 'implant', mode: 'boost', take: true }] })).toThrow(/take：只有 mode 是 off/)
    expect(load({ target: 'enemy', do: [{ op: 'implant', mode: 'off', take: true, turns: 2 }] })).toThrow(/take：已經是到戰鬥結束都失效/)
    expect(load({ target: 'enemy', do: [{ op: 'implant', mode: 'off', take: 'yes' }] })).toThrow(/take/)
    expect(load({ target: 'enemy', do: [{ op: 'branch', self: true, when: { wounded: true }, do: [{ op: 'heal', amount: 1 }] }] })).toThrow(/self：不認得的欄位/)
    // 對的寫法載得進去
    expect(load({ target: 'enemy', needs: { implant_off: true }, action_tags: ['heal'], do: [{ op: 'implant', mode: 'off', take: true }] })).not.toThrow()
  })

  it('宣告與行動本身對得上：每個主動技能照宣告選齊了都做得成（目標、選項、行動點）', () => {
    const g = play(ALL, { more: { grade: 1 } })
    const a = turnTo(g, 'a1')
    a.ap.now = 99
    unit(g, 'a2').hp!.now = 5
    for (const id of ALL.filter((x) => (MEDIC.find((m) => m.id === x)!.kind as string) === 'active')) {
      const o = opt(g, id)
      expect(o, id).toBeDefined()
      // 能選的目標，宣告選項齊了就一定做得成
      for (const t of o.targets.filter((x) => x.blocks.length === 0)) {
        const pick: Rec = {}
        for (const p of o.picks) {
          const usable = p.options.find((x) => x.blocks.length === 0 && (!x.for || x.for.some((f) => JSON.stringify(f) === JSON.stringify(t.target))))
          if (usable && p.required) pick[p.key] = usable.value
        }
        const g2 = play(ALL)
        const b = turnTo(g2, 'a1')
        b.ap.now = 99
        unit(g2, 'a2').hp!.now = 5
        unit(g2, 'a2').out = id === ID('pull_back') ? 'down' : undefined
        if (id === ID('pull_back')) unit(g2, 'a2').hp!.now = 0
        const why = tryAct(g2, { action: id, target: t.target, pick })
        expect(why, `${id} ${JSON.stringify(t.target)} ${JSON.stringify(pick)}`).toBeNull()
      }
    }
  })
})

// ===================================================================================================================

/** a1 做了這個動作之後行動點少了幾點。 */
const spentBy = (a: Arena, f: () => unknown, id = 'a1'): number => {
  const before = a.ally(Number(id.slice(1))).ap.now
  f()
  return before - a.ally(Number(id.slice(1))).ap.now
}
const useItem = (a: Arena, target: string, item = 'it_gel', d?: number[]): BattleRun => cast(a, 'item', u(target), { pick: { item }, ...(d ? { d } : {}) })
const hurt = (a: Arena, id: string, hp: number): void => {
  a.ally(Number(id.slice(1))).hp!.now = hp
}

describe('手術刀：用醫療道具的減免與治療加值（只有帶 medical 標籤的道具、只有自己或相鄰一格）', () => {
  it('替相鄰的隊友急救只花 1 點（原價 2），自己用還是 1；沒有手術刀照原價；回的生命多「樹階」點', () => {
    // 沒有手術刀：替隊友 2 點、回 8
    const none = world([], { tier: 3 })
    hurt(none, 'a2', 10)
    expect(spentBy(none, () => useItem(none, 'a2'))).toBe(2)
    expect(none.ally(2).hp!.now).toBe(18)
    // 有手術刀（樹階 3）：1 點、回 8 + 3（樹階）+ 4（共鳴 1：醫療道具多回 4）
    const a = world([ID('scalpel')], { tier: 3 })
    hurt(a, 'a2', 10)
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(1)
    expect(a.ally(2).hp!.now).toBe(25)
    // 自己用本來就是 1 點：不會變成 0，加值一樣
    hurt(a, 'a1', 10)
    expect(spentBy(a, () => useItem(a, 'a1'))).toBe(1)
    expect(a.ally(1).hp!.now).toBe(25)
  })

  it('回復多的是樹階：1 階多 1、5 階多 5（問的是做的人那棵樹的階）', () => {
    for (const tier of [1, 3, 5]) {
      const a = world([ID('scalpel')], { tier })
      hurt(a, 'a2', 10)
      useItem(a, 'a2')
      expect(a.ally(2).hp!.now, `${tier} 階`).toBe(18 + tier + 4)
    }
  })

  it('不相鄰的人選不了（行動自己擋下，寫出原因）：照原價根本用不到；直接問回復的加值，不相鄰的也不多', () => {
    const a = world([ID('scalpel')], { tier: 3 })
    hurt(a, 'a3', 10)
    expect(reasonOf(() => useItem(a, 'a3'))).toEqual(['要相鄰才用得到。'])
    const g = play([ID('scalpel')])
    turnTo(g, 'a1')
    const t3 = opt(g, 'item').targets.find((t) => 'unit' in t.target && t.target.unit === 'a3')!
    expect(t3.blocks).toEqual(['要相鄰才用得到。'])
    // 加值本身也只給自己或相鄰的人（問的是被回復的人）
    const run = a.run()
    const heal = (id: string) => run.heal(a.ally(Number(id.slice(1))), 8, a.ally(1), ['item', 'medical'])
    hurt(a, 'a2', 10)
    // 8 + 樹階 3 + 共鳴 1 的 4；不相鄰的只有共鳴 1 的 4（它不看對象在哪）
    expect(heal('a2')).toBe(15)
    expect(heal('a3')).toBe(12)
  })

  it('沒有 medical 標籤的道具吃不到減免與加值（營養棒：替隊友 2 點、回 8）', () => {
    const a = world([ID('scalpel')], { tier: 3 })
    hurt(a, 'a2', 10)
    expect(spentBy(a, () => useItem(a, 'a2', 'it_ration'))).toBe(2)
    expect(a.ally(2).hp!.now).toBe(18)
  })

  it('共鳴 1：醫療道具回的生命多 4、排掉的感載多 4（沒有 medical 標籤的不算）；手術刀的樹階加值只給回生命，不給排感載', () => {
    const a = world([ID('scalpel')], { tier: 3 })
    hurt(a, 'a2', 10)
    a.ally(2).load!.now = 30
    a.ally(2).layers = 1
    useItem(a, 'a2', 'it_gel')
    expect(a.ally(2).hp!.now).toBe(10 + 8 + 3 + 4)
    // 冷卻劑：消一層餘韻、排 4 + 共鳴 4
    useItem(a, 'a2', 'it_coolant')
    expect(a.ally(2).load!.now).toBe(30 - 4 - 4)
    expect(a.ally(2).layers).toBe(0)
    // 營養棒不是醫療道具
    const b = world([ID('scalpel')], { tier: 3 })
    hurt(b, 'a2', 10)
    useItem(b, 'a2', 'it_ration')
    expect(b.ally(2).hp!.now).toBe(18)
  })

  it('縫合手、主刀、名醫各多 4 點，疊加：一次戰場急救多回 12 點；道具的急救也多回 12 點', () => {
    const base = [ID('scalpel'), ID('first_aid')]
    const more = [...base, ID('suture'), ID('chief_surgeon'), ID('famed_doctor')]
    const heal = (ids: string[], f: (a: Arena) => unknown): number => {
      const a = world(ids, { tier: 3 })
      hurt(a, 'a2', 5)
      f(a)
      return a.ally(2).hp!.now - 5
    }
    const aid = (a: Arena) => cast(a, ID('first_aid'), u('a2'), { d: dice(3, 4) })
    expect(heal(base, aid)).toBe(3 + 4 + 3)
    expect(heal(more, aid)).toBe(3 + 4 + 3 + 12)
    const gelUse = (a: Arena) => useItem(a, 'a2')
    expect(heal(more, gelUse)).toBe(heal(base, gelUse) + 12)
  })
})

describe('戰場急救：不用道具，自己或相鄰一格的隊友回 2d6＋醫療，解除流血；每回合 1 次', () => {
  it('回 2d6＋醫療等級；解除流血；花 1 點；同一回合第二次擋下，下個回合又可以', () => {
    const a = world([ID('first_aid')], { tier: 1 })
    hurt(a, 'a2', 5)
    a.run().applyStatus(a.ally(2), 'bleeding')
    expect(spentBy(a, () => cast(a, ID('first_aid'), u('a2'), { d: dice(4, 5) }))).toBe(1)
    expect(a.ally(2).hp!.now).toBe(5 + 4 + 5 + 3)
    expect(a.ally(2).statuses.map((s) => s.id)).not.toContain('bleeding')
    expect(reasonOf(() => cast(a, ID('first_aid'), u('a2')))).toEqual(['這一回合已經用過了。'])
    for (const key of Object.keys(a.ally(1).uses)) if (key.startsWith('turn:')) delete a.ally(1).uses[key]
    expect(reasonOf(() => cast(a, ID('first_aid'), u('a1')))).toEqual([])
  })

  it('對象是自己或相鄰一格的隊友；不相鄰的灰掉、寫出原因', () => {
    const g = play([ID('first_aid')])
    turnTo(g, 'a1')
    const t = opt(g, ID('first_aid')).targets
    expect(t.map((x) => [x.target, x.blocks.length])).toEqual([[{ unit: 'a1' }, 0], [{ unit: 'a2' }, 0], [{ unit: 'a3' }, 1]])
    expect(t[2]!.blocks[0]).toMatch(/不在相鄰的格子/)
  })
})

// ===================================================================================================================

describe('拆解：義體學對目標的迴避，命中時目標一件義體失效到他下一回合結束', () => {
  const D = ID('dismantle')
  const NAT20 = dice(20)
  const NAT1 = dice(1)

  it('檢定沒過什麼都不發生（行動點照樣花）；過了，目標多一個 off_<種類> 的狀態到他下一回合結束', () => {
    const fail = world([D])
    expect(spentBy(fail, () => cast(fail, D, u('f1'), { d: NAT1 }))).toBe(2)
    expect(fail.foe(1).statuses).toEqual([])
    const a = world([D])
    cast(a, D, u('f1'), { d: NAT20 })
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_limb'])
    expect(a.foe(1).statuses[0]!.until).toEqual({ at: 'turn_end', of: 'f1', turns: 1 })
    // 再拆一次是下一件（義眼）；第三次是皮下裝甲沒有失效狀態，退回 off_generic
    cast(a, D, u('f1'), { d: NAT20 })
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_limb', 'off_eye'])
    // 到他下一回合結束就沒有了
    const run = a.run()
    for (let i = 0; i < 12 && a.foe(1).statuses.length; i++) advance(run)
    expect(a.foe(1).statuses).toEqual([])
  })

  it('義肢失效：他的攻擊 −2；目標沒有義體時這個技能灰掉、原因是一句完整的話', () => {
    const a = world([D])
    cast(a, D, u('f1'), { d: NAT20 })
    expect(sum(a.run().mods('hit', a.foe(1)).filter((p) => p.source === 'status'))).toBe(-2)
    const g = play([D], { foes: [plain(), cyborg()] })
    turnTo(g, 'a1')
    const t = opt(g, D).targets
    expect(t[0]!.blocks).toEqual(['保全要有義體才能用。'])
    // 第二個敵人有義體，但站第 2 格：不是近身的距離
    expect(t[1]!.blocks).toEqual(['目標要在近身的距離（雙方都站第 1 格），現在距離 2。'])
    expect(tryAct(g, { action: D, target: { unit: 'f1' } })).toEqual(['保全要有義體才能用。'])
  })

  it('拆拆好好玩：拆解、找縫、卸下、短路、拆光的命中 +1（帶 dismantle 標籤的攻擊與檢定），制伏的檢定 +1；解鎖匠打契約義體再 +2', () => {
    const a = world([ID('dismantle_fun'), ID('locksmith')], { foes: [cyborg({ implants: [{ kind: 'limb', name: '契約義肢', contract: true }] }), cyborg()] })
    expect(modTotal(a, 'save', 'a1', ['dismantle'], 'f1')).toBe(1 + 2)
    expect(modTotal(a, 'save', 'a1', ['dismantle'], 'f2')).toBe(1)
    expect(modTotal(a, 'hit', 'a1', ['dismantle'], 'f1')).toBe(1 + 2 + 1)
    expect(modTotal(a, 'hit', 'a1', ['dismantle'], 'f2')).toBe(1 + 1)
    expect(modTotal(a, 'save', 'a1', ['subdue'], 'f2')).toBe(1)
    // 沒有 dismantle 標籤的檢定不吃
    expect(modTotal(a, 'save', 'a1', ['hack'], 'f1')).toBe(0)
  })

  it('檢定的明細裡看得到拆拆好好玩與解鎖匠的加值', () => {
    const a = world([D, ID('dismantle_fun'), ID('locksmith')], { foes: [cyborg({ implants: [{ kind: 'limb', name: '契約義肢', contract: true }] }), plain()] })
    const run = cast(a, D, u('f1'), { d: NAT20 })
    const roll = run.beats.find((b) => b.roll)!.roll!
    expect(roll.parts.filter((p) => p.source === 'skill').map((p) => p.value)).toEqual(expect.arrayContaining([3, 1, 2]))
  })
})

describe('超頻：一件義體超頻到他下一回合結束，結束時那名隊友感載 +4', () => {
  const O = ID('overclock')
  const withImplants = (extra: Rec = {}) => ({ allies: [medic([O], { unit: { implants: IMPLANTS } }), one({ weapon: 'pistol', implants: IMPLANTS }, 2), one({ weapon: 'pistol' }, 3)], ...extra })

  it('隊友得到 boost_<種類>；他下一回合結束時感載 +4（精確的 4 點，不乘敏感度）；沒有義體的人灰掉', () => {
    const a = world([O], withImplants())
    expect(spentBy(a, () => cast(a, O, u('a2')))).toBe(1)
    expect(a.ally(2).statuses.map((s) => s.id)).toEqual(['boost_limb'])
    expect(a.ally(2).load!.now).toBe(0)
    // 到 a2 的回合結束：超頻結束，感載 +4
    const run = a.run()
    for (let i = 0; i < 12 && a.ally(2).load!.now === 0; i++) advance(run)
    expect(a.ally(2).load!.now).toBe(4)
    expect(a.ally(2).statuses).toEqual([])
    expect(textOf(run)).toContain('超頻結束了')
    // 沒有義體的 a3 不相鄰，而且沒有義體：灰掉
    const g = play([O], withImplants())
    turnTo(g, 'a1')
    const t = opt(g, O).targets
    expect(t.map((x) => x.blocks.length > 0)).toEqual([false, false, true])
    expect(t[2]!.blocks).toEqual(['喬不在相鄰的格子，只能對自己或相鄰的隊友用。', '喬要有義體才能用。'])
  })

  it('給自己：到「他下一回合結束」，所以這個回合的結束不算（狀態與 buff 同一個規則：核心的 skip、UnitBuff.skip）；自己的回合結束兩次才結束', () => {
    const a = world([O], withImplants())
    // 他自己的回合正在進行（狀態的略過看這個）
    a.battle.order = ['a1', ...a.battle.order.filter((id) => id !== 'a1')]
    delete a.battle.acting
    a.battle.turn = 0
    beginTurn(a.run(), a.ally(1))
    cast(a, O, u('a1'))
    expect(a.ally(1).statuses[0]).toMatchObject({ id: 'boost_limb', until: { at: 'turn_end', of: 'a1', turns: 1, skip: true } })
    expect(unitBuffs(a.ally(1))[0]).toMatchObject({ id: 'overclock', turns: 1, skip: true })
    const run = a.run()
    const endTurn = () => a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    endTurn()
    expect(a.ally(1).load!.now).toBe(0)
    endTurn()
    expect(a.ally(1).load!.now).toBe(4)
  })

  it('給自己的超頻狀態：自己的回合結束時還在，下一個自己的回合結束才拿掉（核心的 skip）', () => {
    const a = world([O], withImplants())
    a.battle.order = ['a1', ...a.battle.order.filter((id) => id !== 'a1')]
    delete a.battle.acting
    a.battle.turn = 0
    beginTurn(a.run(), a.ally(1))
    cast(a, O, u('a1'))
    const run = a.run()
    const has = () => a.ally(1).statuses.some((x) => x.id === 'boost_limb')
    advance(run)
    expect(has()).toBe(true)
    for (let i = 0; i < 12 && a.battle.order[a.battle.turn] !== 'a1'; i++) {
      expect(has()).toBe(true)
      advance(run)
    }
    expect(a.battle.order[a.battle.turn]).toBe('a1')
    expect(has()).toBe(true)
    advance(run)
    expect(has()).toBe(false)
  })

  it('義體超頻失敗（沒有可挑的義體：每一件都已經超頻了）時不掛 buff，也沒有感載', () => {
    const a = world([O], withImplants({ allies: [medic([O], { unit: { implants: IMPLANTS } }), one({ weapon: 'pistol', implants: [{ kind: 'limb', name: '義肢' }] }, 2), one({ weapon: 'pistol' }, 3)] }))
    cast(a, O, u('a2'))
    for (const key of Object.keys(a.ally(1).uses)) if (key.startsWith('turn:')) delete a.ally(1).uses[key]
    cast(a, O, u('a2'))
    const run = a.run()
    for (let i = 0; i < 12 && a.ally(2).statuses.length; i++) advance(run)
    // 只有第一次的那一個 buff：+4 一次
    expect(a.ally(2).load!.now).toBe(4)
  })

  it('「下一次攻擊」：義肢（有命中加值）的超頻打完第一次攻擊就用掉；之後的攻擊沒有加值；皮下裝甲的護甲照樣到回合結束', () => {
    const a = world([O], withImplants())
    cast(a, O, u('a2'))
    const run = a.run(dice(10, 1, 1, 1, 10, 1, 1, 1))
    const first = run.attack(a.ally(2), a.foe(1))
    expect(first.hit).toBe(true)
    const rolls = run.beats.filter((b) => b.roll).map((b) => b.roll!)
    expect(rolls[0]!.parts.find((p) => p.label === '義肢超頻')?.value).toBe(2)
    expect(a.ally(2).statuses).toEqual([])
    run.attack(a.ally(2), a.foe(1))
    expect(run.beats.filter((b) => b.roll).map((b) => b.roll!)[1]!.parts.find((p) => p.label === '義肢超頻')).toBeUndefined()
    // 皮下裝甲：護甲 +2，不被攻擊用掉
    const b = world([O], { allies: [medic([O], { unit: { implants: IMPLANTS } }), one({ weapon: 'pistol', implants: [{ kind: 'subdermal', name: '皮下裝甲' }] }, 2), one({ weapon: 'pistol' }, 3)] })
    cast(b, O, u('a2'))
    b.run(dice(10, 1, 1, 1)).attack(b.ally(2), b.foe(1))
    expect(b.ally(2).statuses.map((s) => s.id)).toEqual(['boost_subdermal'])
    expect(sum(b.run().mods('armor', b.ally(2)).filter((p) => p.source === 'status'))).toBe(2)
  })
})

// ===================================================================================================================

describe('拉回來：相鄰、生命歸零倒下的隊友回到場上；餘韻疊滿昏過去的選不了；每場一次', () => {
  const P = ID('pull_back')
  const knockDown = (a: Arena, id: string): void => {
    const run = a.run()
    run.damage(a.ally(Number(id.slice(1))), 999, 'physical', a.foe(1))
    expect(a.ally(Number(id.slice(1))).out).toBe('down')
  }

  it('回到 2d6＋醫療等級的生命、重新回到戰鬥（有空格放最後面的空格）；花 2 點；每場一次', () => {
    const a = world([P])
    knockDown(a, 'a2')
    expect(spentBy(a, () => cast(a, P, u('a2'), { d: dice(3, 5) }))).toBe(2)
    // 放最後面的空格再補位（第 1 格改造師、第 2 格 a3，所以是第 3 格）
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(2)).toMatchObject({ hp: { now: 3 + 5 + 3 }, slot: 3 })
    expect(a.ally(2).ap.now).toBe(0)
    // 每場一次
    knockDown(a, 'a3')
    expect(reasonOf(() => cast(a, P, u('a3')))).toEqual(['這一場已經用過了。'])
  })

  it('倒下的隊友要相鄰；不相鄰的灰掉並寫出原因；餘韻疊滿過載昏過去的人選不了，原因寫出來', () => {
    const g = play([P])
    const run = new BattleRun(g.k, g.state, g.state.battle!)
    run.damage(unit(g, 'a3'), 999, 'physical', unit(g, 'f1'))
    // 站第 3 格的 a3：和第 1 格的改造師不相鄰（倒下的人的格子留著不動）
    turnTo(g, 'a1')
    expect(opt(g, P).targets.map((t) => [t.target, t.blocks])).toEqual([[{ unit: 'a3' }, ['喬不在相鄰的格子，只能對相鄰倒下的隊友用。']]])
    // a2 因為餘韻疊滿再過載而昏過去
    unit(g, 'a2').layers = unit(g, 'a2').layersMax
    run.addLoad(unit(g, 'a2'), 999, unit(g, 'f1'))
    expect(unit(g, 'a2').out).toBe('burnout')
    turnTo(g, 'a1')
    const t2 = opt(g, P).targets.find((t) => 'unit' in t.target && t.target.unit === 'a2')!
    expect(t2.blocks).toEqual(['你是餘韻疊滿再過載才昏過去的，不是因為生命值歸零倒下，這一招拉不回來。'.replace('你', unit(g, 'a2').name)])
    expect(tryAct(g, { action: P, target: { unit: 'a2' } })).toEqual(t2.blocks)
    expect(unit(g, 'a2').out).toBe('burnout')
  })
})

describe('急凍：隊友過載時照樣多一層餘韻、但下一回合照常行動', () => {
  const F = ID('flash_freeze')
  const lost = (a: Arena, id: string): boolean => a.ally(Number(id.slice(1))).statuses.some((s) => s.id === LOSE_TURN)

  it('照樣得到一層餘韻、不失去回合；從行動點扣 1；每場一次，用完之後再過載照常失去回合', () => {
    const a = world([F])
    const run = a.run()
    run.addLoad(a.ally(2), 999, a.foe(1))
    expect(a.ally(2).layers).toBe(1)
    expect(lost(a, 'a2')).toBe(false)
    expect(a.ally(1).ap.now).toBe(19)
    expect(fired(run, F)).toBe(1)
    run.addLoad(a.ally(3), 999, a.foe(1))
    expect(a.ally(3).layers).toBe(1)
    expect(lost(a, 'a3')).toBe(true)
    expect(a.ally(1).ap.now).toBe(19)
  })

  it('行動點不夠不觸發；改造師自己過載不算（任何一格的「隊友」）', () => {
    const none = world([F], { unit: { ap: { now: 0, max: 20, regen: 3 } } })
    none.run().addLoad(none.ally(2), 999, none.foe(1))
    expect(lost(none, 'a2')).toBe(true)
    const self = world([F])
    self.run().addLoad(self.ally(1), 999, self.foe(1))
    expect(lost(self, 'a1')).toBe(true)
  })
})

describe('還不准睡：隊友即將倒下時停在生命 1、留在場上；餘韻疊滿再過載時感載停在上限 −1', () => {
  const N = ID('not_sleep_yet')

  it('生命歸零：停在生命 1、留在場上，從行動點扣 1；每場一次，之後的人照樣倒下', () => {
    const a = world([N])
    const run = a.run()
    run.damage(a.ally(2), 999, 'physical', a.foe(1))
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(2).hp!.now).toBe(1)
    expect(a.ally(1).ap.now).toBe(19)
    expect(fired(run, N)).toBe(1)
    run.damage(a.ally(3), 999, 'physical', a.foe(1))
    expect(a.ally(3).out).toBe('down')
  })

  it('餘韻疊滿再過載：留在戰鬥裡，感載停在上限 −1、餘韻不再疊', () => {
    const a = world([N])
    a.ally(2).layers = a.ally(2).layersMax
    a.run().addLoad(a.ally(2), 999, a.foe(1))
    expect(a.ally(2).out).toBeUndefined()
    expect(a.ally(2).layers).toBe(a.ally(2).layersMax)
    expect(a.ally(2).load!.now).toBe(a.ally(2).load!.max - 1)
    expect(a.ally(2).statuses.map((s) => s.id)).not.toContain(LOSE_TURN)
  })

  it('被制伏、投降不在清單裡：不擋；行動點不夠不擋；敵人的人不吃', () => {
    const a = world([N])
    expect(a.run().setOut(a.ally(2), 'subdued')).toBe(true)
    const none = world([N], { unit: { ap: { now: 0, max: 20, regen: 3 } } })
    none.run().damage(none.ally(2), 999, 'physical', none.foe(1))
    expect(none.ally(2).out).toBe('down')
    const foes = world([N])
    foes.run().damage(foes.foe(1), 999, 'physical', foes.ally(1))
    expect(foes.foe(1).out).toBe('down')
  })
})

describe('戰地手術：處理一個重創（重的降成輕的、輕的解除）並回 2d6；卸下記在 unit.ext', () => {
  const FS = ID('field_surgery')

  it('選的那個部位：重的降成輕的，輕的解除；回 2d6；花 3 點', () => {
    const a = world([FS])
    const me = a.ally(2)
    hurt(a, 'a2', 10)
    me.wounds = { limb: 2, head: 1 }
    a.run().applyStatus(me, 'limb_hurt', { data: { hit: -4 } })
    a.run().applyStatus(me, 'dazed')
    expect(spentBy(a, () => cast(a, FS, u('a2'), { pick: { choice: 'limb' }, d: dice(2, 3) }))).toBe(3)
    expect(me.wounds).toEqual({ limb: 1, head: 1 })
    expect(me.hp!.now).toBe(15)
    cast(a, FS, u('a2'), { pick: { choice: 'head' }, d: dice(1, 1) })
    expect(me.wounds).toEqual({ limb: 1 })
    expect(me.statuses.map((s) => s.id)).not.toContain('dazed')
    cast(a, FS, u('a2'), { pick: { choice: 'limb' } })
    expect(me.wounds).toEqual({})
    expect(me.statuses.map((s) => s.id)).not.toContain('limb_hurt')
  })

  it('一定要選處理哪個部位', () => {
    const g = play([FS])
    turnTo(g, 'a1')
    expect(opt(g, FS).picks.map((p) => [p.key, p.required, p.options.map((o) => o.value)])).toEqual([['choice', true, ['limb', 'head', 'torso', 'bridge']]])
    expect(tryAct(g, { action: FS, target: { unit: 'a2' } })).toEqual(['要選用法。'])
  })

  it('主刀：相鄰一格的隊友受到重創時，重的那一級改成輕的（自己、不相鄰的照舊）', () => {
    const woundOf = (ids: string[], id: string): number | undefined => {
      const a = world(ids)
      const me = a.ally(Number(id.slice(1)))
      me.wounds = { limb: 1 }
      a.k.battle.emit('wound', { run: a.run(), attacker: a.foe(1), target: me, aimed: false, part: 'limb' })
      return me.wounds.limb
    }
    expect(woundOf([], 'a2')).toBe(2)
    expect(woundOf([ID('chief_surgeon')], 'a2')).toBe(1)
    expect(woundOf([ID('chief_surgeon')], 'a3')).toBe(2)
    expect(woundOf([ID('chief_surgeon')], 'a1')).toBe(2)
  })
})

describe('卸下：到戰鬥結束都失效；被拆下的記在 unit.ext.implants_gone，結束的報告多一行', () => {
  const T = ID('take_off')

  it('命中：目標一件義體到戰鬥結束都失效（不會在他的回合結束時恢復），標記成被拆下；沒過什麼都不發生', () => {
    const fail = world([T])
    cast(fail, T, u('f1'), { d: dice(1) })
    expect(fail.foe(1).statuses).toEqual([])
    expect(fail.foe(1).ext.implants_gone).toBeUndefined()
    const a = world([T])
    expect(spentBy(a, () => cast(a, T, u('f1'), { d: dice(20) }))).toBe(3)
    expect(a.foe(1).statuses[0]).toMatchObject({ id: 'off_limb', until: { at: 'battle_end' } })
    expect(a.foe(1).ext.implants_gone).toEqual([0])
    expect(textOf(a.run())).toBe('')
    const run = a.run()
    for (let i = 0; i < 12; i++) advance(run)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_limb'])
    // 每場一次
    expect(reasonOf(() => cast(a, T, u('f1')))).toEqual(['這一場已經用過了。'])
  })

  it('被拆下的那一件不會再被挑中：另一個技能（拆解）下一次拆的是別件；再拆卸下也是別件', () => {
    const a = world([T, ID('dismantle')], { unit: { uses: {} } })
    cast(a, T, u('f1'), { d: dice(20) })
    cast(a, ID('dismantle'), u('f1'), { d: dice(20) })
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_limb', 'off_eye'])
    expect(a.foe(1).ext.implants_gone).toEqual([0])
  })

  it('結束的報告多一行：卸下哪個人的哪一件（戰後算戰利品，M4 才真的拿到）', async () => {
    const g = play([T])
    unit(g, 'f1').evade = -100
    turnTo(g, 'a1')
    expect(g.battleAct({ action: T, target: { unit: 'f1' } }).status).toBe('applied')
    expect(unit(g, 'f1').ext.implants_gone).toEqual([0])
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    const end = await g.finishBattle()
    expect(end.reports[0]!.narration!.results!.filter((l) => l.startsWith('卸下'))).toEqual(['卸下：保全的義肢（戰後算戰利品，受損的二手件）'])
  })
})

// ===================================================================================================================

/** 新的回合：清掉 'turn:' 開頭的次數（核心在每個人的回合開始時做的事）。 */
const newTurn = (a: Arena, id = 'a1'): void => {
  const me = a.ally(Number(id.slice(1)))
  for (const key of Object.keys(me.uses)) if (key.startsWith('turn:')) delete me.uses[key]
  me.ap.now = me.ap.max
}

describe('巡房（姿態）：開著時每回合第一次對相鄰隊友治療不花行動點，第二次照原價', () => {
  const R = ID('rounds')
  const ids = [R, ID('first_aid')]

  it('沒開姿態：照原價；開著（開關 1 點）：戰場急救第一次 0 點，同一回合的第二次（道具）照原價；下個回合又是第一次', () => {
    const off = world(ids)
    hurt(off, 'a2', 10)
    expect(spentBy(off, () => cast(off, ID('first_aid'), u('a2')))).toBe(1)
    const a = world(ids)
    hurt(a, 'a2', 10)
    expect(spentBy(a, () => cast(a, R, null))).toBe(1)
    expect(a.ally(1).stance).toBe(R)
    expect(spentBy(a, () => cast(a, ID('first_aid'), u('a2')))).toBe(0)
    // 第二次治療（道具：替隊友 2 點）算同一個每回合次數：照原價
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(2)
    newTurn(a)
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(0)
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(2)
  })

  it('只算「對相鄰隊友」：對自己用急救不免費；沒有醫療標籤的道具不算', () => {
    const a = world(ids)
    cast(a, R, null)
    expect(spentBy(a, () => cast(a, ID('first_aid'), u('a1')))).toBe(1)
    expect(spentBy(a, () => useItem(a, 'a2', 'it_ration'))).toBe(2)
    newTurn(a)
    expect(spentBy(a, () => useItem(a, 'a2', 'it_ration'))).toBe(2)
  })

  it('關掉姿態（再按一次）就沒有減免', () => {
    const a = world(ids)
    cast(a, R, null)
    cast(a, R, null)
    expect(a.ally(1).stance).toBeUndefined()
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(2)
  })
})

describe('名醫：每回合第一次治療隊友（急救、戰場急救、排好隊喔、戰地手術）退還 1 點行動點', () => {
  const F = ID('famed_doctor')

  it('每回合第一次退還 1 點（道具、戰場急救、排好隊喔都算同一個次數）；第二次照原價；下個回合又有', () => {
    const a = world([F, ID('first_aid'), ID('line_up'), ID('field_surgery')])
    hurt(a, 'a2', 5)
    expect(spentBy(a, () => cast(a, ID('first_aid'), u('a2')))).toBe(0)
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(2)
    newTurn(a)
    expect(spentBy(a, () => useItem(a, 'a2'))).toBe(1)
    expect(spentBy(a, () => cast(a, ID('line_up'), null))).toBe(2)
    newTurn(a)
    expect(spentBy(a, () => cast(a, ID('line_up'), null))).toBe(1)
    newTurn(a)
    expect(spentBy(a, () => cast(a, ID('field_surgery'), u('a2'), { pick: { choice: 'limb' } }))).toBe(2)
  })

  it('不是治療的行動不退（呼叫別的行動、治療自己的戰場急救）', () => {
    const a = world([F, ID('first_aid'), ID('dismantle')])
    expect(spentBy(a, () => cast(a, ID('dismantle'), u('f1'), { d: dice(1) }))).toBe(2)
    expect(spentBy(a, () => cast(a, ID('first_aid'), u('a1')))).toBe(1)
  })
})

describe('呼呼不燙了、排好隊喔、戰地手術以外的支援：排感載或消餘韻、你這一格與相鄰兩格各回', () => {
  it('呼呼不燙了：二選一（排 8 點感載，或消一層餘韻）；沒有橋、沒有餘韻的人對應的選項灰掉', () => {
    const C = ID('cool_down')
    const a = world([C])
    a.ally(2).load!.now = 20
    a.ally(2).layers = 2
    cast(a, C, u('a2'), { pick: { choice: 'vent' } })
    expect(a.ally(2).load!.now).toBe(12)
    expect(a.ally(2).layers).toBe(2)
    newTurn(a)
    cast(a, C, u('a2'), { pick: { choice: 'afterglow' } })
    expect(a.ally(2).layers).toBe(1)
    expect(reasonOf(() => cast(a, C, u('a2'), { pick: { choice: 'vent' } }))).toEqual(['這一回合已經用過了。'])
    const g = play([C])
    turnTo(g, 'a1')
    const o = opt(g, C)
    expect(o.picks[0]!.options.map((x) => x.value)).toEqual(['vent', 'afterglow'])
    // 沒有餘韻的人：只能排感載（消餘韻那一項對他不適用）
    expect(tryAct(g, { action: C, target: { unit: 'a2' }, pick: { choice: 'afterglow' } })).not.toBeNull()
  })

  it('排好隊喔：你這一格與相鄰兩格的隊友各回 2d6＋醫療（每個人各擲一次），不相鄰的第三個人不回；花 2 點', () => {
    const L = ID('line_up')
    const a = world([L])
    hurt(a, 'a1', 10)
    hurt(a, 'a2', 10)
    hurt(a, 'a3', 10)
    expect(spentBy(a, () => cast(a, L, null, { d: dice(1, 2, 3, 4) }))).toBe(2)
    expect(a.ally(1).hp!.now).toBe(10 + 1 + 2 + 3)
    expect(a.ally(2).hp!.now).toBe(10 + 3 + 4 + 3)
    expect(a.ally(3).hp!.now).toBe(10)
    // 站中間：兩邊的隊友都回
    const mid = world([L], { allies: [one({ weapon: 'pistol' }, 2), medic([L]), one({ weapon: 'pistol' }, 3)] })
    for (const id of ['a1', 'a2', 'a3']) hurt(mid, id, 10)
    cast(mid, L, null, { user: 'a2', d: dice(1, 1, 1, 1, 1, 1) })
    expect([1, 2, 3].map((i) => mid.ally(i).hp!.now)).toEqual([15, 15, 15])
  })
})

describe('不痛不痛：自己或相鄰的隊友第一次進入重傷時自動打一針', () => {
  const P = ID('painless')
  /** 一個很兇的敵人：一擊把人打到重傷。 */
  const brute = () => foe('minion', { weapons: [testWeapon('pistol', 30, 0, 100)], ...quiet } as never)
  const woundedBy = (a: Arena, id: string, d = dice(10)) => {
    const run = a.run(d)
    run.attack(a.foe(1), a.ally(Number(id.slice(1))))
    return run
  }

  it('回 2d6、解除流血，到他下一回合結束前不吃重傷的 −2；不花行動點', () => {
    const base = world([], { foes: [brute(), plain()] })
    base.run().applyStatus(base.ally(2), 'bleeding')
    woundedBy(base, 'a2')
    const hpBase = base.ally(2).hp!.now
    expect(hpBase).toBeLessThan(base.ally(2).hp!.max / 2)
    const a = world([P], { foes: [brute(), plain()] })
    a.run().applyStatus(a.ally(2), 'bleeding')
    const run = woundedBy(a, 'a2')
    expect(fired(run, P)).toBe(1)
    expect(a.ally(2).hp!.now).toBeGreaterThan(hpBase)
    expect(a.ally(2).hp!.now - hpBase).toBeLessThanOrEqual(12)
    expect(a.ally(2).statuses.map((s) => s.id)).not.toContain('bleeding')
    expect(a.ally(1).ap.now).toBe(20)
    // 重傷的 −2 被抵掉：命中與檢定各 +2（還是重傷的時候）
    expect(modTotal(a, 'hit', 'a2')).toBe(2)
    expect(modTotal(a, 'save', 'a2')).toBe(2)
    expect(modTotal(base, 'hit', 'a2')).toBe(0)
    // 到他下一回合結束就沒有了
    a.k.battle.emit('turn.end', { run: a.run(), unit: a.ally(2) })
    expect(modTotal(a, 'hit', 'a2')).toBe(0)
  })

  it('每場 1 次（只有第一個進入重傷的人）；不相鄰的隊友不在範圍裡；自己也算（near）', () => {
    const a = world([P], { foes: [brute(), plain()] })
    woundedBy(a, 'a2')
    const run = woundedBy(a, 'a1')
    expect(fired(run, P)).toBe(0)
    const far = world([P], { foes: [brute(), plain()] })
    expect(fired(woundedBy(far, 'a3'), P)).toBe(0)
    const self = world([P], { foes: [brute(), plain()] })
    expect(fired(woundedBy(self, 'a1'), P)).toBe(1)
  })
})

// ===================================================================================================================

describe('找縫、短路：用義體學打一次近戰（傷害照武器）', () => {
  const G = ID('find_gap')
  /** 刀的傷害固定：3d6 擲 1 加上 flat 10；目標護甲 5。 */
  const sword = { weapons: [testWeapon('knife', 6, 0, 10)] }
  const target = (o: Rec = {}) => cyborg({ armor: 5, evade: 0, ...o })
  const damageOf = (ids: string[], o: Rec = {}): number => {
    const a = world(ids, { unit: sword, foes: [target(o), plain()] })
    const before = a.foe(1).hp!.now
    cast(a, G, u('f1'), { d: dice(10) })
    return before - a.foe(1).hp!.now
  }

  it('無視目標 2 點護甲；目標身上已經有一件被干擾的義體時改成無視 4 點', () => {
    const base = damageOf([G])
    const off = world([G], { unit: sword, foes: [target(), plain()] })
    off.run().implantStatus(off.foe(1), 'off', {})
    const before = off.foe(1).hp!.now
    cast(off, G, u('f1'), { d: dice(10) })
    expect(before - off.foe(1).hp!.now).toBe(base + 2)
    // 沒有被干擾的對照：刀本身無視 1、找縫加 2，所以護甲 5 的目標吃到傷害的樣子（要害多一顆骰，所以不寫死數字）
    expect(base).toBeGreaterThan(10)
  })

  it('義體學當成命中的屬性與基本功（明細多一項，數字是和刀本來那一組的差）；要拿近戰的武器、目標要在近身的距離', () => {
    const a = world([G], { unit: sword, foes: [target(), plain()] })
    const run = cast(a, G, u('f1'), { d: dice(10) })
    const roll = run.beats.find((b) => b.roll)!.roll!
    // 科技 14（+2）＋義體學 3，對刀本來的身體 10（0）＋格鬥 2
    expect(roll.parts.some((p) => p.value === 2 + 3 - (0 + 2))).toBe(true)
    const gun = play([G], { unit: { weapon: 'pistol' } })
    turnTo(gun, 'a1')
    expect(opt(gun, G).blocks).toEqual(['手上要拿著melee類的武器才能用。'])
    const far = play([G], { foes: [plain(), cyborg()] })
    turnTo(far, 'a1')
    expect(opt(far, G).targets[1]!.blocks).toEqual(['目標要在近身的距離（雙方都站第 1 格），現在距離 2。'])
  })

  it('短路：傷害照武器並改成電磁（不看護甲）；命中而且目標有義體才暈眩；沒有義體只有電磁傷害', () => {
    const S = ID('short_circuit')
    const hitBy = (foes: unknown[]) => {
      const a = world([S], { unit: sword, foes })
      const before = a.foe(1).hp!.now
      const run = cast(a, S, u('f1'), { d: dice(10) })
      return { a, dealt: before - a.foe(1).hp!.now, run }
    }
    const withImplant = hitBy([target(), plain()])
    expect(withImplant.dealt).toBeGreaterThan(0)
    expect(withImplant.a.foe(1).statuses.map((s) => s.id)).toContain('dazed')
    // 電磁不看護甲：護甲 5 沒有扣
    expect(withImplant.dealt).toBeGreaterThanOrEqual(13 - 3 - 3)
    const bare = hitBy([plain({ armor: 5, evade: 0 }), plain()])
    expect(bare.dealt).toBeGreaterThan(0)
    expect(bare.a.foe(1).statuses.map((s) => s.id)).not.toContain('dazed')
    // 沒打中（自然 1）：沒有傷害也沒有暈眩
    const a = world([S], { unit: sword, foes: [target(), plain()] })
    cast(a, S, u('f1'), { d: dice(1) })
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    expect(a.foe(1).statuses).toEqual([])
  })
})

describe('拆光、手手拿開', () => {
  it('拆光：命中時目標失去下一個回合，而且身上兩件義體到戰鬥結束都失效；沒過什麼都不發生', () => {
    const X = ID('strip_all')
    const a = world([X])
    expect(spentBy(a, () => cast(a, X, u('f1'), { d: dice(20) }))).toBe(3)
    expect(a.foe(1).statuses.map((s) => s.id).sort()).toEqual([LOSE_TURN, 'off_eye', 'off_limb'].sort())
    expect(a.foe(1).ext.implants_gone).toEqual([0, 1])
    expect(a.foe(1).statuses.filter((s) => s.id.startsWith('off_')).every((s) => s.until.at === 'battle_end')).toBe(true)
    const fail = world([X])
    cast(fail, X, u('f1'), { d: dice(1) })
    expect(fail.foe(1).statuses).toEqual([])
    expect(reasonOf(() => cast(a, X, u('f1')))).toEqual(['這一場已經用過了。'])
  })

  it('手手拿開：近身的敵人攻擊你或相鄰的隊友之後，扣 1 點行動點反擊：命中時那件義體失效兩回合，並且被推後一格；每回合一次', () => {
    const H = ID('hands_off')
    const a = world([H])
    // 攻擊擲 1 顆 d20、3 顆 d6（失手也擲傷害骰），然後是反擊的檢定
    const run = a.run(dice(1, 1, 1, 1, 20))
    run.attack(a.foe(1), a.ally(2))
    expect(fired(run, H)).toBe(1)
    expect(a.ally(1).ap.now).toBe(19)
    expect(a.foe(1).statuses[0]).toMatchObject({ id: 'off_limb', until: { at: 'turn_end', of: 'f1', turns: 2 } })
    expect(a.foe(1).slot).toBe(2)
    // 同一回合第二次不再反擊
    run.attack(a.foe(2), a.ally(2))
    expect(fired(run, H)).toBe(1)
    // 反擊沒打中：義體沒有失效、也沒有被推
    const miss = world([H])
    miss.run(dice(1, 1, 1, 1, 1)).attack(miss.foe(1), miss.ally(1))
    expect(miss.foe(1).statuses).toEqual([])
    expect(miss.foe(1).slot).toBe(1)
  })

  it('手手拿開：遠距離的攻擊（不是近戰）不觸發；不相鄰的隊友被打不觸發；行動點不夠不觸發', () => {
    const H = ID('hands_off')
    const gunner = world([H], { foes: [foe('minion', { weapon: 'pistol', implants: IMPLANTS, ...quiet } as never), plain()] })
    const r1 = gunner.run(dice(1, 1, 1, 1, 20))
    r1.attack(gunner.foe(1), gunner.ally(2))
    expect(fired(r1, H)).toBe(0)
    const far = world([H])
    const r2 = far.run(dice(1, 1, 1, 1, 20))
    r2.attack(far.foe(1), far.ally(3))
    expect(fired(r2, H)).toBe(0)
    const none = world([H], { unit: { ap: { now: 0, max: 20, regen: 3 } } })
    const r3 = none.run(dice(1, 1, 1, 1, 20))
    r3.attack(none.foe(1), none.ally(2))
    expect(fired(r3, H)).toBe(0)
  })
})

describe('極限超頻、全面翻修', () => {
  const E = ID('extreme_overclock')

  it('極限超頻：三回合每回合多回 1 點行動點、命中 +1，結束時多一層餘韻；每場一次', () => {
    const a = world([E])
    expect(spentBy(a, () => cast(a, E, u('a2')))).toBe(1)
    const me = a.ally(2)
    expect(modTotal(a, 'ap_regen', 'a2')).toBe(1)
    expect(modTotal(a, 'hit', 'a2')).toBe(1)
    // 每個回合開始多回 1 點（行動點 0、上限 5、每回合回 3）
    me.ap.now = 0
    me.ap.max = 5
    me.uses.turns = 1
    beginTurn(a.run(), me)
    expect(me.ap.now).toBe(4)
    // 他的第 1、2 個回合結束：還在；第 3 個結束：結束，餘韻 +1
    const run = a.run()
    const endTurn = () => a.k.battle.emit('turn.end', { run, unit: me })
    endTurn()
    endTurn()
    expect(modTotal(a, 'ap_regen', 'a2')).toBe(1)
    expect(me.layers).toBe(0)
    endTurn()
    expect(modTotal(a, 'ap_regen', 'a2')).toBe(0)
    expect(me.layers).toBe(1)
    expect(reasonOf(() => cast(a, E, u('a2')))).toEqual(['這一場已經用過了。'])
  })

  it('極限超頻給自己：目前這個回合的結束不算（turns 照寫 3，不必多算），所以是四次回合結束', () => {
    const a = world([E])
    // 他自己的回合正在進行（buff 的略過看 run.skipsOwnTurnEnd）
    a.battle.order = ['a1', ...a.battle.order.filter((id) => id !== 'a1')]
    delete a.battle.acting
    a.battle.turn = 0
    beginTurn(a.run(), a.ally(1))
    cast(a, E, u('a1'))
    const run = a.run()
    const me = a.ally(1)
    for (let i = 0; i < 3; i++) a.k.battle.emit('turn.end', { run, unit: me })
    expect(modTotal(a, 'ap_regen', 'a1')).toBe(1)
    a.k.battle.emit('turn.end', { run, unit: me })
    expect(modTotal(a, 'ap_regen', 'a1')).toBe(0)
    expect(me.layers).toBe(1)
  })

  it('全面翻修：重傷的人生命至少回到上限的一半（近似：一步一步回到不是重傷為止），清掉所有重創，消兩層餘韻；每場一次', () => {
    const O = ID('overhaul')
    const a = world([O])
    const me = a.ally(2)
    hurt(a, 'a2', 5)
    me.wounds = { limb: 2, head: 1 }
    me.layers = 2
    a.run().applyStatus(me, 'dazed')
    expect(spentBy(a, () => cast(a, O, u('a2')))).toBe(2)
    expect(me.hp!.now).toBeGreaterThanOrEqual(me.hp!.max / 2)
    expect(me.hp!.now).toBeLessThan(me.hp!.max / 2 + 8)
    expect(me.wounds).toEqual({})
    expect(me.layers).toBe(0)
    expect(me.statuses.map((s) => s.id)).not.toContain('dazed')
    expect(reasonOf(() => cast(a, O, u('a2')))).toEqual(['這一場已經用過了。'])
  })

  it('全面翻修：已經超過一半的再回 2d6；餘韻只有一層就消到 0', () => {
    const O = ID('overhaul')
    const a = world([O])
    hurt(a, 'a2', 30)
    a.ally(2).layers = 1
    cast(a, O, u('a2'), { d: dice(3, 4) })
    expect(a.ally(2).hp!.now).toBe(37)
    expect(a.ally(2).layers).toBe(0)
  })
})

describe('手術刀的近戰：對有義體的目標可以用義體學代替格鬥；解鎖匠對有義體的敵人近戰命中 +1', () => {
  const hitMods = (ids: string[], o: WorldOpts, target = 'f1') => modTotal(world(ids, o), 'hit', 'a1', [], target)

  it('數字是義體學那一組比格鬥那一組多的部分（屬性也算）；沒有比較高就不加；對沒有義體的目標、拿槍時沒有', () => {
    const S = ID('scalpel')
    // 科技 14（+2）＋義體學 3，對身體 10（0）＋格鬥 2
    expect(hitMods([S], {})).toBe(3)
    expect(hitMods([S], {}, 'f2')).toBe(0)
    expect(hitMods([S], { weapon: 'pistol' })).toBe(0)
    expect(hitMods([S], { unit: { skills: { medicine: 3, cyberware: 0, brawl: 2 }, attrs: { ...ATTRS, tech: 8 } } })).toBe(0)
  })

  it('解鎖匠：對有義體的敵人近戰命中 +1（沒有義體、拿槍的不算），和手術刀疊加', () => {
    const L = ID('locksmith')
    expect(hitMods([L], {})).toBe(1)
    expect(hitMods([L], {}, 'f2')).toBe(0)
    expect(hitMods([L], { weapon: 'pistol' })).toBe(0)
    expect(hitMods([L, ID('scalpel')], {})).toBe(4)
  })
})

describe('共鳴：醫療檢定、換位、感載上限、生命上限', () => {
  it('2 階：每場第一次換位不花行動點；4 階：感載上限 +4；5 階：生命上限 +5（現在的生命跟著加）；3 階：醫療檢定 +2（帶 medicine 標籤的檢定）', () => {
    const at = (tier: number) => world([ID('scalpel')], { tier })
    const base = at(1).ally(1)
    expect(at(4).ally(1).load!.max).toBe(base.load!.max + 4)
    expect(at(3).ally(1).load!.max).toBe(base.load!.max)
    expect(at(5).ally(1).hp!.max).toBe(base.hp!.max + 5)
    expect(at(5).ally(1).hp!.now).toBe(base.hp!.now + 5)
    expect(at(4).ally(1).hp!.max).toBe(base.hp!.max)
    expect(modTotal(at(3), 'save', 'a1', ['medicine'])).toBe(2)
    expect(modTotal(at(2), 'save', 'a1', ['medicine'])).toBe(0)
    expect(modTotal(at(3), 'save', 'a1', ['hack'])).toBe(0)
    const m = at(2)
    expect(sum(m.run().mods('move_ap', m.ally(1)))).toBe(-1)
    expect(m.k.battle.getAction('move')!.cost(m.run(), m.ally(1)).ap).toBe(0)
    expect(at(1).k.battle.getAction('move')!.cost(at(1).run(), at(1).ally(1)).ap).toBe(1)
  })
})

// ===================================================================================================================

describe('邊角：to 不會把便宜的行動變貴、take 的挑法、其他種類的超頻、行動的標籤', () => {
  it('action_ap 的 to 只往下改：原價比它少（或一樣）的行動不動，行動點不會因為它變多', () => {
    const a = world([ID('scalpel')])
    const ask = (base: number) => sum(a.run().mods('action_ap', a.ally(1), undefined, undefined, ['item', 'item:medical', 'other'], base))
    expect([ask(3), ask(2), ask(1), ask(0)]).toEqual([-2, -1, 0, 0])
    // 沒有問原價（不是問花費）時不動
    expect(sum(a.run().mods('action_ap', a.ally(1), undefined, undefined, ['item:medical']))).toBe(0)
  })

  it('implant 的 take：pick.implant 指定第幾件；指定的已經被拆下就換別件；沒有義體、全部拆光之後 ok 是 false', () => {
    const a = world([])
    const run = a.run()
    const take = (pick?: Rec) => run.effects([{ op: 'implant', mode: 'off', take: true }], { user: a.ally(1), target: u('f1'), source: { kind: 'ability', id: 'x', name: 'x' }, ...(pick ? { pick } : {}) })
    expect(take({ implant: 2 }).ok).toBe(true)
    expect(a.foe(1).ext.implants_gone).toEqual([2])
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['off_generic'])
    // 指定的是已經拆下的第 2 件：改拆第 1 件（還沒失效的）
    expect(take({ implant: 2 }).ok).toBe(true)
    expect(a.foe(1).ext.implants_gone).toEqual([2, 0])
    expect(take().ok).toBe(true)
    expect(a.foe(1).ext.implants_gone).toEqual([2, 0, 1])
    expect(take().ok).toBe(false)
    expect(a.foe(1).ext.implants_gone).toEqual([2, 0, 1])
    // 沒有義體的人
    expect(run.effects([{ op: 'implant', mode: 'off', take: true }], { user: a.ally(1), target: u('f2'), source: { kind: 'ability', id: 'x', name: 'x' } }).ok).toBe(false)
    expect(a.foe(2).ext.implants_gone).toBeUndefined()
    // 同種類的兩件共用同一個狀態（核心的規定）：第二件拆下時還是標記，狀態是同一個
    const two = world([], { foes: [cyborg({ implants: [{ kind: 'limb', name: '左義肢' }, { kind: 'limb', name: '右義肢' }] }), plain()] })
    const r2 = two.run()
    for (let i = 0; i < 2; i++) r2.effects([{ op: 'implant', mode: 'off', take: true }], { user: two.ally(1), target: u('f1'), source: { kind: 'ability', id: 'x', name: 'x' } })
    expect(two.foe(1).ext.implants_gone).toEqual([0, 1])
    expect(two.foe(1).statuses.map((s) => s.id)).toEqual(['off_limb'])
  })

  it('義眼等沒有命中加值的超頻（boost_generic）不被攻擊用掉，照樣到回合結束；結束時一樣 +4 感載', () => {
    const O = ID('overclock')
    const a = world([O], { allies: [medic([O]), one({ weapon: 'pistol', implants: [{ kind: 'eye', name: '義眼' }] }, 2), one({ weapon: 'pistol' }, 3)] })
    cast(a, O, u('a2'))
    expect(a.ally(2).statuses.map((s) => s.id)).toEqual(['boost_generic'])
    a.run(dice(10, 1, 1, 1)).attack(a.ally(2), a.foe(1))
    expect(a.ally(2).statuses.map((s) => s.id)).toEqual(['boost_generic'])
    a.k.battle.emit('turn.end', { run: a.run(), unit: a.ally(2) })
    expect(a.ally(2).load!.now).toBe(4)
  })

  it('action_tags：技能的行動多帶的標籤（heal、other）；沒寫的不帶', () => {
    const a = world(ALL)
    const tags = (id: string) => a.k.battle.getAction(id)!.tags
    expect(tags(ID('first_aid'))).toEqual(['heal'])
    expect(tags(ID('line_up'))).toEqual(['heal', 'other'])
    expect(tags(ID('dismantle'))).toBeUndefined()
  })

  it('共鳴的 hp_max 不能是 0、要是整數', () => {
    const tree = (hp_max: unknown) => ({ ...TREE, resonance: [{ tier: 1, cells: 1, text: '壞的。', effect: { hp_max } }] })
    for (const bad of [0, 1.5, 'x']) expect(() => makeGame({ features: FEATURES, content: [{ ...PACK, content: { ...PACK.content, path: [tree(bad)] } } as unknown as ContentPack] })).toThrow(/hp_max/)
    expect(() => makeGame({ features: FEATURES, content: [{ ...PACK, content: { ...PACK.content, path: [tree(-3)] } } as unknown as ContentPack] })).not.toThrow()
  })

  it('整棵樹裝著、由程式代打（AI 不會用技能，但被動與反應照樣算）打完一場：沒有丟錯、結果分得出來、提交的不變式成立', async () => {
    const g = makeBattleGame({
      features: FEATURES, content: [PACK], seed: 11,
      battle: duel([medic(ALL, { unit: { implants: IMPLANTS } }), ...mates()], [cyborg({ ap: { now: 4, max: 4, regen: 3 } }), foe('minion', { weapon: 'knife' } as never)]),
    }).game
    const { result, violations } = await observed(g, () => playOut(g))
    expect(['win', 'lose']).toContain(result.outcome)
    expect(violations).toEqual([])
  })
})
