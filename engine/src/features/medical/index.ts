// L6 功能：醫療（急救、診所治療、重的重創在戰鬥外的效果與手術、戰地手術處理重創；DOWNTIME 2.2 節、3.1 節；COMBAT_SYSTEM 第 6 節；TRADE 3.4 節；
// SKILL_TREES 改造師「戰地手術」「全面翻修」與日常的「手術」；dev/adr/0013 D3；dev/adr/0019 第五節與 P46；dev/work/M4-medical.md）。
//
// 接上核心的地方：
//   內容  medical_rule（規則表，overridable；id: default）：急救、診所的單價、重創的價錢與休養、重創的被動效果（照 P46）、treated 的期限、自己動刀的條件（model.ts 的 DEFAULT_MEDICAL_RULES）；
//         設施種類（world 的 facility_type）讀 clinic: { grade: 'clinic' | 'unlicensed' | 'black' }（和 cyberware 讀同一欄；載入之後 ready 檢查格式）
//   被動  k.passives.register 來源 wound：身上有 wound_limb、wound_head、wound_torso 給 wound_effects 那一組；wound_recovering 給 recovery_effects
//   效果  wound_heal { part? }（把重的重創拿掉；沒寫部位是全部）、treated（掛上 treated）：都 ai: false，只有內建的來源能用（事件的病床、帶傷來躲的人）
//   戰鬥  效果 op wound_treat { who, all? }（戰地手術、全面翻修的現實欄用；只在現實的戰場）
//   掛鉤  report.after：一份報告裡有誰的生命值往下（actor.track hp 的 delta 是負的），就接一份報告把他的 aided 與 treated 拿掉（戰鬥結束的那一份也算；medical 自己的報告不算）
//   條件  用到別人登記的：at_facility（站在哪種診所）、at_home（住處）、ability（自己動刀；沒有人登記就沒有自己動刀）
//   狀況  角色身上共用的字彙：treated（傷口處理過；rest 在讀）、aided（這一次受傷已經急救過）、wound_recovering（重創手術後休養中）；wound_* 是 combat 在戰鬥結束時給的
// 讀的：k.stats（max_hp、armor_body 只經由被動效果；檢定用 checkParts）、k.content（facility_type、item 的 tags）、k.activity.blockOf、actor.conditions。沒有 ext 狀態。
// 報告（kind action）：medical.aid、medical.heal、medical.surgery、medical.reinjured（aided 與 treated 被拿掉的那一份）。
// 對外：aidBlock／aidProblems／aidQuote／aidDraft、clinicQuote／clinicBlock／clinicProblems／clinicHealDraft、woundsOf、woundSurgeryBlock／woundSurgeryProblems／woundSurgeryQuote／woundSurgeryDraft、medicalView、medicalRules。
// 沒有做：義體的修理（cyberware 的）、沉溺與成癮的治療、天使急救；「肢體接回還是直接換義肢」的選擇（TRADE 3.4 節）；treated 的一天是暫定。

import type { ContentEntry, Effect, EffectStepCtx, Feature, Kernel, ReportDraft } from '../../core'
import { ContentError, clone, isRecord, passiveProblems } from '../../core'
import { installBattle } from './battle'
import { woundPassives } from './passive'
import {
  AIDED, CLINIC_GRADES, FACILITY_TYPE_KIND, OWNER, RULE_KIND, TREATED, WOUND_NAME, WOUND_PARTS, hasCond, isWoundPart, medicalRules, nowOf, ruleProblems, woundCondition,
} from './model'
import type { WoundPart } from './model'

export { AID_ACTION, aidBlock, aidDraft, aidProblems, aidQuote } from './aid'
export type { AidOpts, AidQuote } from './aid'
export { HEAL_ACTION, clinicBlock, clinicHealDraft, clinicProblems, clinicQuote } from './clinic'
export type { ClinicOpts, ClinicQuote } from './clinic'
export { SURGERY_ACTION, isWoundVia, woundSurgeryBlock, woundSurgeryDraft, woundSurgeryProblems, woundSurgeryQuote } from './surgery'
export type { WoundSurgeryOpts, WoundSurgeryQuote, WoundVia } from './surgery'
export { WOUND_TREAT_OP } from './battle'
export { clinicHere, selfListed } from './common'
export { medicalView } from './view'
export type { MedicalView, ViewMember, ViewSurgeryOption, ViewWound } from './view'
export {
  AIDED, CLINIC_GRADES, CLINIC_NAME, DEFAULT_MEDICAL_RULES, PHYSICAL_ATTRS, TREATED, WOUND_NAME, WOUND_PARTS, WOUND_RECOVERING, hasCond, isWoundPart, maxHpOf, medicalRules, woundCondition, woundsOf,
} from './model'
export type { AidRule, ClinicGrade, MedicalRules, WoundPart } from './model'

