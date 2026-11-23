// 驗收測試：dev/work/M1b-review-features.md（cpp-feature）。M1b 審查（dev/reviews/2026-11-23-M1b.md）與白箱（W012、W013）裡屬於功能的項目：
// E2 隊伍共用的現金與人情、E6 快取格放什麼、W013 救回來清 buff、W012 給的人退出時 buff 與臨時遮蔽結束、
// 「花掉全部 RAM」的 spent、buff 的 next_overload、沉溺走 gainSink、蜂群不灌感載由資料決定。
// （E4 卡彈炸膛、E5 敢打我家孩子、潛網者標籤、接管到期、改寫的敵我、掉落件數的測試在各自功能的測試檔：M1b-ordnance、M1b-core-closeout、
// M1b-skill-pilot、M1b-hack、M1b-loot。）內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleTarget, BattleUnit, ContentPack, Kernel } from '../../src'
import { coverAt, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { syncWallet, walletOf } from '../../src/features/abilities/wallet'
import { endChanges } from '../../src/features/abilities/end'
import { combatFeature } from '../../src/features/combat'
import { QUICK_CATEGORIES, quickBlock } from '../../src/features/gear'
import { hackFeature } from '../../src/features/hack'
import { makeActor, makeBattleGame, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature, hackFeature]
const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const

// ---- 假資料 ----

const TREE = { id: 'tree', name: '測試路數', tree: '測試樹', category: 'meat', signature: 'sk_root', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] as Rec[] }
const ab = (id: string, kind: string, more: Rec = {}): Rec => ({
  id, name: id, path: 'tree', category: 'meat', tier: 1, layer: 'front', kind, cap: 1, xp: 20, cells: 1, after: 'sk_root', text: `${id}。`, net: null, opinion: null, meat: null, ...more,
})
const ABILITIES: Rec[] = [
  ab('sk_root', 'passive', { layer: 'signature', after: undefined, name: '根' }),
  // 收買：花現金 600（隊伍的錢包）
  ab('sk_bribe', 'active', { use: { ap: 1, cash: 600 }, meat: { target: 'self', do: [{ op: 'heal', who: 'self', amount: 1 }] } }),
  // 討人情：花一個中人情
  ab('sk_owe', 'active', { use: { ap: 1, favor: 'mid' }, meat: { target: 'self', do: [{ op: 'heal', who: 'self', amount: 1 }] } }),
  // 黑冰：花掉全部 RAM（至少 3），每花 1 點 RAM 擲一顆 d6 感載；根權限一樣的減免寫在 action_ram
  ab('sk_black', 'active', { use: { ap: 1, ram_all_min: 3 }, meat: { action_tags: ['hack'], target: 'enemy', do: [{ op: 'load', amount: 'spent', type: 'neural', who: 'target' }] } }),
  ab('sk_root_ram', 'passive', { name: '根權限', meat: { mods: [{ kind: 'action_ram', value: -1, tags: ['hack'] }] } }),
  ab('sk_cheer', 'active', { use: { ap: 1 }, meat: { target: 'self', do: [{ op: 'buff', id: 'cheer', name: '鼓舞', turns: 3, until: 'own_turn_end', mods: [{ kind: 'hit', value: 1 }] }] } }),
]
const PACK = {
  id: 'review_features',
  content: {
    battle_status: TEST_STATUSES, path: [TREE], ability: ABILITIES,
    item: [
      { id: 'it_gel', name: '凝膠', desc: '急救。', category: 'consumable', grade: 1, size: 1, legal: 'free' },
      { id: 'it_pill', name: '藥丸', desc: '一顆藥。', category: 'consumable', grade: 1, size: 1, legal: 'free', tags: ['drug'] },
      { id: 'am_x', name: '彈匣', desc: '彈匣。', category: 'ammo', grade: 1, size: 1, legal: 'free' },
      { id: 'it_tool', name: '撬棍', desc: '工具。', category: 'tool', grade: 1, size: 1, legal: 'free' },
      { id: 'it_ring', name: '戒指', desc: '飾品。', category: 'accessory', grade: 1, size: 0, legal: 'free' },
      { id: 'it_junk', name: '雜物', desc: '雜物。', category: 'misc', grade: 1, size: 1, legal: 'free' },
    ],
  },
} as unknown as ContentPack
const BASE = { id: 'review_base', content: { battle_status: TEST_STATUSES } } as unknown as ContentPack
const dice = (...v: number[]) => [...v, ...Array(200).fill(1)]
const equip = (ids: string[]) => ({ abilities: { equipped: ids, tiers: { tree: 3 } } })
/** 兩個隊員（主角 pc 與夥伴 buddy）各裝著這幾個技能、各自拿手槍；錢包 money.cash。 */
function party(ids: string[], o: { cash?: number; pcExt?: Rec; buddyExt?: Rec; foes?: unknown[]; ram?: number } = {}) {
  const ram = o.ram === undefined ? {} : { tags: ['quickhack'], pools: { ram: { now: o.ram, max: o.ram, regen: 0 } } }
  const deck = o.ram === undefined ? {} : { deck: { grade: 3, firewall: 12, slots: [] } }
  const buddy = makeActor({ id: 'buddy', name: '夥伴', role: 'companion', ext: o.buddyExt ?? {} })
  return makeBattleGame({
    features: FEATURES, content: [PACK], seed: 7, actors: [buddy], pc: { ext: o.pcExt ?? {} }, patch: { money: { cred: 0, cash: o.cash ?? 1000 } },
    battle: duel(
      [one({ actor: 'pc', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 }, ext: { ...equip(ids), ...deck }, ...ram } as never), one({ actor: 'buddy', weapon: 'pistol', ap: { now: 20, max: 20, regen: 3 }, ext: { ...equip(ids), ...deck }, ...ram } as never, 2)],
      o.foes ?? [foe('minion', { ap: { now: 0, max: 0, regen: 0 }, hp: { now: 300, max: 300 } } as never), foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)],
    ),
  }).game
}
type G = ReturnType<typeof party>
const unit = (g: G, id: string): BattleUnit => g.state.battle!.units[id]!
const turnTo = (g: G, id: string): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = 'player'
  return u
}
const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)!
const finish = async (g: G, outcome = 'win') => {
  g.state.battle!.result = { outcome, text: '測試用。' }
  return (await g.finishBattle()).reports[0]!
}

