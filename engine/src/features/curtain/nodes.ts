// L6 功能 curtain 的節點：賞箱、契約的條文、後台的近道、獎品室、層與層之間的化妝室與包場（CYBERSPACE 8.8 節）。
// 點單在 orders.ts。這些節點在 netrun 看來是「區的主人自己處理的標記」（region.handled）：netrun 不列它們的用途，這個功能自己列、自己做。
// 遭遇不是：遭遇節點的開戰與潛行繞過是 netrun 的，戰鬥的收尾（節點變地板、全員拔線、戰敗）也是它的。

import type { ActorId, Change, GridUse, MarkerDef, ReportDraft, RollPart } from '../../core'
import { ActionBlocked } from '../../core'
import type { Ctx } from './ctx'
import { defOf, neighbours, roleOf, standingOn, usedAt, usedCell } from './ctx'
import { heatDelta, overshoot } from './heat'
import { REST_ACTION } from './model'
import { decideDraft, offerAt, offerDraft, orderBlock } from './orders'
import { runPatch } from './patch'
import { rewardOf, stubChange, tableOf } from './tables'
import { BUSY, bestCheck, draftOf, nameOf, partyOf, rngStep, rollPicked, useDraft } from './util'

// ---- 這一趟的回合數（計數器是加法：一段路好幾格時每一格各問一次，讀到的狀態都是這一段路開始之前的） ----

export const roundKey = (id: string, act: number): string => `curtain:${id}:r${act}`
export const exploreKey = (id: string, act: number): string => `curtain:${id}:x${act}`

