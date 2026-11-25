// L6 功能 netcombat：共用的小東西——規則表 netcombat_rule、單位上的 ext.net 與 ext.deck.constructs 怎麼讀、構裝資料的最小型別。
// 規格：CYBERSPACE 6.1～6.5 節；dev/adr/0018 第一節。
// 不 import 別的功能：甲板的 unit.ext.deck（{ grade, firewall, slots, constructs: [{ id, class, grade }] }）與內容種類 construct 只認格式。
// unit.ext.net 是單位身上的資料（netcombat 寫、別人只認格式）：{ sync, sync_max, broken, admin?, tethered? }，這個功能另外用 shift、heavy、dice_loss 三個欄位。

import type { BattleKernel, BattleUnit, ContentEntry, GameState, Kernel, RollPart, SyncGear } from '../../core'
import { SYNC_GEARS, isRecord, isSyncGear, syncGearIndex } from '../../core'

export const OWNER = 'netcombat'
export const RULE_KIND = 'netcombat_rule'
export const CONSTRUCT_KIND = 'construct'
/** 這個功能的行動只在內海戰場。 */
export const MODES = ['net']

// ---- 規則表 netcombat_rule（id: default；可以被後載入的包取代，dev/adr/0017） ----

export interface NetActionAp {
  attack: number
  melee: number
  refill: number
  swap: number
  script: number
  wall: number
  watch: number
}

export interface NetcombatRules {
  /** 回填多回幾點 RAM（CYBERSPACE 6.3 節；潛網者的 +1 是技能給的修正 refill） */
  refill: number
  /** 各行動的行動點（攻擊的行動點武器自己寫的優先：狙擊型 3） */
  ap: NetActionAp
  /** 干擾的武器打防火牆時，遮蔽倍率再乘幾倍（CYBERSPACE 6.5 節：×2） */
  jam_wall_mult: number
  /** 每回合可以換幾次檔（基本 1；修正 sync_shifts 再加減） */
  sync_shifts: number
  /** 會換檔的敵人（N25）：自己的感載到上限的這個比例以上退到淺檔，否則開深檔 */
  shift_split: number
  /** 全檔管理行動的次數加幾次（CYBERSPACE 6.4 節） */
  admin_full: number
  /** 戰鬥裡的追蹤度（CYBERSPACE 6.8 節；NETRUNNING 第 5 節的門檻） */
  trace: TraceRules
  /** 倒下（昏過去、被釘住）之後幾分鐘內不能再潛入：角色的狀況 net_burn（CYBERSPACE 6.7 節） */
  burn_minutes: number
  /** 管理行動七種的 RAM 與數字（CYBERSPACE 6.6 節）、每做一次加的追蹤度、檢定失敗再加的追蹤度（admin.ts） */
  admin: AdminRules
  /** 重創的構裝付錢修（CYBERSPACE 6.5 節；repair.ts）：價錢是那件構裝價的 pct %（四捨五入）、最少 min（沒寫價的構裝與傷害骰少一顆都收 min） */
  repair: RepairRules
}

export interface RepairRules {
  pct: number
  min: number
}

/** 管理行動的名字（行動 id 是 adm_<名字>，標籤是 admin:<名字>）。 */
export const ADMIN_NAMES = ['wall', 'breach', 'cut', 'seize', 'crack', 'wipe', 'mark'] as const
export type AdminName = (typeof ADMIN_NAMES)[number]

/**
 * 一種管理行動的數字（規則表的預設；駭入程式的 admin 欄位用同一組鍵蓋過它）：
 * ram 花幾點 RAM；levels 降或升幾級（拆牆、造牆）；slots 一次動幾格（拆牆、斷路）；turns 持續幾回合（斷路：到第幾輪結束；接管：聽幾回合）；
 * amount 主要的數字（擦痕跡擦多少點、標記讓全隊命中加多少、造牆的耐久多幾 %）；targets 一次標幾個敵人。
 */
export interface AdminNumbers {
  ram: number
  levels?: number
  slots?: number
  turns?: number
  amount?: number
  targets?: number
}

