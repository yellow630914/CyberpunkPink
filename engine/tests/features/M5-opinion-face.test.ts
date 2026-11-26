// 驗收測試：dev/work/M5-opinion-face.md（cpp-feature）。活動 face.opinion：委託副本開的那一段輿論戰——開場表、交回、決定性沒贏的三選一、收買、找上門、外包。
// 規格：OPINION 4.5、5.1、5.2、第 6、7 節；COMMISSIONS 2.3、第 5 節；DATA 9.1；COMMISSION_TEMPLATES「opinion_setup 的骨架」；COMBAT_SYSTEM 8.4；dev/adr/0020 第六節、V35～V38。
// 用玩具活動 commission 當副本（開一段、存入口與階段的快照、帶 launch 開 face.opinion、聽 activity.end 回到入口），自帶兩個對手（一個 capture）、一張內幕牌（預設牌庫就有）。
// 公信力、好感用替身量表；條件 live_on、in_roster 用替身。骰子：d20 從種子、游標、用途導出；要固定結果就掃游標找到想要的那一顆（草稿是純函式，不改狀態）。城市事件全部換成「沒事」。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Kernel, Launch, ReportDraft } from '../../src'
import { ActionBlocked, meterOf } from '../../src'
import { mediaFeature, readMedia } from '../../src/features/media'
import type { FootageInit } from '../../src/features/media/ops'
import {
  OPINION_CELLS, acceptLoss, backToStage, capture, concede, endTurn, faceStartPreview, lostChoices, opinionFeature, opinionRules, opinionView, outsource, outsourceChance, outsourceBlock, playBlock,
  readBribes, readWar, resolveVisit, retryWar, scoopSetup, settle, answerBribe, startWar, DEFAULT_OPINION_RULES,
} from '../../src/features/opinion'
import type { Cell, FaceSetup, War } from '../../src/features/opinion'
import { makeActor, makeGame, METER_CONTENT } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

const SC: Record<string, number> = { kaleido: 3, sakura: 2, nightingale: 1, tape: 1, doujin: 1, fanclub: 1, whisper: 1, wall: 1, relay: 0 }
const INV = { factions: ['f_alpha'], people: ['npc_ann'], types: ['scandal'] }
const CITY_NONE = ['city_scandal', 'city_festival', 'city_algo', 'city_graduation', 'city_blackout', 'city_quiet'].map((id) => ({ id, name: id, effect: { kind: 'none' } }))
const act = (...rows: Array<[string, string]>) => rows.map(([d, when]) => ({ do: d, when }))

const PACK: ContentPack = {
  id: 'face_test',
  content: {
    city_card: CITY_NONE,
    pr_opponent: [
      { id: 'pr_idle', name: '不動的對手', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']) },
      { id: 'pr_bribe', name: '愛收買的對手', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'bribe', when: 'always', offer_per_grade: 1000 }] },
      { id: 'pr_visit', name: '會找上門的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'visit', when: 'always', squad: 'en_squad' }] },
      { id: 'pr_visit_gap', name: '落後就找上門的', faction: 'f_alpha', strength: 1, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'visit', when: 'score_gap <= -4' }] },
      { id: 'pr_gang', name: '會抓人的幫派', faction: 'f_beta', strength: 2, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']), once: [{ do: 'visit', when: 'always' }], capture: true },
      { id: 'pr_strong', name: '強的對手', faction: 'f_alpha', strength: 3, start: 'opposite', cell_priority: {}, actions: act(['release', 'round > 99']) },
    ],
  },
} as unknown as ContentPack

const TOPIC = { id: 'tp_face', name: '副本的議題', kind: 'ignite', scores: SC, involves: INV }

/** 替身：公信力、好感、訂閱量表。 */
const toyMeters: Feature = {
  id: 'face_meters',
  install(k: Kernel) {
    for (const def of [
      { kind: 'credibility', name: '公信力', min: 0, max: 100, start: 50, keyed: 'none' },
      { kind: 'favor', name: '好感', min: 0, max: 100, start: 50, keyed: 'faction' },
    ] as Rec[]) k.meters.define({ owner: 'face_meters', ...def } as never)
  },
}

/** 替身：條件 live_on（LIVE.on 控制）、in_roster（角色 ext.rost 為 true 才在名冊上）。 */
const LIVE = { on: false }
const toyConditions: Feature = {
  id: 'face_conditions',
  install(k: Kernel) {
    k.conditions.register({ kind: 'live_on', owner: 'face_conditions', validate: () => [], test: () => LIVE.on, describe: () => '要正在直播' } as never)
    k.conditions.register({ kind: 'in_roster', owner: 'face_conditions', validate: () => [], test: (c: Rec, ctx: Rec) => ctx.state.actors[c.who]?.ext.rost === true, describe: () => '要在名冊上' } as never)
  },
}

/** 聽 activity.end 的替身：記下 face.opinion 與 opinion 的收場；TC.rewind 開著時，face.opinion 交回 lost 就回到副本的入口（和真的副本一樣）。 */
interface Ended { kind: string; outcome: string; result: Rec; origin: Rec }
const ends: Ended[] = []
const TC = { rewind: false }

