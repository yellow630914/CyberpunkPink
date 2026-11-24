// 戰敗的流程（COMBAT_SYSTEM 8.3～8.5 節；ENEMIES 第 6 節；AI_TASKS 3.14 節只看流程；UI 4.1 節；dev/work/M2-defeat.md）：
//
//   打輸或投降 → 選一件事件與版本（choose.ts）→ 等待中的戰敗（state.ext.defeat）
//     演不演：always 直接開事件視窗；skippable 先問；never 不演。別的功能經 defeat.options 多給了選項（被贖回）時，不論哪一檔都先問。
//     演：把選到的那一版組成內嵌的事件（先照存檔規則改寫效果；body.ts），用報告的 launch 開（origin.by 是 defeat），
//         事件做完（activity.end）記下選了什麼與算不算委託失敗。
//     不演：每一段走第一個選項、有檢定的照擲，改寫之後一次結算（接受的時候）。
//   事件做完或跳過之後才可以三選一；重來與回到階段照舊（事件造成的改變跟著快照回去）。
//   接受 ＝ 一份帶 snapshot.drop 的 defeat.accept，組這一份時發 activity.end（kind defeat），回傳的變更、launch、rewind 併進去。
//
// 報告：defeat.pending（戰敗的開頭）、defeat.view（選了要看）、defeat.skip（選了不看）、defeat.accept、defeat.option。
// 沒有事件視窗可用（沒有人登記活動 event）時照 M1：只列出結果，一律是不演。

import type { ActivityEndReturn, Change, Effect, GameState, Kernel, Launch, Origin, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, attachActivityEnd, clone, deriveRng, effectCtx, endActivity, isRecord, modeOf, originOfBattle } from '../../core'
import type { BattleState } from '../../core'
import { inlineEvent, playSkipped, rewriteEffects } from './body'
import type { Rewrite } from './body'
import { locatedEventOf, locatedOf, originEventOf, pick, winnersOf } from './choose'
import type { DefeatEventEntry, DefeatOption, DefeatStage, PendingDefeat, PlayedResult } from './model'
import { EVENT_ACTIVITY, EXT, KIND, OWNER, defeatOf, moneyLimit, stageOf } from './model'

// ---- 掛點（兩邊不互相 import：型別用 declare module 補在核心的掛點表上） ----

declare module '../../core' {
  interface HookMap {
    /** 戰敗在等玩家選的時候問一次：別的功能回傳它要多給的選項（保釋：被贖回） */
    'defeat.options': [{ state: GameState; pending: PendingDefeat }, DefeatOption[] | void]
    /**
     * 這一筆效果是不是拿走身上的裝備或義體（COMBAT_SYSTEM 8.3 節：被拆、被改的事件）。存檔規則「戰敗時拿走義體與裝備」關著時，
     * 回答 true 的效果從事件裡拿掉，其餘照常。誰註冊了這種效果誰回答（義體與裝備的功能）；沒有人回答就都不是。
     */
    'defeat.gear': [{ effect: Effect }, boolean | void]
    /** 同行的人（跟著主角一起被處置，NPC_SYSTEM 10.0）：回傳角色的 id。名冊回答；沒有人回答就沒有同行的。 */
    'defeat.companions': [{ state: GameState; pending: PendingDefeat }, string[] | void]
  }
}

const DROP: Change = { op: 'snapshot.drop', kind: 'battle' }
const extChange = (value: PendingDefeat | null): Change => ({ op: 'ext', key: EXT, value: value as unknown as Record<string, unknown> | null })

// ---- 存檔規則的改寫 ----

export function rewriteOf(k: Pick<Kernel, 'hooks'>, state: Pick<GameState, 'money' | 'rules'>): Rewrite {
  return {
    money: moneyLimit(state),
    gear: state.rules.defeatTakeGear ? null : (effect) => k.hooks.run('defeat.gear', { effect }).some((r) => r.result === true),
  }
}

// ---- 不演版的結算 ----

interface Settled {
  changes: Change[]
  lines: string[]
  timeline: TimelineBeat[]
  /** 事件的選項帶的旗標（不演的那一條路） */
  flags: string[]
  notes: string[]
  errors: string[]
}

