// L6 功能：世界（一座連在一起的城市；DISTRICTS 1.1、1.2、1.3、1.4 節；DATA 第 12 節；EVENTS 3.1 節；UI 1.1 節；dev/adr/0012、0016；dev/work/M2-world.md）。
//
// 區、街區、橋接區、設施的資料；在街區圖上走、走到邊緣換到隔壁那一塊、走上設施；走路花時間並帶著事件的觸發點。
// 街區的版面是 special_map（同一種格式）：出口是版面上的 E，設施是版面上的 F（核心的 facility 格，預設圖例就有）。
// 這個功能只管「在城裡的位置」：每一種設施裡做什麼由各功能自己用 k.grid.usesOf 接；公共交通、區域狀態、封鎖、追逐、要地都不在這裡。
//
// 接上核心的地方：
//   內容  district、block、facility_type（格式與整體檢查見 model.ts；載入之後 ready 跑 worldProblems，有問題整批擋下並寫出是哪一筆）
//   變更  world.visit（記下街區用的地圖實例與去過）、world.steps（走了幾格）
//   效果  move：{ kind, block, at? } 把人帶到一塊街區（EVENTS 2.4 節）
//   條件  in_district { districts }、in_block { blocks }、at_facility { types? }
//   格子  onEnter（只管自己開的實例）：每一格加時間、每 10 格 walk、走上出口換街區（這一段路到出口為止）、走上設施（不擋路；停在最後一格才算到）；usesOf：站在出口上列「前往」（world.go）、設施沒開時列一項灰掉的
// 報告：world.arrive（到一塊街區；走路本身是核心的 grid.move）。
//
// location.facility 放的是設施的標記 id（那一塊街區裡的哪一間，例：F1）；設施的種類查 block 的 facilities[標記].type。
// 觸發點的 where：{ district, block }，走上設施的另外帶 facility（設施的種類）。

import type { Change, Condition, ConditionCtx, Effect, EffectCtx, Feature, GameState, GridCtx, GridEffect, GridKernel, GridUse, Kernel, ReportTrigger } from '../../core'
import { ContentError, isSafeInt } from '../../core'
import { arrive, planArrive } from './arrive'
import type { BlockEntry, DistrictEntry, FacilityTypeEntry } from './model'
import {
  BLOCK_KIND, CLOSED_REASON, DISTRICT_KIND, EXT, FACILITY_TYPE_KIND, OWNER, WALK_TRIGGER_EVERY,
  blockEntry, blockProblems, districtEntry, districtProblems, exitsOf, facilitiesOf, facilityOpen, facilityTypeProblems, markerOf, sheetOfBlock,
  stepMinutes, worldBlockAt, worldOf, worldProblems,
} from './model'

export { arrive, planArrive } from './arrive'
export { CLOSED_REASON, DEFAULT_STEP_MINUTES, WALK_TRIGGER_EVERY, facilityOpen, stepMinutes, worldOf, worldProblems } from './model'
export type { BlockEntry, DistrictEntry, ExitDef, FacilityDef, FacilityTypeEntry, OpenDef, WorldState } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// ---- 對外：現在在哪、城市怎麼連 ----

export interface WorldView {
  district: { id: string; name: string; grade: number; price_mult?: number } | null
  block: { id: string; name: string; kind: 'block' | 'bridge' } | null
  /** 現在站的那一間設施（location.facility） */
  facility: { marker: string; name: string; type: string; typeName: string } | null
  /** 這一塊的出口通到哪 */
  exits: Array<{ marker: string; at: [number, number] | null; to: string; toName: string; toDistrict: string; toKind: 'block' | 'bridge'; arrive: string }>
  /** 這一塊的設施與現在開不開；沒開的 reason 是給玩家看的原因 */
  facilities: Array<{ marker: string; at: [number, number] | null; name: string; type: string; typeName: string; npc?: string; open: boolean; reason: string | null }>
  /** 在街區裡一共走了幾格 */
  steps: number
  /** 去過的街區 */
  visited: string[]
}

const typeName = (k: Pick<Kernel, 'content'>, type: string): string => k.content.get<FacilityTypeEntry>(FACILITY_TYPE_KIND, type)?.name ?? type

