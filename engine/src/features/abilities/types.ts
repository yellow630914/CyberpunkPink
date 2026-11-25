// 技能的型別：兩種內容（path 路數、ability 技能）與角色、單位上的資料。規格：SKILLS 1.1～1.4、1.8 節；dev/work/M1-abilities.md 第二、四節。

import type { ModKind, StatusUntil, SyncGear } from '../../core'

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
 * give_ap_cap 指揮每回合能讓的行動點加減；
 * tease_hit、tease_bonus 誘惑攻擊的命中與傷害加減（媚態的 1d3、繞指柔、共鳴 5 的 +1；tease_bonus 的公式可以擲骰，在傷害要算的那一刻才問一次）；
 * use_extra 某個技能每場的次數加幾次（M3-skill-net-a：名醫「除錯每場可以用兩次」；tags 寫那個技能的 id，只算寫了 per_fight 的技能）；
 * M3-skill-net-b：remote_uses 遠端叫人每場次數加減（內海欄的叫人；現實的 call_uses 在內海欄寫不了）；no_flash 大於 0 時這個人過載不閃斷（RAM 不歸零、閃斷拿掉：護盤）；
 * ram_free 帶這些標籤的行動花掉的 RAM 做完退回來（定調、曝光的共鳴；tags 或 tags_any 寫行動的 id，per_fight 每場只退幾次）；no_pin 大於 0 時這個人釘不住（為你而唱）；
 * link_relief 偶像替隊友分擔感載時自己少受幾點（我還可以！）；turn_extra 寫了 per_turn 的技能（或同一組）每回合多幾次（tags 寫技能的 id 或組的名字；繞指柔：誘惑攻擊每回合 2 次）。
 */
export const FEATURE_MOD_KINDS = [
  'instinct_points', 'instinct_cap', 'instinct_free', 'call_uses', 'call_hit', 'aim_all', 'no_wound', 'damage_roll', 'give_ap_cap', 'tease_hit', 'tease_bonus', 'use_extra',
  'remote_uses', 'no_flash', 'ram_free', 'no_pin', 'link_relief', 'turn_extra',
] as const
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
  /** 生命上限的加減（開打時加一次，現在的生命跟著加，不超過新的上限） */
  hp_max?: number
  pending?: true
}
export interface Resonance {
  tier: number
  cells: number
  text: string
  effect?: ResonanceEffect
  /** 只在內海戰鬥生效的效果（M3-skill-net-b：媒體型現實沒有效果，effect 寫不了；內海戰鬥時 effect 與 net 兩份都算） */
  net?: ResonanceEffect
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
  /** 對手有契約義體（implants 裡有 contract：授權鎖，改造師的解鎖匠看這個） */
  other_contract?: true
  /**
   * 對象是自己或相鄰的隊友（問 other 的修正才有意思：heal_dealt 的 other 是被回復的人）。問花費（action_ap）時沒有對象，這一項當成成立
   * （道具與技能的行動自己已經把對象限在自己或相鄰一格，不相鄰的人根本選不了）
   */
  target_near?: true
  /** true：自己是重傷（生命低於一半） */
  wounded?: true
  /** true：自己這一場還沒發動過攻擊（連射、反應裡的攻擊都算一次；偽裝的「第一次攻擊」） */
  first_attack?: true
  /** true：這一場開打前沒有被識破（開戰設定 origin.ext.pre.spotted 不是 true；偽裝：被識破的這一場不生效） */
  not_spotted?: true
  /** 同步檔位至少是這一檔才算（看單位的 sync:<檔> 標籤，沒有標籤的單位當標準；M3-abilities-net） */
  sync_min?: SyncGear
  /** 同步檔位至多是這一檔才算 */
  sync_max?: SyncGear
  /** 導流階（衍生數值 flow_tier）至少是這麼多才算（主播的導流技能；0 階時原因是「還沒有頻道。」；M3-skill-net-b） */
  flow_min?: number
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
  /** true：目標身上已經有一件被干擾的義體（off_* 或 jammed 狀態）：找縫的「無視 4 點」 */
  implant_off?: true
  /** 目標帶著這些標籤裡的任何一個就不行（安撫對黑蕾絲無效：'lace:black'；M3-skill-net-b） */
  no_tag?: string | string[]
  /** true：目標有人格（化身，或帶 persona 標籤的蕾絲；沒有 persona 的蕾絲與程式沒有；M3-skill-net-b） */
  persona?: true
  /** 幾組條件成立任何一組就算（「重傷，或疊著餘韻」）；每一組裡不能再寫 any */
  any?: Array<Omit<NeedsDef, 'any'>>
}