/** 不演版：每一段走第一個選項，改寫之後一次結算。roll 是 false 時只做預覽（有檢定的不擲）。 */
function settleSkipped(k: Kernel, state: GameState, entry: DefeatEventEntry, version: string, battle: string, roll: boolean): Settled {
  const play = playSkipped(k, state, entry, version, { roll, purpose: `defeat/${battle}/skip` })
  if (typeof play === 'string') return { changes: [], lines: [], timeline: [], flags: [], notes: [], errors: [`戰敗事件 ${entry.id} 的內文解不開：${play}`] }
  const res = k.effects.resolve(rewriteEffects(play.effects, rewriteOf(k, state)), effectCtx(k, state, { source: 'builtin' }))
  const changes = [...res.changes, ...(play.rolls > 0 ? [{ op: 'rng', advance: 1 } as Change] : [])]
  return { changes, lines: res.lines, timeline: play.timeline, flags: play.flags, notes: play.notes, errors: res.errors }
}

/** 旗標蓋掉算不算委託失敗：照順序，no_fail 是不算、fail 是算。 */
export function failsAfter(base: boolean, flags: readonly string[]): boolean {
  let fails = base
  for (const f of flags) {
    if (f === 'no_fail') fails = false
    else if (f === 'fail') fails = true
  }
  return fails
}

// ---- 內海的戰敗 ----

/**
 * 這一場輸掉之後，我方有人被扣線了沒有（內海；netcombat 在分出結果的那一刻標：單位的 ext.net.tethered，並記一拍 tag tether、data.tethered）。
 * 只有打輸算（投降不扣線，N12）；兩個來源都認：單位上的標記，與這一場的紀錄裡 data.tethered 為 true 的那一拍。
 */
function tetheredOf(state: GameState, battle: BattleState, outcome: string): boolean {
  if (outcome !== 'lose') return false
  const marked = Object.values(battle.units).some((u) => u.side === 'ally' && isRecord(u.ext.net) && u.ext.net.tethered === true)
  if (marked) return true
  const steps = new Set(battle.steps)
  return state.reports.some((r) => steps.has(r.id) && r.timeline.some((b) => b.tag === 'tether' && isRecord(b.data) && b.data.tethered === true))
}

// ---- 打輸的那一刻：選事件，記下等待中的戰敗 ----

/** 戰鬥結束的處理（k.battle.onEnd）：全隊倒下或投降時，選一件事件與版本，寫下等待中的戰敗。 */
export function onBattleEnd(k: Kernel, state: GameState, battle: BattleState, outcome: string): { changes: Change[] } | undefined {
  if (outcome !== 'lose' && outcome !== 'surrender') {
    // 戰敗的事件裡的 fight（劫囚之類）打贏或脫離了：那一場戰敗已經被取代（新的戰鬥開打時把它開打前的快照丟掉了），等待中的紀錄不留
    const old = defeatOf(state)
    return old && old.battle !== battle.id ? { changes: [extChange(null)] } : undefined
  }
  const roll = deriveRng(state.rng, `defeat/${battle.id}`).next()
  const w = winnersOf(k, battle)
  const net = modeOf(k.content, battle.mode)?.layer === 'net'
  const located = net && locatedOf(battle)
  const tethered = net && tetheredOf(state, battle, outcome)
  // 被定位：用目標勢力（場地的 origin.faction）的現實預設；沒寫就看贏的那一方
  const faction = located ? (battle.origin.faction ?? w.faction) : w.faction
  const event = originEventOf(battle)
  const locatedEvent = located ? locatedEventOf(battle) : undefined
  const r = pick(k, state, {
    roll, ...(faction !== undefined ? { faction } : {}), ...(event !== undefined ? { event } : {}), enemies: w.enemies,
    ...(located ? { located: true } : {}), ...(locatedEvent !== undefined ? { locatedEvent } : {}),
  })
  // 沒有任何可用的戰敗事件：沒有後果可以接受，這一場就這樣定案——不留等待中的戰敗，開打前的快照也丟掉
  // （核心在打輸時把它留著等玩家三選一；留著而沒有人接受，之後什麼事都做不了）
  if (!r) return { changes: [{ op: 'snapshot.drop', kind: 'battle' }] }
  const s = settleSkipped(k, state, r.entry, r.version, battle.id, false)
  const view = state.rules.defeatView
  const skipped = !k.activity.get(EVENT_ACTIVITY) || view === 'never'
  const value: PendingDefeat = {
    event: r.entry.id, version: r.version, ...(faction !== undefined ? { faction } : {}), outcome,
    fails_commission: r.entry.fails_commission, lines: s.errors.length > 0 ? [] : [...s.lines, ...s.notes], choices: ['accept', 'retry', 'stage'],
    view, skipped, battle: battle.id, stage: skipped ? 'played' : 'ask', tier: r.tier, origin: originOfBattle(battle.origin.ext),
    ...(net ? { net: true, tethered, located } : {}),
  }
  return { changes: [extChange(value)] }
}

