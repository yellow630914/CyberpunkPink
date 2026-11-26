// 驗收測試：dev/work/M5-opinion-desk.md（cpp-feature）。輿論戰接上別的功能的那一半：誰坐編輯台與編輯點、三個掛點（招、被動、開場）與它們的封閉清單、
// 素材與片進牌庫、豔名與公信力、戰役的後果、自己發起、事件的指示 start；以及 M5-opinion 留下的三個鍵（capture_when、cred_def、first_capture 與鏡像對手的六個行動）。
// 規格：OPINION 第 1、2 節、4.3a、4.3b、4.3c、第 7、8、9 節；MEDIA 4.5～4.7；dev/adr/0020 第五節、第十三節、V33、V34、V40、V41、「M4 對帳」D8。
// 測試裝真的 media 與 opinion；其餘用測試自帶的最小假資料：替身的量表（訂閱、公信力、人氣、敵對值、豔名）、
// 替身的被動來源（義體、藥、沉溺、傷勢給的編輯點）、替身回答三個掛點（opinion.moves、.passives、.open；內容由測試改 ANS）、帶路數的夥伴。
// 骰子：d20 從種子、游標、用途導出；要固定結果就掃游標找到想要的那一顆（草稿是純函式，不改狀態）。城市事件全部換成「沒事」，免得它動聲量。

import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Kernel, Origin, ReportDraft } from '../../src'
import { ActionBlocked, meterOf } from '../../src'
import { chooseOption, directorFeature, eventRunFeature } from '../../src/features/director'
import { mediaFeature, readMedia } from '../../src/features/media'
import type { FootageInit } from '../../src/features/media/ops'
import {
  DEFAULT_OPINION_RULES, OPINION_CELLS, OP_EFFECTS, OP_MODS, OP_TRIGGERS, bringOptions, capture, concede, deskOptions, endTurn, opinionFeature, opinionView, playCard, readWar, settle, startWar, useMove,
  defenseOf, movesView, opinionRules, moveBlock,
} from '../../src/features/opinion'
import type { Cell, OpMove, OpOpen, OpPassive, War } from '../../src/features/opinion'
import { makeActor, makeGame, METER_CONTENT } from '../../src/testkit'

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

type Rec = Record<string, any>

/** 替身回答的三個掛點：內容由每個測試改。 */
const ANS: { moves: OpMove[]; passives: OpPassive[]; open: OpOpen[] } = { moves: [], passives: [], open: [] }
const answers: Feature = {
  id: 'desk_answers',
  install(k: Kernel) {
    k.hooks.on('opinion.moves', 'desk_answers', () => ANS.moves)
    k.hooks.on('opinion.passives', 'desk_answers', () => ANS.passives)
    k.hooks.on('opinion.open', 'desk_answers', () => ANS.open)
  },
}

/** 替身：量表與被動來源。義體（cyber）、藥（drug）、沉溺（sink）、傷勢（wound）各自從角色 ext 的 cy、dr、sk、wd 給一筆 ep_bonus；開場手牌 oh 從藥給。 */
const toy: Feature = {
  id: 'desk_toy',
  install(k: Kernel) {
    k.content.defineKind({ kind: 'district', owner: 'desk_toy', validate: () => [] })
    for (const [kind, def] of [
      ['subs', { name: '訂閱', min: 0, max: Infinity, start: 0, keyed: 'none' }],
      ['credibility', { name: '公信力', min: 0, max: 100, start: 50, keyed: 'none' }],
      ['popularity', { name: '人氣', min: 0, max: 100, start: 0, keyed: 'npc' }],
      ['hostility', { name: '敵對值', min: 0, max: 100, start: 0, keyed: 'faction' }],
      ['fame', { name: '豔名', min: 0, max: 100, start: 0, keyed: 'district' }],
    ] as Array<[string, Rec]>) k.meters.define({ kind, owner: 'desk_toy', ...def } as never)
    for (const [source, key] of [['cyber', 'cy'], ['drug', 'dr'], ['sink', 'sk'], ['wound', 'wd']] as const) {
      k.passives.register('desk_toy', source, (s, a) => {
        const v = s.actors[a]?.ext[key]
        return typeof v === 'number' ? [{ stat: 'ep_bonus', amount: v }] : []
      })
    }
    k.passives.register('desk_toy', 'drug', (s, a) => {
      const v = s.actors[a]?.ext.oh
      return typeof v === 'number' ? [{ stat: 'open_hand_bonus', amount: v }] : []
    })
  },
}

const SC: Record<string, number> = { kaleido: 3, sakura: 2, nightingale: 1, tape: 1, doujin: 1, fanclub: 1, whisper: 1, wall: 1, relay: 0 }
const INV = { factions: ['f_alpha'], people: ['npc_ann'], types: ['scandal'] }
const CITY_NONE = ['city_scandal', 'city_festival', 'city_algo', 'city_graduation', 'city_blackout', 'city_quiet'].map((id) => ({ id, name: id, effect: { kind: 'none' } }))
const act = (...rows: Array<[string, string]>) => rows.map(([d, when]) => ({ do: d, when }))

