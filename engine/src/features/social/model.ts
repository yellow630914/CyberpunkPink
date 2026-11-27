// L6 功能 social 的資料與純函式：狀態的形狀（state.ext.social）、規則（內建的預設加資料蓋掉）、讀取、發文的算式。
// 規格：MEDIA 第 10 節（追蹤那一列）、2.1 節（發文扣一次）、13.1 節（玩家發文）、13.2 節（動態牆）；LEWD_SYSTEM 第 5 節（豔名）；dev/adr/0020 第四節、第十三節、V29、V30、V54；dev/work/M5-social.md。
//
// 內容種類：
//   social_rule  { id: 'default', minutes, e, fame, channel, reach, likes_pct, comments_pct, gain_pct, fame_week_cap, weekly, ai_followers, posts_keep, max_catch_up, feed, texts }：
//                蓋掉下面 DEFAULT_SOCIAL_RULES 的數字（規則表，overridable）。
//
// 狀態 state.ext.social（形狀見 SocialState）。**只經由下面兩種變更改**（ops.ts 註冊；疊在同一份報告裡也不會互相蓋掉）：
//   social.post { post }      記一篇（id 套用時發 sp<seq>；這一週的篇數與豔名計數跟著加；只留最近 posts_keep 篇）
//   social.week { reset }     清掉這一週的計數

import type { ContentEntry, GameState, Kernel } from '../../core'
import { clamp, isRecord, isSafeInt, meterOf } from '../../core'

export const OWNER = 'social'
export const EXT = 'social'
export const RULE_KIND = 'social_rule'
export const FOLLOWERS = 'followers'
export const POST_ACTION = 'social.post'
export const WEEKLY_ACTION = 'social.weekly'

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 動態牆貼文的來源（0020 第十三節）。 */
export const FEED_SOURCES = ['acquaintance', 'celebrity', 'rumor', 'witness', 'party'] as const
export type FeedSource = (typeof FEED_SOURCES)[number]
export const isFeedSource = (v: unknown): v is FeedSource => (FEED_SOURCES as readonly unknown[]).includes(v)
/** 規則表的一列「這種報告當成誰的貼文」：寫 npc 的，由那個人和主角的關係決定是熟人或名人與名冊上的人。 */
export type FeedAs = FeedSource | 'npc'
export const isFeedAs = (v: unknown): v is FeedAs => v === 'npc' || isFeedSource(v)

// ---- 規則 ----

export interface FeedRow {
  /** 報告的 action：寫成 `xxx.` 結尾的是前綴，其餘是整串相同 */
  action: string
  /** report 是整份報告一則貼文；beat 是每一拍（tag 對得上的）一則 */
  unit: 'report' | 'beat'
  /** unit 是 beat 時要的那一拍的 tag */
  beat?: string
  as: FeedAs
  /** 貼文的字：{summary} 是來源的一句話摘要 */
  text: string
}

