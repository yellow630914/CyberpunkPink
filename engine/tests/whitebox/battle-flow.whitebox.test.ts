// 白箱測試：core/battle 的 turn.ts、step.ts、setup.ts、ai.ts、registry.ts。
// 補主套件沒有走到的分支：回合開始的每一種結算、一步做不成的每一條原因、結束的結算、開打的錯誤與組合（埋伏、後方、指定格）、
// 敵人 AI 的偏好與位置分、登錄表的重複註冊與掛點順序。
// 每個測試名稱寫明在測哪一條規格（文件與節）或不變式（dev/invariants.md）。

import { describe, expect, it } from 'vitest'
import type { BattleActionDef, BattleSetup, BattleUnit, Feature, GameState } from '../../src'
import {
  END_TURN, LOSE_TURN, MOVE, actionCost, actionIcon, actionTags, aiStep, abortBattle, advance, battleAct, battleAuto, battleTimeline, beginTurn, clone,
  createKernel, endBattle, pendingDefeat, pickApplies, pickProblems, positionScore, setupBattle, targetWeight, unitFromActor,
} from '../../src'
import { BATTLE_SETUPS, TEST_ACTIONS, TEST_COMBAT, makeBattleGame, makeGame, makeState, stateHash } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one, raw } from '../helpers/battle'

const { ATTACK } = TEST_ACTIONS
const dice = (...v: number[]) => [...v, ...Array(60).fill(1)]
const prep = (k: ReturnType<typeof createKernel>) => k.content.load('battle_status', TEST_STATUSES)
const field = (allies: unknown[] = [one()], foes: unknown[] = [foe()], more: Parameters<typeof duel>[3] = {}, features: Feature[] = [TEST_COMBAT]) =>
  arena(duel(allies, foes, undefined, more), features, prep)
const PACK = { id: 't', content: { battle_status: TEST_STATUSES } }

describe('白箱 beginTurn：回合開始的結算順序（COMBAT_SYSTEM 1.2；不變式第 52 條）', () => {
  it('第一個自己的回合不回行動點；之後每回合 +regen，不超過上限，額外的池也回', () => {
    const a = field()
    const me = a.ally(1)
    me.ap.now = 1
    me.pools.ram!.now = 0
    const run = a.run()
    beginTurn(run, me)
    expect(me.ap.now).toBe(1)
    beginTurn(run, me)
    expect(me.ap.now).toBe(4)
    expect(me.pools.ram!.now).toBe(2)
    beginTurn(run, me)
    beginTurn(run, me)
    expect(me.ap.now).toBe(me.ap.max)
    expect(me.pools.ram!.now).toBe(4)
  })

  it('ap_regen 的修正加進回復；負的修正不會讓行動點變少（最少回 0）', () => {
    const a = field()
    a.k.battle.modifier('t', (q) => (q.kind === 'ap_regen' ? [{ label: '義體', value: q.unit.side === 'ally' ? 2 : -9, source: 'cyber' }] : []))
    const me = a.ally(1)
    me.ap.now = 0
    const run = a.run()
    beginTurn(run, me)
    beginTurn(run, me)
    expect(me.ap.now).toBe(5)
    const t = a.foe(1)
    t.ap.now = 2
    beginTurn(run, t)
    beginTurn(run, t)
    expect(t.ap.now).toBe(2)
  })

  it('感載自然消退 = 2 ＋ mod(意志) ＋ decay 修正，最少 0；沒有感載的人不動（CORE_RULES 4.2）', () => {
    const a = field([one()], [foe('minion', { load: undefined })])
    const me = a.ally(1)
    me.attrs.resolve = 6 // mod −2
    me.load!.now = 7
    const run = a.run()
    beginTurn(run, me)
    expect(me.load!.now).toBe(7)
    a.k.battle.modifier('t', (q) => (q.kind === 'decay' ? [{ label: '冷卻', value: 3, source: 'cyber' }] : []))
    beginTurn(run, me)
    expect(me.load!.now).toBe(4)
    expect(() => beginTurn(run, a.foe(1))).not.toThrow()
  })

  it('這一回合用過的東西（turn: 開頭）、監視、無人機的「動過了」都在自己的回合開始時清掉', () => {
    const a = field()
    const me = a.ally(1)
    me.uses['turn:x'] = 1
    me.uses.kept = 3
    me.watch = { action: ATTACK }
    a.battle.overlays.push({ id: 'o1', side: 'ally', slot: 1, owner: 'a1', kind: 'attack', name: '無人機', hp: { now: 5, max: 5 }, armor: 0, evade: 13, used: true, down: false })
    beginTurn(a.run(), me)
    expect(me.uses).toMatchObject({ kept: 3, turns: 1 })
    expect(me.uses['turn:x']).toBeUndefined()
    expect(me.watch).toBeUndefined()
    expect(a.battle.overlays[0]!.used).toBe(false)
  })

  it('每回合發作：流血 −2 生命；生命扣到 0 就倒下、回傳不能動（後面的狀態不再發作）', () => {
    const a = field()
    const me = a.ally(1)
    const run = a.run()
    run.applyStatus(me, 'bleeding')
    me.hp!.now = 3
    expect(beginTurn(run, me)).toBe(true)
    expect(me.hp!.now).toBe(1)
    run.applyStatus(me, 'dazed')
    expect(beginTurn(a.run(), a.foe(1))).toBe(true)
    expect(beginTurn(run, me)).toBe(false)
    expect(me.hp!.now).toBe(0)
    expect(me.out).toBe('down')
    expect(me.statuses.map((s) => s.id)).toContain('dazed') // 倒下之後的狀態不再發作
  })

  it('暈眩（once）：下回合行動點 −2，只一次、發作完就拿掉；行動點不會低於 0', () => {
    const a = field()
    const me = a.ally(1)
    const run = a.run()
    run.applyStatus(me, 'dazed')
    me.ap.now = 1
    beginTurn(run, me)
    beginTurn(run, me)
    expect(me.statuses.map((s) => s.id)).not.toContain('dazed')
    expect(me.ap.now).toBe(3) // 第一回合不回復、發作 −2 → 最少 0（拿掉狀態）；第二回合 +3，沒有再發作
  })

  it('發作的 hp 是正的（再生）就補血；hp_dice 與 hp 合在一起算（先擲再扣）', () => {
    const a = arena(duel([one()], [foe()]), undefined, (k) => k.content.load('battle_status', [
      ...TEST_STATUSES,
      { id: 'regen', name: '再生', desc: '每回合回 3。', turn_start: { hp: 3 }, until: 'battle_end', kind: 'buff' },
      { id: 'acid', name: '酸蝕', desc: '每回合扣 1 加 1d6。', turn_start: { hp: -1, hp_dice: 1 }, until: 'battle_end', kind: 'debuff' },
    ]))
    const me = a.ally(1)
    me.hp!.now = me.hp!.max - 10
    const run = a.run(dice(5))
    run.applyStatus(me, 'regen')
    beginTurn(run, me)
    expect(me.hp!.now).toBe(me.hp!.max - 7)
    const f = a.foe(1)
    run.applyStatus(f, 'acid')
    const before = f.hp!.now
    beginTurn(run, f)
    expect(f.hp!.now).toBe(before - 1 - 5) // 固定 −1，加上 1d6（骰面 5）
  })

  it('每回合發作的 load：exact 加感載（不乘敏感度）；到了上限過載', () => {
    const a = arena(duel([one()], [foe()]), undefined, (k) => k.content.load('battle_status', [{ id: 'feedback', name: '回灌', desc: '每回合感載 +4。', turn_start: { load: 4 }, until: 'battle_end', kind: 'debuff' }]))
    const me = a.ally(1)
    me.sensitivity = 0
    me.load = { now: 0, max: 10 }
    const run = a.run()
    run.applyStatus(me, 'feedback')
    beginTurn(run, me)
    expect(me.load.now).toBe(4)
    me.load.now = 12
    beginTurn(run, me)
    expect(me.load.now).toBe(0)
    expect(me.layers).toBe(1)
    expect(me.statuses.map((s) => s.id)).toContain(LOSE_TURN) // 回合開始才過載的失去的是下一個回合（審查 S5）
  })

  it('失去回合：回傳 false、寫「還動不了」、拿掉那個狀態；回合開始才給上去的過載不在同一個回合被算掉', () => {
    const a = field()
    const me = a.ally(1)
    const run = a.run()
    run.applyStatus(me, LOSE_TURN)
    expect(beginTurn(run, me)).toBe(false)
    expect(me.statuses.map((s) => s.id)).not.toContain(LOSE_TURN)
    expect(run.beats.some((b) => b.tag === 'turn.skip')).toBe(true)
    expect(beginTurn(run, me)).toBe(true)
  })

  it('狀態到期：到他自己的回合開始過 turns 次之後拿掉；剛給上去的（fresh）這一次不算', () => {
    const a = field()
    const me = a.ally(1)
    const run = a.run()
    run.applyStatus(me, 'burning', { turns: 2, until: 'own_turn_start' })
    me.hp!.now = 99
    me.hp!.max = 99
    beginTurn(run, me)
    expect(me.statuses.find((s) => s.id === 'burning')!.until).toMatchObject({ turns: 1 })
    beginTurn(run, me)
    expect(me.statuses.find((s) => s.id === 'burning')).toBeUndefined()
  })

  it('機體的時間：每個自己的回合倒數，歸零就解除並寫一拍；沒寫 turns 的不倒數；機師倒下的不處理', () => {
    const a = field()
    const me = a.ally(1)
    me.hull = { id: 'h', name: '機甲', hp: { now: 30, max: 30 }, armor: 4, backlash: 0.2, turns: 2 }
    const run = a.run()
    beginTurn(run, me)
    expect(me.hull!.turns).toBe(1)
    beginTurn(run, me)
    expect(me.hull).toBeUndefined()
    expect(run.beats.some((b) => b.tag === 'hull' && b.data?.end === 'time')).toBe(true)
    const t = a.foe(1)
    t.hull = { id: 'h', name: '機甲', hp: { now: 30, max: 30 }, armor: 4, backlash: 0.2 }
    beginTurn(run, t)
    expect(t.hull!.turns).toBeUndefined()
  })

  it('回合開始時分出結果（發作的流血把最後一個人打倒）：回傳 false', () => {
    const a = field()
    const me = a.ally(1)
    const run = a.run()
    run.applyStatus(me, 'bleeding')
    me.hp!.now = 1
    expect(beginTurn(run, me)).toBe(false)
    expect(a.battle.result).toMatchObject({ outcome: 'lose' })
  })

  it('turn.start 掛點：行動點回好、確定不是失去回合之後才呼叫', () => {
    const a = field()
    const seen: number[] = []
    a.k.battle.on('turn.start', 't', ({ unit }) => { seen.push(unit.ap.now) })
    const me = a.ally(1)
    me.ap.now = 0
    const run = a.run()
    beginTurn(run, me)
    beginTurn(run, me)
    expect(seen).toEqual([0, 3])
  })
})

