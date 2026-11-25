// L5 戰鬥：戰場（mode）、數字、傷害類型與狀態。全部是資料驅動的：核心帶著照設計書寫的預設值，
// 資料（內容種類 battle_mode、damage_type、battle_status）載入之後以資料為準（和 effect_cap 同一個做法）。
//
// 現實與內海是同一套戰鬥（MIGRATION 第 5 節第 2 點；CYBERSPACE 第 6 節「不另外做一套」）：兩個戰場只差在這個檔的 BattleMode 的幾個欄位，
// 以及功能各自註冊的行動（射擊與換彈、攻擊與回填……）。dev/adr/0010。

import type { AttrId, BattleStatus, DamageType, Grade, UnitRank } from '../types'
import { ATTR_IDS, DAMAGE_TYPES, UNIT_RANKS } from '../types'
import type { ContentEntry, ContentRegistry } from '../content/registry'
import { isRecord } from '../util/sanitize'
import { battleAttr } from '../rules/sync'

/** 戰鬥的數字（COMBAT_SYSTEM 第 1～7 節；ENEMIES 1.5 節）。每一個戰場各一份，沒寫的用這裡的預設。 */
export interface BattleNumbers {
  /** 每回合回復的行動點（起始值；技能、義體、裝備可以提高）：3 */
  apRegen: number
  /** 被埋伏的一方第一回合從「上限 − 2」開始 */
  apAmbushed: number
  /** 一個人一個回合最多讓 AI 做幾步（ENEMIES 第 4 節） */
  aiMaxSteps: number
  /** 迴避的基礎：10 */
  evadeBase: number
  /** 超過迴避這麼多是要害：5 */
  critMargin: number
  /** 超出適用距離每一格的修正：−2 */
  rangeStep: number
  /** 長槍站在第 1 格的修正：−4 */
  longAtFront: number
  /** 瞄準過的射擊的命中加值：+3 */
  aimedHit: number
  /** 遮蔽給的迴避：[暴露, 半掩體, 掩體] */
  coverBonus: [number, number, number]
  /** 遮蔽每一級的耐久，照場景的等級 I～V */
  coverHp: { half: number[]; full: number[] }
  /** 沒有人站的那一格，遮蔽受到的傷害倍率：2 */
  emptyCoverMult: number
  /** 指定打遮蔽：倍率乘多少、至少多少（×2、至少 ×1） */
  aimCover: { mult: number; min: number }
  /** 黑暗：全場迴避 +2（有夜視的攻擊不算） */
  darkEvade: number
  /**
   * 感載每回合自然消退的基礎。現實：decayBase ＋ mod(意志)（CORE_RULES 4.2 節）；最少 0。
   * 戰場寫了 decayStat 的（內海）：decayBase ＋ 那個衍生數值（單位的 decay）＋ 修正 decay，沒有 mod(意志)；內海的 decayBase 是 0（使用者 2026-11-24：內海裡感載不自然消退）
   */
  decayBase: number
  /** 穿甲超過護甲的部分算不算額外的傷害。false：穿甲只抵銷護甲（BALANCE 的模擬照這個算）。dev/adr/0013 */
  pierceOverflow: boolean
  /** 位階的傷害倍率：敵人造成的生命傷害扣掉護甲之後乘（ENEMIES 1.5 節）。內海不用（都是 1） */
  rankDamage: Record<UnitRank, number>
  /** 制伏（內海是釘住）的 DC：base ＋ 目標的等級 × perGrade，精英與首領再加 */
  subdueDc: { base: number; perGrade: number; elite: number; boss: number }
  /** 脫離的 DC：base ＋ 敵方最高的等級 × perGrade */
  fleeDc: { base: number; perGrade: number }
}

export const DEFAULT_NUMBERS: BattleNumbers = {
  apRegen: 3,
  apAmbushed: -2,
  aiMaxSteps: 6,
  evadeBase: 10,
  critMargin: 5,
  rangeStep: -2,
  longAtFront: -4,
  aimedHit: 3,
  coverBonus: [0, 2, 4],
  coverHp: { half: [15, 15, 20, 25, 30], full: [30, 30, 40, 50, 60] },
  emptyCoverMult: 2,
  aimCover: { mult: 2, min: 1 },
  darkEvade: 2,
  decayBase: 2,
  pierceOverflow: false,
  rankDamage: { minion: 0.4, elite: 0.6, boss: 1 },
  subdueDc: { base: 10, perGrade: 2, elite: 2, boss: 4 },
  fleeDc: { base: 10, perGrade: 2 },
}

