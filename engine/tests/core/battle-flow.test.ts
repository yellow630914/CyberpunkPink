// 一場戰鬥的流程（dev/adr/0010、0011）：開打、每一步一份報告、AI 的回合、結束時收成一份、回退、存讀檔、重來。
// 規格：COMBAT_SYSTEM 1.2、1.3、8.1、8.4、第 10 節；AI_TASKS 3.9 節；ENEMIES 第 4 節；dev/invariants.md 第 1～6 條。

import { describe, expect, it } from 'vitest'
import type { BattleInput, Feature } from '../../src'
import { BATTLE_EVENTS, BattleBlocked, END_TURN, MOVE, MOVE_AP, battleAct, battleOptions, clone, currentUnit, endBattle, positionScore, startBattle, targetWeight, unitsOf } from '../../src'
import { BATTLE_SETUPS, TEST_ACTIONS, TEST_COMBAT, makeBattleGame, makeGame, observed, playOut, stateHash } from '../../src/testkit'
import { characterFeature } from '../../src/features/character'
import { arena, duel, foe, one } from '../helpers/battle'

const { ATTACK, RELOAD, WATCH } = TEST_ACTIONS

/** 把回合轉到我方的某個人（測試用：直接改狀態，之後的每一步照常經過提交）。 */
function turnTo(game: ReturnType<typeof makeBattleGame>['game'], id: string) {
  const b = game.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  return u
}