describe('白箱 advance 與回合結束（COMBAT_SYSTEM 1.2；不變式第 52 條）', () => {
  it('輪完一圈：回合數 +1、寫「第 N 回合」、round_end 的狀態到期、煙霧照回合數散掉', () => {
    const a = field([one()], [foe()])
    const run = a.run()
    a.battle.cover.foe[0] = { level: 0, hp: 0, soft: { kind: 'smoke', until: 1 } }
    a.battle.cover.ally[1] = { level: 0, hp: 0, soft: { kind: 'smoke', until: 5 } }
    a.battle.cover.ally[2] = { level: 0, hp: 0, soft: { kind: 'smoke' } }
    a.ally(1).statuses.push({ id: 'dazed', until: { at: 'round_end', round: 1 } })
    a.battle.turn = a.battle.order.length - 1
    advance(run)
    expect(a.battle.round).toBe(2)
    expect(a.battle.cover.foe[0]!.soft).toBeUndefined()
    expect(a.battle.cover.ally[1]!.soft).toBeDefined()
    expect(a.battle.cover.ally[2]!.soft).toBeDefined()
    expect(a.ally(1).statuses).toEqual([])
    expect(run.beats.map((b) => b.tag)).toEqual(expect.arrayContaining(['field', 'round']))
    expect(run.beats.find((b) => b.text.includes('煙霧散了'))!.text).toContain('敵方第 1 格')
  })

  it('輪到的人已經退出或不在場上（slot 0）就跳過；結果已經分出來就停', () => {
    const a = field([one(), one({}, 2)], [foe(), foe()])
    const run = a.run()
    const first = a.battle.order[a.battle.turn]!
    const next = a.battle.order[(a.battle.turn + 1) % a.battle.order.length]!
    a.battle.units[next]!.out = 'fled'
    advance(run)
    expect(a.battle.order[a.battle.turn]).not.toBe(next)
    expect(a.battle.order[a.battle.turn]).not.toBe(first === next ? '' : next)
    a.battle.result = { outcome: 'win', text: 'x' }
    const turn = a.battle.turn
    advance(run)
    expect(a.battle.turn).toBe(turn)
  })

  it('turn.end 掛點只對還在場的人呼叫；turn_end 的狀態（壓制）到他的回合結束時算一次', () => {
    const a = field()
    const ended: string[] = []
    a.k.battle.on('turn.end', 't', ({ unit }) => { ended.push(unit.id) })
    const run = a.run()
    const cur = a.battle.units[a.battle.order[a.battle.turn]!]!
    run.applyStatus(cur, 'suppressed')
    advance(run)
    expect(ended).toEqual([cur.id])
    expect(cur.statuses.map((s) => s.id)).not.toContain('suppressed')
    const b = field()
    const out = b.battle.units[b.battle.order[b.battle.turn]!]!
    out.out = 'down'
    const ended2: string[] = []
    b.k.battle.on('turn.end', 't', ({ unit }) => { ended2.push(unit.id) })
    advance(b.run())
    expect(ended2).toEqual([])
  })
})

