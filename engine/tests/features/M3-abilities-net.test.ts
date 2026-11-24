// 驗收測試：dev/work/M3-abilities-net.md（cpp-feature）。技能格式的內海欄：net 欄與 meat 欄同一套封閉清單、照戰場選欄與選 use；
// 內海才有的鍵（use.admin、slots、admin、sync_cap、unique、tags: overclock、when.sync_min／sync_max、prep.net）。
// 規格：SKILLS 1.7、1.8、第 13 節；SKILL_TREES 潛網者；CYBERSPACE 第 5、6.3、6.4 節；ITEMS 11.7；dev/adr/0015 E1；dev/adr/0018 第一節與 N33。
// 技能都是測試自帶的假資料（照潛網者的幾種寫法各一個），不讀 engine/data；net.admin_spend 用測試的替身效果（不 import features/netcombat、features/deck）。

import { describe, expect, it } from 'vitest'
import type { BattleOptions, BattleUnit, ContentPack, Feature, Kernel } from '../../src'
import { BattleRun, createKernel, readyFeatures } from '../../src'
import { abilitiesFeature, abilitiesOf, prep, traceStartOf } from '../../src/features/abilities'
import { TEST_COMBAT, TEST_NET_COMBAT, fixDice, laceUnit, makeBattleGame, netAvatar, partyUnit, playOut } from '../../src/testkit'
import { duel, netDuel } from '../helpers/battle'

type Rec = Record<string, unknown>

// ---- 假資料 ----

const TREE = { id: 'tree', name: '測試路數', tree: '測試樹', category: 'net', signature: 'sk_root', domains: { meat: 'strong', net: 'strong', opinion: 'none' }, resonance: [] as Rec[] }
const ab = (id: string, kind: string, more: Rec = {}): Rec => ({
  id, name: id, path: 'tree', category: 'net', tier: 1, layer: 'front', kind, cap: 1, xp: 20, cells: 1, after: 'sk_root', text: `${id}。`, net: null, opinion: null, meat: null, ...more,
})
const ROOT = ab('sk_root', 'passive', { layer: 'signature', after: undefined, name: '根' })
const buff = (id: string, o: Rec = {}): Rec => ({ op: 'buff', who: 'self', id, name: id, turns: 3, until: 'own_turn_end', mods: [{ kind: 'evade', value: 1 }], ...o })

/** 潛網者的幾種寫法各一個（SKILL_TREES 潛網者；機制的數字照工單）。 */
const SKILLS: Rec[] = [
  // 兩欄都有的主動：內海 2 行動點 2 RAM、現實 1 行動點 2 RAM，各做各欄的效果
  ab('sk_both', 'active', { use: { meat: { ap: 1, ram: 2 }, net: { ap: 2, ram: 2 } }, meat: { target: 'none', do: [buff('b_meat')] }, net: { target: 'none', do: [buff('b_net')] } }),
  // 只有內海的主動：1 次管理行動加 1 RAM
  ab('sk_admin_act', 'active', { use: { net: { ap: 0, ram: 1, admin: 1 } }, net: { target: 'none', do: [buff('b_admin')] } }),
  // 內海的被動：RAM 上限 +1、構裝槽 +1
  ab('sk_pass', 'passive', { net: { pool: { ram: { max: 1 } }, slots: 1 } }),
  // 現實的被動（對照：內海不讀它）：池、標籤、修正
  ab('sk_meat_pass', 'passive', { meat: { pool: { ram: { max: 1 } }, tags: ['meat_tag'], mods: [{ kind: 'evade', value: 3 }] } }),
  // 招牌：專屬構裝、管理行動的基數是樹階、標籤 admin、被動的修正
  ab('sk_sig', 'passive', { layer: 'signature', after: undefined, net: { unique: true, admin: 'tier', tags: ['admin'], mods: [{ kind: 'hit', value: 2 }] } }),
  // 專屬構裝的行動（淺檔灰掉）
  ab('sk_unique_act', 'active', { use: { net: { ap: 1 } }, net: { unique: true, target: 'none', do: [buff('b_uniq')] } }),
  // 超頻：淺檔做不了
  ab('sk_oc', 'active', { use: { net: { ap: 1 } }, net: { tags: ['overclock'], target: 'none', do: [buff('b_oc')] } }),
  // 同步檔位的條件
  ab('sk_deep', 'passive', { net: { mods: [{ kind: 'hit', value: 4, when: { sync_min: 'deep' } }, { kind: 'save', value: 6, when: { sync_max: 'standard' } }] } }),
  // 反應：被打時迴避 +3（內海欄）；另一個寫在現實欄（內海不觸發）
  ab('sk_react', 'reaction', { use: { net: { ap: 1 } }, net: { trigger: { on: 'attacked', who: 'self' }, react: { evade: 3 } } }),
  ab('sk_react_meat', 'reaction', { use: { ap: 1 }, meat: { trigger: { on: 'attacked', who: 'self' }, react: { evade: 5 } } }),
  // 姿態：同步檔位的上限 +1
  ab('sk_stance', 'stance', { use: { net: { ap: 1 } }, net: { mods: [{ kind: 'sync_cap', value: 1 }] } }),
  // 戰鬥外也算的：同步檔位的上限
  ab('sk_cap', 'passive', { net: { sync_cap: 1 } }),
  // 預備：內海（追蹤度起始 −15，帶進內海的修正與開打時的效果）；現實的預備（內海不帶）
  ab('sk_prep', 'prep', { prep: { slot: 1, scope: 'commission', net: { trace_start: -15, mods: [{ kind: 'evade', value: 2 }], do: [buff('b_prep')] } } }),
  ab('sk_prep_meat', 'prep', { prep: { slot: 1, scope: 'next_battle', meat: { mods: [{ kind: 'evade', value: 1 }] } } }),
  // 敵人的招牌行動：只寫了 meat 的在內海沒有，寫了 net 的才有
  ab('en_meat', 'active', { enemy: true, path: undefined, tier: undefined, layer: undefined, cap: undefined, xp: undefined, after: undefined, category: undefined, use: { ap: 1 }, meat: { target: 'none', do: [buff('b_en_meat')] } }),
  ab('en_net', 'active', { enemy: true, path: undefined, tier: undefined, layer: undefined, cap: undefined, xp: undefined, after: undefined, category: undefined, use: { ap: 1 }, net: { target: 'none', do: [buff('b_en_net')] } }),
]
const pack = (abilities: Rec[] = SKILLS): ContentPack => ({ id: 'abilities_net_test', content: { path: [TREE], ability: [ROOT, ...abilities] } } as unknown as ContentPack)

