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

import type { Change, GameState, Kernel, Origin } from '../../core'
import { isRecord, isSafeInt } from '../../core'
import type { ContentEntry } from '../../core'
import type { OpEffect, OpPassive } from './hooks'
import { parseWhen } from './when'

export const OWNER = 'opinion'
export const EXT = 'opinion'
export const ACTIVITY = 'opinion'
/** 委託副本的輿論面（M5-opinion-face）：和 opinion 同一份狀態，war.mode 是 face */
export const FACE_ACTIVITY = 'face.opinion'
/** 收買被接受時的記帳（rewind.keep 用）：state.ext.opinion_bribes */
export const BRIBES_EXT = 'opinion_bribes'
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
export const MOVE_ACTION = 'opinion.move'
export const TURN_ACTION = 'opinion.turn'
export const CONCEDE_ACTION = 'opinion.concede'
export const BRIBE_ACTION = 'opinion.bribe'
export const END_ACTION = 'opinion.end'
export const VISIT_ACTION = 'opinion.visit'
export const RETRY_ACTION = 'opinion.retry'
export const BACK_ACTION = 'opinion.back'
export const ACCEPT_ACTION = 'opinion.accept'
export const OUTSOURCE_ACTION = 'opinion.outsource'

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
  /** 各路數的編輯點照階數的一半：up 進位、down 捨去（OPINION 4.3b；路數 id 照 actor.ext.paths） */
  ep_paths: Record<string, 'up' | 'down'>
  /** 被動的 ep_cap 合計最多算幾點 */
  ep_cap_max: number
  /** 一場最多帶幾件料進牌庫（牌庫大約 12～15 張，基本牌九張） */
  bring_max: number
  /** 素材與片換成牌面的算式（V33）：料 = 看點 ÷ div 進位、夾在 1～max，達 fuel_two_at 花 2 點；說法 = 可信達 line_two_at 風向 2（花 2 點）否則 1；假料牌面再加 fake_plus */
  deck: { fuel_div: number; fuel_max: number; fuel_two_at: number; line_two_at: number; fake_plus: number }
  /** 豔名（OPINION 4.3c）：每 step 點算一級，看臉三格的防守最多減 max；counter_at 以上對手的反爆料多推 counter_plus */
  fame: { step: number; max: number; counter_at: number; counter_plus: number }
  /** 自己發起的戰役：訂閱到 subs_at 以上，採訪的聲量 +interview_plus（V34） */
  self: { subs_at: number; interview_plus: number }
  /** 找上門（V35）：擋住的 DC ＝ dc_base ＋ 強度 × dc_per_strength；擋住時這一場正在直播，牌庫多一張聲量 live_voice 的料 */
  visit: { dc_base: number; dc_per_strength: number; live_voice: number }
  /** 收買被接受（V36）：公信力掉 cred、委託人的好感掉 favor（委託副本才有委託人） */
  bribe: { cred: number; favor: number }
  /** 外包給名冊上的記者（OPINION 第 7 節）：DC ＝ dc_base ＋ 強度 × dc_per_strength；超過 gap 以上大勝、成功小勝、差不到 gap 平手、其餘敗；
   *  分量修正照路數（weight：媒體型 +4、社交型 +2，取他最高的一條）；skills 是他的檢定用的基本功（取最高） */
  outsource: { dc_base: number; dc_per_strength: number; gap: number; weight: Record<string, number>; skills: string[] }
  /** 戰役的後果（V41）：目標勢力的聲望與敵對值、訂閱（現有的百分之幾）、公信力 */
  after: Record<Outcome, AfterRule>
  /** 結算時佔著的格子另給：主流三格各訂閱 +main_subs_pct%；同人圈與應援圈各人氣 +circle_pop、打賞（分數 × circle_tip）；街頭三格合計公信力 +street_cred */
  cells: { main_subs_pct: number; circle_pop: number; circle_tip: number; street_cred: number }
  /** 自己發起而沒指定對手、也沒有對得上勢力的對手資料時用的通用公關：強度照戰役等級（I～V）、行動表 */
  generic: { strength: number[]; actions: ActionRule[] }
}

