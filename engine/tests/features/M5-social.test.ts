// 驗收測試：dev/work/M5-social.md（cpp-feature）。社交媒體：追蹤、用素材或片發文（MEDIA 13.1 的算式）、每週的轉換與流失、一面只有氛圍數字的動態牆。
// 規格：MEDIA 第 10 節（追蹤那一列）、2.1 節、13.1、13.2 節；SERIES 5.3 節；LEWD_SYSTEM 第 5 節；dev/adr/0020 第四節、第十三節、V29、V30、V54、V63。
// 測試裝真的 media 與 social；其餘用測試自帶的最小假資料：替身的量表（街頭信譽、公信力、推薦權重、訂閱、敵對值、親密度、人氣、豔名）、替身的條件 in_roster、
// 玩具的進行中的活動（旗標 busy）、替身的 social.feed 回答、幾份假的報告（npc.life、commission.finish、event.close）。
// 時間：測試從第 3 天 10:00 開始；第 7、14、21 天的 06:00 是週一。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Change, ContentPack, Feature, GameState, Kernel, ReportDraft } from '../../src'
import { ActionBlocked, effectCtx, meterOf, toMinutes } from '../../src'
import { mediaFeature, readMedia } from '../../src/features/media'
import {
  DEFAULT_SOCIAL_RULES, SOCIAL_FOLLOWERS, channelIndex, engagement, feedView, firstSentence, post, postBlock, postPreview, readSocial, socialFeature, socialRules, socialView, weeklyDrafts,
} from '../../src/features/social'
import { feedRowProblems, ruleProblems } from '../../src/features/social/model'
import { makeActor, makeGame, METER_CONTENT } from '../../src/testkit'

type Rec = Record<string, any>

// ===================================================================================================================
// 假資料與小工具
// ===================================================================================================================

const PACK: ContentPack = {
  id: 'social_toy_pack',
  content: {
    district: [{ id: 'test', name: '測試區' }, { id: 'd_b', name: '乙區' }],
    npc: [{ id: 'npc_bob', name: '波' }, { id: 'npc_carol', name: '卡蘿' }],
  },
}

interface Opts {
  /** 不裝頻道的三張量表（公信力、推薦權重、訂閱） */
  noChannel?: boolean
  /** 不裝訂閱（其餘頻道量表照裝） */
  noSubs?: boolean
  noFame?: boolean
  noPop?: boolean
  noMedia?: boolean
  noRoster?: boolean
  noAffinity?: boolean
  location?: Rec
  rules?: Rec
  packs?: ContentPack[]
  features?: Feature[]
  roster?: string[]
}

/** 別的功能的量表與條件的替身。 */
function toy(o: Opts): Feature {
  return {
    id: 'social_toy',
    install(k: Kernel) {
      k.content.defineKind({ kind: 'district', owner: 'social_toy', validate: () => [] })
      const def = (kind: string, name: string, extra: Rec = {}) => k.meters.define({ kind, owner: 'social_toy', name, min: 0, max: 100, start: 0, keyed: 'none', ...extra } as never)
      def('rep', '街頭信譽')
      def('hostility', '敵對值', { keyed: 'faction' })
      if (!o.noAffinity) def('affinity', '親密度', { keyed: 'npc' })
      if (!o.noChannel) {
        def('credibility', '公信力', { start: 50 })
        def('reco', '推薦權重', { min: -3, max: 3 })
        if (!o.noSubs) def('subs', '訂閱', { max: Infinity })
      }
      if (!o.noFame) def('fame', '豔名', { keyed: 'district' })
      if (!o.noPop) def('popularity', '人氣', { keyed: 'npc' })
      if (!o.noRoster) k.conditions.register({ kind: 'in_roster', owner: 'social_toy', validate: () => [], test: (c: Rec, ctx: Rec) => String(ctx.state.flags.roster ?? '').split(',').includes(c.who) })
    },
  }
}

/** 進行中的活動（旗標 busy）：不放行發文。 */
const BUSY: Feature = {
  id: 'busy_toy',
  install(k: Kernel) {
    k.activity.define({
      kind: 'dive', owner: 'busy_toy', order: 80,
      active: (s) => (s.flags.busy === true ? { id: 'd1', label: '潛入' } : null),
      allow: ['commit:test.'],
      reason: () => '潛入進行中，先把它做完。',
    })
  },
}

/** social.feed 的替身：回答的內容由測試放進 answers。 */
const answers: { list: Rec[] } = { list: [] }
const FEED_TOY: Feature = {
  id: 'feed_toy',
  install(k: Kernel) {
    k.hooks.on('social.feed', 'feed_toy', () => answers.list as never)
  },
}

const make = (o: Opts = {}) => {
  answers.list = []
  const features: Feature[] = [BUSY, toy(o), ...(o.noMedia ? [] : [mediaFeature]), socialFeature, FEED_TOY, ...(o.features ?? [])]
  const { game } = makeGame({
    features, content: [METER_CONTENT, PACK, ...(o.packs ?? [])], seed: 7,
    actors: [makeActor({ id: 'bud', name: '夥伴', role: 'companion' })],
    patch: {
      time: { day: 3, hour: 10, minute: 0 }, ...(o.location ? { location: o.location } : {}),
      flags: { ...(o.roster ? { roster: o.roster.join(',') } : {}) }, ...(o.rules ? { rules: o.rules as never } : {}),
    } as Partial<GameState>,
  })
  return game
}
type G = ReturnType<typeof make>

const sys = (changes: Change[], action = 'test.give', extra: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'system', action, location: {}, party: [], timeline: [], changes, outcome: { result: 'ok', summary: '測試。' }, ...extra,
})
const give = (g: G, changes: Change[]) => g.commit(sys(changes))
const meter = (g: G, kind: string, key = '_') => meterOf(g.k, g.state, kind, key)
const setMeter = (g: G, kind: string, value: number, key = '_') => give(g, [{ op: 'meter', kind, key, set: value }])
const advance = (g: G, minutes: number) => g.commit({ kind: 'action', action: 'test.wait', location: {}, party: [], timeline: [], changes: [{ op: 'time', minutes }], outcome: { result: 'ok', summary: '測試' } })
const goTo = (g: G, day: number, hour = 10, minute = 0) => advance(g, toMinutes({ day, hour, minute }) - toMinutes(g.state.time))
const reasonOf = (fn: () => unknown): string => {
  try { fn() } catch (e) { if (e instanceof ActionBlocked) return e.message; throw e }
  return ''
}
const soc = (g: G) => readSocial(g.state)
const media = (g: G) => readMedia(g.state)
const weeklies = (g: G) => g.state.reports.filter((r) => r.action === 'social.weekly')

