// L6 功能 fixer 的資料與純函式：內容的格式、規則（數字）、狀態的形狀、委託的格式、踩點的手段與未知清單。不碰登錄表（登錄在 index.ts）。
// 規格：FIXER 第 1、2 節；COMMISSIONS 2.3 節「分支」、第 4 節；LIFE 1.1 節；CORE_RULES 第 8 節；UI 7.1、7.2 節；dev/adr/0016 第三節與 G18；dev/work/M2-fixer.md。
//
// 這個功能不 import 別的功能：副本只經由報告的 launch（活動 commission）與 activity.end；敵對值、人情、信譽只經由量表、效果、條件與變更。
// 召集請人（hire.ts）與入帳分帳（pay.ts；M2-fixer-pay）的規則數字也在這裡（fixer_rule）。

import type { ActorId, AttrId, CheckRoll, ContentEntry, GameState, Kernel } from '../../core'
import { ActionBlocked, REP_TIERS, REP_TIER_NAME, clone, isRecord, isSafeInt, repTierOf, rollCheck } from '../../core'

export const OWNER = 'fixer'
/** state.ext 的鍵 */
export const EXT = 'fixer'
/** 內容種類：中間人 */
export const KIND = 'fixer'
/** 內容種類：規則的數字（id: default 蓋掉內建的預設） */
export const RULE_KIND = 'fixer_rule'
/** 量表：街頭信譽 */
export const REP_METER = 'rep'
/** 起手開的活動 */
export const COMMISSION_ACTIVITY = 'commission'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

// ---- 內容：中間人 ----

export interface FixerEntry extends ContentEntry {
  name?: string
  /** 這位中間人是哪個 NPC（人情記在她名下） */
  npc: string
  district: string
  /** 她的店在哪一塊街區 */
  block?: string
  /** 門路：擅長的委託類型 */
  kinds: string[]
  /** 抽成（0～1；FIXER 第 2 節④） */
  cut: number
  /** 她肯見你的最低街頭信譽（沒寫是人人都見） */
  min_rep?: number
  /** 後台：哪個勢力罩她（FIXER 第 1 節）。那個勢力對你的敵對值到「懸賞」就不接你（FACTIONS 6.1 節）；沒寫就沒有後台 */
  backer?: string
}

export function fixerProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.name !== undefined && !isText(e.name)) p.push('name 要是文字')
  if (!isText(e.npc)) p.push('npc 要是 NPC 的 id')
  if (!isText(e.district)) p.push('district 要是區的 id')
  if (e.block !== undefined && !isText(e.block)) p.push('block 要是街區的 id')
  if (!isTextList(e.kinds) || e.kinds.length === 0) p.push('kinds 要是至少一個委託類型的 id 的陣列')
  if (!(typeof e.cut === 'number' && Number.isFinite(e.cut) && e.cut >= 0 && e.cut <= 1)) p.push('cut 要是 0～1 的數字（抽成的比例）')
  if (e.min_rep !== undefined && !(isSafeInt(e.min_rep) && e.min_rep >= 0 && e.min_rep <= 100)) p.push('min_rep 要是 0～100 的整數')
  if (e.backer !== undefined && !isText(e.backer)) p.push('backer 要是勢力的 id')
  return p
}

// ---- 規則 ----

