// L6 功能 creation 的第 5 步：生命軌跡（M4-creation-lifepath；CHARACTER 第 3 節、5.5 節、第 6 節的 lifepath_entry 樣本、第 2 節歡場與櫻町的固定傾向；dev/adr/0019 第十一節）。
//
// 八張表（家人、那件事、朋友、仇人、舊情、想要的、性經歷、潛在性癖）的每一條是內容種類 lifepath_entry；每張表可以選、可以擲、可以跳過。
// 結果只能是 result 裡規定的幾種（EVENTS 2.4 節的效果清單、一個有關係的 NPC、一個個人目標、傾向與標籤、傾向的軸、性經歷記錄的起始值、橋參數的微調），其他的鍵載入時擋下。
// creation 自己處理 effects（用內建的來源經 k.effects 變成變更，落在主角身上）、goal（旗標 goal:<id>）、sex_record（寫 actor.ext.sex_record 的起始值）；
// npc、tendency、axis、bridge 經掛點 creation.step（step: 'lifepath'）交給別的功能（npcs、lewd）；沒有人認得的寫進報告的提醒（clamps），不丟錯。
// 內容篩選：條目的 tags、結果裡的傾向標籤被關掉的，那一條不列、選了被擋；整張表的條目全被濾掉時那張表不出現。
// 全部是純函式：不改傳進來的東西、不自己提交。

import type { Change, ClampNote, ContentEntry, GameState, Kernel, OriginEntry } from '../../core'
import { clone, contentAllowed, deriveRng, effectCtx, isRecord, tagsAllowed } from '../../core'
import type { StepAnswer } from './body'
import { creationLimits, LIFEPATH_TABLES } from './model'
import type { CreationDraft, LifepathTable } from './model'

export const LIFEPATH_KIND = 'lifepath_entry'
export const TENDENCY_TAG_KIND = 'tendency_tag'

/** 表的名字（給畫面與原因用）。 */
export const TABLE_NAME: Record<LifepathTable, string> = {
  family: '家人', incident: '那件事', friend: '朋友', enemy: '仇人', ex: '舊情', want: '想要的', sex: '性經歷', kink: '潛在性癖',
}

/** 一個有關係的 NPC 的角色（result.npc.role）。 */
export const NPC_ROLES = ['family', 'friend', 'enemy', 'ex'] as const
export type NpcRole = (typeof NPC_ROLES)[number]
export const ROLE_NAME: Record<NpcRole, string> = { family: '家人', friend: '朋友', enemy: '仇人', ex: '舊情人' }

/** 建角最多自己挑幾個潛在性癖（CHARACTER 第 3 節：一到兩個）。 */
export const MAX_KINKS = 2
/** 每條橋參數的微調最多幾點（工單：±10 以內）。 */
export const BRIDGE_TWEAK_MAX = 10

export interface LifepathNpc {
  role: NpcRole
  /** 'origin'：出身給好感的那個勢力；否則是勢力的 id */
  faction_from?: string
  affinity?: number
  hostility?: number
  /** true：把這個人寫進主角的 ext.origin.roster（開場就在名冊上） */
  roster?: boolean
}

export interface LifepathTendency {
  tag: string
  state?: 'has' | 'latent'
}

export interface LifepathResult {
  effects?: Array<Record<string, unknown>>
  npc?: LifepathNpc
  /** 個人目標的 id：變成旗標 goal:<id>（達成階段給歷練點是之後任務線的事） */
  goal?: string
  tendency?: LifepathTendency[]
  /** 軸 → +幾級 */
  axis?: Record<string, number>
  sex_record?: { times?: number; partners?: number; service_times?: number }
  /** 橋參數 → 加減（±10 以內） */
  bridge?: Record<string, number>
}

export interface LifepathEntry extends ContentEntry {
  table: LifepathTable
  text: string
  /** 出身的 id → 換一種說法（只換文字，不換結果） */
  texts?: Record<string, string>
  /** 只有這幾個出身看得到；沒寫是都看得到 */
  origins?: string[]
  /** 內容篩選的標籤 */
  tags?: string[]
  weight?: number
  result: LifepathResult
}

