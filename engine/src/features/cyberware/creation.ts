// L6 功能 cyberware 的建角（M4-creation-body；CHARACTER 2.1、5.4 節；CYBERWARE 7.5 節「建角」那一欄；LEWD_SYSTEM 第 1 節最後一條；dev/adr/0019 第十一節與 P52、P53）。
//
// 掛點 creation.step（features/creation 宣告；這裡只認名字與格式，不 import）：
//   cyber  橋與義體（第 6 步）。picks 是選的橋（{ blueprint, bridge: true }）加其他義體（{ blueprint, side? }）。
//          一定要選橋或明寫沒有橋（draft.bridge 是 null）；橋最多一座；出身限定的擋下；每個部位不超過槽數；沒有橋時不能選要橋的。
//          一件的點數：設計圖寫了 creation_points 就照寫，沒寫是（成品價 × cyber_install_mult）÷ cyber_point_price 進位，最少 1。
//          提交時身上就有這些義體：用設計圖 stock 的零件、不休養、沉溺成本照設計圖與零件算（不打折）、沉溺設到下限；沒有橋時 ext.bridge 是 null。
//   gear   裝備（第 9 步）裡的甲板（內容種類 deck 的成品，或設計圖帶 deck 欄位）：點數照裝備的算法（價錢 ÷ gear_point_price 進位，最少 1）、只收 gear_grade_max 級以內、
//          要有橋、腦裡只能一副，直接裝進腦部（沉溺的下限照加）。
// 草稿沒給選的東西（bridge 與 cyber 都沒寫）時第 6 步不回答：舊的草稿（只寫 cyberSpent）行為不變。

import type { BlueprintEntry, Change, FactionEntry, GameState, Kernel, OriginEntry } from '../../core'
import { clone, isRecord, productOf, productPrice, toMinutes } from '../../core'
import { capacityOfProduct } from './bridge'
import { deckContentOf } from './deck'
import type { CyberPiece, PartId } from './model'
import { PART_NAME, blueprintEntry, cyberRules, partIdOf } from './model'
import { pieceSink } from './surgery'

type Step = 'cyber' | 'abilities' | 'gear'
interface DraftLike {
  origin?: string
  originChoice?: { favor?: string }
  bridge?: string | null
  cyber?: Array<{ blueprint?: unknown; side?: unknown }>
}
interface LimitsLike { cyberPointPrice: number; cyberInstallMult: number; gearPointPrice: number; gearGradeMax: number; gearKinds: string[] }
interface Payload { state: GameState; draft: DraftLike; step: Step; picks: unknown[]; limits: LimitsLike }
interface Owned { id: string; name: string; category: string; slots?: string[]; qty: number; from: 'kit' | 'pick' }
interface Answer {
  took: number[]
  blocks?: string[]
  points?: number
  changes?: Change[]
  ext?: Record<string, unknown>
  sink?: number
  capacity?: Record<string, number>
  owned?: Owned[]
  notes?: string[]
}

const PC = 'pc'
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']
const roman = (n: number): string => ROMAN[n] ?? String(n)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** 沒有橋的後果要先講清楚（CHARACTER 2.1 節、LEWD_SYSTEM 第 1 節）。 */
export const NO_BRIDGE_NOTE = '沒有橋：沒有感載、沒有技能、不能潛入，也不能再選要接在橋上的義體。'

/** 一件東西買不買得到：出身（與企業出身選的那一家）要對得上它的 available（物品與設計圖的 available.origins、available.faction）。 */
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

const cyberwareOf = (k: Pick<Kernel, 'content'>, id: unknown): BlueprintEntry | undefined => {
  if (!isText(id)) return undefined
  const bp = blueprintEntry(k, id)
  return bp?.kind === 'cyberware' ? bp : undefined
}

/** 一件義體在建角時的點數（P52）。 */
export function creationPointsOf(k: Pick<Kernel, 'content'>, bp: BlueprintEntry, limits: Pick<LimitsLike, 'cyberPointPrice' | 'cyberInstallMult'>): number {
  if (typeof bp.creation_points === 'number' && Number.isFinite(bp.creation_points)) return Math.max(0, bp.creation_points)
  return Math.max(1, Math.ceil((productPrice(k.content, bp.id) * limits.cyberInstallMult) / limits.cyberPointPrice - 1e-9))
}

