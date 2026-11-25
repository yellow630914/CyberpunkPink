// L6 auction 的預展看貨（LEWD_SYSTEM 6.2 節「成交」裡預展看貨那一條；dev/adr/0019 P79）：
//   條件（一條一個原因）：腳下的設施是這一家；現在在預展的起訖裡；那一件是零件或義體；這一場這一件還沒看過（一件一次）。不必是會員。
//   檢定：by（主角或隊上的人，沒給是主角）的 fake.skills 裡等級最高的那一項（一樣高取前面的），屬性照那一項基本功的資料，對 fake.dc（加難度的偏移）。
//   成功：looked 記真的結果（ok 或 fake）；失敗：記 unknown。時間加 fake.minutes。
// 骰面用 rollCheck（從存檔的亂數導出，用途帶這一件的鍵）：重新讀檔重擲、結果不變；報告多一筆 rng 變更，同一件的下一個場次才換新的骰面。

import type { ActorId, AttrId, Change, CheckRoll, GameState, Kernel, ReportDraft, RollPart } from '../../core'
import { ActionBlocked, DEGREE_NAME, checkParts, clone, dcFor, formatTime, fromMinutes, makeCheck, rollCheck, toMinutes } from '../../core'
import type { CatalogLot } from './catalog'
import { LOOK_TEXT, catalogOf } from './catalog'
import type { LookResult } from './model'
import { FAKEABLE, INSPECT_ACTION, PATCH_OP, auctionOf, auctionRules, houseOf, isText, kindName, npcName } from './model'
import { housesHere, inPreview } from './session'

/** 內容沒有那一項基本功時屬性的預設。 */
const SKILL_ATTR: Record<string, AttrId> = { cyberware: 'tech', mechanics: 'tech', investigate: 'intellect' }

export interface InspectOption {
  /** 第幾件（0 起算） */
  index: number
  name: string
  kind: CatalogLot['kind']
  /** 現在能看嗎 */
  can: boolean
  /** 不能看的原因（一條一個條件）；能看是空的 */
  blocks: string[]
  /** 會用哪一項基本功、屬性、DC 與成功率（零件與義體才有；成功率是大成功加成功的機率） */
  skill?: string
  skill_name?: string
  attr?: AttrId
  dc?: number
  success?: number
}

export interface InspectInput {
  house?: string
  /** 第幾件（目錄上的 index，0 起算） */
  lot?: number
  /** 動手看的人（主角或隊上的人）；沒給是主角 */
  by?: ActorId
}

/** 怎麼擲：最高等級的那一項基本功、屬性、DC。by 不在場是 null。 */
function checkOf(k: Kernel, state: GameState, by: ActorId): { skill: string; attr: AttrId; dc: number; parts: RollPart[] } | null {
  const actor = state.actors[by]
  if (!actor) return null
  const rule = auctionRules(k).fake
  let skill = rule.skills[0]!
  for (const s of rule.skills) if ((actor.skills[s] ?? 0) > (actor.skills[skill] ?? 0)) skill = s
  const attr = ((k.content.hasKind('skill') ? (k.content.get('skill', skill)?.attr as string | undefined) : undefined) ?? SKILL_ATTR[skill] ?? 'intellect') as AttrId
  const parts = checkParts(k.stats, state, by, { attr, skill, tags: ['auction', 'inspect'] }).filter((p) => p.value !== 0)
  return { skill, attr, dc: dcFor(rule.dc, state.rules), parts }
}

/** 二十個骰面逐面算（用 makeCheck，和真正擲出來的門檻一致）：大成功加成功的比例。 */
function successOdds(parts: RollPart[], dc: number): number {
  let n = 0
  for (let face = 1; face <= 20; face++) {
    const d = makeCheck({ natural: face, parts, dc }).degree
    if (d === 'critical' || d === 'success') n++
  }
  return n / 20
}

const inParty = (state: GameState, who: ActorId): boolean => !!state.actors[who] && (who === state.pc || state.party.includes(who))

/** 這一件現在能不能看，與不能的原因。 */
function blocksOf(k: Kernel, state: GameState, houseId: string, lot: CatalogLot, by: ActorId | undefined, preview: boolean): string[] {
  const house = houseOf(k, houseId)!
  const p: string[] = []
  const act = k.activity.blockOf(state, `commit:${INSPECT_ACTION}`)
  if (act) p.push(act)
  if (!state.pc) p.push('還沒有主角。')
  if (!housesHere(k, state).some((h) => h.id === houseId)) p.push(`要站在${house.name}裡才看得到貨。`)
  if (!preview) {
    const r = auctionRules(k).preview
    p.push(`預展只在開槌前 ${r.days_before === 1 ? '一' : String(r.days_before)} 天的 ${String(r.from_hour).padStart(2, '0')}:00～${String(r.to_hour).padStart(2, '0')}:00，現在沒有開。`)
  }
  if (!FAKEABLE.includes(lot.kind)) p.push(`${kindName(lot.kind, state)}沒有仿品的問題，沒有什麼好看的。`)
  if (auctionOf(state).looked[lot.key] !== undefined) p.push('這一件這一場已經看過了。')
  if (by !== undefined && !inParty(state, by)) p.push('動手看的人要是主角或隊上的人。')
  return p
}

