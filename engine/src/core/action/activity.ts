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
// - deny 是另一條線（dev/adr/0020 第三節；M5-core-seams）：活動進行中時，外殼自己的動作（SHELL_ACTS：現在只有回退步數 'undo'）不准做。
//   它不看、也不改放行的白名單（allow、allowWhen、allows、allowEverywhere），只管外殼自己的入口（Game.undoSteps 先問 k.activity.denied）。

import type { Change, GameState, Launch, Origin, ReportDraft, ReportRewind } from '../types'
import { guardHooks } from '../state/commit'
import type { Probe } from '../state/probe'
import type { StateKernel } from '../state/kernel'
import type { Kernel } from '../kernel'
import { clone } from '../util/clone'
import { isRecord } from '../util/sanitize'
import { ActionBlocked } from './action'

/**
 * 外殼自己的動作（不是報告、不是活動的步驟）：活動的 deny 只能寫這張表裡的字，寫了別的 define 丟錯。之後要加再加。
 * - undo：回退步數（Game.undoSteps；問的是 k.activity.denied(state, 'undo')）。讀檔、回到快照、重試最新一樓各有自己的 doing，不歸 deny 管。
 */
export const SHELL_ACTS = ['undo'] as const
export type ShellAct = (typeof SHELL_ACTS)[number]

/** 一段進行中的活動（active 的回答）。 */
export interface ActivityInfo {
  id: string
  /** 給玩家看的一句話 */
  label: string
}

/**
 * 帶條件的放行：前綴符合、而且這個函式回答 true 才放行（k.activity.allow 的第四個參數）。
 * launch 只有「開一段活動」（報告的 launch、Game.launch、Game.startBattle）才有，是那一次要開的活動；一般的提交與任務鏈沒有。
 * 要分辨「戰敗自己開的事件」與「玩家自己要開戰」這類事就看它的 origin。
 */
export type AllowWhen = (state: GameState, doing: string, draft?: ReportDraft, launch?: Launch) => boolean

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
  /** 進行中放行的 doing 前綴，加上條件（別的功能用 k.activity.allow 的第四個參數加進來；登記時可以是空的） */
  allowWhen?: Array<{ prefix: string; when: AllowWhen }>
  /** 前綴之外的特例（戰敗：帶 snapshot.drop 的報告）。launch 見 AllowWhen */
  allows?(state: GameState, doing: string, draft?: ReportDraft, launch?: Launch): boolean
  /**
   * 進行中時主角的橋是關著的（斷線靜修）：技能失效、橋的容量是 0、無線功能關閉（DOWNTIME 3.3 節；使用者 2026-11-26）。
   * 讀它的功能問 `k.activity.bridgeClosed(state)`，不必知道是哪一種活動關的。沒寫是不關。
   */
  bridgeOff?: boolean
  /**
   * 進行中時不准做的外殼動作（SHELL_ACTS：現在只有 'undo'，直播不回退）。寫了清單以外的字，define 丟錯。沒寫是不擋任何外殼動作。
   * 和放行的白名單是兩條線：deny 不看也不改 allow、allowWhen、allows、allowEverywhere；`blockOf` 對 doing 的回答不受它影響。
   * 擋下時問 reason，第二個參數是外殼動作的名字（例：'undo'），不是 doing。
   */
  deny?: string[]
  /** 擋下時給玩家看的完整句子（doing 是被擋的那件事；deny 擋下外殼動作時是動作的名字，例：'undo'） */
  reason(state: GameState, doing: string): string
  /** 開始：純函式，回傳要提交的報告草稿；開不成丟 ActionBlocked（原因寫成一條一句） */
  start?(k: Kernel, state: GameState, setup: unknown, origin: Origin): ReportDraft[]
}

/** 進行中的一段活動：kind 與 owner 是登錄的，id 與 label 是它自己回答的。 */
export interface ActiveActivity extends ActivityInfo {
  kind: string
  owner: string
}

