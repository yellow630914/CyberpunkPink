// 技能這邊的衍生數值（M3-abilities-net；dev/adr/0018 第十三節）：
// - 戰鬥外也算的三個（欄的 slots、unique、sync_cap）：經 provider 加到別的功能定義的數值——deck_slots（構裝槽）、deck_slots_reserved（被專屬構裝佔掉的槽）、
//   sync_cap_bonus（同步檔位的上限，核心的 syncCapOf 讀）。provider 掛在那個數值上，數值沒有人定義就沒有人問，不會出事；
//   sync_cap_bonus 是核心讀、誰要加誰定義：沒有別人定義時這個功能在 ready 定義（基本 0）。
// - net_trace_start（這個功能定義）：預備好（prep.net.trace_start）、scope 是 commission、而且綁在進行中的那一件委託上的預備合計；沒有進行中的委託、沒綁、綁別件都是 0。
//   進行中的委託看核心活動登錄表裡 kind 是 commission 的那一段（id 是委託的 id，和預備的綁定同一個鍵），不讀別的功能的 state.ext。
// - flow_tier（這個功能定義）：主播的導流階，媒體的功能（M5）加 provider 之前是 0。
// - master_tier（這個功能定義；M3-skill-net-a）：這個角色主控（潛網者那一棵樹，路數 id 是 MASTER_PATH）的樹階，0 是沒有主控。主角（有自己的學習紀錄）：橋裡裝著那棵樹的招牌才算，
//   階數是那棵樹累計花的歷練點對到的階；夥伴（沒有自己的學習紀錄、有 actor.ext.paths）：路數那一列的階數。features/netrun 的管理行動檢定與次數讀它（它不 import 技能）。
// 欄的 slots 與 sync_cap：內海欄優先、沒寫才看現實欄（兩欄都可以寫、同一個技能不會算兩次）；unique 兩欄任何一欄有就算一個。

import type { ActorId, BattleUnit, BattleView, GameState, Kernel, RollPart } from '../../core'
import { companionAbilities, hasOwnRecord, pathRows } from './companion'
import { CAP_FLEX_STAT, abilitiesOf, capDiscountStat, ramDiscountStat, treeTierOf } from './learn'
import { abilityEntry, allAbilities, liveEquipped } from './outside'
import type { AbilityEntry, MeatDef, PathEntry, StatMod } from './types'
import { CATEGORIES, CATEGORY_NAME, OWNER } from './types'

export const TRACE_START_STAT = 'net_trace_start'
export const FLOW_TIER_STAT = 'flow_tier'
export const MASTER_TIER_STAT = 'master_tier'
/** 主控屬於哪一棵樹（潛網者的路數 id；和 features/hack 的 DEFAULT_TREE、features/netrun 規則表的 master_path 預設是同一個字）。 */
export const MASTER_PATH = 'netrunner'
const SYNC_CAP_STAT = 'sync_cap_bonus'

/** 角色裝著的技能（找不到內容的略過；夜課延伸的技能要還算數：標籤被篩選關掉的、不再學會的不在裡面）。 */
function equippedAbilities(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId): AbilityEntry[] {
  return liveEquipped(k, state, actor, abilitiesOf(state, actor).equipped).map((id) => abilityEntry(k, id)).filter((a): a is AbilityEntry => !!a)
}

/**
 * 這個人現在算數的技能 id（條件 ability 與技能給的衍生數值用）：有自己學習紀錄的（主角）看自己裝著的；沒有紀錄、有 ext.paths 的夥伴，
 * 路數那棵樹階數以內的全部算裝著（和戰鬥裡的算法一樣）。
 */
export function holdingOf(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId): { learned: string[]; equipped: string[] } {
  if (!state.actors[actor]) return { learned: [], equipped: [] }
  if (hasOwnRecord(state, actor)) {
    const mine = abilitiesOf(state, actor)
    const equipped = liveEquipped(k, state, actor, mine.equipped)
    return { learned: [...mine.learned, ...equipped.filter((id) => !mine.learned.includes(id))], equipped }
  }
  const mate = companionAbilities(k, state, actor)
  return mate ? { learned: [...mate.equipped], equipped: [...mate.equipped] } : { learned: [], equipped: [] }
}