const RESULT_KEYS = ['effects', 'npc', 'goal', 'tendency', 'axis', 'sex_record', 'bridge'] as const
const NPC_KEYS = ['role', 'faction_from', 'affinity', 'hostility', 'roster'] as const
const SEX_KEYS = ['times', 'partners', 'service_times'] as const
/** 結果的鍵只有哪幾張表能用（CHARACTER 5.5 節：性經歷記錄與橋參數只有性經歷那張表；傾向與標籤只有性經歷與潛在性癖兩張表）。 */
const ONLY_IN: Partial<Record<(typeof RESULT_KEYS)[number], LifepathTable[]>> = {
  sex_record: ['sex'], bridge: ['sex'], tendency: ['sex', 'kink'], axis: ['sex', 'kink'],
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isTable = (v: unknown): v is LifepathTable => (LIFEPATH_TABLES as readonly unknown[]).includes(v)
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText)

// ---- 內容的格式（載入時；ready 時再查引用的標籤與勢力、已經註冊的效果的格式） ----

export function resultProblems(raw: unknown, table: unknown): string[] {
  if (!isRecord(raw)) return ['result 要是一個物件']
  const p: string[] = []
  for (const key of Object.keys(raw)) {
    if (!(RESULT_KEYS as readonly string[]).includes(key)) p.push(`result.${key}：不認得這個結果（可以寫的：${RESULT_KEYS.join('、')}）`)
    else {
      const only = ONLY_IN[key as (typeof RESULT_KEYS)[number]]
      if (only && isTable(table) && !only.includes(table)) p.push(`result.${key}：只有「${only.map((t) => TABLE_NAME[t]).join('、')}」那${only.length > 1 ? '幾' : ''}張表能寫（CHARACTER 5.5 節）`)
    }
  }
  if (raw.effects !== undefined) {
    if (!Array.isArray(raw.effects) || raw.effects.length === 0) p.push('result.effects 要是效果的陣列（至少一筆）')
    else raw.effects.forEach((e, i) => {
      if (!isRecord(e) || !isText(e.kind)) p.push(`result.effects[${i}] 要是 { kind, ... }`)
    })
  }
  if (raw.npc !== undefined) {
    const n = raw.npc
    if (!isRecord(n)) p.push('result.npc 要是一個物件')
    else {
      for (const key of Object.keys(n)) if (!(NPC_KEYS as readonly string[]).includes(key)) p.push(`result.npc.${key}：不認得（可以寫的：${NPC_KEYS.join('、')}）`)
      if (!(NPC_ROLES as readonly unknown[]).includes(n.role)) p.push(`result.npc.role 要是 ${NPC_ROLES.join('、')} 其中一個`)
      if (n.faction_from !== undefined && !isText(n.faction_from)) p.push("result.npc.faction_from 要是 'origin' 或勢力的 id")
      if (n.affinity !== undefined && !(isInt(n.affinity) && n.affinity >= -100 && n.affinity <= 100)) p.push('result.npc.affinity 要是 −100～100 的整數')
      if (n.hostility !== undefined && !(isInt(n.hostility) && n.hostility >= 1 && n.hostility <= 100)) p.push('result.npc.hostility 要是 1～100 的整數')
      if (n.roster !== undefined && typeof n.roster !== 'boolean') p.push('result.npc.roster 要是 true 或 false')
    }
  }
  if (raw.goal !== undefined && !(isText(raw.goal) && /^[a-z0-9_]+$/.test(raw.goal))) p.push('result.goal 要是個人目標的 id（小寫英文、數字與底線）')
  if (raw.tendency !== undefined) {
    if (!Array.isArray(raw.tendency) || raw.tendency.length === 0) p.push('result.tendency 要是 { tag, state? } 的陣列（至少一筆）')
    else raw.tendency.forEach((t, i) => {
      if (!isRecord(t) || !isText(t.tag) || (t.state !== undefined && t.state !== 'has' && t.state !== 'latent')) p.push(`result.tendency[${i}] 要是 { tag, state?: 'has' | 'latent' }`)
    })
  }
  if (raw.axis !== undefined) {
    if (!isRecord(raw.axis) || Object.keys(raw.axis).length === 0 || !Object.values(raw.axis).every((v) => isInt(v) && v >= 1 && v <= 5)) p.push('result.axis 要是「軸 → 加幾級（1～5）」')
  }
  if (raw.sex_record !== undefined) {
    const s = raw.sex_record
    if (!isRecord(s) || Object.keys(s).length === 0) p.push('result.sex_record 要是 { times?, partners?, service_times? }')
    else {
      for (const [key, v] of Object.entries(s)) {
        if (!(SEX_KEYS as readonly string[]).includes(key)) p.push(`result.sex_record.${key}：不認得（只收 ${SEX_KEYS.join('、')}）`)
        else if (!(isInt(v) && v >= 0 && v <= 100000)) p.push(`result.sex_record.${key} 要是 0 以上的整數`)
      }
    }
  }
  if (raw.bridge !== undefined) {
    const b = raw.bridge
    if (!isRecord(b) || Object.keys(b).length === 0 || !Object.values(b).every((v) => isInt(v) && v !== 0 && Math.abs(v) <= BRIDGE_TWEAK_MAX)) p.push(`result.bridge 要是「橋參數 → 加減（不為 0、±${BRIDGE_TWEAK_MAX} 以內）」`)
  }
  return p
}

