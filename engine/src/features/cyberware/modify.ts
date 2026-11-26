// L6 功能 cyberware 的小手術：換掉身上一件義體的一個零件（CRAFTING 10.3 節「身上的義體換零件是小手術」；TRADE 3.4 節；dev/adr/0019 第四節與 M4-plan 規定 10；dev/work/M4-cyber-lock.md 第 10 條）。
// 背包裡的成品換零件是 craft 的事；這裡是已經裝在身上的那一件，要動刀。
//   槽的檢查用核心的 slotProblems（原因就是它那一句）；有授權鎖的先解鎖；橋以外不另外休養。
//   手術費＝換上去那個零件的目錄價 × 動刀的人的 fee 比例（正規 0.5、無照 0.3、黑 0.4、自己 0）；橋的零件一律走換橋的費用與休養（bridge_fee_mult、bridge_recovery_minutes）。
//   自己動刀擲和安裝同樣的檢定（技術＋義體學對設計圖等級的標準 DC）：大成功沉溺成本 −1；成功照換；失敗照換但多一筆併發症；大失敗沒換成、新零件還在背包、被動刀的人沉溺 +1。
//   診所照各自的併發症機率留一筆併發症。
//   換下來的零件回背包：內嵌的零件整筆放回（核心的 partStack，M4-plan 規定 10），內容的零件是 { state: 'used', uid } 的一疊，生體的換下來就死了；
//   換上去的是那一整筆（零件的引用一律是核心的 PartRef）。
//   沉溺成本重算：換前換後用這一次動刀的人各算一次，差額加在原本算定的成本上（換上 stats.sink −2 的零件就少 2；在別家診所換不會讓原本的折扣憑空消失）；
//   下限跟著變，沉溺不到的補上；降下來的不動沉溺本身。
// 報告 cyber.modify：outcome.result 是 modified、great、complication、botched。骰子用 deriveRng（用途帶 uid）；擲過骰的報告多一筆 rng 推進。

import type { ActorId, BlueprintEntry, Change, CheckRoll, GameState, ItemStack, Kernel, PartEntry, PartRef, ProductData, ReportDraft, TimelineBeat } from '../../core'
import {
  ActionBlocked, DEGREE_NAME, clone, deriveRng, isRecord, partOf, partStack, partTypeName, rollCheck, sinkUpChanges, slotProblems,
} from '../../core'
import { pieceBlueprint } from './deck'
import { pieceName } from './lock'
import type { CyberPiece, SurgeonKind } from './model'
import { PART_NAME, RECOVERING, SURGEON_NAME, cyberOf, cyberRules, isSurgeonKind, nowOf } from './model'
import type { Pool, SelfCheck } from './surgery'
import { SELF_ATTR, complicationPool, floorWith, latestReady, moneyProblem, nameOf, payPool, pieceSink, selfCheckOf, surgeonBlock } from './surgery'
import { writePieces } from './lock'

export const MODIFY_ACTION = 'cyber.modify'
/** 換下來的二手零件的 uid 前綴（和 craft 同一個慣例：核心的流水號 seq.uid ＋ 1 起） */
const USED_PART_UID_PREFIX = 'us'

export interface ModifyOpts {
  actor: ActorId
  /** 身上那一件義體的 uid */
  uid: string
  /** 零件類型（槽） */
  type: string
  /** 換上去的零件：背包裡沒有實例資料的給零件的 id，有的（二手、未登錄）給 uid */
  part: string
  via: SurgeonKind
  /** 動刀的人（只有自己動刀看它；預設被動刀的人自己） */
  by?: ActorId
  /** 換掉這一類的第幾個（從 0 起；預設第一個；等於現有的個數就是在空的選配槽裡多裝一個） */
  index?: number
  pay?: Pool
}

export interface ModifyQuote {
  uid: string
  bp: string
  name: string
  type: string
  index: number
  via: SurgeonKind
  /** 被換掉的零件（空的槽是 null） */
  old: { id: string; name: string; material: string } | null
  /** 換上去的零件 */
  next: { key: string; id: string; name: string; grade: number; material: string; price: number } | null
  /** 手術費（自己動刀是 0） */
  fee: number
  pay: Pool | null
  minutes: number
  /** 這一件現在的沉溺成本（裝上時算定的）與換完之後的（加上這一次換零件前後的差額） */
  sink_before: number
  sink_after: number
  /** 橋的零件換完要休養多久（分鐘）；其他的是 0 */
  recovery_minutes: number
  complication: number
  self?: SelfCheck
}

