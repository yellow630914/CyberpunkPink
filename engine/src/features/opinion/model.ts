// L6 功能 opinion 的資料與純函式：格子、規則（內建的預設加資料蓋掉）、七種內容種類的預設與檢查、戰役的狀態形狀與讀取。
// 規格：OPINION 第 3、4、5 節；DATA 6.3、9.1；ENEMIES 1.5；dev/adr/0020 第五節、V31～V34、V39；dev/work/M5-opinion.md。
//
// 內容種類（全部在這個檔登記，entries 的檢查也在這裡）：
//   opinion_rule  規則表（overridable，id: default）：DEFAULT_OPINION_RULES
//   topic_kind    議題類型（overridable）：五種開場（ignite、smear、douse、whitewash、frame）＋四列預設的分數（preset_*）：DEFAULT_TOPIC_KINDS
//   topic         議題（內容，不匯入）：{ id, name, kind, rounds?, scores, involves, grade?, target_cell?, your_start?, category? }
//   pr_opponent   對手（內容，不匯入）：DATA 6.3
//   pr_action     對手的九個行動（overridable）：DEFAULT_PR_ACTIONS
//   opinion_card  牌（overridable；預設基本牌九張加水軍、內幕）：DEFAULT_CARDS
//   city_card     城市事件（overridable；六張）：DEFAULT_CITY_CARDS
// 格子的 id 照 V31；`murmur` 是 `whisper` 的別名（載入時照收，warnings 提醒；讀的時候一律轉成 whisper）。
//
// 狀態 state.ext.opinion.war（形狀見 War）。只經由變更 opinion.war 寫（整份換；一份報告一個戰役，不會疊）。

import type { GameState, Kernel, Origin } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { ContentEntry } from '../../core'
import { parseWhen } from './when'

export const OWNER = 'opinion'
export const EXT = 'opinion'
export const ACTIVITY = 'opinion'
export const WAR_OP = 'opinion.war'

export const RULE_KIND = 'opinion_rule'
export const TOPIC_KIND_KIND = 'topic_kind'
export const TOPIC_KIND = 'topic'
export const OPPONENT_KIND = 'pr_opponent'
export const ACTION_KIND = 'pr_action'
export const CARD_KIND = 'opinion_card'
export const CITY_KIND = 'city_card'

export const START_ACTION = 'opinion.start'
export const PLAY_ACTION = 'opinion.play'
export const CAPTURE_ACTION = 'opinion.capture'
export const TURN_ACTION = 'opinion.turn'
export const CONCEDE_ACTION = 'opinion.concede'
export const BRIBE_ACTION = 'opinion.bribe'
export const END_ACTION = 'opinion.end'

export const BUSY_REASON = '輿論戰進行中，要先打完（或認輸）。'

// ---- 格子 ----

export const CELLS = ['doujin', 'tape', 'fanclub', 'sakura', 'kaleido', 'nightingale', 'wall', 'whisper', 'relay'] as const
export type Cell = (typeof CELLS)[number]
export const CELL_NAME: Record<Cell, string> = {
  doujin: '同人圈', tape: '帶子街', fanclub: '應援圈', sakura: '緋櫻映畫', kaleido: '萬華鏡', nightingale: '夜鶯直播', wall: '牆報', whisper: '街上的耳語', relay: '地下轉播站',
}
export const ROWS = ['circle', 'main', 'street'] as const
export type Row = (typeof ROWS)[number]
export const ROW_NAME: Record<Row, string> = { circle: '圈子', main: '主流', street: '街頭' }
export const SLOTS = ['清晨', '上午', '中午', '下午', '黃金時段', '深夜'] as const
export const CENTER: Cell = 'kaleido'

export const isCell = (v: unknown): v is Cell => typeof v === 'string' && (CELLS as readonly string[]).includes(v)
/** 載入時的別名：murmur 就是 whisper（V31）。不認得的字原樣還回去。 */
export const cellKey = (v: string): string => (v === 'murmur' ? 'whisper' : v)
export const isCellKey = (v: unknown): boolean => typeof v === 'string' && isCell(cellKey(v))
export const rowOf = (c: Cell): Row => ROWS[Math.floor(CELLS.indexOf(c) / 3)]!
const idx = (c: Cell): number => CELLS.indexOf(c)

/** 上下左右相鄰（斜的不算）。 */
export function neighbors(c: Cell): Cell[] {
  const i = idx(c)
  const out: number[] = []
  if (i >= 3) out.push(i - 3)
  if (i < 6) out.push(i + 3)
  if (i % 3 > 0) out.push(i - 1)
  if (i % 3 < 2) out.push(i + 1)
  return out.sort((a, b) => a - b).map((j) => CELLS[j]!)
}
export const adjacent = (a: Cell, b: Cell): boolean => neighbors(a).includes(b)
/** 對面：以中央為中心對角（牆報對應援圈、街上的耳語對帶子街、地下轉播站對同人圈）。 */
export const oppositeOf = (c: Cell): Cell => CELLS[8 - idx(c)]!
export const STREET: Cell[] = ['wall', 'whisper', 'relay']
export const MAIN: Cell[] = ['sakura', 'kaleido', 'nightingale']
export const cellsOfRow = (r: Row): Cell[] => CELLS.filter((c) => rowOf(c) === r)

