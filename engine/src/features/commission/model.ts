// L6 功能 commission 的資料與純函式：副本的格式與檢查、規則（數字）、狀態的形狀、連動的效果。不碰登錄表（登記在 index.ts）。
// 規格：COMMISSIONS 2.3、第 3～5 節、6.2 節、第 11 節；SITES 12.5 節（DC 基準）；dev/adr/0016 第一、二、五、六節與 G2、G9、G12；dev/work/M2-commission-run.md。
//
// 這個功能不 import 別的功能：警戒只經由量表 alert（meterOf）、敵人只經由單位來源 enemy_pick 的 UnitRef、探索只經由地圖實例的 ext。
// 內海面（M3-commission-net）：整趟的追蹤度是 Run.trace（副本帶著；每個內海階段開始時交給 face.net，做完收回來）。

import type { CheckRoll, ContentEntry, GameState, GameTime, Kernel, Origin } from '../../core'
import { UNIT_RANKS, clone, isRecord, isSafeInt } from '../../core'

export const OWNER = 'commission'
/** state.ext 的鍵 */
export const EXT = 'commission'
/** 內容種類：一件具體的副本 */
export const KIND = 'commission'
/** 內容種類：規則的數字（id: default 蓋掉內建的預設） */
export const RULE_KIND = 'commission_rule'
/** 活動的種類 */
export const ACTIVITY = 'commission'
/** state.ext 的鍵：失敗的記號（委託失敗回到入口之後留著的那一點；見 close.ts） */
export const FAILED_EXT = 'commission_failed'

export const FACES = ['meat', 'net', 'opinion'] as const
export type Face = (typeof FACES)[number]
export const FACE_NAME: Record<Face, string> = { meat: '現實', net: '內海', opinion: '輿論' }
/** 別的面的玩法：有人登記這種活動才選得了（M3、M5） */
export const FACE_ACTIVITY: Record<Exclude<Face, 'meat'>, string> = { net: 'face.net', opinion: 'face.opinion' }

/** 規模 → 階段數（COMMISSIONS 2.3 節） */
export const SCALE_STAGES: Record<string, number> = { small: 3, medium: 4, large: 5 }
export const BRANCH_KINDS = ['assault', 'stealth', 'talk', 'linked', 'scouted'] as const
export type BranchKind = (typeof BRANCH_KINDS)[number]
export const LINK_TYPES = ['skip', 'ease', 'open'] as const
export const GOAL_KINDS = ['fight', 'reach', 'take', 'check', 'scene'] as const
/** 內海面的資料（M3-commission-net）：層、蕾絲的顏色、目標的種類 */
export const NET_LAYERS = ['guest', 'staff', 'control', 'core'] as const
export const NET_LACES = ['white', 'pink', 'black'] as const
export const NET_OBJECTIVES = ['download', 'seize', 'find', 'defeat', 'plant', 'extract'] as const
/** 給內海階段的連動效果的旗標（真假） */
const NET_FLAGS = ['trace_half', 'lace_down', 'gate_open', 'near_core'] as const
export type GoalKind = (typeof GOAL_KINDS)[number]
export type Rank = (typeof UNIT_RANKS)[number]

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }

// ---- 資料的格式 ----

export type Need = { basic: string; level: number } | { link: string } | { scouted: string } | { cash: number }

export interface BranchDef {
  id: string
  kind: BranchKind
  name?: string
  /** 入口的標記（現實面）：從哪裡進這一段 */
  entry?: string
  need?: Need
}

export type GoalDef =
  | { kind: 'fight' }
  | { kind: 'reach' | 'take'; at: string }
  | { kind: 'check'; at: string; basic: string }
  | { kind: 'scene'; with: string; goal: string; nature?: string }

export interface FaceDef {
  /** 現實面：地圖（內容種類 special_map）與其中的哪一張圖 */
  map?: string
  sheet?: string
  branches: BranchDef[]
  /** 遭遇：位階的組合 */
  encounter?: Rank[]
  /** 遭遇放在哪個保全崗（G 標記的 id）；沒寫是版面上第一個 G */
  post?: string
  goal?: GoalDef
  /** 做完給哪個連動（links 的鍵） */
  gives?: string
  // ---- 內海面（face.net；資料原樣交給那一段，見 dev/adr/0018 第九節） ----
  /** 內海：這一段打哪一層（guest、staff、control、core） */
  layer?: string
  /** 內海：蕾絲的顏色 */
  lace?: string
  facility?: string
  /** 內海：這一段的目標；沒寫是通過這一層的閘門 */
  objective?: { kind: string; turns?: number }
  /** 內海：這一層的控制節點對到現實的哪幾個控制區（接管了才算數） */
  controls?: string[]
  /** 隔離區：沒拿到這個連動時這一面列著但選不了 */
  locked_by?: string
  [extra: string]: unknown
}

export interface StageDef {
  name?: string
  faces: Partial<Record<Face, FaceDef>>
}

export interface LinkEffect {
  /** 對哪個階段生效（1 起算）；沒寫是拿到它的下一個階段 */
  stage?: number
  /** 遭遇少一半（無條件進位留下） */
  encounter_half?: boolean
  /** 遭遇少幾個（至少留一個） */
  foes_minus?: number
  /** 不必探索：直接站到遭遇點 */
  skip_explore?: boolean
  /** 這一段警戒不漲：做完時警戒回到這一段開始的樣子 */
  alert_frozen?: boolean
  /** 這一段開始時警戒加減多少（負的是降低） */
  alert_start?: number
  // ---- 給內海階段的（M3-commission-net；副本算好放進 face.net 的 setup.fx） ----
  /** 追蹤度的起始值加減（−100～100） */
  trace_start?: number
  /** 這一段追蹤度的上升減半 */
  trace_half?: boolean
  /** 蕾絲降一級 */
  lace_down?: boolean
  /** 閘門不用破解 */
  gate_open?: boolean
  /** 從目標附近進來 */
  near_core?: boolean
  // ---- 給現實階段的 ----
  /** 開這一段地圖時，把這幾個控制區（"<圖的 id>:<區塊>"），或這張地圖全部的控制區（true）寫進 ext.controlled */
  controls?: true | string[]
}