/** 現在在哪一區哪一塊、這一塊的出口通到哪、這一塊的設施與開不開（給畫面的「這裡」與街區資訊用）。不在任何街區上時 district 與 block 是 null。 */
export function worldView(k: Pick<Kernel, 'content' | 'timeRules'>, state: GameState): WorldView {
  const w = worldOf(state)
  const block = blockEntry(k, state.location.block)
  const district = districtEntry(k, block?.district ?? state.location.district)
  const sheet = block ? sheetOfBlock(k, block)?.sheet : undefined
  const at = (marker: string): [number, number] | null => {
    const m = sheet ? markerOf(sheet, marker) : undefined
    return m ? [m.at[0], m.at[1]] : null
  }
  const here = block && state.location.facility ? facilitiesOf(block)[state.location.facility] : undefined
  return {
    district: district ? { id: district.id, name: district.name, grade: district.grade, ...(district.price_mult !== undefined ? { price_mult: district.price_mult } : {}) } : null,
    block: block ? { id: block.id, name: block.name, kind: block.kind } : null,
    facility: block && here && state.location.facility ? { marker: state.location.facility, name: here.name, type: here.type, typeName: typeName(k, here.type) } : null,
    exits: block ? Object.entries(exitsOf(block)).map(([marker, x]) => {
      const to = blockEntry(k, x.to)
      return { marker, at: at(marker), to: x.to, toName: to?.name ?? x.to, toDistrict: to?.district ?? '', toKind: to?.kind ?? 'block', arrive: x.arrive }
    }) : [],
    facilities: block ? Object.entries(facilitiesOf(block)).map(([marker, f]) => {
      const open = facilityOpen(k, state, f)
      return { marker, at: at(marker), name: f.name, type: f.type, typeName: typeName(k, f.type), ...(f.npc !== undefined ? { npc: f.npc } : {}), open, reason: open ? null : CLOSED_REASON }
    }) : [],
    steps: w.steps,
    visited: w.visited,
  }
}

export interface CityGraph {
  districts: Array<{ id: string; name: string; grade: number; blocks: string[] }>
  blocks: Array<{ id: string; name: string; district: string; kind: 'block' | 'bridge' }>
  /** 街區與街區之間的每一條走道（一條只出現一次） */
  links: Array<{ a: string; b: string; aMarker: string; bMarker: string }>
  /** 區與區怎麼連（有走道跨過去的兩個區；一對只出現一次） */
  districtLinks: Array<[string, string]>
}

/** 區與街區怎麼連（給城市地圖用）：每個區有哪些街區、每塊街區的種類、每一條走道、哪兩個區相連。 */
export function cityGraph(k: Pick<Kernel, 'content'>): CityGraph {
  const districts = k.content.list<DistrictEntry>(DISTRICT_KIND).map((d) => ({ id: d.id, name: d.name, grade: d.grade, blocks: [...d.blocks] }))
  const blocks = k.content.list<BlockEntry>(BLOCK_KIND)
  const links: CityGraph['links'] = []
  const seen = new Set<string>()
  const pairs = new Set<string>()
  const districtLinks: Array<[string, string]> = []
  for (const b of blocks) {
    for (const [marker, x] of Object.entries(exitsOf(b))) {
      const ends: Array<[string, string]> = [[b.id, marker], [x.to, x.arrive]]
      ends.sort((p, q) => `${p[0]}:${p[1]}`.localeCompare(`${q[0]}:${q[1]}`))
      const key = ends.map(([id, m]) => `${id}:${m}`).join('|')
      if (!seen.has(key)) {
        seen.add(key)
        links.push({ a: ends[0]![0], b: ends[1]![0], aMarker: ends[0]![1], bMarker: ends[1]![1] })
      }
      const to = blockEntry(k, x.to)
      if (to && to.district !== b.district) {
        const pair = [b.district, to.district].sort() as [string, string]
        const pk = pair.join('|')
        if (!pairs.has(pk)) {
          pairs.add(pk)
          districtLinks.push(pair)
        }
      }
    }
  }
  return { districts, blocks: blocks.map((b) => ({ id: b.id, name: b.name, district: b.district, kind: b.kind })), links, districtLinks }
}

// ---- 走路 ----

