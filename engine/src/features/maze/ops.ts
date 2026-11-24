// L6 功能 maze 的入口：報名（enter、brackets）、機關（solve）、寶箱（open）、這一趟的用途清單（useMaze）、結算與各個掛點用的函式。
// 改狀態的入口都是「匯出一個純函式，回傳報告草稿」，不成立丟 ActionBlocked（原因一句一條）：介面交給 Game.commit。
// 規格：CYBERSPACE 8.2 節（報名、三層、機關、寶箱、獎品、時間與評價、打輸）、3.3 節、8.1 節；ENEMIES 第 9 節最後一列；dev/work/M3-maze.md。
//
// 報告（kind netrun）：maze.enter（報名）、maze.use（解機關、開寶箱、寶箱怪）、maze.rest（層與層之間的休息）、maze.result（結算）。

import type { ActorId, AttrId, Change, CheckRoll, Effect, GameState, GridCtx, GridEffect, GridUse, Kernel, Launch, MarkerDef, Origin, ReportDraft, TimelineBeat, UnitRef } from '../../core'
import { ActionBlocked, DEGREE_NAME, attrMod, checkParts, clone, deriveRng, effectCtx, formatAmount, gridHere, isRecord, modeAttr, pointKey, rollCheck, toMinutes } from '../../core'
import type { BracketDef, BracketGrade, MazeResult, MazeRules, MazeState, MazeTable, SolveOption, TableRow } from './model'
import {
  ACT_DIVE, ACT_NETRUN, ORIGIN_BY, REGION_ID, chipKey, downKey, isText, mazeChange, mazeRegion, mazeRules, rate, readMaze, resetTally, roundKey, tableOf, tallyOf, BRACKET_ORDER,
} from './model'

const BUSY = '正在戰鬥，先把這一場打完。'
const NOT_OPEN = '迷宮館現在沒有開放。'
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const roman = (g: number): string => ROMAN[g] ?? String(g)
const nameOf = (state: GameState, id: ActorId): string => state.actors[id]?.name ?? id

/** 隊上的人（還在名冊裡的）。 */
export const partyOf = (state: GameState): ActorId[] => state.party.filter((id) => !!state.actors[id])

/** 現在進行中的那一趟網內的行程的 id（活動 netrun 回答的；沒有是 null）。 */
export function activeRunId(k: Kernel, state: GameState): string | null {
  const a = k.activity.active(state).find((x) => x.kind === ACT_NETRUN)
  return a ? a.id : null
}

function draftOf(
  state: GameState, action: string, result: string, summary: string, changes: Change[],
  o: { lines?: string[]; beats?: TimelineBeat[]; launch?: Launch[] } = {},
): ReportDraft {
  const lines = o.lines ?? []
  return {
    kind: 'netrun', action, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: o.beats?.length ? o.beats : [{ layer: 'net', ...(state.pc ? { actor: state.pc } : {}), text: lines[0] ?? summary, tag: action }],
    changes, outcome: { result, summary }, ...(lines.length ? { narration: { results: lines } } : {}), ...(o.launch?.length ? { launch: o.launch } : {}),
  }
}

// ---- 報名 ----

export interface BracketRow {
  /** 組別的 id（rookie、open、unlimited）；同一組有好幾個等級（無差別組 III 與 IV）時每個等級一列、id 一樣 */
  id: string
  name: string
  grade: number
  deposit: number
  prize: number
  /** 能不能用自己的構裝 */
  own: boolean
  /** 自己的構裝最高幾級 */
  maxGrade: number
  /** 館方發的比賽甲板（有的話這一組一律租它） */
  deck?: string
  /** 現在報不了的原因（一條一個條件；能報是空的） */
  blocks: string[]
  block: string | null
}

const bracketIds = (rules: MazeRules): string[] => [...BRACKET_ORDER.filter((id) => rules.brackets[id]), ...Object.keys(rules.brackets).filter((id) => !BRACKET_ORDER.includes(id)).sort()]

/** 隊上的人裝著的構裝（actor.ext.deck.slots 的格式；內容查得到 construct 的才算，快駭程式不算）。 */
function constructsOf(k: Kernel, state: GameState, actor: ActorId): Array<{ id: string; name: string; grade: number; weapon: boolean }> {
  const deck = state.actors[actor]?.ext.deck
  const slots = isRecord(deck) && Array.isArray(deck.slots) ? deck.slots.filter(isText) : []
  if (!k.content.hasKind('construct')) return []
  const out: Array<{ id: string; name: string; grade: number; weapon: boolean }> = []
  for (const id of slots) {
    const e = k.content.get('construct', id)
    if (e) out.push({ id, name: isText(e.name) ? e.name : id, grade: typeof e.grade === 'number' ? e.grade : 1, weapon: e.class === 'weapon' })
  }
  return out
}

/** 報名前這個人身上租的甲板（潛艙店附的；actor.ext.deck.rental.deck 的共用格式）；沒有租是 undefined。 */
function rentalOf(state: GameState, actor: ActorId): string | undefined {
  const deck = state.actors[actor]?.ext.deck
  const r = isRecord(deck) ? deck.rental : undefined
  return isRecord(r) && isText(r.deck) ? r.deck : undefined
}

