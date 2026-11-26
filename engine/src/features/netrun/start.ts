// L6 功能 netrun：開始一趟（兩種活動共用）。檢查擋下的情況（各一句）→ 照區的規則表組每一層的 spec → 用種子生成 → 開地圖實例 → 放遭遇 → 追蹤度的起點 → 第一筆報告 netrun.enter。
// 規格：CYBERSPACE 8.1 節（生成的順序、密度表）；dev/adr/0018 第六、九節與 N2、N16、N26、N6；dev/work/M3-netrun.md 要做的第 2 項。

import type { Change, GameState, GenPlace, GenResult, GenSpec, Kernel, MarkerDef, Origin, ReportDraft, UnitRef } from '../../core'
import {
  ActionBlocked, NET_MAP_KINDS, clone, deriveRng, generateSheet, isRecord, openMap, seedRand, toMinutes,
} from '../../core'
import type { Fx, Goal, LayerCounts, NetExt, NetRegion, NetRun, NetrunRules, ObjectiveKind, Patrol, Rank, RunKind } from './model'
import type { DigPlan } from './dig'
import { ACT_FACE, ACT_NET, NET_MODE, OBJECTIVE_KINDS, OWNER, RANKS, TRACE, countsProblems, encounterAfter, gradeOf, isInt, isText, nodeAt, readRun, runChange } from './model'
import { makePatrol, moverChanges, nextPatrolId } from './patrol'
import { countsOf, netrunRules, regionOf } from './rules'
import { traceMod } from './tracemod'
import { applyHot, digCounts, digPlan, digTraceStart, extraWhite, markTraps, markedTrapChanges, reviveDig, tintColor } from './dig'
import { loginTriggers } from './common'

/** 層的名字（資料的 layer 欄位）→ 給玩家看的。 */
export const LAYER_NAME: Record<string, string> = { guest: '訪客層', staff: '員工層', control: '管理層', core: '核心層' }
export const layerLabel = (id: string | undefined, i: number): string => (isText(id) ? (LAYER_NAME[id] ?? id) : `第 ${i + 1} 層`)

/** 讀進來的設定（還沒檢查完的欄位在 problems 裡）。 */
export interface Parsed {
  region: unknown
  grade: number
  faction?: string
  layers: string[]
  encounter?: Rank[]
  color?: string
  seed?: number
  trace: number
  fx: Fx
  stealth: boolean
  decisive: boolean
  /**
   * 進網內的人（角色 id）：委託的內海階段由副本算好給（有橋、有甲板的人；沒有橋或沒有甲板的人留在現實當輔助，使用者 2026-11-24）。沒寫是整隊。
   * 這一趟進行中，partyOf 只回傳這幾個人（照隊伍的順序）
   */
  party?: string[]
  /** 這件委託的預備（技能「後門」之類，衍生數值 net_trace_start）已經在前面的內海階段套用過了：整趟只在第一個內海階段加一次（M3 審查應修 1；副本算好了給） */
  prepDone: boolean
  where?: Record<string, unknown>
  objective?: Record<string, unknown>
  /** 要放進這座網的控制節點（對到現實的哪個控制節點；M3-commission-net 算好給）：副本的 cn_ 開頭的 id，layer 沒寫放在管理層、沒有管理層放員工層 */
  controls: Array<{ node: string; name?: string; layer?: string }>
  /** 自己去挖（M3-netrun-dig）：entry 是 'dig'；facility 是設施類型的 id（沒寫就擲）；site 是這座子網的鍵（七天內同一個鍵是同一張圖）；
   *  fromBackdoor 是從哪一層的後門進來（圖的 id）；affixes 是直接指定的詞條（測試與特殊任務用；沒寫就擲） */
  entry?: 'dig'
  facility?: string
  site?: string
  fromBackdoor?: string
  affixes?: string[]
  /** 每一層各一份的密度（M4-curtain-fall：簾後館每一幕放的東西不一樣）：第 i 份只蓋掉那一層寫了的項目，沒寫的照區的規則表 */
  layerCounts?: Array<Partial<LayerCounts>>
}

