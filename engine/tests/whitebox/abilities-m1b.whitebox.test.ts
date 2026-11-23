// 白箱測試：features/abilities（M1b 第二波與第三批核心之後：守著、臨時遮蔽、branch、buff、條件、消耗與池、戰鬥結束的寫回、保釋、開戰效果、格式）。
// 補主套件沒有走到的分支與錯誤路徑；每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。
// 會失敗（和規格不一致）的寫在 tests/pending/W011～W013（dev/bugs/2026-11-23-W011～W013），這裡只放現在就對的行為。
// 內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleState, BattleUnit, ContentPack, GameState, Kernel } from '../../src'
import { BattleBlocked, clone, coverAt, createKernel, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { whenBlocks, needsBlocks, rangeBlock } from '../../src/features/abilities/conditions'
import { endChanges } from '../../src/features/abilities/end'
import {
  aiProblems, applySet, meatProblems, modsProblems, needsProblems, poolProblems, prepProblems, useProblems, whenProblems, WHEN_MEAT,
} from '../../src/features/abilities/format'
import { ransomChanges } from '../../src/features/abilities/ransom'
import { costOf, setupResources, usageBlocks, useOf } from '../../src/features/abilities/use'
import { combatFeature } from '../../src/features/combat'
import { makeState, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature]
const STATUSES = [...TEST_STATUSES, { id: 'guarded', name: '戒備', desc: '到他的下一回合開始。', until: 'own_turn_start', turns: 1, kind: 'buff' }]
const PATH = { id: 'gunner', name: '槍手', tree: '戰鬥直覺', category: 'meat', signature: 'sk_sig', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }
const ab = (id: string, kind: string, more: Rec = {}): Rec => ({
  id, name: id, path: 'gunner', category: 'meat', tier: 1, layer: 'front', kind, cap: 1, xp: 20, cells: 1, after: 'sk_sig', text: `${id}。`, net: null, opinion: null, meat: null, ...more,
})
const ABILITIES = [
  ab('sk_sig', 'passive', { name: '招牌', layer: 'signature', after: undefined, meat: { tags: ['sig'] } }),
  ab('sk_buffer', 'active', { name: '鼓舞', use: { ap: 1 }, meat: { target: 'self', do: [{ op: 'buff', id: 'cheer', mods: [{ kind: 'hit', value: 1 }] }] } }),
  ab('sk_bail', 'passive', { name: '保釋', meat: { ransom: { cash: 'grade*1000' } } }),
  ab('sk_bail_cheap', 'passive', { name: '便宜的保釋', meat: { ransom: { cash: 'grade*100' } } }),
  ab('sk_free', 'passive', { name: '白給的保釋', meat: { ransom: { cash: 0 } } }),
  ab('sk_rally', 'passive', { name: '集合', meat: { on_start: [{ op: 'pick_random', key: 'mate', from: 'ally' }, { op: 'status', who: 'pick:mate', status: 'marked' }] } }),
]
const pack = (): ContentPack => ({ id: 'wb_m1b', content: { battle_status: STATUSES, path: [PATH], ability: ABILITIES } } as unknown as ContentPack)
const dice = (...v: number[]): number[] => [...v, ...Array(200).fill(1)]
const gun = (n = 5) => ({ ...testWeapon('pistol', 10), mag: { now: n, max: 5 } })
const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const
const tough = (o: Rec = {}) => foe('minion', { hp: { now: 300, max: 300 }, ap: { now: 0, max: 0, regen: 0 }, ...o } as never)
const shooter = (o: Rec = {}, i = 1) => one({ weapon: 'pistol', weapons: [gun()], wield: 0, ap: { now: 9, max: 9, regen: 3 }, ...o } as never, i)

function field(allies: unknown[] = [shooter(), shooter({}, 2)], foes: unknown[] = [tough(), tough(), tough()], cover = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }, more: Rec = {}): Arena {
  return arena(duel(allies, foes, cover, more), FEATURES, (k: Kernel) => {
    k.content.loadPack(pack())
    readyFeatures(k)
  })
}
const attacksBy = (_a: Arena, run: ReturnType<Arena['run']>, id: string): number => run.beats.filter((b) => ['hit', 'miss', 'crit'].includes(b.tag ?? '') && (b.data as Rec | undefined)?.attacker === id).length
const wards = (u: BattleUnit): Array<Rec> => (((u.ext.abilities as Rec | undefined)?.wards ?? []) as Rec[])
const temps = (u: BattleUnit): Array<Rec> => (((u.ext.abilities as Rec | undefined)?.coverTemps ?? []) as Rec[])
const buffs = (u: BattleUnit): Array<Rec> => (((u.ext.abilities as Rec | undefined)?.buffs ?? []) as Rec[])
/** 讓 u 進入他自己的回合（核心 beginTurn 之後的樣子：輪到他、acting 是他）。 */
const inTurn = (a: Arena, u: BattleUnit): void => {
  a.battle.turn = a.battle.order.indexOf(u.id)
  a.battle.acting = u.id
}
const blocked = (fn: () => void): string[] => {
  try {
    fn()
  } catch (e) {
    if (e instanceof BattleBlocked) return e.reasons
    throw e
  }
  return []
}

// =====================================================================================================================
// 守著（ward）
// =====================================================================================================================