/** 報這一組、這一級現在報不了的原因（一條一個條件）。 */
export function enterBlocks(k: Kernel, state: GameState, bracketId: string, grade?: number): string[] {
  if (!k.activity.get(ACT_NETRUN)) return [NOT_OPEN]
  const rules = mazeRules(k)
  const b = rules.brackets[bracketId]
  if (!b) return [`沒有「${bracketId}」這一組。`]
  const g = grade === undefined ? b.grades[0] : b.grades.find((x) => x.grade === grade)
  if (!g) return [`${b.name}沒有 ${roman(grade ?? 0)} 級。`]
  const p: string[] = []
  if (readMaze(state)) p.push('你已經報了名，先把這一趟做完。')
  else if (activeRunId(k, state)) p.push('已經有一趟網內的行程在進行，先把它做完。')
  const other = k.activity.blockOf(state, 'commit:maze.enter')
  if (other) p.push(other)
  const party = partyOf(state)
  if (!party.length) p.push('隊上沒有人，沒有人可以報名。')
  // 迷宮館在網內（CYBERSPACE 8.2、2.3）：要先潛入，而且每個隊員都要有橋。沒有登記 dive 的世界（單獨測迷宮館）照舊不查
  if (k.activity.get(ACT_DIVE)) {
    if (!k.activity.active(state).some((a) => a.kind === ACT_DIVE)) p.push('迷宮館在網內：要先從接入點潛入，才報得了名。')
    const bridgeless = party.filter((id) => !isRecord(state.actors[id]?.ext.bridge))
    if (bridgeless.length) p.push(`${bridgeless.map((id) => nameOf(state, id)).join('、')}沒有橋：沒有橋的人進不了內海。`)
    // 潛入中不能換構裝：這一組能用的武器構裝一件都沒有，報得進去也一場打不贏（M3 審查應修 4 的一併查）
    if (party.length && k.activity.active(state).some((a) => a.kind === ACT_DIVE) && k.content.hasKind('construct')) {
      const usable = (c: { id: string; grade: number; weapon: boolean }): boolean => c.weapon && (b.kit.includes(c.id) || (b.own && c.grade <= b.max_grade))
      if (!party.some((id) => constructsOf(k, state, id).some(usable))) {
        p.push(`${b.name}要有能用的武器構裝（${b.own ? `館方的比賽版，或 ${roman(b.max_grade)} 級以下` : '館方的比賽版'}）：隊上沒有人裝著，而潛入中不能換構裝，要先登出、裝好再來。`)
      }
    }
  }
  if (party.length > rules.max_party) p.push(`一隊最多 ${rules.max_party} 個人（現在隊上有 ${party.length} 個）。`)
  if (state.money.cash < g.deposit) p.push(`押金不夠：${b.name}要 C$${formatAmount(g.deposit)}，你只有 C$${formatAmount(state.money.cash)}。`)
  const now = toMinutes(state.time)
  const burned = party.filter((id) => state.actors[id]!.conditions.some((c) => c.id === 'net_burn' && (c.until === undefined || c.until > now)))
  if (burned.length) p.push(`${burned.map((id) => nameOf(state, id)).join('、')}剛在網內倒下，還在燒傷中，一個小時內不能再潛入。`)
  // 構裝：新手組只能用館方發的比賽版；公開組比賽版或自己的 I～II 級；無差別組不限
  const kit = new Set(b.kit)
  for (const id of party) {
    const bad = constructsOf(k, state, id).filter((c) => !kit.has(c.id) && (!b.own || c.grade > b.max_grade))
    if (!bad.length) continue
    p.push(b.own
      ? `${b.name}只能帶比賽版或 ${roman(b.max_grade)} 級以下的構裝：${nameOf(state, id)}裝著${bad.map((c) => `「${c.name}」（${roman(c.grade)} 級）`).join('、')}，不行。`
      : `${b.name}只能用館方發的比賽版構裝：${nameOf(state, id)}裝著${bad.map((c) => `「${c.name}」`).join('、')}，不行。`)
  }
  // 甲板：沒有館方發的甲板（這一組一律租）就要自己有
  if (!b.deck && party.length && k.stats.hasStat('deck_grade') && party.every((id) => k.stats.stat(state, id, 'deck_grade') <= 0)) p.push('隊上沒有人有甲板：這一組要用自己的甲板。')
  if (b.deck && !k.effects.has('deck_rental')) p.push('館方的比賽甲板還沒準備好（租甲板的功能沒有裝）。')
  return p
}

/** 每一組（每一個等級一列）能不能報、為什麼不行。 */
export function brackets(k: Kernel, state: GameState): BracketRow[] {
  const rules = mazeRules(k)
  const rows: BracketRow[] = []
  for (const id of bracketIds(rules)) {
    const b = rules.brackets[id]!
    for (const g of b.grades) {
      const blocks = enterBlocks(k, state, id, g.grade)
      rows.push({ id, name: b.name, grade: g.grade, deposit: g.deposit, prize: g.prize, own: b.own, maxGrade: b.max_grade, ...(b.deck ? { deck: b.deck } : {}), blocks, block: blocks.length ? blocks.join('') : null })
    }
  }
  return rows
}