/** 對目錄的每一件回答能不能看、原因、會用哪一項基本功、DC 與成功率（by 沒給是主角）。目錄還沒公布、沒有這家拍賣行是空的。 */
export function inspectOptions(k: Kernel, state: GameState, houseId: string, by: ActorId | undefined = state.pc ?? undefined): InspectOption[] {
  const c = catalogOf(k, state, houseId)
  if (!c || toMinutes(state.time) < c.session.catalog_at) return []
  const preview = inPreview(c.session, toMinutes(state.time))
  const chk = by !== undefined && inParty(state, by) ? checkOf(k, state, by) : null
  return c.lots.map((l): InspectOption => {
    const blocks = blocksOf(k, state, houseId, l, by, preview)
    const fakeable = FAKEABLE.includes(l.kind)
    return {
      index: l.index, name: l.name, kind: l.kind, can: blocks.length === 0, blocks,
      ...(fakeable && chk ? { skill: chk.skill, skill_name: k.stats.skillName(chk.skill), attr: chk.attr, dc: chk.dc, success: successOdds(chk.parts, chk.dc) } : {}),
    }
  })
}

/** 這一次看不成的原因（一條一個條件）；成立是空的。 */
export function inspectProblems(k: Kernel, state: GameState, input: InspectInput): string[] {
  const house = isText(input.house) ? houseOf(k, input.house) : undefined
  if (!house) return ['要指定哪一家拍賣行。']
  const c = catalogOf(k, state, house.id)
  if (!c) return ['這一家現在沒有目錄。']
  const now = toMinutes(state.time)
  if (now < c.session.catalog_at) return [`預展還沒有開：目錄與預展從${formatTime(fromMinutes(c.session.catalog_at))}開始。`]
  const lot = Number.isInteger(input.lot) ? c.lots[input.lot as number] : undefined
  if (!lot) return ['要指定目錄上的哪一件。']
  const by = input.by ?? state.pc ?? undefined
  const p = blocksOf(k, state, house.id, lot, by, inPreview(c.session, now))
  if (by !== undefined && inParty(state, by) && !checkOf(k, state, by)) p.push('找不到動手看的人。')
  return [...new Set(p)]
}

/** 現在看不了的原因（接起來的一句）；成立是 null。 */
export function inspectBlock(k: Kernel, state: GameState, input: InspectInput): string | null {
  const p = inspectProblems(k, state, input)
  return p.length > 0 ? p.join('') : null
}

/** 看貨：報告 auction.inspect；outcome.result 是 ok、fake 或 unknown（只有擲過、而且成功才知道真假）。 */
export function inspectDraft(k: Kernel, state: GameState, input: InspectInput): ReportDraft {
  const block = inspectBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const house = houseOf(k, input.house!)!
  const c = catalogOf(k, state, house.id)!
  const lot = c.lots[input.lot!]!
  const by = input.by ?? state.pc!
  const chk = checkOf(k, state, by)!
  const rule = auctionRules(k).fake
  const roll: CheckRoll = rollCheck(k.stats, state, { actor: by, attr: chk.attr, skill: chk.skill, dc: chk.dc, purpose: `${INSPECT_ACTION}/${lot.key}/${by}`, tags: ['auction', 'inspect'] })
  const passed = roll.degree === 'critical' || roll.degree === 'success'
  const result: LookResult = passed ? (lot.fake ? 'fake' : 'ok') : 'unknown'
  const line = `${npcName(k, state, by)}在預展看了第 ${lot.index + 1} 件「${lot.name}」：${LOOK_TEXT[result]}`
  const changes: Change[] = [{ op: 'rng', advance: 1 }, { op: PATCH_OP, looked: { [lot.key]: result } }, ...(rule.minutes > 0 ? [{ op: 'time', minutes: rule.minutes } as Change] : [])]
  return {
    kind: 'action', action: INSPECT_ACTION, location: clone(state.location), actor: by, party: [],
    timeline: [
      { layer: 'meat', actor: by, text: line, tag: INSPECT_ACTION, data: { house: house.id, lot: lot.index, key: lot.key, skill: chk.skill, result } },
      { layer: 'meat', actor: by, text: `${DEGREE_NAME[roll.degree]}（骰 ${roll.natural}，合計 ${roll.total}，對 DC ${roll.dc}）`, roll, tag: 'auction.roll', data: { degree: roll.degree } },
    ],
    changes, outcome: { result, summary: line }, narration: { results: [line] },
  }
}