const PACK = (extra: Rec = {}): ContentPack => ({
  id: 'desk_test',
  content: {
    city_card: CITY_NONE,
    topic: [
      { id: 'tp_ignite', name: '測試引爆', kind: 'ignite', scores: SC, involves: INV },
      { id: 'tp_douse', name: '測試滅火', kind: 'douse', scores: SC, involves: INV },
      { id: 'tp_end', name: '帶後果的議題', kind: 'ignite', scores: SC, involves: INV, on_end: { lost: [{ kind: 'flag', key: 'op_lost', value: true }], major: [{ kind: 'flag', key: 'op_major', value: true }] } },
    ],
    pr_opponent: [
      { id: 'pr_1', name: '小公司的公關', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'always']) },
      { id: 'pr_3', name: '貝塔的公關', faction: 'f_beta', strength: 3, start: 'opposite', cell_priority: {}, actions: act(['release', 'always']) },
      { id: 'pr_hunt', name: '專搶耳語的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: { whisper: 20, wall: 20 }, actions: act(['release', 'always']) },
      { id: 'pr_idle', name: '不動的對手', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']) },
      { id: 'pr_deny', name: '愛否認的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['deny', 'always']) },
      { id: 'pr_counter', name: '愛反爆料的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['counter', 'always']) },
      { id: 'pr_mute', name: '愛降流的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['mute', 'always']) },
      { id: 'pr_law', name: '愛寄律師函的', faction: 'f_alpha', strength: 2, start: 'opposite', cell_priority: {}, actions: act(['lawyer', 'always']) },
      { id: 'pr_rel2', name: '愛發稿的', faction: 'f_alpha', strength: 2, start: 'opposite', cell_priority: {}, actions: act(['release', 'always'], ['release', 'always'], ['release', 'always'], ['release', 'always']) },
      { id: 'pr_f_alpha', name: '阿爾法的公關', faction: 'f_alpha', strength: 2, start: 'opposite', cell_priority: {}, actions: act(['release', 'always']) },
    ],
    ...extra,
  },
} as unknown as ContentPack)

const idolPath = (tier: number) => [{ path: 'idol', slot: 'main', tier }]
const COMPANIONS = [
  makeActor({ id: 'bud', name: '夥伴', role: 'companion', ext: {} }),
  makeActor({ id: 's1', name: '主播一階', role: 'companion', ext: { paths: [{ path: 'streamer', slot: 'main', tier: 1 }] } }),
  makeActor({ id: 's2', name: '主播二階', role: 'companion', ext: { paths: [{ path: 'streamer', slot: 'main', tier: 2 }] } }),
  makeActor({ id: 's3', name: '主播三階', role: 'companion', ext: { paths: [{ path: 'streamer', slot: 'main', tier: 3 }] } }),
  makeActor({ id: 'i1', name: '偶像一階', role: 'companion', ext: { paths: idolPath(1) } }),
  makeActor({ id: 'i2', name: '偶像二階', role: 'companion', ext: { paths: idolPath(2) } }),
  makeActor({ id: 'i3', name: '偶像三階', role: 'companion', ext: { paths: idolPath(3) } }),
  makeActor({ id: 'c3', name: '名媛三階', role: 'companion', ext: { paths: [{ path: 'socialite', slot: 'main', tier: 3 }] } }),
  makeActor({ id: 'b3', name: '掮客三階', role: 'companion', ext: { paths: [{ path: 'fixer', slot: 'main', tier: 3 }] } }),
  makeActor({ id: 'stay', name: '留守的人', role: 'npc', ext: {} }),
]

interface Opts {
  seed?: number
  noMedia?: boolean
  packs?: ContentPack[]
  extra?: Rec
  pc?: Rec
  features?: Feature[]
}

const make = (o: Opts = {}) => {
  ANS.moves = []
  ANS.passives = []
  ANS.open = []
  const { game } = makeGame({
    features: [toy, ...(o.noMedia ? [] : [mediaFeature]), opinionFeature, answers, ...(o.features ?? [])],
    content: [METER_CONTENT, { id: 'desk_district', content: { district: [{ id: 'd_a', name: '甲區' }], faction: [{ id: 'f_g4', name: '四級公司', short: '四級', class: 'corp', grade: 'IV' }, { id: 'f_g5', name: '五級幫', short: '五級', class: 'street', grade: 5 }] } } as unknown as ContentPack, PACK(o.extra), ...(o.packs ?? [])],
    seed: o.seed ?? 7, actors: COMPANIONS, ...(o.pc ? { pc: o.pc } : {}),
    patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' } } as Partial<GameState>,
  })
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: Change[], action = 'test.give'): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const setMeter = (g: G, kind: string, value: number, key = '_'): void => { give(g, [{ op: 'meter', kind, key, set: value } as Change]) }
const meter = (g: G, kind: string, key = '_'): number => meterOf(g.k, g.state, kind, key)
/** 戰役進行中改量表（報告被活動擋住）：直接改狀態。 */
const setMeterRaw = (g: G, kind: string, value: number, key = '_'): void => { ((g.state.meters as Rec)[kind] ??= {})[key] = value }
const W = (g: G): War => (g.state.ext.opinion as { war: War }).war
const begin = (g: G, setup: Rec = {}) => g.launch('opinion', { topic: 'tp_ignite', foe: 'pr_1', ...setup })
const play = (g: G, index: number, extra: Rec = {}) => g.commit(playCard(g.k, g.state, { index, ...extra }))
const cap = (g: G, cell: string) => g.commit(capture(g.k, g.state, { cell }))
const turn = (g: G, input: Rec = {}) => g.commit(endTurn(g.k, g.state, input))
const mv = (g: G, id: string, input: Rec = {}) => g.commit(useMove(g.k, g.state, { id, ...input }))
const reason = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const setCells = (g: G, you: Cell[], foe: Cell[]): void => {
  for (const c of OPINION_CELLS) W(g).cells[c] = { owner: you.includes(c) ? 'you' : foe.includes(c) ? 'foe' : null }
}
const beats = (d: { timeline: Array<{ tag?: string; data?: unknown }> }, tag: string) => d.timeline.filter((b) => b.tag === tag)

const passive = (id: string, o: Rec = {}): OpPassive => ({ id, owner: 'test', name: `被動${id}`, ...o }) as OpPassive
const move = (id: string, effects: Rec[], o: Rec = {}): OpMove => ({ id, owner: 'test', actor: 'pc', name: `招${id}`, cost: 1, effects, ...o }) as OpMove

/** 掃游標，找到讓 pick 成立的那一個（草稿不改狀態）。 */
function scanCursor(g: G, build: () => ReportDraft, pick: (d: ReportDraft) => boolean, max = 800): ReportDraft {
  const keep = g.state.rng.cursor
  for (let c = 0; c < max; c++) {
    g.state.rng.cursor = c
    const d = build()
    if (pick(d)) return d
  }
  g.state.rng.cursor = keep
  throw new Error('掃不到想要的骰面')
}

const ft = (o: Partial<FootageInit> = {}): FootageInit => ({
  title: '素材', text: '一段素材。', type: 'scandal', quality: 3, authentic: 'real', exclusive: true, involves: { factions: ['f_alpha'], people: [] }, uses: 3, made_at: 0, origin: 'own',
  celebrity: false, self: false, adult: false, ...o,
})
const addFootage = (g: G, o: Partial<FootageInit> = {}): string => {
  give(g, [{ op: 'media.make', footage: ft({ made_at: 1, ...o }) } as Change])
  return Object.keys(readMedia(g.state).footage).at(-1)!
}
const addClip = (g: G, o: Rec = {}): string => {
  give(g, [{
    op: 'media.clip',
    clip: {
      from: ['ft0'], angle: 'documentary', title: '片', intro: '', quality: 3, types: ['scandal'], involves: { factions: ['f_alpha'], people: [] }, celebrity: false, self: false, adult: false, forged: false,
      exclusive: false, draw: 3, trust: 3, risk: 1, uses: 3, card: null, made_at: 1, ...o,
    },
  } as Change])
  return Object.keys(readMedia(g.state).clips).at(-1)!
}
const usesOf = (g: G, ref: string): number => (readMedia(g.state).footage[ref] ?? readMedia(g.state).clips[ref])!.uses

// ===================================================================================================================
describe('編輯台：誰坐、編輯點（OPINION 4.3b、V40）', () => {
  it('主播 1、2、3 階是 3、3、4；偶像同；名媛與掮客 3 階是 3；沒有路數是 2', () => {
    const g = make()
    const ep = Object.fromEntries(deskOptions(g.k, g.state).map((o) => [o.actor, o.ep]))
    expect(ep).toMatchObject({ pc: 2, s1: 3, s2: 3, s3: 4, i1: 3, i2: 3, i3: 4, c3: 3, b3: 3, bud: 2 })
    // 不是隊伍裡的人（留守的）不能坐
    expect(ep.stay).toBeUndefined()
    expect(reason(() => begin(g, { desk: ['stay'] }))).toContain('不在你的隊伍')
    begin(g, { desk: ['s3'] })
    expect(W(g).desk).toEqual([{ actor: 's3', ep: 4, ep_max: 4 }])
  })

  it('每個座位的算式一筆一筆列出來（基礎、路數、被動、義體與藥）', () => {
    const g = make()
    const s3 = deskOptions(g.k, g.state).find((o) => o.actor === 's3')!
    expect(s3.parts.map((p) => p.value)).toEqual([2, 2])
    expect(s3.parts[1]!.label).toContain('streamer')
  })

  it('被動 ep +1 之後各多 1（寫了 actor 的算那個人；沒寫的是整張編輯台的，加在第一個座位）；ep_cap 夾在 +3 以內', () => {
    const g = make()
    ANS.passives = [passive('p1', { actor: 's1', mods: [{ kind: 'ep', amount: 1 }] }), passive('p2', { actor: 'pc', mods: [{ kind: 'ep', amount: 1 }] })]
    const ep = Object.fromEntries(deskOptions(g.k, g.state).map((o) => [o.actor, o.ep]))
    expect(ep).toMatchObject({ pc: 3, s1: 4, s2: 3 })
    ANS.passives = [passive('staff', { mods: [{ kind: 'ep', amount: 1 }] }), passive('cap', { actor: 'pc', mods: [{ kind: 'ep_cap', amount: 3 }] }), passive('cap2', { actor: 'pc', mods: [{ kind: 'ep_cap', amount: 3 }] })]
    begin(g, { desk: ['pc', 'bud'] })
    // 主角：基礎 2 ＋ 製作 1 ＋ ep_cap（3 + 3 夾在 3）；夥伴沒有加
    expect(W(g).desk.map((s) => [s.actor, s.ep])).toEqual([['pc', 6], ['bud', 2]])
    // 沒有 actor 的被動只算一次；坐在編輯台外的人的被動不算
    ANS.passives = [passive('out', { actor: 's3', mods: [{ kind: 'ep', amount: 3 }] })]
    const g2 = make()
    ANS.passives = [passive('out', { actor: 's3', mods: [{ kind: 'ep', amount: 3 }] })]
    begin(g2)
    expect(W(g2).desk[0]!.ep).toBe(2)
  })

  it('兩個人各有各的池：一張 2 點的牌不能兩人各付 1；setup 自己給的 ep 優先', () => {
    const g = make()
    begin(g, { desk: [{ actor: 'pc', ep: 1 }, { actor: 'bud', ep: 1 }] })
    W(g).hand = ['card_boost']
    expect(opinionView(g.k, g.state).active && (opinionView(g.k, g.state) as { hand: Array<{ reason: string | null }> }).hand[0]!.reason).toContain('編輯點不夠')
    expect(reason(() => playCard(g.k, g.state, { index: 0 }))).toContain('一張牌由一個人付')
    W(g).desk[1]!.ep = 2
    const [r] = play(g, 0, { actor: 'bud' })
    expect(r!.timeline.find((b) => b.tag === 'opinion.play')!.data).toMatchObject({ seat: 'bud', cost: 2 })
    expect(W(g).desk.map((s) => s.ep)).toEqual([1, 0])
    expect(reason(() => begin(make(), { desk: ['pc', 'bud', 's1'] }))).toContain('最多坐兩個人')
  })
})

// ===================================================================================================================
describe('義體、藥、裝備給的編輯點（ep_bonus；M4 對帳 D8）與開場手牌（open_hand_bonus）', () => {
  const epOf = (g: G): number => { begin(g); return W(g).desk[0]!.ep }
  const set = (g: G, ext: Rec) => { for (const [key, value] of Object.entries(ext)) give(g, [{ op: 'actor.ext', id: 'pc', key, value } as Change]) }

  it('義體與藥各給一筆 +1：合計最多算 +1（編輯點只多 1）', () => {
    const g = make()
    set(g, { cy: 1, dr: 1 })
    expect(epOf(g)).toBe(3)
  })

  it('再由掛點的替身回一筆被動 ep +1：一共多 2（技能、編制不限）', () => {
    const g = make()
    set(g, { cy: 1, dr: 1 })
    ANS.passives = [passive('p', { actor: 'pc', mods: [{ kind: 'ep', amount: 1 }] })]
    expect(epOf(g)).toBe(4)
  })

  it('來源 sink（不在 TEMPO_SOURCES）的 +1 照算；負的照扣；基礎那一筆不重複算', () => {
    const g = make()
    set(g, { cy: 1, dr: 1, sk: 1 })
    expect(epOf(g)).toBe(4)
    const g2 = make()
    set(g2, { cy: 1, wd: -1 })
    expect(epOf(g2)).toBe(2)
    expect(deskOptions(g2.k, g2.state).find((o) => o.actor === 'pc')!.parts.map((p) => p.value)).toEqual([2])
  })

  it('開場手牌：open_hand_bonus 是 1 的人坐編輯台，開場多抽一張（不超過手牌上限）', () => {
    const rule = { opinion_rule: [{ id: 'default', hand_max: 8 }] }
    const plain = make({ extra: rule })
    const [r0] = begin(plain)
    const a = make({ extra: rule })
    give(a, [{ op: 'actor.ext', id: 'pc', key: 'oh', value: 1 } as Change])
    const [r1] = begin(a)
    const drawn = (d: { timeline: Array<{ tag?: string; data?: unknown }> }) => (beats(d, 'opinion.draw')[0]!.data as { cards: string[] }).cards.length
    expect(drawn(r1!)).toBe(drawn(r0!) + 1)
    expect(W(a).hand.length).toBe(W(plain).hand.length + 1)
    // 手牌上限照舊夾（預設 5）
    const b = make()
    give(b, [{ op: 'actor.ext', id: 'pc', key: 'oh', value: 3 } as Change])
    begin(b)
    expect(W(b).hand.length).toBe(5)
  })
})

// ===================================================================================================================
describe('素材與片進牌庫（OPINION 4.3a；V33）', () => {
  const alpha = { factions: ['f_alpha'], people: [] }
  const beta = { factions: ['f_beta'], people: [] }

  it('揭弊的片（可信 7）是風向 2、花 2 點的說法；煽情的片（看點 5）是聲量 3、花 2 點的料；日常的進不了並有原因；娛樂的是燃料', () => {
    const g = make()
    const expose = addClip(g, { angle: 'expose', title: '揭弊片', trust: 7, card: { kind: 'line', value: 7 } })
    const sens = addClip(g, { angle: 'sensational', title: '煽情片', draw: 5, card: { kind: 'fuel', value: 5 } })
    const daily = addClip(g, { angle: 'daily', title: '日常片', card: null })
    const fun = addClip(g, { angle: 'fun', title: '娛樂片', card: { kind: 'decoy', value: 0 } })
    const topic = { involves: INV }
    const opt = Object.fromEntries(bringOptions(g.k, g.state, topic).map((o) => [o.ref, o]))
    expect(opt[expose]).toMatchObject({ relation: 'full', can: true, card: { kind: 'line', wind: 2, cost: 2, fake: false } })
    expect(opt[sens]).toMatchObject({ relation: 'full', can: true, card: { kind: 'fuel', voice: 3, cost: 2 } })
    expect(opt[daily]).toMatchObject({ can: false, card: null })
    expect(opt[daily]!.why).toContain('日常')
    expect(opt[fun]).toMatchObject({ can: true, card: { kind: 'means', decoy: true } })
    expect(reason(() => begin(g, { bring: [daily] }))).toContain('日常')
    // 帶進去：每一件少一次、牌在牌庫裡（custom）、報告的變更有 media.use
    const [r] = begin(g, { bring: [expose, sens, fun] })
    expect([expose, sens, fun].map((x) => usesOf(g, x))).toEqual([2, 2, 2])
    expect(usesOf(g, daily)).toBe(3)
    expect(W(g).brought.map((b) => b.ref)).toEqual([expose, sens, fun])
    expect(Object.values(W(g).custom!).map((c) => c.kind).sort()).toEqual(['fuel', 'line', 'means'])
    expect(r!.changes.filter((c) => c.op === 'media.use')).toHaveLength(3)
    expect(W(g).deck.length + W(g).hand.length).toBe(9 + 3)
  })

  it('只有類型相同的減半進位；完全無關的只能當轉移焦點的燃料；拍到議題的人也算全額；不剪的素材是料', () => {
    const g = make()
    const same = addClip(g, { angle: 'sensational', involves: beta, draw: 5, types: ['scandal'], card: { kind: 'fuel', value: 5 } })
    const none = addClip(g, { angle: 'expose', involves: beta, types: ['battle'], trust: 7, card: { kind: 'line', value: 7 } })
    const person = addClip(g, { angle: 'sensational', involves: { factions: ['f_beta'], people: ['npc_ann'] }, draw: 5, types: ['battle'], card: { kind: 'fuel', value: 5 } })
    const raw = addFootage(g, { involves: alpha, quality: 3 })
    const opt = Object.fromEntries(bringOptions(g.k, g.state, { involves: INV }).map((o) => [o.ref, o]))
    expect(opt[same]).toMatchObject({ relation: 'half', card: { kind: 'fuel', voice: 2, cost: 1 } })
    expect(opt[none]).toMatchObject({ relation: 'none', card: { kind: 'means', decoy: true } })
    expect(opt[person]).toMatchObject({ relation: 'full', card: { voice: 3 } })
    expect(opt[raw]).toMatchObject({ relation: 'full', card: { kind: 'fuel', voice: 2, cost: 1 } })
  })

  it('開戰不成立時次數不變；同一件不能帶兩次；超過上限、沒有這件料都擋；沒有素材庫（沒裝 media）bringOptions 是空的、基本牌照樣打得完', () => {
    const g = make()
    const a = addFootage(g)
    expect(reason(() => begin(g, { bring: [a], foe: 'pr_gone' }))).toContain('找不到對手')
    expect(usesOf(g, a)).toBe(3)
    expect(g.state.ext.opinion).toBeUndefined()
    expect(reason(() => begin(g, { bring: [a, a] }))).toContain('不能帶兩次')
    expect(reason(() => begin(g, { bring: ['ft99'] }))).toContain('沒有「ft99」')
    const many = Array.from({ length: 7 }, () => addFootage(g))
    expect(reason(() => begin(g, { bring: many }))).toContain('最多帶 6 件')
    const bare = make({ noMedia: true })
    expect(bringOptions(bare.k, bare.state, { involves: INV })).toEqual([])
    expect(reason(() => begin(bare, { bring: ['ft1'] }))).toContain('沒有素材庫')
    begin(bare)
    setCells(bare, ['kaleido'], ['relay'])
    W(bare).voice.you = 5
    expect(W(bare).brought).toEqual([])
    for (let i = 0; i < 6; i++) {
      if (readWar(bare.state)!.turn === 'ended') break
      turn(bare)
    }
    expect(readWar(bare.state)!.turn).toBe('ended')
    bare.commit(settle(bare.k, bare.state))
    expect(bare.state.ext.opinion).toBeUndefined()
  })
})

// ===================================================================================================================
describe('假料（V33）', () => {
  it('沒有 forged_ok 進不了；有的話牌面 +1（假的偽造素材：聲量 2 → 3）；打出去擲 d20，6 以下被拆穿：無效、風向 −2、公信力 −8', () => {
    const g = make()
    const forged = addFootage(g, { authentic: 'forged', quality: 3, involves: { factions: ['f_alpha'], people: [] } })
    const o1 = bringOptions(g.k, g.state, { involves: INV }).find((o) => o.ref === forged)!
    expect(o1).toMatchObject({ can: false })
    expect(o1.why).toContain('假料')
    expect(reason(() => begin(g, { bring: [forged] }))).toContain('假料')
    ANS.passives = [passive('fk', { actor: 'pc', mods: [{ kind: 'forged_ok' }] })]
    const o2 = bringOptions(g.k, g.state, { involves: INV }).find((o) => o.ref === forged)!
    expect(o2).toMatchObject({ can: true, card: { kind: 'fuel', fake: true, voice: 3 } })
    begin(g, { bring: [forged] })
    expect(usesOf(g, forged)).toBe(2)
    const id = W(g).brought[0]!.card
    W(g).hand = [id]
    W(g).voice.you = 0
    // 固定骰子擲 6：被拆穿
    const d = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (x) => (beats(x, 'opinion.roll')[0]!.data as { roll: number }).roll === 6)
    expect(d.outcome.result).toBe('busted')
    g.commit(d)
    expect(W(g).voice.you).toBe(0)
    expect(W(g).wind).toBe(-2)
    expect(d.changes).toContainEqual({ op: 'meter', kind: 'credibility', key: '_', delta: -8 })
    expect(meter(g, 'credibility')).toBe(42)
    // 擲 7：沒被拆穿，聲量 +3
    W(g).hand = [id]
    const ok = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (x) => (beats(x, 'opinion.roll')[0]!.data as { roll: number }).roll === 7)
    g.commit(ok)
    expect(W(g).voice.you).toBe(3)
  })

  it('抹黑的片也是假料；偽造的紀實片（說法）牌面 +1，被拆穿時說法的風向收回', () => {
    const g = make()
    const smear = addClip(g, { angle: 'smear', forged: true, title: '抹黑', draw: 4, card: { kind: 'fuel', value: 4 } })
    const doc = addClip(g, { angle: 'documentary', forged: true, title: '假紀實', trust: 6, card: { kind: 'line', value: 6 } })
    ANS.passives = [passive('fk', { actor: 'pc', mods: [{ kind: 'forged_ok' }] })]
    const opt = Object.fromEntries(bringOptions(g.k, g.state, { involves: INV }).map((o) => [o.ref, o]))
    expect(opt[smear]!.card).toMatchObject({ fake: true, voice: 3 })
    expect(opt[doc]!.card).toMatchObject({ fake: true, wind: 3, cost: 2 })
    begin(g, { bring: [doc] })
    W(g).hand = [W(g).brought[0]!.card]
    W(g).wind = 0
    const d = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (x) => (beats(x, 'opinion.roll')[0]!.data as { roll: number }).roll <= 6)
    g.commit(d)
    expect(W(g).wind).toBe(-2)
  })
})

