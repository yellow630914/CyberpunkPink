// 驗收測試：dev/work/M1b-core-effects.md（效果的登錄表、攻擊與退出的攔截點、救回來、回復的來源、檢定的標籤、AI 挑目標的權重、先攻對調、花費的標籤）。
// 規格：dev/adr/0015 第一、二節；dev/adr/0010、0014（現有的登錄表與掛點）。
// 效果與掛點都是測試裡臨時註冊的（核心不註冊任何效果）；內容一律是測試自帶的最小假資料。
//
// 型別的名字：ADR 的 EffectCtx、EffectSource 和 core/rules/effects.ts（報告的效果）同名，戰鬥的這一組冠上 Battle：BattleEffectCtx 等。

import { describe, expect, it } from 'vitest'
import type { BattleActionDef, BattleEffectInput, BattleOverlay, BattleTarget, ContentPack, Feature, Kernel } from '../../src'
import { BATTLE_EVENTS, MOD_KINDS, actionCost, actionTags, aiStep, amount, amountProblems, attrMod, beginTurn, createKernel, readyFeatures, targetWeight } from '../../src'
import { combatFeature } from '../../src/features/combat'
import { BATTLE_SETUPS, TEST_COMBAT, fixDice, makeBattleGame, playOut, stateHash, testWeapon } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { TEST_STATUSES, arena, duel, foe, one, raw } from '../helpers/battle'

/** 掛在某一格上的一台（和人重疊的東西）：測試用的最小形狀。 */
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'shield', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
const tags = (run: { beats: Array<{ tag?: string }> }) => run.beats.map((b) => b.tag).filter(Boolean)
const SOURCE = { kind: 'ability', id: 'x', name: 'X' } as const
const input = (a: Arena, o: Partial<BattleEffectInput> = {}): BattleEffectInput => ({ user: a.ally(2), source: SOURCE, ...o })
/** 骰面：給的先出，之後都是 1（傷害骰的顆數會隨要害與重創變，用不到的不影響結果）。 */
const dice = (...v: number[]) => [...v, ...Array(60).fill(1)]
/** 三對三的場地：我方 a1～a3（第 1～3 格）、敵方 f1～f3；沒有遮蔽。 */
const three = (allies?: unknown[], foes?: unknown[]) => arena(duel(allies ?? [one(), one({}, 2), one({}, 3)], foes ?? [foe(), foe(), foe()]))
/** 場上每個人的格（只算我方、還在場上的）。 */
const slotsOf = (a: Arena): Record<string, number> => Object.fromEntries(Object.values(a.battle.units).filter((u) => u.side === 'ally' && !u.out && u.slot >= 1).map((u) => [u.id, u.slot]))
/** 掛一個只在 kind 與 when 都成立時才加減的修正。 */
const plus = (kind: string, value: number, when: (tags: string[]) => boolean = () => true) => (k: Kernel) =>
  k.battle.modifier('t', (q) => (q.kind === kind && when(q.tags) ? [{ label: kind, value }] : []))

describe('效果的登錄表（dev/adr/0015 第一節）', () => {
  it('同一個 op 註冊兩次丟錯，寫出是誰先註冊的；itemOp 是別名：註冊的 getEffect 查得到、effectIds 列得出', () => {
    const k = createKernel()
    expect(k.battle.effectIds()).toEqual([])
    k.battle.effect('hurt', 'combat', () => {})
    expect(() => k.battle.effect('hurt', 'other', () => {})).toThrow(/效果重複註冊：hurt（已經由 combat 註冊）/)
    k.battle.itemOp('gel', 'combat', () => {})
    expect(() => k.battle.effect('gel', 'other', () => {})).toThrow(/重複註冊：gel（已經由 combat 註冊）/)
    expect(() => k.battle.itemOp('hurt', 'other', () => {})).toThrow(/重複註冊：hurt/)
    expect(k.battle.getEffect('gel')).toMatchObject({ op: 'gel', owner: 'combat' })
    expect(k.battle.getEffect('hurt')!.fn).toBeTypeOf('function')
    expect(k.battle.getEffect('nope')).toBeUndefined()
    expect(k.battle.effectIds()).toEqual(['hurt', 'gel'])
    expect(k.battle.itemOpIds()).toEqual(['hurt', 'gel'])
  })

  it('effectProblems：查不到的 op、不認得的 who 與 if 各回傳一條寫出名字的訊息；效果自己的 problems 接在後面；格式不對的也擋', () => {
    const k = createKernel()
    k.battle.effect('hurt', 'combat', () => {}, { problems: (e) => (typeof e.amount === 'number' ? [] : ['amount 要是數字']) })
    expect(k.battle.effectProblems([{ op: 'hurt', amount: 3 }, { op: 'hurt', who: 'foes', if: 'hit', amount: 1 }, { op: 'hurt', who: 'pick:target', amount: 1 }])).toEqual([])
    const missing = k.battle.effectProblems([{ op: 'explode' }])
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatch(/不認得的效果 explode/)
    expect(k.battle.effectProblems([{ op: 'hurt', amount: 1, who: 'nobody' }]).join()).toMatch(/nobody/)
    expect(k.battle.effectProblems([{ op: 'hurt', amount: 1, if: 'maybe' }]).join()).toMatch(/maybe/)
    expect(k.battle.effectProblems([{ op: 'hurt', amount: 1, who: 'pick:' }]).join()).toMatch(/who/)
    expect(k.battle.effectProblems([{ op: 'hurt', amount: 1, who: 7 }]).join()).toMatch(/who/)
    // 效果自己的訊息接在這一筆自己的 op、who、if 的訊息後面
    const both = k.battle.effectProblems([{ op: 'hurt', amount: 'x', who: 'nobody' }])
    expect(both).toHaveLength(2)
    expect(both[0]).toMatch(/nobody/)
    expect(both[1]).toMatch(/amount 要是數字/)
    // 每一筆都查；沒有登錄的 op 沒有自己的 problems
    expect(k.battle.effectProblems([{ op: 'explode' }, { op: 'hurt', amount: 'x' }])).toHaveLength(2)
    expect(k.battle.effectProblems('nope')).toHaveLength(1)
    expect(k.battle.effectProblems([5, { amount: 1 }, null])).toHaveLength(3)
  })

  it('舊的道具效果的叫法照舊：getItemOp 補齊 source、pick、n、last 再交給效果；ctx.item 與 source.id 一致', () => {
    const k = createKernel()
    const seen: unknown[] = []
    k.battle.itemOp('heal', 'combat', (ctx) => { seen.push([ctx.item, ctx.source, ctx.pick, ctx.n, ctx.last]) })
    k.battle.getItemOp('heal')!({ run: null as never, user: null as never, target: { unit: 'a1' }, item: 'it_x' }, {})
    expect(seen).toEqual([['it_x', { kind: 'item', id: 'it_x', name: 'it_x' }, {}, {}, {}]])
  })

  it('核心帶的名單：MOD_KINDS 多了七種修正、BATTLE_EVENTS 多了 revive；新的修正狀態資料也寫得進去、問得到', () => {
    for (const kind of ['heal_dealt', 'vent_dealt', 'ai_target_pct', 'see_dark', 'firewall', 'action_ram', 'wound_grade']) expect(MOD_KINDS, kind).toContain(kind)
    expect(BATTLE_EVENTS).toContain('revive')
    const a = arena(duel([one()], [foe()]), undefined, (k) => k.content.loadPack({ id: 'p', content: { battle_status: [{ id: 'decoy', name: '誘餌', desc: '敵人不挑他。', mods: { ai_target_pct: -100, see_dark: 1 }, until: 'battle_end', kind: 'buff' }] } }))
    const run = a.run()
    run.applyStatus(a.ally(1), 'decoy')
    expect(run.mods('ai_target_pct', a.ally(1)).map((p) => p.value)).toEqual([-100])
    expect(run.mods('see_dark', a.ally(1)).map((p) => p.value)).toEqual([1])
  })
})

