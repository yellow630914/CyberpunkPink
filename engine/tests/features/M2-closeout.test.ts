// 驗收測試：dev/work/M2-closeout.md 的功能部分（第 1、2、5、6、8 項；第 3、4、10 項的核心機制在 tests/core/M2-closeout-core.test.ts，
// 第 7 項在 M2-roster.test.ts，第 9 項在 M2-enemy-encounter.test.ts）。規格：COMBAT_SYSTEM 8.4 節、M1 審查 E1、EVENTS 3.1、DISTRICTS 1.2、
// ENEMIES 第 13 節、COMMISSION_TEMPLATES、DOWNTIME 5.1、NPC_SYSTEM 6.4；dev/adr/0016 與 0017。
// 內容一律用測試自帶的最小假資料。

import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Launch, Report, ReportDraft } from '../../src'
import { ActionBlocked, Game, clone } from '../../src'
import { directorFeature, chooseOption, eventRunFeature, eventView } from '../../src/features/director'
import { acceptDefeat, defeatFeature, defeatOf, defeatView, fromDefeatFlow, skipDefeat, stageOf, watchDefeat } from '../../src/features/defeat'
import { DEFAULT_BILL_RULES, billRules, debtPayOf } from '../../src/features/bills/model'
import { DEFAULT_GEN_RULES, genRules } from '../../src/features/fixer/gen'
import { ENEMY_CURVE, ENCOUNTER_BUDGET } from '../../src/features/enemies'
import { DEFAULT_INTERACT_RULES, interactRules, shieldOf } from '../../src/features/npcs/interact'
import type { Npc } from '../../src/features/npcs'
import { districtProblems } from '../../src/features/world/model'
import { transitFeature, transitOf, advance, board, wait } from '../../src/features/transit'
import { arrive, worldFeature } from '../../src/features/world'
import { allFeatures } from '../../src/features'
import { CORE_PACK } from '../../data'
import { BATTLE_SETUPS, TEST_COMBAT, makeGame, playOut } from '../../src/testkit'

type Fx = Record<string, unknown>

// ===================================================================================================================
// 戰敗（第 1、2 項）
// ===================================================================================================================

const enemyStub: Feature = { id: 'enemy_stub', install: (k) => k.content.defineKind({ kind: 'enemy', owner: 'enemy_stub', validate: () => [] }) }
const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const df = (id: string, o: Fx = {}): Fx => ({ id, name: id, kind: 'generic', factions: [], fails_commission: true, versions: { default: { text: `${id}：開頭。`, stages: [{ options: [opt('o1', '繼續。')] }] } }, ...o })
const PACK = (events: Fx[]): ContentPack => ({
  id: 'closeout_defeat',
  content: {
    faction: [{ id: 'nora', name: '野良', short: '野良', class: 'street' }],
    event_scope: [{ id: 'street', triggers: { enter_block: 1 } }],
    enemy: [{ id: 'en_goon', name: '打手', faction: 'nora', kind: 'human' }],
    defeat_event: events,
  } as unknown as ContentPack['content'],
})
const JAILBREAK = df('df_jail', {
  default: true,
  versions: { default: { text: '你被關進了牢房。', stages: [{ options: [opt('break', '砸開門。', { outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes }] } }), opt('wait', '等著。')] }] } },
})
const PLAIN = df('df_plain', { default: true })

/** 一局進了一場必輸的戰鬥（打輸並結算之後）。 */
async function lostGame(events: Fx[], rules: Record<string, unknown> = {}) {
  const { game } = makeGame({
    features: [defeatFeature, TEST_COMBAT, directorFeature, eventRunFeature, enemyStub], content: [PACK(events)], seed: 2,
    pc: { gender: 'female', skills: { composure: 1 } },
    patch: { money: { cred: 0, cash: 2000 }, rules: rules as never, time: { day: 3, hour: 10, minute: 0 } },
  })
  game.startBattle(BATTLE_SETUPS.hopeless())
  playOut(game)
  await game.finishBattle()
  return game
}
const DIRECTOR: Launch = { kind: 'event', setup: {}, origin: { by: 'director' } }
const FREE = 'chain:free_action'
const WHY = '先在戰敗的三個選擇裡選一個：接受結果、重來這場戰鬥，或回到這個階段開始時。'