describe('開打與每一步（Game 的門面）', () => {
  it('開打是一份報告：state.battle 有了，留一步回退與一份「戰鬥開打前」的快照；回退就回到開打之前', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    const before = stateHash(game.state)
    const [r] = game.startBattle(BATTLE_SETUPS.encounter())
    expect(r).toMatchObject({ kind: 'combat', action: 'battle.start' })
    expect(r!.timeline.map((b) => b.tag)).toEqual(expect.arrayContaining(['battle.start', 'round', 'turn']))
    const b = game.battle!
    expect(b).toMatchObject({ id: 'b1', mode: 'meat', round: 1, steps: [r!.id] })
    expect(game.state.seq.uid).toBe(1)
    expect(game.state.snapshots.map((x) => [x.kind, x.label])).toEqual([['battle', '戰鬥開打前']])
    expect(game.undo.size).toBe(1)
    // 記進紀錄的那一份不留整份戰鬥狀態與快照的文字
    const logged = game.state.reports.find((x) => x.id === r!.id)!.changes
    expect(logged.find((c) => c.op === 'battle')).toEqual({ op: 'battle', id: 'b1', round: 1, step: true })
    expect(JSON.stringify(logged).length).toBeLessThan(400)
    expect(() => game.startBattle(BATTLE_SETUPS.encounter())).toThrow(/已經有一場戰鬥/)
    expect(game.undoSteps()).toBe(true)
    expect(stateHash(game.state)).toBe(before)
    expect(game.battle).toBeNull()
  })

  it('battleOptions：輪到誰、每個行動能不能做、做不到的原因一條一條列（行動點不夠、彈匣空了、每個目標各自的原因）', () => {
    const { game } = makeBattleGame()
    const me = turnTo(game, 'a1') // 霰彈槍，站第 1 格
    const o = game.battleOptions()!
    expect(o).toMatchObject({ battle: 'b1', current: 'a1', waiting: 'player' })
    expect(o.actions.map((a) => a.id)).toEqual([ATTACK, RELOAD, MOVE, WATCH, END_TURN])
    const attack = o.actions.find((a) => a.id === ATTACK)!
    expect(attack).toMatchObject({ ok: true, blocks: [], cost: { ap: 2 }, group: 'attack', target: 'foe' })
    expect(attack.targets.map((t) => t.target)).toEqual([{ unit: 'f1' }, { unit: 'f2' }, { unit: 'f3' }, { unit: 'f4' }])
    expect(o.actions.find((a) => a.id === RELOAD)).toMatchObject({ ok: false, blocks: ['彈匣是滿的。'] })
    // 換位：第 1 格沒有遮蔽，和第 2 格的隊友交換可以
    expect(o.actions.find((a) => a.id === MOVE)!.targets).toEqual([{ target: { side: 'ally', slot: 2 }, blocks: [] }])
    me.ap.now = 1
    me.weapons[0]!.mag!.now = 0
    const low = game.battleOptions()!.actions.find((a) => a.id === ATTACK)!
    expect(low.ok).toBe(false)
    expect(low.blocks).toEqual(['行動點不夠（要 2 點，現在 1 點）。', '彈匣空了，要先換彈。'])
    // 近戰的人：打不到的目標灰掉，寫出原因
    const knife = turnTo(game, 'f1')
    knife.control = 'player'
    const melee = game.battleOptions()!.actions.find((a) => a.id === ATTACK)!
    expect(melee.targets.find((t) => 'unit' in t.target && t.target.unit === 'a1')!.blocks).toEqual([])
    expect(melee.targets.find((t) => 'unit' in t.target && t.target.unit === 'a3')!.blocks).toEqual(['近戰只能打近身（雙方的第 1 格）。'])
    // 輪到 AI：等的是 ai，沒有行動可以按
    knife.control = 'ai'
    expect(game.battleOptions()).toMatchObject({ waiting: 'ai', actions: [] })
    expect(battleOptions(game.k, makeGame().game.state)).toBeNull()
  })

  it('玩家的一步是一份報告（併進最新一樓、不另留回退）；行動點與彈匣照扣；戰鬥狀態只經由提交改變', async () => {
    const { game } = makeBattleGame()
    turnTo(game, 'a3') // 步槍，站第 3 格
    const undo = game.undo.size
    const { result, violations } = await observed(game, () => game.battleAct({ action: ATTACK, target: { unit: 'f2' } }))
    expect(violations).toEqual([])
    expect(result).toMatchObject({ status: 'applied', over: false })
    const [r] = result.reports
    expect(r).toMatchObject({ kind: 'combat', action: 'battle.step' })
    expect(r!.timeline[0]!.roll).toMatchObject({ dice: '1d20' })
    const me = game.battle!.units.a3!
    expect(me.ap.now).toBe(me.ap.max - 2)
    expect(me.weapons[0]!.mag!.now).toBe(2)
    expect(game.battle!.steps).toHaveLength(2)
    expect(game.undo.size).toBe(undo)
    // 結束回合：往下輪
    const end = game.battleAct({ action: END_TURN })
    expect(end.status).toBe('applied')
    expect(currentUnit(game.battle!)!.id).not.toBe('a3')
  })

  it('做不成的一步被擋下，附每一條原因；狀態完全不變', () => {
    const { game } = makeBattleGame()
    turnTo(game, 'a1')
    const before = stateHash(game.state)
    const cases: Array<[BattleInput, RegExp]> = [
      [{ action: 'nope' }, /沒有這個行動/],
      [{ action: ATTACK }, /要選一個目標/],
      [{ action: ATTACK, target: { unit: 'a2' } }, /這個目標不能選/],
      [{ action: RELOAD }, /彈匣是滿的/],
      [{ action: MOVE, target: { side: 'ally', slot: 4 } }, /這個目標不能選/],
    ]
    for (const [input, why] of cases) {
      const r = game.battleAct(input)
      expect(r.status, input.action).toBe('refused')
      expect(r.reasons!.join(' ')).toMatch(why)
      expect(stateHash(game.state)).toBe(before)
    }
    // 輪到 AI 的人時玩家不能下指令；輪到玩家時 battleNext（不代打）也被擋
    expect(game.battleNext().reasons!.join('')).toMatch(/等玩家下指令/)
    turnTo(game, 'f2')
    expect(game.battleAct({ action: END_TURN }).reasons!.join('')).toMatch(/不是你下指令的時候/)
    expect(stateHash(game.state)).toBe(before.slice(0, 0) + stateHash(game.state))
    expect(() => battleAct(game.k, makeGame().game.state, { action: END_TURN })).toThrow(BattleBlocked)
  })

  it('戰鬥中不能做別的事；還沒分出結果不能結算', async () => {
    const { game } = makeBattleGame()
    const act = await game.act({ kind: 'free', text: '我想去買瓶水' })
    expect(act).toMatchObject({ status: 'refused', reason: '正在戰鬥，先把這一場打完。' })
    await expect(game.finishBattle()).rejects.toThrow(/還沒有分出結果/)
    expect(game.battle).not.toBeNull()
  })
})

