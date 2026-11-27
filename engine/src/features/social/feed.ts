// L6 功能 social 的動態牆（MEDIA 13.2 節；SERIES 5.3 節「動態牆不算得知」；dev/adr/0020 第四節、V30；dev/work/M5-social.md「要做的」第 5 項）。
// 純函式：不存狀態、不改任何數字、不給素材、不算得知一條線索、不寫備忘錄（呼叫前後狀態逐位元組相同）。
// 來源：往回看 feed.days 天的報告（沒有被收回的），照規則表 feed.sources 的對照變成貼文；再加掛點 social.feed 的回答。
//   預設認三種（V30）：npc.life 的每一拍（那個人主角認識：親密度到 known_affinity 以上、或在名冊上）、commission.finish（路人目擊）、event.close（當事人分享）。
//   報告帶 adult 的、或回答帶 adult 的，只留 feed.adult_text 那一句，不顯示細節。
//   內容篩選只認標籤：報告的任何一拍的 data.tags 裡有被關掉的標籤，那一則不出現（沒有標籤的照常）。
// 氛圍數字：愛心 = 基數 ×（low～high 的固定亂數，照「存檔種子＋日子＋貼文 id」算），留言 = 愛心 × 10%；同一個存檔同一天呼叫兩次結果一樣。
// 貼文的字用模板（來源的摘要一句）；片的標題與簡介原樣引用。

import type { GameState, Kernel, Report } from '../../core'
import { Rng, hash32, isRecord, isSafeInt, meterOf, tagsAllowed, toMinutes } from '../../core'
import type { FeedAnswer, FeedRow, FeedSource, SocialRules } from './model'
import { fill, firstSentence, isFeedSource, isText, socialRules } from './model'

const DAY = 1440

export interface FeedPost {
  id: string
  /** 貼文的時間（總分鐘） */
  at: number
  /** 是誰發的（有的話） */
  who?: string
  source: FeedSource
  text: string
  adult?: true
  likes: number
  comments: number
}

type AnyHook = (name: string, payload: unknown) => Array<{ owner: string; result: unknown }>
const askHook = (k: Kernel, name: string, payload: unknown): Array<{ owner: string; result: unknown }> => (k.hooks.run as unknown as AnyHook).call(k.hooks, name, payload)

const BASE_OF: Record<FeedSource, keyof SocialRules['feed']['base']> = { witness: 'passerby', party: 'acquaintance', acquaintance: 'acquaintance', celebrity: 'celebrity', rumor: 'rumor' }

/** 規則表的一列對不對得上這份報告：action 寫成 `xxx.` 結尾的是前綴，其餘整串相同。 */
const matches = (row: FeedRow, action: string | undefined): boolean => action !== undefined && (row.action.endsWith('.') ? action.startsWith(row.action) : action === row.action)

/** 一份報告的每一拍帶的標籤（data.tags）。 */
function tagsOf(report: Report): string[] {
  const out: string[] = []
  for (const b of report.timeline) {
    const t = isRecord(b.data) ? b.data.tags : undefined
    if (Array.isArray(t)) out.push(...t.filter(isText))
  }
  return out
}

/** 主角和這個人的關係：名冊上的人是「名人與名冊上的人」，親密度到門檻是「熟人」，其餘不認識（null）。條件 in_roster 有人註冊才問。 */
function relation(k: Kernel, state: GameState, rules: SocialRules, who: string): 'acquaintance' | 'celebrity' | null {
  if (k.conditions.kinds().includes('in_roster')) {
    try {
      if (k.conditions.test({ kind: 'in_roster', who }, { state, stats: k.stats, timeRules: k.timeRules })) return 'celebrity'
    } catch { /* 條件格式不合就當不在名冊上 */ }
  }
  if (k.meters.has('affinity') && who !== state.pc && meterOf(k, state, 'affinity', who) >= rules.feed.known_affinity) return 'acquaintance'
  return null
}

interface Raw { id: string; at: number; who?: string; source: FeedSource; text: string; adult: boolean }

/** 報告變成貼文（一份報告可能是一則，或每一拍一則）。 */
function fromReport(k: Kernel, state: GameState, rules: SocialRules, report: Report, since: number): Raw[] {
  const end = toMinutes(report.time.end)
  if (end < since || report.retracted === true) return []
  const rows = rules.feed.sources.filter((r) => matches(r, report.action))
  if (rows.length === 0) return []
  if (!tagsAllowed(state.rules, tagsOf(report))) return []
  const out: Raw[] = []
  for (const row of rows) {
    if (row.unit === 'report') {
      if (row.as === 'npc') continue
      out.push({ id: `r${report.id}`, at: end, source: row.as, text: fill(row.text, { summary: firstSentence(report.outcome.summary) }), adult: report.adult === true })
      continue
    }
    report.timeline.forEach((b, i) => {
      if (b.tag !== row.beat) return
      const who = isRecord(b.data) && isText(b.data.npc) ? b.data.npc : undefined
      let source: FeedSource
      if (row.as === 'npc') {
        const rel = who ? relation(k, state, rules, who) : null
        if (!who || !rel) return
        source = rel
      } else source = row.as
      out.push({ id: `r${report.id}.${i}`, at: end, ...(who ? { who } : {}), source, text: fill(row.text, { summary: firstSentence(b.text) }), adult: report.adult === true })
    })
  }
  return out
}

/** 掛點 social.feed 的回答（格式不對的略過）：id 前面加回答的人，免得兩個功能的 id 撞在一起。 */
function fromHook(k: Kernel, state: GameState, since: number): Raw[] {
  const out: Raw[] = []
  for (const a of askHook(k, 'social.feed', { state, since })) {
    if (!Array.isArray(a.result)) continue
    for (const raw of a.result as unknown[]) {
      if (!isRecord(raw) || !isText(raw.id) || !isSafeInt(raw.at) || !isFeedSource(raw.source) || typeof raw.text !== 'string') continue
      const item = raw as unknown as FeedAnswer
      if (item.at < since) continue
      out.push({ id: `${a.owner}:${item.id}`, at: item.at, ...(isText(item.who) ? { who: item.who } : {}), source: item.source, text: item.text, adult: item.adult === true })
    }
  }
  return out
}

/** 動態牆（純函式）：新的在前，最多 feed.max 則。 */
export function feedView(k: Kernel, state: GameState): FeedPost[] {
  const rules = socialRules(k)
  const now = toMinutes(state.time)
  const since = now - rules.feed.days * DAY
  const day = Math.floor(now / DAY)
  const raws: Raw[] = []
  for (const r of state.reports) raws.push(...fromReport(k, state, rules, r, since))
  raws.push(...fromHook(k, state, since))
  const posts = raws.map((r, i) => {
    const rng = new Rng(hash32(state.rng.seed, 'social/feed', day, r.id))
    const likes = Math.round(rules.feed.base[BASE_OF[r.source]] * (rules.feed.spread.low + rng.next() * (rules.feed.spread.high - rules.feed.spread.low)))
    const comments = Math.round((likes * rules.feed.comments_pct) / 100)
    const post: FeedPost = { id: r.id, at: r.at, ...(r.who ? { who: r.who } : {}), source: r.source, text: r.adult ? rules.feed.adult_text : r.text, ...(r.adult ? { adult: true as const } : {}), likes, comments }
    return { post, i }
  })
  return posts.sort((a, b) => b.post.at - a.post.at || b.i - a.i).slice(0, rules.feed.max).map((x) => x.post)
}
