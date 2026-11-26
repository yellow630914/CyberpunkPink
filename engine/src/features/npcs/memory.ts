// L6 功能 npcs：共同記憶（NPC_SYSTEM 第 8 節；dev/work/M2-npc-life.md）。程式照規則記、檢索與合併，不經過 AI。
//
// 記：每一份報告提交前（report.before 掛鉤）照 8.1 節那張表決定記不記與重要程度，記成這份報告最後一筆變更（npcs.memory.add），
//     所以不多出一份報告，時間用套用時的（也就是這份報告做完之後的）。被收回的報告（retracted）不另外記；回到快照時記憶留著（rewind.keep）。
//     事件自己用 memory 效果指定的照指定，不再另外自動記一筆。
// 檢索：recall（8.2 節的分數）。合併：超過 limit 筆時照 8.3 節（先同一天、再十天；最近 50 筆、重要以上、釘選的不動），在加入的那一刻做。
// 玩家的操作（手動加、改寫與調星等、釘選、刪除）是報告 npc.memory。

import type { Change, Effect, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, isRecord, isSafeInt, isValidTime, toMinutes } from '../../core'
import type { MemoryRules } from './lifeRules'
import { lifeRules } from './lifeRules'
import type { Memory, MemoryWhere } from './model'
import { AFFINITY, OWNER, affinityStage, ensureNpcs, knows, npcOf, readNpcs } from './model'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const WEIGHTS = [1, 2, 3] as const
const isWeight = (v: unknown): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3
const matches = (action: string | undefined, list: string[]): boolean => action !== undefined && list.some((a) => action === a || action.startsWith(`${a}.`))

/** 報告的行動是記憶自己或 NPC 日子的：不記（免得自己記自己）。 */
const SKIP_PREFIX = ['npc.memory', 'npc.life']

// ---- 唯讀 ----

/** 現在的共同記憶（照記下的順序；複製）。 */
export const memoriesOf = (state: Pick<GameState, 'ext'>): Memory[] => clone(readNpcs(state).memories ?? [])

const DAY = 1440

export interface RecallOpts {
  /** 這一次談到誰（一個或幾個人的 id）：共同參與人的數量加分 */
  who?: string | string[]
  /** 現在在哪：同一個地點加分。寫了的欄位都要一樣（至少寫一個） */
  where?: MemoryWhere
  /** 最多幾筆（預設 6，8.2 節） */
  limit?: number
}

const WHERE_KEYS = ['district', 'block', 'facility', 'subnet'] as const
function samePlace(q: MemoryWhere | undefined, m: MemoryWhere): boolean {
  if (!q) return false
  const keys = WHERE_KEYS.filter((f) => q[f] !== undefined)
  return keys.length > 0 && keys.every((f) => q[f] === m[f])
}

/**
 * 檢索（NPC_SYSTEM 8.2 節）：分數 = 10（釘選）＋ 3 × 共同參與人數 ＋ 2（同一地點）＋ 重要程度 ＋ 時間接近（3 天內 1.5、10 天內 0.75）；
 * 取前 limit 筆（預設 6），照時間排序。分數一樣新的先取。時間接近從現在（state.time）算；正在寫的那份報告還沒有記下來，所以不會算進去。
 */
export function recall(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'ext' | 'time'>, opts: RecallOpts = {}): Memory[] {
  const rules = lifeRules(k).memory
  const limit = opts.limit ?? rules.recall
  const list = readNpcs(state).memories ?? []
  const who = new Set(opts.who === undefined ? [] : Array.isArray(opts.who) ? opts.who : [opts.who])
  const now = toMinutes(state.time)
  const scored = list.map((m, i) => {
    const age = (now - toMinutes(m.at)) / DAY
    const score = (m.pinned ? rules.score.pinned : 0) + rules.score.shared * m.who.filter((id) => who.has(id)).length
      + (samePlace(opts.where, m.where) ? rules.score.place : 0) + m.weight + (age <= 3 ? rules.score.within3 : age <= 10 ? rules.score.within10 : 0)
    return { m, i, score }
  })
  scored.sort((a, b) => b.score - a.score || b.i - a.i)
  return clone(scored.slice(0, Math.max(0, limit)).sort((a, b) => toMinutes(a.m.at) - toMinutes(b.m.at) || a.i - b.i).map((x) => x.m))
}