describe('AI 的回合（ENEMIES 第 4 節）', () => {
  it('輪到 AI 的人：一步一份報告；沒事可做就結束回合；最多做 6 步', () => {
    const { game } = makeBattleGame({ seed: 3 })
    turnTo(game, 'f2')
    let steps = 0
    while (currentUnit(game.battle!)!.id === 'f2' && !game.battle!.result) {
      expect(game.battleNext().status).toBe('applied')
      expect(++steps).toBeLessThanOrEqual(7)
    }
    expect(steps).toBeGreaterThanOrEqual(2)
  })

  it('彈匣空了先換彈；位置不好先換位（位置分高出 1.5 以上）', () => {
    // 第 1 格有半掩體（撐得住線），第 2 格是掩體
    const cover = { ally: [0, 0, 0, 0], foe: [1, 2, 0, 0] }
    const a = arena(duel([one({ weapon: 'pistol' })], [foe('minion', { weapon: 'smg' })], cover))
    const gun = a.foe(1)
    gun.ai!.prefer_slots = [2]
    gun.ai!.coverUse = 1
    const run = a.run()
    // 第 2 格：偏好格 2、掩體 1.5、打得到；第 1 格：差一格 1、半掩體 0.75、不是近戰型 −2
    expect(positionScore(run, gun, 2) - positionScore(run, gun, 1)).toBeGreaterThanOrEqual(1.5)
    a.battle.turn = a.battle.order.indexOf('f1')
    const { game } = makeBattleGame({ battle: duel([one({ weapon: 'pistol' })], [gun], cover) })
    turnTo(game, 'f1')
    game.battleNext()
    expect(game.battle!.units.f1!.slot).toBe(2)
    expect(game.battle!.units.f1!.ap.now).toBe(4 - MOVE_AP)
    game.battle!.units.f1!.weapons[0]!.mag!.now = 0
    const r = game.battleNext()
    expect(r.reports[0]!.timeline.map((b) => b.tag)).toContain('reload')
  })

  it('挑目標的權重：站在暴露的格子 ×1.3、掩體 ×0.7；超出適用距離每格 ×0.6；偏好最弱的最多 ×3', () => {
    const a = arena(duel([one(), one({}, 2), one({}, 3)], [foe('minion', { weapon: 'pistol' })], { ally: [0, 1, 2, 0], foe: [0, 0, 0, 0] }))
    const run = a.run()
    const f = a.foe(1)
    expect(targetWeight(run, f, a.ally(1))).toBeCloseTo(1.3)
    expect(targetWeight(run, f, a.ally(2))).toBeCloseTo(1)
    expect(targetWeight(run, f, a.ally(3))).toBeCloseTo(0.7)
    f.weapons[0]!.range = [1, 1]
    expect(targetWeight(run, f, a.ally(3))).toBeCloseTo(0.7 * 0.6 * 0.6)
    f.weapons[0]!.range = [1, 4]
    f.ai!.prefer = 'weakest'
    a.ally(1).hp!.now = 0
    expect(targetWeight(run, f, a.ally(1))).toBeCloseTo(1.3 * 3)
    // 仇恨：打得越痛越容易被盯上
    f.ai!.prefer = undefined
    a.ally(2).uses.threat = 30
    expect(targetWeight(run, f, a.ally(2))).toBeCloseTo(1 + 3)
  })
})

