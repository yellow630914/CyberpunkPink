// L6 craft 的換零件（CRAFTING 10.3 節；TRADE 3.4 節；dev/adr/0019 第四節與 P16；dev/work/M4-craft-salvage.md）。
// 背包裡的一件成品換掉一個零件（或在空的選配槽裡裝一個）。身上的義體換零件是 cyberware 的小手術，不在這裡。
// 槽的檢查用核心的 slotProblems；難度照換完之後的那一件，算法和組裝是同一個函式（preview.ts 的 difficultyOf）。
//   自己動手（maker: 'self'）：在住處（二級以上）或帶 craft 的設施；擲一次組裝的檢定（義體用義體學、武器與護甲用機械、全生體用醫療）：
//     大成功與成功 照換；失敗 照換但多一筆瑕疵（quirk，pool 含 flaw、applies 對得上的）；大失敗 新的零件燒掉、舊的留在原位、成品沒變。
//   店家（maker: 'shop'）：站在帶 craft.by === 'shop' 的設施；一定成功、不做超規、收工錢（設計圖等級 × 店家的 fee_per_grade × swap_shop_ratio，暫定一半）。
// 換下來的零件回背包：內容的零件是 { state: 'used', uid } 的一疊，內嵌的零件整筆放回（M4-plan 規定 10）；生體的零件換下來就報廢（拆了就死）。
// 骰子一律 deriveRng（用途 craft.swap/<成品的 uid>）；擲過骰的報告多一筆 { op: 'rng', advance: 1 }。
// 已知的限制：二手零件放進成品時「二手」的狀態會丟（核心的 ProductData 沒有每個零件的狀態；M4-craft-salvage 回報）。

import type { ActorId, BlueprintEntry, Change, CheckRoll, GameState, ItemStack, Kernel, PartEntry, PartRef, ProductData, ProductInfo, ReportDraft, RollPart, TimelineBeat } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, clone, deriveRng, formatAmount, partOf, partTypeName, productOf, productPrice, rollCheck, slotProblems } from '../../core'
import type { CheckPreview, Difficulty } from './preview'
import { difficultyOf, oddsOf, payPool, refOfStack, skillFor, slotOf, workshopOf } from './preview'
import type { CraftRules, Pool } from './model'
import { MAKER_NAME, SWAP_ACTION, craftHere, craftRules, nameOf, workbenchHere } from './model'
import { USED_PART_UID_PREFIX, byBlock, byOf, dataOf, needsUid, partsByType, productStack, toPartsRecord, usedPartChange, wornUid } from './parts'
import { quirkPool } from './assemble'

/** 換零件找誰做：自己動手或店家（同人社團與原廠不做換零件）。 */
export type SwapMaker = 'self' | 'shop'

