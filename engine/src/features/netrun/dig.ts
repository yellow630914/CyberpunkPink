// L6 功能 netrun：自己去挖的一般子網（M3-netrun-dig；dev/work/M3-netrun-dig.md）。
// 規格：CYBERSPACE 8.1 節（每一層的密度、共通詞條、帶出去才算數）、8.3 節（兩種進去的方式、設施類型、每一層放什麼、追蹤度在生成的子網裡、詞條）；
// NETRUNNING 第 4 節（後門）、第 5 節（登出時留下的敵對值、起始值）；DATA 第 10 節；dev/adr/0018 第六節與 N1、N2、N16、N35。
//
// 和委託的階段（face.net）的差別：
//   - 層數與名字照設施類型（net_facility），每一層照密度表放東西，自己去挖每層檔案庫多一個；詞條：區的詞條表擲一次，III 級以上再擲一次共通詞條（net_affix）。
//   - 離開之後地圖實例留著（owner 是 netrun:dig:<site>，ext.net.left 記離開的時間與追蹤度）；七天（keep_days）內用同一個 site 再進去是同一張圖：
//     處理過的節點、拿過的檔案庫、打掉的遭遇都照舊，巡邏回到起點，追蹤度從上次離開時的一半起算（和敵對值分段的起始值取高的）；過期的在 time.passed 清掉。
//   - 後門：有主控的人花一個探索回合在這一層留下，下次可以從那一層直接進來、追蹤度 0；被定位之後每個後門各有一半的機會被清掉（骰面由種子、層與第幾次進去固定）。
//   - 離開時那家企業的敵對值照追蹤度加（每 leave_hostility 點 +1，進位，最多 leave_hostility_max；被定位另外加 located_hostility）。
//   - 時間：每個探索回合 round_minutes 分鐘（rounds.ts 的 advanceRound）。
// 這個功能不 import 別的功能：敵對值只問條件 hostility_tier 與效果 hostility（沒有人登記就沒有），主控的階數走 checks.ts 的 masterTier。

import type { Change, GameState, GridUse, Kernel, MapInstance, Origin, ReportDraft, UnitRef } from '../../core'
import { ActionBlocked, Sheet, clone, closeMap, deriveRng, effectCtx, isRecord, seedRand, sightOf, toMinutes } from '../../core'
import { bestTier } from './checks'
import { draft } from './common'
import type { AffixFx, DigInfo, NetAffix, NetExt, NetFacility, NetRegion, NetRun, NetrunRules } from './model'
import { ACT_NET, AFFIX_KIND, FACILITY_KIND, NET_MODE, OWNER, TRACE, netExt, netExtChange, nodeAt, readRun, runChange } from './model'
import { moverChanges } from './patrol'
import { advanceRound, newOut, patrolFight, workChanges, workOf } from './rounds'
import { netrunRules, regionOf } from './rules'
import { layerLabel, partyOf } from './start'
import type { Parsed } from './start'

/** 自己去挖的子網的地圖實例的 owner：同一個 site 同一時間只有一份。 */
export const digOwner = (site: string): string => `${OWNER}:dig:${site}`
const DIG_PREFIX = `${OWNER}:dig:`

/** 這一趟是不是自己去挖的（setup 帶 entry: 'dig' 與 site）。 */
export const isDigRun = (run: Pick<NetRun, 'setup'>): boolean => run.setup.entry === 'dig' && typeof run.setup.site === 'string' && run.setup.site.length > 0

/** 留著的那一座（這個 site 的實例；沒有是 undefined）。 */
export function keptOf(state: GameState, site: string): MapInstance | undefined {
  return Object.values(state.maps.instances).find((m) => m.owner === digOwner(site))
}

/** 離開之後過了幾天算過期：超過 keep_days 天（剛好七天還算）。沒有 left（人還在裡面、或壞掉的）不算過期。 */
export function expired(rules: NetrunRules, net: NetExt | null, nowMinutes: number): boolean {
  return !!net?.left && nowMinutes - net.left.at > rules.keep_days * 1440
}

// ---- 詞條 ----