// =====================================================================================================================
describe('E2：現金與人情是隊伍共用的一份（FIXER 第 8 節；dev/adr/0015 E2）', () => {
  it('開打時每個隊員的現金池是同一個隊伍的錢包；主角花了 600，夥伴的池也跟著少 600（不再各有一整份）', () => {
    const g = party(['sk_bribe'])
    expect([unit(g, 'a1').pools.cash!.now, unit(g, 'a2').pools.cash!.now]).toEqual([1000, 1000])
    turnTo(g, 'a1')
    expect(g.battleAct({ action: 'sk_bribe', target: { unit: 'a1' } }).status).toBe('applied')
    expect([unit(g, 'a1').pools.cash!.now, unit(g, 'a2').pools.cash!.now]).toEqual([400, 400])
  })

  it('同一個錢包只能花一次：主角花了 600 之後，夥伴再收買 600 被擋下（現金不夠：要 600，現在 400）', () => {
    const g = party(['sk_bribe'])
    turnTo(g, 'a1')
    g.battleAct({ action: 'sk_bribe', target: { unit: 'a1' } })
    turnTo(g, 'a2')
    expect(opt(g, 'sk_bribe').ok).toBe(false)
    expect(opt(g, 'sk_bribe').blocks.join('')).toMatch(/現金不夠（要 600，現在 400）/)
    const r = g.battleAct({ action: 'sk_bribe', target: { unit: 'a2' } })
    expect(r.status).toBe('refused')
  })

  it('戰鬥結束時只扣一次：兩個人合起來花了 600，錢包少 600；花超過的（兩個人各花 600，總共 1200）做不到', async () => {
    const g = party(['sk_bribe'], { cash: 1300 })
    turnTo(g, 'a1')
    g.battleAct({ action: 'sk_bribe', target: { unit: 'a1' } })
    turnTo(g, 'a2')
    expect(g.battleAct({ action: 'sk_bribe', target: { unit: 'a2' } }).status).toBe('applied')
    expect(unit(g, 'a2').pools.cash!.now).toBe(100)
    const end = await finish(g)
    expect(end.changes.filter((c) => c.op === 'cash')).toEqual([{ op: 'cash', delta: -1200 }])
    expect(g.state.money.cash).toBe(100)
  })

  it('一個人花、結束時 endChanges 只算一次：每個池取同一個數字，不是各自相加', () => {
    const g = party(['sk_bribe'], { cash: 1000 })
    turnTo(g, 'a1')
    g.battleAct({ action: 'sk_bribe', target: { unit: 'a1' } })
    expect(endChanges(g.state, g.state.battle!).filter((c) => c.op === 'cash')).toEqual([{ op: 'cash', delta: -600 }])
    // 沒人花：沒有這一筆
    expect(endChanges(party(['sk_bribe']).state, party(['sk_bribe']).state.battle!).filter((c) => c.op === 'cash')).toEqual([])
  })

  it('人情記在主角名下：夥伴自己的 ext.favors 不算；主角的一個中人情夥伴也用得到，用掉之後主角沒有了、結束時寫回主角', async () => {
    const g = party(['sk_owe'], { pcExt: { favors: { small: 0, mid: 1, big: 0 } }, buddyExt: { favors: { small: 5, mid: 5, big: 5 } } })
    expect([unit(g, 'a2').pools.favor_mid!.now, unit(g, 'a2').pools.favor_small!.now]).toEqual([1, 0])
    turnTo(g, 'a2')
    expect(g.battleAct({ action: 'sk_owe', target: { unit: 'a2' } }).status).toBe('applied')
    expect(unit(g, 'a1').pools.favor_mid!.now).toBe(0)
    turnTo(g, 'a1')
    expect(opt(g, 'sk_owe').ok).toBe(false)
    await finish(g)
    expect(g.state.actors.pc!.ext.favors).toEqual({ small: 0, mid: 0, big: 0 })
    expect(g.state.actors.buddy!.ext.favors).toEqual({ small: 5, mid: 5, big: 5 })
  })

  it('syncWallet：每個人自己改了多少都算進去（花掉、補回來），同步成同一個數字；上限是池的上限', () => {
    const g = party(['sk_bribe'], { cash: 1000 })
    const b = g.state.battle!
    const run = { battle: b }
    unit(g, 'a1').pools.cash!.now -= 300
    syncWallet(run)
    expect([unit(g, 'a1').pools.cash!.now, unit(g, 'a2').pools.cash!.now]).toEqual([700, 700])
    // 兩個人各自改了：夥伴花 100、主角補回 50（總共 −50）
    unit(g, 'a2').pools.cash!.now -= 100
    unit(g, 'a1').pools.cash!.now += 50
    syncWallet(run)
    expect(walletOf(b, 'cash')).toEqual({ now: 650, max: 1000 })
    expect([unit(g, 'a1').pools.cash!.now, unit(g, 'a2').pools.cash!.now]).toEqual([650, 650])
    // 補超過上限：夾在上限
    unit(g, 'a1').pools.cash!.now += 5000
    syncWallet(run)
    expect(unit(g, 'a2').pools.cash!.now).toBe(1000)
  })

  it('敵人（沒有角色）沒有錢包；沒有人帶這個池時 walletOf 是 undefined', () => {
    const g = party(['sk_bribe'])
    expect(unit(g, 'f1').pools.cash).toBeUndefined()
    expect(walletOf({ units: { f1: unit(g, 'f1') } }, 'cash')).toBeUndefined()
  })
})

