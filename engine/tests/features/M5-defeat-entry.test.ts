// 驗收測試：dev/work/M5-defeat-entry.md。features/defeat 的入口（活動 defeat.entry）：不從戰鬥來的戰敗——抽事件、三種演法、沒有戰鬥的預設、
// 等三選一的放行、接受、重來與回到階段、沒有事件可演的退路、壞的設定；接上 opinion（被對手帶走）與真的 commission（被帶走之後委託失敗回到入口）。
// 規格：COMBAT_SYSTEM 8.3、8.4 節；DEFEAT_EVENTS 開頭；OPINION 第 6 節「找上門」；dev/adr/0020「實作補記：M5-defeat-entry」。
// 內容一律用測試自帶的最小假資料。事件視窗用真的（director 的 eventRunFeature）；其餘用替身：
//   host        發起的人：登記一種玩具活動（order 90，像副本）、存入口與階段的快照、聽 activity.end（kind defeat），可以回傳 rewind
//   enemyStub   敵人的內容種類；gearStub 一種「拿走身上裝備」的效果；ransomStub  defeat.options 的回答
// 第三、四組是 opinion 與 commission 接上（toy 的副本與真的 commission）。骰面從存檔的亂數導出；要擲壞的檢定用 DC 40。

import { describe, expect, it } from 'vitest'
import type { Actor, Change, ContentPack, Effect, Feature, GameState, Origin, Report, ReportDraft } from '../../src'
import { ActionBlocked, meterOf } from '../../src'
import { chooseOption, directorFeature, eventRunFeature, eventView } from '../../src/features/director'
import {
  DEFEAT_ENTRY, acceptDefeat, chooseDefeatOption, defeatEntryLaunch, defeatFeature, defeatOf, defeatView, enterDefeat, entryProblem, retryDefeat, skipDefeat, stageDefeat, watchDefeat,
} from '../../src/features/defeat'
import type { DefeatEntrySetup } from '../../src/features/defeat'
import { commissionFeature, chooseBranch, chooseFace, readRun, replay } from '../../src/features/commission'
import { answerBribe, opinionFeature, readWar, resolveVisit, startWar, endTurn } from '../../src/features/opinion'
import { BATTLE_SETUPS, METER_CONTENT, TEST_COMBAT, makeActor, makeGame, observed, playOut } from '../../src/testkit'

type Rec = Record<string, any>
type Fx = Record<string, unknown>

// ===================================================================================================================
// 替身
// ===================================================================================================================

interface Heard { kind: string; id: string; origin: Origin; outcome: string; result: Rec }
const HEARD: Heard[] = []
const HOST = { rewind: false }

const draftOf = (state: GameState, action: string, changes: Change[], more: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'action', action, location: { ...state.location }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...more,
})

/** 發起的人：一種玩具活動（像委託副本，order 90），放行戰敗的報告與事件視窗（真的副本也這樣列）；聽戰敗被接受，HOST.rewind 時失敗就回到入口。 */
const host: Feature = {
  id: 'host',
  install(k) {
    k.activity.define({
      kind: 'hostact', owner: 'host', order: 90,
      active: (s) => (s.ext.host ? { id: 'h1', label: '玩具副本' } : null),
      allow: ['commit:host.', 'commit:defeat.', 'commit:event.', 'event.start', 'chain:free_action', 'battle.start', 'commit:battle.', 'battle.', 'chain:battle_end'],
      reason: () => '玩具副本進行中。',
    })
    k.hooks.on('activity.end', 'host', ({ kind, id, origin, outcome, result }) => {
      if (kind !== 'defeat' || origin.by !== 'host') return undefined
      HEARD.push({ kind, id, origin, outcome, result: result as Rec })
      if (HOST.rewind && result.fails_commission === true) return { lines: ['玩具副本失敗了'], rewind: { kind: 'entry', summary: '你回到入口。', fresh: true } }
      return { lines: ['發起的人收到了戰敗的結果'] }
    })
  },
}
const enemyStub: Feature = { id: 'enemy_stub', install: (k) => k.content.defineKind({ kind: 'enemy', owner: 'enemy_stub', validate: () => [] }) }
const gearStub: Feature = {
  id: 'gear_stub',
  install(k) {
    k.effects.register<{ kind: string; slot: string }>({
      kind: 'strip_gear', owner: 'gear_stub', validate: (raw) => (typeof raw.slot === 'string' ? [] : ['slot 要是字串']),
      toChanges: (e) => [{ op: 'flag', key: `stripped_${e.slot}`, value: true }], describe: (e) => `被拿走：${e.slot}`,
    })
    k.hooks.on('defeat.gear', 'gear_stub', ({ effect }) => effect.kind === 'strip_gear')
  },
}
const ransomStub: Feature = {
  id: 'ransom_stub',
  install: (k) => void k.hooks.on('defeat.options', 'ransom_stub', ({ pending }) => [{
    id: 'ransom', name: '被贖回', desc: '付 500 C$，跳過戰敗事件。', blocks: [], changes: [{ op: 'cash', delta: -500 }], lines: ['付了贖金。'],
    summary: `你們被贖回來了。${pending.entry ? `（${pending.entry.reason}）` : ''}`,
  }]),
}

// ---- 假資料 ----

const cash = (amount: number): Effect & { amount: number } => ({ kind: 'cash', amount })
const flag = (key: string): Effect => ({ kind: 'flag', key, value: true })
const opt = (id: string, text: string, o: Fx = {}): Fx => ({ id, text, outcomes: { any: [] }, ...o })
const df = (id: string, o: Fx = {}): Fx => ({ id, name: id, kind: 'generic', factions: [], fails_commission: true, versions: { default: { text: `${id}：開頭。`, stages: [{ options: [opt('o1', '繼續。')] }] } }, ...o })
const one = (...options: Fx[]): Fx => ({ default: { text: '你醒來的時候人在別的地方。', stages: [{ options }] } })

const PACK = (events: Fx[]): ContentPack => ({
  id: 'defeat_entry',
  content: {
    faction: [{ id: 'hizakura', name: '緋櫻重工', short: '緋櫻', class: 'corp' }, { id: 'nora', name: '野良', short: '野良', class: 'street' }, { id: 'eden', name: '伊甸園', short: '伊甸', class: 'corp' }],
    event_scope: [{ id: 'street', triggers: { enter_block: 1 } }],
    enemy: [
      { id: 'en_goon', name: '打手', faction: 'nora', kind: 'human', defeat: 'df_own' },
      { id: 'en_goon2', name: '打手乙', faction: 'nora', kind: 'human', defeat: ['df_own', 'df_own2'] },
      { id: 'en_plain', name: '保全', faction: 'hizakura', kind: 'human' },
    ],
    defeat_event: events,
  } as unknown as ContentPack['content'],
})

const BASE_EVENTS = [
  df('df_arrest', { factions: ['hizakura'], tags: ['pc_unwilling'], fallback: 'df_arrest_plain' }),
  df('df_arrest_plain', { factions: [] }),
  df('df_robbed', { factions: ['nora'], fails_commission: false }),
  df('df_own', { factions: [] }),
  df('df_own2', { factions: [] }),
  df('df_custom', { factions: [] }),
  df('df_angel', { factions: [], angel: true, fails_commission: false }),
  df('df_generic', { factions: [], default: true }),
]
/** 一件寫了錢、旗標的事件（接受與存檔規則用）。 */
const SIGNED = df('df_t', { factions: ['hizakura'], versions: one(opt('o1', '簽字。', { outcomes: { any: [cash(-5000), flag('signed')] } })) })
/** 一件有「砸開門」的事件：選了開一場戰鬥（劫囚之類）。 */
const JAILBREAK = df('df_jail', {
  factions: ['hizakura'],
  versions: { default: { text: '你被關進了牢房。', stages: [{ options: [opt('break', '砸開門。', { outcomes: { any: [{ kind: 'fight', foes: BATTLE_SETUPS.encounter().foes }] } }), opt('wait', '等著。')] }] } },
})