// ===================================================================================================================
describe('公信力與豔名（OPINION 1、4.3c）', () => {
  const lineWind = (g: G): number => {
    W(g).hand = ['card_wind']
    const d = playCard(g.k, g.state, { index: 0 })
    return (beats(d, 'opinion.play')[0]!.data as { wind: number }).wind
  }

  it('公信力 60 以上每張說法 +1，低於 30 −1（最少 0）；沒有人定義 credibility 當 50', () => {
    const g = make()
    begin(g)
    expect(lineWind(g)).toBe(1)
    setMeterRaw(g, 'credibility', 60)
    expect(lineWind(g)).toBe(2)
    setMeterRaw(g, 'credibility', 29)
    expect(lineWind(g)).toBe(0)
    const bare = makeGame({ features: [opinionFeature, answers], content: [METER_CONTENT, PACK()], seed: 7, patch: { time: { day: 3, hour: 10, minute: 0 } } }).game
    bare.launch('opinion', { topic: 'tp_ignite', foe: 'pr_1' })
    expect(lineWind(bare as unknown as G)).toBe(1)
  })

  it('豔名 30、60、90 對看臉三格（帶子街、應援圈、夜鶯直播）的防守：每 30 點 −1、最多 −2、最少 0；其餘的格子不變', () => {
    const need = (fame: number, cell: Cell, own: Cell[] = ['whisper'], foe: Cell[] = []): number => {
      const g = make()
      if (fame > 0) setMeter(g, 'fame', fame, 'd_a')
      begin(g)
      setCells(g, own, foe)
      return defenseOf(W(g), cell, 'you', opinionRules(g.k))
    }
    expect([0, 29, 30, 59, 60, 90].map((f) => need(f, 'tape'))).toEqual([2, 2, 1, 1, 0, 0])
    expect(need(60, 'fanclub')).toBe(0)
    expect(need(60, 'nightingale')).toBe(0)
    expect(need(90, 'wall')).toBe(2)
    // 對手的格子：3 − 風向 − 豔名；最少 0
    expect(need(30, 'fanclub', ['nightingale'], ['fanclub'])).toBe(2)
    expect(need(90, 'fanclub', ['nightingale'], ['fanclub'])).toBe(1)
    // 取各區裡最高的那一區
    const g = make()
    setMeter(g, 'fame', 10, 'd_a')
    begin(g)
    expect(W(g).fame).toBe(10)
  })

  it('豔名 60 以上，對手的反爆料多推 1 風向；不到就照舊', () => {
    const windAfter = (fame: number): number => {
      const g = make()
      if (fame > 0) setMeter(g, 'fame', fame, 'd_a')
      begin(g, { foe: 'pr_counter' })
      turn(g)
      return W(g).wind
    }
    expect(windAfter(0)).toBe(-2)
    expect(windAfter(59)).toBe(-2)
    expect(windAfter(60)).toBe(-3)
  })
})

