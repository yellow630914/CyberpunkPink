// 技能的型別：兩種內容（path 路數、ability 技能）與角色、單位上的資料。規格：SKILLS 1.1～1.4、1.8 節；dev/work/M1-abilities.md 第二、四節。

import type { ModKind, StatusUntil } from '../../core'

export const OWNER = 'abilities'

/** 橋的四類容量（CORE_RULES 6.4 節）。 */
export const CATEGORIES = ['meat', 'net', 'social', 'media'] as const
export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_NAME: Record<Category, string> = { meat: '現實型', net: '內海型', social: '社交型', media: '媒體型' }

export const DOMAIN_LEVELS = ['strong', 'strong_support', 'mid', 'weak', 'none'] as const
export type DomainLevel = (typeof DOMAIN_LEVELS)[number]

export const LAYERS = ['signature', 'front', 'back'] as const
export const KINDS = ['active', 'passive', 'reaction', 'stance', 'prep', 'daily'] as const

/** 一棵樹開到第 N 階，要在這棵樹累計花 TREE_XP[N-1] 點（SKILLS 1.3 節）。 */
export const TREE_XP: readonly number[] = [0, 40, 120, 240, 400]

/**
 * 這個功能自己認的修正名（不進核心的 MOD_KINDS；核心不會問，由這個功能在自己的地方查）：
 * instinct_points／instinct_cap／instinct_free 戰鬥直覺（點數加減、每項上限加減、重分配不花行動點）；
 * call_uses／call_hit 叫人（每場次數加減、支援射擊的命中加減）；
 * aim_all 大於 0 時這個人的每一次射擊都算瞄準過的；no_wound 大於 0 時打在他身上的重創改成一般的命中；
 * damage_roll 造成的傷害多這個公式（可以擲骰：打他打他！的 1d3，在命中確定之後才算一次）；
 * give_ap_cap 指揮每回合能讓的行動點加減。
 */
export const FEATURE_MOD_KINDS = ['instinct_points', 'instinct_cap', 'instinct_free', 'call_uses', 'call_hit', 'aim_all', 'no_wound', 'damage_roll', 'give_ap_cap'] as const
export type FeatureModKind = (typeof FEATURE_MOD_KINDS)[number]
export type AnyModKind = ModKind | FeatureModKind

/** 共鳴的效果（封閉清單）。 */
export interface ResonanceEffect {
  initiative?: number
  free_move?: { per_fight: number }
  /** 被動的修正，格式同 meat.mods（照這棵樹的階數；dev/work/M1b-skill-format.md 第三節） */
  mods?: ModEntry[]
  /** 資源池的上限與每回合回復的加減，格式同 meat.pool（RAM 上限 +1：{ ram: { max: 1 } }）；開打時加一次 */
  pool?: Record<string, { max?: number; regen?: number }>
  /** 感載上限的加減（有橋的人；開打時加一次，現在的感載不動） */
  load_max?: number
  pending?: true
}
export interface Resonance {
  tier: number
  cells: number
  text: string
  effect?: ResonanceEffect
}

export interface PathEntry {
  id: string
  name: string
  tree: string
  category: Category
  signature: string
  domains: { meat: DomainLevel; net: DomainLevel; opinion: DomainLevel }
  resonance: Resonance[]
  [field: string]: unknown
}

/** 技能的目標：舊的幾種（enemy、ally、self、ally_slot、enemy_slot、none）加上通用格式多的幾種。 */
export type MeatTarget =
  | 'enemy' | 'ally' | 'self' | 'ally_slot' | 'enemy_slot' | 'none'
  | 'ally_or_self' | 'near' | 'downed_near' | 'foe_slot' | 'own_overlay' | 'foe_overlay'
export type CallOption = 'shot' | 'cover_up' | 'cover_down' | 'heal' | 'vent'

/** 自己的條件（每一項一句灰掉的原因）。mods 的 when 可以多用 first_round、in_cover、other_*。 */
export interface WhenDef {
  /** 手上武器的類型（class 或特性） */
  wield?: string | string[]
  mag_min?: number
  /** true 要在機甲狀態，false 不能在機甲狀態 */
  hull?: boolean
  /** 要開著這個姿態（技能 id） */
  stance?: string
  /** 自己站第幾格 */
  slot?: number | number[]
  /** true：有拿下的控制節點；字串：那一種控制節點 */
  node_taken?: true | string
  first_round?: boolean
  in_cover?: boolean
  other_exposed?: boolean
  other_cyber?: boolean
  other_status?: string
  /** true：自己是重傷（生命低於一半） */
  wounded?: true
}