interface Opts {
  events?: Fx[]
  features?: Feature[]
  rules?: Record<string, unknown>
  cash?: number
  seed?: number
  gender?: string
  flags?: Record<string, unknown>
  actors?: Actor[]
  /** 發起的人開著：存入口的快照（與 snaps 指定的別的快照）；失敗時回到入口 */
  host?: boolean
  snaps?: string[]
  rewind?: boolean
}

const make = (o: Opts = {}) => {
  HEARD.length = 0
  HOST.rewind = o.rewind ?? false
  const { game } = makeGame({
    features: [defeatFeature, TEST_COMBAT, directorFeature, eventRunFeature, enemyStub, host, ...(o.features ?? [])], content: [PACK(o.events ?? BASE_EVENTS)], seed: o.seed ?? 2,
    pc: { gender: o.gender ?? 'female', skills: { composure: 1 } }, actors: o.actors,
    patch: { money: { cred: 0, cash: o.cash ?? 2000 }, rules: (o.rules ?? {}) as never, time: { day: 3, hour: 10, minute: 0 }, flags: (o.flags ?? {}) as never, location: { district: 'd_x' } } as Partial<GameState>,
  })
  if (o.host) {
    game.commit(draftOf(game.state, 'host.start', [{ op: 'snapshot.take', kind: 'entry', label: '入口', owner: 'h1', replace: true } as Change, { op: 'ext', key: 'host', value: { n: 1 } } as Change]))
    for (const kind of o.snaps ?? ['stage']) game.commit(draftOf(game.state, `host.${kind}`, [{ op: 'snapshot.take', kind, label: kind, owner: 'h1', replace: true } as Change]))
  }
  return game
}
type G = ReturnType<typeof make>

const ORIGIN: Origin = { by: 'host', ref: 'h1' }
const enter = (g: G, setup: Partial<DefeatEntrySetup> = {}, origin: Origin = ORIGIN): Report[] => g.launch(DEFEAT_ENTRY, { reason: 'test_taken', ...setup }, origin)
const pending = (g: G) => defeatOf(g.state)!
const view = (g: G) => defeatView(g.k, g.state)!
const actions = (rs: Report[]) => rs.map((r) => r.action)
const pickOpt = (g: G, id: string): Report[] => g.commit(chooseOption(g.k, g.state, id))
const reason = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const FREE = 'chain:free_action'
const WHY = '先在戰敗的三個選擇裡選一個：接受結果、重來這一場，或回到這個階段開始時。'

// ===================================================================================================================
describe('抽事件：和戰鬥打輸同一套規則（COMBAT_SYSTEM 8.3 節、ENEMIES 第 6 節）', () => {
  it('五個順位：天使急救、setup.event、origin.ext.defeat_event、個別敵人寫的、勢力的預設、通用的', () => {
    const angel = make({ flags: { angel_member: true } })
    enter(angel, { faction: 'hizakura', event: 'df_custom', foes: ['en_goon'] })
    expect(pending(angel)).toMatchObject({ event: 'df_angel', tier: 'angel', fails_commission: false })

    const ev = make()
    enter(ev, { faction: 'hizakura', event: 'df_custom', foes: ['en_goon'] }, { ...ORIGIN, ext: { defeat_event: 'df_own2' } })
    expect(pending(ev)).toMatchObject({ event: 'df_custom', tier: 'origin' }) // setup.event 比 origin.ext 優先

    const og = make()
    enter(og, { faction: 'hizakura' }, { ...ORIGIN, ext: { defeat_event: 'df_custom' } })
    expect(pending(og)).toMatchObject({ event: 'df_custom', tier: 'origin' })

    const own = make()
    enter(own, { faction: 'hizakura', foes: ['en_goon'] })
    expect(pending(own)).toMatchObject({ event: 'df_own', tier: 'enemy' })

    const fac = make()
    enter(fac, { faction: 'hizakura' })
    expect(pending(fac)).toMatchObject({ event: 'df_arrest', tier: 'faction', faction: 'hizakura' })

    for (const setup of [{ faction: 'unknown' }, {}]) {
      const gen = make()
      enter(gen, setup)
      expect(pending(gen)).toMatchObject({ event: 'df_generic', tier: 'generic' })
    }
  })

  it('查不到的自訂事件與敵人寫的事件往下一個順位；foes 沒給 faction 用敵人的勢力；好幾件時同一個種子挑到同一件', () => {
    const g = make()
    enter(g, { faction: 'nora', event: 'df_nowhere', foes: ['en_nowhere'] })
    expect(pending(g)).toMatchObject({ event: 'df_robbed', tier: 'faction' })
    const f = make()
    enter(f, { foes: ['en_plain'] })
    expect(pending(f)).toMatchObject({ event: 'df_arrest', tier: 'faction', faction: 'hizakura' })
    const a = make({ seed: 5 }), b = make({ seed: 5 })
    enter(a, { foes: ['en_goon2'] })
    enter(b, { foes: ['en_goon2'] })
    expect(['df_own', 'df_own2']).toContain(pending(a).event)
    expect(pending(a).event).toBe(pending(b).event)
  })

  it('用到被關掉的標籤時沿著 fallback 找；男性主角走 masc；同一個狀態同一個結果', () => {
    const off = make({ rules: { contentOff: ['pc_unwilling'] } })
    enter(off, { faction: 'hizakura' })
    expect(pending(off)).toMatchObject({ event: 'df_arrest_plain' })
    const masc = [df('df_m', { factions: ['nora'], versions: { default: { text: 'd', stages: [{ options: [opt('o1', 'x')] }] }, masc: { text: 'm', stages: [{ inherit: 'default.stages.0' }] } } }), df('df_generic', { default: true })]
    const m = make({ gender: 'male', events: masc })
    enter(m, { faction: 'nora' })
    expect(pending(m).version).toBe('masc')
    const run = () => { const g = make({ seed: 9 }); enter(g, { faction: 'nora' }); return JSON.stringify(defeatOf(g.state)) }
    expect(run()).toBe(run())
  })
})

