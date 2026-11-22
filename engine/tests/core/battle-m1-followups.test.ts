// M1 第一波之後的核心修正（dev/adr/0014；審查 dev/reviews/2026-11-22-M1a.md 的 E1、E2、E4、E5、S2～S5、S7）。
// 只用核心與測試用的行動表（TEST_COMBAT）；功能那一側的對應測試在 tests/features/M1-picks.test.ts 與各功能自己的測試。

import { describe, expect, it } from 'vitest'
import type { BattleActionDef, BattleHookMap, BattlePick, BattleSetup, BattleUnit, ContentPack, Feature, ReportDraft, SpecialMapEntry } from '../../src'
import { ActionBlocked, BRIDGED_PER_PIECE, BattleRun, END_TURN, MOVE, MOVE_AP, REPOSITION_MARGIN, actionIcon, battleProblems, clone, fakeHeadline, otherSide, pickApplies, pickProblems, positionScore, targetWeight, unitsOf, unpackSave } from '../../src'
import { BATTLE_SETUPS, TEST_ACTIONS, TEST_COMBAT, makeBattleGame, makeGame, playOut, stateHash, testWeapon } from '../../src/testkit'
import { TEST_STATUSES, arena, duel, foe, one, raw } from '../helpers/battle'

const { ATTACK, RELOAD, WATCH } = TEST_ACTIONS
type G = ReturnType<typeof makeBattleGame>['game']
/** 把回合轉到某個人，行動點補滿（測試用：直接改狀態；之後的每一步照常經過提交）。 */
const turnTo = (g: G, id: string, control: 'player' | 'ai' = 'player'): BattleUnit => {
  const b = g.state.battle!
  b.turn = b.order.indexOf(id)
  const u = b.units[id]!
  u.ap.now = u.ap.max
  u.control = control
  return u
}
const opt = (g: G, id: string) => g.battleOptions()!.actions.find((a) => a.id === id)!
const STATUS_PACK: ContentPack = { id: 'followups', content: { battle_status: TEST_STATUSES } }

describe('每個行動都有圖示的鍵；要多選的東西用 picks 宣告（dev/adr/0014）', () => {
  /** 兩個測試用的行動：一個在技能那一圈、沒寫圖示；一個要多選兩樣東西。 */
  const DEMO: Feature = {
    id: 'pick_demo',
    install(k) {
      const base = { owner: 'pick_demo', cost: () => ({ ap: 1 }), run: () => {} } satisfies Partial<BattleActionDef>
      k.battle.action({ ...base, id: 'demo.skill', name: '技能', desc: '一個沒寫圖示的技能。', group: 'skill', target: 'none' })
      k.battle.action({ ...base, id: 'demo.plain', name: '戰術', desc: '一個沒寫圖示的戰術。', group: 'tactic', target: 'none', order: 8 })
      k.battle.action({
        ...base, id: 'demo.pick', name: '多選', desc: '要多選兩樣東西。', group: 'supply', icon: 'item', target: 'ally', order: 9,
        targets: (v, u) => unitsOf(v.battle, u.side).map((t) => ({ target: { unit: t.id }, blocks: [] })),
        picks: (v, u): BattlePick[] => [
          { key: 'what', label: '東西', kind: 'choice', required: true, options: [{ value: 'a', label: '甲', blocks: [] }, { value: 'b', label: '乙', blocks: ['乙用完了。'] }] },
          { key: 'at', label: '對誰', kind: 'foe', required: true, options: unitsOf(v.battle, otherSide(u.side)).map((t) => ({ value: t.id, label: t.name, blocks: [], at: { unit: t.id }, for: [{ unit: u.id }] })) },
          { key: 'loud', label: '大聲', kind: 'toggle', required: false, options: [{ value: true, label: '大聲', blocks: [] }] },
        ],
      })
    },
  }
  const start = () => makeBattleGame({ features: [TEST_COMBAT, DEMO], battle: duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], [foe(), foe()]) }).game

  it('battleOptions 的每個行動都帶 icon（字串）與 picks（陣列）；沒寫圖示的：技能那一圈是 skill，其他圈是行動自己的 id', () => {
    const g = start()
    turnTo(g, 'a1')
    const actions = g.battleOptions()!.actions
    for (const a of actions) {
      expect(typeof a.icon, a.id).toBe('string')
      expect(a.icon.length, a.id).toBeGreaterThan(0)
      expect(Array.isArray(a.picks), a.id).toBe(true)
    }
    expect(Object.fromEntries(actions.map((a) => [a.id, a.icon]))).toEqual({
      'demo.skill': 'skill', [ATTACK]: 'shoot', [RELOAD]: 'reload', 'demo.pick': 'item', [MOVE]: 'move', [WATCH]: 'watch', 'demo.plain': 'demo.plain', [END_TURN]: 'end',
    })
    expect(actionIcon({ id: 'x', group: 'skill' })).toBe('skill')
    expect(actionIcon({ id: 'x', group: 'attack' })).toBe('x')
    expect(actionIcon({ id: 'x', group: 'attack', icon: 'shoot' })).toBe('shoot')
    // 不用多選的行動是空的陣列；要多選的原樣交給畫面
    expect(opt(g, ATTACK).picks).toEqual([])
    expect(opt(g, 'demo.pick').picks.map((p) => [p.key, p.kind, p.required, p.options.length])).toEqual([['what', 'choice', true, 2], ['at', 'foe', true, 2], ['loud', 'toggle', false, 1]])
    expect(opt(g, 'demo.pick').picks[1]!.options[0]).toEqual({ value: 'f1', label: '保全', blocks: [], at: { unit: 'f1' }, for: [{ unit: 'a1' }] })
  })

  it('pickApplies、pickProblems：for 決定選項對哪些目標適用；一定要選的沒選、選了不存在的、選了灰掉的，各一句', () => {
    const g = start()
    turnTo(g, 'a1')
    const picks = opt(g, 'demo.pick').picks
    const at = picks[1]!.options[0]!
    expect(pickApplies(at, { unit: 'a1' })).toBe(true)
    expect(pickApplies(at, { unit: 'a2' })).toBe(false)
    // 還沒選目標：沒有東西可以把它排除，先算適用（畫面先列出全部）
    expect(pickApplies(at, null)).toBe(true)
    expect(pickProblems(picks, null, undefined)).toEqual(['要選東西。', '要選對誰。'])
    expect(pickApplies(picks[0]!.options[0]!, null)).toBe(true)
    // 目標是自己：兩項都要選
    expect(pickProblems(picks, { unit: 'a1' }, undefined)).toEqual(['要選東西。', '要選對誰。'])
    expect(pickProblems(picks, { unit: 'a1' }, { what: 'a', at: 'f2' })).toEqual([])
    // 目標是隊友：「對誰」沒有適用的選項，這一項不用選；硬選了就是不存在的選項
    expect(pickProblems(picks, { unit: 'a2' }, { what: 'a' })).toEqual([])
    expect(pickProblems(picks, { unit: 'a2' }, { what: 'a', at: 'f1' })).toEqual(['對誰：沒有這個選項。'])
    // 灰掉的選項：回它自己的原因；不存在的值；開關沒開（false）等於沒選
    expect(pickProblems(picks, { unit: 'a2' }, { what: 'b' })).toEqual(['乙用完了。'])
    expect(pickProblems(picks, { unit: 'a2' }, { what: 'z' })).toEqual(['東西：沒有這個選項。'])
    expect(pickProblems(picks, { unit: 'a2' }, { what: 'a', loud: false })).toEqual([])
    expect(pickProblems(picks, { unit: 'a2' }, { what: 'a', loud: true })).toEqual([])
  })

  it('功能裡的每一個 input.pick 的鍵都有宣告（掃原始碼：run 讀了、picks 沒寫，畫面就送不出來）', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(__dirname, '../../src')
    const files: string[] = []
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p) } }
    walk(join(root, 'features'))
    walk(join(root, 'core/battle'))
    walk(join(root, 'testkit'))
    const missing: string[] = []
    let seen = 0
    for (const file of files) {
      const text = readFileSync(file, 'utf-8')
      for (const m of text.matchAll(/pick\?\.([A-Za-z_]+)/g)) {
        seen += 1
        if (!new RegExp(`key: '${m[1]}'`).test(text)) missing.push(`${file.slice(root.length + 1)}：pick.${m[1]}`)
      }
    }
    expect(seen).toBeGreaterThan(5)
    expect(missing).toEqual([])
  })
})