/** 把好幾條詞條的效果合起來：數字相加、旗標有一條就算、oneway 取最高。 */
export function combineFx(list: ReadonlyArray<AffixFx | undefined>): AffixFx {
  const out: Record<string, number | true> = {}
  for (const fx of list) {
    if (!fx) continue
    for (const [key, v] of Object.entries(fx)) {
      if (v === true) out[key] = true
      else if (typeof v === 'number') out[key] = key === 'oneway' ? Math.max(typeof out[key] === 'number' ? (out[key] as number) : 0, v) : (typeof out[key] === 'number' ? (out[key] as number) : 0) + v
    }
  }
  return out as AffixFx
}

/** 詞條表：這一區的（region.affixes，沒寫是 net_affix 裡 region 等於這一區的）與共通的（沒有 region 的）。只收查得到的。 */
export function affixTables(k: Pick<Kernel, 'content'>, region: NetRegion): { region: string[]; common: string[] } {
  const all = k.content.list<NetAffix & { region?: string }>(AFFIX_KIND)
  const byId = new Set(all.map((a) => a.id))
  const own = region.affixes ? region.affixes.filter((id) => byId.has(id)) : all.filter((a) => a.region === region.id).map((a) => a.id)
  return { region: [...own].sort(), common: all.filter((a) => a.region === undefined).map((a) => a.id).sort() }
}

/** 擲詞條：這一區的詞條表擲一次，III 級以上再擲一次共通詞條表（CYBERSPACE 8.1 節「生成的順序」第 1 步）。骰面由種子導出。 */
export function rollAffixes(k: Pick<Kernel, 'content'>, region: NetRegion, grade: number, seed: number, mapId: string): string[] {
  const tables = affixTables(k, region)
  const out: string[] = []
  const pickFrom = (list: string[], what: string): void => {
    if (!list.length) return
    const id = list[Math.floor(seedRand(seed, `${mapId}/affix/${what}`)() * list.length)]!
    if (!out.includes(id)) out.push(id)
  }
  pickFrom(tables.region, 'region')
  if (grade >= 3) pickFrom(tables.common, 'common')
  return out
}

// ---- 新的一座 ----

export interface DigPlan {
  /** 套上詞條之後的區（單向鏈路的比例） */
  region: NetRegion
  facility: NetFacility
  /** 每一層的名字（含詞條多出來的一層） */
  names: string[]
  affixes: string[]
  fx: AffixFx
  /** 這一趟的設定（run.setup）：原樣加上設施類型、層的名字與詞條 */
  setup: Record<string, unknown>
  /** 要存進地圖實例的 ext.net.dig */
  info: DigInfo
  /** 過期留著的那一份在同一份報告裡清掉 */
  dropped: Change[]
}

/** 這一趟用哪一種設施類型：寫了就用它，沒寫就擲（CYBERSPACE 8.3 節「挑一間，或擲設施類型」；種子導出）。 */
function facilityFor(k: Kernel, parsed: Parsed, seed: number, mapId: string): NetFacility {
  if (parsed.facility) {
    const f = k.content.get<NetFacility>(FACILITY_KIND, parsed.facility)
    if (!f) throw new ActionBlocked(`找不到設施類型「${parsed.facility}」，這座子網開不起來。`)
    return clone(f)
  }
  const all = k.content.list<NetFacility>(FACILITY_KIND).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!all.length) throw new ActionBlocked('沒有任何設施類型（net_facility），自己去挖的子網開不起來。')
  return clone(all[Math.floor(seedRand(seed, `${mapId}/facility`)() * all.length)]!)
}

