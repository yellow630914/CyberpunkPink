// L4 規則核心：內容篩選與「照主角的性別分版本」。戰敗事件、成人事件、NTR 線與其他分版本的內容都照同一條規則
//（ENEMIES 第 6 節；DATA 第 1、5 節；LEWD_SYSTEM 第 9 節），所以放在核心，功能只管自己的內容。
//
// - 內容篩選：玩家關掉的標籤（存檔規則的 contentOff），帶著它的內容不出現，改走 fallback 指的那個不含它的版本。
//   沒有成人內容的總開關；所有角色皆為成年人這一條不能關（那是格式的底線，在提交與讀檔時擋）。
// - 版本：default 一般的寫法、masc 男性處於被動、yuri 主角被動由女性主導。男只走 masc；女七成 default、三成 yuri；
//   偽娘、TS、扶他三個都會抽到，預設各三分之一。設定可以手動指定版本、調比例。

import type { GenderId, SaveRules } from '../types'

/** 內容篩選的標籤（DATA 第 1 節的 tags；LEWD_SYSTEM 第 9 節「可關閉的細項」）。流竄 AI 的題材各有自己的標籤，由內容載入時加。 */
export const CONTENT_TAGS = [
  'pc_unwilling', 'target_unwilling', 'contract_dom', 'ntr', 'puppet_amnesia', 'blacktape', 'intimate_body',
  'male_partner', 'female_partner', 'femboy_partner', 'trans_partner', 'futa_partner',
] as const
export type ContentTag = (typeof CONTENT_TAGS)[number]

export const VERSIONS = ['default', 'masc', 'yuri'] as const
export type VersionId = (typeof VERSIONS)[number]

/** 每一種性別抽到各版本的比重（ENEMIES 第 6 節）。 */
export const VERSION_WEIGHTS: Record<GenderId, Record<VersionId, number>> = {
  male: { default: 0, masc: 1, yuri: 0 },
  female: { default: 7, masc: 0, yuri: 3 },
  femboy: { default: 1, masc: 1, yuri: 1 },
  trans_f: { default: 1, masc: 1, yuri: 1 },
  futa: { default: 1, masc: 1, yuri: 1 },
}

/** 這些標籤的內容現在都開著嗎（沒有一個被玩家關掉）。 */
export function tagsAllowed(rules: Pick<SaveRules, 'contentOff'>, tags: readonly string[] | undefined): boolean {
  return !(tags ?? []).some((t) => rules.contentOff.includes(t))
}

export interface VersionOpts {
  /** 這一筆內容實際寫了哪幾個版本；沒寫的不會被抽到 */
  available?: readonly VersionId[]
  /** 贏的那一方（或對方）有沒有女性；沒有的話 yuri 不成立，走 default */
  hasWomen?: boolean
  /** 玩家在設定裡手動指定的版本 */
  forced?: VersionId
  /** 玩家調過的比重，蓋掉預設 */
  weights?: Partial<Record<VersionId, number>>
}

/**
 * 照主角的性別選版本。roll 是 0～1 的亂數（呼叫的人用導出的骰子給：同一個狀態選到同一個版本）。
 * 抽到的版本沒有寫、或 yuri 不成立時退回 default；連 default 都沒有就用寫了的第一個。
 */
export function pickVersion(gender: string | undefined, roll: number, o: VersionOpts = {}): VersionId {
  const available = o.available?.length ? o.available : VERSIONS
  const usable = (v: VersionId) => available.includes(v) && !(v === 'yuri' && o.hasWomen === false)
  const fallback: VersionId = usable('default') ? 'default' : (available.find(usable) ?? available[0]!)
  if (o.forced) return usable(o.forced) ? o.forced : fallback
  const base = VERSION_WEIGHTS[(gender ?? 'female') as GenderId] ?? VERSION_WEIGHTS.female
  const weights = VERSIONS.map((v) => Math.max(0, o.weights?.[v] ?? base[v]))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return fallback
  let r = Math.min(Math.max(roll, 0), 0.999999) * total
  for (let i = 0; i < VERSIONS.length; i++) {
    r -= weights[i]!
    if (r < 0) return usable(VERSIONS[i]!) ? VERSIONS[i]! : fallback
  }
  return fallback
}

/**
 * 內容篩選的分支：這一筆用到的標籤被關掉時，沿著 fallback 找到第一個每個標籤都開著的版本。
 * 找不到（或繞圈）回傳 undefined：這一筆內容不出現。
 */
export function resolveFiltered<T extends { id: string; tags?: string[]; fallback?: string }>(rules: Pick<SaveRules, 'contentOff'>, entry: T | undefined, get: (id: string) => T | undefined): T | undefined {
  const seen = new Set<string>()
  let cur = entry
  while (cur && !seen.has(cur.id)) {
    if (tagsAllowed(rules, cur.tags)) return cur
    seen.add(cur.id)
    cur = cur.fallback ? get(cur.fallback) : undefined
  }
  return undefined
}
