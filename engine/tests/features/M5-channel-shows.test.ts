// 驗收測試：dev/work/M5-channel-shows.md（cpp-feature）。頻道的後半：節目六種、成人檔、開一集（選、付、擲、評價、結算）、業配、編制三種位子、設備、每一集的觸發點。
// 規格：MEDIA 4.3、4.3a、4.4、4.5、4.6、4.7（只看「每一集結算時抽一次」）；dev/adr/0020 第二節、第十三節、V12～V20、V55；dev/work/M5-channel.md。
// 測試裝真的 media 與 channel；其餘用測試自帶的最小假資料：替身的量表（人氣、豔名）、替身的條件（at_home、has_home、at_facility、in_roster）、
// 替身的衍生數值（roster_fee；episode_bonus 的 provider）、一個帶 stage 欄位的設施（地下室、live house、要門路的劇場）、一位偶像路數的夥伴、一位主播路數的製作、物品（設備）。
// 骰子：一集的骰面是 deriveRng(state.rng, 'channel.episode/<節目>')，假料的風險是 'channel.episode/risk'；測試往前推亂數的游標直到骰面剛好是要的那一顆（setDice）。
// 時間：測試從第 3 天 10:00 開始；第 7、14、21 天的 06:00 是週一。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Actor, Change, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, computeDegree, deriveRng, effectCtx, meterOf, toMinutes } from '../../src'
import {
  CHANNEL_GRADES, DEFAULT_CHANNEL_RULES, DEFAULT_SHOWS, airEpisode, channelFeature, channelRules, channelView, dismissStaff, episodePreview, fund, gradeChances, gearBonus, mountGear, openChannel, readChannel, seatStaff, showOptions,
  showsOf, staffSlots, studioSlots, unmountGear,
} from '../../src/features/channel'
import type { EpisodeAnswer, EpisodeInput } from '../../src/features/channel'
import { ruleProblems } from '../../src/features/channel/model'
import { showProblems } from '../../src/features/channel/shows'
import { cut, mediaFeature, readMedia } from '../../src/features/media'
import type { FootageInit } from '../../src/features/media/ops'
import { makeActor, makeGame, METER_CONTENT } from '../../src/testkit'

type Rec = Record<string, any>
type G = ReturnType<typeof makeGame>['game']
type Grade = 'flop' | 'ok' | 'good' | 'hit'

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

interface ToyState {
  home?: boolean
  has_home?: boolean
  facility?: string | null
  roster?: string[]
}

/** 替身：量表、條件（狀態放在 ext.toy）、roster_fee、episode_bonus 的 provider（讀角色 ext.eb）。 */
const toy: Feature = {
  id: 'shows_toy',
  install(k: Kernel) {
    for (const kind of ['district', 'facility_type']) k.content.defineKind({ kind, owner: 'shows_toy', validate: () => [] })
    k.meters.define({ kind: 'popularity', owner: 'shows_toy', name: '人氣', min: 0, max: 100, start: 0, keyed: 'npc' })
    k.meters.define({ kind: 'fame', owner: 'shows_toy', name: '豔名', min: 0, max: 100, start: 0, keyed: 'district' })
    const st = (s: GameState): ToyState => (s.ext.toy ?? {}) as ToyState
    k.conditions.register({ kind: 'at_home', owner: 'shows_toy', validate: () => [], test: (_c: Rec, ctx: Rec) => st(ctx.state).home === true })
    k.conditions.register({ kind: 'has_home', owner: 'shows_toy', validate: () => [], test: (_c: Rec, ctx: Rec) => st(ctx.state).has_home !== false })
    k.conditions.register({ kind: 'at_facility', owner: 'shows_toy', validate: () => [], test: (c: Rec, ctx: Rec) => Array.isArray(c.types) && c.types.includes(st(ctx.state).facility) })
    k.conditions.register({ kind: 'in_roster', owner: 'shows_toy', validate: () => [], test: (c: Rec, ctx: Rec) => (st(ctx.state).roster ?? []).includes(c.who) })
    k.stats.defineStat({ id: 'roster_fee', owner: 'shows_toy', name: '出場費', min: 0, base: (s, a) => (typeof s.actors[a]?.ext.fee === 'number' ? (s.actors[a]!.ext.fee as number) : 0) })
    k.stats.addStatProvider('episode_bonus', 'shows_toy', (s, a) => {
      const v = s.actors[a]?.ext.eb
      return typeof v === 'number' ? [{ label: '測試技能', value: v, source: 'perk' }] : []
    })
  },
}

const item = (id: string, name: string, studio: Rec) => ({ id, name, desc: `${name}。`, category: 'misc', grade: 1, size: 1, legal: 'free', studio })

const PACK: ContentPack = {
  id: 'shows_toy_pack',
  content: {
    district: [{ id: 'd_a', name: '甲區' }],
    facility_type: [
      { id: 'fac_basement', name: '地下室', stage: { size: 'basement' } },
      { id: 'fac_livehouse', name: 'live house', stage: { size: 'livehouse' } },
      { id: 'fac_theater', name: '劇場', stage: { size: 'theater', requires: { kind: 'flag', key: 'theater_ok' } } },
      { id: 'fac_bar', name: '酒吧' },
    ],
    item: [
      item('mic_c', '消費級收音（便攜）', { cls: 'mic', grade: 1, portable: true }),
      item('mic_p', '專業級收音（便攜）', { cls: 'mic', grade: 2, portable: true }),
      item('mic_e', '企業級收音（便攜）', { cls: 'mic', grade: 3, portable: true }),
      item('mic_s', '專業級收音（棚內）', { cls: 'mic', grade: 2, portable: false }),
      item('mic_s3', '企業級收音（棚內）', { cls: 'mic', grade: 3, portable: false }),
      item('lens_p', '專業級鏡頭（便攜）', { cls: 'lens', grade: 2, portable: true }),
      item('lens_s', '企業級鏡頭（棚內）', { cls: 'lens', grade: 3, portable: false }),
      item('light_s', '企業級燈光（棚內）', { cls: 'light', grade: 3, portable: false }),
      item('edit_s', '企業級剪輯機（棚內）', { cls: 'edit', grade: 3, portable: false }),
      item('edit_p', '專業級剪輯機（便攜）', { cls: 'edit', grade: 2, portable: true }),
      item('stream_p', '專業級串流（便攜）', { cls: 'stream', grade: 2, portable: true }),
      item('stream_s', '企業級串流（棚內）', { cls: 'stream', grade: 3, portable: false }),
      item('rock', '一塊石頭', { cls: 'nothing', grade: 1, portable: true }),
    ],
  },
}

const idolPath = [{ path: 'idol', slot: 'main', tier: 1 }]
const streamerPath = (tier: number) => [{ path: 'streamer', slot: 'main', tier }]

interface Opts {
  /** 主角有主播的路數 1 階（預設有：DC 12；false 是沒有媒體型技能：DC 15） */
  media?: boolean
  /** 不裝 media */
  noMedia?: boolean
  features?: Feature[]
  packs?: ContentPack[]
  actors?: Actor[]
  rules?: Rec
  channelRule?: Rec
  /** 開好頻道（預設開） */
  open?: boolean
  /** 預算的自有帳戶（預設 20,000；0 是不補貼） */
  budget?: number
  /** 在住處（預設不在） */
  home?: boolean
  facility?: string | null
  seed?: number
}

const BUD = makeActor({ id: 'bud', name: '夥伴', role: 'companion', attrs: { charm: 10 }, skills: { perform: 1 }, ext: { paths: idolPath, fee: 400 } })
const MAKER = makeActor({ id: 'maker', name: '製作人', role: 'npc', ext: {} })
const ACE = makeActor({ id: 'ace', name: '王牌製作', role: 'npc', ext: { paths: streamerPath(2) } })
const SPY = makeActor({ id: 'spy', name: '線人', role: 'npc', ext: {} })
const IDLE = makeActor({ id: 'idle', name: '閒人', role: 'npc', ext: {} })

function make(o: Opts = {}): G {
  const packs: ContentPack[] = [METER_CONTENT, PACK, ...(o.channelRule ? [{ id: 'shows_rules', content: { channel_rule: [{ id: 'default', ...o.channelRule }] } } as ContentPack] : []), ...(o.packs ?? [])]
  const { game } = makeGame({
    features: [toy, ...(o.noMedia ? [] : [mediaFeature]), channelFeature, ...(o.features ?? [])], content: packs, seed: o.seed ?? 7,
    pc: { attrs: { charm: 14, intellect: 12 }, skills: { perform: 2, investigate: 3, negotiate: 1 }, ext: { paths: o.media === false ? [] : streamerPath(1) } },
    actors: [BUD, MAKER, ACE, SPY, IDLE, ...(o.actors ?? [])],
    patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 100000, cash: 5000 }, location: { district: 'd_a' }, ...(o.rules ? { rules: o.rules as never } : {}) } as Partial<GameState>,
  })
  setToy(game, { home: o.home === true, facility: o.facility ?? null, roster: ['bud'] })
  if (o.open !== false) {
    game.commit(openChannel(game.k, game.state, '測試頻道'))
    if ((o.budget ?? 20000) > 0) game.commit(fund(game.k, game.state, { purse: 'cred', amount: o.budget ?? 20000 }))
    setMeter(game, 'subs', 1000)
  }
  return game
}

const sys = (changes: Change[], action = 'test.give', extra: Partial<ReportDraft> = {}): ReportDraft => ({ kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...extra })
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const setToy = (g: G, patch: ToyState): void => { give(g, [{ op: 'ext', key: 'toy', value: { ...((g.state.ext.toy ?? {}) as ToyState), ...patch } }]) }
const setMeter = (g: G, kind: string, value: number, key = '_'): void => { give(g, [{ op: 'meter', kind, key, set: value } as Change]) }
const meter = (g: G, kind: string, key = '_'): number => meterOf(g.k, g.state, kind, key)
const ch = (g: G) => readChannel(g.state)
const media = (g: G) => readMedia(g.state)
const advance = (g: G, minutes: number) => g.commit(sys([{ op: 'time', minutes }], 'test.wait'))
const goTo = (g: G, day: number, hour = 10, minute = 0) => advance(g, toMinutes({ day, hour, minute }) - toMinutes(g.state.time))
const weeklies = (g: G) => g.state.reports.filter((r) => r.action === 'channel.weekly')
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const effects = (g: G, list: unknown[]) => {
  const r = g.k.effects.resolve(list, effectCtx(g.k, g.state, { source: 'builtin' }))
  expect(r.errors).toEqual([])
  g.commit(sys(r.changes))
}
const addItem = (g: G, id: string, qty = 1) => give(g, [{ op: 'item', id, qty }])
const setExt = (g: G, id: string, key: string, value: unknown) => give(g, [{ op: 'actor.ext', id, key, value }])
const setCond = (g: G, id: string, condition: string) => give(g, [{ op: 'actor.condition', id, condition }])