// ===================================================================================================================
describe('演不演（存檔規則「戰敗事件要不要看」）', () => {
  const events = [df('df_t', {
    factions: ['hizakura'],
    versions: { default: { text: '你醒來了。', stages: [{ options: [opt('a1', '忍著。', { outcomes: { any: [cash(-100), flag('stage1')] } })] }] } },
  }), df('df_generic', { default: true })]

  it('always：入口同一步事件視窗就開起來（playing），做完選項才能接受', () => {
    const g = make({ events })
    const reports = enter(g, { faction: 'hizakura' })
    expect(actions(reports)).toEqual(['defeat.pending', 'event.open'])
    expect(pending(g)).toMatchObject({ stage: 'playing', skipped: false, view: 'always', tier: 'faction' })
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'df_t', options: [{ id: 'a1' }] })
    expect(reports[0]!.timeline.map((b) => b.tag)).toEqual(['defeat.entry'])
    expect(reports[0]!.timeline[0]).toMatchObject({ text: '你被帶走了。', data: { reason: 'test_taken', who: 'pc', faction: 'hizakura' } })
    expect(() => acceptDefeat(g.k, g.state)).toThrow(ActionBlocked)
    expect(view(g)).toMatchObject({ step: 'playing', inner: { kind: 'event' }, entry: { reason: 'test_taken', who: 'pc', where: null } })
    pickOpt(g, 'a1')
    expect(g.state.money.cash).toBe(1900)
    expect(pending(g)).toMatchObject({ stage: 'played', played: { option: 'a1' } })
    g.commit(acceptDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.money.cash).toBe(1900) // 演過了，接受時不會再扣一次
  })

  it('skippable：先問；選要看（事件視窗開起來）或不看（照「不演」結算）', () => {
    const g = make({ events, rules: { defeatView: 'skippable' } })
    expect(actions(enter(g, { faction: 'hizakura' }))).toEqual(['defeat.pending'])
    expect(pending(g)).toMatchObject({ stage: 'ask', skipped: false })
    expect(eventView(g.k, g.state)).toBeNull()
    expect(() => acceptDefeat(g.k, g.state)).toThrow(/先決定要不要看/)
    expect(view(g).choices.filter((c) => c.can).map((c) => c.id)).toEqual(['watch', 'skip'])
    expect(actions(g.commit(watchDefeat(g.k, g.state)))).toEqual(['defeat.view', 'event.open'])
    expect(pending(g).stage).toBe('playing')

    const h = make({ events, rules: { defeatView: 'skippable' } })
    enter(h, { faction: 'hizakura' })
    h.commit(skipDefeat(h.k, h.state))
    expect(pending(h)).toMatchObject({ stage: 'played', skipped: true })
    expect(h.state.money.cash).toBe(2000) // 接受之前什麼都還沒發生
    h.commit(acceptDefeat(h.k, h.state))
    expect(h.state.money.cash).toBe(1900)
    expect(h.state.flags.stage1).toBe(true)
  })

  it('never：不開事件，只有結果（lines 是接受的話會發生什麼）；接受時一次結算', () => {
    const g = make({ events, rules: { defeatView: 'never' } })
    const reports = enter(g, { faction: 'hizakura' })
    expect(actions(reports)).toEqual(['defeat.pending'])
    expect(pending(g)).toMatchObject({ stage: 'played', skipped: true, view: 'never' })
    expect(reports[0]!.narration!.results).toEqual(pending(g).lines)
    expect(pending(g).lines).toEqual(expect.arrayContaining(['失去：現金 100']))
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.state.money.cash).toBe(1900)
  })

  it('沒有人登記事件視窗的一局：照 M1，只列出結果（skipped）', () => {
    const { game: g } = makeGame({
      features: [defeatFeature, enemyStub, host, directorFeature], content: [PACK(events)], seed: 2,
      patch: { money: { cred: 0, cash: 2000 }, time: { day: 3, hour: 10, minute: 0 } } as Partial<GameState>,
    })
    enter(g, { faction: 'hizakura' })
    expect(pending(g)).toMatchObject({ skipped: true, stage: 'played' })
    expect(g.blockOf(FREE)).toBe(WHY)
  })

  it('別的功能經 defeat.options 多給了選項：always 也先問；選了那個選項：付錢、交回、不留等待中的戰敗、不帶 snapshot.drop', () => {
    const g = make({ events, features: [ransomStub] })
    expect(actions(enter(g, { faction: 'hizakura' }))).toEqual(['defeat.pending'])
    expect(pending(g)).toMatchObject({ stage: 'ask' })
    expect(view(g).choices.map((c) => c.id)).toEqual(['watch', 'skip', 'accept', 'ransom', 'retry', 'stage'])
    const d = chooseDefeatOption(g.k, g.state, 'ransom')
    expect(d.changes.some((c) => c.op === 'snapshot.drop')).toBe(false)
    g.commit(d)
    expect(g.state.money.cash).toBe(1500)
    expect(defeatOf(g.state)).toBeNull()
  })
})