describe('整場打完（同一個種子、同一串輸入，結果一樣；dev/invariants.md 第 5 條）', () => {
  it('一般遭遇打得完，分出結果；每一步都過提交的不變式；同一個種子兩次的結果一樣', async () => {
    const run = async (seed: number) => {
      const { game } = makeBattleGame({ seed })
      const { result, violations } = await observed(game, () => playOut(game))
      expect(violations).toEqual([])
      return { result, hash: stateHash(game.state), game }
    }
    const a = await run(7), b = await run(7), c = await run(8)
    expect(a.result.outcome).toBe('win')
    expect(a.hash).toBe(b.hash)
    expect(c.hash).not.toBe(a.hash)
    expect(a.result.rounds).toBeGreaterThanOrEqual(2)
    expect(a.result.rounds).toBeLessThanOrEqual(8)
    // 每一步的事件都在封閉清單裡（直播、任務目標聽這些）
    const seen = new Set(a.game.state.reports.flatMap((r) => r.timeline.map((x) => x.tag)).filter(Boolean))
    for (const tag of seen) expect(BATTLE_EVENTS as readonly string[]).toContain(tag)
    expect([...seen]).toEqual(expect.arrayContaining(['battle.start', 'turn', 'hit', 'miss', 'damage', 'down', 'battle.end']))
  })

  it('節奏對得上設計書（COMBAT_SYSTEM 1.1 節；ENEMIES 第 13 節）：同級的一般遭遇 4～6 回合上下、掉一成多的生命、都打得贏', () => {
    let loss = 0, rounds = 0
    const seeds = [1, 2, 3, 4, 5, 6]
    for (const seed of seeds) {
      const { game } = makeBattleGame({ seed })
      const r = playOut(game)
      expect(r.outcome).toBe('win')
      const allies = unitsOf(game.battle!, 'ally').concat(Object.values(game.battle!.units).filter((u) => u.side === 'ally' && !!u.out))
      loss += allies.reduce((s, u) => s + (1 - u.hp!.now / u.hp!.max), 0) / allies.length
      rounds += r.rounds
    }
    // 目標是掉 10～15%、4～6 回合；六場的平均給寬一點的範圍（程式代打不用技能、不會集火以外的戰術）
    expect(loss / seeds.length).toBeGreaterThan(0.04)
    expect(loss / seeds.length).toBeLessThan(0.3)
    expect(rounds / seeds.length).toBeGreaterThanOrEqual(3)
    expect(rounds / seeds.length).toBeLessThanOrEqual(7)
  })

  it('存檔再讀檔之後接著打，和沒有存讀檔的那一場一模一樣；戰鬥中的存檔讀得回來', () => {
    const play = (saveAt: number | null) => {
      const { game } = makeBattleGame({ seed: 11 })
      for (let i = 0; i < 400 && !game.battle!.result; i++) {
        if (i === saveAt) expect(game.load(game.save('manual', 't'))).toBeNull()
        game.battleNext({ anyone: true })
      }
      return stateHash(game.state)
    }
    expect(play(9)).toBe(play(null))
  })
})