// ---- 替身 ----

/** net.admin_spend 的替身：記下被叫了幾次、花了幾次；一回合用掉的記在 uses['turn:admin']（features/netcombat 的資料慣例）。 */
const SPENT: Array<{ unit: string; amount: number }> = []
let ACTIVE_JOB: string | null = null
const STUB: Feature = {
  id: 'abilities_net_stub',
  install(k) {
    k.battle.effect('net.admin_spend', 'abilities_net_stub', (ctx, e) => {
      const u = ctx.unit ?? ctx.user
      const n = typeof e.amount === 'number' ? e.amount : 1
      SPENT.push({ unit: u.id, amount: n })
      u.uses['turn:admin'] = (u.uses['turn:admin'] ?? 0) + n
    }, { problems: (e) => Object.keys(e).filter((x) => !['op', 'who', 'if', 'amount'].includes(x)).map((x) => `${x} 不是這個效果的欄位`) })
    // 構裝槽與專屬構裝佔的槽是 features/deck 定義的數值：測試自己定義
    k.stats.defineStat({ id: 'deck_slots', owner: 'abilities_net_stub', name: '構裝槽', base: () => 4 })
    k.stats.defineStat({ id: 'deck_slots_reserved', owner: 'abilities_net_stub', name: '被專屬構裝佔掉的槽', base: () => 0 })
    // 進行中的委託：核心活動登錄表裡 kind 是 commission 的那一段（測試用 ACTIVE_JOB 控制）
    k.activity.define({
      kind: 'commission', owner: 'abilities_net_stub', order: 90,
      active: () => (ACTIVE_JOB ? { id: ACTIVE_JOB, label: '測試的委託' } : null),
      allow: ['commit:', 'ability.', 'battle.', 'chain:'], reason: () => '測試的委託進行中。',
    })
  },
}
const FEATURES = [TEST_COMBAT, TEST_NET_COMBAT, abilitiesFeature, STUB]

// ---- 場地 ----

const equip = (...ids: string[]) => ({ abilities: { equipped: ids, tiers: { tree: 3 } } })
const NET = (o: Rec = {}) => ({ sync: 'standard', sync_max: 'full', broken: [] as string[], ...o })
/** 內海的我：有角色、行動點很多。 */
const meNet = (ids: string[], o: Rec = {}) => netAvatar(0, 1, { actor: 'pc', ap: { now: 20, max: 20, regen: 3 }, ext: { ...equip(...ids), net: NET() }, ...o } as never)
/** 現實的我：有角色、行動點很多、有 RAM。 */
const meMeat = (ids: string[], o: Rec = {}) => partyUnit(1, 1, { actor: 'pc', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 }, pools: { ram: { now: 6, max: 6, regen: 0 } }, ext: equip(...ids), ...o } as never)
const lace = (o: Rec = {}) => laceUnit('minion', 1, { ap: { now: 0, max: 0, regen: 0 }, ...o } as never)

interface PlayOpts {
  skills?: Rec[]
  pc?: Rec
  me?: Rec
  foes?: unknown[]
  features?: Feature[]
}
/** 內海的一局（a1 是我，裝著 ids）。 */
function playNet(ids: string[], o: PlayOpts = {}) {
  return makeBattleGame({
    features: o.features ?? FEATURES, content: [pack(o.skills)], seed: 7, ...(o.pc ? { pc: o.pc } : {}),
    battle: netDuel([meNet(ids, o.me), netAvatar(1, 1), netAvatar(2, 1)], o.foes ?? [lace(), lace()]),
  } as never).game
}
/** 現實的一局。 */
function playMeat(ids: string[], o: PlayOpts = {}) {
  return makeBattleGame({
    features: o.features ?? FEATURES, content: [pack(o.skills)], seed: 7, ...(o.pc ? { pc: o.pc } : {}),
    battle: duel([meMeat(ids, o.me), partyUnit(2, 1), partyUnit(3, 1)], o.foes ?? [partyUnit(1, 1, { ap: { now: 0, max: 0, regen: 0 } })]),
  } as never).game
}
type G = ReturnType<typeof playNet>

const unit = (g: G, id = 'a1'): BattleUnit => g.state.battle!.units[id]!
const turnTo = (g: G, id = 'a1'): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const options = (g: G): BattleOptions => g.battleOptions()!
const opt = (g: G, id: string) => options(g).actions.find((a) => a.id === id)
const buffs = (u: BattleUnit): string[] => ((u.ext.abilities as Rec).buffs as Array<{ id: string }> | undefined ?? []).map((b) => b.id)
const setGear = (g: G, gear: string, id = 'a1'): void => {
  const u = unit(g, id)
  u.tags = [...u.tags.filter((t) => !t.startsWith('sync:')), `sync:${gear}`]
}
const run = (g: G, dice?: number[]): BattleRun => (dice ? fixDice(new BattleRun(g.k, g.state, g.state.battle!), dice) : new BattleRun(g.k, g.state, g.state.battle!))
const modsOf = (g: G, kind: Parameters<BattleRun['mods']>[0], id = 'a1', tags: string[] = []): number => {
  const r = run(g)
  return r.mods(kind, r.unit(id), undefined, undefined, tags).reduce((s, p) => s + p.value, 0)
}
const stat = (k: Kernel, g: G, id: string): number => k.stats.stat(g.state, 'pc', id)

