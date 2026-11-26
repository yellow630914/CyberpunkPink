// L6 功能 curtain 的資料：規則表（curtain_rule）、夜（curtain_night）、這一區的預設規則、狀態 state.ext.curtain 的形狀與讀寫、週與日的算法。
// 規格：CYBERSPACE 8.7 節（比較表與共通的規則）、8.8 節（怎麼進去、一趟的結構開頭到報名、檔期主題、能不能反覆去、篩選關掉時）；LEWD_SYSTEM 1.1 節；
// dev/adr/0018 第六、十三節；dev/adr/0019 第十二節與 P56、P57；dev/work/M4-curtain-entry.md。
//
// 狀態 state.ext.curtain（只有這個功能寫）：
//   invite?    { until }                                   邀請函（總分鐘；三天有效）
//   member?    { tier, since, paid_until, suspended?, clears }   會員證（tier 是 floor／box／vip；paid_until 是會費繳到哪，總分鐘；clears 是在這個席次破關幾次）
//   taste      string[]                                    口味單（傾向標籤的 id）
//   interview_at?  總分鐘                                 上一次面談失敗的時間
//   week?      { index, feature, tips, runs, drawn }       這一週（index 是週數）：主打、這一週的打賞、每一天（遊戲的日子）報了幾場、每一天抽過哪幾個夜
//   run?       這一趟（報名時寫；M4-curtain-run 往裡面加：幕、點單、場熱的旗標、贊助人、結算；全部經 curtain.run 這個變更改，不整筆覆蓋）
//   encore?    可以加演的紀錄（結算那一刻場熱到過 90 或點單全部完成；下一趟報名時清掉）
//   tab?       { owed, since }                              記帳欠的錢（M4-curtain-fall；每週一行利息；欠到保證金的兩倍就不能再報名）
//   gig?       { start, until, shows, missed, checked }     簽的檔期：四週、每週至少上一場；shows 是每一個「週」（從簽下去那一刻起算的七天）上了幾場
//   fall?      { act, heat, tips, ... stage }               落幕之後的一筆：補演（replay）與之後的選擇（choose）；選了路就沒有了
//   tapes      [{ id, leaked, price, bought? }]             每次落幕擲到外流（或館方保管）的母帶，買回要付錢
// 沒有這一格的鍵都當作沒有；形狀不對的部分當成沒有（讀的函式回傳複製品）。

import type { ActorId, Change, ContentEntry, GameState, Kernel } from '../../core'
import { clone, isRecord, toMinutes, weeklyRule } from '../../core'

export const OWNER = 'curtain'
/** state.ext 的鍵 */
export const EXT = 'curtain'
export const RULE_KIND = 'curtain_rule'
export const NIGHT_KIND = 'curtain_night'
/** 點單表、賞箱表、獎品表（各一筆 d6 的表；M4-curtain-run）。 */
export const TABLE_KIND = 'curtain_table'
/** 場熱的量表：一趟一條，鍵是那一趟的地圖實例（和追蹤度同一個做法）。 */
export const HEAT = 'stage_heat'
/** 票根：核心的計數器。 */
export const STUBS = 'curtain:stubs'
export const FLAG_SPONSOR = 'curtain_sponsor'
/** 一趟網內的行程的活動名字（features/netrun 的）：只用名字，不 import。 */
export const ACT_NETRUN = 'netrun'
/** 潛入的活動名字（features/dive 的）：簾口放在潛入裡的網內街區時，一趟的外框；只用名字，不 import。 */
export const ACT_DIVE = 'dive'
/** 開那一趟時 origin.by 寫這個，掛點收到的 run.origin.by 用它認得「這是簾後館開的」。 */
export const ORIGIN_BY = 'curtain'
/** 這一區的 id（DATA 第 10 節：region 的 curtain）。 */
export const REGION_ID = 'curtain'

export const INVITE_EFFECT = 'curtain_invite'
export const MEMBER_CONDITION = 'curtain_member'

export const INTERVIEW_ACTION = 'curtain.interview'
export const TASTE_ACTION = 'curtain.taste'
export const ENTER_ACTION = 'curtain.enter'
export const USE_ACTION = 'curtain.use'
export const REST_ACTION = 'curtain.rest'
export const RESULT_ACTION = 'curtain.result'
export const STAGE_ACTION = 'curtain.stage'
export const ENCORE_ACTION = 'curtain.encore'
/** 加演的邀請作廢（離開簾口或過了這一晚）。 */
export const ENCORE_VOID_ACTION = 'curtain.encore_void'
export const FALL_ACTION = 'curtain.fall'
export const REPLAY_ACTION = 'curtain.replay'
export const SETTLE_ACTION = 'curtain.settle'
export const TAPE_ACTION = 'curtain.tape'
/** 帳單項目的 id：記帳的利息。 */
export const TAB_BILL_ID = 'curtain_tab'
/** 母帶外流的旗標（curtain_tape:<id>）與館被臨檢的旗標。 */
export const FLAG_TAPE = 'curtain_tape'
export const FLAG_RAIDED = 'curtain_raided'

/** 帳單項目的 id（掛點 bill.collect）。 */
export const FEE_BILL_ID = 'curtain_fee'

export const DAY_MINUTES = 1440

export type TierId = 'floor' | 'box' | 'vip'
export const TIER_IDS: readonly TierId[] = ['floor', 'box', 'vip']
export type InterviewSkill = 'negotiate' | 'perform'
export const INTERVIEW_SKILLS: readonly InterviewSkill[] = ['negotiate', 'perform']

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 規則表 curtain_rule（id: default） ----

export interface TierDef {
  id: TierId
  name: string
  /** 等級（II～IV） */
  grade: 2 | 3 | 4
  /** 街頭信譽要到第幾階（REP_TIERS 的序號：2 有號、3 搶手、4 頂尖） */
  rep_min: number
  /** 保證金（報名才付） */
  deposit: number
  /** 每週會費 */
  fee_weekly: number
  /** 破關獎金（下一張用） */
  prize: number
  /** 面談的 DC */
  interview_dc: number
}

export interface RefuseRule {
  /** 沉溺到這麼多不收 */
  sink: number
  /** 勢力的敵對值到這麼多不收 */
  hostility: number
  /** 查敵對值的勢力（內容匯入前是空的） */
  factions: string[]
}