export interface EnterOpts {
  /** 無差別組選 III 還是 IV 級（沒寫是這一組的第一個等級） */
  grade?: number
  /** 固定這一趟的種子（沒寫由狀態的亂數導出） */
  seed?: number
}

/**
 * 報名（報告 maze.enter）：付押金（現金）；一律租比賽甲板的組別替每個人租（效果 deck_rental）；開一趟 netrun（region 整筆放這一區的規則、三層、等級照組別、origin.by 是 maze）。
 * 開不起來（敵人查不到、生成不合格）整步不成立，押金不會收。不成立丟 ActionBlocked。
 */
export function enter(k: Kernel, state: GameState, bracketId: string, o: EnterOpts = {}): ReportDraft {
  const blocks = enterBlocks(k, state, bracketId, o.grade)
  if (blocks.length) throw new ActionBlocked(blocks.join(''))
  const rules = mazeRules(k)
  const b = rules.brackets[bracketId]!
  const g: BracketGrade = o.grade === undefined ? b.grades[0]! : b.grades.find((x) => x.grade === o.grade)!
  const party = partyOf(state)
  const id = `z${state.seq.uid + 1}`
  const changes: Change[] = [{ op: 'uid', advance: 1 }]
  if (g.deposit > 0) changes.push({ op: 'cash', delta: -g.deposit })
  const rented: ActorId[] = []
  const prior: Record<ActorId, string> = {}
  for (const who of party) {
    const r = rentalOf(state, who)
    if (b.deck && r) prior[who] = r
  }
  if (b.deck) {
    const effects: Effect[] = party.map((who) => ({ kind: 'deck_rental', deck: b.deck!, who }))
    const res = k.effects.resolve(effects, effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length) throw new ActionBlocked(`館方的比賽甲板租不出來：${res.errors.join('；')}`)
    changes.push(...res.changes)
    rented.push(...party)
  }
  const origin: Origin = { by: ORIGIN_BY, ref: bracketId, ext: { maze: { id, bracket: bracketId, grade: g.grade } } }
  const maze: MazeState = { id, bracket: bracketId, grade: g.grade, deposit: g.deposit, rented, ...(Object.keys(prior).length ? { prior } : {}), origin }
  changes.push(mazeChange(maze))
  const setup: Record<string, unknown> = {
    region: mazeRegion(rules), grade: g.grade, faction: rules.faction, layers: rules.layers.map((l) => l.name),
    ...(b.guard ? { encounter: [...b.guard] } : {}), ...(rules.defeat_event ? { defeat_event: rules.defeat_event } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}),
  }
  const deckLine = b.deck ? '館方發了比賽甲板，用完要還。' : '用自己的甲板。'
  const lines = [`你在迷宮館報名了${b.name}，走進了前庭。`, deckLine]
  const money = g.deposit > 0 ? `付了押金 ${formatAmount(g.deposit)}；破關的獎金 ${formatAmount(g.prize)}（乘評價），沒闖過押金沒收。` : ''
  return draftOf(state, 'maze.enter', 'entered', `${lines.join('')}${money}`, changes, { lines, launch: [{ kind: ACT_NETRUN, setup, origin }] })
}

// ---- 看這一趟 ----

interface Here {
  g: NonNullable<ReturnType<typeof gridHere>>
  maze: MazeState
  rules: MazeRules
  sheetId: string
  /** 地圖實例的 ext.net（netrun 寫、只讀格式） */
  net: Record<string, unknown>
}

/** 迷宮館的地圖實例（ext.net.region 是 maze）。 */
export function isMazeInstance(state: GameState, map: string): boolean {
  const net = state.maps.instances[map]?.ext?.net
  return isRecord(net) && net.region === REGION_ID
}

/** 現在站的位置（這一趟進行中、人站在迷宮館的地圖上）；不是是 null。 */
function hereOf(k: Kernel, state: GameState): Here | null {
  const maze = readMaze(state)
  if (!maze || maze.over) return null
  const g = gridHere(k, state)
  if (!g || !isMazeInstance(state, g.at.map)) return null
  const net = state.maps.instances[g.at.map]!.ext!.net as Record<string, unknown>
  return { g, maze, rules: mazeRules(k), sheetId: g.at.sheet, net }
}

/** 第幾層（從 0 起算）：照這一趟的圖的順序（ext.net.graph 的鍵）；找不到是 0。 */
export function layerIndexOf(state: GameState, map: string, sheet: string): number {
  const graph = state.maps.instances[map]?.ext?.net
  const keys = isRecord(graph) && isRecord(graph.graph) ? Object.keys(graph.graph) : []
  return Math.max(0, keys.indexOf(sheet))
}

const dcOf = (here: Here): number => (typeof here.net.dc === 'number' ? here.net.dc : 10)

/** 這一格有沒有處理過（寶箱打開過、機關解開過）。 */
const usedAt = (here: Here, x: number, y: number): boolean => here.g.sheetState.cells[pointKey(x, y)]?.used === true