/** 被動、姿態、共鳴、預備、buff 的一筆修正。value 收數字、公式或 { by_tier: [五個數字] }。 */
export interface ModEntry {
  kind: AnyModKind
  value?: number | string | { by_tier: number[] }
  tags?: string[]
  /** 問修正時帶的標籤裡有其中任何一個就算（和 tags 並用時兩邊都要成立）：名醫的「急救或戰場急救」 */
  tags_any?: string[]
  /** 算出來的數字不低於這個（義體學代替格鬥：差是負的就不加） */
  min?: number
  who?: 'self' | 'adjacent' | 'allies' | 'behind' | 'linked'
  when?: WhenDef
  per_fight?: number
  per_turn?: number
  /** true：問的對手（other）要是給這一段修正的人才算（只有 buff 的 mods 用：留下來的「他攻擊你的命中 −2」，掛在被誘惑的人身上、只對下手的人有效） */
  vs_source?: true
  /**
   * crit_margin：改成超過迴避幾以上就算要害。
   * action_ap：這個行動改成只花這麼多點（原價比它少就不動）：手術刀的「只花 1 點」、巡房的「不花行動點」（to: 0）
   */
  to?: number
}

export const TRIGGER_ON = ['attacked', 'hit', 'after', 'hp_half', 'overload', 'checked', 'out_before'] as const
export type TriggerOn = (typeof TRIGGER_ON)[number]
export interface TriggerDef {
  on: TriggerOn
  who: string
  /** attacked 沒有；hit：wound；after：miss、hit、melee、bridged；checked：檢定的標籤 */
  if?: string
  /** attacked、hit、after 專用：這一擊帶著這個標籤才算（攻擊效果的 tags，例如超頻的 overclock；M3-skill-net-a：點放「每場第一次超頻之後」） */
  tag?: string
  /** 做這件事的人（攻擊的人、讓他過載的人、擲檢定的人、讓他退出的人）要符合的條件：needs 同技能的 needs，range 是和反應的人的距離（討債：有橋、距離 2 以內）。沒帶 by 的事不觸發 */
  by?: { needs?: NeedsDef; range?: [number, number] }
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
  /** attacked 專用：這一擊的傷害加減（負的是少；非請勿看：感載 −4）。傷害不會低於 0 */
  damage?: number | string
  /**
   * overload 專用（內海的閃斷；M3-skill-net-a）：改寫這一次過載的閃斷。ram：歸零的那一池補回去多少（half 是歸零之前的一半，進位；before 是全部補回；full 是補滿）；
   * end：拿掉閃斷的狀態（RAM 照樣在下個回合開始時回復）。死線 { ram: 'half' }、逆流 { ram: 'full', end: true }、急凍 { ram: 'before', end: true }。現實的過載（失去回合）不做
   */
  flash?: { ram?: 'half' | 'before' | 'full'; end?: true }
  /** overload 專用（偶像的大家不要走）：這一次過載不斷開同步、被接上的隊友不吃脫鉤衝擊 */
  keep_link?: true
  /** hit 專用：這一擊結算完之後，被打的人換到相鄰的一格（有空格先去空格，沒有就和相鄰的隊友交換），不花行動點（替身）。要和 negate 一起寫 */
  then_move?: true
}

export interface PickDecl {
  key: string
  label: string
  /**
   * drone：選單位上 ext.summons.drones 裡的哪一台（值是第幾台，給 drone.deploy 的 drone 讀）。
   * foe_overlay：選敵方沒被擊落的哪一台掛著的東西（值是那一台的 id，效果 who: 'foe_overlay' 讀 pick.overlay，所以鍵要叫 overlay；畫面用 choice 列出）
   * bench：選哪一個候補（選項來自 view.bench：值是候補的 id；沒空的列著並帶原因；增援的效果 call_in 讀 pick[key]）
   */
  kind: 'foe' | 'ally' | 'ally_slot' | 'foe_slot' | 'choice' | 'drone' | 'foe_overlay' | 'bench'
  /** kind 是 bench 時：只列這條路數的人（名冊上帶這個路數的角色：ext.paths；掮客遠端叫潛網者寫 netrunner） */
  path?: string
  required?: boolean
  /** kind 是 ally 時：只有和自己相鄰的隊友選得了（掩護撤退） */
  adjacent?: true
  /** kind 是 foe、ally 而且技能的目標是人時：選的人不能就是目標自己（「另一個敵人」「和誰對調」） */
  apart?: true
  /** kind 是 foe、ally 時：選的人要符合這些條件（不符合的選項灰掉，寫出原因）；range 是和自己的距離（傾城的第二個目標：有橋、距離 2 以內） */
  needs?: NeedsDef
  range?: [number, number]
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
  /** auto 專用：只在第一回合（內海的壓制姿態） */
  first_round?: true
}

