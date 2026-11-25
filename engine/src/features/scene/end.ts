// L6 功能 scene 的報告：每一步的草稿，以及結束時的一次結算（LEWD_SYSTEM 3.4 節、3.5 節第六點；dev/adr/0016 G11）。
// 結算只看程式的規則，不呼叫 AI（工單：沒有每回合的 AI；AI 關著時 G11 的數字）：評價、體悟、親密度、橋參數、傾向、餘韻帶著走、性經歷、目的。
// 整場的正文是結束之後 AI 的事：這份報告帶 adult: true，由外殼用 commitNarrated 寫（成人路由）。

import type { Change, ClampNote, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { attachActivityEnd, clone, contentAllowed, effectCtx, endActivity, meterOf } from '../../core'
import { SINK_KIND_NAME, planGrowth, planSink, readClosing, relateAmount, relateStrays, sexNotes } from './close'
import type { Fx } from './close'
import type { EndReason, PartnerLook } from './model'
import { ACTIVITY, END_NAME, SINK_CAP, EXT, GOAL_NAME, beat, ratingOf, recordSceneWith, recordSolo, sexRecordOf, sceneRawOf, soloPosesSeen } from './model'
import type { Play } from './play'

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`)

/** 對象的身體（角色身上有 ext.body 才有）與外表的性別（角色的 gender；夜課的學習條件讀它）。 */
function lookOf(state: GameState, id: string): PartnerLook {
  const a = state.actors[id]
  return { ...(typeof a?.ext.body === 'string' ? { body: a.ext.body } : {}), ...(typeof a?.gender === 'string' ? { look_gender: a.gender } : {}) }
}

/** 這一場在 pc 身上落的沉溺（寫成變更）：有「沉溺」的效果就走它（下限會擋），沒有人註冊就直接加減。回傳變更、實際的變化、提醒。 */
/** 記憶被抹掉的場景（SceneSetup.amnesia）結束時留下的一句模糊的殘留（不帶機制數字、不寫內文）。 */
export const AMNESIA_RESIDUE = '這一場的事只剩一段模糊的殘留，怎麼也想不起細節。'
const NO_SINK = { changes: [] as Change[], actual: 0, clamps: [] as ClampNote[] }

function settleSink(k: Kernel, state: GameState, pc: string, amount: number): { changes: Change[]; actual: number; clamps: ClampNote[] } {
  if (amount === 0) return { changes: [], actual: 0, clamps: [] }
  if (!k.effects.has('sink')) return { changes: [{ op: 'actor.track', id: pc, track: 'sink', delta: amount }], actual: amount, clamps: [] }
  const r = settleEffects(k, state, pc, [{ kind: 'sink', amount }])
  const actual = r.changes.reduce((a, c) => a + (c.op === 'actor.track' && c.id === pc && c.track === 'sink' ? (c.delta as number) : 0), 0)
  return { changes: r.changes, actual, clamps: r.clamps }
}

/** 一份報告共用的欄位。 */
export function sceneDraft(state: GameState, p: Play, action: string, timeline: TimelineBeat[], changes: Change[], result: string, summary: string): ReportDraft {
  // 內海的場景每一拍標 net（M4-scene-net）
  const beats = p.s.layer === 'net' ? timeline.map((b): TimelineBeat => ({ ...b, layer: 'net' })) : timeline
  return {
    kind: 'social', action, location: clone(state.location), actor: p.s.pc, party: [], timeline: beats, changes, outcome: { result, summary }, adult: true,
  }
}

/** 感載與餘韻跟著人走：差多少就加減多少（actor.track）。結束時感載歸零。 */
function trackChanges(p: Play, over: boolean): Change[] {
  const out: Change[] = []
  for (const id of p.everyone) {
    const load = (over ? 0 : p.load[id]!) - p.state.actors[id]!.load
    const glow = p.glow[id]! - p.state.actors[id]!.afterglow
    if (load !== 0) out.push({ op: 'actor.track', id, track: 'load', delta: load })
    if (glow !== 0) out.push({ op: 'actor.track', id, track: 'afterglow', delta: glow })
  }
  return out
}

const stepText = (p: Play): string => p.beats.filter((b) => b.tag !== 'round' && b.tag !== 'scene.dropped').map((b) => b.text).join('') || '場景繼續。'

/** 沒有結束的一步（scene.act、scene.next）：場景狀態整份換掉，加感載與餘韻的差。 */
export function stepDraft(p: Play, action: 'scene.act' | 'scene.next'): ReportDraft {
  p.s.step += 1
  const changes: Change[] = [{ op: 'ext', key: EXT, value: clone(p.s) }, ...trackChanges(p, false)]
  if (p.consumed) changes.push({ op: 'item', id: p.consumed, qty: -1 })
  const d = sceneDraft(p.state, p, action, p.beats, changes, action === 'scene.act' ? 'act' : 'next', stepText(p))
  if (p.said) d.input = p.said
  return d
}

/** 試著落一批效果：沒有人註冊的、格式不合的（例：還沒認識的人、查不到的傾向標籤）一筆一筆略過，不讓整份報告做不成。 */
function settleEffects(k: Kernel, state: GameState, actor: string, list: Fx[]): { changes: Change[]; lines: string[]; clamps: ClampNote[] } {
  const ctx = effectCtx(k, state, { source: 'builtin', actor })
  const valid = list.filter((e) => k.effects.has(e.kind as string) && k.effects.validate([e], ctx).length === 0)
  if (valid.length === 0) return { changes: [], lines: [], clamps: [] }
  const r = k.effects.resolve(valid, ctx)
  return r.errors.length > 0 ? { changes: [], lines: [], clamps: [] } : { changes: r.changes, lines: r.lines, clamps: r.clamps }
}

/** 場景的一整場紀錄（結束的報告帶它，AI 寫整場的正文讀它）。 */
export function logBeats(state: GameState): TimelineBeat[] {
  const s = sceneRawOf(state)
  return s ? s.lines.map((l) => beat(l.who, l.text, 'scene.line')) : []
}

/**
 * 結束：結算並收尾（scene.end）。lead 是這一步之前的整場紀錄；p.beats 是這一步的。
 * 略過（reason skip）的體悟打七折、沒有用過的體位、不給橋參數。回傳一份草稿：場景狀態拿掉、感載歸零、餘韻留著、性經歷、體悟、關係、橋參數、傾向、
 * activity.end 的結果併進來（發起的人可以回傳變更、行、launch、rewind）。
 */
export function endDraft(k: Kernel, p: Play, reason: EndReason, lead: TimelineBeat[], rawClosing?: unknown): ReportDraft {
  if (p.solo) return soloEndDraft(k, p, reason, lead, rawClosing)
  const { s, state, rules } = p
  const skip = reason === 'skip'
  p.s.step += 1
  // 共鳴 end_fit：場景結束時，主角和每個對象的契合各加 n（離開這一圈的、別的圈的也算；先加才評價）
  const endFit = p.res[s.pc]?.end_fit ?? 0
  if (endFit > 0) {
    for (const id of Object.keys(s.pairs)) s.pairs[id]!.fit = Math.min(100, s.pairs[id]!.fit + endFit)
    for (const c of s.circles) c.fit = Math.min(100, c.fit + endFit)
    p.beats.push(beat(s.pc, '（夜課的功夫沒有白費，這一場收得很漂亮。）', 'resonance', { end_fit: endFit }))
  }
  // 主角對每個對象各有一份（P33）：離開這一圈的也算；整場的契合是所有對象的平均，每個對象各自評價
  const pairIds = Object.keys(s.pairs)
  const partnerId = pairIds[0] ?? p.partnerId
  const fit = pairIds.length > 0 ? Math.round(pairIds.reduce((a, id) => a + s.pairs[id]!.fit, 0) / pairIds.length) : 0
  const band = ratingOf(rules, fit)
  const pc = state.actors[s.pc]!
  const rec = sexRecordOf(pc)
  // 外殼放進來的 AI 收尾結果：程式驗過才用，丟掉或夾住的每一處留一筆提醒
  const notes: ClampNote[] = []
  const closing = readClosing(rawClosing, s.nature, p.everyone.filter((id) => id !== s.pc), notes)

  // 體悟：整場只給一次（照平均的契合）；第一次（這個人、體位、標籤）各種各算一次；略過打七折
  const insightNotes: string[] = []
  let insight = band.insight
  if (pairIds.some((id) => s.pairs[id]!.first)) {
    insight += rules.first_bonus
    insightNotes.push('第一次和這個人')
  }
  const used = skip ? [] : s.used_positions
  for (const id of used) {
    if (!rec.positions.includes(id)) {
      insight += rules.first_bonus
      insightNotes.push(`第一次用「${k.content.get('position', id)?.name ?? id}」`)
    }
  }
  const touched = [...new Set([...s.tags, ...(skip ? [] : s.touched)])]
  for (const t of touched) {
    if (!rec.tags.includes(t)) {
      insight += rules.first_bonus
      insightNotes.push(`第一次碰「${p.tagName(t)}」`)
    }
  }
  if (skip) {
    insight = Math.round(insight * rules.skip_mult)
    insightNotes.push('略過：打七折')
  }

  // 關係：每個對象各自的評價定方向；收尾有給數字就用它（夾在那一級的範圍裡）
  const pairResult: Record<string, { fit: number; rating: string; rating_id: string; affinity: number }> = {}
  const relFx: Fx[] = []
  relateStrays(pairIds, closing, notes)
  for (const id of pairIds) {
    const b = ratingOf(rules, s.pairs[id]!.fit)
    const amount = relateAmount(p, b, id, closing, notes)
    pairResult[id] = { fit: s.pairs[id]!.fit, rating: b.name, rating_id: b.id, affinity: amount }
    if (amount !== 0) relFx.push({ kind: 'affinity', key: id, amount })
  }
  // 成長：傾向照這一場碰到的標籤、「難忘」讓有變成深、橋參數那一點（P44）
  const growth = planGrowth(k, p, { band, skip, touched, closing, notes })
  // 記憶被抹掉的場景（amnesia）：傾向不長（M4-followups-2 第 7 項）
  const amnesia = s.amnesia === true
  const rel = settleEffects(k, state, s.pc, relFx)
  const tend = amnesia ? { changes: [] as Change[], lines: [] as string[], clamps: [] as ClampNote[] } : settleEffects(k, state, s.pc, growth.tendency)
  const brd = settleEffects(k, state, s.pc, growth.bridge)
  const bridgeGain = brd.changes.length > 0 ? growth.bridge_gain : undefined
  const fx = { changes: [...rel.changes, ...tend.changes, ...brd.changes], lines: [...rel.lines, ...tend.lines, ...brd.lines], clamps: [...rel.clamps, ...tend.clamps, ...brd.clamps] }

  // 沉溺（P43）：收尾給的或照退路，加上全檔過載累積的那一份，合計夾在 −4～+4，往下走 sink 效果（下限會擋）；別的座位只有過載累積的那一份
  const sink = planSink(k, p, pairIds, closing, notes)
  const sinkSet = amnesia ? NO_SINK : settleSink(k, state, s.pc, sink.total)
  fx.clamps.push(...sinkSet.clamps)
  const sinkLines: string[] = []
  const sinkChanges: Change[] = [...sinkSet.changes]
  for (const seat of amnesia ? [] : s.seats) {
    const n = Math.min(SINK_CAP, seat.sink_gain)
    if (n <= 0) continue
    if (seat.id !== s.pc) sinkChanges.push({ op: 'actor.track', id: seat.id, track: 'sink', delta: n })
    sinkLines.push(`${seat.id === s.pc ? '你' : state.actors[seat.id]!.name}在${p.sync.gears.full.name}檔過載：沉溺 +${n}。`)
  }
  if (!amnesia && (sink.total !== 0 || sinkSet.actual !== 0)) sinkLines.push(`這一場的沉溺：${SINK_KIND_NAME[sink.kind]}，${signed(sinkSet.actual)}。`)

  // 性經歷：每個人各記一筆（次數 +1、每個一起的人都記進對象；對象的人數照實加）。主角和每個對象；同一圈的人彼此；別的圈的人彼此
  const service = s.nature === 'trade' || s.nature === 'work'
  const linked = new Map<string, string[]>()
  const link = (a: string, b: string): void => {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const list = linked.get(x) ?? []
      if (!list.includes(y)) list.push(y)
      linked.set(x, list)
    }
  }
  for (const id of pairIds) link(s.pc, id)
  const together = (people: string[]): void => people.forEach((a, i) => people.slice(i + 1).forEach((b) => link(a, b)))
  together([s.pc, ...s.seats.filter((x) => x.id !== s.pc).map((x) => x.id)])
  for (const c of s.circles) together([...c.people, ...(c.out ?? [])])
  const inMain = new Set([s.pc, ...pairIds, ...s.seats.map((x) => x.id)])
  const sayings = sexNotes(p, closing, notes)
  const tie = (id: string): number => meterOf(k, state, 'affinity', id)
  const records: Change[] = []
  for (const [id, partners] of amnesia ? [] : linked) {
    const actor = state.actors[id]
    if (!actor) continue
    const names = partners.filter((x) => !!state.actors[x]).map((x) => ({ id: x, name: state.actors[x]!.name, look: lookOf(state, x) }))
    if (names.length === 0) continue
    const svc = id === s.pc ? service && s.role === 'worker' : pairIds.includes(id) && service && s.role === 'guest'
    records.push({
      op: 'actor.ext', id, key: 'sex_record',
      value: recordSceneWith(sexRecordOf(actor), {
        partners: names, service: svc, positions: inMain.has(id) ? used : [], tags: inMain.has(id) ? touched : [], nature: s.nature,
        ...(id === s.pc ? { notes: sayings, tie } : {}),
      }),
    })
  }

  // 目的
  const goalDone = s.goal !== null && (s.goal_progress ?? 0) >= rules.goal_done_at
  // 這一場開過的最高檔位
  // 報告的舊鍵：一對一的 { pc, partner }
  const maxGear = { pc: p.seat(s.pc).max_gear, partner: (p.s.seats.find((x) => x.id === partnerId) ?? p.seat(s.pc)).max_gear }
  const circlesResult = s.circles.map((c) => ({ id: c.id, people: [...c.people, ...(c.out ?? [])], fit: c.fit, rating: ratingOf(rules, c.fit).name, climax: { ...c.climax } }))
  // 一對一（只有一個對象、沒有別的圈）的結果照舊；多人才多 pairs 與 circles
  const multi = pairIds.length > 1 || s.circles.length > 0 || s.kind === 'group'
  const result = {
    with: partnerId, fit, rating: band.name, goal: s.goal, goal_done: goalDone, reason, ...(s.layer === 'net' ? { layer: s.layer } : {}), max_gear: maxGear, ...(multi ? { pairs: pairResult, circles: circlesResult } : {}),
    sink: sinkSet.actual, sink_kind: sink.kind, touched: touched.filter((t) => contentAllowed(state.rules, t)), tendency: amnesia ? [] : growth.tags, ...(bridgeGain ? { bridge_gain: bridgeGain } : {}), ...(growth.deep && !amnesia ? { deep: growth.deep } : {}),
    ...(amnesia ? { amnesia: true } : {}),
  }
  const end = endActivity(k, { state, kind: ACTIVITY, id: s.id, origin: s.origin, outcome: reason, result })
  if (end.rewind) end.launch = []

  const changes: Change[] = [
    { op: 'ext', key: EXT, value: null },
    ...trackChanges(p, true),
    ...(p.consumed ? [{ op: 'item', id: p.consumed, qty: -1 } as Change] : []),
    ...(insight !== 0 ? [{ op: 'meter', kind: 'insight', key: '_', delta: insight } as Change] : []),
    ...sinkChanges, ...fx.changes, ...records, ...end.changes,
  ]
  const glowText = s.seats.map((x) => `${x.id === s.pc ? '你' : state.actors[x.id]!.name} ${p.glow[x.id]}／${p.glowMax[x.id]} 層`).join('、')
  const results = amnesia ? [`${END_NAME[reason]}。`, AMNESIA_RESIDUE, ...end.lines] : [
    `${END_NAME[reason]}。`, `契合 ${fit}：${band.name}。`,
    ...(pairIds.length > 1 ? pairIds.map((id) => `和${state.actors[id]?.name ?? id}：契合 ${pairResult[id]!.fit}，${pairResult[id]!.rating}。`) : []),
    ...circlesResult.filter((c) => c.people.length > 1).map((c) => `${c.people.map((id) => state.actors[id]?.name ?? id).join('、')}那一邊：契合 ${c.fit}，${c.rating}。`),
    `體悟 +${insight}${insightNotes.length > 0 ? `（${insightNotes.join('、')}）` : ''}。`, ...fx.lines, ...sinkLines,
    ...(s.goal ? [`目的「${GOAL_NAME[s.goal]}」：${goalDone ? '達成了' : '沒有達成'}。`] : []),
    `餘韻：${glowText}。`, ...end.lines,
  ]
  const finalBeat = beat(s.pc, `場景結束：${END_NAME[reason]}。契合 ${fit}，${band.name}。`, 'scene.end', { reason, fit, rating: band.id, insight, max_gear: maxGear, ...(multi ? { pairs: pairResult } : {}) })
  const d = sceneDraft(state, p, 'scene.end', [...lead, ...p.beats, finalBeat], changes, reason, `${END_NAME[reason]}。契合 ${fit}，${band.name}。`)
  if (amnesia) d.outcome.amnesia = true
  d.narration = { results }
  const clamps = [...notes, ...fx.clamps]
  if (clamps.length > 0) d.clamps = clamps
  if (p.said) d.input = p.said
  return attachActivityEnd(d, end)
}

/**
 * 單人的結算（LEWD_SYSTEM 3.5 節第九點）：評價用同一張表、看節奏；體悟＝那一級的體悟 × solo.insight_mult（進位）加上第一次用某個姿勢、第一次碰某個標籤的加成；
 * 不改任何人的關係、橋參數那一點照評價的機率落在主角（哪一項照 bridgeParamOf）、傾向照碰到的標籤（難忘也一樣）；性經歷只加 solo_times（與用過的姿勢、碰過的標籤），次數、對象人數都不動；
 * 沉溺：規則退路是 0，加上全檔過載累積的那一份，合計夾在 −4～+4；`goal: 'footage'` 時節奏到過 goal_done_at 算達成（素材本身是 M5 的事）。
 */
function soloEndDraft(k: Kernel, p: Play, reason: EndReason, lead: TimelineBeat[], rawClosing?: unknown): ReportDraft {
  const { s, state, rules } = p
  const skip = reason === 'skip'
  p.s.step += 1
  const pace = s.pace ?? 0
  const band = ratingOf(rules, pace)
  const pc = state.actors[s.pc]!
  const rec = sexRecordOf(pc)

  // 體悟：表的數字打折（進位到整數）；第一次用某個姿勢、第一次碰某個標籤照舊；略過再打七折
  const insightNotes: string[] = [`單人：打${Math.round(rules.solo.insight_mult * 100) / 10}折`]
  let insight = Math.ceil(band.insight * rules.solo.insight_mult)
  const used = skip ? [] : s.used_positions
  const seen = soloPosesSeen(rec)
  for (const id of used) {
    if (!seen.includes(id)) {
      insight += rules.first_bonus
      insightNotes.push(`第一次用「${p.posNameOf(id)}」`)
    }
  }
  const touched = [...new Set([...s.tags, ...(skip ? [] : s.touched)])]
  for (const t of touched) {
    if (!rec.tags.includes(t)) {
      insight += rules.first_bonus
      insightNotes.push(`第一次碰「${p.tagName(t)}」`)
    }
  }
  if (skip) {
    insight = Math.round(insight * rules.skip_mult)
    insightNotes.push('略過：打七折')
  }

  // 傾向照碰到的標籤、「難忘」讓有變成深、橋參數那一點照評價的機率（落在主角自己）；不改任何人的親密度
  const notes: ClampNote[] = []
  const closing = readClosing(rawClosing, s.nature, [], notes)
  relateStrays([], closing, notes)
  const growth = planGrowth(k, p, { band, skip, touched, closing, notes })
  const amnesia = s.amnesia === true
  const tend = amnesia ? { changes: [] as Change[], lines: [] as string[], clamps: [] as ClampNote[] } : settleEffects(k, state, s.pc, growth.tendency)
  const brd = settleEffects(k, state, s.pc, growth.bridge)
  const bridgeGain = brd.changes.length > 0 ? growth.bridge_gain : undefined
  const fx = { changes: [...tend.changes, ...brd.changes], lines: [...tend.lines, ...brd.lines], clamps: [...tend.clamps, ...brd.clamps] }

  // 性經歷：只加單人的次數、用過的姿勢與碰過的標籤
  const record: Change | null = amnesia ? null : { op: 'actor.ext', id: s.pc, key: 'sex_record', value: recordSolo(rec, { poses: used, tags: touched }) }

  const goalDone = s.goal === 'footage' && Math.max(s.goal_progress ?? 0, pace) >= rules.goal_done_at
  // 沉溺：收尾給的或退路 0，加上全檔過載累積的那一份，合計夾在 −4～+4
  const sink = planSink(k, p, [], closing, notes)
  const sinkSet = amnesia ? NO_SINK : settleSink(k, state, s.pc, sink.total)
  fx.clamps.push(...sinkSet.clamps)
  const sinkLines: string[] = []
  const sinkChanges: Change[] = [...sinkSet.changes]
  if (!amnesia && sink.gain > 0) sinkLines.push(`你在${p.sync.gears.full.name}檔過載：沉溺 +${sink.gain}。`)
  if (!amnesia && (sink.total !== 0 || sinkSet.actual !== 0)) sinkLines.push(`這一場的沉溺：${SINK_KIND_NAME[sink.kind]}，${signed(sinkSet.actual)}。`)
  const maxGear = { pc: p.seat(s.pc).max_gear }
  const result = {
    solo: true, pace, rating: band.name, goal: s.goal, goal_done: goalDone, reason, ...(s.layer === 'net' ? { layer: s.layer } : {}), max_gear: maxGear, audience: s.audience === true,
    sink: sinkSet.actual, sink_kind: sink.kind, touched: touched.filter((t) => contentAllowed(state.rules, t)), tendency: amnesia ? [] : growth.tags, ...(bridgeGain ? { bridge_gain: bridgeGain } : {}), ...(growth.deep && !amnesia ? { deep: growth.deep } : {}),
    ...(amnesia ? { amnesia: true } : {}),
  }
  const end = endActivity(k, { state, kind: ACTIVITY, id: s.id, origin: s.origin, outcome: reason, result })
  if (end.rewind) end.launch = []

  const changes: Change[] = [
    { op: 'ext', key: EXT, value: null },
    ...trackChanges(p, true),
    ...(p.consumed ? [{ op: 'item', id: p.consumed, qty: -1 } as Change] : []),
    ...(insight !== 0 ? [{ op: 'meter', kind: 'insight', key: '_', delta: insight } as Change] : []),
    ...sinkChanges, ...fx.changes, ...(record ? [record] : []), ...end.changes,
  ]
  const glowText = s.seats.map((x) => `你 ${p.glow[x.id]}／${p.glowMax[x.id]} 層`).join('、')
  const results = amnesia ? [`${END_NAME[reason]}。`, AMNESIA_RESIDUE, ...end.lines] : [
    `${END_NAME[reason]}。`, `節奏 ${pace}：${band.name}。`, `體悟 +${insight}（${insightNotes.join('、')}）。`, ...fx.lines, ...sinkLines,
    ...(s.goal ? [`目的「${GOAL_NAME[s.goal]}」：${goalDone ? '達成了' : '沒有達成'}。`] : []),
    `餘韻：${glowText}。`, ...end.lines,
  ]
  const finalBeat = beat(s.pc, `場景結束：${END_NAME[reason]}。節奏 ${pace}，${band.name}。`, 'scene.end', { reason, solo: true, pace, rating: band.id, insight, max_gear: maxGear })
  const d = sceneDraft(state, p, 'scene.end', [...lead, ...p.beats, finalBeat], changes, reason, `${END_NAME[reason]}。節奏 ${pace}，${band.name}。`)
  if (amnesia) d.outcome.amnesia = true
  d.narration = { results }
  const clamps = [...notes, ...fx.clamps]
  if (clamps.length > 0) d.clamps = clamps
  if (p.said) d.input = p.said
  return attachActivityEnd(d, end)
}