// ===================================================================================================================
describe('沒有戰鬥的幾拍：預設', () => {
  it('生命、感載、餘韻、沉溺不動；battle 是合成的 id、outcome 是 lose；沒有任何戰鬥的快照、核心的 pendingDefeat 是空的', () => {
    const g = make({ host: true })
    const pc = g.state.pc!
    const before = { ...g.state.actors[pc]! }
    enter(g, { faction: 'hizakura', where: 'd_x' })
    const a = g.state.actors[pc]!
    expect([a.hp, a.load, a.afterglow, a.sink]).toEqual([before.hp, before.load, before.afterglow, before.sink])
    expect(pending(g)).toMatchObject({ battle: expect.stringMatching(/^entry:test_taken:\d+$/), outcome: 'lose', entry: { reason: 'test_taken', who: pc, where: 'd_x' }, origin: ORIGIN })
    expect(pending(g)).not.toHaveProperty('net')
    expect(g.state.snapshots.some((s) => s.kind === 'battle')).toBe(false)
    expect(g.pendingDefeat).toBeNull()
  })

  it('who 不是主角時報告那一拍用他的名字；入口的 text 蓋掉預設的一句；who 要在狀態裡', () => {
    const ann = makeActor({ id: 'npc_ann', name: '安', role: 'npc' })
    const g = make({ actors: [ann] })
    const [r] = enter(g, { who: 'npc_ann', text: '安被帶走了，你只看到門關上。' })
    expect(r!.timeline[0]).toMatchObject({ actor: 'npc_ann', text: '安被帶走了，你只看到門關上。' })
    expect(pending(g).entry!.who).toBe('npc_ann')
    const h = make({ actors: [ann] })
    expect(enter(h, { who: 'npc_ann' })[0]!.timeline[0]!.text).toBe('安被帶走了。')
  })

  it('同行的人（defeat.companions）與別人經 defeat.options 看得到 entry：結果裡寫同行的人', () => {
    const comp: Feature = { id: 'comp', install: (k) => void k.hooks.on('defeat.companions', 'comp', () => ['npc_ann']) }
    const g = make({ features: [comp], actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc' })], rules: { defeatView: 'never' } })
    enter(g, { faction: 'hizakura' })
    expect(view(g).accept.companions).toEqual(['安'])
    const [accept] = g.commit(acceptDefeat(g.k, g.state))
    expect(accept!.narration!.results).toContain('同行的安跟著你一起被處置。')
  })
})

// ===================================================================================================================
describe('等三選一的期間：活動 defeat.entry 擋住別的事', () => {
  it('擋的是原因一句：自由行動（事件沒開時）、別的報告、玩家自己開戰；放行：戰敗自己的報告、事件視窗、戰敗自己開的戰鬥', () => {
    const g = make({ host: true, rules: { defeatView: 'skippable' } })
    enter(g, { faction: 'hizakura' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['defeat.entry', 'hostact'])
    expect(g.blockOf(FREE)).toBe(WHY)
    expect(g.blockOf('commit:host.x')).toBe(WHY)
    expect(g.blockOf('battle.start', undefined, { kind: 'battle', setup: {}, origin: ORIGIN })).toBe(WHY)
    expect(g.blockOf('battle.start', undefined, { kind: 'battle', setup: {}, origin: { by: 'director', ext: { caller: 'defeat' } } })).toBeNull()
    expect(g.blockOf('event.start', undefined, { kind: 'event', setup: {}, origin: { by: 'director' } })).toBe(WHY)
    expect(g.blockOf('commit:defeat.view')).toBeNull()
    expect(g.blockOf('commit:event.choose')).toBeNull()
    expect(g.blockOf('defeat.entry.start')).toBe(WHY) // 已經在等了，不能再開一個
    expect(reason(() => enter(g))).toBe(WHY)
    expect(reason(() => enterDefeat(g.k, g.state, { reason: 'x' }, ORIGIN))).toBe('已經有一場戰敗在等了，先把它處理完。')
    // 事件視窗開著時自由行動放行（回應事件）；做完又擋住，接受之後全放行
    g.commit(watchDefeat(g.k, g.state))
    expect(g.blockOf(FREE)).toBeNull()
    pickOpt(g, 'o1')
    expect(g.blockOf(FREE)).toBe(WHY)
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.blockOf(FREE)).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['hostact'])
  })

  it('從任何一種活動裡都開得了（副本裡的入口不必列在副本的放行清單）；戰鬥中開不了', () => {
    const g = make({ host: true })
    expect(g.blockOf('defeat.entry.start')).toBeNull()
    expect(actions(enter(g, { faction: 'hizakura' }))).toEqual(['defeat.pending', 'event.open'])
    const f = make()
    f.startBattle(BATTLE_SETUPS.hopeless())
    expect(f.blockOf('defeat.entry.start')).toBe('正在戰鬥，先把這一場打完。')
  })

  it('也可以是一份報告帶的 launch（opinion 就是這樣開的）；開在報告之後、同一步', () => {
    const g = make({ host: true })
    const reports = g.commit(draftOf(g.state, 'host.taken', [], { launch: [defeatEntryLaunch({ reason: 'by_report', faction: 'hizakura' }, ORIGIN)] }))
    expect(actions(reports)).toEqual(['host.taken', 'defeat.pending', 'event.open'])
    expect(pending(g).entry!.reason).toBe('by_report')
  })

  it('存檔再讀回來還在等：事件、三選一、放行都照舊，接著走得完', () => {
    const g = make({ host: true })
    enter(g, { faction: 'hizakura', retry: 'stage' })
    const text = g.save('manual', 't')
    pickOpt(g, 'o1')
    expect(g.load(text)).toBeNull()
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'df_arrest' })
    expect(pending(g)).toMatchObject({ stage: 'playing', entry: { reason: 'test_taken', retry: 'stage' } })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['defeat.entry', 'event', 'hostact'])
    pickOpt(g, 'o1')
    expect(g.blockOf(FREE)).toBe(WHY)
    const text2 = g.save('manual', 't2')
    expect(g.load(text2)).toBeNull()
    expect(g.blockOf(FREE)).toBe(WHY)
    g.commit(acceptDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
  })

  it('事件的 fight 結果（劫囚）：戰鬥開起來（戰敗自己開的來歷放行）、這時入口不擋；打贏之後等待中的戰敗被取代、之後的事照常做得成', async () => {
    const g = make({ host: true, events: [JAILBREAK, df('df_generic', { default: true })] })
    enter(g, { faction: 'hizakura' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('defeat.entry')
    const reports = pickOpt(g, 'break')
    expect(actions(reports)).toEqual(['event.close', 'battle.start'])
    expect(g.state.battle!.origin.ext).toMatchObject({ by: 'director', caller: 'defeat' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).not.toContain('defeat.entry')
    const b = g.state.battle!
    for (const u of Object.values(b.units)) if (u.side === 'foe') u.out = 'down'
    b.result = { outcome: 'win', text: '你們逃出去了。' }
    await g.finishBattle()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.blockOf(FREE)).toBeNull()
  })
})

// ===================================================================================================================
describe('接受', () => {
  it('演過：不再結算；發一次 activity.end（kind defeat、origin 是 launch 給的、result 帶 entry）；不帶 snapshot.drop', () => {
    const g = make({ host: true, events: [SIGNED, df('df_generic', { default: true })] })
    enter(g, { faction: 'hizakura', where: 'd_x' })
    pickOpt(g, 'o1')
    expect(g.state.money.cash).toBe(0)
    const d = acceptDefeat(g.k, g.state)
    expect(d.changes.some((c) => c.op === 'snapshot.drop')).toBe(false)
    const [r] = g.commit(d)
    expect(r).toMatchObject({ action: 'defeat.accept', outcome: { result: 'accepted' } })
    expect(HEARD).toHaveLength(1)
    expect(HEARD[0]).toMatchObject({
      kind: 'defeat', outcome: 'accept', origin: ORIGIN,
      result: { battle: expect.stringMatching(/^entry:test_taken:\d+$/), event: 'df_t', kind: 'generic', version: 'default', fails_commission: true, option: 'o1', entry: { reason: 'test_taken', who: g.state.pc, where: 'd_x' } },
    })
    expect(r!.narration!.results).toContain('發起的人收到了戰敗的結果')
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.money.cash).toBe(0)
  })

  it('不演：照「不演」結算；存檔規則照用（扣錢的上限、拿走裝備）', () => {
    const rules = { defeatView: 'never', defeatMoneyLoss: 0.5, defeatMoneyCap: 300 }
    const g = make({ events: [SIGNED, df('df_generic', { default: true })], cash: 1000, rules })
    enter(g, { faction: 'hizakura' })
    expect(view(g).accept).toMatchObject({ money_max: 300, gear_taken: true })
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.state.money.cash).toBe(700)
    expect(g.state.flags.signed).toBe(true)

    const gear = df('df_t', { factions: ['hizakura'], versions: one(opt('o1', '被搜身。', { outcomes: { any: [{ kind: 'strip_gear', slot: 'torso' }, cash(-100), flag('searched')] } })) })
    const off = make({ events: [gear, df('df_generic', { default: true })], features: [gearStub], rules: { defeatView: 'never', defeatTakeGear: false } })
    enter(off, { faction: 'hizakura' })
    off.commit(acceptDefeat(off.k, off.state))
    expect(off.state.flags.stripped_torso).toBeUndefined()
    expect(off.state.flags.searched).toBe(true)
    const on = make({ events: [gear, df('df_generic', { default: true })], features: [gearStub], rules: { defeatView: 'never' } })
    enter(on, { faction: 'hizakura' })
    on.commit(acceptDefeat(on.k, on.state))
    expect(on.state.flags.stripped_torso).toBe(true)
  })

  it('事件的選項帶 no_fail 旗標：交回的 fails_commission 是 false；失敗的事件（預設）交回 true', () => {
    const e = df('df_t', { factions: ['hizakura'], versions: one(opt('o1', '逃。', { flags: ['no_fail'] }), opt('o2', '認。')) })
    const g = make({ host: true, events: [e, df('df_generic', { default: true })] })
    enter(g, { faction: 'hizakura' })
    pickOpt(g, 'o1')
    g.commit(acceptDefeat(g.k, g.state))
    expect(HEARD[0]!.result.fails_commission).toBe(false)
    const h = make({ host: true, events: [e, df('df_generic', { default: true })] })
    enter(h, { faction: 'hizakura' })
    pickOpt(h, 'o2')
    h.commit(acceptDefeat(h.k, h.state))
    expect(HEARD[0]!.result.fails_commission).toBe(true)
  })
})

