// L4 規則核心：被動效果的來源（dev/adr/0019 第二節；dev/work/M4-core-passive.md）。
// 義體、藥、調校、怪癖、惡意韌體、沉溺的分段、戒斷、傷勢、契約、裝備，都是「這個人身上有某樣東西時，一直生效的一串加減」。
// 功能只用 k.passives.register 登記「這個人現在身上屬於我的是哪幾筆」；核心在建 kernel 時替它接到屬性、衍生數值、檢定修正（這一檔），
// 戰鬥的修正與單位的標籤（core/kernel.ts：戰鬥是 L5）。來源拿掉，每個數字就回到原值：登記表裡沒有人，這幾個 provider 什麼都不回。
//
// 一筆被動效果（PassiveEffect）剛好是五種的其中一種：
//   { attr, amount }                                           有效屬性加減
//   { stat, amount }                                           任何衍生數值的 id 加減
//   { check: { skills?, tags?, attrs? }, amount }              檢定修正：基本功對上、情境標籤有一個對上、或檢定用的屬性對上（有一邊對上就算；attrs 讓「體格與反應的檢定」直接用屬性的也算）
//   { mod, amount, tags?, layer? }                             戰鬥的修正（MOD_KINDS 之一）；tags 要全部在問的情境標籤裡；layer 有寫就只在那一層的戰場算
//   { unit_tag }                                               戰鬥單位多一個標籤（unit.ready）
// 每一筆可以再帶 if（條件的陣列，全部成立才算）與 label（給玩家看的來源名字；沒寫用登記時給的，再沒給用來源的名字）。
// attr、stat、check、mod 四種的 amount 可以改寫成 per（依軌道值縮放；M4-core-gaps 第 12 項）：{ per: { track: 'load', every: 10, amount: 1 } } ＝ 每 10 點感載 +1
// （軌道是 hp、load、sink、afterglow；值是 floor(軌道值 ÷ every) × amount；amount 與 per 剛好寫一個）。k.passives.of 回傳時已經算成 amount（算出來是 0 的那一筆不列）；
// 戰鬥的修正（modParts）用單位在這一場當下的軌道值（生命、感載、餘韻），其餘讀角色的。
//
// 感載消退的加點有固定的寫法（dev/adr/0019 P65）：內海 { stat: 'net_load_decay', amount }、現實 { mod: 'decay', amount, layer: 'meat' }；
// mod 'decay' 沒寫 layer: 'meat' 的算問題（不然內海的戰鬥會算兩次、探索回合又算不到）。
//
// 繞圈：if 的條件可能又去讀衍生數值而回到這裡。同一個人正在算的時候再進來，只回傳「不帶 if 的那幾筆」（來源的函式照樣再問一次）；
// 再繞第二圈（來源的函式自己又讀衍生數值）就什麼都不回。不快取。

import type { ActorId, AttrId, GameState, RollPart } from '../types'
import { ATTR_IDS } from '../types'
import type { ContentRegistry } from '../content/registry'
import type { Probe } from '../state/probe'
import type { StateKernel } from '../state/kernel'
import { isRecord } from '../util/sanitize'
import type { TrackId } from '../state/coreChanges'
import { TRACKS } from '../state/coreChanges'
import type { Condition, ConditionRegistry } from './conditions'
import type { CheckCtx, StatRegistry } from './stats'

/** 被動效果的來源（封閉）。source 會原樣寫進 RollPart.source，畫面照它分組。 */
export const PASSIVE_SOURCES = ['cyber', 'drug', 'tuning', 'quirk', 'malware', 'sink', 'withdrawal', 'wound', 'contract', 'gear'] as const
export type PassiveSource = (typeof PASSIVE_SOURCES)[number]
export const isPassiveSource = (v: unknown): v is PassiveSource => (PASSIVE_SOURCES as readonly unknown[]).includes(v)

