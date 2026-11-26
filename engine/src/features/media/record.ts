// L6 功能 media 的第一半：記一則紀錄（MEDIA 1.1 節；dev/adr/0020 第一節、V2、V3、V4、V6、V57）。
//   activity.end（battle、scene、event）  一件事結束時記一則；委託副本裡的（origin.ext.commission）先放進這個階段的暫存，不各出一則
//   report.before（commission.milestone）  階段做完那一拍：把暫存加上那一拍的資料出一則；輿論面的階段不出
//   media.record（別的功能請它記：直播）
//   rewind.keep                            回到快照：索引、素材庫、流水號用回去之前的；回去之後才記的紀錄標 retracted（直播的改標 lost）
// 有沒有錄到（V6）在記的那一刻定：錄影開著、隊伍裡有人 rec_grade 大於 0、這個地方沒有標 no_rec。沒錄到的照樣記，by 是 null。

import type { ActivityEndReturn, BattleState, Change, GameState, Kernel, ReportDraft } from '../../core'
import { OUTCOME_NAME, isRecord } from '../../core'
import type { RecordInit } from './ops'
import type { Involves, Mark, Miss, RecordEntry, RecordHint, RecordSource } from './model'
import { EXT, MARKS, isText, isType, mediaRules, mediaValue, minutesNow, readMedia, recorderOf } from './model'

const texts = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(isText))] : [])
const union = <T>(...lists: T[][]): T[] => [...new Set(lists.flat())]
const flagged = (k: Kernel, kind: string, id: unknown): boolean => isText(id) && k.content.hasKind(kind) && k.content.get(kind, id)?.no_rec === true

// ---- 來源資料裡的 record 欄位（V4：來源的資料可以蓋掉預設） ----

/** 把一個不知道形狀的 record 欄位讀成 hint：只收認得的鍵、型別對的。 */
export function hintOf(raw: unknown): RecordHint {
  if (!isRecord(raw)) return {}
  const out: RecordHint = {}
  if (isType(raw.type)) out.type = raw.type
  if (isRecord(raw.involves)) out.involves = { ...(Array.isArray(raw.involves.factions) ? { factions: texts(raw.involves.factions) } : {}), ...(Array.isArray(raw.involves.people) ? { people: texts(raw.involves.people) } : {}) }
  for (const key of ['celebrity', 'hq', 'live', 'lost', 'adult', 'self', 'exclusive', 'no_rec'] as const) if (typeof raw[key] === 'boolean') out[key] = raw[key]
  if (Array.isArray(raw.tags)) out.tags = texts(raw.tags)
  return out
}

/** hint 裡寫明的記號（celebrity、hq、live、lost、adult、self）。 */
const hintMarks = (hint: RecordHint): Mark[] => (['celebrity', 'hq', 'live', 'lost', 'adult', 'self'] as const).filter((m) => hint[m] === true)

/** 兩份 hint 合併：後面的蓋前面的。 */
const mergeHint = (a: RecordHint, b: RecordHint): RecordHint => ({ ...a, ...b, ...(a.involves || b.involves ? { involves: { ...a.involves, ...b.involves } } : {}) })

// ---- 有沒有錄到 ----

/** 這個地方現在不准錄：設施的種類、街區、區、地圖模板的 no_rec，或這一則的 hint、對象自己說不准。 */
export function noRecHere(k: Kernel, state: GameState, extra: { hint?: RecordHint; people?: string[] } = {}): boolean {
  if (extra.hint?.no_rec === true) return true
  const loc = state.location
  if (flagged(k, 'facility_type', loc.facility) || flagged(k, 'block', loc.block) || flagged(k, 'district', loc.district)) return true
  const at = state.maps?.at
  const inst = at ? state.maps.instances[at.map] : undefined
  if (inst && flagged(k, 'special_map', inst.def)) return true
  return (extra.people ?? []).some((p) => flagged(k, 'npc', p))
}

