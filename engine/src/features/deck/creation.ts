// L6 功能 deck 的建角（M4-creation-body；CHARACTER 5.4 節；dev/work/M4-creation-body.md）。
//
// 掛點 creation.step 的 gear（第 9 步，features/creation 宣告；這裡只認名字與格式，不 import）：回答 picks 裡的構裝（內容種類 construct）、SKIN（skin）與快駭程式（quickhack，有人定義那個種類才收）。
//   規則：等級不超過 gear_grade_max；類別 construct（快駭程式算構裝）、skin 要在 gear_kinds 裡；出身（與企業出身選的那一家）要對得上 available；
//   一件的點數＝價錢 ÷ gear_point_price 進位、最少 1；數量是 1 以上的整數。提交時放進背包（裝不裝進甲板的槽由玩家在遊戲裡整理）。
// 出身的 kit_free 裡的構裝與 SKIN 也由這裡給（不花點數；認不得的 id 留給別人）。
// 甲板本身是腦部的義體，由 features/cyberware 回答。

import type { Change, ContentEntry, FactionEntry, GameState, Kernel, OriginEntry } from '../../core'
import { isRecord } from '../../core'
import { CONSTRUCT_KIND, QUICKHACK_KIND, SKIN_KIND } from './model'

interface DraftLike { origin?: string; originChoice?: { favor?: string }; gear?: unknown }
interface LimitsLike { gearPointPrice: number; gearGradeMax: number; gearKinds: string[] }
interface Payload { state: GameState; draft: DraftLike; step: string; picks: unknown[]; limits: LimitsLike }
interface Owned { id: string; name: string; category: string; slots?: string[]; qty: number; from: 'kit' | 'pick' }
interface Answer { took: number[]; blocks?: string[]; points?: number; changes?: Change[]; owned?: Owned[] }

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const roman = (n: number): string => ROMAN[n] ?? String(n)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function availableBlock(k: Pick<Kernel, 'content'>, draft: DraftLike, entry: { available?: unknown }): string | null {
  const a = entry.available
  if (!isRecord(a)) return null
  const origins = Array.isArray(a.origins) ? a.origins.filter(isText) : []
  const faction = isText(a.faction) ? a.faction : undefined
  const origin = draft.origin === undefined ? undefined : k.content.get<OriginEntry>('origin', draft.origin)
  const favor = origin && origin.favor.choose_one.length === 1 ? origin.favor.choose_one[0] : draft.originChoice?.favor
  const originOk = origins.length === 0 || (draft.origin !== undefined && origins.includes(draft.origin))
  const factionOk = faction === undefined || favor === faction
  if (originOk && factionOk) return null
  const names = origins.map((id) => k.content.get<OriginEntry>('origin', id)?.name ?? id).join('、')
  const short = faction === undefined ? undefined : (k.content.get<FactionEntry>('faction', faction)?.short ?? faction)
  if (names && short) return `${names}出身、而且是${short}才選得到。`
  if (names) return `${names}出身才選得到。`
  return `要選${short}才選得到。`
}

interface Found {
  id: string
  name: string
  /** 類別：construct（快駭程式也算）、skin */
  kind: 'construct' | 'skin'
  grade: number
  price: number
  entry: ContentEntry
}

/** 這個 id 是不是構裝、SKIN、快駭程式。 */
function found(k: Pick<Kernel, 'content'>, id: string): Found | undefined {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (k.content.has(CONSTRUCT_KIND, id)) {
    const e = k.content.get<ContentEntry & { name: string; grade: number; price?: number }>(CONSTRUCT_KIND, id)!
    return { id, name: e.name, kind: 'construct', grade: e.grade, price: num(e.price), entry: e }
  }
  if (k.content.has(SKIN_KIND, id)) {
    const e = k.content.get<ContentEntry & { name: string; price?: number; grade?: number }>(SKIN_KIND, id)!
    return { id, name: e.name, kind: 'skin', grade: typeof e.grade === 'number' ? e.grade : 1, price: num(e.price), entry: e }
  }
  if (k.content.hasKind(QUICKHACK_KIND) && k.content.has(QUICKHACK_KIND, id)) {
    const e = k.content.get<ContentEntry & { name?: unknown; grades?: unknown; price?: unknown }>(QUICKHACK_KIND, id)!
    const grades = Array.isArray(e.grades) ? e.grades.filter((g): g is number => typeof g === 'number') : []
    return { id, name: typeof e.name === 'string' ? e.name : id, kind: 'construct', grade: grades.length ? Math.min(...grades) : 1, price: num(e.price), entry: e }
  }
  return undefined
}

const pointsOf = (price: number, limits: Pick<LimitsLike, 'gearPointPrice'>): number => Math.max(1, Math.ceil(price / limits.gearPointPrice - 1e-9))

/** 掛點 creation.step 的回答：第 9 步的構裝、SKIN、快駭程式，與出身白給的那幾類。 */
export function answerCreation(k: Kernel, p: Payload): Answer | void {
  if (p.step !== 'gear') return
  const d = p.draft
  const took: number[] = []
  const blocks: string[] = []
  const changes: Change[] = []
  const owned: Owned[] = []
  let points = 0

  p.picks.forEach((pick, index) => {
    if (!isRecord(pick) || !isText(pick.id)) return
    const f = found(k, pick.id)
    if (!f) return
    took.push(index)
    const qty = pick.qty === undefined ? 1 : pick.qty as number
    if (!(Number.isInteger(qty) && qty >= 1)) {
      blocks.push(`${f.name}的數量要是 1 以上的整數。`)
      return
    }
    if (!p.limits.gearKinds.includes(f.kind)) blocks.push(`${f.name}這一類不能用裝備點數買。`)
    if (f.grade > p.limits.gearGradeMax) blocks.push(`${f.name}是 ${roman(f.grade)} 級，起始的裝備只能買 I～${roman(p.limits.gearGradeMax)} 級。`)
    const why = availableBlock(k, d, f.entry as { available?: unknown })
    if (why) blocks.push(`${f.name}：${why}`)
    points += pointsOf(f.price, p.limits) * qty
    changes.push({ op: 'item', id: f.id, qty })
    owned.push({ id: f.id, name: f.name, category: f.kind, qty, from: 'pick' })
  })

  // 出身白給的（不花點數）：認得的才給，其餘留給別人
  const origin = d.origin === undefined ? undefined : k.content.get<OriginEntry>('origin', d.origin)
  const kit = (origin as unknown as { kit_free?: unknown } | undefined)?.kit_free
  if (Array.isArray(kit)) {
    for (const e of kit) {
      if (!isRecord(e) || !isText(e.id)) continue
      const f = found(k, e.id)
      if (!f) continue
      const qty = Number.isInteger(e.qty) && (e.qty as number) >= 1 ? (e.qty as number) : 1
      changes.push({ op: 'item', id: f.id, qty })
      owned.push({ id: f.id, name: f.name, category: f.kind, qty, from: 'kit' })
    }
  }
  if (took.length === 0 && changes.length === 0) return
  return { took, blocks, ...(d.gear !== undefined ? { points } : {}), changes, owned }
}