export interface LinkDef {
  type: (typeof LINK_TYPES)[number]
  name: string
  effect?: LinkEffect
}

export interface CommissionEntry extends ContentEntry {
  name?: string
  kind: string
  main: Face
  scale: string
  grade: number | string
  target_faction: string
  district: string
  /** 委託人的勢力（俘虜「交出去」的好感要它） */
  employer?: string
  client?: string
  conditions?: string[]
  defeat_event?: string
  stages: StageDef[]
  links: Record<string, LinkDef>
  /** 詞條（EVENTS 4.4 節的篩選用） */
  modifiers?: string[]
}

// ---- 規則 ----

export interface CommissionRules {
  /** 每個階段在城裡算幾分鐘（COMMISSIONS 6.2 節、G2：120） */
  stage_minutes: number
  /** 潛行或交涉沒過，警戒加多少（COMMISSIONS 2.3 節的流程：+10） */
  stealth_fail_alert: number
  /** 動手的檢定沒過，警戒加多少（設計書沒寫；比照撬鎖失敗 +5） */
  check_fail_alert: number
  /** DC 基準 = dc_base ＋ 等級 × dc_per_grade（SITES 12.5 節：10、2） */
  dc_base: number
  dc_per_grade: number
  /** 增援幾個雜兵（工單：2） */
  reinforce_count: number
  /** 警戒到這麼多，最後一個階段的遭遇升 hard_grade_up 級（G9：100、1；最高 V） */
  hard_alert: number
  hard_grade_up: number
  /** 警戒漲到這麼多，導演多擲一次副本內事件（EVENTS 3.1 節：壓力條跨過 60）；一個階段只算一次 */
  pressure_at: number
  /** 輔助面的結算（COMMISSIONS 6.4 節）：失敗的壓力加多少（輿論面沒有壓力條，不加；6.4 節：+10） */
  aux_pressure: number
  /** 出事之後那一面撤幾個階段（6.4 節「撤一個階段」：1） */
  aux_rest: number
  /** 出事的人受傷幾天（工單：3） */
  aux_injured_days: number
  /** 每一面看哪幾項基本功（工單：現實槍械、格鬥、隱匿、運動；內海介面；輿論表演、交涉） */
  aux_skills: Record<'meat' | 'net' | 'opinion', string[]>
  /** 分量修正（6.4 節：強 +4、中 +2、弱 0；路數在那個戰場沒有效果（none）當弱） */
  aux_bonus: { strong: number; mid: number; weak: number; none: number }
  /** 歷練點（COMMISSIONS 2.3 節的表、CORE_RULES 7.1 節）：小 20、中 35、大 60；不看評價，另乘存檔規則的歷練倍率 */
  xp_small: number
  xp_medium: number
  xp_large: number
  /** 路線的後果（COMMISSIONS 第 8 節、FACTIONS 6.2 節：+5～15）：有階段走了現實，目標勢力的敵對值 +5，每個強攻的階段再 +3，最多 +15 */
  hostility_base: number
  hostility_per_assault: number
  hostility_max: number
  /** 評價（G16）：從 B 起算；拿到幾個連動以上 +1、警戒最後在幾以上 −1、到過幾 −1；每個潛行或交涉成功的階段 +1 */
  rating_links: number
  rating_alert: number
  rating_peak: number
}

/**
 * 內海的數字（M3-commission-net）。和 CommissionRules 分開放：資料 commission_rule/default 寫了才蓋掉，沒寫照這裡的預設
 * （資料檔補上這幾個欄位是 M3-data-rules 的事；補上之前資料與 DEFAULT_COMMISSION_RULES 一一對得上）。
 */
export interface NetRules {
  /** 整趟的追蹤度到 net_alert_at（N14：60），委託的警戒 +net_alert（10），只加一次 */
  net_alert: number
  net_alert_at: number
  /** 路線的後果（N34）：做完時每 net_hostility_step（20）點追蹤度目標勢力的敵對值 +1（進位），最多 net_hostility_max（5）；被定位另外 +net_located_hostility（5） */
  net_hostility_step: number
  net_hostility_max: number
  net_located_hostility: number
  /** 管網路的勢力（勢力的資料匯入前是空的）：走了內海的路線各 +net_watcher_hostility（2） */
  net_watchers: string[]
  net_watcher_hostility: number
  /** 評價：內海的追蹤度到過這麼多再 −1（和現實的警戒到過 rating_peak 同一項；最後在 rating_alert 以上的那一項兩邊共用） */
  rating_trace_peak: number
}

export const DEFAULT_NET_RULES: NetRules = {
  net_alert: 10, net_alert_at: 60, net_hostility_step: 20, net_hostility_max: 5, net_located_hostility: 5, net_watchers: [], net_watcher_hostility: 2, rating_trace_peak: 90,
}
type NetNumeric = Exclude<keyof NetRules, 'net_watchers'>
const NET_RULE_FIELDS: Array<[NetNumeric, number, number]> = [
  ['net_alert', 0, 100], ['net_alert_at', 1, 100], ['net_hostility_step', 1, 100], ['net_hostility_max', 0, 100], ['net_located_hostility', 0, 100], ['net_watcher_hostility', 0, 100], ['rating_trace_peak', 1, 100],
]

