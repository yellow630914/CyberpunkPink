// 驗收測試：dev/work/M2-defeat.md（cpp-feature）。規格：COMBAT_SYSTEM 8.3～8.5 節；ENEMIES 第 6 節；DATA 第 5 節；
// AI_TASKS 3.14 節（只看流程）；UI 4.1 節；dev/adr/0014、0016。
// 內容一律用測試自帶的最小假資料。事件視窗用真的（director 的 eventRunFeature）；其餘用替身：
//   caller      發起那一場戰鬥的功能：收 activity.end（kind defeat），記下收到的東西，可以回傳 rewind
//   sceneStub   成人場景（活動 scene）：只記下 setup，用 scene.end 結束
//   gearStub    一種「拿走身上裝備」的效果 strip_gear 與它的 defeat.gear 回答
//   enemyStub   敵人的內容種類（只有 id、faction、kind、defeat、humanoid）
//   companionStub、ransomStub  defeat.companions、defeat.options 的回答
// 擲骰：骰面從存檔的亂數導出；要擲壞的檢定用 DC 40（只有自然 20 過得了）。

import { describe, expect, it } from 'vitest'
import type { Actor, BattleSetup, ContentPack, Effect, Feature, GameState, Origin, Report, ReportDraft } from '../../src'
import { ActionBlocked } from '../../src'
import { chooseOption, directorFeature, eventRunFeature, eventView } from '../../src/features/director'
import {
  acceptDefeat, chooseDefeatOption, defeatFeature, defeatOf, defeatOptions, defeatView, pickDefeat, rewriteEffects, skipDefeat, stageOf, watchDefeat,
} from '../../src/features/defeat'
import { BATTLE_SETUPS, TEST_COMBAT, enemyUnit, makeActor, makeGame, observed, playOut } from '../../src/testkit'

// ---- 替身 ----

interface Heard { kind: string; id: string; origin: Origin; outcome: string; result: Record<string, unknown> }
const caller = (log: Heard[], rewind?: { kind: string; summary: string }): Feature => ({
  id: 'caller',
  install(k) {
    k.hooks.on('activity.end', 'caller', (p) => {
      if (p.kind !== 'defeat' || p.origin.by !== 'caller') return
      log.push({ kind: p.kind, id: p.id, origin: p.origin, outcome: p.outcome, result: p.result })
      return { lines: ['發起的人收到了戰敗的結果'], ...(rewind ? { rewind } : {}) }
    })
  },
})

const SCENE_KEY = 'scene_stub'
const sceneStub: Feature = {
  id: 'scene_stub',
  install(k) {
    k.activity.define({
      kind: 'scene', owner: 'scene_stub', order: 20,
      active: (s) => (s.ext[SCENE_KEY] ? { id: 'sc1', label: '成人場景' } : null),
      allow: ['scene.', 'commit:scene.'],
      reason: () => '場景進行中。',
      start: (_k, state, setup, origin) => [{ kind: 'social', action: 'scene.start', location: { ...state.location }, party: [], timeline: [], changes: [{ op: 'ext', key: SCENE_KEY, value: { setup, origin } }], outcome: { result: 'open', summary: '場景開了。' } }],
    })
  },
}
const sceneOf = (s: GameState) => s.ext[SCENE_KEY] as { setup: Record<string, unknown>; origin: Origin } | undefined
const sceneEnd = (): ReportDraft => ({ kind: 'social', action: 'scene.end', location: {}, party: [], timeline: [], changes: [{ op: 'ext', key: SCENE_KEY, value: null }], outcome: { result: 'done', summary: '場景結束了。' } })

const gearStub: Feature = {
  id: 'gear_stub',
  install(k) {
    k.effects.register<{ kind: string; slot: string }>({
      kind: 'strip_gear', owner: 'gear_stub',
      validate: (raw) => (typeof raw.slot === 'string' ? [] : ['slot 要是字串']),
      toChanges: (e) => [{ op: 'flag', key: `stripped_${e.slot}`, value: true }],
      describe: (e) => `被拿走：${e.slot}`,
    })
    k.hooks.on('defeat.gear', 'gear_stub', ({ effect }) => effect.kind === 'strip_gear')
  },
}

const enemyStub: Feature = { id: 'enemy_stub', install: (k) => k.content.defineKind({ kind: 'enemy', owner: 'enemy_stub', validate: () => [] }) }
const companionStub: Feature = { id: 'companion_stub', install: (k) => void k.hooks.on('defeat.companions', 'companion_stub', () => ['npc_ann']) }
const ransomStub: Feature = {
  id: 'ransom_stub',
  install: (k) => void k.hooks.on('defeat.options', 'ransom_stub', () => [{
    id: 'ransom', name: '被贖回', desc: '付 500 C$，跳過戰敗事件。', blocks: [], changes: [{ op: 'cash', delta: -500 }], lines: ['付了贖金。'], summary: '你們被贖回來了，沒有經歷戰敗事件。',
  }]),
}

// ---- 假資料 ----

type Fx = Record<string, unknown>
const cash = (amount: number): Effect & { amount: number } => ({ kind: 'cash', amount })
const flag = (key: string): Effect => ({ kind: 'flag', key, value: true })
const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const df = (id: string, o: Fx = {}): Fx => ({ id, name: id, kind: 'generic', factions: [], fails_commission: true, versions: { default: { text: `${id}：開頭。`, stages: [{ options: [opt('o1', '繼續。')] }] } }, ...o })
const one = (...options: Fx[]): Fx => ({ default: { text: '你醒來的時候人在別的地方。', stages: [{ options }] } })