describe('行動做完的掛點與花費的修正（action.done、action_ap；dev/adr/0014）', () => {
  /** 記下每一次 action.done 與每一次問 action_ap 時帶的東西。 */
  const spy = () => {
    const done: Array<BattleHookMap['action.done']> = []
    const asked: Array<{ tags: string[]; weapon?: string; base?: number }> = []
    const feature: Feature = {
      id: 'spy',
      install(k) {
        k.battle.on('action.done', 'spy', (p) => { done.push({ ...p, cost: { ...p.cost }, base: { ...p.base } }) })
        k.battle.modifier('spy', (q) => {
          if (q.kind !== 'action_ap') return []
          asked.push({ tags: q.tags, ...(q.weapon ? { weapon: q.weapon.class } : {}), ...(q.base !== undefined ? { base: q.base } : {}) })
          // 用帶 aimed 的武器攻擊一次少 1 點（看標籤與武器，不看行動的 id）
          return q.tags.includes('weapon_attack') && q.weapon?.traits.includes('aimed') ? [{ label: '測試', value: -1, source: 'skill' }] : []
        })
      },
    }
    return { done, asked, feature }
  }

  it('問花費時帶著行動的標籤（weapon_attack）、手上的武器、行動自己算的原價；看標籤與武器的減免不必認得行動的 id', () => {
    const s = spy()
    const g = makeBattleGame({ features: [TEST_COMBAT, s.feature], battle: duel([one({ weapon: 'sniper' }), one({ weapon: 'pistol' }, 2)], [foe()]) }).game
    turnTo(g, 'a1')
    s.asked.length = 0
    expect(opt(g, ATTACK).cost.ap).toBe(2) // 狙擊槍的一槍 3 點，減 1
    expect(opt(g, RELOAD).cost.ap).toBe(1) // 換彈不是用武器攻擊：不減
    expect(s.asked).toContainEqual({ tags: [ATTACK, 'group:attack', 'weapon_attack'], weapon: 'sniper', base: 3 })
    expect(s.asked).toContainEqual({ tags: [RELOAD, 'group:supply'], weapon: 'sniper', base: 1 })
    turnTo(g, 'a2')
    expect(opt(g, ATTACK).cost.ap).toBe(2) // 手槍沒有 aimed：照原價
  })

  it('玩家的一步與 AI 選的一步都發 action.done：行動的 id、標籤、實際扣的、原價、那一步用的武器；監視的自動攻擊與結束回合以外的反應不發', () => {
    const s = spy()
    const g = makeBattleGame({ features: [TEST_COMBAT, s.feature], battle: duel([one({ weapon: 'sniper' })], [foe()]), seed: 3 }).game
    const me = turnTo(g, 'a1')
    expect(g.battleAct({ action: ATTACK, target: { unit: 'f1' } }).status).toBe('applied')
    expect(g.battle!.units.a1!.ap.now).toBe(me.ap.max - 2)
    expect(s.done).toHaveLength(1)
    // 目標是自己以外的人：標籤多一個 other（核心原本的規矩）
    expect(s.done[0]).toMatchObject({ action: ATTACK, tags: [ATTACK, 'group:attack', 'weapon_attack', 'other'], target: { unit: 'f1' }, cost: { ap: 2 }, base: { ap: 3 }, weapon: { class: 'sniper' }, input: { action: ATTACK } })
    expect(s.done[0]!.unit.id).toBe('a1')
    // 監視：宣告的那一步發一次；觸發的自動攻擊不是花行動點的行動，不發
    turnTo(g, 'a1')
    g.state.battle!.units.a1!.weapons[0]!.mag!.now = 1
    expect(g.battleAct({ action: WATCH }).status).toBe('applied')
    expect(s.done.map((d) => d.action)).toEqual([ATTACK, WATCH])
    const run = new BattleRun(g.k, g.state, clone(g.state.battle!))
    run.exposed(run.unit('f1'))
    run.flushWatch()
    expect(run.beats.some((b) => b.tag === 'watch.fire')).toBe(true)
    expect(s.done.map((d) => d.action)).toEqual([ATTACK, WATCH])
    // AI 的一步
    turnTo(g, 'f1', 'ai')
    g.state.battle!.aiSteps = 0
    expect(g.battleNext().status).toBe('applied')
    expect(s.done.at(-1)).toMatchObject({ unit: { id: 'f1' } })
    expect(s.done.at(-1)!.tags).toContain(`group:${g.k.battle.getAction(s.done.at(-1)!.action)!.group}`)
  })
})