export const DEFAULT_COMMISSION_RULES: CommissionRules = {
  stage_minutes: 120, stealth_fail_alert: 10, check_fail_alert: 5, dc_base: 10, dc_per_grade: 2, reinforce_count: 2, hard_alert: 100, hard_grade_up: 1, pressure_at: 60,
  aux_pressure: 10, aux_rest: 1, aux_injured_days: 3,
  xp_small: 20, xp_medium: 35, xp_large: 60, hostility_base: 5, hostility_per_assault: 3, hostility_max: 15, rating_links: 3, rating_alert: 60, rating_peak: 100,
  aux_skills: { meat: ['firearms', 'brawl', 'stealth', 'athletics'], net: ['interface'], opinion: ['perform', 'negotiate'] },
  aux_bonus: { strong: 4, mid: 2, weak: 0, none: 0 },
}

type NumericRule = 'stage_minutes' | 'stealth_fail_alert' | 'check_fail_alert' | 'dc_base' | 'dc_per_grade' | 'reinforce_count' | 'hard_alert' | 'hard_grade_up' | 'pressure_at' | 'aux_pressure' | 'aux_rest' | 'aux_injured_days'
  | 'xp_small' | 'xp_medium' | 'xp_large' | 'hostility_base' | 'hostility_per_assault' | 'hostility_max' | 'rating_links' | 'rating_alert' | 'rating_peak'
const RULE_FIELDS: Array<[NumericRule, number, number]> = [
  ['stage_minutes', 0, 100000], ['stealth_fail_alert', 0, 100], ['check_fail_alert', 0, 100], ['dc_base', 0, 40], ['dc_per_grade', 0, 10],
  ['reinforce_count', 0, 8], ['hard_alert', 1, 100], ['hard_grade_up', 0, 4], ['pressure_at', 1, 100], ['aux_pressure', 0, 100], ['aux_rest', 0, 3], ['aux_injured_days', 0, 30],
  ['xp_small', 0, 1000], ['xp_medium', 0, 1000], ['xp_large', 0, 1000], ['hostility_base', 0, 100], ['hostility_per_assault', 0, 100], ['hostility_max', 0, 100],
  ['rating_links', 1, 20], ['rating_alert', 1, 100], ['rating_peak', 1, 100],
]
const AUX_FACES = ['meat', 'net', 'opinion'] as const
const AUX_BONUS_KEYS = ['strong', 'mid', 'weak', 'none'] as const

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of [...RULE_FIELDS, ...NET_RULE_FIELDS]) if (e[key] !== undefined && !(isSafeInt(e[key]) && e[key] >= lo && e[key] <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  if (e.aux_skills !== undefined) {
    const sk = e.aux_skills
    if (!isRecord(sk) || Object.keys(sk).some((f) => !(AUX_FACES as readonly string[]).includes(f)) || Object.values(sk).some((v) => !isTextList(v) || v.length === 0)) p.push('aux_skills 要是 { meat?, net?, opinion? }，每一面是至少一個基本功 id 的陣列')
  }
  if (e.aux_bonus !== undefined) {
    const b = e.aux_bonus
    if (!isRecord(b) || Object.keys(b).some((x) => !(AUX_BONUS_KEYS as readonly string[]).includes(x)) || Object.values(b).some((v) => !(isSafeInt(v) && v >= 0 && v <= 20))) p.push('aux_bonus 要是 { strong?, mid?, weak?, none? }，每一項是 0～20 的整數')
  }
  if (e.net_watchers !== undefined && !isTextList(e.net_watchers)) p.push('net_watchers 要是勢力 id 的陣列')
  return p
}

/** 現在生效的規則：資料 commission_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function commissionRules(k: Pick<Kernel, 'content'>): CommissionRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: CommissionRules = { ...DEFAULT_COMMISSION_RULES }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(' ')[0]))
  for (const [key] of RULE_FIELDS) {
    if (e[key] === undefined || bad.has(key)) continue
    out[key] = e[key] as number
  }
  // 輔助面的兩張表：寫了的項目蓋掉預設，沒寫的照預設（格式不對整張忽略）
  out.aux_skills = clone(DEFAULT_COMMISSION_RULES.aux_skills)
  out.aux_bonus = { ...DEFAULT_COMMISSION_RULES.aux_bonus }
  if (e.aux_skills !== undefined && !bad.has('aux_skills')) for (const [f, v] of Object.entries(e.aux_skills as Record<string, string[]>)) out.aux_skills[f as 'meat'] = [...v]
  if (e.aux_bonus !== undefined && !bad.has('aux_bonus')) Object.assign(out.aux_bonus, e.aux_bonus)
  return out
}

/** 內海的數字：資料 commission_rule/default 寫了的蓋掉預設（格式不對的欄位忽略）。 */
export function netRules(k: Pick<Kernel, 'content'>): NetRules {
  const e = k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default')
  const out: NetRules = { ...DEFAULT_NET_RULES, net_watchers: [] }
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(' ')[0]))
  for (const [key] of NET_RULE_FIELDS) if (e[key] !== undefined && !bad.has(key)) out[key] = e[key] as number
  if (e.net_watchers !== undefined && !bad.has('net_watchers')) out.net_watchers = [...new Set(e.net_watchers as string[])]
  return out
}

// ---- 小工具 ----

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)
const isRank = (v: unknown): v is Rank => (UNIT_RANKS as readonly unknown[]).includes(v)
const own = (o: object, key: string): boolean => Object.hasOwn(o, key)

/** 等級（1～5）：寫數字或羅馬數字都收；壞掉的是 undefined。 */
export function gradeOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5) return v
  if (typeof v === 'string' && own(ROMAN, v)) return ROMAN[v]
  return undefined
}

/** DC 基準：10 ＋ 等級 × 2（SITES 12.5 節）。 */
export const dcBaseOf = (rules: CommissionRules, grade: number): number => rules.dc_base + grade * rules.dc_per_grade

/** 這個階段的名字：寫了用寫的，沒寫是「第 N 階段」。 */
export const stageName = (def: CommissionEntry, n: number): string => def.stages[n - 1]?.name ?? `第 ${n} 階段`