export interface SocialRules {
  /** 發一篇花的分鐘（MEDIA 13.1：10，暫定） */
  minutes: number
  /** 互動分 E（MEDIA 13.1）：新鮮度各給幾分、獨家、涉及名人或勢力、品質的基準（品質 − 這個數）、夾在 0～max */
  e: { fresh: { new: number; ok: number; old: number }; exclusive: number; involves: number; quality_base: number; max: number }
  /** 名聲指數 = 1 ＋ 人氣 ÷ pop_div ＋ 豔名級數 × fame_mult；豔名每 step 點一級 */
  fame: { pop_div: number; fame_mult: number; step: number }
  /** 頻道指數 = 1 ＋ 推薦權重 × reco ＋（公信力 − cred_base）÷ cred_div ＋ 訂閱每 subs_per 人 × subs_mult（最多 subs_cap）；三張量表沒人定義時：推薦權重 0、公信力 cred_base、訂閱 0 */
  channel: { reco: number; cred_base: number; cred_div: number; subs_per: number; subs_mult: number; subs_cap: number }
  /** 觸及 = max(追蹤 × pct %, min) ×（1 ＋ e_mult × E）× 名聲指數 × 頻道指數 */
  reach: { pct: number; min: number; e_mult: number }
  /** 愛心 = 觸及 × likes_pct %；留言 = 愛心 × comments_pct %；新追蹤 = 愛心 × gain_pct % */
  likes_pct: number
  comments_pct: number
  gain_pct: number
  /** 豔名每週最多 +幾（發親密類、而且畫面裡有你） */
  fame_week_cap: number
  /** 每週：追蹤的 subs_pct % 轉成訂閱（追蹤不減）；這一週一篇都沒發，追蹤流失 churn_pct % */
  weekly: { subs_pct: number; churn_pct: number }
  /** AI 一件事能動的追蹤：現值的 pct %，最少 min（0020 第十三節） */
  ai_followers: { pct: number; min: number }
  /** 最近的貼文記幾篇 */
  posts_keep: number
  /** 一次時間跳過很多週時最多補結幾週 */
  max_catch_up: number
  /** 動態牆（MEDIA 13.2；V30） */
  feed: {
    /** 氛圍數字的基數：路人、熟人、名人與名冊上的人、城市傳聞 */
    base: { passerby: number; acquaintance: number; celebrity: number; rumor: number }
    /** 愛心 = 基數 ×（low ～ high 的固定亂數）；留言 = 愛心 × comments_pct % */
    spread: { low: number; high: number }
    comments_pct: number
    /** 往回看幾天 */
    days: number
    /** 最多幾則 */
    max: number
    /** 主角認識的人：親密度到這個數 */
    known_affinity: number
    /** 來源的對照表（資料加一列就多一種：M4 的 arena.、auction.、curtain.result 由資料加） */
    sources: FeedRow[]
    /** 帶 adult 的只留這一句 */
    adult_text: string
  }
  /** 貼文的字（模板；{title}、{intro} 原樣引用素材或片的標題與簡介，不改寫、不篩選） */
  texts: { footage: string; clip: string; clip_plain: string }
}

export const DEFAULT_FEED_SOURCES: FeedRow[] = [
  { action: 'npc.life', unit: 'beat', beat: 'npc.life', as: 'npc', text: '{summary}' },
  { action: 'commission.finish', unit: 'report', as: 'witness', text: '路過的人拍到一角：{summary}' },
  { action: 'event.close', unit: 'report', as: 'party', text: '當事人說：{summary}' },
]

export const DEFAULT_SOCIAL_RULES: SocialRules = {
  minutes: 10,
  e: { fresh: { new: 2, ok: 1, old: 0 }, exclusive: 2, involves: 1, quality_base: 3, max: 12 },
  fame: { pop_div: 200, fame_mult: 0.05, step: 30 },
  channel: { reco: 0.1, cred_base: 50, cred_div: 250, subs_per: 1000, subs_mult: 0.02, subs_cap: 0.2 },
  reach: { pct: 20, min: 30, e_mult: 0.15 },
  likes_pct: 10,
  comments_pct: 15,
  gain_pct: 20,
  fame_week_cap: 3,
  weekly: { subs_pct: 3, churn_pct: 3 },
  ai_followers: { pct: 2, min: 20 },
  posts_keep: 30,
  max_catch_up: 8,
  feed: {
    base: { passerby: 20, acquaintance: 50, celebrity: 300, rumor: 150 },
    spread: { low: 0.5, high: 1.5 },
    comments_pct: 10,
    days: 3,
    max: 30,
    known_affinity: 30,
    sources: DEFAULT_FEED_SOURCES,
    adult_text: '發了一則不方便細說的貼文。',
  },
  texts: { footage: '{title}', clip: '「{title}」{intro}', clip_plain: '「{title}」' },
}

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** 每一組數字的合法範圍：[欄位, 下限, 上限]。 */
const NUMBER_GROUPS: Record<string, Array<[string, number, number]>> = {
  fame: [['pop_div', 1, 100000], ['fame_mult', 0, 10], ['step', 1, 1000]],
  channel: [['reco', 0, 10], ['cred_base', 0, 100], ['cred_div', 1, 10000], ['subs_per', 1, 10000000], ['subs_mult', 0, 10], ['subs_cap', 0, 10]],
  reach: [['pct', 0, 1000], ['min', 0, 1000000], ['e_mult', 0, 10]],
  weekly: [['subs_pct', 0, 100], ['churn_pct', 0, 100]],
  ai_followers: [['pct', 0, 100], ['min', 0, 1000000]],
}
const TOP_NUMBERS: Array<[string, number, number]> = [['minutes', 0, 1440], ['likes_pct', 0, 1000], ['comments_pct', 0, 1000], ['gain_pct', 0, 1000], ['fame_week_cap', 0, 1000], ['posts_keep', 1, 1000], ['max_catch_up', 1, 520]]
const E_NUMBERS: Array<[string, number, number]> = [['exclusive', -20, 20], ['involves', -20, 20], ['quality_base', -20, 20], ['max', 0, 100]]
const FEED_NUMBERS: Array<[string, number, number]> = [['comments_pct', 0, 1000], ['days', 0, 3650], ['max', 1, 1000], ['known_affinity', 0, 100]]
const FRESH_KEYS = ['new', 'ok', 'old'] as const
const BASE_KEYS = ['passerby', 'acquaintance', 'celebrity', 'rumor'] as const
const TEXT_KEYS = ['footage', 'clip', 'clip_plain'] as const

