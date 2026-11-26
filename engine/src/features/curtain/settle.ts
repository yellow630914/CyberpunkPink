// L6 功能 curtain 的結算（掛點 netrun.close）與加演（CYBERSPACE 8.8 節「一趟的結構」「打賞」「打輸會怎樣」開頭；8.2 節延長賽）。
//
//   done（走完終幕）        破關獎金（席次的 prize）＋打賞（獎金 × 場熱那一段的比例 × tips_mult；主打的夜 × feature_bonus；同伴沒有）＋保證金退回；member.clears +1；
//                           這一週的 tips 累加。場熱到過 encore 門檻、或點單全部完成：留下加演的資格。
//   提早落幕（場熱到 0）     不算戰敗，以 done 收場：保證金退回、票根留著，沒有破關獎金與打賞，也不算破關次數。
//   全員拔線／登出          保證金退一半、票根留著、沒有獎金與打賞。
//   defeat（全隊倒下）       只記下輸在哪一幕、當時的場熱（run.lost）；戰敗被接受之後 report.after 發 curtain.fall（fall.ts：落幕、補演、三條路、母帶）。
//   簽著檔期（gig）          破關獎金與打賞只拿 split（四成）；保證金退回不受影響。
// 倒下的人不加沉溺、不丟東西（熔斷的場地 region.safe；netrun 的 lossOf 只管被定位）。
// 加演：第 5、6 幕開第二趟 netrun（兩層），敵人高一、兩級，獎金 ×2、×4，保證金不加；場熱接著原本那一趟。

import type { Change, GameState, Kernel, Launch, ReportDraft } from '../../core'
import { ActionBlocked, clone, formatAmount } from '../../core'
import { defOf } from './ctx'
import { heatDelta, heatOf, overshoot, tipsRatio } from './heat'
import type { CurtainRules, EncoreRec, RunRecord, SettleResult } from './model'
import { ENCORE_ACTION, ENCORE_VOID_ACTION, ORIGIN_BY, REGION_ID, RESULT_ACTION, curtainChange, curtainRules, nowOf, readCurtain, tierOf } from './model'
import { allActs, resetTally, roundsOf } from './nodes'
import { actOf } from './battle'
import { allOrdersDone } from './orders'
import { patch, runPatch } from './patch'
import { stubsOf } from './tables'
import { draftOf } from './util'
import { ACT_NETRUN } from './model'
import { layerCountsOf } from './enter'
import { nightOf } from './nights'
import { gigMult } from './fall'
import { hasBridge, hasDeck } from './member'
import { doorBlock } from './door'

interface RunLike {
  id: string
  layer: number
  map: string
  origin: { by: string }
}

const money = (n: number): string => `C$${formatAmount(n)}`

/**
 * 這一趟被 netrun 收掉了（掛點 netrun.close）：outcome 是 done、left、retreat、located、defeat。
 * 回傳併進結束那份報告的變更與句子；結果記在 run.over，等那份報告套用之後由 report.after 發 curtain.result 並把這一趟清掉。
 */