// ---- 開事件視窗 ----

interface Launched {
  launch: Launch
}

/** 組出要開的事件並先試一次（純函式、不改狀態）：開得成回傳 launch，開不成回傳原因（句子）。 */
function tryLaunch(k: Kernel, state: GameState, pending: PendingDefeat): Launched | { why: string } {
  const entry = k.content.get<DefeatEventEntry>(KIND, pending.event)
  if (!entry) return { why: `戰敗事件 ${pending.event} 不在內容裡` }
  const origin: Origin = { by: OWNER, ref: pending.battle, ext: { event: pending.event } }
  const setup = { inline: inlineEvent(entry, pending.version, rewriteOf(k, state)), version: pending.version }
  try {
    k.activity.start(k, state, EVENT_ACTIVITY, clone(setup), clone(origin))
  } catch (e) {
    if (e instanceof ActionBlocked) return { why: e.reason }
    throw e
  }
  return { launch: { kind: EVENT_ACTIVITY, setup, origin } }
}

const draft = (state: GameState, action: string, summary: string, result: string, changes: Change[], more: Partial<ReportDraft> = {}): ReportDraft => ({
  kind: 'event', action, location: clone(state.location), party: [], timeline: [], changes, outcome: { result, summary }, ...more,
})

/**
 * 打輸的報告（battle.end）之後接著提交的報告：defeat.pending（敘事加上接受的話會發生什麼）。
 * always 而且沒有別的選項時，同一份帶 launch：事件視窗自己開起來；開不起來就改成只列出結果（不能讓這一步整個回滾）。
 */
export function afterBattleEnd(k: Kernel, state: GameState): ReportDraft | undefined {
  const pending = defeatOf(state)
  if (!pending) return undefined
  const entry = k.content.get<DefeatEventEntry>(KIND, pending.event)
  const v = entry?.versions[pending.version] ?? entry?.versions.default
  let lines = pending.lines
  const out = draft(state, 'defeat.pending', v?.text ?? '你輸了。', 'defeat', [], { narration: { results: lines } })
  if (!pending.skipped && stageOf(pending) === 'ask' && pending.view === 'always' && defeatOptions(k, state).length === 0) {
    const t = tryLaunch(k, state, pending)
    if ('launch' in t) {
      out.changes.push(extChange({ ...pending, stage: 'playing' }))
      out.launch = [t.launch]
    } else {
      lines = [...lines, `戰敗事件開不起來（${t.why}），這一次只列出結果。`]
      out.changes.push(extChange({ ...pending, skipped: true, stage: 'played', lines }))
      out.narration = { results: lines }
    }
  }
  return out
}

/** 選了要看戰敗事件（先問的時候）：事件視窗開起來。 */
export function watchDefeat(k: Kernel, state: GameState): ReportDraft {
  const pending = defeatOf(state)
  if (!pending) throw new Error('沒有等待中的戰敗。')
  if (pending.skipped) throw new ActionBlocked('這一次不演戰敗事件（存檔規則設成不看，或事件演不了），只列出結果。')
  if (stageOf(pending) !== 'ask') throw new ActionBlocked(stageOf(pending) === 'playing' ? '戰敗事件已經在演了。' : '戰敗事件已經看過了。')
  const t = tryLaunch(k, state, pending)
  if (!('launch' in t)) throw new ActionBlocked(`戰敗事件開不起來：${t.why}。`)
  return draft(state, 'defeat.view', '你選擇看完戰敗事件。', 'view', [extChange({ ...pending, stage: 'playing' })], { launch: [t.launch] })
}