export const branchName = (b: BranchDef): string => b.name ?? b.id

// ---- 檢查 ----

function needProblems(n: unknown, at: string): string[] {
  if (!isRecord(n)) return [`${at} 要是 { basic, level }、{ link }、{ scouted } 或 { cash }`]
  const keys = Object.keys(n)
  if (keys.length === 0) return [`${at} 要寫 basic（加 level）、link、scouted 或 cash 其中一種`]
  const p: string[] = []
  if (own(n, 'basic')) {
    if (!isText(n.basic)) p.push(`${at}.basic 要是基本功的 id`)
    if (!(isSafeInt(n.level) && n.level >= 1 && n.level <= 6)) p.push(`${at}.level 要是 1～6 的整數`)
    if (keys.some((x) => x !== 'basic' && x !== 'level')) p.push(`${at}：basic 只能跟 level 一起寫`)
  } else if (keys.length !== 1) p.push(`${at} 一次只能寫一種條件（basic、link、scouted、cash）`)
  else if (own(n, 'link')) { if (!isText(n.link)) p.push(`${at}.link 要是連動的 id`) }
  else if (own(n, 'scouted')) { if (!isText(n.scouted)) p.push(`${at}.scouted 要是踩點揭開的鍵`) }
  else if (own(n, 'cash')) { if (!(isSafeInt(n.cash) && n.cash >= 0)) p.push(`${at}.cash 要是 0 以上的整數`) }
  else p.push(`${at} 只能寫 basic（加 level）、link、scouted 或 cash`)
  return p
}

function goalProblems(g: unknown, at: string, face: FaceDef): string[] {
  if (!isRecord(g)) return [`${at} 要是 { kind, ... }`]
  const p: string[] = []
  if (!(GOAL_KINDS as readonly unknown[]).includes(g.kind)) return [`${at}.kind 只能是 ${GOAL_KINDS.join('、')}`]
  if (g.kind === 'fight' && !(Array.isArray(face.encounter) && face.encounter.length > 0)) p.push(`${at}：打倒目標的段落要有遭遇（encounter 至少一個位階）`)
  if (g.kind === 'reach' || g.kind === 'take' || g.kind === 'check') if (!isText(g.at)) p.push(`${at}.at 要是版面上標記的 id`)
  if (g.kind === 'check' && !isText(g.basic)) p.push(`${at}.basic 要是基本功的 id`)
  if (g.kind === 'scene') {
    if (!isText(g.with)) p.push(`${at}.with 要是角色的 id`)
    if (!isText(g.goal)) p.push(`${at}.goal 要是場景的目的（info、please、obey、stall、footage）`)
    if (g.nature !== undefined && !isText(g.nature)) p.push(`${at}.nature 要是場景的性質`)
  }
  return p
}

function faceProblems(f: unknown, at: string, face: Face, links: Record<string, unknown>): string[] {
  if (!isRecord(f)) return [`${at} 要是物件`]
  const p: string[] = []
  const meat = face === 'meat'
  if (meat) {
    if (!isText(f.map)) p.push(`${at}.map 要是地圖的 id（現實面一定要有）`)
    if (f.sheet !== undefined && !isText(f.sheet)) p.push(`${at}.sheet 要是圖的 id`)
    if (f.post !== undefined && !isText(f.post)) p.push(`${at}.post 要是保全崗（G 標記）的 id`)
  }
  if (f.encounter !== undefined && !(Array.isArray(f.encounter) && f.encounter.every(isRank))) p.push(`${at}.encounter 要是位階的陣列（${UNIT_RANKS.join('、')}）`)
  if (meat && f.encounter === undefined) p.push(`${at}.encounter 要寫（位階的陣列；沒有守備就寫空陣列）`)
  if (f.gives !== undefined) {
    if (!isText(f.gives)) p.push(`${at}.gives 要是連動的 id`)
    else if (!own(links, f.gives)) p.push(`${at}.gives 寫了 ${f.gives}，links 裡沒有這個連動`)
  }
  if (!Array.isArray(f.branches) || f.branches.length === 0) p.push(`${at}.branches 要有至少一條路`)
  else {
    const seen = new Set<string>()
    f.branches.forEach((b: unknown, i: number) => {
      const bt = `${at}.branches[${i}]`
      if (!isRecord(b)) return void p.push(`${bt} 要是物件`)
      if (!isText(b.id)) p.push(`${bt}.id 要是這條路的 id`)
      else if (seen.has(b.id)) p.push(`${bt}.id：${b.id} 重複`)
      else seen.add(b.id)
      if (!(BRANCH_KINDS as readonly unknown[]).includes(b.kind)) p.push(`${bt}.kind 只能是 ${BRANCH_KINDS.join('、')}`)
      if (b.name !== undefined && !isText(b.name)) p.push(`${bt}.name 要是文字`)
      if (meat && !isText(b.entry)) p.push(`${bt}.entry 要是入口的標記 id（現實面一定要有）`)
      if (b.need !== undefined) {
        p.push(...needProblems(b.need, `${bt}.need`))
        if (isRecord(b.need) && isText(b.need.link) && !own(links, b.need.link)) p.push(`${bt}.need.link 寫了 ${b.need.link}，links 裡沒有這個連動`)
      }
      if (b.kind === 'linked' && !(isRecord(b.need) && isText(b.need.link))) p.push(`${bt}：連動開出來的路（linked）要寫 need.link`)
      if (b.kind === 'scouted' && !(isRecord(b.need) && isText(b.need.scouted))) p.push(`${bt}：踩點開出來的路（scouted）要寫 need.scouted`)
    })
    if (!f.branches.some((b: unknown) => isRecord(b) && b.kind === 'assault')) p.push(`${at}：每一面至少要有一條強攻（assault），這樣永遠走得下去`)
  }
  if (f.goal !== undefined) p.push(...goalProblems(f.goal, `${at}.goal`, f as FaceDef))
  if (face === 'net') p.push(...netFaceProblems(f, at, links))
  return p
}