export function feedRowProblems(r: unknown, i: number): string[] {
  const p: string[] = []
  if (!isRecord(r)) return [`feed.sources[${i}] 要是一列對照`]
  if (!isText(r.action)) p.push(`feed.sources[${i}].action 要是報告的 action（`+'`xxx.` 結尾的是前綴）')
  if (r.unit !== 'report' && r.unit !== 'beat') p.push(`feed.sources[${i}].unit 要是 report 或 beat`)
  if (r.unit === 'beat' && !isText(r.beat)) p.push(`feed.sources[${i}].beat 要是那一拍的 tag`)
  if (!isFeedAs(r.as)) p.push(`feed.sources[${i}].as 要是 ${[...FEED_SOURCES, 'npc'].join('、')} 其中一個`)
  if (typeof r.text !== 'string') p.push(`feed.sources[${i}].text 要是字串`)
  return p
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [f, lo, hi] of TOP_NUMBERS) if (e[f] !== undefined && !(isSafeInt(e[f]) && (e[f] as number) >= lo && (e[f] as number) <= hi)) p.push(`${f} 要是 ${lo}～${hi} 的整數`)
  for (const [key, fields] of Object.entries(NUMBER_GROUPS)) {
    const v = e[key]
    if (v === undefined) continue
    if (!isRecord(v)) { p.push(`${key} 要是物件`); continue }
    for (const [f, lo, hi] of fields) if (v[f] !== undefined && !finite(v[f], lo, hi)) p.push(`${key}.${f} 要是 ${lo}～${hi} 的數字`)
  }
  if (e.e !== undefined) {
    const v = e.e
    if (!isRecord(v)) p.push('e 要是物件')
    else {
      for (const [f, lo, hi] of E_NUMBERS) if (v[f] !== undefined && !(isSafeInt(v[f]) && (v[f] as number) >= lo && (v[f] as number) <= hi)) p.push(`e.${f} 要是 ${lo}～${hi} 的整數`)
      if (v.fresh !== undefined) {
        if (!isRecord(v.fresh)) p.push('e.fresh 要是物件')
        else for (const f of FRESH_KEYS) if (v.fresh[f] !== undefined && !(isSafeInt(v.fresh[f]) && (v.fresh[f] as number) >= -20 && (v.fresh[f] as number) <= 20)) p.push(`e.fresh.${f} 要是 −20～20 的整數`)
      }
    }
  }
  if (e.feed !== undefined) {
    const v = e.feed
    if (!isRecord(v)) p.push('feed 要是物件')
    else {
      for (const [f, lo, hi] of FEED_NUMBERS) if (v[f] !== undefined && !(isSafeInt(v[f]) && (v[f] as number) >= lo && (v[f] as number) <= hi)) p.push(`feed.${f} 要是 ${lo}～${hi} 的整數`)
      if (v.base !== undefined) {
        if (!isRecord(v.base)) p.push('feed.base 要是物件')
        else for (const f of BASE_KEYS) if (v.base[f] !== undefined && !finite(v.base[f], 0, 1000000)) p.push(`feed.base.${f} 要是 0 以上的數字`)
      }
      if (v.spread !== undefined) {
        if (!isRecord(v.spread)) p.push('feed.spread 要是物件')
        else {
          for (const f of ['low', 'high'] as const) if (v.spread[f] !== undefined && !finite(v.spread[f], 0, 100)) p.push(`feed.spread.${f} 要是 0～100 的數字`)
          if (finite(v.spread.low, 0, 100) && finite(v.spread.high, 0, 100) && v.spread.low > v.spread.high) p.push('feed.spread.low 不能大於 feed.spread.high')
        }
      }
      if (v.sources !== undefined) {
        if (!Array.isArray(v.sources)) p.push('feed.sources 要是陣列')
        else v.sources.forEach((r, i) => p.push(...feedRowProblems(r, i)))
      }
      if (v.adult_text !== undefined && typeof v.adult_text !== 'string') p.push('feed.adult_text 要是字串')
    }
  }
  if (e.texts !== undefined) {
    if (!isRecord(e.texts)) p.push('texts 要是物件')
    else for (const f of TEXT_KEYS) if (e.texts[f] !== undefined && typeof e.texts[f] !== 'string') p.push(`texts.${f} 要是字串`)
  }
  return p
}

