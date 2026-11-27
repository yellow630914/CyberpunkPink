// L6 功能 live 的時段直播（MEDIA 1.3 節、1.2 節的觀看數與收播換算、4.6 節的設備；EVENTS 3.1 節 live_mid、4.11 節；dev/adr/0020 第三節、V25、V27、V28；dev/work/M5-live-slot.md）。
//   slotOptions   四種現在各自開不開得出來、為什麼（一條一個原因）、難度、起始熱度
//   slotPreview   開播之前先看：檢定的每一項、難度、四種結果的機率與各自的總熱度、擋下的原因
//   slotStart     開播：擲一次表演檢定、推進一半的時間、帶觸發點 live_mid；報告 live.start（kind broadcast）
//   slotEnd       收播：推進另一半、結算（訂閱、打賞、紀錄、豔名、aired）、發 activity.end；報告 live.end，裡面有一拍 tag: 'live.end'
// 時段直播不掛在任何活動上、不吃素材、不是行動種類。進行中只放行 commit:live.、事件視窗與事件帶出來的戰鬥與場景（SLOT_ALLOW；index.ts 的活動 live 用它）。
// 自訂輸入：text 原樣放進報告的 input（只照「字」截斷，不 trim、不篩選、不影響任何數字）；plan 由呼叫的人給（第三波的判讀會把 text 變成 plan），沒給就是預設（不加不減）。
// 成人種類在接單人場景（M5-live-houses，V66）之前是一次誘惑檢定、不開場景，收播時這一區的豔名 +1。

import type { ActorId, AttrId, Change, ContentEntry, Effect, GameState, Kernel, ClampNote, ReportDraft, RollPart } from '../../core'
import {
  ATTR_IDS, ActionBlocked, addMinutes, checkParts, clone, computeDegree, dcFor, deriveRng, effectCtx, gridHere, isRecord, isStreetMapKind, makeCheck, meterOf, tagsAllowed,
} from '../../core'
import { cameraPlan } from './camera'
import type { CameraChoice } from './camera'
import type { LiveRules, Session } from './model'
import { liveRules, liveSession, readLive, viewersFrom } from './model'
import { channelBlock, noRecHere } from './open'
import { settleSession } from './settle'
import type { SlotDirection, SlotKind, SlotResult, SlotRules } from './slotrules'
import {
  SLOT_DIRECTIONS, SLOT_DIRECTION_NAME, SLOT_HOURS, SLOT_KINDS, SLOT_KIND_NAME, SLOT_MAX_TAGS, SLOT_RESULTS, SLOT_TAGS, SLOT_TAG_NAME,
} from './slotrules'

export const START_ACTION = 'live.start'
export const END_ACTION = 'live.end'
/** 時段直播 session.template 寫的字（沒有對應的模板；亮點與敵對值 ×1.5 都只看活動直播） */
export const SLOT_TEMPLATE = 'slot'
export const STREAM_GEAR_STAT = 'stream_gear_bonus'
export const POPULARITY = 'popularity'
export const LIVE_MID = 'live_mid'

/**
 * 時段直播進行中放行的 doing 前綴（commit:live. 另外由 allowEverywhere 放行）：事件視窗（直播事件與它的「我要做別的」）、
 * 事件可能帶出來的戰鬥與場景（和 features/dive 的 DIVE_ALLOW 同一組）。其餘一律擋下：「直播中，先收播才能做別的事。」
 */
export const SLOT_ALLOW: readonly string[] = [
  'event.start', 'commit:event.', 'chain:free_action',
  'battle.', 'commit:battle.', 'chain:battle_end', 'battle.retry', 'commit:defeat.', 'scene.start', 'commit:scene.',
]
export const SLOT_BLOCK_REASON = '直播中，先收播才能做別的事。'

// ---- 小工具 ----

const SKILL_ATTR: Record<string, AttrId> = {
  brawl: 'body', athletics: 'body', heavy: 'body', firearms: 'reflex', piloting: 'reflex', stealth: 'reflex', mechanics: 'tech', cyberware: 'tech', medicine: 'tech',
  interface: 'intellect', investigate: 'intellect', streetwise: 'intellect', intimidate: 'resolve', composure: 'resolve', sync: 'resolve', negotiate: 'charm', seduce: 'charm', perform: 'charm',
}