const ft = (o: Partial<FootageInit> = {}): FootageInit => ({
  title: '素材', text: '一段素材。', type: 'battle', quality: 3, authentic: 'real', exclusive: true, involves: { factions: ['f_alpha'], people: [] }, uses: 3, made_at: 0, origin: 'own',
  celebrity: false, self: false, adult: false, ...o,
})

/** 放一段素材進素材庫，回傳 id。 */
function addFootage(g: G, o: Partial<FootageInit> = {}): string {
  give(g, [{ op: 'media.make', footage: ft({ made_at: toMinutes(g.state.time), ...o }) }])
  return Object.keys(media(g).footage).at(-1)!
}
const usesOf = (g: G, ref: string): number => (media(g).footage[ref] ?? media(g).clips[ref])!.uses

// ---- 骰子 ----

const DEGREE_OF: Record<Grade, string> = { flop: 'fumble', ok: 'fail', good: 'success', hit: 'critical' }

/** 往前推亂數的游標，直到每一個用途的骰面都符合條件（一般的 1/20 條件很快就找到）。 */
function setDice(g: G, wants: Array<[purpose: string, ok: (n: number) => boolean]>): void {
  for (let i = 0; i < 20000; i++) {
    if (wants.every(([purpose, ok]) => ok(deriveRng(g.state.rng, purpose).int(1, 20)))) return
    give(g, [{ op: 'rng', advance: 1 }])
  }
  throw new Error('找不到合適的骰面')
}

/** 讓這一集的評價剛好是 grade（用預覽的加值與 DC 反推骰面）。 */
function forceGrade(g: G, input: EpisodeInput, grade: Grade, extra: Array<[string, (n: number) => boolean]> = []): void {
  const pv = episodePreview(g.k, g.state, input)
  expect(pv.roll, pv.block ?? '').not.toBeNull()
  const { bonus, dc } = pv.roll!
  setDice(g, [[`channel.episode/${input.show}`, (n) => computeDegree(n, n + bonus, dc) === DEGREE_OF[grade]], ...extra])
}

/** 開一集（評價固定）。 */
function air(g: G, input: EpisodeInput, grade: Grade = 'good', extra: Array<[string, (n: number) => boolean]> = []) {
  forceGrade(g, input, grade, extra)
  const r = g.commit(airEpisode(g.k, g.state, input))[0]!
  expect(r.outcome.result).toBe(grade)
  return r
}

/** 一筆「放進一件 battle 類、品質 3 的素材的現場」的標準輸入。 */
function standard(g: G, o: Partial<EpisodeInput> = {}, f: Partial<FootageInit> = {}): EpisodeInput {
  return { show: 'live_news', materials: [addFootage(g, f)], ...o }
}

// ===================================================================================================================
describe('節目與規則的資料（預設六筆、資料蓋掉）', () => {
  it('預設六筆：現場、專題、八卦、雜談、公演、獨家；每一筆都過格式檢查；都不帶 tags', () => {
    expect(DEFAULT_SHOWS.map((s) => s.id)).toEqual(['live_news', 'feature', 'gossip', 'talk', 'concert', 'scoop'])
    for (const s of DEFAULT_SHOWS) {
      expect(showProblems(s as unknown as Rec), s.id).toEqual([])
      expect(s.tags, s.id).toBeUndefined()
    }
    const g = make()
    expect(showsOf(g.k).map((s) => s.id)).toEqual(DEFAULT_SHOWS.map((s) => s.id))
    const byId = Object.fromEntries(DEFAULT_SHOWS.map((s) => [s.id, s]))
    expect([byId.live_news!.slots, byId.feature!.slots, byId.gossip!.slots, byId.talk!.slots]).toEqual([1, 2, 1, 1])
    expect([byId.live_news!.cost, byId.feature!.cost, byId.gossip!.cost, byId.talk!.cost, byId.scoop!.cost]).toEqual([300, 800, 200, 100, 500])
    expect(byId.concert!.cost).toEqual({ basement: 200, livehouse: 600, theater: 1500, festival: 3000, dome: 3000 })
    expect(byId.concert!.materials).toEqual([0, 3])
    expect(byId.scoop!.materials).toEqual([1, 1])
    expect(byId.scoop!.min_quality).toBe(3)
  })

  it('資料用同一個 id 蓋掉整筆、新的 id 加在後面、格式不對的忽略；格式問題一條一個', () => {
    const g = make({ packs: [{ id: 'more_shows', content: { show: [
      { id: 'talk', name: '深夜雜談', skills: ['perform'], slots: 2, cost: 50, accepts: 'any', min_quality: 1, materials: [1, 2] },
      { id: 'night', name: '夜間特輯', skills: ['investigate'], slots: 1, cost: 10, accepts: ['crime'], min_quality: 2, materials: [1, 1] },
    ] } }] })
    const shows = showsOf(g.k)
    expect(shows.map((s) => s.id)).toEqual(['live_news', 'feature', 'gossip', 'talk', 'concert', 'scoop', 'night'])
    expect(shows.find((s) => s.id === 'talk')).toMatchObject({ name: '深夜雜談', slots: 2, cost: 50, materials: [1, 2] })
    const bad = showProblems({ name: '', skills: [], slots: 0, cost: -1, accepts: ['nope'], min_quality: 9, materials: [3, 1], venue: 'roof', on_grade: { great: [] }, gear: ['stream'], tags: 'x' } as Rec)
    for (const part of ['name', 'skills', 'slots', 'cost', 'accepts', 'min_quality', 'materials', 'venue', 'on_grade.great', 'gear', 'tags']) expect(bad.join('；'), part).toContain(part)
  })

  it('規則表 channel_rule：預設照 MEDIA 4.3、4.4；資料蓋得掉；壞值被擋', () => {
    const r = DEFAULT_CHANNEL_RULES
    expect(r.tiers.edgy).toMatchObject({ subs: 1.3, tips: 1.5, fame: 1, cred: -1, cred_hard: -2, reco: 0 })
    expect(r.tiers.adult).toMatchObject({ subs: 1.6, tips: 2.5, fame: 2, cred: -2, cred_hard: -4, reco: -1 })
    expect(r.grades).toEqual({ flop: { views: 0.2, subs: -2, cred: -2 }, ok: { views: 0.5, subs: 1, cred: 0 }, good: { views: 1, subs: 3, cred: 1 }, hit: { views: 3, subs: 10, cred: 2 } })
    expect([r.ad.unit, r.ad.cred_div, r.tip_rate, r.dc.base, r.dc.no_media, r.gear.cap, r.gear.stream_cap]).toEqual([0.1, 50, 0.02, 12, 3, 6, 3])
    expect([r.producer.bonus, r.producer.media_bonus, r.wage.hired, r.wage.roster_div, r.plug_cred, r.expose]).toEqual([2, 4, 250, 2, -1, 8])
    const g = make({ channelRule: { tiers: { edgy: { subs: 2, tags: ['blacktape'] } }, dc: { base: 10 }, gear: { bonus: [1, 1, 5] }, paths: { anchor: 'host' }, wage: { hired: 100 } } })
    const rules = channelRules(g.k)
    expect(rules.tiers.edgy).toMatchObject({ subs: 2, tips: 1.5, tags: ['blacktape'] })
    expect([rules.dc.base, rules.dc.no_media, rules.gear.bonus, rules.paths, rules.wage.hired]).toEqual([10, 3, [1, 1, 5], { anchor: 'host', idol: 'idol' }, 100])
    const bad = ruleProblems({ tiers: { adult: { subs: -1, tags: 'x' } }, grades: { hit: { views: 'a' } }, gear: { bonus: [1, 2] }, dc: 5, ad: { cred_div: 0 }, source: { q_min: 4, q_max: 2, types: [] } } as Rec)
    for (const part of ['tiers.adult.subs', 'tiers.adult.tags', 'grades.hit.views', 'gear.bonus', 'dc ', 'ad.cred_div', 'source.q_min', 'source.types']) expect(bad.join('；'), part).toContain(part)
    expect(ruleProblems({})).toEqual([])
    // 壞值在載入內容時就被擋下（內容檢查），不會進到規則裡
    expect(() => make({ channelRule: { dc: { base: 'x' }, tip_rate: 1000 } })).toThrow(/dc\.base 要是 0～40 的整數/)
  })
})

// ===================================================================================================================
describe('六種節目各自收什麼料（MEDIA 4.3 的兩張表）', () => {
  const TYPES = ['battle', 'scandal', 'crime', 'intimate', 'celebrity', 'daily'] as const

  /** 對每一個類型放一件品質 q 的料進這個節目，回傳收得進去的類型。 */
  function accepted(show: string, quality: number, tier: 'all' | 'edgy' | 'adult' = 'all'): string[] {
    const g = make()
    const out: string[] = []
    for (const type of TYPES) {
      const ref = addFootage(g, { type, quality, title: `${type}的料` })
      const pv = episodePreview(g.k, g.state, { show, tier, materials: [ref] })
      if (!pv.blocks.some((b) => b.includes(`「${type}的料」`))) out.push(type)
    }
    return out
  }

  it('現場：戰鬥、名人、日常、醜聞（品質 1 以上）；不收罪證與親密', () => {
    expect(accepted('live_news', 1)).toEqual(['battle', 'scandal', 'celebrity', 'daily'])
  })

  it('專題：只收品質 3 以上的罪證；品質 2 的罪證寫出差多少', () => {
    expect(accepted('feature', 3)).toEqual(['crime'])
    const g = make()
    const ref = addFootage(g, { type: 'crime', quality: 2, title: '倉庫的帳本' })
    const pv = episodePreview(g.k, g.state, { show: 'feature', materials: [ref] })
    expect(pv.blocks).toContain('「倉庫的帳本」的品質只有 2，專題要 3 以上，還差 1。')
    expect(reasonOf(() => airEpisode(g.k, g.state, { show: 'feature', materials: [ref] }))).toContain('還差 1')
  })

  it('八卦：醜聞、親密、名人（品質 2 以上）；不收戰鬥，原因寫出是哪一件、只收什麼', () => {
    expect(accepted('gossip', 2)).toEqual(['scandal', 'intimate', 'celebrity'])
    const g = make()
    const ref = addFootage(g, { type: 'battle', quality: 4, title: '街頭槍戰' })
    expect(episodePreview(g.k, g.state, { show: 'gossip', materials: [ref] }).blocks).toContain('「街頭槍戰」是戰鬥類的料，八卦只收醜聞、親密、名人類，放不進去。')
  })

  it('雜談：什麼類型都收（品質 1 以上）', () => {
    expect(accepted('talk', 1)).toEqual([...TYPES])
  })

  it('成人檔另收親密：現場與專題的親密在全年齡放不進，擦邊與成人放得進', () => {
    expect(accepted('live_news', 1, 'all')).not.toContain('intimate')
    expect(accepted('live_news', 1, 'edgy')).toContain('intimate')
    expect(accepted('live_news', 1, 'adult')).toContain('intimate')
    expect(accepted('feature', 3, 'adult').sort()).toEqual(['crime', 'intimate'])
    expect(accepted('feature', 3, 'all')).toEqual(['crime'])
    // 八卦本來就收親密，成人檔不改變
    expect(accepted('gossip', 2, 'adult')).toEqual(accepted('gossip', 2, 'all'))
  })

  it('片也要符合：片帶的類型與品質（來源品質的平均）', () => {
    const g = make({ home: true })
    const a = addFootage(g, { type: 'crime', quality: 4, title: '帳本' })
    const r = cut(g.k, g.state, { parts: [a], angle: 'documentary' })
    g.commit(r)
    const clip = Object.keys(media(g).clips)[0]!
    const pv = episodePreview(g.k, g.state, { show: 'feature', materials: [clip] })
    expect(pv.blocks.filter((b) => b.includes('放不進去'))).toEqual([])
    expect(pv.materials[0]).toMatchObject({ ref: clip, types: ['crime'], quality: 4 })
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: [clip] }).blocks.join()).toContain('只收戰鬥、名人、日常、醜聞類')
  })
})