export function entryProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isTable(e.table)) p.push(`table 要是 ${LIFEPATH_TABLES.join('、')} 其中一個`)
  if (!isText(e.text)) p.push('要有 text（選項的一句話）')
  if (e.texts !== undefined && !(isRecord(e.texts) && Object.entries(e.texts).every(([o, t]) => isText(o) && isText(t)))) p.push('texts 要是「出身的 id → 一句話」')
  if (e.origins !== undefined && !(textList(e.origins) && e.origins.length > 0)) p.push('origins 要是出身 id 的陣列（至少一個）')
  if (e.tags !== undefined && !textList(e.tags)) p.push('tags 要是字串的陣列')
  if (e.weight !== undefined && !(typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0)) p.push('weight 要是大於 0 的數字')
  p.push(...resultProblems(e.result, e.table))
  return p
}

export const lifepathRefs = (e: LifepathEntry): Array<[string, string]> => (e.origins ?? []).map((o) => ['origin', o] as [string, string])

// ---- 看得到哪些 ----

export interface LifepathOption {
  id: string
  /** 照出身換好的文字 */
  text: string
  weight: number
  tags: string[]
}
export interface LifepathTableView {
  table: LifepathTable
  name: string
  options: LifepathOption[]
}

const entriesOf = (k: Pick<Kernel, 'content'>): LifepathEntry[] => k.content.list<LifepathEntry>(LIFEPATH_KIND)

/** 條目說的出身限制：origins 寫了就只有那幾個；被某個出身的 lifepath_extra 認領的條目，只有認領的出身看得到（CHARACTER 第 2 節：出身多幾個相關的選項）。 */
function originBlock(k: Pick<Kernel, 'content'>, e: LifepathEntry, origin: string): boolean {
  if (e.origins !== undefined && !e.origins.includes(origin)) return true
  const claimers = k.content.list<OriginEntry>('origin').filter((o) => o.lifepath_extra?.includes(e.id))
  return claimers.length > 0 && !claimers.some((o) => o.id === origin)
}

const resultTags = (e: LifepathEntry): string[] => (e.result.tendency ?? []).map((t) => t.tag)