/** 把「格子 → 值」的物件轉成標準的格子鍵（murmur → whisper）；不認得的鍵丟掉。 */
export function normalizeCellMap<T>(raw: unknown): Partial<Record<Cell, T>> {
  const out: Partial<Record<Cell, T>> = {}
  if (!isRecord(raw)) return out
  for (const [key, v] of Object.entries(raw)) {
    const c = cellKey(key)
    if (isCell(c) && !(c === 'whisper' && key === 'murmur' && Object.hasOwn(raw, 'whisper'))) out[c] = v as T
  }
  return out
}

// ---- 規則 ----

export interface OpinionRules {
  /** 一場幾回合；短的議題（rounds 寫 4）自己寫 */
  rounds: number
  short_rounds: number
  /** 開場的手牌 */
  open_hand: number
  /** 每回合抽幾張 */
  draw: number
  hand_max: number
  /** 任何人每回合的編輯點 */
  ep_base: number
  /** 沒人的格子的防守、對手的格子的防守的底（3 ∓ 風向） */
  empty_def: number
  foe_def_base: number
  /** 聲量的範圍、風向的範圍 */
  voice_max: number
  wind_max: number
  /** 大勝的分數差 */
  big_gap: number
  /** 料牌照戰役等級（1～5）加的聲量（III、IV +1，V +2） */
  grade_fuel: number[]
  /** 公信力：說法牌 60 以上每張 +1，低於 30 每張 −1（最少 0） */
  line_cred: { high: number; low: number }
  /** 水軍：聲量、d20 幾以下被拆穿、風向、公信力；假料：d20 幾以下、風向、公信力 */
  army: { voice: number; risk: number; wind: number; cred: number }
  fake: { risk: number; wind: number; cred: number }
  /** 降流與轉移焦點的聲量 */
  mute: number
  shift: number
  /** 對手一回合最多掃幾輪行動表（V39） */
  sweeps: number
  /** 難度對對手公關點的加減（BALANCE 7.2；公關點最少 1） */
  pr_by_difficulty: Record<string, number>
}

export const DEFAULT_OPINION_RULES: OpinionRules = {
  rounds: 6, short_rounds: 4, open_hand: 3, draw: 2, hand_max: 5, ep_base: 2, empty_def: 2, foe_def_base: 3, voice_max: 10, wind_max: 5, big_gap: 4,
  grade_fuel: [0, 0, 1, 1, 2], line_cred: { high: 60, low: 30 },
  army: { voice: 3, risk: 5, wind: 1, cred: 3 }, fake: { risk: 6, wind: 2, cred: 8 }, mute: 2, shift: 2, sweeps: 3,
  pr_by_difficulty: { story: -1, easy: -1, normal: 0, hard: 1, legend: 2, custom: 0 },
}

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const intIn = (v: unknown, lo: number, hi: number): v is number => isSafeInt(v) && v >= lo && v <= hi
const gradeList = (v: unknown): v is number[] => Array.isArray(v) && v.length === 5 && v.every((n) => intIn(n, -20, 20))

const INT_RULES = [['rounds', 1, 12], ['short_rounds', 1, 12], ['open_hand', 0, 10], ['draw', 0, 10], ['hand_max', 1, 10], ['ep_base', 0, 10], ['empty_def', 0, 10], ['foe_def_base', 0, 10], ['voice_max', 1, 30], ['wind_max', 1, 20], ['big_gap', 1, 50], ['mute', 0, 10], ['shift', 0, 10], ['sweeps', 1, 10]] as const

export function ruleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  for (const [key, lo, hi] of INT_RULES) if (e[key] !== undefined && !intIn(e[key], lo, hi)) p.push(`${key} 要是 ${lo}～${hi} 的整數`)
  if (e.grade_fuel !== undefined && !gradeList(e.grade_fuel)) p.push('grade_fuel 要是五個整數（戰役等級 I～V 各加多少）')
  if (e.line_cred !== undefined) {
    if (!isRecord(e.line_cred)) p.push('line_cred 要是 { high, low }')
    else for (const f of ['high', 'low']) if (e.line_cred[f] !== undefined && !intIn(e.line_cred[f], 0, 100)) p.push(`line_cred.${f} 要是 0～100 的整數`)
  }
  for (const [key, fields] of [['army', ['voice', 'risk', 'wind', 'cred']], ['fake', ['risk', 'wind', 'cred']]] as const) {
    const v = e[key]
    if (v === undefined) continue
    if (!isRecord(v)) p.push(`${key} 要是 { ${fields.join(', ')} }`)
    else for (const f of fields) if (v[f] !== undefined && !intIn(v[f], 0, 20)) p.push(`${key}.${f} 要是 0～20 的整數`)
  }
  if (e.pr_by_difficulty !== undefined) {
    if (!isRecord(e.pr_by_difficulty)) p.push('pr_by_difficulty 要是「難度 → 加減」')
    else for (const [d, n] of Object.entries(e.pr_by_difficulty)) if (!intIn(n, -6, 6)) p.push(`pr_by_difficulty.${d} 要是 −6～6 的整數`)
  }
  return p
}