const footageInit = (g: G, o: Rec = {}) => ({
  title: '碼頭的一段畫面', text: '', type: 'daily', quality: 3, authentic: 'real', exclusive: false, involves: { factions: [], people: [] }, uses: 3,
  made_at: toMinutes(g.state.time), origin: 'own', celebrity: false, self: false, adult: false, ...o,
})
/** 放一段素材進庫，回傳它的 id。 */
function addFootage(g: G, o: Rec = {}): string {
  give(g, [{ op: 'media.make', footage: footageInit(g, o) }])
  return `ft${media(g).seq}`
}
/** 放一支片進庫（直接給數字），回傳它的 id。 */
function addClip(g: G, o: Rec = {}): string {
  give(g, [{
    op: 'media.clip',
    clip: {
      from: ['ft_x'], angle: 'doc', title: '一支片', intro: '', quality: 3, types: ['daily'], involves: { factions: [], people: [] }, celebrity: false, self: false, adult: false,
      forged: false, exclusive: false, draw: 3, trust: 6, risk: 2, uses: 3, card: { kind: 'fuel', value: 3 }, made_at: toMinutes(g.state.time), ...o,
    },
  }])
  return `cl${media(g).seq}`
}
const doPost = (g: G, ref: string) => g.commit(post(g.k, g.state, ref))[0]!

/** 追蹤 1,000 的標準局：沒有任何加成，方便對數字。 */
const standardGame = (o: Opts = {}) => {
  const g = make(o)
  setMeter(g, 'followers', 1000)
  return g
}

// ===================================================================================================================
describe('發文的條件（MEDIA 13.1、2.1；V63）', () => {
  it('沒有來源發不了：素材庫裡沒有那件料，原因是完整的一句；庫裡有就發得了', () => {
    const g = make()
    expect(postBlock(g.k, g.state, 'ft99')).toBe('素材庫裡沒有這件料。')
    expect(reasonOf(() => post(g.k, g.state, 'ft99'))).toBe('素材庫裡沒有這件料。')
    expect(postPreview(g.k, g.state, 'ft99')).toBeNull()
    const id = addFootage(g)
    expect(postBlock(g.k, g.state, id)).toBeNull()
  })

  it('發一篇素材：那一段的次數 3 → 2，報告是 social.post（broadcast），時間 10 分鐘，變更是 media.use 並進同一份報告', () => {
    const g = make()
    const id = addFootage(g)
    const t0 = toMinutes(g.state.time)
    const r = doPost(g, id)
    expect(r).toMatchObject({ action: 'social.post', kind: 'broadcast' })
    expect(r.changes.filter((c) => c.op === 'media.use')).toEqual([{ op: 'media.use', ref: id, take: 1 }])
    expect(media(g).footage[id]!.uses).toBe(2)
    expect(toMinutes(g.state.time) - t0).toBe(10)
    expect(soc(g).posts).toHaveLength(1)
    expect(soc(g).posts[0]).toMatchObject({ id: 'sp1', ref: id, kind: 'footage', title: '碼頭的一段畫面', at: t0 + 10 })
    expect(soc(g).week).toEqual({ posts: 1, fame: 0 })
  })

  it('用片發：扣的是片的次數，來源素材的次數不動（MEDIA 2.1 節：片和素材各算各的）', () => {
    const g = make()
    const ft = addFootage(g)
    const cl = addClip(g)
    const r = doPost(g, cl)
    expect(r.changes.filter((c) => c.op === 'media.use')).toEqual([{ op: 'media.use', ref: cl, take: 1 }])
    expect(media(g).clips[cl]!.uses).toBe(2)
    expect(media(g).footage[ft]!.uses).toBe(3)
    expect(soc(g).posts[0]).toMatchObject({ ref: cl, kind: 'clip' })
  })

  it('用完的料發不了（原因來自 media）；用完前每發一篇少一次', () => {
    const g = make()
    const id = addFootage(g)
    for (const left of [2, 1, 0]) {
      doPost(g, id)
      expect(media(g).footage[id]!.uses).toBe(left)
    }
    expect(reasonOf(() => post(g.k, g.state, id))).toContain('已經用完了')
    expect(soc(g).posts).toHaveLength(3)
  })

  it('內容篩選只認標籤：素材的標籤被關掉就發不了（原因一句）；沒關或沒標籤的照發；adult 本身不是開關', () => {
    const off = make({ rules: { contentOff: ['blacktape'] } })
    const tagged = addFootage(off, { tags: ['blacktape'] })
    const adult = addFootage(off, { adult: true, type: 'intimate', self: true })
    expect(postBlock(off.k, off.state, tagged)).toBe('這段素材的題材被你在內容篩選關掉了。')
    expect(reasonOf(() => post(off.k, off.state, tagged))).toBe('這段素材的題材被你在內容篩選關掉了。')
    expect(media(off).footage[tagged]!.uses).toBe(3)
    expect(postBlock(off.k, off.state, adult)).toBeNull()
    const on = make()
    expect(postBlock(on.k, on.state, addFootage(on, { tags: ['blacktape'] }))).toBeNull()
    // 其他標籤關掉不影響
    const other = make({ rules: { contentOff: ['ntr'] } })
    expect(postBlock(other.k, other.state, addFootage(other, { tags: ['blacktape'] }))).toBeNull()
  })

  it('進行中有別的活動：發不了，原因是那個活動自己的句子；做完了就發得了（頻道不必開）', () => {
    const g = make()
    const id = addFootage(g)
    give(g, [{ op: 'flag', key: 'busy', value: true }])
    expect(postBlock(g.k, g.state, id)).toBe('潛入進行中，先把它做完。')
    expect(reasonOf(() => post(g.k, g.state, id))).toBe('潛入進行中，先把它做完。')
    give(g, [{ op: 'flag', key: 'busy', value: false }])
    expect(postBlock(g.k, g.state, id)).toBeNull()
  })

  it('把 media 拿掉：postBlock 回「沒有素材庫。」、預覽是 null；動態牆照樣有', () => {
    const g = make({ noMedia: true })
    expect(postBlock(g.k, g.state, 'ft1')).toBe('沒有素材庫。')
    expect(reasonOf(() => post(g.k, g.state, 'ft1'))).toBe('沒有素材庫。')
    expect(postPreview(g.k, g.state, 'ft1')).toBeNull()
    g.commit(sys([], 'commission.finish', { kind: 'gig', outcome: { result: 'done', summary: '「碼頭的貨」做完了。' } }))
    expect(feedView(g.k, g.state)).toHaveLength(1)
  })
})