describe('run.effects：who、if 與上一筆的結果（dev/adr/0015 第一節）', () => {
  const logs = new WeakMap<Arena, string[]>()
  /** 在這個場地註冊幾個測試用的效果：mark 把「落在誰身上」記下來（單位/掛著的東西），其餘的寫 ctx.last。回傳那份紀錄。 */
  function recorder(a: Arena): string[] {
    const old = logs.get(a)
    if (old) return old
    const log: string[] = []
    logs.set(a, log)
    const eff = (op: string, fn: (ctx: Parameters<Parameters<Arena['k']['battle']['effect']>[2]>[0]) => void) => a.k.battle.effect(op, 't', fn)
    eff('mark', (ctx) => { log.push(`${ctx.unit?.id ?? '-'}/${ctx.overlay?.id ?? '-'}`) })
    eff('hit_it', (ctx) => { ctx.last.hit = true })
    eff('miss_it', (ctx) => { ctx.last.hit = false })
    eff('fail_it', (ctx) => { ctx.last.ok = false })
    eff('pass_it', (ctx) => { ctx.last.ok = true })
    eff('stop_it', (ctx) => { ctx.last.stop = true })
    return log
  }
  /** 對一個場地做一筆 who 的效果，回傳記下來的「單位/掛著的東西」。 */
  function run1(a: Arena, who: string | undefined, o: Partial<BattleEffectInput> = {}): string[] {
    const log = recorder(a)
    log.length = 0
    a.run().effects([{ op: 'mark', ...(who ? { who } : {}) }], input(a, o))
    return [...log]
  }
  const field = () => {
    const a = three()
    a.battle.overlays.push(overlay('o1', 'foe', 1), overlay('o2', 'foe', 3, { down: true }), overlay('o3', 'foe', 2), overlay('m1', 'ally', 2, { owner: 'a2' }))
    return a
  }

  it('預設 target：目標是人就落在他身上；是一台就落在那一台上（ctx.overlay）；是一格或沒有目標呼叫一次、沒有 unit', () => {
    const a = field()
    expect(run1(a, undefined, { target: { unit: 'f1' } })).toEqual(['f1/-'])
    expect(run1(a, 'target', { target: { overlay: 'o1' } })).toEqual(['-/o1'])
    expect(run1(a, undefined, { target: { side: 'foe', slot: 2 } })).toEqual(['-/-'])
    expect(run1(a, undefined)).toEqual(['-/-'])
  })

  it('self、allies、others、adjacent、near、foes：做的人是第 2 格的 a2；adjacent 只算站位差 1 的隊友，倒下的不算', () => {
    const a = field()
    expect(run1(a, 'self')).toEqual(['a2/-'])
    expect(run1(a, 'allies')).toEqual(['a1/-', 'a2/-', 'a3/-'])
    expect(run1(a, 'others')).toEqual(['a1/-', 'a3/-'])
    expect(run1(a, 'adjacent')).toEqual(['a1/-', 'a3/-'])
    expect(run1(a, 'near')).toEqual(['a2/-', 'a1/-', 'a3/-'])
    expect(run1(a, 'foes')).toEqual(['f1/-', 'f2/-', 'f3/-'])
    // 做的人在第 1 格：只有 a2 相鄰
    expect(run1(a, 'adjacent', { user: a.ally(1) })).toEqual(['a2/-'])
    expect(run1(a, 'near', { user: a.ally(1) })).toEqual(['a1/-', 'a2/-'])
    // 第 3 格的 a3 倒下了：不算
    a.ally(3).out = 'down'
    expect(run1(a, 'allies')).toEqual(['a1/-', 'a2/-'])
    expect(run1(a, 'adjacent')).toEqual(['a1/-'])
  })

  it('foes_bridged：只有有橋（有感載）的敵人', () => {
    const a = field()
    delete a.foe(2).load
    expect(run1(a, 'foes_bridged')).toEqual(['f1/-', 'f3/-'])
  })

  it('foe_overlays：敵方每一台掛著的東西（沒被擊落的）逐台各一次、帶 ctx.overlay；我方的、被擊落的不算；一台都沒有就整筆不做；站在哪一方看做的人', () => {
    const a = field()
    expect(run1(a, 'foe_overlays')).toEqual(['-/o1', '-/o3'])
    // 做的人是敵方的 f1：他的敵人是我方，只有我方的 m1
    expect(run1(a, 'foe_overlays', { user: a.foe(1) })).toEqual(['-/m1'])
    // 不看目標：目標是別的東西也一樣
    expect(run1(a, 'foe_overlays', { target: { unit: 'f2' } })).toEqual(['-/o1', '-/o3'])
    a.battle.overlays[0]!.down = true
    a.battle.overlays[2]!.down = true
    expect(run1(a, 'foe_overlays')).toEqual([])
    // 做第一台的時候擊落了後面的那一台：同一筆裡已經擊落的不再做（和 area 一樣）
    const b = field()
    const log = recorder(b)
    b.k.battle.effect('kill_mark', 'test', (ctx) => {
      log.push(`-/${ctx.overlay!.id}`)
      if (ctx.overlay!.id === 'o1') b.battle.overlays.find((x) => x.id === 'o3')!.down = true
    })
    log.length = 0
    b.run().effects([{ op: 'kill_mark', who: 'foe_overlays' }], input(b))
    expect(log).toEqual(['-/o1'])
  })

  it('slot：目標那一格上的人（目標是一格、或是一個人）；那一格沒有人就跳過', () => {
    const a = field()
    expect(run1(a, 'slot', { target: { side: 'foe', slot: 2 } })).toEqual(['f2/-'])
    expect(run1(a, 'slot', { target: { unit: 'f3' } })).toEqual(['f3/-'])
    expect(run1(a, 'slot', { target: { side: 'foe', slot: 4 } })).toEqual([])
    expect(run1(a, 'slot')).toEqual([])
  })

  it('area：目標那一格加 pick.also 那一格上的每個人，再對掛著、沒被擊落的每一台各呼叫一次（帶 ctx.overlay）；被擊落的人與東西都不算', () => {
    const t: BattleTarget = { side: 'foe', slot: 1 }
    const a = field()
    expect(run1(a, 'area', { target: t, pick: { also: 3 } })).toEqual(['f1/-', 'f3/-', '-/o1']) // 掛在第 3 格的 o2 已經擊落
    // 只有目標那一格：沒有 also、also 不是合法的格、also 就是目標那一格
    expect(run1(a, 'area', { target: t })).toEqual(['f1/-', '-/o1'])
    expect(run1(a, 'area', { target: t, pick: { also: 9 } })).toEqual(['f1/-', '-/o1'])
    expect(run1(a, 'area', { target: t, pick: { also: 1 } })).toEqual(['f1/-', '-/o1'])
    expect(run1(a, 'area', { target: t, pick: { also: 2 } })).toEqual(['f1/-', 'f2/-', '-/o1', '-/o3'])
    // 目標是一個人或一台：照它在的那一格
    expect(run1(a, 'area', { target: { unit: 'f2' } })).toEqual(['f2/-', '-/o3'])
    expect(run1(a, 'area', { target: { overlay: 'o1' }, pick: { also: 2 } })).toEqual(['f1/-', 'f2/-', '-/o1', '-/o3'])
    expect(run1(a, 'area')).toEqual([])
    // 第 3 格的人倒下了：不算
    a.foe(3).out = 'down'
    expect(run1(a, 'area', { target: t, pick: { also: 3 } })).toEqual(['f1/-', '-/o1'])
  })

  it('attacker、victim：反應裡由呼叫的人帶，沒帶就丟錯；pick:<鍵> 取 pick 裡放的單位，沒選或查不到就跳過', () => {
    const a = field()
    expect(run1(a, 'attacker', { attacker: a.foe(1), victim: a.ally(3) })).toEqual(['f1/-'])
    expect(run1(a, 'victim', { attacker: a.foe(1), victim: a.ally(3) })).toEqual(['a3/-'])
    expect(() => run1(a, 'attacker')).toThrow(/attacker/)
    expect(() => run1(a, 'victim', { attacker: a.foe(1) })).toThrow(/victim/)
    expect(run1(a, 'pick:buddy', { pick: { buddy: 'f2' } })).toEqual(['f2/-'])
    expect(run1(a, 'pick:buddy', { pick: { buddy: { unit: 'a3' } } })).toEqual(['a3/-'])
    expect(run1(a, 'pick:buddy', { pick: { buddy: 'o1' } })).toEqual(['-/o1'])
    expect(run1(a, 'pick:buddy', { pick: {} })).toEqual([])
    expect(run1(a, 'pick:buddy', { pick: { buddy: 'zzz' } })).toEqual([])
  })

  it('不認得的 who、if、op 丟錯，訊息寫出名字；if 不成立而被跳過的那一筆也照樣查', () => {
    const a = field()
    recorder(a)
    expect(() => a.run().effects([{ op: 'mark', who: 'nobody' }], input(a))).toThrow(/nobody/)
    expect(() => a.run().effects([{ op: 'mark', if: 'maybe' }], input(a))).toThrow(/maybe/)
    expect(() => a.run().effects([{ op: 'explode' }], input(a))).toThrow(/不認得的效果 explode/)
    expect(() => a.run().effects([{ op: 5 }], input(a))).toThrow(/不認得的效果/)
    expect(() => a.run().effects([{ op: 'mark', if: 'hit', who: 'nobody' }], input(a))).toThrow(/nobody/)
  })

  it('if：hit 在上一筆沒中時跳過；miss、crit、downed、overloaded、ok、fail 各看 ctx.last；first_round 看回合數', () => {
    const a = field()
    const log = recorder(a)
    const run = a.run()
    run.effects([{ op: 'miss_it' }, { op: 'mark', if: 'hit' }, { op: 'mark', if: 'miss', who: 'self' }], input(a))
    expect(log).toEqual(['a2/-'])
    log.length = 0
    run.effects([{ op: 'hit_it' }, { op: 'mark', if: 'hit', who: 'self' }, { op: 'mark', if: 'miss' }], input(a))
    expect(log).toEqual(['a2/-'])
    // 沒有上一筆攻擊或檢定：這些都不成立
    log.length = 0
    run.effects(['hit', 'miss', 'ok', 'fail', 'crit', 'downed', 'overloaded'].map((c) => ({ op: 'mark', if: c })), input(a))
    expect(log).toEqual([])
    run.effects([{ op: 'pass_it' }, { op: 'mark', if: 'ok', who: 'self' }, { op: 'mark', if: 'fail' }], input(a))
    expect(log).toEqual(['a2/-'])
    log.length = 0
    run.effects([{ op: 'fail_it' }, { op: 'mark', if: 'fail', who: 'self' }, { op: 'mark', if: 'ok' }], input(a))
    expect(log).toEqual(['a2/-'])
    // crit、downed、overloaded 由效果寫進 last（這裡由呼叫的人先放）
    log.length = 0
    run.effects(['crit', 'downed', 'overloaded', 'hit'].map((c) => ({ op: 'mark', if: c, who: 'self' })), input(a, { last: { crit: true, overloaded: true } }))
    expect(log).toEqual(['a2/-', 'a2/-'])
    // 回合
    log.length = 0
    run.effects([{ op: 'mark', if: 'first_round', who: 'self' }, { op: 'mark', if: 'not_first_round' }], input(a))
    expect(log).toEqual(['a2/-'])
    a.battle.round = 2
    log.length = 0
    run.effects([{ op: 'mark', if: 'first_round' }, { op: 'mark', if: 'not_first_round', who: 'self' }], input(a))
    expect(log).toEqual(['a2/-'])
  })

  it('last 是同一個物件（呼叫的人給了，整串做完之後看得到最後的結果）；一筆落在好幾個人身上，if 只在這一筆之前看一次；stop 讓後面的筆都不做', () => {
    const a = field()
    const log = recorder(a)
    const last = {}
    expect(a.run().effects([{ op: 'hit_it' }], input(a, { last }))).toBe(last)
    expect(last).toEqual({ hit: true })
    // 效果在第一個人身上把 last 改成沒中：同一筆的後面幾個人照樣做；下一筆看到的是改過的
    a.k.battle.effect('flip', 't', (ctx) => { log.push(ctx.unit!.id); ctx.last.hit = false })
    a.run().effects([{ op: 'hit_it' }, { op: 'flip', who: 'allies', if: 'hit' }, { op: 'mark', if: 'hit' }], input(a))
    expect(log).toEqual(['a1', 'a2', 'a3'])
    log.length = 0
    a.run().effects([{ op: 'mark', who: 'self' }, { op: 'stop_it' }, { op: 'mark', who: 'self' }], input(a))
    expect(log).toEqual(['a2/-'])
    // stop 設在一筆落在好幾個人身上的效果裡：這一筆的每個落點都做完，後面的「筆」才不做（ADR 0015「這一筆做完之後」；審查 S1）
    log.length = 0
    a.k.battle.effect('stop_flip', 't', (ctx) => { log.push(ctx.unit!.id); ctx.last.stop = true })
    a.run().effects([{ op: 'stop_flip', who: 'allies' }, { op: 'mark' }], input(a))
    expect(log).toEqual(['a1', 'a2', 'a3'])
  })

  it('ctx 帶的東西：source、pick、n、user、target；來源是道具時 ctx.item 等於 source.id，別的來源沒有', () => {
    const a = field()
    const seen: Array<Record<string, unknown>> = []
    a.k.battle.effect('peek', 't', (ctx, e) => { seen.push({ item: ctx.item, source: ctx.source, pick: ctx.pick, n: ctx.n, user: ctx.user.id, target: ctx.target, unit: ctx.unit?.id, e }) })
    a.run().effects([{ op: 'peek', k: 1 }], input(a, { source: { kind: 'item', id: 'it_a', name: '甲' }, pick: { p: 1 }, n: { tier: 3, spent: 2 }, target: { unit: 'a1' } }))
    expect(seen[0]).toEqual({ item: 'it_a', source: { kind: 'item', id: 'it_a', name: '甲' }, pick: { p: 1 }, n: { tier: 3, spent: 2 }, user: 'a2', target: { unit: 'a1' }, unit: 'a1', e: { op: 'peek', k: 1 } })
    seen.length = 0
    a.run().effects([{ op: 'peek' }], input(a))
    expect(seen[0]).toMatchObject({ item: undefined, pick: {}, n: {}, target: null })
  })

  it('一筆落在好幾個人與掛著的東西上、做到一半有一台被擊落：已經擊落的不再做；下一筆重新解析', () => {
    const a = field()
    const log = recorder(a)
    a.k.battle.effect('shoot_down', 't', (ctx) => { a.battle.overlays.find((o) => o.id === 'o3')!.down = true; log.push(`down:${ctx.unit?.id ?? ctx.overlay?.id}`) })
    a.run().effects([{ op: 'shoot_down', who: 'area' }, { op: 'mark', who: 'area' }], input(a, { target: { side: 'foe', slot: 2 } }))
    expect(log).toEqual(['down:f2', 'f2/-'])
  })
})