/** deny 的格式檢查：要是一份只含 SHELL_ACTS 裡的字的陣列。沒問題回傳 null。 */
function denyProblems(def: ActivityDef): string | null {
  if (def.deny === undefined) return null
  const at = `活動 ${def.kind}（${def.owner}）的 deny`
  if (!Array.isArray(def.deny)) return `${at} 要是外殼動作的陣列（${SHELL_ACTS.join('、')}）`
  const bad = def.deny.filter((x) => !(SHELL_ACTS as readonly unknown[]).includes(x))
  return bad.length ? `${at} 只能寫外殼的動作（${SHELL_ACTS.join('、')}），拿到 ${bad.map((x) => JSON.stringify(x)).join('、')}` : null
}

export class ActivityRegistry {
  private defs = new Map<string, ActivityDef>()
  /** allow 加在還沒登記的活動上：先記著，登記時併進去（始終沒有人登記就當沒這回事） */
  private pending = new Map<string, Array<{ prefix: string; owner: string; when?: AllowWhen }>>()
  /** 每一種活動（包含之後才登記的）都放行的前綴：except 列出不放行的活動（allowEverywhere） */
  private everywhere: Array<{ prefix: string; owner: string; except: readonly string[] }> = []

  constructor(private probe: Probe) {}

  /**
   * 登記一種活動。同一個 kind 重複丟錯。先前對這個 kind 的 allow 併進放行的清單。
   * 存的是一份複製：同一個定義物件（測試用的）可以登記在好幾個核心上，彼此不影響。
   */
  define(def: ActivityDef): void {
    const old = this.defs.get(def.kind)
    if (old) throw new Error(`活動重複登記：${def.kind}（已經由 ${old.owner} 登記）`)
    const denyBad = denyProblems(def)
    if (denyBad) throw new Error(denyBad)
    const extra = this.pending.get(def.kind) ?? []
    this.pending.delete(def.kind)
    this.defs.set(def.kind, {
      ...def,
      allow: [...def.allow, ...extra.filter((x) => !x.when).map((x) => x.prefix), ...this.everywhere.filter((e) => !e.except.includes(def.kind)).map((e) => e.prefix)],
      allowWhen: [...(def.allowWhen ?? []), ...extra.flatMap((x) => (x.when ? [{ prefix: x.prefix, when: x.when }] : []))],
      ...(def.deny ? { deny: [...def.deny] } : {}),
    })
    this.probe.emit('core/action/activity', 'registry.register', { registry: 'activity', id: def.kind, owner: def.owner, ...(def.deny?.length ? { deny: [...def.deny] } : {}) })
  }

  /**
   * 把一個 doing 的前綴加進某個活動的放行清單（別的功能把自己的行動加進去）。那個活動還沒登記就先記著。
   * when（可以沒有）：帶條件的放行，前綴符合而且 when 回答 true 才放行（例：戰敗只在事件視窗開著時放行自由行動）。
   * when 是唯讀的觀察者：不可以改狀態。
   */
  allow(kind: string, prefix: string, owner: string, when?: AllowWhen): void {
    const def = this.defs.get(kind)
    if (def) {
      if (when) (def.allowWhen ??= []).push({ prefix, when })
      else def.allow.push(prefix)
    } else this.pending.set(kind, [...(this.pending.get(kind) ?? []), { prefix, owner, ...(when ? { when } : {}) }])
    this.probe.emit('core/action/activity', 'registry.register', { registry: 'activity.allow', id: kind, owner, prefix, ...(when ? { conditional: true } : {}) })
  }

