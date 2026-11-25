// L6 功能 curtain 的落幕（CYBERSPACE 8.8 節「打輸會怎樣」；LEWD_SYSTEM 3.4、6.1 節；dev/adr/0019 第十二節、P59、P60；dev/work/M4-curtain-fall.md）。
//
// 全隊倒下是落幕（全員拔線與提早落幕不是）。流程：
//   1. 開戰時（battle.ts 的 onBattleStart）把這一場的戰敗事件指到「輸在這一幕」那一件（規則表 fall.events；篩選把它擋掉、或純舞台場次改用 fall.plain 的 _plain 版本），
//      並帶 origin.ext.defeat_play（熔斷的場地也走戰敗事件，defeat 認它）。戰敗事件的種類是 stage：事件視窗不開，內文與效果走「不演」的結算。
//   2. 戰敗被接受：netrun 收掉這一趟（掛點 netrun.close，outcome defeat：settle.ts 記下 run.lost），戰敗功能的 activity.end 讓這裡記下事件（run.lost_event）；
//      報告套用之後（report.after）發 curtain.fall：結算打賞（照當時場熱那一段 × tips_mult）、保證金沒收、擲一次母帶外流；
//      戰敗事件的主線有一場成人場景、對象生成得出來：fall.stage 是 replay，等玩家喊停或開演；沒有（_plain、純舞台、種類不是 stage、找不到對象）：直接是 choose，減半的打賞當場付。
//   3. 補演（replay）：喊停（callOffDraft）：不演、這一場的打賞歸零；開演（replayDraft）：開 nature work、goal please、layer net 的場景（對象由事件的 cast 生成，P59）。
//      場景結束（activity.end，kind scene、origin.by curtain、ext.curtain.replay）：照契合的評價換回打賞（難忘與合拍補回再加一成、普通不補、不合再減一成），
//      這一場的沉溺夾在 sink_range（多給的補一筆拉回來），打賞付出去，fall.stage 變 choose。
//   4. 之後的三條路（choose）：付清（設備費與違約金＝保證金 × fine_mult，當場付）、記帳（欠著，每週一行利息，欠到保證金的兩倍不能再報名）、簽檔期（contract_dom 關掉時不列）；一定要選一條才能再報名。
//   5. 母帶：每次落幕擲一次外流；外流時旗標 curtain_tape:<id>、每一區的豔名 +5；blacktape 關掉時改成館方保管；買回要付保證金的兩倍。
// 報告：curtain.fall、curtain.replay、curtain.settle、curtain.tape。

import type { Change, GameState, Kernel, Launch, ReportDraft } from '../../core'
import { ActionBlocked, clone, contentAllowed, deriveRng, effectCtx, formatAmount, isRecord, resolveFiltered, toMinutes } from '../../core'
import { defOf } from './ctx'
import { tipsRatio } from './heat'
import type { CurtainRules, FallRecord, RunRecord, TierDef } from './model'
import { FALL_ACTION, FLAG_RAIDED, FLAG_TAPE, ORIGIN_BY, REPLAY_ACTION, SETTLE_ACTION, TAPE_ACTION, curtainRules, isText, nowOf, readCurtain, tierOf, weekMinutes } from './model'
import { patch } from './patch'
import { draftOf, nameOf } from './util'

const money = (n: number): string => `C$${formatAmount(n)}`
const STAGE_KIND = 'stage'
const DEFEAT_KIND = 'defeat_event'
const SCENE_ACTIVITY = 'scene'

// ---- 簽檔期的分帳 ----

/** 簽著檔期（沒到期）時結算只拿幾成（館六你四）；沒有檔期是 1。 */
export function gigMult(k: Pick<Kernel, 'content' | 'timeRules'>, state: Pick<GameState, 'ext' | 'time'>): number {
  const gig = readCurtain(state).gig
  return gig && nowOf(state) < gig.until ? curtainRules(k).fall.gig.split : 1
}

// ---- 開戰時指到這一幕的戰敗事件 ----