export interface AdminRules extends Record<AdminName, AdminNumbers> {
  /** 每做一次管理行動追蹤度加幾點（修正 trace_admin 再加減，最少 0） */
  trace: number
  /** 檢定失敗時追蹤度再加幾點 */
  fail_trace: number
}

/** 戰鬥裡的追蹤度：第 2 輪起每輪開頭加 round，敵方在場有白蕾絲再加 white（不疊）；t1、t2、t3 是三個門檻（增援、增援、定位）；定位之後 locate_rounds 輪強制斷線。 */
export interface TraceRules {
  round: number
  white: number
  t1: number
  t2: number
  t3: number
  locate_rounds: number
}

export const DEFAULT_NETCOMBAT_RULES: NetcombatRules = {
  refill: 2,
  ap: { attack: 2, melee: 2, refill: 1, swap: 1, script: 1, wall: 2, watch: 2 },
  jam_wall_mult: 2,
  sync_shifts: 1,
  shift_split: 0.6,
  admin_full: 1,
  trace: { round: 3, white: 5, t1: 30, t2: 60, t3: 90, locate_rounds: 3 },
  burn_minutes: 60,
  repair: { pct: 10, min: 1 },
  admin: {
    wall: { ram: 2, levels: 1, amount: 0 },
    breach: { ram: 2, levels: 1, slots: 1 },
    cut: { ram: 2, slots: 1, turns: 1 },
    seize: { ram: 3, turns: 1 },
    crack: { ram: 2 },
    wipe: { ram: 1, amount: 5 },
    mark: { ram: 1, amount: 2, targets: 1 },
    trace: 1,
    fail_trace: 5,
  },
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const AP_KEYS = Object.keys(DEFAULT_NETCOMBAT_RULES.ap) as Array<keyof NetActionAp>
const TRACE_KEYS = Object.keys(DEFAULT_NETCOMBAT_RULES.trace) as Array<keyof TraceRules>
const RULE_FIELDS = ['id', 'refill', 'ap', 'jam_wall_mult', 'sync_shifts', 'shift_split', 'admin_full', 'trace', 'burn_minutes', 'admin', 'repair']
/** 管理行動每一個數字可以寫的範圍（規則表與駭入程式共用的鍵）。 */
const ADMIN_FIELD_RANGE: Record<keyof AdminNumbers, [number, number]> = { ram: [0, 6], levels: [1, 2], slots: [1, 4], turns: [1, 9], amount: [0, 100], targets: [1, 4] }
const ADMIN_NUM_KEYS = Object.keys(ADMIN_FIELD_RANGE) as Array<keyof AdminNumbers>
/** 追蹤度的數字要在量表的範圍裡（−30～100；dev/adr/0018 第七節）。 */
const TRACE_MIN = -30
const TRACE_MAX = 100

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (!RULE_FIELDS.includes(key)) p.push(`${key}：沒有這個欄位（可以寫的：${RULE_FIELDS.filter((x) => x !== 'id').join('、')}）`)
  for (const f of ['refill', 'sync_shifts', 'admin_full', 'burn_minutes'] as const) if (e[f] !== undefined && !(isInt(e[f]) && (e[f] as number) >= 0)) p.push(`${f} 要是 0 以上的整數`)
  if (e.jam_wall_mult !== undefined && !(isNum(e.jam_wall_mult) && e.jam_wall_mult >= 0)) p.push('jam_wall_mult 要是 0 以上的數字')
  if (e.shift_split !== undefined && !(isNum(e.shift_split) && e.shift_split > 0 && e.shift_split <= 1)) p.push('shift_split 要是 0～1 之間的數字（不含 0）')
  if (e.ap !== undefined) {
    if (!isRecord(e.ap)) p.push(`ap 要是 { ${AP_KEYS.join('、')} } 各自的行動點`)
    else {
      for (const [key, v] of Object.entries(e.ap)) {
        if (!(AP_KEYS as string[]).includes(key)) p.push(`ap.${key}：沒有這個行動（可以寫的：${AP_KEYS.join('、')}）`)
        else if (!(isInt(v) && v >= 0 && v <= 6)) p.push(`ap.${key} 要是 0～6 的整數`)
      }
    }
  }
  if (e.trace !== undefined) {
    if (!isRecord(e.trace)) p.push(`trace 要是 { ${TRACE_KEYS.join('、')} } 各自的數字`)
    else {
      for (const [key, v] of Object.entries(e.trace)) {
        if (!(TRACE_KEYS as string[]).includes(key)) p.push(`trace.${key}：沒有這個欄位（可以寫的：${TRACE_KEYS.join('、')}）`)
        else if (key === 'round' || key === 'white') {
          if (!(isInt(v) && v >= 0 && v <= 50)) p.push(`trace.${key} 要是 0～50 的整數`)
        } else if (key === 'locate_rounds') {
          if (!(isInt(v) && v >= 1 && v <= 20)) p.push('trace.locate_rounds 要是 1～20 的整數')
        } else if (!(isInt(v) && v >= TRACE_MIN && v <= TRACE_MAX)) p.push(`trace.${key} 要是 ${TRACE_MIN}～${TRACE_MAX} 的整數（追蹤度的範圍）`)
      }
      const t = { ...DEFAULT_NETCOMBAT_RULES.trace, ...e.trace } as Record<string, unknown>
      if (isInt(t.t1) && isInt(t.t2) && isInt(t.t3) && !(t.t1 < t.t2 && t.t2 < t.t3)) p.push('trace 的三個門檻 t1、t2、t3 要由小到大')
    }
  }
  if (e.admin !== undefined) p.push(...adminProblems(e.admin))
  if (e.repair !== undefined) {
    if (!isRecord(e.repair)) p.push('repair 要是 { pct、min } 各自的數字')
    else {
      for (const [key, v] of Object.entries(e.repair)) {
        if (key === 'pct') {
          if (!(isInt(v) && v >= 0 && v <= 100)) p.push('repair.pct 要是 0～100 的整數（構裝價的幾 %）')
        } else if (key === 'min') {
          if (!(isInt(v) && v >= 0)) p.push('repair.min 要是 0 以上的整數')
        } else p.push(`repair.${key}：沒有這個欄位（可以寫的：pct、min）`)
      }
    }
  }
  return p
}

