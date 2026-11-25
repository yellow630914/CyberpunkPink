// L4 規則核心：同步原則（CORE_RULES 第 5 節；CYBERSPACE 4.4、6.4 節；dev/adr/0018 第二節）。
//
// 「接多深」的旋鈕只有一張表：淺、標準、深、全四檔，各自給檢定的加減、受到的感載倍率、要幾級的同步與多少敏感度，
// 全檔另外每回合多回 1 點行動點、過載時沉溺 +2。用它的有四個功能（內海戰鬥的換檔、成人場景的換檔、之後的機甲與反射加速義體），
// 功能之間不能互相 import，所以表與「這個人開得到哪一檔」放在核心。核心不寫各檔位在戰鬥裡的效果（那是 features/netcombat 的事）。
//
// 表是資料（內容種類 sync_rule，id 是 default；規則表，後載入的包可以取代，dev/adr/0017）：核心帶 CORE_RULES 第 5 節的預設，資料有寫就以資料為準：
//   { id: 'default', skill?: 'sync', sink_bonus_at?: 60,
//     gears?: { shallow?: 檔, standard?: 檔, deep?: 檔, full?: 檔 } }
//   檔 = { name, check, load_pct, need_skill, need_sensitivity, ap_regen?, sink_on_overload? }
// 沒寫的檔照預設；寫了的檔整筆取代（和別的規則表一樣是整筆換掉、不合併）。
// load_pct 是「受到的感載是原本的幾 %」（淺 50、標準 100、深 150、全 250）；要變成 load_taken_pct 的修正就是 load_pct − 100。

import type { ActorId, AttrId, GameState } from '../types'
import type { ContentEntry, ContentRegistry } from '../content/registry'
import { clone } from '../util/clone'
import { isRecord } from '../util/sanitize'
import type { RulesKernel } from './kernel'

/** 四個檔位，由淺到深。 */
export const SYNC_GEARS = ['shallow', 'standard', 'deep', 'full'] as const
export type SyncGear = (typeof SYNC_GEARS)[number]
export const isSyncGear = (v: unknown): v is SyncGear => (SYNC_GEARS as readonly unknown[]).includes(v)
/** 檔位的順位（淺 0、標準 1、深 2、全 3）。 */
export const syncGearIndex = (g: SyncGear): number => SYNC_GEARS.indexOf(g)

/** 一檔的規則（執行時的樣子；資料的欄位是底線寫法）。 */
export interface SyncGearRule {
  /** 檔位的名字（淺、標準、深、全；給玩家看的句子加上「檔」） */
  name: string
  /** 自己的檢定加減（命中與所有自己擲的檢定；迴避不加減：dev/adr/0018 N4） */
  check: number
  /** 受到的感載是原本的幾 %：50、100、150、250 */
  loadPct: number
  /** 要「同步」這一項基本功幾級 */
  needSkill: number
  /** 要敏感度多少 */
  needSensitivity: number
  /** 每回合多回幾點行動點（全檔 1） */
  apRegen?: number
  /** 過載時沉溺加幾點（全檔 2） */
  sinkOnOverload?: number
}

export interface SyncRule {
  /** 看哪一項基本功 */
  skill: string
  /** 沉溺到多少以上，上限 +1 級（CORE_RULES 第 5 節、4.3 節） */
  sinkBonusAt: number
  gears: Record<SyncGear, SyncGearRule>
}

/** CORE_RULES 第 5 節的表（CYBERSPACE 6.4 節同）。 */
export const DEFAULT_SYNC_RULE: SyncRule = {
  skill: 'sync',
  sinkBonusAt: 60,
  gears: {
    shallow: { name: '淺', check: -2, loadPct: 50, needSkill: 0, needSensitivity: 0 },
    standard: { name: '標準', check: 0, loadPct: 100, needSkill: 0, needSensitivity: 0 },
    deep: { name: '深', check: 2, loadPct: 150, needSkill: 3, needSensitivity: 40 },
    full: { name: '全', check: 4, loadPct: 250, needSkill: 5, needSensitivity: 70, apRegen: 1, sinkOnOverload: 2 },
  },
}

