// L6 功能 cyberware 的資料與純函式：部位與槽、規則（內建的預設加資料蓋掉）、身上的義體（actor.ext.cyber）的讀法、沉溺成本、休養。
// 規格：CYBERWARE 第 1、2 節（2.1 手術、併發症與休養；2.2 部位的代號）；CRAFTING 8.1、10.2 節；TRADE 3.4 節；DATA 7.1、3.4 節；dev/adr/0019 第三節與 P1～P6；dev/work/M4-cyberware.md。
//
// 不碰登錄表（登記在 index.ts）。
//
// 身上的義體：actor.ext.cyber = { pieces: CyberPiece[] }。一件是核心的 ProductData 加上 bp（設計圖的 id）、slot（部位的 id）、sink（裝上時算定的沉溺成本）、
// at（裝好的時間，總分鐘）、ready_at?（休養到什麼時候）、off?（不生效：{ why, until? }）、registered?（正規診所裝的，登記在橋 ID 上）。
// 資料壞掉的（pieces 不是陣列、某一件沒有 bp、沒有合格的部位、uid 重複）讀成沒有那一件，不丟錯。

import type { ActorId, BlueprintEntry, Condition, ContentEntry, GameState, Kernel, PassiveEffect, ProductData } from '../../core'
import { clone, isRecord, isSafeInt, readProduct, toMinutes } from '../../core'

export const OWNER = 'cyberware'
/** actor.ext 的鍵 */
export const EXT = 'cyber'
export const RULE_KIND = 'cyber_rule'
export const FACILITY_TYPE_KIND = 'facility_type'
/** 休養中的狀況（角色身上掛著；until 是身上最晚的 ready_at） */
export const RECOVERING = 'recovering'

/** 部位的 id（CYBERWARE 2.2 節；dev/adr/0019 P1）。設計圖上的 arm、leg 裝上去時分左右。 */
export const PART_IDS = ['bridge', 'brain', 'eye', 'ear_throat', 'torso', 'skin', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'intimate'] as const
export type PartId = (typeof PART_IDS)[number]
export const PART_NAME: Record<PartId, string> = {
  bridge: '橋', brain: '腦', eye: '眼', ear_throat: '耳與喉', torso: '軀幹', skin: '皮膚',
  arm_l: '左臂', arm_r: '右臂', leg_l: '左腿', leg_r: '右腿', intimate: '私密',
}
export const isPartId = (v: unknown): v is PartId => typeof v === 'string' && (PART_IDS as readonly string[]).includes(v)

/** 左右：l 是左、r 是右（設計圖的部位是 arm、leg 時要給）。 */
export type Side = 'l' | 'r'
export const SIDES: readonly Side[] = ['l', 'r']

/** 設計圖上的部位 → 身上的部位 id；arm、leg 沒給左右回傳 null。 */
export function partIdOf(blueprintSlot: string | undefined, side?: Side): PartId | null {
  if (blueprintSlot === 'arm' || blueprintSlot === 'leg') return side === 'l' || side === 'r' ? (`${blueprintSlot}_${side}` as PartId) : null
  return isPartId(blueprintSlot) ? blueprintSlot : null
}

/** 條件 cyber 的 slot 可以寫 arm、leg（左右都算）。 */
export const baseSlot = (part: string): string => (part.startsWith('arm_') ? 'arm' : part.startsWith('leg_') ? 'leg' : part)

/** 四種動刀的人（CRAFTING 10.2 節；TRADE 3.4 節）。 */
export const SURGEON_KINDS = ['clinic', 'unlicensed', 'black', 'self'] as const
export type SurgeonKind = (typeof SURGEON_KINDS)[number]
export const isSurgeonKind = (v: unknown): v is SurgeonKind => typeof v === 'string' && (SURGEON_KINDS as readonly string[]).includes(v)
export const SURGEON_NAME: Record<SurgeonKind, string> = { clinic: '正規診所', unlicensed: '無照診所', black: '黑診所', self: '自己動刀' }
/** 設施種類的 clinic.grade 能寫的值（自己動刀不是設施） */
export const CLINIC_GRADES = ['clinic', 'unlicensed', 'black'] as const
export type ClinicGrade = (typeof CLINIC_GRADES)[number]

// ---- 規則 ----

