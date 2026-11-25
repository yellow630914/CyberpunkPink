// L6 功能：藥（戰鬥內外的使用、持續與副作用、成癮與戒斷、戒斷療程、抑制劑；ITEMS 第 4 節；DOWNTIME 3.4、3.5 節；CYBERWARE 第 2 節；LIFE 第 6 節；CRAFTING 5.5 節；
// dev/adr/0019 第五節與 P13、P20、P65；dev/work/M4-drugs.md）。只做機制，不寫任何一種藥的內容（藥是 item 的一件，類別 drug，多一個 drug 欄位）。
//
// 接上核心的地方：
//   內容  物品 item 的 drug 欄位（載入之後 ready 查格式：duration、effects、side、upkeep_load、instant、after、addiction、suppressant、eases_withdrawal、needs_bridge）；
//         drug_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_DRUG_RULES）；設施種類（world 的 facility_type）讀 detox: { free?: true }
//   狀態  actor.ext.drugs = { active: [{ id, until, battle? }], addiction: { 藥: { value, last, used_week } }, withdrawal: { 藥: { until, heavy } }, pending: [{ at, drug, kind }], suppressant?: { until?, rebound_until?, weekly? } }
//   被動  k.passives.register 來源 drug（生效中的藥的 effects 與 side、藥效過後的 after.effects、抑制劑的 sink_floor 與 sink_shown）、
//         來源 withdrawal（戒斷的懲罰、停藥反彈）；沒有橋的人吃 needs_bridge 的藥沒有效果；節奏資源（ap_regen、ram_regen）的 +1 上限由核心夾
//   條件  drug_active { id }、addicted { id?, min? }（預設依賴以上）；用到別人登記的：sunk（M4-sink；沒有人註冊當作不成立）、at_facility（戒斷療程的設施）
//   效果  drug { id }（當成吃了一劑，不扣物品）、addiction { id, amount }：都 ai: false，只有內建的來源能用（被下藥、藥的後遺症）
//   戰鬥  效果 op drug { item? }（物品 use.effects 用；藥泵 cyber_pump 也跑同一份）、修正（來源 drug）、turn.start（upkeep_load）、onEnd（寫回角色）：battle.ts
//   掛鉤  time.passed（藥效過了、週一消退、戒斷開始與結束）、rest.done（持續一場戰鬥的藥效結束）、report.after（休息拿掉的藥效補一份 drug.wear_off）、
//         bill.collect／bill.settled（抑制劑每週帳單；bills 宣告，這裡只認名字與格式）
// 讀的：k.content（item、facility_type）、k.conditions、k.effects、k.activity、核心的 item／cred／cash／time 變更。不讀別的功能的 ext。
// 報告（kind action，time.passed 與休息補的是 downtime）：drug.use、drug.detox、drug.wear_off（藥效過了、進入戒斷、戒斷結束、成癮消退）、drug.suppressant（開關每週帳單付抑制劑）。
// 對外：useBlock／useProblems／useDraft、drugView、detoxBlock／detoxProblems／detoxQuote／detoxDraft、suppressantBlock／suppressantDraft、drugRules、drugDef、readDrugs、addictionOf。
// 沒做：藥泵（cyberware 的）、對別人用的藥（諦聽、睡蓮）、止痛劑的「生命值只看得到四段」與「高一段」這類顯示效果、牆灰的 10% 妖精的吻（要 malware 效果）、藥的內容；
//       戒斷療程的價錢還沒有乘區的倍率。

import type { ContentEntry, Feature, GameState, Kernel, ReportDraft } from '../../core'
import { ContentError, blankState, isRecord, passiveProblems } from '../../core'
import { installBills } from './bill'
import { installBattle } from './battle'
import { registerEffects } from './dose'
import { drugPassives, hideOf, withdrawalPassives } from './passive'
import { FACILITY_TYPE_KIND, ITEM_KIND, OWNER, RULE_KIND, drugProblems, drugRules, liveDrugs, readDrugs, ruleProblems } from './model'
import { noticeDrafts, restDone, timePassed } from './time'