const PACK = (events: Fx[], extra: Record<string, Fx[]> = {}): ContentPack => ({
  id: 'defeat_m2',
  content: {
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'nora', name: '野良', short: '野良', class: 'street' }, { id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }],
    event_scope: [{ id: 'street', triggers: { enter_block: 1 } }],
    event: [{ id: 'ev_follow', scope: 'street', triggers: ['enter_block'], text: '後續。', options: [opt('f1', '好。', { flags: ['no_fail'], outcomes: { any: [flag('followed')] } })] }],
    enemy: [
      { id: 'en_goon', name: '打手', faction: 'nora', kind: 'human', defeat: 'df_own' },
      { id: 'en_goon2', name: '打手乙', faction: 'nora', kind: 'human', defeat: ['df_own', 'df_own2'] },
      { id: 'en_drone', name: '無人機', faction: 'eden', kind: 'machine' },
      { id: 'en_maid', name: '機娘', faction: 'eden', kind: 'machine', humanoid: true },
      { id: 'en_plain', name: '保全', faction: 'hizakura', kind: 'human' },
    ],
    defeat_event: events,
    ...extra,
  } as unknown as ContentPack['content'],
})

const BASE_EVENTS = [
  df('df_arrest', { factions: ['hizakura'], tags: ['pc_unwilling'], fallback: 'df_arrest_plain' }),
  df('df_arrest_plain', { factions: [] }),
  df('df_robbed', { factions: ['nora'], fails_commission: false }),
  df('df_eden', { factions: ['eden'] }),
  df('df_own', { factions: [] }),
  df('df_own2', { factions: [] }),
  df('df_custom', { factions: [] }),
  df('df_angel', { factions: [], angel: true, fails_commission: false }),
  df('df_generic', { factions: [], default: true }),
]

interface Opts {
  events?: Fx[]
  content?: Record<string, Fx[]>
  features?: Feature[]
  rules?: Record<string, unknown>
  cash?: number
  seed?: number
  gender?: string
  flags?: Record<string, unknown>
  actors?: Actor[]
  faction?: string
  ext?: Record<string, unknown>
  foes?: string[]
  entry?: boolean
  setup?: BattleSetup
}

const FEATURES: Feature[] = [defeatFeature, TEST_COMBAT, directorFeature, eventRunFeature, enemyStub]
const entrySnapshot = (): ReportDraft => ({ kind: 'action', action: 'test.entry', location: { district: 'test', block: 'empty_room' }, party: [], timeline: [], changes: [{ op: 'snapshot.take', kind: 'entry', label: '入口' }], outcome: { result: 'ok', summary: '進到入口。' } })

/** 一局進了一場必輸的戰鬥（還沒打）。 */
function arena(o: Opts = {}) {
  const { game } = makeGame({
    features: [...FEATURES, ...(o.features ?? [])], content: [PACK(o.events ?? BASE_EVENTS, o.content)], seed: o.seed ?? 2,
    pc: { gender: o.gender ?? 'female', skills: { composure: 1 } }, actors: o.actors,
    patch: { money: { cred: 0, cash: o.cash ?? 2000 }, rules: (o.rules ?? {}) as never, time: { day: 3, hour: 10, minute: 0 }, flags: (o.flags ?? {}) as never },
  })
  if (o.entry) game.commit(entrySnapshot())
  const base = o.setup ?? BATTLE_SETUPS.hopeless()
  const setup: BattleSetup = {
    ...base,
    ...(o.foes ? { foes: o.foes.map((enemy) => ({ from: 'unit', unit: enemyUnit('boss', 1, { enemy }) as unknown as Record<string, unknown> })) } : {}),
    origin: { ...(base.origin ?? { escapable: false }), ...(o.faction !== undefined ? { faction: o.faction } : {}), ...(o.ext ? { ext: o.ext } : {}) },
  }
  game.startBattle(setup)
  return game
}
type G = ReturnType<typeof arena>

/** 把戰鬥打到輸（或投降）並結算：回傳結算時提交的報告。 */
async function lose(g: G, o: { surrender?: boolean } = {}): Promise<Report[]> {
  if (o.surrender) g.state.battle!.result = { outcome: 'surrender', text: '投降。' }
  else playOut(g)
  const { result, violations } = await observed(g, () => g.finishBattle())
  expect(violations).toEqual([])
  return result.reports
}
const play = async (o: Opts = {}, l: { surrender?: boolean } = {}) => {
  const g = arena(o)
  const reports = await lose(g, l)
  return { g, reports }
}
const actions = (rs: Report[]) => rs.map((r) => r.action)
const pickOpt = (g: G, id: string): Report[] => g.commit(chooseOption(g.k, g.state, id))
const eventHere = (g: G) => eventView(g.k, g.state)
const asked = (g: G) => defeatView(g.k, g.state)!

/** 事件的選項寫了一組，之後在存檔規則下被改寫。 */
const SIGNED = df('df_t', {
  factions: ['hizakura'], fails_commission: true,
  versions: one(opt('o1', '簽字。', { outcomes: { any: [cash(-5000), flag('signed')] } })),
})

// ---- 選哪一件 ----