/** 輸在這一幕走哪一件戰敗事件：規則表 fall.events；純舞台場次、或篩選把它擋掉了，改用 fall.plain 的 _plain 版本。查不到對應的幕是 undefined。 */
export function fallEventFor(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'rules'>, rules: Pick<CurtainRules, 'fall' | 'act_defs' | 'encore'>, run: Pick<RunRecord, 'pure_stage'>, act: number): string | undefined {
  const id = defOf(rules as CurtainRules, act).id
  const main = rules.fall.events[id]
  const plain = rules.fall.plain[id]
  if (run.pure_stage) return plain ?? main
  if (main === undefined) return plain
  if (!k.content.hasKind(DEFEAT_KIND)) return main
  type E = { id: string; tags?: string[]; fallback?: string }
  const get = (id: string): E | undefined => k.content.get<E>(DEFEAT_KIND, id)
  const entry = get(main)
  if (!entry) return main
  const usable = resolveFiltered(state.rules, entry, get)
  if (usable?.id === main) return main
  return plain ?? usable?.id ?? main
}

// ---- 補演：戰敗事件的主線場景與對象 ----

interface Plan {
  spec: Record<string, unknown>
  cast: Array<Record<string, unknown>>
}

/** 戰敗事件主線的那一場成人場景（版本裡第一個有 adult_scene 的選項）與登場角色；沒有是 null。 */
function planOf(k: Pick<Kernel, 'content'>, event: string, version: string | undefined): Plan | null {
  if (!k.content.hasKind(DEFEAT_KIND)) return null
  const entry = k.content.get(DEFEAT_KIND, event) as Record<string, unknown> | undefined
  if (!entry || entry.kind !== STAGE_KIND || !isRecord(entry.versions)) return null
  const versions = entry.versions as Record<string, unknown>
  const v = (version !== undefined ? versions[version] : undefined) ?? versions.default ?? Object.values(versions)[0]
  if (!isRecord(v)) return null
  const stages: unknown[] = Array.isArray(v.stages) ? v.stages : Array.isArray(v.options) ? [{ options: v.options }] : []
  for (const st of stages) {
    if (!isRecord(st) || !Array.isArray(st.options)) continue
    for (const o of st.options) if (isRecord(o) && isRecord(o.adult_scene)) return { spec: clone(o.adult_scene), cast: Array.isArray(entry.cast) ? clone(entry.cast.filter(isRecord)) : [] }
  }
  return null
}

interface CastResult {
  ids: Record<string, string>
  changes: Change[]
}

/** 問 director.cast：每個登場角色生成一位（沒有人回答是 null：找不到對象）。不改狀態，回傳要先套的變更。 */
function castOf(k: Kernel, state: GameState, event: string, cast: Array<Record<string, unknown>>): CastResult | null {
  const ids: Record<string, string> = {}
  const changes: Change[] = []
  for (const c of cast) {
    const { role, ...spec } = c as Record<string, unknown> & { role?: unknown }
    if (!isText(role)) return null
    let found = false
    for (const { result } of k.hooks.run('director.cast', { state, event, role, spec: clone(spec) })) {
      const r = result as { actor?: unknown; changes?: Change[] } | undefined
      if (!r || typeof r.actor !== 'string') continue
      const made = (r.changes ?? []).some((ch) => ch.op === 'actor.add' && isRecord(ch.actor) && ch.actor.id === r.actor)
      if (!state.actors[r.actor] && !made) continue
      ids[role] = r.actor
      changes.push(...clone(r.changes ?? []))
      found = true
      break
    }
    if (!found) return null
  }
  return { ids, changes }
}

const swap = (id: string, pc: string, ids: Record<string, string>): string => (id === '$pc' ? pc : id.startsWith('$') ? (ids[id.slice(1)] ?? id) : id)

/** 補演的場景設定與要先套的變更；現在不能演（沒有場景活動、戰敗事件沒有主線場景、找不到對象）回傳原因。 */
function replayPlan(k: Kernel, state: GameState, fall: Pick<FallRecord, 'event' | 'version' | 'run'>): { launch: Launch; changes: Change[]; names: string[] } | { why: string } {
  if (!k.activity.get(SCENE_ACTIVITY)) return { why: '現在沒有成人場景可以演，補演只能略過。' }
  if (!fall.event) return { why: '這一次的戰敗事件沒有補演的場景。' }
  const plan = planOf(k, fall.event, fall.version)
  if (!plan) return { why: '這一次的戰敗事件沒有補演的場景。' }
  const cast = castOf(k, state, fall.event, plan.cast)
  if (!cast) return { why: '館方找不到願意補演的對象。' }
  const pc = state.pc ?? 'pc'
  const circle = Array.isArray(plan.spec.circles) && Array.isArray(plan.spec.circles[0]) ? (plan.spec.circles[0] as unknown[]).filter(isText) : []
  const others = circle.map((x) => swap(x, pc, cast.ids)).filter((id) => id !== pc && !id.startsWith('$'))
  if (!others.length) return { why: '館方找不到願意補演的對象。' }
  const s = plan.spec
  const setup: Record<string, unknown> = {
    with: others, nature: isText(s.nature) ? s.nature : 'work', goal: isText(s.goal) ? s.goal : 'please', layer: isText(s.layer) ? s.layer : 'net', place: '簾後館・補演',
    ...(isText(s.role) ? { role: s.role } : {}), ...(isText(s.start_position) ? { start_position: s.start_position } : {}),
  }
  const launch: Launch = { kind: SCENE_ACTIVITY, setup, origin: { by: ORIGIN_BY, ref: fall.run, ext: { curtain: { replay: true } } } }
  return { launch, changes: cast.changes, names: others.map((id) => state.actors[id]?.name ?? id) }
}