/** 解機關的辦法實際擲哪個屬性：迷宮館在網內，體格由意志代替（CYBERSPACE 4.1 節；M3 審查應修 3）。 */
const attrOf = (k: Kernel, opt: SolveOption): AttrId => modeAttr(k.content, 'net', opt.attr as AttrId)

/** 隊上能解的辦法裡加值最高的那一組（辦法指定了就只看那一個）。 */
function bestSolver(k: Kernel, state: GameState, options: SolveOption[]): { id: ActorId; opt: SolveOption; mod: number } | null {
  let best: { id: ActorId; opt: SolveOption; mod: number } | null = null
  for (const id of partyOf(state)) {
    for (const opt of options) {
      const mod = checkParts(k.stats, state, id, { attr: attrOf(k, opt), ...(opt.skill ? { skill: opt.skill } : {}), tags: [] }).reduce((s, p) => s + p.value, 0)
      if (!best || mod > best.mod) best = { id, opt, mod }
    }
  }
  return best
}

const isRoll = (r: Pick<CheckRoll, 'degree'>): boolean => r.degree === 'critical' || r.degree === 'success'

/** 感載上限（核心的算法：衍生數值 load_cap，沒有就 20 ＋ 耐受的一半 ＋ 意志調整值 × 3）；探索中最多加到上限少一（過載是戰鬥裡的事）。 */
function loadRoom(k: Kernel, state: GameState, id: ActorId): number {
  const a = state.actors[id]!
  const bridge = a.ext.bridge as { tolerance?: unknown } | undefined
  const tolerance = typeof bridge?.tolerance === 'number' ? bridge.tolerance : 0
  const cap = k.stats.hasStat('load_cap') ? k.stats.stat(state, id, 'load_cap') : 20 + Math.floor(tolerance / 2) + attrMod(k.stats.effectiveAttr(state, id, 'resolve')) * 3
  return Math.max(0, Math.max(1, cap) - 1 - a.load)
}

// ---- 機關 ----

/** 站在旁邊的機關（還沒解開的）。 */
function puzzleNeighbours(here: Here): MarkerDef[] {
  const out: MarkerDef[] = []
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const m = here.g.sheet.markerAt(here.g.at.x + dx, here.g.at.y + dy)
    if (m && m.mark === 'm' && here.g.sheet.kindAt(m.at[0], m.at[1]) === 'net_puzzle') out.push(m)
  }
  return out
}

/** 這個機關現在解不解得了（markerId 沒寫是站在旁邊的第一個）；能是 null。 */
export function solveBlock(k: Kernel, state: GameState, markerId?: string, option?: string): string | null {
  const here = hereOf(k, state)
  if (!here) return '現在不在迷宮館裡。'
  if (state.battle) return BUSY
  const marker = markerId === undefined ? puzzleNeighbours(here)[0] : here.g.sheet.marker(markerId)
  if (!marker || marker.mark !== 'm') return markerId === undefined ? '旁邊沒有機關。' : `這一層沒有「${markerId}」這個機關。`
  if (here.g.sheet.kindAt(marker.at[0], marker.at[1]) !== 'net_puzzle') return `「${marker.name}」已經解開了。`
  if (Math.abs(marker.at[0] - here.g.at.x) + Math.abs(marker.at[1] - here.g.at.y) !== 1) return `「${marker.name}」離這裡太遠了，要走到它旁邊。`
  if (option !== undefined && !here.rules.solve.some((o) => o.id === option)) return `沒有「${option}」這個辦法（${here.rules.solve.map((o) => o.id).join('、')}）。`
  if (!partyOf(state).length) return '隊上沒有人。'
  return null
}

/**
 * 解機關（報告 maze.use）：介面、街頭直覺或體格三選一（option 沒寫是隊上加值最高的那一個辦法）對這張地圖的 DC（照等級）；
 * 成功那一格變成地板；失敗解的人感載加 puzzle_load（照等級乘），可以再試。
 */