// ---- 一、格式：net 欄與 meat 欄同一套 ----

describe('net 欄的格式檢查（同一套封閉清單，訊息的前綴寫 net.）', () => {
  const load = (a: Rec, features: Feature[] = FEATURES) => () => {
    const k = createKernel(features)
    k.content.loadPack(pack([a]))
  }
  const act = (net: Rec, more: Rec = {}) => ab('sk_x', 'active', { use: { net: { ap: 1 } }, net: { target: 'none', ...net }, ...more })

  it('合格的內海欄載得進來（對照組：八個假技能整批載入）', () => {
    expect(() => {
      const k = createKernel(FEATURES)
      k.content.loadPack(pack())
    }).not.toThrow()
  })

  it.each([
    ['不認得的鍵', act({ dragon: true }), /net\.dragon/],
    ['do 裡沒有註冊的效果', act({ do: [{ op: 'ghost_op' }] }), /net\.do.*ghost_op/],
    ['do 裡不認得的 who', act({ do: [{ op: 'buff', who: 'everyone' }] }), /net\.do.*everyone/],
    ['mods 的 kind 不在清單裡', ab('sk_x', 'passive', { net: { mods: [{ kind: 'luck', value: 1 }] } }), /net\.mods\[0\]\.kind.*luck/],
    ['when 不認得的鍵', act({ when: { ghostwalk: true } }), /net\.when.*ghostwalk/],
    ['mods 才有的 when（in_cover）不能放在 net.when', act({ when: { in_cover: true } }), /net\.when.*in_cover/],
  ])('%s：載入被擋，訊息以 net. 開頭', (_name, skill, msg) => {
    expect(load(skill as Rec)).toThrow(msg)
    expect(load(skill as Rec)).not.toThrow(/meat\./)
  })

  it.each([
    ['叫人', act({ call: { options: ['shot'], per_fight: 'half_tier_up', ap: 1 } }), /net\.call 在內海沒有意義/],
    ['指揮', act({ give_ap: { max: 'one_plus_half_tier' } }), /net\.give_ap 在內海沒有意義/],
    ['戰鬥直覺', ab('sk_x', 'passive', { net: { instinct: true } }), /net\.instinct 在內海沒有意義/],
    ['誘惑攻擊', act({ tease: {} }, {}), /net\.tease 在內海沒有意義/],
    ['面具', ab('sk_x', 'passive', { net: { mask: { rounds: 2 } } }), /net\.mask 在內海沒有意義/],
    ['保釋', ab('sk_x', 'passive', { net: { ransom: { cash: 100 } } }), /net\.ransom 在內海沒有意義/],
    ['戰鬥外的姿態', ab('sk_x', 'stance', { use: { net: { ap: 1 } }, net: { out: { check: { skill: 'stealth', value: 2 } } } }), /net\.out 在內海沒有意義/],
    ['戰鬥外的檢定修正', ab('sk_x', 'passive', { net: { out_mods: [{ skill: 'stealth', value: 2 }] } }), /net\.out_mods 在內海沒有意義/],
    ['舊的字串寫法的反應', ab('sk_x', 'reaction', { use: { net: { ap: 1 } }, net: { trigger: 'ally_attacked', do: [buff('b')] } }), /net\.trigger 不能用舊的字串寫法/],
    ['彈匣的花法（attack.spend）', act({ target: 'enemy', attack: { spend: 2 } }), /net\.attack\.spend 在內海沒有意義/],
    ['壓制（attack.suppress）', act({ target: 'enemy', attack: { suppress: { dc: 12, skill: 'composure' } } }), /net\.attack\.suppress 在內海沒有意義/],
    ['現實的條件（when.mag_min）', act({ when: { mag_min: 1 } }), /net\.when\.mag_min 在內海沒有意義/],
    ['現實的目標條件（needs.cyber）', act({ target: 'enemy', needs: { cyber: true } }), /net\.needs\.cyber 在內海沒有意義/],
    ['現實的修正（call_uses）', ab('sk_x', 'passive', { net: { mods: [{ kind: 'call_uses', value: 1 }] } }), /net\.mods\[0\]\.kind「call_uses」在內海沒有意義/],
  ])('內海沒有意義的鍵（%s）擋掉，訊息說明原因', (_name, skill, msg) => {
    expect(load(skill as Rec)).toThrow(msg)
  })

  it('同樣的鍵寫在 meat 欄照舊載得進來（現實的格式沒動）', () => {
    expect(load(ab('sk_x', 'passive', { meat: { instinct: true } }))).not.toThrow()
    expect(load(ab('sk_x', 'active', { use: { ap: 1 }, meat: { target: 'enemy', attack: { spend: 2 } } }))).not.toThrow()
  })

  it('內海才有的鍵：格式不對的擋下（admin、slots、sync_cap、unique、overclock、when 的檔位）', () => {
    expect(load(ab('sk_x', 'passive', { net: { admin: 0 } }))).toThrow(/net\.admin/)
    expect(load(ab('sk_x', 'passive', { net: { admin: 'level' } }))).toThrow(/net\.admin/)
    expect(load(ab('sk_x', 'passive', { net: { slots: 0 } }))).toThrow(/net\.slots/)
    expect(load(ab('sk_x', 'passive', { net: { sync_cap: 1.5 } }))).toThrow(/net\.sync_cap/)
    expect(load(ab('sk_x', 'passive', { net: { unique: false } }))).toThrow(/net\.unique/)
    expect(load(ab('sk_x', 'passive', { net: { tags: ['overclock'] } }))).toThrow(/overclock/)
    expect(load(act({ when: { sync_min: 'abyss' } }))).toThrow(/net\.when\.sync_min/)
    expect(load(act({ when: { sync_min: 'full', sync_max: 'shallow' } }))).toThrow(/sync_min 不能比 sync_max 深/)
    // 兩欄都可以寫
    expect(load(ab('sk_x', 'passive', { meat: { slots: 1, unique: true, admin: 2, sync_cap: 1 } }))).not.toThrow()
  })

  it('use.admin 只有內海用；現實或輿論那一組不能寫；沒有裝 net.admin_spend 時用到它的技能載入就被擋', () => {
    expect(load(act({}, { use: { net: { ap: 1, admin: 1 } } }))).not.toThrow()
    expect(load(act({}, { use: { ap: 1, admin: 1 } }))).not.toThrow()
    expect(load(act({}, { use: { meat: { ap: 1, admin: 1 } } }))).toThrow(/use\.meat\.admin 只有內海用/)
    expect(load(act({}, { use: { net: { admin: 0 } } }))).toThrow(/use\.net\.admin/)
    expect(load(act({}, { use: { net: { ap: 1, admin: 1 } } }), [TEST_COMBAT, TEST_NET_COMBAT, abilitiesFeature])).toThrow(/net\.admin_spend/)
    // 沒用到 admin 的技能不受影響
    expect(load(act({}), [TEST_COMBAT, TEST_NET_COMBAT, abilitiesFeature])).not.toThrow()
  })

  it('兩欄都是主動的行動是同一個行動：目標的種類要一樣；內海欄的 alter 只改別的技能的內海欄', () => {
    // 跨筆的檢查在內容載完之後（ready）跑
    const ready = (skills: Rec[]) => () => {
      const k = createKernel(FEATURES)
      k.content.loadPack(pack(skills))
      readyFeatures(k)
    }
    expect(ready([ab('sk_x', 'active', { use: { ap: 1 }, meat: { target: 'enemy', do: [buff('b')] }, net: { target: 'none', do: [buff('b')] } })])).toThrow(/兩欄都是主動的行動，目標的種類要一樣/)
    expect(ready([ab('sk_x', 'active', { use: { ap: 1 }, meat: { target: 'none', do: [buff('b')] }, net: { target: 'none', do: [buff('b')] } })])).not.toThrow()
    expect(ready([
      ab('sk_target', 'active', { use: { ap: 1 }, meat: { target: 'none', do: [buff('b')] } }),
      ab('sk_alter', 'passive', { net: { alter: [{ ability: 'sk_target', set: { do: [buff('c')] } }] } }),
    ])).toThrow(/net\.alter\[0\] 要改的 sk_target 沒有 net/)
    expect(ready([
      ab('sk_target', 'active', { use: { net: { ap: 1 } }, net: { target: 'none', do: [buff('b')] } }),
      ab('sk_alter', 'passive', { net: { alter: [{ ability: 'sk_target', set: { do: [buff('c')] } }] } }),
    ])).not.toThrow()
    // 改完不合格也擋（內海欄的 alter 套在對方的內海欄上，用內海欄的規則檢查）
    expect(ready([
      ab('sk_target', 'active', { use: { net: { ap: 1 } }, net: { target: 'none', do: [buff('b')] } }),
      ab('sk_alter', 'passive', { net: { alter: [{ ability: 'sk_target', set: { call: { options: ['shot'] } } }] } }),
    ])).toThrow(/net\.alter\[0\] 改過 sk_target 之後不合格.*net\.call/)
  })

  it('預備的 prep.net：mods、do、trace_start 的格式；trace_start 只有 commission 的預備用', () => {
    const p = (net: Rec, scope = 'commission') => ab('sk_x', 'prep', { prep: { slot: 1, scope, net } })
    expect(load(p({ trace_start: -15 }))).not.toThrow()
    expect(load(p({ mods: [{ kind: 'evade', value: 1 }] }, 'next_battle'))).not.toThrow()
    expect(load(p({}))).toThrow(/prep\.net 要寫 mods、do 或 trace_start/)
    expect(load(p({ trace_start: 0 }))).toThrow(/prep\.net\.trace_start/)
    expect(load(p({ trace_start: 150 }))).toThrow(/prep\.net\.trace_start/)
    expect(load(p({ trace_start: -5 }, 'next_battle'))).toThrow(/只有 scope 是 commission/)
    expect(load(p({ do: [{ op: 'ghost_op' }] }))).toThrow(/prep\.net\.do.*ghost_op/)
    expect(load(p({ dragon: 1 }))).toThrow(/prep\.net\.dragon/)
    expect(load(ab('sk_x', 'passive', { prep: { slot: 1, scope: 'commission', net: { trace_start: -5 } } }))).toThrow(/prep\.net 只有預備技能/)
  })

  it('敵人的招牌行動：meat 或 net 至少要有一欄；net 欄也走同一套檢查', () => {
    const en = (more: Rec) => ab('en_x', 'active', { enemy: true, path: undefined, tier: undefined, layer: undefined, cap: undefined, xp: undefined, after: undefined, category: undefined, use: { ap: 1 }, ...more })
    expect(load(en({ net: { target: 'none', do: [buff('b')] } }))).not.toThrow()
    expect(load(en({}))).toThrow(/meat 或 net/)
    expect(load(en({ net: { target: 'none', dragon: 1 } }))).toThrow(/net\.dragon/)
  })
})