/** 選了不看戰敗事件（存檔規則是「可以跳過」時）：照「不演」結算，等玩家三選一。 */
export function skipDefeat(_k: Kernel, state: GameState): ReportDraft {
  const pending = defeatOf(state)
  if (!pending) throw new Error('沒有等待中的戰敗。')
  if (pending.view !== 'skippable') throw new ActionBlocked(pending.view === 'always' ? '存檔規則設成一律要看戰敗事件。' : '存檔規則設成不看戰敗事件，這一次本來就只列出結果。')
  if (pending.skipped || stageOf(pending) !== 'ask') throw new ActionBlocked('現在不用決定要不要看戰敗事件。')
  return draft(state, 'defeat.skip', '你選擇不看戰敗事件，直接看結果。', 'skip', [extChange({ ...pending, skipped: true, stage: 'played' })], { narration: { results: pending.lines } })
}

// ---- 事件做完：記下選了什麼與算不算委託失敗 ----

/**
 * 事件視窗做完（掛點 activity.end，kind event）：origin.by 是 defeat 的是我們開的那一件；
 * origin.by 是 director、origin.ext.caller 是 defeat 的是它 chain 帶出來的第二件（事件視窗不會把第二件交回原本的人，所以這裡認它）。
 */
export function onEventEnd(state: GameState, origin: Origin, result: Record<string, unknown>): ActivityEndReturn | undefined {
  const mine = origin.by === OWNER
  const chained = origin.by === 'director' && origin.ext?.caller === OWNER
  if (!mine && !chained) return undefined
  const pending = defeatOf(state)
  const ref = mine ? origin.ref : origin.ext?.caller_ref
  if (!pending || ref !== pending.battle) return undefined
  const flags = Array.isArray(result.flags) ? result.flags.filter((f): f is string => typeof f === 'string') : []
  const option = typeof result.option === 'string' ? result.option : 'done'
  const played: PlayedResult = mine
    ? { option, flags, ...(typeof result.degree === 'string' ? { degree: result.degree } : {}) }
    : { option: pending.played?.option ?? option, flags: [...(pending.played?.flags ?? []), ...flags], ...(pending.played?.degree !== undefined ? { degree: pending.played.degree } : {}), chained: option }
  const next: PendingDefeat = { ...pending, stage: 'played', fails_commission: failsAfter(pending.fails_commission, flags), played }
  return { changes: [extChange(next)] }
}

// ---- 別的功能多給的選項 ----

/** 等待中的戰敗現在多出來哪些選項（接受、重來、回到這個階段開始時以外的）；沒有等待中的戰敗、或事件已經真的演過了（它的效果已經發生）是空的。 */
export function defeatOptions(k: Pick<Kernel, 'hooks'>, state: GameState): DefeatOption[] {
  const pending = defeatOf(state)
  if (!pending) return []
  if (pending.played && !pending.skipped) return []
  return k.hooks.run('defeat.options', { state, pending }).flatMap((r) => r.result)
}

const dropDraft = (): ReportDraft => ({ changes: [DROP] }) as unknown as ReportDraft

/** 同行的人的名字（掛點 defeat.companions 回答）。 */
export function companionNames(k: Pick<Kernel, 'hooks'>, state: GameState, pending: PendingDefeat): string[] {
  const ids = [...new Set(k.hooks.run('defeat.companions', { state, pending }).flatMap((r) => r.result))]
  return ids.map((id) => state.actors[id]?.name ?? id)
}

/** 同行的人寫進結果的一行（他們跟著主角一起被處置）。 */
function companionLine(k: Pick<Kernel, 'hooks'>, state: GameState, pending: PendingDefeat): string[] {
  const names = companionNames(k, state, pending)
  return names.length > 0 ? [`同行的${names.join('、')}跟著你一起被處置。`] : []
}

/** 現在接受的話被什麼擋著（完整的句子）；可以接受是 null。 */
function acceptBlock(k: Kernel, state: GameState, pending: PendingDefeat): string | null {
  if (stageOf(pending) === 'ask' && !pending.skipped) return pending.view === 'skippable' ? '先決定要不要看戰敗事件。' : '戰敗事件要先看完，才能接受結果。'
  return k.activity.blockOf(state, 'commit:defeat.accept', dropDraft())
}