/** 一項基本功對應的屬性（內容 skill 有寫就用內容的，沒有就用內建的對照）。 */
function skillAttr(k: Pick<Kernel, 'content'>, skill: string): AttrId {
  const e = k.content.hasKind('skill') && k.content.has('skill', skill) ? k.content.get<ContentEntry & { attr?: unknown }>('skill', skill) : undefined
  const a = e?.attr
  if (typeof a === 'string' && (ATTR_IDS as readonly string[]).includes(a)) return a as AttrId
  return SKILL_ATTR[skill] ?? 'charm'
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const len = (s: string): number => Array.from(s).length
const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

/** 人氣級的兩部分：人氣 ÷ pop_div 捨去（沒有人定義 popularity 是 0）、訂閱的位數加成（一千 0、一萬 1、十萬 2，最少 0）。 */
export function popLevel(k: Pick<Kernel, 'meters'>, state: GameState, slot: SlotRules): { pop: number; digits: number; subs: number } {
  const pop = state.pc && k.meters.has(POPULARITY) ? meterOf(k, state, POPULARITY, state.pc) : 0
  const subs = meterOf(k, state, 'subs')
  const digits = Math.max(0, String(Math.max(0, Math.floor(subs))).length - 1 - slot.digits_base)
  return { pop: Math.floor(Math.max(0, pop) / slot.pop_div), digits, subs }
}

/** 這一區的豔名級數（每 fame_step 點一級；沒有豔名量表是 0）。 */
export const fameTier = (k: Pick<Kernel, 'meters'>, state: GameState, rules: LiveRules): number => (k.meters.has('fame') ? Math.floor(Math.max(0, meterOf(k, state, 'fame')) / rules.fame_step) : 0)

/** 依訂閱定的難度（沒有人定義訂閱就是最低一段）。 */
export function slotDc(slot: SlotRules, subs: number): number {
  let dc = slot.dc[0]!.dc
  for (const row of slot.dc) if (subs >= row.subs) dc = row.dc
  return dc
}

/** 設備的加值：衍生數值 stream_gear_bonus（頻道定義；沒有人定義是 0），最多 gear_cap。 */
function gearOf(k: Kernel, state: GameState, slot: SlotRules): number {
  if (!state.pc || !state.actors[state.pc] || !k.stats.hasStat(STREAM_GEAR_STAT)) return 0
  return clamp(Math.floor(k.stats.stat(state, state.pc, STREAM_GEAR_STAT)), 0, slot.gear_cap)
}

export interface DirectionMods {
  /** 檢定的修正（已經夾在 ±custom.check） */
  check: number
  /** 成功時熱度再加（已經夾在 ±custom.heat） */
  success_heat: number
  /** 起始熱度的加減（已經夾在 ±custom.heat） */
  start: number
  /** 這一場熱度的上限 */
  cap: number
  /** 訂閱換算的倍率 */
  subs_mult: number
}

/** 一個方向的修正；沒給方向是預設（不加不減）。自訂的修正最多 ±custom.check 檢定、±custom.heat 熱度。 */
export function directionMods(slot: SlotRules, dir: SlotDirection | undefined): DirectionMods {
  const c = slot.custom
  const out: DirectionMods = { check: 0, success_heat: 0, start: 0, cap: slot.cap, subs_mult: 1 }
  if (dir === 'steady') { out.check = slot.steady.check; out.cap = Math.min(slot.cap, slot.steady.cap) }
  else if (dir === 'bold') { out.check = slot.bold.check; out.success_heat = slot.bold.success_heat }
  else if (dir === 'niche') { out.start = slot.niche.start; out.subs_mult = slot.niche.subs_mult }
  out.check = clamp(out.check, -c.check, c.check)
  out.success_heat = clamp(out.success_heat, -c.heat, c.heat)
  out.start = clamp(out.start, -c.heat, c.heat)
  return out
}

/** 起始熱度：人氣級（成人種類是這一區的豔名級）；冷門題材再減。每一項都列出來。 */
export function startHeat(k: Kernel, state: GameState, rules: LiveRules, kind: SlotKind, dir: SlotDirection | undefined): { value: number; parts: Array<{ label: string; value: number }> } {
  const slot = rules.slot
  const parts: Array<{ label: string; value: number }> = []
  if (slot.kinds[kind].start === 'fame') parts.push({ label: '這一區的豔名級', value: fameTier(k, state, rules) })
  else {
    const p = popLevel(k, state, slot)
    parts.push({ label: '人氣級', value: p.pop }, { label: '訂閱的位數', value: p.digits })
  }
  let value = parts.reduce((s, p) => s + p.value, 0)
  const mods = directionMods(slot, dir)
  if (mods.start !== 0) {
    const next = Math.max(0, value + mods.start)
    parts.push({ label: SLOT_DIRECTION_NAME[dir!], value: next - value })
    value = next
  }
  return { value, parts }
}

/** 總熱度 = 起始 ＋ 結果 ＋（時長 − 1）× hour_heat ＋ 搏出位成功的加成，夾在 0～上限。 */
export function totalHeat(slot: SlotRules, mods: DirectionMods, start: number, result: SlotResult, hours: number, extra = 0): number {
  const bold = result === 'success' || result === 'critical' ? mods.success_heat : 0
  // extra：第一人稱直播的成人那一種 +1（MEDIA 1.3；算進總熱度，所以仍然不超過上限）
  return clamp(start + slot.gain[result] + (hours - 1) * slot.hour_heat + bold + extra, 0, mods.cap)
}

// ---- 能不能開 ----

/** 別的活動進行中擋下的原因（那個活動自己的句子）；沒有別的活動是 null。 */
function otherActivityBlock(k: Kernel, state: GameState, doing: string): string | null {
  for (const a of k.activity.active(state)) {
    if (a.kind === 'live') continue
    const def = k.activity.get(a.kind)
    return def ? def.reason(state, doing) : a.label
  }
  return null
}

/** 種類不看的原因：有主角、沒有別的直播與活動、頻道開著、這裡准錄。 */
function commonBlocks(k: Kernel, state: GameState, doing: string): string[] {
  const out: string[] = []
  if (!state.pc || !state.actors[state.pc]) out.push('還沒有主角，不能直播。')
  if (liveSession(state)) out.push('已經在直播了：先收播。')
  const other = otherActivityBlock(k, state, doing)
  if (other) out.push(other)
  const ch = channelBlock(k, state)
  if (ch) out.push(ch)
  if (noRecHere(k, state, [])) out.push('這裡不准錄影，開不了直播。')
  return out
}

/** 這一種自己的原因：逛街要站在城市的街區地圖上、內容篩選關掉了那一種的標籤。 */
function kindBlocks(k: Kernel, state: GameState, slot: SlotRules, kind: SlotKind): string[] {
  const out: string[] = []
  const rule = slot.kinds[kind]
  if (rule.street) {
    const g = gridHere(k, state)
    if (!g || !isStreetMapKind(g.map.kind)) out.push(`${SLOT_KIND_NAME[kind]}直播要在城市的街區上：你現在不在街區地圖上。`)
  }
  if (!tagsAllowed(state.rules, rule.tags)) out.push(`${SLOT_KIND_NAME[kind]}直播的題材被你在內容篩選關掉了。`)
  return out
}

export interface SlotOption {
  id: SlotKind
  name: string
  can: boolean
  /** 第一條原因 */
  why: string | null
  reasons: string[]
  /** 這一種的基本功（取較高的一項） */
  skills: string[]
  /** 起始熱度用人氣級還是豔名級 */
  start_from: 'pop' | 'fame'
  start_heat: number
  /** 依現在的訂閱定的難度 */
  dc: number
  street: boolean
}

/** 四種現在各自開不開得出來、為什麼、難度與起始熱度（內容篩選關掉了那一種的標籤就不列；預設沒有種類帶標籤，不受任何開關影響）。 */
export function slotOptions(k: Kernel, state: GameState): SlotOption[] {
  const rules = liveRules(k)
  const slot = rules.slot
  const common = commonBlocks(k, state, `commit:${START_ACTION}`)
  const dc = dcFor(slotDc(slot, meterOf(k, state, 'subs')), state.rules)
  // 內容篩選關掉了那一種的標籤，就不列（直接開仍被擋並寫原因）
  return SLOT_KINDS.filter((id) => tagsAllowed(state.rules, slot.kinds[id].tags)).map((id): SlotOption => {
    const reasons = [...common, ...kindBlocks(k, state, slot, id)]
    return {
      id, name: SLOT_KIND_NAME[id], can: reasons.length === 0, why: reasons[0] ?? null, reasons, skills: [...slot.kinds[id].skills], start_from: slot.kinds[id].start,
      start_heat: startHeat(k, state, rules, id, undefined).value, dc, street: slot.kinds[id].street,
    }
  })
}

// ---- 一場的規劃 ----

export interface SlotInput {
  kind: string
  hours: number
  /** 自訂的描述（選填）：原樣放進報告的 input，不影響任何數字 */
  text?: string
  /** 標籤與方向（選填，封閉清單）：由呼叫的人給，沒給就是預設 */
  plan?: { tags?: string[]; direction?: string }
  /** 選用哪個鏡頭（掛點 media.cameras 回的 id）；沒給就用預設：有第三人稱的用第一個第三人稱的，否則第一個 */
  camera?: string
}

interface RollPlan {
  parts: RollPart[]
  bonus: number
  dc: number
  dc_parts: Array<{ label: string; value: number }>
  skill: string
  attr: AttrId
  gear: number
}

interface Plan {
  blocks: string[]
  rules: LiveRules
  kind: SlotKind | null
  hours: number | null
  tags: string[]
  direction: SlotDirection | undefined
  mods: DirectionMods
  roll: RollPlan | null
  start: { value: number; parts: Array<{ label: string; value: number }> } | null
  cameras: CameraChoice[]
  camera: CameraChoice | null
  /** 第一人稱的成人種類：總熱度 +first_person.adult_heat（其餘是 0） */
  fp_heat: number
}

const TAG_LIST = SLOT_TAGS.map((t) => SLOT_TAG_NAME[t]).join('、')
const DIR_LIST = SLOT_DIRECTIONS.map((d) => SLOT_DIRECTION_NAME[d]).join('、')

/** plan 的格式：標籤最多兩個、都要在清單裡，方向要在清單裡。 */
function planProblems(raw: unknown): { tags: string[]; direction: SlotDirection | undefined; blocks: string[] } {
  const blocks: string[] = []
  let tags: string[] = []
  let direction: SlotDirection | undefined
  if (raw === undefined || raw === null) return { tags, direction, blocks }
  if (!isRecord(raw)) return { tags, direction, blocks: ['自訂的標籤與方向要寫成 { tags, direction } 的樣子。'] }
  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string')) blocks.push('標籤要是清單裡的名字（一個一個列出來）。')
    else {
      const list = [...new Set(raw.tags as string[])]
      for (const t of list) if (!(SLOT_TAGS as readonly string[]).includes(t)) blocks.push(`「${t}」不是標籤清單裡的（可以選：${TAG_LIST}）。`)
      if (list.length > SLOT_MAX_TAGS) blocks.push(`標籤最多選 ${SLOT_MAX_TAGS} 個，你選了 ${list.length} 個。`)
      tags = list
    }
  }
  if (raw.direction !== undefined && raw.direction !== null) {
    if (typeof raw.direction === 'string' && (SLOT_DIRECTIONS as readonly string[]).includes(raw.direction)) direction = raw.direction as SlotDirection
    else blocks.push(`「${String(raw.direction)}」不是表演方向的清單裡的（可以選：${DIR_LIST}）。`)
  }
  return { tags: blocks.length > 0 ? [] : tags, direction: blocks.length > 0 ? undefined : direction, blocks }
}