/** 新的一座的計畫。詞條寫了（setup.affixes）就用它，沒寫就擲；查不到的 id 擋下。 */
export function digPlan(k: Kernel, state: GameState, parsed: Parsed, region: NetRegion, seed: number, mapId: string): DigPlan {
  const site = parsed.site!
  const old = keptOf(state, site)
  const facility = facilityFor(k, parsed, seed, mapId)
  let affixes: string[]
  if (parsed.affixes) {
    const missing = parsed.affixes.filter((id) => !k.content.has(AFFIX_KIND, id))
    if (missing.length) throw new ActionBlocked(`找不到詞條「${missing[0]}」，這座子網開不起來。`)
    affixes = [...new Set(parsed.affixes)]
  } else affixes = rollAffixes(k, region, parsed.grade, seed, mapId)
  const temper = parsed.faction ? region.temper?.[parsed.faction] : undefined
  const fx = combineFx([...affixes.map((id) => k.content.get<NetAffix>(AFFIX_KIND, id)?.fx), temper])
  const names = [...facility.layers]
  for (let i = 0; i < (fx.layer_plus ?? 0) && names.length < 8; i++) names.splice(names.length - 1, 0, names[Math.max(0, names.length - 2)]!)
  const out: NetRegion = { ...clone(region), ...(fx.oneway !== undefined ? { oneway: Math.max(region.oneway ?? 0, fx.oneway) } : {}) }
  // 生成時的設定：之後再進去照它重開一趟（stealth、from_backdoor 是每一趟自己的，不留）
  const setup: Record<string, unknown> = {
    entry: 'dig', site, region: parsed.region, grade: parsed.grade, ...(parsed.faction ? { faction: parsed.faction } : {}), facility: facility.id, layers: names, affixes,
    ...(parsed.color ? { lace: parsed.color } : {}), ...(parsed.where ? { where: clone(parsed.where) } : {}),
  }
  const info: DigInfo = { site, facility: facility.id, names, affixes, fx, setup: clone(setup), visits: 1, rolls: {} }
  return { region: out, facility, names, affixes, fx, setup, info, dropped: old ? closeMap(state, old.id) : [] }
}

/** 層的密度：密度表照詞條加減，每一層檔案庫多 dig_archive_plus 個，控制節點照設施類型。數字不會低於 0。 */
export function digCounts(base: NetRegion['layer'], plan: DigPlan, rules: NetrunRules, _layer: number): NetRegion['layer'] {
  const fx = plan.fx
  const add = (r: [number, number], d: number): [number, number] => [Math.max(0, r[0] + d), Math.max(0, r[1] + d)]
  const c = plan.facility.controls
  return {
    ...base,
    foe: add(base.foe, (fx.foe_plus ?? 0) - (fx.foe_minus ?? 0)),
    patrol: fx.no_patrol ? [0, 0] : add(base.patrol, fx.patrol_plus ?? 0),
    archive: add(base.archive, rules.dig_archive_plus + (fx.archive_plus ?? 0) - (fx.archive_minus ?? 0)),
    trap: add(base.trap, -(fx.trap_minus ?? 0)),
    ...(c > 0 ? { control: [c, c] as [number, number] } : {}),
  }
}

/** 蕾絲全是粉的：所有的敵人都挑粉的（指定了黑的不動）。 */
export const tintColor = (plan: DigPlan, color: string | undefined): string | undefined => (plan.fx.all_pink && color !== 'black' ? 'pink' : color)

/** 稽核週：每一層多幾隻白蕾絲（all_pink 時是粉的）。 */
export function extraWhite(plan: DigPlan, o: { faction: string; grade: number; seed: string; layer: string }): UnitRef[] {
  return Array.from({ length: plan.fx.white_plus ?? 0 }, (_, n) => ({
    from: 'enemy_pick', faction: o.faction, grade: o.grade, rank: 'minion', color: plan.fx.all_pink ? 'pink' : 'white', seed: `${o.seed}/${n}`, layer: o.layer,
  }))
}

/**
 * 熱點：一場遭遇的敵人等級 +1（不超過 5），那一場後面的檔案庫（那一層離入口最遠的）多擲一次；
 * 多一層：最後一層的每個檔案庫多擲一次。記在 info.rolls（圖的 id → 標記 id → 多擲幾次）。
 */
