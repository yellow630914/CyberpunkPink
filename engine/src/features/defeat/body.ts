// 戰敗事件的內文：組成交給事件視窗的內嵌事件、照存檔規則改寫效果、「不演」時走的路。純函式。
//
// 為什麼這裡有一份解 inherit 與找結果的程式：事件視窗在 features/director，功能之間不能互相 import（dev/project.md）；
// 「不演」要在沒有視窗的情況下走完每一段，所以照 EVENTS 與 DATA 第 5 節的寫法在這裡走一遍（只收戰敗事件用得到的部分）。
// 事件視窗怎麼演、怎麼擲，以 features/director/body.ts 為準；兩邊的寫法對不上時以那邊為準。
//
// 改寫（開之前先照存檔規則）：
// - 扣現金的效果（kind cash、amount 是負的）合計不超過上限（moneyLimit）；超過的從後面往回減，減到 0 的拿掉（COMBAT_SYSTEM 8.3 節）。
//   事件視窗一次只結算一個選項的那一組，所以每一組各自套上限；「不演」是所有段合在一起套一次。
// - 戰敗時拿走義體與裝備（defeatTakeGear）關著時，拿走身上裝備與義體的效果拿掉（由 defeat.gear 掛點回答哪些是）。

import type { Condition, Degree, Effect, GameState, Kernel, RollPart, TimelineBeat } from '../../core'
import { ATTR_IDS, DC_TIERS, DEGREE_NAME, blankState, clone, dcFor, rollCheck } from '../../core'
import type { DefeatEventEntry, DefeatVersion, Raw } from './model'
import { isRec } from './model'

// ---- 版本的形狀：舊的寫法轉成事件的格式 ----

/** 這個版本寫成事件的格式：text 加 stages。舊的寫法（effects）是只有一段、一個選項。 */
export function normalVersion(v: DefeatVersion): { text: string; stages: Raw[] } {
  if (Array.isArray(v.stages)) return { text: v.text, stages: v.stages }
  if (Array.isArray(v.options)) return { text: v.text, stages: [{ options: v.options }] }
  return { text: v.text, stages: [{ options: [{ id: 'o1', text: '接受這個結果。', outcomes: { any: v.effects ?? [] } }] }] }
}

// ---- 效果的改寫 ----

export interface Rewrite {
  /** 扣現金最多扣多少 */
  money: number
  /** 這一筆效果是不是拿走身上的裝備或義體（defeatTakeGear 關著時拿掉） */
  gear: ((e: Effect) => boolean) | null
}

const isLoss = (e: Effect | null): e is Effect & { amount: number } => !!e && e.kind === 'cash' && typeof e.amount === 'number' && e.amount < 0

/** 一組效果照規定改寫：先拿掉要拿掉的裝備，再把扣現金的合計壓在上限以內（從後面往回減）。不改傳進來的。 */
export function rewriteEffects(effects: Effect[], rw: Rewrite): Effect[] {
  // 指示（fight、chain）不是效果：原樣留著，不問 gear
  const kept = rw.gear ? effects.filter((e) => e.kind === 'fight' || e.kind === 'chain' || !rw.gear!(e)) : effects
  const out: Array<Effect | null> = kept.map((e) => ({ ...e }))
  let excess = -out.reduce((sum, e) => sum + (isLoss(e) ? e.amount : 0), 0) - Math.max(0, rw.money)
  for (let i = out.length - 1; i >= 0 && excess > 0; i--) {
    const e = out[i]!
    if (!isLoss(e)) continue
    const cut = Math.min(-e.amount, excess)
    excess -= cut
    out[i] = -e.amount - cut === 0 ? null : { ...e, amount: e.amount + cut }
  }
  return out.filter((e): e is Effect => e !== null)
}

const OUTCOME_KEYS = ['critical', 'success', 'fail', 'fumble', 'any'] as const