// ---- 二、照戰場選欄與選 use ----

describe('兩欄都有的技能：照戰場選欄與選 use', () => {
  it('現實戰鬥花 1 行動點、內海花 2，各做各欄的效果', () => {
    const m = playMeat(['sk_both'])
    turnTo(m)
    expect(opt(m, 'sk_both')!.cost).toEqual({ ap: 1, ram: 2 })
    expect(m.battleAct({ action: 'sk_both' }).status).toBe('applied')
    expect(unit(m).ap.now).toBe(unit(m).ap.max - 1)
    expect(unit(m).pools.ram!.now).toBe(4)
    expect(buffs(unit(m))).toEqual(['b_meat'])

    const n = playNet(['sk_both'])
    const ram = unit(n).pools.ram!.now
    turnTo(n)
    expect(opt(n, 'sk_both')!.cost).toEqual({ ap: 2, ram: 2 })
    expect(n.battleAct({ action: 'sk_both' }).status).toBe('applied')
    expect(unit(n).ap.now).toBe(unit(n).ap.max - 2)
    expect(unit(n).pools.ram!.now).toBe(ram - 2)
    expect(buffs(unit(n))).toEqual(['b_net'])
  })

  it('只有內海欄的技能：現實的圓環上沒有；只有現實欄的技能：內海的圓環上沒有', () => {
    const m = playMeat(['sk_admin_act', 'sk_unique_act', 'sk_both', 'sk_react', 'sk_stance'])
    turnTo(m)
    for (const id of ['sk_admin_act', 'sk_unique_act', 'sk_stance']) expect(opt(m, id), id).toBeUndefined()
    expect(opt(m, 'sk_both')).toBeDefined()
    // 行動註冊時寫明哪些戰場可以用
    expect(m.k.battle.getAction('sk_admin_act')!.modes).toEqual(['net'])
    expect(m.k.battle.getAction('sk_both')!.modes).toEqual(['meat', 'net'])

    const n = playNet(['sk_admin_act', 'sk_both'])
    turnTo(n)
    expect(opt(n, 'sk_admin_act')).toBeDefined()
    const meatOnly = playNet(['sk_both'], { skills: [ab('sk_m', 'active', { use: { ap: 1 }, meat: { target: 'none', do: [buff('b')] } })] })
    expect(meatOnly.k.battle.getAction('sk_m')!.modes).toEqual(['meat'])
    turnTo(meatOnly)
    expect(opt(meatOnly, 'sk_m')).toBeUndefined()
  })

  it('use 直接寫一組時兩個戰場都一樣；use.net 沒寫的那個戰場用預設（1 行動點）', () => {
    const skills = [
      ab('sk_flat', 'active', { use: { ap: 3 }, meat: { target: 'none', do: [buff('b1')] }, net: { target: 'none', do: [buff('b2')] } }),
      ab('sk_split', 'active', { use: { meat: { ap: 2 } }, meat: { target: 'none', do: [buff('b1')] }, net: { target: 'none', do: [buff('b2')] } }),
    ]
    const n = playNet(['sk_flat', 'sk_split'], { skills })
    turnTo(n)
    expect(opt(n, 'sk_flat')!.cost).toEqual({ ap: 3 })
    expect(opt(n, 'sk_split')!.cost).toEqual({ ap: 1 })
    const m = playMeat(['sk_flat', 'sk_split'], { skills })
    turnTo(m)
    expect(opt(m, 'sk_flat')!.cost).toEqual({ ap: 3 })
    expect(opt(m, 'sk_split')!.cost).toEqual({ ap: 2 })
  })

  it('被動、池、標籤：現實戰鬥只讀 meat 欄，內海戰鬥只讀 net 欄（現實的被動在內海不生效）', () => {
    const n = playNet(['sk_pass', 'sk_meat_pass'])
    const ram = unit(n).pools.ram!
    expect(ram.max).toBe(unit(playNet([])).pools.ram!.max + 1)
    expect(unit(n).tags).not.toContain('meat_tag')
    expect(modsOf(n, 'evade')).toBe(0)

    const m = playMeat(['sk_pass', 'sk_meat_pass'])
    expect(unit(m).tags).toContain('meat_tag')
    expect(unit(m).pools.ram!.max).toBe(7)
    expect(modsOf(m, 'evade')).toBe(3)
  })
})