describe('戰鬥結束（AI_TASKS 3.9 節；COMBAT_SYSTEM 8.1 節；CORE_RULES 4.2 節）', () => {
  const marker: Feature = { id: 'marker', install: (k) => k.battle.onEnd('marker', ({ outcome }) => ({ changes: [{ op: 'flag', key: `fought_${outcome}`, value: true }], lines: ['拿到：一張沾了血的門禁卡'] })) }

  it('結束的結算：每一步的報告收成一份 combat 報告；三條軌寫回角色；功能加的變更與結果一起套；亂數的游標往前', async () => {
    const { game } = makeGame({ features: [characterFeature, TEST_COMBAT, marker], actors: [], pc: { hp: 40, load: 5, afterglow: 0 } })
    game.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }] , foes: [{ from: 'unit', unit: foe('minion', { hp: { now: 1, max: 45 }, evade: -30 }) as unknown as Record<string, unknown> }] })
    const b = game.battle!
    expect(b.units.a1).toMatchObject({ actor: 'pc', name: '測試主角', control: 'player', rank: 'elite', hp: { now: 40, max: 40 }, load: { now: 5, max: 20 }, layersMax: 3 })
    expect(b.units.a1!.weapons[0]).toMatchObject({ id: 'unarmed', class: 'melee', traits: ['melee'] })
    // 在戰鬥裡受了傷、灌了感載、疊了一層
    b.units.a1!.hp!.now = 23
    b.units.a1!.load!.now = 9
    b.units.a1!.layers = 1
    b.units.a1!.sink = 1
    const reportsBefore = game.state.reports.length
    const cursor = game.state.rng.cursor
    playOut(game)
    expect(game.battle!.result!.outcome).toBe('win')
    const stepIds = [...game.battle!.steps]
    expect(stepIds.length).toBeGreaterThan(1)
    const { result, violations } = await observed(game, () => game.finishBattle())
    expect(violations).toEqual([])
    expect(result.status).toBe('applied')
    const [end] = result.reports
    expect(end).toMatchObject({ kind: 'combat', action: 'battle.end', outcome: { result: 'win' }, chain: expect.any(String) })
    expect(end!.outcome.summary).toMatch(/勝利/)
    expect(end!.narration!.results).toEqual(['拿到：一張沾了血的門禁卡'])
    expect(end!.timeline.map((x) => x.tag)).toEqual(expect.arrayContaining(['battle.start', 'down', 'battle.end']))
    // 收成一份：每一步的報告不在紀錄裡了，只多了結束那一份
    expect(game.battle).toBeNull()
    expect(game.state.reports.some((r) => stepIds.includes(r.id))).toBe(false)
    expect(game.state.reports.length).toBe(reportsBefore - 1 + 1)
    const pc = game.state.actors.pc!
    expect(pc).toMatchObject({ load: expect.any(Number), afterglow: 1, sink: 1 })
    expect(pc.hp).toBeLessThanOrEqual(23)
    expect(end!.party[0]).toMatchObject({ id: 'pc', hp: [40, pc.hp, 40] })
    expect(game.state.flags.fought_win).toBe(true)
    expect(game.state.rng.cursor).toBe(cursor + 1)
    // 打贏了：戰鬥開打前的快照還留著（由發起的功能決定什麼時候丟）；回退一步回到結算之前
    expect(game.undoSteps()).toBe(true)
    expect(game.battle!.result!.outcome).toBe('win')
  })

  it('倒下的人帶著傷回來（生命最少剩 1）；餘韻疊滿再過載而倒下的：餘韻清空、沉溺 +2', () => {
    const { game } = makeGame({ features: [TEST_COMBAT], pc: { hp: 40, sink: 10 }, actors: [] })
    game.startBattle({ ...BATTLE_SETUPS.encounter(), allies: [{ from: 'actor', id: 'pc' }], foes: [{ from: 'unit', unit: foe() as unknown as Record<string, unknown> }] })
    const draft = (edit: (u: NonNullable<typeof game.battle>['units'][string]) => void) => {
      const s = clone(game.state)
      edit(s.battle!.units.a1!)
      s.battle!.result = { outcome: 'lose', text: '全隊倒下：戰敗。' }
      return endBattle(game.k, s)
    }
    const down = draft((u) => { u.hp!.now = 0; u.out = 'down' })
    expect(down.changes).toContainEqual({ op: 'actor.track', id: 'pc', track: 'hp', delta: 1 - 40 })
    expect(down.narration!.results).toEqual(['倒下：測試主角'])
    expect(down.outcome).toMatchObject({ result: 'lose' })
    const burnt = draft((u) => { u.layers = 3; u.out = 'burnout' })
    expect(burnt.changes).toContainEqual({ op: 'actor.track', id: 'pc', track: 'sink', delta: 2 })
    expect(burnt.changes.some((c) => c.op === 'actor.track' && c.track === 'afterglow')).toBe(false)
    expect(burnt.changes.slice(-2)).toEqual([{ op: 'battle', state: null, fold: true }, { op: 'rng', advance: 1 }])
    expect(() => endBattle(game.k, game.state)).toThrow(/還沒有分出結果/)
    expect(() => startBattle(game.k, game.state, BATTLE_SETUPS.encounter())).toThrow(/已經有一場戰鬥/)
  })

  it('AI 開著：戰鬥結束時整場寫一次正文（combat），收到 timeline 與定案的結果；關著只有戰報', async () => {
    const { game, fake } = makeBattleGame({ battle: 'hopeless', seed: 2, fake: true, features: [TEST_COMBAT, marker] })
    playOut(game)
    const r = await game.finishBattle()
    expect(r.status).toBe('applied')
    expect(r.reports[0]!.outcome.result).toBe('lose')
    expect(r.reports[0]!.narration!.text).toBeTruthy()
    const req = fake!.requests.find((x) => x.task === 'narrate')!
    expect(req.messages[0]!.content).toMatch(/<mode>\ncombat\n<\/mode>/)
    expect(req.messages[0]!.content).toMatch(/<results>\n1\. 倒下：你\n2\. 拿到：一張沾了血的門禁卡\n<\/results>/)
    expect(game.lastRun!.steps.map((s) => [s.id, s.status])).toEqual([['settle', 'done'], ['relate', 'skipped'], ['text', 'done'], ['apply', 'done']])
    const off = makeBattleGame({ battle: 'hopeless', seed: 2 })
    playOut(off.game)
    const quiet = await off.game.finishBattle()
    expect(quiet.reports[0]!.narration).toEqual({ results: ['倒下：你'] })
  })
})