/** 一個戰場（現實、內海）。 */
export interface BattleMode {
  id: string
  name: string
  /** 報告的 timeline 標哪一層 */
  layer: 'meat' | 'net'
  /** 這個戰場的單位有哪幾條軌：現實是生命與感載，內海只有感載 */
  tracks: Array<'hp' | 'load'>
  /** 過載之後（感載歸零、疊一層餘韻、還沒倒下）：lose_turn 失去下一個回合（現實）；flash 閃斷，一池資源歸零、不失去回合（內海） */
  overload: 'lose_turn' | 'flash'
  /** 閃斷歸零的是哪一池 */
  flashPool?: string
  /** 餘韻每一層：roll 是所有檢定（命中、迴避、豁免）的加減（現實全屬性 −2，就是 −1；內海 +1）；loadDealtPct 是自己造成的感載多幾 % */
  afterglow: { roll: number; loadDealtPct: number }
  /** 護甲（防護）擋不擋感載：現實不擋，內海的防護構裝直接減感載 */
  armorOnLoad: boolean
  /** 遮蔽三級的名字：[暴露, 半掩體, 掩體]；內海是防火牆節點 */
  coverNames: [string, string, string]
  /** 「遮蔽」這個字在這個戰場怎麼說 */
  coverWord: string
  numbers: BattleNumbers
  /**
   * 這個戰場裡某個屬性由另一個代替（內海：體格由意志代替，CYBERSPACE 4.1 節；dev/adr/0018 第一節）。
   * run.save 在這個戰場把屬性照它換過再算；組武器的功能（構裝的命中與固定傷害）用 battleAttr（rules/sync.ts）查。沒寫就是不換
   */
  attrAs?: Partial<Record<AttrId, AttrId>>
  /** 角色的護甲（防護）讀哪一個衍生數值（unitFromActor）：現實是 armor（裝備的功能註冊），內海是 net_guard（防護構裝）。沒有人註冊那個數值就是 0 */
  guardStat?: string
  /**
   * 感載每回合自然消退讀哪一個衍生數值（單位的 decay；unitFromActor 抄進來）。有寫的戰場：消退 = numbers.decayBase ＋ 這個數值 ＋ 修正 decay，沒有 mod(意志)。
   * 內海是 net_load_decay（基本 0；甲板的散熱、技能、構裝、藥、狀態可以加）。沒有人註冊那個數值就是 0。沒寫的戰場（現實）照 decayBase ＋ mod(意志)
   */
  decayStat?: string
  /**
   * 個人的脫離（N12）：我方每一個人都是用 out 這種方式退出、而且一方在場與後方都沒有人時，這一場的結果是 outcome，不是 lose
   * （待遇照 fled：不是戰敗、不留等著選的戰敗）。有人是別的方式退出（倒下、被釘住、被制伏）就照舊是 lose。內海是 { out: 'jacked_out', outcome: 'jack_out' }
   */
  leave?: { out: string; outcome: string }
}

/** 核心帶的兩個戰場（CORE_RULES 4.2 節的表；CYBERSPACE 6.1 節的對照表）。資料裡有 battle_mode 時以資料為準。 */
export const DEFAULT_MODES: Record<string, BattleMode> = {
  meat: {
    id: 'meat', name: '現實', layer: 'meat', tracks: ['hp', 'load'], overload: 'lose_turn',
    afterglow: { roll: -1, loadDealtPct: 10 }, armorOnLoad: false,
    coverNames: ['暴露', '半掩體', '掩體'], coverWord: '遮蔽', numbers: DEFAULT_NUMBERS,
    guardStat: 'armor',
  },
  net: {
    id: 'net', name: '內海', layer: 'net', tracks: ['load'], overload: 'flash', flashPool: 'ram',
    afterglow: { roll: 1, loadDealtPct: 10 }, armorOnLoad: true,
    coverNames: ['暴露', '半防火牆', '防火牆'], coverWord: '防火牆',
    numbers: { ...DEFAULT_NUMBERS, decayBase: 0, rankDamage: { minion: 1, elite: 1, boss: 1 } },
    attrAs: { body: 'resolve' }, guardStat: 'net_guard', decayStat: 'net_load_decay', leave: { out: 'jacked_out', outcome: 'jack_out' },
  },
}

/** 一種傷害怎麼算（COMBAT_SYSTEM 第 5 節的表）。 */
export interface DamageTypeRule {
  id: DamageType
  name: string
  /** 打哪一條 */
  track: 'hp' | 'load'
  /** 護甲算幾成：1 照扣、0.5 無視一半、0 不看 */
  armor: number
  /** 對沒有橋的目標無效 */
  needsBridge?: boolean
  /** 對帶著這個標籤的目標傷害乘多少（電磁對 machine ×2） */
  vs?: Record<string, number>
  /** 命中而且有傷害時給的狀態（熱能的燃燒、電磁的失效）：狀態的 id 與幾個回合 */
  onHit?: Array<{ status: string; turns: number }>
  /** 每次命中沉溺加多少（快感）。戰鬥結束時寫回角色 */
  sink?: number
  /** 這一種傷害的攻擊，傷害骰多幾顆（負的是少）：電磁與熱能的武器少一顆（COMBAT_SYSTEM 第 4 節）。最少還是擲一顆 */
  dice?: number
}

export const DEFAULT_DAMAGE_TYPES: Record<DamageType, DamageTypeRule> = {
  physical: { id: 'physical', name: '物理', track: 'hp', armor: 1 },
  thermal: { id: 'thermal', name: '熱能', track: 'hp', armor: 0.5, onHit: [{ status: 'burning', turns: 2 }], dice: -1 },
  em: { id: 'em', name: '電磁', track: 'hp', armor: 0, vs: { machine: 2 }, onHit: [{ status: 'jammed', turns: 1 }], dice: -1 },
  neural: { id: 'neural', name: '神經', track: 'load', armor: 0, needsBridge: true },
  pleasure: { id: 'pleasure', name: '快感', track: 'load', armor: 0, needsBridge: true, sink: 1 },
}

/**
 * 重創的四個部位（COMBAT_SYSTEM 第 6 節）。id 是戰鬥共用的語彙：瞄準過的射擊由攻擊者指定部位（AttackOpts.part、wound 掛點的 part），
 * 每個部位輕重兩級的效果由註冊 wound 掛點的功能做。
 */
