// L0 型別：戰鬥（COMBAT_SYSTEM；CYBERSPACE 第 6 節）。現實與內海是同一套戰鬥：這裡的型別兩邊共用，
// 差別（生命與感載兩條或只有感載、彈匣或 RAM、過載之後失去回合或閃斷）由戰場（mode）的資料與登錄表決定。dev/adr/0010。
// 戰鬥狀態是純 JSON，放在 GameState.battle；只經由提交報告改變（op: battle）。

import type { ActorId, AttrId, Grade, SkillId } from './ids'

/** 雙方各一排四格的縱深（COMBAT_SYSTEM 第 2 節）。 */
export const BATTLE_SLOTS = 4
/** ally：玩家這一邊；foe：對面。 */
export const BATTLE_SIDES = ['ally', 'foe'] as const
export type BattleSide = (typeof BATTLE_SIDES)[number]

/** 遮蔽：0 暴露、1 半掩體、2 掩體（內海是防火牆節點，數字相同）。 */
export type CoverLevel = 0 | 1 | 2
export interface BattleCover {
  level: CoverLevel
  /** 這一級剩下的耐久；暴露是 0 */
  hp: number
  /** 這一格每一級的耐久另外算（載具叫來的掩體比較厚）：[半掩體, 掩體]。沒寫照場景的等級 */
  max?: [number, number]
  /** 打不破的遮蔽（煙霧、人群）：算至少半掩體，在的時候這一格的遮蔽不受傷害。until 是第幾回合結束時散掉（沒寫就是整場） */
  soft?: { kind: string; until?: number }
}

/** 五種傷害類型（COMBAT_SYSTEM 第 5 節；DATA 第 1 節的 id）。每一種怎麼算是資料（內容種類 damage_type）。 */
export const DAMAGE_TYPES = ['physical', 'thermal', 'em', 'neural', 'pleasure'] as const
export type DamageType = (typeof DAMAGE_TYPES)[number]

/** 位階（ENEMIES 1.1 節）。我方的人在「精英與首領才有的條件」上當成精英（ENEMIES 4.5 節；dev/adr/0013）。 */
export const UNIT_RANKS = ['minion', 'elite', 'boss'] as const
export type UnitRank = (typeof UNIT_RANKS)[number]

export interface BattleMeter {
  now: number
  max: number
}

/** 會自己回的一池資源：RAM。regen 是每回合回多少。 */
export interface BattlePool extends BattleMeter {
  regen: number
}

/**
 * 一把武器在這場戰鬥裡的樣子（開打時算好的快照：設計圖加零件、敵人資料）。內海的武器構裝用同一個形狀。
 * 命中的加值（hit）已經是合計：主角是 mod(屬性) ＋ 基本功 ＋ 武器修正，敵人是那一級的攻擊加值加兵種的修正。
 */
export interface BattleWeapon {
  /** 這場戰鬥裡的 id（同一個單位身上不重複） */
  id: string
  name: string
  /** 武器的類型：melee、pistol、smg、shotgun、rifle、sniper、lmg、heavy、neural_gun、neural_melee……（資料裡的 class） */
  class: string
  /** 傷害骰的顆數（d6）；已經含槍管的等級骰 */
  dice: number
  /** 距離超過 beyond 時改用的骰數（霰彈槍：距離 3 以上 3d6） */
  far?: { beyond: number; dice: number }
  /** 固定的傷害加值（槍管的份量、近戰的 mod(體格)） */
  flat: number
  type: DamageType
  /** 適用距離 [近, 遠]；超出每一格 −2 */
  range: [number, number]
  pierce: number
  /** 命中的合計加值（不含距離、遮蔽、狀態） */
  hit: number
  /** 檢定要回頭算時用哪一組（特質與技能的修正看這兩個） */
  attr: AttrId
  skill: SkillId
  /** 彈匣（格）。沒有就是不用彈匣（近戰、鞭、霧；內海的構裝花 RAM） */
  mag?: BattleMeter
  /** 每次攻擊從哪一池花多少（內海：{ ram: 1 }） */
  pool?: Record<string, number>
  /** 打在遮蔽上的倍率 */
  coverMult: number
  /**
   * 特性：long（長槍，站在第 1 格 −4）、melee（只能打近身）、push（命中把目標往後推一格）、pull、
   * aimed（每一槍都算瞄準過：命中 +3、要害時重創）、sweep（輕機槍的掃射）、blast（打相鄰的兩格）、silent、heavy……
   * 核心只認 long、melee、aimed；其餘由註冊行動的功能解讀。
   */
  traits: string[]
  /** 這把武器開一槍花的行動點（狙擊槍 3）；沒寫照行動表 */
  ap?: number
  /** 裝著的特殊彈種（物品 id）；沒有就是普通彈 */
  ammo?: string
  /** 背包裡對應的物品實例（戰後寫回彈匣、耗損用）；敵人的沒有 */
  item?: string
  ext?: Record<string, unknown>
}