interface ModifyPlan {
  problems: string[]
  quote: ModifyQuote | null
  piece?: CyberPiece
  bp?: BlueprintEntry
  next?: CyberPiece
  taken?: ItemStack
  newPart?: PartEntry
  oldRef?: PartRef
  oldPart?: PartEntry
}

/** 背包裡找這個零件：帶 uid 的（二手、未登錄）指名 uid；沒有實例資料的那一疊給 id。 */
const findPartStack = (state: GameState, key: string): ItemStack | undefined =>
  state.inventory.find((s) => s.data?.uid === key) ?? state.inventory.find((s) => s.id === key && !s.data && s.qty >= 1)

/** 背包裡這一疊是哪個零件的引用：內嵌的整筆，否則是內容的零件 id。 */
function refOfStack(k: Pick<Kernel, 'content'>, stack: ItemStack): PartRef | undefined {
  const inline = stack.data?.part
  if (isRecord(inline) && partOf(k.content, inline)) return inline as unknown as PartRef
  return k.content.has('part', stack.id) ? stack.id : undefined
}

/** 這件成品實際裝著的零件，每一類一個陣列（沒有 parts 而設計圖有 stock 時用 stock）。 */
function partsByType(bp: BlueprintEntry, data: ProductData): Record<string, PartRef[]> {
  const raw = Object.keys(data.parts).length === 0 && bp.stock ? bp.stock : data.parts
  const out: Record<string, PartRef[]> = {}
  for (const [type, v] of Object.entries(raw)) out[type] = (Array.isArray(v) ? v : [v]).map((r) => clone(r))
  return out
}

function toPartsRecord(by: Record<string, PartRef[]>): ProductData['parts'] {
  const out: ProductData['parts'] = {}
  for (const [type, refs] of Object.entries(by)) if (refs.length > 0) out[type] = refs.length === 1 ? refs[0]! : refs
  return out
}

function planModify(k: Kernel, state: GameState, o: ModifyOpts): ModifyPlan {
  const problems: string[] = []
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  const fail = (extra: Partial<ModifyPlan> = {}): ModifyPlan => ({ problems, quote: null, ...extra })
  if (!state.actors[o.actor]) return { problems: ['找不到這個角色。'], quote: null }
  if (!isSurgeonKind(o.via)) return { problems: ['要說是誰動刀。'], quote: null }
  const act = k.activity.blockOf(state, `commit:${MODIFY_ACTION}`)
  if (act) problems.push(act)
  const piece = cyberOf(state, o.actor).find((p) => p.uid === o.uid)
  if (!piece) return fail({ problems: [...problems, '身上沒有這一件義體。'] })
  const bp = pieceBlueprint(k, piece)
  if (!bp) return fail({ problems: [...problems, `${pieceName(k, piece)}沒有零件可以換。`], piece })
  const name = bp.name
  if (piece.lock !== undefined || piece.off?.why === 'lock') problems.push('有授權鎖的義體要先解鎖。')

  const index = o.index ?? 0
  const need = [...(bp.require ?? []), ...(bp.optional ?? [])].find((n) => n.type === o.type)
  const have = partsByType(bp, piece)
  const current = have[o.type] ?? []
  let oldRef: PartRef | undefined
  if (!need) problems.push(`這張設計圖沒有${partTypeName(o.type)}的槽。`)
  else if (!Number.isInteger(index) || index < 0 || index > current.length || index >= (need.count ?? 1)) problems.push(`${partTypeName(o.type)}的槽沒有第 ${index + 1} 個位置。`)
  else oldRef = current[index]
  const oldPart = oldRef === undefined ? undefined : partOf(k.content, oldRef)

  const taken = typeof o.part === 'string' && o.part !== '' ? findPartStack(state, o.part) : undefined
  let newRef: PartRef | undefined
  let newPart: PartEntry | undefined
  if (!taken) problems.push(`背包裡沒有可以拿來換的零件「${String(o.part)}」。`)
  else {
    newRef = refOfStack(k, taken)
    newPart = newRef === undefined ? undefined : partOf(k.content, newRef)
    if (newRef === undefined || !newPart) problems.push(`背包裡的「${o.part}」不是零件。`)
    else if (need) problems.push(...slotProblems(k.content, bp, o.type, newRef).problems)
  }

  const sb = surgeonBlock(k, state, o.via, o.actor, by, rules)
  if (sb) problems.push(sb)

  const isBridgePiece = piece.slot === 'bridge'
  const feeBase = newPart ? newPart.price * rules.surgeons[o.via].fee * (isBridgePiece ? rules.bridge_fee_mult : 1) : 0
  const fee = Math.round(feeBase + 1e-9)
  const mp = moneyProblem(state, fee, o.pay, '手術費')
  if (mp) problems.push(mp)

  const oldView = oldPart ? { id: oldPart.id, name: oldPart.name, material: oldPart.material } : null
  const nextView = taken && newPart ? { key: o.part, id: newPart.id, name: newPart.name, grade: newPart.grade, material: newPart.material, price: newPart.price } : null
  // 沉溺成本：換前換後用同一個動刀的人各算一次，差額加在裝上時算定的那個數字上（在別家診所換不會讓原本的折扣憑空消失）
  const calcBefore = pieceSink(k, state, piece.bp, piece, { via: o.via, by })
  const sinkBefore = piece.sink
  const baseQuote = (extra: Partial<ModifyQuote> = {}): ModifyQuote => ({
    uid: o.uid, bp: piece.bp, name, type: o.type, index, via: o.via, old: oldView, next: nextView, fee, pay: payPool(state.money, fee, o.pay), minutes: rules.surgery_minutes,
    sink_before: sinkBefore, sink_after: sinkBefore, recovery_minutes: isBridgePiece ? rules.bridge_recovery_minutes : 0,
    complication: o.via === 'self' ? 0 : rules.surgeons[o.via].complication,
    ...(o.via === 'self' ? { self: selfCheckOf(k, state, by, bp, rules) } : {}), ...extra,
  })
  if (!need || newRef === undefined || !newPart || !taken) return { problems, quote: baseQuote(), piece, bp }

  const nextBy = Object.fromEntries(Object.entries(have).map(([t, refs]) => [t, [...refs]]))
  const list = nextBy[o.type] ?? (nextBy[o.type] = [])
  list[index] = clone(newRef)
  const next: CyberPiece = { ...clone(piece), parts: toPartsRecord(nextBy) }
  const sinkAfter = Math.max(0, piece.sink + pieceSink(k, state, piece.bp, next, { via: o.via, by }) - calcBefore)
  return { problems, quote: baseQuote({ sink_after: sinkAfter }), piece, bp, next, taken, newPart, ...(oldRef !== undefined ? { oldRef } : {}), ...(oldPart ? { oldPart } : {}) }
}

