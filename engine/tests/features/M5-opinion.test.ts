// 驗收測試：dev/work/M5-opinion.md（cpp-feature）。輿論戰的本體：九格棋盤、回合、牌、佔領與防守、對手、城市事件、四級結果。
// 規格：OPINION 第 3、4、5 節；DATA 6.3、9.1；ENEMIES 1.5；dev/adr/0020 第五節、V31～V34、V39。
// 內容一律用測試自帶的最小假資料：一個議題（分數照 OPINION 3.2 的大眾議題）、幾個對手（強度 1、強度 3 帶追擊、center 開場的、什麼都不做的）、
// 玩具的寫法把牌塞進手上（直接改狀態裡的手牌）。公信力用替身量表（channel 沒裝）。
// 骰子：d20 從種子、游標、用途導出；要固定結果就掃游標找到想要的那一顆（草稿是純函式，不改狀態）。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ContentPack, Feature, Report, ReportDraft } from '../../src'
import { ActionBlocked, ContentError } from '../../src'
import {
  OPINION_CELLS, Run, answerBribe, capture, captureBlockOf, concede, defenseOf, endTurn, neighbors, opinionFeature, opinionView, parseWhen, evalWhen, playCard, playBlock, readWar, scoreOf, settle, startDraft, whenVars,
  DEFAULT_OPINION_RULES, normalizeCellMap, oppositeOf,
} from '../../src/features/opinion'
import type { Cell, War, WhenVars } from '../../src/features/opinion'
import { makeActor, makeGame, meterFeature, METER_CONTENT, testMeter } from '../../src/testkit'

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

/** OPINION 3.2 的大眾議題：萬華鏡 3、緋櫻 2、其餘 1，地下轉播站 0。 */
const SC: Record<string, number> = { kaleido: 3, sakura: 2, nightingale: 1, tape: 1, doujin: 1, fanclub: 1, whisper: 1, wall: 1, relay: 0 }
const INV = { factions: ['f_alpha'], people: [], types: ['scandal'] }
const PR_PRIORITY = {}

const releaseTimes = (n: number) => Array.from({ length: n }, () => ({ do: 'release', when: 'always' }))

const PACK: ContentPack = {
  id: 'op_test',
  content: {
    topic: [
      { id: 'tp_ignite', name: '測試引爆', kind: 'ignite', scores: SC, involves: INV },
      { id: 'tp_smear', name: '測試抹黑', kind: 'smear', scores: SC, involves: INV },
      { id: 'tp_douse', name: '測試滅火', kind: 'douse', scores: SC, involves: INV },
      { id: 'tp_wash', name: '測試洗白', kind: 'whitewash', scores: SC, involves: INV },
      { id: 'tp_frame', name: '測試嫁禍', kind: 'frame', scores: SC, involves: INV, target_cell: 'sakura' },
      { id: 'tp_short', name: '短的議題', kind: 'ignite', scores: SC, involves: INV, rounds: 4 },
    ],
    pr_opponent: [
      { id: 'pr_1', name: '小公司的公關', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: PR_PRIORITY, actions: [{ do: 'release', when: 'always' }] },
      { id: 'pr_3', name: '老練的公關', faction: 'f_beta', strength: 3, start: 'opposite', cell_priority: PR_PRIORITY, actions: [{ do: 'chase', when: 'always' }, ...releaseTimes(3)] },
      { id: 'pr_center', name: '中央的巨頭', strength: 2, start: 'center', cell_priority: PR_PRIORITY, actions: [{ do: 'release', when: 'always' }] },
      { id: 'pr_idle', name: '不動的對手', strength: 1, start: 'opposite', cell_priority: PR_PRIORITY, actions: [{ do: 'release', when: 'round > 99' }] },
      { id: 'pr_bribe', name: '愛收買的對手', strength: 1, start: 'opposite', cell_priority: PR_PRIORITY, actions: [{ do: 'release', when: 'round > 99' }], once: [{ do: 'bribe', when: 'always', offer_per_grade: 1000 }] },
    ],
    opinion_card: [{ id: 'card_fact', name: '查證過的報導', kind: 'line', cost: 2, wind: 2 }],
  },
}

/** 公信力的替身量表（channel 沒裝時用）。 */
const CRED: Feature = meterFeature(testMeter({ kind: 'credibility', owner: 'test', name: '公信力', min: 0, max: 100, start: 50 }))

/** 聽 activity.end 的替身：記下 opinion 的收場。 */
interface Ended { kind: string; outcome: string; result: Record<string, any> }
const ends: Ended[] = []
const LISTEN: Feature = {
  id: 'op_listen',
  install(k) {
    k.hooks.on('activity.end', 'op_listen', ({ kind, outcome, result }) => {
      if (kind === 'opinion' || kind === 'face.opinion') ends.push({ kind, outcome, result: result as Record<string, any> })
      return undefined
    })
  },
}

interface Opts {
  cred?: boolean
  seed?: number
  packs?: ContentPack[]
  difficulty?: string
  extra?: Array<Record<string, unknown>>
}

const make = (o: Opts = {}) => {
  const { game } = makeGame({
    features: [...(o.cred ? [CRED] : []), opinionFeature, LISTEN],
    content: [METER_CONTENT, PACK, ...(o.packs ?? [])],
    seed: o.seed ?? 7,
    actors: [makeActor({ id: 'bud', name: '夥伴', role: 'companion' })],
    patch: { time: { day: 3, hour: 10, minute: 0 }, ...(o.difficulty ? { rules: { difficulty: o.difficulty } as never } : {}) },
  })
  ends.length = 0
  return game
}
type G = ReturnType<typeof make>

const W = (g: G): War => (g.state.ext.opinion as { war: War }).war
const gone = (g: G): boolean => g.state.ext.opinion === undefined
const begin = (g: G, setup: Record<string, unknown> = {}) => g.launch('opinion', { topic: 'tp_ignite', foe: 'pr_1', ...setup })
const play = (g: G, index: number, extra: Record<string, unknown> = {}) => g.commit(playCard(g.k, g.state, { index, ...extra }))
const cap = (g: G, cell: string) => g.commit(capture(g.k, g.state, { cell }))
const turn = (g: G) => g.commit(endTurn(g.k, g.state))
const tags = (r: Report | ReportDraft): string[] => r.timeline.map((b) => b.tag ?? '')
const countTag = (r: Report | ReportDraft, tag: string): number => tags(r).filter((t) => t === tag).length
const reason = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
/** 直接把格子擺成想要的樣子（玩具的寫法）。 */
const setCells = (g: G, you: Cell[], foe: Cell[]): void => {
  for (const c of OPINION_CELLS) W(g).cells[c] = { owner: you.includes(c) ? 'you' : foe.includes(c) ? 'foe' : null }
}
const warOf = (d: ReportDraft): War | null => (d.changes.find((c) => c.op === 'opinion.war') as unknown as { war: War | null }).war
const sys = (action: string): ReportDraft => ({ kind: 'action', action, location: {}, party: [], timeline: [], changes: [], outcome: { result: 'ok', summary: '測試' } })

/** 掃游標，找到讓 pick 成立的那一個（草稿不改狀態）。 */
function scanCursor(g: G, build: () => ReportDraft, pick: (d: ReportDraft) => boolean, max = 600): ReportDraft {
  const keep = g.state.rng.cursor
  for (let c = 0; c < max; c++) {
    g.state.rng.cursor = c
    const d = build()
    if (pick(d)) return d
  }
  g.state.rng.cursor = keep
  throw new Error('掃不到想要的骰面')
}

const rollOf = (d: ReportDraft): number => (d.timeline.find((b) => b.tag === 'opinion.play')!.data as { roll: number }).roll

// ===================================================================================================================
describe('格子與相鄰（OPINION 3.1、3.3；V31）', () => {
  it('九格的鄰居逐一對（上下左右，斜的不算）', () => {
    expect(Object.fromEntries(OPINION_CELLS.map((c) => [c, neighbors(c)]))).toEqual({
      doujin: ['tape', 'sakura'], tape: ['doujin', 'fanclub', 'kaleido'], fanclub: ['tape', 'nightingale'],
      sakura: ['doujin', 'kaleido', 'wall'], kaleido: ['tape', 'sakura', 'nightingale', 'whisper'], nightingale: ['fanclub', 'kaleido', 'relay'],
      wall: ['sakura', 'whisper'], whisper: ['kaleido', 'wall', 'relay'], relay: ['nightingale', 'whisper'],
    })
    // 鄰居是互相的
    for (const a of OPINION_CELLS) for (const b of neighbors(a)) expect(neighbors(b)).toContain(a)
  })

  it('對面：牆報對應援圈、街上的耳語對帶子街、地下轉播站對同人圈', () => {
    expect(oppositeOf('wall')).toBe('fanclub')
    expect(oppositeOf('whisper')).toBe('tape')
    expect(oppositeOf('relay')).toBe('doujin')
    expect(oppositeOf('fanclub')).toBe('wall')
  })

  it('不相鄰的佔不了，原因是一句完整的話；相鄰、聲量夠就佔得下', () => {
    const g = make()
    begin(g)
    W(g).voice.you = 6
    expect(captureBlockOf(g.k, g.state, { cell: 'doujin' })).toBe('「同人圈」和你佔著的格子不相鄰（只算上下左右）。')
    expect(captureBlockOf(g.k, g.state, { cell: 'tape' })).toBe('「帶子街」和你佔著的格子不相鄰（只算上下左右）。')
    expect(captureBlockOf(g.k, g.state, { cell: 'whisper' })).toBe('「街上的耳語」已經是你的了。')
    expect(reason(() => capture(g.k, g.state, { cell: 'sakura' }))).toContain('不相鄰')
    expect(captureBlockOf(g.k, g.state, { cell: 'wall' })).toBeNull()
    expect(captureBlockOf(g.k, g.state, { cell: 'nope' })).toContain('不是格子的 id')
  })
})