/** 狀態什麼時候結束。 */
export type BattleUntil =
  /** 某個單位的回合開始（或結束）過了 turns 次之後：「到他的下一回合結束前」是 { at: 'turn_end', of: 他, turns: 1 } */
  | { at: 'turn_start' | 'turn_end'; of: string; turns: number }
  /** 第幾回合結束時 */
  | { at: 'round_end'; round: number }
  /** 整場 */
  | { at: 'battle_end' }

export interface BattleStatus {
  /** 狀態的 id（內容種類 battle_status） */
  id: string
  /** 誰給的（單位 id） */
  by?: string
  until: BattleUntil
  /** 這一筆自己的數字，蓋掉資料裡的預設（例：標記的命中 +2 改成 +1） */
  data?: Record<string, number>
}

/** 敵人 AI 的參數（ENEMIES 第 4 節）。 */
export interface BattleUnitAi {
  /** 受仇恨牽引的程度；越低越亂打 */
  focus: number
  floor: number
  /** 偏好的目標：weakest、netrunner、overloaded、leader、nearest、bridged */
  prefer?: string
  /** 打法：lethal 看生命，neural 看感載，capture 看感載並且優先制伏 */
  mode: 'lethal' | 'neural' | 'capture'
  /** 生命比例低於這個數字就想走 */
  fleeBelow: number
  neverFlee?: boolean
  /** 偏好站在哪幾格 */
  prefer_slots: number[]
  /** 多在乎掩體（0～1） */
  coverUse: number
  ext?: Record<string, unknown>
}

/**
 * 掛在單位身上的機體（機甲、內海的構裝體）：機師本人的強化狀態，不是另一個單位（COMBAT_SYSTEM 9.3 節）。
 * 這一批只留接口（機甲在 M6）：傷害先扣機體，機體受到的傷害有一部分回灌成機師的感載。
 */
export interface BattleHull {
  id: string
  name: string
  hp: BattleMeter
  /** 啟動期間加在護甲上的值 */
  armor: number
  /** 回灌：機體受到的傷害有多少比例變成機師的感載（0.2 是 20%；同步檔位的倍率由功能乘好） */
  backlash: number
  /** 還剩幾個自己的回合；沒寫就是不倒數 */
  turns?: number
  ext?: Record<string, unknown>
}

/**
 * 身上裝著的一件義體在這場戰鬥裡的樣子（開打時的快照；dev/adr/0015 第三節）。失效與超頻是單位身上的狀態
 * （off_<kind>、boost_<kind>；run.implantStatus），不寫在這裡。來源：敵人資料的 cyber、角色的由 M4 的義體功能經 loadout 給
 */
export interface BattleImplant {
  /** 義體的種類（eye、arm、leg、spine、deck……）：失效與超頻的狀態照它找（off_<kind>），規則表沒有的退回 off_generic */
  kind: string
  name: string
  /** 契約義體（授權鎖）：改造師的技能看這個 */
  contract?: boolean
}

