// L6 craft 的組裝預覽（CRAFTING 10.1 節：「這個畫面是組裝的核心——玩家在這裡來回換零件，看數字怎麼動」）。
// 預覽不改狀態、不擲骰：每個槽的問題、缺的必要槽、難度的每一項（P16）、做的人的加值與成功率、成品的等級與合法性、價錢、重量、stats 的合計；義體另外給沉溺成本。
// assembleDraft 用同一份 planAssembly 算出來的東西，所以畫面看到的和真正做出來的一致。
//
// parts 是「零件類型 → 背包裡的零件」：沒有實例資料的那一疊給零件的 id，有的給 uid；同一種要兩個（count）時給陣列。
// 背包裡的那一疊是哪個零件一律經核心的 stackPart／partOf 讀：帶 uid 的那一疊可能是內嵌的零件（未登錄零件，dev/adr/0019 第十七節），
// 放進成品的是 data.part 那一整筆，不是 id（M4-plan 規定 10）。

import type { ActorId, AttrId, BlueprintEntry, GameState, ItemStack, Kernel, PartEntry, PartNeed, PartRef, PartState, ProductData, ProductInfo, RollPart } from '../../core'
import { checkParts, clone, dcFor, formatAmount, isRecord, makeCheck, partOf, partTypeName, productOf, productPrice, setPartState, slotProblems, stackPart } from '../../core'
import type { CraftRules, MakerKind, MakerRule, Pool } from './model'
import { ASSEMBLE_ACTION, MAKER_KINDS, MAKER_NAME, craftHere, craftRules, inParty, isKnown, isMakerKind, selfPlaceBlock } from './model'

export interface PreviewOpts {
  /** 設計圖的 id */
  blueprint: string
  /** 零件類型 → 背包裡的零件（沒有實例資料的給零件的 id，有的給 uid；要兩個以上給陣列） */
  parts?: Record<string, string | string[]>
  /** 動手的人（只有自己動手看它；主角或隊上的人；預設主角） */
  by?: ActorId
  /** 誰來做（預設自己） */
  maker?: MakerKind
  /** 工錢從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
  /** 精工要加在哪一個數值（成品 stats 的鍵；CRAFTING 10.1 節「精工由做的人選」）。沒給照舊自動選 stats 合計最高的那一個；義體的精工是沉溺成本 −1，沒有可以選的 */
  polish?: string
}

/** 一個放進槽裡的零件。 */
export interface PickView {
  /** 玩家給的 id 或 uid */
  key: string
  /** 零件的 id（內嵌的是 unreg:<uid>） */
  id: string
  name: string
  grade: number
  brand: string
  material: string
  /** 是未登錄零件（內嵌在背包那一疊裡的） */
  unreg: boolean
  /** 放不進這個槽的原因（一條一句）；放得進是空的 */
  problems: string[]
  /** 放得進、但高設計圖一級（超規） */
  overspec: boolean
}

/** 設計圖的一個槽。 */
export interface SlotView {
  type: string
  name: string
  required: boolean
  /** 這個槽要（最多放）幾個 */
  count: number
  material: string
  grade_min?: number
  picked: PickView[]
  /** 必要的槽還缺幾個（選配的槽是 0） */
  missing: number
}

export interface DifficultyLine {
  id: 'grade' | 'brands' | 'seams' | 'overspec' | 'bridge' | 'offset'
  label: string
  value: number
}

/** 難度的每一項（P16）：等級的標準 DC、牌子數 −1、接面數、超規每件、橋 +3，再加難度偏移。 */
export interface Difficulty {
  base: number
  brands: number
  seams: number
  overspec: number
  bridge: number
  offset: number
  total: number
  lines: DifficultyLine[]
}

export interface Odds {
  critical: number
  success: number
  fail: number
  fumble: number
}

/** 自己動手的檢定：做的人的加值與成功率（對 1d20 逐面算，和 makeCheck 的門檻一致）。 */
export interface CheckPreview {
  by: ActorId
  attr: AttrId
  skill: string
  skillName: string
  /** 所有加值（屬性、基本功、被動效果、工坊） */
  parts: RollPart[]
  bonus: number
  dc: number
  /** 條件 ability（daily: 'workshop'）成立：檢定 +workshop_bonus、超規的修正減半 */
  workshop: boolean
  /** 每一種成功程度的機率（0～1，二十個骰面算出來的） */
  odds: Odds
  /** 大成功加成功的機率 */
  success: number
}

