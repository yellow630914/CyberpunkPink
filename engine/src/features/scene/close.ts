// L6 功能 scene 的結算補齊（M4-scene-close；LEWD_SYSTEM 3.4 節、CORE_RULES 4.3 節「親密關係怎麼影響沉溺」、AI_TASKS 3.7、3.8 節與 4.2 節；dev/adr/0019 P43、P44）。
// 這裡只有純函式：驗外殼放進 env.closing 的 AI 收尾結果、算沉溺（AI 關著的退路）、橋參數那一點落在哪一項、傾向與「難忘」變深、關係的數字。
// 不呼叫 AI、不寫變更：回傳要落的效果清單與一串提醒（ClampNote），由 end.ts 落地。夾住或丟掉的每一處都留一筆提醒，外殼的任務鏈列看得到。

import type { ActorId, ClampNote, Kernel } from '../../core'
import { contentAllowed, isRecord, meterOf } from '../../core'
import type { Nature, RatingBand, SceneRules } from './model'
import { NATURE_NAME, NOTE_LEN, gearIndexOf, isNature } from './model'
import type { Play } from './play'

export type Fx = Record<string, unknown>

/** 沉溺那一份的種類（AI_TASKS 4.2 節 sink：錨、交易、被迫、其他）。 */
export const SINK_KINDS = ['anchor', 'trade', 'forced', 'other'] as const
export type SinkKind = (typeof SINK_KINDS)[number]
export const SINK_KIND_NAME: Record<SinkKind, string> = { anchor: '兩個人之間真的東西', trade: '交易', forced: '被迫', other: '其他' }
const isSinkKind = (v: unknown): v is SinkKind => (SINK_KINDS as readonly unknown[]).includes(v)

/**
 * 外殼放進 env.closing 的 AI 收尾結果（AI_TASKS 3.7、3.8 節的 sex_record、sink、tendency 三個任務，加上關係的數字）。
 * 程式驗過才用：格式不合、不在場的人、不是這一場碰到的標籤都丟掉並留提醒；數字再夾在規則的範圍內。
 */