/** 這一趟的設定：照格式讀；不合格的欄位寫成一條一句，讀得出來的照樣回傳（沒有問題時 problems 是空的）。 */
export function parseSetup(raw: unknown): { parsed: Parsed; problems: string[] } {
  const s = isRecord(raw) ? raw : {}
  const p: string[] = []
  if (!isRecord(raw)) p.push('開始的設定要是一個物件。')
  const grade = gradeOf(s.grade)
  if (grade === undefined) p.push('設定要寫這一趟的等級（grade，1～5 或 I～V）。')
  const fxRaw = isRecord(s.fx) ? s.fx : {}
  if (s.fx !== undefined && !isRecord(s.fx)) p.push('fx 要是一個物件。')
  const fx: Fx = {}
  for (const key of ['half', 'skip', 'trace_half', 'lace_down', 'gate_open', 'near_core'] as const) if (fxRaw[key] === true) fx[key] = true
  for (const key of ['minus', 'trace_start'] as const) {
    if (fxRaw[key] === undefined) continue
    if (isInt(fxRaw[key])) fx[key] = fxRaw[key] as number
    else p.push(`fx.${key} 要是整數。`)
  }
  let layers: string[] = []
  if (Array.isArray(s.layers)) {
    if (s.layers.length < 1 || s.layers.length > 8 || !s.layers.every((x) => typeof x === 'string')) p.push('layers 要是一到八個層的名字（字串）。')
    else layers = [...(s.layers as string[])]
  } else if (s.layers !== undefined) p.push('layers 要是層的名字的陣列。')
  if (!layers.length) layers = [typeof s.layer === 'string' ? s.layer : '']
  let encounter: Rank[] | undefined
  if (s.encounter !== undefined) {
    if (Array.isArray(s.encounter) && s.encounter.length <= 8 && s.encounter.every((r) => (RANKS as readonly unknown[]).includes(r))) encounter = [...(s.encounter as Rank[])]
    else p.push('encounter 要是位階（minion、elite、boss）的陣列，最多八個。')
  }
  let color: string | undefined
  if (s.lace !== undefined) {
    const c = typeof s.lace === 'string' ? s.lace : isRecord(s.lace) ? s.lace.color : undefined
    if (isText(c)) color = c
    else if (!(isRecord(s.lace) && s.lace.color === undefined)) p.push('lace 要寫蕾絲的顏色（white、pink、black）。')
  }
  if (s.seed !== undefined && !isInt(s.seed)) p.push('seed 要是整數。')
  if (s.trace !== undefined && !isInt(s.trace)) p.push('trace（追蹤度的起始值）要是整數。')
  if (s.faction !== undefined && !isText(s.faction)) p.push('faction 要是勢力的 id。')
  let party: string[] | undefined
  if (s.party !== undefined) {
    if (Array.isArray(s.party) && s.party.every(isText)) party = [...new Set(s.party as string[])]
    else p.push('party 要是角色 id 的陣列（進網內的人）。')
  }
  let objective: Record<string, unknown> | undefined
  if (s.objective !== undefined) {
    const o = s.objective
    if (!isRecord(o) || !isText(o.kind)) p.push('objective 要是 { kind, ... }，kind 是 download、seize、find、defeat、plant、extract（或 pass、clear）。')
    else if (![...OBJECTIVE_KINDS, 'pass', 'clear'].includes(o.kind as never)) p.push(`objective.kind 不認得「${o.kind}」（${[...OBJECTIVE_KINDS, 'pass', 'clear'].join('、')}）。`)
    else {
      if (o.turns !== undefined && !(isInt(o.turns) && o.turns >= 1 && o.turns <= 10)) p.push('objective.turns 要是 1～10 的整數。')
      if (o.kind === 'defeat' && o.foe !== undefined && !isText(o.foe)) p.push('objective.foe 要是敵人的 id。')
      if (o.item !== undefined && !isText(o.item)) p.push('objective.item 要是物品的 id。')
      if (o.node !== undefined && !isText(o.node)) p.push('objective.node 要是控制節點的 id。')
      objective = clone(o)
    }
  }
  const controls: Parsed['controls'] = []
  if (s.controls !== undefined) {
    if (!Array.isArray(s.controls)) p.push('controls 要是控制節點的清單（id，或 { node, name?, layer? }）。')
    else {
      for (const c of s.controls) {
        const node = typeof c === 'string' ? c : isRecord(c) ? c.node : undefined
        if (!isText(node)) p.push('controls 的每一筆要是控制節點的 id，或 { node, name?, layer? }。')
        else controls.push({ node, ...(isRecord(c) && isText(c.name) ? { name: c.name } : {}), ...(isRecord(c) && isText(c.layer) ? { layer: c.layer } : {}) })
      }
    }
  }
  let entry: 'dig' | undefined
  if (s.entry !== undefined) {
    if (s.entry === 'dig') entry = 'dig'
    else p.push("entry 只能是 'dig'（自己去挖的子網）。")
  }
  if (s.facility !== undefined && !isText(s.facility)) p.push('facility 要是設施類型的 id。')
  if (s.site !== undefined && !isText(s.site)) p.push('site 要是這座子網的鍵（字串）。')
  if (s.from_backdoor !== undefined && !isText(s.from_backdoor)) p.push('from_backdoor 要是圖的 id（第幾層的後門）。')
  let affixes: string[] | undefined
  if (s.affixes !== undefined) {
    if (Array.isArray(s.affixes) && s.affixes.every(isText) && s.affixes.length <= 8) affixes = [...(s.affixes as string[])]
    else p.push('affixes 要是詞條 id 的陣列（最多八個）。')
  }
  if (entry === 'dig' && !isText(s.site)) p.push('自己去挖的子網要寫 site（這座子網的鍵）。')
  let layerCounts: Array<Partial<LayerCounts>> | undefined
  if (s.layer_counts !== undefined) {
    if (!Array.isArray(s.layer_counts) || s.layer_counts.length > 8) p.push('layer_counts 要是每一層一份的陣列（最多八份）。')
    else {
      const bad = s.layer_counts.flatMap((c, i) => countsProblems(c, `layer_counts[${i}]`))
      if (bad.length) p.push(...bad.map((x) => `${x}。`))
      else layerCounts = clone(s.layer_counts as Array<Partial<LayerCounts>>)
    }
  }
  return {
    problems: p,
    parsed: {
      ...(entry ? { entry } : {}), ...(isText(s.facility) ? { facility: s.facility } : {}), ...(isText(s.site) ? { site: s.site } : {}),
      ...(isText(s.from_backdoor) ? { fromBackdoor: s.from_backdoor } : {}), ...(affixes ? { affixes } : {}),
      region: s.region === undefined ? 'subnet' : s.region, grade: grade ?? 1, ...(isText(s.faction) ? { faction: s.faction } : {}), layers,
      ...(party ? { party } : {}), ...(encounter ? { encounter } : {}), ...(color ? { color } : {}), ...(isInt(s.seed) ? { seed: s.seed } : {}), trace: isInt(s.trace) ? s.trace : 0, fx,
      stealth: s.stealth === true, decisive: s.decisive === true, prepDone: s.prep_done === true,
      ...(isRecord(s.where) ? { where: clone(s.where) } : {}), ...(objective ? { objective } : {}), controls, ...(layerCounts ? { layerCounts } : {}),
    },
  }
}