/** 現在生效的規則：資料 opinion_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function opinionRules(k: Pick<Kernel, 'content'>): OpinionRules {
  const d = DEFAULT_OPINION_RULES
  const out: OpinionRules = { ...d, grade_fuel: [...d.grade_fuel], line_cred: { ...d.line_cred }, army: { ...d.army }, fake: { ...d.fake }, pr_by_difficulty: { ...d.pr_by_difficulty } }
  const e = k.content.hasKind(RULE_KIND) ? k.content.get<ContentEntry & Record<string, unknown>>(RULE_KIND, 'default') : undefined
  if (!e) return out
  for (const [key, lo, hi] of INT_RULES) if (intIn(e[key], lo, hi)) out[key] = e[key]
  if (gradeList(e.grade_fuel)) out.grade_fuel = [...e.grade_fuel]
  if (isRecord(e.line_cred)) for (const f of ['high', 'low'] as const) if (intIn(e.line_cred[f], 0, 100)) out.line_cred[f] = e.line_cred[f] as number
  for (const [key, fields] of [['army', ['voice', 'risk', 'wind', 'cred']], ['fake', ['risk', 'wind', 'cred']]] as const) {
    const v = e[key]
    if (isRecord(v)) for (const f of fields) if (intIn(v[f], 0, 20)) (out[key] as unknown as Record<string, number>)[f] = v[f] as number
  }
  if (isRecord(e.pr_by_difficulty)) for (const [dif, n] of Object.entries(e.pr_by_difficulty)) if (intIn(n, -6, 6) && dif !== '__proto__') out.pr_by_difficulty[dif] = n
  return out
}

// ---- 議題類型（topic_kind） ----

export const KIND_IDS = ['ignite', 'smear', 'douse', 'whitewash', 'frame'] as const
export type KindId = (typeof KIND_IDS)[number]
export const LAYOUTS = ['street', 'main_two', 'whitewash'] as const
export type Layout = (typeof LAYOUTS)[number]

export interface TopicKindEntry extends ContentEntry {
  /** 有 layout 的是一種議題類型；有 scores 的是預設的分數表（兩者擇一） */
  layout?: Layout
  side?: 'attack' | 'defend'
  /** 開場的風向（洗白 −3） */
  wind?: number
  /** 這一類的議題要指定一格（嫁禍） */
  needs_target?: boolean
  name?: string
  scores?: Record<string, number>
}

export const DEFAULT_TOPIC_KINDS: TopicKindEntry[] = [
  { id: 'ignite', name: '引爆', side: 'attack', layout: 'street', wind: 0 },
  { id: 'smear', name: '抹黑', side: 'attack', layout: 'street', wind: 0 },
  { id: 'douse', name: '滅火', side: 'defend', layout: 'main_two', wind: 0 },
  { id: 'whitewash', name: '洗白', side: 'defend', layout: 'whitewash', wind: -3 },
  { id: 'frame', name: '嫁禍', side: 'attack', layout: 'street', wind: 0, needs_target: true },
  // OPINION 3.2 的四個例子（一般的輿論戰沒給分數時，從這四列隨機挑一列）
  { id: 'preset_mass', name: '大眾議題（企業醜聞）', scores: { kaleido: 3, sakura: 2, nightingale: 1, tape: 1, doujin: 1, fanclub: 1, whisper: 1, wall: 1, relay: 0 } },
  { id: 'preset_niche', name: '小眾議題（同人社團的糾紛）', scores: { kaleido: 0, sakura: 0, nightingale: 2, tape: 1, doujin: 3, fanclub: 2, whisper: 1, wall: 1, relay: 1 } },
  { id: 'preset_street', name: '街頭的事（幫派的地盤）', scores: { kaleido: 0, sakura: 1, nightingale: 0, tape: 2, doujin: 0, fanclub: 0, whisper: 3, wall: 2, relay: 2 } },
  { id: 'preset_idol', name: '偶像的醜聞', scores: { kaleido: 2, sakura: 1, nightingale: 2, tape: 1, doujin: 2, fanclub: 3, whisper: 0, wall: 1, relay: 0 } },
]

export function scoresProblems(v: unknown, at: string): string[] {
  if (!isRecord(v)) return [`${at} 要是「格子 → 分數」`]
  const p: string[] = []
  for (const [key, n] of Object.entries(v)) {
    if (!isCellKey(key)) p.push(`${at}.${key} 不是格子的 id（${CELLS.join('、')}）`)
    else if (!intIn(n, 0, 3)) p.push(`${at}.${key} 要是 0～3 的整數`)
  }
  return p
}