describe('敵人的 AI：位置分多一項、偏好 bridged（ENEMIES 4.1、4.2 節；dev/adr/0014、0013 C12）', () => {
  /** 一個「只有站在第 1 格才做得到」的行動：aiSlotScore 回 4，像制伏。 */
  const HOLD: Feature = {
    id: 'hold_test',
    install(k) {
      k.battle.action({
        id: 'test.grab', owner: 'hold_test', name: '抓', desc: '只有站在第 1 格才做得到。', group: 'tactic', target: 'none', order: 7,
        cost: () => ({ ap: 2 }),
        has: (_v, u) => !!u.ext.grabber,
        blocks: (_v, u) => (u.ext.tired ? ['累了。'] : []),
        run: (run, u) => run.say(`${u.name} 抓。`, 'subdue', { unit: u.id }, u),
        aiSlotScore: (_v, _u, slot) => (slot === 1 ? 4 : 0),
      })
    },
  }
  const field = (o: Parameters<typeof foe>[1] = {}) => arena(duel([one({ weapon: 'pistol' })], [foe('minion', { capture: true, ai: { focus: 1, floor: 1, mode: 'capture', fleeBelow: 0, prefer_slots: [2, 3], coverUse: 0.5 }, ...o })]), [TEST_COMBAT, HOLD])

  it('站在那一格才做得到的行動（aiSlotScore）加在那一格的位置分上；沒有這個行動、付不起、行動自己的條件沒過，就不加', () => {
    const plain = field()
    const base1 = positionScore(plain.run(), plain.foe(1), 1)
    const base2 = positionScore(plain.run(), plain.foe(1), 2)
    // 拿槍的人偏好第 2、3 格：沒有那個行動時，第 2 格比第 1 格高出 1.5 以上，會往後換
    expect(base2 - base1).toBeGreaterThanOrEqual(REPOSITION_MARGIN)
    const a = field({ ext: { grabber: true } })
    expect(positionScore(a.run(), a.foe(1), 1)).toBe(base1 + 4)
    expect(positionScore(a.run(), a.foe(1), 2)).toBe(base2)
    // 第 1 格現在不比第 2 格差到要換的程度：留在原地
    expect(positionScore(a.run(), a.foe(1), 2) - positionScore(a.run(), a.foe(1), 1)).toBeLessThan(REPOSITION_MARGIN)
    // 行動點不夠付（留在原地要 2 點；換過去再做要 2 ＋ 換位的 1 點）
    a.foe(1).ap.now = 1
    expect(positionScore(a.run(), a.foe(1), 1)).toBe(base1)
    a.foe(1).ap.now = 2
    a.foe(1).slot = 2
    expect(positionScore(a.run(), a.foe(1), 1)).toBe(positionScore(plain.run(), { ...plain.foe(1), slot: 2 }, 1))
    a.foe(1).ap.now = 2 + MOVE_AP
    expect(positionScore(a.run(), a.foe(1), 1)).toBe(positionScore(plain.run(), { ...plain.foe(1), slot: 2 }, 1) + 4)
    // 行動自己的條件沒過
    a.foe(1).slot = 1
    a.foe(1).ext.tired = true
    expect(positionScore(a.run(), a.foe(1), 1)).toBe(base1)
  })

  it('偏好 bridged：有義體的人依義體數 ×1～2（每一件 +0.2，五件以上 ×2）；沒寫義體數的是 ×1', () => {
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol', cyber: 2 }, 2), one({ weapon: 'pistol', cyber: 9 }, 3)], [foe('minion', { ai: { focus: 1, floor: 1, prefer: 'bridged', mode: 'lethal', fleeBelow: 0, prefer_slots: [1], coverUse: 0.5 } })]))
    const plain = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], [foe('minion')]))
    const w = (x: typeof a, id: number) => targetWeight(x.run(), x.foe(1), x.ally(id))
    expect(BRIDGED_PER_PIECE).toBe(0.2)
    expect(w(a, 1)).toBeCloseTo(w(plain, 1) * 1, 10)
    expect(w(a, 2)).toBeCloseTo(w(plain, 2) * 1.4, 10)
    expect(w(a, 3)).toBeCloseTo(w(plain, 3) * 2, 10)
  })

  it('角色的義體數來自衍生數值 cyber_count（義體的功能註冊之前沒有這個欄位，等於 0）', () => {
    const none = makeGame()
    none.game.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())] })
    expect(none.game.battle!.units.a1!.cyber).toBeUndefined()
    const CYBER: Feature = { id: 'cyber_test', install: (k) => k.stats.defineStat({ id: 'cyber_count', owner: 'cyber_test', name: '義體數', base: () => 3 }) }
    const some = makeGame({ features: [TEST_COMBAT, CYBER] })
    some.game.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe())] })
    expect(some.game.battle!.units.a1!.cyber).toBe(3)
  })
})

