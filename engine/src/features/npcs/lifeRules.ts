// L6 功能 npcs：共同記憶與 NPC 自己的日子的規則數字（內容種類 npc_life_rule，id: default 蓋掉內建的數字）。
// 規格：NPC_SYSTEM 3.2 節、第 8 節（8.1～8.3）、第 9 節；dev/work/M2-npc-life.md。數字的出處都在欄位旁邊；設計書沒寫的是暫定值。

import type { Kernel } from '../../core'
import { clone, isRecord, isSafeInt } from '../../core'

export const LIFE_RULE_KIND = 'npc_life_rule'

type Range = [number, number]

export interface MemoryRules {
  /** 超過幾筆開始合併（8.3） */
  limit: number
  /** 最近幾筆不動（8.3） */
  recent: number
  /** 第二輪合併的天數（8.3：10 天） */
  bucket_days: number
  /** recall 預設取幾筆（8.2） */
  recall: number
  /** 簡述最長幾個字（暫定） */
  text_max: number
  /** 檢索的分數（8.2） */
  score: { pinned: number; shared: number; place: number; within3: number; within10: number }
  /** 委託：接案、收尾的報告（action；階段中途的不記）。暫定：commission／fixer 還沒做完，名字照 M2 的工單 */
  gig_actions: string[]
  /** 收尾有人倒下或背刺：這些拍子的標記讓重要程度升到 3（暫定） */
  gig_bad_tags: string[]
  /** 竄網：被扣線、碰到流竄 AI（結果或拍子的標記；M3 才有，暫定） */
  netrun_bad: string[]
  /** 社交：招募、離隊（action）重要程度 2 */
  social_up: string[]
  /** 談判（action；一般買賣不記） */
  deal_actions: string[]
  /** 閒暇：夥伴變動（action）；帳單出事（前綴與結果） */
  downtime_actions: string[]
  bill_prefix: string
  bill_bad: string[]
}

export interface LifeRoll {
  /** 每幾天擲一次、一次最多補幾次、親密度幾以上的人也算（9） */
  every_days: number
  max_catchup: number
  min_affinity: number
  /** 自己接了案：行者 40%；錢是這個範圍乘（主職階數 + 1）；15% 升一階，最高 max_tier */
  job: { chance: number; cash: Range; promote_chance: number; max_tier: number }
  /** 受傷 10%，3～7 天 */
  injured: { chance: number; days: Range }
  /** 被捕：基礎 2%，他勢力的對頭的敵對值每 20 點 +2% */
  arrest: { base: number; per: number; step: number }
  /** 欠債：窮人（財富 poor_max 以下）6% */
  debt: { chance: number; poor_max: number }
  /** 沉溺上升：沉溺 40 以上 15%，+3～+8，到 80 以上「溺感邊緣」 */
  sink: { min: number; chance: number; gain: Range; edge: number; max: number }
  /** 換了義體 5%：一項屬性 +1（最高 attr_max） */
  implant: { chance: number; attr_max: number }
}

export interface RosterRoll {
  /** 每份名單每 3 天 25% 發生一件（3.2）；契約季（旗標 season_flag 開著）加倍 */
  chance: number
  season_flag: string
  season_mult: number
  /** 搬來、搬走、搬去另一區、被捕或死 */
  weights: { join: number; leave: number; move: number; trouble: number }
  /** 出事時死的比例（沒有保護時） */
  die_share: number
  /** 這些區出事的權重倍數（舊港、鏽帶、地下層較高） */
  risky: Record<string, number>
  /** 「認識的人不會因為汰換而死」的預設（預設開；玩家的設定是旗標 npcs:protect_known） */
  protect_known: boolean
}

export interface LifeRules {
  memory: MemoryRules
  life: LifeRoll
  roster: RosterRoll
}

