// 驗收測試：dev/work/M1b-skill-social.md（cpp-feature）。名媛「入戲」這棵樹在現實戰鬥的機制：面具（第一回合不被當成目標）、誘惑攻擊
// （檢定加快感傷害）、替身、眾生相、欺負人家要賠喔、幾個姿態與被動；以及這棵樹二十七個技能與共鳴用假資料寫得出來、動得起來。
// 主播與偶像兩棵樹只檢查「學得到、裝得上、在現實沒有任何效果」。
// 開打前的事（偽裝與被識破的難度、面具抵消豔名、讀人、假身分、蜜罐、頂替；滲透與豔名在 M2）不做（dev/adr/0015 E13），那幾個技能的現實欄留 pending 或 null。
// 規格：SKILL_TREES「名媛：入戲」整節（現實欄與共鳴表）；COMBAT_SYSTEM 第 11 節（名媛、主播、偶像三列）；SKILLS 1.6 節、第 13 節；
// dev/adr/0015 E8（誘惑攻擊）、E13。內容一律是測試自帶的假資料（名字與數字照設計書），不讀 engine/data。

import { describe, expect, it } from 'vitest'
import type { BattleActionOption, BattleInput, BattleSetup, BattleTarget, BattleUnit, ContentPack } from '../../src'
import { BattleBlocked, BattleRun, LOSE_TURN, MOD_KINDS, aiStep, battleAct, beginTurn, clone, performAction, readyFeatures, targetWeight } from '../../src'
import { abilitiesFeature, abilitiesOf, capacityOf, equipAbilities, learn, prep, prepBlock } from '../../src/features/abilities'
import { FEATURE_MOD_KINDS } from '../../src/features/abilities/types'
import { combatFeature } from '../../src/features/combat'
import { makeBattleGame, makeGame } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature]

// ===================================================================================================================
// 假資料：名媛「入戲」整棵樹（id 照 sk_socialite_<英文名>；cpp-data 照這份改寫）。現實欄照 SKILL_TREES 的文字。
// ===================================================================================================================

const TREE = {
  id: 'socialite', name: '名媛', tree: '名媛：入戲', category: 'social', signature: 'sk_socialite_in_character', domains: { meat: 'weak', net: 'mid', opinion: 'mid' },
  resonance: [
    // 1 階：誘惑與表演的檢定 +2（戰鬥裡只有誘惑攻擊的檢定，帶 tease 標籤）
    { tier: 1, cells: 1, text: '誘惑與表演的檢定 +2。', effect: { mods: [{ kind: 'save', value: 2, tags: ['tease'] }] } },
    { tier: 2, cells: 1, text: '感載上限 +4。', effect: { load_max: 4 } },
    { tier: 3, cells: 1, text: '每場戰鬥第一次換位不花行動點（現實與內海）。', effect: { free_move: { per_fight: 1 } } },
    // 4 階：輿論戰開場的手牌多 1 張：現實沒有效果
    { tier: 4, cells: 1, text: '輿論戰開場的手牌多 1 張。' },
    { tier: 5, cells: 1, text: '誘惑攻擊的命中 +1（現實與內海）。', effect: { mods: [{ kind: 'tease_hit', value: 1 }] } },
  ],
}

/** 技能的七個欄位之外都一樣：名媛樹、社交型、前置照給。 */
const sk = (id: string, name: string, tier: number, layer: 'signature' | 'front' | 'back', kind: string, cap: number, after: string | undefined, more: Rec = {}): Rec => ({
  id, name, path: 'socialite', category: 'social', tier, layer, kind, cap, xp: tier * 20, cells: 1, ...(layer === 'signature' ? {} : { after }), text: `${name}。`, net: null, opinion: null, meat: null, ...more,
})
const ID = (name: string): string => `sk_socialite_${name}`
/** 誘惑攻擊的消耗：2 行、每回合 1 次、同一組（SKILL_TREES 入戲：看這邊♡、不要走嘛、銷魂、暈乎乎「算在誘惑攻擊每回合 1 次裡」）。 */
const TEASE_USE = { ap: 2, per_turn: 1, group: 'tease' }
const BASE_TEASE = ID('in_character') + '.tease'

const SOCIALITE: Rec[] = [
  // ---- 1 階 ----
  // 入戲（被動）：戴著面具，第一回合敵人不以她為目標；整場都能用誘惑攻擊（2 行、每回合 1 次）。「面具抵消豔名」要豔名（M2）：沒有寫
  sk(ID('in_character'), '入戲', 1, 'signature', 'passive', 3, undefined, { meat: { mask: { rounds: 1 }, tease: {} } }),
  sk(ID('look_here'), '看這邊♡', 1, 'front', 'active', 1, ID('in_character'), { use: TEASE_USE, meat: { tease: { hit: 1 } } }),
  // 替身（反應）：只在第一回合，第一次被命中時這一擊打在全息替身上，不受傷害，換到相鄰的一格
  sk(ID('stand_in'), '替身', 1, 'front', 'reaction', 1, ID('in_character'), {
    use: { ap: 0, per_fight: 1, first_round: true },
    meat: { trigger: { on: 'hit', who: 'self' }, react: { negate: true, then_move: true } },
  }),
  // 讀人（預備）：效果是「對他」的誘惑攻擊命中 +2、誘惑與交涉檢定 +2，要知道「他」是誰（名冊與傾向，M2）：還沒有可以帶進戰鬥的效果
  sk(ID('read_people'), '讀人', 1, 'front', 'prep', 1, ID('in_character'), { use: { slot: 1 }, meat: { pending: true }, prep: { slot: 1, scope: 'next_battle', text: '觀察一個人，知道他傾向裡的一個標籤。' } }),
  // 戳戳你：對距離 2 以內有橋的敵人灌 4 點快感感載，不擲骰；第一回合 8 點
  sk(ID('poke'), '戳戳你', 1, 'back', 'active', 1, ID('look_here'), {
    use: { ap: 1, per_turn: 1 },
    meat: {
      target: 'enemy', needs: { bridged: true }, range: [1, 2],
      do: [{ op: 'load', amount: 4, type: 'pleasure', exact: true, if: 'not_first_round' }, { op: 'load', amount: 8, type: 'pleasure', exact: true, if: 'first_round' }],
    },
  }),
  // 我很清醒喔：抵抗控制類快駭的檢定 +2
  sk(ID('sober'), '我很清醒喔', 1, 'back', 'passive', 2, ID('stand_in'), { meat: { mods: [{ kind: 'firewall', value: 2, tags: ['hack:control'] }] } }),
  // 跟我說嘛：只在第一回合，距離 2 以內有橋的敵人，交涉對 10＋他的 mod(意志)＋定力；過了標記到她的下一回合（全隊打他命中 +2）
  sk(ID('tell_me'), '跟我說嘛', 1, 'back', 'active', 1, ID('read_people'), {
    use: { meat: { ap: 1, first_round: true } },
    meat: {
      target: 'enemy', needs: { bridged: true }, range: [1, 2],
      do: [{ op: 'check', attr: 'charm', skill: 'negotiate', vs: 'will', tags: ['negotiate'], label: '交涉' }, { op: 'status', status: 'marked', if: 'ok' }],
    },
  }),
  // ---- 2 階 ----
  // 不要走嘛：誘惑攻擊；命中的話，到目標下一回合結束前，他攻擊她的命中 −2（掛在目標身上、只對她有效）
  sk(ID('stay'), '不要走嘛', 2, 'front', 'active', 1, ID('look_here'), {
    use: TEASE_USE,
    meat: { tease: { on_ok: [{ op: 'buff', id: 'stay', name: '不要走嘛', turns: 1, until: 'own_turn_end', mods: [{ kind: 'hit', value: -2, vs_source: true }] }] } },
  }),
  // 偽裝（姿態）：開著，第一回合的第一次攻擊命中 +2。「戰鬥之前的滲透」（過門禁與盤問）是 M2：沒有寫
  sk(ID('disguise'), '偽裝', 2, 'front', 'stance', 1, ID('stand_in'), { use: { ap: 1 }, meat: { mods: [{ kind: 'hit', value: 2, when: { first_round: true, first_attack: true } }] } }),
  // 假身分、蜜罐：只有輿論欄，現實是 —
  sk(ID('false_identity'), '假身分', 2, 'front', 'active', 1, ID('read_people'), { use: { ap: 0 } }),
  sk(ID('honey_pot'), '蜜罐', 2, 'back', 'active', 1, ID('false_identity'), { use: { ap: 0 } }),
  // 我演得很像吧：現實是「開打前被識破的難度 +2」，開打前的事是 M2：pending
  sk(ID('good_actor'), '我演得很像吧', 2, 'back', 'passive', 3, ID('disguise'), { meat: { pending: true } }),
  // ---- 3 階 ----
  // 媚態（姿態）：誘惑攻擊的傷害多 1d3
  sk(ID('charm_pose'), '媚態', 3, 'front', 'stance', 2, ID('stay'), { use: { ap: 1 }, meat: { mods: [{ kind: 'tease_bonus', value: '1d3' }] } }),
  // 換臉：第一回合不能用；入戲的「不被當成目標」重新生效，到她的下一回合開始為止
  sk(ID('new_face'), '換臉', 3, 'front', 'active', 2, ID('disguise'), {
    use: { ap: 1, not_first_round: true },
    meat: { target: 'self', do: [{ op: 'buff', who: 'self', id: 'new_face', name: '換臉', turns: 1, until: 'own_turn_start', mask: true }] },
  }),
  sk(ID('persuade_lace'), '說服蕾絲', 3, 'front', 'active', 2, ID('false_identity'), { use: { ap: 2, per_fight: 1 } }),
  // 銷魂：誘惑攻擊；這一下讓目標過載的話，他多疊一層餘韻
  sk(ID('swoon'), '銷魂', 3, 'back', 'active', 2, ID('charm_pose'), { use: TEASE_USE, meat: { tease: { on_overload: [{ op: 'afterglow', amount: 1 }] } } }),
  // 第二張臉：第一回合裡，打在她身上的重創改成一般的命中
  sk(ID('second_face'), '第二張臉', 3, 'back', 'passive', 4, ID('new_face'), { meat: { mods: [{ kind: 'no_wound', value: 1, when: { first_round: true } }] } }),
  // ---- 4 階 ----
  // 暈乎乎：誘惑攻擊，傷害多 1d6；第一回合用時，命中的目標同時暈眩
  sk(ID('dizzy'), '暈乎乎', 4, 'front', 'active', 2, ID('swoon'), {
    use: TEASE_USE,
    meat: { tease: { bonus: '1d6', on_ok: [{ op: 'status', status: 'dazed', if: 'first_round' }] } },
  }),
  // 入骨：第一回合迴避 +2（開打前被識破的難度 +4 是 M2：沒有寫）
  sk(ID('deep_in_role'), '入骨', 4, 'front', 'passive', 5, ID('new_face'), { meat: { mods: [{ kind: 'evade', value: 2, when: { first_round: true } }] } }),
  sk(ID('stand_in_for'), '頂替', 4, 'front', 'active', 2, ID('persuade_lace'), { use: { ap: 2 } }),
  // 欺負人家要賠喔：被距離 2 以內有橋的敵人攻擊之後，對他做一次誘惑攻擊當反擊（不算每回合那一次、每場 2 次）
  sk(ID('payback'), '欺負人家要賠喔', 4, 'back', 'reaction', 2, ID('dizzy'), {
    use: { ap: 1, per_fight: 2 },
    meat: { trigger: { on: 'after', who: 'self', by: { needs: { bridged: true }, range: [1, 2] } }, do: [{ op: 'tease', who: 'attacker' }] },
  }),
  // 千面（預備，整個副本有效）：這個副本裡的每一場現實戰鬥，入戲的「第一回合不被當成目標」延長到第二回合
  sk(ID('thousand_faces'), '千面', 4, 'back', 'prep', 2, ID('deep_in_role'), {
    use: { slot: 1 },
    prep: { slot: 1, scope: 'commission', meat: { do: [{ op: 'buff', who: 'self', id: 'thousand_faces', name: '千面', until: 'battle_end', mask: { rounds: 2 } }] } },
  }),
  // ---- 5 階 ----
  // 傾城：只在第一回合，距離 2 以內兩名有橋的目標各做一次誘惑攻擊，傷害各多 1d6
  sk(ID('city_fall'), '傾城', 5, 'front', 'active', 3, ID('dizzy'), { use: { ap: 3, per_fight: 1, first_round: true }, meat: { tease: { bonus: '1d6', targets: 2 } } }),
  // 謝幕：只在第一回合，她和一名隊友在這一回合不會被敵人當成目標
  sk(ID('curtain_call'), '謝幕', 5, 'front', 'active', 3, ID('deep_in_role'), {
    use: { ap: 2, per_fight: 1, first_round: true },
    meat: {
      target: 'ally',
      do: [
        { op: 'buff', who: 'self', id: 'curtain', name: '謝幕', turns: 1, until: 'own_turn_start', mods: [{ kind: 'ai_target_pct', value: -100, when: { first_round: true } }] },
        { op: 'buff', who: 'target', id: 'curtain', name: '謝幕', turns: 1, until: 'own_turn_start', mods: [{ kind: 'ai_target_pct', value: -100, when: { first_round: true } }] },
      ],
    },
  }),
  // 眾生相：不花行動點；只在第一回合，一名有橋的敵人把她當成他的上司，他失去這一回合（首領照控制保護）
  sk(ID('everyone'), '眾生相', 5, 'front', 'active', 3, ID('stand_in_for'), {
    use: { ap: 0, per_fight: 1, first_round: true },
    meat: { target: 'enemy', needs: { bridged: true }, do: [{ op: 'status', status: LOSE_TURN }] },
  }),
  // 繞指柔（姿態）：誘惑攻擊命中 +1，傷害多 1d3
  sk(ID('silk'), '繞指柔', 5, 'back', 'stance', 3, ID('city_fall'), { use: { ap: 1 }, meat: { mods: [{ kind: 'tease_hit', value: 1 }, { kind: 'tease_bonus', value: '1d3' }] } }),
  // 這才是真的我：感載上限 +8（pool 的 load 就是感載上限）；第一回合迴避 +1
  sk(ID('the_real_me'), '這才是真的我', 5, 'back', 'passive', 6, ID('curtain_call'), { meat: { pool: { load: { max: 8 } }, mods: [{ kind: 'evade', value: 1, when: { first_round: true } }] } }),
]
const ALL = SOCIALITE.map((a) => a.id as string)