describe('第 1 項：戰敗的放行照階段（COMBAT_SYSTEM 8.4 節、M1 審查 E1）', () => {
  it('問要不要看（ask）：自由行動被擋，原因是三選一；事件視窗只放戰敗自己開的', async () => {
    const g = await lostGame([PLAIN], { defeatView: 'skippable' })
    expect(stageOf(defeatOf(g.state)!)).toBe('ask')
    expect(g.blockOf(FREE)).toBe(WHY)
    expect(g.blockOf('event.start', undefined, DIRECTOR)).toBe(WHY)
    expect(g.blockOf('event.start', undefined, { kind: 'event', setup: {}, origin: { by: 'defeat' } })).toBeNull()
    // 戰敗自己的報告、事件視窗的報告放行（要先問要不要看，所以選項照舊要能收）
    expect(g.blockOf('commit:defeat.view')).toBeNull()
    expect(g.blockOf('commit:event.choose')).toBeNull()
    // 重來（三選一的一個）照舊放行
    expect(g.blockOf('battle.retry')).toBeNull()
  })

  it('選了看：事件視窗開著，這時自由行動放行（回應事件）；事件做完（played）又擋住，直到接受', async () => {
    const g = await lostGame([PLAIN], { defeatView: 'skippable' })
    g.commit(watchDefeat(g.k, g.state))
    expect(stageOf(defeatOf(g.state)!)).toBe('playing')
    expect(eventView(g.k, g.state)).not.toBeNull()
    expect(g.blockOf(FREE)).toBeNull()
    g.commit(chooseOption(g.k, g.state, 'o1'))
    expect(stageOf(defeatOf(g.state)!)).toBe('played')
    expect(eventView(g.k, g.state)).toBeNull()
    expect(g.blockOf(FREE)).toBe(WHY)
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.blockOf(FREE)).toBeNull()
  })

  it('選了不看（played）：自由行動被擋；接受之後放行', async () => {
    const g = await lostGame([PLAIN], { defeatView: 'skippable' })
    g.commit(skipDefeat(g.k, g.state))
    expect(stageOf(defeatOf(g.state)!)).toBe('played')
    expect(g.blockOf(FREE)).toBe(WHY)
    expect(await g.act({ kind: 'free', text: '回家睡覺' })).toMatchObject({ status: 'refused', reason: WHY })
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.blockOf(FREE)).toBeNull()
  })

  it('always：打輸那一步事件視窗就開起來（playing），自由行動放行；事件做完之後被擋', async () => {
    const g = await lostGame([PLAIN])
    expect(stageOf(defeatOf(g.state)!)).toBe('playing')
    expect(g.blockOf(FREE)).toBeNull()
    expect(defeatView(g.k, g.state)).toMatchObject({ step: 'playing', inner: { kind: 'event' } })
    g.commit(chooseOption(g.k, g.state, 'o1'))
    expect(g.blockOf(FREE)).toBe(WHY)
  })

  it('沒有事件視窗的一局（沒有人登記活動 event）：照 M1，三選一的期間自由行動一直擋住', async () => {
    const { game } = makeGame({ features: [defeatFeature, TEST_COMBAT, directorFeature, enemyStub], content: [PACK([PLAIN])], seed: 2 })
    game.startBattle(BATTLE_SETUPS.hopeless())
    playOut(game)
    await game.finishBattle()
    expect(defeatOf(game.state)).toMatchObject({ skipped: true, stage: 'played' })
    expect(game.blockOf(FREE)).toBe(WHY)
  })

  it('fromDefeatFlow：戰敗自己開的、它的事件 chain 帶出來的、事件的 fight 結果；其他來歷都不是', () => {
    const o = (origin?: Launch['origin']): Launch => ({ kind: 'x', setup: {}, ...(origin ? { origin } : {}) })
    expect(fromDefeatFlow(undefined)).toBe(false)
    expect(fromDefeatFlow(o())).toBe(false)
    expect(fromDefeatFlow(o({ by: 'core' }))).toBe(false)
    expect(fromDefeatFlow(o({ by: 'commission' }))).toBe(false)
    expect(fromDefeatFlow(o({ by: 'director' }))).toBe(false)
    expect(fromDefeatFlow(o({ by: 'director', ext: { caller: 'commission' } }))).toBe(false)
    expect(fromDefeatFlow(o({ by: 'defeat', ref: 'b1' }))).toBe(true)
    expect(fromDefeatFlow(o({ by: 'director', ext: { caller: 'defeat' } }))).toBe(true)
    expect(fromDefeatFlow(o({ by: 'director', ext: { caller: 'director' } }))).toBe(true)
  })
})