export interface Closing {
  sink?: { kind: SinkKind; amount: number }
  tendency?: string[]
  sex_record?: Array<{ with: string; note?: string; kind?: string }>
  relate?: Record<ActorId, number>
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const clampNote = (path: string, from: unknown, to: unknown, notice: string, limit?: unknown): ClampNote => ({ path, from, to, ...(limit !== undefined ? { limit } : {}), notice })

/** 驗 env.closing：回傳收得下的部分。notes 收每一處被丟掉或改掉的提醒。 */
export function readClosing(raw: unknown, nature: Nature, present: readonly ActorId[], notes: ClampNote[]): Closing {
  if (!isRecord(raw)) return {}
  const out: Closing = {}
  if (raw.sink !== undefined) {
    const s = raw.sink
    if (!isRecord(s) || !isSinkKind(s.kind) || !finite(s.amount)) notes.push(clampNote('closing.sink', s, null, '收尾給的沉溺格式不合（要有種類與一個數字），沒有收，沉溺照規則算。'))
    else if (s.kind === 'forced' && nature !== 'forced') notes.push(clampNote('closing.sink', s.kind, 'other', '這一場不是被迫的，所以「被迫」這一筆沒有收，沉溺照規則算。'))
    else out.sink = { kind: s.kind, amount: Math.round(s.amount) }
  }
  if (raw.tendency !== undefined) {
    if (!Array.isArray(raw.tendency)) notes.push(clampNote('closing.tendency', raw.tendency, null, '收尾給的傾向標籤格式不合（要是一串標籤），沒有收，傾向照這一場碰到的記。'))
    else out.tendency = raw.tendency.filter((x): x is string => typeof x === 'string')
  }
  if (raw.sex_record !== undefined) {
    if (!Array.isArray(raw.sex_record)) notes.push(clampNote('closing.sex_record', raw.sex_record, null, '收尾給的性經歷格式不合（要是一串紀錄），沒有收。'))
    else {
      const rows: NonNullable<Closing['sex_record']> = []
      raw.sex_record.forEach((r, i) => {
        if (!isRecord(r) || typeof r.with !== 'string') return void notes.push(clampNote(`closing.sex_record[${i}]`, r, null, '這一筆性經歷沒有寫是和誰，沒有收。'))
        if (!present.includes(r.with)) return void notes.push(clampNote(`closing.sex_record[${i}]`, r.with, null, '這一筆性經歷寫的人不在這一場裡，沒有收。'))
        rows.push({ with: r.with, ...(typeof r.note === 'string' ? { note: r.note } : {}), ...(typeof r.kind === 'string' ? { kind: r.kind } : {}) })
      })
      out.sex_record = rows
    }
  }
  if (raw.relate !== undefined) {
    if (!isRecord(raw.relate)) notes.push(clampNote('closing.relate', raw.relate, null, '收尾給的關係變化格式不合，沒有收，關係照評價算。'))
    else out.relate = Object.fromEntries(Object.entries(raw.relate).filter(([, v]) => finite(v)).map(([id, v]) => [id, Math.round(v as number)]))
  }
  return out
}

// ---- 沉溺 ----

export interface SinkPlan {
  kind: SinkKind
  /** 規則（或 AI）給的那一份 */
  base: number
  /** 全檔過載累積的那一份（已夾在每場的上限內） */
  gain: number
  /** 合計，夾在 −4～+4 之後的 */
  total: number
}

/**
 * 主角這一場的沉溺（P43）。有 closing.sink 用它的數字（被迫要性質是被迫才收，readClosing 已經看過）；沒有就照退路：
 * 兩情相悅而且主角對（平均的）對象親密度到 anchor_affinity 以上 → anchor；交易、工作、契約 → 0；被迫 → forced；俘虜與其餘 → 0；單人 → 0。
 * 再加上全檔過載累積的那一份，合計夾在 −sink_cap～+sink_cap（規則表 sink_cap，預設 4）。
 */
export function planSink(k: Kernel, p: Play, pairIds: readonly ActorId[], closing: Closing, notes: ClampNote[]): SinkPlan {
  const { nature } = p.s
  const rules = p.rules
  let kind: SinkKind
  let base: number
  if (closing.sink) {
    kind = closing.sink.kind
    base = closing.sink.amount
  } else if (p.solo) {
    kind = 'other'
    base = 0
  } else if (nature === 'forced') {
    kind = 'forced'
    base = rules.sink.forced
  } else if (nature === 'trade' || nature === 'work') {
    kind = 'trade'
    base = 0
  } else if (nature === 'mutual' && pairIds.length > 0 && pairIds.reduce((a, id) => a + meterOf(k, p.state, 'affinity', id), 0) / pairIds.length >= rules.sink.anchor_affinity) {
    kind = 'anchor'
    base = rules.sink.anchor
  } else {
    kind = 'other'
    base = 0
  }
  const seat = p.s.seats.find((x) => x.id === p.s.pc)
  const cap = rules.sink_cap
  const gain = Math.min(cap, seat?.sink_gain ?? 0)
  const sum = base + gain
  const total = Math.max(-cap, Math.min(cap, sum))
  if (total !== sum) notes.push(clampNote('closing.sink', sum, total, `一場最多讓沉溺動 ${cap} 點，這一場實際只算了 ${Math.abs(total)} 點。`, total > 0 ? cap : -cap))
  return { kind, base, gain, total }
}

// ---- 橋參數 ----

export type BridgeParam = 'sensitivity' | 'tolerance' | 'craving' | 'docility'

/**
 * 橋參數那一點落在哪一項（P44；前面的條件優先）：這一場主角開過深檔以上 → 敏感度；主角高潮兩次以上 → 耐受；
 * 性質是工作或契約而且主角迎合的次數比主導多 → 馴化；其餘 → 慾求。
 */
export function bridgeParamOf(p: Play): BridgeParam {
  const seat = p.s.seats.find((x) => x.id === p.s.pc)
  if (!seat) return 'craving'
  if (gearIndexOf(seat.max_gear) >= gearIndexOf('deep')) return 'sensitivity'
  if (seat.climax >= 2) return 'tolerance'
  if ((p.s.nature === 'work' || p.s.nature === 'contract') && (seat.yield_used ?? 0) > (seat.dom_used ?? 0)) return 'docility'
  return 'craving'
}

// ---- 傾向與「難忘」 ----

export interface TendencyPlan {
  /** 這一場收下的標籤（篩過、照軸限額） */
  tags: string[]
  /** 篩過、限額之前的（難忘從這裡挑） */
  pool: string[]
}

const TAG_KIND = 'tendency_tag'

/**
 * 傾向：這一場碰到的標籤（touched）→ 內容篩選關掉的丟、資料裡查不到的丟 → 有 closing.tendency 就只收是它子集的（沒碰到的丟並留提醒）
 * → 每條軸最多收 tendency_per_axis 個（照碰到的順序）。
 */
export function planTendency(k: Kernel, p: Play, touched: readonly string[], closing: Closing, notes: ClampNote[]): TendencyPlan {
  const rules: SceneRules = p.rules
  const known = (t: string): boolean => k.content.get(TAG_KIND, t) !== undefined
  let pool = touched.filter((t) => contentAllowed(p.state.rules, t) && known(t))
  if (closing.tendency) {
    const given = [...new Set(closing.tendency)]
    for (const t of given) {
      if (!touched.includes(t)) notes.push(clampNote('closing.tendency', t, null, `「${p.tagName(t)}」不是這一場碰到的，沒有記進傾向。`))
      else if (!contentAllowed(p.state.rules, t)) notes.push(clampNote('closing.tendency', t, null, `「${p.tagName(t)}」這個題材被內容篩選關掉了，沒有記進傾向。`))
    }
    pool = pool.filter((t) => given.includes(t))
  }
  const per = new Map<string, number>()
  const tags: string[] = []
  for (const t of pool) {
    const axis = String(k.content.get(TAG_KIND, t)?.axis ?? '')
    const n = per.get(axis) ?? 0
    if (n >= rules.tendency_per_axis) continue
    per.set(axis, n + 1)
    tags.push(t)
  }
  return { tags, pool }
}

/** 主角現在對這個標籤是「有」（還不是深；DATA 第 8 節 tendency.tags 的格式）。 */
export function tagIsHas(p: Play, tag: string): boolean {
  const a = p.state.actors[p.s.pc]
  const t = a && isRecord(a.ext.tendency) && isRecord(a.ext.tendency.tags) ? a.ext.tendency.tags[tag] : undefined
  return t === 'has'
}

export interface Growth {
  /** 傾向的效果（一般的累積，接著可能多一筆變深的） */
  tendency: Fx[]
  /** 橋參數的效果（沒中是空的） */
  bridge: Fx[]
  bridge_gain?: BridgeParam
  deep?: string
  tags: string[]
}

/**
 * 這一場主角的成長：橋參數那一點（機率照評價表、略過不給）、傾向、最高一級評價時「有」變成「深」。
 * 亂數的順序：橋參數的機率 → 難忘的機率 → 挑哪一個標籤（只有一個候選時不擲）。
 */
export function planGrowth(k: Kernel, p: Play, o: { band: RatingBand; skip: boolean; touched: readonly string[]; closing: Closing; notes: ClampNote[] }): Growth {
  const { band, skip, closing, notes } = o
  const tp = planTendency(k, p, o.touched, closing, notes)
  const out: Growth = { tendency: tp.tags.map((tag) => ({ kind: 'tendency', tag })), bridge: [], tags: tp.tags }
  if (skip) return out
  if (band.bridge > 0 && p.dice.int(1, 100) <= Math.round(band.bridge * 100)) {
    const param = bridgeParamOf(p)
    out.bridge.push({ kind: 'bridge', param, amount: 1 })
    out.bridge_gain = param
  }
  // 難忘：最高一級的評價，碰到的標籤裡主角已經是「有」的，照機率挑一個變成「深」；一場最多一個
  if (band === p.rules.bands[0]) {
    const cand = tp.pool.filter((t) => tagIsHas(p, t))
    if (cand.length > 0 && p.dice.int(1, 100) <= Math.round(p.rules.deep_chance * 100)) {
      const tag = cand.length === 1 ? cand[0]! : cand[p.dice.int(0, cand.length - 1)]!
      out.tendency.push({ kind: 'tendency', tag, to: 'deep' })
      out.deep = tag
    }
  }
  return out
}

// ---- 關係 ----

/**
 * 主角對一個對象這一場的親密度變化：沒有 closing.relate 或沒給這個人，照那一級評價的固定值；有就用它的數字、夾在那一級的 relate_range 裡。
 * 那一級評價在 relate_range 裡查不到範圍（評價表被資料換掉）時照固定值。
 */
export function relateAmount(p: Play, band: RatingBand, id: ActorId, closing: Closing, notes: ClampNote[]): number {
  const given = closing.relate?.[id]
  const range = p.rules.relate_range[band.id]
  if (given === undefined || !range) return band.affinity
  const to = Math.max(range[0], Math.min(range[1], given))
  if (to !== given) notes.push(clampNote(`closing.relate.${id}`, given, to, `這一場和${p.name(id)}的關係變化，在「${band.name}」這一級只能是 ${range[0]}～${range[1]}，實際算了 ${to}。`, range))
  return to
}

/** closing.relate 裡不是這一場對象的人：丟掉並留提醒。 */
export function relateStrays(pairIds: readonly ActorId[], closing: Closing, notes: ClampNote[]): void {
  for (const id of Object.keys(closing.relate ?? {})) if (!pairIds.includes(id)) notes.push(clampNote(`closing.relate.${id}`, closing.relate![id], null, '這個人不是這一場的對象，他的關係變化沒有算。'))
}

// ---- 性經歷的一句話 ----

/**
 * closing.sex_record 的一句話：對象 id → 一句（只收在場的人，readClosing 已經濾過；太長的截短並留提醒；同一個人給兩次取後面的）。
 * 紀錄的「類型」以場景的性質為準（程式照場景紀錄寫），寫得不一樣的留提醒。
 */
export function sexNotes(p: Play, closing: Closing, notes: ClampNote[]): Record<ActorId, string> {
  const nature = p.s.nature
  const out: Record<ActorId, string> = {}
  for (const r of closing.sex_record ?? []) {
    if (r.kind !== undefined && r.kind !== nature) {
      notes.push(clampNote('closing.sex_record', r.kind, nature, isNature(r.kind) ? `這一場的性質是${NATURE_NAME[nature]}，性經歷的類型照場景記，不照收尾給的「${NATURE_NAME[r.kind]}」。` : '性經歷的類型不在清單裡，照這一場的性質記。'))
    }
    const text = (r.note ?? '').trim()
    if (text === '') continue
    if (text.length > NOTE_LEN) notes.push(clampNote(`closing.sex_record.${r.with}`, text.length, NOTE_LEN, `給${p.name(r.with)}的那一句話太長，只留了前 ${NOTE_LEN} 字。`, NOTE_LEN))
    out[r.with] = text.slice(0, NOTE_LEN)
  }
  return out
}
