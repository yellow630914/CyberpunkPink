// L6 功能 dive 的資料：活動與內容種類的名字、狀態 state.ext.dive 的形狀、格式檢查、讀狀態的函式。
// 規格：CYBERSPACE 2.1～2.4 節（兩種連線、接入點、誰能進、身體）、4.3 節（SKIN 在接入點換）；NETRUNNING 第 3 節；DATA 第 12 節（設施的種類）；dev/adr/0018 第八節與 N30。
//
// 內容種類：
//   net_site        網內去得了的地方，一筆一個：{ name, kind: 'netrun' | 'block', need: 'deck' | 'rental' | 'any', desc?, setup?, block?, marker?, when? }
//                   kind 是 netrun：setup 原樣交給活動 netrun（setup.by 寫了就是 launch 的 origin.by，讓別的功能接手；沒寫是 dive）；
//                   kind 是 block：用 move 效果把人放到街區 block 的標記 marker（沒有人登記 move 就灰掉）。
//   facility_type   （world 的）多讀的欄位 dive?: { fee?, rental?, deposit?, safe? }，functions 裡有 dive 的才讀。
// 狀態 state.ext.dive：{ since, body: { location, at? }, access: { facility?, type, safe, name? }, deck, paid?, over? }（沒有潛入是沒有這個鍵；只經由報告裡的 ext 變更寫）。
// 這個功能不 import 別的功能：甲板只問衍生數值 deck_grade、租用走效果 deck_rental、把人放到街區走效果 move、站在哪一種設施走條件 at_facility。

import type { Change, ContentEntry, GameState, ReportLocation } from '../../core'
import { clone, isRecord, isSafeInt } from '../../core'

export const OWNER = 'dive'
export const EXT = 'dive'
export const ACT = 'dive'
/** 自己去的那一趟用的活動（features/netrun）：只用名字，不 import。 */
export const ACT_NETRUN = 'netrun'
export const SITE_KIND = 'net_site'
export const FACILITY_TYPE_KIND = 'facility_type'
export const BLOCK_KIND = 'block'
export const DECK_KIND = 'deck'

export type DeckSource = 'own' | 'rental' | 'none'
export type Need = 'deck' | 'rental' | 'any'
export const NEEDS: readonly Need[] = ['deck', 'rental', 'any']
export type SiteKind = 'netrun' | 'block'
export const SITE_KINDS: readonly SiteKind[] = ['netrun', 'block']
export type OverKind = 'located' | 'defeat'

export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// ---- 內容 ----

export interface NetSiteEntry extends ContentEntry {
  name: string
  kind: SiteKind
  need: Need
  desc?: string
  setup?: Record<string, unknown>
  block?: string
  marker?: string
  when?: { kind: string; [field: string]: unknown }
}

/** 設施的種類多讀的欄位。 */
export interface DiveDef {
  /** 每次潛入付多少（現金） */
  fee?: number
  /** 沒有自己的甲板的人，這裡租給他的甲板（deck 的 id） */
  rental?: string
  /** 租用甲板的押金（現金；登出時退回，倒下與被定位時沒收）。只在真的租了的時候收 */
  deposit?: number
  /** 這個接入點安全到什麼程度（0～3；記在狀態上，之後身體出事的事件看它） */
  safe?: number
}

export function diveDefProblems(v: unknown): string[] {
  if (!isRecord(v)) return ['dive 要是 { fee?, rental?, deposit?, safe? }']
  const p: string[] = []
  for (const key of ['fee', 'deposit'] as const) if (v[key] !== undefined && !(isSafeInt(v[key]) && (v[key] as number) >= 0)) p.push(`dive.${key} 要是 0 以上的整數`)
  if (v.rental !== undefined && !isText(v.rental)) p.push('dive.rental 要是甲板的 id')
  if (v.safe !== undefined && !(isSafeInt(v.safe) && (v.safe as number) >= 0 && (v.safe as number) <= 3)) p.push('dive.safe 要是 0～3 的整數')
  for (const key of Object.keys(v)) if (!['fee', 'rental', 'deposit', 'safe'].includes(key)) p.push(`dive.${key} 不是這個欄位（fee、rental、deposit、safe）`)
  return p
}