export interface FixerRules {
  /** 匯進帳戶：到手的比例（FIXER 第 2 節①：85%） */
  pay_cred: number
  /** 換人情：到手的比例（70%） */
  pay_favor: number
  /** 匯進帳戶入帳時，目標勢力的敵對值加多少（LIFE 1.1 節：+2） */
  hostility_cred: number
  /** 接案的那一輪交涉（G18）：DC = 基準 ＋ 等級 */
  haggle_dc_base: number
  /** 交涉成功、大成功報酬加多少（5%、10%） */
  haggle_success: number
  haggle_critical: number
  /** 一次踩點花幾分鐘（一個時段，4 小時） */
  scout_minutes: number
  /** 踩點的 DC = 基準 ＋ 等級 × 每級；第 N 次起每次再加一點 */
  scout_dc_base: number
  scout_dc_per_grade: number
  scout_hard_from: number
  scout_hard_plus: number
  /** 自然 1 驚動目標：警戒（或追蹤度）的起始值加多少 */
  scout_alert: number
  /** 買情報：每一級的價錢 */
  intel_per_grade: number
  /** 評價對報酬的加成（G16：S +20%、A +10%、B 不變、C −10%） */
  rating_bonus: Record<Rating, number>
  /**
   * 街頭信譽（CORE_RULES 8.1 節、LIFE 1.3 節；2026-11-23 定案）：完成委託看委託的級和主角的級（無名、熟面孔 I；有號 II；搶手 III；頂尖 IV；傳說 V）。
   * 同級 +rep_same、高一級以上 +rep_higher、比主角低級 rep_lower（0：不變，錢與歷練照給）；評價 S 再 +rep_top（低級的委託不加）。
   * 失敗 rep_failed（−3，不分等級）、中途放棄 rep_abandon（−5，LIFE 第 9 節，暫定）
   */
  rep_same: number
  rep_higher: number
  rep_lower: number
  rep_top: number
  rep_failed: number
  rep_abandon: number
  /** 借人：價錢 = 等級² × borrow_base × borrow_mult（COMMISSIONS 6.5：出場費的 1.5 倍） */
  borrow_base: number
  borrow_mult: number
  /** 分紅：主角（老闆）拿幾份（NPC_SYSTEM 10.5：多拿一份，總共兩份） */
  boss_shares: number
  /** 每一面最多請幾個人（COMMISSIONS 6.5） */
  aux_max: number
  /** 靠交情：DC = 基準 − 親密度 ÷ 步長；忠誠到這個數字以上不用擲 */
  bond_dc_base: number
  bond_affinity_step: number
  bond_loyalty: number
  /** 一起去的人：做完之後親密度加多少、錢照說好的付了的人忠誠加多少（NPC_SYSTEM 7.3、10.4） */
  trip_affinity: number
  trip_loyalty: number
  /** 完成它當委託人的委託：委託人勢力的好感加多少、評價最高（S）再加多少（FACTIONS 5.2 節：+3、再 +2 共 +5） */
  favor_done: number
  favor_top: number
  /** 目標勢力的敵對值到「找麻煩」：出發時遭遇預算加幾點（一點一個雜兵）；到「追捕」：警戒起始加多少（FACTIONS 6.1 節：+1、+20） */
  hostile_budget: number
  hostile_alert: number
}

/** 委託的評價四級（M2-commission-close 的 rate 給的）。 */
export const RATING_KEYS = ['S', 'A', 'B', 'C'] as const
export type Rating = (typeof RATING_KEYS)[number]

export const DEFAULT_FIXER_RULES: FixerRules = {
  pay_cred: 0.85, pay_favor: 0.7, hostility_cred: 2, haggle_dc_base: 13, haggle_success: 0.05, haggle_critical: 0.1,
  scout_minutes: 240, scout_dc_base: 10, scout_dc_per_grade: 2, scout_hard_from: 4, scout_hard_plus: 1, scout_alert: 15, intel_per_grade: 300,
  rating_bonus: { S: 0.2, A: 0.1, B: 0, C: -0.1 }, rep_same: 2, rep_higher: 4, rep_lower: 0, rep_top: 1, rep_failed: -3, rep_abandon: -5, borrow_base: 200, borrow_mult: 1.5, boss_shares: 2, aux_max: 2,
  bond_dc_base: 20, bond_affinity_step: 5, bond_loyalty: 70, trip_affinity: 2, trip_loyalty: 2, favor_done: 3, favor_top: 2, hostile_budget: 1, hostile_alert: 20,
}

