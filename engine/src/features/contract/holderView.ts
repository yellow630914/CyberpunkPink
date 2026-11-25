// L6 功能 contract 主角是持約人時給畫面讀的：契約那一頁的資料（holderContractView）。唯讀的純函式：不改狀態、不擲骰。
// 能調的每一項列出現在的值與擋住的原因（調整本身見 holder.ts 的 adjustDraft）。事件那一頁是 holder.ts 的 holderEvents。

import type { GameState, Kernel } from '../../core'
import { isRecord, meterOf } from '../../core'
import type { ContractRule, Home, Held, Relation } from './model'
import {
  AFFINITY, BRIDGE_PARAMS, DOCILITY_STAT, HOMES, HOME_NAME, LOYALTY, ORDER_KINDS, ORDER_NAME, RELATIONS, RELATION_NAME, TYPE_NAME, pcOf,
} from './model'
import type { HolderEvent } from './holder'
import { heldIn, holderEvents, homeBlock, lendBlock, relationBlock } from './holder'

export interface HolderAdjustItem {
  key: 'rules' | 'home' | 'job' | 'split' | 'relation' | 'lend' | 'release'
  name: string
  /** 現在的值（給畫面顯示） */
  value: unknown
  /** 現在改不了的原因（一條；改得了是 null）。多選項的項目（住處、主僕關係）看 options */
  blocked: string | null
  options?: Array<{ value: string; name: string; blocked: string | null }>
}

export interface HolderContractView {
  npc: string
  name: string
  /** 橋權的級別：持約人永遠是管理級 */
  level: 'manage'
  type: Held['type']
  type_name: string
  origin: string
  debt?: number
  until?: number
  /** 紙上的種類有沒有勾 */
  orders: Array<{ kind: (typeof ORDER_KINDS)[number]; name: string; ticked: boolean }>
  /** 他的橋參數（沒有橋是 null）；docility 是有效值（有人註冊衍生數值時） */
  bridge: Record<(typeof BRIDGE_PARAMS)[number], number> | null
  /** 他的傾向（只認 actor.ext.tendency 的格式；沒有是 null） */
  tendency: { axes: Record<string, number>; tags: Record<string, string> } | null
  docility: number
  complied: number
  sink: number
  affinity: number
  loyalty: number
  rules: ContractRule[]
  home: Home
  home_name: string
  job: string | null
  split: number
  relation: Relation
  relation_name: string
  lent: { to: string; until: number } | null
  mark: { covered: boolean }
  events: HolderEvent[]
  adjust: HolderAdjustItem[]
}

const numberMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {}
  if (isRecord(v)) for (const [key, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[key] = n
  return out
}

/** 契約那一頁：橋權的級別、來歷、剩下的債、他的橋參數、傾向、馴化、親密度與忠誠、規矩、住處、工作、分帳、關係、能調哪些。他不是你持有的人是 null。 */
export function holderContractView(k: Kernel, state: GameState, npc: string): HolderContractView | null {
  const h = heldIn(state, npc)
  const actor = state.actors[npc]
  if (!pcOf(state) || !h || !actor) return null
  const rawBridge = isRecord(actor.ext.bridge) ? actor.ext.bridge : null
  const bridge = rawBridge
    ? (Object.fromEntries(BRIDGE_PARAMS.map((p) => [p, typeof rawBridge[p] === 'number' ? (rawBridge[p] as number) : 0])) as Record<(typeof BRIDGE_PARAMS)[number], number>)
    : null
  const rawTend = actor.ext.tendency
  const tags: Record<string, string> = {}
  if (isRecord(rawTend) && isRecord(rawTend.tags)) for (const [tag, st] of Object.entries(rawTend.tags)) if (typeof st === 'string') tags[tag] = st
  const docility = k.stats.hasStat(DOCILITY_STAT) ? k.stats.stat(state, npc, DOCILITY_STAT) : (bridge?.docility ?? 0)
  if (bridge && k.stats.hasStat(DOCILITY_STAT)) bridge.docility = docility
  const lend = h.lent ? null : lendBlock(k, state, npc)
  const adjust: HolderAdjustItem[] = [
    { key: 'rules', name: '規矩', value: h.rules, blocked: null },
    {
      key: 'home', name: '住處', value: h.home, blocked: HOMES.every((x) => homeBlock(k, state, npc, x)) ? '他的住處沒有地方可以改。' : null,
      options: HOMES.map((x) => ({ value: x, name: HOME_NAME[x], blocked: homeBlock(k, state, npc, x) })),
    },
    { key: 'job', name: '工作的安排', value: h.job ?? null, blocked: null },
    { key: 'split', name: '分帳', value: h.split, blocked: null },
    {
      key: 'relation', name: '主僕關係', value: h.relation, blocked: RELATIONS.every((x) => relationBlock(k, state, npc, x)) ? '現在沒有別的關係可以選。' : null,
      options: RELATIONS.map((x) => ({ value: x, name: RELATION_NAME[x], blocked: relationBlock(k, state, npc, x) })),
    },
    { key: 'lend', name: '出借', value: h.lent ?? null, blocked: h.lent ? null : lend },
    { key: 'release', name: '解約', value: null, blocked: null },
  ]
  return {
    npc, name: actor.name, level: 'manage', type: h.type, type_name: TYPE_NAME[h.type], origin: h.origin, ...(h.debt !== undefined ? { debt: h.debt } : {}), ...(h.until !== undefined ? { until: h.until } : {}),
    orders: ORDER_KINDS.map((kind) => ({ kind, name: ORDER_NAME[kind], ticked: h.orders.includes(kind) })),
    bridge, tendency: isRecord(rawTend) ? { axes: numberMap(rawTend.axes), tags } : null, docility, complied: h.complied, sink: actor.sink,
    affinity: meterOf(k, state, AFFINITY, npc), loyalty: meterOf(k, state, LOYALTY, npc), rules: h.rules, home: h.home, home_name: HOME_NAME[h.home], job: h.job ?? null, split: h.split,
    relation: h.relation, relation_name: RELATION_NAME[h.relation], lent: h.lent ?? null, mark: h.mark, events: holderEvents(k, state, npc), adjust,
  }
}
