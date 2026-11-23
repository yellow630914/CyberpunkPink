// L6 功能 director 的流程：一個回合（或一個每天、每週的時間點）怎麼走一次導演（EVENTS 3.2、3.3、3.4 節）。
//
//   觸發點 ──▶ 每個範圍：冷卻過了、每天上限沒到、擲機率 ──▶ 篩選、依權重抽一件 ──▶ 候選
//   候選 ──▶ 通知：先放排隊的、再放新的，一回合最多 per_turn.notices 則，多的排到下一回合
//        └▶ 擋住型：有活動要開或進行中（副本、放行事件的活動如車上不算）→ 全部延後；否則先放延後的，沒有才在新的候選裡挑一件
//
// 導演不改狀態：提交由外殼做。這裡回傳報告草稿（通知、開事件視窗的草稿、狀態的更新）。
// 一個「回合」裡可以走好幾次（turn.end 一次；time.passed 每個跨過的每天、每週各一次），它們共用同一個回合的上限：
// 回合的記號是那個行動的報告 id，存在 state.ext.director.turn。

import type { Change, GameState, GameTime, Kernel, Launch, ReportDraft, ReportTrigger } from '../../core'
import { ActionBlocked, clone, deriveRng, effectCtx, isRecord, tagsAllowed, toMinutes } from '../../core'
import type { DirectorState, EventEntry, EventRules, Queued, Scope } from './model'
import {
  EVENT_KIND, EXT, cityBlockingToday, directorOf, eligibleEvents, eventRules, eventWeight, scopeCountToday, scopeOf, scopesOf,
} from './model'

/** 一次走導演：這一批觸發點，在這一刻。 */
export interface Pass {
  triggers: ReportTrigger[]
  at: GameTime
}

export interface RunOpts {
  /** 這一回合的記號（那個行動的報告 id） */
  turnKey: string
  /** 這一回合的報告帶著要開的活動（launch）：擋住型的事件全部延後 */
  launchPending: boolean
}

interface Candidate {
  scope: Scope
  event: EventEntry
  trigger: string
}

interface Run {
  k: Kernel
  /** 唯讀的狀態（掛鉤給的） */
  state: GameState
  /** 通知的效果結算用：把前面幾則通知的變更套上去，才不會兩則各自算得過、合起來付不出來 */
  sim: GameState
  rules: EventRules
  d: DirectorState
  /** 副本進行中 */
  commission: boolean
  /** 進行中的副本的 id（活動 commission 的 id）；沒有是 null */
  commissionId: string | null
  /** 副本以外還有活動進行中（戰鬥、場景、事件視窗……） */
  otherActive: boolean
  launchPending: boolean
  changed: boolean
  notices: ReportDraft[]
  starts: ReportDraft[]
}

const minutesOf = (t: GameTime): number => toMinutes(t)

/** 問活動「導演現在能不能開一件事件」用的那一次開活動（origin 只有導演自己，沒有發起它的功能）。 */
const DIRECTOR_LAUNCH: Launch = { kind: 'event', setup: {}, origin: { by: 'director' } }

/** 副本進行中只放 in_commission 的範圍（EVENTS 3.4 節）。 */
const allowedHere = (run: Run, scope: Scope | undefined): scope is Scope => !!scope && (!run.commission || scope.in_commission)

function dedupeKey(t: ReportTrigger): string {
  return JSON.stringify([t.point, t.where ?? null])
}