export interface SurgeonRule {
  /** 手術費：成品價的幾成 */
  fee: number
  /** 沉溺成本的加減（百分比；負的是減） */
  sink_pct: number
  /** 留下併發症的機率（0～1；自己動刀看檢定，不看這一格） */
  complication: number
}

export interface CyberRules {
  /** 每個部位幾槽 */
  slots: Record<PartId, number>
  surgeons: Record<SurgeonKind, SurgeonRule>
  /** 拆的費用是安裝費的幾倍 */
  remove_fee_mult: number
  /** 休養多久（分鐘），照侵入度 */
  recovery_minutes: Record<string, number>
  /** 生體件的休養是幾倍 */
  bio_recovery_mult: number
  /** 機械接生體（有接面）的沉溺成本乘多少（無條件捨去） */
  mixed_sink_mult: number
  /** 一次手術花幾分鐘 */
  surgery_minutes: number
  /** 自己動刀要通過的條件（動刀的人） */
  self_requires: Condition[]
  /** 自己動刀擲的基本功 */
  self_skill: string
  /** 自己動刀的標準 DC，照設計圖等級 I～V */
  self_dc: number[]
  /** 換橋的費用是安裝費的幾倍（TRADE 3.4 節；沒有舊橋的第一座不乘） */
  bridge_fee_mult: number
  /** 裝橋之後休養多久（分鐘；CYBERWARE 2.1 節「換橋 3 天」；橋本身休養中照樣生效，只有機能的 effects 等好了才算） */
  bridge_recovery_minutes: number
  /** 換橋另外加的暫時沉溺（P7：+5，7 天後退回；效果 sink_floor 的 amount 與 days） */
  bridge_swap_sink: { amount: number; days: number }
  /** 橋的容量每一類最少多少（CYBERWARE 7.1 節） */
  cap_min: number
  /** 內容種類 deck 的成品裝進腦部時的沉溺成本，那一筆沒寫 sink_cost 時用（CYBERWARE 第 2 節「侵入：甲板 5～8」；P51） */
  deck_sink_default: number
  /** 藥泵一座最多放幾劑（設計圖 battle.pump 寫 true 時用；暫定 3，dev/work/M4-cyber-battle.md） */
  pump_doses: number
  /**
   * 原廠全套的套裝加成（CRAFTING 第 6 節）：牌子 → 被動效果（來源 cyber）。設計圖與所有零件同一個牌子（productOf 的 brands 只有一個）的那一件，
   * 好了、沒有 off 時給。設計書只寫了方向（緋櫻：同步回灌 −10%、要害 +；星旗：不卡彈、耐久 +……），沒有逐項的數字，預設是空的，等資料補（M4-data-rules）
   */
  set_bonus: Record<string, PassiveEffect[]>
  /** 訂閱的每週費用沒寫 weekly 時：成品價的幾成（CYBERWARE 第 5 節「每週付全額的 3%」；P11；M4-cyber-lock） */
  subscription_rate: number
  /** 破解授權鎖的 DC 比設計圖等級的標準 DC 高多少 */
  crack_dc_bonus: number
  /** 破解失敗而且鎖是勢力的：那個勢力的敵對值加多少 */
  crack_hostility: number
  /** 條件 ability（daily: 'unlock'）成立的人破解的檢定加值 */
  unlock_bonus: number
  /** 二手的義體裝上時種下惡意韌體的機率（P12） */
  used_malware: number
  /** 修理：診所收成品價的幾成（DOWNTIME 3.1 節：零件價的 20%） */
  repair_fee: number
  /** 修理：自己修的 DC（DOWNTIME 3.1 節：義體學 13） */
  repair_dc: number
  /** 修理：自己修要在住處的話，住處的等級至少多少（條件 at_home 的 level_min；有工作台的據點是二級以上） */
  repair_home_level: number
}

