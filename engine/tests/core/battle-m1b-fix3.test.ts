// 驗收測試：dev/work/M1b-core-fix3.md 的核心部分。
//   一、action.done 的標籤帶行動自己的 costTags　二、對自己給的 own_turn_end 從下一個自己的回合算起
//   三、公式的「上限的一半」　四、遮蔽等級的修正 cover_level（堡壘姿態）　五、who: foe_overlay（敵方的一台）
// 規格：dev/adr/0015（補記：M1b-core-fix3）。效果、掛點、修正與規則表的狀態都是測試裡臨時註冊、自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { BattleActionDef, BattleEffectInput, BattleHookMap, BattleOverlay, BattleUnit, Feature, Kernel } from '../../src'
import { advance, amount, amountProblems, battleProblems, beginTurn, performAction, positionScore, targetWeight } from '../../src'
import { TEST_COMBAT, makeBattleGame } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one } from '../helpers/battle'

const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'shield', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
const SOURCE = { kind: 'ability', id: 'x', name: 'X' } as const
const withStatuses = (k: Kernel): void => k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES } })

// ---- 一、action.done 的標籤帶行動自己的 costTags ----

describe('performAction：action.done 的標籤帶行動自己的 costTags（dev/adr/0015 第二節）', () => {
  /** 一個有 costTags 的行動：標籤看那一刻快取格裡有沒有東西；做的時候把東西用掉（所以標籤一定要在做之前問） */
  const MED: Feature = {
    id: 'med_demo',
    install(k) {
      k.battle.action({
        id: 'demo.med', owner: 'med_demo', name: '急救', desc: '用一件醫療道具。', group: 'supply', icon: 'item', target: 'none', order: 9,
        cost: () => ({ ap: 1 }),
        costTags: (_v, u) => [u.ext.kit ? 'item:medical' : 'item:empty'],
        run: (_run, u) => { u.ext.kit = false },
      })
    },
  }
  const spy = () => {
    const done: Array<BattleHookMap['action.done']> = []
    const asked: string[][] = []
    const feature: Feature = {
      id: 'spy',
      install(k) {
        k.battle.on('action.done', 'spy', (p) => { done.push(p) })
        k.battle.modifier('spy', (q) => { if (q.kind === 'action_ap' && q.tags[0] === 'demo.med') asked.push(q.tags); return [] })
      },
    }
    return { done, asked, feature }
  }

  it('action.done 的 tags 帶 costTags，和問 action_ap 時帶的是同一串（花費的減免與「用掉幾次」認得同一件東西）', () => {
    const s = spy()
    const g = makeBattleGame({ features: [TEST_COMBAT, MED, s.feature], battle: duel([one({ weapon: 'pistol', ext: { kit: true } })], [foe()]) }).game
    const b = g.state.battle!
    b.turn = b.order.indexOf('a1')
    b.units.a1!.ap.now = b.units.a1!.ap.max
    b.units.a1!.control = 'player'
    s.asked.length = 0
    expect(g.battleAct({ action: 'demo.med' }).status).toBe('applied')
    expect(s.done).toHaveLength(1)
    expect(s.done[0]!.tags).toEqual(['demo.med', 'group:supply', 'item:medical'])
    // 問花費時（扣費之前）的標籤就是這一串
    expect(s.asked.at(-1)).toEqual(s.done[0]!.tags)
  })

  it('標籤在行動做之前問好：行動把東西用掉之後，costTags 會變，action.done 的標籤還是做之前的', () => {
    const s = spy()
    const a = arena(duel([one({ weapon: 'pistol', ext: { kit: true } })], [foe()]), [TEST_COMBAT, MED, s.feature])
    const def = a.k.battle.getAction('demo.med') as BattleActionDef
    performAction(a.run(), a.ally(1), def, null, { action: 'demo.med' })
    expect(a.ally(1).ext.kit).toBe(false)
    expect(def.costTags!(a.run(), a.ally(1))).toEqual(['item:empty'])
    expect(s.done[0]!.tags).toContain('item:medical')
    expect(s.done[0]!.tags).not.toContain('item:empty')
  })
})

// ---- 二、對自己給的 own_turn_end 從下一個自己的回合算起 ----