describe('第 2 項：戰敗事件的 fight 結果放行 battle.start（劫囚之類）；玩家自己開戰仍然擋住', () => {
  it('事件的 fight 選項：事件收尾那一份帶 launch，戰鬥開起來；剛才那一場戰敗被取代、不留等待中的紀錄', async () => {
    const g = await lostGame([JAILBREAK])
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_jail', stage: 'playing' })
    const reports = g.commit(chooseOption(g.k, g.state, 'break'))
    expect(reports.map((r) => r.action)).toEqual(['event.close', 'battle.start'])
    expect(g.state.battle).toBeTruthy()
    expect(g.state.battle!.origin.ext).toMatchObject({ by: 'director', caller: 'defeat' })
    // 打輸之前的快照被這一場的快照取代：舊的三選一不在了，但這一場有自己的開打前的快照
    expect(g.pendingDefeat).toBeNull()
    expect(g.state.snapshots.filter((s) => s.kind === 'battle')).toHaveLength(1)
  })

  it('劫囚打贏了：等待中的戰敗被清掉（不留一個沒有快照的紀錄），之後的事照常做得成', async () => {
    const g = await lostGame([JAILBREAK])
    g.commit(chooseOption(g.k, g.state, 'break'))
    const b = g.state.battle!
    // 讓玩家這一方贏：敵方全部倒下
    for (const u of Object.values(b.units)) if (u.side === 'foe') u.out = 'down'
    b.result = { outcome: 'win', text: '你們逃出去了。' }
    await g.finishBattle()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.pendingDefeat).toBeNull()
    expect(g.blockOf(FREE)).toBeNull()
  })

  it('劫囚也打輸了：新的戰敗取代舊的（照那一場的結果選事件）', async () => {
    const g = await lostGame([JAILBREAK])
    const first = defeatOf(g.state)!.battle
    g.commit(chooseOption(g.k, g.state, 'break'))
    playOut(g)
    await g.finishBattle()
    expect(defeatOf(g.state)).not.toBeNull()
    expect(defeatOf(g.state)!.battle).not.toBe(first)
  })

  it('三選一的期間玩家自己開戰、別的來歷開戰都被擋下（M1 審查 E1 照舊）', async () => {
    const g = await lostGame([PLAIN], { defeatView: 'skippable' })
    expect(() => g.startBattle(BATTLE_SETUPS.hopeless())).toThrow(ActionBlocked)
    expect(g.blockOf('battle.start', undefined, { kind: 'battle', setup: {}, origin: { by: 'commission' } })).toBe(WHY)
    expect(g.blockOf('battle.start', undefined, { kind: 'battle', setup: {}, origin: { by: 'director', ext: { caller: 'commission' } } })).toBe(WHY)
    expect(g.blockOf('battle.start', undefined, { kind: 'battle', setup: {}, origin: { by: 'director', ext: { caller: 'defeat' } } })).toBeNull()
    // 事件視窗沒開著（ask 與 played）時 director 開的戰鬥也只是被放行的來歷，不是放行 free_action
    expect(g.blockOf(FREE)).toBe(WHY)
  })
})

// ===================================================================================================================
// 導演（第 5 項）
// ===================================================================================================================

