// L6 unreg 等著交貨的清單：建一筆（預設文字同時抽好）、哪些可以交、給外殼組 AI 請求用的 frameView、AI 交來的文字怎麼驗、交貨。
// 規格：CRAFTING 11.1 節；AI_TASKS 3.20 節第 1、4、6 步；dev/adr/0019 第十七節與 P74；dev/work/M4-part-unreg.md。
// 交貨是明確的入口（deliverDraft）：外殼不在提交之後偷偷交。

import type { Change, GameState, InlinePart, Kernel, PartEntry, QuirkEntry, ReportDraft, ReportOutcome } from '../../core'
import { ActionBlocked, Rng, clone, hash32, inlinePartProblems, isRecord, partStack, toMinutes } from '../../core'
import type { FrameSpec } from './frame'
import { frameOf, frameProblems } from './frame'
import type { Frame, Pending, PresetEntry, PresetText, UnregRules } from './model'
import { DELIVER_ACTION, NAME_OP, PENDING_OP, PRESET_KIND, ROMAN, UID_PREFIX, typeName, unregOf, unregRules } from './model'

/** 加進等著交貨的清單的輸入：定框架要的，加上這一筆自己的標記。 */
export interface PendingSpec extends FrameSpec {
  hold?: 'order'
  ready_at?: number
  request?: string
  from?: string
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const DAY = 1440

/** 預設的文字：unreg_preset 裡類型相同、等級相同的優先，其次類型相同的（材質有寫的要對得上）；名字已經給過、或正在等著的略過；都沒有就是「無名的<類型>」。 */
export function presetText(k: Pick<Kernel, 'content'>, rules: UnregRules, frame: Frame, seq: number, taken: ReadonlySet<string>, seed: number): PresetText {
  const quirk = frame.quirk ? k.content.get<QuirkEntry>('quirk', frame.quirk.id) : undefined
  const all = k.content.hasKind(PRESET_KIND)
    ? k.content.list<PresetEntry>(PRESET_KIND).filter((e) => e.type === frame.type && (e.material === undefined || e.material === frame.material) && !taken.has(e.name)).sort(byId)
    : []
  const exact = all.filter((e) => e.grade === frame.grade)
  const pool = exact.length > 0 ? exact : all
  const rng = new Rng(hash32(seed, 'unreg/preset', seq))
  const quirkText = (e?: PresetEntry): string => (e?.quirk_text !== undefined && e.quirk_text !== '' ? e.quirk_text : quirk?.desc ?? '')
  if (pool.length > 0) {
    const e = rng.pick(pool)
    return { name: e.name, desc: e.desc, quirk_text: quirkText(e) }
  }
  const tn = typeName(rules, frame.type)
  return { name: `無名的${tn}${seq}`, desc: `一件沒有登記過的${tn}。`, quirk_text: quirkText() }
}

/** 變更 unreg.pending 的 add 套用時呼叫：流水號加 1，框架用 frameOf（種子是流水號），預設的文字同時抽好。回傳新的一筆（還沒寫進狀態）。 */
export function makePending(k: Pick<Kernel, 'content'>, state: GameState, spec: PendingSpec): Pending {
  const u = unregOf(state)
  const seq = u.seq + 1
  const rules = unregRules(k)
  const frame = frameOf(k, state, { ...spec, seq })
  const taken = new Set<string>([...u.names, ...u.pending.map((p) => p.preset.name)])
  return {
    id: `${UID_PREFIX}${seq}`, source: spec.source ?? 'gift', frame,
    preset: presetText(k, rules, frame, seq, taken, state.rng.seed),
    ...(spec.hold === 'order' ? { hold: 'order' as const } : {}), ...(typeof spec.ready_at === 'number' ? { ready_at: spec.ready_at } : {}),
    ...(typeof spec.request === 'string' && spec.request !== '' ? { request: spec.request } : {}), ...(typeof spec.from === 'string' && spec.from !== '' ? { from: spec.from } : {}),
    at: toMinutes(state.time),
  }
}

/** 全部等著交貨的（複本）。 */
export const pendingParts = (state: GameState): Pending[] => unregOf(state).pending

/** 可以交的：沒有 hold 的每一筆（訂做的 hold: 'order' 要在委託台取，下一張）。 */
export function readyParts(_k: Pick<Kernel, 'content'>, state: GameState): Pending[] {
  return unregOf(state).pending.filter((p) => p.hold === undefined)
}

/** 現在交不了的原因（一句）；能交是 null。 */
export function deliverBlock(k: Kernel, state: GameState, id: string): string | null {
  const act = k.activity.blockOf(state, `commit:${DELIVER_ACTION}`)
  if (act) return act
  const p = unregOf(state).pending.find((x) => x.id === id)
  if (!p) return '沒有這一件等著交貨的零件。'
  if (p.hold === 'order') {
    const now = toMinutes(state.time)
    if (p.ready_at !== undefined && now < p.ready_at) return `還要等 ${Math.ceil((p.ready_at - now) / DAY)} 天。`
  }
  return null
}

// ---- 給外殼組 AI 請求的資料 ----

export interface FrameView {
  id: string
  type: string
  typeName: string
  material: string
  materialName: string
  grade: number
  gradeName: string
  brand: string
  brandName: string
  attrs: Array<{ id: string; name: string; shares: number; put: 'stats' | 'affinity'; key: string; amount: number }>
  quirk: { id: string; name: string; desc: string } | null
  request?: string
  /** 同類同級的名字樣本（內容的零件與預設清單，照 id 排，最多 5 筆） */
  samples: string[]
}

const MATERIAL_NAME: Record<string, string> = { mech: '機械', bio: '生體' }

/** 一件等著交貨的零件，給外殼組 AI 請求用的樣子（不改狀態）。查不到是 null。 */
export function frameView(k: Pick<Kernel, 'content'>, state: GameState, id: string): FrameView | null {
  const p = unregOf(state).pending.find((x) => x.id === id)
  if (!p || !isRecord(p.frame)) return null
  const rules = unregRules(k)
  const f = p.frame
  const opts = rules.options[f.type] ?? []
  const attrs = (Array.isArray(f.attrs) ? f.attrs : []).flatMap((a) => {
    const o = opts.find((x) => x.id === a.option)
    return o ? [{ id: o.id, name: o.name, shares: a.shares, put: o.put, key: o.key, amount: o.amount * a.shares }] : []
  })
  const q = f.quirk ? k.content.get<QuirkEntry>('quirk', f.quirk.id) : undefined
  const brandEntry = k.content.hasKind('faction') ? k.content.get<{ id: string; name?: unknown }>('faction', f.brand) : undefined
  const names: Array<{ id: string; name: string }> = [
    ...k.content.list<PartEntry>('part').filter((e) => e.type === f.type && e.grade === f.grade).map((e) => ({ id: e.id, name: e.name })),
    ...(k.content.hasKind(PRESET_KIND) ? k.content.list<PresetEntry>(PRESET_KIND).filter((e) => e.type === f.type && e.grade === f.grade).map((e) => ({ id: e.id, name: e.name })) : []),
  ].sort(byId)
  return {
    id: p.id, type: f.type, typeName: typeName(rules, f.type), material: f.material, materialName: MATERIAL_NAME[f.material] ?? f.material,
    grade: f.grade, gradeName: ROMAN[f.grade] ?? String(f.grade), brand: f.brand,
    brandName: typeof brandEntry?.name === 'string' && brandEntry.name ? brandEntry.name : f.brand,
    attrs, quirk: q ? { id: q.id, name: q.name, desc: q.desc } : null,
    ...(p.request !== undefined ? { request: p.request } : {}),
    samples: [...new Set(names.map((n) => n.name))].slice(0, 5),
  }
}

// ---- 文字的驗證（AI 交來的三段） ----

export interface UnregText {
  name: string
  desc: string
  quirk: string
}

const TEXT_FIELDS = ['name', 'desc', 'quirk'] as const
const DIGIT = /[0-9０-９]/
const NAME_BAD = /[\s\p{P}\p{S}]/u

/**
 * AI 交來的三段文字 { name, desc, quirk } 驗得過嗎：每一段是字串、去掉頭尾空白之後字數在規則表 text 的範圍裡；名字沒有空白與標點；三段都不能有阿拉伯數字（半形、全形）；
 * 名字不和內容裡任何一個零件、給過的名字重複；多出來的欄位算一條問題。每條一句、帶欄位的名字（外殼重試時原樣帶回去）。這個零件沒有怪癖時 quirk 可以不寫。
 */
export function textProblems(k: Pick<Kernel, 'content'>, state: GameState, id: string, text: unknown): string[] {
  const u = unregOf(state)
  const pending = u.pending.find((p) => p.id === id)
  if (!pending) return ['沒有這一件等著交貨的零件。']
  if (!isRecord(text)) return ['text 要是 { name, desc, quirk } 三段文字。']
  const rules = unregRules(k)
  const p: string[] = []
  for (const key of Object.keys(text)) if (!(TEXT_FIELDS as readonly string[]).includes(key)) p.push(`${key}：多出來的欄位，只能寫 name、desc、quirk。`)
  const noQuirk = !pending.frame.quirk
  for (const f of TEXT_FIELDS) {
    const v = text[f]
    if (f === 'quirk' && noQuirk && (v === undefined || v === '')) continue
    if (typeof v !== 'string') {
      p.push(`${f}：要是文字。`)
      continue
    }
    const t = v.trim()
    const [min, max] = rules.text[f]
    if (t.length < min || t.length > max) p.push(`${f}：字數要在 ${min}～${max} 個字之間。`)
    if (DIGIT.test(t)) p.push(`${f}：不能有阿拉伯數字。`)
    if (f === 'name' && NAME_BAD.test(t)) p.push('name：不能有空白與標點符號。')
  }
  if (typeof text.name === 'string' && text.name.trim() !== '') {
    const n = text.name.trim()
    if (k.content.list<PartEntry>('part').some((e) => e.name === n) || u.names.includes(n)) p.push(`name：「${n}」已經有一件零件叫這個名字了。`)
  }
  return p
}

// ---- 交貨 ----

const attrLine = (a: FrameView['attrs'][number]): string => a.name

/**
 * 交貨：把等著的那一筆變成背包裡的一件內嵌零件。text 有給而 textProblems 不是空的就丟 ActionBlocked；沒給用預設的文字。
 * 再跑一次 frameProblems 與 inlinePartProblems，不是空的也丟。變更：背包多一疊（partStack）、等著的那一筆拿掉、名字記下。報告 unreg.deliver。
 */
export function deliverDraft(k: Kernel, state: GameState, o: { id: string; text?: unknown }): ReportDraft {
  const block = deliverBlock(k, state, o.id)
  if (block) throw new ActionBlocked(block)
  const pending = unregOf(state).pending.find((x) => x.id === o.id)!
  let text: UnregText
  if (o.text !== undefined) {
    const tp = textProblems(k, state, o.id, o.text)
    if (tp.length > 0) throw new ActionBlocked(tp.join(''))
    const raw = o.text as Record<string, unknown>
    text = { name: (raw.name as string).trim(), desc: (raw.desc as string).trim(), quirk: typeof raw.quirk === 'string' ? raw.quirk.trim() : '' }
  } else {
    text = { name: pending.preset.name, desc: pending.preset.desc, quirk: pending.preset.quirk_text }
  }
  const fp = frameProblems(k, pending.frame, pending.source)
  if (fp.length > 0) throw new ActionBlocked(fp.join(''))

  const rules = unregRules(k)
  const f = pending.frame
  const part: InlinePart = {
    unreg: true, uid: pending.id, name: text.name, desc: text.desc, type: f.type, material: f.material, brand: f.brand, grade: f.grade, price: f.price, legal: f.legal,
    cells: Math.ceil((rules.cells[f.grade] ?? 0) - 1e-9), stats: clone(f.stats), weight: f.weight, size: f.size, state: 'doujin',
    ...(Object.keys(f.affinity).length > 0 ? { affinity: clone(f.affinity) } : {}),
    ...(f.quirk ? { quirk: f.quirk.id, quirk_text: text.quirk } : {}),
    ...(pending.from !== undefined ? { from: pending.from } : {}),
  }
  const pp = inlinePartProblems(k.content, part)
  if (pp.length > 0) throw new ActionBlocked(pp.join(''))

  const stack = partStack(part)
  const changes: Change[] = [
    { op: 'item', id: stack.id, qty: stack.qty, data: clone(stack.data!) },
    { op: PENDING_OP, remove: pending.id },
    { op: NAME_OP, name: text.name },
  ]
  const view = frameView(k, state, pending.id)
  const quirk = view?.quirk
  const line = [
    `拿到了「${text.name}」：一件${f.material === 'bio' ? '生體' : '機械'}的${typeName(rules, f.type)}，${ROMAN[f.grade]} 級。`,
    view && view.attrs.length > 0 ? `屬性：${view.attrs.map(attrLine).join('、')}。` : '',
    quirk ? `怪癖：${quirk.name}，${text.quirk}` : '',
  ].join('')
  const outcome: ReportOutcome & { part: InlinePart } = { result: 'delivered', summary: line, part: clone(part) }
  return {
    kind: 'action', action: DELIVER_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: DELIVER_ACTION, data: { id: pending.id, uid: part.uid, source: pending.source, type: f.type, grade: f.grade } }],
    changes, outcome, narration: { results: [line] },
  }
}