describe('數量的公式（dev/adr/0015 第一節）', () => {
  const ctx = (a: Arena, rolls: number[] = [], n: Record<string, number> = {}) => ({ run: fixDice(a.run(), rolls), user: a.ally(1), n })

  it("'2d6+skill:medicine'、'tier*2'、'half_tier_up'、'half_tier_down'、'1d6+1' 算得對", () => {
    const a = three()
    a.ally(1).skills.medicine = 2
    expect(amount(ctx(a, [3, 4]), '2d6+skill:medicine')).toBe(9)
    expect(amount(ctx(a, [], { tier: 3 }), 'tier*2')).toBe(6)
    expect(amount(ctx(a, [], { tier: 3 }), 'half_tier_up')).toBe(2)
    expect(amount(ctx(a, [], { tier: 4 }), 'half_tier_up')).toBe(2)
    expect(amount(ctx(a, [], { tier: 3 }), 'half_tier_down')).toBe(1)
    expect(amount(ctx(a, [], { tier: 4 }), 'half_tier_down')).toBe(2)
    expect(amount(ctx(a, [4]), '1d6+1')).toBe(5)
  })

  it('其餘的項：整數（含負的）、grade（沒給用這場戰鬥的等級）、spent、spentd6、mod:<屬性>、項後面的 *整數、數字原樣回傳', () => {
    const a = three()
    a.ally(1).attrs.body = 14
    expect(amount(ctx(a), '5')).toBe(5)
    expect(amount(ctx(a), '5+-2')).toBe(3)
    expect(amount(ctx(a), 'grade')).toBe(a.battle.grade)
    expect(amount(ctx(a, [], { grade: 4 }), 'grade+1')).toBe(5)
    expect(amount(ctx(a, [], { spent: 3 }), 'spent*2+1')).toBe(7)
    expect(amount(ctx(a, [1, 2, 3], { spent: 3 }), 'spentd6')).toBe(6)
    expect(amount(ctx(a, [], { spent: 0 }), 'spentd6')).toBe(0)
    expect(amount(ctx(a), 'mod:body')).toBe(attrMod(14))
    expect(amount(ctx(a), 'mod:body*3')).toBe(attrMod(14) * 3)
    expect(amount(ctx(a, [2, 5]), '2d6*2')).toBe(14)
    expect(amount(ctx(a), 'skill:nothing')).toBe(0)
    expect(amount(ctx(a), 7)).toBe(7)
    expect(amount(ctx(a), ' 1 + 2 ')).toBe(3)
    expect(amount(ctx(a), 'tier')).toBe(0) // tier 沒給是 0
  })

  it('骰子用 run.roll（和戰鬥裡別的骰子同一串）：每一組骰子各擲一次；同一個狀態、同一個公式，骰面一樣', () => {
    const a = three()
    const before = a.battle.rolls
    const v = amount({ run: a.run(), user: a.ally(1), n: {} }, '3d6+1d20')
    expect(v).toBeGreaterThanOrEqual(4)
    expect(a.battle.rolls - before).toBe(2)
    const b = three()
    expect(amount({ run: b.run(), user: b.ally(1), n: {} }, '3d6+1d20')).toBe(v)
  })

  it("amountProblems：合格的回傳空的；'2d6+foo' 回傳一條帶 foo 的訊息；其餘不合文法的各回傳一條", () => {
    for (const ok of ['2d6+skill:medicine', 'tier*2', 'half_tier_up', 'half_tier_down', 'grade', 'spent', 'spentd6', 'mod:body', '1d6+1', '5', '-3', 3, 0.5]) expect(amountProblems(ok), String(ok)).toEqual([])
    const foo = amountProblems('2d6+foo')
    expect(foo).toHaveLength(1)
    expect(foo[0]).toMatch(/foo/)
    expect(amountProblems('mod:luck')[0]).toMatch(/luck/)
    expect(amountProblems('tier*x')[0]).toMatch(/x/)
    for (const bad of ['2d6-1', '', '2d6+', 'tier*2*3', '0d6', '2d1', 'skill:', Infinity, undefined, {}]) expect(amountProblems(bad), String(bad)).toHaveLength(1)
    expect(() => amount(ctx(three()), 'foo')).toThrow(/foo/)
  })
})