function onEnter(ctx: GridCtx): GridEffect | void {
  const block = worldBlockAt(ctx.k, ctx.state, ctx.at.map)
  if (!block) return
  const k = ctx.k as GridKernel
  const where = { district: block.district, block: block.id }
  const changes: Change[] = [{ op: 'time', minutes: stepMinutes(k, block) }, { op: 'world.steps', n: 1 }]
  const triggers: ReportTrigger[] = []
  if ((worldOf(ctx.state).steps + ctx.step) % WALK_TRIGGER_EVERY === 0) triggers.push({ point: 'walk', where })

  const marker = ctx.sheet.markerAt(ctx.at.x, ctx.at.y)
  const exit = marker ? exitsOf(block)[marker.id] : undefined
  const fac = marker ? facilitiesOf(block)[marker.id] : undefined
  // location.facility：停在設施上（這一段路計畫的最後一格）才設成它；路過的、被停下來沒走到終點的不算到了，離開原本站的那一格清掉
  const onFacility = !!(fac && marker && ctx.last)
  const base = { ...ctx.state.location, district: block.district, block: block.id }
  delete (base as { facility?: string }).facility
  if (onFacility && marker) changes.push({ op: 'location', to: { ...base, facility: marker.id } })
  else if (ctx.state.location.facility !== undefined) changes.push({ op: 'location', to: base })

  if (exit) {
    const to = blockEntry(k, exit.to)
    // 換街區：這一步走到出口為止，到了隔壁那一塊是接著提交的另一份報告（world.arrive）
    return { changes, triggers, followUps: [arrive(k, ctx.state, exit.to, exit.arrive)], stop: true, line: `從出口走向${to?.name ?? exit.to}。` }
  }
  if (fac && onFacility) {
    // 設施不擋路：路過的設施照走，只有停在最後一格才算到了（帶 enter_facility、設 location.facility）
    triggers.push({ point: 'enter_facility', where: { ...where, facility: fac.type } })
    return { changes, triggers, line: `到了${fac.name}。` }
  }
  return { changes, triggers }
}

/**
 * 站在這一格上能做的事（這個功能管的兩種）：
 * - 設施不在營業時間：列一項灰掉的；開著的時候不列任何事（各功能自己列）；
 * - 出口：列「前往<隔壁那塊街區>」（id 是 world.go；畫面照它呼叫 arrive(出口的 to, 出口的 arrive)）。
 *   平常走上出口那一格就換街區（這一步走到出口為止），人站在出口上是剛從隔壁過來、或是被帶到出口那一格（move 效果），這時可以再走回去。
 */
function hereUses(ctx: GridCtx, marker: { id: string }): GridUse[] {
  const block = worldBlockAt(ctx.k, ctx.state, ctx.at.map)
  if (!block) return []
  const exit = exitsOf(block)[marker.id]
  if (exit) return [{ id: GO_USE, name: `前往${blockEntry(ctx.k, exit.to)?.name ?? exit.to}`, block: null }]
  const fac = facilitiesOf(block)[marker.id]
  if (!fac || facilityOpen(ctx.k, ctx.state, fac)) return []
  return [{ id: 'closed', name: '進去', block: CLOSED_REASON }]
}

/** 站在出口上「前往」的項目 id。 */
export const GO_USE = 'world.go'

// ---- 效果與條件 ----

interface MoveEffect extends Effect { block: string; at?: string }

const listOf = (c: Record<string, unknown>, plural: string, singular: string): string[] | undefined =>
  Array.isArray(c[plural]) ? (c[plural] as string[]) : typeof c[singular] === 'string' ? [c[singular] as string] : undefined

function listProblem(raw: Record<string, unknown>, plural: string, singular: string): string[] {
  const l = listOf(raw, plural, singular)
  return l && l.length > 0 && l.every(isText) ? [] : [`${plural} 要是 id 的陣列（或寫 ${singular}）`]
}

