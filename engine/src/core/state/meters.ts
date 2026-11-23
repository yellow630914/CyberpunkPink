// L3 狀態核心：量表（dev/adr/0016 第三節；工單 M2-core-meters）。
//
// 量表是「一個有範圍的數字，照對象分開記，事件可以加減、條件可以看」：敵對值、好感、親密度、忠誠、豔名、街頭信譽、警戒都是。
// 核心自己不定義任何一種：由管那一塊的功能 `k.meters.define(...)`（類似 content.defineKind）。
//
//   state.meters[種類][鍵]            只記寫過的鍵；沒寫過的讀出來是定義的 start（meterOf）
//   { op: 'meter', kind, key, delta } 加減；套用時夾在 min～max（有 floor 時不低於那張量表同一個鍵的值）
//   { op: 'meter', kind, key, set }   直接設；一樣夾
//
// 定義一種量表，同名的效果與條件由 L4（core/rules/meters.ts）自動註冊：這一層只管登錄表、鍵怎麼定、夾值與變更。
// 規矩（dev/invariants.md 第 94、95 條）：量表只經由 meter 變更（與同名的效果）改；功能讀別人的數字只經由 meterOf。

import type { GameState } from '../types'
import type { ContentRegistry } from '../content/registry'
import { isId, isRecord, isSafeInt } from '../util/sanitize'
import type { Probe } from './probe'

/** 量表照什麼記：勢力、人、區、地圖的實例，或不分對象（鍵固定是 `_`）。 */
export const METER_KEYEDS = ['faction', 'npc', 'district', 'map', 'none'] as const
export type MeterKeyed = (typeof METER_KEYEDS)[number]
/** 不分對象的量表（keyed: 'none'）的鍵。 */
export const METER_NONE_KEY = '_'

export interface MeterDef {
  /** 種類：也是同名的效果與條件的名字（id 的格式） */
  kind: string
  /** 誰定義的（功能 id） */
  owner: string
  /** 給玩家看的名字：夾值的提醒、報告卡與結果的白話用它，不出現 kind */
  name: string
  /** 範圍；min 可以是 -Infinity、max 可以是 Infinity（沒有上限，例：體悟），實際存的永遠是安全整數 */
  min: number
  max: number
  /** 沒寫過的鍵讀出來的值（要在 min～max 之內） */
  start: number
  keyed: MeterKeyed
  /** AI 給的效果一件事合計的上限（EVENTS 2.4）：down 是最多扣多少、up 是最多加多少（都是 0 以上的整數）。分組是「種類加鍵」 */
  cap?: { down: number; up: number }
  /** 下限是另一種量表同一個鍵的值（例：敵對值的下限是 hostility_floor）。那一種沒有人定義時當作沒有這個下限 */
  floor?: string
  /** 效果進來時的修正（例：區的倍率）：在夾值之前套（先加倍再夾）；回傳的數字會四捨五入成整數（.5 往離 0 遠的那邊） */
  adjust?(state: GameState, key: string, delta: number): number
}

/** 安全整數的邊界：沒有上限的量表實際夾在這裡。 */
const SAFE = Number.MAX_SAFE_INTEGER

const own = (o: object | undefined, key: string): boolean => !!o && Object.prototype.hasOwnProperty.call(o, key)

export class MeterRegistry {
  private defs = new Map<string, MeterDef>()
  private binders: Array<(def: MeterDef) => void> = []

  constructor(private probe: Probe) {}

  /**
   * 定義前的接線：L4 用它替每一種量表自動註冊同名的效果與條件（core/rules/meters.ts）。
   * 接線函式在存進登錄表之前跑；它丟錯（例：撞名）整筆定義就不成立，登錄表保持原樣。
   */
  onDefine(fn: (def: MeterDef) => void): void {
    this.binders.push(fn)
  }

  /** 定義一種量表。種類重複、定義不合格、或同名的效果與條件撞名都丟錯（訊息寫出是誰的哪一種）。存的是一份複製。 */
  define(def: MeterDef): void {
    const old = this.defs.get(def.kind)
    if (old) throw new Error(`量表重複定義：${def.kind}（已經由 ${old.owner} 定義）`)
    const problems = meterDefProblems(def)
    if (problems.length) throw new Error(`量表 ${String(def.kind)} 的定義不合格：${problems.join('；')}`)
    const stored: MeterDef = { ...def, ...(def.cap ? { cap: { ...def.cap } } : {}) }
    for (const bind of this.binders) bind(stored)
    this.defs.set(stored.kind, stored)
    this.probe.emit('core/state/meters', 'registry.register', { registry: 'meters', id: stored.kind, owner: stored.owner })
  }