/**
 * 誘惑攻擊（M1b-skill-social；dev/adr/0015 E8）：一次檢定加一次快感傷害，不走武器攻擊（沒有要害與重創、不傷遮蔽）。
 * 做的人擲 1d20 ＋ mod(魅力) ＋ 誘惑（＋ hit ＋ 修正 tease_hit ＋ 檢定的修正，標籤 tease），對 10 ＋ 目標的 mod(意志) ＋ 定力；
 * 過了：造成 2d6（＋ bonus ＋ 修正 tease_bonus）快感傷害，再做 on_ok；這一下讓目標過載的話再做 on_overload。
 * targets 是 2 時（傾城）多選一個目標，各擲各的。
 */
export interface TeaseDef {
  hit?: number | string
  bonus?: number | string
  on_ok?: Array<Record<string, unknown>>
  on_overload?: Array<Record<string, unknown>>
  targets?: 1 | 2
}

/** 戰鬥外的檢定修正：帶這些標籤（tags 全部都要有）、用這項基本功（skill，沒寫不限）的檢定加 value。tags 與 skill 至少要寫一個。 */
export interface OutMod {
  tags?: string[]
  skill?: string
  value: number
}

/**
 * 欄的封閉清單（M1-abilities 第四節＋M1b-skill-format 第二～四節）：`meat`（現實）與 `net`（內海）同一套，照戰場的 layer 選哪一欄（column.ts）。
 * 型別叫 MeatDef 是歷史；內海欄有幾個鍵沒有意義、載入時擋掉（format.ts 的 NET_BLOCKED_KEYS）。
 */
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
  /**
   * 戰鬥直覺。現實欄寫 true（點數是樹階，戰鬥中每回合可以重分配）；內海欄寫物件（M3-skill-net-a）：points 是點數除以幾進位（槍手 3：階數 ÷ 3 無條件進位）、
   * only 是只能分到哪幾項（命中、迴避）、fixed 是整場不能重分配（開戰時隨機分配之後，之後點數增加的部分也是照種子隨機放進還沒到上限的項）
   */
  instinct?: true | InstinctNet
  pending?: true
  /** 給玩家看的說明（pending 的欄用它寫原文；不影響效果） */
  text?: string
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
  /** 這個技能的行動多帶的標籤（花費的修正與 action.done 都認得）：治療類的寫 heal，巡房、名醫的「每回合第一次治療」靠它 */
  action_tags?: string[]
  pool?: Record<string, { max?: number; regen?: number }>
  alter?: AlterEntry[]
  /** 保釋：裝著的人在隊上時，全隊倒下的戰敗事件多一個「被贖回」，付這個數字的現金（公式，例 'grade*1000'） */
  ransom?: { cash: number | string }
  /** 開戰時做一次（黑市門路；要指定誰的一律隨機：先 pick_random 再 who: 'pick:<key>'） */
  on_start?: Array<Record<string, unknown>>
  /** 姿態開著時，指揮把行動點讓給一名隊友之後對他做的效果（號令） */
  on_give_ap?: Array<Record<string, unknown>>
  // ---- 名媛（M1b-skill-social） ----
  /** 入戲：戴著面具（被動，裝著就有）。到第 rounds 回合為止（含），AI 挑目標時不挑她，除非她是唯一打得到的目標，或她這一回合已經攻擊過那個敵人 */
  mask?: { rounds: number }
  /**
   * 姿態：戰鬥外也開得了（偽裝）。check：開著的時候，戰鬥外帶這些標籤（tags 全部都要有）、用這項基本功（skill，沒寫不限）的檢定加 value；
   * on_start：這個姿態從戰鬥外開著帶進一場戰鬥時，開打做一次的效果。開打還開著，單位的姿態就是它（照一般的姿態：第一回合第一次攻擊命中 +2 等寫在 mods）
   */
  out?: { check: OutMod; on_start?: Array<Record<string, unknown>> }
  /** 被動：裝著的時候，戰鬥外帶這些標籤的檢定加多少（演技派、入骨：infiltrate +2、+4） */
  out_mods?: OutMod[]
  /** 誘惑攻擊。主動技能：這個技能的行動就是一次誘惑攻擊（目標是有橋、距離 2 以內的敵人）；被動（入戲）：多一個基本的誘惑攻擊行動（2 點、每回合 1 次，組 tease）。反應用 { op: 'tease' } */
  tease?: TeaseDef
  // ---- 內海（M3-abilities-net；兩欄都可以寫，內海用得到） ----
  /** 構裝槽加減（戰鬥外也算：衍生數值 deck_slots 的來源；欄裡兩邊都有寫時內海欄優先） */
  slots?: number
  /** 管理行動的基數（內海戰鬥開打時寫成 unit.ext.net.admin）：'tier' 是這棵樹的階數；多個來源加起來 */
  admin?: 'tier' | number
  /** 內海裡每個回合多消退幾點感載（戰鬥每輪與探索回合都算；衍生數值 net_load_decay 的來源之一：內海的基礎消退是 0，使用者 2026-11-24）。1 以上的整數 */
  decay?: number
  /** 同步檔位的上限加幾級（戰鬥外也算：衍生數值 sync_cap_bonus 的來源；姿態在戰鬥裡用的是修正 sync_cap） */
  sync_cap?: number
  /** 這一欄是招牌的專屬構裝：佔一個構裝槽（衍生數值 deck_slots_reserved），淺檔整欄不生效（ITEMS 11.7、CYBERSPACE 6.4） */
  unique?: true
  /** 被動（kind 是 passive）的技能在這一欄多一個主動的行動（改造師招牌手術刀的「除錯」）：有 target、do 或 choose 的欄才成立；用 use 的那一組消耗 */
  action?: true
  /** 技能做的快駭的追蹤度（正整數；帶 hack 標籤的行動，內海每用一次追蹤度加它，現實被發現時給敵對值；dev/status.md M3-hack-net 回報）。兩欄各寫各的 */
  trace?: number
  // ---- 內海（M3-skill-net-b；只有內海欄能寫：現實欄寫了整筆擋下。現實的 tease、mask、give_ap、call 在內海欄仍然擋掉，這幾個是內海版） ----
  /** 誘惑攻擊的內海版（格式同 tease）：距離 3 以內、傷害 2d6 ＋ mod(魅力)；目標要有人格（needs.persona：化身或帶 persona 標籤的蕾絲） */
  lure?: TeaseDef
  /** 戴著面具（被動，裝著就有）：戰鬥結束時的報告標出 data.masked（敵對值與豔名不連到本人；「留下痕跡」的變更這一批沒有來源）。不影響敵人挑目標 */
  masked?: true
  /** 指揮的內海版：每回合最多讓 max 點行動點（行動 <技能 id>.command；號令的 on_give_ap 照樣生效） */
  command?: { max: number }
  /** 叫人的內海版：遠端叫名冊上帶 path 路數的人出手（行動 <技能 id>.remote_call）。hack：對一個敵人丟一次他的快駭；wall：替我方一格補一級防火牆；vent：替一名隊友排感載（vent 寫數字） */
  remote_call?: { options: Array<'hack' | 'wall' | 'vent'>; per_fight: number; ap: number; path: string; vent?: number | string }
  /** 這一欄的效果裡公式的 tier 讀導流階（衍生數值 flow_tier），夾在 cap 以內（灌流：傷害加導流階，最多 +3） */
  flow?: { cap?: number }
  /** 被動：導流階 +n（衍生數值 flow_tier 的 provider；老粉都在） */
  flow_bonus?: number
  /** 應援（共鳴）：被動，裝著就有一個行動 <技能 id>.link（花 use.ap 接上最多「樹階 + 1」名隊友、之後每回合自動維持、分擔感載、過載時斷開、開著時每回合追蹤度 +1） */
  link?: true
  /** 曲目（姿態）：同步檔位在淺檔時，這一欄所有修正的數字減半（無條件捨去）；when 的 sync_min／sync_max 寫「深檔以上」那一條 */
  song?: true
  /** 曲目：開著時，同步中的隊友讓敵人過載，那名隊友做這些效果（每個回合全隊一次；安可退還 1 點行動點）。落在那名隊友身上 */
  on_link_overload?: Array<Record<string, unknown>>
  /** 曲目：開著時，替隊友分擔感載改成全額承受（絕唱） */
  link_full?: true
  /** 曲目：開著時，同步中的隊友套用偶像現在的同步檔位（全員同步） */
  link_gear?: true
}

