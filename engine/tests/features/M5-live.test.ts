// 驗收測試：dev/work/M5-live.md（cpp-feature）。直播的容器（熱度、目標、亮點、收播結算）與活動直播：掛在進行中的戰鬥、成人場景或委託副本上，宿主結束就收播；直播不回退；場景知道有人在看。
// 規格：MEDIA 1.2 節、第 3 節「副本裡的直播不回退」、第 6 節；DATA 9.2、第 11 節；COMMISSIONS 2.3 節；dev/adr/0020 第三節、V21～V26；dev/work/M5-core-seams.md（deny）。
// 測試用 makeBattleGame 的戰鬥（真的戰鬥引擎）、玩具的 commission 與 scene 活動（照命名發報告）、替身的 media.record 與頻道（量表 subs、條件 channel_open、聽 activity.end 的 live）；
// 單人場景那一組用真的 scene。內容一律用測試自帶的最小假資料：五條直播目標（另有一條要頻道定位的）、兩個勢力、一個親密度量表。
// 骰子與戰鬥的亮點：要精確的數字時用「假的戰鬥一步」（action battle.step 的報告，帶 crit、overload、down 的那幾拍）；真的戰鬥只驗它們串得起來。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Actor, Change, ContentEntry, ContentPack, Feature, GameState, Kernel, ReportDraft, TimelineBeat } from '../../src'
import { ActionBlocked, attachActivityEnd, endActivity, meterOf } from '../../src'
import {
  DEFAULT_LIVE_RULES, DEFAULT_TEMPLATES, LIVE_EVENTS, cutLive, eventsOf, goLive, hostilityExtra, liveFeature, livePreview, liveRules, liveView, readLive, settleSession, templateFor, templatesOf,
  viewersFrom, viewersOf,
} from '../../src/features/live'
import type { LiveSession } from '../../src/features/live'
import { goalProblems, ruleProblems, templateProblems } from '../../src/features/live/model'
import type { Dice, SceneInput } from '../../src/features/scene'
import { sceneAct, sceneFeature, sceneOptions, sceneView } from '../../src/features/scene'
import { Game } from '../../src'
import { allFeatures } from '../../src/features'
import { characterFeature } from '../../src/features/character'
import { lewdFeature } from '../../src/features/lewd'
import type { ActorOverrides, TestGame } from '../../src/testkit'
import { BATTLE_SETUPS, METER_CONTENT, TEST_COMBAT, makeActor, makeBattleGame, makeGame, meterFeature, playOut, testMeter } from '../../src/testkit'

type Rec = Record<string, any>
type G = TestGame['game']

// ===================================================================================================================
// 假資料與替身
// ===================================================================================================================

/** 直播目標：五條（戰鬥三、成人一、副本一）加一條要頻道定位的（不會被抽到）。 */
const GOALS = [
  { id: 'g_two_crits', text: '打出兩次要害。', scope: ['combat'], check: { event: 'crit', count_min: 2 }, heat: 3, tip_per_grade: 100 },
  { id: 'g_no_one_down', text: '沒有任何一個隊友倒下。', scope: ['combat', 'commission'], check: { event: 'ally_down', count_max: 0 }, heat: 3, tip_per_grade: 150 },
  { id: 'g_first_blood', text: '打倒至少一個敵人。', scope: ['combat'], check: { event: 'foe_down', count_min: 1 }, heat: 3, tip_per_grade: 100 },
  { id: 'g_acts', text: '做到三個行動。', scope: ['adult'], check: { event: 'scene_act', count_min: 3 }, heat: 3, tip_per_grade: 50 },
  { id: 'g_two_stages', text: '過兩個階段。', scope: ['commission'], check: { event: 'stage_done', count_min: 2 }, heat: 3, tip_per_grade: 80 },
  { id: 'g_news', text: '新聞台才抽得到的目標。', scope: ['combat'], check: { event: 'crit', count_min: 1 }, heat: 3, tip_per_grade: 10, channel: 'news' },
]
const goalPack = (goals: Rec[] = GOALS, templates?: Rec[]): ContentPack => ({ id: 'live_pack', content: { stream_goal: goals as ContentEntry[], ...(templates ? { stream_template: templates as ContentEntry[] } : {}) } })
/** 戰鬥直播模板：每次剛好抽一個目標（要控制抽到哪一條時，內容只放那一條） */
const ONE_PICK: Rec = { id: 'st_combat', name: '戰鬥直播', scope: 'combat', highlights: [{ event: 'crit', heat: 1 }, { event: 'overload_foe', heat: 1 }, { event: 'foe_down', heat: 1 }], goals: { pick: [1, 1] }, risk: { hostility_mult: 1.5 } }

/** 替身：頻道（條件 channel_open 看旗標 channel_on；聽 activity.end 的 live，記成 ext.stub_ends；它的狀態不隨回到快照保留，和真的頻道一樣）。 */
const CHANNEL_STUB: Feature = {
  id: 'channel_stub',
  install(k: Kernel) {
    k.conditions.register({ kind: 'channel_open', owner: 'channel_stub', validate: () => [], test: (_c, ctx) => ctx.state.flags.channel_on === true, describe: () => '要開著頻道' })
    k.changes.register<Change & { entry: Rec }>({
      op: 'stub.live_end', owner: 'channel_stub', validate: () => [],
      apply: (s, c) => { s.ext.stub_ends = [...((s.ext.stub_ends as Rec[] | undefined) ?? []), c.entry] },
    })
    k.hooks.on('activity.end', 'channel_stub', ({ kind, id, result }) => (kind === 'live' ? { changes: [{ op: 'stub.live_end', entry: { id, ...result } }] } : undefined))
  },
}

/** 替身：media（回答 media.record，記成 ext.stub_rec；回到快照時保留回去之前的，和真的 media 一樣）。 */
const MEDIA_STUB: Feature = {
  id: 'media_stub',
  install(k: Kernel) {
    k.changes.register<Change & { rec: Rec }>({
      op: 'stub.rec', owner: 'media_stub', validate: () => [],
      apply: (s, c) => { s.ext.stub_rec = [...((s.ext.stub_rec as Rec[] | undefined) ?? []), c.rec] },
    })
    ;(k.hooks.on as unknown as (n: string, o: string, fn: (p: Rec) => unknown) => void)('media.record', 'media_stub', (p) => [{ op: 'stub.rec', rec: { source: p.source, label: p.label, hint: p.hint } }])
    k.hooks.on('rewind.keep', 'media_stub', ({ current }) => (current.ext.stub_rec !== undefined ? [{ op: 'ext', key: 'stub_rec', value: current.ext.stub_rec }] : undefined))
  },
}

/** 替身：曝露度（角色 ext.expo、ext.skin）。 */
const ENV: Feature = {
  id: 'live_env',
  install(k: Kernel) {
    k.stats.defineStat({ id: 'exposure', owner: 'live_env', name: '曝露度', min: 0, max: 3, base: (s, a) => Number(s.actors[a]?.ext.expo ?? 0) })
    k.stats.defineStat({ id: 'skin_exposure', owner: 'live_env', name: '內海曝露度', min: 0, max: 3, base: (s, a) => Number(s.actors[a]?.ext.skin ?? 0) })
  },
}

/** 玩具的委託副本：ext.toy_c 在就是進行中（放行 commission. 與 test. 開頭的行動，其餘擋掉）。 */
const COMMISSION_TOY: Feature = {
  id: 'commission_toy',
  install(k: Kernel) {
    k.activity.define({ kind: 'commission', owner: 'commission_toy', order: 90, active: (s) => (s.ext.toy_c ? { id: 'c1', label: '玩具副本' } : null), allow: ['commit:commission.', 'commit:test.', 'commit:event.', 'commit:battle.', 'rewind:'], reason: () => '副本進行中，先把它做完。' })
  },
}
/** 玩具的成人場景。 */
const SCENE_TOY: Feature = {
  id: 'scene_toy',
  install(k: Kernel) {
    k.activity.define({ kind: 'scene', owner: 'scene_toy', order: 20, active: (s) => (s.ext.toy_s ? { id: 's1', label: '玩具場景' } : null), allow: ['commit:scene.', 'commit:test.', 'commit:event.'], reason: () => '場景進行中，先把它做完。' })
  },
}
/** 玩具的潛入與內海行程（外面包著的兩層：只放行 test. 開頭的行動；M4 的 B030 就是漏列了外面那一層）。 */
const WRAP_TOY: Feature = {
  id: 'wrap_toy',
  install(k: Kernel) {
    k.activity.define({ kind: 'dive', owner: 'wrap_toy', order: 85, active: (s) => (s.flags.in_dive === true ? { id: 'd1', label: '潛入' } : null), allow: ['commit:test.', 'battle.', 'commit:battle.'], reason: () => '潛入進行中。' })
    k.activity.define({ kind: 'netrun', owner: 'wrap_toy', order: 50, active: (s) => (s.flags.in_net === true ? { id: 'n1', label: '內海行程' } : null), allow: ['commit:test.', 'battle.', 'commit:battle.'], reason: () => '內海行程進行中。' })
  },
}
/** 被動效果的 if 要讀的衍生數值。 */
const GLOW: Feature = {
  id: 'glow_toy',
  install(k: Kernel) {
    k.stats.defineStat({ id: 'toy_glow', owner: 'glow_toy', name: '聚光', min: 0, max: 9, base: () => 0 })
    k.passives.register('glow_toy', 'cyber', () => [{ stat: 'toy_glow', amount: 2, if: [{ kind: 'live_on' }] }], '聚光')
  },
}

interface Opts {
  channel?: boolean
  media?: boolean
  env?: boolean
  features?: Feature[]
  content?: ContentPack[]
  goals?: Rec[]
  templates?: Rec[]
  seed?: number
  subs?: number
  fame?: number
  flags?: Record<string, boolean>
  actors?: Actor[]
  pc?: ActorOverrides
  affinity?: Record<string, number>
  battle?: keyof typeof BATTLE_SETUPS
  grade?: 1 | 2 | 3 | 4 | 5
}