  get(kind: string): MeterDef | undefined {
    return this.defs.get(kind)
  }

  has(kind: string): boolean {
    return this.defs.has(kind)
  }

  kinds(): string[] {
    return [...this.defs.keys()]
  }

  list(): MeterDef[] {
    return [...this.defs.values()]
  }
}

/** 一個定義合不合格。回傳問題的清單。 */
export function meterDefProblems(def: MeterDef): string[] {
  const p: string[] = []
  if (!isRecord(def)) return ['要是一個物件']
  if (!isId(def.kind)) p.push('kind 的格式不對（小寫英文、數字與底線）')
  if (typeof def.owner !== 'string' || !def.owner) p.push('要有 owner（定義的功能）')
  if (typeof def.name !== 'string' || !def.name.trim()) p.push('要有 name（給玩家看的名字）')
  const minOk = def.min === -Infinity || isSafeInt(def.min)
  const maxOk = def.max === Infinity || isSafeInt(def.max)
  if (!minOk) p.push('min 要是整數（或 -Infinity）')
  if (!maxOk) p.push('max 要是整數（或 Infinity）')
  if (minOk && maxOk && def.min > def.max) p.push('min 不能比 max 大')
  if (!isSafeInt(def.start)) p.push('start 要是整數')
  else if (!(def.start >= def.min && def.start <= def.max)) p.push('start 要在 min～max 之內')
  if (!(METER_KEYEDS as readonly unknown[]).includes(def.keyed)) p.push(`keyed 只能是 ${METER_KEYEDS.join('、')}`)
  if (def.cap !== undefined) {
    if (!isRecord(def.cap) || !isSafeInt(def.cap.down) || !isSafeInt(def.cap.up) || def.cap.down < 0 || def.cap.up < 0) p.push('cap 要有 0 以上的整數 down 與 up')
  }
  if (def.floor !== undefined) {
    if (!isId(def.floor)) p.push('floor 要是另一種量表的 kind')
    else if (def.floor === def.kind) p.push('floor 不能是自己')
  }
  if (def.adjust !== undefined && typeof def.adjust !== 'function') p.push('adjust 要是函式')
  return p
}

/** 不指定鍵時照 keyed 定：district 是現在這一區、map 是現在站的那張地圖的實例、none 是 `_`；faction 與 npc 一定要寫（回傳 undefined）。 */
export function defaultMeterKey(def: Pick<MeterDef, 'keyed'>, state: GameState): string | undefined {
  switch (def.keyed) {
    case 'district': return state.location.district || undefined
    case 'map': return state.maps.at?.map || undefined
    case 'none': return METER_NONE_KEY
    default: return undefined
  }
}

/** 這個鍵一定要寫嗎（faction、npc：沒有「現在」可以代替）。 */
export const meterKeyRequired = (def: Pick<MeterDef, 'keyed'>): boolean => def.keyed === 'faction' || def.keyed === 'npc'

/**
 * 一個寫明的鍵合不合格：非空字串；不分對象的只能是 `_`；勢力、人、區要在內容裡查得到（人另外收存檔裡的角色 id）。
 * 回傳問題的清單。state 與 content 是檢查「查不查得到」用的。
 */
export function meterKeyProblems(def: Pick<MeterDef, 'keyed' | 'name'>, key: unknown, state: GameState, content: ContentRegistry): string[] {
  if (typeof key !== 'string' || !key || key === '__proto__') return ['key 要是非空的字串']
  switch (def.keyed) {
    case 'none': return key === METER_NONE_KEY ? [] : [`「${def.name}」不分對象，key 只能是 ${METER_NONE_KEY}`]
    case 'faction': return content.has('faction', key) ? [] : [`「${def.name}」的 key 要是勢力的 id：查不到 ${key}`]
    case 'district': return content.has('district', key) ? [] : [`「${def.name}」的 key 要是區的 id：查不到 ${key}`]
    case 'npc': return content.has('npc', key) || own(state.actors, key) ? [] : [`「${def.name}」的 key 要是人的 id：內容與存檔裡都查不到 ${key}`]
    default: return []
  }
}

/** 這一種量表這個鍵現在的值：寫過的是記的數字，沒寫過的是 start。 */
export function meterValue(def: Pick<MeterDef, 'kind' | 'start'>, state: GameState, key: string): number {
  const row = own(state.meters, def.kind) ? state.meters[def.kind] : undefined
  return row && own(row, key) ? row[key]! : def.start
}