export interface CurtainRules {
  tiers: TierDef[]
  /** 邀請函有效幾天 */
  invite_days: number
  /** 面談失敗幾天後才能再談 */
  interview_retry_days: number
  /** 會費連續幾週沒付就停權 */
  fee_grace_weeks: number
  /** 一晚最多幾場 */
  runs_per_night: number
  /** 同伴券：每一位乘等級 */
  companion_fee: number
  refuse: RefuseRule
  /** 口味單裡開著的標籤少於這個數就開純舞台場次 */
  taste_min: number
  /** 主打的打賞倍率（下一張用） */
  feature_bonus: number
  /** 升一席要在目前的席次破關幾次 */
  upgrade_clears: number
  /** 一隊最多幾個人 */
  max_party: number
  /** 會費在帳單裡的順序（DOWNTIME 5.1 節：會費類排在天使急救會費那一格） */
  fee_order: number
  /** 四幕的名字（一幕一層；CYBERSPACE 8.8 節）。資料的 acts 可以寫名字（字串）或整筆 ActDef，這裡永遠是名字 */
  acts: string[]
  /** 四幕各自放什麼（M4-curtain-run）；和 acts 一一對應 */
  act_defs: ActDef[]
  /** 場熱的漲跌（CYBERSPACE 8.8 節「場熱」） */
  heat: HeatRules
  /** 打賞：場熱對獎金的比例（五段，照 tips_edges 的四個下限分） */
  tips: number[]
  tips_edges: number[]
  /** 一枚票根換多少現金 */
  stub_value: number
  /** 加演（第 5、6 幕） */
  encore: EncoreRules
  /** 每場遭遇是這一夜的文化的機率；其餘平均分給別的夜（P58） */
  culture_own: number
  /** 契約的條文：簽了打賞少幾成、票根加幾枚 */
  clause: { tips_cut: number; stubs: number }
  /** 後台的近道：失敗扣保證金幾成、場熱怎麼變；員工風格的偽裝加幾 */
  shortcut: { deposit_cut: number; heat: number; staff_style: string; staff_bonus: number }
  /** 點單完成給的票根（最少、最多） */
  order_stubs: [number, number]
  /** 包場：票根、之後的打賞少幾成 */
  book: { stubs: number; tips_cut: number }
  /** 三張表的 id（沒寫的種類取 id 排最前面的那一張） */
  tables: { order?: string; chest?: string; prize?: string }
  /** 這一趟用到的檢定：台詞（表演）、近道（潛行）、條文（意志或調查，取加值最高的） */
  checks: { line: CheckDef[]; shortcut: CheckDef[]; clause: CheckDef[] }
  /** 面談花幾分鐘 */
  interview_minutes: number
  /** 落幕之後（補演、三條路、母帶） */
  fall: FallRules
  /** 這一區的生成規則（net_region 的欄位；預設加上資料蓋掉的）。開那一趟時整筆放在 setup.region，再加上 safe: true、pressure: 'none' */
  region: Record<string, unknown>
}

/** 一幕放什麼。encounters 含守閘門的那一場；boss 是閘門前的層主（台柱、導演）或首領（主持；散座的終幕沒有）。 */
export interface ActDef {
  id: string
  name: string
  encounters: [number, number]
  orders: [number, number]
  chests: [number, number]
  boss?: 'headliner' | 'director' | 'host'
  /** 標準回合數（探索與戰鬥一起算） */
  turns: number
  shortcut?: boolean
  /** 這一幕有獎品室（終幕） */
  prize_room?: boolean
}

export interface CheckDef {
  attr: string
  skill?: string
}

export interface HeatRules {
  highlight: number
  highlight_cap: number
  order_done: number
  order_refuse: number
  down: number
  over_per: number
  over_pen: number
  explore_per: number
  explore_pen: number
  /** 成人場景的三級：契合到這個數字以上就是這一級（由高到低） */
  scene: Array<{ min: number; delta: number }>
  rest: number
  book: number
  line_crit: number
  sponsor: number
  encore: number
}

/** 落幕之後（CYBERSPACE 8.8 節「打輸會怎樣」；M4-curtain-fall）。 */
export interface FallRules {
  /** 落幕時打賞減半 */
  tips_mult: number
  /** 補演：契合的評價換回打賞——good_min 以上（難忘與合拍）補回減掉的再加 bonus、poor_below 以下（不合）再減 penalty、中間（普通）不補；比例都是整份（沒減半）打賞的幾成 */
  replay: { bonus: number; penalty: number; good_min: number; poor_below: number }
  /** 補演這一場的沉溺夾在這個範圍（LEWD_SYSTEM 3.4 節；CORE_RULES 4.3 節） */
  sink_range: [number, number]
  /** 設備費與違約金是保證金的幾倍 */
  fine_mult: number
  /** 記帳：每週利息的比例、欠款上限是保證金的幾倍 */
  tab: { weekly: number; cap_mult: number }
  /** 簽檔期：幾週、每週至少幾場、你拿幾成（館六你四）、沒上場的敵對值、哪個勢力 */
  gig: { weeks: number; shows_per_week: number; split: number; miss_hostility: number; faction: string }
  /** 母帶外流：機率（基底、當週被臨檢、帳上有欠款、第二幕輸、上限）、每一區豔名加幾、買回是保證金的幾倍 */
  tape: { base: number; raided: number; in_debt: number; backstage: number; cap: number; fame: number; buyback_mult: number }
  /** 輸在哪一幕走哪一件戰敗事件（鍵是幕的 id，加演的幕用 encore1、encore2）；plain 是它的 _plain 版本（沒有場景：篩選把版本全擋掉、或純舞台場次） */
  events: Record<string, string>
  plain: Record<string, string>
}

export interface EncoreRules {
  names: string[]
  /** 第 5、6 幕敵人比席次高幾級 */
  grades: number[]
  /** 第 5、6 幕的獎金倍率（全部走完是最後一個；走完第一幕就登出拿第一個） */
  prize: number[]
}

/**
 * 這一區的預設（CYBERSPACE 8.1 節密度表簾後館那一列）：9 × 7、挖 20～28 步、沒有追蹤度。netrun 的密度是整區一份、每一層一樣，所以每一層放：
 * 2 場遭遇（含守閘門的那一場）、點單 1（p）、賞箱 1～2（a）、近道的位置 1（b；只有 act_defs 寫了 shortcut 的那一幕用它）、條文 0～1（c）；節點 7～9。
 * 點單（p）、賞箱（a）、近道（b）、條文（c）由這個功能自己處理（handled）：netrun 不列它們的用途；遭遇（f）是 netrun 的（開戰與潛行繞過），這個功能只在生成時（掛點 netrun.foe_ref）決定每場遭遇的文化與等級。每一幕各自的數量差別（終幕沒有點單、有獎品室）由 act_defs 與節點的角色決定。
 */
export const DEFAULT_REGION: Record<string, unknown> = {
  id: REGION_ID, name: '簾後館', map_kind: 'maze', size: [9, 7], carve: [20, 28], sight: 2, pressure: 'none', safe: true, cover: 'medium', dc: [10, 13, 16, 19, 22],
  layer: { foe: [2, 2], patrol: [0, 0], archive: [1, 2], trap: [0, 0], rest: [0, 0], safe: [1, 1], control: [0, 1], person: [1, 1] },
  handled: ['a', 'b', 'c', 'p'],
}

