// L6 功能：休息與住處（DOWNTIME 第 1、2 節、7.1 節開頭與等級 0、1、7.2 節的表與「押金」；EVENTS 3.1 節；CORE_RULES 4.1、4.2 節；dev/adr/0016 第六節；dev/work/M2-rest-housing.md）。
//
// 喘口氣（60 分鐘）、睡一覺（480 分鐘）、睡在哪裡的差別（露宿、有床位的設施、自己的住處）；最小的住處：租一個地方、付房租、在那裡睡、退租。
// 家園的地圖、家具、舒適度、儲物、住戶、訪客、安全屋、買斷、假身分租、搬家不在這裡（M5）；治療、沉溺的消退、成癮是 M4。
//
// 接上核心的地方：
//   內容  residence { id, name, district, block, facility?, level, rent, cash_ok?, start? }、rest_rule（id: default，蓋掉內建的規則數字）；
//         設施的種類（world 的 facility_type）多讀一個欄位 sleep: { rate, cost }（載入之後 ready 檢查格式）
//   條件  has_home、at_home { level_min? }（住處的等級至少多少；M4-craft）、slept_within { hours }
//   掛點  bill.collect（回房租這一項：order 1；收現金的住處 pay 是 either，只收現金是 cash）、bill.settled（房租沒付成就累計欠繳週數，欠到兩週門鎖被換掉，付清才開）：
//         宣告在 features/bills，這裡只掛處理函式；rest.done：這個功能是發的人（用核心的 restDone）；game.new：內容裡有 start 的住處，主角一開始就租著它（不收押金）
//   格子  usesOf：人站在自己住處的設施上列「睡一覺」「喘口氣」；站在有 sleep 的設施上列「睡一覺」
//   狀態  state.ext.rest：{ lastSleep, breaths, home: { id, deposit, pool, arrears, locked } | null }（形狀見 model.ts；只經由報告裡的 ext 變更寫）
// 讀的：k.stats（max_hp；沒有人註冊時照 CORE_RULES 4.1 節）、actor.conditions 的共用狀況 treated（傷口處理過；M2 只讀）、k.activity.blockOf、k.content（block、facility_type）。
// 報告（kind downtime）：rest.breath、rest.sleep、home.rent、home.leave；觸發點 rest、sleep_out（露宿）、home（睡在自己的住處）。
// 計數器：睡一覺的報告多一筆 { op: 'counter', key: 'sleeps:<週>', delta: 1 }（睡下去那一刻所在的週；features/sink 週一讀上一週的，DOWNTIME 3.3 節的自然下降）。
// 對外：breathDraft、sleepDraft、sleepOptions、rentDraft、leaveDraft（以及各自的 …Block）、readRest、homeOf、restRules。

import type { Condition, ConditionCtx, ContentEntry, Feature, GridUse, Kernel } from '../../core'
import { ContentError, toMinutes } from '../../core'
import { RENT_ID, breathBlock, rentLine, rentSettled, sleepBlock, sleepOptions } from './ops'
import type { ResidenceEntry } from './model'
import {
  EXT, FACILITY_TYPE_KIND, OWNER, RESIDENCE_KIND, RULE_KIND, BLOCK_KIND,
  blankRest, homeOf, readRest, residenceProblems, ruleProblems, sleepProblems, standingAt, isText,
} from './model'

export { breathBlock, breathDraft, leaveBlock, leaveDraft, rentBlock, rentDraft, sleepBlock, sleepDraft, sleepOptions } from './ops'
export type { RentOpts, SleepOption, SleepOpts, SleepSpotId } from './ops'
export { DEFAULT_REST_RULES, blankRest, depositOf, homeOf, readRest, residencePools, restRules, sleepFacilityAt, standingAt } from './model'
export type { HomeState, Level, ResidenceEntry, RestRules, RestState, SleepDef } from './model'

const isHours = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