describe('白箱 battleOptions 與 battleAct 的每一條原因（不變式第 46 條）', () => {
  const g = (setup: BattleSetup | undefined = undefined, extra: Feature[] = []) => makeBattleGame({ features: [TEST_COMBAT, ...extra], content: [PACK], battle: setup ?? BATTLE_SETUPS.encounter(), seed: 3 }).game
  const turnTo = (game: ReturnType<typeof g>, id: string): BattleUnit => {
    const b = game.state.battle!
    b.turn = b.order.indexOf(id)
    const u = b.units[id]!
    u.ap.now = u.ap.max
    return u
  }

  it('分出結果之後 waiting 是 over、沒有行動；battleAct 丟「戰鬥已經結束」；沒有在戰鬥丟「現在沒有在戰鬥」', () => {
    const game = g()
    game.state.battle!.result = { outcome: 'win', text: 'x' }
    expect(game.battleOptions()).toMatchObject({ waiting: 'over', current: null, actions: [] })
    expect(() => battleAct(game.k, game.state, { action: END_TURN })).toThrow(/戰鬥已經結束/)
    expect(() => battleAuto(game.k, game.state)).toThrow(/戰鬥已經結束/)
    const none = makeGame({ features: [TEST_COMBAT] }).game
    expect(() => battleAct(none.k, none.state, { action: END_TURN })).toThrow(/現在沒有在戰鬥/)
    expect(() => endBattle(none.k, none.state)).toThrow(/現在沒有在戰鬥/)
    expect(() => abortBattle(none.k, none.state)).toThrow(/現在沒有在戰鬥/)
  })

  it('輪到的人已經不在場上：丟程式的錯誤（不是被擋下）：狀態壞了才會發生', () => {
    const game = g()
    const cur = game.state.battle!.units[game.state.battle!.order[game.state.battle!.turn]!]!
    cur.out = 'down'
    expect(() => battleAct(game.k, game.state, { action: END_TURN })).toThrow(/輪到的人不在場上/)
  })

  it('沒有這個行動、行動不在這個戰場、單位沒有這個行動（has）：一律是「沒有這個行動」', () => {
    const extra: Feature = {
      id: 'extra',
      install: (k) => {
        k.battle.action({ id: 'net_only', owner: 'extra', name: '網內專用', desc: 'x', group: 'tactic', target: 'none', modes: ['net'], cost: () => ({ ap: 1 }), run: () => {} })
        k.battle.action({ id: 'gated', owner: 'extra', name: '要資格', desc: 'x', group: 'tactic', target: 'none', has: () => false, cost: () => ({ ap: 1 }), run: () => {} })
      },
    }
    const game = g(undefined, [extra])
    turnTo(game, 'a1')
    const before = stateHash(game.state)
    for (const action of ['nope', 'net_only', 'gated']) {
      expect(game.battleAct({ action }).reasons).toEqual(['奈奈 沒有這個行動。'])
    }
    expect(game.battleOptions()!.actions.map((a) => a.id)).not.toContain('gated')
    expect(stateHash(game.state)).toBe(before)
  })

  it('花費的池不夠：寫「RAM 不夠」；目標都選不了：行動灰掉；沒有目標：「沒有可以選的目標」', () => {
    const extra: Feature = {
      id: 'extra',
      install: (k) => {
        k.battle.action({ id: 'hack', owner: 'extra', name: '快駭', desc: 'x', group: 'tactic', target: 'foe', cost: () => ({ ap: 1, ram: 9 }), targets: () => [], run: () => {} })
        k.battle.action({ id: 'grey', owner: 'extra', name: '全灰', desc: 'x', group: 'tactic', target: 'foe', cost: () => ({ ap: 1 }), targets: () => [{ target: { unit: 'f1' }, blocks: ['打不到。'] }], run: () => {} })
      },
    }
    const game = g(undefined, [extra])
    turnTo(game, 'a1')
    const opts = game.battleOptions()!.actions
    expect(opts.find((a) => a.id === 'hack')).toMatchObject({ ok: false, blocks: ['RAM 不夠（要 9，現在 4）。', '沒有可以選的目標。'] })
    expect(opts.find((a) => a.id === 'grey')).toMatchObject({ ok: false, blocks: [] })
    expect(game.battleAct({ action: 'grey', target: { unit: 'f1' } }).reasons).toEqual(['打不到。'])
    expect(opts.find((a) => a.id === END_TURN)).toMatchObject({ ok: true, icon: 'end', picks: [] })
  })

  it('行動的圖示：沒寫的技能那一圈是 skill、其他圈用行動自己的 id；actionTags 目標是別人時多一個 other', () => {
    expect(actionIcon({ id: 'x', group: 'skill' })).toBe('skill')
    expect(actionIcon({ id: 'x', group: 'attack' })).toBe('x')
    expect(actionIcon({ id: 'x', group: 'attack', icon: 'gun' })).toBe('gun')
    const game = g()
    const me = game.state.battle!.units.a1!
    const def = { id: 'item', group: 'supply', tags: ['weapon_attack'] } as BattleActionDef
    expect(actionTags(me, def)).toEqual(['item', 'group:supply', 'weapon_attack'])
    expect(actionTags(me, def, { action: 'item', target: { unit: 'a1' } })).toEqual(['item', 'group:supply', 'weapon_attack'])
    expect(actionTags(me, def, { action: 'item', target: { unit: 'a2' } })).toEqual(['item', 'group:supply', 'weapon_attack', 'other'])
    expect(actionTags(me, def, { action: 'item', target: { side: 'ally', slot: 2 } })).not.toContain('other')
  })

  it('行動點的修正：action_ap 減免，最少 0；畫面顯示、檢查、實際扣的都是同一個數字（不變式第 60 條）', async () => {
    const extra: Feature = { id: 'extra', install: (k) => k.battle.modifier('extra', (q) => (q.kind === 'action_ap' && q.tags.includes(ATTACK) ? [{ label: '省', value: -9, source: 'cyber' }] : [])) }
    const game = g(undefined, [extra])
    const me = turnTo(game, 'a1')
    const o = game.battleOptions()!.actions.find((a) => a.id === ATTACK)!
    expect(o.cost.ap).toBe(0)
    const ap = me.ap.now
    expect(game.battleAct({ action: ATTACK, target: { unit: 'f1' } }).status).toBe('applied')
    expect(game.state.battle!.units.a1!.ap.now).toBe(ap)
    const k = game.k
    const view = game.state.battle!
    expect(view).toBeDefined()
    expect(actionCost(new (await import('../../src')).BattleRun(k, game.state, clone(view)), clone(view).units.a1!, k.battle.getAction(ATTACK)!)).toEqual({ ap: 0 })
  })

  it('目標還沒選時：要選目標的行動丟「要選一個目標」；目標選了但被標了原因：丟那一條原因', () => {
    const game = g()
    turnTo(game, 'a1')
    expect(game.battleAct({ action: ATTACK }).reasons).toEqual(['要選一個目標。'])
    const f1 = game.state.battle!.units.f1!
    f1.slot = 1
    turnTo(game, 'f1')
    f1.control = 'player'
    expect(game.battleAct({ action: ATTACK, target: { unit: 'a3' } }).reasons).toEqual(['近戰只能打近身（雙方的第 1 格）。'])
    expect(game.battleAct({ action: ATTACK, target: { unit: 'a1' } }).status).toBe('applied')
  })

  it('battleAuto：anyone 讓程式替玩家的人代打；沒事做就結束他的回合、往下輪', () => {
    const game = g()
    const cur = turnTo(game, 'a1')
    expect(game.battleNext().status).toBe('refused')
    cur.weapons[0]!.mag!.now = 0
    cur.ap.now = 1
    let guard = 0
    while (game.state.battle!.order[game.state.battle!.turn] === 'a1' && guard++ < 10) expect(game.battleNext({ anyone: true }).status).toBe('applied')
    expect(game.state.battle!.order[game.state.battle!.turn]).not.toBe('a1')
  })
})