// ---- 內容種類 ----

export const SYNC_RULE_KIND = 'sync_rule'

export interface SyncGearEntry {
  name: string
  check: number
  load_pct: number
  need_skill: number
  need_sensitivity: number
  ap_regen?: number
  sink_on_overload?: number
}
export interface SyncRuleEntry extends ContentEntry {
  skill?: string
  sink_bonus_at?: number
  gears?: Partial<Record<SyncGear, SyncGearEntry>>
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const intIn = (v: unknown, lo: number, hi: number): v is number => isInt(v) && v >= lo && v <= hi

const GEAR_KEYS = ['name', 'check', 'load_pct', 'need_skill', 'need_sensitivity', 'ap_regen', 'sink_on_overload']

function gearProblems(at: string, g: unknown): string[] {
  if (!isRecord(g)) return [`${at} 要是 { name, check, load_pct, need_skill, need_sensitivity }`]
  const p: string[] = []
  for (const key of Object.keys(g)) if (!GEAR_KEYS.includes(key)) p.push(`${at}.${key}：沒有這個欄位（可以寫的：${GEAR_KEYS.join('、')}）`)
  if (!isText(g.name)) p.push(`${at}.name 要有名字`)
  if (!intIn(g.check, -10, 10)) p.push(`${at}.check 要是 −10～10 的整數（自己的檢定加減）`)
  if (!intIn(g.load_pct, 0, 1000)) p.push(`${at}.load_pct 要是 0～1000 的整數（受到的感載是原本的幾 %）`)
  if (!intIn(g.need_skill, 0, 6)) p.push(`${at}.need_skill 要是 0～6 的整數（同步要幾級）`)
  if (!intIn(g.need_sensitivity, 0, 100)) p.push(`${at}.need_sensitivity 要是 0～100 的整數（敏感度要多少）`)
  if (g.ap_regen !== undefined && !intIn(g.ap_regen, 0, 5)) p.push(`${at}.ap_regen 要是 0～5 的整數（每回合多回幾點行動點）`)
  if (g.sink_on_overload !== undefined && !intIn(g.sink_on_overload, 0, 10)) p.push(`${at}.sink_on_overload 要是 0～10 的整數（過載時沉溺加幾點）`)
  return p
}

/** sync_rule 的格式檢查（回傳給資料作者看的訊息；空的就是合格）。 */
export function syncRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const key of Object.keys(e)) if (!['id', 'skill', 'sink_bonus_at', 'gears'].includes(key)) p.push(`${key}：沒有這個欄位（可以寫的：skill、sink_bonus_at、gears）`)
  if (e.skill !== undefined && !isText(e.skill)) p.push('skill 要是基本功的 id')
  if (e.sink_bonus_at !== undefined && !intIn(e.sink_bonus_at, 1, 100)) p.push('sink_bonus_at 要是 1～100 的整數（沉溺到多少以上上限 +1 級）')
  if (e.gears !== undefined) {
    if (!isRecord(e.gears)) p.push(`gears 要是 { ${SYNC_GEARS.join('、')} } 的檔位表`)
    else for (const [key, g] of Object.entries(e.gears)) {
      if (!isSyncGear(key)) p.push(`gears.${key}：沒有這一檔（只有 ${SYNC_GEARS.join('、')}）`)
      else p.push(...gearProblems(`gears.${key}`, g))
    }
  }
  return p
}

/** 註冊內容種類 sync_rule（createRulesKernel 呼叫；規則表，後載入的包可以整筆取代）。 */
export function registerSyncRuleKind(content: ContentRegistry): void {
  content.defineKind<SyncRuleEntry>({ kind: SYNC_RULE_KIND, owner: 'core', overridable: true, validate: syncRuleProblems })
}