function planSlot(k: Kernel, state: GameState, input: SlotInput): Plan {
  const rules = liveRules(k)
  const slot = rules.slot
  const blocks = commonBlocks(k, state, `commit:${START_ACTION}`)
  const cam = cameraPlan(k, state, input?.camera)
  blocks.push(...cam.blocks)
  const kind = (SLOT_KINDS as readonly string[]).includes(input?.kind) ? (input.kind as SlotKind) : null
  if (!kind) blocks.push(`沒有「${String(input?.kind)}」這種時段直播（可以選：${SLOT_KINDS.map((x) => SLOT_KIND_NAME[x]).join('、')}）。`)
  const hours = (SLOT_HOURS as readonly number[]).includes(input?.hours) ? input.hours : null
  if (hours === null) blocks.push('時段直播要播 1、2 或 3 個小時。')
  if (kind) blocks.push(...kindBlocks(k, state, slot, kind))
  const p = planProblems(input?.plan)
  blocks.push(...p.blocks)
  const mods = directionMods(slot, p.direction)
  const base: Plan = { blocks, rules, kind, hours, tags: p.tags, direction: p.direction, mods, roll: null, start: null, cameras: cam.list, camera: cam.chosen, fp_heat: cam.first_person && kind === 'adult' ? rules.first_person.adult_heat : 0 }
  if (!kind) return base

  const start = startHeat(k, state, rules, kind, p.direction)
  const subs = meterOf(k, state, 'subs')
  const raw = slotDc(slot, subs)
  const dc = dcFor(raw, state.rules)
  const dcParts = [{ label: `訂閱 ${subs.toLocaleString('en-US')} 的基礎難度`, value: raw }]
  if (dc !== raw) dcParts.push({ label: '難度設定', value: dc - raw })
  if (!state.pc || !state.actors[state.pc]) return { ...base, start }

  // 這一種的基本功裡較高的一項（屬性的調整值加基本功等級）
  const pc = state.pc as ActorId
  const sums = slot.kinds[kind].skills.map((s) => ({ s, attr: skillAttr(k, s), sum: checkParts(k.stats, state, pc, { attr: skillAttr(k, s), skill: s, tags: ['live', kind] }).reduce((a, x) => a + x.value, 0) }))
  const best = sums.reduce((a, b) => (b.sum > a.sum ? b : a))
  const situation: RollPart[] = []
  if (mods.check !== 0) situation.push({ label: `方向：${SLOT_DIRECTION_NAME[p.direction!]}`, value: mods.check, source: 'situation' })
  const gear = gearOf(k, state, slot)
  if (gear !== 0) situation.push({ label: '設備', value: gear, source: 'situation' })
  const parts = checkParts(k.stats, state, pc, { attr: best.attr, skill: best.s, tags: ['live', kind] }, situation)
  return { ...base, start, roll: { parts, bonus: parts.reduce((a, x) => a + x.value, 0), dc, dc_parts: dcParts, skill: best.s, attr: best.attr, gear } }
}