export const DEFAULT_RULES: CurtainRules = {
  tiers: [
    { id: 'floor', name: '散座', grade: 2, rep_min: 2, deposit: 300, fee_weekly: 100, prize: 900, interview_dc: 13 },
    { id: 'box', name: '包廂', grade: 3, rep_min: 3, deposit: 1000, fee_weekly: 300, prize: 3000, interview_dc: 16 },
    { id: 'vip', name: '貴賓席', grade: 4, rep_min: 4, deposit: 3300, fee_weekly: 1000, prize: 9800, interview_dc: 19 },
  ],
  invite_days: 3,
  interview_retry_days: 7,
  fee_grace_weeks: 2,
  runs_per_night: 2,
  companion_fee: 100,
  refuse: { sink: 80, hostility: 40, factions: [] },
  taste_min: 3,
  feature_bonus: 1.2,
  upgrade_clears: 5,
  max_party: 4,
  fee_order: 6,
  acts: ['序幕・迎賓廳', '第一幕・舞台', '第二幕・後台', '終幕・貴賓席'],
  act_defs: [
    { id: 'foyer', name: '序幕・迎賓廳', encounters: [2, 2], orders: [1, 1], chests: [1, 2], turns: 12 },
    { id: 'stage', name: '第一幕・舞台', encounters: [2, 2], orders: [1, 1], chests: [1, 2], boss: 'headliner', turns: 15 },
    { id: 'backstage', name: '第二幕・後台', encounters: [2, 3], orders: [1, 1], chests: [1, 2], boss: 'director', turns: 15, shortcut: true },
    { id: 'vip', name: '終幕・貴賓席', encounters: [2, 2], orders: [0, 0], chests: [0, 0], boss: 'host', turns: 12, prize_room: true },
  ],
  heat: {
    highlight: 2, highlight_cap: 10, order_done: 8, order_refuse: -5, down: -10, over_per: 3, over_pen: -2, explore_per: 3, explore_pen: -1,
    scene: [{ min: 60, delta: 10 }, { min: 30, delta: 5 }, { min: 0, delta: -5 }], rest: 5, book: 10, line_crit: 4, sponsor: 70, encore: 90,
  },
  tips: [0, 0.1, 0.2, 0.35, 0.5],
  tips_edges: [20, 40, 60, 80],
  stub_value: 20,
  encore: { names: ['加演・第五幕', '加演・第六幕'], grades: [1, 2], prize: [2, 4] },
  culture_own: 0.6,
  clause: { tips_cut: 0.2, stubs: 5 },
  shortcut: { deposit_cut: 0.1, heat: -5, staff_style: 'staff', staff_bonus: 4 },
  order_stubs: [3, 8],
  book: { stubs: 10, tips_cut: 0.1 },
  tables: {},
  interview_minutes: 60,
  fall: {
    tips_mult: 0.5,
    replay: { bonus: 0.1, penalty: 0.1, good_min: 60, poor_below: 30 },
    sink_range: [-2, 2],
    fine_mult: 0.5,
    tab: { weekly: 0.1, cap_mult: 2 },
    gig: { weeks: 4, shows_per_week: 1, split: 0.4, miss_hostility: 10, faction: 'rouge' },
    tape: { base: 0.15, raided: 0.15, in_debt: 0.15, backstage: 0.1, cap: 0.45, fame: 5, buyback_mult: 2 },
    events: { foyer: 'df_stage_foyer', stage: 'df_stage_headliner', backstage: 'df_stage_backstage', vip: 'df_stage_vip', encore1: 'df_stage_encore', encore2: 'df_stage_encore' },
    plain: { foyer: 'df_stage_foyer_plain', stage: 'df_stage_headliner_plain', backstage: 'df_stage_backstage_plain', vip: 'df_stage_vip_plain', encore1: 'df_stage_encore_plain', encore2: 'df_stage_encore_plain' },
  },
  checks: {
    line: [{ attr: 'charm', skill: 'perform' }],
    shortcut: [{ attr: 'reflex', skill: 'stealth' }],
    clause: [{ attr: 'resolve' }, { attr: 'intellect', skill: 'investigate' }],
  },
  region: clone(DEFAULT_REGION),
}

// ---- 格式檢查 ----

function tierProblems(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 3) return ['tiers 要是三個席次（floor、box、vip，照順序）']
  const p: string[] = []
  raw.forEach((t, i) => {
    const at = `tiers[${i}]`
    if (!isRecord(t)) { p.push(`${at} 要是 { id, name, grade, rep_min, deposit, fee_weekly, prize, interview_dc }`); return }
    if (t.id !== TIER_IDS[i]) p.push(`${at}.id 要是 ${TIER_IDS[i]}（三個席次照 floor、box、vip 的順序）`)
    if (!isText(t.name)) p.push(`${at}.name 要有名字`)
    if (!(isInt(t.grade) && t.grade >= 2 && t.grade <= 4)) p.push(`${at}.grade 要是 2～4 的整數`)
    if (!(isInt(t.rep_min) && t.rep_min >= 0 && t.rep_min <= 5)) p.push(`${at}.rep_min 要是街頭信譽的階（0～5 的整數）`)
    for (const key of ['deposit', 'fee_weekly', 'prize'] as const) if (!(isInt(t[key]) && (t[key] as number) >= 0)) p.push(`${at}.${key} 要是 0 以上的整數`)
    if (!(isInt(t.interview_dc) && t.interview_dc >= 1 && t.interview_dc <= 40)) p.push(`${at}.interview_dc 要是 1～40 的整數`)
  })
  return p
}

/** 一筆規則表的格式檢查（內容種類 curtain_rule）。 */
export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.tiers !== undefined) p.push(...tierProblems(e.tiers))
  for (const [key, lo, hi] of [['invite_days', 1, 60], ['interview_retry_days', 0, 365], ['fee_grace_weeks', 1, 52], ['runs_per_night', 1, 10], ['companion_fee', 0, 100000], ['taste_min', 0, 100], ['upgrade_clears', 0, 100], ['max_party', 1, 8], ['fee_order', 1, 10]] as const) {
    if (e[key] !== undefined && !(isInt(e[key]) && (e[key] as number) >= lo && (e[key] as number) <= hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  }
  if (e.feature_bonus !== undefined && !(isNum(e.feature_bonus) && e.feature_bonus >= 0 && e.feature_bonus <= 10)) p.push('feature_bonus 要是 0～10 的數字')
  if (e.refuse !== undefined) {
    const r = e.refuse
    if (!isRecord(r)) p.push('refuse 要是 { sink, hostility, factions }')
    else {
      for (const key of ['sink', 'hostility'] as const) if (r[key] !== undefined && !(isInt(r[key]) && (r[key] as number) >= 0 && (r[key] as number) <= 200)) p.push(`refuse.${key} 要是 0～200 的整數`)
      if (r.factions !== undefined && !(Array.isArray(r.factions) && r.factions.every(isText))) p.push('refuse.factions 要是勢力 id 的陣列')
    }
  }
  if (e.acts !== undefined) {
    if (!(Array.isArray(e.acts) && e.acts.length >= 1 && e.acts.length <= 8)) p.push('acts 要是一到八幕（名字，或 { id, name, encounters, orders, chests, boss?, turns, shortcut? }）')
    else e.acts.forEach((a, i) => { if (!isText(a)) p.push(...actProblems(a, `acts[${i}]`)) })
  }
  p.push(...runRuleProblems(e))
  if (e.interview_minutes !== undefined && !(isInt(e.interview_minutes) && e.interview_minutes >= 0 && e.interview_minutes <= 1440)) p.push('interview_minutes 要是 0～1440 的整數（面談花幾分鐘）')
  p.push(...fallRuleProblems(e))
  if (e.region !== undefined && !isRecord(e.region)) p.push('region 要是 net_region 的欄位（只寫要蓋掉的）')
  return p
}

const isRange2 = (v: unknown, lo: number, hi: number): v is [number, number] => Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] >= lo && v[1] >= v[0] && v[1] <= hi
const ratio = (v: unknown, hi = 1): boolean => isNum(v) && v >= 0 && v <= hi

/** 一幕的格式檢查。 */
function actProblems(a: unknown, at: string): string[] {
  if (!isRecord(a)) return [`${at} 要是幕的名字，或 { id, name, encounters, orders, chests, boss?, turns, shortcut? }`]
  const p: string[] = []
  if (!isText(a.id)) p.push(`${at}.id 要有 id`)
  if (!isText(a.name)) p.push(`${at}.name 要有名字`)
  for (const key of ['encounters', 'orders', 'chests'] as const) if (!isRange2(a[key], 0, 20)) p.push(`${at}.${key} 要是 [最少, 最多]，0～20 的整數`)
  if (a.boss !== undefined && !['headliner', 'director', 'host'].includes(a.boss as string)) p.push(`${at}.boss 只能是 headliner、director、host`)
  if (!(isInt(a.turns) && a.turns >= 1 && a.turns <= 200)) p.push(`${at}.turns 要是 1～200 的整數（標準回合數）`)
  for (const key of ['shortcut', 'prize_room'] as const) if (a[key] !== undefined && typeof a[key] !== 'boolean') p.push(`${at}.${key} 要是布林值`)
  return p
}