/** 現在生效的同步表：資料 sync_rule/default 蓋掉預設（沒寫的欄位、沒寫的檔照預設；格式不對的欄位忽略）。回傳的是新的一份，改它不會動到預設。 */
export function syncRuleOf(content: Pick<ContentRegistry, 'get'>): SyncRule {
  const out = clone(DEFAULT_SYNC_RULE)
  const e = content.get<SyncRuleEntry>(SYNC_RULE_KIND, 'default')
  if (!e) return out
  if (isText(e.skill)) out.skill = e.skill
  if (intIn(e.sink_bonus_at, 1, 100)) out.sinkBonusAt = e.sink_bonus_at
  if (isRecord(e.gears)) {
    for (const gear of SYNC_GEARS) {
      const g = e.gears[gear]
      if (g === undefined || gearProblems(`gears.${gear}`, g).length) continue
      out.gears[gear] = {
        name: g.name, check: g.check, loadPct: g.load_pct, needSkill: g.need_skill, needSensitivity: g.need_sensitivity,
        ...(g.ap_regen ? { apRegen: g.ap_regen } : {}), ...(g.sink_on_overload ? { sinkOnOverload: g.sink_on_overload } : {}),
      }
    }
  }
  return out
}

// ---- 這個人開得到哪一檔 ----

/**
 * 同步上限的「最高檔」衍生數值的 id：基本是全檔的順位（SYNC_GEARS.length − 1 = 3），沒有加成的欄位，只有減（−1 就是最高到深檔）。
 * 核心在建 kernel 時定義它（registerSyncStats）；syncCapOf 把算好的上限夾在它以下。要「最高到深檔」的功能（調校的 no_full_sync）
 * 給一筆被動效果 { stat: 'sync_cap_max', amount: -1 }，不要再借 sync_cap_bonus 的 −1（M4-core-gaps 第 10 項）。
 */
export const SYNC_CAP_MAX_STAT = 'sync_cap_max'

/** 定義衍生數值 sync_cap_max（createRulesKernel 呼叫）。 */
export function registerSyncStats(stats: Pick<RulesKernel['stats'], 'defineStat'>): void {
  stats.defineStat({ id: SYNC_CAP_MAX_STAT, owner: 'core', name: '同步檔位的最高檔', base: () => SYNC_GEARS.length - 1, min: 0, max: SYNC_GEARS.length - 1 })
}

type SyncKernel = Pick<RulesKernel, 'stats' | 'content'>

/** 這個人的同步等級：基本功（預設 sync）的等級。 */
export function syncSkillOf(k: SyncKernel, state: GameState, actor: ActorId): number {
  const a = state.actors[actor]
  if (!a) throw new Error(`沒有 ${actor} 這個角色`)
  return a.skills[syncRuleOf(k.content).skill] ?? 0
}

/**
 * 這個人的敏感度：衍生數值 bridge_sensitivity（有人註冊時；義體、藥、調校會改它），沒有就讀 actor.ext.bridge.sensitivity（共用的資料慣例，
 * unitFromActor 讀的同一個），再沒有當 50（LEWD_SYSTEM 第 1 節）。
 */
export function syncSensitivityOf(k: SyncKernel, state: GameState, actor: ActorId): number {
  const a = state.actors[actor]
  if (!a) throw new Error(`沒有 ${actor} 這個角色`)
  if (k.stats.hasStat('bridge_sensitivity')) return k.stats.stat(state, actor, 'bridge_sensitivity')
  const bridge = isRecord(a.ext.bridge) ? a.ext.bridge : {}
  return typeof bridge.sensitivity === 'number' && Number.isFinite(bridge.sensitivity) ? bridge.sensitivity : 50
}

/** 這一檔「條件」夠不夠（同步等級與敏感度；不含沉溺與各種加成）。 */
function meets(rule: SyncRule, gear: SyncGear, skill: number, sensitivity: number): boolean {
  const g = rule.gears[gear]
  return skill >= g.needSkill && sensitivity >= g.needSensitivity
}