const baseFeatures = (o: Opts): Feature[] => [
  meterFeature(
    testMeter({ kind: 'hostility', owner: 'sec_toy', name: '敵對值', keyed: 'faction' }),
    testMeter({ kind: 'affinity', owner: 'npcs_toy', name: '親密度', min: -100, max: 100, keyed: 'npc' }),
    testMeter({ kind: 'fame', owner: 'lewd_toy', name: '豔名', keyed: 'district' }),
    ...(o.channel === false ? [] : [testMeter({ kind: 'subs', owner: 'ch_toy', name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' })]),
  ),
  ...(o.channel === false ? [] : [CHANNEL_STUB]), ...(o.media === false ? [] : [MEDIA_STUB]), ...(o.env ? [ENV] : []),
  liveFeature, ...(o.features ?? []),
]

const patchOf = (o: Opts): Partial<GameState> => ({
  flags: { channel_on: o.channel !== false, ...o.flags },
  meters: {
    ...(o.channel === false ? {} : { subs: { _: o.subs ?? 1000 } }),
    ...(o.fame !== undefined ? { fame: { test: o.fame } } : {}),
    ...(o.affinity ? { affinity: { ...o.affinity } } : {}),
  },
})

/** 一局已經開打的遊戲（第一輪、還沒有人動）。 */
function makeB(o: Opts = {}): G {
  return makeBattleGame({
    features: [TEST_COMBAT, ...baseFeatures(o)], content: [METER_CONTENT, goalPack(o.goals, o.templates), ...(o.content ?? [])], seed: o.seed ?? 11, patch: patchOf(o),
    ...(o.battle ? { battle: o.battle } : {}), ...(o.grade ? { grade: o.grade } : {}), ...(o.actors ? { actors: o.actors } : {}), ...(o.pc ? { pc: o.pc } : {}),
  }).game
}

/** 沒有戰鬥的遊戲（副本、場景用玩具的活動）。 */
function makeN(o: Opts = {}): G {
  return makeGame({
    features: [COMMISSION_TOY, SCENE_TOY, WRAP_TOY, ...baseFeatures(o)], content: [METER_CONTENT, goalPack(o.goals, o.templates), ...(o.content ?? [])], seed: o.seed ?? 11, patch: patchOf(o),
    actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc' }), makeActor({ id: 'npc_bob', name: '鮑', role: 'npc', ext: { stream_ok: true } }), ...(o.actors ?? [])], ...(o.pc ? { pc: o.pc } : {}),
  }).game
}

const rep = (action: string, o: Partial<ReportDraft> = {}): ReportDraft => ({ kind: 'event', action, location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試。' }, ...o })
const tag = (t: string, data: Rec = {}, layer: 'meat' | 'net' = 'meat'): TimelineBeat => ({ layer, text: t, tag: t, data })
const crit = (attacker = 'a1'): TimelineBeat => tag('crit', { attacker, target: 'f1' })
const overload = (target = 'f1'): TimelineBeat => tag('overload', { target })
const down = (side: 'foe' | 'ally' = 'foe', how = 'down'): TimelineBeat => tag(how === 'subdued' ? 'subdue' : 'down', { target: side === 'foe' ? 'f1' : 'a1', how, rank: 'minion', side })
/** 假的戰鬥一步：只帶那幾拍（真的戰鬥還在進行，單位 id 是 a1～、f1～）。 */
const step = (...beats: TimelineBeat[]): ReportDraft => rep('battle.step', { kind: 'combat', timeline: beats })
const sys = (changes: Change[], action = 'test.give'): ReportDraft => rep(action, { kind: 'system', changes })

const live = (g: G) => readLive(g.state)
const session = (g: G): LiveSession => live(g).session!
const subs = (g: G): number => meterOf(g.k, g.state, 'subs')
const hostility = (g: G, f = 'f_alpha'): number => meterOf(g.k, g.state, 'hostility', f)
const cred = (g: G): number => g.state.money.cred
const stubRec = (g: G): Rec[] => (g.state.ext.stub_rec as Rec[] | undefined) ?? []
const stubEnds = (g: G): Rec[] => (g.state.ext.stub_ends as Rec[] | undefined) ?? []
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.reason; throw e }
  return ''
}
const go = (g: G, input?: Parameters<typeof goLive>[2]) => g.commit(goLive(g.k, g.state, input))[0]!
const cut = (g: G) => g.commit(cutLive(g.k, g.state))[0]!

// 副本
const cEnter = (data: Rec = {}): ReportDraft => rep('commission.enter', {
  timeline: [{ layer: 'meat', text: '進場', tag: 'commission.enter', data: { id: 'c1', grade: 2, faction: 'f_alpha', stream_goals: ['g_two_stages'], ...data } }],
  changes: [{ op: 'snapshot.take', kind: 'entry', label: '進入副本前', owner: 'c1' }, { op: 'ext', key: 'toy_c', value: { id: 'c1' } }],
})
const cEnd = (g: G, outcome: 'done' | 'retreat' | 'failed'): ReportDraft => {
  const end = endActivity(g.k, { state: g.state, kind: 'commission', id: 'c1', origin: { by: 'toy' }, outcome, result: {} })
  const d = rep('commission.finish', { changes: [{ op: 'ext', key: 'toy_c', value: null }, ...end.changes], narration: { results: end.lines } })
  return attachActivityEnd(outcome === 'retreat' ? { ...d, rewind: { kind: 'entry', summary: '你從副本撤退，所有進度回到進去之前。', fresh: true } } : d, end)
}
const cStage = (): ReportDraft => rep('commission.milestone')
const cBranch = (): ReportDraft => rep('commission.branch')

// 場景
const sStart = (data: Rec = {}, layer: 'meat' | 'net' = 'meat'): ReportDraft => rep('scene.start', {
  kind: 'social', timeline: [{ layer, text: '開場', tag: 'scene.start', data }], changes: [{ op: 'ext', key: 'toy_s', value: { id: 's1' } }],
})
const sAct = (...beats: TimelineBeat[]): ReportDraft => rep('scene.act', { kind: 'social', timeline: [tag('scene.line'), ...beats] })
const sEnd = (g: G, outcome = 'stop'): ReportDraft => {
  const end = endActivity(g.k, { state: g.state, kind: 'scene', id: 's1', origin: { by: 'toy' }, outcome, result: { audience: false } })
  return attachActivityEnd(rep('scene.end', { kind: 'social', changes: [{ op: 'ext', key: 'toy_s', value: null }, ...end.changes], narration: { results: end.lines } }), end)
}

/** 戰鬥直播已經開好：第一輪、剛開播。 */
const liveB = (o: Opts = {}): G => {
  const g = makeB(o)
  go(g)
  return g
}
const liveC = (o: Opts = {}, data: Rec = {}): G => {
  const g = makeN(o)
  g.commit(cEnter(data))
  go(g)
  return g
}
const liveS = (o: Opts = {}, data: Rec = { with: 'npc_bob' }, layer: 'meat' | 'net' = 'meat'): G => {
  const g = makeN({ ...o, goals: o.goals ?? GOALS })
  g.commit(sStart(data, layer))
  go(g)
  return g
}

// ===================================================================================================================
describe('什麼時候開得了（V21）：宿主還沒做第一步', () => {
  it('戰鬥第一輪、沒有人動過可以開；有人行動之後開不了，原因的句子對', () => {
    const g = makeB()
    expect(livePreview(g.k, g.state)).toMatchObject({ ok: true, blocks: [], host: { kind: 'battle' }, template: { id: 'st_combat' } })
    g.battleNext({ anyone: true })
    const p = livePreview(g.k, g.state)
    expect(p.ok).toBe(false)
    expect(p.blocks).toEqual(['這場戰鬥已經有人動手了：直播要在第一輪、還沒有人行動之前開播。'])
    expect(reasonOf(() => goLive(g.k, g.state))).toBe('這場戰鬥已經有人動手了：直播要在第一輪、還沒有人行動之前開播。')
  })

  it('副本剛進去可以開；選了面（commission.face）之後不行', () => {
    const g = makeN()
    g.commit(cEnter())
    expect(livePreview(g.k, g.state)).toMatchObject({ ok: true, host: { kind: 'commission', id: 'c1' }, template: { id: 'st_commission' } })
    g.commit(rep('commission.face'))
    expect(livePreview(g.k, g.state).blocks).toEqual(['副本已經往下走了：直播要在剛進副本、還沒有選面之前開播。'])
  })

  it('進場那一份之後多出來的事件（event.、login）不影響判斷：事件的報告前綴是 event.', () => {
    const g = makeN()
    g.commit(cEnter())
    g.commit(rep('event.start'))
    expect(livePreview(g.k, g.state).ok).toBe(true)
  })

  it('場景剛開始可以開；做過一個行動之後不行', () => {
    const g = makeN()
    g.commit(sStart({ with: 'npc_bob' }))
    expect(livePreview(g.k, g.state)).toMatchObject({ ok: true, host: { kind: 'scene' }, template: { id: 'st_adult' } })
    g.commit(sAct())
    expect(livePreview(g.k, g.state).blocks).toEqual(['這一場已經做過行動了：直播要在場景剛開始、還沒有做任何行動之前開播。'])
  })

  it('同時有副本與戰鬥時宿主是副本（V22）：副本剛進去、裡面開了一場戰鬥而副本還沒有選面的，宿主仍是副本', () => {
    const g = makeN()
    g.commit(cEnter())
    expect(livePreview(g.k, g.state).host?.kind).toBe('commission')
  })

  it('沒有宿主：原因是沒有可以掛直播的活動；有別的直播在播：不能再開', () => {
    const g = makeN()
    expect(livePreview(g.k, g.state)).toMatchObject({ ok: false, host: null, template: null })
    expect(livePreview(g.k, g.state).blocks).toEqual(['現在沒有可以掛直播的活動：要在戰鬥、成人場景或委託副本裡。'])
    const b = liveB()
    expect(livePreview(b.k, b.state).blocks).toContain('已經在直播了：先收播。')
    expect(reasonOf(() => goLive(b.k, b.state))).toContain('已經在直播了')
  })

  it('要開著頻道（有人註冊條件 channel_open 才問）：沒開擋下；沒裝頻道的局照樣開得了', () => {
    const closed = makeB({ flags: { channel_on: false } })
    expect(livePreview(closed.k, closed.state).blocks).toEqual(['還沒有開頻道，不能直播。'])
    const open = makeB()
    expect(livePreview(open.k, open.state).ok).toBe(true)
    const none = makeB({ channel: false, media: false })
    expect(none.k.conditions.kinds()).not.toContain('channel_open')
    expect(livePreview(none.k, none.state).ok).toBe(true)
  })

  it('所在的地方有 no_rec（設施的種類、街區、區）開不了', () => {
    const noRec: ContentPack = { id: 'norec', content: { facility_type: [{ id: 'fac_nocam', name: '禁拍的店', no_rec: true }] } }
    const kinds: Feature = { id: 'kinds', install(k: Kernel) { k.content.defineKind({ kind: 'facility_type', owner: 'kinds', validate: () => [] }) } }
    const g = makeBattleGame({ features: [TEST_COMBAT, kinds, ...baseFeatures({})], content: [METER_CONTENT, goalPack(), noRec], patch: { ...patchOf({}), location: { district: 'test', block: 'empty_room', facility: 'fac_nocam' } } }).game
    expect(livePreview(g.k, g.state).blocks).toEqual(['這裡不准錄影，開不了直播。'])
    expect(reasonOf(() => goLive(g.k, g.state))).toBe('這裡不准錄影，開不了直播。')
  })

  it('沒有主角：開不了', () => {
    const g = makeGame({ features: [COMMISSION_TOY, ...baseFeatures({})], content: [METER_CONTENT, goalPack()], pc: false })
    expect(livePreview(g.game.k, g.game.state).blocks[0]).toBe('還沒有主角，不能直播。')
  })

  it('開播的報告：live.go、kind broadcast、一拍 live.go、session 寫進狀態、id 是 lv1；下一場是 lv2（seq 不倒退）', () => {
    const g = makeB()
    const r = go(g)
    expect(r).toMatchObject({ action: 'live.go', kind: 'broadcast' })
    expect(r.timeline.map((b) => b.tag)).toEqual(['live.go'])
    expect(session(g)).toMatchObject({ id: 'lv1', mode: 'activity', template: 'st_combat', host: { kind: 'battle' }, by: 'pc', heat: 0 })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['battle', 'live'])
    cut(g)
    expect(live(g)).toMatchObject({ session: null, seq: 1 })
    expect(live(g).log.map((e) => e.id)).toEqual(['lv1'])
  })
})

// ===================================================================================================================
describe('目標：開播前就看得到，抽到的和開播之後的一樣（固定亂數）', () => {
  it('livePreview 的目標和 goLive 之後的一樣；同一個種子同一場永遠抽到同一組（不看亂數的游標）', () => {
    const g = makeB({ goals: GOALS.filter((x) => x.id !== 'g_news') })
    const p = livePreview(g.k, g.state)
    expect(p.goals.length).toBeGreaterThanOrEqual(1)
    expect(p.goals.length).toBeLessThanOrEqual(3)
    const again = livePreview(g.k, g.state)
    expect(again.goals).toEqual(p.goals)
    // 亂數的游標往前推（別的行動擲了骰）也不影響
    const h = makeB({ goals: GOALS.filter((x) => x.id !== 'g_news') })
    h.commit(rep('battle.test', { kind: 'combat', changes: [{ op: 'rng', advance: 5 }] }))
    expect(livePreview(h.k, h.state).goals).toEqual(p.goals)
    go(g)
    expect(session(g).goals.map((x) => ({ id: x.id, text: x.text, heat: x.heat, tip: x.tip }))).toEqual(p.goals)
    expect(session(g).goals.every((x) => x.done === false)).toBe(true)
  })

  it('每一條：heat 沒寫用規則的 3；tip 是 tip_per_grade × 等級（戰鬥照戰場的等級）', () => {
    const goals = [{ id: 'g_plain', text: '什麼都沒寫。', scope: ['combat'], check: { event: 'crit', count_min: 1 } }, GOALS[0]!]
    const g = makeB({ goals, templates: [ONE_PICK], grade: 3 })
    const p = livePreview(g.k, g.state)
    for (const x of p.goals) expect(x).toMatchObject({ heat: 3, tip: x.id === 'g_plain' ? 0 : 300 })
    expect(p.grade).toBe(3)
  })

  it('寫了 channel（頻道的定位）的目標不會被抽到', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = makeB({ seed })
      expect(livePreview(g.k, g.state).goals.map((x) => x.id)).not.toContain('g_news')
    }
  })

  it('抽的個數照模板的 pick：只放一條時每場都是它；沒有合格的目標就沒有目標', () => {
    const g = makeB({ goals: [GOALS[0]!], templates: [ONE_PICK] })
    expect(livePreview(g.k, g.state).goals.map((x) => x.id)).toEqual(['g_two_crits'])
    const none = makeB({ goals: [GOALS[3]!] })
    expect(livePreview(none.k, none.state).goals).toEqual([])
    expect(go(none).timeline[0]!.data).toMatchObject({ goals: [] })
  })

  it('live_goal_extra 大於 0：多抽那麼多個，玩家在 goLive 的輸入挑掉同樣多個', () => {
    const extra: Feature = { id: 'extra', install(k: Kernel) { k.stats.addStatProvider('live_goal_extra', 'extra', () => [{ label: '測試', value: 2, source: 'perk' }]) } }
    const g = makeB({ goals: [GOALS[0]!, GOALS[1]!, GOALS[2]!], templates: [ONE_PICK], features: [extra] })
    const p = livePreview(g.k, g.state)
    expect(p.goals).toHaveLength(3)
    expect(p.drop).toBe(2)
    expect(reasonOf(() => goLive(g.k, g.state))).toContain('要挑掉剛好 2 個')
    expect(reasonOf(() => goLive(g.k, g.state, { drop: [p.goals[0]!.id] }))).toContain('要挑掉剛好 2 個')
    expect(reasonOf(() => goLive(g.k, g.state, { drop: [p.goals[0]!.id, p.goals[0]!.id] }))).toContain('要挑掉剛好 2 個')
    expect(reasonOf(() => goLive(g.k, g.state, { drop: ['g_nope', p.goals[0]!.id] }))).toBe('挑掉的目標不在這一場抽到的清單裡。')
    go(g, { drop: [p.goals[0]!.id, p.goals[1]!.id] })
    expect(session(g).goals.map((x) => x.id)).toEqual([p.goals[2]!.id])
  })

  it('沒有多抽的時候 drop 是空的；多給了 drop 被擋', () => {
    const g = makeB()
    expect(livePreview(g.k, g.state).drop).toBe(0)
    expect(reasonOf(() => goLive(g.k, g.state, { drop: ['g_two_crits'] }))).toBe('這一場沒有要挑掉的目標。')
  })

  it('副本直播的目標是 commission.enter 那一拍 stream_goals 寫的那幾條（查不到的略過）', () => {
    const g = makeN()
    g.commit(cEnter({ stream_goals: ['g_two_stages', 'g_no_one_down', 'g_nope'] }))
    const p = livePreview(g.k, g.state)
    expect(p.goals.map((x) => x.id)).toEqual(['g_two_stages', 'g_no_one_down'])
    expect(p.grade).toBe(2)
    expect(p.goals.map((x) => x.tip)).toEqual([160, 300])
    expect(p.drop).toBe(0)
  })
})

// ===================================================================================================================
describe('亮點：report.before 對出事件、照模板加熱度（寫在同一份報告的變更裡）', () => {
  it('我方的要害、敵人過載、打倒敵人各 +1；敵人的要害不加、我方被過載不加', () => {
    const g = liveB()
    const r = g.commit(step(crit('a1'), crit('f1'), overload('f1'), overload('a1'), down('foe')))[0]!
    expect(session(g)).toMatchObject({ heat: 3, counts: { crit: 1, overload_foe: 1, foe_down: 1 } })
    // 熱度寫在同一份報告的變更裡
    expect(r.changes.some((c) => c.op === 'live.add')).toBe(true)
    expect(session(g).highlights.map((h) => h.event)).toEqual(['crit', 'overload_foe', 'foe_down'])
    expect(session(g).highlights.every((h) => h.report === r.id)).toBe(true)
    expect(session(g).tips).toBe(3 * DEFAULT_LIVE_RULES.heat_tips)
  })

  it('我方倒下（down／subdue 的我方）算 ally_down、不加熱度；制伏敵人算 foe_down', () => {
    const g = liveB()
    g.commit(step(down('ally'), down('ally', 'subdued'), down('foe', 'subdued')))
    expect(session(g)).toMatchObject({ heat: 1, counts: { ally_down: 2, foe_down: 1 } })
  })

  it('單位在哪一邊查 state.battle；這一步才進場的（查不到）看 id 的開頭', () => {
    const g = liveB()
    expect(Object.keys(g.state.battle!.units).slice(0, 2)).toEqual(['a1', 'a2'])
    g.commit(step(crit('a9'), crit('f9')))
    expect(session(g).counts.crit).toBe(1)
  })

  it('戰鬥的結果：battle.end 那一拍 outcome 是 win 算 battle_won、lose 與 surrender 算 battle_lost（戰鬥模板沒有列，只計數）', () => {
    const g = liveB()
    g.commit(step(tag('battle.end', { outcome: 'win' }), tag('battle.end', { outcome: 'lose' }), tag('battle.end', { outcome: 'surrender' }), tag('battle.end', { outcome: 'fled' })))
    expect(session(g).counts).toMatchObject({ battle_won: 1, battle_lost: 2 })
    expect(session(g).heat).toBe(0)
  })

  it('結束那一份 battle.end 把每一步重述一次，不算（不然每件事算兩次）', () => {
    const g = liveB()
    g.commit(rep('battle.end', { kind: 'combat', timeline: [crit('a1'), down('foe')] }))
    expect(session(g).counts).toEqual({})
    expect(eventsOf(g.state, step(crit('a1')))).toEqual(['crit'])
    expect(eventsOf(g.state, rep('battle.abort', { timeline: [crit('a1')] }))).toEqual([])
  })

  it('真的戰鬥打完：每一步只算一次——counts 和每一步報告裡的標籤對得上', () => {
    for (const seed of [3, 5, 8]) {
      const g = liveB({ seed })
      const out = playOut(g, 600)
      const ids = new Set(g.state.battle!.steps)
      const steps = g.state.reports.filter((r) => ids.has(r.id))
      let crits = 0
      let downs = 0
      for (const r of steps) for (const b of r.timeline) {
        const d = (b.data ?? {}) as Rec
        if (b.tag === 'crit' && String(d.attacker).startsWith('a')) crits += 1
        if ((b.tag === 'down' || b.tag === 'subdue') && d.side === 'foe') downs += 1
      }
      const c = session(g).counts
      expect(c.crit ?? 0, `seed ${seed}`).toBe(crits)
      expect(c.foe_down ?? 0, `seed ${seed}`).toBe(downs)
      expect(c.battle_won ?? 0).toBe(out.outcome === 'win' ? 1 : 0)
      expect(c.battle_lost ?? 0).toBe(out.outcome === 'lose' ? 1 : 0)
      expect(session(g).heat).toBe((c.crit ?? 0) + (c.overload_foe ?? 0) + (c.foe_down ?? 0))
    }
  })

  it('副本直播：里程碑、分支、戰鬥的結果各 +1；裡面那場戰鬥的要害不另外加（只計數）', () => {
    const g = liveC()
    expect(session(g).template).toBe('st_commission')
    g.commit(cStage())
    g.commit(cBranch())
    g.commit(step(crit('a1'), tag('battle.end', { outcome: 'win' }), tag('battle.end', { outcome: 'lose' })))
    expect(session(g)).toMatchObject({ heat: 4, counts: { stage_done: 1, branch: 1, crit: 1, battle_won: 1, battle_lost: 1 } })
  })

  it('成人直播：scene.act 每一個 +1、最多 +10；等著（end_turn）不算；被視窗換掉的行動照一份報告算一次；scene.end 計數不加熱度', () => {
    const g = liveS()
    for (let i = 0; i < 4; i++) g.commit(sAct())
    expect(session(g).heat).toBe(4)
    g.commit(sAct(tag('end_turn')))
    expect(session(g)).toMatchObject({ heat: 4, counts: { scene_act: 4 } })
    g.commit(sAct(tag('scene.override', { owner: 'x', from: 'dominate', to: 'tease' })))
    expect(session(g).heat).toBe(5)
    for (let i = 0; i < 10; i++) g.commit(sAct())
    expect(session(g).heat).toBe(10)
    expect(session(g).counts.scene_act).toBe(15)
    expect(session(g).from.scene_act).toBe(10)
    g.commit(rep('scene.next', { kind: 'social' }))
    expect(session(g).counts.scene_act).toBe(15)
  })

  it('max_from 夾每一種的上限：模板寫了用模板的；成人模板沒寫用規則的 adult_cap；同一份報告裡好幾拍也不會超過', () => {
    const tpl = { id: 'st_adult', name: '成人直播', scope: 'adult', highlights: [{ event: 'scene_act', heat: 2 }, { event: 'scene_end', heat: 5 }], max_from: { scene_act: 5 }, goals: { pick: [0, 0] } }
    const g = liveS({ templates: [tpl] })
    for (let i = 0; i < 4; i++) g.commit(sAct())
    expect(session(g).heat).toBe(5)
    g.commit(sEnd(g, 'stop'))
    expect(live(g).log[0]!.heat).toBe(5)
    // 模板沒有 max_from：成人直播的 scene_act 用規則的 adult_cap（10）
    const noMax = { id: 'st_adult', name: '成人直播', scope: 'adult', highlights: [{ event: 'scene_act', heat: 4 }], goals: { pick: [0, 0] } }
    const h = liveS({ templates: [noMax] })
    for (let i = 0; i < 4; i++) h.commit(sAct())
    expect(session(h).heat).toBe(10)
    expect(liveRules(h.k).adult_cap).toBe(10)
    // 規則表蓋掉 adult_cap
    const r = liveS({ templates: [noMax], content: [{ id: 'r', content: { live_rule: [{ id: 'default', adult_cap: 6 }] } }] })
    for (let i = 0; i < 4; i++) r.commit(sAct())
    expect(session(r).heat).toBe(6)
  })

  it('一份草稿有好幾個事件：每一個照順序算、上限算在前面的後面', () => {
    const tpl = { id: 'st_combat', name: '戰鬥直播', scope: 'combat', highlights: [{ event: 'crit', heat: 2 }], max_from: { crit: 3 }, goals: { pick: [0, 0] } }
    const g = liveB({ templates: [tpl] })
    g.commit(step(crit(), crit(), crit()))
    expect(session(g).heat).toBe(3)
    expect(session(g).highlights.map((h) => h.heat)).toEqual([2, 1, 0].filter((x) => x > 0))
    expect(session(g).counts.crit).toBe(3)
  })

  it('沒在直播、或收播之後：報告不帶任何 live.add；回到沒有 live 的局也一樣', () => {
    const g = makeB()
    const r = g.commit(step(crit(), down('foe')))[0]!
    expect(r.changes.some((c) => c.op === 'live.add')).toBe(false)
    expect(live(g).session).toBeNull()
  })

  it('開播的那一份與收播的那一份本身不再算事件（不會在沒有這一場的狀態上加熱度）', () => {
    const g = liveS()
    g.commit(sAct())
    const before = session(g).heat
    // 結束那一份（scene.end）帶 live.close，report.before 不再加 live.add
    const r = g.commit(sEnd(g))[0]!
    expect(r.changes.filter((c) => c.op === 'live.add')).toEqual([])
    expect(before).toBe(1)
    expect(live(g).session).toBeNull()
  })
})

// ===================================================================================================================
describe('風險：敵對值 ×1.5（V23）', () => {
  it('戰鬥直播中勢力敵對值 +4 的那一份報告實際是 +6；沒在直播時是 +4', () => {
    const plain = makeB()
    plain.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 4 }], 'battle.test'))
    expect(hostility(plain)).toBe(4)
    const g = liveB()
    const r = g.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 4 }], 'battle.test'))[0]!
    expect(hostility(g)).toBe(6)
    expect(r.changes.filter((c) => c.op === 'meter')).toHaveLength(2)
  })

  it('進位：+3 變 +5、+1 變 +2；負的與 set 不動；每個勢力各算各的', () => {
    const g = liveB()
    g.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 3 }, { op: 'meter', kind: 'hostility', key: 'f_beta', delta: 1 }], 'battle.test'))
    expect([hostility(g), hostility(g, 'f_beta')]).toEqual([5, 2])
    g.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: -2 }], 'battle.test'))
    expect(hostility(g)).toBe(3)
    g.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', set: 40 }], 'battle.test'))
    expect(hostility(g)).toBe(40)
    expect(hostilityExtra([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 4 }, { op: 'meter', kind: 'favor', key: 'f_alpha', delta: 4 }], 1.5)).toEqual([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 2 }])
  })

  it('模板沒有 risk（副本、成人）不加；收播之後不加', () => {
    const c = liveC()
    c.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 4 }], 'commission.test'))
    expect(hostility(c)).toBe(4)
    const g = liveB()
    cut(g)
    g.commit(sys([{ op: 'meter', kind: 'hostility', key: 'f_alpha', delta: 4 }], 'battle.test'))
    expect(hostility(g)).toBe(4)
  })

  it('沒有人定義敵對值（沒裝 security）的局：什麼都不發', () => {
    const g = makeBattleGame({ features: [TEST_COMBAT, liveFeature], content: [goalPack()], seed: 11 }).game
    go(g)
    expect(g.k.meters.has('hostility')).toBe(false)
    expect(g.commit(step(crit()))[0]!.changes.filter((c) => c.op === 'meter')).toEqual([])
  })
})

