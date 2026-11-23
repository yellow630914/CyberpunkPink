// 驗收測試：dev/work/M1b-random-picks.md（cpp-feature）。使用者 2026-11-23 定案：開打前要選的東西一律隨機。
// 戰鬥直覺（開戰分配）、黑市門路（隨機一名隊友）、戰前佈置（藏貨／安排人／打點隨機一種）、情報網（隨機一名敵人被標記）、
// 幫槍槍保養（主武器彈匣容量 +1、最多 4）。用的是正式的示意資料（engine/data），一律走真的流程：載入內容 → 預備 → 開打。
// 每一項：同種子兩次結果相同、不同種子會出現不同結果、結果落在合法範圍。規格：SKILL_TREES 槍手與掮客；dev/adr/0015 的「隨機的指定」補記。

import { describe, expect, it } from 'vitest'
import type { BattleUnit, Game } from '../../src'
import { BattleRun, coverAt } from '../../src'
import { allFeatures } from '../../src/features'
import { prep, prepBlock } from '../../src/features/abilities'
import { makeGame, testWeapon } from '../../src/testkit'
import { CORE_PACK } from '../../data'
import { duel, foe, one } from '../helpers/battle'

type Rec = Record<string, unknown>
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1)

const quiet = { ap: { now: 0, max: 0, regen: 0 } }
const mate = (i: number, o: Rec = {}) => one({ weapon: 'pistol', ...o } as never, i)
const minion = () => foe('minion', { ...quiet } as never)

interface Owner { ids: string[]; spent?: Rec; prepared?: string[] }

function start(seed: number, owner: Owner, allies: unknown[], foes: unknown[] = [minion(), minion(), minion()]): Game {
  const abilities = { xp: 0, learned: owner.ids, equipped: owner.ids, spent: owner.spent ?? { gunner: 120, fixer: 120 }, ...(owner.prepared ? { prepared: owner.prepared.map((id) => ({ id, scope: 'next_battle' })) } : {}) }
  const game = makeGame({ features: allFeatures(), content: [CORE_PACK], seed, pc: { ext: { abilities } } } as never).game
  game.startBattle(duel(allies, foes))
  return game
}
const me = (o: Rec = {}) => one({ actor: 'pc', weapon: 'pistol', ...o } as never)
const unit = (g: Game, id: string): BattleUnit => g.state.battle!.units[id]!
const sum = (r: Rec): number => Object.values(r).reduce((n: number, v) => n + (v as number), 0)
const ALL3 = (v: unknown): boolean => typeof v === 'number' && v >= 0 && v <= 3

describe('戰鬥直覺：開戰時點數隨機分到先攻、命中、迴避（每項上限照原規則）', () => {
  const ids = ['sk_gunner_instinct']
  const alloc = (seed: number, spent = 120): Rec => unit(start(seed, { ids, spent: { gunner: spent } }, [me()]), 'a1').ext.instinct as Rec

  it('同一個種子兩次結果相同', () => {
    for (const seed of [1, 2, 3]) expect(alloc(seed)).toEqual(alloc(seed))
  })

  it('不同種子會出現不同的分法；每一種都落在合法範圍（總數是階數的點數、每項 0～3）', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const a = alloc(seed)
      expect(sum(a)).toBe(3)
      for (const v of Object.values(a)) expect(ALL3(v)).toBe(true)
      seen.add(JSON.stringify(a))
    }
    expect(seen.size).toBeGreaterThan(3)
  })

  it('4 階 4 點、5 階 6 點（5 階共鳴 +1，示意資料的共鳴）：總數對、每項不超過 3', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const four = alloc(seed, 240)
      expect(sum(four)).toBe(4)
      const five = alloc(seed, 400)
      expect(sum(five)).toBe(6)
      for (const v of Object.values(five)) expect((v as number) <= 3).toBe(true)
    }
  })

  it('分配吃進修正：每 1 點先攻 +3、命中 +1、迴避 +1；戰鬥中仍可花 1 行動點重分配', () => {
    const g = start(5, { ids, spent: { gunner: 120 } }, [me({ ap: { now: 20, max: 20, regen: 3 } })])
    const a = unit(g, 'a1').ext.instinct as Rec
    // 示意資料的 1 階共鳴本身也有一筆先攻、同一個名字；所以看重分配前後的差
    const modOf = (kind: 'initiative' | 'hit' | 'evade') => new BattleRun(g.k, g.state, g.state.battle!).mods(kind, unit(g, 'a1')).filter((p) => p.label === '戰鬥直覺').reduce((n, p) => n + p.value, 0)
    const before = { initiative: modOf('initiative'), hit: modOf('hit'), evade: modOf('evade') }
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1')
    unit(g, 'a1').control = 'player'
    const o = g.battleOptions()!.actions.find((x) => x.id === 'sk_gunner_instinct.realloc')!
    expect(o.blocks).toEqual([])
    expect(g.battleAct({ action: 'sk_gunner_instinct.realloc', pick: { initiative: 0, hit: 3, evade: 0 } }).status).toBe('applied')
    expect(unit(g, 'a1').ext.instinct).toEqual({ initiative: 0, hit: 3, evade: 0 })
    expect(modOf('initiative') - before.initiative).toBe(-(a.initiative as number) * 3)
    expect(modOf('hit') - before.hit).toBe(3 - (a.hit as number))
    expect(modOf('evade') - before.evade).toBe(-(a.evade as number))
  })

  it('角色身上的 preset 不再讀（舊存檔照樣開得起來）', () => {
    const owner = { ids, spent: { gunner: 120 } }
    const game = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 3, pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: owner.spent, preset: { instinct: { initiative: 3, hit: 0, evade: 0 } } } } } } as never).game
    game.startBattle(duel([me()], [minion()]))
    expect(sum(unit(game, 'a1').ext.instinct as Rec)).toBe(3)
  })
})

