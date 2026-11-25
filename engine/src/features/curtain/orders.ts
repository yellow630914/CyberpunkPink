// L6 功能 curtain 的點單（CYBERSPACE 8.8 節「點單」）：一個節點，走到才擲（d6，內容種類 curtain_table 的點單表）；接受或拒絕。
// 接受而且完成：場熱 +8、票根 3～8 枚（觀眾的紙條讓票根 ×2）；沒完成當拒絕（場熱 −5）。
//   換裝   下一場全隊的 skin_style 要對到主題、值 2 以上：開打時檢查（沒有人註冊 skin_style 時這一格重擲）
//   守規矩 下一場不能超頻、不能換檔：戰鬥結束時看這一場的事件
//   收尾   下一場最後一個被打倒的敵人是被神經或快感傷害打倒的
//   合演   開一場 scene（nature work、goal please、layer net）；對象是 director.cast 生成的演出者，或同行的人；結算照契合的評價換場熱（取代 +8）；沒有人回答時重擲
//   台詞   一個人過表演檢定（DC 照等級），大成功場熱再 +4；沒過當拒絕
//   返場   P57：沒有直播，重擲
// 純舞台場次（pure_stage）：合演換成一次表演檢定（沒有成人場景）。

import type { ActorId, BattleState, Change, GameState, Kernel, Launch, MarkerDef, ReportDraft, Report } from '../../core'
import { ActionBlocked, deriveRng, isRecord } from '../../core'
import type { Ctx } from './ctx'
import { usedAt, usedCell } from './ctx'
import { heatDelta, sceneHeat } from './heat'
import type { CurtainRules, OfferRec, OrderKind, OrderRec, RunRecord, TableRow } from './model'
import { ORIGIN_BY, isText } from './model'
import { runPatch } from './patch'
import { rollRow, stubChange, tableOf } from './tables'
import { BUSY, bestCheck, nameOf, partyOf, rngStep, rollPicked, useDraft } from './util'

const SKIN_CONDITION = 'skin_style'
const SKIN_MIN = 2

/** 每一種點單給玩家看的說明（只寫機制）。 */
export function orderText(kind: OrderKind, name: string, style?: string): string {
  switch (kind) {
    case 'skin': return `${name}：全隊穿${style ? `「${style}」風格` : '主題風格'}的 SKIN（風格值 ${SKIN_MIN} 以上）打完下一場。`
    case 'rules': return `${name}：下一場不能超頻、不能換檔。`
    case 'finish': return `${name}：下一場用神經或快感傷害打倒最後一個敵人。`
    case 'duet': return `${name}：兩個人進一場成人場景（自願）；結算照契合的評價換場熱。`
    case 'line': return `${name}：一個人過一次表演檢定，大成功場熱再加成。`
    case 'encore': return `${name}：沒有直播，這一格不會出現。`
  }
}

/** 風格的標籤（換裝）：列自己寫的，沒有就是這一夜的 style（字串或陣列），再沒有就是這一夜的 tags。 */
export function styleTags(c: Pick<Ctx, 'night'>, row?: Pick<TableRow, 'style'>): string[] {
  if (row?.style) return [row.style]
  const s = (c.night as unknown as { style?: unknown }).style
  if (isText(s)) return [s]
  if (Array.isArray(s) && s.every(isText) && s.length) return [...s]
  return [...c.night.tags]
}

/** 全隊現在穿的是不是這個主題（每個人至少有一個風格標籤達到 SKIN_MIN）。沒有人註冊 skin_style 一律不成立。 */
export function skinMatches(k: Kernel, state: GameState, who: readonly ActorId[], tags: readonly string[]): boolean {
  if (!k.conditions.kinds().includes(SKIN_CONDITION)) return false
  return who.length > 0 && who.every((id) => tags.some((tag) => k.conditions.test({ kind: SKIN_CONDITION, tag, min: SKIN_MIN }, { state, actor: id, stats: k.stats, timeRules: k.timeRules })))
}

// ---- 合演的對象 ----