// ===================================================================================================================
describe('showOptions：每一種節目開不開得出來、為什麼（一條一個原因）', () => {
  it('六種節目都列；沒有料、沒有預算、不在舞台上、沒有路數的灰著，每一條原因各自一句', () => {
    const g = make({ budget: 0, media: false })
    const list = showOptions(g.k, g.state)
    expect(list.map((s) => s.id)).toEqual(['live_news', 'feature', 'gossip', 'talk', 'concert', 'scoop'])
    expect(list.every((s) => !s.can)).toBe(true)
    const talk = list.find((s) => s.id === 'talk')!
    expect(talk.reasons).toEqual(['預算不夠：公帳加自有資金共有 0，要 100，還差 100。', '素材庫裡還沒有放得進「雜談」的料：要任何類的料，還差 1 件。'])
    const concert = list.find((s) => s.id === 'concert')!
    expect(concert.reasons).toEqual(['「公演」開不出來：要有偶像的路數 1 階以上。', '「公演」要站在舞台上（地下室、live house、劇場……），你現在不在舞台上。', '「公演」要先站上舞台才知道製作費。'])
    expect(concert).toMatchObject({ venue: 'stage', cost: null, materials: [0, 3] })
    expect(list.find((s) => s.id === 'feature')).toMatchObject({ cost: 800, minutes: 480, materials: [1, 3] })
  })

  it('有預算、有料就亮；成人檔三檔各自的狀況也在裡面', () => {
    const g = make()
    addFootage(g, { type: 'crime', quality: 3 })
    const feature = showOptions(g.k, g.state).find((s) => s.id === 'feature')!
    expect(feature).toMatchObject({ can: true, why: null, reasons: [], fits: 1 })
    expect(feature.tiers.map((t) => [t.id, t.can])).toEqual([['all', true], ['edgy', true], ['adult', true]])
    const noMedia = make({ media: false })
    addFootage(noMedia, { type: 'crime', quality: 3 })
    const t = showOptions(noMedia.k, noMedia.state).find((s) => s.id === 'feature')!.tiers
    expect(t.map((x) => [x.id, x.can])).toEqual([['all', true], ['edgy', false], ['adult', false]])
    expect(t[1]!.why).toBe('沒有媒體型技能（主播、偶像的路數）的人，開不出「專題」的擦邊檔。')
  })

  it('資料寫的條件這一局沒有人註冊（那個功能沒裝）：當作不成立，不丟例外', () => {
    const g = make({ packs: [{ id: 'odd_show', content: { show: [{ id: 'odd', name: '怪節目', skills: ['perform'], slots: 1, cost: 1, accepts: 'any', min_quality: 1, materials: [1, 1], requires: { kind: 'no_such_condition' } }] } }] })
    const odd = showOptions(g.k, g.state).find((s) => s.id === 'odd')!
    expect(odd.can).toBe(false)
    expect(odd.reasons[0]).toBe('「怪節目」開不出來：上鏡的人不符合條件。')
  })

  it('條件 channel_path 的格式與說明句', () => {
    const g = make()
    const ctx = { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules }
    expect(g.k.conditions.validate({ kind: 'channel_path', path: 'x', min: 0 }, 'c').join()).toContain('path 要是')
    expect(g.k.conditions.validate({ kind: 'channel_path', path: 'x', min: 0 }, 'c').join()).toContain('min 要是 1 以上')
    expect(g.k.conditions.test({ kind: 'channel_path', path: 'anchor' }, ctx)).toBe(true) // 主角是主播 1 階
    expect(g.k.conditions.test({ kind: 'channel_path', path: 'idol' }, ctx)).toBe(false)
    expect(g.k.conditions.test({ kind: 'channel_path', path: 'media', min: 2 }, ctx)).toBe(false)
    expect(g.k.conditions.test({ kind: 'channel_path', path: 'idol' }, { ...ctx, actor: 'bud' })).toBe(true)
    expect(g.k.conditions.explain({ kind: 'channel_path', path: 'media', min: 2 }, ctx)).toBe('要有主播或偶像的路數 2 階以上')
  })
})

// ===================================================================================================================
describe('放料與扣次數（沒有料開不了；放三件、三件各少一次；錢不夠料不扣）', () => {
  it('沒有放料、放太多、放同一件兩次、放不存在或用完的料：各有一句原因', () => {
    const g = make()
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: [] }).blocks).toContain('「現場」至少要放 1 件料，現在放了 0 件。')
    const refs = [1, 2, 3, 4].map(() => addFootage(g))
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: refs }).blocks).toContain('「現場」最多放 3 件料，現在放了 4 件。')
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: [refs[0]!, refs[0]!] }).blocks).toContain('同一件料不能放兩次。')
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: ['ft999'] }).blocks).toContain('素材庫裡沒有「ft999」這件料，或它已經用完了。')
    give(g, [{ op: 'media.use', ref: refs[0]!, take: 'all' }])
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: [refs[0]!] }).blocks.join()).toContain('已經用完了')
  })

  it('放三件：三件各少一次，報告裡是三筆 media.use；放進去的料之外的不動', () => {
    const g = make()
    const [a, b, c, other] = [0, 1, 2, 3].map(() => addFootage(g))
    const r = air(g, { show: 'live_news', materials: [a!, b!, c!] })
    expect([a, b, c, other].map((x) => usesOf(g, x!))).toEqual([2, 2, 2, 3])
    expect(r.changes.filter((x) => x.op === 'media.use')).toHaveLength(3)
  })

  it('錢不夠：開不了、料的次數不變、狀態不變', () => {
    const g = make({ budget: 0 })
    const ref = addFootage(g)
    const before = JSON.stringify(g.state.ext)
    expect(reasonOf(() => airEpisode(g.k, g.state, { show: 'live_news', materials: [ref] }))).toContain('預算不夠')
    expect(JSON.stringify(g.state.ext)).toBe(before)
    expect(usesOf(g, ref)).toBe(3)
    expect(ch(g).log).toEqual([])
  })

  it('沒開頻道：開不了，原因是還沒有頻道', () => {
    const g = make({ open: false })
    expect(reasonOf(() => airEpisode(g.k, g.state, { show: 'talk', materials: [] }))).toBe('還沒有頻道，先開一個頻道。')
    expect(showOptions(g.k, g.state).every((s) => !s.can)).toBe(true)
  })

  it('把 media 拿掉：開一集被擋，原因是「沒有素材庫。」；公演不放料照樣開得出來', () => {
    const g = make({ noMedia: true, facility: 'fac_basement', media: false, actors: [] })
    expect(reasonOf(() => airEpisode(g.k, g.state, { show: 'talk', materials: [] }))).toBe('沒有素材庫。')
    expect(reasonOf(() => airEpisode(g.k, g.state, { show: 'talk', materials: ['ft1'] }))).toBe('沒有素材庫。')
    // 公演：主角沒有偶像的路數，換夥伴上鏡
    const input: EpisodeInput = { show: 'concert', host: 'bud', materials: [] }
    expect(episodePreview(g.k, g.state, input).blocks).toEqual([])
    const r = g.commit(airEpisode(g.k, g.state, input))[0]!
    expect(r.action).toBe('channel.episode')
    expect(showOptions(g.k, g.state).find((s) => s.id === 'concert')!.can).toBe(false) // 主角自己沒有偶像的路數
    expect(showOptions(g.k, g.state, { host: 'bud' }).find((s) => s.id === 'concert')!.can).toBe(true)
  })

  it('沒開頻道之外的事：進行中的活動擋下（玩具的副本）', () => {
    const blocker: Feature = {
      id: 'blk', install(k: Kernel) {
        k.activity.define({ kind: 'commission', owner: 'blk', order: 90, active: (s: GameState) => (s.flags.in_run === true ? { id: 'c1', label: '委託副本' } : null), allow: ['commit:test.'], reason: () => '委託副本進行中，先把它做完。' })
      },
    }
    const g = make({ features: [blocker] })
    const input = standard(g)
    give(g, [{ op: 'flag', key: 'in_run', value: true }])
    expect(reasonOf(() => airEpisode(g.k, g.state, input))).toBe('委託副本進行中，先把它做完。')
    expect(usesOf(g, input.materials![0]!)).toBe(3)
  })
})