const cloneRow = (r: FeedRow): FeedRow => ({ ...r })

/** 現在生效的規則：資料 social_rule/default 蓋掉內建的預設（格式不對的欄位忽略，其餘逐欄和預設相同）。 */
export function socialRules(k: Pick<Kernel, 'content'>): SocialRules {
  const d = DEFAULT_SOCIAL_RULES
  const out: SocialRules = {
    minutes: d.minutes, e: { ...d.e, fresh: { ...d.e.fresh } }, fame: { ...d.fame }, channel: { ...d.channel }, reach: { ...d.reach },
    likes_pct: d.likes_pct, comments_pct: d.comments_pct, gain_pct: d.gain_pct, fame_week_cap: d.fame_week_cap, weekly: { ...d.weekly }, ai_followers: { ...d.ai_followers },
    posts_keep: d.posts_keep, max_catch_up: d.max_catch_up,
    feed: { ...d.feed, base: { ...d.feed.base }, spread: { ...d.feed.spread }, sources: d.feed.sources.map(cloneRow) }, texts: { ...d.texts },
  }
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  for (const [f, lo, hi] of TOP_NUMBERS) if (isSafeInt(e[f]) && (e[f] as number) >= lo && (e[f] as number) <= hi) (out as unknown as Record<string, number>)[f] = e[f] as number
  for (const [key, fields] of Object.entries(NUMBER_GROUPS)) {
    const v = e[key]
    if (!isRecord(v)) continue
    const dst = (out as unknown as Record<string, Record<string, number>>)[key]!
    for (const [f, lo, hi] of fields) if (finite(v[f], lo, hi)) dst[f] = v[f]
  }
  if (isRecord(e.e)) {
    for (const [f, lo, hi] of E_NUMBERS) if (isSafeInt(e.e[f]) && (e.e[f] as number) >= lo && (e.e[f] as number) <= hi) (out.e as unknown as Record<string, number>)[f] = e.e[f] as number
    if (isRecord(e.e.fresh)) for (const f of FRESH_KEYS) if (isSafeInt(e.e.fresh[f]) && (e.e.fresh[f] as number) >= -20 && (e.e.fresh[f] as number) <= 20) out.e.fresh[f] = e.e.fresh[f] as number
  }
  if (isRecord(e.feed)) {
    const v = e.feed
    for (const [f, lo, hi] of FEED_NUMBERS) if (isSafeInt(v[f]) && (v[f] as number) >= lo && (v[f] as number) <= hi) (out.feed as unknown as Record<string, number>)[f] = v[f] as number
    if (isRecord(v.base)) for (const f of BASE_KEYS) if (finite(v.base[f], 0, 1000000)) out.feed.base[f] = v.base[f]
    if (isRecord(v.spread)) {
      const low = finite(v.spread.low, 0, 100) ? v.spread.low : out.feed.spread.low
      const high = finite(v.spread.high, 0, 100) ? v.spread.high : out.feed.spread.high
      if (low <= high) out.feed.spread = { low, high }
    }
    if (Array.isArray(v.sources) && v.sources.every((r, i) => feedRowProblems(r, i).length === 0)) {
      out.feed.sources = (v.sources as FeedRow[]).map((r) => ({ action: r.action, unit: r.unit, ...(r.unit === 'beat' && isText(r.beat) ? { beat: r.beat } : {}), as: r.as, text: r.text }))
    }
    if (typeof v.adult_text === 'string') out.feed.adult_text = v.adult_text
  }
  if (isRecord(e.texts)) for (const f of TEXT_KEYS) if (typeof e.texts[f] === 'string') out.texts[f] = e.texts[f]
  return out
}

// ---- 狀態 ----