export const REINJURED_ACTION = 'medical.reinjured'
interface WoundHealEffect extends Effect { kind: 'wound_heal'; part?: WoundPart }
interface TreatedEffect extends Effect { kind: 'treated' }

export const medicalFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 被動效果：重的重創與手術後的休養
    k.passives.register(OWNER, 'wound', (state, actor) => woundPassives(k, state, actor), '傷勢')

    // 效果 wound_heal：把重的重創拿掉（沒寫部位是全部）；身上沒有就落空
    const presentParts = (e: WoundHealEffect, ctx: EffectStepCtx): WoundPart[] => (e.part ? [e.part] : [...WOUND_PARTS]).filter((p) => hasCond(ctx.state, ctx.actor, woundCondition(p)))
    k.effects.register<WoundHealEffect>({
      kind: 'wound_heal', owner: OWNER, ai: false,
      validate: (raw) => (raw.part === undefined || isWoundPart(raw.part) ? [] : [`part 要是 ${WOUND_PARTS.join('、')} 其中一個`]),
      clamp: (e, ctx) => (presentParts(e, ctx).length > 0 ? { effect: e } : { effect: null, note: { from: e.part ?? 'all', to: null, limit: 'wound_heal', notice: '身上沒有那種重創，這一筆沒有算。' } }),
      toChanges: (e, ctx) => presentParts(e, ctx).map((p) => ({ op: 'actor.condition', id: ctx.actor, condition: woundCondition(p), remove: true })),
      describe: (e, ctx) => `重創處理好了：${presentParts(e, ctx).map((p) => WOUND_NAME[p]).join('、') || '沒有'}`,
    })

    // 效果 treated：掛上「傷口處理過」（期限照規則表 treated_minutes）
    k.effects.register<TreatedEffect>({
      kind: 'treated', owner: OWNER, ai: false,
      validate: () => [],
      toChanges: (_e, ctx) => [{ op: 'actor.condition', id: ctx.actor, condition: TREATED, until: nowOf(ctx.state) + medicalRules(k).treated_minutes }],
      describe: () => '傷口處理過了',
    })

    // 再受傷（生命往下）的時候，急救過與處理過的記號就沒有了：戰鬥結束的那一份也算
    k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
      if (report.action?.startsWith('medical.')) return
      const hurt = new Set<string>()
      for (const c of report.changes) {
        const t = c as { op: string; id?: unknown; track?: unknown; delta?: unknown }
        if (t.op === 'actor.track' && t.track === 'hp' && typeof t.id === 'string' && typeof t.delta === 'number' && t.delta < 0) hurt.add(t.id)
      }
      const changes: ReportDraft['changes'] = []
      const names: string[] = []
      for (const id of hurt) {
        const a = state.actors[id]
        if (!a) continue
        let any = false
        for (const cond of [AIDED, TREATED]) {
          if (a.conditions.some((c) => c.id === cond)) {
            changes.push({ op: 'actor.condition', id, condition: cond, remove: true })
            any = true
          }
        }
        if (any) names.push(a.name)
      }
      if (changes.length === 0) return
      const text = `${names.join('、')}又受了傷，先前的急救與處理都不算數了。`
      return [{
        kind: 'action', action: REINJURED_ACTION, location: clone(state.location), party: [], timeline: [{ layer: 'meat', text, tag: REINJURED_ACTION }], changes,
        outcome: { result: 'reinjured', summary: text }, narration: { results: [text] },
      }]
    })

    // 戰地手術處理重創：戰鬥的效果 op wound_treat
    installBattle(k)
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { clinic?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.clinic === undefined) continue
        const c = t.clinic
        if (!isRecord(c) || !(CLINIC_GRADES as readonly unknown[]).includes(c.grade)) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：clinic 要是 { grade: ${CLINIC_GRADES.join(' | ')} }`)
      }
    }
    // 規則表裡的被動效果：格式照被動效果查（條件種類要等功能都裝好才查得出，所以在這裡）
    const rules = medicalRules(k)
    for (const [id, list] of Object.entries(rules.wound_effects)) problems.push(...passiveProblems(k, list, `wound_effects.${id}`).map((m) => `${RULE_KIND}/default：${m}`))
    problems.push(...passiveProblems(k, rules.recovery_effects, 'recovery_effects').map((m) => `${RULE_KIND}/default：${m}`))
    if (problems.length > 0) throw new ContentError(problems)
  },
}

export { OWNER as MEDICAL_OWNER, RULE_KIND as MEDICAL_RULE_KIND }