// ---- 合併（8.3 節） ----

/**
 * 超過 limit 筆時合併：先把舊的日常記憶（重要程度 1、沒釘選）依同一天合併，還太多就依 bucket_days 天合併；
 * 最近 recent 筆、重要程度 2 以上、釘選的不動。合併出來的一筆標 merged（合併了幾筆），參與人取聯集。回傳新的清單（不改傳進來的）。
 */
export function compactMemories(list: Memory[], rules: MemoryRules, newId: () => string): Memory[] {
  if (list.length <= rules.limit) return list
  const dayOf = (m: Memory): number => Math.floor(toMinutes(m.at) / DAY)
  const pass = (items: Memory[], key: (m: Memory) => number): Memory[] => {
    const recentFrom = items.length - rules.recent
    const groups = new Map<number, number[]>()
    items.forEach((m, i) => {
      if (i >= recentFrom || m.weight > 1 || m.pinned) return
      const g = key(m)
      groups.set(g, [...(groups.get(g) ?? []), i])
    })
    const replaceAt = new Map<number, Memory>()
    const drop = new Set<number>()
    for (const idx of groups.values()) {
      if (idx.length < 2) continue
      const members = idx.map((i) => items[i]!)
      const count = members.reduce((n, m) => n + (m.merged ?? 1), 0)
      const last = members.reduce((a, b) => (toMinutes(b.at) >= toMinutes(a.at) ? b : a))
      const districts = new Set(members.map((m) => m.where.district))
      const merged: Memory = {
        id: newId(), at: clone(last.at), where: districts.size === 1 && members[0]!.where.district !== undefined ? { district: members[0]!.where.district } : {},
        who: [...new Set(members.flatMap((m) => m.who))].sort(), text: `合併 ${count} 筆：${members[0]!.text}等`, weight: 1, merged: count,
      }
      for (const i of idx) drop.add(i)
      replaceAt.set(idx[idx.length - 1]!, merged)
    }
    if (drop.size === 0) return items
    return items.flatMap((m, i) => (replaceAt.has(i) ? [replaceAt.get(i)!] : drop.has(i) ? [] : [m]))
  }
  let out = pass(list, dayOf)
  if (out.length > rules.limit) out = pass(out, (m) => Math.floor(dayOf(m) / rules.bucket_days))
  return out
}

// ---- 記什麼 ----

/** 這份報告的地點，寫成記憶的地點（在內海時另記子網與層）。 */
export function whereOf(loc: { district?: string; block?: string; facility?: string; subnet?: { id: string; layer: number } }): MemoryWhere {
  return {
    ...(loc.district !== undefined ? { district: loc.district } : {}), ...(loc.block !== undefined ? { block: loc.block } : {}), ...(loc.facility !== undefined ? { facility: loc.facility } : {}),
    ...(loc.subnet ? { layer: 'net' as const, subnet: loc.subnet.id, depth: loc.subnet.layer } : {}),
  }
}

/** 這份報告碰到的人：隊上的人、報告裡出現而且已經有關係條目的人（含這份報告才認識的）、親密度有變的人。不含主角。 */
export function participantsOf(state: GameState, draft: ReportDraft): string[] {
  const seen = new Set<string>()
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v) seen.add(v)
  }
  const appear = new Set<string>()
  const see = (v: unknown): void => {
    if (typeof v === 'string' && v) appear.add(v)
  }
  see(draft.actor)
  see(draft.args?.target)
  for (const b of draft.timeline) {
    see(b.actor)
    if (b.data) {
      for (const f of ['target', 'by', 'who', 'with', 'npc']) see(b.data[f])
      if (isRecord(b.data.cast)) Object.values(b.data.cast).forEach(see)
    }
  }
  for (const c of draft.changes) if (c.op === 'npcs.meet') see(c.npc)
  for (const id of state.party) add(id)
  for (const p of draft.party) add(p.id)
  for (const id of appear) if (knows(state, id) || draft.changes.some((c) => c.op === 'npcs.meet' && c.npc === id)) add(id)
  for (const id of affinityChanged(state, draft)) add(id)
  if (state.pc) seen.delete(state.pc)
  return [...seen].sort()
}

