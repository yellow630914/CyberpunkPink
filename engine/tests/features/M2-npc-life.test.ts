// 驗收測試：dev/work/M2-npc-life.md（cpp-feature）。規格：NPC_SYSTEM 3.2 節、第 8 節（8.1～8.3）、第 9 節；SERIES 第 6 節（回退時保留記憶）；dev/adr/0016 第六節（time.passed 的順序）。
// 內容一律用測試自帶的最小假資料：兩個區（d_a、d_b）、兩個勢力（f_x 的對頭是 f_y）、幾位固定 NPC（行者安、窮的鮑勃、卡爾、一位職員）與每區名單的規則。
// 區、路數是別的功能的內容種類，測試用替身（STUBS）定義；敵對值是 security 的量表，測試用 testkit 的 meterFeature 替身。
// 機率一律用內容 npc_life_rule 蓋掉成 0 或 1，這樣「擲了幾次」「出了什麼事」不靠運氣；其餘用固定種子。

import { describe, expect, it } from 'vitest'
import type { Actor, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, ContentError, effectCtx, fromMinutes, toMinutes } from '../../src'
import { directorFeature, eventRunFeature } from '../../src/features/director'
import {
  DEFAULT_LIFE_RULES, NEWS_MAX, PROTECT_FLAG, compactMemories, editMemory, forgetMemory, lifeDraft, lifeRules, lifeSubjects, memoriesOf, meetNpc, newsOf, npcOf, npcsFeature, pinMemory,
  readNpcs, recall, remember, watchNpc, whereIs,
} from '../../src/features/npcs'
import type { Memory } from '../../src/features/npcs'
import { join, rosterFeature } from '../../src/features/roster'
import { makeActor, makeGame, meterFeature, observed, testMeter } from '../../src/testkit'

// ---- 替身與假資料 ----

const STUBS: Feature = {
  id: 'test_stubs',
  install(k: Kernel) {
    for (const kind of ['district', 'block', 'path']) k.content.defineKind({ kind, owner: 'test', validate: () => [] })
  },
}
const HOSTILITY = meterFeature(testMeter({ kind: 'hostility', name: '敵對值', keyed: 'faction' }))

type Rec = Record<string, unknown>
type Content = Record<string, Rec[]>

const ANN = {
  id: 'npc_ann', name: '安', kind: 'runner', age: 30, gender: 'female', faction: 'f_x', guard: 15, wealth: 3,
  home: { district: 'd_a' }, haunts: [{ district: 'd_a' }, { district: 'd_b' }],
  bridge: { sensitivity: 40, tolerance: 30, craving: 20, docility: 10 }, sink: 40,
  paths: [{ path: 'p_gun', slot: 'main', tier: 2 }], attrs: { body: 12 }, skills: {},
}
const BOB = { id: 'npc_bob', name: '鮑勃', kind: 'citizen', age: 41, guard: 13, wealth: 0, home: { district: 'd_a' }, haunts: [{ district: 'd_a' }] }
const CARL = { id: 'npc_carl', name: '卡爾', kind: 'citizen', age: 35, wealth: 3, home: { district: 'd_a' }, haunts: [{ district: 'd_a' }] }
const CLERK = { id: 'npc_clerk', name: '職員', kind: 'staff', age: 38, home: { district: 'd_a' }, haunts: [{ district: 'd_a' }] }

const baseContent = (): Content => structuredClone({
  faction: [{ id: 'f_x', name: '甲幫', short: '甲', class: 'street', rivals: ['f_y'] }, { id: 'f_y', name: '乙幫', short: '乙', class: 'street' }],
  district: [{ id: 'd_a', name: '甲區', grade: 1 }, { id: 'd_b', name: '乙區', grade: 1 }],
  block: [],
  path: [{ id: 'p_gun', name: '槍手' }],
  name_pool: [{ id: 'np', family: ['陸', '周', '王', '李', '張', '林', '黃', '吳'], given: ['守仁', '曉雯', '志明', '小芬', '大偉', '佳怡', '建國', '淑惠', '俊傑', '雅婷'] }],
  npc_gen: [
    { id: 'ng_a', district: 'd_a', citizens: 2, runners: 1, occupations: [['攤販', 1]], factions: [['none', 1]], names: ['np'] },
    { id: 'ng_b', district: 'd_b', citizens: 2, runners: 0, occupations: [['社畜', 1]], factions: [['none', 1]], names: ['np'] },
  ],
  npc: [ANN, BOB, CARL, CLERK],
}) as Content

/** 把機率全關掉，只留下要測的；over 照 npc_life_rule 的形狀深層蓋上去。 */
const QUIET = {
  life: { job: { chance: 0, promote_chance: 0 }, injured: { chance: 0 }, arrest: { base: 0, per: 0 }, debt: { chance: 0 }, sink: { chance: 0 }, implant: { chance: 0 } },
  roster: { chance: 0 },
}
const deep = (a: Rec, b: Rec): Rec => {
  const out: Rec = { ...a }
  for (const [key, v] of Object.entries(b)) out[key] = v && typeof v === 'object' && !Array.isArray(v) && a[key] && typeof a[key] === 'object' && !Array.isArray(a[key]) ? deep(a[key] as Rec, v as Rec) : v
  return out
}
const rule = (over: Rec = {}): Rec => ({ id: 'default', ...deep(QUIET, over) })

interface Opts {
  seed?: number
  features?: Feature[]
  rule?: Rec | null
  content?: (c: Content) => void
  actors?: Actor[]
  patch?: Partial<GameState>
}
const make = (o: Opts = {}) => {
  const c = baseContent()
  if (o.rule !== null) c.npc_life_rule = [rule(o.rule ?? {})]
  o.content?.(c)
  const pack: ContentPack = { id: 'life_test', content: c as unknown as ContentPack['content'] }
  return makeGame({
    features: o.features ?? [STUBS, HOSTILITY, npcsFeature], content: [pack], seed: o.seed ?? 7, actors: o.actors ?? [],
    patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' }, ...(o.patch ?? {}) },
  }).game
}
type G = ReturnType<typeof make>

const DAY = 1440
const draft = (changes: ReportDraft['changes'], action = 'test.step', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'action', action, location: { district: 'd_a' }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試' }, ...extra,
})
const advance = (g: G, minutes: number) => g.commit(draft([{ op: 'time', minutes }], 'test.wait'))
const days = (g: G, n: number) => advance(g, n * DAY)
const go = (g: G, district: string) => g.commit(draft([{ op: 'location', to: { district } }], 'test.go'))
const give = (g: G, effects: Rec[]) => {
  const r = g.k.effects.resolve(effects, effectCtx(g.k, g.state, { source: 'builtin' }))
  if (r.errors.length) throw new Error(r.errors.join('；'))
  if (r.changes.length) g.commit(draft(r.changes, 'test.give'))
  return r
}
/** 親近到會被擲日子（親密度 30 以上）。 */
const befriend = (g: G, id: string, amount = 40) => {
  g.commit(meetNpc(g.k, g.state, id))
  give(g, [{ kind: 'affinity', key: id, amount }])
}
const watch = (g: G, id: string) => {
  g.commit(meetNpc(g.k, g.state, id))
  g.commit(watchNpc(g.k, g.state, id))
}
const ROLL = { degree: 'success', natural: 12, parts: [], total: 15, dc: 12, verdict: 'yes', margin: 3, dice: '1d20' } as never
const checked = (degree: 'critical' | 'success' | 'fail' | 'fumble' = 'success') => [{ layer: 'meat' as const, text: '你試了一下。', roll: { ...(ROLL as object), degree } as never }]
const memories = (g: G): Memory[] => memoriesOf(g.state)
const actor = (g: G, id: string): Actor => g.state.actors[id]!
const cond = (g: G, id: string, c: string) => actor(g, id).conditions.find((x) => x.id === c)
const at = (day: number, hour = 8, minute = 0) => ({ day, hour, minute })
const lifeReports = (g: G) => g.state.reports.filter((r) => r.action === 'npc.life')
const reasonOf = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ActionBlocked)
    return (e as ActionBlocked).reason
  }
  throw new Error('應該被擋下，卻成立了')
}

// ---- 共同記憶：記 ----