// ---- 主播與偶像：一棵一個招牌與幾個技能，現實欄一律是 null（SKILLS 第 13 節；domains.meat 是 none）----
const MEDIA_TREE = (id: string, name: string, tree: string) => ({
  id, name, tree, category: 'media', signature: `sk_${id}_sig`, domains: { meat: 'none', net: 'mid', opinion: 'strong' },
  resonance: [{ tier: 1, cells: 1, text: '輿論戰開場的編輯點 +1。' }],
})
const media = (path: string, id: string, name: string, tier: number, layer: 'signature' | 'front' | 'back', kind: string, cap: number, after: string | undefined, more: Rec = {}): Rec => ({
  id: `sk_${path}_${id}`, name, path, category: 'media', tier, layer, kind, cap, xp: tier * 20, cells: 1, ...(layer === 'signature' ? {} : { after: `sk_${path}_${after}` }), text: `${name}。`, meat: null, net: null, opinion: null, ...more,
})
const MEDIA: Rec[] = [
  media('streamer', 'sig', '聚光燈', 1, 'signature', 'passive', 3, undefined, { opinion: { ep_max: 1 } }),
  media('streamer', 'expose', '曝光', 1, 'front', 'active', 1, 'sig', { use: { ap: 2, ram: 2 }, net: { pending: true, text: '內海的寫法還沒有做成機制（目標是敵人或節點，擲表演）。' } }),
  media('streamer', 'flood', '灌流', 2, 'front', 'active', 1, 'expose', { use: { ap: 2, ram: 2 }, net: { pending: true, text: '內海的寫法還沒有做成機制（目標是敵人或節點，擲表演）。' }, opinion: { pending: true } }),
  media('streamer', 'viral', '爆紅', 3, 'back', 'reaction', 1, 'flood', { opinion: { pending: true } }),
  media('idol', 'sig', '應援', 1, 'signature', 'passive', 3, undefined, { net: { pending: true, text: '內海的寫法還沒有做成機制（連結的人數、分擔、追蹤度）。' }, opinion: { ep_max: 1 } }),
  media('idol', 'cheer', '加油', 1, 'front', 'stance', 1, 'sig', { use: { ap: 1 }, opinion: { pending: true } }),
  media('idol', 'encore', '安可', 2, 'back', 'passive', 2, 'cheer', { net: { pending: true } }),
]
const MEDIA_IDS = MEDIA.map((a) => a.id as string)

/** 戰鬥裡的狀態：測試用的那幾個，加上重創（輕的那一級）要用的肢體受創。 */
const STATUSES = [...TEST_STATUSES, { id: 'limb_hurt', name: '肢體受創', desc: '肢體受到重創的輕的那一級：命中 −2。', mods: { hit: -2 }, until: 'battle_end', kind: 'wound' }]
const PACK: ContentPack = {
  id: 'socialite_test',
  content: { battle_status: STATUSES, path: [TREE], ability: SOCIALITE },
} as unknown as ContentPack
const MEDIA_PACK: ContentPack = {
  id: 'media_test',
  content: { battle_status: STATUSES, path: [MEDIA_TREE('streamer', '主播', '主播：聚光燈'), MEDIA_TREE('idol', '偶像', '偶像：應援')], ability: MEDIA },
} as unknown as ContentPack
/** 同一組內容，技能換成這一串。 */
const withAbilities = (ability: Rec[], path: Rec[] = [TREE]): ContentPack => ({ id: 'social_x', content: { battle_status: STATUSES, path, ability } }) as unknown as ContentPack

// ---- 場地 ----

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
/** 骰面：給的先出，之後都是 1。 */
const dice = (...v: number[]): number[] => [...v, ...Array(400).fill(1)]
const ATTRS = { body: 10, reflex: 14, tech: 10, intellect: 10, resolve: 12, charm: 14 }
const SKILLS = { seduce: 3, negotiate: 2, perform: 2, firearms: 2, composure: 1, athletics: 1 }

interface DivaOpts { tier?: number; weapon?: string; unit?: Rec }
/** 名媛：裝著指定的技能、這棵樹開到 tier 階、手上拿手槍（魅力 +2、誘惑 3、交涉 2）。 */
function diva(ids: string[], o: DivaOpts = {}): unknown {
  return one({
    actor: 'pc', weapon: o.weapon ?? 'pistol', attrs: ATTRS, skills: SKILLS, ap: { now: 20, max: 20, regen: 3 },
    ext: { abilities: { equipped: ids, tiers: { socialite: o.tier ?? 1 } } }, ...o.unit,
  } as never)
}
/** 敵人：不動（行動點 0）、有橋、意志 10（mod 0）、定力 0：誘惑攻擊的 DC 是 10。 */
const mark = (name: string, o: Rec = {}): unknown => foe('minion', { name, weapon: 'pistol', ...quiet, ...o } as never)
const mates = (): unknown[] => [one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)]