describe('選哪一件：五個順位（ENEMIES 第 6 節）', () => {
  const game = (o: Opts = {}) => makeGame({ features: [defeatFeature, enemyStub, directorFeature], content: [PACK(o.events ?? BASE_EVENTS)], pc: { gender: o.gender ?? 'female' }, patch: { flags: (o.flags ?? {}) as never, rules: (o.rules ?? {}) as never } }).game
  const pick = (g: ReturnType<typeof game>, o: Parameters<typeof pickDefeat>[2]) => pickDefeat(g.k, g.state, o)

  it('順序：天使急救（旗標加上有 angel 的事件）、副本自訂的、個別敵人寫的、勢力的預設、通用的', () => {
    const g = game({ flags: { angel_member: true } })
    const all = { faction: 'hizakura', roll: 0.1, event: 'df_custom', enemies: ['df_own'] }
    expect(pick(g, all)).toMatchObject({ event: 'df_angel', tier: 'angel', fails_commission: false })
    const plain = game()
    expect(pick(plain, all)).toMatchObject({ event: 'df_custom', tier: 'origin' })
    expect(pick(plain, { faction: 'hizakura', roll: 0.1, enemies: ['df_own'] })).toMatchObject({ event: 'df_own', tier: 'enemy' })
    expect(pick(plain, { faction: 'hizakura', roll: 0.1 })).toMatchObject({ event: 'df_arrest', tier: 'faction' })
    expect(pick(plain, { faction: 'unknown', roll: 0.1 })).toMatchObject({ event: 'df_generic', tier: 'generic' })
    expect(pick(plain, { roll: 0.1 })).toMatchObject({ event: 'df_generic', tier: 'generic' })
  })

  it('有旗標沒有 angel 的事件、副本自訂的 id 查不到、敵人寫的查不到：都往下一個順位', () => {
    const noAngel = BASE_EVENTS.filter((e) => e.id !== 'df_angel')
    expect(pick(game({ flags: { angel_member: true }, events: noAngel }), { faction: 'nora', roll: 0.1 })).toMatchObject({ event: 'df_robbed', tier: 'faction' })
    const g = game()
    expect(pick(g, { faction: 'nora', roll: 0.1, event: 'df_nowhere' })).toMatchObject({ event: 'df_robbed' })
    expect(pick(g, { faction: 'nora', roll: 0.1, enemies: ['df_nowhere'] })).toMatchObject({ event: 'df_robbed' })
  })

  it('用到被關掉的標籤時沿著 fallback 找，找不到就用通用的；男性主角走 masc', () => {
    const g = game({ rules: { contentOff: ['pc_unwilling'] } })
    expect(pick(g, { faction: 'hizakura', roll: 0.1 })).toMatchObject({ event: 'df_arrest_plain' })
    const noFallback = game({ rules: { contentOff: ['pc_unwilling'] }, events: [df('df_a', { factions: ['hizakura'], tags: ['pc_unwilling'] }), df('df_generic', { default: true })] })
    expect(pick(noFallback, { faction: 'hizakura', roll: 0.1 })).toMatchObject({ event: 'df_generic', tier: 'generic' })
    const masc = [df('df_m', { factions: ['nora'], versions: { default: { text: 'd', stages: [{ options: [opt('o1', 'x')] }] }, masc: { text: 'm', stages: [{ inherit: 'default.stages.0' }] } } }), df('df_generic', { default: true })]
    for (const roll of [0.05, 0.5, 0.95]) expect(pick(game({ gender: 'male', events: masc }), { faction: 'nora', roll }).version).toBe('masc')
    expect(pick(game({ gender: 'female', events: masc }), { faction: 'nora', roll: 0.1 }).version).toBe('default')
  })

  it('真的打輸：副本自訂的（origin.ext.defeat_event）、個別敵人、機器贏了用它所屬的勢力、沒有就用場地的勢力', async () => {
    const origin = await play({ faction: 'hizakura', ext: { defeat_event: 'df_custom' } })
    expect(defeatOf(origin.g.state)).toMatchObject({ event: 'df_custom', tier: 'origin' })
    const own = await play({ faction: 'hizakura', foes: ['en_goon', 'en_plain'] })
    expect(defeatOf(own.g.state)).toMatchObject({ event: 'df_own', tier: 'enemy' })
    // 好幾件時照骰值挑一件，同一個種子挑到同一件
    const a = await play({ foes: ['en_goon2'], seed: 5 }), b = await play({ foes: ['en_goon2'], seed: 5 })
    expect(['df_own', 'df_own2']).toContain(defeatOf(a.g.state)!.event)
    expect(defeatOf(a.g.state)!.event).toBe(defeatOf(b.g.state)!.event)
    // 機器贏了（無人機）：用它所屬的伊甸園，不是場地的野良
    const drone = await play({ faction: 'nora', foes: ['en_drone', 'en_drone'] })
    expect(defeatOf(drone.g.state)).toMatchObject({ event: 'df_eden', faction: 'eden' })
    // 人形的機器（機娘）不算：照場地的勢力
    const maid = await play({ faction: 'nora', foes: ['en_maid'] })
    expect(defeatOf(maid.g.state)).toMatchObject({ event: 'df_robbed', faction: 'nora' })
    // 沒有勢力的機器：用場地的 origin.faction
    const none = await play({ faction: 'hizakura', foes: ['en_drone'], content: { enemy: [{ id: 'en_drone', name: '無人機', kind: 'machine' }] } })
    expect(defeatOf(none.g.state)).toMatchObject({ event: 'df_arrest', faction: 'hizakura' })
    // 有天使急救的資格：永遠優先
    const angel = await play({ faction: 'hizakura', flags: { angel_member: true }, ext: { defeat_event: 'df_custom' } })
    expect(defeatOf(angel.g.state)).toMatchObject({ event: 'df_angel', tier: 'angel' })
  })
})

// ---- 演不演 ----