export const modifyProblems = (k: Kernel, state: GameState, o: ModifyOpts): string[] => planModify(k, state, o).problems
export const modifyBlock = (k: Kernel, state: GameState, o: ModifyOpts): string | null => planModify(k, state, o).problems[0] ?? null
/** 這一次小手術的報價；身上沒有那一件、沒有零件可以換是 null。 */
export const modifyQuote = (k: Kernel, state: GameState, o: ModifyOpts): ModifyQuote | null => planModify(k, state, o).quote

/** 把背包裡換上去的那一疊拿走的變更。 */
const takeChange = (s: ItemStack): Change => (s.data?.uid !== undefined ? { op: 'item', id: s.id, qty: -1, data: { uid: s.data.uid } } : { op: 'item', id: s.id, qty: -1 })

/**
 * 換身上一件義體的一個零件。不成立丟 ActionBlocked（modifyProblems 的第一條）。報告 cyber.modify。
 */
export function modifyDraft(k: Kernel, state: GameState, o: ModifyOpts): ReportDraft {
  const plan = planModify(k, state, o)
  if (plan.problems.length > 0 || !plan.quote || !plan.piece || !plan.next || !plan.taken || !plan.newPart) throw new ActionBlocked(plan.problems[0] ?? '現在換不了。')
  const q = plan.quote
  const { piece, taken, newPart, oldRef, oldPart } = plan
  const rules = cyberRules(k)
  const by = o.by ?? o.actor
  const patient = state.actors[o.actor]!
  let roll: CheckRoll | undefined
  let rolled = false
  let swapped = true
  let complication = false
  let great = false
  if (q.via === 'self') {
    roll = rollCheck(k.stats, state, { actor: by, attr: SELF_ATTR, skill: rules.self_skill, dc: q.self!.dc, purpose: `${MODIFY_ACTION}/${q.uid}`, tags: ['surgery'] })
    rolled = true
    if (roll.degree === 'critical') great = true
    else if (roll.degree === 'fail') complication = true
    else if (roll.degree === 'fumble') swapped = false
  } else if (q.complication > 0) {
    rolled = true
    complication = deriveRng(state.rng, `${MODIFY_ACTION}/${q.uid}/complication`).chance(q.complication)
  }

  const who = q.via === 'self' && by !== o.actor ? `${nameOf(state, by)}替${patient.name}動刀` : q.via === 'self' ? `${patient.name}自己動刀` : `${patient.name}在${SURGEON_NAME[q.via]}動了手術`
  const changes: Change[] = []
  const lines: string[] = []
  const data: Record<string, unknown> = { uid: q.uid, bp: q.bp, via: q.via, type: q.type, index: q.index, fee: q.fee, swapped, new: newPart.id, ...(oldPart ? { old: oldPart.id } : {}) }
  let result: string

  if (!swapped) {
    changes.push({ op: 'time', minutes: q.minutes }, ...sinkUpChanges(k, state, o.actor, 1))
    lines.push(`${who}，換${q.name}的${partTypeName(q.type)}時失了手：沒有換成，神經被扯得很痛，新的零件還留在背包裡。`, `${patient.name}又往深處滑了一點。`)
    result = 'botched'
  } else {
    const sink = great ? Math.max(0, q.sink_after - 1) : q.sink_after
    const now = nowOf(state) + q.minutes
    const next: CyberPiece = { ...plan.next!, sink }
    let quirkName: string | undefined
    if (complication) {
      const pool = complicationPool(k).filter((x) => !(next.quirks ?? []).includes(x.id))
      if (pool.length > 0) {
        const pick = deriveRng(state.rng, `${MODIFY_ACTION}/${q.uid}/quirk`).pick(pool)
        next.quirks = [...(next.quirks ?? []), pick.id]
        quirkName = pick.name
      }
    }
    const isBridgePiece = piece.slot === 'bridge'
    if (isBridgePiece && q.recovery_minutes > 0) next.ready_at = now + q.recovery_minutes
    const pieces = cyberOf(state, o.actor).map((p) => (p.uid === piece.uid ? next : p))
    const floor = floorWith(k, state, o.actor, sink - piece.sink)
    changes.push(takeChange(taken))
    if (oldRef !== undefined && oldPart) {
      if (oldPart.material === 'bio') lines.push(`${oldPart.name}是活的，拆下來就死了，報廢。`)
      else if (typeof oldRef !== 'string') {
        const s = partStack(oldRef)
        changes.push({ op: 'item', id: s.id, qty: s.qty, ...(s.data ? { data: s.data } : {}) })
      } else {
        changes.push({ op: 'item', id: oldRef, qty: 1, data: { state: 'used', uid: `${USED_PART_UID_PREFIX}${state.seq.uid + 1}` } }, { op: 'uid', advance: 1 })
      }
    }
    if (q.fee > 0) changes.push({ op: q.pay!, delta: -q.fee })
    changes.push({ op: 'time', minutes: q.minutes }, writePieces(state, o.actor, pieces))
    if (isBridgePiece && next.ready_at !== undefined) changes.push({ op: 'actor.condition', id: o.actor, condition: RECOVERING, until: Math.max(latestReady(pieces), next.ready_at) })
    if (patient.sink < floor) changes.push({ op: 'actor.track', id: o.actor, track: 'sink', delta: floor - patient.sink })
    lines.unshift(`${who}，把${newPart.name}換進了${PART_NAME[piece.slot]}的${q.name}${oldPart ? `，換下了${oldPart.name}` : ''}。`)
    if (great) lines.push('手術比想像中順利，神經幾乎沒有被驚動。')
    if (isBridgePiece && next.ready_at !== undefined) lines.push('橋的零件換過了，新的配置還要養一陣子。')
    if (complication) lines.push(quirkName ? `手術留下了併發症：${quirkName}。` : '手術不算乾淨，留下了一點後遺症。')
    if (piece.sink !== sink) lines.push(sink < piece.sink ? '這一件對神經的負擔輕了一些。' : '這一件對神經的負擔重了一些。')
    Object.assign(data, { sink, at: now, complication: quirkName ?? null, ...(next.ready_at !== undefined ? { ready_at: next.ready_at } : {}) })
    result = complication ? 'complication' : great ? 'great' : 'modified'
  }
  if (rolled) changes.push({ op: 'rng', advance: 1 })

  const beats: TimelineBeat[] = [{ layer: 'meat', actor: o.actor, text: lines[0]!, tag: MODIFY_ACTION, data }]
  if (roll) beats.push({ layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'cyber.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: o.actor, text, tag: 'cyber.note' })
  return {
    kind: 'action', action: MODIFY_ACTION, location: clone(state.location), actor: o.actor, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') }, narration: { results: lines },
  }
}
