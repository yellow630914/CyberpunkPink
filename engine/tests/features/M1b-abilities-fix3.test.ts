// 驗收測試：dev/work/M1b-core-fix3.md 的後續（features/abilities 套用核心的新規則；dev/adr/0015 補記 M1b-core-fix3）。
// 一、buff 的 own_turn_end：他在自己的回合裡給自己的，這個回合的結束不算（UnitBuff.skip，和狀態同一個規則 run.skipsOwnTurnEnd）；
// 二、守著（ward）與臨時遮蔽（cover_temp）的 until: own_turn_end 給自己時照同一個規則；
// 三、條件 in_cover、other_exposed 問有效的遮蔽（run.coverOf、isExposed：堡壘姿態的 cover_level 算在內）；
// 四、skill picks 的 kind: foe_overlay 的格式檢查（列選項與選了之後的行動在 M1b-hack.test.ts）；
// 五、branch 不再有 self 欄位。內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleRun, BattleUnit, ContentPack, Kernel } from '../../src'
import { beginTurn, readyFeatures } from '../../src'
import { abilitiesFeature } from '../../src/features/abilities'
import { unitBuffs } from '../../src/features/abilities/unitdata'
import { combatFeature } from '../../src/features/combat'
import { makeGame } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const FEATURES = [combatFeature, abilitiesFeature]
const SRC = { kind: 'ability', id: 'sk_x', name: '測試技能' } as const
const quiet = { ap: { now: 0, max: 0, regen: 0 } }

const TREE = { id: 'tst', name: '測試', tree: '測試樹', category: 'meat', signature: 'sk_fort', domains: { meat: 'strong', net: 'none', opinion: 'none' }, resonance: [] }
const sk = (id: string, kind: string, more: Rec = {}): Rec => ({
  id, name: id, path: 'tst', category: 'meat', tier: 1, layer: id === 'sk_fort' ? 'signature' : 'front', kind, cap: 1, xp: 20, cells: 1, ...(id === 'sk_fort' ? {} : { after: 'sk_fort' }), text: `${id}。`, net: null, opinion: null, meat: null, ...more,
})
const ABILITIES: Rec[] = [
  // 堡壘姿態：你後面那一格的遮蔽高一級（最高到掩體）
  sk('sk_fort', 'stance', { name: '堡壘姿態', use: { ap: 1 }, meat: { mods: [{ kind: 'cover_level', value: 1, who: 'behind' }] } }),
  // 要站在有遮蔽的格子：命中 +3
  sk('sk_needs_cover', 'passive', { meat: { mods: [{ kind: 'hit', value: 3, when: { in_cover: true } }] } }),
  // 對手暴露：命中 +2
  sk('sk_hunter', 'passive', { meat: { mods: [{ kind: 'hit', value: 2, when: { other_exposed: true } }] } }),
]
const pack = (abilities: Rec[] = ABILITIES): ContentPack => ({ id: 'fix3_test', content: { battle_status: TEST_STATUSES, path: [TREE], ability: abilities } } as unknown as ContentPack)
const equip = (ids: string[], more: Rec = {}): Rec => ({ ext: { abilities: { equipped: ids, tiers: { tst: 1 } } }, ...more })

function world(o: { allies?: unknown[]; foes?: unknown[]; cover?: { ally: number[]; foe: number[] } } = {}): Arena {
  return arena(duel(o.allies ?? [one({ weapon: 'pistol', ...quiet }, 1), one({ weapon: 'pistol', ...quiet }, 2), one({ weapon: 'pistol', ...quiet }, 3)], o.foes ?? [foe('minion', quiet), foe('minion', quiet)], o.cover), FEATURES, (k: Kernel) => {
    k.content.loadPack(pack())
    readyFeatures(k)
  })
}

