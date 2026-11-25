// L6 功能：義體（身上的義體；CYBERWARE 第 1～3 節；CRAFTING 8.1、10.2 節；TRADE 3.4 節；DATA 7.1、3.4 節；dev/adr/0019 第三節與 P1～P6；dev/work/M4-cyberware.md）。
//
// 部位與槽、把一件成品裝上去與拆下來的手術（四種人動刀）、沉溺成本墊高沉溺的下限、義體的效果（被動效果，來源 cyber 與 quirk）、休養與併發症。
// 橋（換橋）、甲板、戰鬥、授權鎖是後面四張（M4-cyber-bridge、-deck、-battle、-lock）。生體件的成長、小手術（換零件）不在這裡。
//
// 接上核心的地方：
//   內容  cyber_rule（規則表，overridable；id: default）：槽數、四種人動刀的費用與併發症、休養、自己動刀的條件（model.ts 的 DEFAULT_CYBER_RULES）；
//         設施種類（world 的 facility_type）多讀 clinic: { grade: 'clinic' | 'unlicensed' | 'black' }（載入之後 ready 檢查格式）
//   數值  surgery_sink_pct（動刀的人讓沉溺成本加減百分之幾；基礎 0、夾在 −25～0；別的功能用 provider 或被動效果加）
//   被動  k.passives.register 來源 cyber（沉溺下限＋生效義體的 effects 與板材護甲）、quirk（身上義體帶著的怪癖的 effects）
//   條件  cyber { slot?, bp?, tag?, min? }（身上有幾件符合的，預設至少 1）；用到別人登記的：at_facility（站在哪種診所）、at_home（住處）、ability（自己動刀；沒有人登記就沒有自己動刀）
//   掛點  scene.body（features/scene 宣告）：現實層回答好了的義體的 scene_parts
//   狀態  actor.ext.cyber：{ pieces: CyberPiece[] }（形狀見 model.ts；只經由報告裡的 actor.ext 變更寫）；休養中掛角色狀況 recovering
// 報告（kind action）：cyber.install、cyber.remove。
// 對外：cyberOf、pieceSink、surgeons、installBlock／installProblems／installDraft／installQuote、removeBlock／removeProblems／removeDraft／removeQuote、cyberView。

import type { Condition, ConditionCtx, ContentEntry, Feature, GameState, Kernel } from '../../core'
import { ContentError, isRecord, isSafeInt } from '../../core'
import {
  CLINIC_GRADES, FACILITY_TYPE_KIND, OWNER, PART_IDS, RULE_KIND, baseSlot, blueprintEntry, cyberOf, ruleProblems,
} from './model'
import { cyberPassives, quirkPassives, sceneBody } from './passive'
import { SURGERY_STAT } from './surgery'

export { cyberOf, cyberRules, DEFAULT_CYBER_RULES, hasBridge, partIdOf, PART_IDS, PART_NAME, SURGEON_KINDS, SURGEON_NAME, isReady, isActive } from './model'
export type { CyberPiece, CyberRules, PartId, Side, SurgeonKind, SurgeonRule, CyberOff } from './model'
export {
  INSTALL_ACTION, REMOVE_ACTION, SURGERY_STAT, clinicHere, installBlock, installDraft, installProblems, installQuote, pieceSink, recoveryOf, removeBlock, removeDraft, removeProblems, removeQuote, selfListed, surgeons,
} from './surgery'
export type { InstallOpts, InstallQuote, RemoveOpts, RemoveQuote, SelfCheck, SurgeonOption } from './surgery'
export { cyberView, viewPiece } from './view'
export type { CyberView, PieceStatus, ViewPart, ViewPiece } from './view'
export { sceneBody } from './passive'

type CyberCondition = Condition & { slot?: string; bp?: string; tag?: string; min?: number }
const SLOT_WORDS: readonly string[] = [...PART_IDS, 'arm', 'leg']
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
/** 掛點 scene.body 是 features/scene 宣告的：這裡只認名字與格式，不 import（照 features/maze 掛 netrun.round 的做法）。 */
type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

export const cyberwareFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 動刀的人讓沉溺成本加減百分之幾：基礎 0，手術刀的樹階等別的功能經 provider 加（負的是減）；夾在 −25～0（CYBERWARE 2.1 節）
    k.stats.defineStat({ id: SURGERY_STAT, owner: OWNER, name: '手術的沉溺成本加減（％）', base: () => 0, min: -25, max: 0 })

    // 被動效果：沉溺的下限與義體的效果（cyber）、帶著的怪癖（quirk）
    k.passives.register(OWNER, 'cyber', (state, actor) => cyberPassives(k, state, actor), '義體')
    k.passives.register(OWNER, 'quirk', (state, actor) => quirkPassives(k, state, actor), '怪癖')

    // 條件 cyber：身上有幾件符合的
    k.conditions.register<CyberCondition>({
      kind: 'cyber', owner: OWNER,
      validate(raw) {
        const p: string[] = []
        if (raw.slot !== undefined && !(isText(raw.slot) && SLOT_WORDS.includes(raw.slot))) p.push(`slot 要是部位的 id（${SLOT_WORDS.join('、')}）`)
        if (raw.bp !== undefined && !isText(raw.bp)) p.push('bp 要是設計圖的 id')
        if (raw.tag !== undefined && !isText(raw.tag)) p.push('tag 要是設計圖 tags 裡的字')
        if (raw.min !== undefined && !(isSafeInt(raw.min) && raw.min >= 1)) p.push('min 要是 1 以上的整數')
        return p
      },
      test(c, { state, actor }: ConditionCtx) {
        const id = actor ?? state.pc
        if (!id || !state.actors[id]) return false
        const n = cyberOf(state, id).filter((piece) => {
          if (c.slot !== undefined && piece.slot !== c.slot && baseSlot(piece.slot) !== c.slot) return false
          if (c.bp !== undefined && piece.bp !== c.bp) return false
          if (c.tag !== undefined) {
            const tags = (blueprintEntry(k, piece.bp) as { tags?: unknown } | undefined)?.tags
            if (!Array.isArray(tags) || !tags.includes(c.tag)) return false
          }
          return true
        }).length
        return n >= (c.min ?? 1)
      },
    })

    // 場景問身體：只在現實層回答（內海用的是化身）
    const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
    on('scene.body', OWNER, (({ state, actor, layer }: { state: GameState; actor: string; layer: string }) => sceneBody(k, state, actor, layer)) as never)
  },

  ready(k) {
    const problems: string[] = []
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { clinic?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.clinic === undefined) continue
        const c = t.clinic
        if (!isRecord(c) || !(CLINIC_GRADES as readonly unknown[]).includes(c.grade)) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：clinic 要是 { grade: ${CLINIC_GRADES.join(' | ')} }`)
      }
    }
    if (problems.length) throw new ContentError(problems)
  },
}

export { OWNER as CYBERWARE_OWNER, RULE_KIND as CYBER_RULE_KIND }
