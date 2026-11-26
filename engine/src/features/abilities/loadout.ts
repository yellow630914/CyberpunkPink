// 換技能配置（CORE_RULES 6.4 節、UI 8.3 節、SKILLS 1.7 節；dev/adr/0016 G1）：
// - 在據點（自己的住處）或調校診所換，花半小時；進了委託副本不能換（少數技能與道具例外，M2 沒有）。
//   條件 at_home、at_facility 由別的功能註冊（rest、world）：有人註冊才限地點，兩個都沒有就不限；
//   衍生數值 loadout_anywhere 大於 0 的人（織女 標準：委託副本以外哪裡都能換；橋的型號是 M4，現在只開了這個接口）不限地點。
// - 時間是衍生數值 loadout_minutes（預設 30；橋的型號接上之後由那個功能加減）。一次換成一整組用 applyLoadout（報告 ability.loadout，加時間）；
//   equipAbilities 是逐一裝卸的入口（報告 ability.equip），照同一條地點的規則，時間在套用那一次才算。
// - 面具：裝著入戲（被動的 meat.mask）的角色身上掛著 masked（共用的狀況 id，豔名的「被認出來」看它），卸下來就拿掉；裝卸的報告裡帶那一筆變更。

import type { ActorId, Change, ContentEntry, GameState, Kernel, ReportDraft } from '../../core'
import { isSafeInt } from '../../core'
import { abilitiesOf, capacityBlock, capacityFor, reportOf } from './learn'
import { abilityEntry, filteredNight, isNightId, learnedOutside } from './outside'
import type { AbilityState } from './types'
import { OWNER } from './types'

// ---- 規則 ----

export const RULE_KIND = 'ability_rule'
export interface AbilityRules {
  /** 換技能配置的基礎時間（分鐘） */
  loadout_minutes: number
  /** 調校診所的設施種類（at_facility 的 types；空的是任何設施都算） */
  loadout_facility_types: string[]
  /** 留在家的夥伴拿一份歷練點的幾成（CORE_RULES 7.1 節：三成） */
  xp_home_share: number
  /** 基本功升到 N 級花 N × 這個數歷練點（CORE_RULES 7.2 節：10） */
  skill_xp_per_level: number
  /** 基本功直接花點數最多升到幾級（CORE_RULES 7.2 節：4；5 級與 6 級要有人教） */
  skill_free_max: number
  /** 洗點：每退回一點歷練點付多少錢（CORE_RULES 7.2 節：C$10） */
  respec_price_per_xp: number
  /** 洗點花的時間（分鐘；CORE_RULES 7.2 節：休養一天） */
  respec_minutes: number
  /** 基本功 5、6 級的請教與上課（CORE_RULES 7.2、7.5 節；M4-training） */
  teach: TeachRules
  /** 向 NPC 學工藝基本功的 0～2 級（CRAFTING 11.2 節；M4-craft-teach） */
  tutor: TutorRules
}
/** 向 NPC 學工藝：哪幾項、最高幾級、每一級的學費與時段、一個時段幾分鐘、學費要不要乘區倍率 */
export interface TutorRules {
  skills: string[]
  max_level: number
  /** 升到那一級：{ 學費, 要上幾個時段 }（鍵是級數） */
  steps: Record<string, { price: number; slots: number }>
  slot_minutes: number
  district_price: boolean
}
export interface TeachRules {
  /** 向人請教：親密度到這個數就不收錢（40） */
  affinity: number
  /** 向人請教的學費：升到那一級付多少（5 級 1,500、6 級 5,000；鍵是級數） */
  tuition: Record<string, number>
  /** 每升一級要上幾個時段（2） */
  slots_per_level: number
  /** 一個時段幾分鐘（240） */
  slot_minutes: number
}
/** 半小時：UI 8.3 節的示意；CORE_RULES 6.4 節寫一小時，使用者 2026-11-23 定案統一半小時（dev/adr/0016 G1）。 */
export const DEFAULT_ABILITY_RULES: AbilityRules = {
  loadout_minutes: 30, loadout_facility_types: ['tuning_clinic'], xp_home_share: 0.3, skill_xp_per_level: 10, skill_free_max: 4, respec_price_per_xp: 10, respec_minutes: 1440,
  teach: { affinity: 40, tuition: { 5: 1500, 6: 5000 }, slots_per_level: 2, slot_minutes: 240 },
  tutor: { skills: ['mechanics', 'cyberware', 'medicine'], max_level: 2, steps: { 1: { price: 300, slots: 2 }, 2: { price: 800, slots: 4 } }, slot_minutes: 240, district_price: true },
}