export function solve(k: Kernel, state: GameState, markerId?: string, option?: string): ReportDraft {
  const block = solveBlock(k, state, markerId, option)
  if (block) throw new ActionBlocked(block)
  const here = hereOf(k, state)!
  const marker = markerId === undefined ? puzzleNeighbours(here)[0]! : here.g.sheet.marker(markerId)!
  const options = option === undefined ? here.rules.solve : here.rules.solve.filter((o) => o.id === option)
  const pick = bestSolver(k, state, options)!
  const dc = dcOf(here)
  const roll = rollCheck(k.stats, state, {
    actor: pick.id, attr: attrOf(k, pick.opt), ...(pick.opt.skill ? { skill: pick.opt.skill } : {}), dc,
    purpose: `maze/${here.maze.id}/solve/${here.sheetId}/${marker.id}`, tags: ['maze', 'puzzle'],
  })
  const ok = isRoll(roll)
  const who = nameOf(state, pick.id)
  const skill = pick.opt.skill ? `（${k.stats.skillName(pick.opt.skill)}）` : `（${pick.opt.name}）`
  const beat: TimelineBeat = {
    layer: 'net', actor: pick.id, tag: 'maze.roll', roll, data: { dc, option: pick.opt.id },
    text: `${who}解「${marker.name}」${skill}：${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`,
  }
  const changes: Change[] = [{ op: 'rng', advance: 1 }]
  if (ok) {
    changes.push({ op: 'map.sheet', map: here.g.at.map, sheet: here.sheetId, cells: { [pointKey(marker.at[0], marker.at[1])]: { kind: 'floor', used: true } } })
    const lines = [`${who}解開了「${marker.name}」，路通了。`]
    return draftOf(state, 'maze.use', 'solved', lines.join(''), changes, { lines, beats: [beat] })
  }
  const add = Math.round(here.rules.puzzle_load * (here.rules.load_mult[here.maze.grade - 1] ?? 1))
  const room = Math.min(add, loadRoom(k, state, pick.id))
  if (room > 0) changes.push({ op: 'actor.track', id: pick.id, track: 'load', delta: room })
  const lines = [`${who}沒能解開「${marker.name}」，被機關反灌了一下。可以再試。`]
  return draftOf(state, 'maze.use', 'solve_fail', `${lines.join('')}感載 +${room}。`, changes, { lines, beats: [beat] })
}

// ---- 寶箱 ----

/** 這個寶箱現在開不開得了（站在上面）；能是 null。 */
export function openBlock(k: Kernel, state: GameState, markerId?: string): string | null {
  const here = hereOf(k, state)
  if (!here) return '現在不在迷宮館裡。'
  if (state.battle) return BUSY
  const standing = here.g.sheet.markerAt(here.g.at.x, here.g.at.y)
  const marker = markerId === undefined ? standing : here.g.sheet.marker(markerId)
  if (!marker || marker.mark !== 'a') return markerId === undefined ? '這裡沒有寶箱。' : `這一層沒有「${markerId}」這個寶箱。`
  if (marker.id !== standing?.id) return `「${marker.name}」要站在上面才打得開。`
  if (usedAt(here, marker.at[0], marker.at[1])) return `「${marker.name}」已經打開過了，裡面空了。`
  if (!tableOf(k, 'chest', here.rules)) return '館方還沒有準備寶箱的獎品。'
  return null
}

/** 擲一張表的一列：效果經 k.effects.resolve（內建的來源），籌碼另外算。壞掉的列不給東西（回傳 problem）。 */
interface Rolled {
  changes: Change[]
  lines: string[]
  chips: number
  /** 這一列要再擲獎品表 */
  prize: boolean
  name: string
}

/** 五個數字（照等級）的欄位換成這一級的那一個。 */
function scaleByGrade(v: unknown, grade: number): unknown {
  if (Array.isArray(v) && v.length === 5 && v.every((n) => typeof n === 'number')) return v[grade - 1]
  if (Array.isArray(v)) return v.map((x) => scaleByGrade(x, grade))
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, scaleByGrade(x, grade)]))
  return v
}

function rollTable(k: Kernel, state: GameState, table: MazeTable, grade: number, purpose: string): Rolled | { problem: string } {
  const rng = deriveRng(state.rng, purpose)
  const row: TableRow = rng.weighted(table.rows, (r) => r.weight)
  const name = row.name ?? '東西'
  let chips = 0
  if (row.chips !== undefined) chips = typeof row.chips === 'number' ? row.chips : rng.int(row.chips[0], row.chips[1])
  const changes: Change[] = []
  const lines: string[] = []
  if (row.give?.length) {
    const res = k.effects.resolve(scaleByGrade(row.give, grade) as Effect[], effectCtx(k, state, { source: 'builtin', grade: grade as never }))
    if (res.errors.length) return { problem: res.errors[0]! }
    changes.push(...res.changes)
    lines.push(...res.lines)
  }
  return { changes, lines, chips, prize: row.prize === true, name }
}

/** 一次獎勵：擲寶箱表（或獎品表），列上寫再擲獎品表的接著擲一次獎品表（不再往下）。回傳要加的變更、句子與籌碼數。 */
function reward(k: Kernel, state: GameState, here: Pick<Here, 'rules' | 'maze'>, kind: 'chest' | 'prize', purpose: string): { changes: Change[]; lines: string[]; chips: number; names: string[] } {
  const out = { changes: [] as Change[], lines: [] as string[], chips: 0, names: [] as string[] }
  const table = tableOf(k, kind, here.rules)
  if (!table) return out
  let current: Rolled | { problem: string } = rollTable(k, state, table, here.maze.grade, purpose)
  for (let depth = 0; depth < 2; depth++) {
    if ('problem' in current) {
      out.lines.push('裡面的東西壞掉了，什麼都沒拿到。')
      return out
    }
    out.changes.push(...current.changes)
    out.chips += current.chips
    out.names.push(current.name)
    out.lines.push(`${current.name}${current.lines.length ? `：${current.lines.join('；')}` : ''}。`)
    if (!current.prize) return out
    const prizes = tableOf(k, 'prize', here.rules)
    if (!prizes) return out
    current = rollTable(k, state, prizes, here.maze.grade, `${purpose}/prize`)
  }
  return out
}