export function applyHot(plan: DigPlan, net: NetExt, seed: number, mapId: string, layers: number): void {
  const rolls = plan.info.rolls
  const bump = (sheet: string, id: string): void => {
    rolls[sheet] = { ...(rolls[sheet] ?? {}), [id]: (rolls[sheet]?.[id] ?? 0) + 1 }
  }
  const archivesOf = (sheet: string): Array<{ id: string; depth: number }> => (net.graph[sheet]?.nodes ?? []).filter((n) => n.kind === 'net_archive').map((n) => ({ id: n.id, depth: n.depth }))
  if (plan.fx.hot_spot) {
    const all: Array<{ sheet: string; id: string; gate: boolean }> = []
    for (const [sheet, list] of Object.entries(net.foes)) for (const [id, f] of Object.entries(list)) all.push({ sheet, id, gate: f.gate === true })
    all.sort((a, b) => (a.sheet === b.sheet ? (a.id < b.id ? -1 : 1) : a.sheet < b.sheet ? -1 : 1))
    const plain = all.filter((f) => !f.gate)
    const pool = plain.length ? plain : all
    if (pool.length) {
      const hot = pool[Math.floor(seedRand(seed, `${mapId}/hot`)() * pool.length)]!
      for (const ref of net.foes[hot.sheet]![hot.id]!.foes) if (ref.from === 'enemy_pick' && typeof ref.grade === 'number') ref.grade = Math.min(5, ref.grade + 1)
      const behind = archivesOf(hot.sheet).sort((a, b) => b.depth - a.depth || (a.id < b.id ? -1 : 1))[0]
      if (behind) bump(hot.sheet, behind.id)
    }
  }
  if ((plan.fx.layer_plus ?? 0) > 0) for (const a of archivesOf(`l${layers}`)) bump(`l${layers}`, a.id)
}

/** 有人留了記號：陷阱一開始就看得到（記成察覺過了）。在開地圖之前先改 net。 */
export function markTraps(plan: DigPlan, net: NetExt): void {
  if (!plan.fx.trap_marked) return
  for (const list of Object.values(net.traps)) for (const t of list) { t.found = true; t.checked = true }
}

/** 看得到的陷阱在版面上的那一格改成警報節點／迴圈碎片（開地圖之後接著做）。 */
export function markedTrapChanges(plan: DigPlan, net: NetExt, map: string): Change[] {
  if (!plan.fx.trap_marked) return []
  return Object.entries(net.traps).filter(([, list]) => list.length).map(([sheet, list]) => ({
    op: 'map.sheet', map, sheet, cells: Object.fromEntries(list.map((t) => [`${t.at[0]},${t.at[1]}`, { kind: t.kind }])),
  }) as Change)
}

// ---- 追蹤度的起始值 ----

/** 那家企業對你的敵對值的分段決定的起始值（N16：記名 15、通緝 30）。沒有人登記 hostility_tier 就是 0。 */
export function hostilityStart(k: Kernel, state: GameState, faction: string | undefined): number {
  if (!faction || !k.conditions.kinds().includes('hostility_tier')) return 0
  const at = (min: string): boolean => k.conditions.test({ kind: 'hostility_tier', faction, min } as never, { state, stats: k.stats, timeRules: k.timeRules })
  return at('wanted') ? 30 : at('recorded') ? 15 : 0
}

/** 新的一座的起始追蹤度：敵對值的分段，加詞條的 trace_start、設定寫的、全隊的 net_trace_start。 */
export function digTraceStart(k: Kernel, state: GameState, parsed: Parsed, plan: DigPlan, fromParty: number): number {
  return hostilityStart(k, state, parsed.faction) + parsed.trace + (parsed.fx.trace_start ?? 0) + (plan.fx.trace_start ?? 0) + fromParty
}

// ---- 再進去 ----

/** 這一層的入口（格子）。 */
function entryOf(inst: MapInstance, sheetId: string): [number, number] | undefined {
  const m = inst.gen?.map.sheets.find((s) => s.id === sheetId)?.cells?.find((c) => c.mark === 'E')
  return m ? [m.at[0], m.at[1]] : undefined
}

/**
 * 七天內再進去同一座：用留著的那一份。處理過的節點、拿過的檔案庫、打掉的遭遇都照舊；巡邏回到起點；追蹤度從上次離開時的一半起算
 * （和敵對值分段的起始值取高的），從後門進來是 0；被定位過的，每一場還沒處理的遭遇多 located_foe_plus 個雜兵。
 * 沒有留著的、過期了、壞掉了回傳 null（呼叫的人照新的一座生成）。
 */