// ===================================================================================================================
describe('觀看數與級距（MEDIA 1.2）', () => {
  it('基本盤 = 訂閱 × 5%、最少 20；觀看數 = 基本盤 ×（1 ＋ 0.1 × 熱度），熱度算到 20 為止（上限是基本盤的三倍）', () => {
    const table: Array<[number, number[]]> = [[100, [20, 40, 60, 60]], [1000, [50, 100, 150, 150]], [10000, [500, 1000, 1500, 1500]]]
    for (const [s, expected] of table) {
      const got = [0, 10, 20, 25].map((h) => viewersFrom(DEFAULT_LIVE_RULES, s, h).viewers)
      expect(got, `訂閱 ${s}`).toEqual(expected)
    }
    expect(viewersFrom(DEFAULT_LIVE_RULES, 399, 0).base).toBe(20)
    expect(viewersFrom(DEFAULT_LIVE_RULES, 400, 0).base).toBe(20)
    expect(viewersFrom(DEFAULT_LIVE_RULES, 421, 0).base).toBe(21)
  })

  it('三個級距：基本盤 ×1.5 以下冷清、1.5～2.5 熱、2.5 以上爆（正好 1.5 算冷清、正好 2.5 算爆）', () => {
    const tier = (heat: number): string => viewersFrom(DEFAULT_LIVE_RULES, 1000, heat).tier
    expect([0, 5, 6, 10, 14, 15, 20, 30].map(tier)).toEqual(['cold', 'cold', 'hot', 'hot', 'hot', 'blast', 'blast', 'blast'])
  })

  it('viewersOf 讀量表 subs 與這一場的熱度；沒有頻道（沒有 subs 量表）當 0 訂閱、基本盤 20', () => {
    const g = liveB({ subs: 10000 })
    expect(viewersOf(g.k, g.state)).toMatchObject({ base: 500, viewers: 500, tier: 'cold' })
    g.commit(step(...Array.from({ length: 10 }, () => crit())))
    expect(viewersOf(g.k, g.state)).toMatchObject({ viewers: 1000, tier: 'hot' })
    expect(viewersOf(g.k, g.state, 20).viewers).toBe(1500)
    const none = makeB({ channel: false, media: false })
    expect(viewersOf(none.k, none.state, 10)).toMatchObject({ base: 20, viewers: 40 })
  })

  it('規則表可以蓋掉：基本盤的百分比、級距', () => {
    const rules: ContentPack = { id: 'r', content: { live_rule: [{ id: 'default', viewers: { base_pct: 10 }, tiers: [1.2, 2] }] } }
    const g = makeB({ content: [rules] })
    expect(liveRules(g.k).viewers.base_pct).toBe(10)
    expect(viewersFrom(liveRules(g.k), 1000, 0).base).toBe(100)
    expect(viewersFrom(liveRules(g.k), 1000, 3).tier).toBe('hot')
    expect(viewersFrom(liveRules(g.k), 1000, 10).tier).toBe('blast')
  })
})