describe('行動點（COMBAT_SYSTEM 1.2 節）：上限照屬性，第一回合從上限開始，之後每回合回 3、不超過上限', () => {
  it('上限 = 4 ＋ floor((mod(反應) ＋ mod(魅力)) ÷ 2)：反應 16、魅力 16 的人是 7；第一回合 7／7 是對的，回 3 是之後每回合', () => {
    // 沒有功能註冊 ap_max 時核心照設計書的公式算（和 features/character 註冊的同一條）
    const { game } = makeGame({ features: [TEST_COMBAT], pc: { attrs: { reflex: 16, charm: 16 } } })
    game.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe('minion', { hp: { now: 999, max: 999 }, weapon: 'knife' }))] })
    const me = () => game.battle!.units.a1!
    const toMe = () => { for (let i = 0; i < 20 && game.battle!.order[game.battle!.turn] !== 'a1'; i++) game.battleNext() }
    expect(me().ap).toEqual({ now: 7, max: 7, regen: 3 })
    // 第一個自己的回合：從上限開始，不是 3
    toMe()
    expect(me().ap.now).toBe(7)
    // 用掉 4 點（兩次攻擊）之後結束回合；輪回來時回 3 點：3 ＋ 3 = 6
    expect(game.battleAct({ action: ATTACK, target: { unit: 'f1' } }).status).toBe('applied')
    expect(game.battleAct({ action: ATTACK, target: { unit: 'f1' } }).status).toBe('applied')
    expect(me().ap.now).toBe(3)
    game.battleAct({ action: END_TURN })
    toMe()
    expect(me().ap.now).toBe(6)
    // 這一回合什麼都不做：6 ＋ 3 超過上限，夾在 7
    game.battleAct({ action: END_TURN })
    toMe()
    expect(me().ap.now).toBe(7)
  })

  it('一般的角色（屬性都是 10）上限是 4；沒用完的留到下回合，不超過上限', () => {
    const { game } = makeGame({ features: [TEST_COMBAT] })
    game.startBattle({ allies: [{ from: 'actor', id: 'pc' }], foes: [raw(foe('minion', { weapon: 'knife', hp: { now: 999, max: 999 } }), 4)] })
    const me = () => game.battle!.units.a1!
    expect(me().ap).toEqual({ now: 4, max: 4, regen: 3 })
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 20 && game.battle!.order[game.battle!.turn] !== 'a1'; i++) game.battleNext()
      expect(me().ap.now).toBe(4)
      game.battleAct({ action: END_TURN })
    }
  })
})

describe('開打回傳 battle.start 的報告（畫面放進戰鬥紀錄）', () => {
  it('Game.startBattle 回傳的第一份報告是 battle.start：timeline 有開場、第 1 回合、輪到誰', () => {
    const { game } = makeGame()
    const reports = game.startBattle(BATTLE_SETUPS.encounter())
    expect(reports[0]).toMatchObject({ kind: 'combat', action: 'battle.start' })
    const tags = reports[0]!.timeline.map((b) => b.tag)
    expect(tags.slice(0, 2)).toEqual(['battle.start', 'round'])
    expect(tags).toContain('turn')
    expect(reports[0]!.timeline[0]!.text).toMatch(/^戰鬥開始/)
    // 這一份也記在這一場的 steps 裡：讀檔回來照它重建紀錄
    expect(game.battle!.steps).toEqual([reports[0]!.id])
  })
})

describe('假的服務商寫戰鬥的正文不會寫出 undefined（AI_TASKS 3.9 節）', () => {
  it('fakeHeadline：有什麼寫什麼。自由行動有 actor、action、degree；戰鬥結束只有 action 與 result', () => {
    expect(fakeHeadline({ actor: '露', action: '說服', degree: '成功' })).toBe('露說服，成功。')
    expect(fakeHeadline({ action: '戰鬥', outcome: 'win', result: '勝利' })).toBe('戰鬥，勝利。')
    expect(fakeHeadline({ action: '戰鬥', outcome: 'custom' })).toBe('戰鬥，custom。')
    expect(fakeHeadline({ action: '戰鬥' })).toBe('戰鬥。')
    expect(fakeHeadline({})).toBe('')
    expect(fakeHeadline(undefined)).toBe('')
    expect(fakeHeadline({ actor: 3, action: null, degree: {} })).toBe('')
  })

  it('戰鬥結束交給寫正文的報告帶著結果的名字；假的服務商寫出來的正文沒有 undefined', async () => {
    const { game, fake } = makeBattleGame({ fake: true, seed: 5 })
    const r = playOut(game)
    const end = await game.finishBattle()
    expect(end.status).toBe('applied')
    const text = end.reports[0]!.narration!.text!
    expect(text).not.toMatch(/undefined/)
    expect(text).toMatch(new RegExp(`^（假的服務商）戰鬥，${r.outcome === 'win' ? '勝利' : '戰敗'}。`))
    const req = fake!.requestsFor('narrate')[0]!
    expect(req.messages[0]!.content).toMatch(new RegExp(`"result": "${r.outcome === 'win' ? '勝利' : '戰敗'}"`))
  })
})

describe('士氣的分母：開打時記下每一方的人數（ENEMIES 4.4 節）', () => {
  it('origin.headcount 是開打時上場的加上在後方等的；之後不變', () => {
    const foes = [0, 1, 2, 3, 4, 5].map(() => foe())
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2)], foes))
    expect(a.battle.origin.headcount).toEqual({ ally: 2, foe: 6 })
    expect(a.battle.reserve.foe).toHaveLength(2)
    // 打倒一個、後方補上來：人數的紀錄不動
    const run = a.run()
    run.setOut(a.foe(1), 'down')
    run.settle()
    expect(a.battle.origin.headcount).toEqual({ ally: 2, foe: 6 })
    // 開打的設定自己帶的 headcount 不算數：一律照實際上場的人算
    const b = arena({ ...duel([one()], [foe(), foe()]), origin: { headcount: { ally: 9, foe: 9 } } } as BattleSetup)
    expect(b.battle.origin.headcount).toEqual({ ally: 1, foe: 2 })
  })
})