describe('對自己給的 until: own_turn_end：這個回合的結束不算（dev/adr/0015 補記，M1b-core-fix3）', () => {
  /** 一對一的場地：先攻的順序固定 a1、f1。prepare 可以先在 kernel 上掛東西。 */
  const duelArena = (prepare: (k: Kernel) => void = () => {}): Arena => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('elite')]), [TEST_COMBAT], (k) => { withStatuses(k); prepare(k) })
    a.battle.order = ['a1', 'f1']
    return a
  }
  /** 讓某個人的回合正在進行（照 beginTurn 走一遍，battle.acting 設好）。 */
  const inTurn = (a: Arena, id: string) => {
    const run = a.run()
    delete a.battle.acting
    a.battle.turn = a.battle.order.indexOf(id)
    beginTurn(run, a.battle.units[id]!)
    return run
  }
  const status = (a: Arena, id = 'suppressed', who = 'a1') => a.battle.units[who]!.statuses.find((s) => s.id === id)

  it('他在自己的回合裡給自己：這個回合的結束不算，下一個自己的回合結束才拿掉（turns: 1 就是「到下一回合結束」）', () => {
    const a = duelArena()
    const run = inTurn(a, 'a1')
    expect(a.battle.acting).toBe('a1')
    expect(run.skipsOwnTurnEnd(a.ally(1), a.ally(1))).toBe(true)
    run.applyStatus(a.ally(1), 'suppressed', { by: a.ally(1) })
    expect(status(a)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1, skip: true })
    advance(run) // a1 的回合結束，輪到 f1：這一次不算
    expect(a.battle.acting).toBe('f1')
    expect(status(a)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
    advance(run) // f1 的回合結束，第 2 輪，輪到 a1
    expect(a.battle.round).toBe(2)
    expect(status(a)).toBeDefined()
    advance(run) // a1 下一個回合結束：到期
    expect(status(a)).toBeUndefined()
  })

  it('turns: 2 就是下一個與再下一個回合結束', () => {
    const a = duelArena()
    const run = inTurn(a, 'a1')
    run.applyStatus(a.ally(1), 'suppressed', { by: a.ally(1), turns: 2 })
    for (let i = 0; i < 3; i++) advance(run) // a1、f1、a1 的結束：只數了 a1 的第二次（第一次是這個回合，略過）
    expect(status(a)!.until).toMatchObject({ turns: 1 })
    advance(run)
    advance(run)
    expect(status(a)).toBeUndefined()
  })

  it('不算的情形照舊：別人給的（沒有 by 的也算別人）、不在他的回合裡給自己、source_turn_end、own_turn_start', () => {
    const a = duelArena()
    const run = inTurn(a, 'a1')
    // 別人給的：這個回合結束就數
    run.applyStatus(a.ally(1), 'suppressed', { by: a.foe(1) })
    expect(status(a)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
    run.applyStatus(a.ally(1), 'jammed')
    expect(status(a, 'jammed')!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
    // source_turn_end（含目前這個回合）：給自己也不略過
    run.applyStatus(a.ally(1), 'bleeding', { until: 'source_turn_end', by: a.ally(1) })
    expect(status(a, 'bleeding')!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
    // own_turn_start 沒有略過的記號
    run.applyStatus(a.ally(1), 'burning', { by: a.ally(1) })
    expect(status(a, 'burning')!.until).toEqual({ at: 'turn_start', of: 'a1', turns: 2 })
    advance(run)
    expect(status(a)).toBeUndefined()
    expect(status(a, 'jammed')).toBeUndefined()
    expect(status(a, 'bleeding')).toBeUndefined()
  })

  it('不在自己的回合裡給自己（敵人的回合裡反應給的）：照舊，到他自己的下一個回合結束', () => {
    const a = duelArena()
    const run = inTurn(a, 'f1')
    expect(run.skipsOwnTurnEnd(a.ally(1), a.ally(1))).toBe(false)
    run.applyStatus(a.ally(1), 'suppressed', { by: a.ally(1) })
    expect(status(a)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
    advance(run) // f1 的結束：不是 a1 的
    expect(status(a)).toBeDefined()
    advance(run) // a1 的結束
    expect(status(a)).toBeUndefined()
  })

  it('敵人給自己也一樣（AI 的單位用同一個規則）', () => {
    const a = duelArena()
    const run = inTurn(a, 'f1')
    run.applyStatus(a.foe(1), 'suppressed', { by: a.foe(1) })
    expect(status(a, 'suppressed', 'f1')!.until).toMatchObject({ of: 'f1', skip: true })
    advance(run) // f1 結束：略過
    expect(status(a, 'suppressed', 'f1')).toBeDefined()
    advance(run) // a1
    advance(run) // f1 下一個結束
    expect(status(a, 'suppressed', 'f1')).toBeUndefined()
  })

  it('回合開始的掛點（turn.start）與回合結束的掛點（turn.end）裡給自己的也算在回合裡；一輪開頭、開戰的掛點裡不算', () => {
    const seen: string[] = []
    const a = duelArena((k) => {
      k.battle.on('turn.start', 't', ({ run, unit }) => { if (unit.id === 'a1') run.applyStatus(unit, 'suppressed', { by: unit }) })
      k.battle.on('round.start', 't', ({ run, round }) => { seen.push(`round ${round} acting=${String(run.battle.acting)}`); if (round === 2) run.applyStatus(run.unit('a1'), 'jammed', { by: run.unit('a1') }) })
    })
    const run = inTurn(a, 'a1')
    expect(status(a)!.until).toMatchObject({ skip: true })
    advance(run)
    advance(run) // f1 結束 → 第 2 輪開頭（round.start：沒有人的回合在進行）→ a1 的回合
    expect(seen).toEqual(['round 1 acting=undefined', 'round 2 acting=undefined'])
    expect(status(a, 'jammed')!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
    // turn.end 裡給自己的：同一次結算就把這一次略過了，所以回合結束之後還在
    const b = duelArena((k) => k.battle.on('turn.end', 't', ({ run: r, unit }) => { if (unit.id === 'a1') r.applyStatus(unit, 'suppressed', { by: unit }) }))
    const run2 = inTurn(b, 'a1')
    advance(run2)
    expect(status(b)).toBeDefined()
    expect(status(b)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 1 })
  })

  it('同一個狀態在自己的回合裡再給一次：重算時間，一樣略過這個回合', () => {
    const a = duelArena()
    const run = inTurn(a, 'a1')
    run.applyStatus(a.ally(1), 'suppressed', { by: a.ally(1) })
    run.applyStatus(a.ally(1), 'suppressed', { by: a.ally(1), turns: 2 })
    expect(a.ally(1).statuses.filter((s) => s.id === 'suppressed')).toHaveLength(1)
    expect(status(a)!.until).toEqual({ at: 'turn_end', of: 'a1', turns: 2, skip: true })
  })

  it('acting 只在回合進行中：失去回合跳過的人不算；回合結束的結算之後拿掉；戰鬥狀態的檢查照過', () => {
    const a = duelArena()
    a.battle.order = ['a1', 'f1']
    const run = inTurn(a, 'a1')
    expect(battleProblems(a.battle)).toEqual([])
    advance(run)
    advance(run)
    advance(run)
    // 失去回合：beginTurn 回傳 false，acting 不設（輪到的人被跳過，直接往下輪）
    const b = duelArena()
    b.ally(1).statuses.push({ id: 'lose_turn', until: { at: 'turn_start', of: 'a1', turns: 1 } })
    b.battle.turn = 1
    delete b.battle.acting
    const rb = b.run()
    advance(rb) // f1 結束 → 第 2 輪、a1 失去回合 → f1 的回合
    expect(b.battle.acting).toBe('f1')
  })

  it('acting 和輪到的人對不上（有人直接改了 battle.turn）時不略過，不會把別人的狀態算錯', () => {
    const a = duelArena()
    const run = inTurn(a, 'a1')
    a.battle.turn = a.battle.order.indexOf('f1')
    expect(run.skipsOwnTurnEnd(a.ally(1), a.ally(1))).toBe(false)
    a.battle.turn = a.battle.order.indexOf('a1')
    expect(run.skipsOwnTurnEnd(a.ally(1), a.ally(1))).toBe(true)
    expect(run.skipsOwnTurnEnd(a.ally(1), undefined)).toBe(false)
    expect(run.skipsOwnTurnEnd(a.foe(1), a.foe(1))).toBe(false)
  })

  it('整場流程（Game 的 battleAct）：自己用的行動給自己的 own_turn_end，下一個自己的回合結束才到期', () => {
    const BRACE: Feature = {
      id: 'brace_demo',
      install(k) {
        k.battle.action({
          id: 'demo.brace', owner: 'brace_demo', name: '架好', desc: '給自己一個壓制。', group: 'tactic', target: 'none', order: 9,
          cost: () => ({ ap: 0 }),
          run: (run, u) => { run.applyStatus(u, 'suppressed', { by: u }) },
        })
      },
    }
    const g = makeBattleGame({ features: [TEST_COMBAT, BRACE], content: [{ id: 'p', content: { battle_status: TEST_STATUSES } }], battle: duel([one({ weapon: 'pistol' })], [foe('minion', { hp: { now: 99, max: 99 } })]), seed: 3 }).game
    const b = () => g.state.battle!
    const mine = () => b().units.a1!.statuses.find((s) => s.id === 'suppressed')
    // 真的輪到他（先攻不是他的話，讓敵人先走完）
    for (let i = 0; i < 6 && b().order[b().turn] !== 'a1'; i++) g.battleNext()
    expect(b().order[b().turn]).toBe('a1')
    expect(b().acting).toBe('a1')
    expect(g.battleAct({ action: 'demo.brace' }).status).toBe('applied')
    expect(mine()!.until).toMatchObject({ skip: true })
    expect(g.battleAct({ action: 'end_turn' }).status).toBe('applied')
    expect(mine()).toBeDefined()
    // 敵人的回合
    for (let i = 0; i < 6 && b().order[b().turn] !== 'a1' && !b().result; i++) g.battleNext()
    expect(b().order[b().turn]).toBe('a1')
    expect(mine()).toBeDefined()
    expect(g.battleAct({ action: 'end_turn' }).status).toBe('applied')
    expect(mine()).toBeUndefined()
  })
})

// ---- 三、公式：上限的一半 ----

describe('公式的 hp_max、load_max 與它們的一半（dev/adr/0015 第一節）', () => {
  const field = () => arena(duel([one({ hp: { now: 3, max: 25 }, load: { now: 0, max: 9 } }), one({ hp: { now: 40, max: 40 } }, 2)], [foe()]))
  const ctx = (a: Arena, o: { user?: BattleUnit; unit?: BattleUnit } = {}) => ({ run: a.run(), user: o.user ?? a.ally(1), ...(o.unit ? { unit: o.unit } : {}), n: {} })

  it('名字照 tier／half_tier_up／half_tier_down 的樣子：hp_max、half_hp_max_up（進位）、half_hp_max_down（捨去），感載同理', () => {
    const a = field()
    expect(amount(ctx(a), 'hp_max')).toBe(25)
    expect(amount(ctx(a), 'half_hp_max_up')).toBe(13)
    expect(amount(ctx(a), 'half_hp_max_down')).toBe(12)
    expect(amount(ctx(a), 'load_max')).toBe(9)
    expect(amount(ctx(a), 'half_load_max_up')).toBe(5)
    expect(amount(ctx(a), 'half_load_max_down')).toBe(4)
    // 可以和別的項、乘數接在一起
    expect(amount(ctx(a), 'half_hp_max_up+2')).toBe(15)
    expect(amount(ctx(a), 'half_hp_max_down*2')).toBe(24)
    expect(amount(ctx(a), 'half_hp_max_up+hp_max*-1')).toBe(-12)
  })

  it('看這一筆落在的人（ctx.unit），沒有就看做的人；沒有感載的人（沒有橋）是 0', () => {
    const a = field()
    expect(amount(ctx(a, { unit: a.ally(2) }), 'half_hp_max_up')).toBe(20)
    expect(amount(ctx(a, { user: a.ally(2) }), 'hp_max')).toBe(40)
    expect(amount(ctx(a, { user: a.ally(1), unit: a.ally(2) }), 'half_hp_max_down')).toBe(20)
    delete a.ally(2).load
    expect(amount(ctx(a, { unit: a.ally(2) }), 'load_max')).toBe(0)
    expect(amount(ctx(a, { unit: a.ally(2) }), 'half_load_max_up')).toBe(0)
  })

  it('效果裡用：落在不同的人身上各算各的（who: allies）；樹階的一半照舊', () => {
    const a = field()
    const got: Array<[string, number]> = []
    a.k.battle.effect('t.say', 't', (c, e) => { got.push([c.unit!.id, amount(c, e.amount as string)]) })
    const input: BattleEffectInput = { user: a.ally(1), source: SOURCE, n: { tier: 5 } }
    a.run().effects([{ op: 't.say', who: 'allies', amount: 'half_hp_max_up' }], input)
    expect(got).toEqual([['a1', 13], ['a2', 20]])
    expect(amount({ ...ctx(a), n: { tier: 5 } }, 'half_tier_up+half_hp_max_down')).toBe(3 + 12)
  })

  it('載入時的檢查認得新名字；骰數不收「上限」（骰那麼多顆沒有意思）；半個一定要寫進位或捨去', () => {
    for (const ok of ['hp_max', 'half_hp_max_up', 'half_hp_max_down', 'load_max', 'half_load_max_up', 'half_load_max_down', '2d6+half_hp_max_up', 'half_hp_max_up*2']) expect(amountProblems(ok), ok).toEqual([])
    for (const bad of ['hp_maxd6', 'half_hp_max', 'half_hp_max_round', 'hp_max_half', 'max_hp', 'half_hp_max_upd6']) expect(amountProblems(bad).join(), bad).toMatch(/不認得的項/)
    // 錯誤訊息的文法清單寫出新名字
    expect(amountProblems('nope').join()).toContain('half_hp_max_up')
  })
})

// ---- 四、遮蔽等級的修正 ----

describe('cover_level：站在那一格的人吃到的遮蔽多幾級（堡壘姿態：後面那一格高一級；dev/adr/0015 補記）', () => {
  /** 一對一：a2 站第 2 格；prepare 掛修正。bonus 是 { 單位 id: 加幾級 }，可以隨時改（姿態開關、換位都用它模擬）。 */
  const field = (cover: number[], bonus: Record<string, number>, watchers = false) => {
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe(), foe('minion', {})], { ally: cover, foe: [0, 0, 0, 0] }), [TEST_COMBAT], (k) => {
      k.battle.modifier('t', (q) => (q.kind === 'cover_level' && (bonus[q.unit.id] ?? 0) !== 0 ? [{ label: '堡壘姿態', value: bonus[q.unit.id]!, source: 'skill' }] : []))
    })
    if (watchers) for (const f of Object.values(a.battle.units).filter((u) => u.side === 'foe')) f.watch = { action: 'test.attack' }
    return a
  }

  it('run.coverOf：那一格本身的遮蔽加上修正，夾在 0～2；修正沒了就回到那一格本身的', () => {
    const bonus: Record<string, number> = { a2: 1 }
    const a = field([0, 0, 1, 2], bonus)
    const run = a.run()
    expect(run.coverOf(a.ally(2))).toBe(1) // 暴露 + 1
    a.battle.cover.ally[1]!.level = 1
    expect(run.coverOf(a.ally(2))).toBe(2) // 半掩體 + 1
    a.battle.cover.ally[1]!.level = 2
    expect(run.coverOf(a.ally(2))).toBe(2) // 最高到掩體
    bonus.a2 = -1
    a.battle.cover.ally[1]!.level = 1
    expect(run.coverOf(a.ally(2))).toBe(0) // 負的是少
    a.battle.cover.ally[1]!.level = 0
    expect(run.coverOf(a.ally(2))).toBe(0) // 最低暴露
    bonus.a2 = 0
    a.battle.cover.ally[1]!.level = 1
    expect(run.coverOf(a.ally(2))).toBe(1)
    // 別人不受影響
    bonus.a2 = 1
    expect(run.coverOf(a.ally(1))).toBe(0)
  })

  it('煙霧（打不破的半掩體）也加得上去；開著機體的人用不了遮蔽，修正也沒有用；退出的、還在後方的人是那一格本身的', () => {
    const a = field([0, 0, 0, 0], { a2: 1, a1: 1 })
    a.battle.cover.ally[1]!.soft = { kind: 'smoke' }
    expect(a.run().coverOf(a.ally(2))).toBe(2)
    a.ally(2).hull = { id: 'h', name: '機甲', hp: { now: 40, max: 40 }, armor: 0, backlash: 0.2 }
    expect(a.run().coverOf(a.ally(2))).toBe(0)
    a.ally(1).out = 'down'
    expect(a.run().coverOf(a.ally(1))).toBe(0)
  })

  it('迴避：算的是加過的遮蔽（半掩體 +2、掩體 +4），修正的那一筆不出現在拆開的算式裡', () => {
    const bonus: Record<string, number> = { a2: 1 }
    const a = field([0, 0, 0, 0], bonus)
    const run = a.run()
    const bare = run.evadeOf(a.ally(2)).total
    const parts = run.evadeOf(a.ally(2))
    expect(parts.cover).toBe(a.run().n.coverBonus[1])
    expect(parts.total).toBe(bare)
    expect(parts.parts.some((p) => p.source === 'cover' && p.value === run.n.coverBonus[1])).toBe(true)
    bonus.a2 = 0
    expect(run.evadeOf(a.ally(2)).total).toBe(bare - run.n.coverBonus[1]!)
    // 命中率跟著變
    bonus.a2 = 1
    const withBonus = run.hitChance(a.foe(1), a.ally(2))
    bonus.a2 = 0
    expect(run.hitChance(a.foe(1), a.ally(2))).toBeGreaterThan(withBonus)
  })

  it('暴露：加過的遮蔽不是 0 就不算暴露，監視不會被他觸發；修正沒了又暴露', () => {
    const bonus: Record<string, number> = { a2: 1 }
    const a = field([0, 0, 0, 0], bonus, true)
    const run = a.run()
    expect(run.isExposed(a.ally(2))).toBe(false)
    expect(run.isExposed(a.ally(1))).toBe(true)
    run.exposed(a.ally(2))
    run.flushWatch()
    expect(run.beats.some((b) => b.tag === 'watch.fire')).toBe(false)
    bonus.a2 = 0
    expect(run.isExposed(a.ally(2))).toBe(true)
    run.exposed(a.ally(2))
    run.flushWatch()
    expect(run.beats.some((b) => b.tag === 'watch.fire')).toBe(true)
    // 退出的人不在場上，不算暴露
    a.ally(1).out = 'down'
    expect(a.run().isExposed(a.ally(1))).toBe(false)
  })

  it('加上去的級數打不破：遮蔽的耐久與被打穿只看那一格自己的；那一格本身是 0 級時打它沒有東西可傷', () => {
    const bonus: Record<string, number> = { a2: 1 }
    const a = field([0, 0, 0, 0], bonus)
    const run = a.run()
    run.hurtCover('ally', 2, 99, a.foe(1))
    expect(run.beats.some((b) => b.tag === 'cover.hit')).toBe(false)
    expect(a.battle.cover.ally[1]!.level).toBe(0)
    expect(run.coverOf(a.ally(2))).toBe(1)
    // 半掩體：傷害打在半掩體自己的耐久上，打穿之後那一格是 0，有效遮蔽剩修正的 1
    const b = field([0, 1, 0, 0], bonus)
    const rb = b.run()
    expect(rb.coverOf(b.ally(2))).toBe(2)
    rb.hurtCover('ally', 2, 999, b.foe(1))
    expect(b.battle.cover.ally[1]!.level).toBe(0)
    expect(rb.coverOf(b.ally(2))).toBe(1)
  })

  it('修正的條件裡又問有效遮蔽（in_cover）不會問不完：回答那一格本身的', () => {
    const bonus: Record<string, number> = { a2: 1 }
    let inner = -1
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe()]), [TEST_COMBAT], (k) => {
      k.battle.modifier('t', (q) => {
        if (q.kind !== 'cover_level') return []
        inner = q.view.coverOf(q.unit)
        return [{ label: '堡壘姿態', value: bonus[q.unit.id] ?? 0, source: 'skill' }]
      })
    })
    expect(a.run().coverOf(a.ally(2))).toBe(1)
    expect(inner).toBe(0)
  })

  it('AI 挑目標看加過的遮蔽：站在加了遮蔽的格子上，被挑中的權重比較低（掩體 ×0.7、半掩體 ×1、暴露 ×1.3）', () => {
    const bonus: Record<string, number> = { a2: 0 }
    const a = field([0, 0, 0, 0], bonus)
    const run = a.run()
    const bare = targetWeight(run, a.foe(1), a.ally(2))
    bonus.a2 = 1
    const covered = targetWeight(run, a.foe(1), a.ally(2))
    expect(covered / bare).toBeCloseTo(1 / 1.3, 5)
    bonus.a2 = 2
    expect(targetWeight(run, a.foe(1), a.ally(2)) / bare).toBeCloseTo(0.7 / 1.3, 5)
    // 預測換位之後的位置分只看那一格本身的遮蔽（姿態給的要站到那一格才問得到）
    const before = positionScore(run, a.ally(2), 2)
    bonus.a2 = 0
    expect(positionScore(run, a.ally(2), 2)).toBe(before)
  })

  it('cover_level 是核心的修正種類：MOD_KINDS 有它；run.mods 問得到', () => {
    const a = field([0, 0, 0, 0], { a2: 1 })
    expect(a.run().mods('cover_level', a.ally(2)).map((p) => p.value)).toEqual([1])
    expect(a.run().mods('cover_level', a.ally(1))).toEqual([])
  })
})

