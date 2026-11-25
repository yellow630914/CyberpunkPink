// L6 功能 lewd 的資料與純函式：橋參數、傾向、規則。不碰登錄表（登錄在 index.ts）。
// 規格：LEWD_SYSTEM 第 1、1.1、5、9 節；CORE_RULES 4.2 節；DATA 第 8 節；dev/adr/0016 第三節、G10、G14；dev/work/M2-lewd.md。
// 分段、有效值、超過 100 的邊際遞減參考 ElondiaRPG 的 src/engine/lewd.ts（只參考做法）。

import type { Actor, ActorId, ContentEntry, GameState, Kernel } from '../../core'
import { clone, isRecord, toMinutes } from '../../core'

export const OWNER = 'lewd'

// ---- 橋參數 ----

/** 四項橋參數（LEWD_SYSTEM 第 1 節）：敏感度、耐受、慾求、馴化。鍵名核心與角色的功能已經在讀（sensitivity、tolerance），不能改。 */
export const BRIDGE_PARAMS = ['sensitivity', 'tolerance', 'craving', 'docility'] as const
export type BridgeParam = (typeof BRIDGE_PARAMS)[number]
export const PARAM_NAME: Record<BridgeParam, string> = { sensitivity: '敏感度', tolerance: '耐受', craving: '慾求', docility: '馴化' }
export const isParam = (v: unknown): v is BridgeParam => (BRIDGE_PARAMS as readonly unknown[]).includes(v)

/** actor.ext.bridge 的樣子（各 0～100）。沒有橋的人是 null。 */
export type BridgeRecord = Record<BridgeParam, number>

/** 衍生數值的 id：bridge_sensitivity 等。基礎是 ext.bridge 的值；義體、藥物、調校經 k.passives（或 k.stats.addStatProvider）加上去。有效值就是這個數字。 */
export const paramStatId = (p: BridgeParam): string => `bridge_${p}`
/** 橋參數有效值的上限（P14）：基本值 0～100，來源加上去最多到 200，來源合計不另外夾。 */
export const BRIDGE_EFFECTIVE_MAX = 200

export interface BridgeParamView {
  /** 存在 ext.bridge 裡的基本值（0～100） */
  base: number
  /** 有效值：衍生數值 bridge_<參數>（基本值加所有來源，夾在 0～200；P14）。畫面顯示與故事條件用這個 */
  value: number
  /** 效力：100 以內照算；超過 100 的部分邊際遞減（100 + over_scale × (1 − 100 ÷ 值)）。機制（承受層數、開戰感載）用這個 */
  power: number
  /** 所在的那一段（0 起算；每 band_size 點一段，100 以上都算最後一段） */
  band: number
  /** 這一段的範圍 */
  range: [number, number]
}
export type BridgeView = Record<BridgeParam, BridgeParamView>

// ---- 傾向 ----

/** 四條軸（LEWD_SYSTEM 1.1 節）。 */
export const AXES = ['relation', 'sense', 'body', 'costume'] as const
export type Axis = (typeof AXES)[number]
export const AXIS_NAME: Record<Axis, string> = { relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
export const isAxis = (v: unknown): v is Axis => (AXES as readonly unknown[]).includes(v)

/** 標籤的三種狀態（沒有就是沒有這一筆）：latent 潛在（本人還沒察覺）、has 有、deep 深。 */
export const TAG_STATES = ['latent', 'has', 'deep'] as const
export type TagState = (typeof TAG_STATES)[number]
export const isTagState = (v: unknown): v is TagState => (TAG_STATES as readonly unknown[]).includes(v)

/**
 * actor.ext.tendency。axes 是每條軸的等級（0～axis_max）；points 是這一級累積到哪了（到門檻升一級，升級後歸零；軸滿級之後不再累積；
 * 沒有這一欄當 0，是格式裡多出來的一欄）；tags 是每個標籤的狀態。
 */
export interface TendencyRecord {
  axes: Record<Axis, number>
  points: Record<Axis, number>
  tags: Record<string, TagState>
}

/** 內容種類 tendency_tag：標籤屬於哪一條軸。清單是內容。 */
export const TAG_KIND = 'tendency_tag'
export interface TagEntry extends ContentEntry { name: string; axis: Axis }

export function tagProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (typeof e.name !== 'string' || !e.name.trim()) p.push('name 要是一句話')
  if (!isAxis(e.axis)) p.push(`axis 要是 ${AXES.join('、')} 其中一個`)
  return p
}

// ---- 規則 ----