// ===================================================================================================================
describe('算式（MEDIA 13.1，一項一項從規則表讀）', () => {
  // 固定輸入：追蹤 1,000、品質 4、看點 5（品質 4 ＋ 名人 1）、新（+2）、獨家、涉及名人 → E = 5 + 1 + 2 + 2 + 1 = 11
  // 人氣 100（+0.5）、這一區豔名 60（2 級，+0.1）→ 名聲指數 1.6；推薦權重 2（+0.2）、公信力 75（+0.1）、訂閱 5,000（+0.1）→ 頻道指數 1.4
  // 觸及 = max(200, 30) × (1 + 0.15 × 11 = 2.65) × 1.6 × 1.4 = 1187.2 → 1187；愛心 118.7 → 119；留言 17.85 → 18；新追蹤 23.8 → 24
  function fixed(): { g: G; id: string } {
    const g = standardGame()
    const id = addFootage(g, { quality: 4, exclusive: true, celebrity: true })
    give(g, [
      { op: 'meter', kind: 'popularity', key: 'pc', set: 100 },
      { op: 'meter', kind: 'fame', key: 'test', set: 60 },
      { op: 'meter', kind: 'reco', key: '_', set: 2 },
      { op: 'meter', kind: 'credibility', key: '_', set: 75 },
      { op: 'meter', kind: 'subs', key: '_', set: 5000 },
    ])
    return { g, id }
  }

  it('一組固定輸入逐項對：E 的每一項、兩個指數、觸及、愛心、留言、新追蹤', () => {
    const { g, id } = fixed()
    const p = postPreview(g.k, g.state, id)!
    expect(p.e.parts.map((x) => x.value)).toEqual([5, 1, 2, 2, 1])
    expect(p.e.parts.map((x) => x.label)).toEqual(['看點', '品質（比 3 高出的）', '新鮮度（新）', '獨家', '涉及名人或勢力'])
    expect([p.e.raw, p.e.value]).toEqual([11, 11])
    expect(p.fame_index.parts.map((x) => x.value)).toEqual([1, 0.5, expect.closeTo(0.1, 10)])
    expect(p.fame_index.value).toBeCloseTo(1.6, 10)
    expect(p.channel_index.parts.map((x) => x.value)).toEqual([1, expect.closeTo(0.2, 10), expect.closeTo(0.1, 10), expect.closeTo(0.1, 10)])
    expect(p.channel_index.value).toBeCloseTo(1.4, 10)
    expect([p.followers, p.reach, p.likes, p.comments, p.gained]).toEqual([1000, 1187, 119, 18, 24])
    expect(p).toMatchObject({ minutes: 10, fame: null, block: null, title: '碼頭的一段畫面', kind: 'footage' })
  })

  it('發出去之後：追蹤加上新追蹤、貼文記下同樣的數字、報告的那一拍帶每一項', () => {
    const { g, id } = fixed()
    const r = doPost(g, id)
    expect(meter(g, 'followers')).toBe(1000 + 24)
    expect(soc(g).posts[0]).toMatchObject({ reach: 1187, likes: 119, comments: 18, gained: 24 })
    const beat = r.timeline[0]!
    expect(beat).toMatchObject({ tag: 'social.post', data: { e: 11, reach: 1187, likes: 119, comments: 18, gained: 24, followers: 1000 } })
    expect((beat.data as Rec).e_parts).toHaveLength(5)
    // 給 AI 寫正文用的結果句子不帶機制數字
    expect(r.narration?.results?.join('')).not.toMatch(/\d/)
  })

  it('互動分的每一項：新鮮度（新 2、尚可 1、舊貨 0）、獨家 2、涉及名人或勢力 1（勢力也算）、品質 − 3 可以是負的', () => {
    const g = make()
    const fresh = addFootage(g, { quality: 3 })
    expect(postPreview(g.k, g.state, fresh)!.e.parts.map((x) => x.value)).toEqual([3, 0, 2, 0, 0])
    advance(g, 4 * 1440)
    expect(postPreview(g.k, g.state, fresh)!.e.parts[2]).toMatchObject({ value: 1, label: '新鮮度（尚可）' })
    advance(g, 4 * 1440)
    expect(postPreview(g.k, g.state, fresh)!.e.parts[2]).toMatchObject({ value: 0, label: '新鮮度（舊貨）' })
    const low = addFootage(g, { quality: 1, involves: { factions: ['f_alpha'], people: [] }, exclusive: true })
    // 看點 1、品質 −2、新 2、獨家 2、涉及勢力 1
    expect(postPreview(g.k, g.state, low)!.e.parts.map((x) => x.value)).toEqual([1, -2, 2, 2, 1])
    expect(postPreview(g.k, g.state, low)!.e.value).toBe(4)
  })

  it('E 夾在 0～12：超過的算 12（raw 還是 13）；負的算 0', () => {
    const g = make()
    const top = addFootage(g, { quality: 5, exclusive: true, celebrity: true })
    // 看點 5 ＋ 名人 1、品質 +2、新 2、獨家 2、涉及名人 1 = 13
    const p = postPreview(g.k, g.state, top)!
    expect([p.e.raw, p.e.value]).toEqual([13, 12])
    // 一支舊的、沒有看點的片：0 ＋ 0 ＋ 0 ＋ 0 ＋ 0；品質 1 讓它變 −2
    advance(g, 10 * 1440)
    const dud = addClip(g, { quality: 1, draw: 0, made_at: toMinutes(g.state.time) - 10 * 1440 })
    const q = postPreview(g.k, g.state, dud)!
    expect([q.e.raw, q.e.value]).toEqual([-2, 0])
    expect(engagement(socialRules(g.k), { ref: 'x', kind: 'clip', title: '', types: [], quality: 5, draw: 12, fresh: 'new', exclusive: true, celebrity: true, self: false, involves: { factions: [], people: [] }, tags: [] }).value).toBe(12)
  })

  it('觸及最少 30：追蹤 0 也有 30 的底；愛心、留言、新追蹤各自四捨五入（留言 0.45 → 0、新追蹤 0.6 → 1）', () => {
    const g = make()
    advance(g, 10 * 1440)
    const dud = addClip(g, { quality: 3, draw: 0, made_at: toMinutes(g.state.time) - 10 * 1440 })
    const p = postPreview(g.k, g.state, dud)!
    expect([p.followers, p.e.value]).toEqual([0, 0])
    expect([p.reach, p.likes, p.comments, p.gained]).toEqual([30, 3, 0, 1])
    // 追蹤 100（20% = 20）也還是 30
    setMeter(g, 'followers', 100)
    expect(postPreview(g.k, g.state, dud)!.reach).toBe(30)
    // 追蹤 200：40 > 30
    setMeter(g, 'followers', 200)
    expect(postPreview(g.k, g.state, dud)!.reach).toBe(40)
  })

  it('愛心、留言、新追蹤用規則表的比例：10%、15%、20%', () => {
    const r = DEFAULT_SOCIAL_RULES
    expect([r.reach.pct, r.reach.min, r.reach.e_mult, r.likes_pct, r.comments_pct, r.gain_pct, r.minutes, r.fame_week_cap]).toEqual([20, 30, 0.15, 10, 15, 20, 10, 3])
    expect([r.weekly.subs_pct, r.weekly.churn_pct, r.ai_followers]).toEqual([3, 3, { pct: 2, min: 20 }])
    expect([r.feed.base, r.feed.days, r.feed.max]).toEqual([{ passerby: 20, acquaintance: 50, celebrity: 300, rumor: 150 }, 3, 30])
  })

  it('三張頻道的量表都沒有人定義時頻道指數是 1（推薦權重 0、公信力 50、訂閱 0）；有的時候對式子', () => {
    const none = standardGame({ noChannel: true })
    const id = addFootage(none)
    expect(postPreview(none.k, none.state, id)!.channel_index).toEqual({ value: 1, parts: [{ label: '基礎', value: 1 }, { label: '推薦權重', value: 0 }, { label: '公信力', value: 0 }, { label: '訂閱', value: 0 }] })
    // 有定義但都在起始值（公信力 50）也是 1
    const start = standardGame()
    expect(postPreview(start.k, start.state, addFootage(start))!.channel_index.value).toBe(1)
    // 有人定義：1 + 推薦權重 × 0.1 + (公信力 − 50) ÷ 250 + 訂閱每 1,000 人 × 0.02（最多 +0.2）
    const g = standardGame()
    give(g, [{ op: 'meter', kind: 'reco', key: '_', set: -3 }, { op: 'meter', kind: 'credibility', key: '_', set: 25 }, { op: 'meter', kind: 'subs', key: '_', set: 500 }])
    expect(channelIndex(g.k, g.state, socialRules(g.k)).value).toBeCloseTo(1 - 0.3 - 0.1 + 0.01, 10)
    setMeter(g, 'subs', 1_000_000)
    expect(channelIndex(g.k, g.state, socialRules(g.k)).parts[3]!.value).toBeCloseTo(0.2, 10)
    // 只缺一張：缺的當 0、50、0
    const noSubs = standardGame({ noSubs: true })
    give(noSubs, [{ op: 'meter', kind: 'reco', key: '_', set: 1 }])
    expect(channelIndex(noSubs.k, noSubs.state, socialRules(noSubs.k)).value).toBeCloseTo(1.1, 10)
  })

  it('名聲指數：沒有人氣量表、沒有豔名量表、不在任何一區都當 0；豔名取發文所在的那一區', () => {
    const g = standardGame()
    const id = addFootage(g)
    give(g, [{ op: 'meter', kind: 'fame', key: 'd_b', set: 90 }, { op: 'meter', kind: 'fame', key: 'test', set: 30 }])
    // 這一區 30 → 1 級（不是乙區的 3 級）
    expect(postPreview(g.k, g.state, id)!.fame_index.value).toBeCloseTo(1.05, 10)
    const bare = standardGame({ noPop: true, noFame: true })
    expect(postPreview(bare.k, bare.state, addFootage(bare))!.fame_index.value).toBe(1)
    const nowhere = standardGame({ location: {} })
    give(nowhere, [{ op: 'meter', kind: 'fame', key: 'test', set: 90 }])
    expect(postPreview(nowhere.k, nowhere.state, addFootage(nowhere))!.fame_index.value).toBe(1)
  })

  it('規則表可以被資料蓋掉：蓋掉的欄位生效、沒寫的欄位和預設逐欄相同；格式不對的忽略', () => {
    const pack: ContentPack = { id: 'social_rules', content: { social_rule: [{ id: 'default', reach: { min: 50 }, minutes: 20, likes_pct: 50, feed: { base: { passerby: 40 } }, e: { exclusive: 5 } }] } }
    const g = make({ packs: [pack] })
    const r = socialRules(g.k)
    expect([r.reach, r.minutes, r.likes_pct, r.feed.base, r.e.exclusive]).toEqual([{ pct: 20, min: 50, e_mult: 0.15 }, 20, 50, { passerby: 40, acquaintance: 50, celebrity: 300, rumor: 150 }, 5])
    expect(r.comments_pct).toBe(DEFAULT_SOCIAL_RULES.comments_pct)
    expect(r.feed.sources).toEqual(DEFAULT_SOCIAL_RULES.feed.sources)
    const bad = ruleProblems({ minutes: 'x', reach: { pct: -1 }, feed: { sources: [{ action: '', unit: 'x', as: 'y' }], spread: { low: 2, high: 1 } }, texts: { footage: 3 } })
    expect(bad.length).toBeGreaterThanOrEqual(6)
    expect(feedRowProblems({ action: 'arena.', unit: 'report', as: 'witness', text: '{summary}' }, 0)).toEqual([])
    // 載入時格式不對整筆不收（內容載入就丟錯）
    expect(() => make({ packs: [{ id: 'social_bad', content: { social_rule: [{ id: 'default', minutes: 'x', reach: { pct: -1 } }] } }] })).toThrow(/minutes 要是 0～1440 的整數/)
  })

  it('貼文的字照模板：素材用標題；片用「標題」加簡介（玩家寫的原樣引用，不改寫不篩選）；沒有簡介就只有標題', () => {
    const g = make()
    const ft = addFootage(g, { title: '  怪  標題 ' })
    const cl = addClip(g, { title: '玩家自己取的名字 <b>', intro: '  這是我寫的簡介！  ' })
    const plain = addClip(g, { title: '沒簡介的片', intro: '' })
    expect(postPreview(g.k, g.state, ft)!.text).toBe('  怪  標題 ')
    expect(postPreview(g.k, g.state, cl)!.text).toBe('「玩家自己取的名字 <b>」  這是我寫的簡介！  ')
    expect(postPreview(g.k, g.state, plain)!.text).toBe('「沒簡介的片」')
    doPost(g, cl)
    expect(soc(g).posts[0]).toMatchObject({ title: '玩家自己取的名字 <b>', text: '「玩家自己取的名字 <b>」  這是我寫的簡介！  ' })
  })

  it('預覽是純函式：呼叫前後狀態逐位元組相同、沒有扣次數', () => {
    const { g, id } = standardGameWithFootage()
    const before = JSON.stringify(g.state)
    for (let i = 0; i < 3; i++) postPreview(g.k, g.state, id)
    postBlock(g.k, g.state, id)
    expect(JSON.stringify(g.state)).toBe(before)
    expect(media(g).footage[id]!.uses).toBe(3)
  })
})