/** 內海面的資料（layer 必填；其餘照 dev/adr/0018 第九節）。 */
function netFaceProblems(f: Record<string, unknown>, at: string, links: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!(NET_LAYERS as readonly unknown[]).includes(f.layer)) p.push(`${at}.layer 只能是 ${NET_LAYERS.join('、')}（內海面一定要寫）`)
  if (f.lace !== undefined && !(NET_LACES as readonly unknown[]).includes(f.lace)) p.push(`${at}.lace 只能是 ${NET_LACES.join('、')}`)
  if (f.facility !== undefined && !isText(f.facility)) p.push(`${at}.facility 要是文字`)
  if (f.objective !== undefined) {
    const o = f.objective
    if (!isRecord(o) || !(NET_OBJECTIVES as readonly unknown[]).includes(o.kind)) p.push(`${at}.objective 要是 { kind, turns? }，kind 是 ${NET_OBJECTIVES.join('、')}`)
    else {
      if (o.turns !== undefined && !(isSafeInt(o.turns) && o.turns >= 1 && o.turns <= 10)) p.push(`${at}.objective.turns 要是 1～10 的整數`)
      if (Object.keys(o).some((x) => x !== 'kind' && x !== 'turns')) p.push(`${at}.objective 只能寫 kind 與 turns`)
    }
  }
  if (f.controls !== undefined && !(isTextList(f.controls) && f.controls.length > 0)) p.push(`${at}.controls 要是控制區（"<圖的 id>:<區塊>"）的陣列，至少一個`)
  if (f.locked_by !== undefined) {
    if (!isText(f.locked_by)) p.push(`${at}.locked_by 要是連動的 id`)
    else if (!own(links, f.locked_by)) p.push(`${at}.locked_by 寫了 ${f.locked_by}，links 裡沒有這個連動`)
  }
  return p
}

/** 一件副本的格式問題（不查地圖與勢力在不在，那是引用檢查與 ready 的事）。一條一句。 */
export function commissionProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.name !== undefined && !isText(e.name)) p.push('name 要是文字')
  if (!isText(e.kind)) p.push('kind 要是類型的 id（暗殺、竊密……）')
  if (!(FACES as readonly unknown[]).includes(e.main)) p.push(`main 只能是 ${FACES.join('、')}`)
  const stagesWanted = typeof e.scale === 'string' && own(SCALE_STAGES, e.scale) ? SCALE_STAGES[e.scale] : undefined
  if (stagesWanted === undefined) p.push(`scale 只能是 ${Object.keys(SCALE_STAGES).join('、')}`)
  if (gradeOf(e.grade) === undefined) p.push('grade 要是 1～5 的整數，或 I～V')
  if (!isText(e.target_faction)) p.push('target_faction 要是勢力的 id')
  if (!isText(e.district)) p.push('district 要是區的 id')
  for (const key of ['employer', 'client', 'defeat_event'] as const) if (e[key] !== undefined && !isText(e[key])) p.push(`${key} 要是 id（字串）`)
  for (const key of ['conditions', 'modifiers'] as const) if (e[key] !== undefined && !isTextList(e[key])) p.push(`${key} 要是字串的陣列`)

  const links = isRecord(e.links) ? e.links : {}
  if (!isRecord(e.links)) p.push('links 要是 { 連動的 id: { type, name, effect? } }（沒有連動就寫空物件）')
  else {
    for (const [id, l] of Object.entries(e.links)) {
      const at = `links.${id}`
      if (!isRecord(l)) { p.push(`${at} 要是 { type, name, effect? }`); continue }
      if (!(LINK_TYPES as readonly unknown[]).includes(l.type)) p.push(`${at}.type 只能是 ${LINK_TYPES.join('、')}`)
      if (!isText(l.name)) p.push(`${at}.name 要是給玩家看的名字`)
      if (l.effect !== undefined) {
        if (!isRecord(l.effect)) { p.push(`${at}.effect 要是物件`); continue }
        const ef = l.effect
        const EFFECT_KEYS = ['stage', 'encounter_half', 'foes_minus', 'skip_explore', 'alert_frozen', 'alert_start', 'trace_start', 'controls', ...NET_FLAGS]
        for (const key of Object.keys(ef)) if (!EFFECT_KEYS.includes(key)) p.push(`${at}.effect.${key} 不是可以用的鍵（${EFFECT_KEYS.join('、')}）`)
        if (ef.stage !== undefined && !(isSafeInt(ef.stage) && ef.stage >= 1 && (stagesWanted === undefined || ef.stage <= stagesWanted))) p.push(`${at}.effect.stage 要是 1～${stagesWanted ?? '階段數'} 的整數（第幾階段）`)
        if (ef.foes_minus !== undefined && !(isSafeInt(ef.foes_minus) && ef.foes_minus >= 0)) p.push(`${at}.effect.foes_minus 要是 0 以上的整數`)
        if (ef.alert_start !== undefined && !(isSafeInt(ef.alert_start) && Math.abs(ef.alert_start) <= 100)) p.push(`${at}.effect.alert_start 要是 −100～100 的整數`)
        if (ef.trace_start !== undefined && !(isSafeInt(ef.trace_start) && Math.abs(ef.trace_start) <= 100)) p.push(`${at}.effect.trace_start 要是 −100～100 的整數`)
        if (ef.controls !== undefined && ef.controls !== true && !(isTextList(ef.controls) && ef.controls.length > 0)) p.push(`${at}.effect.controls 要是 true（這張地圖全部的控制區）或控制區（"<圖的 id>:<區塊>"）的陣列`)
        for (const key of ['encounter_half', 'skip_explore', 'alert_frozen', ...NET_FLAGS] as const) if (ef[key] !== undefined && typeof ef[key] !== 'boolean') p.push(`${at}.effect.${key} 要是 true 或 false`)
      }
    }
  }

  if (!Array.isArray(e.stages) || e.stages.length === 0) p.push('stages 要有至少一個階段')
  else {
    const stageList: unknown[] = e.stages
    if (stagesWanted !== undefined && e.stages.length !== stagesWanted) p.push(`stages 有 ${e.stages.length} 個，${String(e.scale)} 規模要 ${stagesWanted} 個（COMMISSIONS 2.3 節）`)
    e.stages.forEach((s: unknown, i: number) => {
      const at = `stages[${i}]`
      if (!isRecord(s)) return void p.push(`${at} 要是 { name?, faces }`)
      if (s.name !== undefined && !isText(s.name)) p.push(`${at}.name 要是文字`)
      if (!isRecord(s.faces) || Object.keys(s.faces).length === 0) return void p.push(`${at}.faces 要有至少一個面`)
      for (const [face, f] of Object.entries(s.faces)) {
        if (!(FACES as readonly string[]).includes(face)) p.push(`${at}.faces 的鍵只能是 ${FACES.join('、')}（拿到 ${face}）`)
        else p.push(...faceProblems(f, `${at}.faces.${face}`, face as Face, links))
      }
      // 隔離區：locked_by 的連動要有某個更早的階段會給（任何一面的 gives；沒拿到時玩家永遠進不去這一面）
      const netFace = (s.faces as Record<string, unknown>).net
      if (isRecord(netFace) && isText(netFace.locked_by) && own(links, netFace.locked_by)) {
        const lock = netFace.locked_by
        const earlier = stageList.slice(0, i).some((x) => isRecord(x) && isRecord(x.faces) && Object.values(x.faces).some((ff) => isRecord(ff) && ff.gives === lock))
        if (!earlier) p.push(`${at}.faces.net.locked_by 寫了 ${lock}，但沒有任何更早的階段會給這個連動（隔離區永遠打不開）`)
      }
      // 最後一個階段只有主面（COMMISSIONS 4 節）
      if (i === stageList.length - 1 && (FACES as readonly unknown[]).includes(e.main)) {
        if (!own(s.faces, e.main as string)) p.push(`${at}：最後一個階段要有主面（${String(e.main)}）`)
        const extra = Object.keys(s.faces).filter((f) => f !== e.main)
        if (extra.length > 0) p.push(`${at}：最後一個階段只有主面，不能列 ${extra.join('、')}`)
      }
    })
  }
  return p
}