export const RULE_KIND = 'lewd_rule'
export interface LewdRules {
  /** 開新局主角沒有橋時，四項的預設值（M2-lewd 工單） */
  default_bridge: number
  /** 耐受每這麼多點，承受層數 +1（CORE_RULES 4.2 節：每 40 點） */
  tolerance_per_layer: number
  /** 慾求高於這一條，開戰就帶著感載（LEWD_SYSTEM 第 1 節：60） */
  craving_threshold: number
  /** 開戰的感載 =（慾求 − 門檻）÷ 這個數，最多到感載上限的一半（ADR G14：4） */
  craving_divisor: number
  /** 一段有幾點（ElondiaRPG：每 20 一段） */
  band_size: number
  /** 最後一段的上限是 100 ＋ 這個數字（預設 100，剛好蓋住有效值的 0～200）。來源合計不再夾在 ± 這個數字（P14：有效值由衍生數值的 0～200 夾） */
  gear_cap: number
  /** 超過 100 的邊際遞減係數（ElondiaRPG 的 over_scale） */
  over_scale: number
  /** 傾向的軸最高幾級 */
  axis_max: number
  /** 一條軸累積多少點升一級 */
  axis_threshold: number
  /** 豔名每這麼多點，帶 infiltrate 標籤的檢定 −penalty（ADR G10：25） */
  fame_step: number
  fame_penalty: number
}

export const DEFAULT_LEWD_RULES: LewdRules = {
  default_bridge: 30, tolerance_per_layer: 40, craving_threshold: 60, craving_divisor: 4,
  band_size: 20, gear_cap: 100, over_scale: 80, axis_max: 5, axis_threshold: 10, fame_step: 25, fame_penalty: 1,
}

const int = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const need: Array<[keyof LewdRules, number, string]> = [
    ['default_bridge', 0, '0～100 的整數'], ['tolerance_per_layer', 1, '1 以上的整數'], ['craving_threshold', 0, '0 以上的整數'], ['craving_divisor', 1, '1 以上的整數'],
    ['band_size', 1, '1 以上的整數'], ['gear_cap', 0, '0 以上的整數'], ['over_scale', 0, '0 以上的整數'], ['axis_max', 1, '1 以上的整數'],
    ['axis_threshold', 1, '1 以上的整數'], ['fame_step', 1, '1 以上的整數'], ['fame_penalty', 0, '0 以上的整數'],
  ]
  for (const [key, min, what] of need) if (e[key] !== undefined && !int(e[key], min)) p.push(`${key} 要是${what}`)
  if (int(e.default_bridge, 0) && e.default_bridge > 100) p.push('default_bridge 要是 0～100 的整數')
  return p
}

/** 現在生效的規則：資料 lewd_rule/default 蓋掉內建的預設。 */
export function lewdRules(k: Pick<Kernel, 'content'>): LewdRules {
  const e = k.content.get<ContentEntry & Partial<LewdRules>>(RULE_KIND, 'default')
  const out = { ...DEFAULT_LEWD_RULES }
  if (e) for (const key of Object.keys(out) as Array<keyof LewdRules>) if (int(e[key], 0)) out[key] = e[key] as number
  return out
}

// ---- 讀橋 ----

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** ext.bridge 讀成四項（各夾在 0～100）：不是物件（null、沒有這一欄）就是沒有橋；少的那一項補預設值。 */
export function readBridge(raw: unknown, rules: Pick<LewdRules, 'default_bridge'> = DEFAULT_LEWD_RULES): BridgeRecord | null {
  if (!isRecord(raw)) return null
  const out = {} as BridgeRecord
  for (const p of BRIDGE_PARAMS) {
    const v = raw[p]
    out[p] = typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), 0, 100) : rules.default_bridge
  }
  return out
}

/** 這個角色的橋（基本值）；角色不存在或沒有橋是 null。 */
export function baseBridge(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'actors'>, actor: ActorId): BridgeRecord | null {
  const a = state.actors[actor]
  return a ? readBridge(a.ext.bridge, lewdRules(k)) : null
}

/** 超過 100 的部分邊際遞減（ElondiaRPG 的 lewdPower）。 */
export function powerOf(value: number, overScale: number): number {
  return value <= 100 ? value : Math.round(100 + overScale * (1 - 100 / value))
}

/**
 * 四項橋參數的有效值、效力與所在的那一段（M2-lewd 的 bridgeOf）。沒有橋（或沒有這個角色）是 null。
 * 有效值直接讀衍生數值 bridge_<參數>（基本值加所有來源的合計，0～200；P14）；沒有人定義那個數值時（沒裝 lewd 的核心測試）用基本值。
 */
export function bridgeOf(k: Pick<Kernel, 'content' | 'stats'>, state: GameState, actor: ActorId): BridgeView | null {
  const base = baseBridge(k, state, actor)
  if (!base) return null
  const r = lewdRules(k)
  const out = {} as BridgeView
  for (const p of BRIDGE_PARAMS) {
    const id = paramStatId(p)
    const value = k.stats.hasStat(id) ? k.stats.stat(state, actor, id) : base[p]
    const last = Math.ceil(100 / r.band_size) - 1
    const band = Math.min(Math.floor(value / r.band_size), last)
    out[p] = { base: base[p], value, power: powerOf(value, r.over_scale), band, range: [band * r.band_size, band === last ? 100 + r.gear_cap : band * r.band_size + r.band_size - 1] }
  }
  return out
}