// =====================================================================================================================
describe('E6：快取格放什麼只看引擎（EQUIPMENT 第 2、4.1 節：藥、彈匣、手榴彈、工具）', () => {
  const k = (): Kernel => {
    const a = arena(duel([one({}, 1)], [foe()]), FEATURES, (kk) => {
      kk.content.loadPack(PACK)
      readyFeatures(kk)
    })
    return a.k
  }

  it('消耗品（含手榴彈、急救）、藥（category 或標籤）、彈匣、工具放得進；飾品、雜物、不在目錄裡的不行，原因是一句話', () => {
    const kern = k()
    expect(QUICK_CATEGORIES).toEqual(['consumable', 'drug', 'ammo', 'tool'])
    for (const id of ['it_gel', 'it_pill', 'am_x', 'it_tool']) expect(quickBlock(kern, id), id).toBeNull()
    for (const id of ['it_ring', 'it_junk', 'it_ghost']) expect(quickBlock(kern, id), id).toMatch(/不能放進快取格/)
  })
})

// =====================================================================================================================
describe('W013：被救回來的人，技能的 buff 也清（dev/adr/0015 revive「狀態清空」）', () => {
  const field = (): Arena => arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe('minion', { hp: { now: 300, max: 300 }, ap: { now: 0, max: 0, regen: 0 } } as never)]), FEATURES, (kk) => {
    kk.content.loadPack(PACK)
    readyFeatures(kk)
  })
  const buffsOf = (u: BattleUnit): string[] => (((u.ext.abilities as Rec | undefined)?.buffs ?? []) as Rec[]).map((b) => b.id as string)

  it('倒下又救回來：buff 沒了、修正也沒了（不做 on_end）；姿態清空；持續型快駭也清', () => {
    const a = field()
    const run = a.run(dice())
    const me = a.ally(1)
    run.effects([{ op: 'buff', id: 'b', until: 'battle_end', mods: [{ kind: 'hit', value: 1 }], on_end: [{ op: 'load', exact: true, amount: 9 }] }], { user: me, target: { unit: 'a1' }, source: SRC })
    me.stance = 'sk_x'
    me.ext.hack = { dot: { name: '迴圈', amount: 3, turns: 2, by: 'f1', tier: 1 } }
    expect(buffsOf(me)).toEqual(['b'])
    run.setOut(me, 'down', a.foe(1))
    expect(run.revive(me, 5)).toBe(true)
    expect(buffsOf(me)).toEqual([])
    expect(me.stance).toBeUndefined()
    expect((me.ext.hack as Rec).dot).toBeUndefined()
    expect(me.load!.now).toBe(0)
    expect(run.mods('hit', me).filter((p) => p.source === 'skill')).toEqual([])
    // 隊友的 buff 不受影響
    run.effects([{ op: 'buff', id: 'mate', until: 'battle_end', mods: [{ kind: 'hit', value: 1 }] }], { user: me, target: { unit: 'a2' }, source: SRC })
    run.setOut(me, 'down', a.foe(1))
    run.revive(me, 5)
    expect(buffsOf(a.ally(2))).toEqual(['mate'])
  })
})