// ===================================================================================================================
describe('擲的算式（MEDIA 4.4 ③）', () => {
  it('每一項的值：屬性、基本功較高的一項、設備、製作、料的加成、episode_bonus、掛點的加值；DC = 12 − 推薦權重', () => {
    const answerer: Feature = {
      id: 'ep_bonus', install(k: Kernel) { k.hooks.on('channel.episode', 'ep_bonus', () => ({ owner: 'ep_bonus', bonus: [{ label: '技能的加值', value: 2 }] }) as EpisodeAnswer) },
    }
    const g = make({ features: [answerer] })
    setExt(g, 'pc', 'eb', 1)
    addItem(g, 'mic_c'); addItem(g, 'edit_p')
    g.commit(mountGear(g.k, g.state, 'mic_c')); g.commit(mountGear(g.k, g.state, 'edit_p'))
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    const a = addFootage(g, { quality: 4 })
    const b = addFootage(g, { quality: 4 })
    const pv = episodePreview(g.k, g.state, { show: 'live_news', materials: [a, b] })
    expect(pv.ok, pv.block ?? '').toBe(true)
    const parts = Object.fromEntries(pv.roll!.parts.map((p) => [p.label, p.value]))
    expect(parts['魅力']).toBe(2) // 魅力 14 → +2
    expect(parts.perform).toBe(2) // 表演 2 級；街頭直覺那一項只有 +1（智識 12 → +1），表演比較高
    expect(parts['設備']).toBe(2) // 消費級便攜 +1（收音）、專業級便攜 +2 −1（剪輯機）
    expect(parts['製作']).toBe(2)
    expect(parts['料的加成']).toBe(2) // 看點 4 + 4 = 8，÷ 4 = 2
    expect(parts['節目的加值']).toBe(1)
    expect(parts['技能的加值']).toBe(2)
    expect(pv.roll!.bonus).toBe(13)
    expect(pv.roll!.dc).toBe(12)
    expect(pv.roll!.skill).toBe('perform')
    // 推薦權重 +2 → DC 10；−2 → 14
    setMeter(g, 'reco', 2)
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: [a, b] }).roll!.dc).toBe(10)
    setMeter(g, 'reco', -2)
    expect(episodePreview(g.k, g.state, { show: 'live_news', materials: [a, b] }).roll!.dc).toBe(14)
    // 實際擲出來的就是這些：骰面 + 13 對 12
    setMeter(g, 'reco', 0)
    const r = air(g, { show: 'live_news', materials: [a, b] }, 'good')
    const roll = r.timeline[0]!.roll!
    expect([roll.total, roll.dc]).toEqual([roll.natural + 13, 12])
  })

  it('兩項基本功取較高的：現場的街頭直覺比表演高時用街頭直覺', () => {
    const g = make()
    give(g, [{ op: 'actor.skill', id: 'pc', skill: 'perform', delta: -2 }, { op: 'actor.skill', id: 'pc', skill: 'streetwise', delta: 3 }])
    const pv = episodePreview(g.k, g.state, standard(g))
    expect(pv.roll!.skill).toBe('streetwise')
    expect(pv.roll!.attr).toBe('intellect')
  })

  it('沒有媒體型技能：難度 +3；有主播或偶像的路數就不加', () => {
    const none = make({ media: false })
    expect(episodePreview(none.k, none.state, standard(none)).roll!.dc_parts).toEqual([{ label: '基礎難度', value: 12 }, { label: '沒有媒體型技能', value: 3 }])
    expect(episodePreview(none.k, none.state, standard(none)).roll!.dc).toBe(15)
    const idol = make({ media: false })
    expect(episodePreview(idol.k, idol.state, { ...standard(idol), host: 'bud' }).roll!.dc).toBe(12) // 夥伴是偶像路數
    const anchor = make()
    expect(episodePreview(anchor.k, anchor.state, standard(anchor)).roll!.dc).toBe(12)
  })

  it('製作 +2；製作的路數是主播或偶像 +4；沒帶不加；忙著的製作帶不了', () => {
    const g = make()
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    const input = standard(g)
    const bonus = (staff?: Array<'producer'>) => episodePreview(g.k, g.state, { ...input, ...(staff ? { staff } : {}) }).roll!.parts.find((p) => p.label.startsWith('製作'))?.value ?? 0
    expect(bonus()).toBe(2) // 有製作就預設帶著
    expect(bonus([])).toBe(0)
    g.commit(dismissStaff(g.k, g.state, 'producer'))
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'ace' }))
    expect(bonus()).toBe(4)
    setCond(g, 'ace', 'busy')
    expect(bonus()).toBe(0) // 預設不帶忙著的人
    expect(episodePreview(g.k, g.state, { ...input, staff: ['producer'] }).blocks).toContain('王牌製作正在忙別的事，現在沒空跟你開節目。')
  })

  it('設備：棚內的在住處才算、在街上不算；超過 +6 夾住', () => {
    const g = make({ home: true })
    for (const id of ['lens_s', 'mic_s3', 'light_s', 'edit_s']) { addItem(g, id); g.commit(mountGear(g.k, g.state, id)) }
    const input: EpisodeInput = { show: 'talk', materials: [addFootage(g)] } // 雜談用到鏡頭、收音、燈光、剪輯機四類
    const home = episodePreview(g.k, g.state, input)
    expect(home.gear).toMatchObject({ raw: 12, total: 6, capped: true })
    expect(home.roll!.parts.find((p) => p.label === '設備')!.value).toBe(6)
    setToy(g, { home: false })
    const street = episodePreview(g.k, g.state, input)
    expect(street.gear).toMatchObject({ raw: 0, total: 0, capped: false })
    expect(street.roll!.parts.find((p) => p.label === '設備')).toBeUndefined()
  })

  it('設備只算這個節目用得到的類：現場不用燈光、雜談用；便攜的專業級以上少 1；每類取最高的一件', () => {
    const g = make()
    for (const id of ['mic_c', 'mic_p', 'mic_e', 'lens_p', 'edit_p']) { addItem(g, id); g.commit(mountGear(g.k, g.state, id)) }
    // 收音：消費 +1、專業 +1、企業 +2 → 取 +2；鏡頭專業便攜 +1；剪輯機專業便攜 +1
    expect(gearBonus(g.k, g.state, ['mic'], 6).total).toBe(2)
    expect(gearBonus(g.k, g.state, ['lens', 'mic', 'edit'], 6)).toMatchObject({ total: 4 })
    expect(gearBonus(g.k, g.state, ['light'], 6).total).toBe(0)
    // 現場：鏡頭、收音、剪輯機 = 4；八卦：收音、燈光、剪輯機 = 3
    expect(episodePreview(g.k, g.state, standard(g)).gear.total).toBe(4)
    const gossip = addFootage(g, { type: 'scandal', quality: 2 })
    expect(episodePreview(g.k, g.state, { show: 'gossip', materials: [gossip] }).gear.total).toBe(3)
  })
})

// ===================================================================================================================
describe('四種評價的結算（MEDIA 4.4 的表）', () => {
  const EXPECT: Record<Grade, { views: number; subs: number; cred: number; ad: number; tips: number }> = {
    flop: { views: 200, subs: -20, cred: -2, ad: 20, tips: 4 },
    ok: { views: 500, subs: 10, cred: 0, ad: 50, tips: 10 },
    good: { views: 1000, subs: 30, cred: 1, ad: 100, tips: 20 },
    hit: { views: 3000, subs: 100, cred: 2, ad: 300, tips: 60 },
  }

  it.each(CHANNEL_GRADES as unknown as Grade[])('現場、全年齡、%s：觀看、訂閱、公信力、廣告、打賞對表，預覽與實際一致', (grade) => {
    const g = make()
    const input = standard(g)
    const pv = episodePreview(g.k, g.state, input)
    const want = EXPECT[grade]
    expect(pv.results![grade]).toMatchObject({ views: want.views, subs: want.subs, cred: want.cred, ad: want.ad, tips: want.tips, tips_pc: want.tips })
    const own0 = ch(g).budget.own.cred
    const money0 = g.state.money.cred
    const r = air(g, input, grade)
    expect(meter(g, 'subs')).toBe(1000 + want.subs)
    expect(meter(g, 'credibility')).toBe(50 + want.cred)
    expect(ch(g).budget.own.cred).toBe(own0 - 300 + want.ad) // 製作費 300 從預算扣，廣告進預算的自有帳戶
    expect(g.state.money.cred).toBe(money0 + want.tips) // 打賞進主角的口袋
    expect(r.timeline[0]!.data).toMatchObject({ grade, views: want.views, subs: want.subs, ad: want.ad, tips: want.tips })
    expect(r.outcome.result).toBe(grade)
  })

  it('四種機率加起來是 100；沒有算式（節目有問題）的預覽沒有機率', () => {
    const g = make()
    const pv = episodePreview(g.k, g.state, standard(g))
    expect(Object.values(pv.chance!).reduce((s, n) => s + n, 0)).toBe(100)
    const none = episodePreview(g.k, g.state, { show: 'nope', materials: [] })
    expect(none.chance).toBeNull()
    expect(none.blocks).toContain('沒有「nope」這種節目。')
  })

  it('公信力：只有現場與專題（cred_affected）照評價表；八卦與雜談不動', () => {
    const g = make()
    const talk = addFootage(g)
    const r = air(g, { show: 'talk', materials: [talk] }, 'hit')
    expect(meter(g, 'credibility')).toBe(50)
    expect(r.timeline[0]!.data!.cred).toBe(0)
    const gossip = addFootage(g, { type: 'scandal', quality: 2 })
    air(g, { show: 'gossip', materials: [gossip] }, 'flop')
    expect(meter(g, 'credibility')).toBe(50)
    const feature = addFootage(g, { type: 'crime', quality: 3 })
    air(g, { show: 'feature', materials: [feature] }, 'good')
    expect(meter(g, 'credibility')).toBe(51)
  })

  it('料的平均可信：8 以上公信力多 +1、3 以下多 −1（只有現場與專題）', () => {
    const g = make()
    const hi = addFootage(g, { quality: 5 }) // 可信 = 品質 × 2 = 10
    air(g, { show: 'live_news', materials: [hi] }, 'good')
    expect(meter(g, 'credibility')).toBe(52) // +1 評價、+1 可信
    const lo = addFootage(g, { quality: 1 }) // 可信 2
    air(g, { show: 'live_news', materials: [lo] }, 'flop')
    expect(meter(g, 'credibility')).toBe(52 - 3) // −2 評價、−1 可信
    // 雜談不看可信
    const g2 = make()
    air(g2, { show: 'talk', materials: [addFootage(g2, { quality: 5 })] }, 'good')
    expect(meter(g2, 'credibility')).toBe(50)
  })

  it('時間：節目的時段數 × 240 分鐘；專題兩個時段', () => {
    const g = make()
    const t0 = toMinutes(g.state.time)
    g.commit(airEpisode(g.k, g.state, standard(g)))
    expect(toMinutes(g.state.time) - t0).toBe(240)
    const t1 = toMinutes(g.state.time)
    g.commit(airEpisode(g.k, g.state, { show: 'feature', materials: [addFootage(g, { type: 'crime' })] }))
    expect(toMinutes(g.state.time) - t1).toBe(480)
  })

  it('製作費先扣公帳、再扣自有；廣告收入只進自有', () => {
    const g = make({ budget: 100 })
    give(g, [{ op: 'channel.budget', pool: 'f_alpha', cred: 250 }])
    air(g, standard(g), 'good') // 製作費 300：公帳 250 + 自有 50
    expect(ch(g).budget.pools.f_alpha!.cred).toBe(0)
    expect(ch(g).budget.own.cred).toBe(100 - 50 + 100) // 扣 50、廣告 +100
  })

  it('夥伴上鏡：打賞對半（主角拿一半）、不加豔名；主角上鏡打賞全拿並加豔名', () => {
    const g = make()
    air(g, { ...standard(g, {}, {}), tier: 'edgy' }, 'good') // 主角：打賞 1000 × 0.02 × 1.5 = 30
    expect(g.state.money.cred).toBe(100000 - 20000 + 30)
    expect(meter(g, 'fame', 'd_a')).toBe(1)
    const money = g.state.money.cred
    expect(meter(g, 'subs')).toBe(1039)
    const r = air(g, { ...standard(g), tier: 'edgy', host: 'bud' }, 'good') // 夥伴上鏡：觀看 1039、打賞 floor(1039 × 0.02 × 1.5) = 31
    expect(r.actor).toBe('bud')
    expect(r.timeline[0]!.data).toMatchObject({ host: 'bud', views: 1039, tips: 31, tips_pc: 15, fame: 0 })
    expect(g.state.money.cred - money).toBe(15) // 對半：主角拿 15，另一半是夥伴本人的
    expect(meter(g, 'fame', 'd_a')).toBe(1) // 夥伴上鏡不加主角的豔名
  })

  it('上鏡的人要在隊伍裡、有空；不在隊伍的人與忙著的人上不了鏡', () => {
    const g = make()
    expect(episodePreview(g.k, g.state, { ...standard(g), host: 'maker' }).blocks).toContain('製作人不在你的隊伍裡，沒辦法上鏡。')
    setCond(g, 'bud', 'injured')
    expect(episodePreview(g.k, g.state, { ...standard(g), host: 'bud' }).blocks).toContain('夥伴受傷了，現在沒空上鏡。')
    expect(episodePreview(g.k, g.state, { ...standard(g), host: 'ghost' }).blocks).toContain('查不到 ghost 這個人，沒辦法上鏡。')
  })

  it('報告：kind broadcast、action channel.episode；旁白的結果句子不帶數字（數字在那一拍的 data）', () => {
    const g = make()
    const r = air(g, standard(g, { tier: 'edgy' }), 'hit')
    expect(r.kind).toBe('broadcast')
    expect(r.action).toBe('channel.episode')
    for (const line of r.narration!.results!) expect(line, line).not.toMatch(/\d/)
    expect(r.outcome.summary).toContain('爆')
    expect(r.timeline[0]!.tag).toBe('channel.episode')
    expect(r.timeline[0]!.roll).toMatchObject({ dice: '1d20' })
    expect(JSON.stringify(g.state.reports.map((x) => x.changes))).not.toContain('"kind":"rep"') // 任何入口都不給街頭信譽
  })
})