describe('白箱 守著一格（SKILL_TREES 不准動喔；dev/adr/0015 補記 M1b-core-fix3 第二節；features/abilities/ward.ts）', () => {
  const place = (a: Arena, run: ReturnType<Arena['run']>, e: Rec, target: unknown = { side: 'foe', slot: 1 }) =>
    run.effects([{ op: 'ward', slot: 'target', do: [{ op: 'attack' }], ...e }], { user: a.ally(1), target: target as never, source: SRC })

  it('不准動喔「指定敵方的一格」：目標不是一格（是一個人、或沒有目標）擋下，原因是一句完整的話', () => {
    const a = field()
    const run = a.run(dice())
    expect(blocked(() => place(a, run, {}, { unit: 'f1' }))).toEqual(['要選敵方的一格。'])
    expect(blocked(() => place(a, run, {}, null))).toEqual(['要選敵方的一格。'])
    expect(wards(a.ally(1))).toEqual([])
  })

  it('不准動喔「第一次換位、補位或攻擊」：on 沒寫就是三種都管', () => {
    const a = field()
    const run = a.run(dice())
    place(a, run, {})
    expect(wards(a.ally(1))[0]!.on).toEqual(['move', 'compact', 'attack'])
  })

  it('不准動喔「到你的下一回合開始前」：until 沒寫是 own_turn_start；別人的回合開始不拿掉', () => {
    const a = field()
    const run = a.run(dice())
    place(a, run, {})
    expect(wards(a.ally(1))[0]!.until).toBe('own_turn_start')
    a.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(wards(a.ally(1))).toHaveLength(1)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(wards(a.ally(1))).toHaveLength(0)
  })

  it('dev/adr/0015 補記 fix3 第二節（ward 套用 skip）：在自己的回合裡守、until 是 own_turn_end：這個回合的結束不算，下一個回合的結束才拿掉', () => {
    const a = field()
    const run = a.run(dice())
    inTurn(a, a.ally(1))
    place(a, run, { until: 'own_turn_end' })
    expect(wards(a.ally(1))[0]!.skip).toBe(true)
    a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(wards(a.ally(1))).toHaveLength(1)
    expect(wards(a.ally(1))[0]!.skip).toBeUndefined()
    // 別人的回合結束不算
    a.k.battle.emit('turn.end', { run, unit: a.ally(2) })
    expect(wards(a.ally(1))).toHaveLength(1)
    a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(wards(a.ally(1))).toHaveLength(0)
  })

  it('dev/adr/0015 補記 fix3 第二節：不在自己的回合裡守（別人的回合裡的反應）、until 是 own_turn_end：他下一個回合的結束就拿掉', () => {
    const a = field()
    const run = a.run(dice())
    inTurn(a, a.ally(2))
    place(a, run, { until: 'own_turn_end' })
    expect(wards(a.ally(1))[0]!.skip).toBeUndefined()
    a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(wards(a.ally(1))).toHaveLength(0)
  })

  it('不准動喔：do 裡沒有攻擊的守著，守著的人手上沒有槍也照樣觸發（「做不到就不算」只對開槍）', () => {
    const a = field([shooter({ weapons: [], wield: -1 }), shooter({}, 2)])
    const run = a.run(dice())
    place(a, run, { do: [{ op: 'status', status: 'marked' }] })
    run.move(a.foe(1), 2)
    expect(a.foe(1).statuses.map((s) => s.id)).toContain('marked')
    expect(wards(a.ally(1))).toHaveLength(0)
  })

  it('不准動喔：那一格上的人已經退出（被這一刻的別的東西打倒）不觸發，守著留著', () => {
    const a = field()
    const run = a.run(dice())
    place(a, run, { on: ['move'] })
    const f1 = a.foe(1)
    f1.out = 'down'
    a.k.battle.emit('moved', { run, unit: f1, from: 1, to: 2, by: 'action' } as never)
    expect(attacksBy(a, run, 'a1')).toBe(0)
    expect(wards(a.ally(1))).toHaveLength(1)
  })

  it('不准動喔：守著的觸發不會再觸發別人的守著（守著的人開的那一槍站在對方守著的格上，也不連鎖）', () => {
    // 我守敵方第 1 格；敵人 f1 守我方第 1 格（我站的格）。f1 攻擊 → 我開槍（我在 f1 守著的格上出手）→ f1 不再開槍
    const a = field([shooter(), shooter({}, 2)], [tough({ weapons: [gun()], wield: 0, weapon: 'pistol' }), tough(), tough()])
    const run = a.run(dice(15, 3, 3, 3, 15, 3, 3, 3, 15, 3, 3, 3))
    place(a, run, { on: ['attack'] })
    run.effects([{ op: 'ward', slot: 'target', on: ['attack'], do: [{ op: 'attack' }] }], { user: a.foe(1), target: { side: 'ally', slot: 1 }, source: SRC })
    run.attack(a.foe(1), a.ally(2))
    expect(attacksBy(a, run, 'a1')).toBe(1)
    // f1 自己的那一擊照樣打出去（一次），但沒有因為我出手而多一槍
    expect(attacksBy(a, run, 'f1')).toBe(1)
    expect(wards(a.foe(1))).toHaveLength(1)
  })

  it('ward 的格式（dev/adr/0015 第一節：效果的欄位是封閉清單）：until 不在清單、on 是空陣列、do 沒寫都擋下', () => {
    const k = createKernel(FEATURES)
    const p = (e: Rec) => k.battle.effectProblems([{ op: 'ward', slot: 'target', do: [{ op: 'attack' }], ...e }]).join('\n')
    expect(p({ until: 'battle_end' })).toBe('')
    expect(p({ until: 'next_overload' })).toMatch(/until：「next_overload」不在清單裡/)
    expect(p({ on: [] })).toMatch(/on：要是至少一個/)
    expect(p({ on: 'move' })).toMatch(/on：要是至少一個/)
    expect(p({ do: undefined })).toMatch(/do：要是守著的人做的效果清單/)
    expect(p({ do: [{ op: 'nope' }] })).toMatch(/do：.*nope/)
    expect(p({ range: 3 })).toMatch(/range：不認得的欄位/)
  })
})

// =====================================================================================================================
// 臨時遮蔽（cover_temp）與 branch
// =====================================================================================================================

describe('白箱 臨時遮蔽（SKILL_TREES 跑位射擊「到你的下一回合開始前遮蔽高一級，最高到掩體」；features/abilities/ops.ts）', () => {
  const raise = (a: Arena, run: ReturnType<Arena['run']>, e: Rec = {}, target: unknown = { unit: 'a1' }) =>
    run.effects([{ op: 'cover_temp', ...e }], { user: a.ally(1), target: target as never, source: SRC })

  it('跑位射擊「最高到掩體」：已經是掩體的格升不上去，不記帳；到期時也不會把那一格本來的掩體拿掉', () => {
    const a = field(undefined, undefined, { ally: [2, 0, 0, 0], foe: [0, 0, 0, 0] })
    const run = a.run(dice())
    raise(a, run)
    expect(coverAt(a.battle, 'ally', 1).level).toBe(2)
    expect(temps(a.ally(1))).toEqual([])
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(2)
  })

  it('跑位射擊：半掩體升一級到掩體、只記實際升的 1 級；levels 沒寫是 1；到自己的回合開始拿回來', () => {
    const a = field(undefined, undefined, { ally: [1, 0, 0, 0], foe: [0, 0, 0, 0] })
    const run = a.run(dice())
    raise(a, run, { levels: 2 })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(2)
    expect(temps(a.ally(1)).map((t) => t.levels)).toEqual([1])
    // 別人的回合開始不算
    a.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(2)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(1)
    expect(temps(a.ally(1))).toEqual([])
  })

  it('跑位射擊：升上去的那一級在到期前被打穿了，到期時不會再往下扣（那一格現在的遮蔽不夠就拿到沒有為止）', () => {
    const a = field()
    const run = a.run(dice())
    raise(a, run)
    expect(coverAt(a.battle, 'ally', 1).level).toBe(1)
    run.lowerCover('ally', 1, 1)
    expect(coverAt(a.battle, 'ally', 1).level).toBe(0)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(0)
  })

  it('cover_temp：沒有落在人身上（目標是一格、或沒有目標）什麼都不做', () => {
    const a = field()
    const run = a.run(dice())
    raise(a, run, {}, { side: 'ally', slot: 2 })
    raise(a, run, {}, null)
    expect(a.battle.cover.ally.map((c) => c.level)).toEqual([0, 0, 0, 0])
    expect(temps(a.ally(1))).toEqual([])
  })

  it('dev/adr/0015 補記 fix3 第二節（cover_temp 套用 skip）：在自己的回合裡升、until 是 own_turn_end：這個回合的結束不算', () => {
    const a = field()
    const run = a.run(dice())
    inTurn(a, a.ally(1))
    raise(a, run, { until: 'own_turn_end' })
    expect(temps(a.ally(1))[0]!.skip).toBe(true)
    a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(1)
    a.k.battle.emit('turn.end', { run, unit: a.ally(1) })
    expect(coverAt(a.battle, 'ally', 1).level).toBe(0)
  })

  it('cover_temp 的格式：until 只能是 own_turn_start、own_turn_end；levels 要是 1 以上的整數', () => {
    const k = createKernel(FEATURES)
    const p = (e: Rec) => k.battle.effectProblems([{ op: 'cover_temp', ...e }]).join('\n')
    expect(p({ until: 'own_turn_end', levels: 2 })).toBe('')
    expect(p({ until: 'battle_end' })).toMatch(/until：「battle_end」不在清單裡/)
    expect(p({ levels: 1.5 })).toMatch(/levels：要是 1 以上的整數/)
    expect(p({ soft: true })).toMatch(/soft：不認得的欄位/)
  })
})