/** 這一刻有沒有錄到：拍的人與他的錄影等級，或沒錄到的原因。 */
export function recStatus(k: Kernel, state: GameState, extra: { hint?: RecordHint; people?: string[] } = {}): { by: string; grade: number } | { miss: Miss } {
  if (!readMedia(state).rec) return { miss: 'off' }
  const who = recorderOf(k, state)
  if (!who) return { miss: 'none' }
  if (noRecHere(k, state, extra)) return { miss: 'banned' }
  return { by: who.id, grade: who.grade }
}

/** 現在是不是真的在錄（條件 rec_on）：開著、有人錄得到、這裡准錄。 */
export const isRecording = (k: Kernel, state: GameState): boolean => 'by' in recStatus(k, state)

// ---- 記一則 ----

export interface RecordInput {
  source: RecordSource
  label: string
  /** 這一件事本身的記號（crit、boss、lost、adult、self……）；hint 裡寫的另外併進來 */
  marks?: Mark[]
  /** 預設涉及的勢力與人；hint.involves 寫了的欄位蓋掉它 */
  involves?: Partial<Involves>
  hint?: RecordHint
  /** 查「來源對類型的預設表」用的鍵（預設是 source.kind；委託階段是 stage 或 stage:net） */
  typeKey?: string
  tags?: string[]
  /** 這件事的對象（查 no_rec） */
  people?: string[]
}