describe('E1：等著選的戰敗擋住別的事；開打前的快照在結果定案時丟掉（COMBAT_SYSTEM 8.3、8.4 節；不變式第 4、57、59 條）', () => {
  const lost = async (seed = 2) => {
    const t = makeBattleGame({ battle: 'hopeless', seed })
    playOut(t.game)
    await t.game.finishBattle()
    return t.game
  }
  const note = (action = 'test.note'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'noted', value: true }], outcome: { result: 'ok', summary: '記一筆。' } })
  const accept: ReportDraft = { kind: 'event', action: 'defeat.accept', location: {}, party: [], timeline: [], changes: [{ op: 'snapshot.drop', kind: 'battle' }], outcome: { result: 'accepted', summary: '接受結果。' } }

  it('打贏之後開打前的快照丟掉：不能再重來（不然就是沒有步數限制的回退）', async () => {
    const { game } = makeBattleGame({ seed: 5 })
    expect(game.state.snapshots.map((x) => x.kind)).toEqual(['battle'])
    expect(playOut(game).outcome).toBe('win')
    await game.finishBattle()
    expect(game.state.snapshots).toEqual([])
    expect(game.pendingDefeat).toBeNull()
    const before = stateHash(game.state)
    expect(game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
    expect(stateHash(game.state)).toBe(before)
    expect(game.battle).toBeNull()
  })

  it('脫離、功能自己的結果也算定案：快照丟掉', async () => {
    for (const outcome of ['fled', 'custom_end']) {
      const { game } = makeBattleGame({ seed: 5 })
      const b = clone(game.state.battle!)
      b.result = { outcome, text: '結束。' }
      game.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: outcome, summary: '結束。' } }, { attach: true, turn: false })
      await game.finishBattle()
      expect(game.state.snapshots, outcome).toEqual([])
      expect(game.pendingDefeat, outcome).toBeNull()
    }
  })

  it('打輸（或投降）之後：快照留著、標上是哪一場輸的，這段時間在等玩家三選一', async () => {
    const game = await lost()
    expect(game.state.snapshots.map((x) => [x.kind, x.data?.lost])).toEqual([['battle', { battle: 'b1', outcome: 'lose' }]])
    expect(game.pendingDefeat).toEqual({ snapshot: game.state.snapshots[0]!.id, battle: 'b1', outcome: 'lose' })
  })

  it('等著選的時候別的事都做不成，原因寫出來：自由行動、提交別的報告、開另一場、走地圖；狀態不變', async () => {
    const game = await lost()
    const why = '先在戰敗的三個選擇裡選一個：接受結果、重來這場戰鬥，或回到這個階段開始時。'
    const before = stateHash(game.state)
    expect(await game.act({ kind: 'free', text: '我想去買瓶水' })).toMatchObject({ status: 'refused', reason: why })
    expect(() => game.commit(note())).toThrow(ActionBlocked)
    try { game.commit(note()) } catch (e) { expect((e as ActionBlocked).reason).toBe(why) }
    expect(() => game.startBattle(BATTLE_SETUPS.encounter())).toThrow(why)
    expect(game.gridMove('east')).toEqual({ status: 'refused', reason: why, reports: [] })
    expect(() => game.enterMap('nope')).toThrow(why)
    expect(game.blockOf('chain:free_action')).toBe(why)
    expect(game.blockOf('battle.retry')).toBeNull()
    expect(stateHash(game.state)).toBe(before)
    expect(game.state.flags.noted).toBeUndefined()
  })

  it('接受結果（提交的報告把開打前的快照丟掉）之後就不再等：別的事做得成，也不能再重來', async () => {
    const game = await lost()
    expect(game.commit(accept)[0]).toMatchObject({ action: 'defeat.accept' })
    expect(game.pendingDefeat).toBeNull()
    expect(game.state.snapshots).toEqual([])
    expect(game.commit(note())[0]).toMatchObject({ action: 'test.note' })
    expect(game.state.flags.noted).toBe(true)
    expect(game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
  })

  it('重來是三個選擇之一：回到開打之前再開一場；新的那一場的快照沒有標記（還沒輸）', async () => {
    const game = await lost()
    expect(game.retryBattle()).toBeNull()
    expect(game.battle).toMatchObject({ round: 1 })
    expect(game.pendingDefeat).toBeNull()
    expect(game.state.snapshots.map((x) => [x.kind, x.data?.lost])).toEqual([['battle', undefined]])
  })

  it('回到更早的存檔（撤退）：那一場開打前的快照跟著作廢，不會留下一個隨時能用的重來', async () => {
    const t = makeGame({ features: [TEST_COMBAT] })
    const earlier = t.game.save('manual', '')
    t.game.startBattle(BATTLE_SETUPS.hopeless())
    playOut(t.game)
    await t.game.finishBattle()
    expect(t.game.pendingDefeat).not.toBeNull()
    expect(t.game.rewind(earlier, { summary: '你在入口前停下。' })).toBeNull()
    expect(t.game.state.snapshots).toEqual([])
    expect(t.game.pendingDefeat).toBeNull()
    expect(t.game.retryBattle()).toBe('沒有這場戰鬥開打前的快照。')
  })

  it('開打時沒有留快照的那一場：打到一半不能重來，回傳原因', () => {
    const { game } = makeGame()
    game.startBattle(BATTLE_SETUPS.encounter(), { snapshot: false })
    expect(game.retryBattle()).toBe('這一場開打前沒有留快照，不能重來。')
    expect(game.battle).not.toBeNull()
  })

  it('snapshot.mark：在一份快照的 data 上補幾個鍵；找不到那份快照不合法', () => {
    const { game } = makeBattleGame()
    const b = clone(game.state.battle!)
    const mark = (data: unknown, kind = 'battle'): ReportDraft => ({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }, { op: 'snapshot.mark', kind, data }], outcome: { result: 'step', summary: '' } })
    game.commit(mark({ note: 1 }), { attach: true, turn: false })
    expect(game.state.snapshots[0]!.data).toMatchObject({ note: 1 })
    expect(game.state.snapshots[0]!.data!.setup).toBeDefined()
    expect(() => game.commit(mark({ note: 2 }, 'stage'), { attach: true, turn: false })).toThrow(/沒有這份快照/)
    expect(() => game.commit(mark('x'), { attach: true, turn: false })).toThrow(/data 要是一個物件/)
  })
})

describe('S3：戰鬥中不收別的報告（不變式第 48 條）', () => {
  it('Game.commit 在戰鬥中只收戰鬥的報告：別的丟 ActionBlocked，狀態不變；任務鏈也一樣', async () => {
    const { game } = makeBattleGame()
    const before = stateHash(game.state)
    const draft: ReportDraft = { kind: 'system', action: 'gear.equip', location: {}, party: [], timeline: [], changes: [{ op: 'flag', key: 'x', value: true }], outcome: { result: 'ok', summary: '換裝備。' } }
    expect(() => game.commit(draft)).toThrow(ActionBlocked)
    expect(() => game.commit(draft, { attach: true })).toThrow('正在戰鬥，先把這一場打完。')
    expect(stateHash(game.state)).toBe(before)
    expect(game.blockOf('commit:gear.equip')).toBe('正在戰鬥，先把這一場打完。')
    expect(game.blockOf('commit:battle.step')).toBeNull()
    expect(game.blockOf('chain:battle_end')).toBeNull()
    expect(game.blockOf('battle.retry')).toBeNull()
    expect(game.blockOf('grid.move')).toBe('正在戰鬥，先把這一場打完。')
  })
})