describe('白箱 branch（dev/adr/0015 第一節：看對象是誰；features/abilities/ops.ts）', () => {
  it('needs 寫了但這一筆沒有落在人身上（目標是一格）：條件不成立，做 else；else 沒寫就什麼都不做', () => {
    const a = field()
    const run = a.run(dice())
    const e = (more: Rec) => ({ op: 'branch', needs: { wounded: true }, do: [{ op: 'status', status: 'marked' }], ...more })
    run.effects([e({ else: [{ op: 'status', who: 'self', status: 'guarded' }] })], { user: a.ally(1), target: { side: 'foe', slot: 1 }, source: SRC })
    expect(a.ally(1).statuses.map((s) => s.id)).toContain('guarded')
    expect(a.foe(1).statuses).toEqual([])
    run.effects([e({})], { user: a.ally(2), target: { side: 'foe', slot: 1 }, source: SRC })
    expect(a.ally(2).statuses).toEqual([])
  })

  it('when（做的人自己的條件）不成立：做 else', () => {
    const a = field()
    const run = a.run(dice())
    run.effects([{ op: 'branch', when: { wounded: true }, do: [{ op: 'status', status: 'marked' }], else: [{ op: 'status', status: 'guarded' }] }], { user: a.ally(1), target: { unit: 'f1' }, source: SRC })
    expect(a.foe(1).statuses.map((s) => s.id)).toEqual(['guarded'])
  })

  it('branch 的格式：do 是空陣列、else 不是陣列、多寫 self（已拿掉）都擋下', () => {
    const k = createKernel(FEATURES)
    const p = (e: Rec) => k.battle.effectProblems([{ op: 'branch', needs: { wounded: true }, do: [{ op: 'status', status: 'marked' }], ...e }]).join('\n')
    expect(p({})).toBe('')
    expect(p({ do: [] })).toMatch(/do：要是效果的陣列/)
    expect(p({ else: 'x' })).toMatch(/else：要是效果的陣列/)
    expect(p({ else: [] })).toMatch(/else：要是效果的陣列/)
    expect(p({ self: true })).toMatch(/self：不認得的欄位/)
    expect(p({ needs: undefined, when: undefined })).toMatch(/至少要寫一個/)
  })
})

// =====================================================================================================================
// buff
// =====================================================================================================================

describe('白箱 buff（dev/adr/0015 第一節；features/abilities/mods.ts）', () => {
  const give = (_a: Arena, run: ReturnType<Arena['run']>, e: Rec, user: BattleUnit, target: unknown, source: Rec = SRC) =>
    run.effects([{ op: 'buff', id: 'b', mods: [{ kind: 'hit', value: 1 }], ...e }], { user, target: target as never, source: source as never })

  it('buff：落在已經退出的人、或沒有落在人身上，什麼都不掛', () => {
    const a = field()
    const run = a.run(dice())
    a.ally(2).out = 'down'
    give(a, run, {}, a.ally(1), { unit: 'a2' })
    give(a, run, {}, a.ally(1), { side: 'ally', slot: 1 })
    expect(buffs(a.ally(2))).toEqual([])
    expect(buffs(a.ally(1))).toEqual([])
  })

  it('buff 的樹階：來源不是技能（道具）、也沒給 tier 時是 1；來源是技能時照給的人在那棵樹的階', () => {
    const a = field([shooter({ ext: { abilities: { equipped: [], tiers: { gunner: 4 } } } }), shooter({}, 2)])
    const run = a.run(dice())
    give(a, run, {}, a.ally(1), { unit: 'a1' }, { kind: 'item', id: 'it_x', name: '道具' })
    expect(buffs(a.ally(1))[0]!.tier).toBe(1)
    give(a, run, { id: 'c' }, a.ally(1), { unit: 'a1' }, { kind: 'ability', id: 'sk_buffer', name: '鼓舞' })
    expect(buffs(a.ally(1)).find((b) => b.id === 'c')!.tier).toBe(4)
  })

  it('buff 的 on_end：給的人不在單位清單裡（替身給的）時，做的人退回 buff 的主人', () => {
    const a = field()
    const run = a.run(dice())
    give(a, run, { until: 'own_turn_start', turns: 1, on_end: [{ op: 'status', who: 'self', status: 'guarded' }] }, a.ally(1), { unit: 'a2' })
    ;(buffs(a.ally(2))[0] as Rec).by = 'o_gone'
    a.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(buffs(a.ally(2))).toEqual([])
    expect(a.ally(2).statuses.map((s) => s.id)).toContain('guarded')
  })

  it('buff 的 source_turn_*：照給的人的回合數；被掛的人自己的回合不算', () => {
    const a = field()
    const run = a.run(dice())
    give(a, run, { until: 'source_turn_start', turns: 1 }, a.ally(1), { unit: 'a2' })
    a.k.battle.emit('turn.start', { run, unit: a.ally(2) })
    expect(buffs(a.ally(2))).toHaveLength(1)
    a.k.battle.emit('turn.start', { run, unit: a.ally(1) })
    expect(buffs(a.ally(2))).toHaveLength(0)
  })

  it('buff 的格式：多寫的欄位、id 沒寫、name 是空字串、mods／on_end／mask 都沒寫都擋下', () => {
    const k = createKernel(FEATURES)
    const p = (e: Rec) => k.battle.effectProblems([{ op: 'buff', id: 'x', mods: [{ kind: 'hit', value: 1 }], ...e }]).join('\n')
    expect(p({})).toBe('')
    expect(p({ color: 'red' })).toMatch(/不認得的欄位 color/)
    expect(p({ id: undefined })).toMatch(/id：一定要寫/)
    expect(p({ name: ' ' })).toMatch(/name：要是給玩家看的名字/)
    expect(p({ mods: undefined })).toMatch(/mods、on_end、mask：至少要寫一個/)
    expect(p({ mods: undefined, mask: true })).toBe('')
  })
})

