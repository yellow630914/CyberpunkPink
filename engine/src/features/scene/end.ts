// L6 功能 scene 的報告：每一步的草稿，以及結束時的一次結算（LEWD_SYSTEM 3.4 節、3.5 節第六點；dev/adr/0016 G11）。
// 結算只看程式的規則，不呼叫 AI（工單：沒有每回合的 AI；AI 關著時 G11 的數字）：評價、體悟、親密度、橋參數、傾向、餘韻帶著走、性經歷、目的。
// 整場的正文是結束之後 AI 的事：這份報告帶 adult: true，由外殼用 commitNarrated 寫（成人路由）。

import type { Change, ClampNote, GameState, Kernel, ReportDraft, TimelineBeat } from '../../core'
import { attachActivityEnd, clone, contentAllowed, effectCtx, endActivity } from '../../core'
import type { EndReason } from './model'
import { ACTIVITY, END_NAME, EXT, GOAL_NAME, beat, ratingOf, recordScene, sexRecordOf, sceneOf } from './model'
import type { Play } from './play'

type Fx = Record<string, unknown>

/** 一份報告共用的欄位。 */
export function sceneDraft(state: GameState, p: Play, action: string, timeline: TimelineBeat[], changes: Change[], result: string, summary: string): ReportDraft {
  return {
    kind: 'social', action, location: clone(state.location), actor: p.s.pc, party: [], timeline, changes, outcome: { result, summary }, adult: true,
  }
}

/** 感載與餘韻跟著人走：差多少就加減多少（actor.track）。結束時感載歸零。 */
function trackChanges(p: Play, over: boolean): Change[] {
  const out: Change[] = []
  for (const w of ['pc', 'partner'] as const) {
    const id = p.id(w)
    const load = (over ? 0 : p.load[w]) - p.state.actors[id]!.load
    const glow = p.glow[w] - p.state.actors[id]!.afterglow
    if (load !== 0) out.push({ op: 'actor.track', id, track: 'load', delta: load })
    if (glow !== 0) out.push({ op: 'actor.track', id, track: 'afterglow', delta: glow })
  }
  return out
}

const stepText = (p: Play): string => p.beats.filter((b) => b.tag !== 'round').map((b) => b.text).join('') || '場景繼續。'

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
  const s = sceneOf(state)
  return s ? s.lines.map((l) => beat(l.who === 'pc' ? s.pc : s.partner, l.text, 'scene.line')) : []
}

/**
 * 結束：結算並收尾（scene.end）。lead 是這一步之前的整場紀錄；p.beats 是這一步的。
 * 略過（reason skip）的體悟打七折、沒有用過的體位、不給橋參數。回傳一份草稿：場景狀態拿掉、感載歸零、餘韻留著、性經歷、體悟、關係、橋參數、傾向、
 * activity.end 的結果併進來（發起的人可以回傳變更、行、launch、rewind）。
 */
