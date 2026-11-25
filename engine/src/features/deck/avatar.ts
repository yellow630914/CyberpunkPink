// L6 功能 deck：化身的身體（M4-scene-net；dev/adr/0019 第九節與 P42；CHARACTER 1.1 節、CYBERSPACE 4 節）。
// 化身是內海裡的那一份外觀：性別、外觀的詞條、三個可以自由開關的部位（加裝 extra、尾 tail、觸手 tentacle），外觀不改任何數值（CYBERSPACE 4.1 節）。
// 存在 actor.ext.deck.avatar：{ gender?, body?, parts, saved? }。沒有這一欄的人，化身照現實的那一份：性別照角色的、沒有多的部位。
// 改化身要在接入點（進行中的活動有 dive、腳下的設施種類有 dive 欄位、或在住處），不花錢、不花時間；戰鬥中、成人場景進行中不能改。
// 掛點 scene.body（features/scene 宣告，這裡只認名字與格式）：內海那一層回答化身的 parts；不給敏感度的修正（P42）；現實那一層不回答（現實的部位是義體的事）。
// 報告 deck.avatar。對外：avatarOf、avatarBlock、avatarDraft、avatarBody。

import type { Change, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord } from '../../core'
import { EXT, extValue, isText } from './model'

export const AVATAR_ACTION = 'deck.avatar'
/** 化身可以自由開關的部位（場景的部位 id）。 */
export const AVATAR_PARTS = ['extra', 'tail', 'tentacle'] as const
export type AvatarPart = (typeof AVATAR_PARTS)[number]
/** 五個性別值（DATA 第 1 節）。 */
export const AVATAR_GENDERS = ['male', 'female', 'femboy', 'trans_f', 'futa'] as const
/** 最多存幾套（暫定）。 */
export const AVATAR_SAVES_MAX = 5
const NAME_MAX = 30
const BODY_KEYS_MAX = 40
const BODY_TEXT_MAX = 200
/** 外觀描述（CYBERSPACE 4；使用者 2026-11-25）：玩家自己寫的一段話，最多這麼多字；我們這端不篩選、不改寫、不提示，原樣進 AI 的角色資料，不合規的由服務商擋 */
export const AVATAR_TEXT_MAX = 200

const PART_NAME: Record<AvatarPart, string> = { extra: '加裝', tail: '尾', tentacle: '觸手' }

/** 一套化身的樣子（目前的與存起來的都是這個形狀）。 */
export interface AvatarLook {
  gender?: string
  body?: Record<string, string>
  /** 外觀描述（最多 AVATAR_TEXT_MAX 字，原樣收；沒寫是沒有） */
  text?: string
  parts: AvatarPart[]
}
export interface SavedAvatar extends AvatarLook {
  name: string
}
export interface Avatar extends AvatarLook {
  saved: SavedAvatar[]
}

const isGender = (v: unknown): v is string => typeof v === 'string' && (AVATAR_GENDERS as readonly string[]).includes(v)
const isPart = (v: unknown): v is AvatarPart => typeof v === 'string' && (AVATAR_PARTS as readonly string[]).includes(v)

/** 外觀的詞條：{ 欄位: 文字 }，不是這個形狀的欄位略過。 */
function readBody(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(raw)) if (key.trim() && typeof v === 'string') out[key] = v
  return Object.keys(out).length > 0 ? out : undefined
}

function readLook(raw: Record<string, unknown>): AvatarLook {
  const parts: AvatarPart[] = []
  if (Array.isArray(raw.parts)) for (const p of raw.parts) if (isPart(p) && !parts.includes(p)) parts.push(p)
  const body = readBody(raw.body)
  const text = typeof raw.text === 'string' && raw.text.length > 0 ? raw.text.slice(0, AVATAR_TEXT_MAX) : undefined
  return { ...(isGender(raw.gender) ? { gender: raw.gender } : {}), ...(body ? { body } : {}), ...(text !== undefined ? { text } : {}), parts }
}

/** 把存檔裡的東西整理成 Avatar：壞掉的欄位丟掉，不丟錯。 */
export function readAvatar(raw: unknown): Avatar {
  if (!isRecord(raw)) return { parts: [], saved: [] }
  const saved: SavedAvatar[] = []
  if (Array.isArray(raw.saved)) {
    for (const s of raw.saved) {
      if (isRecord(s) && isText(s.name) && !saved.some((x) => x.name === s.name) && saved.length < AVATAR_SAVES_MAX) saved.push({ name: s.name, ...readLook(s) })
    }
  }
  return { ...readLook(raw), saved }
}