describe('黑市門路：開戰時隨機一名隊友彈匣多一格（可以超過容量）', () => {
  const ids = ['sk_fixer_face', 'sk_fixer_black_market']
  const who = (seed: number): string[] => {
    const g = start(seed, { ids }, [me(), mate(2), mate(3)])
    return ['a1', 'a2', 'a3'].filter((id) => unit(g, id).weapons[0]!.mag!.now === 3)
  }

  it('同種子相同；每次剛好一名隊友多一格（最大容量不變），自己不算；不同種子兩位隊友都會被抽到', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const got = who(seed)
      expect(got).toEqual(who(seed))
      expect(got).toHaveLength(1)
      expect(['a2', 'a3']).toContain(got[0])
      seen.add(got[0]!)
    }
    expect([...seen].sort()).toEqual(['a2', 'a3'])
    const g = start(1, { ids }, [me(), mate(2), mate(3)])
    expect(['a1', 'a2', 'a3'].map((id) => unit(g, id).weapons[0]!.mag!.max)).toEqual([2, 2, 2])
  })

  it('沒有隊友：沒有效果；倒下的隊友不會被挑中', () => {
    const g = start(1, { ids }, [me()])
    expect(unit(g, 'a1').weapons[0]!.mag).toEqual({ now: 2, max: 2 })
  })
})