describe('共同記憶：照 8.1 節那張表記（不經過 AI、不多出一份報告）', () => {
  it('一份有檢定的 action 報告記一筆重要程度 1；大成功記 2；大失敗也是 2；簡述用報告的摘要', () => {
    const g = make()
    const before = g.state.reports.length
    g.commit(draft([], 'free', { timeline: checked('success'), outcome: { result: 'success', summary: '你撬開了門。' } }))
    expect(memories(g)).toHaveLength(1)
    expect(memories(g)[0]).toMatchObject({ id: 'm1', weight: 1, text: '你撬開了門。', who: [], where: { district: 'd_a' } })
    g.commit(draft([], 'free', { timeline: checked('critical'), outcome: { result: 'critical', summary: '你一擊就中。' } }))
    g.commit(draft([], 'free', { timeline: checked('fumble'), outcome: { result: 'fumble', summary: '你摔了一跤。' } }))
    g.commit(draft([], 'free', { timeline: checked('fail'), outcome: { result: 'fail', summary: '沒成功。' } }))
    expect(memories(g).map((m) => m.weight)).toEqual([1, 2, 2, 1])
    // 沒有另外多出一份報告：每次提交就是那一份
    expect(g.state.reports.length - before).toBe(4)
    expect(g.state.reports.every((r) => r.action !== 'npc.memory')).toBe(true)
  })

  it('沒有檢定的 action 不記；一般買賣不記；system 不記；談判記 1', () => {
    const g = make()
    g.commit(draft([{ op: 'cash', delta: 0 }], 'free', { timeline: [{ layer: 'meat', text: '你走了走。' }] }))
    g.commit(draft([], 'trade.checkout', { kind: 'deal', outcome: { result: 'ok', summary: '買了一罐。' } }))
    g.commit(draft([], 'x', { kind: 'system' }))
    expect(memories(g)).toEqual([])
    g.commit(draft([], 'fixer.haggle', { kind: 'deal', outcome: { result: 'success', summary: '談妥了價錢。' } }))
    expect(memories(g)).toMatchObject([{ weight: 1, text: '談妥了價錢。' }])
  })

  it('記的時間是這份報告做完之後（含報告自己花的時間）；地點是報告的地點，在內海時另記子網與層', () => {
    const g = make()
    g.commit(draft([{ op: 'time', minutes: 90 }], 'free', { timeline: checked(), location: { district: 'd_a', block: 'b_1', facility: 'f_1' } }))
    g.commit(draft([], 'free', { timeline: checked(), location: { district: 'd_a', subnet: { id: 'sn_1', layer: 2 } } }))
    expect(memories(g)[0]!.at).toEqual({ day: 3, hour: 11, minute: 30 })
    expect(memories(g)[0]!.where).toEqual({ district: 'd_a', block: 'b_1', facility: 'f_1' })
    expect(memories(g)[1]!.where).toEqual({ district: 'd_a', layer: 'net', subnet: 'sn_1', depth: 2 })
  })

  it('參與人：隊上的人、報告裡出現而且有關係條目的人、親密度有變的人；主角與沒有條目的路人不算', () => {
    const buddy = makeActor({ id: 'buddy', name: '夥伴', role: 'companion' })
    const stranger = makeActor({ id: 'stranger', name: '路人', role: 'npc' })
    const g = make({ actors: [buddy, stranger] })
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    const base = memories(g).length
    // 隊上的夥伴、出現的鮑勃（有條目）、出現的路人（沒條目）、親密度有變的卡爾（沒出現在拍子裡）
    g.commit(draft([{ op: 'meter', kind: 'affinity', key: 'npc_carl', delta: 3 }], 'free', {
      timeline: [{ layer: 'meat', actor: 'npc_bob', text: '鮑勃看著你。', roll: ROLL }, { layer: 'meat', actor: 'stranger', text: '路人經過。' }],
    }))
    expect(memories(g)).toHaveLength(base + 1)
    expect(memories(g)[base]!.who).toEqual(['buddy', 'npc_bob', 'npc_carl'])
    // 親密度沒有變（delta 0）的不算
    g.commit(draft([{ op: 'meter', kind: 'affinity', key: 'npc_ann', delta: 0 }], 'free', { timeline: checked() }))
    expect(memories(g)[base + 1]!.who).toEqual(['buddy'])
    // 認識一個人的那份報告：新認識的人也算參與人
    expect(memories(g)[0]).toMatchObject({ text: '認識了鮑勃。', who: ['buddy', 'npc_bob'] })
  })

  it('被收回的報告（retracted）不另外記', () => {
    const g = make()
    g.commit(draft([], 'free', { timeline: checked(), retracted: true }))
    expect(memories(g)).toEqual([])
  })

  it('各種報告種類：combat 只記結束（戰敗、我方有人倒下 2）、gig 接案與收尾 2（倒下或背刺 3）、social 一般 1 招募離隊 2、event 結果 2 通知 1、netrun、downtime', () => {
    const g = make()
    const w = (): number[] => memories(g).map((m) => m.weight)
    g.commit(draft([], 'battle.step', { kind: 'combat', outcome: { result: 'step', summary: '打了一下。' } }))
    expect(memories(g)).toEqual([])
    g.commit(draft([], 'battle.end', { kind: 'combat', outcome: { result: 'win', summary: '贏了。' } }))
    g.commit(draft([], 'battle.end', { kind: 'combat', outcome: { result: 'lose', summary: '輸了。' } }))
    g.commit(draft([], 'battle.end', { kind: 'combat', outcome: { result: 'win', summary: '贏了但有人倒下。' }, timeline: [{ layer: 'meat', text: '倒下了。', tag: 'down', data: { side: 'ally' } }] }))
    g.commit(draft([], 'battle.end', { kind: 'combat', outcome: { result: 'win', summary: '敵人倒下。' }, timeline: [{ layer: 'meat', text: '倒下了。', tag: 'down', data: { side: 'foe' } }] }))
    expect(w()).toEqual([1, 2, 2, 1])
    g.commit(draft([], 'fixer.accept', { kind: 'gig', outcome: { result: 'ok', summary: '接了案。' } }))
    g.commit(draft([], 'commission.close', { kind: 'gig', outcome: { result: 'ok', summary: '收尾。' }, timeline: [{ layer: 'meat', text: '有人倒下。', tag: 'down', data: { side: 'ally' } }] }))
    g.commit(draft([], 'commission.face', { kind: 'gig', outcome: { result: 'ok', summary: '階段中途。' } }))
    expect(w().slice(4)).toEqual([2, 3])
    g.commit(draft([], 'x.talk', { kind: 'social', outcome: { result: 'ok', summary: '聊了聊。' } }))
    g.commit(draft([], 'roster.join', { kind: 'social', outcome: { result: 'joined', summary: '進了名冊。' } }))
    expect(w().slice(6)).toEqual([1, 2])
    g.commit(draft([], 'event.open', { kind: 'event', outcome: { result: 'open', summary: '開了。' } }))
    g.commit(draft([], 'event.close', { kind: 'event', outcome: { result: 'success', summary: '事件結果。' } }))
    g.commit(draft([], 'event.notice', { kind: 'event', outcome: { result: 'ok', summary: '一則通知。' } }))
    expect(w().slice(8)).toEqual([2, 1])
    g.commit(draft([], 'net.run', { kind: 'netrun', outcome: { result: 'ok', summary: '竄網。' } }))
    g.commit(draft([], 'net.run', { kind: 'netrun', outcome: { result: 'trapped', summary: '被扣線。' } }))
    expect(w().slice(10)).toEqual([1, 2])
    g.commit(draft([], 'bill.settle', { kind: 'downtime', outcome: { result: 'paid', summary: '付清。' } }))
    g.commit(draft([], 'bill.settle', { kind: 'downtime', outcome: { result: 'overdue', summary: '欠繳。' } }))
    g.commit(draft([], 'rest.sleep', { kind: 'downtime', outcome: { result: 'ok', summary: '睡了。' } }))
    expect(w().slice(12)).toEqual([2])
  })

  it('關係階段改變的社交報告記 2（親密度從生跨到熟）；階段沒變記 1', () => {
    const g = make()
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    g.commit(draft([{ op: 'meter', kind: 'affinity', key: 'npc_bob', delta: 5 }], 'npc.chat', { kind: 'social', outcome: { result: 'ok', summary: '聊天。' } }))
    g.commit(draft([{ op: 'meter', kind: 'affinity', key: 'npc_bob', delta: 20 }], 'npc.chat', { kind: 'social', outcome: { result: 'ok', summary: '又聊天。' } }))
    expect(memories(g).map((m) => m.weight)).toEqual([1, 1, 2])
  })

  it('廣播：有認識的人的才記、記 2、記在那個人身上；沒有人的不記', () => {
    const g = make()
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    const base = memories(g).length
    g.commit(draft([], 'media.publish', { kind: 'broadcast', outcome: { result: 'ok', summary: '發了一支。' } }))
    expect(memories(g)).toHaveLength(base)
    g.commit(draft([], 'media.publish', { kind: 'broadcast', outcome: { result: 'ok', summary: '發了鮑勃的帶子。' }, timeline: [{ layer: 'meat', actor: 'npc_bob', text: '鮑勃入鏡。' }] }))
    expect(memories(g).slice(base)).toMatchObject([{ weight: 2, who: ['npc_bob'] }])
  })

  it('事件用 memory 效果指定的照指定，不再自動多記一筆；格式不對的整批不收', () => {
    const g = make()
    const r = give(g, [{ kind: 'memory', text: '你答應了她一件事。', weight: 3, who: ['npc_bob'] }])
    expect(r.lines).toEqual(['記下了一件事：你答應了她一件事。'])
    expect(memories(g)).toMatchObject([{ weight: 3, text: '你答應了她一件事。', who: ['npc_bob'] }])
    const rs = g.k.effects.resolve([{ kind: 'memory', text: '指定。', weight: 3 }], effectCtx(g.k, g.state, { source: 'builtin' }))
    g.commit(draft(rs.changes, 'event.close', { kind: 'event', outcome: { result: 'success', summary: '事件結果。' } }))
    expect(memories(g)).toHaveLength(2)
    expect(memories(g)[1]).toMatchObject({ weight: 3, text: '指定。' })
    for (const bad of [{ kind: 'memory' }, { kind: 'memory', text: '' }, { kind: 'memory', text: 'x', weight: 4 }, { kind: 'memory', text: 'x', who: [1] }]) {
      expect(g.k.effects.resolve([bad], effectCtx(g.k, g.state, { source: 'builtin' })).errors.length).toBeGreaterThan(0)
    }
  })

  it('npc.memory 與 npc.life 的報告自己不記；認識一個人、關注一個人是 social，記一般的 1', () => {
    const g = make({ rule: { life: { sink: { chance: 1 } } } })
    g.commit(remember(g.k, g.state, { text: '一件事。' }))
    expect(memories(g)).toHaveLength(1)
    watch(g, 'npc_ann')
    expect(memories(g).map((m) => [m.text, m.weight])).toEqual([['一件事。', 2], ['認識了安。', 1], ['開始關注安。', 1]])
    days(g, 9)
    expect(lifeReports(g)).toHaveLength(1)
    expect(memories(g)).toHaveLength(3)
  })
})

