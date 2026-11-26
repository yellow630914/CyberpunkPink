// L6 裝備：別人看到的樣子（EQUIPMENT 第 5 節；LEWD_SYSTEM 第 2 節；CRAFTING 3.3 節「外皮決定風格與曝露度」）。
//   seen      看得到的那幾件：頭、面、外套、沒被扣上的外套蓋住的上身與護甲（長外套扣上連下身也蓋住）、下身、手、鞋、頸與腿的飾品、主武器；
//             副武器與近戰只有藏不住（concealment 的 shown）的才看得到。內衣與通用飾品格不算。
//   風格      看得到的每一件的標籤與值；有風格的四件以上都是同一個標籤時 unified，風格值多 unified_bonus。
//   曝露度    照 ElondiaRPG（src/engine/lewd.ts 的 exposureLevel）：上身那一側 ＝ 上身那件 ＋ 真空的一點（沒有內衣、而且那件曝露度 ≥ 1），
//             沒有上身那件時看內衣（至少 underwear_visible）、什麼都沒穿是 naked；下身同理；曝露度 ＝ 兩側的最大值，夾在 0～3。
//             加外套：扣上的外套讓上半身算 0，長外套扣上讓全身最多 1。
//   威脅感    看得到的護甲（護甲值大於 0 的）與武器有幾件；交涉與威嚇的加減沒有數字，這一批只給件數。
// 設計圖的 style（{ tag, value } 或 'from_skin'）、exposure（0～3 或 'from_skin'）、long；外皮零件的 style_tag 與 stats.style、stats.exposure。
// from_skin ＝ 讀裝著的外皮：風格的標籤是零件上的 style_tag，值是 productOf 的 stats.style 合計（板材的「風格 −1」也算進去）。

import type { ActorId, BlueprintEntry, GameState, ItemEntry, ItemStack, Kernel } from '../../core'
import { WEAR_SLOTS, isRecord } from '../../core'
import type { WornPiece } from './model'
import { gearOf, productOfStack, stackOf, wornPieces } from './model'
import { concealment, pieceArmor } from './numbers'
import { gearRules } from './rules'

export type SeenKind = 'armor' | 'weapon' | 'accessory'

/** 看得到的一件。id 是成品的 uid（飾品是物品的 id）；slot 是它露在外面的第一格（連身類只列一次）。 */
export interface SeenPiece {
  group: 'worn' | 'acc' | 'carry'
  slot: string
  id: string
  name: string
  kind: SeenKind
  /** 風格標籤；沒有風格是 null */
  tag: string | null
  /** 風格值（可以是負的：板材的代價） */
  value: number
}

export interface StyleInfo {
  /** 每個風格標籤的風格值合計（看得到的那幾件；第一次出現的順序） */
  tags: Array<[string, number]>
  /** 合計最高（而且大於 0）的標籤；沒有是 null */
  main: string | null
  /** 有風格的看得到的四件以上（unified_min）都是同一個標籤 */
  unified: boolean
  /** 曝露度 0～3 */
  exposure: number
  seen: SeenPiece[]
  /** 看得到的護甲與武器有幾件 */
  threat: number
}

type Rec = Record<string, unknown>
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)))

/** 設計圖或物品上的 style：{ tag, value } 或 'from_skin'；其餘是沒有。 */
export function styleSpec(raw: unknown): { tag: string; value: number } | 'from_skin' | null {
  if (raw === 'from_skin') return 'from_skin'
  if (isRecord(raw) && isText(raw.tag) && typeof raw.value === 'number' && Number.isFinite(raw.value)) return { tag: raw.tag, value: raw.value }
  return null
}

/** 設計圖上的 exposure：0～3 的整數或 'from_skin'；其餘是沒有。 */
export function exposureSpec(raw: unknown): number | 'from_skin' | null {
  if (raw === 'from_skin') return 'from_skin'
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 3 ? raw : null
}

interface PieceLook {
  tag: string | null
  value: number
  exposure: number
}