export interface ProductResult {
  grade: number
  legal: string
  /** 目錄價（照預期的品質：原廠是精工，其餘照規格） */
  price: number
  weight: number
  stats: Record<string, number>
  affinity: Record<string, number>
  brands: string[]
  /** 原廠全套：設計圖與每個零件同一個牌子 */
  fullSet: boolean
  seams: number
  allBio: boolean
  /** 超規的零件有幾個 */
  overspec: number
  /** 預期的品質：自己動手要看擲出來的（null） */
  quality: 'standard' | 'fine' | null
  /** 精工可以加在哪些數值（成品 stats 的鍵；義體沒有可以選的，是空的） */
  polishable: string[]
  /** 義體：設計圖的沉溺成本、零件與怪癖給的、合計 */
  sink?: { base: number; parts: number; total: number }
}

export interface AssemblyPreview {
  blueprint: { id: string; name: string; kind: string; grade: number; brand: string } | null
  maker: MakerKind
  by: ActorId
  slots: SlotView[]
  /** 缺的必要零件（零件類型的名字，一個一格） */
  missing: string[]
  difficulty: Difficulty | null
  /** 自己動手才有 */
  check: CheckPreview | null
  result: ProductResult | null
  /** 工錢與付哪一種錢；付不起是 pay: null */
  fee: number
  pay: Pool | null
  minutes: number
  /** 這個人做會不會登記（店家與原廠會） */
  registered: boolean
  /** 全部不能做的原因（一條一句）；能做是空陣列 */
  problems: string[]
  /** 第一條原因；能做是 null */
  block: string | null
}

/** 這裡有誰可以做（makers）的一項。 */
export interface MakerOption {
  id: MakerKind
  name: string
  rule: MakerRule
  /** 設施的牌子（原廠只做它的全套）；沒有是 undefined */
  brand?: string
  /** 現在選這一種做不了的原因；能選是 null */
  block: string | null
}

// ---- 這裡有誰可以做 ----

function makerBlock(k: Kernel, state: GameState, maker: MakerKind, by: ActorId, rules: CraftRules): string | null {
  if (maker === 'self') {
    if (!inParty(state, by)) return '動手的人要是主角或隊上的人。'
    return selfPlaceBlock(k, state, rules)
  }
  const here = craftHere(k, state)
  if (!here || here.by !== maker) return `這裡沒有${MAKER_NAME[maker]}。`
  return null
}

/**
 * 這裡有誰可以做：自己動手一直列（不在有工作台的地方時 block 寫原因）；站的設施帶 craft 的就列那一種（店家、同人社團、原廠）。
 * 動手的人只有自己動手看（預設主角）。
 */
export function makers(k: Kernel, state: GameState, by: ActorId | undefined = state.pc ?? undefined): MakerOption[] {
  const rules = craftRules(k)
  const out: MakerOption[] = [{ id: 'self', name: MAKER_NAME.self, rule: rules.makers.self, block: by === undefined ? '還沒有主角。' : makerBlock(k, state, 'self', by, rules) }]
  const here = craftHere(k, state)
  if (here) out.push({ id: here.by, name: MAKER_NAME[here.by], rule: rules.makers[here.by], ...(here.brand !== undefined ? { brand: here.brand } : {}), block: null })
  return out
}

// ---- 零件的引用 ----

/** 背包裡這一疊是哪個零件的引用：內嵌的零件（data.part）整筆，否則是內容的零件 id；不是零件是 undefined。 */
export function refOfStack(k: Pick<Kernel, 'content'>, stack: ItemStack): PartRef | undefined {
  const inline = stack.data?.part
  if (isRecord(inline) && partOf(k.content, inline)) return inline as unknown as PartRef
  return k.content.has('part', stack.id) ? stack.id : undefined
}

/** 一個放進槽裡、背包裡真的有的零件。 */
export interface Picked {
  type: string
  key: string
  stack: ItemStack
  /** 沒有實例資料的那一疊（扣的時候照 id，不指 uid） */
  plain: boolean
  ref: PartRef
  part: PartEntry
  /** 這一疊帶的狀態和零件自己的不一樣（拆下來的二手件）：放進成品時寫進 part_states。內嵌的零件自帶 state，沒有這一欄 */
  state?: PartState
  problems: string[]
  overspec: boolean
}