export const DEFAULT_CYBER_RULES: CyberRules = {
  slots: { bridge: 1, brain: 3, eye: 2, ear_throat: 2, torso: 3, skin: 2, arm_l: 2, arm_r: 2, leg_l: 2, leg_r: 2, intimate: 2 },
  surgeons: {
    clinic: { fee: 0.5, sink_pct: -10, complication: 0 },
    unlicensed: { fee: 0.3, sink_pct: 0, complication: 0.1 },
    black: { fee: 0.4, sink_pct: 0, complication: 0.15 },
    self: { fee: 0, sink_pct: 0, complication: 0 },
  },
  remove_fee_mult: 0.5,
  recovery_minutes: { surface: 0, light: 240, invasive: 1440, heavy: 2880, extreme: 5760 },
  bio_recovery_mult: 3,
  mixed_sink_mult: 0.5,
  surgery_minutes: 60,
  self_requires: [{ kind: 'ability', daily: 'surgery' }],
  self_skill: 'cyberware',
  self_dc: [10, 13, 16, 19, 22],
  bridge_fee_mult: 2,
  bridge_recovery_minutes: 4320,
  bridge_swap_sink: { amount: 5, days: 7 },
  cap_min: 8,
  deck_sink_default: 6,
  pump_doses: 3,
  set_bonus: {},
  subscription_rate: 0.03,
  crack_dc_bonus: 3,
  crack_hostility: 5,
  unlock_bonus: 2,
  used_malware: 0.1,
  repair_fee: 0.2,
  repair_dc: 13,
  repair_home_level: 2,
}