function adminProblems(v: unknown): string[] {
  if (!isRecord(v)) return [`admin 要是 { ${ADMIN_NAMES.join('、')}、trace、fail_trace } 各自的數字`]
  const p: string[] = []
  for (const [key, x] of Object.entries(v)) {
    if (key === 'trace' || key === 'fail_trace') {
      if (!(isInt(x) && x >= 0 && x <= 50)) p.push(`admin.${key} 要是 0～50 的整數`)
    } else if (!(ADMIN_NAMES as readonly string[]).includes(key)) p.push(`admin.${key}：沒有這個管理行動（可以寫的：${ADMIN_NAMES.join('、')}、trace、fail_trace）`)
    else if (!isRecord(x)) p.push(`admin.${key} 要是 { ${ADMIN_NUM_KEYS.join('、')} } 各自的數字`)
    else {
      for (const [f, n] of Object.entries(x)) {
        const range = (ADMIN_FIELD_RANGE as Record<string, [number, number] | undefined>)[f]
        if (!range) p.push(`admin.${key}.${f}：沒有這個欄位（可以寫的：${ADMIN_NUM_KEYS.join('、')}）`)
        else if (!(isInt(n) && n >= range[0] && n <= range[1])) p.push(`admin.${key}.${f} 要是 ${range[0]}～${range[1]} 的整數`)
      }
    }
  }
  return p
}

const cloneAdmin = (a: AdminRules): AdminRules => ({ ...a, ...Object.fromEntries(ADMIN_NAMES.map((n) => [n, { ...a[n] }])) } as AdminRules)