/** 一整份 stages 裡每一個選項的每一組結果都改寫一次（段的順序與 inherit 的指向不變）。回傳新的，不改傳進來的。 */
function rewriteStages(stages: Raw[], rw: Rewrite): Raw[] {
  return stages.map((s) => {
    if (!Array.isArray(s.options)) return clone(s)
    return {
      ...clone(s),
      options: (s.options as Raw[]).map((o) => {
        if (!isRec(o.outcomes)) return clone(o)
        const outcomes: Raw = {}
        for (const key of Object.keys(o.outcomes)) {
          const list = (o.outcomes as Raw)[key]
          outcomes[key] = (OUTCOME_KEYS as readonly string[]).includes(key) && Array.isArray(list) ? rewriteEffects(list as Effect[], rw) : clone(list)
        }
        return { ...clone(o), outcomes }
      }),
    }
  })
}

/** 組成交給事件視窗的內嵌事件（每個版本都轉成 text 加 stages、效果照規定改寫）。 */
export function inlineEvent(entry: DefeatEventEntry, version: string, rw: Rewrite): Raw {
  const versions: Raw = {}
  for (const [vid, v] of Object.entries(entry.versions)) {
    const n = normalVersion(v as DefeatVersion)
    versions[vid] = { text: n.text, stages: rewriteStages(n.stages, rw) }
  }
  // 事件視窗要有 default：沒寫的用抽到的那一版頂著（版本的選擇由 setup.version 指定）
  if (versions.default === undefined) versions.default = clone(versions[version] ?? Object.values(versions)[0])
  return {
    id: entry.id, name: entry.name, versions,
    ...(entry.tags && entry.tags.length > 0 ? { tags: [...entry.tags] } : {}),
    ...(entry.adult === true ? { adult: true } : {}),
    ...(entry.cast && entry.cast.length > 0 ? { cast: clone(entry.cast) } : {}),
  }
}

// ---- 「不演」：每一段走第一個選項，有檢定的照擲 ----

const INHERIT_RE = /^(?:([a-z]+)\.)?stages\.(\d+)$/
const MAX_INHERIT = 8

interface FlatOption {
  id: string
  text: string
  need?: unknown
  check?: unknown
  outcomes?: Raw
  ends?: boolean
  flags?: unknown
}
interface FlatStage {
  text?: string
  options: FlatOption[]
}

function options(list: unknown): FlatOption[] {
  return (Array.isArray(list) ? list : []).filter(isRec).map((o, i) => ({ ...(o as unknown as FlatOption), id: typeof o.id === 'string' ? o.id : `o${i + 1}` }))
}

function resolveStage(versions: Record<string, { text: string; stages: Raw[] }>, version: string, index: number, depth: number, seen: string[]): FlatStage | string {
  const stage = versions[version]?.stages[index]
  if (!stage) return `沒有 ${version}.stages.${index} 這一段`
  const key = `${version}.${index}`
  const text = typeof stage.text === 'string' ? stage.text : undefined
  if (typeof stage.inherit !== 'string') return { ...(text !== undefined ? { text } : {}), options: options(stage.options) }
  if (depth >= MAX_INHERIT || seen.includes(key)) return `inherit 繞回了自己（${[...seen, key].join(' → ')}）`
  const m = INHERIT_RE.exec(stage.inherit)
  if (!m) return `inherit「${stage.inherit}」要寫成「版本.stages.第幾段」`
  const from = m[1] ?? version
  if (!versions[from]) return `inherit「${stage.inherit}」指的版本 ${from} 不存在`
  const base = resolveStage(versions, from, Number(m[2]), depth + 1, [...seen, key])
  if (typeof base === 'string') return base
  const own = stage.options ? options(stage.options) : base.options.map((o) => ({ ...o }))
  const t = text ?? base.text
  return { ...(t !== undefined ? { text: t } : {}), options: own }
}

/** 解開一個版本（沒有這個版本就走 default）：一段一段、inherit 展開之後。解不開回傳原因（字串）。 */
export function flatStages(entry: DefeatEventEntry, version: string): FlatStage[] | string {
  const versions: Record<string, { text: string; stages: Raw[] }> = {}
  for (const [vid, v] of Object.entries(entry.versions)) versions[vid] = normalVersion(v as DefeatVersion)
  const use = versions[version] ? version : versions.default ? 'default' : Object.keys(versions)[0]
  if (!use) return `${entry.id} 沒有任何版本`
  const out: FlatStage[] = []
  for (let i = 0; i < versions[use]!.stages.length; i++) {
    const s = resolveStage(versions, use, i, 0, [])
    if (typeof s === 'string') return s
    out.push(s)
  }
  return out
}