// ===================================================================================================================
describe('防守與佔領（OPINION 3.3）', () => {
  /** 你在街上的耳語、對手在帶子街，再各放一格方便比較。 */
  const warAt = (wind: number): War => {
    const g = make()
    begin(g)
    const w = structuredClone(W(g))
    w.wind = wind
    return w
  }

  it('沒人的格子 2；你搶對手的 3 − 風向（最少 0）：風向 −2、0、+3 各對', () => {
    const w = warAt(0)
    w.cells.kaleido = { owner: 'foe' }
    for (const [wind, want] of [[-2, 5], [0, 3], [3, 0], [5, 0]] as const) {
      w.wind = wind
      expect(defenseOf(w, 'kaleido', 'you'), `風向 ${wind}`).toBe(want)
    }
    expect(defenseOf(w, 'wall', 'you')).toBe(2)
    expect(defenseOf(w, 'relay', 'foe')).toBe(2)
  })

  it('對手搶你的 3 ＋ 風向（最少 0）：風向 −2、0、+3 各對', () => {
    const w = warAt(0)
    w.cells.kaleido = { owner: 'you' }
    for (const [wind, want] of [[-2, 1], [0, 3], [3, 6], [-3, 0], [-5, 0]] as const) {
      w.wind = wind
      expect(defenseOf(w, 'kaleido', 'foe'), `風向 ${wind}`).toBe(want)
    }
  })

  it('佔下來之後聲量扣掉那一格的防守；聲量不夠被擋（寫出要多少、有多少）', () => {
    const g = make()
    begin(g)
    W(g).voice.you = 1
    expect(captureBlockOf(g.k, g.state, { cell: 'wall' })).toBe('聲量不夠：搶「牆報」要 2，你只有 1。')
    expect(reason(() => capture(g.k, g.state, { cell: 'wall' }))).toContain('聲量不夠')
    W(g).voice.you = 5
    const [r] = cap(g, 'wall')
    expect(r!.kind).toBe('broadcast')
    expect(r!.action).toBe('opinion.capture')
    expect(W(g).cells.wall.owner).toBe('you')
    expect(W(g).voice.you).toBe(3)
    // 搶對手的格子：風向 +2 時只要 1
    setCells(g, ['whisper'], ['kaleido'])
    W(g).wind = 2
    W(g).captured = 0
    W(g).voice.you = 4
    cap(g, 'kaleido')
    expect(W(g).voice.you).toBe(3)
    expect(W(g).cells.kaleido.owner).toBe('you')
  })

  it('佔領每回合一次', () => {
    const g = make()
    begin(g)
    W(g).voice.you = 9
    cap(g, 'wall')
    expect(captureBlockOf(g.k, g.state, { cell: 'relay' })).toBe('這一回合已經佔領過了。')
    expect(opinionView(g.k, g.state).active && (opinionView(g.k, g.state) as { can_capture: boolean }).can_capture).toBe(false)
  })

  it('分數：自己格子的分數合計', () => {
    const g = make()
    begin(g)
    setCells(g, ['kaleido', 'sakura', 'relay'], ['tape'])
    expect(scoreOf(W(g), 'you')).toBe(5)
    expect(scoreOf(W(g), 'foe')).toBe(1)
  })
})

// ===================================================================================================================
describe('聲量、風向、編輯點、手牌（OPINION 4.1、4.2）', () => {
  it('開場：聲量 0、風向 0、手牌 3 張再抽 2 張＝5 張；編輯點是基礎的 2', () => {
    const g = make()
    begin(g)
    const w = W(g)
    expect(w.voice).toEqual({ you: 0, foe: 0 })
    expect(w.wind).toBe(0)
    expect(w.hand).toHaveLength(5)
    expect(w.deck).toHaveLength(4)
    expect(w.desk).toEqual([{ actor: 'pc', ep: 2, ep_max: 2 }])
    expect(w.round).toBe(1)
  })

  it('牌庫：九張基本牌（採訪 3、加碼 1、帶風向 2、設防、降流、轉移焦點各 1），洗過', () => {
    const g = make()
    begin(g)
    const all = [...W(g).hand, ...W(g).deck].sort()
    expect(all).toEqual(['card_boost', 'card_guard', 'card_interview', 'card_interview', 'card_interview', 'card_mute', 'card_shift', 'card_wind', 'card_wind'])
  })

  it('聲量夾 0～10、風向夾 −5～+5', () => {
    const g = make()
    begin(g)
    W(g).hand = ['card_interview', 'card_interview', 'card_wind', 'card_wind']
    W(g).desk[0]!.ep = 9
    W(g).voice.you = 9
    play(g, 0)
    expect(W(g).voice.you).toBe(10)
    W(g).wind = 4
    play(g, 1)
    expect(W(g).wind).toBe(5)
    // 降流與轉移焦點不會把聲量扣到負的
    W(g).hand = ['card_shift', 'card_mute']
    W(g).voice = { you: 1, foe: 1 }
    play(g, 0)
    expect(W(g).voice).toEqual({ you: 0, foe: 0 })
    play(g, 0)
    expect(W(g).voice.foe).toBe(0)
  })

  it('編輯點不累積：每回合回到上限；出牌會花、不夠就出不了（原因寫出要幾點）', () => {
    const g = make()
    begin(g)
    W(g).hand = ['card_boost', 'card_interview', 'card_interview']
    play(g, 0)
    expect(W(g).desk[0]!.ep).toBe(0)
    expect(playBlock(g.k, g.state, { index: 0 })).toContain('編輯點不夠')
    expect(reason(() => playCard(g.k, g.state, { index: 0 }))).toBe('編輯點不夠：「採訪」要 1 點，你最多只有 0 點（一張牌由一個人付）。')
    turn(g)
    expect(W(g).desk[0]!.ep).toBe(2)
    // 沒花的也不累積
    turn(g)
    expect(W(g).desk[0]!.ep).toBe(2)
  })

  it('手牌上限 5：每回合抽 2 張，滿了就不抽', () => {
    const g = make()
    begin(g)
    expect(W(g).hand).toHaveLength(5)
    const r = turn(g)[0]!
    expect(W(g).hand).toHaveLength(5)
    expect(tags(r)).not.toContain('opinion.draw')
    // 手上剩 2 張：抽到 4 張
    W(g).discard.push(...W(g).hand.splice(2))
    turn(g)
    expect(W(g).hand).toHaveLength(4)
  })

  it('牌庫抽完，棄牌洗回來（那一拍有記）', () => {
    const g = make()
    begin(g)
    W(g).discard = [...W(g).hand, ...W(g).deck]
    W(g).hand = []
    W(g).deck = []
    const r = turn(g)[0]!
    expect(tags(r)).toContain('opinion.reshuffle')
    expect(W(g).hand).toHaveLength(2)
    expect(W(g).deck.length + W(g).hand.length).toBe(9)
    expect(W(g).discard).toEqual([])
  })

  it('一張牌由一個人付：兩個人坐編輯台時各用各的編輯點，不能合付', () => {
    const g = make()
    begin(g, { desk: [{ actor: 'pc', ep: 1 }, { actor: 'bud', ep: 2 }] })
    expect(W(g).desk).toEqual([{ actor: 'pc', ep: 1, ep_max: 1 }, { actor: 'bud', ep: 2, ep_max: 2 }])
    W(g).hand = ['card_boost', 'card_interview']
    play(g, 0)
    expect(W(g).desk.map((s) => s.ep)).toEqual([1, 0])
    // 剩 1 點的那個人付得起 1 點的牌
    play(g, 0, { actor: 'pc' })
    expect(W(g).desk.map((s) => s.ep)).toEqual([0, 0])
    // 各剩 1 點也付不起 2 點的牌
    W(g).hand = ['card_boost']
    W(g).desk[0]!.ep = 1
    W(g).desk[1]!.ep = 1
    expect(playBlock(g.k, g.state, { index: 0 })).toContain('編輯點不夠')
  })

  it('編制：坐的人要在名冊裡、最多兩個、不能坐兩個位子', () => {
    const g = make()
    expect(reason(() => begin(g, { desk: ['ghost'] }))).toContain('找不到要坐編輯台的人')
    expect(reason(() => begin(g, { desk: ['pc', 'bud', 'pc'] }))).toContain('最多坐兩個人')
    expect(reason(() => begin(g, { desk: ['pc', 'pc'] }))).toContain('不能坐兩個位子')
  })
})

