// L6 功能：敵對值、好感、掃橋（FACTIONS 第 5、6 節；CORE_RULES 第 8 節；LIFE 2.1～2.3 節；EQUIPMENT 6.3、6.4 節；UI 3.11 節；
// dev/adr/0016 第三、四、七節與 G17；dev/work/M2-security.md）。
//
// 每個勢力一條敵對值（會消退、有下限、照區的倍率加）與一條好感（不會自己消退）。掃橋是一個統一的動作，見 scan.ts。
//
// 接上核心的地方：
//   內容  security_rule（id: default，蓋掉內建的規則數字）；多讀的欄位：faction.bribe（收不收錢）、district.hostility_mult（{ 勢力 id 或 *: 倍率 }）、
//         item.legal 與 tags（fake_id、license）
//   量表  hostility（0～100、AI ±10、下限是 hostility_floor 與有期限的下限裡較高的、效果照區的倍率加）、hostility_floor（永久的下限；AI 一件事最多 +5）、favor（0～100、起始 10、AI ±5）；
//         同名的效果與條件核心自動有（hostility_floor 的效果自己註冊：多收 days，見 floor.ts）
//   條件  hostility_tier、favor_tier（{ faction, min?, max? }，段寫 id 或第幾段）、scan_option（掃橋的事件裡選項走不走得通）
//   活動  scan（setup: { point, name, strength, faction?, need_class? }；activity.end 的 result: { passed, how }）
//   掛點  scan.carried（這個功能宣告；gear 回答）；scan.person（這個功能宣告；cyberware 回答義體、contract 回答契約與權利、藏沉溺的手段由別的功能報 hide；person.ts）；report.before（記「那一週有新的敵對值」、下限抬高時讓敵對值跟上）；time.passed（順序 12，每週消退）；
//         activity.end（事件視窗做完，把結果換成 scan 的 activity.end）
//   報告  scan.pass（掃橋直接通過）、security.bribe（收買）、security.decay（每週消退）；掃橋有事件時是事件視窗的 event.open／event.close
// M4-security-m4：掃橋多讀「這個人」的義體、沉溺與契約（person.ts；掃橋設定的 reads，沒寫照規則表 security_rule 的 readers 查勢力，再沒有就只讀義體；
//   規則數字 sink_notice、sink_see、cyber_fine、cyber_lock_hours、cyber_hostility 在 personRules.ts，和別的規則同一筆資料）。沒有人回答 scan.person 又沒有沉溺可讀時流程和以前完全一樣。
// 對外：hostilityTier、favorTier、bribe／bribeBlock／bribePrice、scanView、hostilityView、favorView。

import type { Condition, ContentEntry, Feature, Kernel } from '../../core'
import { ContentError, isRecord } from '../../core'
import { installScan } from './scan'
import { FAVOR_TIERS, HOSTILITY_TIERS, OWNER, RULE_KIND, favorTier, hostilityTier, ruleProblems, tierIndex } from './model'
import { FLOOR_DEF, FLOOR_METER, registerFloor, timedFloorAt } from './floor'
import { decayDraft, standingBefore } from './standing'

export { bribe, bribeBlock, bribePrice, bribeUnit, favorView, hostilityView } from './standing'
export { FLOOR_CHANGE, MAX_FLOOR_DAYS, floorOf, timedFloorAt, timedFloors } from './floor'
export type { TimedFloor } from './floor'
export type { FavorRow, HostilityRow } from './standing'
export { OPTION_FAKE, OPTION_PROCEED, OPTION_TURN_BACK, SCAN_ACTIVITY, lockOf, planScan, resolveScan, scanView } from './scan'
export type { Carried, FakePlan, Resolution, ScanItemView, ScanOptionView, ScanPlan, ScanStepView, ScanView } from './scan'
export {
  CLASS_NAME, DEFAULT_SECURITY_RULES, FAKE_ATTR, FAKE_SKILL, FAKE_TAG, FAVOR_TIERS, HOSTILITY_TIERS, IDENTITY_CLASSES, LICENSE_TAG, MAX_STRENGTH, RULE_KIND, SCAN_EXT,
  favorTier, favorTierOf, hasLicense, hostilityTier, hostilityTierOf, identityOf, fakeIdsOf, readScanSetup, securityRules,
} from './model'
export type { FakeId, IdentityClass, ScanSetup, SecurityRules, TierView } from './model'
export { DEFAULT_PERSON_RULES, PERSON_READS, personRulesFrom } from './personRules'
export type { PersonRead, PersonRules } from './personRules'
export { applyPerson, personRulesOf, personView, planPerson, readsOf } from './person'
export type { CyberRead, CyberVerdict, PersonAnswer, PersonPlan, PersonView, SinkRead } from './person'

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

type TierCondition = Condition & { faction: string; min?: string | number; max?: string | number }