export const slotOf = (bp: BlueprintEntry, type: string): { need: PartNeed; required: boolean } | undefined => {
  const need = (bp.require ?? []).find((n) => n.type === type)
  if (need) return { need, required: true }
  const opt = (bp.optional ?? []).find((n) => n.type === type)
  return opt ? { need: opt, required: false } : undefined
}

/** 把玩家給的 parts 對到背包：每一個放得進哪個槽、問題與超規。背包裡找不到、不是零件、同一個放兩次的寫進 problems。 */
function resolvePicks(k: Kernel, state: GameState, bp: BlueprintEntry, parts: Record<string, string | string[]>): { picks: Picked[]; problems: string[] } {
  const picks: Picked[] = []
  const problems: string[] = []
  const plainUsed = new Map<string, number>()
  const uidUsed = new Set<string>()
  for (const [type, v] of Object.entries(parts)) {
    const keys = Array.isArray(v) ? v : [v]
    const slot = slotOf(bp, type)
    if (!slot) {
      problems.push(`這張設計圖沒有${partTypeName(type)}的槽。`)
      continue
    }
    const count = slot.need.count ?? 1
    if (keys.length > count) problems.push(`${partTypeName(type)}最多放 ${count} 個。`)
    for (const key of keys.slice(0, Math.max(count, 0))) {
      if (typeof key !== 'string' || key === '') {
        problems.push(`${partTypeName(type)}要寫背包裡零件的 id 或 uid。`)
        continue
      }
      const byUid = state.inventory.find((s) => s.data?.uid === key)
      let stack: ItemStack | undefined = byUid
      let plain = false
      if (byUid) {
        if (uidUsed.has(key)) {
          problems.push('同一個零件不能放兩次。')
          continue
        }
        uidUsed.add(key)
      } else {
        const total = state.inventory.reduce((n, s) => (s.id === key && !s.data ? n + s.qty : n), 0)
        const used = plainUsed.get(key) ?? 0
        if (total <= used) {
          problems.push(`背包裡沒有可以拿來組的${k.content.get<PartEntry>('part', key)?.name ?? key}。`)
          continue
        }
        plainUsed.set(key, used + 1)
        stack = state.inventory.find((s) => s.id === key && !s.data)
        plain = true
      }
      if (!stack) continue
      const ref = refOfStack(k, stack)
      // 背包這一疊是哪個零件經核心的 stackPart（二手件帶 data.state，回傳的零件狀態已經換成它；內嵌的整筆）
      const part = ref === undefined ? undefined : stackPart(k.content, stack)
      if (ref === undefined || !part) {
        problems.push(`背包裡的「${key}」不是能組裝的零件。`)
        continue
      }
      const sp = slotProblems(k.content, bp, type, ref)
      const own = typeof ref === 'string' ? partOf(k.content, ref) : undefined
      picks.push({ type, key, stack, plain, ref, part, ...(own && own.state !== part.state ? { state: part.state as PartState } : {}), problems: sp.problems, overspec: sp.overspec })
    }
  }
  return { picks, problems }
}

/** 把一組 picks 整理成成品資料的 parts（一個的給單一的引用，兩個以上給陣列）。內嵌的零件整筆複製。 */
export function partsRecord(picks: readonly Picked[]): Record<string, PartRef | PartRef[]> {
  const by = new Map<string, PartRef[]>()
  for (const p of picks) by.set(p.type, [...(by.get(p.type) ?? []), clone(p.ref)])
  return Object.fromEntries([...by].map(([type, refs]) => [type, refs.length === 1 ? refs[0]! : refs]))
}

/**
 * 一組 picks 的零件狀態（成品資料的 part_states；二手件放進成品時留下來，和 partsRecord 的順序一一對應）。沒有任何一個是二手的就是 undefined。
 */
export function partStatesRecord(picks: readonly Picked[]): ProductData['part_states'] | undefined {
  let states: ProductData['part_states'] | undefined
  const count = new Map<string, number>()
  for (const p of picks) {
    const i = count.get(p.type) ?? 0
    count.set(p.type, i + 1)
    if (p.state !== undefined) states = setPartState(states, p.type, i, p.state)
  }
  return states
}