// ===================================================================================================================
describe('三個掛點與封閉清單：每一種效果一個最小的例子', () => {
  const start = (g: G, setup: Rec = {}) => { begin(g, setup); W(g).voice.you = 0 }

  it('voice、foe_voice、wind、draw（再棄）：一招一個人付；次數用完擋下；效果的鍵固定', () => {
    const g = make()
    ANS.moves = [move('m1', [{ kind: 'voice', amount: 3 }, { kind: 'foe_voice', amount: -1 }, { kind: 'wind', amount: 2 }], { limit: { per: 'turn', n: 1 } })]
    start(g)
    W(g).voice.foe = 4
    const [r] = mv(g, 'm1')
    expect(r!.action).toBe('opinion.move')
    expect([W(g).voice.you, W(g).voice.foe, W(g).wind, W(g).desk[0]!.ep]).toEqual([3, 3, 2, 1])
    expect(reason(() => moveBlock(g.k, g.state, { id: 'm1' }) && mv(g, 'm1'))).toContain('次數用完')
    expect(reason(() => mv(g, 'nope'))).toContain('沒有這一招')
    // 下一回合又能用
    turn(g)
    expect(moveBlock(g.k, g.state, { id: 'm1' })).toBeNull()
    expect(Object.keys(OP_EFFECTS)).toHaveLength(19)
    expect(OP_MODS).toHaveLength(18)
    expect(OP_TRIGGERS).toHaveLength(10)
  })

  it('draw：抽 n 張再棄 n 張（自己選或棄花費最低的）；手牌上限照夾', () => {
    const g = make()
    ANS.moves = [move('d', [{ kind: 'draw', n: 2, then_discard: 1 }], { cost: 0 })]
    start(g)
    W(g).hand = ['card_boost']
    W(g).deck = ['card_wind', 'card_interview', 'card_guard']
    mv(g, 'd')
    expect(W(g).hand).toHaveLength(2)
    expect(W(g).hand).toContain('card_boost') // 花費最低的先棄
    expect(W(g).discard).toHaveLength(1)
    W(g).hand = ['card_boost', 'card_guard']
    W(g).deck = ['card_wind', 'card_interview']
    mv(g, 'd', { discard: [0] })
    expect(W(g).hand).not.toContain('card_boost')
  })

  it('guard：pick（選自己的一格）、all、格子陣列、n 格；rounds 讓它撐到下一回合', () => {
    const g = make()
    ANS.moves = [
      move('g1', [{ kind: 'guard', cells: 'pick' }], { cost: 0 }), move('g2', [{ kind: 'guard', cells: 'all', rounds: 2 }], { cost: 0 }),
      move('g3', [{ kind: 'guard', cells: ['wall', 'relay', 'tape'] }], { cost: 0 }), move('g4', [{ kind: 'guard', cells: 2 }], { cost: 0 }),
    ]
    start(g)
    setCells(g, ['whisper', 'wall', 'kaleido'], ['tape'])
    expect(reason(() => mv(g, 'g1'))).toContain('要選一格')
    expect(reason(() => mv(g, 'g1', { cell: 'relay' }))).toContain('不是你的格子')
    mv(g, 'g1', { cell: 'wall' })
    expect(W(g).cells.wall.guard).toBe(1)
    mv(g, 'g3')
    expect(W(g).cells.relay.owner).toBeNull()
    expect(W(g).cells.relay.guard).toBeUndefined()
    mv(g, 'g4', { cells: ['kaleido'] })
    expect(W(g).cells.kaleido.guard).toBe(1)
    mv(g, 'g2')
    expect(['whisper', 'wall', 'kaleido'].map((c) => W(g).cells[c as Cell].guard)).toEqual([2, 2, 2])
    expect(opinionView(g.k, g.state).active && (opinionView(g.k, g.state) as { cells: Array<{ id: string; guarded: boolean }> }).cells.find((c) => c.id === 'wall')!.guarded).toBe(true)
  })

  it('capture_extra：這回合多佔一格照付聲量；def 是那一次的防守加減；any 不必相鄰；原本那一次要相鄰', () => {
    const g = make()
    ANS.moves = [move('c1', [{ kind: 'capture_extra', n: 1, def: -2, any: true }], { cost: 0 })]
    start(g)
    W(g).voice.you = 6
    cap(g, 'wall') // 原本那一次：相鄰、防守 2
    expect(W(g).voice.you).toBe(4)
    expect(reason(() => cap(g, 'doujin'))).toContain('已經佔領過')
    mv(g, 'c1')
    expect(W(g).captures).toBe(2)
    // 多佔的：不必相鄰、防守 2 − 2 = 0
    cap(g, 'doujin')
    expect(W(g).voice.you).toBe(4)
    expect(W(g).cells.doujin.owner).toBe('you')
    expect(W(g).xcap).toEqual([])
    // 下一回合又只有一次
    turn(g)
    expect(W(g).captures).toBe(1)
    // 沒有 any 的多佔一格要相鄰
    const h = make()
    ANS.moves = [move('c2', [{ kind: 'capture_extra', n: 1 }], { cost: 0 })]
    start(h)
    W(h).voice.you = 9
    cap(h, 'wall')
    mv(h, 'c2')
    expect(reason(() => cap(h, 'fanclub'))).toContain('不相鄰')
    cap(h, 'sakura')
  })

  it('def_mod：next 只管下一次；turn 到回合結束；war 整場；first_each_turn 只算每回合第一次；vs 與 cells 篩選', () => {
    const g = make()
    ANS.moves = [
      move('n', [{ kind: 'def_mod', amount: -1, scope: 'next' }], { cost: 0 }), move('f', [{ kind: 'def_mod', amount: -1, scope: 'war', vs: 'foe' }], { cost: 0 }),
      move('t', [{ kind: 'def_mod', amount: -1, scope: 'war', first_each_turn: true }, { kind: 'capture_extra', n: 1 }], { cost: 0 }),
    ]
    start(g)
    W(g).voice.you = 9
    mv(g, 'n')
    expect(defenseOf(W(g), 'wall', 'you', opinionRules(g.k))).toBe(1)
    cap(g, 'wall')
    expect(W(g).voice.you).toBe(8)
    expect(W(g).defmods).toEqual([])
    // vs foe：只管對手的格子
    setCells(g, ['whisper'], ['kaleido'])
    mv(g, 'f')
    expect(defenseOf(W(g), 'kaleido', 'you', opinionRules(g.k))).toBe(2)
    expect(defenseOf(W(g), 'wall', 'you', opinionRules(g.k))).toBe(2)
    turn(g)
    expect(W(g).defmods).toHaveLength(1)
    // first_each_turn：這回合第一次佔的 −1，第二次不算
    const h = make()
    ANS.moves = [move('t', [{ kind: 'def_mod', amount: -1, scope: 'war', first_each_turn: true }, { kind: 'capture_extra', n: 1 }], { cost: 0 })]
    start(h)
    W(h).voice.you = 9
    mv(h, 't')
    cap(h, 'wall')
    expect(W(h).voice.you).toBe(8)
    cap(h, 'sakura')
    expect(W(h).voice.you).toBe(6)
  })

  it('card_mod：amount 加、mult 加倍而且有 cap（最多多出幾點）；next 只管下一張，turn 管這回合每一張；下一回合清掉', () => {
    const g = make()
    ANS.moves = [
      move('x', [{ kind: 'card_mod', card: 'fuel', mult: 2, cap: 1, scope: 'next' }], { cost: 0 }), move('y', [{ kind: 'card_mod', card: 'fuel', amount: 1, scope: 'turn' }], { cost: 0 }),
      move('z', [{ kind: 'card_mod', card: 'line', amount: 1, scope: 'next' }], { cost: 0 }),
    ]
    start(g)
    W(g).desk[0]!.ep = 9
    W(g).hand = ['card_interview', 'card_interview', 'card_wind']
    mv(g, 'x')
    play(g, 0)
    expect(W(g).voice.you).toBe(3) // 2 加倍是 4，最多多 1 → 3
    play(g, 0)
    expect(W(g).voice.you).toBe(5)
    W(g).hand = ['card_interview', 'card_interview']
    mv(g, 'y')
    play(g, 0)
    play(g, 0)
    expect(W(g).voice.you).toBe(10)
    mv(g, 'z')
    W(g).hand = ['card_wind']
    play(g, 0)
    expect(W(g).wind).toBe(2)
    turn(g)
    expect(W(g).cardmods).toEqual([])
  })

  it('ep：now 這回合多一點；war 到整場結束每回合多一點；foe_pr 讓對手下一回合少點（最少 0）', () => {
    const g = make()
    ANS.moves = [move('e1', [{ kind: 'ep', amount: 1, scope: 'now' }], { cost: 0 }), move('e2', [{ kind: 'ep', amount: 1, scope: 'war' }], { cost: 0 }), move('p', [{ kind: 'foe_pr', amount: -1, scope: 'next' }], { cost: 0 })]
    start(g, { foe: 'pr_3' })
    mv(g, 'e1')
    expect(W(g).desk[0]).toMatchObject({ ep: 3, ep_max: 2 })
    mv(g, 'e2')
    expect(W(g).desk[0]).toMatchObject({ ep: 4, ep_max: 3 })
    mv(g, 'p')
    expect(W(g).foe_state.pr_mod).toBe(-1)
    const [r] = turn(g)
    expect(beats(r!, 'opinion.foe.start')[0]!.data).toMatchObject({ pts: 5 })
    expect(W(g).foe_state.pr_mod).toBeUndefined()
    expect(W(g).desk[0]).toMatchObject({ ep: 3, ep_max: 3 })
    // 少到 0：強度 1 的對手少 3 點
    const h = make()
    ANS.moves = [move('p', [{ kind: 'foe_pr', amount: -3, scope: 'next' }], { cost: 0 })]
    start(h)
    mv(h, 'p')
    const [r2] = turn(h)
    expect(beats(r2!, 'opinion.foe.start')[0]!.data).toMatchObject({ pts: 0 })
  })

  it('take：直接佔沒人的格子（不必相鄰、不花聲量）；if any 連對手的也佔；foe_def_zero 讓對手的格子這回合防守當作 0', () => {
    const g = make()
    ANS.moves = [
      move('t1', [{ kind: 'take', cells: ['tape', 'fanclub', 'nightingale'], if: 'empty' }], { cost: 0 }),
      move('t2', [{ kind: 'take', cells: ['tape', 'fanclub', 'nightingale'], if: 'empty', foe_def_zero: true }], { cost: 0 }),
      move('t3', [{ kind: 'take', cells: ['sakura'], if: 'any' }], { cost: 0 }),
    ]
    start(g)
    setCells(g, ['whisper'], ['fanclub'])
    mv(g, 't1')
    expect(['tape', 'fanclub', 'nightingale'].map((c) => W(g).cells[c as Cell].owner)).toEqual(['you', 'foe', 'you'])
    expect(W(g).voice.you).toBe(0)
    const h = make()
    ANS.moves = [move('t2', [{ kind: 'take', cells: ['tape', 'fanclub', 'nightingale'], if: 'empty', foe_def_zero: true }], { cost: 0 })]
    start(h)
    setCells(h, ['kaleido'], ['fanclub'])
    mv(h, 't2')
    expect(W(h).zero_def).toEqual(['fanclub'])
    expect(defenseOf(W(h), 'fanclub', 'you', opinionRules(h.k))).toBe(0)
    cap(h, 'fanclub')
    // if any：對手的格子也直接佔
    const i = make()
    ANS.moves = [move('t3', [{ kind: 'take', cells: ['sakura'], if: 'any' }], { cost: 0 })]
    start(i)
    setCells(i, ['whisper'], ['sakura'])
    mv(i, 't3')
    expect(W(i).cells.sakura.owner).toBe('you')
  })

  it('free_adjacency：到整場結束佔領不必相鄰；mark 記旗標；roll 擲骰走 pass 或 fail；out 存著戰役外的效果', () => {
    const g = make()
    ANS.moves = [
      move('fa', [{ kind: 'free_adjacency', scope: 'war' }, { kind: 'mark', key: 'loud' }], { cost: 0 }),
      move('r1', [{ kind: 'roll', skill: 'd20', dc: 1, pass: [{ kind: 'voice', amount: 2 }], fail: [{ kind: 'voice', amount: 1 }] }], { cost: 0 }),
      move('r2', [{ kind: 'roll', skill: 'd20', dc: 40, pass: [{ kind: 'voice', amount: 2 }], fail: [{ kind: 'voice', amount: 1 }] }], { cost: 0, id: 'r2' }),
      move('o', [{ kind: 'out', effect: { kind: 'hostility', key: '$foe_faction', amount: 2 } }], { cost: 0 }),
    ]
    start(g)
    W(g).voice.you = 5
    expect(reason(() => cap(g, 'doujin'))).toContain('不相鄰')
    mv(g, 'fa')
    cap(g, 'doujin')
    expect(W(g).marks.loud).toBe(1)
    mv(g, 'r1')
    expect(W(g).voice.you).toBe(5) // 3 + 2
    mv(g, 'r2')
    expect(W(g).voice.you).toBe(6)
    mv(g, 'o')
    expect(W(g).out).toEqual([{ kind: 'hostility', key: '$foe_faction', amount: 2 }])
    expect(meter(g, 'hostility', 'f_alpha')).toBe(0)
  })

  it('roll 用基本功：加屬性與基本功等級；link_voice 在副本裡有連動時聲量 +amount，不在時走一次擲骰', () => {
    const g = make({ pc: { skills: { perform: 5 }, attrs: { charm: 14 } } })
    ANS.moves = [
      move('lv', [{ kind: 'link_voice', amount: 5, else: { skill: 'd20', dc: 1, pass: 5, fail: 2 } }], { cost: 0 }),
      move('lw', [{ kind: 'link_voice', amount: 5, else: { skill: 'd20', dc: 40, pass: 5, fail: 2 } }], { cost: 0 }),
      move('sk', [{ kind: 'roll', skill: 'perform', dc: 1, pass: [{ kind: 'voice', amount: 1 }], fail: [] }], { cost: 0 }),
    ]
    start(g)
    mv(g, 'lv')
    expect(W(g).voice.you).toBe(5)
    mv(g, 'lw')
    expect(W(g).voice.you).toBe(7)
    const r = mv(g, 'sk')[0]!
    expect(beats(r, 'opinion.roll')[0]!.data).toMatchObject({ skill: 'perform' })
    expect((beats(r, 'opinion.roll')[0]!.data as { total: number }).total).toBeGreaterThan((beats(r, 'opinion.roll')[0]!.data as { roll: number }).roll)
    // 副本裡有連動
    const h = make()
    ANS.moves = [move('lw', [{ kind: 'link_voice', amount: 5, else: { skill: 'd20', dc: 40, pass: 5, fail: 2 } }], { cost: 0 })]
    start(h, { links: ['lk_doc'] })
    mv(h, 'lw')
    expect(W(h).voice.you).toBe(5)
    expect(W(h).links).toEqual(['lk_doc'])
  })

  it('招的條件（need）看用招的人；編輯點不夠、不是坐在編輯台的人、格式不對的招都不能用，原因是完整的句子', () => {
    const g = make()
    ANS.moves = [
      move('needy', [{ kind: 'voice', amount: 1 }], { need: { kind: 'flag', key: 'ok' } }), move('dear', [{ kind: 'voice', amount: 1 }], { cost: 5 }), move('away', [{ kind: 'voice', amount: 1 }], { actor: 'bud' }),
      { id: 'bad', owner: 't', actor: 'pc', name: '壞招', cost: 1, effects: [{ kind: 'nuke', amount: 1 }] } as unknown as OpMove,
    ]
    start(g)
    expect(reason(() => mv(g, 'needy'))).toContain('「ok」')
    g.state.flags.ok = true
    mv(g, 'needy')
    expect(reason(() => mv(g, 'dear'))).toContain('編輯點不夠')
    expect(movesView(g.k, g.state).moves.map((m) => m.id)).toEqual(['needy', 'dear'])
    expect(movesView(g.k, g.state).skipped.join()).toContain('nuke')
    expect(reason(() => mv(g, 'bad'))).toContain('nuke')
  })
})