// ===================================================================================================================
describe('重來與回到這個階段開始時（沒有戰鬥的快照，回到發起的人指定的快照）', () => {
  it('選項的可不可以：看 retry 指定的快照與 stage 快照；原因是完整的一句', () => {
    const none = make({ rules: { defeatView: 'never' } })
    enter(none)
    expect(view(none).choices.find((c) => c.id === 'retry')).toMatchObject({ can: false, why: '這一次沒有可以重來的那一場。' })
    expect(view(none).choices.find((c) => c.id === 'stage')).toMatchObject({ can: false, why: '這個階段開始時沒有留快照，不能回去。' })
    expect(reason(() => retryDefeat(none.k, none.state))).toBe('這一次沒有可以重來的那一場。')
    expect(reason(() => stageDefeat(none.k, none.state))).toBe('這個階段開始時沒有留快照，不能回去。')
    // 指定了 retry 但那種快照不在
    const gone = make({ host: true, rules: { defeatView: 'never' } })
    enter(gone, { retry: 'opinion' })
    expect(view(gone).choices.find((c) => c.id === 'retry')).toMatchObject({ can: false, why: '這一場開戰前沒有留快照，不能重來。' })
    expect(reason(() => retryDefeat(gone.k, gone.state))).toBe('這一場開戰前沒有留快照，不能重來。')
    // 有 stage 快照：回到階段選得了、重來還是不行
    expect(view(gone).choices.find((c) => c.id === 'stage')).toMatchObject({ can: true, why: null })
    // 接受永遠可以（沒演過的 never）
    expect(view(gone).choices.find((c) => c.id === 'accept')).toMatchObject({ can: true })
  })

  it('重來：報告帶 rewind（那一種快照、fresh）；提交之後回到那一刻，之後的快照一起丟掉，比它早的留著', () => {
    const g = make({ host: true, snaps: ['stage', 'opinion'], rewind: true })
    enter(g, { faction: 'hizakura', retry: 'opinion' })
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage', 'opinion'])
    const d = retryDefeat(g.k, g.state)
    expect(d).toMatchObject({ action: 'defeat.retry', rewind: { kind: 'opinion', fresh: true } })
    const reports = g.commit(d)
    expect(reports.some((r) => r.action === 'rewind')).toBe(true)
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.ext.host).toBeDefined()
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    expect(HEARD).toEqual([]) // 沒有接受，發起的人沒有收到交回
    expect(g.blockOf(FREE)).toBeNull()
  })

  it('回到階段：回到 stage 快照；沒有 stage 快照就退而用 retry 那一種（等於重來）；兩個都沒有選不了', () => {
    const g = make({ host: true, snaps: ['stage', 'opinion'] })
    enter(g, { faction: 'hizakura', retry: 'opinion' })
    expect(stageDefeat(g.k, g.state)).toMatchObject({ action: 'defeat.stage', rewind: { kind: 'stage' } })
    g.commit(stageDefeat(g.k, g.state))
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
    expect(defeatOf(g.state)).toBeNull()

    const h = make({ host: true, snaps: ['opinion'] })
    enter(h, { faction: 'hizakura', retry: 'opinion' })
    expect(stageDefeat(h.k, h.state)).toMatchObject({ rewind: { kind: 'opinion', fresh: true } })
    expect(view(h).choices.find((c) => c.id === 'stage')).toMatchObject({ can: true })
  })

  it('事件視窗開著時重來與回到階段放行（回到快照時整個狀態換掉）；接受不放行', () => {
    const g = make({ host: true, snaps: ['stage', 'opinion'] })
    enter(g, { faction: 'hizakura', retry: 'opinion' })
    expect(eventView(g.k, g.state)).not.toBeNull()
    expect(g.blockOf('commit:defeat.retry')).toBeNull()
    expect(g.blockOf('commit:defeat.stage')).toBeNull()
    expect(g.blockOf('commit:defeat.accept')).toMatch(/先回應/)
    g.commit(retryDefeat(g.k, g.state))
    expect(eventView(g.k, g.state)).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
  })

  it('戰鬥打輸的戰敗不能用這兩個（那兩個走 Game.retryBattle、Game.rewindToStage）', async () => {
    const g = make()
    g.startBattle(BATTLE_SETUPS.hopeless())
    playOut(g)
    await g.finishBattle()
    expect(defeatOf(g.state)).not.toBeNull()
    expect(pending(g).entry).toBeUndefined()
    expect(reason(() => retryDefeat(g.k, g.state))).toMatch(/戰鬥打輸的/)
    expect(reason(() => stageDefeat(g.k, g.state))).toMatch(/戰鬥打輸的/)
    expect(view(g).entry).toBeNull()
    expect(view(g).choices.filter((c) => c.id === 'retry' || c.id === 'stage').every((c) => c.can)).toBe(true)
  })
})

// ===================================================================================================================
describe('沒有任何事件可演：當場當成接受了結果', () => {
  const only = [df('df_only', { factions: ['hizakura'] })]

  it('不留等待中的戰敗；同一份 defeat.accept 發 activity.end（event 是 null、option 是 none、fails_commission 預設 true）；發起的人照常處理（失敗就回到入口）', () => {
    const g = make({ host: true, events: only, rewind: true })
    const reports = enter(g, { faction: 'nora', where: 'd_x' })
    expect(reports[0]!.action).toBe('defeat.accept')
    expect(reports.some((r) => r.action === 'rewind')).toBe(true)
    expect(HEARD).toHaveLength(1)
    expect(HEARD[0]).toMatchObject({ origin: ORIGIN, outcome: 'accept', result: { event: null, option: 'none', fails_commission: true, kind: 'generic', entry: { reason: 'test_taken', where: 'd_x' } } })
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.ext.host).toBeUndefined() // 回到入口了
    expect(g.state.snapshots).toEqual([])
  })

  it('setup.fails_commission 可以蓋掉：false 就不失敗、發起的人不回到入口', () => {
    const g = make({ host: true, events: only, rewind: true })
    const reports = enter(g, { faction: 'nora', fails_commission: false })
    expect(actions(reports)).toEqual(['defeat.accept'])
    expect(HEARD[0]!.result.fails_commission).toBe(false)
    expect(g.state.ext.host).toBeDefined()
    expect(reports[0]!.outcome.summary).toContain('委託還在')
  })

  it('沒有發起的人（沒有人聽）也走得完；事件被篩選全部擋掉、沒有通用的也一樣', () => {
    const g = make({ events: only })
    expect(actions(enter(g, { faction: 'nora' }))).toEqual(['defeat.accept'])
    expect(defeatOf(g.state)).toBeNull()
    const f = make({ events: [df('df_a', { factions: ['hizakura'], tags: ['pc_unwilling'] })], rules: { contentOff: ['pc_unwilling'] } })
    expect(actions(enter(f, { faction: 'hizakura' }))).toEqual(['defeat.accept'])
  })
})

// ===================================================================================================================
describe('壞的設定：整步不成立、原因是完整的一句', () => {
  const bad = (setup: unknown): string => {
    const g = make({ actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc' })] })
    const was = JSON.stringify(g.state)
    const why = reason(() => g.launch(DEFEAT_ENTRY, setup, ORIGIN))
    expect(JSON.stringify(g.state)).toBe(was)
    expect(defeatOf(g.state)).toBeNull()
    return why
  }
  it('沒有物件、沒有 reason、欄位型別不對、who 不在狀態裡', () => {
    expect(bad(null)).toContain('設定物件')
    expect(bad({})).toContain('reason')
    expect(bad({ reason: '  ' })).toContain('reason')
    expect(bad({ reason: 'x', faction: 3 })).toContain('faction')
    expect(bad({ reason: 'x', retry: '' })).toContain('retry')
    expect(bad({ reason: 'x', foes: 'en_goon' })).toContain('foes')
    expect(bad({ reason: 'x', foes: [1] })).toContain('foes')
    expect(bad({ reason: 'x', fails_commission: 'no' })).toContain('fails_commission')
    expect(bad({ reason: 'x', who: 7 })).toContain('who')
    expect(bad({ reason: 'x', who: 'nobody' })).toContain('不在狀態裡')
  })

  it('entryProblem 是純函式（沒有主角也沒給 who 時指出）', () => {
    const g = make()
    expect(entryProblem(g.state, { reason: 'x' })).toBeNull()
    expect(entryProblem({ actors: {}, pc: null } as never, { reason: 'x' })).toContain('被帶走的人')
  })
})

// ===================================================================================================================
// opinion 接上：被對手帶走（找上門擋不住、對手 capture）
// ===================================================================================================================

const SC: Record<string, number> = { kaleido: 3, sakura: 2, nightingale: 1, tape: 1, doujin: 1, fanclub: 1, whisper: 1, wall: 1, relay: 0 }
const TOPIC = { id: 'tp_face', name: '副本的議題', kind: 'ignite', scores: SC, involves: { factions: ['f_alpha'], people: [], types: ['scandal'] } }
const CITY_NONE = ['city_scandal', 'city_festival', 'city_algo', 'city_graduation', 'city_blackout', 'city_quiet'].map((id) => ({ id, name: id, effect: { kind: 'none' } }))
const act = (...rows: Array<[string, string]>) => rows.map(([d, when]) => ({ do: d, when }))
const OP_PACK: ContentPack = {
  id: 'defeat_entry_opinion',
  content: {
    city_card: CITY_NONE,
    pr_opponent: [
      { id: 'pr_gang', name: '會抓人的幫派', faction: 'f_beta', strength: 2, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'visit', when: 'always' }], capture: true },
      { id: 'pr_nofaction_gang', name: '沒有勢力的幫派', strength: 2, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'visit', when: 'always' }], capture: true },
      { id: 'pr_visit', name: '會找上門的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'visit', when: 'always' }] },
      { id: 'pr_bribe', name: '愛收買的對手', faction: 'f_beta', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'bribe', when: 'always', offer_per_grade: 1000 }], capture: true },
    ],
  } as unknown as ContentPack['content'],
}
const OP_EVENTS = [
  df('df_beta', { factions: ['f_beta'] }),
  df('df_custom', { factions: [] }),
  df('df_free', { factions: [], fails_commission: false }),
  df('df_generic', { default: true }),
]