// ===================================================================================================================
describe('三種牌（OPINION 4.3）', () => {
  it('料加聲量，照戰役等級加（I、II 0；III、IV +1；V +2）', () => {
    for (const [grade, want] of [[1, 2], [2, 2], [3, 3], [4, 3], [5, 4]] as const) {
      const g = make()
      begin(g, { grade })
      W(g).hand = ['card_interview']
      play(g, 0)
      expect(W(g).voice.you, `等級 ${grade}`).toBe(want)
    }
    // 內幕：料 +4、不能被下架
    const g = make()
    begin(g, { grade: 3 })
    W(g).hand = ['card_inside_scoop']
    W(g).desk[0]!.ep = 2
    play(g, 0)
    expect(W(g).voice.you).toBe(5)
  })

  it('說法推風向；公信力 60 以上每張 +1、低於 30 每張 −1（最少 0）；沒有公信力的量表就不加減', () => {
    const plain = make()
    begin(plain)
    W(plain).hand = ['card_wind']
    play(plain, 0)
    expect(W(plain).wind).toBe(1)
    for (const [cred, want] of [[80, 2], [60, 2], [59, 1], [30, 1], [29, 0]] as const) {
      const g = make({ cred: true })
      g.commit({ ...sys('test.cred'), changes: [{ op: 'meter', kind: 'credibility', key: '_', set: cred }] })
      begin(g)
      W(g).hand = ['card_wind']
      play(g, 0)
      expect(W(g).wind, `公信力 ${cred}`).toBe(want)
    }
  })

  it('手段：降流（對手聲量 −2）、轉移焦點（雙方各 −2）、設防（選自己的一格）', () => {
    const g = make()
    begin(g)
    W(g).hand = ['card_mute', 'card_shift', 'card_guard']
    W(g).desk[0]!.ep = 9
    W(g).voice = { you: 5, foe: 6 }
    play(g, 0)
    expect(W(g).voice).toEqual({ you: 5, foe: 4 })
    play(g, 0)
    expect(W(g).voice).toEqual({ you: 3, foe: 2 })
    expect(playBlock(g.k, g.state, { index: 0 })).toBe('要選一格來設防。')
    expect(playBlock(g.k, g.state, { index: 0, cell: 'tape' })).toContain('不是你的格子')
    play(g, 0, { cell: 'whisper' })
    expect(W(g).cells.whisper.guard).toBe(1)
    // 同一格不能同一回合設兩次防
    W(g).hand = ['card_guard']
    expect(playBlock(g.k, g.state, { index: 0 })).toBe('沒有可以設防的格子。')
  })

  it('出牌的報告：kind broadcast、action opinion.play；牌進棄牌', () => {
    const g = make()
    begin(g)
    W(g).hand = ['card_interview']
    const [r] = play(g, 0)
    expect(r!.kind).toBe('broadcast')
    expect(r!.action).toBe('opinion.play')
    expect(W(g).discard).toEqual(['card_interview'])
    expect(W(g).hand).toEqual([])
    expect(r!.changes.every((c) => ['opinion.war', 'rng'].includes(c.op))).toBe(true)
  })

  it('水軍：聲量 +3 並擲 d20，5 以下風向 −1（有公信力量表時另扣 3）；擲 6 沒事', () => {
    const g = make({ cred: true })
    begin(g)
    W(g).hand = ['card_army']
    const bad = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (d) => rollOf(d) <= 5)
    const [r] = g.commit(bad)
    expect(rollOf(bad)).toBeLessThanOrEqual(5)
    expect(W(g).voice.you).toBe(3)
    expect(W(g).wind).toBe(-1)
    expect(countTag(r!, 'opinion.bust')).toBe(1)
    expect(g.state.meters).toBeDefined()

    const g2 = make({ cred: true })
    begin(g2)
    W(g2).hand = ['card_army']
    const ok = scanCursor(g2, () => playCard(g2.k, g2.state, { index: 0 }), (d) => rollOf(d) >= 6)
    const [r2] = g2.commit(ok)
    expect(W(g2).voice.you).toBe(3)
    expect(W(g2).wind).toBe(0)
    expect(countTag(r2!, 'opinion.bust')).toBe(0)
    // 擲 5 剛好被拆穿、擲 6 剛好沒事（邊界）
    for (const [n, busted] of [[5, true], [6, false]] as const) {
      const g3 = make()
      begin(g3)
      W(g3).hand = ['card_army']
      const d = scanCursor(g3, () => playCard(g3.k, g3.state, { index: 0 }), (x) => rollOf(x) === n)
      expect(warOf(d)!.wind).toBe(busted ? -1 : 0)
    }
  })

  it('被拆穿的水軍：有公信力的量表就扣 3（沒有量表就不扣、也不出錯）', () => {
    const g = make({ cred: true })
    begin(g)
    W(g).hand = ['card_army']
    const bad = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (d) => rollOf(d) <= 5)
    expect(bad.changes).toContainEqual({ op: 'meter', kind: 'credibility', key: '_', delta: -3 })
    g.commit(bad)
    const nometer = make()
    begin(nometer)
    W(nometer).hand = ['card_army']
    const bad2 = scanCursor(nometer, () => playCard(nometer.k, nometer.state, { index: 0 }), (d) => rollOf(d) <= 5)
    expect(bad2.changes.some((c) => c.op === 'meter')).toBe(false)
  })

  it('假料：牌面照打、擲 d20 6 以下被拆穿——聲量收回、風向 −2', () => {
    const pack: ContentPack = { id: 'fake', content: { opinion_card: [{ id: 'card_fake', name: '假料', kind: 'fuel', cost: 1, voice: 5, fake: true }] } }
    const g = make({ packs: [pack] })
    begin(g)
    W(g).hand = ['card_fake']
    const rolls = (d: ReportDraft): number => (d.timeline.find((b) => b.tag === 'opinion.roll')!.data as { roll: number }).roll
    const bad = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (d) => rolls(d) <= 6)
    const w = warOf(bad)!
    expect(w.wind).toBe(-2)
    expect(w.voice.you).toBe(0)
    const ok = scanCursor(g, () => playCard(g.k, g.state, { index: 0 }), (d) => rolls(d) >= 7)
    expect(warOf(ok)!.wind).toBe(0)
    expect(warOf(ok)!.voice.you).toBe(5)
  })
})

// ===================================================================================================================
describe('設防（OPINION 4.3）', () => {
  it('設防的格子對手那一回合搶不了，下一回合可以', () => {
    const g = make()
    begin(g)
    // 你在耳語與萬華鏡，對手在帶子街；對手最想搶的是萬華鏡（分數 3）
    setCells(g, ['whisper', 'kaleido'], ['tape'])
    W(g).hand = ['card_guard']
    play(g, 0, { cell: 'kaleido' })
    const r1 = turn(g)[0]!
    expect(W(g).cells.kaleido.owner).toBe('you')
    expect(r1.timeline.map((b) => b.text).join('')).not.toContain('「萬華鏡」')
    expect(W(g).round).toBe(2)
    // 第二回合沒再設防：對手搶得走
    turn(g)
    expect(W(g).cells.kaleido.owner).toBe('foe')
  })

  it('設防只擋對手；你自己的行動不受影響', () => {
    const g = make()
    begin(g)
    W(g).hand = ['card_guard']
    W(g).voice.you = 6
    play(g, 0, { cell: 'whisper' })
    cap(g, 'wall')
    expect(W(g).cells.wall.owner).toBe('you')
  })
})

