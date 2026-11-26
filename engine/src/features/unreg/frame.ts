// L6 unreg 的框架（CRAFTING 11.1 節「框架由引擎定」；dev/adr/0019 第十七節與 P66、P67、P75）。
// frameOf 是純函式：同一個 spec（含流水號 seq）與存檔的種子，每次得到同一份框架；亂數從（種子、流水號、用途）導出，不動存檔亂數的游標。
// frameProblems 是「驗證」那一列的引擎部分：交貨前再跑一次。

import type { AffinityKey, GameState, Kernel, QuirkEntry } from '../../core'
import { ActionBlocked, Rng, contentAllowed, hash32, isRecord, isSafeInt } from '../../core'
import type { Frame, Material, UnregOption, UnregRules } from './model'
import { GRADES, MATERIALS, MAX_GRADE, ROMAN, gradeCap, maxShares, typeName, unregRules } from './model'

/** 定框架要的輸入（效果 part_unreg 的參數照樣子整理過）。seq 是流水號（種子的一部分）。 */
export interface FrameSpec {
  source?: string
  type?: string
  material?: string
  grade?: number
  brand?: string
  want?: string[]
  quirk?: string
  seq?: number
}

const EPS = 1e-9
const eq = (a: number, b: number): boolean => Math.abs(a - b) < EPS
const le = (a: number, b: number): boolean => a <= b + EPS
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** 這個等級的份量（不認得的等級當 0）。 */
const cellsOf = (rules: UnregRules, grade: number): number => rules.cells[grade] ?? 0

/** 一筆怪癖退幾格：stats 裡有負的數字是 costly，其餘 plain。 */
export function refundOf(rules: UnregRules, quirk: Pick<QuirkEntry, 'stats'>): number {
  return Object.values(quirk.stats ?? {}).some((n) => typeof n === 'number' && n < 0) ? rules.refund.costly : rules.refund.plain
}

/** 這個類型抽得到的怪癖：kind 是 quirk、池含 doujin、tags 沒被篩選關掉、applies 沒寫或和這個類型的 kinds 有交集。照 id 排。 */
export function quirkCandidates(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules'>, rules: UnregRules, type: string): QuirkEntry[] {
  const kinds = rules.types[type]?.kinds
  return k.content.list<QuirkEntry>('quirk')
    .filter((q) => q.kind === 'quirk' && (q.pool ?? []).includes('doujin')
      && (q.tags ?? []).every((t) => contentAllowed(state.rules, t))
      && (!q.applies || !kinds || q.applies.some((a) => kinds.includes(a))))
    .sort(byId)
}

/** 這個類型、這一級、這個材質的選項（grade_min 與 material 對得上的）。 */
export function candidatesOf(rules: UnregRules, type: string, grade: number, material: Material): UnregOption[] {
  return (rules.options[type] ?? []).filter((o) => (o.grade_min === undefined || o.grade_min <= grade) && (o.material === undefined || o.material === material))
}

/** 這一份 spec 現在能不能定框架（類型、材質）。frameOf 與效果、變更的格式檢查共用；回傳原因（每條一句）。 */
export function specProblems(k: Pick<Kernel, 'content'>, spec: FrameSpec, rules: UnregRules = unregRules(k)): string[] {
  const p: string[] = []
  const types = Object.keys(rules.types)
  if (spec.type !== undefined) {
    if (typeof spec.type !== 'string' || !rules.types[spec.type]) p.push(`未登錄零件沒有「${String(spec.type)}」這一類。`)
  } else if (types.length === 0) p.push('沒有可以抽的零件類型。')
  if (spec.material !== undefined && !(MATERIALS as readonly unknown[]).includes(spec.material)) p.push('材質只有機械與生體兩種。')
  if (spec.material === 'bio' && typeof spec.type === 'string' && rules.types[spec.type]?.bio === false) p.push(`${typeName(rules, spec.type)}沒有生體版。`)
  // 生體沒指定類型：要至少有一個類型有生體版才抽得出來（B041）
  if (spec.material === 'bio' && spec.type === undefined && types.length > 0 && drawableTypes(rules, 'bio').length === 0) p.push('沒有哪一類零件有生體版，抽不出生體的零件。')
  return p
}

/** 沒指定類型時抽得到的類型（照 id 排）：生體只抽有生體版的（types.<id>.bio 不是 false）。 */
export function drawableTypes(rules: UnregRules, material: Material): string[] {
  return Object.keys(rules.types).filter((id) => material !== 'bio' || rules.types[id]!.bio !== false).sort()
}