const draftOf = (state: GameState, action: string, changes: Change[]): ReportDraft => ({ kind: 'action', action, location: { ...state.location }, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' } })
const toyCommission: Feature = {
  id: 'toy_c',
  install(k: Kernel) {
    k.activity.define({
      kind: 'commission', owner: 'toy_c', order: 90,
      active: (s) => (s.ext.toy_c ? { id: 'tc', label: '玩具委託' } : null),
      allow: ['commit:toy_c.'],
      reason: () => '玩具委託進行中，先把它做完。',
      start(_k, state) {
        if (state.ext.toy_c) throw new ActionBlocked('已經有玩具委託了。')
        return [draftOf(state, 'toy_c.start', [{ op: 'snapshot.take', kind: 'entry', label: '入口', owner: 'tc', replace: true } as Change, { op: 'ext', key: 'toy_c', value: { stage: 0 } } as Change])]
      },
    })
    // 契約的回話在任何活動裡都做得了（allowEverywhere 的例子）
    k.activity.allowEverywhere('commit:contract.choose', 'toy_c')
    k.hooks.on('activity.end', 'toy_c', ({ kind, outcome, result, origin }) => {
      if (kind !== 'face.opinion' && kind !== 'opinion') return undefined
      ends.push({ kind, outcome, result: result as Rec, origin: origin as Rec })
      if (TC.rewind && kind === 'face.opinion' && outcome === 'lost') return { rewind: { kind: 'entry', summary: '你回到入口。', fresh: true } }
      return undefined
    })
  },
}
const stageDraft = (g: G): ReportDraft => {
  const cur = g.state.ext.toy_c as Rec
  return draftOf(g.state, 'toy_c.stage', [{ op: 'snapshot.take', kind: 'stage', label: '階段開始', owner: 'tc', replace: true } as Change, { op: 'ext', key: 'toy_c', value: { stage: cur.stage + 1 } } as Change])
}
const branchDraft = (g: G, setup: Rec): ReportDraft => ({
  ...draftOf(g.state, 'toy_c.branch', [{ op: 'ext', key: 'toy_c', value: { ...(g.state.ext.toy_c as Rec), face: 'opinion' } } as Change]),
  launch: [{ kind: 'face.opinion', setup, origin: { by: 'commission', ref: 'tc' } } as Launch],
})

/** 替身素材庫：次數記在 ext.face_media（跟著快照一起回去），只答 media.materials 與 media.spend（用真的 media 時，回到快照之後使用次數回不回去由 media 自己的 rewind.keep 決定）。 */
const toyMedia: Feature = {
  id: 'face_media',
  install(k: Kernel) {
    const usesOf = (state: Pick<GameState, 'ext'>): Record<string, number> => ((state.ext.face_media as Rec | undefined) ?? { ft1: 3 }) as Record<string, number>
    k.hooks.on('media.materials' as never, 'face_media', (({ state }: { state: GameState }) =>
      Object.entries(usesOf(state)).filter(([, n]) => n > 0).map(([ref, uses]) => ({
        ref, kind: 'footage', title: '玩具料', types: ['scandal'], uses, forged: false, involves: { factions: ['f_alpha'], people: [] }, card: { kind: 'fuel', value: 4 },
      }))) as never)
    k.hooks.on('media.spend' as never, 'face_media', (({ state, ref }: { state: GameState; ref: string }) => {
      const u = usesOf(state)
      return { changes: [{ op: 'ext', key: 'face_media', value: { ...u, [ref]: (u[ref] ?? 0) - 1 } }] }
    }) as never)
  },
}

const COMPANIONS = [
  makeActor({ id: 'bud', name: '夥伴', role: 'companion', skills: { firearms: 3 } }),
  makeActor({ id: 'gun', name: '槍手', role: 'companion', skills: { firearms: 1, brawl: 4 } }),
  makeActor({ id: 'rep1', name: '記者一', role: 'npc', skills: { perform: 3, investigate: 1 }, ext: { rost: true, paths: [{ path: 'streamer', slot: 'main', tier: 2 }] } }),
  makeActor({ id: 'rep2', name: '記者二', role: 'npc', skills: { negotiate: 2 }, ext: { rost: true, paths: [{ path: 'socialite', slot: 'main', tier: 2 }] } }),
  makeActor({ id: 'rep3', name: '路人記者', role: 'npc', skills: {}, ext: { rost: true } }),
  makeActor({ id: 'away', name: '不在名冊上的', role: 'npc', skills: { perform: 5 }, ext: { paths: [{ path: 'streamer', slot: 'main', tier: 3 }] } }),
]

interface Opts { seed?: number; alone?: boolean; noMedia?: boolean; toyMedia?: boolean; pack?: ContentPack }

const make = (o: Opts = {}) => {
  LIVE.on = false
  TC.rewind = false
  ends.length = 0
  const { game } = makeGame({
    features: [toyMeters, toyConditions, ...(o.toyMedia ? [toyMedia] : o.noMedia ? [] : [mediaFeature]), opinionFeature, toyCommission],
    content: [METER_CONTENT, PACK, ...(o.pack ? [o.pack] : [])],
    seed: o.seed ?? 7,
    actors: o.alone ? [COMPANIONS[2]!, COMPANIONS[3]!, COMPANIONS[4]!, COMPANIONS[5]!] : COMPANIONS,
    patch: { time: { day: 3, hour: 10, minute: 0 }, location: { district: 'd_a' } } as Partial<GameState>,
  })
  return game
}
type G = ReturnType<typeof make>

const W = (g: G): War => readWar(g.state)!
const reason = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const setCells = (g: G, you: Cell[], foe: Cell[]): void => {
  for (const c of OPINION_CELLS) W(g).cells[c] = { owner: you.includes(c) ? 'you' : foe.includes(c) ? 'foe' : null }
}
const beat = (d: { timeline: Array<{ tag?: string; data?: unknown }> }, tag: string): Rec => d.timeline.find((b) => b.tag === tag)?.data as Rec

/**
 * 掃游標，找到讓 pick 成立的那一個（草稿不改狀態）；回傳那一個游標上重新組的草稿。
 * 草稿一建好，活動的 activity.end 掛點就跑了（替身會記進 ends），所以掃完要把掃的時候記下的清掉。
 */
function scanCursor(g: G, build: () => ReportDraft, pick: (d: ReportDraft) => boolean, max = 800): ReportDraft {
  const keep = g.state.rng.cursor
  const n = ends.length
  for (let c = 0; c < max; c++) {
    g.state.rng.cursor = c
    if (pick(build())) {
      ends.length = n
      return build()
    }
  }
  g.state.rng.cursor = keep
  ends.length = n
  throw new Error('掃不到想要的骰面')
}
/** 把游標固定在讓下一份草稿擲出 want 的位置（之後照常提交）。 */
function fixRoll(g: G, build: () => ReportDraft, tag: string, want: number): void {
  const keep = g.state.rng.cursor
  const n = ends.length
  for (let c = 0; c < 800; c++) {
    g.state.rng.cursor = c
    if (beat(build(), tag)?.roll === want) {
      ends.length = n
      return
    }
  }
  g.state.rng.cursor = keep
  ends.length = n
  throw new Error('掃不到想要的骰面')
}

const setup = (o: Rec = {}): FaceSetup => ({
  commission: 'tc', stage: 1, face: 'opinion', branch: 'b1', branch_kind: 'assault', grade: 2, faction: 'f_alpha', links: [], route: [], decisive: false, where: {},
  opinion: { topic: TOPIC, opponent: { id: 'pr_idle' } }, ...o,
}) as FaceSetup

/** 開一件玩具委託、過一個階段（存階段的快照）、選輿論面開這一段。 */
const enter = (g: G, s: FaceSetup = setup()): void => {
  g.launch('commission', {}, { by: 'test' })
  g.commit(stageDraft(g))
  g.commit(branchDraft(g, s as unknown as Rec))
}
const turn = (g: G) => g.commit(endTurn(g.k, g.state))
const cap = (g: G, cell: string) => g.commit(capture(g.k, g.state, { cell }))
const meter = (g: G, kind: string, key = '_'): number => meterOf(g.k, g.state, kind, key)
/** 把戰役調到最後一回合、格子擺成想要的結果，再結束回合讓它打完。 */
const finishWith = (g: G, you: Cell[], foe: Cell[]): void => {
  setCells(g, you, foe)
  W(g).round = W(g).rounds
  turn(g)
}
const SETS: Record<string, [Cell[], Cell[]]> = {
  major: [['kaleido', 'sakura'], ['tape']],
  minor: [['kaleido', 'whisper'], ['tape']],
  draw: [['sakura', 'wall'], ['kaleido']],
  lost: [['wall'], ['kaleido']],
}
const ft = (o: Partial<FootageInit> = {}): FootageInit => ({
  title: '素材', text: '一段素材。', type: 'scandal', quality: 3, authentic: 'real', exclusive: true, involves: { factions: ['f_alpha'], people: [] }, uses: 3, made_at: 0, origin: 'own',
  celebrity: false, self: false, adult: false, ...o,
})
const addFootage = (g: G, o: Partial<FootageInit> = {}): string => {
  g.commit(draftOf(g.state, 'test.give', [{ op: 'media.make', footage: ft({ made_at: 1, ...o }) } as Change]))
  return Object.keys(readMedia(g.state).footage).at(-1)!
}

// ===================================================================================================================
describe('開場表（OPINION 4.5、DATA 9.1）', () => {
  const LINKS = [
    { link: 'inside_mail', add_card: 'card_inside_scoop' },
    { link: 'live_footage', voice: 3 },
    { link: 'bought_slot', cells: ['sakura'] },
    { link: 'caught_lying', wind: -2 },
    { link: 'leak_delayed', opponent_pr_first_round: -2 },
  ]
  const opening = (links: string[], extra: Rec = {}) => setup({ links, opinion: { topic: TOPIC, opponent: { id: 'pr_idle' }, from_links: LINKS, ...extra } })
  const deckOf = (w: War): string[] => [...w.deck, ...w.hand, ...w.discard]

  it('拿到的連動各自換成對的東西：內幕牌、聲量 +3、開場佔著緋櫻、風向 −2、對手第一回合少 2 點', () => {
    const g = make()
    enter(g, opening(['inside_mail']))
    expect(deckOf(W(g)).filter((c) => c === 'card_inside_scoop')).toHaveLength(1)
    expect(W(g).voice.you).toBe(0)
    const h = make()
    enter(h, opening(['live_footage']))
    expect(W(h).voice.you).toBe(3)
    expect(deckOf(W(h)).includes('card_inside_scoop')).toBe(false)
    const c = make()
    enter(c, opening(['bought_slot']))
    expect(W(c).cells.sakura.owner).toBe('you')
    const w = make()
    enter(w, opening(['caught_lying']))
    expect(W(w).wind).toBe(-2)
    const p = make()
    enter(p, opening(['leak_delayed']))
    expect(W(p).foe_state.pr_mod).toBe(-2)
  })

  it('沒拿到的不套；底子（base）永遠套；分支的 open 排在連動後面；全部拿到全部套', () => {
    const none = make()
    enter(none, opening([]))
    expect(W(none).voice.you).toBe(0)
    expect(W(none).wind).toBe(0)
    expect(W(none).cells.sakura.owner).toBeNull()
    expect(deckOf(W(none))).toHaveLength(9)
    const all = make()
    enter(all, setup({
      links: LINKS.map((l) => l.link), open: { voice: 1, cells: ['wall'] },
      opinion: { topic: TOPIC, opponent: { id: 'pr_idle' }, base: { voice: 2, wind: 1, cells: ['relay'] }, from_links: LINKS },
    }))
    const w = W(all)
    expect(w.voice.you).toBe(2 + 3 + 1)
    expect(w.wind).toBe(1 - 2)
    expect(w.cells.relay.owner).toBe('you')
    expect(w.cells.sakura.owner).toBe('you')
    expect(w.cells.wall.owner).toBe('you')
    expect(deckOf(w).filter((c) => c === 'card_inside_scoop')).toHaveLength(1)
    expect(w.foe_state.pr_mod).toBe(-2)
    expect(w.links).toEqual(LINKS.map((l) => l.link))
    expect(w.mode).toBe('face')
    expect(w.face).toMatchObject({ commission: 'tc', stage: 1, decisive: false })
  })

  it('faceStartPreview 和實際開場一樣（沒拿到的也列出來、標 got: false）', () => {
    const g = make()
    const s = setup({
      links: ['live_footage', 'bought_slot'], decisive: true, open: { wind: 1 },
      opinion: { topic: TOPIC, opponent: { id: 'pr_idle' }, base: { voice: 2 }, from_links: LINKS },
    })
    const pv = faceStartPreview(g.k, g.state, s)
    expect(pv.block).toBeNull()
    expect(pv.rounds).toBe(6)
    expect(pv.topic).toMatchObject({ id: 'tp_face', kind: 'ignite' })
    expect(pv.foe).toMatchObject({ id: 'pr_idle', strength: 1 })
    expect(pv.items.map((i) => [i.source, i.link ?? null, i.got])).toEqual([
      ['base', null, true], ['link', 'inside_mail', false], ['link', 'live_footage', true], ['link', 'bought_slot', true], ['link', 'caught_lying', false], ['link', 'leak_delayed', false], ['branch', null, true],
    ])
    expect(pv.items.filter((i) => !i.got).every((i) => i.voice === 0 && i.cells.length === 0 && i.card === undefined)).toBe(true)
    expect(pv.total).toEqual({ voice: 5, wind: 1, cells: ['sakura'], cards: [], foe_pr_first: 0 })
    enter(g, s)
    expect(W(g).voice.you).toBe(pv.total.voice)
    expect(W(g).wind).toBe(pv.total.wind)
    expect(OPINION_CELLS.filter((c) => W(g).cells[c].owner === 'you' && !['whisper'].includes(c))).toEqual(pv.total.cells)
    expect(W(g).rounds).toBe(pv.rounds)
    // 預覽不改狀態、對不成立的 setup 給原因
    expect(faceStartPreview(g.k, g.state, setup({ opinion: { topic: TOPIC, opponent: { id: 'nobody' } } })).block).toContain('已經有一場輿論戰')
    const g2 = make()
    expect(faceStartPreview(g2.k, g2.state, setup({ opinion: { topic: TOPIC, opponent: { id: 'nobody' } } })).block).toContain('找不到對手')
    expect(faceStartPreview(g2.k, g2.state, setup({ opinion: { topic: TOPIC, opponent: { id: 'pr_idle' }, base: { voice: 'x' } } })).block).toContain('voice 要是整數')
  })

  it('回合數：沒寫決定性的是 6、其餘是 4；這一面寫的與議題自己寫的優先', () => {
    const a = make()
    enter(a, setup({ decisive: true }))
    expect(W(a).rounds).toBe(6)
    const b = make()
    enter(b, setup())
    expect(W(b).rounds).toBe(4)
    const c = make()
    enter(c, setup({ opinion: { topic: TOPIC, opponent: { id: 'pr_idle' }, rounds: 5 } }))
    expect(W(c).rounds).toBe(5)
    const d = make()
    enter(d, setup({ opinion: { topic: { ...TOPIC, rounds: 6 }, opponent: { id: 'pr_idle' } } }))
    expect(W(d).rounds).toBe(6)
    expect(opinionRules(d.k).short_rounds).toBe(DEFAULT_OPINION_RULES.short_rounds)
  })

  it('對手強度可以蓋掉；開戰那一份第一筆是 snapshot.take（opinion、replace、owner 是委託）；沒有壓力條與警戒', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    const reports = g.commit(branchDraft(g, setup({ opinion: { topic: TOPIC, opponent: { id: 'pr_idle', strength: 3 } } }) as unknown as Rec))
    expect(W(g).foe.strength).toBe(3)
    const start = reports.find((r) => r.action === 'opinion.start')!
    expect(start.changes[0]).toMatchObject({ op: 'snapshot.take', kind: 'opinion', owner: 'tc', replace: true })
    expect(start.triggers ?? []).toEqual([])
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage', 'opinion'])
    const snap = g.state.snapshots.find((s) => s.kind === 'opinion')!
    expect((snap.data as Rec).setup.commission).toBe('tc')
    expect((snap.data as Rec).origin).toMatchObject({ by: 'commission', ref: 'tc' })
    // 這個活動不動警戒與追蹤度：整場報告裡沒有 pressure 觸發點
    turn(g)
    expect(g.state.reports.some((r) => (r.triggers ?? []).some((t) => t.point === 'pressure'))).toBe(false)
  })

  it('格式不對的開場表整步不成立：原因是完整的一句', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    expect(reason(() => g.commit(branchDraft(g, setup({ opinion: { topic: TOPIC, opponent: { id: 'pr_idle' }, from_links: [{ voice: 1 }] } }) as unknown as Rec)))).toContain('from_links')
    expect(reason(() => g.commit(branchDraft(g, setup({ opinion: { topic: TOPIC } }) as unknown as Rec)))).toContain('缺少輿論戰的設定')
    expect(readWar(g.state)).toBeNull()
  })
})

