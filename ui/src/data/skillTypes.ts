// 技能樹、夜課與指南的型別（資料由 scripts/build-content.mjs 從文件產生，見 content.generated.ts）。

export type TreeId = 'gun' | 'pilot' | 'surgeon' | 'runner' | 'actor' | 'broker' | 'streamer' | 'idol'
export type SkillKind = 'active' | 'passive' | 'reaction' | 'stance' | 'prep' | 'daily'
export type CapCategory = '現實' | '內海' | '社交' | '媒體'

export interface SkillDef {
  id: string
  tree: TreeId
  name: string
  tier: number
  /** 招牌、前層、後層（SKILLS 1.10 節） */
  layer: 'sig' | 'front' | 'back'
  kind: SkillKind
  kindName: string
  /** 佔的容量 */
  cap: number
  /** 前置技能的名字（同一棵樹） */
  pre: string | null
  cost: string
  weight: string
  real: string
  net: string
  opinion: string
  /** 第 3 層圖標（sk_…）；沒有就用 ic-sk_<樹>_<種類> */
  icon: string | null
  /** 三條線的第幾條（0～2）；招牌是 -1 */
  line: number
}

export interface SkillTreeDef {
  id: TreeId
  name: string
  signature: string
  category: CapCategory
  intro: string
  /** 這棵樹在三個戰場的強弱：強、中、弱、無 */
  strength: { real: string; net: string; opinion: string }
  resonance: Array<{ tier: number; effect: string }>
  skills: SkillDef[]
}

export type NightBranchId = 'common' | 'relation' | 'sense' | 'body' | 'look'

export interface NightSkillDef {
  id: string
  branch: NightBranchId
  name: string
  tier: number
  how: string
  /** 掛在哪個標籤（共通寫「共通」） */
  tag: string
  need: string
  use: string
  kind: 'active' | 'passive' | 'reaction' | 'stance' | 'pose'
  parts: string
  effect: string
  deep: string
  /** 延伸到成人場景以外的技能（要裝進橋，佔社交類） */
  extends: boolean
  icon: string | null
}

export interface NightBranchDef {
  id: NightBranchId
  name: string
  intro: string
  /** 共通的開階條件（性經歷）；其他分支看軸的等級 */
  gates: Array<{ tier: number; need: string }>
  resonance: Array<{ tier: number; effect: string }>
  skills: NightSkillDef[]
}

export interface GuideMeta { id: string; category: string; title: string; trigger: string; source: string }
export interface GuidePage { image: string; text: string }