/** 目標的條件（每一項一句灰掉的原因）。 */
export interface NeedsDef {
  bridged?: boolean
  cyber?: boolean
  status?: string | string[]
  no_rank?: string[]
  rank?: string[]
  wounded?: boolean
  afterglow?: number
  tag?: string
  /** 目標的快取格裡有帶這個標籤的道具（內容裡道具的 tags；數量至少 1）：引爆爆裂物要目標身上有爆裂物 */
  cache_tag?: string
  /** 幾組條件成立任何一組就算（「重傷，或疊著餘韻」）；每一組裡不能再寫 any */
  any?: Array<Omit<NeedsDef, 'any'>>
}

/** 被動、姿態、共鳴、預備、buff 的一筆修正。value 收數字、公式或 { by_tier: [五個數字] }。 */
export interface ModEntry {
  kind: AnyModKind
  value?: number | string | { by_tier: number[] }
  tags?: string[]
  who?: 'self' | 'adjacent' | 'allies' | 'behind'
  when?: WhenDef
  per_fight?: number
  per_turn?: number
  /** crit_margin 專用：改成超過迴避幾以上就算要害 */
  to?: number
}

export const TRIGGER_ON = ['attacked', 'hit', 'after', 'hp_half', 'overload', 'checked', 'out_before'] as const
export type TriggerOn = (typeof TRIGGER_ON)[number]
export interface TriggerDef {
  on: TriggerOn
  who: string
  /** attacked 沒有；hit：wound；after：miss、hit、melee、bridged；checked：檢定的標籤 */
  if?: string
}

/** 反應能改的東西（看 trigger.on）。 */
export interface ReactDef {
  evade?: number | string
  hit?: number | string
  redirect?: 'overlay'
  /** redirect 專用：擋槍的那一台可以掛在被打的人同一格（0）或相鄰幾格以內（1：攔截）。沒寫：who 是 with_own_overlay 時 0，其餘 1 */
  reach?: number
  no_wound?: true
  negate?: true
  keep_turn?: true
  dc?: number | string
  prevent?: { how: string[] }
  /** hit 專用：這一擊的穿甲加減（獵殺節奏） */
  pierce?: number | string
}

export interface PickDecl {
  key: string
  label: string
  kind: 'foe' | 'ally' | 'ally_slot' | 'foe_slot' | 'choice'
  required?: boolean
  /** kind 是 ally 時：只有和自己相鄰的隊友選得了（掩護撤退） */
  adjacent?: true
  /** kind 是 foe、ally 而且技能的目標是人時：選的人不能就是目標自己（「另一個敵人」「和誰對調」） */
  apart?: true
}
export interface ChooseEntry {
  key: string
  label: string
  do: Array<Record<string, unknown>>
  when?: WhenDef
  needs?: NeedsDef
}
export interface AlterEntry {
  ability: string
  set: Record<string, unknown>
  as_pick?: { key: string; label: string }
  /** 裝著這個技能的人要符合這些條件才改（彈幕：要開著那個姿態） */
  when?: WhenDef
}

/** 攻擊之後的壓制：被打的人過定力檢定（dc 加 dc_bonus），失敗就被壓制。area 讓目標相鄰一格上的人或整排也各自檢定；auto 是姿態：命中就壓制、不必檢定。 */
export interface SuppressDef {
  dc?: 'spent' | number
  skill?: string
  area?: 'adjacent' | 'row'
  dc_bonus?: number
  auto?: true
  /** auto 專用：每回合前幾次 */
  per_turn?: number
}

/** `meat` 欄的封閉清單（M1-abilities 第四節＋M1b-skill-format 第二～四節）。 */
export interface MeatDef {
  target?: MeatTarget
  attack?: {
    aimed?: boolean
    hit?: number
    /** 'all'：彈匣裡剩下的全部；數字：花這麼多格（點放） */
    spend?: 'all' | number
    min_mag?: number
    dice?: 'spent_minus_1'
    suppress?: SuppressDef
    at?: 'attacker'
    /** true：這一次連射不花彈匣（花掉的格數照樣算在傷害與壓制上：火力牆） */
    free_mag?: true
  }
  apply?: Array<{ status: string; until?: StatusUntil }>
  free_move?: { swap_adjacent_pair?: boolean }
  /** per_turn：每回合只有前幾次花 ap，之後照原價。cost 與 weapon_cost 都寫時兩邊共用同一個回合計數（所以數字要一樣） */
  cost?: { ability: string; ap: number; per_turn?: number }
  weapon_cost?: { trait: string; ap: number; per_turn?: number }
  /** 舊的寫法是字串（ally_attacked、ally_attacked_adjacent）；新的是 { on, who, if? } */
  trigger?: 'ally_attacked' | 'ally_attacked_adjacent' | TriggerDef
  evade?: number
  on_hit?: { hit_against_ally?: number }
  give_ap?: { max: 'one_plus_half_tier' }
  call?: { options: CallOption[]; per_fight: 'half_tier_up'; ap: number; heal?: number | string; vent?: number | string }
  instinct?: true
  pending?: true
  // ---- 通用格式（M1b-skill-format） ----
  needs?: NeedsDef
  when?: WhenDef
  range?: [number, number]
  picks?: PickDecl[]
  do?: Array<Record<string, unknown>>
  choose?: ChooseEntry[]
  mods?: ModEntry[]
  react?: ReactDef
  do_on?: Array<Record<string, unknown>>
  do_off?: Array<Record<string, unknown>>
  tags?: string[]
  pool?: Record<string, { max?: number; regen?: number }>
  alter?: AlterEntry[]
  /** 保釋：裝著的人在隊上時，全隊倒下的戰敗事件多一個「被贖回」，付這個數字的現金（公式，例 'grade*1000'） */
  ransom?: { cash: number | string }
  /** 開戰時做一次（黑市門路；指定的隊友從開打前的指定來，見 AbilityState.preset.picks） */
  on_start?: Array<Record<string, unknown>>
  /** 姿態開著時，指揮把行動點讓給一名隊友之後對他做的效果（號令） */
  on_give_ap?: Array<Record<string, unknown>>
}