/** 這一趟的設定（run.setup 是開始時檢查過的）。 */
export const setupOf = (run: Pick<NetRun, 'setup'>): Parsed => parseSetup(run.setup).parsed

// ---- 生成 ----

/** 目標的那個節點在版面上的名字（生成器用名字認它）。 */
export const GOAL_NAME = '目標'

/** 這一層多放的東西：目標（kind 是下載、接管、找人、放東西、帶出來才放節點；打倒放在遭遇上，不另外放）與要連到現實的控制節點（各一個，名字不同）。 */
export interface LayerExtra {
  objective?: ObjectiveKind
  controls?: string[]
}

/** 一層的 spec：密度照區的規則表（委託的階段用 commission 那一組），位置的挑法見 core/grid/gen.ts。目標先放（先寫的先挑位置，放在離入口最遠的那一半）。 */
export function layerSpec(region: NetRegion, counts: LayerCounts, id: string, name: string, last: boolean, noFoe: boolean, extra: LayerExtra = {}): GenSpec {
  const places: GenPlace[] = []
  const add = (kind: string, count: [number, number], where: GenPlace['where'], label: string, more: Partial<GenPlace> = {}): void => {
    if (count[1] > 0) places.push({ kind, count, where, name: label, ...more })
  }
  const defeat = extra.objective === 'defeat'
  // 目標：檔案庫（下載、放東西、帶出來）、控制節點（接管）、人（找人）；打倒指定一場遭遇，至少要有一場
  const goalKind: Partial<Record<ObjectiveKind, string>> = { download: 'net_archive', plant: 'net_archive', extract: 'net_archive', seize: 'net_control', find: 'net_person' }
  const goalPlace = extra.objective ? goalKind[extra.objective] : undefined
  if (goalPlace) add(goalPlace, [1, 1], 'far_half', GOAL_NAME, { apart: 1 })
  for (const name of extra.controls ?? []) add('net_control', [1, 1], 'any', name)
  const foe: [number, number] = defeat ? [Math.max(1, counts.foe[0]), Math.max(1, counts.foe[1])] : counts.foe
  // 先寫的先挑位置：休息點在入口到出口那條路的一半左右，不貼著入口（8.1 節）
  add('net_rest', counts.rest, 'mid_path', '休息點', { apart: 1 })
  add('net_foe', noFoe && !defeat ? [0, 0] : foe, 'far_half', '遭遇', { apart: 1 })
  add('net_archive', counts.archive, 'dead_end', '檔案庫', { apart: 1 })
  add('net_safe', counts.safe, 'any', '安全點', { apart: 1 })
  add('net_control', counts.control, 'any', '控制節點')
  add('net_person', counts.person, 'any', '人')
  add('net_puzzle', region.puzzle ?? [0, 0], 'any', '機關', { apart: 1 })
  // 陷阱：看不到（N8），放在鏈路上；警報與迴圈碎片各一半（單數的多一個警報）
  const [lo, hi] = counts.trap
  add('net_alarm', [Math.ceil(lo / 2), Math.ceil(hi / 2)], 'link', '警報節點', { hidden: true, trap: true })
  add('net_loop', [Math.floor(lo / 2), Math.floor(hi / 2)], 'link', '迴圈碎片', { hidden: true, trap: true })
  return {
    id, name, size: [region.size[0], region.size[1]], carve: [region.carve[0], region.carve[1]], entry: { name: '入口' },
    exit: { kind: 'net_gate', name: last ? '出口' : '閘門' }, places, sight: region.sight,
    ...(region.oneway !== undefined ? { oneway: region.oneway } : {}), ...(region.fragile !== undefined ? { fragile: region.fragile } : {}), ...(region.loops !== undefined ? { loops: region.loops } : {}),
  }
}

