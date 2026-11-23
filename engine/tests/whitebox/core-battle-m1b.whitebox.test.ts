// 白箱測試：core/battle 第二波新增的部分（effects.ts 的公式與 who 解析；run.ts 的掛著的東西、遮蔽、救回來、過載；step.ts／turn.ts／setup.ts 的退路）。
// 補主套件沒有走到的分支與錯誤路徑；每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。
// 會失敗（和規格不一致）的寫在 tests/pending/ 與 dev/bugs/，這裡只放現在就對的行為。內容一律是測試自帶的假資料。

import { describe, expect, it } from 'vitest'
import type { BattleOverlay, BattleUnit, Feature, GameState, Kernel } from '../../src'
import { BattleBlocked, abortBattle, amount, amountProblems, battleAct, battleOptions, beginTurn, clone, createKernel, endBattle, pendingDefeat, setupBattle } from '../../src'
import { TEST_COMBAT, makeBattleGame, makeGame, makeState } from '../../src/testkit'
import type { Arena } from '../helpers/battle'
import { arena, duel, foe, one, raw } from '../helpers/battle'

type Rec = Record<string, unknown>
const SRC = { kind: 'ability', id: 'sk_x', name: '測試' } as const
const dice = (...v: number[]): number[] => [...v, ...Array(80).fill(1)]
const overlay = (id: string, side: 'ally' | 'foe', slot: number, o: Partial<BattleOverlay> = {}): BattleOverlay => ({
  id, side, slot, owner: side === 'ally' ? 'a1' : 'f1', kind: 'shield', name: id, hp: { now: 20, max: 20 }, armor: 0, evade: 0, used: false, down: false, ...o,
})
const three = (allies?: unknown[], foes?: unknown[]): Arena => arena(duel(allies ?? [one(), one({}, 2), one({}, 3)], foes ?? [foe(), foe(), foe()]))
const tags = (run: { beats: Array<{ tag?: string }> }): string[] => run.beats.map((b) => b.tag).filter((t): t is string => !!t)
const blocked = (fn: () => void): string[] => {
  try { fn() } catch (e) { if (e instanceof BattleBlocked) return e.reasons; throw e }
  return []
}
void tags
void blocked

// =====================================================================================================================
// 效果的數量公式（dev/adr/0015 第一節；core/battle/effects.ts amount）
// =====================================================================================================================