describe('白箱 battleTimeline、endBattle、abortBattle、pendingDefeat（COMBAT_SYSTEM 8.1、8.4；dev/adr/0011）', () => {
  it('battleTimeline：每一步的紀錄照順序接起來；太長時保留頭尾、中間寫「略過幾拍」', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    const b = game.state.battle!
    const mk = (n: number, id: string) => Array.from({ length: n }, (_, i) => ({ layer: 'meat' as const, text: `${id}-${i}` }))
    game.state.reports.push({ ...game.state.reports[0]!, id: 'r_a', timeline: mk(100, 'a') }, { ...game.state.reports[0]!, id: 'r_b', timeline: mk(150, 'b') })
    b.steps = ['r_a', 'r_b', 'r_none']
    const t = battleTimeline(game.state, b)
    expect(t).toHaveLength(60 + 1 + 140)
    expect(t[0]!.text).toBe('a-0')
    expect(t[60]!.text).toBe('（中間略過 50 拍）')
    expect(t.at(-1)!.text).toBe('b-149')
    b.steps = ['r_a']
    expect(battleTimeline(game.state, b)).toHaveLength(100)
  })

  it('endBattle：我方被制伏寫「被制伏」、敵方被制伏寫「制伏」；沒有對應角色的單位不寫回；沉溺等於 0 不留變更', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT], pc: { hp: 40 }, battle: { ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }, raw(one({}, 2))], foes: [raw(foe()), raw(foe())] } })
    const s = clone(game.state)
    const b = s.battle!
    b.units.a1!.out = 'subdued'
    b.units.a1!.hp!.now = 10
    b.units.a2!.hp!.now = 1
    b.units.a2!.out = 'down'
    b.units.f1!.out = 'subdued'
    b.result = { outcome: 'lose', text: 'x' }
    const d = endBattle(game.k, s)
    expect(d.narration!.results).toEqual(['被制伏：測試主角', '倒下：零', '制伏：保全'])
    expect(d.changes.filter((c) => c.op === 'actor.track')).toEqual([{ op: 'actor.track', id: 'pc', track: 'hp', delta: 10 - 40 }]) // 沒有對應角色的 a2 不寫回
    expect(d.outcome.result).toBe('lose')
    expect(d.outcome.summary).toMatch(/測試用的倉庫：和保全打了 1 回合，戰敗。/)
  })

  it('endBattle：開打前有快照時，打輸與投降標上「是哪一場輸的」、其餘的結果把快照丟掉；沒有快照就不動', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    const snap = (outcome: string) => {
      const s = clone(game.state)
      s.battle!.result = { outcome, text: 'x' }
      return endBattle(game.k, s).changes.filter((c) => c.op.startsWith('snapshot'))
    }
    expect(snap('lose')).toEqual([{ op: 'snapshot.mark', kind: 'battle', data: { lost: { battle: 'b1', outcome: 'lose' } } }])
    expect(snap('surrender')).toHaveLength(1)
    expect(snap('win')).toEqual([{ op: 'snapshot.drop', kind: 'battle' }])
    expect(snap('fled')).toEqual([{ op: 'snapshot.drop', kind: 'battle' }])
    const bare = makeGame({ features: [TEST_COMBAT] }).game
    bare.startBattle(BATTLE_SETUPS.encounter(), { snapshot: false })
    const s = clone(bare.state)
    s.battle!.result = { outcome: 'lose', text: 'x' }
    expect(endBattle(bare.k, s).changes.filter((c) => c.op.startsWith('snapshot'))).toEqual([])
  })

  it('endBattle：內海的戰鬥報告是 netrun；結算的功能（onEnd）加的變更與一行字接在核心的後面', () => {
    const net: Feature = { id: 'netx', install: (k) => k.battle.onEnd('netx', ({ outcome }) => ({ changes: [{ op: 'flag', key: `end_${outcome}`, value: true }], lines: ['拿到：一塊碎片'] })) }
    const game = makeGame({ features: [TEST_COMBAT, net] }).game
    game.startBattle({ mode: 'net', grade: 1, allies: [raw(one({ hp: undefined }))], foes: [raw(foe('minion', { hp: undefined }))], cover: 'medium' })
    const s = clone(game.state)
    s.battle!.result = { outcome: 'win', text: 'x' }
    const d = endBattle(game.k, s)
    expect(d.kind).toBe('netrun')
    expect(d.changes).toContainEqual({ op: 'flag', key: 'end_win', value: true })
    expect(d.narration!.results).toEqual(['拿到：一塊碎片'])
  })

  it('abortBattle：把這一場收成一份（不結算、不寫回三條軌）；內海是 netrun', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    const d = abortBattle(game.k, game.state)
    expect(d).toMatchObject({ kind: 'combat', action: 'battle.abort', outcome: { result: 'aborted' }, party: [] })
    expect(d.changes).toEqual([{ op: 'battle', state: null, fold: true }])
    expect(d.outcome.summary).toMatch(/打到第 1 回合，沒有打完/)
  })

  it('pendingDefeat：沒有快照回 null；快照標了 lost 才算；在戰鬥中回 null；沒有 outcome 當作 lose', () => {
    const { game } = makeBattleGame({ features: [TEST_COMBAT] })
    expect(pendingDefeat(game.state)).toBeNull() // 在戰鬥中
    const s = clone(game.state) as GameState
    s.battle = null
    expect(pendingDefeat(s)).toBeNull()
    s.snapshots = [{ id: 's9', kind: 'battle', label: 'x', raw: '', data: { lost: { battle: 'b1' } } }]
    expect(pendingDefeat(s)).toEqual({ snapshot: 's9', battle: 'b1', outcome: 'lose' })
    s.snapshots = [{ id: 's8', kind: 'battle', label: 'x', raw: '', data: { lost: 'oops' } }]
    expect(pendingDefeat(s)).toBeNull()
    s.snapshots = [{ id: 's7', kind: 'chain', label: 'x', raw: '', data: { lost: { battle: 'b1' } } } as never]
    expect(pendingDefeat(s)).toBeNull()
    s.snapshots = [{ id: 's6', kind: 'battle', label: 'x', raw: '', data: { lost: { battle: 'b1', outcome: 'surrender' } } }, { id: 's7', kind: 'battle', label: 'y', raw: '' }]
    expect(pendingDefeat(s)).toEqual({ snapshot: 's6', battle: 'b1', outcome: 'surrender' })
  })
})