const INV_IDS = ['surface', 'light', 'invasive', 'heavy', 'extreme']
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isRatio = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const isMult = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.slots !== undefined) {
    if (!isRecord(e.slots)) p.push('slots 要是 { 部位: 槽數 }')
    else for (const [part, n] of Object.entries(e.slots)) {
      if (!isPartId(part)) p.push(`slots.${part}：部位只有 ${PART_IDS.join('、')}`)
      else if (!(isSafeInt(n) && n >= 0 && n <= 16)) p.push(`slots.${part} 要是 0～16 的整數`)
    }
  }
  if (e.surgeons !== undefined) {
    if (!isRecord(e.surgeons)) p.push('surgeons 要是 { clinic、unlicensed、black、self: { fee, sink_pct, complication } }')
    else for (const [kind, v] of Object.entries(e.surgeons)) {
      if (!isSurgeonKind(kind)) p.push(`surgeons.${kind}：只有 ${SURGEON_KINDS.join('、')}`)
      else if (!isRecord(v)) p.push(`surgeons.${kind} 要是 { fee, sink_pct, complication }`)
      else {
        if (v.fee !== undefined && !isMult(v.fee)) p.push(`surgeons.${kind}.fee 要是 0 以上的數字（成品價的幾成）`)
        if (v.sink_pct !== undefined && !(typeof v.sink_pct === 'number' && Number.isFinite(v.sink_pct) && v.sink_pct >= -100 && v.sink_pct <= 1000)) p.push(`surgeons.${kind}.sink_pct 要是 −100 以上的數字（百分比）`)
        if (v.complication !== undefined && !isRatio(v.complication)) p.push(`surgeons.${kind}.complication 要是 0～1 的數字`)
      }
    }
  }
  if (e.remove_fee_mult !== undefined && !isMult(e.remove_fee_mult)) p.push('remove_fee_mult 要是 0 以上的數字')
  if (e.recovery_minutes !== undefined) {
    if (!isRecord(e.recovery_minutes)) p.push('recovery_minutes 要是 { 侵入度: 分鐘 }')
    else for (const [inv, n] of Object.entries(e.recovery_minutes)) {
      if (!INV_IDS.includes(inv)) p.push(`recovery_minutes.${inv}：侵入度只有 ${INV_IDS.join('、')}`)
      else if (!(isSafeInt(n) && n >= 0 && n <= 525_600)) p.push(`recovery_minutes.${inv} 要是 0～525600 的整數（分鐘）`)
    }
  }
  if (e.bio_recovery_mult !== undefined && !(typeof e.bio_recovery_mult === 'number' && Number.isFinite(e.bio_recovery_mult) && e.bio_recovery_mult >= 0 && e.bio_recovery_mult <= 100)) p.push('bio_recovery_mult 要是 0 以上的數字')
  if (e.mixed_sink_mult !== undefined && !isRatio(e.mixed_sink_mult)) p.push('mixed_sink_mult 要是 0～1 的數字')
  if (e.surgery_minutes !== undefined && !(isSafeInt(e.surgery_minutes) && e.surgery_minutes >= 0 && e.surgery_minutes <= 1440)) p.push('surgery_minutes 要是 0～1440 的整數')
  if (e.self_requires !== undefined && !(Array.isArray(e.self_requires) && e.self_requires.every((c) => isRecord(c) && isText(c.kind)))) p.push('self_requires 要是條件的陣列')
  if (e.self_skill !== undefined && !isText(e.self_skill)) p.push('self_skill 要是基本功的 id')
  if (e.self_dc !== undefined && !(Array.isArray(e.self_dc) && e.self_dc.length === 5 && e.self_dc.every((n) => isSafeInt(n) && n >= 1 && n <= 40))) p.push('self_dc 要是五個整數（設計圖等級 I～V 的 DC）')
  if (e.bridge_fee_mult !== undefined && !isMult(e.bridge_fee_mult)) p.push('bridge_fee_mult 要是 0 以上的數字')
  if (e.bridge_recovery_minutes !== undefined && !(isSafeInt(e.bridge_recovery_minutes) && e.bridge_recovery_minutes >= 0 && e.bridge_recovery_minutes <= 525_600)) p.push('bridge_recovery_minutes 要是 0～525600 的整數（分鐘）')
  if (e.bridge_swap_sink !== undefined && !swapSinkOk(e.bridge_swap_sink)) p.push('bridge_swap_sink 要是 { amount: 0～100 的整數, days: 1～365 的整數 }')
  if (e.cap_min !== undefined && !(isSafeInt(e.cap_min) && e.cap_min >= 0 && e.cap_min <= 64)) p.push('cap_min 要是 0～64 的整數')
  if (e.deck_sink_default !== undefined && !(isSafeInt(e.deck_sink_default) && e.deck_sink_default >= 0 && e.deck_sink_default <= 100)) p.push('deck_sink_default 要是 0～100 的整數')
  if (e.pump_doses !== undefined && !(isSafeInt(e.pump_doses) && e.pump_doses >= 1 && e.pump_doses <= 9)) p.push('pump_doses 要是 1～9 的整數')
  if (e.set_bonus !== undefined) {
    if (!isRecord(e.set_bonus)) p.push('set_bonus 要是 { 牌子: 被動效果的陣列 }')
    else for (const [brand, list] of Object.entries(e.set_bonus)) if (!isText(brand) || !Array.isArray(list) || !list.every(isRecord)) p.push(`set_bonus.${brand} 要是被動效果的陣列`)
  }
  for (const key of ['subscription_rate', 'used_malware', 'repair_fee'] as const) if (e[key] !== undefined && !isRatio(e[key])) p.push(`${key} 要是 0～1 的數字`)
  if (e.crack_dc_bonus !== undefined && !(isSafeInt(e.crack_dc_bonus) && e.crack_dc_bonus >= 0 && e.crack_dc_bonus <= 20)) p.push('crack_dc_bonus 要是 0～20 的整數')
  if (e.crack_hostility !== undefined && !(isSafeInt(e.crack_hostility) && e.crack_hostility >= 0 && e.crack_hostility <= 100)) p.push('crack_hostility 要是 0～100 的整數')
  if (e.unlock_bonus !== undefined && !(isSafeInt(e.unlock_bonus) && e.unlock_bonus >= 0 && e.unlock_bonus <= 10)) p.push('unlock_bonus 要是 0～10 的整數')
  if (e.repair_dc !== undefined && !(isSafeInt(e.repair_dc) && e.repair_dc >= 1 && e.repair_dc <= 40)) p.push('repair_dc 要是 1～40 的整數')
  if (e.repair_home_level !== undefined && !(isSafeInt(e.repair_home_level) && e.repair_home_level >= 0 && e.repair_home_level <= 3)) p.push('repair_home_level 要是 0～3 的整數')
  return p
}

const swapSinkOk = (v: unknown): v is { amount: number; days: number } =>
  isRecord(v) && isSafeInt(v.amount) && v.amount >= 0 && v.amount <= 100 && isSafeInt(v.days) && v.days >= 1 && v.days <= 365