const isTier = (v: unknown): v is keyof typeof DC_TIERS => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DC_TIERS, v)

/** [基本功, 屬性?, 難度] 整理成物件；格式不對回傳 null。 */
function checkOf(raw: unknown): { skill: string; attr?: string; dc: number | keyof typeof DC_TIERS } | null {
  if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 3)) return null
  const dc = raw[raw.length - 1]
  if (!isTier(dc) && !(typeof dc === 'number' && Number.isFinite(dc))) return null
  if (typeof raw[0] !== 'string') return null
  if (raw.length === 3) return typeof raw[1] === 'string' ? { skill: raw[0], attr: raw[1], dc } : null
  return { skill: raw[0], dc }
}

function outcomeList(o: FlatOption, degree: Degree | null): Raw[] {
  const table = (o.outcomes ?? {}) as Record<string, Raw[] | undefined>
  const order = degree === null ? ['any'] : degree === 'critical' ? ['critical', 'success', 'any'] : degree === 'fumble' ? ['fumble', 'fail', 'any'] : [degree, 'any']
  for (const key of order) if (table[key] !== undefined) return table[key]!
  return []
}

const hasToken = (v: unknown): boolean => (typeof v === 'string' ? v.startsWith('$') : Array.isArray(v) ? v.some(hasToken) : isRec(v) ? Object.values(v).some(hasToken) : false)

function substitutePc<T>(value: T, pc: string): T {
  if (typeof value === 'string') return (value === '$pc' ? pc : value) as T
  if (Array.isArray(value)) return value.map((v) => substitutePc(v, pc)) as unknown as T
  if (isRec(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitutePc(v, pc)])) as T
  return value
}

export interface SkipPlay {
  /** 每一段走到的效果，照順序合在一起（還沒改寫、還沒結算） */
  effects: Effect[]
  /** 擲過的檢定（時間軸用） */
  timeline: TimelineBeat[]
  /** 這一步擲了幾次（亂數的游標要往前） */
  rolls: number
  /** 沒辦法照走的地方（白話），列在結果裡 */
  notes: string[]
  /** 走過的選項 id，照段的順序 */
  path: string[]
  /** 這一版的選項帶的旗標（照順序） */
  flags: string[]
}

export interface SkipOpts {
  /** 擲骰：false 是預覽（有檢定的那一段不擲，只留一句提醒） */
  roll: boolean
  /** 骰面的用途（同一個狀態、同一個用途一定同一顆；每一段另外加上段數） */
  purpose: string
}

/**
 * 不演：每一段走第一個選得了的選項（need 不成立的跳過），有檢定的照擲（主角擲、DC 照階梯加存檔規則的偏移），
 * 選項寫了 ends 就在那一段停。指示（fight、chain）與成人場景略過；還要登場角色才定得下來的效果（$a、$b）略過並寫在 notes。
 */