export const WOUND_PARTS = [
  { id: 'limb', name: '肢體' },
  { id: 'head', name: '頭' },
  { id: 'torso', name: '軀幹' },
  { id: 'bridge', name: '橋' },
] as const

/**
 * 核心認得的幾個單位標籤（被動效果 { unit_tag } 給；dev/adr/0019 實作補記 M4-core-gaps）。功能不在核心裡 import 彼此，約定寫在這裡：
 *   ignore_wound_penalty   重傷（生命低於一半）的檢定 −2 對他不算（痛覺編輯器）
 *   implant_hardened       他的義體不會被特殊效果打壞（run.implantStatus 的 off 一律不挑）；寫成 implant_hardened:<種類> 只保護那一種義體（皮下裝甲）
 *   afterglow_double       每層餘韻的正面效果加倍（沉溺 80～99、渴求）：內海的檢定 +1、兩個戰場的「造成的感載 +10%」；現實的檢定 −1 是負面的，不加倍
 *   sink_resist            沉溺每次上升 −1、最少 1（調校的 sink_resist）：戰鬥裡 run.gainSink 與戰後的昏倒 +2、角色的 sink 效果（往上加的那一邊）讀它；
 *                          下限（sink_floor）把沉溺抬上去不算「上升」，不受它影響
 */
export const IGNORE_WOUND_PENALTY = 'ignore_wound_penalty'
export const IMPLANT_HARDENED = 'implant_hardened'
export const AFTERGLOW_DOUBLE = 'afterglow_double'
export const SINK_RESIST = 'sink_resist'

/**
 * 熔斷器的三種標籤（M4-followups-2 第 3 項；CYBERSPACE 6「精神污染」、CYBERWARE 7.1、7.5 節）。每一座橋出廠都有熔斷器（大潮崩之後的規定）；
 * 下面三個是「熔斷器和一般的不一樣」的橋，被動效果 { unit_tag } 給（橋的設計圖 effects 寫）：
 *   breaker_first   機械式熔斷器（織女 初鳴）：每場戰鬥第一次過載不疊餘韻（感載照樣歸零、照樣失去回合或閃斷；這一次也不會因為餘韻疊滿而昏過去）
 *   breaker_crude   黑市重接的熔斷器（野戰・無鎖）：每次過載（疊餘韻的那一種）有 BREAKER_CRUDE_CHANCE 的機會多疊 1 層（疊到承受層數為止，不會因此昏過去）
 *   no_breaker      沒有熔斷器（聖堂自製、赤線系列）：戰鬥裡沒有特別的規則；掃橋時掃不過閘門（features/security 的 scan.person 的 breaker: false，只剩掉頭）。
 *                   「拔掉的人只是讓自己能被殺」：引擎裡沒有死亡，這一半沒有做
 */
export const BREAKER_FIRST = 'breaker_first'
export const BREAKER_CRUDE = 'breaker_crude'
export const NO_BREAKER = 'no_breaker'
/** 黑市熔斷器每次過載多疊一層的機會（CYBERWARE 7.5 節：一成）。 */
export const BREAKER_CRUDE_CHANCE = 0.1

/**
 * 「斷藥」狀態的 id 約定（程式「斷藥」、腳本「斷藥」；ITEMS 11.5 節；M4-core-gaps 第 5 項）：資料（battle_status）定義它的名字、說明與持續幾回合（兩回合；III 三回合）。
 * 帶著它的單位：run.vent 排不掉感載（除錯、回復都沒有效果）；義體功能讀它——藥泵（cyber_pump）與標了 jammable 的行動（冷卻迴路）這段時間不能用。
 * 規則表沒有這個狀態時，給這個狀態的效果會丟「查不到狀態」，不會悄悄沒事。
 */
export const PUMP_JAM = 'pump_jam'

/** 沉溺這一次要上升 amount 點：帶著 sink_resist 的人少 1 點、最少 1（amount 本來不到 2 的不變）。 */
export const sinkRise = (amount: number, resist: boolean): number => (resist && amount > 1 ? amount - 1 : amount)