export const DEFAULT_LIFE_RULES: LifeRules = {
  memory: {
    limit: 200, recent: 50, bucket_days: 10, recall: 6, text_max: 200,
    score: { pinned: 10, shared: 3, place: 2, within3: 1.5, within10: 0.75 },
    gig_actions: ['fixer.accept', 'commission.close', 'commission.end', 'commission.fail', 'commission.retreat'],
    gig_bad_tags: ['down', 'betray'],
    netrun_bad: ['trapped', 'held', 'rogue_ai'],
    social_up: ['roster.join', 'roster.leave'],
    deal_actions: ['negotiate', 'fixer.haggle'],
    downtime_actions: ['roster.join', 'roster.leave'],
    bill_prefix: 'bill.',
    bill_bad: ['overdue', 'unpaid', 'short', 'default'],
  },
  life: {
    every_days: 3, max_catchup: 10, min_affinity: 30,
    job: { chance: 0.4, cash: [150, 400], promote_chance: 0.15, max_tier: 5 },
    injured: { chance: 0.1, days: [3, 7] },
    arrest: { base: 0.02, per: 0.02, step: 20 },
    debt: { chance: 0.06, poor_max: 1 },
    sink: { min: 40, chance: 0.15, gain: [3, 8], edge: 80, max: 100 },
    implant: { chance: 0.05, attr_max: 20 },
  },
  roster: {
    chance: 0.25, season_flag: 'city_event:contract_season', season_mult: 2,
    weights: { join: 3, leave: 3, move: 2, trouble: 1 },
    die_share: 0.4,
    risky: { oldport: 2, rustbelt: 2, underground: 2 },
    protect_known: true,
  },
}

function merge(base: unknown, over: unknown): unknown {
  if (isRecord(base) && isRecord(over) && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...base }
    for (const [key, v] of Object.entries(over)) out[key] = key in base ? merge(base[key], v) : v
    return out
  }
  return over === undefined ? base : over
}

/** 規則（內容 npc_life_rule 的 default 蓋在內建的數字上）。回傳複製。 */
export function lifeRules(k: Pick<Kernel, 'content'>): LifeRules {
  const e = k.content.get(LIFE_RULE_KIND, 'default')
  if (!e) return clone(DEFAULT_LIFE_RULES)
  const { id: _id, ...rest } = e
  return merge(clone(DEFAULT_LIFE_RULES), rest) as LifeRules
}

// ---- 格式檢查：照預設值的形狀逐欄看（型別要一樣；數字有範圍；範圍是 [下限, 上限]） ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 機率欄位（0～1）。 */
const PROB = new Set([
  'life.job.chance', 'life.job.promote_chance', 'life.injured.chance', 'life.arrest.base', 'life.arrest.per', 'life.debt.chance', 'life.sink.chance', 'life.implant.chance',
  'roster.chance', 'roster.die_share',
])
/** 一定要是正整數的欄位。 */
const POSITIVE_INT = new Set(['memory.limit', 'memory.recent', 'memory.bucket_days', 'memory.recall', 'memory.text_max', 'life.every_days', 'life.max_catchup', 'life.arrest.step', 'life.job.max_tier', 'life.sink.max', 'life.implant.attr_max'])

const sub = (path: string, key: string): string => (path ? `${path}.${key}` : key)

function check(path: string, base: unknown, v: unknown, out: string[]): void {
  if (Array.isArray(base)) {
    if (base.length === 2 && base.every(isNum)) {
      if (!(Array.isArray(v) && v.length === 2 && v.every((n) => isSafeInt(n) && n >= 0) && (v[0] as number) <= (v[1] as number))) out.push(`${path} 要是 [下限, 上限]，都是 0 以上的整數`)
    } else if (!(Array.isArray(v) && v.every(isText))) out.push(`${path} 要是字串的陣列`)
    return
  }
  if (isRecord(base)) {
    if (!isRecord(v)) return void out.push(`${path} 要是物件`)
    const free = path === 'roster.risky'
    for (const [key, x] of Object.entries(v)) {
      if (free) {
        if (!(isNum(x) && x >= 0)) out.push(`${sub(path, key)} 要是 0 以上的倍數`)
      } else if (!(key in base)) out.push(`${sub(path, key)}：沒有這個欄位（可以寫：${Object.keys(base).join('、')}）`)
      else check(sub(path, key), base[key], x, out)
    }
    return
  }
  const key = path
  if (typeof base === 'boolean') {
    if (typeof v !== 'boolean') out.push(`${key} 要是 true 或 false`)
  } else if (typeof base === 'string') {
    if (!isText(v)) out.push(`${key} 要是字串`)
  } else if (PROB.has(key)) {
    if (!(isNum(v) && v >= 0 && v <= 1)) out.push(`${key} 要是 0～1 的數字`)
  } else if (POSITIVE_INT.has(key)) {
    if (!(isSafeInt(v) && v >= 1)) out.push(`${key} 要是 1 以上的整數`)
  } else if (!(isNum(v) && v >= 0)) out.push(`${key} 要是 0 以上的數字`)
}

/** 內容種類 npc_life_rule 的格式檢查（只收 id: default 一筆的欄位；欄位照預設值的形狀）。 */
export function lifeRuleProblems(e: Record<string, unknown>): string[] {
  const { id: _id, ...rest } = e
  const out: string[] = []
  check('', DEFAULT_LIFE_RULES, rest, out)
  return out
}