/** 現在生效的規則：資料（netcombat_rule/default）有寫、而且格式沒壞的欄位蓋掉內建的預設。 */
export function netcombatRules(k: Pick<Kernel, 'content'>): NetcombatRules {
  const out: NetcombatRules = { ...DEFAULT_NETCOMBAT_RULES, ap: { ...DEFAULT_NETCOMBAT_RULES.ap }, trace: { ...DEFAULT_NETCOMBAT_RULES.trace }, admin: cloneAdmin(DEFAULT_NETCOMBAT_RULES.admin), repair: { ...DEFAULT_NETCOMBAT_RULES.repair } }
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  for (const f of ['refill', 'sync_shifts', 'admin_full', 'jam_wall_mult', 'shift_split', 'burn_minutes'] as const) if (e[f] !== undefined && !bad.has(f)) out[f] = e[f] as number
  if (isRecord(e.admin) && !bad.has('admin')) {
    for (const key of ['trace', 'fail_trace'] as const) if (isInt(e.admin[key])) out.admin[key] = e.admin[key] as number
    for (const name of ADMIN_NAMES) {
      const x = e.admin[name]
      if (isRecord(x)) out.admin[name] = { ...out.admin[name], ...x } as AdminNumbers
    }
  }
  if (isRecord(e.repair) && !bad.has('repair')) for (const key of ['pct', 'min'] as const) if (isInt(e.repair[key])) out.repair[key] = e.repair[key] as number
  if (isRecord(e.trace) && !bad.has('trace')) for (const key of TRACE_KEYS) if (isInt(e.trace[key])) out.trace[key] = e.trace[key] as number
  if (isRecord(e.ap)) {
    for (const key of AP_KEYS) {
      const v = e.ap[key]
      if (v !== undefined && isInt(v) && v >= 0 && v <= 6) out.ap[key] = v
    }
  }
  return out
}

// ---- 構裝的內容（只讀；格式由 features/deck 定義，這裡只認用到的欄位） ----

export interface ModTier {
  do?: Array<Record<string, unknown>>
  mods?: Partial<Record<string, number>>
}

export interface ConstructInfo extends ContentEntry {
  class: string
  name: string
  desc?: string
  grade?: number
  ram?: number
  ap?: number
  passive?: boolean
  target?: string
  guard?: number
  type?: string
  do?: Array<Record<string, unknown>>
  mods?: Partial<Record<string, number>>
  advanced?: ModTier | null
  ultimate?: ModTier | null
  /** 駭入程式（ITEMS 11.5 節）：{ <管理行動的名字>: { ram?, bonus?, levels?, slots?, turns?, amount?, targets?, fail_trace? } }，admin.ts 讀 */
  admin?: unknown
}

export const constructEntry = (k: Pick<Kernel, 'content'>, id: string): ConstructInfo | undefined => (k.content.hasKind(CONSTRUCT_KIND) ? k.content.get<ConstructInfo>(CONSTRUCT_KIND, id) : undefined)

/** 單位身上裝著的構裝（unit.ext.deck.constructs；沒有甲板資料是空的）。class 沒寫的照內容補。 */
export function constructsOf(k: Pick<Kernel, 'content'>, u: BattleUnit): Array<{ id: string; class: string; grade: number }> {
  const d = u.ext.deck
  if (!isRecord(d) || !Array.isArray(d.constructs)) return []
  const out: Array<{ id: string; class: string; grade: number }> = []
  for (const c of d.constructs) {
    if (!isRecord(c) || !isText(c.id)) continue
    const cls = isText(c.class) ? c.class : (constructEntry(k, c.id)?.class ?? 'unknown')
    out.push({ id: c.id, class: cls, grade: typeof c.grade === 'number' && Number.isFinite(c.grade) ? c.grade : (constructEntry(k, c.id)?.grade ?? 1) })
  }
  return out
}

// ---- 單位身上的 ext.net ----

export interface NetExt {
  sync: SyncGear
  sync_max: SyncGear
  broken: string[]
  admin?: number
  tethered?: boolean
  /** 會換檔的敵人（N25）：自己的回合開始時照感載換 */
  shift?: boolean
  /** 這一場被重創過（破損又中一次）：結束時寫回角色 */
  heavy?: boolean
  /** 沒有構裝可以破損的人：這一場傷害骰少幾顆 */
  dice_loss?: number
  /** 戰後要帶回角色、直到修好的重創：構裝的 id（沒有構裝可以破損的，傷害骰少 1 顆記成 'dice'）；breakOne 重創時加、fixOne 修好時減，開打時從角色帶進來（B028） */
  carry?: string[]
}