/**
 * 這個人現在開得到的最高一檔：同步等級與敏感度兩個條件都夠的最高一檔（最低是淺），
 * 沉溺到 sink_bonus_at 以上再 +1 級，再加衍生數值 sync_cap_bonus（技能、義體、藥；沒有人註冊是 0），最高到全檔。
 * 檔位上限的加減修正（MOD_KINDS 的 sync_cap）由換檔的功能另外問、再和這個相加。
 */
export function syncCapOf(k: SyncKernel, state: GameState, actor: ActorId): SyncGear {
  const a = state.actors[actor]
  if (!a) throw new Error(`沒有 ${actor} 這個角色`)
  const rule = syncRuleOf(k.content)
  const skill = a.skills[rule.skill] ?? 0
  const sensitivity = syncSensitivityOf(k, state, actor)
  let at = 0
  SYNC_GEARS.forEach((gear, i) => { if (meets(rule, gear, skill, sensitivity)) at = i })
  if (a.sink >= rule.sinkBonusAt) at += 1
  if (k.stats.hasStat('sync_cap_bonus')) at += k.stats.stat(state, actor, 'sync_cap_bonus')
  // 最高檔（衍生數值 sync_cap_max，核心定義、基本是全檔的順位 3）：開不了全檔的調校給 −1，不管其他加成加了多少都不超過它
  if (k.stats.hasStat(SYNC_CAP_MAX_STAT)) at = Math.min(at, k.stats.stat(state, actor, SYNC_CAP_MAX_STAT))
  return SYNC_GEARS[Math.max(0, Math.min(SYNC_GEARS.length - 1, at))]!
}

/**
 * 這個人開不了這一檔的原因，每個沒夠的條件一句（給玩家看的完整句子；寫出缺的是同步幾級、敏感度多少，現在是多少）。
 * 開得了（這一檔不高於他的上限）是空的。畫面的灰掉與行動的 blocks 用它。
 */
export function syncBlocks(k: SyncKernel, state: GameState, actor: ActorId, gear: SyncGear): string[] {
  if (!isSyncGear(gear)) return [`沒有「${String(gear)}」這一檔。`]
  if (syncGearIndex(gear) <= syncGearIndex(syncCapOf(k, state, actor))) return []
  const rule = syncRuleOf(k.content)
  const g = rule.gears[gear]
  const skill = syncSkillOf(k, state, actor)
  const sensitivity = syncSensitivityOf(k, state, actor)
  const out: string[] = []
  if (skill < g.needSkill) out.push(`${k.stats.skillName(rule.skill)}要 ${g.needSkill} 級才能開${g.name}檔（現在 ${skill} 級）。`)
  if (sensitivity < g.needSensitivity) out.push(`敏感度要 ${g.needSensitivity} 才能開${g.name}檔（現在 ${sensitivity}）。`)
  // 條件都夠、但上限還是比它低（資料把檔位的門檻調成不遞增）：說上限
  if (!out.length) out.push(`${g.name}檔現在開不了（目前最高到${rule.gears[syncCapOf(k, state, actor)].name}檔）。`)
  return out
}

/** syncBlocks 的單句版：開得了是 null；有不只一個條件沒夠，句子接在一起（要一條一條列用 syncBlocks）。 */
export function syncBlock(k: SyncKernel, state: GameState, actor: ActorId, gear: SyncGear): string | null {
  const blocks = syncBlocks(k, state, actor, gear)
  return blocks.length ? blocks.join('') : null
}

// ---- 屬性的代替（戰場；CYBERSPACE 4.1 節） ----

/**
 * 這個戰場裡實際用哪個屬性：戰場的 attrAs 有寫就換（內海：體格由意志代替），沒有就是原本的。
 * run.save 照它換過再算；組武器的功能（構裝的命中、固定傷害）也用它決定武器的 attr。
 * 參數只要有 attrAs 就行（BattleMode 在 L5，這一層不 import 它）。
 */
export function battleAttr(mode: { attrAs?: Partial<Record<AttrId, AttrId>> } | undefined, attr: AttrId): AttrId {
  return mode?.attrAs?.[attr] ?? attr
}