const chipChange = (maze: Pick<MazeState, 'id'>, n: number): Change[] => (n > 0 ? [{ op: 'counter', key: chipKey(maze.id), delta: n }] : [])

/** 開寶箱開出一場戰鬥（寶箱怪、警報節點叫出來的小兵）：Launch；origin.ext 帶 netrun 認得的 net（run、map、sheet、node、region、dc），讓全員拔線、戰敗都由 netrun 收尾。 */
function fightLaunch(k: Kernel, state: GameState, here: Pick<Here, 'rules' | 'maze' | 'net'>, at: { map: string; sheet: string }, node: string, extra: Record<string, unknown>): Launch {
  const runId = activeRunId(k, state)
  if (!runId) throw new ActionBlocked('現在沒有在網內的行程裡。')
  const rules = here.rules
  const region = mazeRegion(rules)
  const foes: UnitRef[] = rules.mimic_foes.map((rank, n) => ({ from: 'enemy_pick', faction: rules.faction, grade: here.maze.grade, rank, seed: `${here.maze.id}/${node}/${n}` }))
  const ext: Record<string, unknown> = {
    net: { run: runId, map: at.map, sheet: at.sheet, node, region: REGION_ID, dc: typeof here.net.dc === 'number' ? here.net.dc : 10, reinforce: {}, locate_rounds: 3 },
    maze: { id: here.maze.id, ...extra },
    ...(rules.defeat_event ? { defeat_event: rules.defeat_event } : {}),
  }
  const field: Record<string, boolean | number> = {}
  if (region.safe === true) field.safe = true
  return {
    kind: 'battle',
    setup: {
      mode: 'net', grade: here.maze.grade as never, cover: clone(region.cover) as never, field,
      allies: partyOf(state).map((id) => ({ from: 'actor', id })), foes,
      origin: { escapable: true, place: `迷宮館・${node.startsWith('alarm') ? '警報節點' : '寶箱怪'}`, faction: rules.faction },
    },
    origin: { by: ORIGIN_BY, ref: here.maze.id, ext },
  }
}

/**
 * 開寶箱（報告 maze.use）：一成是寶箱怪（開一場遭遇：兩個小兵；打贏才給箱子裡的東西），其餘擲寶箱表一次（照權重）。
 * 籌碼記在計數器，結算時換現金；打開之後那一格記成處理過。
 */
export function open(k: Kernel, state: GameState, markerId?: string): ReportDraft {
  const block = openBlock(k, state, markerId)
  if (block) throw new ActionBlocked(block)
  const here = hereOf(k, state)!
  const marker = here.g.sheet.markerAt(here.g.at.x, here.g.at.y)!
  const purpose = `maze/${here.maze.id}/chest/${here.sheetId}/${marker.id}`
  const changes: Change[] = [{ op: 'rng', advance: 1 }]
  if (deriveRng(state.rng, `${purpose}/mimic`).next() < here.rules.mimic) {
    const launch = fightLaunch(k, state, here, here.g.at, marker.id, { chest: marker.id })
    const lines = [`「${marker.name}」突然張開了嘴：是寶箱怪！`]
    return draftOf(state, 'maze.use', 'mimic', lines.join(''), changes, { lines, launch: [launch] })
  }
  const got = reward(k, state, here, 'chest', purpose)
  changes.push(...got.changes, ...chipChange(here.maze, got.chips), { op: 'map.sheet', map: here.g.at.map, sheet: here.sheetId, cells: { [pointKey(marker.at[0], marker.at[1])]: { used: true } } })
  const lines = [`打開了「${marker.name}」。`, ...got.lines]
  return draftOf(state, 'maze.use', 'chest', `${lines.join('')}${got.chips > 0 ? `比賽籌碼 ${got.chips} 枚。` : ''}`, changes, { lines })
}

// ---- 這一格與旁邊能做的事 ----

/** 一個標記現在能做的事（寶箱站在上面、機關站在旁邊）。 */
export function usesOfMarker(k: Kernel, state: GameState, marker: MarkerDef): GridUse[] {
  const here = hereOf(k, state)
  if (!here) return []
  if (marker.mark === 'a') return [{ id: 'open', name: '開寶箱', block: openBlock(k, state, marker.id) }]
  if (marker.mark === 'm') return here.rules.solve.map((o) => ({ id: `solve:${o.id}`, name: `解機關（${o.name}）`, block: solveBlock(k, state, marker.id, o.id) }))
  return []
}

/**
 * 做一件事：id 是 open（開寶箱）或 solve:<辦法>（解機關）；at 是標記的 id（沒寫是站著的那一格，機關沒寫是旁邊的第一個）。回傳報告草稿；不成立丟 ActionBlocked。
 */
export function useMaze(k: Kernel, state: GameState, id: string, at?: string): ReportDraft {
  if (id === 'open') return open(k, state, at)
  if (id === 'solve') return solve(k, state, at)
  if (id.startsWith('solve:')) return solve(k, state, at, id.slice('solve:'.length))
  throw new ActionBlocked(`這裡沒有「${id}」可以做。`)
}