describe('第 5 項：導演的「另一個活動進行中」不算放行 event.start 的活動', () => {
  it('permits：車上放行、戰敗等待中不放行（導演開的事件）', async () => {
    const g = await lostGame([PLAIN], { defeatView: 'skippable' })
    expect(g.k.activity.permits(g.state, 'defeat', 'event.start', undefined, DIRECTOR)).toBe(false)
    const ride = makeGame({ features: [] }).game
    ride.k.activity.define({ kind: 'ride', owner: 't', order: 80, active: () => ({ id: 'r', label: '車上' }), allow: ['event.start'], reason: () => '車上。' })
    expect(ride.k.activity.permits(ride.state, 'ride', 'event.start', undefined, DIRECTOR)).toBe(true)
  })

  // 一條真的路線：世界、公共交通、導演、事件視窗；每一站帶 transit_stop，範圍 transit 一定擲中
  const MAP = {
    id: 'm_street', kind: 'block', size: [14, 5],
    sheets: [{
      id: 'street', name: '街', size: [14, 5],
      layout: ['##############', '#F...........#', 'E............E', '#............#', '##############'],
      cells: [{ id: 'F1', at: [1, 1], mark: 'F', name: '車站' }, { id: 'E1', at: [0, 2], mark: 'E', name: '西口' }, { id: 'E2', at: [13, 2], mark: 'E', name: '東口' }],
    }],
  }
  const blockOf = (id: string, name: string) => ({ id, district: 'd_t', name, kind: 'block', map: 'm_street', exits: {}, facilities: { F1: { type: 'fac_station', name: `${name}站` } } })
  const stop = (id: string, name: string, b: string) => ({ id, name, block: b, at: 'F1' })
  const RIDE_PACK = (blocking: boolean): ContentPack => ({
    id: 'closeout_ride',
    content: {
      special_map: [MAP], facility_type: [{ id: 'fac_station', name: '車站' }],
      district: [{ id: 'd_t', name: '測試區', grade: 1, blocks: ['b_a', 'b_b', 'b_c'] }],
      block: [blockOf('b_a', 'A'), blockOf('b_b', 'B'), blockOf('b_c', 'C')],
      transit_line: [{ id: 'l_metro', name: '地鐵', kind: 'metro', stops: [stop('s_a', 'A', 'b_a'), stop('s_b', 'B', 'b_b'), stop('s_c', 'C', 'b_c')], minutes_per_stop: 5, wait: [2, 2], fare: { base: 2, per_stop: 1 }, pay: ['cred', 'cash'], night: false }],
      transit_rule: [{ id: 'default' }],
      event_scope: [{ id: 'transit', triggers: { transit_stop: 1, transit_wait: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }],
      event: [{ id: 'ev_ride', scope: 'transit', triggers: ['transit_stop'], ...(blocking ? {} : { blocking: false }), text: '車廂裡有人看著你。', options: [opt('look', '看回去。')] }],
    } as unknown as ContentPack['content'],
  })
  const ride = (blocking = true) => {
    const { game } = makeGame({
      scenario: 'withMoney', features: [worldFeature, transitFeature, directorFeature, eventRunFeature], content: [RIDE_PACK(blocking)], seed: 4,
      patch: { time: { day: 1, hour: 8, minute: 0 }, money: { cred: 100, cash: 100 } },
    })
    game.commit(arrive(game.k, game.state, 'b_a', 'F1'))
    game.commit(board(game.k, game.state, { line: 'l_metro', pay: 'cred' }))
    game.commit(wait(game.k, game.state))
    return game
  }

  it('車上：擋住型的 transit_stop 事件照常跳出來（以前被當成「另一個活動」一律延後）；選完之後旅程接著走', () => {
    const g = ride()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['ride'])
    const reports = g.commit(advance(g.k, g.state))
    expect(reports.map((r) => r.action)).toEqual(['transit.stop', 'event.open'])
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'ev_ride' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event', 'ride'])
    // 事件開著時車上的別的動作先擋住（事件優先），回應事件是放行的
    expect(g.blockOf('commit:transit.stop')).toMatch(/要先回應/)
    g.commit(chooseOption(g.k, g.state, 'look'))
    expect(eventView(g.k, g.state)).toBeNull()
    expect(transitOf(g.state).trip).not.toBeNull()
    g.commit(advance(g.k, g.state))
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'ev_ride' }) // 下一站又擲中（範圍的機率是 1、沒有冷卻）
  })

  it('通知型的事件照常（它本來就不擋）；沒有擲中時不開', () => {
    const g = ride(false)
    const reports = g.commit(advance(g.k, g.state))
    expect(reports.map((r) => r.action)).toContain('transit.stop')
    expect(eventView(g.k, g.state)).toBeNull()
  })

  it('不放行 event.start 的活動進行中，擋住型的事件照舊延後（事件視窗開著時不再開第二件）', () => {
    const g = ride()
    g.commit(advance(g.k, g.state)) // 第一件開著
    expect(eventView(g.k, g.state)).not.toBeNull()
    // 事件視窗自己不放行 event.start：它進行中導演不會再開一件（活動 event 排在車上前面，先擋）
    expect(g.k.activity.permits(g.state, 'event', 'event.start', undefined, DIRECTOR)).toBe(false)
    expect(g.k.activity.permits(g.state, 'ride', 'event.start', undefined, DIRECTOR)).toBe(true)
  })
})