export function reviveDig(k: Kernel, state: GameState, parsed: Parsed, origin: Origin, rawSetup: unknown): ReportDraft[] | null {
  const inst = keptOf(state, parsed.site!)
  const net = inst ? netExt(state, inst.id) : null
  const rules = netrunRules(k)
  if (!inst || !net?.dig || !net.left || !inst.gen || expired(rules, net, toMinutes(state.time))) return null
  const dig = net.dig
  const layers = inst.gen.map.sheets.map((s) => s.id)
  const raw = isRecord(rawSetup) ? rawSetup : {}
  // 這一趟的設定：生成時的設定，加這一趟自己的（悄悄潛進來、觸發點的位置）
  const setup: Record<string, unknown> = { ...clone(dig.setup), ...(raw.stealth === true ? { stealth: true } : {}), ...(isRecord(raw.where) ? { where: clone(raw.where) } : {}), ...(parsed.fromBackdoor ? { from_backdoor: parsed.fromBackdoor } : {}) }
  const found = regionOf(k, setup.region)
  if ('problem' in found) throw new ActionBlocked(found.problem)
  const region = found.region
  // 從後門進來：要是這座留著後門的那一層
  let layer = 0
  if (parsed.fromBackdoor) {
    layer = layers.indexOf(parsed.fromBackdoor)
    if (layer < 0 || !net.backdoors.includes(parsed.fromBackdoor)) throw new ActionBlocked(`${layerLabel(dig.names[Math.max(0, layer)], Math.max(0, layer))}沒有留下後門，不能從那裡進去。`)
  }
  const sheetId = layers[layer]!
  const entry = entryOf(inst, sheetId)
  if (!entry) throw new ActionBlocked('這一層的入口找不到，進不去。')

  // 追蹤度：後門是 0；否則敵對值分段的起始值（加詞條）與上次離開時的一半取高的
  const fromParty = k.stats.hasStat('net_trace_start') ? partyOf(state).reduce((s, a) => s + k.stats.stat(state, a, 'net_trace_start'), 0) : 0
  const half = Math.floor(Math.max(0, net.left.trace) * rules.revisit_trace)
  const first = hostilityStart(k, state, typeof setup.faction === 'string' ? setup.faction : undefined) + parsed.trace + (dig.fx.trace_start ?? 0) + fromParty
  const traceStart = parsed.fromBackdoor ? 0 : Math.max(first, half)

  // 留著的那一份：回到起點的巡邏、被定位過的多一個雜兵、這一趟的追蹤度門檻重新算
  const next = clone(net)
  const nextDig = next.dig!
  const wasLocated = net.left.located === true
  delete next.left
  nextDig.visits += 1
  next.wiped = {}
  for (const p of next.patrols) {
    if (p.gone) continue
    p.step = 0
    p.at = p.route[0]!
    delete p.calm
  }
  if (traceStart < rules.t1) delete next.t30
  if (traceStart < rules.t2) delete next.t60
  const added: UnitRef[] = []
  if (wasLocated && !nextDig.located_plus && rules.located_foe_plus > 0) {
    nextDig.located_plus = true
    for (const [sheet, list] of Object.entries(next.foes)) {
      for (const [id, f] of Object.entries(list)) {
        if (f.done) continue
        for (let n = 0; n < rules.located_foe_plus; n++) {
          const ref: UnitRef = {
            from: 'enemy_pick', faction: next.faction ?? 'none', grade: next.grade, rank: 'minion', seed: `${inst.gen.seed}/${sheet}/${id}/located${nextDig.visits}/${n}`,
            ...(typeof setup.lace === 'string' ? { color: setup.lace } : {}), ...(nextDig.fx.all_pink ? { color: 'pink' } : {}), layer: layerLabel(nextDig.names[layers.indexOf(sheet)], layers.indexOf(sheet)),
          }
          f.foes.push(ref)
          added.push(ref)
        }
      }
    }
  }
  const source = k.battle.getUnitSource('enemy_pick')
  for (const ref of added.slice(0, 1)) {
    try {
      source?.(ref, { k, state, side: 'foe', mode: NET_MODE, grade: next.grade as never, allyCount: partyOf(state).length })
    } catch (e) {
      throw new ActionBlocked(`被定位過的這座網多出來的守衛挑不到（${(e as Error).message}）。`)
    }
  }

  const id = `n${state.seq.uid + 1}`
  const goal = { kind: 'clear' }
  const run: NetRun = {
    id, kind: ACT_NET, origin: clone(origin), region: region.id, grade: next.grade, ...(next.faction ? { faction: next.faction } : {}),
    map: inst.id, layers, layer, round: 0, goal, setup, loot: [], peak: Math.max(0, traceStart), entered: [],
  }
  // 站到那一層的入口，看得到周圍
  const def = inst.gen.map.sheets.find((s) => s.id === sheetId)!
  const sheet = new Sheet(def, inst.sheets[sheetId]?.cells ?? {})
  const rows = (inst.sheets[sheetId]?.seen?.length === sheet.h ? inst.sheets[sheetId]!.seen : def.layout.map((r) => '0'.repeat([...r].length))).map((r) => [...r])
  for (const key of sheet.visibleFrom({ x: entry[0], y: entry[1] }, sightOf(def))) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (rows[y]?.[x] !== undefined) rows[y]![x] = '1'
  }
  const changes: Change[] = [
    { op: 'uid', advance: 1 },
    { op: 'map.sheet', map: inst.id, sheet: sheetId, seen: rows.map((r) => r.join('')) },
    { op: 'map.at', to: { map: inst.id, sheet: sheetId, x: entry[0], y: entry[1] } },
    ...(region.pressure === 'trace' && k.meters.has(TRACE) ? [{ op: 'meter', kind: TRACE, key: inst.id, set: traceStart } as Change] : []),
    ...moverChanges({ map: inst.id }, next, next.patrols.filter((p) => !p.gone)),
    netExtChange(state, inst.id, next),
    runChange(run),
  ]
  const notes: string[] = []
  if (parsed.fromBackdoor) notes.push('從上次留下的後門進來，沒有人注意到你。')
  else if (half > 0 && half >= first) notes.push('系統還記得你上次來過。')
  if (wasLocated && added.length) notes.push('上次被定位之後，這裡的守衛加強了。')
  const summary = `你又潛進了「${region.name}」：${layerLabel(dig.names[layer], layer)}（共 ${layers.length} 層）。${notes.join('')}`
  return [draft(state, run, 'netrun.enter', 'entered', summary, changes, {
    location: { ...clone(state.location), subnet: { id: region.id, layer: layer + 1 } }, ...(notes.length ? { narration: { results: notes } } : {}),
  })]
}