/** 內海欄的戰鬥直覺（見 MeatDef.instinct）。 */
export interface InstinctNet {
  /** 點數 = ceil(樹階 / div) */
  div: number
  /** 只能分到這幾項 */
  only: Array<'initiative' | 'hit' | 'evade'>
  /** 整場不能重分配 */
  fixed: true
}

/** 一組消耗。`use` 可以直接寫一組（每個戰場都一樣），或照戰場分 meat、net、opinion（E1）。 */
export interface AbilityUse {
  ap?: number
  ram?: number
  /** 花幾次管理行動（只有內海用：結算時走效果 net.admin_spend，次數不夠時行動灰掉） */
  admin?: number
  /** 花掉手上全部的 RAM，至少要有這麼多；花掉的數字是公式的 spent */
  ram_all_min?: number
  /** true：再加上手上武器構裝自己的 RAM 花費（武器的 pool.ram，沒寫是 1；只有內海用：瞄準過的攻擊、帶攻擊的技能「照常花 RAM」） */
  weapon_ram?: true
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
  /**
   * 預備帶進內海戰鬥的（mods、do 照 meat 的做法）；trace_start 是這件委託內海階段追蹤度起始值的加減
   * （衍生數值 net_trace_start：scope 是 commission、綁在進行中的那件委託上的預備才算）
   */
  net?: { mods?: ModEntry[]; do?: Array<Record<string, unknown>>; trace_start?: number }
  /**
   * 預備的當下就在戰鬥外結算的效果（走 k.effects；沒有人註冊的種類略過那一筆）。字串裡的 $target、$commission、$tendency 換成輸入的人、
   * 輸入的委託、那個人傾向裡的一個標籤（tendency:<標籤>；讀不到是 tendency:none）。
   */
  effects?: Array<Record<string, unknown>>
  /** person：預備時要選一個人（輸入的 target）；帶進戰鬥的 meat.mods 只對那個人有效 */
  target?: 'person'
  /** 戰鬥外的檢定修正（只對選的那個人有效，要有 target: 'person'）：讀人的「對他的誘惑與交涉檢定 +2」。預備用掉之前一直有效 */
  out_mods?: OutMod[]
}