/** 走一遍導演。回傳要提交的報告草稿（沒有事就是空的）。 */
export function runPasses(k: Kernel, state: GameState, passes: Pass[], o: RunOpts): ReportDraft[] {
  const before = directorOf(state)
  // 沒有任何範圍、也沒有排著的東西：不用走
  if (!state.pc) return []
  if (before.deferred.length === 0 && before.notices.length === 0 && passes.every((p) => p.triggers.length === 0)) return []
  const active = k.activity.active(state)
  const run: Run = {
    k, state, sim: clone(state), rules: eventRules(k), d: before,
    commission: active.some((a) => a.kind === 'commission'),
    commissionId: active.find((a) => a.kind === 'commission')?.id ?? null,
    // 副本以外還有活動進行中：放行「導演開事件」的活動不算（車上：擋住型的 transit_stop、wait 事件要在車上跳出來）；
    // 戰敗等待中、事件視窗、成人場景、戰鬥都不放行，照舊算
    otherActive: active.some((a) => a.kind !== 'commission' && !k.activity.permits(state, a.kind, 'event.start', undefined, DIRECTOR_LAUNCH)),
    launchPending: o.launchPending, changed: false, notices: [], starts: [],
  }
  if (run.d.turn.key !== o.turnKey) run.d.turn = { key: o.turnKey, blocking: 0, notices: 0 }
  const scopes = scopesOf(k)
  for (const pass of passes) runPass(run, scopes, pass)
  takeOpen(run)
  const drafts = [...run.notices, ...run.starts]
  if (!run.changed) return drafts
  const change: Change = { op: 'ext', key: EXT, value: clone(run.d) }
  if (drafts.length > 0) drafts[0]!.changes.push(change)
  else drafts.push({ kind: 'system', action: 'director.queue', location: clone(state.location), party: [], timeline: [], changes: [change], outcome: { result: 'queued', summary: '有一件事排到之後再發生。' } })
  return drafts
}

/**
 * 事件視窗（M2-event-run）開的時候把「開著的事件」寫在 state.ext.director.open，也就是和導演自己的狀態同一個 ext 變更。
 * 導演這一回合還要改自己的部分（冷卻、件數、佇列），最後一筆整份寫回去會把剛開的事件蓋掉：
 * 所以先把開始的報告裡寫給 state.ext.director 的那一筆拆下來，只取 open 併進導演自己的狀態，由最後那一筆一起寫。
 */
function takeOpen(run: Run): void {
  for (const draft of run.starts) {
    draft.changes = draft.changes.filter((c) => {
      if (c.op !== 'ext' || c.key !== EXT) return true
      const open = isRecord(c.value) ? c.value.open : undefined
      if (isRecord(open)) run.d.open = clone(open)
      else delete run.d.open
      run.changed = true
      return false
    })
  }
}

function runPass(run: Run, scopes: Scope[], pass: Pass): void {
  const { d } = run
  const now = minutesOf(pass.at)
  // 到期的作廢（不吃冷卻）
  const alive = (q: Queued): boolean => q.until > now
  if (d.deferred.some((q) => !alive(q)) || d.notices.some((q) => !alive(q))) {
    d.deferred = d.deferred.filter(alive)
    d.notices = d.notices.filter(alive)
    run.changed = true
  }

  const candidates = collect(run, scopes, pass, now)
  const fresh = (blocking: boolean) => candidates.filter((c) => (c.event.blocking !== false) === blocking)
  releaseNotices(run, fresh(false), pass.at)
  releaseBlocking(run, fresh(true), pass.at, now)
}

// ---- 一：每個範圍擲一次，得到候選 ----

function collect(run: Run, scopes: Scope[], pass: Pass, now: number): Candidate[] {
  const { k, state, d } = run
  const out: Candidate[] = []
  const got = new Set<string>()
  const seen = new Set<string>()
  const queued = new Set([...d.deferred, ...d.notices].map((q) => q.event))
  for (const trigger of pass.triggers) {
    const key = dedupeKey(trigger)
    if (seen.has(key)) continue
    seen.add(key)
    for (const scope of scopes) {
      const prob = scope.triggers[trigger.point]
      if (prob === undefined || got.has(scope.id)) continue
      if (!allowedHere(run, scope)) continue
      if (scope.daily_cap !== null && scopeCountToday(d, scope.id, pass.at.day) >= scope.daily_cap) continue
      if (now < (d.scopes[scope.id]?.until ?? 0)) continue
      // 所有亂數用「存檔種子＋時間＋觸發點＋範圍」：回退之後重來會得到同樣的結果
      const rng = deriveRng(state.rng, `director/${now}/${trigger.point}/${scope.id}`)
      if (!rng.chance(prob)) continue
      // 篩選後一件都沒有：當作沒發生，不吃冷卻
      const pool = eligibleEvents(k, state, scope, trigger.point, { ...(trigger.where ? { where: trigger.where } : {}), at: pass.at, exclude: queued })
      const weighted = pool.map((e) => ({ e, w: eventWeight(k, state, e) })).filter((x) => x.w > 0)
      if (weighted.length === 0) continue
      const event = rng.weighted(weighted, (x) => x.w).e
      got.add(scope.id)
      out.push({ scope, event, trigger: trigger.point })
    }
  }
  return out
}