describe('always：打輸之後事件視窗自己開起來，選完才能接受', () => {
  it('同一步裡事件視窗開起來；三選一還不能「接受」（重來可以）；選完事件的選項之後才可以', async () => {
    const { g, reports } = await play({ faction: 'hizakura', events: [SIGNED, df('df_generic', { default: true })] })
    expect(actions(reports)).toEqual(['battle.end', 'defeat.pending', 'event.open'])
    const d = defeatOf(g.state)!
    expect(d).toMatchObject({ event: 'df_t', stage: 'playing', skipped: false, view: 'always', tier: 'faction' })
    expect(eventHere(g)).toMatchObject({ event: 'df_t', options: [{ id: 'o1' }] })
    expect(reports[2]!.timeline[0]!.text).toContain('你醒來的時候人在別的地方。')
    // 接受：函式與提交都擋下（句子是事件視窗給的）
    expect(() => acceptDefeat(g.k, g.state)).toThrow(ActionBlocked)
    expect(g.blockOf('commit:defeat.accept', { changes: [{ op: 'snapshot.drop', kind: 'battle' }] } as unknown as ReportDraft)).toMatch(/先回應/)
    expect(asked(g)).toMatchObject({ step: 'playing', inner: { kind: 'event' } })
    expect(asked(g).choices.find((c) => c.id === 'accept')).toMatchObject({ can: false })
    expect(asked(g).choices.find((c) => c.id === 'retry')).toMatchObject({ can: true })
    // 事件的選項選完
    pickOpt(g, 'o1')
    expect(g.state.money.cash).toBe(0) // 事件寫扣 5,000，身上 2,000
    expect(stageOf(defeatOf(g.state)!)).toBe('played')
    expect(asked(g)).toMatchObject({ step: 'played', inner: null, played: { option: 'o1' } })
    const [accept] = g.commit(acceptDefeat(g.k, g.state))
    expect(accept).toMatchObject({ action: 'defeat.accept', outcome: { result: 'accepted' } })
    expect(defeatOf(g.state)).toBeNull()
    expect(g.pendingDefeat).toBeNull()
    expect(g.state.snapshots).toEqual([])
    expect(g.state.money.cash).toBe(0) // 演過了，接受時不會再扣一次
    expect(g.blockOf('chain:free_action')).toBeNull()
  })

  it('投降走同一條', async () => {
    const { g, reports } = await play({ faction: 'hizakura', events: [SIGNED, df('df_generic', { default: true })] }, { surrender: true })
    expect(actions(reports)).toEqual(['battle.end', 'defeat.pending', 'event.open'])
    expect(defeatOf(g.state)).toMatchObject({ outcome: 'surrender', stage: 'playing' })
  })

  it('舊格式（每一版只有 text 與 effects）照樣收，當成只有一段、一個選項；走得完', async () => {
    const legacy = df('df_generic', { default: true, versions: { default: { text: '你醒來的時候人在巷子裡。', effects: [cash(-300), { kind: 'time', hours: 6 }] } } })
    const { g } = await play({ events: [legacy] })
    expect(eventHere(g)).toMatchObject({ event: 'df_generic', stage: { count: 1 }, options: [{ id: 'o1' }] })
    const t = g.state.time
    pickOpt(g, 'o1')
    expect(g.state.money.cash).toBe(1700)
    expect(g.state.time.hour).toBe((t.hour + 6) % 24)
    g.commit(acceptDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
  })

  it('同一個種子結果一樣；開著事件存檔再讀，選項與結果不變', async () => {
    const run = async () => (await play({ faction: 'hizakura', events: [SIGNED, df('df_generic', { default: true })] }, {})).g
    const a = await run(), b = await run()
    expect(JSON.stringify(defeatOf(a.state))).toBe(JSON.stringify(defeatOf(b.state)))
    const text = a.save('manual', 't')
    expect(a.load(text)).toBeNull()
    expect(eventHere(a)).toMatchObject({ event: 'df_t' })
    expect(asked(a)).toMatchObject({ step: 'playing' })
    pickOpt(a, 'o1')
    pickOpt(b, 'o1')
    expect(a.state.money.cash).toBe(b.state.money.cash)
    a.commit(acceptDefeat(a.k, a.state))
    expect(a.state.snapshots).toEqual([])
  })

  it('事件的 inherit 與版本：男性主角走 masc，那一段的選項和被繼承的一樣', async () => {
    const e = df('df_generic', {
      default: true,
      versions: {
        default: { text: '一般的版本。', stages: [{ options: [opt('o1', '照辦。', { outcomes: { any: [flag('did')] } }), opt('o2', '拖延。')] }] },
        masc: { text: '男性被動的版本。', stages: [{ inherit: 'default.stages.0' }] },
      },
    })
    const { g } = await play({ events: [e], gender: 'male' })
    expect(eventHere(g)).toMatchObject({ version: 'masc', text: expect.stringContaining('男性被動的版本。'), options: [{ id: 'o1' }, { id: 'o2' }] })
    pickOpt(g, 'o1')
    expect(g.state.flags.did).toBe(true)
  })
})

describe('自由回應', () => {
  it('事件開著時直接做自由行動：事件以 free 收尾，之後可以接受', async () => {
    const { g } = await play({ faction: 'hizakura', events: [SIGNED, df('df_generic', { default: true })] })
    expect(g.blockOf('chain:free_action')).toBeNull()
    const r = await g.act({ kind: 'free', text: '我掏出藏在袖子裡的東西。' })
    expect(r.status).toBe('applied')
    expect(eventHere(g)).toBeNull()
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', played: { option: 'free' } })
    expect(g.state.flags.signed).toBeUndefined()
    g.commit(acceptDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
  })
})

describe('兩段的戰敗事件', () => {
  const TWO = df('df_two', {
    factions: ['hizakura'],
    versions: {
      default: {
        text: '兩段。',
        stages: [
          { options: [opt('a1', '忍著。', { outcomes: { any: [cash(-100), flag('stage1')] } })] },
          { text: '第二段。', options: [opt('b1', '賭一把。', { check: ['composure', 'resolve', 40], outcomes: { success: [flag('won')], fail: [cash(-200), flag('second_failed')] } })] },
        ],
      },
    },
  })

  it('兩段都選完才算做完；第二段的檢定失敗時那一組效果真的套了；活動結束時才回到三選一', async () => {
    const { g } = await play({ faction: 'hizakura', events: [TWO, df('df_generic', { default: true })] })
    expect(eventHere(g)).toMatchObject({ stage: { index: 0, count: 2 } })
    pickOpt(g, 'a1')
    expect(g.state.flags.stage1).toBe(true)
    expect(stageOf(defeatOf(g.state)!)).toBe('playing') // 還有第二段
    expect(() => acceptDefeat(g.k, g.state)).toThrow(ActionBlocked)
    expect(eventHere(g)).toMatchObject({ stage: { index: 1, count: 2 }, text: '第二段。' })
    pickOpt(g, 'b1')
    expect(g.state.flags.second_failed).toBe(true)
    expect(g.state.flags.won).toBeUndefined()
    expect(g.state.money.cash).toBe(1700)
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', played: { option: 'b1', degree: expect.stringMatching(/fail|fumble/) } })
    g.commit(acceptDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
  })
})

describe('skippable：先問；選不看就照「不演」結算。never：不開事件，只有結果', () => {
  const E = df('df_t', {
    factions: ['hizakura'],
    versions: {
      default: {
        text: '兩段。',
        stages: [
          { options: [opt('a1', '忍著。', { outcomes: { any: [cash(-100), flag('stage1')] } }), opt('a2', '反抗。', { outcomes: { any: [flag('never_here')] } })] },
          { options: [opt('b1', '賭一把。', { check: ['composure', 'resolve', 40], outcomes: { success: [flag('won')], fail: [cash(-200), flag('second_failed')] } })] },
        ],
      },
    },
  })
  const events = [E, df('df_generic', { default: true })]

  it('skippable：事件沒有開；可以選要看（事件視窗開起來）或不看；三選一要等決定之後', async () => {
    const { g, reports } = await play({ faction: 'hizakura', events, rules: { defeatView: 'skippable' } })
    expect(actions(reports)).toEqual(['battle.end', 'defeat.pending'])
    expect(defeatOf(g.state)).toMatchObject({ stage: 'ask', skipped: false, view: 'skippable' })
    expect(eventHere(g)).toBeNull()
    expect(() => acceptDefeat(g.k, g.state)).toThrow(/先決定要不要看/)
    expect(asked(g).choices.filter((c) => c.can).map((c) => c.id)).toEqual(['watch', 'skip', 'retry', 'stage'])
    // 選要看
    const watched = g.commit(watchDefeat(g.k, g.state))
    expect(actions(watched)).toEqual(['defeat.view', 'event.open'])
    expect(defeatOf(g.state)).toMatchObject({ stage: 'playing' })
    expect(() => acceptDefeat(g.k, g.state)).toThrow(ActionBlocked)
    expect(() => skipDefeat(g.k, g.state)).toThrow(/現在不用決定/)
  })

  it('選不看：照「不演」結算（每一段走第一個選項、有檢定的照擲，一次結算）；不開事件', async () => {
    const { g } = await play({ faction: 'hizakura', events, rules: { defeatView: 'skippable' } })
    const [skip] = g.commit(skipDefeat(g.k, g.state))
    expect(skip).toMatchObject({ action: 'defeat.skip' })
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', skipped: true })
    expect(eventHere(g)).toBeNull()
    expect(g.state.money.cash).toBe(2000) // 接受之前什麼都還沒發生
    const rng = g.state.rng.cursor
    const [accept] = g.commit(acceptDefeat(g.k, g.state))
    expect(accept!.timeline.filter((b) => b.roll)).toHaveLength(1)
    expect(g.state.rng.cursor).toBe(rng + 1) // 接受那一份擲了一次，游標往前一步
    expect(g.state.flags.stage1).toBe(true)
    expect(g.state.flags.never_here).toBeUndefined()
    expect(g.state.flags.second_failed).toBe(true) // DC 40：擲壞，走 fail 那一組
    expect(g.state.money.cash).toBe(1700)
    expect(accept!.narration!.results).toEqual(expect.arrayContaining(['失去：現金 100', '失去：現金 200']))
  })

  it('不看的設定只能在 skippable 用：always 與 never 選不看都被擋下', async () => {
    const always = await play({ faction: 'hizakura', events, rules: { defeatView: 'always' }, features: [ransomStub] })
    expect(() => skipDefeat(always.g.k, always.g.state)).toThrow(/一律要看/)
    const never = await play({ faction: 'hizakura', events, rules: { defeatView: 'never' } })
    expect(() => skipDefeat(never.g.k, never.g.state)).toThrow(/不看戰敗事件/)
    expect(() => watchDefeat(never.g.k, never.g.state)).toThrow(/只列出結果/)
  })

  it('never：不開事件，直接只有結果（stage played、skipped），接受時照不演結算', async () => {
    const { g, reports } = await play({ faction: 'hizakura', events, rules: { defeatView: 'never' } })
    expect(actions(reports)).toEqual(['battle.end', 'defeat.pending'])
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', skipped: true, view: 'never' })
    expect(eventHere(g)).toBeNull()
    expect(reports[1]!.narration!.results).toEqual(defeatOf(g.state)!.lines)
    expect(defeatOf(g.state)!.lines).toEqual(expect.arrayContaining(['失去：現金 100', expect.stringMatching(/第 2 段.*檢定/)])) // 預覽不擲骰，只提醒
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.state.money.cash).toBe(1700)
    expect(defeatOf(g.state)).toBeNull()
  })
})

// ---- 存檔規則的改寫 ----

describe('存檔規則：扣現金的上限、拿走裝備', () => {
  const cashEvent = df('df_t', { factions: ['hizakura'], versions: one(opt('o1', '簽字。', { outcomes: { any: [cash(-5000), flag('signed')] } })) })
  const events = [cashEvent, df('df_generic', { default: true })]
  const rules = { defeatMoneyLoss: 0.5, defeatMoneyCap: 300 }

  it('事件寫扣現金 5,000、身上 1,000、比例 0.5、金額上限 300 → 只扣 300（演的時候）', async () => {
    const { g } = await play({ faction: 'hizakura', events, cash: 1000, rules })
    expect(asked(g).accept).toMatchObject({ money_max: 300, gear_taken: true })
    pickOpt(g, 'o1')
    expect(g.state.money.cash).toBe(700)
    expect(g.state.flags.signed).toBe(true)
  })

  it('不演的時候同樣是 300', async () => {
    const { g } = await play({ faction: 'hizakura', events, cash: 1000, rules: { ...rules, defeatView: 'never' } })
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.state.money.cash).toBe(700)
  })

  it('比例與上限各自管：只有比例、只有上限、比例 0', async () => {
    const lost = async (r: Record<string, unknown>) => {
      const { g } = await play({ faction: 'hizakura', events, cash: 1000, rules: r })
      pickOpt(g, 'o1')
      return 1000 - g.state.money.cash
    }
    expect(await lost({})).toBe(1000)
    expect(await lost({ defeatMoneyLoss: 0.5 })).toBe(500)
    expect(await lost({ defeatMoneyCap: 200 })).toBe(200)
    expect(await lost({ defeatMoneyLoss: 0 })).toBe(0)
  })

  it('每一組結果各自照上限減（從後面往回減，減到 0 的拿掉）；帳戶與指示不受影響', () => {
    const rw = { money: 300, gear: null }
    expect(rewriteEffects([cash(-200), { kind: 'cred', amount: -999 }, cash(-200), cash(-50), cash(40)], rw)).toEqual([cash(-200), { kind: 'cred', amount: -999 }, cash(-100), cash(40)])
    expect(rewriteEffects([{ kind: 'chain', event: 'x' }, cash(-900)], rw)).toEqual([{ kind: 'chain', event: 'x' }, cash(-300)])
  })

  const gearEvent = (id = 'df_t') => df(id, { factions: ['hizakura'], versions: one(opt('o1', '被搜身。', { outcomes: { any: [{ kind: 'strip_gear', slot: 'torso' }, cash(-100), flag('searched')] } })) })

  it('defeatTakeGear 開著：拿走裝備的效果照常發生', async () => {
    const { g } = await play({ faction: 'hizakura', events: [gearEvent(), df('df_generic', { default: true })], features: [gearStub] })
    pickOpt(g, 'o1')
    expect(g.state.flags.stripped_torso).toBe(true)
    expect(g.state.money.cash).toBe(1900)
  })

  it('defeatTakeGear 關著：拿走裝備的那一筆沒有發生，其餘照常（演與不演都一樣）', async () => {
    const off = { defeatTakeGear: false }
    const shown = await play({ faction: 'hizakura', events: [gearEvent(), df('df_generic', { default: true })], features: [gearStub], rules: off })
    expect(asked(shown.g).accept.gear_taken).toBe(false)
    pickOpt(shown.g, 'o1')
    expect(shown.g.state.flags.stripped_torso).toBeUndefined()
    expect(shown.g.state.flags.searched).toBe(true)
    expect(shown.g.state.money.cash).toBe(1900)
    const skipped = await play({ faction: 'hizakura', events: [gearEvent(), df('df_generic', { default: true })], features: [gearStub], rules: { ...off, defeatView: 'never' } })
    skipped.g.commit(acceptDefeat(skipped.g.k, skipped.g.state))
    expect(skipped.g.state.flags.stripped_torso).toBeUndefined()
    expect(skipped.g.state.flags.searched).toBe(true)
  })
})

// ---- 成人場景 ----

describe('選項帶 adult_scene', () => {
  const E = df('df_t', {
    factions: ['hizakura'], adult: true, cast: [{ role: 'a', gen: { name: '回收員' } }],
    versions: one(opt('o1', '拖延。', { outcomes: { any: [flag('stalled')] }, adult_scene: { when: 'always', nature: 'forced', circles: [['$pc', '$a']] } })),
  })
  const events = [E, df('df_generic', { default: true })]

  it('用替身登記 scene 之後場景開得起來；場景結束才回到三選一', async () => {
    const { g } = await play({ faction: 'hizakura', events, features: [sceneStub] })
    const reports = pickOpt(g, 'o1')
    expect(actions(reports)).toEqual(['event.close', 'scene.start'])
    expect(sceneOf(g.state)!.setup).toMatchObject({ nature: 'forced', circles: [[g.state.pc, expect.stringMatching(/^tmp_/)]] })
    expect(sceneOf(g.state)!.origin).toMatchObject({ by: 'director', ext: { caller: 'defeat' } })
    expect(asked(g)).toMatchObject({ step: 'playing', inner: { kind: 'scene' } })
    expect(() => acceptDefeat(g.k, g.state)).toThrow(/場景進行中/)
    g.commit(sceneEnd())
    expect(asked(g)).toMatchObject({ step: 'played', inner: null })
    g.commit(acceptDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
  })

  it('沒有人登記 scene：不開場景、不丟錯，事件做完直接可以接受', async () => {
    const { g } = await play({ faction: 'hizakura', events })
    expect(actions(pickOpt(g, 'o1'))).toEqual(['event.close'])
    expect(() => g.commit(acceptDefeat(g.k, g.state))).not.toThrow()
  })
})

// ---- 接受 ----

describe('接受：activity.end（kind defeat）', () => {
  const ev = (flags: string[] = [], fails = true) => [df('df_t', { factions: ['hizakura'], fails_commission: fails, versions: one(opt('o1', '照辦。', { flags, outcomes: { any: [flag('done')] } }), opt('o2', '拒絕。', { flags: ['fail'] })) }), df('df_generic', { default: true })]
  const origin = { by: 'caller', ref: 'r1', stage: 2 }

  it('收到 activity.end：outcome 是 accept，result 與 origin 都對；fails_commission 照事件的', async () => {
    const log: Heard[] = []
    const { g } = await play({ faction: 'hizakura', events: ev(), features: [caller(log)], ext: origin })
    pickOpt(g, 'o1')
    const [accept] = g.commit(acceptDefeat(g.k, g.state))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      kind: 'defeat', outcome: 'accept',
      result: { event: 'df_t', kind: 'generic', fails_commission: true, option: 'o1' },
      origin: { by: 'caller', ref: 'r1', ext: { stage: 2 } },
    })
    expect(log[0]!.result.battle).toMatch(/^b\d+$/)
    expect(Object.keys(log[0]!.result).sort()).toEqual(['battle', 'event', 'fails_commission', 'kind', 'option'])
    // 處理函式回傳的句子進了結果
    expect(accept!.narration!.results).toContain('發起的人收到了戰敗的結果')
    expect(accept!.outcome.summary).toMatch(/委託算失敗/)
  })

  it('選項寫了 no_fail 時是 false（事件預設算失敗）；寫了 fail 時是 true（事件預設不算）', async () => {
    const log: Heard[] = []
    const a = await play({ faction: 'hizakura', events: ev(['no_fail']), features: [caller(log)], ext: origin })
    pickOpt(a.g, 'o1')
    expect(defeatOf(a.g.state)!.fails_commission).toBe(false)
    const [accept] = a.g.commit(acceptDefeat(a.g.k, a.g.state))
    expect(log[0]!.result.fails_commission).toBe(false)
    expect(accept!.outcome.summary).toMatch(/委託還在/)
    const b = await play({ faction: 'hizakura', events: ev([], false), features: [caller(log)], ext: origin })
    pickOpt(b.g, 'o2')
    b.g.commit(acceptDefeat(b.g.k, b.g.state))
    expect(log[1]!.result).toMatchObject({ fails_commission: true, option: 'o2' })
  })

  it('不演的時候：option 是 skip，旗標照第一個選項的；fails_commission 同樣算', async () => {
    const log: Heard[] = []
    const { g } = await play({ faction: 'hizakura', events: ev(['no_fail']), features: [caller(log)], ext: origin, rules: { defeatView: 'never' } })
    g.commit(acceptDefeat(g.k, g.state))
    expect(log[0]!.result).toMatchObject({ option: 'skip', fails_commission: false })
  })

  it('處理函式回傳的 rewind 出現在 defeat.accept 上，而且真的回到入口（事件扣的錢也回去）', async () => {
    const log: Heard[] = []
    const rewind = { kind: 'entry', summary: '你在入口前停下，剛才那一切像一場太真的預演。' }
    const g = arena({ faction: 'hizakura', events: ev(), features: [caller(log, rewind)], ext: origin, entry: true })
    await lose(g)
    pickOpt(g, 'o1')
    expect(g.state.flags.done).toBe(true)
    const reports = g.commit(acceptDefeat(g.k, g.state))
    expect(reports[0]).toMatchObject({ action: 'defeat.accept', rewind })
    expect(g.state.flags.done).toBeUndefined()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.money.cash).toBe(2000)
    expect(reports[0]!.retracted).toBe(true)
  })

  it('同行的人寫進結果的一行（投降一樣）', async () => {
    const actors = [makeActor({ id: 'npc_ann', name: '安', role: 'npc' })]
    for (const surrender of [false, true]) {
      const { g } = await play({ faction: 'hizakura', events: ev(), features: [companionStub], actors }, { surrender })
      expect(asked(g).accept.companions).toEqual(['安'])
      pickOpt(g, 'o1')
      const [accept] = g.commit(acceptDefeat(g.k, g.state))
      expect(accept!.narration!.results).toContain('同行的安跟著你一起被處置。')
    }
  })

  it('沒有等待中的戰敗：接受、跳過、看都丟錯', () => {
    const g = arena()
    expect(() => acceptDefeat(g.k, g.state)).toThrow(/沒有等待中的戰敗/)
    expect(() => watchDefeat(g.k, g.state)).toThrow(/沒有等待中的戰敗/)
    expect(defeatView(g.k, g.state)).toBeNull()
  })
})

