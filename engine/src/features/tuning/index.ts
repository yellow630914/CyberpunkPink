// L6 功能：調校與靜室（LEWD_SYSTEM 第 1 節「怎麼變」、第 4 節、第 6 節「調校診所」；MIGRATION N 組 schools、purify；dev/adr/0019 第七節與 P48、P49、P65；dev/work/M4-tuning.md）。
// 調校是裝在橋的兩個調校槽裡的韌體設定檔，正反兩面都寫在 effects；在調校診所裝卸；可以被強制安裝與上鎖；靜室付錢把一項橋參數調 ±5。七種調校的內容不在這裡（內容）。
//
// 接上核心的地方：
//   內容  tuning（{ name, desc, effects, requires?, tags?, price?, flags?, scene? }；效果用被動效果的格式，來源 tuning）、tuning_rule（規則表，overridable；id: default；model.ts 的 DEFAULT_TUNING_RULES）；
//         設施種類（world 的 facility_type）多讀 tuning: { install?, quiet_room? }（載入之後 ready 檢查格式）
//   被動  k.passives.register 來源 tuning：裝著的每一個的 effects；requires 不成立（裝不穩）的：正的那幾筆不算、負的照算；flags 的 no_full_sync 給一筆 sync_cap_max −1（核心的「最高檔」）、sink_resist 與 afterglow_double 各給一個單位標籤
//   修正  k.battle.modifier：flags 的 no_load_decay 在現實的戰場抵掉自然消退（battle.ts）；掛點 damage.hp：flags 的 hp_to_load 把兩成生命傷害換成感載（規則表 hp_to_load_pct）
//   掛點  scene.body（features/scene 宣告，用名字掛）：裝著的調校的 scene.sensitivity；time.passed：flags 的 sink_weekly 每週一沉溺 +1；
//         report.after：看到 cyber.bridge（換橋）的報告，把沒上鎖的調校清掉
//   條件  tuning（{ id }：裝著）；用到別人登記的：has_bridge、tendency_axis、tendency_tag、at_facility
//   效果  tuning（{ id, locked_by?, days? }：強制裝上並可上鎖）、tuning_remove（{ id }：無視鎖拿掉）；都 ai: false；用到別人登記的：bridge、sink（查不到略過）
// 讀的：k.stats（bridge_<參數> 的組成）、k.conditions、k.content、k.activity.blockOf。
// 狀態  actor.ext.tuning：{ slots: [id | null, …], locked: { id: { by, until? } }, quiet_week?, quiet_n? }（形狀見 model.ts）
// 報告（kind action）：tuning.install、tuning.remove（也是換橋之後的說明）、tuning.quiet、tuning.week（sink_weekly 的每週一份）。
// 對外：tuningOf、tuningList、installProblems／installBlock／installQuote／installDraft、removeProblems／removeBlock／removeQuote／removeDraft、quietProblems／quietBlock／quietQuote／quietDraft、bridgeView。
//
// 沒有做：七種調校的內容；進階效果（特質）；原型版只收資料；
// no_load_decay 只管戰鬥內的現實戰場（戰鬥外的消退是休息的事）；價錢沒有乘區的倍率。

import type { ContentEntry, Feature, Kernel, ReportDraft } from '../../core'
import { ContentError, isRecord, passiveProblems } from '../../core'
import { installBattle } from './battle'
import { installEffects } from './effects'
import { tuningBody, tuningPassives } from './passive'
import { bridgeChanged, weeklyDrafts } from './weekly'
import { FACILITY_TYPE_KIND, KIND, OWNER, RULE_KIND, entryProblems, readExt, ruleProblems, tuningRules } from './model'
import type { TuningExt } from './model'
import type { GameState } from '../../core'