describe('白箱 修正的落點與數字（dev/work/M1b-skill-format.md 第三節；features/abilities/mods.ts）', () => {
  const passive = (id: string, mods: unknown[]) => ab(id, 'passive', { meat: { mods } })
  const withMods = (mods: unknown[], allies?: unknown[]) => {
    const a = arena(duel(allies ?? [shooter({ ext: { abilities: { equipped: ['sk_m'], tiers: { gunner: 7 } } } }), shooter({}, 2)], [tough()]), FEATURES, (k: Kernel) => {
      k.content.loadPack({ id: 'm', content: { battle_status: STATUSES, path: [PATH], ability: [ABILITIES[0], passive('sk_m', mods)] } } as unknown as ContentPack)
      readyFeatures(k)
    })
    return a
  }

  it('by_tier「照樹階 1～5 查表」：樹階超過 5（記錯的資料）用第五個數字，不會查到表外變成 0', () => {
    const a = withMods([{ kind: 'hit', value: { by_tier: [1, 2, 3, 4, 5] } }])
    expect(a.run().mods('hit', a.ally(1)).filter((p) => p.source === 'skill').map((p) => p.value)).toEqual([5])
  })

  it('who: allies：給的人已經不在場上（倒下）時，隊友吃不到', () => {
    const a = withMods([{ kind: 'evade', value: 2, who: 'allies' }])
    expect(a.run().mods('evade', a.ally(2)).filter((p) => p.source === 'skill').map((p) => p.value)).toEqual([2])
    a.ally(1).out = 'down'
    a.ally(1).slot = 0
    expect(a.run().mods('evade', a.ally(2)).filter((p) => p.source === 'skill')).toEqual([])
  })
})

// =====================================================================================================================
// 條件
// =====================================================================================================================

describe('白箱 技能的條件（dev/work/M1b-skill-format.md 第二節；features/abilities/conditions.ts）', () => {
  const a = field()
  const run = a.run()
  const u = a.ally(1)
  const t = a.foe(1)

  it('needs.cyber: false：對有義體的人用不了，原因寫出名字', () => {
    t.cyber = 2
    expect(needsBlocks(run, t, { cyber: false })).toEqual([`${t.name}有義體，不能對有義體的人用。`])
    t.cyber = 0
    expect(needsBlocks(run, t, { cyber: false })).toEqual([])
  })

  it('needs.rank 寫了清單以外的位階：原因裡照原字寫出來（不會變成 undefined）', () => {
    expect(needsBlocks(run, t, { rank: ['boss', 'king' as never] })[0]).toMatch(/^只能對首領或king用（.*是雜兵）。$/)
  })

  it('needs.implant_off：身上帶著 jammed（義體失效）也算「已經有一件被干擾的義體」', () => {
    expect(needsBlocks(run, t, { implant_off: true })).toHaveLength(1)
    t.statuses = [{ id: 'jammed', until: { at: 'battle_end' } } as never]
    expect(needsBlocks(run, t, { implant_off: true })).toEqual([])
    t.statuses = []
  })

  it('needs.status 的狀態查不到規則：原因用狀態的 id', () => {
    expect(needsBlocks(run, t, { status: 'no_such' })).toEqual([`${t.name}要帶著no_such才能用。`])
  })

  it('when.mag_min：手上沒有武器時當成 0 格', () => {
    const bare = { ...u, weapons: [], wield: -1 } as unknown as BattleUnit
    expect(whenBlocks(run, bare, { mag_min: 1 })).toEqual(['彈匣裡要有 1 格以上才能用。'])
  })

  it('when.stance 的姿態技能查不到：原因用技能的 id', () => {
    expect(whenBlocks(run, u, { stance: 'sk_ghost' })).toEqual(['要先開著「sk_ghost」姿態才能用。'])
  })

  it('rangeBlock：目標的格小於 1（不在場上）不算距離；正好幾格的寫法', () => {
    expect(rangeBlock(u, 0, [1, 1])).toBeNull()
    expect(rangeBlock(u, 4, [2, 2])).toBe('目標要正好在距離 2，現在距離 4。')
  })
})

// =====================================================================================================================
// 消耗、池、戰鬥結束的寫回、保釋、開戰效果
// =====================================================================================================================

describe('白箱 消耗與次數（dev/work/M1b-skill-format.md 第一節；dev/adr/0015 E1～E3；features/abilities/use.ts）', () => {
  it('useOf：沒寫 use 是空的；照戰場分、只寫了 net 的，現實那一組是空的', () => {
    expect(useOf({})).toEqual({})
    expect(useOf({ use: { net: { ap: 2 } } as never })).toEqual({})
  })

  it('costOf：ram_all_min 的人沒有 RAM 池時花 0；現金的公式算出 0 時不列現金', () => {
    const a = field()
    const u = a.ally(1)
    delete u.pools.ram
    expect(costOf(a.run(), u, { id: 'x', path: 'gunner', use: { ram_all_min: 1 } } as never)).toEqual({ ap: 0, ram: 0 })
    expect(costOf(a.run(), u, { id: 'x', path: 'gunner', use: { cash: 0 } } as never)).toEqual({ ap: 0 })
    expect(usageBlocks(a.run(), u, { id: 'x', path: 'gunner', use: { ram_all_min: 2 } } as never)).toEqual(['要有 2 點以上的 RAM 才能用（現在 0 點）。'])
  })

  it('setupResources：已經有的池不動；角色身上記著這件委託用過的次數讀進 uses（0 與非數字不讀）', () => {
    const a = field([shooter({ actor: makeState().pc })])
    const s = a.state
    s.money.cash = 500
    const pcId = s.pc!
    s.actors[pcId]!.ext = { favors: { small: 2 }, abilities: { commission: { [a.battle.id]: { sk_a: 1, sk_b: 0, sk_c: 'x' } } } }
    const u = a.ally(1)
    u.pools.cash = { now: 9, max: 9, regen: 0 }
    u.pools.favor_small = { now: 7, max: 7, regen: 0 }
    setupResources({ state: s, battle: a.battle }, u)
    expect(u.pools.cash).toEqual({ now: 9, max: 9, regen: 0 })
    expect(u.pools.favor_small!.now).toBe(7)
    expect(u.pools.favor_mid).toEqual({ now: 0, max: 0, regen: 0 })
    expect(u.uses['commission:sk_a']).toBe(1)
    expect(u.uses['commission:sk_b']).toBeUndefined()
    expect(u.uses['commission:sk_c']).toBeUndefined()
  })

  it('setupResources：單位記著的角色不在狀態裡，什麼都不建', () => {
    const a = field([shooter({ actor: 'ghost' })])
    const u = a.ally(1)
    const before = clone(u.pools)
    setupResources({ state: a.state, battle: a.battle }, u)
    expect(u.pools).toEqual(before)
  })
})