describe('S7：打到一半重來，這一場的每一步收成一份（dev/adr/0011：紀錄裡一場戰鬥只有一筆）', () => {
  it('重來之後紀錄裡沒有一步一步的報告：只有一份 battle.abort（標成被收回）與交代這件事的那一份', () => {
    const { game } = makeBattleGame({ seed: 4 })
    for (let i = 0; i < 12; i++) game.battleNext({ anyone: true })
    expect(game.state.reports.filter((r) => r.action === 'battle.step').length).toBeGreaterThan(5)
    const beats = game.state.reports.filter((r) => r.action === 'battle.start' || r.action === 'battle.step').flatMap((r) => r.timeline).length
    expect(game.retryBattle('重來。')).toBeNull()
    expect(game.state.reports.filter((r) => r.action === 'battle.step')).toEqual([])
    const aborted = game.state.reports.filter((r) => r.action === 'battle.abort')
    expect(aborted).toHaveLength(1)
    expect(aborted[0]).toMatchObject({ kind: 'combat', retracted: true, outcome: { result: 'aborted' } })
    expect(aborted[0]!.timeline).toHaveLength(beats)
    expect(aborted[0]!.outcome.summary).toMatch(/沒有打完/)
    // 新的一場照常開打；紀錄裡是：收回的那一份、交代的那一份、新的開打
    expect(game.state.reports.slice(-3).map((r) => r.action)).toEqual(['battle.abort', 'rewind', 'battle.start'])
    expect(game.battle).toMatchObject({ round: 1 })
    // 重來幾次就是幾筆，不是幾百筆
    for (let i = 0; i < 8; i++) game.battleNext({ anyone: true })
    expect(game.retryBattle('再來。')).toBeNull()
    expect(game.state.reports.filter((r) => r.action === 'battle.abort')).toHaveLength(2)
    expect(game.state.reports.filter((r) => r.action === 'battle.step')).toEqual([])
  })
})

describe('E2：補位時和人重疊的東西跟著它掛的那一格走，每格還是最多一台（COMBAT_SYSTEM 第 2 節、2.4 節；不變式第 45 條）', () => {
  const drone = (id: string, slot: number, owner = 'a3') => ({ id, side: 'ally' as const, slot, owner, kind: 'attack', name: `無人機${id}`, hp: { now: 14, max: 14 }, armor: 1, evade: 13, used: false, down: false })

  it('前面那一格的人倒下、後面補上來：掛在後面那幾格的往前一格；掛在空出來那一格的退到最後面', () => {
    // 我方四格都暴露；a1 站第 1 格、a2 第 2 格、a3（操作者）第 3 格。D1 掛第 1 格、D2 掛第 2 格
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3)], [foe()]))
    a.battle.overlays.push(drone('o1', 1), drone('o2', 2))
    const run = a.run()
    run.setOut(a.ally(1), 'down')
    expect([a.ally(2).slot, a.ally(3).slot]).toEqual([1, 2])
    expect(a.battle.overlays.map((o) => [o.id, o.slot])).toEqual([['o1', 4], ['o2', 1]])
    expect(battleProblems(a.battle)).toEqual([])
    expect(run.beats.find((b) => b.tag === 'overlay')).toMatchObject({ text: '無人機o1退到我方的第 4 格。', data: { overlay: 'o1', from: 1, slot: 4 } })
  })

  it('連補兩次也不會疊在一起；被擊落的不算', () => {
    const a = arena(duel([one({ weapon: 'pistol' }), one({ weapon: 'pistol' }, 2), one({ weapon: 'pistol' }, 3), one({ weapon: 'pistol' }, 4)], [foe()]))
    a.battle.overlays.push(drone('o1', 1, 'a4'), drone('o2', 2, 'a4'), drone('o3', 3, 'a4'), { ...drone('o4', 4, 'a4'), down: true })
    const run = a.run()
    run.setOut(a.ally(1), 'down')
    run.setOut(a.ally(2), 'down')
    const live = a.battle.overlays.filter((o) => !o.down).map((o) => o.slot).sort()
    expect(new Set(live).size).toBe(live.length)
    expect(battleProblems(a.battle)).toEqual([])
  })

  it('battleProblems 擋下同一方同一格掛兩台（提交時與讀檔時都會查）', () => {
    const { game } = makeBattleGame()
    const b = clone(game.state.battle!)
    b.overlays.push(drone('o1', 1, 'a1'), drone('o2', 1, 'a1'))
    expect(battleProblems(b)).toEqual(['overlays.o2：和 o1 掛在同一格（每格最多一台）'])
    const before = stateHash(game.state)
    expect(() => game.commit({ kind: 'combat', action: 'battle.step', location: {}, party: [], timeline: [], changes: [{ op: 'battle', state: b, step: true }], outcome: { result: 'step', summary: '' } }, { attach: true, turn: false })).toThrow(/每格最多一台/)
    expect(stateHash(game.state)).toBe(before)
    // 被擊落的那一台不算；不同方的同一格各掛一台可以
    b.overlays[1]!.down = true
    expect(battleProblems(b)).toEqual([])
    b.overlays[1] = { ...drone('o2', 1, 'f1'), side: 'foe' }
    expect(battleProblems(b)).toEqual([])
    b.overlays.push({ ...drone('o3', 7, 'a1') })
    expect(battleProblems(b)).toEqual(['overlays.o3：要掛在某一方的第 1～4 格'])
  })
})