function standardGameWithFootage(): { g: G; id: string } {
  const g = standardGame()
  return { g, id: addFootage(g) }
}

// ===================================================================================================================
describe('豔名（LEWD_SYSTEM 第 5 節；MEDIA 13.1）', () => {
  it('親密類而且畫面裡有你：所在那一區的豔名 +1（報告帶實際的變更；貼文記下加在哪一區）', () => {
    const g = make()
    const id = addFootage(g, { type: 'intimate', self: true })
    expect(postPreview(g.k, g.state, id)!.fame).toBe('test')
    const r = doPost(g, id)
    expect(meter(g, 'fame', 'test')).toBe(1)
    expect(meter(g, 'fame', 'd_b')).toBe(0)
    expect(r.changes.filter((c) => c.op === 'meter' && c.kind === 'fame')).toEqual([{ op: 'meter', kind: 'fame', key: 'test', delta: 1 }])
    expect(soc(g).posts[0]!.fame).toBe('test')
    expect(soc(g).week).toEqual({ posts: 1, fame: 1 })
  })

  it('同一週第四篇不再加（每週最多 +3）；下一個週一重新算', () => {
    const g = make()
    const id = addFootage(g, { type: 'intimate', self: true, uses: 10 })
    for (let i = 1; i <= 3; i++) {
      doPost(g, id)
      expect(meter(g, 'fame', 'test')).toBe(i)
    }
    expect(postPreview(g.k, g.state, id)!.fame).toBeNull()
    const fourth = doPost(g, id)
    expect(meter(g, 'fame', 'test')).toBe(3)
    expect(fourth.changes.some((c) => c.op === 'meter' && c.kind === 'fame')).toBe(false)
    expect(soc(g).posts[3]!.fame).toBeUndefined()
    expect(soc(g).week).toEqual({ posts: 4, fame: 3 })
    goTo(g, 7, 7)
    expect(soc(g).week).toEqual({ posts: 0, fame: 0 })
    doPost(g, id)
    expect(meter(g, 'fame', 'test')).toBe(4)
  })

  it('不是親密類、或畫面裡沒有你、或不在任何一區：不加；沒有豔名量表也不出錯', () => {
    const g = make()
    const daily = addFootage(g, { type: 'daily', self: true })
    const stranger = addFootage(g, { type: 'intimate', self: false })
    doPost(g, daily)
    doPost(g, stranger)
    expect(meter(g, 'fame', 'test')).toBe(0)
    const nowhere = make({ location: {} })
    const id = addFootage(nowhere, { type: 'intimate', self: true })
    expect(postPreview(nowhere.k, nowhere.state, id)!.fame).toBeNull()
    doPost(nowhere, id)
    expect(meter(nowhere, 'fame', 'test')).toBe(0)
    expect(soc(nowhere).week.fame).toBe(0)
    const bare = make({ noFame: true })
    const own = addFootage(bare, { type: 'intimate', self: true })
    expect(postPreview(bare.k, bare.state, own)!.fame).toBeNull()
    doPost(bare, own)
    expect(soc(bare).posts).toHaveLength(1)
  })

  it('片：類型裡有親密、而且畫面裡有你，也加', () => {
    const g = make()
    const cl = addClip(g, { types: ['daily', 'intimate'], self: true })
    doPost(g, cl)
    expect(meter(g, 'fame', 'test')).toBe(1)
  })
})