/** 這棵樹現在的階：有自己學習紀錄的看累計花費，夥伴看 ext.paths 那一列，都沒有是 1。 */
function treeTierFor(state: GameState, actor: ActorId, path: string): number {
  if (hasOwnRecord(state, actor)) return treeTierOf(abilitiesOf(state, actor).spent[path] ?? 0)
  return pathRows(state, actor).find((r) => r.path === path)?.tier ?? 1
}

/** 這一欄算不算（有欄、沒有 pending）。 */
const live = (m: MeatDef | null | undefined): m is MeatDef => !!m && !m.pending

/** 內海欄優先、沒寫才看現實欄。 */
function numberOf(ab: AbilityEntry, key: 'slots' | 'sync_cap' | 'decay'): number {
  for (const m of [ab.net, ab.meat]) if (live(m) && typeof m[key] === 'number') return m[key]!
  return 0
}

/** 這件委託的內海階段追蹤度起始值的加減：預備的 prep.net.trace_start 合計。 */
export function traceStartOf(k: Pick<Kernel, 'content' | 'activity'>, state: GameState, actor: ActorId): number {
  const commission = k.activity.active(state).find((a) => a.kind === 'commission')?.id
  if (commission === undefined) return 0
  let sum = 0
  for (const p of abilitiesOf(state, actor).prepared ?? []) {
    if (p.scope !== 'commission' || p.key !== commission) continue
    sum += abilityEntry(k, p.id)?.prep?.net?.trace_start ?? 0
  }
  return sum
}

/** 這個角色主控的樹階（0 是沒有）：主角裝著那棵樹的招牌才算，階數看累計花的歷練點；夥伴看 ext.paths 那一列。 */
export function masterTierOf(k: Pick<Kernel, 'content'>, state: GameState, actor: ActorId): number {
  if (!state.actors[actor]) return 0
  if (!hasOwnRecord(state, actor)) return pathRows(state, actor).find((r) => r.path === MASTER_PATH)?.tier ?? 0
  const sig = k.content.get<PathEntry>('path', MASTER_PATH)?.signature
  const mine = abilitiesOf(state, actor)
  return sig !== undefined && mine.equipped.includes(sig) ? treeTierOf(mine.spent[MASTER_PATH] ?? 0) : 0
}

/** 這個單位現在的導流階（衍生數值 flow_tier；沒有角色、沒有人定義是 0）。 */
export function flowTierOf(view: Pick<BattleView, 'k' | 'state'>, u: Pick<BattleUnit, 'actor'>): number {
  if (!u.actor || !view.state.actors[u.actor] || !view.k.stats.hasStat(FLOW_TIER_STAT)) return 0
  const v = view.k.stats.stat(view.state, u.actor, FLOW_TIER_STAT)
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
}