describe('白箱 數量公式（dev/adr/0015 第一節 amount）', () => {
  const ctxOf = (a: Arena, o: Rec = {}) => ({ run: a.run(dice()), user: a.ally(1), n: {}, ...o }) as Parameters<typeof amount>[0]

  it('hp_max 與 load_max 看「這一筆落在的人」（ctx.unit），沒給 ctx.unit 看做的人；沒有感載的人 load_max 是 0（0015 第一節）', () => {
    const a = three([one({ hp: { now: 30, max: 30 } }), one({ hp: { now: 11, max: 11 } }, 2)], [foe('minion', { hp: { now: 20, max: 20 } })])
    const ctx = ctxOf(a)
    expect(amount(ctx, 'hp_max')).toBe(30)
    expect(amount({ ...ctx, unit: a.ally(2) }, 'hp_max')).toBe(11)
    expect(amount({ ...ctx, unit: a.ally(2) }, 'half_hp_max_up')).toBe(6)
    expect(amount({ ...ctx, unit: a.ally(2) }, 'half_hp_max_down')).toBe(5)
    const bare = { ...a.ally(1), hp: undefined, load: undefined } as unknown as BattleUnit
    expect(amount({ ...ctx, unit: bare }, 'hp_max')).toBe(0)
    expect(amount({ ...ctx, unit: bare }, 'load_max')).toBe(0)
    expect(amount({ ...ctx, unit: bare }, 'half_load_max_up')).toBe(0)
  })

  it('spent、tier 沒給是 0；grade 沒給用這場戰鬥的等級，給了用給的（0015 第一節）', () => {
    const a = three()
    const ctx = ctxOf(a)
    expect(amount(ctx, 'spent')).toBe(0)
    expect(amount(ctx, 'tier')).toBe(0)
    expect(amount(ctx, 'half_tier_up')).toBe(0)
    expect(amount(ctx, 'grade')).toBe(a.battle.grade)
    expect(amount({ ...ctx, n: { grade: 3, spent: 4, tier: 3 } }, 'grade + spent*2 + half_tier_up')).toBe(3 + 8 + 2)
  })

  it('骰數是名字（spent、tier）時，骰數 0 或負的就一顆骰都不擲（不吃亂數）；有幾顆擲幾顆（0015 第一節）', () => {
    const a = three()
    const run = a.run(dice(4, 5, 6))
    const ctx = { run, user: a.ally(1), n: { spent: 0, tier: 2 } } as Parameters<typeof amount>[0]
    expect(amount(ctx, 'spentd6')).toBe(0)
    expect(amount(ctx, 'tierd6')).toBe(9)
    expect(amount({ ...ctx, n: { spent: -3 } }, 'spentd6')).toBe(0)
  })

  it('skill:<id> 做的人沒有那一項基本功是 0；mod:<屬性> 單位沒寫那個屬性當 10（修正 0）', () => {
    const a = three([one({ skills: { firearms: 3 } })])
    const run = a.run(dice())
    const u = { ...a.ally(1), attrs: {} } as unknown as BattleUnit
    expect(amount({ run, user: a.ally(1), n: {} }, 'skill:firearms*2')).toBe(6)
    expect(amount({ run, user: a.ally(1), n: {} }, 'skill:hacking')).toBe(0)
    expect(amount({ run, user: u, n: {} }, 'mod:resolve + 2')).toBe(2)
  })

  it('公式的錯誤路徑：* 後面不是整數、空的、超過一個 *、不認得的項、空字串都回傳寫出原因的訊息；amount 對壞公式丟錯', () => {
    expect(amountProblems('2*x').join()).toMatch(/要是整數，不是 x/)
    expect(amountProblems('2*').join()).toMatch(/不是 空的/)
    expect(amountProblems('2*3*4').join()).toMatch(/只能乘一個整數/)
    expect(amountProblems('foo').join()).toMatch(/不認得的項 foo/)
    expect(amountProblems('1++2').join()).toMatch(/不認得的項 （空的）/)
    expect(amountProblems('  ').join()).toMatch(/是空的/)
    expect(amountProblems(Number.NaN)).toEqual(['數量要是有限的數字'])
    expect(amountProblems(Number.POSITIVE_INFINITY)).toEqual(['數量要是有限的數字'])
    expect(amountProblems({})).toEqual(['數量要是數字，或是公式（字串）'])
    expect(amountProblems('0d6').join()).toMatch(/骰數要在 1～100/)
    expect(amountProblems('1d1').join()).toMatch(/骰面要在 2～1000/)
    expect(amountProblems('skill:1x').join()).toMatch(/基本功 id 不對/)
    expect(amountProblems('mod:luck').join()).toMatch(/不認得屬性 luck/)
    const a = three()
    expect(() => amount({ run: a.run(), user: a.ally(1), n: {} }, 'foo')).toThrow(/不認得的項/)
    expect(amount({ run: a.run(), user: a.ally(1), n: {} }, 7.5)).toBe(7.5)
  })
})

// =====================================================================================================================
// who 的解析（dev/adr/0015 第一節 runEffects）
// =====================================================================================================================