// ===================================================================================================================
// 世界（第 6 項）
// ===================================================================================================================

describe('第 6 項：區的資料多了城市地圖上的位置、治安與風格', () => {
  const ok = { name: '蜂巢', grade: 1, blocks: ['b_1'] }
  it('map_x、map_y 是 0 以上的數字；security、style 是一句話；都可以不寫', () => {
    expect(districtProblems({ ...ok })).toEqual([])
    expect(districtProblems({ ...ok, map_x: 1085, map_y: 640, security: '市警不來；東側有孤星連', style: '街頭' })).toEqual([])
    expect(districtProblems({ ...ok, map_x: 0, map_y: 0 })).toEqual([])
    expect(districtProblems({ ...ok, map_x: -1 }).join('')).toMatch(/map_x/)
    expect(districtProblems({ ...ok, map_y: '640' }).join('')).toMatch(/map_y/)
    expect(districtProblems({ ...ok, map_x: Infinity }).join('')).toMatch(/map_x/)
    expect(districtProblems({ ...ok, security: '' }).join('')).toMatch(/security/)
    expect(districtProblems({ ...ok, style: 3 }).join('')).toMatch(/style/)
  })

  it('載入時照同一套檢查（內容種類 district）', () => {
    const { game } = makeGame({ features: [worldFeature], content: [] })
    expect(game.k.content.validate('district', [{ id: 'd_a', ...ok, map_x: 10, map_y: 20, security: '沒有', style: '無' }])).toEqual([])
    expect(game.k.content.validate('district', [{ id: 'd_a', ...ok, map_x: 'x' }]).join('')).toMatch(/map_x/)
  })

  it('核心包加世界：示意包用的欄位名（map_x、map_y、security、style）原樣收下', () => {
    const mine = { id: 'mine', content: { district: [{ id: 'd_demo', name: '示意區', grade: 2, blocks: [], map_x: 520, map_y: 640, security: '店家自己顧', style: '歡場' }] } }
    expect(districtProblems(mine.content.district[0]!)).toContain('blocks 要是街區 id 的陣列，每個區至少一塊街區') // 只有 blocks 空的問題，欄位本身沒有
    expect(districtProblems(mine.content.district[0]!).filter((m) => /map_|security|style/.test(m))).toEqual([])
  })
})

// ===================================================================================================================
// 預設值對設計書（第 8 項）
// ===================================================================================================================