export function registerStats(k: Kernel): void {
  k.stats.defineStat({ id: MASTER_TIER_STAT, owner: OWNER, name: '主控的樹階', base: (state, actor) => masterTierOf(k, state, actor), min: 0, max: 5 })
  k.stats.defineStat({ id: TRACE_START_STAT, owner: OWNER, name: '內海追蹤度的起始加減', base: (state, actor) => traceStartOf(k, state, actor), min: -100, max: 100 })
  k.stats.defineStat({ id: FLOW_TIER_STAT, owner: OWNER, name: '導流階', base: () => 0, min: 0, max: 9 })

  const part = (ab: AbilityEntry, value: number): RollPart[] => (value === 0 ? [] : [{ label: ab.name, value, source: 'skill' }])
  k.stats.addStatProvider('deck_slots', OWNER, (state, actor) => equippedAbilities(k, state, actor).flatMap((ab) => part(ab, numberOf(ab, 'slots'))))
  k.stats.addStatProvider('deck_slots_reserved', OWNER, (state, actor) => equippedAbilities(k, state, actor).flatMap((ab) => part(ab, [ab.net, ab.meat].some((m) => live(m) && m.unique === true) ? 1 : 0)))
  k.stats.addStatProvider(FLOW_TIER_STAT, OWNER, (state, actor) => equippedAbilities(k, state, actor).flatMap((ab) => part(ab, live(ab.net) && typeof ab.net.flow_bonus === 'number' ? ab.net.flow_bonus : 0)))
  // 內海的感載消退（deck 定義 net_load_decay，基礎 0；甲板的散熱、技能、藥、狀態加上去）：技能的欄寫 decay 就多消退幾點，戰鬥與探索都算
  k.stats.addStatProvider('net_load_decay', OWNER, (state, actor) => equippedAbilities(k, state, actor).flatMap((ab) => part(ab, numberOf(ab, 'decay'))))
  k.stats.addStatProvider(SYNC_CAP_STAT, OWNER, (state, actor) => equippedAbilities(k, state, actor).flatMap((ab) => part(ab, numberOf(ab, 'sync_cap'))))

  // 橋的三個數字（M4-abilities-m4；CYBERWARE 7.1 節：奉公、深水、蜜腺原型的機能）：這裡定義、基本是 0，橋的機能（義體的 effects）與別的功能加上去。
  // cap_discount_<類>：那一類的被動技能少佔幾點（最少佔 1）；ram_discount_<類>：那一類的主動技能少花幾點 RAM（最少花 1）；cap_flex：四類之間可以挪用幾點容量。
  for (const c of CATEGORIES) {
    k.stats.defineStat({ id: capDiscountStat(c), owner: OWNER, name: `${CATEGORY_NAME[c]}被動技能少佔的容量`, base: () => 0, min: 0, max: 6 })
    k.stats.defineStat({ id: ramDiscountStat(c), owner: OWNER, name: `${CATEGORY_NAME[c]}主動技能少花的 RAM`, base: () => 0, min: 0, max: 6 })
  }
  k.stats.defineStat({ id: CAP_FLEX_STAT, owner: OWNER, name: '四類之間可以挪用的容量', base: () => 0, min: 0, max: 24 })
}

/** 一個技能的一筆 stats 在這個人身上現在是多少：amount ＋ per_tier × 這棵樹的階，夾在 min～max。 */
export function statValue(m: StatMod, tier: number): number {
  let v = (m.amount ?? 0) + (m.per_tier ?? 0) * tier
  if (m.min !== undefined) v = Math.max(m.min, v)
  if (m.max !== undefined) v = Math.min(m.max, v)
  return v
}

/**
 * 技能的 stats 鍵：裝著時替那個衍生數值加減（手術刀的 surgery_sink_pct）。內容載入完、功能都裝好之後掃一遍，每一個用到的衍生數值掛一個 provider
 * （衍生數值沒有人定義就沒有人問；ready 之後才疊上來的內容覆蓋用到新的衍生數值，要重新建 kernel 才掛得上）。
 */
export function registerStatKeys(k: Kernel): void {
  const ids = new Set<string>()
  for (const ab of allAbilities(k)) for (const m of ab.stats ?? []) ids.add(m.stat)
  for (const id of ids) {
    k.stats.addStatProvider(id, OWNER, (state, actor) => {
      const held = holdingOf(k, state, actor).equipped
      const out: RollPart[] = []
      for (const abId of held) {
        const ab = abilityEntry(k, abId)
        for (const m of ab?.stats ?? []) {
          if (m.stat !== id) continue
          const value = statValue(m, treeTierFor(state, actor, ab!.path))
          if (value !== 0) out.push({ label: ab!.name, value, source: 'skill' })
        }
      }
      return out
    })
  }
}

/** 內容載入完、功能都裝好之後：沒有別人定義 sync_cap_bonus 時由這個功能定義（核心讀它；基本 0）。 */
export function ensureSyncCapStat(k: Kernel): void {
  if (!k.stats.hasStat(SYNC_CAP_STAT)) k.stats.defineStat({ id: SYNC_CAP_STAT, owner: OWNER, name: '同步檔位的上限加成', base: () => 0, min: -3, max: 3 })
}