describe('白箱 戰鬥結束時的寫回（dev/adr/0015 E2、E3、E4；dev/invariants.md 第 1、2 條：只經由變更寫回；features/abilities/end.ts）', () => {
  it('單位記著的角色不在狀態裡：略過，不產生任何變更', () => {
    const state = makeState()
    const battle = { id: 'b1', mode: 'meat', origin: {}, units: { a1: { id: 'a1', actor: 'ghost', pools: { cash: { now: 0, max: 100, regen: 0 } }, uses: {}, ext: {} } } } as unknown as BattleState
    expect(endChanges(state, battle)).toEqual([])
  })

  it('預備只在現實戰鬥帶進來：網內的戰鬥結束不清 next_battle 的預備', () => {
    const state = makeState()
    const pc = Object.keys(state.actors)[0]!
    state.actors[pc]!.ext.abilities = { learned: [], equipped: [], tiers: {}, prepared: [{ id: 'sk_p', scope: 'next_battle' }] }
    const unit = { id: 'a1', actor: pc, pools: {}, uses: {}, ext: { abilities: { equipped: [], tiers: {}, brought: ['sk_p'] } } }
    const net = { id: 'b1', mode: 'net', origin: {}, units: { a1: unit } } as unknown as BattleState
    expect(endChanges(state, net)).toEqual([])
    const meat = { ...net, mode: 'meat' } as BattleState
    const ch = endChanges(state, meat)
    expect(ch).toHaveLength(1)
    expect((ch[0] as Rec).value).toMatchObject({ prepared: [] })
  })
})

describe('白箱 保釋與被贖回（SKILL_TREES 掮客：保釋；features/abilities/ransom.ts）', () => {
  const k = (() => {
    const kk = createKernel(FEATURES)
    kk.content.loadPack(pack())
    readyFeatures(kk)
    return kk
  })()
  const team = (eq: string[][]): BattleState => ({
    id: 'b9', grade: 3, mode: 'meat', origin: {},
    units: Object.fromEntries(eq.map((ids, i) => [`a${i + 1}`, { id: `a${i + 1}`, name: `隊員${i + 1}`, side: 'ally', actor: `p${i}`, ext: { abilities: { equipped: ids, tiers: {} } } }])),
  } as unknown as BattleState)

  it('保釋「付等級×1,000」：隊上兩個人都裝著，用最便宜的那一個', () => {
    const ch = ransomChanges(k, makeState(), team([['sk_bail'], ['sk_bail_cheap']]), 'lose')
    expect(ch).toEqual([{ op: 'ext', key: 'ransom', value: { battle: 'b9', cost: 300, by: '隊員2' } }])
  })

  it('沒輸（贏了或投降）：之前留下的贖金記錄清掉；沒有記錄就不產生變更', () => {
    const s = makeState()
    expect(ransomChanges(k, s, team([['sk_bail']]), 'win')).toEqual([])
    s.ext.ransom = { battle: 'old', cost: 1, by: 'x' }
    expect(ransomChanges(k, s, team([['sk_bail']]), 'surrender')).toEqual([{ op: 'ext', key: 'ransom', value: null }])
  })

  it('被贖回的選項：贖金 0 不扣現金；記錄沒寫是誰叫的人用「隊上的人」；委託還在的說法', () => {
    const s = makeState()
    s.ext.ransom = { battle: 'b9', cost: 0 }
    const opts = (k.hooks as unknown as { run: (n: string, p: unknown) => Array<{ result: unknown[] }> }).run('defeat.options', { state: s, pending: { outcome: 'lose', battle: 'b9', fails_commission: false } })
    const o = opts.flatMap((r) => r.result).find((x) => (x as Rec | undefined)?.id === 'ransom') as Rec
    expect(o.changes).toEqual([{ op: 'ext', key: 'ransom', value: null }])
    expect(o.desc).toMatch(/^付 0 C\$，隊上的人叫來的人/)
    expect(o.summary).toMatch(/這一趟的委託還在。$/)
    expect(o.blocks).toEqual([])
  })
})

describe('白箱 開戰時做一次的效果（SKILL_TREES 掮客：黑市門路「你指定的一名隊友」改成隨機；features/abilities/onstart.ts、ops.ts pick_random）', () => {
  const start = (mode = 'meat', extraAllies: unknown[] = [shooter({}, 2)]) =>
    arena(duel([shooter({ ext: { abilities: { equipped: ['sk_rally'], tiers: {} } } }), ...extraAllies], [tough()], undefined, { mode } as never), FEATURES, (k: Kernel) => {
      k.content.loadPack(pack())
      readyFeatures(k)
    })

  it('pick_random 從隊友（不含自己）裡隨機挑一個，後面 who: pick:<key> 落在他身上；同一個種子同一個結果（SKILL_TREES 掮客：黑市門路）', () => {
    const a = start('meat', [shooter({}, 2), shooter({}, 3)])
    const marked = [a.ally(2), a.ally(3)].filter((u) => u.statuses.some((s) => s.id === 'marked'))
    expect(marked).toHaveLength(1)
    expect(a.ally(1).statuses).toEqual([])
    const b = start('meat', [shooter({}, 2), shooter({}, 3)])
    expect([b.ally(2), b.ally(3)].map((u) => u.statuses.length)).toEqual([a.ally(2), a.ally(3)].map((u) => u.statuses.length))
  })

  it('沒有隊友可挑：把 pick 拿掉，後面落在他身上的那一筆自己跳過（不丟錯）；不是現實戰場不做（onstart.ts）', () => {
    const a = start('meat', [])
    expect(a.ally(1).statuses).toEqual([])
    const net = start('net', [shooter({}, 2)])
    expect(net.ally(2).statuses).toEqual([])
  })
})

// =====================================================================================================================
// 格式（內容載入時的檢查；SKILLS 1.8 節、dev/work/M1b-skill-format.md）
// =====================================================================================================================