interface Cast {
  actor: ActorId
  changes: Change[]
  /** 同行的人（不用新生成） */
  companion?: true
}

/** 對象：指定的同行的人，或問 director.cast 生成的演出者（沒有人回答是 null）。 */
export function partnerOf(c: Pick<Ctx, 'k' | 'state' | 'run' | 'night'>, withId?: ActorId): Cast | null {
  const { k, state, run } = c
  const mates = partyOf(state, run).filter((id) => id !== state.pc)
  if (withId !== undefined) return mates.includes(withId) ? { actor: withId, changes: [], companion: true } : null
  for (const { result } of k.hooks.run('director.cast', { state, event: 'curtain_duet', role: 'performer', spec: { gen: { faction: c.night.faction } } })) {
    const r = result as { actor?: unknown; changes?: Change[] } | undefined
    if (!r || typeof r.actor !== 'string') continue
    const made = (r.changes ?? []).some((ch) => ch.op === 'actor.add' && isRecord(ch.actor) && ch.actor.id === r.actor)
    if (state.actors[r.actor] || made) return { actor: r.actor, changes: (r.changes ?? []).map((ch) => ({ ...ch })) }
  }
  return mates[0] !== undefined ? { actor: mates[0], changes: [], companion: true } : null
}

// ---- 擲點單 ----

interface Usable {
  kind: OrderKind
  name: string
  style?: string
}

/** 這一列現在能不能當點單：返場一律重擲（P57）；換裝要有人答得出風格；合演要有對象（純舞台場次換成表演檢定）。不能是 null。 */
function usable(c: Ctx, row: TableRow): Usable | null {
  const kind = row.order
  if (!kind || kind === 'encore') return null
  const name = row.name ?? kind
  if (kind === 'skin') {
    const tags = styleTags(c, row)
    return tags.length && c.k.conditions.kinds().includes(SKIN_CONDITION) ? { kind, name, style: tags[0]! } : null
  }
  if (kind === 'duet') {
    if (c.run.pure_stage) return { kind: 'line', name: `${name}（純舞台：換成一段表演）` }
    return partnerOf(c) ? { kind, name } : null
  }
  return { kind, name }
}

/** 這個節點現在的點單（還沒擲過是 null）。 */
export const offerAt = (run: Pick<RunRecord, 'offer'>, marker: Pick<MarkerDef, 'id'>): OfferRec | null => (run.offer && run.offer.node === marker.id ? run.offer : null)

const orderIndexAt = (run: RunRecord, marker: Pick<MarkerDef, 'id'>, act: number): number => (run.orders ?? []).findIndex((o) => o.node === marker.id && o.act === act)

/** 這個點單節點現在做不了的原因（一句）；能是 null。 */
export function orderBlock(c: Ctx, marker: MarkerDef): string | null {
  if (c.state.battle) return BUSY
  if (c.run.cut) return '觀眾已經散場了，這一趟只能收場。'
  if (marker.mark !== 'p') return '這裡沒有點單。'
  if (c.g.at.x !== marker.at[0] || c.g.at.y !== marker.at[1]) return `「${marker.name}」要站在上面才看得到點單。`
  if (usedAt(c, marker) || orderIndexAt(c.run, marker, c.act) >= 0) return '這一個點單已經處理過了。'
  if (c.run.offer && c.run.offer.node !== marker.id) return '你還有一個看過的點單沒有決定接不接。'
  if (!tableOf(c.k, 'order', c.rules)) return '館方今晚沒有準備點單。'
  return null
}