export function closeRun(k: Kernel, state: GameState, run: RunLike, outcome: string): { changes: Change[]; lines: string[] } | undefined {
  const r = readCurtain(state).run
  if (!r || r.over || run.origin.by !== ORIGIN_BY) return undefined
  const rules = curtainRules(k)
  const tier = tierOf(rules, r.tier)
  if (!tier) return undefined
  const act = actOf(rules, r, run.layer)
  const heat0 = heatOf(k, state, run.map)
  const stubs = stubsOf(state)
  const tally = resetTally(state, r.id, allActs({ rules }))
  // 全隊倒下：只記輸在哪一幕、當時的場熱（M4-curtain-fall 接手）
  if (outcome === 'defeat') {
    return { changes: [runPatch({ set: { lost: { act, heat: heat0 } } }), ...tally], lines: ['全隊倒下了：館方的熔斷設定沒有讓任何人受傷，接下來是落幕。'] }
  }
  const done = outcome === 'done'
  const early = r.cut === true
  // 離開那一幕超過標準回合的罰，算進最後的場熱（只有走完的結算要用；其餘照現在的場熱）
  const pen = done && !early ? overshoot(rules, roundsOf(state, r.id, act), defOf(rules, act).turns) : { over: 0, heat: 0 }
  const heat = Math.max(0, Math.min(100, heat0 + pen.heat))
  const kept = Math.max(0, r.deposit - (r.docked ?? 0))
  const lines: string[] = []
  const changes: Change[] = [...tally]
  changes.push(...heatDelta(run.map, pen.heat))
  let prize = 0
  let tips = 0
  let ratio = 0
  let refund = 0
  let clears: number | undefined
  let mult = 0
  if (early) {
    refund = kept
    // 加演中途散場：已經走完的那幾幕的獎金照算（和自己登出同一個算法；CYBERSPACE 8.8 節「已經拿到的獎金與票根照算，沒有打賞」）
    if (r.encore && run.layer >= 1) prize = Math.round(tier.prize * (rules.encore.prize[Math.min(run.layer - 1, rules.encore.prize.length - 1)] ?? 1))
    lines.push(`觀眾散場了：提早落幕，不算戰敗。保證金退回，票根留著，${prize > 0 ? `加演已經走完的那幾幕獎金 ${money(prize)} 照算，` : '沒有破關獎金，'}沒有打賞。`)
  } else if (done) {
    mult = r.encore ? (rules.encore.prize[Math.min(run.layer, rules.encore.prize.length - 1)] ?? 1) : 1
    prize = Math.round(tier.prize * mult)
    ratio = tipsRatio(rules, heat)
    tips = Math.round(prize * ratio * (r.tips_mult ?? 1) * (r.feature ? rules.feature_bonus : 1))
    // 簽著檔期：獎金與打賞只拿 split（館六你四）
    const split = gigMult(k, state)
    if (split !== 1) {
      prize = Math.round(prize * split)
      tips = Math.round(tips * split)
    }
    refund = kept
    if (!r.encore) clears = 1
    lines.push(`破關了。${r.encore ? `加演的獎金 ×${mult}：` : ''}獎金 ${money(prize)}，場熱 ${heat}（打賞 ×${ratio}${r.feature ? `、主打 ×${rules.feature_bonus}` : ''}${(r.tips_mult ?? 1) !== 1 ? `、倍率 ×${r.tips_mult}` : ''}）打賞 ${money(tips)}${split !== 1 ? `（簽著檔期，獎金與打賞只拿 ${Math.round(split * 100)}%）` : ''}${refund > 0 ? `，保證金 ${money(refund)} 退回` : ''}。`)
  } else {
    // 全員拔線、登出：加演的一趟走過第一幕就登出拿第一幕的獎金（沒有打賞）；基本的四幕保證金退一半
    if (r.encore && run.layer >= 1) prize = Math.round(tier.prize * (rules.encore.prize[Math.min(run.layer - 1, rules.encore.prize.length - 1)] ?? 1))
    refund = r.encore ? 0 : Math.floor(kept / 2)
    lines.push(`你們中途離場了：保證金退一半（${money(refund)}），票根留著，沒有${prize > 0 ? '打賞' : '獎金與打賞'}。${prize > 0 ? `加演的第一幕走完了，獎金 ${money(prize)}。` : ''}`)
  }
  const cash = refund + prize + tips
  if (cash > 0) changes.push({ op: 'cash', delta: cash })
  const result: SettleResult = {
    outcome, ...(early ? { early: true } : {}), ...(r.encore ? { encore: r.encore } : {}), heat, act, prize, tips, tips_ratio: ratio, refund, forfeited: Math.max(0, r.deposit - refund), stubs,
    ...(clears ? { clears } : {}), lines: lines.slice(),
  }
  // 加演的資格
  let encore: EncoreRec | undefined
  if (done && !early && !r.encore && (r.encore_open === true || heat >= rules.heat.encore || allOrdersDone(r))) {
    encore = {
      from: r.id, night: r.night, tier: r.tier, grade: r.grade, party: [...r.party], feature: r.feature, pure_stage: r.pure_stage, heat, tips_mult: r.tips_mult ?? 1,
      day: nightOf(k, state), at: { ...(state.location.block ? { block: state.location.block } : {}), ...(state.location.facility ? { facility: state.location.facility } : {}) },
    }
    lines.push('場熱夠高（或點單全部完成）：館方開口邀加演，可以接著進第 5、6 幕。邀請只在今晚、你還站在簾口的時候有效。')
  }
  changes.push(patch({ ...(clears ? { clears } : {}), ...(tips > 0 ? { tips } : {}), ...(encore ? { encore } : {}), run: { set: { over: result } } }))
  return { changes, lines }
}