  /**
   * 把一個 doing 的前綴加進「每一種活動」的放行清單：現在登記了的、和之後才登記的都算（例：契約的回話在任何活動裡都能做）。
   * except 是不放行的活動（核心規定戰鬥與等著選的戰敗只收自己的事，例：['battle', 'defeat']）。
   */
  allowEverywhere(prefix: string, owner: string, except: readonly string[] = []): void {
    this.everywhere.push({ prefix, owner, except })
    for (const def of this.defs.values()) if (!except.includes(def.kind) && !def.allow.includes(prefix)) def.allow.push(prefix)
    this.probe.emit('core/action/activity', 'registry.register', { registry: 'activity.allow', id: '*', owner, prefix })
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

  /** 主角的橋現在是關著的嗎：進行中的活動有哪一種標了 bridgeOff（斷線靜修）。 */
  bridgeClosed(state: GameState): boolean {
    for (const def of this.defs.values()) if (def.bridgeOff === true && def.active(state)) return true
    return false
  }

  private lets(def: ActivityDef, state: GameState, doing: string, draft?: ReportDraft, launch?: Launch): boolean {
    if (def.allow.some((prefix) => doing.startsWith(prefix))) return true
    if ((def.allowWhen ?? []).some((a) => doing.startsWith(a.prefix) && a.when(state, doing, draft, launch))) return true
    return !!def.allows?.(state, doing, draft, launch)
  }

  /**
   * 現在這件事做不做得成：進行中的每一個活動照 order 都要放行，第一個不放行的給原因；都放行回傳 null。什麼都不改。
   * doing 的寫法見檔頭。launch：這一次是開一段活動時，要開的是哪一段（見 AllowWhen）。
   */
  blockOf(state: GameState, doing: string, draft?: ReportDraft, launch?: Launch): string | null {
    for (const def of this.list()) {
      if (!def.active(state)) continue
      if (this.lets(def, state, doing, draft, launch)) continue
      return def.reason(state, doing)
    }
    return null
  }

  /**
   * 現在能不能做外殼自己的動作（SHELL_ACTS；deny）：照 order 找第一個「進行中、而且 deny 含這個動作」的活動，回它的 reason(state, act)
   * （給玩家看的完整句子）；沒有就是 null。什麼都不改。表外的動作沒有活動能寫進 deny，所以一律是 null。
   * 外層與內層同時進行中時，order 小的那個有寫 deny 就用它的原因；只有外層寫了也照樣擋（內層沒寫不影響）。
   */
  denied(state: GameState, act: string): string | null {
    for (const def of this.list()) {
      if (!def.deny?.includes(act) || !def.active(state)) continue
      return def.reason(state, act)
    }
    return null
  }

  /**
   * 這一種活動放不放行這件事：沒有登記、或現在沒有進行中的，當成放行（沒有擋住誰）。
   * 問「在這個活動進行中，還能不能開某件事」用（導演：車上還能不能跳出擋住型的事件）；blockOf 的逐個活動版。
   */
  permits(state: GameState, kind: string, doing: string, draft?: ReportDraft, launch?: Launch): boolean {
    const def = this.defs.get(kind)
    if (!def || !def.active(state)) return true
    return this.lets(def, state, doing, draft, launch)
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
    const bad = (what: string): Error => new Error(`activity.end（${payload.kind}）：${owner} 回傳的 ${what} 格式不對`)
    const r = result as unknown
    if (!isRecord(r)) throw bad('結果')
    if (r.changes !== undefined) {
      if (!Array.isArray(r.changes) || r.changes.some((c) => !isRecord(c) || typeof c.op !== 'string')) throw bad('changes')
      merged.changes.push(...(clone(r.changes) as Change[]))
    }
    if (r.lines !== undefined) {
      if (!Array.isArray(r.lines) || r.lines.some((l) => typeof l !== 'string')) throw bad('lines')
      merged.lines.push(...(r.lines as string[]))
    }
    if (r.launch !== undefined) {
      if (!Array.isArray(r.launch) || r.launch.some((l) => !isRecord(l) || typeof l.kind !== 'string' || !l.kind)) throw bad('launch')
      merged.launch.push(...(clone(r.launch) as Launch[]))
    }
    if (r.rewind !== undefined && !merged.rewind) {
      if (!isRecord(r.rewind) || typeof r.rewind.kind !== 'string' || typeof r.rewind.summary !== 'string' || (r.rewind.fresh !== undefined && typeof r.rewind.fresh !== 'boolean')) throw bad('rewind')
      merged.rewind = clone(r.rewind) as unknown as ReportRewind
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