// ---- 讀傾向 ----

export function emptyTendency(): TendencyRecord {
  return { axes: { relation: 0, sense: 0, body: 0, costume: 0 }, points: { relation: 0, sense: 0, body: 0, costume: 0 }, tags: {} }
}

/** 讀 actor.ext.tendency：沒有、形狀不對的部分當成空的（回傳的是複製品）。 */
export function tendencyOf(state: Pick<GameState, 'actors'>, actor: ActorId, rules: Pick<LewdRules, 'axis_max'> = DEFAULT_LEWD_RULES): TendencyRecord {
  const out = emptyTendency()
  const raw = state.actors[actor]?.ext.tendency
  if (!isRecord(raw)) return out
  for (const ax of AXES) {
    const lv = isRecord(raw.axes) ? raw.axes[ax] : undefined
    if (typeof lv === 'number' && Number.isFinite(lv)) out.axes[ax] = clamp(Math.floor(lv), 0, rules.axis_max)
    const pt = isRecord(raw.points) ? raw.points[ax] : undefined
    if (typeof pt === 'number' && Number.isFinite(pt)) out.points[ax] = Math.max(0, Math.floor(pt))
  }
  if (isRecord(raw.tags)) for (const [tag, st] of Object.entries(raw.tags)) if (isTagState(st)) out.tags[tag] = st
  return out
}

/** 一個標籤現在的狀態：沒有這一筆是 null（沒有）。 */
export function tagStateOf(t: TendencyRecord, tag: string): TagState | null {
  return Object.hasOwn(t.tags, tag) ? t.tags[tag]! : null
}

/** 一個標籤「有」嗎：有或深都算（LEWD_SYSTEM 1.1 節：你有那個標籤的那一個）。 */
export const hasTag = (t: TendencyRecord, tag: string): boolean => {
  const s = tagStateOf(t, tag)
  return s === 'has' || s === 'deep'
}

export interface TendencyStep {
  next: TendencyRecord
  /** 這一筆做了什麼 */
  did: 'new' | 'reveal' | 'grow' | 'deep'
  /** 軸升到幾級（沒升級是 null） */
  levelUp: number | null
}

/**
 * 一筆 tendency 效果落下去之後的傾向（純函式）：
 *   沒有 → 有，那一軸累積一點；潛在 → 有，那一軸累積一點；有或深 → 那一軸累積一點。
 *   點數到門檻升一級（點數歸零），最多 axis_max 級；滿級之後不再累積。
 *   to: 'deep'：有 → 深，不累積。
 * 什麼都沒有改變時回傳 null（例：軸滿級的「有」、已經是深）。
 */
export function stepTendency(t: TendencyRecord, tag: string, axis: Axis, rules: Pick<LewdRules, 'axis_max' | 'axis_threshold'>, to?: 'deep'): TendencyStep | null {
  const next = clone(t)
  if (to === 'deep') {
    if (tagStateOf(t, tag) !== 'has') return null
    next.tags[tag] = 'deep'
    return { next, did: 'deep', levelUp: null }
  }
  const was = tagStateOf(t, tag)
  const did: TendencyStep['did'] = was === null ? 'new' : was === 'latent' ? 'reveal' : 'grow'
  if (was === null || was === 'latent') next.tags[tag] = 'has'
  let levelUp: number | null = null
  if (next.axes[axis] < rules.axis_max) {
    next.points[axis] += 1
    if (next.points[axis] >= rules.axis_threshold) {
      next.axes[axis] += 1
      next.points[axis] = 0
      levelUp = next.axes[axis]
    }
  }
  if (did === 'grow' && levelUp === null && next.points[axis] === t.points[axis]) return null
  return { next, did, levelUp }
}

/** 建角時直接寫一個標籤的狀態（has 或 latent）：不累積那一軸的點數、不升級（CHARACTER 5.5 節：只有 axis 寫了才加級）。 */
export function stepTendencyFree(t: TendencyRecord, tag: string, state: Extract<TagState, 'has' | 'latent'>): TendencyRecord {
  const next = clone(t)
  next.tags[tag] = state
  return next
}

// ---- 狀況 ----

/** 這個角色身上有沒有這個暫時的狀態（到期的不算；沒寫 until 的不會自己消退）。 */
export function hasCondition(state: GameState, actor: Actor | undefined, id: string): boolean {
  const now = toMinutes(state.time)
  return !!actor && actor.conditions.some((c) => c.id === id && (c.until === undefined || c.until > now))
}

/** 共用的狀況 id：戴著人格面具（M2-abilities-m2 掛在人身上，這裡只讀）。 */
export const MASKED = 'masked'
/** 帶這個標籤的檢定會被「認出來」的懲罰影響（ADR G10）。 */
export const INFILTRATE_TAG = 'infiltrate'
