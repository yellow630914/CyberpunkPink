// L6 功能：未登錄零件（CRAFTING 11.1 節；AI_TASKS 3.20 節第 1、4、6 步；dev/adr/0019 第十七節與 P66～P68、P74、P75；dev/work/M4-part-unreg.md）。
//
// 沒有上市、沒有登記、世界上只有一件的零件，是報酬的一種。引擎定框架（哪一格、材質、等級、牌子、屬性的點數預算、怪癖），AI 只在框架裡寫三段字（M4-core-part-ai）；
// 框架在加進「等著交貨」的那一刻就定了，預設清單的文字也同時抽好。交貨（deliverDraft）才把零件放進背包：有驗過的文字就用，沒有就用預設的。
// 拿到手的是一件內嵌的零件（核心的 InlinePart，整筆住在狀態裡；背包裡是 UNREG_STACK_ID 那一疊）：可以裝、可以拆、可以賣。
// 四個來源的入口（委託的報酬、訂做、勢力的窗口、口頭要到）是 M4-part-sources；這一張只收效果 part_unreg 與它的 source 參數。
//
// 接上核心的地方：
//   內容  unreg_rule（規則表，overridable；id: default；DEFAULT_UNREG_RULES）、unreg_preset（預設清單：type、grade?、material?、name、desc、quirk_text?）；
//         讀核心的 part、quirk（kind 是 quirk、pool 含 doujin、tags 沒被篩選關掉、applies 對得上這種零件用在哪幾種成品）、勢力（查牌子的名字，有就用）
//   效果  part_unreg { source?, type?, material?, grade?, brand?, want?, quirk?, from?, request?, hold?, ready_minutes?, once?, once_note? }（內建的來源才收，ai: false）
//   變更  unreg.pending（add 帶 spec：流水號、框架、預設文字在套用的那一刻才定；remove 帶 id）、unreg.once { id }、unreg.name { name }
//   狀態  state.ext.unreg = { seq, pending: Pending[], names: string[], once: string[] }（只經由這三個變更寫）
// 報告（kind action）：unreg.deliver；outcome 帶整筆零件（part）。
// 對外：unregFeature、DEFAULT_UNREG_RULES、unregRules、unregRuleProblems、frameOf、frameProblems、pendingParts、readyParts、frameView、textProblems、deliverBlock、deliverDraft。
// 這個功能不做：呼叫 AI（外殼）、四個來源的入口、橋的零件（P75）、V 級。

import type { Change, ContentEntry, Effect, EffectCtx, EffectStepCtx, Feature, Kernel } from '../../core'
import { ContentError, isRecord, isSafeInt, toMinutes } from '../../core'
import type { FrameSpec } from './frame'
import { specProblems } from './frame'
import type { PendingSpec } from './pending'
import { makePending } from './pending'
import type { PresetEntry } from './model'
import {
  MATERIALS, MAX_GRADE, NAME_OP, ONCE_OP, OWNER, PART_EFFECT, PENDING_OP, PRESET_KIND, REQUEST_MAX, ROMAN, RULE_KIND, SOURCES, presetProblems, typeName, unregOf, unregRuleProblems, unregRules, writeUnreg,
} from './model'

export { DEFAULT_UNREG_RULES, DELIVER_ACTION, PART_EFFECT as UNREG_PART_EFFECT, RULE_KIND as UNREG_RULE_KIND, PRESET_KIND as UNREG_PRESET_KIND, OWNER as UNREG_OWNER, SOURCES as UNREG_SOURCES, UID_PREFIX as UNREG_UID_PREFIX, gradeCap, unregOf, unregRuleProblems, unregRules } from './model'
export type { Frame, Pending, PresetEntry, PresetText, UnregOption, UnregRules, UnregState, UnregType } from './model'
export { frameOf, frameProblems, quirkCandidates, refundOf, specProblems } from './frame'
export type { FrameSpec } from './frame'
export { deliverBlock, deliverDraft, frameView, makePending, pendingParts, readyParts, textProblems } from './pending'
export type { FrameView, PendingSpec, UnregText } from './pending'