// ---- chain ----

describe('事件 chain：第二件的 origin.by 是 director，戰敗要讀 result 才知道', () => {
  it('第二件做完才能接受；第二件的旗標也算（no_fail 蓋掉事件預設）', async () => {
    const log: Heard[] = []
    const E = df('df_t', { factions: ['hizakura'], fails_commission: true, versions: one(opt('o1', '被帶走。', { outcomes: { any: [{ kind: 'chain', event: 'ev_follow' }] } })) })
    const { g } = await play({ faction: 'hizakura', events: [E, df('df_generic', { default: true })], features: [caller(log)], ext: { by: 'caller', ref: 'r1' } })
    const closed = pickOpt(g, 'o1')
    expect(actions(closed)).toEqual(['event.close', 'event.open'])
    // 第一件的 activity.end 沒有把第二件交回戰敗：看得到的是它自己的 origin
    expect(eventHere(g)).toMatchObject({ event: 'ev_follow', origin: { by: 'director', ext: { caller: 'defeat', chain: true } } })
    expect(asked(g)).toMatchObject({ step: 'playing', inner: { kind: 'event' } })
    expect(() => acceptDefeat(g.k, g.state)).toThrow(ActionBlocked)
    pickOpt(g, 'f1')
    expect(g.state.flags.followed).toBe(true)
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', fails_commission: false, played: { option: 'o1', chained: 'f1', flags: ['no_fail'] } })
    g.commit(acceptDefeat(g.k, g.state))
    expect(log[0]!.result).toMatchObject({ fails_commission: false, option: 'o1' })
  })
})