// ---- 離開 ----

/** 後門有沒有被清掉：骰面由地圖的種子、這一層與第幾次進去固定（不吃狀態的亂數，所以同一座子網同一次離開永遠一樣）。 */
export function backdoorClears(seed: number, map: string, sheet: string, visits: number, chance: number): boolean {
  return seedRand(seed, `${map}/backdoor/${sheet}/${visits}`)() < chance
}

export interface Leave {
  changes: Change[]
  lines: string[]
  result: Record<string, unknown>
}

/**
 * 自己去挖的這一趟離開（登出、拔線、從出口離開、被定位、戰敗被接受）：地圖實例留著、記下 left；
 * 被定位的每個後門各有一半的機會被清掉；那家企業的敵對值照追蹤度加（被定位另外加）。不是自己去挖的是 null（那就照舊關地圖）。
 */
export function digLeave(k: Kernel, state: GameState, run: NetRun, trace: number, located: boolean): Leave | null {
  const net = isDigRun(run) ? netExt(state, run.map) : null
  if (!net?.dig) return null
  const rules = netrunRules(k)
  const next = clone(net)
  const lines: string[] = []
  let cleared = 0
  if (located) {
    const seed = state.maps.instances[run.map]?.gen?.seed ?? 0
    const keep = next.backdoors.filter((sheet) => !backdoorClears(seed, run.map, sheet, next.dig!.visits, rules.backdoor_clear))
    cleared = next.backdoors.length - keep.length
    next.backdoors = keep
    delete next.dig!.located_plus
    if (cleared > 0) lines.push('被定位之後，留下的後門被對方清掉了一部分。')
  }
  const t = Math.round(trace)
  next.left = { at: toMinutes(state.time), trace: t, ...(located ? { located: true as const } : {}) }
  const changes: Change[] = [netExtChange(state, run.map, next)]
  // 離開時留下的痕跡：那家企業的敵對值
  const faction = run.faction
  const amount = Math.min(rules.leave_hostility_max, Math.ceil(Math.max(0, t) / rules.leave_hostility)) + (located ? rules.located_hostility : 0)
  let delta = 0
  if (faction && amount > 0 && k.effects.has('hostility')) {
    const res = k.effects.resolve([{ kind: 'hostility', key: faction, amount }], effectCtx(k, state, { source: 'builtin' }))
    if (res.errors.length === 0) {
      changes.push(...res.changes)
      lines.push(...res.lines)
      delta = amount
    }
  }
  if (state.maps.at?.map === run.map) changes.push({ op: 'map.at', to: null })
  return {
    changes, lines,
    result: { site: next.dig!.site, kept: true, backdoors: next.backdoors.length, ...(cleared ? { cleared } : {}), ...(faction && delta > 0 ? { hostility: { faction, delta } } : {}) },
  }
}