export function playSkipped(k: Kernel, state: GameState, entry: DefeatEventEntry, version: string, o: SkipOpts): SkipPlay | string {
  const stages = flatStages(entry, version)
  if (typeof stages === 'string') return stages
  const out: SkipPlay = { effects: [], timeline: [], rolls: 0, notes: [], path: [], flags: [] }
  const pc = state.pc
  const tags = ['event', ...(entry.tags ?? [])]
  for (let i = 0; i < stages.length; i++) {
    const chosen = stages[i]!.options.find((op) => needOk(k, state, op.need))
    if (!chosen) continue
    out.path.push(chosen.id)
    if (Array.isArray(chosen.flags)) out.flags.push(...chosen.flags.filter((f): f is string => typeof f === 'string'))
    let degree: Degree | null = null
    const spec = chosen.check !== undefined ? checkOf(chosen.check) : null
    if (spec) {
      if (!o.roll) {
        out.notes.push(`第 ${i + 1} 段「${chosen.text}」要擲一次檢定，結果看骰面。`)
        if (chosen.ends === true) break
        continue
      }
      if (pc && state.actors[pc]) {
        const skill = k.content.get('skill', spec.skill)
        const attrRaw = spec.attr ?? (typeof skill?.attr === 'string' ? skill.attr : undefined)
        const attr = ((ATTR_IDS as readonly string[]).includes(attrRaw ?? '') ? attrRaw : 'intellect') as (typeof ATTR_IDS)[number]
        const situation: RollPart[] = []
        const roll = rollCheck(k.stats, state, { actor: pc, attr, skill: spec.skill, dc: dcFor(spec.dc, state.rules), purpose: `${o.purpose}/${i}`, situation, tags })
        degree = roll.degree
        out.rolls += 1
        out.timeline.push({ layer: 'meat', actor: pc, text: `${chosen.text}（${DEGREE_NAME[roll.degree]}：骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'defeat.roll', data: { event: entry.id, option: chosen.id, stage: i } })
      }
    }
    const list = outcomeList(chosen, degree).filter((e) => e.kind !== 'fight' && e.kind !== 'chain')
    for (const item of list) {
      const e = pc ? substitutePc(item, pc) : item
      if (hasToken(e)) out.notes.push(`第 ${i + 1} 段有一筆要等登場角色才定得下來的結果，沒有算進去。`)
      else out.effects.push(e as Effect)
    }
    if (chosen.ends === true) break
  }
  return out
}

function needOk(k: Kernel, state: GameState, need: unknown): boolean {
  if (need === undefined) return true
  const list = (Array.isArray(need) ? need : [need]) as Condition[]
  return list.every((c) => k.conditions.test(c, { state, stats: k.stats, timeRules: k.timeRules }))
}

// ---- 載入之後的檢查：每一筆效果的種類有人註冊、格式對 ----

/** 效果驗格式的情境（載入時沒有真的狀態；戰敗事件的資料是內建的來源，days 之類只有內建能用的欄位照收）。 */
function fakeCtx(k: Pick<Kernel, 'content'>): Parameters<Kernel['effects']['validate']>[1] {
  // 有些效果（義體、契約）的格式檢查要看對象在不在：放一個只有空殼的主角
  const state = blankState(0)
  state.pc = 'pc'
  state.actors.pc = { id: 'pc', name: 'pc', role: 'pc', hp: 1, load: 0, afterglow: 0, sink: 0, attrs: {}, skills: {}, perks: [], conditions: [], ext: {} } as unknown as GameState['actors'][string]
  return { state, actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as unknown as Parameters<Kernel['effects']['validate']>[1]
}

/**
 * 一件戰敗事件裡每一筆效果的問題（種類沒有人註冊、格式不對），訊息帶事件的 id 與位置：對應的功能沒裝（義體、調校、惡意韌體、契約……）時，
 * 用到它們的事件在載入之後（ready）就被擋下，不等到玩家輸了才發現。指示（fight、chain）不是效果；含 $a、$b 的只查種類。
 */
export function effectProblems(k: Pick<Kernel, 'content' | 'effects'>, entry: DefeatEventEntry): string[] {
  const out: string[] = []
  for (const [vid, v] of Object.entries(entry.versions)) {
    const n = normalVersion(v as DefeatVersion)
    n.stages.forEach((stage, si) => {
      const opts = Array.isArray(stage.options) ? (stage.options as Raw[]) : []
      opts.forEach((o, oi) => {
        if (!isRec(o.outcomes)) return
        for (const [key, list] of Object.entries(o.outcomes)) {
          if (!Array.isArray(list)) continue
          list.forEach((item, ei) => {
            if (!isRec(item) || typeof item.kind !== 'string' || item.kind === 'fight' || item.kind === 'chain') return
            const at = `defeat_event/${entry.id}：versions.${vid}.stages[${si}].options[${oi}].outcomes.${key}[${ei}]`
            if (hasToken(item)) {
              if (!k.effects.has(item.kind)) out.push(`${at}.kind：${JSON.stringify(item.kind)} 不在封閉清單裡（沒有裝提供這個效果的功能）`)
              return
            }
            out.push(...k.effects.validate([item], fakeCtx(k), at).map((m) => m.replace(`${at}[0]`, at)))
          })
        }
      })
    })
  }
  return out
}