interface WorldOpts extends DivaOpts {
  allies?: unknown[]
  foes?: unknown[]
  cover?: { ally: number[]; foe: number[] }
  more?: Partial<BattleSetup>
  pack?: ContentPack
}
/** 不經過提交的場地：a1 是名媛（裝著 ids），a2、a3 是隊友；f1、f2 是不動的敵人（有橋、意志 10）。 */
function world(ids: string[], o: WorldOpts = {}): Arena {
  return arena(duel(o.allies ?? [diva(ids, o), ...mates()], o.foes ?? [mark('甲'), mark('乙')], o.cover, o.more), FEATURES, (k) => {
    k.content.loadPack(o.pack ?? PACK)
    readyFeatures(k)
  })
}
/** 一局已經開打的遊戲（走完整的 battleAct）。 */
function play(ids: string[], o: WorldOpts = {}, seed = 7) {
  return makeBattleGame({
    features: FEATURES, content: [o.pack ?? PACK], seed,
    battle: duel(o.allies ?? [diva(ids, o), ...mates()], o.foes ?? [mark('甲'), mark('乙')], o.cover, o.more),
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
/** 讓 a1（或指定的人）做一個行動，走和玩家一樣的路（performAction：花費與 action.done 都一樣）；骰面釘死。條件、目標選不選得了照行動自己宣告的查。 */
function cast(a: Arena, action: string, target: BattleTarget | null, o: { pick?: Rec; d?: number[]; user?: string; run?: BattleRun } = {}): BattleRun {
  const run = o.run ?? a.run(o.d ?? dice())
  const def = a.k.battle.getAction(action)!
  expect(def, action).toBeDefined()
  const performer = run.unit(o.user ?? 'a1')
  const input: BattleInput = { action, ...(target ? { target } : {}), ...(o.pick ? { pick: o.pick } : {}) }
  const why = [...(def.blocks?.(run, performer) ?? []), ...(target ? ((def.targets?.(run, performer) ?? []).find((t) => JSON.stringify(t.target) === JSON.stringify(target))?.blocks ?? ['這個目標不能選。']) : [])]
  if (why.length) throw new BattleBlocked(why)
  // 選項（pick）照宣告查，和玩家送出來的一樣
  for (const p of def.picks?.(run, performer) ?? []) {
    const v = o.pick?.[p.key]
    const chosen = p.options.find((x) => x.value === v)
    if (chosen?.blocks.length) throw new BattleBlocked(chosen.blocks)
  }
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
/** 某個敵人這一步打了誰。 */
const shots = (run: BattleRun, id: string) => run.beats.filter((b) => ['hit', 'miss', 'crit'].includes(b.tag ?? '') && (b.data as Rec | undefined)?.attacker === id)
/** 開了姿態（直接記在單位身上，不花行動點：姿態自己的行動另外測）。 */
const stance = (a: Arena, id: string, who = 'a1'): void => {
  a.battle.units[who]!.stance = id
}
/** 這一步的檢定（第一個有擲骰明細的拍）。 */
const rollOf = (run: BattleRun) => run.beats.find((b) => b.roll)!.roll!
const spentBy = (a: Arena, f: () => unknown): number => {
  const before = a.ally(1).ap.now
  f()
  return before - a.ally(1).ap.now
}
/** 敵人 id 對名媛（a1）的挑選權重。 */
const weight = (a: Arena, foeId = 'f1', target = 'a1'): number => targetWeight(a.run(), a.battle.units[foeId]!, a.battle.units[target]!)

// ===================================================================================================================

describe('這棵樹的二十七個技能：載得進來、格式檢查全過；現實欄寫不出來的留 pending 或 null', () => {
  it('二十七個技能與共鳴五階全部載入；種類 14 主動、6 被動、2 反應、3 姿態、2 預備；現實欄 pending 的是讀人與我演得很像吧（開打前的事，M2）', () => {
    const g = makeGame({ features: FEATURES, content: [PACK] }).game
    expect(SOCIALITE).toHaveLength(27)
    expect(g.k.content.list('ability')).toHaveLength(27)
    expect(g.k.content.checkRefs()).toEqual([])
    const count = (kind: string) => SOCIALITE.filter((a) => a.kind === kind).length
    expect([count('active'), count('passive'), count('reaction'), count('stance'), count('prep')]).toEqual([14, 6, 2, 3, 2])
    expect(g.k.content.get<{ id: string; resonance: unknown[] }>('path', 'socialite')!.resonance).toHaveLength(5)
    const pending = SOCIALITE.filter((a) => (a.meat as Rec | null)?.pending === true).map((a) => a.id)
    expect(pending).toEqual([ID('read_people'), ID('good_actor')])
    // 現實欄寫成 null 的：只有輿論或內海欄有效果的（假身分、蜜罐、說服蕾絲、頂替）、預備（千面）
    const nulls = SOCIALITE.filter((a) => a.meat === null).map((a) => a.id)
    expect(nulls).toEqual([ID('false_identity'), ID('honey_pot'), ID('persuade_lace'), ID('stand_in_for'), ID('thousand_faces')])
  })

  it('有現實欄的主動技能都註冊成行動；入戲（被動）多一個基本的「誘惑攻擊」行動；現實欄是 null 或 pending 的、反應、姿態以外的都沒有多餘的行動', () => {
    const a = world(ALL)
    const ids = a.k.battle.actionsFor('meat').map((x) => x.id)
    const has = (id: string) => ids.includes(id)
    for (const id of ['look_here', 'poke', 'tell_me', 'stay', 'new_face', 'swoon', 'dizzy', 'city_fall', 'curtain_call', 'everyone']) expect(has(ID(id)), id).toBe(true)
    expect(has(BASE_TEASE)).toBe(true)
    expect(a.k.battle.getAction(BASE_TEASE)!.name).toBe('誘惑攻擊')
    // 姿態三個
    for (const id of ['disguise', 'charm_pose', 'silk']) expect(has(ID(id)), id).toBe(true)
    // 現實欄是 null 的主動技能沒有行動
    for (const id of ['false_identity', 'honey_pot', 'persuade_lace', 'stand_in_for']) expect(has(ID(id)), id).toBe(false)
    // 反應、被動、預備不是行動
    for (const id of ['stand_in', 'payback', 'sober', 'second_face', 'deep_in_role', 'the_real_me', 'good_actor', 'read_people', 'thousand_faces']) expect(has(ID(id)), id).toBe(false)
  })

  it('格式檢查擋下寫壞的新鍵（訊息裡有那個字）：mask、tease、then_move、trigger.by、vs_source、first_attack、picks 的 needs 與 range、buff 的 mask、op tease', () => {
    const load = (meat: Rec | null, kind = 'active', extra: Rec = {}) => () =>
      makeGame({ features: FEATURES, content: [withAbilities([SOCIALITE[0]!, sk('sk_bad', '壞的', 1, 'front', kind, 1, ID('in_character'), { meat, use: { ap: 1 }, ...extra })])] })
    const ok = { target: 'enemy' as const }
    // mask：只有被動、rounds 要是 1 以上的整數
    expect(load({ mask: { rounds: 1 } })).toThrow(/meat\.mask 只有被動/)
    expect(load({ mask: { rounds: 0 } }, 'passive')).toThrow(/meat\.mask\.rounds/)
    expect(load({ mask: { rounds: 1.5 } }, 'passive')).toThrow(/meat\.mask\.rounds/)
    expect(load({ mask: { rounds: 1, until: 2 } }, 'passive')).toThrow(/until/)
    expect(load({ mask: { rounds: 2 } }, 'passive')).not.toThrow()
    // tease：欄位型別、targets 只有 1 或 2、不能和 do 一起、只有主動與被動
    expect(load({ tease: { hit: 'x' } })).toThrow(/meat\.tease\.hit/)
    expect(load({ tease: { bonus: 'x' } })).toThrow(/meat\.tease\.bonus/)
    expect(load({ tease: { bonus: '1d6', targets: 3 } })).toThrow(/meat\.tease\.targets/)
    expect(load({ tease: { on_ok: [{ op: 'nope' }] } })).toThrow(/nope/)
    expect(load({ tease: { power: 1 } })).toThrow(/power/)
    expect(load({ tease: {}, do: [{ op: 'heal', amount: 1 }] })).toThrow(/meat\.tease 不能和 do/)
    expect(load({ tease: {}, target: 'ally' })).toThrow(/target 只能是 enemy/)
    expect(load({ tease: {}, picks: [] })).toThrow(/picks/)
    expect(load({ tease: {}, trigger: { on: 'after', who: 'self' } }, 'reaction')).toThrow(/meat\.tease 只有主動技能/)
    expect(load({ tease: { bonus: '1d6', on_ok: [{ op: 'afterglow', amount: 1 }] } })).not.toThrow()
    // 效果 tease 的欄位：不認得的欄位、公式寫錯
    expect(load({ ...ok, do: [{ op: 'tease', power: 1 }] })).toThrow(/power/)
    expect(load({ ...ok, do: [{ op: 'tease', hit: '2d' }] })).toThrow(/tease\.hit/)
    expect(load({ ...ok, do: [{ op: 'tease', targets: 5 }] })).toThrow(/tease\.targets/)
    // 反應：then_move 只有 hit 的 react、要和 negate 一起；trigger.by 的格式
    const react = (r: Rec, on = 'hit', by?: unknown) => load({ trigger: { on, who: 'self', ...(by !== undefined ? { by } : {}) }, react: r }, 'reaction')
    expect(react({ then_move: true })).toThrow(/then_move 要和 negate/)
    expect(react({ negate: true, then_move: 1 })).toThrow(/then_move 只能是 true/)
    expect(react({ negate: true, then_move: true }, 'attacked')).toThrow(/then_move/)
    expect(react({ negate: true, then_move: true })).not.toThrow()
    expect(react({ negate: true }, 'hit', 5)).toThrow(/meat\.trigger\.by 要是/)
    expect(react({ negate: true }, 'hit', {})).toThrow(/by 要寫 needs 或 range/)
    expect(react({ negate: true }, 'hit', { range: [3, 1] })).toThrow(/by\.range/)
    expect(react({ negate: true }, 'hit', { needs: { bridged: 1 } })).toThrow(/bridged/)
    expect(react({ negate: true }, 'hit', { foo: 1 })).toThrow(/foo/)
    expect(react({ negate: true }, 'hit', { needs: { bridged: true }, range: [1, 2] })).not.toThrow()
    // mods：vs_source 要是 true；first_attack 只能是 true；tease_bonus 的公式可以擲骰（別的修正不行）
    const mods = (m: Rec) => load({ mods: [m] }, 'passive')
    expect(mods({ kind: 'hit', value: -2, vs_source: false })).toThrow(/vs_source/)
    expect(mods({ kind: 'hit', value: 2, when: { first_attack: false } })).toThrow(/first_attack/)
    expect(mods({ kind: 'tease_bonus', value: '1d3' })).not.toThrow()
    expect(mods({ kind: 'tease_hit', value: '1d3' })).toThrow(/不能擲骰/)
    expect(mods({ kind: 'hit', value: 2, vs_source: true, when: { first_round: true, first_attack: true } })).not.toThrow()
    // meat.when 沒有 first_attack（那是修正的條件）
    expect(load({ ...ok, when: { first_attack: true }, do: [{ op: 'heal', amount: 1 }] })).toThrow(/first_attack/)
    // picks 的 needs、range：只有 foe、ally
    const pick = (p: Rec) => load({ ...ok, picks: [{ key: 'x', label: 'x', kind: 'foe', ...p }], do: [{ op: 'heal', amount: 1 }] })
    expect(pick({ needs: { bridged: 1 } })).toThrow(/needs/)
    expect(pick({ range: [2, 1] })).toThrow(/range/)
    expect(load({ ...ok, picks: [{ key: 'x', label: 'x', kind: 'ally_slot', range: [1, 2] }], do: [{ op: 'heal', amount: 1 }] })).toThrow(/range 只有 kind 是 foe/)
    expect(pick({ needs: { bridged: true }, range: [1, 2] })).not.toThrow()
    // buff 的 mask
    const buff = (e: Rec) => load({ target: 'self', do: [{ op: 'buff', id: 'b', ...e }] })
    expect(buff({ mask: 'yes' })).toThrow(/mask/)
    expect(buff({ mask: { rounds: 0 } })).toThrow(/mask/)
    expect(buff({ mask: { until: 2 } })).toThrow(/mask/)
    expect(buff({ mask: true })).not.toThrow()
    expect(buff({ mask: { rounds: 2 } })).not.toThrow()
  })

  it('tease_hit、tease_bonus 是這個功能自己認的修正：不進核心的修正種類（核心不會問）', () => {
    expect((MOD_KINDS as readonly string[]).includes('tease_hit')).toBe(false)
    expect((MOD_KINDS as readonly string[]).includes('tease_bonus')).toBe(false)
    expect(FEATURE_MOD_KINDS).toEqual(expect.arrayContaining(['tease_hit', 'tease_bonus']))
  })

  it('宣告與行動本身對得上：每個有行動的技能照宣告選齊了都做得成（目標、選項、行動點）', () => {
    const actions = [ID('look_here'), ID('poke'), ID('tell_me'), ID('stay'), ID('new_face'), ID('swoon'), ID('dizzy'), ID('city_fall'), ID('curtain_call'), ID('everyone'), BASE_TEASE, ID('disguise'), ID('charm_pose'), ID('silk')]
    for (const id of actions) {
      const round = id === ID('new_face') ? 2 : 1
      const g = play(ALL, { foes: [mark('甲'), mark('乙'), mark('丙')], more: { grade: 1 } })
      const a = turnTo(g, 'a1')
      g.state.battle!.round = round
      a.ap.now = 99
      const o = opt(g, id)
      expect(o, id).toBeDefined()
      const usable = o.targets.filter((x) => x.blocks.length === 0)
      if (o.target === 'none') {
        // 姿態、對自己用的：沒有目標，直接做
        expect(tryAct(g, { action: id }), id).toBeNull()
        continue
      }
      expect(usable.length, `${id} 有可以選的目標`).toBeGreaterThan(0)
      for (const t of usable) {
        const g2 = play(ALL, { foes: [mark('甲'), mark('乙'), mark('丙')] })
        const b = turnTo(g2, 'a1')
        g2.state.battle!.round = round
        b.ap.now = 99
        const pick: Rec = {}
        for (const p of o.picks) {
          const ok = p.options.find((x) => x.blocks.length === 0 && (!x.for || x.for.some((f) => JSON.stringify(f) === JSON.stringify(t.target))))
          if (ok && p.required) pick[p.key] = ok.value
        }
        expect(tryAct(g2, { action: id, target: t.target, pick }), `${id} ${JSON.stringify(t.target)} ${JSON.stringify(pick)}`).toBeNull()
      }
    }
  })
})

// ===================================================================================================================

describe('面具（入戲）：第一回合 AI 不挑她；她這一回合打過的敵人照樣可以挑她；唯一的目標照樣被打；第二回合起照常', () => {
  const MASK = [ID('in_character')]

  it('第一回合：敵人挑目標的權重對她是 0、對隊友不是；沒有入戲的人不受影響', () => {
    const a = world(MASK)
    expect(weight(a, 'f1', 'a1')).toBe(0)
    expect(weight(a, 'f2', 'a1')).toBe(0)
    expect(weight(a, 'f1', 'a2')).toBeGreaterThan(0)
    expect(weight(a, 'f1', 'a3')).toBeGreaterThan(0)
    // 沒裝入戲就沒有面具
    const none = world([])
    expect(weight(none, 'f1', 'a1')).toBeGreaterThan(0)
    // 修正的明細：問候選人（她）、對手是 AI，值是 −100，來源是技能
    const run = a.run()
    expect(run.mods('ai_target_pct', a.ally(1), a.foe(1)).map((p) => [p.label, p.value, p.source])).toEqual([['面具', -100, 'skill']])
    expect(run.mods('ai_target_pct', a.ally(2), a.foe(1))).toEqual([])
  })

  it('真的由 AI 選目標：第一回合不打她，換成隊友；沒有面具就打她（亂數 0 選第一個）', () => {
    const masked = world(MASK, { foes: [mark('甲', { ap: { now: 4, max: 4, regen: 3 } }), mark('乙')] })
    const r1 = masked.run(dice(0, 0, 15))
    expect(aiStep(r1, masked.foe(1))).toBe(true)
    expect(shots(r1, 'f1').map((b) => (b.data as Rec).target)).toEqual(['a2'])
    const bare = world([], { foes: [mark('甲', { ap: { now: 4, max: 4, regen: 3 } }), mark('乙')] })
    const r2 = bare.run(dice(0, 0, 15))
    expect(aiStep(r2, bare.foe(1))).toBe(true)
    expect(shots(r2, 'f1').map((b) => (b.data as Rec).target)).toEqual(['a1'])
  })

  it('第二回合起照常：權重和沒有面具的時候一樣', () => {
    const a = world(MASK)
    const bare = world([])
    a.battle.round = 2
    bare.battle.round = 2
    expect(weight(a, 'f1', 'a1')).toBeCloseTo(weight(bare, 'f1', 'a1'))
    expect(weight(a, 'f1', 'a1')).toBeGreaterThan(0)
  })

  it('她這一回合已經攻擊過的敵人（武器攻擊，打中或打空都算）照樣可以挑她，沒被她打的還是不挑；誘惑攻擊也算', () => {
    const a = world([ID('in_character'), ID('look_here')])
    expect(weight(a, 'f1')).toBe(0)
    // 打空也算「攻擊過他」
    a.run(dice(2)).attack(a.ally(1), a.foe(1))
    expect(weight(a, 'f1')).toBeGreaterThan(0)
    expect(weight(a, 'f2')).toBe(0)
    // 誘惑攻擊（過不過都算）
    cast(a, ID('look_here'), u('f2'), { d: dice(2) })
    expect(weight(a, 'f2')).toBeGreaterThan(0)
    // 隊友打的不算她的
    const b = world(MASK)
    b.run(dice(15)).attack(b.ally(2), b.foe(1))
    expect(weight(b, 'f1')).toBe(0)
    // 基本的誘惑攻擊也一樣
    const c = world(MASK)
    cast(c, BASE_TEASE, u('f1'), { d: dice(2) })
    expect(weight(c, 'f1')).toBeGreaterThan(0)
    expect(weight(c, 'f2')).toBe(0)
  })

  it('「這一回合」：記的是回合數，下一回合她又沒打過了（千面延長到第二回合時看得出來）', () => {
    const g = makeGame({ features: FEATURES, content: [PACK], pc: { ext: { abilities: { xp: 0, learned: [ID('in_character'), ID('thousand_faces')], equipped: [ID('in_character'), ID('thousand_faces')], spent: { socialite: 120 } } } } }).game
    g.commit(prep(g.k, g.state, 'pc', ID('thousand_faces')))
    g.startBattle(duel([diva([], { unit: { ext: {} } }), ...mates()], [mark('甲'), mark('乙')]))
    const b = g.state.battle!
    const run = new BattleRun(g.k, g.state, b)
    // 第 1 回合：她打了甲，甲可以挑她，乙不行
    run.attack(b.units.a1!, b.units.f1!)
    expect(targetWeight(run, b.units.f1!, b.units.a1!)).toBeGreaterThan(0)
    expect(targetWeight(run, b.units.f2!, b.units.a1!)).toBe(0)
    // 第 2 回合（千面讓面具延長到這裡）：昨天打的不算，甲又不挑她了
    b.round = 2
    expect(targetWeight(run, b.units.f1!, b.units.a1!)).toBe(0)
    b.units.a1!.uses['mask_hit:f1'] = 2
    expect(targetWeight(run, b.units.f1!, b.units.a1!)).toBeGreaterThan(0)
  })

  it('場上只剩她時照樣被打（核心的修正：全部候選都是 0 時當成沒有這個修正）', () => {
    const a = world(MASK, { allies: [diva(MASK)], foes: [mark('甲', { ap: { now: 4, max: 4, regen: 3 } })] })
    expect(weight(a)).toBe(0)
    const run = a.run(dice(0, 0, 15))
    expect(aiStep(run, a.foe(1))).toBe(true)
    expect(shots(run, 'f1').map((b) => (b.data as Rec).target)).toEqual(['a1'])
    // 隊友都倒下了也一樣
    const b = world(MASK, { foes: [mark('甲', { ap: { now: 4, max: 4, regen: 3 } })] })
    b.ally(2).out = 'down'
    b.ally(2).slot = 0
    b.ally(3).out = 'down'
    b.ally(3).slot = 0
    const r2 = b.run(dice(0, 0, 15))
    expect(aiStep(r2, b.foe(1))).toBe(true)
    expect(shots(r2, 'f1').map((x) => (x.data as Rec).target)).toEqual(['a1'])
  })

  it('千面（預備，整個副本有效）：這個副本裡的每一場，面具延長到第二回合；第三回合就沒有了；沒預備的人第二回合就沒有；預備一個時段', () => {
    const owner = { pc: { ext: { abilities: { xp: 0, learned: [ID('in_character'), ID('thousand_faces')], equipped: [ID('in_character'), ID('thousand_faces')], spent: { socialite: 120 } } } } }
    // 單位用角色身上的技能（unit.ext 空著，開打時照角色填）
    const setup = () => duel([diva([], { unit: { ext: {} } }), ...mates()], [mark('甲'), mark('乙')])
    const g = makeGame({ features: FEATURES, content: [PACK], ...owner }).game
    expect(prepBlock(g.k, g.state, 'pc', ID('thousand_faces'))).toBeNull()
    const t0 = g.state.time
    g.commit(prep(g.k, g.state, 'pc', ID('thousand_faces')))
    expect(abilitiesOf(g.state, 'pc').prepared).toEqual([{ id: ID('thousand_faces'), scope: 'commission' }])
    expect(g.state.time).not.toEqual(t0)
    g.startBattle(setup())
    const b = g.state.battle!
    const run = new BattleRun(g.k, g.state, b)
    const f1 = b.units.f1!
    const me = b.units.a1!
    expect(me.actor).toBe('pc')
    expect(me.ext.abilities).toMatchObject({ equipped: [ID('in_character'), ID('thousand_faces')] })
    expect(targetWeight(run, f1, me)).toBe(0)
    b.round = 2
    expect(targetWeight(run, f1, me)).toBe(0)
    b.round = 3
    expect(targetWeight(run, f1, me)).toBeGreaterThan(0)
    // 隊友不受影響
    b.round = 2
    expect(targetWeight(run, f1, b.units.a2!)).toBeGreaterThan(0)
    // 沒有預備的人：第二回合面具就沒有了
    const h = makeGame({ features: FEATURES, content: [PACK], ...owner }).game
    h.startBattle(setup())
    const hb = h.state.battle!
    const hr = new BattleRun(h.k, h.state, hb)
    expect(targetWeight(hr, hb.units.f1!, hb.units.a1!)).toBe(0)
    hb.round = 2
    expect(targetWeight(hr, hb.units.f1!, hb.units.a1!)).toBeGreaterThan(0)
  })

  it('換臉：第一回合不能用；之後用了，面具重新生效到她的下一回合開始為止（要裝著入戲，換臉才有意思；buff 自己就是一段面具）', () => {
    const a = world([ID('new_face')])
    expect(reasonOf(() => cast(a, ID('new_face'), null))).toEqual(['第一回合不能用。'])
    a.battle.round = 2
    // 沒有入戲，第二回合本來就沒有面具；換臉之後有
    expect(weight(a)).toBeGreaterThan(0)
    expect(spentBy(a, () => cast(a, ID('new_face'), null))).toBe(1)
    expect(weight(a, 'f1', 'a1')).toBe(0)
    expect(weight(a, 'f1', 'a2')).toBeGreaterThan(0)
    // 她的下一回合開始：結束了
    a.k.battle.emit('turn.start', { run: a.run(), unit: a.ally(1) })
    expect(weight(a)).toBeGreaterThan(0)
    // 換臉之後她打了某個敵人，那個敵人照樣可以挑她
    const b = world([ID('new_face'), ID('look_here')])
    b.battle.round = 2
    cast(b, ID('new_face'), null)
    cast(b, ID('look_here'), u('f1'))
    expect(weight(b, 'f1')).toBeGreaterThan(0)
    expect(weight(b, 'f2')).toBe(0)
  })

  it('面具是戰鬥狀態的一部分：換臉的 buff 與「攻擊過誰」的記號可以整份複製（存檔、回退），複製出來的面具一樣有效', () => {
    const a = world([ID('new_face'), ID('look_here')])
    a.battle.round = 2
    cast(a, ID('new_face'), null)
    cast(a, ID('look_here'), u('f1'))
    const copy = clone(a.battle)
    const run = new BattleRun(a.k, a.state, copy)
    expect(targetWeight(run, copy.units.f1!, copy.units.a1!)).toBeGreaterThan(0)
    expect(targetWeight(run, copy.units.f2!, copy.units.a1!)).toBe(0)
    expect(JSON.parse(JSON.stringify(copy.units.a1!.ext.abilities))).toMatchObject({ buffs: [{ id: 'new_face', mask: {} }] })
  })

  it('謝幕：只在第一回合，她和一名隊友在這一回合不會被敵人當成目標；沒被選的隊友照常；第二回合起照常；每場 1 次', () => {
    const a = world([ID('curtain_call')])
    expect(spentBy(a, () => cast(a, ID('curtain_call'), u('a2')))).toBe(2)
    expect(weight(a, 'f1', 'a1')).toBe(0)
    expect(weight(a, 'f1', 'a2')).toBe(0)
    expect(weight(a, 'f2', 'a2')).toBe(0)
    expect(weight(a, 'f1', 'a3')).toBeGreaterThan(0)
    expect(reasonOf(() => cast(a, ID('curtain_call'), u('a3')))).toEqual(['這一場已經用過了。'])
    a.battle.round = 2
    expect(weight(a, 'f1', 'a1')).toBeGreaterThan(0)
    expect(weight(a, 'f1', 'a2')).toBeGreaterThan(0)
    // 第二回合不能用
    const b = world([ID('curtain_call')])
    b.battle.round = 2
    expect(reasonOf(() => cast(b, ID('curtain_call'), u('a2')))).toEqual(['只能在第一回合用。'])
  })
})

// ===================================================================================================================

describe('誘惑攻擊：檢定的明細是魅力與誘惑、DC 是 10＋意志＋定力；過了灌快感傷害（不看護甲與遮蔽）', () => {
  const T = ID('look_here')

  it('檢定的明細：魅力 +2、誘惑 +3、看這邊♡ 的 +1；DC 是 10＋目標的 mod(意志)＋定力；一個擲骰一個傷害', () => {
    // 目標意志 14（+2）、定力 3：DC 15
    const a = world([T], { foes: [mark('甲', { attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 14, charm: 10 }, skills: { composure: 3 } }), mark('乙')] })
    const run = cast(a, T, u('f1'), { d: dice(10, 3, 4) })
    const roll = rollOf(run)
    expect(roll.attr).toBe('charm')
    expect(roll.skill).toBe('seduce')
    expect(roll.natural).toBe(10)
    expect(roll.dc).toBe(15)
    expect(roll.parts.map((p) => [p.source, p.value])).toEqual([['attr', 2], ['skill', 3], ['skill', 1]])
    expect(roll.parts.at(-1)!.label).toBe('看這邊♡')
    expect(roll.total).toBe(16)
    expect(roll.degree).toBe('success')
    // 剛好差一點：9 + 6 = 15 ≥ 15 也過；8 + 6 = 14 不過
    const edge = world([T], { foes: [mark('甲', { attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 14, charm: 10 }, skills: { composure: 3 } }), mark('乙')] })
    expect(rollOf(cast(edge, T, u('f1'), { d: dice(9, 3, 4) })).degree).toBe('success')
    const miss = world([T], { foes: [mark('甲', { attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 14, charm: 10 }, skills: { composure: 3 } }), mark('乙')] })
    const r3 = cast(miss, T, u('f1'), { d: dice(8, 3, 4) })
    expect(rollOf(r3).degree).toBe('fail')
    expect(miss.foe(1).load!.now).toBe(0)
  })

  it('過了：目標的感載增加（2d6，敏感度 50 不變）、沉溺 +1；護甲與遮蔽都不管：遮蔽沒有受傷、生命沒有動', () => {
    const a = world([T], { cover: { ally: [0, 0, 0, 0], foe: [2, 2, 0, 0] }, foes: [mark('甲', { armor: 30 }), mark('乙')] })
    const hpBefore = a.foe(1).hp!.now
    const coverBefore = JSON.stringify(a.battle.cover.foe)
    cast(a, T, u('f1'), { d: dice(12, 3, 4) })
    expect(a.foe(1).load!.now).toBe(7)
    expect(a.foe(1).sink).toBe(1)
    expect(a.foe(1).hp!.now).toBe(hpBefore)
    expect(JSON.stringify(a.battle.cover.foe)).toBe(coverBefore)
    // 同樣的骰面，擲 6 + 6 就是 12
    const b = world([T])
    cast(b, T, u('f1'), { d: dice(12, 6, 6) })
    expect(b.foe(1).load!.now).toBe(12)
  })

  it('沒過：沒有任何傷害、沒有沉溺，行動點照樣花 2 點；自然 1 一定不過、自然 20 一定過（DC 再高也是）', () => {
    const hard = { attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 30, charm: 10 }, skills: { composure: 10 } }
    const a = world([T], { foes: [mark('甲', hard), mark('乙')] })
    expect(spentBy(a, () => cast(a, T, u('f1'), { d: dice(19, 6, 6) }))).toBe(2)
    expect(a.foe(1).load!.now).toBe(0)
    expect(a.foe(1).sink).toBe(0)
    // 自然 20：DC 30 + 10 也過
    const b = world([T], { foes: [mark('甲', hard), mark('乙')] })
    const r = cast(b, T, u('f1'), { d: dice(20, 6, 6) })
    expect(rollOf(r).dc).toBe(10 + 10 + 10)
    expect(b.foe(1).load!.now).toBe(12)
    // 自然 1：DC 10 也不過
    const c = world([T])
    cast(c, T, u('f1'), { d: dice(1, 6, 6) })
    expect(c.foe(1).load!.now).toBe(0)
  })

  it('對沒有橋的人灰掉，距離 3 灰掉，各一句完整的原因；距離 2 以內有橋的可以選', () => {
    const g = play([T], { foes: [mark('甲'), mark('乙', { load: undefined }), mark('丙')] })
    turnTo(g, 'a1')
    const t = opt(g, T).targets
    expect(t.map((x) => x.blocks)).toEqual([[], ['乙要有橋才能用。'], ['目標要在距離 1～2 以內，現在距離 3。']])
    expect(tryAct(g, { action: T, target: u('f2') })).toEqual(['乙要有橋才能用。'])
    expect(tryAct(g, { action: T, target: u('f3') })).toEqual(['目標要在距離 1～2 以內，現在距離 3。'])
    // 基本的誘惑攻擊一樣
    const h = play([ID('in_character')], { foes: [mark('甲'), mark('乙', { load: undefined }), mark('丙')] })
    turnTo(h, 'a1')
    expect(opt(h, BASE_TEASE).targets.map((x) => x.blocks)).toEqual([[], ['乙要有橋才能用。'], ['目標要在距離 1～2 以內，現在距離 3。']])
  })

  it('一回合只有一次：第二次灰掉；看這邊♡、不要走嘛、銷魂、暈乎乎與基本的誘惑攻擊共用這一次；戳戳你不算在裡面；下個回合又可以', () => {
    const ids = [ID('in_character'), T, ID('stay'), ID('swoon'), ID('dizzy'), ID('poke')]
    const reason = ['這一回合「tease」這一組的技能已經用了 1 次，不能再用。']
    for (const first of [T, BASE_TEASE, ID('stay'), ID('swoon'), ID('dizzy')]) {
      const a = world(ids)
      cast(a, first, u('f1'))
      for (const second of [T, BASE_TEASE, ID('stay'), ID('swoon'), ID('dizzy')]) expect(reasonOf(() => cast(a, second, u('f1'))), `${first} → ${second}`).toEqual(reason)
      // 戳戳你另算
      expect(reasonOf(() => cast(a, ID('poke'), u('f1')))).toEqual([])
    }
    const a = world(ids)
    expect(spentBy(a, () => cast(a, BASE_TEASE, u('f1')))).toBe(2)
    // 回合開始清掉「這一回合」的次數
    for (const key of Object.keys(a.ally(1).uses)) if (key.startsWith('turn:')) delete a.ally(1).uses[key]
    expect(reasonOf(() => cast(a, T, u('f1')))).toEqual([])
  })

  it('基本的誘惑攻擊（入戲帶的）：2 點、不帶加值（沒有看這邊♡ 的 +1；有的只是共鳴 1 的 +2）；沒有裝入戲就沒有這個行動', () => {
    const a = world([ID('in_character')])
    const run = cast(a, BASE_TEASE, u('f1'), { d: dice(12, 3, 4) })
    expect(rollOf(run).parts.map((p) => p.value)).toEqual([2, 3, 2])
    expect(a.foe(1).load!.now).toBe(7)
    const g = play([T])
    turnTo(g, 'a1')
    expect(g.battleOptions()!.actions.map((x) => x.id)).not.toContain(BASE_TEASE)
  })

  it('媚態開著時傷害多 1d3、繞指柔多 1d3 且命中 +1（再加共鳴 5 的 +1）；沒開姿態沒有；疊加', () => {
    const IN = ID('in_character')
    const roll = (ids: string[], tier = 1, open: string[] = []) => {
      const a = world(ids, { tier })
      for (const s of open) stance(a, s)
      const run = cast(a, T, u('f1'), { d: dice(12, 3, 4, 2) })
      return { run, load: a.foe(1).load!.now, parts: rollOf(run).parts.map((p) => p.value) }
    }
    expect(roll([T]).load).toBe(7)
    // 媚態：多 1d3（骰到 2）
    const pose = roll([T, ID('charm_pose')], 1, [ID('charm_pose')])
    expect(pose.load).toBe(9)
    expect(pose.parts).toEqual([2, 3, 1])
    // 姿態沒開：沒有
    expect(roll([T, ID('charm_pose')]).load).toBe(7)
    // 繞指柔：命中 +1、傷害多 1d3
    const silk = roll([T, ID('silk')], 1, [ID('silk')])
    expect(silk.load).toBe(9)
    expect(silk.parts).toEqual([2, 3, 1, 1])
    expect(silk.run.beats.some((b) => b.roll && b.roll.parts.some((p) => p.label === '繞指柔'))).toBe(true)
    // 共鳴（要裝著入戲，樹開到那一階）：1 階 +2（檢定）、5 階 +1（誘惑攻擊的命中），不管有沒有姿態
    expect(roll([IN, T], 4).parts).toEqual([2, 3, 2, 1])
    const five = roll([IN, T], 5)
    expect(five.parts).toEqual([2, 3, 2, 1, 1])
    expect(five.run.beats.find((b) => b.roll)!.roll!.parts.filter((p) => p.label === '名媛：入戲').map((p) => p.value)).toEqual([2, 1])
    // 沒裝入戲就沒有共鳴（共鳴跟著招牌）
    expect(roll([T], 5).parts).toEqual([2, 3, 1])
  })

  it('共鳴 1：誘惑檢定 +2（帶 tease 標籤的檢定，不影響別的檢定）', () => {
    const a = world([ID('in_character'), T], { tier: 1 })
    const run = a.run()
    expect(sum(run.mods('save', a.ally(1), a.foe(1), undefined, ['tease']).filter((p) => p.source === 'skill'))).toBe(2)
    expect(sum(run.mods('save', a.ally(1), a.foe(1), undefined, ['negotiate']).filter((p) => p.source === 'skill'))).toBe(0)
    // 誘惑攻擊的明細裡看得到它
    const r = cast(a, T, u('f1'), { d: dice(12, 3, 4) })
    expect(rollOf(r).parts.map((p) => p.value)).toEqual([2, 3, 2, 1])
    // 沒有裝入戲：沒有共鳴
    const b = world([T], { tier: 1 })
    expect(sum(b.run().mods('save', b.ally(1), b.foe(1), undefined, ['tease']).filter((p) => p.source === 'skill'))).toBe(0)
  })

  it('被誘惑的人的反應經由 check.before：checked 的反應（標籤 tease）讓 DC 更高', () => {
    const ward = sk('sk_ward', '定神', 1, 'front', 'reaction', 1, ID('in_character'), { use: { ap: 0 }, meat: { trigger: { on: 'checked', who: 'self', if: 'tease' }, react: { dc: 3 } } })
    const a = world([T], { pack: withAbilities([...SOCIALITE, ward]), foes: [mark('甲', { ext: { abilities: { equipped: ['sk_ward'], tiers: {} } } }), mark('乙')] })
    const run = cast(a, T, u('f1'), { d: dice(12, 3, 4) })
    expect(rollOf(run).dc).toBe(13)
  })

  it('誘惑攻擊不是武器攻擊：沒有彈匣花費、沒有要害與重創、也不引來「被攻擊」的反應', () => {
    const a = world([T])
    const mag = a.ally(1).weapons[0]!.mag!.now
    const run = cast(a, T, u('f1'), { d: dice(20, 6, 6) })
    expect(a.ally(1).weapons[0]!.mag!.now).toBe(mag)
    expect(run.beats.map((b) => b.tag)).not.toContain('crit')
    expect(run.beats.map((b) => b.tag)).not.toContain('wound')
    expect(a.foe(1).wounds).toEqual({})
  })
})

