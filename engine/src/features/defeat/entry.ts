// 戰敗的入口：不從戰鬥來的戰敗（dev/work/M5-defeat-entry.md；COMBAT_SYSTEM 8.3、8.4 節；dev/adr/0020「實作補記：M5-defeat-entry」）。
//
// 別的功能（第一個是輿論戰：被對手的人帶走）在報告上帶一個 launch，不必 import 戰敗：
//   { kind: 'defeat.entry', setup: DefeatEntrySetup, origin: <發起的人的 origin> }
// 這一種活動的 start（enterDefeat）照打輸之後同樣的規則抽事件與版本（choose.ts 的 pick 一字不改）、記下等待中的戰敗
// （state.ext.defeat，多一個 entry 欄位、battle 是合成的 id、沒有開打前的快照）、always 時同一步把事件視窗開起來（flow.ts 的 openPending，和戰鬥那一條共用）。
// 之後的流程全部是 flow.ts 現成的：看／跳過、事件做完、別的功能多給的選項、接受（發 activity.end kind defeat 交回 origin）；
// 重來與回到階段沒有戰鬥的快照，改走 retryDefeat、stageDefeat（回到發起的人指定的快照）。
// 等著三選一的期間由活動 defeat.entry 擋住別的事（核心的 defeat 是看戰鬥的快照，入口沒有）。
//
// 沒有任何可用的事件：當場當成「接受了結果」交回（不留等待中的戰敗；戰鬥那一條是什麼都不發生，入口是發起的人已經認定被帶走，不能讓這件事消失）。

import type { ActivityDef, GameState, Kernel, Launch, Origin, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, attachActivityEnd, clone, deriveRng, endActivity, isRecord } from '../../core'
import { pick } from './choose'
import { extChange, openPending, settleSkipped } from './flow'
import type { DefeatEntryInfo, PendingDefeat } from './model'
import { ENTRY_ACTIVITY, EVENT_ACTIVITY, STAGE_KIND, defeatOf } from './model'

