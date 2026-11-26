// L6 功能 gear 的建角（M4-creation-body；CHARACTER 5.4 節；dev/adr/0019 第十一節與 P55；dev/work/M4-creation-body.md）。
//
// 掛點 creation.step 的 gear（第 9 步，features/creation 宣告；這裡只認名字與格式，不 import）：回答 picks 裡它認得的——物品（內容種類 item）與武器、護甲的設計圖。
//   規則：等級不超過 gear_grade_max；類別要在 gear_kinds 裡（藥、成人道具（物品帶 adult: true）、義體不行）；出身（與企業出身選的那一家）要對得上 available；
//   一件的點數＝價錢 ÷ gear_point_price 進位、最少 1（設計圖用 productPrice 配 stock）；數量是 1 以上的整數，點數乘數量。
//   提交時：東西放進背包（設計圖的成品帶完整的零件，每一件各一疊、各有編號）；沒穿也沒帶，由玩家在遊戲裡整理。
// 出身的 kit_free（內容 origin 多讀 kit_free: [{ id, qty? }]）也由這裡給：不花點數，不檢查等級與類別；認不得的 id（構裝、SKIN……）留給別人。

import type { BlueprintEntry, Change, FactionEntry, GameState, ItemEntry, Kernel, OriginEntry } from '../../core'
import { clone, isRecord, productOf, productPrice } from '../../core'
import { styleSpec } from './look'

interface DraftLike { origin?: string; originChoice?: { favor?: string }; gear?: unknown }
interface LimitsLike { gearPointPrice: number; gearGradeMax: number; gearKinds: string[] }
interface Payload { state: GameState; draft: DraftLike; step: string; picks: unknown[]; limits: LimitsLike }
interface Owned { id: string; name: string; category: string; slots?: string[]; qty: number; from: 'kit' | 'pick' }
interface Answer { took: number[]; blocks?: string[]; points?: number; changes?: Change[]; owned?: Owned[]; notes?: string[] }

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

const gearPointsOf = (price: number, limits: Pick<LimitsLike, 'gearPointPrice'>): number => Math.max(1, Math.ceil(price / limits.gearPointPrice - 1e-9))

/** 武器與護甲的設計圖（義體不是這裡的）。 */
const gearBlueprint = (k: Pick<Kernel, 'content'>, id: string): BlueprintEntry | undefined => {
  const bp = k.content.get<BlueprintEntry>('blueprint', id)
  return bp && (bp.kind === 'weapon' || bp.kind === 'armor') ? bp : undefined
}

/** 一件東西放進背包的變更：物品照數量；設計圖的成品每一件各一疊，帶原廠組合的零件。 */
function giveChanges(k: Kernel, id: string, qty: number, prefix: string, first: number): Change[] {
  const bp = gearBlueprint(k, id)
  if (!bp) return [{ op: 'item', id, qty }]
  const out: Change[] = []
  for (let i = 0; i < qty; i++) out.push({ op: 'item', id, qty: 1, data: { uid: `${prefix}${first + i}`, parts: clone(bp.stock ?? {}), state: 'new' } })
  return out
}

function ownedOf(k: Pick<Kernel, 'content'>, id: string, qty: number, from: 'kit' | 'pick'): Owned | undefined {
  const bp = gearBlueprint(k, id)
  if (bp) return { id, name: bp.name, category: bp.kind, slots: bp.kind === 'weapon' ? (bp.carry ? [bp.carry] : []) : [...(bp.covers ?? [])], qty, from }
  const item = k.content.get<ItemEntry>('item', id)
  return item ? { id, name: item.name, category: item.category, qty, from } : undefined
}

/** 出身白給的：{ id, qty? } 的清單。 */
function kitOf(k: Pick<Kernel, 'content'>, draft: DraftLike): Array<{ id: string; qty: number }> {
  const origin = draft.origin === undefined ? undefined : k.content.get<OriginEntry>('origin', draft.origin)
  const raw = (origin as unknown as { kit_free?: unknown } | undefined)?.kit_free
  if (!Array.isArray(raw)) return []
  const out: Array<{ id: string; qty: number }> = []
  for (const e of raw) {
    if (!isRecord(e) || !isText(e.id)) continue
    out.push({ id: e.id, qty: Number.isInteger(e.qty) && (e.qty as number) >= 1 ? (e.qty as number) : 1 })
  }
  return out
}