/** 用裝備點數買東西的點數：價錢 ÷ gear_point_price 進位，最少 1。 */
const gearPointsOf = (price: number, limits: Pick<LimitsLike, 'gearPointPrice'>): number => Math.max(1, Math.ceil(price / limits.gearPointPrice - 1e-9))

interface Row {
  /** 在 picks 裡是第幾個 */
  index: number
  bp: BlueprintEntry
  isBridge: boolean
  part: PartId | null
}

/** 第 6 步的選項（認得的）。 */
function cyberRows(k: Pick<Kernel, 'content'>, picks: unknown[]): { rows: Row[]; took: number[] } {
  const rows: Row[] = []
  const took: number[] = []
  picks.forEach((p, index) => {
    if (!isRecord(p)) return
    const bp = cyberwareOf(k, p.blueprint)
    if (!bp) return
    took.push(index)
    const side = p.side === 'l' || p.side === 'r' ? p.side : undefined
    rows.push({ index, bp, isBridge: p.bridge === true || bp.slot === 'bridge', part: partIdOf(bp.slot, side) })
  })
  return { rows, took }
}

/** 設計圖的原廠組合（stock）；沒有 stock 或不完整是 undefined。 */
function stockOf(k: Pick<Kernel, 'content'>, bp: BlueprintEntry): Record<string, string | string[]> | undefined {
  if (!bp.stock) return undefined
  const info = productOf(k.content, bp.id, { parts: bp.stock })
  return info && info.missing.length === 0 ? clone(bp.stock) : undefined
}

const uidOf = (prefix: string, n: number): string => `${prefix}${n}`

/** 一件義體放進主角身上的樣子：用 stock 的零件、不休養、沉溺成本不打折（unlicensed 的沉溺加減是 0；P2）。 */
function pieceOf(k: Kernel, state: GameState, uid: string, id: string, part: PartId, parts: Record<string, string | string[]>, kind: 'blueprint' | 'deck' = 'blueprint'): CyberPiece {
  const sink = pieceSink(k, state, id, kind === 'deck' ? {} : { uid, parts }, { via: 'unlicensed' })
  return { uid, bp: id, kind_of: kind, slot: part, parts: kind === 'deck' ? {} : parts, state: 'new', sink, at: toMinutes(state.time) }
}

/** 兩種答案的共同部分：把選的義體寫進 actor.ext.cyber、沉溺補到下限。 */
function installChanges(pieces: CyberPiece[], sinkDelta: number): Change[] {
  const out: Change[] = []
  if (pieces.length > 0) out.push({ op: 'actor.ext', id: PC, key: 'cyber', value: { pieces: clone(pieces) } })
  if (sinkDelta > 0) out.push({ op: 'actor.track', id: PC, track: 'sink', delta: sinkDelta })
  return out
}

// ---- 第 6 步 ----

const cyberPiecesOf = (k: Kernel, state: GameState, rows: Row[]): { pieces: CyberPiece[]; sink: number } => {
  const pieces: CyberPiece[] = []
  for (const r of rows) {
    const parts = stockOf(k, r.bp)
    if (!parts || !r.part) continue
    pieces.push(pieceOf(k, state, uidOf('cb', r.index + 1), r.bp.id, r.part, parts))
  }
  return { pieces, sink: pieces.reduce((n, p) => n + p.sink, 0) }
}