describe('白箱 技能格式的每一條原因（dev/work/M1b-skill-format.md；features/abilities/format.ts）', () => {
  it.each([
    [{ ram: -1 }, /use\.ram 要是 0 以上的整數/],
    [{ ram_all_min: 0 }, /use\.ram_all_min 要是 1 以上的整數/],
    [{ ram: 1, ram_all_min: 2 }, /use\.ram 與 use\.ram_all_min 只能寫一個/],
    [{ not_first_round: 'y' }, /not_first_round 要是 true 或 false/],
    [{ first_round: true, not_first_round: true }, /不能同時是 true/],
    [{ group: '', per_turn: 1 }, /group 要是組的名字/],
    [{ slot: 0 }, /slot 要是 1 以上的整數/],
    [{ cash: 1.5e400 }, /cash 要是有限的數字/],
  ] as const)('use %j 擋下', (u, re) => {
    expect(useProblems(u, 'active').join('\n')).toMatch(re)
  })

  it('use 照戰場分：其中一欄不是物件擋下', () => {
    expect(useProblems({ meat: 3 }, 'active')).toEqual(['use.meat 要是一組消耗的物件'])
  })

  it.each([
    [5, /要是物件/],
    [{ wield: [] }, /wield 要是武器類型/],
    [{ mag_min: 0 }, /mag_min 要是 1 以上的整數/],
    [{ hull: 1 }, /hull 要是 true 或 false/],
    [{ stance: '' }, /stance 要是姿態技能的 id/],
    [{ node_taken: false }, /node_taken 要是 true 或控制節點的種類/],
    [{ other_status: 3 }, /other_status 要是狀態的 id/],
    [{ wounded: false }, /wounded 只能是 true/],
  ] as const)('when %j 擋下', (w, re) => {
    expect(whenProblems('meat.when', w, [...WHEN_MEAT, 'other_status', 'hull', 'node_taken']).join('\n')).toMatch(re)
  })

  it.each([
    [7, /要是物件/],
    [{ wounded: false }, /wounded 只能是 true/],
    [{ status: [] }, /status 要是狀態的 id/],
    [{ status: [1] }, /status 要是狀態的 id/],
    [{ afterglow: 0 }, /afterglow 要是 1 以上的整數/],
    [{ tag: '' }, /tag 要是標籤/],
  ] as const)('needs %j 擋下', (n, re) => {
    expect(needsProblems('meat.needs', n).join('\n')).toMatch(re)
  })

  it.each([
    [[], /要是修正的陣列/],
    [['x'], /要是 \{ kind, value, \.\.\. \}/],
    [[{ kind: 'crit_margin', to: 'x' }], /to 要是數字/],
    [[{ kind: 'hit' }], /value 一定要寫/],
    [[{ kind: 'hit', value: 1, tags: [] }], /tags 要是標籤的陣列/],
    [[{ kind: 'action_ap', value: -1, per_fight: 0 }], /per_fight 要是 1 以上的整數/],
  ] as const)('mods %j 擋下', (m, re) => {
    expect(modsProblems('meat.mods', m).join('\n')).toMatch(re)
  })

  it('ai.when 不是物件時 target_hp_below 不另外查（只報一句「要是物件」）', () => {
    const p = aiProblems({ score: 2, when: 3 })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatch(/^ai\.when 要是物件/)
  })

  it('pool：其中一個池不是物件擋下', () => {
    expect(poolProblems('meat.pool', { ram: 3 })).toEqual(['meat.pool.ram 要是 { max?, regen? }'])
  })

  it.each([
    [{ attack: { suppress: { auto: 'yes' } } }, /suppress\.auto 只能是 true/],
    [{ attack: { suppress: { auto: true, per_turn: 0 } } }, /suppress\.per_turn 要是 1 以上的整數/],
    [{ attack: { suppress: { dc: 12, skill: 'composure', per_turn: 1 } } }, /per_turn 只有 auto 用/],
    [{ attack: { suppress: { dc: 12, skill: 'composure', dc_bonus: 'x' } } }, /dc_bonus 要是數字/],
    [{ attack: { free_mag: true } }, /free_mag 要和 spend 一起寫/],
    [{ trigger: 'ally_attacked', react: { evade: 1 } }, /要搭配 \{ on, who \} 的 trigger/],
    [{ trigger: 5 }, /meat\.trigger 要是 \{ on, who, if\? \}/],
    [{ trigger: { on: 'checked', who: 'self', if: 3 }, do: [{ op: 'x' }] }, /trigger\.if 要是檢定的標籤/],
    [{ trigger: { on: 'overload', who: 'self', if: 'hit' }, do: [{ op: 'x' }] }, /trigger\.if 不能用在 overload/],
    [{ trigger: { on: 'attacked', who: 'self' }, react: 3 }, /meat\.react 要是物件/],
    [{ trigger: { on: 'attacked', who: 'self' }, react: { redirect: 'ally' } }, /redirect 只能是 'overlay'/],
    [{ trigger: { on: 'out_before', who: 'self' }, react: { prevent: { how: [] } } }, /prevent 要是 \{ how/],
    [{ react: { evade: 1 } }, /meat\.react 要搭配 trigger/],
    [{ tease: 3 }, /meat\.tease 要是/],
    [{ mask: 3 }, /meat\.mask 要是 \{ rounds \}/],
    [{ needs: { wounded: true } }, /meat\.needs 要先寫 target/],
    [{ target: 'self', range: [1, 2] }, /meat\.range 要先寫 target/],
    [{ target: 'enemy', picks: ['x'] }, /picks\[0\] 要是 \{ key, label, kind, required \}/],
    [{ target: 'enemy', picks: [{ key: 'a', label: 'A', kind: 'slot', needs: { wounded: true } }] }, /needs 只有 kind 是 foe、ally 的用/],
    [{ target: 'enemy', picks: [{ key: '', label: 'A', kind: 'foe' }] }, /key 要是 pick 的鍵/],
    [{ target: 'enemy', picks: [{ key: 'a', label: 'A', kind: 'foe' }, { key: 'a', label: 'B', kind: 'foe' }] }, /key「a」重複了/],
    [{ target: 'enemy', picks: [{ key: 'a', label: '', kind: 'foe' }] }, /label 要是給玩家看的名字/],
    [{ target: 'enemy', picks: [{ key: 'a', label: 'A', kind: 'foe', required: 'no' }] }, /required 要是 true 或 false/],
    [{ target: 'enemy', picks: [{ key: 'a', label: 'A', kind: 'choice' }] }, /kind 是 choice 時要有 meat\.choose/],
    [{ target: 'enemy', choose: [{ key: 'a', label: 'A', do: [{ op: 'x' }] }, { key: 'b', label: 'B', do: [{ op: 'x' }] }], picks: [{ key: 'a', label: 'A', kind: 'choice' }, { key: 'b', label: 'B', kind: 'choice' }] }, /最多只能有一個 choice/],
    [{ target: 'enemy', choose: [] }, /meat\.choose 要是/],
    [{ target: 'enemy', choose: ['x'] }, /choose\[0\] 要是 \{ key, label, do/],
    [{ target: 'enemy', choose: [{ key: '', label: 'A', do: [{ op: 'x' }] }] }, /key 要是選項的鍵/],
    [{ target: 'enemy', choose: [{ key: 'a', label: '', do: [{ op: 'x' }] }] }, /label 要是給玩家看的名字/],
    [{ target: 'foe_slot', choose: [{ key: 'a', label: 'A', do: [{ op: 'x' }], needs: { wounded: true } }] }, /needs 只對目標是人的技能有意思/],
    [{ tags: [] }, /meat\.tags 要是標籤的陣列/],
    [{ ransom: 3 }, /meat\.ransom 要是 \{ cash \}/],
    [{ alter: [] }, /meat\.alter 要是/],
    [{ alter: ['x'] }, /alter\[0\] 要是 \{ ability, set/],
    [{ alter: [{ ability: '', set: { 'attack.spend': 2 } }] }, /alter\[0\]\.ability 要是被改的技能的 id/],
    [{ alter: [{ ability: 'x', set: {} }] }, /alter\[0\]\.set 要是/],
    [{ alter: [{ ability: 'x', set: { 'attack.spend': 2 }, as_pick: { key: 'k' } }] }, /as_pick 要是 \{ key, label \}/],
  ] as const)('meat %j 擋下', (m, re) => {
    expect(meatProblems(m as Rec, 'active').join('\n')).toMatch(re)
  })

  it('prep.slot 是 0 合格（戰前佈置、情報網不花時段；2026-11-23 定案）', () => {
    expect(prepProblems({ slot: 0, scope: 'next_battle', meat: { mods: [{ kind: 'hit', value: 1 }] } }, 'prep').join('\n')).not.toMatch(/slot/)
  })

  it.each([
    [{ text: 3 }, /prep\.text 要是字串/],
    [{ slot: -1 }, /prep\.slot 要是 0 以上的整數/],
    [{ slot: 1.5 }, /prep\.slot 要是/],
    [{ meat: { do: [{ op: 'x' }] } }, /prep\.slot 一定要寫/],
    [{ slot: 1, meat: { do: [{ op: 'x' }] } }, /prep\.scope 一定要寫/],
    [{ slot: 1, scope: 'next_battle', meat: 3 }, /prep\.meat 要是 \{ mods\?, do\? \}/],
    [{ slot: 1, scope: 'next_battle', meat: {} }, /prep\.meat 要寫 mods 或 do/],
  ] as const)('prep %j 擋下', (p, re) => {
    expect(prepProblems(p, 'prep').join('\n')).toMatch(re)
  })

  it('applySet（alter 的路徑）：中間不是物件的補成物件；值是 null 就拿掉那一項；原本的 meat 不被改', () => {
    const base = { attack: { spend: 'all', suppress: { dc: 'spent' } }, target: 'enemy', range: 3 }
    const out = applySet(base, { 'attack.suppress.dc': 16, 'range.lo': 1, 'attack.spend': null })
    expect(out).toEqual({ attack: { suppress: { dc: 16 } }, target: 'enemy', range: { lo: 1 } })
    expect(base.attack.spend).toBe('all')
  })
})

// =====================================================================================================================
// 第二批：敵人招牌的 AI、叫人、攻擊的條件、池、誘惑攻擊的退路、反應、壓制
// =====================================================================================================================

const sig = (id: string, kind: string, more: Rec = {}): Rec => ({ id, name: `招牌${id}`, text: `${id}。`, enemy: true, kind, ...more })
const ENEMY_MOVES = [
  sig('ab_mend', 'active', { use: { ap: 1 }, meat: { target: 'ally', do: [{ op: 'heal', amount: 5 }] }, ai: { score: 2 } }),
  sig('ab_mark_slot', 'active', { use: { ap: 1 }, meat: { target: 'foe_slot', do: [{ op: 'status', status: 'marked' }] }, ai: { score: 2 } }),
  sig('ab_chrome', 'active', { use: { ap: 1 }, meat: { target: 'enemy', do: [{ op: 'status', status: 'marked' }] }, ai: { score: 2, when: { other_cyber: true } } }),
  sig('ab_wall', 'stance', { use: { ap: 1 }, meat: { when: { wounded: true }, mods: [{ kind: 'evade', value: 2 }] } }),
  sig('ab_guard', 'stance', { use: { ap: 1 }, meat: { mods: [{ kind: 'evade', value: 1 }] } }),
]
const FACE = ab('sk_face', 'passive', {
  name: '人面', meat: { call: { options: ['shot', 'cover_up', 'cover_down', 'heal', 'vent'], per_fight: 'half_tier_up', ap: 1, heal: 5, vent: 4 } },
})
const POOLS = ab('sk_pools', 'passive', { name: '池', meat: { pool: { grit: { regen: 1 }, load: { max: 2 }, favor_big: { max: 0, regen: 2 } } } })
const BURST = ab('sk_burst', 'active', { name: '連射', use: { ap: 3 }, meat: { target: 'enemy', attack: { spend: 'all', min_mag: 2 } } })
const TAP = ab('sk_tap', 'active', { name: '點放', use: { ap: 2 }, meat: { target: 'enemy', attack: { spend: 2 } } })
const ALTER_OTHER = ab('sk_alter', 'passive', { name: '改別的', meat: { alter: [{ ability: 'sk_tap', set: { 'attack.spend': 3 } }] } })
const NEED_ONE = ab('sk_need_one', 'active', { name: '點一格', use: { ap: 1 }, meat: { target: 'foe_slot', attack: { aimed: false } } })

function world(allies: unknown[], foes: unknown[], cover = { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }): Arena {
  return arena(duel(allies, foes, cover), FEATURES, (k: Kernel) => {
    k.content.loadPack({ id: 'wb2', content: { battle_status: STATUSES, path: [PATH], ability: [...ABILITIES, ...ENEMY_MOVES, FACE, POOLS, BURST, TAP, ALTER_OTHER, NEED_ONE] } } as unknown as ContentPack)
    readyFeatures(k)
  })
}
const eq = (ids: string[]): Rec => ({ ext: { abilities: { equipped: ids, tiers: { gunner: 3 } } } })
const defOf = (a: Arena, id: string) => a.k.battle.getAction(id)!

describe('白箱 敵人招牌的 AI（ENEMIES 4.3、4.5 節；dev/work/M1b-enemy-moves.md 第一節；features/abilities/ai.ts）', () => {
  it('目標是我方（治療）：挑生命比例最低的那一個', () => {
    const a = world([shooter()], [tough(eq(['ab_mend'])), tough({ hp: { now: 30, max: 300 } }), tough({ hp: { now: 200, max: 300 } })])
    expect(defOf(a, 'ab_mend').aiTarget!(a.run(), a.foe(1), a.ally(1))).toEqual({ unit: 'f2' })
  })

  it('目標是敵方的一格：AI 挑的那個敵人站的格；沒有挑人時是第一個選得了的格', () => {
    const a = world([shooter(), shooter({}, 2)], [tough(eq(['ab_mark_slot']))])
    expect(defOf(a, 'ab_mark_slot').aiTarget!(a.run(), a.foe(1), a.ally(2))).toEqual({ side: 'ally', slot: 2 })
    expect(defOf(a, 'ab_mark_slot').aiTarget!(a.run(), a.foe(1), null)).toEqual({ side: 'ally', slot: 1 })
    expect(defOf(a, 'ab_mark_slot').aiScore!(a.run(), a.foe(1), null)).toBe(2)
  })

  it('ai.when 的條件看 AI 挑的目標（other_cyber）：目標沒有義體不列，有就列', () => {
    const a = world([shooter()], [tough(eq(['ab_chrome']))])
    expect(defOf(a, 'ab_chrome').aiScore!(a.run(), a.foe(1), a.ally(1))).toBeNull()
    a.ally(1).cyber = 1
    expect(defOf(a, 'ab_chrome').aiScore!(a.run(), a.foe(1), a.ally(1))).toBe(2)
  })

  it('姿態：AI 的第一個回合自己開；條件不符的姿態跳過、開下一個；開過一次的不再開', () => {
    const a = world([shooter()], [tough({ ...eq(['ab_wall', 'ab_guard']), control: 'ai', ap: { now: 3, max: 3, regen: 3 } })])
    const f = a.foe(1)
    const run = a.run(dice())
    const step = () => a.k.battle.emit('ai.step', { run, unit: f } as never)
    step()
    expect(f.stance).toBe('ab_guard')
    // 關掉之後：開過一次（uses 記著），不再開
    delete f.stance
    step()
    expect(f.stance).toBeUndefined()
  })
})

describe('白箱 叫人（SKILL_TREES 掮客：人面「叫一個沒有上場的人出手一次」；features/abilities/battle.ts callAction）', () => {
  const mk = () => world([shooter({ ...eq(['sk_face']), actor: undefined }), shooter({}, 2), one({ weapon: 'pistol', load: undefined } as never, 3)], [tough()])
  const call = (a: Arena, input: Rec) => blocked(() => defOf(a, 'sk_face.call').run(a.run(dice()), a.ally(1), (input.target as never) ?? null, { action: 'sk_face.call', ...input } as never))
  const BAD = ['叫人要選一件事：補遮蔽、拆遮蔽，或支援射擊。']

  it('治療、排感載：目標要是一名在場上的隊友（不是一格、不是自己）', () => {
    const a = mk()
    expect(call(a, { pick: { option: 'heal' }, target: { side: 'ally', slot: 2 } })).toEqual(BAD)
    expect(call(a, { pick: { option: 'heal' }, target: { unit: 'a1' } })).toEqual(BAD)
    expect(call(a, { pick: { option: 'heal' }, target: { unit: 'f1' } })).toEqual(BAD)
    expect(a.ally(1).uses['sk_face.call']).toBeUndefined()
  })

  it('排感載：隊友沒有橋，擋下並說明原因；不算一次', () => {
    const a = mk()
    delete a.ally(3).load
    expect(call(a, { pick: { option: 'vent' }, target: { unit: 'a3' } })).toEqual([`${a.ally(3).name}沒有橋，沒有感載可以排。`])
    expect(a.ally(1).uses['sk_face.call']).toBeUndefined()
  })

  it('治療：照 call.heal 回復，算一次', () => {
    const a = mk()
    a.ally(2).hp!.now = 3
    expect(call(a, { pick: { option: 'heal' }, target: { unit: 'a2' } })).toEqual([])
    expect(a.ally(2).hp!.now).toBe(8)
    expect(a.ally(1).uses['sk_face.call']).toBe(1)
  })

  it('補遮蔽只能補我方的格；拆遮蔽只能拆敵方有遮蔽的格', () => {
    const a = mk()
    expect(call(a, { pick: { option: 'cover_up' }, target: { side: 'foe', slot: 1 } })).toEqual(BAD)
    expect(call(a, { pick: { option: 'cover_down' }, target: { side: 'foe', slot: 1 } })).toEqual(BAD)
    expect(call(a, { pick: { option: 'cover_down' }, target: { side: 'ally', slot: 1 } })).toEqual(BAD)
  })
})

describe('白箱 攻擊技能的條件（SKILL_TREES 連射控制「彈匣至少 2 格」、點放；features/abilities/battle.ts attackBlocks）', () => {
  it('連射：手上的槍沒有彈匣（不用彈匣的槍）也當成 0 格，擋下', () => {
    const { mag: _drop, ...bare } = testWeapon('pistol', 10)
    const a = world([shooter({ ...eq(['sk_burst']), weapons: [bare] })], [tough()])
    expect(defOf(a, 'sk_burst').blocks!(a.run(), a.ally(1))).toEqual(['彈匣裡要有 2 格以上才能連射。'])
  })

  it('點放（花固定 2 格）：彈匣不夠擋下；不用彈匣的槍不擋', () => {
    const { mag: _drop, ...bare } = testWeapon('pistol', 10)
    const a = world([shooter({ ...eq(['sk_tap']), weapons: [gun(1)] }), shooter({ ...eq(['sk_tap']), weapons: [bare] }, 2)], [tough()])
    expect(defOf(a, 'sk_tap').blocks!(a.run(), a.ally(1))).toEqual(['彈匣裡要有 2 格以上才能用。'])
    expect(defOf(a, 'sk_tap').blocks!(a.run(), a.ally(2))).toEqual([])
  })

  it('別的技能的 alter 只改它指定的那一個技能（改點放的不影響連射）', () => {
    const a = world([shooter({ ...eq(['sk_burst', 'sk_tap', 'sk_alter']), weapons: [gun(2)] })], [tough()])
    expect(defOf(a, 'sk_burst').blocks!(a.run(), a.ally(1))).toEqual([])
    // 點放被改成花 3 格：彈匣 2 格不夠
    expect(defOf(a, 'sk_tap').blocks!(a.run(), a.ally(1))).toEqual(['彈匣裡要有 3 格以上才能用。'])
  })

  it('目標是敵方的一格、要打人的技能：空的格灰掉「那一格沒有人。」', () => {
    const a = world([shooter(eq(['sk_need_one']))], [tough()])
    const t = defOf(a, 'sk_need_one').targets!(a.run(), a.ally(1))
    expect(t.find((o) => 'slot' in o.target && o.target.slot === 2)!.blocks).toEqual(['那一格沒有人。'])
    expect(t.find((o) => 'slot' in o.target && o.target.slot === 1)!.blocks).toEqual([])
  })
})

describe('白箱 被動給的池（dev/adr/0015 E1；features/abilities/battle.ts bumpPool）', () => {
  it('池沒有、只加每回合回復（max 沒寫或 0）：不憑空開一個池；沒有橋的人寫 load 也不動', () => {
    const a = world([shooter({ ...eq(['sk_pools']), load: undefined } as never)], [tough()])
    const u = a.ally(1)
    expect(u.pools.grit).toBeUndefined()
    expect(u.pools.favor_big).toBeUndefined()
    expect(u.load).toBeUndefined()
  })
})

describe('白箱 誘惑攻擊的退路（SKILL_TREES 名媛：入戲「距離 2 以內一名有橋的目標」；dev/adr/0015 E8；features/abilities/social.ts）', () => {
  const tease = (a: Arena, target: unknown) => {
    const run = a.run(dice(20, 6, 6))
    const last: Rec = {}
    run.effects([{ op: 'tease' }], { user: a.ally(1), target: target as never, source: SRC, last } as never)
    return { run, last }
  }

  it('從反應或效果做（不經過行動的目標檢查）：目標沒有橋，記一拍說明、ok 是 false、不擲骰', () => {
    const a = world([shooter()], [tough({ load: undefined })])
    delete a.foe(1).load
    const { run } = tease(a, { unit: 'f1' })
    expect(run.beats.some((b) => (b.data as Rec | undefined)?.blocked === 'bridge')).toBe(true)
    expect(run.beats.some((b) => b.roll)).toBe(false)
  })

  it('目標太遠（距離超過 2）：記一拍說明、不擲骰', () => {
    const a = world([shooter()], [tough(), tough(), tough({ load: { now: 0, max: 20 } })])
    a.foe(3).load = { now: 0, max: 20 } as never
    const { run } = tease(a, { unit: 'f3' })
    expect(run.beats.some((b) => (b.data as Rec | undefined)?.blocked === 'range')).toBe(true)
    expect(run.beats.some((b) => b.roll)).toBe(false)
  })

  it('沒有落在人身上（目標是一格）：什麼都不做', () => {
    const a = world([shooter()], [tough()])
    const { run } = tease(a, { side: 'foe', slot: 1 })
    expect(run.beats).toEqual([])
  })
})

// 讓 GameState 的型別引用不被當成沒用到
export type _Unused = GameState
