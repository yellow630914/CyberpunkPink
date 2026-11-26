// 素材與片進牌庫（OPINION 4.3a；dev/adr/0020 第五節、V33）：開戰前挑要帶的料，一件變成一張牌，進牌庫的那一刻扣 1 次使用次數（只走 media.spend，how 'deck'）。
// 牌是哪一種：看料自己的 card（片的角度定的：說法用可信、料用看點、娛樂只能當轉移焦點、日常不能當牌；不剪的素材一律是料，數字用看點）
//   × 和議題的關係（拍到議題的勢力或人：全額；只有類型相同：數字減半進位；無關：只能當轉移焦點的燃料）。
// 牌面（V33）：料的聲量 = 看點 ÷ 2 進位、夾 1～4，3 以上花 2 點否則 1 點；說法：可信 6 以上風向 2（花 2 點）否則 1（花 1 點）；
//   假料（抹黑的片、偽造的料剪成的片）牌面再 +1，打出去擲 d20，6 以下被拆穿；要被動 forged_ok 才放得進牌庫。
// 讀 media 的東西只經由掛點 media.materials、media.spend（字串名字問；不重複宣告它們的型別）；沒有裝 media 就沒有料可以帶。

import type { Change, GameState, Kernel } from '../../core'
import { ActionBlocked, isRecord } from '../../core'
import { askPassives } from './hooks'
import { passiveMods } from './mods'
import type { OpPassive } from './hooks'
import type { OpinionRules, WarCard } from './model'
import { opinionRules } from './model'

/** media 的 Material 裡 opinion 用到的欄位（只認格式，不 import media 的型別）。 */
export interface BroughtMaterial {
  ref: string
  kind: 'footage' | 'clip'
  title: string
  types: string[]
  angle?: string
  uses: number
  forged: boolean
  involves: { factions: string[]; people: string[] }
  card: { kind: 'fuel' | 'line' | 'decoy'; value: number } | null
}

export type Relation = 'full' | 'half' | 'none'

type AnyHook = (name: string, payload: unknown) => Array<{ owner: string; result: unknown }>
const askHook = (k: Kernel, name: string, payload: unknown): Array<{ owner: string; result: unknown }> => (k.hooks.run as unknown as AnyHook).call(k.hooks, name, payload)
const hookOwners = (k: Kernel, name: string): string[] => (k.hooks.owners as unknown as (n: string) => string[]).call(k.hooks, name)

/** 素材庫裡還能用的料；沒有人回答（沒裝 media）是 null。 */
export function libraryOf(k: Kernel, state: GameState): BroughtMaterial[] | null {
  if (hookOwners(k, 'media.materials').length === 0) return null
  return askHook(k, 'media.materials', { state })
    .flatMap((r) => (Array.isArray(r.result) ? (r.result as BroughtMaterial[]) : []))
    .filter((m) => isRecord(m) && typeof m.ref === 'string' && m.uses > 0)
}

export interface TopicLike {
  involves: { factions: string[]; people: string[]; types: string[] }
}

/** 這件料和議題的關係：拍到議題的勢力或人是全額；只有類型相同是減半；其餘無關。 */
export function relationOf(topic: TopicLike, m: BroughtMaterial): Relation {
  if (m.involves.factions.some((f) => topic.involves.factions.includes(f)) || m.involves.people.some((p) => topic.involves.people.includes(p))) return 'full'
  if (m.types.some((t) => topic.involves.types.includes(t))) return 'half'
  return 'none'
}

/** 假料：偽造的料（或用它剪的片）與抹黑的片（V33）。 */
export const isFake = (m: BroughtMaterial): boolean => m.forged || m.angle === 'smear'

export interface BringCard {
  /** 這件料變成的牌；null 是進不了牌庫 */
  card: WarCard | null
  relation: Relation
  why: string | null
}

const half = (n: number): number => Math.ceil(n / 2)