export function topicKindProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  const hasLayout = e.layout !== undefined
  const hasScores = e.scores !== undefined
  if (hasLayout === hasScores) return ['要寫 layout（議題類型）或 scores（預設的分數），兩者擇一']
  if (hasLayout) {
    if (!(KIND_IDS as readonly unknown[]).includes(e.id)) p.push(`議題類型的 id 要是 ${KIND_IDS.join('、')} 之一`)
    if (!(LAYOUTS as readonly unknown[]).includes(e.layout)) p.push(`layout 要是 ${LAYOUTS.join('、')} 之一`)
    if (e.side !== 'attack' && e.side !== 'defend') p.push('side 要是 attack 或 defend')
    if (e.wind !== undefined && !intIn(e.wind, -5, 5)) p.push('wind 要是 −5～5 的整數')
    if (e.needs_target !== undefined && typeof e.needs_target !== 'boolean') p.push('needs_target 要是 true 或 false')
  } else p.push(...scoresProblems(e.scores, 'scores'))
  if (e.name !== undefined && !isText(e.name)) p.push('name 要是一句話')
  return p
}

// ---- 議題（topic） ----

export interface TopicEntry extends ContentEntry {
  name: string
  kind: KindId
  rounds?: number
  scores: Record<string, number>
  involves: { factions: string[]; people: string[]; types: string[] }
  grade?: number
  target_cell?: string
  your_start?: string
  category?: string
}

const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

export function topicProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是議題的名字')
  if (!(KIND_IDS as readonly unknown[]).includes(e.kind)) p.push(`kind 要是 ${KIND_IDS.join('、')} 之一`)
  if (e.rounds !== undefined && !intIn(e.rounds, 1, 12)) p.push('rounds 要是 1～12 的整數')
  p.push(...scoresProblems(e.scores, 'scores'))
  if (!isRecord(e.involves)) p.push('involves 要是 { factions, people, types }')
  else for (const f of ['factions', 'people', 'types']) if (!strList(e.involves[f])) p.push(`involves.${f} 要是字串的陣列`)
  if (e.grade !== undefined && !intIn(e.grade, 1, 5)) p.push('grade 要是 1～5 的整數')
  if (e.target_cell !== undefined && !isCellKey(e.target_cell)) p.push(`target_cell 要是格子的 id（${CELLS.join('、')}）`)
  if (e.kind === 'frame' && e.target_cell === undefined) p.push('嫁禍（frame）要指定一格（target_cell）')
  if (e.your_start !== undefined && !isCellKey(e.your_start)) p.push(`your_start 要是格子的 id（${CELLS.join('、')}）`)
  if (e.category !== undefined && !isText(e.category)) p.push('category 要是題材的名字')
  return p
}

// ---- 對手的行動（pr_action） ----

export const ACTION_IDS = ['release', 'deny', 'mute', 'counter', 'lawyer', 'takedown', 'chase', 'bribe', 'visit'] as const
export type ActionId = (typeof ACTION_IDS)[number]
/** 掃行動表時會用的七個（收買與找上門是每場一次的，寫在 once） */
export const SWEEP_IDS: ActionId[] = ['release', 'deny', 'mute', 'counter', 'lawyer', 'takedown', 'chase']

export interface PrActionEntry extends ContentEntry {
  name?: string
  /** 公關點 */
  cost: number
  /** 效果的量：一個數字，或戰役等級 I～V 各一個（發稿 +2／+3、否認與反爆料的風向 1／2、2／3；ENEMIES 1.5） */
  amount?: number | number[]
  /** 每回合或每場最多幾次（沒寫就沒有限制，只受掃的輪數限制） */
  limit?: { per: 'turn' | 'war'; n: number }
  /** 強度到幾以上才能用（追擊只有強度 3） */
  min_strength?: number
}

export const DEFAULT_PR_ACTIONS: PrActionEntry[] = [
  { id: 'release', name: '發稿', cost: 1, amount: [2, 2, 3, 3, 3] },
  { id: 'deny', name: '否認', cost: 1, amount: [1, 1, 1, 1, 2] },
  { id: 'mute', name: '降流', cost: 1, amount: 2, limit: { per: 'turn', n: 1 } },
  { id: 'counter', name: '反爆料', cost: 2, amount: [2, 2, 2, 2, 3] },
  { id: 'lawyer', name: '律師函', cost: 2, amount: 1, limit: { per: 'turn', n: 1 } },
  { id: 'takedown', name: '下架', cost: 2, amount: 1, limit: { per: 'turn', n: 1 } },
  { id: 'chase', name: '追擊', cost: 2, amount: 1, limit: { per: 'turn', n: 1 }, min_strength: 3 },
  { id: 'bribe', name: '收買', cost: 0, limit: { per: 'war', n: 1 } },
  { id: 'visit', name: '找上門', cost: 0, limit: { per: 'war', n: 1 } },
]

export function actionProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!(ACTION_IDS as readonly unknown[]).includes(e.id)) p.push(`id 要是 ${ACTION_IDS.join('、')} 之一`)
  if (!intIn(e.cost, 0, 10)) p.push('cost 要是 0～10 的整數（公關點）')
  if (e.amount !== undefined && !(intIn(e.amount, 0, 20) || gradeList(e.amount))) p.push('amount 要是 0～20 的整數，或五個整數（戰役等級 I～V 各一個）')
  if (e.limit !== undefined) {
    if (!isRecord(e.limit) || (e.limit.per !== 'turn' && e.limit.per !== 'war') || !intIn(e.limit.n, 1, 10)) p.push('limit 要是 { per: turn 或 war, n: 1～10 }')
  }
  if (e.min_strength !== undefined && !intIn(e.min_strength, 1, 3)) p.push('min_strength 要是 1～3 的整數')
  if (e.name !== undefined && !isText(e.name)) p.push('name 要是一句話')
  return p
}