const checkListProblems = (v: unknown, at: string): string[] => (Array.isArray(v) && v.length >= 1 && v.every((c) => isRecord(c) && isText(c.attr) && (c.skill === undefined || isText(c.skill))) ? [] : [`${at} 要是一串 { attr, skill? }`])

const isIdMap = (v: unknown): boolean => isRecord(v) && Object.values(v).every(isText)

/** 落幕之後的規則（fall；M4-curtain-fall 加的欄位）的格式檢查。 */
function fallRuleProblems(e: Record<string, unknown>): string[] {
  if (e.fall === undefined) return []
  const f = e.fall
  if (!isRecord(f)) return ['fall 要是 { tips_mult, replay, sink_range, fine_mult, tab, gig, tape, events, plain }']
  const p: string[] = []
  const num = (v: unknown, hi: number): boolean => isNum(v) && v >= 0 && v <= hi
  if (f.tips_mult !== undefined && !ratio(f.tips_mult, 10)) p.push('fall.tips_mult 要是 0～10 的數字')
  if (f.fine_mult !== undefined && !ratio(f.fine_mult, 10)) p.push('fall.fine_mult 要是 0～10 的數字')
  if (f.sink_range !== undefined && !(Array.isArray(f.sink_range) && f.sink_range.length === 2 && isInt(f.sink_range[0]) && isInt(f.sink_range[1]) && f.sink_range[0] <= f.sink_range[1] && Math.abs(f.sink_range[0]) <= 100 && Math.abs(f.sink_range[1]) <= 100)) p.push('fall.sink_range 要是 [最少, 最多]，−100～100 的整數')
  if (f.replay !== undefined) {
    const r = f.replay
    if (!isRecord(r) || (r.bonus !== undefined && !ratio(r.bonus, 10)) || (r.penalty !== undefined && !ratio(r.penalty, 10)) || (r.good_min !== undefined && !(isInt(r.good_min) && r.good_min >= 0 && r.good_min <= 100)) || (r.poor_below !== undefined && !(isInt(r.poor_below) && r.poor_below >= 0 && r.poor_below <= 100))) p.push('fall.replay 要是 { bonus, penalty（0～10 的數字）, good_min, poor_below（0～100 的整數）}')
  }
  if (f.tab !== undefined) {
    const t = f.tab
    if (!isRecord(t) || (t.weekly !== undefined && !ratio(t.weekly, 10)) || (t.cap_mult !== undefined && !ratio(t.cap_mult, 100))) p.push('fall.tab 要是 { weekly（每週利息的比例）, cap_mult（欠款上限是保證金的幾倍）}')
  }
  if (f.gig !== undefined) {
    const g = f.gig
    if (!isRecord(g) || (g.weeks !== undefined && !(isInt(g.weeks) && g.weeks >= 1 && g.weeks <= 52)) || (g.shows_per_week !== undefined && !(isInt(g.shows_per_week) && g.shows_per_week >= 1 && g.shows_per_week <= 20))
      || (g.split !== undefined && !ratio(g.split)) || (g.miss_hostility !== undefined && !(isInt(g.miss_hostility) && Math.abs(g.miss_hostility) <= 100)) || (g.faction !== undefined && !isText(g.faction))) p.push('fall.gig 要是 { weeks, shows_per_week, split（0～1）, miss_hostility, faction }')
  }
  if (f.tape !== undefined) {
    const t = f.tape
    if (!isRecord(t) || ['base', 'raided', 'in_debt', 'backstage', 'cap'].some((key) => t[key] !== undefined && !ratio(t[key])) || (t.fame !== undefined && !num(t.fame, 100)) || (t.buyback_mult !== undefined && !ratio(t.buyback_mult, 100))) p.push('fall.tape 要是 { base, raided, in_debt, backstage, cap（0～1）, fame, buyback_mult }')
  }
  for (const key of ['events', 'plain'] as const) if (f[key] !== undefined && !isIdMap(f[key])) p.push(`fall.${key} 要是 { 幕的 id: 戰敗事件的 id }`)
  return p
}

/** 這一趟的規則（M4-curtain-run 加的欄位）的格式檢查。 */
function runRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.heat !== undefined) {
    const h = e.heat
    if (!isRecord(h)) p.push('heat 要是 { highlight, highlight_cap, order_done, order_refuse, down, over_per, over_pen, explore_per, explore_pen, scene, rest, book, line_crit, sponsor, encore }')
    else {
      for (const key of ['highlight', 'highlight_cap', 'order_done', 'order_refuse', 'down', 'over_pen', 'explore_pen', 'rest', 'book', 'line_crit'] as const) if (h[key] !== undefined && !(isInt(h[key]) && Math.abs(h[key] as number) <= 100)) p.push(`heat.${key} 要是 −100～100 的整數`)
      for (const key of ['over_per', 'explore_per'] as const) if (h[key] !== undefined && !(isInt(h[key]) && (h[key] as number) >= 1 && (h[key] as number) <= 100)) p.push(`heat.${key} 要是 1～100 的整數`)
      for (const key of ['sponsor', 'encore'] as const) if (h[key] !== undefined && !(isInt(h[key]) && (h[key] as number) >= 1 && (h[key] as number) <= 100)) p.push(`heat.${key} 要是 1～100 的整數（場熱的門檻）`)
      if (h.scene !== undefined && !(Array.isArray(h.scene) && h.scene.length >= 1 && h.scene.every((r) => isRecord(r) && isInt(r.min) && isInt(r.delta) && Math.abs(r.delta) <= 100))) p.push('heat.scene 要是一串 { min, delta }（契合到 min 以上換 delta 點場熱，由高到低）')
    }
  }
  if (e.tips !== undefined && !(Array.isArray(e.tips) && e.tips.length === 5 && e.tips.every((n) => ratio(n, 10)))) p.push('tips 要是五個比例（0～10 的數字，場熱由低到高五段）')
  if (e.tips_edges !== undefined && !(Array.isArray(e.tips_edges) && e.tips_edges.length === 4 && e.tips_edges.every((n, i, a) => isInt(n) && n >= 0 && n <= 100 && (i === 0 || n > (a[i - 1] as number))))) p.push('tips_edges 要是四個由小到大的整數（0～100，後四段的下限）')
  if (e.stub_value !== undefined && !(isInt(e.stub_value) && e.stub_value >= 0 && e.stub_value <= 100000)) p.push('stub_value 要是 0 以上的整數')
  if (e.encore !== undefined) {
    const v = e.encore
    if (!isRecord(v)) p.push('encore 要是 { names, grades, prize }')
    else {
      if (v.names !== undefined && !(Array.isArray(v.names) && v.names.length >= 1 && v.names.length <= 4 && v.names.every(isText))) p.push('encore.names 要是一到四個幕的名字')
      for (const key of ['grades', 'prize'] as const) if (v[key] !== undefined && !(Array.isArray(v[key]) && (v[key] as unknown[]).length >= 1 && (v[key] as unknown[]).length <= 4 && (v[key] as unknown[]).every((n) => isNum(n) && n >= 0 && n <= 20))) p.push(`encore.${key} 要是一到四個數字`)
    }
  }
  if (e.culture_own !== undefined && !ratio(e.culture_own)) p.push('culture_own 要是 0～1 的數字')
  if (e.clause !== undefined) {
    const v = e.clause
    if (!isRecord(v) || (v.tips_cut !== undefined && !ratio(v.tips_cut)) || (v.stubs !== undefined && !(isInt(v.stubs) && v.stubs >= 0 && v.stubs <= 1000))) p.push('clause 要是 { tips_cut（0～1）, stubs }')
  }
  if (e.shortcut !== undefined) {
    const v = e.shortcut
    if (!isRecord(v) || (v.deposit_cut !== undefined && !ratio(v.deposit_cut)) || (v.heat !== undefined && !(isInt(v.heat) && Math.abs(v.heat) <= 100)) || (v.staff_style !== undefined && !isText(v.staff_style)) || (v.staff_bonus !== undefined && !(isInt(v.staff_bonus) && Math.abs(v.staff_bonus) <= 20))) p.push('shortcut 要是 { deposit_cut（0～1）, heat, staff_style, staff_bonus }')
  }
  if (e.order_stubs !== undefined && !isRange2(e.order_stubs, 0, 1000)) p.push('order_stubs 要是 [最少, 最多]')
  if (e.book !== undefined) {
    const v = e.book
    if (!isRecord(v) || (v.stubs !== undefined && !(isInt(v.stubs) && v.stubs >= 0 && v.stubs <= 1000)) || (v.tips_cut !== undefined && !ratio(v.tips_cut))) p.push('book 要是 { stubs, tips_cut（0～1）}')
  }
  if (e.tables !== undefined && !(isRecord(e.tables) && Object.entries(e.tables).every(([k, v]) => ['order', 'chest', 'prize'].includes(k) && isText(v)))) p.push('tables 要是 { order?, chest?, prize? }（表的 id）')
  if (e.checks !== undefined) {
    const v = e.checks
    if (!isRecord(v)) p.push('checks 要是 { line?, shortcut?, clause? }')
    else for (const key of ['line', 'shortcut', 'clause']) if (v[key] !== undefined) p.push(...checkListProblems(v[key], `checks.${key}`))
  }
  return p
}