export interface BattleUnit {
  /** 這場戰鬥裡的 id：a1～（我方）、f1～（敵方） */
  id: string
  side: BattleSide
  /** 站在第幾格（1～4）；0 是不在場上（在後方排隊、倒下、退出） */
  slot: number
  name: string
  /** 對到 state.actors 的角色（主角、夥伴、名冊上的人）。戰鬥結束時三條軌寫回他身上 */
  actor?: ActorId
  /** 對到敵人資料的 id（內容種類 enemy） */
  enemy?: string
  /** 誰操縱：player 等玩家下指令，ai 由程式選 */
  control: 'player' | 'ai'
  grade: Grade
  rank: UnitRank
  /** 開打時的有效屬性與基本功等級（豁免與戰鬥中的檢定用） */
  attrs: Record<AttrId, number>
  skills: Record<SkillId, number>
  /** 生命。內海的單位沒有這一條 */
  hp?: BattleMeter
  /** 護甲值（內海是防護） */
  armor: number
  /** 感載。沒有橋的（機器、純人）沒有這一條：神經與快感對他無效 */
  load?: BattleMeter
  /** 餘韻的層數與承受層數 */
  layers: number
  layersMax: number
  /** 敏感度：受到的感載 ×（0.75 ＋ 敏感度 ÷ 200）；沒寫的是 50（×1） */
  sensitivity: number
  /**
   * 身上裝著幾件義體；沒寫是 0。敵人 AI 的偏好 bridged（ENEMIES 4.1 節）與敵方潛網者快駭的分數（4.3 節）看這個。
   * 角色的數字來自衍生數值 cyber_count（義體的功能在 M4 註冊；算不算橋本體由它定），在那之前都是 0。
   * 沒寫、但有 implants 時，開打時補成 implants 的件數（dev/adr/0015 第三節）
   */
  cyber?: number
  /** 身上裝著的義體（開打時的快照；沒有就是沒有義體）。run.implantStatus 從這裡挑一件讓它失效或超頻 */
  implants?: BattleImplant[]
  ap: BattlePool
  /** 其他會回的資源，鍵是池的 id（ram） */
  pools: Record<string, BattlePool>
  weapons: BattleWeapon[]
  /** 手上拿的是第幾把（weapons 的索引） */
  wield: number
  /** 迴避（不含遮蔽與狀態）：主角是 10 ＋ mod(反應) ＋ 義體；敵人是那一級的迴避加兵種的修正 */
  evade: number
  /** 先攻的加值（mod(反應) 加上技能與狀態給的） */
  initBonus: number
  /** 擲出來的先攻 */
  initiative: number
  statuses: BattleStatus[]
  /**
   * 造成傷害時的倍率：hp 乘在扣掉護甲之後的生命傷害上（位階的傷害倍率 × 難度 × 強度係數，四捨五入、最少 1）；
   * load 乘在感載上（難度 × 強度係數；不吃位階的倍率）。我方都是 1
   */
  dmgMult: { hp: number; load: number }
  /**
   * 倒下或退出：out 寫的是怎麼退出的。down 是生命歸零倒下；burnout 是餘韻疊滿之後再過載、昏過去（沒受傷）；
   * subdued 被制伏、surrendered 投降、fled 逃走、removed 被帶走。戰鬥中沒有人會死（COMBAT_SYSTEM 8.2 節）
   */
  out?: string
  /** 這場戰鬥裡沉溺加了多少（快感傷害每次命中 +1）；結束時寫回角色 */
  sink: number
  /** 標籤：unbridged、machine、humanoid、contract、night_vision、no_capture…… */
  tags: string[]
  /** 快取格：戰鬥中只能用這裡的道具（EQUIPMENT 4.1 節） */
  quick: Array<{ item: string; qty: number }>
  /** 正在監視：觸發時自動做哪一個行動 */
  watch?: { action: string }
  /** 開著的姿態（技能的 id）；同時只能開一個 */
  stance?: string
  /** 這一場用過幾次（每場次數的技能、招牌、每回合一次的東西用 turn: 前綴，回合開始時清掉） */
  uses: Record<string, number>
  /** 重創：部位 → 1 輕、2 重 */
  wounds: Record<string, number>
  /** 機體（機甲、構裝體）；啟動中才有 */
  hull?: BattleHull
  ai?: BattleUnitAi
  /** 功能自己的資料（技能的階數、同步檔位……），鍵是功能 id */
  ext: Record<string, unknown>
}