// ===================================================================================================================
describe('發文不給街頭信譽、不動公信力、不加敵對值、不動親密度（V54；MEDIA 13.1）', () => {
  it('發文前後 rep、credibility、每一個勢力的 hostility、每一個人的 affinity 都沒變（逐一比），報告的變更只有那幾種', () => {
    const g = standardGame()
    give(g, [
      { op: 'meter', kind: 'rep', key: '_', set: 40 }, { op: 'meter', kind: 'credibility', key: '_', set: 66 },
      { op: 'meter', kind: 'hostility', key: 'f_alpha', set: 12 }, { op: 'meter', kind: 'hostility', key: 'f_beta', set: 3 },
      { op: 'meter', kind: 'affinity', key: 'npc_ann', set: 20 }, { op: 'meter', kind: 'affinity', key: 'npc_bob', set: 55 }, { op: 'meter', kind: 'affinity', key: 'npc_carol', set: 1 },
    ])
    const ids = [
      addFootage(g, { type: 'intimate', self: true, adult: true, involves: { factions: ['f_alpha', 'f_beta'], people: ['npc_ann', 'npc_bob'] }, celebrity: true, exclusive: true }),
      addClip(g, { involves: { factions: ['f_alpha'], people: ['npc_carol'] }, forged: true, celebrity: true }),
    ]
    const keys = [['rep', '_'], ['credibility', '_'], ['hostility', 'f_alpha'], ['hostility', 'f_beta'], ['affinity', 'npc_ann'], ['affinity', 'npc_bob'], ['affinity', 'npc_carol']] as const
    const read = () => keys.map(([kind, key]) => meter(g, kind, key))
    const before = read()
    for (const id of ids) {
      const r = doPost(g, id)
      expect(read()).toEqual(before)
      for (const c of r.changes) {
        expect(['time', 'media.use', 'meter', 'social.post']).toContain(c.op)
        if (c.op === 'meter') expect(['followers', 'fame']).toContain(c.kind)
      }
    }
    expect(JSON.stringify(g.state.reports.filter((r) => r.action === 'social.post').map((r) => r.changes))).not.toMatch(/"op":"rep"|"kind":"rep"|"kind":"hostility"|"kind":"affinity"|"kind":"credibility"/)
  })
})

// ===================================================================================================================
describe('每週（MEDIA 13.1 節「每週」、第 10 節）', () => {
  it('追蹤 1,000 → 訂閱 +30、追蹤不變（這一週有發文）；計數清掉；報告是 social.weekly（downtime）', () => {
    const g = make()
    const id = addFootage(g)
    doPost(g, id)
    setMeter(g, 'followers', 1000)
    setMeter(g, 'subs', 100)
    goTo(g, 7, 7)
    expect(meter(g, 'subs')).toBe(130)
    expect(meter(g, 'followers')).toBe(1000)
    expect(soc(g).week).toEqual({ posts: 0, fame: 0 })
    expect(weeklies(g)).toHaveLength(1)
    expect(weeklies(g)[0]).toMatchObject({ kind: 'downtime', action: 'social.weekly' })
    expect(weeklies(g)[0]!.timeline[0]!.data).toMatchObject({ posts: 1, followers: 1000, to_subs: 30, loss: 0 })
  })

  it('沒發文的一週追蹤 −3%（訂閱照樣 +3%，用流失之前的追蹤算）；有發的那一週不流失', () => {
    const idle = standardGame()
    setMeter(idle, 'subs', 0)
    goTo(idle, 7, 7)
    expect(meter(idle, 'followers')).toBe(970)
    expect(meter(idle, 'subs')).toBe(30)
    expect(weeklies(idle)[0]!.timeline[0]!.data).toMatchObject({ posts: 0, loss: 30, to_subs: 30 })
    const busy = standardGame()
    doPost(busy, addFootage(busy))
    setMeter(busy, 'followers', 1000)
    goTo(busy, 7, 7)
    expect(meter(busy, 'followers')).toBe(1000)
  })

  it('一次跨過好幾個週一：每週一份報告、逐週算（第一週用記著的計數，其餘各週沒發文）', () => {
    const g = standardGame()
    goTo(g, 21, 7)
    expect(weeklies(g)).toHaveLength(3)
    // 1000 → 970 → 941 → 913（各自往下取整）；訂閱 30 ＋ 29 ＋ 28
    expect(meter(g, 'followers')).toBe(913)
    expect(meter(g, 'subs')).toBe(87)
  })

  it('沒有追蹤、這一週也沒發文：什麼報告都不出；沒有訂閱量表的局只流失、不出錯', () => {
    const g = make()
    goTo(g, 14, 7)
    expect(weeklies(g)).toHaveLength(0)
    const noSubs = standardGame({ noSubs: true })
    goTo(noSubs, 7, 7)
    expect(meter(noSubs, 'followers')).toBe(970)
    expect(weeklies(noSubs)).toHaveLength(1)
    const bare = standardGame({ noChannel: true })
    goTo(bare, 7, 7)
    expect(meter(bare, 'followers')).toBe(970)
  })

  it('剛好沒跨過週一就不結；weeklyDrafts 是純函式（不改狀態）', () => {
    const g = standardGame()
    goTo(g, 7, 5, 59)
    expect(weeklies(g)).toHaveLength(0)
    const before = JSON.stringify(g.state)
    const drafts = weeklyDrafts(g.k, g.state, { day: 7, hour: 5, minute: 59 }, { day: 7, hour: 6, minute: 0 })
    expect(drafts).toHaveLength(1)
    expect(JSON.stringify(g.state)).toBe(before)
  })
})

