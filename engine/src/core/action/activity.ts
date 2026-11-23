// L5 行動核心：活動的登錄表（dev/adr/0016 第一節）。
//
// 活動是一段獨佔的、要玩家一步一步做完的過程：戰鬥、等著選的戰敗、事件視窗、成人場景、委託副本。
// 每一種登記三件事：怎麼開始（start）、進行中放行什麼（allow）、結束時交回給發起的人（掛點 activity.end）。
//
// - 放行是白名單：進行中的每一個活動照 order 都要放行，第一個不放行的給原因。新功能忘了登記，結果是「在副本裡用不了」，
//   測試看得到；反過來做（黑名單）忘了登記就是漏洞。
// - doing 的寫法：chain:<鏈的 id>、commit:<報告的 action>、<kind>.start、battle.retry、rewind:<快照的種類>、grid.enter、grid.move。
//   報告的 action 一律是「功能的前綴.動詞」（event.choose、commission.face、trade.checkout）。
// - 核心只登記戰鬥與等著選的戰敗（coreActivities.ts）；其餘由功能 k.activity.define。

import type { Change, GameState, Launch, Origin, ReportDraft, ReportRewind } from '../types'
import type { ActivityEndReturn } from '../state/hooks'
import { guardHooks } from '../state/commit'
import type { Probe } from '../state/probe'
import type { StateKernel } from '../state/kernel'
import type { Kernel } from '../kernel'
import { clone } from '../util/clone'
import { isRecord } from '../util/sanitize'
import { ActionBlocked } from './action'

/** 一段進行中的活動（active 的回答）。 */
export interface ActivityInfo {
  id: string
  /** 給玩家看的一句話 */
  label: string
}

export interface ActivityDef {
  kind: string
  /** 誰登記的（core 或功能 id） */
  owner: string
  /**
   * 小的先問（越內層越小）：battle 0、defeat 10、scene 20、event 30、commission 90。
   * 同一個 order 照登記的順序。
   */
  order: number
  /** 進行中嗎：讀自己的狀態（唯讀）。是的話回傳這一段的 id 與一句話 */
  active(state: GameState): ActivityInfo | null
  /** 進行中放行的 doing 前綴（startsWith） */
  allow: string[]
  /** 前綴之外的特例（戰敗：帶 snapshot.drop 的報告） */
  allows?(state: GameState, doing: string, draft?: ReportDraft): boolean
  /** 擋下時給玩家看的完整句子 */
  reason(state: GameState, doing: string): string
  /** 開始：純函式，回傳要提交的報告草稿；開不成丟 ActionBlocked（原因寫成一條一句） */
  start?(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[]
}

/** 進行中的一段活動：kind 與 owner 是登錄的，id 與 label 是它自己回答的。 */
export interface ActiveActivity extends ActivityInfo {
  kind: string
  owner: string
}

export class ActivityRegistry {
  private defs = new Map<string, ActivityDef>()
  /** allow 加在還沒登記的活動上：先記著，登記時併進去（始終沒有人登記就當沒這回事） */
  private pending = new Map<string, Array<{ prefix: string; owner: string }>>()

  constructor(private probe: Probe) {}

  /**
   * 登記一種活動。同一個 kind 重複丟錯。先前對這個 kind 的 allow 併進放行的清單。
   * 存的是一份複製：同一個定義物件（測試用的）可以登記在好幾個核心上，彼此不影響。
   */
  define(def: ActivityDef): void {
    const old = this.defs.get(def.kind)
    if (old) throw new Error(`活動重複登記：${def.kind}（已經由 ${old.owner} 登記）`)
    const extra = this.pending.get(def.kind) ?? []
    this.pending.delete(def.kind)
    this.defs.set(def.kind, { ...def, allow: [...def.allow, ...extra.map((x) => x.prefix)] })
    this.probe.emit('core/action/activity', 'registry.register', { registry: 'activity', id: def.kind, owner: def.owner })
  }

  /** 把一個 doing 的前綴加進某個活動的放行清單（別的功能把自己的行動加進去）。那個活動還沒登記就先記著。 */
  allow(kind: string, prefix: string, owner: string): void {
    const def = this.defs.get(kind)
    if (def) def.allow.push(prefix)
    else this.pending.set(kind, [...(this.pending.get(kind) ?? []), { prefix, owner }])
    this.probe.emit('core/action/activity', 'registry.register', { registry: 'activity.allow', id: kind, owner, prefix })
  }

  get(kind: string): ActivityDef | undefined {
    return this.defs.get(kind)
  }

  /** 登記過的每一種，照 order。 */
  list(): ActivityDef[] {
    return [...this.defs.values()].sort((a, b) => a.order - b.order)
  }