/** 選多出來的一個選項：套它的變更、跳過事件的內容，戰敗就這樣結算。選項不存在或現在選不了，丟錯（訊息是原因）。 */
export function chooseDefeatOption(k: Kernel, state: GameState, id: string): ReportDraft {
  const pending = defeatOf(state)
  if (!pending) throw new Error('沒有等待中的戰敗。')
  const option = defeatOptions(k, state).find((o) => o.id === id)
  if (!option) throw new Error(`戰敗現在沒有「${id}」這個選項。`)
  if (option.blocks.length) throw new Error(option.blocks.join(''))
  const block = k.activity.blockOf(state, 'commit:defeat.option', dropDraft())
  if (block) throw new ActionBlocked(block)
  const end = endActivity(k, {
    state, kind: 'defeat', id: pending.battle, origin: pending.origin ?? { by: 'core' }, outcome: 'accept',
    result: { battle: pending.battle, event: pending.event, kind: kindOf(k, pending), fails_commission: pending.fails_commission, option: option.id, ...netResult(pending) },
  })
  const lines = [...option.lines, ...end.lines]
  return attachActivityEnd(draft(state, 'defeat.option', option.summary, option.id, [...option.changes, ...end.changes, extChange(null), DROP], { narration: { results: lines } }), end)
}

/** 內海的戰敗多交回去的三個欄位（現實的不帶，結果照舊）：發起的人（netrun）照這個收一趟。 */
const netResult = (p: PendingDefeat): Record<string, unknown> => (p.net ? { net: true, tethered: p.tethered === true, located: p.located === true } : {})

const kindOf = (k: Pick<Kernel, 'content'>, pending: PendingDefeat): string => k.content.get<DefeatEventEntry>(KIND, pending.event)?.kind ?? 'generic'

// ---- 接受 ----

/**
 * 接受結果：一份帶 snapshot.drop 的 defeat.accept。事件演過了就沒有別的效果要結算（事件的每個選項當時已經套了）；
 * 不演（設定、選了不看、事件開不起來）就照「不演」結算：每一段走第一個選項、有檢定的照擲、效果改寫之後一次結算。
 * 組這一份時發 activity.end（kind defeat、outcome accept）：result 是 { battle, event, kind, fails_commission, option }，
 * origin 是那一場戰鬥的發起人（battle.origin.ext）；處理函式回傳的 changes、lines、launch、rewind 併進這一份。
 * 事件還沒做完、場景還在進行、還沒決定看不看時丟 ActionBlocked（原因寫成一句話）。
 */
export function acceptDefeat(k: Kernel, state: GameState): ReportDraft {
  const pending = defeatOf(state)
  if (!pending) throw new Error('沒有等待中的戰敗。')
  const block = acceptBlock(k, state, pending)
  if (block) throw new ActionBlocked(block)
  const entry = k.content.get<DefeatEventEntry>(KIND, pending.event)
  if (!entry) throw new Error(`戰敗事件 ${pending.event} 不在內容裡。`)
  const played = pending.played && !pending.skipped ? pending.played : undefined
  let changes: Change[] = []
  let lines: string[] = []
  let timeline: TimelineBeat[] = []
  let flags: string[] = []
  if (!played) {
    const s = settleSkipped(k, state, entry, pending.version, pending.battle, true)
    if (s.errors.length) throw new Error(`戰敗事件 ${pending.event} 的效果有問題：${s.errors.join('；')}`)
    changes = s.changes
    lines = [...s.lines, ...s.notes]
    timeline = s.timeline
    flags = s.flags
  }
  const fails = played ? pending.fails_commission : failsAfter(pending.fails_commission, flags)
  const end = endActivity(k, {
    state, kind: 'defeat', id: pending.battle, origin: pending.origin ?? { by: 'core' }, outcome: 'accept',
    result: { battle: pending.battle, event: pending.event, kind: entry.kind, fails_commission: fails, option: played ? played.option : 'skip', ...netResult(pending) },
  })
  const results = [...lines, ...companionLine(k, state, pending), ...end.lines]
  const out: ReportDraft = {
    kind: 'event', action: 'defeat.accept', location: clone(state.location), party: [], timeline,
    changes: [...changes, ...end.changes, extChange(null), DROP],
    outcome: { result: 'accepted', summary: fails ? '你接受了這個結果。這一趟的委託算失敗。' : '你接受了這個結果。這一趟的委託還在。' },
    narration: { results },
  }
  return attachActivityEnd(out, end)
}