interface PartUnregEffect extends Effect, FrameSpec {
  from?: string
  request?: string
  hold?: 'order'
  ready_minutes?: number
  once?: string
  once_note?: string
}

type PendingChange = Change & { add?: PendingSpec; remove?: string }
type OnceChange = Change & { id: string }
type NameChange = Change & { name: string }

const DEFAULT_ONCE_NOTE = '這一件已經拿過了。'
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 效果的參數（與變更 add 的 spec）的格式檢查。 */
function paramProblems(k: Pick<Kernel, 'content'>, raw: Record<string, unknown>): string[] {
  const p: string[] = []
  if (raw.source !== undefined && !(SOURCES as readonly unknown[]).includes(raw.source)) p.push(`source 只能是 ${SOURCES.join('、')}。`)
  if (raw.type !== undefined && !isText(raw.type)) p.push('type 要是零件類型的 id。')
  if (raw.material !== undefined && !(MATERIALS as readonly unknown[]).includes(raw.material)) p.push('material 只能是 mech 或 bio。')
  if (raw.grade !== undefined && !(isSafeInt(raw.grade) && raw.grade >= 1 && raw.grade <= MAX_GRADE)) p.push(`grade 要是 1～${MAX_GRADE} 的整數（未登錄零件沒有 V 級）。`)
  if (raw.brand !== undefined && !isText(raw.brand)) p.push('brand 要是牌子的 id。')
  if (raw.want !== undefined && !(Array.isArray(raw.want) && raw.want.length <= 12 && raw.want.every(isText))) p.push('want 要是字串的陣列（指選項的 id 或 tags，最多 12 個）。')
  if (raw.quirk !== undefined && !(isText(raw.quirk) && k.content.has('quirk', raw.quirk))) p.push('quirk 要是查得到的怪癖 id。')
  if (raw.from !== undefined && typeof raw.from !== 'string') p.push('from 要是文字。')
  if (raw.request !== undefined && !(typeof raw.request === 'string' && [...raw.request].length <= REQUEST_MAX)) p.push(`request 要是 ${REQUEST_MAX} 字以內的文字。`)
  if (raw.hold !== undefined && raw.hold !== 'order') p.push('hold 只能是 order。')
  if (raw.once !== undefined && !isText(raw.once)) p.push('once 要是非空的字串。')
  if (raw.once_note !== undefined && typeof raw.once_note !== 'string') p.push('once_note 要是文字。')
  if (raw.ready_minutes !== undefined && !(isSafeInt(raw.ready_minutes) && raw.ready_minutes >= 0)) p.push('ready_minutes 要是 0 以上的整數（分鐘）。')
  if (p.length === 0) p.push(...specProblems(k, { ...(raw as FrameSpec) }))
  return p
}