// ---- 母帶 ----

export interface TapeOpts {
  /** 輸在整趟的第幾幕（從 0 起算；第二幕是 2） */
  act: number
  /** 帳上有欠款 */
  indebted?: boolean
}

/** 這一次落幕外流的機率：base；當週被臨檢（旗標 curtain_raided）、帳上有欠款各加；第二幕輸加；最高 cap。 */
export function tapeChance(k: Pick<Kernel, 'content'>, state: Pick<GameState, 'flags' | 'ext'>, o: TapeOpts): number {
  const t = curtainRules(k).fall.tape
  const indebted = o.indebted ?? (readCurtain(state).tab?.owed ?? 0) > 0
  const p = t.base + (state.flags[FLAG_RAIDED] ? t.raided : 0) + (indebted ? t.in_debt : 0) + (o.act === 2 ? t.backstage : 0)
  return Math.round(Math.min(t.cap, p) * 10000) / 10000
}

/** 擲外流的骰面（0～1）：由狀態的亂數與這一趟的編號導出。 */
export const tapeRoll = (state: Pick<GameState, 'rng'>, run: string): number => deriveRng(state.rng, `curtain/tape/${run}`).next()

function tapeChanges(k: Kernel, state: GameState, run: RunRecord, act: number, rules: CurtainRules): { changes: Change[]; lines: string[]; summary: string } {
  const indebted = (readCurtain(state).tab?.owed ?? 0) > 0
  const chance = tapeChance(k, state, { act, indebted })
  const hit = tapeRoll(state, run.id) < chance
  const changes: Change[] = [{ op: 'rng', advance: 1 }]
  const lines: string[] = []
  if (!hit) return { changes, lines, summary: '' }
  const price = Math.round(run.deposit * rules.fall.tape.buyback_mult)
  const leak = contentAllowed(state.rules, 'blacktape')
  if (!leak) {
    changes.push(patch({ tape: { id: run.id, leaked: false, price } }))
    lines.push(`補演的母帶館方留下來保管了：想要回來要付 ${money(price)}。`)
    return { changes, lines, summary: '母帶館方保管' }
  }
  changes.push({ op: 'flag', key: `${FLAG_TAPE}:${run.id}`, value: true }, patch({ tape: { id: run.id, leaked: true, price } }))
  const fame = rules.fall.tape.fame
  if (k.meters.has('fame') && k.content.hasKind('district')) {
    for (const d of k.content.list('district')) changes.push({ op: 'meter', kind: 'fame', key: d.id, delta: fame })
  }
  lines.push(`補演的母帶外流了：它在簾子後面出現，每一區的豔名 +${fame}。買回要付 ${money(price)}。`)
  return { changes, lines, summary: '母帶外流' }
}

// ---- 落幕 ----