// ---- 給畫面的檢視 ----

export interface DefeatChoice {
  /** watch、skip、accept、retry、stage，或別的功能多給的選項的 id */
  id: string
  name: string
  can: boolean
  /** 現在選不了的原因（完整的句子）；選得了是 null */
  why: string | null
  /** 說明（選項才有） */
  desc?: string
}

export interface DefeatViewInfo {
  battle: string
  outcome: 'lose' | 'surrender'
  step: DefeatStage
  setting: 'always' | 'skippable' | 'never'
  /** 走不演版 */
  skipped: boolean
  event: { id: string; name: string; kind: string; version: string; adult: boolean; tier: string | null; angel: boolean }
  /** 這一場是內海的戰鬥 */
  net: boolean
  /** 內海：被扣線（意識留在網內）；現實的戰鬥一定是 false */
  tethered: boolean
  /** 內海：是被定位而結束的 */
  located: boolean
  /** 事件視窗或場景之類進行中的活動（等它做完才能三選一）；沒有是 null */
  inner: { kind: string; id: string; label: string } | null
  choices: DefeatChoice[]
  /** 接受的話會怎樣 */
  accept: { fails_commission: boolean; money_max: number; gear_taken: boolean; lines: string[]; companions: string[] }
  played: PlayedResult | null
}

/** 現在在哪一步、哪一件事件與版本、能做的選擇與原因、接受的話會怎樣。沒有等待中的戰敗是 null。 */
export function defeatView(k: Kernel, state: GameState): DefeatViewInfo | null {
  const pending = defeatOf(state)
  if (!pending) return null
  const entry = k.content.get<DefeatEventEntry>(KIND, pending.event)
  const stage = stageOf(pending)
  const inner = k.activity.active(state).find((a) => a.kind !== 'defeat') ?? null
  const innerBlock = inner ? k.activity.blockOf(state, 'commit:defeat.option', dropDraft()) : null
  const watchWhy = pending.skipped ? '這一次不演戰敗事件（存檔規則設成不看，或事件演不了），只列出結果。' : stage === 'playing' ? '戰敗事件已經在演了。' : stage === 'played' ? '戰敗事件已經看過了。' : null
  const skipWhy = pending.view === 'always' ? '存檔規則設成一律要看戰敗事件。' : pending.view === 'never' ? '存檔規則設成不看戰敗事件，這一次本來就只列出結果。' : stage !== 'ask' || pending.skipped ? '現在不用決定要不要看戰敗事件。' : null
  const acceptWhy = acceptBlock(k, state, pending)
  const choices: DefeatChoice[] = [
    { id: 'watch', name: '看戰敗事件', can: watchWhy === null, why: watchWhy },
    { id: 'skip', name: '不看，直接看結果', can: skipWhy === null, why: skipWhy },
    { id: 'accept', name: '接受結果', can: acceptWhy === null, why: acceptWhy },
    ...defeatOptions(k, state).map((o): DefeatChoice => {
      const why = o.blocks.length > 0 ? o.blocks.join('') : innerBlock
      return { id: o.id, name: o.name, can: why === null, why, desc: o.desc }
    }),
    { id: 'retry', name: '重來這場戰鬥', can: true, why: null },
    { id: 'stage', name: '回到這個階段開始時', can: true, why: null },
  ]
  const played = pending.played && !pending.skipped
  return {
    battle: pending.battle, outcome: pending.outcome, step: inner && stage === 'played' ? 'playing' : stage, setting: pending.view, skipped: pending.skipped,
    event: { id: pending.event, name: entry?.name ?? pending.event, kind: entry?.kind ?? 'generic', version: pending.version, adult: entry?.adult === true, tier: pending.tier ?? null, angel: entry?.angel === true },
    net: pending.net === true, tethered: pending.tethered === true, located: pending.located === true,
    inner, choices,
    accept: {
      fails_commission: pending.fails_commission, money_max: moneyLimit(state), gear_taken: state.rules.defeatTakeGear,
      lines: played ? [] : pending.lines, companions: companionNames(k, state, pending),
    },
    played: pending.played ?? null,
  }
}