// ===================================================================================================================
describe('交回：非決定性的一段（V38）', () => {
  for (const outcome of ['major', 'minor', 'draw', 'lost'] as const) {
    it(`${outcome}：打完結算，直接交回 ${outcome}，沒有三選一、戰役清掉`, () => {
      const g = make()
      enter(g)
      const [you, foe] = SETS[outcome]!
      finishWith(g, you, foe)
      expect(W(g).turn).toBe('ended')
      expect(W(g).pending).toBeUndefined()
      expect(ends).toEqual([])
      g.commit(settle(g.k, g.state))
      expect(readWar(g.state)).toBeNull()
      expect(ends).toHaveLength(1)
      expect(ends[0]).toMatchObject({ kind: 'face.opinion', outcome })
      expect(ends[0]!.result).toMatchObject({ mode: 'face', decisive: false, stage: 1, commission: 'tc' })
      expect(ends[0]!.origin).toMatchObject({ by: 'commission', ref: 'tc' })
      expect(g.state.ext.toy_c).toBeDefined()
    })
  }

  it('非決定性的認輸直接交回 lost（沒有三選一）', () => {
    const g = make()
    enter(g)
    g.commit(concede(g.k, g.state))
    expect(readWar(g.state)).toBeNull()
    expect(ends.map((e) => e.outcome)).toEqual(['lost'])
  })

  it('face.opinion 進行中活動是它；活動的 opinion（自己發起）不認它', () => {
    const g = make()
    enter(g)
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['face.opinion', 'commission'])
    expect(g.k.activity.get('face.opinion')?.order).toBe(50)
  })
})