/** 被內容篩選關掉：條目自己的 tags，或結果裡的傾向標籤。 */
function filteredOut(state: Pick<GameState, 'rules'>, e: LifepathEntry): boolean {
  return !tagsAllowed(state.rules, e.tags) || resultTags(e).some((t) => !contentAllowed(state.rules, t))
}

/** 文字照出身換：texts 有這個出身的就用它，否則用 text。結果不因為文字不同而不同。 */
export const textOf = (e: LifepathEntry, origin: string): string => e.texts?.[origin] ?? e.text

/** 每張表看得到的條目（文字已經照出身換好；整張被篩掉或沒有條目的表不列）。 */
export function lifepathTables(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules'>, draft: Pick<CreationDraft, 'origin'>): LifepathTableView[] {
  const all = entriesOf(k)
  const out: LifepathTableView[] = []
  for (const table of LIFEPATH_TABLES) {
    const options = all
      .filter((e) => e.table === table && !originBlock(k, e, draft.origin) && !filteredOut(state, e))
      .map((e): LifepathOption => ({ id: e.id, text: textOf(e, draft.origin), weight: e.weight ?? 1, tags: [...(e.tags ?? [])] }))
    if (options.length > 0) out.push({ table, name: TABLE_NAME[table], options })
  }
  return out
}

/** 擲一張表：照權重與存檔的種子，同一份存檔同一張表每次擲到的順序固定；「重擲」由呼叫的人換 reroll（0 是第一次）。這張表沒有看得到的條目回傳 null。 */
export function lifepathRoll(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules' | 'rng'>, draft: Pick<CreationDraft, 'origin'>, table: LifepathTable, reroll = 0): string | null {
  const view = lifepathTables(k, state, draft).find((t) => t.table === table)
  if (!view) return null
  return deriveRng(state.rng, `lifepath:${table}`, reroll).weighted(view.options, (o) => o.weight).id
}

/** 可以自己挑的潛在性癖標籤（傾向的標籤，沒被內容篩選關掉的）。 */
export function kinkChoices(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules'>): Array<{ id: string; name: string }> {
  return k.content.list(TENDENCY_TAG_KIND).filter((t) => contentAllowed(state.rules, t.id)).map((t) => ({ id: t.id, name: typeof t.name === 'string' ? t.name : t.id }))
}

// ---- 檢查 ----

const tagName = (k: Pick<Kernel, 'content'>, tag: string): string => {
  const n = k.content.get(TENDENCY_TAG_KIND, tag)?.name
  return typeof n === 'string' ? n : tag
}

interface Chosen { table: LifepathTable; entry: LifepathEntry; text: string }

/** 草稿選的條目（跳過的、查不到的不算）。 */
function chosenOf(k: Pick<Kernel, 'content'>, draft: Pick<CreationDraft, 'origin' | 'lifepath'>): Chosen[] {
  const out: Chosen[] = []
  const picked = isRecord(draft.lifepath) ? draft.lifepath : {}
  for (const table of LIFEPATH_TABLES) {
    const id = picked[table]
    if (typeof id !== 'string' || id === 'skip') continue
    const e = k.content.get<LifepathEntry>(LIFEPATH_KIND, id)
    if (e && e.table === table) out.push({ table, entry: e, text: textOf(e, draft.origin) })
  }
  return out
}

