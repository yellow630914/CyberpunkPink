// L6 功能 favors 的資料與純函式：狀態的形狀、查詢、用掉、被討、規則。不碰登錄表（登錄在 index.ts）。
// 規格：FIXER 第 8 節；EVENTS 2.4 節的 owed、owed_to_pc；TRADE 4.4 節（人情作價，只記數字）；dev/adr/0015 E2（戰鬥裡的人情池從這裡來）。

import type { Change, ContentEntry, GameState, GameTime, Kernel, ReportDraft, RulesKernel } from '../../core'
import { ActionBlocked, clone, effectCtx, isRecord, isSafeInt } from '../../core'

export const OWNER = 'favors'
export const EXT = 'favors'

export const SIZES = ['small', 'mid', 'big'] as const
export type FavorSize = (typeof SIZES)[number]
export const SIZE_NAME: Record<FavorSize, string> = { small: '小', mid: '中', big: '大' }

/** 兩個方向，鍵名就是狀態裡的鍵：owed_to_pc 是別人欠主角的、owed_by_pc 是主角欠別人的。 */
export const DIRS = ['owed_to_pc', 'owed_by_pc'] as const
export type FavorDir = (typeof DIRS)[number]

export interface Favor {
  id: string
  /** 人或勢力的 id */
  who: string
  size: FavorSize
  /** 什麼時候記下的 */
  at: GameTime
  note?: string
}

export interface FavorsState {
  owed_to_pc: Favor[]
  owed_by_pc: Favor[]
  /** 流水號：用掉的 id 不會被新的一筆重複用（被討的請託、報告都用 id 指一筆） */
  seq: number
}

export const isSize = (v: unknown): v is FavorSize => (SIZES as readonly unknown[]).includes(v)
export const isDir = (v: unknown): v is FavorDir => (DIRS as readonly unknown[]).includes(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const isFavor = (v: unknown): v is Favor => isRecord(v) && isText(v.id) && isText(v.who) && isSize(v.size) && isRecord(v.at)

/** 讀 state.ext.favors：沒有、或形狀不對的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function favorsOf(state: Pick<GameState, 'ext'>): FavorsState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const list = (v: unknown): Favor[] => (Array.isArray(v) ? v.filter(isFavor).map((f) => clone(f)) : [])
  return { owed_to_pc: list(r.owed_to_pc), owed_by_pc: list(r.owed_by_pc), seq: isSafeInt(r.seq) && r.seq >= 0 ? r.seq : 0 }
}

/** 主角名下某個方向的一種大小有幾筆。 */
export function favorCount(state: GameState, size: FavorSize, dir: FavorDir = 'owed_to_pc'): number {
  if (!state.pc) return 0
  return favorsOf(state)[dir].filter((f) => f.size === size).length
}

/** 人或勢力的名字（給玩家看的句子用）：勢力用短名，查不到就用 id。 */
export function nameOf(k: Pick<Kernel, 'content'>, state: GameState, who: string): string {
  const f = k.content.get('faction', who)
  if (f) return String(f.short ?? f.name ?? who)
  const n = k.content.get('npc', who)
  if (n) return String(n.name ?? who)
  return state.actors[who]?.name ?? who
}

/** 一個 who 合不合格：查得到的人（內容或狀態裡的非主角角色）或勢力，或 `$a` 這類登場角色的代號。 */
export const isCastRef = (who: string): boolean => /^\$[A-Za-z][A-Za-z0-9_]*$/.test(who)
export function whoProblem(content: Pick<Kernel, 'content'>['content'], state: Pick<GameState, 'actors'>, who: unknown): string | null {
  if (!isText(who)) return 'who 要是人或勢力的 id（字串）'
  if (isCastRef(who)) return null
  if (content.get('npc', who) || content.get('faction', who)) return null
  if (state.actors[who] && state.actors[who]!.role !== 'pc') return null
  return `who：${who} 不是查得到的人或勢力（要是 npc、faction 的 id，或 $a 這類登場角色的代號）`
}

// ---- 規則（TRADE 4.4：人情作價；FIXER 第 8 節：拒絕被討信譽大跌）----

export const FAVOR_RULE_KIND = 'favor_rule'
export interface FavorRules {
  /** 作價（現金）：大的不作價，所以沒有 big */
  price: { small: number; mid: number }
  /** 拒絕被討時的信譽變化 */
  refuse_rep: number
}
export const DEFAULT_FAVOR_RULES: FavorRules = { price: { small: 300, mid: 1500 }, refuse_rep: -3 }

export function favorRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.price !== undefined) {
    if (!isRecord(e.price)) p.push('price 要是 { small, mid }（大的不作價）')
    else {
      for (const key of Object.keys(e.price)) if (key !== 'small' && key !== 'mid') p.push(`price.${key}：人情只有小與中作價，大的不作價`)
      for (const key of ['small', 'mid'] as const) if (e.price[key] !== undefined && !(isSafeInt(e.price[key]) && e.price[key]! >= 0)) p.push(`price.${key} 要是 0 以上的整數`)
    }
  }
  if (e.refuse_rep !== undefined && !(isSafeInt(e.refuse_rep) && e.refuse_rep <= 0)) p.push('refuse_rep 要是 0 或負的整數（拒絕被討的信譽變化）')
  return p
}