// ===================================================================================================================
describe('追蹤是量表（AI 的上限）', () => {
  const ai = (g: G, e: Rec) => g.k.effects.resolve([e], effectCtx(g.k, g.state, { source: 'ai' }))

  it('AI 的來源給 followers 超過上限被夾：現值的 2%、最少 20；往下也一樣；拆成幾筆合計也夾；內建的不夾', () => {
    const g = make()
    expect(ai(g, { kind: 'followers', amount: 50 }).changes).toEqual([{ op: 'meter', kind: 'followers', key: '_', delta: 20 }])
    setMeter(g, 'followers', 1000)
    expect(ai(g, { kind: 'followers', amount: 50 }).changes).toEqual([{ op: 'meter', kind: 'followers', key: '_', delta: 20 }])
    setMeter(g, 'followers', 5000)
    const big = ai(g, { kind: 'followers', amount: 300 })
    expect(big.changes).toEqual([{ op: 'meter', kind: 'followers', key: '_', delta: 100 }])
    expect(big.clamps[0]!.notice).toBe('一次最多讓追蹤增加 100 人，實際增加了 100 人。')
    expect(ai(g, { kind: 'followers', amount: -300 }).changes).toEqual([{ op: 'meter', kind: 'followers', key: '_', delta: -100 }])
    const split = g.k.effects.resolve([{ kind: 'followers', amount: 80 }, { kind: 'followers', amount: 80 }], effectCtx(g.k, g.state, { source: 'ai' }))
    expect(split.changes).toEqual([{ op: 'meter', kind: 'followers', key: '_', delta: 80 }, { op: 'meter', kind: 'followers', key: '_', delta: 20 }])
    const own = g.k.effects.resolve([{ kind: 'followers', amount: 3000 }], effectCtx(g.k, g.state, { source: 'builtin' }))
    expect(own.changes).toEqual([{ op: 'meter', kind: 'followers', key: '_', delta: 3000 }])
  })

  it('0 起、沒有下限以下（扣不成負的）、沒有上限；追蹤的名字與常數', () => {
    const g = make()
    expect(meter(g, 'followers')).toBe(0)
    setMeter(g, 'followers', 5)
    give(g, [{ op: 'meter', kind: 'followers', key: '_', delta: -50 }])
    expect(meter(g, 'followers')).toBe(0)
    setMeter(g, 'followers', 123456789)
    expect(meter(g, 'followers')).toBe(123456789)
    expect(SOCIAL_FOLLOWERS).toBe('followers')
    expect(g.k.meters.get('followers')).toMatchObject({ name: '追蹤', min: 0, start: 0, keyed: 'none' })
  })
})