describe('白箱 who 的解析與 runEffects 的退路（dev/adr/0015 第一節）', () => {
  /** 測試用的效果 mark：記下每一次落在誰（人或一台）身上。 */
  const spy = (a: Arena): string[] => {
    const hits: string[] = []
    a.k.battle.effect('mark', 'test', (ctx) => { hits.push(ctx.unit?.id ?? ctx.overlay?.id ?? '-') })
    return hits
  }

  it('adjacent：做的人不在場上（第 0 格）時沒有相鄰的人；在場時是站位差 1 的隊友（不含自己）；near 是自己加相鄰', () => {
    const a = three()
    const hits = spy(a)
    const run = a.run(dice())
    a.ally(2).slot = 0
    run.effects([{ op: 'mark', who: 'adjacent' }], { user: a.ally(2), source: SRC })
    expect(hits).toEqual([])
    a.ally(2).slot = 2
    run.effects([{ op: 'mark', who: 'adjacent' }], { user: a.ally(2), source: SRC })
    expect(hits).toEqual(['a1', 'a3'])
    hits.length = 0
    run.effects([{ op: 'mark', who: 'near' }], { user: a.ally(2), source: SRC })
    expect(hits).toEqual(['a2', 'a1', 'a3'])
  })

  it('target 為 { overlay } 指到不存在的一台、或為一格、或沒有目標：落在「沒有人也沒有一台」上，效果函式照樣被叫一次（由效果自己決定要不要做）', () => {
    const a = three()
    const hits = spy(a)
    a.battle.overlays.push(overlay('o1', 'foe', 2))
    const run = a.run(dice())
    const u = a.ally(1)
    run.effects([{ op: 'mark' }], { user: u, source: SRC, target: { overlay: 'o1' } })
    run.effects([{ op: 'mark' }], { user: u, source: SRC, target: { overlay: 'ghost' } })
    run.effects([{ op: 'mark' }], { user: u, source: SRC, target: { side: 'foe', slot: 1 } })
    run.effects([{ op: 'mark' }], { user: u, source: SRC })
    expect(hits).toEqual(['o1', '-', '-', '-'])
  })

  it('slot：目標是一個人、一台掛著的東西、一格都落在那一格上的人；指到不存在的人、或那一格沒人，整筆不做', () => {
    const a = three()
    const hits = spy(a)
    a.battle.overlays.push(overlay('o1', 'foe', 3))
    const run = a.run(dice())
    const u = a.ally(1)
    for (const target of [{ unit: 'f2' }, { overlay: 'o1' }, { side: 'foe', slot: 1 }, { unit: 'nobody' }, { overlay: 'ghost' }, { side: 'foe', slot: 4 }]) {
      run.effects([{ op: 'mark', who: 'slot' }], { user: u, source: SRC, target: target as never })
    }
    run.effects([{ op: 'mark', who: 'slot' }], { user: u, source: SRC })
    expect(hits).toEqual(['f2', 'f3', 'f1'])
  })

  it('area：目標那一格加 pick.also 那一格（要是 1～4 的整數、不是同一格）上的人，再接掛著的東西（先人後掛著的）；also 不合格就只打那一格', () => {
    const a = three()
    const hits = spy(a)
    a.battle.overlays.push(overlay('o2', 'foe', 2), overlay('o9', 'foe', 1, { down: true }))
    const run = a.run(dice())
    const u = a.ally(1)
    const area = (also: unknown, target: unknown = { side: 'foe', slot: 1 }): string[] => {
      hits.length = 0
      run.effects([{ op: 'mark', who: 'area' }], { user: u, source: SRC, target: target as never, pick: { also } })
      return [...hits]
    }
    expect(area(2)).toEqual(['f1', 'f2', 'o2'])
    expect(area(1)).toEqual(['f1'])
    expect(area(0)).toEqual(['f1'])
    expect(area(5)).toEqual(['f1'])
    expect(area(1.5)).toEqual(['f1'])
    expect(area('2')).toEqual(['f1'])
    expect(area(undefined, { unit: 'f2' })).toEqual(['f2', 'o2'])
    expect(area(undefined, { overlay: 'o2' })).toEqual(['f2', 'o2'])
    // 目標指到不存在的東西、或沒有目標：整筆不做
    expect(area(2, { unit: 'ghost' })).toEqual([])
    expect(area(2, { overlay: 'ghost' })).toEqual([])
    hits.length = 0
    run.effects([{ op: 'mark', who: 'area' }], { user: u, source: SRC })
    expect(hits).toEqual([])
  })

  it('foe_overlay：pick.overlay 可以寫 id 或 { overlay: id }；寫了卻不是敵方沒被擊落的一台整筆不做（不退回別台）；沒選用目標那台、再沒有用格子最小的', () => {
    const a = three()
    const hits = spy(a)
    a.battle.overlays.push(overlay('o3', 'foe', 3), overlay('o2', 'foe', 2), overlay('o1', 'foe', 1, { down: true }), overlay('m1', 'ally', 1))
    const run = a.run(dice())
    const u = a.ally(1)
    const pick = (p: Rec, target?: unknown): string[] => {
      hits.length = 0
      run.effects([{ op: 'mark', who: 'foe_overlay' }], { user: u, source: SRC, pick: p, ...(target ? { target: target as never } : {}) })
      return [...hits]
    }
    expect(pick({ overlay: 'o3' })).toEqual(['o3'])
    expect(pick({ overlay: { overlay: 'o3' } })).toEqual(['o3'])
    expect(pick({ overlay: 'o1' })).toEqual([])
    expect(pick({ overlay: 'm1' })).toEqual([])
    expect(pick({ overlay: 7 })).toEqual([])
    expect(pick({ overlay: { overlay: 7 } })).toEqual([])
    expect(pick({}, { overlay: 'o3' })).toEqual(['o3'])
    expect(pick({}, { overlay: 'o1' })).toEqual(['o2'])
    expect(pick({}, { unit: 'f1' })).toEqual(['o2'])
    expect(pick({})).toEqual(['o2'])
    a.battle.overlays = a.battle.overlays.filter((o) => o.side !== 'foe')
    expect(pick({})).toEqual([])
    // foe_overlays：一台都沒有就整筆不做
    hits.length = 0
    run.effects([{ op: 'mark', who: 'foe_overlays' }], { user: u, source: SRC })
    expect(hits).toEqual([])
  })

  it('attacker 與 victim 在沒有帶那個人的步驟裡丟錯，訊息說明「只有反應裡才有」；pick:<鍵> 可以指單位或掛著的東西，空的與不存在的跳過', () => {
    const a = three()
    const hits = spy(a)
    a.battle.overlays.push(overlay('o2', 'foe', 2))
    const run = a.run(dice())
    const u = a.ally(1)
    expect(() => run.effects([{ op: 'mark', who: 'attacker' }], { user: u, source: SRC })).toThrow(/who 寫 attacker，但這一步沒有帶攻擊的人/)
    expect(() => run.effects([{ op: 'mark', who: 'victim' }], { user: u, source: SRC })).toThrow(/沒有帶被打的人/)
    run.effects([{ op: 'mark', who: 'attacker' }, { op: 'mark', who: 'victim' }], { user: u, source: SRC, attacker: a.foe(1), victim: a.ally(3) })
    expect(hits).toEqual(['f1', 'a3'])
    hits.length = 0
    for (const v of ['f2', { unit: 'f3' }, 'o2', 'ghost', {}, 5, undefined]) run.effects([{ op: 'mark', who: 'pick:t' }], { user: u, source: SRC, pick: { t: v } })
    expect(hits).toEqual(['f2', 'f3', 'o2'])
  })

  it('不認得的 op、不合格的 who 與 if 在執行時丟錯（載入時由 effectProblems 先擋；這裡是最後一道）；if 不成立就跳過；一筆把 last.stop 設成 true，之後的不做', () => {
    const a = three()
    const hits = spy(a)
    a.k.battle.effect('halt', 'test', (ctx) => { ctx.last.stop = true })
    a.k.battle.effect('stop_after_first', 'test', (ctx) => { hits.push(`s:${ctx.unit!.id}`); ctx.last.stop = true })
    const run = a.run(dice())
    const u = a.ally(1)
    expect(() => run.effects([{ op: 'nope' }], { user: u, source: SRC })).toThrow(/不認得的效果 nope/)
    expect(() => run.effects([{ op: 7 }], { user: u, source: SRC })).toThrow(/不認得的效果 7/)
    expect(() => run.effects([{ op: 'mark', who: 'everyone' }], { user: u, source: SRC })).toThrow(/效果 mark：who「everyone」/)
    expect(() => run.effects([{ op: 'mark', if: 'maybe' }], { user: u, source: SRC })).toThrow(/效果 mark：if「maybe」/)
    run.effects([{ op: 'mark', if: 'hit' }, { op: 'mark', if: 'first_round', who: 'self' }, { op: 'mark', if: 'not_first_round', who: 'self' }], { user: u, source: SRC })
    expect(hits).toEqual(['a1'])
    const last = run.effects([{ op: 'mark', who: 'foes' }, { op: 'halt' }, { op: 'mark', who: 'self' }], { user: u, source: SRC })
    expect(last.stop).toBe(true)
    expect(hits).toEqual(['a1', 'f1', 'f2', 'f3'])
    // 落在好幾個人上時，中途設了 stop 就連剩下的人也不做
    hits.length = 0
    run.effects([{ op: 'stop_after_first', who: 'foes' }], { user: u, source: SRC })
    expect(hits).toEqual(['s:f1'])
  })

  it('一筆落在好幾台上，前面的一筆把後面的擊落了：已經擊落的不再做（掛著的東西被前面幾次擊落）', () => {
    const a = three()
    a.battle.overlays.push(overlay('o1', 'foe', 1), overlay('o2', 'foe', 2))
    const seen: string[] = []
    a.k.battle.effect('smash', 'test', (ctx) => {
      seen.push(ctx.overlay!.id)
      for (const o of a.battle.overlays) o.down = true
    })
    a.run(dice()).effects([{ op: 'smash', who: 'foe_overlays' }], { user: a.ally(1), source: SRC })
    expect(seen).toEqual(['o1'])
  })
})