/** 現在生效的規則：資料 favor_rule/default 蓋掉內建的預設。 */
export function favorRules(k: Pick<Kernel, 'content'>): FavorRules {
  const e = k.content.get<ContentEntry & Partial<FavorRules>>(FAVOR_RULE_KIND, 'default')
  return {
    price: { small: e?.price?.small ?? DEFAULT_FAVOR_RULES.price.small, mid: e?.price?.mid ?? DEFAULT_FAVOR_RULES.price.mid },
    refuse_rep: e?.refuse_rep ?? DEFAULT_FAVOR_RULES.refuse_rep,
  }
}

/** 一個人情作價多少現金；大的不作價，回傳 null。 */
export function favorPrice(k: Pick<Kernel, 'content'>, size: FavorSize): number | null {
  return size === 'big' ? null : favorRules(k).price[size]
}

// ---- 用掉 ----

/** 一個大小的請求，可以用哪幾種大小的人情頂：自己的，再往上一級（中的可以當小的用、大的可以當中的用）。 */
export const usableFor = (size: FavorSize): FavorSize[] => (size === 'small' ? ['small', 'mid'] : size === 'mid' ? ['mid', 'big'] : ['big'])

export interface SpendQuery {
  /** 指定哪一筆（優先） */
  id?: string
  /** 這個對象欠的；沒給就是不限對象 */
  who?: string
  /** 要用在多大的事上 */
  size?: FavorSize
}

/** 找出要用掉的那一筆：先看同樣大小的、再看往上一級的；同一級裡最早記下的先用。找不到給原因（完整的句子）。 */
function pick(k: Pick<Kernel, 'content'>, state: GameState, q: SpendQuery): { favor: Favor; asSize?: FavorSize } | { block: string } {
  if (!state.pc) return { block: '還沒有主角。' }
  const list = favorsOf(state).owed_to_pc
  if (q.id !== undefined) {
    const f = list.find((x) => x.id === q.id)
    return f ? { favor: f } : { block: '沒有這一筆人情（可能已經用掉了）。' }
  }
  if (!q.size) return { block: '要說用在多大的事上（小、中、大）。' }
  const mine = q.who === undefined ? list : list.filter((f) => f.who === q.who)
  for (const s of usableFor(q.size)) {
    const f = mine.find((x) => x.size === s)
    if (f) return { favor: f, ...(s !== q.size ? { asSize: q.size } : {}) }
  }
  const sizeName = SIZE_NAME[q.size]
  if (q.who === undefined) return { block: `沒有人欠你可以當${sizeName}人情用的人情。` }
  const who = nameOf(k, state, q.who)
  return mine.length === 0
    ? { block: `${who}沒有欠你人情。` }
    : { block: `${who}欠你的人情是${[...new Set(mine.map((f) => SIZE_NAME[f.size]))].join('、')}的，頂不了一個${sizeName}人情。` }
}