/** 擲一個點單（報告 curtain.use，result: offer）：走到點單的節點才擲；不成立丟 ActionBlocked。 */
export function offerDraft(c: Ctx, marker: MarkerDef): ReportDraft {
  const block = orderBlock(c, marker)
  if (block) throw new ActionBlocked(block)
  const existing = offerAt(c.run, marker)
  if (existing) throw new ActionBlocked('這個點單已經擲過了，接受或拒絕它。')
  const table = tableOf(c.k, 'order', c.rules)!
  const purpose = `curtain/${c.run.id}/order/${c.act}/${marker.id}`
  let found: Usable | null = null
  for (let i = 0; i < 40 && !found; i++) found = usable(c, rollRow(table, c.state, `${purpose}/${i}`))
  const changes: Change[] = [rngStep]
  if (!found) {
    changes.push(usedCell(c, marker) as Change)
    const lines = ['館方今晚臨時沒有點單，這個節點空了。']
    return useDraft(c.state, 'no_order', lines.join(''), changes, { lines })
  }
  const offer: OfferRec = { node: marker.id, act: c.act, kind: found.kind, name: found.name, ...(found.style ? { style: found.style } : {}) }
  changes.push(runPatch({ set: { offer } }))
  const text = orderText(found.kind, found.name, found.style)
  const lines = [`觀眾點了一個要求。${text}接受的話，完成了場熱 +${c.rules.heat.order_done}；拒絕場熱 ${c.rules.heat.order_refuse}。`]
  return useDraft(c.state, 'offer', lines.join(''), changes, { lines })
}

export interface OrderChoice {
  id: 'order:accept' | 'order:refuse'
  name: string
  block: string | null
}

/** 現在看過、等著決定的點單與兩個選項（沒有是 null）；duet 的對象選項放在 partners。 */
export function orderChoices(k: Kernel, state: GameState, run: RunRecord): { offer: OfferRec; text: string; choices: OrderChoice[]; partners: Array<{ id: ActorId; name: string }> } | null {
  const offer = run.offer
  if (!offer) return null
  const mates = offer.kind === 'duet' ? partyOf(state, run).filter((id) => id !== state.pc) : []
  void k
  return {
    offer, text: orderText(offer.kind, offer.name, offer.style),
    choices: [{ id: 'order:accept', name: '接受', block: state.battle ? BUSY : null }, { id: 'order:refuse', name: '拒絕', block: state.battle ? BUSY : null }],
    partners: mates.map((id) => ({ id, name: nameOf(state, id) })),
  }
}

// ---- 完成與沒完成 ----

/** 完成一個點單：場熱 +order_done（合演另外算）、票根 3～8 枚（紙條加倍）；回傳變更與句子。 */
export function completeChanges(c: Pick<Ctx, 'k' | 'state' | 'run' | 'rules' | 'map'>, index: number, o: { heat?: number; stubs?: boolean } = {}): { changes: Change[]; lines: string[]; stubs: number } {
  const [lo, hi] = c.rules.order_stubs
  const base = o.stubs === false ? 0 : deriveRng(c.state.rng, `curtain/${c.run.id}/order_stubs/${index}`).int(lo, hi)
  const stubs = c.run.double ? base * 2 : base
  const heat = o.heat ?? c.rules.heat.order_done
  const changes: Change[] = [
    ...heatDelta(c.map, heat), ...stubChange(stubs),
    runPatch({ order_set: { index, state: 'done', stubs }, ...(c.run.double && base > 0 ? { unset: ['double'] as Array<keyof RunRecord> } : {}) }),
  ]
  const lines = [`點單完成了：場熱 ${heat >= 0 ? '+' : ''}${heat}${stubs > 0 ? `，票根 ${stubs} 枚${c.run.double && base > 0 ? '（觀眾的紙條讓票根加倍）' : ''}` : ''}。`]
  return { changes, lines, stubs }
}

/** 沒完成（或拒絕）：場熱 −5。 */
export function refuseChanges(c: Pick<Ctx, 'run' | 'rules' | 'map'>, index: number): { changes: Change[]; lines: string[] } {
  const d = c.rules.heat.order_refuse
  return { changes: [...heatDelta(c.map, d), runPatch({ order_set: { index, state: 'refused' } })], lines: [`點單沒有完成：場熱 ${d}。`] }
}

// ---- 決定 ----

export interface DecideOpts {
  /** 合演的對象（同行的人）；沒寫是館方的演出者 */
  with?: ActorId
}