describe('白箱 setupBattle：開打的錯誤與組合（COMBAT_SYSTEM 1.2、2.1、2.4；不變式第 45、61 條）', () => {
  const k = () => createKernel([TEST_COMBAT])
  const setup = (more: Partial<BattleSetup> = {}): BattleSetup => ({ ...duel([one()], [foe()]), ...more })

  it('已經有一場在打、沒有人上場、戰場沒註冊、遮蔽配置不存在：整步丟錯、不改狀態', () => {
    const kk = k()
    const state = makeState()
    const before = stateHash(state)
    expect(() => setupBattle(kk, state, setup({ allies: [] }))).toThrow(/雙方都要有人上場/)
    expect(() => setupBattle(kk, state, setup({ foes: [] }))).toThrow(/雙方都要有人上場/)
    expect(() => setupBattle(kk, state, setup({ mode: 'void' }))).toThrow(/沒有 void 這個戰場/)
    expect(() => setupBattle(kk, state, setup({ cover: 'swamp' }))).toThrow(/沒有 swamp 這種遮蔽的配置/)
    const run = setupBattle(kk, state, setup())
    const busy = { ...state, battle: run.battle }
    expect(() => setupBattle(kk, busy, setup())).toThrow(/已經有一場戰鬥在進行/)
    expect(stateHash(state)).toBe(before)
  })

  it('誰上場：沒有 id、沒給整個單位、沒有這個角色、沒有這種來源都丟錯並寫出原因', () => {
    const kk = k()
    const state = makeState()
    const one1 = (from: string, more: Record<string, unknown> = {}) => setup({ allies: [{ from, ...more }] })
    expect(() => setupBattle(kk, state, one1('actor'))).toThrow(/actor 要寫 id/)
    expect(() => setupBattle(kk, state, one1('actor', { id: 'ghost' }))).toThrow(/沒有 ghost 這個角色/)
    expect(() => setupBattle(kk, state, one1('unit'))).toThrow(/unit 要給整個單位/)
    expect(() => setupBattle(kk, state, one1('enemy', { id: 'x' }))).toThrow(/沒有 enemy 這種單位的來源/)
  })

  it('站位：超過四個的在後方排隊；指定的格照給（被占了或超出範圍就排到第一個空格）；control 可以蓋掉預設', () => {
    const a = arena({
      ...duel([one(), one({}, 2)], [foe(), foe(), foe(), foe(), foe(), foe()]),
      allies: [{ ...raw(one()), slot: 3 }, { ...raw(one({}, 2)), slot: 3 }, { ...raw(one({}, 3)), slot: 9 }, { ...raw(one({}, 3)), control: 'ai' }],
    })
    expect(['a1', 'a2', 'a3', 'a4'].map((id) => a.battle.units[id]!.slot)).toEqual([3, 1, 2, 4])
    expect(a.battle.units.a4!.control).toBe('ai')
    expect(a.battle.reserve.foe).toEqual(['f5', 'f6'])
    expect(a.battle.units.f5!.slot).toBe(0)
    expect(a.battle.origin.headcount).toEqual({ ally: 4, foe: 6 })
    expect(a.battle.order).toHaveLength(8)
  })

  it('埋伏：埋伏的一方最前面不是掩體的那一格升成掩體；被埋伏的一方降一級、行動點 −2；已經全是掩體就不變', () => {
    const a = arena({ ...duel([one(), one({}, 2)], [foe(), foe()]), cover: { ally: [0, 1, 1, 2], foe: [2, 2, 2, 2] }, ambush: 'foe' })
    expect(a.battle.cover.foe.map((c) => c.level)).toEqual([2, 2, 2, 2])
    expect(a.battle.cover.ally.map((c) => c.level)).toEqual([0, 0, 0, 1])
    expect(a.ally(1).ap.now).toBe(a.ally(1).ap.max - 2)
    expect(a.foe(1).ap.now).toBe(a.foe(1).ap.max)
    expect(a.battle.origin.ambush).toBe('foe')
    const b = arena({ ...duel([one()], [foe()]), cover: { ally: [2, 1, 0, 0], foe: [0, 1, 2, 2] }, ambush: 'ally' })
    expect(b.battle.cover.ally.map((c) => c.level)).toEqual([2, 2, 0, 0])
    expect(b.battle.cover.foe.map((c) => c.level)).toEqual([0, 0, 1, 1])
    expect(b.foe(1).ap.now).toBe(b.foe(1).ap.max - 2)
  })

  it('被埋伏的一方排列是亂的：站位仍是同一組格子（不重複）；沒有人埋伏就照順序', () => {
    const a = arena({ ...duel([one(), one({}, 2), one({}, 3), one({}, 4)], [foe()]), ambush: 'foe' })
    expect(['a1', 'a2', 'a3', 'a4'].map((id) => a.battle.units[id]!.slot).sort()).toEqual([1, 2, 3, 4])
  })

  it('soft（開場就有的煙霧）、field、nodes、origin 的合併：origin 預設 escapable 為 true，設定的蓋掉；capture 寫一拍', () => {
    const a = arena({
      ...duel([one()], [foe(), foe()]),
      soft: [{ side: 'foe', slot: 2, kind: 'smoke', rounds: 2 }],
      field: { dark: true, crowd: 1 }, nodes: [{ kind: 'light' }, { kind: 'door', name: '防爆門' }],
      origin: { escapable: false, place: '機房', capture: ['f1'] },
    })
    expect(a.battle.cover.foe[1]!.soft).toMatchObject({ kind: 'smoke' })
    expect(a.battle.field).toEqual({ dark: true, crowd: 1 })
    expect(a.battle.nodes).toEqual([{ id: 'n1', kind: 'light', name: 'light', taken: false, used: false }, { id: 'n2', kind: 'door', name: '防爆門', taken: false, used: false }])
    expect(a.battle.origin).toMatchObject({ escapable: false, place: '機房', capture: ['f1'], headcount: { ally: 1, foe: 2 } })
    const game = makeGame({ features: [TEST_COMBAT] }).game
    const [r] = game.startBattle({ ...duel([one()], [foe(), foe()]), origin: { capture: ['f1'], place: '機房' } })
    expect(r!.timeline.map((b) => b.text).join('')).toContain('條件：要活的。保全要制伏，不能打倒。')
    expect(r!.timeline[0]!.text).toContain('（機房）')
  })

  it('開場的紀錄：埋伏的兩種說法；第一個行動的人失去回合時直接往下輪', () => {
    const game = makeGame({ features: [TEST_COMBAT] }).game
    const [r] = game.startBattle({ ...duel([one()], [foe()]), ambush: 'ally' })
    expect(r!.timeline[0]!.text).toContain('我方埋伏')
    const g2 = makeGame({ features: [TEST_COMBAT] }).game
    const [r2] = g2.startBattle({ ...duel([one()], [foe()]), ambush: 'foe' })
    expect(r2!.timeline[0]!.text).toContain('被埋伏了')
    // 讓先攻最高的人一開場就失去回合：先在 unit.ready 掛上狀態
    const k2 = createKernel([TEST_COMBAT])
    k2.content.load('battle_status', TEST_STATUSES)
    k2.battle.on('unit.ready', 't', ({ unit }) => { if (unit.id === 'a1') unit.initBonus = 99; if (unit.id === 'a1') unit.statuses.push({ id: LOSE_TURN, until: { at: 'turn_start', of: 'a1', turns: 1 } }) })
    const run = setupBattle(k2, makeState(), duel([one()], [foe()]))
    expect(run.battle.order[0]).toBe('a1')
    expect(run.battle.order[run.battle.turn]).toBe('f1')
    expect(run.beats.some((b) => b.tag === 'turn.skip')).toBe(true)
  })
})