const OP_ENDS: Array<{ kind: string; outcome: string; result: Rec; origin: Rec }> = []
const OP_HOST = { rewind: true }
/** 玩具副本（kind commission，order 90；放行副本裡的事，和真的 commission 一樣）：聽 face.opinion／opinion／defeat 的 activity.end；戰敗被接受而且算失敗就回到入口。 */
const toyCommission: Feature = {
  id: 'toy_c',
  install(k) {
    k.activity.define({
      kind: 'commission', owner: 'toy_c', order: 90,
      active: (s) => (s.ext.toy_c ? { id: 'tc', label: '玩具委託' } : null),
      allow: ['commit:toy_c.', 'commit:defeat.', 'commit:event.', 'event.start', 'chain:free_action'],
      reason: () => '玩具委託進行中，先把它做完。',
      start: (_k, state) => [draftOf(state, 'toy_c.start', [{ op: 'snapshot.take', kind: 'entry', label: '入口', owner: 'tc', replace: true } as Change, { op: 'ext', key: 'toy_c', value: { stage: 0 } } as Change])],
    })
    k.hooks.on('activity.end', 'toy_c', ({ kind, outcome, result, origin }) => {
      if (kind === 'face.opinion' || kind === 'opinion') OP_ENDS.push({ kind, outcome, result: result as Rec, origin: origin as Rec })
      if (kind === 'defeat' && origin.ref === 'tc') {
        OP_ENDS.push({ kind, outcome, result: result as Rec, origin: origin as Rec })
        if (OP_HOST.rewind && result.fails_commission === true) return { rewind: { kind: 'entry', summary: '你回到入口。', fresh: true } }
      }
      return undefined
    })
  },
}
const toyMeters: Feature = {
  id: 'face_meters',
  install(k) {
    for (const def of [{ kind: 'credibility', name: '公信力', min: 0, max: 100, start: 50, keyed: 'none' }, { kind: 'favor', name: '好感', min: 0, max: 100, start: 50, keyed: 'faction' }] as Rec[]) k.meters.define({ owner: 'face_meters', ...def } as never)
  },
}

interface OpOpts { noDefeat?: boolean; events?: Fx[]; rules?: Record<string, unknown>; seed?: number }
const makeOp = (o: OpOpts = {}) => {
  OP_ENDS.length = 0
  OP_HOST.rewind = true
  const pack: ContentPack = o.noDefeat ? OP_PACK : { ...OP_PACK, content: { ...OP_PACK.content, defeat_event: o.events ?? OP_EVENTS } as unknown as ContentPack['content'] }
  const { game } = makeGame({
    features: [toyMeters, opinionFeature, ...(o.noDefeat ? [] : [defeatFeature, directorFeature, eventRunFeature]), toyCommission],
    content: [METER_CONTENT, pack], seed: o.seed ?? 7,
    // 隊上只有主角：沒有人留守，找上門不擲骰直接擋不住
    actors: [], patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' }, rules: (o.rules ?? {}) as never } as Partial<GameState>,
  })
  return game
}
type OG = ReturnType<typeof makeOp>

const faceSetup = (foe: string, extra: Rec = {}): Rec => ({
  commission: 'tc', stage: 1, face: 'opinion', branch: 'b1', branch_kind: 'assault', grade: 2, faction: 'f_alpha', links: [], route: [], decisive: false, where: {},
  opinion: { topic: TOPIC, opponent: { id: foe } }, ...extra,
})
/** 開一件玩具委託、過一個階段（存階段的快照）、選輿論面開這一段（origin 照真的副本：帶 commission、stage，副本自訂的戰敗事件在 ext.defeat_event）。 */
const enterOp = (g: OG, foe: string, ext: Rec = {}, extra: Rec = {}): void => {
  g.launch('commission', {}, { by: 'test' })
  g.commit(draftOf(g.state, 'toy_c.stage', [{ op: 'snapshot.take', kind: 'stage', label: '階段開始', owner: 'tc', replace: true } as Change, { op: 'ext', key: 'toy_c', value: { stage: 1 } } as Change]))
  g.commit({
    ...draftOf(g.state, 'toy_c.branch', [{ op: 'ext', key: 'toy_c', value: { stage: 1, face: 'opinion' } } as Change]),
    launch: [{ kind: 'face.opinion', setup: faceSetup(foe, extra), origin: { by: 'commission', ref: 'tc', ext: { commission: 'tc', stage: 1, face: 'opinion', ...ext } } }],
  })
}
/** 結束回合讓對手找上門、再結算（隊上沒有人留守，擋不住）。 */
const gotCaught = (g: OG): Report[] => {
  g.commit(endTurn(g.k, g.state))
  return g.commit(resolveVisit(g.k, g.state))
}
const W = (g: OG) => readWar(g.state)
const opPending = (g: OG) => defeatOf(g.state)!