/** 這份報告裡親密度有變的人（變更是 meter 的 affinity）。 */
function affinityChanged(state: GameState, draft: ReportDraft): string[] {
  const out = new Set<string>()
  for (const c of draft.changes) {
    if (c.op !== 'meter' || c.kind !== AFFINITY || typeof c.key !== 'string') continue
    const was = state.meters?.[AFFINITY]?.[c.key] ?? 0
    const delta = typeof c.set === 'number' ? c.set - was : typeof c.delta === 'number' ? c.delta : 0
    if (delta !== 0) out.add(c.key)
  }
  return [...out]
}

/** 親密度的階段在這份報告裡變了（招募、關係階段改變記 2）。 */
function stageChanged(state: GameState, draft: ReportDraft): boolean {
  const now = new Map<string, number>()
  for (const c of draft.changes) {
    if (c.op !== 'meter' || c.kind !== AFFINITY || typeof c.key !== 'string') continue
    const was = now.get(c.key) ?? state.meters?.[AFFINITY]?.[c.key] ?? 0
    const next = typeof c.set === 'number' ? c.set : typeof c.delta === 'number' ? was + c.delta : was
    now.set(c.key, Math.max(-100, Math.min(100, next)))
  }
  for (const [id, v] of now) if (affinityStage(state.meters?.[AFFINITY]?.[id] ?? 0).index !== affinityStage(v).index) return true
  return false
}

const RESULTS_NOT_FINAL = ['step']

/**
 * 8.1 節那張表：這份報告記不記、重要程度幾（0 是不記）。
 * gig 接案、收尾 2（倒下、背刺 3）；combat 結束 1（戰敗、有人倒下 2）；netrun 1（被扣線、流竄 AI 2）；social 1（招募、離隊、關係階段改變 2）；
 * action 有檢定才記 1（大成功、大失敗 2）；event 的結果 2（通知 1）；broadcast 有認識的人才記 2；deal 談判才記 1；downtime 夥伴變動、帳單出事 2。
 */