// ---- 重來 ----

describe('重來這場戰鬥、回到階段', () => {
  const events = [SIGNED, df('df_generic', { default: true })]

  it('演完事件之後選「重來」：事件扣的錢回來了，那幾份報告標成被收回；事件視窗與等待中的戰敗都沒了', async () => {
    const { g } = await play({ faction: 'hizakura', events, cash: 2000 })
    pickOpt(g, 'o1')
    expect(g.state.money.cash).toBe(0)
    expect(g.retryBattle()).toBeNull()
    expect(g.state.money.cash).toBe(2000)
    expect(defeatOf(g.state)).toBeNull()
    expect(eventHere(g)).toBeNull()
    expect(g.battle).toMatchObject({ round: 1 })
    const retracted = g.state.reports.filter((r) => r.retracted).map((r) => r.action)
    expect(retracted).toEqual(expect.arrayContaining(['event.open', 'event.close', 'defeat.pending', 'battle.end']))
  })

  it('事件正在演的時候也可以重來（三選一裡只有接受要等）', async () => {
    const { g } = await play({ faction: 'hizakura', events })
    expect(eventHere(g)).not.toBeNull()
    expect(g.retryBattle()).toBeNull()
    expect(eventHere(g)).toBeNull()
    expect(g.battle).not.toBeNull()
  })

  it('回到這個階段開始時：副本以外等於重來', async () => {
    const { g } = await play({ faction: 'hizakura', events })
    expect(g.rewindToStage()).toBeNull()
    expect(g.battle).toMatchObject({ round: 1 })
    expect(defeatOf(g.state)).toBeNull()
  })
})

