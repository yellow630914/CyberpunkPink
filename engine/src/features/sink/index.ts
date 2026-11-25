// L6 功能：沉溺（CORE_RULES 4.3 節；DOWNTIME 3.2、3.3 節；NPCS 8.3 節「隱藏沉溺」；dev/adr/0019 第六節與 P17～P21；dev/work/M4-sink.md）。
// 沉溺是主角的長軌（核心與 features/character 管數值與 sink 效果）；這個功能做「落在哪一段的得失」「每週的事」「治療」「別人看到的」「100 以上」。
//
// 接上核心的地方：
//   內容  sink_rule（規則表，overridable；id: default）：分段（每一段的被動效果、每週的事、double）、過百之後的 over_step、每週自然下降、勢力的清單 watchers、
//         治療（counsel、retreat）、hide_step、afterglow_carry（model.ts 的 DEFAULT_SINK_RULES）；
//         設施種類（world 的 facility_type）多讀 therapy: { kind: 'counsel' | 'retreat', free?, favor?: { faction, min } }（載入之後 ready 檢查格式）
//   被動  k.passives.register 來源 sink：真正的沉溺落在哪幾段，每一段的 effects 都給（往上累加）；80～99 加倍前面每一段裡檢定類的加減；
//         超過 100 每滿 over_step 點承受層數 +1；沒過期的 floor_mods 給 { stat: 'sink_floor' }
//   數值  衍生數值 sink_shown（別人看到的沉溺：基礎是真正的沉溺，藥、調校、面具加負的 provider，最少 0）；分段永遠照真正的沉溺算
//   條件  sunk（沉溺 100 以上；看 ctx.actor ?? 主角）
//   效果  sink_floor { amount, days?, why? }（暫時或永久的下限加減，只有內建的來源能用；沉溺不到新的下限時同一份報告補上去）
//   變更  sink.ext（合併著寫 actor.ext.sink：下限加減、心理治療做過幾次、餘韻的起點）
//   掛鉤  time.passed 順序 13：每週一的自然下降與每週的事（weekly.ts）；順序 20：長時間帶著餘韻（carry.ts）；report.before：維護餘韻的起點
//   計數器 state.counters 的 sleeps:<週>：features/rest 在睡一覺的報告上加 1，這裡週一讀上一週的（週的編號是第一個週一 06:00 起算第 1 週）
// 讀的：k.stats（sink_floor、composure 的檢定 provider 都經由 k.passives）、k.effects（sink、hostility；hostility 沒有人註冊或查不到勢力就略過）、k.conditions（at_facility）、k.meters（favor）、k.content。
// 狀態  actor.ext.sink：{ floor_mods: [{ amount, until?, why? }], therapy_week?, therapy_n?, carry_from?, carry_paid? }（形狀見 model.ts；只經由 sink.ext 變更寫）
// 報告  sink.week（每週的那一份；帶觸發點，例如 impulse）、sink.therapy、sink.carry（長時間帶著餘韻的沉溺，與記號的整理）
// 對外：sinkView、bandOf、nextBandOf、sinkRules、therapyBlock／therapyProblems／therapyQuote／therapyDraft、weeklyDrafts。
//
// 沒有做：過牆、群落、流竄 AI 的委託、溺感者的傳播（只留條件 sunk）；「聽得懂遺魂」「深海溫和」「牆外的接觸」「自由行動時 AI 把衝動寫進結果」「清明的人怕你」（內容與 M6、AI）；
// 「餘韻的正面效果加倍」（餘韻的正面效果在核心的戰鬥規則裡，這裡只加倍檢定的加減）；夥伴離隊在 roster；抑制劑在 drugs；斷線靜修期間的關橋與禁止潛入；治療的價錢沒有乘區的倍率。

import type { Condition, ConditionCtx, ContentEntry, Feature, Kernel, ReportDraft } from '../../core'
import { ContentError, isRecord, isSafeInt, passiveProblems } from '../../core'
import { carryBefore, carryDrafts } from './carry'
import { registerFloor } from './floor'
import { sinkPassives } from './passive'
import { weeklyDrafts } from './weekly'
import { FACILITY_TYPE_KIND, OWNER, RULE_KIND, SHOWN_STAT, SUNK_AT, SUNK_CONDITION, THERAPY_KINDS, ruleProblems, sinkRules } from './model'