// ===================================================================================================================
describe('成人檔（MEDIA 4.3 的成人檔表；V14）', () => {
  /** 現場、一件品質 3 的戰鬥料；訂閱 1000、廣告用公信力 50。 */
  function run(tier: 'all' | 'edgy' | 'adult', grade: Grade, show: 'live_news' | 'talk' = 'live_news') {
    const g = make()
    const input: EpisodeInput = { show, tier, materials: [addFootage(g)] }
    const r = air(g, input, grade)
    return { g, r, data: r.timeline[0]!.data as Rec }
  }

  it('擦邊：訂閱的漲 ×1.3、打賞 ×1.5、廣告單價減半、豔名 +1、公信力 −1（現場與專題 −2）', () => {
    const { g, data } = run('edgy', 'good')
    expect(data).toMatchObject({ subs: 39, views: 1000, tips: 30, ad: 50, fame: 1, cred: 1 - 2 })
    expect(meter(g, 'subs')).toBe(1039)
    expect(meter(g, 'fame', 'd_a')).toBe(1)
    expect(meter(g, 'credibility')).toBe(49)
    expect(meter(g, 'reco')).toBe(0)
    // 雜談（不是現場、專題）：公信力 −1
    expect(run('edgy', 'good', 'talk').data.cred).toBe(-1)
  })

  it('成人：訂閱 ×1.6、打賞 ×2.5、廣告減半、豔名 +2、公信力 −2（現場與專題 −4）、推薦權重 −1', () => {
    const { g, data } = run('adult', 'good')
    expect(data).toMatchObject({ subs: 48, tips: 50, ad: 50, fame: 2, cred: 1 - 4, reco: -1 })
    expect(meter(g, 'subs')).toBe(1048)
    expect(meter(g, 'fame', 'd_a')).toBe(2)
    expect(meter(g, 'credibility')).toBe(47)
    expect(meter(g, 'reco')).toBe(-1)
    expect(run('adult', 'good', 'talk').data.cred).toBe(-2)
  })

  it('翻車的 −2% 不乘倍率（V14）；訂閱的漲才乘', () => {
    expect(run('adult', 'flop').data.subs).toBe(-20)
    expect(run('edgy', 'flop').data.subs).toBe(-20)
    expect(run('adult', 'ok').data.subs).toBe(16) // 1% × 1.6
    expect(run('adult', 'hit').data.subs).toBe(160) // 10% × 1.6
  })

  it('成人檔的推薦權重 −1 每週最多一次；過了週一又可以', () => {
    const g = make()
    const open = (): void => { air(g, { show: 'talk', tier: 'adult', materials: [addFootage(g)] }, 'good') }
    open()
    expect(meter(g, 'reco')).toBe(-1)
    expect(ch(g).week.adult_reco).toBe(true)
    open()
    expect(meter(g, 'reco')).toBe(-1) // 同一週第二次不再扣
    goTo(g, 8, 7) // 週一 06:00 之後：推薦權重往 0 回一格、旗標清掉
    expect(ch(g).week.adult_reco).toBe(false)
    expect(meter(g, 'reco')).toBe(0)
    open()
    expect(meter(g, 'reco')).toBe(-1)
  })

  it('成人檔的內容篩選：標籤關掉時，那一檔不列、開不了；預設的三檔不帶標籤，不受任何開關影響', () => {
    const g = make({ channelRule: { tiers: { edgy: { tags: ['blacktape'] } } }, rules: { contentOff: ['blacktape'] } })
    const input = standard(g, { tier: 'edgy' })
    expect(reasonOf(() => airEpisode(g.k, g.state, input))).toBe('擦邊檔的題材被你在內容篩選關掉了。')
    const tiers = showOptions(g.k, g.state).find((s) => s.id === 'live_news')!.tiers
    expect(tiers.map((t) => t.id)).toEqual(['all', 'adult'])
    // 預設的規則：關掉任何標籤都不影響
    const plain = make({ rules: { contentOff: ['blacktape', 'male_partner', 'intimate_body'] } })
    const opts = showOptions(plain.k, plain.state)
    expect(opts.map((s) => s.id)).toEqual(['live_news', 'feature', 'gossip', 'talk', 'concert', 'scoop'])
    expect(opts.find((s) => s.id === 'talk')!.tiers.map((t) => t.id)).toEqual(['all', 'edgy', 'adult'])
    expect(episodePreview(plain.k, plain.state, standard(plain, { tier: 'adult' })).blocks).toEqual([])
  })

  it('內容篩選：帶標籤的節目關掉那個標籤時 showOptions 不列它；料的標籤被關掉放不進去', () => {
    const packs: ContentPack[] = [{ id: 'tag_show', content: { show: [{ id: 'tape', name: '黑帶特輯', skills: ['perform'], slots: 1, cost: 10, accepts: 'any', min_quality: 1, materials: [1, 3], tags: ['blacktape'] }] } }]
    const on = make({ packs })
    expect(showOptions(on.k, on.state).map((s) => s.id)).toContain('tape')
    const off = make({ packs, rules: { contentOff: ['blacktape'] } })
    expect(showOptions(off.k, off.state).map((s) => s.id)).not.toContain('tape')
    expect(reasonOf(() => airEpisode(off.k, off.state, { show: 'tape', materials: [addFootage(off)] }))).toBe('「黑帶特輯」的題材被你在內容篩選關掉了。')
    // 料的標籤
    const g = make({ rules: { contentOff: ['blacktape'] } })
    const ref = addFootage(g, { title: '黑帶的畫面', tags: ['blacktape'] })
    expect(episodePreview(g.k, g.state, { show: 'talk', materials: [ref] }).blocks).toContain('「黑帶的畫面」這段素材的題材被你在內容篩選關掉了，放不進去。')
    const fine = addFootage(g, { title: '一般的畫面' })
    expect(episodePreview(g.k, g.state, { show: 'talk', materials: [fine] }).blocks).toEqual([])
  })

  it('沒有媒體型技能的人開不出專題與雜談的成人檔；現場、八卦的成人檔開得出來', () => {
    const g = make({ media: false })
    const crime = addFootage(g, { type: 'crime', quality: 3 })
    const any = addFootage(g)
    expect(episodePreview(g.k, g.state, { show: 'feature', tier: 'edgy', materials: [crime] }).blocks).toContain('沒有媒體型技能（主播、偶像的路數）的人，開不出「專題」的擦邊檔。')
    expect(episodePreview(g.k, g.state, { show: 'talk', tier: 'adult', materials: [any] }).blocks).toContain('沒有媒體型技能（主播、偶像的路數）的人，開不出「雜談」的成人檔。')
    expect(episodePreview(g.k, g.state, { show: 'live_news', tier: 'adult', materials: [any] }).blocks).toEqual([])
    expect(episodePreview(g.k, g.state, { show: 'gossip', tier: 'adult', materials: [addFootage(g, { type: 'scandal', quality: 2 })] }).blocks).toEqual([])
    // 全年齡照開
    expect(episodePreview(g.k, g.state, { show: 'talk', tier: 'all', materials: [any] }).blocks).toEqual([])
    // 有主播的路數就開得出來
    const anchor = make()
    expect(episodePreview(anchor.k, anchor.state, { show: 'feature', tier: 'adult', materials: [addFootage(anchor, { type: 'crime', quality: 3 })] }).blocks).toEqual([])
  })
})