export function abilityRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.loadout_minutes !== undefined && !(isSafeInt(e.loadout_minutes) && e.loadout_minutes >= 0)) p.push('loadout_minutes 要是 0 以上的整數（換技能配置花幾分鐘）')
  if (e.loadout_facility_types !== undefined && !(Array.isArray(e.loadout_facility_types) && e.loadout_facility_types.every((t) => typeof t === 'string' && t.trim().length > 0))) p.push('loadout_facility_types 要是設施種類 id 的陣列（空的是任何設施都算調校診所）')
  if (e.xp_home_share !== undefined && !(typeof e.xp_home_share === 'number' && e.xp_home_share >= 0 && e.xp_home_share <= 1)) p.push('xp_home_share 要是 0～1 的數字（留在家的夥伴拿一份歷練點的幾成）')
  if (e.skill_xp_per_level !== undefined && !(isSafeInt(e.skill_xp_per_level) && e.skill_xp_per_level >= 1)) p.push('skill_xp_per_level 要是 1 以上的整數（基本功升到 N 級花 N 乘這個數的歷練點）')
  if (e.skill_free_max !== undefined && !(isSafeInt(e.skill_free_max) && e.skill_free_max >= 0 && e.skill_free_max <= 5)) p.push('skill_free_max 要是 0～5 的整數（基本功直接花點數最多升到幾級；再上去要有人教）')
  if (e.respec_price_per_xp !== undefined && !(isSafeInt(e.respec_price_per_xp) && e.respec_price_per_xp >= 0)) p.push('respec_price_per_xp 要是 0 以上的整數（洗點每退回一點歷練點付多少錢）')
  if (e.respec_minutes !== undefined && !(isSafeInt(e.respec_minutes) && e.respec_minutes >= 0)) p.push('respec_minutes 要是 0 以上的整數（洗點花幾分鐘）')
  if (e.teach !== undefined) {
    const t = e.teach
    if (typeof t !== 'object' || t === null || Array.isArray(t)) p.push('teach 要是 { affinity, tuition, slots_per_level, slot_minutes }')
    else {
      const o = t as Record<string, unknown>
      for (const key of Object.keys(o)) if (!['affinity', 'tuition', 'slots_per_level', 'slot_minutes'].includes(key)) p.push(`teach.${key}：沒有這個欄位（可以寫：affinity、tuition、slots_per_level、slot_minutes）`)
      if (o.affinity !== undefined && !(isSafeInt(o.affinity) && o.affinity >= -100 && o.affinity <= 100)) p.push('teach.affinity 要是 −100～100 的整數（向人請教，親密度到這個數就不收錢）')
      if (o.slots_per_level !== undefined && !(isSafeInt(o.slots_per_level) && o.slots_per_level >= 1)) p.push('teach.slots_per_level 要是 1 以上的整數（每升一級要上幾個時段）')
      if (o.slot_minutes !== undefined && !(isSafeInt(o.slot_minutes) && o.slot_minutes >= 1)) p.push('teach.slot_minutes 要是 1 以上的整數（一個時段幾分鐘）')
      if (o.tuition !== undefined) {
        const tu = o.tuition
        if (typeof tu !== 'object' || tu === null || Array.isArray(tu)) p.push('teach.tuition 要是 { 級數: 學費 }')
        else for (const [lv, price] of Object.entries(tu)) if (!/^[1-6]$/.test(lv) || !(isSafeInt(price) && price >= 0)) p.push(`teach.tuition.${lv}：鍵要是 1～6 的級數、值要是 0 以上的整數`)
      }
    }
  }
  if (e.tutor !== undefined) p.push(...tutorRuleProblems(e.tutor))
  return p
}