export const missingText = (missing: string[]): string => {
  const n = new Map<string, number>()
  for (const t of missing) n.set(t, (n.get(t) ?? 0) + 1)
  return [...n].map(([t, c]) => (c > 1 ? `${t}×${c}` : t)).join('、')
}

/** 付一筆錢用哪一種：指定的就用指定的（不夠回 null）；沒指定先帳戶、不夠再現金。 */
export function payPool(money: GameState['money'], cost: number, want?: Pool): Pool | null {
  if (cost <= 0) return want ?? 'cred'
  return (want ? [want] : (['cred', 'cash'] as Pool[])).find((p) => money[p] >= cost) ?? null
}

/** 二十個骰面逐面算（用 makeCheck，和真正擲出來的門檻一致）。 */
export function oddsOf(parts: RollPart[], dc: number): Odds {
  const n: Record<string, number> = { critical: 0, success: 0, fail: 0, fumble: 0 }
  for (let face = 1; face <= 20; face++) n[makeCheck({ natural: face, parts, dc }).degree]!++
  return { critical: n.critical! / 20, success: n.success! / 20, fail: n.fail! / 20, fumble: n.fumble! / 20 }
}

/** 條件 ability（daily: 'workshop'）對這個人成立嗎（沒有人註冊這個條件就不成立）。 */
export function workshopOf(k: Kernel, state: GameState, by: ActorId): boolean {
  if (!k.conditions.kinds().includes('ability')) return false
  return k.conditions.test({ kind: 'ability', daily: 'workshop' }, { state, actor: by, stats: k.stats, timeRules: k.timeRules })
}

/** 組的是橋嗎（難度再加 bridge_step）。 */
export const isBridgeBp = (bp: Pick<BlueprintEntry, 'slot'>): boolean => bp.slot === 'bridge'

/** 檢定用哪一項基本功：全生體用醫療、義體用義體學、武器與護甲用機械。 */
export function skillFor(rules: CraftRules, bp: Pick<BlueprintEntry, 'kind'>, allBio: boolean): string {
  if (allBio) return rules.skills.bio
  return bp.kind === 'cyberware' ? rules.skills.cyberware : rules.skills.mech
}

/**
 * 難度的每一項（P16）：設計圖等級的標準 DC、牌子數 −1、接面數、超規每件（有工坊減半）、橋 +3，再加難度偏移。
 * 組裝與換零件共用這一個算法；info 是成品現在（或換完之後）的樣子，overspecN 是超規的零件有幾個。
 */
export function difficultyOf(rules: CraftRules, state: Pick<GameState, 'rules'>, bp: BlueprintEntry, info: ProductInfo | undefined, overspecN: number, workshop: boolean): Difficulty {
  const brands = info?.brands ?? [bp.brand]
  const base = rules.dc[Math.min(5, Math.max(1, bp.grade)) - 1] ?? rules.dc[0] ?? 10
  const brandPlus = Math.max(0, brands.length - 1) * rules.brand_step
  const seamPlus = (info?.seams ?? 0) * rules.seam_step
  const rawOver = overspecN * rules.overspec_step
  const overPlus = workshop ? Math.ceil(rawOver / 2) : rawOver
  const bridgePlus = isBridgeBp(bp) ? rules.bridge_step : 0
  const offset = state.rules.dcOffset
  const total = dcFor(base + brandPlus + seamPlus + overPlus + bridgePlus, state.rules)
  const lines: DifficultyLine[] = [{ id: 'grade', label: `設計圖等級的標準 DC`, value: base }]
  if (brandPlus !== 0) lines.push({ id: 'brands', label: `牌子（共 ${brands.length} 個，每多一個）`, value: brandPlus })
  if (seamPlus !== 0) lines.push({ id: 'seams', label: `機械接生體的接面（${info!.seams} 個）`, value: seamPlus })
  if (overPlus !== 0) lines.push({ id: 'overspec', label: `超規（${overspecN} 件${workshop ? '，工坊減半' : ''}）`, value: overPlus })
  if (bridgePlus !== 0) lines.push({ id: 'bridge', label: '組的是橋', value: bridgePlus })
  if (offset !== 0) lines.push({ id: 'offset', label: '難度偏移', value: offset })
  return { base, brands: brandPlus, seams: seamPlus, overspec: overPlus, bridge: bridgePlus, offset, total, lines }
}