describe('攻擊的選項與攔截點（dev/adr/0015 第二節）', () => {
  /** 一對一：打一個迴避 99、護甲 2 的雜兵（自然 20 以外打不中）。 */
  const hitting = (o: Parameters<typeof foe>[1] = {}) => arena(duel([one({ weapon: 'pistol' })], [foe('minion', { evade: 99, armor: 2, ...o })], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }))

  it('natural: 20 的攻擊一定命中，而且不另外擲命中骰：整場戰鬥的擲骰次數只多傷害那一組；自然 1 與打不到的點數照舊失手', () => {
    const a = hitting()
    const before = a.battle.rolls
    expect(a.run().attack(a.ally(1), a.foe(1), { natural: 20 })).toMatchObject({ hit: true, natural: 20 })
    expect(a.battle.rolls - before).toBe(1)
    // 不給 natural 要多擲一次命中骰
    const b = hitting()
    const before2 = b.battle.rolls
    b.run().attack(b.ally(1), b.foe(1))
    expect(b.battle.rolls - before2).toBe(2)
    const c = hitting()
    expect(c.run(dice()).attack(c.ally(1), c.foe(1), { natural: 1 })).toMatchObject({ hit: false, natural: 1 })
    const d = hitting()
    expect(d.run(dice()).attack(d.ally(1), d.foe(1), { natural: 19 }).hit).toBe(false)
  })

  it('armorMult: 2 時護甲 2 的目標少受 2 點（護甲乘兩倍）；乘 0 等於沒有護甲；不給就照原本的', () => {
    const dealt = (mult?: number) => {
      const a = hitting()
      return a.run(dice(4, 4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20, ...(mult !== undefined ? { armorMult: mult } : {}) }).dealt
    }
    expect(dealt() - dealt(2)).toBe(2)
    expect(dealt(0) - dealt()).toBe(2)
    expect(dealt(1)).toBe(dealt())
    const a = hitting()
    const r = a.run(dice(4, 4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(a.foe(1).hp!.max - a.foe(1).hp!.now).toBe(r.dealt)
  })

  it('attack.before 設了 redirect：原本的目標生命不變、那一台扣耐久、結果 redirected 是 true；彈匣只扣一次；不發 attack.after', () => {
    const after: boolean[] = []
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('minion', { evade: 99 })], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), undefined, (k) => {
      k.battle.on('attack.before', 't', ({ opts }) => { opts.redirect = { overlay: 'o1' } })
      k.battle.on('attack.after', 't', ({ result }) => { after.push(!!result.redirected) })
    })
    a.battle.overlays.push(overlay('o1', 'foe', 1))
    const mag = a.ally(1).weapons[0]!.mag!
    const full = mag.now
    const r = a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r).toMatchObject({ hit: true, redirected: true, track: 'hp' })
    expect(r.dealt).toBeGreaterThan(0)
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    expect(a.battle.overlays[0]!.hp.now).toBe(20 - r.dealt)
    expect(mag.now).toBe(full - 1)
    expect(after).toEqual([])
  })

  it('redirect：第一個設的算數；已經擊落或找不到的那一台就照原本的打', () => {
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('minion', { evade: 0 })], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), undefined, (k) => {
      k.battle.on('attack.before', 'first', ({ opts }) => { opts.redirect = { overlay: 'o1' } }, 0)
      k.battle.on('attack.before', 'second', ({ opts }) => { opts.redirect = { overlay: 'o2' } }, 1)
    })
    a.battle.overlays.push(overlay('o1', 'foe', 1), overlay('o2', 'foe', 2))
    a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(a.battle.overlays.map((o) => o.hp.now < 20)).toEqual([true, false])
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    // 第一個設的那一台已經擊落：照原本的目標打
    a.battle.overlays[0]!.down = true
    const r = a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r.redirected).toBeUndefined()
    expect(a.foe(1).hp!.now).toBeLessThan(a.foe(1).hp!.max)
    // 打不存在的一台
    const b = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, (k) => k.battle.on('attack.before', 't', ({ opts }) => { opts.redirect = { overlay: 'zzz' } }))
    expect(b.run(dice(4, 4, 4)).attack(b.ally(1), b.foe(1), { natural: 20 }).redirected).toBeUndefined()
    expect(b.foe(1).hp!.now).toBeLessThan(b.foe(1).hp!.max)
  })

  it('redirect 的那一擊照那一台自己的護甲算，armorMult 也乘在它的護甲上', () => {
    const hurt = (armorMult?: number) => {
      const a = arena(duel([one({ weapon: 'pistol' })], [foe()]), undefined, (k) => k.battle.on('attack.before', 't', ({ opts }) => { opts.redirect = { overlay: 'o1' } }))
      a.battle.overlays.push(overlay('o1', 'foe', 1, { armor: 3 }))
      return a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20, ...(armorMult ? { armorMult } : {}) }).dealt
    }
    expect(hurt() - hurt(2)).toBe(3)
  })

  it('attack.hit 設 negate：目標不受傷、不重創、不推拉，遮蔽照樣受傷，attack.after 照樣發（結果 negated）', () => {
    const after: Array<{ negated?: boolean; dealt: number }> = []
    const rolls: unknown[] = []
    const build = (negate: boolean) => arena(duel([one({ weapon: 'shotgun' })], [foe('elite'), foe('elite')], { ally: [0, 0, 0, 0], foe: [2, 0, 0, 0] }), undefined, (k) => {
      k.battle.on('attack.hit', 't', ({ out, roll }) => { rolls.push(roll); if (negate) out.negate = true })
      k.battle.on('attack.after', 't', ({ result }) => { after.push({ negated: result.negated, dealt: result.dealt }) })
      k.battle.on('wound', 't', () => { after.push({ dealt: -1 }) })
    })
    const a = build(true)
    const r = a.run(dice(4, 4, 4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r).toMatchObject({ hit: true, negated: true, dealt: 0, wound: false, downed: false })
    expect(a.foe(1).hp!.now).toBe(a.foe(1).hp!.max)
    expect(a.foe(1).slot).toBe(1) // 霰彈槍的推力也沒有
    expect(a.battle.cover.foe[0]!.hp).toBeLessThan(30)
    expect(after).toEqual([{ negated: true, dealt: 0 }])
    expect(rolls[0]).toMatchObject({ natural: 20, crit: true, wound: true })
    // 不擋的對照：受傷、被推、重創、attack.after 不帶 negated
    after.length = 0
    const b = build(false)
    const r2 = b.run(dice(4, 4, 4, 4, 4)).attack(b.ally(1), b.foe(1), { natural: 20 })
    expect(r2.negated).toBeUndefined()
    expect(r2.dealt).toBeGreaterThan(0)
    expect(b.foe(1).slot).toBe(2)
    expect(after).toEqual([{ dealt: -1 }, { negated: undefined, dealt: r2.dealt }])
  })

  it('attack.hit 設 wound = false：自然 20 不發 wound 掛點（改成一般的命中）；雜兵的重創多出來的那一顆骰也沒有；打偏的不發 attack.hit', () => {
    const wounds: number[] = []
    const hits: number[] = []
    const build = (noWound: boolean, target: 'elite' | 'minion' = 'elite') => arena(duel([one({ weapon: 'pistol' })], [foe(target, { evade: 99 })], { ally: [0, 0, 0, 0], foe: [0, 0, 0, 0] }), undefined, (k) => {
      k.battle.on('attack.hit', 't', ({ out }) => { hits.push(1); if (noWound) out.wound = false })
      k.battle.on('wound', 't', () => { wounds.push(1) })
    })
    const control = build(false)
    expect(control.run(dice(4, 4, 4)).attack(control.ally(1), control.foe(1), { natural: 20 }).wound).toBe(true)
    expect(wounds).toEqual([1])
    wounds.length = 0
    const a = build(true)
    const r = a.run(dice(4, 4, 4)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r).toMatchObject({ hit: true, wound: false })
    expect(r.dealt).toBeGreaterThan(0)
    expect(wounds).toEqual([])
    // 雜兵的重創直接多一顆骰：3 顆（沒有重創）對 4 顆（重創）
    const diceCount = (noWound: boolean) => {
      const m = build(noWound, 'minion')
      const run = m.run()
      const counts: number[] = []
      const roll = run.roll.bind(run)
      run.roll = (count, sides) => { counts.push(count); return roll(count, sides) }
      run.attack(m.ally(1), m.foe(1), { natural: 20 })
      return counts
    }
    expect(diceCount(false)).toEqual([4])
    expect(diceCount(true)).toEqual([3])
    hits.length = 0
    const miss = build(false)
    miss.run(dice()).attack(miss.ally(1), miss.foe(1), { natural: 1 })
    expect(hits).toEqual([])
  })
})