/** 規則 tutor 的格式（向 NPC 學工藝）。 */
function tutorRuleProblems(t: unknown): string[] {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return ['tutor 要是 { skills, max_level, steps, slot_minutes, district_price }']
  const p: string[] = []
  const o = t as Record<string, unknown>
  for (const key of Object.keys(o)) if (!['skills', 'max_level', 'steps', 'slot_minutes', 'district_price'].includes(key)) p.push(`tutor.${key}：沒有這個欄位（可以寫：skills、max_level、steps、slot_minutes、district_price）`)
  if (o.skills !== undefined && !(Array.isArray(o.skills) && o.skills.every((x) => typeof x === 'string' && x.trim().length > 0))) p.push('tutor.skills 要是基本功 id 的陣列（向 NPC 學得到的基本功）')
  if (o.max_level !== undefined && !(isSafeInt(o.max_level) && o.max_level >= 1 && o.max_level <= 5)) p.push('tutor.max_level 要是 1～5 的整數（這條路最高教到幾級；實際不會超過 skill_free_max）')
  if (o.slot_minutes !== undefined && !(isSafeInt(o.slot_minutes) && o.slot_minutes >= 1)) p.push('tutor.slot_minutes 要是 1 以上的整數（一個時段幾分鐘）')
  if (o.district_price !== undefined && typeof o.district_price !== 'boolean') p.push('tutor.district_price 要是 true 或 false（學費乘不乘所在那一區的物價倍率）')
  if (o.steps !== undefined) {
    const st = o.steps
    if (typeof st !== 'object' || st === null || Array.isArray(st)) p.push('tutor.steps 要是 { 級數: { price, slots } }')
    else {
      for (const [lv, row] of Object.entries(st)) {
        if (!/^[1-5]$/.test(lv)) p.push(`tutor.steps.${lv}：鍵要是 1～5 的級數`)
        else if (typeof row !== 'object' || row === null || Array.isArray(row)) p.push(`tutor.steps.${lv} 要是 { price, slots }`)
        else {
          const r = row as Record<string, unknown>
          for (const key of Object.keys(r)) if (!['price', 'slots'].includes(key)) p.push(`tutor.steps.${lv}.${key}：沒有這個欄位（可以寫：price、slots）`)
          if (r.price !== undefined && !(isSafeInt(r.price) && r.price >= 0)) p.push(`tutor.steps.${lv}.price 要是 0 以上的整數（學費）`)
          if (r.slots !== undefined && !(isSafeInt(r.slots) && r.slots >= 1)) p.push(`tutor.steps.${lv}.slots 要是 1 以上的整數（要上幾個時段）`)
        }
      }
      // 最高級以下每一級都要有一列（預設只有 1、2 級）
      const max = isSafeInt(o.max_level) ? o.max_level : DEFAULT_ABILITY_RULES.tutor.max_level
      for (let lv = 1; lv <= max; lv++) if (DEFAULT_ABILITY_RULES.tutor.steps[String(lv)] === undefined && (st as Record<string, unknown>)[String(lv)] === undefined) p.push(`tutor.steps.${lv}：max_level 到 ${max} 級，要寫這一級的 { price, slots }`)
    }
  } else if (isSafeInt(o.max_level) && o.max_level > DEFAULT_ABILITY_RULES.tutor.max_level) p.push(`tutor.steps：max_level 到 ${o.max_level} 級，要寫第 ${DEFAULT_ABILITY_RULES.tutor.max_level + 1} 級以上的 { price, slots }`)
  return p
}