type RuleKey = Exclude<keyof FixerRules, 'rating_bonus'>
const RULE_FIELDS: Array<[RuleKey, number, number, boolean]> = [
  // [鍵, 下限, 上限, 整數]
  ['pay_cred', 0, 1, false], ['pay_favor', 0, 1, false], ['hostility_cred', 0, 100, true], ['haggle_dc_base', 0, 40, true], ['haggle_success', 0, 1, false], ['haggle_critical', 0, 1, false],
  ['scout_minutes', 0, 100000, true], ['scout_dc_base', 0, 40, true], ['scout_dc_per_grade', 0, 10, true], ['scout_hard_from', 1, 20, true], ['scout_hard_plus', 0, 10, true],
  ['scout_alert', 0, 100, true], ['intel_per_grade', 0, 100000, true],
  ['rep_same', -100, 100, true], ['rep_higher', -100, 100, true], ['rep_lower', -100, 100, true], ['rep_top', -100, 100, true], ['rep_failed', -100, 100, true], ['rep_abandon', -100, 100, true], ['borrow_base', 0, 100000, true], ['borrow_mult', 0, 10, false], ['boss_shares', 1, 10, true], ['aux_max', 1, 2, true],
  ['bond_dc_base', 0, 40, true], ['bond_affinity_step', 1, 100, true], ['bond_loyalty', 0, 100, true], ['trip_affinity', 0, 100, true], ['trip_loyalty', 0, 100, true],
  ['favor_done', 0, 100, true], ['favor_top', 0, 100, true], ['hostile_budget', 0, 4, true], ['hostile_alert', 0, 100, true],
]

const ratingBonusProblem = (v: unknown): string | null => {
  if (!isRecord(v)) return 'rating_bonus 要是 { S?, A?, B?, C? }，每一項是 −1～5 的數字（加成的比例）'
  for (const [key, x] of Object.entries(v)) {
    if (!(RATING_KEYS as readonly string[]).includes(key)) return `rating_bonus.${key}：評價只有 ${RATING_KEYS.join('、')}`
    if (!(typeof x === 'number' && Number.isFinite(x) && x >= -1 && x <= 5)) return `rating_bonus.${key} 要是 −1～5 的數字`
  }
  return null
}

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi, int] of RULE_FIELDS) {
    const v = e[key]
    if (v === undefined) continue
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)))) p.push(`${key} 要是 ${lo}～${hi} 的${int ? '整數' : '數字'}`)
  }
  if (e.rating_bonus !== undefined) {
    const bad = ratingBonusProblem(e.rating_bonus)
    if (bad) p.push(bad)
  }
  return p
}

/** 現在生效的規則：資料 fixer_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function fixerRules(k: Pick<Kernel, 'content'>): FixerRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: FixerRules = { ...DEFAULT_FIXER_RULES, rating_bonus: { ...DEFAULT_FIXER_RULES.rating_bonus } }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(' ')[0]!.split('.')[0]!))
  for (const [key] of RULE_FIELDS) if (e[key] !== undefined && !bad.has(key)) out[key] = e[key] as number
  if (e.rating_bonus !== undefined && !bad.has('rating_bonus')) Object.assign(out.rating_bonus, e.rating_bonus)
  return out
}

// ---- 敵對值的後果（FACTIONS 6.1 節） ----

/** 敵對值的分段 id（安全功能的 hostility_tier 條件認得的名字）：找麻煩、追捕、懸賞。 */
export const HOSTILITY_TIER_TROUBLE = 'trouble'
export const HOSTILITY_TIER_PURSUIT = 'pursuit'
export const HOSTILITY_TIER_BOUNTY = 'bounty'

/**
 * 這個勢力對你的敵對值到了某一段以上嗎：問條件 hostility_tier（敵對值的功能 security 登記）。沒有人登記那個條件就當作沒到。
 * 這個功能不 import security，也不自己讀量表的數字與分段表：分段是 security 的規則。
 */
export function hostilityAtLeast(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, faction: string, tier: string): boolean {
  if (!k.conditions.kinds().includes('hostility_tier')) return false
  return k.conditions.test({ kind: 'hostility_tier', faction, min: tier } as never, { state, stats: k.stats, timeRules: k.timeRules })
}

// ---- 委託的格式（fixer.offers 回傳的東西） ----

export const CATS = ['stage', 'path', 'guard', 'lace', 'target', 'employer', 'modifier'] as const
export type Cat = (typeof CATS)[number]
export const CAT_NAME: Record<Cat, string> = { stage: '階段', path: '路', guard: '守備', lace: '蕾絲', target: '目標', employer: '雇主', modifier: '詞條' }