/**
 * 定框架（純函式）。
 * 等級＝min(spec.grade ?? 上限, 來源的上限, IV)，最少 I；類型沒給就照種子抽（生體只抽有生體版的）；材質沒給是機械，沒有生體版的類型給了生體丟 ActionBlocked；牌子沒給是 doujin。
 * 怪癖從 quirkCandidates 抽一筆（spec.quirk 在範圍裡就用它）；預算＝份量＋退格；屬性照 want 的順序排前面、其餘照種子洗牌，
 * 第一輪每一項放一份、第二輪起從頭每一項再加一份（預算、條數、份數上限都夠才放），到一整輪都放不進為止，用不完的預算不補。
 */
export function frameOf(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rng' | 'rules'>, spec: FrameSpec): Frame {
  const rules = unregRules(k)
  const problems = specProblems(k, spec, rules)
  if (problems.length > 0) throw new ActionBlocked(problems[0]!)
  const seed = state.rng.seed
  const seq = spec.seq ?? 0
  const stream = (purpose: string): Rng => new Rng(hash32(seed, `unreg/${purpose}`, seq))

  const grade = Math.max(1, Math.min(Math.floor(typeof spec.grade === 'number' && Number.isFinite(spec.grade) ? spec.grade : MAX_GRADE), gradeCap(rules, spec.source), MAX_GRADE))
  const material: Material = spec.material === 'bio' ? 'bio' : 'mech'
  const type = spec.type ?? stream('type').pick(drawableTypes(rules, material))
  const brand = typeof spec.brand === 'string' && spec.brand ? spec.brand : 'doujin'

  const pool = quirkCandidates(k, state, rules, type)
  const chosen = spec.quirk !== undefined ? pool.find((q) => q.id === spec.quirk) : undefined
  const quirk = chosen ?? (pool.length > 0 ? stream('quirk').pick(pool) : undefined)
  const refund = quirk ? refundOf(rules, quirk) : 0
  const budget = cellsOf(rules, grade) + refund

  // 候選：want 指到的（id 或 tags）照 want 的順序排前面，其餘照種子洗牌
  const cand = candidatesOf(rules, type, grade, material)
  const front: UnregOption[] = []
  for (const w of spec.want ?? []) for (const o of cand) if ((o.id === w || (o.tags ?? []).includes(w)) && !front.includes(o)) front.push(o)
  const rest = cand.filter((o) => !front.includes(o))
  const shuffle = stream('attrs')
  for (let i = rest.length - 1; i > 0; i--) {
    const j = shuffle.int(0, i)
    ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
  }
  const order = [...front, ...rest]

  const shares = new Map<string, number>()
  const placed: string[] = []
  const lineLimit = rules.lines[grade] ?? 0
  let used = 0
  for (let progress = true; progress;) {
    progress = false
    for (const o of order) {
      const have = shares.get(o.id) ?? 0
      if (have >= maxShares(o, grade) || !le(used + o.cost, budget)) continue
      if (have === 0 && placed.length >= lineLimit) continue
      if (have === 0) placed.push(o.id)
      shares.set(o.id, have + 1)
      used += o.cost
      progress = true
    }
  }

  const attrs = placed.map((id) => ({ option: id, shares: shares.get(id)! }))
  const { stats, affinity } = numbersOf(cand, attrs)
  return {
    type, material, grade, brand, attrs, stats, affinity,
    quirk: quirk ? { id: quirk.id, refund } : null,
    budget, used, price: rules.price[grade] ?? 0, legal: rules.legal[grade] ?? 'free', weight: rules.shape.weight, size: rules.shape.size,
  }
}

/** 屬性換成 stats 與 affinity（amount × 份數相加）。 */
function numbersOf(options: readonly UnregOption[], attrs: ReadonlyArray<{ option: string; shares: number }>): { stats: Record<string, number>; affinity: Partial<Record<AffinityKey, number>> } {
  const stats: Record<string, number> = {}
  const affinity: Partial<Record<AffinityKey, number>> = {}
  for (const a of attrs) {
    const o = options.find((x) => x.id === a.option)
    if (!o) continue
    if (o.put === 'stats') stats[o.key] = (stats[o.key] ?? 0) + o.amount * a.shares
    else affinity[o.key as AffinityKey] = (affinity[o.key as AffinityKey] ?? 0) + o.amount * a.shares
  }
  return { stats, affinity }
}

const sameRecord = (a: unknown, b: Record<string, number>): boolean => {
  if (!isRecord(a)) return false
  const ka = Object.keys(a).filter((x) => a[x] !== 0)
  const kb = Object.keys(b).filter((x) => b[x] !== 0)
  return ka.length === kb.length && kb.every((x) => typeof a[x] === 'number' && eq(a[x] as number, b[x]!))
}