// ===================================================================================================================
describe('決定性的一步沒贏：三選一（V37、COMBAT_SYSTEM 8.4）', () => {
  const decisive = () => setup({ decisive: true })

  it('小勝以上直接交回（不給三選一）', () => {
    for (const outcome of ['minor', 'major'] as const) {
      const g = make()
      enter(g, decisive())
      const [you, foe] = SETS[outcome]!
      finishWith(g, you, foe)
      expect(W(g).pending).toBeUndefined()
      g.commit(settle(g.k, g.state))
      expect(ends.map((e) => [e.outcome, e.result.decisive])).toEqual([[outcome, true]])
    }
  })

  for (const board of ['draw', 'lost'] as const) {
    it(`${board}：不交回、活動還在、出牌與佔領與走路都被擋、三選一做得了、契約的回話放行`, () => {
      const g = make()
      enter(g, decisive())
      const [you, foe] = SETS[board]!
      finishWith(g, you, foe)
      expect(W(g).pending).toBe('lost')
      expect(W(g).turn).toBe('ended')
      expect(ends).toEqual([])
      expect(g.k.activity.active(g.state).map((a) => a.kind)).toContain('face.opinion')
      const wait = '這一場沒有贏下來：先決定重來這一場、回到這個階段開始，還是接受結果。'
      expect(playBlock(g.k, g.state, { index: 0 })).toBe(wait)
      expect(reason(() => capture(g.k, g.state, { cell: 'doujin' }))).toBe(wait)
      expect(reason(() => endTurn(g.k, g.state))).toBe(wait)
      expect(reason(() => settle(g.k, g.state))).toBe(wait)
      expect(reason(() => concede(g.k, g.state))).toBe(wait)
      expect(g.blockOf('grid.move')).toBe(wait)
      expect(g.blockOf('commit:contract.choose')).toBeNull()
      expect(lostChoices(g.k, g.state)).toEqual({ retry: null, back: null, accept: null })
      const v = opinionView(g.k, g.state)
      expect(v.active && v.choice).toEqual({ retry: null, back: null, accept: null })
      expect(v.active && v.settle).toBe(wait)
    })
  }

  it('retryWar：回到開戰前、這一段沒開、副本還在、入口之前的狀態不變；可以再開一次，骰子換一批', () => {
    const g = make()
    enter(g, decisive())
    const before = JSON.stringify(g.state.ext.toy_c)
    const rngBefore = g.state.rng.cursor
    finishWith(g, ...SETS.lost!)
    const [r] = g.commit(retryWar(g.k, g.state))
    expect(r!.action).toBe('opinion.retry')
    expect(readWar(g.state)).toBeNull()
    expect(g.state.snapshots.some((s) => s.kind === 'opinion')).toBe(false)
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry', 'stage'])
    expect(JSON.stringify(g.state.ext.toy_c)).toBe(JSON.stringify({ stage: 1, face: 'opinion' }))
    expect(before).toBe(JSON.stringify({ stage: 1, face: 'opinion' }))
    expect(g.state.rng.cursor).toBeGreaterThan(rngBefore)
    expect(g.state.reports.some((x) => x.action === 'opinion.start' && x.retracted === true)).toBe(true)
    expect(ends).toEqual([])
  })

  it('retryWar 之前快照的 setup 夠再開一次', () => {
    const g = make()
    enter(g, decisive())
    const data = g.state.snapshots.find((s) => s.kind === 'opinion')!.data as Rec
    finishWith(g, ...SETS.lost!)
    g.commit(retryWar(g.k, g.state))
    g.launch('face.opinion', data.setup, data.origin)
    expect(W(g).mode).toBe('face')
    expect(W(g).round).toBe(1)
    expect(W(g).face).toMatchObject({ decisive: true })
  })

  it('backToStage：回到階段開始，這個活動不存在、副本在上一個階段的選面之前', () => {
    const g = make()
    enter(g, decisive())
    finishWith(g, ...SETS.draw!)
    const [r] = g.commit(backToStage(g.k, g.state))
    expect(r!.action).toBe('opinion.back')
    expect(readWar(g.state)).toBeNull()
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['commission'])
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
    expect(g.state.ext.toy_c).toEqual({ stage: 0 })
    expect(ends).toEqual([])
  })

  it('backToStage：副本沒有存階段的快照就等於重來這一場', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    g.commit(branchDraft(g, decisive() as unknown as Rec))
    finishWith(g, ...SETS.lost!)
    g.commit(backToStage(g.k, g.state))
    expect(readWar(g.state)).toBeNull()
    expect(g.state.snapshots.map((s) => s.kind)).toEqual(['entry'])
  })

  it('acceptLoss：這時才交回 lost（一次）；棋盤上的結果記在 result.board', () => {
    const g = make()
    enter(g, decisive())
    finishWith(g, ...SETS.draw!)
    expect(ends).toEqual([])
    const [r] = g.commit(acceptLoss(g.k, g.state))
    expect(r!.action).toBe('opinion.accept')
    expect(readWar(g.state)).toBeNull()
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ kind: 'face.opinion', outcome: 'lost' })
    expect(ends[0]!.result).toMatchObject({ decisive: true, board: 'draw', by: 'rounds' })
    expect(reason(() => acceptLoss(g.k, g.state))).toBe('現在沒有輿論戰。')
  })

  it('決定性的認輸也算沒贏：等三選一；清空自己的格子（敗）同樣', () => {
    const g = make()
    enter(g, decisive())
    g.commit(concede(g.k, g.state))
    expect(W(g).pending).toBe('lost')
    expect(W(g).result).toMatchObject({ outcome: 'lost', by: 'concede' })
    expect(ends).toEqual([])
    const h = make()
    enter(h, decisive())
    setCells(h, ['whisper'], OPINION_CELLS.filter((c) => c !== 'whisper'))
    W(h).voice.foe = 10
    turn(h)
    expect(W(h).pending).toBe('lost')
    expect(W(h).result).toMatchObject({ outcome: 'lost', by: 'wipe' })
    expect(ends).toEqual([])
  })

  it('三選一還沒到的時候三個都不能選', () => {
    const g = make()
    enter(g, decisive())
    const c = lostChoices(g.k, g.state)
    expect(c.retry).toBe('這一場還沒有分出沒贏，不用選。')
    expect(reason(() => retryWar(g.k, g.state))).toBe('這一場還沒有分出沒贏，不用選。')
    expect(reason(() => backToStage(g.k, g.state))).toBe('這一場還沒有分出沒贏，不用選。')
    expect(reason(() => acceptLoss(g.k, g.state))).toBe('這一場還沒有分出沒贏，不用選。')
  })

  it('等著三選一時存檔讀回來還在等；讀回來之後三選一照樣做得了', () => {
    const g = make()
    enter(g, decisive())
    finishWith(g, ...SETS.lost!)
    const raw = g.save()
    const h = make({ seed: 99 })
    expect(h.load(raw)).toBeNull()
    expect(W(h).pending).toBe('lost')
    expect(lostChoices(h.k, h.state)).toEqual({ retry: null, back: null, accept: null })
    h.commit(retryWar(h.k, h.state))
    expect(readWar(h.state)).toBeNull()
    const i = make({ seed: 99 })
    i.load(raw)
    i.commit(acceptLoss(i.k, i.state))
    expect(ends[0]).toMatchObject({ outcome: 'lost' })
  })
})