export interface AfterRule {
  standing?: number
  hostility?: number
  subs_pct?: number
  cred?: number
}

export const DEFAULT_OPINION_RULES: OpinionRules = {
  rounds: 6, short_rounds: 4, open_hand: 3, draw: 2, hand_max: 5, ep_base: 2, empty_def: 2, foe_def_base: 3, voice_max: 10, wind_max: 5, big_gap: 4,
  grade_fuel: [0, 0, 1, 1, 2], line_cred: { high: 60, low: 30 },
  army: { voice: 3, risk: 5, wind: 1, cred: 3 }, fake: { risk: 6, wind: 2, cred: 8 }, mute: 2, shift: 2, sweeps: 3,
  pr_by_difficulty: { story: -1, easy: -1, normal: 0, hard: 1, legend: 2, custom: 0 },
  ep_paths: { streamer: 'up', idol: 'up', socialite: 'down', fixer: 'down' }, ep_cap_max: 3, bring_max: 6,
  deck: { fuel_div: 2, fuel_max: 4, fuel_two_at: 3, line_two_at: 6, fake_plus: 1 },
  fame: { step: 30, max: 2, counter_at: 60, counter_plus: 1 },
  self: { subs_at: 10000, interview_plus: 1 },
  visit: { dc_base: 12, dc_per_strength: 2, live_voice: 4 },
  bribe: { cred: 5, favor: 5 },
  outsource: { dc_base: 10, dc_per_strength: 3, gap: 5, weight: { streamer: 4, idol: 4, socialite: 2, fixer: 2 }, skills: ['perform', 'investigate', 'negotiate'] },
  // OPINION 第 9 節沒有數字：V41 的暫定。大勝目標勢力聲望 −10、敵對值 +10、訂閱 +10%、公信力 +5；小勝 −5、+6、+5%、+2；平手敵對值 +3；敗敵對值 +5、公信力 −3
  after: { major: { standing: -10, hostility: 10, subs_pct: 10, cred: 5 }, minor: { standing: -5, hostility: 6, subs_pct: 5, cred: 2 }, draw: { hostility: 3 }, lost: { hostility: 5, cred: -3 } },
  cells: { main_subs_pct: 2, circle_pop: 1, circle_tip: 50, street_cred: 1 },
  generic: {
    strength: [1, 1, 2, 2, 3],
    actions: [{ do: 'release', when: 'always' }, { do: 'deny', when: 'wind > 0' }, { do: 'mute', when: 'your_voice >= 3' }, { do: 'counter', when: 'wind > 1' }, { do: 'takedown', when: 'hand >= 4' }],
  },
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
  p.push(...extraRuleProblems(e))
  return p
}

/** 編輯台那一張加的規則欄位。 */
const EXTRA_GROUPS = [
  ['deck', [['fuel_div', 1, 4], ['fuel_max', 1, 10], ['fuel_two_at', 1, 10], ['line_two_at', 1, 10], ['fake_plus', 0, 3]]],
  ['fame', [['step', 1, 100], ['max', 0, 5], ['counter_at', 0, 100], ['counter_plus', 0, 3]]],
  ['self', [['subs_at', 0, 100_000_000], ['interview_plus', 0, 3]]],
  ['cells', [['main_subs_pct', 0, 50], ['circle_pop', 0, 20], ['circle_tip', 0, 10_000], ['street_cred', 0, 20]]],
  ['visit', [['dc_base', 0, 40], ['dc_per_strength', 0, 10], ['live_voice', 0, 10]]],
  ['bribe', [['cred', 0, 50], ['favor', 0, 50]]],
] as const
const AFTER_FIELDS = [['standing', -100, 100], ['hostility', -100, 100], ['subs_pct', -100, 1000], ['cred', -100, 100]] as const

function extraRuleProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (e.ep_paths !== undefined) {
    if (!isRecord(e.ep_paths)) p.push('ep_paths 要是「路數 id → up 或 down」')
    else for (const [path, v] of Object.entries(e.ep_paths)) if (v !== 'up' && v !== 'down') p.push(`ep_paths.${path} 要是 up（進位）或 down（捨去）`)
  }
  if (e.ep_cap_max !== undefined && !intIn(e.ep_cap_max, 0, 6)) p.push('ep_cap_max 要是 0～6 的整數')
  if (e.bring_max !== undefined && !intIn(e.bring_max, 0, 15)) p.push('bring_max 要是 0～15 的整數')
  for (const [key, fields] of EXTRA_GROUPS) {
    const v = e[key]
    if (v === undefined) continue
    if (!isRecord(v)) p.push(`${key} 要是 { ${fields.map((f) => f[0]).join(', ')} }`)
    else for (const [f, lo, hi] of fields) if (v[f] !== undefined && !intIn(v[f], lo, hi)) p.push(`${key}.${f} 要是 ${lo}～${hi} 的整數`)
  }
  if (e.outsource !== undefined) {
    const o = e.outsource
    if (!isRecord(o)) p.push('outsource 要是 { dc_base, dc_per_strength, gap, weight, skills }')
    else {
      for (const [f, lo, hi] of [['dc_base', 0, 40], ['dc_per_strength', 0, 10], ['gap', 1, 20]] as const) if (o[f] !== undefined && !intIn(o[f], lo, hi)) p.push(`outsource.${f} 要是 ${lo}～${hi} 的整數`)
      if (o.weight !== undefined) {
        if (!isRecord(o.weight)) p.push('outsource.weight 要是「路數 id → 分量修正」')
        else for (const [path, n] of Object.entries(o.weight)) if (!intIn(n, -10, 10)) p.push(`outsource.weight.${path} 要是 −10～10 的整數`)
      }
      if (o.skills !== undefined && !(Array.isArray(o.skills) && o.skills.length > 0 && o.skills.every(isText))) p.push('outsource.skills 要是基本功 id 的陣列（至少一個）')
    }
  }
  if (e.after !== undefined) {
    if (!isRecord(e.after)) p.push('after 要是「結果 → { standing, hostility, subs_pct, cred }」')
    else {
      for (const [o, v] of Object.entries(e.after)) {
        if (!(OUTCOMES as readonly string[]).includes(o)) p.push(`after.${o} 不是結果（${OUTCOMES.join('、')}）`)
        else if (!isRecord(v)) p.push(`after.${o} 要是 { standing, hostility, subs_pct, cred }`)
        else for (const [f, lo, hi] of AFTER_FIELDS) if (v[f] !== undefined && !intIn(v[f], lo, hi)) p.push(`after.${o}.${f} 要是 ${lo}～${hi} 的整數`)
      }
    }
  }
  if (e.generic !== undefined) {
    const g = e.generic
    if (!isRecord(g)) p.push('generic 要是 { strength, actions }')
    else {
      if (g.strength !== undefined && !(Array.isArray(g.strength) && g.strength.length === 5 && g.strength.every((n) => intIn(n, 1, 3)))) p.push('generic.strength 要是五個 1～3 的整數（戰役等級 I～V 各一個）')
      if (g.actions !== undefined) {
        if (!Array.isArray(g.actions) || g.actions.length === 0) p.push('generic.actions 要是行動的陣列（由上往下，每個 { do, when }）')
        else {
          g.actions.forEach((a, i) => {
            if (!isRecord(a)) return void p.push(`generic.actions[${i}] 要是 { do, when }`)
            if (!(SWEEP_IDS as readonly unknown[]).includes(a.do)) p.push(`generic.actions[${i}].do 要是 ${SWEEP_IDS.join('、')} 之一`)
            const w = whenProblem(a.when, `generic.actions[${i}]`)
            if (w) p.push(w)
          })
        }
      }
    }
  }
  return p
}