export function importanceOf(k: Pick<Kernel, 'content'>, state: GameState, draft: ReportDraft, participants: string[]): 0 | 1 | 2 | 3 {
  const rules = lifeRules(k).memory
  const action = draft.action
  const result = draft.outcome.result
  const tags = draft.timeline.map((b) => b.tag).filter((t): t is string => typeof t === 'string')
  switch (draft.kind) {
    case 'gig':
      if (!matches(action, rules.gig_actions)) return 0
      return tags.some((t) => rules.gig_bad_tags.includes(t)) ? 3 : 2
    case 'combat':
      if (RESULTS_NOT_FINAL.includes(result) || action === 'battle.start') return 0
      return result === 'lose' || draft.timeline.some((b) => b.tag === 'down' && b.data?.side === 'ally') ? 2 : 1
    case 'netrun':
      return rules.netrun_bad.includes(result) || tags.some((t) => rules.netrun_bad.includes(t)) ? 2 : 1
    case 'social':
      return matches(action, rules.social_up) || draft.changes.some((c) => c.op === 'roster.join' || c.op === 'roster.leave') || stageChanged(state, draft) ? 2 : 1
    case 'action': {
      const rolls = draft.timeline.filter((b) => b.roll)
      if (rolls.length === 0) return 0
      return rolls.some((b) => b.roll!.degree === 'critical' || b.roll!.degree === 'fumble') ? 2 : 1
    }
    case 'event':
      if (action === 'event.open' || action === 'event.choose') return 0
      return action === 'event.notice' ? 1 : 2
    case 'broadcast':
      return participants.some((id) => !state.party.includes(id)) ? 2 : 0
    case 'deal':
      return matches(action, rules.deal_actions) ? 1 : 0
    case 'downtime':
      return matches(action, rules.downtime_actions) || (action !== undefined && action.startsWith(rules.bill_prefix) && rules.bill_bad.includes(result)) ? 2 : 0
    default:
      return 0
  }
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** 簡述：報告的摘要（沒有就用第一拍的字、再沒有就是行動的名字）。 */
function summaryOf(draft: ReportDraft, max: number): string {
  const text = (draft.outcome.summary || draft.timeline.find((b) => b.text)?.text || draft.action || '').trim()
  return clip(text || '（沒有紀錄）', max)
}

/** 這份報告要加上去的記憶變更（沒有就是空的）。 */
export function memoryChanges(k: Kernel, state: GameState, draft: ReportDraft): Change[] {
  if (draft.retracted === true) return []
  // 記憶被抹掉的（outcome.amnesia：人偶晶片那一班、amnesia 的場景）：共同記憶不記（M4-followups-2 第 7 項）
  if (draft.outcome.amnesia === true) return []
  if (draft.action !== undefined && SKIP_PREFIX.some((p) => draft.action === p || draft.action!.startsWith(`${p}.`))) return []
  // 事件自己用 memory 效果指定的照指定
  if (draft.changes.some((c) => c.op === 'npcs.memory.add')) return []
  const who = participantsOf(state, draft)
  const weight = importanceOf(k, state, draft, who)
  if (weight === 0) return []
  const rules = lifeRules(k).memory
  // broadcast 記在那個人身上：只留隊外認識的人
  const people = draft.kind === 'broadcast' ? who.filter((id) => !state.party.includes(id)) : who
  return [{ op: 'npcs.memory.add', where: whereOf(draft.location), who: people, text: summaryOf(draft, rules.text_max), weight }]
}

// ---- 玩家的操作（報告 npc.memory） ----

const memoryDraft = (state: GameState, text: string, changes: Change[], result: string): ReportDraft => ({
  kind: 'social', action: 'npc.memory', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
  timeline: [{ layer: 'meat', text, tag: 'npc.memory' }], changes, outcome: { result, summary: text },
})

export interface RememberInput {
  text: string
  weight?: 1 | 2 | 3
  who?: string[]
  where?: MemoryWhere
  pinned?: boolean
}

function needMemory(state: GameState, id: string): Memory {
  const m = (readNpcs(state).memories ?? []).find((x) => x.id === id)
  if (!m) throw new ActionBlocked('找不到這一筆記憶。')
  return m
}

/** 手動加一筆記憶（地點預設是現在這裡、時間是現在）。文字是空的、星等不是 1～3 丟 ActionBlocked。 */
export function remember(k: Kernel, state: GameState, input: RememberInput): ReportDraft {
  const rules = lifeRules(k).memory
  if (!isText(input.text)) throw new ActionBlocked('要寫下這筆記憶的內容。')
  if (input.weight !== undefined && !isWeight(input.weight)) throw new ActionBlocked('重要程度只有 1（日常）、2（重要）、3（難忘）。')
  const text = clip(input.text.trim(), rules.text_max)
  const change: Change = {
    op: 'npcs.memory.add', where: input.where ?? whereOf(state.location), who: [...new Set(input.who ?? [])].sort(), text, weight: input.weight ?? 2,
    ...(input.pinned ? { pinned: true } : {}),
  }
  return memoryDraft(state, `記下了：${text}`, [change], 'added')
}

export interface MemoryPatch {
  text?: string
  weight?: 1 | 2 | 3
  pinned?: boolean
}

/** 改寫一筆記憶的內容、調星等、釘選或取消釘選。 */
export function editMemory(k: Kernel, state: GameState, id: string, patch: MemoryPatch): ReportDraft {
  const m = needMemory(state, id)
  if (patch.text !== undefined && !isText(patch.text)) throw new ActionBlocked('改寫的內容不能是空的。')
  if (patch.weight !== undefined && !isWeight(patch.weight)) throw new ActionBlocked('重要程度只有 1（日常）、2（重要）、3（難忘）。')
  if (Object.keys(patch).length === 0) throw new ActionBlocked('沒有要改的地方。')
  const rules = lifeRules(k).memory
  const body: Record<string, unknown> = {}
  if (patch.text !== undefined) body.text = clip(patch.text.trim(), rules.text_max)
  if (patch.weight !== undefined) body.weight = patch.weight
  if (patch.pinned !== undefined) body.pinned = patch.pinned
  const what = patch.pinned === undefined || Object.keys(patch).length > 1 ? '改了一筆記憶' : patch.pinned ? '釘選了一筆記憶' : '取消釘選一筆記憶'
  return memoryDraft(state, `${what}：${clip(m.text, 40)}`, [{ op: 'npcs.memory.edit', id, ...body }], 'edited')
}

/** 釘選（或取消釘選）一筆記憶。 */
export const pinMemory = (k: Kernel, state: GameState, id: string, on = true): ReportDraft => editMemory(k, state, id, { pinned: on })

/** 刪掉一筆記憶。 */
export function forgetMemory(_k: Kernel, state: GameState, id: string): ReportDraft {
  const m = needMemory(state, id)
  return memoryDraft(state, `忘掉了一筆記憶：${clip(m.text, 40)}`, [{ op: 'npcs.memory.delete', id }], 'deleted')
}

// ---- 變更、效果、掛鉤 ----

const sortedUnique = (ids: unknown): string[] => [...new Set((Array.isArray(ids) ? ids : []).filter(isText))].sort()

export function registerMemory(k: Kernel): void {
  const problemsOfWhere = (w: unknown): string[] => {
    if (w === undefined) return []
    if (!isRecord(w)) return ['where 要是 { district?, block?, facility?, layer?, subnet?, depth? }']
    const p: string[] = []
    for (const f of ['district', 'block', 'facility', 'subnet']) if (w[f] !== undefined && !isText(w[f])) p.push(`where.${f} 要是 id`)
    if (w.layer !== undefined && w.layer !== 'net') p.push('where.layer 只能是 net')
    if (w.depth !== undefined && !(isSafeInt(w.depth) && w.depth >= 0)) p.push('where.depth 要是 0 以上的整數')
    return p
  }
  const textProblems = (t: unknown, max = 1000): string[] => (isText(t) && t.length <= max ? [] : [`text 要是 1～${max} 字的字串`])

  // 加一筆：時間是套用時的現在（沒給 at）；超過上限時在這一刻合併
  k.changes.register<Change & { where?: MemoryWhere; who?: string[]; text: string; weight?: number; pinned?: boolean; at?: GameTime }>({
    op: 'npcs.memory.add', owner: OWNER,
    validate: (_s, c) => [
      ...textProblems(c.text), ...problemsOfWhere(c.where),
      ...(c.weight === undefined || isWeight(c.weight) ? [] : [`weight 要是 ${WEIGHTS.join('、')}`]),
      ...(c.who === undefined || (Array.isArray(c.who) && c.who.every(isText)) ? [] : ['who 要是 id 的陣列']),
      ...(c.pinned === undefined || typeof c.pinned === 'boolean' ? [] : ['pinned 要是 true 或 false']),
      ...(c.at === undefined || isValidTime(c.at) ? [] : ['at 要是時間']),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      const seq = (): string => `m${(s.memSeq = (s.memSeq ?? 0) + 1)}`
      const list = [...(s.memories ?? [])]
      list.push({
        id: seq(), at: clone(c.at ?? state.time), where: clone(c.where ?? {}), who: sortedUnique(c.who), text: c.text.trim(), weight: c.weight === undefined ? 1 : (c.weight as 1 | 2 | 3),
        ...(c.pinned ? { pinned: true as const } : {}),
      })
      s.memories = compactMemories(list, lifeRules(k).memory, seq)
    },
  })

  // 改寫、調星等、釘選
  k.changes.register<Change & { id: string; text?: string; weight?: number; pinned?: boolean }>({
    op: 'npcs.memory.edit', owner: OWNER,
    validate: (state, c) => [
      ...(isText(c.id) && (readNpcs(state).memories ?? []).some((m) => m.id === c.id) ? [] : [`找不到記憶 ${String(c.id)}`]),
      ...(c.text === undefined ? [] : textProblems(c.text)),
      ...(c.weight === undefined || isWeight(c.weight) ? [] : [`weight 要是 ${WEIGHTS.join('、')}`]),
      ...(c.pinned === undefined || typeof c.pinned === 'boolean' ? [] : ['pinned 要是 true 或 false']),
    ],
    apply(state, c) {
      const m = ensureNpcs(state).memories!.find((x) => x.id === c.id)!
      if (c.text !== undefined) m.text = c.text.trim()
      if (c.weight !== undefined) m.weight = c.weight as 1 | 2 | 3
      if (c.pinned === true) m.pinned = true
      else if (c.pinned === false) delete m.pinned
    },
  })

  k.changes.register<Change & { id: string }>({
    op: 'npcs.memory.delete', owner: OWNER,
    validate: (state, c) => (isText(c.id) && (readNpcs(state).memories ?? []).some((m) => m.id === c.id) ? [] : [`找不到記憶 ${String(c.id)}`]),
    apply(state, c) {
      const s = ensureNpcs(state)
      s.memories = s.memories!.filter((m) => m.id !== c.id)
      if (s.memories.length === 0) delete s.memories
    },
  })

  // 回到快照之後把回去之前的記憶整份放回來（rewind.keep）
  k.changes.register<Change & { memories: Memory[]; seq: number }>({
    op: 'npcs.memory.keep', owner: OWNER,
    validate: (_s, c) => [
      ...(Array.isArray(c.memories) && c.memories.every((m) => isRecord(m) && isText(m.id) && isText(m.text) && isWeight(m.weight) && isValidTime(m.at) && Array.isArray(m.who)) ? [] : ['memories 要是記憶的陣列']),
      ...(isSafeInt(c.seq) && c.seq >= 0 ? [] : ['seq 要是 0 以上的整數']),
    ],
    apply(state, c) {
      const s = ensureNpcs(state)
      if (c.memories.length > 0) s.memories = clone(c.memories)
      else delete s.memories
      if (c.seq > 0) s.memSeq = c.seq
      else delete s.memSeq
    },
  })

  // 效果 memory：事件指定的一筆（EVENTS 2.4 節）
  interface MemoryEffect extends Effect { text: string; weight?: number; who?: string[]; pinned?: boolean }
  k.effects.register<MemoryEffect>({
    kind: 'memory', owner: OWNER,
    validate: (raw) => [
      ...textProblems(raw.text, 200),
      ...(raw.weight === undefined || isWeight(raw.weight) ? [] : ['weight 要是 1（日常）、2（重要）、3（難忘）']),
      ...(raw.who === undefined || (Array.isArray(raw.who) && raw.who.every(isText)) ? [] : ['who 要是人的 id 的陣列']),
      ...(raw.pinned === undefined || typeof raw.pinned === 'boolean' ? [] : ['pinned 要是 true 或 false']),
    ],
    // 參與人查不到的整筆拿掉並提醒（引用的 id 要存在，四條路都一樣；B035）：角色、這一局的 NPC（生成的或內容的）都算
    clamp(e, ctx) {
      const ghosts = sortedUnique(e.who).filter((id) => id !== ctx.state.pc && !Object.hasOwn(ctx.state.actors, id) && !npcOf(k, ctx.state, id))
      return ghosts.length === 0 ? { effect: e } : { effect: null, note: { from: ghosts.join('、'), to: null, limit: 'memory', notice: `查不到 ${ghosts.join('、')} 這個人，這件事沒有記下來。` } }
    },
    toChanges: (e, ctx): Change[] => [{
      op: 'npcs.memory.add', where: whereOf(ctx.state.location), who: sortedUnique(e.who), text: e.text.trim(), weight: e.weight ?? 2, ...(e.pinned ? { pinned: true } : {}),
    }],
    describe: (e) => `記下了一件事：${clip(e.text.trim(), 40)}`,
  })

  k.hooks.on('report.before', OWNER, ({ state, draft }) => {
    const changes = memoryChanges(k, state, draft)
    return changes.length > 0 ? changes : undefined
  })

  k.hooks.on('rewind.keep', OWNER, ({ current, restored }) => {
    const cur = readNpcs(current)
    const was = readNpcs(restored)
    if (JSON.stringify(cur.memories ?? []) === JSON.stringify(was.memories ?? []) && (cur.memSeq ?? 0) === (was.memSeq ?? 0)) return undefined
    return [{ op: 'npcs.memory.keep', memories: clone(cur.memories ?? []), seq: cur.memSeq ?? 0 }]
  })
}