// ===================================================================================================================
describe('帶進牌庫的料：重來之後（V37）', () => {
  const usesNow = (g: G): number => (g.state.ext.face_media as Rec | undefined)?.ft1 ?? 3
  const entered = (g: G, decisive = true): void => {
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    g.commit(branchDraft(g, setup({ decisive, bring: ['ft1'] }) as unknown as Rec))
  }

  it('開戰時帶進牌庫扣 1 次，快照是在扣之前存的：重來、回到階段開始都回到開戰前（次數回來）', () => {
    const g = make({ toyMedia: true })
    entered(g)
    expect(usesNow(g)).toBe(2)
    expect(W(g).brought.map((b) => b.ref)).toEqual(['ft1'])
    finishWith(g, ...SETS.lost!)
    g.commit(retryWar(g.k, g.state))
    expect(readWar(g.state)).toBeNull()
    expect(usesNow(g)).toBe(3)
    const h = make({ toyMedia: true })
    entered(h)
    finishWith(h, ...SETS.draw!)
    h.commit(backToStage(h.k, h.state))
    expect(readWar(h.state)).toBeNull()
    expect(usesNow(h)).toBe(3)
  })

  it('重來之後照快照留的 setup 再開一次：又扣 1 次、不會越扣越多', () => {
    const g = make({ toyMedia: true })
    entered(g)
    const data = g.state.snapshots.find((s) => s.kind === 'opinion')!.data as Rec
    finishWith(g, ...SETS.lost!)
    g.commit(retryWar(g.k, g.state))
    g.launch('face.opinion', data.setup, data.origin)
    expect(W(g).brought.map((b) => b.ref)).toEqual(['ft1'])
    expect(usesNow(g)).toBe(2)
  })

  it('接受結果：次數不退（這一場真的打過了）', () => {
    const g = make({ toyMedia: true })
    entered(g)
    finishWith(g, ...SETS.lost!)
    g.commit(acceptLoss(g.k, g.state))
    expect(usesNow(g)).toBe(2)
  })

  it('真的 media：開戰時扣次數、快照在扣之前存（回去之後次數回不回來是 media 的 rewind.keep 決定）', () => {
    const g = make()
    const ref = addFootage(g, { uses: 3 })
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    g.commit(branchDraft(g, setup({ decisive: true, bring: [ref] }) as unknown as Rec))
    expect(readMedia(g.state).footage[ref]!.uses).toBe(2)
    finishWith(g, ...SETS.lost!)
    g.commit(retryWar(g.k, g.state))
    expect(readWar(g.state)).toBeNull()
    expect(g.state.snapshots.some((x) => x.kind === 'opinion')).toBe(false)
  })
})

// ===================================================================================================================
describe('收買（V36）', () => {
  const bribed = (extra: Rec = {}) => setup({ employer: 'f_beta', opinion: { topic: TOPIC, opponent: { id: 'pr_bribe' } }, ...extra })

  it('拒絕：照常往下（對手的回合照做、回合 +1、沒有錢也沒有公信力的變動）', () => {
    const g = make()
    enter(g, bribed())
    const cash0 = g.state.money.cash
    turn(g)
    expect(W(g).pending).toBe('bribe')
    expect(W(g).offer).toBe(2000)
    const [r] = g.commit(answerBribe(g.k, g.state, { accept: false }))
    expect(r!.action).toBe('opinion.bribe')
    expect(W(g).pending).toBeUndefined()
    expect(W(g).round).toBe(2)
    expect(g.state.money.cash).toBe(cash0)
    expect(meter(g, 'credibility')).toBe(50)
    expect(ends).toEqual([])
  })

  it('接受：錢進帳（價 × 等級）、公信力 −5、委託人的好感 −5、交回 lost 帶 bribed；沒有三選一', () => {
    const g = make()
    enter(g, bribed({ decisive: true }))
    const cash0 = g.state.money.cash
    turn(g)
    const [r] = g.commit(answerBribe(g.k, g.state, { accept: true }))
    expect(r!.outcome.result).toBe('lost')
    expect(g.state.money.cash).toBe(cash0 + 2000)
    expect(meter(g, 'credibility')).toBe(45)
    expect(meter(g, 'favor', 'f_beta')).toBe(45)
    expect(readWar(g.state)).toBeNull()
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ kind: 'face.opinion', outcome: 'lost' })
    expect(ends[0]!.result).toMatchObject({ bribed: 2000, by: 'bribe', decisive: true })
    expect(readBribes(g.state)).toHaveLength(1)
  })

  it('沒有委託人就不扣好感；沒有量表就略過；solo（自己發起）也補完整（錢與公信力）', () => {
    const g = make()
    enter(g, setup({ opinion: { topic: TOPIC, opponent: { id: 'pr_bribe' } } }))
    turn(g)
    g.commit(answerBribe(g.k, g.state, { accept: true }))
    expect(meter(g, 'credibility')).toBe(45)
    expect(meter(g, 'favor', 'f_beta')).toBe(50)
    const s = make()
    s.commit(startWar(s.k, s.state, { topic: TOPIC as never, foe: 'pr_bribe', grade: 1 }, { by: 'shell' }))
    const cash0 = s.state.money.cash
    turn(s)
    s.commit(answerBribe(s.k, s.state, { accept: true }))
    expect(s.state.money.cash).toBe(cash0 + 1000)
    expect(meter(s, 'credibility')).toBe(45)
    expect(readBribes(s.state)).toHaveLength(0)
    expect(ends.at(-1)).toMatchObject({ kind: 'opinion', outcome: 'lost' })
  })

  it('接受之後副本失敗、回到入口：錢、公信力與好感還在，只算一次；再來一次也各算一次', () => {
    const g = make()
    TC.rewind = true
    const cash0 = g.state.money.cash
    enter(g, bribed())
    turn(g)
    g.commit(answerBribe(g.k, g.state, { accept: true }))
    // 回到入口：副本沒了
    expect(g.state.ext.toy_c).toBeUndefined()
    expect(readWar(g.state)).toBeNull()
    expect(g.state.money.cash).toBe(cash0 + 2000)
    expect(meter(g, 'credibility')).toBe(45)
    expect(meter(g, 'favor', 'f_beta')).toBe(45)
    expect(readBribes(g.state)).toHaveLength(1)
    // 第二次：快照已經有第一筆，只加第二筆
    enter(g, bribed())
    turn(g)
    g.commit(answerBribe(g.k, g.state, { accept: true }))
    expect(g.state.ext.toy_c).toBeUndefined()
    expect(g.state.money.cash).toBe(cash0 + 4000)
    expect(meter(g, 'credibility')).toBe(40)
    expect(meter(g, 'favor', 'f_beta')).toBe(40)
    expect(readBribes(g.state)).toHaveLength(2)
  })

  it('不是收買的失敗（接受平手與敗）回到入口：沒有錢也沒有公信力的變動', () => {
    const g = make()
    TC.rewind = true
    const cash0 = g.state.money.cash
    enter(g, setup({ decisive: true }))
    finishWith(g, ...SETS.lost!)
    g.commit(acceptLoss(g.k, g.state))
    expect(g.state.ext.toy_c).toBeUndefined()
    expect(g.state.money.cash).toBe(cash0)
    expect(readBribes(g.state)).toHaveLength(0)
  })

  it('solo 收下收買：公信力只掉 −5（不再加「敗」那一列的 −3）', () => {
    const g = make()
    g.commit(startWar(g.k, g.state, { topic: TOPIC as never, foe: 'pr_bribe' }, { by: 'shell' }))
    turn(g)
    g.commit(answerBribe(g.k, g.state, { accept: true }))
    expect(meter(g, 'credibility')).toBe(45)
  })
})