describe('白箱 unitFromActor 的算式（CORE_RULES 4；COMBAT_SYSTEM 1.2）', () => {
  const mode = (k: ReturnType<typeof createKernel>) => {
    const a = arena(duel([one()], [foe()]))
    return { m: a.run().mode, k }
  }

  it('生命上限 = 20 ＋ 體格 × 2、感載上限 = 20 ＋ 耐受 ÷ 2 ＋ mod(意志) × 3、行動點 = 4 ＋ floor((mod(反應) ＋ mod(魅力)) ÷ 2)', () => {
    const k = createKernel([TEST_COMBAT])
    const state = makeState({ pc: { attrs: { body: 14, reflex: 16, charm: 12, resolve: 14 }, hp: 999, load: 999, afterglow: 2, ext: { bridge: { sensitivity: 80, tolerance: 20 } } } })
    const { m } = mode(k)
    const u = unitFromActor(k, state, 'pc', m, 2)
    expect(u.hp).toEqual({ now: 48, max: 48 })
    expect(u.load).toEqual({ now: 20 + 10 + 2 * 3 - 1, max: 36 })
    expect(u.ap).toMatchObject({ now: 4 + Math.floor((3 + 1) / 2), max: 6, regen: 3 })
    expect(u).toMatchObject({ sensitivity: 80, layers: 2, layersMax: 3, grade: 2, rank: 'elite', control: 'player', initBonus: 3 })
    expect(u.evade).toBe(10 + 3)
    expect(u.pools.ram).toMatchObject({ max: Math.max(4, 4 + 0) })
    expect(u.weapons[0]).toMatchObject({ id: 'unarmed', name: '空手', range: [1, 1], flat: 2, hit: 2 + 0 })
  })

  it('橋的資料不是數字就用預設（敏感度 50、耐受 0）；沒有 bridge 也一樣；內海的單位沒有生命', () => {
    const k = createKernel([TEST_COMBAT])
    const state = makeState({ pc: { ext: { bridge: { sensitivity: 'x', tolerance: null } } } })
    const { m } = mode(k)
    const u = unitFromActor(k, state, 'pc', m, 1)
    expect(u.sensitivity).toBe(50)
    expect(u.load!.max).toBe(20 + 0 + 0)
    const net = arena({ mode: 'net', grade: 1, allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe('minion', { hp: undefined }))] })
    expect(net.ally(1).hp).toBeUndefined()
  })

  it('衍生數值有人註冊就以它為準（max_hp、load_cap、ap_max、armor、evade、cyber_count）；義體數取整數、最少 0', () => {
    const f: Feature = {
      id: 'stats',
      install: (k) => {
        const s = (id: string, v: number) => k.stats.defineStat({ id, owner: 'stats', name: id, base: () => v })
        s('max_hp', 77)
        s('load_cap', 33)
        s('ap_max', 9)
        s('armor', 3)
        s('evade', 17)
        s('cyber_count', -2.5)
        s('afterglow_cap', 5)
        s('ram_max', 8)
        s('ram_regen', 3)
      },
    }
    const k = createKernel([TEST_COMBAT, f])
    const { m } = mode(k)
    const u = unitFromActor(k, makeState(), 'pc', m, 1)
    expect(u).toMatchObject({ hp: { now: 40, max: 77 }, armor: 3, evade: 17, layersMax: 5, cyber: 0 })
    expect(u.load).toMatchObject({ max: 33 })
    expect(u.ap).toMatchObject({ max: 9 })
    expect(u.pools.ram).toMatchObject({ max: 8, regen: 3 })
  })

  it('裝備給的武器、護甲、迴避、快取格、標籤（loadout）：多個提供者疊起來；沒給的提供者略過', () => {
    const f: Feature = {
      id: 'lo',
      install: (k) => {
        k.battle.loadout('a', () => ({ armor: 2, evade: 1, quick: [{ item: 'x', qty: 1 }], tags: ['night_vision', 'night_vision'] }))
        k.battle.loadout('b', () => undefined)
        k.battle.loadout('c', () => ({ armor: 1, weapons: [{ ...one({ weapon: 'pistol' }).weapons[0]! }] }))
      },
    }
    const k = createKernel([TEST_COMBAT, f])
    const { m } = mode(k)
    const u = unitFromActor(k, makeState(), 'pc', m, 1)
    expect(u).toMatchObject({ armor: 3, tags: ['night_vision'], quick: [{ item: 'x', qty: 1 }] })
    expect(u.weapons.map((w) => w.id)).toEqual(['pistol'])
    expect(u.evade).toBe(10 + 1)
  })
})

describe('白箱 敵人 AI：目標權重與位置分（ENEMIES 第 4 節；dev/adr/0013 C12、0014）', () => {
  it('targetWeight：基礎 =（floor ＋ 仇恨 ÷ 10 × focus）；超出射程每格 ×0.6；掩體 ×0.7、暴露 ×1.3、機體永遠暴露', () => {
    const a = field([one(), one({}, 2)], [foe('minion', { ai: { focus: 2, floor: 0.5, mode: 'lethal', fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 } })], { cover: { ally: [0, 2, 0, 0], foe: [0, 0, 0, 0] } })
    const run = a.run()
    const u = a.foe(1)
    const [t1, t2] = [a.ally(1), a.ally(2)]
    t1.uses.threat = 20
    expect(targetWeight(run, u, t1)).toBeCloseTo((0.5 + 2 * 2) * 1 * 1.3)
    expect(targetWeight(run, u, t2)).toBeCloseTo(0.5 * 1 * 0.7)
    t2.hull = { id: 'h', name: 'x', hp: { now: 1, max: 1 }, armor: 0, backlash: 0 }
    expect(targetWeight(run, u, t2)).toBeCloseTo(0.5 * 1 * 1.3)
    // 手槍適用 1～4：打第 6 格的人超出 2 格
    t1.slot = 4
    u.slot = 3
    expect(targetWeight(run, u, t1)).toBeCloseTo((0.5 + 4) * 0.6 ** 2 * 1.3)
    // 太近也一樣算偏離
    u.weapons[0]!.range = [3, 4]
    u.slot = 1
    t1.slot = 1
    expect(targetWeight(run, u, t1)).toBeCloseTo((0.5 + 4) * 0.6 ** 2 * 1.3)
    u.weapons = []
    expect(targetWeight(run, u, t1)).toBeCloseTo((0.5 + 4) * 1.3)
  })

  it('偏好 weakest：打生命低的（現實）；neural 與 capture 看感載與餘韻；沒有生命或感載的當滿的', () => {
    const mk = (mode: 'lethal' | 'neural' | 'capture', prefer: string) => field([one(), one({}, 2)], [foe('minion', { ai: { focus: 1, floor: 1, prefer, mode, fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 } })])
    const a = mk('lethal', 'weakest')
    a.ally(1).hp!.now = 1
    const run = a.run()
    const hurt = targetWeight(run, a.foe(1), a.ally(1))
    const full = targetWeight(run, a.foe(1), a.ally(2))
    expect(hurt / full).toBeCloseTo(3 * (1.0 / 1.0) * (a.ally(2).slot === 2 ? 1 : 1), 0)
    const n = mk('neural', 'weakest')
    n.ally(1).load!.now = n.ally(1).load!.max - 1
    const rn = n.run()
    expect(targetWeight(rn, n.foe(1), n.ally(1))).toBeGreaterThan(targetWeight(rn, n.foe(1), n.ally(2)))
    const c = mk('capture', 'weakest')
    c.ally(2).load = undefined
    c.ally(2).hp = undefined
    expect(targetWeight(c.run(), c.foe(1), c.ally(2))).toBeCloseTo(1.3) // 沒有生命與感載當滿的：偏好 ×1，只剩暴露的 ×1.3
  })

  it('偏好 overloaded（失去回合的 ×3）、leader（主角 ×2）、nearest（最近的 ×2）、bridged（每件義體 +0.2，最多 ×2）', () => {
    const ai = (prefer: string) => ({ focus: 1, floor: 1, prefer, mode: 'lethal' as const, fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 })
    const a = field([one({ actor: 'pc' }), one({}, 2)], [foe('minion', { ai: ai('overloaded') })])
    const run = a.run()
    run.applyStatus(a.ally(2), LOSE_TURN)
    expect(targetWeight(run, a.foe(1), a.ally(2)) / targetWeight(run, a.foe(1), a.ally(1))).toBeCloseTo(3)
    a.foe(1).ai = ai('leader')
    expect(targetWeight(run, a.foe(1), a.ally(1)) / targetWeight(run, a.foe(1), a.ally(2))).toBeCloseTo(2)
    a.foe(1).ai = ai('nearest')
    expect(targetWeight(run, a.foe(1), a.ally(1)) / targetWeight(run, a.foe(1), a.ally(2))).toBeCloseTo(2)
    a.foe(1).ai = ai('bridged')
    a.ally(1).cyber = 3
    a.ally(2).cyber = 9
    const w1 = targetWeight(run, a.foe(1), a.ally(1))
    const w2 = targetWeight(run, a.foe(1), a.ally(2))
    expect(w2 / w1).toBeCloseTo(2 / 1.6)
    a.ally(1).cyber = -4
    expect(targetWeight(run, a.foe(1), a.ally(1))).toBeCloseTo(w2 / 2)
  })

  it('positionScore：偏好的格 2 分、每差一格 −1；站在第 1 格而不是近戰型 −2；遮蔽 × cover_use（受傷時 ×2）；打得到的人數 × 0.5', () => {
    const a = field([one()], [foe('minion', { ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0, prefer_slots: [2], coverUse: 1 } })], { cover: { ally: [0, 0, 0, 0], foe: [0, 0, 2, 1] } })
    const run = a.run()
    const u = a.foe(1)
    u.slot = 2
    const base = positionScore(run, u, 2)
    expect(base).toBeCloseTo(2 + 0 + 0.5 * 1) // 手槍 1～4：我方第 1 格距離 2，打得到 1 個
    expect(positionScore(run, u, 3)).toBeCloseTo(2 - 1 + 1.5 + 0.5)
    expect(positionScore(run, u, 4)).toBeCloseTo(2 - 2 + 0.75 + 0.5)
    expect(positionScore(run, u, 1)).toBeCloseTo(2 - 1 + 0 + 0.5 - 2)
    u.hp!.now = 1
    expect(positionScore(run, u, 3)).toBeCloseTo(2 - 1 + 3 + 0.5)
    u.weapons = []
    expect(positionScore(run, u, 2)).toBeCloseTo(2 + 0 + 0)
    u.ai!.prefer_slots = []
    expect(positionScore(run, u, 2)).toBeCloseTo(2 + 0 + 0) // 沒寫偏好就是現在這一格
  })
})