describe('第 8 項：預設值照設計書（設計書優先）', () => {
  const POINTS = ENEMY_CURVE.points
  const pointsOf = (ranks: Array<'minion' | 'elite' | 'boss'>): number => ranks.reduce((n, r) => n + POINTS[r], 0)

  it('遭遇的組合（ENEMIES 第 13 節）：一般 4 點、首領戰 8 點，每一級都一樣；I 級沒有首領，首領戰是兩個精英加兩個雜兵', () => {
    expect(ENCOUNTER_BUDGET).toMatchObject({ normal: 4, boss: 8 })
    for (const g of [1, 2, 3, 4, 5]) expect(pointsOf(DEFAULT_GEN_RULES.encounters[g]!.normal), `${g} 級一般`).toBe(ENCOUNTER_BUDGET.normal)
    for (const g of [2, 3, 4, 5]) expect(pointsOf(DEFAULT_GEN_RULES.encounters[g]!.last), `${g} 級首領戰`).toBe(ENCOUNTER_BUDGET.boss)
    expect(DEFAULT_GEN_RULES.encounters[1]!.last).toEqual(['elite', 'elite', 'minion', 'minion'])
    expect(pointsOf(DEFAULT_GEN_RULES.encounters[1]!.last)).toBeLessThanOrEqual(ENCOUNTER_BUDGET.boss) // 7 點
  })

  it('報酬範圍（COMMISSION_TEMPLATES 的表）：基準 × 規模係數，下限是小型（×0.6）、上限是大型（×1.8）', () => {
    const BASE: Record<number, number> = { 1: 400, 2: 1200, 3: 4000, 4: 13000, 5: 40000 }
    for (const g of [1, 2, 3, 4, 5]) expect(DEFAULT_GEN_RULES.reward_range[g], `${g} 級`).toEqual([Math.round(BASE[g]! * 0.6), Math.round(BASE[g]! * 1.8)])
    expect(DEFAULT_GEN_RULES.reward_range).toEqual({ 1: [240, 720], 2: [720, 2160], 3: [2400, 7200], 4: [7800, 23400], 5: [24000, 72000] })
  })

  it('核心包的資料等於預設，功能讀出來的也一樣（資料與程式不分家）', () => {
    const g = new Game({ features: allFeatures(), content: [CORE_PACK] })
    expect(JSON.parse(JSON.stringify(genRules(g.k)))).toEqual(JSON.parse(JSON.stringify(DEFAULT_GEN_RULES)))
    expect(billRules(g.k).debt_pay).toEqual({ rouge: 'cash' })
    expect(interactRules(g.k).read.flag_tiers).toEqual({ manager: 3, guard: 3 })
  })

  it('債的利息（DOWNTIME 5.1）：胭脂堂收現金，伊甸園與沒寫的勢力扣帳戶；資料寫了別的就照資料（整個取代）', () => {
    expect(DEFAULT_BILL_RULES.debt_pay).toEqual({ rouge: 'cash' })
    expect(DEFAULT_BILL_RULES.debt_pay_default).toBe('cred')
    const rules = billRules({ content: { get: () => undefined } } as never)
    expect(debtPayOf(rules, 'rouge')).toBe('cash')
    expect(debtPayOf(rules, 'eden')).toBe('cred')
    expect(debtPayOf(rules, 'nobody')).toBe('cred')
    // 預設的物件不會被改到（每次讀都是新的複製）
    rules.debt_pay.eden = 'cash'
    expect(billRules({ content: { get: () => undefined } } as never).debt_pay).toEqual({ rouge: 'cash' })
    expect(DEFAULT_BILL_RULES.debt_pay).toEqual({ rouge: 'cash' })
    const over = billRules({ content: { get: () => ({ id: 'default', debt_pay: { eden: 'cash' } }) } } as never)
    expect(debtPayOf(over, 'eden')).toBe('cash')
    expect(debtPayOf(over, 'rouge')).toBe('cred')
  })

  it('讀橋的防護階（NPC_SYSTEM 6.4）：街坊 0、行者 1、職員 2；企業的主管（manager）與保全（guard）3；寫明的 shield:N 最優先', () => {
    const rules = clone(DEFAULT_INTERACT_RULES)
    const npc = (kind: Npc['kind'], flags: string[] = []): Npc => ({ kind, flags } as unknown as Npc)
    expect(shieldOf(rules, npc('citizen'))).toBe(0)
    expect(shieldOf(rules, npc('runner'))).toBe(1)
    expect(shieldOf(rules, npc('staff'))).toBe(2)
    for (const kind of ['citizen', 'runner', 'staff'] as const) {
      expect(shieldOf(rules, npc(kind, ['manager'])), `${kind} 主管`).toBe(3)
      expect(shieldOf(rules, npc(kind, ['guard'])), `${kind} 保全`).toBe(3)
      expect(shieldOf(rules, npc(kind, ['guard', 'manager']))).toBe(3)
    }
    expect(shieldOf(rules, npc('staff', ['shield:4']))).toBe(4)
    expect(shieldOf(rules, npc('staff', ['guard', 'shield:1']))).toBe(1)
    expect(shieldOf(rules, npc('runner', ['nothing', 'fixer']))).toBe(1)
    // 取高的：身分類比旗標高時不降
    const hard = clone(rules)
    hard.read.tiers.staff = 4
    expect(shieldOf(hard, npc('staff', ['guard']))).toBe(4)
    // 名字叫 constructor、__proto__ 的旗標不會讀到原型上的東西
    expect(shieldOf(rules, npc('citizen', ['constructor', '__proto__', 'toString']))).toBe(0)
  })
})

// 小工具：讓 TypeScript 不抱怨沒用到的型別匯入
export type { Report, ReportDraft }