export function netSiteProblems(e: Record<string, unknown>): string[] {
  const p: string[] = []
  if (!isText(e.name)) p.push('要有 name')
  if (!(SITE_KINDS as readonly unknown[]).includes(e.kind)) p.push(`kind 要是 ${SITE_KINDS.join(' 或 ')}`)
  if (!(NEEDS as readonly unknown[]).includes(e.need)) p.push(`need 要是 ${NEEDS.join('、')}（deck 只有自己的甲板能去、rental 租的也行、any 訪客也能去）`)
  if (e.desc !== undefined && !isText(e.desc)) p.push('desc 要是一句話')
  if (e.setup !== undefined && !isRecord(e.setup)) p.push('setup 要是一個物件')
  if (e.by !== undefined) p.push('by 寫在 setup 裡（setup.by）')
  if (e.kind === 'block') {
    if (!isText(e.block)) p.push('kind 是 block 的要有 block（街區的 id）')
    if (e.marker !== undefined && !isText(e.marker)) p.push('marker 要是街區上的標記 id')
    if (e.setup !== undefined) p.push('kind 是 block 的不用 setup')
  } else {
    if (e.block !== undefined || e.marker !== undefined) p.push('block、marker 只給 kind 是 block 的')
    if (isRecord(e.setup) && e.setup.by !== undefined && !isText(e.setup.by)) p.push('setup.by 要是功能的名字（字串）')
  }
  if (e.when !== undefined && !(isRecord(e.when) && isText(e.when.kind))) p.push('when 要是一個條件（{ kind, ... }）')
  return p
}

// ---- 狀態 ----

export interface DiveState {
  /** 潛入的時間（總分鐘） */
  since: number
  /** 身體在哪：潛入時的位置；at 是那一格設施的標記 id */
  body: { location: ReportLocation; at?: string }
  /** 從哪個接入點進來：facility 是標記 id、type 是設施的種類、safe 是安全程度、name 是給玩家看的名字 */
  access: { facility?: string; type: string; safe: number; name?: string }
  /** 用的是自己的甲板、租來的、還是沒有（訪客） */
  deck: DeckSource
  /** 付了什麼（費用不退；押金登出時退，沒收的不退） */
  paid?: { fee: number; deposit: number }
  /** 被強制斷線了（located：被定位；defeat：戰敗被接受）：等做完手上的事就自動登出，押金沒收 */
  over?: OverKind
}

/** 讀 state.ext.dive：沒有、或形狀不對（少了身體的位置、接入點）當成沒有潛入。回傳的是複製品。 */
export function readDive(state: Pick<GameState, 'ext'>): DiveState | null {
  const raw = state.ext[EXT]
  if (!isRecord(raw) || !isRecord(raw.body) || !isRecord(raw.body.location) || !isRecord(raw.access) || !isText(raw.access.type)) return null
  const a = raw.access
  const at = raw.body.at
  const paid = isRecord(raw.paid) && isSafeInt(raw.paid.fee) && isSafeInt(raw.paid.deposit) ? { fee: raw.paid.fee, deposit: raw.paid.deposit } : undefined
  return {
    since: isSafeInt(raw.since) && raw.since >= 0 ? raw.since : 0,
    body: { location: clone(raw.body.location) as ReportLocation, ...(isText(at) ? { at } : {}) },
    access: { ...(isText(a.facility) ? { facility: a.facility } : {}), type: String(a.type), safe: isSafeInt(a.safe) && a.safe >= 0 ? a.safe : 0, ...(isText(a.name) ? { name: a.name } : {}) },
    deck: raw.deck === 'own' || raw.deck === 'rental' ? raw.deck : 'none',
    ...(paid ? { paid } : {}),
    ...(raw.over === 'located' || raw.over === 'defeat' ? { over: raw.over } : {}),
  }
}

/** 寫狀態的變更（null 是清掉）。 */
export const diveChange = (d: DiveState | null): Change => ({ op: 'ext', key: EXT, value: d ? (clone(d) as unknown as Record<string, unknown>) : null })

/** 給玩家看的接入點的名字。 */
export const accessName = (d: DiveState): string => d.access.name ?? '接入點'
