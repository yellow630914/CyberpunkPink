// L0 型別：屬性、基本功與各種 id。只有型別與常數，不匯入任何東西。

/** 六屬性的 id（DATA 第 1 節）。 */
export const ATTR_IDS = ['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'] as const
export type AttrId = (typeof ATTR_IDS)[number]

/** 基本功的 id。清單是資料（data/rules/skills.json），核心不寫死。 */
export type SkillId = string

/** 等級 I～V，寫成 1～5（DATA 第 1 節）。 */
export type Grade = 1 | 2 | 3 | 4 | 5

export type ActorId = string
export type ReportId = string

/** 性別的六個值（DATA 第 1 節）。TS 分成 trans_f 與 trans_m 兩個。 */
export const GENDER_IDS = ['female', 'male', 'femboy', 'trans_f', 'trans_m', 'futa'] as const
export type GenderId = (typeof GENDER_IDS)[number]