/** 這一趟全隊倒下、戰敗也被接受了（run.lost）：發 curtain.fall。 */
export function fallDraft(k: Kernel, state: GameState, run: RunRecord): ReportDraft {
  const rules = curtainRules(k)
  const tier = tierOf(rules, run.tier)!
  const lost = run.lost!
  const ratio = tipsRatio(rules, lost.heat)
  const full = Math.round(tier.prize * ratio * (run.tips_mult ?? 1) * (run.feature ? rules.feature_bonus : 1))
  const half = Math.round(full * rules.fall.tips_mult)
  const ev = run.lost_event
  const stageEvent = ev?.kind === STAGE_KIND ? ev : undefined
  const plan = stageEvent ? replayPlan(k, state, { event: stageEvent.event, ...(stageEvent.version ? { version: stageEvent.version } : {}), run: run.id }) : null
  const replay = !run.pure_stage && !!plan && !('why' in plan)
  const act = lost.act
  const name = defOf(rules, act).name
  const record: FallRecord = {
    act, heat: lost.heat, tips: half, full, stage: replay ? 'replay' : 'choose', run: run.id, night: run.night, tier: run.tier, deposit: run.deposit, party: [...run.party],
    ...(replay && stageEvent ? { event: stageEvent.event, ...(stageEvent.version ? { version: stageEvent.version } : {}) } : {}),
  }
  const lines = [`全隊倒下了，在「${name}」落幕。場熱 ${lost.heat}（打賞 ×${ratio}），打賞減半：${money(half)}。保證金 ${money(run.deposit)} 沒收，倒下的人沒有受傷，身上的東西館方寄存在櫃台。`]
  const changes: Change[] = []
  let paid = 0
  if (replay) lines.push('館方派了補演：你可以開演，也可以說「落幕」喊停（補演不演，這一場的打賞也沒有了）。')
  else {
    paid = Math.round(half * gigMult(k, state))
    lines.push(paid > 0 ? `沒有補演：打賞 ${money(paid)}${paid !== half ? `（簽著檔期，只拿 ${Math.round(rules.fall.gig.split * 100)}%）` : ''}當場付清。` : '沒有補演，也沒有打賞。')
  }
  if (paid > 0) changes.push({ op: 'cash', delta: paid })
  const tape = tapeChanges(k, state, run, act, rules)
  lines.push(...tape.lines)
  changes.push(...tape.changes, patch({ fall: record, run: { clear: true }, ...(paid > 0 ? { tips: paid } : {}) }))
  return draftOf(state, FALL_ACTION, replay ? 'replay' : 'choose', lines.join(''), changes, { lines })
}

// ---- 喊停與開演 ----

const noFall = '現在沒有落幕之後等著處理的事。'

/** 現在不能喊停的原因（一句）；能是 null。 */
export function callOffBlock(k: Kernel, state: GameState): string | null {
  const fall = readCurtain(state).fall
  if (!fall) return noFall
  if (fall.stage !== 'replay') return '補演已經結束了。'
  if (fall.started) return '補演已經開演了：場景裡要停就按「停下」。'
  return k.activity.blockOf(state, `commit:${REPLAY_ACTION}`)
}

/** 喊停（報告 curtain.replay）：補演不演、這一場的打賞歸零、其他不再扣；進到之後的選擇。 */
export function callOffDraft(k: Kernel, state: GameState): ReportDraft {
  const why = callOffBlock(k, state)
  if (why) throw new ActionBlocked(why)
  const lines = ['你說了「落幕」：補演不演，這一場的打賞也沒有了，其他不再扣。']
  return draftOf(state, REPLAY_ACTION, 'called_off', lines.join(''), [patch({ fall: { stage: 'choose', tips: 0, called_off: true } })], { lines })
}

/** 現在不能開演的原因（一句）；能是 null。 */
export function replayBlock(k: Kernel, state: GameState): string | null {
  const fall = readCurtain(state).fall
  if (!fall) return noFall
  if (fall.stage !== 'replay') return '補演已經結束了。'
  if (fall.started) return '補演已經開演了。'
  const other = k.activity.blockOf(state, `commit:${REPLAY_ACTION}`) ?? k.activity.blockOf(state, `${SCENE_ACTIVITY}.start`)
  if (other) return other
  const plan = replayPlan(k, state, fall)
  return 'why' in plan ? plan.why : null
}

/** 開演（報告 curtain.replay，帶 launch 開一場 nature work、goal please、layer net 的成人場景；對象由戰敗事件的 cast 生成）。不成立丟 ActionBlocked。 */
export function replayDraft(k: Kernel, state: GameState): ReportDraft {
  const why = replayBlock(k, state)
  if (why) throw new ActionBlocked(why)
  const fall = readCurtain(state).fall!
  const plan = replayPlan(k, state, fall) as Exclude<ReturnType<typeof replayPlan>, { why: string }>
  const lines = [`補演開場了：和${plan.names.join('、')}一起演給觀眾看。結算照契合的評價換回打賞。`]
  const d = draftOf(state, REPLAY_ACTION, 'start', lines.join(''), [...plan.changes, patch({ fall: { started: true } })], { lines, launch: [plan.launch] })
  return d
}

// ---- 補演結束 ----

type Band = 'good' | 'fair' | 'poor'