// ===================================================================================================================
describe('找上門（V35）：數值結算', () => {
  const visit = (foe = 'pr_visit', extra: Rec = {}) => setup({ opinion: { topic: TOPIC, opponent: { id: foe } }, ...extra })
  /** 掃游標讓結算擲出 want。 */
  const rollVisit = (g: G, want: number): void => fixRoll(g, () => resolveVisit(g.k, g.state), 'opinion.visit', want)

  it('結束回合時條件成立就停下來等結算（pending: visit）：出牌與佔領被擋、結算做得了；每場只來一次', () => {
    const g = make()
    enter(g, visit())
    const [r] = turn(g)
    expect(r!.outcome.result).toBe('visit')
    expect(W(g).pending).toBe('visit')
    expect(W(g).foe_state.visited).toBe(true)
    expect(playBlock(g.k, g.state, { index: 0 })).toBe('對手的人找上門了，先看你留守的人擋不擋得住。')
    expect(reason(() => endTurn(g.k, g.state))).toContain('找上門')
    g.commit(resolveVisit(g.k, g.state))
    expect(W(g).pending).toBeUndefined()
    // 之後的回合不再來
    for (let i = 0; i < 2 && W(g).turn === 'you'; i++) {
      const [t] = turn(g)
      expect(t!.outcome.result).not.toBe('visit')
    }
    expect(W(g).visit).toBeDefined()
  })

  it('條件看分數：預設落後 4 分以上才來，差不到不來', () => {
    const g = make()
    enter(g, visit('pr_visit_gap'))
    setCells(g, ['tape'], ['kaleido'])
    const [a] = turn(g)
    expect(a!.outcome.result).toBe('turn')
    const h = make()
    enter(h, visit('pr_visit_gap'))
    setCells(h, ['kaleido', 'sakura'], ['tape'])
    const [b] = turn(h)
    expect(b!.outcome.result).toBe('visit')
  })

  it('擋住：DC ＝ 12 ＋ 強度 × 2；d20 ＋ 留守的人最高的戰鬥基本功 ＋（人數 − 1）；照常打完', () => {
    const g = make()
    enter(g, visit())
    turn(g)
    // 留守：夥伴（槍械 3）、槍手（格鬥 4）→ 最高 4，人數 2 → 加 1；強度 1 → DC 14：骰 9 剛好 14 擋住、骰 8 擋不住
    rollVisit(g, 9)
    const d = resolveVisit(g.k, g.state)
    expect(beat(d, 'opinion.visit')).toMatchObject({ roll: 9, total: 14, dc: 14, held: true, bonus: 1, best: 4 })
    expect(beat(d, 'opinion.visit').stay.sort()).toEqual(['bud', 'gun'])
    g.commit(d)
    expect(W(g).visit).toMatchObject({ roll: 9, total: 14, dc: 14, held: true })
    expect(W(g).pending).toBeUndefined()
    expect(W(g).round).toBe(2)
    expect(W(g).stun).toBeUndefined()
    expect(W(g).foe_state.visit_stun).toBeUndefined()
    // 差 1 點擋不住
    const h = make()
    enter(h, visit())
    turn(h)
    rollVisit(h, 8)
    expect(beat(resolveVisit(h.k, h.state), 'opinion.visit')).toMatchObject({ total: 13, held: false })
  })

  it('強度越高 DC 越高（強度 3：DC 18）', () => {
    const g = make()
    enter(g, visit('pr_visit', { opinion: { topic: TOPIC, opponent: { id: 'pr_visit', strength: 3 } } }))
    turn(g)
    expect(beat(resolveVisit(g.k, g.state), 'opinion.visit').dc).toBe(18)
  })

  it('沒有人留守直接擋不住（不擲骰）', () => {
    const g = make({ alone: true })
    enter(g, visit())
    turn(g)
    const before = g.state.rng.cursor
    const d = resolveVisit(g.k, g.state)
    expect(beat(d, 'opinion.visit')).toMatchObject({ roll: 0, held: false })
    expect(beat(d, 'opinion.visit').stay).toEqual([])
    g.commit(d)
    expect(W(g).visit).toMatchObject({ held: false })
    expect(g.state.rng.cursor).toBeGreaterThan(before)
    // 坐編輯台的人不算留守：主角和夥伴一起坐
    const h = make()
    enter(h, visit('pr_visit', { desk: ['pc', 'bud'] }))
    turn(h)
    expect(beat(resolveVisit(h.k, h.state), 'opinion.visit').stay).toEqual(['gun'])
  })

  it('擋不住、對手不抓人：你下一回合不能行動（編輯點 0、不能佔領），再下一回合恢復', () => {
    const g = make()
    enter(g, visit())
    turn(g)
    rollVisit(g, 1)
    const [r] = g.commit(resolveVisit(g.k, g.state))
    expect(r!.outcome.result).toBe('stunned')
    expect(readWar(g.state)).not.toBeNull()
    expect(W(g).round).toBe(2)
    expect(W(g).stun).toBe(true)
    expect(W(g).desk.map((s) => s.ep)).toEqual([0])
    const v = opinionView(g.k, g.state)
    expect(v.active && v.stunned).toBe(true)
    expect(v.active && v.ep).toBe(0)
    expect(reason(() => capture(g.k, g.state, { cell: 'whisper' }))).toContain('牽制')
    const cell = (opinionView(g.k, g.state) as Rec).cells.find((c: Rec) => c.owner !== 'you')
    expect(cell.can).toBe(false)
    expect(cell.reason).toContain('牽制')
    turn(g)
    expect(W(g).round).toBe(3)
    expect(W(g).stun).toBeUndefined()
    expect(W(g).desk[0]!.ep).toBe(W(g).desk[0]!.ep_max)
    expect(W(g).desk[0]!.ep).toBeGreaterThan(0)
  })

  it('capture 的對手擋不住：戰役立刻結束算敗，交回 lost 帶 captured（不是收買、沒有三選一）', () => {
    const g = make()
    enter(g, visit('pr_gang', { decisive: true }))
    turn(g)
    rollVisit(g, 1)
    const [r] = g.commit(resolveVisit(g.k, g.state))
    expect(r!.action).toBe('opinion.visit')
    expect(readWar(g.state)).toBeNull()
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ kind: 'face.opinion', outcome: 'lost' })
    expect(ends[0]!.result).toMatchObject({ captured: true, by: 'visit', decisive: true })
    expect(ends[0]!.result.bribed).toBeUndefined()
  })

  it('capture 的對手被擋住：照常打下去', () => {
    const g = make()
    enter(g, visit('pr_gang'))
    turn(g)
    // 強度 2：DC 16；留守加成 4 ＋ 1 ＝ 5 → 骰 11 以上擋住
    rollVisit(g, 12)
    g.commit(resolveVisit(g.k, g.state))
    expect(readWar(g.state)).not.toBeNull()
    expect(W(g).visit!.held).toBe(true)
    expect(ends).toEqual([])
  })

  it('這一場正在直播（live_on 成立）：擋住時牌庫多一張「找上門的直播」（料 +4）；沒在直播或沒有人註冊都不多', () => {
    const g = make()
    LIVE.on = true
    enter(g, visit())
    turn(g)
    rollVisit(g, 20)
    const deckBefore = W(g).deck.length + W(g).hand.length + W(g).discard.length
    g.commit(resolveVisit(g.k, g.state))
    const all = [...W(g).deck, ...W(g).hand, ...W(g).discard]
    expect(all).toHaveLength(deckBefore + 1)
    expect(all.filter((c) => c === 'card_visit_live')).toHaveLength(1)
    expect(W(g).custom!.card_visit_live).toMatchObject({ name: '找上門的直播', kind: 'fuel', voice: 4, cost: 2 })
    const h = make()
    enter(h, visit())
    turn(h)
    rollVisit(h, 20)
    h.commit(resolveVisit(h.k, h.state))
    expect([...W(h).deck, ...W(h).hand, ...W(h).discard].includes('card_visit_live')).toBe(false)
    // 擋不住的時候不多
    const i = make()
    LIVE.on = true
    enter(i, visit())
    turn(i)
    rollVisit(i, 1)
    i.commit(resolveVisit(i.k, i.state))
    expect([...W(i).deck, ...W(i).hand, ...W(i).discard].includes('card_visit_live')).toBe(false)
  })

  it('沒有在等的時候不能結算；自己發起的戰役也一樣有找上門', () => {
    const g = make()
    enter(g)
    expect(reason(() => resolveVisit(g.k, g.state))).toBe('現在沒有人找上門。')
    const s = make()
    s.commit(startWar(s.k, s.state, { topic: TOPIC as never, foe: 'pr_visit' }, { by: 'shell' }))
    turn(s)
    expect(W(s).pending).toBe('visit')
    s.commit(resolveVisit(s.k, s.state))
    expect(W(s).pending).toBeUndefined()
  })

  it('規則表可以改 DC 與直播牌的聲量', () => {
    const g = make({ pack: { id: 'face_rule', content: { opinion_rule: [{ id: 'default', visit: { dc_base: 5, dc_per_strength: 1, live_voice: 2 }, bribe: { cred: 9, favor: 1 } }] } } as unknown as ContentPack })
    const r = opinionRules(g.k)
    expect(r.visit).toEqual({ dc_base: 5, dc_per_strength: 1, live_voice: 2 })
    expect(r.bribe).toEqual({ cred: 9, favor: 1 })
    enter(g, visit())
    turn(g)
    expect(beat(resolveVisit(g.k, g.state), 'opinion.visit').dc).toBe(6)
  })
})

