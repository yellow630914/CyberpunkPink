// L6 功能 contract 主角是持約人那一面的基本動作（M4-contract-holder；LEWD_SYSTEM 7.5 節；dev/adr/0019 第八節）：
// 成為持約人、解約、隨時間發生的事（期滿、借出去的人回來、親密度掉下去時主僕關係自己退回）。
// 都是純函式，回傳要套的變更與給玩家看的句子；效果（effects.ts）與主動的入口（holder.ts）、時間的掛點（time.ts）共用。

import type { ActorId, Change, GameState, GameTime, Kernel, ReportDraft } from '../../core'
import { MINUTES_PER_DAY, dailyCrossings, meterOf, toMinutes } from '../../core'
import { draftOf } from './draft'
import type { ContractExt, ContractType, Held, OrderKind, Relation } from './model'
import {
  AFFINITY, BOUND, ORDER_KINDS, RELEASED_POINT, RELEASE_ACTION, ADJUST_ACTION, RELATION_NAME, classOf, contractRules, extChange, extOf, identityChange, nowOf, pcOf,
} from './model'
import { builtinFx } from './plans'

export const pcName = (state: GameState): string => state.actors[state.pc ?? '']?.name ?? '你'
export const nameOf = (state: GameState, npc: ActorId): string => state.actors[npc]?.name ?? npc

/** 量表有定義才往上加減（沒有人定義就略過）。 */
export const meterDelta = (k: Pick<Kernel, 'meters'>, kind: string, key: string, delta: number): Change[] => (k.meters.get(kind) ? [{ op: 'meter', kind, key, delta }] : [])

/** 他對主角的親密度（量表查不到當 0）。 */
export const affinityOf = (k: Pick<Kernel, 'meters'>, state: GameState, npc: ActorId): number => meterOf(k, state, AFFINITY, npc)

// ---- 成為持約人 ----

export interface HoldInput {
  npc: ActorId
  type: ContractType
  debt?: number
  days?: number
  orders?: OrderKind[]
  origin?: string
}

/** 主角成為他的持約人：建立 held[npc]、他的身分改成 bound、有人註冊 roster_add 就把他放進名冊、記一則通知。已經持有、不是在場的角色、是主角自己都是 null。 */
export function holdPlan(k: Kernel, state: GameState, pc: ActorId, e: HoldInput): { changes: Change[]; text: string; held: Held } | null {
  const ext = extOf(state)
  if (ext.held[e.npc] || !state.actors[e.npc] || e.npc === pc) return null
  const now = nowOf(state)
  const was = classOf(state, e.npc)
  ext.seq += 1
  const held: Held = {
    id: `h${ext.seq}`, holder: { kind: 'person', npc: pc, name: pcName(state) }, type: e.type, orders: e.orders ? [...new Set(e.orders)] : [...ORDER_KINDS],
    relation: 'formal', rules: [], queue: [], mark: { covered: false }, was_class: was === BOUND ? 'citizen' : was, complied: 0, signed: now,
    home: 'own', split: contractRules(k).holder.default_split, triggered: {}, origin: e.origin ?? '',
  }
  if (e.type === 'debt') held.debt = e.debt ?? 0
  if (e.days !== undefined) held.until = now + e.days * MINUTES_PER_DAY
  ext.held[e.npc] = held
  const text = `你成了${nameOf(state, e.npc)}的持約人，他的名字進了你的名冊。`
  ext.notes.push({ kind: 'hold', text, npc: e.npc })
  const changes: Change[] = [extChange(ext), identityChange(state, e.npc, BOUND)]
  // 進入名冊（7.5 節）：有人註冊 roster_add 才放；已經在名冊上的由那個效果自己落空
  const roster = builtinFx(k, state, pc, [{ kind: 'roster_add', who: e.npc }])
  if (roster.ok) changes.push(...roster.changes)
  return { changes, text, held }
}

// ---- 解約 ----

/**
 * 解約：held 拿掉、他的身分改回去（還是 bound 才改，別人改過的不蓋回去）、記旗標 released:<npc>（遊戲會記得）。
 * note：寫一則通知（效果用；之後 report.after 發 contract.release，不 stay 時帶觸發點 released）；直接的入口（releaseDraft）自己發報告，不用通知。
 */