/** 契合換成評價：good_min 以上是好（難忘、合拍）、poor_below 以下是不合、中間是普通。 */
export const replayBand = (rules: Pick<CurtainRules, 'fall'>, fit: number): Band => (fit >= rules.fall.replay.good_min ? 'good' : fit < rules.fall.replay.poor_below ? 'poor' : 'fair')

/** 補演結束之後的打賞：好的補回來再加一成（整份的）、普通不補、不合再減一成（不會小於 0）。 */
export function replayTips(rules: Pick<CurtainRules, 'fall'>, fall: Pick<FallRecord, 'full' | 'tips'>, band: Band): number {
  const r = rules.fall.replay
  if (band === 'good') return Math.round(fall.full * (1 + r.bonus))
  if (band === 'poor') return Math.max(0, Math.round(fall.tips - fall.full * r.penalty))
  return fall.tips
}

/** 補演的場景結束了（activity.end，kind scene、origin.by 是 curtain、ext.curtain.replay）：打賞照評價換、沉溺夾在 sink_range、打賞付出去、進到之後的選擇。 */
export function onReplayEnd(k: Kernel, state: GameState, origin: { by: string; ext?: Record<string, unknown> }, result: Record<string, unknown>): { changes: Change[]; lines: string[] } | undefined {
  if (origin.by !== ORIGIN_BY) return undefined
  const mark = isRecord(origin.ext) ? origin.ext.curtain : undefined
  if (!isRecord(mark) || mark.replay !== true) return undefined
  const fall = readCurtain(state).fall
  if (!fall || fall.stage !== 'replay') return undefined
  const rules = curtainRules(k)
  const fit = typeof result.fit === 'number' ? Math.round(result.fit) : typeof result.pace === 'number' ? Math.round(result.pace) : 0
  const band = replayBand(rules, fit)
  const to = replayTips(rules, fall, band)
  const lines: string[] = []
  const changes: Change[] = []
  // 沉溺：這一場的變化夾在 sink_range，多給（或多扣）的補一筆拉回來（往下走 sink 效果；沒有人註冊就直接改）
  const sink = typeof result.sink === 'number' && Number.isFinite(result.sink) ? Math.round(result.sink) : 0
  const [lo, hi] = rules.fall.sink_range
  const kept = Math.max(lo, Math.min(hi, sink))
  if (kept !== sink && state.pc) {
    const back = kept - sink
    if (k.effects.has('sink')) {
      const r = k.effects.resolve([{ kind: 'sink', amount: back }], effectCtx(k, state, { source: 'builtin' }))
      changes.push(...r.changes)
    } else changes.push({ op: 'actor.track', id: state.pc, track: 'sink', delta: back })
    lines.push(`補演的沉溺只算 ${kept >= 0 ? '+' : ''}${kept}（這一場結算給了 ${sink >= 0 ? '+' : ''}${sink}，館方的補演不動那麼多）。`)
  }
  const paid = Math.round(to * gigMult(k, state))
  if (paid > 0) changes.push({ op: 'cash', delta: paid })
  const bandName = band === 'good' ? '好' : band === 'poor' ? '不合' : '普通'
  lines.unshift(`補演結束了，契合 ${fit}（${bandName}）：打賞 ${money(fall.tips)} → ${money(to)}${paid !== to ? `，簽著檔期只拿 ${money(paid)}` : ''}。`)
  changes.push(patch({ fall: { stage: 'choose', tips: to, replayed: { fit, band, sink, kept, from: fall.tips, to } }, ...(paid > 0 ? { tips: paid } : {}) }))
  return { changes, lines }
}

/** 補演剛結束、還沒發 curtain.replay：發一份（掛在 report.after；每一次只發一次）。沒有要發的是 null。 */
export function replayReport(state: GameState): ReportDraft | null {
  const fall = readCurtain(state).fall
  const r = fall?.replayed
  if (!fall || !r || r.reported) return null
  const lines = [`補演做完了：打賞 ${money(r.to)}。接下來選一條路處理設備費與違約金。`]
  return draftOf(state, REPLAY_ACTION, 'done', lines.join(''), [patch({ fall: { replayed: { ...r, reported: true } } })], { lines })
}

// ---- 之後的三條路 ----

export type HowSettle = 'pay' | 'tab' | 'gig'

export interface PathView {
  id: HowSettle
  name: string
  /** 付清與記帳是設備費與違約金；簽檔期是 0（用收入分帳抵） */
  amount: number
  can: boolean
  why: string | null
  desc: string
}