export { detoxBlock, detoxDraft, detoxHere, detoxProblems, detoxQuote } from './detox'
export type { DetoxOpts, DetoxQuote } from './detox'
export { addictionOf, doseResult, resolveEffects, useBlock, useDraft, useProblems } from './dose'
export type { AddictionEffect, DoseOpts, DoseResult, DoseSpec, DrugEffect, UseOpts } from './dose'
export { suppressantBlock, suppressantDraft } from './bill'
export type { SuppressantOpts } from './bill'
export { drugView } from './view'
export type { DrugView, ViewActive, ViewAddiction, ViewUsable } from './view'
export { drugPassives, scaledWithdrawal, withdrawalPassives } from './passive'
export { unitDrugs } from './battle'
export type { UnitDrugs } from './battle'
export {
  DEFAULT_DRUG_RULES, DETOX_ACTION, DRUG_OP, EXT as DRUGS_EXT, RULE_KIND as DRUG_RULE_KIND, SUPPRESSANT_ACTION, SUPPRESSANT_BILL_ID, USE_ACTION, WEAR_OFF_ACTION,
  blankDrugs, drugDef, drugIds, drugRules, isLive, liveDrugs, readDrugs, writeDrugs,
} from './model'
export type { ActiveDrug, AddictionRow, DrugDef, DrugRules, DrugsExt, PendingRow, SuppressantRow, WithdrawalRow } from './model'

export const drugsFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // ---- 被動效果 ----
    k.passives.register(OWNER, 'drug', (state, actor) => drugPassives(k, state, actor), '藥物')
    k.passives.register(OWNER, 'withdrawal', (state, actor) => withdrawalPassives(k, state, actor), '戒斷')

    // ---- 條件 ----
    k.conditions.register<{ kind: string; id: string }>({
      kind: 'drug_active', owner: OWNER,
      validate: (raw) => (typeof raw.id === 'string' && raw.id.trim() ? [] : ['id 要是藥的 id（物品）']),
      test: (c, { state, actor }) => {
        const who = actor ?? state.pc
        return !!who && !!state.actors[who] && liveDrugs(state, who).includes(c.id)
      },
    })
    k.conditions.register<{ kind: string; id?: string; min?: number }>({
      kind: 'addicted', owner: OWNER,
      validate: (raw) => [
        ...(raw.id === undefined || (typeof raw.id === 'string' && raw.id.trim()) ? [] : ['id 要是藥的 id（物品）']),
        ...(raw.min === undefined || (typeof raw.min === 'number' && Number.isFinite(raw.min)) ? [] : ['min 要是數字']),
      ],
      test: (c, { state, actor }) => {
        const who = actor ?? state.pc
        if (!who || !state.actors[who]) return false
        const min = c.min ?? drugRules(k).depend_at
        const rows = readDrugs(state, who).addiction
        return c.id !== undefined ? (rows[c.id]?.value ?? 0) >= min : Object.values(rows).some((r) => r.value >= min)
      },
    })

    // ---- 效果 drug、addiction ----
    registerEffects(k, OWNER)

    // ---- 戰鬥 ----
    installBattle(k, OWNER)

    // ---- 時間與休息 ----
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const drafts = timePassed(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    })
    k.hooks.on('rest.done', OWNER, ({ state }) => restDone(k, state))
    k.hooks.on('report.after', OWNER, ({ state }): ReportDraft[] | void => {
      const drafts = noticeDrafts(k, state)
      return drafts.length > 0 ? drafts : undefined
    })

    // ---- 每週帳單：抑制劑 ----
    installBills(k)

    // ---- 掃橋：藏沉溺的手段（抑制劑、蝶粉：給負的 sink_shown 的藥）算一種；掛點 scan.person 是 features/security 宣告的，這裡只認名字 ----
    ;(k.hooks.on.bind(k.hooks) as unknown as (name: string, owner: string, fn: (payload: never) => unknown) => void)('scan.person', OWNER, (({ state, actor }: { state: GameState; actor: string }) => {
      const hide = hideOf(k, state, actor)
      return hide > 0 ? { hide } : undefined
    }) as never)
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    const fxCtx = { state: blankState(0), actor: 'pc', grade: 1, source: 'builtin', clampAsked: true, content: k.content } as unknown as Parameters<Kernel['effects']['validate']>[1]
    const check = {
      passive: (v: unknown, path: string): string[] => passiveProblems(k, v, path, 'drug'),
      effects: (v: unknown, path: string): string[] => k.effects.validate(v, fxCtx, path),
    }
    if (k.content.hasKind(ITEM_KIND)) {
      for (const e of k.content.list<ContentEntry & { drug?: unknown }>(ITEM_KIND)) {
        if (e.drug === undefined) continue
        problems.push(...drugProblems(e.drug, check).map((m) => `${ITEM_KIND}/${e.id}：${m}`))
      }
    }
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { detox?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.detox === undefined) continue
        const d = t.detox
        if (!isRecord(d) || Object.keys(d).some((f) => f !== 'free') || (d.free !== undefined && d.free !== true)) problems.push(`${FACILITY_TYPE_KIND}/${t.id}：detox 要是 { free?: true }`)
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}

export { OWNER as DRUGS_OWNER }