/** 現在生效的規則：資料 cyber_rule/default 蓋掉內建的預設（格式不對的欄位忽略；slots 與 surgeons 逐項蓋）。 */
export function cyberRules(k: Pick<Kernel, 'content'>): CyberRules {
  const out = clone(DEFAULT_CYBER_RULES)
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('slots')) for (const [part, n] of Object.entries(e.slots as Record<string, unknown>)) if (isPartId(part) && isSafeInt(n) && n >= 0 && n <= 16) out.slots[part] = n
  if (ok('surgeons')) {
    for (const [kind, v] of Object.entries(e.surgeons as Record<string, unknown>)) {
      if (!isSurgeonKind(kind) || !isRecord(v)) continue
      if (isMult(v.fee)) out.surgeons[kind].fee = v.fee
      if (typeof v.sink_pct === 'number' && Number.isFinite(v.sink_pct) && v.sink_pct >= -100 && v.sink_pct <= 1000) out.surgeons[kind].sink_pct = v.sink_pct
      if (isRatio(v.complication)) out.surgeons[kind].complication = v.complication
    }
  }
  if (ok('remove_fee_mult')) out.remove_fee_mult = e.remove_fee_mult as number
  if (ok('recovery_minutes')) for (const [inv, n] of Object.entries(e.recovery_minutes as Record<string, unknown>)) if (INV_IDS.includes(inv) && isSafeInt(n) && n >= 0 && n <= 525_600) out.recovery_minutes[inv] = n
  if (ok('bio_recovery_mult')) out.bio_recovery_mult = e.bio_recovery_mult as number
  if (ok('mixed_sink_mult')) out.mixed_sink_mult = e.mixed_sink_mult as number
  if (ok('surgery_minutes')) out.surgery_minutes = e.surgery_minutes as number
  if (ok('self_requires')) out.self_requires = clone(e.self_requires as Condition[])
  if (ok('self_skill')) out.self_skill = e.self_skill as string
  if (ok('self_dc')) out.self_dc = [...(e.self_dc as number[])]
  if (ok('bridge_fee_mult')) out.bridge_fee_mult = e.bridge_fee_mult as number
  if (ok('bridge_recovery_minutes')) out.bridge_recovery_minutes = e.bridge_recovery_minutes as number
  if (ok('bridge_swap_sink')) out.bridge_swap_sink = { ...(e.bridge_swap_sink as { amount: number; days: number }) }
  if (ok('cap_min')) out.cap_min = e.cap_min as number
  if (ok('deck_sink_default')) out.deck_sink_default = e.deck_sink_default as number
  if (ok('pump_doses')) out.pump_doses = e.pump_doses as number
  if (ok('set_bonus')) out.set_bonus = clone(e.set_bonus as Record<string, PassiveEffect[]>)
  for (const key of ['subscription_rate', 'crack_dc_bonus', 'crack_hostility', 'unlock_bonus', 'used_malware', 'repair_fee', 'repair_dc', 'repair_home_level'] as const) if (ok(key)) out[key] = e[key] as number
  return out
}

// ---- 身上的義體 ----

export interface CyberOff {
  /** 為什麼不生效：lock（授權鎖）、broken（壞了）…… */
  why: string
  /** 到什麼時候（總分鐘）；沒有就是不會自己好 */
  until?: number
}

/** 身上的一件義體（actor.ext.cyber.pieces 的一筆）。 */
export interface CyberPiece extends ProductData {
  /** 設計圖的 id；kind_of 是 deck 時是內容種類 deck 的 id */
  bp: string
  /**
   * bp 指的是什麼（M4-cyber-deck）：blueprint 是設計圖（一般的義體，包括設計圖帶 deck 欄位的甲板）；deck 是內容種類 deck 的成品甲板（沒有零件，數字照那一筆）。
   * 讀進來時沒寫的當 blueprint。
   */
  kind_of?: 'deck' | 'blueprint'
  /** 裝在哪個部位 */
  slot: PartId
  /** 裝上時算定的沉溺成本（休養中、不生效的也照算） */
  sink: number
  /** 裝好的時間（總分鐘） */
  at: number
  /** 休養到什麼時候（總分鐘）；沒有就是已經好了 */
  ready_at?: number
  off?: CyberOff
  /** 正規診所裝的是 true（登記在橋 ID 上）；無照、黑診所、自己動刀是 false */
  registered?: boolean
  /** 藥泵裡預裝的藥（設計圖 battle.pump 的那一種；M4-cyber-battle）：一種藥、幾劑 */
  loaded?: { item: string; qty: number }
  /** 橋：最後一次回去重刻的時間（總分鐘；設計圖 bridge.recall；沒寫是 at；M4-followups-2 第 3 項） */
  inscribed?: number
}

