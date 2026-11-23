// M2 核心的戰鬥接縫（dev/adr/0016 第五節、G7；dev/work/M2-core-battle.md）：候補與叫人（k.battle.bench、run.callIn）、
// 開戰設定的先攻優勢（edge）、battleOptions 給的距離（distances）。只用核心與測試用的行動表（TEST_COMBAT）；
// 候補的來源在測試裡臨時註冊，內容用測試自帶的假資料。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BattleSetup, BattleState, Feature, Kernel } from '../../src'
import { BATTLE_EVENTS, BattleRun, advance, battleProblems, clone, createKernel, currentUnit, distance, initiativeOrder, setupBattle } from '../../src'
import { TEST_COMBAT, fixDice, makeActor, makeBattleGame, makeState, playOut, stateHash } from '../../src/testkit'
import { duel, foe, one, raw } from '../helpers/battle'

afterEach(() => vi.restoreAllMocks())

/** 不經過提交的一場戰鬥，附上幾個角色（叫人用 { from: 'actor' } 時要查得到）；prepare 先在核心上註冊東西。 */
function build(setup: BattleSetup, o: { actors?: Array<ReturnType<typeof makeActor>>; prepare?: (k: Kernel) => void } = {}) {
  const k = createKernel([TEST_COMBAT])
  o.prepare?.(k)
  const state = makeState({ actors: o.actors })
  const battle: BattleState = clone(setupBattle(k, state, setup).battle)
  return { k, state, battle, run: (dice?: number[]) => (dice ? fixDice(new BattleRun(k, state, battle), dice) : new BattleRun(k, state, battle)) }
}

const threeAllies = () => duel([one({}, 1), one({}, 2), one({}, 3)], [foe(), foe()])
const fourAllies = () => duel([one({}, 1), one({}, 2), one({}, 3), one({}, 4)], [foe(), foe()])
/** 叫來的人：一個一般的我方單位（還是 raw 的 { from: 'unit' }，走開戰時同一條路）。 */
const newcomer = (name = '增援') => raw(one({ name }, 4))
const tagged = (r: BattleRun, tag: string) => r.beats.filter((b) => b.tag === tag)
/** 一直輪下去，直到進入第 n 回合（測試用：不管輪到的是誰都往下輪）。 */
const toRound = (r: BattleRun, n: number) => {
  for (let guard = 0; guard < 200 && r.battle.round < n && !r.over; guard++) advance(r)
}
const inOrder = (b: BattleState): boolean => b.order.every((id, i) => i === 0 || initiativeOrder(b.units[b.order[i - 1]!]!, b.units[id]!) <= 0)

describe('候補：k.battle.bench 與 view.bench', () => {
  const entry = (id: string, blocks: string[] = []) => ({ id, ref: { from: 'actor', id }, name: `人 ${id}`, blocks })

  it('沒有人註冊候補時是空的', () => {
    const a = build(threeAllies())
    expect(a.run().bench('ally')).toEqual([])
    expect(a.run().bench('foe')).toEqual([])
  })

  it('註冊兩個來源：合在一起（照登記的順序）；同一個 id 只留第一筆；已經在這一場裡的人不列；叫不了的原因照樣帶著', () => {
    const calls: Array<[string, string]> = []
    const a = build(
      duel([one({ actor: 'p1' }, 1), one({ actor: 'p2' }, 2), one({}, 3)], [foe(), foe()]),
      {
        prepare: (k) => {
          k.battle.bench('roster', (_s, _b, side) => (calls.push(['roster', side]), side === 'ally' ? [entry('p1'), entry('p3'), entry('p4', ['這個人正在忙。'])] : []))
          k.battle.bench('skill', (_s, _b, side) => (calls.push(['skill', side]), side === 'ally' ? [entry('p5'), entry('p3', ['不該出現的重複。']), entry('p2')] : [entry('f9')]))
        },
      },
    )
    // p1、p2 已經上場（單位的 actor 對得上）；p3 兩個來源都有，只留第一筆（roster 那一筆）
    expect(a.run().bench('ally').map((e) => [e.id, e.blocks])).toEqual([['p3', []], ['p4', ['這個人正在忙。']], ['p5', []]])
    expect(a.run().bench('foe').map((e) => e.id)).toEqual(['f9'])
    expect(calls.slice(0, 2)).toEqual([['roster', 'ally'], ['skill', 'ally']])
  })

  it('來源拿到的是這一刻的戰鬥狀態；倒下的人、後方等著的人、叫了還沒進場的人也都算「在這一場裡」，不列', () => {
    const seen: BattleState[] = []
    const a = build(
      duel([one({ actor: 'p1' }, 1), one({ actor: 'p2' }, 2)], [foe(), foe()]),
      {
        actors: [makeActor({ id: 'p3', name: '後援', role: 'npc' })],
        prepare: (k) => k.battle.bench('roster', (_s, b, side) => (seen.push(b), side === 'ally' ? [entry('p1'), entry('p2'), entry('p3')] : [])),
      },
    )
    const r = a.run()
    r.setOut(a.battle.units.a2!, 'down')
    expect(r.bench('ally').map((e) => e.id)).toEqual(['p3'])
    expect(seen.at(-1)).toBe(a.battle)
    // 叫來之後（他在後方、還沒進場）不再列
    expect(r.callIn('ally', { from: 'actor', id: 'p3' })).not.toBeNull()
    expect(r.bench('ally')).toEqual([])
  })
})