/** 設備費與違約金：保證金 × fine_mult。 */
export const fineOf = (rules: Pick<CurtainRules, 'fall'>, deposit: number): number => Math.round(deposit * rules.fall.fine_mult)

/** 這一條路現在選不了的原因（一句）；能選是 null。 */
export function settleBlock(k: Kernel, state: GameState, how: HowSettle): string | null {
  const cur = readCurtain(state)
  const fall = cur.fall
  if (!fall) return noFall
  if (fall.stage === 'replay') return '補演還沒結束：先喊停，或把補演演完。'
  const rules = curtainRules(k)
  const other = k.activity.blockOf(state, `commit:${SETTLE_ACTION}`)
  if (other) return other
  if (how === 'pay') {
    const fine = fineOf(rules, fall.deposit)
    return state.money.cash < fine ? `現金不夠：設備費與違約金 ${money(fine)}，你只有 ${money(state.money.cash)}。` : null
  }
  if (how === 'gig') {
    if (!contentAllowed(state.rules, 'contract_dom')) return '簽檔期的場內契約用到被你的內容篩選關掉的題材，這一條路不開。'
    if (cur.gig && nowOf(state) < cur.gig.until) return '你已經簽著檔期了，先把它做完。'
    return null
  }
  return null
}

/** 三條路各自的數字與能不能選（簽檔期在 contract_dom 關掉時不列）。 */
export function pathsOf(k: Kernel, state: GameState): PathView[] {
  const fall = readCurtain(state).fall
  if (!fall) return []
  const rules = curtainRules(k)
  const fine = fineOf(rules, fall.deposit)
  const g = rules.fall.gig
  const out: PathView[] = [
    { id: 'pay', name: '付清', amount: fine, can: settleBlock(k, state, 'pay') === null, why: settleBlock(k, state, 'pay'), desc: `設備費與違約金 ${money(fine)}，當場付清。` },
    {
      id: 'tab', name: '記帳', amount: fine, can: settleBlock(k, state, 'tab') === null, why: settleBlock(k, state, 'tab'),
      desc: `欠 ${money(fine)}，每週利息 ${Math.round(rules.fall.tab.weekly * 100)}% 列進每週帳單；欠到保證金的 ${rules.fall.tab.cap_mult} 倍就不能再報名，直到還清。只是錢，不連到契約。`,
    },
  ]
  if (contentAllowed(state.rules, 'contract_dom')) {
    out.push({
      id: 'gig', name: '簽檔期', amount: 0, can: settleBlock(k, state, 'gig') === null, why: settleBlock(k, state, 'gig'),
      desc: `場內契約 ${g.weeks} 週，每週至少上 ${g.shows_per_week} 場，這段時間打賞與獎金你只拿 ${Math.round(g.split * 100)}%；沒上場的那一週勢力敵對值 +${g.miss_hostility}。不入伊甸園的登記庫，不受法律保護。`,
    })
  }
  return out
}

/** 選一條路（報告 curtain.settle）：付清扣設備費與違約金、記帳記進欠款、簽檔期簽四週。不成立丟 ActionBlocked。 */
export function settleDraft(k: Kernel, state: GameState, o: { how: HowSettle }): ReportDraft {
  const why = settleBlock(k, state, o.how)
  if (why) throw new ActionBlocked(why)
  const fall = readCurtain(state).fall!
  const rules = curtainRules(k)
  const fine = fineOf(rules, fall.deposit)
  const now = nowOf(state)
  const changes: Change[] = []
  const lines: string[] = []
  if (o.how === 'pay') {
    if (fine > 0) changes.push({ op: 'cash', delta: -fine })
    lines.push(`你付清了設備費與違約金 ${money(fine)}。`)
  } else if (o.how === 'tab') {
    changes.push(patch({ tab: { delta: fine, since: now } }))
    lines.push(`你把設備費與違約金 ${money(fine)} 記了帳：每週的帳單會多一行利息，欠到保證金的 ${rules.fall.tab.cap_mult} 倍就不能再報名。`)
  } else {
    const g = rules.fall.gig
    changes.push(patch({ gig: { start: now, until: now + g.weeks * weekMinutes(k), shows: {}, missed: 0, checked: 0 } }))
    lines.push(`你簽了 ${g.weeks} 週的檔期：每週至少上 ${g.shows_per_week} 場，這段時間打賞與獎金你只拿 ${Math.round(g.split * 100)}%。`)
  }
  changes.push(patch({ fall: null }))
  return draftOf(state, SETTLE_ACTION, o.how, lines.join(''), changes, { lines })
}