export const unregFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: unregRuleProblems })
    k.content.defineKind<PresetEntry>({ kind: PRESET_KIND, owner: OWNER, validate: presetProblems })

    // ---- 變更 ----
    k.changes.register<PendingChange>({
      op: PENDING_OP, owner: OWNER,
      validate(s, c) {
        const hasAdd = c.add !== undefined
        const hasRemove = c.remove !== undefined
        if (hasAdd === hasRemove) return ['add 與 remove 要寫其中一個。']
        if (hasRemove) return unregOf(s).pending.some((p) => p.id === c.remove) ? [] : [`沒有 ${String(c.remove)} 這一件等著交貨的零件。`]
        if (!isRecord(c.add)) return ['add 要是一份 spec。']
        const p = paramProblems(k, c.add as Record<string, unknown>)
        if (c.add.ready_at !== undefined && !isSafeInt(c.add.ready_at)) p.push('ready_at 要是整數（分鐘）。')
        return p
      },
      apply(s, c) {
        const u = unregOf(s)
        if (c.remove !== undefined) {
          u.pending = u.pending.filter((p) => p.id !== c.remove)
        } else {
          const one = makePending(k, s, c.add!)
          u.seq += 1
          u.pending.push(one)
        }
        writeUnreg(s, u)
      },
      describe: (c) => (c.add ? '多了一件等著交貨的未登錄零件' : null),
    })
    k.changes.register<OnceChange>({
      op: ONCE_OP, owner: OWNER,
      validate: (_s, c) => (isText(c.id) ? [] : ['id 要是非空的字串。']),
      apply(s, c) {
        const u = unregOf(s)
        if (!u.once.includes(c.id)) u.once.push(c.id)
        writeUnreg(s, u)
      },
    })
    k.changes.register<NameChange>({
      op: NAME_OP, owner: OWNER,
      validate: (_s, c) => (isText(c.name) ? [] : ['name 要是非空的字串。']),
      apply(s, c) {
        const u = unregOf(s)
        if (!u.names.includes(c.name)) u.names.push(c.name)
        writeUnreg(s, u)
      },
    })

    // ---- 效果 part_unreg ----
    k.effects.register<PartUnregEffect>({
      kind: PART_EFFECT, owner: OWNER, ai: false,
      validate: (raw: Record<string, unknown>, _ctx: EffectCtx) => paramProblems(k, raw),
      clamp(e, ctx: EffectStepCtx) {
        if (e.once !== undefined && unregOf(ctx.state).once.includes(e.once)) {
          return { effect: null, note: { from: e.once, to: null, notice: e.once_note !== undefined && e.once_note !== '' ? e.once_note : DEFAULT_ONCE_NOTE } }
        }
        return { effect: e }
      },
      toChanges(e, ctx: EffectStepCtx) {
        if (e.once !== undefined && unregOf(ctx.state).once.includes(e.once)) return []
        const spec: PendingSpec = {
          source: e.source ?? 'gift',
          ...(e.type !== undefined ? { type: e.type } : {}), ...(e.material !== undefined ? { material: e.material } : {}), ...(e.grade !== undefined ? { grade: e.grade } : {}),
          ...(e.brand !== undefined ? { brand: e.brand } : {}), ...(e.want !== undefined ? { want: [...e.want] } : {}), ...(e.quirk !== undefined ? { quirk: e.quirk } : {}),
          ...(e.from !== undefined ? { from: e.from } : {}), ...(e.request !== undefined && e.request !== '' ? { request: e.request } : {}),
          ...(e.hold !== undefined ? { hold: e.hold } : {}),
          ...(e.ready_minutes !== undefined ? { ready_at: toMinutes(ctx.state.time) + e.ready_minutes } : {}),
        }
        const changes: Change[] = [{ op: PENDING_OP, add: spec }]
        if (e.once !== undefined) changes.push({ op: ONCE_OP, id: e.once })
        return changes
      },
      describe(e) {
        if (e.type !== undefined && e.grade !== undefined) return `一件未登錄零件（${typeName(unregRules(k), e.type)}，${ROMAN[e.grade] ?? e.grade}級），等著交貨。`
        return '一件未登錄零件，等著交貨。'
      },
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const rules = unregRules(k)
    const problems: string[] = []
    for (const e of k.content.list<PresetEntry & ContentEntry>(PRESET_KIND)) {
      if (typeof e.type === 'string' && !rules.types[e.type]) problems.push(`${PRESET_KIND}/${e.id}：type ${e.type} 不在 unreg_rule 的 types 裡`)
    }
    for (const [type, list] of Object.entries(rules.options)) {
      if (!rules.types[type]) problems.push(`${RULE_KIND}/default：options 的類型 ${type} 不在 types 裡`)
      else if (rules.types[type]!.bio === false && list.some((o) => o.material === 'bio')) problems.push(`${RULE_KIND}/default：${type} 沒有生體版，options 不能寫 material: bio`)
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