/** 揭開之後給副本什麼：哪個階段的面、哪條踩點開出來的路、哪一段的守備、哪個詞條、哪個旗標。 */
export type Reveal = { stage: number } | { branch: string } | { guards: number } | { modifier: string } | { flag: string }
export const REVEAL_KEYS = ['stage', 'branch', 'guards', 'modifier', 'flag'] as const

export interface UnknownItem {
  id: string
  cat: Cat
  /** 揭開之後給玩家看的內容 */
  text: string
  reveal: Reveal
}

/** 一件具體的副本（commission 這個內容種類的格式）；這個功能只讀它的幾個欄位，其餘原樣帶進副本。 */
export interface CommissionDef {
  id: string
  name?: string
  kind?: string
  main?: string
  scale?: string
  grade?: number | string
  target_faction?: string
  district?: string
  /** 入口所在的街區（可以不寫；有寫而且有人註冊條件 in_block 時，出發要人在那裡） */
  block?: string
  conditions?: string[]
  stages: Array<{ name?: string; faces: Record<string, unknown> }>
  [extra: string]: unknown
}

export interface Offer {
  id: string
  commission: CommissionDef
  title: string
  brief: string
  /** 報酬（現金的全額） */
  reward: number
  unknowns: UnknownItem[]
  min_rep?: number
  /** 哪位中間人給的（board 蓋上去的） */
  fixer?: string
}

export function revealProblem(r: unknown, stages: number): string | null {
  if (!isRecord(r)) return 'reveal 要是 { stage }、{ branch }、{ guards }、{ modifier } 或 { flag }'
  const keys = Object.keys(r)
  if (keys.length !== 1 || !(REVEAL_KEYS as readonly string[]).includes(keys[0]!)) return 'reveal 一次只能寫 stage、branch、guards、modifier、flag 其中一個'
  const key = keys[0]!
  const v = r[key]
  if (key === 'stage' || key === 'guards') return isSafeInt(v) && v >= 1 && v <= stages ? null : `reveal.${key} 要是 1～${stages} 的整數（第幾階段）`
  return isText(v) ? null : `reveal.${key} 要是字串`
}

/** 一件委託的格式問題（一條一句）。 */
export function offerProblems(o: unknown): string[] {
  if (!isRecord(o)) return ['委託要是物件']
  const p: string[] = []
  if (!isText(o.id)) p.push('id 要是委託的 id')
  if (!isText(o.title)) p.push('title 要是文字')
  if (!isText(o.brief)) p.push('brief 要是文字')
  if (!(isSafeInt(o.reward) && o.reward >= 0)) p.push('reward 要是 0 以上的整數')
  if (o.min_rep !== undefined && !(isSafeInt(o.min_rep) && o.min_rep >= 0 && o.min_rep <= 100)) p.push('min_rep 要是 0～100 的整數')
  const c = o.commission
  let stages = 0
  if (!isRecord(c) || !isText(c.id) || !Array.isArray(c.stages) || c.stages.length === 0) p.push('commission 要是一件具體的副本（要有 id 與至少一個階段）')
  else stages = c.stages.length
  if (!Array.isArray(o.unknowns)) p.push('unknowns 要是未知的陣列')
  else {
    const seen = new Set<string>()
    o.unknowns.forEach((u: unknown, i: number) => {
      const at = `unknowns[${i}]`
      if (!isRecord(u)) return void p.push(`${at} 要是 { id, cat, text, reveal }`)
      if (!isText(u.id)) p.push(`${at}.id 要是未知的 id`)
      else if (seen.has(u.id)) p.push(`${at}.id：${u.id} 重複`)
      else seen.add(u.id)
      if (!(CATS as readonly unknown[]).includes(u.cat)) p.push(`${at}.cat 只能是 ${CATS.join('、')}`)
      if (!isText(u.text)) p.push(`${at}.text 要是文字`)
      const r = revealProblem(u.reveal, stages)
      if (r) p.push(`${at}.${r}`)
    })
  }
  return p
}

