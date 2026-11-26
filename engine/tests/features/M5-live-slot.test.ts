// 驗收測試：dev/work/M5-live-slot.md（cpp-feature）。時段直播：四種（閒聊、才藝、逛街、成人）、表演檢定、live_mid、效果 heat 與 highlight、自訂輸入的欄位。
// 規格：MEDIA 1.3 節（全部）、1.2 節的觀看數與收播換算、4.6 節（設備）；EVENTS 3.1 節（live_mid）、3.3 節、4.11 節、2.4 節（heat、highlight）；dev/adr/0020 第三節、V25、V27、V28、D2、D9；dev/work/M5-live.md「新的格式與鍵」。
// 測試用 testkit 的量表替身（訂閱、人氣、豔名）、替身的頻道（條件 channel_open、聽 activity.end）與 media.record、玩具的 aired 效果與玩具的活動；
// 直播事件那一組用真的導演（範圍 live 是這份測試自帶的，event_scopes.json 還沒有那一列）。內容一律用測試自帶的最小假資料。
// 骰面：開播那一擲從存檔種子導出，測試從報告的那一拍讀實際的骰面與成功程度，再對照預覽算出來的總熱度（不釘死某一顆骰）。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Kernel, Report, ReportDraft } from '../../src'
import { ActionBlocked, Game, effectCtx, meterOf, toMinutes } from '../../src'
import { CORE_PACK } from '../../data'
import { allFeatures } from '../../src/features'
import { chooseOption, directorFeature, eventRunFeature } from '../../src/features/director'
import {
  DEFAULT_SLOT, DEFAULT_LIVE_RULES, SLOT_ALLOW, SLOT_BLOCK_REASON, SLOT_DIRECTIONS, SLOT_KINDS, SLOT_TAGS, cutLive, liveFeature, liveRules, liveView, readLive, slotChances, slotDc,
  slotEnd, slotEndBlock, slotOptions, slotPreview, slotStart, directionMods,
} from '../../src/features/live'
import type { LiveSession, SlotInput } from '../../src/features/live'
import { ruleProblems } from '../../src/features/live/model'
import { BATTLE_SETUPS, METER_CONTENT, TEST_COMBAT, makeGame, meterFeature, playOut, testMeter } from '../../src/testkit'

type Rec = Record<string, any>
type G = ReturnType<typeof make>

// ===================================================================================================================
// 替身與假資料
// ===================================================================================================================

/** 替身：頻道（條件 channel_open 看旗標 channel_on；聽 activity.end 的 live，記成 ext.stub_ends）。 */
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

/** 替身：aired 效果（真的在 channel；這裡只記有幾次）。 */
const AIRED_STUB: Feature = {
  id: 'aired_stub',
  install(k: Kernel) {
    k.changes.register<Change>({ op: 'stub.aired', owner: 'aired_stub', validate: () => [], apply: (s) => { s.ext.stub_aired = Number(s.ext.stub_aired ?? 0) + 1 } })
    k.effects.register({ kind: 'aired', owner: 'aired_stub', ai: false, validate: () => [], toChanges: () => [{ op: 'stub.aired' }], describe: () => '這一週開過直播。' })
  },
}

/** 替身：設備的衍生數值（頻道定義的 stream_gear_bonus；值放在 ext.toy_gear）。 */
const GEAR_STUB: Feature = {
  id: 'gear_stub',
  install(k: Kernel) {
    k.stats.defineStat({ id: 'stream_gear_bonus', owner: 'gear_stub', name: '直播的設備加值', min: 0, max: 9, base: (s) => Number(s.ext.toy_gear ?? 0) })
  },
}

/** 區的內容種類（豔名的效果查區的 id 用；真的在 world）與一個區 test。 */
const DISTRICT_KIND: Feature = { id: 'district_kind', install(k: Kernel) { k.content.defineKind({ kind: 'district', owner: 'district_kind', validate: () => [] }) } }
const DISTRICT: ContentPack = { id: 'district_pack', content: { district: [{ id: 'test', name: '測試區', grade: 1 }] } as never }

/** 玩具的活動：旗標 toy_act 在就是進行中（只放行 test. 開頭的）。 */
const TOY_ACT: Feature = {
  id: 'toy_act',
  install(k: Kernel) {
    k.activity.define({ kind: 'toy', owner: 'toy_act', order: 60, active: (s) => (s.flags.toy_act === true ? { id: 't1', label: '玩具活動' } : null), allow: ['commit:test.'], reason: () => '玩具活動進行中，先把它做完。' })
  },
}