/** 來源的名字（沒寫 label 時給玩家看的）。 */
export const PASSIVE_SOURCE_NAMES: Record<PassiveSource, string> = {
  cyber: '義體', drug: '藥物', tuning: '調校', quirk: '怪癖', malware: '惡意韌體', sink: '沉溺', withdrawal: '戒斷', wound: '傷勢', contract: '契約', gear: '裝備',
}

/**
 * 節奏資源的來源（RollPart.source）：每回合回復的行動點（ap_regen）與 RAM（ram_regen）這兩種修正，這幾個來源的正值合計全身最多算 +1
 * （CRAFTING 5.5 節、ITEMS 4.1 節；dev/adr/0019 P13）。其餘來源（技能、同步檔位、機甲、掮客讓出來的）照舊不限。construct 是甲板裡的工具構裝（features/deck）。
 */
export const TEMPO_SOURCES = ['cyber', 'drug', 'gear', 'construct'] as const
/** 節奏資源的正值合計最多算幾點。 */
export const TEMPO_CAP = 1

/** layer 能寫的值：只在現實（meat）或只在內海（net）的戰場算。 */
export const PASSIVE_LAYERS = ['meat', 'net'] as const
export type PassiveLayer = (typeof PASSIVE_LAYERS)[number]

/** 五種的鍵（每一筆剛好寫其中一個）。 */
export const PASSIVE_KEYS = ['attr', 'stat', 'check', 'mod', 'unit_tag'] as const

export interface PassiveCommon {
  /** 條件的陣列，全部成立才算（看的是身上有這筆的那個人） */
  if?: Condition[]
  /** 給玩家看的來源名字 */
  label?: string
}
/** 依軌道值縮放的寫法（取代 amount）：每 every 點 track 加 amount。 */
export interface PassivePer {
  track: PassiveTrack
  every: number
  amount: number
}
/** per 能讀的軌道（和 actor.track 的軌道同一份）。 */
export const PASSIVE_TRACKS = TRACKS
export type PassiveTrack = TrackId
const isTrack = (v: unknown): v is PassiveTrack => (TRACKS as readonly unknown[]).includes(v)
/** 數字：amount（固定）或 per（依軌道值）二選一。 */
export type PassiveAmount = { amount: number; per?: undefined } | { per: PassivePer; amount?: undefined }
export type PassiveEffect = PassiveCommon & (
  | ({ attr: AttrId } & PassiveAmount)
  | ({ stat: string } & PassiveAmount)
  | ({ check: { skills?: string[]; tags?: string[]; attrs?: AttrId[] } } & PassiveAmount)
  | ({ mod: string; tags?: string[]; layer?: PassiveLayer } & PassiveAmount)
  | { unit_tag: string }
)

/** k.passives.of 回傳的一筆：登記時的來源與主人、整理好的名字；amount 一律是算好的數字（per 已經照軌道值算掉了，不帶 per）。 */
export type PassiveEntry = (
  | PassiveCommon & ({ attr: AttrId } | { stat: string } | { check: { skills?: string[]; tags?: string[]; attrs?: AttrId[] } } | { mod: string; tags?: string[]; layer?: PassiveLayer }) & { amount: number }
  | PassiveCommon & { unit_tag: string }
) & { source: PassiveSource; owner: string; label: string }

/** 軌道值的覆蓋：戰鬥的修正用單位當下的值（生命、感載、餘韻），沒給的軌道讀角色的。 */
export type PassiveTracks = Partial<Record<PassiveTrack, number>>

export type PassiveFn = (state: GameState, actor: ActorId) => PassiveEffect[]

interface Registered {
  owner: string
  source: PassiveSource
  label: string
  fn: PassiveFn
}

/** 問戰鬥的修正時帶的情境：這一場的戰場（meat 或 net）、問的人帶的情境標籤。 */
export interface PassiveModQuery {
  layer?: string
  tags?: readonly string[]
  /** 單位在這一場當下的軌道值（per 用；沒給的軌道讀角色的） */
  tracks?: PassiveTracks
}

