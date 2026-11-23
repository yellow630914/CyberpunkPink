// L6 功能 npcs：生成一個人、建一區的名單（NPC_SYSTEM 3.1～3.3、4.1、4.4～4.7）。純函式，不改狀態。
//
// 全部用固定的亂數：存檔種子＋區＋名單序號（臨時生成的人是種子＋區＋事件與代號），重新整理不會變，加人不會改到前面的人。
// 步驟照 4.1 節的順序：身分類、勢力與職業、性別、年齡、警覺與財富、屬性與性格、傾向、橋參數與沉溺、基本功、路數（行者）、出沒表，名字最後。
// 外貌（4.3）、綽號、AI 寫的部分（4.8）、義體只留空的欄位；名字與素材都是內容（npc_gen、name_pool、npc_rule）。

import type { AttrId, Change, GameState, Kernel } from '../../core'
import { ATTR_IDS, Rng, contentAllowed, hash32 } from '../../core'
import type { Axis, BridgeParam, GenEntry, Haunt, Npc, NpcKind, NpcRules, PathRow, PoolEntry, TagState } from './model'
import { AXES, BRIDGE_PARAMS, GENDERS, GENDER_TAG, GEN_KIND, NPC_KIND, POOL_KIND, TAG_STATES, normalizeHaunt, npcRules, readNpcs } from './model'

type Cx = Pick<Kernel, 'content'>

/** 這一區的名單規則（npc_gen 每區一筆）。 */
export const genEntryOf = (k: Cx, district: string): GenEntry | undefined => k.content.list<GenEntry>(GEN_KIND).find((g) => g.district === district)

const pad = (n: number): string => String(n).padStart(4, '0')
/** 生成的人的 id：gen_<區>_<序號>。 */
export const genId = (district: string, index: number): string => `gen_${district}_${pad(index)}`

const between = (rng: Rng, r: [number, number]): number => rng.int(r[0], r[1])

/** 一組「不重複」的抽選：照權重抽 count 個互不相同的。 */
function pickDistinct<T>(rng: Rng, items: readonly T[], count: number, weight: (t: T) => number): T[] {
  const pool = [...items]
  const out: T[] = []
  while (out.length < count && pool.some((x) => weight(x) > 0)) {
    const one = rng.weighted(pool, weight)
    out.push(one)
    pool.splice(pool.indexOf(one), 1)
  }
  return out
}

export interface GenOpts {
  /** 指定 id（臨時生成的人是 tmp_<n>_<角色>）；沒給是 gen_<區>_<序號> */
  id?: string
  kind?: NpcKind
  faction?: string
  /** 指定名字（不從池裡抽） */
  name?: string
  /** 已經用掉的名字（同一批裡不重複） */
  taken?: Set<string>
}

/** 這一區的等級落在難度的哪一段（NPC_SYSTEM 4.7 節：低、中、高）。沒有等級的區當低。 */
function band(k: Cx, rules: NpcRules, district: string): 'low' | 'mid' | 'high' {
  const g = k.content.get('district', district)?.grade
  const grade = typeof g === 'number' ? g : 1
  return grade >= rules.paths.high_from ? 'high' : grade >= rules.paths.mid_from ? 'mid' : 'low'
}

