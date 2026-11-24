// L6 功能：技能（SKILLS 1.1～1.4、1.8、1.9 節；CORE_RULES 6.4 節）。
// 兩種內容（路數 path、技能 ability）、學技能（歷練點、前置、樹的階）、裝技能（橋的四類容量）、
// 把裝著的技能帶進現實戰鬥（主動技能變成行動、被動與共鳴變成修正、反應掛在攻擊之前）。
// 技能的資料是另一張工單（M1-data-abilities）；內海與輿論那兩欄只檢查格式，日常不做。
// 通用的格式（M1b-skill-format）：條件、效果清單（do）、被動的修正（mods）、姿態、反應（trigger）、照戰場分的消耗、
// 錢與人情的池、每件委託的次數、預備（prep）、buff 這個效果。
// M2（dev/work/M2-abilities-m2.md）：增援（效果 call_in、pick 的 bench）、夥伴的技能（ext.paths，G4）、名媛開打前的效果（偽裝、被識破、面具 masked、讀人）、
// 情報網（prep.effects）、換配置（地點與時間，loadout.ts）、人情池（讀衍生數值 favor_*，結束時 favor.spend）、歷練點的效果 xp。
// M3-abilities-net（dev/work/M3-abilities-net.md）：net 欄與 meat 欄同一套格式，戰鬥裡照戰場的 layer 選欄（column.ts）；use 照戰場選；
// 內海才有的鍵（admin、slots、sync_cap、unique、overclock、when.sync_min／sync_max、prep.net）；衍生數值 net_trace_start、flow_tier 與三個 provider（stats.ts）。
// M3-skill-net-a（dev/work/M3-skill-net-a.md）：四棵樹的內海欄（槍手、潛網者、改造師、機師）逐條寫成測試資料時補的通用鍵：內海欄的 instinct { div, only, fixed }（戰鬥直覺）、
// use.weapon_ram（照常花武器構裝的 RAM）、花掉全部 RAM 的技能（use.ram_all_min）內海欄可以寫 attack.spend／dice／suppress（超頻、黑冰）、attack.suppress.first_round（壓制姿態）、
// trigger.tag、react.damage、react.flash（死線、逆流、急凍：改寫閃斷）、被動技能的 net.action（手術刀的除錯）、修正 use_extra（名醫）、欄的 trace（技能做的快駭的追蹤度）；
// 衍生數值 master_tier（stats.ts：主角看裝著的招牌與學習紀錄，夥伴看 ext.paths；features/netrun 的 masterTier 讀它）。
// 不 import 別的功能（射擊、換彈在 features/combat；技能自己用 run.attack）。

import type { Feature } from '../../core'
import { registerActions, registerBattle } from './battle'
import { checkAbilities, registerKinds } from './kinds'
import { registerLoadout } from './loadout'
import { registerBuff, registerMods } from './mods'
import { registerOps } from './ops'
import { registerOut } from './out'
import { registerReactions } from './reactions'
import { registerSocial } from './social'
import { ensureSyncCapStat, registerStats } from './stats'
import { registerSuppress } from './suppress'
import { OWNER } from './types'
import { registerWard } from './ward'
import { registerXp } from './xp'

export { TREE_XP } from './types'
export type { AbilityEntry, AbilityState, AbilityUse, MeatDef, ModEntry, PathEntry, PrepDef, PreparedEntry, UnitAbilities } from './types'
export { abilitiesOf, capacityOf, learn, learnBlock, resonanceOn, treeTier } from './learn'
export { DEFAULT_ABILITY_RULES, MASKED, abilityRules, applyLoadout, equipAbilities, loadoutBlock, loadoutMinutes } from './loadout'
export type { AbilityRules } from './loadout'
export { companionAbilities, pathRows } from './companion'
export { stance, stanceBlock } from './out'
export { XP_EFFECT, xpShares } from './xp'
export { unitAbilities } from './unitdata'
export { adminCap, adminLeft, usesOf } from './use'
export { colIn, colOf, gearOf, layerOf } from './column'
export type { Layer } from './column'
export { FLOW_TIER_STAT, MASTER_PATH, MASTER_TIER_STAT, TRACE_START_STAT, masterTierOf, traceStartOf } from './stats'
export { prep, prepBlock } from './prep'
export type { PrepInput } from './prep'
export { defaultAlloc, fitAlloc, allocOf } from './instinct'

export const abilitiesFeature: Feature = {
  id: OWNER,
  install(k) {
    registerKinds(k)
    registerBattle(k)
    registerMods(k)
    registerBuff(k)
    registerReactions(k)
    registerOps(k)
    registerWard(k)
    registerSuppress(k)
    registerSocial(k)
    registerLoadout(k)
    registerOut(k)
    registerXp(k)
    registerStats(k)
  },
  ready(k) {
    checkAbilities(k)
    registerActions(k)
    ensureSyncCapStat(k)
  },
}