/** 一件護甲或服裝的風格與曝露度（from_skin 讀外皮零件）。 */
export function pieceLook(k: Kernel, stack: ItemStack, bp: BlueprintEntry): PieceLook {
  const info = productOfStack(k, stack)
  const stats = info?.stats ?? {}
  const style = styleSpec((bp as unknown as Rec).style)
  let tag: string | null = null
  let base = 0
  if (style === 'from_skin') {
    const skin = info?.parts.find((p) => isText((p.part as unknown as Rec).style_tag))
    tag = skin ? ((skin.part as unknown as Rec).style_tag as string) : null
  } else if (style) {
    tag = style.tag
    base = style.value
  }
  const exp = exposureSpec((bp as unknown as Rec).exposure)
  return {
    tag,
    value: Math.round(base + (stats.style ?? 0)),
    exposure: clampInt((typeof exp === 'number' ? exp : 0) + (stats.exposure ?? 0), 0, 3),
  }
}

/** 長外套（設計圖寫 long: true）：扣上讓全身最多 1，連下身也蓋住。 */
const isLong = (p: WornPiece): boolean => (p.bp as unknown as Rec).long === true

const itemEntry = (k: Kernel, id: string): (ItemEntry & Rec) | undefined => k.content.get<ItemEntry & Rec>('item', id)

interface Layers {
  /** 上身那件（上身格；沒有時是護甲格那件） */
  top?: WornPiece
  bottom?: WornPiece
  uwTop?: WornPiece
  uwBottom?: WornPiece
  /** 外套：外套格那件，而且不是同一件連身類佔著上身或下身 */
  coat?: WornPiece
}

function layersOf(pieces: WornPiece[], worn: Record<string, string | undefined>): Layers {
  const byUid = (uid: string | undefined): WornPiece | undefined => (uid ? pieces.find((p) => p.uid === uid) : undefined)
  const out: Layers = {
    top: byUid(worn.upper) ?? byUid(worn.armor), bottom: byUid(worn.lower), uwTop: byUid(worn.underwear_top), uwBottom: byUid(worn.underwear_bottom),
  }
  const outer = byUid(worn.outer)
  if (outer && outer.uid !== worn.upper && outer.uid !== worn.lower) out.coat = outer
  return out
}

/** 外套扣上：上身與護甲看不到；長外套連下身也看不到（腿和鞋還是看得到）。外套敞開或沒有外套：沒有被蓋住的格。 */
function coveredOf(layers: Layers, coat: 'open' | 'closed'): Set<string> {
  const closed = !!layers.coat && coat === 'closed'
  return new Set<string>(closed ? ['upper', 'armor', ...(isLong(layers.coat!) ? ['lower'] : [])] : [])
}

/**
 * 這個人現在被外套蓋住（別人看不到）的穿著格 id（WEAR_SLOTS 的 id）：外套扣上才有；上身（upper）、護甲（armor），長外套再加下身（lower）。
 * 畫面的「被蓋住」標示問這裡，不自己列哪幾格（M4 收尾修正批；ui 拿掉 coveredByCoat 表）。
 */
export function coveredSlots(k: Kernel, state: GameState, actor: ActorId): ReadonlySet<string> {
  const gear = gearOf(state, actor)
  return coveredOf(layersOf(wornPieces(k, state, gear), gear.worn), gear.coat)
}

/** 曝露度（ElondiaRPG 的算法加外套）。 */
function exposureLevel(k: Kernel, layers: Layers, coat: 'open' | 'closed'): number {
  const rules = gearRules(k)
  const exp = (p: WornPiece): number => pieceLook(k, p.stack, p.bp).exposure
  // 真空：外面那件會走光（曝露度 ≥ 1），而且那一側底下沒穿內衣或內褲，多 1 點
  const side = (outer: WornPiece | undefined, under: WornPiece | undefined): number => {
    if (outer) {
      const e = exp(outer)
      return Math.min(rules.naked, e + (!under && e >= 1 ? 1 : 0))
    }
    return under ? Math.max(rules.underwear_visible, exp(under)) : rules.naked
  }
  let top = side(layers.top, layers.uwTop)
  let bottom = side(layers.bottom, layers.uwBottom)
  if (layers.coat && coat === 'closed') {
    top = 0
    if (isLong(layers.coat)) bottom = Math.min(bottom, 1)
  }
  return clampInt(Math.max(top, bottom), 0, rules.naked)
}