// ---- 三、管理行動 ----

describe('管理行動（use.net.admin）', () => {
  const g0 = (admin = 2) => {
    SPENT.length = 0
    return playNet(['sk_admin_act'], { me: { ext: { ...equip('sk_admin_act'), net: NET({ admin }) } } })
  }

  it('結算時走效果 net.admin_spend：替身被叫到一次，行動點與 RAM 照 use 扣', () => {
    const g = g0()
    turnTo(g)
    const ram = unit(g).pools.ram!.now
    expect(opt(g, 'sk_admin_act')!.cost).toEqual({ ap: 0, ram: 1 })
    expect(opt(g, 'sk_admin_act')!.ok).toBe(true)
    expect(g.battleAct({ action: 'sk_admin_act' }).status).toBe('applied')
    expect(SPENT).toEqual([{ unit: 'a1', amount: 1 }])
    expect(unit(g).pools.ram!.now).toBe(ram - 1)
    expect(buffs(unit(g))).toEqual(['b_admin'])
  })

  it('這一回合沒有次數了：行動灰掉，原因寫出這一回合剩幾次；下一回合又可以；管理行動的修正會加次數', () => {
    const g = g0(1)
    turnTo(g)
    expect(g.battleAct({ action: 'sk_admin_act' }).status).toBe('applied')
    // 替身回報用完了（uses['turn:admin']）
    expect(unit(g).uses['turn:admin']).toBe(1)
    const o = opt(g, 'sk_admin_act')!
    expect(o.ok).toBe(false)
    expect(o.blocks.join('')).toMatch(/管理行動只剩 0 次.*一回合 1 次.*已經用了 1 次/)
    expect(SPENT).toHaveLength(1)
    // 下一回合（核心清掉 turn: 開頭的次數）：又可以
    delete unit(g).uses['turn:admin']
    expect(opt(g, 'sk_admin_act')!.ok).toBe(true)
  })

  it('沒有管理行動的基數（沒有主控這類權限）：灰掉，原因寫沒有次數', () => {
    SPENT.length = 0
    const g = playNet(['sk_admin_act'])
    turnTo(g)
    const o = opt(g, 'sk_admin_act')!
    expect(o.ok).toBe(false)
    expect(o.blocks.join('')).toMatch(/沒有管理行動的次數/)
    expect(SPENT).toEqual([])
  })

  it('次數的上限 = 基數加修正 admin_uses', () => {
    SPENT.length = 0
    const g = playNet(['sk_admin_act', 'sk_adm_plus'], {
      skills: [...SKILLS, ab('sk_adm_plus', 'passive', { net: { mods: [{ kind: 'admin_uses', value: 1 }] } })],
      me: { ext: { ...equip('sk_admin_act', 'sk_adm_plus'), net: NET({ admin: 1 }) } },
    })
    turnTo(g)
    unit(g).uses['turn:admin'] = 1
    expect(opt(g, 'sk_admin_act')!.ok).toBe(true)
    unit(g).uses['turn:admin'] = 2
    expect(opt(g, 'sk_admin_act')!.ok).toBe(false)
  })
})