/** 修正的種類：狀態、技能、義體用這些鍵加減戰鬥裡的數字。 */
export const MOD_KINDS = [
  /** 自己攻擊的命中 */ 'hit',
  /** 別人打他時攻擊者的命中（標記 +2） */ 'hit_against',
  /** 迴避 */ 'evade',
  /** 傷害骰的顆數 */ 'dice',
  /** 固定的傷害 */ 'damage',
  /** 穿甲 */ 'pierce',
  /** 護甲 */ 'armor',
  /** 要害的門檻（負的是更容易） */ 'crit_margin',
  /** 豁免與戰鬥裡的檢定 */ 'save',
  /** 先攻 */ 'initiative',
  /** 每回合回復的行動點（來源是義體、藥、裝備、構裝的正值合計全身最多 +1：TEMPO_SOURCES） */ 'ap_regen',
  /** 每回合回復的 RAM（夾法同 ap_regen：dev/adr/0019 P13） */ 'ram_regen',
  /** 自己造成的感載（百分比） */ 'load_dealt_pct',
  /** 自己受到的感載（百分比；同步檔位的 ×0.5 是 −50） */ 'load_taken_pct',
  /** 感載每回合的自然消退 */ 'decay',
  /** 換位花的行動點（負的是減免） */ 'move_ap',
  /**
   * 任何一個行動花的行動點（負的是減免；最少 0）。問的時候 tags 是 [行動的 id, 'group:<圈>', 行動自己宣告的標籤…]
   * （核心定的標籤：weapon_attack，用手上那一把武器攻擊一次），目標是自己以外的人時再多一個 'other'（替別人用道具）；
   * weapon 是手上那一把，base 是行動自己算的行動點。技能的「退還或減免行動點」（SKILLS 1.8 節）掛在這裡；
   * 「每回合第一次才便宜」的次數在 action.done 掛點記
   */ 'action_ap',
  /**
   * 行動花的 RAM 加減（負的是減免）：只在這個行動本來就花 RAM 的時候算，最少 1（花 0 點的行動不會因此多花）。
   * 問的時候帶的標籤與 action_ap 一樣（dev/adr/0015 第二節）
   */ 'action_ram',
  /** 自己造成的回復多幾點（做的人的修正；問的時候 other 是被回復的人，tags 是 run.heal 帶的標籤：道具是 ['item', …物品的標籤]）。不帶「誰做的」的回復不吃這個 */ 'heal_dealt',
  /** 自己造成的排感載多幾點（同 heal_dealt） */ 'vent_dealt',
  /** 敵人 AI 挑目標時，這個人（候選）的權重加減幾個百分點：問的是候選人，other 是正在挑的 AI。−100 就是不挑他；候選全部都是 0 時當成沒有這個修正（dev/adr/0015 第二節） */ 'ai_target_pct',
  /** 大於 0 的人攻擊時不吃黑暗（和 night_vision 標籤並存） */ 'see_dark',
  /** 目標的防火牆加減（快駭與內海的檢定對它）；問的是被擲檢定的那一方 */ 'firewall',
  /** 重創的級數加減（−1：重的改成輕的）；features/combat 擲部位時問 */ 'wound_grade',
  /**
   * 操作者放出一台和人重疊的東西時，那一台的耐久（現在與上限）、護甲、迴避加減幾點（run.addOverlay 問；問的是操作者，標籤是 [種類]）。
   * 沒有操作者的不問（dev/adr/0015 第三節）
   */ 'overlay_hp', 'overlay_armor', 'overlay_evade',
  /** 同時連得住幾台和人重疊的東西，加減幾台（features/summons 問放出的上限；問的是操作者，標籤是 [種類]，支援型多一個 support） */ 'overlay_cap',
  /** 自己放的一台被擊落時，操作者受的感載（基本 5 點）加減幾點，最少 0（features/summons 問；問的是操作者，標籤是 [種類]） */ 'overlay_backlash',
  /**
   * 站在這一格的人吃到的遮蔽多（負的是少）幾級，最高到掩體、最低暴露（問的是站在那一格的人，run.coverOf 問；堡壘姿態：後面那一格高一級，
   * 寫成 { kind: 'cover_level', value: 1, who: 'behind' }）。多出來的級數是加上去的、不是那一格的遮蔽本身：打不破（遮蔽的耐久只看那一格自己的），
   * 修正一消失（姿態關了、換了位）就沒了；迴避、暴露（監視）、AI 挑目標看的是加過的（技能的 in_cover、other_exposed 條件還看那一格本身的，見 dev/adr/0015 補記）
   */ 'cover_level',
  /**
   * 內海的六種（dev/adr/0018 第一節）：核心只認得名字（狀態、技能的資料寫得進來），用到的是 features/netcombat 與 features/netrun。
   * admin_uses：每回合管理行動的次數加減幾次（問的是做管理行動的人）
   */ 'admin_uses',
  /** 回填多回幾點 RAM（問的是回填的人；負的是少） */ 'refill',
  /** 戰鬥每回合加的追蹤度加減幾點（問的是開戰的那一方的人；netcombat 每回合問一次） */ 'trace_round',
  /** 每次管理行動加的追蹤度加減幾點（問的是做管理行動的人） */ 'trace_admin',
  /** 同步檔位的上限加減幾級（問的是換檔的人；和 rules/sync.ts 的 syncCapOf 算出來的上限相加，最高到全檔） */ 'sync_cap',
  /** 每回合可以換檔幾次的加減（基本 1 次；問的是換檔的人） */ 'sync_shifts',
] as const
export type ModKind = (typeof MOD_KINDS)[number]

/** 狀態什麼時候結束的幾種寫法（資料用）。next_overload：帶著它的人下一次過載的時候，沒有過載就到整場結束。 */
export const STATUS_UNTILS = ['own_turn_end', 'own_turn_start', 'source_turn_start', 'source_turn_end', 'battle_end', 'next_overload', 'next_attack'] as const
export type StatusUntil = (typeof STATUS_UNTILS)[number]