/** 有幾個位階的點數（ENEMIES 第 13 節）；只有說明用。 */
export const POINTS: Record<Rank, number> = { minion: 1, elite: 2.5, boss: 5 }

interface Built {
  sheets: GenResult['sheet'][]
  net: NetExt
  /** 每一層的生成結果（找起點用） */
  results: GenResult[]
  /** 所有要挑的敵人，開始之前先問過挑不挑得到 */
  refs: UnitRef[]
  /** 目標放在哪（沒有節點的目標 pass、clear 沒有） */
  goalAt?: NonNullable<Goal['at']>
}

/** 目標放在第幾層：objective.layer 寫了層的名字就放那一層，沒寫放最後一層（委託的階段只有一層）。 */
function goalLayer(parsed: Parsed): number {
  const want = parsed.objective?.layer
  const i = typeof want === 'string' ? parsed.layers.indexOf(want) : -1
  return i >= 0 ? i : parsed.layers.length - 1
}

/** 要連到現實的控制節點放在第幾層：寫了層的名字就放那一層；沒寫放管理層，沒有管理層放員工層，再沒有就第一層。 */
function controlLayer(parsed: Parsed, layer: string | undefined): number {
  for (const want of [layer, 'control', 'staff']) {
    const i = want === undefined ? -1 : parsed.layers.indexOf(want)
    if (i >= 0) return i
  }
  return 0
}

const objectiveOf = (parsed: Parsed): ObjectiveKind | undefined => {
  const kind = parsed.objective?.kind
  return (OBJECTIVE_KINDS as readonly unknown[]).includes(kind) ? (kind as ObjectiveKind) : undefined
}

/** 一個一層的擲骰：由這一趟的種子與用途導出。 */
const randOf = (seed: number, mapId: string, what: string): (() => number) => seedRand(seed, `${mapId}/${what}`)

/** 生成每一層、決定每一個遭遇節點放誰（閘門前那一場最重；離入口越遠越重的取捨：只有守閘門的那一場用 encounter 的組合，其餘用一般的）、巡邏、看不到的陷阱。dig 是自己去挖的子網的計畫（詞條、設施類型）。 */
/** 生成時問發起的功能：這一隻遭遇的敵人要不要蓋上別的欄位（掛點 netrun.foe_ref）。 */
type RefHook = (info: { layer: number; sheet: string; node: string; guard: boolean; last: boolean; index: number; ranks: Rank[]; ref: UnitRef }) => Partial<UnitRef> | undefined