/** 第 5 步的全部問題（給畫面一次列出來）；沒有問題是空的。 */
export function lifepathProblems(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules'>, draft: CreationDraft): string[] {
  const p: string[] = []
  const picked = draft.lifepath
  if (picked !== undefined) {
    if (!isRecord(picked)) return ['生命軌跡的格式不對。']
    for (const [table, id] of Object.entries(picked)) {
      if (id === undefined || id === 'skip') continue
      if (!isTable(table)) {
        p.push(`沒有「${table}」這張生命軌跡的表。`)
        continue
      }
      if (typeof id !== 'string') {
        p.push(`「${TABLE_NAME[table]}」要選一個選項，或跳過。`)
        continue
      }
      const e = k.content.get<LifepathEntry>(LIFEPATH_KIND, id)
      if (!e) {
        p.push(`「${TABLE_NAME[table]}」這張表沒有「${id}」這個選項。`)
        continue
      }
      const text = textOf(e, draft.origin)
      if (e.table !== table) p.push(`「${text}」不是「${TABLE_NAME[table]}」這張表的選項。`)
      else if (filteredOut(state, e)) p.push(`「${text}」被你的內容篩選關掉了，選不了。`)
      else if (originBlock(k, e, draft.origin)) p.push(`「${text}」是別的出身才有的選項。`)
    }
    // 朋友與仇人各最多一位
    for (const role of ['friend', 'enemy'] as const) {
      if (chosenOf(k, draft).filter((c) => c.entry.result.npc?.role === role).length > 1) p.push(`${ROLE_NAME[role]}最多一位。`)
    }
  }
  const kinks = draft.kinks
  if (kinks !== undefined) {
    if (!Array.isArray(kinks)) p.push('潛在性癖的格式不對。')
    else {
      if (kinks.length > MAX_KINKS) p.push(`潛在性癖最多選 ${MAX_KINKS} 個。`)
      const seen = new Set<string>()
      for (const kink of kinks) {
        if (!isRecord(kink) || !isText(kink.tag) || (kink.latent !== undefined && typeof kink.latent !== 'boolean')) {
          p.push('潛在性癖要寫成 { tag, latent? }。')
          continue
        }
        if (!k.content.has(TENDENCY_TAG_KIND, kink.tag)) p.push(`「${kink.tag}」不是傾向的標籤。`)
        else if (!contentAllowed(state.rules, kink.tag)) p.push(`「${tagName(k, kink.tag)}」這個題材被你的內容篩選關掉了，選不了。`)
        else if (seen.has(kink.tag)) p.push(`「${tagName(k, kink.tag)}」不能選兩次。`)
        seen.add(kink.tag)
      }
    }
  }
  return p
}

/** 第 5 步擋不擋：第一個問題的原因，沒有問題是 null。 */
export function lifepathBlock(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules'>, draft: CreationDraft): { step: 'lifepath'; reason: string } | null {
  const reason = lifepathProblems(k, state, draft)[0]
  return reason ? { step: 'lifepath', reason } : null
}

// ---- 提交：掛點 creation.step（step: 'lifepath'） ----

/** 交給別的功能的結果（掛點 creation.step 的 picks 就是這些鍵）。沒有人認得時寫進提醒。 */
const HOOK_KEYS = ['npc', 'tendency', 'axis', 'bridge'] as const
const HOOK_LABEL: Record<(typeof HOOK_KEYS)[number], string> = { npc: '人物', tendency: '傾向', axis: '傾向的軸', bridge: '橋參數' }

const note = (path: string, text: string, from: unknown = null): ClampNote => ({ path, from, to: null, limit: 'lifepath', notice: text })

export interface LifepathAsk {
  /** 要併進 actor.ext 的鍵（傾向、橋參數、性經歷記錄） */
  ext: Record<string, unknown>
  /** 接在放進主角之後的變更（NPC、關係、豔名、個人目標的旗標） */
  changes: Change[]
  /** 要進出身名冊的人 */
  roster: string[]
  /** 給玩家看的提醒（沒有人認得的結果、被擋下的一項） */
  notes: ClampNote[]
}

/**
 * 提交時問掛點 creation.step（step: 'lifepath'）：picks 是每一條選的結果（加上 table、entry、text 三個鍵），
 * 好幾個功能的回答合起來；沒有人認得的 npc、tendency、axis、bridge 寫進提醒。草稿一條都沒選也要問（出身的固定傾向與豔名、自己挑的潛在性癖）。
 * actorExt 是放進主角時 actor.ext 已經有的東西（唯讀）。
 */