// ===================================================================================================================
describe('收播：宿主結束就收（V25、V26）', () => {
  it('打贏收播：達成「打倒至少一個敵人」+3 熱度與打賞；訂閱 = 熱度 × 6 ＋ 觀看數 ÷ 400；media.record 一次、帶 live 與 hq；activity.end（live）發一次；併在宿主結束的那一份', async () => {
    const g = liveB({ goals: [GOALS[2]!], templates: [ONE_PICK], subs: 10000, seed: 5 })
    const out = playOut(g, 800)
    expect(out.outcome).toBe('win')
    const s0 = session(g)
    const heat0 = s0.heat
    const money = cred(g)
    await g.finishBattle()
    const entry = live(g).log[0]!
    const heat = heat0 + 3
    const viewers = viewersFrom(DEFAULT_LIVE_RULES, 10000, heat).viewers
    expect(entry).toMatchObject({ id: 'lv1', mode: 'activity', template: 'st_combat', heat, goals_done: 1, record: true, viewers })
    expect(entry.subs).toBe(heat * 6 + Math.floor(viewers / 400))
    expect(entry.tips).toBe(heat * 8 + 100)
    expect(entry.lost).toBeUndefined()
    expect(subs(g)).toBe(10000 + entry.subs)
    expect(cred(g)).toBe(money + entry.tips)
    expect(live(g).session).toBeNull()
    // media.record 一次：帶 live、hq，沒有 lost
    expect(stubRec(g)).toHaveLength(1)
    expect(stubRec(g)[0]).toMatchObject({ source: { kind: 'live', ref: 'lv1' }, label: '戰鬥直播（戰鬥）', hint: { live: true, hq: true, type: 'battle' } })
    expect(stubRec(g)[0]!.hint.lost).toBeUndefined()
    // activity.end（live）發一次，結果帶 mode、template、heat、viewers、subs、tips、goals_done、to_channel、host
    expect(stubEnds(g)).toHaveLength(1)
    expect(stubEnds(g)[0]).toMatchObject({ id: 'lv1', mode: 'activity', template: 'st_combat', heat, viewers, subs: entry.subs, tips: entry.tips, goals_done: 1, to_channel: true, host: { kind: 'battle' } })
    // 結算併在宿主結束的那一份裡：沒有出自己的報告
    const end = g.state.reports.filter((r) => r.action === 'battle.end')
    expect(end).toHaveLength(1)
    expect(end[0]!.changes.some((c) => c.op === 'live.close')).toBe(true)
    expect(g.state.reports.some((r) => r.action === 'live.cut')).toBe(false)
    expect(end[0]!.narration?.results?.join('')).toContain('直播收播了。')
    expect(end[0]!.narration?.results?.join('')).not.toMatch(/\d/)
  })

  it('沒達成的目標不扣熱度，只是少拿：打贏但沒有要害的「兩次要害」', () => {
    const goals = [{ ...GOALS[0]!, check: { event: 'crit', count_min: 999 } }]
    const g = liveB({ goals, templates: [ONE_PICK] })
    g.commit(step(down('foe')))
    cut(g)
    expect(live(g).log[0]).toMatchObject({ heat: 1, goals_done: 0, tips: 8 })
  })

  it('目標的熱度與打賞照各自的：達成的各加一次（兩條目標的總和）', () => {
    const goals = [{ ...GOALS[0]!, heat: 4, tip_per_grade: 70 }, { ...GOALS[2]!, heat: 2, tip_per_grade: 30 }]
    const tpl = { ...ONE_PICK, goals: { pick: [2, 2] } }
    const g = liveB({ goals, templates: [tpl], grade: 2 })
    g.commit(step(crit(), crit(), down('foe')))
    cut(g)
    // 熱度 3（亮點）＋ 4 ＋ 2 ＝ 9；打賞 9 × 8 ＋ 70 × 2 ＋ 30 × 2
    expect(live(g).log[0]).toMatchObject({ heat: 9, goals_done: 2, tips: 72 + 140 + 60 })
  })

  it('沒有頻道、沒有 media 的局：照樣開得了、收播只有打賞（沒有訂閱、沒有紀錄）', async () => {
    const g = makeB({ channel: false, media: false, goals: [] })
    expect(g.k.hooks.owners('rewind.keep' as never)).not.toContain('media_stub')
    go(g)
    g.commit(step(crit(), crit(), down('foe')))
    const money = cred(g)
    cut(g)
    const e = live(g).log[0]!
    expect(e.subs).toBe(0)
    expect(e.tips).toBe(3 * 8)
    expect(e.record).toBeUndefined()
    expect(cred(g)).toBe(money + 24)
    expect(stubRec(g)).toEqual([])
  })

  it('有頻道、沒有 media：有訂閱、沒有紀錄；有 media、沒有頻道：有紀錄、沒有訂閱', () => {
    const a = makeB({ media: false, goals: [] })
    go(a)
    a.commit(step(crit()))
    cut(a)
    expect(live(a).log[0]).toMatchObject({ subs: 6 })
    expect(live(a).log[0]!.record).toBeUndefined()
    const b = makeB({ channel: false, goals: [] })
    go(b)
    b.commit(step(crit()))
    cut(b)
    expect(live(b).log[0]).toMatchObject({ subs: 0, record: true })
    expect(stubRec(b)).toHaveLength(1)
  })

  it('宿主輸了（戰敗）：紀錄帶 lost；Settled 標 lost；activity.end 的結果標 lost', async () => {
    const g = liveB({ battle: 'hopeless', seed: 4 })
    const out = playOut(g, 800)
    expect(out.outcome).toBe('lose')
    await g.finishBattle()
    expect(live(g).log[0]).toMatchObject({ lost: true, record: true })
    expect(stubRec(g)[0]!.hint).toMatchObject({ live: true, hq: true, lost: true })
    expect(stubEnds(g)[0]).toMatchObject({ lost: true })
    expect(live(g).session).toBeNull()
  })

  it('宿主結束的種類與 id 對得上才收：別的宿主結束不收；副本直播時裡面那場戰鬥結束不收（宿主是副本）', async () => {
    const g = liveC()
    expect(g.state.battle).toBeNull()
    // 另一場戰鬥結束（kind battle、id b9）：不是宿主
    const end = endActivity(g.k, { state: g.state, kind: 'battle', id: 'b9', origin: { by: 'x' }, outcome: 'win', result: {} })
    expect(end.changes.filter((c) => c.op === 'live.close')).toEqual([])
    const sc = endActivity(g.k, { state: g.state, kind: 'scene', id: 's1', origin: { by: 'x' }, outcome: 'stop', result: {} })
    expect(sc.changes).toEqual([])
    expect(live(g).session).not.toBeNull()
  })

  it('副本直播：做完（done）收播；里程碑 2 個＋分支 1 個＋達成「過兩個階段」', () => {
    const g = liveC()
    g.commit(cStage())
    g.commit(cStage())
    g.commit(cBranch())
    g.commit(cEnd(g, 'done'))
    // 亮點 3 ＋ 目標 3 ＝ 6；打賞 6 × 8 ＋ 80 × 2
    expect(live(g).log[0]).toMatchObject({ heat: 6, goals_done: 1, tips: 48 + 160 })
    expect(live(g).log[0]!.lost).toBeUndefined()
    expect(g.state.reports.filter((r) => r.action === 'commission.finish')[0]!.changes.some((c) => c.op === 'live.close')).toBe(true)
  })

  it('成人直播：收播時每條目標照 counts 檢查；起始熱度算進熱度', () => {
    const g = liveS({ fame: 65 })
    expect(session(g).heat).toBe(2)
    for (let i = 0; i < 3; i++) g.commit(sAct())
    g.commit(sEnd(g))
    expect(live(g).log[0]).toMatchObject({ template: 'st_adult', heat: 2 + 3 + 3, goals_done: 1 })
  })

  it('提早收播（cutLive）：和宿主結束同一套結算，出自己的一份報告 live.cut、有一拍 live.end', () => {
    const g = liveB({ goals: [GOALS[0]!], templates: [ONE_PICK] })
    g.commit(step(crit(), crit()))
    const money = cred(g)
    const r = cut(g)
    expect(r).toMatchObject({ action: 'live.cut', kind: 'broadcast' })
    expect(r.timeline.map((b) => b.tag)).toEqual(['live.end'])
    expect(r.timeline[0]!.data).toMatchObject({ id: 'lv1', mode: 'activity', heat: 5, goals: ['g_two_crits'], goals_done: 1, early: true })
    expect(live(g).log[0]).toMatchObject({ heat: 5, goals_done: 1, tips: 5 * 8 + 100, subs: 30 })
    expect(cred(g)).toBe(money + 140)
    expect(live(g).session).toBeNull()
    expect(stubRec(g)).toHaveLength(1)
    expect(stubEnds(g)).toHaveLength(1)
  })

  it('提早收播：只有「最多幾次」的目標還沒到終點，不算達成（不然一開播就收等於白拿）；打完收的才算', () => {
    const g = liveB({ goals: [GOALS[1]!], templates: [ONE_PICK] })
    cut(g)
    expect(live(g).log[0]).toMatchObject({ goals_done: 0, heat: 0 })
    const h = liveB({ goals: [GOALS[1]!], templates: [ONE_PICK] })
    const s = session(h)
    const done = settleSession(h.k, h.state, s, { outcome: 'win', early: false, lost: false })
    expect(done.entry.goals_done).toBe(1)
  })

  it('沒在直播不能收；收了不能再收；時段直播要照時段的流程收', () => {
    const g = makeB()
    expect(reasonOf(() => cutLive(g.k, g.state))).toBe('現在沒有在直播。')
    go(g)
    cut(g)
    expect(reasonOf(() => cutLive(g.k, g.state))).toBe('現在沒有在直播。')
  })

  it('收播的結果最多留 log_keep 筆（預設 20）；id 一直往上', () => {
    const g = makeB()
    for (let i = 0; i < 22; i++) {
      go(g)
      cut(g)
      // 第一輪才開得了：每次都把戰鬥狀態當成剛開始（直接蓋回去不動報告）
    }
    expect(live(g).log).toHaveLength(20)
    expect(live(g).log[0]!.id).toBe('lv3')
    expect(live(g).log.at(-1)!.id).toBe('lv22')
    expect(live(g).seq).toBe(22)
  })

  it('house（內場、迷宮館的參數；第三波才有人給）：觀看數的倍率、打賞的倍率、to_channel 在結算時照算', () => {
    const g = liveB({ subs: 10000 })
    const base = session(g)
    const heated: LiveSession = { ...base, heat: 10, tips: 80 }
    const plain = settleSession(g.k, g.state, heated, { outcome: 'win', early: false, lost: false })
    expect(plain.entry).toMatchObject({ viewers: 1000, subs: 60 + 2, tips: 80 })
    const half = settleSession(g.k, g.state, { ...heated, house: { views_mult: 0.5, tips_mult: 2, to_channel: true } }, { outcome: 'win', early: false, lost: false })
    expect(half.entry).toMatchObject({ viewers: 500, subs: 60 + 1, tips: 160 })
    const off = settleSession(g.k, g.state, { ...heated, house: { views_mult: 1, tips_mult: 0, to_channel: false } }, { outcome: 'win', early: false, lost: false })
    expect(off.entry).toMatchObject({ subs: 0, tips: 0, off_channel: true })
    expect(off.result).toMatchObject({ to_channel: false })
    expect(off.changes.some((c) => c.op === 'meter')).toBe(false)
    expect(off.changes.some((c) => c.op === 'cred')).toBe(false)
  })
})