// ---- 記帳 ----

/** 欠款的上限：席次的保證金 × cap_mult。 */
export const tabCap = (rules: Pick<CurtainRules, 'fall'>, tier: Pick<TierDef, 'deposit'>): number => Math.round(tier.deposit * rules.fall.tab.cap_mult)

/** 每週帳單裡記帳的利息那一行（掛點 bill.collect）；沒有欠款沒有。 */
export function tabLine(k: Kernel, state: GameState, id: string, owner: string, order: number): { id: string; owner: string; name: string; kind: 'due'; amount: number; order: number; pay: 'either' } | null {
  const tab = readCurtain(state).tab
  if (!tab) return null
  const amount = Math.round(tab.owed * curtainRules(k).fall.tab.weekly)
  return amount > 0 ? { id, owner, name: '簾後館的欠款利息', kind: 'due', amount, order, pay: 'either' } : null
}

/** 現在還不了款的原因（一句）；能還是 null。amount 沒寫是全部（現金不夠就還現金有的那麼多不行：要先有錢）。 */
export function payTabBlock(k: Kernel, state: GameState, o: { amount?: number } = {}): string | null {
  const tab = readCurtain(state).tab
  if (!tab) return '你沒有欠簾後館的錢。'
  const amount = o.amount ?? tab.owed
  if (!Number.isInteger(amount) || amount < 1) return '還的金額要是 1 以上的整數。'
  if (amount > tab.owed) return `你只欠 ${money(tab.owed)}。`
  if (state.money.cash < amount) return `現金不夠：要還 ${money(amount)}，你只有 ${money(state.money.cash)}。`
  return k.activity.blockOf(state, `commit:${SETTLE_ACTION}`)
}

/** 還款（報告 curtain.settle，result: paid_tab）：還一部分或全部欠款。不成立丟 ActionBlocked。 */
export function payTabDraft(k: Kernel, state: GameState, o: { amount?: number } = {}): ReportDraft {
  const why = payTabBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const tab = readCurtain(state).tab!
  const amount = o.amount ?? tab.owed
  const left = tab.owed - amount
  const lines = [left > 0 ? `你還了 ${money(amount)}，還欠 ${money(left)}。` : `你還清了欠簾後館的 ${money(amount)}。`]
  return draftOf(state, SETTLE_ACTION, 'paid_tab', lines.join(''), [{ op: 'cash', delta: -amount }, patch({ tab: { delta: -amount } })], { lines })
}

// ---- 買回母帶 ----

/** 現在買不回來的原因（一句）；能買是 null。 */
export function buybackBlock(k: Kernel, state: GameState, o: { tape: string }): string | null {
  const t = readCurtain(state).tapes.find((x) => x.id === o.tape)
  if (!t) return `沒有編號「${o.tape}」的母帶。`
  if (t.bought) return '這一支母帶已經買回來了。'
  if (state.money.cash < t.price) return `現金不夠：買回要 ${money(t.price)}，你只有 ${money(state.money.cash)}。`
  return k.activity.blockOf(state, `commit:${TAPE_ACTION}`)
}

/** 買回母帶（報告 curtain.tape）：付保證金的兩倍，那一支標成買回、旗標拿掉（已經傳出去的豔名不會回來）。不成立丟 ActionBlocked。 */
export function buybackDraft(k: Kernel, state: GameState, o: { tape: string }): ReportDraft {
  const why = buybackBlock(k, state, o)
  if (why) throw new ActionBlocked(why)
  const t = readCurtain(state).tapes.find((x) => x.id === o.tape)!
  const lines = [`你付了 ${money(t.price)} 把母帶買了回來。${t.leaked ? '簾子後面的版本下架了，不過已經傳出去的名聲收不回來。' : ''}`]
  return draftOf(state, TAPE_ACTION, 'bought', lines.join(''), [{ op: 'cash', delta: -t.price }, { op: 'flag', key: `${FLAG_TAPE}:${t.id}`, value: null }, patch({ tape: { ...t, bought: true } })], { lines })
}

// ---- 給畫面的 ----