/**
 * 一筆被動效果現在的數字：寫 amount 的就是 amount，寫 per 的是 floor(軌道值 ÷ every) × amount（軌道值負的當 0），unit_tag 沒有數字回傳 0。
 * 直接讀內容裡的 effects 的功能（戰鬥裡這一場才生效的藥）用它，不要自己讀 .amount。tracks 是單位當下的軌道值（沒給的軌道讀角色的）。
 */
export function passiveAmount(e: PassiveEffect, state: GameState, actor: ActorId, tracks?: PassiveTracks): number {
  if ('unit_tag' in e) return 0
  return e.per !== undefined ? perAmount(e.per, state, actor, tracks) : (e.amount ?? 0)
}

/** per 算出來的數字：floor(軌道值 ÷ every) × amount（軌道值負的當 0）。 */
function perAmount(per: PassivePer, state: GameState, actor: ActorId, tracks?: PassiveTracks): number {
  const raw = tracks?.[per.track] ?? state.actors[actor]?.[per.track] ?? 0
  const n = Math.floor(Math.max(0, raw) / per.every) * per.amount
  return Number.isFinite(n) ? n : 0
}

export class PassiveRegistry {
  private sources: Registered[] = []
  private mods: readonly string[] | null = null
  /** 每個人現在算到第幾層（1：正在算；2：繞了一圈回來又在算） */
  private depth = new Map<ActorId, number>()

  constructor(private probe: Probe, private stats: StatRegistry, private conditions: ConditionRegistry, private time: Pick<StateKernel, 'timeRules'>) {}

  /**
   * 登記一個來源：fn(state, actor) 回傳這個人現在身上屬於 source 的每一筆。同一個 source 可以由不同的 owner 各登記一個。
   * source 不在 PASSIVE_SOURCES 裡丟錯。label 是這個登記的預設名字（沒給用 source 的名字）。
   */
  register(owner: string, source: PassiveSource, fn: PassiveFn, label?: string): void {
    if (!isPassiveSource(source)) throw new Error(`被動效果的來源 ${String(source)} 不在清單裡（${PASSIVE_SOURCES.join('、')}；${owner} 登記的）`)
    this.sources.push({ owner, source, label: label ?? PASSIVE_SOURCE_NAMES[source], fn })
    this.probe.emit('core/rules/passive', 'registry.register', { registry: 'passives', id: source, owner })
  }

  /** 登記了哪些來源（owner 與 source）。 */
  registered(): Array<{ owner: string; source: PassiveSource }> {
    return this.sources.map((s) => ({ owner: s.owner, source: s.source }))
  }

  /** 戰鬥的修正種類（MOD_KINDS）：戰鬥是 L5，由 createKernel 交進來，passiveProblems 用它查 mod 的名字。 */
  defineMods(kinds: readonly string[]): void {
    this.mods = [...kinds]
  }

  modKinds(): readonly string[] | null {
    return this.mods
  }

  /**
   * 這個人現在身上的每一筆（帶 source、owner、label；if 不成立的已經拿掉；per 已經算成 amount、算出來是 0 的不列）。人不存在、沒有任何來源是空的。
   * tracks：軌道值的覆蓋（戰鬥的修正用單位當下的值）。
   */
  of(state: GameState, actor: ActorId, tracks?: PassiveTracks): PassiveEntry[] {
    if (!this.sources.length || !state.actors[actor]) return []
    const depth = this.depth.get(actor) ?? 0
    // 第二圈：來源的函式自己又讀衍生數值而繞回來，不再往下算
    if (depth >= 2) return []
    this.depth.set(actor, depth + 1)
    try {
      const out: PassiveEntry[] = []
      for (const reg of this.sources) {
        for (const raw of reg.fn(state, actor)) {
          if (raw.if?.length) {
            // 繞回來的（同一個人正在算）：不帶 if 的那幾筆照算，帶 if 的先不算，不然條件讀的數字又要問自己
            if (depth > 0 || !this.holds(raw.if, state, actor)) continue
          }
          let eff: PassiveEffect = raw
          if ('per' in raw && raw.per !== undefined) {
            const n = perAmount(raw.per, state, actor, tracks)
            if (n === 0) continue
            const { per: _per, ...rest } = raw
            void _per
            eff = { ...rest, amount: n } as PassiveEffect
          }
          out.push({ ...eff, source: reg.source, owner: reg.owner, label: raw.label ?? reg.label } as PassiveEntry)
        }
      }
      return out
    } finally {
      if (depth === 0) this.depth.delete(actor)
      else this.depth.set(actor, depth)
    }
  }