/** 單位的 ext.net（要有合法的檔位才算）；沒有是 undefined。直接是單位身上的那個物件，改它就是改單位。 */
export function netOf(u: BattleUnit): NetExt | undefined {
  const n = u.ext.net
  return isRecord(n) && isSyncGear(n.sync) ? (n as unknown as NetExt) : undefined
}

export const gearOf = (u: BattleUnit): SyncGear | undefined => netOf(u)?.sync

/** 破損的構裝 id（壞掉的資料當成沒有）。 */
export function brokenOf(u: BattleUnit): string[] {
  const n = u.ext.net
  return isRecord(n) && Array.isArray(n.broken) ? n.broken.filter(isText) : []
}

/** 要帶回角色的重創（單位身上的 ext.net.carry；壞掉的資料當成沒有）。 */
export function carryOf(u: BattleUnit): string[] {
  const n = u.ext.net
  return isRecord(n) && Array.isArray(n.carry) ? n.carry.filter(isText) : []
}

/** 角色的狀況：重創的構裝還沒修好（直到睡一覺或付錢修；B028）。actor.ext 同名的鍵記是哪幾件。 */
export const BROKEN_CONDITION = 'net_broken'
export const BROKEN_EXT = 'net_broken'

/** 角色帶著的重創：沒有帶 net_broken 狀況的是 null；帶著的回傳 actor.ext.net_broken 記的構裝 id（壞掉的資料當成沒有；沒記是哪一件的是空陣列，開打時照順序挑）。 */
export function carriedOf(state: Pick<GameState, 'actors'>, actor: string): string[] | null {
  const a = state.actors[actor]
  if (!a || !a.conditions.some((c) => c.id === BROKEN_CONDITION)) return null
  const v = a.ext[BROKEN_EXT]
  return Array.isArray(v) ? v.filter(isText) : []
}

/** 確保單位身上有 ext.net 這個物件（沒有檔位也行，破損要記在這裡）。 */
export function ensureNet(u: BattleUnit): Record<string, unknown> {
  if (!isRecord(u.ext.net)) u.ext.net = { broken: [] }
  const n = u.ext.net as Record<string, unknown>
  if (!Array.isArray(n.broken)) n.broken = []
  return n
}

/** 單位的 sync:<檔> 標籤：技能的條件看它（不讀 ext）。 */
export function setGearTag(u: BattleUnit, gear: SyncGear): void {
  u.tags = [...u.tags.filter((t) => !t.startsWith('sync:')), `sync:${gear}`]
}

export const gearIdx = (g: SyncGear): number => syncGearIndex(g)
export const gearAt = (i: number): SyncGear => SYNC_GEARS[Math.max(0, Math.min(SYNC_GEARS.length - 1, i))]!

/** 一組加減的合計。 */
export const sum = (parts: readonly RollPart[]): number => parts.reduce((s, p) => s + p.value, 0)

// ---- 干擾（CYBERSPACE 6.5 節）與破損（6.5 節）用到的名字 ----

export const JAM_SLOTS = ['weapon', 'defense', 'tool'] as const
export type JamSlot = (typeof JAM_SLOTS)[number]
export const isJamSlot = (v: unknown): v is JamSlot => (JAM_SLOTS as readonly unknown[]).includes(v)
export const JAM_NAME: Record<JamSlot, string> = { weapon: '武器', defense: '防護', tool: '工具' }
/** 干擾的狀態：jam_weapon、jam_defense、jam_tool（規則表 battle_status 要有；各一回合）。 */
export const jamStatus = (slot: JamSlot): string => `jam_${slot}`
export const isJammed = (u: BattleUnit, slot: JamSlot): boolean => u.statuses.some((s) => s.id === jamStatus(slot))
/** 破損要挑哪一類（CYBERSPACE 6.5 節：照武器、工具、防護的順序，挑還沒破損的第一件）。 */
export const BREAK_ORDER = ['weapon', 'tool', 'defense'] as const

export type { BattleKernel }