/** 結算之後（報告套用完、這一趟有 over）：發 curtain.result 並把這一趟收乾淨。 */
export function resultDraft(state: GameState, r: RunRecord): ReportDraft {
  const o = r.over!
  const money2 = (n: number): string => money(n)
  const early = o.early === true
  const done = o.outcome === 'done' && !early
  const summary = early
    ? `簾後館結算：提早落幕。${o.prize > 0 ? `獎金 ${money2(o.prize)}、` : ''}保證金 ${money2(o.refund)} 退回，票根 ${o.stubs} 枚留著。`
    : done
      ? `簾後館結算：場熱 ${o.heat}。獎金 ${money2(o.prize)}、打賞 ${money2(o.tips)}（×${o.tips_ratio}）、保證金 ${money2(o.refund)} 退回，票根 ${o.stubs} 枚。`
      : `簾後館結算：中途離場。保證金 ${money2(o.refund)} 退回、${money2(o.forfeited)} 沒收，票根 ${o.stubs} 枚留著。`
  const lines = done ? ['你們走完了簾後館的一晚。'] : early ? ['觀眾散場了，這一晚提早落幕。'] : ['你們中途離場了。']
  const d = draftOf(state, RESULT_ACTION, done ? 'done' : early ? 'early' : 'left', summary, [runPatch({ clear: true })], { lines })
  d.timeline = [{ layer: 'net', ...(state.pc ? { actor: state.pc } : {}), text: lines[0]!, tag: RESULT_ACTION, data: clone(o) as unknown as Record<string, unknown> }]
  return d
}

// ---- 加演 ----

/** 加演的邀請收回的那一句（離開簾口、或過了這一晚）。 */
export const ENCORE_WITHDRAWN = '館方收回了加演的邀請。'

/**
 * 加演的邀請作廢了嗎（使用者 2026-11-26 裁決 4）：只在結算之後的同一晚、人還站在簾口（簾口在潛入裡時就是潛入中的那一格）接得了；
 * 過了這一晚（nightOf 換了）、或站的位置不是結算時的那一格，就作廢。舊存檔的邀請沒有記晚與位置的，當成沒有作廢。
 */
export function encoreStale(k: Kernel, state: GameState, rec: EncoreRec): boolean {
  if (rec.day !== undefined && nightOf(k, state) !== rec.day) return true
  if (rec.at && ((rec.at.block ?? undefined) !== (state.location.block ?? undefined) || (rec.at.facility ?? undefined) !== (state.location.facility ?? undefined))) return true
  return false
}

/** 作廢的那一份報告（curtain.encore_void）：拿掉邀請、一句「館方收回了加演的邀請」。 */
export function encoreVoidDraft(state: GameState): ReportDraft {
  return draftOf(state, ENCORE_VOID_ACTION, 'void', ENCORE_WITHDRAWN, [patch({ encore: null })], { lines: [ENCORE_WITHDRAWN] })
}