/** 站在旁邊的機關與腳下的寶箱（給 mazeView）。 */
export function nearUses(k: Kernel, state: GameState): Array<{ marker: MarkerDef; kind: 'puzzle' | 'chest'; uses: GridUse[] }> {
  const here = hereOf(k, state)
  if (!here) return []
  const out: Array<{ marker: MarkerDef; kind: 'puzzle' | 'chest'; uses: GridUse[] }> = []
  for (const m of puzzleNeighbours(here)) out.push({ marker: m, kind: 'puzzle', uses: usesOfMarker(k, state, m) })
  const standing = here.g.sheet.markerAt(here.g.at.x, here.g.at.y)
  if (standing?.mark === 'a') out.push({ marker: standing, kind: 'chest', uses: usesOfMarker(k, state, standing) })
  return out
}

// ---- 掛點：探索回合、戰鬥結束、警報節點 ----

export interface RunLike {
  id: string
  layer: number
  origin: Origin
}

/** 掛點 netrun.round：過了一個探索回合，這一層加一（計數器是加法：一段路好幾格時每一格各問一次）。 */
export function onRound(state: GameState, run: RunLike): Change[] | undefined {
  const m = readMaze(state)
  if (!m || m.over || run.origin.by !== ORIGIN_BY) return undefined
  return [{ op: 'counter', key: roundKey(m.id, run.layer), delta: 1 }]
}

/** 戰鬥的結束：把這一場的回合數加進那一層、倒下的人次加進去；寶箱怪打贏了才給箱子裡的東西。 */
export function onBattleEnd(k: Kernel, state: GameState, battle: { round: number; origin: { ext?: Record<string, unknown> }; units: Record<string, { side: string; out?: string }> }, outcome: string): { changes: Change[]; lines: string[] } | undefined {
  const m = readMaze(state)
  const link = battle.origin.ext?.net
  if (!m || m.over || !isRecord(link) || link.run !== activeRunId(k, state) || typeof link.map !== 'string' || !isMazeInstance(state, link.map)) return undefined
  const layer = layerIndexOf(state, link.map, typeof link.sheet === 'string' ? link.sheet : '')
  const changes: Change[] = [{ op: 'counter', key: roundKey(m.id, layer), delta: Math.max(1, battle.round) }]
  const downs = Object.values(battle.units).filter((u) => u.side === 'ally' && (u.out === 'down' || u.out === 'burnout' || u.out === 'pinned')).length
  if (downs > 0) changes.push({ op: 'counter', key: downKey(m.id), delta: downs })
  const lines: string[] = []
  const mine = battle.origin.ext?.maze
  // 寶箱怪打贏了：箱子裡的東西給你（那一格 netrun 已經記成處理過）
  if (outcome === 'win' && isRecord(mine) && typeof mine.chest === 'string') {
    const rules = mazeRules(k)
    const got = reward(k, state, { rules, maze: m }, 'chest', `maze/${m.id}/mimic/${link.sheet as string}/${mine.chest}`)
    changes.push({ op: 'rng', advance: 1 }, ...got.changes, ...chipChange(m, got.chips))
    lines.push('寶箱怪倒下了，箱子裡的東西是你的：', ...got.lines)
  }
  return { changes, lines }
}

/** 掛點 grid.onEnter：踩到警報節點，叫出兩個小兵打一場（館裡的警報節點不加追蹤度）。 */
export function onEnterAlarm(ctx: GridCtx): GridEffect | void {
  const k = ctx.k as Kernel
  const state = ctx.state
  const here = hereOf(k, state)
  if (!here || here.g.at.map !== ctx.at.map) return undefined
  const traps = isRecord(here.net.traps) ? here.net.traps[ctx.at.sheet] : undefined
  const hit = Array.isArray(traps) && traps.some((t) => isRecord(t) && t.kind === 'net_alarm' && t.used !== true && Array.isArray(t.at) && t.at[0] === ctx.at.x && t.at[1] === ctx.at.y)
  if (!hit) return undefined
  const runId = activeRunId(k, state)
  if (!runId) return undefined
  const launch = fightLaunch(k, state, here, ctx.at, `alarm:${ctx.at.x},${ctx.at.y}`, {})
  return { launch: [launch], stop: true, line: '踩到了警報節點：館方叫出了兩個關卡小兵。' }
}

// ---- 層與層之間的休息 ----

/** 往下一層之後（掛點 report.after，netrun.descend）：感載減 rest_load（RAM 在戰鬥外本來就是滿的）。 */
export function restDraft(k: Kernel, state: GameState): ReportDraft {
  const rules = mazeRules(k)
  const changes: Change[] = []
  for (const id of partyOf(state)) {
    const cut = Math.min(rules.rest_load, state.actors[id]!.load)
    if (cut > 0) changes.push({ op: 'actor.track', id, track: 'load', delta: -cut })
  }
  const lines = ['層與層之間有一個館方的休息點：你們歇了一口氣，感載消退了一些，RAM 回滿。']
  return draftOf(state, 'maze.rest', 'rest', lines.join(''), changes, { lines })
}