/** 把存檔裡的一件讀成合格的（壞掉回 null）。 */
function readPiece(raw: unknown): CyberPiece | null {
  if (!isRecord(raw) || !isText(raw.bp) || !isPartId(raw.slot) || !isText(raw.uid)) return null
  const piece: CyberPiece = {
    ...readProduct(raw),
    uid: raw.uid, bp: raw.bp, kind_of: raw.kind_of === 'deck' ? 'deck' : 'blueprint', slot: raw.slot,
    sink: isSafeInt(raw.sink) && raw.sink >= 0 ? raw.sink : 0,
    at: isSafeInt(raw.at) ? raw.at : 0,
  }
  if (isSafeInt(raw.ready_at)) piece.ready_at = raw.ready_at
  if (isRecord(raw.off) && isText(raw.off.why)) piece.off = { why: raw.off.why, ...(isSafeInt(raw.off.until) ? { until: raw.off.until } : {}) }
  if (typeof raw.registered === 'boolean') piece.registered = raw.registered
  if (isRecord(raw.loaded) && isText(raw.loaded.item) && isSafeInt(raw.loaded.qty) && raw.loaded.qty > 0) piece.loaded = { item: raw.loaded.item, qty: raw.loaded.qty }
  if (isSafeInt(raw.inscribed)) piece.inscribed = raw.inscribed
  return piece
}

/**
 * 讀一份 ext.cyber：壞掉的整理成沒有那一件（uid 重複的留第一件）。
 * 給了 now（總分鐘）時，off.until 到了的當成沒有 off（有期限的鎖與壞掉，M4-cyber-lock；下一次寫 pieces 時順手清掉，因為寫回的是整理過的）。
 */
export function readPieces(raw: unknown, now?: number): CyberPiece[] {
  if (!isRecord(raw) || !Array.isArray(raw.pieces)) return []
  const out: CyberPiece[] = []
  const seen = new Set<string>()
  for (const p of raw.pieces) {
    const piece = readPiece(p)
    if (!piece || seen.has(piece.uid)) continue
    seen.add(piece.uid)
    if (now !== undefined && piece.off?.until !== undefined && piece.off.until <= now) delete piece.off
    out.push(piece)
  }
  return out
}

/** 這個人身上的義體（整理過的複本；人不存在、資料壞掉是空的）。 */
export const cyberOf = (state: Pick<GameState, 'actors'> & Partial<Pick<GameState, 'time'>>, actor: ActorId): CyberPiece[] =>
  readPieces(state.actors[actor]?.ext[EXT], state.time ? toMinutes(state.time) : undefined)

/** 寫回 ext.cyber 的值：保留 ext.cyber 裡別人放的鍵，pieces 換成整理過的新清單。 */
export function cyberExtValue(state: Pick<GameState, 'actors'>, actor: ActorId, pieces: CyberPiece[]): Record<string, unknown> {
  const raw = state.actors[actor]?.ext[EXT]
  return { ...(isRecord(raw) ? clone(raw) : {}), pieces: clone(pieces) }
}

/** 這一件現在好了嗎（沒有 ready_at、或 ready_at 已經到）。 */
export const isReady = (piece: Pick<CyberPiece, 'ready_at'>, now: number): boolean => piece.ready_at === undefined || piece.ready_at <= now
/** 這一件現在生效嗎：好了而且沒有 off。 */
export const isActive = (piece: CyberPiece, now: number): boolean => isReady(piece, now) && !piece.off

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)

// ---- 重的重創（COMBAT_SYSTEM 第 6 節；dev/adr/0019 P46）：不寫進狀態，讀的時候算 ----

/** 角色身上的狀況：頭的重創（義眼或甲板損壞）、肢體的重創（義肢失效）。治好了（狀況拿掉）就恢復。 */
export const WOUND_HEAD = 'wound_head'
export const WOUND_LIMB = 'wound_limb'
/** 頭的重創打壞的順序：眼，然後腦（義眼或甲板）。肢體：左臂、右臂、左腿、右腿。同一個部位照身上的順序。 */
const HEAD_ORDER: readonly PartId[] = ['eye', 'brain']
const LIMB_ORDER: readonly PartId[] = ['arm_l', 'arm_r', 'leg_l', 'leg_r']

/** 讀得到進行中的戰鬥的狀態（戰鬥中的重創還沒寫進角色，戰鬥結束才寫；M4-core-gaps 第 3 項）。 */
type WoundState = Pick<GameState, 'actors' | 'time'> & { battle?: GameState['battle'] }
/** 這個人這一場已經受的重的重創（單位的 wounds 是 2）要不要算：額外給的（戰鬥中這一步剛打出來的，還沒寫進狀態）加上 state.battle 裡的。 */
export interface HeavyWounds {
  head?: boolean
  limb?: boolean
}