export interface FallView {
  /** 現在在哪一步：補演（replay）或之後的選擇（choose） */
  step: 'replay' | 'choose'
  act: { number: number; name: string }
  heat: number
  /** 現在的打賞（replay 時是減半、等補演結果的那份）、沒減半的整份 */
  tips: number
  full: number
  deposit: number
  /** 設備費與違約金 */
  fine: number
  called_off: boolean
  /** 補演：能不能開演、不能的原因、能不能喊停、已經開演了 */
  replay: { can_start: boolean; start_block: string | null; can_call_off: boolean; call_off_block: string | null; started: boolean }
  replayed: FallRecord['replayed'] | null
  paths: PathView[]
  tab: { owed: number; cap: number; weekly: number } | null
  gig: { until: number; shows: Record<string, number>; missed: number } | null
  tapes: Array<{ id: string; leaked: boolean; price: number; bought: boolean }>
}

/** 落幕之後現在在哪一步、三條路各自的數字與能不能選；沒有落幕之後等著處理的事是 null。 */
export function fallView(k: Kernel, state: GameState): FallView | null {
  const cur = readCurtain(state)
  const fall = cur.fall
  if (!fall) return null
  const rules = curtainRules(k)
  const tier = tierOf(rules, fall.tier)
  const start = replayBlock(k, state)
  const off = callOffBlock(k, state)
  return {
    step: fall.stage, act: { number: fall.act - (fall.act >= rules.act_defs.length ? rules.act_defs.length : 0) + 1, name: defOf(rules, fall.act).name }, heat: fall.heat, tips: fall.tips, full: fall.full, deposit: fall.deposit,
    fine: fineOf(rules, fall.deposit), called_off: fall.called_off === true,
    replay: { can_start: start === null, start_block: start, can_call_off: off === null, call_off_block: off, started: fall.started === true },
    replayed: fall.replayed ? clone(fall.replayed) : null, paths: fall.stage === 'choose' ? pathsOf(k, state) : [],
    tab: cur.tab ? { owed: cur.tab.owed, cap: tier ? tabCap(rules, tier) : 0, weekly: Math.round(cur.tab.owed * rules.fall.tab.weekly) } : null,
    gig: cur.gig ? { until: cur.gig.until, shows: { ...cur.gig.shows }, missed: cur.gig.missed } : null,
    tapes: cur.tapes.map((t) => ({ id: t.id, leaked: t.leaked, price: t.price, bought: t.bought === true })),
  }
}

// ---- 檔期：每週至少上一場 ----

/** 報名時記一場：現在是簽下去起算的第幾個「週」（從 0 起算；沒有檔期或到期了沒有）。 */
export function gigSlot(k: Pick<Kernel, 'timeRules'>, state: Pick<GameState, 'ext' | 'time'>): number | null {
  const gig = readCurtain(state).gig
  if (!gig || nowOf(state) >= gig.until) return null
  return Math.floor((nowOf(state) - gig.start) / weekMinutes(k))
}

/** 時間過了（掛點 time.passed）：簽的檔期每過完一個「週」就看有沒有上到場，沒上到的 missed +1、那個勢力敵對值加；到期自動結束。沒有要發的是 null。 */
export function gigTick(k: Kernel, state: GameState, to: GameState['time']): ReportDraft | null {
  const cur = readCurtain(state)
  const gig = cur.gig
  if (!gig) return null
  const rules = curtainRules(k)
  const g = rules.fall.gig
  const now = toMinutes(to)
  const week = weekMinutes(k)
  const elapsed = Math.min(g.weeks, Math.max(0, Math.floor((now - gig.start) / week)))
  const expired = now >= gig.until
  if (elapsed <= gig.checked && !expired) return null
  let missed = 0
  for (let i = gig.checked; i < elapsed; i++) if ((gig.shows[String(i)] ?? 0) < g.shows_per_week) missed++
  const changes: Change[] = []
  const lines: string[] = []
  if (missed > 0) {
    lines.push(`檔期有 ${missed} 個星期沒有上場。`)
    if (k.meters.has('hostility') && k.content.has('faction', g.faction)) {
      changes.push({ op: 'meter', kind: 'hostility', key: g.faction, delta: g.miss_hostility * missed })
      lines.push(`胭脂堂來收帳：敵對值 +${g.miss_hostility * missed}。`)
    }
  }
  if (expired) {
    changes.push(patch({ gig: null }))
    lines.push(`${g.weeks} 週的檔期到期了，場內契約自動結束。`)
  } else changes.push(patch({ gig: { ...clone(gig), missed: gig.missed + missed, checked: elapsed } }))
  return draftOf(state, SETTLE_ACTION, expired ? 'gig_end' : 'gig_week', lines.join('') || '檔期又過了一個星期。', changes, { lines })
}

export { nameOf }