/** 接受或拒絕現在的點單（報告 curtain.use）。不成立丟 ActionBlocked。 */
export function decideDraft(c: Ctx, marker: MarkerDef | undefined, accept: boolean, o: DecideOpts = {}): ReportDraft {
  if (c.state.battle) throw new ActionBlocked(BUSY)
  if (c.run.cut) throw new ActionBlocked('觀眾已經散場了，這一趟只能收場。')
  const offer = c.run.offer
  if (!offer) throw new ActionBlocked('現在沒有等著決定的點單：走到點單的節點先看一下。')
  const m = marker ?? c.g.sheet.marker(offer.node)
  if (!m || m.id !== offer.node) throw new ActionBlocked('要站在點單的節點上才能決定。')
  if (c.g.at.x !== m.at[0] || c.g.at.y !== m.at[1]) throw new ActionBlocked(`「${m.name}」要站在上面才能決定。`)
  const index = (c.run.orders ?? []).length
  const rec = (state: OrderRec['state']): OrderRec => ({ kind: offer.kind, name: offer.name, state, act: offer.act, node: offer.node })
  const closing: Change[] = [usedCell(c, m) as Change, runPatch({ unset: ['offer'] })]
  if (!accept) {
    const r = refuseChanges(c, index)
    return useDraft(c.state, 'order_refused', `你拒絕了「${offer.name}」。${r.lines.join('')}`, [runPatch({ order_add: rec('refused') }), ...r.changes, ...closing], { lines: [`你拒絕了「${offer.name}」。`, ...r.lines] })
  }
  const add = runPatch({ order_add: rec('open') })
  switch (offer.kind) {
    case 'skin':
    case 'rules':
    case 'finish': {
      const lines = [`你接了「${offer.name}」。${orderText(offer.kind, offer.name, offer.style)}下一場開打時檢查。`]
      return useDraft(c.state, 'order_accepted', lines.join(''), [add, runPatch({ set: { pending: { kind: offer.kind, order: index, ...(offer.style ? { style: offer.style } : {}) } } }), ...closing], { lines })
    }
    case 'line': {
      const pick = bestCheck(c.k, c.state, partyOf(c.state, c.run), c.rules.checks.line)
      if (!pick) throw new ActionBlocked('隊上沒有人能做這個表演。')
      const r = rollPicked(c.k, c.state, pick, c.net.dc, `curtain/${c.run.id}/line/${c.act}/${offer.node}`, `上台念了一段台詞（${c.k.stats.attrName(pick.attr)}）`)
      const changes: Change[] = [rngStep, add]
      const lines: string[] = [`你接了「${offer.name}」。`]
      if (r.ok) {
        const crit = r.roll.degree === 'critical'
        const done = completeChanges(c, index, { heat: c.rules.heat.order_done + (crit ? c.rules.heat.line_crit : 0) })
        changes.push(...done.changes)
        lines.push(`${nameOf(c.state, pick.id)}的台詞${crit ? '全場都安靜了下來' : '念得很穩'}。`, ...done.lines)
      } else {
        const refused = refuseChanges(c, index)
        changes.push(...refused.changes)
        lines.push(`${nameOf(c.state, pick.id)}卡了詞，場面冷了下來。`, ...refused.lines)
      }
      return useDraft(c.state, r.ok ? 'order_done' : 'order_failed', lines.join(''), [...changes, ...closing], { lines, beats: [r.beat] })
    }
    case 'duet': {
      const cast = partnerOf(c, o.with)
      if (!cast) throw new ActionBlocked(o.with ? '那個人不在這一趟的隊上，不能合演。' : '館方找不到願意合演的人，這個點單只能拒絕。')
      const launch: Launch = {
        kind: 'scene',
        setup: { with: [cast.actor], nature: 'work', goal: 'please', layer: 'net', place: '簾後館' },
        origin: { by: ORIGIN_BY, ref: c.run.id, ext: { curtain: { duet: index, node: offer.node } } },
      }
      const lines = [`你接了「${offer.name}」，和${cast.companion ? nameOf(c.state, cast.actor) : '館方的演出者'}進了場。結算照契合的評價換場熱。`]
      return useDraft(c.state, 'order_accepted', lines.join(''), [...cast.changes, add, ...closing], { lines, launch: [launch] })
    }
    default:
      throw new ActionBlocked('這個點單不能接。')
  }
}