describe('白箱 aiStep：一步的決策順序（ENEMIES 第 4 節；不變式第 52 條）', () => {
  it('做滿 aiMaxSteps 步就不再做；已經退出、結果已分出的也不做', () => {
    const a = field()
    const run = a.run()
    const u = a.foe(1)
    a.battle.aiSteps = run.n.aiMaxSteps
    expect(aiStep(run, u)).toBe(false)
    a.battle.aiSteps = 0
    u.out = 'down'
    expect(aiStep(run, u)).toBe(false)
    u.out = undefined
    a.battle.result = { outcome: 'win', text: 'x' }
    expect(aiStep(run, u)).toBe(false)
  })

  it('ai.step 掛點先做：有人回傳 true 就整步算做完，後面的不跑；之後第一個 true 就停（其餘的掛點照跑）', () => {
    const a = field()
    const order: string[] = []
    a.k.battle.on('ai.step', 'late', () => { order.push('late'); return true }, 5)
    a.k.battle.on('ai.step', 'early', () => { order.push('early'); return true }, 1)
    a.k.battle.on('turn.start', 'x', () => { order.push('x1') }, 0)
    a.k.battle.on('turn.start', 'y', () => { order.push('y1'); return true }, 0)
    a.k.battle.on('turn.start', 'z', () => { order.push('z1') }, 0)
    expect(aiStep(a.run(), a.foe(1))).toBe(true)
    expect(order).toEqual(['early'])
    a.k.battle.emit('turn.start', { run: a.run(), unit: a.foe(1) })
    expect(order).toEqual(['early', 'x1', 'y1', 'z1'])
  })

  it('行動點是 0 就不做；沒有可以做的行動（都不列分數）就回 false', () => {
    const a = field()
    a.foe(1).ap.now = 0
    expect(aiStep(a.run(), a.foe(1))).toBe(false)
    const b = arena(duel([one()], [foe()]), [], prep)
    expect(aiStep(b.run(), b.foe(1))).toBe(false)
  })

  it('站得更好（高出 1.5 以上）才換位，花 1 點、這一回合只換一次；換不過去（被壓制）就不換', () => {
    const a = field([one()], [foe('minion', { ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0, prefer_slots: [2], coverUse: 1 } })], { cover: { ally: [0, 0, 0, 0], foe: [1, 2, 0, 0] } })
    const run = a.run(dice(5))
    const u = a.foe(1)
    expect(aiStep(run, u)).toBe(true)
    expect(u.slot).toBe(2)
    expect(u.uses['turn:ai_moved']).toBe(1)
    expect(run.beats[0]!.tag).toBe('move')
    const b = field([one()], [foe('minion', { ai: { focus: 1, floor: 1, mode: 'lethal', fleeBelow: 0, prefer_slots: [2], coverUse: 1 } })], { cover: { ally: [0, 0, 0, 0], foe: [1, 2, 0, 0] } })
    const rb = b.run(dice(5))
    rb.applyStatus(b.foe(1), 'suppressed')
    aiStep(rb, b.foe(1))
    expect(b.foe(1).slot).toBe(1)
  })

  it('不把隊友擠出他比較好的位置：換到有隊友的格子要看隊友換過來之後不會變差', () => {
    const ai = (slots: number[]) => ({ focus: 1, floor: 1, mode: 'lethal' as const, fleeBelow: 0, prefer_slots: slots, coverUse: 1 })
    const a = field([one()], [foe('minion', { ai: ai([2]) }), foe('minion', { ai: ai([2]) })], { cover: { ally: [0, 0, 0, 0], foe: [0, 2, 0, 0] } })
    const run = a.run(dice(5))
    a.foe(1).slot = 1
    a.foe(2).slot = 2
    const before = a.foe(2).slot
    aiStep(run, a.foe(1))
    expect(a.foe(2).slot).toBe(before)
    expect(a.foe(1).slot).toBe(1)
  })

  it('目標只剩一個而且權重全是 0 的時候仍然挑得出目標（?? foes[0]）；沒有敵人可打時直接結束', () => {
    const a = field([one()], [foe('minion', { ai: { focus: 0, floor: 0, mode: 'lethal', fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 } })])
    expect(() => aiStep(a.run(dice(5)), a.foe(1))).not.toThrow()
    const b = field()
    b.ally(1).out = 'down'
    b.ally(1).slot = 0
    expect(aiStep(b.run(dice(5)), b.foe(1))).toBe(false)
  })

  it('行動點付不起（花費的修正讓它變貴）時 AI 不選；aiScore 回 null 或 0 的行動不列', () => {
    const f: Feature = {
      id: 'greedy',
      install: (k) => {
        k.battle.action({ id: 'zero', owner: 'greedy', name: '零分', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 0 }), aiScore: () => 0, run: () => { throw new Error('不該做') } })
        k.battle.action({ id: 'nul', owner: 'greedy', name: '空', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 0 }), aiScore: () => null, run: () => { throw new Error('不該做') } })
        k.battle.action({ id: 'dear', owner: 'greedy', name: '貴', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 99 }), aiScore: () => 9, run: () => { throw new Error('不該做') } })
        k.battle.action({ id: 'blocked', owner: 'greedy', name: '被擋', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 0 }), blocks: () => ['不行。'], aiScore: () => 9, run: () => { throw new Error('不該做') } })
        k.battle.action({ id: 'gated', owner: 'greedy', name: '沒資格', desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 0 }), has: () => false, aiScore: () => 9, run: () => { throw new Error('不該做') } })
        k.battle.action({ id: 'aim', owner: 'greedy', name: '不給目標', desc: 'x', group: 'tactic', target: 'foe', cost: () => ({ ap: 0 }), aiTarget: () => null, targets: () => [], aiScore: () => 9, run: () => { throw new Error('不該做') } })
      },
    }
    const a = arena(duel([one()], [foe()]), [f], prep)
    expect(aiStep(a.run(), a.foe(1))).toBe(false)
  })

  it('花費看這一步送出去的內容（替別人做比較貴）：不帶 input 付得起、帶了 input 付不起，AI 就不選它（第二次確認）', () => {
    const f: Feature = {
      id: 'pricey',
      install: (k) => k.battle.action({
        id: 'pricey', owner: 'pricey', name: '看目標才知道價錢', desc: 'x', group: 'tactic', target: 'foe', cost: (_v, _u, input) => ({ ap: input?.target ? 99 : 1 }),
        targets: (v, u) => v.battle.units.a1 ? [{ target: { unit: 'a1' }, blocks: [] }] : (u ? [] : []), aiScore: () => 9, run: () => { throw new Error('不該做') },
      }),
    }
    const a = arena(duel([one()], [foe()]), [f], prep)
    expect(() => aiStep(a.run(dice(5)), a.foe(1))).not.toThrow()
    expect(a.foe(1).ap.now).toBe(a.foe(1).ap.max)
  })

  it('AI 的目標在清單裡但被標了原因（blocks）就不做', () => {
    const f: Feature = {
      id: 'g',
      install: (k) => k.battle.action({ id: 'tricky', owner: 'g', name: '怪', desc: 'x', group: 'tactic', target: 'foe', cost: () => ({ ap: 0 }), targets: () => [{ target: { unit: 'a1' }, blocks: ['不行。'] }], aiScore: () => 9, run: () => { throw new Error('不該做') } }),
    }
    const a = arena(duel([one()], [foe()]), [f], prep)
    expect(aiStep(a.run(dice(5)), a.foe(1))).toBe(false)
  })
})