function cyberAnswer(k: Kernel, p: Payload): Answer | void {
  const d = p.draft
  if (d.bridge === undefined && d.cyber === undefined) return // 舊的草稿：沒給選的東西
  const { rows, took } = cyberRows(k, p.picks)
  const blocks: string[] = []
  const rules = cyberRules(k)

  // 橋：一定要選一座，或明寫沒有橋（P53）；最多一座
  const bridges = rows.filter((r) => r.isBridge)
  if (d.bridge === undefined && bridges.length === 0) blocks.push('要選一座橋，或選「沒有橋」。')
  if (bridges.length > 1) blocks.push('橋最多一座。')
  if (d.bridge === null && bridges.length > 0) blocks.push('選了「沒有橋」，就不能再選一座橋。')
  const noBridge = d.bridge === null

  const perPart = new Map<PartId, number>()
  let points = 0
  for (const r of rows) {
    const name = r.bp.name
    const why = availableBlock(k, d, r.bp as { available?: unknown })
    if (why) blocks.push(`${name}：${why}`)
    if (r.isBridge && r.bp.slot !== 'bridge') blocks.push(`${name}不是橋。`)
    else if (!r.isBridge && r.bp.slot === 'bridge') blocks.push(`${name}是橋，要在選橋的地方選。`)
    if (r.bp.deck !== undefined) blocks.push(`${name}是甲板：甲板在第 9 步用裝備點數選。`)
    if (!stockOf(k, r.bp)) blocks.push(`${name}沒有完整的原廠組合，不能在建角時選。`)
    if (!r.part) blocks.push(`${name}要選左邊還是右邊。`)
    else perPart.set(r.part, (perPart.get(r.part) ?? 0) + 1)
    if (noBridge && !r.isBridge && r.bp.needs_bridge !== false) blocks.push(`${name}要接在橋上，選了「沒有橋」就裝不了。`)
    points += creationPointsOf(k, r.bp, p.limits)
  }
  // 腦部的槽也留給第 9 步選的甲板（有一副就少一槽），這裡只看這一步選的
  for (const [part, n] of perPart) if (n > rules.slots[part]) blocks.push(`${PART_NAME[part]}只有 ${rules.slots[part]} 槽，選了 ${n} 件。`)

  const { pieces, sink } = cyberPiecesOf(k, p.state, rows)
  const answer: Answer = {
    took, blocks, points,
    changes: installChanges(pieces, sink), sink,
    owned: pieces.map((piece) => ({ id: piece.bp, name: blueprintEntry(k, piece.bp)?.name ?? piece.bp, category: 'cyberware', slots: [piece.slot], qty: 1, from: 'pick' as const })),
    notes: noBridge ? [NO_BRIDGE_NOTE] : [],
  }
  if (noBridge) answer.ext = { bridge: null }
  const bridge = bridges[0]
  const parts = bridge ? stockOf(k, bridge.bp) : undefined
  if (bridge && parts) {
    const cap = capacityOfProduct(k, bridge.bp.id, { parts }, rules.cap_min).split
    answer.capacity = { meat: cap.meat, net: cap.net, social: cap.social, media: cap.media }
  } else answer.capacity = { meat: 0, net: 0, social: 0, media: 0 }
  return answer
}

// ---- 第 9 步：甲板 ----

interface DeckRow {
  index: number
  id: string
  name: string
  grade: number
  price: number
  qty: number
  /** 內容種類 deck 的成品，或設計圖帶 deck 欄位 */
  kind: 'deck' | 'blueprint'
  bp?: BlueprintEntry
  entry: { available?: unknown }
}

function deckRows(k: Pick<Kernel, 'content'>, picks: unknown[]): { rows: DeckRow[]; others: Array<{ index: number; bp: BlueprintEntry }>; took: number[] } {
  const rows: DeckRow[] = []
  const others: Array<{ index: number; bp: BlueprintEntry }> = []
  const took: number[] = []
  picks.forEach((pick, index) => {
    if (!isRecord(pick) || !isText(pick.id)) return
    const qty = Number.isInteger(pick.qty) ? (pick.qty as number) : pick.qty === undefined ? 1 : 0
    const deck = deckContentOf(k, pick.id)
    if (deck) {
      took.push(index)
      rows.push({ index, id: pick.id, name: deck.name, grade: deck.grade, price: deck.price ?? 0, qty, kind: 'deck', entry: deck as { available?: unknown } })
      return
    }
    const bp = cyberwareOf(k, pick.id)
    if (!bp) return
    took.push(index)
    if (bp.deck !== undefined) rows.push({ index, id: pick.id, name: bp.name, grade: bp.grade, price: productPrice(k.content, bp.id), qty, kind: 'blueprint', bp, entry: bp as { available?: unknown } })
    else others.push({ index, bp })
  })
  return { rows, others, took }
}