// =====================================================================================================================
describe('W012：計時看的那個人退出之後，他給的東西結束（SKILL_TREES 跑位射擊；和守著、監視一樣）', () => {
  const field = (): Arena => arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe('minion', { hp: { now: 300, max: 300 }, ap: { now: 0, max: 0, regen: 0 } } as never)], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), FEATURES, (kk) => {
    kk.content.loadPack(PACK)
    readyFeatures(kk)
  })
  const buffsOf = (u: BattleUnit): string[] => (((u.ext.abilities as Rec | undefined)?.buffs ?? []) as Rec[]).map((b) => b.id as string)

  it('臨時遮蔽（cover_temp）：做的人在下一回合之前倒下，升上去的那一級當場拿回來', () => {
    const a = field()
    const run = a.run(dice())
    run.effects([{ op: 'cover_temp', levels: 1 }], { user: a.ally(1), target: { unit: 'a1' }, source: SRC })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(1)
    run.setOut(a.ally(1), 'down', a.foe(1))
    expect(coverAt(a.battle, 'ally', 1).level).toBe(0)
    // 做的人還在：照舊留到他的下一回合開始
    const b = field()
    b.run(dice()).effects([{ op: 'cover_temp', levels: 1 }], { user: b.ally(1), target: { unit: 'a1' }, source: SRC })
    b.run(dice()).setOut(b.ally(2), 'down', b.foe(1))
    expect(coverAt(b.battle, 'ally', 1).level).toBe(1)
  })

  it('source_turn_end 與 source_turn_start 的 buff：給的人退出就結束（做 on_end）；給別人的、他自己身上的 own_turn_end 不在這裡處理', () => {
    const a = field()
    const run = a.run(dice())
    const src = { user: a.ally(2), target: { unit: 'a1' } as BattleTarget, source: SRC }
    run.effects([{ op: 'buff', id: 'src_end', until: 'source_turn_end', turns: 1, mods: [{ kind: 'evade', value: 1 }], on_end: [{ op: 'load', exact: true, amount: 4 }] }], src)
    run.effects([{ op: 'buff', id: 'src_start', until: 'source_turn_start', turns: 2, mods: [{ kind: 'evade', value: 1 }] }], src)
    run.effects([{ op: 'buff', id: 'own', until: 'own_turn_end', turns: 3, mods: [{ kind: 'evade', value: 1 }] }], src)
    expect(buffsOf(a.ally(1))).toEqual(['src_end', 'src_start', 'own'])
    run.setOut(a.ally(2), 'down', a.foe(1))
    expect(buffsOf(a.ally(1))).toEqual(['own'])
    expect(a.ally(1).load!.now).toBe(4)
    expect(run.beats.filter((b) => b.tag === 'status.end')).toHaveLength(2)
  })

  it('別人退出不影響：a1 給 a2 的 buff，a2 倒下時還在（給的人是 a1）', () => {
    const a = field()
    const run = a.run(dice())
    run.effects([{ op: 'buff', id: 'src', until: 'source_turn_end', turns: 1, mods: [{ kind: 'evade', value: 1 }] }], { user: a.ally(1), target: { unit: 'a2' }, source: SRC })
    run.setOut(a.ally(2), 'down', a.foe(1))
    expect(buffsOf(a.ally(2))).toEqual(['src'])
  })
})