// ===================================================================================================================

describe('各個誘惑技能：不要走嘛、銷魂、暈乎乎、傾城、戳戳你、跟我說嘛', () => {
  it('不要走嘛：命中的話，到目標下一回合結束前，他攻擊她的命中 −2（只對她，不對隊友）；沒過就沒有；他的回合結束時消失', () => {
    const S = ID('stay')
    const a = world([S])
    cast(a, S, u('f1'), { d: dice(12, 3, 4) })
    expect(a.foe(1).load!.now).toBe(7)
    expect(modTotal(a, 'hit', 'f1', [], 'a1')).toBe(-2)
    expect(modTotal(a, 'hit', 'f1', [], 'a2')).toBe(0)
    // 別的敵人不受影響
    expect(modTotal(a, 'hit', 'f2', [], 'a1')).toBe(0)
    // 真的打她：攻擊的命中明細裡有 −2
    const parts = a.run().hitParts(a.foe(1), a.ally(1), a.foe(1).weapons[0]!, {})
    expect(parts.find((p) => p.label === '不要走嘛')?.value).toBe(-2)
    // 他的回合結束：消失
    a.k.battle.emit('turn.end', { run: a.run(), unit: a.foe(1) })
    expect(modTotal(a, 'hit', 'f1', [], 'a1')).toBe(0)
    // 沒過：沒有
    const b = world([S])
    cast(b, S, u('f1'), { d: dice(1, 3, 4) })
    expect(modTotal(b, 'hit', 'f1', [], 'a1')).toBe(0)
  })

  it('銷魂：這一下讓目標過載的話，他多疊一層餘韻；沒有過載就沒有；看這邊♡ 沒有這一層', () => {
    const W = ID('swoon')
    const elite = (): unknown => foe('elite', { name: '甲', weapon: 'pistol', ...quiet } as never)
    // 精英感載上限 37；先加到只差一點
    const a = world([W], { foes: [elite(), mark('乙')] })
    a.foe(1).load!.now = 34
    cast(a, W, u('f1'), { d: dice(12, 3, 4) })
    // 34 + 7 = 41 ≥ 37：過載（餘韻 +1）、感載歸零，再多一層
    expect(a.foe(1).layers).toBe(2)
    expect(a.foe(1).load!.now).toBe(0)
    const plain = world([T0()], { foes: [elite(), mark('乙')] })
    plain.foe(1).load!.now = 34
    cast(plain, T0(), u('f1'), { d: dice(12, 3, 4) })
    expect(plain.foe(1).layers).toBe(1)
    // 沒過載：不多疊
    const low = world([W], { foes: [elite(), mark('乙')] })
    cast(low, W, u('f1'), { d: dice(12, 3, 4) })
    expect(low.foe(1).layers).toBe(0)
    expect(low.foe(1).load!.now).toBe(7)
  })

  it('暈乎乎：傷害多 1d6；第一回合用時命中的目標同時暈眩，第二回合起沒有；沒過沒有', () => {
    const D = ID('dizzy')
    const a = world([D])
    cast(a, D, u('f1'), { d: dice(12, 3, 4, 5) })
    expect(a.foe(1).load!.now).toBe(3 + 4 + 5)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['dazed'])
    const b = world([D])
    b.battle.round = 2
    cast(b, D, u('f1'), { d: dice(12, 3, 4, 5) })
    expect(b.foe(1).load!.now).toBe(12)
    expect(b.foe(1).statuses).toEqual([])
    const c = world([D])
    cast(c, D, u('f1'), { d: dice(1, 3, 4, 5) })
    expect(c.foe(1).statuses).toEqual([])
    expect(c.foe(1).load!.now).toBe(0)
  })

  it('傾城：只在第一回合，距離 2 以內兩名有橋的目標各做一次誘惑攻擊（各擲各的、各多 1d6）；每場 1 次；3 點', () => {
    const C = ID('city_fall')
    const a = world([C])
    // 第一個：d20 12、2d6 3+4、1d6 5；第二個：d20 2（沒過）
    const run = cast(a, C, u('f1'), { pick: { second: 'f2' }, d: dice(12, 3, 4, 5, 2, 6, 6, 6) })
    expect(a.foe(1).load!.now).toBe(12)
    expect(a.foe(2).load!.now).toBe(0)
    expect(run.beats.filter((b) => b.roll)).toHaveLength(2)
    // 兩個都過：各自的骰面
    const b = world([C])
    cast(b, C, u('f1'), { pick: { second: 'f2' }, d: dice(12, 3, 4, 5, 15, 1, 2, 3) })
    expect(b.foe(1).load!.now).toBe(12)
    expect(b.foe(2).load!.now).toBe(6)
    expect(b.foe(1).sink).toBe(1)
    expect(b.foe(2).sink).toBe(1)
    expect(reasonOf(() => cast(b, C, u('f1'), { pick: { second: 'f2' } }))).toEqual(['這一場已經用過了。'])
    // 3 點
    const c = world([C])
    expect(spentBy(c, () => cast(c, C, u('f1'), { pick: { second: 'f2' } }))).toBe(3)
    // 第二回合不能用
    const d = world([C])
    d.battle.round = 2
    expect(reasonOf(() => cast(d, C, u('f1'), { pick: { second: 'f2' } }))).toEqual(['只能在第一回合用。'])
  })

  it('傾城的第二個目標：和第一個不同、有橋、距離 2 以內，不符合的選項灰掉並寫出原因；選錯的做不成', () => {
    const g = play([ID('city_fall')], { foes: [mark('甲'), mark('乙', { load: undefined }), mark('丙')] })
    turnTo(g, 'a1')
    const o = opt(g, ID('city_fall'))
    const second = o.picks.find((p) => p.key === 'second')!
    expect(second.required).toBe(true)
    expect(second.options.map((x) => [x.value, x.blocks])).toEqual([
      ['f1', []], ['f2', ['乙要有橋才能用。']], ['f3', ['目標要在距離 1～2 以內，現在距離 3。']],
    ])
    // 選第一個當第二個目標：不行
    expect(tryAct(g, { action: ID('city_fall'), target: u('f1'), pick: { second: 'f1' } })).toEqual(['第二個目標不能選甲（和目標是同一個人）。'])
    expect(tryAct(g, { action: ID('city_fall'), target: u('f1'), pick: { second: 'f2' } })).toEqual(['乙要有橋才能用。'])
    expect(tryAct(g, { action: ID('city_fall'), target: u('f1') })).toEqual(['要選第二個目標。'])
  })

  it('戳戳你：4 點快感感載、不擲骰、不看敏感度（exact）、沉溺 +1；第一回合 8 點；每回合 1 次、不算在誘惑攻擊那一組；有橋、距離 2 以內', () => {
    const P = ID('poke')
    const a = world([P, T0()])
    a.battle.round = 2
    const run = cast(a, P, u('f1'))
    expect(a.foe(1).load!.now).toBe(4)
    expect(a.foe(1).sink).toBe(1)
    expect(run.beats.filter((b) => b.roll)).toHaveLength(0)
    expect(reasonOf(() => cast(a, P, u('f1')))).toEqual(['這一回合已經用過了。'])
    // 同一回合還能做一次誘惑攻擊
    expect(reasonOf(() => cast(a, T0(), u('f1')))).toEqual([])
    // 第一回合 8 點
    const b = world([P])
    cast(b, P, u('f1'))
    expect(b.foe(1).load!.now).toBe(8)
    // 敏感度高也不乘：exact
    const c = world([P], { foes: [mark('甲', { sensitivity: 100 }), mark('乙')] })
    cast(c, P, u('f1'))
    expect(c.foe(1).load!.now).toBe(8)
    // 1 點
    const d = world([P])
    expect(spentBy(d, () => cast(d, P, u('f1')))).toBe(1)
    // 沒有橋與距離 3 灰掉
    const g = play([P], { foes: [mark('甲'), mark('乙', { load: undefined }), mark('丙')] })
    turnTo(g, 'a1')
    expect(opt(g, P).targets.map((x) => x.blocks)).toEqual([[], ['乙要有橋才能用。'], ['目標要在距離 1～2 以內，現在距離 3。']])
  })

  it('跟我說嘛：只在第一回合；交涉對 10＋他的 mod(意志)＋定力；過了標記到她的下一回合（全隊打他命中 +2）；沒過沒有', () => {
    const M = ID('tell_me')
    const a = world([M], { foes: [mark('甲', { attrs: { body: 10, reflex: 10, tech: 10, intellect: 10, resolve: 14, charm: 10 }, skills: { composure: 3 } }), mark('乙')] })
    // 11 + 魅力 2 + 交涉 2 = 15，剛好對 DC 15
    const run = cast(a, M, u('f1'), { d: dice(11) })
    const roll = rollOf(run)
    expect(roll.skill).toBe('negotiate')
    expect(roll.dc).toBe(15)
    expect(roll.parts.map((p) => p.value)).toEqual([2, 2])
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['marked'])
    expect(a.foe(1).statuses[0]!.until).toEqual({ at: 'turn_start', of: 'a1', turns: 1 })
    expect(modTotal(a, 'hit_against', 'f1')).toBe(0)
    expect(sum(a.run().mods('hit_against', a.foe(1), a.ally(2)))).toBe(2)
    // 沒過
    const b = world([M])
    cast(b, M, u('f1'), { d: dice(1) })
    expect(b.foe(1).statuses).toEqual([])
    // 第二回合不能用
    const c = world([M])
    c.battle.round = 2
    expect(reasonOf(() => cast(c, M, u('f1')))).toEqual(['只能在第一回合用。'])
    // 有橋、距離 2 以內
    const g = play([M], { foes: [mark('甲'), mark('乙', { load: undefined }), mark('丙')] })
    turnTo(g, 'a1')
    expect(opt(g, M).targets.map((x) => x.blocks)).toEqual([[], ['乙要有橋才能用。'], ['目標要在距離 1～2 以內，現在距離 3。']])
  })
})
/** 基本的誘惑攻擊是看這邊♡ 嗎？不是：這個小函式只是讓下面的測試少寫一個陣列。 */
function T0(): string {
  return ID('look_here')
}