// ===================================================================================================================
describe('業配、金主與假料', () => {
  const SPONSOR = { kind: 'sponsor', faction: 'f_alpha', every_weeks: 52, amount: 1000, plug_every: 3, plug_pay: 500 }

  it('掛業配：金主的公帳 + plug_pay（額度 +20%）、公信力 −1、eps_since_plug 歸零，沒掛的金主各 +1', () => {
    const g = make()
    effects(g, [SPONSOR, { kind: 'sponsor', faction: 'f_beta', every_weeks: 52, amount: 1000, plug_every: 2, plug_pay: 100 }])
    const r = air(g, standard(g, { plug: 'f_alpha' }), 'good')
    expect(ch(g).budget.pools.f_alpha).toEqual({ cred: 500, quota: 100 })
    expect(meter(g, 'credibility')).toBe(50 + 1 - 1)
    expect(ch(g).sponsors.map((s) => [s.faction, s.eps_since_plug])).toEqual([['f_alpha', 0], ['f_beta', 1]])
    expect(r.timeline[0]!.data).toMatchObject({ plug: 'f_alpha', plug_pay: 500 })
    // 沒掛：兩個都 +1
    air(g, standard(g), 'ok')
    expect(ch(g).sponsors.map((s) => s.eps_since_plug)).toEqual([1, 2])
    // plug_due：f_beta 離上次掛已經滿 2 集
    expect(g.k.conditions.test({ kind: 'has_sponsor', faction: 'f_beta', plug_due: true }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe(true)
  })

  it('沒有這個金主、金主不接這一檔：不能掛', () => {
    const g = make()
    expect(episodePreview(g.k, g.state, standard(g, { plug: 'f_alpha' })).blocks).toContain('你沒有這個金主的贊助，掛不了它的業配。')
    effects(g, [{ ...SPONSOR, tiers_off: ['edgy', 'adult'] }])
    expect(episodePreview(g.k, g.state, standard(g, { plug: 'f_alpha', tier: 'edgy' })).blocks).toContain('阿爾法公司的贊助不接擦邊檔，這一集不能掛它的業配。'.replace('阿爾法公司', '阿爾法'))
    expect(episodePreview(g.k, g.state, standard(g, { plug: 'f_alpha', tier: 'all' })).blocks).toEqual([])
  })

  it('放了假料：擲風險，擲中（≤ 風險）被拆穿，公信力 −8；沒擲中不扣', () => {
    const forged = (g: G): EpisodeInput => ({ show: 'live_news', materials: [addFootage(g, { authentic: 'forged', quality: 3 })] })
    const hit = make()
    const a = forged(hit)
    expect(episodePreview(hit.k, hit.state, a).risk).toMatchObject({ risk: 7 }) // 素材的風險 2、假料 +5
    const r1 = air(hit, a, 'good', [['channel.episode/risk', (n) => n <= 7]])
    expect(r1.timeline[0]!.data).toMatchObject({ exposed: true })
    expect(meter(hit, 'credibility')).toBe(50 + 1 - 1 - 8) // 評價 +1、假料的可信只有 3（−1）、被拆穿 −8
    const miss = make()
    const b = forged(miss)
    const r2 = air(miss, b, 'good', [['channel.episode/risk', (n) => n > 7]])
    expect(r2.timeline[0]!.data).toMatchObject({ exposed: false })
    expect(meter(miss, 'credibility')).toBe(50)
    // 沒有假料就沒有風險
    const clean = make()
    expect(episodePreview(clean.k, clean.state, standard(clean)).risk).toBeNull()
  })
})

// ===================================================================================================================
describe('公演（MEDIA 4.3a）', () => {
  it('不站在舞台上被擋；站上舞台才知道製作費（地下室 200、live house 600）；酒吧不是舞台', () => {
    const g = make({ media: false })
    const input: EpisodeInput = { show: 'concert', host: 'bud', materials: [] }
    expect(episodePreview(g.k, g.state, input).blocks).toContain('「公演」要站在舞台上（地下室、live house、劇場……），你現在不在舞台上。')
    setToy(g, { facility: 'fac_bar' })
    expect(episodePreview(g.k, g.state, input).blocks.join()).toContain('不在舞台上')
    setToy(g, { facility: 'fac_basement' })
    const pv = episodePreview(g.k, g.state, input)
    expect(pv.blocks).toEqual([])
    expect(pv.cost).toBe(200)
    expect(pv.where.stage).toMatchObject({ type: 'fac_basement', size: 'basement' })
    setToy(g, { facility: 'fac_livehouse' })
    expect(episodePreview(g.k, g.state, input).cost).toBe(600)
    const own = ch(g).budget.own.cred
    air(g, input, 'flop') // 觀看 200 → 廣告 20
    expect(ch(g).budget.own.cred).toBe(own - 600 + 20)
  })

  it('檔期：劇場要門路（stage.requires 不成立被擋、寫出原因）；成人檔只在地下室與 live house', () => {
    const g = make({ media: false, facility: 'fac_theater' })
    const input: EpisodeInput = { show: 'concert', host: 'bud', materials: [] }
    expect(episodePreview(g.k, g.state, input).blocks.join()).toContain('劇場的檔期要有門路')
    give(g, [{ op: 'flag', key: 'theater_ok', value: true }])
    const pv = episodePreview(g.k, g.state, input)
    expect(pv.blocks).toEqual([])
    expect(pv.cost).toBe(1500)
    expect(episodePreview(g.k, g.state, { ...input, tier: 'edgy' }).blocks.join()).toContain('「公演」的擦邊檔只開得出來在這幾種舞台：basement、livehouse')
    setToy(g, { facility: 'fac_basement' })
    expect(episodePreview(g.k, g.state, { ...input, tier: 'adult' }).blocks).toEqual([])
  })

  it('要有偶像的路數 1 階以上：主角只有主播的路數就開不了，原因是條件的說明句', () => {
    const g = make({ facility: 'fac_basement' })
    expect(episodePreview(g.k, g.state, { show: 'concert', materials: [] }).blocks).toContain('「公演」開不出來：要有偶像的路數 1 階以上。')
    expect(episodePreview(g.k, g.state, { show: 'concert', host: 'bud', materials: [] }).blocks).toEqual([])
  })

  it('花絮：放兩件日常類的檢定 +2、三件還是 +2、一件 +1；戰鬥類放不進去', () => {
    const g = make({ facility: 'fac_basement' })
    const daily = [1, 2, 3].map(() => addFootage(g, { type: 'daily', quality: 1 }))
    const bonus = (n: number) => episodePreview(g.k, g.state, { show: 'concert', host: 'bud', materials: daily.slice(0, n) }).roll!.parts.find((p) => p.label === '料的加成')?.value ?? 0
    expect([bonus(0), bonus(1), bonus(2), bonus(3)]).toEqual([0, 1, 2, 2])
    const battle = addFootage(g, { type: 'battle' })
    expect(episodePreview(g.k, g.state, { show: 'concert', host: 'bud', materials: [battle] }).blocks.join()).toContain('只收日常、名人類')
    // 放料才扣次數；不放不扣
    air(g, { show: 'concert', host: 'bud', materials: daily.slice(0, 2) }, 'good')
    expect(daily.map((d) => usesOf(g, d))).toEqual([2, 2, 3])
  })

  it('評價「爆」人氣 +6（翻車 −2、普通 +1、好 +3）；人氣記在上鏡的人身上；沒有人定義 popularity 時略過', () => {
    const g = make({ facility: 'fac_basement' })
    const input: EpisodeInput = { show: 'concert', host: 'bud', materials: [] }
    const pv = episodePreview(g.k, g.state, input)
    expect(Object.values(pv.results!).map((r) => r.effects.map((e) => e.amount))).toEqual([[-2], [1], [3], [6]])
    air(g, input, 'hit')
    expect(meter(g, 'popularity', 'bud')).toBe(6)
    air(g, input, 'flop')
    expect(meter(g, 'popularity', 'bud')).toBe(4)
    // 沒有人定義 popularity：那一筆略過，不擋
    const bare = make({ facility: 'fac_basement' })
    const k = bare.k as unknown as { effects: { has(kind: string): boolean } }
    expect(k.effects.has('popularity')).toBe(true) // 測試的替身有，下面用沒有替身的局
    const { game: g2 } = makeGame({
      features: [{ id: 'mini', install(kk: Kernel) { for (const kind of ['district', 'facility_type']) kk.content.defineKind({ kind, owner: 'mini', validate: () => [] }) } }, toy2(), channelFeature], content: [METER_CONTENT, PACK], seed: 7,
      actors: [BUD], patch: { time: { day: 3, hour: 10, minute: 0 }, money: { cred: 5000, cash: 0 }, location: { district: 'd_a' } } as Partial<GameState>,
    })
    g2.commit(openChannel(g2.k, g2.state, 'x'))
    g2.commit(fund(g2.k, g2.state, { purse: 'cred', amount: 1000 }))
    expect(g2.k.effects.has('popularity')).toBe(false)
    expect(episodePreview(g2.k, g2.state, { show: 'concert', host: 'bud', materials: [] }).results!.hit.effects).toEqual([])
    expect(g2.commit(airEpisode(g2.k, g2.state, { show: 'concert', host: 'bud', materials: [] }))[0]!.action).toBe('channel.episode')
  })
})

/** 只有舞台與條件的小替身（沒有人氣量表）。 */
function toy2(): Feature {
  return {
    id: 'toy2', install(k: Kernel) {
      k.conditions.register({ kind: 'at_facility', owner: 'toy2', validate: () => [], test: () => true })
    },
  }
}

// ===================================================================================================================
describe('獨家（MEDIA 4.3a）', () => {
  it('沒有品質 3 以上的罪證或醜聞：showOptions 列成灰的並寫還差什麼；有了就亮', () => {
    const g = make()
    addFootage(g, { type: 'crime', quality: 2 })
    addFootage(g, { type: 'battle', quality: 5 })
    const gray = showOptions(g.k, g.state).find((s) => s.id === 'scoop')!
    expect(gray).toMatchObject({ can: false, fits: 0 })
    expect(gray.reasons).toContain('素材庫裡還沒有放得進「獨家」的料：要品質 3 以上、罪證、醜聞類的料，還差 1 件。')
    addFootage(g, { type: 'scandal', quality: 3 })
    const lit = showOptions(g.k, g.state).find((s) => s.id === 'scoop')!
    expect(lit).toMatchObject({ can: true, fits: 1, cost: 500 })
  })

  it('要有主播的路數 1 階以上；只能放一件', () => {
    const g = make({ media: false })
    const a = addFootage(g, { type: 'crime', quality: 4 })
    const b = addFootage(g, { type: 'crime', quality: 4 })
    expect(episodePreview(g.k, g.state, { show: 'scoop', materials: [a] }).blocks).toContain('「獨家」開不出來：要有主播的路數 1 階以上。')
    const anchor = make()
    const [x, y] = [addFootage(anchor, { type: 'crime', quality: 4 }), addFootage(anchor, { type: 'scandal', quality: 4 })]
    expect(episodePreview(anchor.k, anchor.state, { show: 'scoop', materials: [x, y] }).blocks).toContain('「獨家」只能放 1 件料，現在放了 2 件。')
    expect(episodePreview(anchor.k, anchor.state, { show: 'scoop', materials: [] }).blocks).toContain('「獨家」要放 1 件料，現在放了 0 件。')
    expect(b).toBeTruthy()
  })

  it('公信力：翻車 −4、普通 0、好 +2、爆 +3；播完結果帶 scoop（那一件的 ref）；料扣一次', () => {
    const g = make()
    const ref = addFootage(g, { type: 'crime', quality: 4 })
    const pv = episodePreview(g.k, g.state, { show: 'scoop', materials: [ref] })
    expect(pv.scoop).toBe(true)
    expect(Object.values(pv.results!).map((r) => r.effects.map((e) => e.amount))).toEqual([[-4], [], [2], [3]])
    const r = air(g, { show: 'scoop', materials: [ref] }, 'hit')
    expect(r.timeline[0]!.data).toMatchObject({ scoop: ref })
    expect(meter(g, 'credibility')).toBe(53)
    expect(usesOf(g, ref)).toBe(2)
    const other = addFootage(g, { type: 'scandal', quality: 3 })
    air(g, { show: 'scoop', materials: [other] }, 'flop')
    expect(meter(g, 'credibility')).toBe(49)
    // 別的節目的結果不帶 scoop
    const n = air(g, standard(g), 'ok')
    expect(n.timeline[0]!.data).not.toHaveProperty('scoop')
  })

  it('成人檔（醜聞爆料）另收親密', () => {
    const g = make()
    const ref = addFootage(g, { type: 'intimate', quality: 3 })
    expect(episodePreview(g.k, g.state, { show: 'scoop', materials: [ref] }).blocks.join()).toContain('只收罪證、醜聞類')
    expect(episodePreview(g.k, g.state, { show: 'scoop', tier: 'adult', materials: [ref] }).blocks).toEqual([])
  })
})

// ===================================================================================================================
describe('掛點 channel.episode（別的功能在這一集加東西）', () => {
  /** 替身：公演有一個「加開握手會」的選項；選了：時段 +1、打賞 ×1.5、爆多 +2 人氣；一直給 +1 的加值。 */
  const answerer = (calls?: Rec[]): Feature => ({
    id: 'ep_toy', install(k: Kernel) {
      k.hooks.on('channel.episode', 'ep_toy', (p) => {
        calls?.push({ show: p.show.id, tier: p.tier, host: p.host, staff: p.staff, where: p.where, materials: p.materials.length, options: p.options })
        const chosen = p.options.includes('meet')
        return {
          owner: 'ep_toy',
          options: [{ id: 'meet', name: '加開握手會', block: p.show.id === 'concert' ? null : '只有公演加開得了握手會。' }],
          bonus: [{ label: '握手會的熱度', value: 1 }],
          ...(chosen ? { extra_slots: 1, tips_mult: 1.5, on_grade: { hit: [{ kind: 'popularity', key: '$host', amount: 2 }] }, lines: ['你加開了一場握手會。'] } : {}),
        } as EpisodeAnswer
      })
    },
  })

  it('預覽列得出選項與加值；選了之後時間多一個時段、打賞 ×1.5、on_grade 的效果套上', () => {
    const calls: Rec[] = []
    const g = make({ features: [answerer(calls)], facility: 'fac_basement' })
    const base: EpisodeInput = { show: 'concert', host: 'bud', materials: [] }
    const pv = episodePreview(g.k, g.state, base)
    expect(pv.options).toEqual([{ id: 'meet', name: '加開握手會', block: null, owner: 'ep_toy', chosen: false }])
    expect(pv.roll!.parts.find((p) => p.label === '握手會的熱度')!.value).toBe(1)
    expect(pv.minutes).toBe(240)
    expect(calls.at(-1)).toMatchObject({ show: 'concert', tier: 'all', host: 'bud', where: { home: false, stage: { size: 'basement' } } })
    const chosen = episodePreview(g.k, g.state, { ...base, options: ['meet'] })
    expect(chosen.minutes).toBe(480)
    expect(chosen.options[0]!.chosen).toBe(true)
    expect(chosen.lines).toEqual(['你加開了一場握手會。'])
    expect(chosen.results!.hit.effects.map((e) => e.amount)).toEqual([6, 2])
    expect(chosen.results!.hit.tips).toBe(Math.floor(3000 * 0.02 * 1.5))
    expect(pv.results!.hit.tips).toBe(Math.floor(3000 * 0.02))
    const t0 = toMinutes(g.state.time)
    const r = air(g, { ...base, options: ['meet'] }, 'hit')
    expect(toMinutes(g.state.time) - t0).toBe(480)
    expect(meter(g, 'popularity', 'bud')).toBe(8)
    expect(r.narration!.results).toContain('你加開了一場握手會。')
    expect(r.timeline[0]!.data).toMatchObject({ options: ['meet'], minutes: 480 })
  })

  it('灰的選項選了會被擋（原因是它寫的）；沒有這個選項也擋', () => {
    const g = make({ features: [answerer()] })
    const input = { ...standard(g), options: ['meet'] }
    expect(episodePreview(g.k, g.state, input).blocks).toContain('只有公演加開得了握手會。')
    expect(episodePreview(g.k, g.state, { ...standard(g), options: ['nope'] }).blocks).toContain('這一集沒有「nope」這個加開的選項。')
    expect(reasonOf(() => airEpisode(g.k, g.state, input))).toBe('只有公演加開得了握手會。')
  })

  it('沒有人回答掛點：照常開；掛點的格式不對的加值（0、非數字）被略過', () => {
    const odd: Feature = { id: 'odd', install(k: Kernel) { k.hooks.on('channel.episode', 'odd', () => ({ owner: 'odd', bonus: [{ label: '零', value: 0 }, { label: '壞', value: Number.NaN }], extra_slots: Number.NaN, tips_mult: -1 }) as EpisodeAnswer) } }
    const g = make({ features: [odd] })
    const pv = episodePreview(g.k, g.state, standard(g))
    expect(pv.ok).toBe(true)
    expect(pv.minutes).toBe(240)
    expect(pv.roll!.parts.map((p) => p.label)).not.toContain('零')
    expect(pv.roll!.parts.map((p) => p.label)).not.toContain('壞')
  })
})

// ===================================================================================================================
describe('每一集的觸發點與計數', () => {
  it('報告帶觸發點 episode（節目、成人檔、評價、上鏡的人）；這一週的計數 +1；log 記一筆', () => {
    const g = make()
    const r = air(g, standard(g, { tier: 'edgy' }), 'good')
    expect(r.triggers).toEqual([{ point: 'episode', where: { show: 'live_news', adult: 'edgy', grade: 'good', host: 'pc' } }])
    expect(ch(g).week.episodes).toBe(1)
    expect(ch(g).log).toHaveLength(1)
    expect(ch(g).log[0]).toMatchObject({ kind: 'show', show: 'live_news', tier: 'edgy', grade: 'good', subs: 39 })
    air(g, standard(g), 'ok')
    expect(ch(g).week.episodes).toBe(2)
    expect(channelView(g.k, g.state)).toMatchObject({ open: true, week: { episodes: 2 } })
  })

  it('週一的流失是 2%（這一週開過）；沒開過是 5%', () => {
    const g = make()
    air(g, standard(g), 'ok')
    const subs = meter(g, 'subs')
    goTo(g, 8, 7)
    expect(meter(g, 'subs')).toBe(subs - Math.floor(subs * 0.02))
    const w = weeklies(g)[0]!
    expect(w.triggers![0]!.where).toMatchObject({ episodes: 1 })
    const idle = make()
    goTo(idle, 8, 7)
    expect(meter(idle, 'subs')).toBe(1000 - 50)
  })

  it('同一個種子、同一串輸入：結果逐位元組相同（重播）', () => {
    const run = (): string => {
      const g = make({ seed: 11 })
      g.commit(airEpisode(g.k, g.state, standard(g)))
      g.commit(airEpisode(g.k, g.state, { show: 'talk', tier: 'adult', materials: [addFootage(g)] }))
      return JSON.stringify([g.state.reports.map((r) => [r.action, r.changes, r.outcome]), g.state.ext.channel])
    }
    expect(run()).toBe(run())
  })

  it('預覽的四個機率加起來是 100，和實際擲一萬次的分佈對得上', () => {
    const g = make()
    const input = standard(g)
    const pv = episodePreview(g.k, g.state, input)
    const chance = pv.chance!
    expect(Object.values(chance).reduce((s, n) => s + n, 0)).toBe(100)
    expect(chance).toEqual(gradeChances(pv.roll!.bonus, pv.roll!.dc))
    const tally: Record<string, number> = { flop: 0, ok: 0, good: 0, hit: 0 }
    const cursor0 = g.state.rng.cursor
    const N = 10000
    for (let i = 0; i < N; i++) {
      g.state.rng.cursor = cursor0 + i
      tally[airEpisode(g.k, g.state, input).outcome.result]!++
    }
    for (const grade of ['flop', 'ok', 'good', 'hit'] as const) expect(Math.abs((tally[grade]! / N) * 100 - chance[grade]), `${grade}：${tally[grade]}`).toBeLessThan(2.5)
    expect(tally.flop! + tally.ok! + tally.good! + tally.hit!).toBe(N)
  })
})

// ===================================================================================================================
describe('編制三種位子（MEDIA 4.5；V15）', () => {
  it('坐上位子：雇來的 250、名冊上的人是出場費的一半；位子數 = 等級 + 1；不能是主角、不能坐兩個位子', () => {
    const g = make()
    const r = g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))[0]!
    expect(r.action).toBe('channel.hire')
    expect(ch(g).staff.producer).toEqual({ who: 'maker', hired: true, wage: 250, unpaid_weeks: 0 })
    g.commit(seatStaff(g.k, g.state, { role: 'source', who: 'bud' }))
    expect(ch(g).staff.source).toMatchObject({ who: 'bud', hired: false, wage: 200 })
    expect(reasonOf(() => seatStaff(g.k, g.state, { role: 'pr', who: 'pc' }))).toBe('你自己不用坐編制的位子。')
    expect(reasonOf(() => seatStaff(g.k, g.state, { role: 'pr', who: 'maker' }))).toBe('製作人已經坐在「製作」的位子上了。')
    expect(reasonOf(() => seatStaff(g.k, g.state, { role: 'producer', who: 'ace' }))).toBe('「製作」的位子已經有人（製作人）：先請他離開。')
    expect(reasonOf(() => seatStaff(g.k, g.state, { role: 'pr', who: 'ghost' }))).toBe('查不到 ghost 這個人：要先認識他。')
    // 訂閱 1,000 是 2 級（3 格）：第三個位子坐得下
    g.commit(seatStaff(g.k, g.state, { role: 'pr', who: 'spy' }))
    expect(staffSlots(g.k, g.state)).toMatchObject({ seats: 3, used: 3, free: 0 })
  })

  it('位子數 = 頻道等級 + 1：1 級只有 2 格，坐滿了再請不進來', () => {
    const g = make()
    setMeter(g, 'subs', 500)
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    g.commit(seatStaff(g.k, g.state, { role: 'source', who: 'spy' }))
    expect(staffSlots(g.k, g.state)).toMatchObject({ seats: 2, used: 2, free: 0 })
    expect(reasonOf(() => seatStaff(g.k, g.state, { role: 'pr', who: 'idle' }))).toBe('你的頻道只有 2 個位子，都坐滿了：訂閱再多一些才會多一個位子。')
    setMeter(g, 'subs', 1000)
    g.commit(seatStaff(g.k, g.state, { role: 'pr', who: 'idle' }))
    expect(Object.keys(ch(g).staff)).toHaveLength(3)
  })

  it('沒空的人坐不上、請他離開之後位子空出來、沒開頻道坐不了', () => {
    const g = make()
    setCond(g, 'maker', 'arrested')
    expect(reasonOf(() => seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))).toBe('製作人被抓了，現在沒空。')
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'spy' }))
    const r = g.commit(dismissStaff(g.k, g.state, 'producer'))[0]!
    expect(r.action).toBe('channel.dismiss')
    expect(ch(g).staff.producer).toBeUndefined()
    expect(reasonOf(() => dismissStaff(g.k, g.state, 'producer'))).toBe('「製作」的位子本來就沒有人。')
    const closed = make({ open: false })
    expect(reasonOf(() => seatStaff(closed.k, closed.state, { role: 'producer', who: 'maker' }))).toBe('還沒有頻道。')
  })

  it('條件 channel_staff { role }：有人坐才成立，說明句寫出是哪一個位子', () => {
    const g = make()
    const test = () => g.k.conditions.test({ kind: 'channel_staff', role: 'producer' }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })
    expect(test()).toBe(false)
    expect(g.k.conditions.explain({ kind: 'channel_staff', role: 'producer' }, { state: g.state, stats: g.k.stats, timeRules: g.k.timeRules })).toBe('要有人坐頻道「製作」的位子')
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    expect(test()).toBe(true)
    // media 重剪用它：有了製作就能重剪
    expect(g.k.conditions.validate({ kind: 'channel_staff', role: 'cook' }, 'c').join()).toContain('role 要是')
  })

  it('薪水：預算夠就每週扣（插在贊助撥款之後）；不夠記欠、觸發點帶 unpaid，補足後欠的歸零', () => {
    const g = make({ budget: 300 })
    setMeter(g, 'subs', 1000)
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    goTo(g, 8, 7) // 第一個週一
    expect(ch(g).budget.own.cred).toBe(300 - 250)
    expect(weeklies(g)[0]!.triggers![0]!.where).not.toHaveProperty('unpaid')
    goTo(g, 15, 7) // 第二個週一：預算只剩 50，付不出來
    expect(ch(g).budget.own.cred).toBe(50)
    expect(ch(g).staff.producer!.unpaid_weeks).toBe(1)
    expect(weeklies(g)[1]!.triggers![0]!.where).toMatchObject({ unpaid: true })
    expect(weeklies(g)[1]!.narration!.results!.join()).toContain('付不出製作人（製作）這一週的薪水')
    goTo(g, 22, 7)
    expect(ch(g).staff.producer!.unpaid_weeks).toBe(2)
    give(g, [{ op: 'channel.budget', pool: 'own', cred: 1000 }])
    goTo(g, 29, 7)
    expect(ch(g).staff.producer!.unpaid_weeks).toBe(0)
    expect(ch(g).budget.own.cred).toBe(50 + 1000 - 250)
  })

  it('薪水排在贊助撥款後面：同一個週一撥進來的錢可以拿來付薪水', () => {
    const g = make({ budget: 0 })
    effects(g, [{ kind: 'sponsor', faction: 'f_alpha', every_weeks: 1, amount: 3000 }])
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    goTo(g, 8, 7)
    expect(ch(g).budget.pools.f_alpha!.cred).toBe(3000 - 250)
    expect(ch(g).staff.producer!.unpaid_weeks).toBe(0)
  })

  it('線人每週帶回一段素材（效果 footage，品質 1～2、類型照固定亂數）；沒領到薪水的週不帶', () => {
    const run = () => {
      const g = make({ budget: 1000 })
      g.commit(seatStaff(g.k, g.state, { role: 'source', who: 'spy' }))
      goTo(g, 8, 7)
      goTo(g, 15, 7)
      return g
    }
    const g = run()
    const made = Object.values(media(g).footage)
    expect(made).toHaveLength(2)
    for (const f of made) {
      expect(f.quality).toBeGreaterThanOrEqual(1)
      expect(f.quality).toBeLessThanOrEqual(2)
      expect(DEFAULT_CHANNEL_RULES.source.types).toContain(f.type)
      expect(f.origin).toBe('staff')
      expect(f.uses).toBe(3)
    }
    expect(JSON.stringify(media(run()).footage)).toBe(JSON.stringify(media(g).footage)) // 固定亂數：同樣的局得到同樣的素材
    // 預算見底：薪水付不出來，那一週不帶
    const broke = make({ budget: 300 })
    broke.commit(seatStaff(broke.k, broke.state, { role: 'source', who: 'spy' }))
    goTo(broke, 8, 7)
    expect(Object.keys(media(broke).footage)).toHaveLength(1)
    goTo(broke, 15, 7)
    expect(Object.keys(media(broke).footage)).toHaveLength(1)
  })

  it('沒有 media：線人的那一週照樣結算，只是沒有素材', () => {
    const g = make({ noMedia: true, budget: 1000 })
    g.commit(seatStaff(g.k, g.state, { role: 'source', who: 'spy' }))
    goTo(g, 8, 7)
    expect(weeklies(g)).toHaveLength(1)
    expect(ch(g).budget.own.cred).toBe(750)
  })

  it('channelView 帶編制與設備', () => {
    const g = make()
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'ace' }))
    addItem(g, 'mic_c'); g.commit(mountGear(g.k, g.state, 'mic_c'))
    const v = channelView(g.k, g.state)
    expect(v.open && v.staff.rows.find((r) => r.role === 'producer')).toMatchObject({ who: 'ace', name: '王牌製作', hired: true, wage: 250, media: true })
    expect(v.open && v.gear).toMatchObject([{ item: 'mic_c', value: 1 }])
  })
})