/** 這個人現在的化身（沒有這一欄是沒有性別、沒有部位）。沒有這個角色也是空的。 */
export const avatarOf = (state: Pick<GameState, 'actors'>, actor: string): Avatar => {
  const ext = state.actors[actor]?.ext[EXT]
  return readAvatar(isRecord(ext) ? ext.avatar : undefined)
}

/** 回答 scene.body 的格式：內海那一層回答化身開著的部位，其他層與沒有部位的人不回答。 */
export function avatarBody(state: Pick<GameState, 'actors'>, actor: string, layer: string): { parts: string[] } | undefined {
  if (layer !== 'net') return undefined
  const parts = avatarOf(state, actor).parts
  return parts.length > 0 ? { parts: [...parts] } : undefined
}

// ---- 改化身 ----

export interface AvatarOpts {
  /** 性別：五個值之一；null 是回到「照角色自己的」 */
  gender?: string | null
  /** 外觀的詞條（整份換掉，原樣存）；null 是清空 */
  body?: Record<string, string> | null
  /** 外觀描述（玩家自己寫，最多 200 字，原樣存）；null 或空字串是清空 */
  text?: string | null
  /** 開著的部位（整份換掉）：只收 extra、tail、tentacle */
  parts?: string[]
  /** 把改完的樣子存成這個名字的一套（同名蓋掉；最多五套） */
  save?: string
  /** 載入存著的那一套（不能和別的選項一起用） */
  load?: string
}

const NET_KINDS = ['dive']

/** 現在在不在接入點：進行中的活動有 dive、腳下的設施種類有 dive 欄位、或在住處。條件沒有人登記就沒有那一條路。 */
export function atAccessPoint(k: Kernel, state: GameState): boolean {
  if (k.activity.active(state).some((a) => NET_KINDS.includes(a.kind))) return true
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  const kinds = k.conditions.kinds()
  if (kinds.includes('at_facility') && k.content.hasKind('facility_type')) {
    const here = k.content
      .list<{ id: string; dive?: unknown }>('facility_type')
      .some((t) => t.dive !== undefined && t.dive !== null && t.dive !== false && k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx))
    if (here) return true
  }
  return kinds.includes('at_home') && k.conditions.test({ kind: 'at_home' }, ctx)
}