// ---- 四、招牌：專屬構裝、基數、標籤 ----

describe('招牌（unique、admin: tier、tags: admin）', () => {
  it('內海的單位有 admin 標籤、ext.net.admin 等於樹階，而且原本放在 ext.net 的 sync 還在（合併、不整個蓋掉）', () => {
    const g = playNet(['sk_sig'], { me: { ext: { ...equip('sk_sig'), net: NET({ keep: 'yes' }) } } })
    expect(unit(g).tags).toContain('admin')
    expect(unit(g).ext.net).toMatchObject({ admin: 3, sync: 'standard', sync_max: 'full', keep: 'yes' })
    // ext.net 原本沒有也寫得出來
    const bare = playNet(['sk_sig'], { me: { ext: equip('sk_sig') } })
    expect(unit(bare).ext.net).toMatchObject({ admin: 3 })
    // 數字的寫法：加上別的來源；單位原本就有基數（敵人的資料）時加在它上面
    const more = playNet(['sk_sig', 'sk_adm1'], { skills: [...SKILLS, ab('sk_adm1', 'passive', { net: { admin: 1 } })], me: { ext: { ...equip('sk_sig', 'sk_adm1'), net: NET({ admin: 2 }) } } })
    expect(unit(more).ext.net).toMatchObject({ admin: 6 })
    // 現實戰鬥不寫、沒裝招牌的內海單位不寫
    expect(unit(playMeat(['sk_sig'])).ext.net).toBeUndefined()
    expect((unit(playNet([])).ext.net as Rec).admin).toBeUndefined()
  })

  it('戰鬥外：unique 每一個讓 deck_slots_reserved +1，slots 讓 deck_slots 加減，sync_cap 加到 sync_cap_bonus', () => {
    const owner = (...ids: string[]) => ({ pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { tree: 120 } } } } })
    const g = playNet([], { ...owner('sk_sig', 'sk_pass', 'sk_cap') })
    expect(stat(g.k, g, 'deck_slots_reserved')).toBe(1)
    expect(stat(g.k, g, 'deck_slots')).toBe(5)
    expect(stat(g.k, g, 'sync_cap_bonus')).toBe(1)
    // 兩個專屬構裝佔兩個槽；沒裝的不算
    const two = playNet([], { ...owner('sk_sig', 'sk_unique_act') })
    expect(stat(two.k, two, 'deck_slots_reserved')).toBe(2)
    expect(stat(two.k, two, 'deck_slots')).toBe(4)
    expect(stat(two.k, two, 'sync_cap_bonus')).toBe(0)
    const none = playNet([], { ...owner() })
    expect(stat(none.k, none, 'deck_slots_reserved')).toBe(0)
    // 兩欄都寫同一個數字不算兩次（內海欄優先）；只寫在 meat 欄的也算
    const both = playNet([], { ...owner('sk_two', 'sk_meat_slot'), skills: [...SKILLS, ab('sk_two', 'passive', { meat: { slots: 1, unique: true }, net: { slots: 1, unique: true } }), ab('sk_meat_slot', 'passive', { meat: { slots: 2 } })] })
    expect(stat(both.k, both, 'deck_slots_reserved')).toBe(1)
    expect(stat(both.k, both, 'deck_slots')).toBe(7)
  })

  it('沒有別人定義 sync_cap_bonus 時由技能這邊定義（基本 0）；別人定義了就不重複定義', () => {
    // FEATURES 沒有別人定義 sync_cap_bonus：技能定義了
    expect(createKernel(FEATURES).stats.hasStat('sync_cap_bonus')).toBe(false)
    const g = playNet([])
    expect(g.k.stats.hasStat('sync_cap_bonus')).toBe(true)
    // 別的功能先定義了：ready 不再定義（不會重複註冊丟錯）
    const other: Feature = { id: 'other_cap', install: (k) => k.stats.defineStat({ id: 'sync_cap_bonus', owner: 'other_cap', name: '別人的', base: () => 0 }) }
    expect(() => playNet([], { features: [...FEATURES, other] })).not.toThrow()
  })

  it('淺檔：招牌的修正不算、專屬構裝的行動灰掉並寫「淺檔」；超頻的行動灰掉；換回標準都恢復', () => {
    const g = playNet(['sk_sig', 'sk_unique_act', 'sk_oc', 'sk_both'])
    turnTo(g)
    expect(modsOf(g, 'hit')).toBe(2)
    expect(opt(g, 'sk_unique_act')!.ok).toBe(true)
    expect(opt(g, 'sk_oc')!.ok).toBe(true)

    setGear(g, 'shallow')
    expect(modsOf(g, 'hit')).toBe(0)
    const unique = opt(g, 'sk_unique_act')!
    expect(unique.ok).toBe(false)
    expect(unique.blocks.join('')).toMatch(/淺檔/)
    const oc = opt(g, 'sk_oc')!
    expect(oc.ok).toBe(false)
    expect(oc.blocks.join('')).toMatch(/淺檔.*超頻/)
    // 不是專屬構裝、也不是超頻的行動不受影響
    expect(opt(g, 'sk_both')!.ok).toBe(true)
    expect(g.battleAct({ action: 'sk_oc' }).status).toBe('refused')

    setGear(g, 'standard')
    expect(modsOf(g, 'hit')).toBe(2)
    expect(opt(g, 'sk_unique_act')!.ok).toBe(true)
    expect(opt(g, 'sk_oc')!.ok).toBe(true)
    expect(g.battleAct({ action: 'sk_oc' }).status).toBe('applied')
    expect(buffs(unit(g))).toEqual(['b_oc'])
  })

  it('淺檔時專屬構裝的反應與姿態不生效；沒有 sync: 標籤的單位當標準', () => {
    const skills = [...SKILLS, ab('sk_u_stance', 'stance', { use: { net: { ap: 1 } }, net: { unique: true, mods: [{ kind: 'evade', value: 4 }] } })]
    const g = playNet(['sk_u_stance'], { skills })
    turnTo(g)
    unit(g).tags = unit(g).tags.filter((t) => !t.startsWith('sync:'))
    expect(g.battleAct({ action: 'sk_u_stance' }).status).toBe('applied')
    expect(modsOf(g, 'evade')).toBe(4)
    setGear(g, 'shallow')
    expect(modsOf(g, 'evade')).toBe(0)
    setGear(g, 'deep')
    expect(modsOf(g, 'evade')).toBe(4)
  })
})

