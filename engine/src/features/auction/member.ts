// L6 auction 的會員與推薦（LEWD_SYSTEM 6.2 節「進場」；dev/adr/0019 P81）：
//   memberOf：停權中不是（原因寫到哪一天）；好感夠（每次現算，不存）是；推薦函（存在 state.ext.auction.member）是；否則不是，原因各一句。
//   refOptions／refBlock／refDraft：向資料帶 auction_ref 的 NPC 換一封推薦函：花一個人情（條件 has_favor、變更 favor.spend；沒有人註冊時這一種不列），或對方的親密度夠（不扣東西）。
// 讀別人的：量表 favor（好感）、affinity（親密度）用 meterOf 讀、查不到當 0；條件 has_favor 與變更 favor.spend 用登錄表問；不 import favors。

import type { Change, Condition, ContentEntry, GameState, Kernel, ReportDraft } from '../../core'
import { ActionBlocked, clone, meterOf, toMinutes } from '../../core'
import type { HouseEntry } from './model'
import { FRIENDLY_FAVOR, PATCH_OP, REF_ACTION, REF_MINUTES, SIZES, auctionOf, auctionRules, factionName, houseOf, isText, npcName } from './model'
import { dayOfMinutes } from './session'

export interface Membership {
  house: string
  member: boolean
  /** 是會員時：靠好感，還是靠推薦函 */
  via?: 'favor' | 'ref'
  /** 停權中：到什麼時候（分鐘） */
  banned?: number
  /** 不是會員的原因（一條一句；是會員是空的） */
  blocks: string[]
  /** blocks 接起來的一句（是會員是 null） */
  reason: string | null
}

const SIZE_NAME: Record<(typeof SIZES)[number], string> = { small: '小', mid: '中', big: '大' }