// ===================================================================================================================
describe('對手的公關點與行動表（OPINION 4.4、5.2；V39）', () => {
  const foeWith = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ id: 'pr_x', name: '測試對手', strength: 1, start: 'opposite', cell_priority: {}, actions, ...extra })

  it('公關點是強度 × 2：強度 1、2、3 是 2、4、6', () => {
    for (const [s, pts] of [[1, 2], [2, 4], [3, 6]] as const) {
      const g = make()
      begin(g, { strength: s })
      expect((opinionView(g.k, g.state) as { foe: { pr: number } }).foe.pr).toBe(pts)
      // 七個「發稿 always」每個花 1 點：真的花了幾點就發了幾次稿
      const g2 = make()
      begin(g2, { foe: foeWith(releaseTimes(7)), strength: s })
      const r = turn(g2)[0]!
      expect(countTag(r, 'opinion.foe.release'), `強度 ${s}`).toBe(pts)
    }
  })

  it('難度加減公關點（故事 −1、困難 +1、傳奇 +2），最少 1', () => {
    const pr = (difficulty: string, strength: number): number => {
      const g = make({ difficulty })
      begin(g, { strength })
      return (opinionView(g.k, g.state) as { foe: { pr: number } }).foe.pr
    }
    expect(pr('story', 1)).toBe(1)
    expect(pr('story', 3)).toBe(5)
    expect(pr('normal', 2)).toBe(4)
    expect(pr('hard', 2)).toBe(5)
    expect(pr('legend', 1)).toBe(4)
  })

  it('一回合最多掃三輪：只有一個行動時最多做三次', () => {
    const g = make()
    begin(g, { foe: foeWith([{ do: 'release', when: 'always' }]), strength: 3 })
    const r = turn(g)[0]!
    expect(countTag(r, 'opinion.foe.release')).toBe(3)
  })

  describe('when 的文法：每一種變數與比較各有成立與不成立的例子', () => {
    const base: WhenVars = { round: 3, wind: -1, voice: 4, your_voice: 2, score_gap: -2, can_capture: 2, hand: 3, cred: 50 }
    const cases: Array<[string, boolean]> = [
      ['round <= 3', true], ['round < 3', false], ['round >= 3', true], ['round > 3', false], ['round == 3', true], ['round == 4', false],
      ['wind > -3', true], ['wind > -1', false], ['wind < 0', true], ['wind >= 0', false],
      ['voice >= 4', true], ['voice >= 5', false],
      ['your_voice == 2', true], ['your_voice == 3', false],
      ['score_gap <= -2', true], ['score_gap > -2', false],
      ['can_capture >= 2', true], ['can_capture >= 3', false],
      ['hand > 2', true], ['hand > 3', false],
      ['cred < 60', true], ['cred >= 60', false],
      ['always', true],
      ['round >= 3 and can_capture >= 2', true], ['round >= 4 and can_capture >= 2', false], ['round >= 3 and wind > 0 and hand > 0', false],
    ]
    for (const [src, want] of cases) {
      it(`「${src}」${want ? '成立' : '不成立'}`, () => {
        const r = parseWhen(src)
        expect(r.ok).toBe(true)
        if (r.ok) expect(evalWhen(r.when, base)).toBe(want)
      })
    }

    it('寫壞的字串被擋：缺比較、不認得的變數與比較、or、結尾的 and、空字串', () => {
      for (const bad of ['round', 'round >> 3', 'foo > 1', 'round > x', '', '   ', 'round > 1 or wind < 0', 'round > 1 and', 'round = 3', 'round > 1.5']) {
        const r = parseWhen(bad)
        expect(r.ok, `「${bad}」`).toBe(false)
      }
    })

    it('內容載入時擋下寫壞的條件，指出是哪一筆的哪一條', () => {
      const bad: ContentPack = {
        id: 'bad_when',
        content: { pr_opponent: [{ id: 'pr_bad', name: '壞的', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'always' }, { do: 'deny', when: 'wind >> 1' }] }] },
      }
      let msg = ''
      try { make({ packs: [bad] }) } catch (e) { msg = (e as Error).message; expect(e).toBeInstanceOf(ContentError) }
      expect(msg).toContain('pr_opponent/pr_bad')
      expect(msg).toContain('actions[1].when「wind >> 1」寫錯了')
      // once 的條件也一樣
      const bad2: ContentPack = {
        id: 'bad_once',
        content: { pr_opponent: [{ id: 'pr_bad2', name: '壞的', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'always' }], once: [{ do: 'bribe', when: 'score_gap <=', offer_per_grade: 100 }] }] },
      }
      expect(() => make({ packs: [bad2] })).toThrow(/pr_opponent\/pr_bad2.*once\[0\]\.when/s)
    })

    it('whenVars：變數從戰役的狀態算（風向正的偏你、score_gap 是它減你的、can_capture 是它現在佔得下幾格）', () => {
      const g = make()
      begin(g)
      const w = W(g)
      w.wind = 2
      w.voice = { you: 4, foe: 3 }
      setCells(g, ['whisper', 'wall'], ['tape'])
      const v = whenVars(new Run(g.k, g.state, w, 't'))
      expect(v).toMatchObject({ round: 1, wind: 2, voice: 3, your_voice: 4, score_gap: -1, hand: 5, cred: 50 })
      // 對手在帶子街：旁邊是同人圈、應援圈、萬華鏡（都是沒人的 2、聲量 3 都付得起）
      expect(v.can_capture).toBe(3)
      w.voice.foe = 1
      expect(whenVars(new Run(g.k, g.state, w, 't')).can_capture).toBe(0)
    })

    it('行動照條件做：條件不成立就跳過、往下一條', () => {
      const actions = [{ do: 'mute', when: 'your_voice >= 5' }, { do: 'release', when: 'always' }]
      const hot = make()
      begin(hot, { foe: foeWith(actions), strength: 2 })
      W(hot).voice.you = 6
      const a = turn(hot)[0]!
      expect(countTag(a, 'opinion.foe.mute')).toBe(1)
      const cold = make()
      begin(cold, { foe: foeWith(actions), strength: 2 })
      W(cold).voice.you = 2
      const b = turn(cold)[0]!
      expect(countTag(b, 'opinion.foe.mute')).toBe(0)
      expect(countTag(b, 'opinion.foe.release')).toBeGreaterThan(0)
    })
  })

  it('行動的效果：發稿、否認、降流、反爆料都照戰役等級（發稿 +2／III 起 +3；否認 1／V 級 2；反爆料 2／V 級 3）', () => {
    const run = (grade: number, doing: string) => {
      const g = make()
      begin(g, { grade, foe: foeWith([{ do: doing, when: 'always' }]), strength: 3 })
      W(g).voice.you = 6
      turn(g)
      return W(g)
    }
    expect(run(1, 'release').foe_state).toBeDefined()
    // 發稿：1 級 +2、3 級 +3（強度 3 掃三輪＝三次，對手之後會用聲量佔格子，所以看那一拍的 data）
    const amount = (grade: number, doing: string, key: 'voice' | 'wind'): number => {
      const g = make()
      begin(g, { grade, foe: foeWith([{ do: doing, when: 'always' }]), strength: 3 })
      W(g).voice.you = 6
      const r = turn(g)[0]!
      return (r.timeline.find((b) => b.tag === `opinion.foe.${doing}`)!.data as Record<string, number>)[key]!
    }
    expect([1, 2, 3, 4, 5].map((n) => amount(n, 'release', 'voice'))).toEqual([2, 2, 3, 3, 3])
    expect([1, 3, 5].map((n) => amount(n, 'deny', 'wind'))).toEqual([-1, -1, -2])
    expect([1, 3, 5].map((n) => amount(n, 'counter', 'wind'))).toEqual([-2, -2, -3])
    expect(amount(1, 'mute', 'voice')).toBe(-2)
  })

  it('追擊只有強度 3：強度 2 的對手寫了也用不了；強度 3 一回合多佔一格', () => {
    const actions = [{ do: 'chase', when: 'always' }, ...releaseTimes(3)]
    const s2 = make()
    begin(s2, { foe: foeWith(actions), strength: 2 })
    const a = turn(s2)[0]!
    expect(countTag(a, 'opinion.foe.chase')).toBe(0)
    expect(a.timeline.filter((b) => b.tag === 'opinion.foe.capture' && (b.data as { cell: unknown }).cell !== null)).toHaveLength(1)
    const s3 = make()
    begin(s3, { foe: 'pr_3' })
    const b = turn(s3)[0]!
    expect(countTag(b, 'opinion.foe.chase')).toBe(1)
    expect(b.timeline.filter((x) => x.tag === 'opinion.foe.capture' && (x.data as { cell: unknown }).cell !== null)).toHaveLength(2)
  })

  it('律師函：你下一回合的編輯點 −1（只一回合）；最後一回合寄了沒用，不寄', () => {
    const g = make()
    begin(g, { foe: foeWith([{ do: 'lawyer', when: 'always' }]) })
    turn(g)
    expect(W(g).desk[0]!.ep).toBe(1)
    expect(W(g).foe_state.ep_penalty).toBeUndefined()
    // 一回合只寄一封：同一回合不會扣 2
    turn(g)
    expect(W(g).desk[0]!.ep).toBe(1)
    const last = make()
    begin(last, { foe: foeWith([{ do: 'lawyer', when: 'always' }]), rounds: 1 })
    const r = turn(last)[0]!
    expect(countTag(r, 'opinion.foe.lawyer')).toBe(0)
  })

  it('降流、律師函、下架、追擊每回合各一次（點數再多也一樣）', () => {
    for (const doing of ['mute', 'lawyer', 'takedown', 'chase']) {
      const g = make()
      begin(g, { foe: foeWith([{ do: doing, when: 'always' }]), strength: 3 })
      W(g).voice.you = 6
      expect(countTag(turn(g)[0]!, `opinion.foe.${doing}`), doing).toBe(1)
    }
    // 發稿、否認、反爆料沒有這個限制（只受點數與掃的輪數限制）
    const g = make()
    begin(g, { foe: foeWith([{ do: 'deny', when: 'always' }]), strength: 3 })
    expect(countTag(turn(g)[0]!, 'opinion.foe.deny')).toBe(3)
  })

  it('律師函也先扣第一個座位；兩個人坐編輯台時不夠扣的往下一個扣', () => {
    const g = make()
    begin(g, { foe: foeWith([{ do: 'lawyer', when: 'always' }], { signature: { id: 'big_letter', text: '律師函讓你 −2 點。', effect: { lawyer_ep: 2 } } }), desk: [{ actor: 'pc', ep: 1 }, { actor: 'bud', ep: 2 }] })
    turn(g)
    expect(W(g).desk.map((s) => s.ep)).toEqual([0, 1])
  })

  it('下架：隨機丟一張手牌（內幕不能被下架）', () => {
    const g = make()
    begin(g, { foe: foeWith([{ do: 'takedown', when: 'always' }]) })
    const before = W(g).hand.length
    const r = turn(g)[0]!
    expect(countTag(r, 'opinion.foe.takedown')).toBe(1)
    expect(W(g).discard).toHaveLength(1)
    expect(W(g).hand.length).toBeLessThanOrEqual(before)
    const g2 = make()
    begin(g2, { foe: foeWith([{ do: 'takedown', when: 'always' }]) })
    W(g2).hand = ['card_inside_scoop']
    W(g2).deck = []
    const r2 = turn(g2)[0]!
    expect(countTag(r2, 'opinion.foe.takedown')).toBe(0)
    expect(W(g2).hand).toContain('card_inside_scoop')
  })

  it('招牌：某個行動的花費、律師函的點數、收買的次數、搶某幾格的防守 −1、公信力低時說法減半', () => {
    // 花費：反爆料預設 2 點，招牌改 1 點
    const counters = (sig: unknown): number => {
      const g = make()
      begin(g, { foe: foeWith([{ do: 'counter', when: 'always' }], sig ? { signature: sig } : {}) })
      return countTag(turn(g)[0]!, 'opinion.foe.counter')
    }
    expect(counters(undefined)).toBe(1)
    expect(counters({ id: 'prepared', text: '反爆料只花 1 點。', effect: { cost: { counter: 1 } } })).toBe(2)
    // 搶某幾格防守 −1：對手在帶子街（聲量 2），沒人的同人圈防守 2、有招牌是 1
    const sigCap = (sig: unknown): number => {
      const g = make()
      begin(g, { foe: foeWith([{ do: 'release', when: 'round > 99' }], sig ? { signature: sig, cell_priority: { doujin: 9 } } : { cell_priority: { doujin: 9 } }) })
      W(g).voice.foe = 2
      turn(g)
      return W(g).voice.foe
    }
    expect(sigCap(undefined)).toBe(0)
    expect(sigCap({ id: 'cheap', text: '它搶同人圈的時候防守 −1。', effect: { def_minus: { cells: ['doujin'] } } })).toBe(1)
    // 公信力低時說法減半（需要公信力的量表）
    const wind = (sig: boolean): number => {
      const g = make({ cred: true })
      g.commit({ ...sys('test.cred'), changes: [{ op: 'meter', kind: 'credibility', key: '_', set: 40 }] })
      begin(g, { foe: foeWith([{ do: 'release', when: 'round > 99' }], sig ? { signature: { id: 'sweet', text: '公信力低於 50 時說法減半。', effect: { weak_line: { cred_below: 50 } } } } : {}) })
      W(g).hand = ['card_fact']
      play(g, 0)
      return W(g).wind
    }
    expect(wind(false)).toBe(2)
    expect(wind(true)).toBe(1)
  })

  it('mimic：每回合照固定亂數從行動表開放三到四種', () => {
    const six = ['release', 'deny', 'mute', 'counter', 'lawyer', 'takedown'].map((d) => ({ do: d, when: 'always' }))
    const g = make()
    begin(g, { foe: foeWith(six, { mimic: { open: [3, 4] } }), strength: 3 })
    const opens: string[][] = []
    for (let i = 0; i < 4; i++) {
      setCells(g, ['whisper', 'wall', 'relay', 'kaleido', 'sakura', 'nightingale', 'doujin', 'fanclub'], ['tape'])
      turn(g)
      opens.push(W(g).foe_state.open!)
    }
    for (const o of opens) {
      expect(o.length).toBeGreaterThanOrEqual(3)
      expect(o.length).toBeLessThanOrEqual(4)
      expect(new Set(o).size).toBe(o.length)
      for (const d of o) expect(six.map((a) => a.do)).toContain(d)
    }
    // 沒開放的行動這回合用不了
    const g2 = make()
    begin(g2, { foe: foeWith(six, { mimic: { open: [3, 3] } }), strength: 3 })
    const r = turn(g2)[0]!
    const used = new Set(r.timeline.filter((b) => /^opinion\.foe\.(release|deny|mute|counter|lawyer|takedown)$/.test(b.tag ?? '')).map((b) => b.tag!.replace('opinion.foe.', '')))
    for (const d of used) expect(W(g2).foe_state.open).toContain(d)
    // 一樣的種子一樣的結果
    const g3 = make()
    begin(g3, { foe: foeWith(six, { mimic: { open: [3, 3] } }), strength: 3 })
    turn(g3)
    expect(W(g3).foe_state.open).toEqual(W(g2).foe_state.open)
  })

  it('佔領按「權重 ×（分數 ＋ 1）」最高的；沒給權重的格子是 1', () => {
    const g = make()
    begin(g, { foe: foeWith([{ do: 'release', when: 'round > 99' }], { cell_priority: { fanclub: 5, doujin: 1, kaleido: 0 } }) })
    W(g).voice.foe = 6
    turn(g)
    // 對手在帶子街：旁邊是同人圈（1 分）、應援圈（1 分）、萬華鏡（3 分）；應援圈 5 × 2 最高
    expect(W(g).cells.fanclub.owner).toBe('foe')
    expect(W(g).cells.kaleido.owner).toBe(null)
  })

  it('萬華鏡式的對手從正中央開場；一般的在你的對面', () => {
    const g = make()
    begin(g, { foe: 'pr_center' })
    expect(W(g).cells.kaleido.owner).toBe('foe')
    expect(W(g).cells.whisper.owner).toBe('you')
    for (const [mine, theirs] of [['whisper', 'tape'], ['wall', 'fanclub'], ['relay', 'doujin']] as const) {
      const g2 = make()
      begin(g2, { your_start: mine })
      expect(W(g2).cells[mine].owner).toBe('you')
      expect(W(g2).cells[theirs].owner).toBe('foe')
      expect(OPINION_CELLS.filter((c) => W(g2).cells[c].owner !== null)).toHaveLength(2)
    }
    expect(reason(() => begin(make(), { your_start: 'kaleido' }))).toContain('街頭那一排')
  })
})