// ---- 放行之後記下 ----

function recordRelease(run: Run, c: Candidate, at: GameTime): void {
  const { d, rules } = run
  const now = minutesOf(at)
  const prev = d.scopes[c.scope.id]
  d.scopes[c.scope.id] = { until: now + Math.round(c.scope.cooldown_hours * 60), day: at.day, count: (prev?.day === at.day ? prev.count : 0) + 1 }
  d.seen[c.event.id] = at.day
  // 同一件委託不重複：記在這件委託名下；換了一件委託就從頭記
  if (c.scope.unique_in_commission && run.commissionId !== null) {
    d.in_commission = d.in_commission?.id === run.commissionId ? { id: run.commissionId, events: [...d.in_commission.events, c.event.id] } : { id: run.commissionId, events: [c.event.id] }
  }
  if (c.event.category) d.recent = [...d.recent, c.event.category].slice(-Math.max(0, rules.category_recent))
  if (c.event.blocking !== false) {
    if (!c.scope.in_commission) d.city = { day: at.day, blocking: cityBlockingToday(d, at.day) + 1 }
    d.turn.blocking += 1
  } else d.turn.notices += 1
  run.changed = true
}

const queueOf = (c: Candidate, at: GameTime): Queued => ({ event: c.event.id, scope: c.scope.id, trigger: c.trigger, from: minutesOf(at), until: minutesOf(at) + Math.round(c.scope.defer_hours * 60) })

function enqueue(list: Queued[], q: Queued): boolean {
  if (list.some((x) => x.event === q.event)) return false
  list.push(q)
  return true
}

// ---- 二：不擋的事件（通知） ----

function noticeDraft(run: Run, c: Candidate): ReportDraft | null {
  const { k, state, sim } = run
  const e = c.event
  // 不擋的事件：效果當場結算（內建的，照寫的算）
  const res = k.effects.resolve(e.effects ?? [], effectCtx(k, sim, { source: 'builtin' }))
  if (res.errors.length > 0) return null
  k.changes.applyAll(sim, res.changes)
  const text = e.text ?? e.id
  return {
    kind: 'event', action: 'event.notice', location: clone(state.location), party: [],
    timeline: [{ layer: 'meat', text, tag: 'event.notice', data: { event: e.id, scope: c.scope.id, trigger: c.trigger } }],
    changes: res.changes,
    outcome: { result: 'notice', summary: text },
    narration: { results: res.lines },
    ...(e.adult === true ? { adult: true } : {}),
  }
}

/** 先放排隊的，再放這一次新的；一回合最多 per_turn.notices 則，多的排到下一回合。 */
function releaseNotices(run: Run, fresh: Candidate[], at: GameTime): void {
  const { k, d, rules } = run
  const limit = rules.per_turn.notices
  const mine: Candidate[] = []
  // 排隊的：副本進行中只收 in_commission 的範圍；內容不見了、標籤現在關掉的就作廢
  const kept: Queued[] = []
  for (const q of d.notices) {
    const event = k.content.get<EventEntry>(EVENT_KIND, q.event)
    const scope = scopeOf(k, q.scope)
    if (!event || !scope || !tagsAllowed(run.state.rules, event.tags)) { run.changed = true; continue }
    if (!allowedHere(run, scope)) { kept.push(q); continue }
    if (d.turn.notices + mine.length < limit) { mine.push({ scope, event, trigger: q.trigger }); run.changed = true } else kept.push(q)
  }
  d.notices = kept
  for (const c of fresh) {
    if (d.turn.notices + mine.length < limit) mine.push(c)
    else if (enqueue(d.notices, queueOf(c, at))) run.changed = true
  }
  for (const c of mine) {
    const draft = noticeDraft(run, c)
    if (!draft) continue
    run.notices.push(draft)
    recordRelease(run, c, at)
  }
}