// ---- 牌（opinion_card） ----

export const MEANS = ['guard', 'mute', 'army', 'shift'] as const
export type Means = (typeof MEANS)[number]
export const CARD_TYPES = ['fuel', 'line', 'means'] as const
export type CardType = (typeof CARD_TYPES)[number]

export interface CardFields {
  name: string
  kind: CardType
  cost: number
  /** 料：聲量 */
  voice?: number
  /** 說法：風向（正的偏你） */
  wind?: number
  means?: Means
  /** 內幕：不能被下架 */
  inside?: boolean
  /** 假料：打出去擲 d20，被拆穿就無效、風向與公信力反噬 */
  fake?: boolean
}

export interface CardEntry extends ContentEntry, CardFields {
  /** 基本牌：牌庫裡放幾張 */
  basic?: number
}

export const DEFAULT_CARDS: CardEntry[] = [
  { id: 'card_interview', name: '採訪', kind: 'fuel', cost: 1, voice: 2, basic: 3 },
  { id: 'card_boost', name: '加碼', kind: 'fuel', cost: 2, voice: 3, basic: 1 },
  { id: 'card_wind', name: '帶風向', kind: 'line', cost: 1, wind: 1, basic: 2 },
  { id: 'card_guard', name: '設防', kind: 'means', cost: 1, means: 'guard', basic: 1 },
  { id: 'card_mute', name: '降流', kind: 'means', cost: 1, means: 'mute', basic: 1 },
  { id: 'card_shift', name: '轉移焦點', kind: 'means', cost: 1, means: 'shift', basic: 1 },
  { id: 'card_army', name: '水軍', kind: 'means', cost: 1, means: 'army' },
  { id: 'card_inside_scoop', name: '內幕', kind: 'fuel', cost: 2, voice: 4, inside: true },
]

export function cardProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是牌名')
  if (!(CARD_TYPES as readonly unknown[]).includes(e.kind)) p.push(`kind 要是 ${CARD_TYPES.join('、')} 之一`)
  if (!intIn(e.cost, 0, 5)) p.push('cost 要是 0～5 的整數（編輯點）')
  if (e.voice !== undefined && !intIn(e.voice, 0, 10)) p.push('voice 要是 0～10 的整數')
  if (e.wind !== undefined && !intIn(e.wind, -2, 2)) p.push('wind 要是 −2～2 的整數')
  if (e.kind === 'fuel' && !intIn(e.voice, 1, 10)) p.push('料牌（fuel）要寫 voice（1～10）')
  if (e.kind === 'line' && !(intIn(e.wind, -2, 2) && e.wind !== 0)) p.push('說法牌（line）要寫 wind（±1～2）')
  if (e.kind === 'means' && !(MEANS as readonly unknown[]).includes(e.means)) p.push(`手段牌（means）要寫 means（${MEANS.join('、')}）`)
  if (e.kind !== 'means' && e.means !== undefined) p.push('means 只有手段牌（kind: means）寫')
  if (e.basic !== undefined && !intIn(e.basic, 0, 9)) p.push('basic 要是 0～9 的整數（牌庫裡放幾張）')
  for (const f of ['inside', 'fake']) if (e[f] !== undefined && typeof e[f] !== 'boolean') p.push(`${f} 要是 true 或 false`)
  return p
}

// ---- 城市事件（city_card） ----

export type CityEffect =
  | { kind: 'voice'; you: number; foe: number }
  | { kind: 'def_row'; row: Row; amount: number }
  | { kind: 'lock'; cells?: Cell[]; row?: Row }
  | { kind: 'score'; cell: Cell; amount: number }
  | { kind: 'none' }

export interface CityEntry extends ContentEntry {
  name: string
  effect: CityEffect
  /** 給玩家看的一句話（沒寫就用內建的） */
  text?: string
}

export const DEFAULT_CITY_CARDS: CityEntry[] = [
  { id: 'city_scandal', name: '另一樁醜聞爆出來', effect: { kind: 'voice', you: -2, foe: -2 } },
  { id: 'city_festival', name: '祭典組封街', effect: { kind: 'def_row', row: 'street', amount: 1 } },
  { id: 'city_algo', name: '萬華鏡換了演算法', effect: { kind: 'lock', cells: ['kaleido'] } },
  { id: 'city_graduation', name: '偶像的畢業公演', effect: { kind: 'score', cell: 'fanclub', amount: 1 } },
  { id: 'city_blackout', name: '停電', effect: { kind: 'lock', row: 'main' } },
  { id: 'city_quiet', name: '平靜的一個時段', effect: { kind: 'none' } },
]