/** 一組消耗。`use` 可以直接寫一組（每個戰場都一樣），或照戰場分 meat、net、opinion（E1）。 */
export interface AbilityUse {
  ap?: number
  ram?: number
  /** 花掉手上全部的 RAM，至少要有這麼多；花掉的數字是公式的 spent */
  ram_all_min?: number
  /** 現金（公式，例 'grade*500'） */
  cash?: number | string
  favor?: 'small' | 'mid' | 'big'
  per_turn?: number
  per_fight?: number
  per_commission?: number
  first_round?: boolean
  not_first_round?: boolean
  /** 共用每回合次數的一組：同一組的技能合起來算 per_turn */
  group?: string
  /** 幾個時段（預備與日常用） */
  slot?: number
  note?: string
  /** 照戰場分（寫了其中任何一個，這一層就只放這三個鍵） */
  meat?: AbilityUse
  net?: AbilityUse
  opinion?: AbilityUse
}

/** 預備（kind 是 prep）：下一場現實戰鬥帶進去的效果。text 是舊的說明文字。 */
export interface PrepDef {
  text?: string
  slot?: number
  scope?: 'next_battle' | 'commission'
  meat?: { mods?: ModEntry[]; do?: Array<Record<string, unknown>> }
}

export interface AbilityEntry {
  id: string
  name: string
  text: string
  path: string
  category: Category
  tier: number
  layer: (typeof LAYERS)[number]
  kind: (typeof KINDS)[number]
  cap: number
  xp: number
  cells: number
  after?: string
  use?: AbilityUse
  meat: MeatDef | null
  net: Record<string, unknown> | null
  opinion: Record<string, unknown> | null
  prep?: PrepDef | null
  daily?: Record<string, unknown> | null
  [field: string]: unknown
}

/** 預備好、等著帶進戰鬥的一筆。key 是 commission 型的綁定的委託（第一次用到時才綁）。 */
export interface PreparedEntry {
  id: string
  scope: 'next_battle' | 'commission'
  key?: string
}

/** 角色身上的資料（actor.ext.abilities）。 */
export interface AbilityState {
  xp: number
  learned: string[]
  equipped: string[]
  spent: Record<string, number>
  /** 每件委託的次數：委託的鍵 → 技能 id → 用了幾次（dev/adr/0015 E3） */
  commission?: Record<string, Record<string, number>>
  /** 預備好的（dev/adr/0015 E4） */
  prepared?: PreparedEntry[]
  /** 開打前的指定（開打時才讀；沒有就用預設）：戰鬥直覺的分配、黑市門路指定的隊友 */
  preset?: { instinct?: { initiative: number; hit: number; evade: number }; picks?: Record<string, string> }
}

/** 戰鬥裡每個單位的資料（unit.ext.abilities）。 */
export interface UnitAbilities {
  equipped: string[]
  tiers: Record<string, number>
  /** 開打前的指定（黑市門路指定的隊友：鍵 → 隊友的角色 id 或單位 id） */
  picks?: Record<string, string>
}

/** 一段時間的修正（buff 這個效果掛的）：到期時做 on_end。 */
export interface UnitBuff {
  id: string
  name: string
  turns: number
  until: StatusUntil
  /** 數回合時看誰的回合：自己的（own_*）或給的人的（source_*） */
  of: string
  by: string
  /** 公式用的樹階 */
  tier: number
  /** 給的是哪個技能（紀錄與 on_end 的來源） */
  source: { kind: string; id: string; name: string }
  mods: ModEntry[]
  on_end: Array<Record<string, unknown>>
}