export function askLifepath(k: Pick<Kernel, 'hooks' | 'content'>, state: GameState, draft: CreationDraft, actorExt: Record<string, unknown>, favor: string | undefined): LifepathAsk {
  const chosen = chosenOf(k, draft)
  const picks = chosen.map((c) => ({ table: c.table, entry: c.entry.id, text: c.text, ...clone(c.entry.result) }))
  const out: LifepathAsk = { ext: {}, changes: [], roster: [], notes: [] }
  const took = new Set<number>()
  const answers = k.hooks.run('creation.step', { state, draft, step: 'lifepath', picks, limits: creationLimits(k, state), actorExt: clone(actorExt), ...(favor !== undefined ? { favor } : {}) })
  for (const { result } of answers) {
    const a = result as StepAnswer
    if (!isRecord(a) || !Array.isArray(a.took)) continue
    for (const i of a.took) if (isInt(i) && i >= 0 && i < picks.length) took.add(i)
    if (isRecord(a.ext)) Object.assign(out.ext, clone(a.ext))
    if (Array.isArray(a.changes)) out.changes.push(...clone(a.changes))
    if (Array.isArray(a.roster)) for (const id of a.roster) if (isText(id) && !out.roster.includes(id)) out.roster.push(id)
    for (const n of [...(Array.isArray(a.notes) ? a.notes : []), ...(Array.isArray(a.blocks) ? a.blocks : [])]) if (isText(n)) out.notes.push(note('lifepath', n))
  }
  picks.forEach((pick, i) => {
    if (took.has(i)) return
    const keys = HOOK_KEYS.filter((key) => (pick as Record<string, unknown>)[key] !== undefined)
    if (keys.length > 0) out.notes.push(note(`lifepath.${pick.table}`, `「${pick.text}」的${keys.map((key) => HOOK_LABEL[key]).join('、')}沒有功能接得住（這一局沒有裝那個功能），只留下紀錄，不會生效。`))
  })

  // creation 自己的：個人目標的旗標、性經歷記錄的起始值
  let record: { partners: number; times: number; service_times: number } | null = null
  for (const c of chosen) {
    const r = c.entry.result
    if (r.goal !== undefined) out.changes.push({ op: 'flag', key: `goal:${r.goal}`, value: true })
    if (r.sex_record !== undefined) {
      record ??= { partners: 0, times: 0, service_times: 0 }
      record.partners += r.sex_record.partners ?? 0
      record.times += r.sex_record.times ?? 0
      record.service_times += r.sex_record.service_times ?? 0
    }
  }
  if (record) out.ext.sex_record = record
  return out
}

/**
 * 提交時 effects 的部分：每一筆各自用內建的來源經 k.effects 變成變更（落在主角身上），套在一份複製的狀態上驗過、接著算下一筆。
 * applied 是這一份報告到這裡為止的變更（放進主角、第 6～9 步、其他功能回答的）；沒有功能認得的效果、格式或狀態不合的一筆整筆拿掉並寫進提醒，不丟錯。
 */
export function lifepathEffects(k: Kernel, state: GameState, draft: CreationDraft, applied: Change[]): { changes: Change[]; notes: ClampNote[] } {
  const out = { changes: [] as Change[], notes: [] as ClampNote[] }
  const chosen = chosenOf(k, draft).filter((c) => c.entry.result.effects !== undefined)
  if (chosen.length === 0) return out
  const work = clone(state)
  k.changes.applyAll(work, applied)
  for (const c of chosen) {
    ;(c.entry.result.effects ?? []).forEach((effect, i) => {
      const path = `lifepath.${c.table}.effects[${i}]`
      const kind = String(effect.kind)
      if (!k.effects.has(kind)) {
        out.notes.push(note(path, `「${c.text}」的一項結果（${kind}）沒有功能接得住（這一局沒有裝那個功能），沒有算。`, kind))
        return
      }
      const res = k.effects.resolve([effect], effectCtx(k, work, { source: 'builtin', actor: work.pc ?? 'pc' }), path)
      if (res.errors.length > 0) {
        out.notes.push(note(path, `「${c.text}」的一項結果（${kind}）套不上去，沒有算：${res.errors[0]}`, kind))
        return
      }
      k.changes.applyAll(work, res.changes)
      out.changes.push(...res.changes)
      out.notes.push(...res.clamps.map((cl) => ({ ...cl, path })))
    })
  }
  return out
}