/** 現在能不能用掉一個欠你的人情；不能就回傳原因（完整的句子），能就回傳 null。 */
export function spendBlock(k: Pick<Kernel, 'content'>, state: GameState, q: SpendQuery): string | null {
  const r = pick(k, state, q)
  return 'block' in r ? r.block : null
}

/**
 * 用掉一個欠你的人情（報告 favor.use）。大的可以當中的、中的可以當小的用，用掉的是那一筆整個。
 * 找不到丟 ActionBlocked（訊息是原因）。誰要用它做什麼（請人、買情報、殺價）是用的那個功能的事：它把這份報告的變更併進自己的。
 */
export function spend(k: Pick<Kernel, 'content'>, state: GameState, q: SpendQuery): ReportDraft {
  const r = pick(k, state, q)
  if ('block' in r) throw new ActionBlocked(r.block)
  const f = r.favor
  const who = nameOf(k, state, f.who)
  const line = `用掉：${who}欠你的一個${SIZE_NAME[f.size]}人情${r.asSize ? `（當${SIZE_NAME[r.asSize]}的用，整筆用掉）` : ''}`
  return {
    kind: 'social', action: 'favor.use', ...(state.pc ? { actor: state.pc } : {}), location: clone(state.location), party: [], timeline: [],
    changes: [{ op: 'favor.spend', dir: 'owed_to_pc', id: f.id }],
    outcome: { result: 'spent', summary: `你用掉了${who}欠你的一個${SIZE_NAME[f.size]}人情。` },
    narration: { results: [line] },
  }
}

// ---- 被討 ----

/**
 * 主角欠人的那一筆被討了（報告 favor.called）：答應（do）就清掉——要做的那件事是事件的資料，不在這裡；
 * 拒絕（refuse）那一筆留著，並給一個 rep 的效果（refuse_rep，預設 −3；沒有人定義 rep 時略過）。
 */
export function call(k: RulesKernel, state: GameState, id: string, answer: 'do' | 'refuse'): ReportDraft {
  if (!state.pc) throw new ActionBlocked('還沒有主角。')
  const f = favorsOf(state).owed_by_pc.find((x) => x.id === id)
  if (!f) throw new ActionBlocked('你沒有欠這一筆人情（可能已經還掉了）。')
  if (answer !== 'do' && answer !== 'refuse') throw new Error(`被討的回答只能是 do 或 refuse（拿到 ${String(answer)}）`)
  const who = nameOf(k, state, f.who)
  const base = { kind: 'social' as const, action: 'favor.called', actor: state.pc, location: clone(state.location), party: [], timeline: [] }
  if (answer === 'do') {
    return { ...base, changes: [{ op: 'favor.spend', dir: 'owed_by_pc', id }], outcome: { result: 'do', summary: `你答應了${who}的請託，這一筆人情清掉了。` }, narration: { results: [`還清：你欠${who}的一個${SIZE_NAME[f.size]}人情`] } }
  }
  const changes: Change[] = []
  const lines: string[] = []
  if (k.effects.has('rep')) {
    const res = k.effects.resolve([{ kind: 'rep', amount: favorRules(k).refuse_rep }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length) throw new Error(`拒絕被討的信譽效果有問題：${res.errors.join('；')}`)
    changes.push(...res.changes)
    lines.push(...res.lines)
  }
  return { ...base, changes, outcome: { result: 'refuse', summary: `你回絕了${who}。這一筆人情還欠著。` }, narration: { results: lines } }
}