// ---- 別的功能多給的選項 ----

describe('被贖回：defeat.options', () => {
  const events = [SIGNED, df('df_generic', { default: true })]

  it('有被贖回的選項時不論哪一檔都先問（always 不自己開事件）', async () => {
    for (const view of ['always', 'skippable'] as const) {
      const { g, reports } = await play({ faction: 'hizakura', events, features: [ransomStub], rules: { defeatView: view } })
      expect(actions(reports)).toEqual(['battle.end', 'defeat.pending'])
      expect(defeatOf(g.state)).toMatchObject({ stage: 'ask', skipped: false })
      expect(eventHere(g)).toBeNull()
      expect(defeatOptions(g.k, g.state).map((o) => o.id)).toEqual(['ransom'])
      expect(asked(g).choices.map((c) => [c.id, c.can])).toEqual(expect.arrayContaining([['ransom', true], ['watch', true]]))
    }
  })

  it('選了被贖回：不演事件，照那個選項結算，發 activity.end（option 是 ransom）', async () => {
    const log: Heard[] = []
    const { g } = await play({ faction: 'hizakura', events, features: [ransomStub, caller(log)], ext: { by: 'caller', ref: 'r1' } })
    const [r] = g.commit(chooseDefeatOption(g.k, g.state, 'ransom'))
    expect(r).toMatchObject({ action: 'defeat.option', outcome: { result: 'ransom' } })
    expect(g.state.money.cash).toBe(1500)
    expect(g.state.flags.signed).toBeUndefined()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.snapshots).toEqual([])
    expect(log[0]).toMatchObject({ outcome: 'accept', result: { event: 'df_t', option: 'ransom', fails_commission: true } })
  })

  it('先問的時候也可以照常：選要看之後事件演過了，被贖回就不再提供（事件的效果已經發生）', async () => {
    const { g } = await play({ faction: 'hizakura', events, features: [ransomStub] })
    g.commit(watchDefeat(g.k, g.state))
    expect(() => chooseDefeatOption(g.k, g.state, 'ransom')).toThrow(ActionBlocked) // 事件正在演
    pickOpt(g, 'o1')
    expect(defeatOptions(g.k, g.state)).toEqual([])
    expect(() => chooseDefeatOption(g.k, g.state, 'ransom')).toThrow(/沒有「ransom」/)
    g.commit(acceptDefeat(g.k, g.state))
  })

  it('never 加上選項：不演事件，不用另外先問；選項與接受都可以', async () => {
    const { g } = await play({ faction: 'hizakura', events, features: [ransomStub], rules: { defeatView: 'never' } })
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', skipped: true })
    expect(defeatOptions(g.k, g.state)).toHaveLength(1)
    g.commit(chooseDefeatOption(g.k, g.state, 'ransom'))
    expect(g.state.money.cash).toBe(1500)
  })
})