// ===================================================================================================================
describe('動態牆（MEDIA 13.2；SERIES 5.3；V30）', () => {
  const npcLife = (g: G, who: string, text: string, extra: Partial<ReportDraft> = {}) =>
    g.commit(sys([], 'npc.life', { kind: 'downtime', timeline: [{ layer: 'meat', text, tag: 'npc.life', data: { npc: who, what: 'injured' } }], outcome: { result: 'life', summary: text }, ...extra }))
  const finish = (g: G, summary = '「碼頭的貨」做完了。細節很多。', extra: Partial<ReportDraft> = {}) =>
    g.commit(sys([], 'commission.finish', { kind: 'gig', outcome: { result: 'done', summary }, ...extra }))
  const eventClose = (g: G, summary = '你把事情談妥了。', extra: Partial<ReportDraft> = {}) =>
    g.commit(sys([], 'event.close', { kind: 'event', outcome: { result: 'ok', summary }, ...extra }))
  const feed = (g: G) => feedView(g.k, g.state)

  it('三種來源都認：認識的人的近況（熟人／名人與名冊上的人）、剛做完的委託（路人目擊）、走過的事件（當事人分享）', () => {
    const g = make({ roster: ['npc_carol'] })
    give(g, [{ op: 'meter', kind: 'affinity', key: 'npc_ann', set: 30 }])
    npcLife(g, 'npc_ann', '安受傷了，要養 3 天。')
    npcLife(g, 'npc_carol', '卡蘿換了義體。')
    finish(g)
    eventClose(g)
    const posts = feed(g)
    expect(posts.map((p) => [p.source, p.text, p.who])).toEqual([
      ['party', '當事人說：你把事情談妥了。', undefined],
      ['witness', '路過的人拍到一角：「碼頭的貨」做完了。', undefined],
      ['celebrity', '卡蘿換了義體。', 'npc_carol'],
      ['acquaintance', '安受傷了，要養 3 天。', 'npc_ann'],
    ])
  })

  it('認識的人：親密度 30 以上才算（29 不算）；在名冊上的算「名人與名冊上的人」（又有親密度也是）；不認識的整則不出現', () => {
    const g = make({ roster: ['npc_carol'] })
    give(g, [{ op: 'meter', kind: 'affinity', key: 'npc_ann', set: 30 }, { op: 'meter', kind: 'affinity', key: 'npc_bob', set: 29 }, { op: 'meter', kind: 'affinity', key: 'npc_carol', set: 80 }])
    npcLife(g, 'npc_ann', '安甲。')
    npcLife(g, 'npc_bob', '波乙。')
    npcLife(g, 'npc_carol', '卡蘿丙。')
    const posts = feed(g)
    expect(posts.map((p) => [p.who, p.source])).toEqual([['npc_carol', 'celebrity'], ['npc_ann', 'acquaintance']])
    // 一份報告裡有好幾個人的近況：每一拍一則
    const two = make({ roster: ['npc_carol'] })
    give(two, [{ op: 'meter', kind: 'affinity', key: 'npc_ann', set: 40 }])
    two.commit(sys([], 'npc.life', {
      kind: 'downtime', outcome: { result: 'life', summary: '好幾個人的近況。' },
      timeline: [
        { layer: 'meat', text: '安接了案。', tag: 'npc.life', data: { npc: 'npc_ann' } }, { layer: 'meat', text: '波被抓了。', tag: 'npc.life', data: { npc: 'npc_bob' } },
        { layer: 'meat', text: '卡蘿搬家了。', tag: 'npc.life', data: { npc: 'npc_carol' } }, { layer: 'meat', text: '沒有人的一拍。', tag: 'npc.life' },
      ],
    }))
    expect(feed(two).map((p) => p.text)).toEqual(['卡蘿搬家了。', '安接了案。'])
  })

  it('沒有裝名冊、沒有裝親密度的局：那一類人就不認識，其餘照樣有', () => {
    const g = make({ noRoster: true, noAffinity: true })
    npcLife(g, 'npc_ann', '安接了案。')
    finish(g)
    expect(feed(g).map((p) => p.source)).toEqual(['witness'])
  })

  it('氛圍數字：愛心 = 基數 ×（0.5～1.5）、留言 = 愛心 × 10%；基數照來源（路人 20、熟人 50、名人與名冊上的人 300、城市傳聞 150）', () => {
    const g = make({ roster: ['npc_carol'] })
    give(g, [{ op: 'meter', kind: 'affinity', key: 'npc_ann', set: 30 }])
    for (let i = 0; i < 4; i++) {
      finish(g)
      npcLife(g, 'npc_ann', `安的第 ${i} 件事。`)
      npcLife(g, 'npc_carol', `卡蘿的第 ${i} 件事。`)
      answers.list = [{ id: `t${i}`, at: toMinutes(g.state.time), source: 'rumor', text: `傳聞 ${i}。` }]
    }
    const range = (base: number): [number, number] => [Math.round(base * 0.5), Math.round(base * 1.5)]
    const posts = feed(g)
    expect(posts.length).toBe(13)
    const base: Record<string, number> = { witness: 20, acquaintance: 50, celebrity: 300, rumor: 150 }
    for (const p of posts) {
      const [lo, hi] = range(base[p.source]!)
      expect(p.likes, `${p.id}`).toBeGreaterThanOrEqual(lo)
      expect(p.likes, `${p.id}`).toBeLessThanOrEqual(hi)
      expect(p.comments).toBe(Math.round(p.likes * 0.1))
    }
    // 同一種來源的幾則不全一樣（固定亂數照貼文 id 算）
    const witness = posts.filter((p) => p.source === 'witness').map((p) => p.likes)
    expect(new Set(witness).size).toBeGreaterThan(1)
  })

  it('純函式：呼叫前後狀態逐位元組相同（連亂數游標、報告、量表都沒動）；同一個存檔同一天呼叫兩次結果一樣', () => {
    const g = make({ roster: ['npc_carol'] })
    finish(g)
    eventClose(g)
    npcLife(g, 'npc_carol', '卡蘿受傷了。')
    answers.list = [{ id: 'z', at: toMinutes(g.state.time), source: 'rumor', text: '聽說某區又出事了。' }]
    const before = JSON.stringify(g.state)
    const a = feed(g)
    const b = feed(g)
    expect(JSON.stringify(g.state)).toBe(before)
    expect(b).toEqual(a)
    expect(a.length).toBe(4)
  })

  it('隔一天，愛心數不同（種子＋日子＋貼文 id）；同一天的另一個時刻一樣', () => {
    const g = make({ roster: ['npc_carol'] })
    for (let i = 0; i < 6; i++) finish(g, `「第 ${i} 件委託」做完了。`)
    const day0 = feed(g).map((p) => p.likes)
    advance(g, 60)
    expect(feed(g).map((p) => p.likes)).toEqual(day0)
    advance(g, 24 * 60)
    const day1 = feed(g).map((p) => p.likes)
    expect(day1.length).toBe(day0.length)
    expect(day1).not.toEqual(day0)
  })

  it('不同的存檔種子，愛心數不同', () => {
    const a = make()
    for (let i = 0; i < 6; i++) finish(a, `「第 ${i} 件委託」做完了。`)
    const likesA = feed(a).map((p) => p.likes)
    const { game } = makeGame({
      features: [toy({}), mediaFeature, socialFeature], content: [METER_CONTENT, PACK], seed: 99,
      patch: { time: { day: 3, hour: 10, minute: 0 } } as Partial<GameState>,
    })
    for (let i = 0; i < 6; i++) game.commit(sys([], 'commission.finish', { kind: 'gig', outcome: { result: 'done', summary: `「第 ${i} 件委託」做完了。` } }))
    expect(feedView(game.k, game.state).map((p) => p.likes)).not.toEqual(likesA)
  })

  it('被收回的報告不出現；往回看三天（四天前的不出現，三天內的出現）', () => {
    const g = make()
    finish(g, '「被收回的委託」做完了。')
    finish(g, '「留下來的委託」做完了。')
    // 回到快照時，核心把那段經歷的報告標成被收回（紀錄留著）：這裡直接標一份
    g.state.reports[g.state.reports.length - 2]!.retracted = true
    expect(feed(g).map((p) => p.text)).toEqual(['路過的人拍到一角：「留下來的委託」做完了。'])
    advance(g, 2 * 1440 + 23 * 60)
    expect(feed(g)).toHaveLength(1)
    advance(g, 2 * 60)
    expect(feed(g)).toHaveLength(0)
  })

  it('帶 adult 的那一則只有一句、不顯示細節（來源的報告、掛點的回答都一樣）；其餘照常', () => {
    const g = make()
    eventClose(g, '一整段不該被看見的細節。第二句也不該。', { adult: true })
    eventClose(g, '你把事情談妥了。')
    answers.list = [{ id: 'a', at: toMinutes(g.state.time), source: 'rumor', text: '另一段不該被看見的細節。', adult: true }]
    const posts = feed(g)
    expect(posts).toHaveLength(3)
    const adult = posts.filter((p) => p.adult)
    expect(adult).toHaveLength(2)
    for (const p of adult) {
      expect(p.text).toBe('發了一則不方便細說的貼文。')
      expect(p.text).not.toContain('細節')
    }
    expect(posts.find((p) => !p.adult)!.text).toBe('當事人說：你把事情談妥了。')
  })

  it('內容篩選：來源的報告帶著被關掉的標籤就不出現；沒有標籤的、標籤沒關的照常', () => {
    const tagged: Partial<ReportDraft> = { timeline: [{ layer: 'meat', text: '那件事。', tag: 'event.close', data: { event: 'e1', tags: ['blacktape'] } }] }
    const off = make({ rules: { contentOff: ['blacktape'] } })
    eventClose(off, '你看見了那卷帶子。', tagged)
    eventClose(off, '你把事情談妥了。')
    expect(feed(off).map((p) => p.text)).toEqual(['當事人說：你把事情談妥了。'])
    const on = make()
    eventClose(on, '你看見了那卷帶子。', tagged)
    expect(feed(on)).toHaveLength(1)
    const other = make({ rules: { contentOff: ['ntr'] } })
    eventClose(other, '你看見了那卷帶子。', tagged)
    expect(feed(other)).toHaveLength(1)
  })

  it('social.feed 的替身回的貼文排進去（城市傳聞：基數 150）；格式不對的略過；比往回看的起點還舊的不要', () => {
    const g = make()
    finish(g)
    const now = toMinutes(g.state.time)
    answers.list = [
      { id: 'r1', at: now + 5, who: 'npc_ann', source: 'rumor', text: '聽說玻璃岸又停電了。' },
      { id: 'bad1', at: now, source: 'nope', text: '壞的來源。' },
      { id: 'bad2', at: now, source: 'rumor' },
      { id: '', at: now, source: 'rumor', text: '沒有 id。' },
      { id: 'old', at: now - 4 * 1440, source: 'rumor', text: '四天前的傳聞。' },
    ]
    const posts = feed(g)
    expect(posts.map((p) => [p.source, p.text])).toEqual([['rumor', '聽說玻璃岸又停電了。'], ['witness', '路過的人拍到一角：「碼頭的貨」做完了。']])
    expect(posts[0]).toMatchObject({ who: 'npc_ann', id: 'feed_toy:r1' })
    expect(posts[0]!.likes).toBeGreaterThanOrEqual(75)
    expect(posts[0]!.likes).toBeLessThanOrEqual(225)
  })

  it('排序：新的在前；同一時刻後來的在前；最多三十則', () => {
    const g = make()
    for (let i = 0; i < 35; i++) {
      finish(g, `「第 ${i} 件」做完了。`)
      advance(g, 1)
    }
    const posts = feed(g)
    expect(posts).toHaveLength(30)
    expect(posts[0]!.text).toContain('第 34 件')
    expect(posts[29]!.text).toContain('第 5 件')
    for (let i = 1; i < posts.length; i++) expect(posts[i - 1]!.at).toBeGreaterThanOrEqual(posts[i]!.at)
  })

  it('動態牆的來源對照表是資料：多一列（例：擂台的一場）就多一種貼文，不必改程式；M4 的幾種預設不認', () => {
    const arena = (g: G) => g.commit(sys([], 'arena.round', { kind: 'combat', outcome: { result: 'done', summary: '擂台上又打了一場。' } }))
    const plain = make()
    arena(plain)
    expect(feed(plain)).toHaveLength(0)
    const pack: ContentPack = {
      id: 'social_feed_rows',
      content: { social_rule: [{ id: 'default', feed: { sources: [...DEFAULT_SOCIAL_RULES.feed.sources, { action: 'arena.', unit: 'report', as: 'witness', text: '看台上有人說：{summary}' }] } }] },
    }
    const g = make({ packs: [pack] })
    arena(g)
    finish(g)
    expect(feed(g).map((p) => p.text)).toEqual(['路過的人拍到一角：「碼頭的貨」做完了。', '看台上有人說：擂台上又打了一場。'])
  })

  it('動態牆不算得知、不給素材、不改任何狀態：呼叫之後素材庫、量表、旗標、備忘錄一樣；一份假的線索報告不被動', () => {
    const g = make({ roster: ['npc_carol'] })
    addFootage(g)
    finish(g)
    npcLife(g, 'npc_carol', '卡蘿接了案。')
    const snapshot = JSON.stringify({ ext: g.state.ext, meters: g.state.meters, flags: g.state.flags, reports: g.state.reports, inventory: g.state.inventory })
    feed(g)
    feedView(g.k, g.state)
    expect(JSON.stringify({ ext: g.state.ext, meters: g.state.meters, flags: g.state.flags, reports: g.state.reports, inventory: g.state.inventory })).toBe(snapshot)
    expect(media(g).seq).toBe(1)
  })

  it('一句話摘要：取第一個句號、驚嘆號、問號或換行之前（含它）；沒有標點就整段', () => {
    expect(firstSentence('做完了。細節很多。')).toBe('做完了。')
    expect(firstSentence('真的嗎？不知道。')).toBe('真的嗎？')
    expect(firstSentence('第一行\n第二行')).toBe('第一行')
    expect(firstSentence('沒有標點')).toBe('沒有標點')
    expect(firstSentence('')).toBe('')
  })
})