/** 帶地圖的檢查（載入之後才查得到）：現實面的地圖、圖、入口、保全崗、目標的標記都要在版面上。 */
export function commissionMapProblems(k: Pick<Kernel, 'content'>, def: CommissionEntry): string[] {
  const p: string[] = []
  def.stages.forEach((s, i) => {
    const f = s.faces.meat
    if (!f || !isText(f.map)) return
    const at = `stages[${i}].faces.meat`
    const map = k.content.get<ContentEntry & { sheets: Array<{ id: string; cells?: Array<{ id: string; mark: string }> }> }>('special_map', f.map)
    if (!map) return void p.push(`${at}.map：地圖 ${f.map} 查不到`)
    const sheet = f.sheet === undefined ? map.sheets[0] : map.sheets.find((x) => x.id === f.sheet)
    if (!sheet) return void p.push(`${at}.sheet：地圖 ${f.map} 沒有 ${String(f.sheet)} 這一張圖`)
    const cells = sheet.cells ?? []
    const has = (id: string) => map.sheets.some((sh) => (sh.cells ?? []).some((c) => c.id === id))
    for (const b of f.branches) if (isText(b.entry) && !cells.some((c) => c.id === b.entry)) p.push(`${at}.branches 的 ${b.id}：入口 ${b.entry} 不在 ${sheet.id} 這張圖上`)
    if (isText(f.post) && !cells.some((c) => c.id === f.post && c.mark === 'G')) p.push(`${at}.post：${f.post} 不是 ${sheet.id} 這張圖上的保全崗（G）`)
    if (Array.isArray(f.encounter) && f.encounter.length > 0 && f.post === undefined && !cells.some((c) => c.mark === 'G')) p.push(`${at}：有遭遇卻沒有保全崗（G 標記）可以放`)
    const g = f.goal
    if (g && (g.kind === 'reach' || g.kind === 'take' || g.kind === 'check') && !has(g.at)) p.push(`${at}.goal.at：標記 ${g.at} 在地圖 ${f.map} 上找不到`)
  })
  return p
}

// ---- 狀態 ----

export type Step = 'face' | 'branch' | 'play' | 'done'
export const STEPS: readonly Step[] = ['face', 'branch', 'play', 'done']

export interface RunLink {
  id: string
  /** 在第幾階段拿到的 */
  from: number
  face: Face
  /** 輔助面擲出來的（COMMISSIONS 6.2 節：當場生效，沒寫 effect.stage 時對這個階段生效，而不是下一個） */
  aux?: true
}

export type AuxOutcome = 'great' | 'success' | 'fail' | 'mishap'

/** 一個輔助面一個階段的結算（commission.face 那一份報告的 aux 一拍；也記在 run.aux.log）。 */
export interface AuxResult {
  stage: number
  face: Face
  /** 那一面在場的人（角色 id） */
  people: string[]
  /** 擲骰的人：在場的人裡最高的相關基本功 */
  roller: string
  skill: string
  /** 加值的三項：基本功、分量修正、人數 − 1 */
  bonus: { skill: number; path: number; crowd: number }
  roll: CheckRoll
  outcome: AuxOutcome
  /** 拿到的連動 id（拿到的時候；已經有了或這一面沒寫 gives 時沒有） */
  link?: string
  /** 這一面的壓力加了多少 */
  pressure?: number
  /** 出事受傷的人 */
  injured?: string
  /** 出事之後，這一面撤到第幾階段為止（那之前的階段不擲） */
  rest_until?: number
}