describe('戰前佈置：藏貨、安排人、打點，開戰時隨機一種', () => {
  const ids = ['sk_fixer_face', 'sk_fixer_prep']
  const kind = (g: Game): string[] => {
    const b = g.state.battle!
    const out: string[] = []
    if ([1, 2, 3, 4].some((s) => coverAt(b, 'ally', s).level > 0)) out.push('cache')
    if (((unit(g, 'a1').ext.abilities as Rec).buffs as Array<{ id: string }> | undefined)?.some((x) => x.id === 'staging_crew')) out.push('crew')
    if (Object.values(b.units).some((u) => u.side === 'foe' && u.statuses.some((s) => s.id === 'suppressed'))) out.push('greased')
    return out
  }
  const go = (seed: number, foes?: unknown[]): Game => start(seed, { ids, prepared: ['sk_fixer_prep'] }, [me(), mate(2)], foes)

  it('同種子相同；每次剛好一種；不同種子三種都會出現', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const got = kind(go(seed))
      expect(got).toEqual(kind(go(seed)))
      expect(got).toHaveLength(1)
      seen.add(got[0]!)
    }
    expect([...seen].sort()).toEqual(['cache', 'crew', 'greased'])
  })

  it('藏貨：某個我方的格子多一級遮蔽；安排人：叫人的次數 +1（call_uses）；打點：一名敵方雜兵第一回合被壓制', () => {
    for (const seed of SEEDS) {
      const g = go(seed)
      const [k] = kind(g)
      const run = new BattleRun(g.k, g.state, g.state.battle!)
      const calls = run.mods('call_uses' as never, run.unit('a1')).reduce((n, p) => n + p.value, 0)
      if (k === 'cache') {
        const levels = [1, 2, 3, 4].map((s) => coverAt(g.state.battle!, 'ally', s).level)
        expect(levels.filter((l) => l > 0)).toHaveLength(1)
        expect(levels.filter((l) => l > 0)[0]).toBe(1)
      }
      if (k === 'greased') {
        const hit = Object.values(g.state.battle!.units).filter((u) => u.side === 'foe' && u.statuses.some((s) => s.id === 'suppressed'))
        expect(hit).toHaveLength(1)
        expect(hit[0]!.rank).toBe('minion')
      }
      expect(calls).toBe(k === 'crew' ? 1 : 0)
    }
  })

  it('敵方沒有雜兵：不會抽到打點', () => {
    const elites = () => [foe('elite', { ...quiet } as never), foe('elite', { ...quiet } as never)]
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const got = kind(go(seed, elites()))
      expect(got).toHaveLength(1)
      seen.add(got[0]!)
    }
    expect([...seen].sort()).toEqual(['cache', 'crew'])
  })

  it('預備不花時段（prep.slot 0）：報告裡沒有時間的變更，只記預備好了', () => {
    const game = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 1, pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { fixer: 120 } } } } } as never).game
    expect(prepBlock(game.k, game.state, 'pc', 'sk_fixer_prep')).toBeNull()
    const draft = prep(game.k, game.state, 'pc', 'sk_fixer_prep')
    expect(draft.changes.some((c) => c.op === 'time')).toBe(false)
    expect(draft.outcome.summary).toContain('不花時段')
    game.commit(draft)
    expect((game.state.actors.pc!.ext.abilities as Rec).prepared).toEqual([{ id: 'sk_fixer_prep', scope: 'next_battle' }])
  })
})

describe('情報網：全隊先攻 +3，開場隨機一名敵人被標記到第二回合結束', () => {
  const ids = ['sk_fixer_face', 'sk_fixer_black_market', 'sk_fixer_intel_net']
  const go = (seed: number): Game => start(seed, { ids, prepared: ['sk_fixer_intel_net'] }, [me(), mate(2)])
  const marked = (g: Game): string[] => Object.values(g.state.battle!.units).filter((u) => u.side === 'foe' && u.statuses.some((s) => s.id === 'marked')).map((u) => u.id)

  it('同種子相同；剛好一名敵人被標記；不同種子三個敵人都會被抽到', () => {
    const seen = new Set<string>()
    for (const seed of SEEDS) {
      const got = marked(go(seed))
      expect(got).toEqual(marked(go(seed)))
      expect(got).toHaveLength(1)
      seen.add(got[0]!)
    }
    expect([...seen].sort()).toEqual(['f1', 'f2', 'f3'])
  })

  it('標記撐到第二回合結束（記著數 2 個我方回合結束）；全隊先攻 +3', () => {
    const g = go(4)
    const target = unit(g, marked(g)[0]!)
    const st = target.statuses.find((s) => s.id === 'marked')!
    // 到情報網的人（a1）的第二個回合結束
    expect(st.until).toMatchObject({ at: 'turn_end', of: 'a1', turns: 2 })
    const run = new BattleRun(g.k, g.state, g.state.battle!)
    for (const id of ['a1', 'a2']) expect(run.mods('initiative', run.unit(id)).filter((p) => p.label === '情報網').reduce((n, p) => n + p.value, 0)).toBe(3)
    // 敵人沒有
    expect(run.mods('initiative', run.unit('f1')).filter((p) => p.label === '情報網')).toEqual([])
  })
})