// ---- 戰鬥打完：驗收下一場的規矩 ----

type BeatLike = { tag?: string; data?: Record<string, unknown> }

/** 這場戰鬥每一拍（照順序）。 */
export const beatsOf = (reports: readonly Pick<Report, 'id' | 'timeline'>[], battle: Pick<BattleState, 'steps'>): BeatLike[] => {
  const ids = new Set(battle.steps)
  return reports.filter((r) => ids.has(r.id)).flatMap((r) => r.timeline as BeatLike[])
}

/** 守規矩：我方這一場超頻過（action.done 記在場地上）或換過檔。 */
export function brokeRules(battle: Pick<BattleState, 'units' | 'field'>, beats: readonly BeatLike[]): boolean {
  if (battle.field.curtain_oc === true) return true
  return beats.some((b) => b.tag === 'shift' && typeof b.data?.unit === 'string' && battle.units[b.data.unit]?.side === 'ally')
}

/** 收尾：最後一個被我方的攻擊打倒的敵人，那一擊是神經或快感傷害（attack.after 記在場地上；沒有敵人被打倒不成立）。 */
export function finishedByMind(battle: Pick<BattleState, 'field'>): boolean {
  return ['neural', 'pleasure'].includes(String(battle.field.curtain_finish ?? ''))
}

/** 戰鬥打完時驗收等著的點單：完成給場熱與票根，沒完成當拒絕。skinOk 是開打時檢查的結果。 */
export function resolvePending(
  c: Pick<Ctx, 'k' | 'state' | 'run' | 'rules' | 'map'>, battle: Pick<BattleState, 'units' | 'field' | 'steps'>, outcome: string, reports: readonly Pick<Report, 'id' | 'timeline'>[], skinOk: boolean | undefined,
): { changes: Change[]; lines: string[] } | null {
  const pending = c.run.pending
  if (!pending) return null
  const beats = beatsOf(reports, battle)
  const won = outcome === 'win'
  const ok = pending.kind === 'skin' ? won && skinOk === true : pending.kind === 'rules' ? won && !brokeRules(battle, beats) : won && finishedByMind(battle)
  const name = c.run.orders?.[pending.order]?.name ?? '點單'
  const done = ok ? completeChanges(c, pending.order) : refuseChanges(c, pending.order)
  return { changes: [...done.changes, runPatch({ unset: ['pending'] })], lines: [...(ok ? [] : [`「${name}」沒做到。`]), ...done.lines] }
}

// ---- 場景結束：合演 ----

/** 合演的場景結束了（activity.end，kind scene、origin.by 是 curtain）：場熱照契合的評價換（取代點單完成的 +8）；打得不壞給票根。 */
export function duetEnded(c: Pick<Ctx, 'k' | 'state' | 'run' | 'rules' | 'map'>, index: number, fit: number): { changes: Change[]; lines: string[] } | null {
  const order = c.run.orders?.[index]
  if (!order || order.kind !== 'duet' || order.state !== 'open') return null
  const delta = sceneHeat(c.rules, fit)
  const done = completeChanges(c, index, { heat: delta, stubs: delta > 0 })
  return { changes: done.changes, lines: [`合演結束了，契合 ${fit}：場熱 ${delta >= 0 ? '+' : ''}${delta}${done.stubs > 0 ? `，票根 ${done.stubs} 枚` : ''}。`] }
}

/** 這一趟遇到的點單是不是全部接受而且完成（加演的另一個門檻）。 */
export const allOrdersDone = (run: Pick<RunRecord, 'orders'>): boolean => !!run.orders && run.orders.length > 0 && run.orders.every((o) => o.state === 'done')

export type { CurtainRules }