/** 一張表（內容種類 curtain_table）：點單表的列有 order，賞箱表與獎品表的列有 stubs、give、prize、double、theme。 */
export type OrderKind = 'skin' | 'rules' | 'finish' | 'duet' | 'line' | 'encore'
export const ORDER_KINDS: readonly OrderKind[] = ['skin', 'rules', 'finish', 'duet', 'line', 'encore']
export interface TableRow {
  weight: number
  name?: string
  /** 點單表：這一列是哪一種 */
  order?: OrderKind
  /** 點單表（換裝）：要對到的風格標籤；沒寫是這一夜的 style、再沒有是這一夜的 tags */
  style?: string
  /** 賞箱與獎品表：票根（一個數字或 [最少, 最多]） */
  stubs?: number | [number, number]
  /** 一串效果（內建來源；數字可以寫照等級的五個值） */
  give?: Array<Record<string, unknown>>
  /** 賞箱：再擲一次獎品表 */
  prize?: boolean
  /** 賞箱：觀眾的紙條，下一個點單的票根 ×2 */
  double?: boolean
  /** 獎品表：這一夜的主題獎品（curtain_night 的 prize） */
  theme?: boolean
}
export interface CurtainTable extends ContentEntry {
  kind: 'order' | 'chest' | 'prize'
  rows: TableRow[]
}

export function tableProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.kind !== 'order' && e.kind !== 'chest' && e.kind !== 'prize') p.push("kind 只能是 'order'（點單）、'chest'（賞箱）或 'prize'（獎品）")
  if (!(Array.isArray(e.rows) && e.rows.length >= 1)) return [...p, 'rows 要是至少一列 { weight, ... }']
  e.rows.forEach((row, i) => {
    const at = `rows[${i}]`
    if (!isRecord(row)) { p.push(`${at} 要是 { weight, ... }`); return }
    if (!(isNum(row.weight) && row.weight > 0)) p.push(`${at}.weight 要是大於 0 的數字`)
    if (row.name !== undefined && !isText(row.name)) p.push(`${at}.name 要有名字`)
    if (e.kind === 'order') {
      if (!(ORDER_KINDS as readonly unknown[]).includes(row.order)) p.push(`${at}.order 要是 ${ORDER_KINDS.join('、')} 其中一個`)
      if (row.style !== undefined && !isText(row.style)) p.push(`${at}.style 要是風格標籤的 id`)
      return
    }
    if (row.give !== undefined && !(Array.isArray(row.give) && row.give.every(isRecord))) p.push(`${at}.give 要是一串效果（每一筆是一個物件）`)
    if (row.stubs !== undefined && !((isInt(row.stubs) && row.stubs >= 0) || isRange2(row.stubs, 0, 100000))) p.push(`${at}.stubs 要是 0 以上的整數，或 [最少, 最多]`)
    for (const key of ['prize', 'double', 'theme'] as const) if (row[key] !== undefined && typeof row[key] !== 'boolean') p.push(`${at}.${key} 要是布林值`)
    if (row.give === undefined && row.stubs === undefined && row.prize !== true && row.double !== true && row.theme !== true) p.push(`${at} 什麼都沒給（要有 give、stubs、prize、double 或 theme）`)
  })
  return p
}

/** 一個夜（內容種類 curtain_night）。 */
export interface NightEntry extends ContentEntry {
  name: string
  /** 包場的勢力 */
  faction: string
  /** 對到的傾向與風格標籤 */
  tags: string[]
  /** 要開著的篩選標籤（例：契約之夜要 contract_dom） */
  needs_filter?: string
  /** 主題獎品（內容；這一張不用） */
  prize?: string | Record<string, unknown>
  /** 這一夜的敵人文化 */
  culture: string
  /** 點單「換裝」要對到的風格標籤（沒寫就用 tags） */
  style?: string | string[]
}

export function nightProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要有名字')
  if (!isText(e.faction)) p.push('faction 要是包場的勢力的 id')
  if (!(Array.isArray(e.tags) && e.tags.length >= 1 && e.tags.every(isText))) p.push('tags 要是至少一個傾向或風格標籤的 id')
  if (e.needs_filter !== undefined && !isText(e.needs_filter)) p.push('needs_filter 要是篩選標籤的 id')
  if (e.prize !== undefined && !(isText(e.prize) || isRecord(e.prize))) p.push('prize 要是主題獎品（id 或一筆資料）')
  if (!isText(e.culture)) p.push('culture 要是這一夜的敵人文化')
  if (e.style !== undefined && !(isText(e.style) || (Array.isArray(e.style) && e.style.length >= 1 && e.style.every(isText)))) p.push('style 要是風格標籤的 id（或一串）')
  return p
}

// ---- 讀規則 ----

type Cx = Pick<Kernel, 'content'>