// ---- 給總覽頁：每一條會變成什麼 ----

export interface LifepathOutcome {
  kind: 'effect' | 'npc' | 'goal' | 'tendency' | 'axis' | 'sex_record' | 'bridge'
  /** 給玩家看的一句話（不含欄位名） */
  text: string
}
export interface LifepathSummaryRow {
  table: LifepathTable
  name: string
  id: string
  text: string
  outcomes: LifepathOutcome[]
}

const AXIS_LABEL: Record<string, string> = { relation: '關係', sense: '感官', body: '身體', costume: '扮相' }
const BRIDGE_LABEL: Record<string, string> = { sensitivity: '敏感度', tolerance: '耐受', craving: '慾求', docility: '馴化' }
const signed = (n: number): string => (n > 0 ? `+${n}` : `−${-n}`)

/**
 * 每一條選的條目提交時會變成什麼（總覽頁用）。previewState 是一份放了主角的狀態（算 effects 的白話一行用）；
 * 效果沒有功能接得住的那一項寫明「這一局不會生效」。
 */
export function lifepathSummary(k: Kernel, draft: CreationDraft, previewState: GameState): LifepathSummaryRow[] {
  const origin = draft.origin
  return chosenOf(k, draft).map((c) => {
    const r = c.entry.result
    const outcomes: LifepathOutcome[] = []
    ;(r.effects ?? []).forEach((effect) => {
      const kind = String(effect.kind)
      const res = k.effects.has(kind) ? k.effects.resolve([effect], effectCtx(k, previewState, { source: 'builtin', actor: previewState.pc ?? 'pc' })) : null
      outcomes.push({ kind: 'effect', text: res && res.errors.length === 0 && res.lines.length > 0 ? res.lines.join('；') : `一項結果（${kind}）：這一局沒有功能接得住，不會生效。` })
    })
    if (r.npc) {
      const n = r.npc
      const parts = [`認識一位${ROLE_NAME[n.role]}`]
      if (n.affinity !== undefined) parts.push(`親密度 ${signed(n.affinity)}`)
      if (n.hostility !== undefined) parts.push(`所屬勢力的敵對值 ${signed(n.hostility)}`)
      if (n.roster) parts.push('開場就在名冊上')
      outcomes.push({ kind: 'npc', text: parts.join('，') })
    }
    if (r.goal !== undefined) outcomes.push({ kind: 'goal', text: `一個個人目標：${r.goal}` })
    for (const t of r.tendency ?? []) outcomes.push({ kind: 'tendency', text: `傾向「${tagName(k, t.tag)}」：${t.state === 'latent' ? '潛在（還沒被本人察覺）' : '有'}` })
    for (const [axis, n] of Object.entries(r.axis ?? {})) outcomes.push({ kind: 'axis', text: `${AXIS_LABEL[axis] ?? axis}這一軸 +${n} 級` })
    if (r.sex_record) {
      const s = r.sex_record
      outcomes.push({ kind: 'sex_record', text: `性經歷：${[s.partners !== undefined ? `${s.partners} 位對象` : '', s.times !== undefined ? `${s.times} 次` : '', s.service_times !== undefined ? `其中 ${s.service_times} 次是服務` : ''].filter(Boolean).join('、')}` })
    }
    if (r.bridge) outcomes.push({ kind: 'bridge', text: `橋參數的起始值：${Object.entries(r.bridge).map(([p, n]) => `${BRIDGE_LABEL[p] ?? p} ${signed(n)}`).join('、')}` })
    return { table: c.table, name: TABLE_NAME[c.table], id: c.entry.id, text: textOf(c.entry, origin), outcomes }
  })
}