// ===================================================================================================================
describe('設備（MEDIA 4.6；V17）', () => {
  it('從背包裝進頻道、拆回背包；不是設備、背包裡沒有、沒開頻道各有原因', () => {
    const g = make()
    expect(reasonOf(() => mountGear(g.k, g.state, 'mic_c'))).toBe('你的背包裡沒有「消費級收音（便攜）」。')
    addItem(g, 'rock')
    expect(reasonOf(() => mountGear(g.k, g.state, 'rock'))).toBe('「一塊石頭」不是頻道的設備。')
    expect(reasonOf(() => mountGear(g.k, g.state, 'nothing'))).toBe('「nothing」不是頻道的設備。')
    addItem(g, 'mic_c')
    const r = g.commit(mountGear(g.k, g.state, 'mic_c'))[0]!
    expect(r.action).toBe('channel.gear')
    expect(ch(g).gear).toEqual([{ uid: 'gr1', item: 'mic_c', cls: 'mic', grade: 1, portable: true }])
    expect(g.state.inventory.find((s) => s.id === 'mic_c')).toBeUndefined()
    const back = g.commit(unmountGear(g.k, g.state, 'gr1'))[0]!
    expect(back.action).toBe('channel.gear')
    expect(ch(g).gear).toEqual([])
    expect(g.state.inventory.find((s) => s.id === 'mic_c')?.qty).toBe(1)
    expect(reasonOf(() => unmountGear(g.k, g.state, 'gr9'))).toBe('頻道裡沒有裝這件設備。')
    const closed = make({ open: false })
    expect(reasonOf(() => mountGear(closed.k, closed.state, 'mic_c'))).toBe('還沒有頻道，沒有地方裝設備。')
  })

  it('棚內的設備：住處每類放得下 studio_slots 件（預設有住處 1、沒有 0）', () => {
    const g = make({ home: true })
    expect(studioSlots(g.k, g.state)).toBe(1)
    addItem(g, 'mic_s'); addItem(g, 'mic_s3')
    g.commit(mountGear(g.k, g.state, 'mic_s'))
    expect(reasonOf(() => mountGear(g.k, g.state, 'mic_s3'))).toBe('你的住處每一類棚內設備只放得下 1 件，收音已經裝滿了。')
    // 便攜的不受限
    addItem(g, 'mic_p')
    g.commit(mountGear(g.k, g.state, 'mic_p'))
    // 沒有住處：棚內的沒地方放
    setToy(g, { has_home: false })
    expect(studioSlots(g.k, g.state)).toBe(0)
    addItem(g, 'lens_s')
    expect(reasonOf(() => mountGear(g.k, g.state, 'lens_s'))).toBe('你還沒有住處，棚內的鏡頭沒有地方放。')
  })

  it('stream_gear_bonus：只裝消費級的收音是 1；收音、鏡頭、串流三類都有專業級的便攜版是 3；棚內的在街上不算；最多 +3', () => {
    const g = make()
    const bonus = () => g.k.stats.stat(g.state, 'pc', 'stream_gear_bonus')
    expect(bonus()).toBe(0)
    addItem(g, 'mic_c'); g.commit(mountGear(g.k, g.state, 'mic_c'))
    expect(bonus()).toBe(1)
    g.commit(unmountGear(g.k, g.state, 'gr1'))
    for (const id of ['mic_p', 'lens_p', 'stream_p']) { addItem(g, id); g.commit(mountGear(g.k, g.state, id)) }
    expect(bonus()).toBe(3) // 各 +1（專業級的便攜版 +2 −1）
    // 企業級便攜的收音 +2：2 + 1 + 1 = 4，夾在 3
    addItem(g, 'mic_e'); g.commit(mountGear(g.k, g.state, 'mic_e'))
    expect(bonus()).toBe(3)
    // 棚內的在街上不算、在住處算；剪輯機與燈光不是直播的設備
    const s = make({ home: true })
    addItem(s, 'stream_s'); addItem(s, 'edit_s'); addItem(s, 'light_s')
    for (const id of ['stream_s', 'edit_s', 'light_s']) s.commit(mountGear(s.k, s.state, id))
    expect(s.k.stats.stat(s.state, 'pc', 'stream_gear_bonus')).toBe(3)
    setToy(s, { home: false })
    expect(s.k.stats.stat(s.state, 'pc', 'stream_gear_bonus')).toBe(0)
    // 沒有頻道是 0
    const closed = make({ open: false })
    expect(closed.k.stats.stat(closed.state, 'pc', 'stream_gear_bonus')).toBe(0)
  })
})