// ===================================================================================================================
describe('直播不回退：deny（核心的 undo）與回到快照', () => {
  it('直播中 Game.undoBlock() 有原因、undoSteps 不動（堆疊原樣）；收播之後可以', () => {
    const g = makeB()
    expect(g.undoBlock()).toBeNull()
    go(g)
    const size = g.undo.size
    expect(g.undoBlock()).toBe('直播進行中，不能回退。要先收播。')
    expect(g.undoSteps()).toBe(false)
    expect(g.undo.size).toBe(size)
    expect(session(g)).toBeTruthy()
    cut(g)
    expect(g.undoBlock()).toBeNull()
    expect(g.undoSteps()).toBe(true)
  })

  it('收播獨立成一步（接受這個行為，釘著現況）：收播之後回退一次回到「直播中」，再回退又被擋', () => {
    const g = makeB()
    go(g)
    g.commit(step(crit()))
    cut(g)
    expect(live(g).session).toBeNull()
    expect(g.undoSteps()).toBe(true)
    expect(session(g)).toMatchObject({ id: 'lv1', heat: 1 })
    expect(g.undoBlock()).toBe('直播進行中，不能回退。要先收播。')
    expect(g.undoSteps()).toBe(false)
  })

  it('宿主結束併在同一步：回退一次回到宿主的最後一步（直播中、結果沒有結算），之後又被擋', async () => {
    const g = liveB({ seed: 5 })
    playOut(g, 800)
    await g.finishBattle()
    expect(live(g).log).toHaveLength(1)
    const money = cred(g)
    expect(g.undoSteps()).toBe(true)
    expect(live(g).log).toHaveLength(0)
    expect(session(g)).toBeTruthy()
    expect(cred(g)).toBeLessThanOrEqual(money)
    expect(g.undoSteps()).toBe(false)
  })

  it('deny 擋下時 reason 的第二個參數是 undo：reason 對 undo 與對別的 doing 句子不同', () => {
    const g = liveB()
    const def = g.k.activity.get('live')!
    expect(def.deny).toEqual(['undo'])
    expect(def.reason(g.state, 'undo')).toBe('直播進行中，不能回退。要先收播。')
    expect(def.reason(g.state, 'commit:x')).toContain('先把它收掉')
  })

  it('副本直播到一半撤退（回到 entry 的快照）：訂閱與打賞留著、紀錄一則標 lost、session 清掉、頻道的記錄補回來；再做一次撤退不會多算一次', () => {
    const g = liveC()
    g.commit(cStage())
    g.commit(cStage())
    g.commit(cBranch())
    const s0 = subs(g)
    const c0 = cred(g)
    g.commit(cEnd(g, 'retreat'))
    // 撤退之後狀態回到進去之前，但直播是真的播出去了
    expect(g.state.ext.toy_c).toBeUndefined()
    expect(live(g).session).toBeNull()
    expect(live(g).log).toHaveLength(1)
    const e = live(g).log[0]!
    expect(e).toMatchObject({ id: 'lv1', lost: true, goals_done: 1, heat: 6, record: true })
    expect(subs(g)).toBe(s0 + e.subs)
    expect(cred(g)).toBe(c0 + e.tips)
    expect(stubRec(g)).toHaveLength(1)
    expect(stubRec(g)[0]!.hint).toMatchObject({ live: true, hq: true, lost: true })
    expect(stubEnds(g)).toHaveLength(1)
    expect(stubEnds(g)[0]).toMatchObject({ id: 'lv1', heat: 6, lost: true })
    // 再做一次：同樣的流程，兩次各算一次，不是三次
    g.commit(cEnter())
    go(g)
    expect(session(g).id).toBe('lv2')
    g.commit(cStage())
    g.commit(cEnd(g, 'retreat'))
    expect(live(g).log.map((x) => x.id)).toEqual(['lv1', 'lv2'])
    const e2 = live(g).log[1]!
    expect(subs(g)).toBe(s0 + e.subs + e2.subs)
    expect(cred(g)).toBe(c0 + e.tips + e2.tips)
    expect(stubRec(g)).toHaveLength(2)
    expect(stubEnds(g).map((x) => x.id)).toEqual(['lv1', 'lv2'])
  })

  it('委託失敗（failed，帶 rewind）也一樣：訂閱與打賞留著、標 lost', () => {
    const g = liveC()
    g.commit(cStage())
    const c0 = cred(g)
    const d = cEnd(g, 'failed')
    g.commit({ ...d, rewind: { kind: 'entry', summary: '委託失敗了。', fresh: true } })
    expect(live(g).log).toHaveLength(1)
    expect(live(g).log[0]).toMatchObject({ lost: true })
    expect(cred(g)).toBe(c0 + live(g).log[0]!.tips)
  })

  it('戰鬥直播打輸、選「重來這一場」：上一場的直播已經結算一次，重來的那一場可以再開一場新的', async () => {
    const g = liveB({ battle: 'hopeless', seed: 4 })
    const s0 = subs(g)
    const c0 = cred(g)
    playOut(g, 800)
    await g.finishBattle()
    const e = live(g).log[0]!
    expect(e.lost).toBe(true)
    const afterSubs = subs(g)
    const afterCred = cred(g)
    expect(afterSubs).toBe(s0 + e.subs)
    expect(afterCred).toBe(c0 + e.tips)
    expect(g.retryBattle()).toBeNull()
    // 重來：回到開打之前，直播的結算沒有被收回（只算一次）
    expect(subs(g)).toBe(afterSubs)
    expect(cred(g)).toBe(afterCred)
    expect(live(g).log.map((x) => x.id)).toEqual(['lv1'])
    expect(live(g).session).toBeNull()
    expect(stubRec(g)).toHaveLength(1)
    expect(stubEnds(g)).toHaveLength(1)
    // 重來的那一場可以再開一場新的
    expect(livePreview(g.k, g.state).ok).toBe(true)
    go(g)
    expect(session(g).id).toBe('lv2')
  })

  it('打到一半重來（直播還開著）：當場收播（標 lost）、結算補回去、之後可以再開', () => {
    const g = liveB({ goals: [] })
    g.commit(step(crit(), crit(), down('foe')))
    const s0 = subs(g)
    const c0 = cred(g)
    expect(g.retryBattle()).toBeNull()
    expect(live(g).session).toBeNull()
    expect(live(g).log).toHaveLength(1)
    const e = live(g).log[0]!
    expect(e).toMatchObject({ id: 'lv1', lost: true, heat: 3, record: true })
    expect(subs(g)).toBe(s0 + e.subs)
    expect(cred(g)).toBe(c0 + e.tips)
    expect(stubRec(g)).toHaveLength(1)
    expect(stubRec(g)[0]!.hint).toMatchObject({ lost: true })
    expect(stubEnds(g)).toHaveLength(1)
    expect(g.state.battle!.round).toBe(1)
    expect(livePreview(g.k, g.state).ok).toBe(true)
    go(g)
    expect(session(g).id).toBe('lv2')
  })

  it('快照那一刻已經在播（階段開始之後才開、之後回到階段開始）：回去之前還在播的當場收，session 不會跟著回來', () => {
    const g = makeN()
    g.commit(cEnter())
    go(g)
    // 在直播開著的時候存一份快照（階段開始）
    g.commit(rep('commission.face', { changes: [{ op: 'snapshot.take', kind: 'stage', label: '階段開始', owner: 'c1' }] }))
    g.commit(cStage())
    const c0 = cred(g)
    expect(g.rewindToKind('stage', '回到這個階段開始時。')).toBeNull()
    expect(live(g).session).toBeNull()
    expect(live(g).log).toHaveLength(1)
    expect(live(g).log[0]).toMatchObject({ lost: true, heat: 1 })
    expect(cred(g)).toBe(c0 + live(g).log[0]!.tips)
  })

  it('沒有開過直播的局：回到快照不多發任何東西（live 的狀態逐欄相同、報告的變更裡沒有 live 的）', () => {
    const g = makeN()
    g.commit(cEnter())
    g.commit(cEnd(g, 'retreat'))
    const rewound = g.state.reports.filter((r) => r.action === 'rewind')
    expect(rewound).toHaveLength(1)
    expect(rewound[0]!.changes.filter((c) => c.op === 'ext' && c.key === 'live')).toEqual([])
    expect(live(g)).toEqual({ session: null, seq: 0, log: [] })
  })

  it('回到快照之後，seq 取較大的：下一場的 id 不會和 log 裡的撞', () => {
    const g = liveC()
    g.commit(cEnd(g, 'retreat'))
    g.commit(cEnter())
    go(g)
    expect(session(g).id).toBe('lv2')
    expect(live(g).seq).toBe(2)
  })
})