// ===================================================================================================================

describe('替身（反應）：第一回合第一次被命中時這一擊不傷人、換到相鄰的一格；第二回合不觸發；每場一次', () => {
  const S = [ID('stand_in')]
  /** f1 打 a1，骰面釘死（自然 15：打得中）。 */
  const strike = (a: Arena, attacker = 'f1', target = 'a1', d = dice(15)): BattleRun => {
    const run = a.run(d)
    run.attack(a.battle.units[attacker]!, a.battle.units[target]!)
    return run
  }

  it('第一回合第一次被命中：不受傷害、遮蔽傷在原本那一格；結算完換到相鄰的一格（隊友在後面時和他交換）', () => {
    const a = world(S, { cover: { ally: [2, 0, 0, 0], foe: [0, 0, 0, 0] }, foes: [mark('甲', { ap: { now: 4, max: 4, regen: 3 } }), mark('乙')] })
    const hp = a.ally(1).hp!.now
    const cover0 = a.battle.cover.ally[0]!.hp
    const run = strike(a)
    expect(a.ally(1).hp!.now).toBe(hp)
    expect(fired(run, ID('stand_in'))).toBe(1)
    expect(textOf(run)).toContain('擋下了這一擊')
    // 遮蔽照樣受傷：傷在她原本的那一格（第 1 格），換位的是人，不是遮蔽
    expect(a.battle.cover.ally[0]!.hp).toBeLessThan(cover0)
    // 換位：和相鄰的隊友（a2，第 2 格）交換
    expect([a.ally(1).slot, a.ally(2).slot]).toEqual([2, 1])
    expect(run.beats.some((b) => b.tag === 'move' && (b.data as Rec).unit === 'a1' && (b.data as Rec).swap === 'a2')).toBe(true)
  })

  it('有空格先去空格：她站在最後一個人的位置、她那一格有遮蔽而後面有空格時，換到後面的空格（遮蔽留在原地）', () => {
    const a = world(S, { allies: [...mates(), diva(S)], cover: { ally: [0, 0, 1, 0], foe: [0, 0, 0, 0] }, foes: [mark('甲'), mark('乙')] })
    // a3 是名媛（第 3 格）；第 4 格是空的
    expect(a.ally(3).slot).toBe(3)
    const run = strike(a, 'f1', 'a3')
    expect(a.ally(3).hp!.now).toBe(a.ally(3).hp!.max)
    expect(a.ally(3).slot).toBe(4)
    expect(a.ally(2).slot).toBe(2)
    expect(textOf(run)).toContain('移到第 4 格')
  })

  it('後面的空格留不住（她那一格沒有遮蔽，補位會把她拉回來）時改和相鄰的隊友交換', () => {
    const a = world(S, { allies: [...mates(), diva(S)], foes: [mark('甲'), mark('乙')] })
    const run = strike(a, 'f1', 'a3')
    expect(a.ally(3).hp!.now).toBe(a.ally(3).hp!.max)
    expect([a.ally(3).slot, a.ally(2).slot]).toEqual([2, 3])
    expect(textOf(run)).toContain('換位')
  })

  it('不花行動點（她的行動點不變）；沒被命中（打空）時不觸發、也不算用掉；之後第一次被命中才觸發', () => {
    const a = world(S)
    const ap = a.ally(1).ap.now
    // 打空（自然 2：沒打中）
    const miss = strike(a, 'f1', 'a1', dice(2))
    expect(fired(miss, ID('stand_in'))).toBe(0)
    expect(a.ally(1).slot).toBe(1)
    const run = strike(a)
    expect(fired(run, ID('stand_in'))).toBe(1)
    expect(a.ally(1).ap.now).toBe(ap)
  })

  it('每場一次：同一回合第二次被命中照常受傷、不換位；一次觸發之後同一場不再觸發', () => {
    const a = world(S)
    const hp = a.ally(1).hp!.now
    strike(a)
    expect(a.ally(1).hp!.now).toBe(hp)
    // 換位之後她在第 2 格；第二次被打
    const second = strike(a, 'f2', 'a1', dice(15, 4, 4, 4, 4))
    expect(fired(second, ID('stand_in'))).toBe(0)
    expect(a.ally(1).hp!.now).toBeLessThan(hp)
    expect(a.ally(1).slot).toBe(2)
  })

  it('第二回合起不觸發（只在第一回合）', () => {
    const a = world(S)
    a.battle.round = 2
    const hp = a.ally(1).hp!.now
    const run = strike(a, 'f1', 'a1', dice(15, 4, 4, 4))
    expect(fired(run, ID('stand_in'))).toBe(0)
    expect(a.ally(1).hp!.now).toBeLessThan(hp)
    expect(a.ally(1).slot).toBe(1)
  })

  it('隊友被命中不觸發（只有她自己）；格式：then_move 在核心之外做，不需要核心的新掛點', () => {
    const a = world(S)
    const hp = a.ally(2).hp!.now
    const run = strike(a, 'f1', 'a2', dice(15, 4, 4, 4))
    expect(fired(run, ID('stand_in'))).toBe(0)
    expect(a.ally(2).hp!.now).toBeLessThan(hp)
    expect(a.ally(1).slot).toBe(1)
  })
})