// ===================================================================================================================
describe('收買與找上門（這一張只做到停下來；V35、V36）', () => {
  it('收買：條件成立就停下來等你回應（價錢 = offer_per_grade × 等級）；沒回應之前別的動作都被擋', () => {
    const g = make()
    begin(g, { foe: 'pr_bribe', grade: 2 })
    const [r] = turn(g)
    expect(r!.outcome.result).toBe('bribe_offer')
    expect(W(g).pending).toBe('bribe')
    expect(W(g).offer).toBe(2000)
    expect(W(g).round).toBe(1)
    expect(W(g).foe_state.bribes).toBe(1)
    expect(playBlock(g.k, g.state, { index: 0 })).toContain('開了價')
    expect(captureBlockOf(g.k, g.state, { cell: 'wall' })).toContain('開了價')
    expect(reason(() => endTurn(g.k, g.state))).toContain('開了價')
    expect(opinionView(g.k, g.state)).toMatchObject({ pending: 'bribe', offer: 2000 })
  })

  it('回絕：照常打下去（對手的回合接著做完），不會再開同一次價', () => {
    const g = make()
    begin(g, { foe: 'pr_bribe' })
    turn(g)
    const [r] = g.commit(answerBribe(g.k, g.state, { accept: false }))
    expect(r!.action).toBe('opinion.bribe')
    expect(W(g).pending).toBeUndefined()
    expect(W(g).round).toBe(2)
    expect(tags(r!)).toContain('opinion.foe.start')
    // 收買預設只能一次：下一回合不再開價
    const [r2] = turn(g)
    expect(r2!.outcome.result).not.toBe('bribe_offer')
    expect(ends).toEqual([])
  })

  it('接受：戰役結束算敗（by bribe、帶價錢），活動直接交回', () => {
    const g = make()
    begin(g, { foe: 'pr_bribe', grade: 3 })
    turn(g)
    const [r] = g.commit(answerBribe(g.k, g.state, { accept: true }))
    expect(r!.outcome.result).toBe('lost')
    expect(gone(g)).toBe(true)
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ kind: 'opinion', outcome: 'lost' })
    expect(ends[0]!.result).toMatchObject({ by: 'bribe', bribed: 3000 })
  })

  it('招牌讓收買可以用兩次，第二次的價 ×1.5', () => {
    const foe = { id: 'pr_eden', name: '伊甸園', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'round > 99' }], once: [{ do: 'bribe', when: 'always', offer_per_grade: 1000 }], signature: { id: 'twice', text: '收買可以用兩次。', effect: { bribe_times: 2 } } }
    const g = make()
    begin(g, { foe })
    turn(g)
    expect(W(g).offer).toBe(1000)
    g.commit(answerBribe(g.k, g.state, { accept: false }))
    turn(g)
    expect(W(g).pending).toBe('bribe')
    expect(W(g).offer).toBe(1500)
    g.commit(answerBribe(g.k, g.state, { accept: false }))
    const [r] = turn(g)
    expect(r!.outcome.result).not.toBe('bribe_offer')
  })

  it('找上門：solo 當作沒有這個行動（照常打）；face 模式才停下來記 pending', () => {
    const foe = { id: 'pr_visit', name: '找上門的', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'round > 99' }], once: [{ do: 'visit', when: 'always', squad: 'en_squad' }] }
    const g = make()
    begin(g, { foe })
    const [r] = turn(g)
    expect(r!.outcome.result).toBe('turn')
    expect(W(g).pending).toBeUndefined()
    expect(W(g).foe_state.visited).toBe(false)
    const f = make()
    begin(f, { foe, mode: 'face' })
    expect(W(f).mode).toBe('face')
    const [r2] = turn(f)
    expect(r2!.outcome.result).toBe('visit')
    expect(W(f).pending).toBe('visit')
    expect(W(f).foe_state.visited).toBe(true)
  })
})

// ===================================================================================================================
describe('結束與四級結果（OPINION 5.1）', () => {
  it('清空立刻結束：把對手的格子清空是大勝，要結算才交回活動', () => {
    const g = make()
    begin(g)
    setCells(g, ['kaleido', 'whisper'], ['tape'])
    W(g).voice.you = 5
    const [r] = cap(g, 'tape')
    expect(r!.outcome.result).toBe('ended')
    expect(W(g).turn).toBe('ended')
    expect(W(g).result).toMatchObject({ outcome: 'major', by: 'wipe' })
    expect(W(g).round).toBe(1)
    expect(playBlock(g.k, g.state, { index: 0 })).toBe('這場輿論戰已經分出勝負了，先結算。')
    expect(reason(() => endTurn(g.k, g.state))).toBe('這場輿論戰已經分出勝負了，先結算。')
    expect(ends).toEqual([])
    const [e] = g.commit(settle(g.k, g.state))
    expect(e!.action).toBe('opinion.end')
    expect(e!.outcome.summary).toContain('大勝')
    expect(e!.kind).toBe('broadcast')
    expect(gone(g)).toBe(true)
    expect(ends).toHaveLength(1)
    expect(ends[0]!.outcome).toBe('major')
    expect(ends[0]!.result).toMatchObject({ topic: 'tp_ignite', kind: 'ignite', side: 'attack', you: 5, foe: 0, grade: 1, faction: 'f_alpha', rounds: 1, by: 'wipe' })
    expect(ends[0]!.result.cells.tape).toBe('you')
    expect(ends[0]!.result.cells.doujin).toBe(null)
  })

  it('你的格子被對手清空：立刻結束、算敗', () => {
    const g = make()
    begin(g, { foe: 'pr_3' })
    setCells(g, ['kaleido'], ['tape', 'nightingale'])
    W(g).voice.foe = 8
    const [r] = turn(g)
    expect(r!.outcome.result).toBe('ended')
    expect(W(g).result).toMatchObject({ outcome: 'lost', by: 'wipe' })
    g.commit(settle(g.k, g.state))
    expect(ends[0]!.outcome).toBe('lost')
  })

  const finishWith = (you: Cell[], foe: Cell[], setup: Record<string, unknown> = {}) => {
    const g = make()
    begin(g, { foe: 'pr_idle', rounds: 1, ...setup })
    setCells(g, you, foe)
    turn(g)
    return g
  }

  it('六回合打完，照分數差給四級：差 4 以上大勝、高一點到三點小勝、相同平手、低敗', () => {
    // 分數：萬華鏡 3、緋櫻 2、其餘 1、轉播站 0
    expect(finishWith(['kaleido', 'sakura', 'whisper'], ['tape', 'doujin'], {}).state.ext.opinion).toBeDefined()
    const out = (you: Cell[], foe: Cell[]): string => W(finishWith(you, foe)).result!.outcome
    expect(out(['kaleido', 'sakura', 'whisper'], ['tape'])).toBe('major') // 6 對 1
    expect(out(['kaleido', 'sakura', 'whisper'], ['tape', 'doujin'])).toBe('major') // 6 對 2：差 4
    expect(out(['kaleido', 'sakura', 'whisper'], ['tape', 'doujin', 'fanclub'])).toBe('minor') // 6 對 3：差 3
    expect(out(['kaleido', 'whisper'], ['sakura', 'tape'])).toBe('minor') // 4 對 3
    expect(out(['kaleido', 'whisper'], ['sakura', 'nightingale', 'tape'])).toBe('draw') // 4 對 4
    expect(out(['whisper', 'wall'], ['kaleido'])).toBe('lost') // 2 對 3
    expect(out(['relay', 'whisper'], ['sakura'])).toBe('lost')
  })

  it('打滿六回合才結算；進行中不結算；短的議題四回合', () => {
    const g = make()
    begin(g, { foe: 'pr_idle' })
    for (let i = 1; i <= 5; i++) {
      turn(g)
      expect(W(g).turn).toBe('you')
      expect(W(g).round).toBe(i + 1)
    }
    expect(reason(() => settle(g.k, g.state))).toBe('這場輿論戰還沒分出勝負。')
    const [r] = turn(g)
    expect(r!.outcome.result).toBe('ended')
    expect(W(g).turn).toBe('ended')
    expect(W(g).round).toBe(6)
    const s = make()
    begin(s, { topic: 'tp_short', foe: 'pr_idle' })
    expect(W(s).rounds).toBe(4)
    for (let i = 0; i < 4; i++) turn(s)
    expect(W(s).turn).toBe('ended')
  })

  it('嫁禍：分數高但沒佔著指定的那一格，只算平手（照設計：沒贏）；佔著才算贏；分數低照樣是敗', () => {
    const out = (you: Cell[], foe: Cell[]): { outcome: string; held: boolean | null } => {
      const g = make()
      begin(g, { topic: 'tp_frame', foe: 'pr_idle', rounds: 1 })
      setCells(g, you, foe)
      turn(g)
      return { outcome: W(g).result!.outcome, held: W(g).result!.target_held }
    }
    // 指定的是緋櫻映畫
    expect(out(['kaleido', 'sakura', 'whisper'], ['tape'])).toEqual({ outcome: 'major', held: true })
    expect(out(['kaleido', 'whisper'], ['tape'])).toEqual({ outcome: 'draw', held: false })
    expect(out(['whisper', 'wall'], ['kaleido', 'sakura'])).toEqual({ outcome: 'lost', held: false })
    expect(out(['sakura'], ['kaleido'])).toEqual({ outcome: 'lost', held: true })
  })

  it('opinion.end 發 activity.end：outcome 與 result（topic、kind、side、you、foe、cells、rounds、grade、faction）', () => {
    const g = make()
    begin(g, { foe: 'pr_idle', rounds: 2, grade: 4 })
    setCells(g, ['kaleido', 'whisper'], ['tape'])
    turn(g)
    turn(g)
    const [e] = g.commit(settle(g.k, g.state))
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ kind: 'opinion', outcome: 'minor' })
    expect(ends[0]!.result).toMatchObject({ topic: 'tp_ignite', kind: 'ignite', side: 'attack', you: 4, foe: 1, rounds: 2, grade: 4, faction: null, mode: 'solo' })
    expect(ends[0]!.result.cells).toMatchObject({ kaleido: 'you', whisper: 'you', tape: 'foe', doujin: null })
    expect(e!.outcome.result).toBe('minor')
    expect(g.state.reports.map((r) => r.action).filter((a) => a?.startsWith('opinion.'))).toEqual(['opinion.start', 'opinion.turn', 'opinion.turn', 'opinion.end'])
  })

  it('認輸：直接結算算敗，活動交回', () => {
    const g = make()
    begin(g)
    const [r] = g.commit(concede(g.k, g.state))
    expect(r!.action).toBe('opinion.concede')
    expect(r!.outcome.result).toBe('lost')
    expect(gone(g)).toBe(true)
    expect(ends[0]).toMatchObject({ outcome: 'lost' })
    expect(ends[0]!.result.by).toBe('concede')
    expect(reason(() => concede(g.k, g.state))).toBe('現在沒有輿論戰。')
  })
})