/** 掛點 creation.step 的回答：第 9 步。 */
export function answerCreation(k: Kernel, p: Payload): Answer | void {
  if (p.step !== 'gear') return
  const d = p.draft
  const took: number[] = []
  const blocks: string[] = []
  const changes: Change[] = []
  const owned: Owned[] = []
  let points = 0
  let made = 0

  p.picks.forEach((pick, index) => {
    if (!isRecord(pick) || !isText(pick.id)) return
    const id = pick.id
    const item = k.content.has('item', id) ? k.content.get<ItemEntry & { adult?: unknown; available?: unknown }>('item', id) : undefined
    const bp = item ? undefined : gearBlueprint(k, id)
    if (!item && !bp) return
    took.push(index)
    const qty = pick.qty === undefined ? 1 : pick.qty as number
    const name = item?.name ?? bp!.name
    if (!(Number.isInteger(qty) && qty >= 1)) {
      blocks.push(`${name}的數量要是 1 以上的整數。`)
      return
    }
    const grade = item?.grade ?? bp!.grade
    const kind = item ? item.category : bp!.kind
    if (item?.category === 'drug') blocks.push(`${name}是藥，不能用裝備點數買。`)
    else if (item && item.adult === true) blocks.push(`${name}是成人道具，不能用裝備點數買。`)
    else if (!p.limits.gearKinds.includes(kind)) blocks.push(`${name}這一類不能用裝備點數買。`)
    if (grade > p.limits.gearGradeMax) blocks.push(`${name}是 ${roman(grade)} 級，起始的裝備只能買 I～${roman(p.limits.gearGradeMax)} 級。`)
    const why = availableBlock(k, d, (item ?? bp) as { available?: unknown })
    if (why) blocks.push(`${name}：${why}`)
    if (bp) {
      const info = productOf(k.content, bp.id, { parts: bp.stock ?? {} })
      if (!bp.stock || !info || info.missing.length > 0) blocks.push(`${name}沒有完整的原廠組合，不能在建角時選。`)
    }
    const price = item ? (item.price ?? 0) : productPrice(k.content, bp!.id)
    points += gearPointsOf(price, p.limits) * qty
    changes.push(...giveChanges(k, id, qty, 'cg', made + 1))
    if (bp) made += qty
    const o = ownedOf(k, id, qty, 'pick')
    if (o) owned.push(o)
  })

  // 出身白給的（不花點數）
  for (const { id, qty } of kitOf(k, d)) {
    if (!k.content.has('item', id) && !gearBlueprint(k, id)) continue
    changes.push(...giveChanges(k, id, qty, 'ck', made + 1))
    if (gearBlueprint(k, id)) made += qty
    const o = ownedOf(k, id, qty, 'kit')
    if (o) owned.push(o)
  }
  if (took.length === 0 && changes.length === 0 && d.gear === undefined) return
  // 草稿沒給選的東西（舊的給法）時只給出身白給的，不回答點數（花了幾點照 gearSpent）
  return { took, blocks, ...(d.gear !== undefined ? { points } : {}), changes, owned }
}

// ---- 目錄與外觀（M4 收尾修正批；使用者 2026-11-26 裁決 11；掛點 creation.catalog、creation.look） ----

interface CatalogRowLike {
  id: string
  name: string
  desc: string
  grade: number
  brand: string
  price: number
  points: number
  category: string
  slots?: string[]
  block: string | null
}
interface CatalogPayloadLike { state: GameState; draft: DraftLike; limits: LimitsLike }

/**
 * 掛點 creation.catalog 的回答：物品（類別要在 gear_kinds 裡、不是藥、不是成人道具、等級在 gear_grade_max 以內、沒寫 creation: false）與武器、護甲的設計圖（要有完整的原廠組合）。
 * block 是這個出身買不買得到（available）；點數是價錢 ÷ gear_point_price 進位、最少 1。
 */