/** 1d20 每一面 5%：四種結果各自的機率（百分比整數，加起來 100），和實際擲出來的是同一套 computeDegree。 */
export function slotChances(bonus: number, dc: number): Record<SlotResult, number> {
  const out: Record<SlotResult, number> = { fumble: 0, fail: 0, success: 0, critical: 0 }
  for (let natural = 1; natural <= 20; natural++) out[computeDegree(natural, natural + bonus, dc)] += 5
  return out
}

// ---- 預覽 ----

export interface SlotPreview {
  ok: boolean
  blocks: string[]
  kind: { id: SlotKind; name: string } | null
  hours: number | null
  tags: string[]
  direction: SlotDirection | undefined
  /** 檢定：每一項、合計、難度（含每一項怎麼來）、用的基本功 */
  roll: RollPlan | null
  /** 起始熱度與每一項 */
  start: { value: number; parts: Array<{ label: string; value: number }> } | null
  /** 這一場熱度的上限（穩著播是 6） */
  cap: number
  /** 四種結果的機率（百分比，加起來 100）；沒有算式是 null */
  chance: Record<SlotResult, number> | null
  /** 四種結果各自換的熱度（檢定那一項）與總熱度 */
  gain: Record<SlotResult, number>
  heat: Record<SlotResult, number> | null
  /** 這一場花幾分鐘（開播推進一半、收播另一半） */
  minutes: { start: number; end: number } | null
  text_max: number
  /** 隊上現在有的鏡頭與選用的那一個（沒裝 media 是空的）：視角就是這場直播的視角 */
  cameras: CameraChoice[]
  camera: CameraChoice | null
  /** 只用主角自己的錄影義體開播：第一人稱直播（成人種類總熱度 +1；一般內容收播的訂閱 ×0.8） */
  first_person: boolean
}

