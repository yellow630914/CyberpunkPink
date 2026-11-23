// 換技能配置（CORE_RULES 6.4 節、UI 8.3 節、SKILLS 1.7 節；dev/adr/0016 G1）：
// - 在據點（自己的住處）或調校診所換，花半小時；進了委託副本不能換（少數技能與道具例外，M2 沒有）。
//   條件 at_home、at_facility 由別的功能註冊（rest、world）：有人註冊才限地點，兩個都沒有就不限；
//   衍生數值 loadout_anywhere 大於 0 的人（織女 標準：委託副本以外哪裡都能換；橋的型號是 M4，現在只開了這個接口）不限地點。
// - 時間是衍生數值 loadout_minutes（預設 30；橋的型號接上之後由那個功能加減）。一次換成一整組用 applyLoadout（報告 ability.loadout，加時間）；
//   equipAbilities 是逐一裝卸的入口（報告 ability.equip），照同一條地點的規則，時間在套用那一次才算。
// - 面具：裝著入戲（被動的 meat.mask）的角色身上掛著 masked（共用的狀況 id，豔名的「被認出來」看它），卸下來就拿掉；裝卸的報告裡帶那一筆變更。

import type { ActorId, Change, ContentEntry, GameState, Kernel, ReportDraft } from '../../core'
import { isSafeInt } from '../../core'
import { abilitiesOf, capacityFor, reportOf } from './learn'
import type { AbilityEntry, AbilityState } from './types'
import { CATEGORIES, CATEGORY_NAME, OWNER } from './types'

// ---- 規則 ----

export const RULE_KIND = 'ability_rule'
export interface AbilityRules {
  /** 換技能配置的基礎時間（分鐘） */
  loadout_minutes: number
  /** 調校診所的設施種類（at_facility 的 types；空的是任何設施都算） */
  loadout_facility_types: string[]
  /** 留在家的夥伴拿一份歷練點的幾成（CORE_RULES 7.1 節：三成） */
  xp_home_share: number
}
/** 半小時：UI 8.3 節的示意；CORE_RULES 6.4 節寫一小時，使用者 2026-11-23 定案統一半小時（dev/adr/0016 G1）。 */
export const DEFAULT_ABILITY_RULES: AbilityRules = { loadout_minutes: 30, loadout_facility_types: ['tuning_clinic'], xp_home_share: 0.3 }

export function abilityRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.loadout_minutes !== undefined && !(isSafeInt(e.loadout_minutes) && e.loadout_minutes >= 0)) p.push('loadout_minutes 要是 0 以上的整數（換技能配置花幾分鐘）')
  if (e.loadout_facility_types !== undefined && !(Array.isArray(e.loadout_facility_types) && e.loadout_facility_types.every((t) => typeof t === 'string' && t.trim().length > 0))) p.push('loadout_facility_types 要是設施種類 id 的陣列（空的是任何設施都算調校診所）')
  if (e.xp_home_share !== undefined && !(typeof e.xp_home_share === 'number' && e.xp_home_share >= 0 && e.xp_home_share <= 1)) p.push('xp_home_share 要是 0～1 的數字（留在家的夥伴拿一份歷練點的幾成）')
  return p
}

/** 規則：內容種類 ability_rule（id: default）蓋掉內建的預設。 */
export function abilityRules(k: Pick<Kernel, 'content'>): AbilityRules {
  const e = k.content.get<ContentEntry & Partial<AbilityRules>>(RULE_KIND, 'default')
  return {
    loadout_minutes: e?.loadout_minutes ?? DEFAULT_ABILITY_RULES.loadout_minutes,
    loadout_facility_types: e?.loadout_facility_types ? [...e.loadout_facility_types] : [...DEFAULT_ABILITY_RULES.loadout_facility_types],
    xp_home_share: e?.xp_home_share ?? DEFAULT_ABILITY_RULES.xp_home_share,
  }
}

export const LOADOUT_MINUTES_STAT = 'loadout_minutes'
export const LOADOUT_ANYWHERE_STAT = 'loadout_anywhere'

export function registerLoadout(k: Kernel): void {
  k.content.defineKind({ kind: RULE_KIND, owner: OWNER, validate: abilityRuleProblems })
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
  if (facility) {
    const types = abilityRules(k).loadout_facility_types
    if (k.conditions.test(types.length > 0 ? { kind: 'at_facility', types } : { kind: 'at_facility' }, ctx)) return null
  }
  return home && facility ? '要在自己的住處或調校診所才能換技能配置。' : home ? '要在自己的住處才能換技能配置。' : '要在調校診所才能換技能配置。'
}

/** 這一組換下去要花幾分鐘（衍生數值 loadout_minutes）。 */
export const loadoutMinutes = (k: Pick<Kernel, 'stats'>, state: GameState, actor: ActorId): number => (k.stats.hasStat(LOADOUT_MINUTES_STAT) ? k.stats.stat(state, actor, LOADOUT_MINUTES_STAT) : 0)

// ---- 面具 ----

/** 共用的狀況 id：戴著人格面具（豔名的「被認出來」看它；lewd 只讀，這裡掛）。 */
export const MASKED = 'masked'

/** 這幾個技能裡有沒有帶面具的（被動的 meat.mask，不是 pending）。 */
const hasMask = (k: Pick<Kernel, 'content'>, ids: readonly string[]): boolean =>
  ids.some((id) => {
    const ab = k.content.get<AbilityEntry>('ability', id)
    return !!ab && ab.kind === 'passive' && !!ab.meat && !ab.meat.pending && !!ab.meat.mask
  })

/** 裝著入戲就掛上 masked，卸下來（原本裝著、現在沒有）就拿掉；沒變就沒有變更。 */
function maskChanges(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, before: readonly string[], after: readonly string[]): Change[] {
  const has = state.actors[actor]!.conditions.some((c) => c.id === MASKED)
  if (hasMask(k, after)) return has ? [] : [{ op: 'actor.condition', id: actor, condition: MASKED }]
  return has && hasMask(k, before) ? [{ op: 'actor.condition', id: actor, condition: MASKED, remove: true }] : []
}

// ---- 裝與卸 ----

/** 檢查這一組裝得了（沒學的、敵人的招牌行動、某一類裝不下就丟錯）。 */
function checkSet(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId, list: string[]): void {
  const mine = abilitiesOf(state, actor)
  for (const id of list) {
    if (k.content.get<AbilityEntry>('ability', id)?.enemy) throw new Error('這不是學得到的技能。')
    if (!mine.learned.includes(id)) throw new Error(`還沒學會${k.content.get<AbilityEntry>('ability', id)?.name ?? id}。`)
  }
  const cap = capacityFor(k, state, actor, list)
  for (const c of CATEGORIES) {
    if (cap[c].used > cap[c].max) throw new Error(`${CATEGORY_NAME[c]}的容量不夠（要 ${cap[c].used}，橋只有 ${cap[c].max}）。`)
  }
}

/** 換成這一組之後的角色資料：戰鬥外開著的姿態如果被卸下了，姿態也關掉（不然重新裝上時它會自己又開著）。 */
function withEquipped(mine: AbilityState, list: string[]): AbilityState {
  const { stance, ...rest } = mine
  return stance !== undefined && list.includes(stance) ? { ...rest, stance, equipped: list } : { ...rest, equipped: list }
}

const namesOf = (k: Pick<Kernel, 'content'>, list: readonly string[]): string[] => list.map((id) => k.content.get<AbilityEntry>('ability', id)?.name ?? id)

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