export const restFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind<ResidenceEntry>({ kind: RESIDENCE_KIND, owner: OWNER, validate: residenceProblems })
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // ---- 條件 ----
    k.conditions.register<Condition>({ kind: 'has_home', owner: OWNER, validate: () => [], test: (_c, { state }: ConditionCtx) => !!homeOf(k, state) })
    // at_home：人站在自己的住處；level_min（選填）是住處的等級至少多少（組裝要有工作台的二級以上；沒寫和以前一樣）
    k.conditions.register<Condition & { level_min?: number }>({
      kind: 'at_home', owner: OWNER,
      validate: (raw) => (raw.level_min === undefined || (Number.isInteger(raw.level_min) && (raw.level_min as number) >= 0 && (raw.level_min as number) <= 3) ? [] : ['level_min 要是 0～3 的整數']),
      test(c, { state }: ConditionCtx) {
        const h = homeOf(k, state)
        return !!h && standingAt(state, h.residence) && (c.level_min === undefined || h.residence.level >= c.level_min)
      },
    })
    k.conditions.register<Condition & { hours: number }>({
      kind: 'slept_within', owner: OWNER,
      validate: (raw) => (isHours(raw.hours) ? [] : ['hours 要是大於 0 的數字']),
      test(c, { state }: ConditionCtx) {
        const last = readRest(state).lastSleep
        return last !== null && toMinutes(state.time) - last <= c.hours * 60
      },
    })

    // ---- 每週帳單：房租是第 1 項 ----
    k.hooks.on('bill.collect', OWNER, ({ state }) => {
      const line = rentLine(k, state)
      return line ? [line] : undefined
    })
    k.hooks.on('bill.settled', OWNER, ({ state, lines }) => {
      const changes = rentSettled(k, state, lines.find((l) => l.owner === OWNER && l.id === RENT_ID && l.kind === 'due'))
      return changes.length > 0 ? changes : undefined
    })

    // ---- 開新局：有 start 的住處，主角一開始就租著它（不收押金） ----
    k.hooks.on('game.new', OWNER, () => {
      const start = k.content.list<ResidenceEntry>(RESIDENCE_KIND).find((r) => r.start === true)
      if (!start) return undefined
      return [{ op: 'ext', key: EXT, value: { ...blankRest(), home: { id: start.id, deposit: 0, pool: 'cred', arrears: 0, locked: false } } }]
    })

    // ---- 站在自己住處的設施上：睡一覺與喘口氣；站在有 sleep 的設施上：睡一覺 ----
    k.grid.usesOf(OWNER, (ctx, marker): GridUse[] => {
      const kk = ctx.k as Kernel
      const st = ctx.state
      const h = homeOf(kk, st)
      const options = () => sleepOptions(kk, st)
      if (h && h.residence.facility === marker.id && st.location.block === h.residence.block) {
        const home = options().find((o) => o.id === 'home')
        return [{ id: 'rest.sleep', name: '睡一覺', block: home?.block ?? sleepBlock(kk, st) }, { id: 'rest.breath', name: '喘口氣', block: breathBlock(kk, st) }]
      }
      if (st.location.facility === marker.id) {
        const fac = options().find((o) => o.id === 'facility')
        if (fac) return [{ id: 'rest.sleep', name: fac.cost > 0 ? `睡一覺（${fac.name}，${fac.cost}）` : `睡一覺（${fac.name}）`, block: fac.block }]
      }
      return []
    })
  },

  ready(k) {
    const problems: string[] = []
    for (const t of k.content.list<ContentEntry & { sleep?: unknown }>(FACILITY_TYPE_KIND)) {
      if (t.sleep !== undefined) problems.push(...sleepProblems(t.sleep).map((m) => `${FACILITY_TYPE_KIND}/${t.id}：${m}`))
    }
    // 住處的街區與設施要真的在（block 是 world 的內容種類；沒有裝世界就不檢查）
    if (k.content.hasKind(BLOCK_KIND)) {
      for (const r of k.content.list<ResidenceEntry>(RESIDENCE_KIND)) {
        const b = k.content.get<ContentEntry & { district?: unknown; facilities?: Record<string, unknown> }>(BLOCK_KIND, r.block)
        if (!b) {
          problems.push(`${RESIDENCE_KIND}/${r.id}：block ${r.block} 沒有這塊街區`)
          continue
        }
        if (isText(b.district) && b.district !== r.district) problems.push(`${RESIDENCE_KIND}/${r.id}：district 是 ${r.district}，可是街區 ${r.block} 在 ${b.district}`)
        if (r.facility !== undefined && !(b.facilities && Object.hasOwn(b.facilities, r.facility))) problems.push(`${RESIDENCE_KIND}/${r.id}：街區 ${r.block} 沒有 ${r.facility} 這個設施`)
      }
    }
    if (problems.length) throw new ContentError(problems)
  },
}

export { EXT as REST_EXT, OWNER as REST_OWNER, RULE_KIND as REST_RULE_KIND, RESIDENCE_KIND }