/** 一個戰鬥中的狀態（壓制、暈眩、流血、標記、失去回合……）：資料驅動，核心照這幾個欄位算。 */
export interface BattleStatusRule {
  id: string
  name: string
  desc: string
  /** 帶著的時候的加減，鍵是修正的種類 */
  mods?: Partial<Record<ModKind, number>>
  /** 不能換位（壓制） */
  noMove?: boolean
  /** 失去回合：輪到他時直接跳過，並拿掉這個狀態（過載、癱瘓） */
  loseTurn?: boolean
  /** 帶著它的人，回合開始時這幾池不回復（池的 id：ram；ap 是行動點）。閃斷用它：RAM 斷了，到他的回合結束前不回 */
  noRegen?: string[]
  /** 每個自己的回合開始時：行動點加減、生命加減（流血 −2）、擲幾顆骰扣生命（燃燒 1d6）、感載加減 */
  turnStart?: { ap?: number; hp?: number; hpDice?: number; load?: number }
  /** turnStart 只發生一次，發生完就拿掉（暈眩：下回合行動點 −2） */
  once?: boolean
  /** 預設什麼時候結束、幾個回合 */
  until: StatusUntil
  turns: number
  /** 種類：control（控制：首領有控制保護）、debuff、buff、wound（重創的輕的那一級）、mark */
  kind: 'control' | 'debuff' | 'buff' | 'wound' | 'mark'
  /** 什麼可以解掉它（first_aid 止血；cleanse 一律可以） */
  cleansedBy?: string[]
}

/** 核心一定有的狀態：過載之後的失去回合（現實）、閃斷（內海）。其餘（壓制、暈眩、流血、標記、燃燒……）由資料給。 */
export const LOSE_TURN = 'lose_turn'
/** 閃斷（CYBERSPACE 6.2 節；dev/adr/0018 N3）：內海過載之後的狀態。RAM 歸零，到他下一個自己的回合結束前不回復（那個回合照樣能做不花 RAM 的事）。 */
export const FLASH = 'flash'
export const DEFAULT_STATUSES: Record<string, BattleStatusRule> = {
  [LOSE_TURN]: { id: LOSE_TURN, name: '失去回合', desc: '這個人動不了：輪到他的時候直接跳過。這段時間可以被制伏。', loseTurn: true, until: 'own_turn_start', turns: 1, kind: 'control' },
  [FLASH]: { id: FLASH, name: '閃斷', desc: '剛被灌到過載，RAM 斷了：到他下一個自己的回合結束前，RAM 不回復，只能做不花 RAM 的事（換位、換檔、回填）。', noRegen: ['ram'], until: 'own_turn_end', turns: 1, kind: 'debuff' },
}