// ===================================================================================================================
describe('放行：活動直播時全部放行；commit:live. 在每一層活動裡都做得了', () => {
  it('玩具的 dive 包著 netrun、再包著一場戰鬥：live.cut 提交得了（沒有被外層擋）；沒有直播的時候外層擋別的事', () => {
    const g = makeB({ features: [WRAP_TOY], flags: { in_dive: true, in_net: true } })
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['battle', 'netrun', 'dive'])
    expect(g.blockOf('commit:live.go')).toBeNull()
    expect(g.blockOf('commit:live.cut')).toBeNull()
    expect(g.blockOf('commit:market.buy')).not.toBeNull()
    go(g)
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['battle', 'live', 'netrun', 'dive'])
    expect(g.blockOf('commit:live.cut')).toBeNull()
    // 活動直播時 live 自己全部放行（外層與宿主照常擋它自己要擋的）
    expect(g.k.activity.get('live')!.allows?.(g.state, 'commit:anything')).toBe(true)
    const r = cut(g)
    expect(r.action).toBe('live.cut')
    expect(live(g).session).toBeNull()
  })

  it('goLive 在沒有宿主時照樣被自己的條件擋（前綴放行不等於開得了）', () => {
    const g = makeN({ flags: { in_dive: true, in_net: true } })
    expect(g.blockOf('commit:live.go')).toBeNull()
    expect(reasonOf(() => goLive(g.k, g.state))).toBe('現在沒有可以掛直播的活動：要在戰鬥、成人場景或委託副本裡。')
  })

  it('每一種活動（含之後才登記的）都放行 commit:live.，包括核心的戰鬥與戰敗', () => {
    const g = makeB()
    for (const def of g.k.activity.list()) expect(def.allow, def.kind).toContain('commit:live.')
    const late: Feature = { id: 'late', install(k: Kernel) { k.activity.define({ kind: 'late', owner: 'late', order: 60, active: () => null, allow: [], reason: () => 'x' }) } }
    const h = makeB({ features: [late] })
    expect(h.k.activity.get('late')!.allow).toContain('commit:live.')
  })

  it('活動直播時別的行動的原因照宿主：戰鬥裡走路還是被戰鬥擋（live 不放寬宿主）', () => {
    const g = liveB()
    expect(g.blockOf('commit:market.buy')).toBe('正在戰鬥，先把這一場打完。')
    expect(g.blockOf('commit:live.cut')).toBeNull()
  })
})

// ===================================================================================================================
describe('成人直播：起始熱度、同意與偷播（V24）', () => {
  it('起始熱度是各區豔名最高那一區的級數（每 30 點一級）；曝露度有人定義時每 2 級再 +1', () => {
    const plain = liveS({ fame: 65 })
    expect(session(plain).heat).toBe(2)
    expect(session(plain).tips).toBe(16)
    const env = liveS({ fame: 65, env: true, pc: { ext: { expo: 3, skin: 1 } } })
    expect(session(env).heat).toBe(2 + 1)
    const none = liveS({ fame: 29 })
    expect(session(none).heat).toBe(0)
  })

  it('內海的場景（那一拍的 layer 是 net）讀 skin_exposure、現實的讀 exposure', () => {
    const net = liveS({ fame: 0, env: true, pc: { ext: { expo: 0, skin: 3 } } }, { with: 'npc_bob' }, 'net')
    expect(session(net).heat).toBe(1)
    const meat = liveS({ fame: 0, env: true, pc: { ext: { expo: 0, skin: 3 } } })
    expect(session(meat).heat).toBe(0)
  })

  it('每個行動 +1、最多 +10（起始熱度另外算）', () => {
    const g = liveS({ fame: 65 })
    for (let i = 0; i < 14; i++) g.commit(sAct())
    expect(session(g).heat).toBe(2 + 10)
  })

  it('對象的親密度到 60 以上算同意；不到 60 時 secret 是 true、帶觸發點 live_secret', () => {
    const ok = makeN({ affinity: { npc_ann: 60 } })
    ok.commit(sStart({ with: 'npc_ann' }))
    expect(livePreview(ok.k, ok.state)).toMatchObject({ secret: false, consent: [{ id: 'npc_ann', name: '安', ok: true }], risk: [] })
    const r = go(ok)
    expect(session(ok).secret).toBeUndefined()
    expect(r.triggers).toBeUndefined()
    const no = makeN({ affinity: { npc_ann: 59 } })
    no.commit(sStart({ with: 'npc_ann' }))
    const p = livePreview(no.k, no.state)
    expect(p).toMatchObject({ ok: true, secret: true, consent: [{ id: 'npc_ann', ok: false }] })
    expect(p.risk).toEqual(['對象沒有同意：這是偷播，被發現的後果很重。'])
    const r2 = go(no)
    expect(session(no).secret).toBe(true)
    expect(r2.triggers).toEqual([{ point: 'live_secret', where: { host: { kind: 'scene', id: 's1' }, template: 'st_adult' } }])
  })

  it('資料標 stream_ok 算同意（演員的 ext.stream_ok）；沒有親密度量表的局只看 stream_ok', () => {
    const g = makeN()
    g.commit(sStart({ with: 'npc_bob' }))
    expect(livePreview(g.k, g.state).secret).toBe(false)
    const h = makeBattleGame({ features: [COMMISSION_TOY, SCENE_TOY, liveFeature], content: [goalPack()], actors: [makeActor({ id: 'npc_ann', name: '安', role: 'npc' })] }).game
    expect(h.k.meters.has('affinity')).toBe(false)
  })

  it('多人：每一個對象都要同意；單人場景沒有同意的問題', () => {
    const g = makeN({ affinity: { npc_ann: 80 } })
    g.commit(sStart({ with: 'npc_ann', people: ['npc_ann', 'npc_bob'] }))
    expect(livePreview(g.k, g.state)).toMatchObject({ secret: false })
    const h = makeN({ affinity: { npc_ann: 10 } })
    h.commit(sStart({ with: 'npc_ann', people: ['npc_ann', 'npc_bob'] }))
    expect(livePreview(h.k, h.state)).toMatchObject({ secret: true, consent: [{ id: 'npc_ann', ok: false }, { id: 'npc_bob', ok: true }] })
    const solo = makeN()
    solo.commit(sStart({ solo: true, audience: false }))
    expect(livePreview(solo.k, solo.state)).toMatchObject({ ok: true, secret: false, consent: [] })
  })
})

