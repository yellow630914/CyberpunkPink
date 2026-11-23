/**
 * 和人有關的畫面（這裡的人、說話與互動、關係、名冊、人情；M2-ui-people）：把引擎給的整理成畫面要的列。純函式，只整理與排序。
 * DC 與每一條來源、成功率、能不能做的原因、親密度的階段、名冊容量、出場費、招募的 DC，一律是引擎的（stores/engine.ts 的 people）；
 * 這裡沒有任何門檻與公式：看得到的數字都是引擎回的，這裡只換成顯示用的字（百分比、名字、日期）。
 */
import type { GameTime } from '@engine/src'
import { formatTime } from '@engine/src'
import type { FavorsState } from '@engine/src/features/favors'
import { SIZE_NAME } from '@engine/src/features/favors'
import type { InteractionView, Memory, NewsItem, Npc, Relation } from '@engine/src/features/npcs'
import { BRIDGE_PARAMS, CATEGORY_NAME, KIND_NAME, READ_CATEGORIES, STAGES, parseFact } from '@engine/src/features/npcs'
import type { ReadCategory } from '@engine/src/features/npcs'
import type { Candidate, RosterRow } from '@engine/src/features/roster'

/** 內容的名字（stores/engine.ts 的 people.look）：傾向標籤、勢力、路數、物品、地點 */
export interface PeopleLook {
  tag: (id: string) => string
  faction: (id: string) => string
  path: (id: string) => string
  item: (id: string) => string
  place: (loc: { district?: string; block?: string; facility?: string }) => string
}

export { CATEGORY_NAME, READ_CATEGORIES }
export type { ReadCategory }

/** 還沒有開放的（先灰掉並寫這一句）：關係線、傳訊息、送禮以外的邀約、採訪、請教 */
export const UNOPENED = '還沒有開放。'
export const UNOPENED_ACTIONS: readonly string[] = ['關係線', '傳訊息', '邀約', '採訪', '請教']

// ---- 一個人的抬頭 ----

export const kindName = (n: Pick<Npc, 'kind'>): string => KIND_NAME[n.kind]
/** 身分一句：職業，沒有就是身分類 */
export const identityOf = (n: Pick<Npc, 'occupation' | 'kind'>): string => n.occupation ?? kindName(n)
/** 勢力的標籤（沒有勢力是空的） */
export const factionOf = (n: Pick<Npc, 'faction'>, look: PeopleLook): string => (n.faction ? look.faction(n.faction) : '')

/** 路數與階數：「掮客 3」；主職在前 */
export function pathLabels(paths: Array<{ path: string; slot: string; tier: number }>, look: PeopleLook): string[] {
  const order = ['main', 'sub', 'third']
  return [...paths].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)).map((p) => `${look.path(p.path)} ${p.tier}`)
}

// ---- 親密度 ----

/** 親密度條（以 0 為中線）：正的往右、負的往左；寬度是這一側的百分比（−100～100 對應兩側各一半） */
export function affinityBar(value: number): { side: 'pos' | 'neg'; pct: number } {
  return { side: value >= 0 ? 'pos' : 'neg', pct: Math.min(50, Math.abs(value) / 2) }
}
/** 階段的說明（提示框用）：階段名與下限，照引擎的表 */
export const stageList = (): Array<{ id: string; name: string; min: number }> => STAGES.map((s) => ({ id: s.id, name: s.name, min: s.min }))
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

// ---- 已知的事（沒揭開的寫問號）----

export interface KnownRow { key: string; label: string; value: string; unknown: boolean }
const UNKNOWN = '？？？'
const BRIDGE_NAME: Record<string, string> = { sensitivity: '敏感', tolerance: '耐受', craving: '渴求', docility: '順從' }