export function cityProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是事件的名字')
  const f = e.effect
  if (!isRecord(f)) return [...p, 'effect 要是 { kind, … }']
  switch (f.kind) {
    case 'voice':
      for (const w of ['you', 'foe']) if (!intIn(f[w], -10, 10)) p.push(`effect.${w} 要是 −10～10 的整數`)
      break
    case 'def_row':
      if (!(ROWS as readonly unknown[]).includes(f.row)) p.push(`effect.row 要是 ${ROWS.join('、')} 之一`)
      if (!intIn(f.amount, -3, 3)) p.push('effect.amount 要是 −3～3 的整數')
      break
    case 'lock':
      if (f.cells === undefined && f.row === undefined) p.push('effect 要寫 cells 或 row（這回合不能被佔的格子）')
      if (f.cells !== undefined && !(Array.isArray(f.cells) && f.cells.every(isCell))) p.push(`effect.cells 要是格子 id 的陣列（${CELLS.join('、')}）`)
      if (f.row !== undefined && !(ROWS as readonly unknown[]).includes(f.row)) p.push(`effect.row 要是 ${ROWS.join('、')} 之一`)
      break
    case 'score':
      if (!isCell(f.cell)) p.push(`effect.cell 要是格子的 id（${CELLS.join('、')}）`)
      if (!intIn(f.amount, 1, 3)) p.push('effect.amount 要是 1～3 的整數')
      break
    case 'none': break
    default: p.push('effect.kind 要是 voice、def_row、lock、score、none 之一')
  }
  if (e.text !== undefined && !isText(e.text)) p.push('text 要是一句話')
  return p
}

// ---- 對手（pr_opponent） ----

export interface ActionRule { do: ActionId; when: string }
export interface OnceRule { do: 'bribe' | 'visit'; when: string; offer_per_grade?: number; squad?: string }
export type SignatureEffect = {
  /** 某個行動的花費改成幾點 */
  cost?: Partial<Record<ActionId, number>>
  /** 律師函多扣幾點（取代預設的 1） */
  lawyer_ep?: number
  /** 你的公信力低於這個數時，你的說法牌減半 */
  weak_line?: { cred_below: number }
  /** 它搶這幾格的時候防守 −amount */
  def_minus?: { cells: Cell[]; amount?: number }
  /** 收買可以用幾次 */
  bribe_times?: number
}
export interface Signature { id: string; text: string; effect: SignatureEffect }

export interface OpponentEntry extends ContentEntry {
  name: string
  faction?: string
  strength: number
  start: 'opposite' | 'center'
  cell_priority: Record<string, number>
  actions: ActionRule[]
  signature?: Signature
  once?: OnceRule[]
  mimic?: { open: [number, number] }
  capture?: boolean
  desc?: string
}

const SIGNATURE_KEYS = ['cost', 'lawyer_ep', 'weak_line', 'def_minus', 'bribe_times']

function signatureProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['signature 要是 { id, text, effect }']
  const p: string[] = []
  if (!isText(v.id)) p.push('signature.id 要是招式的 id')
  if (!isText(v.text)) p.push('signature.text 要是一句話')
  const e = v.effect
  if (!isRecord(e)) return [...p, 'signature.effect 要是封閉的效果物件']
  for (const key of Object.keys(e)) if (!SIGNATURE_KEYS.includes(key)) p.push(`signature.effect.${key} 不在封閉的清單裡（${SIGNATURE_KEYS.join('、')}）`)
  if (e.cost !== undefined) {
    if (!isRecord(e.cost)) p.push('signature.effect.cost 要是「行動 → 公關點」')
    else for (const [a, n] of Object.entries(e.cost)) if (!(ACTION_IDS as readonly unknown[]).includes(a) || !intIn(n, 0, 10)) p.push(`signature.effect.cost.${a} 要是行動的 id 配 0～10 的整數`)
  }
  if (e.lawyer_ep !== undefined && !intIn(e.lawyer_ep, 1, 6)) p.push('signature.effect.lawyer_ep 要是 1～6 的整數')
  if (e.weak_line !== undefined && !(isRecord(e.weak_line) && intIn(e.weak_line.cred_below, 1, 100))) p.push('signature.effect.weak_line 要是 { cred_below: 1～100 }')
  if (e.def_minus !== undefined) {
    const d = e.def_minus
    if (!isRecord(d) || !Array.isArray(d.cells) || d.cells.length === 0 || !d.cells.every(isCellKey) || (d.amount !== undefined && !intIn(d.amount, 1, 3))) p.push('signature.effect.def_minus 要是 { cells: 格子的 id, amount?: 1～3 }')
  }
  if (e.bribe_times !== undefined && !intIn(e.bribe_times, 1, 3)) p.push('signature.effect.bribe_times 要是 1～3 的整數')
  return p
}

function whenProblem(v: unknown, at: string): string | null {
  if (typeof v !== 'string') return `${at}.when 要是條件的字串`
  const r = parseWhen(v)
  return r.ok ? null : `${at}.when「${v}」寫錯了：${r.error}`
}