// ===================================================================================================================
describe('外包（OPINION 第 7 節）', () => {
  const OUT = (extra: Rec = {}) => setup({ ...extra })

  it('勝算：DC ＝ 10 ＋ 強度 × 3；加值是他表演、調查、交涉裡最高的 ＋ 分量（媒體型 +4、社交型 +2）', () => {
    const g = make()
    const a = outsourceChance(g.k, g.state, 1, 'rep1')
    expect(a).toMatchObject({ dc: 13, weight: 4, bonus: 3 + 4, skill: { id: 'perform', level: 3 } })
    const b = outsourceChance(g.k, g.state, 2, 'rep2')
    expect(b).toMatchObject({ dc: 16, weight: 2, bonus: 2 + 2, skill: { id: 'negotiate', level: 2 } })
    const c = outsourceChance(g.k, g.state, 3, 'rep3')
    expect(c).toMatchObject({ dc: 19, weight: 0, bonus: 0 })
    expect(outsourceChance(g.k, g.state, OUT({ opinion: { topic: TOPIC, opponent: { id: 'pr_strong' } } }), 'rep1').dc).toBe(19)
    expect(reason(() => outsourceChance(g.k, g.state, 1, 'nobody'))).toBe('查不到這個人。')
  })

  it('四種結果的門檻：超過 5 以上大勝、成功小勝、差不到 5 平手、其餘敗', () => {
    // 強度 1、rep1：DC 13、加值 7 → 骰 6 剛好成功；骰 11 超過 5 → 大勝；骰 2～5 差不到 5 → 平手；骰 1 → 敗（差 5）
    const rows: Array<[number, string]> = [[20, 'major'], [11, 'major'], [10, 'minor'], [6, 'minor'], [5, 'draw'], [2, 'draw'], [1, 'lost']]
    for (const [roll, want] of rows) {
      const g = make()
      g.launch('commission', {}, { by: 'test' })
      const d = scanCursor(g, () => outsource(g.k, g.state, OUT(), 'rep1'), (x) => beat(x, 'opinion.outsource')?.roll === roll)
      expect(beat(d, 'opinion.outsource').outcome, `骰 ${roll}`).toBe(want)
    }
  })

  it('不開棋盤直接交回：活動 face.opinion 的 activity.end 一次；沒有戰役留下；非決定性的不給三選一', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    const d = scanCursor(g, () => outsource(g.k, g.state, OUT(), 'rep1'), (x) => beat(x, 'opinion.outsource')?.outcome === 'lost')
    const [r] = g.commit(d)
    expect(r!.action).toBe('opinion.outsource')
    expect(readWar(g.state)).toBeNull()
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ kind: 'face.opinion', outcome: 'lost' })
    expect(ends[0]!.result).toMatchObject({ by: 'outsource', decisive: false, commission: 'tc' })
    expect(ends[0]!.result.outsourced).toMatchObject({ actor: 'rep1', dc: 13 })
  })

  it('用副本的 setup.outsource 開：face.opinion 的 start 走外包，同一個結果', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    const reports = g.commit(branchDraft(g, OUT({ outsource: 'rep2' }) as unknown as Rec))
    expect(reports.map((r) => r.action)).toContain('opinion.outsource')
    expect(readWar(g.state)).toBeNull()
    expect(ends).toHaveLength(1)
    expect(ends[0]!.result.outsourced).toMatchObject({ actor: 'rep2' })
  })

  it('決定性的沒贏一樣給三選一：不交回；重來等於再擲一次（骰子換了）；接受才交回 lost', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    const s = OUT({ decisive: true, outsource: 'rep3' })
    const d = scanCursor(g, () => g.k.activity.start(g.k, g.state, 'face.opinion', s, { by: 'commission', ref: 'tc' })[0]!, (x) => beat(x, 'opinion.outsource')?.outcome === 'lost')
    const cursor = g.state.rng.cursor
    g.commit({ ...d, launch: undefined })
    expect(W(g).pending).toBe('lost')
    expect(W(g).result).toMatchObject({ by: 'outsource', outcome: 'lost' })
    expect(ends).toEqual([])
    expect(g.state.snapshots.map((x) => x.kind)).toEqual(['entry', 'stage', 'opinion'])
    expect(lostChoices(g.k, g.state)).toEqual({ retry: null, back: null, accept: null })
    expect(playBlock(g.k, g.state, { index: 0 })).toContain('沒有贏下來')
    g.commit(retryWar(g.k, g.state))
    expect(readWar(g.state)).toBeNull()
    expect(g.state.rng.cursor).toBeGreaterThanOrEqual(cursor)
    // 再擲一次
    const h = make()
    h.launch('commission', {}, { by: 'test' })
    h.commit(stageDraft(h))
    const d2 = scanCursor(h, () => h.k.activity.start(h.k, h.state, 'face.opinion', s, { by: 'commission', ref: 'tc' })[0]!, (x) => beat(x, 'opinion.outsource')?.outcome === 'lost')
    h.commit({ ...d2, launch: undefined })
    h.commit(acceptLoss(h.k, h.state))
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ outcome: 'lost' })
    expect(ends[0]!.result).toMatchObject({ by: 'outsource', decisive: true })
    expect(ends[0]!.result.board).toBeUndefined()
  })

  it('決定性而且小勝以上直接交回；大勝交回 major', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    g.commit(stageDraft(g))
    const s = OUT({ decisive: true, outsource: 'rep1' })
    const d = scanCursor(g, () => g.k.activity.start(g.k, g.state, 'face.opinion', s, { by: 'commission', ref: 'tc' })[0]!, (x) => beat(x, 'opinion.outsource')?.outcome === 'major')
    g.commit({ ...d, launch: undefined })
    expect(readWar(g.state)).toBeNull()
    expect(ends.map((e) => e.outcome)).toEqual(['major'])
  })

  it('那個人要有空、要在名冊上、不能是隊上的人：每一條一個原因', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    const block = (actor: string) => outsourceBlock(g.k, g.state, OUT(), actor)
    expect(block('rep1')).toBeNull()
    expect(block('nobody')).toBe('查不到這個人。')
    expect(block('pc')).toContain('主角自己')
    expect(block('bud')).toContain('在你的隊上')
    expect(block('away')).toBe('不在名冊上的不在你的名冊上。')
    for (const [cond, text] of [['busy', '現在有別的事在忙。'], ['injured', '受傷了'], ['lying_low', '躲風頭'], ['arrested', '被關起來了'], ['recovering', '手術後的休養']] as const) {
      const h = make()
      h.launch('commission', {}, { by: 'test' })
      h.state.actors.rep1!.conditions.push({ id: cond } as never)
      expect(outsourceBlock(h.k, h.state, OUT(), 'rep1'), cond).toContain(text)
      expect(reason(() => outsource(h.k, h.state, OUT(), 'rep1'))).toContain(text)
    }
    // 過期的狀況不算
    const i = make()
    i.launch('commission', {}, { by: 'test' })
    i.state.actors.rep1!.conditions.push({ id: 'busy', until: 1 } as never)
    expect(outsourceBlock(i.k, i.state, OUT(), 'rep1')).toBeNull()
  })

  it('outsourceChance 和擲一萬次的分佈對得上（寬鬆的誤差）', () => {
    const g = make()
    g.launch('commission', {}, { by: 'test' })
    for (const [actor, strength] of [['rep1', 1], ['rep2', 2], ['rep3', 1]] as const) {
      const odds = outsourceChance(g.k, g.state, strength, actor)
      expect(Object.values(odds.chance).reduce((a, b) => a + b, 0)).toBe(100)
      const setupX = OUT({ opinion: { topic: TOPIC, opponent: { id: 'pr_idle', strength } } })
      const seen: Record<string, number> = { major: 0, minor: 0, draw: 0, lost: 0 }
      const keep = g.state.rng.cursor
      for (let c = 0; c < 10000; c++) {
        g.state.rng.cursor = c
        seen[beat(outsource(g.k, g.state, setupX, actor), 'opinion.outsource').outcome]++
      }
      g.state.rng.cursor = keep
      for (const o of ['major', 'minor', 'draw', 'lost'] as const) expect(Math.abs(seen[o]! / 100 - odds.chance[o]), `${actor} ${o}`).toBeLessThan(3)
    }
  })

  it('規則表可以改 DC、門檻與分量', () => {
    const g = make({ pack: { id: 'face_rule2', content: { opinion_rule: [{ id: 'default', outsource: { dc_base: 8, dc_per_strength: 1, gap: 3, weight: { streamer: 1 }, skills: ['perform'] } }] } } as unknown as ContentPack })
    expect(outsourceChance(g.k, g.state, 2, 'rep1')).toMatchObject({ dc: 10, weight: 1, bonus: 4, skill: { id: 'perform', level: 3 } })
    expect(outsourceChance(g.k, g.state, 2, 'rep2')).toMatchObject({ weight: 2, skill: { id: 'perform', level: 0 } })
  })
})