/** 現在生效的規則：curtain_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。region 是預設加上資料蓋掉的（layer 各項個別蓋）。 */
export function curtainRules(k: Cx): CurtainRules {
  const out: CurtainRules = clone(DEFAULT_RULES)
  if (!k.content.hasKind(RULE_KIND)) return out
  const e = k.content.get(RULE_KIND, 'default') as Record<string, unknown> | undefined
  if (!e) return out
  const bad = new Set<string>(ruleProblems(e).map((m) => m.split(/[ .[]/)[0]!))
  const ok = (key: string): boolean => e[key] !== undefined && !bad.has(key)
  if (ok('tiers')) out.tiers = clone(e.tiers as TierDef[])
  if (ok('interview_minutes')) out.interview_minutes = e.interview_minutes as number
  if (ok('fall')) {
    const f = e.fall as Record<string, unknown>
    const merge = <T extends object>(base: T, over: unknown): T => (isRecord(over) ? { ...base, ...clone(over) } as T : base)
    out.fall = {
      ...out.fall, ...(f.tips_mult !== undefined ? { tips_mult: f.tips_mult as number } : {}), ...(f.fine_mult !== undefined ? { fine_mult: f.fine_mult as number } : {}),
      ...(f.sink_range !== undefined ? { sink_range: [...(f.sink_range as [number, number])] as [number, number] } : {}),
      replay: merge(out.fall.replay, f.replay), tab: merge(out.fall.tab, f.tab), gig: merge(out.fall.gig, f.gig), tape: merge(out.fall.tape, f.tape),
      events: merge(out.fall.events, f.events), plain: merge(out.fall.plain, f.plain),
    }
  }
  for (const key of ['invite_days', 'interview_retry_days', 'fee_grace_weeks', 'runs_per_night', 'companion_fee', 'taste_min', 'upgrade_clears', 'max_party', 'fee_order', 'feature_bonus'] as const) if (ok(key)) out[key] = e[key] as number
  if (ok('refuse')) out.refuse = { ...out.refuse, ...clone(e.refuse as Partial<RefuseRule>) }
  if (ok('acts')) {
    const list = e.acts as unknown[]
    out.acts = list.map((a) => (isText(a) ? a : (a as ActDef).name))
    out.act_defs = list.map((a, i) => ({ ...(out.act_defs[i] ?? { id: `act${i + 1}`, encounters: [2, 2], orders: [1, 1], chests: [1, 2], turns: 15 }), ...(isText(a) ? { name: a } : clone(a as ActDef)) }))
  }
  if (ok('heat')) out.heat = { ...out.heat, ...clone(e.heat as Partial<HeatRules>), ...(Array.isArray((e.heat as HeatRules).scene) ? { scene: clone((e.heat as HeatRules).scene) } : {}) }
  for (const key of ['tips', 'tips_edges', 'order_stubs'] as const) if (ok(key)) (out[key] as number[]) = [...(e[key] as number[])]
  for (const key of ['stub_value', 'culture_own'] as const) if (ok(key)) out[key] = e[key] as number
  for (const key of ['encore', 'clause', 'shortcut', 'book', 'tables'] as const) if (ok(key)) (out[key] as unknown) = { ...(out[key] as object), ...clone(e[key] as object) }
  if (ok('checks')) out.checks = { ...out.checks, ...clone(e.checks as Partial<CurtainRules['checks']>) }
  if (ok('region')) {
    const over = e.region as Record<string, unknown>
    const base = out.region
    out.region = { ...base, ...clone(over), id: REGION_ID }
    out.region.layer = { ...(base.layer as Record<string, unknown>), ...(isRecord(over.layer) ? clone(over.layer) : {}) }
  }
  return out
}

export const tierOf = (rules: CurtainRules, id: string): TierDef | undefined => rules.tiers.find((t) => t.id === id)
export const tierIndex = (id: string): number => TIER_IDS.indexOf(id as TierId)

/** 內容裡的夜，照 id 排。沒有這個種類是空的。 */
export function allNights(k: Cx): NightEntry[] {
  if (!k.content.hasKind(NIGHT_KIND)) return []
  return k.content.list<NightEntry>(NIGHT_KIND).slice().sort((a, b) => (a.id < b.id ? -1 : 1))
}

// ---- 狀態 ----

export interface MemberRecord {
  tier: TierId
  /** 入會的時間（總分鐘） */
  since: number
  /** 會費繳到哪（總分鐘；下一個週一 06:00 之前不用再付） */
  paid_until: number
  suspended?: boolean
  /** 在這個席次破關幾次 */
  clears: number
}

export interface WeekRecord {
  /** 週數（照週一 06:00 算，和帳單的週數同一個算法） */
  index: number
  /** 主打的夜 */
  feature: string
  /** 這一週的打賞 */
  tips: number
  /** 遊戲的日子（深夜算前一天）→ 這一天報了幾場 */
  runs: Record<string, number>
  /** 遊戲的日子 → 這一天跑過哪幾個夜（同一個夜一天之內擲到兩次就重擲） */
  drawn: Record<string, string[]>
}

export interface RunRecord {
  /** 這一趟的編號 */
  id: string
  night: string
  tier: TierId
  grade: number
  /** 付的保證金 */
  deposit: number
  feature: boolean
  pure_stage: boolean
  /** 隊伍（含會員本人） */
  party: ActorId[]
  /** 付了同伴券的人（沒有打賞） */
  companions: ActorId[]
  /** 報名的時間（總分鐘） */
  at: number
  /** 從誰那裡報的名（遊戲的日子） */
  day: number
  // ---- 以下是 M4-curtain-run 加的（都是選填的：舊的存檔與只做到報名的測試沒有） ----
  /** 這一趟的地圖實例（第一份 netrun 報告之後由 curtain.stage 記下） */
  map?: string
  /** 現在在第幾幕（從 0 起算；加演是 4、5） */
  act?: number
  /** 這一趟遇到的點單（照遇到的順序） */
  orders?: OrderRec[]
  /** 看過、還沒決定接不接的點單 */
  offer?: OfferRec
  /** 接了、等著下一場戰鬥驗收的點單的規矩 */
  pending?: PendingRec
  /** 贊助人在場（場熱第一次到 sponsor 門檻） */
  sponsor?: boolean
  /** 打賞的倍率（起始 1；條文與包場會減） */
  tips_mult?: number
  /** 這一趟倒下的人次 */
  downed?: number
  /** 超過標準回合已經罰過的回合數 */
  over_turns?: number
  /** 觀眾的紙條：下一個完成的點單票根 ×2 */
  double?: boolean
  /** 近道失敗被扣掉的保證金 */
  docked?: number
  /** 場熱到過 0：提早落幕（等 netrun 收掉這一趟就照提早落幕結算） */
  cut?: boolean
  /** 場熱到過 encore 門檻 */
  encore_open?: boolean
  /** 這是加演的一趟（1） */
  encore?: number
  /** 條文簽過了 */
  signed?: boolean
  /** 開著的化妝室：act 是哪一幕、x 是那一刻這一幕的探索回合數（回合過了就關） */
  room?: { act: number; x: number }
  /** 用過包場的幕 */
  booked?: number[]
  /** 場熱最高到過多少 */
  peak?: number
  /** 加演的一趟接著上一趟的場熱起算：地圖開了之後由 curtain.stage 設進量表，設完就拿掉 */
  start_heat?: number
  /** 結算完了、等著發 curtain.result 的結果 */
  over?: SettleResult
  /** 全隊倒下：輸在哪一幕、當時的場熱（M4-curtain-fall 接手） */
  lost?: { act: number; heat: number }
  /** 戰敗被接受的那一刻戰敗事件說的（activity.end 的 result）：哪一件、什麼種類、哪個版本；落幕時看它有沒有補演 */
  lost_event?: { event: string; kind: string; version?: string }
}

export interface OrderRec {
  kind: OrderKind
  name: string
  state: 'open' | 'done' | 'refused'
  act: number
  /** 在哪個節點 */
  node: string
  /** 完成時給的票根（含紙條加倍） */
  stubs?: number
}

export interface OfferRec {
  node: string
  act: number
  kind: OrderKind
  name: string
  style?: string
  /** 合演：同行的人（沒寫是館方的演出者） */
  partner?: string
}

export interface PendingRec {
  kind: 'skin' | 'rules' | 'finish'
  /** 對到 orders 的第幾筆 */
  order: number
  style?: string
}

/** 結算的結果（curtain.result 讀它；也是 M4-curtain-fall 的起點）。 */
export interface SettleResult {
  outcome: string
  /** 提早落幕（場熱到 0） */
  early?: boolean
  encore?: number
  heat: number
  act: number
  prize: number
  tips: number
  tips_ratio: number
  refund: number
  forfeited: number
  stubs: number
  clears?: number
  lines: string[]
}

/** 加演的資格：結算之後留著，選了加演才開第二趟 netrun（第 5、6 幕）。 */
export interface EncoreRec {
  /** 原本那一趟的編號 */
  from: string
  night: string
  tier: TierId
  grade: number
  party: ActorId[]
  feature: boolean
  pure_stage: boolean
  heat: number
  tips_mult: number
  /** 結算那一晚（nightOf）：過了這一晚邀請作廢（使用者 2026-11-26 裁決 4） */
  day?: number
  /** 結算時人站的位置（簾口）：離開簾口邀請作廢（簾口在潛入裡時就是潛入中的那一格） */
  at?: { block?: string; facility?: string }
}

export interface CurtainState {
  invite?: { until: number }
  member?: MemberRecord
  taste: string[]
  interview_at?: number
  week?: WeekRecord
  run?: RunRecord
  /** 可以加演（結算那一刻場熱到過 encore 門檻，或點單全部完成）：下一趟報名時清掉 */
  encore?: EncoreRec
  /** 記帳欠的錢（M4-curtain-fall） */
  tab?: TabRecord
  /** 簽的檔期 */
  gig?: GigRecord
  /** 落幕之後等著處理的一筆 */
  fall?: FallRecord
  /** 母帶 */
  tapes: TapeRecord[]
}

export interface TabRecord {
  owed: number
  /** 欠下第一筆的時間（總分鐘） */
  since: number
}

export interface GigRecord {
  /** 簽下去的時間 */
  start: number
  /** 到期的時間（總分鐘） */
  until: number
  /** 第幾個「週」（從簽下去那一刻起算的七天，從 0 起算；鍵是字串）→ 上了幾場 */
  shows: Record<string, number>
  /** 沒上場的週數 */
  missed: number
  /** 已經結算過的週數 */
  checked: number
}

export interface FallRecord {
  /** 輸在整趟的第幾幕（從 0 起算；加演是基本的幕數之後） */
  act: number
  /** 輸的那一刻的場熱 */
  heat: number
  /** 打賞：replay 的時候是減半之後等著補演結果的那份（還沒付）；choose 的時候是最後付出去的 */
  tips: number
  /** 沒減半的整份打賞（補演的評價換回它的幾成） */
  full: number
  stage: 'replay' | 'choose'
  /** 喊停了 */
  called_off?: boolean
  /** 補演已經開演（場景在進行） */
  started?: boolean
  /** 補演的結果：契合、評價（好／普通／不合）、場景給的沉溺與實際留下的、打賞前後 */
  replayed?: { fit: number; band: 'good' | 'fair' | 'poor'; sink: number; kept: number; from: number; to: number; reported?: boolean }
  /** 這一趟的資料（之後的選項要用）：編號、席次、保證金、夜、隊伍 */
  run: string
  night: string
  tier: TierId
  deposit: number
  party: ActorId[]
  /** 戰敗事件：哪一件、哪個版本（有補演才有） */
  event?: string
  version?: string
}

export interface TapeRecord {
  /** 母帶的編號（旗標 curtain_tape:<id>） */
  id: string
  /** 外流了（blacktape 關掉時是 false：館方保管，只能買回） */
  leaked: boolean
  /** 買回要付多少 */
  price: number
  bought?: boolean
}

const nat = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0)