// ===================================================================================================================
describe('被動的修正（OP_MODS）', () => {
  const start = (g: G, mods: Rec[], setup: Rec = {}) => {
    ANS.passives = [passive('p', { actor: 'pc', mods })]
    begin(g, setup)
    W(g).desk[0]!.ep = 9
  }

  it('open_voice、open_wind、open_hand：開場的加成（手牌不超過上限）', () => {
    const g = make({ extra: { opinion_rule: [{ id: 'default', hand_max: 8 }] } })
    start(g, [{ kind: 'open_voice', amount: 2 }, { kind: 'open_wind', amount: 1 }, { kind: 'open_hand', amount: 1 }])
    expect([W(g).voice.you, W(g).wind, W(g).hand.length]).toEqual([2, 1, 6])
  })

  it('fuel_first、fuel_first2、line_first、wind_first、cred_line_at', () => {
    const g = make()
    start(g, [{ kind: 'fuel_first', amount: 1 }])
    W(g).hand = ['card_interview', 'card_interview']
    play(g, 0)
    expect(W(g).voice.you).toBe(3)
    play(g, 0)
    expect(W(g).voice.you).toBe(5)
    const h = make()
    start(h, [{ kind: 'fuel_first2', amount: 1 }])
    W(h).hand = ['card_interview', 'card_interview', 'card_interview']
    play(h, 0)
    play(h, 0)
    play(h, 0)
    expect(W(h).voice.you).toBe(3 + 3 + 2)
    const i = make()
    start(i, [{ kind: 'line_first', amount: 1 }])
    W(i).hand = ['card_wind', 'card_wind']
    play(i, 0)
    expect(W(i).wind).toBe(2)
    play(i, 0)
    expect(W(i).wind).toBe(3)
    const j = make()
    start(j, [{ kind: 'wind_first', amount: 2 }])
    W(j).hand = ['card_wind', 'card_wind']
    play(j, 0)
    expect(W(j).wind).toBe(3)
    play(j, 0)
    expect(W(j).wind).toBe(4)
    // 說法 +1 的門檻改成 50：公信力 50 就有
    const l = make()
    start(l, [{ kind: 'cred_line_at', amount: 50 }])
    W(l).hand = ['card_wind']
    play(l, 0)
    expect(W(l).wind).toBe(2)
  })

  it('when：條件不成立的修正不算（同一套文法）', () => {
    const g = make()
    start(g, [{ kind: 'fuel_first', amount: 2, when: 'round >= 2' }])
    W(g).hand = ['card_interview']
    play(g, 0)
    expect(W(g).voice.you).toBe(2)
    turn(g)
    W(g).hand = ['card_interview']
    play(g, 0)
    expect(W(g).voice.you).toBeGreaterThanOrEqual(0)
    expect(readWar(g.state)!.round).toBe(2)
  })

  it('def_first_empty、def_cell（once）、def_own、foe_release、draw_extra', () => {
    const g = make()
    start(g, [{ kind: 'def_first_empty', amount: 0 }, { kind: 'def_cell', cell: 'doujin', amount: -1, once: true }])
    W(g).voice.you = 9
    expect(defenseOf(W(g), 'wall', 'you', opinionRules(g.k))).toBe(0)
    cap(g, 'wall')
    expect(W(g).voice.you).toBe(9)
    expect(defenseOf(W(g), 'relay', 'you', opinionRules(g.k))).toBe(2)
    const h = make()
    start(h, [{ kind: 'def_own', amount: 1 }])
    setCells(h, ['whisper'], ['kaleido'])
    expect(defenseOf(W(h), 'whisper', 'foe', opinionRules(h.k))).toBe(4)
    const i = make()
    start(i, [{ kind: 'foe_release', amount: 1 }], { foe: 'pr_3' })
    const [r] = turn(i)
    expect(beats(r!, 'opinion.foe.release')[0]!.data).toMatchObject({ voice: 1 })
    const j = make()
    ANS.passives = [passive('p', { actor: 'pc', mods: [{ kind: 'draw_extra', amount: 1 }] })]
    begin(j)
    const [r2] = turn(j)
    expect(beats(r2!, 'opinion.draw').some((b) => (b.data as { discarded?: string[] }).discarded?.length === 1)).toBe(true)
  })

  it('shield：每場抵銷幾次對手的律師函、下架、降流（公關點照扣）；free_army：每場第一張水軍不花點、拆穿的門檻改成 n', () => {
    const g = make()
    start(g, [{ kind: 'shield', what: 'lawyer', n: 1 }], { foe: 'pr_law' })
    turn(g)
    expect(W(g).desk[0]!.ep).toBe(2)
    expect(W(g).shield[0]!.left).toBe(0)
    turn(g)
    expect(W(g).desk[0]!.ep).toBe(1)
    const h = make()
    start(h, [{ kind: 'shield', what: ['lawyer', 'mute'], n: 1 }], { foe: 'pr_mute' })
    W(h).voice.you = 5
    const [r] = turn(h)
    expect(W(h).voice.you).toBe(5)
    expect(beats(r!, 'opinion.foe.mute')[0]!.data).toMatchObject({ blocked: true })
    const i = make()
    start(i, [{ kind: 'free_army', amount: 0 }])
    W(i).hand = ['card_army', 'card_army']
    const d = play(i, 0)[0]!
    expect(d.timeline.find((b) => b.tag === 'opinion.play')!.data).toMatchObject({ cost: 0, risk: 0 })
    expect(W(i).desk[0]!.ep).toBe(9)
    play(i, 0)
    expect(W(i).desk[0]!.ep).toBe(8)
  })
})