// ---- 狀態 ----

export type PayKind = 'cash' | 'cred' | 'favor'
export const PAY_KINDS: readonly PayKind[] = ['cash', 'cred', 'favor']
export const PAY_NAME: Record<PayKind, string> = { cash: '現金晶片', cred: '匯進帳戶', favor: '三成換人情' }

export type Degree = CheckRoll['degree']

export interface Terms {
  /** 談好的報酬（現金的全額） */
  reward: number
  pay: PayKind
  /** 中間人的抽成（比例） */
  cut: number
}

export interface ScoutEntry {
  /** 第幾次踩點（1 起算） */
  n: number
  method: string
  skill: string
  natural: number
  total: number
  dc: number
  degree: Degree
  /** 這一次揭開的未知 id */
  revealed: string[]
  /** 自然 1：現實的警戒起始加了多少／內海的追蹤度起始加了多少 */
  alert?: number
  trace?: number
  day: number
}

export type JobStatus = 'active' | 'done' | 'failed'

// ---- 召集請人（M2-fixer-pay）----

/** 輔助面的三個面（COMMISSIONS 2.1）。 */
export const AUX_FACES = ['meat', 'net', 'opinion'] as const
export type AuxFace = (typeof AUX_FACES)[number]
export const AUX_FACE_NAME: Record<AuxFace, string> = { meat: '現實', net: '內海', opinion: '輿論' }

/** 請人的辦法（COMMISSIONS 6.5）：付錢、用人情、欠人情、靠交情；向中間人借是第五種（只能付錢）。 */
export const HIRE_WAYS = ['pay', 'use_favor', 'owe_favor', 'bond', 'borrow'] as const
export type HireWay = (typeof HIRE_WAYS)[number]
export const HIRE_NAME: Record<HireWay, string> = { pay: '付錢', use_favor: '用人情', owe_favor: '欠人情', bond: '靠交情', borrow: '向中間人借人' }

export type FavorSize = 'small' | 'mid' | 'big'
export const FAVOR_SIZE_NAME: Record<FavorSize, string> = { small: '小', mid: '中', big: '大' }

/** 請一個人付出的代價（記下來，退人時才知道退什麼）：cash 是付出去的現金；favor 是用掉的（used）或欠下的（owed）人情。 */
export interface HireCost {
  cash?: number
  favor?: { kind: 'used' | 'owed'; who: string; size: FavorSize }
}

export interface AuxEntry {
  actor: string
  way: HireWay
  cost: HireCost
}

/** 每一面請了誰（每一面最多 aux_max 個）。 */
export type Aux = Partial<Record<AuxFace, AuxEntry[]>>

export interface Job {
  /** 就是那件委託的 id（出發時 origin.ref 也是它） */
  id: string
  /** 第幾個接的（最近接的那一件 seq 最大） */
  seq: number
  fixer: string
  /** 中間人是哪個 NPC（人情記在她名下） */
  npc: string
  title: string
  brief: string
  commission: CommissionDef
  unknowns: UnknownItem[]
  terms: Terms
  /** 交涉過沒有、結果（沒談過是 null） */
  haggled: Degree | null
  status: JobStatus
  /** 哪一天接的 */
  day: number
  /** 揭開的未知 id */
  revealed: string[]
  scouts: number
  /** 警戒的起始加值（現實面）與追蹤度的起始加值（內海面） */
  alert_start: number
  trace_start: number
  log: ScoutEntry[]
  /** 替輔助面請的人（M2-fixer-pay） */
  aux: Aux
  /** 靠交情已經失敗過的人（這一件不能再用這個辦法） */
  bond_failed: string[]
  /** 借過幾個人（借來的角色的流水號） */
  borrow_n: number
  /** 入帳之後留下的紀錄（分帳的數字；進行中是 null） */
  payout: PayoutRecord | null
}

/** 入帳之後記在手上那一件的分帳紀錄（給畫面與之後的帳單看）。 */
export interface PayoutRecord {
  outcome: 'done' | 'failed'
  rating: Rating | null
  reward: number
  wallet: 'cash' | 'cred'
  gross: number
  cut: number
  pool: number
  /** 主角實拿（扣掉補的） */
  pc_net: number
  /** 付不出來、記成欠的出場費 */
  debt: number
}