function drawName(k: Cx, rules: NpcRules, rng: Rng, entry: GenEntry | undefined, taken: Set<string>): string | null {
  const pools = (entry?.names ?? []).map((n) => (Array.isArray(n) ? n : ([n, 1] as [string, number]))).filter(([id]) => k.content.has(POOL_KIND, id))
  if (pools.length === 0) return null
  const make = (): string => {
    const [id] = rng.weighted(pools, (p) => p[1])
    const pool = k.content.require<PoolEntry>(POOL_KIND, id)
    const given = rng.pick(pool.given)
    if (!pool.family) return given
    const family = rng.pick(pool.family)
    return pool.order === 'given_first' ? `${given}·${family}` : `${family}${given}`
  }
  for (let i = 0; i < rules.name_tries; i++) {
    const name = make()
    if (!taken.has(name)) return name
  }
  // 池用完了才加編號
  const base = make()
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

/**
 * 生成一個人（key 是名單序號或臨時的代號，決定亂數）。沒有這一區的 npc_gen 也生得出來（沒有勢力、職業與名字的素材）；
 * 內容篩選把五種性別全關掉時生不出來，回傳 null。
 */
export function generateNpc(k: Cx, state: Pick<GameState, 'rng' | 'rules' | 'ext'>, district: string, key: number | string, opts: GenOpts = {}): Npc | null {
  const rules = npcRules(k)
  const entry = genEntryOf(k, district)
  const rng = new Rng(hash32(state.rng.seed, 'npcs/gen', district, key))
  const id = opts.id ?? genId(district, typeof key === 'number' ? key : 0)

  // 1 身分類（臨時生成時指定；名單裡的由 buildRoster 照人數指定）
  const kind: NpcKind = opts.kind ?? 'citizen'
  // 2 勢力與職業
  let faction = opts.faction
  if (faction === undefined && entry && entry.factions.length > 0) {
    const f = rng.weighted(entry.factions, (x) => x[1])[0]
    faction = f === 'none' ? undefined : f
  }
  const occupation = entry && entry.occupations.length > 0 ? rng.weighted(entry.occupations, (x) => x[1])[0] : undefined
  // 3 性別（內容篩選關掉的對象性別不生成）、體型、年齡
  const weights = GENDERS.map((g) => (contentAllowed(state.rules, GENDER_TAG[g]) ? rules.gender[g] : 0))
  if (weights.every((w) => w <= 0)) return null
  const gender = rng.weighted(GENDERS.map((g, i) => [g, weights[i]!] as const), (x) => x[1])[0]
  const body = rng.chance(rules.andro_chance) ? 'andro' : gender === 'male' ? 'masc' : 'fem'
  const band7 = kind === 'runner' ? rules.age.runner : rules.age.main
  const age = rng.chance(rules.age.main_chance) ? between(rng, band7) : rng.int(rules.age.min, rules.age.max)
  // 10 警覺與財富
  const guard = between(rng, rules.guard)
  const wealth = rng.weighted(rules.wealth.map((w, i) => [i, w] as const), (x) => x[1])[0]
  // 5 屬性與性格
  const attrPool = rules.persona.attrs
  const personaAttrs = attrPool.length > 0 ? pickDistinct(rng, attrPool, Math.min(between(rng, rules.persona.attr_count), attrPool.length), () => 1) : []
  const quadrants = rules.persona.quadrants.filter((q) => q.length > 0).map((q) => rng.pick(q))
  // 6 傾向：每條軸 0～1 個標籤；所屬勢力的文化分支加權；內容篩選關掉的標籤不抽
  const tags = k.content.list('tendency_tag').filter((t) => typeof t.axis === 'string' && contentAllowed(state.rules, t.id))
  const axes = { relation: 0, sense: 0, body: 0, costume: 0 } as Record<Axis, number>
  const tendTags: Record<string, TagState> = {}
  const culture = faction !== undefined ? rules.tendency.culture[faction] : undefined
  for (const axis of AXES) {
    const pool = tags.filter((t) => t.axis === axis)
    if (pool.length > 0 && rng.chance(rules.tendency.tag_chance)) {
      const tag = rng.weighted(pool, (t) => (t.id === culture ? rules.tendency.culture_mult : 1))
      const st = rng.weighted(TAG_STATES.map((s) => [s, rules.tendency.states[s]] as const), (x) => x[1])[0]
      tendTags[tag.id] = st
      axes[axis] = rng.int(st === 'deep' ? 2 : 1, rules.tendency.axis_max)
    } else if (rng.chance(0.25)) axes[axis] = 1
  }
  // 7 橋參數與沉溺
  const bridgeless = (faction !== undefined && rules.bridge.bridgeless.includes(faction)) || rng.chance(rules.bridge.none_chance)
  const bridge = bridgeless ? null : (Object.fromEntries(BRIDGE_PARAMS.map((b) => [b, between(rng, rules.bridge.range)])) as Record<BridgeParam, number>)
  const sink = bridge ? between(rng, rules.bridge.sink) : 0
  // 路數與階數（只有行者）：一條 60%、兩條 30%、三條 10%；階數照這一區的難度
  const paths: PathRow[] = []
  if (kind === 'runner') {
    const all = k.content.list('path').map((p) => p.id)
    const byFaction = faction !== undefined ? rules.paths.by_faction[faction] : undefined
    const table: Array<[string, number]> = byFaction ?? entry?.paths ?? all.map((p): [string, number] => [p, 1])
    const known = table.filter(([p]) => all.length === 0 || all.includes(p))
    const count = rng.weighted([1, 2, 3].map((n, i) => [n, rules.paths.counts[i]!] as const), (x) => x[1])[0]
    const picked = pickDistinct(rng, known, count, (x) => x[1])
    const tiers = rules.paths.tiers[band(k, rules, district)]
    picked.forEach(([path], i) => {
      const slot = (['main', 'sub', 'third'] as const)[i]!
      paths.push({ path, slot, tier: between(rng, tiers[slot]) })
    })
  }
  // 基本功（規格沒寫算法，暫定：從內容的基本功裡抽幾項，行者的等級最高到主職的階數）
  const attrs = Object.fromEntries(ATTR_IDS.map((a) => [a, between(rng, rules.stats.attr) + (kind === 'runner' ? rules.stats.runner_bonus : 0)])) as Record<AttrId, number>
  const skillIds = k.content.list('skill').map((s) => s.id)
  const skills: Record<string, number> = {}
  const top = Math.max(1, paths.find((p) => p.slot === 'main')?.tier ?? (kind === 'staff' ? 2 : 1))
  for (const s of pickDistinct(rng, skillIds, Math.min(between(rng, rules.stats.skills[kind]), skillIds.length), () => 1)) skills[s] = rng.int(1, top)
  // 出沒表：這一區模板裡挑幾筆（沒有模板就是這一區到處都有）
  const templates = (entry?.haunts ?? []).filter((h) => !h.kind || h.kind.includes(kind))
  const picks = templates.length > 0 ? pickDistinct(rng, templates, Math.min(rules.haunt_count, templates.length), (h) => h.weight ?? 1) : []
  const haunts: Haunt[] = picks.length > 0 ? picks.map(({ kind: _kind, ...h }) => normalizeHaunt(h as Record<string, unknown>, district)) : [{ district }]
  // 11 名字最後
  const taken = opts.taken ?? new Set<string>()
  const name = opts.name ?? drawName(k, rules, rng, entry, taken) ?? `${kind === 'runner' ? '行者' : kind === 'staff' ? '職員' : '街坊'}${typeof key === 'number' ? key : ''}`
  taken.add(name)

  const home = { district, ...(haunts[0]?.block !== undefined ? { block: haunts[0].block } : {}) }
  return {
    id, name, kind, source: 'gen', age, gender, body,
    ...(faction !== undefined ? { faction } : {}), ...(occupation !== undefined ? { occupation } : {}),
    guard, wealth, home, haunts,
    persona: { attrs: personaAttrs, quadrants },
    tendencies: { axes, tags: tendTags },
    bridge, sink, paths, flags: [], attrs, skills, look: {},
  }
}

/** 一區的名單要有的人與他們的名字（已經用掉的）。 */
function usedNames(k: Cx, state: Pick<GameState, 'ext'>): Set<string> {
  const names = new Set<string>(k.content.list(NPC_KIND).map((e) => e.name as string))
  for (const n of Object.values(readNpcs(state).gen)) names.add(n.name)
  return names
}

/** 名字已經用掉的集合（生成臨時的人時用）。 */
export const takenNames = usedNames

/**
 * 建一區的名單（第一次走進這一區時）：固定 NPC 佔名額（職員不佔）、其餘照 npc_gen 的人數補生成的人。
 * 這一區沒有 npc_gen、也沒有固定 NPC 住在這裡，就不建（回傳 null）；已經建過的也是 null。
 */
export function planRoster(k: Cx, state: Pick<GameState, 'rng' | 'rules' | 'ext' | 'actors'>, district: string, fixed: Npc[]): Change | null {
  const s = readNpcs(state)
  const cur = s.rosters[district]
  if (cur?.built) return null
  const entry = genEntryOf(k, district)
  const extras = cur?.ids ?? []
  const keep = [...fixed.map((n) => n.id), ...extras.filter((id) => !fixed.some((n) => n.id === id))]
  if (!entry && keep.length === 0) return null

  // 已經在名單裡的人佔掉的名額（先升格的臨時 NPC 也算）
  const kindOf = (id: string): NpcKind | undefined => fixed.find((n) => n.id === id)?.kind ?? s.gen[id]?.kind
  const have = { citizen: 0, runner: 0, staff: 0 }
  for (const id of keep) {
    const kd = kindOf(id)
    if (kd) have[kd]++
  }
  const need = { citizen: Math.max(0, (entry?.citizens ?? 0) - have.citizen), runner: Math.max(0, (entry?.runners ?? 0) - have.runner) }

  const taken = usedNames(k, state)
  const gen: Npc[] = []
  let seq = s.seq[district] ?? 0
  for (const kind of ['citizen', 'runner'] as const) {
    for (let i = 0; i < need[kind]; i++) {
      seq++
      const n = generateNpc(k, state, district, seq, { kind, taken })
      if (!n) return buildChange(district, keep, gen, seq - 1)
      gen.push(n)
    }
  }
  return buildChange(district, keep, gen, seq)
}

const buildChange = (district: string, keep: string[], gen: Npc[], seq: number): Change => ({ op: 'npcs.roster', district, ids: [...keep, ...gen.map((n) => n.id)], gen, seq })