describe('opinion：被對手帶走（face 模式）先開戰敗事件', () => {
  it('capture 的對手擋不住：戰役清掉、不發 face.opinion 的 activity.end；defeat.pending 同一步接著開事件視窗；入口帶 reason、誰、勢力、在哪裡、重來回到 opinion 快照', async () => {
    const g = makeOp()
    enterOp(g, 'pr_gang', {}, { decisive: true })
    g.commit(endTurn(g.k, g.state))
    expect(W(g)!.pending).toBe('visit')
    const { result: reports, violations } = await observed(g, () => g.commit(resolveVisit(g.k, g.state)))
    expect(violations).toEqual([])
    expect(actions(reports)).toEqual(['opinion.visit', 'defeat.pending', 'event.open'])
    expect(W(g)).toBeNull()
    expect(OP_ENDS).toEqual([]) // 這一場沒有交回：交回由戰敗的接受接手
    expect(opPending(g)).toMatchObject({
      event: 'df_beta', tier: 'faction', faction: 'f_beta', stage: 'playing', outcome: 'lose', fails_commission: true,
      origin: { by: 'commission', ref: 'tc', ext: { commission: 'tc', stage: 1 } },
      entry: { reason: 'opinion_captured', who: g.state.pc, where: 'd_a', retry: 'opinion' },
    })
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'df_beta' })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['defeat.entry', 'event', 'commission'])
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage', 'opinion'])
    expect(reports[0]!.timeline.some((b) => b.tag === 'opinion.visit.captured')).toBe(true)
  })

  it('接受之後副本失敗、回到入口：發起的人（副本）收到一次戰敗的 activity.end（origin 是副本、result 帶 entry、event、勢力的事件）', () => {
    const g = makeOp()
    enterOp(g, 'pr_gang')
    gotCaught(g)
    pickOpt(g, 'o1')
    expect(view(g)).toMatchObject({ step: 'played', entry: { reason: 'opinion_captured' }, event: { id: 'df_beta', tier: 'faction' } })
    const reports = g.commit(acceptDefeat(g.k, g.state))
    expect(reports.map((r) => r.action)).toEqual(['defeat.accept', 'rewind'])
    expect(OP_ENDS).toHaveLength(1)
    expect(OP_ENDS[0]).toMatchObject({ kind: 'defeat', outcome: 'accept', origin: { by: 'commission', ref: 'tc' }, result: { event: 'df_beta', fails_commission: true, option: 'o1', entry: { reason: 'opinion_captured' } } })
    expect(g.state.ext.toy_c).toBeUndefined() // 回到入口了
    expect(W(g)).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.snapshots).toEqual([])
    expect(g.blockOf(FREE)).toBeNull()
  })

  it('副本自訂的戰敗事件（origin.ext.defeat_event）優先於勢力的預設；事件寫 fails_commission: false 就不失敗，回到選分支之前由副本接', () => {
    const g = makeOp()
    enterOp(g, 'pr_gang', { defeat_event: 'df_free' })
    gotCaught(g)
    expect(opPending(g)).toMatchObject({ event: 'df_free', tier: 'origin', fails_commission: false })
    pickOpt(g, 'o1')
    const reports = g.commit(acceptDefeat(g.k, g.state))
    expect(reports.map((r) => r.action)).toEqual(['defeat.accept']) // 沒有 rewind
    expect(OP_ENDS[0]!.result).toMatchObject({ fails_commission: false, event: 'df_free' })
    expect(g.state.ext.toy_c).toBeDefined()
    expect(defeatOf(g.state)).toBeNull()
    expect(W(g)).toBeNull()
  })

  it('重來這一場：回到開戰前的 opinion 快照（戰役還沒開、骰子換一批）；回到這個階段開始時：回到 stage 快照', () => {
    const g = makeOp()
    enterOp(g, 'pr_gang')
    gotCaught(g)
    expect(view(g).choices.filter((c) => c.id === 'retry' || c.id === 'stage').map((c) => [c.id, c.can])).toEqual([['retry', true], ['stage', true]])
    const reports = g.commit(retryDefeat(g.k, g.state))
    expect(reports.some((r) => r.action === 'rewind')).toBe(true)
    expect(W(g)).toBeNull()
    expect(defeatOf(g.state)).toBeNull()
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    expect(g.state.ext.toy_c).toMatchObject({ face: 'opinion' }) // 副本停在「選完分支、這一段還沒開」
    expect(OP_ENDS).toEqual([])

    const h = makeOp()
    enterOp(h, 'pr_gang')
    gotCaught(h)
    h.commit(stageDefeat(h.k, h.state))
    expect(h.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
    expect(h.state.ext.toy_c).toMatchObject({ stage: 0 }) // 階段的快照存在這一段開始之前
    expect(W(h)).toBeNull()
  })

  it('存檔再讀回來：事件、入口的資訊、三選一都還在，接著走得完', () => {
    const g = makeOp()
    enterOp(g, 'pr_gang')
    gotCaught(g)
    const text = g.save('manual', 't')
    pickOpt(g, 'o1')
    expect(g.load(text)).toBeNull()
    expect(eventView(g.k, g.state)).toMatchObject({ event: 'df_beta' })
    expect(opPending(g).entry).toMatchObject({ reason: 'opinion_captured', retry: 'opinion' })
    pickOpt(g, 'o1')
    g.commit(acceptDefeat(g.k, g.state))
    expect(g.state.ext.toy_c).toBeUndefined()
  })

  it('對手沒有勢力：不給 faction，抽到通用的；沒有事件可演（沒有勢力對得上也沒有通用的）：當場交回，副本失敗回到入口，不留等待中的戰敗', () => {
    const g = makeOp()
    enterOp(g, 'pr_nofaction_gang')
    gotCaught(g)
    expect(opPending(g)).toMatchObject({ event: 'df_generic', tier: 'generic' })
    expect(opPending(g).faction).toBeUndefined()

    const h = makeOp({ events: [df('df_only_alpha', { factions: ['f_alpha'] })] })
    enterOp(h, 'pr_gang')
    const reports = gotCaught(h)
    expect(reports.map((r) => r.action)).toEqual(['opinion.visit', 'defeat.accept', 'rewind'])
    expect(OP_ENDS).toHaveLength(1)
    expect(OP_ENDS[0]).toMatchObject({ kind: 'defeat', result: { event: null, option: 'none', fails_commission: true } })
    expect(h.state.ext.toy_c).toBeUndefined()
    expect(defeatOf(h.state)).toBeNull()
  })

  it('不抓人的對手擋不住：照舊被牽制，不進戰敗；收買（自願）也不進戰敗', () => {
    const g = makeOp()
    enterOp(g, 'pr_visit')
    gotCaught(g)
    expect(defeatOf(g.state)).toBeNull()
    expect(W(g)).not.toBeNull()
    expect(W(g)!.stun).toBe(true) // 下一回合開始時編輯點 0、不能佔領

    const h = makeOp()
    enterOp(h, 'pr_bribe')
    h.commit(endTurn(h.k, h.state))
    expect(W(h)!.pending).toBe('bribe')
    h.commit(answerBribe(h.k, h.state, { accept: true }))
    expect(defeatOf(h.state)).toBeNull()
    expect(OP_ENDS).toHaveLength(1)
    expect(OP_ENDS[0]).toMatchObject({ kind: 'face.opinion', outcome: 'lost', result: { bribed: 1000 * 2 } })
    expect(meterOf(h.k, h.state, 'credibility', '_')).toBe(45)
  })

  it('沒有裝戰敗（沒有人登記 defeat.entry）：和以前一模一樣，交回 lost 帶 captured（玩具副本不處理它，真的 commission 照舊失敗回到入口）', () => {
    const g = makeOp({ noDefeat: true })
    enterOp(g, 'pr_gang', {}, { decisive: true })
    const reports = gotCaught(g)
    expect(actions(reports)).toEqual(['opinion.visit'])
    expect(W(g)).toBeNull()
    expect(OP_ENDS).toHaveLength(1)
    expect(OP_ENDS[0]).toMatchObject({ kind: 'face.opinion', outcome: 'lost', result: { captured: true, by: 'visit', decisive: true } })
  })
})