/** 副本交回來之後等著結算的事（activity.end 記下，report.after 接著提交 fixer.payout；撤退的由 rewind.keep 退人）。 */
export interface PendingEnd {
  job: string
  outcome: 'done' | 'failed' | 'retreat'
  rating?: Rating
}

/** 中間人某一天的桌面：每件委託交涉的結果、報酬、有沒有被收回去。 */
export interface TableEntry {
  haggle?: Degree
  /** 交涉之後的報酬 */
  reward?: number
  /** 這個中間人今天不再給這一件（交涉大失敗、放棄之後） */
  banned?: true
}
export interface TableDay {
  day: number
  offers: Record<string, TableEntry>
}

export interface FixerState {
  seq: number
  jobs: Job[]
  table: Record<string, TableDay>
  pending: PendingEnd[]
}

export const DEGREES: readonly Degree[] = ['critical', 'success', 'fail', 'fumble']
const isJob = (v: unknown): v is Job => isRecord(v) && isText(v.id) && isText(v.fixer) && Array.isArray(v.unknowns) && Array.isArray(v.revealed) && isRecord(v.terms) && isRecord(v.commission)

const isPending = (v: unknown): v is PendingEnd => isRecord(v) && isText(v.job) && (v.outcome === 'done' || v.outcome === 'failed' || v.outcome === 'retreat')

/** 舊的存檔、M2-fixer 時存下的手上委託沒有這幾個欄位：補上預設值。 */
function normJob(j: Job): Job {
  return {
    ...j,
    aux: isRecord(j.aux) ? (j.aux as Aux) : {},
    bond_failed: Array.isArray(j.bond_failed) ? j.bond_failed.filter(isText) : [],
    borrow_n: isSafeInt(j.borrow_n) && j.borrow_n >= 0 ? j.borrow_n : 0,
    payout: isRecord(j.payout) ? (j.payout as unknown as PayoutRecord) : null,
  }
}

/** 讀 state.ext.fixer：沒有、或壞掉的部分當成空的（回傳的是複製品，改它不會動到狀態）。 */
export function readFixer(state: Pick<GameState, 'ext'>): FixerState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const table: Record<string, TableDay> = {}
  if (isRecord(r.table)) {
    for (const [id, d] of Object.entries(r.table)) if (isRecord(d) && isSafeInt(d.day) && isRecord(d.offers)) table[id] = clone(d) as unknown as TableDay
  }
  return {
    seq: isSafeInt(r.seq) && r.seq >= 0 ? r.seq : 0, jobs: Array.isArray(r.jobs) ? r.jobs.filter(isJob).map((j) => normJob(clone(j))) : [], table,
    pending: Array.isArray(r.pending) ? r.pending.filter(isPending).map((x) => clone(x)) : [],
  }
}

export const jobsOf = (state: Pick<GameState, 'ext'>): Job[] => readFixer(state).jobs
export const jobOf = (state: Pick<GameState, 'ext'>, id: string): Job | null => jobsOf(state).find((j) => j.id === id) ?? null
/** 用委託的 id 或它的副本的 id 找手上的一件（敵人的功能問話之後揭開未知，帶的是副本的 id）；先比委託的 id，再找進行中的。 */
export function jobByRef(state: Pick<GameState, 'ext'>, ref: string): Job | null {
  const all = jobsOf(state)
  return all.find((j) => j.id === ref) ?? all.find((j) => j.status === 'active' && j.commission.id === ref) ?? null
}
/** 手上進行中的委託，最近接的排最前面。 */
export const activeJobs = (state: Pick<GameState, 'ext'>): Job[] => jobsOf(state).filter((j) => j.status === 'active').sort((a, b) => b.seq - a.seq)
export const latestJob = (state: Pick<GameState, 'ext'>): Job | null => activeJobs(state)[0] ?? null