// ===================================================================================================================
describe('反應（OP_TRIGGERS）：預留編輯點、次數、negate、reverse、retake', () => {
  const react = (on: string | string[], effects: Rec[], o: Rec = {}) => passive('r', { actor: 'pc', reacts: [{ on, effects, ...o }] })

  it('有 cost 的只有預留了編輯點才發動；預留從這回合沒用完的編輯點扣；編輯點不夠不能預留', () => {
    const setup = (): G => {
      const g = make()
      ANS.passives = [react('foe.capture', [{ kind: 'negate' }, { kind: 'wind', amount: 1 }], { cost: 1, limit: { per: 'turn', n: 1 } })]
      begin(g, { foe: 'pr_hunt' })
      setCells(g, ['whisper'], ['kaleido'])
      W(g).voice.foe = 6
      return g
    }
    // 沒預留：被搶走
    const g = setup()
    const [r1] = turn(g)
    expect(W(g).cells.whisper.owner).toBe('foe')
    expect(beats(r1!, 'opinion.react')).toHaveLength(0)
    // 預留了：擋下來、對手不扣聲量、風向 +1
    const h = setup()
    expect((opinionView(h.k, h.state) as { reserve: Array<{ key: string; can: boolean }> }).reserve).toMatchObject([{ key: 'r:0', can: true }])
    const [r2] = turn(h, { reserve: ['r:0'] })
    expect(beats(r2!, 'opinion.reserve')).toHaveLength(1)
    expect(beats(r2!, 'opinion.react')).toHaveLength(1)
    expect(W(h).cells.whisper.owner).toBe('you')
    expect(W(h).wind).toBe(1)
    expect(beats(r2!, 'opinion.foe.capture')[0]!.data).toMatchObject({ blocked: true })
    // 編輯點不夠：先花光
    const i = setup()
    W(i).desk[0]!.ep = 0
    expect(reason(() => endTurn(i.k, i.state, { reserve: ['r:0'] }))).toContain('編輯點不夠')
    expect(reason(() => endTurn(i.k, i.state, { reserve: ['r:9'] }))).toContain('沒有這個可以預留')
  })

  it('沒有 cost 的自動發動；每回合一次的第二次不發動，下一回合又能發動', () => {
    const g = make()
    ANS.passives = [react('foe.release', [{ kind: 'voice', amount: 1 }], { limit: { per: 'turn', n: 1 } })]
    begin(g, { foe: 'pr_rel2' })
    const [r1] = turn(g)
    expect(beats(r1!, 'opinion.foe.release').length).toBeGreaterThan(1)
    expect(beats(r1!, 'opinion.react')).toHaveLength(1)
    const [r2] = turn(g)
    expect(beats(r2!, 'opinion.react')).toHaveLength(1)
    expect(W(g).moves_used['war:r:0']).toBe(2)
  })

  it('negate 讓對手的降流無效（公關點照扣）；reverse 把否認的風向反過來；if_mark 看這回合有沒有記旗標', () => {
    const g = make()
    ANS.passives = [react('foe.mute', [{ kind: 'negate' }])]
    begin(g, { foe: 'pr_mute' })
    W(g).voice.you = 5
    turn(g)
    expect(W(g).voice.you).toBe(5)
    const h = make()
    ANS.passives = [react(['foe.deny', 'foe.counter'], [{ kind: 'reverse' }])]
    begin(h, { foe: 'pr_deny' })
    const [r] = turn(h)
    expect(W(h).wind).toBe(2) // 兩次否認（2 點公關點、一次 1 點）都反過來
    expect(beats(r!, 'opinion.foe.deny')[0]!.data).toMatchObject({ reversed: true })
    const i = make()
    ANS.passives = [react('foe.deny', [{ kind: 'reverse' }], { if_mark: 'ready' })]
    ANS.moves = [move('mk', [{ kind: 'mark', key: 'ready' }], { cost: 0 })]
    begin(i, { foe: 'pr_deny' })
    turn(i)
    expect(W(i).wind).toBe(-2)
    mv(i, 'mk')
    turn(i)
    expect(W(i).wind).toBe(0)
  })

  it('retake：被搶走的那一格回來（對手照付聲量）；foe.capture_last 在要搶最後一格時問；turn.start 在每回合開始自動發動', () => {
    const g = make()
    ANS.passives = [react('cell.lost', [{ kind: 'retake' }], { limit: { per: 'war', n: 1 } })]
    begin(g, { foe: 'pr_hunt' })
    setCells(g, ['whisper', 'wall'], ['kaleido'])
    W(g).voice.foe = 6
    const [rr] = turn(g)
    expect(['whisper', 'wall'].map((c) => W(g).cells[c as Cell].owner).filter((o) => o === 'you')).toHaveLength(2)
    expect(beats(rr!, 'opinion.foe.capture')[0]!.data).toMatchObject({ def: 3 })
    expect(W(g).voice.foe).toBe(6 + 4 - 3) // 兩次發稿（2 點公關點）再付 3
    const h = make()
    ANS.passives = [react('foe.capture_last', [{ kind: 'negate' }, { kind: 'wind', amount: 2 }], { limit: { per: 'war', n: 1 } })]
    begin(h, { foe: 'pr_hunt' })
    setCells(h, ['whisper'], ['kaleido'])
    W(h).voice.foe = 6
    turn(h)
    expect(W(h).cells.whisper.owner).toBe('you')
    expect(W(h).wind).toBe(2)
    expect(W(h).turn).toBe('you')
    const i = make()
    ANS.passives = [react('turn.start', [{ kind: 'voice', amount: 1 }])]
    begin(i)
    expect(W(i).voice.you).toBe(1)
    turn(i)
    expect(W(i).voice.you).toBe(2)
  })

  it('你的格子被清空而 retake 把它搶回來：戰役不會被判敗', () => {
    const g = make()
    ANS.passives = [react('cell.lost', [{ kind: 'retake' }])]
    begin(g, { foe: 'pr_hunt' })
    setCells(g, ['whisper'], ['kaleido'])
    W(g).voice.foe = 6
    turn(g)
    expect(W(g).turn).toBe('you')
    expect(W(g).cells.whisper.owner).toBe('you')
  })
})

// ===================================================================================================================
describe('opinion.check：格式的問題清單', () => {
  const check = (g: G, what: string, data: unknown): string[] => g.k.hooks.run('opinion.check', { what: what as never, data }).flatMap((r) => r.result)

  it('寫了清單以外的效果、修正、觸發點各回一條問題，句子寫出是哪個鍵；好的資料回空陣列', () => {
    const g = make()
    expect(check(g, 'move', move('ok', [{ kind: 'voice', amount: 2 }]))).toEqual([])
    expect(check(g, 'move', move('bad', [{ kind: 'nuke', amount: 2 }])).join()).toContain('effects[0].kind「nuke」')
    expect(check(g, 'passive', passive('bad', { mods: [{ kind: 'mega', amount: 1 }] })).join()).toContain('mods[0].kind「mega」')
    expect(check(g, 'passive', passive('bad', { reacts: [{ on: 'foe.sneeze', effects: [{ kind: 'voice', amount: 1 }] }] })).join()).toContain('reacts[0].on「foe.sneeze」')
    expect(check(g, 'passive', passive('ok', { mods: [{ kind: 'ep', amount: 1 }] }))).toEqual([])
    expect(check(g, 'open', { owner: 'x', line: '一句話', voice: 2, cells: ['fanclub'] })).toEqual([])
  })

  it('每一種欄位的格式、negate／reverse／retake 只能寫在反應裡、when 不能用 can_capture', () => {
    const g = make()
    const p = (data: unknown, what = 'move') => check(g, what, data).join('；')
    expect(p(move('a', [{ kind: 'negate' }]))).toContain('只能寫在反應')
    expect(p(move('a', [{ kind: 'guard', cells: 'nope' }]))).toContain('effects[0].cells')
    expect(p(move('a', [{ kind: 'card_mod', card: 'fuel', scope: 'now' }]))).toContain('scope')
    expect(p(move('a', [{ kind: 'card_mod', card: 'fuel', scope: 'next' }]))).toContain('amount 或 mult')
    expect(p(move('a', [{ kind: 'def_mod', amount: 0, scope: 'war' }]))).toContain('amount')
    expect(p(move('a', [{ kind: 'link_voice', amount: 3 }]))).toContain('else')
    expect(p(move('a', [{ kind: 'roll', skill: 'd20', dc: 5, pass: [{ kind: 'roll', skill: 'd20', dc: 5, pass: [{ kind: 'roll', skill: 'd20', dc: 5, pass: [], fail: [] }], fail: [] }], fail: [] }]))).toContain('疊太深')
    expect(p(move('a', [{ kind: 'out', effect: 'x' }]))).toContain('effect')
    expect(p({ id: 'a', owner: 'o', actor: 'pc', name: 'n', cost: 9, effects: [{ kind: 'voice', amount: 1 }] })).toContain('cost')
    expect(p(passive('a', { mods: [{ kind: 'def_cell', amount: 1 }] }), 'passive')).toContain('cell')
    expect(p(passive('a', { mods: [{ kind: 'shield', what: 'nap', n: 1 }] }), 'passive')).toContain('what')
    expect(p(passive('a', { mods: [{ kind: 'ep', amount: 1, when: 'can_capture > 0' }] }), 'passive')).toContain('can_capture')
    expect(p(passive('a', { reacts: [{ on: 'foe.deny', effects: [{ kind: 'retake' }] }] }), 'passive')).toContain('retake 只能用在 cell.lost')
    expect(p(passive('a', { reacts: [{ on: 'cell.lost', effects: [{ kind: 'negate' }] }] }), 'passive')).toContain('negate')
    expect(p(passive('a', { reacts: [{ on: 'turn.start', cost: 1, effects: [{ kind: 'voice', amount: 1 }] }] }), 'passive')).toContain('turn.start')
    expect(p(passive('a'), 'passive')).toContain('mods 或 reacts')
    expect(p({ owner: 'o', line: '', cells: ['nowhere'], hand: 9 }, 'open')).toMatch(/line.*cells.*hand/)
  })

  it('開戰時遇到沒驗過的壞資料：那一筆略過並在紀錄裡提醒，不丟錯', () => {
    const g = make()
    ANS.passives = [passive('bad', { mods: [{ kind: 'mega', amount: 1 }] }), passive('good', { actor: 'pc', mods: [{ kind: 'open_voice', amount: 2 }] })]
    ANS.open = [{ owner: 'x' } as unknown as OpOpen]
    const [r] = begin(g)
    expect(W(g).voice.you).toBe(2)
    expect(W(g).passives.map((x) => x.id)).toEqual(['good'])
    const notices = beats(r!, 'opinion.notice').map((b) => (b as unknown as { text: string }).text)
    expect(notices.join()).toContain('mega')
    expect(notices.join()).toContain('略過')
  })
})

// ===================================================================================================================
describe('開場表（opinion.open）', () => {
  it('替身回「佔應援圈、風向 +1」→ 開場就是那樣；那一格已經有人時不佔；一句 line 進開場的紀錄', () => {
    const g = make()
    ANS.open = [{ owner: 'idol', cells: ['fanclub'], wind: 1, voice: 2, line: '你的粉絲先佔了應援圈' }]
    const [r] = begin(g)
    expect(W(g).cells.fanclub.owner).toBe('you')
    expect(W(g).wind).toBe(1)
    expect(W(g).voice.you).toBe(2)
    expect(beats(r!, 'opinion.open').map((b) => (b as unknown as { text: string }).text).join()).toContain('粉絲先佔了應援圈')
    // 已經有人的：對手開場的格子（對面）不佔
    const h = make()
    ANS.open = [{ owner: 'idol', cells: ['tape', 'whisper'], line: '想佔兩格' }]
    begin(h)
    expect(W(h).cells.tape.owner).toBe('foe')
    expect(W(h).cells.whisper.owner).toBe('you')
  })

  it('hand、foe_pr_first（對手第一回合少幾點）、cards（牌庫多一張）', () => {
    const g = make({ extra: { opinion_rule: [{ id: 'default', hand_max: 9 }] } })
    ANS.open = [{ owner: 'a', hand: 2, foe_pr_first: 2, cards: ['card_army', 'card_nope'], line: '開場多一些' }]
    const [r] = begin(g, { foe: 'pr_1' })
    expect(W(g).hand.length + W(g).deck.length).toBe(9 + 1)
    expect(W(g).hand.length).toBe(3 + 2 + 2)
    expect(beats(r!, 'opinion.start')[0]!.data).toMatchObject({ pr: 2 })
    expect(beats(r!, 'opinion.notice').map((b) => (b as unknown as { text: string }).text).join()).toContain('card_nope')
    const [r2] = turn(g)
    expect(beats(r2!, 'opinion.foe.start')[0]!.data).toMatchObject({ pts: 0 })
    const [r3] = turn(g)
    expect(beats(r3!, 'opinion.foe.start')[0]!.data).toMatchObject({ pts: 2 })
  })
})