// ===================================================================================================================
describe('議題的開場（OPINION 5.1；V32）', () => {
  const owners = (g: G) => ({
    you: OPINION_CELLS.filter((c) => W(g).cells[c].owner === 'you'),
    foe: OPINION_CELLS.filter((c) => W(g).cells[c].owner === 'foe'),
  })

  it('引爆與抹黑：你在街頭（預設街上的耳語）、對手在對面；風向 0', () => {
    for (const topic of ['tp_ignite', 'tp_smear']) {
      const g = make()
      begin(g, { topic })
      expect(owners(g)).toEqual({ you: ['whisper'], foe: ['tape'] })
      expect(W(g).wind).toBe(0)
      expect(W(g).topic.side).toBe('attack')
    }
  })

  it('滅火：你是公關，佔主流那一排分數最高的兩格，對手從街頭一格打上來', () => {
    const g = make()
    begin(g, { topic: 'tp_douse' })
    expect(owners(g)).toEqual({ you: ['sakura', 'kaleido'], foe: ['relay'] })
    expect(W(g).topic.side).toBe('defend')
    expect(W(g).wind).toBe(0)
    // 萬華鏡是平台，不會當滅火的對手
    expect(reason(() => begin(make(), { topic: 'tp_douse', foe: 'pr_center' }))).toBe('萬華鏡是平台，不會當滅火的對手。')
  })

  it('洗白：對手已經佔了分數最高的三格，你只有一格，風向 −3', () => {
    const g = make()
    begin(g, { topic: 'tp_wash' })
    expect(owners(g).foe).toEqual(['doujin', 'sakura', 'kaleido'])
    expect(owners(g).you).toHaveLength(1)
    expect(owners(g).foe).not.toContain(owners(g).you[0])
    expect(W(g).wind).toBe(-3)
    expect(W(g).topic.side).toBe('defend')
    // 指定起始格：不能選對手已經佔著的
    const g2 = make()
    begin(g2, { topic: 'tp_wash', your_start: 'relay' })
    expect(owners(g2).you).toEqual(['relay'])
    expect(reason(() => begin(make(), { topic: 'tp_wash', your_start: 'kaleido' }))).toContain('已經是對手的格子')
  })

  it('嫁禍：同引爆，另外記下指定的一格', () => {
    const g = make()
    begin(g, { topic: 'tp_frame' })
    expect(owners(g)).toEqual({ you: ['whisper'], foe: ['tape'] })
    expect(W(g).topic.target_cell).toBe('sakura')
    expect(opinionView(g.k, g.state)).toMatchObject({ topic: { target_cell: 'sakura' } })
  })

  it('每一場開場聲量都是 0；議題沒給分數時從預設的四列隨機挑一列', () => {
    const g = make()
    begin(g, { topic: { kind: 'ignite', name: '臨時的', involves: { factions: [], people: [], types: [] }, scores: {} } })
    expect(W(g).voice).toEqual({ you: 0, foe: 0 })
    const total = Object.values(W(g).topic.scores).reduce((a, b) => a + b, 0)
    expect([10, 11, 12]).toContain(total)
  })

  it('setup 的整筆議題與對手要合格（不合格寫出哪裡不對）；找不到的 id 也是', () => {
    const g = make()
    expect(reason(() => begin(g, { topic: 'nope' }))).toBe('找不到議題「nope」。')
    expect(reason(() => begin(g, { foe: 'nope' }))).toBe('找不到對手「nope」。')
    expect(reason(() => begin(g, { topic: { kind: 'wat', name: 'x', involves: { factions: [], people: [], types: [] }, scores: SC } }))).toContain('議題的資料不合格')
    expect(reason(() => begin(g, { strength: 4 }))).toContain('強度要是 1～3')
    expect(reason(() => begin(g, { grade: 0 }))).toContain('等級要是 1～5')
    expect(reason(() => begin(g, { rounds: 0 }))).toContain('回合數要是 1～12')
  })

  it('已經有一場在進行：再開被活動擋下；直接叫開場草稿也不收', () => {
    const g = make()
    begin(g)
    expect(reason(() => begin(g))).toBe('輿論戰進行中，要先打完（或認輸）。')
    expect(reason(() => startDraft(g.k, g.state, { topic: 'tp_ignite', foe: 'pr_1' }, { by: 'test' }))).toBe('已經有一場輿論戰在進行了。')
  })
})

