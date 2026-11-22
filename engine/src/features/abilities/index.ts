// L6 功能：技能（SKILLS 1.1～1.4、1.8、1.9 節；CORE_RULES 6.4 節）。
// 兩種內容（路數 path、技能 ability）、學技能（歷練點、前置、樹的階）、裝技能（橋的四類容量）、
// 把裝著的技能帶進現實戰鬥（主動技能變成行動、被動與共鳴變成修正、反應掛在攻擊之前）。
// 技能的資料是另一張工單（M1-data-abilities）；內海與輿論那兩欄只檢查格式，日常不做。
// 通用的格式（M1b-skill-format）：條件、效果清單（do）、被動的修正（mods）、姿態、反應（trigger）、照戰場分的消耗、
// 錢與人情的池、每件委託的次數、預備（prep）、buff 這個效果。
// 不 import 別的功能（射擊、換彈在 features/combat；技能自己用 run.attack）。

import type { Feature } from '../../core'
import { registerActions, registerBattle } from './battle'
import { checkAbilities, registerKinds } from './kinds'
import { registerBuff, registerMods } from './mods'
import { registerReactions } from './reactions'
import { OWNER } from './types'

export { TREE_XP } from './types'
export type { AbilityEntry, AbilityState, AbilityUse, MeatDef, ModEntry, PathEntry, PrepDef, PreparedEntry, UnitAbilities } from './types'
export { abilitiesOf, capacityOf, equipAbilities, learn, learnBlock, treeTier } from './learn'
export { unitAbilities } from './unitdata'
export { prep, prepBlock } from './prep'

export const abilitiesFeature: Feature = {
  id: OWNER,
  install(k) {
    registerKinds(k)
    registerBattle(k)
    registerMods(k)
    registerBuff(k)
    registerReactions(k)
  },
  ready(k) {
    checkAbilities(k)
    registerActions(k)
  },
}