/**
 * 輔助面的狀態：哪一面撤到第幾階段為止、每個階段的結算紀錄。
 * pressure.net 是舊欄位（M2：內海的壓力先記在這裡）：現在內海的壓力就是 run.trace（失敗的 +10 加在它上面），這裡只在輔助面失敗時照寫一份給舊的讀法；
 * 舊存檔裡有值而 run.trace 還沒有時，readRun 把它併進 run.trace。現實的壓力是 run.alert。
 */
export interface AuxState {
  pressure: Partial<Record<Face, number>>
  rest: Partial<Record<Face, number>>
  log: AuxResult[]
}

export interface RouteEntry {
  stage: number
  face: Face
  branch: string
  kind: BranchKind
  /** 潛行或交涉有擲：過了還是沒過 */
  roll?: 'pass' | 'fail'
  /** 這一段是潛行的 */
  stealth?: boolean
}

export interface RunSetup {
  scouted?: { stages?: number[]; branches?: string[]; guards?: number[] }
  aux?: unknown
  terms?: unknown
  /** 每個現實面的守備多幾個雜兵（遭遇預算 +N 點，一個雜兵 1 點；FACTIONS 6.1 節：目標勢力的敵對值到「找麻煩」）。沒有守備的階段不加 */
  encounter_plus?: number
}

export interface Run {
  def: CommissionEntry
  origin: Origin
  setup: RunSetup
  /** 現在第幾階段（1 起算）；全部做完的那一刻是階段數 + 1 */
  stage: number
  step: Step
  face?: Face
  branch?: string
  links: RunLink[]
  route: RouteEntry[]
  /** 警戒（整趟累計）：每一段開始前的值；一段做完把那張地圖的警戒收回來 */
  alert: number
  /** 警戒到過的最高值 */
  peak: number
  /** 整趟的追蹤度（M3-commission-net）：開內海那一段時交給 face.net（第一次是進副本時的 trace_start），做完收回來；輔助面在內海失敗的 +10 也加在這裡 */
  trace: number
  /** 追蹤度到過的最高值（內海的階段交回的 peak、輔助面加上去之後的值） */
  net_peak: number
  /** 這件委託第一次到過 net_alert_at（60）的那一次，警戒加過了（只加一次） */
  net_alerted?: true
  /** 不算失敗的戰敗而且是被定位：做完時目標勢力的敵對值另外 +net_located_hostility */
  net_located?: true
  /** 這一段內海面寫了 controls、face.net 交回來卻沒有接管任何控制節點：里程碑不給這一面的 gives */
  no_gives?: true
  /** 這兩個階段之間喘過氣了沒有 */
  breathed: boolean
  /** 這一段的地圖實例 */
  map?: string
  /** 這一段開始時的警戒（連動「警戒不漲」要回到它） */
  start_alert?: number
  frozen?: boolean
  /** 目標的進度 */
  won?: boolean
  checked?: boolean
  scene?: 'done' | 'failed'
  /** 別的面的玩法：做完了 */
  done?: boolean
  /** 這個階段的警戒到過 pressure_at 了（壓力條的觸發點發過了，不再發第二次） */
  pressured?: boolean
  /** 輔助面的狀態（第一次有人擲了才有） */
  aux?: AuxState
  started: GameTime
}

const asTimes = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => isSafeInt(x)) : [])

/** 讀 state.ext.commission：沒有、或壞掉的回傳 null（回傳的是複製品，改它不會動到狀態）。 */
export function readRun(state: Pick<GameState, 'ext'>): Run | null {
  const raw = state.ext[EXT]
  if (!isRecord(raw) || !isRecord(raw.def) || !Array.isArray(raw.def.stages) || !isSafeInt(raw.stage) || !(STEPS as readonly unknown[]).includes(raw.step)) return null
  const run = clone(raw) as unknown as Run
  // M2 的存檔：內海的壓力記在 aux.pressure.net；併進 run.trace（run.trace 已經有值就以它為準）
  const old = isRecord(run.aux) && isRecord(run.aux.pressure) && isSafeInt(run.aux.pressure.net) ? run.aux.pressure.net : 0
  if (!isSafeInt(run.trace)) run.trace = clamp(old, TRACE_MIN, 100)
  if (!isSafeInt(run.net_peak)) run.net_peak = Math.max(run.trace, 0)
  return run
}

/** 變更用：整份換掉 state.ext.commission 的變更。 */
export const runChange = (run: Run): { op: 'ext'; key: string; value: unknown } => ({ op: 'ext', key: EXT, value: clone(run) })

export const stagesOf = (run: Run): number => run.def.stages.length
export const isLast = (run: Run): boolean => run.stage === stagesOf(run)
export const faceOf = (run: Run, n = run.stage, face: Face | undefined = run.face): FaceDef | undefined => (face ? run.def.stages[n - 1]?.faces[face] : undefined)

/** setup.aux 的格式：{ meat?, net?, opinion?, borrowed? }，每一項是角色 id 的陣列；每一面最多 2 個人，同一個人不能同時派去兩個面。 */
export function auxProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return 'aux 要是 { meat?, net?, opinion?, borrowed? }，每一項是角色 id 的陣列。'
  const seen = new Map<string, string>()
  for (const key of [...AUX_FACES, 'borrowed'] as const) {
    const v = raw[key]
    if (v === undefined) continue
    if (!isTextList(v)) return `aux.${key} 要是角色 id 的陣列。`
    if (key === 'borrowed') continue
    if (v.length > 2) return `${FACE_NAME[key]}面最多派 2 個人（aux.${key} 有 ${v.length} 個）。`
    for (const id of v) {
      const at = seen.get(id)
      if (at !== undefined) return at === key ? `${id} 在${FACE_NAME[key]}面列了兩次。` : `${id} 不能同時派去${FACE_NAME[at as Face]}面和${FACE_NAME[key]}面。`
      seen.set(id, key)
    }
  }
  return null
}