  /** 現在進行中的活動，照 order（小的在前）。 */
  active(state: GameState): ActiveActivity[] {
    const out: ActiveActivity[] = []
    for (const def of this.list()) {
      const info = def.active(state)
      if (info) out.push({ kind: def.kind, owner: def.owner, id: info.id, label: info.label })
    }
    return out
  }

  /**
   * 現在這件事做不做得成：進行中的每一個活動照 order 都要放行，第一個不放行的給原因；都放行回傳 null。什麼都不改。
   * doing 的寫法見檔頭。
   */
  blockOf(state: GameState, doing: string, draft?: ReportDraft): string | null {
    for (const def of this.list()) {
      if (!def.active(state)) continue
      if (def.allow.some((prefix) => doing.startsWith(prefix))) continue
      if (def.allows?.(state, doing, draft)) continue
      return def.reason(state, doing)
    }
    return null
  }

  /**
   * 開一段活動：回傳它要提交的報告草稿（純函式）。沒有這種活動、或它不能從外面開始，丟 ActionBlocked（句子寫出是哪一種）；
   * 活動自己開不成也丟 ActionBlocked。沒給 origin 就是核心自己開的（by 是 core）。
   * 不問 blockOf：問放行是呼叫的人（Game）的事。
   */
  start(k: Kernel, state: GameState, kind: string, setup: unknown, origin?: Origin): ReportDraft[] {
    const def = this.defs.get(kind)
    if (!def) throw new ActionBlocked(`沒有「${kind}」這種活動，開不起來。`)
    if (!def.start) throw new ActionBlocked(`「${kind}」這種活動不能從外面開始。`)
    return def.start(k, state, setup, origin ?? { by: 'core' })
  }
}

// ---- 結束交回（掛點 activity.end） ----

/** 呼叫 activity.end 時帶的東西。 */
export interface ActivityEndPayload {
  /** 結束之前的狀態（唯讀） */
  state: GameState
  kind: string
  /** 這一段的 id（戰鬥是 b1、b2……） */
  id: string
  origin: Origin
  outcome: string
  result: Record<string, unknown>
}

/** 每個處理函式回傳的東西併成一份。 */
export interface ActivityEndMerged {
  changes: Change[]
  lines: string[]
  launch: Launch[]
  rewind?: ReportRewind
}

/**
 * 結束交回的共用函式：發 activity.end，把每個處理函式回傳的 changes、lines、launch 照順序接起來，rewind 只取第一個。
 * 活動的主人（戰鬥的結算、事件視窗、成人場景、委託副本）組「結束的那一份報告」時呼叫它：
 * changes 接在自己的變更後面、lines 進結果、launch 與 rewind 放到報告上。處理函式不可以改傳進去的狀態（嚴格模式會抓）。
 */
export function endActivity(k: StateKernel, payload: ActivityEndPayload): ActivityEndMerged {
  const merged: ActivityEndMerged = { changes: [], lines: [], launch: [] }
  const sent = { ...payload, origin: clone(payload.origin), result: clone(payload.result) }
  const results = guardHooks(k, payload.state, 'activity.end', () => k.hooks.run('activity.end', sent))
  for (const { owner, result } of results) {
    const bad = (what: string): never => {
      throw new Error(`activity.end（${payload.kind}）：${owner} 回傳的 ${what} 格式不對`)
    }
    const r: ActivityEndReturn = result
    if (!isRecord(r)) bad('結果')
    if (r.changes !== undefined) {
      if (!Array.isArray(r.changes) || r.changes.some((c) => !isRecord(c) || typeof c.op !== 'string')) bad('changes')
      merged.changes.push(...clone(r.changes!))
    }
    if (r.lines !== undefined) {
      if (!Array.isArray(r.lines) || r.lines.some((l) => typeof l !== 'string')) bad('lines')
      merged.lines.push(...r.lines!)
    }
    if (r.launch !== undefined) {
      if (!Array.isArray(r.launch) || r.launch.some((l) => !isRecord(l) || typeof l.kind !== 'string' || !l.kind)) bad('launch')
      merged.launch.push(...clone(r.launch!))
    }
    if (r.rewind !== undefined && !merged.rewind) {
      if (!isRecord(r.rewind) || typeof r.rewind.kind !== 'string' || typeof r.rewind.summary !== 'string') bad('rewind')
      merged.rewind = clone(r.rewind!)
    }
  }
  return merged
}

/** 把併好的結果放到結束那一份報告的草稿上：launch 與 rewind 放到報告上（changes 與 lines 由呼叫的人自己接）。 */
export function attachActivityEnd(draft: ReportDraft, merged: ActivityEndMerged): ReportDraft {
  if (merged.launch.length) draft.launch = [...(draft.launch ?? []), ...merged.launch]
  if (merged.rewind && !draft.rewind) draft.rewind = merged.rewind
  return draft
}