// ---- 整份預覽 ----

/** assembleDraft 與預覽共用的計畫：預覽之外多帶背包裡真的要用的零件、成品資料與資訊。 */
export interface Plan {
  preview: AssemblyPreview
  bp?: BlueprintEntry
  rules: CraftRules
  maker: MakerKind
  by: ActorId
  /** 放得進槽的零件（有問題的不算） */
  picks: Picked[]
  /** 成品的資料（還沒有 uid、品質；零件整理過） */
  data?: ProductData
  info?: ProductInfo
  /** 玩家指定的精工項目（通過檢查的才有） */
  polish?: string
}

const emptyPreview = (maker: MakerKind, by: ActorId, minutes: number, problems: string[]): AssemblyPreview => ({
  blueprint: null, maker, by, slots: [], missing: [], difficulty: null, check: null, result: null, fee: 0, pay: null, minutes, registered: false, problems, block: problems[0] ?? null,
})

export function planAssembly(k: Kernel, state: GameState, o: PreviewOpts): Plan {
  const rules = craftRules(k)
  const by = o.by ?? state.pc ?? ''
  const maker: MakerKind = o.maker ?? 'self'
  const bad = (problems: string[]): Plan => ({ preview: emptyPreview(isMakerKind(maker) ? maker : 'self', by, rules.minutes, problems), rules, maker: isMakerKind(maker) ? maker : 'self', by, picks: [] })
  if (!isMakerKind(maker)) return bad([`要說是誰來做（${MAKER_KINDS.join('、')}）。`])
  const act = k.activity.blockOf(state, `commit:${ASSEMBLE_ACTION}`)
  const bp = k.content.get<BlueprintEntry>('blueprint', o.blueprint)
  if (!bp) return bad([...(act ? [act] : []), '找不到這張設計圖。'])
  const mr = rules.makers[maker]
  const problems: string[] = []
  if (act) problems.push(act)

  // 誰做、在哪裡做、會不會這張圖
  if (maker === 'self' && !state.actors[by]) problems.push('找不到動手的人。')
  else {
    const mb = makerBlock(k, state, maker, by, rules)
    if (mb) problems.push(mb)
  }
  if (mr.needs_known && !isKnown(state, bp.id)) problems.push(maker === 'doujin' ? `同人社團照著圖組，你自己要先會做${bp.name}。` : `你還沒學過${bp.name}的設計圖。`)

  // 零件
  const { picks: all, problems: pickProblems } = resolvePicks(k, state, bp, o.parts ?? {})
  problems.push(...pickProblems)
  const picks = all.filter((p) => p.problems.length === 0)
  for (const p of all) for (const m of p.problems) problems.push(`${p.part.name}：${m}`)

  // 槽的一覽
  const slots: SlotView[] = [...(bp.require ?? []).map((n) => ({ n, required: true })), ...(bp.optional ?? []).map((n) => ({ n, required: false }))].map(({ n, required }) => {
    const count = n.count ?? 1
    const picked = all.filter((p) => p.type === n.type)
    const have = picks.filter((p) => p.type === n.type).length
    return {
      type: n.type, name: partTypeName(n.type), required, count, material: n.material ?? 'any', ...(n.grade_min !== undefined ? { grade_min: n.grade_min } : {}),
      picked: picked.map((p): PickView => ({
        key: p.key, id: p.part.id, name: p.part.name, grade: p.part.grade, brand: p.part.brand, material: p.part.material, unreg: p.part.unreg === true, problems: p.problems, overspec: p.overspec,
      })),
      missing: required ? Math.max(0, count - have) : 0,
    }
  })
  const missing = slots.flatMap((s) => Array<string>(s.missing).fill(s.name))
  if (missing.length > 0) problems.push(`缺零件：${missingText(missing)}。`)

  // 成品合起來是什麼（一個零件都沒放時不看：productOf 會拿設計圖的原廠組合補上）
  const states = partStatesRecord(picks)
  const data: ProductData = { uid: '', parts: partsRecord(picks), ...(states ? { part_states: states } : {}) }
  const info = picks.length > 0 ? productOf(k.content, bp.id, data) : undefined
  const overspec = picks.filter((p) => p.overspec)
  const brands = info?.brands ?? [bp.brand]

  // 這個人肯不肯做
  if (!mr.overspec) for (const p of overspec) problems.push(`${p.part.name}比設計圖高了一級，${MAKER_NAME[maker]}不做超規。`)
  if (mr.full_set_only && info) {
    const facility = craftHere(k, state)
    if (brands.length > 1) problems.push(`${MAKER_NAME[maker]}只裝自家牌子的全套零件，混了別的牌子不收。`)
    else if (facility?.by === 'factory' && facility.brand !== undefined && brands[0] !== facility.brand) problems.push(`這間原廠只做 ${facility.brand} 的東西。`)
  }

  // 精工的項目（玩家選；沒選照舊自動選）
  const polishable = bp.kind === 'cyberware' || !info ? [] : Object.keys(info.stats)
  const canFine = mr.fine || mr.check
  if (o.polish !== undefined) {
    if (!canFine) problems.push(`${MAKER_NAME[maker]}做不出精工，不用指定精工的項目。`)
    else if (bp.kind === 'cyberware') problems.push('義體的精工是沉溺成本少一點，沒有別的項目可以選。')
    else if (info && !polishable.includes(o.polish)) problems.push(`精工要加在成品有的數值上，這一件沒有「${o.polish}」。`)
  }

  // 難度
  const workshop = maker === 'self' && state.actors[by] !== undefined && workshopOf(k, state, by)
  const difficulty = difficultyOf(rules, state, bp, info, overspec.length, workshop)
  const total = difficulty.total

  // 自己動手的檢定
  let check: CheckPreview | null = null
  if (mr.check && state.actors[by]) {
    const skill = skillFor(rules, bp, info?.allBio === true)
    const situation: RollPart[] = workshop ? [{ label: '工坊', value: rules.workshop_bonus, source: 'situation' }] : []
    const parts = checkParts(k.stats, state, by, { attr: rules.attr, skill, tags: ['craft', bp.kind] }, situation).filter((p) => p.value !== 0)
    // 這個人做的 DC 另外加減（同人社團暫定 −4：成功率高；M4-followups-2 第 4 項）
    const dc = total + mr.dc_mod
    const odds = oddsOf(parts, dc)
    check = { by, attr: rules.attr, skill, skillName: k.stats.skillName(skill), parts, bonus: parts.reduce((s, p) => s + p.value, 0), dc, workshop, odds, success: odds.critical + odds.success }
  }

  // 成品
  const quality = mr.fine ? 'fine' : mr.check ? null : 'standard'
  let result: ProductResult | null = null
  if (info) {
    const priceData = { ...data, quality: quality ?? ('standard' as const) }
    result = {
      grade: info.grade, legal: info.legal, price: productPrice(k.content, bp.id, priceData), weight: info.weight, stats: { ...info.stats }, affinity: { ...info.affinity },
      brands: [...brands], fullSet: brands.length === 1, seams: info.seams, allBio: info.allBio, overspec: overspec.length, quality, polishable,
      ...(bp.kind === 'cyberware' ? { sink: { base: bp.sink_cost ?? 0, parts: info.stats.sink ?? 0, total: (bp.sink_cost ?? 0) + (info.stats.sink ?? 0) } } : {}),
    }
  }

  // 工錢
  const fee = Math.round(bp.grade * mr.fee_per_grade)
  const pay = payPool(state.money, fee, o.pay)
  if (fee > 0 && pay === null) problems.push(`錢不夠：${MAKER_NAME[maker]}的工錢要 ${formatAmount(fee)}，${o.pay ? (o.pay === 'cred' ? '帳戶' : '現金') : '帳戶與現金'}付不起。`)

  const preview: AssemblyPreview = {
    blueprint: { id: bp.id, name: bp.name, kind: bp.kind, grade: bp.grade, brand: bp.brand },
    maker, by, slots, missing, difficulty, check, result, fee, pay, minutes: rules.minutes, registered: mr.registers, problems, block: problems[0] ?? null,
  }
  return { preview, bp, rules, maker, by, picks, data, ...(info ? { info } : {}), ...(o.polish !== undefined ? { polish: o.polish } : {}) }
}

/** 組裝的預覽：不改狀態、不擲骰。 */
export function assemblyPreview(k: Kernel, state: GameState, o: PreviewOpts): AssemblyPreview {
  return planAssembly(k, state, o).preview
}