/** 這一趟是不是迷宮館開的（用 report.after 判斷剛過的是不是往下一層）。 */
export function descendedInMaze(k: Kernel, state: GameState, action: string): boolean {
  return action === 'netrun.descend' && !!hereOf(k, state)
}

// ---- 結算（掛點 netrun.close） ----

/**
 * 這一趟結束了（outcome：done、left、retreat、located、defeat）：破關（done）照總回合數對標準的比例與倒下的人數評價，
 * 獎金乘評價、退押金、獎品表擲一次、籌碼換現金；其餘（打輸、全員拔線、中途登出）押金沒收、籌碼照算到那一刻。收回比賽甲板、計數器歸零。
 * 回傳併進結束那份報告的變更與句子；state.ext.maze 記下結果（over），由 report.after 發 maze.result 再清掉。
 */
export function closeRun(k: Kernel, state: GameState, run: RunLike, outcome: string): { changes: Change[]; lines: string[] } | undefined {
  const m = readMaze(state)
  if (!m || m.over || run.origin.by !== ORIGIN_BY) return undefined
  const rules = mazeRules(k)
  const tally = tallyOf(state, m, rules.layers.length)
  const rounds = tally.rounds.reduce((s, n) => s + n, 0)
  const standard = rules.layers.reduce((s, l) => s + l.standard, 0)
  const bracket: BracketDef | undefined = rules.brackets[m.bracket]
  const g = bracket?.grades.find((x) => x.grade === m.grade)
  const done = outcome === 'done'
  const changes: Change[] = []
  const lines: string[] = []
  let chips = tally.chips
  let prize = 0
  let refund = 0
  let rating: string | undefined
  let mult: number | undefined
  if (done) {
    const row = rate(rules, rounds, standard, tally.downs)
    rating = row.rating
    mult = row.mult
    prize = Math.round((g?.prize ?? 0) * row.mult)
    refund = m.deposit
    lines.push(`破關了，評價 ${row.rating}。`)
    // 館主的獎品表擲一次
    const got = reward(k, state, { rules, maze: m }, 'prize', `maze/${m.id}/prize`)
    changes.push({ op: 'rng', advance: 1 }, ...got.changes)
    chips += got.chips
    if (got.lines.length) lines.push('獎品室：', ...got.lines)
  } else {
    lines.push('你被送回了館方的回復室。押金沒收了，籌碼照算到這一刻。')
  }
  const chipCash = chips * rules.chip
  const cash = refund + prize + chipCash
  if (cash > 0) changes.push({ op: 'cash', delta: cash })
  // 收回比賽甲板
  if (m.rented.length && k.effects.has('deck_rental')) {
    // 收回館方的比賽甲板；報名前身上租的是潛艙店那一副的，換回那一副（不是收成沒有：人還在潛入中，M3 審查應修 4）
    const res = k.effects.resolve(m.rented.filter((id) => !!state.actors[id]).map((who) => ({ kind: 'deck_rental', deck: m.prior?.[who] ?? null, who }) as Effect), effectCtx(k, state, { source: 'builtin' }))
    if (!res.errors.length) changes.push(...res.changes)
  }
  changes.push(...resetTally(state, m, rules.layers.length))
  const result: MazeResult = {
    outcome, ...(rating ? { rating, mult } : {}), rounds, standard, downs: tally.downs, chips, prize, refund, forfeited: done ? 0 : m.deposit, chipCash,
    lines: lines.filter((l) => l.length > 0),
  } as MazeResult
  changes.push(mazeChange({ ...m, over: result }))
  return { changes, lines }
}

/** 結算之後（報告套用完、ext.maze 有 over）：發 maze.result 並把狀態清乾淨。 */
export function resultDraft(state: GameState, m: MazeState): ReportDraft {
  const r = m.over!
  const done = r.outcome === 'done'
  const nums = `回合 ${r.rounds}／標準 ${r.standard}，倒下 ${r.downs} 人次，籌碼 ${r.chips} 枚（換 ${formatAmount(r.chipCash)}）`
  const summary = done
    ? `迷宮館結算：評價 ${r.rating}（×${r.mult}）。${nums}。獎金 ${formatAmount(r.prize)}、押金 ${formatAmount(r.refund)} 退回。`
    : `迷宮館結算：這一趟沒闖過。${nums}。押金 ${formatAmount(r.forfeited)} 沒收。`
  const lines = done ? [`你闖過了迷宮館，評價 ${r.rating}。`] : ['你沒能闖過迷宮館，在回復室醒了過來。']
  const beat: TimelineBeat = { layer: 'net', ...(state.pc ? { actor: state.pc } : {}), text: lines[0]!, tag: 'maze.result', data: clone(r) as unknown as Record<string, unknown> }
  return draftOf(state, 'maze.result', done ? (r.rating ?? 'done') : 'forfeit', summary, [mazeChange(null)], { lines, beats: [beat] })
}

/** 一份有 over 的狀態（等著發結果）。 */
export const pendingResult = (state: GameState): MazeState | null => {
  const m = readMaze(state)
  return m?.over ? m : null
}