/**
 * 和人重疊的東西（COMBAT_SYSTEM 第 9 節）：無人機、接管來的砲塔、內海的守衛程式。掛在某一格上，不佔格、
 * 不算進四個單位的上限，每格最多一台；永遠暴露；可以被單獨瞄準、擊落。dev/adr/0015 第三節。
 */
export interface BattleOverlay {
  id: string
  side: BattleSide
  slot: number
  /**
   * 操作者（單位 id）。沒有就是沒有操作者（裝在場景上的、巡邏用的、自律之後的）。
   * 操作者退出時：autonomous 的改成沒有操作者、自己動；其餘的停機（核心不再一律停機，由放它的功能決定）
   */
  owner?: string
  /** 種類：attack、shield、scout、medic、jammer、turret…… 由註冊行動的功能解讀 */
  kind: string
  name: string
  hp: BattleMeter
  armor: number
  evade: number
  /** 它自己的武器（敵方的、砲塔）：run.overlayAttack 用它開火，不用操作者的操縱。沒有就沒有武器（我方的無人機用操作者的） */
  weapon?: BattleWeapon
  /** 每一輪自己做一個動作（沒有操作者的巡邏機、砲塔）；做什麼、怎麼做由功能掛在 round.start 上，核心只存這個旗標 */
  auto?: boolean
  /** 操作者退出時不停機：改成沒有操作者、auto 開著、ext.orphan = true（自律：命中 −2、不移動由功能照 ext.orphan 做），不發 overlay.down */
  autonomous?: boolean
  /** 這一回合動過了（每台每回合一次） */
  used: boolean
  down: boolean
  /** 背包裡對應的物品（戰後要修） */
  item?: string
  /**
   * 功能自己的資料。核心認得的鍵：dmgMult（{ hp, load }：它自己開火時的傷害倍率，照位階與難度；沒寫都是 1）、
   * orphan（true：操作者退出之後自律）
   */
  ext?: Record<string, unknown>
}

/**
 * run.addOverlay 收的：一台的樣子，不含核心發的 id 與狀態（used、down 一開始都是 false）。
 * hp、armor、evade 是基本值；有 owner 時核心再問他的修正（overlay_hp、overlay_armor、overlay_evade）加上去
 */
export type BattleOverlayInit = Omit<BattleOverlay, 'id' | 'used' | 'down'>

/** 控制節點（COMBAT_SYSTEM 2.4 節）：被潛網者拿下之後可以改變戰場（關燈、放防爆門、接管砲塔）。 */
export interface BattleNode {
  id: string
  /** light、door、turret…… */
  kind: string
  name: string
  taken: boolean
  used: boolean
  ext?: Record<string, unknown>
}