const SCOPE = { id: 'live', triggers: { live_mid: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }
type Fx = Record<string, unknown>
const notice = (id: string, effects: Fx[], extra: Fx = {}): Fx => ({ id, scope: 'live', triggers: ['live_mid'], blocking: false, text: '彈幕刷了一排。', effects, ...extra })
const opt = (id: string, text: string, outcomes: Fx[], extra: Fx = {}): Fx => ({ id, text, outcomes: { any: outcomes }, ...extra })
const blocking = (id: string, options: Fx[], extra: Fx = {}): Fx => ({ id, scope: 'live', triggers: ['live_mid'], text: '有人鬧場。', options, ...extra })

interface Opts {
  channel?: boolean
  media?: boolean
  popularity?: boolean
  subs?: number
  pop?: number
  fame?: number
  gear?: number
  seed?: number
  skills?: Record<string, number>
  flags?: Record<string, boolean>
  rules?: Partial<GameState['rules']>
  content?: ContentPack[]
  events?: Fx[]
  features?: Feature[]
  location?: GameState['location']
  aired?: boolean
}

/** 一局沒有戰鬥的遊戲：真的導演與事件視窗（範圍 live 自帶）、替身的頻道與 media、訂閱、人氣、豔名量表。 */
function make(o: Opts = {}) {
  const meters: GameState['meters'] = {}
  if (o.channel !== false) meters.subs = { _: o.subs ?? 1000 }
  if (o.pop !== undefined) meters.popularity = { pc: o.pop }
  if (o.fame !== undefined) meters.fame = { test: o.fame }
  const g = makeGame({
    features: [
      TEST_COMBAT, directorFeature, eventRunFeature,
      DISTRICT_KIND,
      meterFeature(
        ...(o.channel === false ? [] : [testMeter({ kind: 'subs', owner: 'ch_toy', name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' })]),
        testMeter({ kind: 'fame', owner: 'lewd_toy', name: '豔名', keyed: 'district' }),
        ...(o.popularity === false ? [] : [testMeter({ kind: 'popularity', owner: 'idol_toy', name: '人氣', keyed: 'npc' })]),
      ),
      ...(o.channel === false ? [] : [CHANNEL_STUB]), ...(o.media === false ? [] : [MEDIA_STUB]), ...(o.aired === false ? [] : [AIRED_STUB]), GEAR_STUB, TOY_ACT,
      liveFeature, ...(o.features ?? []),
    ],
    content: [METER_CONTENT, DISTRICT, { id: 'slot_pack', content: { event_scope: [SCOPE], event: o.events ?? [] } as unknown as ContentPack['content'] }, ...(o.content ?? [])],
    seed: o.seed ?? 11, pc: { skills: o.skills ?? { perform: 2, negotiate: 3, streetwise: 1, seduce: 2 } },
    patch: { flags: { channel_on: o.channel !== false, ...o.flags }, meters, ...(o.rules ? { rules: o.rules as GameState['rules'] } : {}), ...(o.location ? { location: o.location } : {}) },
  }).game
  if (o.gear !== undefined) g.state.ext.toy_gear = o.gear
  return g
}

const live = (g: G) => readLive(g.state)
const session = (g: G): LiveSession => live(g).session!
const subs = (g: G): number => meterOf(g.k, g.state, 'subs')
const cred = (g: G): number => g.state.money.cred
const stubRec = (g: G): Rec[] => (g.state.ext.stub_rec as Rec[] | undefined) ?? []
const stubEnds = (g: G): Rec[] => (g.state.ext.stub_ends as Rec[] | undefined) ?? []
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.reason; throw e }
  return ''
}
const now = (g: G): number => toMinutes(g.state.time)
const START: SlotInput = { kind: 'chat', hours: 2 }
const start = (g: G, input: SlotInput = START): Report => g.commit(slotStart(g.k, g.state, input))[0]!
const end = (g: G): Report[] => g.commit(slotEnd(g.k, g.state))
const beat = (r: Report, tag: string): Rec => r.timeline.find((b) => b.tag === tag)!.data as Rec
const rep = (action: string, o: Partial<ReportDraft> = {}): ReportDraft => ({ kind: 'event', action, location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試。' }, ...o })
const resolve = (g: G, effects: unknown[], source: 'ai' | 'builtin' | 'player' = 'builtin') => g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source }))
const withLive = (o: Opts = {}, input: SlotInput = START): { g: G; r: Report } => {
  const g = make(o)
  return { g, r: start(g, input) }
}

// ===================================================================================================================
describe('四種：基本功、起始熱度', () => {
  it('四種的基本功與起始熱度用哪一種逐條對（人氣 45、訂閱 12,000 → 人氣級 2 ＋ 位數 1；成人種類豔名 65 → 2）', () => {
    const g = make({ subs: 12000, pop: 45, fame: 65 })
    const o = Object.fromEntries(slotOptions(g.k, g.state).map((x) => [x.id, x]))
    expect(Object.keys(o)).toEqual(['chat', 'talent', 'stroll', 'adult'])
    expect(o.chat).toMatchObject({ name: '閒聊', skills: ['perform', 'negotiate'], start_from: 'pop', start_heat: 3, can: true })
    expect(o.talent).toMatchObject({ name: '才藝', skills: ['perform'], start_from: 'pop', start_heat: 3, can: true })
    expect(o.stroll).toMatchObject({ name: '逛街', skills: ['streetwise', 'perform'], start_from: 'pop', start_heat: 3, street: true })
    expect(o.adult).toMatchObject({ name: '成人', skills: ['seduce'], start_from: 'fame', start_heat: 2, can: true })
    const p = slotPreview(g.k, g.state, { kind: 'chat', hours: 1 })
    expect(p.start).toEqual({ value: 3, parts: [{ label: '人氣級', value: 2 }, { label: '訂閱的位數', value: 1 }] })
    expect(slotPreview(g.k, g.state, { kind: 'adult', hours: 1 }).start).toEqual({ value: 2, parts: [{ label: '這一區的豔名級', value: 2 }] })
  })

  it('訂閱的位數：一千 0、一萬 1、十萬 2、不到一千也是 0；人氣級無條件捨去（19 是 0、20 是 1）；沒有人定義人氣是 0；豔名每 30 點一級（29 是 0）', () => {
    const startOf = (o: Opts, kind = 'chat'): number => slotPreview(make(o).k, make(o).state, { kind, hours: 1 }).start!.value
    for (const [n, want] of [[0, 0], [999, 0], [1000, 0], [9999, 0], [10000, 1], [99999, 1], [100000, 2], [2_000_000, 3]] as const) expect(startOf({ subs: n, pop: 0 }), `訂閱 ${n}`).toBe(want)
    expect(startOf({ subs: 500, pop: 19 })).toBe(0)
    expect(startOf({ subs: 500, pop: 20 })).toBe(1)
    expect(startOf({ subs: 500, pop: 100 })).toBe(5)
    expect(startOf({ subs: 12000, popularity: false })).toBe(1)
    expect(startOf({ fame: 29 }, 'adult')).toBe(0)
    expect(startOf({ fame: 30 }, 'adult')).toBe(1)
    expect(startOf({ fame: 90, subs: 100000 }, 'adult')).toBe(3)
  })

  it('檢定用那一種基本功裡較高的一項：閒聊在表演 2 與交涉 3 之間取交涉；才藝只看表演；成人看誘惑', () => {
    const g = make()
    const part = (kind: string): { skill: string; value: number } => {
      const p = slotPreview(g.k, g.state, { kind, hours: 1 })
      return { skill: p.roll!.skill, value: p.roll!.parts.find((x) => x.source === 'skill')!.value }
    }
    expect(part('chat')).toEqual({ skill: 'negotiate', value: 3 })
    expect(part('talent')).toEqual({ skill: 'perform', value: 2 })
    expect(part('stroll')).toEqual({ skill: 'perform', value: 2 })
    expect(part('adult')).toEqual({ skill: 'seduce', value: 2 })
    const lowNeg = make({ skills: { perform: 4, negotiate: 1 } })
    expect(slotPreview(lowNeg.k, lowNeg.state, START).roll!.skill).toBe('perform')
  })
})

// ===================================================================================================================
describe('難度、結果換熱度、時長、上限、方向', () => {
  it('難度四段：不到 1,000 是 10、1,000 起 13、一萬起 16、十萬起 19（邊界）；難度設定的偏移照加', () => {
    for (const [n, want] of [[0, 10], [999, 10], [1000, 13], [9999, 13], [10000, 16], [99999, 16], [100000, 19], [5_000_000, 19]] as const) {
      const g = make({ subs: n })
      expect(slotPreview(g.k, g.state, START).roll!.dc, `訂閱 ${n}`).toBe(want)
      expect(slotOptions(g.k, g.state)[0]!.dc).toBe(want)
      expect(slotDc(DEFAULT_SLOT, n)).toBe(want)
    }
    const hard = make({ subs: 1000, rules: { dcOffset: 2 } as never })
    const p = slotPreview(hard.k, hard.state, START)
    expect(p.roll!.dc).toBe(15)
    expect(p.roll!.dc_parts.map((x) => x.value)).toEqual([13, 2])
  })

  it('四種結果換的熱度：冷場 0、失敗 1、成功 3、大成功 6；加起始與（時長 − 1）：1 小時 +0、2 小時 +1、3 小時 +2', () => {
    const g = make({ subs: 500, pop: 0 })
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 1 }).heat).toEqual({ fumble: 0, fail: 1, success: 3, critical: 6 })
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 2 }).heat).toEqual({ fumble: 1, fail: 2, success: 4, critical: 7 })
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 3 }).heat).toEqual({ fumble: 2, fail: 3, success: 5, critical: 8 })
    const rich = make({ subs: 12000, pop: 45 })
    expect(slotPreview(rich.k, rich.state, { kind: 'chat', hours: 3 }).heat).toEqual({ fumble: 5, fail: 6, success: 8, critical: 11 })
  })

  it('總數超過 12 夾在 12（起始 7、3 小時、大成功：7 + 6 + 2 = 15 → 12）；最低 0', () => {
    const g = make({ subs: 100000, pop: 100 })
    const p = slotPreview(g.k, g.state, { kind: 'chat', hours: 3 })
    expect(p.start!.value).toBe(7)
    expect(p.heat).toEqual({ fumble: 9, fail: 10, success: 12, critical: 12 })
    expect(p.cap).toBe(12)
  })

  it('穩著播：檢定 +1、熱度不超過 6；搏出位：檢定 −1、成功與大成功時熱度再 +1（冷場與失敗不加）；冷門題材：起始熱度 −1（最少 0）', () => {
    const g = make({ subs: 12000, pop: 45 })
    const base = slotPreview(g.k, g.state, { kind: 'chat', hours: 2 })
    expect(base.roll!.bonus).toBe(base.roll!.bonus)
    const steady = slotPreview(g.k, g.state, { kind: 'chat', hours: 2, plan: { direction: 'steady' } })
    expect(steady.roll!.bonus).toBe(base.roll!.bonus + 1)
    expect(steady.cap).toBe(6)
    expect(steady.heat).toEqual({ fumble: 4, fail: 5, success: 6, critical: 6 })
    const bold = slotPreview(g.k, g.state, { kind: 'chat', hours: 2, plan: { direction: 'bold' } })
    expect(bold.roll!.bonus).toBe(base.roll!.bonus - 1)
    expect(bold.heat).toEqual({ fumble: base.heat!.fumble, fail: base.heat!.fail, success: base.heat!.success + 1, critical: base.heat!.critical + 1 })
    const niche = slotPreview(g.k, g.state, { kind: 'chat', hours: 2, plan: { direction: 'niche' } })
    expect(niche.start!.value).toBe(base.start!.value - 1)
    expect(niche.roll!.bonus).toBe(base.roll!.bonus)
    expect(niche.heat!.success).toBe(base.heat!.success - 1)
    const zero = make({ subs: 500, pop: 0 })
    expect(slotPreview(zero.k, zero.state, { kind: 'chat', hours: 1, plan: { direction: 'niche' } }).start!.value).toBe(0)
  })

  it('自訂的修正最多 ±2 檢定、±1 熱度：規則表被寫大了也夾住', () => {
    const big = { ...DEFAULT_SLOT, steady: { check: 9, cap: 6 }, bold: { check: -9, success_heat: 5 }, niche: { start: -7, subs_mult: 1.2 } }
    expect(directionMods(big, 'steady').check).toBe(2)
    expect(directionMods(big, 'bold')).toMatchObject({ check: -2, success_heat: 1 })
    expect(directionMods(big, 'niche').start).toBe(-1)
    expect(directionMods(DEFAULT_SLOT, undefined)).toEqual({ check: 0, success_heat: 0, start: 0, cap: 12, subs_mult: 1 })
  })

  it('預覽的機率加起來 100（每一種難度與加值）；機率和實際的成功程度同一套（自然 20 一定大成功、自然 1 一定冷場）', () => {
    for (const subs of [0, 1000, 10000, 100000]) {
      const g = make({ subs })
      for (const kind of SLOT_KINDS) {
        const p = slotPreview(g.k, g.state, { kind, hours: 1 })
        const sum = Object.values(p.chance!).reduce((a, b) => a + b, 0)
        expect(sum, `${kind}/${subs}`).toBe(100)
      }
    }
    expect(slotChances(100, 10)).toEqual({ fumble: 5, fail: 0, success: 0, critical: 95 })
    expect(slotChances(-100, 30)).toEqual({ fumble: 95, fail: 0, success: 0, critical: 5 })
  })

  it('設備：衍生數值 stream_gear_bonus 最多 +3（頻道定義；沒有人定義就是 0）', () => {
    const none = make({ features: [] })
    const noStat = makeGame({ features: [meterFeature(testMeter({ kind: 'subs', owner: 'c', name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' })), liveFeature], content: [METER_CONTENT] }).game
    expect(slotPreview(noStat.k, noStat.state, START).roll!.gear).toBe(0)
    expect(slotPreview(none.k, none.state, START).roll!.gear).toBe(0)
    const g2 = make({ gear: 2 })
    const base = slotPreview(make().k, make().state, START).roll!.bonus
    expect(slotPreview(g2.k, g2.state, START).roll!.gear).toBe(2)
    expect(slotPreview(g2.k, g2.state, START).roll!.bonus).toBe(base + 2)
    const g9 = make({ gear: 9 })
    expect(slotPreview(g9.k, g9.state, START).roll!.gear).toBe(3)
    expect(slotPreview(g9.k, g9.state, START).roll!.parts.find((p) => p.label === '設備')!.value).toBe(3)
  })

  it('規則表可以被資料蓋掉：難度、結果換的熱度、上限、種類的基本功；格式不對的欄位被擋、載入時忽略', () => {
    const rules: ContentPack = { id: 'r', content: { live_rule: [{ id: 'default', slot: { cap: 8, gain: { success: 4 }, dc: [{ subs: 0, dc: 8 }, { subs: 50, dc: 11 }], kinds: { chat: { skills: ['negotiate'] } } } }] } as never }
    const g = make({ content: [rules], subs: 60, pop: 0 })
    const slot = liveRules(g.k).slot
    expect(slot.cap).toBe(8)
    expect(slot.gain).toEqual({ fumble: 0, fail: 1, success: 4, critical: 6 })
    expect(slotPreview(g.k, g.state, START).roll!.dc).toBe(11)
    expect(slotPreview(g.k, g.state, START).roll!.skill).toBe('negotiate')
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 3 }).cap).toBe(8)
    expect(ruleProblems({ id: 'default', slot: { cap: 'x', dc: [{ subs: 5, dc: 10 }], kinds: { vlog: {} } } })).toEqual(expect.arrayContaining([
      expect.stringContaining('slot.cap'), expect.stringContaining('slot.dc'), expect.stringContaining('vlog'),
    ]))
    expect(ruleProblems({ id: 'default' })).toEqual([])
    expect(liveRules(make().k).slot).toEqual(DEFAULT_LIVE_RULES.slot)
  })
})

// ===================================================================================================================
describe('自訂輸入：plan 與 text', () => {
  it('標籤七種、方向三種：清單的名字', () => {
    expect([...SLOT_TAGS]).toEqual(['funny', 'gentle', 'provoke', 'tech', 'nostalgia', 'edge', 'late'])
    expect([...SLOT_DIRECTIONS]).toEqual(['steady', 'bold', 'niche'])
  })

  it('plan 給了清單以外的標籤、三個標籤、清單以外的方向都被擋，原因的句子對；兩個標籤與清單內的方向過', () => {
    const g = make()
    const bad = (plan: unknown): string => slotPreview(g.k, g.state, { ...START, plan: plan as never }).blocks.join('')
    expect(bad({ tags: ['spicy'] })).toBe('「spicy」不是標籤清單裡的（可以選：搞笑、溫柔、挑釁、技術、懷舊、擦邊、深夜）。')
    expect(bad({ tags: ['funny', 'gentle', 'tech'] })).toBe('標籤最多選 2 個，你選了 3 個。')
    expect(bad({ direction: 'yolo' })).toBe('「yolo」不是表演方向的清單裡的（可以選：穩著播、搏出位、冷門題材）。')
    expect(bad({ tags: 'funny' })).toBe('標籤要是清單裡的名字（一個一個列出來）。')
    expect(bad('x')).toBe('自訂的標籤與方向要寫成 { tags, direction } 的樣子。')
    const reports = g.state.reports.length
    expect(reasonOf(() => slotStart(g.k, g.state, { ...START, plan: { tags: ['a', 'b', 'c'] } }))).toContain('不是標籤清單裡的')
    expect(g.state.reports.length).toBe(reports)
    expect(bad({ tags: ['funny', 'late'], direction: 'bold' })).toBe('')
    expect(bad({ tags: ['funny', 'funny'] })).toBe('')
  })

  it('沒給 plan 是預設：不加不減、沒有標籤、沒有方向；session 記下 plan', () => {
    const g = make()
    const a = slotPreview(g.k, g.state, START)
    expect(a.roll!.parts.some((p) => p.label.startsWith('方向'))).toBe(false)
    expect(a.tags).toEqual([])
    expect(a.direction).toBeUndefined()
    start(g)
    expect(session(g).plan).toEqual({ tags: [] })
    const h = make()
    start(h, { ...START, plan: { tags: ['funny', 'edge'], direction: 'bold' } })
    expect(session(h).plan).toEqual({ tags: ['funny', 'edge'], direction: 'bold' })
  })

  it('標籤不直接給熱度、不改檢定：同一個種子、有無標籤，骰面與熱度相同', () => {
    const a = start(make(), START)
    const b = start(make(), { ...START, plan: { tags: ['funny', 'provoke'] } })
    expect(beat(b, 'live.start').heat).toBe(beat(a, 'live.start').heat)
    expect(b.timeline[0]!.roll!.natural).toBe(a.timeline[0]!.roll!.natural)
  })

  it('text 原樣放進 live.start 報告的 input（不 trim、不篩選），不影響任何數字：同一個種子有無 text 結果相同', () => {
    const text = '  在天台彈吉他、順便吐槽樓下的店 \n'
    const a = withLive({}, START)
    const b = withLive({}, { ...START, text })
    expect(b.r.input).toBe(text)
    expect(a.r.input).toBeUndefined()
    expect(JSON.stringify(b.g.state.ext.live)).toBe(JSON.stringify(a.g.state.ext.live))
    expect(b.r.timeline[0]!.roll).toEqual(a.r.timeline[0]!.roll)
    expect(now(b.g)).toBe(now(a.g))
    end(a.g)
    end(b.g)
    expect(subs(b.g)).toBe(subs(a.g))
    expect(cred(b.g)).toBe(cred(a.g))
  })

  it('text 上限照「字」截斷（一個字是一個字，不是 UTF-16 的單位），截斷時有提醒；沒超過的不動', () => {
    const rules: ContentPack = { id: 'r', content: { live_rule: [{ id: 'default', slot: { text_max: 5 } }] } as never }
    const g = make({ content: [rules] })
    const r = start(g, { ...START, text: '😀😀😀😀😀😀😀' })
    expect(r.input).toBe('😀😀😀😀😀')
    expect(r.clamps).toMatchObject([{ path: 'input', from: 7, to: 5 }])
    const h = make({ content: [rules] })
    const r2 = start(h, { ...START, text: '一二三四五' })
    expect(r2.input).toBe('一二三四五')
    expect(r2.clamps).toBeUndefined()
  })
})

// ===================================================================================================================
describe('能不能開', () => {
  it('頻道要開著（有人註冊才問）：沒開頻道原因對；沒裝頻道的局照樣開', () => {
    const closed = make({ flags: {} })
    closed.state.flags.channel_on = false
    expect(slotPreview(closed.k, closed.state, START).blocks).toEqual(['還沒有開頻道，不能直播。'])
    expect(slotOptions(closed.k, closed.state).every((o) => !o.can && o.why === '還沒有開頻道，不能直播。')).toBe(true)
    const none = make({ channel: false })
    expect(none.k.conditions.kinds()).not.toContain('channel_open')
    expect(slotPreview(none.k, none.state, START).ok).toBe(true)
    start(none)
    end(none)
    expect(readLive(none.state).log.length).toBe(1)
  })

  it('逛街要站在城市的街區地圖上：不在格子地圖上、在網內的地圖上都開不了；街區地圖上開得了；其餘三種不看地圖', () => {
    const MAP = (id: string, kind: string): Rec => ({ id, kind, size: [5, 3], sheets: [{ id: 's', name: '街', size: [5, 3], layout: ['#####', 'E...E', '#####'], cells: [{ id: 'E1', at: [0, 1], mark: 'E', name: '西口' }, { id: 'E2', at: [4, 1], mark: 'E', name: '東口' }] }] })
    const maps = { id: 'maps', content: { special_map: [MAP('m_street', 'block'), MAP('m_net', 'subnet')] } as never }
    const at = (def: string): GameState['maps'] => ({ instances: { m1: { id: 'm1', def, sheets: {} } }, at: { map: 'm1', sheet: 's', x: 1, y: 1 }, seq: 1 } as never)
    const g = make({ content: [maps] })
    const why = '逛街直播要在城市的街區上：你現在不在街區地圖上。'
    const stroll = (): { can: boolean; why: string | null } => slotOptions(g.k, g.state).find((o) => o.id === 'stroll')!
    expect(stroll()).toMatchObject({ can: false, why })
    expect(reasonOf(() => slotStart(g.k, g.state, { kind: 'stroll', hours: 1 }))).toBe(why)
    g.state.maps = at('m_net')
    expect(stroll().why).toBe(why)
    g.state.maps = at('m_street')
    expect(stroll()).toMatchObject({ can: true, why: null })
    start(g, { kind: 'stroll', hours: 1 })
    expect(session(g).kind).toBe('stroll')
    const h = make()
    expect(slotOptions(h.k, h.state).filter((o) => o.can).map((o) => o.id)).toEqual(['chat', 'talent', 'adult'])
  })

  it('所在的地方有 no_rec（設施的種類、街區、區）開不了：四種都不行', () => {
    const kinds: Feature = { id: 'kinds', install(k: Kernel) { k.content.defineKind({ kind: 'facility_type', owner: 'kinds', validate: () => [] }) } }
    const pack: ContentPack = { id: 'norec', content: { facility_type: [{ id: 'fac_nocam', name: '禁拍的店', no_rec: true }] } as never }
    const g = make({ features: [kinds], content: [pack], location: { district: 'test', block: 'empty_room', facility: 'fac_nocam' } })
    expect(slotPreview(g.k, g.state, START).blocks).toEqual(['這裡不准錄影，開不了直播。'])
    expect(slotOptions(g.k, g.state).every((o) => !o.can && o.why === '這裡不准錄影，開不了直播。')).toBe(true)
    expect(reasonOf(() => slotStart(g.k, g.state, START))).toBe('這裡不准錄影，開不了直播。')
  })

  it('任何一個活動進行中（用玩具活動）開不了，原因是那個活動的句子；不是 live 自己放行的就一律擋', () => {
    const g = make({ flags: { toy_act: true } })
    expect(slotPreview(g.k, g.state, START).blocks).toEqual(['玩具活動進行中，先把它做完。'])
    expect(slotOptions(g.k, g.state).every((o) => o.why === '玩具活動進行中，先把它做完。')).toBe(true)
    expect(reasonOf(() => slotStart(g.k, g.state, START))).toBe('玩具活動進行中，先把它做完。')
    const b = makeGame({ features: [TEST_COMBAT, meterFeature(testMeter({ kind: 'subs', owner: 'c', name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' })), liveFeature], content: [METER_CONTENT] }).game
    b.startBattle(BATTLE_SETUPS.encounter())
    expect(slotPreview(b.k, b.state, START).ok).toBe(false)
    expect(slotPreview(b.k, b.state, START).blocks[0]).toBe(b.k.activity.get('battle')!.reason(b.state, 'commit:live.start'))
  })

  it('已經在直播：再開、再收的原因對；沒在直播收不了', () => {
    const g = make()
    expect(reasonOf(() => slotEnd(g.k, g.state))).toBe('現在沒有在直播。')
    start(g)
    expect(slotPreview(g.k, g.state, START).blocks).toEqual(['已經在直播了：先收播。'])
    expect(reasonOf(() => slotStart(g.k, g.state, START))).toBe('已經在直播了：先收播。')
  })

  it('沒有主角、種類不對、時長不是 1～3：各一條原因，接在一起', () => {
    const none = makeGame({ features: [liveFeature], content: [METER_CONTENT], pc: false }).game
    expect(slotPreview(none.k, none.state, START).blocks[0]).toBe('還沒有主角，不能直播。')
    const g = make()
    expect(slotPreview(g.k, g.state, { kind: 'vlog', hours: 4 }).blocks).toEqual(['沒有「vlog」這種時段直播（可以選：閒聊、才藝、逛街、成人）。', '時段直播要播 1、2 或 3 個小時。'])
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 0 }).ok).toBe(false)
    expect(slotPreview(g.k, g.state, { kind: 'chat', hours: 1.5 }).ok).toBe(false)
  })

  it('成人種類預設不受任何內容篩選開關影響；規則表給它 tags: [intimate_body] 再關掉那個標籤時不列、直接開被擋；打開時照列', () => {
    const plain = make({ rules: { contentOff: ['intimate_body', 'pc_unwilling', 'ntr'] } as never })
    expect(slotOptions(plain.k, plain.state).map((o) => o.id)).toEqual(['chat', 'talent', 'stroll', 'adult'])
    expect(slotOptions(plain.k, plain.state).find((o) => o.id === 'adult')!.can).toBe(true)
    const tagged: ContentPack = { id: 'tag', content: { live_rule: [{ id: 'default', slot: { kinds: { adult: { tags: ['intimate_body'] } } } }] } as never }
    const off = make({ content: [tagged], rules: { contentOff: ['intimate_body'] } as never })
    expect(slotOptions(off.k, off.state).map((o) => o.id)).toEqual(['chat', 'talent', 'stroll'])
    expect(reasonOf(() => slotStart(off.k, off.state, { kind: 'adult', hours: 1 }))).toBe('成人直播的題材被你在內容篩選關掉了。')
    expect(slotPreview(off.k, off.state, START).ok).toBe(true)
    const on = make({ content: [tagged] })
    expect(slotOptions(on.k, on.state).map((o) => o.id)).toEqual(['chat', 'talent', 'stroll', 'adult'])
    start(on, { kind: 'adult', hours: 1 })
    end(on)
    expect(stubRec(on)[0]!.hint.tags).toEqual(['intimate_body'])
  })

  it('不是行動種類：actions.json 與行動的登錄表裡沒有 stream_daily', () => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../data/rules')
    const text = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    expect(text).not.toContain('stream_daily')
    const g = new Game({ features: allFeatures(), content: [CORE_PACK], strict: true })
    g.newGame({ seed: 3 })
    const ids = g.k.actions.list().map((a) => a.id)
    expect(ids.length).toBeGreaterThan(5)
    expect(ids).not.toContain('stream_daily')
    expect(ids.some((id) => id.startsWith('live') || id.includes('slot'))).toBe(false)
  })
})

// ===================================================================================================================
describe('live.start：擲檢定、推進一半的時間、帶 live_mid', () => {
  it('報告：action live.start、kind broadcast、一拍 live.start（帶擲骰）；session 寫進狀態（mode slot、kind、hours、plan、roll、cap、half_done）', () => {
    const { g, r } = withLive({ subs: 12000, pop: 45 }, { kind: 'chat', hours: 3, plan: { tags: ['late'] } })
    expect(r).toMatchObject({ action: 'live.start', kind: 'broadcast' })
    expect(r.timeline.map((b) => b.tag)).toEqual(['live.start'])
    const roll = r.timeline[0]!.roll!
    expect(roll.dc).toBe(16)
    expect(roll.parts.some((p) => p.source === 'skill')).toBe(true)
    const s = session(g)
    expect(s).toMatchObject({ id: 'lv1', mode: 'slot', template: 'slot', kind: 'chat', hours: 3, plan: { tags: ['late'] }, cap: 12, half_done: true, by: 'pc' })
    expect(s.roll).toMatchObject({ natural: roll.natural, total: roll.total, dc: 16, degree: roll.degree })
    expect(s.heat).toBe(slotPreview(make({ subs: 12000, pop: 45 }).k, make({ subs: 12000, pop: 45 }).state, { kind: 'chat', hours: 3 }).heat![roll.degree as 'fail'])
    expect(s.tips).toBe(s.heat * 8)
    expect(s.goals).toEqual([])
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['live'])
    expect(liveView(g.k, g.state).session).toMatchObject({ mode: 'slot', template: { name: '閒聊時段直播' }, slot: { kind: 'chat', kind_name: '閒聊', hours: 3, cap: 12, direction: null } })
  })

  it('熱度 = 預覽算的（起始 ＋ 結果 ＋ 時長 − 1 ＋ 方向，夾上限）：多個種子、四種、三種方向都對', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const direction of [undefined, 'steady', 'bold', 'niche'] as const) {
        for (const hours of [1, 3]) {
          const g = make({ seed, subs: 12000, pop: 45 })
          const input: SlotInput = { kind: 'talent', hours, ...(direction ? { plan: { direction } } : {}) }
          const want = slotPreview(g.k, g.state, input).heat!
          const r = start(g, input)
          expect(session(g).heat, `${seed}/${direction}/${hours}`).toBe(want[r.timeline[0]!.roll!.degree as 'fail'])
          expect(session(g).heat).toBeLessThanOrEqual(direction === 'steady' ? 6 : 12)
        }
      }
    }
  })

  it('時間推進時長的一半（1 小時 30 分、2 小時 60 分、3 小時 90 分），帶觸發點 live_mid（where 帶種類、標籤、區、設施的種類）', () => {
    for (const [hours, half] of [[1, 30], [2, 60], [3, 90]] as const) {
      const g = make({ location: { district: 'test', block: 'empty_room', facility: 'fac_x' } })
      const t0 = now(g)
      const r = start(g, { kind: 'talent', hours, plan: { tags: ['tech', 'nostalgia'] } })
      expect(now(g) - t0).toBe(half)
      expect(r.triggers).toEqual([{ point: 'live_mid', where: { kind: 'talent', tags: ['tech', 'nostalgia'], district: 'test', facility: 'fac_x' } }])
      expect(beat(r, 'live.start')).toMatchObject({ minutes: half })
    }
    const plain = make()
    expect(start(plain).triggers).toEqual([{ point: 'live_mid', where: { kind: 'chat', tags: [], district: 'test' } }])
  })

  it('這時走路、休息、開一集都被擋，原因是「直播中，先收播才能做別的事。」；直播自己的報告與事件視窗放行', () => {
    const { g } = withLive()
    expect(SLOT_BLOCK_REASON).toBe('直播中，先收播才能做別的事。')
    for (const doing of ['commit:world.walk', 'commit:rest.short', 'commit:channel.episode', 'commit:trade.checkout', 'grid.move']) expect(g.k.activity.blockOf(g.state, doing), doing).toBe('直播中，先收播才能做別的事。')
    for (const doing of ['commit:live.end', 'commit:live.start', ...SLOT_ALLOW]) expect(g.k.activity.blockOf(g.state, doing), doing).toBeNull()
    expect(() => g.commit(rep('world.walk'))).toThrow(ActionBlocked)
    expect(reasonOf(() => g.commit(rep('rest.short')))).toBe('直播中，先收播才能做別的事。')
  })

  it('直播中不能回退（deny undo）；時段直播不能用「提早收播」（要照時段的流程）', () => {
    const { g } = withLive()
    expect(g.undoBlock()).toBe('直播進行中，不能回退。要先收播。')
    expect(reasonOf(() => cutLive(g.k, g.state))).toBe('時段直播要照時段的流程收播。')
  })

  it('每一次擲骰從存檔種子導出：同一個種子同一個結果；不同的種子骰面不全相同；游標往前 1', () => {
    const a = start(make({ seed: 5 }))
    const b = start(make({ seed: 5 }))
    expect(b.timeline[0]!.roll).toEqual(a.timeline[0]!.roll)
    const naturals = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => start(make({ seed })).timeline[0]!.roll!.natural))
    expect(naturals.size).toBeGreaterThan(1)
    const g = make({ seed: 5 })
    const before = g.state.rng.cursor
    start(g)
    expect(g.state.rng.cursor).toBe(before + 1)
  })
})