/** 這件委託請了的人，一人一列（帶是哪一面）。 */
export function auxList(job: Pick<Job, 'aux'>): Array<AuxEntry & { face: AuxFace }> {
  return AUX_FACES.flatMap((face) => (job.aux[face] ?? []).map((e) => ({ ...e, face })))
}

/** 這個中間人今天的桌面（日子不對就是空的）。 */
export function tableOf(state: Pick<GameState, 'ext' | 'time'>, fixer: string): Record<string, TableEntry> {
  const d = readFixer(state).table[fixer]
  return d && d.day === state.time.day ? d.offers : {}
}

// ---- 小工具 ----

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }
/** 等級（1～5）：寫數字或羅馬數字都收；壞掉的當 1。 */
export function gradeOf(c: Pick<CommissionDef, 'grade'>): number {
  const g = c.grade
  if (typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 5) return g
  if (typeof g === 'string' && own(ROMAN, g)) return ROMAN[g]!
  return 1
}

export const stageCount = (c: Pick<CommissionDef, 'stages'>): number => c.stages.length
/** 大型委託換中人情，其餘換小人情（FIXER 第 2 節①）。 */
export const favorSizeOf = (c: Pick<CommissionDef, 'scale'>): 'small' | 'mid' => (c.scale === 'large' ? 'mid' : 'small')

/** 踩點的 DC：10 ＋ 等級 × 2；第 4 次起每次 +1（FIXER 第 2 節「踩點的規則」）。n 是這一次是第幾次（1 起算）。 */
export function scoutDc(rules: FixerRules, grade: number, n: number): number {
  return rules.scout_dc_base + grade * rules.scout_dc_per_grade + (n >= rules.scout_hard_from ? rules.scout_hard_plus : 0)
}

/** 街頭信譽現在是第幾階、叫什麼。 */
export const repTierName = (rep: number): string => REP_TIER_NAME[REP_TIERS[repTierOf(rep)]!]

/** 信譽不夠時的原因（一句）；夠了是 null。 */
export function repBlock(rep: number, min: number | undefined, what: string): string | null {
  if (min === undefined || min <= 0 || rep >= min) return null
  return `街頭信譽要到 ${min} 才${what}（你現在 ${rep}，${repTierName(rep)}）。`
}

/** 勢力的短名，查不到用 id。 */
export function factionName(k: Pick<Kernel, 'content'>, id: string): string {
  const f = k.content.get('faction', id)
  return f ? String(f.short ?? f.name ?? id) : id
}

// ---- 擲骰 ----

export const SKILL_ATTR: Record<string, string> = {
  stealth: 'reflex', investigate: 'intellect', streetwise: 'intellect', negotiate: 'charm', interface: 'intellect', seduce: 'charm', perform: 'charm',
}

export interface Rolled {
  roll: CheckRoll
  skill: string
}

/** 一項基本功擲骰用哪一項屬性：內容寫了用內容的，沒寫用預設的對照，都沒有是魅力。 */
export const attrOfSkill = (k: Pick<Kernel, 'content'>, skill: string): AttrId => ((k.content.get('skill', skill)?.attr as string | undefined) ?? SKILL_ATTR[skill] ?? 'charm') as AttrId

/** 擲一次檢定（主角）：幾種基本功都行時取合計最高的。骰面從存檔的亂數導出，報告裡的 rng 變更讓下一次換一顆。 */
export function rollBest(k: Kernel, state: GameState, skills: string[], dc: number, purpose: string, tags: string[]): Rolled {
  const actor: ActorId | null = state.pc
  if (!actor || !state.actors[actor]) throw new ActionBlocked('還沒有主角。')
  let best: Rolled | undefined
  for (const skill of skills) {
    const attr = attrOfSkill(k, skill)
    const roll = rollCheck(k.stats, state, { actor, attr, skill, dc, purpose, tags })
    if (!best || roll.total > best.roll.total) best = { roll, skill }
  }
  return best!
}

// ---- 踩點的手段 ----

export interface ScoutMethod {
  id: string
  name: string
  /** 擲哪幾項基本功（取最高的） */
  skills: string[]
  /** 能揭開哪幾類 */
  cats: Cat[]
  /** 自然 1 驚動的是現實的警戒，還是內海的追蹤度 */
  layer: 'meat' | 'net'
}