function readMember(raw: unknown): MemberRecord | undefined {
  if (!isRecord(raw) || !(TIER_IDS as readonly unknown[]).includes(raw.tier) || !isInt(raw.since) || !isInt(raw.paid_until)) return undefined
  return { tier: raw.tier as TierId, since: raw.since, paid_until: raw.paid_until, ...(raw.suspended === true ? { suspended: true } : {}), clears: nat(raw.clears) }
}

function readWeek(raw: unknown): WeekRecord | undefined {
  if (!isRecord(raw) || !isInt(raw.index) || !isText(raw.feature)) return undefined
  const runs: Record<string, number> = {}
  if (isRecord(raw.runs)) for (const [d, n] of Object.entries(raw.runs)) if (isInt(n) && n > 0) runs[d] = n
  const drawn: Record<string, string[]> = {}
  if (isRecord(raw.drawn)) for (const [d, list] of Object.entries(raw.drawn)) if (Array.isArray(list)) drawn[d] = list.filter(isText)
  return { index: raw.index, feature: raw.feature, tips: nat(raw.tips), runs, drawn }
}

const STATES = ['open', 'done', 'refused']

function readOrder(raw: unknown): OrderRec | undefined {
  if (!isRecord(raw) || !(ORDER_KINDS as readonly unknown[]).includes(raw.kind) || !STATES.includes(raw.state as string) || !isText(raw.node) || !isInt(raw.act)) return undefined
  return { kind: raw.kind as OrderKind, name: isText(raw.name) ? raw.name : String(raw.kind), state: raw.state as OrderRec['state'], act: raw.act, node: raw.node, ...(isInt(raw.stubs) ? { stubs: raw.stubs } : {}) }
}

function readRun(raw: unknown): RunRecord | undefined {
  if (!isRecord(raw) || !isText(raw.id) || !isText(raw.night) || !(TIER_IDS as readonly unknown[]).includes(raw.tier) || !isInt(raw.grade)) return undefined
  const offer = isRecord(raw.offer) && isText(raw.offer.node) && isInt(raw.offer.act) && (ORDER_KINDS as readonly unknown[]).includes(raw.offer.kind) ? raw.offer : undefined
  const pending = isRecord(raw.pending) && ['skin', 'rules', 'finish'].includes(raw.pending.kind as string) && isInt(raw.pending.order) ? raw.pending : undefined
  return {
    id: raw.id, night: raw.night, tier: raw.tier as TierId, grade: raw.grade, deposit: nat(raw.deposit), feature: raw.feature === true, pure_stage: raw.pure_stage === true,
    party: Array.isArray(raw.party) ? raw.party.filter(isText) : [], companions: Array.isArray(raw.companions) ? raw.companions.filter(isText) : [], at: nat(raw.at), day: nat(raw.day),
    ...(isText(raw.map) ? { map: raw.map } : {}), ...(isInt(raw.act) ? { act: raw.act } : {}),
    ...(Array.isArray(raw.orders) ? { orders: raw.orders.map(readOrder).filter((o): o is OrderRec => !!o) } : {}),
    ...(offer ? { offer: { node: offer.node as string, act: offer.act as number, kind: offer.kind as OrderKind, name: isText(offer.name) ? offer.name : String(offer.kind), ...(isText(offer.style) ? { style: offer.style } : {}), ...(isText(offer.partner) ? { partner: offer.partner } : {}) } } : {}),
    ...(pending ? { pending: { kind: pending.kind as PendingRec['kind'], order: pending.order as number, ...(isText(pending.style) ? { style: pending.style } : {}) } } : {}),
    ...(raw.sponsor === true ? { sponsor: true } : {}), ...(isNum(raw.tips_mult) ? { tips_mult: raw.tips_mult } : {}),
    ...(isInt(raw.downed) ? { downed: raw.downed } : {}), ...(isInt(raw.over_turns) ? { over_turns: raw.over_turns } : {}),
    ...(raw.double === true ? { double: true } : {}), ...(isInt(raw.docked) ? { docked: raw.docked } : {}), ...(raw.cut === true ? { cut: true } : {}),
    ...(raw.encore_open === true ? { encore_open: true } : {}), ...(isInt(raw.encore) ? { encore: raw.encore } : {}), ...(raw.signed === true ? { signed: true } : {}),
    ...(isRecord(raw.room) && isInt(raw.room.act) && isInt(raw.room.x) ? { room: { act: raw.room.act, x: raw.room.x } } : {}),
    ...(Array.isArray(raw.booked) ? { booked: raw.booked.filter(isInt) } : {}), ...(isInt(raw.peak) ? { peak: raw.peak } : {}), ...(isInt(raw.start_heat) ? { start_heat: raw.start_heat } : {}),
    ...(isRecord(raw.over) ? { over: clone(raw.over) as unknown as SettleResult } : {}),
    ...(isRecord(raw.lost) && isInt(raw.lost.act) && isInt(raw.lost.heat) ? { lost: { act: raw.lost.act, heat: raw.lost.heat } } : {}),
    ...(isRecord(raw.lost_event) && isText(raw.lost_event.event) && isText(raw.lost_event.kind) ? { lost_event: { event: raw.lost_event.event, kind: raw.lost_event.kind, ...(isText(raw.lost_event.version) ? { version: raw.lost_event.version } : {}) } } : {}),
  }
}