  private holds(list: Condition[], state: GameState, actor: ActorId): boolean {
    const ctx = { state, actor, stats: this.stats, timeRules: this.time.timeRules }
    return list.every((c) => this.conditions.test(c, ctx))
  }

  /** attr 或 stat 這兩種的加減（給畫面列「這個數字是哪些東西加起來的」；屬性與衍生數值的 provider 也是它）。 */
  parts(state: GameState, actor: ActorId, kind: 'attr' | 'stat', id: string): RollPart[] {
    const out: RollPart[] = []
    for (const e of this.of(state, actor)) {
      if (kind === 'attr' ? 'attr' in e && e.attr === id : 'stat' in e && e.stat === id) out.push({ label: e.label, value: (e as { amount: number }).amount, source: e.source })
    }
    return out
  }

  /** 檢定修正：check.skills 對檢定的基本功、check.tags 對檢定的標籤、check.attrs 對檢定用的屬性，有一邊對上就算。 */
  checkParts(state: GameState, actor: ActorId, ctx: Pick<CheckCtx, 'skill' | 'tags'> & Partial<Pick<CheckCtx, 'attr'>>): RollPart[] {
    const out: RollPart[] = []
    for (const e of this.of(state, actor)) {
      if (!('check' in e)) continue
      const bySkill = !!ctx.skill && !!e.check.skills?.includes(ctx.skill)
      const byTag = !!e.check.tags?.some((t) => ctx.tags.includes(t))
      const byAttr = ctx.attr !== undefined && !!e.check.attrs?.includes(ctx.attr)
      if (bySkill || byTag || byAttr) out.push({ label: e.label, value: e.amount, source: e.source })
    }
    return out
  }

  /**
   * 戰鬥的修正：問的是 kind 這一種。layer 有寫的只在那一層的戰場算（沒寫兩層都算）；tags 有寫的要全部在問的情境標籤裡。
   */
  modParts(state: GameState, actor: ActorId, kind: string, q: PassiveModQuery = {}): RollPart[] {
    const out: RollPart[] = []
    for (const e of this.of(state, actor, q.tracks)) {
      if (!('mod' in e) || e.mod !== kind) continue
      if (e.layer !== undefined && e.layer !== q.layer) continue
      if (e.tags && !e.tags.every((t) => q.tags?.includes(t))) continue
      out.push({ label: e.label, value: e.amount, source: e.source })
    }
    return out
  }

  /** 戰鬥單位要加的標籤（unit_tag）。 */
  unitTags(state: GameState, actor: ActorId): string[] {
    return this.of(state, actor).flatMap((e) => ('unit_tag' in e ? [e.unit_tag] : []))
  }
}

// ---- 格式檢查 ----

/** passiveProblems 要查的東西：整個 kernel 都符合（條件的登錄表；戰鬥的修正種類由 createKernel 交給 passives）。 */
export interface PassiveDeps {
  conditions: Pick<ConditionRegistry, 'validate'>
  passives: Pick<PassiveRegistry, 'modKinds'>
}

const COMMON_KEYS = ['amount', 'per', 'if', 'label']
const MOD_ONLY_KEYS = ['tags', 'layer']
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