/** 遭遇點的四種遮蔽配置（SITES 12.2 節；COMMISSION_MAPS 1.3 節）：每一方四格，索引 0 是第 1 格（最前面）。 */
export const COVER_LAYOUTS: Record<string, { ally: [number, number, number, number]; foe: [number, number, number, number] }> = {
  dense: { ally: [1, 1, 2, 2], foe: [1, 1, 2, 2] },
  medium: { ally: [0, 1, 1, 2], foe: [0, 1, 1, 2] },
  sparse: { ally: [0, 0, 0, 1], foe: [0, 0, 0, 1] },
  one_sided: { ally: [0, 0, 0, 1], foe: [2, 2, 1, 1] },
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// ---- 內容種類（資料的格式） ----

export interface BattleModeEntry extends ContentEntry {
  name: string
  layer: 'meat' | 'net'
  tracks: Array<'hp' | 'load'>
  overload: 'lose_turn' | 'flash'
  flash_pool?: string
  afterglow: { roll: number; load_dealt_pct: number }
  armor_on_load?: boolean
  cover_names: [string, string, string]
  cover_word: string
  /** 只寫和預設不同的數字；鍵和 BattleNumbers 一樣 */
  numbers?: Partial<BattleNumbers>
  /** 這個戰場裡某個屬性由另一個代替（內海：{ body: 'resolve' }）。沒寫照這個戰場的核心預設；寫 {} 是不換 */
  attr_as?: Partial<Record<AttrId, AttrId>>
  /** 角色的護甲讀哪一個衍生數值（現實 armor、內海 net_guard）。沒寫照這個戰場的核心預設 */
  guard_stat?: string
  decay_stat?: string
  /** 個人的脫離：我方每一個人都以 out 退出時，結果是 outcome（不是戰敗）。沒寫照這個戰場的核心預設 */
  leave?: { out: string; outcome: string }
}

export interface DamageTypeEntry extends ContentEntry {
  name: string
  track: 'hp' | 'load'
  armor: number
  needs_bridge?: boolean
  vs?: Record<string, number>
  on_hit?: Array<{ status: string; turns: number }>
  sink?: number
  /** 傷害骰多幾顆（負的是少）：電磁與熱能 −1 */
  dice?: number
}

export interface BattleStatusEntry extends ContentEntry {
  name: string
  desc: string
  mods?: Partial<Record<ModKind, number>>
  no_move?: boolean
  lose_turn?: boolean
  /** 帶著它的人，回合開始時這幾池不回復 */
  no_regen?: string[]
  turn_start?: { ap?: number; hp?: number; hp_dice?: number; load?: number }
  once?: boolean
  until: StatusUntil
  turns?: number
  kind: BattleStatusRule['kind']
  cleansed_by?: string[]
}

export function registerBattleKinds(content: ContentRegistry): void {
  content.defineKind<BattleModeEntry>({
    kind: 'battle_mode', owner: 'core', overridable: true,
    validate: (e) => {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name')
      if (e.layer !== 'meat' && e.layer !== 'net') p.push('layer 只能是 meat、net')
      if (!(Array.isArray(e.tracks) && e.tracks.length > 0 && e.tracks.every((t) => t === 'hp' || t === 'load'))) p.push('tracks 要是 hp、load 的陣列（至少一條）')
      if (e.overload !== 'lose_turn' && e.overload !== 'flash') p.push('overload 只能是 lose_turn、flash')
      if (e.overload === 'flash' && !isText(e.flash_pool)) p.push('overload 是 flash 時要寫 flash_pool（歸零的是哪一池）')
      if (!isRecord(e.afterglow) || !isNum(e.afterglow.roll) || !isNum(e.afterglow.load_dealt_pct)) p.push('afterglow 要有 roll 與 load_dealt_pct')
      if (!(Array.isArray(e.cover_names) && e.cover_names.length === 3 && e.cover_names.every(isText))) p.push('cover_names 要是三個名字（暴露、半掩體、掩體）')
      if (!isText(e.cover_word)) p.push('要有 cover_word')
      if (e.numbers !== undefined) {
        if (!isRecord(e.numbers)) p.push('numbers 要是一個物件')
        else for (const key of Object.keys(e.numbers)) if (!(key in DEFAULT_NUMBERS)) p.push(`numbers.${key}：沒有這個數字（可以寫的：${Object.keys(DEFAULT_NUMBERS).join('、')}）`)
      }
      if (e.attr_as !== undefined) {
        if (!isRecord(e.attr_as)) p.push('attr_as 要是 { 屬性: 屬性 }（例：{ body: "resolve" }）')
        else for (const [from, to] of Object.entries(e.attr_as)) {
          if (!(ATTR_IDS as readonly string[]).includes(from)) p.push(`attr_as.${from}：不是屬性的 id（${ATTR_IDS.join('、')}）`)
          else if (!(ATTR_IDS as readonly unknown[]).includes(to)) p.push(`attr_as.${from}：要代替的屬性要是 ${ATTR_IDS.join('、')} 的其中一個`)
        }
      }
      if (e.guard_stat !== undefined && !isText(e.guard_stat)) p.push('guard_stat 要是衍生數值的 id（現實 armor、內海 net_guard）')
      if (e.decay_stat !== undefined && !isText(e.decay_stat)) p.push('decay_stat 要是衍生數值的 id（內海 net_load_decay；有寫的戰場感載的自然消退只來自這個數值與修正）')
      if (e.leave !== undefined) {
        if (!isRecord(e.leave) || !isText(e.leave.out) || !isText(e.leave.outcome)) p.push('leave 要是 { out, outcome }（怎麼退出的、這一場的結果）')
        else {
          if (['down', 'burnout'].includes(e.leave.out)) p.push('leave.out 不能是 down 或 burnout（那是倒下，不是脫離）')
          if (['win', 'lose', 'surrender'].includes(e.leave.outcome)) p.push('leave.outcome 不能是 win、lose、surrender（脫離不是勝利，也不是戰敗；內海寫 jack_out）')
        }
      }
      return p
    },
  })

  content.defineKind<DamageTypeEntry>({
    kind: 'damage_type', owner: 'core', overridable: true,
    validate: (e) => {
      const p: string[] = []
      if (!(DAMAGE_TYPES as readonly unknown[]).includes(e.id)) p.push(`id 只能是 ${DAMAGE_TYPES.join('、')}`)
      if (!isText(e.name)) p.push('要有 name')
      if (e.track !== 'hp' && e.track !== 'load') p.push('track 只能是 hp、load')
      if (!isNum(e.armor) || e.armor < 0 || e.armor > 1) p.push('armor 要是 0～1（護甲算幾成）')
      if (e.vs !== undefined && !(isRecord(e.vs) && Object.values(e.vs).every(isNum))) p.push('vs 要是「標籤 → 倍率」')
      if (e.on_hit !== undefined && !(Array.isArray(e.on_hit) && e.on_hit.every((x) => isRecord(x) && isText(x.status) && Number.isInteger(x.turns) && (x.turns as number) > 0))) p.push('on_hit 要是 { status, turns } 的陣列')
      if (e.sink !== undefined && !Number.isInteger(e.sink)) p.push('sink 要是整數')
      if (e.dice !== undefined && !Number.isInteger(e.dice)) p.push('dice 要是整數（傷害骰多幾顆；負的是少）')
      return p
    },
    refs: (e) => (e.on_hit ?? []).map((x) => ['battle_status', x.status]),
  })

  content.defineKind<BattleStatusEntry>({
    kind: 'battle_status', owner: 'core', overridable: true,
    validate: (e) => {
      const p: string[] = []
      if (!isText(e.name)) p.push('要有 name')
      if (!isText(e.desc)) p.push('要有 desc（完整的句子）')
      if (e.mods !== undefined) {
        if (!isRecord(e.mods)) p.push('mods 要是一個物件')
        else for (const [key, v] of Object.entries(e.mods)) {
          if (!(MOD_KINDS as readonly string[]).includes(key)) p.push(`mods.${key}：只能是 ${MOD_KINDS.join('、')}`)
          else if (!isNum(v) || v === 0) p.push(`mods.${key} 要是不為 0 的數字`)
        }
      }
      if (e.turn_start !== undefined && !(isRecord(e.turn_start) && Object.entries(e.turn_start).every(([key, v]) => ['ap', 'hp', 'hp_dice', 'load'].includes(key) && Number.isInteger(v)))) p.push('turn_start 只能寫 ap、hp、hp_dice、load，值是整數')
      if (!(STATUS_UNTILS as readonly unknown[]).includes(e.until)) p.push(`until 只能是 ${STATUS_UNTILS.join('、')}`)
      if (e.turns !== undefined && !(Number.isInteger(e.turns) && (e.turns as number) >= 1)) p.push('turns 要是 1 以上的整數')
      if (!['control', 'debuff', 'buff', 'wound', 'mark'].includes(e.kind as string)) p.push('kind 只能是 control、debuff、buff、wound、mark')
      for (const f of ['no_move', 'lose_turn', 'once'] as const) if (e[f] !== undefined && typeof e[f] !== 'boolean') p.push(`${f} 要是布林值`)
      if (e.no_regen !== undefined && !(Array.isArray(e.no_regen) && e.no_regen.every(isText))) p.push('no_regen 要是池的 id 的陣列（ram、ap）')
      return p
    },
  })
}

// ---- 查詢：資料優先，沒有就用核心的預設 ----

export function modeOf(content: ContentRegistry, id: string): BattleMode | undefined {
  const e = content.get<BattleModeEntry>('battle_mode', id)
  if (!e) return DEFAULT_MODES[id]
  const preset = DEFAULT_MODES[id]
  const base = preset?.numbers ?? DEFAULT_NUMBERS
  // 屬性的代替、護甲讀的數值、個人的脫離：資料沒寫的照這個戰場的核心預設（和 numbers 一樣只蓋寫了的）
  const attrAs = e.attr_as ?? preset?.attrAs
  const guardStat = e.guard_stat ?? preset?.guardStat ?? (e.layer === 'net' ? 'net_guard' : 'armor')
  const decayStat = e.decay_stat ?? preset?.decayStat ?? (e.layer === 'net' ? 'net_load_decay' : undefined)
  const leave = e.leave ?? preset?.leave
  return {
    id: e.id, name: e.name, layer: e.layer, tracks: [...e.tracks], overload: e.overload, ...(e.flash_pool ? { flashPool: e.flash_pool } : {}),
    afterglow: { roll: e.afterglow.roll, loadDealtPct: e.afterglow.load_dealt_pct }, armorOnLoad: e.armor_on_load ?? false,
    coverNames: [...e.cover_names] as [string, string, string], coverWord: e.cover_word, numbers: { ...base, ...(e.numbers ?? {}) },
    ...(attrAs && Object.keys(attrAs).length ? { attrAs: { ...attrAs } } : {}), ...(guardStat ? { guardStat } : {}), ...(decayStat ? { decayStat } : {}), ...(leave ? { leave: { ...leave } } : {}),
  }
}

/** 這個戰場裡實際用哪個屬性（戰鬥外、同一個世界的檢定也照它換：內海的機關、節點、潛行用意志代替體格；CYBERSPACE 4.1 節）。沒有這個戰場就是原本的。 */
export function modeAttr(content: ContentRegistry, modeId: string, attr: AttrId): AttrId {
  return battleAttr(modeOf(content, modeId), attr)
}

export function damageTypeOf(content: ContentRegistry, id: DamageType): DamageTypeRule {
  const e = content.get<DamageTypeEntry>('damage_type', id)
  if (!e) return DEFAULT_DAMAGE_TYPES[id]
  return {
    id, name: e.name, track: e.track, armor: e.armor, ...(e.needs_bridge ? { needsBridge: true } : {}), ...(e.vs ? { vs: { ...e.vs } } : {}),
    ...(e.on_hit ? { onHit: e.on_hit.map((x) => ({ ...x })) } : {}), ...(e.sink ? { sink: e.sink } : {}), ...(e.dice ? { dice: e.dice } : {}),
  }
}

export function statusRuleOf(content: ContentRegistry, id: string): BattleStatusRule | undefined {
  const e = content.get<BattleStatusEntry>('battle_status', id)
  if (!e) return DEFAULT_STATUSES[id]
  const t = e.turn_start
  return {
    id: e.id, name: e.name, desc: e.desc, ...(e.mods ? { mods: { ...e.mods } } : {}), ...(e.no_move ? { noMove: true } : {}), ...(e.lose_turn ? { loseTurn: true } : {}),
    ...(e.no_regen ? { noRegen: [...e.no_regen] } : {}),
    ...(t ? { turnStart: { ...(t.ap !== undefined ? { ap: t.ap } : {}), ...(t.hp !== undefined ? { hp: t.hp } : {}), ...(t.hp_dice !== undefined ? { hpDice: t.hp_dice } : {}), ...(t.load !== undefined ? { load: t.load } : {}) } } : {}),
    ...(e.once ? { once: true } : {}), until: e.until, turns: e.turns ?? 1, kind: e.kind, ...(e.cleansed_by ? { cleansedBy: [...e.cleansed_by] } : {}),
  }
}

/** 一個狀態這一筆的某一種修正：自己的 data 蓋掉資料的預設。 */
export function statusMod(rule: BattleStatusRule | undefined, status: BattleStatus, kind: ModKind): number {
  return status.data?.[kind] ?? rule?.mods?.[kind] ?? 0
}

/** 遮蔽某一級在這個等級的場景裡的耐久。 */
export function coverHpFor(n: BattleNumbers, level: 1 | 2, grade: Grade): number {
  const list = level === 2 ? n.coverHp.full : n.coverHp.half
  return list[Math.min(list.length, Math.max(1, grade)) - 1] ?? list[0]!
}

export const RANK_NAME: Record<UnitRank, string> = { minion: '雜兵', elite: '精英', boss: '首領' }
export { UNIT_RANKS }

// ---- 武器的類型（COMBAT_SYSTEM 第 5 節的表）：設計圖與敵人的武器都從這張表起算，內海的武器構裝沿用同樣的原型 ----

export interface WeaponClassEntry extends ContentEntry {
  name: string
  /** 基礎的傷害骰（顆數，d6） */
  dice: number
  /** 距離超過 beyond 時改用的骰數（霰彈槍：距離 1～2 是 5d6，3 以上 3d6） */
  far?: { beyond: number; dice: number }
  type: DamageType
  range: [number, number]
  /** 彈匣（格）；近戰、鞭、霧不寫 */
  mag?: number
  cover_mult: number
  pierce: number
  /** 特性：long、melee、push、pull、aimed、sweep、blast、heavy、silent、concealable…… */
  traits: string[]
  /** 命中用哪一組：槍械是 reflex ＋ firearms；近戰是 body ＋ brawl；重武器是 body ＋ heavy */
  attr: 'body' | 'reflex' | 'tech' | 'intellect' | 'resolve' | 'charm'
  skill: string
  /** 一槍花的行動點（狙擊槍 3）；沒寫照行動表 */
  ap?: number
}

export function registerWeaponClassKind(content: ContentRegistry): void {
  content.defineKind<WeaponClassEntry>({
    kind: 'weapon_class', owner: 'core', overridable: true,
    validate: (e) => {
      const p: string[] = []
      const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
      if (!isText(e.name)) p.push('要有 name')
      if (!int(e.dice) || e.dice < 1) p.push('dice 要是 1 以上的整數（幾顆 d6）')
      if (e.far !== undefined && !(isRecord(e.far) && int(e.far.beyond) && int(e.far.dice))) p.push('far 要有 beyond 與 dice')
      if (!(DAMAGE_TYPES as readonly unknown[]).includes(e.type)) p.push(`type 只能是 ${DAMAGE_TYPES.join('、')}`)
      if (!(Array.isArray(e.range) && e.range.length === 2 && e.range.every(int) && e.range[0]! >= 1 && e.range[0]! <= e.range[1]! && e.range[1]! <= 7)) p.push('range 要是 [近, 遠]，在 1～7 之間')
      if (e.mag !== undefined && !(int(e.mag) && e.mag >= 1 && e.mag <= 4)) p.push('mag 要是 1～4（格）')
      if (!isNum(e.cover_mult) || e.cover_mult < 0) p.push('cover_mult 要是 0 以上的數字')
      if (!int(e.pierce) || e.pierce < 0) p.push('pierce 要是 0 以上的整數')
      if (!(Array.isArray(e.traits) && e.traits.every(isText))) p.push('traits 要是特性的陣列')
      if (!['body', 'reflex', 'tech', 'intellect', 'resolve', 'charm'].includes(e.attr as string)) p.push('attr 要是屬性的 id')
      if (!isText(e.skill)) p.push('要有 skill（基本功的 id）')
      if (e.ap !== undefined && !(int(e.ap) && e.ap >= 1 && e.ap <= 4)) p.push('ap 要是 1～4')
      return p
    },
    refs: (e) => [['skill', e.skill]],
  })
}

export interface WeaponBuild {
  /** 這場戰鬥裡的 id；沒寫用類型的 id */
  id?: string
  name?: string
  /** 命中的合計加值 */
  hit: number
  /** 槍管的等級骰（III +1、IV +2、V +3），或其他多出來的骰 */
  extraDice?: number
  flat?: number
  pierce?: number
  type?: DamageType
  range?: [number, number]
  mag?: number
  traits?: string[]
  item?: string
}

/** 槍管的等級骰（COMBAT_SYSTEM 第 5 節；BALANCE 2.1 節）：決定傷害的零件是 III 級 +1 顆、IV 級 +2 顆、V 級 +3 顆。敵我共用。 */
export const GRADE_DICE: readonly number[] = [0, 0, 1, 2, 3]
export function gradeDice(grade: number): number {
  return GRADE_DICE[Math.min(5, Math.max(1, Math.floor(grade))) - 1]!
}

/** 從武器的類型（COMBAT_SYSTEM 第 5 節的表）組出一把戰鬥裡的武器。設計圖加零件、敵人的資料都從這裡起算。 */
export function weaponFromClass(content: ContentRegistry, classId: string, b: WeaponBuild): import('../types').BattleWeapon {
  const c = content.get<WeaponClassEntry>('weapon_class', classId)
  if (!c) throw new Error(`沒有 ${classId} 這種武器的類型`)
  const extra = b.extraDice ?? 0
  const mag = b.mag ?? c.mag
  return {
    id: b.id ?? c.id, name: b.name ?? c.name, class: c.id, dice: c.dice + extra, ...(c.far ? { far: { beyond: c.far.beyond, dice: c.far.dice + extra } } : {}),
    flat: b.flat ?? 0, type: b.type ?? c.type, range: [...(b.range ?? c.range)] as [number, number], pierce: c.pierce + (b.pierce ?? 0), hit: b.hit,
    attr: c.attr, skill: c.skill, ...(mag ? { mag: { now: mag, max: mag } } : {}), coverMult: c.cover_mult,
    traits: [...new Set([...c.traits, ...(b.traits ?? [])])], ...(c.ap ? { ap: c.ap } : {}), ...(b.item ? { item: b.item } : {}),
  }
}