// ===================================================================================================================

describe('眾生相：一個有橋的敵人失去這一回合；對首領照控制保護；不花行動點', () => {
  const E = ID('everyone')

  it('敵人失去下一個回合（輪到他時直接跳過）；沒有橋的灰掉；不花行動點；每場 1 次、只在第一回合', () => {
    const a = world([E])
    expect(spentBy(a, () => cast(a, E, u('f1')))).toBe(0)
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual([LOSE_TURN])
    expect(a.foe(2).statuses).toEqual([])
    expect(reasonOf(() => cast(a, E, u('f2')))).toEqual(['這一場已經用過了。'])
    const b = world([E])
    b.battle.round = 2
    expect(reasonOf(() => cast(b, E, u('f1')))).toEqual(['只能在第一回合用。'])
    const g = play([E], { foes: [mark('甲'), mark('乙', { load: undefined })] })
    turnTo(g, 'a1')
    expect(opt(g, E).targets.map((x) => x.blocks)).toEqual([[], ['乙要有橋才能用。']])
  })

  it('輪到他的時候真的被跳過；之後的回合照常', () => {
    const a = world([E], { foes: [mark('甲', { ap: { now: 4, max: 4, regen: 3 } }), mark('乙')] })
    cast(a, E, u('f1'))
    const run = a.run()
    const f1 = a.foe(1)
    expect(f1.statuses.some((s) => run.statusRule(s.id).loseTurn)).toBe(true)
    // 輪到他：不能動，狀態用掉；再下一次輪到他就照常
    expect(beginTurn(run, f1)).toBe(false)
    expect(f1.statuses).toEqual([])
    expect(beginTurn(run, f1)).toBe(true)
    // 沒被她選的乙照常
    expect(beginTurn(a.run(), a.foe(2))).toBe(true)
  })

  it('對首領照控制保護：第一次有效（1 回合），這個回合與下個回合內再被控制就沒有用', () => {
    const boss = (): unknown => foe('boss', { name: '課長', weapon: 'pistol', ...quiet } as never)
    const a = world([E], { foes: [boss(), mark('乙')] })
    cast(a, E, u('f1'))
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual([LOSE_TURN])
    expect(a.foe(1).statuses[0]!.until).toMatchObject({ turns: 1 })
    // 立刻再控制一次：免疫
    expect(a.run().applyStatus(a.foe(1), LOSE_TURN)).toBe(false)
    expect(a.run().applyStatus(a.foe(1), 'frozen')).toBe(false)
    // 雜兵不受這個保護
    const b = world([E])
    cast(b, E, u('f1'))
    expect(b.run().applyStatus(b.foe(1), LOSE_TURN, { force: true })).toBe(true)
  })
})