export function normalSetup(raw: unknown): { def: unknown; setup: RunSetup; alert_start: number; trace_start: number } | string {
  if (!isRecord(raw)) return '開副本要給 { def: 委託的 id 或整筆 }。'
  if (!(isText(raw.def) || isRecord(raw.def))) return '開副本要給 def（委託的 id，或整筆副本的資料）。'
  const s = raw.scouted
  const setup: RunSetup = {}
  if (s !== undefined) {
    if (!isRecord(s)) return 'scouted 要是 { stages, branches, guards }。'
    setup.scouted = { stages: asTimes(s.stages), branches: isTextList(s.branches) ? clone(s.branches) : [], guards: asTimes(s.guards) }
  }
  if (raw.aux !== undefined) {
    const bad = auxProblem(raw.aux)
    if (bad) return bad
    setup.aux = clone(raw.aux)
  }
  if (raw.terms !== undefined) setup.terms = clone(raw.terms)
  const plus = raw.encounter_plus
  if (plus !== undefined) {
    if (!(isSafeInt(plus) && plus >= 0 && plus <= 4)) return 'encounter_plus 要是 0～4 的整數。'
    if (plus > 0) setup.encounter_plus = plus
  }
  const a = raw.alert_start
  if (a !== undefined && !(isSafeInt(a) && a >= 0 && a <= 100)) return 'alert_start 要是 0～100 的整數。'
  const t = raw.trace_start
  if (t !== undefined && !(isSafeInt(t) && t >= TRACE_MIN && t <= 100)) return `trace_start 要是 ${TRACE_MIN}～100 的整數。`
  return { def: raw.def, setup, alert_start: (a as number | undefined) ?? 0, trace_start: (t as number | undefined) ?? 0 }
}

// ---- 連動的效果 ----

export interface StageEffects {
  half: boolean
  minus: number
  skip: boolean
  frozen: boolean
  alertDelta: number
  /** 哪幾個連動在生效（給報告與畫面用） */
  from: string[]
  // ---- 給內海階段的（M3-commission-net） ----
  traceStart: number
  traceHalf: boolean
  laceDown: boolean
  gateOpen: boolean
  nearCore: boolean
  /** 給現實階段的：開地圖時寫進 ext.controlled 的控制區（true 是那張地圖全部的）；沒有是 null */
  controls: true | string[] | null
}

/** 連動對第 n 階段的效果：每一個拿到的連動，effect.stage（沒寫是拿到它的下一個階段）就是 n 的才算。 */
export function effectsFor(run: Run, n: number): StageEffects {
  const out: StageEffects = { half: false, minus: 0, skip: false, frozen: false, alertDelta: 0, from: [], traceStart: 0, traceHalf: false, laceDown: false, gateOpen: false, nearCore: false, controls: null }
  for (const l of run.links) {
    const ef = run.def.links[l.id]?.effect
    if (!ef) continue
    if ((ef.stage ?? (l.aux ? l.from : l.from + 1)) !== n) continue
    let used = false
    if (ef.encounter_half) { out.half = true; used = true }
    if (ef.foes_minus) { out.minus += ef.foes_minus; used = true }
    if (ef.skip_explore) { out.skip = true; used = true }
    if (ef.alert_frozen) { out.frozen = true; used = true }
    if (ef.alert_start) { out.alertDelta += ef.alert_start; used = true }
    if (ef.trace_start) { out.traceStart += ef.trace_start; used = true }
    if (ef.trace_half) { out.traceHalf = true; used = true }
    if (ef.lace_down) { out.laceDown = true; used = true }
    if (ef.gate_open) { out.gateOpen = true; used = true }
    if (ef.near_core) { out.nearCore = true; used = true }
    if (ef.controls === true) { out.controls = true; used = true }
    else if (Array.isArray(ef.controls) && ef.controls.length > 0) {
      if (out.controls !== true) out.controls = [...new Set([...(out.controls ?? []), ...ef.controls])]
      used = true
    }
    if (used) out.from.push(l.id)
  }
  return out
}

/** 套上連動之後的遭遇：先少一半（進位留下），再少幾個；有遭遇的至少留一個。 */
export function encounterAfter(ranks: Rank[], fx: Pick<StageEffects, 'half' | 'minus'>): Rank[] {
  if (ranks.length === 0) return []
  let n = ranks.length
  if (fx.half) n = Math.ceil(n / 2)
  n = Math.max(1, n - fx.minus)
  return ranks.slice(0, n)
}

/** 給 face.net 的 setup.fx：這個階段生效的連動效果（只寫有生效的鍵；netrun 讀不到副本的資料，所以副本算好了給）。 */
export function netFx(fx: StageEffects): Record<string, unknown> {
  return {
    ...(fx.half ? { half: true } : {}), ...(fx.minus > 0 ? { minus: fx.minus } : {}), ...(fx.skip ? { skip: true } : {}),
    ...(fx.traceStart !== 0 ? { trace_start: clamp(fx.traceStart, -100, 100) } : {}), ...(fx.traceHalf ? { trace_half: true } : {}),
    ...(fx.laceDown ? { lace_down: true } : {}), ...(fx.gateOpen ? { gate_open: true } : {}), ...(fx.nearCore ? { near_core: true } : {}),
  }
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** 追蹤度的下限（量表 trace 是 −30～100：負的起始值是後門與伊甸園的條款要的） */
export const TRACE_MIN = -30