// ---- 五、同步檔位的條件與姿態 ----

describe('when.sync_min／sync_max 與姿態的 sync_cap', () => {
  it('sync_min: deep 的修正只在深檔與全檔時算；sync_max: standard 的只在淺檔與標準檔時算', () => {
    const g = playNet(['sk_deep'])
    const at = (gear: string): [number, number] => {
      setGear(g, gear)
      return [modsOf(g, 'hit'), modsOf(g, 'save')]
    }
    expect(at('shallow')).toEqual([0, 6])
    expect(at('standard')).toEqual([0, 6])
    expect(at('deep')).toEqual([4, 0])
    expect(at('full')).toEqual([4, 0])
    // 沒有 sync: 標籤的單位當標準
    unit(g).tags = unit(g).tags.filter((t) => !t.startsWith('sync:'))
    expect([modsOf(g, 'hit'), modsOf(g, 'save')]).toEqual([0, 6])
  })

  it('檔位的條件也能擋行動，原因寫出現在的檔位', () => {
    const skills = [...SKILLS, ab('sk_deep_act', 'active', { use: { net: { ap: 1 } }, net: { target: 'none', when: { sync_min: 'deep' }, do: [buff('b')] } })]
    const g = playNet(['sk_deep_act'], { skills })
    turnTo(g)
    expect(opt(g, 'sk_deep_act')!.blocks.join('')).toMatch(/同步檔位要在深檔以上才能用（現在是標準檔）/)
    setGear(g, 'deep')
    expect(opt(g, 'sk_deep_act')!.ok).toBe(true)
  })

  it('姿態開著時修正 sync_cap 是 +1；關著是 0', () => {
    const g = playNet(['sk_stance'])
    turnTo(g)
    expect(modsOf(g, 'sync_cap')).toBe(0)
    expect(g.battleAct({ action: 'sk_stance' }).status).toBe('applied')
    expect(modsOf(g, 'sync_cap')).toBe(1)
    turnTo(g)
    expect(g.battleAct({ action: 'sk_stance' }).status).toBe('applied')
    expect(modsOf(g, 'sync_cap')).toBe(0)
  })
})

// ---- 六、反應 ----

describe('反應照戰場選欄', () => {
  const evadeAgainst = (g: G): { evade: number; ap: number } => {
    const r = run(g, [10, 1, 1, 1, 1, 1])
    const res = r.attack(r.unit('f1'), r.unit('a1'))
    return { evade: res.evade, ap: r.unit('a1').ap.now }
  }

  it('內海欄的反應在內海觸發（迴避 +3、花 use.net 的行動點）；寫在現實欄的反應在內海不觸發', () => {
    const f = [lace({ weapons: [{ ...laceUnit('minion', 1).weapons![0]!, hit: 30 }] })]
    const base = evadeAgainst(playNet([], { foes: f }))
    const g = playNet(['sk_react', 'sk_react_meat'], { foes: f })
    const r = evadeAgainst(g)
    expect(r.evade - base.evade).toBe(3)
    expect(base.ap - r.ap).toBe(1)
  })

  it('專屬構裝的反應淺檔不觸發', () => {
    const skills = [...SKILLS, ab('sk_u_react', 'reaction', { use: { net: { ap: 1 } }, net: { unique: true, trigger: { on: 'attacked', who: 'self' }, react: { evade: 3 } } })]
    const f = [lace()]
    const base = evadeAgainst(playNet([], { foes: f }))
    const g = playNet(['sk_u_react'], { skills, foes: f })
    expect(evadeAgainst(g).evade - base.evade).toBe(3)
    const h = playNet(['sk_u_react'], { skills, foes: f })
    setGear(h, 'shallow')
    expect(evadeAgainst(h).evade).toBe(base.evade)
  })
})

// ---- 七、預備 ----