export function catalogAnswer(k: Kernel, p: CatalogPayloadLike): { gear: CatalogRowLike[] } | void {
  const gear: CatalogRowLike[] = []
  if (k.content.hasKind('item')) {
    for (const it of k.content.list<ItemEntry & { adult?: unknown; available?: unknown; creation?: unknown; brand?: unknown }>('item')) {
      if (it.creation === false || it.category === 'drug' || it.adult === true || !p.limits.gearKinds.includes(it.category) || it.grade > p.limits.gearGradeMax) continue
      const price = it.price ?? 0
      gear.push({ id: it.id, name: it.name, desc: it.desc, grade: it.grade, brand: typeof it.brand === 'string' ? it.brand : '', price, points: gearPointsOf(price, p.limits), category: it.category, block: availableBlock(k, p.draft, it) })
    }
  }
  if (k.content.hasKind('blueprint')) {
    for (const bp of k.content.list<BlueprintEntry & { creation?: unknown }>('blueprint')) {
      if ((bp.kind !== 'weapon' && bp.kind !== 'armor') || bp.creation === false || !p.limits.gearKinds.includes(bp.kind) || bp.grade > p.limits.gearGradeMax) continue
      const info = bp.stock ? productOf(k.content, bp.id, { parts: bp.stock }) : undefined
      if (!info || info.missing.length > 0) continue
      const price = productPrice(k.content, bp.id)
      gear.push({
        id: bp.id, name: bp.name, desc: bp.desc, grade: bp.grade, brand: bp.brand, price, points: gearPointsOf(price, p.limits), category: bp.kind,
        slots: bp.kind === 'weapon' ? (bp.carry ? [bp.carry] : []) : [...(bp.covers ?? [])], block: availableBlock(k, p.draft, bp as { available?: unknown }),
      })
    }
  }
  return { gear }
}

interface LookPayloadLike { draft: DraftLike; he: string }

const STYLE_CATEGORIES = ['clothing', 'armor', 'accessory']

/** 一件物品或設計圖的風格（{ tag, value }；寫成 from_skin 的看不到零件，不算）。 */
function styleOf(entry: unknown): { tag: string; value: number } | null {
  const spec = styleSpec((entry as { style?: unknown } | undefined)?.style)
  return spec && spec !== 'from_skin' ? spec : null
}

/**
 * 掛點 creation.look 的回答：穿著的風格與一句穿著的描寫。風格是出身白給的衣服（kit_free）加上這一次選的衣服、護甲、飾品各自風格的合計；
 * 句子：「<他>今天穿著出身那一區的<白給那一套的風格>日常服裝，外面加上<選的那幾件>。」
 */
export function lookAnswer(k: Kernel, p: LookPayloadLike): { style: { tags: Array<[string, number]>; line: string } } | void {
  const he = p.he
  const tags = new Map<string, number>()
  const add = (entry: unknown): void => {
    const s = styleOf(entry)
    if (s) tags.set(s.tag, (tags.get(s.tag) ?? 0) + s.value)
  }
  const entryOf = (id: string): { name: string; style: unknown; wear: boolean } | undefined => {
    const bp = gearBlueprint(k, id)
    if (bp) return { name: bp.name, style: bp, wear: bp.kind === 'armor' }
    const item = k.content.get<ItemEntry>('item', id)
    return item ? { name: item.name, style: item, wear: STYLE_CATEGORIES.includes(item.category) } : undefined
  }
  const kitTags = new Map<string, number>()
  for (const { id } of kitOf(k, p.draft)) {
    const e = entryOf(id)
    if (!e || !e.wear) continue
    const s = styleOf(e.style)
    if (s) kitTags.set(s.tag, (kitTags.get(s.tag) ?? 0) + s.value)
    add(e.style)
  }
  const worn: string[] = []
  for (const pick of Array.isArray(p.draft.gear) ? (p.draft.gear as unknown[]) : []) {
    if (!isRecord(pick) || !isText(pick.id)) continue
    const e = entryOf(pick.id)
    if (!e || !e.wear) continue
    worn.push(e.name)
    add(e.style)
  }
  const kitMain = [...kitTags.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (tags.size === 0 && worn.length === 0 && !kitMain) return
  const line = `${he}今天穿著${kitMain ? `出身那一區的${kitMain}` : ''}日常服裝${worn.length ? `，外面加上${worn.join('、')}` : ''}。`
  return { style: { tags: [...tags.entries()], line } }
}