// ---- 五、who: foe_overlay ----

describe('效果的 who：foe_overlay（敵方的一台）與 pick:<鍵> 指到掛著的東西', () => {
  const field = () => {
    const a = arena(duel([one(), one({}, 2), one({}, 3)], [foe(), foe(), foe()]))
    a.battle.overlays.push(overlay('o1', 'foe', 3), overlay('o2', 'foe', 1, { down: true }), overlay('o3', 'foe', 2), overlay('m1', 'ally', 1, { owner: 'a1' }))
    const log: string[] = []
    a.k.battle.effect('mark', 't', (ctx) => { log.push(`${ctx.unit?.id ?? '-'}/${ctx.overlay?.id ?? '-'}`) })
    return { a, log }
  }
  const go = (f: ReturnType<typeof field>, who: string, o: Partial<BattleEffectInput> = {}): string[] => {
    f.log.length = 0
    f.a.run().effects([{ op: 'mark', who }], { user: f.a.ally(1), source: SOURCE, ...o })
    return [...f.log]
  }

  it('foe_overlay：沒有選也沒有目標：最前面（格子最小）、沒被擊落的那一台；我方的、被擊落的不算', () => {
    const f = field()
    expect(go(f, 'foe_overlay')).toEqual(['-/o3'])
    // 最前面的那一台被擊落了：下一台
    f.a.battle.overlays.find((o) => o.id === 'o3')!.down = true
    expect(go(f, 'foe_overlay')).toEqual(['-/o1'])
    // 一台都沒有：整筆不做
    f.a.battle.overlays.find((o) => o.id === 'o1')!.down = true
    expect(go(f, 'foe_overlay')).toEqual([])
  })

  it('玩家選的（pick.overlay）優先：只落在那一台上；不是敵方沒被擊落的一台就整筆不做（不退回別台）', () => {
    const f = field()
    expect(go(f, 'foe_overlay', { pick: { overlay: 'o1' } })).toEqual(['-/o1'])
    expect(go(f, 'foe_overlay', { pick: { overlay: { overlay: 'o3' } } })).toEqual(['-/o3'])
    expect(go(f, 'foe_overlay', { pick: { overlay: 'o2' } })).toEqual([]) // 被擊落了
    expect(go(f, 'foe_overlay', { pick: { overlay: 'm1' } })).toEqual([]) // 我方的
    expect(go(f, 'foe_overlay', { pick: { overlay: 'zzz' } })).toEqual([])
    expect(go(f, 'foe_overlay', { pick: { overlay: 7 } })).toEqual([])
  })

  it('目標是敵方掛著的一台就是它（選的沒寫時）；目標是別的東西（人、一格、我方的一台）就退回最前面的', () => {
    const f = field()
    expect(go(f, 'foe_overlay', { target: { overlay: 'o1' } })).toEqual(['-/o1'])
    expect(go(f, 'foe_overlay', { target: { overlay: 'm1' } })).toEqual(['-/o3'])
    expect(go(f, 'foe_overlay', { target: { unit: 'f1' } })).toEqual(['-/o3'])
    expect(go(f, 'foe_overlay', { target: { side: 'foe', slot: 3 } })).toEqual(['-/o3'])
    // 選的比目標優先
    expect(go(f, 'foe_overlay', { target: { overlay: 'o1' }, pick: { overlay: 'o3' } })).toEqual(['-/o3'])
  })

  it('站在哪一方看做的人：敵人用 foe_overlay 對上的是我方掛著的東西', () => {
    const f = field()
    expect(go(f, 'foe_overlay', { user: f.a.foe(1) })).toEqual(['-/m1'])
  })

  it('who 的檢查認得 foe_overlay；pick:<鍵> 本來就收掛著的東西的 id（不必另外的 who）', () => {
    const f = field()
    expect(f.a.k.battle.effectProblems([{ op: 'mark', who: 'foe_overlay' }])).toEqual([])
    expect(go(f, 'pick:take', { pick: { take: 'o1' } })).toEqual(['-/o1'])
    expect(go(f, 'pick:take', { pick: { take: { unit: 'f2' } } })).toEqual(['f2/-'])
    expect(go(f, 'pick:take', { pick: {} })).toEqual([])
  })
})