/** 學工藝每一級的學費與時段：資料寫的級蓋掉預設（欄位也逐欄蓋）。 */
function tutorSteps(raw: TutorRules['steps'] | undefined): TutorRules['steps'] {
  const out: TutorRules['steps'] = {}
  for (const [lv, row] of Object.entries(DEFAULT_ABILITY_RULES.tutor.steps)) out[lv] = { ...row }
  for (const [lv, row] of Object.entries(raw ?? {})) out[lv] = { ...(out[lv] ?? { price: 0, slots: 1 }), ...row }
  return out
}

/** 規則：內容種類 ability_rule（id: default）蓋掉內建的預設。 */
export function abilityRules(k: Pick<Kernel, 'content'>): AbilityRules {
  const e = k.content.get<ContentEntry & Partial<Omit<AbilityRules, 'teach' | 'tutor'>> & { teach?: Partial<TeachRules>; tutor?: Partial<TutorRules> }>(RULE_KIND, 'default')
  return {
    loadout_minutes: e?.loadout_minutes ?? DEFAULT_ABILITY_RULES.loadout_minutes,
    loadout_facility_types: e?.loadout_facility_types ? [...e.loadout_facility_types] : [...DEFAULT_ABILITY_RULES.loadout_facility_types],
    xp_home_share: e?.xp_home_share ?? DEFAULT_ABILITY_RULES.xp_home_share,
    skill_xp_per_level: e?.skill_xp_per_level ?? DEFAULT_ABILITY_RULES.skill_xp_per_level,
    skill_free_max: e?.skill_free_max ?? DEFAULT_ABILITY_RULES.skill_free_max,
    respec_price_per_xp: e?.respec_price_per_xp ?? DEFAULT_ABILITY_RULES.respec_price_per_xp,
    respec_minutes: e?.respec_minutes ?? DEFAULT_ABILITY_RULES.respec_minutes,
    teach: {
      ...DEFAULT_ABILITY_RULES.teach, ...(e?.teach ?? {}),
      tuition: { ...DEFAULT_ABILITY_RULES.teach.tuition, ...(e?.teach?.tuition ?? {}) },
    },
    tutor: {
      ...DEFAULT_ABILITY_RULES.tutor, ...(e?.tutor ?? {}),
      skills: [...(e?.tutor?.skills ?? DEFAULT_ABILITY_RULES.tutor.skills)],
      steps: tutorSteps(e?.tutor?.steps),
    },
  }
}

export const LOADOUT_MINUTES_STAT = 'loadout_minutes'
export const LOADOUT_ANYWHERE_STAT = 'loadout_anywhere'

export function registerLoadout(k: Kernel): void {
  k.content.defineKind({ kind: RULE_KIND, owner: OWNER, overridable: true, validate: abilityRuleProblems })
  k.stats.defineStat({ id: LOADOUT_MINUTES_STAT, owner: OWNER, name: '換技能配置的時間（分鐘）', base: () => abilityRules(k).loadout_minutes })
  // 大於 0：不必在據點或調校診所（織女 標準；橋的型號等 M4）。基礎是 0
  k.stats.defineStat({ id: LOADOUT_ANYWHERE_STAT, owner: OWNER, name: '哪裡都能換配置', base: () => 0, max: 1 })
}

// ---- 能不能換 ----

type LoadoutKernel = Pick<Kernel, 'content' | 'activity' | 'conditions' | 'stats' | 'timeRules'>

/**
 * 現在換不換得了技能配置；換不了回傳第一個原因（給玩家看的完整句子），換得了是 null。
 * 戰鬥中由活動的放行擋（Game.blockOf('commit:ability.loadout')，和學技能一樣），這裡不重複問。
 */