describe('opinion：被對手帶走（solo 模式，沒有副本）', () => {
  const startSolo = (g: OG, foe = 'pr_gang'): void => void g.commit(startWar(g.k, g.state, { topic: TOPIC as never, foe }))

  it('一樣先開戰敗事件；戰役照舊結算（交回 lost 帶 captured），同一份報告多帶 launch；沒有開戰前的快照，所以沒有「重來」', () => {
    const g = makeOp()
    startSolo(g)
    expect(W(g)!.mode).toBe('solo')
    const reports = gotCaught(g)
    expect(actions(reports)).toEqual(['opinion.visit', 'defeat.pending', 'event.open'])
    expect(W(g)).toBeNull()
    expect(OP_ENDS).toHaveLength(1)
    expect(OP_ENDS[0]).toMatchObject({ kind: 'opinion', outcome: 'lost', result: { captured: true, by: 'visit' } })
    expect(opPending(g)).toMatchObject({ event: 'df_beta', faction: 'f_beta', origin: { by: 'shell' }, entry: { reason: 'opinion_captured', who: g.state.pc, where: 'd_a' } })
    expect(opPending(g).entry).not.toHaveProperty('retry')
    expect(view(g).choices.find((c) => c.id === 'retry')).toMatchObject({ can: false })
    expect(view(g).choices.find((c) => c.id === 'stage')).toMatchObject({ can: false })
  })

  it('接受：發起的人（shell）收到戰敗的 activity.end，戰敗收掉；不會有副本失敗的回退', () => {
    const g = makeOp()
    startSolo(g)
    gotCaught(g)
    pickOpt(g, 'o1')
    const reports = g.commit(acceptDefeat(g.k, g.state))
    expect(reports.map((r) => r.action)).toEqual(['defeat.accept'])
    expect(defeatOf(g.state)).toBeNull()
    expect(g.blockOf(FREE)).toBeNull()
  })

  it('沒有裝戰敗：照舊（交回 lost 帶 captured，沒有戰敗）', () => {
    const g = makeOp({ noDefeat: true })
    startSolo(g)
    expect(actions(gotCaught(g))).toEqual(['opinion.visit'])
    expect(OP_ENDS[0]).toMatchObject({ kind: 'opinion', outcome: 'lost', result: { captured: true } })
  })
})

// ===================================================================================================================
// 真的 commission：被帶走 → 戰敗事件 → 接受 → 委託失敗回到入口
// ===================================================================================================================

const CAPT: Rec = {
  id: 'capt', name: '被帶走的委託', kind: 'smear', main: 'opinion', scale: 'small', grade: 2, target_faction: 'f_beta', employer: 'f_alpha', district: 'd_a', defeat_event: 'df_custom',
  opinion_setup: { topic: TOPIC, opponent: { id: 'pr_gang', strength: 2 } },
  links: {},
  stages: [1, 2, 3].map((n) => ({ name: `第 ${n} 段`, faces: { opinion: { rounds: 3, branches: [{ id: 'assault', kind: 'assault' }] } } })),
}
const REAL_ENDS: Array<{ kind: string; outcome: string; origin: Rec; result: Rec }> = []
const observer: Feature = { id: 'observer', install: (k) => void k.hooks.on('activity.end', 'observer', ({ kind, outcome, origin, result }) => void REAL_ENDS.push({ kind, outcome, origin: origin as never, result })) }

function makeReal(def: Rec = {}) {
  REAL_ENDS.length = 0
  const pack: ContentPack = { ...OP_PACK, content: { ...OP_PACK.content, defeat_event: OP_EVENTS, commission: [{ ...CAPT, ...def }] } as unknown as ContentPack['content'] }
  const { game } = makeGame({
    features: [toyMeters, commissionFeature, opinionFeature, defeatFeature, directorFeature, eventRunFeature, observer],
    content: [METER_CONTENT, pack], seed: 7, actors: [],
    pc: { attrs: { tech: 10, intellect: 10, body: 10, reflex: 10, charm: 10 }, skills: {} } as never,
    patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' } } as Partial<GameState>,
  })
  return game
}

describe('真的 commission：被帶走的整條路', () => {
  it('輿論面（決定性的一步）被帶走：戰敗事件是副本自訂的、接受之後委託失敗回到入口、發 commission.failed；defeat 的結果帶 entry', async () => {
    const g = makeReal()
    g.launch('commission', { def: 'capt' }, { by: 'fixer', ref: 'fx_1' })
    g.commit(chooseFace(g.k, g.state, 'opinion'))
    g.commit(chooseBranch(g.k, g.state, 'assault', {}))
    expect(readWar(g.state)).not.toBeNull()
    expect(readWar(g.state)!.origin).toEqual({ by: 'commission', ref: 'capt', ext: { commission: 'capt', stage: 1, face: 'opinion', defeat_event: 'df_custom' } })
    g.commit(endTurn(g.k, g.state))
    const { result: reports, violations } = await observed(g, () => g.commit(resolveVisit(g.k, g.state)))
    expect(violations).toEqual([])
    expect(actions(reports)).toEqual(['opinion.visit', 'defeat.pending', 'event.open'])
    expect(defeatOf(g.state)).toMatchObject({ event: 'df_custom', tier: 'origin', entry: { reason: 'opinion_captured', retry: 'opinion' }, stage: 'playing' })
    expect(readRun(g.state)).not.toBeNull() // 副本還在，等戰敗接受
    expect(REAL_ENDS.filter((e) => e.kind === 'face.opinion')).toEqual([])
    pickOpt(g, 'o1')
    const accepted = await observed(g, () => g.commit(acceptDefeat(g.k, g.state)))
    expect(accepted.violations).toEqual([])
    expect(accepted.result.map((r) => r.action)).toEqual(expect.arrayContaining(['defeat.accept', 'rewind', 'commission.failed']))
    expect(readRun(g.state)).toBeNull()
    expect(g.state.ext.commission_failed).toMatchObject({ commission: 'capt', pending: false })
    expect(REAL_ENDS.filter((e) => e.kind === 'commission' && e.outcome === 'failed')).toHaveLength(1)
    expect(REAL_ENDS.find((e) => e.kind === 'commission')).toMatchObject({ result: { defeat: { event: 'df_custom', fails_commission: true, entry: { reason: 'opinion_captured' } } } })
    expect(readWar(g.state)).toBeNull()
    expect(g.state.snapshots).toEqual([])
    expect(defeatOf(g.state)).toBeNull()
  })

  it('重來這一場：回到開戰前、副本停在 play、戰敗沒了；副本的 replay 可以再開一場', async () => {
    const g = makeReal()
    g.launch('commission', { def: 'capt' }, { by: 'fixer', ref: 'fx_1' })
    g.commit(chooseFace(g.k, g.state, 'opinion'))
    g.commit(chooseBranch(g.k, g.state, 'assault', {}))
    g.commit(endTurn(g.k, g.state))
    g.commit(resolveVisit(g.k, g.state))
    g.commit(retryDefeat(g.k, g.state))
    expect(defeatOf(g.state)).toBeNull()
    expect(readWar(g.state)).toBeNull()
    expect(readRun(g.state)).toMatchObject({ step: 'play', face: 'opinion', done: false })
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    const again = g.commit(replay(g.k, g.state))
    expect(again.map((r) => r.action)).toEqual(['commission.replay', 'opinion.start'])
    expect(readWar(g.state)).toMatchObject({ mode: 'face', round: 1 })
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage', 'opinion'])
  })

  it('不是最後一個階段也一樣被帶走：失敗回到入口（使用者 2026-11-27：任何階段都算失敗）；事件寫「繼續」（fails_commission: false）時留在這一段、回到選分支之前', async () => {
    const free = makeReal({ defeat_event: 'df_free' })
    free.launch('commission', { def: 'capt' }, { by: 'fixer', ref: 'fx_1' })
    free.commit(chooseFace(free.k, free.state, 'opinion'))
    free.commit(chooseBranch(free.k, free.state, 'assault', {}))
    free.commit(endTurn(free.k, free.state))
    free.commit(resolveVisit(free.k, free.state))
    expect(defeatOf(free.state)).toMatchObject({ event: 'df_free', tier: 'origin', fails_commission: false })
    pickOpt(free, 'o1')
    const reports = free.commit(acceptDefeat(free.k, free.state))
    expect(reports.map((r) => r.action)).toEqual(['defeat.accept'])
    expect(readRun(free.state)).toMatchObject({ stage: 1, step: 'branch' })
    expect(readWar(free.state)).toBeNull()
    expect(free.state.ext.commission_failed).toBeUndefined()
  })
})