// =====================================================================================================================
describe('buff 的 until: next_overload：過載的那一刻結束；沒有過載留到戰鬥結束（不變式第 69 條）', () => {
  it('過載時結束（做 on_end）；別人過載、沒有過載都不影響', () => {
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)]), FEATURES, (kk) => {
      kk.content.loadPack(PACK)
      readyFeatures(kk)
    })
    const run = a.run(dice())
    const buff = (u: string, id: string) => run.effects([{ op: 'buff', id, until: 'next_overload', mods: [{ kind: 'evade', value: 1 }], on_end: [{ op: 'heal', amount: 1, who: 'self' }] }], { user: a.ally(1), target: { unit: u }, source: SRC })
    buff('a1', 'shield')
    buff('a2', 'shield2')
    const ids = (u: BattleUnit) => (((u.ext.abilities as Rec | undefined)?.buffs ?? []) as Rec[]).map((b) => b.id)
    expect([ids(a.ally(1)), ids(a.ally(2))]).toEqual([['shield'], ['shield2']])
    run.overload(a.ally(2), a.foe(1))
    expect(ids(a.ally(2))).toEqual([])
    expect(ids(a.ally(1))).toEqual(['shield'])
    expect(run.beats.some((b) => b.tag === 'status.end' && (b.data as Rec).buff === 'shield2')).toBe(true)
  })

  it('餘韻疊滿再過載（昏過去）：先發 out.before { how: burnout }，buff 照樣結束（有沒有人擋下都一樣）', () => {
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)]), FEATURES, (kk) => {
      kk.content.loadPack(PACK)
      readyFeatures(kk)
    })
    const run = a.run(dice())
    const me = a.ally(1)
    run.effects([{ op: 'buff', id: 'shield', until: 'next_overload', mods: [{ kind: 'evade', value: 1 }] }], { user: me, target: { unit: 'a1' }, source: SRC })
    me.layers = me.layersMax
    me.load!.now = me.load!.max
    run.overload(me, a.foe(1))
    expect(me.out).toBe('burnout')
    expect((((me.ext.abilities as Rec).buffs ?? []) as Rec[]).length).toBe(0)
  })
})