// =====================================================================================================================
// 掛著的東西、攻擊的退路（COMBAT_SYSTEM 第 9 節；dev/adr/0015 第三節）
// =====================================================================================================================

describe('白箱 打掛著的東西的退路（run.attackOverlay／damageOverlay／standIn）', () => {
  const rig = () => {
    const a = three([one({ weapon: 'pistol', ap: { now: 9, max: 9, regen: 3 } }), one({}, 2)], [foe('minion', { hp: { now: 50, max: 50 } })])
    const o = overlay('o1', 'foe', 1, { hp: { now: 12, max: 12 }, armor: 0 })
    a.battle.overlays.push(o)
    return { a, o }
  }

  it('已經被擊落的一台：攻擊 aborted，不扣彈匣、不擲骰、不記任何拍（COMBAT_SYSTEM 9；dev/adr/0015 第三節）', () => {
    const { a, o } = rig()
    o.down = true
    const run = a.run(dice(15))
    const w = a.ally(1).weapons[0]!
    const mag = w.mag!.now
    const r = run.attackOverlay(a.ally(1), o)
    expect(r).toMatchObject({ aborted: true, hit: false, dealt: 0 })
    expect(w.mag!.now).toBe(mag)
    expect(run.beats).toHaveLength(0)
  })

  it('opts.spend 是 0 不耗彈；彈匣不會扣到負數；opts.hit 與 label 進命中的算式與那一句話（0015 第三節）', () => {
    const { a, o } = rig()
    const w = a.ally(1).weapons[0]!
    w.mag!.now = 0
    const run = a.run(dice(20, 2, 2, 2))
    const r = run.attackOverlay(a.ally(1), o, { spend: 0, hit: 3, label: '點射' })
    expect(w.mag!.now).toBe(0)
    expect(r.hit).toBe(true)
    const beat = run.beats.find((b) => b.tag === 'hit')!
    expect(beat.text).toContain('點射')
    expect(beat.roll!.parts.some((p) => p.label === '點射' && p.value === 3)).toBe(true)
    // 一次耗兩格、只剩一格：停在 0
    w.mag!.now = 1
    a.run(dice(20, 2, 2, 2)).attackOverlay(a.ally(1), { ...o, hp: { now: 99, max: 99 } } as BattleOverlay, { spend: 2 })
    expect(w.mag!.now).toBe(0)
  })

  it('自然 1 一定失手，話是「自然 1，失手」；擲不到迴避的普通失手是「沒打中」；沒帶武器丟錯（COMBAT_SYSTEM 6、9）', () => {
    const { a, o } = rig()
    o.evade = 40
    const run = a.run(dice(1, 5))
    expect(run.attackOverlay(a.ally(1), o)).toMatchObject({ hit: false, natural: 1 })
    expect(run.beats.at(-1)!.text).toContain('自然 1，失手')
    expect(run.attackOverlay(a.ally(1), o)).toMatchObject({ hit: false, natural: 5 })
    expect(run.beats.at(-1)!.text).toContain('沒打中')
    a.ally(1).weapons = []
    expect(() => a.run(dice()).attackOverlay(a.ally(1), o)).toThrow(/手上沒有武器/)
  })

  it('護甲高到把傷害吃光：話是「護甲擋下了這一擊」，耐久不變、不擊落；感載類的傷害對沒有橋的東西無效（COMBAT_SYSTEM 5、9）', () => {
    const { a, o } = rig()
    o.armor = 99
    const run = a.run(dice())
    expect(run.damageOverlay(o, 10, 'physical', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(run.beats.at(-1)!.text).toContain('護甲擋下了這一擊')
    expect(o.hp.now).toBe(12)
    expect(run.damageOverlay(o, 10, 'neural', a.ally(1))).toEqual({ dealt: 0, downed: false })
    expect(run.beats.at(-1)!.text).toContain('沒有橋')
    o.down = true
    const beats = run.beats.length
    expect(run.damageOverlay(o, 10, 'physical')).toEqual({ dealt: 0, downed: false })
    expect(run.beats).toHaveLength(beats)
  })

  it('替身（standIn）的傷害倍率：寫數字當生命的倍率；{ hp, load } 各自照寫；零、負、非數字一律當 1；沒寫是 1（run.ts standIn 的說明）', () => {
    const { a, o } = rig()
    const run = a.run(dice())
    const mult = (m: unknown) => run.standIn({ ...o, ext: { dmgMult: m } }).dmgMult
    expect(mult(2)).toEqual({ hp: 2, load: 1 })
    expect(mult({ hp: 3, load: 2 })).toEqual({ hp: 3, load: 2 })
    expect(mult({ hp: 0, load: -1 })).toEqual({ hp: 1, load: 1 })
    expect(mult({ hp: 'x' })).toEqual({ hp: 1, load: 1 })
    expect(mult(Number.NaN)).toEqual({ hp: 1, load: 1 })
    expect(mult(-4)).toEqual({ hp: 1, load: 1 })
    expect(mult('2')).toEqual({ hp: 1, load: 1 })
    expect(run.standIn({ ...o, ext: undefined }).dmgMult).toEqual({ hp: 1, load: 1 })
    // 替身不在 battle.units 裡、沒有 hp 與 load、狀態給不上去、推拉不動
    const s = run.standIn(o)
    expect(a.battle.units[s.id]).toBeUndefined()
    expect(run.isStandIn(s)).toBe(true)
    expect(run.applyStatus(s, 'suppressed')).toBe(false)
    expect(run.shift(s, 1)).toBe(false)
    expect(run.place(s, 2)).toBe(false)
    expect(run.overlayOfStandIn(s)).toBe(o)
    expect(run.overlayOfStandIn(a.ally(1))).toBeUndefined()
    expect(run.isStandIn(a.ally(1))).toBe(false)
  })
})

// =====================================================================================================================
// 遮蔽、救回來、狀態（COMBAT_SYSTEM 第 2 節；dev/adr/0015 第二節）
// =====================================================================================================================

describe('白箱 遮蔽升降、救回來、狀態的退路（run.ts）', () => {
  it('raiseCover 給 max：這一格的兩級耐久上限換成給的數字，耐久補滿到那一級的上限；levels 夾在 0～2；不存在的格什麼也不做（COMBAT_SYSTEM 2）', () => {
    const a = three()
    const run = a.run(dice())
    run.raiseCover('ally', 2, 1, [7, 33])
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 1, hp: 7, max: [7, 33] })
    run.raiseCover('ally', 2, 5, [7, 33])
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 2, hp: 33 })
    run.raiseCover('ally', 2, -9)
    expect(a.battle.cover.ally[1]).toMatchObject({ level: 0, hp: 0 })
    const beats = run.beats.length
    run.raiseCover('ally', 9, 1)
    run.lowerCover('ally', 9, 1)
    expect(run.beats).toHaveLength(beats)
  })

  it('lowerCover：本來就沒有遮蔽的不動；降到 0 讓站在那一格的人暴露；耐久回到新那一級的滿值（COMBAT_SYSTEM 2）', () => {
    const a = arena(duel([one()], [foe()], { ally: [2, 0, 0, 0], foe: [0, 0, 0, 0] }))
    const run = a.run(dice())
    const full = a.battle.cover.ally[0]!.hp
    run.hurtCover('ally', 1, 1)
    run.lowerCover('ally', 1, 1)
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 1 })
    expect(a.battle.cover.ally[0]!.hp).toBeGreaterThan(0)
    expect(a.battle.cover.ally[0]!.hp).toBeLessThan(full)
    run.lowerCover('ally', 1, 1)
    expect(a.battle.cover.ally[0]).toMatchObject({ level: 0, hp: 0 })
    const beats = run.beats.length
    run.lowerCover('ally', 1, 1)
    expect(run.beats).toHaveLength(beats)
  })

  it('revive：生命照給的數字夾在 1～上限；不是有限數（NaN、無限）當 1；不是倒下的人、戰鬥已經結束都回傳 false 不動狀態（dev/adr/0015 第二節）', () => {
    const a = three([one(), one({}, 2), one({}, 3)], [foe(), foe(), foe()])
    const run = a.run(dice())
    const u = a.ally(2)
    expect(run.revive(u, 5)).toBe(false)
    run.setOut(u, 'down')
    expect(u.out).toBe('down')
    expect(run.revive(u, Number.NaN)).toBe(true)
    expect(u.hp!.now).toBe(1)
    expect(u.out).toBeUndefined()
    expect(u.ap.now).toBe(0)
    run.setOut(u, 'down')
    run.revive(u, 9999)
    expect(u.hp!.now).toBe(u.hp!.max)
    run.setOut(u, 'down')
    run.revive(u, Number.POSITIVE_INFINITY)
    expect(u.hp!.now).toBe(1)
    run.setOut(u, 'down')
    run.revive(u, 0)
    expect(u.hp!.now).toBe(1)
    run.setOut(u, 'down')
    run.revive(u, 4.6)
    expect(u.hp!.now).toBe(5)
    run.finish('win', '測試')
    run.setOut(u, 'down')
    expect(run.revive(u, 5)).toBe(false)
  })

  it('revive 時場上已經滿了：排進後方等補位（reserve 最前面），話是「在後方等著補上來」（COMBAT_SYSTEM 1.2、dev/adr/0015 第二節）', () => {
    const a = arena(duel([one(), one({}, 2), one({}, 3), one({}, 4)], [foe()]))
    const run = a.run(dice())
    run.setOut(a.ally(2), 'down')
    run.settle()
    // 他倒下之後，那一格被別人占滿（測試硬塞一個站在場上的人）
    const filler = { ...structuredClone(a.ally(1)), id: 'filler', slot: 4 } as BattleUnit
    delete filler.out
    a.battle.units.filler = filler
    const onField = Object.values(a.battle.units).filter((u) => u.side === 'ally' && !u.out && u.slot >= 1)
    expect(new Set(onField.map((u) => u.slot)).size).toBe(onField.length)
    for (const s of [1, 2, 3, 4]) if (!onField.some((u) => u.slot === s)) { const x = { ...structuredClone(a.ally(1)), id: `pad${s}`, slot: s } as BattleUnit; delete x.out; a.battle.units[x.id] = x }
    expect(run.revive(a.ally(2), 6)).toBe(true)
    expect(a.battle.reserve.ally[0]).toBe('a2')
    expect(a.ally(2).slot).toBe(0)
    expect(run.beats.at(-1)!.text).toContain('在後方等著補上來')
  })

  it('removeStatus：失去回合的狀態安靜地拿掉（不記「結束了」）；一般狀態安靜與否照 quiet；沒有的狀態回傳 false（COMBAT_SYSTEM 4）', () => {
    const a = three()
    const run = a.run(dice())
    const u = a.ally(1)
    expect(run.removeStatus(u, 'suppressed')).toBe(false)
    run.applyStatus(u, 'lose_turn', { force: true })
    const n = run.beats.length
    expect(run.removeStatus(u, 'lose_turn')).toBe(true)
    expect(run.beats).toHaveLength(n)
  })

  it('save 沒給基本功就只算屬性的修正；給了 bonus 的帶一條「反應」；回傳 ok 與完整的檢定（CORE_RULES 4）', () => {
    const a = three()
    const run = a.run(dice(10))
    const r = run.save(a.ally(1), 'resolve', undefined, 5, '定力', [], [], undefined)
    expect(r.roll.parts.map((p) => p.source)).toEqual(['attr'])
    expect(r.ok).toBe(true)
    const r2 = a.run(dice(2)).save(a.ally(1), 'resolve', 'composure', 30, '定力')
    expect(r2.ok).toBe(false)
    expect(r2.roll.parts.map((p) => p.source)).toContain('skill')
  })
})