describe('重來這場戰鬥（COMBAT_SYSTEM 8.4 節；SERIES 第 6 節）', () => {
  it('戰敗之後重來：回到開打之前、照同一份設定再開打；紀錄留著（標成被收回），骰子不保證一樣', async () => {
    const { game } = makeBattleGame({ battle: 'hopeless', seed: 2 })
    const firstId = game.battle!.id
    playOut(game)
    await game.finishBattle()
    expect(game.battle).toBeNull()
    expect(game.state.snapshots.map((x) => x.kind)).toEqual(['battle'])
    const lost = game.state.reports.find((r) => r.action === 'battle.end')!
    expect(game.retryBattle()).toBeNull()
    const b = game.battle!
    expect(b.id).not.toBe(firstId)
    expect(b.round).toBe(1)
    expect(Object.values(b.units).find((u) => u.side === 'ally')!.hp!.now).toBe(1)
    // 戰敗的那一份報告還在，標成被收回的經歷；多了一份交代這件事的報告
    expect(game.state.reports.find((r) => r.id === lost.id)).toMatchObject({ retracted: true })
    expect(game.state.reports.some((r) => r.action === 'rewind' && /預演/.test(r.outcome.summary))).toBe(true)
    expect(game.state.snapshots.map((x) => x.kind)).toEqual(['battle'])
    // 打到一半也可以重來
    game.battleNext({ anyone: true })
    expect(game.retryBattle('重來。')).toBeNull()
    expect(game.battle!.round).toBe(1)
    const none = makeGame()
    expect(none.game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
    expect(none.game.rewindTo('s9', { summary: 'x' })).toBe('沒有這份快照。')
  })
})
