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
// M3-skill-net-b（dev/work/M3-skill-net-b.md）：名媛、掮客、主播、偶像四棵樹的內海欄補的通用鍵：net.lure（誘惑攻擊的內海版：距離 3、傷害加魅力調整值、needs.persona）、net.masked（面具；
// 戰鬥結束標 data.masked）、net.command（指揮每回合 1 點）、net.remote_call（遠端叫名冊上帶某路數的人）、pick bench 的 path、net.flow／flow_bonus 與 when.flow_min（導流階）、
// net.link／song／on_link_overload／link_full／link_gear（偶像的應援與曲目，link.ts）、needs.no_tag、resonance.net（只在內海生效的共鳴）、修正 remote_uses／no_flash／ram_free／no_pin／link_relief／turn_extra、
// react.keep_link、mods 與反應的 who: linked、效果 link.each／link.dump、狀態 pacified（安撫：攻擊類行動的花費加一大筆）。
// M4-creation-body（dev/work/M4-creation-body.md）：建角第 8 步（掛點 creation.step 的 abilities：逐一跑學技能的規則、沒有橋不能學）、建角之後按順序裝進橋（report.after，creation.ts）。
// M4-training（dev/work/M4-training.md；training.ts）：基本功 5、6 級的請教（向人，三種付法：親密度、學費、旗標 taught:<npc>:<skill>）與去機構上課（設施種類的 teach）；每升一級上幾個時段，
//   上完立下記號（actor.ext.abilities.lessons），skillUpDraft 看到就不擋；條件 can_teach；報告 ability.lesson；匯出 teachOptions、lessonBlock、lessonDraft。他在不在場問條件 npc_here（features/npcs 註冊）。
// M4-craft-teach（dev/work/M4-craft-teach.md；training.ts 的另一段）：向 NPC 學工藝基本功 0～2 級（npc 內容的 tutor、規則 ability_rule.tutor、actor.ext.abilities.tutored）；條件 can_tutor；報告 ability.tutor；匯出 tutorOptions、tutorBlock、tutorDraft。
// M5-abilities-opinion（dev/work/M5-abilities-opinion.md；opinion.ts、dailystat.ts）：技能的輿論欄翻成輿論戰的掛點 opinion.moves／passives／open 的回答（主動、被動、共鳴 resonance[i].opinion、反應、
//   開著的姿態、預備）、經 opinion.check 驗；use.opinion 多 edit、per_war；日常的 daily.stat／tier_min 變成衍生數值的 provider（十個，DAILY_STATS）；導流階的加值（老粉都在）只在本來的導流階大於 0 時才加。
// 不 import 別的功能（射擊、換彈在 features/combat；技能自己用 run.attack）。

import type { Feature, GameState } from '../../core'
import { registerActions, registerBattle } from './battle'
import { registerCreation } from './creation'
import { registerCondition } from './daily'
import { registerDailyStats } from './dailystat'
import { checkAbilities, registerKinds } from './kinds'
import { hideAnswer, registerLoadout } from './loadout'
import { registerBuff, registerMods } from './mods'
import { registerOps } from './ops'
import { registerOpinion } from './opinion'
import { registerOut } from './out'
import { registerReactions } from './reactions'
import { registerSocial } from './social'
import { ensureSyncCapStat, registerStatKeys, registerStats } from './stats'
import { registerSuppress } from './suppress'
import { checkTeach, checkTutor, registerTraining } from './training'
import { registerCapacityWatch } from './warn'
import { OWNER } from './types'
import { registerWard } from './ward'
import { registerXp } from './xp'

export { TREE_XP } from './types'
export type { AbilityEntry, AbilityState, AbilityUse, Lesson, LessonFrom, MeatDef, ModEntry, PathEntry, PrepDef, PreparedEntry, UnitAbilities } from './types'
export { CAP_FLEX_STAT, abilitiesOf, capDiscountStat, capacityBlock, capacityOf, capCostOf, learn, learnBlock, ramDiscountStat, resonanceOn, treeTier, treeTierOf } from './learn'
export type { Capacity } from './learn'
export { DEFAULT_ABILITY_RULES, MASKED, abilityRules, applyLoadout, atTuningClinic, equipAbilities, loadoutBlock, loadoutMinutes } from './loadout'
export type { AbilityRules, TeachRules } from './loadout'
export { companionAbilities, pathRows } from './companion'
export { stance, stanceBlock } from './out'
export { XP_EFFECT, xpShares } from './xp'
export { unitAbilities } from './unitdata'
export { adminCap, adminLeft, usesOf } from './use'
export { colIn, colOf, gearOf, layerOf } from './column'
export type { Layer } from './column'
export { FLOW_TIER_STAT, MASTER_PATH, MASTER_TIER_STAT, TRACE_START_STAT, masterTierOf, traceStartOf } from './stats'
export { DISSECT_DAILY, DISSECT_TAG, dailyKindOf } from './daily'
export { DAILY_STATS } from './dailystat'
export { movesFor, opensFor, passivesFor, opinionUse } from './opinion'
export { NIGHT_KIND, NIGHT_PREFIX, abilityEntry, allAbilities, isNightId, learnedOutside, liveEquipped, nightAbilities } from './outside'
export { NEEDS_TEACHER, RESPEC_ACTION, SKILL_UP_ACTION, respecBlock, respecDraft, respecQuote, skillUpBlock, skillUpCost, skillUpDraft } from './train'
export type { RespecQuote } from './train'
export { FACILITY_MAX, LESSON_ACTION, TUTOR_ACTION, lessonBlock, lessonDraft, taughtFlag, teachMin, teachOptions, teachableSkills, tutorBlock, tutorDraft, tutorMax, tutorOptions, tutorableSkills } from './training'
export type { FacilityTeach, LessonOpts, TeachFrom, TeachOption, TeachPay, TeachPayView, TutorData, TutorOpts, TutorOption } from './training'
export { CAPACITY_ACTION } from './warn'
export { holdingOf, statValue } from './stats'
export { NO_BRIDGE_ABILITY } from './creation'
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
    registerOpinion(k)
    registerXp(k)
    registerStats(k)
    registerCondition(k)
    registerCapacityWatch(k)
    // 掃橋：戴著人格面具算一種「藏沉溺的手段」（掛點 scan.person 是 features/security 宣告的）
    ;(k.hooks.on.bind(k.hooks) as unknown as (name: string, owner: string, fn: (payload: never) => unknown) => void)('scan.person', OWNER, (({ state, actor }: { state: GameState; actor: string }) => hideAnswer(state, actor)) as never)
    registerCreation(k)
    registerTraining(k)
  },
  ready(k) {
    checkAbilities(k)
    checkTeach(k)
    checkTutor(k)
    registerActions(k)
    ensureSyncCapStat(k)
    registerStatKeys(k)
    registerDailyStats(k)
  },
}