// =====================================================================================================================
// 回合、一步、開打的退路（COMBAT_SYSTEM 1；dev/adr/0010、0014、0015 第一節的 round.start）
// =====================================================================================================================

describe('白箱 turn／step／setup 的退路', () => {
  const STATUS = [
    { id: 'stun', name: '擊暈', desc: '失去一個回合，沒有到期條件。', lose_turn: true, until: 'battle_end', kind: 'control' },
  ]
  const prep = (k: Kernel) => k.content.load('battle_status', STATUS)
  const field = (allies: unknown[] = [one()], foes: unknown[] = [foe()], features: Feature[] = [TEST_COMBAT], more: Parameters<typeof duel>[3] = {}) => arena(duel(allies, foes, undefined, more), features, prep)

  it('失去回合的狀態沒有到期條件（until battle_end）：用掉這一個回合就拿掉，不記「結束了」，下一回合照常動（COMBAT_SYSTEM 1.2、4；turn.ts beginTurn）', () => {
    const a = field()
    const run = a.run(dice())
    const me = a.ally(1)
    run.applyStatus(me, 'stun', { force: true })
    expect(me.statuses.map((s) => s.id)).toEqual(['stun'])
    expect(beginTurn(run, me)).toBe(false)
    expect(me.statuses).toEqual([])
    expect(tags(run)).toContain('turn.skip')
    expect(tags(run)).not.toContain('status.end')
    expect(beginTurn(run, me)).toBe(true)
  })

  it('在回合開始前就帶著的失去回合狀態才算用掉；回合進行中才給上去的（發作時剛過載）留到下一個回合（turn.ts 的 carried 的說明）', () => {
    const a = field()
    const run = a.run(dice())
    const me = a.ally(1)
    run.applyStatus(me, 'stun', { force: true })
    me.load!.now = 0
    // 先 begin 一次把現有的用掉，再給一個新的：新的在下一次 begin 時才是「帶著的」
    beginTurn(run, me)
    run.applyStatus(me, 'stun', { force: true })
    expect(me.statuses).toHaveLength(1)
    expect(beginTurn(run, me)).toBe(false)
    expect(me.statuses).toEqual([])
  })

  it('startRound 的 round.start 掛點一開打就把戰鬥結束了：setupBattle 直接回傳，不輪任何人（dev/adr/0015 第一節 round.start）', () => {
    const a = field([one()], [foe()], [TEST_COMBAT, { id: 'ender', install: (k) => k.battle.on('round.start', 'ender', ({ run }) => run.finish('win', '一開打就分出勝負')) }])
    expect(a.battle.result?.outcome).toBe('win')
    expect(a.battle.units.a1!.uses.turns).toBeUndefined()
    expect(a.battle.acting).toBeUndefined()
  })

  it('開場先攻最高的人就失去回合：往下輪到下一個能動的人（setup.ts 開打）', () => {
    const k = createKernel([TEST_COMBAT])
    k.content.load('battle_status', STATUS)
    const state = makeState()
    const setup = duel([one({ initBonus: 50, statuses: [{ id: 'stun', until: { at: 'battle_end' } }] }), one({}, 2)], [foe()])
    const b = setupBattle(k, state, setup).battle
    expect(b.order[0]).toBe('a1')
    expect(b.acting).toBeDefined()
    expect(b.acting).not.toBe('a1')
  })

  it('遮蔽逐格給：小數捨去、負的當 0、超過 2 當 2、沒給的格當 0（SITES 12.2 的格式；setup.ts coverRow）', () => {
    const a = arena(duel([one()], [foe()], { ally: [1.9, -3, 7], foe: [] }))
    expect(a.battle.cover.ally.map((c) => c.level)).toEqual([1, 0, 2, 0])
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([0, 0, 0, 0])
    expect(a.battle.cover.ally[2]!.hp).toBeGreaterThan(a.battle.cover.ally[0]!.hp)
  })

  it('一步裡做完行動自己倒下（反彈、自爆）而且還輪到他：直接往下輪，不等他再動（step.ts perform；COMBAT_SYSTEM 1.2）', () => {
    const suicide: Feature = {
      id: 'suicide', install: (k) => k.battle.action({
        id: 'blast', owner: 'suicide', name: '自爆', desc: '自己倒下。', group: 'tactic', icon: 'attack', target: 'none', order: 9,
        cost: () => ({ ap: 1 }), run: (run, u) => { run.setOut(u, 'down') },
      }),
    }
    const game = makeGame({ features: [TEST_COMBAT, suicide], content: [{ id: 'st', content: { battle_status: STATUS } }] as never }).game
    game.startBattle(duel([one({ initBonus: 50 }), one({}, 2)], [foe()]) as never)
    const first = game.state.battle!.units[game.state.battle!.order[game.state.battle!.turn]!]!
    expect(first.control).toBe('player')
    const draft = battleAct(game.k, game.state, { action: 'blast' } as never)
    const after = draft.changes.find((c) => c.op === 'battle') as { state: GameState['battle'] }
    expect(after.state!.units[first.id]!.out).toBe('down')
    expect(after.state!.acting).not.toBe(first.id)
  })

  it('行動花費裡有自己沒有的池：灰掉的原因說「不夠」並把現有量當 0（step.ts optionOf／poolShort）', () => {
    const odd: Feature = {
      id: 'odd', install: (k) => k.battle.action({
        id: 'odd', owner: 'odd', name: '怪招', desc: '要一個沒有的池。', group: 'tactic', icon: 'attack', target: 'none', order: 9,
        cost: () => ({ ap: 1, mana: 2 }), run: () => {},
      }),
    }
    const game = makeGame({ features: [TEST_COMBAT, odd] }).game
    game.startBattle(duel([one({ initBonus: 50 })], [foe()]) as never)
    const opts = battleOptions(game.k, game.state)!
    const o = opts.actions.find((x) => x.id === 'odd')!
    expect(o.ok).toBe(false)
    expect(o.blocks).toEqual(['mana不夠（要 2，現在 0）。'])
  })

  it('endBattle：結果名稱不在表裡就照原字；abortBattle：內海是 netrun、有地點時摘要帶地點（step.ts）', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    const s = clone(game.state)
    s.battle!.result = { outcome: 'draw', text: '雙方收手。' }
    expect(endBattle(game.k, s).outcome.summary).toMatch(/打了 1 回合，draw。雙方收手。/)
    const net = makeGame({ features: [TEST_COMBAT] }).game
    net.startBattle({ mode: 'net', grade: 1, allies: [raw(one({ hp: undefined }))], foes: [raw(foe('minion', { hp: undefined }))], cover: 'medium', origin: { place: '測試節點' } } as never)
    const d = abortBattle(net.k, net.state)
    expect(d.kind).toBe('netrun')
    expect(d.outcome.summary).toMatch(/^測試節點：和.*打到第 1 回合，沒有打完。$/)
  })

  it('pendingDefeat：快照上的 lost 缺 outcome 或 battle 時，補「lose」與空字串，不丟錯（dev/adr/0014）', () => {
    const state = makeState()
    state.snapshots.push({ id: 's1', kind: 'battle', data: { lost: {} } } as never)
    expect(pendingDefeat(state)).toEqual({ snapshot: 's1', battle: '', outcome: 'lose' })
    state.snapshots[0]!.data = { lost: 'nope' }
    expect(pendingDefeat(state)).toBeNull()
  })
})