/** 已知的事：傾向、橋參數、契約、秘密各一格，讀到了寫內容，沒讀到寫問號；讀過的近況另列 */
export function knownRows(npc: Npc, facts: string[], look: PeopleLook): KnownRow[] {
  const parsed = facts.map((f) => ({ f, p: parseFact(f) })).filter((x) => x.p !== null)
  const of = (kind: string) => parsed.filter((x) => x.p!.kind === kind)
  const rows: KnownRow[] = []
  const tend = of('tendency')
  if (tend.length === 0) rows.push({ key: 'tendency', label: '傾向', value: UNKNOWN, unknown: true })
  else {
    const tags = tend.map((x) => x.p!.arg!).filter((a) => a !== 'none')
    rows.push({ key: 'tendency', label: '傾向', value: tags.length ? tags.map(look.tag).join('、') : '沒有特別的傾向', unknown: false })
  }
  const bridge = of('bridge')
  if (bridge.length === 0) rows.push({ key: 'bridge', label: '橋參數', value: UNKNOWN, unknown: true })
  else {
    const b = npc.bridge
    rows.push({ key: 'bridge', label: '橋參數', value: b ? BRIDGE_PARAMS.map((p) => `${BRIDGE_NAME[p] ?? p} ${b[p]}`).join('・') : '沒有橋', unknown: false })
  }
  rows.push(of('contract').length ? { key: 'contract', label: '契約', value: '讀到了（詳情在契約面板）', unknown: false } : { key: 'contract', label: '契約', value: UNKNOWN, unknown: true })
  const secrets = of('secret')
  rows.push(secrets.length ? { key: 'secret', label: '秘密', value: secrets.map((x) => x.p!.arg!).join('、'), unknown: false } : { key: 'secret', label: '秘密', value: UNKNOWN, unknown: true })
  const recent = of('recent')
  if (recent.length) {
    const where = (arg: string): string => {
      const asBlock = look.place({ block: arg })
      return asBlock !== arg ? asBlock : look.place({ district: arg })
    }
    rows.push({ key: 'recent', label: '近況', value: recent.map((x) => `最近去過${where(x.p!.arg!)}`).join('；'), unknown: false })
  }
  return rows
}

// ---- 互動選單 ----

export interface InteractRow {
  kind: string
  name: string
  ok: boolean
  reason: string | null
  /** DC 與每一條來源（引擎的 mods）；對象查不到時是空的 */
  dcText: string
  dcTitle: string
  chanceText: string
  needs: 'item' | 'category' | null
}
const pct = (c: number | null): string => (c === null ? '' : `${Math.round(c * 100)}%`)

export function interactRows(list: InteractionView[]): InteractRow[] {
  return list.map((v) => ({
    kind: v.kind, name: v.name, ok: v.ok, reason: v.reason, needs: v.needs,
    dcText: v.dc === null ? '' : `DC ${v.dc}`,
    dcTitle: v.mods.map((m) => `${m.label} ${signed(m.value)}`).join('；'),
    chanceText: pct(v.chance),
  }))
}

/**
 * 今天已經聊過了的提示。引擎只在結算時照「今天第一次」加親密度，沒有現成的句子（列在回報裡），
 * 所以這裡只認引擎的 doneToday 記的 chat，句子是畫面寫的。
 */
export const CHAT_AGAIN = '今天已經聊過了：再聊也行，但不會再加親密度。'
export const chatAgain = (done: string[]): string | null => (done.includes('chat') ? CHAT_AGAIN : null)

// ---- 共同記憶與近況 ----

export interface MemoryRow { id: string; when: string; place: string; weight: 1 | 2 | 3; weightName: string; text: string; pinned: boolean; merged: number | null }
const WEIGHT_NAME: Record<number, string> = { 1: '日常', 2: '重要', 3: '難忘' }
export function memoryRows(list: Memory[], look: PeopleLook): MemoryRow[] {
  return list.map((m) => ({
    id: m.id, when: formatTime(m.at as GameTime), place: look.place(m.where), weight: m.weight, weightName: WEIGHT_NAME[m.weight] ?? '',
    text: m.text, pinned: m.pinned === true, merged: m.merged ?? null,
  }))
}
export function newsRows(list: NewsItem[]): Array<{ when: string; text: string }> {
  return [...list].reverse().map((n) => ({ when: formatTime(n.at as GameTime), text: n.text }))
}

// ---- 關係的名單 ----