export { INSTALL_ACTION as TUNING_INSTALL_ACTION, QUIET_ACTION as TUNING_QUIET_ACTION, REMOVE_ACTION as TUNING_REMOVE_ACTION, WEEK_ACTION as TUNING_WEEK_ACTION } from './model'
export { installBlock, installDraft, installProblems, installQuote, removeBlock, removeDraft, removeProblems, removeQuote, tuningHere } from './install'
export type { InstallOpts, Pool as TuningPool, RemoveOpts, TuningFacility, TuningQuote } from './install'
export { quietBlock, quietDraft, quietProblems, quietQuote } from './quiet'
export type { QuietOpts, QuietQuote } from './quiet'
export { bridgeView, tuningList } from './view'
export type { BridgeViewOfTuning, ParamSource, ParamView, SlotView } from './view'
export { activeFlags, installedEntries } from './passive'
export { CYBER_BRIDGE_ACTION } from './weekly'
export {
  BRIDGE_PARAMS as TUNING_BRIDGE_PARAMS, DEFAULT_TUNING_RULES, EXT as TUNING_EXT, FLAGS as TUNING_FLAGS, FLAG_NAME as TUNING_FLAG_NAME, KIND as TUNING_KIND, RULE_KIND as TUNING_RULE_KIND, tuningRules,
} from './model'
export type { TuningEntry, TuningExt, TuningFlag, TuningLock, TuningRules } from './model'

/** 這個人的調校記錄（槽、鎖；過了期限的鎖不列）。 */
export const tuningOf = (k: Pick<Kernel, 'content'>, state: GameState, actor: string): TuningExt => readExt(state, actor, tuningRules(k).slots)

/** 掛點 scene.body 是 features/scene 宣告的：這裡只認名字與格式，不 import（照 features/cyberware 的做法）。 */
type AnyHook = (name: string, owner: string, fn: (payload: never) => unknown) => void

export const tuningFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: KIND, owner: OWNER, validate: entryProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 被動效果
    k.passives.register(OWNER, 'tuning', (state, actor) => tuningPassives(k, state, actor), '調校')

    // 效果與條件
    installEffects(k)

    // 戰鬥：no_load_decay
    installBattle(k)

    // 場景問身體
    const on = k.hooks.on.bind(k.hooks) as unknown as AnyHook
    on('scene.body', OWNER, (({ state, actor, layer }: { state: GameState; actor: string; layer: string }) => tuningBody(k, state, actor, layer)) as never)

    // 每週一：sink_weekly
    k.hooks.on('time.passed', OWNER, ({ state, from, to }): ReportDraft[] | void => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = weeklyDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    })

    // 換橋之後沒上鎖的調校清掉
    k.hooks.on('report.after', OWNER, ({ state, report }): ReportDraft[] | void => {
      const drafts = bridgeChanged(k, state, report)
      return drafts.length > 0 ? drafts : undefined
    })
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    // 設施種類多讀的 tuning
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { tuning?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.tuning === undefined) continue
        const f = t.tuning
        const at = `${FACILITY_TYPE_KIND}/${t.id}`
        if (!isRecord(f)) { problems.push(`${at}：tuning 要是 { install?, quiet_room? }`); continue }
        for (const key of Object.keys(f)) if (key !== 'install' && key !== 'quiet_room') problems.push(`${at}：tuning 沒有 ${key} 這個欄位（只有 install、quiet_room）`)
        for (const key of ['install', 'quiet_room'] as const) if (f[key] !== undefined && typeof f[key] !== 'boolean') problems.push(`${at}：tuning.${key} 要是 true 或 false`)
      }
    }
    // 調校的被動效果：格式照被動效果查（條件種類要等功能都裝好才查得出，所以在這裡）
    for (const e of k.content.list<ContentEntry & { effects?: unknown }>(KIND)) problems.push(...passiveProblems(k, e.effects, 'effects').map((m) => `${KIND}/${e.id}：${m}`))
    if (problems.length > 0) throw new ContentError(problems)
  },
}

export { OWNER as TUNING_OWNER }