describe('退出與救回來（dev/adr/0015 第二節）', () => {
  const lone = (prevent: boolean, hows: string[] = []) => arena(duel([one()], [foe()]), undefined, (k) => {
    k.battle.on('out.before', 't', ({ how, out }) => { hows.push(how); if (prevent) out.prevent = true })
  })
  const squad = (n = 4) => arena(duel(Array.from({ length: n }, (_, i) => one({}, (i % 4) + 1)), [foe()]))

  it('out.before 擋下生命歸零：那個人還在場上、生命 1、沒有「倒下」的那一拍、戰鬥沒有結束；記的剩餘生命也是 1', () => {
    const hows: string[] = []
    const a = lone(true, hows)
    const run = a.run()
    run.damage(a.foe(1), 9999, 'physical', a.ally(1))
    expect(a.foe(1).out).toBeUndefined()
    expect(a.foe(1).hp!.now).toBe(1)
    expect(tags(run)).not.toContain('down')
    expect(a.battle.result).toBeUndefined()
    expect(hows).toEqual(['down'])
    expect(run.beats.find((b) => b.tag === 'damage')!.data!.left).toBe(1)
    // 回傳的實際造成的量只算扣到 1 為止的那一段
    const c = lone(true)
    c.foe(1).hp!.now = 5
    expect(c.run().damage(c.foe(1), 9999, 'physical', c.ally(1))).toMatchObject({ dealt: 4, track: 'hp' })
    // 不擋的對照：倒下、戰鬥結束
    const b = lone(false)
    const run2 = b.run()
    run2.damage(b.foe(1), 9999, 'physical', b.ally(1))
    expect(b.foe(1).out).toBe('down')
    expect(tags(run2)).toContain('down')
    expect(b.battle.result?.outcome).toBe('win')
  })

  it('攻擊打到生命歸零、回合開始時流血歸零也一樣被問：被擋下的攻擊 downed 是 false，生命拉回 1', () => {
    const a = lone(true)
    a.foe(1).hp!.now = 1
    const r = a.run(dice(6, 6, 6)).attack(a.ally(1), a.foe(1), { natural: 20 })
    expect(r).toMatchObject({ hit: true, downed: false })
    expect(a.foe(1).hp!.now).toBe(1)
    expect(a.foe(1).out).toBeUndefined()
    // 每回合開始的流血（−2）讓生命歸零
    const b = arena(duel([one()], [foe()]), undefined, (k) => {
      k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES } })
      k.battle.on('out.before', 't', ({ out }) => { out.prevent = true })
    })
    const f = b.foe(1)
    f.hp!.now = 1
    const run = b.run()
    run.applyStatus(f, 'bleeding')
    run.beats.length = 0
    expect(beginTurn(run, f)).toBe(true)
    expect(f.hp!.now).toBe(1)
    expect(f.out).toBeUndefined()
    expect(run.beats.find((x) => x.tag === 'damage')!.data!.left).toBe(1)
  })

  it('setOut 擋下 subdued 也成立：回傳 false、什麼都不做；沒有人擋就回傳 true；已經退出的再叫回傳 false', () => {
    const hows: string[] = []
    const a = lone(true, hows)
    const run = a.run()
    expect(run.setOut(a.foe(1), 'subdued', a.ally(1))).toBe(false)
    expect(a.foe(1).out).toBeUndefined()
    expect(run.beats).toEqual([])
    expect(hows).toEqual(['subdued'])
    const b = lone(false)
    const run2 = b.run()
    expect(run2.setOut(b.foe(1), 'subdued', b.ally(1))).toBe(true)
    expect(b.foe(1).out).toBe('subdued')
    expect(run2.setOut(b.foe(1), 'fled')).toBe(false)
    expect(b.foe(1).out).toBe('subdued')
  })

  it('餘韻疊滿之後再過載（burnout）也會被問：擋下就不昏過去，感載已經歸零', () => {
    const hows: string[] = []
    const a = lone(true, hows)
    const me = a.ally(1)
    me.layers = me.layersMax
    a.run().addLoad(me, 999, undefined, { exact: true })
    expect(hows).toEqual(['burnout'])
    expect(me.out).toBeUndefined()
    expect(me.load!.now).toBe(0)
    const b = lone(false)
    b.ally(1).layers = b.ally(1).layersMax
    b.run().addLoad(b.ally(1), 999, undefined, { exact: true })
    expect(b.ally(1).out).toBe('burnout')
  })

  it('revive：倒下的人回到最後面的空格、生命是給的數字、行動點 0、狀態清空、先攻的順位不變、發 revive 這一拍', () => {
    const a = squad()
    const run = a.run()
    const order = [...a.battle.order]
    a.ally(2).statuses = [{ id: 'bleeding', until: { at: 'battle_end' } }]
    run.setOut(a.ally(2), 'down')
    expect(slotsOf(a)).toEqual({ a1: 1, a3: 2, a4: 3 }) // 後面的人往前補
    expect(run.revive(a.ally(2), 12)).toBe(true)
    expect(a.ally(2)).toMatchObject({ slot: 4, hp: { now: 12 }, ap: { now: 0 }, statuses: [] })
    expect(a.ally(2).out).toBeUndefined()
    expect(a.battle.order).toEqual(order)
    expect(run.beats.filter((b) => b.tag === 'revive')).toHaveLength(1)
    expect(run.beats.find((b) => b.tag === 'revive')!.data).toMatchObject({ unit: 'a2', hp: 12, slot: 4 })
  })

  it('revive：沒有空格時排進後方的最前面，有空格補人時回到場上、先攻的順位不變；生命夾在 1 到上限之間', () => {
    const a = arena(duel([one(), one({}, 2), one({}, 3), one({}, 4), one({}, 1)], [foe()]))
    expect(a.battle.reserve.ally).toEqual(['a5'])
    const run = a.run()
    run.setOut(a.ally(2), 'down')
    run.reinforce('ally') // a5 補上來，四格又滿了
    expect(a.ally(5).slot).toBe(4)
    expect(run.revive(a.ally(2), 9999)).toBe(true)
    expect(a.ally(2)).toMatchObject({ slot: 0, hp: { now: a.ally(2).hp!.max } })
    expect(a.ally(2).out).toBeUndefined()
    expect(a.battle.reserve.ally).toEqual(['a2'])
    expect(Object.values(slotsOf(a))).toEqual([1, 2, 3, 4]) // 後方的人不佔格
    // 前面有人退出、補位時他回來：順序裡還是只有一個，不用重擲先攻
    const order = [...a.battle.order]
    const init = a.ally(2).initiative
    run.setOut(a.ally(1), 'down')
    run.reinforce('ally')
    expect(a.ally(2).slot).toBeGreaterThanOrEqual(1)
    expect(a.battle.reserve.ally).toEqual([])
    expect(a.battle.order).toEqual(order)
    expect(a.ally(2).initiative).toBe(init)
    // 生命至少 1
    const b = squad()
    const r2 = b.run()
    r2.setOut(b.ally(2), 'down')
    r2.revive(b.ally(2), 0)
    expect(b.ally(2).hp!.now).toBe(1)
  })

  it('revive：對 burnout、subdued 與還在場上的人回傳 false、什麼都不動；戰鬥已經分出結果之後也不能救', () => {
    const a = squad()
    const run = a.run()
    a.ally(2).out = 'burnout'
    a.ally(3).out = 'subdued'
    expect(run.revive(a.ally(2), 10)).toBe(false)
    expect(run.revive(a.ally(3), 10)).toBe(false)
    expect(run.revive(a.ally(1), 10)).toBe(false)
    expect(a.ally(2).out).toBe('burnout')
    expect(a.ally(3).out).toBe('subdued')
    expect(run.beats).toEqual([])
    a.ally(4).out = 'down'
    a.battle.result = { outcome: 'win', text: '' }
    expect(run.revive(a.ally(4), 10)).toBe(false)
    expect(a.ally(4).out).toBe('down')
  })
})