// ===================================================================================================================
describe('戰役的後果（V41）', () => {
  const prep = () => {
    const g = make()
    setMeter(g, 'subs', 1000)
    return g
  }
  /** 大勝：把對手唯一的格子清空。 */
  const win = (g: G, setup: Rec = {}) => {
    begin(g, setup)
    setCells(g, ['kaleido', 'whisper'], ['tape'])
    W(g).voice.you = 5
    cap(g, 'tape')
    expect(W(g).result!.outcome).toBe('major')
    return g.commit(settle(g.k, g.state))[0]!
  }

  it('大勝：目標勢力聲望 −10、敵對值 +10、訂閱 +10%、公信力 +5；格子的加成（主流 +2%、街頭公信力 +1）一起給；戰役清掉', () => {
    const g = prep()
    const r = win(g)
    expect(r.action).toBe('opinion.end')
    expect(meter(g, 'standing', 'f_alpha')).toBe(40)
    expect(meter(g, 'hostility', 'f_alpha')).toBe(10)
    // 訂閱 +10% = 100；主流一格（萬華鏡）+2% = 20
    expect(meter(g, 'subs')).toBe(1120)
    expect(meter(g, 'credibility')).toBe(56)
    expect(g.state.ext.opinion).toBeUndefined()
    expect(beats(r, 'opinion.after')).toHaveLength(1)
    expect(r.changes.some((c) => c.op === 'rep')).toBe(false)
  })

  it('小勝 −5、+6、+5%、+2；平手敵對值 +3；敗敵對值 +5、公信力 −3', () => {
    const run = (mine: Cell[], foe: Cell[]) => {
      const g = prep()
      begin(g, { rounds: 1, foe: 'pr_idle' })
      setCells(g, mine, foe)
      turn(g)
      const outcome = W(g).result!.outcome
      g.commit(settle(g.k, g.state))
      return { g, outcome }
    }
    const minor = run(['kaleido'], ['tape'])
    expect(minor.outcome).toBe('minor')
    expect([meter(minor.g, 'standing', 'f_alpha'), meter(minor.g, 'hostility', 'f_alpha'), meter(minor.g, 'credibility')]).toEqual([45, 6, 52 + 0])
    expect(meter(minor.g, 'subs')).toBe(1000 + 50 + 20)
    const draw = run(['kaleido'], ['sakura', 'nightingale'])
    expect(draw.outcome).toBe('draw')
    expect([meter(draw.g, 'standing', 'f_alpha'), meter(draw.g, 'hostility', 'f_alpha'), meter(draw.g, 'credibility')]).toEqual([50, 3, 50])
    const lost = run(['relay'], ['kaleido'])
    expect(lost.outcome).toBe('lost')
    expect([meter(lost.g, 'hostility', 'f_alpha'), meter(lost.g, 'credibility')]).toEqual([5, 50 - 3 + 1])
  })

  it('同人圈與應援圈各人氣 +1、打賞（分數 × 50）；認輸不算結算，不給格子的加成', () => {
    const g = prep()
    begin(g, { rounds: 1, foe: 'pr_idle' })
    setCells(g, ['doujin', 'fanclub'], ['relay'])
    const cash0 = g.state.money.cash
    turn(g)
    g.commit(settle(g.k, g.state))
    expect(meter(g, 'popularity', g.state.pc!)).toBe(2)
    expect(g.state.money.cash).toBe(cash0 + 2 * 50)
    const h = prep()
    begin(h)
    setCells(h, ['doujin', 'kaleido'], ['relay'])
    const cash1 = h.state.money.cash
    h.commit(concede(h.k, h.state))
    expect(meter(h, 'popularity', h.state.pc!)).toBe(0)
    expect(h.state.money.cash).toBe(cash1)
    expect(meter(h, 'subs')).toBe(1000)
    expect(meter(h, 'hostility', 'f_alpha')).toBe(5)
  })

  it('守方的議題（滅火）聲望加在被保護的那一方、敵對值加在對手的勢力', () => {
    const g = prep()
    begin(g, { topic: 'tp_douse', foe: 'pr_3' })
    setCells(g, ['kaleido', 'nightingale'], ['relay'])
    W(g).voice.you = 5
    cap(g, 'relay')
    g.commit(settle(g.k, g.state))
    expect(meter(g, 'standing', 'f_alpha')).toBe(60)
    expect(meter(g, 'standing', 'f_beta')).toBe(50)
    expect(meter(g, 'hostility', 'f_beta')).toBe(10)
  })

  it('out 的效果在結算時才套（$foe_faction 換成對手的勢力）；議題的 on_end 也一起套；沒有人註冊的種類略過、不擋結算', () => {
    const g = prep()
    ANS.moves = [move('o', [{ kind: 'out', effect: { kind: 'hostility', key: '$foe_faction', amount: 2 } }, { kind: 'out', effect: { kind: 'nope_kind', amount: 1 } }], { cost: 0 })]
    begin(g, { topic: 'tp_end' })
    mv(g, 'o')
    expect(meter(g, 'hostility', 'f_alpha')).toBe(0)
    g.commit(concede(g.k, g.state))
    expect(meter(g, 'hostility', 'f_alpha')).toBe(7)
    expect(g.state.flags.op_lost).toBe(true)
    expect(g.state.flags.op_major).toBeUndefined()
    const h = prep()
    win(h, { topic: 'tp_end' })
    expect(h.state.flags.op_major).toBe(true)
  })

  it('activity.end 的 result 多 brought、desk；沒有量表的局（只裝 opinion）結算照走', () => {
    const g = prep()
    const clip = addClip(g, { angle: 'sensational', draw: 5, card: { kind: 'fuel', value: 5 } })
    const log: Rec[] = []
    g.k.hooks.on('activity.end', 'desk_listen', ({ kind, result }) => { if (kind === 'opinion') log.push(result); return undefined })
    begin(g, { bring: [clip], desk: ['pc', 'bud'] })
    g.commit(concede(g.k, g.state))
    expect(log[0]).toMatchObject({ brought: [clip], desk: ['pc', 'bud'], by: 'concede' })
    const bare = makeGame({ features: [opinionFeature, answers], content: [METER_CONTENT, PACK()], seed: 7, patch: { time: { day: 3, hour: 10, minute: 0 } } }).game
    bare.launch('opinion', { topic: 'tp_ignite', foe: 'pr_1' })
    bare.commit(concede(bare.k, bare.state))
    expect(bare.state.ext.opinion).toBeUndefined()
  })
})