// ===================================================================================================================

describe('欺負人家要賠喔：被距離 2 以內有橋的敵人攻擊之後反擊一次誘惑攻擊；不算每回合那一次；每場 2 次', () => {
  const P = ID('payback')
  const IDS = [P, T0(), ID('in_character')]
  /** f1 攻擊 a1（自然 1：失手，不必管傷害）之後，反擊的骰面：d20 15、2d6 4+5。 */
  const hitBy = (a: Arena, attacker = 'f1', d = dice(1, 1, 1, 1, 15, 4, 5)): BattleRun => {
    const run = a.run(d)
    run.attack(a.battle.units[attacker]!, a.ally(1))
    return run
  }

  it('被攻擊之後（打中或打空都算）對攻擊的人做一次誘惑攻擊：他的感載增加、花她 1 點行動點', () => {
    const a = world(IDS)
    const ap = a.ally(1).ap.now
    const run = hitBy(a)
    expect(fired(run, P)).toBe(1)
    expect(a.foe(1).load!.now).toBe(9)
    expect(a.foe(1).sink).toBe(1)
    expect(a.ally(1).ap.now).toBe(ap - 1)
    const roll = run.beats.filter((b) => b.roll).at(-1)!.roll!
    expect(roll.skill).toBe('seduce')
    expect(roll.dc).toBe(10)
  })

  it('打中也一樣（先受傷，再反擊）；她被打倒就不反擊', () => {
    const a = world(IDS)
    const run = a.run(dice(10, 4, 4, 4, 15, 4, 5))
    run.attack(a.foe(1), a.ally(1))
    expect(a.ally(1).hp!.now).toBeLessThan(a.ally(1).hp!.max)
    expect(fired(run, P)).toBe(1)
    expect(a.foe(1).load!.now).toBe(9)
    // 一擊倒下就不反擊
    const b = world(IDS)
    b.ally(1).hp!.now = 1
    const r2 = b.run(dice(10, 6, 6, 6, 15, 4, 5))
    r2.attack(b.foe(1), b.ally(1))
    expect(b.ally(1).out).toBe('down')
    expect(fired(r2, P)).toBe(0)
  })

  it('不算在每回合那一次裡：反擊之後同一回合還可以做一次誘惑攻擊；反擊自己不吃那一次', () => {
    const a = world(IDS)
    // 她已經做過誘惑攻擊（用掉這回合那一次），被打之後照樣反擊
    cast(a, T0(), u('f2'), { d: dice(12, 3, 4) })
    const run = hitBy(a)
    expect(fired(run, P)).toBe(1)
    expect(a.foe(1).load!.now).toBe(9)
    // 反過來：先被打反擊，再做誘惑攻擊
    const b = world(IDS)
    hitBy(b)
    expect(reasonOf(() => cast(b, T0(), u('f2')))).toEqual([])
  })

  it('每場兩次：第三次被攻擊不再反擊（也不扣行動點）', () => {
    const a = world(IDS)
    hitBy(a)
    hitBy(a, 'f2')
    const ap = a.ally(1).ap.now
    const third = hitBy(a)
    expect(fired(third, P)).toBe(0)
    expect(a.ally(1).ap.now).toBe(ap)
  })

  it('攻擊的人沒有橋、或距離 3：不觸發，也不扣行動點', () => {
    const noBridge = world(IDS, { foes: [mark('甲', { load: undefined }), mark('乙')] })
    const ap = noBridge.ally(1).ap.now
    const r1 = hitBy(noBridge)
    expect(fired(r1, P)).toBe(0)
    expect(noBridge.ally(1).ap.now).toBe(ap)
    // 距離 3：敵人在第 3 格
    const far = world(IDS, { foes: [mark('甲'), mark('乙'), mark('丙', { weapon: 'rifle' })] })
    const r2 = hitBy(far, 'f3')
    expect(fired(r2, P)).toBe(0)
    expect(far.ally(1).ap.now).toBe(ap)
    // 距離 2：第 2 格的敵人可以反擊
    const near = world(IDS)
    expect(fired(hitBy(near, 'f2', dice(1, 1, 1, 1, 15, 4, 5)), P)).toBe(1)
  })

  it('行動點不夠（沒有 1 點）時不觸發；隊友被打不觸發', () => {
    const a = world(IDS)
    a.ally(1).ap.now = 0
    expect(fired(hitBy(a), P)).toBe(0)
    const b = world(IDS)
    const run = b.run(dice(1, 1, 1, 1, 15, 4, 5))
    run.attack(b.foe(1), b.ally(2))
    expect(fired(run, P)).toBe(0)
  })

  it('反擊也算「她攻擊過他」：第一回合有面具時，打過她的敵人照樣可以挑她', () => {
    const a = world(IDS)
    expect(weight(a, 'f1')).toBe(0)
    hitBy(a)
    expect(weight(a, 'f1')).toBeGreaterThan(0)
    expect(weight(a, 'f2')).toBe(0)
  })
})

// ===================================================================================================================

describe('其餘的被動與姿態', () => {
  it('偽裝（姿態）：開著時，第一回合的第一次攻擊命中 +2；第二次攻擊、第二回合、沒開姿態都沒有；開與關各花 1 點', () => {
    const D = ID('disguise')
    const a = world([D])
    expect(modTotal(a, 'hit', 'a1')).toBe(0)
    stance(a, D)
    expect(modTotal(a, 'hit', 'a1')).toBe(2)
    // 攻擊過一次之後沒有了
    a.run(dice(2)).attack(a.ally(1), a.foe(1))
    expect(modTotal(a, 'hit', 'a1')).toBe(0)
    // 第二回合沒有
    const b = world([D])
    stance(b, D)
    b.battle.round = 2
    expect(modTotal(b, 'hit', 'a1')).toBe(0)
    // 實際的攻擊明細：+2 一次
    const c = world([D])
    stance(c, D)
    const parts = (): number[] => c.run().hitParts(c.ally(1), c.foe(1), c.ally(1).weapons[0]!, {}).filter((p) => p.label === '偽裝').map((p) => p.value)
    expect(parts()).toEqual([2])
    c.run(dice(15)).attack(c.ally(1), c.foe(1))
    expect(parts()).toEqual([])
    // 開關各 1 點
    const g = a
    g.ally(1).stance = undefined
    expect(spentBy(g, () => cast(g, D, null))).toBe(1)
    expect(g.ally(1).stance).toBe(D)
    expect(spentBy(g, () => cast(g, D, null))).toBe(1)
    expect(g.ally(1).stance).toBeUndefined()
  })

  it('媚態與繞指柔不能同時開（姿態只能開一個）：開繞指柔時媚態關掉', () => {
    const a = world([ID('charm_pose'), ID('silk')])
    cast(a, ID('charm_pose'), null)
    expect(a.ally(1).stance).toBe(ID('charm_pose'))
    cast(a, ID('silk'), null)
    expect(a.ally(1).stance).toBe(ID('silk'))
    expect(modTotal(a, 'tease_hit' as never, 'a1')).toBe(1)
  })

  it('第二張臉：第一回合裡打在她身上的重創改成一般的命中；第二回合起照常；沒有這個技能就是重創', () => {
    const strike = (ids: string[], round: number) => {
      const a = world(ids)
      a.battle.round = round
      return a.run(dice(20)).attack(a.foe(1), a.ally(1))
    }
    expect(strike([], 1).wound).toBe(true)
    expect(strike([ID('second_face')], 1).wound).toBe(false)
    expect(strike([ID('second_face')], 1).hit).toBe(true)
    expect(strike([ID('second_face')], 2).wound).toBe(true)
    // 隊友不吃（只有她自己）
    const a = world([ID('second_face')])
    expect(a.run(dice(20)).attack(a.foe(1), a.ally(2)).wound).toBe(true)
  })

  it('入骨：第一回合迴避 +2、這才是真的我：第一回合迴避 +1；第二回合起沒有', () => {
    const a = world([ID('deep_in_role'), ID('the_real_me')])
    expect(modTotal(a, 'evade', 'a1')).toBe(3)
    a.battle.round = 2
    expect(modTotal(a, 'evade', 'a1')).toBe(0)
    const b = world([ID('deep_in_role')])
    expect(modTotal(b, 'evade', 'a1')).toBe(2)
    // 隊友沒有
    expect(modTotal(b, 'evade', 'a2')).toBe(0)
  })

  it('這才是真的我：感載上限 +8（pool 的 load）；共鳴 2 階再 +4；沒有橋的人不會被補出感載', () => {
    const base = world([]).ally(1).load!.max
    expect(world([ID('the_real_me')]).ally(1).load!.max).toBe(base + 8)
    expect(world([ID('in_character'), ID('the_real_me')], { tier: 2 }).ally(1).load!.max).toBe(base + 8 + 4)
    expect(world([ID('in_character')], { tier: 1 }).ally(1).load!.max).toBe(base)
    // 現在的感載不動
    expect(world([ID('the_real_me')]).ally(1).load!.now).toBe(0)
    const none = world([ID('the_real_me')], { unit: { load: undefined } })
    expect(none.ally(1).load).toBeUndefined()
  })

  it('我很清醒喔：抵抗控制類快駭的檢定 +2（防火牆 +2，只認 hack:control 這個標籤）；真的被快駭擲的 DC 多 2', () => {
    const a = world([ID('sober')])
    expect(modTotal(a, 'firewall', 'a1', ['hack', 'hack:control'])).toBe(2)
    expect(modTotal(a, 'firewall', 'a1', ['hack'])).toBe(0)
    expect(modTotal(a, 'firewall', 'a2', ['hack:control'])).toBe(0)
    // 敵人對她擲一次控制類的快駭檢定（核心的 check 效果，對防火牆）：沒有甲板用迴避，再加 2
    const dcOf = (ids: string[]): number => {
      const w = world(ids)
      const run = w.run(dice(10))
      run.effects([{ op: 'check', attr: 'tech', vs: 'firewall', tags: ['hack', 'hack:control'] }], {
        user: w.foe(1), target: { unit: 'a1' }, source: { kind: 'hack', id: 'x', name: '快駭' },
      })
      return rollOf(run).dc
    }
    expect(dcOf([ID('sober')])).toBe(dcOf([]) + 2)
  })

  it('共鳴 2、3：感載上限 +4（2 階起）；每場第一次換位不花行動點（3 階起）', () => {
    const base = world([]).ally(1).load!.max
    expect(world([ID('in_character')], { tier: 1 }).ally(1).load!.max).toBe(base)
    expect(world([ID('in_character')], { tier: 2 }).ally(1).load!.max).toBe(base + 4)
    const run = (tier: number): number => {
      const a = world([ID('in_character')], { tier })
      const r = a.run()
      return sum(r.mods('move_ap', a.ally(1)).filter((p) => p.source === 'skill'))
    }
    expect(run(2)).toBe(0)
    expect(run(3)).toBe(-1)
  })
})