export interface Post {
  id: string
  /** 發文的時間（總分鐘） */
  at: number
  /** 來源（素材 ft… 或片 cl…） */
  ref: string
  kind: 'footage' | 'clip'
  title: string
  text: string
  reach: number
  likes: number
  comments: number
  gained: number
  /** 豔名加在哪一區（有加才有） */
  fame?: string
}

export interface SocialState {
  /** 最近的貼文（舊的在前） */
  posts: Post[]
  seq: number
  /** 這一週：發了幾篇、豔名加了幾次 */
  week: { posts: number; fame: number }
}

export const blankSocial = (): SocialState => ({ posts: [], seq: 0, week: { posts: 0, fame: 0 } })

const nat = (v: unknown): number => (isSafeInt(v) && v > 0 ? v : 0)

function readPost(v: unknown): Post | null {
  if (!isRecord(v) || !isText(v.id) || !isSafeInt(v.at) || !isText(v.ref) || (v.kind !== 'footage' && v.kind !== 'clip')) return null
  return {
    id: v.id, at: v.at, ref: v.ref, kind: v.kind, title: typeof v.title === 'string' ? v.title : '', text: typeof v.text === 'string' ? v.text : '',
    reach: nat(v.reach), likes: nat(v.likes), comments: nat(v.comments), gained: nat(v.gained), ...(isText(v.fame) ? { fame: v.fame } : {}),
  }
}

/** 讀 state.ext.social：沒有、或形狀不對的部分當成空的（回傳的是新物件，改它不會動到狀態）。 */
export function readSocial(state: Pick<GameState, 'ext'>): SocialState {
  const raw = state.ext?.[EXT]
  const r = isRecord(raw) ? raw : {}
  const posts = (Array.isArray(r.posts) ? r.posts : []).map(readPost).filter((p): p is Post => p !== null)
  const w = isRecord(r.week) ? r.week : {}
  return { posts, seq: nat(r.seq), week: { posts: nat(w.posts), fame: nat(w.fame) } }
}

/** 寫回的值（ext 變更用）。 */
export const socialValue = (s: SocialState): SocialState => JSON.parse(JSON.stringify(s)) as SocialState

// ---- 算式（MEDIA 13.1，一項一項從規則表讀） ----

export interface Part { label: string; value: number }

/** 發文要的一件料的樣子（media.materials 與 media.spend 回的 Material 裡用得到的欄位；不 import media 的型別）。 */
export interface Source {
  ref: string
  kind: 'footage' | 'clip'
  title: string
  types: string[]
  quality: number
  draw: number
  fresh: 'new' | 'ok' | 'old'
  exclusive: boolean
  celebrity: boolean
  self: boolean
  involves: { factions: string[]; people: string[] }
  tags: string[]
  intro?: string
}

export const FRESH_NAME: Record<Source['fresh'], string> = { new: '新', ok: '尚可', old: '舊貨' }

/** 互動分 E：看點 ＋（品質 − 3）＋ 新鮮度 ＋ 獨家 ＋ 涉及名人或勢力，夾在 0～12。 */
export function engagement(rules: SocialRules, m: Source): { raw: number; value: number; parts: Part[] } {
  const e = rules.e
  const parts: Part[] = [
    { label: '看點', value: m.draw },
    { label: `品質（比 ${e.quality_base} 高出的）`, value: m.quality - e.quality_base },
    { label: `新鮮度（${FRESH_NAME[m.fresh]}）`, value: e.fresh[m.fresh] },
    { label: '獨家', value: m.exclusive ? e.exclusive : 0 },
    { label: '涉及名人或勢力', value: m.celebrity || m.involves.factions.length > 0 ? e.involves : 0 },
  ]
  const raw = parts.reduce((s, p) => s + p.value, 0)
  return { raw, value: clamp(raw, 0, e.max), parts }
}

/** 主角的人氣（沒有人定義 popularity、或沒有主角是 0）。 */
export function popularityOf(k: Kernel, state: GameState): number {
  return k.meters.has('popularity') && state.pc ? meterOf(k, state, 'popularity', state.pc) : 0
}

/** 發文所在的區的豔名級數（沒有豔名量表、不在任何一區是 0）。 */
export function fameLevelHere(k: Kernel, state: GameState, rules: SocialRules): number {
  const district = state.location.district
  if (!k.meters.has('fame') || !district) return 0
  return Math.floor(meterOf(k, state, 'fame', district) / rules.fame.step)
}