export { CARRY_ACTION } from './carry'
export { weeklyDrafts } from './weekly'
export { therapyBlock, therapyDraft, therapyHere, therapyProblems, therapyQuote } from './therapy'
export type { TherapyFacility, TherapyOpts, TherapyQuote } from './therapy'
export { sinkView } from './view'
export type { BandView, SinkView } from './view'
export {
  DEFAULT_SINK_RULES, EXT as SINK_EXT, PERCEPTION_SKILLS, FLOOR_EFFECT as SINK_FLOOR_EFFECT, SHOWN_STAT as SINK_SHOWN_STAT, SUNK_AT, THERAPY_ACTION, WEEK_ACTION as SINK_WEEK_ACTION,
  bandOf, nextBandOf, readExt as readSinkExt, sinkRules, sleepKey, weekOf as sinkWeekOf,
} from './model'
export type { BandWeekly, FloorMod, SinkBand, SinkExt, SinkRules, TherapyKind } from './model'

export const sinkFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // 被動效果：分段的得失、過百、下限的加減
    k.passives.register(OWNER, 'sink', (state, actor) => sinkPassives(sinkRules(k), state, actor), '沉溺')

    // 別人看到的沉溺：基礎是真正的沉溺，別人（藥、調校、面具）加負的 provider
    k.stats.defineStat({ id: SHOWN_STAT, owner: OWNER, name: '別人看到的沉溺', base: (state, actor) => state.actors[actor]?.sink ?? 0, min: 0 })

    // 條件 sunk：沉溺 100 以上（看 ctx.actor，沒給是主角）
    k.conditions.register<Condition>({
      kind: SUNK_CONDITION, owner: OWNER, validate: () => [],
      test: (_c, { state, actor }: ConditionCtx) => (state.actors[actor ?? state.pc ?? '']?.sink ?? 0) >= SUNK_AT,
    })

    // 效果 sink_floor 與變更 sink.ext
    registerFloor(k)

    // 每週一
    k.hooks.on('time.passed', OWNER, ({ state, from, to }): ReportDraft[] | void => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = weeklyDrafts(k, state, from, to)
      return drafts.length > 0 ? drafts : undefined
    }, 13)

    // 長時間帶著餘韻
    k.hooks.on('report.before', OWNER, ({ state, draft }) => carryBefore(state, draft))
    k.hooks.on('time.passed', OWNER, ({ state, from }): ReportDraft[] | void => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const drafts = carryDrafts(k, state, from)
      return drafts.length > 0 ? drafts : undefined
    }, 20)
  },

  ready(kernel) {
    const k = kernel as Kernel
    const problems: string[] = []
    // 設施種類多讀的 therapy
    if (k.content.hasKind(FACILITY_TYPE_KIND)) {
      for (const t of k.content.list<ContentEntry & { therapy?: unknown }>(FACILITY_TYPE_KIND)) {
        if (t.therapy === undefined) continue
        const th = t.therapy
        const at = `${FACILITY_TYPE_KIND}/${t.id}`
        if (!isRecord(th) || !(THERAPY_KINDS as readonly unknown[]).includes(th.kind)) { problems.push(`${at}：therapy 要是 { kind: ${THERAPY_KINDS.join(' | ')}, free?, favor? }`); continue }
        if (th.free !== undefined && typeof th.free !== 'boolean') problems.push(`${at}：therapy.free 要是 true 或 false`)
        if (th.favor !== undefined) {
          const f = th.favor
          if (!isRecord(f) || typeof f.faction !== 'string' || !f.faction || !isSafeInt(f.min) || f.min < 0 || f.min > 100) problems.push(`${at}：therapy.favor 要是 { faction, min（0～100 的整數） }`)
          else if (k.content.hasKind('faction') && !k.content.has('faction', f.faction)) problems.push(`${at}：therapy.favor 的勢力 ${f.faction} 查不到`)
        }
      }
    }
    // 規則表：每一段的被動效果、勢力
    const rules = sinkRules(k)
    for (const [i, b] of rules.bands.entries()) problems.push(...passiveProblems(k, b.effects, `bands[${i}].effects`).map((m) => `${RULE_KIND}/default：${m}`))
    if (k.content.hasKind('faction')) for (const f of rules.watchers) if (!k.content.has('faction', f)) problems.push(`${RULE_KIND}/default：watchers 的勢力 ${f} 查不到`)
    if (problems.length > 0) throw new ContentError(problems)
  },
}

export { OWNER as SINK_OWNER, RULE_KIND as SINK_RULE_KIND }
