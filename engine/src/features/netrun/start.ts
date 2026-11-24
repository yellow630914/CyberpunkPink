// L6 功能 netrun：開始一趟（兩種活動共用）。檢查擋下的情況（各一句）→ 照區的規則表組每一層的 spec → 用種子生成 → 開地圖實例 → 放遭遇 → 追蹤度的起點 → 第一筆報告 netrun.enter。
// 規格：CYBERSPACE 8.1 節（生成的順序、密度表）；dev/adr/0018 第六、九節與 N2、N16、N26、N6；dev/work/M3-netrun.md 要做的第 2 項。

import type { Change, GameState, GenPlace, GenResult, GenSpec, Kernel, Origin, ReportDraft, UnitRef } from '../../core'
import {
  ActionBlocked, NET_MAP_KINDS, clone, deriveRng, generateSheet, isRecord, openMap, seedRand, toMinutes,
} from '../../core'
import type { Fx, Goal, LayerCounts, NetExt, NetRegion, NetRun, NetrunRules, Rank, RunKind } from './model'
import { ACT_FACE, NET_MODE, OWNER, RANKS, TRACE, encounterAfter, gradeOf, isInt, isText, nodeAt, readRun, runChange } from './model'
import { countsOf, netrunRules, regionOf } from './rules'

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
  where?: Record<string, unknown>
  objective?: Record<string, unknown>
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
  return {
    problems: p,
    parsed: {
      region: s.region === undefined ? 'subnet' : s.region, grade: grade ?? 1, ...(isText(s.faction) ? { faction: s.faction } : {}), layers,
      ...(encounter ? { encounter } : {}), ...(color ? { color } : {}), ...(isInt(s.seed) ? { seed: s.seed } : {}), trace: isInt(s.trace) ? s.trace : 0, fx,
      stealth: s.stealth === true, decisive: s.decisive === true,
      ...(isRecord(s.where) ? { where: clone(s.where) } : {}), ...(isRecord(s.objective) ? { objective: clone(s.objective) } : {}),
    },
  }
}

/** 這一趟的設定（run.setup 是開始時檢查過的）。 */
export const setupOf = (run: Pick<NetRun, 'setup'>): Parsed => parseSetup(run.setup).parsed

// ---- 生成 ----

/** 一層的 spec：密度照區的規則表（委託的階段用 commission 那一組），位置的挑法見 core/grid/gen.ts。 */
export function layerSpec(region: NetRegion, counts: LayerCounts, id: string, name: string, last: boolean, noFoe: boolean): GenSpec {
  const places: GenPlace[] = []
  const add = (kind: string, count: [number, number], where: GenPlace['where'], label: string, more: Partial<GenPlace> = {}): void => {
    if (count[1] > 0) places.push({ kind, count, where, name: label, ...more })
  }
  // 先寫的先挑位置：休息點在入口到出口那條路的一半左右，不貼著入口（8.1 節）
  add('net_rest', counts.rest, 'mid_path', '休息點', { apart: 1 })
  add('net_foe', noFoe ? [0, 0] : counts.foe, 'far_half', '遭遇', { apart: 1 })
  add('net_archive', counts.archive, 'dead_end', '檔案庫', { apart: 1 })
  add('net_safe', counts.safe, 'any', '安全點', { apart: 1 })
  add('net_control', counts.control, 'any', '控制節點')
  add('net_person', counts.person, 'any', '人')
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
}