/**
 * 一筆或一串被動效果的格式問題（每一條寫出是第幾筆、哪個欄位）；空的就是合格。
 * 擋的是：鍵不是五種之一、兩種以上的鍵並存、amount 不對、mod 不在清單裡、layer 不是 meat 或 net、mod decay 沒寫 layer meat、if 的條件格式不對（含沒有人註冊的條件種類）、
 * 不認得的欄位。條件種類要等功能都裝上才知道，所以這個檢查放在 ready 之後（core/kernel.ts 的 readyFeatures）。
 */
export function passiveProblems(deps: PassiveDeps, raw: unknown, path = 'effects'): string[] {
  if (Array.isArray(raw)) return raw.flatMap((e, i) => oneProblems(deps, e, `${path}[${i}]`))
  return oneProblems(deps, raw, path)
}

function oneProblems(deps: PassiveDeps, e: unknown, at: string): string[] {
  if (!isRecord(e)) return [`${at}：要是 { ${PASSIVE_KEYS.join('｜')}, … } 的物件`]
  const p: string[] = []
  const keys = PASSIVE_KEYS.filter((k) => e[k] !== undefined)
  if (keys.length === 0) return [`${at}：要寫 ${PASSIVE_KEYS.join('、')} 其中一個`]
  if (keys.length > 1) return [`${at}：${keys.join('、')} 只能寫一個（一筆剛好是一種）`]
  const key = keys[0]!
  const allowed = new Set<string>([key, ...COMMON_KEYS, ...(key === 'mod' ? MOD_ONLY_KEYS : [])])
  if (key === 'unit_tag') { allowed.delete('amount'); allowed.delete('per') }
  for (const f of Object.keys(e)) if (!allowed.has(f)) p.push(`${at}：${key} 這一種沒有 ${f} 這個欄位`)
  if (key === 'unit_tag') {
    if (!isText(e.unit_tag)) p.push(`${at}.unit_tag：要是標籤的名字`)
  } else if (e.per !== undefined) {
    // 依軌道值縮放（P-core-gaps 12）：per 取代 amount，兩個剛好寫一個
    if (e.amount !== undefined) p.push(`${at}：amount 與 per 只能寫一個（per 就是「每 every 點 track 加 amount」）`)
    const per = e.per
    if (!isRecord(per)) p.push(`${at}.per：要是 { track, every, amount }`)
    else {
      for (const f of Object.keys(per)) if (!['track', 'every', 'amount'].includes(f)) p.push(`${at}.per：沒有 ${f} 這個欄位（只有 track、every、amount）`)
      if (!isTrack(per.track)) p.push(`${at}.per.track：要是 ${TRACKS.join('、')} 其中一個`)
      if (typeof per.every !== 'number' || !Number.isSafeInteger(per.every) || per.every < 1) p.push(`${at}.per.every：要是 1 以上的整數（每幾點）`)
      if (typeof per.amount !== 'number' || !Number.isFinite(per.amount) || per.amount === 0) p.push(`${at}.per.amount：要是不為 0 的有限數字`)
    }
  } else if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount === 0) {
    p.push(`${at}.amount：要是不為 0 的有限數字（或寫 per）`)
  }
  if (key === 'attr' && !(ATTR_IDS as readonly unknown[]).includes(e.attr)) p.push(`${at}.attr：要是 ${ATTR_IDS.join('、')} 其中一個`)
  if (key === 'stat' && !isText(e.stat)) p.push(`${at}.stat：要是衍生數值的 id`)
  if (key === 'check') {
    const c = e.check
    if (!isRecord(c)) p.push(`${at}.check：要是 { skills?, tags? }`)
    else {
      for (const f of Object.keys(c)) if (f !== 'skills' && f !== 'tags' && f !== 'attrs') p.push(`${at}.check：沒有 ${f} 這個欄位（只有 skills、tags、attrs）`)
      for (const f of ['skills', 'tags'] as const) if (c[f] !== undefined && !isTextList(c[f])) p.push(`${at}.check.${f}：要是字串的陣列`)
      if (c.attrs !== undefined && !(Array.isArray(c.attrs) && c.attrs.every((a) => (ATTR_IDS as readonly unknown[]).includes(a)))) p.push(`${at}.check.attrs：要是 ${ATTR_IDS.join('、')} 裡的屬性陣列`)
      const has = (f: 'skills' | 'tags' | 'attrs') => Array.isArray(c[f]) && (c[f] as unknown[]).length > 0
      if (!has('skills') && !has('tags') && !has('attrs')) p.push(`${at}.check：skills、tags、attrs 至少要寫一個、不能是空的`)
    }
  }
  if (key === 'mod') {
    const kinds = deps.passives.modKinds()
    if (!isText(e.mod)) p.push(`${at}.mod：要是戰鬥修正的種類`)
    else if (kinds && !kinds.includes(e.mod)) p.push(`${at}.mod：「${e.mod}」不是戰鬥修正的種類（可以寫：${kinds.join('、')}）`)
    if (e.tags !== undefined && !isTextList(e.tags)) p.push(`${at}.tags：要是字串的陣列`)
    if (e.layer !== undefined && !(PASSIVE_LAYERS as readonly unknown[]).includes(e.layer)) p.push(`${at}.layer：要是 ${PASSIVE_LAYERS.join(' 或 ')}`)
    // 感載消退（P65）：現實寫 mod decay 加 layer meat，內海另寫 { stat: 'net_load_decay' }
    if (e.mod === 'decay' && e.layer !== 'meat') p.push(`${at}：mod 'decay' 一定要寫 layer: 'meat'（內海的消退是衍生數值 net_load_decay，要另外寫一筆 { stat: 'net_load_decay', amount }；不然內海的戰鬥會算兩次、探索回合又算不到）`)
  }
  if (e.label !== undefined && !isText(e.label)) p.push(`${at}.label：要是一句話`)
  if (e.if !== undefined) {
    if (!Array.isArray(e.if)) p.push(`${at}.if：要是條件的陣列`)
    else e.if.forEach((c, i) => p.push(...deps.conditions.validate(c, `${at}.if[${i}]`)))
  }
  return p
}