export function releasePlan(state: GameState, npc: ActorId, o: { stay?: boolean; how?: string; note?: boolean; base?: ContractExt } = {}): { changes: Change[]; text: string; held: Held } | null {
  const ext = o.base ?? extOf(state)
  const held = ext.held[npc]
  if (!held) return null
  delete ext.held[npc]
  const name = nameOf(state, npc)
  const text = o.how === 'expired' ? `你和${name}的契約期滿，自動解除。` : o.stay ? `你解除了和${name}的契約，他留在你身邊。` : `你解除了和${name}的契約，他不再是你的契約人。`
  if (o.note) ext.notes.push({ kind: 'release', text, npc, stay: o.stay === true, relation: held.relation, result: o.how ?? 'released' })
  const changes: Change[] = [extChange(ext), { op: 'flag', key: `released:${npc}`, value: true }]
  if (state.actors[npc] && classOf(state, npc) === BOUND) changes.push(identityChange(state, npc, held.was_class === BOUND ? 'citizen' : held.was_class))
  return { changes, text, held }
}

/** 解約之後的觸發點（不 stay 時，讓名冊或事件決定他走不走）。 */
export const releasedTrigger = (npc: ActorId, relation: Relation): NonNullable<ReportDraft['triggers']> => [{ point: RELEASED_POINT, where: { npc, relation } }]

// ---- 隨時間 ----

/** 他的橋參數自己會往上的那一次（每滿 docility_every 次沒被抗命的觸發）：bridge 效果落在他身上；沒有橋或沒有人註冊就略過。 */
export function docilityStep(k: Kernel, state: GameState, npc: ActorId, complied: number): { changes: Change[]; line: string | null } {
  if (complied % contractRules(k).docility_every !== 0) return { changes: [], line: null }
  const fx = builtinFx(k, state, npc, [{ kind: 'bridge', param: 'docility', amount: 1 }])
  return fx.ok && fx.changes.length > 0 ? { changes: fx.changes, line: `${nameOf(state, npc)}照做的次數多了，橋把「照做」接得更順了。` } : { changes: [], line: null }
}

/**
 * time.passed：持約人這一面隨時間發生的事。sim 是一路套下去的複製，emit 把草稿放進去並套到 sim 上。
 *   期滿（until）→ 解約（contract.release，不 stay，帶觸發點 released）；借出去的人到時間回來（contract.adjust）；
 *   每天 08:00：主僕關係不是名實相符、而他對主角的親密度掉到 relation_revert 以下，退回名實相符（contract.adjust）。
 */
export function holderDrafts(k: Kernel, sim: GameState, emit: (d: ReportDraft) => void, from: GameTime, to: GameTime): void {
  const pc = pcOf(sim)
  if (!pc || Object.keys(extOf(sim).held).length === 0) return
  const nowTo = toMinutes(to)
  const rules = contractRules(k).holder
  for (const npc of Object.keys(extOf(sim).held).sort()) {
    const h = extOf(sim).held[npc]!
    if (h.until !== undefined && nowTo >= h.until) {
      const end = releasePlan(sim, npc, { how: 'expired' })!
      emit(draftOf(sim, 'downtime', RELEASE_ACTION, end.changes, [end.text], 'expired', { triggers: releasedTrigger(npc, h.relation) }))
      continue
    }
    if (h.lent && nowTo >= h.lent.until) {
      const ext = extOf(sim)
      const back = ext.held[npc]!
      const to_ = back.lent!.to
      delete back.lent
      emit(draftOf(sim, 'downtime', ADJUST_ACTION, [extChange(ext)], [`${nameOf(sim, npc)}從${to_}那裡回來了。`], 'lent_back'))
    }
  }
  if (dailyCrossings(from, to).length === 0) return
  for (const npc of Object.keys(extOf(sim).held).sort()) {
    const h = extOf(sim).held[npc]!
    if (h.relation === 'formal' || affinityOf(k, sim, npc) > rules.relation_revert) continue
    const ext = extOf(sim)
    const was = ext.held[npc]!.relation
    ext.held[npc]!.relation = 'formal'
    emit(draftOf(sim, 'downtime', ADJUST_ACTION, [extChange(ext)], [`${nameOf(sim, npc)}和你的距離拉遠了，你們的關係退回了「${RELATION_NAME.formal}」（本來是「${RELATION_NAME[was]}」）。`], 'relation_reverted'))
  }
}