/** 生成每一層、決定每一個遭遇節點放誰（閘門前那一場最重；離入口越遠越重的取捨：只有守閘門的那一場用 encounter 的組合，其餘用一般的）。 */
function build(region: NetRegion, kind: RunKind, parsed: Parsed, rules: NetrunRules, seed: number, mapId: string): Built {
  const counts = countsOf(region, kind)
  const noFoe = parsed.encounter !== undefined && parsed.encounter.length === 0
  const sheets: GenResult['sheet'][] = []
  const results: GenResult[] = []
  const net: NetExt = {
    region: region.id, grade: parsed.grade, ...(parsed.faction ? { faction: parsed.faction } : {}), dc: region.dc[parsed.grade - 1]!,
    graph: {}, hidden: {}, safe_path: {}, foes: {}, rested: [],
  }
  const refs: UnitRef[] = []
  parsed.layers.forEach((name, i) => {
    const last = i === parsed.layers.length - 1
    const sheetId = `l${i + 1}`
    const label = layerLabel(name, i)
    const spec = layerSpec(region, counts, sheetId, label, last, noFoe)
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
    // 遭遇節點：離入口最遠的那一個守閘門（8.1 節：離入口越遠的遭遇越重，閘門前那一場是層主）
    const foes = (result.sheet.cells ?? []).filter((m) => m.mark === 'f').map((m) => ({ m, depth: nodeAt(net, sheetId, m.at)?.depth ?? 0 }))
    foes.sort((a, b) => b.depth - a.depth || (a.m.id < b.m.id ? -1 : 1))
    net.foes[sheetId] = {}
    foes.forEach(({ m }, j) => {
      const guard = j === 0
      const base = guard ? (parsed.encounter ?? (last ? rules.encounter.boss : rules.encounter.guard)) : rules.encounter.plain
      const ranks = encounterAfter(base, parsed.fx)
      const list: UnitRef[] = ranks.map((rank, n) => ({
        from: 'enemy_pick', faction: parsed.faction ?? 'none', grade: parsed.grade, rank, seed: `${seed}/${i}/${m.id}/${n}`,
        ...(parsed.color ? { color: parsed.color } : {}), layer: isText(name) ? name : label,
      }))
      refs.push(...list)
      net.foes[sheetId]![m.id] = { foes: list, ...(parsed.faction ? { faction: parsed.faction } : {}), ...(guard ? { gate: true as const } : {}) }
    })
  })
  return { sheets, net, results, refs }
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

/** 隊上的人（還在名冊裡的）。 */
export const partyOf = (state: GameState): string[] => state.party.filter((id) => !!state.actors[id])

/** net_burn 還沒過期的人（倒下之後一小時內不能再潛入）。 */
export function burnedOf(state: GameState, ids: string[]): string[] {
  const now = toMinutes(state.time)
  return ids.filter((id) => state.actors[id]!.conditions.some((c) => c.id === 'net_burn' && (c.until === undefined || c.until > now)))
}

/** 這一趟開不開得了：回傳擋下的原因（一條一句）；空的就是開得了。 */
export function startProblems(k: Kernel, state: GameState, parsedProblems: string[]): string[] {
  const p = [...parsedProblems]
  const party = partyOf(state)
  if (!party.length) p.push('隊上沒有人，沒有人可以潛進去。')
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
  problems.push(...startProblems(k, state, bad))
  const found = regionOf(k, parsed.region)
  if ('problem' in found) problems.push(found.problem)
  else if (!NET_MAP_KINDS.includes(found.region.map_kind)) problems.push(`這一區（${found.region.id}）的地圖種類 ${found.region.map_kind} 不是網內的地圖。`)
  if (problems.length || 'problem' in found) throw new ActionBlocked(problems.join(''))
  const region = found.region
  const rules = netrunRules(k)

  const id = `n${state.seq.uid + 1}`
  const seed = parsed.seed ?? deriveRng(state.rng, `netrun/${id}/seed`).int(1, 2_000_000_000)
  const mapId = `net_${id}`
  const built = build(region, kind, parsed, rules, seed, mapId)

  // 敵人先問過挑不挑得到：挑不到整步不成立（發起的那一份報告沒有套用）
  if (built.refs.length) {
    const source = k.battle.getUnitSource('enemy_pick')
    if (!source) throw new ActionBlocked('這座網的遭遇要照勢力挑敵人，但還沒有「enemy_pick」這種單位來源（敵人的功能沒有裝）。')
    const seen = new Set<string>()
    for (const ref of built.refs) {
      const key = `${ref.faction}/${ref.rank}/${ref.color ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        source(ref, { k, state, side: 'foe', mode: NET_MODE, grade: parsed.grade as never, allyCount: partyOf(state).length })
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
      owner: `${OWNER}:${id}`, sheet: built.sheets[0]!.id, ...(near ? { at: near } : {}), ext: { net: built.net }, seed, by: OWNER,
    })
  } catch (e) {
    throw new ActionBlocked(`這座網生成的地圖不合格（${(e as Error).message}）。`)
  }

  // 追蹤度的起點：setup.trace 加連動的 trace_start 加全隊的 net_trace_start（有人定義才讀）
  const fromParty = k.stats.hasStat('net_trace_start') ? partyOf(state).reduce((s, a) => s + k.stats.stat(state, a, 'net_trace_start'), 0) : 0
  const traceStart = parsed.trace + (parsed.fx.trace_start ?? 0) + fromParty
  const goal: Goal = parsed.objective && isText(parsed.objective.kind)
    ? { ...clone(parsed.objective), kind: parsed.objective.kind as string }
    : { kind: kind === ACT_FACE ? 'pass' : 'clear' }
  const run: NetRun = {
    id, kind, origin: clone(origin), region: region.id, grade: parsed.grade, ...(parsed.faction ? { faction: parsed.faction } : {}),
    map: opened.id, layers: built.sheets.map((s) => s.id), layer: 0, round: 0, goal, setup: clone(isRecord(rawSetup) ? rawSetup : {}), loot: [],
    peak: Math.max(0, traceStart), entered: [],
  }
  const changes: Change[] = [{ op: 'uid', advance: 1 }, ...opened.changes, ...(region.pressure === 'trace' && k.meters.has(TRACE) ? [{ op: 'meter', kind: TRACE, key: opened.id, set: traceStart } as Change] : []), runChange(run)]
  const notes: string[] = []
  if (parsed.fx.trace_start) notes.push(`連動讓追蹤度從 ${traceStart} 起算。`)
  if (parsed.fx.skip || parsed.fx.near_core) notes.push('不必從頭探索，直接到了閘門前面。')
  if (parsed.fx.lace_down) notes.push('蕾絲弱了一級。')
  if (parsed.fx.gate_open) notes.push('閘門不用破解。')
  const label = layerLabel(parsed.layers[0], 0)
  const summary = `你潛進了「${region.name}」：${label}${parsed.layers.length > 1 ? `（共 ${parsed.layers.length} 層）` : ''}。${notes.join('')}`
  return [{
    kind: 'netrun', action: 'netrun.enter', location: { ...clone(state.location), subnet: { id: region.id, layer: 1 } }, ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [],
    changes, outcome: { result: 'entered', summary }, ...(notes.length ? { narration: { results: notes } } : {}),
  }]
}

export type { NetRun }
