// L6 功能 netcombat：共用的小東西——規則表 netcombat_rule、單位上的 ext.net 與 ext.deck.constructs 怎麼讀、構裝資料的最小型別。
// 規格：CYBERSPACE 6.1～6.5 節；dev/adr/0018 第一節。
// 不 import 別的功能：甲板的 unit.ext.deck（{ grade, firewall, slots, constructs: [{ id, class, grade }] }）與內容種類 construct 只認格式。
// unit.ext.net 是單位身上的資料（netcombat 寫、別人只認格式）：{ sync, sync_max, broken, admin?, tethered? }，這個功能另外用 shift、heavy、dice_loss 三個欄位。

import type { BattleKernel, BattleUnit, ContentEntry, Kernel, RollPart, SyncGear } from '../../core'
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
}

export const DEFAULT_NETCOMBAT_RULES: NetcombatRules = {
  refill: 2,
  ap: { attack: 2, melee: 2, refill: 1, swap: 1, script: 1, wall: 2, watch: 2 },
  jam_wall_mult: 2,
  sync_shifts: 1,
  shift_split: 0.6,
  admin_full: 1,
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const AP_KEYS = Object.keys(DEFAULT_NETCOMBAT_RULES.ap) as Array<keyof NetActionAp>

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (!['id', 'refill', 'ap', 'jam_wall_mult', 'sync_shifts', 'shift_split', 'admin_full'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫的：refill、ap、jam_wall_mult、sync_shifts、shift_split、admin_full）`)
  for (const f of ['refill', 'sync_shifts', 'admin_full'] as const) if (e[f] !== undefined && !(isInt(e[f]) && (e[f] as number) >= 0)) p.push(`${f} 要是 0 以上的整數`)
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
  return p
}

/** 現在生效的規則：資料（netcombat_rule/default）有寫、而且格式沒壞的欄位蓋掉內建的預設。 */
export function netcombatRules(k: Pick<Kernel, 'content'>): NetcombatRules {
  const out: NetcombatRules = { ...DEFAULT_NETCOMBAT_RULES, ap: { ...DEFAULT_NETCOMBAT_RULES.ap } }
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .：]/)[0]))
  for (const f of ['refill', 'sync_shifts', 'admin_full', 'jam_wall_mult', 'shift_split'] as const) if (e[f] !== undefined && !bad.has(f)) out[f] = e[f] as number
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