const count = (state: { counters: Record<string, number> }, key: string): number => {
  const v = state.counters[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 這一幕用了幾個回合（探索加戰鬥）。 */
export const roundsOf = (state: { counters: Record<string, number> }, id: string, act: number): number => count(state, roundKey(id, act))
/** 這一幕的探索回合數。 */
export const exploreOf = (state: { counters: Record<string, number> }, id: string, act: number): number => count(state, exploreKey(id, act))

/** 把這一趟的回合計數器歸零的變更。 */
export function resetTally(state: { counters: Record<string, number> }, id: string, acts: number): Change[] {
  const out: Change[] = []
  for (let a = 0; a < acts; a++) {
    for (const key of [roundKey(id, a), exploreKey(id, a)]) {
      const v = count(state, key)
      if (v !== 0) out.push({ op: 'counter', key, delta: -v })
    }
  }
  return out
}

/** 這一趟的探索與戰鬥的回合計數器，所有幕（含加演）。 */
export const allActs = (c: Pick<Ctx, 'rules'>): number => c.rules.act_defs.length + c.rules.encore.names.length

// ---- 找東西 ----

const dist = (c: Pick<Ctx, 'g'>, m: MarkerDef): number => Math.abs(m.at[0] - c.g.at.x) + Math.abs(m.at[1] - c.g.at.y)
const onIt = (c: Pick<Ctx, 'g'>, m: MarkerDef): boolean => dist(c, m) === 0

const stoppedBlock = (c: Ctx): string | null => (c.state.battle ? BUSY : null)

// 遭遇（開戰與潛行繞過）是 netrun 放的、netrun 列的：這個功能只在生成時回答每場遭遇的文化與等級（culture.ts 的 foeRefExtra），
// 戰鬥打完的收尾在 battle.ts（k.battle.onEnd），戰鬥開打時的標記在 battle.ts 的 onBattleStart。

// ---- 賞箱 ----

export function chestBlock(c: Ctx, marker: MarkerDef): string | null {
  const busy = stoppedBlock(c)
  if (busy) return busy
  if (marker.mark !== 'a') return '這裡沒有賞箱。'
  if (!onIt(c, marker)) return `「${marker.name}」要站在上面才打得開。`
  if (usedAt(c, marker)) return `「${marker.name}」已經打開過了，裡面空了。`
  if (!tableOf(c.k, 'chest', c.rules)) return '館方還沒有準備賞箱的東西。'
  return null
}

/** 開賞箱（報告 curtain.use，result: chest）：擲賞箱表一次（票根、東西、再擲獎品表、觀眾的紙條）。 */
export function chestDraft(c: Ctx, marker: MarkerDef): ReportDraft {
  const block = chestBlock(c, marker)
  if (block) throw new ActionBlocked(block)
  const got = rewardOf(c.k, c.state, c.rules, 'chest', { purpose: `curtain/${c.run.id}/chest/${c.act}/${marker.id}`, grade: c.tier.grade, night: c.night })
  const changes: Change[] = [rngStep, ...got.changes, usedCell(c, marker) as Change]
  if (got.double) changes.push(runPatch({ set: { double: true } }))
  const lines = [`打開了「${marker.name}」。`, ...got.lines]
  return useDraft(c.state, 'chest', `${lines.join('')}${got.stubs > 0 ? `票根 ${got.stubs} 枚。` : ''}`, changes, { lines })
}

// ---- 獎品室（終幕） ----

export function prizeBlock(c: Ctx, marker: MarkerDef): string | null {
  const busy = stoppedBlock(c)
  if (busy) return busy
  if (marker.mark !== 'p' || roleOf(c.def, marker) !== 'prize_room') return '這裡不是獎品室。'
  if (!onIt(c, marker)) return '要走進獎品室才領得到獎品。'
  if (usedAt(c, marker)) return '獎品已經領過了。'
  if (!tableOf(c.k, 'prize', c.rules)) return '館方還沒有準備獎品。'
  return null
}

/** 獎品室（報告 curtain.use，result: prize）：擲獎品表一次。 */
export function prizeDraft(c: Ctx, marker: MarkerDef): ReportDraft {
  const block = prizeBlock(c, marker)
  if (block) throw new ActionBlocked(block)
  const got = rewardOf(c.k, c.state, c.rules, 'prize', { purpose: `curtain/${c.run.id}/prize_room/${c.act}`, grade: c.tier.grade, night: c.night })
  const lines = ['獎品室裡：', ...got.lines]
  return useDraft(c.state, 'prize', lines.join(''), [rngStep, ...got.changes, usedCell(c, marker) as Change], { lines })
}

// ---- 契約的條文 ----

export function clauseBlock(c: Ctx, marker: MarkerDef): string | null {
  const busy = stoppedBlock(c)
  if (busy) return busy
  if (marker.mark !== 'c') return '這裡沒有條文。'
  if (!onIt(c, marker)) return `「${marker.name}」要站在上面才看得到條文。`
  if (usedAt(c, marker)) return '這一份條文已經處理過了。'
  return null
}

function signChanges(c: Ctx, marker: MarkerDef): { changes: Change[]; lines: string[] } {
  const cut = c.run.signed ? 0 : c.rules.clause.tips_cut
  return {
    changes: [...stubChange(c.rules.clause.stubs), runPatch({ set: { signed: true }, ...(cut > 0 ? { inc: { tips_mult: -cut } } : {}) }), usedCell(c, marker) as Change],
    lines: [`簽了名：${cut > 0 ? `這一趟的打賞少 ${Math.round(cut * 100)}%，` : ''}票根 +${c.rules.clause.stubs}。這份契約只在這一趟有效。`],
  }
}

/** 看穿條文（意志或調查對這一級的 DC）：看穿了直接過；沒看穿就簽了。報告 curtain.use，result: clause_read 或 clause_signed。 */
export function clauseDraft(c: Ctx, marker: MarkerDef): ReportDraft {
  const block = clauseBlock(c, marker)
  if (block) throw new ActionBlocked(block)
  const pick = bestCheck(c.k, c.state, partyOf(c.state, c.run), c.rules.checks.clause)
  if (!pick) throw new ActionBlocked('隊上沒有人能看條文。')
  const r = rollPicked(c.k, c.state, pick, c.net.dc, `curtain/${c.run.id}/clause/${c.act}/${marker.id}`, '逐條讀條文')
  if (r.ok) {
    const lines = [`${nameOf(c.state, pick.id)}看穿了條文裡的圈套，沒有簽就過去了。`]
    return useDraft(c.state, 'clause_read', lines.join(''), [rngStep, usedCell(c, marker) as Change], { lines, beats: [r.beat] })
  }
  const sign = signChanges(c, marker)
  const lines = [`${nameOf(c.state, pick.id)}沒看出條文的圈套，簽了名。`, ...sign.lines]
  return useDraft(c.state, 'clause_signed', lines.join(''), [rngStep, ...sign.changes], { lines, beats: [r.beat] })
}

/** 直接簽（不擲檢定）。 */
export function clauseSignDraft(c: Ctx, marker: MarkerDef): ReportDraft {
  const block = clauseBlock(c, marker)
  if (block) throw new ActionBlocked(block)
  const sign = signChanges(c, marker)
  return useDraft(c.state, 'clause_signed', sign.lines.join(''), sign.changes, { lines: ['你簽了名。', ...sign.lines] })
}

// ---- 後台的近道 ----

/** 這一層還擋著的、不是閘門前的遭遇（近道可以跳過其中一場）。 */
export function skippable(c: Ctx): MarkerDef[] {
  const nodes = c.net.foes[c.sheetId] ?? {}
  return Object.entries(nodes)
    .filter(([id, f]) => !f.gate && !f.done && c.g.sheet.marker(id)?.mark === 'f' && c.g.sheet.kindAt(c.g.sheet.marker(id)!.at[0], c.g.sheet.marker(id)!.at[1]) === 'net_foe')
    .map(([id]) => c.g.sheet.marker(id)!)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function shortcutBlock(c: Ctx, marker: MarkerDef): string | null {
  const busy = stoppedBlock(c)
  if (busy) return busy
  if (marker.mark !== 'b' || roleOf(c.def, marker) !== 'shortcut') return '這裡沒有近道。'
  if (!onIt(c, marker)) return `「${marker.name}」要站在上面才進得了後台的近道。`
  if (usedAt(c, marker)) return '這條近道已經走過了。'
  if (!skippable(c).length) return '這一層沒有可以跳過的遭遇了。'
  return null
}

/** 員工的 SKIN 偽裝：這個人穿著員工風格的 SKIN 時近道的檢定 +staff_bonus（沒有人註冊 skin_style 就沒有）。 */
function staffBonus(c: Ctx, id: ActorId): RollPart[] {
  if (!c.k.conditions.kinds().includes('skin_style')) return []
  const ok = c.k.conditions.test({ kind: 'skin_style', tag: c.rules.shortcut.staff_style, min: 1 }, { state: c.state, actor: id, stats: c.k.stats, timeRules: c.k.timeRules })
  return ok ? [{ label: '員工的偽裝', value: c.rules.shortcut.staff_bonus, source: 'situation' } as RollPart] : []
}

/** 走後台的近道（潛行，或員工的偽裝）：過了跳過一場遭遇（那一場沒有場熱）；沒過被場務抓到，保證金扣一成、場熱 −5，不打架。報告 curtain.use，result: shortcut 或 shortcut_fail。 */
export function shortcutDraft(c: Ctx, marker: MarkerDef): ReportDraft {
  const block = shortcutBlock(c, marker)
  if (block) throw new ActionBlocked(block)
  const who = partyOf(c.state, c.run)
  const pick = bestCheck(c.k, c.state, who, c.rules.checks.shortcut, (id) => staffBonus(c, id))
  if (!pick) throw new ActionBlocked('隊上沒有人能走這條近道。')
  const r = rollPicked(c.k, c.state, pick, c.net.dc, `curtain/${c.run.id}/shortcut/${c.act}/${marker.id}`, '從後台溜過去', staffBonus(c, pick.id))
  const changes: Change[] = [rngStep, usedCell(c, marker) as Change]
  if (r.ok) {
    const skip = skippable(c)[0]!
    changes.push(usedCell(c, skip, true) as Change)
    const lines = [`從後台的近道溜了過去，繞過了「${skip.name}」。那一場沒有場熱。`]
    return useDraft(c.state, 'shortcut', lines.join(''), changes, { lines, beats: [r.beat] })
  }
  const cut = Math.round(c.run.deposit * c.rules.shortcut.deposit_cut)
  changes.push(...heatDelta(c.map, c.rules.shortcut.heat), runPatch({ inc: { docked: cut } }))
  const lines = [`被場務抓到了。館方的規矩是罰錢，不是打人：保證金扣 C$${cut}，場熱 ${c.rules.shortcut.heat}。`]
  return useDraft(c.state, 'shortcut_fail', lines.join(''), changes, { lines, beats: [r.beat] })
}

// ---- 化妝室（層與層之間）與包場 ----

/** 化妝室：感載歸零、餘韻全消、RAM 回滿（戰鬥外本來就是滿的）、場熱 +5；順便把離開的那一幕超過標準回合的罰算進場熱。 */
export function restDraft(c: Ctx, o: { book?: boolean } = {}): ReportDraft {
  if (o.book) return bookDraft(c)
  const changes: Change[] = []
  for (const id of partyOf(c.state, c.run)) {
    const a = c.state.actors[id]!
    if (a.load > 0) changes.push({ op: 'actor.track', id, track: 'load', delta: -a.load })
    if (a.afterglow > 0) changes.push({ op: 'actor.track', id, track: 'afterglow', delta: -a.afterglow })
  }
  const lines = ['層與層之間是館方的化妝室：感載歸零、餘韻全消，RAM 回滿。']
  const prev = c.act - 1
  if (prev >= 0) {
    const standard = defOf(c.rules, prev).turns
    const over = overshoot(c.rules, roundsOf(c.state, c.run.id, prev), standard)
    if (over.heat !== 0) {
      changes.push(...heatDelta(c.map, over.heat), runPatch({ inc: { over_turns: over.over } }))
      lines.push(`上一幕超過標準回合 ${over.over} 回合，觀眾等得不耐煩：場熱 ${over.heat}。`)
    }
  }
  changes.push(...heatDelta(c.map, c.rules.heat.rest), runPatch({ set: { act: c.act, room: { act: c.act, x: exploreOf(c.state, c.run.id, c.act) } } }))
  lines.push(`場熱 +${c.rules.heat.rest}。`)
  if (c.run.sponsor) lines.push('贊助人在場：可以選「包場」，花一個探索回合讓他點一個私人的要求。')
  return draftOf2(c, 'rest', lines, changes)
}

const draftOf2 = (c: Ctx, result: string, lines: string[], changes: Change[]): ReportDraft => draftOf(c.state, REST_ACTION, result, lines.join(''), changes, { lines })

/** 化妝室現在開著嗎：剛到這一幕、還沒過任何探索回合。 */
export function roomOpen(c: Pick<Ctx, 'run' | 'state' | 'act'>): boolean {
  const room = c.run.room
  return !!room && room.act === c.act && room.x === exploreOf(c.state, c.run.id, c.act)
}

/** 包場現在做不了的原因（一句）；能是 null。 */
export function bookBlock(c: Ctx): string | null {
  const busy = stoppedBlock(c)
  if (busy) return busy
  if (!c.run.sponsor) return '沒有贊助人在場。'
  if (!roomOpen(c)) return '包場只能在剛進化妝室、還沒走動的時候選。'
  if ((c.run.booked ?? []).includes(c.act)) return '這一幕的包場已經選過了。'
  return null
}

/**
 * 包場（報告 curtain.rest，只在贊助人在場、人還在化妝室時有）：花一個探索回合讓贊助人點一個私人的要求：票根 +10、場熱 +10、之後這一趟的打賞 −1 成（你沒有在台上）。
 * 私人的要求只寫機制（只是陪坐，或合演另開）。
 */
export function bookDraft(c: Ctx): ReportDraft {
  const block = bookBlock(c)
  if (block) throw new ActionBlocked(block)
  const b = c.rules.book
  const changes: Change[] = [
    { op: 'counter', key: roundKey(c.run.id, c.act), delta: 1 }, { op: 'counter', key: exploreKey(c.run.id, c.act), delta: 1 },
    ...stubChange(b.stubs), ...heatDelta(c.map, c.rules.heat.book),
    runPatch({ inc: { tips_mult: -b.tips_cut }, booked: c.act, unset: ['room'] }),
  ]
  const lines = [`你在化妝室包了場，贊助人點了一個私人的要求。票根 +${b.stubs}，場熱 +${c.rules.heat.book}；你沒有在台上，之後這一趟的打賞少 ${Math.round(b.tips_cut * 100)}%。`]
  return useDraft(c.state, 'book', lines.join(''), changes, { lines })
}

// ---- 這一格與旁邊能做的事 ----

/** 一個標記現在能做的事（寶箱、條文、近道、獎品室站在上面，點單站在上面，遭遇站在旁邊）。 */
export function usesOfMarker(c: Ctx, marker: MarkerDef): GridUse[] {
  const role = roleOf(c.def, marker)
  switch (role) {
    case 'chest': return [{ id: 'chest', name: '開賞箱', block: chestBlock(c, marker) }]
    case 'prize_room': return [{ id: 'prize', name: '領獎品', block: prizeBlock(c, marker) }]
    case 'clause': return [{ id: 'clause', name: '讀條文', block: clauseBlock(c, marker) }, { id: 'clause:sign', name: '直接簽', block: clauseBlock(c, marker) }]
    case 'shortcut': return [{ id: 'shortcut', name: '走近道', block: shortcutBlock(c, marker) }]
    case 'order': {
      if (offerAt(c.run, marker)) {
        const block = stoppedBlock(c) ?? (onIt(c, marker) ? null : `「${marker.name}」要站在上面才能決定。`)
        return [{ id: 'order:accept', name: '接受點單', block }, { id: 'order:refuse', name: '拒絕點單', block }]
      }
      return [{ id: 'order', name: '看點單', block: orderBlock(c, marker) }]
    }
    default: return []
  }
}

/** 站在這一格上、旁邊有的標記，與各自能做的事。 */
export function nearUses(c: Ctx): Array<{ marker: MarkerDef; role: ReturnType<typeof roleOf>; uses: GridUse[] }> {
  const out: Array<{ marker: MarkerDef; role: ReturnType<typeof roleOf>; uses: GridUse[] }> = []
  const standing = standingOn(c)
  const list = [...(standing ? [standing] : []), ...neighbours(c).filter((m) => m.id !== standing?.id)]
  for (const m of list) {
    const role = roleOf(c.def, m)
    if (role === 'none') continue
    const uses = usesOfMarker(c, m)
    if (uses.length) out.push({ marker: m, role, uses })
  }
  return out
}

/** 做一件事：id 是 order、order:accept、order:refuse、chest、clause、clause:sign、shortcut、prize、book；at 是標記的 id（沒寫是站著的那一格；開戰要寫）。 */
export function useAt(c: Ctx, id: string, at?: string, o: { with?: ActorId } = {}): ReportDraft {
  if (id === 'book') return bookDraft(c)
  const standing = standingOn(c)
  let marker = standing
  if (at !== undefined) {
    marker = c.g.sheet.marker(at)
    if (!marker) throw new ActionBlocked(`這一層沒有「${at}」這個節點。`)
    if (marker.id !== standing?.id && dist(c, marker) !== 1) throw new ActionBlocked(`「${marker.name}」離這裡太遠了，要走到它旁邊（或站在上面）。`)
  }
  if (id === 'order:accept' || id === 'order:refuse') return decideDraft(c, marker ?? undefined, id === 'order:accept', o)
  if (id === 'order' && marker && offerAt(c.run, marker)) throw new ActionBlocked('這個點單已經擲過了，接受或拒絕它。')
  if (!marker) throw new ActionBlocked('這一格什麼都沒有，沒有可以做的事。')
  const use = usesOfMarker(c, marker).find((u) => u.id === id)
  if (!use) throw new ActionBlocked(`這裡沒有「${id}」可以做。`)
  if (use.block) throw new ActionBlocked(use.block)
  switch (id) {
    case 'order': return offerDraft(c, marker)
    case 'chest': return chestDraft(c, marker)
    case 'prize': return prizeDraft(c, marker)
    case 'clause': return clauseDraft(c, marker)
    case 'clause:sign': return clauseSignDraft(c, marker)
    case 'shortcut': return shortcutDraft(c, marker)
    default: throw new ActionBlocked(`這裡沒有「${id}」可以做。`)
  }
}