/** 現在生效的規則：資料 opinion_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function opinionRules(k: Pick<Kernel, 'content'>): OpinionRules {
  const d = DEFAULT_OPINION_RULES
  const out: OpinionRules = {
    ...d, grade_fuel: [...d.grade_fuel], line_cred: { ...d.line_cred }, army: { ...d.army }, fake: { ...d.fake }, pr_by_difficulty: { ...d.pr_by_difficulty },
    ep_paths: { ...d.ep_paths }, deck: { ...d.deck }, fame: { ...d.fame }, self: { ...d.self }, cells: { ...d.cells }, visit: { ...d.visit }, bribe: { ...d.bribe },
    outsource: { ...d.outsource, weight: { ...d.outsource.weight }, skills: [...d.outsource.skills] },
    after: Object.fromEntries(OUTCOMES.map((o) => [o, { ...d.after[o] }])) as Record<Outcome, AfterRule>, generic: { strength: [...d.generic.strength], actions: d.generic.actions.map((a) => ({ ...a })) },
  }
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
  mergeExtra(out, e)
  return out
}

function mergeExtra(out: OpinionRules, e: Record<string, unknown>): void {
  if (isRecord(e.ep_paths)) for (const [path, v] of Object.entries(e.ep_paths)) if ((v === 'up' || v === 'down') && path !== '__proto__') out.ep_paths[path] = v
  if (intIn(e.ep_cap_max, 0, 6)) out.ep_cap_max = e.ep_cap_max
  if (intIn(e.bring_max, 0, 15)) out.bring_max = e.bring_max
  for (const [key, fields] of EXTRA_GROUPS) {
    const v = e[key]
    if (isRecord(v)) for (const [f, lo, hi] of fields) if (intIn(v[f], lo, hi)) (out[key] as unknown as Record<string, number>)[f] = v[f] as number
  }
  if (isRecord(e.outsource)) {
    const o = e.outsource
    for (const [f, lo, hi] of [['dc_base', 0, 40], ['dc_per_strength', 0, 10], ['gap', 1, 20]] as const) if (intIn(o[f], lo, hi)) out.outsource[f] = o[f] as number
    if (isRecord(o.weight)) for (const [path, n] of Object.entries(o.weight)) if (intIn(n, -10, 10) && path !== '__proto__') out.outsource.weight[path] = n
    if (Array.isArray(o.skills) && o.skills.length > 0 && o.skills.every(isText)) out.outsource.skills = [...(o.skills as string[])]
  }
  if (isRecord(e.after)) {
    for (const o of OUTCOMES) {
      const v = e.after[o]
      if (!isRecord(v)) continue
      const rule: AfterRule = { ...out.after[o] }
      for (const [f, lo, hi] of AFTER_FIELDS) if (intIn(v[f], lo, hi)) rule[f] = v[f]
      out.after[o] = rule
    }
  }
  if (isRecord(e.generic)) {
    const g = e.generic
    if (Array.isArray(g.strength) && g.strength.length === 5 && g.strength.every((n) => intIn(n, 1, 3))) out.generic.strength = [...(g.strength as number[])]
    if (Array.isArray(g.actions) && g.actions.length > 0 && g.actions.every((a) => isRecord(a) && (SWEEP_IDS as readonly unknown[]).includes(a.do) && whenProblem(a.when, 'x') === null)) {
      out.generic.actions = (g.actions as Array<Record<string, unknown>>).map((a) => ({ do: a.do as ActionId, when: a.when as string }))
    }
  }
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
  /** 結束時多給的效果（內容用；k.effects 的格式，'$foe_faction' 換成對手的勢力、'$pc' 換成主角；有人註冊才給） */
  on_end?: Partial<Record<Outcome, OpEffect[]>>
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
  if (e.on_end !== undefined) {
    if (!isRecord(e.on_end)) p.push('on_end 要是「結果 → 效果的陣列」')
    else {
      for (const [o, list] of Object.entries(e.on_end)) {
        if (!(OUTCOMES as readonly string[]).includes(o)) p.push(`on_end.${o} 不是結果（${OUTCOMES.join('、')}）`)
        else if (!Array.isArray(list) || !list.every((x) => isRecord(x) && isText(x.kind))) p.push(`on_end.${o} 要是效果的陣列（每一筆 { kind, … }）`)
      }
    }
  }
  return p
}

// ---- 對手的行動（pr_action） ----