// ===================================================================================================================
describe('live.end：收播', () => {
  it('收播之後時間過完（1、2、3 小時）、session 清掉、log 記一筆；報告 live.end 有一拍 tag live.end', () => {
    for (const hours of [1, 2, 3]) {
      const g = make()
      const t0 = now(g)
      start(g, { kind: 'chat', hours })
      const [r] = end(g)
      expect(now(g) - t0).toBe(hours * 60)
      expect(r).toMatchObject({ action: 'live.end', kind: 'broadcast' })
      expect(r!.timeline.map((b) => b.tag)).toEqual(['live.end'])
      expect(beat(r!, 'live.end')).toMatchObject({ id: 'lv1', mode: 'slot', kind: 'chat', hours, goals: [] })
      expect(live(g)).toMatchObject({ session: null, seq: 1 })
      expect(live(g).log[0]).toMatchObject({ id: 'lv1', mode: 'slot', template: 'slot' })
      expect(g.k.activity.active(g.state)).toEqual([])
      expect(g.k.activity.blockOf(g.state, 'commit:world.walk')).toBeNull()
    }
  })

  it('訂閱與打賞對式子（V25）：訂閱 = 熱度 × 6 ＋ floor(觀看數 ÷ 400)、打賞 = 熱度 × 8；觀看數 = floor(基本盤 ×（1 ＋ 0.1 × 熱度）)', () => {
    const g = make({ subs: 20000, pop: 0 })
    const s0 = subs(g)
    const c0 = cred(g)
    start(g, { kind: 'chat', hours: 3 })
    const heat = session(g).heat
    const viewers = Math.floor(1000 * (1 + 0.1 * heat) + 1e-9)
    const [r] = end(g)
    expect(subs(g) - s0).toBe(heat * 6 + Math.floor(viewers / 400))
    expect(cred(g) - c0).toBe(heat * 8)
    expect(beat(r!, 'live.end')).toMatchObject({ heat, viewers, subs: heat * 6 + Math.floor(viewers / 400), tips: heat * 8 })
    expect(live(g).log[0]).toMatchObject({ heat, subs: heat * 6 + Math.floor(viewers / 400), tips: heat * 8, viewers })
  })

  it('冷門題材（niche）：訂閱 ×1.2（打賞不變）', () => {
    const run = (direction?: string): { heat: number; subs: number; tips: number } => {
      const g = make({ subs: 20000, seed: 7 })
      const s0 = subs(g)
      const c0 = cred(g)
      start(g, { kind: 'chat', hours: 3, ...(direction ? { plan: { direction } } : {}) })
      const heat = session(g).heat
      end(g)
      return { heat, subs: subs(g) - s0, tips: cred(g) - c0 }
    }
    const niche = run('niche')
    const viewers = Math.floor(1000 * (1 + 0.1 * niche.heat) + 1e-9)
    expect(niche.subs).toBe(Math.floor((niche.heat * 6 + Math.floor(viewers / 400)) * 1.2 + 1e-9))
    expect(niche.tips).toBe(niche.heat * 8)
  })

  it('media.record 一次（來源 live、ref 是這一場；高品質與直播的記號；類型成人種類親密、其餘日常）；activity.end 種類 live 一次（mode slot、kind、hours）', () => {
    for (const [kind, type] of [['chat', 'daily'], ['talent', 'daily'], ['adult', 'intimate']] as const) {
      const g = make({ fame: 30 })
      start(g, { kind, hours: 2 })
      end(g)
      expect(stubRec(g)).toHaveLength(1)
      expect(stubRec(g)[0]).toMatchObject({ source: { kind: 'live', ref: 'lv1' }, hint: { live: true, hq: true, type } })
      expect(stubRec(g)[0]!.hint.lost).toBeUndefined()
      expect(stubEnds(g)).toHaveLength(1)
      expect(stubEnds(g)[0]).toMatchObject({ id: 'lv1', mode: 'slot', kind, hours: 2, to_channel: true })
    }
    const nomedia = make({ media: false })
    start(nomedia)
    end(nomedia)
    expect(stubRec(nomedia)).toEqual([])
    expect(live(nomedia).log[0]!.record).toBeUndefined()
  })

  it('週內算開過：aired 有人註冊時發一次；沒有人註冊就略過；頻道自己聽 activity.end 記這一週時不再發（不重複算）', () => {
    const g = make()
    start(g)
    end(g)
    expect(g.state.ext.stub_aired).toBe(1)
    const none = make({ aired: false })
    start(none)
    end(none)
    expect(none.state.ext.stub_aired).toBeUndefined()
    // 頻道（owner 是 channel）聽 activity.end 時，aired 不再發
    const listens: Feature = { id: 'x', install(k: Kernel) { k.hooks.on('activity.end', 'channel', () => undefined) } }
    const withChannel = make({ features: [listens] })
    start(withChannel)
    end(withChannel)
    expect(withChannel.state.ext.stub_aired).toBeUndefined()
  })

  it('成人種類：這一區的豔名 +1（其餘三種不加）', () => {
    for (const [kind, plus] of [['chat', 0], ['talent', 0], ['adult', 1]] as const) {
      const g = make({ fame: 10 })
      start(g, { kind, hours: 1 })
      end(g)
      expect(meterOf(g.k, g.state, 'fame'), kind).toBe(10 + plus)
    }
  })

  it('沒有頻道（訂閱量表沒人定義）只有打賞；沒有人氣量表照樣開；收播的報告句子不帶機制數字', () => {
    const g = make({ channel: false, popularity: false })
    start(g, { kind: 'chat', hours: 2 })
    const [r] = end(g)
    expect(beat(r!, 'live.end').subs).toBe(0)
    expect(cred(g)).toBeGreaterThan(0)
    for (const line of r!.narration?.results ?? []) expect(line).not.toMatch(/\d/)
    const s = start(make(), START)
    for (const line of s.narration?.results ?? []) expect(line).not.toMatch(/\d/)
  })

  it('沒有事件視窗開著時才做得了：事件視窗開著收播被擋（原因是事件視窗自己的句子）；回應之後做得了', () => {
    const ev = blocking('ev_heckle', [opt('o1', '順勢吐槽。', [{ kind: 'heat', amount: 3 }]), opt('o2', '切斷畫面。', [{ kind: 'heat', amount: -2 }])])
    const g = make({ events: [ev] })
    start(g)
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['event', 'live'])
    const block = slotEndBlock(g.k, g.state)
    expect(block).toBe(g.k.activity.get('event')!.reason(g.state, 'commit:live.end'))
    expect(reasonOf(() => slotEnd(g.k, g.state))).toBe(block)
    g.commit(chooseOption(g.k, g.state, 'o1'))
    expect(slotEndBlock(g.k, g.state)).toBeNull()
    end(g)
    expect(live(g).session).toBeNull()
  })
})