describe('預備（prep.net）', () => {
  const owner = (prepared: Rec[], ids = ['sk_prep', 'sk_prep_meat']) => ({ pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { tree: 120 }, prepared } } } })
  const traceStart = (g: G, job: string | null): number => {
    ACTIVE_JOB = job
    try {
      return stat(g.k, g, 'net_trace_start')
    } finally {
      ACTIVE_JOB = null
    }
  }

  it('預備好並綁到委託甲：net_trace_start 是 −15；沒綁、綁的是別件、沒有進行中的委託都是 0', () => {
    const bound = playNet([], { pc: owner([{ id: 'sk_prep', scope: 'commission', key: 'jobA' }]).pc })
    expect(traceStart(bound, 'jobA')).toBe(-15)
    expect(traceStart(bound, 'jobB')).toBe(0)
    expect(traceStart(bound, null)).toBe(0)
    expect(traceStartOf(bound.k, bound.state, 'pc')).toBe(0)
    const unbound = playNet([], { pc: owner([{ id: 'sk_prep', scope: 'commission' }]).pc })
    expect(traceStart(unbound, 'jobA')).toBe(0)
    // 沒預備、預備的是現實的：0
    expect(traceStart(playNet([], { pc: owner([]).pc }), 'jobA')).toBe(0)
    expect(traceStart(playNet([], { pc: owner([{ id: 'sk_prep_meat', scope: 'next_battle' }]).pc }), 'jobA')).toBe(0)
  })

  it('預備時指定委託，綁在那一件上（等不到第一場戰鬥）；幾份加起來', () => {
    const g = playNet([], { pc: { ext: { abilities: { xp: 0, learned: ['sk_prep', 'sk_prep2'], equipped: ['sk_prep', 'sk_prep2'], spent: { tree: 120 } } } }, skills: [...SKILLS, ab('sk_prep2', 'prep', { prep: { slot: 0, scope: 'commission', net: { trace_start: 5 } } })] })
    // 戰鬥外才能預備：先把這場戰鬥結束掉
    g.state.battle = null as never
    g.commit(prep(g.k, g.state, 'pc', 'sk_prep', { commission: 'jobA' }))
    g.commit(prep(g.k, g.state, 'pc', 'sk_prep2', { commission: 'jobB' }))
    expect(abilitiesOf(g.state, 'pc').prepared).toEqual([{ id: 'sk_prep', scope: 'commission', key: 'jobA' }, { id: 'sk_prep2', scope: 'commission', key: 'jobB' }])
    expect(traceStart(g, 'jobA')).toBe(-15)
    expect(traceStart(g, 'jobB')).toBe(5)
  })

  it('prep.net 的 mods 與 do 帶進內海戰鬥；現實的預備在內海不帶，現實戰鬥不帶只有 prep.net 的預備', async () => {
    ACTIVE_JOB = null
    const prepared = [{ id: 'sk_prep', scope: 'next_battle' }, { id: 'sk_prep_meat', scope: 'next_battle' }]
    const skills = SKILLS.map((s) => (s.id === 'sk_prep' ? { ...s, prep: { ...(s.prep as Rec), scope: 'next_battle', net: { mods: [{ kind: 'evade', value: 2 }], do: [buff('b_prep')] } } } : s))
    const g = playNet([], { pc: owner(prepared).pc, skills, me: { ext: {} } })
    // 帶進來的修正 +2，加上開打時做的 do（buff 的迴避 +1）
    expect(modsOf(g, 'evade')).toBe(3)
    expect(buffs(unit(g))).toEqual(['b_prep'])
    // 用掉的是帶進來的那一份：打完之後只剩現實的預備
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    await g.finishBattle()
    expect(abilitiesOf(g.state, 'pc').prepared).toEqual([{ id: 'sk_prep_meat', scope: 'next_battle' }])

    // 現實戰鬥：帶 prep.meat 的，不帶只有 prep.net 的
    const m = playMeat([], { pc: owner(prepared).pc, skills, me: { ext: {} } })
    expect(modsOf(m, 'evade')).toBe(1)
    expect(buffs(unit(m))).toEqual([])
    m.state.battle!.result = { outcome: 'win', text: '測試用。' }
    await m.finishBattle()
    expect(abilitiesOf(m.state, 'pc').prepared).toEqual([{ id: 'sk_prep', scope: 'next_battle' }])
  })
})

// ---- 八、敵人的招牌行動 ----

describe('敵人的招牌行動照同一條路選欄', () => {
  it('只寫了 meat 的招牌在內海沒有，寫了 net 的才有（反過來現實也一樣）', () => {
    const f = [lace({ ext: { abilities: { equipped: ['en_meat', 'en_net'], tiers: {} }, net: NET() } })]
    const n = playNet([], { foes: f })
    const r = run(n)
    const def = (id: string) => n.k.battle.getAction(id)!
    expect(def('en_meat').has!(r, r.unit('f1'))).toBe(false)
    expect(def('en_net').has!(r, r.unit('f1'))).toBe(true)
    expect(def('en_meat').modes).toEqual(['meat'])
    expect(def('en_net').modes).toEqual(['net'])

    const m = playMeat([], { foes: [partyUnit(1, 1, { enemy: { id: 'x' }, ext: { abilities: { equipped: ['en_meat', 'en_net'], tiers: {} } } } as never)] })
    const rm = run(m)
    expect(m.k.battle.getAction('en_meat')!.has!(rm, rm.unit('f1'))).toBe(true)
    expect(m.k.battle.getAction('en_net')!.has!(rm, rm.unit('f1'))).toBe(false)
  })
})

describe('AI 代打：內海欄的招牌行動進得了 AI 的選擇', () => {
  it('敵人的 net 欄招牌行動（寫了 ai）AI 會用；只有 meat 欄的不會；整場打得完', () => {
    const skills = [
      ab('en_net_ai', 'active', { enemy: true, path: undefined, tier: undefined, layer: undefined, cap: undefined, xp: undefined, after: undefined, category: undefined, use: { net: { ap: 1 } }, ai: { score: 9 }, net: { target: 'none', do: [buff('b_en_net_ai')] } }),
      ab('en_meat_ai', 'active', { enemy: true, path: undefined, tier: undefined, layer: undefined, cap: undefined, xp: undefined, after: undefined, category: undefined, use: { ap: 1 }, ai: { score: 9 }, meat: { target: 'none', do: [buff('b_en_meat_ai')] } }),
    ]
    const g = makeBattleGame({
      features: FEATURES, content: [pack(skills)], seed: 3,
      battle: netDuel([meNet([]), netAvatar(1, 1)], [laceUnit('minion', 1, { ext: { abilities: { equipped: ['en_net_ai', 'en_meat_ai'], tiers: {} }, net: NET() } } as never)]),
    } as never).game
    const out = playOut(g)
    expect(['win', 'lose']).toContain(out.outcome)
    const used = (g.state.battle!.units.f1!.ext.abilities as Rec).buffs as Array<{ id: string }> | undefined
    const ids = (used ?? []).map((b) => b.id)
    expect(ids).toContain('b_en_net_ai')
    expect(ids).not.toContain('b_en_meat_ai')
  })
})