/** 活動 defeat.entry 的 setup（launch 的 setup）。 */
export interface DefeatEntrySetup {
  /** 為什麼進戰敗：給 defeat.options 掛點、報告與畫面看的標籤（例：opinion_captured）；不影響抽哪一件 */
  reason: string
  /** 被帶走的人（角色 id）；沒給是主角。事件的效果仍以主角為對象，who 只用在報告那一拍與畫面 */
  who?: string
  /** 贏的那一方的勢力；沒給時用 foes 裡第一個有勢力的 */
  faction?: string
  /** 贏的那一方裡個別敵人（敵人內容的 id）：用它們資料裡寫的 defeat（字串或陣列） */
  foes?: string[]
  /** 發起的人自訂的戰敗事件；沒給就看 origin.ext.defeat_event（和戰鬥同一個慣例） */
  event?: string
  /** 在哪裡（地點的 id 或名字）：記下來，不影響抽哪一件 */
  where?: string
  /** 報告那一拍的開頭一句；沒給是「你被帶走了。」 */
  text?: string
  /** 只有沒有任何事件可演時才用（預設 true）；有事件就看事件自己的 fails_commission */
  fails_commission?: boolean
  /** 「重來這一場」回到哪一種快照；沒給就沒有「重來」 */
  retry?: string
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 壞的 setup：一條一句；沒問題是 null。 */
export function entryProblem(state: Pick<GameState, 'actors' | 'pc'>, raw: unknown): string | null {
  if (!isRecord(raw)) return '戰敗的入口要給一個設定物件（至少有 reason）。'
  if (!isText(raw.reason)) return '戰敗的入口要寫 reason（為什麼進戰敗，字串）。'
  for (const key of ['faction', 'event', 'where', 'text', 'retry'] as const) {
    if (raw[key] !== undefined && !isText(raw[key])) return `戰敗的入口的 ${key} 要是字串。`
  }
  if (raw.foes !== undefined && !(Array.isArray(raw.foes) && raw.foes.every(isText))) return '戰敗的入口的 foes 要是敵人 id 的陣列。'
  if (raw.fails_commission !== undefined && typeof raw.fails_commission !== 'boolean') return '戰敗的入口的 fails_commission 要是 true 或 false。'
  if (raw.who !== undefined && !isText(raw.who)) return '戰敗的入口的 who 要是角色的 id。'
  const who = (raw.who as string | undefined) ?? state.pc
  if (!who) return '戰敗的入口要有被帶走的人：沒給 who，也沒有主角。'
  if (!Object.hasOwn(state.actors, who)) return `被帶走的人「${who}」不在狀態裡。`
  return null
}

/** 這一次開活動的 launch（給呼叫的人用，不必知道活動的種類字串）。 */
export function defeatEntryLaunch(setup: DefeatEntrySetup, origin?: Origin): Launch {
  return { kind: ENTRY_ACTIVITY, setup: clone(setup) as unknown as Record<string, unknown>, ...(origin ? { origin: clone(origin) } : {}) }
}

/** 個別敵人寫的戰敗事件與第一個有勢力的敵人的勢力（和戰鬥的 winnersOf 讀同一個欄位）。 */
function foeData(k: Pick<Kernel, 'content'>, ids: readonly string[]): { defeats: string[]; faction?: string } {
  const defeats: string[] = []
  let faction: string | undefined
  if (!k.content.hasKind('enemy')) return { defeats }
  for (const id of ids) {
    const e = k.content.get('enemy', id)
    if (!e) continue
    const d = e.defeat
    if (typeof d === 'string') defeats.push(d)
    else if (Array.isArray(d)) defeats.push(...d.filter((x): x is string => typeof x === 'string'))
    if (faction === undefined && typeof e.faction === 'string') faction = e.faction
  }
  return { defeats, ...(faction !== undefined ? { faction } : {}) }
}

/** 發起的人自訂的戰敗事件（origin.ext.defeat_event）：和戰鬥的 originEventOf 同一個慣例。 */
const customOf = (origin: Origin): string | undefined => {
  const e = origin.ext?.defeat_event
  return typeof e === 'string' && e ? e : undefined
}

/**
 * 進戰敗（活動 defeat.entry 的 start；純函式）：回傳 defeat.pending 的報告草稿（always 時帶 launch 開事件視窗），
 * 沒有任何可用的事件時回傳 defeat.accept（當場交回，見檔頭）。setup 壞了、已經有一場戰敗在等、正在戰鬥，丟 ActionBlocked。
 */
export function enterDefeat(k: Kernel, state: GameState, raw: unknown, origin: Origin): ReportDraft {
  const bad = entryProblem(state, raw)
  if (bad) throw new ActionBlocked(bad)
  if (state.battle) throw new ActionBlocked('正在戰鬥，這一場打完才進得了戰敗。')
  if (defeatOf(state)) throw new ActionBlocked('已經有一場戰敗在等了，先把它處理完。')
  const s = raw as DefeatEntrySetup
  const who = s.who ?? state.pc!
  const id = `entry:${s.reason}:${state.reports.length}`
  const foes = foeData(k, s.foes ?? [])
  const faction = s.faction ?? foes.faction
  const event = s.event ?? customOf(origin)
  const roll = deriveRng(state.rng, `defeat/${id}`).next()
  const info: DefeatEntryInfo = { reason: s.reason, who, ...(s.where !== undefined ? { where: s.where } : {}), ...(s.retry !== undefined ? { retry: s.retry } : {}) }
  const beat: TimelineBeat = {
    layer: 'meat', actor: who, text: s.text ?? (who === state.pc ? '你被帶走了。' : `${state.actors[who]!.name}被帶走了。`), tag: 'defeat.entry',
    data: { reason: s.reason, who, ...(faction !== undefined ? { faction } : {}), ...(s.where !== undefined ? { where: s.where } : {}) },
  }

  const r = pick(k, state, { roll, ...(faction !== undefined ? { faction } : {}), ...(event !== undefined ? { event } : {}), enemies: foes.defeats })
  if (!r) return acceptedAtOnce(k, state, id, origin, info, s.fails_commission ?? true, beat)

  const settled = settleSkipped(k, state, r.entry, r.version, id, false)
  const view = state.rules.defeatView
  // 種類 stage（簾後館的落幕）與戰鬥那一條一樣：事件視窗不開，內文與效果走「不演」的結算
  const skipped = !k.activity.get(EVENT_ACTIVITY) || view === 'never' || r.entry.kind === STAGE_KIND
  const pending: PendingDefeat = {
    event: r.entry.id, version: r.version, ...(faction !== undefined ? { faction } : {}), outcome: 'lose',
    fails_commission: r.entry.fails_commission, lines: settled.errors.length > 0 ? [] : [...settled.lines, ...settled.notes], choices: ['accept', 'retry', 'stage'],
    view, skipped, battle: id, stage: skipped ? 'played' : 'ask', tier: r.tier, origin: clone(origin), entry: info,
  }
  const { out, next } = openPending(k, state, pending)
  out.changes.push(extChange(next))
  out.timeline = [beat]
  return out
}

/** 沒有任何可用的事件：當場當成接受了結果，發 activity.end（kind defeat、outcome accept），發起的人照常處理；不留等待中的戰敗。 */
function acceptedAtOnce(k: Kernel, state: GameState, id: string, origin: Origin, info: DefeatEntryInfo, fails: boolean, beat: TimelineBeat): ReportDraft {
  const end = endActivity(k, {
    state, kind: 'defeat', id, origin: clone(origin), outcome: 'accept',
    result: { battle: id, event: null, kind: 'generic', version: 'default', fails_commission: fails, option: 'none', entry: { reason: info.reason, who: info.who, ...(info.where !== undefined ? { where: info.where } : {}) } },
  })
  const out: ReportDraft = {
    kind: 'event', action: 'defeat.accept', location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [], timeline: [beat],
    changes: [...end.changes],
    outcome: { result: 'accepted', summary: fails ? '沒有對得上的戰敗事件，直接當成接受了結果。這一趟的委託算失敗。' : '沒有對得上的戰敗事件，直接當成接受了結果。這一趟的委託還在。' },
    narration: { results: end.lines },
  }
  return attachActivityEnd(out, end)
}

/** 活動 defeat.entry：等著三選一的期間進行中（等待中的戰敗有 entry、而且現在沒有戰鬥；事件帶出來的戰鬥開著時由戰鬥自己擋）。 */
export const entryActivity: ActivityDef = {
  kind: ENTRY_ACTIVITY, owner: 'defeat', order: 10,
  active: (state) => {
    if (state.battle) return null
    const p = defeatOf(state)
    return p?.entry ? { id: p.battle, label: '戰敗的三個選擇' } : null
  },
  // 放行的清單由 index.ts 加（和核心的 defeat 同一組：commit:defeat.、事件視窗、場景、事件帶出來的戰鬥）
  allow: [],
  reason: () => '先在戰敗的三個選擇裡選一個：接受結果、重來這一場，或回到這個階段開始時。',
  start: (k, state, setup, origin) => [enterDefeat(k as Kernel, state, setup, origin)],
}