// ===================================================================================================================
describe('分層與規則（原始碼、街頭信譽、B022）', () => {
  it('這一張沒有新的效果：B022 的封閉清單不用動；節目的 on_grade 只用別的功能註冊過的效果', () => {
    const g = make()
    const before = g.k.effects.kinds()
    expect(before).toEqual(expect.arrayContaining(['aired', 'channel_fund', 'sponsor', 'footage', 'subs', 'credibility', 'reco']))
    expect(g.k.conditions.kinds()).toEqual(expect.arrayContaining(['channel_open', 'channel_level', 'has_sponsor', 'channel_staff', 'channel_path']))
  })

  it('原始碼：這一張的檔案只 import 核心與自己的檔案，不讀別的功能的 state.ext', () => {
    const dir = join(fileURLToPath(new URL('../../src/features/channel', import.meta.url)))
    for (const f of ['episode.ts', 'shows.ts', 'gear.ts', 'staff.ts']) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/from '(\.[^']*)'/g)) expect(m[1], f).toMatch(/^(\.\.\/\.\.\/core|\.\/[a-z]+)$/)
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect([...code.matchAll(/state\.ext|\.ext\.(?!paths)/g)].map((m) => m[0]), f).toEqual([])
    }
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(['episode.ts', 'shows.ts', 'gear.ts', 'staff.ts']))
  })

  it('沒有任何入口給街頭信譽：開一集、坐位子、裝設備的報告沒有 rep', () => {
    const g = make()
    addItem(g, 'mic_c')
    g.commit(mountGear(g.k, g.state, 'mic_c'))
    g.commit(seatStaff(g.k, g.state, { role: 'producer', who: 'maker' }))
    air(g, standard(g, { tier: 'adult' }), 'hit')
    for (const r of g.state.reports) {
      expect(JSON.stringify(r.changes), r.action).not.toMatch(/"(kind|kind":"meter","kind)":"rep"|"kind":"rep"/)
    }
  })
})