describe('E4：讀檔會驗進行中的戰鬥（不變式第 6、11 條）', () => {
  const broken = (edit: (b: Record<string, any>) => void, content: ContentPack[] = []) => {
    const t = makeBattleGame({ content })
    const file = JSON.parse(t.game.save('manual', '')) as { state: { battle: Record<string, any> } }
    edit(file.state.battle)
    const before = stateHash(t.game.state)
    const err = t.game.load(JSON.stringify(file))
    expect(stateHash(t.game.state)).toBe(before)
    return { err, raw: JSON.stringify(file) }
  }

  it('輪到誰指不到人、先攻的順序裡有不存在的人：整筆不讀，現在這一局不變', () => {
    expect(broken((b) => { b.turn = 99 }).err).toMatch(/存檔壞了.*battle：turn 要指到 order 裡的一個人/)
    expect(broken((b) => { b.order.push('zz') }).err).toMatch(/存檔壞了.*battle：order 裡有不存在的單位/)
    expect(broken((b) => { b.order = [] }).err).toMatch(/存檔壞了/)
    // 輪到的人已經退出（讀進來之後沒有人能動，整局卡死）
    expect(broken((b) => { b.units[b.order[b.turn]].out = 'down' }).err).toMatch(/輪到的那個人不在場上/)
    expect(unpackSave(broken((b) => { b.turn = 99 }).raw)).toMatchObject({ ok: false })
  })

  it('一格兩個人、一格兩台無人機、單位缺了骨架：整筆不讀', () => {
    expect(broken((b) => { b.units.a2.slot = b.units.a1.slot }).err).toMatch(/站在同一格/)
    expect(broken((b) => { b.overlays = [1, 2].map((i) => ({ id: `o${i}`, side: 'ally', slot: 1, owner: 'a1', kind: 'attack', name: '機', hp: { now: 1, max: 1 }, armor: 0, evade: 13, used: false, down: false })) }).err).toMatch(/每格最多一台/)
    expect(broken((b) => { delete b.units.a1.weapons }).err).toMatch(/要有 weapons、statuses、uses/)
  })

  it('戰場或狀態在這一局的內容裡查不到：整筆不讀（讀進來之後每一步都會丟錯）', () => {
    expect(broken((b) => { b.mode = 'nowhere' }).err).toBe('存檔壞了（battle：沒有 nowhere 這個戰場）。')
    expect(broken((b) => { b.units.a1.statuses.push({ id: 'made_up', until: { at: 'battle_end' } }) }, [STATUS_PACK]).err).toBe('存檔壞了（battle：不認得的狀態 made_up）。')
  })

  it('好的戰鬥存檔照樣讀得回來，接著打', () => {
    const t = makeBattleGame({ seed: 9 })
    for (let i = 0; i < 6; i++) t.game.battleNext({ anyone: true })
    const hash = stateHash(t.game.state)
    expect(t.game.load(t.game.save('manual', ''))).toBeNull()
    expect(stateHash(t.game.state)).toBe(hash)
    expect(t.game.battleNext({ anyone: true }).status).toBe('applied')
  })
})

describe('S2：走到敵人那一格、戰卻開不起來：整步不成立（不變式第 3 條）', () => {
  const MAP: SpecialMapEntry = {
    id: 'map_s2', kind: 'test', size: [6, 3],
    sheets: [{
      id: 'hall', name: '走廊', size: [6, 3], layout: ['######', 'E.12GX', '######'],
      cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '門口' }, { id: 'G1', at: [4, 1], mark: 'G', name: '崗哨' }, { id: 'X1', at: [5, 1], mark: 'X', name: '後門' }],
      spots: [{ id: '!1', at: [2, 1], cover: 'medium' }, { id: '!2', at: [3, 1], cover: 'sparse' }],
    }],
  }
  const guard = (setup: () => BattleSetup): Feature => ({ id: 's2_guard', install: (k) => k.grid.onMark('G', 's2_guard', () => ({ line: '撞上了崗哨。', battle: setup() })) })
  const start = (setup: () => BattleSetup) => {
    const t = makeGame({ features: [TEST_COMBAT, guard(setup)], content: [{ id: 's2', content: { special_map: [MAP] } }] })
    t.game.enterMap('map_s2')
    return t.game
  }

  it('遭遇點寫了沒有人註冊的單位來源：回 refused 與原因，人沒有站過去、沒有留下報告，不丟例外', () => {
    const game = start(() => ({ ...BATTLE_SETUPS.encounter(), foes: [{ from: 'ghost', id: 'nope' }] }))
    const before = stateHash(game.state)
    const r = game.gridMove([4, 1])
    expect(r.status).toBe('refused')
    expect(r.reason).toMatch(/這裡的戰鬥開不起來（.*ghost.*）。/)
    expect(r.reports).toEqual([])
    expect(stateHash(game.state)).toBe(before)
    expect(game.battle).toBeNull()
    // 再走一次還是一樣，不會卡在半路
    expect(game.gridMove([4, 1]).status).toBe('refused')
    expect(stateHash(game.state)).toBe(before)
  })

  it('開得起來的照常：走路與開打各一份報告', () => {
    const game = start(() => BATTLE_SETUPS.encounter())
    const r = game.gridMove([4, 1])
    expect(r.reports.map((x) => x.action)).toEqual(['grid.move', 'battle.start'])
    expect(game.battle).toMatchObject({ round: 1 })
  })
})