/** 五種踩點的手段（FIXER 第 2 節「手段與它能揭開什麼」）。進人偶館當班、派名冊的人去踩點（M5）、買情報（不擲）不在這裡。 */
export const SCOUT_METHODS: readonly ScoutMethod[] = [
  { id: 'survey', name: '實地勘查', skills: ['stealth', 'investigate'], cats: ['path', 'guard', 'stage'], layer: 'meat' },
  { id: 'ask', name: '打聽', skills: ['streetwise', 'negotiate'], cats: ['target', 'employer', 'modifier'], layer: 'meat' },
  { id: 'hack', name: '淺層駭入', skills: ['interface'], cats: ['lace', 'stage', 'guard'], layer: 'net' },
  { id: 'bribe', name: '收買或色誘內線', skills: ['negotiate', 'seduce'], cats: ['path', 'guard'], layer: 'meat' },
  { id: 'press', name: '以採訪為名', skills: ['perform'], cats: ['target', 'modifier'], layer: 'meat' },
]

/** 灰掉的手段與原因（不做的：進人偶館當班要名媛的招牌能力；派人去踩點是 M5 的派工）。 */
export const LOCKED_METHODS: ReadonlyArray<{ id: string; name: string; block: string }> = [
  { id: 'dollhouse', name: '進人偶館當班', block: '還沒有開放。' },
  { id: 'dispatch', name: '派名冊的人去踩點', block: '還沒有開放。' },
]

export const methodOf = (id: string): ScoutMethod | undefined => SCOUT_METHODS.find((m) => m.id === id)

// ---- 未知清單 ----

/** 這一件委託現在還沒揭開的未知，照清單的順序；cats 限定哪幾類。 */
export function hiddenUnknowns(job: Pick<Job, 'unknowns' | 'revealed'>, cats?: readonly Cat[]): UnknownItem[] {
  return job.unknowns.filter((u) => !job.revealed.includes(u.id) && (!cats || cats.includes(u.cat)))
}

/** 這個手段現在揭得開的未知（照清單的順序）。 */
export const methodTargets = (job: Pick<Job, 'unknowns' | 'revealed'>, m: ScoutMethod): UnknownItem[] => hiddenUnknowns(job, m.cats)

/** 哪些手段揭得開某一類（給畫面在沒揭開的格子下面寫）。 */
export const methodsFor = (cat: Cat): ScoutMethod[] => SCOUT_METHODS.filter((m) => m.cats.includes(cat))

// ---- 整理給副本的東西 ----

export interface Scouted {
  /** 看得到可選的面的階段 */
  stages: number[]
  /** 踩點開出來的路（分支的 id 或 need.scouted 的鍵） */
  branches: string[]
  /** 知道敵方配置的階段 */
  guards: number[]
  /** 事先知道的詞條、旗標 */
  modifiers: string[]
  flags: string[]
}

/** 把揭開的東西整理成副本要的 scouted 與警戒（追蹤度）的起始值。 */
export function scoutedOf(job: Pick<Job, 'unknowns' | 'revealed' | 'alert_start' | 'trace_start'>): { scouted: Scouted; alert_start: number; trace_start: number } {
  const s: Scouted = { stages: [], branches: [], guards: [], modifiers: [], flags: [] }
  const add = <T,>(list: T[], v: T) => { if (!list.includes(v)) list.push(v) }
  for (const u of job.unknowns) {
    if (!job.revealed.includes(u.id)) continue
    const r = u.reveal as Record<string, unknown>
    if (isSafeInt(r.stage)) add(s.stages, r.stage)
    else if (isText(r.branch)) add(s.branches, r.branch)
    else if (isSafeInt(r.guards)) add(s.guards, r.guards)
    else if (isText(r.modifier)) add(s.modifiers, r.modifier)
    else if (isText(r.flag)) add(s.flags, r.flag)
  }
  s.stages.sort((a, b) => a - b)
  s.guards.sort((a, b) => a - b)
  return { scouted: s, alert_start: job.alert_start, trace_start: job.trace_start }
}