/** 現在加演不了的原因（一條一句）；能是空的。 */
export function encoreBlocks(k: Kernel, state: GameState): string[] {
  const cur = readCurtain(state)
  const p: string[] = []
  if (!cur.encore) return ['現在沒有加演的邀請：場熱要到過 90，或這一趟的點單全部接受而且完成。']
  if (encoreStale(k, state, cur.encore)) return [ENCORE_WITHDRAWN]
  if (cur.fall) p.push('落幕之後的事還沒有處理完。')
  const door = doorBlock(k, state)
  if (door) p.push(door)
  if (!k.activity.get(ACT_NETRUN)) p.push('簾後館現在沒有開放。')
  if (cur.run) p.push('這一趟還沒有收場。')
  else if (k.activity.active(state).some((a) => a.kind === ACT_NETRUN)) p.push('已經有一趟網內的行程在進行，先把它做完。')
  const m = cur.member
  if (!m) p.push('你已經不是簾後館的會員了。')
  else if (m.suspended) p.push('會費逾期，會員證停權了：要重新面談才能再來。')
  const other = k.activity.blockOf(state, `commit:${ENCORE_ACTION}`)
  if (other) p.push(other)
  if (cur.encore) {
    for (const id of cur.encore.party) {
      const a = state.actors[id]
      if (!a) { p.push(`找不到角色 ${id}。`); continue }
      if (!state.party.includes(id)) p.push(`${a.name}不在你的隊上。`)
      if (!hasBridge(k, state, id)) p.push(`${a.name}沒有橋：沒有橋的人進不了簾後館。`)
      if (!hasDeck(k, state, id)) p.push(`${a.name}沒有自己的甲板：館方不租甲板。`)
    }
  }
  return p
}

/** 加演的資格（沒有是 null）：接著上一趟的場熱，第 5、6 幕，敵人高一、兩級，獎金 ×2、×4，保證金不加。 */
export const encoreOf = (state: GameState): EncoreRec | null => readCurtain(state).encore ?? null

/**
 * 進加演（報告 curtain.encore）：開第二趟 netrun（兩層：第 5、6 幕）；場熱接著上一趟、點單與條文重新算。不成立丟 ActionBlocked。
 * 保證金不加：這一趟的保證金是 0（原本的已經在上一趟結算時退回）。
 */
export function encoreDraft(k: Kernel, state: GameState, o: { seed?: number } = {}): ReportDraft {
  const blocks = encoreBlocks(k, state)
  if (blocks.length) throw new ActionBlocked(blocks.join(''))
  const rules: CurtainRules = curtainRules(k)
  const cur = readCurtain(state)
  const rec = cur.encore!
  const tier = tierOf(rules, rec.tier)!
  const id = `q${state.seq.uid + 1}`
  const party = state.party.filter((x) => rec.party.includes(x))
  const day = nightOf(k, state)
  cur.run = {
    id, night: rec.night, tier: rec.tier, grade: rec.grade, deposit: 0, feature: rec.feature, pure_stage: rec.pure_stage, party, companions: [], at: nowOf(state), day,
    encore: 1, act: rules.act_defs.length, start_heat: rec.heat, tips_mult: rec.tips_mult,
  }
  delete cur.encore
  const origin = { by: ORIGIN_BY, ref: rec.night, ext: { curtain: { run: id, night: rec.night, tier: rec.tier, feature: rec.feature, pure_stage: rec.pure_stage, encore: 1 } } }
  const encoreDefs = rules.encore.names.map((_, i) => defOf(rules, rules.act_defs.length + i))
  const setup: Record<string, unknown> = {
    region: { ...clone(rules.region), id: REGION_ID, safe: true, pressure: 'none' }, grade: tier.grade, faction: 'none', layers: [...rules.encore.names], layer_counts: layerCountsOf(encoreDefs), party,
    ...(tier.id === 'floor' ? { encounter: ['elite', 'elite', 'minion'] } : {}), ...(o.seed !== undefined ? { seed: o.seed } : {}),
  }
  const launch: Launch = { kind: ACT_NETRUN, setup, origin }
  const lines = [`你們接受了加演的邀請：第 5、6 幕，敵人比席次高 ${rules.encore.grades.map((g) => `${g}`).join('、')} 級，獎金 ×${rules.encore.prize.join('、×')}，保證金不加。場熱接著上一趟的 ${rec.heat}。`]
  return {
    kind: 'netrun', action: ENCORE_ACTION, location: clone(state.location), actor: state.pc!, party: [],
    timeline: [{ layer: 'net', actor: state.pc!, text: lines[0]!, tag: ENCORE_ACTION }],
    changes: [{ op: 'uid', advance: 1 }, curtainChange(cur)], outcome: { result: 'encore', summary: lines.join('') }, narration: { results: lines }, launch: [launch],
  }
}
