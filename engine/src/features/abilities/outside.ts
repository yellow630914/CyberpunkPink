// 夜課延伸出去的技能（DATA 3.1 節的 outside；dev/adr/0019 第十節；dev/work/M4-abilities-m4.md）。
// 夜課的技能資料歸 scene（內容種類 night_skill），誰學會了什麼在 actor.ext.scene.skills。資料裡有 outside 的那幾筆，在這個功能裡是一個社交類的技能：
// id 是 night:<夜課的 id>、類別固定 social、佔 outside.cap、效果照 outside（和八棵樹同一種寫法；domain_scale 只收下，強度不另外縮）。
// 它們不在 ability 這個內容種類裡（id 有冒號），所以所有讀技能內容的地方都走 abilityEntry／allAbilities；沒有人定義 night_skill 時整段不作用。
// 用夜課自己學會的技能（在成人場景裡用的）不佔容量、學會就能用，和這裡無關；這裡只管「裝進橋」的那一份。
// 被內容篩選關掉標籤的夜課：不列、裝不上，已經裝著的也不生效（機制照舊在別處）。

import type { ActorId, ContentEntry, GameState, Kernel } from '../../core'
import { isRec, meatProblems, onlyKeys, prepProblems, useProblems } from './format'
import type { AbilityEntry } from './types'
import { DOMAIN_LEVELS, KINDS } from './types'

export const NIGHT_PREFIX = 'night:'
/** 內容種類（scene 定義；這個功能只讀） */
export const NIGHT_KIND = 'night_skill'
export const isNightId = (id: string): boolean => id.startsWith(NIGHT_PREFIX)

/** outside 能寫的鍵 */
const OUTSIDE_KEYS = ['cap', 'kind', 'use', 'meat', 'net', 'opinion', 'prep', 'daily', 'stats', 'cells', 'text', 'domain_scale', 'ai'] as const