export interface PersonRow {
  id: string
  name: string
  identity: string
  faction: string
  kind: string
  affinity: number
  stageName: string
  watch: boolean
  member: boolean
  loyalty: number | null
  /** 欠你的、你欠的人情各幾筆 */
  owedToYou: number
  youOwe: number
}
export const FILTERS = ['全部', '名冊', '關注', '行者', '街坊', '職員', '人情'] as const
export type PersonFilter = (typeof FILTERS)[number]

export function personRows(
  ids: string[], get: (id: string) => { npc: Npc; affinity: number; stageName: string; rel: Relation | null; loyalty: number | null; member: boolean },
  favors: FavorsState, look: PeopleLook,
): PersonRow[] {
  return ids.map((id) => {
    const x = get(id)
    return {
      id, name: x.npc.name, identity: identityOf(x.npc), faction: factionOf(x.npc, look), kind: kindName(x.npc), affinity: x.affinity, stageName: x.stageName,
      watch: x.rel?.watch === true, member: x.member, loyalty: x.loyalty,
      owedToYou: favors.owed_to_pc.filter((f) => f.who === id).length, youOwe: favors.owed_by_pc.filter((f) => f.who === id).length,
    }
  }).sort((a, b) => b.affinity - a.affinity)
}
export function filterPersons(rows: PersonRow[], f: PersonFilter): PersonRow[] {
  switch (f) {
    case '名冊': return rows.filter((r) => r.member)
    case '關注': return rows.filter((r) => r.watch)
    case '行者': case '街坊': case '職員': return rows.filter((r) => r.kind === f)
    case '人情': return rows.filter((r) => r.owedToYou > 0 || r.youOwe > 0)
    default: return rows
  }
}
export const favorLine = (r: Pick<PersonRow, 'owedToYou' | 'youOwe'>): string => [r.owedToYou ? `欠你 ${r.owedToYou}` : '', r.youOwe ? `你欠 ${r.youOwe}` : ''].filter(Boolean).join('・')

// ---- 人情 ----

export interface FavorRow { id: string; who: string; whoName: string; size: string; note: string; dir: 'owed_to_pc' | 'owed_by_pc'; when: string }
export function favorRows(favors: FavorsState, dir: 'owed_to_pc' | 'owed_by_pc', nameOf: (who: string) => string): FavorRow[] {
  return favors[dir].map((f) => ({ id: f.id, who: f.who, whoName: nameOf(f.who), size: `${SIZE_NAME[f.size]}人情`, note: f.note ?? '', dir, when: formatTime(f.at as GameTime) }))
}
/** 錢包旁的人情：欠你的幾筆、你欠的幾筆 */
export const favorTotals = (favors: FavorsState): { owedToYou: number; youOwe: number } => ({ owedToYou: favors.owed_to_pc.length, youOwe: favors.owed_by_pc.length })

// ---- 名冊 ----

export interface MemberRow {
  id: string
  name: string
  paths: string[]
  status: string
  busy: string[]
  payText: string
  payAmount: number | null
  weekly: number | null
  loyalty: number
  reliability: number
  fixed: boolean
  inParty: boolean
}
export function memberRows(rows: RosterRow[], npcOf: (id: string) => Npc | null, look: PeopleLook): MemberRow[] {
  return rows.map((r) => {
    const n = npcOf(r.id)
    return {
      id: r.id, name: r.name, paths: n ? pathLabels(n.paths, look) : [`主職 ${r.main_tier} 階`], busy: r.busy, status: r.busy.length ? '沒空' : '有空',
      payText: r.pay === 'fee' ? '出場費' : '分紅', payAmount: r.pay === 'fee' ? r.fee : null, weekly: r.weekly, loyalty: r.loyalty, reliability: r.reliability, fixed: r.fixed, inParty: r.in_party,
    }
  })
}
/** 可以招募的人：候選人在前，再來是認識的行者（不在名冊上的）；名字查不到的略過 */
export function recruitIds(candidates: Candidate[], known: string[], memberIds: string[], isRunner: (id: string) => boolean): string[] {
  const out: string[] = []
  for (const id of [...candidates.map((c) => c.who), ...known.filter(isRunner)]) if (!out.includes(id) && !memberIds.includes(id)) out.push(id)
  return out
}
export const chancePct = pct
export const SOURCE_NAME: Record<string, string> = { rescued: '你救過', introduced: '別人介紹' }