// ===================================================================================================================
describe('效果 heat 與 highlight', () => {
  it('事件給熱度 +3：熱度加上去、不超過上限（低的加滿 3，高的夾在 12）；事件在 live_mid 由導演抽', () => {
    const lo = make({ events: [notice('ev_up', [{ kind: 'heat', amount: 3 }])], subs: 500, pop: 0 })
    const r = start(lo, { kind: 'chat', hours: 1 })
    const h0 = beat(r, 'live.start').heat as number
    expect(session(lo).heat).toBe(h0 + 3)
    expect(lo.state.reports.map((x) => x.action).slice(-2)).toEqual(['live.start', 'event.notice'])
    const hi = make({ events: [notice('ev_up', [{ kind: 'heat', amount: 3 }])], subs: 100000, pop: 100 })
    const r2 = start(hi, { kind: 'chat', hours: 3 })
    const h1 = beat(r2, 'live.start').heat as number
    expect(h1).toBeGreaterThanOrEqual(9)
    expect(session(hi).heat).toBe(Math.min(12, h1 + 3))
    expect(session(hi).tips).toBe(session(hi).heat * 8)
    const steady = make({ events: [notice('ev_up', [{ kind: 'heat', amount: 3 }])], subs: 12000, pop: 45 })
    const r3 = start(steady, { kind: 'chat', hours: 3, plan: { direction: 'steady' } })
    expect(session(steady).heat).toBe(Math.min(6, (beat(r3, 'live.start').heat as number) + 3))
  })

  it('事件的負熱度往下扣，最低 0；收播照最後的熱度結算', () => {
    const g = make({ events: [notice('ev_down', [{ kind: 'heat', amount: -3 }])], subs: 500, pop: 0, seed: 3 })
    const r = start(g, { kind: 'chat', hours: 1 })
    const h0 = beat(r, 'live.start').heat as number
    expect(session(g).heat).toBe(Math.max(0, h0 - 3))
    const c0 = cred(g)
    end(g)
    expect(cred(g) - c0).toBe(Math.max(0, h0 - 3) * 8)
  })

  it('直播沒開的時候給 heat 整筆拿掉並有提醒（內建與 AI 一樣）；highlight 也是', () => {
    const g = make()
    for (const source of ['builtin', 'ai'] as const) {
      const r = resolve(g, [{ kind: 'heat', amount: 3 }], source)
      expect(r.errors).toEqual([])
      expect(r.changes).toEqual([])
      expect(r.clamps[0]).toMatchObject({ from: 3, to: 0, notice: '現在沒有在播時段直播，這一筆熱度沒有算。' })
    }
    const h = resolve(g, [{ kind: 'highlight' }])
    expect(h.changes).toEqual([])
    expect(h.clamps[0]!.notice).toBe('現在沒有在直播，這一筆亮點沒有算。')
  })

  it('AI 的來源給 +9 夾到 +3（有提醒）；−9 夾到 −3；內建的照寫的算、最後夾在這一場的上限', () => {
    const g = make({ subs: 500, pop: 0, seed: 3 })
    start(g, { kind: 'chat', hours: 1 })
    const h0 = session(g).heat
    const ai = resolve(g, [{ kind: 'heat', amount: 9 }], 'ai')
    expect(ai.errors).toEqual([])
    expect(ai.changes).toEqual([{ op: 'live.heat', delta: 3 }])
    expect(ai.clamps[0]).toMatchObject({ from: 9, to: 3 })
    expect(resolve(g, [{ kind: 'heat', amount: -9 }], 'ai').changes).toEqual([{ op: 'live.heat', delta: -Math.min(3, h0) }].filter((c) => c.delta !== 0))
    const split = resolve(g, [{ kind: 'heat', amount: 2 }, { kind: 'heat', amount: 2 }], 'ai')
    expect(split.changes.map((c) => (c as Rec).delta)).toEqual([2, 1])
    const builtin = resolve(g, [{ kind: 'heat', amount: 9 }])
    expect(builtin.changes).toEqual([{ op: 'live.heat', delta: Math.min(9, 12 - h0) }])
    g.commit(rep('event.test', { changes: ai.changes }))
    expect(session(g).heat).toBe(h0 + 3)
  })

  it('格式：amount 要是不為 0 的整數；highlight 的 amount 要是 1～3；不認得的欄位被擋；兩個效果都給 AI 用（B022 的清單不動）', () => {
    const g = make()
    expect(resolve(g, [{ kind: 'heat', amount: 0 }]).errors.join()).toContain('amount')
    expect(resolve(g, [{ kind: 'heat', amount: 1.5 }]).errors.join()).toContain('amount')
    expect(resolve(g, [{ kind: 'heat' }]).errors.join()).toContain('amount')
    expect(resolve(g, [{ kind: 'heat', amount: 1, extra: 1 }]).errors.join()).toContain('extra')
    expect(resolve(g, [{ kind: 'highlight', amount: 4 }]).errors.join()).toContain('1～3')
    expect(resolve(g, [{ kind: 'highlight', amount: 0 }]).errors.join()).toContain('1～3')
    expect(g.k.effects.aiKinds()).toEqual(expect.arrayContaining(['heat', 'highlight']))
  })

  it('highlight：時段直播熱度 +1（預設）～+3、夾在上限；活動直播也收（沒有上限）；記進亮點清單', () => {
    const g = make({ subs: 500, pop: 0, seed: 3 })
    start(g, { kind: 'chat', hours: 1 })
    const h0 = session(g).heat
    g.commit(rep('event.test', { changes: resolve(g, [{ kind: 'highlight' }, { kind: 'highlight', amount: 3 }]).changes }))
    expect(session(g).heat).toBe(Math.min(12, h0 + 4))
    expect(session(g).counts.highlight).toBe(h0 + 4 <= 12 ? 2 : 2)
    expect(liveView(g.k, g.state).session!.highlights.every((h) => h.name === '亮點')).toBe(true)
    // 到頂之後整筆拿掉並提醒
    g.commit(rep('event.test', { changes: [{ op: 'live.heat', delta: 99 }] }))
    expect(session(g).heat).toBe(12)
    const full = resolve(g, [{ kind: 'highlight' }])
    expect(full.changes).toEqual([])
    expect(full.clamps[0]!.notice).toBe('這一場的熱度已經到上限了，多的沒有算。')
    // 活動直播：沒有上限，也收
    const a = make()
    a.state.ext.live = { session: { id: 'lv1', mode: 'activity', template: 'st_combat', host: { kind: 'battle', id: 'b1' }, by: 'pc', where: {}, heat: 14, goals: [], highlights: [], counts: {}, from: {}, tips: 0 }, seq: 1, log: [] }
    expect(resolve(a, [{ kind: 'highlight', amount: 2 }]).changes).toEqual([{ op: 'live.heat', delta: 2, highlight: true }])
    expect(resolve(a, [{ kind: 'heat', amount: 2 }]).changes).toEqual([])
    a.commit(rep('event.test', { changes: [{ op: 'live.heat', delta: 2, highlight: true }] }))
    expect(session(a).heat).toBe(16)
  })

  it('live.heat 變更：沒有這一場不收、delta 要是不為 0 的整數；時段直播夾在 0～上限', () => {
    const g = make()
    expect(() => g.commit(rep('event.test', { changes: [{ op: 'live.heat', delta: 1 }] }))).toThrow()
    start(g)
    expect(() => g.commit(rep('event.test', { changes: [{ op: 'live.heat', delta: 0 }] }))).toThrow()
    expect(() => g.commit(rep('event.test', { changes: [{ op: 'live.heat', delta: 1.5 }] }))).toThrow()
    g.commit(rep('event.test', { changes: [{ op: 'live.heat', delta: -99 }] }))
    expect(session(g).heat).toBe(0)
    expect(session(g).tips).toBe(0)
  })

  it('同一個 kernel 裝著 curtain（量表 stage_heat）與這個功能：效果 heat 註冊得起來、不撞名；兩個名字各自存在', () => {
    const g = new Game({ features: allFeatures(), strict: true })
    g.newGame({ seed: 3 })
    expect(g.k.effects.has('heat')).toBe(true)
    expect(g.k.effects.has('highlight')).toBe(true)
    expect(g.k.effects.has('stage_heat')).toBe(true)
    expect(g.k.meters.has('stage_heat')).toBe(true)
    expect(g.k.meters.has('heat')).toBe(false)
  })
})