// ---- 事件演不了 ----

describe('事件演不起來：不讓打輸的這一步整個回滾', () => {
  it('事件視窗不收（選項超過四個）：改成只列出結果，不演版照走，結果裡寫明原因', async () => {
    const five = df('df_t', { factions: ['hizakura'], versions: one(...['a', 'b', 'c', 'd', 'e'].map((id) => opt(id, `選項${id}。`, id === 'a' ? { outcomes: { any: [cash(-100)] } } : {}))) })
    const { g, reports } = await play({ faction: 'hizakura', events: [five, df('df_generic', { default: true })] })
    expect(actions(reports)).toEqual(['battle.end', 'defeat.pending'])
    expect(defeatOf(g.state)).toMatchObject({ stage: 'played', skipped: true })
    expect((reports[1]!.narration?.results ?? []).join('')).toMatch(/戰敗事件開不起來/)
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.state.money.cash).toBe(1900)
  })

  it('沒有事件視窗（沒有人登記活動 event）：照 M1，一律只列出結果', async () => {
    const g = (() => {
      const { game } = makeGame({ features: [defeatFeature, TEST_COMBAT, enemyStub, directorFeature], content: [PACK(BASE_EVENTS, {})], seed: 2 })
      game.startBattle(BATTLE_SETUPS.hopeless())
      return game
    })()
    playOut(g)
    await g.finishBattle()
    expect(defeatOf(g.state)).toMatchObject({ skipped: true, stage: 'played', view: 'always' })
    expect(g.blockOf('chain:free_action')).toMatch(/戰敗的三個選擇/)
  })
})

describe('等待中的戰敗：沒有 stage 的舊存檔當成 played', () => {
  it('stageOf', () => {
    expect(stageOf({ event: 'x', version: 'default', outcome: 'lose', fails_commission: true, lines: [], choices: ['accept', 'retry', 'stage'], view: 'always', skipped: true, battle: 'b1' })).toBe('played')
  })
})
