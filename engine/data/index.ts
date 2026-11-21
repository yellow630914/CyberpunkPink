// M0 的規則數值包（工單 dev/work/M0-data.md）。JSON 不能寫註解，所以每一種資料的出處寫在 SOURCES。
import type { ContentPack } from '../src'
import attributes from './rules/attributes.json'
import skills from './rules/skills.json'
import perks from './rules/perks.json'
import origins from './rules/origins.json'
import creation from './rules/creation.json'
import effectCaps from './rules/effect_caps.json'

export const CORE_PACK: ContentPack = {
  id: 'core',
  content: { attribute: attributes, skill: skills, perk: perks, origin: origins, creation_rule: creation, effect_cap: effectCaps },
}

/** 每一種資料的出處（文件與節） */
export const SOURCES: Record<string, string> = {
  attribute: 'CORE_RULES 第 1 節；DATA 第 1 節（id）',
  skill: 'CORE_RULES 第 2 節；基本功的英文 id 為暫定（dev/adr/0004 第 3 項）',
  perk: 'CHARACTER 第 4、5.2、5.3、6 節（smooth_talker 在第 6 節）；其餘 provisional 的借自 ui/src/data/creation.ts 的 TRAITS 與 ORIGINS[].trait（dev/adr/0004 第 5 項）',
  origin: 'CHARACTER 第 2 節；勢力與 NPC 用中文名（dev/adr/0004 第 4 項）；企業十二家借 ui/src/data/creation.ts 的 CORPS，已對 FACTIONS 第 1 節',
  creation_rule: 'CHARACTER 第 5.1、5.3、5.4、5.6 節',
  effect_cap: 'EVENTS 第 2.4 節 cred、cash 那一列',
}