/** 輪到 id 的回合，而且這個回合正在進行（battle.acting）：他給自己的 own_turn_end 看這個。 */
function startTurn(a: Arena, id: string): void {
  a.battle.order = [id, ...a.battle.order.filter((x) => x !== id)]
  delete a.battle.acting
  a.battle.turn = 0
  beginTurn(a.run(), a.battle.units[id]!)
}
const endTurn = (a: Arena, id: string): void => void a.k.battle.emit('turn.end', { run: a.run(), unit: a.battle.units[id]! })
const buffIds = (u: BattleUnit): string[] => unitBuffs(u).map((b) => b.id)
const give = (a: Arena, user: string, target: string, e: Rec): BattleRun => {
  const run = a.run()
  run.effects([e], { user: run.unit(user), target: { unit: target }, source: SRC, n: { tier: 1 } })
  return run
}
const buff = (turns: number, until: string, more: Rec = {}): Rec => ({ op: 'buff', id: 'b', name: '測試 buff', turns, until, mods: [{ kind: 'hit', value: 1 }], ...more })

describe('buff 的 own_turn_end：給自己、又在自己的回合裡給，這個回合的結束不算', () => {
  it('turns 1：標 skip；第一個回合結束只拿掉記號（還在），第二個回合結束才到期、做 on_end', () => {
    const a = world()
    startTurn(a, 'a1')
    give(a, 'a1', 'a1', buff(1, 'own_turn_end', { on_end: [{ op: 'heal', amount: 1 }] }))
    expect(unitBuffs(a.ally(1))[0]).toMatchObject({ id: 'b', turns: 1, skip: true })
    endTurn(a, 'a1')
    expect(unitBuffs(a.ally(1))[0]).toMatchObject({ id: 'b', turns: 1 })
    expect(unitBuffs(a.ally(1))[0]!.skip).toBeUndefined()
    endTurn(a, 'a1')
    expect(buffIds(a.ally(1))).toEqual([])
  })

  it('turns 2（心流、子彈時間的寫法）：這個回合 + 之後兩個回合，一共三次回合結束才到期', () => {
    const a = world()
    startTurn(a, 'a1')
    give(a, 'a1', 'a1', buff(2, 'own_turn_end'))
    endTurn(a, 'a1') // 這個回合：不算
    endTurn(a, 'a1') // 第 1 個
    expect(buffIds(a.ally(1))).toEqual(['b'])
    endTurn(a, 'a1') // 第 2 個：到期
    expect(buffIds(a.ally(1))).toEqual([])
  })

  it('不套用的情形：別人給的、不在自己的回合裡給的、沒有輪到他的回合（acting 沒設）、給別人、source_turn_end、own_turn_start：都沒有 skip', () => {
    const a = world()
    startTurn(a, 'a1')
    // 別人（a2）在他的回合裡給他
    give(a, 'a2', 'a1', buff(1, 'own_turn_end', { id: 'by_other' }))
    // 他給別人（a3）
    give(a, 'a1', 'a3', buff(1, 'own_turn_end', { id: 'to_other' }))
    // 給自己，但不是 own_turn_end
    give(a, 'a1', 'a1', buff(1, 'source_turn_end', { id: 'src_end' }))
    give(a, 'a1', 'a1', buff(1, 'own_turn_start', { id: 'own_start' }))
    for (const [id, who] of [['by_other', 'a1'], ['to_other', 'a3'], ['src_end', 'a1'], ['own_start', 'a1']] as const) {
      expect(unitBuffs(a.battle.units[who]!).find((b) => b.id === id)!.skip, id).toBeUndefined()
    }
    // 不在自己的回合裡：輪到的是 a2，a1 給自己
    const b = world()
    startTurn(b, 'a2')
    give(b, 'a1', 'a1', buff(1, 'own_turn_end'))
    expect(unitBuffs(b.ally(1))[0]!.skip).toBeUndefined()
    endTurn(b, 'a1')
    expect(buffIds(b.ally(1))).toEqual([])
    // 回合不在進行（acting 沒設）
    const c = world()
    delete c.battle.acting
    give(c, 'a1', 'a1', buff(1, 'own_turn_end'))
    expect(unitBuffs(c.ally(1))[0]!.skip).toBeUndefined()
  })

  it('同一個 id 再掛一次是重算：在別人的回合裡重掛，skip 也跟著重算（不留舊的記號）', () => {
    const a = world()
    startTurn(a, 'a1')
    give(a, 'a1', 'a1', buff(1, 'own_turn_end'))
    expect(unitBuffs(a.ally(1))[0]!.skip).toBe(true)
    startTurn(a, 'a2')
    give(a, 'a1', 'a1', buff(1, 'own_turn_end'))
    expect(unitBuffs(a.ally(1))[0]!.skip).toBeUndefined()
  })
})

