// L6 功能 social 的發文（MEDIA 13.1 節、2.1 節；LEWD_SYSTEM 第 5 節；dev/adr/0020 第四節、V54；dev/work/M5-social.md「要做的」第 1～3 項）。
// 來源只能是素材或片：向 media.spend（how 'post'）用掉一次，回來的變更併進這一份報告（自己不算使用次數）。
// 發文不給街頭信譽、不動公信力、不加敵對值、不動親密度（MEDIA 13.1「之後再定」）；不加 AI 任務：貼文的字照模板。
// 讀別的功能的東西只經由掛點 media.spend、量表（subs、reco、credibility、popularity、fame）與效果 fame（有人註冊才用）。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, effectCtx, isRecord, tagsAllowed, toMinutes } from '../../core'
import type { Numbers, Source } from './model'
import { FOLLOWERS, POST_ACTION, isText, numbersOf, postText, readSocial, socialRules } from './model'

export const NO_LIBRARY = '沒有素材庫。'
export const TAG_OFF = '這段素材的題材被你在內容篩選關掉了。'

// media 的兩個掛點是 media 宣告的型別：這裡不 import 別的功能，也不重複宣告，所以用字串名字問。
type AnyHook = (name: string, payload: unknown) => Array<{ owner: string; result: unknown }>
const askHook = (k: Kernel, name: string, payload: unknown): Array<{ owner: string; result: unknown }> => (k.hooks.run as unknown as AnyHook).call(k.hooks, name, payload)
const hookOwners = (k: Kernel, name: string): string[] => (k.hooks.owners as unknown as (n: string) => string[]).call(k.hooks, name)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText) : [])

/** media 回的一件料（Material）裡發文用得到的欄位；形狀不對是 null。 */
export function sourceOf(raw: unknown): Source | null {
  if (!isRecord(raw) || !isText(raw.ref) || (raw.kind !== 'footage' && raw.kind !== 'clip')) return null
  const inv = isRecord(raw.involves) ? raw.involves : {}
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    ref: raw.ref, kind: raw.kind, title: typeof raw.title === 'string' ? raw.title : '', types: strings(raw.types), quality: num(raw.quality), draw: num(raw.draw),
    fresh: raw.fresh === 'new' || raw.fresh === 'ok' ? raw.fresh : 'old', exclusive: raw.exclusive === true, celebrity: raw.celebrity === true, self: raw.self === true,
    involves: { factions: strings(inv.factions), people: strings(inv.people) }, tags: strings(raw.tags), ...(typeof raw.intro === 'string' ? { intro: raw.intro } : {}),
  }
}

/** 素材庫裡還能發文的料（media.materials；沒有人回答是 null）。 */
export function postSources(k: Kernel, state: GameState): Source[] | null {
  if (hookOwners(k, 'media.materials').length === 0) return null
  return askHook(k, 'media.materials', { state }).flatMap((r) => (Array.isArray(r.result) ? r.result : [])).map(sourceOf).filter((s): s is Source => s !== null && !!s.ref)
}

type Spent = { changes: Change[]; source: Source } | { block: string }

/** 向 media.spend 問一次（只問、不套用；它是純函式）：沒有人回答是「沒有素材庫」，用完或沒這件料是 media 的原因。 */
function spendOf(k: Kernel, state: GameState, ref: string): Spent {
  if (hookOwners(k, 'media.spend').length === 0) return { block: NO_LIBRARY }
  const a = askHook(k, 'media.spend', { state, ref, how: 'post' })[0]?.result
  if (!isRecord(a)) return { block: NO_LIBRARY }
  if (typeof a.block === 'string') return { block: a.block }
  const source = sourceOf(a.material)
  return Array.isArray(a.changes) && source ? { changes: a.changes as Change[], source } : { block: NO_LIBRARY }
}

/** 現在能不能發這一件：回傳完整的一句原因（發得了是 null）。一條一個條件：沒有素材庫、這件料用不了、題材被關掉、有別的活動擋著。 */
export function postBlock(k: Kernel, state: GameState, ref: string): string | null {
  const s = spendOf(k, state, ref)
  if ('block' in s) return s.block
  if (!tagsAllowed(state.rules, s.source.tags)) return TAG_OFF
  return k.activity.blockOf(state, `commit:${POST_ACTION}`)
}