/** 開播之前先看（純函式，不改狀態）。 */
export function slotPreview(k: Kernel, state: GameState, input: SlotInput): SlotPreview {
  const p = planSlot(k, state, input)
  const slot = p.rules.slot
  const ready = p.kind !== null && p.hours !== null && p.roll !== null && p.start !== null
  return {
    ok: p.blocks.length === 0, blocks: [...p.blocks], kind: p.kind ? { id: p.kind, name: SLOT_KIND_NAME[p.kind] } : null, hours: p.hours, tags: [...p.tags], direction: p.direction,
    roll: p.roll, start: p.start, cap: p.mods.cap, chance: ready ? slotChances(p.roll!.bonus, p.roll!.dc) : null, gain: { ...slot.gain },
    heat: ready ? (Object.fromEntries(SLOT_RESULTS.map((r) => [r, totalHeat(slot, p.mods, p.start!.value, r, p.hours!, p.fp_heat)])) as Record<SlotResult, number>) : null,
    minutes: p.hours !== null ? { start: Math.floor((p.hours * 60) / 2), end: p.hours * 60 - Math.floor((p.hours * 60) / 2) } : null, text_max: slot.text_max,
    cameras: p.cameras, camera: p.camera, first_person: p.camera?.first_person === true,
  }
}