export function opponentProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('name 要是對手的名字')
  if (e.faction !== undefined && !isText(e.faction)) p.push('faction 要是勢力的 id')
  if (!intIn(e.strength, 1, 3)) p.push('strength 要是 1～3 的整數')
  if (e.start !== 'opposite' && e.start !== 'center') p.push('start 要是 opposite 或 center')
  if (!isRecord(e.cell_priority)) p.push('cell_priority 要是「格子 → 權重」')
  else {
    for (const [key, n] of Object.entries(e.cell_priority)) {
      if (!isCellKey(key)) p.push(`cell_priority.${key} 不是格子的 id（${CELLS.join('、')}）`)
      else if (!(typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20)) p.push(`cell_priority.${key} 要是 0～20 的數字`)
    }
  }
  if (!Array.isArray(e.actions) || e.actions.length === 0) p.push('actions 要是行動的陣列（由上往下，每個 { do, when }）')
  else {
    e.actions.forEach((a, i) => {
      const at = `actions[${i}]`
      if (!isRecord(a)) return void p.push(`${at} 要是 { do, when }`)
      if (!(SWEEP_IDS as readonly unknown[]).includes(a.do)) p.push(`${at}.do 要是 ${SWEEP_IDS.join('、')} 之一（收買與找上門寫在 once）`)
      const w = whenProblem(a.when, at)
      if (w) p.push(w)
    })
  }
  if (e.signature !== undefined) p.push(...signatureProblems(e.signature))
  if (e.once !== undefined) {
    if (!Array.isArray(e.once)) p.push('once 要是每場一次的行動的陣列')
    else {
      e.once.forEach((a, i) => {
        const at = `once[${i}]`
        if (!isRecord(a)) return void p.push(`${at} 要是 { do, when, … }`)
        if (a.do !== 'bribe' && a.do !== 'visit') p.push(`${at}.do 要是 bribe 或 visit`)
        const w = whenProblem(a.when, at)
        if (w) p.push(w)
        if (a.offer_per_grade !== undefined && !intIn(a.offer_per_grade, 0, 1_000_000)) p.push(`${at}.offer_per_grade 要是 0 以上的整數（一個等級的價錢）`)
        if (a.do === 'bribe' && a.offer_per_grade === undefined) p.push(`${at}（收買）要寫 offer_per_grade`)
        if (a.squad !== undefined && !isText(a.squad)) p.push(`${at}.squad 要是敵人小隊的 id`)
      })
    }
  }
  if (e.mimic !== undefined) {
    const m = e.mimic
    if (!isRecord(m) || !Array.isArray(m.open) || m.open.length !== 2 || !intIn(m.open[0], 1, 9) || !intIn(m.open[1], 1, 9) || (m.open[0] as number) > (m.open[1] as number)) p.push('mimic 要是 { open: [最少, 最多] }（1～9，最少不大於最多）')
  }
  if (e.capture !== undefined && typeof e.capture !== 'boolean') p.push('capture 要是 true 或 false')
  return p
}

// ---- 讀內容（預設加資料蓋掉） ----

function merged<T extends ContentEntry>(k: Pick<Kernel, 'content'>, kind: string, defaults: readonly T[]): T[] {
  const out = new Map<string, T>(defaults.map((d) => [d.id, d]))
  if (k.content.hasKind(kind)) for (const e of k.content.list<T>(kind)) out.set(e.id, e)
  return [...out.values()]
}

export const topicKinds = (k: Pick<Kernel, 'content'>): TopicKindEntry[] => merged(k, TOPIC_KIND_KIND, DEFAULT_TOPIC_KINDS)
export const prActions = (k: Pick<Kernel, 'content'>): PrActionEntry[] => merged(k, ACTION_KIND, DEFAULT_PR_ACTIONS)
export const cardCatalog = (k: Pick<Kernel, 'content'>): CardEntry[] => merged(k, CARD_KIND, DEFAULT_CARDS)
export const cityCatalog = (k: Pick<Kernel, 'content'>): CityEntry[] => merged(k, CITY_KIND, DEFAULT_CITY_CARDS)

// ---- 戰役的狀態 ----

export type Who = 'you' | 'foe'

export interface WarCell {
  owner: Who | null
  /** 設防到第幾回合（那一回合對手搶不了） */
  guard?: number
}

export interface Seat {
  actor: string
  ep: number
  ep_max: number
}

export interface WarTopic {
  id: string
  name: string
  kind: KindId
  side: 'attack' | 'defend'
  scores: Record<Cell, number>
  involves: { factions: string[]; people: string[]; types: string[] }
  target_cell?: Cell
  category?: string
}

export interface WarFoe {
  id: string
  name: string
  faction?: string
  strength: number
  start: 'opposite' | 'center'
  cell_priority: Record<Cell, number>
  actions: ActionRule[]
  signature?: Signature
  once: OnceRule[]
  mimic?: { open: [number, number] }
  capture?: boolean
}

/** 這一場才有的牌（素材與片變成的牌放這裡；目錄裡的牌只存 id）。 */
export type WarCard = CardFields & { id: string }

export type Outcome = 'major' | 'minor' | 'draw' | 'lost'
export const OUTCOMES: Outcome[] = ['major', 'minor', 'draw', 'lost']
export type EndBy = 'rounds' | 'wipe' | 'concede' | 'bribe' | 'visit'