/** 鏡像對手（mimic）多出來的六個行動：玩家這邊的料、說法、手段（設防、轉移焦點、水軍）與主播的技能（造勢）；只有寫了 mimic 的對手能用 */
export const MIMIC_IDS = ['fuel', 'line', 'guard', 'shift', 'army', 'host'] as const
export const ACTION_IDS = ['release', 'deny', 'mute', 'counter', 'lawyer', 'takedown', 'chase', 'bribe', 'visit', ...MIMIC_IDS] as const
export type ActionId = (typeof ACTION_IDS)[number]
/** 掃行動表時會用的七個（收買與找上門是每場一次的，寫在 once） */
export const SWEEP_IDS: ActionId[] = ['release', 'deny', 'mute', 'counter', 'lawyer', 'takedown', 'chase']
/** 行動表（actions）裡可以寫的 do：七個掃描行動加鏡像對手的六個 */
export const TABLE_IDS: ActionId[] = [...SWEEP_IDS, ...MIMIC_IDS]

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
  // 鏡像對手（另一個主播）多出來的：照玩家那邊的料、說法、手段、主播技能做成對手的行動（OPINION 5.2 最後一列）
  { id: 'fuel', name: '料', cost: 1, amount: [2, 2, 3, 3, 3] },
  { id: 'line', name: '說法', cost: 1, amount: [1, 1, 1, 1, 2] },
  { id: 'guard', name: '設防', cost: 1, amount: 1, limit: { per: 'turn', n: 1 } },
  { id: 'shift', name: '轉移焦點', cost: 1, amount: 2, limit: { per: 'turn', n: 1 } },
  { id: 'army', name: '水軍', cost: 1, amount: 3, limit: { per: 'turn', n: 1 } },
  { id: 'host', name: '造勢', cost: 2, amount: 3, limit: { per: 'turn', n: 1 } },
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
  /** 你搶它的格子時，防守照你的公信力加減：每一階 lt（低於）與 gte（以上）都成立才算，amount 合計（蜜腺：公信力低的對手幾乎搶不動它） */
  cred_def?: Array<{ lt?: number; gte?: number; amount: number }>
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
  /** 這回合佔不佔（和行動的 when 同一套文法；不成立就不佔，聲量存著；緋櫻前三回合只發稿存聲量） */
  capture_when?: string
  /** 第一回合的第一次佔領：一定搶這一格（any_adjacent：不看相鄰；不看聲量夠不夠，扣到 0 為止；潔絲的推薦位） */
  first_capture?: { cell: string; any_adjacent?: boolean }
  desc?: string
}

const SIGNATURE_KEYS = ['cost', 'lawyer_ep', 'weak_line', 'def_minus', 'bribe_times', 'cred_def']

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
  if (e.cred_def !== undefined) {
    const d = e.cred_def
    const ok = Array.isArray(d) && d.length > 0 && d.every((t) => isRecord(t) && intIn(t.amount, -6, 6) && t.amount !== 0 && (t.lt === undefined || intIn(t.lt, 1, 101)) && (t.gte === undefined || intIn(t.gte, 0, 100)) && (t.lt !== undefined || t.gte !== undefined))
    if (!ok) p.push('signature.effect.cred_def 要是階的陣列：每一階 { lt?, gte?, amount }（lt 與 gte 至少寫一個；amount 是 −6～6 的整數，不是 0）')
  }
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
      if (!(TABLE_IDS as readonly unknown[]).includes(a.do)) p.push(`${at}.do 要是 ${TABLE_IDS.join('、')} 之一（收買與找上門寫在 once）`)
      else if ((MIMIC_IDS as readonly unknown[]).includes(a.do) && e.mimic === undefined) p.push(`${at}.do「${String(a.do)}」是鏡像對手的行動：要寫 mimic`)
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
  if (e.capture_when !== undefined) {
    const w = whenProblem(e.capture_when, 'capture')
    if (w) p.push(w)
  }
  if (e.first_capture !== undefined) {
    const f = e.first_capture
    if (!isRecord(f) || !isCellKey(f.cell) || (f.any_adjacent !== undefined && typeof f.any_adjacent !== 'boolean')) p.push(`first_capture 要是 { cell: 格子的 id（${CELLS.join('、')}）, any_adjacent?: true 或 false }`)
  }
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
  on_end?: Partial<Record<Outcome, OpEffect[]>>
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
  capture_when?: string
  first_capture?: { cell: Cell; any_adjacent: boolean }
}