describe('效果層的小項（M1b-review-features 跟進）', () => {
  const field = (): Arena => arena(duel([one({ weapon: 'pistol' })], [foe('minion', { ap: { now: 0, max: 0, regen: 0 }, hp: { now: 300, max: 300 } } as never)]), [combatFeature], (kk) => {
    kk.content.loadPack(BASE)
  })

  it('S11：被取消的一擊沒有命中也沒有失手：if: miss 不成立、last.aborted；打出去失手的 if: miss 成立', () => {
    const a = field()
    let cancel = true
    a.k.battle.on('attack.before', 'spy', ({ opts }) => { if (cancel) opts.cancel = '這一擊被取消了。' })
    const use = { user: a.ally(1), target: { unit: 'f1' } as BattleTarget, source: SRC }
    const hp = a.foe(1).hp!.now
    const last = a.run(dice()).effects([{ op: 'attack' }, { op: 'damage', amount: 5, if: 'miss' }], use)
    expect(last.aborted).toBe(true)
    expect(last.hit).toBeUndefined()
    expect(a.foe(1).hp!.now).toBe(hp)
    cancel = false
    const missed = a.run(dice(1, 1, 1, 1)).effects([{ op: 'attack' }, { op: 'damage', amount: 5, if: 'miss' }], use)
    expect(missed.hit).toBe(false)
    expect(a.foe(1).hp!.now).toBeLessThan(hp)
  })

  it('S10：資源池的紀錄用中文名（現金、RAM），不是把鍵轉大寫', () => {
    const a = field()
    a.ally(1).pools.cash = { now: 0, max: 500, regen: 0 }
    const run = a.run(dice())
    run.effects([{ op: 'pool', pool: 'cash', amount: 'full' }], { user: a.ally(1), target: { unit: 'a1' }, source: SRC })
    expect(run.beats.map((b) => b.text).join()).toMatch(/的現金 \+500/)
  })
})

describe('E1：攻擊的人在反應裡被打下來（含替身那一台被擊落）就停，不再起後面的反應', () => {
  it('run.gone：退出的人、被擊落的替身都算；還在的不算', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)]), [combatFeature], (kk) => kk.content.loadPack(BASE))
    const run = a.run(dice())
    expect(run.gone(a.foe(1))).toBe(false)
    run.setOut(a.foe(1), 'down')
    expect(run.gone(a.foe(1))).toBe(true)
  })
})

// =====================================================================================================================
describe('花掉全部 RAM 的技能：spent 是實際花的點數（RAM 的減免之後）；不靠呼叫順序', () => {
  const play = (ids: string[], ram: number) => party(ids, { ram, foes: [foe('minion', { ap: { now: 0, max: 0, regen: 0 }, hp: { now: 300, max: 300 }, load: { now: 0, max: 999 } } as never), foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)] })

  it('沒有減免：RAM 6 全花，spent 6（感載 +6）', () => {
    const g = play(['sk_black'], 6)
    turnTo(g, 'a1')
    expect(opt(g, 'sk_black').cost).toMatchObject({ ram: 6 })
    expect(g.battleAct({ action: 'sk_black', target: { unit: 'f1' } }).status).toBe('applied')
    expect(unit(g, 'a1').pools.ram!.now).toBe(0)
    expect(unit(g, 'f1').load!.now).toBe(6)
  })

  it('根權限（action_ram −1）：花 5、剩 1；spent 是 5，不是 6', () => {
    const g = play(['sk_black', 'sk_root_ram'], 6)
    turnTo(g, 'a1')
    expect(opt(g, 'sk_black').cost).toMatchObject({ ram: 5 })
    expect(g.battleAct({ action: 'sk_black', target: { unit: 'f1' } }).status).toBe('applied')
    expect(unit(g, 'a1').pools.ram!.now).toBe(1)
    expect(unit(g, 'f1').load!.now).toBe(5)
  })

  it('問花費、算花費可以重複（相同的結果、不留下任何痕跡）：問了兩次、先問別人的，spent 還是對的', () => {
    const g = play(['sk_black', 'sk_root_ram'], 6)
    turnTo(g, 'a1')
    opt(g, 'sk_black')
    turnTo(g, 'a2')
    opt(g, 'sk_black')
    turnTo(g, 'a1')
    g.battleAct({ action: 'sk_black', target: { unit: 'f1' } })
    expect(unit(g, 'f1').load!.now).toBe(5)
  })
})