function build(region: NetRegion, kind: RunKind, parsed: Parsed, rules: NetrunRules, seed: number, mapId: string, dig?: DigPlan, refHook?: RefHook): Built {
  const baseCounts = countsOf(region, kind)
  const noFoe = parsed.encounter !== undefined && parsed.encounter.length === 0
  const objective = objectiveOf(parsed)
  const goalAtLayer = objective ? goalLayer(parsed) : -1
  const sheets: GenResult['sheet'][] = []
  const results: GenResult[] = []
  const net: NetExt = {
    region: region.id, grade: parsed.grade, ...(parsed.faction ? { faction: parsed.faction } : {}), dc: region.dc[parsed.grade - 1]!,
    graph: {}, hidden: {}, safe_path: {}, foes: {}, rested: [],
    traps: {}, patrols: [], controls: {}, keys: [], wiped: {}, used: {}, opened: [], backdoors: [],
  }
  const refs: UnitRef[] = []
  let goalAt: Built['goalAt']
  // 要連到現實的控制節點：每一個一個名字不同的節點
  const taken = new Set<string>([GOAL_NAME, '控制節點'])
  const controlNames = parsed.controls.map((c, n) => {
    let name = c.name ?? c.node
    if (taken.has(name)) name = `${name}（${n + 1}）`
    taken.add(name)
    return name
  })
  parsed.layers.forEach((name, i) => {
    const last = i === parsed.layers.length - 1
    const sheetId = `l${i + 1}`
    const label = layerLabel(name, i)
    const own = parsed.layerCounts?.[i]
    const layerCounts: LayerCounts = own ? { ...baseCounts, ...clone(own) } : baseCounts
    const counts = dig ? digCounts(layerCounts, dig, rules, i) : layerCounts
    const here = parsed.controls.map((c, n) => ({ c, n })).filter(({ c }) => controlLayer(parsed, c.layer) === i)
    const spec = layerSpec(region, counts, sheetId, label, last, noFoe, { ...(objective && goalAtLayer === i ? { objective } : {}), controls: here.map(({ n }) => controlNames[n]!) })
    let result: GenResult
    try {
      result = generateSheet(spec, seedRand(seed, `${mapId}/layer/${i}`))
    } catch (e) {
      throw new ActionBlocked(`這座網生成不出來（${label}：${(e as Error).message}）。`)
    }
    sheets.push(result.sheet)
    results.push(result)
    net.graph[sheetId] = result.graph
    net.hidden[sheetId] = result.hidden
    net.safe_path[sheetId] = result.safe_path
    // 看不到的陷阱（N8）：照生成器的 hidden 記下來，察覺與踩過各自記
    net.traps[sheetId] = result.hidden.filter((h) => h.trap && (h.kind === 'net_alarm' || h.kind === 'net_loop')).map((h) => ({ kind: h.kind as 'net_alarm' | 'net_loop', at: [h.at[0], h.at[1]] }))
    const cells = result.sheet.cells ?? []
    // 控制節點：要連到現實的對到那個節點，其餘的（密度表放的）沒有對應
    net.controls[sheetId] = {}
    for (const m of cells.filter((x) => x.mark === 'c')) {
      const link = here.find(({ n }) => controlNames[n] === m.name)
      net.controls[sheetId]![m.id] = link ? { node: link.c.node, name: link.c.name ?? link.c.node } : {}
    }
    // 目標
    const goalMarker = (mark: string): MarkerDef | undefined => cells.find((x) => x.mark === mark && x.name === GOAL_NAME)
    if (objective && goalAtLayer === i) {
      const found = objective === 'seize' ? goalMarker('c') : objective === 'find' ? goalMarker('p') : objective === 'defeat' ? undefined : goalMarker('a')
      if (found) {
        goalAt = { sheet: sheetId, id: found.id, pos: [found.at[0], found.at[1]] }
        if (objective === 'seize') net.controls[sheetId]![found.id] = { ...(typeof parsed.objective?.node === 'string' ? { node: parsed.objective.node } : {}), name: '目標' }
      } else if (objective !== 'defeat') throw new ActionBlocked(`這座網生成不出來（${label}：放不下目標）。`)
    }
    // 遭遇節點：離入口最遠的那一個守閘門（8.1 節：離入口越遠的遭遇越重，閘門前那一場是層主）
    const foes = cells.filter((m) => m.mark === 'f').map((m) => ({ m, depth: nodeAt(net, sheetId, m.at)?.depth ?? 0 }))
    foes.sort((a, b) => b.depth - a.depth || (a.m.id < b.m.id ? -1 : 1))
    net.foes[sheetId] = {}
    const color = dig ? tintColor(dig, parsed.color) : parsed.color
    foes.forEach(({ m }, j) => {
      const guard = j === 0
      const base = guard ? (parsed.encounter ?? (last ? rules.encounter.boss : rules.encounter.guard)) : rules.encounter.plain
      const ranks = encounterAfter(base, parsed.fx)
      const list: UnitRef[] = ranks.map((rank, n) => {
        const ref: UnitRef = {
          from: 'enemy_pick', faction: parsed.faction ?? 'none', grade: parsed.grade, rank, seed: `${seed}/${i}/${m.id}/${n}`,
          ...(color ? { color } : {}), layer: isText(name) ? name : label,
        }
        const extra = refHook?.({ layer: i, sheet: sheetId, node: m.id, guard, last, index: n, ranks, ref: clone(ref) })
        return extra ? { ...ref, ...clone(extra) } : ref
      })
      // 稽核週：每一層多幾隻白蕾絲（加在離入口最近的那一場：最重的那一場不再加重）
      if (dig && j === foes.length - 1) list.push(...extraWhite(dig, { faction: parsed.faction ?? 'none', grade: parsed.grade, seed: `${seed}/${i}/${m.id}/white`, layer: isText(name) ? name : label }))
      // 打倒：指定的敵人加進守閘門的那一場
      if (objective === 'defeat' && goalAtLayer === i && guard) {
        const foe = typeof parsed.objective?.foe === 'string' ? parsed.objective.foe : undefined
        if (foe) list.push({ from: 'enemy', id: foe, grade: parsed.grade })
        goalAt = { sheet: sheetId, id: m.id, pos: [m.at[0], m.at[1]] }
      }
      refs.push(...list)
      net.foes[sheetId]![m.id] = { foes: list, ...(parsed.faction ? { faction: parsed.faction } : {}), ...(guard ? { gate: true as const } : {}) }
    })
    if (objective === 'defeat' && goalAtLayer === i && !goalAt) throw new ActionBlocked(`這座網生成不出來（${label}：沒有遭遇可以放要打倒的敵人）。`)
    // 巡邏（N2：委託的階段也有一隊可以躲的；密度表 patrol）
    const rand = randOf(seed, mapId, `patrol/${i}`)
    const [lo, hi] = counts.patrol
    const n = lo + Math.floor(rand() * (hi - lo + 1))
    for (let j = 0; j < n; j++) {
      const id = nextPatrolId(net)
      const patrol = makePatrol({
        id, sheet: sheetId, graph: result.graph, rand, grade: parsed.grade, ...(parsed.faction ? { faction: parsed.faction } : {}), fx: parsed.fx,
        ...(color ? { color } : {}), layerName: isText(name) ? name : label, rules, seed: `${seed}/${i}/${id}`,
      })
      if (!patrol) break
      net.patrols.push(patrol)
      refs.push(...patrol.foes)
    }
  })
  if (dig) applyHot(dig, net, seed, mapId, parsed.layers.length)
  return { sheets, net, results, refs, ...(goalAt ? { goalAt } : {}) }
}