describe('幫槍槍保養：下一場主武器彈匣容量 +1（最多 4），再下一場沒有', () => {
  const ids = ['sk_gunner_instinct', 'sk_gunner_burst', 'sk_gunner_loadout_mastery', 'sk_gunner_gun_care']
  const rifle = (n: number) => ({ ...testWeapon('pistol', 10), mag: { now: n, max: n } })
  const setup = (n: number) => duel([me({ weapons: [rifle(n)] })], [minion()])
  const mag = (g: Game) => unit(g, 'a1').weapons[0]!.mag

  it('預備之後開打：彈匣 2 → 3（裝滿）；用掉就清，下一場回到 2', async () => {
    const g = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 3, pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { gunner: 120 } } } } } as never).game
    expect(prepBlock(g.k, g.state, 'pc', 'sk_gunner_gun_care')).toBeNull()
    g.commit(prep(g.k, g.state, 'pc', 'sk_gunner_gun_care'))
    g.startBattle(setup(2))
    expect(mag(g)).toEqual({ now: 3, max: 3 })
    g.state.battle!.result = { outcome: 'win', text: '測試用。' }
    await g.finishBattle()
    g.startBattle(setup(2))
    expect(mag(g)).toEqual({ now: 2, max: 2 })
  })

  it('最多到 4 格：3 格的槍 → 4；已經 4 格的槍不變', () => {
    for (const [from, to] of [[3, 4], [4, 4], [1, 2]] as const) {
      const g = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 3, pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { gunner: 120 }, prepared: [{ id: 'sk_gunner_gun_care', scope: 'next_battle' }] } } } } as never).game
      g.startBattle(setup(from))
      expect(mag(g)).toEqual({ now: to, max: to })
    }
  })

  it('沒有預備就沒有效果；沒有彈匣的武器（近戰）不受影響', () => {
    const g = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 3, pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { gunner: 120 } } } } } as never).game
    g.startBattle(setup(2))
    expect(mag(g)).toEqual({ now: 2, max: 2 })
    const h = makeGame({ features: allFeatures(), content: [CORE_PACK], seed: 3, pc: { ext: { abilities: { xp: 0, learned: ids, equipped: ids, spent: { gunner: 120 }, prepared: [{ id: 'sk_gunner_gun_care', scope: 'next_battle' }] } } } } as never).game
    h.startBattle(duel([me({ weapons: [testWeapon('knife', 10)] })], [minion()]))
    expect(unit(h, 'a1').weapons[0]!.mag).toBeUndefined()
  })
})

describe('格式：pick_random、one_of、mag_cap 寫錯時載入就擋下，訊息裡有那個欄位', () => {
  const game = makeGame({ features: allFeatures(), content: [CORE_PACK] }).game
  const p = (list: Rec[]): string => game.k.battle.effectProblems(list).join('\n')

  it('pick_random：key、from 一定要寫，from 只收 ally、member、foe、minion', () => {
    expect(p([{ op: 'pick_random', from: 'ally' }])).toMatch(/key/)
    expect(p([{ op: 'pick_random', key: 'k' }])).toMatch(/from/)
    expect(p([{ op: 'pick_random', key: 'k', from: 'galaxy' }])).toMatch(/galaxy/)
    expect(p([{ op: 'pick_random', key: 'k', from: 'foe', extra: 1 }])).toMatch(/extra/)
    expect(p([{ op: 'pick_random', key: 'k', from: 'minion' }, { op: 'status', status: 'marked', who: 'pick:k' }])).toBe('')
  })

  it('one_of：要兩個以上選項、選項的 key 不能重複、裡面的效果也要查得到', () => {
    const o = (key: string, d: Rec[] = [{ op: 'ap', amount: 1 }]) => ({ key, label: key, do: d })
    expect(p([{ op: 'one_of', options: [o('a'), o('b')] }])).toMatch(/key/)
    expect(p([{ op: 'one_of', key: 'x', options: [o('a')] }])).toMatch(/options/)
    expect(p([{ op: 'one_of', key: 'x', options: [o('a'), o('a')] }])).toMatch(/重複/)
    expect(p([{ op: 'one_of', key: 'x', options: [o('a'), o('b', [{ op: 'ghost_op' }])] }])).toMatch(/ghost_op/)
    expect(p([{ op: 'one_of', key: 'x', options: [o('a'), o('b')] }])).toBe('')
  })

  it('mag_cap：amount 一定要寫、max 是 1 以上的數字', () => {
    expect(p([{ op: 'mag_cap' }])).toMatch(/amount/)
    expect(p([{ op: 'mag_cap', amount: 1, max: 0 }])).toMatch(/max/)
    expect(p([{ op: 'mag_cap', amount: 1, max: 4 }])).toBe('')
  })
})