// ===================================================================================================================
describe('直播事件：選項開一場戰鬥', () => {
  const weakFoe = (): Rec => {
    const f = BATTLE_SETUPS.encounter().foes[0] as unknown as Rec
    return { ...f, unit: { ...f.unit, hp: { now: 3, max: 3 } } }
  }
  it('選項開戰鬥（玩具事件）：直播中打得了、打完回到直播、收播照常（訂閱、打賞、紀錄、activity.end 各一次）', async () => {
    const ev = blocking('ev_fight', [opt('fight', '動手。', [{ kind: 'fight', foes: [weakFoe()], cover: 'sparse', faction: 'f_alpha' }]), opt('walk', '走開。', [])])
    // 一個只剩幾點生命的敵人（玩具的戰鬥怎麼打不是這一張要驗的）；找一個打得贏的種子
    let g: G | null = null
    for (let seed = 1; seed <= 40 && !g; seed++) {
      const t = make({ events: [ev], seed })
      start(t, { kind: 'chat', hours: 2 })
      expect(t.k.activity.active(t.state).map((a) => a.kind)).toEqual(['event', 'live'])
      t.commit(chooseOption(t.k, t.state, 'fight'))
      expect(t.battle).not.toBeNull()
      // 戰鬥中直播還在、不能收播、戰鬥自己的行動放行
      expect(t.k.activity.active(t.state).map((a) => a.kind)).toContain('live')
      expect(slotEndBlock(t.k, t.state)).not.toBeNull()
      expect(t.k.activity.blockOf(t.state, 'battle.next')).toBeNull()
      const out = playOut(t).outcome
      if (out === 'win') g = t
    }
    expect(g, '四十個種子裡至少要有一個打得贏').not.toBeNull()
    await g!.finishBattle()
    expect(g!.battle).toBeNull()
    expect(session(g!)).toMatchObject({ mode: 'slot', kind: 'chat' })
    expect(g!.k.activity.active(g!.state).map((a) => a.kind)).toEqual(['live'])
    expect(slotEndBlock(g!.k, g!.state)).toBeNull()
    const c0 = cred(g!)
    const heat = session(g!).heat
    const t0 = now(g!)
    end(g!)
    expect(now(g!) - t0).toBe(60)
    expect(cred(g!) - c0).toBe(heat * 8)
    expect(stubRec(g!)).toHaveLength(1)
    expect(stubEnds(g!)).toHaveLength(1)
    expect(live(g!).session).toBeNull()
  })
})