interface NightRaw extends ContentEntry {
  name?: unknown
  text?: unknown
  tier?: unknown
  tag?: unknown
  tags?: unknown
  outside?: unknown
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** 一筆夜課裡擺在 outside 的格式問題（載入完、功能都裝好之後 checkAbilities 查）。 */
export function outsideProblems(e: NightRaw, k: Pick<Kernel, 'battle'>): string[] {
  const o = e.outside
  if (o === undefined) return []
  const at = `${NIGHT_KIND}/${e.id}：outside`
  if (!isRec(o)) return [`${at} 要是物件`]
  const p: string[] = onlyKeys(at, o, OUTSIDE_KEYS)
  if (!(isInt(o.cap) && o.cap >= 1 && o.cap <= 6)) p.push(`${at}.cap 要是 1～6 的整數（裝進橋要佔的社交容量）`)
  if (o.kind !== undefined && !(KINDS as readonly unknown[]).includes(o.kind)) p.push(`${at}.kind 只能是 ${KINDS.join('、')}`)
  const kind = o.kind ?? 'passive'
  if (o.domain_scale !== undefined && !(DOMAIN_LEVELS as readonly unknown[]).includes(o.domain_scale)) p.push(`${at}.domain_scale 只能是 ${DOMAIN_LEVELS.join('、')}`)
  if (o.cells !== undefined && !(typeof o.cells === 'number' && Number.isFinite(o.cells))) p.push(`${at}.cells 要是數字`)
  if (o.text !== undefined && !isText(o.text)) p.push(`${at}.text 要是完整的句子`)
  p.push(...useProblems(o.use, kind).map((m) => `${at}.${m}`))
  for (const col of ['meat', 'net'] as const) {
    const v = o[col]
    if (v === undefined || v === null) continue
    if (!isRec(v)) p.push(`${at}.${col} 要是物件或 null`)
    else p.push(...meatProblems(v, kind, k, col, o.use).map((m) => `${at}.${m}`))
  }
  if (o.opinion !== undefined && o.opinion !== null && !isRec(o.opinion)) p.push(`${at}.opinion 要是物件或 null`)
  p.push(...prepProblems(o.prep, kind, k).map((m) => `${at}.${m}`))
  if (o.daily !== undefined && o.daily !== null && !isRec(o.daily)) p.push(`${at}.daily 要是物件或 null`)
  return p
}

/** 合格的 outside 變成技能的樣子；不是物件或沒有 cap 的是 undefined。依內容那一筆（物件）快取：內容重載時換了物件，快取自然失效。 */
const cache = new WeakMap<object, AbilityEntry | null>()

function build(e: NightRaw): AbilityEntry | undefined {
  const hit = cache.get(e)
  if (hit !== undefined) return hit ?? undefined
  const o = e.outside
  let out: AbilityEntry | null = null
  if (isRec(o) && isInt(o.cap) && o.cap >= 1) {
    const tags = [e.tag, ...(Array.isArray(e.tags) ? e.tags : [])].filter(isText)
    out = {
      id: `${NIGHT_PREFIX}${e.id}`,
      name: isText(e.name) ? e.name : e.id,
      text: isText(o.text) ? o.text : isText(e.text) ? e.text : isText(e.name) ? e.name : e.id,
      path: 'night', category: 'social', tier: isInt(e.tier) && e.tier >= 1 ? e.tier : 1, layer: 'front',
      kind: (KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as AbilityEntry['kind']) : 'passive',
      cap: o.cap, xp: 0, cells: typeof o.cells === 'number' ? o.cells : 0,
      ...(isRec(o.use) ? { use: o.use as AbilityEntry['use'] } : {}),
      meat: isRec(o.meat) ? (o.meat as AbilityEntry['meat']) : null,
      net: isRec(o.net) ? (o.net as AbilityEntry['net']) : null,
      opinion: isRec(o.opinion) ? o.opinion : null,
      ...(isRec(o.prep) ? { prep: o.prep as AbilityEntry['prep'] } : {}),
      ...(isRec(o.daily) ? { daily: o.daily } : {}),
      ...(Array.isArray(o.stats) ? { stats: o.stats as AbilityEntry['stats'] } : {}),
      ...(isRec(o.ai) ? { ai: o.ai as unknown as AbilityEntry['ai'] } : {}),
      night: e.id, night_tags: tags,
    }
  }
  cache.set(e, out)
  return out ?? undefined
}

/** 一筆夜課延伸出去的技能（參數是夜課自己的 id，不帶 night:）。 */
export function nightAbility(k: Pick<Kernel, 'content'>, id: string): AbilityEntry | undefined {
  if (!k.content.hasKind(NIGHT_KIND)) return undefined
  const e = k.content.get<NightRaw>(NIGHT_KIND, id)
  return e ? build(e) : undefined
}

/** 所有夜課延伸的技能（沒有人定義 night_skill 是空的）。 */
export function nightAbilities(k: Pick<Kernel, 'content'>): AbilityEntry[] {
  if (!k.content.hasKind(NIGHT_KIND)) return []
  return k.content.list<NightRaw>(NIGHT_KIND).flatMap((e) => { const a = build(e); return a ? [a] : [] })
}

/** 一個技能的內容：一般的 ability，或 night:<id> 的夜課延伸。所有讀技能內容的地方都用它。 */
export function abilityEntry(k: Pick<Kernel, 'content'>, id: string): AbilityEntry | undefined {
  return isNightId(id) ? nightAbility(k, id.slice(NIGHT_PREFIX.length)) : k.content.get<AbilityEntry>('ability', id)
}

/** 一般的技能加上夜課延伸的（註冊戰鬥行動、掃一遍內容用）。 */
export function allAbilities(k: Pick<Kernel, 'content'>): AbilityEntry[] {
  return [...k.content.list<AbilityEntry>('ability'), ...nightAbilities(k)]
}

/** 這一筆夜課延伸的技能的內容篩選標籤現在有沒有被關掉。 */
export const filteredNight = (state: Pick<GameState, 'rules'>, ab: AbilityEntry): boolean => {
  const tags = Array.isArray(ab.night_tags) ? ab.night_tags : []
  return tags.some((t) => typeof t === 'string' && state.rules.contentOff.includes(t))
}

/** 這個人學會、而且有 outside、內容篩選沒關掉的夜課（id 是 night:<夜課的 id>）。誰學會了什麼讀 actor.ext.scene.skills。 */
export function learnedOutside(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): string[] {
  const scene = state.actors[actor]?.ext.scene
  const skills = isRec(scene) && Array.isArray(scene.skills) ? scene.skills.filter(isText) : []
  const out: string[] = []
  for (const s of new Set(skills)) {
    const ab = nightAbility(k, s)
    if (ab && !filteredNight(state, ab)) out.push(ab.id)
  }
  return out
}

/** 裝著而且現在算數的技能：夜課延伸的那幾個要還學得會著（learnedOutside 裡）才算，被篩選關掉的、不再學會的不生效。 */
export function liveEquipped(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, equipped: readonly string[]): string[] {
  if (!equipped.some(isNightId)) return [...equipped]
  const ok = new Set(learnedOutside(k, state, actor))
  return equipped.filter((id) => !isNightId(id) || ok.has(id))
}