// ===================================================================================================================
describe('城市事件（OPINION 5.3）：每回合翻一張，只影響這一回合（畢業公演是整場）', () => {
  const ID = { scandal: 'city_scandal', festival: 'city_festival', algo: 'city_algo', graduation: 'city_graduation', blackout: 'city_blackout', quiet: 'city_quiet' } as const

  /** 把下一回合翻出指定的那一張（掃游標），並提交那份結束回合的報告。 */
  const flip = (g: G, id: string): Report => {
    const d = scanCursor(g, () => endTurn(g.k, g.state), (x) => warOf(x)!.city === id)
    return g.commit(d)[0]!
  }

  /** 不動的對手，而且它旁邊全是你的格子、風向 +5（它搶得走的防守是 8）：城市事件之外沒有別的東西動聲量與格子。 */
  const idle = (): G => {
    const g = make()
    begin(g, { foe: 'pr_idle' })
    setCells(g, ['doujin', 'fanclub', 'kaleido', 'whisper'], ['tape'])
    W(g).wind = 5
    return g
  }

  it('另一樁醜聞：雙方聲量各 −2，只在翻出來的那一刻', () => {
    const g = idle()
    W(g).voice = { you: 5, foe: 4 }
    flip(g, ID.scandal)
    expect(W(g).voice).toEqual({ you: 3, foe: 2 })
    flip(g, ID.quiet)
    expect(W(g).voice).toEqual({ you: 3, foe: 2 })
  })

  it('祭典組封街：街頭那一排的防守這回合 +1；下一回合恢復', () => {
    const g = idle()
    flip(g, ID.festival)
    setCells(g, ['kaleido'], ['tape'])
    for (const c of ['wall', 'whisper', 'relay'] as const) expect(defenseOf(W(g), c, 'you'), c).toBe(3)
    expect(defenseOf(W(g), 'doujin', 'you')).toBe(2)
    expect(defenseOf(W(g), 'sakura', 'you')).toBe(2)
    flip(g, ID.quiet)
    expect(defenseOf(W(g), 'wall', 'you')).toBe(2)
  })

  it('萬華鏡換了演算法：萬華鏡這回合不能被佔；下一回合可以', () => {
    const g = idle()
    setCells(g, ['whisper', 'wall'], ['tape'])
    flip(g, ID.algo)
    W(g).voice.you = 9
    expect(captureBlockOf(g.k, g.state, { cell: 'kaleido' })).toBe('「萬華鏡」這一回合不能被佔（城市事件）。')
    expect(captureBlockOf(g.k, g.state, { cell: 'sakura' })).toBeNull()
    flip(g, ID.quiet)
    expect(captureBlockOf(g.k, g.state, { cell: 'kaleido' })).toBeNull()
  })

  it('停電：主流那一排這回合不能被佔（緋櫻映畫、萬華鏡、夜鶯直播），別排不受影響', () => {
    const g = idle()
    flip(g, ID.blackout)
    setCells(g, ['whisper', 'wall', 'doujin'], ['relay'])
    W(g).voice.you = 9
    for (const c of ['sakura', 'kaleido'] as const) expect(captureBlockOf(g.k, g.state, { cell: c }), c).toBe(`「${c === 'sakura' ? '緋櫻映畫' : '萬華鏡'}」這一回合不能被佔（城市事件）。`)
    expect(captureBlockOf(g.k, g.state, { cell: 'tape' })).toBeNull()
    flip(g, ID.quiet)
    expect(captureBlockOf(g.k, g.state, { cell: 'sakura' })).toBeNull()
  })

  it('偶像的畢業公演：應援圈的分數這一場 +1（整場，不只那一回合）；不會疊加', () => {
    const g = idle()
    setCells(g, ['fanclub'], ['tape'])
    expect(scoreOf(W(g), 'you')).toBe(1)
    flip(g, ID.graduation)
    expect(scoreOf(W(g), 'you')).toBe(2)
    flip(g, ID.quiet)
    expect(scoreOf(W(g), 'you')).toBe(2)
    flip(g, ID.graduation)
    expect(scoreOf(W(g), 'you')).toBe(2)
  })

  it('平靜的一個時段：什麼都沒有', () => {
    const g = idle()
    W(g).voice = { you: 3, foe: 3 }
    const before = structuredClone(W(g))
    flip(g, ID.quiet)
    expect(W(g).voice).toEqual(before.voice)
    expect(W(g).city_fx).toEqual({ kind: 'none' })
    expect(W(g).bonus).toEqual({})
  })

  it('六張都翻得到；資料可以加一張（city_card）', () => {
    const g = idle()
    const seen = new Set<string>()
    for (let c = 0; c < 400 && seen.size < 6; c++) {
      g.state.rng.cursor = c
      seen.add(warOf(endTurn(g.k, g.state))!.city!)
    }
    expect([...seen].sort()).toEqual(Object.values(ID).sort())
    const pack: ContentPack = { id: 'more_city', content: { city_card: [{ id: 'city_rain', name: '雨季淹水', effect: { kind: 'def_row', row: 'circle', amount: 1 } }] } }
    const g2 = make({ packs: [pack] })
    begin(g2, { foe: 'pr_idle' })
    flip(g2, 'city_rain')
    expect(defenseOf(W(g2), 'doujin', 'you')).toBe(3)
    expect(defenseOf(W(g2), 'sakura', 'you')).toBe(2)
  })
})

// ===================================================================================================================
describe('別名與內容（V31；DATA 6.3）', () => {
  it('murmur 當 whisper 的別名收（議題的分數、對手的權重、指定的格子、起始格），載入時有提醒', () => {
    const pack: ContentPack = {
      id: 'murmur',
      content: {
        topic: [{ id: 'tp_old', name: '舊寫法', kind: 'frame', scores: { ...SC, whisper: undefined, murmur: 3 }, involves: INV, target_cell: 'murmur' }],
        pr_opponent: [{ id: 'pr_old', name: '舊寫法的對手', strength: 1, start: 'opposite', cell_priority: { murmur: 5, wall: 1 }, actions: [{ do: 'release', when: 'always' }] }],
      },
    }
    // JSON 裡沒有 undefined：照 DATA 的樣本只寫 murmur
    const { whisper: _w, ...rest } = SC
    pack.content.topic![0]!.scores = { ...rest, murmur: 3 }
    const g = make({ packs: [pack] })
    const warnings = g.contentWarnings()
    expect(warnings.some((w) => w.includes('topic/tp_old') && w.includes('murmur') && w.includes('whisper'))).toBe(true)
    expect(warnings.some((w) => w.includes('pr_opponent/pr_old') && w.includes('cell_priority'))).toBe(true)
    begin(g, { topic: 'tp_old', foe: 'pr_old', your_start: 'murmur' })
    expect(W(g).topic.scores.whisper).toBe(3)
    expect(Object.keys(W(g).topic.scores)).not.toContain('murmur')
    expect(W(g).topic.target_cell).toBe('whisper')
    expect(W(g).foe.cell_priority.whisper).toBe(5)
    expect(W(g).cells.whisper.owner).toBe('you')
    // 兩種寫法都有，以 whisper 為準
    expect(normalizeCellMap<number>({ murmur: 1, whisper: 2 })).toEqual({ whisper: 2 })
    // 沒用 murmur 的資料沒有提醒
    expect(make().contentWarnings().filter((w) => w.includes('murmur'))).toEqual([])
  })

  it('規則表蓋掉內建的預設（回合數、開場手牌、手牌上限、基礎編輯點、防守的底、大勝的差、等級的加成）', () => {
    const pack: ContentPack = { id: 'rules', content: { opinion_rule: [{ id: 'default', rounds: 3, open_hand: 2, draw: 1, hand_max: 3, ep_base: 3, empty_def: 1, foe_def_base: 4, big_gap: 2, grade_fuel: [0, 0, 0, 0, 5] }] } }
    const g = make({ packs: [pack] })
    begin(g, { grade: 5 })
    const w = W(g)
    expect(w.rounds).toBe(3)
    expect(w.hand).toHaveLength(3)
    expect(w.desk[0]!.ep_max).toBe(3)
    expect(defenseOf(w, 'wall', 'you', { empty_def: 1, foe_def_base: 4 })).toBe(1)
    // 真的佔領也照規則表：沒人的格子只要 1
    w.voice.you = 1
    expect(captureBlockOf(g.k, g.state, { cell: 'wall' })).toBeNull()
    w.voice.you = 0
    w.hand = ['card_interview']
    play(g, 0)
    expect(W(g).voice.you).toBe(7)
    expect(DEFAULT_OPINION_RULES.rounds).toBe(6)
  })

  it('格式不對的內容載入時被擋，指出是哪一筆', () => {
    const bad = (content: Record<string, unknown[]>, expectText: RegExp) => {
      expect(() => make({ packs: [{ id: 'bad', content: content as ContentPack['content'] }] })).toThrow(expectText)
    }
    bad({ topic: [{ id: 'tp_bad', name: 'x', kind: 'ignite', scores: { kaleido: 4 }, involves: INV }] }, /topic\/tp_bad.*kaleido 要是 0～3/s)
    bad({ topic: [{ id: 'tp_bad', name: 'x', kind: 'frame', scores: SC, involves: INV }] }, /topic\/tp_bad.*指定一格/s)
    bad({ topic: [{ id: 'tp_bad', name: 'x', kind: 'ignite', scores: { nowhere: 1 }, involves: INV }] }, /topic\/tp_bad.*不是格子的 id/s)
    bad({ pr_opponent: [{ id: 'pr_bad', name: 'x', strength: 4, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'always' }] }] }, /pr_opponent\/pr_bad.*strength/s)
    bad({ pr_opponent: [{ id: 'pr_bad', name: 'x', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'bribe', when: 'always' }] }] }, /pr_opponent\/pr_bad.*收買與找上門寫在 once/s)
    bad({ pr_opponent: [{ id: 'pr_bad', name: 'x', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'always' }], signature: { id: 's', text: 't', effect: { teleport: 1 } } }] }, /pr_opponent\/pr_bad.*不在封閉的清單裡/s)
    bad({ pr_opponent: [{ id: 'pr_bad', name: 'x', strength: 1, start: 'opposite', cell_priority: {}, actions: [{ do: 'release', when: 'always' }], mimic: { open: [4, 3] } }] }, /pr_opponent\/pr_bad.*mimic/s)
    bad({ pr_action: [{ id: 'teleport', cost: 1 }] }, /pr_action\/teleport.*id 要是/s)
    bad({ opinion_card: [{ id: 'card_bad', name: 'x', kind: 'means', cost: 1 }] }, /opinion_card\/card_bad.*手段牌/s)
    bad({ opinion_card: [{ id: 'card_bad', name: 'x', kind: 'fuel', cost: 1 }] }, /opinion_card\/card_bad.*voice/s)
    bad({ city_card: [{ id: 'city_bad', name: 'x', effect: { kind: 'lock' } }] }, /city_card\/city_bad.*cells 或 row/s)
    bad({ topic_kind: [{ id: 'ignite', side: 'attack', layout: 'street', scores: SC }] }, /topic_kind\/ignite.*兩者擇一/s)
    bad({ opinion_rule: [{ id: 'default', rounds: 0 }] }, /opinion_rule\/default.*rounds/s)
  })

  it('資料可以新增牌（opinion_card）與改掉預設的行動（pr_action）', () => {
    const pack: ContentPack = {
      id: 'more',
      content: {
        opinion_card: [{ id: 'card_scoop', name: '獨家', kind: 'fuel', cost: 2, voice: 4, basic: 2 }, { id: 'card_interview', name: '街訪', kind: 'fuel', cost: 1, voice: 1, basic: 3 }],
        pr_action: [{ id: 'release', name: '發稿', cost: 1, amount: 5 }],
      },
    }
    const g = make({ packs: [pack] })
    begin(g)
    expect([...W(g).hand, ...W(g).deck]).toHaveLength(11)
    expect([...W(g).hand, ...W(g).deck].filter((c) => c === 'card_scoop')).toHaveLength(2)
    W(g).hand = ['card_interview']
    play(g, 0)
    expect(W(g).voice.you).toBe(1)
    const g2 = make({ packs: [pack] })
    begin(g2, { foe: 'pr_1', strength: 1 })
    const r = turn(g2)[0]!
    expect((r.timeline.find((b) => b.tag === 'opinion.foe.release')!.data as { voice: number }).voice).toBe(5)
  })
})