/** 這一場才有的牌（素材與片變成的牌放這裡；目錄裡的牌只存 id）。 */
export type WarCard = CardFields & { id: string }

export type Outcome = 'major' | 'minor' | 'draw' | 'lost'
export const OUTCOMES: Outcome[] = ['major', 'minor', 'draw', 'lost']
export type EndBy = 'rounds' | 'wipe' | 'concede' | 'bribe' | 'visit' | 'outsource'

export interface WarResult {
  outcome: Outcome
  by: EndBy
  you: number
  foe: number
  /** 嫁禍：指定的那一格有沒有佔著（沒有指定是 null） */
  target_held: boolean | null
  /** 收買：接受的價錢 */
  bribed?: number
  /** 找上門擋不住、而且對手是會抓人的那一種：被帶走了 */
  captured?: boolean
  /** 外包的結算（沒有開棋盤）：誰、骰面、合計、DC、他的基本功與分量修正 */
  outsourced?: { actor: string; roll: number; total: number; dc: number; skill: number; weight: number }
}

/** 效果 def_mod 留在戰役裡的防守加減（只算你搶格子的時候）。 */
export interface DefMod {
  amount: number
  scope: 'next' | 'turn' | 'war'
  vs?: 'empty' | 'foe'
  cells?: Cell[]
  first?: boolean
}

/** 效果 card_mod 留在戰役裡的牌面加減。 */
export interface CardMod {
  card: 'fuel' | 'line'
  amount?: number
  mult?: number
  cap?: number
  scope: 'next' | 'turn'
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
  foe_state: { bribes: number; visited: boolean; visit_stun?: boolean; ep_penalty?: number; open?: string[]; last?: string[]; pr_mod?: number; guard?: number; first_done?: boolean }
  /** 開戰時問回來的被動（修正與反應；戰役中途不再問，免得中途換裝備改變規則） */
  passives: OpPassive[]
  /** 招與反應用過幾次：turn:<id> 每回合清掉、war:<id> 整場 */
  moves_used: Record<string, number>
  /** 效果 mark 記下的旗標：旗標 → 記在第幾回合 */
  marks: Record<string, number>
  /** 戰役外的效果（k.effects 的格式）：先存著，結算時一起套 */
  out: Array<Record<string, unknown>>
  /** 帶進牌庫的素材與片：ref 是素材庫裡的編號、card 是 custom 裡那張牌的 id */
  brought: Array<{ ref: string; card: string }>
  /** 主角的豔名（各區最高的那一個，開戰時記；沒有豔名量表是 0） */
  fame: number
  /** 自己發起的（不是委託副本、也不是事件開的）：訂閱一萬以上採訪 +1（V34） */
  self: boolean
  /** 副本前面階段拿到的連動（M5-opinion-face 給；效果 link_voice 看） */
  links: string[]
  /** 這回合多佔的次數還剩幾次：每一次的防守加減、能不能不相鄰（原本那一次用掉了沒有，看 captured 與 captures 推得出來：board.ts 的 baseUsed） */
  xcap: Array<{ def: number; any: boolean }>
  /** 到整場結束都不必相鄰（效果 free_adjacency） */
  free_adj: boolean
  defmods: DefMod[]
  cardmods: CardMod[]
  /** 這回合防守當作 0 的對手的格子（效果 take 的 foe_def_zero） */
  zero_def: Cell[]
  /** 抵銷對手的律師函、下架、降流：each 是一個共用的次數 */
  shield: Array<{ what: string[]; left: number }>
  /** 結束回合時預留的編輯點（有 cost 的反應）：key 是 <被動 id>:<第幾個反應> */
  reserved: Array<{ key: string; seat: string; cost: number }>
  /** 等著回應：bribe 等玩家答、visit 等結算（沒有選擇）、lost 是委託副本決定性的一場沒贏、等玩家三選一 */
  pending?: 'bribe' | 'visit' | 'lost'
  /** 收買的價錢（pending 是 bribe 時） */
  offer?: number
  /** 委託副本的輿論面（mode 是 face）：哪件委託、第幾個階段、是不是決定性的、委託人（好感用）；外包開出來的沒有棋盤 */
  face?: { commission: string; stage: number; decisive: boolean; employer?: string; outsourced?: boolean }
  /** 找上門的結算：擲的骰面、合計、DC、擋住了沒有、留守的人 */
  visit?: { roll: number; total: number; dc: number; held: boolean; stay: string[] }
  /** 這一回合被找上門打斷：編輯點 0、不能佔領（只有這一回合） */
  stun?: boolean
  custom?: Record<string, WarCard>
  origin: Origin
  result?: WarResult
}

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 編輯台那一張加的欄位的預設（舊的戰役沒有這些欄位：讀的時候補上）。 */
const warExtras = (): Pick<War, 'passives' | 'moves_used' | 'marks' | 'out' | 'brought' | 'fame' | 'self' | 'links' | 'xcap' | 'free_adj' | 'defmods' | 'cardmods' | 'zero_def' | 'shield' | 'reserved'> => ({
  passives: [], moves_used: {}, marks: {}, out: [], brought: [], fame: 0, self: false, links: [], xcap: [], free_adj: false, defmods: [], cardmods: [], zero_def: [], shield: [], reserved: [],
})
const EXTRA_KEYS = Object.keys(warExtras())