/** 入口放在閘門前一個走得上去的節點（fx.skip、fx.near_core）：沿著保證的路從出口往回找；找不到就是入口。 */
function nearGate(result: GenResult, sheet: GenResult['sheet']): [number, number] | undefined {
  const path = result.safe_path
  const nodes = new Set(result.graph.nodes.map((n) => `${n.at[0]},${n.at[1]}`))
  for (let i = path.length - 2; i >= 1; i--) {
    const [x, y] = path[i]!
    if (!nodes.has(`${x},${y}`)) continue
    const kind = sheet.layout[y]![x]!
    if (kind === 'f' || kind === 'm' || kind === 'v') continue
    return [x, y]
  }
  return undefined
}

/**
 * 進網內的人：隊上還在名冊裡的。這一趟進行中而且設定寫了 party（委託的內海階段：有橋、有甲板的人）時只有那幾個人；
 * only 是還沒開始的那一刻（startRun 自己讀的設定）。
 */
export function partyOf(state: GameState, only?: readonly string[]): string[] {
  const list = state.party.filter((id) => !!state.actors[id])
  const want = only ?? (Array.isArray(readRun(state)?.setup.party) ? (readRun(state)!.setup.party as unknown[]).filter(isText) : undefined)
  return want ? list.filter((id) => want.includes(id)) : list
}

/** net_burn 還沒過期的人（倒下之後一小時內不能再潛入）。 */
export function burnedOf(state: GameState, ids: string[]): string[] {
  const now = toMinutes(state.time)
  return ids.filter((id) => state.actors[id]!.conditions.some((c) => c.id === 'net_burn' && (c.until === undefined || c.until > now)))
}