// ===================================================================================================================
describe('進行中的限制（活動 opinion）', () => {
  it('進行中走路、休息被擋（原因是一句話）；出牌、佔領、結束回合、認輸不被擋；認輸之後可以', () => {
    const g = make()
    begin(g)
    const busy = '輿論戰進行中，要先打完（或認輸）。'
    expect(g.blockOf('commit:rest.sleep')).toBe(busy)
    expect(g.blockOf('grid.move')).toBe(busy)
    expect(g.blockOf('commit:explore.walk')).toBe(busy)
    expect(g.blockOf('opinion.start')).toBe(busy)
    for (const a of ['opinion.play', 'opinion.capture', 'opinion.turn', 'opinion.concede', 'opinion.bribe', 'opinion.end']) expect(g.blockOf(`commit:${a}`), a).toBeNull()
    expect(reason(() => g.commit(sys('rest.sleep')))).toBe(busy)
    expect(reason(() => g.commit(sys('explore.walk')))).toBe(busy)
    g.commit(concede(g.k, g.state))
    expect(g.blockOf('commit:rest.sleep')).toBeNull()
    expect(g.blockOf('grid.move')).toBeNull()
    expect(g.commit(sys('explore.walk'))).toHaveLength(1)
  })

  it('其他活動進行中不能自己發起輿論戰（原因照那個活動的句子）；契約的回話不在這裡被擋', () => {
    const OTHER: Feature = {
      id: 'other_act',
      install(k) {
        k.activity.define({ kind: 'toy_other', owner: 'other_act', order: 20, active: (s) => (s.flags.busy === true ? { id: 'x', label: '別的活動' } : null), allow: ['commit:test.'], reason: () => '別的活動進行中。' })
      },
    }
    const { game } = makeGame({ features: [opinionFeature, OTHER], content: [METER_CONTENT, PACK], seed: 7 })
    game.state.flags.busy = true
    expect(reason(() => game.launch('opinion', { topic: 'tp_ignite', foe: 'pr_1' }))).toBe('別的活動進行中。')
  })

  it('輿論戰不是進內海：開場、回合、結算都不發 login、不動追蹤度與感載', () => {
    const g = make()
    const reports = [...begin(g), ...turn(g), ...g.commit(concede(g.k, g.state))]
    for (const r of reports) {
      expect(r.changes.every((c) => ['uid', 'rng', 'opinion.war'].includes(c.op)), r.action).toBe(true)
      expect(tags(r).some((t) => t.startsWith('login') || t.includes('trace'))).toBe(false)
    }
  })
})

// ===================================================================================================================
describe('重播與存檔', () => {
  /** 一個固定的玩法：能出的牌就出、能佔的格子就佔、結束回合。 */
  function bot(g: G, rounds: number): void {
    for (let i = 0; i < rounds && gone(g) === false && W(g).turn === 'you'; i++) {
      for (let guard = 0; guard < 8; guard++) {
        const v = opinionView(g.k, g.state)
        if (!v.active) break
        const idx = v.hand.findIndex((h) => h.can && h.pick === null)
        if (idx < 0) break
        play(g, idx)
      }
      const v = opinionView(g.k, g.state)
      if (v.active) {
        const best = v.cells.filter((c) => c.can).sort((a, b) => b.score - a.score)[0]
        if (best) cap(g, best.id)
      }
      if (W(g).turn === 'you') turn(g)
    }
  }
  const trace = (g: G): string => JSON.stringify(g.state.reports.filter((r) => r.action?.startsWith('opinion.')))

  it('同一個種子、同樣的操作，整場逐份報告相同；換種子就不同', () => {
    const a = make({ seed: 11 })
    begin(a, { foe: 'pr_3', grade: 3 })
    bot(a, 6)
    const b = make({ seed: 11 })
    begin(b, { foe: 'pr_3', grade: 3 })
    bot(b, 6)
    expect(trace(a)).toBe(trace(b))
    expect(a.state.reports.filter((r) => r.action === 'opinion.turn').length).toBeGreaterThan(0)
    const c = make({ seed: 12 })
    begin(c, { foe: 'pr_3', grade: 3 })
    bot(c, 6)
    expect(trace(c)).not.toBe(trace(a))
  })

  it('打到一半存檔、讀回來接著打，結果和沒有中斷的一樣', () => {
    const whole = make({ seed: 21 })
    begin(whole, { foe: 'pr_3' })
    bot(whole, 2)
    const raw = whole.save()
    bot(whole, 6)

    const resumed = make({ seed: 99 })
    expect(resumed.load(raw)).toBeNull()
    expect(W(resumed).round).toBe(3)
    bot(resumed, 6)
    expect(trace(resumed)).toBe(trace(whole))
    expect(JSON.stringify(readWar(resumed.state))).toBe(JSON.stringify(readWar(whole.state)))
  })

  it('結束之後狀態裡沒有戰役；回退一步回到出牌之前', () => {
    const g = make()
    begin(g)
    W(g).hand = ['card_interview']
    play(g, 0)
    expect(W(g).voice.you).toBe(2)
    expect(g.undoSteps(1)).toBe(true)
    expect(W(g).hand).toEqual(readWar(g.state)!.hand)
    expect(W(g).voice.you).toBe(0)
  })
})

// ===================================================================================================================
describe('給畫面看的整理（opinionView）', () => {
  it('沒有戰役時回「現在沒有輿論戰」', () => {
    const g = make()
    expect(opinionView(g.k, g.state)).toEqual({ active: false, note: '現在沒有輿論戰。' })
  })

  it('九格：名字、分數、誰的、搶下來要多少聲量、能不能佔與原因；手牌每一張能不能出與原因', () => {
    const g = make()
    begin(g)
    W(g).voice.you = 2
    W(g).desk[0]!.ep = 1
    W(g).hand = ['card_interview', 'card_boost', 'card_guard']
    const v = opinionView(g.k, g.state)
    if (!v.active) throw new Error('應該在進行')
    expect(v.cells.map((c) => c.id)).toEqual([...OPINION_CELLS])
    const wall = v.cells.find((c) => c.id === 'wall')!
    expect(wall).toMatchObject({ name: '牆報', score: 1, owner: null, need: 2, can: true, reason: null, row: 'street', row_name: '街頭' })
    const whisper = v.cells.find((c) => c.id === 'whisper')!
    expect(whisper).toMatchObject({ owner: 'you', need: null, can: false })
    expect(v.cells.find((c) => c.id === 'doujin')!.reason).toContain('不相鄰')
    expect(v.cells.find((c) => c.id === 'tape')!.owner).toBe('foe')
    expect(v.hand.map((h) => [h.can, h.reason])).toEqual([[true, null], [false, expect.stringContaining('編輯點不夠')], [true, null]])
    expect(v.hand[0]).toMatchObject({ name: '採訪', kind: 'fuel', cost: 1, text: '聲量 +2' })
    expect(v.hand[2]!.pick).toEqual(['whisper'])
    expect(v).toMatchObject({ round: 1, rounds: 6, slot: '清晨', turn: 'ended' === 'ended' ? 'you' : 'you', voice: { you: 2, foe: 0 }, wind: 0, ep: 1, score: { you: 1, foe: 1 }, mode: 'solo', grade: 1 })
    expect(v.foe).toMatchObject({ name: '小公司的公關', strength: 1, pr: 2, faction: 'f_alpha', last: [] })
    expect(v.city).not.toBeNull()
  })

  it('對手上一步：對手的回合做了什麼留在 foe.last，下一回合開始前看得到', () => {
    const g = make()
    begin(g, { foe: 'pr_1' })
    turn(g)
    const v = opinionView(g.k, g.state)
    if (!v.active) throw new Error('應該在進行')
    expect(v.foe.last.length).toBeGreaterThan(0)
    expect(v.foe.last.join('')).toContain('對手發稿')
  })

  it('結束之後 view 帶結果（四級的名字）', () => {
    const g = make()
    begin(g, { foe: 'pr_idle', rounds: 1 })
    setCells(g, ['kaleido', 'sakura', 'whisper'], ['tape'])
    turn(g)
    const v = opinionView(g.k, g.state)
    if (!v.active) throw new Error('應該在進行')
    expect(v.turn).toBe('ended')
    expect(v.result).toMatchObject({ outcome: 'major', outcome_name: '大勝', you: 6, foe: 1 })
    expect(v.settle).toBeNull()
    expect(v.hand.every((h) => !h.can)).toBe(true)
  })
})

// ===================================================================================================================
describe('街頭信譽與分層', () => {
  it('沒有新的效果與條件（B022 的清單不動）；報告沒有 rep 的變更。唯一多的是量表「聲望」（standing）自動有的同名效果與條件（M5-opinion-desk；AI 一件事 ±5，不是 ai:false）', () => {
    const bare = makeGame({ features: [], content: [] }).game
    const g = make()
    expect(g.k.effects.kinds().sort()).toEqual([...bare.k.effects.kinds(), 'standing'].sort())
    expect(g.k.conditions.kinds().sort()).toEqual([...bare.k.conditions.kinds(), 'standing'].sort())
    begin(g, { foe: 'pr_3' })
    for (let i = 0; i < 3; i++) turn(g)
    for (const r of g.state.reports.filter((x) => x.action?.startsWith('opinion.'))) expect(r.changes.some((c) => c.op === 'rep' || c.op === 'effect'), r.action).toBe(false)
  })

  it('原始碼只 import 核心與自己的檔；不讀別的功能的 state.ext', () => {
    const dir = fileURLToPath(new URL('../../src/features/opinion', import.meta.url))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8')
      for (const m of text.matchAll(/from '([^']+)'/g)) expect(m[1] === '../../core' || m[1]!.startsWith('./'), `${f}：${m[1]}`).toBe(true)
      if (f !== 'model.ts' && f !== 'index.ts') expect(/\.ext\b/.test(text), `${f} 不直接碰 state.ext`).toBe(false)
    }
  })
})