export function loadoutBlock(k: LoadoutKernel, state: GameState, actor: ActorId): string | null {
  if (!state.actors[actor]) return '沒有這個角色。'
  if (k.activity.active(state).some((a) => a.kind === 'commission')) return '進了委託副本就不能換技能配置，要回到據點或調校診所才行。'
  // 戰鬥中不在這裡問地點：活動的放行會擋（commit:ability.loadout、commit:ability.equip；原因由活動寫，和學技能一樣）
  if (state.battle) return null
  if (k.stats.hasStat(LOADOUT_ANYWHERE_STAT) && k.stats.stat(state, actor, LOADOUT_ANYWHERE_STAT) > 0) return null
  const kinds = new Set(k.conditions.kinds())
  const home = kinds.has('at_home')
  const facility = kinds.has('at_facility')
  if (!home && !facility) return null
  const ctx = { state, actor, stats: k.stats, timeRules: k.timeRules }
  if (home && k.conditions.test({ kind: 'at_home' }, ctx)) return null
  if (facility && atTuningClinic(k, state, actor)) return null
  return home && facility ? '要在自己的住處或調校診所才能換技能配置。' : home ? '要在自己的住處才能換技能配置。' : '要在調校診所才能換技能配置。'
}

/** 站在調校診所嗎（ability_rule.loadout_facility_types 的設施種類；條件 at_facility 沒有人註冊時回 false）。 */
export function atTuningClinic(k: Pick<Kernel, 'content' | 'conditions' | 'stats' | 'timeRules'>, state: GameState, actor: ActorId): boolean {
  if (!k.conditions.kinds().includes('at_facility')) return false
  const types = abilityRules(k).loadout_facility_types
  return k.conditions.test(types.length > 0 ? { kind: 'at_facility', types } : { kind: 'at_facility' }, { state, actor, stats: k.stats, timeRules: k.timeRules })
}

/** 這一組換下去要花幾分鐘（衍生數值 loadout_minutes）。 */
export const loadoutMinutes = (k: Pick<Kernel, 'stats'>, state: GameState, actor: ActorId): number => (k.stats.hasStat(LOADOUT_MINUTES_STAT) ? k.stats.stat(state, actor, LOADOUT_MINUTES_STAT) : 0)

// ---- 面具 ----

/** 共用的狀況 id：戴著人格面具（豔名的「被認出來」看它；lewd 只讀，這裡掛）。 */
export const MASKED = 'masked'

/**
 * 掃橋時「藏沉溺的手段」（掛點 scan.person 的 hide；M4-followups-2 第 7 項，M4-security-m4 補記）：戴著人格面具（狀況 masked）算一種，hide 1。
 * 掛點是 features/security 宣告的，這裡只認名字與格式；沒有裝 security 沒有人問，也不會壞。
 */
export function hideAnswer(state: GameState, actor: ActorId): { hide: number } | undefined {
  return state.actors[actor]?.conditions.some((c) => c.id === MASKED) ? { hide: 1 } : undefined
}

/** 這幾個技能裡有沒有帶面具的（被動的 meat.mask，不是 pending）。 */
const hasMask = (k: Pick<Kernel, 'content'>, ids: readonly string[]): boolean =>
  ids.some((id) => {
    const ab = abilityEntry(k, id)
    return !!ab && ab.kind === 'passive' && !!ab.meat && !ab.meat.pending && !!ab.meat.mask
  })

/** 裝著入戲就掛上 masked，卸下來（原本裝著、現在沒有）就拿掉；沒變就沒有變更。 */
export function maskChanges(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, before: readonly string[], after: readonly string[]): Change[] {
  const has = state.actors[actor]!.conditions.some((c) => c.id === MASKED)
  if (hasMask(k, after)) return has ? [] : [{ op: 'actor.condition', id: actor, condition: MASKED }]
  return has && hasMask(k, before) ? [{ op: 'actor.condition', id: actor, condition: MASKED, remove: true }] : []
}

// ---- 裝與卸 ----