// ---- 三：擋住行動的事件 ----

/** 放行一件擋住型的事件：開事件視窗（沒有人登記 event 這種活動、或活動現在開不成，就排隊）。成功回傳 true。 */
function startEvent(run: Run, c: Candidate, at: GameTime): boolean {
  const { k, state, d } = run
  if (!k.activity.get('event')) return false
  let drafts: ReportDraft[]
  try {
    drafts = k.activity.start(k, state, 'event', { event: c.event.id }, { by: 'director', ext: { scope: c.scope.id, trigger: c.trigger } })
  } catch (e) {
    if (e instanceof ActionBlocked) return false
    throw e
  }
  if (drafts.length === 0) return false
  run.starts.push(...drafts)
  d.deferred = d.deferred.filter((q) => q.event !== c.event.id)
  recordRelease(run, c, at)
  return true
}

function releaseBlocking(run: Run, fresh: Candidate[], at: GameTime, now: number): void {
  const { k, d, rules } = run
  const day = at.day
  const defer = (c: Candidate): void => {
    if (enqueue(d.deferred, queueOf(c, at))) run.changed = true
  }
  // 沒有人登記事件視窗：全部改成排隊，不丟錯（之後有人登記了，下一個可以放行的回合就放）
  if (!k.activity.get('event')) {
    fresh.forEach(defer)
    return
  }
  // 這一回合有活動要開、或有活動進行中、或擋住型的名額用完：全部延後（不論範圍的 lost）
  if (run.otherActive || run.launchPending || d.turn.blocking >= rules.per_turn.blocking) {
    fresh.forEach(defer)
    return
  }
  const cityOk = (scope: Scope): boolean => scope.in_commission || cityBlockingToday(d, day) < rules.city_daily_blocking
  const scopeOk = (scope: Scope): boolean => scope.daily_cap === null || scopeCountToday(d, scope.id, day) < scope.daily_cap

  // 先放延後的
  let released = false
  for (const q of [...d.deferred]) {
    const event = k.content.get<EventEntry>(EVENT_KIND, q.event)
    const scope = scopeOf(k, q.scope)
    if (!event || !scope || !tagsAllowed(run.state.rules, event.tags)) {
      d.deferred = d.deferred.filter((x) => x !== q && x.event !== q.event)
      run.changed = true
      continue
    }
    if (q.until <= now || !allowedHere(run, scope) || !cityOk(scope) || !scopeOk(scope)) continue
    if (startEvent(run, { scope, event, trigger: q.trigger }, at)) {
      released = true
      break
    }
  }

  // 新的候選：沒有放過延後的才挑一件；其餘照 lost 作廢或延後
  const pool = fresh.filter((c) => cityOk(c.scope) && scopeOk(c.scope))
  let winner: Candidate | null = null
  if (!released && pool.length > 0) {
    // 有優先序的贏（小的先）；同一級（都沒有優先序也算）隨機留一個
    const rank = (c: Candidate): number => c.scope.priority ?? Infinity
    const best = Math.min(...pool.map(rank))
    const top = pool.filter((c) => rank(c) === best)
    winner = top.length === 1 ? top[0]! : deriveRng(run.state.rng, `director/${now}/pick`).pick(top)
    if (!startEvent(run, winner, at)) {
      defer(winner)
      winner = null
    }
  }
  for (const c of fresh) {
    if (c === winner) continue
    if (c.scope.lost === 'defer') defer(c)
  }
}