// ===================================================================================================================

describe('讀人與千面（預備）、輿論與內海欄：現實欄寫不出來的標在哪裡', () => {
  it('讀人：現實欄是 pending（要知道「他」是誰：名冊與傾向，M2），預備不了；一句原因', () => {
    const g = makeGame({ features: FEATURES, content: [PACK], pc: { ext: { abilities: { xp: 0, learned: [ID('in_character'), ID('read_people')], equipped: [ID('in_character'), ID('read_people')], spent: { socialite: 20 } } } } }).game
    expect(prepBlock(g.k, g.state, 'pc', ID('read_people'))).toBe('讀人還沒有可以帶進戰鬥的效果。')
    expect(() => prep(g.k, g.state, 'pc', ID('read_people'))).toThrow('還沒有可以帶進戰鬥的效果')
  })

  it('學得到、裝得上（吃社交型的容量）：入戲 3 ＋ 我演得很像吧 3 ＋ 這才是真的我 6 的容量', () => {
    const g = makeGame({
      features: FEATURES, content: [PACK],
      pc: { ext: { bridge: { capacity: { meat: 8, net: 8, social: 12, media: 8 } }, abilities: { xp: 9999, learned: [], equipped: [], spent: {} } } },
    }).game
    const chain = [ID('in_character'), ID('stand_in'), ID('disguise'), ID('good_actor')]
    g.state.actors.pc!.ext.abilities = { xp: 9999, learned: [], equipped: [], spent: { socialite: 400 } }
    for (const id of chain) g.commit(learn(g.k, g.state, 'pc', id))
    g.commit(equipAbilities(g.k, g.state, 'pc', chain))
    expect(capacityOf(g.k, g.state, 'pc').social.used).toBe(3 + 1 + 1 + 3)
  })
})

// ===================================================================================================================

describe('主播與偶像：學得到、裝得上、在現實戰鬥沒有任何效果（SKILLS 1.6 節「無」；COMBAT_SYSTEM 第 11 節）', () => {
  const owner = (equipped: string[] = []) => ({
    pc: { ext: { bridge: { capacity: { meat: 8, net: 8, social: 8, media: 12 } }, abilities: { xp: 9999, learned: [...MEDIA_IDS], equipped, spent: { streamer: 120, idol: 120 } } } },
  })

  it('載入：七個媒體類技能全部 meat 是 null、共鳴沒有現實的效果；樹在現實是 none', () => {
    const g = makeGame({ features: FEATURES, content: [MEDIA_PACK] }).game
    expect(g.k.content.list('ability')).toHaveLength(7)
    expect(g.k.content.checkRefs()).toEqual([])
    for (const a of MEDIA) expect(a.meat, a.id as string).toBeNull()
    for (const p of g.k.content.list<{ id: string; domains: { meat: string } }>('path')) expect(p.domains.meat).toBe('none')
  })

  it('學得到：花歷練點、樹的階照累計花費；裝得上：吃媒體型的容量（不吃現實型與社交型的）', () => {
    const g = makeGame({ features: FEATURES, content: [MEDIA_PACK], pc: { ext: { bridge: { capacity: { meat: 8, net: 8, social: 8, media: 8 } }, abilities: { xp: 200, learned: [], equipped: [], spent: {} } } } }).game
    for (const id of ['sk_streamer_sig', 'sk_streamer_expose', 'sk_streamer_flood', 'sk_idol_sig', 'sk_idol_cheer']) g.commit(learn(g.k, g.state, 'pc', id))
    expect(abilitiesOf(g.state, 'pc')).toMatchObject({ xp: 200 - 20 - 20 - 40 - 20 - 20, spent: { streamer: 80, idol: 40 } })
    g.commit(equipAbilities(g.k, g.state, 'pc', ['sk_streamer_sig', 'sk_streamer_expose', 'sk_idol_sig', 'sk_idol_cheer']))
    expect(capacityOf(g.k, g.state, 'pc')).toMatchObject({ meat: { used: 0 }, social: { used: 0 }, media: { used: 3 + 1 + 3 + 1, max: 8 } })
    // 容量超過就擋（和別的類一樣）
    expect(() => equipAbilities(g.k, g.state, 'pc', ['sk_streamer_sig', 'sk_streamer_expose', 'sk_idol_sig', 'sk_idol_cheer', 'sk_streamer_flood'])).toThrow(/媒體型的容量不夠/)
  })

  /** 一個人開打：圓環上的行動 id（照排序）。 */
  const ring = (g: G, id = 'a1'): string[] => {
    turnTo(g, id)
    return g.battleOptions()!.actions.map((a) => a.id)
  }
  const gameWith = (equipped: string[]) =>
    makeBattleGame({
      features: FEATURES, content: [MEDIA_PACK], seed: 3, ...owner(equipped),
      battle: duel([one({ actor: 'pc', weapon: 'pistol' }), ...mates()], [mark('甲'), mark('乙')]),
    }).game

  it('裝著主播與偶像技能（假資料，meat: null）的人開打：圓環上沒有多任何行動', () => {
    const bare = ring(gameWith([]))
    const full = ring(gameWith(MEDIA_IDS))
    expect(full).toEqual(bare)
    // 這個人的行動只有核心與戰鬥功能給的；沒有任何一個 id 來自這些技能
    for (const id of full) expect(MEDIA_IDS.some((m) => id.startsWith(m)), id).toBe(false)
    const g = gameWith(MEDIA_IDS)
    turnTo(g, 'a1')
    expect(unit(g, 'a1').ext.abilities).toMatchObject({ equipped: MEDIA_IDS })
  })

  it('任何修正的明細都沒有來自這些技能的項（每一種修正，帶不同的標籤與對手）；沒有任何一個反應觸發；單位身上沒有多的標籤與池', () => {
    const withSkills = gameWith(MEDIA_IDS)
    const bare = gameWith([])
    const run = new BattleRun(withSkills.k, withSkills.state, withSkills.state.battle!)
    const base = new BattleRun(bare.k, bare.state, bare.state.battle!)
    const me = withSkills.state.battle!.units.a1!
    const him = withSkills.state.battle!.units.f1!
    const tagSets = [[], ['aimed'], ['weapon_attack'], ['skill'], ['tease'], ['hack', 'hack:control'], ['item', 'medical'], ['drone']]
    for (const kind of MOD_KINDS) {
      for (const tags of tagSets) {
        const parts = run.mods(kind, me, him, undefined, tags)
        const bareParts = base.mods(kind, bare.state.battle!.units.a1!, bare.state.battle!.units.f1!, undefined, tags)
        expect(parts.filter((p) => p.source === 'skill'), `${kind} ${tags.join(',')}`).toEqual([])
        expect(parts.map((p) => [p.label, p.value]), `${kind} ${tags.join(',')}`).toEqual(bareParts.map((p) => [p.label, p.value]))
        // 問自己被打的那一面（對手是敵人）也一樣
        expect(run.mods(kind, him, me, undefined, tags).filter((p) => p.source === 'skill'), `${kind} ${tags.join(',')} 反過來`).toEqual([])
      }
    }
    expect(me.tags).toEqual(bare.state.battle!.units.a1!.tags)
    expect(Object.keys(me.pools).sort()).toEqual(Object.keys(bare.state.battle!.units.a1!.pools).sort())
    expect(me.load!.max).toBe(bare.state.battle!.units.a1!.load!.max)
    expect(me.hp!.max).toBe(bare.state.battle!.units.a1!.hp!.max)
    // 命中與迴避的明細：和沒裝的人一模一樣
    const w = me.weapons[0]!
    expect(run.hitParts(me, him, w).map((p) => [p.label, p.value])).toEqual(base.hitParts(bare.state.battle!.units.a1!, bare.state.battle!.units.f1!, bare.state.battle!.units.a1!.weapons[0]!).map((p) => [p.label, p.value]))
    expect(run.evadeOf(me, him).total).toBe(base.evadeOf(bare.state.battle!.units.a1!, bare.state.battle!.units.f1!).total)
    // 被打、被檢定時沒有反應：記的拍和沒裝的一樣
    const a = new BattleRun(withSkills.k, withSkills.state, withSkills.state.battle!)
    a.attack(him, me)
    expect(a.beats.filter((b) => b.tag === 'skill')).toEqual([])
  })

  it('整場打完（用 AI 代打）：裝著這些技能的人和沒裝的人，結果一樣（同一個種子）', () => {
    const play1 = (equipped: string[]) => {
      const g = gameWith(equipped)
      let steps = 0
      while (g.battle && !g.battle.result && steps++ < 400) {
        const r = g.battleNext({ anyone: true })
        if (r.status !== 'applied') break
      }
      return { steps, result: g.battle?.result?.outcome, hp: Object.values(g.state.battle!.units).map((x) => x.hp?.now) }
    }
    expect(play1(MEDIA_IDS)).toEqual(play1([]))
  })

  it('meat 不是 null 的媒體類技能載入時被擋；共鳴有現實的效果也被擋（不然會變成戰鬥裡的修正）', () => {
    const bad = (more: Rec) => () => makeGame({ features: FEATURES, content: [withAbilities([{ ...MEDIA[0]!, ...more }, ...MEDIA.slice(1, 4)], [MEDIA_TREE('streamer', '主播', '主播：聚光燈')])] })
    expect(bad({ meat: { pending: true } })).toThrow(/主播：聚光燈在現實沒有效果（domains\.meat 是 none），meat 要是 null/)
    expect(bad({ meat: { mods: [{ kind: 'hit', value: 1 }] } })).toThrow(/meat 要是 null/)
    expect(bad({})).not.toThrow()
    const withEffect = (effect: Rec) => () => makeGame({ features: FEATURES, content: [withAbilities(MEDIA.slice(0, 4), [{ ...MEDIA_TREE('streamer', '主播', '主播：聚光燈'), resonance: [{ tier: 1, cells: 1, text: '共鳴。', effect }] }])] })
    expect(withEffect({ initiative: 3 })).toThrow(/resonance\[0\]\.effect 不能有 initiative/)
    expect(withEffect({ mods: [{ kind: 'hit', value: 1 }], load_max: 4 })).toThrow(/不能有 mods、load_max/)
    expect(withEffect({ pending: true })).not.toThrow()
  })
})