/**
 * 敵人招牌行動的 AI 資料（ENEMIES 4.3、4.5 節）。註冊成行動時變成 aiScore：條件不符回 null，否則回 score（加上第一、二回合與低血解開的加分）。
 * 沒有 ai 的技能 AI 不會用。反應、被動、姿態不用分數：裝著就有（姿態在 AI 的第一個回合自己開）。
 * 玩家的技能也可以寫（之後 AI 操縱的夥伴用得到）。
 */
export interface AbilityAi {
  /** 基準分（武器攻擊是 2） */
  score: number
  /** 第一、二回合多加幾分 */
  first_rounds?: number
  /** AI 才看的條件：自己的條件同 meat.when 與 mods 的 when（含 first_round、in_cover、other_*），再加 target_hp_below（目標的生命比例低於這個數字才列：治療、補刀） */
  when?: WhenDef & { target_hp_below?: number }
  /** low：生命 ≤ 40%，或餘韻疊到承受層數 − 1 才解開；每場一次；解開之後分數 +1（ENEMIES 4.5 節） */
  unlock?: 'low'
}

/**
 * 技能的內容。標了 `enemy: true` 的是敵人的招牌行動（M1b-enemy-moves）：path、tier、layer、cap、xp、after、category、cells、net、opinion 可以不寫
 * （不寫時執行時是 undefined；讀它們之前先看 enemy）；不能學、不能裝進橋；公式的 tier 代單位的等級。
 */
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
  enemy?: true
  ai?: AbilityAi
  use?: AbilityUse
  meat: MeatDef | null
  net: MeatDef | null
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
  /** 選的那個人（prep.target 是 person 的預備） */
  target?: string
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
  /** 戰鬥外開著的姿態（技能 id；要有 meat.out）。開打還開著就帶進戰鬥 */
  stance?: string
}

/** 戰鬥裡每個單位的資料（unit.ext.abilities）。 */
export interface UnitAbilities {
  equipped: string[]
  tiers: Record<string, number>
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
  /** true：他在自己的回合裡給自己的 own_turn_end，這個回合的結束不算（數到第一次時拿掉記號、不扣 turns；核心 run.skipsOwnTurnEnd 的規則，和狀態一致） */
  skip?: true
  /** 面具（換臉、千面）：有 rounds 的到那一回合為止（含），沒有的在這一段 buff 還在的時候都算；規則同被動的 meat.mask */
  mask?: { rounds?: number }
}