/** 這個人的路數（actor.ext.paths，格式照 DATA 第 8 節：{ path, slot, tier }）：只認格式，不 import 別人。 */
export function pathsOf(state: Pick<GameState, 'actors'>, actor: string): Array<{ path: string; tier: number }> {
  const raw = Object.hasOwn(state.actors, actor) ? state.actors[actor]!.ext.paths : undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r) => (isRecord(r) && typeof r.path === 'string' && isSafeInt(r.tier) && r.tier >= 1 ? [{ path: r.path, tier: r.tier }] : []))
}

/** 讀 state.ext.opinion.war。沒有、或形狀不對回 null（唯讀；回傳的是狀態裡那一份，不要改它——要改先 clone）。 */
export function readWar(state: Pick<GameState, 'ext'>): War | null {
  const raw = state.ext?.[EXT]
  if (!isRecord(raw) || !isRecord(raw.war)) return null
  const war = raw.war as unknown as War
  return EXTRA_KEYS.every((key) => Object.hasOwn(war, key)) ? war : ({ ...warExtras(), ...war } as War)
}

export interface BribeEntry {
  id: string
  changes: Change[]
}

/** 讀收買的帳（state.ext.opinion_bribes；bribe.ts）：格式不對的略過。 */
export function readBribes(state: Pick<GameState, 'ext'>): BribeEntry[] {
  const raw = state.ext?.[BRIBES_EXT]
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is BribeEntry => isRecord(e) && typeof e.id === 'string' && Array.isArray(e.changes))
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
  for (const f of ['passives', 'out', 'brought', 'links', 'xcap', 'defmods', 'cardmods', 'zero_def', 'shield', 'reserved']) if (w[f] !== undefined && !Array.isArray(w[f])) p.push(`${f} 要是陣列`)
  for (const f of ['moves_used', 'marks']) if (w[f] !== undefined && !isRecord(w[f])) p.push(`${f} 要是物件`)
  if (w.fame !== undefined && !isSafeInt(w.fame)) p.push('fame 要是整數')
  for (const f of ['self', 'free_adj', 'stun']) if (w[f] !== undefined && typeof w[f] !== 'boolean') p.push(`${f} 要是 true 或 false`)
  if (w.face !== undefined && !(isRecord(w.face) && typeof w.face.commission === 'string' && isSafeInt(w.face.stage) && typeof w.face.decisive === 'boolean')) p.push('face 要是 { commission, stage, decisive }')
  if (w.visit !== undefined && !(isRecord(w.visit) && isSafeInt(w.visit.roll) && isSafeInt(w.visit.dc) && typeof w.visit.held === 'boolean')) p.push('visit 要是 { roll, total, dc, held, stay }')
  if (isRecord(w.topic) && isRecord(w.topic.scores) && !CELLS.every((c) => finiteNum((w.topic as Record<string, Record<string, unknown>>).scores![c]))) p.push('topic.scores 要有九個格子的分數')
  return p
}