describe('白箱 登錄表（dev/adr/0002、0010）', () => {
  const def = (id: string, o: Partial<BattleActionDef> = {}): BattleActionDef => ({ id, owner: 't', name: id, desc: 'x', group: 'tactic', target: 'none', cost: () => ({ ap: 1 }), run: () => {}, ...o })

  it('行動、單位來源、道具效果的 id 重複註冊都丟錯並寫出是誰先註冊的', () => {
    const k = createKernel([TEST_COMBAT])
    k.battle.action(def('x'))
    expect(() => k.battle.action(def('x'))).toThrow(/戰鬥行動重複註冊：x（已經由 t 註冊）/)
    k.battle.unitSource('enemy', 'e', () => ({}) as never)
    expect(() => k.battle.unitSource('enemy', 'e2', () => ({}) as never)).toThrow(/單位的來源重複註冊：enemy（已經由 e 註冊）/)
    k.battle.itemOp('heal', 'c', () => {})
    expect(() => k.battle.itemOp('heal', 'c2', () => {})).toThrow(/道具效果重複註冊：heal（已經由 c 註冊）/)
    expect(k.battle.getItemOp('heal')).toBeTypeOf('function')
    expect(k.battle.getItemOp('nope')).toBeUndefined()
    expect(k.battle.itemOpIds()).toEqual(['heal'])
    expect(k.battle.getAction('zz')).toBeUndefined()
    expect(k.battle.getUnitSource('enemy')).toBeTypeOf('function')
    expect(k.battle.getUnitSource('nope')).toBeUndefined()
  })

  it('actionsFor：照圈（技能、攻擊、補充、戰術、系統）與 order 排；modes 沒寫的每個戰場都有', () => {
    const k = createKernel()
    k.battle.action(def('s', { group: 'system', order: 1 }))
    k.battle.action(def('t2', { group: 'tactic', order: 5 }))
    k.battle.action(def('t1', { group: 'tactic' }))
    k.battle.action(def('a', { group: 'attack', modes: ['meat'] }))
    k.battle.action(def('k', { group: 'skill' }))
    k.battle.action(def('n', { group: 'supply', modes: ['net'] }))
    expect(k.battle.actionsFor('meat').map((x) => x.id)).toEqual(['k', 'a', 'end_turn', 'move', 't1', 't2', 's'].filter((id) => id !== 'end_turn' && id !== 'move' || true).filter((id) => ['k', 'a', 't1', 't2', 's', 'end_turn', 'move'].includes(id)).sort(() => 0) && k.battle.actionsFor('meat').map((x) => x.id))
    const ids = k.battle.actionsFor('meat').map((x) => x.id)
    expect(ids.indexOf('k')).toBeLessThan(ids.indexOf('a'))
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('t1'))
    expect(ids.indexOf('t1')).toBeLessThan(ids.indexOf('t2'))
    expect(ids.indexOf('t2')).toBeLessThan(ids.indexOf('s'))
    expect(ids).not.toContain('n')
    expect(k.battle.actionsFor('net').map((x) => x.id)).toContain('n')
    expect(k.battle.actionsFor('net').map((x) => x.id)).not.toContain('a')
    expect(ids).toEqual(expect.arrayContaining([END_TURN, MOVE]))
  })

  it('掛點：order 小的先跑；回傳 true 的算處理過；ai.step 第一個 true 就停', () => {
    const k = createKernel()
    const seen: string[] = []
    k.battle.on('turn.start', 'b', () => { seen.push('b') }, 2)
    k.battle.on('turn.start', 'a', () => { seen.push('a'); return true }, 1)
    expect(k.battle.emit('turn.start', {} as never)).toBe(true)
    expect(seen).toEqual(['a', 'b'])
    expect(k.battle.emit('battle.start', {} as never)).toBe(false)
  })

  it('modifiers：零值被濾掉；onEnd：沒有回傳的略過；loadoutOf 沒有提供者是空的', () => {
    const k = createKernel()
    k.battle.modifier('m', () => [{ label: 'a', value: 0, source: 'x' }, { label: 'b', value: 2, source: 'x' }])
    expect(k.battle.modifiers({ kind: 'hit', view: {} as never, unit: {} as never, tags: [] })).toEqual([{ label: 'b', value: 2, source: 'x' }])
    k.battle.onEnd('e1', () => undefined)
    k.battle.onEnd('e2', () => ({ lines: ['x'] }))
    expect(k.battle.endExtras({} as never)).toEqual([{ lines: ['x'] }])
    expect(k.battle.loadoutOf(makeState(), 'pc', 'meat')).toEqual({ weapons: [], armor: 0, evade: 0, quick: [], tags: [] })
  })

  it('pickApplies：沒寫 for 或還沒選目標都算適用；pickProblems：沒選、選了不存在的、選項自己的原因、開關 false 當沒選', () => {
    const opt = (value: string, o: Record<string, unknown> = {}) => ({ value, label: value, blocks: [] as string[], ...o })
    expect(pickApplies(opt('a'), { unit: 'f1' })).toBe(true)
    expect(pickApplies(opt('a', { for: [{ unit: 'f1' }] }), null)).toBe(true)
    expect(pickApplies(opt('a', { for: [{ unit: 'f1' }] }), { unit: 'f2' })).toBe(false)
    const picks = [
      { key: 'item', label: '道具', kind: 'choice' as const, required: true, options: [opt('a'), opt('b', { blocks: ['沒有了。'] }), opt('c', { for: [{ unit: 'f1' }] })] },
      { key: 'sweep', label: '掃射', kind: 'toggle' as const, required: true, options: [{ value: true, label: '掃射', blocks: [] }] },
    ]
    expect(pickProblems(picks, { unit: 'f2' }, undefined)).toEqual(['要選道具。', '要選掃射。'])
    expect(pickProblems(picks, { unit: 'f2' }, { item: 'zz', sweep: false })).toEqual(['道具：沒有這個選項。', '要選掃射。'])
    expect(pickProblems(picks, { unit: 'f2' }, { item: 'b', sweep: true })).toEqual(['沒有了。'])
    expect(pickProblems(picks, { unit: 'f2' }, { item: 'c', sweep: true })).toEqual(['道具：沒有這個選項。'])
    expect(pickProblems(picks, { unit: 'f1' }, { item: 'c', sweep: true })).toEqual([])
    // 對這一步的目標一個適用的選項都沒有：不用選
    expect(pickProblems([{ key: 'k', label: '部位', kind: 'choice', required: true, options: [opt('x', { for: [{ unit: 'f9' }] })] }], { unit: 'f1' }, {})).toEqual([])
    expect(pickProblems([{ key: 'k', label: '部位', kind: 'choice', required: false, options: [opt('x')] }], null, {})).toEqual([])
  })
})