// ===================================================================================================================
describe('自己發起（OPINION 第 8 節；V34）', () => {
  it('只給類型與勢力開得起來：議題是從預設的分數表挑的一列、等級照勢力的 grade；對手找 faction 對得上的', () => {
    const g = make()
    const reports = g.commit(startWar(g.k, g.state, { topic: { kind: 'ignite', faction: 'f_alpha', people: ['npc_ann'], types: ['scandal'] } }))
    expect(reports[0]!.action).toBe('opinion.start')
    const w = W(g)
    expect(w.grade).toBe(1)
    expect(w.topic.kind).toBe('ignite')
    expect(w.topic.involves).toEqual({ factions: ['f_alpha'], people: ['npc_ann'], types: ['scandal'] })
    expect(Object.values(w.topic.scores).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    expect(w.foe.id).toBe('pr_1')
    expect(w.self).toBe(true)
    // 等級照勢力的 grade（I～V 或 1～5）
    const h = make()
    h.commit(startWar(h.k, h.state, { topic: { kind: 'ignite', faction: 'f_g4' } }))
    expect(W(h).grade).toBe(4)
  })

  it('找不到對手用規則表的通用公關（強度照等級）；規則表蓋得掉；守方的議題用通用公關', () => {
    const g = make()
    g.commit(startWar(g.k, g.state, { topic: { kind: 'smear', faction: 'f_g5' } }))
    expect(W(g).foe).toMatchObject({ id: 'pr_generic', faction: 'f_g5', strength: 3 })
    expect(W(g).grade).toBe(5)
    const h = make({ extra: { opinion_rule: [{ id: 'default', generic: { strength: [2, 2, 2, 2, 2] } }] } })
    h.commit(startWar(h.k, h.state, { topic: { kind: 'ignite', faction: 'f_g4' } }))
    expect(W(h).foe.strength).toBe(2)
    expect(W(h).grade).toBe(4)
    const i = make()
    i.commit(startWar(i.k, i.state, { topic: { kind: 'douse', faction: 'f_alpha' } }))
    expect(W(i).foe.id).toBe('pr_generic')
    expect(W(i).foe.faction).toBeUndefined()
    expect(W(i).topic.side).toBe('defend')
    // 格式不對
    expect(reason(() => startWar(g.k, make().state, { topic: { kind: 'nope', faction: 'f_alpha' } }))).toContain('類型')
    expect(reason(() => startWar(g.k, make().state, { topic: { kind: 'frame', faction: 'f_alpha' } }))).toContain('指定一格')
    expect(reason(() => begin(make(), { topic: { kind: 'ignite', faction: 'f_alpha', grade: 9 } }))).toContain('1～5')
  })

  it('訂閱一萬以上，自己發起時採訪的聲量 +1（V34）；不到、或事件開的（director）、委託副本的不加', () => {
    const interview = (subs: number, origin: Origin = { by: 'shell' }, mode?: string): number => {
      const g = make()
      setMeter(g, 'subs', subs)
      g.commit(startWar(g.k, g.state, { topic: 'tp_ignite', foe: 'pr_1', ...(mode ? { mode: mode as 'face' } : {}) }, origin))
      W(g).hand = ['card_interview']
      const d = playCard(g.k, g.state, { index: 0 })
      return (beats(d, 'opinion.play')[0]!.data as { voice: number }).voice
    }
    expect(interview(9999)).toBe(2)
    expect(interview(10000)).toBe(3)
    expect(interview(10000, { by: 'director' })).toBe(2)
    expect(interview(10000, { by: 'commission' }, 'face')).toBe(2)
  })
})

// ===================================================================================================================
describe('事件的指示 start（director）', () => {
  const ev = (id: string, directive: Rec): Rec => ({
    id, scope: 'street', triggers: ['enter_block'], text: '一則爆料。',
    options: [{ id: 'go', text: '開戰。', outcomes: { any: [directive] } }, { id: 'no', text: '算了。', outcomes: { any: [] } }],
  })
  const mk = (events: Rec[], extra: Rec = {}) =>
    makeGame({
      features: [directorFeature, eventRunFeature, toy, opinionFeature, answers],
      content: [METER_CONTENT, { id: 'desk_district', content: { district: [{ id: 'd_a', name: '甲區' }] } } as unknown as ContentPack, PACK(), {
        id: 'desk_events', content: { event_scope: [{ id: 'street', triggers: { enter_block: 1 }, cooldown_hours: 0, repeat_days: 0, lost: 'drop' }], event: events, ...extra },
      } as unknown as ContentPack],
      seed: 7, patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' } } as Partial<GameState>,
    }).game

  it('玩具事件選了之後開了一場輿論戰（origin 是 director）；setup 照活動的格式', () => {
    const g = mk([ev('ev_op', { kind: 'start', activity: 'opinion', setup: { topic: 'tp_ignite', foe: 'pr_1' } })])
    g.launch('event', { event: 'ev_op' }, { by: 'caller', ref: 'x1' })
    const reports = g.commit(chooseOption(g.k, g.state, 'go'))
    expect(reports.map((r) => r.action)).toEqual(['event.close', 'opinion.start'])
    expect(reports[0]!.launch).toHaveLength(1)
    expect(W(g as unknown as G).topic.id).toBe('tp_ignite')
    expect(W(g as unknown as G).origin).toMatchObject({ by: 'director', ref: 'ev_op' })
    expect(W(g as unknown as G).self).toBe(false)
    // 只給類型與勢力也行
    const h = mk([ev('ev_self', { kind: 'start', activity: 'opinion', setup: { topic: { kind: 'ignite', faction: 'f_alpha' } } })])
    h.launch('event', { event: 'ev_self' }, { by: 'caller' })
    h.commit(chooseOption(h.k, h.state, 'go'))
    expect(W(h as unknown as G).topic.involves.factions).toEqual(['f_alpha'])
  })

  it('activity 寫沒登記的、不在 startable 裡的、格式不對的，內容載入時被擋；一組結果最多一個指示、不能和 adult_scene 同一個選項', () => {
    expect(() => mk([ev('ev_x', { kind: 'start', activity: 'ghost_activity' })])).toThrow(/沒有「ghost_activity」這種活動/)
    expect(() => mk([ev('ev_x', { kind: 'start', activity: 'event' })])).toThrow(/不在 event_rule 的 startable/)
    expect(() => mk([ev('ev_x', { kind: 'start' })])).toThrow(/activity 要是活動的種類/)
    expect(() => mk([ev('ev_x', { kind: 'start', activity: 'opinion', setup: 'x' })])).toThrow(/setup 要是/)
    expect(() => mk([{ ...ev('ev_x', { kind: 'start', activity: 'opinion' }), options: [{ id: 'go', text: '開。', outcomes: { any: [{ kind: 'start', activity: 'opinion' }, { kind: 'chain', event: 'ev_y' }] } }] }])).toThrow(/最多一個/)
    expect(() => mk([{ ...ev('ev_x', { kind: 'start', activity: 'opinion' }), options: [{ id: 'go', text: '開。', adult_scene: { when: 'always', circles: [['$pc']] }, outcomes: { any: [{ kind: 'start', activity: 'opinion' }] } }] }])).toThrow(/同一個選項/)
    // 資料可以加 startable
    expect(() => mk([ev('ev_x', { kind: 'start', activity: 'event' })], { event_rule: [{ id: 'default', startable: ['opinion', 'event'] }] })).not.toThrow()
    expect(() => mk([ev('ev_x', { kind: 'start', activity: 'opinion' })], { event_rule: [{ id: 'default', startable: 'opinion' }] })).toThrow(/startable 要是/)
  })
})

// ===================================================================================================================
describe('M5-opinion 留下的三個鍵（OPINION 5.2 的性格表）', () => {
  const fooPack = (opps: Rec[]): ContentPack => ({ id: 'foes', content: { pr_opponent: opps } }) as unknown as ContentPack
  const base = { strength: 1, start: 'opposite', cell_priority: {}, faction: 'f_alpha' }

  it('緋櫻 capture_when：前三回合只發稿存聲量，不佔領；第四回合起才佔', () => {
    const g = make({ packs: [fooPack([{ ...base, id: 'pr_hz', name: '緋櫻', strength: 3, actions: act(['release', 'always']), capture_when: 'round >= 4' }])] })
    begin(g, { foe: 'pr_hz' })
    setCells(g, ['whisper', 'kaleido'], ['tape'])
    for (let i = 0; i < 3; i++) {
      const [r] = turn(g)
      expect(beats(r!, 'opinion.foe.capture')[0]!.data).toMatchObject({ hold: true })
      expect(W(g).cells.tape.owner).toBe('foe')
      expect(Object.values(W(g).cells).filter((c) => c.owner === 'foe')).toHaveLength(1)
    }
    expect(W(g).voice.foe).toBeGreaterThan(0)
    turn(g)
    expect(Object.values(W(g).cells).filter((c) => c.owner === 'foe').length).toBeGreaterThan(1)
  })

  it('蜜腺 cred_def：你的公信力低時，你搶它的格子防守更高；高則更低', () => {
    const steps = [{ lt: 30, amount: 3 }, { lt: 50, gte: 30, amount: 1 }, { gte: 80, amount: -1 }]
    const g = make({ packs: [fooPack([{ ...base, id: 'pr_mi', name: '蜜腺', actions: act(['release', 'always']), signature: { id: 'sig', text: '公信力低的搶不動', effect: { cred_def: steps } } }])] })
    begin(g, { foe: 'pr_mi' })
    setCells(g, ['whisper', 'wall'], ['kaleido'])
    const need = (cred: number): number => {
      setMeterRaw(g, 'credibility', cred)
      return (opinionView(g.k, g.state) as { cells: Array<{ id: string; need: number }> }).cells.find((c) => c.id === 'kaleido')!.need
    }
    expect([need(20), need(40), need(60), need(90)]).toEqual([6, 4, 3, 2])
    // 搶沒人的格子不受影響
    expect(defenseOf(W(g), 'relay', 'you', opinionRules(g.k), { cred: 20 })).toBe(2)
    expect(() => make({ packs: [fooPack([{ ...base, id: 'pr_bad', name: 'x', actions: act(['release', 'always']), signature: { id: 's', text: 't', effect: { cred_def: [{ amount: 1 }] } } }])] })).toThrow(/cred_def/)
  })

  it('潔絲：mimic 的行動表能用料、說法、手段與主播的技能；推薦位 first_capture：第一回合第一次一定搶萬華鏡、不看相鄰', () => {
    const jess = {
      ...base, id: 'pr_jess', name: '潔絲', strength: 3, mimic: { open: [6, 6] }, first_capture: { cell: 'kaleido', any_adjacent: true },
      actions: act(['fuel', 'always'], ['line', 'always'], ['guard', 'always'], ['shift', 'always'], ['army', 'always'], ['host', 'always']),
    }
    const g = make({ packs: [fooPack([jess])] })
    begin(g, { foe: 'pr_jess' })
    W(g).voice.you = 4
    const [r] = turn(g)
    // 開放的六種都有可能做到；至少做了料（聲量）與佔領萬華鏡
    expect(W(g).cells.kaleido.owner).toBe('foe')
    const first = beats(r!, 'opinion.foe.capture')[0]!.data as { cell: string }
    expect(first.cell).toBe('kaleido')
    expect(W(g).foe_state.first_done).toBe(true)
    const tags = r!.timeline.map((b) => b.tag).filter((t) => t?.startsWith('opinion.foe.'))
    expect(tags).toEqual(expect.arrayContaining(['opinion.foe.fuel', 'opinion.foe.line']))
    // 第二回合不再強制
    turn(g)
    // 鏡像的行動要寫 mimic
    expect(() => make({ packs: [fooPack([{ ...base, id: 'pr_x', name: 'x', actions: act(['fuel', 'always']) }])] })).toThrow(/要寫 mimic/)
    expect(() => make({ packs: [fooPack([{ ...base, id: 'pr_y', name: 'x', actions: act(['release', 'always']), first_capture: { cell: 'moon' } }])] })).toThrow(/first_capture/)
    expect(() => make({ packs: [fooPack([{ ...base, id: 'pr_z', name: 'x', actions: act(['release', 'always']), capture_when: 'mood > 3' }])] })).toThrow(/capture/)
  })

  it('鏡像對手各個新行動的效果：設防讓你下一回合搶它的格子防守 +1；水軍被拆穿風向往你；轉移焦點雙方各 −2；造勢多佔一格', () => {
    const mimic = (doWhat: string) => ({ ...base, id: 'pr_m', name: '鏡', strength: 3, mimic: { open: [1, 1] }, actions: act([doWhat, 'always']) })
    const guard = make({ packs: [fooPack([mimic('guard')])] })
    begin(guard, { foe: 'pr_m' })
    setCells(guard, ['whisper'], ['kaleido'])
    turn(guard)
    expect(W(guard).foe_state.guard).toBe(2)
    expect(defenseOf(W(guard), 'kaleido', 'you', opinionRules(guard.k))).toBe(4)
    const shift = make({ packs: [fooPack([mimic('shift')])] })
    begin(shift, { foe: 'pr_m' })
    W(shift).voice.you = 5
    W(shift).voice.foe = 5
    turn(shift)
    expect(W(shift).voice.you).toBeLessThan(5)
    const host = make({ packs: [fooPack([mimic('host')])] })
    begin(host, { foe: 'pr_m' })
    setCells(host, ['whisper'], ['kaleido'])
    W(host).voice.foe = 6
    const [r] = turn(host)
    expect(beats(r!, 'opinion.foe.capture').length).toBeGreaterThanOrEqual(1)
    expect(beats(r!, 'opinion.foe.host')).toHaveLength(1)
  })
})

// ===================================================================================================================
describe('分層與規則表', () => {
  it('規則表蓋得掉編輯點、帶料、豔名、後果的數字；壞值在載入時被擋', () => {
    const g = make({ extra: { opinion_rule: [{ id: 'default', ep_paths: { streamer: 'down' }, bring_max: 2, fame: { step: 10 }, after: { major: { hostility: 99 } }, deck: { fuel_div: 1 } }] } })
    const r = opinionRules(g.k)
    expect(r.ep_paths).toMatchObject({ streamer: 'down', idol: 'up' })
    expect([r.bring_max, r.fame.step, r.fame.max, r.after.major.hostility, r.after.major.standing, r.deck.fuel_div]).toEqual([2, 10, 2, 99, -10, 1])
    expect(deskOptions(g.k, g.state).find((o) => o.actor === 's3')!.ep).toBe(3)
    expect(DEFAULT_OPINION_RULES.bring_max).toBe(6)
    expect(() => make({ extra: { opinion_rule: [{ id: 'default', fame: { step: 0 }, after: { epic: {} }, ep_paths: { x: 'sideways' }, generic: { strength: [1] } }] } })).toThrow(/fame\.step.*|after\.epic|ep_paths\.x|generic\.strength/s)
  })
})