/** 這一趟開不開得了：回傳擋下的原因（一條一句）；空的就是開得了。 */
export function startProblems(k: Kernel, state: GameState, parsedProblems: string[], only?: readonly string[]): string[] {
  const p = [...parsedProblems]
  const party = partyOf(state, only)
  if (!party.length) p.push(only ? '隊上沒有人有橋與甲板，進不了網內。' : '隊上沒有人，沒有人可以潛進去。')
  // 沒有人定義 deck_grade（甲板的功能沒裝）就不看
  if (party.length && k.stats.hasStat('deck_grade') && party.every((id) => k.stats.stat(state, id, 'deck_grade') <= 0)) p.push('隊上沒有人有甲板，潛不進網內。')
  const burned = burnedOf(state, party)
  if (burned.length) p.push(`${burned.map((id) => state.actors[id]!.name).join('、')}剛在網內倒下，還在燒傷中，一個小時內不能再潛入。`)
  return p
}

/** 開始一趟：回傳要提交的報告（netrun.enter）。不成立丟 ActionBlocked，一條一句接起來。 */
export function startRun(k: Kernel, state: GameState, kind: RunKind, rawSetup: unknown, origin: Origin): ReportDraft[] {
  const problems: string[] = []
  if (readRun(state)) problems.push('已經有一趟網內的行程在進行，先把它做完。')
  const { parsed, problems: bad } = parseSetup(rawSetup)
  problems.push(...startProblems(k, state, bad, parsed.party))
  const found = regionOf(k, parsed.region)
  if ('problem' in found) problems.push(found.problem)
  else if (!NET_MAP_KINDS.includes(found.region.map_kind)) problems.push(`這一區（${found.region.id}）的地圖種類 ${found.region.map_kind} 不是網內的地圖。`)
  if (parsed.entry === 'dig' && kind !== ACT_NET) problems.push('自己去挖的子網只能用 netrun 開，委託的階段不走這一條。')
  if (problems.length || 'problem' in found) throw new ActionBlocked(problems.join(''))
  const rules = netrunRules(k)

  // 自己去挖、七天內再進去同一座：用留著的那一份（不重新生成）
  if (parsed.entry === 'dig') {
    const back = reviveDig(k, state, parsed, origin, rawSetup)
    if (back) return back
  }

  const id = `n${state.seq.uid + 1}`
  const seed = parsed.seed ?? deriveRng(state.rng, `netrun/${id}/seed`).int(1, 2_000_000_000)
  const mapId = `net_${id}`
  // 自己去挖的新的一座：設施類型（層數與名字）、詞條（擲出來的）；過期留著的那一份在同一份報告裡清掉
  const plan = parsed.entry === 'dig' ? digPlan(k, state, parsed, found.region, seed, mapId, rawSetup) : undefined
  const region = plan ? plan.region : found.region
  const genParsed: Parsed = plan ? { ...parsed, layers: plan.names } : parsed
  const refHook: RefHook = (info) => {
    let merged: Partial<UnitRef> | undefined
    for (const h of k.hooks.run('netrun.foe_ref', { state, origin: clone(origin), setup: clone(isRecord(rawSetup) ? rawSetup : {}), ...info })) {
      if (isRecord(h.result)) merged = { ...(merged ?? {}), ...(h.result as Partial<UnitRef>) }
    }
    return merged
  }
  const built = build(region, kind, genParsed, rules, seed, mapId, plan, refHook)
  if (plan) {
    markTraps(plan, built.net)
    built.net.dig = plan.info
  }

  // 敵人先問過挑不挑得到：挑不到整步不成立（發起的那一份報告沒有套用）
  if (built.refs.length) {
    const seen = new Set<string>()
    for (const ref of built.refs) {
      const key = `${ref.from}/${String(ref.id ?? '')}/${String(ref.faction ?? '')}/${String(ref.rank ?? '')}/${String(ref.color ?? '')}/${String(ref.culture ?? '')}/${String(ref.grade ?? '')}`
      if (seen.has(key)) continue
      seen.add(key)
      const source = k.battle.getUnitSource(ref.from)
      if (!source) throw new ActionBlocked(`這座網的遭遇要用「${ref.from}」這種單位來源，但還沒有（敵人的功能沒有裝）。`)
      try {
        source(ref, { k, state, side: 'foe', mode: NET_MODE, grade: parsed.grade as never, allyCount: partyOf(state, parsed.party).length })
      } catch (e) {
        throw new ActionBlocked(`這座網守著節點的敵人挑不到（${(e as Error).message}）。`)
      }
    }
  }

  // 站在哪：第一層的入口；fx.skip、fx.near_core 是閘門前一個節點
  const first = built.results[0]!
  const near = parsed.fx.skip || parsed.fx.near_core ? nearGate(first, built.sheets[0]!) : undefined
  let opened: ReturnType<typeof openMap>
  try {
    opened = openMap(k, state, { id: mapId, kind: region.map_kind, size: [region.size[0], region.size[1]], sheets: built.sheets }, {
      owner: plan ? `${OWNER}:dig:${parsed.site}` : `${OWNER}:${id}`, sheet: built.sheets[0]!.id, ...(near ? { at: near } : {}), ext: { net: built.net }, seed, by: OWNER,
    })
  } catch (e) {
    throw new ActionBlocked(`這座網生成的地圖不合格（${(e as Error).message}）。`)
  }

  // 追蹤度的起點：setup.trace 加連動的 trace_start 加全隊的 net_trace_start（有人定義才讀）。
  // 預備的 net_trace_start 整趟委託只加一次：後面的內海階段 setup.trace 已經是整趟累計（含第一段加過的），副本給 prep_done 就不再加（M3 審查應修 1）
  const fromParty = !parsed.prepDone && k.stats.hasStat('net_trace_start') ? partyOf(state, parsed.party).reduce((s, a) => s + k.stats.stat(state, a, 'net_trace_start'), 0) : 0
  // 自己去挖：那家的敵對值分段（N16）加詞條的起始值（再進去的另外從上次離開的一半起算，那是 reviveDig 的事）
  // 加上義體的起跳（回報後門：在那一家的子網裡起跳 +5；掛點 netrun.trace_mod）
  const backdoor = traceMod(k, state, partyOf(state, parsed.party), parsed.faction, 'start', 0)
  const traceStart = (plan ? digTraceStart(k, state, parsed, plan, fromParty) : parsed.trace + (parsed.fx.trace_start ?? 0) + fromParty) + backdoor
  const goal: Goal = parsed.objective && isText(parsed.objective.kind)
    ? { ...clone(parsed.objective), kind: parsed.objective.kind as string }
    : { kind: kind === ACT_FACE ? 'pass' : 'clear' }
  if (built.goalAt) goal.at = built.goalAt
  if (goal.kind === 'download' && goal.turns === undefined) goal.turns = rules.download_turns
  if (goal.kind === 'plant' && goal.turns === undefined) goal.turns = rules.plant_turns
  const run: NetRun = {
    id, kind, origin: clone(origin), region: region.id, grade: parsed.grade, ...(parsed.faction ? { faction: parsed.faction } : {}),
    map: opened.id, layers: built.sheets.map((s) => s.id), layer: 0, round: 0, goal, setup: plan ? clone(plan.setup) : clone(isRecord(rawSetup) ? rawSetup : {}), loot: [],
    peak: Math.max(0, traceStart), entered: [],
  }
  const changes: Change[] = [
    { op: 'uid', advance: 1 }, ...(plan?.dropped ?? []), ...opened.changes, ...(plan ? markedTrapChanges(plan, built.net, opened.id) : []), ...(region.pressure === 'trace' && k.meters.has(TRACE) ? [{ op: 'meter', kind: TRACE, key: opened.id, set: traceStart } as Change] : []),
    ...moverChanges({ map: opened.id }, built.net, built.net.patrols as Patrol[]), runChange(run),
  ]
  const notes: string[] = []
  if (parsed.fx.trace_start) notes.push(`連動讓追蹤度從 ${traceStart} 起算。`)
  if (parsed.fx.skip || parsed.fx.near_core) notes.push('不必從頭探索，直接到了閘門前面。')
  if (parsed.fx.lace_down) notes.push('蕾絲弱了一級。')
  if (parsed.fx.gate_open) notes.push('閘門不用破解。')
  if (plan && plan.names.length !== parsed.layers.length) notes.push('這座網比一般的多一層。')
  const label = layerLabel(genParsed.layers[0], 0)
  const summary = `你潛進了「${region.name}」：${label}${genParsed.layers.length > 1 ? `（共 ${genParsed.layers.length} 層）` : ''}。${notes.join('')}`
  return [{
    kind: 'netrun', action: 'netrun.enter', location: { ...clone(state.location), subnet: { id: region.id, layer: 1 } }, ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [],
    changes, outcome: { result: 'entered', summary }, ...(notes.length ? { narration: { results: notes } } : {}), triggers: loginTriggers(k, state),
  }]
}

export type { NetRun }