/** 組一則紀錄（還沒有 id；media.add 套用時發）。純函式。 */
export function recordInit(k: Kernel, state: GameState, input: RecordInput): RecordInit {
  const rules = mediaRules(k)
  const hint = input.hint ?? {}
  const marks: Mark[] = union(input.marks ?? [], hintMarks(hint)).filter((m): m is Mark => (MARKS as readonly unknown[]).includes(m))
  const status = recStatus(k, state, { hint, people: input.people ?? input.involves?.people ?? [] })
  const type = hint.type !== undefined && isType(hint.type) ? hint.type : rules.source_type[input.typeKey ?? input.source.kind] ?? rules.source_type[input.source.kind] ?? 'daily'
  const tags = union(input.tags ?? [], hint.tags ?? [])
  return {
    at: minutesNow(state), source: { ...input.source }, label: input.label,
    by: 'by' in status ? status.by : null, grade: 'by' in status ? status.grade : 0, type,
    involves: { factions: union(hint.involves?.factions ?? input.involves?.factions ?? []), people: union(hint.involves?.people ?? input.involves?.people ?? []) },
    marks, exclusive: hint.exclusive ?? !marks.includes('live'),
    ...('miss' in status ? { miss: status.miss } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  }
}

const addRecord = (r: RecordInit): Change => ({ op: 'media.add', record: r })

// ---- 活動結束 ----

type EndPayload = { state: GameState; kind: string; id: string; origin: { by: string; ref?: string; ext?: Record<string, unknown> }; outcome: string; result: Record<string, unknown> }

/** 戰鬥的記號從這一場的每一步報告數：我方打出 crit、我方打倒首領位階的敵人記 boss；輸了（戰敗、投降）記 lost。 */
export function battleMarks(state: Pick<GameState, 'reports'>, b: Pick<BattleState, 'steps' | 'units'>, outcome: string): Mark[] {
  const ids = new Set(b.steps)
  const out = new Set<Mark>()
  for (const r of state.reports) {
    if (!ids.has(r.id)) continue
    for (const beat of r.timeline) {
      const d = isRecord(beat.data) ? beat.data : {}
      if (beat.tag === 'crit' && isText(d.attacker) && b.units[d.attacker]?.side === 'ally') out.add('crit')
      if (beat.tag === 'down' && d.side === 'foe' && d.rank === 'boss') out.add('boss')
    }
  }
  if (outcome === 'lose' || outcome === 'surrender') out.add('lost')
  return [...out]
}

const nameOf = (k: Kernel, kind: string, id: string): string => {
  const n = k.content.hasKind(kind) ? k.content.get(kind, id)?.name : undefined
  return isText(n) ? n : id
}

interface Found { input: RecordInput; stage: { marks: Mark[]; people: string[]; factions: string[] } }

function fromBattle(k: Kernel, p: EndPayload): Found | null {
  const b = p.state.battle
  if (!b || b.id !== p.id) return null
  const foes = Object.values(b.units).filter((u) => u.side === 'foe')
  const factions = union(isText(b.origin.faction) ? [b.origin.faction] : [], foes.flatMap((u) => (u.enemy && k.content.hasKind('enemy') && isText(k.content.get('enemy', u.enemy)?.faction) ? [k.content.get('enemy', u.enemy)!.faction as string] : [])))
  const people = union(foes.flatMap((u) => (u.actor ? [u.actor] : [])))
  const marks = battleMarks(p.state, b, p.outcome)
  const names = [...new Set(foes.map((u) => u.name))].join('、')
  const label = `${b.origin.place ? `${b.origin.place}：` : ''}和${names || '對手'}的戰鬥（${OUTCOME_NAME[p.outcome] ?? p.outcome}）`
  const enc = isText(b.origin.encounter) && k.content.hasKind('encounter') ? hintOf(k.content.get('encounter', b.origin.encounter)?.record) : {}
  const hint = mergeHint(enc, hintOf(p.origin.ext?.record))
  const last = b.steps[b.steps.length - 1]
  return { input: { source: { kind: 'battle', ref: b.id, ...(last ? { report: last } : {}) }, label, marks, involves: { factions, people }, hint, people }, stage: { marks: union(marks, hintMarks(hint)), people, factions: union(factions, hint.involves?.factions ?? []) } }
}

function fromScene(k: Kernel, p: EndPayload): Found | null {
  const r = p.result
  // V57：失憶的場景不留紀錄（那段畫面不歸你）
  if (r.amnesia === true) return null
  const pc = p.state.pc
  const pairs = isRecord(r.pairs) ? Object.keys(r.pairs) : []
  const people = union(isText(r.with) ? [r.with] : [], pairs).filter((x) => x !== pc)
  const solo = r.solo === true
  const names = people.map((id) => p.state.actors[id]?.name ?? nameOf(k, 'npc', id))
  const label = solo ? '一個人的場景' : people.length === 0 ? '一場場景' : people.length === 1 ? `和${names[0]}的場景` : `和${names.join('、')}的場景`
  const hint = hintOf(p.origin.ext?.record)
  const tags = texts(r.touched)
  const marks: Mark[] = ['adult', 'self']
  return { input: { source: { kind: 'scene', ref: p.id }, label, marks, involves: { people }, hint, tags, people }, stage: { marks: union(marks, hintMarks(hint)), people, factions: hint.involves?.factions ?? [] } }
}

function fromEvent(k: Kernel, p: EndPayload): Found | null {
  const id = p.result.event
  if (!isText(id)) return null
  const hint = mergeHint(k.content.hasKind('event') ? hintOf(k.content.get('event', id)?.record) : {}, hintOf(p.origin.ext?.record))
  return { input: { source: { kind: 'event', ref: id }, label: nameOf(k, 'event', id), marks: [], hint }, stage: { marks: hintMarks(hint), people: hint.involves?.people ?? [], factions: hint.involves?.factions ?? [] } }
}

/** 掛點 activity.end：battle、scene、event 結束時記一則（委託副本裡的先放進階段的暫存）。 */
export function onActivityEnd(k: Kernel, p: EndPayload): ActivityEndReturn | undefined {
  const found = p.kind === 'battle' ? fromBattle(k, p) : p.kind === 'scene' ? fromScene(k, p) : p.kind === 'event' ? fromEvent(k, p) : null
  if (!found) return undefined
  const commission = p.origin.ext?.commission
  if (isText(commission)) return { changes: [{ op: 'media.stage', add: { commission, marks: found.stage.marks, people: found.stage.people, factions: found.stage.factions } }] }
  return { changes: [addRecord(recordInit(k, p.state, found.input))] }
}

// ---- 委託階段的里程碑 ----

/** 掛點 report.before：草稿有一拍 commission.milestone，就把暫存加上那一拍的資料出一則（輿論面的階段不出）；暫存清掉。 */
export function onMilestone(k: Kernel, state: GameState, draft: Pick<ReportDraft, 'timeline'>): Change[] | undefined {
  const beat = draft.timeline.find((b) => b.tag === 'commission.milestone')
  if (!beat) return undefined
  const d = isRecord(beat.data) ? beat.data : {}
  const pending = readMedia(state).stage
  const clear: Change = { op: 'media.stage', clear: true }
  if (d.face === 'opinion') return pending ? [clear] : undefined
  const id = isText(d.id) ? d.id : pending?.commission
  if (!isText(id)) return pending ? [clear] : undefined
  const stage = pending && pending.commission === id ? pending : null
  const hint = hintOf(d.record)
  const faction = isText(d.faction) && d.faction !== 'none' ? [d.faction] : []
  const n = typeof d.stage === 'number' && Number.isFinite(d.stage) ? d.stage : 1
  const net = d.face === 'net'
  const input: RecordInput = {
    source: { kind: 'stage', ref: id }, label: `「${nameOf(k, 'commission', id)}」第 ${n} 階段`, typeKey: net ? 'stage:net' : 'stage',
    marks: stage?.marks ?? [], involves: { factions: union(faction, stage?.factions ?? []), people: stage?.people ?? [] }, hint,
  }
  return [addRecord(recordInit(k, state, input)), clear]
}

// ---- 別的功能請它記（掛點 media.record） ----

/** 掛點 media.record：直播的收播之類。來源種類不對、標題是空的就不記。 */
export function onRecord(k: Kernel, p: { state: GameState; source: RecordSource; label: string; hint?: RecordHint }): Change[] | undefined {
  if (!isRecord(p.source) || !isText(p.source.kind) || !isText(p.label)) return undefined
  const hint = hintOf(p.hint)
  return [addRecord(recordInit(k, p.state, { source: { kind: p.source.kind, ...(isText(p.source.ref) ? { ref: p.source.ref } : {}), ...(isText(p.source.report) ? { report: p.source.report } : {}) }, label: p.label, hint, marks: [] }))]
}

// ---- 回到快照 ----

/** 掛點 rewind.keep：current 是回去之前、restored 是快照那一刻。 */
export function onRewind(current: GameState, restored: GameState): Change[] | undefined {
  if (current.ext?.[EXT] === undefined) return undefined
  const now = readMedia(current)
  const before = readMedia(restored)
  // 撤退（使用者 2026-11-24 第 2、3 題：撤退收回的轉素材時品質 −1，失敗收回的不扣）：讓這次回去的那一份報告是撤退
  const carrier = [...current.reports.slice(restored.reports.length)].reverse().find((r) => r.rewind)
  const retreat = !!carrier && (carrier.outcome.result === 'retreat' || carrier.rewind!.summary.startsWith('你從副本撤退'))
  const records: Record<string, RecordEntry> = {}
  for (const [id, r] of Object.entries(now.records)) {
    if (before.records[id] || r.retracted) { records[id] = r; continue }
    // 直播是真的播出去了：不標被收回，改標戰敗的畫面（品質少 1）
    records[id] = r.marks.includes('live')
      ? { ...r, marks: union(r.marks, ['lost' as Mark]) }
      : { ...r, retracted: true, ...(retreat ? { retreat: true as const } : {}) }
  }
  return [{ op: 'ext', key: EXT, value: mediaValue({ ...now, records, stage: before.stage }) }]
}