export interface FameGain {
  /** 豔名加在哪一區 */
  district: string
  changes: Change[]
}

/** 這一篇會不會加豔名：親密類而且畫面裡有你，所在那一區 +1，每週最多 +3；不在任何一區、這一週滿了、沒有人註冊 fame 不加。 */
export function fameGain(k: Kernel, state: GameState, s: Source): FameGain | null {
  const rules = socialRules(k)
  const district = state.location.district
  if (!district || !s.types.includes('intimate') || !s.self) return null
  if (readSocial(state).week.fame >= rules.fame_week_cap || !k.effects.has('fame') || !k.meters.has('fame')) return null
  const fx = [{ kind: 'fame', amount: 1 }]
  const ctx = effectCtx(k, state, { source: 'builtin' })
  if (k.effects.validate(fx, ctx).length > 0) return null
  const res = k.effects.resolve(fx, ctx)
  return res.errors.length === 0 && res.changes.length > 0 ? { district, changes: res.changes } : null
}

export interface PostPreview extends Numbers {
  ref: string
  kind: 'footage' | 'clip'
  title: string
  text: string
  minutes: number
  /** 這一篇豔名會加在哪一區（不加是 null） */
  fame: string | null
  /** 現在擋著的原因（發得了是 null） */
  block: string | null
}

/** 發這一件會得到什麼（互動分的每一項、三個指數、觸及、愛心、留言、新追蹤）。純函式；沒有素材庫、這件料不存在或用完是 null。 */
export function postPreview(k: Kernel, state: GameState, ref: string): PostPreview | null {
  const s = spendOf(k, state, ref)
  if ('block' in s) return null
  const rules = socialRules(k)
  const n = numbersOf(k, state, rules, s.source)
  return {
    ...n, ref: s.source.ref, kind: s.source.kind, title: s.source.title, text: postText(rules, s.source), minutes: rules.minutes,
    fame: fameGain(k, state, s.source)?.district ?? null, block: postBlock(k, state, ref),
  }
}

/** 發一篇文：10 分鐘、用掉那件料一次（變更併進這份報告）、追蹤增加、豔名照規則加、記一篇。不給街頭信譽。 */
export function post(k: Kernel, state: GameState, ref: string): ReportDraft {
  const block = postBlock(k, state, ref)
  if (block) throw new ActionBlocked(block)
  const s = spendOf(k, state, ref) as { changes: Change[]; source: Source }
  const rules = socialRules(k)
  const n = numbersOf(k, state, rules, s.source)
  const fame = fameGain(k, state, s.source)
  const title = s.source.title
  const text = postText(rules, s.source)
  const at = toMinutes(state.time) + rules.minutes
  const changes: Change[] = [...(rules.minutes > 0 ? [{ op: 'time', minutes: rules.minutes } as Change] : []), ...s.changes]
  if (n.gained > 0) changes.push({ op: 'meter', kind: FOLLOWERS, key: '_', delta: n.gained })
  if (fame) changes.push(...fame.changes)
  changes.push({
    op: 'social.post',
    post: { at, ref: s.source.ref, kind: s.source.kind, title, text, reach: n.reach, likes: n.likes, comments: n.comments, gained: n.gained, ...(fame ? { fame: fame.district } : {}) },
  })
  const summary = `你發了一篇貼文「${title}」：觸及 ${n.reach}、愛心 ${n.likes}、留言 ${n.comments}、新增追蹤 ${n.gained}。`
  const lines = [`你把「${title}」發上了社群。`, ...(fame ? ['這一區又有幾個人認得你了。'] : [])]
  return {
    kind: 'broadcast', action: POST_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{
      layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: summary, tag: POST_ACTION,
      data: {
        ref: s.source.ref, kind: s.source.kind, e: n.e.value, e_raw: n.e.raw, e_parts: n.e.parts, fame_index: n.fame_index.value, channel_index: n.channel_index.value,
        followers: n.followers, reach: n.reach, likes: n.likes, comments: n.comments, gained: n.gained, ...(fame ? { fame: fame.district } : {}),
      },
    }],
    changes, outcome: { result: 'ok', summary }, narration: { results: lines },
  }
}