/**
 * 驗證框架（CRAFTING 11.1 節「驗證」那一列的引擎部分）：類型在表裡、材質對得上、等級 I～IV 而且不超過來源的上限（有給 source 才查）、
 * 每一條屬性都是這個類型的選項而且份數不超過上限、條數不超過 lines、used 不超過 budget、budget 等於份量加退格、怪癖查得到而且退格對、數字和屬性對得上。
 * 每條一句；空的就是合格。不丟錯，壞掉的輸入也只是多幾條問題。
 */
export function frameProblems(k: Pick<Kernel, 'content'>, frame: unknown, source?: string): string[] {
  if (!isRecord(frame)) return ['零件的框架壞掉了。']
  const rules = unregRules(k)
  const p: string[] = []
  const t = typeof frame.type === 'string' ? rules.types[frame.type] : undefined
  if (!t) p.push(`零件的類型「${String(frame.type)}」不是未登錄零件能出的。`)
  if (!(MATERIALS as readonly unknown[]).includes(frame.material)) p.push('零件的材質只有機械與生體兩種。')
  else if (frame.material === 'bio' && t?.bio === false) p.push(`${typeName(rules, String(frame.type))}沒有生體版。`)
  const grade = frame.grade
  const gradeOk = isSafeInt(grade) && (GRADES as readonly number[]).includes(grade)
  if (!gradeOk) p.push(`零件的等級要是 I～${ROMAN[MAX_GRADE]}，未登錄零件沒有 V 級。`)
  else if (source !== undefined) {
    if (!(source in rules.sources)) p.push(`來源「${source}」不認得。`)
    else if (grade > gradeCap(rules, source)) p.push(`這個來源最高只給 ${ROMAN[gradeCap(rules, source)]} 級。`)
  }

  // 屬性
  const options = t && gradeOk && typeof frame.type === 'string' && (frame.material === 'mech' || frame.material === 'bio') ? candidatesOf(rules, frame.type, grade as number, frame.material) : []
  const attrs = Array.isArray(frame.attrs) ? frame.attrs : null
  if (!attrs) p.push('零件的屬性壞掉了。')
  let used = 0
  const seen = new Set<string>()
  const good: Array<{ option: string; shares: number }> = []
  for (const a of attrs ?? []) {
    if (!isRecord(a) || typeof a.option !== 'string' || !isSafeInt(a.shares) || a.shares < 1) {
      p.push('有一條屬性的寫法壞掉了。')
      continue
    }
    const o = options.find((x) => x.id === a.option)
    if (!o) {
      p.push(`「${a.option}」不是這種零件能帶的屬性。`)
      continue
    }
    if (seen.has(o.id)) p.push(`「${o.name}」重複了。`)
    seen.add(o.id)
    if (gradeOk && a.shares > maxShares(o, grade as number)) p.push(`「${o.name}」最多只能放 ${maxShares(o, grade as number)} 份。`)
    used += o.cost * a.shares
    good.push({ option: a.option, shares: a.shares })
  }
  if (gradeOk && seen.size > (rules.lines[grade as number] ?? 0)) p.push(`${ROMAN[grade as number]} 級最多只能帶 ${rules.lines[grade as number] ?? 0} 條屬性。`)

  // 怪癖與預算
  let refund = 0
  if (frame.quirk !== null && frame.quirk !== undefined) {
    const q = isRecord(frame.quirk) && typeof frame.quirk.id === 'string' ? k.content.get<QuirkEntry>('quirk', frame.quirk.id) : undefined
    if (!q || q.kind !== 'quirk') p.push('零件帶的怪癖查不到。')
    else {
      refund = refundOf(rules, q)
      if (!isRecord(frame.quirk) || typeof frame.quirk.refund !== 'number' || !eq(frame.quirk.refund, refund)) p.push('怪癖退的格數不對。')
    }
  }
  if (gradeOk) {
    const budget = cellsOf(rules, grade as number) + refund
    if (typeof frame.budget !== 'number' || !eq(frame.budget, budget)) p.push('零件的預算不等於份量加怪癖退的格。')
    if (!le(used, budget)) p.push('屬性用掉的格數超過預算了。')
    if (typeof frame.used !== 'number' || !eq(frame.used, used)) p.push('屬性用掉的格數和屬性對不上。')
  }

  // 數字要和屬性對得上（不能自己改數字）
  if (p.length === 0) {
    const n = numbersOf(options, good)
    if (!sameRecord(frame.stats, n.stats)) p.push('零件的數值和屬性對不上。')
    if (!sameRecord(frame.affinity, n.affinity as Record<string, number>)) p.push('零件的親和和屬性對不上。')
  }
  return [...new Set(p)]
}

