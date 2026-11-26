// L6 功能 sink 的治療（DOWNTIME 3.3 節）：心理治療與斷線靜修。
//   心理治療  要在設施種類寫了 therapy.kind === 'counsel' 的地方；每週 per_week 次；花時間（minutes）與錢（price；設施寫 free 就不收）；沉溺 −amount。
//   斷線靜修  要在 therapy.kind === 'retreat' 的地方；一次過 days 天，不收錢；沉溺 −amount；
//             設施寫了 favor { faction, min } 時，那個勢力的好感要夠（查不到好感的量表當作不夠）。
//   沉溺 100 以上兩種都擋下（「你已經不想回去了。」）。
// 沉溺往下降一律走 sink 效果（下限會擋）。心理治療的價錢乘這一區的物價倍率（規則 therapy.counsel.district_price，預設乘）。
// 斷線靜修是進行中的活動（M4 收尾修正批；retreat.ts）：這裡只是開始（記下進行中、不動時間與沉溺），之後待下去、結算在 retreat.ts；「黑泉記得你來過」是內容。

import type { ActorId, Change, ContentEntry, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { ActionBlocked, areaPriceMult, clone, effectCtx, formatAmount, meterOf, isRecord } from '../../core'
import type { Pool, RetreatRec, TherapyKind } from './model'
import { FACILITY_TYPE_KIND, EXT_OP, MINUTES_PER_DAY, POOL_NAME, SUNK_AT, THERAPY_ACTION, THERAPY_KINDS, nameOf, payPool, readExt, sinkRules, weekOf, nowOf } from './model'

export interface TherapyFacility {
  type: string
  name: string
  kind: TherapyKind
  free: boolean
  favor?: { faction: string; min: number }
}

export interface TherapyOpts {
  /** 做哪一種；不寫就是腳下那間設施提供的那一種 */
  kind?: TherapyKind
  /** 誰做；不寫是主角 */
  actor?: ActorId
  /** 錢從哪裡付；不寫先帳戶、不夠再現金 */
  pay?: Pool
}

type FacilityTypeEntry = ContentEntry & { name?: unknown; therapy?: unknown }

/** 腳下的設施提供哪一種治療（用條件 at_facility 問；沒有人註冊就沒有）。 */
export function therapyHere(k: Kernel, state: GameState): TherapyFacility | null {
  if (!k.conditions.kinds().includes('at_facility') || !k.content.hasKind(FACILITY_TYPE_KIND)) return null
  const ctx = { state, stats: k.stats, timeRules: k.timeRules }
  for (const t of k.content.list<FacilityTypeEntry>(FACILITY_TYPE_KIND)) {
    const th = t.therapy
    if (!isRecord(th) || !(THERAPY_KINDS as readonly unknown[]).includes(th.kind)) continue
    if (!k.conditions.test({ kind: 'at_facility', types: [t.id] }, ctx)) continue
    const favor = isRecord(th.favor) && typeof th.favor.faction === 'string' && typeof th.favor.min === 'number' ? { faction: th.favor.faction, min: th.favor.min } : undefined
    return { type: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, kind: th.kind as TherapyKind, free: th.free === true, ...(favor ? { favor } : {}) }
  }
  return null
}

/** 這一次治療的報價（畫面與草稿用同一份）。 */
export interface TherapyQuote {
  actor: ActorId
  kind: TherapyKind
  facility: string
  /** 要花的時間（分鐘） */
  minutes: number
  /** 要付的錢（靜修與免費的設施是 0） */
  price: number
  /** 沉溺最多降多少（下限會擋；實際降多少看當下） */
  amount: number
  /** 錢從哪裡付；不用付是 null */
  pay: Pool | null
}

interface Plan {
  problems: string[]
  quote: TherapyQuote | null
}

function plan(k: Kernel, state: GameState, o: TherapyOpts): Plan {
  const actor = o.actor ?? state.pc
  const a = actor ? state.actors[actor] : undefined
  if (!actor || !a) return { problems: ['還沒有主角。'], quote: null }
  const problems: string[] = []
  if (state.battle) return { problems: ['戰鬥中不能這樣處理。'], quote: null }
  const act = k.activity.blockOf(state, `commit:${THERAPY_ACTION}`)
  if (act) return { problems: [act], quote: null }
  if (a.sink >= SUNK_AT) return { problems: ['你已經不想回去了。'], quote: null }
  if (readExt(state, actor).retreat) return { problems: ['你已經在斷線靜修了。'], quote: null }
  const here = therapyHere(k, state)
  if (!here) return { problems: [o.kind === 'retreat' ? '這裡沒有可以斷線靜修的地方。' : o.kind === 'counsel' ? '這裡沒有做心理治療的地方。' : '這裡沒有做沉溺治療的地方。'], quote: null }
  if (o.kind && o.kind !== here.kind) return { problems: [here.kind === 'counsel' ? '這裡只做心理治療，不能斷線靜修。' : '這裡只做斷線靜修，不做心理治療。'], quote: null }
  const rules = sinkRules(k)
  const kind = here.kind
  if (kind === 'retreat' && actor !== state.pc) return { problems: ['斷線靜修只能自己去。'], quote: null }
  if (kind === 'retreat' && here.favor) {
    const have = k.meters.has('favor') ? meterOf(k, state, 'favor', here.favor.faction) : -1
    if (have < here.favor.min) {
      const name = k.content.hasKind('faction') ? (k.content.get<ContentEntry & { name?: unknown }>('faction', here.favor.faction)?.name as string | undefined) ?? here.favor.faction : here.favor.faction
      problems.push(`${name}對你的好感還不夠，${here.name}不會讓你進去靜修。`)
    }
  }
  const ext = readExt(state, actor)
  if (kind === 'counsel') {
    const week = weekOf(k, nowOf(state))
    const used = ext.therapy_week === week ? ext.therapy_n ?? 1 : 0
    if (used >= rules.therapy.counsel.per_week) problems.push('這一週已經做過心理治療了，下個週一再來。')
  }
  const floor = k.stats.hasStat('sink_floor') ? k.stats.stat(state, actor, 'sink_floor') : 0
  if (a.sink <= floor) problems.push(floor > 0 ? '你已經浮在身上的義體撐著的最低處，治療幫不上忙。' : '你現在很清明，用不著治療。')
  // 心理治療的價錢乘這一區的物價倍率（規則 therapy.counsel.district_price，預設乘；DOWNTIME 3.3 節「1,000 × 區倍率」）
  const price = kind === 'counsel' && !here.free ? Math.max(0, Math.round(rules.therapy.counsel.price * (rules.therapy.counsel.district_price ? areaPriceMult(k, state) : 1))) : 0
  const pay = price > 0 ? payPool(state.money, price, o.pay) : null
  if (price > 0 && pay === null) problems.push(`錢不夠：心理治療要 ${formatAmount(price)}，${o.pay ? POOL_NAME[o.pay] : '帳戶與現金'}付不起。`)
  const quote: TherapyQuote = {
    actor, kind, facility: here.name,
    minutes: kind === 'counsel' ? rules.therapy.counsel.minutes : rules.therapy.retreat.days * MINUTES_PER_DAY,
    price, amount: kind === 'counsel' ? rules.therapy.counsel.amount : rules.therapy.retreat.amount, pay,
  }
  return { problems, quote }
}

export const therapyProblems = (k: Kernel, state: GameState, o: TherapyOpts = {}): string[] => plan(k, state, o).problems
/** 現在做不做得成：做得成是 null，否則是一句話的原因（一次只講一條）。 */
export const therapyBlock = (k: Kernel, state: GameState, o: TherapyOpts = {}): string | null => plan(k, state, o).problems[0] ?? null
/** 這一次治療的報價；腳下沒有提供治療的設施（或不能做）是 null。 */
export const therapyQuote = (k: Kernel, state: GameState, o: TherapyOpts = {}): TherapyQuote | null => plan(k, state, o).quote

/**
 * 做一次治療。不成立丟 ActionBlocked（therapyProblems 的第一條）。
 * 報告 sink.therapy：心理治療的 outcome.result 是 counsel（時間加 minutes、付錢、沉溺降、記下這一週做了幾次）；斷線靜修是 retreat_begin（只記下進行中的，結算見 retreat.ts）。
 */
export function therapyDraft(k: Kernel, state: GameState, o: TherapyOpts = {}): ReportDraft {
  const p = plan(k, state, o)
  if (p.problems.length > 0 || !p.quote) throw new ActionBlocked(p.problems[0] ?? '現在做不了治療。')
  const q = p.quote
  const a = state.actors[q.actor]!
  // 斷線靜修只是開始：記下進行中的，之後待下去、結算在 retreat.ts（時間、沉溺都還沒動，不收錢）
  if (q.kind === 'retreat') {
    const now = nowOf(state)
    const rec: RetreatRec = { facility: q.facility, since: now, until: now + q.minutes, amount: q.amount, from: a.sink }
    const days = Math.round(q.minutes / MINUTES_PER_DAY)
    const text = `${nameOf(state, q.actor)}進了${q.facility}，斷了線：接下來 ${days} 天橋是關著的，不能潛入，也做不了別的事；待滿了才算數，提早離開就白來了。`
    return {
      kind: 'downtime', action: THERAPY_ACTION, location: clone(state.location), actor: q.actor, party: [],
      timeline: [{ layer: 'meat', actor: q.actor, text, tag: THERAPY_ACTION, data: { kind: q.kind, facility: q.facility, minutes: q.minutes, price: 0, from: a.sink, begin: true } }],
      changes: [{ op: EXT_OP, id: q.actor, retreat: rec } as Change], outcome: { result: 'retreat_begin', summary: text }, narration: { results: [text] },
    }
  }
  const fx = [{ kind: 'sink', amount: -q.amount }]
  const ctx = effectCtx(k, state, { source: 'builtin', actor: q.actor })
  const errors = k.effects.validate(fx, ctx)
  if (errors.length > 0) throw new ActionBlocked(errors[0]!)
  const res = k.effects.resolve(fx, ctx)
  if (res.errors.length > 0) throw new ActionBlocked(res.errors[0]!)
  const dropped = -res.changes.reduce((n, c) => n + (c.op === 'actor.track' && c.track === 'sink' && typeof c.delta === 'number' ? c.delta : 0), 0)
  // 先付錢、再降沉溺、最後才過時間（時間會讓別的功能的 time.passed 接著跑）
  const changes: Change[] = []
  if (q.pay && q.price > 0) changes.push({ op: q.pay, delta: -q.price })
  changes.push(...res.changes)
  if (q.kind === 'counsel') {
    const week = weekOf(k, nowOf(state))
    const ext = readExt(state, q.actor)
    changes.push({ op: EXT_OP, id: q.actor, patch: { therapy_week: week, therapy_n: ext.therapy_week === week ? (ext.therapy_n ?? 1) + 1 : 1 } } as Change)
  }
  changes.push({ op: 'time', minutes: q.minutes })
  const who = nameOf(state, q.actor)
  const lines = q.kind === 'counsel'
    ? [`${who}在${q.facility}和治療師談了一整個下午，心裡糾纏的東西鬆開了一些。`]
    : [`${who}在${q.facility}斷了線，安安靜靜待了好幾天，回來的時候腦子清楚了一些。`]
  if (dropped === 0) lines.push('不過身上的義體還是把你墊在原來的地方。')
  const beats: TimelineBeat[] = lines.map((text, i) => ({
    layer: 'meat', actor: q.actor, text, tag: i === 0 ? THERAPY_ACTION : 'sink.note',
    ...(i === 0 ? { data: { kind: q.kind, facility: q.facility, minutes: q.minutes, price: q.price, from: a.sink, dropped } } : {}),
  }))
  return {
    kind: 'downtime', action: THERAPY_ACTION, location: clone(state.location), actor: q.actor, party: [], timeline: beats, changes,
    outcome: { result: q.kind, summary: lines.join('') }, narration: { results: lines },
  }
}