describe('回復的來源、檢定的標籤與掛點（dev/adr/0015 第二節）', () => {
  it('有人註冊 heal_dealt +4 時，帶 by 的回復多 4，不帶的不多；標籤傳得到修正；vent_dealt 同理', () => {
    const seen: string[][] = []
    const a = arena(duel([one(), one({}, 2)], [foe()]), undefined, (k) => {
      k.battle.modifier('t', (q) => { if (q.kind === 'heal_dealt') seen.push(q.tags); return q.kind === 'heal_dealt' || q.kind === 'vent_dealt' ? [{ label: q.kind, value: 4 }] : [] })
    })
    const [x, y] = [a.ally(1), a.ally(2)]
    x.hp!.now = 10
    expect(a.run().heal(x, 5, y, ['item', 'medical'])).toBe(9)
    expect(seen).toEqual([['item', 'medical']])
    x.hp!.now = 10
    expect(a.run().heal(x, 5)).toBe(5)
    x.hp!.now = 10
    expect(a.run().heal(x, 5, y)).toBe(9)
    // 回復 0 不會因為修正變成有回復；回復量照樣夾在上限
    x.hp!.now = x.hp!.max - 2
    expect(a.run().heal(x, 5, y)).toBe(2)
    expect(a.run().heal(x, 0, y)).toBe(0)
    x.load!.now = 10
    expect(a.run().vent(x, 3, y)).toBe(7)
    x.load!.now = 10
    expect(a.run().vent(x, 3)).toBe(3)
    // 做的人記在這一拍
    const run = a.run()
    x.hp!.now = 10
    run.heal(x, 1, y)
    expect(run.beats[0]).toMatchObject({ tag: 'heal', data: { target: 'a1', by: 'a2' } })
  })

  it('道具的急救帶得到 heal_dealt：道具效果帶用的人（by）與標籤 [item, …物品的標籤]；沒有醫療標籤的道具吃不到只對醫療加值的修正', () => {
    const item = (id: string, more: Record<string, unknown>) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...more })
    const PACK: ContentPack = {
      id: 'p',
      content: {
        battle_status: TEST_STATUSES,
        item: [
          item('it_gel', { tags: ['medical'], use: { ap: 1, ap_other: 2, target: 'ally', effects: [{ op: 'heal', amount: 8 }] } }),
          item('it_cool', { use: { ap: 1, target: 'self', effects: [{ op: 'vent', amount: 3 }] } }),
        ],
      },
    }
    const a = arena(duel([one({ quick: [{ item: 'it_gel', qty: 2 }, { item: 'it_cool', qty: 1 }] }), one({}, 2)], [foe()]), [combatFeature], (k) => {
      k.content.loadPack(PACK)
      plus('heal_dealt', 4, (t) => t.includes('item') && t.includes('medical'))(k)
      plus('vent_dealt', 2, (t) => t.includes('item'))(k)
    })
    const use = (id: string, unit: string) => a.k.battle.getAction('item')!.run(a.run(), a.ally(1), { unit }, { action: 'item', target: { unit }, pick: { item: id } })
    a.ally(2).hp!.now = 10
    use('it_gel', 'a2')
    expect(a.ally(2).hp!.now).toBe(10 + 8 + 4)
    a.ally(1).load!.now = 9
    use('it_cool', 'a1')
    expect(a.ally(1).load!.now).toBe(9 - 3 - 2)
  })

  it('道具的一串效果走 run.effects：who 照核心的清單（allies 讓每個隊友各回一次）；道具的 who 寫錯在載入時擋下，訊息寫出是哪個道具', () => {
    const item = (id: string, effects: Array<Record<string, unknown>>) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', use: { ap: 1, target: 'self', effects } })
    const a = arena(duel([one({ quick: [{ item: 'it_all', qty: 1 }] }), one({}, 2), one({}, 3)], [foe()]), [combatFeature], (k) => {
      k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES, item: [item('it_all', [{ op: 'heal', amount: 5, who: 'allies' }])] } })
    })
    for (const i of [1, 2, 3]) a.ally(i).hp!.now = 10
    a.k.battle.getAction('item')!.run(a.run(), a.ally(1), { unit: 'a1' }, { action: 'item', target: { unit: 'a1' }, pick: { item: 'it_all' } })
    expect([1, 2, 3].map((i) => a.ally(i).hp!.now)).toEqual([15, 15, 15])
    const k = createKernel([combatFeature])
    k.content.loadPack({ id: 'bad', content: { battle_status: TEST_STATUSES, item: [item('it_bad', [{ op: 'heal', amount: 5, who: 'nobody' }])] } })
    expect(() => readyFeatures(k)).toThrow(/item\/it_bad：.*nobody/)
  })

  it('save 的標籤傳到修正：只對 subdue 加值的修正不影響士氣檢定；沒給標籤的檢定照舊；修正拿得到「對誰擲的」', () => {
    const a = arena(duel([one()], [foe()]), undefined, plus('save', 5, (t) => t.includes('subdue')))
    const me = a.ally(1)
    const labels = (tagList?: string[]) => a.run([10]).save(me, 'body', 'brawl', 10, '檢定', [], tagList).roll.parts.map((p) => p.label)
    expect(labels(['subdue'])).toContain('save')
    expect(labels(['morale'])).not.toContain('save')
    expect(labels()).not.toContain('save')
    let other: string | undefined
    const b = arena(duel([one()], [foe()]), undefined, (k) => k.battle.modifier('t', (q) => { if (q.kind === 'save') other = q.other?.id; return [] }))
    b.run([10]).save(b.ally(1), 'body', 'brawl', 10, '檢定', [], ['hack'], b.foe(1))
    expect(other).toBe('f1')
  })

  it('現有的呼叫補了標籤：制伏 subdue、脫離 flee、掃射的抵抗壓制 resist:suppressed', () => {
    const seen: string[][] = []
    const lmg = one({ weapon: 'rifle' })
    lmg.weapons[0] = { ...testWeapon('rifle', 4), id: 'lmg', name: '輕機槍', class: 'lmg', range: [3, 6], pierce: 0, mag: { now: 4, max: 4 }, coverMult: 1, traits: ['sweep', 'heavy'] }
    const a = arena(duel([one({ weapon: 'pistol' }), lmg], [foe('minion', { evade: 99 })]), [combatFeature], (k) => {
      k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES } })
      k.battle.modifier('t', (q) => { if (q.kind === 'save') seen.push(q.tags); return [] })
    })
    const act = (id: string) => a.k.battle.getAction(id)!
    act('flee').run(a.run(dice(5)), a.ally(1), null, { action: 'flee' })
    expect(seen).toEqual([['flee']])
    seen.length = 0
    act('subdue').run(a.run(dice(5)), a.ally(1), { unit: 'f1' }, { action: 'subdue', target: { unit: 'f1' } })
    expect(seen).toEqual([['subdue']])
    seen.length = 0
    act('shoot').run(a.run(dice(1)), a.ally(2), { unit: 'f1' }, { action: 'shoot', target: { unit: 'f1' }, pick: { sweep: true } })
    expect(seen).toEqual([['resist:suppressed']])
  })

  it('有 other 的檢定在擲之前發 check.before（處理函式可以改 DC 與加值）；沒有 other 的檢定不發；掛點拿得到是誰、對誰、什麼標籤', () => {
    const calls: Array<{ unit: string; other: string; tags: string[] }> = []
    const a = arena(duel([one()], [foe()]), undefined, (k) => {
      k.battle.on('check.before', 't', ({ unit, other, tags: t, opts }) => { calls.push({ unit: unit.id, other: other.id, tags: t }); opts.dc += 2; opts.bonus += 3 })
    })
    const me = a.ally(1)
    const hacked = a.run([10]).save(me, 'resolve', 'composure', 12, '防火牆', [], ['hack'], a.foe(1))
    expect(hacked.roll.dc).toBe(14)
    expect(hacked.roll.parts.find((p) => p.source === 'reaction')).toMatchObject({ value: 3 })
    expect(hacked.roll.total).toBe(10 + hacked.roll.parts.reduce((s, p) => s + p.value, 0))
    expect(calls).toEqual([{ unit: 'a1', other: 'f1', tags: ['hack'] }])
    const plain = a.run([10]).save(me, 'resolve', 'composure', 12, '定力')
    expect(plain.roll.dc).toBe(12)
    expect(plain.roll.parts.some((p) => p.source === 'reaction')).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

describe('AI 與黑暗（dev/adr/0015 第二節）', () => {
  /** 讓敵人 f1 在不同的骰面下各打一次（不換位、補滿彈匣與生命），回傳每一次打的是誰。 */
  const targets = (a: Arena, n: number): string[] => {
    const got: string[] = []
    for (let i = 0; i < n; i++) {
      a.battle.rolls = i * 3
      a.battle.aiSteps = 0
      for (const u of Object.values(a.battle.units)) {
        if (u.hp) u.hp.now = u.hp.max
        for (const w of u.weapons) if (w.mag) w.mag.now = w.mag.max
      }
      const f = a.foe(1)
      f.ap.now = 6
      f.uses['turn:ai_moved'] = 1
      const run = a.run()
      aiStep(run, f)
      for (const beat of run.beats) if (beat.tag === 'hit' || beat.tag === 'miss' || beat.tag === 'crit') got.push(String(beat.data!.target))
    }
    return got
  }
  const decoy = (pct: number, ...ids: string[]) => (k: Kernel) => k.battle.modifier('t', (q) => (q.kind === 'ai_target_pct' && ids.includes(q.unit.id) ? [{ label: '誘餌', value: pct }] : []))

  it('ai_target_pct −100 的人不被挑；場上只剩他時照樣被挑；每個候選都是 −100 時當成沒有這個修正；−50 讓權重剩一半', () => {
    const a = arena(duel([one(), one({}, 2)], [foe()]), undefined, decoy(-100, 'a1'))
    const run = a.run()
    expect(targetWeight(run, a.foe(1), a.ally(1))).toBe(0)
    expect(targetWeight(run, a.foe(1), a.ally(2))).toBeGreaterThan(0)
    expect(targetWeight(run, a.foe(1), a.ally(1), { ignorePct: true })).toBeGreaterThan(0)
    const got = targets(a, 40)
    expect(got.length).toBeGreaterThan(20)
    expect(new Set(got)).toEqual(new Set(['a2']))
    // 只剩他
    const solo = arena(duel([one()], [foe()]), undefined, decoy(-100, 'a1'))
    expect(new Set(targets(solo, 10))).toEqual(new Set(['a1']))
    // 兩個人都是誘餌：照沒有這個修正挑（兩個都會被挑到）
    const both = arena(duel([one(), one({}, 2)], [foe()]), undefined, decoy(-100, 'a1', 'a2'))
    expect(new Set(targets(both, 40))).toEqual(new Set(['a1', 'a2']))
    // 百分點：−50 讓權重剩一半
    const half = arena(duel([one(), one({}, 2)], [foe()]), undefined, decoy(-50, 'a1'))
    expect(targetWeight(half.run(), half.foe(1), half.ally(1)) * 2).toBeCloseTo(targetWeight(half.run(), half.foe(1), half.ally(1), { ignorePct: true }))
  })

  it('see_dark 的人打黑暗裡的目標沒有 +2（人與掛著的東西都一樣）；夜視的標籤照舊；沒有的照吃黑暗', () => {
    const a = arena(duel([one(), one({}, 2), one({ tags: ['night_vision'] }, 3)], [foe()]), undefined, (k) => k.battle.modifier('t', (q) => (q.kind === 'see_dark' && q.unit.id === 'a1' ? [{ label: '夜視義眼', value: 1 }] : [])))
    a.battle.field.dark = true
    a.battle.overlays.push(overlay('o1', 'foe', 1, { evade: 10, hp: { now: 500, max: 500 } }))
    const dark = (i: number) => a.run().evadeOf(a.foe(1), a.ally(i)).parts.some((p) => p.label === '黑暗')
    expect([dark(1), dark(2), dark(3)]).toEqual([false, true, false])
    const evadeOfOverlay = (i: number) => a.run(dice()).attackOverlay(a.ally(i), a.battle.overlays[0]!, { natural: 20 }).evade
    expect([evadeOfOverlay(1), evadeOfOverlay(2), evadeOfOverlay(3)]).toEqual([10, 12, 10])
    // 白天沒有黑暗這一項
    a.battle.field.dark = false
    expect(dark(2)).toBe(false)
  })
})

describe('先攻（dev/adr/0015 第二節）', () => {
  const eight = () => arena(BATTLE_SETUPS.encounter())

  it('swapOrder：兩個人的順位對調、現在輪到的人不變；同一個人、有一個不在順序裡回傳 false', () => {
    const a = eight()
    const b = a.battle
    const run = a.run()
    const cur = b.order[b.turn]!
    const rest = b.order.filter((id) => id !== cur)
    const [x, y] = [rest[1]!, rest[4]!]
    const before = [...b.order]
    expect(run.swapOrder(b.units[x]!, b.units[y]!)).toBe(true)
    expect(b.order[before.indexOf(x)]).toBe(y)
    expect(b.order[before.indexOf(y)]).toBe(x)
    expect(b.order[b.turn]).toBe(cur)
    expect([...b.order].sort()).toEqual([...before].sort())
    expect(run.swapOrder(b.units[x]!, b.units[x]!)).toBe(false)
    // 後方排隊、還沒進順序的
    const five = arena({ ...BATTLE_SETUPS.encounter(), foes: [1, 2, 3, 4, 5].map(() => raw(foe())) })
    expect(five.battle.order).not.toContain('f5')
    expect(five.run().swapOrder(five.ally(1), five.foe(5))).toBe(false)
  })

  it('swapOrder：其中一個就是現在輪到的人時，輪到的人還是他（指標跟著他走）', () => {
    const a = eight()
    const b = a.battle
    b.turn = 2
    const cur = b.order[2]!
    const other = b.order[5]!
    expect(a.run().swapOrder(b.units[cur]!, b.units[other]!)).toBe(true)
    expect(b.order[b.turn]).toBe(cur)
    expect(b.order[2]).toBe(other)
  })

  it('actNext：這一輪還沒動過的人排到現在輪到的人後面一位、輪到的人不變；已經動過的、正在動的、退出的、不在順序裡的回傳 false，順序不動', () => {
    const a = eight()
    const b = a.battle
    b.turn = 2
    const run = a.run()
    const before = [...b.order]
    const cur = before[2]!
    const later = before[6]!
    expect(run.actNext(b.units[later]!)).toBe(true)
    expect(b.order[2]).toBe(cur)
    expect(b.order[3]).toBe(later)
    expect(b.order.indexOf(before[3]!)).toBe(4)
    expect([...b.order].sort()).toEqual([...before].sort())
    // 本來就排在下一位：照舊、回傳 true
    const copy = [...b.order]
    expect(run.actNext(b.units[later]!)).toBe(true)
    expect(b.order).toEqual(copy)
    // 動過的（順位在前面）、正在動的
    expect(run.actNext(b.units[before[0]!]!)).toBe(false)
    expect(run.actNext(b.units[before[1]!]!)).toBe(false)
    expect(run.actNext(b.units[cur]!)).toBe(false)
    // 退出的
    b.units[before[7]!]!.out = 'down'
    expect(run.actNext(b.units[before[7]!]!)).toBe(false)
    expect(b.order).toEqual(copy)
    // 後方排隊、還沒進順序的
    const five = arena({ ...BATTLE_SETUPS.encounter(), foes: [1, 2, 3, 4, 5].map(() => raw(foe())) })
    expect(five.run().actNext(five.foe(5))).toBe(false)
  })

  it('hasActed：順位在現在輪到的人之前、或就是他算動過（或正在動）；在後面的、還在後方排隊的不算', () => {
    const a = eight()
    const b = a.battle
    b.turn = 3
    const run = a.run()
    expect(b.order.slice(0, 4).map((id) => run.hasActed(b.units[id]!))).toEqual([true, true, true, true])
    expect(b.order.slice(4).map((id) => run.hasActed(b.units[id]!))).toEqual([false, false, false, false])
    const five = arena({ ...BATTLE_SETUPS.encounter(), foes: [1, 2, 3, 4, 5].map(() => raw(foe())) })
    expect(five.run().hasActed(five.foe(5))).toBe(false)
  })

  it('actNext 帶 acted（對調之前就問好的）：acted 是 false 時，順位在現在輪到的人前面的也排到他後面，輪到的人不變、指標跟著修正；acted 是 true 時不動', () => {
    const a = eight()
    const b = a.battle
    b.turn = 3
    const run = a.run()
    const before = [...b.order]
    const cur = before[3]!
    // 順位在前面（第 0 位）、但對調之前其實還沒動過：排到現在輪到的人後面一位
    expect(run.actNext(b.units[before[0]!]!, { acted: false })).toBe(true)
    expect(b.order[b.turn]).toBe(cur)
    expect(b.turn).toBe(2)
    expect(b.order[3]).toBe(before[0])
    expect([...b.order].sort()).toEqual([...before].sort())
    expect(b.order.filter((id) => id === before[0])).toHaveLength(1)
    // 對調之前就動過了：不動
    const copy = [...b.order]
    expect(run.actNext(b.units[before[6]!]!, { acted: true })).toBe(false)
    expect(b.order).toEqual(copy)
    // 正在動的、退出的、不在順序裡的，不管 acted 怎麼寫都回傳 false
    expect(run.actNext(b.units[cur]!, { acted: false })).toBe(false)
    b.units[before[7]!]!.out = 'down'
    expect(run.actNext(b.units[before[7]!]!, { acted: false })).toBe(false)
    expect(b.order).toEqual(copy)
    const five = arena({ ...BATTLE_SETUPS.encounter(), foes: [1, 2, 3, 4, 5].map(() => raw(foe())) })
    expect(five.run().actNext(five.foe(5), { acted: false })).toBe(false)
  })
})

describe('花費的標籤與 RAM（dev/adr/0015 第二節）', () => {
  const def = (o: Partial<BattleActionDef> = {}): BattleActionDef => ({ id: 'x', owner: 't', name: 'x', desc: 'x', group: 'skill', target: 'none', cost: () => ({ ap: 2, ram: 3 }), run: () => {}, ...o })

  it('actionTags 把 costTags 接在最後面（要給 view 才問）；沒寫 costTags 的行動照舊', () => {
    const a = arena(duel([one(), one({}, 2)], [foe()]))
    const me = a.ally(1)
    const d = def({ tags: ['weapon_attack'], costTags: (_v, _u, i) => [`t:${String(i?.pick?.kind ?? 'none')}`] })
    expect(actionTags(me, d, { action: 'x', target: { unit: 'a2' }, pick: { kind: 'k' } }, a.run())).toEqual(['x', 'group:skill', 'weapon_attack', 'other', 't:k'])
    expect(actionTags(me, d, { action: 'x' })).toEqual(['x', 'group:skill', 'weapon_attack'])
    expect(actionTags(me, def(), undefined, a.run())).toEqual(['x', 'group:skill'])
  })

  it('costTags 的標籤傳給 action_ap 的修正（減免才認得出是哪一類）', () => {
    const seen: string[][] = []
    const a = arena(duel([one()], [foe()]), undefined, (k) => k.battle.modifier('t', (q) => {
      if (q.kind === 'action_ap') seen.push(q.tags)
      return q.kind === 'action_ap' && q.tags.includes('kind:med') ? [{ label: '醫療減免', value: -1 }] : []
    }))
    const med = def({ cost: () => ({ ap: 2 }), costTags: () => ['kind:med'] })
    const other = def({ cost: () => ({ ap: 2 }), costTags: () => ['kind:other'] })
    expect(actionCost(a.run(), a.ally(1), med).ap).toBe(1)
    expect(actionCost(a.run(), a.ally(1), other).ap).toBe(2)
    expect(seen).toEqual([['x', 'group:skill', 'kind:med'], ['x', 'group:skill', 'kind:other']])
  })

  it('action_ram −1：花 3 點 RAM 的行動只花 2、花 1 點的還是 1；本來不花 RAM 的不會因為 +1 多花；問修正時 base 是行動自己算的 RAM', () => {
    const a = arena(duel([one()], [foe()]), undefined, plus('action_ram', -1))
    const me = a.ally(1)
    expect(actionCost(a.run(), me, def({ cost: () => ({ ap: 2, ram: 3 }) }))).toEqual({ ap: 2, ram: 2 })
    expect(actionCost(a.run(), me, def({ cost: () => ({ ap: 1, ram: 1 }) }))).toEqual({ ap: 1, ram: 1 })
    expect(actionCost(a.run(), me, def({ cost: () => ({ ap: 2 }) }))).toEqual({ ap: 2 })
    const more = arena(duel([one()], [foe()]), undefined, (k) => k.battle.modifier('t', (q) => (q.kind === 'action_ram' || q.kind === 'action_ap' ? [{ label: '貴', value: 1 }] : [])))
    expect(actionCost(more.run(), more.ally(1), def({ cost: () => ({ ap: 2, ram: 3 }) }))).toEqual({ ap: 3, ram: 4 })
    expect(actionCost(more.run(), more.ally(1), def({ cost: () => ({ ap: 2 }) }))).toEqual({ ap: 3 })
    let base: number | undefined
    const c = arena(duel([one()], [foe()]), undefined, (k) => k.battle.modifier('t', (q) => { if (q.kind === 'action_ram') base = q.base; return [] }))
    actionCost(c.run(), c.ally(1), def())
    expect(base).toBe(3)
  })

  it('用醫療道具時問 action_ap 的標籤裡有 item:medical（物品的每個標籤加 item: 前綴）；沒有標籤的、還沒選的只有 item', () => {
    const item = (id: string, tagList?: string[]) => ({ id, name: id, desc: `${id}。`, category: 'consumable', grade: 1, size: 1, legal: 'free', ...(tagList ? { tags: tagList } : {}), use: { ap: 1, target: 'self', effects: [{ op: 'vent', amount: 1 }] } })
    const seen: string[][] = []
    const a = arena(duel([one({ quick: [{ item: 'it_med', qty: 1 }, { item: 'it_plain', qty: 1 }] })], [foe()]), [combatFeature], (k) => {
      k.content.loadPack({ id: 'p', content: { battle_status: TEST_STATUSES, item: [item('it_med', ['medical', 'throwable']), item('it_plain')] } })
      k.battle.modifier('t', (q) => {
        if (q.kind === 'action_ap') seen.push(q.tags)
        return q.kind === 'action_ap' && q.tags.includes('item:medical') ? [{ label: '醫護減免', value: -1 }] : []
      })
    })
    const action = a.k.battle.getAction('item')!
    const me = a.ally(1)
    expect(actionCost(a.run(), me, action, { action: 'item', target: { unit: 'a1' }, pick: { item: 'it_med' } }).ap).toBe(0)
    expect(seen.at(-1)).toEqual(['item', 'group:supply', 'item', 'item:medical', 'item:throwable'])
    expect(actionCost(a.run(), me, action, { action: 'item', target: { unit: 'a1' }, pick: { item: 'it_plain' } }).ap).toBe(1)
    expect(seen.at(-1)).toEqual(['item', 'group:supply', 'item'])
    // 還沒選：兩種都能用，不知道是哪一種
    expect(actionCost(a.run(), me, action).ap).toBe(1)
    expect(seen.at(-1)).toEqual(['item', 'group:supply', 'item'])
  })
})

describe('整場戰鬥裡用：掛點接在提交與回合上（不變式 44、47）', () => {
  /** 我方第一次生命歸零時被擋下（生命 1）；敵方第一次倒下時被救回來（生命 8）。 */
  const savior: Feature = {
    id: 'savior',
    install: (k) => {
      k.battle.on('out.before', 'savior', ({ unit, how, out }) => {
        if (unit.side === 'ally' && how === 'down' && !unit.uses.saved) {
          unit.uses.saved = 1
          out.prevent = true
        }
      })
      k.battle.on('out', 'savior', ({ run, unit, how }) => {
        if (unit.side === 'foe' && how === 'down' && !unit.uses.revived) {
          unit.uses.revived = 1
          run.revive(unit, 8)
        }
      })
    },
  }
  const play = (seed: number) => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT, savior], battle: 'encounter', seed })
    const { outcome } = playOut(game)
    const beats = game.state.reports.filter((r) => r.action === 'battle.step').flatMap((r) => r.timeline.map((b) => b.tag))
    return { outcome, beats, hash: stateHash(game.state), game }
  }

  it('擋下與救回來的整場戰鬥打得完（每一步都過提交的檢查）；同一個種子兩次的結果一樣', () => {
    const a = play(7)
    expect(['win', 'lose']).toContain(a.outcome)
    expect(a.beats.filter((t) => t === 'revive').length).toBeGreaterThan(0)
    expect(play(7).hash).toBe(a.hash)
  })

  it('存檔再讀檔：救回來排在後方的人也存得下、讀得回來', () => {
    const { game } = play(7)
    const hash = stateHash(game.state)
    expect(game.load(game.save('manual', '2026-11-22T00:00:00Z'))).toBeNull()
    expect(stateHash(game.state)).toBe(hash)
  })
})