// ---- 開播 ----

const START_LINE: Record<SlotResult, string> = { fumble: '一開場就冷場了。', fail: '反應平平。', success: '氣氛不錯。', critical: '一下子就熱起來了。' }

/**
 * 開播：擲一次表演檢定（1d20 ＋ 較高的基本功 ＋ 方向 ＋ 設備，對訂閱定的難度）、推進一半的時間、帶觸發點 live_mid（where：種類、標籤、區、設施的種類）。
 * 不成立丟 ActionBlocked（原因一條一句，接在一起）。報告 live.start（kind broadcast）；text 原樣放進報告的 input。
 */
export function slotStart(k: Kernel, state: GameState, input: SlotInput): ReportDraft {
  const p = planSlot(k, state, input)
  if (p.blocks.length > 0 || !p.kind || p.hours === null || !p.roll || !p.start || !state.pc) throw new ActionBlocked(p.blocks.join('') || '現在開不了時段直播。')
  const slot = p.rules.slot
  const kind = p.kind
  const hours = p.hours
  const natural = deriveRng(state.rng, `${START_ACTION}/${kind}`).int(1, 20)
  const roll = makeCheck({ natural, parts: p.roll.parts, dc: p.roll.dc, attr: p.roll.attr, skill: p.roll.skill })
  const result = roll.degree as SlotResult
  const heat = totalHeat(slot, p.mods, p.start.value, result, hours, p.fp_heat)
  const half = Math.floor((hours * 60) / 2)
  const id = `lv${readLive(state).seq + 1}`
  const session: Session = {
    id, mode: 'slot', template: SLOT_TEMPLATE, by: state.pc, where: clone(state.location), heat, goals: [], highlights: [], counts: {}, from: {},
    tips: heat * p.rules.heat_tips, kind, hours, plan: { tags: [...p.tags], ...(p.direction ? { direction: p.direction } : {}) },
    roll: { natural, total: roll.total, dc: roll.dc, degree: roll.degree, gain: slot.gain[result] }, cap: p.mods.cap, half_done: true,
    ...(p.camera ? { camera: { ...p.camera } } : {}),
  }

  const text = typeof input.text === 'string' ? input.text : undefined
  const clamps: ClampNote[] = []
  let shown = text
  if (text !== undefined && len(text) > slot.text_max) {
    shown = Array.from(text).slice(0, slot.text_max).join('')
    clamps.push({ path: 'input', from: len(text), to: slot.text_max, limit: slot.text_max, notice: `自訂的描述最多 ${slot.text_max} 個字，多的沒有收。` })
  }
  const name = `${SLOT_KIND_NAME[kind]}時段直播`
  const line = `你開了一場${name}（${hours} 小時）。${START_LINE[result]}`
  const where: Record<string, unknown> = { kind, tags: [...p.tags], ...(state.location.district ? { district: state.location.district } : {}), ...(state.location.facility ? { facility: state.location.facility } : {}) }
  return {
    kind: 'broadcast', action: START_ACTION, location: clone(state.location), actor: state.pc, party: [],
    ...(shown !== undefined && shown.length > 0 ? { input: shown } : {}),
    timeline: [{
      layer: 'meat', actor: state.pc, text: line, roll, tag: 'live.start',
      data: { id, mode: 'slot', kind, hours, plan: session.plan, heat, cap: session.cap, start_heat: p.start.value, gain: slot.gain[result], degree: roll.degree, minutes: half,
        ...(p.camera ? { camera: p.camera.id, pov: p.camera.pov, first_person: p.camera.first_person } : {}),
      },
    }],
    changes: [{ op: 'live.open', session }, { op: 'time', minutes: half }, { op: 'rng', advance: 1 }],
    outcome: { result: roll.degree, summary: line },
    narration: { results: [`你開了一場${name}。${START_LINE[result]}`] },
    ...(clamps.length > 0 ? { clamps } : {}),
    triggers: [{ point: LIVE_MID, where }],
  }
}