// ---- 檢索 ----

describe('recall：8.2 節的分數', () => {
  const addAll = (g: G, list: Array<Partial<Memory> & { text: string }>) =>
    g.commit(draft(list.map((m) => ({ op: 'npcs.memory.add', where: {}, who: [], weight: 1, ...m })) as never, 'test.fill', { kind: 'system' }))
  const T = (day: number) => ({ day, hour: 9, minute: 0 })

  it('釘選的排在前面；結果照時間排，不照分數', () => {
    const g = make({ patch: { time: { day: 30, hour: 10, minute: 0 } } })
    addAll(g, [
      { text: '舊的釘選', at: T(1), pinned: true },
      ...Array.from({ length: 8 }, (_, i) => ({ text: `重要${i}`, at: T(2 + i), weight: 3 as const })),
    ])
    const got = recall(g.k, g.state, { limit: 3 })
    expect(got.map((m) => m.text)).toContain('舊的釘選')
    expect(got).toHaveLength(3)
    // 時間排序：釘選的（第 1 天）在最前面
    expect(got[0]!.text).toBe('舊的釘選')
    expect(got.map((m) => toMinutes(m.at))).toEqual([...got.map((m) => toMinutes(m.at))].sort((a, b) => a - b))
  })

  it('同一個地點、三天內的分數比較高；共同參與人每人加 3', () => {
    const g = make({ patch: { time: { day: 20, hour: 10, minute: 0 } } })
    addAll(g, [
      { text: '遠的', at: T(5), where: { district: 'd_b' } },
      { text: '近的', at: T(19), where: { district: 'd_a', block: 'b_1' } },
      { text: '同地點但很久以前', at: T(2), where: { district: 'd_a' } },
    ])
    expect(recall(g.k, g.state, { where: { district: 'd_a' }, limit: 1 }).map((m) => m.text)).toEqual(['近的'])
    // 十天內（0.75）比三天內（1.5）低，比更舊的高
    addAll(g, [{ text: '十天內', at: T(13), where: { district: 'd_b' } }])
    expect(recall(g.k, g.state, { limit: 2 }).map((m) => m.text)).toEqual(['十天內', '近的'])
    // 談到鮑勃：他在場的那一筆勝過一切（3 分 > 其餘的差距）
    addAll(g, [{ text: '鮑勃在場', at: T(1), who: ['npc_bob'], where: { district: 'd_b' } }])
    expect(recall(g.k, g.state, { who: 'npc_bob', limit: 1 }).map((m) => m.text)).toEqual(['鮑勃在場'])
    expect(recall(g.k, g.state, { who: ['npc_bob', 'npc_carl'], limit: 1 }).map((m) => m.text)).toEqual(['鮑勃在場'])
  })

  it('最多六筆（預設）；重要程度也算分；limit 可以調；沒有記憶是空的', () => {
    const g = make({ patch: { time: { day: 40, hour: 10, minute: 0 } } })
    expect(recall(g.k, g.state)).toEqual([])
    addAll(g, Array.from({ length: 12 }, (_, i) => ({ text: `第${i}筆`, at: T(i + 1), weight: (i === 0 ? 3 : 1) as 1 | 3 })))
    const got = recall(g.k, g.state)
    expect(got).toHaveLength(6)
    expect(got.map((m) => m.text)).toContain('第0筆')
    expect(recall(g.k, g.state, { limit: 2 })).toHaveLength(2)
    expect(recall(g.k, g.state, { limit: 0 })).toEqual([])
    expect(recall(g.k, g.state, { limit: 50 })).toHaveLength(12)
  })

  it('回傳的是複製，改它不影響狀態', () => {
    const g = make()
    addAll(g, [{ text: '一筆', at: T(1) }])
    recall(g.k, g.state)[0]!.text = '被改了'
    memoriesOf(g.state)[0]!.text = '被改了'
    expect(memories(g)[0]!.text).toBe('一筆')
  })
})

// ---- 合併 ----

describe('合併：超過 200 筆時（8.3 節）', () => {
  const T = (day: number) => ({ day, hour: 9, minute: 0 })
  const fill = (g: G, n: number, dayOf: (i: number) => number, extra: (i: number) => Partial<Memory> = () => ({})) =>
    g.commit(draft(Array.from({ length: n }, (_, i) => ({ op: 'npcs.memory.add', where: { district: 'd_a' }, who: [`p${i % 3}`], weight: 1, text: `日常${i}`, at: T(dayOf(i)), ...extra(i) })) as never, 'test.fill', { kind: 'system' }))
  const countOf = (list: Memory[]): number => list.reduce((n, m) => n + (m.merged ?? 1), 0)

  it('塞 260 筆日常（每天兩筆）：不超過 200；最近 50 筆、重要以上與釘選的原樣還在；合併的標著筆數、參與人取聯集；總筆數守恆', () => {
    const g = make()
    fill(g, 260, (i) => 1 + Math.floor(i / 2), (i) => (i === 3 ? { pinned: true } : i === 7 ? { weight: 2 as const } : {}))
    const list = memories(g)
    expect(list.length).toBeLessThanOrEqual(200)
    expect(list.length).toBeLessThan(260)
    expect(countOf(list)).toBe(260)
    // 最近 50 筆原樣
    for (let i = 210; i < 260; i++) expect(list.find((m) => m.text === `日常${i}`)).toMatchObject({ weight: 1 })
    expect(list.filter((m) => /^日常\d+$/.test(m.text)).length).toBeGreaterThanOrEqual(50)
    // 釘選與重要的原樣
    expect(list.find((m) => m.text === '日常3')).toMatchObject({ pinned: true })
    expect(list.find((m) => m.text === '日常7')).toMatchObject({ weight: 2 })
    // 合併的那幾筆
    const merged = list.filter((m) => m.merged !== undefined)
    expect(merged.length).toBeGreaterThan(0)
    for (const m of merged) {
      expect(m.merged).toBeGreaterThanOrEqual(2)
      expect(m.text).toContain(`合併 ${m.merged} 筆`)
      expect(m.weight).toBe(1)
      expect(m.pinned).toBeUndefined()
      expect(m.who).toEqual([...m.who].sort())
    }
    expect(merged[0]!.who).toEqual(['p0', 'p1'])
    // 同一天的先合併：每筆合併是同一天的兩筆
    expect(merged.every((m) => m.merged === 2)).toBe(true)
  })

  it('同一天合併之後還太多，就依十天合併：每天只有一筆的 260 筆', () => {
    const g = make()
    fill(g, 260, (i) => 1 + i)
    const list = memories(g)
    expect(list.length).toBeLessThanOrEqual(200)
    expect(countOf(list)).toBe(260)
    const merged = list.filter((m) => m.merged !== undefined)
    expect(merged.length).toBeGreaterThan(0)
    expect(merged[0]!.merged).toBe(10)
    for (let i = 210; i < 260; i++) expect(list.find((m) => m.text === `日常${i}`)).toBeDefined()
  })

  it('剛好 200 筆不合併；全是重要的或釘選的，超過了也不動（不超出能合併的範圍）', () => {
    const g = make()
    fill(g, 200, (i) => 1 + i)
    expect(memories(g)).toHaveLength(200)
    expect(memories(g).every((m) => m.merged === undefined)).toBe(true)
    const h = make()
    fill(h, 230, (i) => 1 + i, () => ({ weight: 2 as const }))
    expect(memories(h)).toHaveLength(230)
  })

  it('compactMemories 是純函式：不改傳進來的清單；不到上限原樣回傳', () => {
    const rules = DEFAULT_LIFE_RULES.memory
    const list: Memory[] = Array.from({ length: 205 }, (_, i) => ({ id: `m${i + 1}`, at: T(1), where: {}, who: [], text: `事${i}`, weight: 1 as const }))
    const snapshot = JSON.stringify(list)
    let n = 1000
    const out = compactMemories(list, rules, () => `m${n++}`)
    expect(JSON.stringify(list)).toBe(snapshot)
    expect(out.length).toBeLessThan(list.length)
    expect(compactMemories(list.slice(0, 200), rules, () => 'x')).toHaveLength(200)
  })
})