/** 這個人現在看得到的樣子（風格、曝露度、威脅感）。 */
export function styleOf(k: Kernel, state: GameState, actor: ActorId): StyleInfo {
  const gear = gearOf(state, actor)
  const rules = gearRules(k)
  const pieces = wornPieces(k, state, gear)
  const layers = layersOf(pieces, gear.worn)
  const covered = coveredOf(layers, gear.coat)

  const seen: SeenPiece[] = []
  let threat = 0
  const done = new Set<string>()
  for (const slot of WEAR_SLOTS) {
    const uid = gear.worn[slot]
    if (!uid || done.has(uid) || slot === 'underwear_top' || slot === 'underwear_bottom') continue
    const piece = pieces.find((p) => p.uid === uid)
    if (!piece) continue
    // 連身類：佔著的格有一格看得到就算看得到
    const visible = piece.slots.filter((s) => !covered.has(s) && s !== 'underwear_top' && s !== 'underwear_bottom')
    if (visible.length === 0) continue
    done.add(uid)
    const look = pieceLook(k, piece.stack, piece.bp)
    seen.push({ group: 'worn', slot: visible[0]!, id: uid, name: piece.bp.name, kind: 'armor', tag: look.tag, value: look.value })
    if (pieceArmor(k, piece.stack, piece.bp) > 0) threat += 1
  }
  for (const slot of ['neck', 'leg'] as const) {
    const id = gear.acc[slot]
    const item = id ? itemEntry(k, id) : undefined
    if (!id || !item) continue
    const style = styleSpec(item.style)
    const spec = style && style !== 'from_skin' ? style : null
    seen.push({ group: 'acc', slot, id, name: item.name, kind: 'accessory', tag: spec?.tag ?? null, value: spec?.value ?? 0 })
  }
  const shown = new Set(concealment(k, state, actor).shown)
  for (const slot of ['main', 'side', 'melee'] as const) {
    const uid = gear.carry[slot]
    const stack = uid ? stackOf(state, uid) : undefined
    const bp = productOfStack(k, stack)?.bp
    if (!uid || !stack || bp?.kind !== 'weapon') continue
    if (slot !== 'main' && !shown.has(uid)) continue
    seen.push({ group: 'carry', slot, id: uid, name: bp.name, kind: 'weapon', tag: null, value: 0 })
    threat += 1
  }

  const sums = new Map<string, number>()
  for (const p of seen) if (p.tag !== null) sums.set(p.tag, (sums.get(p.tag) ?? 0) + p.value)
  const tags = [...sums.entries()]
  const best = tags.reduce<[string, number] | null>((b, t) => (t[1] > 0 && (!b || t[1] > b[1]) ? t : b), null)
  const styled = seen.filter((p) => p.tag !== null)
  return {
    tags, main: best ? best[0] : null,
    unified: styled.length >= rules.unified_min && styled.every((p) => p.tag === styled[0]!.tag),
    exposure: exposureLevel(k, layers, gear.coat),
    seen, threat,
  }
}

/** 風格值：看得到的每一件的風格值合計；風格一致時多 unified_bonus（最少 0）。 */
export function styleValueOf(k: Kernel, state: GameState, actor: ActorId): number {
  const s = styleOf(k, state, actor)
  return Math.max(0, s.seen.reduce((n, p) => n + p.value, 0) + (s.unified ? gearRules(k).unified_bonus : 0))
}

/** 看得到的那幾件裡這個標籤的風格值合計（條件 style 用）。 */
export function styleTagValue(k: Kernel, state: GameState, actor: ActorId, tag: string): number {
  return styleOf(k, state, actor).tags.find(([t]) => t === tag)?.[1] ?? 0
}