/**
 * 這個鍵現在實際的範圍：min～max（沒有上限的那邊是安全整數的邊界），有 floor 而且那一種有人定義時，下限提高到那張量表同一個鍵的值
 * （下限比上限大時以上限為準）。
 */
export function meterBounds(meters: MeterRegistry, state: GameState, def: MeterDef, key: string): { lo: number; hi: number } {
  const hi = Math.min(def.max, SAFE)
  let lo = Math.max(def.min, -SAFE)
  const floor = def.floor ? meters.get(def.floor) : undefined
  if (floor) lo = Math.max(lo, meterValue(floor, state, key))
  return { lo: Math.min(lo, hi), hi }
}

/** 一個數字夾在這個鍵現在的範圍裡。 */
export function clampMeter(meters: MeterRegistry, state: GameState, def: MeterDef, key: string, value: number): number {
  const { lo, hi } = meterBounds(meters, state, def, key)
  return Math.min(hi, Math.max(lo, value))
}

/** 套一筆加減或設定之後這個鍵的值（還沒寫進狀態）。 */
export function nextMeterValue(meters: MeterRegistry, state: GameState, def: MeterDef, key: string, change: { delta?: number; set?: number }): number {
  const target = change.set !== undefined ? change.set : meterValue(def, state, key) + (change.delta ?? 0)
  return clampMeter(meters, state, def, key, target)
}

/** 把 adjust 的結果變成整數（.5 往離 0 遠的那邊）；不是有限的數字丟錯（那是定義它的功能的錯）。 */
export function roundMeterAmount(def: Pick<MeterDef, 'kind' | 'owner'>, n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`量表 ${def.kind}（${def.owner}）的 adjust 回傳了不是有限的數字：${String(n)}`)
  return Math.sign(n) * Math.round(Math.abs(n))
}

/**
 * 給別的功能問「這個對象現在是多少」：沒有人定義的種類回傳 0（那個功能這一局沒裝，不丟錯）；
 * 沒寫過的鍵是起始值；key 省略時照 keyed（district 是現在這一區、map 是現在這張地圖、none 是 `_`；現在不在區或地圖上時是起始值）。
 * faction、npc 一定要寫 key，沒寫是呼叫的人的錯，丟錯。功能讀別人的量表只能經由它（dev/invariants.md 第 95 條）。
 */
export function meterOf(k: { meters: MeterRegistry }, state: GameState, kind: string, key?: string): number {
  const def = k.meters.get(kind)
  if (!def) return 0
  const at = key ?? defaultMeterKey(def, state)
  if (at === undefined) {
    if (meterKeyRequired(def)) throw new Error(`量表 ${kind}（${def.name}）要寫明 key：它是照${def.keyed === 'faction' ? '勢力' : '人'}分開記的`)
    return def.start
  }
  return meterValue(def, state, at)
}

/**
 * 狀態裡每一種「有人定義的」量表的值是不是都在範圍內、是不是安全整數。回傳問題的清單（空的就是沒問題）。
 * 沒有人定義的種類不看（那個功能這一局沒裝）；floor 不看（下限是動態的，只有變更套用時才夾）。
 */
export function meterProblems(meters: MeterRegistry, state: GameState): string[] {
  const p: string[] = []
  for (const def of meters.list()) {
    const row = own(state.meters, def.kind) ? state.meters[def.kind] : undefined
    for (const [key, v] of Object.entries(row ?? {})) {
      if (!isSafeInt(v)) p.push(`meters.${def.kind}.${key}：${String(v)} 不是整數`)
      else if (v < def.min || v > def.max) p.push(`meters.${def.kind}.${key}：${v} 超出範圍 ${def.min}～${def.max}`)
    }
  }
  return p
}

/** 這個鍵給玩家看的標籤（報告卡與結果的白話用）：勢力與區與人的名字；不分對象與地圖沒有。 */
export function meterKeyLabel(def: Pick<MeterDef, 'keyed'>, key: string, state: GameState, content: ContentRegistry): string {
  const name = (kind: string): string | undefined => {
    const e = content.get(kind, key)
    const v = typeof e?.short === 'string' && e.short ? e.short : e?.name
    return typeof v === 'string' && v ? v : undefined
  }
  switch (def.keyed) {
    case 'faction': return name('faction') ?? key
    case 'district': return name('district') ?? key
    case 'npc': return name('npc') ?? (own(state.actors, key) ? state.actors[key]!.name : key)
    default: return ''
  }
}
