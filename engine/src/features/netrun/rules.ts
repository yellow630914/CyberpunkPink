// 讀規則表：資料（net_region、netrun_rule）蓋掉內建的預設，格式不對的欄位忽略（和其他功能讀規則表同一個做法）。

import type { Kernel } from '../../core'
import { clone, isRecord } from '../../core'
import type { LayerCounts, NetRegion, NetrunRules, Rank } from './model'
import { COUNT_KEYS, DEFAULT_REGIONS, DEFAULT_RULES, DEFAULT_TRAP, NUMERIC_RULES, REGION_KIND, RULE_KIND, TEXT_LIST_RULES, regionProblems, ruleProblems } from './model'

type Cx = Pick<Kernel, 'content'>

/** 現在生效的探索規則：netrun_rule/default 蓋掉內建的預設（格式不對的欄位忽略）。 */
export function netrunRules(k: Cx): NetrunRules {
  const e = k.content.get(RULE_KIND, 'default') as Record<string, unknown> | undefined
  const out: NetrunRules = clone(DEFAULT_RULES)
  if (!e) return out
  const bad = new Set(ruleProblems(e).map((m) => m.split(/[ .[]/)[0]))
  for (const [key] of NUMERIC_RULES) if (typeof e[key] === 'number' && !bad.has(key)) out[key] = e[key] as number
  for (const key of TEXT_LIST_RULES) if (Array.isArray(e[key]) && !bad.has(key)) out[key] = [...(e[key] as string[])]
  if (Array.isArray(e.patrol_route) && !bad.has('patrol_route')) out.patrol_route = [...(e.patrol_route as [number, number])]
  if (Array.isArray(e.patrol) && !bad.has('patrol')) out.patrol = (e.patrol as Rank[][]).map((g) => [...g])
  if (Array.isArray(e.load_mult) && !bad.has('load_mult')) out.load_mult = [...(e.load_mult as number[])]
  if (typeof e.master_path === 'string' && !bad.has('master_path')) out.master_path = e.master_path
  if (isRecord(e.encounter) && !bad.has('encounter')) for (const key of ['plain', 'guard', 'boss'] as const) if (Array.isArray(e.encounter[key])) out.encounter[key] = [...(e.encounter[key] as Rank[])]
  return out
}

/** 把一筆區補成完整的（沒寫的欄位照內建 subnet 的）。 */
function complete(e: Record<string, unknown>): NetRegion {
  const base = DEFAULT_REGIONS.subnet!
  const counts = (v: unknown, fallback: LayerCounts): LayerCounts => {
    const out = clone(fallback)
    if (isRecord(v)) for (const key of COUNT_KEYS) if (Array.isArray(v[key])) out[key] = [...(v[key] as [number, number])]
    return out
  }
  return {
    id: String(e.id), name: String(e.name), map_kind: String(e.map_kind), size: [...(e.size as [number, number])], carve: [...(e.carve as [number, number])],
    sight: typeof e.sight === 'number' ? e.sight : base.sight,
    ...(typeof e.oneway === 'number' ? { oneway: e.oneway } : {}), ...(typeof e.fragile === 'number' ? { fragile: e.fragile } : {}), ...(typeof e.loops === 'number' ? { loops: e.loops } : {}),
    pressure: e.pressure as 'trace' | 'none', ...(e.safe === true ? { safe: true } : {}),
    cover: e.cover === undefined ? base.cover : clone(e.cover as NetRegion['cover']), dc: [...(e.dc as number[])],
    layer: counts(e.layer, base.layer), ...(e.commission !== undefined ? { commission: counts(e.commission, base.layer) } : {}),
    ...(Array.isArray(e.archive_table) ? { archive_table: clone(e.archive_table as NetRegion['archive_table']) } : {}),
    ...(isRecord(e.trap) ? { trap: { alarm: typeof e.trap.alarm === 'number' ? e.trap.alarm : DEFAULT_TRAP.alarm, loop_load: typeof e.trap.loop_load === 'number' ? e.trap.loop_load : DEFAULT_TRAP.loop_load } } : {}),
  }
}

/**
 * 一區的規則：整筆給的（別的功能自己帶規則來開一趟，例：迷宮館）先檢查再用；字串是 id，先找資料（net_region）再找內建的。
 * 找不到或格式不對回傳原因（一句）。
 */
export function regionOf(k: Cx, region: unknown): { region: NetRegion } | { problem: string } {
  if (isRecord(region)) {
    const id = typeof region.id === 'string' && region.id ? region.id : 'custom'
    const bad = regionProblems(region)
    return bad.length ? { problem: `這一區的規則（${id}）格式不對：${bad[0]}。` } : { region: complete({ ...region, id }) }
  }
  if (typeof region !== 'string' || !region) return { problem: '沒有說這一趟要去哪一區。' }
  const e = k.content.get(REGION_KIND, region) as Record<string, unknown> | undefined
  if (e) {
    const bad = regionProblems(e)
    return bad.length ? { problem: `這一區的規則（${region}）格式不對：${bad[0]}。` } : { region: complete(e) }
  }
  const builtin = DEFAULT_REGIONS[region]
  return builtin ? { region: clone(builtin) } : { problem: `找不到「${region}」這一區的規則表，這一趟開不起來。` }
}

/** 這一趟要用的那一組密度：委託的階段（face.net）用 commission 那一組，沒有就用 layer。 */
export const countsOf = (region: NetRegion, kind: string): LayerCounts => (kind === 'face.net' && region.commission ? region.commission : region.layer)