/** 這場戰鬥怎麼開的（開打之後不變）。 */
export interface BattleOrigin {
  /** 遭遇的 id（內容種類 encounter）；臨時組的沒有 */
  encounter?: string
  /** 地點的一句話（紀錄用） */
  place?: string
  /** 誰埋伏誰：ally 是我方埋伏敵方 */
  ambush?: BattleSide
  /** 能不能脫離（副本裡的戰鬥不能，只能撤退） */
  escapable: boolean
  /** 要活的：這幾個敵人要制伏、不能打倒 */
  capture?: string[]
  /** 贏的一方的勢力（戰敗事件用）；沒寫由敵人的資料決定 */
  faction?: string
  /**
   * 開打時每一方的人數（上場的加上在後方等的）。士氣的「同伴倒了一半」用這個當分母（ENEMIES 4.4 節）：
   * 之後叫來的增援不會把分母墊高。開打時由核心記下，之後不變
   */
  headcount?: Record<BattleSide, number>
  /** 發起的功能自己要記的東西（委託副本的階段、地圖上的遭遇點……） */
  ext?: Record<string, unknown>
}

export type BattleOutcome = 'win' | 'lose' | 'fled' | 'surrender' | string

export interface BattleState {
  /** 這場戰鬥的 id：b1、b2…… */
  id: string
  /** 戰場：meat 現實、net 內海（登錄表裡註冊過的） */
  mode: string
  /** 場景的等級：遮蔽的耐久照它 */
  grade: Grade
  round: number
  /** 先攻的順序（單位 id，由高到低）；倒下與退出的留在裡面，輪到時跳過 */
  order: string[]
  /** 輪到 order 的第幾個 */
  turn: number
  units: Record<string, BattleUnit>
  /** 還在後方排隊的單位（照順序補上來） */
  reserve: Record<BattleSide, string[]>
  /** 每一方四格的遮蔽；索引 0 是第 1 格 */
  cover: Record<BattleSide, BattleCover[]>
  overlays: BattleOverlay[]
  nodes: BattleNode[]
  /** 場地效果（COMBAT_SYSTEM 2.5 節）：dark 黑暗；其餘由功能加 */
  field: Record<string, boolean | number | string>
  /** 這場戰鬥已經擲了幾次骰：下一顆的種子從（存檔的種子、游標、戰鬥 id、這個數字）導出 */
  rolls: number
  /** 流水號：單位、和人重疊的東西 */
  seq: number
  /** 這一步輪到的單位（AI 的）已經做了幾個動作；換人時歸零 */
  aiSteps: number
  /** 這場戰鬥每一步的報告 id：結束時收成一份 */
  steps: string[]
  origin: BattleOrigin
  /** 已經分出結果（等結束的報告提交之後才從狀態裡拿掉） */
  result?: { outcome: BattleOutcome; text: string }
}

/** 一個行動的目標。 */
export type BattleTarget =
  | { unit: string }
  | { side: BattleSide; slot: number }
  | { overlay: string }
  | { node: string }

/** 玩家（或 AI）送出的一步。 */
export interface BattleInput {
  /** 行動的 id（登錄表裡註冊過的）；結束回合是 end_turn */
  action: string
  target?: BattleTarget
  /** 這一步其他的選擇（換哪一把武器、用哪一件道具、指定哪個部位、分配幾點……） */
  pick?: Record<string, unknown>
}

/**
 * 戰鬥發出的事件（報告的 timeline 每一拍的 tag）。直播、成就、任務目標聽這些：要害、過載、打倒、制伏……
 * （MEDIA 1.2 節：亮點來自引擎本來就會發出的事件）。清單是封閉的：新的事件加在這裡。
 */
export const BATTLE_EVENTS = [
  'battle.start', 'battle.end', 'round', 'turn', 'turn.skip',
  'attack', 'hit', 'miss', 'crit', 'graze', 'wound', 'damage', 'heal',
  'load', 'overload', 'down', 'subdue', 'surrender', 'flee', 'flee.fail',
  'cover.hit', 'cover.break', 'cover.raise', 'compact', 'reinforce',
  'move', 'push', 'pull', 'reload', 'swap', 'item', 'watch', 'watch.fire',
  'status', 'status.end', 'skill', 'support', 'overlay', 'overlay.down', 'node', 'field', 'hull', 'hull.break',
  'revive',
] as const
export type BattleEvent = (typeof BATTLE_EVENTS)[number]