/** 資料帶 auction_ref、而且對得上這一家的 NPC（依 id 排）。 */
export function refNpcs(k: Pick<Kernel, 'content'>, house: string): Array<ContentEntry & { name?: unknown }> {
  return k.content.list('npc')
    .filter((n) => n.auction_ref === true || (Array.isArray(n.auction_ref) && (n.auction_ref as unknown[]).includes(house)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 這一家認的好感門檻（勢力、門檻）；資料沒有 member.faction 是 null。 */
const favorGate = (h: HouseEntry): { faction: string; need: number } | null => (h.member.faction !== undefined ? { faction: h.member.faction, need: h.member.favor_min ?? FRIENDLY_FAVOR } : null)

/** 是不是這一家的會員（條件 auction_member 用同一個函式）。 */
export function memberOf(k: Pick<Kernel, 'content' | 'meters'>, state: GameState, houseId: string): Membership {
  const house = houseOf(k, houseId)
  if (!house) return { house: houseId, member: false, blocks: ['沒有這一家拍賣行。'], reason: '沒有這一家拍賣行。' }
  const a = auctionOf(state)
  const until = a.banned[houseId]
  if (until !== undefined && until > toMinutes(state.time)) {
    const line = `你在${house.name}被停權了，要到第 ${dayOfMinutes(until)} 天才恢復會員資格。`
    return { house: houseId, member: false, banned: until, blocks: [line], reason: line }
  }
  const gate = favorGate(house)
  if (gate && meterOf(k, state, 'favor', gate.faction) >= gate.need) return { house: houseId, member: true, via: 'favor', blocks: [], reason: null }
  if (house.member.ref === true && a.member[houseId]) return { house: houseId, member: true, via: 'ref', blocks: [], reason: null }
  const blocks: string[] = []
  if (gate) {
    const have = meterOf(k, state, 'favor', gate.faction)
    blocks.push(`${factionName(k, gate.faction)}的好感要到 ${gate.need}，你現在 ${have}，還差 ${gate.need - have} 點。`)
  }
  if (house.member.ref === true) {
    const names = refNpcs(k, houseId).map((n) => (isText(n.name) ? n.name : n.id))
    blocks.push(names.length > 0 ? `也可以請${names.join('、')}寫一封${house.name}的推薦函。` : `也可以找${house.name}的常客寫一封推薦函。`)
  }
  if (blocks.length === 0) blocks.push(`${house.name}不收會員。`)
  return { house: houseId, member: false, blocks, reason: blocks.join('') }
}

// ---- 推薦函 ----

export type RefPay = 'favor' | 'affinity'

export interface RefPayOption {
  pay: RefPay
  /** 這一種換法現在成立嗎 */
  ok: boolean
  /** 不成立的原因（一條一個條件）；成立是空的 */
  blocks: string[]
}

export interface RefOption {
  npc: string
  name: string
  /** 兩種換法；人情那一種在沒有人註冊 has_favor 與 favor.spend 時不列 */
  pays: RefPayOption[]
}

/** 用人情換推薦：有人註冊條件 has_favor 與變更 favor.spend 才有。 */
const favorAvailable = (k: Pick<Kernel, 'conditions' | 'changes'>): boolean => k.conditions.kinds().includes('has_favor') && !!k.changes.get('favor.spend')

/** 這個人欠你一個 size 的人情嗎（條件 has_favor）。 */
function owesFavor(k: Pick<Kernel, 'conditions' | 'stats' | 'timeRules'>, state: GameState, who: string, size: string): boolean {
  return k.conditions.test({ kind: 'has_favor', dir: 'owed_to_pc', size, who } as unknown as Condition, { state, stats: k.stats, timeRules: k.timeRules })
}

/** 整家拍賣行這一步就擋下的原因（沒有主角、有別的活動、不收推薦、已經是會員、停權中）。 */
function houseBlocks(k: Kernel, state: GameState, house: HouseEntry): string[] {
  const p: string[] = []
  const act = k.activity.blockOf(state, `commit:${REF_ACTION}`)
  if (act) p.push(act)
  if (!state.pc) p.push('還沒有主角。')
  if (house.member.ref !== true) {
    p.push(`${house.name}不收推薦函。`)
    return p
  }
  const m = memberOf(k, state, house.id)
  if (m.banned !== undefined) p.push(m.blocks[0]!)
  else if (m.member) p.push(`你已經是${house.name}的會員了。`)
  return p
}

function payOption(k: Kernel, state: GameState, npc: string, pay: RefPay): RefPayOption {
  const rule = auctionRules(k).ref
  const blocks: string[] = []
  const name = npcName(k, state, npc)
  if (pay === 'favor') {
    if (!favorAvailable(k)) blocks.push('現在沒有人情可以用。')
    else if (!owesFavor(k, state, npc, rule.favor)) blocks.push(`${name}要欠你一個${SIZE_NAME[rule.favor]}人情，才肯用它換一封推薦函。`)
  } else {
    const have = meterOf(k, state, 'affinity', npc)
    if (have < rule.affinity) blocks.push(`${name}和你的親密度要到 ${rule.affinity}（你現在 ${have}），才肯不收東西就寫推薦函。`)
  }
  return { pay, ok: blocks.length === 0, blocks }
}

/** 這一家有誰寫得出推薦函，各用哪一種換法、成不成立與原因。沒有這家拍賣行是空的。 */
export function refOptions(k: Kernel, state: GameState, houseId: string): RefOption[] {
  const house = houseOf(k, houseId)
  if (!house || house.member.ref !== true) return []
  return refNpcs(k, houseId).map((n) => ({
    npc: n.id, name: npcName(k, state, n.id),
    pays: (['favor', 'affinity'] as const).filter((pay) => pay !== 'favor' || favorAvailable(k)).map((pay) => payOption(k, state, n.id, pay)),
  }))
}

export interface RefInput {
  house?: string
  npc?: string
  pay?: RefPay
}

/** 這一次換不成的原因（一條一個條件）；成立是空的。 */
export function refProblems(k: Kernel, state: GameState, input: RefInput): string[] {
  const house = isText(input.house) ? houseOf(k, input.house) : undefined
  if (!house) return ['要指定哪一家拍賣行。']
  const p = houseBlocks(k, state, house)
  const npc = isText(input.npc) ? refNpcs(k, house.id).find((n) => n.id === input.npc) : undefined
  if (!npc) p.push('這個人寫不出這一家的推薦函。')
  else if (input.pay !== 'favor' && input.pay !== 'affinity') p.push('要選一種換法：人情或親密度。')
  else p.push(...payOption(k, state, npc.id, input.pay).blocks)
  return [...new Set(p)]
}

/** 現在換不了的原因（接起來的一句）；成立是 null。 */
export function refBlock(k: Kernel, state: GameState, input: RefInput): string | null {
  const p = refProblems(k, state, input)
  return p.length > 0 ? p.join('') : null
}

/**
 * 換一封推薦函：favor 用掉那個人欠你的一個人情（變更 favor.spend），affinity 不扣東西；成立之後 state.ext.auction.member 記下這一家、時間加 10 分鐘。
 * 報告 auction.ref。
 */
export function refDraft(k: Kernel, state: GameState, input: RefInput): ReportDraft {
  const block = refBlock(k, state, input)
  if (block) throw new ActionBlocked(block)
  const house = houseOf(k, input.house!)!
  const npc = input.npc!
  const pay = input.pay as RefPay
  const name = npcName(k, state, npc)
  const rule = auctionRules(k).ref
  const changes: Change[] = []
  if (pay === 'favor') changes.push({ op: 'favor.spend', dir: 'owed_to_pc', size: rule.favor, who: npc })
  changes.push({ op: PATCH_OP, member: { [house.id]: { by: npc, at: toMinutes(state.time) } } }, { op: 'time', minutes: REF_MINUTES })
  const line = pay === 'favor'
    ? `用掉一個${SIZE_NAME[rule.favor]}人情，請${name}寫了一封${house.name}的推薦函。`
    : `${name}和你夠熟，沒有收你什麼，替你寫了一封${house.name}的推薦函。`
  return {
    kind: 'action', action: REF_ACTION, location: clone(state.location), ...(state.pc ? { actor: state.pc } : {}), party: [],
    timeline: [{ layer: 'meat', ...(state.pc ? { actor: state.pc } : {}), text: line, tag: REF_ACTION, data: { house: house.id, npc, pay } }],
    changes, outcome: { result: pay, summary: line }, narration: { results: [line] },
  }
}