// ===================================================================================================================
describe('回到快照、存檔、一般守則', () => {
  it('回到快照時還在播的那一場當場收：訂閱與打賞照結算、紀錄標戰敗的畫面、activity.end 發一次；之後沒有進行中的直播', () => {
    const g = make({ subs: 20000, pop: 0 })
    g.commit(rep('test.snap', { changes: [{ op: 'snapshot.take', kind: 'entry', label: '之前', owner: 'x' }] }))
    start(g, { kind: 'chat', hours: 2 })
    const heat = session(g).heat
    g.commit(rep('event.retreat', { rewind: { kind: 'entry', summary: '回到之前。', fresh: true } }))
    expect(live(g).session).toBeNull()
    expect(live(g).log[0]).toMatchObject({ id: 'lv1', mode: 'slot', heat, lost: true })
    expect(cred(g)).toBe(heat * 8)
    expect(stubRec(g)).toHaveLength(1)
    expect(stubRec(g)[0]!.hint.lost).toBe(true)
    expect(stubEnds(g)).toHaveLength(1)
    expect(g.k.activity.active(g.state)).toEqual([])
  })

  it('存檔裡的時段直播欄位壞掉的部分當沒有（不丟例外）；整份格式不對的 session 當成沒有在直播', () => {
    const g = make()
    start(g)
    const raw = JSON.parse(JSON.stringify(g.state.ext.live)) as Rec
    g.state.ext.live = { ...raw, session: { ...raw.session, kind: 'vlog', hours: 'x', plan: 7, roll: { natural: 'a' }, cap: -1, half_done: 'yes' } }
    expect(readLive(g.state).session).toMatchObject({ id: 'lv1', mode: 'slot' })
    expect(readLive(g.state).session!.kind).toBeUndefined()
    expect(readLive(g.state).session!.plan).toBeUndefined()
    g.state.ext.live = { ...raw, session: { ...raw.session, mode: 'party' } }
    expect(readLive(g.state).session).toBeNull()
  })

  it('同一個種子、同一串輸入：整場逐位元組相同；預覽與選項是純函式（不改狀態）', () => {
    const run = (): string => {
      const g = make({ seed: 9, subs: 12000, pop: 45, events: [notice('ev_up', [{ kind: 'heat', amount: 2 }])] })
      const before = JSON.stringify(g.state)
      slotOptions(g.k, g.state)
      slotPreview(g.k, g.state, START)
      expect(JSON.stringify(g.state)).toBe(before)
      start(g, { kind: 'talent', hours: 3, plan: { tags: ['funny'], direction: 'bold' }, text: '彈吉他' })
      end(g)
      return JSON.stringify({ reports: g.state.reports.map((r) => r.changes), live: g.state.ext.live, subs: subs(g), cred: cred(g) })
    }
    expect(run()).toBe(run())
  })

  it('同一個種子 3 小時到 12：每一場的熱度都在 0～上限、收播之後狀態通過整份狀態檢查', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const g = make({ seed, subs: 100000, pop: 100, events: [notice('ev_up', [{ kind: 'heat', amount: 3 }])] })
      start(g, { kind: 'chat', hours: 3, plan: seed % 2 ? { direction: 'bold' } : {} })
      expect(session(g).heat).toBeGreaterThanOrEqual(0)
      expect(session(g).heat).toBeLessThanOrEqual(12)
      end(g)
      expect(live(g).session).toBeNull()
    }
  })

  it('全部功能裝起來：新局開得起來、有主角時 slotOptions 列四種、live 的放行清單不影響別的活動', () => {
    const g = new Game({ features: allFeatures(), strict: true })
    g.newGame({ seed: 3 })
    expect(slotOptions(g.k, g.state)).toHaveLength(4)
    expect(slotPreview(g.k, g.state, START).ok).toBe(false)
    expect(g.k.activity.get('live')).toMatchObject({ order: 40, deny: ['undo'] })
    // 頻道（owner channel）聽 activity.end 就記這一週開過：收播不再另外發 aired
    expect((g.k.hooks.owners as unknown as (n: string) => string[]).call(g.k.hooks, 'activity.end')).toContain('channel')
  })

  const FILES = ((): Record<string, string> => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/features/live')
    return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
  })()
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

  it('原始碼只 import 核心與自己的檔案；不讀別的功能的 state.ext；不用 Math.random、Date、run.say；沒有街頭信譽的變更', () => {
    for (const [f, src] of Object.entries(FILES)) {
      const c = code(src)
      for (const m of c.matchAll(/from\s+'([^']+)'/g)) expect(m[1]!.startsWith('./') || m[1] === '../../core', `${f}：${m[1]}`).toBe(true)
      expect(c, f).not.toMatch(/Math\.random|Date\.now|new Date|\brun\.say\(|state\.ext\.(?!live\b)[a-z]|op: 'rep'|kind: 'rep'/)
    }
  })

  it('新註冊的效果只有 heat 與 highlight，都在 slotfx.ts；沒有新的條件', () => {
    const regs = Object.entries(FILES).flatMap(([f, src]) => [...code(src).matchAll(/effects\.register<?[^(]*\(\{\s*kind:\s*([A-Z_a-z']+)/g)].map((m) => `${f}:${m[1]}`))
    expect(regs).toEqual(['slotfx.ts:HEAT_EFFECT', 'slotfx.ts:HIGHLIGHT_EFFECT'])
  })

  it('這個檔的型別：SlotInput 的 text 與 plan 都是選填', () => {
    const a: SlotInput = { kind: 'chat', hours: 1 }
    const b: SlotInput = { kind: 'chat', hours: 1, text: '', plan: {} }
    expect(a.text).toBeUndefined()
    expect(b.plan).toEqual({})
    void ({} as Change)
  })
})