function readEncore(raw: unknown): EncoreRec | undefined {
  if (!isRecord(raw) || !isText(raw.from) || !isText(raw.night) || !(TIER_IDS as readonly unknown[]).includes(raw.tier) || !isInt(raw.grade)) return undefined
  return {
    from: raw.from, night: raw.night, tier: raw.tier as TierId, grade: raw.grade, party: Array.isArray(raw.party) ? raw.party.filter(isText) : [], feature: raw.feature === true, pure_stage: raw.pure_stage === true,
    heat: isInt(raw.heat) ? raw.heat : 0, tips_mult: isNum(raw.tips_mult) ? raw.tips_mult : 1,
    ...(isInt(raw.day) ? { day: raw.day } : {}),
    ...(isRecord(raw.at) ? { at: { ...(isText(raw.at.block) ? { block: raw.at.block } : {}), ...(isText(raw.at.facility) ? { facility: raw.at.facility } : {}) } } : {}),
  }
}

function readGig(raw: unknown): GigRecord | undefined {
  if (!isRecord(raw) || !isInt(raw.start) || !isInt(raw.until)) return undefined
  const shows: Record<string, number> = {}
  if (isRecord(raw.shows)) for (const [w, n] of Object.entries(raw.shows)) if (isInt(n) && n > 0) shows[w] = n
  return { start: raw.start, until: raw.until, shows, missed: nat(raw.missed), checked: nat(raw.checked) }
}

function readFall(raw: unknown): FallRecord | undefined {
  if (!isRecord(raw) || !isInt(raw.act) || !isInt(raw.heat) || !isText(raw.run) || !isText(raw.night) || !(TIER_IDS as readonly unknown[]).includes(raw.tier) || (raw.stage !== 'replay' && raw.stage !== 'choose')) return undefined
  const rp = raw.replayed
  const replayed = isRecord(rp) && isInt(rp.fit) && ['good', 'fair', 'poor'].includes(rp.band as string) && isInt(rp.sink) && isInt(rp.kept) && isInt(rp.from) && isInt(rp.to)
    ? { fit: rp.fit, band: rp.band as 'good' | 'fair' | 'poor', sink: rp.sink, kept: rp.kept, from: rp.from, to: rp.to, ...(rp.reported === true ? { reported: true as const } : {}) } : undefined
  return {
    act: raw.act, heat: raw.heat, tips: nat(raw.tips), full: nat(raw.full), stage: raw.stage, ...(raw.called_off === true ? { called_off: true } : {}), ...(raw.started === true ? { started: true } : {}), ...(replayed ? { replayed } : {}),
    run: raw.run, night: raw.night, tier: raw.tier as TierId, deposit: nat(raw.deposit), party: Array.isArray(raw.party) ? raw.party.filter(isText) : [],
    ...(isText(raw.event) ? { event: raw.event } : {}), ...(isText(raw.version) ? { version: raw.version } : {}),
  }
}

function readTapes(raw: unknown): TapeRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((t): t is Record<string, unknown> => isRecord(t) && isText(t.id)).map((t) => ({ id: t.id as string, leaked: t.leaked === true, price: nat(t.price), ...(t.bought === true ? { bought: true } : {}) }))
}

/** 讀 state.ext.curtain：沒有、或形狀不對的部分當成沒有（回傳的是複製品，改它不會動到狀態）。 */
export function readCurtain(state: Pick<GameState, 'ext'>): CurtainState {
  const raw = state.ext[EXT]
  const r = isRecord(raw) ? raw : {}
  const member = readMember(r.member)
  const week = readWeek(r.week)
  const run = readRun(r.run)
  const encore = readEncore(r.encore)
  const tab = isRecord(r.tab) && isInt(r.tab.owed) && r.tab.owed > 0 ? { owed: r.tab.owed, since: isInt(r.tab.since) ? r.tab.since : 0 } : undefined
  const gig = readGig(r.gig)
  const fall = readFall(r.fall)
  return {
    ...(isRecord(r.invite) && isInt(r.invite.until) ? { invite: { until: r.invite.until } } : {}),
    ...(member ? { member } : {}),
    taste: Array.isArray(r.taste) ? [...new Set(r.taste.filter(isText))] : [],
    ...(isInt(r.interview_at) ? { interview_at: r.interview_at } : {}),
    ...(week ? { week } : {}),
    ...(run ? { run } : {}),
    ...(encore ? { encore } : {}),
    ...(tab ? { tab } : {}),
    ...(gig ? { gig } : {}),
    ...(fall ? { fall } : {}),
    tapes: readTapes(r.tapes),
  }
}

/** 寫狀態的變更（整筆換掉）。 */
export const curtainChange = (c: CurtainState): Change => ({ op: 'ext', key: EXT, value: clone(c) as unknown as Record<string, unknown> })

// ---- 時間與週 ----

export const nowOf = (state: Pick<GameState, 'time'>): number => toMinutes(state.time)

/** 現在是第幾週（照週一 06:00 算；和 features/bills 的週數同一個算法）。 */
export function weekIndexOf(k: Pick<Kernel, 'timeRules'>, minutes: number): number {
  const rule = weeklyRule(k.timeRules)
  return Math.floor((minutes - rule.offset) / rule.every) + 1
}

/** 第幾週的週一 06:00（總分鐘）。 */
export function mondayOf(k: Pick<Kernel, 'timeRules'>, week: number): number {
  const rule = weeklyRule(k.timeRules)
  return rule.offset + (week - 1) * rule.every
}

export const weekMinutes = (k: Pick<Kernel, 'timeRules'>): number => weeklyRule(k.timeRules).every

export const nameOfActor = (state: Pick<GameState, 'actors'>, id: ActorId): string => state.actors[id]?.name ?? id