/** 名聲指數 = 1 ＋ 人氣 ÷ 200 ＋ 豔名級數 × 0.05。 */
export function fameIndex(k: Kernel, state: GameState, rules: SocialRules): { value: number; parts: Part[] } {
  const pop = popularityOf(k, state)
  const level = fameLevelHere(k, state, rules)
  const parts: Part[] = [{ label: '基礎', value: 1 }, { label: '人氣', value: pop / rules.fame.pop_div }, { label: '豔名', value: level * rules.fame.fame_mult }]
  return { value: parts.reduce((s, p) => s + p.value, 0), parts }
}

/** 頻道指數 = 1 ＋ 推薦權重 × 0.1 ＋（公信力 − 50）÷ 250 ＋ 訂閱每 1,000 人 × 0.02（最多 +0.2）；三張量表沒有人定義時：推薦權重 0、公信力 50、訂閱 0。 */
export function channelIndex(k: Kernel, state: GameState, rules: SocialRules): { value: number; parts: Part[] } {
  const c = rules.channel
  const reco = k.meters.has('reco') ? meterOf(k, state, 'reco') : 0
  const cred = k.meters.has('credibility') ? meterOf(k, state, 'credibility') : c.cred_base
  const subs = k.meters.has('subs') ? meterOf(k, state, 'subs') : 0
  const parts: Part[] = [
    { label: '基礎', value: 1 },
    { label: '推薦權重', value: reco * c.reco },
    { label: '公信力', value: (cred - c.cred_base) / c.cred_div },
    { label: '訂閱', value: Math.min(c.subs_cap, (subs / c.subs_per) * c.subs_mult) },
  ]
  return { value: parts.reduce((s, p) => s + p.value, 0), parts }
}

export interface Numbers {
  e: { raw: number; value: number; parts: Part[] }
  fame_index: { value: number; parts: Part[] }
  channel_index: { value: number; parts: Part[] }
  followers: number
  reach: number
  likes: number
  comments: number
  gained: number
}

/** 觸及 = max(追蹤 × 20%, 30) ×（1 ＋ 0.15 × E）× 名聲指數 × 頻道指數；愛心、留言、新追蹤照比例；都四捨五入成整數（後一項照前一項已經四捨五入的數字算）。 */
export function numbersOf(k: Kernel, state: GameState, rules: SocialRules, m: Source): Numbers {
  const e = engagement(rules, m)
  const fame = fameIndex(k, state, rules)
  const channel = channelIndex(k, state, rules)
  const followers = meterOf(k, state, FOLLOWERS)
  const reach = Math.round(Math.max((followers * rules.reach.pct) / 100, rules.reach.min) * (1 + rules.reach.e_mult * e.value) * fame.value * channel.value)
  const likes = Math.round((reach * rules.likes_pct) / 100)
  const comments = Math.round((likes * rules.comments_pct) / 100)
  const gained = Math.round((likes * rules.gain_pct) / 100)
  return { e, fame_index: fame, channel_index: channel, followers, reach, likes, comments, gained }
}

/** 把模板裡的 {名字} 換成給的字（沒給的換成空字串；原樣引用，不改寫）。 */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? '')
}

/** 貼文的字：用片的簡介（玩家寫的原樣引用）或素材的標題。 */
export function postText(rules: SocialRules, m: Source): string {
  if (m.kind === 'footage') return fill(rules.texts.footage, { title: m.title })
  const intro = m.intro ?? ''
  return intro.length > 0 ? fill(rules.texts.clip, { title: m.title, intro }) : fill(rules.texts.clip_plain, { title: m.title })
}

/** 來源的一句話摘要：取第一個句號、驚嘆號、問號、換行之前（含它）。 */
export function firstSentence(text: string): string {
  const m = /^[^。！？\n]*[。！？]?/.exec(text.trim())
  return (m ? m[0] : text).trim()
}

declare module '../../core' {
  interface HookMap {
    /** 動態牆多的貼文（social 宣告並問；之後的線索池、npcs 回答）：since 是往回看的起點（總分鐘）。 */
    'social.feed': [{ state: GameState; since: number }, FeedAnswer[] | void]
  }
}

export interface FeedAnswer {
  id: string
  /** 貼文的時間（總分鐘） */
  at: number
  who?: string
  source: FeedSource
  text: string
  adult?: boolean
}