function gearAnswer(k: Kernel, p: Payload): Answer | void {
  const { rows, others, took } = deckRows(k, p.picks)
  if (took.length === 0) return
  const d = p.draft
  const rules = cyberRules(k)
  const blocks: string[] = []
  for (const o of others) blocks.push(`${o.bp.name}是義體，要用義體點數在第 6 步選，不能用裝備點數買。`)

  const cyber = cyberRows(k, picksOfCyber(d))
  const bridgeKnown = d.bridge !== undefined || cyber.rows.some((r) => r.isBridge)
  const noBridge = d.bridge === null
  const brain = cyber.rows.filter((r) => r.part === 'brain').length
  let points = 0
  for (const r of rows) {
    if (!p.limits.gearKinds.includes('deck')) blocks.push(`${r.name}：甲板不能用裝備點數買。`)
    if (r.grade > p.limits.gearGradeMax) blocks.push(`${r.name}是 ${roman(r.grade)} 級，起始的裝備只能買 I～${roman(p.limits.gearGradeMax)} 級。`)
    const why = availableBlock(k, d, r.entry)
    if (why) blocks.push(`${r.name}：${why}`)
    if (r.qty !== 1) blocks.push(`${r.name}一次只能裝一副。`)
    if (noBridge) blocks.push(`${r.name}要接在橋上，選了「沒有橋」就裝不了。`)
    else if (!bridgeKnown) blocks.push(`${r.name}要接在橋上：要先在第 6 步選一座橋。`)
    if (r.bp && !stockOf(k, r.bp)) blocks.push(`${r.name}沒有完整的原廠組合，不能在建角時選。`)
    points += gearPointsOf(r.price, p.limits) * Math.max(1, r.qty)
  }
  if (rows.length > 1) blocks.push('腦裡只能裝一副甲板。')
  if (rows.length > 0 && brain + 1 > rules.slots.brain) blocks.push(`腦部只有 ${rules.slots.brain} 槽，已經被選的義體占滿了。`)

  // 身上的義體：第 6 步選的加上甲板（第 6 步的答案寫過一份，這一份是完整的，後寫的蓋掉前面的）
  const base = cyberPiecesOf(k, p.state, cyber.rows)
  const pieces = [...base.pieces]
  let deckSink = 0
  rows.forEach((r, i) => {
    const uid = uidOf('cd', i + 1)
    if (r.kind === 'deck') pieces.push(pieceOf(k, p.state, uid, r.id, 'brain', {}, 'deck'))
    else {
      const parts = stockOf(k, r.bp!)
      if (parts) pieces.push(pieceOf(k, p.state, uid, r.bp!.id, 'brain', parts))
    }
  })
  for (const piece of pieces.slice(base.pieces.length)) deckSink += piece.sink
  const changes: Change[] = []
  if (pieces.length > base.pieces.length) changes.push({ op: 'actor.ext', id: PC, key: 'cyber', value: { pieces: clone(pieces) } })
  if (deckSink > 0) changes.push({ op: 'actor.track', id: PC, track: 'sink', delta: deckSink })
  return {
    took, blocks, points, changes, sink: deckSink,
    owned: rows.map((r) => ({ id: r.id, name: r.name, category: 'deck', slots: ['brain'], qty: 1, from: 'pick' as const })),
  }
}

/** 第 6 步的選項（給第 9 步算腦部占了幾槽、有沒有橋用）。 */
function picksOfCyber(d: DraftLike): unknown[] {
  return [...(typeof d.bridge === 'string' ? [{ blueprint: d.bridge, bridge: true }] : []), ...(Array.isArray(d.cyber) ? d.cyber : [])]
}