describe('守著與臨時遮蔽：until: own_turn_end 給自己時照同一個規則', () => {
  const wardsOf = (u: BattleUnit): Rec[] => (((u.ext.abilities as Rec | undefined)?.wards ?? []) as Rec[])
  const ward = (until: string): Rec => ({ op: 'ward', slot: 'target', until, on: ['move'], do: [{ op: 'attack' }] })
  const putWard = (a: Arena, until: string): void => {
    const run = a.run()
    run.effects([ward(until)], { user: a.ally(1), target: { side: 'foe', slot: 1 }, source: { kind: 'ability', id: 'sk_ward', name: '守' }, n: { tier: 1 } })
  }

  it('守著：自己的回合裡守、到自己的回合結束：這個回合的結束不算，下一個自己的回合結束才失效', () => {
    const a = world()
    startTurn(a, 'a1')
    putWard(a, 'own_turn_end')
    expect(wardsOf(a.ally(1))).toHaveLength(1)
    endTurn(a, 'a1')
    expect(wardsOf(a.ally(1))).toHaveLength(1)
    expect(wardsOf(a.ally(1))[0]!.skip).toBeUndefined()
    endTurn(a, 'a1')
    expect(wardsOf(a.ally(1))).toHaveLength(0)
  })

  it('守著：不在自己的回合裡守（反應）：第一個自己的回合結束就失效；預設的 own_turn_start 不受影響', () => {
    const a = world()
    startTurn(a, 'a2')
    putWard(a, 'own_turn_end')
    expect(wardsOf(a.ally(1))[0]!.skip).toBeUndefined()
    endTurn(a, 'a1')
    expect(wardsOf(a.ally(1))).toHaveLength(0)
    const b = world()
    startTurn(b, 'a1')
    putWard(b, 'own_turn_start')
    expect(wardsOf(b.ally(1))[0]!.skip).toBeUndefined()
  })

  const cover = (a: Arena): number => a.battle.cover.ally[0]!.level

  it('臨時遮蔽（cover_temp）：自己的回合裡升、到自己的回合結束：這個回合的結束不算，下一個自己的回合結束才拿回來', () => {
    const a = world()
    startTurn(a, 'a1')
    a.run().effects([{ op: 'cover_temp', who: 'self', levels: 1, until: 'own_turn_end' }], { user: a.ally(1), target: { unit: 'a1' }, source: SRC, n: { tier: 1 } })
    expect(cover(a)).toBe(1)
    endTurn(a, 'a1')
    expect(cover(a)).toBe(1)
    endTurn(a, 'a1')
    expect(cover(a)).toBe(0)
  })

  it('臨時遮蔽：不在自己的回合裡升，第一個自己的回合結束就拿回來；預設（own_turn_start）不受影響', () => {
    const a = world()
    startTurn(a, 'a2')
    a.run().effects([{ op: 'cover_temp', who: 'self', levels: 1, until: 'own_turn_end' }], { user: a.ally(1), target: { unit: 'a1' }, source: SRC, n: { tier: 1 } })
    endTurn(a, 'a1')
    expect(cover(a)).toBe(0)
    const b = world()
    startTurn(b, 'a1')
    b.run().effects([{ op: 'cover_temp', who: 'self', levels: 1 }], { user: b.ally(1), target: { unit: 'a1' }, source: SRC, n: { tier: 1 } })
    endTurn(b, 'a1')
    expect(cover(b)).toBe(1)
    startTurn(b, 'a1')
    expect(cover(b)).toBe(0)
  })
})