// ---- 收播 ----

/** 收播擋下的原因（成立是 null）：沒有在直播、是掛在活動上的、有事件視窗（或別的活動）開著。 */
export function slotEndBlock(k: Kernel, state: GameState): string | null {
  const s = liveSession(state)
  if (!s) return '現在沒有在直播。'
  if (s.mode !== 'slot') return '這是掛在活動上的直播：要把那場活動做完，或提早收播。'
  return otherActivityBlock(k, state, `commit:${END_ACTION}`)
}

/** 這一份收播的報告用 week 記一次，還是交給頻道聽 activity.end 去記（頻道的 activity.end 已經記一次；再發 aired 會記兩次）。 */
const weekCounted = (k: Kernel): boolean => (k.hooks.owners as unknown as (n: string) => string[]).call(k.hooks, 'activity.end').includes('channel')

/**
 * 收播（沒有事件視窗開著時才做得了）：推進另一半的時間，熱度換成訂閱與打賞（V25；冷門題材訂閱 ×1.2）、請 media 記一則（成人種類記親密、其餘日常；live、hq）、
 * 成人種類這一區的豔名 +1（效果 fame）、這一週算開過（效果 aired）、發 activity.end（種類 live）。報告 live.end，裡面有一拍 tag: 'live.end'。
 */
export function slotEnd(k: Kernel, state: GameState): ReportDraft {
  const block = slotEndBlock(k, state)
  if (block) throw new ActionBlocked(block)
  const s = liveSession(state)!
  const slot = liveRules(k).slot
  const minutes = (s.hours ?? 1) * 60
  const rest = minutes - Math.floor(minutes / 2)
  const st = settleSession(k, state, s, { outcome: 'done', early: false, lost: false, numbers: { ...state, time: addMinutes(state.time, rest) } })
  const e = st.entry

  const fx: Effect[] = []
  if (s.kind === 'adult' && slot.fame_gain > 0 && k.effects.has('fame')) fx.push({ kind: 'fame', amount: slot.fame_gain })
  if (k.effects.has('aired') && !weekCounted(k)) fx.push({ kind: 'aired', what: 'live' })
  const resolved = fx.length > 0 ? k.effects.resolve(fx, effectCtx(k, state, { source: 'builtin' })) : null
  const extra: Change[] = resolved && resolved.errors.length === 0 ? resolved.changes : []

  const name = `${SLOT_KIND_NAME[s.kind ?? 'chat']}時段直播`
  const text = `你收了${name}：熱度 ${e.heat}，觀看 ${st.viewers.viewers}，訂閱 ${signed(e.subs)}，打賞 ${e.tips}。`
  const lines = [...st.lines]
  if (s.kind === 'adult' && extra.length > 0) lines.push('你的豔名又傳開了一些。')
  return {
    kind: 'broadcast', action: END_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{
      layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text, tag: 'live.end',
      data: { id: e.id, mode: 'slot', kind: s.kind, hours: s.hours, heat: e.heat, goals: [], goals_done: 0, viewers: st.viewers.viewers, subs: e.subs, tips: e.tips, tier: st.viewers.tier },
    }],
    changes: [{ op: 'time', minutes: rest }, ...st.changes, ...extra, st.close],
    outcome: { result: 'done', summary: text },
    narration: { results: lines },
  }
}

/** 這一場現在的總熱度怎麼來的（給畫面的說明用；沒有在直播是 null）。 */
export function slotNow(k: Kernel, state: GameState): { heat: number; cap: number; viewers: number } | null {
  const s = liveSession(state)
  if (!s || s.mode !== 'slot') return null
  const v = viewersFrom(liveRules(k), meterOf(k, state, 'subs'), s.heat)
  return { heat: s.heat, cap: s.cap ?? s.heat, viewers: v.viewers }
}