/** 掛點 creation.step 的回答。 */
export function answerCreation(k: Kernel, p: Payload): Answer | void {
  if (p.step === 'cyber') return cyberAnswer(k, p)
  if (p.step === 'gear') return gearAnswer(k, p)
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
 * 掛點 creation.catalog 的回答：橋（設計圖的部位是 bridge）、其他義體（要有完整的原廠組合、不是甲板）、甲板（內容種類 deck 的成品或設計圖帶 deck；用裝備點數，只列 gear_grade_max 級以內）。
 * block 是這個出身買不買得到（available）；點數照第 6 步與第 9 步一樣的算法。
 */
export function catalogAnswer(k: Kernel, p: CatalogPayloadLike): { bridges: CatalogRowLike[]; cyber: CatalogRowLike[]; gear: CatalogRowLike[] } | void {
  const bridges: CatalogRowLike[] = []
  const cyber: CatalogRowLike[] = []
  const gear: CatalogRowLike[] = []
  if (k.content.hasKind('blueprint')) {
    for (const bp of k.content.list<BlueprintEntry>('blueprint')) {
      if (bp.kind !== 'cyberware') continue
      const stock = stockOf(k, bp)
      if (bp.deck !== undefined) {
        if (!stock || bp.grade > p.limits.gearGradeMax) continue
        const price = productPrice(k.content, bp.id)
        gear.push({ id: bp.id, name: bp.name, desc: bp.desc, grade: bp.grade, brand: bp.brand, price, points: gearPointsOf(price, p.limits), category: 'deck', slots: ['brain'], block: availableBlock(k, p.draft, bp as { available?: unknown }) })
        continue
      }
      if (!stock) continue
      const row: CatalogRowLike = {
        id: bp.id, name: bp.name, desc: bp.desc, grade: bp.grade, brand: bp.brand, price: productPrice(k.content, bp.id), points: creationPointsOf(k, bp, p.limits), category: 'cyberware',
        slots: bp.slot ? [bp.slot] : [], block: availableBlock(k, p.draft, bp as { available?: unknown }),
      }
      if (bp.slot === 'bridge') bridges.push(row)
      else cyber.push(row)
    }
  }
  if (p.limits.gearKinds.includes('deck')) {
    for (const d of k.content.hasKind('deck') ? k.content.list('deck') : []) {
      const deck = deckContentOf(k, d.id)
      if (!deck || deck.grade > p.limits.gearGradeMax) continue
      const price = deck.price ?? 0
      gear.push({ id: deck.id, name: deck.name, desc: typeof deck.desc === 'string' ? deck.desc : '', grade: deck.grade, brand: typeof deck.brand === 'string' ? deck.brand : '', price, points: gearPointsOf(price, p.limits), category: 'deck', slots: ['brain'], block: availableBlock(k, p.draft, deck as { available?: unknown }) })
    }
  }
  return { bridges, cyber, gear: p.limits.gearKinds.includes('deck') ? gear : [] }
}

interface LookPayloadLike { draft: DraftLike; he: string; texts: { brand_lines: Record<string, string>; beast_lines: Record<string, { mood: string; move: string }> } }

const brandKey = (brand: string): string => (brand.includes('二手') ? '二手' : brand.includes('同人') ? '同人' : brand)

/**
 * 掛點 creation.look 的回答：外露的義體（設計圖 look.at）與獸化（設計圖 look.beast；系由草稿的 beastLine，沒寫是貓）。
 * 句子的模板是 NPC_SYSTEM 13.11 節：「<他>的<部位>是<牌子的名字>，<外殼的描寫>。」外殼的描寫是設計圖 look.line，沒寫用牌子的（creation_rule 的 look.brand_lines 蓋掉預設）。
 */
export function lookAnswer(k: Kernel, p: LookPayloadLike): { cyber: string[]; beast: string[] } | void {
  const d = p.draft
  const picks: Array<{ bp: BlueprintEntry; bridge: boolean }> = []
  for (const x of [...(typeof d.bridge === 'string' ? [{ blueprint: d.bridge, bridge: true }] : []), ...(Array.isArray(d.cyber) ? d.cyber.map((c) => ({ blueprint: c.blueprint, bridge: false })) : [])]) {
    const bp = cyberwareOf(k, x.blueprint)
    if (bp) picks.push({ bp, bridge: x.bridge || bp.slot === 'bridge' })
  }
  if (picks.length === 0) return
  const he = p.he
  const lineName = (d as { beastLine?: unknown }).beastLine
  const line = typeof lineName === 'string' && lineName ? lineName : '貓'
  const L = p.texts.beast_lines[line] ?? p.texts.beast_lines['貓'] ?? { mood: '不高興', move: '往後貼平' }
  const what = (bp: BlueprintEntry, bridge: boolean): string => {
    const b = bp.brand.replace('（二手）', '').split('／')[0]!
    const n = bp.name.includes(b) ? bp.name : `${b}的${bp.name}`
    return bridge ? `${n}的橋接口` : n
  }
  const cyber: string[] = []
  const beast: string[] = []
  for (const { bp, bridge } of picks) {
    const look = bp.look
    if (!look) continue
    cyber.push(`${he}的${look.at}是${what(bp, bridge)}，${look.line ?? p.texts.brand_lines[brandKey(bp.brand)] ?? '外殼沒有什麼特別'}。`)
    if (look.beast?.part === 'ears') beast.push(`${he}的頭上有一對${line}耳，${look.beast.school === 'mech' ? '外殼是霧面的黑色，耳根有一圈金屬的接縫' : '毛是真的，摸得到底下的軟骨'}，${he}${L.mood}的時候耳朵會${L.move}。`)
    else if (look.beast?.part === 'tail') beast.push(`${he}的身後拖著一條${line}尾，${look.beast.school === 'mech' ? '外殼是霧面的黑色，尾根有一圈金屬的接縫' : '毛是真的，摸得到底下的骨節'}。`)
  }
  return { cyber: cyber.filter(() => true), beast }
}