describe('條件 in_cover、other_exposed 問有效的遮蔽（堡壘姿態的 cover_level 算在內）', () => {
  const hit = (a: Arena, id: string, other?: string): number => {
    const run = a.run()
    return run.mods('hit', run.unit(id), other ? run.unit(other) : undefined, undefined, []).filter((p) => p.source === 'skill').reduce((s, p) => s + p.value, 0)
  }

  it('in_cover：站在暴露的格子、但前面的人開著堡壘姿態（後面那一格高一級）：條件成立；沒開姿態就不成立', () => {
    const allies = (stance?: string) => [
      one({ weapon: 'pistol', ...quiet, ...equip(['sk_fort'], stance ? { stance } : {}) }, 1),
      one({ weapon: 'pistol', ...quiet, ...equip(['sk_needs_cover']) }, 2),
      one({ weapon: 'pistol', ...quiet }, 3),
    ]
    const off = world({ allies: allies() })
    expect(off.run().coverOf(off.ally(2))).toBe(0)
    expect(hit(off, 'a2')).toBe(0)
    const on = world({ allies: allies('sk_fort') })
    expect(on.run().coverOf(on.ally(2))).toBe(1)
    expect(hit(on, 'a2')).toBe(3)
    // 站位換了（後面那一格不是 a2 了）就自己沒了：a1 的前面沒人，a2 換到第 3 格
    on.run().move(on.ally(2), 3)
    expect(hit(on, 'a2')).toBe(0)
  })

  it('in_cover：那一格本身有遮蔽照舊成立（不開姿態）', () => {
    const a = world({ allies: [one({ weapon: 'pistol', ...quiet }, 1), one({ weapon: 'pistol', ...quiet, ...equip(['sk_needs_cover']) }, 2), one({ weapon: 'pistol', ...quiet }, 3)], cover: { ally: [0, 1, 0, 0], foe: [0, 0, 0, 0] } })
    expect(hit(a, 'a2')).toBe(3)
  })

  it('other_exposed：對手站在暴露的格子、但他前面的人開著堡壘姿態：對手不算暴露，條件不成立；沒開姿態成立', () => {
    const foes = (stance?: string) => [foe('minion', { ...quiet, ...equip(['sk_fort'], stance ? { stance } : {}) }), foe('minion', quiet)]
    const mine = [one({ weapon: 'pistol', ...quiet, ...equip(['sk_hunter']) }, 1), one({ weapon: 'pistol', ...quiet }, 2)]
    const off = world({ allies: mine, foes: foes() })
    expect(off.run().isExposed(off.foe(2))).toBe(true)
    expect(hit(off, 'a1', 'f2')).toBe(2)
    const on = world({ allies: mine, foes: foes('sk_fort') })
    expect(on.run().isExposed(on.foe(2))).toBe(false)
    expect(hit(on, 'a1', 'f2')).toBe(0)
    // 站在第 1 格的堡壘姿態本人沒有被遮：照舊暴露
    expect(hit(on, 'a1', 'f1')).toBe(2)
  })
})

describe('格式：picks 的 kind: foe_overlay、branch 不再有 self', () => {
  const load = (meat: Rec) => () => makeGame({ features: FEATURES, content: [pack([...ABILITIES, sk('sk_bad', 'active', { use: { ap: 1 }, meat })])] })

  it('kind: foe_overlay 載得進來（鍵要叫 overlay：效果的 who: foe_overlay 讀 pick.overlay）；別的鍵、別的 kind 被擋下', () => {
    expect(load({ target: 'none', picks: [{ key: 'overlay', label: '哪一台', kind: 'foe_overlay', required: false }], do: [{ op: 'heal', who: 'self', amount: 1 }] })).not.toThrow()
    expect(load({ target: 'none', picks: [{ key: 'which', label: '哪一台', kind: 'foe_overlay' }], do: [{ op: 'heal', who: 'self', amount: 1 }] })).toThrow(/overlay/)
    expect(load({ target: 'none', picks: [{ key: 'overlay', label: '哪一台', kind: 'planet' }], do: [{ op: 'heal', who: 'self', amount: 1 }] })).toThrow(/foe_overlay/)
  })

  it('branch 的 self 欄位拿掉了：寫了被擋下；needs、when 都沒寫還是被擋下', () => {
    expect(load({ target: 'enemy', do: [{ op: 'branch', self: true, when: { wounded: true }, do: [{ op: 'heal', amount: 1 }] }] })).toThrow(/self：不認得的欄位/)
    expect(load({ target: 'enemy', do: [{ op: 'branch', do: [{ op: 'heal', amount: 1 }] }] })).toThrow(/needs、when：至少要寫一個/)
    expect(load({ target: 'enemy', do: [{ op: 'branch', when: { wounded: true }, do: [{ op: 'heal', amount: 1 }] }] })).not.toThrow()
  })
})