// ===================================================================================================================
describe('條件 live_on（可以寫進被動效果的 if，不繞圈）', () => {
  const test = (g: G, cond: Rec): boolean => g.k.conditions.test({ kind: 'live_on', ...cond }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })

  it('直播中成立、沒在直播不成立；mode 對不上不成立', () => {
    const g = makeB()
    expect(test(g, {})).toBe(false)
    go(g)
    expect(test(g, {})).toBe(true)
    expect(test(g, { mode: 'activity' })).toBe(true)
    expect(test(g, { mode: 'slot' })).toBe(false)
    cut(g)
    expect(test(g, {})).toBe(false)
  })

  it('viewers_min 高於現在的觀看數時不成立；熱度漲了、觀看數跟著漲就成立', () => {
    const g = liveB({ subs: 100 })
    expect(viewersOf(g.k, g.state).viewers).toBe(20)
    expect(test(g, { viewers_min: 20 })).toBe(true)
    expect(test(g, { viewers_min: 21 })).toBe(false)
    g.commit(step(...Array.from({ length: 10 }, () => crit())))
    expect(viewersOf(g.k, g.state).viewers).toBe(40)
    expect(test(g, { viewers_min: 40 })).toBe(true)
    expect(test(g, { viewers_min: 41 })).toBe(false)
  })

  it('格式：不認得的欄位、mode 不對、viewers_min 不是 0 以上的整數都擋；有說明句', () => {
    const g = makeB()
    expect(g.k.conditions.validate({ kind: 'live_on' } as never)).toEqual([])
    const problems = (c: Rec): string => JSON.stringify(g.k.conditions.validate({ kind: 'live_on', ...c } as never))
    expect(problems({ mode: 'x' })).toContain('mode')
    expect(problems({ viewers_min: -1 })).toContain('viewers_min')
    expect(problems({ viewers_min: 1.5 })).toContain('viewers_min')
    expect(problems({ foo: 1 })).toContain('foo')
    expect(g.k.conditions.explain({ kind: 'live_on', viewers_min: 50 } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe('要正在直播，而且觀看數至少 50')
  })

  it('被動效果的 if 寫 [{ kind: live_on }]：直播中那個衍生數值有加、收播後沒有；問衍生數值不會繞圈', () => {
    const g = makeB({ features: [GLOW] })
    const glow = (): number => g.k.stats.stat(g.state, 'pc', 'toy_glow')
    expect(glow()).toBe(0)
    go(g)
    expect(glow()).toBe(2)
    expect(glow()).toBe(2)
    g.commit(step(crit()))
    expect(glow()).toBe(2)
    cut(g)
    expect(glow()).toBe(0)
  })
})

// ===================================================================================================================
describe('場景知道有人在看（features/scene 的 watchedNow；M4 對帳 D2）', () => {
  const BRIDGE = { sensitivity: 50, tolerance: 30, craving: 30, docility: 10 }
  const SOLO_PACK: ContentPack = {
    id: 'solo_live',
    content: {
      night_skill: [{ id: 'nt_aud', name: '給你看', scene: { ap: 1, my_part: ['hand_r'], their_part: ['chest'], on_use: { their_load: '1d6', fit: 2 }, link: { their_load: '1d6', fit: 1 }, solo: 'audience' } }],
      position: [],
      skill: [{ id: 'sync', name: '同步', attr: 'resolve', desc: '撐住回灌。' }],
    },
  }
  const dice = (...values: number[]): Dice => {
    const q = [...values]
    return { int(min, max) { const v = q.shift(); if (v === undefined) throw new Error('骰面用完了'); if (v < min || v > max) throw new Error(`骰面 ${v} 不在 ${min}～${max}`); return v } }
  }
  const heard: Rec[] = []
  const LISTEN: Feature = { id: 'listen', install(k: Kernel) { k.hooks.on('activity.end', 'listen', (p) => { if (p.kind === 'scene') heard.push(p.result) }) } }
  function realScene(withLive: boolean, o: { audience?: boolean } = {}): G {
    heard.length = 0
    const g = makeGame({
      features: [characterFeature, lewdFeature, sceneFeature, LISTEN, ...(withLive ? [liveFeature] : [])], content: [SOLO_PACK, METER_CONTENT, ...(withLive ? [goalPack()] : [])],
      pc: { ext: { bridge: BRIDGE, scene: { skills: ['nt_aud'], positions: [] } } },
    }).game
    g.launch('scene', { solo: true, mode: 'full', ...(o.audience !== undefined ? { audience: o.audience } : {}) }, { by: 'test' })
    return g
  }
  const act = (g: G, input: SceneInput, env: Rec = {}) => g.commit(sceneAct(g.k, g.state, input, env))
  const talkBlocks = (g: G): string[] => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'talk')!.blocks

  it('單人場景（沒給 audience）上開播：說話從「沒有人在聽。」變成做得了、sceneView 的 audience 是 true；提早收播之後又做不了', () => {
    const g = realScene(true)
    expect(talkBlocks(g)).toEqual(['沒有人在聽。'])
    expect(sceneView(g.k, g.state)!.audience).toBe(false)
    expect(reasonOf(() => sceneAct(g.k, g.state, { kind: 'talk' }))).toBe('沒有人在聽。')
    expect(livePreview(g.k, g.state)).toMatchObject({ ok: true, host: { kind: 'scene' }, template: { id: 'st_adult' } })
    go(g)
    expect(talkBlocks(g)).toEqual([])
    expect(sceneView(g.k, g.state)!.audience).toBe(true)
    // 開場存進狀態的 audience 沒有改
    expect(g.state.ext.scene).toMatchObject({ audience: false })
    act(g, { kind: 'talk', text: '大家好' }, { dice: dice(20) })
    expect(session(g).counts.scene_act).toBe(1)
    cut(g)
    expect(talkBlocks(g)).toEqual(['沒有人在聽。'])
    expect(sceneView(g.k, g.state)!.audience).toBe(false)
    expect(reasonOf(() => sceneAct(g.k, g.state, { kind: 'talk' }))).toBe('沒有人在聽。')
  })

  it('要有人在看的技能（solo: audience）也跟著亮；收播之後又灰', () => {
    const g = realScene(true)
    const skill = (): string[] => sceneOptions(g.k, g.state)!.actions.find((a) => a.id === 'skill')!.choices!.find((c) => c.id === 'nt_aud')!.blocks
    expect(skill()).toEqual(['這個要有人在看。'])
    go(g)
    expect(skill()).toEqual([])
    cut(g)
    expect(skill()).toEqual(['這個要有人在看。'])
  })

  it('直播到場景結束的那一場，scene.end 的 result.audience 是 true；沒開播的是 false；開場給 audience 的不受影響', () => {
    const g = realScene(true)
    go(g)
    act(g, { kind: 'stop' })
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ solo: true, audience: true })
    // 場景結束時直播收掉（結算併在這一份）
    expect(live(g).session).toBeNull()
    expect(live(g).log).toHaveLength(1)
    const end = g.state.reports.find((r) => r.action === 'scene.end')!
    expect(end.changes.some((c) => c.op === 'live.close')).toBe(true)
    const h = realScene(true)
    act(h, { kind: 'stop' })
    expect(heard[0]).toMatchObject({ audience: false })
    const given = realScene(true, { audience: true })
    expect(talkBlocks(given)).toEqual([])
    expect(sceneView(given.k, given.state)!.audience).toBe(true)
  })

  it('沒有裝 live 的局：行為和以前一樣（只看開場給的 audience；問條件之前先看條件有沒有人註冊）', () => {
    const g = realScene(false)
    expect(g.k.conditions.kinds()).not.toContain('live_on')
    expect(talkBlocks(g)).toEqual(['沒有人在聽。'])
    expect(sceneView(g.k, g.state)!.audience).toBe(false)
    const h = realScene(false, { audience: true })
    expect(talkBlocks(h)).toEqual([])
  })

  it('真的場景的每一步算亮點：scene.act +1（單人場景的 end_turn 不算）', () => {
    const g = realScene(true)
    go(g)
    act(g, { kind: 'faster' }, { dice: dice(1, 1) })
    expect(session(g)).toMatchObject({ heat: 1, counts: { scene_act: 1 } })
    act(g, { kind: 'end_turn' })
    expect(session(g).counts.scene_act).toBe(1)
  })
})