describe('叫人：run.callIn', () => {
  it('我方三個人：叫來的當下不在場上；下一輪開頭站在第 4 格、行動點是上限、排進先攻的順序、這一輪就輪得到他', () => {
    const a = build(threeAllies())
    const r = a.run([14])
    const u = r.callIn('ally', newcomer())!
    expect(u).toMatchObject({ id: 'a4', side: 'ally', slot: 0, name: '增援', control: 'player' })
    expect(a.battle.reserve.ally).toEqual(['a4'])
    expect(a.battle.called).toEqual(['a4'])
    expect(a.battle.order).not.toContain('a4')
    // 這一輪：補位（settle）不理他
    r.settle()
    expect(u.slot).toBe(0)
    expect(a.battle.order).not.toContain('a4')
    // 記一拍 call_in
    expect(tagged(r, 'call_in').map((b) => b.data)).toEqual([{ unit: 'a4', side: 'ally' }])
    expect(tagged(r, 'reinforce')).toEqual([])

    toRound(r, 2)
    expect(a.battle.round).toBe(2)
    expect(u.slot).toBe(4)
    expect(u.ap.now).toBe(u.ap.max)
    expect(u.initiative).toBe(14 + u.initBonus)
    expect(a.battle.order).toContain('a4')
    expect(inOrder(a.battle)).toBe(true)
    expect(a.battle.reserve.ally).toEqual([])
    expect(a.battle.called).toBeUndefined()
    expect(battleProblems(a.battle)).toEqual([])
    // 進場的那一拍（reinforce，data.called）在叫人那一拍之後、第 2 回合的標題之後
    const tags = r.beats.map((b) => b.tag)
    expect(tags.indexOf('call_in')).toBeLessThan(tags.lastIndexOf('round'))
    expect(tags.indexOf('reinforce')).toBeGreaterThan(tags.lastIndexOf('round'))
    expect(tagged(r, 'reinforce').map((b) => b.data)).toEqual([{ unit: 'a4', side: 'ally', slot: 4, called: true }])
    // 這一輪他輪得到（第 2 回合每個人都輪過一次之後，輪到的拍子裡有他）
    toRound(r, 3)
    expect(r.beats.some((b) => b.tag === 'turn' && (b.data as { unit: string; round: number }).unit === 'a4' && (b.data as { round: number }).round === 2)).toBe(true)
  })

  it('進場在 round.start 之前：掛在 round.start 上的功能看到他已經在場上', () => {
    let seenSlot = -1
    const a = build(threeAllies(), { prepare: (k) => k.battle.on('round.start', 'probe', ({ run }) => { if (run.battle.round === 2) seenSlot = run.battle.units.a4?.slot ?? -1 }) })
    const r = a.run([10])
    r.callIn('ally', newcomer())
    toRound(r, 2)
    expect(seenSlot).toBe(4)
  })

  it('先攻最高的話，他排在最前面、第 2 回合第一個動（指標不讓位）', () => {
    const a = build(threeAllies())
    for (const u of Object.values(a.battle.units)) u.initiative = 0
    const r = a.run([20])
    r.callIn('ally', newcomer())
    toRound(r, 2)
    expect(a.battle.order[0]).toBe('a4')
    expect(currentUnit(a.battle)!.id).toBe('a4')
    expect(r.beats.filter((b) => b.tag === 'turn').at(-1)!.data).toEqual({ unit: 'a4', round: 2 })
  })

  it('先攻最低的話，排在最後面；一樣第 2 回合輪得到', () => {
    const a = build(threeAllies())
    for (const u of Object.values(a.battle.units)) u.initiative = 30
    const r = a.run([1])
    r.callIn('ally', newcomer())
    toRound(r, 2)
    expect(a.battle.order.at(-1)).toBe('a4')
    toRound(r, 3)
    expect(r.beats.some((b) => b.tag === 'turn' && (b.data as { unit: string }).unit === 'a4')).toBe(true)
  })

  it('四格都有人：回傳 null，戰鬥狀態與紀錄都沒有動；叫了一個之後空格已經有主，再叫也是 null', () => {
    const full = build(fourAllies())
    const before = clone(full.battle)
    const r = full.run()
    expect(r.callIn('ally', newcomer())).toBeNull()
    expect(full.battle).toEqual(before)
    expect(r.beats).toEqual([])
    // 敵方也一樣：兩個人，叫兩個之後第三個還叫得進、再叫第四個進不去
    const three = build(threeAllies())
    const r2 = three.run()
    expect(r2.callIn('ally', newcomer('甲'))).not.toBeNull()
    const mid = clone(three.battle)
    expect(r2.callIn('ally', newcomer('乙'))).toBeNull()
    expect(three.battle).toEqual(mid)
  })

  it('來源查不到丟錯，狀態不變；沒有空格時不解，直接回傳 null', () => {
    const a = build(threeAllies())
    const before = clone(a.battle)
    expect(() => a.run().callIn('ally', { from: 'ghost' })).toThrow(/沒有 ghost 這種單位的來源/)
    expect(() => a.run().callIn('ally', { from: 'actor' })).toThrow(/actor 要寫 id/)
    expect(() => a.run().callIn('ally', { from: 'actor', id: 'nobody' })).toThrow(/沒有 nobody 這個角色/)
    expect(a.battle).toEqual(before)
    const full = build(fourAllies())
    expect(full.run().callIn('ally', { from: 'ghost' })).toBeNull()
  })

  it('照開戰時同一條路解：角色的來源讀角色的數字；人從哪一邊叫就站哪一邊；敵方也叫得動（AI 操縱）', () => {
    const a = build(threeAllies(), { actors: [makeActor({ id: 'p9', name: '候補甲', role: 'npc', attrs: { reflex: 14 } })] })
    const r = a.run([5])
    const u = r.callIn('ally', { from: 'actor', id: 'p9' }, { by: a.battle.units.a1! })!
    expect(u).toMatchObject({ id: 'a4', name: '候補甲', actor: 'p9', control: 'player', slot: 0 })
    expect(u.initBonus).toBe(2)
    expect(u.ap.now).toBe(u.ap.max)
    const f = r.callIn('foe', { from: 'unit', unit: foe('minion', { name: '援軍' }) })!
    expect(f).toMatchObject({ id: 'f3', side: 'foe', control: 'ai', slot: 0 })
    expect(a.battle.called).toEqual(['a4', 'f3'])
    expect(a.battle.reserve).toEqual({ ally: ['a4'], foe: ['f3'] })
    // 叫的人記在那一拍上（拍子的 actor 是叫的人的角色）
    expect(tagged(r, 'call_in').map((b) => (b.data as { by?: string }).by)).toEqual(['a1', undefined])
  })

  it('叫來的那一刻發一次 unit.ready，功能可以把自己的資料掛上去（先攻的修正讀得到）；那一邊記的拍子不進紀錄', () => {
    const a = build(threeAllies(), {
      prepare: (k) => {
        k.battle.on('unit.ready', 'probe', ({ run, unit }) => {
          if (unit.name === '增援') {
            unit.ext.probe = { ready: true }
            unit.initBonus += 5
            run.say('不該進紀錄。')
          }
        })
      },
    })
    const r = a.run([10])
    const u = r.callIn('ally', newcomer())!
    expect(u.ext.probe).toEqual({ ready: true })
    expect(r.beats.map((b) => b.text)).toEqual(['增援 被叫來支援，下一輪開頭進場。'])
    toRound(r, 2)
    expect(u.initiative).toBe(10 + 2 + 5)
  })

  it('叫了之後、進場之前有人倒下又被救回來把空格佔掉：他留在後方，之後有人倒下時照補位進場', () => {
    const a = build(fourAllies())
    const r = a.run([9])
    // 一個人倒下，空出一格
    expect(r.setOut(a.battle.units.a4!, 'down')).toBe(true)
    r.settle()
    const x = r.callIn('ally', newcomer())!
    expect(a.battle.called).toEqual([x.id])
    // 倒下的人在進場之前被救回來，佔了那一格
    expect(r.revive(a.battle.units.a4!, 5)).toBe(true)
    expect(a.battle.units.a4!.slot).toBe(4)
    toRound(r, 2)
    // 空格被佔了：他留在後方、不再算「叫來的」，沒有進先攻的順序
    expect(x.slot).toBe(0)
    expect(a.battle.reserve.ally).toEqual([x.id])
    expect(a.battle.called).toBeUndefined()
    expect(a.battle.order).not.toContain(x.id)
    expect(tagged(r, 'reinforce')).toEqual([])
    expect(battleProblems(a.battle)).toEqual([])
    // 之後有人倒下：照平常的補位進場（先攻當場擲）
    expect(r.setOut(a.battle.units.a1!, 'down')).toBe(true)
    r.settle()
    expect(x.slot).toBeGreaterThanOrEqual(1)
    expect(a.battle.reserve.ally).toEqual([])
    expect(a.battle.order).toContain(x.id)
    expect(x.initiative).toBe(9 + x.initBonus)
    expect(tagged(r, 'reinforce').map((b) => (b.data as { unit: string }).unit)).toEqual([x.id])
  })

  it('叫來的人在後方最前面時，平常的補位跳過他，補排在他後面的人', () => {
    // 兩個人倒下、還沒收尾（settle）：原本在後方的 a5 還在等；這時叫 X，X 排在 a5 前面
    const a = build(duel([one({}, 1), one({}, 2), one({}, 3), one({}, 4), one({ name: '原本在後方' }, 1)], [foe(), foe()]))
    const r = a.run([8, 8])
    r.setOut(a.battle.units.a3!, 'down')
    r.setOut(a.battle.units.a4!, 'down')
    const x = r.callIn('ally', newcomer())!
    expect(x.id).toBe('a6')
    expect(a.battle.reserve.ally).toEqual(['a6', 'a5'])
    r.settle()
    expect(a.battle.units.a5!.slot).toBeGreaterThanOrEqual(1)
    expect(x.slot).toBe(0)
    expect(a.battle.reserve.ally).toEqual(['a6'])
    expect(a.battle.called).toEqual(['a6'])
    toRound(r, 2)
    expect(x.slot).toBeGreaterThanOrEqual(1)
    expect(a.battle.reserve.ally).toEqual([])
  })

  it('平常的補位不理叫來的人：後方別的人照常補上來，他等下一輪開頭（沒有空格就留在後方）', () => {
    // 五個人：a5 一開始在後方。a4 倒下 → a5 補上來；a5 又倒下；叫 X（後方 [X]）；a4、a5 先後被救回來，a5 沒有空格，排在 X 前面
    const a = build(duel([one({}, 1), one({}, 2), one({}, 3), one({}, 4), one({ name: '原本在後方' }, 1)], [foe(), foe()]))
    const r = a.run([8, 8, 8])
    r.setOut(a.battle.units.a4!, 'down')
    r.settle()
    expect(a.battle.units.a5!.slot).toBe(4)
    r.setOut(a.battle.units.a5!, 'down')
    r.settle()
    const x = r.callIn('ally', newcomer())!
    expect(a.battle.reserve.ally).toEqual([x.id])
    r.revive(a.battle.units.a4!, 5)
    r.revive(a.battle.units.a5!, 5)
    expect(a.battle.reserve.ally).toEqual(['a5', x.id])
    // 現在有人倒下、空出一格：先補上來的是 a5，不是他（他是叫來的，等下一輪開頭）
    r.setOut(a.battle.units.a1!, 'down')
    r.settle()
    expect(a.battle.units.a5!.slot).toBeGreaterThanOrEqual(1)
    expect(x.slot).toBe(0)
    expect(a.battle.reserve.ally).toEqual([x.id])
    expect(a.battle.called).toEqual([x.id])
    // 下一輪開頭：四格又滿了，他留在後方，不再算「叫來的」
    toRound(r, 2)
    expect(x.slot).toBe(0)
    expect(a.battle.called).toBeUndefined()
    expect(a.battle.reserve.ally).toEqual([x.id])
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('叫來的人在後方就被帶走：不再等著進場', () => {
    const a = build(threeAllies())
    const r = a.run()
    const x = r.callIn('ally', newcomer())!
    expect(r.setOut(x, 'removed')).toBe(true)
    expect(a.battle.called).toBeUndefined()
    expect(a.battle.reserve.ally).toEqual([])
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('call_in 是戰鬥事件清單裡的一個', () => {
    expect(BATTLE_EVENTS).toContain('call_in')
  })

  it('核心不改現有的補位：沒有叫人的戰鬥，後方的人照舊補位、先攻當場擲、沒有 called 欄位', () => {
    const a = build(duel([one({}, 1), one({}, 2), one({}, 3), one({}, 4), one({ name: '後方' }, 1)], [foe(), foe()]))
    expect(a.battle.called).toBeUndefined()
    const r = a.run([12])
    r.setOut(a.battle.units.a2!, 'down')
    r.settle()
    expect(a.battle.units.a5).toMatchObject({ slot: 4 })
    expect(a.battle.units.a5!.initiative).toBe(12 + a.battle.units.a5!.initBonus)
    expect('called' in a.battle).toBe(false)
  })
})

describe('先攻的優勢：BattleSetup.edge', () => {
  /** 開戰時的骰子：照給的順序出（setupBattle 自己組 BattleRun，所以從原型上釘）。 */
  function pinned(dice: number[]) {
    const queue = [...dice]
    vi.spyOn(BattleRun.prototype, 'roll').mockImplementation((count: number) => {
      if (queue.length < count) throw new Error('骰面用完了')
      return queue.splice(0, count)
    })
    return queue
  }
  const start = (edge?: 'ally' | 'foe') => {
    const k = createKernel([TEST_COMBAT])
    return setupBattle(k, makeState(), { ...duel([one({}, 1), one({}, 2)], [foe(), foe()]), ...(edge ? { edge } : {}) })
  }

  it('沒寫就是現在的行為：每個人擲一次，紀錄裡沒有多的拍子', () => {
    const queue = pinned([10, 12, 3, 17])
    const r = start()
    expect(queue).toEqual([])
    expect(Object.values(r.battle.units).map((u) => [u.id, u.initiative])).toEqual([['a1', 12], ['a2', 14], ['f1', 3], ['f2', 17]])
    expect(r.beats.filter((b) => (b.data as { edge?: string } | undefined)?.edge)).toEqual([])
  })

  it("edge: 'foe'：敵方每個人擲兩次取高，我方不變；兩顆骰都記在紀錄裡", () => {
    const queue = pinned([10, 12, 3, 17, 19, 5])
    const r = start('foe')
    expect(queue).toEqual([])
    const init = Object.fromEntries(Object.values(r.battle.units).map((u) => [u.id, u.initiative]))
    // 我方 10、12 加反應 2（和沒有 edge 時一樣）；敵方是 (3,17) 取 17、(19,5) 取 19，加反應 0
    expect(init).toEqual({ a1: 12, a2: 14, f1: 17, f2: 19 })
    expect(r.battle.order).toEqual(['f2', 'f1', 'a2', 'a1'])
    const edge = r.beats.filter((b) => (b.data as { edge?: string } | undefined)?.edge)
    expect(edge.map((b) => b.data)).toEqual([
      { unit: 'f1', edge: 'foe', dice: [3, 17], initiative: 17 },
      { unit: 'f2', edge: 'foe', dice: [19, 5], initiative: 19 },
    ])
    expect(edge[0]!.text).toMatch(/3、17.*取 17/)
    // 在「戰鬥開始」那一拍之後
    expect(r.beats.findIndex((b) => b.tag === 'battle.start')).toBeLessThan(r.beats.indexOf(edge[0]!))
  })

  it("edge: 'ally'：換成我方每個人擲兩次取高，敵方擲一次", () => {
    pinned([4, 15, 20, 2, 11, 6])
    const r = start('ally')
    expect(Object.fromEntries(Object.values(r.battle.units).map((u) => [u.id, u.initiative]))).toEqual({ a1: 17, a2: 22, f1: 11, f2: 6 })
  })

  it('edge 只管開戰時上場的人：之後補位進場的照一般擲一次', () => {
    pinned([10, 12, 3, 17, 19, 5, 1, 2, 3, 4])
    const k = createKernel([TEST_COMBAT])
    const r = setupBattle(k, makeState(), { ...duel([one({}, 1), one({}, 2)], [foe(), foe(), foe(), foe(), foe()]), edge: 'foe' as const })
    // 第五個敵人在後方等著：沒有擲先攻
    expect(r.battle.units.f5).toMatchObject({ slot: 0, initiative: 0 })
  })

  it('edge 不是 ally 或 foe 就丟錯', () => {
    expect(() => setupBattle(createKernel([TEST_COMBAT]), makeState(), { ...duel([one()], [foe()]), edge: 'both' as never })).toThrow(/edge 只能是 ally 或 foe/)
  })
})

describe('battleOptions 的 distances', () => {
  const overlay = (id: string, side: 'ally' | 'foe', slot: number, down = false) => ({
    id, side, slot, kind: 'attack', name: `機 ${id}`, hp: { now: 3, max: 3 }, armor: 0, evade: 12, used: false, down,
  })
  /** 輪到我方第 2 格的人；敵方站 1、2、3 格，第 3 格的敵人倒下。 */
  const arenaGame = () => {
    const t = makeBattleGame({ battle: duel([one({}, 1), one({}, 2)], [foe(), foe(), foe(), foe()]) })
    const b = t.game.state.battle!
    b.units.f3!.out = 'down'
    b.units.f3!.slot = 0
    b.overlays.push(overlay('o1', 'foe', 4), overlay('o2', 'foe', 2, true), overlay('o3', 'ally', 1))
    b.turn = b.order.indexOf('a2')
    return { game: t.game, b }
  }

  it('輪到的人到場上每個敵人、每一台沒被擊落的敵方掛著的東西的距離，每一個都和核心的 distance 一樣', () => {
    const { game, b } = arenaGame()
    const o = game.battleOptions()!
    expect(o.waiting).toBe('player')
    const me = b.units.a2!
    // 場上的敵人：f1、f2、f4（f3 倒下了不列）；掛著的：o1（o2 被擊落、o3 是我方的不列）
    expect(Object.keys(o.distances).sort()).toEqual(['f1', 'f2', 'f4', 'o1'])
    for (const id of ['f1', 'f2', 'f4']) expect(o.distances[id], id).toBe(distance(me, b.units[id]!))
    expect(o.distances.o1).toBe(distance(me, { slot: 4 }))
    expect(o.distances).toEqual({ f1: 2, f2: 3, f4: 5, o1: 5 })
    // 現在的核心距離（我的格 ＋ 他的格 − 1）也是 shoot 之類的行動拿來提示的那一個
    const attack = o.actions.find((a) => a.id === 'test.attack')!
    for (const t of attack.targets) if ('unit' in t.target) expect(o.distances[t.target.unit]).toBe(distance(me, b.units[t.target.unit]!))
  })

  it('換人輪到之後跟著換；敵方輪到時也帶（actions 照舊是空的）；分出結果之後是空的', () => {
    const { game, b } = arenaGame()
    b.turn = b.order.indexOf('a1')
    expect(game.battleOptions()!.distances).toEqual({ f1: 1, f2: 2, f4: 4, o1: 4 })
    const f = b.units.f1!
    b.turn = b.order.indexOf('f1')
    const ai = game.battleOptions()!
    expect(ai).toMatchObject({ waiting: 'ai', actions: [] })
    expect(ai.distances).toEqual({ a1: distance(f, b.units.a1!), a2: distance(f, b.units.a2!), o3: distance(f, { slot: 1 }) })
    b.result = { outcome: 'win', text: '' }
    expect(game.battleOptions()).toMatchObject({ waiting: 'over', current: null, distances: {} })
  })

  it('沒有在打：battleOptions 還是 null', () => {
    const { game } = makeBattleGame()
    game.state.battle = null
    expect(game.battleOptions()).toBeNull()
  })
})

describe('叫了還沒進場的人：存檔與接著打', () => {
  /** 一個測試用的行動：叫一個我方的增援。 */
  const CALLER: Feature = {
    id: 'test_caller',
    install(k) {
      k.battle.action({
        id: 'test.call', owner: 'test_caller', name: '叫增援', desc: '叫一個人來增援。', group: 'tactic', icon: 'call', target: 'none', order: 5,
        cost: () => ({ ap: 1 }),
        run: (run, u) => {
          run.callIn('ally', raw(one({ name: '增援' }, 4)), { by: u })
        },
      })
    },
  }
  const start = () => {
    const t = makeBattleGame({ features: [TEST_COMBAT, CALLER], seed: 5, battle: duel([one({}, 1), one({}, 2), one({}, 3)], [foe(), foe(), foe()], { ally: [1, 1, 1, 0], foe: [1, 1, 1, 0] }) })
    const g = t.game
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = b.units.a1!.ap.max
    return g
  }

  it('叫人是一步行動：叫完之後他在後方等著，戰鬥狀態合格（battleProblems 不把他當壞資料）', () => {
    const g = start()
    expect(g.battleAct({ action: 'test.call' }).status).toBe('applied')
    const b = g.state.battle!
    expect(b.called).toEqual(['a4'])
    expect(b.units.a4).toMatchObject({ slot: 0, name: '增援' })
    expect(b.reserve.ally).toEqual(['a4'])
    expect(battleProblems(b)).toEqual([])
    // 提交也守這一條：改壞 called 的那一份報告整步不成立
    const bad = clone(b)
    bad.called = ['a4', 'a4']
    expect(battleProblems(bad)).toEqual(['called：a4 重複了'])
    bad.called = ['zz']
    expect(battleProblems(bad)[0]).toMatch(/called：zz 不是這場戰鬥的單位/)
    bad.called = ['a1']
    expect(battleProblems(bad)[0]).toMatch(/called：a1 要在後方排隊/)
    bad.called = 'a4' as never
    expect(battleProblems(bad)).toEqual(['called 要是單位 id 的陣列'])
  })

  it('存了再讀，接著打的結果和沒有中斷的一樣；他在下一輪開頭進場', () => {
    const g = start()
    expect(g.battleAct({ action: 'test.call' }).status).toBe('applied')
    const raw = g.save('manual', '')
    const saved = stateHash(g.state)
    // 沒有中斷：一路打到第 2 回合，記下他進場那一刻的樣子；再打到結束
    let enteredAt = ''
    for (let i = 0; i < 400 && g.battle && !g.battle.result; i++) {
      expect(g.battleNext({ anyone: true }).status).toBe('applied')
      if (!enteredAt && g.battle && g.battle.units.a4!.slot >= 1) enteredAt = `${g.battle.round}:${g.battle.units.a4!.slot}`
    }
    expect(enteredAt).toMatch(/^2:/)
    const straight = stateHash(g.state)
    const outcome = g.battle?.result?.outcome

    // 讀回存檔：他還在等著，狀態和存的時候一模一樣
    expect(g.load(raw)).toBeNull()
    expect(stateHash(g.state)).toBe(saved)
    expect(g.state.battle!.called).toEqual(['a4'])
    expect(battleProblems(g.state.battle)).toEqual([])
    let enteredAgain = ''
    for (let i = 0; i < 400 && g.battle && !g.battle.result; i++) {
      expect(g.battleNext({ anyone: true }).status).toBe('applied')
      if (!enteredAgain && g.battle && g.battle.units.a4!.slot >= 1) enteredAgain = `${g.battle.round}:${g.battle.units.a4!.slot}`
    }
    expect(enteredAgain).toBe(enteredAt)
    expect(g.battle?.result?.outcome).toBe(outcome)
    expect(stateHash(g.state)).toBe(straight)
  })

  it('打完整場、結算之後沒有東西留下來（called 跟著戰鬥狀態一起收掉）', async () => {
    const g = start()
    expect(g.battleAct({ action: 'test.call' }).status).toBe('applied')
    playOut(g)
    await g.finishBattle()
    expect(g.state.battle).toBeNull()
  })
})