/** 一件料變成什麼牌（不改任何東西）。forgedOk：被動 forged_ok 有沒有。 */
export function cardOfMaterial(rules: OpinionRules, m: BroughtMaterial, relation: Relation, forgedOk: boolean): BringCard {
  const d = rules.deck
  const id = `bring:${m.ref}`
  if (m.card === null) return { card: null, relation, why: `「${m.title}」是日常的片，不能當牌，進不了牌庫。` }
  const decoy = (): BringCard => ({ card: { id, name: m.title, kind: 'means', means: 'shift', cost: 1 }, relation, why: null })
  // 娛樂與完全無關的：只能當轉移焦點的燃料（丟掉它，雙方聲量各 −2）
  if (m.card.kind === 'decoy' || relation === 'none') return decoy()
  const fake = isFake(m)
  if (fake && !forgedOk) return { card: null, relation, why: `「${m.title}」是假料：要有把假料放進牌庫的本事（例如主播的聚光燈）才帶得進去。` }
  if (m.card.kind === 'fuel') {
    let voice = Math.min(d.fuel_max, Math.max(1, Math.ceil(m.card.value / d.fuel_div)))
    if (relation === 'half') voice = Math.max(1, half(voice))
    const cost = voice >= d.fuel_two_at ? 2 : 1
    return { card: { id, name: m.title, kind: 'fuel', cost, voice: voice + (fake ? d.fake_plus : 0), ...(fake ? { fake: true } : {}) }, relation, why: null }
  }
  let wind = m.card.value >= d.line_two_at ? 2 : 1
  if (relation === 'half') wind = Math.max(1, half(wind))
  return { card: { id, name: m.title, kind: 'line', cost: wind, wind: wind + (fake ? d.fake_plus : 0), ...(fake ? { fake: true } : {}) }, relation, why: null }
}

export interface BringOption {
  ref: string
  title: string
  kind: 'footage' | 'clip'
  uses: number
  relation: Relation
  /** 進牌庫會是什麼牌（進不了是 null） */
  card: { kind: 'fuel' | 'line' | 'means'; name: string; cost: number; voice?: number; wind?: number; fake: boolean; decoy: boolean } | null
  can: boolean
  /** 不能進的原因（一句完整的話） */
  why: string | null
}

/**
 * 素材庫裡每一件進牌庫會是什麼牌、和議題的關係、不能進的原因。沒有 media（沒有人回答 media.materials）是空的。
 * desk：打算坐編輯台的人（forged_ok 要看他們的被動；沒給就是主角自己）。
 */
export function bringOptions(k: Kernel, state: GameState, topic: TopicLike, desk?: string[]): BringOption[] {
  const lib = libraryOf(k, state)
  if (!lib) return []
  const rules = opinionRules(k)
  const passives = askPassives(k, state, null, desk ?? (state.pc ? [state.pc] : [])).items
  const forgedOk = passiveMods(passives, 'forged_ok', null).length > 0
  return lib.map((m) => {
    const relation = relationOf(topic, m)
    const r = cardOfMaterial(rules, m, relation, forgedOk)
    const c = r.card
    return {
      ref: m.ref, title: m.title, kind: m.kind, uses: m.uses, relation, can: c !== null, why: r.why,
      card: c ? { kind: c.kind, name: c.name, cost: c.cost, ...(c.voice !== undefined ? { voice: c.voice } : {}), ...(c.wind !== undefined ? { wind: c.wind } : {}), fake: c.fake === true, decoy: c.kind === 'means' } : null,
    }
  })
}

export interface BringPlan {
  /** 每一件變成的牌 */
  cards: Array<{ ref: string; card: WarCard }>
  /** 併進報告的變更（每件扣 1 次） */
  changes: Change[]
}

/**
 * 開戰時照 bring 的清單把料變成牌、扣次數（media.spend，how 'deck'）。有一件不成立整份不成立（丟 ActionBlocked，原因是一句完整的話）：
 * 草稿是純函式，不成立就沒有任何變更，次數不變。
 */
export function planBring(k: Kernel, state: GameState, topic: TopicLike, refs: string[] | undefined, passives: OpPassive[]): BringPlan {
  const plan: BringPlan = { cards: [], changes: [] }
  if (!refs || refs.length === 0) return plan
  const rules = opinionRules(k)
  if (new Set(refs).size !== refs.length) throw new ActionBlocked('同一件料不能帶兩次。')
  if (refs.length > rules.bring_max) throw new ActionBlocked(`一場最多帶 ${rules.bring_max} 件料進牌庫。`)
  const lib = libraryOf(k, state)
  if (!lib) throw new ActionBlocked('現在沒有素材庫可以帶料。')
  const forgedOk = passiveMods(passives, 'forged_ok', null).length > 0
  for (const ref of refs) {
    const m = lib.find((x) => x.ref === ref)
    if (!m) throw new ActionBlocked(`素材庫裡沒有「${ref}」這件料，或它的使用次數已經用完了。`)
    const r = cardOfMaterial(rules, m, relationOf(topic, m), forgedOk)
    if (!r.card) throw new ActionBlocked(r.why ?? `「${m.title}」進不了牌庫。`)
    const sp = askHook(k, 'media.spend', { state, ref, how: 'deck' })[0]?.result as { changes: Change[] } | { block: string } | undefined
    if (!sp) throw new ActionBlocked('現在沒有素材庫可以帶料。')
    if ('block' in sp) throw new ActionBlocked(sp.block)
    plan.changes.push(...sp.changes)
    plan.cards.push({ ref, card: r.card })
  }
  return plan
}