describe('S4：後方補上來的人照擲出來的先攻排進順序（COMBAT_SYSTEM 1.2 節；dev/adr/0013 C6）', () => {
  /** 五個敵人：四個上場、一個在後方。先攻用釘死的骰面排好，再讓第 1 格的人倒下。 */
  const field = (features: Feature[] = [TEST_COMBAT]) => {
    const a = arena(duel([one({ weapon: 'pistol', initBonus: 0 })], [0, 1, 2, 3, 4].map(() => foe('minion', { initBonus: 0 }))), features)
    // 先攻排成：f1 18、a1 15、f2 12、f3 9、f4 6
    const init: Record<string, number> = { f1: 18, a1: 15, f2: 12, f3: 9, f4: 6 }
    for (const [id, v] of Object.entries(init)) a.battle.units[id]!.initiative = v
    a.battle.order = ['f1', 'a1', 'f2', 'f3', 'f4']
    return a
  }

  it('擲得比還沒輪到的人高：排在他們前面，這一輪就輪得到', () => {
    const a = field()
    a.battle.turn = 1 // 輪到 a1
    const run = a.run([10]) // 補上來的人先攻擲 10
    run.setOut(a.foe(4), 'down')
    run.settle()
    expect(a.battle.units.f5).toMatchObject({ slot: 4, initiative: 10 })
    expect(a.battle.order).toEqual(['f1', 'a1', 'f2', 'f5', 'f3', 'f4'])
    expect(a.battle.order[a.battle.turn]).toBe('a1')
  })

  it('擲得比已經動過的人還高：照先攻排在前面，指標跟著往後一格（輪到的還是原來那個人），他下一輪才動', () => {
    const a = field()
    a.battle.turn = 2 // 輪到 f2
    const run = a.run([20])
    run.setOut(a.foe(4), 'down')
    run.settle()
    expect(a.battle.order).toEqual(['f5', 'f1', 'a1', 'f2', 'f3', 'f4'])
    expect(a.battle.order[a.battle.turn]).toBe('f2')
  })

  it('擲得最低：排最後；一樣高的時候我方先', () => {
    const a = field()
    a.battle.turn = 0
    const run = a.run([1])
    run.setOut(a.foe(4), 'down')
    run.settle()
    expect(a.battle.order).toEqual(['f1', 'a1', 'f2', 'f3', 'f4', 'f5'])
    const b = field()
    b.battle.turn = 0
    const run2 = b.run([15]) // 和 a1 一樣高：我方先
    run2.setOut(b.foe(4), 'down')
    run2.settle()
    expect(b.battle.order).toEqual(['f1', 'a1', 'f5', 'f2', 'f3', 'f4'])
  })

  it('先攻的修正（技能、共鳴）補上來的人也算', () => {
    const QUICK: Feature = { id: 'quick_test', install: (k) => k.battle.modifier('quick_test', (q) => (q.kind === 'initiative' && q.unit.id === 'f5' ? [{ label: '測試', value: 4, source: 'skill' }] : [])) }
    const a = field([TEST_COMBAT, QUICK])
    a.battle.turn = 1
    const run = a.run([10])
    run.setOut(a.foe(4), 'down')
    run.settle()
    expect(a.battle.units.f5!.initiative).toBe(14)
    expect(a.battle.order).toEqual(['f1', 'a1', 'f5', 'f2', 'f3', 'f4'])
  })
})

describe('S5：回合開始時發作的感載造成過載，失去的是下一個回合（CORE_RULES 4.2 節）', () => {
  const PACK: ContentPack = { id: 's5', content: { battle_status: [...TEST_STATUSES, { id: 'backflow', name: '回灌', desc: '每回合感載 +50。', turn_start: { load: 50 }, until: 'battle_end', kind: 'debuff' }] } }

  it('過載了不會在同一個回合開始就把「失去回合」算掉：這一回合照常動，下一個回合失去', () => {
    const g = makeBattleGame({ content: [PACK], battle: duel([one({ weapon: 'pistol' })], [foe('minion', { hp: { now: 999, max: 999 }, weapon: 'knife' }), foe('minion', { hp: { now: 999, max: 999 }, weapon: 'knife' })]), seed: 3 }).game
    const b = g.state.battle!
    b.units.a1!.statuses.push({ id: 'backflow', until: { at: 'battle_end' } })
    b.units.a1!.layersMax = 9
    // 讓 a1 的回合重新開始：把指標放到他前面那個人，結束那個人的回合
    const before = b.order[(b.order.indexOf('a1') + b.order.length - 1) % b.order.length]!
    turnTo(g, before)
    expect(g.battleAct({ action: END_TURN }).status).toBe('applied')
    const me = () => g.battle!.units.a1!
    // 這個回合開始時過載了（疊一層餘韻），但輪到的還是他：這一回合照常
    expect(g.battle!.order[g.battle!.turn]).toBe('a1')
    expect(me().layers).toBe(1)
    expect(me().statuses.some((s) => s.id === 'lose_turn')).toBe(true)
    // 結束這一回合，輪一圈回來：這一次失去回合（紀錄上有 turn.skip），「失去回合」用掉了一個、又因為再過載多了一個
    expect(g.battleAct({ action: END_TURN }).status).toBe('applied')
    const skipped: string[] = []
    for (let i = 0; i < 20 && g.battle && !g.battle.result; i++) {
      const r = g.battleNext({ anyone: true })
      skipped.push(...r.reports.flatMap((x) => x.timeline.filter((beat) => beat.tag === 'turn.skip').map((beat) => String(beat.data?.unit))))
      if (skipped.length) break
    }
    expect(skipped).toEqual(['a1'])
    expect(me().layers).toBe(2)
  })
})

describe('E5：電磁與熱能的武器傷害骰少一顆（COMBAT_SYSTEM 第 4 節）', () => {
  const shot = (type: 'physical' | 'thermal' | 'em', dice = 3) => {
    const a = arena(duel([one({ weapons: [{ ...testWeapon('pistol', 20), type, dice }] })], [foe('minion', { hp: { now: 999, max: 999 } })]), [TEST_COMBAT], (k) => k.content.loadPack(STATUS_PACK))
    // 骰面：命中 10（加值 20，一定中、不到要害的門檻以上 5？用迴避算）、之後每一顆傷害骰都是 6
    const run = a.run([2, 6, 6, 6, 6, 6, 6])
    const r = run.attack(a.ally(1), a.foe(1), { noWound: true, critMargin: 99 })
    return r.raw - a.ally(1).weapons[0]!.flat
  }

  it('同一把槍：物理擲 3 顆，熱能與電磁各少一顆；最少還是擲一顆', () => {
    expect(shot('physical')).toBe(18)
    expect(shot('thermal')).toBe(12)
    expect(shot('em')).toBe(12)
    expect(shot('em', 1)).toBe(6)
  })

  it('打和人重疊的東西也一樣少一顆', () => {
    const a = arena(duel([one({ weapons: [{ ...testWeapon('pistol', 20), type: 'em', dice: 3 }] })], [foe()]))
    a.battle.overlays.push({ id: 'o1', side: 'foe', slot: 1, owner: 'f1', kind: 'attack', name: '無人機', hp: { now: 99, max: 99 }, armor: 0, evade: 13, used: false, down: false })
    const run = a.run([10, 6, 6, 6, 6])
    const r = run.attackOverlay(a.ally(1), a.battle.overlays[0]!)
    expect(r.raw - a.ally(1).weapons[0]!.flat).toBe(12)
  })
})