// ---- 過期的清掉 ----

/** 過期（離開之後超過 keep_days 天）的留著的子網，一次清掉。人還在裡面（一趟進行中、站在上面）的不清。沒有要清的是 undefined。 */
export function expireDraft(k: Kernel, state: GameState, now: number): ReportDraft | undefined {
  const rules = netrunRules(k)
  const run = readRun(state)
  const gone: string[] = []
  for (const m of Object.values(state.maps.instances)) {
    if (!m.owner?.startsWith(DIG_PREFIX) || run?.map === m.id || state.maps.at?.map === m.id) continue
    if (expired(rules, netExt(state, m.id), now)) gone.push(m.id)
  }
  if (!gone.length) return undefined
  return {
    kind: 'netrun', action: 'netrun.expire', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [],
    changes: gone.flatMap((id) => closeMap(state, id)), outcome: { result: 'expired', summary: '過了太久，留著的子網被系統重整了：下次再進去是新的一張。' },
  }
}

// ---- 留後門（探索中的管理行動；任何一格都可以做，自己去挖的才有） ----

/** 留後門現在行不行：沒有主控的隊伍、不是自己去挖的沒有這一項（undefined）。 */
export function backdoorUse(k: Kernel, state: GameState, run: NetRun, net: NetExt): GridUse | undefined {
  if (!isDigRun(run) || bestTier(k, state) < 1) return undefined
  const sheetId = run.layers[run.layer]!
  const block = state.battle ? '正在戰鬥，先把這一場打完。' : net.backdoors.includes(sheetId) ? '這一層已經留過後門了。' : null
  return { id: 'backdoor', name: '留後門', block }
}

/** 留後門：花一個探索回合，把這一層記進 backdoors。 */
export function backdoorDraft(k: Kernel, state: GameState, run: NetRun, net: NetExt): ReportDraft {
  const use = backdoorUse(k, state, run, net)
  if (!use) throw new ActionBlocked('隊上沒有人有主控，留不了後門。')
  if (use.block) throw new ActionBlocked(use.block)
  const sheetId = run.layers[run.layer]!
  const w = workOf(run, net)
  const out = newOut()
  w.net.backdoors = [...w.net.backdoors, sheetId]
  w.netDirty = true
  advanceRound(k, state, w, out)
  const at = state.maps.at
  const node = at ? nodeAt(w.net, sheetId, at) : undefined
  if (node) patrolFight(k, state, w, out, node.id)
  return draft(state, w.run, 'netrun.use', 'backdoor', ['在這一層留下了一個後門：下次可以從這裡直接進來。', ...out.lines].join(''), [...out.changes, ...workChanges(state, w)], {
    ...(out.beats.length ? { timeline: out.beats } : {}), ...(out.launch.length ? { launch: out.launch } : {}),
  })
}