export interface SwapOpts {
  /** 背包裡那一件成品的 uid */
  uid: string
  /** 零件類型（槽） */
  type: string
  /** 換上去的零件：背包裡沒有實例資料的給零件的 id，有的（二手、未登錄）給 uid */
  part: string
  /** 動手的人（只有自己動手看它；主角或隊上的人；預設主角） */
  by?: ActorId
  /** 誰來做（預設自己） */
  maker?: SwapMaker
  /** 換掉這一類的第幾個（從 0 起；預設第一個；等於現有的個數就是在空的槽裡多裝一個） */
  index?: number
  /** 工錢從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

/** 一件成品現在（或換完之後）的樣子。 */
export interface SwapResult {
  grade: number
  legal: string
  price: number
  weight: number
  stats: Record<string, number>
  affinity: Record<string, number>
  brands: string[]
  seams: number
  allBio: boolean
  /** 超規的零件有幾個 */
  overspec: number
}

export interface SwapPreview {
  blueprint: { id: string; name: string; kind: string; grade: number } | null
  uid: string
  maker: SwapMaker
  by: ActorId
  type: string
  index: number
  /** 被換掉的零件（空的槽是 null） */
  old: { id: string; name: string; material: string; unreg: boolean } | null
  /** 換上去的零件 */
  next: { key: string; id: string; name: string; grade: number; material: string; unreg: boolean; overspec: boolean } | null
  /** 現在的樣子與換完之後的樣子 */
  before: SwapResult | null
  after: SwapResult | null
  difficulty: Difficulty | null
  /** 自己動手才有 */
  check: CheckPreview | null
  fee: number
  pay: Pool | null
  minutes: number
  /** 全部不能換的原因（一條一句）；能換是空陣列 */
  problems: string[]
  block: string | null
}

interface SwapPlan {
  preview: SwapPreview
  bp?: BlueprintEntry
  rules: CraftRules
  maker: SwapMaker
  by: ActorId
  stack?: ItemStack
  data?: ProductData
  /** 換完之後的成品資料（還沒加瑕疵） */
  next?: ProductData
  /** 背包裡換上去的那一疊 */
  taken?: ItemStack
  newRef?: PartRef
  newPart?: PartEntry
  oldRef?: PartRef
  oldPart?: PartEntry
  info?: ProductInfo
}

const isSwapMaker = (v: unknown): v is SwapMaker => v === 'self' || v === 'shop'

/** 背包裡找這個零件：帶 uid 的（二手、未登錄）指名 uid；沒有實例資料的那一疊給 id。 */
function findPartStack(state: GameState, key: string): ItemStack | undefined {
  return state.inventory.find((s) => s.data?.uid === key) ?? state.inventory.find((s) => s.id === key && !s.data && s.qty >= 1)
}

const resultOf = (k: Kernel, bp: BlueprintEntry, data: ProductData, info: ProductInfo, overspec: number): SwapResult => ({
  grade: info.grade, legal: info.legal, price: productPrice(k.content, bp.id, data), weight: info.weight, stats: { ...info.stats }, affinity: { ...info.affinity },
  brands: [...info.brands], seams: info.seams, allBio: info.allBio, overspec,
})

/** 這件成品裡超規的零件有幾個（每個零件對自己那一類的槽問 slotProblems）。 */
function overspecCount(k: Kernel, bp: BlueprintEntry, by: Record<string, PartRef[]>): number {
  let n = 0
  for (const [type, refs] of Object.entries(by)) for (const ref of refs) if (slotProblems(k.content, bp, type, ref).overspec) n++
  return n
}

function planSwap(k: Kernel, state: GameState, o: SwapOpts): SwapPlan {
  const rules = craftRules(k)
  const by = byOf(state, o.by)
  const maker: SwapMaker = isSwapMaker(o.maker) ? o.maker : 'self'
  const index = o.index ?? 0
  const problems: string[] = []
  const mk = (extra: Partial<SwapPreview> = {}): SwapPreview => ({
    blueprint: null, uid: o.uid, maker, by, type: o.type, index, old: null, next: null, before: null, after: null, difficulty: null, check: null,
    fee: 0, pay: null, minutes: rules.swap_minutes, problems, block: problems[0] ?? null, ...extra,
  })
  const act = k.activity.blockOf(state, `commit:${SWAP_ACTION}`)
  if (act) problems.push(act)
  if (o.maker !== undefined && !isSwapMaker(o.maker)) {
    problems.push('換零件只有自己動手或請店家。')
    return { preview: mk(), rules, maker, by }
  }
  const found = productStack(k, state, o.uid)
  if (!found) {
    problems.push('背包裡沒有這一件成品。')
    return { preview: mk(), rules, maker, by }
  }
  const { stack, bp } = found
  const data = dataOf(k, stack)

  // 誰做、在哪裡做
  if (maker === 'self') {
    if (!state.actors[by]) problems.push('找不到動手的人。')
    else {
      const b = byBlock(state, by)
      if (b) problems.push(b)
    }
    if (!workbenchHere(k, state, rules)) problems.push('換零件要在有工作台的住處（二級以上）或有工作台的店面。')
  } else if (craftHere(k, state)?.by !== 'shop') problems.push(`這裡沒有${MAKER_NAME.shop}。`)
  if (data.lock !== undefined) problems.push('有授權鎖的東西要先解鎖。')
  if (wornUid(state, o.uid)) problems.push('穿戴中的東西要先脫下來。')

  // 槽與被換掉的零件
  const slot = slotOf(bp, o.type)
  const have = partsByType(bp, data)
  const current = have[o.type] ?? []
  let oldRef: PartRef | undefined
  if (!slot) problems.push(`這張設計圖沒有${partTypeName(o.type)}的槽。`)
  else if (!Number.isInteger(index) || index < 0 || index > current.length || index >= (slot.need.count ?? 1)) problems.push(`${partTypeName(o.type)}的槽沒有第 ${index + 1} 個位置。`)
  else oldRef = current[index]
  const oldPart = oldRef === undefined ? undefined : partOf(k.content, oldRef)

  // 換上去的零件
  const taken = typeof o.part === 'string' && o.part !== '' ? findPartStack(state, o.part) : undefined
  let newRef: PartRef | undefined
  let newPart: PartEntry | undefined
  let overspec = false
  if (!taken) problems.push(`背包裡沒有可以拿來換的零件「${String(o.part)}」。`)
  else {
    newRef = refOfStack(k, taken)
    newPart = newRef === undefined ? undefined : partOf(k.content, newRef)
    if (newRef === undefined || !newPart) problems.push(`背包裡的「${o.part}」不是能組裝的零件。`)
    else if (slot) {
      const sp = slotProblems(k.content, bp, o.type, newRef)
      for (const m of sp.problems) problems.push(`${newPart.name}：${m}`)
      overspec = sp.overspec
    }
  }
  const oldView = oldPart ? { id: oldPart.id, name: oldPart.name, material: oldPart.material, unreg: oldPart.unreg === true } : null
  const nextView = taken && newPart ? { key: o.part, id: newPart.id, name: newPart.name, grade: newPart.grade, material: newPart.material, unreg: newPart.unreg === true, overspec } : null

  const infoNow = productOf(k.content, bp.id, data)
  const before = infoNow ? resultOf(k, bp, data, infoNow, overspecCount(k, bp, have)) : null
  if (!slot || newRef === undefined || !newPart || !infoNow) return { preview: mk({ blueprint: { id: bp.id, name: bp.name, kind: bp.kind, grade: bp.grade }, old: oldView, next: nextView, before }), bp, rules, maker, by, stack, data }

  // 換完之後的樣子
  const nextBy: Record<string, PartRef[]> = Object.fromEntries(Object.entries(have).map(([t, refs]) => [t, [...refs]]))
  const list = nextBy[o.type] ?? (nextBy[o.type] = [])
  list[index] = clone(newRef)
  const next: ProductData = { ...clone(data), parts: toPartsRecord(nextBy) }
  const info = productOf(k.content, bp.id, next)!
  const overN = overspecCount(k, bp, nextBy)
  const after = resultOf(k, bp, next, info, overN)

  const mr = rules.makers[maker]
  if (!mr.overspec && overspec) problems.push(`${newPart.name}比設計圖高了一級，${MAKER_NAME[maker]}不做超規。`)

  // 難度與檢定（自己動手）
  const workshop = maker === 'self' && state.actors[by] !== undefined && workshopOf(k, state, by)
  const difficulty = difficultyOf(rules, state, bp, info, overN, workshop)
  let check: CheckPreview | null = null
  if (mr.check && state.actors[by]) {
    const skill = skillFor(rules, bp, info.allBio)
    const situation: RollPart[] = workshop ? [{ label: '工坊', value: rules.workshop_bonus, source: 'situation' }] : []
    const parts = checkParts(k.stats, state, by, { attr: rules.attr, skill, tags: ['craft', bp.kind] }, situation).filter((p) => p.value !== 0)
    const odds = oddsOf(parts, difficulty.total)
    check = { by, attr: rules.attr, skill, skillName: k.stats.skillName(skill), parts, bonus: parts.reduce((s, p) => s + p.value, 0), dc: difficulty.total, workshop, odds, success: odds.critical + odds.success }
  }

  // 工錢（店家）
  const fee = maker === 'shop' ? Math.round(bp.grade * rules.makers.shop.fee_per_grade * rules.swap_shop_ratio) : 0
  const pay = payPool(state.money, fee, o.pay)
  if (fee > 0 && pay === null) problems.push(`錢不夠：${MAKER_NAME.shop}的工錢要 ${formatAmount(fee)}，${o.pay ? (o.pay === 'cred' ? '帳戶' : '現金') : '帳戶與現金'}付不起。`)

  const preview = mk({ blueprint: { id: bp.id, name: bp.name, kind: bp.kind, grade: bp.grade }, old: oldView, next: nextView, before, after, difficulty, check, fee, pay })
  return { preview, bp, rules, maker, by, stack, data, next, taken, newRef, newPart, ...(oldRef !== undefined ? { oldRef } : {}), ...(oldPart ? { oldPart } : {}), info }
}

/** 換零件的預覽：現在與換完之後的數字、難度與成功率、工錢；不改狀態、不擲骰。 */
export const swapPreview = (k: Kernel, state: GameState, o: SwapOpts): SwapPreview => planSwap(k, state, o).preview
/** 換零件現在行不行：全部的原因（一條一句）；行是空陣列。 */
export const swapProblems = (k: Kernel, state: GameState, o: SwapOpts): string[] => planSwap(k, state, o).preview.problems
/** 換零件現在行不行：第一條原因；行是 null。 */
export const swapBlock = (k: Kernel, state: GameState, o: SwapOpts): string | null => planSwap(k, state, o).preview.block

/** 把背包裡換上去（或燒掉）的那一疊拿走的變更。 */
const takeChange = (s: ItemStack): Change => (s.data?.uid !== undefined ? { op: 'item', id: s.id, qty: -1, data: { uid: s.data.uid } } : { op: 'item', id: s.id, qty: -1 })

/**
 * 換一個零件。不成立丟 ActionBlocked（swapProblems 的第一條）。
 * 報告 craft.swap：outcome.result 是 swapped（照換）、flawed（失敗：照換但多一筆瑕疵）、burned（大失敗：新零件燒掉、成品沒變）。
 */
export function swapDraft(k: Kernel, state: GameState, o: SwapOpts): ReportDraft {
  const plan = planSwap(k, state, o)
  const pv = plan.preview
  if (pv.problems.length > 0 || !plan.bp || !plan.stack || !plan.data || !plan.next || !plan.taken || !plan.newPart) throw new ActionBlocked(pv.problems[0] ?? '現在換不了。')
  const { bp, rules, maker, by, next, taken, newPart, oldRef, oldPart } = plan
  const mr = rules.makers[maker]
  const purpose = `${SWAP_ACTION}/${o.uid}`

  let roll: CheckRoll | undefined
  let degree: 'critical' | 'success' | 'fail' | 'fumble' = 'success'
  if (mr.check) {
    const c = pv.check!
    roll = rollCheck(k.stats, state, {
      actor: by, attr: c.attr, skill: c.skill, dc: c.dc, purpose, tags: ['craft', bp.kind],
      ...(c.workshop ? { situation: [{ label: '工坊', value: rules.workshop_bonus, source: 'situation' }] } : {}),
    })
    degree = roll.degree
  }

  const changes: Change[] = []
  const lines: string[] = []
  const who = mr.check ? nameOf(state, by) : MAKER_NAME[maker]
  const data: Record<string, unknown> = { uid: o.uid, bp: bp.id, maker, by, type: o.type, index: pv.index, degree, minutes: pv.minutes, new: newPart.id, ...(oldPart ? { old: oldPart.id } : {}) }
  let result: string

  if (degree === 'fumble') {
    // 新的零件燒掉；舊的留在原位，成品沒有變
    changes.push(takeChange(taken), { op: 'time', minutes: pv.minutes })
    lines.push(`${who}換${bp.name}的${partTypeName(o.type)}時失了手，${newPart.name}燒壞了，原來的零件還在原位。`)
    result = 'burned'
  } else {
    const product = clone(next)
    result = 'swapped'
    if (degree === 'fail') {
      const pool = quirkPool(k, 'flaw', bp.kind).filter((q) => !(product.quirks ?? []).includes(q.id))
      if (pool.length > 0) {
        const pick = deriveRng(state.rng, `${purpose}/flaw`).pick(pool)
        product.quirks = [...(product.quirks ?? []), pick.id]
        data.quirk = pick.name
      }
      result = 'flawed'
      lines.push(`${who}把${newPart.name}換上了${bp.name}，能用，不過有個地方沒有咬準。`)
      // 排異（CRAFTING 第 6 節）：義體換零件的檢定失敗，沉溺成本多一點
      if (bp.kind === 'cyberware' && rules.reject_sink > 0) {
        product.bonus = { ...(product.bonus ?? {}), sink: (product.bonus?.sink ?? 0) + rules.reject_sink }
        lines.push(`排異：這一件裝上之後身體不太接受，沉溺成本多 ${rules.reject_sink} 點。`)
      }
    } else lines.push(`${who}把${newPart.name}換上了${bp.name}${oldPart ? `，換下了${oldPart.name}` : ''}。`)
    // 成品換成新的資料（uid 不變）；換上去的零件拿掉；換下來的零件回背包
    changes.push({ op: 'item', id: bp.id, qty: -1, data: { uid: o.uid } }, takeChange(taken), { op: 'item', id: bp.id, qty: 1, data: product as unknown as Record<string, unknown> })
    if (oldRef !== undefined && oldPart) {
      const c = usedPartChange(oldRef, oldPart, `${USED_PART_UID_PREFIX}${state.seq.uid + 1}`)
      if (c) {
        changes.push(c)
        if (needsUid(oldRef, oldPart)) changes.push({ op: 'uid', advance: 1 })
      } else lines.push(`${oldPart.name}是活的，拆下來就死了，報廢。`)
    }
    changes.push({ op: 'time', minutes: pv.minutes })
  }
  if (pv.fee > 0 && pv.pay) changes.push({ op: pv.pay, delta: -pv.fee })
  if (roll) changes.push({ op: 'rng', advance: 1 })
  Object.assign(data, { fee: pv.fee })

  const beats: TimelineBeat[] = [{ layer: 'meat', actor: by, text: lines[0]!, tag: SWAP_ACTION, data }]
  if (roll) beats.push({ layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'craft.roll', data: { degree: roll.degree } })
  for (const text of lines.slice(1)) beats.push({ layer: 'meat', actor: by, text, tag: 'craft.note' })
  return {
    kind: 'action', action: SWAP_ACTION, location: clone(state.location), actor: by, party: [], timeline: beats, changes,
    outcome: { result, summary: lines.join('') },
    narration: { results: lines },
  }
}