/** 「第幾段」的條件：faction 一定要寫；min、max 寫段的 id 或第幾段（0 起算）。 */
function tierCondition(k: Kernel, kind: string, defs: typeof HOSTILITY_TIERS | typeof FAVOR_TIERS, read: (faction: string, state: Parameters<typeof hostilityTier>[1]) => number) {
  k.conditions.register<TierCondition>({
    kind, owner: OWNER,
    validate: (raw) => [
      ...(typeof raw.faction === 'string' && raw.faction ? [] : ['faction 要是勢力的 id']),
      ...(['min', 'max'] as const).filter((f) => raw[f] !== undefined && tierIndex(defs, raw[f]) === null).map((f) => `${f} 要寫段的 id（${defs.map((d) => d.id).join('、')}）或第幾段（0～${defs.length - 1}）`),
      ...(raw.min === undefined && raw.max === undefined ? ['要寫 min 或 max'] : []),
    ],
    test: (c, ctx) => {
      const at = read(c.faction, ctx.state)
      const lo = c.min === undefined ? 0 : (tierIndex(defs, c.min) ?? 0)
      const hi = c.max === undefined ? defs.length - 1 : (tierIndex(defs, c.max) ?? defs.length - 1)
      return at >= lo && at <= hi
    },
  })
}

export const securityFeature: Feature = {
  id: OWNER,
  install(k: Kernel) {
    k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: ruleProblems })

    // ---- 量表 ----
    // 下限先定義：敵對值的下限讀它（越過粉牆的人貞網局的敵對值永遠 ≥ 30；沉溺與戰敗事件各自寫它）。
    // 有兩種：永久的（量表 hostility_floor；AI 一件事最多 +5）與有期限的（效果多寫 days，記在 ext，到期解除；只有內建的事件資料能用）；同時有好幾個取最高的（floor.ts）
    registerFloor(k)
    k.meters.define(FLOOR_DEF)
    k.meters.define({
      kind: 'hostility', owner: OWNER, name: '敵對值', min: 0, max: 100, start: 0, keyed: 'faction', cap: { down: 10, up: 10 }, floor: FLOOR_METER,
      floorOf: (state, key) => timedFloorAt(state, key),
      // 區的倍率（FACTIONS 6.2 節；DISTRICTS 第 2 節）：只算往上加的；照勢力寫，或用 * 寫全部。沒寫就是 1
      adjust(state, key, delta) {
        if (delta <= 0 || !state.location.district) return delta
        const mult = k.content.get<ContentEntry & { hostility_mult?: unknown }>('district', state.location.district)?.hostility_mult
        if (!isRecord(mult)) return delta
        return delta * (num(mult[key]) ?? num(mult['*']) ?? 1)
      },
    })
    k.meters.define({ kind: 'favor', owner: OWNER, name: '好感', min: 0, max: 100, start: 10, keyed: 'faction', cap: { down: 5, up: 5 } })

    // ---- 條件：分段 ----
    tierCondition(k, 'hostility_tier', HOSTILITY_TIERS, (f, s) => hostilityTier(k, s, f).index)
    tierCondition(k, 'favor_tier', FAVOR_TIERS, (f, s) => favorTier(k, s, f).index)

    // ---- 這一週有沒有新的敵對值；下限抬高時敵對值跟上 ----
    k.hooks.on('report.before', OWNER, ({ state, draft }) => {
      const out = standingBefore(k, state, draft.changes)
      return out.length > 0 ? out : undefined
    })

    // ---- 每週消退（順序 12：帳單 10 之後、名冊 14 之前）----
    k.hooks.on('time.passed', OWNER, ({ state, from, to }) => {
      const last = state.reports[state.reports.length - 1]
      if (!last || last.rewind) return
      const d = decayDraft(k, state, from, to)
      return d ? [d] : undefined
    }, 12)

    installScan(k)
  },

  ready(k: Kernel) {
    // 多讀的欄位只在這裡查格式（faction 與 district 這兩種內容不是 security 的）
    const problems: string[] = []
    for (const f of k.content.list<ContentEntry & Record<string, unknown>>('faction')) {
      if (f.bribe !== undefined && typeof f.bribe !== 'boolean') problems.push(`faction/${f.id as string}：bribe 要是 true 或 false（收不收錢）`)
    }
    for (const d of k.content.list<ContentEntry & Record<string, unknown>>('district')) {
      const m = d.hostility_mult
      if (m === undefined) continue
      if (!isRecord(m)) problems.push(`district/${d.id as string}：hostility_mult 要是 { 勢力的 id 或 *: 倍率 }`)
      else {
        for (const [key, v] of Object.entries(m)) {
          if (num(v) === undefined) problems.push(`district/${d.id as string}：hostility_mult.${key} 要是 0 以上的數字`)
          else if (key !== '*' && !k.content.has('faction', key)) problems.push(`district/${d.id as string}：hostility_mult 的勢力 ${key} 查不到`)
        }
      }
    }
    if (problems.length > 0) throw new ContentError(problems)
  },
}