/** 內容種類裡帶 effects 的三種：設計圖（義體）、零件、怪癖（dev/adr/0019 第一節）。 */
const EFFECT_KINDS = ['blueprint', 'part', 'quirk'] as const

/**
 * 載入之後的整體檢查（readyFeatures 在所有功能的 ready 之後問）：設計圖、零件、怪癖的 effects 都要是合格的被動效果。
 * 每一條以「<kind>/<id>：」開頭（載入的過濾靠它找出是哪一筆）。別的種類（藥、調校、惡意韌體）的 effects 由那些功能自己用 passiveProblems 查。
 */
export function passiveContentProblems(k: PassiveDeps & { content: ContentRegistry }): string[] {
  const out: string[] = []
  for (const kind of EFFECT_KINDS) {
    for (const e of k.content.list<{ id: string; effects?: unknown }>(kind)) {
      if (e.effects === undefined) continue
      out.push(...passiveProblems(k, e.effects, 'effects').map((m) => `${kind}/${e.id}：${m}`))
    }
  }
  return out
}

// ---- 節奏資源的夾法 ----

/**
 * 每回合回復的行動點、RAM 這兩種修正的合計：來源屬於 TEMPO_SOURCES 的正值合計最多算 +1（TEMPO_CAP），負值照算，其他來源照算。
 * parts 是 run.mods('ap_regen', …) 或 run.mods('ram_regen', …) 的結果。
 */
export function regenTotal(parts: ReadonlyArray<{ value: number; source?: string }>): number {
  let tempo = 0
  let rest = 0
  for (const p of parts) {
    if (p.value > 0 && p.source !== undefined && (TEMPO_SOURCES as readonly string[]).includes(p.source)) tempo += p.value
    else rest += p.value
  }
  return Math.min(TEMPO_CAP, tempo) + rest
}