const hasCondition = (state: Pick<GameState, 'actors' | 'time'>, actor: ActorId, id: string): boolean => {
  const now = toMinutes(state.time)
  return !!state.actors[actor]?.conditions.some((c) => c.id === id && (c.until === undefined || c.until > now))
}

/**
 * 進行中的戰鬥裡，這個人（我方、對到這個角色的單位）頭或肢體是不是已經重創到第二級。
 * 戰鬥中的狀況（wound_head、wound_limb）是戰鬥結束才寫進角色的，所以「這一場當下」要讀戰鬥的狀態：讀的時候算，不寫任何狀態。
 */
export function battleHeavy(state: WoundState, actor: ActorId): Required<HeavyWounds> {
  const out = { head: false, limb: false }
  for (const u of Object.values(state.battle?.units ?? {})) {
    if (u.side !== 'ally' || u.actor !== actor) continue
    if (u.wounds.head === 2) out.head = true
    if (u.wounds.limb === 2) out.limb = true
  }
  return out
}

/**
 * 重的重創讓哪幾件失效（uid）：有 wound_head 就是照順序第一件眼或腦的義體，有 wound_limb 就是第一件手臂或腿的義體
 * （沒有那種義體就沒事；已經 off 的照樣算那一件，不往下找，這樣鎖解開之後壞的還是同一件）。
 * 戰鬥進行中：這個人這一場已經重創到第二級的頭或肢體也算（讀 state.battle；extra 是戰鬥這一步剛打出來、還沒提交的），所以義眼與腦裡的甲板在這一場當下就失效，不必等戰後。
 */
export function woundedUids(state: WoundState, actor: ActorId, pieces: readonly CyberPiece[] = cyberOf(state, actor), extra: HeavyWounds = {}): Set<string> {
  const out = new Set<string>()
  if (pieces.length === 0) return out
  const live = battleHeavy(state, actor)
  const first = (order: readonly PartId[]): CyberPiece | undefined => {
    for (const part of order) {
      const hit = pieces.find((p) => p.slot === part)
      if (hit) return hit
    }
    return undefined
  }
  if (hasCondition(state, actor, WOUND_HEAD) || live.head || extra.head) {
    const p = first(HEAD_ORDER)
    if (p) out.add(p.uid)
  }
  if (hasCondition(state, actor, WOUND_LIMB) || live.limb || extra.limb) {
    const p = first(LIMB_ORDER)
    if (p) out.add(p.uid)
  }
  return out
}

/**
 * 身上的義體，加上重創讓失效的那幾件（當成 off: { why: 'wound' }；已經有 off 的留原本的）。被動效果、載入戰鬥、甲板、畫面都讀這一份；
 * 要的是「身上有什麼」（件數、手術、沉溺成本）仍然讀 cyberOf。
 */
export function cyberLive(state: WoundState, actor: ActorId): CyberPiece[] {
  const pieces = cyberOf(state, actor)
  const hurt = woundedUids(state, actor, pieces)
  if (hurt.size === 0) return pieces
  return pieces.map((p) => (hurt.has(p.uid) && !p.off ? { ...p, off: { why: 'wound' } } : p))
}

/** 設計圖（義體）；查不到是 undefined。 */
export const blueprintEntry = (k: Pick<Kernel, 'content'>, id: string): BlueprintEntry | undefined => k.content.get<BlueprintEntry>('blueprint', id)

/** 這一件（或這個部位 id）是橋。橋的判斷只有這一個函式（cyber_count 不含橋也用它）。 */
export const isBridge = (pieceOrSlot: Pick<CyberPiece, 'slot'> | string | undefined): boolean =>
  (typeof pieceOrSlot === 'string' ? pieceOrSlot : pieceOrSlot?.slot) === 'bridge'

/** 身上的橋有沒有：ext.bridge 明寫 null 而且沒有橋那一件才是沒有橋（沒寫的當有，照舊）。 */
export function hasBridge(state: Pick<GameState, 'actors'>, actor: ActorId): boolean {
  const a = state.actors[actor]
  if (!a) return false
  return a.ext.bridge !== null || readPieces(a.ext[EXT]).some((p) => p.slot === 'bridge')
}