/** 檢查這一組裝得了（沒學的、敵人的招牌行動、某一類裝不下就丟錯）。夜課延伸的技能（night:<id>）要在 actor.ext.scene.skills 裡、標籤沒被篩選關掉。 */
function checkSet(k: Pick<Kernel, 'content' | 'stats' | 'activity'>, state: GameState, actor: ActorId, list: string[]): void {
  const mine = abilitiesOf(state, actor)
  const outside = list.some(isNightId) ? new Set(learnedOutside(k, state, actor)) : undefined
  for (const id of list) {
    const ab = abilityEntry(k, id)
    if (ab?.enemy) throw new Error('這不是學得到的技能。')
    if (isNightId(id)) {
      if (!ab) throw new Error('沒有這個技能。')
      if (filteredNight(state, ab)) throw new Error(`${ab.name}現在用不了（內容篩選關掉了這個題材）。`)
      if (!outside!.has(id)) throw new Error(`還沒學會${ab.name}。`)
      continue
    }
    if (!mine.learned.includes(id)) throw new Error(`還沒學會${ab?.name ?? id}。`)
  }
  const why = capacityBlock(capacityFor(k, state, actor, list))
  if (why) throw new Error(why)
}

/** 換成這一組之後的角色資料：戰鬥外開著的姿態如果被卸下了，姿態也關掉（不然重新裝上時它會自己又開著）。 */
function withEquipped(mine: AbilityState, list: string[]): AbilityState {
  const { stance, ...rest } = mine
  return stance !== undefined && list.includes(stance) ? { ...rest, stance, equipped: list } : { ...rest, equipped: list }
}

const namesOf = (k: Pick<Kernel, 'content'>, list: readonly string[]): string[] => list.map((id) => abilityEntry(k, id)?.name ?? id)

/**
 * 整份換掉裝著的清單（逐一裝卸的入口：UI 勾選時用；時間在套用那一次，見 applyLoadout）。
 * 有沒學的、某一類裝不下、不在可以換的地方（loadoutBlock）就丟錯（不動狀態）。報告帶 masked 的變更。
 */
export function equipAbilities(k: LoadoutKernel, state: GameState, actor: ActorId, ids: string[]): ReportDraft {
  const why = loadoutBlock(k, state, actor)
  if (why) throw new Error(why)
  const mine = abilitiesOf(state, actor)
  const list = [...new Set(ids)]
  checkSet(k, state, actor, list)
  const report = reportOf(state, actor, 'ability.equip', withEquipped(mine, list), list.length ? `裝上：${namesOf(k, list).join('、')}。` : '把裝著的技能都卸下了。', 'equipped')
  report.changes.push(...maskChanges(k, state, actor, mine.equipped, list))
  return report
}

/**
 * 一次換成一整組（UI 8.3 節的「套用」）：報告 ability.loadout，時間加衍生數值 loadout_minutes（預設 30 分鐘）。
 * 地點與副本的規則同 equipAbilities；這一組和現在裝著的一樣就丟錯（不必換，也不花時間）。報告帶 masked 的變更。
 */
export function applyLoadout(k: LoadoutKernel, state: GameState, actor: ActorId, ids: string[]): ReportDraft {
  const why = loadoutBlock(k, state, actor)
  if (why) throw new Error(why)
  const mine = abilitiesOf(state, actor)
  const list = [...new Set(ids)]
  checkSet(k, state, actor, list)
  if (list.length === mine.equipped.length && list.every((id) => mine.equipped.includes(id))) throw new Error('這一組和現在裝著的一樣，不用換。')
  const minutes = loadoutMinutes(k, state, actor)
  const summary = list.length ? `換好了技能配置：${namesOf(k, list).join('、')}。` : '把裝著的技能都卸下了。'
  const report = reportOf(state, actor, 'ability.loadout', withEquipped(mine, list), `${summary}${minutes > 0 ? `花了 ${minutes} 分鐘。` : ''}`, 'loadout')
  report.changes = [...(minutes > 0 ? [{ op: 'time', minutes } as Change] : []), ...report.changes, ...maskChanges(k, state, actor, mine.equipped, list)]
  report.timeline = [{ layer: 'meat', actor, text: `${state.actors[actor]!.name}重新配置了技能（${minutes} 分鐘）。`, tag: 'loadout' }]
  return report
}