export interface WarResult {
  outcome: Outcome
  by: EndBy
  you: number
  foe: number
  /** 嫁禍：指定的那一格有沒有佔著（沒有指定是 null） */
  target_held: boolean | null
  /** 收買：接受的價錢 */
  bribed?: number
}

export interface War {
  id: string
  mode: 'solo' | 'face'
  topic: WarTopic
  foe: WarFoe
  grade: number
  round: number
  rounds: number
  turn: 'you' | 'ended'
  cells: Record<Cell, WarCell>
  voice: { you: number; foe: number }
  wind: number
  desk: Seat[]
  deck: string[]
  hand: string[]
  discard: string[]
  /** 這回合佔了幾次、能佔幾次 */
  captured: number
  captures: number
  /** 用過幾次的計數：turn:<鍵> 每回合清掉，war:<鍵> 整場 */
  used: Record<string, number>
  city?: string
  /** 這一回合的城市事件的效果（存起來：內容之後怎麼改，這一場照原樣） */
  city_fx?: CityEffect
  /** 這一場某一格的分數加成（偶像的畢業公演） */
  bonus: Partial<Record<Cell, number>>
  foe_state: { bribes: number; visited: boolean; ep_penalty?: number; open?: string[]; last?: string[] }
  pending?: 'bribe' | 'visit' | 'lost'
  /** 收買的價錢（pending 是 bribe 時） */
  offer?: number
  custom?: Record<string, WarCard>
  origin: Origin
  result?: WarResult
}

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 讀 state.ext.opinion.war。沒有、或形狀不對回 null（唯讀；回傳的是狀態裡那一份，不要改它——要改先 clone）。 */
export function readWar(state: Pick<GameState, 'ext'>): War | null {
  const raw = state.ext?.[EXT]
  if (!isRecord(raw) || !isRecord(raw.war)) return null
  return raw.war as unknown as War
}

/** state.ext.opinion 整份的新值（換上這一場、或清掉）。 */
export const extValue = (war: War | null): { war: War | null } => ({ war })

export function warProblems(w: unknown): string[] {
  if (w === null) return []
  if (!isRecord(w)) return ['war 要是一場戰役或 null']
  const p: string[] = []
  if (!isText(w.id)) p.push('id 要是字串')
  if (w.mode !== 'solo' && w.mode !== 'face') p.push('mode 要是 solo 或 face')
  if (!isRecord(w.topic) || !isRecord(w.foe)) p.push('topic 與 foe 要是物件')
  if (!intIn(w.round, 1, 99) || !intIn(w.rounds, 1, 99)) p.push('round 與 rounds 要是正整數')
  else if ((w.round as number) > (w.rounds as number)) p.push('round 不能大於 rounds')
  if (w.turn !== 'you' && w.turn !== 'ended') p.push('turn 要是 you 或 ended')
  if (!isRecord(w.cells) || !CELLS.every((c) => isRecord((w.cells as Record<string, unknown>)[c]) && [null, 'you', 'foe'].includes(((w.cells as Record<string, unknown>)[c] as Record<string, unknown>).owner as never))) p.push('cells 要有九個格子，owner 是 you、foe 或 null')
  if (!isRecord(w.voice) || !intIn(w.voice.you, 0, 30) || !intIn(w.voice.foe, 0, 30)) p.push('voice 要是 { you, foe }（0 以上的整數）')
  if (!intIn(w.wind, -20, 20)) p.push('wind 要是整數')
  if (!Array.isArray(w.desk) || w.desk.length === 0 || !w.desk.every((s) => isRecord(s) && typeof s.actor === 'string' && isSafeInt(s.ep) && s.ep >= 0 && isSafeInt(s.ep_max) && s.ep_max >= 0)) p.push('desk 要是編輯台的座位（至少一個）')
  for (const f of ['deck', 'hand', 'discard']) if (!Array.isArray(w[f]) || !(w[f] as unknown[]).every(isText)) p.push(`${f} 要是牌 id 的陣列`)
  if (!intIn(w.captured, 0, 99) || !intIn(w.captures, 0, 99)) p.push('captured 與 captures 要是 0 以上的整數')
  if (!isRecord(w.used)) p.push('used 要是物件')
  if (!isRecord(w.bonus)) p.push('bonus 要是物件')
  if (!isRecord(w.foe_state) || !intIn(w.foe_state.bribes, 0, 9) || typeof w.foe_state.visited !== 'boolean') p.push('foe_state 要是 { bribes, visited, … }')
  if (!isRecord(w.origin) || !isText(w.origin.by)) p.push('origin 要是 { by, … }')
  if (w.result !== undefined && !(isRecord(w.result) && (OUTCOMES as unknown[]).includes(w.result.outcome))) p.push('result 要是 { outcome, … }')
  if (w.turn === 'ended' && w.result === undefined) p.push('turn 是 ended 就要有 result')
  if (w.pending !== undefined && !['bribe', 'visit', 'lost'].includes(w.pending as string)) p.push('pending 要是 bribe、visit、lost 之一')
  if (isRecord(w.topic) && isRecord(w.topic.scores) && !CELLS.every((c) => finiteNum((w.topic as Record<string, Record<string, unknown>>).scores![c]))) p.push('topic.scores 要有九個格子的分數')
  return p
}
