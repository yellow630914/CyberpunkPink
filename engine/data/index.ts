// M0 的規則數值包（工單 dev/work/M0-data.md）。JSON 不能寫註解，所以每一種資料的出處寫在 SOURCES。
// 內容類（world/ 的勢力、NPC、敵人、遭遇、戰敗事件、地圖；rules/ 的技能、路數、道具）是暫定示意資料（docs/plan/PLAN.md 第 1 節）：
// 只給測試與冒煙用，不在這裡修文字；潤色之後經世界編輯器的匯入路徑整批換掉。不要再往這裡加新的內容。
import type { ContentPack } from '../src'
import attributes from './rules/attributes.json'
import skills from './rules/skills.json'
import perks from './rules/perks.json'
import origins from './rules/origins.json'
import creation from './rules/creation.json'
import effectCaps from './rules/effect_caps.json'
import actions from './rules/actions.json'
import battleModes from './rules/battle_modes.json'
import damageTypes from './rules/damage_types.json'
import battleStatuses from './rules/battle_statuses.json'
import weaponClasses from './rules/weapon_classes.json'
import items from './rules/items.json'
import paths from './rules/paths.json'
import abilities from './rules/abilities.json'
import maps from './world/maps.json'
import factions from './world/factions.json'
import npcs from './world/npcs.json'
import enemies from './world/enemies.json'
import encounters from './world/encounters.json'
import defeatEvents from './world/defeat_events.json'

export const CORE_PACK: ContentPack = {
  id: 'core',
  content: {
    attribute: attributes, skill: skills, perk: perks, faction: factions, npc: npcs, origin: origins, creation_rule: creation, effect_cap: effectCaps, action_kind: actions,
    battle_mode: battleModes, damage_type: damageTypes, battle_status: battleStatuses, weapon_class: weaponClasses, item: items, special_map: maps,
    enemy: enemies, encounter: encounters, defeat_event: defeatEvents,
    path: paths, ability: abilities,
  },
}

/** 每一種資料的出處（文件與節） */
export const SOURCES: Record<string, string> = {
  attribute: 'CORE_RULES 第 1 節；DATA 第 1 節（id）',
  skill: 'CORE_RULES 第 2 節；英文 id 照 DATA 1.1 節',
  perk: 'CHARACTER 第 4、5.2、5.3、6 節（smooth_talker 在第 6 節）；其餘 provisional 的借自 ui/src/data/creation.ts 的 TRAITS 與 ORIGINS[].trait（dev/adr/0004 第 5 項）',
  origin: 'CHARACTER 第 2 節；勢力與 NPC 用 DATA 1.1 節 id 表的 id（好感的勢力引用 faction、名冊引用 npc）',
  faction: 'DATA 1.1 節的勢力表（id 照 FACTIONS 第 1 節；全名、短名、類）',
  npc: 'DATA 1.1 節的具名 NPC 表與流竄 AI 表（只有 id 與名字；流竄 AI 標 rogue_ai 與原本的產品名）。完整的 NPC 格式（DATA 第 8 節）在 M2 補',
  creation_rule: 'CHARACTER 第 5.1、5.3、5.4、5.6 節',
  effect_cap: 'EVENTS 第 2.4 節 cred、cash 那一列',
  action_kind: 'AI_TASKS 3.1 節的行動種類表（殺價、打工、日常直播等那三個系統搬進來再加）',
  battle_mode: 'COMBAT_SYSTEM 第 1.2、2.1、2.5、3、4、5、6、7 節；ENEMIES 1.5 節（位階的傷害倍率）；現實一筆（內海 net 在 M3）。aiMaxSteps、decayBase、pierceOverflow 的出處見 dev/adr/0013',
  damage_type: 'COMBAT_SYSTEM 第 5 節「傷害類型」的表',
  battle_status: 'COMBAT_SYSTEM 第 5 節（壓制）、第 6 節（重創輕的一級）、第 5 節傷害類型（燃燒、失效）、第 7 節（失去回合）、標記的 +2 見 COMBAT_SYSTEM 9.1 節（偵察型）與 ITEMS 5.2 節（紙鶴），期限（到標記者的下一回合開始前）取工單；EVENTS 2.4.1 節（被壓住）',
  weapon_class: 'COMBAT_SYSTEM 第 5 節的武器表；範圍寫法（神經武器骰數、彈匣、重武器）取驗收測試的值',
  item: 'ITEMS 5.2 節的消耗品表與日用品表（束帶、鎖橋器、急救凝膠、冷卻劑、止血針、醒腦針、煙霧彈 I～II）；size 0 照 EQUIPMENT 6.1 節',
  enemy: 'ENEMY_ROSTER 第一到第五部分（現實的制式兵種）；ENEMIES 1.5、1.6 節',
  encounter: 'dev/work/M1-data-enemies.md（基準，M2 換成委託模板與二十九種戰敗事件）',
  defeat_event: 'dev/work/M1-data-enemies.md（基準，M2 換成委託模板與二十九種戰敗事件）',
  path: 'SKILL_TREES 槍手、掮客；SKILLS 1.3、1.9、1.10 節',
  ability: 'SKILL_TREES 槍手、掮客；SKILLS 1.3、1.9、1.10 節',
  special_map: 'DATA 9.3 節（小辦公室樣本）、COMMISSION_MAPS 第 1、2 節（小辦公室）與第 8 節、1.6 節樣本（俱樂部）；C 的 cells 照第 2、8 節的控制區表補',
}