// =====================================================================================================================
describe('sink 效果走 run.gainSink（不變式第 68 條）', () => {
  const field = (): Arena => arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe('minion', { ap: { now: 0, max: 0, regen: 0 } } as never)]), [combatFeature], (kk) => {
    kk.content.loadPack(BASE)
  })

  it('沒寫 save 的 sink：發 sink.before（擋得下，擋下就沒有沉溺也沒有那一句）；已經退出的人加不上', () => {
    const a = field()
    const asked: number[] = []
    a.k.battle.on('sink.before', 'spy', ({ amount, out }) => {
      asked.push(amount)
      if (a.battle.field.noSink) out.block = true
    })
    const run = a.run(dice())
    const use = { user: a.ally(1), target: { unit: 'f1' } as BattleTarget, source: SRC }
    run.effects([{ op: 'sink', amount: 2 }], use)
    expect([asked, a.foe(1).sink]).toEqual([[2], 2])
    expect(run.beats.some((b) => b.text.includes('沉溺 +2'))).toBe(true)
    a.battle.field.noSink = true
    const blocked = a.run(dice())
    blocked.effects([{ op: 'sink', amount: 2 }], use)
    expect([asked, a.foe(1).sink]).toEqual([[2, 2], 2])
    expect(blocked.beats).toEqual([])
    // 已經倒下的人：不加
    a.battle.field.noSink = false
    const f = a.foe(1)
    a.run(dice()).setOut(f, 'down')
    const late = a.run(dice())
    late.effects([{ op: 'sink', amount: 3, who: 'target' }], use)
    expect(f.sink).toBe(2)
    expect(late.beats).toEqual([])
  })
})

// =====================================================================================================================
describe('蜂群臨時機被擊落不灌感載，是資料的 no_backlash 決定，不是「臨時」本身（summons 的檔頭說明）', () => {
  it('資料寫了 no_backlash 的臨時機被擊落：操作者感載不增加；沒寫的臨時機照灌', async () => {
    const { summonsFeature } = await import('../../src/features/summons')
    const a = arena(duel([one({ weapon: 'pistol', skills: { sync: 2, piloting: 3 }, ext: { summons: { drones: [] } } } as never), one({}, 2)], [foe('minion', { ap: { now: 0, max: 0, regen: 0 }, weapons: [testWeapon('pistol', 30)] } as never)]), [combatFeature, summonsFeature], (kk) => {
      kk.content.loadPack(BASE)
      readyFeatures(kk)
    })
    const run = a.run(dice())
    const deploy = (e: Rec, slot: number) => run.effects([{ op: 'drone.deploy', kind: 'attack', turns: 3, over_cap: true, ...e }], { user: a.ally(1), target: { side: 'ally', slot } as BattleTarget, source: SRC })
    deploy({ no_backlash: true }, 1)
    deploy({}, 2)
    const [quiet, loud] = a.battle.overlays
    expect([quiet!.ext?.noBacklash, loud!.ext?.noBacklash]).toEqual([true, undefined])
    run.damageOverlay(quiet!, 999, 'physical', a.foe(1))
    expect(a.ally(1).load!.now).toBe(0)
    run.damageOverlay(loud!, 999, 'physical', a.foe(1))
    expect(a.ally(1).load!.now).toBe(5)
  })
})