export function endDraft(k: Kernel, p: Play, reason: EndReason, lead: TimelineBeat[]): ReportDraft {
  const { s, state, rules } = p
  const skip = reason === 'skip'
  p.s.step += 1
  const band = ratingOf(rules, s.fit)
  const pc = state.actors[s.pc]!
  const partner = state.actors[s.partner]!
  const rec = sexRecordOf(pc)

  // 體悟：評價給的，加上第一次（這個人、體位、標籤）；略過打七折
  const notes: string[] = []
  let insight = band.insight
  if (s.first_person) {
    insight += rules.first_bonus
    notes.push('第一次和這個人')
  }
  const used = skip ? [] : s.used_positions
  for (const id of used) {
    if (!rec.positions.includes(id)) {
      insight += rules.first_bonus
      notes.push(`第一次用「${k.content.get('position', id)?.name ?? id}」`)
    }
  }
  const touched = [...new Set([...s.tags, ...(skip ? [] : s.touched)])]
  for (const t of touched) {
    if (!rec.tags.includes(t)) {
      insight += rules.first_bonus
      notes.push(`第一次碰「${p.tagName(t)}」`)
    }
  }
  if (skip) {
    insight = Math.round(insight * rules.skip_mult)
    notes.push('略過：打七折')
  }

  // 親密度與傾向落在主角身上；橋參數落在這一場受到最多感載的那一方（合拍 25%、難忘 50% 的機會 +1，ADR G11）
  const pcFx: Fx[] = []
  if (band.affinity !== 0) pcFx.push({ kind: 'affinity', key: s.partner, amount: band.affinity })
  for (const t of touched) if (contentAllowed(state.rules, t)) pcFx.push({ kind: 'tendency', tag: t })
  const settled = settleEffects(k, state, s.pc, pcFx)
  const fx = { changes: [...settled.changes], lines: [...settled.lines], clamps: [...settled.clamps] }
  if (!skip && band.bridge > 0 && p.dice.int(1, 100) <= Math.round(band.bridge * 100)) {
    const who = s.received.pc >= s.received.partner ? 'pc' : 'partner'
    const b = settleEffects(k, state, p.id(who), [{ kind: 'bridge', param: p.dice.int(0, 1) === 0 ? 'sensitivity' : 'tolerance', amount: 1 }])
    fx.changes.push(...b.changes)
    fx.lines.push(...b.lines)
    fx.clamps.push(...b.clamps)
  }

  // 性經歷：各記一筆
  const service = s.nature === 'trade' || s.nature === 'work'
  const records: Change[] = [
    { op: 'actor.ext', id: s.pc, key: 'sex_record', value: recordScene(rec, { partner: s.partner, partnerName: partner.name, service: service && s.role === 'worker', positions: used, tags: touched }) },
    { op: 'actor.ext', id: s.partner, key: 'sex_record', value: recordScene(sexRecordOf(partner), { partner: s.pc, partnerName: pc.name, service: service && s.role === 'guest', positions: used, tags: touched }) },
  ]

  // 目的
  const goalDone = s.goal !== null && (s.goal_progress ?? 0) >= rules.goal_done_at
  const result = { with: s.partner, fit: s.fit, rating: band.name, goal: s.goal, goal_done: goalDone, reason }
  const end = endActivity(k, { state, kind: ACTIVITY, id: s.id, origin: s.origin, outcome: reason, result })
  if (end.rewind) end.launch = []

  const changes: Change[] = [
    { op: 'ext', key: EXT, value: null },
    ...trackChanges(p, true),
    ...(p.consumed ? [{ op: 'item', id: p.consumed, qty: -1 } as Change] : []),
    ...(insight !== 0 ? [{ op: 'meter', kind: 'insight', key: '_', delta: insight } as Change] : []),
    ...fx.changes, ...records, ...end.changes,
  ]
  const results = [
    `${END_NAME[reason]}。`, `契合 ${s.fit}：${band.name}。`, `體悟 +${insight}${notes.length > 0 ? `（${notes.join('、')}）` : ''}。`, ...fx.lines,
    ...(s.goal ? [`目的「${GOAL_NAME[s.goal]}」：${goalDone ? '達成了' : '沒有達成'}。`] : []),
    `餘韻：你 ${p.glow.pc}／${p.glowMax.pc} 層、${partner.name} ${p.glow.partner}／${p.glowMax.partner} 層。`, ...end.lines,
  ]
  const finalBeat = beat(s.pc, `場景結束：${END_NAME[reason]}。契合 ${s.fit}，${band.name}。`, 'scene.end', { reason, fit: s.fit, rating: band.id, insight })
  const d = sceneDraft(state, p, 'scene.end', [...lead, ...p.beats, finalBeat], changes, reason, `${END_NAME[reason]}。契合 ${s.fit}，${band.name}。`)
  d.narration = { results }
  if (fx.clamps.length > 0) d.clamps = fx.clamps
  if (p.said) d.input = p.said
  return attachActivityEnd(d, end)
}