// ===================================================================================================================
describe('內容種類與規則表：格式、預設、被資料蓋掉', () => {
  it('預設三筆模板照 MEDIA 1.2 的表；每一筆都通過自己的格式檢查', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.id)).toEqual(['st_combat', 'st_commission', 'st_adult'])
    for (const t of DEFAULT_TEMPLATES) expect(templateProblems(t as unknown as Rec), t.id).toEqual([])
    const g = makeB()
    expect(templateFor(g.k, 'combat')).toMatchObject({ id: 'st_combat', risk: { hostility_mult: 1.5 } })
    expect(templateFor(g.k, 'commission')).toMatchObject({ goals: 'host', blocks: ['stealth_branch'] })
    expect(templateFor(g.k, 'adult')).toMatchObject({ start_heat: 'fame_tier', max_from: { scene_act: 10 } })
  })

  it('資料同 id 整筆蓋掉預設、新的 id 加在後面；格式不對的不收', () => {
    const pack = { id: 't', content: { stream_template: [{ id: 'st_combat', name: '新的戰鬥直播', scope: 'combat', highlights: [{ event: 'crit', heat: 5 }], goals: { pick: [0, 0] } }, { id: 'st_extra', name: '多的', scope: 'combat', highlights: [], goals: 'host' }] } }
    const g = makeB({ content: [pack] })
    expect(templatesOf(g.k).map((t) => t.id)).toEqual(['st_combat', 'st_commission', 'st_adult', 'st_extra'])
    expect(templateFor(g.k, 'combat')!.name).toBe('新的戰鬥直播')
    go(g)
    g.commit(step(crit()))
    expect(session(g).heat).toBe(5)
    expect(() => makeB({ content: [{ id: 'bad', content: { stream_template: [{ id: 'st_x', name: 'x', scope: 'nope', highlights: [], goals: 'host' }] } }] })).toThrow(/scope/)
  })

  it('模板的格式檢查：事件、熱度、max_from、goals、risk、blocks、start_heat', () => {
    const ok = { name: 'x', scope: 'combat', highlights: [{ event: 'crit', heat: 1 }], goals: 'host' }
    expect(templateProblems(ok)).toEqual([])
    const bad = (patch: Rec): string => templateProblems({ ...ok, ...patch }).join('；')
    expect(bad({ name: '' })).toContain('name')
    expect(bad({ highlights: [{ event: 'nope', heat: 1 }] })).toContain('event')
    expect(bad({ highlights: [{ event: 'crit', heat: -1 }] })).toContain('heat')
    expect(bad({ highlights: [{ event: 'crit', heat: 1 }, { event: 'crit', heat: 2 }] })).toContain('重複')
    expect(bad({ max_from: { nope: 1 } })).toContain('nope')
    expect(bad({ max_from: { crit: -2 } })).toContain('max_from.crit')
    expect(bad({ goals: { pick: [3, 1] } })).toContain('goals')
    expect(bad({ goals: undefined })).toContain('goals')
    expect(bad({ risk: { hostility_mult: 0.5 } })).toContain('hostility_mult')
    expect(bad({ blocks: [1] })).toContain('blocks')
    expect(bad({ start_heat: 'x' })).toContain('start_heat')
  })

  it('直播目標的格式檢查（DATA 9.2）：scope、check、heat、tip_per_grade、channel', () => {
    const ok = { text: '一句話。', scope: ['combat'], check: { event: 'crit', count_min: 1 } }
    expect(goalProblems(ok)).toEqual([])
    expect(goalProblems({ ...ok, check: { event: 'ally_down', count_max: 0 } })).toEqual([])
    const bad = (patch: Rec): string => goalProblems({ ...ok, ...patch }).join('；')
    expect(bad({ text: '' })).toContain('text')
    expect(bad({ scope: [] })).toContain('scope')
    expect(bad({ scope: ['x'] })).toContain('scope')
    expect(bad({ check: { event: 'x', count_min: 1 } })).toContain('check.event')
    expect(bad({ check: { event: 'crit' } })).toContain('至少一個')
    expect(bad({ check: { event: 'crit', count_min: 3, count_max: 1 } })).toContain('不能大於')
    expect(bad({ heat: 1.5 })).toContain('heat')
    expect(bad({ tip_per_grade: -1 })).toContain('tip_per_grade')
    expect(bad({ channel: 'x' })).toContain('channel')
    expect(() => makeB({ goals: [{ id: 'g_bad', text: '', scope: ['combat'], check: { event: 'crit', count_min: 1 } }] })).toThrow(/text/)
  })

  it('規則表：預設值照設計書；資料蓋掉單一欄位、其餘留預設；格式不對擋下', () => {
    expect(DEFAULT_LIVE_RULES).toMatchObject({ goal_heat: 3, heat_subs: 6, heat_tips: 8, views_div: 400, adult_cap: 10, consent: 60, tiers: [1.5, 2.5], viewers: { base_pct: 5, base_min: 20, per_heat: 0.1, heat_cap: 20 } })
    expect(ruleProblems({})).toEqual([])
    expect(ruleProblems({ heat_subs: -1 }).join('')).toContain('heat_subs')
    expect(ruleProblems({ viewers: 3 }).join('')).toContain('viewers')
    expect(ruleProblems({ viewers: { base_pct: 500 } }).join('')).toContain('viewers.base_pct')
    expect(ruleProblems({ tiers: [3, 2] }).join('')).toContain('tiers')
    const g = makeB({ goals: [], content: [{ id: 'r', content: { live_rule: [{ id: 'default', heat_subs: 10, heat_tips: 20, consent: 40 }] } }] })
    expect(liveRules(g.k)).toMatchObject({ heat_subs: 10, heat_tips: 20, consent: 40, goal_heat: 3, views_div: 400 })
    go(g)
    g.commit(step(crit(), crit()))
    cut(g)
    expect(live(g).log[0]).toMatchObject({ heat: 2, subs: 20, tips: 40 })
  })

  it('事件的名字是封閉清單（十種）', () => {
    expect([...LIVE_EVENTS]).toEqual(['crit', 'overload_foe', 'foe_down', 'ally_down', 'battle_won', 'battle_lost', 'stage_done', 'branch', 'scene_act', 'scene_end'])
  })
})

// ===================================================================================================================
describe('唯讀的畫面：liveView', () => {
  it('沒在直播：on 是 false、log 是最近幾場；直播中：模板、宿主、熱度、觀看數與級距、目標與現在的達成、亮點、風險', () => {
    const g = makeB({ goals: [GOALS[0]!, GOALS[1]!], templates: [{ ...ONE_PICK, goals: { pick: [2, 2] } }], subs: 10000 })
    expect(liveView(g.k, g.state)).toEqual({ on: false, session: null, log: [] })
    go(g)
    g.commit(step(crit(), crit()))
    const v = liveView(g.k, g.state)
    expect(v.on).toBe(true)
    expect(v.session).toMatchObject({
      id: 'lv1', mode: 'activity', template: { id: 'st_combat', name: '戰鬥直播' }, host: { kind: 'battle', name: '戰鬥' }, heat: 2, tips: 16,
      viewers: { count: 600, base: 500, tier: 'cold', tier_name: '冷清' }, risk: ['敵人也在看：直播期間，勢力的敵對值增加變成原來的 1.5 倍。'],
    })
    expect(v.session!.goals.map((x) => [x.id, x.met, x.settled])).toEqual([['g_two_crits', true, true], ['g_no_one_down', true, false]])
    expect(v.session!.highlights.map((h) => h.name)).toEqual(['打出要害', '打出要害'])
    // 收播的話：兩條目標照現在的次數算（最多幾次的不算）→ 熱度 2 + 3
    expect(v.session!.projection).toMatchObject({ heat: 5 })
    cut(g)
    expect(liveView(g.k, g.state).log.map((e) => e.id)).toEqual(['lv1'])
  })

  it('唯讀：livePreview、liveView、viewersOf 不改狀態', () => {
    const g = liveB()
    const before = JSON.stringify(g.state)
    livePreview(g.k, g.state)
    liveView(g.k, g.state)
    viewersOf(g.k, g.state)
    expect(JSON.stringify(g.state)).toBe(before)
  })
})

// ===================================================================================================================
describe('一般守則', () => {
  const FILES = ((): Record<string, string> => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/features/live')
    return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
  })()
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

  it('原始碼只 import 核心與自己的檔案；不讀別的功能的 state.ext；不用 Math.random、Date、run.say、Vue', () => {
    for (const [f, src] of Object.entries(FILES)) {
      const c = code(src)
      for (const m of c.matchAll(/from\s+'([^']+)'/g)) expect(m[1]!.startsWith('./') || m[1] === '../../core', `${f}：${m[1]}`).toBe(true)
      expect(c, f).not.toMatch(/Math\.random|Date\.now|new Date|\brun\.say\(|state\.ext\.(?!live\b)[a-z]/)
    }
    // 只讀自己的 ext.live（readLive／ext[EXT]）：沒有別的鍵
    expect(Object.values(FILES).join('\n')).not.toMatch(/ext\??\.\[?'(?!live)/)
  })

  it('沒有註冊任何效果（B022 的清單不動）、沒有街頭信譽（rep）的變更', () => {
    expect(code(Object.values(FILES).join('\n'))).not.toMatch(/effects\.register|op: 'rep'|kind: 'rep'/)
    const g = liveB()
    g.commit(step(crit()))
    cut(g)
    for (const r of g.state.reports) expect(r.changes.some((c) => c.op === 'meter' && c.kind === 'rep')).toBe(false)
  })

  it('新註冊的條件寫了 describe；內容種類三個都註冊了（兩個規則表 overridable、目標不是）', () => {
    const g = makeB()
    expect(g.k.conditions.explain({ kind: 'live_on' } as never, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe('要正在直播')
    expect(g.k.content.isOverridable('live_rule')).toBe(true)
    expect(g.k.content.isOverridable('stream_template')).toBe(true)
    expect(g.k.content.hasKind('stream_goal')).toBe(true)
    expect(g.k.content.isOverridable('stream_goal')).toBe(false)
  })

  it('裝完整的功能清單：新局開得起來、沒有宿主時 livePreview 的原因對、live 登記在活動的清單裡（order 40，在 scene 與 auction 之間）', () => {
    const g = new Game({ features: allFeatures(), strict: true })
    g.newGame({ seed: 3 })
    expect(livePreview(g.k, g.state)).toMatchObject({ ok: false, host: null })
    expect(readLive(g.state)).toEqual({ session: null, seq: 0, log: [] })
    const kinds = g.k.activity.list().map((d) => d.kind)
    expect(kinds.indexOf('live')).toBeGreaterThan(kinds.indexOf('scene'))
    expect(kinds.indexOf('live')).toBeLessThan(kinds.indexOf('commission'))
    expect(g.k.activity.get('live')).toMatchObject({ order: 40, deny: ['undo'] })
  })

  it('存檔裡 ext.live 壞掉的部分當成空的（不丟例外）', () => {
    const g = makeB()
    g.state.ext.live = { session: { id: 3 }, seq: 'x', log: [1, { id: 'a' }] }
    expect(readLive(g.state)).toEqual({ session: null, seq: 0, log: [] })
    g.state.ext.live = 5
    expect(readLive(g.state).session).toBeNull()
  })

  it('同一個種子、同一串輸入：整場逐位元組相同', async () => {
    const run = async (): Promise<string> => {
      const g = liveB({ seed: 5 })
      playOut(g, 800)
      await g.finishBattle()
      return JSON.stringify({ reports: g.state.reports.map((r) => r.changes), live: g.state.ext.live, subs: subs(g), cred: cred(g) })
    }
    expect(await run()).toBe(await run())
  })
})