export const worldFeature: Feature = {
  id: OWNER,
  install(kernel) {
    const k = kernel as Kernel

    k.content.defineKind<DistrictEntry>({
      kind: DISTRICT_KIND, owner: OWNER, validate: districtProblems,
      refs: (e) => [...e.blocks.map((b): [string, string] => ['block', b]), ...(e.factions ?? []).map((f): [string, string] => ['faction', f])],
    })
    k.content.defineKind<BlockEntry>({
      kind: BLOCK_KIND, owner: OWNER, validate: blockProblems,
      refs: (e) => [
        ['district', e.district], ['special_map', e.map],
        ...Object.values(exitsOf(e)).map((x): [string, string] => ['block', x.to]),
        ...Object.values(facilitiesOf(e)).flatMap((f): Array<[string, string]> => [[FACILITY_TYPE_KIND, f.type], ...(f.npc !== undefined ? [['npc', f.npc] as [string, string]] : [])]),
      ],
    })
    k.content.defineKind<FacilityTypeEntry>({ kind: FACILITY_TYPE_KIND, owner: OWNER, overridable: true, validate: facilityTypeProblems })

    k.changes.register<Change & { block: string; instance?: string }>({
      op: 'world.visit', owner: OWNER,
      validate: (state, c) => [
        ...(isText(c.block) ? [] : ['block 要是街區的 id']),
        ...(c.instance === undefined || (isText(c.instance) && state.maps.instances[c.instance]) ? [] : [`沒有 ${String(c.instance)} 這份地圖`]),
      ],
      apply(state, c) {
        const w = worldOf(state)
        if (c.instance !== undefined) w.instances[c.block] = c.instance
        if (!w.visited.includes(c.block)) w.visited.push(c.block)
        state.ext[EXT] = w
      },
    })
    k.changes.register<Change & { n: number }>({
      op: 'world.steps', owner: OWNER,
      validate: (state, c) => (isSafeInt(c.n) && c.n >= 1 && isSafeInt(worldOf(state).steps + c.n) ? [] : ['n 要是 1 以上的整數']),
      apply(state, c) {
        const w = worldOf(state)
        w.steps += c.n
        state.ext[EXT] = w
      },
    })

    k.effects.register<MoveEffect>({
      kind: 'move', owner: OWNER,
      validate(raw, ctx: EffectCtx) {
        if (!isText(raw.block)) return ['block 要是街區的 id']
        const b = ctx.content.get<BlockEntry>(BLOCK_KIND, raw.block)
        if (!b) return [`沒有 ${raw.block} 這塊街區`]
        if (raw.at === undefined) return []
        if (!isText(raw.at)) return ['at 要是標記的 id']
        const sheet = sheetOfBlock(ctx, b)?.sheet
        return sheet && markerOf(sheet, raw.at) ? [] : [`${raw.block} 的版面上沒有 ${raw.at} 這個標記`]
      },
      toChanges: (e, ctx) => planArrive(k, ctx.state, e.block, e.at).changes,
      describe: (e, ctx) => `前往：${blockEntry(ctx, e.block)?.name ?? e.block}`,
    })

    k.conditions.register<Condition & { districts?: string[]; district?: string }>({
      kind: 'in_district', owner: OWNER,
      validate: (raw) => listProblem(raw, 'districts', 'district'),
      test: (c, { state }) => !!state.location.district && (listOf(c, 'districts', 'district') ?? []).includes(state.location.district),
    })
    k.conditions.register<Condition & { blocks?: string[]; block?: string }>({
      kind: 'in_block', owner: OWNER,
      validate: (raw) => listProblem(raw, 'blocks', 'block'),
      test: (c, { state }) => !!state.location.block && (listOf(c, 'blocks', 'block') ?? []).includes(state.location.block),
    })
    k.conditions.register<Condition & { types?: string[]; type?: string }>({
      kind: 'at_facility', owner: OWNER,
      validate: (raw) => (raw.types === undefined && raw.type === undefined ? [] : listProblem(raw, 'types', 'type')),
      test(c, { state }: ConditionCtx) {
        const marker = state.location.facility
        if (!marker) return false
        const want = listOf(c, 'types', 'type')
        if (!want) return true
        const block = blockEntry(k, state.location.block)
        const f = block ? facilitiesOf(block)[marker] : undefined
        return !!f && want.includes(f.type)
      },
    })

    k.grid.onEnter(OWNER, onEnter)
    k.grid.usesOf(OWNER, hereUses)
  },

  ready(k) {
    const problems = worldProblems(k)
    if (problems.length) throw new ContentError(problems)
  },
}