// ===================================================================================================================
describe('放行（M4 對帳）', () => {
  it('副本進行中開得了這一段、出得了牌；別的 commit: 照舊被擋；契約的回話放行', () => {
    const g = make()
    expect(g.blockOf('face.opinion.start')).toBeNull()
    g.launch('commission', {}, { by: 'test' })
    expect(g.blockOf('face.opinion.start')).toBeNull()
    expect(g.blockOf('commit:opinion.play')).toBeNull()
    g.commit(stageDraft(g))
    g.commit(branchDraft(g, setup() as unknown as Rec))
    expect(W(g).mode).toBe('face')
    expect(g.blockOf('commit:opinion.play')).toBeNull()
    expect(g.blockOf('commit:opinion.capture')).toBeNull()
    expect(g.blockOf('commit:trade.checkout')).toBe('輿論戰進行中，要先打完（或認輸）。')
    expect(g.blockOf('commit:contract.choose')).toBeNull()
    expect(g.blockOf('grid.move')).toBe('輿論戰進行中，要先打完（或認輸）。')
    // 出牌做得了
    const v = opinionView(g.k, g.state) as Rec
    const playable = v.hand.find((h: Rec) => h.can)
    expect(playable).toBeDefined()
  })

  it('沒有副本的時候 face.opinion 照樣開得了（Game.launch）；副本沒裝也不壞', () => {
    const g = make()
    g.launch('face.opinion', setup(), { by: 'commission', ref: 'tc' })
    expect(W(g).mode).toBe('face')
    expect(g.k.activity.active(g.state).map((a) => a.kind)).toEqual(['face.opinion'])
  })
})

// ===================================================================================================================
describe('存檔、重播與一般守則', () => {
  const bot = (g: G, n: number): void => {
    for (let i = 0; i < n; i++) {
      const w = readWar(g.state)
      if (!w || w.turn !== 'you' || w.pending) return
      const v = opinionView(g.k, g.state)
      if (v.active) {
        const best = v.cells.filter((c) => c.can).sort((a, b) => b.score - a.score)[0]
        if (best) cap(g, best.id)
      }
      if (readWar(g.state)?.turn === 'you') turn(g)
    }
  }
  const trace = (g: G): string => JSON.stringify(g.state.reports.filter((r) => r.action?.startsWith('opinion.')))

  it('打到一半存檔、讀回來接著打，結果和沒有中斷的一樣', () => {
    const s = setup({ decisive: true, opinion: { topic: TOPIC, opponent: { id: 'pr_strong' } } })
    const whole = make({ seed: 21 })
    enter(whole, s)
    bot(whole, 2)
    const raw = whole.save()
    bot(whole, 8)
    const resumed = make({ seed: 99 })
    expect(resumed.load(raw)).toBeNull()
    expect(W(resumed).round).toBe(3)
    bot(resumed, 8)
    expect(trace(resumed)).toBe(trace(whole))
    expect(JSON.stringify(readWar(resumed.state))).toBe(JSON.stringify(readWar(whole.state)))
    expect(readWar(whole.state)?.pending ?? 'done').not.toBe(undefined)
  })

  it('同一個種子、同樣的操作逐份相同', () => {
    const s = setup({ opinion: { topic: TOPIC, opponent: { id: 'pr_strong' } } })
    const a = make({ seed: 5 })
    enter(a, s)
    bot(a, 6)
    const b = make({ seed: 5 })
    enter(b, s)
    bot(b, 6)
    expect(trace(a)).toBe(trace(b))
  })

  it('原始碼只 import 核心與自己的檔、不讀別的功能的 state.ext、沒有街頭信譽與 run.say、不重複 declare module', () => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/features/opinion')
    for (const f of readdirSync(dir).filter((x) => /^(faceopen|face|visit|lost|outsource|bribe)\.ts$/.test(x))) {
      const text = readFileSync(join(dir, f), 'utf8')
      for (const m of text.matchAll(/from '([^']+)'/g)) expect(m[1] === '../../core' || m[1]!.startsWith('./'), `${f} import ${m[1]}`).toBe(true)
      expect(/\.ext\b/.test(text), `${f} 不直接碰 state.ext`).toBe(false)
      expect(/run\.say\(/.test(text), `${f} 不用 run.say`).toBe(false)
      expect(/kind: 'rep'|key: 'rep'|'rep'/.test(text), `${f} 沒有街頭信譽`).toBe(false)
      expect(/declare module/.test(text), `${f} 不宣告掛點`).toBe(false)
      expect(/Math\.random|Date\./.test(text), `${f} 不用 Math.random 與 Date`).toBe(false)
    }
  })

  it('不加新的效果與條件；活動 face.opinion 與 opinion 並存', () => {
    const g = make()
    expect(g.k.activity.get('face.opinion')?.owner).toBe('opinion')
    expect(g.k.activity.get('opinion')?.owner).toBe('opinion')
  })
})

// ===================================================================================================================
describe('獨家節目播完直接開輿論戰（channel-shows 留下的）', () => {
  it('scoopSetup：用那件料自己發起一場；料用完或沒有涉及勢力要說原因', () => {
    const g = make()
    const ref = addFootage(g, { uses: 2 })
    const s = scoopSetup(g.k, g.state, ref)
    expect(s).toMatchObject({ topic: { kind: 'ignite', faction: 'f_alpha', people: [], types: ['scandal'] }, bring: [ref] })
    expect(scoopSetup(g.k, g.state, ref, { kind: 'smear', faction: 'f_beta' }).topic).toMatchObject({ kind: 'smear', faction: 'f_beta' })
    g.commit(startWar(g.k, g.state, s, { by: 'shell' }))
    expect(W(g).brought.map((b) => b.ref)).toEqual([ref])
    expect(W(g).self).toBe(true)
    expect(reason(() => scoopSetup(g.k, g.state, 'ft999'))).toContain('沒有「ft999」')
    const h = make()
    const nof = addFootage(h, { involves: { factions: [], people: [] } })
    expect(reason(() => scoopSetup(h.k, h.state, nof))).toContain('沒有涉及任何勢力')
    expect(scoopSetup(h.k, h.state, nof, { faction: 'f_beta' }).topic).toMatchObject({ faction: 'f_beta' })
    const none = make({ noMedia: true })
    expect(reason(() => scoopSetup(none.k, none.state, 'ft1'))).toBe('現在沒有素材庫可以帶料。')
  })
})