// ---- 回到快照 ----

describe('回到快照：記憶留著、其餘的回去（SERIES 第 6 節）', () => {
  it('撤退之後記憶還在（包括撤退前記下的、玩家手動加的、釘選的），錢、時間與別的狀態回到快照那一刻', () => {
    const g = make({ patch: { money: { cred: 0, cash: 500 } } })
    g.commit(remember(g.k, g.state, { text: '進去之前記的。' }))
    const entryAt = clone(g.state.time)
    g.commit(draft([{ op: 'snapshot.take', kind: 'entry', label: '入口' }, { op: 'time', minutes: 10 }], 'commission.enter', { kind: 'gig', outcome: { result: 'ok', summary: '進了副本。' } }))
    g.commit(draft([{ op: 'cash', delta: -200 }, { op: 'time', minutes: 120 }], 'free', { timeline: checked(), outcome: { result: 'success', summary: '在副本裡撬了鎖。' } }))
    g.commit(remember(g.k, g.state, { text: '副本裡手動記的。', pinned: true }))
    expect(memories(g).map((m) => m.text)).toEqual(['進去之前記的。', '在副本裡撬了鎖。', '副本裡手動記的。'])
    g.commit(draft([], 'commission.retreat', { kind: 'gig', outcome: { result: 'retreat', summary: '撤退了。' }, rewind: { kind: 'entry', summary: '你撤退了。' } }))
    // 其餘的回去了
    expect(g.state.money.cash).toBe(500)
    expect(g.state.time).toEqual(entryAt)
    // 記憶留著（也有收尾那一份報告的）
    const texts = memories(g).map((m) => m.text)
    expect(texts).toEqual(expect.arrayContaining(['進去之前記的。', '在副本裡撬了鎖。', '副本裡手動記的。']))
    expect(memories(g).find((m) => m.text === '副本裡手動記的。')).toMatchObject({ pinned: true })
    expect(g.state.reports.some((r) => r.retracted)).toBe(true)
    // 之後新記的流水號接著走，不重複
    g.commit(remember(g.k, g.state, { text: '回來之後。' }))
    const ids = memories(g).map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('沒有記憶變動時回到快照不多一筆變更（記憶本來就一樣）', () => {
    const g = make()
    g.commit(draft([{ op: 'snapshot.take', kind: 'entry', label: '入口' }], 'commission.enter', { kind: 'system' }))
    g.commit(draft([{ op: 'cash', delta: 0 }], 'x', { kind: 'system', rewind: { kind: 'entry', summary: '回去。' } }))
    expect(memories(g)).toEqual([])
  })
})

// ---- 玩家的操作 ----

describe('npc.memory：手動加、改寫與調星等、釘選、刪除', () => {
  it('手動加：預設重要程度 2、地點是現在這裡；可以指定參與人與釘選；內容空的、星等不對被擋下', () => {
    const g = make()
    const r = g.commit(remember(g.k, g.state, { text: '  你答應過她。 ', who: ['npc_bob', 'npc_bob', 'npc_ann'], pinned: true }))
    expect(r[0]!.action).toBe('npc.memory')
    expect(memories(g)).toEqual([{ id: 'm1', at: g.state.time, where: { district: 'd_a' }, who: ['npc_ann', 'npc_bob'], text: '你答應過她。', weight: 2, pinned: true }])
    expect(reasonOf(() => remember(g.k, g.state, { text: '   ' }))).toBe('要寫下這筆記憶的內容。')
    expect(reasonOf(() => remember(g.k, g.state, { text: 'x', weight: 5 as never }))).toContain('重要程度只有')
  })

  it('改寫、調星等、釘選與取消釘選、刪除；找不到的 id 被擋下', () => {
    const g = make()
    g.commit(remember(g.k, g.state, { text: '舊內容。', weight: 1 }))
    g.commit(editMemory(g.k, g.state, 'm1', { text: '新內容。', weight: 3 }))
    expect(memories(g)[0]).toMatchObject({ text: '新內容。', weight: 3 })
    g.commit(pinMemory(g.k, g.state, 'm1'))
    expect(memories(g)[0]!.pinned).toBe(true)
    g.commit(pinMemory(g.k, g.state, 'm1', false))
    expect(memories(g)[0]!.pinned).toBeUndefined()
    expect(reasonOf(() => editMemory(g.k, g.state, 'nope', { text: 'x' }))).toBe('找不到這一筆記憶。')
    expect(reasonOf(() => editMemory(g.k, g.state, 'm1', { text: '' }))).toContain('不能是空的')
    expect(reasonOf(() => editMemory(g.k, g.state, 'm1', {}))).toBe('沒有要改的地方。')
    expect(reasonOf(() => forgetMemory(g.k, g.state, 'nope'))).toBe('找不到這一筆記憶。')
    g.commit(forgetMemory(g.k, g.state, 'm1'))
    expect(memories(g)).toEqual([])
  })

  it('直接送進來的壞變更被擋下，狀態不變', () => {
    const g = make()
    for (const c of [{ op: 'npcs.memory.add', text: '' }, { op: 'npcs.memory.add', text: 'x', weight: 4 }, { op: 'npcs.memory.add', text: 'x', where: { layer: 'sea' } }, { op: 'npcs.memory.edit', id: 'zz' }, { op: 'npcs.memory.delete', id: 'zz' }]) {
      expect(() => g.commit(draft([c as never], 'x', { kind: 'system' }))).toThrow()
    }
    expect(memories(g)).toEqual([])
  })
})

// ---- NPC 自己的日子：誰、多久 ----

describe('自己的日子：對象與次數', () => {
  /** 沉溺 40、每次必中、每次 +1：沉溺的增量就是擲了幾次。 */
  const SINK = { life: { sink: { chance: 1, gain: [1, 1] } } }
  const sinkOf = (g: G, id: string): number => actor(g, id).sink
  const sinkAnn = (g: G): number => sinkOf(g, 'npc_ann')

  it('過 9 天：每個符合的人擲 3 次（每 3 天一次）；被關注的、親密度 30 以上的都算', () => {
    const g = make({ rule: SINK, content: (c) => { c.npc = [ANN, { ...ANN, id: 'npc_ann2', name: '安二' }, BOB, CARL, CLERK] } })
    watch(g, 'npc_ann')
    befriend(g, 'npc_ann2', 30)
    const s0 = sinkAnn(g)
    days(g, 9)
    expect(sinkAnn(g)).toBe(s0 + 3)
    expect(sinkOf(g, 'npc_ann2')).toBe(40 + 3)
    expect(lifeReports(g)).toHaveLength(1)
  })

  it('不符合條件的人不擲：沒關注、親密度 10、親密度 29；主角自己不算', () => {
    const g = make({ rule: SINK, content: (c) => { c.npc = [ANN, { ...ANN, id: 'npc_low', name: '低' }, { ...ANN, id: 'npc_edge', name: '邊' }, { ...ANN, id: 'npc_none', name: '無' }] } })
    befriend(g, 'npc_low', 10)
    befriend(g, 'npc_edge', 29)
    g.commit(meetNpc(g.k, g.state, 'npc_none'))
    expect(lifeSubjects(g.k, g.state)).toEqual([])
    days(g, 30)
    for (const id of ['npc_low', 'npc_edge', 'npc_none']) expect(sinkOf(g, id)).toBe(40)
    expect(lifeReports(g)).toHaveLength(0)
    // 親密度到 30 才算
    give(g, [{ kind: 'affinity', key: 'npc_edge', amount: 1 }])
    expect(lifeSubjects(g.k, g.state)).toEqual(['npc_edge'])
  })

  it('一次過 60 天最多補 10 次；不到 3 天的小步不擲', () => {
    const g = make({ rule: SINK })
    watch(g, 'npc_ann')
    days(g, 60)
    expect(sinkAnn(g)).toBe(40 + 10)
    // 每天走一點：照樣是每 3 天一次
    const h = make({ rule: SINK })
    watch(h, 'npc_ann')
    for (let i = 0; i < 9; i++) days(h, 1)
    expect(sinkAnn(h)).toBe(40 + 3)
    // 3 天裡走得很碎：一個 2 小時一個 2 小時，也只擲 1 次
    const j = make({ rule: SINK })
    watch(j, 'npc_ann')
    for (let i = 0; i < 24; i++) advance(j, 120)
    expect(sinkAnn(j)).toBe(40 + 1)
  })

  it('同一個種子結果一樣；一步走完與分幾步走完一樣；中途存檔讀檔也一樣', () => {
    const wild = { life: { job: { chance: 0.5, promote_chance: 0.3 }, injured: { chance: 0.3 }, arrest: { base: 0.1 }, debt: { chance: 0.3 }, sink: { chance: 0.5 }, implant: { chance: 0.3 } }, roster: { chance: 0.6 } }
    const run = (steps: number[], save = false) => {
      const g = make({ seed: 31, rule: wild })
      go(g, 'd_a')
      go(g, 'd_b')
      watch(g, 'npc_ann')
      watch(g, 'npc_bob')
      let cur = g
      for (const [i, n] of steps.entries()) {
        days(cur, n)
        if (save && i === 0) {
          const raw = cur.save()
          const other = make({ seed: 31, rule: wild })
          expect(other.load(raw)).toBeNull()
          cur = other
        }
      }
      return { ext: JSON.stringify(readNpcs(cur.state)), actors: JSON.stringify(cur.state.actors), npcs: lifeReports(cur).length }
    }
    const a = run([27])
    expect(run([27])).toEqual(a)
    const split = run([9, 9, 9])
    expect(split.ext).toBe(a.ext)
    expect(split.actors).toBe(a.actors)
    const saved = run([9, 18], true)
    expect(saved.ext).toBe(a.ext)
    expect(saved.actors).toBe(a.actors)
    // 換一個種子，結果不同
    const g = make({ seed: 32, rule: wild })
    go(g, 'd_a')
    go(g, 'd_b')
    watch(g, 'npc_ann')
    watch(g, 'npc_bob')
    days(g, 27)
    expect(JSON.stringify(readNpcs(g.state))).not.toBe(a.ext)
  })

  it('名冊上的人也算（靠 in_roster）；沒有裝名冊的時候這一類是空的，其餘照常', () => {
    const runner = (id: string): Actor => makeActor({ id, name: id, role: 'npc', sink: 40, ext: { paths: [{ path: 'p_gun', slot: 'main', tier: 2 }] } })
    const withRoster = make({ rule: SINK, features: [STUBS, HOSTILITY, npcsFeature, rosterFeature], actors: [runner('r_in'), runner('r_out')] })
    withRoster.commit(join(withRoster.k, withRoster.state, 'r_in'))
    expect(lifeSubjects(withRoster.k, withRoster.state)).toEqual(['r_in'])
    days(withRoster, 9)
    expect(sinkOf(withRoster, 'r_in')).toBe(43)
    expect(sinkOf(withRoster, 'r_out')).toBe(40)
    // 沒有 in_roster 這種條件：名冊那一類略過，被關注的還是照常
    const bare = make({ rule: SINK, actors: [runner('r_in'), runner('r_out')] })
    expect(bare.k.conditions.kinds()).not.toContain('in_roster')
    expect(lifeSubjects(bare.k, bare.state)).toEqual([])
    watch(bare, 'npc_ann')
    days(bare, 9)
    expect(sinkOf(bare, 'r_in')).toBe(40)
    expect(sinkAnn(bare)).toBe(43)
  })

  it('跨過的次數記在報告裡：一份 npc.life（downtime），有變化才有；什麼都沒擲出來就沒有報告', () => {
    const g = make({ rule: SINK })
    watch(g, 'npc_ann')
    days(g, 9)
    const [r] = lifeReports(g)
    expect(r).toMatchObject({ kind: 'downtime', action: 'npc.life', outcome: { result: 'life' } })
    expect(r!.timeline.length).toBeGreaterThan(0)
    const quiet = make()
    watch(quiet, 'npc_ann')
    days(quiet, 30)
    expect(lifeReports(quiet)).toHaveLength(0)
  })
})

// ---- 擲什麼 ----

describe('自己的日子：擲的項目', () => {
  it('自己接了案：行者才有；錢照階數；15% 升一階，主職最高到 5 階（角色身上與資料上都升）', () => {
    const g = make({ rule: { life: { job: { chance: 1, promote_chance: 1, cash: [100, 100] } } }, content: (c) => { c.npc = [{ ...ANN, paths: [{ path: 'p_gun', slot: 'main', tier: 4 }, { path: 'p_gun', slot: 'sub', tier: 1 }] }, BOB, CARL, CLERK] } })
    watch(g, 'npc_ann')
    watch(g, 'npc_bob')
    days(g, 9)
    const paths = actor(g, 'npc_ann').ext.paths as Array<{ slot: string; tier: number }>
    expect(paths.find((p) => p.slot === 'main')!.tier).toBe(5)
    expect(paths.find((p) => p.slot === 'sub')!.tier).toBe(1)
    expect(npcOf(g.k, g.state, 'npc_ann')!.paths.find((p) => p.slot === 'main')!.tier).toBe(5)
    const news = newsOf(g.state, 'npc_ann')
    expect(news).toHaveLength(3)
    expect(news.map((n) => n.what)).toEqual(['job', 'job', 'job'])
    expect(news[0]!.text).toBe('接了一件案，賺了 400，主職升到 5 階。')
    expect(news[1]!.text).toBe('接了一件案，賺了 500。')
    // 街坊不接案
    expect(newsOf(g.state, 'npc_bob')).toEqual([])
    // 沒有升階機率就不升
    const h = make({ rule: { life: { job: { chance: 1, cash: [100, 100] } } } })
    watch(h, 'npc_ann')
    days(h, 9)
    expect(npcOf(h.k, h.state, 'npc_ann')!.paths[0]!.tier).toBe(2)
    expect(newsOf(h.state, 'npc_ann')[0]!.text).toBe('接了一件案，賺了 200。')
  })

  it('受傷：身上有 injured、有期限（3～7 天）；到期自己消掉；到期的當下就看不到', () => {
    const g = make({ rule: { life: { injured: { chance: 1, days: [3, 3] } } } })
    watch(g, 'npc_ann')
    days(g, 3)
    // 第 4 天 08:00 那個點擲中：受傷到第 7 天 08:00
    expect(cond(g, 'npc_ann', 'injured')).toEqual({ id: 'injured', until: toMinutes(at(4)) + 3 * DAY })
    expect(newsOf(g.state, 'npc_ann')).toMatchObject([{ what: 'injured', at: at(4) }])
    // 這幾天不在原本的地方（受傷的人不照出沒表以外的規則：這裡只看狀況有沒有掛上）
    expect(g.state.actors.npc_ann!.conditions.map((c) => c.id)).toContain('injured')
    // 手動掛一個一天的傷，什麼都不擲：隔天自己消掉
    const h = make()
    h.commit(meetNpc(h.k, h.state, 'npc_ann'))
    h.commit(draft([{ op: 'actor.condition', id: 'npc_ann', condition: 'injured', until: toMinutes(h.state.time) + DAY }], 'test.hurt'))
    expect(cond(h, 'npc_ann', 'injured')).toBeDefined()
    advance(h, DAY - 60)
    expect(cond(h, 'npc_ann', 'injured')).toBeDefined()
    advance(h, 120)
    expect(cond(h, 'npc_ann', 'injured')).toBeUndefined()
    // 沒有期限的別的狀況不動
    h.commit(draft([{ op: 'actor.condition', id: 'npc_ann', condition: 'lying_low' }], 'test.hide'))
    advance(h, 10 * DAY)
    expect(cond(h, 'npc_ann', 'lying_low')).toBeDefined()
  })

  it('受傷的人在好之前不再受傷；一次跨過幾個點時前面受的傷在後面的點之前就算好了', () => {
    const g = make({ rule: { life: { injured: { chance: 1, days: [7, 7] } } } })
    watch(g, 'npc_ann')
    days(g, 6)
    // 第 4 天受傷到第 11 天；第 7 天那個點還傷著，不再擲
    expect(newsOf(g.state, 'npc_ann')).toHaveLength(1)
    expect(cond(g, 'npc_ann', 'injured')!.until).toBe(toMinutes(at(11)))
    days(g, 3)
    // 現在是第 12 天：第 10 天那個點仍然傷著；到期（第 11 天 08:00）已經過了，條件被清掉
    expect(newsOf(g.state, 'npc_ann')).toHaveLength(1)
    expect(cond(g, 'npc_ann', 'injured')).toBeUndefined()
    // 一口氣跨過好幾個點，前面的傷過了期限就能再受傷
    days(g, 30)
    expect(newsOf(g.state, 'npc_ann').length).toBeGreaterThan(1)
  })

  it('被捕：機率照他勢力的對頭的敵對值（每 20 點 +20%，這裡把每級調成 20%）；沒有敵對值就不被捕；被捕的人不照出沒表', () => {
    const rules = { life: { arrest: { base: 0, per: 0.2 } } }
    const calm = make({ rule: rules })
    watch(calm, 'npc_ann')
    days(calm, 30)
    expect(cond(calm, 'npc_ann', 'arrested')).toBeUndefined()
    const g = make({ rule: rules })
    watch(g, 'npc_ann')
    g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_y', set: 100 }], 'test.hostile'))
    days(g, 3)
    expect(cond(g, 'npc_ann', 'arrested')).toEqual({ id: 'arrested' })
    expect(newsOf(g.state, 'npc_ann')).toMatchObject([{ what: 'arrested', text: '被抓走了。' }])
    expect(whereIs(g.k, g.state, 'npc_ann')).toBeNull()
    // 自己勢力的敵對值不算，只算對頭的
    const own = make({ rule: rules })
    watch(own, 'npc_ann')
    own.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_x', set: 100 }], 'test.hostile'))
    days(own, 30)
    expect(cond(own, 'npc_ann', 'arrested')).toBeUndefined()
    // 被捕的人沒有再被捕一次（只有一則）
    days(g, 30)
    expect(newsOf(g.state, 'npc_ann').filter((n) => n.what === 'arrested')).toHaveLength(1)
  })

  it('被捕的機率：基礎 2%、敵對值每 20 點 +2%（預設值）', () => {
    expect(DEFAULT_LIFE_RULES.life.arrest).toEqual({ base: 0.02, per: 0.02, step: 20 })
    const g = make({ rule: null })
    expect(lifeRules(g.k).life.arrest).toEqual({ base: 0.02, per: 0.02, step: 20 })
    expect(lifeRules(g.k).life.job).toMatchObject({ chance: 0.4, promote_chance: 0.15, max_tier: 5 })
    expect(lifeRules(g.k).life.injured).toEqual({ chance: 0.1, days: [3, 7] })
    expect(lifeRules(g.k).life.debt).toEqual({ chance: 0.06, poor_max: 1 })
    expect(lifeRules(g.k).life.sink).toMatchObject({ min: 40, chance: 0.15, gain: [3, 8], edge: 80 })
    expect(lifeRules(g.k).life.implant.chance).toBe(0.05)
    expect(lifeRules(g.k).roster).toMatchObject({ chance: 0.25, season_mult: 2, protect_known: true })
  })

  it('欠債：窮人才有；狀況 debt、近況一則、觸發點', () => {
    const g = make({ rule: { life: { debt: { chance: 1 } } } })
    watch(g, 'npc_bob')
    watch(g, 'npc_carl')
    days(g, 9)
    expect(cond(g, 'npc_bob', 'debt')).toEqual({ id: 'debt' })
    expect(cond(g, 'npc_carl', 'debt')).toBeUndefined()
    expect(newsOf(g.state, 'npc_bob')).toHaveLength(1)
    expect(newsOf(g.state, 'npc_bob')[0]!.what).toBe('debt')
  })

  it('沉溺上升：40 以上才擲；+3～+8；到 80 以上狀況 near_sink；不超過 100', () => {
    const g = make({ rule: { life: { sink: { chance: 1, gain: [50, 50] } } } })
    watch(g, 'npc_ann')
    days(g, 3)
    expect(actor(g, 'npc_ann').sink).toBe(90)
    expect(cond(g, 'npc_ann', 'near_sink')).toEqual({ id: 'near_sink' })
    expect(newsOf(g.state, 'npc_ann')[0]!.what).toBe('near_sink')
    days(g, 30)
    expect(actor(g, 'npc_ann').sink).toBe(100)
    expect(newsOf(g.state, 'npc_ann').filter((n) => n.what === 'near_sink')).toHaveLength(1)
    // 沉溺不到 40 不擲
    const low = make({ rule: { life: { sink: { chance: 1 } } }, content: (c) => { c.npc = [{ ...ANN, sink: 39 }, BOB, CARL, CLERK] } })
    watch(low, 'npc_ann')
    days(low, 30)
    expect(actor(low, 'npc_ann').sink).toBe(39)
    // 預設的 +3～+8
    const dflt = make({ rule: { life: { sink: { chance: 1 } } } })
    watch(dflt, 'npc_ann')
    days(dflt, 3)
    expect(actor(dflt, 'npc_ann').sink - 40).toBeGreaterThanOrEqual(3)
    expect(actor(dflt, 'npc_ann').sink - 40).toBeLessThanOrEqual(8)
  })

  it('換了義體：一項屬性 +1、外貌（資料上的 look）記一次', () => {
    const g = make({ rule: { life: { implant: { chance: 1 } } } })
    watch(g, 'npc_ann')
    const sum = (a: Actor): number => Object.values(a.attrs).reduce((x, y) => x + y, 0)
    const before = sum(actor(g, 'npc_ann'))
    days(g, 9)
    expect(sum(actor(g, 'npc_ann'))).toBe(before + 3)
    expect(npcOf(g.k, g.state, 'npc_ann')!.look.implants).toBe(3)
    expect(Object.values(npcOf(g.k, g.state, 'npc_ann')!.attrs).reduce((x, y) => x + y, 0)).toBe(sum(actor(g, 'npc_ann')))
    expect(newsOf(g.state, 'npc_ann').map((n) => n.what)).toEqual(['implant', 'implant', 'implant'])
  })

  it('有變化的人多一則近況；超過 6 則丟最舊的（照時間排，最舊的在前）', () => {
    const g = make({ rule: { life: { job: { chance: 1, cash: [100, 100] } } } })
    watch(g, 'npc_ann')
    days(g, 9)
    expect(newsOf(g.state, 'npc_ann')).toHaveLength(3)
    days(g, 30)
    const news = newsOf(g.state, 'npc_ann')
    expect(news).toHaveLength(NEWS_MAX)
    // 9 天 3 則（第 4、7、10 天）＋ 30 天 10 則（第 13～40 天每 3 天）= 13 則，留最後 6 則：第 31、34、37、40 …
    expect(news.map((n) => n.at.day)).toEqual([25, 28, 31, 34, 37, 40])
    expect(news.map((n) => toMinutes(n.at))).toEqual([...news.map((n) => toMinutes(n.at))].sort((a, b) => a - b))
  })

  it('出事的那一份報告帶 npc_life 的觸發點：受傷、被捕、欠債、溺感邊緣各一個；接案與沉溺上升不帶', () => {
    const g = make({ rule: { life: { injured: { chance: 1 }, debt: { chance: 1 }, sink: { chance: 1, gain: [50, 50] }, job: { chance: 1 } } } })
    watch(g, 'npc_bob')
    watch(g, 'npc_ann')
    g.commit(draft([{ op: 'meter', kind: 'hostility', key: 'f_y', set: 100 }], 'test.hostile'))
    days(g, 3)
    const [r] = lifeReports(g)
    const trig = (r!.triggers ?? []).map((t) => `${t.point}:${(t.where as Rec).npc}:${(t.where as Rec).what}`).sort()
    expect(trig).toEqual(['npc_life:npc_ann:injured', 'npc_life:npc_ann:near_sink', 'npc_life:npc_bob:debt', 'npc_life:npc_bob:injured'])
    // 沒出事（只有接案）的報告沒有觸發點
    const j = make({ rule: { life: { job: { chance: 1 } } } })
    watch(j, 'npc_ann')
    days(j, 3)
    expect(lifeReports(j)[0]!.triggers).toBeUndefined()
  })

  it('這些報告自己不記進共同記憶；日子的亂數不碰存檔的亂數游標', () => {
    const g = make({ rule: { life: { injured: { chance: 1 } } } })
    watch(g, 'npc_ann')
    const known = memories(g).length
    const cursor = g.state.rng.cursor
    days(g, 9)
    expect(lifeReports(g)).toHaveLength(1)
    expect(memories(g)).toHaveLength(known)
    expect(g.state.rng.cursor).toBe(cursor)
  })

  it('lifeDraft 是純函式：不改狀態；沒有跨過點時是 null', () => {
    const g = make({ rule: { life: { sink: { chance: 1 } } } })
    watch(g, 'npc_ann')
    const before = JSON.stringify(g.state)
    const deps = { actorOf: () => [], buildActor: () => { throw new Error('不該用到') } }
    expect(lifeDraft(g.k, g.state, at(3, 10), at(3, 12), deps)).toBeNull()
    expect(lifeDraft(g.k, g.state, at(3, 10), at(12, 10), deps)).not.toBeNull()
    expect(JSON.stringify(g.state)).toBe(before)
    expect(toMinutes(fromMinutes(toMinutes(at(4))))).toBe(toMinutes(at(4)))
  })

  it('規則的格式：蓋掉預設的數字；壞的整包不收', () => {
    const g = make({ rule: { life: { job: { chance: 0.9 } }, memory: { limit: 20 } } })
    expect(lifeRules(g.k).life.job.chance).toBe(0.9)
    expect(lifeRules(g.k).memory.limit).toBe(20)
    expect(lifeRules(g.k).life.injured.days).toEqual([3, 7])
    for (const bad of [{ life: { job: { chance: 2 } } }, { life: { every_days: 0 } }, { life: { injured: { days: [7, 3] } } }, { nope: 1 }, { roster: { risky: { d_a: -1 } } }, { memory: { gig_actions: [1] } }]) {
      expect(() => make({ rule: bad })).toThrow(ContentError)
    }
  })

  it('規則換了：每 1 天擲一次、補的上限 2 次', () => {
    const g = make({ rule: { life: { every_days: 1, max_catchup: 2, sink: { chance: 1, gain: [1, 1] } } } })
    watch(g, 'npc_ann')
    days(g, 10)
    expect(actor(g, 'npc_ann').sink).toBe(42)
    days(g, 1)
    expect(actor(g, 'npc_ann').sink).toBe(43)
  })
})

// ---- 名單的變動 ----

describe('名單的變動：每 3 天每份名單 25% 發生一件', () => {
  const rosterIds = (g: G, d: string): string[] => readNpcs(g.state).rosters[d]?.ids ?? []
  /** 只有一位固定 NPC 的名單（沒有生成的人），好讓「誰被選中」不靠運氣。 */
  const SOLO = (c: Content) => {
    c.npc_gen = [{ id: 'ng_a', district: 'd_a', citizens: 0, runners: 0, occupations: [], factions: [], names: ['np'] }]
    c.npc = [BOB, CLERK]
  }

  it('每份已經建好的名單各擲一次；沒建好的（沒走進過的區）不擲；搬來的人進名單、名字不重複', () => {
    const g = make({ rule: { roster: { chance: 1, weights: { join: 1, leave: 0, move: 0, trouble: 0 } } } })
    go(g, 'd_a')
    const a0 = rosterIds(g, 'd_a').length
    expect(readNpcs(g.state).rosters.d_b).toBeUndefined()
    days(g, 9)
    expect(rosterIds(g, 'd_a')).toHaveLength(a0 + 3)
    expect(readNpcs(g.state).rosters.d_b).toBeUndefined()
    // 新來的人是生成的、查得到、名字不重複
    const added = rosterIds(g, 'd_a').slice(a0)
    expect(added.every((id) => npcOf(g.k, g.state, id)?.source === 'gen')).toBe(true)
    const names = Object.values(readNpcs(g.state).gen).map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
    expect(readNpcs(g.state).seq.d_a).toBe(3)
    // 兩區都建好：每區各一件
    go(g, 'd_b')
    const b0 = rosterIds(g, 'd_b').length
    days(g, 6)
    expect(rosterIds(g, 'd_a')).toHaveLength(a0 + 5)
    expect(rosterIds(g, 'd_b')).toHaveLength(b0 + 2)
  })

  it('機率 25%：種子固定時每個三天的結果固定；機率 0 的時候名單不動', () => {
    const run = (chance: number, seed = 7) => {
      const g = make({ seed, rule: { roster: { chance } } })
      go(g, 'd_a')
      go(g, 'd_b')
      const before = JSON.stringify(readNpcs(g.state).rosters)
      days(g, 30)
      return { before, after: JSON.stringify(readNpcs(g.state).rosters) }
    }
    const none = run(0)
    expect(none.after).toBe(none.before)
    const some = run(0.25)
    expect(some.after).not.toBe(some.before)
    expect(run(0.25)).toEqual(some)
  })

  it('契約季（旗標 city_event:contract_season）進行中機率加倍', () => {
    const run = (season: boolean) => {
      const g = make({ seed: 11, rule: { roster: { chance: 0.5, weights: { join: 1, leave: 0, move: 0, trouble: 0 } } } })
      go(g, 'd_a')
      if (season) g.commit(draft([{ op: 'flag', key: 'city_event:contract_season', value: true }], 'test.season'))
      const n0 = rosterIds(g, 'd_a').length
      days(g, 30)
      return rosterIds(g, 'd_a').length - n0
    }
    expect(run(true)).toBe(10)
    expect(run(false)).toBeLessThan(10)
    // 旗標寫 false 也當作沒有
    const g = make({ seed: 11, rule: { roster: { chance: 0.5, weights: { join: 1, leave: 0, move: 0, trouble: 0 } } } })
    go(g, 'd_a')
    g.commit(draft([{ op: 'flag', key: 'city_event:contract_season', value: false }], 'test.season'))
    const n0 = rosterIds(g, 'd_a').length
    days(g, 30)
    expect(rosterIds(g, 'd_a').length - n0).toBeLessThan(10)
  })

  it('搬走：離開名單；沒有關係的生成的人整筆丟掉；認識的人留著資料、記一則近況、帶觸發點；名冊上的人、職員、隊上的人不會被選中', () => {
    const g = make({ rule: { roster: { chance: 1, weights: { join: 0, leave: 1, move: 0, trouble: 0 } } }, content: SOLO })
    go(g, 'd_a')
    expect(rosterIds(g, 'd_a')).toEqual(['npc_bob', 'npc_clerk'])
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    days(g, 3)
    // 只有鮑勃能被選中（職員不算）
    expect(rosterIds(g, 'd_a')).toEqual(['npc_clerk'])
    expect(npcOf(g.k, g.state, 'npc_bob')).toBeDefined()
    expect(newsOf(g.state, 'npc_bob')).toMatchObject([{ what: 'left', text: '搬離了甲區。' }])
    const trig = lifeReports(g).at(-1)!.triggers
    expect(trig).toEqual([{ point: 'npc_life', where: { npc: 'npc_bob', what: 'left' } }])
    // 沒有人能選：名單不動
    days(g, 9)
    expect(rosterIds(g, 'd_a')).toEqual(['npc_clerk'])
    // 生成的、不認識的人：整筆丟掉
    const h = make({ rule: { roster: { chance: 1, weights: { join: 0, leave: 1, move: 0, trouble: 0 } } } })
    go(h, 'd_b')
    const genBefore = Object.keys(readNpcs(h.state).gen).length
    days(h, 3)
    expect(Object.keys(readNpcs(h.state).gen).length).toBe(genBefore - 1)
    expect(rosterIds(h, 'd_b')).toHaveLength(genBefore - 1)
    expect(h.state.reports.at(-1)!.triggers).toBeUndefined()
    // 隊上的人不被選中
    const buddy = makeActor({ id: 'npc_buddy', name: '夥伴', role: 'companion' })
    const p = make({ rule: { roster: { chance: 1, weights: { join: 0, leave: 1, move: 0, trouble: 0 } } }, actors: [buddy], content: (c) => { SOLO(c); c.npc = [BOB, { id: 'npc_buddy', name: '夥伴', kind: 'citizen', age: 30, home: { district: 'd_a' }, haunts: [{ district: 'd_a' }] }] } })
    go(p, 'd_a')
    days(p, 9)
    expect(rosterIds(p, 'd_a')).toEqual(['npc_buddy'])
  })

  it('搬去另一區：他的出沒地有那一區才會；名單換邊、住處改成那一區', () => {
    const g = make({ rule: { roster: { chance: 1, weights: { join: 0, leave: 0, move: 1, trouble: 0 } } }, content: (c) => { SOLO(c); c.npc = [ANN, BOB, CLERK] } })
    go(g, 'd_a')
    g.commit(meetNpc(g.k, g.state, 'npc_ann'))
    expect(rosterIds(g, 'd_a')).toEqual(['npc_ann', 'npc_bob', 'npc_clerk'])
    days(g, 3)
    // 只有安的出沒地有乙區（鮑勃沒有，不能搬）
    expect(rosterIds(g, 'd_a')).toEqual(['npc_bob', 'npc_clerk'])
    expect(rosterIds(g, 'd_b')).toContain('npc_ann')
    expect(npcOf(g.k, g.state, 'npc_ann')!.home.district).toBe('d_b')
    expect(newsOf(g.state, 'npc_ann')).toMatchObject([{ what: 'moved', text: '搬到了乙區。' }])
    // 之後走進乙區建名單時，安只會出現一次
    go(g, 'd_b')
    expect(rosterIds(g, 'd_b').filter((id) => id === 'npc_ann')).toHaveLength(1)
  })

  it('被捕或死：預設「認識的人不會因為汰換而死」開著，認識的人只會被捕；關掉之後會死', () => {
    const trouble = { roster: { chance: 1, weights: { join: 0, leave: 0, move: 0, trouble: 1 }, die_share: 1, risky: {} } }
    // 開著（預設）：被捕
    const g = make({ rule: trouble, content: SOLO })
    go(g, 'd_a')
    g.commit(meetNpc(g.k, g.state, 'npc_bob'))
    days(g, 3)
    expect(cond(g, 'npc_bob', 'arrested')).toEqual({ id: 'arrested' })
    expect(rosterIds(g, 'd_a')).toContain('npc_bob')
    expect(newsOf(g.state, 'npc_bob')).toMatchObject([{ what: 'arrested' }])
    expect(lifeReports(g).at(-1)!.triggers).toEqual([{ point: 'npc_life', where: { npc: 'npc_bob', what: 'arrested' } }])
    days(g, 30)
    // 已經被捕的不會再被選為出事（名單裡沒有別人能選）
    expect(newsOf(g.state, 'npc_bob')).toHaveLength(1)
    expect(npcOf(g.k, g.state, 'npc_bob')!.flags).not.toContain('dead')
    // 設定關掉（旗標 npcs:protect_known 寫 false）：認識的人會死
    const h = make({ rule: trouble, content: SOLO })
    go(h, 'd_a')
    h.commit(meetNpc(h.k, h.state, 'npc_bob'))
    h.commit(draft([{ op: 'flag', key: PROTECT_FLAG, value: false }], 'test.setting'))
    days(h, 3)
    expect(rosterIds(h, 'd_a')).toEqual(['npc_clerk'])
    expect(npcOf(h.k, h.state, 'npc_bob')!.flags).toContain('dead')
    expect(newsOf(h.state, 'npc_bob')).toMatchObject([{ what: 'died', text: '死了。' }])
    expect(lifeReports(h).at(-1)!.triggers).toEqual([{ point: 'npc_life', where: { npc: 'npc_bob', what: 'died' } }])
    // 規則的預設關掉（protect_known: false）也一樣；旗標寫 true 又蓋回去
    const i = make({ rule: { roster: { ...trouble.roster, protect_known: false } }, content: SOLO })
    go(i, 'd_a')
    i.commit(meetNpc(i.k, i.state, 'npc_bob'))
    days(i, 3)
    expect(npcOf(i.k, i.state, 'npc_bob')!.flags).toContain('dead')
    const j = make({ rule: { roster: { ...trouble.roster, protect_known: false } }, content: SOLO })
    go(j, 'd_a')
    j.commit(meetNpc(j.k, j.state, 'npc_bob'))
    j.commit(draft([{ op: 'flag', key: PROTECT_FLAG, value: true }], 'test.setting'))
    days(j, 3)
    expect(cond(j, 'npc_bob', 'arrested')).toBeDefined()
  })

  it('不認識的人會死（沒有保護）：整筆丟掉，沒有近況與觸發點；舊港、鏽帶、地下層出事的權重較高', () => {
    const g = make({ rule: { roster: { chance: 1, weights: { join: 0, leave: 0, move: 0, trouble: 1 }, die_share: 1, risky: {} } }, content: SOLO })
    go(g, 'd_a')
    days(g, 3)
    expect(rosterIds(g, 'd_a')).toEqual(['npc_clerk'])
    expect(npcOf(g.k, g.state, 'npc_bob')!.flags).toContain('dead')
    expect(Object.keys(readNpcs(g.state).news ?? {})).toEqual([])
    expect(lifeReports(g).at(-1)!.triggers).toBeUndefined()
    // 權重：預設舊港、鏽帶、地下層出事的權重是 2 倍
    expect(DEFAULT_LIFE_RULES.roster.risky).toEqual({ oldport: 2, rustbelt: 2, underground: 2 })
    // 這一區的倍數照規則乘在出事的權重上：0 就永遠不出事，很大就幾乎每次都出事
    const run = (risky: Record<string, number>) => {
      const h = make({ seed: 5, rule: { roster: { chance: 1, weights: { join: 0, leave: 1, move: 0, trouble: 1 }, die_share: 0, risky } } })
      go(h, 'd_a')
      days(h, 30)
      return Object.values(h.state.actors).filter((a) => a.conditions.some((c) => c.id === 'arrested')).length
    }
    expect(run({ d_a: 0 })).toBe(0)
    expect(run({ d_a: 1000 })).toBeGreaterThan(0)
  })

  it('名單變動的報告：只有變動沒有認識的人時，句子寫幾處；這份報告不記進共同記憶', () => {
    const g = make({ rule: { roster: { chance: 1, weights: { join: 1, leave: 0, move: 0, trouble: 0 } } } })
    go(g, 'd_a')
    days(g, 3)
    const r = lifeReports(g).at(-1)!
    expect(r.outcome.summary).toBe('這幾天名單有 1 處變動。')
    expect(memories(g)).toEqual([])
  })
})

// ---- 不變式與外殼 ----

describe('不變式與外殼', () => {
  it('一整段日子走下來，每一步都守得住不變式（嚴格模式、探針）；存檔往返一樣', async () => {
    const wild = { life: { job: { chance: 0.5, promote_chance: 0.5 }, injured: { chance: 0.3 }, arrest: { base: 0.1 }, debt: { chance: 0.3 }, sink: { chance: 0.5 }, implant: { chance: 0.3 } }, roster: { chance: 0.7 } }
    const g = make({ seed: 3, rule: wild, features: [STUBS, HOSTILITY, directorFeature, eventRunFeature, npcsFeature] })
    go(g, 'd_a')
    go(g, 'd_b')
    watch(g, 'npc_ann')
    const { violations } = await observed(g, () => {
      for (let i = 0; i < 12; i++) {
        g.commit(draft([], 'free', { timeline: checked(), outcome: { result: 'success', summary: `第 ${i} 次。` } }))
        days(g, 5)
      }
    })
    expect(violations).toEqual([])
    expect(lifeReports(g).length).toBeGreaterThan(0)
    const raw = g.save()
    const g2 = make({ seed: 3, rule: wild, features: [STUBS, HOSTILITY, directorFeature, eventRunFeature, npcsFeature] })
    expect(g2.load(raw)).toBeNull()
    expect(readNpcs(g2.state)).toEqual(readNpcs(g.state))
    expect(memoriesOf(g2.state)).toEqual(memoriesOf(g.state))
  })

  it('沒有 npc_life_rule 這筆內容時照內建的數字；內建的數字照規格', () => {
    const g = make({ rule: null })
    expect(lifeRules(g.k)).toEqual(DEFAULT_LIFE_RULES)
    expect(DEFAULT_LIFE_RULES.memory).toMatchObject({ limit: 200, recent: 50, bucket_days: 10, recall: 6, score: { pinned: 10, shared: 3, place: 2, within3: 1.5, within10: 0.75 } })
    expect(DEFAULT_LIFE_RULES.life).toMatchObject({ every_days: 3, max_catchup: 10, min_affinity: 30 })
  })
})

function clone<T>(v: T): T {
  return structuredClone(v)
}