// ===================================================================================================================
describe('我的貼文（socialView）與存檔', () => {
  it('socialView：追蹤、這一週發了幾篇與豔名、最近的貼文（新的在前）', () => {
    const g = standardGame()
    const id = addFootage(g, { type: 'intimate', self: true, uses: 10 })
    doPost(g, id)
    doPost(g, id)
    const v = socialView(g.k, g.state)
    expect(v.followers).toBe(meter(g, 'followers'))
    expect(v.week).toEqual({ posts: 2, fame: 2, fame_cap: 3 })
    expect(v.posts.map((p) => p.id)).toEqual(['sp2', 'sp1'])
  })

  it('只留最近三十篇；編號不重複地一直往上', () => {
    const g = make()
    const id = addFootage(g, { uses: 20 })
    const more = addFootage(g, { uses: 20 })
    for (let i = 0; i < 16; i++) { doPost(g, id); doPost(g, more) }
    expect(soc(g).posts).toHaveLength(30)
    expect(soc(g).posts[0]!.id).toBe('sp3')
    expect(soc(g).posts.at(-1)!.id).toBe('sp32')
    expect(soc(g).seq).toBe(32)
  })

  it('壞掉的存檔欄位當沒有：形狀不對的貼文略過、計數不是整數當 0（不丟例外）', () => {
    const g = make()
    g.state.ext.social = { posts: [{ id: 'x' }, 5, { id: 'sp9', at: 1, ref: 'ft1', kind: 'footage', title: 't', text: 'x', reach: -4, likes: 'a', comments: 2, gained: 1 }], seq: 'a', week: { posts: -1, fame: 2.5 } }
    expect(soc(g)).toEqual({ posts: [{ id: 'sp9', at: 1, ref: 'ft1', kind: 'footage', title: 't', text: 'x', reach: 0, likes: 0, comments: 2, gained: 1 }], seq: 0, week: { posts: 0, fame: 0 } })
    g.state.ext.social = 'garbage'
    expect(soc(g)).toEqual({ posts: [], seq: 0, week: { posts: 0, fame: 0 } })
    expect(socialView(g.k, g.state).posts).toEqual([])
  })

  it('存檔再讀檔：貼文與這一週的計數一模一樣；開新局是空的', () => {
    const g = make()
    expect(soc(g)).toEqual({ posts: [], seq: 0, week: { posts: 0, fame: 0 } })
    doPost(g, addFootage(g))
    const saved = JSON.parse(JSON.stringify(g.state.ext.social))
    expect(saved).toEqual(soc(g))
    expect(saved.posts).toHaveLength(1)
  })
})

// ===================================================================================================================
describe('程式的界線', () => {
  it('原始碼只 import 核心與自己的檔案；不碰別的功能的 state.ext；沒有 Math.random、Date、街頭信譽、效果與條件的註冊', () => {
    const dir = join(fileURLToPath(new URL('../../src/features/social', import.meta.url)))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/from '(\.[^']*)'/g)) expect(m[1], `${f}`).toMatch(/^(\.\.\/\.\.\/core|\.\/[a-z]+)$/)
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const m of code.matchAll(/\.ext\??(\.[a-z_]+|\[[^\]]*\])/g)) expect(m[1], f).toBe('[EXT]')
      expect(code, f).not.toMatch(/Math\.random|Date\.now|new Date|run\.say/)
      expect(code, f).not.toMatch(/kind: 'rep'|op: 'rep'|'rep'/)
      expect(code, f).not.toMatch(/conditions\.register|k\.stats\.defineStat/)
    }
  })

  it('效果只註冊 followers 這一個（量表自己的同名效果）；沒有新的條件', () => {
    const g = make()
    expect(g.k.effects.kinds()).toContain('followers')
    expect(g.k.conditions.kinds()).not.toContain('followers_min')
    expect(g.k.effects.aiKinds()).toContain('followers')
  })
})