/** 算出改完的樣子；選項有問題回傳原因（一條一句）。 */
function plan(avatar: Avatar, o: AvatarOpts): { next: Avatar; problem?: string } | { problem: string } {
  const keys = (['gender', 'body', 'text', 'parts', 'save', 'load'] as const).filter((x) => o[x] !== undefined)
  if (keys.length === 0) return { problem: '沒有要改的東西。' }
  if (o.load !== undefined) {
    if (keys.length > 1) return { problem: '載入一套化身時，不能同時改別的。' }
    const found = avatar.saved.find((s) => s.name === o.load)
    if (!found) return { problem: `沒有存著叫「${String(o.load)}」的那一套化身。` }
    const { name: _name, ...look } = found
    void _name
    return { next: { ...clone(look), saved: avatar.saved.map((s) => clone(s)) } }
  }
  const next: Avatar = { ...clone(avatar), saved: avatar.saved.map((s) => clone(s)) }
  if (o.gender !== undefined) {
    if (o.gender === null) delete next.gender
    else if (isGender(o.gender)) next.gender = o.gender
    else return { problem: `性別要是 ${AVATAR_GENDERS.join('、')} 其中一個。` }
  }
  if (o.body !== undefined) {
    if (o.body === null) delete next.body
    else if (!isRecord(o.body)) return { problem: '外觀的詞條要寫成 { 欄位: 文字 }。' }
    else {
      const entries = Object.entries(o.body)
      if (entries.length > BODY_KEYS_MAX) return { problem: `外觀的詞條最多 ${BODY_KEYS_MAX} 項。` }
      for (const [key, v] of entries) {
        if (!key.trim() || typeof v !== 'string') return { problem: '外觀的詞條要寫成 { 欄位: 文字 }。' }
        if (v.length > BODY_TEXT_MAX) return { problem: `外觀的詞條「${key}」太長了（最多 ${BODY_TEXT_MAX} 字）。` }
      }
      if (entries.length > 0) next.body = Object.fromEntries(entries) as Record<string, string>
      else delete next.body
    }
  }
  if (o.text !== undefined) {
    if (o.text === null || o.text === '') delete next.text
    else if (typeof o.text !== 'string') return { problem: '外觀描述要寫成一段文字。' }
    else if (o.text.length > AVATAR_TEXT_MAX) return { problem: `外觀描述太長了（最多 ${AVATAR_TEXT_MAX} 字）。` }
    else next.text = o.text
  }
  if (o.parts !== undefined) {
    if (!Array.isArray(o.parts)) return { problem: `部位要寫成一串（只收 ${AVATAR_PARTS.join('、')}）。` }
    const bad = o.parts.filter((p) => !isPart(p))
    if (bad.length > 0) return { problem: `化身只能開 ${AVATAR_PARTS.map((p) => `${PART_NAME[p]}（${p}）`).join('、')} 這幾個部位，「${bad.map(String).join('、')}」不行。` }
    next.parts = [...new Set(o.parts as AvatarPart[])]
  }
  if (o.save !== undefined) {
    if (!isText(o.save) || o.save.length > NAME_MAX) return { problem: `存檔的名字要是 1～${NAME_MAX} 字的文字。` }
    const exists = next.saved.some((s) => s.name === o.save)
    if (!exists && next.saved.length >= AVATAR_SAVES_MAX) return { problem: `最多存 ${AVATAR_SAVES_MAX} 套化身，要先蓋掉一套（用同樣的名字）。` }
    const { saved: _saved, ...look } = next
    void _saved
    const rec: SavedAvatar = { name: o.save, ...clone(look) }
    next.saved = exists ? next.saved.map((s) => (s.name === o.save ? rec : s)) : [...next.saved, rec]
  }
  return { next }
}

const sameAvatar = (a: Avatar, b: Avatar): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 不能改化身的原因（一條一句；可以改是 null）。選項也一起檢查。 */
export function avatarBlock(k: Kernel, state: GameState, actor: string, o: AvatarOpts): string | null {
  if (!state.actors[actor]) return `沒有 ${actor} 這個角色。`
  for (const a of k.activity.active(state)) {
    if (a.kind === 'battle') return '戰鬥中不能改化身。'
    if (a.kind === 'scene') return '成人場景進行中不能改化身。'
  }
  const doing = k.activity.blockOf(state, `commit:${AVATAR_ACTION}`)
  if (doing) return doing
  if (!atAccessPoint(k, state)) return '要在接入點（潛艙店、據點，或你的住處）才能改化身。'
  const p = plan(avatarOf(state, actor), o)
  if (!('next' in p)) return p.problem
  if (sameAvatar(avatarOf(state, actor), p.next)) return '化身已經是這個樣子了。'
  return null
}

/** 改化身（報告 deck.avatar）：不花錢、不花時間。不成立丟 ActionBlocked。 */
export function avatarDraft(k: Kernel, state: GameState, actor: string, o: AvatarOpts): ReportDraft {
  const block = avatarBlock(k, state, actor, o)
  if (block) throw new ActionBlocked(block)
  const p = plan(avatarOf(state, actor), o) as { next: Avatar }
  const next = p.next
  const stored: Record<string, unknown> = { ...(next.gender !== undefined ? { gender: next.gender } : {}), ...(next.body ? { body: { ...next.body } } : {}), ...(next.text !== undefined ? { text: next.text } : {}), parts: [...next.parts], ...(next.saved.length > 0 ? { saved: next.saved.map((s) => clone(s)) } : {}) }
  const changes: Change[] = [{ op: 'actor.ext', id: actor, key: EXT, value: extValue(state, actor, { avatar: stored }) }]
  const text = o.load !== undefined ? `換上了存著的化身「${o.load}」。` : o.save !== undefined && Object.keys(o).length === 1 ? `把現在的化身存成「${o.save}」。` : `改了${state.actors[actor]!.name}的化身。`
  return {
    kind: 'action', action: AVATAR_ACTION, location: clone(state.location), actor, party: [],
    timeline: [{ layer: 'meat', actor, text, tag: AVATAR_ACTION }], changes, outcome: { result: 'ok', summary: text },
  }
}
